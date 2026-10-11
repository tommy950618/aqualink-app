/**
 * @module metrics
 * Game metrics for balance tests and the box score (spec §5.14 definitions, `game.metrics()` schema of GP §15 /
 * spec §5.15), possession bookkeeping and assists (C27).
 *
 * The game owns one `Metrics` and calls the event methods below from its event points (never per frame except
 * `liveTick`). Teams are the game's team indices 0 | 1. Every per-event structure is preallocated (rings for shots,
 * possessions and the per-player sample arrays); `snapshot()` builds the plain-object schema (allocates; tests only).
 *
 * Schema returned by `snapshot()`:
 * ```
 * { games, gameSeconds,
 *   possessions: [{ team, liveSec, end: 'MADE'|'TURNOVER'|'OOB'|'SHOT_CLOCK'|'PERIOD'|'CLEAR', points }],
 *   team: [{ fga, fgm, pa3, pm3, zone: { rim:{a,m}, close:{a,m}, mid:{a,m}, three:{a,m} }, drivesFinished, blk, stl,
 *            tov: { steal, intercept, oob, shotClock, notCleared }, pts, passes, intercepts, deflects, oreb, dreb,
 *            ankles, airballs, airballOOB, untouchedMiss, untouchedMissOOB }],
 *   player: { <id>: { fga, fgm, zone, pa3, pm3, pts, moves, jabs, pumpFakes, postTouches, touches,
 *                     handlerPossessions, assists, drives, jumpers, stepbacks, catchToPress: number[],
 *                     releaseSpeed: number[], abilities: { <abilityId>: n } } },
 *   shots: [{ t, shooter, team, kind, variant, zone, d, three, points, eT, X, C, p, make, scored, blockedBy,
 *             releaseSpeed, catchToPress, defDist, urgent, fromDrive }] }      // ring 2000, oldest first
 * ```
 * Team stat meanings: `stl` = steals by this team's defence (pokes caught + interceptions, credited at the catch,
 * R6); `intercepts` / `deflects` = this team's passes intercepted / deflected; `tov.*` = this team's turnovers
 * (backcourt violations are booked under `oob`); `ankles` = ankle-breaks this team's handlers caused.
 */
import { RULES_V2 } from './constants.js';
import { ABILITY_IDS } from './abilities.js';

const ZONES = ['rim', 'close', 'mid', 'three'];
const END_KINDS = ['MADE', 'TURNOVER', 'OOB', 'SHOT_CLOCK', 'PERIOD', 'CLEAR'];

function zoneBucket(zone) {
  return zone === 'layup' || zone === 'dunk' || zone === 'tip' || zone === 'rim' ? 'rim' : zone;
}

function makeZones() {
  return { rim: { a: 0, m: 0 }, close: { a: 0, m: 0 }, mid: { a: 0, m: 0 }, three: { a: 0, m: 0 } };
}

function makeTeam() {
  return {
    fga: 0, fgm: 0, pa3: 0, pm3: 0, zone: makeZones(), drivesFinished: 0, blk: 0, stl: 0,
    tov: { steal: 0, intercept: 0, oob: 0, shotClock: 0, notCleared: 0 }, pts: 0, passes: 0, intercepts: 0, deflects: 0,
    oreb: 0, dreb: 0, ankles: 0, airballs: 0, airballOOB: 0, untouchedMiss: 0, untouchedMissOOB: 0,
  };
}

/** Fixed-capacity numeric sample ring (oldest dropped when full). */
class SampleRing {
  constructor(cap) {
    this.buf = new Float64Array(cap);
    this.cap = cap;
    this.head = 0;
    this.size = 0;
  }

  push(v) {
    this.buf[this.head] = v;
    this.head = (this.head + 1) % this.cap;
    if (this.size < this.cap) this.size++;
  }

  toArray() {
    const out = new Array(this.size);
    for (let i = 0; i < this.size; i++) out[i] = this.buf[(this.head - this.size + i + this.cap) % this.cap];
    return out;
  }

  clear() {
    this.head = 0;
    this.size = 0;
  }
}

function makePlayer(cap) {
  const abilities = {};
  for (const id of ABILITY_IDS) abilities[id] = 0;
  return {
    team: -1, fga: 0, fgm: 0, zone: makeZones(), pa3: 0, pm3: 0, pts: 0, moves: 0, jabs: 0, pumpFakes: 0,
    postTouches: 0, touches: 0, handlerPossessions: 0, assists: 0, drives: 0, jumpers: 0, stepbacks: 0,
    catchToPress: new SampleRing(cap), releaseSpeed: new SampleRing(cap), abilities,
    // bookkeeping (not in the snapshot)
    catchT: NaN, catchFrom: null, pressT: NaN, driving: false, driveT: 0, driveQualified: false,
  };
}

function resetPlayer(p) {
  p.fga = p.fgm = p.pa3 = p.pm3 = p.pts = p.moves = p.jabs = p.pumpFakes = 0;
  p.postTouches = p.touches = p.handlerPossessions = p.assists = p.drives = p.jumpers = p.stepbacks = 0;
  for (const z of ZONES) { p.zone[z].a = 0; p.zone[z].m = 0; }
  p.catchToPress.clear(); p.releaseSpeed.clear();
  for (const id in p.abilities) p.abilities[id] = 0;
  p.catchT = NaN; p.catchFrom = null; p.pressT = NaN; p.driving = false; p.driveT = 0; p.driveQualified = false;
}

function makeShot() {
  return {
    t: 0, shooter: null, team: -1, kind: null, variant: null, zone: null, d: 0, three: false, points: 2, eT: NaN,
    X: 0, C: 1, p: 0, make: false, scored: false, blockedBy: null, releaseSpeed: NaN, catchToPress: NaN, defDist: NaN,
    urgent: false, fromDrive: false,
  };
}

const JUMPER_FAMILY = { jumper: true, fade: true, stepback: true, turnFade: true };

/** Per-game / per-session metrics collector (one per Game). */
export class Metrics {
  /**
   * @param {{shotCapacity?: number, possessionCapacity?: number, sampleCapacity?: number}} [opts]
   */
  constructor(opts = {}) {
    this.shotCap = opts.shotCapacity || 2000;
    this.possCap = opts.possessionCapacity || 4096;
    this.sampleCap = opts.sampleCapacity || 2048;
    this.shots = new Array(this.shotCap);
    for (let i = 0; i < this.shotCap; i++) this.shots[i] = makeShot();
    this.shotHead = 0;
    this.shotSize = 0;
    this.poss = new Array(this.possCap);
    for (let i = 0; i < this.possCap; i++) this.poss[i] = { team: -1, liveSec: 0, end: null, points: 0 };
    this.possHead = 0;
    this.possSize = 0;
    this.team = [makeTeam(), makeTeam()];
    this.players = {};
    this.games = 0;
    this.gameSeconds = 0;
    // current possession
    this.curTeam = -1;
    this.curLive = 0;
    this.curPoints = 0;
    // assists (C27): last completed pass per team
    this.lastPass = [{ passer: null, receiver: null, catchT: NaN }, { passer: null, receiver: null, catchT: NaN }];
    // pending shot per team (index into the ring) for zone makes / blocks / misses
    this.pendingShot = [-1, -1];
  }

  /** Clear everything (`__game.resetMetrics()`); registered players stay registered. */
  reset() {
    this.shotHead = this.shotSize = 0;
    this.possHead = this.possSize = 0;
    this.team[0] = makeTeam();
    this.team[1] = makeTeam();
    for (const id in this.players) resetPlayer(this.players[id]);
    this.games = 0;
    this.gameSeconds = 0;
    this.curTeam = -1; this.curLive = 0; this.curPoints = 0;
    this.clearAssistChain();
    this.pendingShot[0] = this.pendingShot[1] = -1;
  }

  /** Register a player id with its team index (allocates once per id). */
  registerPlayer(id, team) {
    let p = this.players[id];
    if (!p) { p = makePlayer(this.sampleCap); this.players[id] = p; }
    p.team = team;
    return p;
  }

  /** A new game starts: games + 1, team mapping from the lineup (`a` → team 0, `b` → team 1). */
  gameStart(lineup) {
    this.games++;
    if (lineup) {
      for (let i = 0; i < 3; i++) { this.registerPlayer(lineup.a[i], 0); this.registerPlayer(lineup.b[i], 1); }
    }
    this.curTeam = -1; this.curLive = 0; this.curPoints = 0;
    this.clearAssistChain();
    this.pendingShot[0] = this.pendingShot[1] = -1;
  }

  _p(id) {
    return this.players[id] || this.registerPlayer(id, -1);
  }

  /** Game-clock seconds consumed (call with the clock decrement of each running step). */
  addGameTime(dt) {
    this.gameSeconds += dt;
  }

  // ---------------------------------------------------------------- possessions

  /** LIVE begins for `team` (or a live flip under R9). Closes nothing; call `possessionEnd` first on a change. */
  possessionStart(team) {
    this.curTeam = team;
    this.curLive = 0;
    this.curPoints = 0;
    this.clearAssistChain();
  }

  /** Accumulate live game-clock seconds of the current possession. */
  liveTick(dtClock) {
    if (this.curTeam >= 0) this.curLive += dtClock;
  }

  /** End the current possession: `end` ∈ MADE | TURNOVER | OOB | SHOT_CLOCK | PERIOD | CLEAR. */
  possessionEnd(end) {
    if (this.curTeam < 0) return;
    const e = this.poss[this.possHead];
    e.team = this.curTeam; e.liveSec = this.curLive; e.end = END_KINDS.indexOf(end) >= 0 ? end : 'TURNOVER'; e.points = this.curPoints;
    this.possHead = (this.possHead + 1) % this.possCap;
    if (this.possSize < this.possCap) this.possSize++;
    this.curTeam = -1;
    this.curLive = 0;
    this.curPoints = 0;
    this.clearAssistChain();
  }

  clearAssistChain() {
    for (let i = 0; i < 2; i++) { this.lastPass[i].passer = null; this.lastPass[i].receiver = null; this.lastPass[i].catchT = NaN; }
  }

  // ---------------------------------------------------------------- touches, catches, presses

  /**
   * A player catches the ball at time t; `passerId` = the teammate whose pass he caught (null for rebounds, steals,
   * check balls). Counts a touch and arms catchToPress and the assist chain.
   */
  catchBall(id, team, t, passerId) {
    const p = this._p(id);
    p.touches++;
    p.catchT = t;
    p.catchFrom = passerId || null;
    if (team === 0 || team === 1) {
      const lp = this.lastPass[team];
      if (passerId) { lp.passer = passerId; lp.receiver = id; lp.catchT = t; } else { lp.passer = null; lp.receiver = null; lp.catchT = NaN; }
    }
  }

  /** The player becomes the handler of a possession (check ball, rebound, steal): handler possessions + 1. */
  handlerPossession(id) {
    this._p(id).handlerPossessions++;
  }

  /**
   * SHOOT press resolved to a shot (event `shot`). Returns catchToPress (s) for a non-urgent press (shot clock > 2 s)
   * after a catch, else NaN; the sample is booked on the player.
   */
  press(id, t, shotClock) {
    const p = this._p(id);
    p.pressT = t;
    let ctp = NaN;
    if (!Number.isNaN(p.catchT) && shotClock > RULES_V2.NON_URGENT_SHOT_CLOCK) {
      ctp = t - p.catchT;
      p.catchToPress.push(ctp);
    }
    p.catchT = NaN;
    return ctp;
  }

  // ---------------------------------------------------------------- shots

  /**
   * A shot is released. `s` = `{t, shooter, team, kind, variant, zone, d, three, points, eT, X, C, p, make,
   * releaseSpeed, catchToPress, defDist, urgent, fromDrive}` (copied; the caller may reuse its object).
   * Counts the FGA (zone by the release zone: rim = layup/dunk/tip), 3PA, jumpers/stepbacks, drive finishes and the
   * release-speed sample of jumper-family shots. Returns the ring index of the record.
   */
  shot(s) {
    const idx = this.shotHead;
    const r = this.shots[idx];
    r.t = s.t; r.shooter = s.shooter; r.team = s.team; r.kind = s.kind; r.variant = s.variant || null;
    r.zone = zoneBucket(s.kind === 'tip' ? 'tip' : s.zone); r.d = s.d; r.three = !!s.three; r.points = s.points || (s.three ? 3 : 2);
    r.eT = s.eT === undefined ? NaN : s.eT; r.X = s.X || 0; r.C = s.C === undefined ? 1 : s.C; r.p = s.p || 0;
    r.make = !!s.make; r.scored = false; r.blockedBy = null;
    r.releaseSpeed = s.releaseSpeed === undefined ? NaN : s.releaseSpeed;
    r.catchToPress = s.catchToPress === undefined ? NaN : s.catchToPress;
    r.defDist = s.defDist === undefined ? NaN : s.defDist; r.urgent = !!s.urgent; r.fromDrive = !!s.fromDrive;
    this.shotHead = (this.shotHead + 1) % this.shotCap;
    if (this.shotSize < this.shotCap) this.shotSize++;
    const T = this.team[r.team] || null;
    const p = this._p(r.shooter);
    p.fga++;
    p.zone[r.zone].a++;
    if (r.three) p.pa3++;
    if (JUMPER_FAMILY[r.kind]) {
      p.jumpers++;
      if (!Number.isNaN(r.releaseSpeed)) p.releaseSpeed.push(r.releaseSpeed);
    }
    if (r.kind === 'stepback') p.stepbacks++;
    if (T) {
      T.fga++;
      T.zone[r.zone].a++;
      if (r.three) T.pa3++;
      if (r.fromDrive && r.zone === 'rim') T.drivesFinished++;
      this.pendingShot[r.team] = idx;
    }
    return idx;
  }

  /** The pending shot of `team` was blocked by `blockerId` (BLK booked to the blocker's team `blkTeam`). */
  block(blockerId, blkTeam, shotTeam) {
    const idx = this.pendingShot[shotTeam];
    if (idx >= 0) this.shots[idx].blockedBy = blockerId;
    if (this.team[blkTeam]) this.team[blkTeam].blk++;
  }

  /**
   * A basket counts: `scorerId` of `team` scores `points` with a shot of `kind`. Books FGM / 3PM / zone makes
   * (credited to the shooter's pending shot — R5 keeps a deflected shot's value), team and possession points, and
   * the assist (C27). Returns the assisting passer id or null.
   */
  score(scorerId, team, points, kind) {
    const T = this.team[team];
    const p = this._p(scorerId);
    const idx = this.pendingShot[team];
    const rec = idx >= 0 ? this.shots[idx] : null;
    const zone = rec && rec.shooter === scorerId ? rec.zone : zoneBucket(kind === 'tip' ? 'tip' : (kind === 'layup' || kind === 'dunk' ? 'rim' : 'close'));
    if (rec && rec.shooter === scorerId) rec.scored = true;
    p.fgm++; p.pts += points; p.zone[zone].m++;
    if (points === 3) p.pm3++;
    if (T) {
      T.fgm++; T.pts += points; T.zone[zone].m++;
      if (points === 3) T.pm3++;
    }
    if (team === this.curTeam) this.curPoints += points;
    // Assist: the receiver of the last completed pass scores a non-tip FG whose press came ≤ 3.0 s after his catch.
    let assist = null;
    const lp = this.lastPass[team];
    if (lp && kind !== 'tip' && lp.receiver === scorerId && lp.passer && lp.passer !== scorerId
      && !Number.isNaN(p.pressT) && p.pressT - lp.catchT <= RULES_V2.ASSIST_WINDOW && p.pressT >= lp.catchT) {
      assist = lp.passer;
      this._p(assist).assists++;
    }
    this.pendingShot[team] = -1;
    return assist;
  }

  /**
   * A missed shot of `team` resolved: `airball` (forced air ball), `untouched` (no rim / board / player touched
   * it before it ended), `oob` (it ended out of bounds).
   */
  missResolved(team, airball, untouched, oob) {
    const T = this.team[team];
    if (!T) return;
    if (airball) { T.airballs++; if (oob) T.airballOOB++; }
    if (untouched) { T.untouchedMiss++; if (oob) T.untouchedMissOOB++; }
    this.pendingShot[team] = -1;
  }

  // ---------------------------------------------------------------- other events

  /** A pass is released by `team`. */
  pass(team) {
    if (this.team[team]) this.team[team].passes++;
  }

  /** A pass of `passTeam` was intercepted (the defence's STL is booked with `steal(…, 'intercept')`). */
  intercept(passTeam) {
    if (this.team[passTeam]) this.team[passTeam].intercepts++;
  }

  /** A pass of `passTeam` was deflected. */
  deflect(passTeam) {
    if (this.team[passTeam]) this.team[passTeam].deflects++;
  }

  /** STL credited at the defensive catch (R6): `how` 'poke' | 'intercept' | 'pass' (floor-bounced pass, R#24). */
  steal(defenderId, defTeam, how) {
    if (this.team[defTeam]) this.team[defTeam].stl++;
    this.turnover(1 - defTeam, how === 'poke' ? 'steal' : 'intercept');
  }

  /** A turnover of `team`: reason 'steal' | 'intercept' | 'oob' | 'backcourt' | 'shotClock' | 'notCleared'. */
  turnover(team, reason) {
    const T = this.team[team];
    if (!T) return;
    const key = reason === 'backcourt' ? 'oob' : reason;
    if (T.tov[key] !== undefined) T.tov[key]++;
  }

  /** A rebound by `id` of `team`. */
  rebound(id, team, offensive) {
    const T = this.team[team];
    if (T) { if (offensive) T.oreb++; else T.dreb++; }
  }

  /** An ankle-break caused by a handler of `team`. */
  ankle(team) {
    if (this.team[team]) this.team[team].ankles++;
  }

  /** A dribble move (event `move`). */
  move(id) { this._p(id).moves++; }

  /** A jab (event `jab`). */
  jab(id) { this._p(id).jabs++; }

  /** A pump fake (event `pumpFake`). */
  pumpFake(id) { this._p(id).pumpFakes++; }

  /** The player enters `post`. */
  postTouch(id) { this._p(id).postTouches++; }

  /** The handler's `drive` action starts (`on` true) or ends (`on` false) at time t; a drive counts at ≥ 0.5 s. */
  drive(id, on, t) {
    const p = this._p(id);
    if (on) { p.driving = true; p.driveT = t; p.driveQualified = false; return; }
    if (p.driving && t - p.driveT >= RULES_V2.DRIVE_MIN_T) { p.drives++; p.driveQualified = true; }
    p.driving = false;
  }

  /** True while (or right after) a qualifying drive of the player: the shot counts as a drive finish. */
  isDriveFinish(id, t) {
    const p = this._p(id);
    return (p.driving && t - p.driveT >= RULES_V2.DRIVE_MIN_T) || p.driveQualified;
  }

  /** Clear the "just finished a drive" flag (call when the handler passes or loses the ball). */
  driveReset(id) {
    const p = this._p(id);
    p.driving = false;
    p.driveQualified = false;
  }

  /** An ability was applied / triggered (the `ability` event; `AbilityLog.onPush`). */
  ability(abilityId, id) {
    const p = this._p(id);
    p.abilities[abilityId] = (p.abilities[abilityId] || 0) + 1;
  }

  // ---------------------------------------------------------------- snapshot

  /** Plain-object snapshot in the `game.metrics()` schema (allocates). */
  snapshot() {
    const possessions = new Array(this.possSize);
    for (let i = 0; i < this.possSize; i++) {
      const e = this.poss[(this.possHead - this.possSize + i + this.possCap) % this.possCap];
      possessions[i] = { team: e.team, liveSec: e.liveSec, end: e.end, points: e.points };
    }
    const team = this.team.map((T) => JSON.parse(JSON.stringify(T)));
    const player = {};
    for (const id in this.players) {
      const p = this.players[id];
      const abilities = {};
      for (const a in p.abilities) if (p.abilities[a] > 0) abilities[a] = p.abilities[a];
      player[id] = {
        team: p.team, fga: p.fga, fgm: p.fgm, zone: JSON.parse(JSON.stringify(p.zone)), pa3: p.pa3, pm3: p.pm3, pts: p.pts,
        moves: p.moves, jabs: p.jabs, pumpFakes: p.pumpFakes, postTouches: p.postTouches, touches: p.touches,
        handlerPossessions: p.handlerPossessions, assists: p.assists, drives: p.drives, jumpers: p.jumpers,
        stepbacks: p.stepbacks, catchToPress: p.catchToPress.toArray(), releaseSpeed: p.releaseSpeed.toArray(), abilities,
      };
    }
    const shots = new Array(this.shotSize);
    for (let i = 0; i < this.shotSize; i++) {
      const r = this.shots[(this.shotHead - this.shotSize + i + this.shotCap) % this.shotCap];
      shots[i] = {
        t: r.t, shooter: r.shooter, team: r.team, kind: r.kind, variant: r.variant, zone: r.zone, d: r.d, three: r.three,
        points: r.points, eT: r.eT, X: r.X, C: r.C, p: r.p, make: r.make, scored: r.scored, blockedBy: r.blockedBy,
        releaseSpeed: r.releaseSpeed, catchToPress: r.catchToPress, defDist: r.defDist, urgent: r.urgent, fromDrive: r.fromDrive,
      };
    }
    return { games: this.games, gameSeconds: this.gameSeconds, possessions, team, player, shots };
  }
}
