/**
 * @module game
 * Game orchestration v2 (v1 spec §1, §4, §5.8–§5.13, §8; v2 spec §1.3, §1.4, §1.4.1, §4.13, §5.2–§5.7, §5.9, §5.13,
 * §5.15, C1–C35): the state machine and clocks, the v2 rules R1–R12, shot / pass / steal / block / interception /
 * bump / shake / post / rebound resolution, abilities, metrics, the HUD meter source and the game events.
 *
 * Exports: `Game`, `STATES`, `EVENTS`, `makeDebugHooks(game)`, and the pure rule models used by the unit tests:
 * `blockChance`, `pokeChance`, `shakeChance`, `bumpOutcome`, `interceptChance`, `biteChance`, `matchupCost`.
 *
 * Construction (spec §1.4): `new Game({ scene, anim: 'real'|'proxy', characters, lineup, seed, difficulty,
 * rules: {clear, autoSwitch}, quarterSec, ai?, input?, header?, auto?, tier? })`. `ai` is the AI module
 * (`{updateAI(world, dt), resetAI?(player), assignMatchups?(world, offense), planCpuRelease?(player, world),
 * aiDebug?(player)}`, normally `import * as AI from './ai.js'`); without it the FALLBACK AI DRIVER of context.js runs.
 * Headless: `new Game({scene: null, anim: 'proxy'})` runs fixed steps only (no three.js scene objects are created).
 *
 * Events (§1.4.1, C35): game.js only emits; `game.on(evt, cb)` (or `'*'` for every event) receives `cb(payload, evt)`.
 * Payloads come from a pool of 64 objects that are rewritten (copy what you keep); every payload carries
 * `{type, t, playerId, team, x, z}` plus the fields of its row. The pool doubles as the ring of the last 64 events
 * (`game.recentEvents()` / `__game.events`). Zero allocation per step (H10).
 *
 * Step order (§1.3): (1) clocks + state machine (2) AI (3) intents → context resolver → actions (4) Player.step (each
 * steps its animator) (5) animator events (TAKEOFF / RELEASE / SLAM / SWIPE / PLANT / LAND …) (6) blocks /
 * interceptions / bumps / shoves / dunk stuffs (7) separation (8) Ball.step and ball events (9) catches, rest
 * rescue, idle habits, meter, invariants.
 */
import { RIM, BALL, CLOCK, DIFFICULTY, FORMATION, SLOTS_V2, FIXED_DT, SHOT_V2, STEAL, REBOUND, isThree } from './constants.js';
import { clamp, lerp, lerpAngle, smoothstep, Rng } from './math.js';
import { n, zoneRating } from './ratings.js';
import { LEGENDS } from './legends.js';
import { makeShotInput, greenHalfWidth, meterBand, isJumpShot, shotPoints, resolveShotZone, gDiffFor, findContactDefender } from './shot.js';
import { AbilityLog, makeAbilityCtx, resetAbilityCtx, has, mul } from './abilities.js';
import { normalizeLineup, resetLineup, pickCheckReceiver, makeCheckState } from './lineup.js';
import { Metrics } from './metrics.js';
import { resolveSeparation, ContactMixin, matchupCost, PERMS, CEL_ZERO } from './physics.js';
import { Ball } from './ball.js';
import { Player, ActionMixin } from './player.js';
import { resolveOffense, resolveShot, resolveDefense, updatePostDetector, postExit, resolvePassTarget, FALLBACK_AI, DebugMixin, comboAllowed } from './context.js';
import { selectCelebration, selectIdleHabit } from './anim/select.js';
import { EV, clipIndex } from './anim/clip.js';
import { MOVES_V2, SHAKE } from './constants.js';
import { clearEdges } from './input.js';

export { blockChance, pokeChance, shakeChance, bumpOutcome, interceptChance, biteChance, matchupCost } from './physics.js';
export { makeDebugHooks } from './context.js';

/** game.state values (C15). */
export const STATES = Object.freeze(['MENU', 'LINEUP', 'INTRO', 'CHECK', 'LIVE', 'DEAD', 'QUARTER_END', 'HALFTIME', 'GAME_OVER']);
/** Every event name of §1.4.1. */
export const EVENTS = Object.freeze(['caption', 'banner', 'state', 'shot', 'pumpFake', 'move', 'jab', 'takeoff', 'release', 'slam',
  'land', 'plant', 'ball', 'score', 'miss', 'block', 'steal', 'intercept', 'deflect', 'ankle', 'bump', 'shake', 'ability', 'pass',
  'catch', 'rebound', 'possession', 'turnover', 'clock', 'buzzer', 'quarter', 'gameover']);

const PER_TEAM = 3;
const POOL = 64;
const SWITCH_CD = 0.25;
const CHECK_BANNER_MS = 1000, PLUS_BANNER_MS = 1200, PERIOD_BANNER_MS = 2500;
const OOB_HOLD_X = 8.3, OOB_HOLD_Z_MIN = -15.2, OOB_HOLD_Z_MAX = 0.4;
const HABIT_CD = 6.0, HABIT_STILL = 0.6;                 // [ANIM §8.3]
const SHAKE_FALLBACK_T = 0.25, JAB_FALLBACK_T = 0.15;   // resolution times for clips without PLANT / FAKE keys
const AUTO_SWITCH_IDLE = 0.40;                           // §5.9.3 stick idle before an auto-switch
const SWEAT_FULL_S = 8 * 60;                             // §3.5.5 sweat s = min(1, minutesPlayed / 8)
const DEAD_SECONDS = { MADE: CLOCK.DEAD.MADE, TURNOVER: CLOCK.DEAD.TURNOVER, OOB: CLOCK.DEAD.OOB, SHOT_CLOCK: CLOCK.DEAD.SHOT_CLOCK };
const C_PUT_DUNK = clipIndex('put.dunk'), C_PUT_TIP = clipIndex('put.tip');

// ------------------------------------------------------------------------------------------------ scratch
const CEL_CTX = { cls: 'normal', rng: null, streak: 0, assisted: false, gameWinner: false, jumper: false, blocker: false, chaseDown: false };
const HABIT_CTX = { rng: null, hasBall: false, onBallDef: false, toDefence: false, timeLeft: Infinity, check: false };
/** Scratch result for the second CROSS tap of a double tap folded into one step (queueCombo reads comboIndex only). */
const COMBO2 = { comboIndex: 2 };
const CHECK_IDS = ['', '', ''];
const ACTX = makeAbilityCtx();

const SPOT_ORDER = {};
/** A legend's spot ids by descending weight (§2.5), built once per legend. */
function spotOrder(id) {
  let o = SPOT_ORDER[id];
  if (!o) {
    const sp = LEGENDS[id].spots;
    o = SPOT_ORDER[id] = Object.keys(sp).sort((x, y) => sp[y] - sp[x]);
  }
  return o;
}

function makePayload() {
  return {
    type: '', t: 0, playerId: null, team: -1, x: 0, z: 0, kind: null, variant: null, zone: null, points: 0, clutch: false,
    buzzer: false, time: 0, assistId: null, winner: -1, firstDunk: false, airball: false, blockerId: null, shooterId: null,
    pin: false, chaseDown: false, how: null, fromId: null, toId: null, defenderId: null, id: null, offensive: false, reason: null,
    sec: 0, q: 0, ot: false, mvpId: null, box: null, key: null, params: { name: null, n: 0 }, priority: 0, ms: 0, from: null, to: null,
    moveId: null, h: 0, dropH: 0, massKg: 0, decel: 0, turnRate: 0, what: null, strength: 0, lob: false,
  };
}

function resetPayload(e) {
  e.playerId = null; e.team = -1; e.x = 0; e.z = 0; e.kind = null; e.variant = null; e.zone = null; e.points = 0; e.clutch = false;
  e.buzzer = false; e.time = 0; e.assistId = null; e.winner = -1; e.firstDunk = false; e.airball = false; e.blockerId = null;
  e.shooterId = null; e.pin = false; e.chaseDown = false; e.how = null; e.fromId = null; e.toId = null; e.defenderId = null; e.id = null;
  e.offensive = false; e.reason = null; e.sec = 0; e.q = 0; e.ot = false; e.mvpId = null; e.box = null; e.key = null;
  e.params.name = null; e.params.n = 0; e.priority = 0; e.ms = 0; e.from = null; e.to = null; e.moveId = null; e.h = 0; e.dropH = 0;
  e.massKg = 0; e.decel = 0; e.turnRate = 0; e.what = null; e.strength = 0; e.lob = false;
}

function silenceIntent(it) {
  it.move.x = 0; it.move.z = 0; it.move.mag = 0; it.sprint = false; it.post = false;
  it.primary.held = false; it.primary.heldTime = 0;
  it.secondary.held = false; it.secondary.heldTime = 0;
  it.tertiary.held = false; it.tertiary.heldTime = 0;
  clearEdges(it);
}



// ================================================================================================ Game

export class Game {
  constructor(opts = {}) {
    const o = opts;
    this.scene = o.scene || null;
    this.animMode = o.anim === 'real' ? 'real' : 'proxy';
    this.characters = o.characters || null;
    this.input = o.input || null;
    this.ai = o.ai && typeof o.ai.updateAI === 'function' ? o.ai : FALLBACK_AI;
    this.seed = (o.seed | 0) || 1;
    this.rng = o.rng || new Rng(this.seed);
    this.cosRng = new Rng(this.seed ^ 0xA11CE5);
    this.lineup = normalizeLineup(o.lineup) || resetLineup();
    this.rules = { clear: !!(o.rules && o.rules.clear), autoSwitch: !(o.rules && o.rules.autoSwitch === false) };
    this.pendingRules = null;
    this.quarterSeconds = o.quarterSec > 0 ? o.quarterSec : CLOCK.DEFAULT_Q;
    this.difficultyId = DIFFICULTY[o.difficulty] ? o.difficulty : 'normal';
    this.debug = { invariantsBroken: 0, forceCelebrate: false };
    // the six players (persistent per legend id; teams come from the lineup)
    this.players = [];
    this.byId = {};
    this.roster = [[], []];
    const ids = [...this.lineup.a, ...this.lineup.b];
    for (let i = 0; i < 6; i++) {
      const id = ids[i];
      const p = new Player({ id, team: i < 3 ? 0 : 1, index: i % 3, anim: this.animMode, character: this.characters ? this.characters[id] : null,
        header: o.header || null, index6: i, rng: new Rng((this.seed ^ 0xA11CE5) + i * 7919), tier: o.tier || 'medium' });
      p.idx = i;
      this.players.push(p);
      this.byId[id] = p;
    }
    this.ball = new Ball(this.rng);
    this.metrics = new Metrics();
    this.abilityLog = new AbilityLog(256, (e, desc) => this.onAbility(e, desc));
    this.score = [0, 0];
    this.checkStates = [makeCheckState(), makeCheckState()];
    this.blockRolled = new Uint8Array(6);
    this.intRolled = new Uint8Array(6);
    this.stuffRolled = new Uint8Array(6);
    this.checkFrom = []; this.checkTo = [];
    for (let i = 0; i < 6; i++) { this.checkFrom.push({ x: 0, z: 0, yaw: 0 }); this.checkTo.push({ x: 0, z: 0, yaw: 0 }); }
    this.habitCd = new Float64Array(6);
    this.stillT = new Float64Array(6);
    this.boxRows = [];
    for (let i = 0; i < 6; i++) this.boxRows.push({ id: '', team: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0, ast: 0, stl: 0, blk: 0 });
    // events
    this.listeners = Object.create(null);
    this.pool = []; for (let i = 0; i < POOL; i++) this.pool.push(makePayload());
    this.poolHead = 0; this.poolCount = 0;
    this.ballEvents = [];
    this.shotInput = makeShotInput();
    this.meter = Object.seal({ active: false, shooterId: null, fill: 0, greenLo: 0, greenHi: 0, points: 2, flash: null, flashT: 0 });
    this.edgeSeen = { primaryP: -1, primaryR: -1, secondaryP: -1, secondaryR: -1, tertiaryP: -1, tertiaryR: -1 };
    const self = this;
    this.world = {
      players: this.players, ball: this.ball, score: this.score, offense: 0, user: this.lineup.user === 'b' ? 1 : 0,
      userPlayer: null, controlled: null, quarter: 1, gameClock: this.quarterSeconds, shotClock: CLOCK.SHOT, state: 'MENU',
      deadReason: null, difficulty: DIFFICULTY[this.difficultyId], difficultyId: this.difficultyId, rng: this.rng, time: 0,
      auto: !!o.auto, paused: false, rimXZ: RIM, slots: SLOTS_V2, game: this, rules: this.rules, abilityLog: this.abilityLog,
      metrics: this.metrics, lineup: this.lineup, roster: this.roster, liveT: 0, clearPending: -1, cleared: true,
      isUserControlled(p) { return !self.world.auto && p === self.world.controlled; },
    };
    this.paused = false; this.resuming = false; this.resumeT = 0; this.resumeShown = -1;
    this.stateT = 0; this.deadT = 0; this.nextOffense = 0; this.q1Offense = 0; this.periodOpen = 0; this.possessionCount = 0;
    this.lastShotSec = CLOCK.SHOT; this.lastGameSec = 999;
    this.buzzerPending = false; this.buzzerLooseT = 0;
    this.freeRestT = 0;
    this.clockPlayed = 0;                // game-clock seconds played this game (sweat)
    this.stealVictim = null;
    this.stealT = -1e9;
    this.pending = { active: false, shooter: null, team: -1, kind: '', airball: false, missed: false, bank: false };
    this.firstDunkDone = false;
    this.applyLineup(this.lineup);
    this.placeFormation(0, this.roster[0][0], true);
  }

  // ---------------------------------------------------------------- accessors
  get state() { return this.world.state; }
  get controlled() { return this.world.controlled; }
  get quarter() { return this.world.quarter; }
  get gameClock() { return this.world.gameClock; }
  get shotClock() { return this.world.shotClock; }
  get difficulty() { return this.world.difficulty; }
  isUserControlled(p) { return this.world.isUserControlled(p); }
  userIsOffense() { return this.world.offense === this.world.user; }
  player(id) { return this.byId[id] || null; }

  // ---------------------------------------------------------------- events
  /** Subscribe to `evt` ('*' = every event); cb(payload, evt). Returns an unsubscribe function. */
  on(evt, cb) {
    if (typeof cb !== 'function') return () => {};
    (this.listeners[evt] || (this.listeners[evt] = [])).push(cb);
    return () => { const l = this.listeners[evt]; const i = l ? l.indexOf(cb) : -1; if (i >= 0) l.splice(i, 1); };
  }

  /** Next pooled payload with the base fields of `p` (or neutral). */
  ev(type, p) {
    const e = this.pool[this.poolHead];
    this.poolHead = (this.poolHead + 1) % POOL;
    if (this.poolCount < POOL) this.poolCount++;
    resetPayload(e);
    e.type = type; e.t = this.world.time;
    if (p) { e.playerId = p.id; e.team = p.team; e.x = p.pos.x; e.z = p.pos.z; }
    return e;
  }

  fire(e) {
    const a = this.listeners[e.type], b = this.listeners['*'];
    if (a) for (let i = 0; i < a.length; i++) { try { a[i](e, e.type); } catch { /* a listener never breaks the sim */ } }
    if (b) for (let i = 0; i < b.length; i++) { try { b[i](e, e.type); } catch { /* idem */ } }
    return e;
  }

  /**
   * Emits an event from outside the step (tests / tools, §1.4.1): a pooled payload of `type` with the given fields
   * copied in (params merged), routed like every game event. Returns the payload.
   */
  emit(type, fields) {
    const e = this.ev(type, null);
    if (fields) {
      for (const k in fields) {
        if (k === 'type') continue;
        if (k === 'params') { if (fields.params) for (const pk in fields.params) e.params[pk] = fields.params[pk]; } else e[k] = fields[k];
      }
    }
    return this.fire(e);
  }

  /** The last ≤ 64 events, oldest first (allocates; tests / debug only). */
  recentEvents() {
    const out = [];
    for (let i = 0; i < this.poolCount; i++) out.push(this.pool[(this.poolHead - this.poolCount + i + POOL) % POOL]);
    return out;
  }

  caption(key, p, priority) {
    const e = this.ev('caption', p);
    e.key = key; e.params.name = p ? p.short : null; e.priority = priority || 1;
    return this.fire(e);
  }

  banner(key, n, ms) {
    const e = this.ev('banner', null);
    e.key = key; e.params.n = n || 0; e.ms = ms || 0;
    return this.fire(e);
  }

  onAbility(entry, desc) {
    const p = this.byId[entry.player];
    const e = this.ev('ability', p);
    e.id = entry.id; e.what = entry.ctx; e.kind = entry.kind;
    this.fire(e);
    this.metrics.ability(entry.id, entry.player);
    if (desc && desc.caption) {
      const h = entry.ctx;
      const moment = h === 'shotKind' || h === 'move' || h === 'drive' || h === 'pass' || h === 'blockDefender' || h === 'post';
      if ((desc.kind === 'trigger' && h !== 'pg' && h !== 'contestA') || (desc.kind !== 'trigger' && moment && h !== 'post')) this.caption(desc.caption, p, 2);
    }
  }

  // ---------------------------------------------------------------- lineup / options
  applyLineup(l) {
    this.lineup = l;
    this.world.lineup = l;
    this.roster[0].length = 0; this.roster[1].length = 0;
    for (let t = 0; t < 2; t++) {
      const ids = t === 0 ? l.a : l.b;
      for (let i = 0; i < PER_TEAM; i++) { const p = this.byId[ids[i]]; p.team = t; p.teamIdx = t; p.index = i; this.roster[t].push(p); }
    }
    this.world.user = l.user === 'b' ? 1 : 0;
    for (let i = 0; i < 6; i++) this.metrics.registerPlayer(this.players[i].id, this.players[i].team);
  }

  /** Validates and applies a lineup; inside a game it restarts with the same options (§5.15). Returns success. */
  setLineup(l) {
    const v = normalizeLineup(l);
    if (!v) return false;
    const inGame = this.world.state !== 'MENU' && this.world.state !== 'LINEUP';
    this.applyLineup(v);
    if (inGame) this.start(null);
    else this.placeFormation(0, this.roster[0][0], true);
    return true;
  }

  /** Rules option (applies at the next CHECK). */
  setRules(r) {
    if (!r) return this.rules;
    this.pendingRules = { clear: r.clear === undefined ? this.rules.clear : !!r.clear, autoSwitch: r.autoSwitch === undefined ? this.rules.autoSwitch : !!r.autoSwitch };
    if (this.world.state === 'MENU' || this.world.state === 'LINEUP') this.applyPendingRules();
    return this.pendingRules;
  }

  applyPendingRules() {
    if (!this.pendingRules) return;
    this.rules.clear = this.pendingRules.clear; this.rules.autoSwitch = this.pendingRules.autoSwitch;
    this.pendingRules = null;
  }

  setDifficulty(id) {
    this.difficultyId = DIFFICULTY[id] ? id : 'normal';
    this.world.difficulty = DIFFICULTY[this.difficultyId];
    this.world.difficultyId = this.difficultyId;
  }

  // ---------------------------------------------------------------- lifecycle
  /**
   * Start a game: opts { quarterSec, difficulty, auto, intro (truthy → state INTRO until endIntro()), seed }.
   * Scores, stats, AI timers and per-game counters reset; metrics.gameStart.
   */
  start(opts) {
    const o = opts || {};
    const w = this.world;
    if (o.quarterSec > 0) this.quarterSeconds = o.quarterSec;
    if (o.difficulty) this.setDifficulty(o.difficulty);
    if (o.auto !== undefined) w.auto = !!o.auto;
    if (o.seed !== undefined) { this.seed = o.seed | 0; this.rng.reseed(this.seed); this.cosRng.reseed(this.seed ^ 0xA11CE5); }
    this.applyPendingRules();
    this.score[0] = 0; this.score[1] = 0;
    for (let i = 0; i < 6; i++) { const p = this.players[i]; p.resetStats(); p.cx.ftDunks = 0; if (this.ai.resetAI) this.ai.resetAI(p); }
    this.checkStates[0].lastId = null; this.checkStates[0].count = 0; this.checkStates[1].lastId = null; this.checkStates[1].count = 0;
    w.quarter = 1; w.gameClock = this.quarterSeconds; w.shotClock = CLOCK.SHOT; w.time = 0;
    this.possessionCount = 0; this.firstDunkDone = false; this.clockPlayed = 0;
    this.paused = false; w.paused = false; this.resuming = false;
    this.metrics.gameStart(this.lineup);
    this.q1Offense = this.rng.int(2);
    this.periodOpen = this.q1Offense;
    this.setControlled(this.roster[w.user][0]);
    if (o.intro) { this.placeFormation(this.q1Offense, this.roster[this.q1Offense][0], true); this.setState('INTRO', 'start'); }
    else this.enterCheck(this.q1Offense, 'start');
    return this;
  }

  /** INTRO → CHECK (called by flow.js when the intro ends or is skipped). */
  endIntro() {
    if (this.world.state === 'INTRO') this.enterCheck(this.q1Offense, 'intro');
  }

  /** MENU → LINEUP (no sim; pause invalid). */
  enterLineup() {
    if (this.world.state === 'MENU' || this.world.state === 'GAME_OVER') {
      this.placeFormation(0, this.roster[0][0], true);
      this.setState('LINEUP', 'lineup');
    }
  }

  rematch() { return this.start({ intro: false }); }

  quit() {
    const w = this.world;
    this.paused = false; w.paused = false; this.resuming = false;
    this.buzzerPending = false;
    this.endShotTracking();
    for (let i = 0; i < 6; i++) { if (this.ai.resetAI) this.ai.resetAI(this.players[i]); silenceIntent(this.players[i].intent); }
    this.placeFormation(0, this.roster[0][0], true);
    this.setState('MENU', 'quit');
  }

  pause() {
    const s = this.world.state;
    if (s === 'MENU' || s === 'LINEUP' || s === 'GAME_OVER' || s === 'INTRO') return false;
    if (this.paused && !this.resuming) return true;
    this.paused = true; this.world.paused = true; this.resuming = false;
    if (this.input && this.input.setEnabled) this.input.setEnabled(false);
    return true;
  }

  /** Resume after a 1.0 s countdown (v1 §8); paused stays true meanwhile. */
  resume() {
    if (!this.paused || this.resuming) return false;
    this.resuming = true; this.resumeT = CLOCK.RESUME_COUNTDOWN; this.resumeShown = -1;
    if (this.input && this.input.setEnabled) this.input.setEnabled(true);
    return true;
  }

  togglePause() { return this.paused ? this.resume() : this.pause(); }

  skipHalftime() { if (this.world.state === 'HALFTIME' && !this.paused) this.nextQuarter(); }

  /** Extend the current dead ball (instant replays inside DEAD). */
  holdDead(seconds) {
    if (this.world.state === 'DEAD' && seconds > this.deadT) this.deadT = seconds;
    return this.deadT;
  }

  setState(s, reason) {
    const w = this.world;
    if (w.state === s && reason !== 'start') return;
    const from = w.state;
    w.state = s;
    this.stateT = 0;
    const e = this.ev('state', null);
    e.from = from; e.to = s; e.reason = reason || null;
    this.fire(e);
  }

  // ---------------------------------------------------------------- control
  setControlled(p) {
    const w = this.world;
    const old = w.controlled;
    if (old === p) return;
    if (old) silenceIntent(old.intent);
    w.controlled = p; w.userPlayer = p;
    for (let i = 0; i < 6; i++) { const q = this.players[i]; q.isUser = !w.auto && q === p; }
    if (p) p.switchCd = SWITCH_CD;
  }

  /** SWITCH on defence (v1 §7.4): the defender nearest the ball, excluding the current one (0.25 s cooldown). */
  switchDefender() {
    const w = this.world, cur = w.controlled;
    if (this.userIsOffense() || !cur || cur.switchCd > 0) return null;
    let best = null, bestD = Infinity;
    const mates = this.roster[w.user];
    for (let i = 0; i < mates.length; i++) {
      const p = mates[i];
      if (p === cur) continue;
      const dx = p.pos.x - this.ball.pos.x, dz = p.pos.z - this.ball.pos.z, d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) this.setControlled(best);
    return best;
  }

  // ---------------------------------------------------------------- possession / CHECK
  openingPossession(q) {
    const q1 = this.q1Offense;
    if (q === 1) return q1;
    if (q === 2 || q === 3) return 1 - q1;
    if (q === 4) return q1;
    return 1 - this.periodOpen;
  }

  /** Defensive matchups for `offense` (§5.10 cost, min over the 6 permutations, ties by roster order). */
  assignMatchups(offense) {
    if (this.ai.assignMatchups) { this.ai.assignMatchups(this.world, offense); return; }
    const att = this.roster[offense], def = this.roster[1 - offense];
    let top = att[0];
    for (let i = 1; i < 3; i++) if (att[i].legend.tend.checkShare > top.legend.tend.checkShare) top = att[i];
    let best = 0, bestC = Infinity;
    for (let k = 0; k < PERMS.length; k++) {
      const P = PERMS[k];
      let c = 0;
      for (let i = 0; i < 3; i++) c += matchupCost(def[i], att[P[i]], top);
      if (c < bestC - 1e-9) { bestC = c; best = k; }
    }
    for (let i = 0; i < 3; i++) def[i].defAssign = att[PERMS[best][i]];
    for (let i = 0; i < 3; i++) att[i].defAssign = null;
  }

  /**
   * CHECK formation (§5.12.4): handler (0, −4.6), teammates at their top spot, defenders lerp(attacker, rim, 0.18).
   * `snap` moves everyone there at once (menu backdrop).
   */
  placeFormation(offense, handler, snap) {
    this.assignMatchups(offense);
    const att = this.roster[offense];
    let usedA = null;
    for (let i = 0; i < 3; i++) {
      const p = att[i], to = this.checkTo[p.idx];
      to.yaw = FORMATION.OFFENSE_YAW;
      if (p === handler) { to.x = FORMATION.HANDLER.x; to.z = FORMATION.HANDLER.z; continue; }
      // the teammate's top spot (§5.12.4), skipping 'top' (the handler's check spot) and a spot already taken
      const order = spotOrder(p.id);
      let best = null;
      for (let k = 0; k < order.length && !best; k++) if (order[k] !== usedA && order[k] !== 'top') best = order[k];
      usedA = best;
      const s = SLOTS_V2[best] || SLOTS_V2.leftWing;
      to.x = s.x; to.z = s.z;
    }
    const def = this.roster[1 - offense];
    for (let i = 0; i < 3; i++) {
      const p = def[i], to = this.checkTo[p.idx], a = this.checkTo[(p.defAssign || att[i]).idx];
      to.x = lerp(a.x, RIM.x, FORMATION.DEF_LERP); to.z = lerp(a.z, RIM.z, FORMATION.DEF_LERP); to.yaw = FORMATION.DEFENSE_YAW;
    }
    if (snap) {
      for (let i = 0; i < 6; i++) { const p = this.players[i], to = this.checkTo[i]; p.reset(to.x, to.z, to.yaw); silenceIntent(p.intent); }
      this.giveBall(handler, 'held', null);
    }
  }

  /** Attach the ball to p (catch semantics for the animator); passer for the assist chain. */
  giveBall(p, mode, passer) {
    this.ball.attachTo(p, mode);
    p.animator.onCatch(mode === 'dribble' ? 'dribble' : 'held');
    p.cx.catchT = this.world.time; p.cx.jabsThisHold = 0; p.cx.holdStartT = this.world.time; p.cx.comboIndex = 1;
    p.cx.dribbles = 0;
    if (this.world.state === 'LIVE' || this.world.state === 'CHECK') this.metrics.catchBall(p.id, p.team, this.world.time, passer ? passer.id : null);
  }

  enterCheck(offense, reason) {
    const w = this.world;
    this.applyPendingRules();
    w.offense = offense;
    w.shotClock = Math.min(CLOCK.SHOT, Math.max(w.gameClock, FIXED_DT));
    w.deadReason = null;
    w.clearPending = -1; w.cleared = true;
    this.lastShotSec = Math.ceil(w.shotClock - 1e-4);
    this.possessionCount++;
    this.buzzerPending = false; this.buzzerLooseT = 0;
    this.endShotTracking();
    // check-ball receiver (§5.12.4, R8)
    let handler;
    if (w.user === offense && !w.auto) handler = this.roster[offense][0];
    else {
      const r = this.roster[offense];
      CHECK_IDS[0] = r[0].id; CHECK_IDS[1] = r[1].id; CHECK_IDS[2] = r[2].id;
      handler = r[pickCheckReceiver(CHECK_IDS, this.rng, this.checkStates[offense])];
    }
    for (let i = 0; i < 6; i++) {
      const p = this.players[i], from = this.checkFrom[i];
      if (p.state === 'celebrate' || p.animator.action >= 0) p.animator.stopAction();   // B51: no celebration into the tween
      p.isJumping = false; p.jumpY = 0; p.hanging = false;
      p.shot.active = false; p.move.active = false; p.passAct.active = false; p.stealAct.active = false; p.defJump.active = false;
      p.state = 'idle'; p.stunT = 0; p.fallenT = 0; p.celebrateT = 0; p.boxT = 0; p.pushT = 0; p.chaseT = 0;
      p.cx.ankleThisPoss = false; p.cx.ankledThisPoss = false; p.cx.lastPumpFakeT = -1e9; p.cx.lastJabT = -1e9; p.cx.lastMoveId = '';
      silenceIntent(p.intent);
      from.x = p.pos.x; from.z = p.pos.z; from.yaw = p.yaw;
      p.offense = p.team === offense;
      if (p.hasBall) { p.hasBall = false; p.ballMode = null; }
    }
    this.placeFormation(offense, handler, false);
    this.giveBall(handler, 'held', null);
    this.metrics.handlerPossession(handler.id);
    if (w.user === offense) this.setControlled(handler);
    else {
      let d = null;
      for (let i = 0; i < 3; i++) if (this.roster[1 - offense][i].defAssign === handler) d = this.roster[1 - offense][i];
      this.setControlled(d || this.roster[w.user][0]);
    }
    if (this.input && this.input.setOffense) this.input.setOffense(this.userIsOffense());
    this.setState('CHECK', reason || 'check');
    this.banner('banner.check', 0, CHECK_BANNER_MS);
    const e = this.ev('possession', handler);
    e.reason = reason || 'check';
    this.fire(e);
  }

  goLive() {
    const w = this.world;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i], to = this.checkTo[i];
      p.pos.x = to.x; p.pos.z = to.z; p.yaw = to.yaw; p.vel.set(0, 0, 0);
      p.offense = p.team === w.offense;
    }
    w.liveT = 0;
    this.metrics.possessionStart(w.offense);
    this.setState('LIVE', 'check');
  }

  /** Any dead ball: reason MADE | TURNOVER | OOB | SHOT_CLOCK; `nextOffense` gets the next CHECK. */
  deadBall(reason, nextOffense, seconds) {
    const w = this.world;
    if (w.state !== 'LIVE' && w.state !== 'DEAD') return;
    w.deadReason = reason;
    this.deadT = seconds > 0 ? seconds : (DEAD_SECONDS[reason] || CLOCK.DEAD.TURNOVER);
    this.nextOffense = nextOffense === 1 ? 1 : 0;
    if (w.state === 'LIVE') this.metrics.possessionEnd(reason);
    this.endShotTracking();
    // §3.5.5 sweat, set on each dead ball from the minutes played (all six play the whole game)
    const sweat = Math.min(1, this.clockPlayed / SWEAT_FULL_S);
    for (let i = 0; i < 6; i++) { const c = this.players[i].character; if (c && typeof c.setSweat === 'function') c.setSweat(sweat); }
    for (let i = 0; i < 6; i++) {
      const p = this.players[i];
      silenceIntent(p.intent);
      // the whistle cancels every action that has not released yet (no launch after the dead ball)
      if (p.shot.active && !p.shot.launched) { p.shot.active = false; if (!p.isJumping) { p.animator.stopAction(); p.setState('idle'); } }
      p.passAct.active = false; p.stealAct.active = false; p.cx.queued = false;
      if (p.state === 'cross') { p.animator.stopAction(); p.setState('idle'); p.move.active = false; }
      if (!p.isJumping && p.state !== 'dunk') p.vel.set(0, 0, 0);
    }
    if (w.offense !== this.nextOffense) {
      w.offense = this.nextOffense;
      if (this.input && this.input.setOffense) this.input.setOffense(this.userIsOffense());
      const e = this.ev('possession', null);
      e.team = w.offense; e.reason = reason;
      this.fire(e);
    }
    this.setState('DEAD', reason);
  }

  /** Pending-shot miss bookkeeping closes when the possession ends. */
  endShotTracking() {
    const P = this.pending;
    if (P.active && !P.missed) this.resolveMiss(false);
    P.active = false;
  }

  // ---------------------------------------------------------------- periods
  onGameClockZero() {
    const w = this.world;
    w.gameClock = 0;
    const e = this.ev('buzzer', null); e.kind = 'period'; this.fire(e);
    const bs = this.ball.state, b = this.ball;
    const rattling = bs === 'loose' && b.ctx === 'shot' && b.shot.active && b.shot.touched;
    if (bs === 'flight' || bs === 'scored' || rattling || this.shotReleasedPending()) {
      this.buzzerPending = true;
      this.buzzerLooseT = this.ball.state === 'loose' ? this.ball.looseT : 0;   // R4: seeded from looseT
    } else this.endPeriod();
  }

  endPeriod() {
    const w = this.world;
    if (w.state === 'LIVE') this.metrics.possessionEnd('PERIOD');
    this.buzzerPending = false;
    this.endShotTracking();
    for (let i = 0; i < 6; i++) silenceIntent(this.players[i].intent);
    this.setState('QUARTER_END', 'period');
    const q = w.quarter, tied = this.score[0] === this.score[1];
    const e = this.ev('quarter', null); e.q = q; e.ot = q > CLOCK.QUARTERS; this.fire(e);
    if (q >= CLOCK.QUARTERS && !tied) this.banner('banner.final', 0, PERIOD_BANNER_MS);
    else if (q >= CLOCK.QUARTERS) this.banner('banner.overtime', 0, PERIOD_BANNER_MS);
    else this.banner('banner.quarterEnd', q, PERIOD_BANNER_MS);
  }

  advancePeriod() {
    const w = this.world;
    const q = w.quarter, tied = this.score[0] === this.score[1];
    if (q === 2) this.setState('HALFTIME', 'halftime');
    else if (q >= CLOCK.QUARTERS && !tied) this.gameOver();
    else this.nextQuarter();
  }

  nextQuarter() {
    const w = this.world;
    w.quarter++;
    w.gameClock = w.quarter > CLOCK.QUARTERS ? CLOCK.OT : this.quarterSeconds;
    this.periodOpen = this.openingPossession(w.quarter);
    this.enterCheck(this.periodOpen, 'quarter');
  }

  gameOver() {
    const winner = this.score[0] === this.score[1] ? -1 : (this.score[0] > this.score[1] ? 0 : 1);
    let mvp = null, mvpS = -Infinity;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i], s = p.stats, r = this.boxRows[i];
      r.id = p.id; r.team = p.team; r.pts = s.pts; r.fgm = s.fgm; r.fga = s.fga; r.tpm = s.tpm; r.tpa = s.tpa; r.reb = s.reb; r.ast = s.ast; r.stl = s.stl; r.blk = s.blk;
      if (p.team !== winner) continue;
      // §6.5.9 MVP: PTS + 1.2·REB + 1.5·AST + 3·STL + 3·BLK − 0.8·(FGA − FGM); ties: more PTS, then lower roster index
      const v = s.pts + 1.2 * s.reb + 1.5 * s.ast + 3 * s.stl + 3 * s.blk - 0.8 * (s.fga - s.fgm);
      if (v > mvpS + 1e-9 || (Math.abs(v - mvpS) <= 1e-9 && mvp && (s.pts > mvp.stats.pts || (s.pts === mvp.stats.pts && p.index < mvp.index)))) { mvpS = v; mvp = p; }
    }
    this.setState('GAME_OVER', 'final');
    const e = this.ev('gameover', mvp);
    e.winner = winner; e.mvpId = mvp ? mvp.id : null; e.box = this.boxRows;
    this.fire(e);
  }

  // ---------------------------------------------------------------- the fixed step
  step(dt) {
    const w = this.world;
    if (this.paused) { this.stepPaused(dt); return; }
    const s = w.state;
    if (s === 'MENU' || s === 'LINEUP' || s === 'INTRO') return;
    w.time += dt;
    this.stateT += dt;
    if (this.meter.flashT > 0) { this.meter.flashT -= dt; if (this.meter.flashT <= 0) { this.meter.flashT = 0; this.meter.flash = null; } }
    if (s === 'CHECK') { this.stepCheck(dt); return; }
    if (s === 'HALFTIME') { this.stepIdle(dt); if (this.stateT >= CLOCK.HALFTIME) this.nextQuarter(); return; }
    if (s === 'GAME_OVER') { this.stepIdle(dt); return; }
    if (s === 'QUARTER_END') { this.stepIdle(dt); if (this.stateT >= CLOCK.QUARTER_END) this.advancePeriod(); return; }
    if (s === 'DEAD') {
      this.deadT -= dt;
      if (this.deadT <= 0) { if (w.gameClock <= 0) this.endPeriod(); else this.enterCheck(this.nextOffense, 'dead'); return; }
    } else {
      this.stepClocks(dt);
      if (w.state !== 'LIVE') return;
      w.liveT += dt;
    }
    this.ai.updateAI(w, dt);
    this.applyInput();
    const live = w.state === 'LIVE';
    if (live) this.processIntents(dt);
    const ps = this.players;
    for (let i = 0; i < 6; i++) ps[i].step(dt, w);
    this.consumeAnimEvents();
    if (w.state === 'LIVE') this.stepContacts(dt);
    resolveSeparation(ps);
    const events = this.ball.step(dt, this.ballEvents);
    for (let i = 0; i < events.length; i++) this.resolveBallEvent(events[i]);
    if (w.state === 'LIVE') { this.resolveCatch(); this.stepRest(dt); this.stepClear(); }
    if (this.animMode === 'real') this.updateLooks();
    else if (w.state === 'DEAD') this.stepHabits(dt);
    this.updateMeter();
    this.checkInvariants();
  }

  stepPaused(dt) {
    if (!this.resuming) return;
    this.resumeT -= dt;
    const n2 = Math.max(1, Math.ceil(this.resumeT - 1e-6));
    if (this.resumeT > 0) { if (n2 !== this.resumeShown) { this.resumeShown = n2; this.banner('banner.resume', n2, 1500); } return; }
    this.resuming = false; this.paused = false; this.world.paused = false;
  }

  /** Players stand (animators keep running: idle habits, celebrations) in QUARTER_END / HALFTIME / GAME_OVER. */
  stepIdle(dt) {
    for (let i = 0; i < 6; i++) { silenceIntent(this.players[i].intent); this.players[i].step(dt, this.world); }
    this.consumeAnimEvents();
    resolveSeparation(this.players);
    this.ball.step(dt, this.ballEvents);
    this.stepHabits(dt);
  }

  /** v1 §8 CHECK: 0.8 s smoothstep tween into the formation, LIVE after 1.2 s. */
  stepCheck(dt) {
    const k = smoothstep(Math.min(this.stateT / FORMATION.TWEEN_T, 1));
    for (let i = 0; i < 6; i++) {
      const p = this.players[i], from = this.checkFrom[i], to = this.checkTo[i];
      p.stepKinematic(dt, lerp(from.x, to.x, k), lerp(from.z, to.z, k), lerpAngle(from.yaw, to.yaw, k));
      while (p.animator.events.next()) { /* CHECK: events are cosmetic */ }
    }
    this.ball.prevPos.copy(this.ball.pos);
    if (this.ball.owner) this.ball.placeOnOwner();
    const kyrie = this.ball.owner;
    this.ball.spinMode = kyrie && kyrie.id === 'kyrie' ? 'finger' : null;
    this.stepHabits(dt);
    if (this.stateT >= CLOCK.CHECK) { this.ball.spinMode = null; this.goLive(); }
  }

  /**
   * Clocks (v1 + R3/R4): the shot clock whistles only if it was already 0 at the start of a step and no released
   * shot is live; the game clock buzzer waits for a released shot (R4).
   */
  stepClocks(dt) {
    const w = this.world;
    if (this.buzzerPending) { this.stepBuzzer(dt); return; }
    const wasZero = w.shotClock <= 0;
    if (wasZero && !this.shotLive()) { this.shotClockViolation(); return; }
    w.gameClock -= dt;
    this.clockPlayed += dt;
    this.metrics.liveTick(dt); this.metrics.addGameTime(dt);
    const gs = Math.ceil(w.gameClock - 1e-4);
    if (gs < this.lastGameSec && gs < CLOCK.TICK_BELOW && gs >= 0) { const e = this.ev('clock', null); e.sec = gs; e.what = 'game'; this.fire(e); }
    this.lastGameSec = gs;
    if (w.gameClock <= 0) { this.onGameClockZero(); return; }
    w.shotClock -= dt;
    if (w.shotClock > w.gameClock) w.shotClock = w.gameClock;
    if (w.shotClock < 0) w.shotClock = 0;
    const sec = Math.ceil(w.shotClock - 1e-4);
    if (sec !== this.lastShotSec) {
      if (sec < this.lastShotSec && sec < CLOCK.TICK_BELOW) { const e = this.ev('clock', null); e.sec = sec; e.what = 'shot'; this.fire(e); }
      this.lastShotSec = sec;
    }
  }

  /** A released shot is in play (rules: released with clock > 0, R3; dunks count from the press). */
  shotLive() {
    const b = this.ball;
    if (b.state === 'flight' || b.state === 'scored') return true;
    if (b.state === 'loose' && b.ctx === 'shot' && b.shot.active && b.shot.touched) return true;   // R2: an untouched miss keeps the clock
    return this.shotReleasedPending();
  }

  shotReleasedPending() {
    for (let i = 0; i < 6; i++) {
      const s = this.players[i].shot;
      if (s.active && !s.launched && (s.released || (s.kind === 'dunk' && s.takeoff))) return true;
    }
    return false;
  }

  shotClockViolation() {
    const w = this.world;
    const e = this.ev('buzzer', null); e.kind = 'shotClock'; this.fire(e);
    this.caption('cap.shotClock', null, 3);
    const t = this.ev('turnover', w.controlled); t.reason = 'shotClock'; t.team = w.offense; this.fire(t);
    this.metrics.turnover(w.offense, 'shotClock');
    this.deadBall('SHOT_CLOCK', 1 - w.offense, CLOCK.DEAD.SHOT_CLOCK);
  }

  /** R4: after the buzzer, the period ends when the shot has been loose 0.5 s in total, or the ball is caught. */
  stepBuzzer(dt) {
    const bs = this.ball.state;
    if (bs === 'flight' || bs === 'scored' || this.shotReleasedPending()) return;
    if (bs === 'loose') { this.buzzerLooseT += dt; if (this.buzzerLooseT < CLOCK.BUZZER_LOOSE) return; }
    this.endPeriod();
  }

  /** Copies the human intent into the controlled player (edges deduped by DOM timestamp, v1). */
  applyInput() {
    const w = this.world, input = this.input;
    if (w.auto || !input || !input.intent || !w.controlled) return;
    const src = input.intent, dst = w.controlled.intent, seen = this.edgeSeen;
    dst.move.x = src.move.x; dst.move.z = src.move.z; dst.move.mag = src.move.mag; dst.move.idle = src.move.idle;
    dst.sprint = src.sprint; dst.post = false;
    copyButton(dst.primary, src.primary, 'primaryP', 'primaryR', seen);
    copyButton(dst.secondary, src.secondary, 'secondaryP', 'secondaryR', seen);
    copyButton(dst.tertiary, src.tertiary, 'tertiaryP', 'tertiaryR', seen);
    if (src.pause && src.pause.justPressed) { src.pause.justPressed = false; this.togglePause(); }
  }

  // ---------------------------------------------------------------- intents → actions (LIVE)
  processIntents(dt) {
    const w = this.world;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i], it = p.intent;
      if (p.team === w.offense) {
        if (p.shot.active) { this.updateShot(p, it); continue; }
        if (p.hasBall && this.ball.owner === p) this.handlerInput(p, it, dt);
        else if (it.primary.justPressed && p.canAct && this.ball.isFree) this.startDefJump(p, 'rebound', false, false);
      } else this.defenseInput(p, it);
    }
  }

  handlerInput(p, it, dt) {
    const w = this.world, ball = this.ball;
    const st = p.state;
    // dribble starts once the holder moves after the catch hold (v1 HOLD_AFTER_CATCH) — not on the step SHOOT is
    // pressed: holding + stick away + SHOOT is the fadeaway (§5.9 row 14), which a dribble started first turned into a
    // stepback (I3)
    if (p.holding && !it.primary.justPressed && ball.holdT >= BALL.HOLD_AFTER_CATCH && (st === 'move' || it.move.mag > 0.2) && (st === 'idle' || st === 'move')) this.startDribble(p);
    if (st === 'post') {
      const ex = postExit(p, it, dt);
      if (ex === 'faceUp') { this.leavePost(p, true); return; }
      if (ex === 'drive') { this.leavePost(p, false); this.startDribble(p); }
    } else if (updatePostDetector(p, it, w, dt)) { this.enterPost(p); return; }
    const free = !p.isJumping && (st === 'idle' || st === 'move' || st === 'cross' || st === 'post' || st === 'faceUp');
    if (!free || p.passAct.active) return;
    const pressed = it.primary.justPressed, cross = it.tertiary.justPressed;
    const passEdge = it.secondary.justReleased || (it.secondary.justPressed && !it.secondary.held);
    // SPRINT specials start from idle / move; Kobe's rip-through also branches out of a jab past its first cancel point
    const ripOK = st === 'cross' && p.cx.jabsThisHold >= 2 && p.move.active && w.time - p.move.startT >= p.move.cancelT;
    if (!pressed && !cross && !passEdge && !(it.sprint && (st === 'idle' || st === 'move' || ripOK))) return;
    if (passEdge && st === 'cross') return;
    const r = resolveOffense(p, it, w);
    switch (r.action) {
      case 'shot': this.startShot(p, r, pressed ? it.primary.pressTs : 0); break;
      case 'combo': {
        // Both CROSS taps of a double tap folded into this one step (a slow frame; input reports taps = 2 and
        // doubleTap at DOM time) with no move running and no earlier tap seen: the first tap starts its move now and
        // the second queues the combo move, exactly as two separate steps would (§5.7).
        const merged = cross && it.tertiary.doubleTap && !(st === 'cross' && p.move.active) && !(w.time - p.cx.lastCrossT <= SHAKE.COMBO_WINDOW);
        this.queueCombo(p, r);
        if (merged && p.move.active && comboAllowed(p, w)) { COMBO2.comboIndex = p.cx.comboIndex + 1; this.queueCombo(p, COMBO2); }
        break;
      }
      case 'move': this.startMove(p, r.moveId, r.mirror, 1); break;
      case 'jab': this.startJab(p, r.moveId, r.mirror); break;
      case 'pumpFake': this.startPumpFake(p, r.moveId); break;
      case 'pass': this.startPass(p, r.target, r.lob); break;
      case 'drive': this.startMove(p, r.moveId, false, 1); break;
      default: break;
    }
    if (cross) p.cx.lastCrossT = w.time;
  }

  defenseInput(p, it) {
    const w = this.world;
    const user = this.isUserControlled(p);
    if (!(it.primary.justPressed || it.tertiary.justPressed || it.secondary.justPressed)) return;
    const r = resolveDefense(p, it, w);
    switch (r.action) {
      case 'jump': if (p.canAct || p.state === 'steal') this.startDefJump(p, r.intent, r.chase, r.help, r.shooter); break;
      case 'poke': this.startPoke(p, user); break;
      case 'lunge': this.startLunge(p); break;
      case 'switch': this.switchDefender(); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- animator events (§1.3 step 5)
  consumeAnimEvents() {
    const w = this.world;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i];
      const a = p.animator;
      for (let e; (e = a.events.next());) {
        // jumps, shot releases, slams and clip ends belong to the action layer; a pass may run on the upper layer
        const act = e.layer === 0;
        switch (e.code) {
          case EV.TAKEOFF: if (act) this.onTakeoff(p, a.time - e.t); break;
          case EV.RELEASE:
            if (act && p.shot.active && !p.shot.launched && p.shot.kind !== 'dunk') this.launchShot(p);
            else if (p.passAct.active) this.launchPass(p);
            break;
          case EV.SLAM: if (act && p.shot.active && p.shot.kind === 'dunk' && !p.shot.slamDone) this.resolveSlam(p); break;
          case EV.SWIPE: if (p.stealAct.active && !p.stealAct.resolved) this.resolvePoke(p); break;
          case EV.FAKE: if (p.move.active && !p.move.resolved && p.cx.lastMoveId === p.move.id && p.state === 'cross' && p.move.id.indexOf('jab') >= 0) this.resolveJabBite(p); break;
          case EV.PLANT_L: case EV.PLANT_R:
            if (p.move.active && !p.move.resolved && p.state === 'cross' && MOVES_V2[p.move.id]) this.resolveShake(p);
            { const pe = this.ev('plant', p); pe.decel = p.decelNow; pe.turnRate = p.turnRateNow; pe.what = e.code === EV.PLANT_L ? 'L' : 'R'; this.fire(pe); }
            break;
          case EV.BOUNCE: if (p.hasBall && p.dribbling) p.dribbleBounced = true; break;
          case EV.END: if (act) this.onClipEnd(p); break;
          default: break;
        }
      }
      if (p.landedNow) this.onLand(p);
      if (p.plantNow) { const pe = this.ev('plant', p); pe.decel = p.decelNow; pe.turnRate = p.turnRateNow; pe.what = 'gait'; this.fire(pe); }
      if (p.state === 'cross' && p.move.active) {
        const age = w.time - p.move.startT;
        // moves without a PLANT event resolve the shake at 0.25 s; jab clips without a FAKE event bite at 0.15 s
        if (!p.move.resolved && age >= SHAKE_FALLBACK_T && MOVES_V2[p.move.id]) this.resolveShake(p);
        else if (!p.move.resolved && age >= JAB_FALLBACK_T && p.move.id.indexOf('jab') >= 0 && p.move.id === p.cx.lastMoveId) this.resolveJabBite(p);
        if (p.cx.queued && age >= p.move.cancelT) this.runQueuedMove(p);
        else if (p.animator.action !== p.move.clipIdx && p.move.clipIdx >= 0 && w.time - p.move.startT > 0.05) this.onClipEnd(p);
      }
      if (p.passAct.active && w.time - p.passAct.startT > p.passAct.releaseT + 0.15) this.launchPass(p);   // clip interrupted: release anyway
      if (p.stealAct.active && !p.stealAct.resolved && w.time - p.stealAct.startT > 0.25) this.resolvePoke(p);
    }
  }

  onTakeoff(p, since) {
    const s = p.shot, w = this.world;
    if (s.active && !s.takeoff) {
      s.takeoff = true; s.takeoffVx = p.vel.x; s.takeoffVz = p.vel.z;
      s.contactDef = findContactDefender(p, w);
      const tm = s.timing;
      if ((s.kind === 'layup' || s.kind === 'dunk') && has(p, 'jordan.air')) {
        const c = resetAbilityCtx(ACTX); c.t = w.time; c.log = this.abilityLog; c.kind = s.kind; c.variant = s.variant; mul(p, 'airtime', c);
      }
      p.startJump(tm.h, tm.airT, s.kind === 'dunk' && tm.profile && tm.profile.slam > 0 ? tm.profile : null, s.kind === 'dunk' ? 'dunk' : 'shot', since);
      if (!s.confirmed) this.confirmShot(p);
      const e = this.ev('takeoff', p); e.kind = s.kind; e.h = tm.h; this.fire(e);
      return;
    }
    if (p.defJump.active || p.state === 'jump') {
      const h = p.defJump.h > 0 ? p.defJump.h : p.attrs.hJump;
      p.startJump(h, 2 * Math.sqrt(2 * h / BALL.G), null, p.defJump.intent || 'def', since);
      const e = this.ev('takeoff', p); e.kind = p.defJump.intent; e.h = h; this.fire(e);
    }
  }

  onLand(p) {
    const s = p.shot;
    const e = this.ev('land', p); e.dropH = p.landDropH; e.massKg = p.legend.stats.weightKg; this.fire(e);
    if (s.active && s.kind === 'dunk' && !s.slamDone) this.resolveSlam(p);
    if (s.active && s.meter && !s.released && this.ball.owner === p) {
      // still holding at the landing: the clock auto-released; treat as the release input now
      this.releaseShot(p, (this.world.time - s.pressT) - s.tIdeal, false);
      this.launchShot(p);
    }
    p.defJump.active = false; p.chaseShooter = null;
    if (p.celebrateOnLand) { p.celebrateOnLand = false; p.startCelebration(p.celebrateClip, p.celebrateMirror); return; }
    const st = p.state;
    if (st === 'release' || st === 'jump' || st === 'dunk' || st === 'windup' || st === 'layup') {
      if (!s.active || s.launched || s.slamDone) { s.active = false; p.setState('idle'); }
    }
  }

  onClipEnd(p) {
    const st = p.state;
    if (st === 'cross') {
      p.move.active = false;
      p.cx.lastMoveEndT = this.world.time;
      p.moveCd = (MOVES_V2[p.move.id] && !p.cx.queued) ? MOVES_V2[p.move.id].cooldown : 0;
      p.cx.comboIndex = 1;
      p.setState('idle');
    } else if (st === 'steal') { p.stealAct.active = false; p.setState('idle'); }
    else if (st === 'release' && !p.isJumping) { p.shot.active = false; p.setState('idle'); }
    else if (st === 'jump' && !p.isJumping) { p.defJump.active = false; p.setState('idle'); }
    else if (st === 'faceUp') { p.faceUpT = 0; p.setState('idle'); }
  }

  // ---------------------------------------------------------------- catches and rebounds
  resolveCatch() {
    const ball = this.ball;
    if (!ball.isFree) return;
    if (ball.state === 'flight' && ball.pos.y >= RIM.y) return;       // no goaltending: a shot above the rim cannot be caught
    const passer = ball.state === 'pass' && ball.releaseAge < BALL.CATCH_FLIGHT_AGE ? ball.passInfo.from : null;
    const victim = ball.ctx === 'steal' && ball.releaseAge < STEAL.VICTIM_EXCLUSION ? this.stealVictim : null;
    let best = null, bestS = -Infinity;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i];
      if (p === passer || p === victim || !ball.canBeCaughtBy(p)) continue;
      if (ball.state === 'pass' && p.team !== ball.passInfo.team) continue;      // defenders take a pass only by interception
      if (this.tryTip(p)) return;
      const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z, d = Math.sqrt(dx * dx + dz * dz);
      let s = 1 - d / p.attrs.catchR;
      if (ball.ctx === 'shot') {
        // §5.6 rebound tie-break: rating, box-out bonus, height, random
        s += REBOUND.RATING_W * n(p.legend.ratings.rebound) + REBOUND.HEIGHT_W * (p.legend.stats.heightM - REBOUND.HEIGHT_REF) / REBOUND.HEIGHT_DIV + this.rng.range(0, REBOUND.RAND_MAX);
        if (p.boxT > 0 && p.boxing) s += REBOUND.BOX_BASE + REBOUND.BOX_K * (p.legend.ratings.strength - p.boxing.legend.ratings.strength);
      }
      if (s > bestS) { bestS = s; best = p; }
    }
    if (best) this.onCatch(best, null);
  }

  /** Tip / putback (§5.6, [ANIM §5.7]): an airborne offensive player near the rim reaching a descending missed shot. */
  tryTip(p) {
    const ball = this.ball, w = this.world;
    if (p.team !== w.offense || !p.isJumping || ball.ctx !== 'shot' || ball.vel.y >= 0 || ball.state === 'pass') return false;
    if (ball.rimDistance() > REBOUND.TIP_RIM_R) return false;
    const s = p.shot;
    if (s.active && !s.launched) return false;
    const putDunk = (p.id === 'lebron' || p.id === 'giannis' || p.id === 'yao') && ball.rimDistance() <= REBOUND.PUTBACK_RIM_R
      && p.legend.stats.reachM + p.jumpY >= REBOUND.PUTBACK_REACH && C_PUT_DUNK >= 0;
    // the tip is a new shot: kind 'tip' (close zone, T 0.85), evaluated and rolled now, launched from the hand
    this.ball.attachTo(p, 'held');
    s.active = true; s.kind = putDunk ? 'dunk' : 'tip'; s.variant = putDunk ? 'putback' : null; s.timing = null; s.meter = false;
    s.pressT = w.time; s.released = true; s.releaseInT = w.time; s.takeoff = true; s.takeoffVx = p.vel.x; s.takeoffVz = p.vel.z;
    s.contactDef = null; s.launched = false; s.excluded = null; s.forcedP = NaN; s.sagA = 1; s.catchToPress = NaN; s.fromDrive = false;
    s.confirmed = true; s.slamDone = false; s.putback = true; s.eT = NaN; s.x = p.pos.x; s.z = p.pos.z;
    if (putDunk) {
      // put.dunk: caught at the apex and slammed at once (no hang); the slam resolves like any dunk (p ≤ 0.995, R11)
      p.animator.onCatch('held');
      p.playClip(C_PUT_DUNK, null);
      p.setState('dunk');
      this.resolveSlam(p);
      return true;
    }
    if (C_PUT_TIP >= 0 && p.animator.action !== C_PUT_TIP) p.animator.play(C_PUT_TIP, { layer: 'upper' });
    this.evaluateAndRoll(p, NaN);
    s.points = 2;
    s.launched = false;
    this.launchShot(p);
    return true;
  }

  /** Catch outcomes (§5.6, §5.13 R2 / R6 / R9). `how` = 'intercept' for an interception catch. */
  onCatch(p, how) {
    const w = this.world, ball = this.ball;
    const prev = ball.state, ctx = ball.ctx;
    const passer = prev === 'pass' || ctx === 'pass' ? ball.passInfo.from : null;
    const shotTouched = ball.shot.touched;
    const wasShot = ctx === 'shot' || ctx === 'block';
    if (wasShot && this.pending.active && !this.pending.missed) this.resolveMiss(false);
    this.giveBall(p, 'held', p.team === w.offense && passer && passer.team === p.team ? passer : null);
    ball.shot.active = false;
    const ce = this.ev('catch', p); ce.fromId = passer ? passer.id : null; ce.how = how || null; this.fire(ce);
    if (p.team === w.offense) {
      if (wasShot) {
        p.stats.reb++; p.stats.oreb++;
        this.metrics.rebound(p.id, p.team, true);
        if (shotTouched) { w.shotClock = Math.min(CLOCK.SHOT, Math.max(w.gameClock, FIXED_DT)); this.lastShotSec = Math.ceil(w.shotClock - 1e-4); }   // R2
        this.caption('cap.rebound', p, 1);
        const e = this.ev('rebound', p); e.offensive = true; this.fire(e);
      }
      if (w.user === w.offense && !w.auto) this.setControlled(p);
      else this.autoSwitch(p);
      ball.ctx = 'none';
      return;
    }
    // defensive catch: STL for a poked ball or a pass (also floor-bounced, R6), else a defensive rebound
    if (ctx === 'pass' || how === 'intercept') {
      p.stats.stl++;
      this.metrics.steal(p.id, p.team, how === 'intercept' ? 'intercept' : 'pass');
      if (passer) this.metrics.intercept(passer.team);
      this.caption('cap.steal', p, 2);
      // an interception books the STL with its own event ('intercept'); a floor-bounced pass caught by the defence is a 'steal'
      const e = this.ev(how === 'intercept' ? 'intercept' : 'steal', p); e.how = how === 'intercept' ? 'intercept' : 'pass'; e.fromId = passer ? passer.id : null; this.fire(e);
    } else if (ctx === 'steal') {
      p.stats.stl++;
      this.metrics.steal(p.id, p.team, 'poke');
      this.caption('cap.steal', p, 2);
      const e = this.ev('steal', p); e.how = 'poke'; e.fromId = this.stealVictim ? this.stealVictim.id : null; this.fire(e);
    } else {
      p.stats.reb++;
      this.metrics.rebound(p.id, p.team, false);
      this.caption('cap.rebound', p, 1);
      const e = this.ev('rebound', p); e.offensive = false; this.fire(e);
    }
    ball.ctx = 'none';
    if (this.rules.clear) { this.liveFlip(p); return; }
    this.metrics.handlerPossession(p.id);
    this.deadBall('TURNOVER', p.team, CLOCK.DEAD.TURNOVER);
  }

  /**
   * Auto-switch (R10, §5.9.3, default ON): on an opponent's catch, control moves to the defender assigned to the catcher
   * when the user's stick has been idle (< 0.15) for ≥ 0.40 s, no button is held and the user is not airborne.
   */
  autoSwitch(c) {
    const w = this.world, u = w.controlled;
    if (!this.rules.autoSwitch || w.auto || !u || u.team !== w.user || c.team === w.user) return;
    const it = u.intent;
    if (u.isJumping || it.primary.held || it.secondary.held || it.tertiary.held || !(it.move.idle >= AUTO_SWITCH_IDLE)) return;
    const mates = this.roster[w.user];
    for (let i = 0; i < 3; i++) if (mates[i].defAssign === c && mates[i] !== u) { this.setControlled(mates[i]); return; }
  }

  /** R9 clear-the-ball: a defensive catch keeps LIVE; possession flips; shot clock 14; the new offence must clear. */
  liveFlip(p) {
    const w = this.world;
    this.metrics.possessionEnd('CLEAR');
    w.offense = p.team;
    w.shotClock = Math.min(CLOCK.SHOT, Math.max(w.gameClock, FIXED_DT));
    this.lastShotSec = Math.ceil(w.shotClock - 1e-4);
    w.clearPending = p.team; w.cleared = false;
    for (let i = 0; i < 6; i++) this.players[i].offense = this.players[i].team === w.offense;
    this.assignMatchups(w.offense);
    if (w.user === p.team && !w.auto) this.setControlled(p);
    else if (!w.auto) { let d = null; for (let i = 0; i < 3; i++) if (this.roster[w.user][i].defAssign === p) d = this.roster[w.user][i]; if (d) this.setControlled(d); }
    if (this.input && this.input.setOffense) this.input.setOffense(this.userIsOffense());
    this.metrics.possessionStart(w.offense);
    this.metrics.handlerPossession(p.id);
    this.caption('cap.clear', p, 2);
    const e = this.ev('possession', p); e.reason = 'clear'; this.fire(e);
  }

  /** R9: a holder / dribbler of the new offence with feet beyond the arc for one step clears the ball. */
  stepClear() {
    const w = this.world;
    if (w.cleared) return;
    const o = this.ball.owner;
    if (o && o.team === w.clearPending && isThree(o.pos.x, o.pos.z)) { w.cleared = true; w.clearPending = -1; }
  }

  // ---------------------------------------------------------------- ball events
  resolveBallEvent(ev) {
    const w = this.world, live = w.state === 'LIVE';
    switch (ev.type) {
      case 'bounce': case 'floor': case 'rim': case 'board': {
        const e = this.ev('ball', ev.player); e.what = ev.type; e.strength = ev.value;
        e.x = this.ball.pos.x; e.z = this.ball.pos.z; this.fire(e);
        if (ev.type === 'board' && this.pending.active) this.pending.bank = true;
        if ((ev.type === 'rim' || ev.type === 'board' || ev.type === 'floor') && this.pending.active && !this.ball.shot.make && !this.pending.missed) {
          if (ev.type !== 'floor') this.caption('cap.miss', this.pending.shooter, 1);
          this.resolveMiss(false);
        }
        break;
      }
      case 'score': if (live || this.buzzerPending) this.onScore(this.ball.shot.points, ev.player, ev.value === 1); break;
      case 'oob': if (live) this.onOutOfBounds(ev.player, 'oob'); else this.stopBall(); break;
      case 'rest': if (live) this.onOutOfBounds(ev.player, 'rest'); break;
      case 'nan':
        this.debug.invariantsBroken++;
        if (w.state === 'LIVE' || w.state === 'DEAD') this.enterCheck(w.offense, 'nan');
        break;
      default: break;
    }
  }

  inClutch(team) {
    const w = this.world;
    return w.quarter >= SHOT_V2.CLUTCH_QUARTER && w.gameClock <= SHOT_V2.CLUTCH_CLOCK && Math.abs(this.score[team] - this.score[1 - team]) <= SHOT_V2.CLUTCH_DIFF;
  }

  /**
   * A basket (R5): the shooter of the pending shot scores its points even after a deflection / block; a different
   * offensive player who tipped it scores 2. `dunk` = slam / putback (already booked).
   */
  onScore(points, scorer, swishOrDunk) {
    const w = this.world, off = w.offense, b = this.ball.shot;
    const shooter = b.shooter;
    let credit = scorer && scorer.team === off ? scorer : (shooter && shooter.team === off ? shooter : null);
    if (!credit) credit = shooter || this.roster[off][0];
    const ownShot = credit === shooter && b.active;
    const pts = ownShot ? (b.points === 3 ? 3 : 2) : 2;
    if (credit.team !== off) return;
    // R9: a basket of an offence that has not cleared is waved off
    if (this.rules.clear && !w.cleared && w.clearPending === off) {
      this.caption('cap.notCleared', credit, 3);
      const te = this.ev('turnover', credit); te.reason = 'notCleared'; te.team = off; this.fire(te);
      this.metrics.turnover(off, 'notCleared');
      this.deadBall('TURNOVER', 1 - off, CLOCK.DEAD.TURNOVER);
      return;
    }
    const kind = ownShot ? b.kind : 'tip';
    const clutch = this.inClutch(off);
    const lead0 = this.score[off] - this.score[1 - off];
    this.score[off] += pts;
    const s = credit.stats;
    s.pts += pts; s.fgm++;
    if (pts === 3) s.tpm++;
    if (!ownShot) { s.fga++; }
    const assistId = this.metrics.score(credit.id, off, pts, kind);
    if (assistId && this.byId[assistId]) this.byId[assistId].stats.ast++;
    credit.streak++;
    const buzzer = this.buzzerPending;
    const winner = buzzer && w.quarter >= CLOCK.QUARTERS && lead0 <= 0 && lead0 + pts > 0;
    const firstDunk = kind === 'dunk' && !this.firstDunkDone;
    if (kind === 'dunk') this.firstDunkDone = true;
    if (this.pending.active) { this.pending.missed = true; this.pending.active = false; }
    if (kind !== 'dunk') {                               // a slam has its own 'slam' event
      const be = this.ev('ball', credit); be.what = swishOrDunk ? 'swish' : 'rimIn'; be.strength = 1;
      be.x = this.ball.pos.x; be.z = this.ball.pos.z;
      this.fire(be);
    }
    if (winner) this.caption('cap.winner', credit, 3);
    else if (buzzer) this.caption('cap.buzzerBeater', credit, 3);
    else if (firstDunk) this.caption('cap.firstDunk', credit, 3);
    else if (credit.streak === 3) this.caption('cap.hot', credit, 3);
    else if (kind === 'dunk') this.caption('cap.dunk', credit, 3);
    else if (kind === 'layup') this.caption('cap.layup', credit, 3);
    else if (ownShot && this.pending.bank && pts === 2) this.caption('cap.bank', credit, 3);
    else this.caption(pts === 3 ? 'cap.make3' : 'cap.make2', credit, 3);
    this.banner('banner.plus', pts, PLUS_BANNER_MS);
    const e = this.ev('score', credit);
    e.points = pts; e.kind = kind; e.clutch = clutch; e.buzzer = buzzer; e.assistId = assistId; e.winner = winner ? off : -1; e.firstDunk = firstDunk;
    this.fire(e);
    // celebration (§4.11; cosmetic RNG)
    CEL_CTX.cls = kind === 'dunk' ? 'dunk' : (clutch || winner) ? 'clutch' : pts === 3 ? 'three' : (b.kind === 'fade' || b.kind === 'turnFade' || b.kind === 'stepback') ? 'tough' : 'normal';
    CEL_CTX.rng = this.debug.forceCelebrate ? CEL_ZERO : this.cosRng; CEL_CTX.streak = credit.streak; CEL_CTX.assisted = !!assistId;
    CEL_CTX.gameWinner = winner; CEL_CTX.jumper = isJumpShot(kind); CEL_CTX.blocker = false; CEL_CTX.chaseDown = false;
    const sel = selectCelebration(credit, CEL_CTX);
    if (sel.celebrate) credit.celebrate(sel);
    b.active = false;
    this.ball.ctx = 'none';
    if (w.state === 'LIVE') this.deadBall('MADE', 1 - off, CLOCK.DEAD.MADE);
    else if (buzzer) this.buzzerPending = false;
  }

  stopBall() {
    const ball = this.ball;
    ball.vel.set(0, 0, 0);
    ball.pos.x = clamp(ball.pos.x, -OOB_HOLD_X, OOB_HOLD_X);
    ball.pos.z = clamp(ball.pos.z, OOB_HOLD_Z_MIN, OOB_HOLD_Z_MAX);
    if (ball.pos.y < BALL.R) ball.pos.y = BALL.R;
  }

  /** Out of bounds / resting ball / backcourt: possession to the team that did not touch it last. */
  onOutOfBounds(last, why) {
    const w = this.world, ball = this.ball;
    const lastTeam = last ? last.team : w.offense;
    const held = ball.isHeld;
    if (this.pending.active && !this.pending.missed) this.resolveMiss(true);
    this.stopBall();
    this.caption('cap.oob', null, 3);
    const reason = held && ball.owner && ball.owner.pos.z > 0 ? 'backcourt' : 'oob';
    const e = this.ev('turnover', last); e.reason = reason; e.team = lastTeam; e.what = why; this.fire(e);
    if (lastTeam === w.offense) this.metrics.turnover(lastTeam, reason);
    this.deadBall('OOB', 1 - lastTeam, CLOCK.DEAD.OOB);
  }

  /** v1 §5.13 rescue at any height: a free ball slower than 0.2 m/s for 1.5 s is dead like an OOB. */
  stepRest(dt) {
    const ball = this.ball;
    if (!ball.isFree) { this.freeRestT = 0; return; }
    const v = ball.vel;
    if (v.x * v.x + v.y * v.y + v.z * v.z < BALL.RESCUE_SPEED * BALL.RESCUE_SPEED) {
      this.freeRestT += dt;
      if (this.freeRestT >= CLOCK.REST_RESCUE) { this.freeRestT = 0; this.onOutOfBounds(ball.lastToucher, 'rest'); }
    } else this.freeRestT = 0;
  }

  /** Idle habits ([ANIM §8.3]): stationary ≥ 0.6 s in DEAD / CHECK / QUARTER_END, 6 s cooldown, cosmetic RNG. */
  stepHabits(dt) {
    if (this.animMode !== 'real') return;
    const w = this.world;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i];
      if (this.habitCd[i] > 0) this.habitCd[i] -= dt;
      if (p.speed < 0.2 && p.animator.action < 0 && !p.isJumping) this.stillT[i] += dt; else this.stillT[i] = 0;
      if (this.stillT[i] < HABIT_STILL || this.habitCd[i] > 0) continue;
      HABIT_CTX.rng = this.cosRng; HABIT_CTX.hasBall = p.hasBall; HABIT_CTX.check = w.state === 'CHECK';
      HABIT_CTX.onBallDef = w.state === 'CHECK' && !p.offense && !!p.defAssign && p.defAssign.hasBall;
      HABIT_CTX.toDefence = false;
      HABIT_CTX.timeLeft = w.state === 'CHECK' ? CLOCK.CHECK - this.stateT : w.state === 'DEAD' ? this.deadT : Infinity;
      const sel = selectIdleHabit(p, HABIT_CTX);
      this.habitCd[i] = HABIT_CD;
      if (sel.clipIdx >= 0) p.animator.play(sel.clipIdx, { layer: 'upper' });
    }
  }

  /**
   * Look-at targets of the real animators ([ANIM §10.2] defaults, used when the clip keys none): a shot in flight → the
   * ball (0.8); the handler → the on-ball defender within 3 m, else the rim; off-ball offence → the ball; the on-ball
   * defender → the handler's chest; off-ball defenders → the ball; a passer → the receiver. Look points 'ball', 'man',
   * 'receiver' are refreshed for clip-keyed looks.
   */
  updateLooks() {
    const ball = this.ball, w = this.world;
    const bx = ball.pos.x, by = ball.pos.y, bz = ball.pos.z;
    const shotUp = ball.state === 'flight' && ball.ctx === 'shot';
    for (let i = 0; i < 6; i++) {
      const p = this.players[i], a = p.animator;
      if (typeof a.setLookTarget !== 'function') continue;
      a.setLookPoint('ball', bx, by, bz);
      const man = p.defAssign;
      if (man) a.setLookPoint('man', man.pos.x, 1.4, man.pos.z);
      if (p.passAct.active && p.passAct.target) { const r = p.passAct.target; a.setLookPoint('receiver', r.pos.x, 1.4, r.pos.z); a.setLookTarget(r.pos.x, 1.6, r.pos.z, 1); continue; }
      if (shotUp) { a.setLookTarget(bx, by, bz, 0.8); continue; }
      if (p.team === w.offense) {
        if (p.hasBall) {
          let d = null;
          for (let j = 0; j < 6; j++) { const o = this.players[j]; if (o.defAssign === p) d = o; }
          if (d && (d.pos.x - p.pos.x) ** 2 + (d.pos.z - p.pos.z) ** 2 <= 9) a.setLookTarget(d.pos.x, 1.7, d.pos.z, 1);
          else a.setLookTarget(RIM.x, RIM.y, RIM.z, 1);
        } else a.setLookTarget(bx, by, bz, 1);
      } else if (man && ball.owner === man) a.setLookTarget(man.pos.x, 1.4, man.pos.z, 1);
      else a.setLookTarget(bx, by, bz, 1);
    }
  }

  // ---------------------------------------------------------------- HUD meter (§1.4 game.meter)
  updateMeter() {
    const M = this.meter, w = this.world, c = w.controlled;
    const s = c ? c.shot : null;
    const on = !!c && !w.auto && w.state === 'LIVE' && s.active && !s.released && !!s.meter && c.team === w.offense;
    M.active = on;
    if (!on) { M.shooterId = c && s && s.active ? c.id : null; return; }
    M.shooterId = c.id;
    const elapsed = w.time - s.pressT;
    M.fill = clamp((elapsed - s.meterFrom) / s.METER_T, 0, SHOT_V2.METER_MAX);
    const zone = resolveShotZone(s.kind, c.rimDist(), c.pos.x, c.pos.z);
    const gS = greenHalfWidth(zoneRating(c.legend.ratings, zone), gDiffFor('human', this.difficultyId), s.kind);
    const band = meterBand(gS, s.METER_T);
    M.greenLo = band.lo; M.greenHi = band.hi;
    M.points = shotPoints(s.kind, c.pos.x, c.pos.z);
  }

  // ---------------------------------------------------------------- invariants
  checkInvariants() {
    const w = this.world, ball = this.ball;
    let broken = 0;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i];
      if (!Number.isFinite(p.pos.x + p.pos.z + p.vel.x + p.vel.z + p.yaw + p.jumpY)) {
        broken++;
        const to = this.checkTo[i];
        p.pos.set(to.x, 0, to.z); p.vel.set(0, 0, 0); p.yaw = to.yaw; p.jumpY = 0; p.isJumping = false;
      }
    }
    const bp = ball.pos;
    if (Number.isFinite(bp.x + bp.y + bp.z) && bp.y < BALL.R - 0.02) { broken++; bp.y = BALL.R; if (ball.vel.y < 0) ball.vel.y = 0; }
    if (!(w.shotClock >= 0 && w.shotClock <= CLOCK.SHOT)) { broken++; w.shotClock = clamp(Number.isFinite(w.shotClock) ? w.shotClock : CLOCK.SHOT, 0, CLOCK.SHOT); }
    if (!Number.isFinite(w.gameClock)) { broken++; w.gameClock = 0; }
    if (broken) this.debug.invariantsBroken += broken;
  }

  // ---------------------------------------------------------------- debug helpers (__game, §5.15)
  teleport(i, x, z, yaw) {
    const p = typeof i === 'number' ? this.players[i] : (typeof i === 'string' ? this.byId[i] : i);
    if (!p || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    p.pos.x = x; p.pos.z = z; p.prevPos.x = x; p.prevPos.z = z; p.vel.set(0, 0, 0);
    if (Number.isFinite(yaw)) { p.yaw = yaw; p.prevYaw = yaw; }
    for (let k = 0; k < p.positionHistory.length; k++) { p.positionHistory[k].x = x; p.positionHistory[k].z = z; }
    const to = this.checkTo[p.idx]; to.x = x; to.z = z; if (Number.isFinite(yaw)) to.yaw = yaw;
    if (p.hasBall && this.ball.owner === p) { this.ball.placeOnOwner(); this.ball.prevPos.copy(this.ball.pos); }
    return p;
  }

  /** Forces a shot (§5.15 debugShoot): {shooter?, p?, e?, eT?, kind?, variant?}; eT (s) wins over e (× METER_T). */
  debugShoot(opts) {
    const o = opts || {}, w = this.world, ball = this.ball;
    if (w.state === 'CHECK') { this.goLive(); }
    if (w.state !== 'LIVE') return false;
    let p = o.shooter ? this.byId[o.shooter] : null;
    if (!p) p = w.controlled && w.controlled.team === w.offense ? w.controlled : (ball.owner && ball.owner.team === w.offense ? ball.owner : this.roster[w.offense][0]);
    if (!p || p.team !== w.offense) return false;
    if (ball.owner !== p) this.giveBall(p, 'held', null);
    p.animator.stopAction(); p.state = 'idle'; p.isJumping = false; p.jumpY = 0; p.stunT = 0; p.fallenT = 0; p.move.active = false; p.passAct.active = false;
    silenceIntent(p.intent);
    let r;
    if (o.kind) {
      r = resolveShot(p, w);
      r.kind = o.kind; r.variant = o.variant !== undefined ? o.variant : (o.kind === 'jumper' ? (isThree(p.pos.x, p.pos.z) ? 'three' : 'set') : o.kind === 'layup' ? 'std' : null);
      r.clipHint = o.kind === 'dunk' && o.variant === 'ftDunk' ? 'sig.jordan.ftDunk' : null; r.dodged = null;
    } else r = resolveShot(p, w);
    if (!this.startShot(p, r, 0)) return false;
    const s = p.shot;
    s.debug = true; s.human = this.isUserControlled(p);
    s.forcedET = typeof o.eT === 'number' ? o.eT : (typeof o.e === 'number' ? o.e * s.METER_T : 0);
    s.forcedP = typeof o.p === 'number' ? clamp(o.p, 0, 1) : NaN;
    if (!s.confirmed) this.confirmShot(p);
    return s.kind;
  }

  setClock(c) {
    const w = this.world, o = c || {};
    if (typeof o.game === 'number' && Number.isFinite(o.game)) { w.gameClock = Math.max(0, o.game); this.lastGameSec = Math.ceil(w.gameClock - 1e-4); }
    if (typeof o.shot === 'number' && Number.isFinite(o.shot)) { w.shotClock = clamp(o.shot, 0, CLOCK.SHOT); this.lastShotSec = Math.ceil(w.shotClock - 1e-4); }
    return { game: w.gameClock, shot: w.shotClock };
  }

  /** Immediate possession change (DEAD(TURNOVER) → CHECK for the other team). */
  turnover() {
    const w = this.world;
    if (w.state === 'LIVE') {
      this.caption('cap.turnover', null, 3);
      const e = this.ev('turnover', w.controlled); e.reason = 'forced'; e.team = w.offense; this.fire(e);
      this.deadBall('TURNOVER', 1 - w.offense, CLOCK.DEAD.TURNOVER);
    } else if (w.state === 'DEAD') this.nextOffense = 1 - this.nextOffense;
    else if (w.state === 'CHECK') this.enterCheck(1 - w.offense, 'forced');
    return w.offense;
  }

  /** round(sec·60) fixed steps (no rendering, no input sampling). */
  fastForward(sec) {
    const steps = Math.max(0, Math.round((sec > 0 ? sec : 0) * 60));
    for (let i = 0; i < steps; i++) this.step(FIXED_DT);
    return steps;
  }

  /** Pass target the user's handler would pick now (HUD pass chevron), or null. */
  passPreview() {
    const w = this.world, c = w.controlled;
    if (!c || w.auto || !c.hasBall || this.ball.owner !== c) return null;
    const t = resolvePassTarget(c, w, true);
    return t ? t.id : null;
  }
}

function copyButton(dst, src, kp, kr, seen) {
  dst.held = src.held; dst.heldTime = src.heldTime; dst.pressTs = src.pressTs; dst.releaseTs = src.releaseTs;
  dst.prevPressTs = src.prevPressTs; dst.taps = src.taps; dst.tapDur = src.tapDur;
  let jp = src.justPressed, jr = src.justReleased;
  if (jp && src.pressTs > 0) { if (seen[kp] === src.pressTs) jp = false; else seen[kp] = src.pressTs; }
  if (jr && src.releaseTs > 0) { if (seen[kr] === src.releaseTs) jr = false; else seen[kr] = src.releaseTs; }
  dst.justPressed = jp; dst.justReleased = jr;
  dst.doubleTap = jp && src.doubleTap; dst.quickTap = jr && src.quickTap;
}

/** Copies the methods of a mixin class onto Game.prototype (the mixins live in player.js / physics.js / context.js). */
function install(target, src) {
  for (const k of Object.getOwnPropertyNames(src.prototype)) {
    if (k !== 'constructor') Object.defineProperty(target.prototype, k, Object.getOwnPropertyDescriptor(src.prototype, k));
  }
}
install(Game, ActionMixin);
install(Game, ContactMixin);
install(Game, DebugMixin);
