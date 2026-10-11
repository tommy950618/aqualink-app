/**
 * @module player
 * Player entity v2 (v1 spec §5.10–§5.12; v2 spec §1.2, §4.4, §4.13, §5.1, §5.2, [ANIM §2.4, §3.5, §10]).
 *
 * Exports: `Player`, `PLAYER_STATES`, `makeIntent`, `clearEdges` (re-exported from input.js), `createAnimator`.
 *
 * A player is a kinematic capsule driven by an Intent (human input or AI) and by the animator's root motion. This file
 * owns the per-player physics: ratings-driven locomotion (`attrs` from ratings.js, §5.2), facing rules ([ANIM §3.5]
 * with `attrs.turn`, C21), stamina, the ballistic jump started at the clip's TAKEOFF (`startJump`, [ANIM §2.4.5];
 * dunks use the rise–hang–drop profile of [ANIM §5.6]), root-motion integration (`animator.motion`, §4.4), timers
 * of the v2 states (`stunned`, `fallen` C4, `post`, `faceUp`, `celebrate`), drive-bump / shake displacements, the
 * headless dribble bounce phase (v1 §5.7, used when the animator is an AnimProxy) and the delayed-position ring for
 * the AI reaction delay. Shots, passes, steals, blocks and every rule are DECIDED by game.js / context.js; the
 * helpers here only put a player into the matching state.
 *
 * States (`player.state`): 'idle' | 'move' (locomotion; may hold or dribble the ball) | 'cross' (a dribble move, jab
 * or pump-fake clip) | 'post' (backdown) | 'faceUp' (leaving the post, 0.35 s) | 'windup' (jump-shot clip before the
 * release input; meter 'hold') | 'layup' (layup / hook / floater clip before the release key; meter 'key') | 'dunk' |
 * 'release' (after the shot release until landing / clip end) | 'jump' (block / contest / rebound / tip jump) |
 * 'steal' (poke clip) | 'stunned' | 'fallen' (ankle-break, 1.60 s) | 'celebrate'.
 *
 * Animator: `anim: 'proxy'` → `new AnimProxy(id, PROXY_METRICS[id], {owner})` (headless, §4.13); `anim: 'real'` →
 * `new Animator(rig, character, {id, owner, rng, tier})` with rig = `character.rig` or `buildRig(header.players[i],
 * header.bones)`. Both expose the same gameplay API; the player is the animator's `owner` ({pos, vel, yaw, jumpY,
 * stamina}). Zero allocation per step (H10).
 */
import * as THREE from '../vendor/three.module.js';
import {
  RIM, BALL, BOARD, MOVE, FIXED_DT, TRIGGERS, POST, JAB, SHOT_V2, PUMP_FAKE, MOVES_V2, SHAKE, PASS, STEAL, INTERCEPT, DIFFICULTY,
} from './constants.js';
import { clamp, wrapAngle } from './math.js';
import { makeIntent, clearEdges } from './input.js';
import { LEGENDS } from './legends.js';
import { derive } from './ratings.js';
import { AnimProxy, PROXY_METRICS } from './anim/proxy.js';
import { Animator } from './anim/animator.js';
import { buildRig, SOCK } from './anim/rig.js';
import { clipIdOf, clipIndex } from './anim/clip.js';
import { selectClip, selectMove, selectPass, selectDefJump } from './anim/select.js';
import { evaluateShot, resetShotInput, chooseTarget, isJumpShot, shotPoints, resolveShotZone } from './shot.js';
import { makeAbilityCtx, resetAbilityCtx, trigger, has, mul, add, euroDodgeP, passRule, chainLength } from './abilities.js';
import { solveArc, apexForDistance, solvePass, shakeChance, pokeChance, biteChance, sideOf } from './physics.js';
import { selCtx, isPumpFake } from './context.js';

export { makeIntent, clearEdges };

/** Every gameplay state of a player (module header). */
export const PLAYER_STATES = Object.freeze(['idle', 'move', 'cross', 'post', 'faceUp', 'windup', 'layup', 'dunk', 'release',
  'jump', 'steal', 'stunned', 'fallen', 'celebrate']);

const G = BALL.G;
const HISTORY = 30;                       // 0.5 s of positions at 60 Hz (AI reaction delay, v1)
const MOVE_MIN_SPEED = 0.3;               // state 'move' above this horizontal speed (v1)
const STICK_DEAD = 0.05;                  // stick magnitude treated as zero
const SHOT_STOP_DECEL = 18;               // [ANIM §5.1-9] jump-shot entry 'stop': 18 m/s² until takeoff
const CEL_FACE_S = 1.5;                   // face-only celebration reaction length (s; §4.11 face timelines run 1.2–1.5 s)
const ACTION_STOP_DECEL = 16;             // other grounded actions without root motion (v1 DECEL)
const SLIDE_ANGLE_COS = Math.cos(Math.PI / 4);   // §5.2 slideMul: move ⟂ facing > 45°
const POST_SPEED = 1.0;                   // backdown walking speed cap in the post (m/s)
// facing rules [ANIM §3.5]
const FACE_HANDLER_V = 1.5, FACE_RIM_R = 9.0, FACE_OFFBALL_V = 2.5, FACE_ONBALL_R = 3.5, FACE_ONBALL_V = 4.2,
  FACE_DEF_OFFBALL_V = 3.0;
// v1 §5.7 dribble bounce model (headless proxy dribble only)
const DRIBBLE_HZ_RUN = 2.2, DRIBBLE_HZ_SPRINT = 2.8, DRIBBLE_HZ_STILL = 1.8;
const DRIBBLE_AMP_MOVE = 0.80, DRIBBLE_AMP_STILL = 0.65;
const SHOT_SQUARE_KINDS = { jumper: true, stepback: true, floater: true };
const HARD_STOP_V = 1.2, HARD_STOP_DECEL = 8, CUT_V = 4.0, CUT_TURN = 2 * Math.PI, PLANT_CD = 0.25;   // [ANIM §3.7], §6.7
const METER_FLASH_T = 0.6;                             // §5.3.2 meter flash (perfect / early / late) 0.6 s
// action-mixin constants and scratch (module level, reused: H10)
const UNDER_RIM_R = 0.5;                                 // launch point pushed out of the rim axis (v1)
const BOARD_FRONT_Z = BOARD.max.z + BALL.R + 0.05;       // launch points behind the board move to its front (v1)
const BOARD_REACH_X = BOARD.max.x + 0.6;
const ARC = { vx: 0, vy: 0, vz: 0, T: 0 };
const P_HAND = { x: 0, y: 0, z: 0 };
const P_TO = { x: 0, y: 0, z: 0 };
const V3 = { x: 0, y: 0, z: 0 };
const ACTX = makeAbilityCtx();
const PASS_RULE = { range: 0, speed: 0, release: 0, sigmaMul: 1, jumpPenalty: 1, id: null };
const SHOT_REC = { t: 0, shooter: null, team: 0, kind: '', variant: null, zone: '', d: 0, three: false, points: 2, eT: NaN, X: 0, C: 1, p: 0, make: false, releaseSpeed: NaN, catchToPress: NaN, defDist: NaN, urgent: false, fromDrive: false };
const PASS_CTX = { dist: 0, lob: false, bounce: false, post: false, doubled: false, chinned: false, fromDribble: false, inHand: false, pickup: 0, angle: 0, speed: 0, passRelease: 0, rng: null };
const DEF_CTX = { intent: 'contest', chase: false, help: false, arm: 'R', hJump: 0 };
const STICK = { lat: 0, fwd: 0 };
const MOVE_CTX = { holding: false, speed: 0, dribbleHand: 'R', post: false, defFront: Infinity, rng: null };
const C_DEF_STEAL = clipIndex('def.steal'), C_STEAL_MISS = clipIndex('def.stealMiss'), C_FACE_UP = clipIndex('post.faceUp');
const C_ANKLE = clipIndex('def.ankleFall'), C_STUMBLE = clipIndex('def.stumble'), C_PUMP = clipIndex('move.pumpFake');

function yawToward(fromX, fromZ, toX, toZ, fallback) {
  const dx = toX - fromX, dz = toZ - fromZ;
  return dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : fallback;
}

function smooth01(u) {
  return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
}

/**
 * Builds the animator of a player (spec §1.4 construction note). opts: { anim: 'proxy'|'real', character, header,
 * index, rig, rng (cosmetic Rng), tier }.
 */
export function createAnimator(id, owner, opts) {
  const o = opts || {};
  if (o.anim === 'real') {
    const ch = o.character || null;
    let rig = o.rig || (ch && ch.rig) || null;
    if (!rig && o.header) {
      const hp = o.header.players.find((q) => q.id === id) || o.header.players[o.index | 0];
      rig = buildRig(hp, o.header.bones);
    }
    if (rig) return new Animator(rig, ch, { id, owner, rng: o.rng || null, tier: o.tier || 'medium' });
  }
  return new AnimProxy(id, PROXY_METRICS[id], { owner });
}

/** Per-shot bookkeeping (one per player, rewritten in place). */
function makeShotAct() {
  return {
    active: false, kind: 'jumper', variant: null, side: 'R', clipIdx: -1, clipId: '', mirror: false, timing: null,
    meter: false, tIdeal: 0, METER_T: 0, meterFrom: 0, pressT: 0, pressMs: 0, confirmed: false, released: false,
    releaseInT: 0, releaseMs: 0, eT: NaN, takeoff: false, takeoffT: 0, takeoffVx: 0, takeoffVz: 0, contactDef: null,
    launched: false, ability: null, fromDrive: false, x: 0, z: 0, points: 2, zone: 'mid', p: 0, make: false,
    airball: false, gS: 0, green: false, C: 1, X: 0, excluded: null, forcedP: NaN, forcedET: NaN, debug: false,
    switchRolled: false, stuffRolled: null, slamDone: false, catchToPress: NaN, sagA: 1, human: false,
    targetX: 0, targetY: 0, targetZ: 0, putback: false,
  };
}

/** Context-resolver state (context.js reads and writes it). */
function makeCtxState() {
  return {
    lastCrossT: -1e9, comboIndex: 1, ftDunks: 0, queued: false, queuedLat: 0, queuedFwd: 0, queuedMag: 0, lastMoveId: '',
    lastMoveT: -1e9, lastMoveEndT: -1e9, jabsThisHold: 0, lastJabT: -1e9, lastPumpFakeT: -1e9, pumpFakeInPaint: false,
    postT: 0, postShoveT: 0, postIdleT: 0, postExitT: 0, dribbles: 0, holdStartT: 0, sagUntil: -1e9, wonBumpT: -1e9,
    lastStealT: -1e9, stealFails: 0, lastStealFailT: -1e9, bitT: -1e9, lastBumpT: -1e9, ankleThisPoss: false,
    ankledThisPoss: false, driveT: -1e9, driving: false, catchT: -1e9, readyT: -1e9, lungeT: -1e9, lungeX: 0, lungeZ: 0,
    tipShown: 0,
  };
}

export class Player {
  /**
   * @param {object} o { id (legend id), team (0|1), index (roster 0..2), anim ('proxy'|'real'), character, header,
   *   rig, rng (cosmetic Rng), tier }
   */
  constructor(o) {
    this.id = o.id;
    this.legend = LEGENDS[o.id];
    if (!this.legend) throw new Error(`Player: unknown legend '${o.id}'`);
    this.attrs = derive(this.legend);
    this.team = o.team | 0;
    this.teamIdx = this.team;
    this.index = o.index | 0;
    this.short = this.legend.short;             // {zh, en}: caption `{name}`
    this.number = this.legend.number;
    this.intent = makeIntent();
    this.isUser = false;
    this.clampToCourt = true;
    this.offense = false;

    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();             // y always 0; height lives in jumpY
    this.yaw = 0;
    this.prevYaw = 0;
    this.state = 'idle';
    this.stateT = 0;
    this.time = 0;

    this.stamina = 1;
    this.sprintLocked = false;
    this.sprinting = false;
    this.sprintRecentT = 0;
    this.sprintedRecently = false;
    this.hasBall = false;
    this.ballMode = null;                       // 'held' | 'dribble' | null (written by Ball)

    // jump (ballistic from TAKEOFF)
    this.isJumping = false;
    this.jumpY = 0;
    this.prevJumpY = 0;
    this.jumpT = 0;
    this.jumpH = 0;
    this.jumpAir = 0;
    this.jumpG = G;
    this.jumpVy = 0;
    this.jSlamUp = -1;
    this.jHang = 0;
    this.jTop = 0;
    this.hanging = false;
    this.jumpKind = '';
    this.landedNow = false;
    this.landDropH = 0;
    this.takeoffNow = false;
    // plant detection for the squeak rule (§6.7): deceleration (m/s²) and turn rate (rad/s) of the last step
    this.decelNow = 0;
    this.turnRateNow = 0;
    this.plantNow = false;
    this.plantCd = 0;
    this.prevSpeed = 0;

    // timers
    this.stunT = 0;
    this.fallenT = 0;
    this.celebrateT = 0;
    this.celebrateOnLand = false;
    this.celebrateClip = -1;
    this.celebrateMirror = false;
    this.faceUpT = 0;
    this.chaseT = 0;                            // LeBron chase-down speed boost (s left)
    this.pushVx = 0; this.pushVz = 0; this.pushT = 0;   // bump / shake displacement
    this.boxT = 0; this.boxing = null;          // box-out (§5.6)
    this.immuneUntil = -1e9;                    // steal immunity (move windows, ankle bonus)
    this.moveCd = 0;                            // dribble-move cooldown
    this.stealCd = 0;                           // human poke cooldown / CPU attempt interval
    this.switchCd = 0;
    this.sepFixed = false;
    this.hangingDunk = false;

    // dribble phase (headless proxy)
    this.procDribble = false;
    this.dribblePhi = 0;
    this.dribbleY = BALL.CHEST_Y;
    this.dribbleBounced = false;
    this.handSign = 1;                          // +1 ball in the right hand, −1 left (proxy dribble hand)

    this.defAssign = null;
    this.slot = -1;
    this.cutting = false;
    this.passTarget = null;
    this.ai = null;                             // AI state (ai.js owns it)
    this.stats = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, reb: 0, oreb: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
    this.streak = 0;                            // consecutive makes (cap.hot)

    this.shot = makeShotAct();
    this.cx = makeCtxState();
    this.move = { active: false, id: '', clipIdx: -1, startT: 0, chain: 1, resolved: false, cancelT: 0, dir: 1, mirror: false };
    this.passAct = { active: false, target: null, lob: false, kind: 'chest', releaseT: 0, startT: 0, layer: 'action', bounce: false, speed: 0, sigmaMul: 1, skip: false, kickOut: false, beyond: false, startHeld: false };
    this.stealAct = { active: false, startT: 0, resolved: false };
    this.defJump = { active: false, intent: 'contest', h: 0, chase: false, help: false, clipIdx: -1 };
    this.actionClip = -1;                       // clip index last played on the action layer
    this.actionClipId = '';

    this.positionHistory = new Array(HISTORY);
    for (let i = 0; i < HISTORY; i++) this.positionHistory[i] = { x: 0, z: 0 };
    this.histHead = 0;

    this.character = o.character || null;
    this.animator = createAnimator(this.id, this, o);
    this.procDribble = this.animator instanceof AnimProxy;
    if (!this.animator.ctx) this.animator.ctx = { onDefence: false, stance: 'auto', protect: false, post: false, drive: false, stamina: 1 };
  }

  get name() { return this.short; }
  get data() { return this.legend; }
  /** Horizontal speed (m/s). */
  get speed() { const v = this.vel; return Math.sqrt(v.x * v.x + v.z * v.z); }
  /** Free to start an action: on the ground in a neutral state. */
  get canAct() { return !this.isJumping && (this.state === 'idle' || this.state === 'move'); }
  /** Disabled for contests / blocks / steals (§5.3.6, §5.7). */
  get disabled() { return this.state === 'stunned' || this.state === 'fallen'; }
  get dribbling() { return this.hasBall && this.ballMode === 'dribble'; }
  get holding() { return this.hasBall && this.ballMode === 'held'; }

  /** Facing direction (three.js convention: forward = (sin yaw, cos yaw)). */
  forward(out) { out.x = Math.sin(this.yaw); out.z = Math.cos(this.yaw); return out; }

  /** Horizontal distance from the feet to the rim centre. */
  rimDist() { const dx = RIM.x - this.pos.x, dz = RIM.z - this.pos.z; return Math.sqrt(dx * dx + dz * dz); }

  /** Position `seconds` ago (clamped to the 0.5 s ring buffer), for the AI reaction delay. */
  getDelayed(out, seconds) {
    const back = clamp(Math.round(seconds / FIXED_DT), 0, HISTORY - 1);
    const e = this.positionHistory[(this.histHead - back + HISTORY) % HISTORY];
    out.x = e.x; out.z = e.z;
    return out;
  }

  setState(s) {
    if (this.state !== s) { this.state = s; this.stateT = 0; }
  }

  /** Plays a clip on the animator and remembers the action-layer clip. Returns the animator's fit flag. */
  playClip(clipIdx, opts) {
    if (clipIdx < 0) return false;
    const fits = this.animator.play(clipIdx, opts);
    const layer = opts && opts.layer;
    if (!layer || layer === 'action') { this.actionClip = clipIdx; this.actionClipId = clipIdOf(clipIdx) || ''; }
    return fits;
  }

  /**
   * Place the player (CHECK formation / teleport) and clear every transient state. Stats and stamina are kept
   * (resetStats). The animator crossfades by itself on a teleport (R#37): no pose function is called here.
   */
  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.prevPos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = this.prevYaw = wrapAngle(yaw || 0);
    this.state = 'idle'; this.stateT = 0;
    this.isJumping = false; this.hanging = false; this.sepFixed = false;
    this.jumpY = this.prevJumpY = this.jumpT = this.jumpH = 0;
    this.landedNow = false; this.takeoffNow = false;
    this.stunT = this.fallenT = this.celebrateT = this.faceUpT = this.chaseT = 0;
    this.pushT = 0; this.pushVx = this.pushVz = 0; this.boxT = 0; this.boxing = null;
    this.celebrateOnLand = false;
    this.moveCd = 0;
    this.sprinting = false; this.sprintRecentT = 0; this.sprintedRecently = false;
    this.hasBall = false; this.ballMode = null;
    this.dribblePhi = 0; this.dribbleY = BALL.CHEST_Y; this.dribbleBounced = false;
    this.cutting = false; this.passTarget = null;
    this.shot.active = false; this.move.active = false; this.passAct.active = false; this.stealAct.active = false;
    this.defJump.active = false;
    for (let i = 0; i < HISTORY; i++) { this.positionHistory[i].x = x; this.positionHistory[i].z = z; }
    this.histHead = 0;
    clearEdges(this.intent);
    const m = this.intent.move; m.x = m.z = m.mag = 0;
    const a = this.animator;
    a.stopAction();
    if (typeof a.stopUpper === 'function') a.stopUpper();
    a.setBallMode('free');
    if (this.character) this.character.jumpY = 0;
  }

  resetStats() {
    const s = this.stats;
    s.pts = s.fgm = s.fga = s.tpm = s.tpa = s.reb = s.oreb = s.ast = s.stl = s.blk = s.tov = 0;
    this.streak = 0;
    this.stamina = 1;
    this.sprintLocked = false;
  }

  // ---------------------------------------------------------------- jumps ([ANIM §2.4.5, §5.6])

  /**
   * Starts the ballistic jump at the clip's TAKEOFF (called by game.js in the step the event arrives; `since` = game
   * seconds already elapsed after the takeoff inside this step). Plain jump: airtime T, g' = 8h/T², vy = 4h/T
   * (jumpY(τ) = vy·τ − ½g'τ², exactly T in the air). Dunk profile {slam, hang}: rise ballistic to the apex at
   * slam + 0.03 (g' = 2h/tUp²), hang `hang` s easing h → h − 0.05, free fall with g'. The resulting airtime is passed
   * to animator.setJump so the clip's LAND coincides with jumpY = 0. Returns the airtime.
   */
  startJump(h, airT, profile, kind, since) {
    const hh = h > 0 ? h : this.attrs.hJump;
    this.isJumping = true;
    this.jumpKind = kind || 'jump';
    this.jumpH = hh;
    this.hanging = false;
    if (profile && profile.slam > 0) {
      const tUp = profile.slam + 0.03;
      this.jSlamUp = tUp;
      this.jHang = profile.hang > 0 ? profile.hang : 0;
      this.jumpG = 2 * hh / (tUp * tUp);
      this.jumpVy = this.jumpG * tUp;
      this.jTop = this.jHang > 0 ? hh - 0.05 : hh;
      this.jumpAir = tUp + this.jHang + Math.sqrt(2 * this.jTop / this.jumpG);
    } else {
      const T = airT > 0 ? airT : 2 * Math.sqrt(2 * hh / G);
      this.jSlamUp = -1; this.jHang = 0; this.jTop = hh;
      this.jumpAir = T;
      this.jumpG = 8 * hh / (T * T);
      this.jumpVy = 4 * hh / T;
    }
    this.jumpT = since > 0 ? since : 0;
    this.jumpY = this.jumpAt(this.jumpT);
    this.animator.setJump(hh, this.jumpAir, profile || undefined);
    this.takeoffNow = true;
    return this.jumpAir;
  }

  /** jumpY at τ seconds after the takeoff (plain ballistic or the dunk rise–hang–drop). */
  jumpAt(tau) {
    if (this.jSlamUp > 0) {
      const tUp = this.jSlamUp, g = this.jumpG;
      if (tau <= tUp) return this.jumpVy * tau - 0.5 * g * tau * tau;
      if (tau <= tUp + this.jHang) return this.jumpH + (this.jTop - this.jumpH) * smooth01((tau - tUp) / this.jHang);
      const d = tau - tUp - this.jHang, y = this.jTop - 0.5 * g * d * d;
      return y > 0 ? y : 0;
    }
    const y = this.jumpVy * tau - 0.5 * this.jumpG * tau * tau;
    return y > 0 ? y : 0;
  }

  /** Vertical speed of the jump at the current τ (m/s, + up). */
  jumpVyNow() {
    if (!this.isJumping) return 0;
    const tau = this.jumpT;
    if (this.jSlamUp > 0) {
      if (tau <= this.jSlamUp) return this.jumpVy - this.jumpG * tau;
      if (tau <= this.jSlamUp + this.jHang) return 0;
      return -this.jumpG * (tau - this.jSlamUp - this.jHang);
    }
    return this.jumpVy - this.jumpG * tau;
  }

  /** Abort a jump into a quick drop (dunk stuffed): free fall from the current height. */
  abortJumpToDrop() {
    if (!this.isJumping) return;
    const y = this.jumpY;
    this.jSlamUp = 1e-6; this.jHang = 0; this.jTop = y; this.jumpH = y;
    this.jumpG = G; this.jumpVy = 0; this.jumpT = this.jSlamUp;
    const rest = Math.sqrt(2 * Math.max(0, y) / G);
    this.jumpAir = this.jSlamUp + rest;
    this.hanging = false;
  }

  // ---------------------------------------------------------------- state helpers (called by game.js)

  /** Stun for `sec` (the longest pending stun wins); no effect while airborne. */
  stun(sec) {
    if (this.isJumping || this.state === 'fallen') return false;
    this.setState('stunned');
    this.stunT = Math.max(this.stunT, sec);
    this.vel.set(0, 0, 0);
    this.move.active = false; this.stealAct.active = false;
    return true;
  }

  /** Ankle-break: `fallen` for `sec` (C4: 1.60 s). */
  fall(sec) {
    this.setState('fallen');
    this.fallenT = sec;
    this.stunT = 0;
    this.vel.set(0, 0, 0);
    this.move.active = false; this.stealAct.active = false;
    return true;
  }

  /** Displace by `dist` metres along (ux, uz) over `seconds` (drive bump push, shake slide). */
  push(ux, uz, dist, seconds) {
    const s = seconds > 1e-3 ? seconds : 0.15;
    this.pushVx = ux * dist / s; this.pushVz = uz * dist / s; this.pushT = s;
  }

  /** Celebration clip / face from a selectCelebration result (deferred to the landing when airborne). */
  celebrate(sel) {
    if (!sel || !sel.celebrate) return false;
    if (sel.face && typeof this.animator.setFace === 'function') this.animator.setFace(sel.face, sel.faceW, CEL_FACE_S);
    if (sel.clipIdx < 0) return true;
    if (this.isJumping || this.state === 'dunk') { this.celebrateOnLand = true; this.celebrateClip = sel.clipIdx; this.celebrateMirror = sel.mirror; return true; }
    this.startCelebration(sel.clipIdx, sel.mirror);
    return true;
  }

  startCelebration(clipIdx, mirror) {
    this.playClip(clipIdx, { mirror: !!mirror });
    const clip = this.animator.actionClip;
    const dur = clip && clip.dur > 0 ? clip.dur : 1.0;
    this.setState('celebrate');
    this.celebrateT = Math.min(dur, 1.4);
    this.vel.set(0, 0, 0);
  }

  // ---------------------------------------------------------------- simulation

  /**
   * One fixed step: animator, root motion or locomotion, stamina, integration, jump, facing, dribble phase, timers.
   * `world` = the game world ({ players, ball, offense, time, state }).
   */
  step(dt, world) {
    this.time += dt;
    this.stateT += dt;
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.prevJumpY = this.jumpY;
    this.landedNow = false;
    this.takeoffNow = false;
    this.dribbleBounced = false;
    this.histHead = (this.histHead + 1) % HISTORY;
    const he = this.positionHistory[this.histHead];
    he.x = this.pos.x; he.z = this.pos.z;
    if (world && typeof world.offense === 'number') this.offense = world.offense === this.team;
    if (this.moveCd > 0) this.moveCd -= dt;
    if (this.stealCd > 0) this.stealCd -= dt;
    if (this.switchCd > 0) this.switchCd -= dt;
    if (this.chaseT > 0) this.chaseT -= dt;
    if (this.boxT > 0) { this.boxT -= dt; if (this.boxT <= 0) this.boxing = null; }

    // animator context (real Animator; harmless on the proxy)
    const ctx = this.animator.ctx;
    ctx.onDefence = !this.offense;
    ctx.post = this.state === 'post';
    ctx.stamina = this.stamina;
    ctx.stance = this.state === 'post' ? 'postUp' : this.boxT > 0 ? 'boxOut' : 'auto';
    ctx.drive = this.id === 'jordan' && this.dribbling && this.speed > 4.5 && this.rimDist() < 7;
    ctx.protect = this.hasBall && !!(world && this.nearestOpponentInFront(world, 1.0));
    if (this.character) this.character.jumpY = this.jumpY;

    this.animator.step(dt);

    // timers of the timed states
    const st = this.state;
    if (st === 'stunned') { this.stunT -= dt; if (this.stunT <= 0) { this.stunT = 0; this.setState('idle'); } }
    else if (st === 'fallen') { this.fallenT -= dt; if (this.fallenT <= 0) { this.fallenT = 0; this.setState('idle'); } }
    else if (st === 'celebrate') { this.celebrateT -= dt; if (this.celebrateT <= 0) { this.celebrateT = 0; this.setState('idle'); } }
    else if (st === 'faceUp') { this.faceUpT -= dt; if (this.faceUpT <= 0) { this.faceUpT = 0; this.setState('idle'); } }

    const motion = this.animator.motion;
    const rootActive = motion.active;
    const intent = this.intent;
    let controllable = false;
    const s2 = this.state;
    if (rootActive) {
      this.vel.x = motion.vx; this.vel.z = motion.vz;
      this.yaw = wrapAngle(this.yaw + motion.dyaw);
      if (SHOT_SQUARE_KINDS[this.shot.kind] && this.shot.active && !this.isJumping && Math.abs(motion.dyaw) < 1e-9
        && (s2 === 'windup' || s2 === 'layup')) this.turnToward(yawToward(this.pos.x, this.pos.z, RIM.x, RIM.z, this.yaw), dt);
    } else if (motion.exit) {
      this.vel.x = motion.exitVx; this.vel.z = motion.exitVz;
    } else if (this.isJumping) {
      // no air control (v1 §5.10): momentum carries
    } else if (s2 === 'stunned' || s2 === 'fallen' || s2 === 'celebrate') {
      this.vel.set(0, 0, 0);
    } else if (s2 === 'windup' || s2 === 'layup' || s2 === 'dunk' || s2 === 'release' || s2 === 'jump' || s2 === 'steal'
      || s2 === 'faceUp' || (this.passAct.active && this.passAct.layer === 'action')) {
      this.brake(dt, s2 === 'windup' ? SHOT_STOP_DECEL : ACTION_STOP_DECEL);
      if ((s2 === 'windup' || s2 === 'layup') && SHOT_SQUARE_KINDS[this.shot.kind]) {
        this.turnToward(yawToward(this.pos.x, this.pos.z, RIM.x, RIM.z, this.yaw), dt);
      }
    } else if (s2 === 'post') {
      this.stepPostMovement(dt, intent);
    } else {
      controllable = true;
      this.stepMovement(dt, intent, world);
    }

    this.stepStamina(dt, controllable && this.sprinting);

    let px = this.vel.x, pz = this.vel.z;
    if (this.pushT > 0) {
      const k = Math.min(dt, this.pushT);
      this.pos.x += this.pushVx * k; this.pos.z += this.pushVz * k;
      this.pushT -= dt;
    }
    this.pos.x += px * dt;
    this.pos.z += pz * dt;
    this.stepJump(dt);
    if (!rootActive && !this.isJumping && controllable) this.stepFacing(dt, world);
    if (this.hasBall) this.stepDribble(dt, intent);
    this.sepFixed = this.hanging || (rootActive && this.actionClipId.startsWith('sig.'));
    this.detectPlant(dt);
    if (this.clampToCourt && !this.isUser) this.applyClamp();
    if (this.state === 'idle' || this.state === 'move') this.state = this.speed > MOVE_MIN_SPEED ? 'move' : 'idle';
    if (this.character) this.character.jumpY = this.jumpY;
  }

  /**
   * CHECK tween step (v1 §8): positions are driven by the formation tween; velocity follows from the displacement so
   * the gait animates (never a snap, R#37).
   */
  stepKinematic(dt, x, z, yaw) {
    this.time += dt;
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.prevJumpY = this.jumpY;
    this.landedNow = false; this.takeoffNow = false; this.dribbleBounced = false;
    const inv = dt > 1e-9 ? 1 / dt : 0;
    this.vel.set((x - this.pos.x) * inv, 0, (z - this.pos.z) * inv);
    this.pos.x = x; this.pos.z = z;
    this.yaw = wrapAngle(yaw);
    this.isJumping = false; this.jumpY = 0;
    const ctx = this.animator.ctx;
    ctx.onDefence = !this.offense; ctx.post = false; ctx.stance = 'auto'; ctx.stamina = this.stamina;
    this.animator.step(dt);
    this.histHead = (this.histHead + 1) % HISTORY;
    const he = this.positionHistory[this.histHead];
    he.x = x; he.z = z;
    if (this.state !== 'celebrate') this.state = this.speed > MOVE_MIN_SPEED ? 'move' : 'idle';
    else { this.celebrateT -= dt; if (this.celebrateT <= 0) this.state = 'idle'; }
    if (this.character) this.character.jumpY = 0;
  }

  /**
   * Plant detection (§6.7 squeak / [ANIM §3.7]): a hard stop (speed falls below 1.2 m/s with deceleration > 8 m/s²)
   * or a cut (turn rate ≥ 360°/s above 4 m/s) on the ground sets `plantNow`, at most once per 0.25 s.
   */
  detectPlant(dt) {
    const sp = this.speed;
    this.decelNow = dt > 0 ? Math.max(0, (this.prevSpeed - sp) / dt) : 0;
    this.turnRateNow = dt > 0 ? Math.abs(wrapAngle(this.yaw - this.prevYaw)) / dt : 0;
    this.plantNow = false;
    if (this.plantCd > 0) this.plantCd -= dt;
    if (!this.isJumping && this.plantCd <= 0) {
      const hardStop = this.prevSpeed >= HARD_STOP_V && sp < HARD_STOP_V && this.decelNow > HARD_STOP_DECEL;
      const cut = sp > CUT_V && this.turnRateNow >= CUT_TURN;
      if (hardStop || cut) { this.plantNow = true; this.plantCd = PLANT_CD; }
    }
    this.prevSpeed = sp;
  }

  /** Decelerate toward rest at `decel` m/s² (entry 'stop' of shot clips, grounded actions). */
  brake(dt, decel) {
    const v = this.vel;
    const s = Math.sqrt(v.x * v.x + v.z * v.z);
    if (s < 1e-6) { v.x = 0; v.z = 0; return; }
    const ns = Math.max(0, s - decel * dt);
    v.x *= ns / s; v.z *= ns / s;
  }

  turnToward(target, dt) {
    const d = wrapAngle(target - this.yaw);
    const maxTurn = this.attrs.turn * dt;
    this.yaw = wrapAngle(this.yaw + clamp(d, -maxTurn, maxTurn));
  }

  /**
   * Locomotion (§5.2): desired = stick × run × (sprint ? sprintMul : 1) × (hasBall ? handlerMul : 1) (× slideMul for
   * the on-ball defender moving > 45° off his facing, × 1.08 for LeBron's chase-down); the velocity approaches it
   * at `accel` (or `decel` when the stick is released).
   */
  stepMovement(dt, intent, world) {
    const m = intent.move;
    const a = this.attrs;
    let mag = m.mag > 0 ? m.mag : Math.sqrt(m.x * m.x + m.z * m.z);
    if (mag < STICK_DEAD) mag = 0;
    if (mag > 1) mag = 1;
    const wantSprint = !!intent.sprint && mag > 0 && !this.sprintLocked && this.stamina > 0;
    this.sprinting = wantSprint;
    let maxSpeed = a.run * mag;
    if (wantSprint) maxSpeed *= a.sprintMul;
    if (this.hasBall) maxSpeed *= a.handlerMul;
    if (this.chaseT > 0 && this.stamina > TRIGGERS.CHASE.STAMINA) maxSpeed *= TRIGGERS.CHASE.RUN_MUL;
    let dx = 0, dz = 0;
    if (mag > 0) {
      const l = Math.sqrt(m.x * m.x + m.z * m.z);
      dx = m.x / l; dz = m.z / l;
      // on-ball defensive slide (§5.2): moving more than 45° off the facing
      if (!this.offense && world && world.ball && world.ball.owner && this.defAssign === world.ball.owner) {
        const c = dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw);
        if (c < SLIDE_ANGLE_COS) maxSpeed *= a.slideMul;
      }
    }
    const v = this.vel;
    let ax = dx * maxSpeed - v.x, az = dz * maxSpeed - v.z;
    const aLen = Math.sqrt(ax * ax + az * az);
    const maxDv = (maxSpeed > 0 ? a.accel : a.decel) * dt;
    if (aLen > maxDv) { ax *= maxDv / aLen; az *= maxDv / aLen; }
    v.x += ax; v.z += az;
    if (maxSpeed === 0 && v.x * v.x + v.z * v.z < 1e-4) { v.x = 0; v.z = 0; }
  }

  /** In the post (§5.6): slow backdown walk, facing away from the rim; shoves are applied by game.js. */
  stepPostMovement(dt, intent) {
    const m = intent.move;
    const mag = Math.min(1, m.mag > 0 ? m.mag : Math.sqrt(m.x * m.x + m.z * m.z));
    const v = this.vel;
    let tx = 0, tz = 0;
    if (mag > STICK_DEAD) { const l = Math.sqrt(m.x * m.x + m.z * m.z); tx = m.x / l * POST_SPEED * mag; tz = m.z / l * POST_SPEED * mag; }
    let ax = tx - v.x, az = tz - v.z;
    const aLen = Math.sqrt(ax * ax + az * az), maxDv = this.attrs.accel * dt;
    if (aLen > maxDv) { ax *= maxDv / aLen; az *= maxDv / aLen; }
    v.x += ax; v.z += az;
    this.sprinting = false;
    // back to the rim
    this.turnToward(yawToward(RIM.x, RIM.z, this.pos.x, this.pos.z, this.yaw), dt);
  }

  /** Stamina (§5.2): drain attrs.staminaDrain / s sprinting, refill 1/6 per s, sprint locked at 0 until 0.25. */
  stepStamina(dt, sprinting) {
    if (sprinting) {
      this.stamina -= dt * this.attrs.staminaDrain;
      if (this.stamina <= 0) { this.stamina = 0; this.sprintLocked = true; this.sprinting = false; }
      this.sprintRecentT = MOVE.SPRINT_RECENT;
    } else {
      this.sprinting = false;
      this.stamina = Math.min(1, this.stamina + dt * MOVE.STAMINA_REFILL);
      if (this.sprintLocked && this.stamina >= MOVE.STAMINA_RELOCK) this.sprintLocked = false;
      this.sprintRecentT -= dt;
    }
    this.sprintedRecently = this.sprintRecentT > 0;
  }

  /** Jump integration; landing sets `landedNow` (game.js emits `land` and resolves the state). */
  stepJump(dt) {
    if (!this.isJumping) { this.jumpY = 0; this.hanging = false; return; }
    if (!this.takeoffNow) this.jumpT += dt;
    if (this.jumpT >= this.jumpAir) {
      this.landDropH = this.jumpH;
      this.isJumping = false;
      this.jumpY = 0;
      this.jumpT = 0;
      this.hanging = false;
      this.landedNow = true;
      return;
    }
    this.jumpY = this.jumpAt(this.jumpT);
    this.hanging = this.jSlamUp > 0 && this.jHang > 0 && this.jumpT > this.jSlamUp && this.jumpT <= this.jSlamUp + this.jHang;
  }

  /** Facing rules [ANIM §3.5] for locomotion (root-motion clips own the yaw). */
  stepFacing(dt, world) {
    const v = this.vel;
    const speed = Math.sqrt(v.x * v.x + v.z * v.z);
    const velYaw = speed > MOVE_MIN_SPEED ? Math.atan2(v.x, v.z) : this.yaw;
    const ball = world && world.ball;
    let target = velYaw;
    if (this.offense) {
      if (this.hasBall) {
        if (speed <= FACE_HANDLER_V) target = this.rimDist() <= FACE_RIM_R ? yawToward(this.pos.x, this.pos.z, RIM.x, RIM.z, this.yaw) : velYaw;
      } else if (speed <= FACE_OFFBALL_V && ball) target = yawToward(this.pos.x, this.pos.z, ball.pos.x, ball.pos.z, velYaw);
    } else {
      const man = this.defAssign;
      const onBall = man && ball && ball.owner === man;
      if (onBall && speed < FACE_ONBALL_V) {
        const dx = man.pos.x - this.pos.x, dz = man.pos.z - this.pos.z;
        if (dx * dx + dz * dz <= FACE_ONBALL_R * FACE_ONBALL_R) target = Math.atan2(dx, dz);
      } else if (!onBall && speed < FACE_DEF_OFFBALL_V && ball) target = yawToward(this.pos.x, this.pos.z, ball.pos.x, ball.pos.z, velYaw);
    }
    this.turnToward(target, dt);
  }

  /** v1 §5.7 dribble phase (proxy only): φ in cycles, y = R + A·|sin πφ|; the wrap marks a floor bounce. */
  stepDribble(dt, intent) {
    if (!this.procDribble) return;
    if (this.ballMode !== 'dribble' || this.isJumping) { this.dribbleY = BALL.CHEST_Y; return; }
    const moving = intent.move.mag > 0.1 || this.speed > 0.5;
    const hz = moving ? (this.sprinting ? DRIBBLE_HZ_SPRINT : DRIBBLE_HZ_RUN) : DRIBBLE_HZ_STILL;
    const amp = moving ? DRIBBLE_AMP_MOVE : DRIBBLE_AMP_STILL;
    this.dribblePhi += hz * dt;
    if (this.dribblePhi >= 1) { this.dribblePhi -= 1; this.dribbleBounced = true; }
    this.dribbleY = BALL.R + amp * Math.abs(Math.sin(Math.PI * this.dribblePhi));
  }

  applyClamp() {
    // the velocity component into the boundary is dropped too: the animator (gait, dribble ball prediction) reads the
    // owner's velocity, and a clip's root motion pushing a clamped player outward otherwise carried the dribbled ball
    // up to 1.6 m away from his hand (and beyond the sideline)
    const p = this.pos, v = this.vel;
    if (p.x > MOVE.AI_CLAMP_X) { p.x = MOVE.AI_CLAMP_X; if (v.x > 0) v.x = 0; } else if (p.x < -MOVE.AI_CLAMP_X) { p.x = -MOVE.AI_CLAMP_X; if (v.x < 0) v.x = 0; }
    if (p.z > MOVE.AI_CLAMP_Z_MAX) { p.z = MOVE.AI_CLAMP_Z_MAX; if (v.z > 0) v.z = 0; } else if (p.z < MOVE.AI_CLAMP_Z_MIN) { p.z = MOVE.AI_CLAMP_Z_MIN; if (v.z < 0) v.z = 0; }
  }

  /** Nearest opponent within `r` in front of the player (dot ≥ 0.3 with the facing), or null. */
  nearestOpponentInFront(world, r) {
    const ps = world.players;
    if (!ps) return null;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let best = null, bestD = r;
    for (let i = 0; i < ps.length; i++) {
      const o = ps[i];
      if (o.team === this.team) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > bestD || d < 1e-6) continue;
      if ((dx * fx + dz * fz) / d < 0.3) continue;
      best = o; bestD = d;
    }
    return best;
  }
}

// ================================================================================================ action mixin

/**
 * Game methods that start and resolve player actions (installed on Game.prototype by game.js): dribble / post /
 * face-up, shots (press, confirm, release input, evaluation, launch from the socket), pump fakes and jabs, dribble
 * moves and combos with their shakes, passes, defensive jumps, pokes and lunges (§5.3–§5.9, C1, C5, C6, C8). `this` is
 * the Game.
 */
export class ActionMixin {
  startDribble(p) {
    if (!p.holding) return;
    this.ball.setHoldMode('dribble');
    p.animator.setBallMode('dribble', p.animator.ballHand);
    p.cx.dribbles++;
  }

  enterPost(p) {
    p.setState('post');
    if (p.holding) this.startDribble(p);
    this.metrics.postTouch(p.id);
    p.cx.postShoveT = 0; p.cx.postIdleT = 0; p.cx.postExitT = 0;
  }

  leavePost(p, faceUp) {
    if (faceUp) {
      p.playClip(C_FACE_UP, null);
      p.setState('faceUp'); p.faceUpT = POST.FACE_UP_T;
      this.ball.setHoldMode('held'); p.animator.setBallMode('held');
    } else p.setState('idle');
  }

  // ---------------------------------------------------------------- shots
  /** SHOOT press resolved to a shot (§5.9.1, §4.13): clip, meter timing, state; `pressMs` = the button's pressTs. */
  startShot(p, r, pressMs) {
    const w = this.world, s = p.shot;
    const ctx = selCtx(p, w);
    ctx.baseline = r.baseline; ctx.blockSide = r.blockSide;
    const sel = selectClip(p, r, ctx);
    if (sel.clipIdx < 0 || !sel.timing) return false;
    const tm = sel.timing;
    if (p.state === 'post') p.setState('idle');
    p.move.active = false;
    p.playClip(sel.clipIdx, { mirror: sel.mirror, warp: sel.warp, target: sel.target });
    s.active = true; s.kind = r.kind; s.variant = r.variant; s.side = r.side; s.clipIdx = sel.clipIdx; s.clipId = sel.clipId;
    s.mirror = sel.mirror; s.timing = tm; s.meter = tm.meter; s.tIdeal = tm.tIdeal; s.METER_T = tm.METER_T; s.meterFrom = tm.meterFrom;
    s.pressT = w.time; s.pressMs = pressMs > 0 ? pressMs : w.time * 1000; s.confirmed = false; s.released = false; s.releaseInT = 0;
    s.eT = NaN; s.takeoff = false; s.takeoffVx = 0; s.takeoffVz = 0; s.contactDef = undefined; s.launched = false; s.ability = r.ability;
    s.fromDrive = this.metrics.isDriveFinish(p.id, w.time); s.excluded = null; s.forcedP = NaN; s.forcedET = NaN; s.debug = false;
    s.switchRolled = false; s.slamDone = false; s.catchToPress = NaN; s.human = this.isUserControlled(p); s.putback = false;
    s.sagA = w.time <= p.cx.sagUntil ? JAB.SAG_A : 1; s.points = 2; s.make = false; s.airball = false;
    this.stuffRolled.fill(0);
    p.setState(r.kind === 'dunk' ? 'dunk' : r.kind === 'tip' ? 'jump' : tm.meter === 'key' ? 'layup' : 'windup');
    if (this.ball.owner === p) this.ball.setHoldMode('held');
    // euro dodge of the lane defender (§5.8 giannis.euro / generic lay.euro)
    if (r.dodged && (r.variant === 'euro')) {
      const dp = euroDodgeP(p, r.dodged);
      if (this.rng.next() < dp) { r.dodged.stun(TRIGGERS.EURO.DODGE_STUN); s.excluded = r.dodged; }
    }
    // LeBron's chase-down trigger when an opponent starts a layup / dunk (§5.8)
    if (r.kind === 'layup' || r.kind === 'dunk') {
      for (let i = 0; i < 6; i++) {
        const o = this.players[i];
        if (o.team === p.team || !has(o, 'lebron.chaseDown') || o.disabled) continue;
        const c = resetAbilityCtx(ACTX); c.t = w.time; c.log = this.abilityLog; c.shooter = p; c.kind = r.kind;
        if (trigger(o, 'blockDefender', c)) { o.chaseT = TRIGGERS.CHASE.RUN_T; o.chaseShooter = p; }
      }
    }
    if (!isJumpShot(r.kind)) this.confirmShot(p);       // layups / dunks / tips cannot be pump fakes (§5.7)
    if (this.ai.planCpuRelease && !s.human) this.ai.planCpuRelease(p, w);
    p.cx.jabsThisHold = 0;
    return true;
  }

  /** The press is a real shot (not a pump fake): `shot` event + metrics.press (§1.4.1). */
  confirmShot(p) {
    const s = p.shot, w = this.world;
    if (s.confirmed) return;
    s.confirmed = true;
    s.catchToPress = this.metrics.press(p.id, s.pressT, w.shotClock);
    if (s.kind === 'dunk' && s.variant === 'ftDunk') p.cx.ftDunks++;
    const e = this.ev('shot', p);
    e.kind = s.kind; e.variant = s.variant;
    const d = p.rimDist();
    e.zone = resolveShotZone(s.kind, d, p.pos.x, p.pos.z); e.points = shotPoints(s.kind, p.pos.x, p.pos.z);
    e.clutch = this.inClutch(p.team);
    this.fire(e);
  }

  /** Per-step shot input (release input / auto-release / pump fake; §5.3.2, §5.7, [ANIM §5.1]). */
  updateShot(p, it) {
    const s = p.shot, w = this.world;
    if (s.released || s.kind === 'dunk' || s.kind === 'tip' || !s.meter) return;
    const elapsed = w.time - s.pressT;
    let rel = -1;
    if (s.debug) { const tgt = s.tIdeal + s.forcedET; if (elapsed + 1e-9 >= tgt) rel = tgt; }
    else if (it.primary.justReleased || !it.primary.held) {
      // The DOM hold time of this press decides the timing. A press and its release sampled in the same step (a slow
      // frame longer than the hold) reach this branch one step later without the release edge: the hold still comes
      // from the DOM timestamps, not from the one step of game time that has elapsed.
      const b = it.primary;
      rel = b.releaseTs > b.pressTs && b.pressTs > 0 && Math.abs(b.pressTs - s.pressMs) < 1e-6 ? (b.releaseTs - b.pressTs) / 1000 : elapsed;
    }
    const autoT = s.meterFrom + SHOT_V2.METER_MAX * s.METER_T;
    if (rel < 0 && elapsed >= autoT) rel = autoT;
    if (!s.confirmed && (elapsed >= PUMP_FAKE.TAP_MAX || s.takeoff)) this.confirmShot(p);
    if (rel < 0) return;
    if (!s.confirmed && isPumpFake(p, rel)) { this.cancelIntoPumpFake(p); return; }
    if (!s.confirmed) this.confirmShot(p);
    this.releaseShot(p, rel - s.tIdeal, true);
  }

  /**
   * Rules release (R1 / C1): feet at this step decide the points; the shot is evaluated (§5.3), rolled once and its
   * target chosen; the ball launches at the animator's RELEASE (input + 0.05 s) from the hand socket.
   */
  releaseShot(p, eT, viaInput) {
    const s = p.shot, w = this.world;
    s.released = true; s.releaseInT = w.time; s.eT = eT;
    s.x = p.pos.x; s.z = p.pos.z;
    this.evaluateAndRoll(p, s.meter ? eT : NaN);
    if (s.human && s.meter) { this.meter.flash = s.green ? 'perfect' : eT < 0 ? 'early' : 'late'; this.meter.flashT = METER_FLASH_T; }
    if (p.state === 'windup' || p.state === 'layup') p.setState('release');
    // the animator launches at input + 0.05 s (RELEASE event); a clip without a pending release launches now
    if (viaInput && !p.animator.releaseNow()) this.launchShot(p);
  }

  evaluateAndRoll(p, eT) {
    const s = p.shot, w = this.world, inp = this.shotInput;
    resetShotInput(inp);
    inp.kind = s.kind; inp.variant = s.variant; inp.x = s.x; inp.z = s.z; inp.eT = eT;
    inp.side = sideOf(p, this); inp.difficulty = this.difficultyId;
    inp.takeoffVx = s.takeoff ? s.takeoffVx : p.vel.x; inp.takeoffVz = s.takeoff ? s.takeoffVz : p.vel.z;
    inp.quarter = w.quarter; inp.gameClock = w.gameClock; inp.scoreDiff = this.score[p.team] - this.score[1 - p.team];
    inp.t = w.time; inp.log = s.kind === 'dunk' && s.variant === 'ftDunk' ? null : this.abilityLog;
    inp.sinceBumpWon = w.time - p.cx.wonBumpT; inp.sagA = s.sagA; inp.excluded = s.excluded;
    if (s.takeoff) inp.contactDef = s.contactDef || null;
    inp.forcedP = s.forcedP;
    const r = evaluateShot(p, w, inp);
    s.points = r.points; s.zone = r.zone; s.p = r.p; s.gS = r.gS; s.green = r.green; s.airball = r.airball; s.C = r.C; s.X = r.X;
    s.make = !r.airball && this.rng.next() < r.p;
    const tg = chooseTarget(s.make, inp.eT, r.gS, s.kind, s.x, s.z, r.C, this.rng);
    s.targetX = tg.x; s.targetY = tg.y; s.targetZ = tg.z;
    s.defDist = r.defender ? Math.sqrt((r.defender.pos.x - s.x) ** 2 + (r.defender.pos.z - s.z) ** 2) : NaN;
  }

  /** RELEASE: the ball leaves the hand socket on the arc to the chosen target (§4.5, B52). */
  launchShot(p) {
    const s = p.shot, w = this.world, ball = this.ball;
    if (!s.active || s.launched) return;
    if (!s.released) { this.releaseShot(p, (w.time - s.pressT - 0.05) - s.tIdeal, false); }
    s.launched = true;
    if (ball.owner !== p) { s.active = false; return; }      // lost the ball before the release
    p.animator.querySocket(SOCK.ball, P_HAND);
    if (P_HAND.z < BOARD_FRONT_Z && Math.abs(P_HAND.x - RIM.x) < BOARD_REACH_X) P_HAND.z = BOARD_FRONT_Z;
    let ux = P_HAND.x - RIM.x, uz = P_HAND.z - RIM.z;
    const ud = Math.sqrt(ux * ux + uz * uz);
    if (ud < UNDER_RIM_R) {
      if (ud > 1e-6) { ux /= ud; uz /= ud; } else { ux = Math.sin(p.yaw); uz = Math.cos(p.yaw); }
      P_HAND.x = RIM.x + ux * UNDER_RIM_R; P_HAND.z = RIM.z + uz * UNDER_RIM_R;
    }
    P_TO.x = s.targetX; P_TO.y = s.targetY; P_TO.z = s.targetZ;
    const d = Math.sqrt((s.x - RIM.x) ** 2 + (s.z - RIM.z) ** 2);
    solveArc(P_HAND, P_TO, apexForDistance(d), BALL.G, ARC);
    ball.launch(ARC, 'flight', P_HAND);
    ball.backspin = true;          // every flight shot leaves the hand with backspin (checks up at its first bounce)
    this.bookShotLaunch(p);
    ball.spinMode = s.variant === 'fingerRoll' ? 'underspin' : null;
    const e = this.ev('release', p); e.kind = s.kind; e.zone = s.zone; e.points = s.points; e.variant = s.variant; this.fire(e);
    if (s.airball) { this.caption('cap.airball', p, 1); }
    this.rollBoxOuts(p);
  }

  /** Common bookkeeping when a shot leaves the hand (flight or slam): ball.shot, FGA, metrics, block rolls. */
  bookShotLaunch(p) {
    const s = p.shot, w = this.world, ball = this.ball, b = ball.shot;
    ball.ctx = 'shot';
    b.shooter = p; b.team = p.team; b.kind = s.kind; b.variant = s.variant; b.zone = s.zone; b.points = s.points;
    b.releaseTime = s.releaseInT || w.time; b.touched = false; b.make = s.make; b.blocked = false; b.airball = s.airball; b.eT = s.eT;
    b.x = s.x; b.z = s.z; b.active = true;
    p.stats.fga++;
    if (s.points === 3) p.stats.tpa++;
    const R = SHOT_REC;
    R.t = w.time; R.shooter = p.id; R.team = p.team; R.kind = s.kind; R.variant = s.variant; R.zone = s.zone;
    R.d = Math.sqrt((s.x - RIM.x) ** 2 + (s.z - RIM.z) ** 2); R.three = s.points === 3; R.points = s.points; R.eT = s.eT;
    R.X = s.X; R.C = s.C; R.p = s.p; R.make = s.make; R.releaseSpeed = Math.sqrt(s.takeoffVx * s.takeoffVx + s.takeoffVz * s.takeoffVz);
    R.catchToPress = s.catchToPress; R.defDist = s.defDist; R.urgent = w.shotClock < 3; R.fromDrive = s.fromDrive;
    this.metrics.shot(R);
    this.blockRolled.fill(0);
    const P = this.pending;
    P.active = true; P.shooter = p; P.team = p.team; P.kind = s.kind; P.airball = s.airball; P.missed = false; P.bank = false;
  }

  /** The 'miss' event and metrics.missResolved for the pending shot (once). */
  resolveMiss(oob) {
    const P = this.pending;
    if (!P.active || P.missed) return;
    P.missed = true;
    const b = this.ball.shot;
    const e = this.ev('miss', P.shooter); e.kind = P.kind; e.airball = P.airball; this.fire(e);
    this.metrics.missResolved(P.team, P.airball, !this.ball.contacted && !b.touched, !!oob);
    if (P.shooter) P.shooter.streak = 0;
  }

  cancelIntoPumpFake(p) {
    const s = p.shot;
    s.active = false;
    p.animator.stopAction();
    p.setState('idle');
    this.startPumpFake(p, p.id === 'yao' && s.kind === 'hook' ? 'sig.yao.pumpHook' : 'move.pumpFake');
  }

  /** Pump fake (§5.7): clip, `pumpFake` event, CPU defenders within 1.6 m bite with pBite (airborne). */
  startPumpFake(p, clipId) {
    const w = this.world;
    const idx = clipIndex(clipId || 'move.pumpFake');
    p.playClip(idx >= 0 ? idx : C_PUMP, null);
    p.setState('cross');
    p.move.active = true; p.move.id = clipId || 'move.pumpFake'; p.move.startT = w.time; p.move.resolved = true; p.move.chain = 1;
    p.cx.lastPumpFakeT = w.time; p.cx.lastMoveId = p.move.id; p.cx.lastMoveT = w.time;
    if (this.ball.owner === p) { this.ball.setHoldMode('held'); p.animator.setBallMode('held'); }
    const e = this.ev('pumpFake', p); e.moveId = p.move.id; this.fire(e);
    this.metrics.pumpFake(p.id);
    for (let i = 0; i < 6; i++) {
      const d = this.players[i];
      if (d.team === p.team || this.isUserControlled(d) || !d.canAct) continue;
      const dx = d.pos.x - p.pos.x, dz = d.pos.z - p.pos.z;
      if (dx * dx + dz * dz > PUMP_FAKE.BITE_R * PUMP_FAKE.BITE_R) continue;
      const D = this.cpuDiff(d);
      if (this.rng.next() < biteChance(d, D.biteBase, 1)) { d.cx.bitT = w.time; this.startDefJump(d, 'contest', false, false, p); }
    }
  }

  /** Jab (§5.7, kobe.jab): the jab clip; the bite resolves at its FAKE event. */
  startJab(p, moveId, mirror) {
    const w = this.world;
    const c = resetAbilityCtx(ACTX); c.t = w.time; c.log = this.abilityLog; c.holding = true; c.jabsThisHold = p.cx.jabsThisHold;
    c.stickMag = p.intent.move.mag; c.stickDef = 1; c.world = w;
    trigger(p, 'move', c);
    p.playClip(clipIndex(moveId), { mirror });
    p.setState('cross');
    p.move.active = true; p.move.id = moveId; p.move.startT = w.time; p.move.resolved = false; p.move.chain = 1;
    p.cx.jabsThisHold++; p.cx.lastJabT = w.time; p.cx.lastMoveId = moveId; p.cx.lastMoveT = w.time;
    const e = this.ev('jab', p); e.moveId = moveId; this.fire(e);
    this.metrics.jab(p.id);
  }

  resolveJabBite(p) {
    const w = this.world;
    p.move.resolved = true;
    for (let i = 0; i < 6; i++) {
      const d = this.players[i];
      if (d.team === p.team || this.isUserControlled(d) || d.disabled || d.isJumping) continue;
      const dx = d.pos.x - p.pos.x, dz = d.pos.z - p.pos.z, dd = Math.sqrt(dx * dx + dz * dz);
      if (dd > JAB.BITE_R) continue;
      const c = resetAbilityCtx(ACTX); c.t = w.time; c.log = this.abilityLog; c.what = 'bite';
      const pb = biteChance(d, this.cpuDiff(d).biteBase, mul(p, 'move', c));
      if (this.rng.next() >= pb) continue;
      d.cx.bitT = w.time;
      if (this.rng.next() < JAB.SAG_P) { d.push(dx / (dd || 1), dz / (dd || 1), JAB.SAG_DIST, 0.25); p.cx.sagUntil = w.time + JAB.SAG_WINDOW; }
      else d.stun(JAB.LUNGE_STUN);
    }
  }

  // ---------------------------------------------------------------- dribble moves and combos (§5.7)
  startMove(p, moveId, mirror, chain) {
    const w = this.world;
    const idx = clipIndex(moveId);
    if (idx < 0) return false;
    if (p.holding && moveId !== 'sig.giannis.elbowDrive') this.startDribble(p);
    p.playClip(idx, { mirror });
    p.setState('cross');
    const m = p.move;
    m.active = true; m.id = moveId; m.clipIdx = idx; m.startT = w.time; m.chain = chain; m.resolved = false; m.mirror = mirror;
    const clip = p.animator.actionClip;
    m.cancelT = clip && clip.timing && clip.timing.cancel > 0 ? clip.timing.cancel : (clip ? clip.dur : 0.4);
    const M = MOVES_V2[moveId];
    if (M && M.imm) p.immuneUntil = w.time + M.imm[1];
    p.cx.lastMoveId = moveId; p.cx.lastMoveT = w.time; p.cx.comboIndex = chain;
    if (chain >= 2) {
      const c = resetAbilityCtx(ACTX); c.t = w.time; c.log = this.abilityLog; c.comboIndex = chain; c.inMove = moveId; c.sinceTap = 0; c.dribbling = true;
      trigger(p, 'move', c);
    }
    const e = this.ev('move', p); e.moveId = moveId; e.what = chain >= 2 ? 'combo' : null; this.fire(e);
    this.metrics.move(p.id);
    if (moveId === 'sig.lebron.powerDrive' || moveId === 'sig.giannis.elbowDrive' || moveId === 'sig.kobe.jabGo') { p.cx.driveT = w.time; }
    return true;
  }

  queueCombo(p, r) {
    p.cx.queued = true; p.cx.queuedLat = 0; p.cx.queuedFwd = 0;
    const m = p.intent.move;
    p.cx.queuedMag = m.mag;
    p.cx.queuedLat = (m.x * Math.cos(p.yaw) - m.z * Math.sin(p.yaw)) * m.mag;
    p.cx.queuedFwd = (m.x * Math.sin(p.yaw) + m.z * Math.cos(p.yaw)) * m.mag;
    p.cx.comboNext = r.comboIndex;
    if (!(p.state === 'cross' && p.move.active)) this.runQueuedMove(p);
  }

  /** Start the queued combo move (§5.7): the stick at the queued tap; neutral → alternate direction. */
  runQueuedMove(p) {
    p.cx.queued = false;
    let lat = p.cx.queuedLat, fwd = p.cx.queuedFwd;
    if (p.cx.queuedMag < 0.15) lat = p.move.mirror ? -0.8 : 0.8;   // alternate the direction of the previous move
    STICK.lat = lat; STICK.fwd = fwd;
    MOVE_CTX.holding = false; MOVE_CTX.speed = p.speed; MOVE_CTX.dribbleHand = p.animator.ballHand === 2 ? 'L' : 'R';
    MOVE_CTX.defFront = Infinity; MOVE_CTX.rng = this.rng;
    const sel = selectMove(p, STICK, MOVE_CTX);
    if (sel.clipIdx < 0 || sel.moveId === 'move.pumpFake') return false;
    return this.startMove(p, sel.moveId, sel.mirror, Math.min(p.cx.comboNext || 2, chainLength(p)));
  }

  /** Shake / ankle-break at the move's first PLANT (§5.7). */
  resolveShake(h) {
    const w = this.world, m = h.move;
    m.resolved = true;
    if (!MOVES_V2[m.id]) return;
    let d = null, best = SHAKE.RESOLVE_R;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    for (let i = 0; i < 6; i++) {
      const o = this.players[i];
      if (o.team === h.team || o.disabled || o.isJumping) continue;
      const dx = o.pos.x - h.pos.x, dz = o.pos.z - h.pos.z, dd = Math.sqrt(dx * dx + dz * dz);
      if (dd > best || dd < 1e-6 || (dx * fx + dz * fz) / dd < SHAKE.RESOLVE_DOT) continue;
      best = dd; d = o;
    }
    if (!d) return;
    // commit: the defender moves ≥ 2.0 m/s toward the side the ball comes from, or bit / failed a steal ≤ 0.4 s ago
    const lx = Math.cos(h.yaw), lz = -Math.sin(h.yaw);           // handler's left
    const fromSide = m.mirror ? 1 : -1;                          // moves are authored right → left: the ball comes from the right
    const vSide = (d.vel.x * lx + d.vel.z * lz) * fromSide;
    const committed = vSide >= SHAKE.COMMIT_SPEED || w.time - d.cx.bitT <= SHAKE.COMMIT_WINDOW || w.time - d.cx.lastStealFailT <= SHAKE.COMMIT_WINDOW;
    const hu = this.isUserControlled(h), du = this.isUserControlled(d);
    const D = DIFFICULTY[this.difficultyId];
    const dm = hu && !du ? D.humanShakeMul : (!hu && du ? D.cpuShakeMul : 1);
    const S = shakeChance(h, d, m.id, { committed, combo: m.chain, diffMul: dm });
    if (S.pAnkle > 0 && !h.cx.ankleThisPoss && !d.cx.ankledThisPoss && this.rng.next() < S.pAnkle) {
      h.cx.ankleThisPoss = true; d.cx.ankledThisPoss = true;
      d.fall(SHAKE.FALLEN_T);
      d.playClip(C_ANKLE, null);
      h.immuneUntil = Math.max(h.immuneUntil, w.time) + SHAKE.ANKLE_IMMUNITY_ADD;
      this.caption('cap.ankle', h, 2);
      const e = this.ev('ankle', h); e.defenderId = d.id; this.fire(e);
      this.metrics.ankle(h.team);
      return;
    }
    if (this.rng.next() < S.pShake) {
      d.stun(SHAKE.STUN_T);
      d.playClip(C_STUMBLE, null);
      d.push(lx * fromSide, lz * fromSide, SHAKE.SLIDE, 0.25);
      const e = this.ev('shake', h); e.defenderId = d.id; this.fire(e);
    }
  }

  // ---------------------------------------------------------------- passes (§5.5, C6)
  startPass(p, target, lob) {
    const w = this.world, a = p.passAct;
    const dx = target.pos.x - p.pos.x, dz = target.pos.z - p.pos.z, dist = Math.sqrt(dx * dx + dz * dz);
    const kickOut = this.metrics.isDriveFinish(p.id, w.time);
    passRule(p, p.attrs, dist, kickOut, PASS_RULE);
    const P = PASS_CTX;
    P.dist = dist; P.lob = !!lob; P.bounce = false; P.post = p.state === 'post'; P.doubled = this.doubled(p); P.chinned = p.holding;
    P.fromDribble = p.dribbling; P.inHand = p.procDribble ? p.dribbleY > 0.75 : true; P.pickup = p.dribbling ? 0.06 : 0;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    P.angle = Math.atan2(dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw), dx * fx + dz * fz);
    P.speed = p.speed; P.passRelease = PASS_RULE.release; P.rng = this.cosRng;
    const sel = selectPass(p, P);
    if (sel.clipIdx >= 0) p.playClip(sel.clipIdx, { mirror: sel.mirror, warp: sel.warp, layer: sel.layer });
    a.active = true; a.target = target; a.lob = !!lob; a.kind = sel.passId === 'pass.lob' ? 'lob' : sel.passId === 'pass.bounce' ? 'bounce'
      : sel.passId === 'pass.overhead' || sel.passId === 'sig.yao.overheadPass' || sel.passId === 'sig.lebron.skipOverhead' ? 'overhead'
        : sel.passId === 'sig.lebron.skipPass' ? 'skip' : 'chest';
    a.releaseT = sel.releaseT; a.startT = w.time; a.layer = sel.layer; a.speed = PASS_RULE.speed; a.sigmaMul = PASS_RULE.sigmaMul;
    a.skip = PASS_RULE.id === 'lebron.skipPass'; a.kickOut = kickOut; a.beyond = dist > PASS_RULE.range;
    if (a.skip) { const c = resetAbilityCtx(ACTX); c.t = w.time; c.log = this.abilityLog; c.what = 'sigma'; c.dist = dist; c.kickOut = kickOut; mul(p, 'pass', c); }
    if (this.ball.owner === p) this.ball.setHoldMode('held');
    if (p.state === 'post') p.setState('idle');
    p.passTarget = null;
  }

  doubled(p) {
    let k = 0;
    for (let i = 0; i < 6; i++) {
      const o = this.players[i];
      if (o.team === p.team) continue;
      const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
      if (dx * dx + dz * dz <= 2.25) k++;
    }
    return k >= 2;
  }

  /** Pass RELEASE: launch from the hand socket toward the led receiver with the §5.5 aim error. */
  launchPass(p) {
    const w = this.world, a = p.passAct, ball = this.ball, to = a.target;
    a.active = false;
    if (ball.owner !== p || !to) return;
    p.animator.querySocket(SOCK.ball, P_HAND);
    const dx0 = to.pos.x - P_HAND.x, dz0 = to.pos.z - P_HAND.z, dist = Math.sqrt(dx0 * dx0 + dz0 * dz0);
    const speed = a.beyond && !a.skip ? PASS.BEYOND_SPEED : a.speed;
    const tFlight = a.lob ? 1.2 : Math.max(dist / speed, PASS.MIN_FLIGHT);
    P_TO.x = to.pos.x + to.vel.x * tFlight; P_TO.z = to.pos.z + to.vel.z * tFlight; P_TO.y = BALL.CHEST_Y;
    // aim error N(0, σ) lateral at the receiver: σ = passSigma × pressure × distF × cpuPassMul (× skip 0.6, jump 1.5, beyond 1.6)
    let pressure = 1;
    for (let i = 0; i < 6; i++) { const o = this.players[i]; if (o.team !== p.team && (o.pos.x - p.pos.x) ** 2 + (o.pos.z - p.pos.z) ** 2 <= PASS.PRESSURE_R * PASS.PRESSURE_R) { pressure = 1 + PASS.PRESSURE_K; break; } }
    const distF = PASS.DIST_BASE + PASS.DIST_K * dist;
    const D = this.cpuDiff(p);
    const cpuMul = this.isUserControlled(p) || w.auto || p.team === w.user ? 1 : D.cpuPassMul;
    let sigma = p.attrs.passSigma * pressure * distF * cpuMul * a.sigmaMul;
    if (p.isJumping && !a.skip && !has(p, 'lebron.skipPass')) sigma *= PASS.JUMP_SIGMA;
    if (a.beyond && !a.skip) sigma *= PASS.BEYOND_SIGMA;
    const err = this.rng.gauss(0, sigma);
    const lx = dist > 1e-6 ? -dz0 / dist : 1, lz = dist > 1e-6 ? dx0 / dist : 0;
    P_TO.x += lx * err; P_TO.z += lz * err;
    solvePass(P_HAND, P_TO, a.lob, speed, ARC);
    ball.launch(ARC, 'pass', P_HAND);
    ball.ctx = 'pass';
    const pi = ball.passInfo;
    pi.receiver = to; pi.from = p; pi.kind = a.kind; pi.lob = a.lob; pi.releaseTime = w.time; pi.flightT = ARC.T; pi.team = p.team;
    this.intRolled.fill(0);
    this.metrics.pass(p.team);
    this.metrics.driveReset(p.id);
    const e = this.ev('pass', p); e.toId = to.id; e.kind = a.kind; e.lob = a.lob; this.fire(e);
  }

  // ---------------------------------------------------------------- defence actions
  /** Defensive / rebound jump (§5.9.3, C8): hJump (signature clips their own h); TAKEOFF starts the jump. */
  startDefJump(p, intent, chase, help, shooter) {
    if (!p.canAct && p.state !== 'steal') return false;
    DEF_CTX.intent = intent; DEF_CTX.chase = !!chase; DEF_CTX.help = !!help; DEF_CTX.hJump = p.attrs.hJump;
    DEF_CTX.arm = shooter && ((shooter.pos.x - p.pos.x) * Math.cos(p.yaw) - (shooter.pos.z - p.pos.z) * Math.sin(p.yaw)) > 0 ? 'L' : 'R';
    const sel = selectDefJump(p, DEF_CTX);
    if (sel.clipIdx < 0) return false;
    p.playClip(sel.clipIdx, { mirror: sel.mirror });
    p.setState('jump');
    const dj = p.defJump;
    dj.active = true; dj.intent = intent; dj.h = sel.h; dj.chase = !!chase; dj.help = !!help; dj.clipIdx = sel.clipIdx;
    if (chase && shooter) p.chaseShooter = shooter;
    p.stealAct.active = false;
    return true;
  }

  startPoke(p, human) {
    const w = this.world, h = this.ball.owner;
    if (!p.canAct || p.stealCd > 0) return false;
    if (!human) {
      // R7: no CPU poke in the first 0.8 s of LIVE or within 0.5 s after the handler's catch
      if (w.liveT < STEAL.LIVE_GRACE) return false;
      if (h && w.time - h.cx.catchT < STEAL.CATCH_GRACE) return false;
    }
    p.stealCd = human ? STEAL.COOLDOWN_HUMAN : this.cpuDiff(p).cpuStealInterval;
    const idx = p.id === 'jordan' && clipIndex('sig.jordan.steal') >= 0 ? clipIndex('sig.jordan.steal') : C_DEF_STEAL;
    p.playClip(idx, null);
    p.setState('steal');
    p.stealAct.active = true; p.stealAct.startT = w.time; p.stealAct.resolved = false;
    p.cx.lastStealT = w.time;
    return true;
  }

  /** SWIPE: eligibility re-checked, one roll (§5.5); success = loose ball toward the defender (STL at the catch). */
  resolvePoke(p) {
    const w = this.world, ball = this.ball, h = ball.owner;
    p.stealAct.resolved = true;
    if (!h || h.team === p.team) return;
    const c = resetAbilityCtx(ACTX); c.what = 'range'; c.t = w.time; c.log = this.abilityLog;
    const range = p.attrs.stealRange + add(p, 'steal', c);
    const dx = p.pos.x - h.pos.x, dz = p.pos.z - h.pos.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > range) return;
    const hs = h.state;
    const eligible = ball.state === 'dribble' && w.time > h.immuneUntil && !h.isJumping && hs !== 'windup' && hs !== 'layup'
      && hs !== 'dunk' && hs !== 'release' && !h.shot.active;
    // ball on the dribble hand nearer the defender: handler's right = −left
    const lx = Math.cos(h.yaw), lz = -Math.sin(h.yaw);
    const defOnLeft = dx * lx + dz * lz > 0;
    const ballLeft = h.animator.ballHand === 2;
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const behind = d > 1e-6 && (dx * fx + dz * fz) / d < STEAL.BEHIND_DOT;
    const protect = h.speed < 2.5 && !!h.nearestOpponentInFront(w, 1.0);
    const exposed = ball.pos.y < STEAL.EXPOSED_Y;
    const R = pokeChance(p, h, { side: sideOf(p, this), difficulty: this.difficultyId, ballNear: defOnLeft === ballLeft, exposed, protect, behind,
      eligible, log: this.abilityLog, t: w.time });
    if (eligible && this.rng.next() < R.pPoke) {
      const ux = d > 1e-6 ? dx / d : 0, uz = d > 1e-6 ? dz / d : 1;
      V3.x = ux * STEAL.LOOSE_SPEED; V3.y = STEAL.LOOSE_UP; V3.z = uz * STEAL.LOOSE_SPEED;
      ball.launch(V3, 'loose', null);
      ball.lastToucher = p; ball.ctx = 'steal';
      ball.exclude1 = h; ball.exclude2 = null;           // 0.3 s victim exclusion (§5.5)
      this.stealVictim = h; this.stealT = w.time;
      h.animator.setBallMode('free');
      return;
    }
    // failure: stunned 0.30 s (0.55 s for a second fail within 3.0 s); def.stealMiss time-scaled (C5)
    const repeat = w.time - p.cx.lastStealFailT <= STEAL.REPEAT_WINDOW;
    const stun = repeat ? STEAL.STUN_REPEAT : STEAL.STUN;
    p.cx.lastStealFailT = w.time;
    p.stun(stun);
    p.playClip(C_STEAL_MISS, { rate: 0.35 / stun });
  }

  /** Human lane lunge during a pass (§5.5): +0.20 intR for 0.40 s, 1.0 m toward the pass line in 0.25 s. */
  startLunge(p) {
    const w = this.world, b = this.ball, pi = b.passInfo;
    if (!p.canAct) return;
    p.cx.lungeT = w.time;
    const r = pi.receiver || b;
    const ax = b.pos.x, az = b.pos.z, bx = r.pos.x, bz = r.pos.z;
    const abx = bx - ax, abz = bz - az, l2 = abx * abx + abz * abz;
    const t = l2 > 1e-9 ? clamp(((p.pos.x - ax) * abx + (p.pos.z - az) * abz) / l2, 0, 1) : 0;
    const cx = ax + abx * t - p.pos.x, cz = az + abz * t - p.pos.z, cl = Math.sqrt(cx * cx + cz * cz);
    if (cl > 1e-6) p.push(cx / cl, cz / cl, Math.min(INTERCEPT.LUNGE_DIST, cl), INTERCEPT.LUNGE_DUR);
  }

  cpuDiff(p) {
    const w = this.world;
    if (w.auto || p.team === w.user) return DIFFICULTY.normal;
    return DIFFICULTY[this.difficultyId];
  }

}
