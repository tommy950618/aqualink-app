// Player entity (spec sections 5.10-5.12, 6.1, 14 row 13): kinematic 2D circle driven by an Intent,
// jump arcs, crossover bursts, stuns, the dribble phase and the per-frame pose selection.
// Shots, passes, steals and blocks are DECIDED by game.js; this file only exposes the helpers that
// put a player into the matching state. Every per-step path is allocation free.
import * as THREE from '../vendor/three.module.js';
import { RIM, MOVE, JUMP, SHOT, BALL, FIXED_DT } from './constants.js';
import { clamp, lerp, lerpAngle, wrapAngle, norm2 } from './math.js';
import { makeIntent, clearEdges } from './input.js';

export { makeIntent, clearEdges };

const HISTORY = 30;                     // 0.5 s of positions at 60 Hz (AI reaction delay)
const STEAL_REACH_T = 0.3;              // steal reach animation (section 6.1)
const DRIBBLE_HZ_RUN = 2.2, DRIBBLE_HZ_SPRINT = 2.8, DRIBBLE_HZ_STILL = 1.8;
const DRIBBLE_AMP_MOVE = 0.80, DRIBBLE_AMP_STILL = 0.65;
const DRIBBLE_MOVING_MAG = 0.1;
const DRIBBLE_SIDE = 0.32, DRIBBLE_FWD = 0.20;
const AIR_STATES = { windup: 1, release: 1, layup: 1, jump: 1 };
const RELEASE_FOLLOW_T = 0.25;          // follow-through after a release that happened on the ground
const HAND_Y_LOW = 1.5;                 // analytic shooting-hand height at meter f = 0 ...
const HAND_Y_SPAN = SHOT.RELEASE_Y - HAND_Y_LOW; // ... rising to 2.05 at f = 1 (section 4.5)
const MOVE_MIN_SPEED = 0.3;             // state 'move' above this horizontal speed
const DEFEND_MAX_SPEED = 2.0;           // defensive stance pose only while slower than this

const TMP = { x: 0, z: 0 };
const POSE = { t: 0, phi: 0, speed: 0, f: 0, ballY: 0, handSign: 1, jumpY: 0, lean: 0, releaseAge: 0, dt: 0 };

function yawToward(fromX, fromZ, toX, toZ, fallback) {
  const dx = toX - fromX, dz = toZ - fromZ;
  return dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : fallback;
}

export class Player {
  constructor({ team, teamIdx, index, data, humanoid, marker }) {
    this.teamData = team;            // TEAMS row
    this.team = teamIdx | 0;         // team index (shot.js compares o.team === shooter.team)
    this.teamIdx = teamIdx | 0;
    this.index = index | 0;          // roster index 0..2
    this.data = data;                // { name, num, speed, shooting, defense, dunk, height }
    this.name = data ? data.name : null;
    this.humanoid = humanoid || null;
    this.marker = marker || null;
    this.intent = makeIntent();
    this.isUser = false;             // the human's player: never clamped to the court
    this.clampToCourt = true;        // AI clamp (section 5.10) when !isUser
    this.offense = false;            // updated from world.offense each step

    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();  // y is always 0; height lives in jumpY
    this.yaw = 0;
    this.prevYaw = 0;
    this.state = 'idle';
    this.stamina = 1;
    this.sprintLocked = false;
    this.sprinting = false;
    this.sprintRecentT = 0;
    this.sprintedRecently = false;
    this.hasBall = false;
    this.ballMode = null;            // 'held' | 'dribble' | null (written by Ball.attachTo)
    this.isJumping = false;
    this.jumpY = 0;
    this.prevJumpY = 0;
    this.jumpT = 0;
    this.jumpH = 0;
    this.handSign = 1;
    this.stats = { pts: 0, fgm: 0, fga: 0, tpm: 0, reb: 0, stl: 0, blk: 0 };

    this.stunT = 0;
    this.crossT = 0;
    this.crossCd = 0;
    this.crossDir = { x: 0, z: 0 };
    this.crossJustStarted = false;
    this.stealT = 0;
    this.stealCd = 0;
    this.celebrateT = 0;
    this.celebrateOnLand = false;
    this.windupT = 0;
    this.meterF = 0;
    this.shotKind = 'jumper';
    this.releaseAge = 0;
    this.released = false;
    this.dunkT = 0;
    this.dunkFrom = { x: 0, z: 0 };
    this.dunkTo = { x: 0, z: 0 };
    this.dribblePhi = 0;
    this.dribbleAmp = DRIBBLE_AMP_STILL;
    this.dribbleY = BALL.R;
    this.dribbleWrapped = false;
    this.cutting = false;
    this.slot = -1;
    this.defAssign = null;
    this.time = 0;

    this.positionHistory = new Array(HISTORY);
    for (let i = 0; i < HISTORY; i++) this.positionHistory[i] = { x: 0, z: 0 };
    this.histHead = 0;
  }

  // Place the player (CHECK formation / teleport) and clear every transient state. Stats and stamina
  // are kept; see resetStats().
  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.prevPos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = this.prevYaw = wrapAngle(yaw || 0);
    this.state = 'idle';
    this.isJumping = false;
    this.jumpY = this.prevJumpY = this.jumpT = this.jumpH = 0;
    this.stunT = this.crossT = this.stealT = this.celebrateT = this.windupT = 0;
    this.crossCd = this.stealCd = 0;
    this.crossJustStarted = false;
    this.celebrateOnLand = false;
    this.meterF = 0;
    this.releaseAge = 0;
    this.released = false;
    this.dunkT = 0;
    this.dribblePhi = 0;
    this.dribbleY = BALL.R;
    this.dribbleWrapped = false;
    this.cutting = false;
    this.sprinting = false;
    this.sprintRecentT = 0;
    this.sprintedRecently = false;
    this.hasBall = false;
    this.ballMode = null;
    for (let i = 0; i < HISTORY; i++) { this.positionHistory[i].x = x; this.positionHistory[i].z = z; }
    this.histHead = 0;
    clearEdges(this.intent);
    this.intent.move.x = this.intent.move.z = this.intent.move.mag = 0;
    if (this.humanoid) {
      this.humanoid.group.position.set(x, 0, z);
      this.humanoid.group.rotation.y = this.yaw;
      POSE.dt = 0; POSE.t = this.time; POSE.speed = 0; POSE.jumpY = 0; POSE.f = 0; POSE.ballY = 0;
      POSE.handSign = this.handSign; POSE.releaseAge = 0; POSE.lean = 0; POSE.phi = 0;
      this.humanoid.setPose('idle', POSE);
    }
  }

  resetStats() {
    const s = this.stats;
    s.pts = s.fgm = s.fga = s.tpm = s.reb = s.stl = s.blk = 0;
    this.stamina = 1;
    this.sprintLocked = false;
  }

  get speed() { const v = this.vel; return Math.sqrt(v.x * v.x + v.z * v.z); }

  // Free to start an action (shot, pass, steal, crossover): on the ground in a neutral state.
  get canAct() { return !this.isJumping && (this.state === 'idle' || this.state === 'move' || this.state === 'steal'); }

  // Facing direction (three.js convention: forward = (sin yaw, cos yaw)).
  forward(out) { out.x = Math.sin(this.yaw); out.z = Math.cos(this.yaw); return out; }

  // Position `seconds` ago (clamped to the 0.5 s ring buffer), for the AI reaction delay.
  getDelayed(out, seconds) {
    const back = clamp(Math.round(seconds / FIXED_DT), 0, HISTORY - 1);
    const e = this.positionHistory[(this.histHead - back + HISTORY) % HISTORY];
    out.x = e.x; out.z = e.z;
    return out;
  }

  // Section 5.7: where the dribbled ball is right now (hand offset + bounce height). out is a Vector3.
  dribbleBallPos(out) {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const side = DRIBBLE_SIDE * this.handSign;
    out.x = this.pos.x + cy * side + sy * DRIBBLE_FWD;
    out.z = this.pos.z - sy * side + cy * DRIBBLE_FWD;
    out.y = this.dribbleY;
    return out;
  }

  // Analytic shooting-hand point (section 4.5): feet + fwd*0.25 + (0, 1.5..2.05 + jumpY, 0), rising with
  // the meter. Sim-consistent (no render lag); the visual hand is humanoid.handWorld.
  handPoint(out) {
    const f = clamp(this.meterF, 0, 1);
    out.x = this.pos.x + Math.sin(this.yaw) * SHOT.RELEASE_FWD;
    out.z = this.pos.z + Math.cos(this.yaw) * SHOT.RELEASE_FWD;
    out.y = HAND_Y_LOW + HAND_Y_SPAN * f + this.jumpY;
    return out;
  }

  // Chest point (held ball, pass target): feet + fwd*0.2 + (0, 1.3, 0).
  chestPoint(out) {
    out.x = this.pos.x + Math.sin(this.yaw) * DRIBBLE_FWD;
    out.z = this.pos.z + Math.cos(this.yaw) * DRIBBLE_FWD;
    out.y = BALL.CHEST_Y + this.jumpY;
    return out;
  }

  // Section 4.7 block hand: feet + facing*0.35 + (0, 2.55 + jumpY, 0).
  blockHand(out) {
    out.x = this.pos.x + Math.sin(this.yaw) * SHOT.BLOCK_HAND_FWD;
    out.z = this.pos.z + Math.cos(this.yaw) * SHOT.BLOCK_HAND_FWD;
    out.y = SHOT.BLOCK_HAND_Y + this.jumpY;
    return out;
  }

  // ---------------------------------------------------------------- action helpers (called by game.js)

  startJump(h) {
    if (this.isJumping || this.state === 'dunk') return false;
    this.isJumping = true;
    this.jumpT = 0;
    this.jumpH = h > 0 ? h : JUMP.H_BLOCK;
    this.jumpY = 0;
    if (this.state === 'idle' || this.state === 'move' || this.state === 'steal') this.state = 'jump';
    this.stealT = 0;
    return true;
  }

  // Press: the shot jump and the meter start together (section 4.2).
  startWindup(kind) {
    if (this.isJumping || this.state === 'dunk') return false;
    this.shotKind = kind || 'jumper';
    this.windupT = 0;
    this.meterF = 0;
    this.released = false;
    this.releaseAge = 0;
    this.startJump(JUMP.H_SHOT);
    this.state = kind === 'layup' ? 'layup' : 'windup';
    return true;
  }

  startLayup() { return this.startWindup('layup'); }

  // The ball left the hand: follow-through pose, releaseAge starts. The ball itself is launched by game.js.
  release() {
    this.released = true;
    this.releaseAge = 0;
    this.meterF = clamp(this.meterF, 0, SHOT.F_MAX);
    if (this.state === 'windup') this.state = 'release';
  }

  // Section 4.6: scripted dunk toward RIM - fwd*0.55; fwd (unit xz) defaults to feet -> rim.
  startDunk(fwd) {
    if (this.state === 'dunk') return false;
    let fx, fz;
    if (fwd) { fx = fwd.x; fz = fwd.z; } else { norm2(TMP, RIM.x - this.pos.x, RIM.z - this.pos.z); fx = TMP.x; fz = TMP.z; }
    if (fx * fx + fz * fz < 1e-8) { fx = 0; fz = -1; }
    this.shotKind = 'dunk';
    this.state = 'dunk';
    this.dunkT = 0;
    this.dunkFrom.x = this.pos.x; this.dunkFrom.z = this.pos.z;
    this.dunkTo.x = RIM.x - fx * SHOT.DUNK_STOP; this.dunkTo.z = RIM.z - fz * SHOT.DUNK_STOP;
    this.isJumping = true;
    this.jumpT = 0;
    this.jumpH = SHOT.DUNK_H;
    this.jumpY = 0;
    this.released = false;
    this.releaseAge = 0;
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(fx, fz);
    return true;
  }

  // Steal reach (the roll is game.js's); starts the 0.7 s cooldown.
  startSteal() {
    if (!this.canAct || this.stealCd > 0) return false;
    this.state = 'steal';
    this.stealT = STEAL_REACH_T;
    this.stealCd = MOVE.STEAL_COOLDOWN;
    return true;
  }

  // Section 5.11/5.12 stun: frozen in place for `sec` (longest pending stun wins).
  stun(sec) {
    if (this.isJumping || this.state === 'dunk') return false;
    this.state = 'stunned';
    this.stunT = Math.max(this.stunT, sec > 0 ? sec : MOVE.STUN_STEAL_FAIL);
    this.crossT = 0;
    this.stealT = 0;
    this.vel.set(0, 0, 0);
    return true;
  }

  // Arms-up celebration for 0.8 s (deferred to the landing when airborne).
  celebrate() {
    if (this.isJumping || this.state === 'dunk') { this.celebrateOnLand = true; return false; }
    this.state = 'celebrate';
    this.celebrateT = MOVE.CELEBRATE_T;
    this.vel.set(0, 0, 0);
    return true;
  }

  // Section 5.12: lateral burst away from the on-ball defender (joystick side when nobody is within
  // 1.5 m), handSign flips. Returns true when started; game.js rolls the defender freeze on
  // crossJustStarted. `side` may be passed explicitly (+1 / -1 along the player's right vector).
  startCross(world, side) {
    if (!this.canAct || !this.hasBall || this.crossCd > 0) return false;
    // Right vector of the facing (fwd = (sin, cos) -> right = (cos, -sin)).
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let s = side || 0;
    if (!s && world && world.players) {
      let best = null, bestD = MOVE.CROSS_DEF_R;
      const ps = world.players;
      for (let i = 0; i < ps.length; i++) {
        const o = ps[i];
        if (o === this || o.team === this.team) continue;
        const ox = o.pos.x - this.pos.x, oz = o.pos.z - this.pos.z;
        const d = Math.sqrt(ox * ox + oz * oz);
        if (d < bestD) { bestD = d; best = o; }
      }
      if (best) {
        const dot = (best.pos.x - this.pos.x) * rx + (best.pos.z - this.pos.z) * rz;
        s = dot > 0 ? -1 : 1;
      }
    }
    if (!s) {
      const m = this.intent.move;
      const dot = m.x * rx + m.z * rz;
      s = dot < 0 ? -1 : 1;
    }
    this.crossDir.x = rx * s; this.crossDir.z = rz * s;
    this.vel.x = this.crossDir.x * MOVE.CROSS_SPEED;
    this.vel.z = this.crossDir.z * MOVE.CROSS_SPEED;
    this.state = 'cross';
    this.crossT = MOVE.CROSS_T;
    this.crossCd = MOVE.CROSS_COOLDOWN;
    this.crossJustStarted = true;
    this.handSign = -this.handSign;
    this.stealT = 0;
    return true;
  }

  // ---------------------------------------------------------------- simulation

  step(dt, world) {
    this.time += dt;
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
    this.prevJumpY = this.jumpY;
    this.histHead = (this.histHead + 1) % HISTORY;
    const he = this.positionHistory[this.histHead];
    he.x = this.pos.x; he.z = this.pos.z;
    this.crossJustStarted = false;
    this.dribbleWrapped = false;
    if (world && typeof world.offense === 'number') this.offense = world.offense === this.team;

    if (this.crossCd > 0) this.crossCd -= dt;
    if (this.stealCd > 0) this.stealCd -= dt;
    if (this.released) this.releaseAge += dt;
    if (this.state === 'windup' || this.state === 'layup') {
      this.windupT += dt;
      const meterT = this.shotKind === 'layup' ? SHOT.METER_T_LAYUP : SHOT.METER_T;
      if (!this.released) this.meterF = clamp(this.windupT / meterT, 0, SHOT.F_MAX);
    }

    const intent = this.intent;
    const st = this.state;
    let controllable = false;

    if (st === 'dunk') {
      this.stepDunk(dt);
    } else if (st === 'stunned') {
      this.stunT -= dt;
      this.vel.set(0, 0, 0);
      if (this.stunT <= 0) { this.stunT = 0; this.state = 'idle'; }
    } else if (st === 'celebrate') {
      this.celebrateT -= dt;
      this.vel.set(0, 0, 0);
      if (this.celebrateT <= 0) { this.celebrateT = 0; this.state = 'idle'; }
    } else if (st === 'cross') {
      this.crossT -= dt;
      this.vel.x = this.crossDir.x * MOVE.CROSS_SPEED;
      this.vel.z = this.crossDir.z * MOVE.CROSS_SPEED;
      if (this.crossT <= 0) {
        // Burst over: carry on at no more than the handler's normal top speed.
        this.crossT = 0;
        this.state = 'move';
        const rating = this.data && this.data.speed > 0 ? this.data.speed : 1;
        const cap = MOVE.RUN * MOVE.HANDLER_MUL * rating;
        const s = this.speed;
        if (s > cap) { this.vel.x *= cap / s; this.vel.z *= cap / s; }
      }
    } else if (this.isJumping) {
      // No air control: momentum carries (section 5.10).
    } else if ((st === 'windup' || st === 'layup') && !this.released) {
      // Landed before the release (meter past f = 1.0): planted until the release / auto-release at f = 1.25.
      this.vel.set(0, 0, 0);
    } else if ((st === 'release' || st === 'layup') && this.released) {
      // Follow-through on the ground after a landed release.
      this.vel.set(0, 0, 0);
      if (this.releaseAge >= RELEASE_FOLLOW_T) this.state = 'idle';
    } else {
      controllable = true;
      if (st === 'steal') {
        this.stealT -= dt;
        if (this.stealT <= 0) { this.stealT = 0; this.state = 'idle'; }
      }
      this.stepMovement(dt, intent);
      if (this.hasBall && this.canAct && intent.tertiary.justPressed) this.startCross(world);
      if (!this.hasBall && this.canAct && intent.primary.justPressed) this.startJump(JUMP.H_BLOCK);
    }

    this.stepStamina(dt, controllable && this.sprinting);

    // Integrate the horizontal motion (the dunk tween writes pos itself).
    if (st !== 'dunk') {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
    }
    this.stepJump(dt);
    this.stepYaw(dt);
    if (this.hasBall) this.stepDribble(dt, intent);
    if (this.clampToCourt && !this.isUser) this.applyClamp();

    if (this.state === 'idle' || this.state === 'move') {
      this.state = this.speed > MOVE_MIN_SPEED ? 'move' : 'idle';
    }
  }

  stepMovement(dt, intent) {
    const m = intent.move;
    const mag = clamp(m.mag > 0 ? m.mag : Math.sqrt(m.x * m.x + m.z * m.z), 0, 1);
    const rating = this.data && this.data.speed > 0 ? this.data.speed : 1;
    const wantSprint = !!intent.sprint && mag > 0 && !this.sprintLocked && this.stamina > 0;
    this.sprinting = wantSprint;
    let maxSpeed = MOVE.RUN * mag * rating;
    if (wantSprint) maxSpeed *= MOVE.SPRINT_MUL;
    if (this.hasBall) maxSpeed *= MOVE.HANDLER_MUL;
    norm2(TMP, m.x, m.z);
    const dx = TMP.x * maxSpeed, dz = TMP.z * maxSpeed;
    const v = this.vel;
    let ax = dx - v.x, az = dz - v.z;
    const aLen = Math.sqrt(ax * ax + az * az);
    const maxDv = (maxSpeed > 0 ? MOVE.ACCEL : MOVE.DECEL) * dt;
    if (aLen > maxDv) { ax *= maxDv / aLen; az *= maxDv / aLen; }
    v.x += ax; v.z += az;
    if (maxSpeed === 0 && v.x * v.x + v.z * v.z < 1e-4) { v.x = 0; v.z = 0; }
  }

  stepStamina(dt, sprinting) {
    if (sprinting) {
      this.stamina -= dt * MOVE.STAMINA_DRAIN;
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

  // jumpY = h sin(pi t / 0.55); landing resolves the airborne states.
  stepJump(dt) {
    if (!this.isJumping) { this.jumpY = 0; return; }
    this.jumpT += dt;
    if (this.state === 'dunk') return;      // the dunk tween owns jumpY
    if (this.jumpT >= JUMP.T) {
      this.isJumping = false;
      this.jumpY = 0;
      this.jumpT = 0;
      this.land();
      return;
    }
    this.jumpY = this.jumpH * Math.sin(Math.PI * this.jumpT / JUMP.T);
  }

  land() {
    if (this.celebrateOnLand) {
      this.celebrateOnLand = false;
      this.celebrate();
      return;
    }
    const st = this.state;
    if (st === 'release' || st === 'jump' || ((st === 'windup' || st === 'layup') && this.released)) this.state = 'idle';
    else if (st === 'windup' || st === 'layup') this.vel.set(0, 0, 0);   // still holding the meter: plant the feet, keep the windup
  }

  stepDunk(dt) {
    this.dunkT += dt;
    const k = clamp(this.dunkT / SHOT.DUNK_T, 0, 1);
    this.pos.x = lerp(this.dunkFrom.x, this.dunkTo.x, k);
    this.pos.z = lerp(this.dunkFrom.z, this.dunkTo.z, k);
    this.vel.x = (this.dunkTo.x - this.dunkFrom.x) / SHOT.DUNK_T;
    this.vel.z = (this.dunkTo.z - this.dunkFrom.z) / SHOT.DUNK_T;
    this.jumpY = SHOT.DUNK_H * Math.sin(Math.PI * k);
    if (this.dunkT >= SHOT.DUNK_T) {
      this.isJumping = false;
      this.jumpY = 0;
      this.jumpT = 0;
      this.vel.set(0, 0, 0);
      this.state = 'idle';
      this.land();
    }
  }

  // Yaw turns toward the velocity (or the hoop when stationary on offence / shooting) at 12 rad/s.
  stepYaw(dt) {
    const st = this.state;
    let target;
    const s2 = this.vel.x * this.vel.x + this.vel.z * this.vel.z;
    if (st === 'windup' || st === 'release' || st === 'layup' || st === 'dunk') {
      target = yawToward(this.pos.x, this.pos.z, RIM.x, RIM.z, this.yaw);
    } else if (s2 > MOVE_MIN_SPEED * MOVE_MIN_SPEED) {
      target = Math.atan2(this.vel.x, this.vel.z);
    } else if (this.offense) {
      target = yawToward(this.pos.x, this.pos.z, RIM.x, RIM.z, this.yaw);
    } else {
      return;
    }
    const d = wrapAngle(target - this.yaw);
    const maxTurn = MOVE.TURN * dt;
    this.yaw = wrapAngle(this.yaw + clamp(d, -maxTurn, maxTurn));
  }

  // Section 5.7 dribble phase: phi in cycles, y = R + A |sin(pi phi)|; the wrap marks a floor bounce.
  stepDribble(dt, intent) {
    if (this.ballMode !== 'dribble') { this.dribbleY = BALL.CHEST_Y; return; }
    const moving = intent.move.mag > DRIBBLE_MOVING_MAG || this.state === 'cross';
    const hz = moving ? (this.sprinting ? DRIBBLE_HZ_SPRINT : DRIBBLE_HZ_RUN) : DRIBBLE_HZ_STILL;
    this.dribbleAmp = moving ? DRIBBLE_AMP_MOVE : DRIBBLE_AMP_STILL;
    this.dribblePhi += hz * dt;
    if (this.dribblePhi >= 1) { this.dribblePhi -= 1; this.dribbleWrapped = true; }
    this.dribbleY = BALL.R + this.dribbleAmp * Math.abs(Math.sin(Math.PI * this.dribblePhi));
  }

  applyClamp() {
    const p = this.pos;
    if (p.x > MOVE.AI_CLAMP_X) p.x = MOVE.AI_CLAMP_X; else if (p.x < -MOVE.AI_CLAMP_X) p.x = -MOVE.AI_CLAMP_X;
    if (p.z > MOVE.AI_CLAMP_Z_MAX) p.z = MOVE.AI_CLAMP_Z_MAX; else if (p.z < MOVE.AI_CLAMP_Z_MIN) p.z = MOVE.AI_CLAMP_Z_MIN;
  }

  // Section 5.10 separation: pairs closer than 0.80 m are pushed apart by half the overlap each.
  // Dunkers are never displaced (scripted tween); clamped players are re-clamped afterwards.
  static resolveSeparation(players) {
    const n = players.length;
    for (let i = 0; i < n; i++) {
      const a = players[i];
      for (let j = i + 1; j < n; j++) {
        const b = players[j];
        let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        let d = Math.sqrt(dx * dx + dz * dz);
        if (d >= MOVE.SEPARATION) continue;
        if (d < 1e-4) { dx = 1; dz = 0; d = 1e-4; }
        const push = (MOVE.SEPARATION - d) * 0.5;
        const ux = dx / d, uz = dz / d;
        const aFixed = a.state === 'dunk', bFixed = b.state === 'dunk';
        if (aFixed && bFixed) continue;
        const pa = aFixed ? 0 : (bFixed ? 2 * push : push);
        const pb = bFixed ? 0 : (aFixed ? 2 * push : push);
        a.pos.x -= ux * pa; a.pos.z -= uz * pa;
        b.pos.x += ux * pb; b.pos.z += uz * pb;
      }
    }
    for (let i = 0; i < n; i++) {
      const p = players[i];
      if (p.clampToCourt && !p.isUser) p.applyClamp();
    }
  }

  // ---------------------------------------------------------------- rendering

  // Interpolates prev -> current state and evaluates the pose once per rendered frame (section 6.1).
  render(alpha, t, dt) {
    const h = this.humanoid;
    if (!h) return;
    const a = clamp(alpha, 0, 1);
    const x = lerp(this.prevPos.x, this.pos.x, a);
    const z = lerp(this.prevPos.z, this.pos.z, a);
    const yaw = lerpAngle(this.prevYaw, this.yaw, a);
    const jumpY = lerp(this.prevJumpY, this.jumpY, a);
    h.group.position.set(x, 0, z);
    h.group.rotation.y = yaw;

    const speed = this.speed;
    const st = this.state;
    let pose;
    if (st === 'idle' || st === 'move') {
      if (this.hasBall && this.ballMode === 'dribble') pose = 'dribble';
      else if (!this.offense && speed < DEFEND_MAX_SPEED) pose = 'defend';
      else pose = speed > MOVE_MIN_SPEED ? 'run' : 'idle';
    } else if (st === 'windup') {
      pose = 'windup';
    } else {
      pose = st;   // release, layup, dunk, jump, steal, stunned, cross, celebrate map 1:1
    }
    POSE.t = t;
    POSE.speed = speed;
    POSE.f = this.meterF;
    POSE.ballY = this.dribbleY;
    POSE.handSign = this.handSign;
    POSE.jumpY = jumpY;
    POSE.lean = 0;
    POSE.releaseAge = this.releaseAge;
    POSE.dt = dt > 0 ? dt : 0;
    POSE.phi = NaN;   // let the humanoid advance its own stride phase
    h.setPose(pose, POSE);

    if (this.marker && this.marker.group.visible) this.marker.update(x, z, h.headY(), t);
  }
}
