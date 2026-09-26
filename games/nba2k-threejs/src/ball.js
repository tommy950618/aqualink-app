// Ball entity (spec sections 5.1-5.8, 5.13, 14 row 14): the one ball, its mesh and blob shadow, the
// held/dribble/flight/pass/loose/scored state machine and the per-step physics driven by physics.js.
// step() fills a caller-supplied events array with reused event objects; nothing allocates per step.
import * as THREE from '../vendor/three.module.js';
import { RIM, BALL, COURT, SHOT } from './constants.js';
import { clamp, lerp } from './math.js';
import { makeBallTexture, makeBlobTexture } from './scene.js';
import { stepFreeBall } from './physics.js';

const R = BALL.R;
const SHADOW_SCALE = 0.35;
const SHADOW_Y = 0.012;
const SHADOW_OPACITY_LOW = 0.5, SHADOW_OPACITY_HIGH = 0.15, SHADOW_FADE_H = 4;
const BOUNCE_SFX_S = BALL.BOUNCE_SFX_MS / 1000;
const DRIBBLE_BOUNCE_STRENGTH = 0.5;
const OOB_X = COURT.HALF_W + COURT.OOB_MARGIN;
const OOB_Z_MIN = COURT.BASELINE_Z - COURT.OOB_MARGIN;
const EVENT_POOL = 12;
const SAFE_RESET = { x: 0, y: BALL.CHEST_Y, z: -4.6 };   // handler spot after a NaN reset (CHECK follows)

const STEP_OUT = { floor: 0, rim: 0, board: 0, scored: false };
const AXIS = new THREE.Vector3();

function copyInfo(target, info) {
  for (const k in info) target[k] = info[k];
  return target;
}

export class Ball {
  constructor(scene, rng) {
    this.scene = scene || null;
    this.rng = rng || null;
    this.state = 'loose';
    this.owner = null;
    this.lastToucher = null;
    this.shotInfo = { shooter: null, releaseTime: 0, points: 2, kind: 'jumper' };
    this.passInfo = { receiver: null, from: null };
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
    this.holdT = 0;
    this.time = 0;
    this.lastBounceT = -1;
    this.events = [];
    this.pool = new Array(EVENT_POOL);
    for (let i = 0; i < EVENT_POOL; i++) this.pool[i] = { type: '', value: 0, player: null };
    this.poolUsed = 0;

    const geo = new THREE.SphereGeometry(R, 12, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    try { mat.map = makeBallTexture(); } catch (err) { mat.color.set(0xe8641b); }
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'ball';
    const shadowGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
    let blob = null;
    try { blob = makeBlobTexture(); } catch (err) { blob = null; }
    this.shadowMat = new THREE.MeshBasicMaterial({
      map: blob, color: blob ? 0xffffff : 0x000000, transparent: true, depthWrite: false, opacity: SHADOW_OPACITY_LOW,
    });
    this.shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
    this.shadow.name = 'ballShadow';
    this.shadow.scale.set(SHADOW_SCALE, 1, SHADOW_SCALE);
    this.shadow.position.y = SHADOW_Y;
    this.shadow.renderOrder = -1;
    if (this.scene) { this.scene.add(this.mesh); this.scene.add(this.shadow); }
  }

  get isFree() { return this.state === 'flight' || this.state === 'pass' || this.state === 'loose'; }
  get isHeld() { return this.state === 'held' || this.state === 'dribble'; }

  // Give the ball to a player: mode 'held' (chest / hands) or 'dribble'.
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
    this.restEmitted = false;
    this.oobEmitted = false;
    this.placeOnOwner();
    this.prevPos.copy(this.pos);
  }

  // Release the ball with velocity v ({x,y,z} or a solver result {vx,vy,vz}) into 'flight' | 'pass' |
  // 'loose'. info fills shotInfo (flight) or passInfo (pass). `from` optionally sets the launch point
  // (the hand); otherwise the ball leaves from its current position.
  launch(v, state, info, from) {
    if (from) this.pos.set(from.x, from.y, from.z);
    this.prevPos.copy(this.pos);
    this.vel.set(v.vx !== undefined ? v.vx : v.x, v.vy !== undefined ? v.vy : v.y, v.vz !== undefined ? v.vz : v.z);
    if (this.owner) {
      this.owner.hasBall = false;
      this.owner.ballMode = null;
      this.lastToucher = this.owner;
      this.owner = null;
    }
    this.state = state === 'pass' || state === 'loose' ? state : 'flight';
    this.releaseAge = 0;
    this.rimContacts = 0;
    this.rimEnabled = true;
    this.boardEnabled = true;
    this.restT = 0;
    this.scoredT = 0;
    this.restEmitted = false;
    this.oobEmitted = false;
    this.lastBounceT = -1;
    if (this.state === 'flight') {
      const si = this.shotInfo;
      si.shooter = this.lastToucher; si.releaseTime = this.time; si.points = 2; si.kind = 'jumper';
      if (info) copyInfo(si, info);
      if (si.shooter) this.lastToucher = si.shooter;
    } else if (this.state === 'pass') {
      const pi = this.passInfo;
      pi.receiver = null; pi.from = this.lastToucher;
      if (info) copyInfo(pi, info);
      if (pi.from) this.lastToucher = pi.from;
    } else if (info && info.toucher) {
      this.lastToucher = info.toucher;
    }
  }

  // Section 5.8 catch test (the decision and stats live in game.js).
  canBeCaughtBy(player, world) {
    if (!player || player.hasBall || player.state === 'dunk') return false;
    const st = this.state;
    if (st === 'flight') { if (this.releaseAge <= BALL.CATCH_FLIGHT_AGE) return false; }
    else if (st !== 'pass' && st !== 'loose') return false;
    if (this.shotInfo.shooter === player && this.releaseAge < BALL.CATCH_FLIGHT_AGE) return false;
    const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z;
    const height = player.data && player.data.height > 0 ? player.data.height : 1;
    const r = st === 'pass' && this.passInfo.receiver === player ? BALL.CATCH_R_RECEIVER : BALL.CATCH_R * height;
    if (dx * dx + dz * dz >= r * r) return false;
    const jumpY = player.jumpY > 0 ? player.jumpY : 0;
    if (this.pos.y < BALL.CATCH_MIN_Y || this.pos.y > BALL.CATCH_MAX_Y + jumpY) return false;
    const v = this.vel;
    return v.x * v.x + v.y * v.y + v.z * v.z < BALL.CATCH_MAX_SPEED * BALL.CATCH_MAX_SPEED;
  }

  // True when a free ball's centre is out of bounds (section 1), or a held ball's holder stands out.
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

  // Kinematic placement on the owner: hands during a windup/layup/dunk, chest while held, the
  // section 5.7 bounce path while dribbling.
  placeOnOwner() {
    const o = this.owner;
    const st = o.state;
    if (st === 'dunk') {
      o.handPoint(this.pos);
      this.pos.y = SHOT.RELEASE_Y + o.jumpY;
    } else if (st === 'windup' || st === 'layup' || st === 'release') {
      o.handPoint(this.pos);
    } else if (this.state === 'dribble') {
      o.dribbleBallPos(this.pos);
    } else {
      o.chestPoint(this.pos);
    }
  }

  // One fixed step. events: the array to fill (cleared first); returns it.
  step(dt, world, events = this.events) {
    events.length = 0;
    this.poolUsed = 0;
    this.time += dt;
    this.prevPos.copy(this.pos);
    const rng = this.rng || (world && world.rng) || null;

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
      stepFreeBall(this, dt, rng, STEP_OUT);
      if (STEP_OUT.floor > 0) this.bounce(events, STEP_OUT.floor);
      if (this.scoredT >= BALL.SCORED_T) {
        this.state = 'loose';
        this.rimEnabled = true;
        this.boardEnabled = true;
        this.releaseAge = 0;
      }
    } else {
      this.releaseAge += dt;
      stepFreeBall(this, dt, rng, STEP_OUT);
      if (STEP_OUT.rim > 0) this.emit(events, 'rim', STEP_OUT.rim, this.lastToucher);
      if (STEP_OUT.board > 0) this.emit(events, 'board', STEP_OUT.board, this.lastToucher);
      if (STEP_OUT.floor > 0) this.bounce(events, STEP_OUT.floor);
      if (STEP_OUT.scored && this.state !== 'pass') {
        this.score(events);
      } else if ((STEP_OUT.rim > 0 || STEP_OUT.board > 0 || STEP_OUT.floor > 0 || this.pos.y <= R + 1e-6)
        && (this.state === 'flight' || this.state === 'pass')) {
        this.state = 'loose';    // a shot or pass that touched something is a live loose ball
      }
      this.stepRest(dt, events);
      if (!this.oobEmitted && this.isOutOfBounds()) {
        this.oobEmitted = true;
        this.emit(events, 'oob', 0, this.lastToucher);
      }
    }

    this.spin(dt);

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
    const st = o.state;
    const inHands = st === 'windup' || st === 'layup' || st === 'dunk' || st === 'release';
    if (this.state === 'dribble') {
      if (inHands || st === 'stunned' || st === 'celebrate') { this.state = 'held'; o.ballMode = 'held'; }
    } else if (!inHands && this.holdT >= BALL.HOLD_AFTER_CATCH && (st === 'idle' || st === 'move' || st === 'cross' || st === 'steal')) {
      this.state = 'dribble';
      o.ballMode = 'dribble';
    }
    this.placeOnOwner();
    this.vel.set(0, 0, 0);
    this.releaseAge = 0;
    if (this.state === 'dribble' && o.dribbleWrapped) this.bounce(events, DRIBBLE_BOUNCE_STRENGTH);
    if (!this.oobEmitted && this.isOutOfBounds()) {
      this.oobEmitted = true;
      this.emit(events, 'oob', 0, o);
    }
  }

  // Floor bounce event, rate-limited to one per 80 ms.
  bounce(events, strength) {
    if (this.lastBounceT >= 0 && this.time - this.lastBounceT < BOUNCE_SFX_S) return;
    this.lastBounceT = this.time;
    this.emit(events, 'bounce', strength, this.owner || this.lastToucher);
  }

  // Section 5.5: a make. Points come from shotInfo while the shot is unresolved (flight, or loose
  // with nobody else having touched it); a tipped-in loose ball scores 2 for lastToucher.
  score(events) {
    const shooter = this.shotInfo.shooter;
    const ownShot = shooter && (this.state === 'flight' || this.lastToucher === shooter);
    const points = ownShot ? this.shotInfo.points : 2;
    const player = ownShot ? shooter : this.lastToucher;
    this.state = 'scored';
    this.scoredT = 0;
    this.rimEnabled = false;
    this.boardEnabled = false;
    this.vel.multiplyScalar(BALL.NET_DRAG);
    this.emit(events, 'score', points, player);
  }

  // Section 5.13: a free ball resting for 1.5 s emits 'rest' once.
  stepRest(dt, events) {
    const v = this.vel;
    const slow = v.x * v.x + v.y * v.y + v.z * v.z < BALL.RESCUE_SPEED * BALL.RESCUE_SPEED;
    if (slow && this.pos.y <= R + 1e-3) {
      this.restT += dt;
      if (!this.restEmitted && this.restT >= 1.5) {
        this.restEmitted = true;
        this.emit(events, 'rest', this.restT, this.lastToucher);
      }
    } else {
      this.restT = 0;
    }
  }

  // Roll the mesh about the axis perpendicular to the velocity (angle = distance / R).
  spin(dt) {
    const v = this.vel;
    const s2 = v.x * v.x + v.z * v.z;
    if (s2 < 1e-6) return;
    const speed = Math.sqrt(s2 + v.y * v.y);
    AXIS.set(-v.z, 0, v.x).normalize();
    this.mesh.rotateOnWorldAxis(AXIS, speed * dt / R);
  }

  // Interpolated mesh placement; the ball in a shooter's hands follows the posed humanoid hand so it
  // never floats. The shadow sits on the floor and fades with height.
  render(alpha) {
    const a = clamp(alpha, 0, 1);
    const m = this.mesh.position;
    const o = this.owner;
    let visualHand = false;
    if (this.isHeld && o && o.humanoid) {
      const st = o.state;
      if (st === 'dunk') { o.humanoid.handsMidWorld(m); visualHand = true; }
      else if (st === 'windup' || st === 'layup' || st === 'release') { o.humanoid.handWorld(m, o.handSign); visualHand = true; }
    }
    if (!visualHand) {
      m.x = lerp(this.prevPos.x, this.pos.x, a);
      m.y = lerp(this.prevPos.y, this.pos.y, a);
      m.z = lerp(this.prevPos.z, this.pos.z, a);
    }
    this.shadow.position.x = m.x;
    this.shadow.position.z = m.z;
    const h = clamp((m.y - R) / SHADOW_FADE_H, 0, 1);
    this.shadowMat.opacity = lerp(SHADOW_OPACITY_LOW, SHADOW_OPACITY_HIGH, h);
    const sc = SHADOW_SCALE * (1 - 0.3 * h);
    this.shadow.scale.set(sc, 1, sc);
  }
}
