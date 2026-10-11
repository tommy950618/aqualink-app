/**
 * @module ball
 * The one ball: state machine, socket attachment and per-step physics (v1 spec §5.1–§5.8, §5.13; v2 spec §1.2,
 * §4.5 / [ANIM §2.5, §10.6], §5.3.5, §5.13 R2/R4/R5).
 *
 * Exports: `Ball`, `BALL_STATES`.
 *
 * v2 changes against v1
 * - No mesh, texture or shadow here: the look and the visual spin are `src/render/ballvis.js` (WP6), which reads
 *   `{ state, pos, vel, owner, passInfo.kind, spinMode, visible }`. This module is pure simulation and runs in Node.
 * - Attachment by socket (spec §4.5): while held or dribbled, the sim position is the owner's
 *   `animator.querySocket(SOCK.ball)` (both hands = midpoint of the ball1 sockets, R/L = that hand, drib = the
 *   dribble path). A headless AnimProxy has no dribble path, so for a player with `procDribble` the height comes from
 *   the gameplay dribble phase (`player.dribbleY`, v1 §5.7 bounce model).
 * - `launch(v, state, from)` starts a flight / pass / loose ball from a socket position (the animator's RELEASE /
 *   SLAM point), so the rendered socket and the launch point coincide (no pop).
 * - `shot.touched` (R2: rim, board, block or deflection), `looseT` (R4: total seconds loose since the last launch),
 *   `shot.points` kept for deflected / blocked makes (R5), `spinMode` ('finger' | 'underspin' | null) for ballvis.
 * - Catch test with per-player `attrs` (catchR, passReceiveR, catchTopY + jumpY; §5.5 / §5.6).
 *
 * Ball events (step() fills a caller array with pooled records `{type, value, player}`; nothing allocates per step):
 * `bounce` (dribble floor contact), `floor` (free-ball floor contact), `rim`, `board`, `score` (value = 1 swish /
 * 2 after a rim or board contact), `oob`, `rest` (free ball resting 1.5 s on the floor), `nan` (non-finite guard).
 */
import * as THREE from '../vendor/three.module.js';
import { BALL, COURT, RIM } from './constants.js';
import { stepFreeBall } from './physics.js';
import { SOCK } from './anim/rig.js';

/** Every ball state. */
export const BALL_STATES = Object.freeze(['held', 'dribble', 'flight', 'pass', 'loose', 'scored']);

const R = BALL.R;
const BOUNCE_SFX_S = BALL.BOUNCE_SFX_MS / 1000;
const OOB_X = COURT.HALF_W + COURT.OOB_MARGIN;
const OOB_Z_MIN = COURT.BASELINE_Z - COURT.OOB_MARGIN;
const EVENT_POOL = 16;
const REST_T = 1.5;                                     // v1 §5.13 resting free ball
const DRIBBLE_BOUNCE_STRENGTH = 0.5;                    // v1 dribble bounce sound strength
const SAFE_RESET = { x: 0, y: BALL.CHEST_Y, z: -4.6 };  // handler spot after a NaN reset (a CHECK follows)
const STEP_OUT = { floor: 0, rim: 0, board: 0, scored: false };

function v3get(v, k, alt) {
  return v[k] !== undefined ? v[k] : v[alt];
}

export class Ball {
  /** @param {import('./math.js').Rng|null} rng gameplay Rng (rim jitter) */
  constructor(rng) {
    this.rng = rng || null;
    this.state = 'loose';
    this.owner = null;
    this.lastToucher = null;
    /** Pending shot (rules record): `touched` R2, `points` R1/R5. `shotInfo` is a v1-compatible alias. */
    this.shot = {
      shooter: null, team: -1, kind: 'jumper', variant: null, zone: 'mid', points: 2, releaseTime: 0,
      touched: false, make: false, blocked: false, airball: false, eT: NaN, x: 0, z: 0, active: false,
    };
    this.shotInfo = this.shot;
    this.passInfo = { receiver: null, from: null, kind: 'chest', lob: false, releaseTime: 0, flightT: 0, team: -1 };
    /** What the free ball is: 'none' | 'shot' | 'pass' | 'steal' | 'block' | 'deflect' | 'dunk'. */
    this.ctx = 'none';
    this.pos = new THREE.Vector3(0, R, 0);
    this.prevPos = new THREE.Vector3(0, R, 0);
    this.vel = new THREE.Vector3();
    this.rimContacts = 0;
    this.rimEnabled = true;
    this.boardEnabled = true;
    this.scoredT = 0;
    this.restT = 0;
    this.restEmitted = false;
    this.oobEmitted = false;
    this.releaseAge = 0;
    this.looseT = 0;
    this.holdT = 0;
    this.time = 0;
    this.lastBounceT = -1;
    this.contacted = false;                 // rim / board / floor / player contact since the last launch
    this.exclude1 = null;                   // players who may not catch this free ball before releaseAge 0.3 s
    this.exclude2 = null;                   //   (the blocker and the shooter of a swatted shot, a poked handler)
    this.spinMode = null;
    this.visible = true;
    this.events = [];
    this.pool = new Array(EVENT_POOL);
    for (let i = 0; i < EVENT_POOL; i++) this.pool[i] = { type: '', value: 0, player: null };
    this.poolUsed = 0;
  }

  get isFree() { return this.state === 'flight' || this.state === 'pass' || this.state === 'loose'; }
  get isHeld() { return this.state === 'held' || this.state === 'dribble'; }
  /** v1 alias used by presentation code. */
  get position() { return this.pos; }

  /**
   * Give the ball to a player: mode 'held' (both hands) or 'dribble'. The game also calls the animator (onCatch /
   * setBallMode); this only moves the sim state and places the ball on the socket.
   */
  attachTo(player, mode) {
    const m = mode === 'dribble' ? 'dribble' : 'held';
    if (this.owner && this.owner !== player) { this.owner.hasBall = false; this.owner.ballMode = null; }
    this.owner = player;
    this.lastToucher = player;
    this.state = m;
    player.hasBall = true;
    player.ballMode = m;
    this.vel.set(0, 0, 0);
    this.rimContacts = 0;
    this.rimEnabled = true;
    this.boardEnabled = true;
    this.holdT = 0;
    this.restT = 0;
    this.scoredT = 0;
    this.releaseAge = 0;
    this.looseT = 0;
    this.restEmitted = false;
    this.oobEmitted = false;
    this.contacted = false;
    this.ctx = 'none';
    this.spinMode = null;
    this.placeOnOwner();
    this.prevPos.copy(this.pos);
  }

  /** Switch a held ball between 'held' and 'dribble' without a new catch. */
  setHoldMode(mode) {
    if (!this.isHeld || !this.owner) return;
    this.state = mode === 'dribble' ? 'dribble' : 'held';
    this.owner.ballMode = this.state;
  }

  /**
   * Release the ball with velocity v ({x, y, z} or a solver result {vx, vy, vz}) into 'flight' | 'pass' | 'loose' |
   * 'scored', optionally from position `from` (the socket at RELEASE / SLAM). Flight / pass bookkeeping (shot / pass
   * records) is filled by the game before or after the call; this resets the per-flight physics state.
   */
  launch(v, state, from) {
    if (from) this.pos.set(from.x, from.y, from.z);
    this.prevPos.copy(this.pos);
    this.vel.set(v3get(v, 'vx', 'x'), v3get(v, 'vy', 'y'), v3get(v, 'vz', 'z'));
    if (this.owner) {
      this.owner.hasBall = false;
      this.owner.ballMode = null;
      this.lastToucher = this.owner;
      this.owner = null;
    }
    this.state = state === 'pass' || state === 'loose' || state === 'scored' ? state : 'flight';
    this.releaseAge = 0;
    this.looseT = 0;
    this.rimContacts = 0;
    this.rimEnabled = this.state !== 'scored';
    this.boardEnabled = this.state !== 'scored';
    this.restT = 0;
    this.scoredT = 0;
    this.restEmitted = false;
    this.oobEmitted = false;
    this.lastBounceT = -1;
    this.contacted = false;
    this.exclude1 = null; this.exclude2 = null;
  }

  /**
   * Catch test (v1 §5.8 with v2 attributes): not while the player already has the ball or is dunking; a shot only
   * after 0.3 s of flight (its shooter too); horizontal distance within `passReceiveR` for the intended receiver of a
   * pass, else `catchR`; ball centre in [0.15, catchTopY + jumpY]; speed below 14 m/s.
   */
  canBeCaughtBy(player) {
    if (!player || player.hasBall || player.state === 'dunk' || player.state === 'fallen') return false;
    const st = this.state;
    if (st === 'flight') { if (this.releaseAge <= BALL.CATCH_FLIGHT_AGE) return false; }
    else if (st !== 'pass' && st !== 'loose') return false;
    if (this.shot.shooter === player && this.shot.active && this.releaseAge < BALL.CATCH_FLIGHT_AGE) return false;
    if ((player === this.exclude1 || player === this.exclude2) && this.releaseAge < BALL.CATCH_FLIGHT_AGE) return false;
    const a = player.attrs;
    const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z;
    const r = st === 'pass' && this.passInfo.receiver === player ? a.passReceiveR : a.catchR;
    if (dx * dx + dz * dz >= r * r) return false;
    const jumpY = player.jumpY > 0 ? player.jumpY : 0;
    if (this.pos.y < BALL.CATCH_MIN_Y || this.pos.y > a.catchTopY + jumpY) return false;
    const v = this.vel;
    return v.x * v.x + v.y * v.y + v.z * v.z < BALL.CATCH_MAX_SPEED * BALL.CATCH_MAX_SPEED;
  }

  /** True when a free ball's centre is out of bounds (v1 §1), or a held ball's holder stands out. */
  isOutOfBounds() {
    if (this.isHeld) {
      if (!this.owner) return false;
      const p = this.owner.pos;
      return Math.abs(p.x) > COURT.HALF_W || p.z < COURT.BASELINE_Z || p.z > COURT.MID_Z;
    }
    const p = this.pos;
    return Math.abs(p.x) > OOB_X || p.z < OOB_Z_MIN || p.z > COURT.MID_Z;
  }

  emit(events, type, value, player) {
    if (this.poolUsed >= EVENT_POOL) return null;
    const e = this.pool[this.poolUsed++];
    e.type = type; e.value = value; e.player = player || null;
    events.push(e);
    return e;
  }

  /**
   * Kinematic placement on the owner: the animator's ball socket (spec §4.5). For a headless proxy dribble the height
   * follows the gameplay bounce phase (`owner.dribbleY`).
   */
  placeOnOwner() {
    const o = this.owner;
    if (!o) return;
    const a = o.animator;
    if (a) a.querySocket(SOCK.ball, this.pos);
    else { this.pos.set(o.pos.x, BALL.CHEST_Y + (o.jumpY || 0), o.pos.z); }
    if (this.state === 'dribble' && o.procDribble && !o.isJumping) this.pos.y = o.dribbleY;
    if (!(this.pos.y >= R)) this.pos.y = R;
  }

  /** One fixed step; `events` is cleared first and returned. */
  step(dt, events = this.events) {
    events.length = 0;
    this.poolUsed = 0;
    this.time += dt;
    this.prevPos.copy(this.pos);

    if (this.isHeld) {
      const o = this.owner;
      if (!o || !o.hasBall) {
        this.owner = null;
        this.state = 'loose';
      } else {
        this.stepHeld(dt, o, events);
        return events;
      }
    }

    if (this.state === 'scored') {
      this.scoredT += dt;
      this.rimEnabled = false;
      this.boardEnabled = false;
      stepFreeBall(this, dt, this.rng, STEP_OUT);
      if (STEP_OUT.floor > 0) this.bounce(events, 'floor', STEP_OUT.floor);
      if (this.scoredT >= BALL.SCORED_T) {
        this.state = 'loose';
        this.rimEnabled = true;
        this.boardEnabled = true;
        this.releaseAge = 0;
        this.ctx = 'none';
      }
    } else {
      this.releaseAge += dt;
      if (this.state === 'loose') this.looseT += dt;
      stepFreeBall(this, dt, this.rng, STEP_OUT);
      if (STEP_OUT.rim > 0) { this.emit(events, 'rim', STEP_OUT.rim, this.lastToucher); this.contacted = true; this.shot.touched = this.shot.touched || this.ctx === 'shot'; }
      if (STEP_OUT.board > 0) { this.emit(events, 'board', STEP_OUT.board, this.lastToucher); this.contacted = true; this.shot.touched = this.shot.touched || this.ctx === 'shot'; }
      if (STEP_OUT.floor > 0) { this.bounce(events, 'floor', STEP_OUT.floor); this.contacted = true; }
      if (STEP_OUT.scored && this.state !== 'pass') {
        this.score(events);
      } else if ((STEP_OUT.rim > 0 || STEP_OUT.board > 0 || STEP_OUT.floor > 0 || this.pos.y <= R + 1e-6)
        && (this.state === 'flight' || this.state === 'pass')) {
        this.state = 'loose';    // a shot or pass that touched something is a live loose ball (ctx keeps its origin)
      }
      this.stepRest(dt, events);
      if (!this.oobEmitted && this.isOutOfBounds()) {
        this.oobEmitted = true;
        this.emit(events, 'oob', 0, this.lastToucher);
      }
    }

    const p = this.pos, v = this.vel;
    if (!Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z)) {
      p.set(SAFE_RESET.x, SAFE_RESET.y, SAFE_RESET.z);
      this.prevPos.copy(p);
      v.set(0, 0, 0);
      this.state = 'loose';
      this.rimContacts = 0;
      this.rimEnabled = true;
      this.boardEnabled = true;
      this.emit(events, 'nan', 0, this.lastToucher);
    }
    return events;
  }

  stepHeld(dt, o, events) {
    this.holdT += dt;
    this.placeOnOwner();
    this.vel.set(0, 0, 0);
    this.releaseAge = 0;
    if (this.state === 'dribble' && o.dribbleBounced) this.bounce(events, 'bounce', DRIBBLE_BOUNCE_STRENGTH);
    if (!this.oobEmitted && this.isOutOfBounds()) {
      this.oobEmitted = true;
      this.emit(events, 'oob', 0, o);
    }
  }

  /** Floor contact event ('bounce' dribble / 'floor' free ball), rate-limited to one per 80 ms (v1). */
  bounce(events, type, strength) {
    if (this.lastBounceT >= 0 && this.time - this.lastBounceT < BOUNCE_SFX_S) return;
    this.lastBounceT = this.time;
    this.emit(events, type, strength, this.owner || this.lastToucher);
  }

  /** The ball went through the hoop: state 'scored' for 0.5 s (net drag, collisions off). value 1 swish / 2 rim-in. */
  score(events) {
    const swish = this.rimContacts === 0 && !this.shot.touched;
    this.state = 'scored';
    this.scoredT = 0;
    this.rimEnabled = false;
    this.boardEnabled = false;
    this.vel.multiplyScalar(BALL.NET_DRAG);
    this.emit(events, 'score', swish ? 1 : 2, this.lastToucher);
  }

  /** A free ball resting on the floor for 1.5 s emits 'rest' once (v1 §5.13). */
  stepRest(dt, events) {
    const v = this.vel;
    const slow = v.x * v.x + v.y * v.y + v.z * v.z < BALL.RESCUE_SPEED * BALL.RESCUE_SPEED;
    if (slow && this.pos.y <= R + 1e-3) {
      this.restT += dt;
      if (!this.restEmitted && this.restT >= REST_T) {
        this.restEmitted = true;
        this.emit(events, 'rest', this.restT, this.lastToucher);
      }
    } else {
      this.restT = 0;
    }
  }

  /** Horizontal distance of the ball centre to the rim centre. */
  rimDistance() {
    const dx = this.pos.x - RIM.x, dz = this.pos.z - RIM.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
