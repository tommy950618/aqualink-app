// Game orchestration (spec sections 1, 4, 5.8-5.13, 7.4, 8, 14 row 18): the state machine and clocks,
// possession rules, shot / pass / steal / block / catch resolution, stats, captions, audio cues, the
// user-control rules and the debug hooks. Per-step paths reuse module-level scratch objects; the only
// allocations happen at event rate (captions, box-score rows).
import { RIM, BOARD, BALL, SHOT, MOVE, CLOCK, DIFFICULTY, FORMATION, SLOTS, FIXED_DT } from './constants.js';
import { clamp, lerp, lerpAngle, smoothstep, dist2, norm2, SCRATCH, Rng } from './math.js';
import { TEAMS } from './teams.js';
import { Player, clearEdges } from './player.js';
import { Ball } from './ball.js';
import { createHumanoid, createMarker } from './humanoid.js';
import { classifyShot, contestFactor, makeProbability, chooseTarget, meterDuration, greenHalfWidth, shotDistance } from './shot.js';
import { solveArc, apexForDistance, solvePass } from './physics.js';
import { updateAI, assignDefense } from './ai.js';

export const STATES = Object.freeze(['MENU', 'CHECK', 'LIVE', 'DEAD', 'QUARTER_END', 'HALFTIME', 'GAME_OVER']);

const PLAYERS_PER_TEAM = 3;
const SWITCH_COOLDOWN = 0.25;           // section 7.4 defender switch
const STEAL_HUMAN_RANGE = MOVE.STEAL_RANGE;
const STEAL_CPU_RANGE = MOVE.STEAL_CPU_RANGE;
const PASS_LANE_R = 0.8;                // auto-lob: defender this close to the pass line (5.9)
const PASS_LOB_HOLD = 0.30;
const PASS_LEAD = 0.25;                 // receiver velocity lead (s)
const PASS_DIR_MIN_DOT = 0.2;           // joystick-aimed pass needs this much alignment
const CROWD_AIRBALL = 0.3;
const DUNK_BALL_Y = RIM.y + 0.02;       // launched just above the rim plane so the detector fires next step
const DUNK_BALL_VY = -4;
const BLOCK_LIFT_MIN = 2.5, BLOCK_LIFT_RND = 1.5;
const BLOCK_BACK = -0.3;
const BLOCK_REACH = SHOT.RELEASE_Y;      // 2.05 m fingertip reach standing (section 6)
const BLOCK_MAX_GAP = SHOT.BLOCK_HAND_FWD + SHOT.BLOCK_R + SHOT.RELEASE_FWD;   // 1.0 m, see tryBlocks
const STEAL_LAUNCH_SPEED = 2.0, STEAL_LAUNCH_VY = 1.5;
const UNDER_RIM_R = 0.5;                // release point pushed out to here when the hand is inside the rim axis
const BOARD_FRONT_Z = BOARD.max.z + BALL.R + 0.05;   // launch points behind the board move here (z = -12.935)
const BOARD_REACH_X = BOARD.max.x + 0.6;            // ... when inside the board's width plus a ball's reach
const CHECK_BANNER_MS = 1000, PLUS_BANNER_MS = 1200, PERIOD_BANNER_MS = 2500;
const MENU_FORMATION_OFFENSE = 0;
const OOB_HOLD_X = 8.3, OOB_HOLD_Z_MIN = -15.2, OOB_HOLD_Z_MAX = 0.4;   // where a dead ball is held

// Scratch (never allocated per step).
const ARC = { vx: 0, vy: 0, vz: 0, T: 0 };
const TARGET = { x: 0, y: 0, z: 0 };
const CONTEST = { C: 1, defender: null };
const P_HAND = { x: 0, y: 0, z: 0 };
const P_TO = { x: 0, y: 0, z: 0 };
const P_TMP = { x: 0, y: 0, z: 0 };
const V_LAUNCH = { x: 0, y: 0, z: 0 };
const DIR = { x: 0, z: 0 };

const DEAD_SECONDS = { MADE: CLOCK.DEAD.MADE, TURNOVER: CLOCK.DEAD.TURNOVER, OOB: CLOCK.DEAD.OOB, SHOT_CLOCK: CLOCK.DEAD.SHOT_CLOCK };

function silenceIntent(it) {
  it.move.x = 0; it.move.z = 0; it.move.mag = 0;
  it.sprint = false;
  it.primary.held = false; it.primary.heldTime = 0;
  it.secondary.held = false; it.secondary.heldTime = 0;
  it.tertiary.held = false; it.tertiary.heldTime = 0;
  clearEdges(it);
}

function fillHistory(p) {
  const h = p.positionHistory;
  for (let i = 0; i < h.length; i++) { h[i].x = p.pos.x; h[i].z = p.pos.z; }
}

// Planar distance from point (px, pz) to the segment a -> b.
function segmentDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t - px, cz = az + abz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
}

export class Game {
  // { scene, court, arena?, camera? (BroadcastCamera), audio, hud, input, rng, options }
  constructor(deps) {
    const d = deps || {};
    this.scene = d.scene || null;
    this.court = d.court || null;
    this.arena = d.arena || null;
    this.cam = d.camera || null;
    this.audio = d.audio || null;
    this.hud = d.hud || null;
    this.input = d.input || null;
    this.rng = d.rng || new Rng(1);
    this.options = Object.assign({ team: 0, difficulty: 'normal', quarterSeconds: CLOCK.DEFAULT_Q, auto: false, debug: false }, d.options || {});
    this.teams = [TEAMS[0], TEAMS[1]];
    this.roster = [[], []];
    this.players = [];
    for (let ti = 0; ti < 2; ti++) {
      const team = this.teams[ti];
      for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
        const humanoid = createHumanoid(team, i);
        if (this.scene) this.scene.add(humanoid.group);
        const p = new Player({ team, teamIdx: ti, index: i, data: team.players[i], humanoid });
        p.lastStealAt = -1e9;
        p.shotPressTs = 0;
        p.dunkLaunched = false;
        p.passTarget = null;
        this.players.push(p);
        this.roster[ti].push(p);
      }
    }
    this.ball = new Ball(this.scene, this.rng);
    this.marker = createMarker(this.teams[0].jersey);
    this.marker.group.visible = false;
    if (this.scene) this.scene.add(this.marker.group);

    this.score = [0, 0];
    this.difficulty = DIFFICULTY[this.options.difficulty] || DIFFICULTY.normal;
    this.userTeam = this.options.team === 1 ? 1 : 0;
    this.quarterSeconds = this.options.quarterSeconds > 0 ? this.options.quarterSeconds : CLOCK.DEFAULT_Q;
    const self = this;
    this.world = {
      players: this.players, teams: this.teams, ball: this.ball, score: this.score,
      offense: 0, user: this.userTeam, userPlayer: null, controlled: null,
      quarter: 1, gameClock: this.quarterSeconds, shotClock: CLOCK.SHOT,
      state: 'MENU', deadReason: null, difficulty: this.difficulty, rng: this.rng, time: 0,
      auto: !!this.options.auto, paused: false, rimXZ: RIM, slots: SLOTS, game: this,
      isUserControlled(p) { return !self.world.auto && p === self.world.controlled; },
    };
    this.paused = false;
    this.resuming = false;
    this.resumeT = 0;
    this.resumeShown = -1;
    this.stateT = 0;
    this.deadT = 0;
    this.nextOffense = 0;
    this.q1Offense = 0;
    this.periodOpen = 0;
    this.possessionCount = 0;
    this.switchCd = 0;
    this.lastShotSec = CLOCK.SHOT;
    this.buzzerPending = false;
    this.buzzerLooseT = 0;
    this.freeRestT = 0;                    // section 5.13 rest rescue, at any height (board top, rim)
    this.netT = -1;
    this.renderTime = 0;
    this.meterShown = false;
    this.ballCtx = 'none';                 // 'shot' | 'pass' | 'steal' | 'none': what the free ball is
    this.stealVictim = null;               // handler robbed by the current 'steal' loose ball (0.3 s catch exclusion)
    this.shot = { pending: false, make: false, e: 0, kind: 'jumper', shooter: null, bank: false, missCaptioned: false };
    this.debugShot = { active: false, player: null, p: null, e: null };
    this.listeners = Object.create(null);
    this.ballEvents = [];
    this.checkFrom = new Array(this.players.length);
    this.checkTo = new Array(this.players.length);
    for (let i = 0; i < this.players.length; i++) { this.checkFrom[i] = { x: 0, z: 0, yaw: 0 }; this.checkTo[i] = { x: 0, z: 0, yaw: 0 }; }
    this.edgeSeen = { primaryP: -1, primaryR: -1, secondaryP: -1, secondaryR: -1, tertiaryP: -1, tertiaryR: -1 };
    this.debug = {
      invariantsBroken: 0,
      teleport: (i, x, z) => this.teleport(i, x, z),
      debugShoot: (o) => this.debugShoot(o),
      setClock: (o) => this.setClock(o),
      turnover: () => this.turnover(),
      fastForward: (sec) => this.fastForward(sec),
    };
    this.setControlled(this.roster[this.userTeam][0]);
    this.placeFormation(MENU_FORMATION_OFFENSE, this.roster[MENU_FORMATION_OFFENSE][0], true);
  }

  // ---------------------------------------------------------------- accessors

  get state() { return this.world.state; }
  get deadReason() { return this.world.deadReason; }
  get controlled() { return this.world.controlled; }
  get userPlayer() { return this.world.userPlayer; }
  get quarter() { return this.world.quarter; }
  get gameClock() { return this.world.gameClock; }
  get shotClock() { return this.world.shotClock; }
  userIsOffense() { return this.world.offense === this.world.user; }
  isUserControlled(p) { return this.world.isUserControlled(p); }

  on(evt, cb) {
    if (typeof cb !== 'function') return () => {};
    (this.listeners[evt] || (this.listeners[evt] = [])).push(cb);
    return () => { const l = this.listeners[evt]; const i = l ? l.indexOf(cb) : -1; if (i >= 0) l.splice(i, 1); };
  }

  emit(evt, a, b) {
    const l = this.listeners[evt];
    if (!l) return;
    for (let i = 0; i < l.length; i++) {
      try { l[i](a, b); } catch (err) { /* a listener must never break the simulation */ }
    }
  }

  caption(key, player) {
    if (!this.hud) return;
    this.hud.caption(key, player ? { name: player.data ? player.data.name : '' } : null);
  }

  banner(key, params, ms) { if (this.hud) this.hud.banner(key, params, ms); }
  playerName(p) { return p && p.data ? p.data.name : null; }

  // ---------------------------------------------------------------- lifecycle

  // options: { team: 0|1, difficulty, quarter | quarterSeconds (s), auto? }
  start(options) {
    const o = this.options;
    if (options) {
      for (const k in options) if (options[k] !== undefined) o[k] = options[k];
    }
    if (options && options.quarterSeconds === undefined && options.quarter > 0) o.quarterSeconds = options.quarter;
    this.userTeam = o.team === 1 ? 1 : 0;
    this.setDifficulty(o.difficulty);
    this.quarterSeconds = o.quarterSeconds > 0 ? o.quarterSeconds : CLOCK.DEFAULT_Q;
    const w = this.world;
    w.user = this.userTeam;
    w.auto = !!o.auto;
    this.score[0] = 0; this.score[1] = 0;
    for (let i = 0; i < this.players.length; i++) this.players[i].resetStats();
    w.quarter = 1;
    w.gameClock = this.quarterSeconds;
    w.shotClock = CLOCK.SHOT;
    w.time = 0;
    this.possessionCount = 0;
    this.paused = false; w.paused = false; this.resuming = false;
    this.q1Offense = this.rng.int(2);
    this.periodOpen = this.q1Offense;
    this.setControlled(this.roster[this.userTeam][0]);
    if (this.hud) this.hud.showMenu(null);
    if (this.cam) this.cam.requestSnap();
    this.enterCheck(this.q1Offense);
    return this;
  }

  setDifficulty(id) {
    this.difficulty = DIFFICULTY[id] || DIFFICULTY.normal;
    this.options.difficulty = this.difficulty.id;
    this.world.difficulty = this.difficulty;
  }

  rematch() { return this.start(null); }

  quit() {
    const w = this.world;
    this.paused = false; w.paused = false; this.resuming = false;
    this.buzzerPending = false;
    this.shot.pending = false; this.ballCtx = 'none';
    this.setState('MENU');
    this.banner(null);
    this.placeFormation(MENU_FORMATION_OFFENSE, this.roster[MENU_FORMATION_OFFENSE][0], true);
    this.marker.group.visible = false;
    if (this.hud) this.hud.showMenu('main');
  }

  pause() {
    const s = this.world.state;
    if (s === 'MENU' || s === 'GAME_OVER') return false;
    if (this.paused && !this.resuming) return true;
    this.paused = true; this.world.paused = true;
    this.resuming = false;
    this.banner(null);
    if (this.hud) this.hud.showMenu('pause');
    if (this.input) this.input.setEnabled(false);
    return true;
  }

  // Section 8: resume shows a 1.0 s countdown before the clocks run; paused stays true meanwhile.
  resume() {
    if (!this.paused || this.resuming) return false;
    this.resuming = true;
    this.resumeT = CLOCK.RESUME_COUNTDOWN;
    this.resumeShown = -1;
    if (this.hud) this.hud.showMenu(this.world.state === 'HALFTIME' ? 'halftime' : null);
    if (this.input) this.input.setEnabled(true);
    return true;
  }

  togglePause() { return this.paused ? this.resume() : this.pause(); }

  skipHalftime() {
    if (this.world.state === 'HALFTIME' && !this.paused) this.nextQuarter();
  }

  setState(s) {
    const w = this.world;
    if (w.state === s) return;
    w.state = s;
    this.stateT = 0;
    this.emit('state', s);
  }

  // ---------------------------------------------------------------- control

  setControlled(p) {
    const w = this.world;
    const old = w.controlled;
    if (old === p) return;
    if (old) { silenceIntent(old.intent); old.marker = null; }
    w.controlled = p;
    w.userPlayer = p;
    // Only a human-driven player is exempt from the AI court clamp (section 5.10); in auto mode the
    // 'user' player is AI-driven too and must be clamped like the rest, or it dribbles out of bounds.
    const human = !w.auto;
    for (let i = 0; i < this.players.length; i++) this.players[i].isUser = human && this.players[i] === p;
    if (p) {
      p.marker = this.marker;
      this.marker.setColor(p.teamData.jersey);
    }
    this.switchCd = SWITCH_COOLDOWN;
  }

  // Section 7.4: the defender nearest the ball, excluding the current one.
  switchDefender() {
    const w = this.world;
    if (this.userIsOffense() || this.switchCd > 0) return null;
    const cur = w.controlled;
    const mates = this.roster[this.userTeam];
    let best = null, bestD = Infinity;
    for (let i = 0; i < mates.length; i++) {
      const p = mates[i];
      if (p === cur) continue;
      const d = dist2(p.pos.x, p.pos.z, this.ball.pos.x, this.ball.pos.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) this.setControlled(best);
    return best;
  }

  // ---------------------------------------------------------------- possession / CHECK

  // Opening possession for a period (section 1 table).
  openingPossession(q) {
    const q1 = this.q1Offense;
    if (q === 1) return q1;
    if (q === 2 || q === 3) return 1 - q1;
    if (q === 4) return q1;
    return 1 - this.periodOpen;
  }

  // Computes the CHECK formation for `offense` with `handler` on the ball into checkTo[] and, when
  // `snap` is set, moves everyone there at once (menu backdrop, NaN recovery).
  placeFormation(offense, handler, snap) {
    const ps = this.players;
    let mate = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], to = this.checkTo[i];
      if (p.team === offense) {
        if (p === handler) { to.x = FORMATION.HANDLER.x; to.z = FORMATION.HANDLER.z; }
        else { const s = FORMATION.TEAMMATES[mate++ % FORMATION.TEAMMATES.length]; to.x = s.x; to.z = s.z; }
        to.yaw = FORMATION.OFFENSE_YAW;
      }
    }
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], to = this.checkTo[i];
      if (p.team === offense) continue;
      let att = null;
      for (let j = 0; j < ps.length; j++) if (ps[j].team === offense && ps[j].index === p.index) { att = this.checkTo[j]; break; }
      if (!att) att = this.checkTo[this.players.indexOf(handler)];
      to.x = lerp(att.x, RIM.x, FORMATION.DEF_LERP);
      to.z = lerp(att.z, RIM.z, FORMATION.DEF_LERP);
      to.yaw = FORMATION.DEFENSE_YAW;
    }
    if (snap) {
      for (let i = 0; i < ps.length; i++) { const to = this.checkTo[i]; ps[i].reset(to.x, to.z, to.yaw); silenceIntent(ps[i].intent); }
      this.ball.attachTo(handler, 'held');
    }
  }

  enterCheck(offense) {
    const w = this.world;
    w.offense = offense;
    w.shotClock = Math.min(CLOCK.SHOT, Math.max(w.gameClock, FIXED_DT));
    w.deadReason = null;
    this.lastShotSec = Math.ceil(w.shotClock - 1e-4);
    this.possessionCount++;
    this.buzzerPending = false;
    this.buzzerLooseT = 0;
    this.shot.pending = false;
    this.ballCtx = 'none';
    this.debugShot.active = false;
    let handler;
    if (this.userTeam === offense && w.controlled && w.controlled.team === offense) handler = w.controlled;
    else handler = this.roster[offense][this.possessionCount % PLAYERS_PER_TEAM];
    this.placeFormation(offense, handler, false);
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], from = this.checkFrom[i];
      p.reset(p.pos.x, p.pos.z, p.yaw);     // clears jumps, stuns, cross bursts; keeps stats/stamina
      silenceIntent(p.intent);
      p.passTarget = null;
      p.dunkLaunched = false;
      from.x = p.pos.x; from.z = p.pos.z; from.yaw = p.yaw;
      p.offense = p.team === offense;
      p.defAssign = null;
    }
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.team === offense) continue;
      for (let j = 0; j < ps.length; j++) if (ps[j].team === offense && ps[j].index === p.index) { p.defAssign = ps[j]; break; }
    }
    this.ball.attachTo(handler, 'held');
    if (this.userTeam === offense) this.setControlled(handler);
    else {
      let def = null;
      for (let i = 0; i < ps.length; i++) if (ps[i].team !== offense && ps[i].defAssign === handler) { def = ps[i]; break; }
      this.setControlled(def || this.roster[this.userTeam][0]);
    }
    assignDefense(w, false);
    if (this.input) this.input.setOffense(this.userIsOffense());
    this.marker.group.visible = true;
    this.setState('CHECK');
    this.banner('banner.check', null, CHECK_BANNER_MS);
    this.emit('possession', offense, handler);
  }

  goLive() {
    const w = this.world;
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], to = this.checkTo[i];
      p.reset(to.x, to.z, to.yaw);
      p.offense = p.team === w.offense;
    }
    const handler = this.ball.owner || this.roster[w.offense][0];
    this.ball.attachTo(handler, 'held');
    this.setState('LIVE');
  }

  // Any dead ball: reason (MADE|TURNOVER|OOB|SHOT_CLOCK), the team that gets the next possession.
  deadBall(reason, nextOffense, seconds) {
    const w = this.world;
    if (w.state !== 'LIVE' && w.state !== 'DEAD') return;
    w.deadReason = reason;
    this.deadT = seconds > 0 ? seconds : (DEAD_SECONDS[reason] || CLOCK.DEAD.TURNOVER);
    this.nextOffense = nextOffense === 1 ? 1 : 0;
    this.shot.pending = false;
    this.debugShot.active = false;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      silenceIntent(p.intent);
      // The whistle stops everyone on the ground (a crossover burst would otherwise carry the
      // holder, and the held ball, metres past the line during the dead-ball timer).
      if (p.state === 'cross') { p.state = 'idle'; p.crossT = 0; }
      if (!p.isJumping && p.state !== 'dunk') p.vel.set(0, 0, 0);
    }
    if (w.offense !== this.nextOffense) {
      w.offense = this.nextOffense;
      if (this.input) this.input.setOffense(this.userIsOffense());
      this.emit('possession', w.offense, null);
    }
    this.setState('DEAD');
    this.emit('dead', reason, w.offense);
  }

  changePossession(reason) {
    const r = reason && DEAD_SECONDS[reason] ? reason : 'TURNOVER';
    this.deadBall(r, 1 - this.world.offense, DEAD_SECONDS[r]);
  }

  // ---------------------------------------------------------------- periods

  onGameClockZero() {
    const w = this.world;
    w.gameClock = 0;
    if (this.audio) this.audio.buzzer();
    const bs = this.ball.state;
    if (bs === 'flight' || bs === 'scored') { this.buzzerPending = true; this.buzzerLooseT = 0; }
    else this.endPeriod();
  }

  endPeriod() {
    const w = this.world;
    this.buzzerPending = false;
    this.shot.pending = false;
    this.ballCtx = 'none';
    this.debugShot.active = false;
    for (let i = 0; i < this.players.length; i++) silenceIntent(this.players[i].intent);
    this.setState('QUARTER_END');
    const q = w.quarter, tied = this.score[0] === this.score[1];
    if (q >= CLOCK.QUARTERS && !tied) this.banner('banner.final', null, PERIOD_BANNER_MS);
    else if (q >= CLOCK.QUARTERS) this.banner('banner.overtime', null, PERIOD_BANNER_MS);
    else this.banner('banner.quarterEnd', { n: q }, PERIOD_BANNER_MS);
  }

  advancePeriod() {
    const w = this.world;
    const q = w.quarter, tied = this.score[0] === this.score[1];
    if (q === 2) {
      this.setState('HALFTIME');
      if (this.hud) this.hud.showMenu('halftime', { score: this.score });
    } else if (q >= CLOCK.QUARTERS && !tied) {
      this.gameOver();
    } else {
      this.nextQuarter();
    }
  }

  nextQuarter() {
    const w = this.world;
    if (w.state === 'HALFTIME' && this.hud) this.hud.showMenu(null);
    w.quarter++;
    w.gameClock = w.quarter > CLOCK.QUARTERS ? CLOCK.OT : this.quarterSeconds;
    this.periodOpen = this.openingPossession(w.quarter);
    this.enterCheck(this.periodOpen);
  }

  gameOver() {
    const w = this.world;
    this.setState('GAME_OVER');
    this.marker.group.visible = false;
    const winner = this.score[0] === this.score[1] ? null : (this.score[0] > this.score[1] ? 0 : 1);
    const rows = [];
    for (let ti = 0; ti < 2; ti++) {
      for (let i = 0; i < PLAYERS_PER_TEAM; i++) {
        const p = this.roster[ti][i], s = p.stats;
        rows.push({ name: p.data.name, pts: s.pts, fgm: s.fgm, fga: s.fga, tpm: s.tpm, reb: s.reb, stl: s.stl, blk: s.blk, team: ti });
      }
    }
    this.banner(null);
    if (this.hud) this.hud.showMenu('over', { winner, score: this.score, rows });
    this.emit('gameover', winner, this.score);
  }

  // ---------------------------------------------------------------- simulation step

  // Section 14.1 order: clocks + state machine, AI, user intent, Player.step, Ball.step, events.
  step(dt) {
    const w = this.world;
    if (this.paused) { this.stepPaused(dt); return; }
    const s = w.state;
    if (s === 'MENU') return;
    w.time += dt;
    this.stateT += dt;
    if (this.switchCd > 0) this.switchCd -= dt;

    if (s === 'CHECK') { this.stepCheck(dt); return; }
    if (s === 'HALFTIME') { if (this.stateT >= CLOCK.HALFTIME) this.nextQuarter(); return; }
    if (s === 'GAME_OVER') return;
    if (s === 'QUARTER_END') {
      if (this.stateT >= CLOCK.QUARTER_END) { this.advancePeriod(); return; }
    } else if (s === 'DEAD') {
      this.deadT -= dt;
      if (this.deadT <= 0) {
        if (w.gameClock <= 0) this.endPeriod(); else this.enterCheck(this.nextOffense);
        return;
      }
    } else {
      this.stepClocks(dt);
      if (w.state !== 'LIVE') return;
    }

    updateAI(w, dt);
    const live = w.state === 'LIVE';
    this.applyInput();                       // the human may reposition during a dead ball too
    if (live) this.processIntents();         // shots, passes, switches and steals only while live
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) ps[i].step(dt, w);
    Player.resolveSeparation(ps);
    if (live) this.afterPlayerStep();
    const ball = this.ball;
    const events = ball.step(dt, w, this.ballEvents);
    for (let i = 0; i < events.length; i++) this.resolveBallEvent(events[i]);
    if (w.state === 'LIVE') {
      this.tryBlocks();
      this.resolveCatch();
      this.stepRest(dt);
    }
    this.checkInvariants();
  }

  stepPaused(dt) {
    if (!this.resuming) return;
    this.resumeT -= dt;
    const n = Math.max(1, Math.ceil(this.resumeT - 1e-6));
    if (this.resumeT > 0) {
      if (n !== this.resumeShown) { this.resumeShown = n; this.banner('banner.resume', { n }, 1500); }
      return;
    }
    this.resuming = false;
    this.paused = false; this.world.paused = false;
    this.banner(null);
  }

  // Section 8: 0.8 s smoothstep tween into the formation, LIVE after 1.2 s.
  stepCheck(dt) {
    const ps = this.players;
    const k = smoothstep(Math.min(this.stateT / FORMATION.TWEEN_T, 1));
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], from = this.checkFrom[i], to = this.checkTo[i];
      p.prevPos.copy(p.pos);
      p.prevYaw = p.yaw;
      p.prevJumpY = p.jumpY;
      p.time += dt;
      p.pos.x = lerp(from.x, to.x, k);
      p.pos.z = lerp(from.z, to.z, k);
      p.yaw = lerpAngle(from.yaw, to.yaw, k);
      fillHistory(p);
    }
    const ball = this.ball;
    ball.prevPos.copy(ball.pos);
    if (ball.owner) ball.placeOnOwner();
    if (this.stateT >= CLOCK.CHECK) this.goLive();
  }

  stepClocks(dt) {
    const w = this.world;
    if (this.buzzerPending) { this.stepBuzzer(dt); return; }
    w.gameClock -= dt;
    if (w.gameClock <= 0) { this.onGameClockZero(); return; }
    w.shotClock -= dt;
    if (w.shotClock > w.gameClock) w.shotClock = w.gameClock;   // the shot clock never outlives the period
    if (w.shotClock < 0) w.shotClock = 0;
    const sec = Math.ceil(w.shotClock - 1e-4);
    if (sec !== this.lastShotSec) {
      if (sec < this.lastShotSec && sec < CLOCK.TICK_BELOW && this.audio) this.audio.tick();
      this.lastShotSec = sec;
    }
    if (w.shotClock <= 0) {
      const bs = this.ball.state;
      const shotLive = bs === 'flight' || bs === 'scored' || (this.ballCtx === 'shot' && bs === 'loose');
      if (!shotLive) this.shotClockViolation();
    }
  }

  shotClockViolation() {
    const w = this.world;
    if (this.audio) this.audio.buzzer();
    this.caption('cap.shotClock', null);
    this.emit('turnover', 'SHOT_CLOCK', w.offense);
    this.deadBall('SHOT_CLOCK', 1 - w.offense, CLOCK.DEAD.SHOT_CLOCK);
  }

  // After the buzzer with a shot in the air: wait for the make, or 0.5 s of LOOSE, or a catch.
  stepBuzzer(dt) {
    const bs = this.ball.state;
    if (bs === 'flight' || bs === 'scored') { this.buzzerLooseT = 0; return; }
    if (bs === 'loose') { this.buzzerLooseT += dt; if (this.buzzerLooseT < CLOCK.BUZZER_LOOSE) return; }
    this.endPeriod();
  }

  // Section 5.13 at any height: a free ball slower than 0.2 m/s for 1.5 s (e.g. resting on the
  // backboard top, where Ball's floor-only rest rule cannot fire) is rescued like an out of bounds.
  stepRest(dt) {
    const ball = this.ball;
    if (!ball.isFree) { this.freeRestT = 0; return; }
    const v = ball.vel;
    if (v.x * v.x + v.y * v.y + v.z * v.z < BALL.RESCUE_SPEED * BALL.RESCUE_SPEED) {
      this.freeRestT += dt;
      if (this.freeRestT >= CLOCK.REST_RESCUE) { this.freeRestT = 0; this.onOutOfBounds(ball.lastToucher, 'REST'); }
    } else this.freeRestT = 0;
  }

  // Copies the human intent into the controlled player (skipped in auto mode). Edges are consumed
  // once per DOM timestamp so a fastForward() burst without sample() cannot repeat a press.
  applyInput() {
    const w = this.world, input = this.input;
    if (w.auto || !input || !w.controlled) return;
    const src = input.intent, dst = w.controlled.intent, seen = this.edgeSeen;
    dst.move.x = src.move.x; dst.move.z = src.move.z; dst.move.mag = src.move.mag;
    dst.sprint = src.sprint;
    this.copyButton(dst.primary, src.primary, 'primaryP', 'primaryR', seen);
    this.copyButton(dst.secondary, src.secondary, 'secondaryP', 'secondaryR', seen);
    this.copyButton(dst.tertiary, src.tertiary, 'tertiaryP', 'tertiaryR', seen);
    if (src.pause.justPressed) { src.pause.justPressed = false; this.togglePause(); }
  }

  copyButton(dst, src, kp, kr, seen) {
    dst.held = src.held;
    dst.heldTime = src.heldTime;
    dst.pressTs = src.pressTs;
    dst.releaseTs = src.releaseTs;
    let jp = src.justPressed, jr = src.justReleased;
    if (jp && src.pressTs > 0) { if (seen[kp] === src.pressTs) jp = false; else seen[kp] = src.pressTs; }
    if (jr && src.releaseTs > 0) { if (seen[kr] === src.releaseTs) jr = false; else seen[kr] = src.releaseTs; }
    dst.justPressed = jp;
    dst.justReleased = jr;
  }

  // Shots, passes, switches and steals for every player (human and CPU share this path).
  processIntents() {
    const w = this.world, ps = this.players, ball = this.ball;
    const offense = w.offense;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i], it = p.intent;
      if (p.team === offense) {
        if (p.hasBall && ball.owner === p) {
          this.processShot(p, it);
          if (p.hasBall && p.canAct && (it.secondary.justReleased || (it.secondary.justPressed && !it.secondary.held))) {
            const target = this.resolvePassTarget(p);
            if (target) this.pass(p, target, it.secondary.heldTime >= PASS_LOB_HOLD);
          }
        } else if ((p.state === 'windup' || p.state === 'layup') && !p.released) {
          this.processShot(p, it);
        }
      } else {
        const user = this.isUserControlled(p);
        if (user && it.secondary.justPressed) this.switchDefender();
        if (it.tertiary.justPressed) this.trySteal(p, !user);
      }
    }
  }

  // Section 4: classify at press, meter from the DOM timestamps, release on justReleased / f = 1.25.
  processShot(p, it) {
    const w = this.world;
    const st = p.state;
    if (st === 'windup' || st === 'layup') {
      if (p.released) return;
      if (!p.hasBall || this.ball.owner !== p) { p.release(); return; }   // lost the ball mid-windup: finish the jump empty-handed
      const meterT = meterDuration(p.shotKind);
      const dbg = this.debugShot;
      let f = -1, force;
      if (dbg.active && dbg.player === p) {
        const e = typeof dbg.e === 'number' ? dbg.e : 0;
        if (p.windupT >= (SHOT.F_IDEAL + e) * meterT || p.meterF >= SHOT.F_MAX) {
          f = SHOT.F_IDEAL + e;
          force = typeof dbg.p === 'number' ? dbg.p : undefined;
          dbg.active = false;
        }
      } else if (it.primary.justReleased) {
        const b = it.primary;
        f = b.releaseTs > b.pressTs && b.pressTs > 0 ? (b.releaseTs - b.pressTs) / 1000 / meterT : p.windupT / meterT;
      } else if (!it.primary.held) {
        f = p.windupT / meterT;              // the release edge was lost (menu opened, control moved)
      } else if (p.meterF >= SHOT.F_MAX) {
        f = SHOT.F_MAX;
      }
      if (f >= 0) this.shoot(p, clamp(f, 0, SHOT.F_MAX) - SHOT.F_IDEAL, p.shotKind, force);
      return;
    }
    if (st === 'dunk') return;
    if (!p.canAct || !p.hasBall || !it.primary.justPressed) return;
    this.startShot(p, it.primary.pressTs);
  }

  startShot(p, pressTs) {
    const w = this.world;
    const kind = classifyShot(p, w);
    p.shotPressTs = pressTs > 0 ? pressTs : nowMs();
    if (kind === 'dunk') {
      p.startDunk();
      p.dunkLaunched = false;
    } else {
      p.startWindup(kind);
    }
    this.emit('shot', kind, p);
    return kind;
  }

  // Section 4.3-4.5: roll the make, pick the target, solve the arc, launch. `force` overrides the
  // probability (number in [0,1], or true/false).
  shoot(p, e, kind, force) {
    const w = this.world, rng = this.rng;
    kind = kind || p.shotKind || classifyShot(p, w);
    const d = shotDistance(p, w);
    contestFactor(p, w, CONTEST);
    const gBase = this.difficulty.userGreen;
    const rating = p.data && p.data.shooting > 0 ? p.data.shooting : 1;
    let prob = makeProbability(kind, d, e, CONTEST.C, p.stamina, p.speed, rating, gBase);
    let make;
    if (typeof force === 'number') { prob = clamp(force, 0, 1); make = rng.next() < prob; }
    else if (force === true) make = true;
    else if (force === false) make = false;
    else make = kind === 'dunk' ? true : rng.next() < prob;
    const g = greenHalfWidth(kind, gBase);
    p.handPoint(P_HAND);
    // A shooter carried under the rim (sprint momentum through the windup) reaches around it: the
    // ball leaves from 0.5 m outside the rim axis so it rises past the ring instead of into it.
    // A hand behind the backboard plane (a drive that ran under the hoop) reaches around to the
    // front of the board first: launched from behind it, the arc hits the board's underside from
    // below, so even a shot rolled as a make was lost.
    if (P_HAND.z < BOARD_FRONT_Z && Math.abs(P_HAND.x - RIM.x) < BOARD_REACH_X) P_HAND.z = BOARD_FRONT_Z;
    let ux = P_HAND.x - RIM.x, uz = P_HAND.z - RIM.z;
    const ud = Math.sqrt(ux * ux + uz * uz);
    if (ud < UNDER_RIM_R) {
      if (ud > 1e-6) { ux /= ud; uz /= ud; } else { ux = Math.sin(p.yaw); uz = Math.cos(p.yaw); }
      P_HAND.x = RIM.x + ux * UNDER_RIM_R;
      P_HAND.z = RIM.z + uz * UNDER_RIM_R;
    }
    chooseTarget(make, e, CONTEST.C, kind, p.pos, rng, TARGET, g);
    solveArc(P_HAND, TARGET, apexForDistance(d), BALL.G, ARC);
    const points = kind === 'three' ? 3 : 2;
    this.ball.launch(ARC, 'flight', { shooter: p, releaseTime: w.time, points, kind }, P_HAND);
    p.release();
    p.stats.fga++;
    const shot = this.shot;
    shot.pending = true; shot.make = make; shot.e = e; shot.kind = kind; shot.shooter = p; shot.bank = false; shot.missCaptioned = false;
    this.ballCtx = 'shot';
    if (this.isUserControlled(p) && this.hud) {
      this.hud.setMeter(e + SHOT.F_IDEAL, g, false, 0, 0);
      this.hud.flashMeter(Math.abs(e) <= g ? 'perfect' : (e < 0 ? 'early' : 'late'));
      this.meterShown = false;
    }
    if (!make && e < SHOT.AIRBALL_E && kind !== 'layup') {
      shot.missCaptioned = true;
      this.caption('cap.airball', p);
      if (this.audio) { this.audio.groan(); this.audio.crowd(CROWD_AIRBALL, 1.0); }
      this.emit('airball', e, p);
    }
    this.emit('release', kind, p);
    this.emit(make ? 'make' : 'miss', prob, p);
    return make;
  }

  // Section 4.6: at t = 0.42 the dunked ball drops through the rim from the raised hands.
  stepDunks() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.state !== 'dunk' || p.dunkLaunched || !p.hasBall || p.dunkT < SHOT.DUNK_BALL_T) continue;
      p.dunkLaunched = true;
      V_LAUNCH.x = 0; V_LAUNCH.y = DUNK_BALL_VY; V_LAUNCH.z = 0;
      P_TMP.x = RIM.x; P_TMP.y = DUNK_BALL_Y; P_TMP.z = RIM.z;
      this.ball.launch(V_LAUNCH, 'flight', { shooter: p, releaseTime: this.world.time, points: 2, kind: 'dunk' }, P_TMP);
      p.released = true;
      p.stats.fga++;
      const shot = this.shot;
      shot.pending = true; shot.make = true; shot.e = 0; shot.kind = 'dunk'; shot.shooter = p; shot.bank = false; shot.missCaptioned = true;
      this.ballCtx = 'shot';
      this.emit('release', 'dunk', p);
    }
  }

  // Crossover freezes (5.12) and dunk launches, evaluated once the players have moved.
  afterPlayerStep() {
    const w = this.world, ps = this.players, rng = this.rng;
    for (let i = 0; i < ps.length; i++) {
      const h = ps[i];
      if (!h.crossJustStarted) continue;
      const cpuHandler = !this.isUserControlled(h);
      for (let j = 0; j < ps.length; j++) {
        const d = ps[j];
        if (d.team === h.team) continue;
        if (dist2(d.pos.x, d.pos.z, h.pos.x, h.pos.z) > MOVE.CROSS_FREEZE_R) continue;
        const prob = cpuHandler && this.isUserControlled(d) ? this.difficulty.crossFreeze : MOVE.CROSS_FREEZE_P;
        if (rng.next() < prob) d.stun(MOVE.CROSS_FREEZE_T);
      }
    }
    this.stepDunks();
  }

  // ---------------------------------------------------------------- passes

  resolvePassTarget(p) {
    const w = this.world;
    const t = p.passTarget;
    if (t && t !== p && t.team === p.team && t.pos) return t;
    const mates = this.roster[p.team];
    // Human: aim with the joystick when it is deflected.
    const m = p.intent.move;
    if (this.isUserControlled(p) && m.mag > 0.3) {
      let best = null, bestDot = PASS_DIR_MIN_DOT;
      for (let i = 0; i < mates.length; i++) {
        const q = mates[i];
        if (q === p) continue;
        norm2(DIR, q.pos.x - p.pos.x, q.pos.z - p.pos.z);
        const dot = DIR.x * m.x + DIR.z * m.z;
        if (dot > bestDot) { bestDot = dot; best = q; }
      }
      if (best) return best;
    }
    // The user's CPU teammate gives the ball back; otherwise the most open teammate.
    if (p.team === w.user && w.userPlayer && w.userPlayer !== p && !w.auto) return w.userPlayer;
    let best = null, bestOpen = -1;
    for (let i = 0; i < mates.length; i++) {
      const q = mates[i];
      if (q === p) continue;
      let open = Infinity;
      for (let j = 0; j < this.players.length; j++) {
        const o = this.players[j];
        if (o.team === p.team) continue;
        const d = dist2(o.pos.x, o.pos.z, q.pos.x, q.pos.z);
        if (d < open) open = d;
      }
      if (open > bestOpen) { bestOpen = open; best = q; }
    }
    return best;
  }

  laneBlocked(a, b) {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const o = ps[i];
      if (o.team === a.team) continue;
      if (segmentDist(o.pos.x, o.pos.z, a.pos.x, a.pos.z, b.pos.x, b.pos.z) < PASS_LANE_R) return true;
    }
    return false;
  }

  // Section 5.9. Chest pass (or lob) from the passer's chest to the receiver's led chest point.
  pass(from, to, lob) {
    if (!from || !to || to === from || to.team !== from.team) return false;
    if (!from.hasBall || this.ball.owner !== from || from.isJumping || from.state === 'dunk' || from.state === 'stunned') return false;
    from.chestPoint(P_HAND);
    to.chestPoint(P_TO);
    P_TO.x += to.vel.x * PASS_LEAD;
    P_TO.z += to.vel.z * PASS_LEAD;
    P_TO.y = BALL.CHEST_Y;
    if (!lob && to.cutting && this.laneBlocked(from, to)) lob = true;
    solvePass(P_HAND, P_TO, !!lob, ARC);
    this.ball.launch(ARC, 'pass', { receiver: to, from }, P_HAND);
    from.passTarget = null;
    this.shot.pending = false;
    this.ballCtx = 'pass';
    this.emit('pass', to, from);
    return true;
  }

  // ---------------------------------------------------------------- steals / blocks

  // Section 5.11. cpu = true uses the difficulty's stealRate and the 1.5 s attempt interval.
  trySteal(p, cpu) {
    const w = this.world, ball = this.ball, h = ball.owner;
    if (cpu && w.time - p.lastStealAt < MOVE.STEAL_CPU_INTERVAL) return false;
    const range = cpu ? STEAL_CPU_RANGE : STEAL_HUMAN_RANGE;
    // The handler must be dribbling: ball.state still reads 'dribble' on the step of a shot press
    // (Ball.step flips it to 'held' later in the same step), so the shooter's own state is tested too.
    const valid = h && h.team !== p.team && ball.state === 'dribble' && h.state !== 'cross' && h.crossT <= 0
      && !h.isJumping && h.state !== 'windup' && h.state !== 'layup' && h.state !== 'dunk'
      && dist2(p.pos.x, p.pos.z, h.pos.x, h.pos.z) < range;
    if (!p.startSteal()) return false;        // reach animation + 0.7 s cooldown
    if (!valid) return false;
    p.lastStealAt = w.time;
    const bonus = (h.dribbleY < MOVE.STEAL_LOW_Y ? MOVE.STEAL_LOW_BONUS : 0) + (h.speed < MOVE.STEAL_SLOW_SPEED ? MOVE.STEAL_SLOW_BONUS : 0);
    // CPU: stealRate 'x the same bonuses', read as relative factors (+20 % low ball, +15 % slow handler:
    // normal 0.18 -> at most 0.24 per attempt). Scaling them proportionally to the human base (0.47 on
    // normal) ended 30 % of all possessions in steals.
    let prob = cpu ? this.difficulty.stealRate * (1 + bonus) : MOVE.STEAL_BASE + bonus;
    prob *= p.data && p.data.defense > 0 ? p.data.defense : 1;
    if (this.rng.next() < prob) {
      norm2(DIR, p.pos.x - h.pos.x, p.pos.z - h.pos.z);
      V_LAUNCH.x = DIR.x * STEAL_LAUNCH_SPEED; V_LAUNCH.y = STEAL_LAUNCH_VY; V_LAUNCH.z = DIR.z * STEAL_LAUNCH_SPEED;
      ball.launch(V_LAUNCH, 'loose', { toucher: p });
      this.ballCtx = 'steal';
      this.stealVictim = h;
      this.shot.pending = false;
      p.stats.stl++;
      this.caption('cap.steal', p);
      this.emit('steal', h, p);
      return true;
    }
    p.stun(MOVE.STUN_STEAL_FAIL);
    return false;
  }

  // Section 4.7: a jumping defender's hand point within 0.40 m of a fresh shot deflects it.
  // H = feet + facing*0.35 + (0, reach + jumpY, 0) with reach = 2.05 (section 6: "standing reach with
  // hand ~ 2.05 + jump 0.75 = 2.8 m"); the 2.55 quoted in 4.7 sits 0.5 m above the model's fingertips.
  // A block also needs the defender within arm's length of the shooter (hand offset 0.35 + radius
  // 0.40 + release offset 0.25 = 1.0 m): the CPU on-ball defender stands at exactly defGap with a
  // reaction-timed jump, and without this cutoff every contested jumper was blocked instead of
  // merely contested (section 4.3, C *= 0.8).
  tryBlocks() {
    const w = this.world, ball = this.ball;
    if (ball.state !== 'flight' || ball.releaseAge >= SHOT.BLOCK_WINDOW) return;
    const shooter = this.shot.shooter;
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const d = ps[i];
      if (d.team === w.offense || !d.isJumping) continue;
      if (shooter && dist2(d.pos.x, d.pos.z, shooter.pos.x, shooter.pos.z) >= BLOCK_MAX_GAP) continue;
      P_TMP.x = d.pos.x + Math.sin(d.yaw) * SHOT.BLOCK_HAND_FWD;
      P_TMP.z = d.pos.z + Math.cos(d.yaw) * SHOT.BLOCK_HAND_FWD;
      P_TMP.y = BLOCK_REACH + d.jumpY;
      const dx = ball.pos.x - P_TMP.x, dy = ball.pos.y - P_TMP.y, dz = ball.pos.z - P_TMP.z;
      if (dx * dx + dy * dy + dz * dz >= SHOT.BLOCK_R * SHOT.BLOCK_R) continue;
      V_LAUNCH.x = BLOCK_BACK * ball.vel.x;
      V_LAUNCH.y = BLOCK_LIFT_MIN + BLOCK_LIFT_RND * this.rng.next();
      V_LAUNCH.z = BLOCK_BACK * ball.vel.z;
      ball.launch(V_LAUNCH, 'loose', { toucher: d });
      d.stats.blk++;
      this.shot.missCaptioned = true;
      this.caption('cap.block', d);
      if (this.audio) this.audio.block();
      this.emit('block', this.shot.shooter, d);
      return;
    }
  }

  // ---------------------------------------------------------------- catches

  resolveCatch() {
    const ball = this.ball;
    if (!ball.isFree) return;
    const ps = this.players, w = this.world;
    // A shot still on its way to the basket (no contact yet, above the rim plane) cannot be caught:
    // goaltending is not modelled, so nobody may pluck a make out of the air. Below the rim it has
    // already missed short and is a live ball.
    if (ball.state === 'flight' && ball.pos.y >= RIM.y) return;
    // A passer cannot catch his own pass right out of his hands (same 0.3 s rule as a shot).
    const passer = ball.state === 'pass' && ball.releaseAge < BALL.CATCH_FLIGHT_AGE ? ball.passInfo.from : null;
    // A stolen ball leaves from the victim's dribble hand, inside his own catch radius: without the same
    // 0.3 s exclusion the victim caught 90 % of successful steals straight back (section 5.11 wants the
    // loose ball to go 'usually' to the stealer).
    const victim = this.ballCtx === 'steal' && ball.releaseAge < BALL.CATCH_FLIGHT_AGE ? this.stealVictim : null;
    let best = null, bestD = Infinity;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p === passer || p === victim || !ball.canBeCaughtBy(p, w)) continue;
      const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) this.onCatch(best);
  }

  // Section 5.8 outcomes: offensive rebound (REB, shot clock 14) or completed pass; defensive catch
  // is a STL (pass still in the air) or REB and goes DEAD(TURNOVER).
  onCatch(p) {
    const w = this.world, ball = this.ball;
    const prev = ball.state, ctx = this.ballCtx;
    ball.attachTo(p, 'held');
    this.emit('catch', prev, p);
    if (p.team === w.offense) {
      if (ctx === 'shot') {
        p.stats.reb++;
        w.shotClock = Math.min(CLOCK.SHOT, Math.max(w.gameClock, FIXED_DT));
        this.lastShotSec = Math.ceil(w.shotClock - 1e-4);
        this.caption('cap.rebound', p);
        this.emit('rebound', 'offensive', p);
      }
      if (w.user === w.offense) this.setControlled(p);
      this.shot.pending = false;
      this.ballCtx = 'none';
      return;
    }
    if (prev === 'pass') {
      p.stats.stl++;
      this.caption('cap.steal', p);
      this.emit('steal', ball.passInfo.from, p);
    } else if (ctx !== 'steal') {
      p.stats.reb++;
      this.caption('cap.rebound', p);
      this.emit('rebound', 'defensive', p);
    }
    this.shot.pending = false;
    this.ballCtx = 'none';
    this.emit('turnover', prev === 'pass' ? 'STEAL' : 'REBOUND', p);
    this.deadBall('TURNOVER', p.team, CLOCK.DEAD.TURNOVER);
  }

  // ---------------------------------------------------------------- ball events

  resolveBallEvent(ev) {
    const w = this.world, audio = this.audio, live = w.state === 'LIVE';
    switch (ev.type) {
      case 'bounce':
        if (audio) audio.bounce(ev.value);
        break;
      case 'rim':
        if (audio) audio.rim(ev.value);
        this.emit('rim', ev.value, ev.player);
        this.onShotContact();
        break;
      case 'board':
        if (audio) audio.board();
        if (this.shot.pending) this.shot.bank = true;
        this.emit('board', ev.value, ev.player);
        this.onShotContact();
        break;
      case 'score':
        if (live) this.onScore(ev.value, ev.player);
        break;
      case 'oob':
        if (live) this.onOutOfBounds(ev.player, 'OOB'); else this.stopBall();
        break;
      case 'rest':
        if (live) this.onOutOfBounds(ev.player, 'REST');
        break;
      case 'nan':
        this.debug.invariantsBroken++;
        if (w.state === 'LIVE' || w.state === 'DEAD') this.enterCheck(w.offense);
        break;
      default:
        break;
    }
  }

  onShotContact() {
    const shot = this.shot;
    if (!shot.pending || shot.make || shot.missCaptioned) return;
    shot.missCaptioned = true;
    this.caption('cap.miss', shot.shooter);
  }

  onScore(points, scorer) {
    const w = this.world, off = w.offense, shot = this.shot;
    const shooter = this.ball.shotInfo.shooter;
    // Points always go to the offence; a deflection by a defender still credits the shooter.
    let credit = scorer && scorer.team === off ? scorer : (shooter && shooter.team === off ? shooter : scorer);
    if (!credit) credit = this.roster[off][0];
    const ownShot = shot.pending && credit === shot.shooter;
    const pts = points === 3 ? 3 : 2;
    this.score[off] += pts;
    const s = credit.stats;
    s.pts += pts; s.fgm++;
    if (pts === 3) s.tpm++;
    if (!ownShot) s.fga++;                    // a tip-in is its own attempt
    const kind = ownShot ? shot.kind : 'tip';
    if (this.buzzerPending) this.caption('cap.buzzerBeater', credit);
    else if (kind === 'dunk') this.caption('cap.dunk', credit);
    else if (kind === 'layup') this.caption('cap.layup', credit);
    else if (ownShot && shot.bank && pts === 2) this.caption('cap.bank', credit);
    else this.caption(pts === 3 ? 'cap.make3' : 'cap.make2', credit);
    this.banner('banner.plus', { n: pts }, PLUS_BANNER_MS);
    if (this.audio) {
      if (kind === 'dunk') this.audio.dunk(); else { this.audio.swish(); this.audio.crowd(1.0, 1.5); }
    }
    if (this.arena) this.arena.bumpCrowd();
    this.netT = 0;
    credit.celebrate();
    shot.pending = false;
    this.ballCtx = 'none';
    this.emit('score', pts, credit);
    this.deadBall('MADE', 1 - off, CLOCK.DEAD.MADE);
  }

  // A dead ball that left the court stops there and drops to the floor (keeps it inside the arena).
  stopBall() {
    const ball = this.ball;
    ball.vel.set(0, 0, 0);
    ball.pos.x = clamp(ball.pos.x, -OOB_HOLD_X, OOB_HOLD_X);
    ball.pos.z = clamp(ball.pos.z, OOB_HOLD_Z_MIN, OOB_HOLD_Z_MAX);
    if (ball.pos.y < BALL.R) ball.pos.y = BALL.R;
  }

  // Out of bounds and the resting-ball rescue: possession to the team that did not touch it last.
  onOutOfBounds(last, why) {
    const w = this.world, ball = this.ball;
    const lastTeam = last ? last.team : w.offense;
    this.stopBall();                       // the whistle stops the ball where it went out
    if (this.audio) this.audio.whistle();
    this.caption('cap.oob', null);
    this.emit(why === 'REST' ? 'rest' : 'oob', lastTeam, last);
    this.deadBall('OOB', 1 - lastTeam, CLOCK.DEAD.OOB);
  }

  // ---------------------------------------------------------------- invariants (debug counter)

  // Finite coordinates, ball above the floor after collision, shot clock inside [0, 14]. Broken
  // invariants are counted in debug.invariantsBroken and repaired so play can continue.
  checkInvariants() {
    const w = this.world, ps = this.players, ball = this.ball;
    let broken = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!Number.isFinite(p.pos.x + p.pos.z + p.vel.x + p.vel.z + p.yaw + p.jumpY)) {
        broken++;
        const to = this.checkTo[i];
        p.reset(to.x, to.z, to.yaw);
      }
    }
    const bp = ball.pos;
    if (Number.isFinite(bp.x + bp.y + bp.z)) {
      if (bp.y < BALL.R - 0.02) { broken++; bp.y = BALL.R; if (ball.vel.y < 0) ball.vel.y = 0; }
    }
    if (!(w.shotClock >= 0 && w.shotClock <= CLOCK.SHOT)) {
      broken++;
      w.shotClock = clamp(Number.isFinite(w.shotClock) ? w.shotClock : CLOCK.SHOT, 0, CLOCK.SHOT);
    }
    if (!Number.isFinite(w.gameClock)) { broken++; w.gameClock = 0; }
    if (broken) this.debug.invariantsBroken += broken;
  }

  // ---------------------------------------------------------------- rendering

  // Once per rendered frame: interpolated players and ball, net wobble, crowd bob, camera, meter.
  render(alpha, dt) {
    const w = this.world;
    const fdt = dt > 0 ? dt : 0;
    this.renderTime += fdt;
    const ps = this.players;
    const showMarker = !!w.controlled && w.state !== 'MENU' && w.state !== 'GAME_OVER';
    if (this.marker.group.visible !== showMarker) this.marker.group.visible = showMarker;
    for (let i = 0; i < ps.length; i++) ps[i].render(alpha, this.renderTime, fdt);
    this.ball.render(alpha);
    if (this.court) {
      if (this.netT >= 0) { this.netT += fdt; if (this.netT >= 0.6) this.netT = -1; }
      this.court.animateNet(this.netT);
    }
    if (this.arena) this.arena.updateCrowd(fdt);
    if (this.cam) this.cam.update(fdt, w);
    this.renderMeter();
  }

  // Section 11: the DOM meter follows the shooter's head while the human's windup runs.
  renderMeter() {
    const w = this.world, hud = this.hud;
    if (!hud) return;
    const c = w.controlled;
    const active = !!c && !w.auto && w.state === 'LIVE' && (c.state === 'windup' || c.state === 'layup') && !c.released && !!c.humanoid;
    if (!active) {
      if (this.meterShown) { this.meterShown = false; hud.setMeter(0, this.difficulty.userGreen, false, 0, 0); }
      return;
    }
    const meterT = meterDuration(c.shotKind);
    let f = c.meterF;
    if (c.shotPressTs > 0 && !this.debugShot.active) {
      const t = (nowMs() - c.shotPressTs) / 1000;
      if (t >= 0 && t < 5) f = clamp(t / meterT, 0, SHOT.F_MAX);
    }
    const g = greenHalfWidth(c.shotKind, this.difficulty.userGreen);
    const head = c.humanoid.headWorld(SCRATCH.v3d);
    hud.projectMeter(f, g, true, head.x, head.y, head.z, this.cam ? this.cam.camera : null);
    this.meterShown = true;
  }

  // ---------------------------------------------------------------- debug hooks (section 14)

  teleport(i, x, z) {
    const p = typeof i === 'number' ? this.players[i] : i;
    if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    p.pos.x = x; p.pos.z = z;
    p.prevPos.x = x; p.prevPos.z = z;
    p.vel.set(0, 0, 0);
    fillHistory(p);
    if (p.hasBall && this.ball.owner === p) { this.ball.placeOnOwner(); this.ball.prevPos.copy(this.ball.pos); }
    if (p.humanoid) { p.humanoid.group.position.x = x; p.humanoid.group.position.z = z; }
    return p;
  }

  // Forces a shot by the controlled player (or the current handler): p overrides the make
  // probability, e the timing error; the release happens when the meter reaches 0.80 + e.
  debugShoot(o) {
    const w = this.world, ball = this.ball;
    const opts = o || {};
    if (w.state !== 'LIVE') return false;
    let p = w.controlled;
    if (!p || p.team !== w.offense) p = ball.owner || this.roster[w.offense][0];
    if (!p.hasBall || ball.owner !== p) ball.attachTo(p, 'held');
    if (!p.canAct) {
      p.state = 'idle'; p.isJumping = false; p.jumpY = 0; p.jumpT = 0;
      p.stunT = 0; p.crossT = 0; p.stealT = 0; p.celebrateT = 0; p.dunkT = 0;
      p.released = false;
    }
    const dbg = this.debugShot;
    dbg.active = true;
    dbg.player = p;
    dbg.p = typeof opts.p === 'number' ? opts.p : null;
    dbg.e = typeof opts.e === 'number' ? opts.e : null;
    const kind = this.startShot(p, 0);
    if (kind === 'dunk') dbg.active = false;   // scripted: always scores
    return kind;
  }

  setClock(o) {
    const w = this.world, c = o || {};
    if (typeof c.game === 'number' && Number.isFinite(c.game)) w.gameClock = Math.max(0, c.game);
    if (typeof c.shot === 'number' && Number.isFinite(c.shot)) {
      w.shotClock = clamp(c.shot, 0, CLOCK.SHOT);
      this.lastShotSec = Math.ceil(w.shotClock - 1e-4);
    }
    return { game: w.gameClock, shot: w.shotClock };
  }

  // Immediate possession change (DEAD(TURNOVER) -> CHECK for the other team).
  turnover() {
    const w = this.world;
    if (w.state === 'LIVE') {
      this.caption('cap.turnover', null);
      this.emit('turnover', 'FORCED', w.controlled);
      this.deadBall('TURNOVER', 1 - w.offense, CLOCK.DEAD.TURNOVER);
    } else if (w.state === 'DEAD') {
      this.nextOffense = 1 - this.nextOffense;
      if (w.offense !== this.nextOffense) {
        w.offense = this.nextOffense;
        if (this.input) this.input.setOffense(this.userIsOffense());
      }
    } else if (w.state === 'CHECK') {
      this.enterCheck(1 - w.offense);
    }
    return w.offense;
  }

  // round(sec * 60) fixed steps without rendering or input sampling (main.js renders one frame after).
  fastForward(sec) {
    const n = Math.max(0, Math.round((sec > 0 ? sec : 0) * 60));
    for (let i = 0; i < n; i++) this.step(FIXED_DT);
    return n;
  }
}
