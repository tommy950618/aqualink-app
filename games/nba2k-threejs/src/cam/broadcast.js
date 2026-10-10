/**
 * @module cam/broadcast
 * The v2 broadcast camera (SPEC-v2 §6.4.2, PR §4.2, conflict C7): fixed yaw (camera x = look x, so the view never yaws
 * or rolls), elevated behind the offence, aimed from the ball. Measured framings for three camera options
 * (standard / close / high) × two orientations, exponential damping in frame time (position/look rate 5,
 * fov rate 3, v1), and the v2 modifiers:
 *
 *   bx     = clamp(ball.x, ±7.62)          bz = clamp(ball.z, −14.3, 0)
 *   near   = max(0, bz − nearZ)                                   (landscape rows only; metres past the threshold)
 *   camPos = (kx·bx, y, z0 + z0Add + kz·(bz + 9) + nearZ0·near)
 *   lookAt = (kx·bx, lookY + shotLift, lookZ + nearLook·near)    (blended 30 %·push/4 toward the rim on a dunk)
 *   fov    = baseFov(aspect) − (hypot(bx − RIM.x, bz − RIM.z) < 4.5 ? paintZoom : 0) − dunkPush + breakWiden
 *   portrait: camera.setViewOffset(W, H, 0, lens·H/2, W, H)       (content moves up by `lens` NDC)
 *
 * Modifiers: shot lift 0.5 m (rate 3) while a shot flies with ball.y > 4.0; dunk push 4° (rate 4) from the dunker's
 * TAKEOFF to SLAM + 0.5 s (`setDunkPush`, routed by flow through `director.dunkPush`); break widen 2° (rate 3) while the
 * ball moves toward the rim faster than 6 m/s with bz > −8; backcourt rule (R#41): z0 eases +0.6 m (rate 3) while the
 * handler is within 1.0 m of z = 0 and moving toward it.
 *
 * Exports: FRAMING (frozen table), CAMERA_MODES, BROADCAST (modifier constants), baseFov(aspect, f), framingRow(mode,
 * aspect), framingPose(row, aspect, bx, bz, out) (the bare formula, pure), class BroadcastCamera
 * {target(world, out) (pure), update(dt, world, out), snap(world, out), setAspect(a), setCameraMode(m), setDunkPush(on)}.
 *
 * Pose objects (`out`) are plain {px, py, pz, lx, ly, lz, fov, lens}; nothing here allocates after construction (H10).
 */
import { RIM, COURT } from '../constants.js';

const DEG = Math.PI / 180;
const ASPECT_16_9 = 16 / 9;

/** Frozen framing row. `nearZ` null = no near-half-line rule (portrait rows). Angles in degrees. */
function row(fov, kx, y, z0, kz, lookY, lookZ, near, paintZoom, lens) {
  return Object.freeze({
    fov, kx, y, z0, kz, lookY, lookZ,
    nearZ: near ? near[0] : null, nearZ0: near ? near[1] : 0, nearLook: near ? near[2] : 0,
    paintZoom, lens,
  });
}

/**
 * FRAMING (§6.4.2 table, binding). Landscape results [M]: standard 36/36 feet+heads of the six scenarios at 844×390,
 * handler 56–93 px, rim+ball worst |NDC| 0.68, handler at z −1 → feet −0.67 / half line −0.83; portrait standard
 * 34/36 at 390×844 (36/36 at 360×640), rim at NDC y 0.48 with the 0.25 lens shift, half line −0.09.
 */
export const FRAMING = Object.freeze({
  standard: Object.freeze({
    landscape: row(42, 0.35, 6.5, 4.5, 0.30, 1.0, -8.0, [-4.0, 0.5, 0.6], 3, 0),
    portrait: row(72, 0.35, 9.0, 12.0, 0, 1.0, -7.0, null, 4, 0.25),
  }),
  close: Object.freeze({
    landscape: row(38, 0.45, 5.2, 3.5, 0.40, 1.1, -8.5, [-4.0, 0.7, 0.9], 3, 0),
    portrait: row(66, 0.40, 7.5, 10.5, 0.10, 1.0, -7.0, null, 4, 0.25),
  }),
  high: Object.freeze({
    landscape: row(46, 0.30, 11.0, 6.0, 0.20, 1.0, -8.5, [-4.0, 0.4, 0.5], 3, 0),
    portrait: row(74, 0.40, 13.0, 10.0, 0, 0.0, -6.0, null, 4, 0.15),
  }),
});

/** Settings values of the Camera row (§6.5.10). */
export const CAMERA_MODES = Object.freeze(['standard', 'close', 'high']);

/** Modifier constants (§6.4.2). Distances in m, angles in degrees, rates in 1/s. */
export const BROADCAST = Object.freeze({
  BALL_X: COURT.HALF_W,          // |bx| ≤ 7.62
  BALL_Z_MIN: -14.3, BALL_Z_MAX: 0,
  PAINT_R: 4.5,                  // paint zoom when the ball is within 4.5 m of the rim (xz)
  RATE_POS: 5, RATE_FOV: 3,      // v1 damping
  SHOT_LIFT: 0.5, SHOT_LIFT_Y: 4.0, RATE_LIFT: 3,
  DUNK_PUSH: 4, RATE_PUSH: 4, DUNK_LOOK_BLEND: 0.30,
  BREAK_WIDEN: 2, BREAK_SPEED: 6, BREAK_BZ: -8, RATE_WIDEN: 3,
  BACKCOURT_Z0: 0.6, BACKCOURT_D: 1.0, RATE_BACKCOURT: 3,
});

/**
 * Base vertical fov (degrees). Portrait (aspect < 1) keeps the portrait row's fov; landscape widens for
 * 1 ≤ aspect < 16/9 so the 16:9 horizontal coverage is kept: max(fov, 2·atan(tan(fov/2)·(16/9)/aspect)).
 * (standard 42° at 4:3 → 54.2°, at 1:1 → 68.6°.)
 * @param {number} aspect width / height
 * @param {number|{fov:number}} f fov in degrees or a FRAMING row
 */
export function baseFov(aspect, f) {
  const fov = typeof f === 'number' ? f : f.fov;
  if (!(aspect >= 1) || aspect >= ASPECT_16_9) return fov;
  // tan(hfov/2) = tan(vfov/2)·aspect; keep the horizontal half-angle of a 16:9 frame at the base fov.
  const w = 2 * Math.atan(Math.tan(fov * DEG * 0.5) * ASPECT_16_9 / aspect) / DEG;
  return w > fov ? w : fov;
}

/** The FRAMING row for a camera option and an aspect (portrait iff aspect < 1, v1 rule). */
export function framingRow(mode, aspect) {
  const m = FRAMING[mode] || FRAMING.standard;
  return aspect < 1 ? m.portrait : m.landscape;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * The bare §6.4.2 formula for a clamped ball position (no modifiers except the paint zoom). Pure.
 * @param {object} f FRAMING row
 * @param {number} aspect
 * @param {number} bx clamped ball x
 * @param {number} bz clamped ball z
 * @param {object} out pose {px,py,pz,lx,ly,lz,fov,lens}
 */
export function framingPose(f, aspect, bx, bz, out) {
  const near = f.nearZ === null ? 0 : Math.max(0, bz - f.nearZ);
  out.px = f.kx * bx;
  out.py = f.y;
  out.pz = f.z0 + f.kz * (bz + 9) + f.nearZ0 * near;
  out.lx = f.kx * bx;
  out.ly = f.lookY;
  out.lz = f.lookZ + f.nearLook * near;
  const dx = bx - RIM.x, dz = bz - RIM.z;
  out.fov = baseFov(aspect, f) - (dx * dx + dz * dz < BROADCAST.PAINT_R * BROADCAST.PAINT_R ? f.paintZoom : 0);
  out.lens = aspect < 1 ? f.lens : 0;
  return out;
}

// ---------------------------------------------------------------------------------------------------- world readers
// The broadcast camera reads only the ball (pos, vel, state, owner) of the world; these helpers accept the v1/v2 ball
// (pos Vector3 or {x,y,z}) and tolerate a missing world (title previews, tests).

function ballOf(world) {
  if (!world) return null;
  const b = world.ball;
  if (b && b.pos) return b;
  return null;
}

function vecOf(o) {
  if (!o) return null;
  if (o.pos) return o.pos;
  if (o.position) return o.position;
  return typeof o.x === 'number' ? o : null;
}

function velOf(o) {
  if (!o) return null;
  return o.vel || o.velocity || null;
}

/** Instantaneous modifier targets for a world (pure). Written into `m`. */
function modifierTargets(world, bz, m) {
  m.lift = 0; m.widen = 0; m.backcourt = 0;
  const b = ballOf(world);
  if (!b) return m;
  const p = b.pos;
  // Shot lift: a shot in flight above 4.0 m (passes are state 'pass' and never lift).
  if (b.state === 'flight' && p.y > BROADCAST.SHOT_LIFT_Y) m.lift = BROADCAST.SHOT_LIFT;
  // Break widen: ball speed toward the rim (horizontal projection onto the ball→rim direction) > 6 m/s, bz > −8.
  const v = velOf(b);
  if (v && bz > BROADCAST.BREAK_BZ) {
    const dx = RIM.x - p.x, dz = RIM.z - p.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1e-6 && (v.x * dx + v.z * dz) / d > BROADCAST.BREAK_SPEED) m.widen = BROADCAST.BREAK_WIDEN;
  }
  // Backcourt (R#41): handler within 1.0 m of the half line and moving toward it (+z).
  const h = b.owner || null;
  const hp = vecOf(h);
  if (hp && hp.z >= -BROADCAST.BACKCOURT_D) {
    const hv = velOf(h);
    if (hv && hv.z > 0) m.backcourt = BROADCAST.BACKCOURT_Z0;
  }
  return m;
}

/** Ball z used when the world has no ball (title previews, boot): the CHECK spot. */
const NO_BALL_Z = -4.6;

const MOD = { lift: 0, widen: 0, backcourt: 0 };
const T = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 42, lens: 0 };

/** Damped broadcast camera state (§6.4.2). One instance, owned by the Director. */
export class BroadcastCamera {
  /** @param {{cameraMode?:string, aspect?:number}} [opts] */
  constructor(opts = {}) {
    this.cameraMode = CAMERA_MODES.indexOf(opts.cameraMode) >= 0 ? opts.cameraMode : 'standard';
    this.aspect = opts.aspect > 0 ? opts.aspect : ASPECT_16_9;
    // damped state
    this.pos = { x: 0, y: 6.5, z: 4.5 };
    this.look = { x: 0, y: 1.0, z: -8.0 };
    this.fovBase = 42;          // damped base fov incl. paint zoom (rate 3)
    this.shotLift = 0;          // m (rate 3)
    this.push = 0;              // dunk push in degrees (rate 4)
    this.pushOn = false;
    this.widen = 0;             // break widen degrees (rate 3)
    this.z0Add = 0;             // backcourt ease (m)
    this.needsSnap = true;
  }

  get portrait() { return this.aspect < 1; }

  /** Width / height of the viewport. Portrait iff aspect < 1. */
  setAspect(aspect) { if (aspect > 0) this.aspect = aspect; }

  /** Camera setting: 'standard' | 'close' | 'high' (the Director eases 0.4 s around it). */
  setCameraMode(mode) { if (CAMERA_MODES.indexOf(mode) >= 0) this.cameraMode = mode; }

  /** Dunk push-in on/off (flow: dunk TAKEOFF → true, SLAM + 0.5 s → false). */
  setDunkPush(on) { this.pushOn = !!on; }

  /** Ask for a snap (cut) on the next update. */
  requestSnap() { this.needsSnap = true; }

  /**
   * Instantaneous (undamped) target for a world, with the modifiers at their goal values. Pure: reads `world`, the
   * aspect, the camera option and the dunk-push flag; writes only `out`.
   * @param {object} world {ball: {pos, vel, state, owner}} (null → ball at the CHECK spot (0, −4.6))
   * @param {object} out pose {px,py,pz,lx,ly,lz,fov,lens}
   */
  target(world, out) {
    const f = framingRow(this.cameraMode, this.aspect);
    const b = ballOf(world);
    const bx = b ? clamp(b.pos.x, -BROADCAST.BALL_X, BROADCAST.BALL_X) : 0;
    const bz = b ? clamp(b.pos.z, BROADCAST.BALL_Z_MIN, BROADCAST.BALL_Z_MAX) : NO_BALL_Z;
    framingPose(f, this.aspect, bx, bz, out);
    const m = modifierTargets(world, bz, MOD);
    out.pz += m.backcourt;
    out.ly += m.lift;
    const push = this.pushOn ? BROADCAST.DUNK_PUSH : 0;
    if (push > 0) blendLookToRim(out, BROADCAST.DUNK_LOOK_BLEND);
    out.fov += m.widen - push;
    return out;
  }

  /** Jump straight to the target (cut): MENU/INTRO → CHECK, after replays. Writes the pose into `out`. */
  snap(world, out) {
    const f = framingRow(this.cameraMode, this.aspect);
    const b = ballOf(world);
    const bx = b ? clamp(b.pos.x, -BROADCAST.BALL_X, BROADCAST.BALL_X) : 0;
    const bz = b ? clamp(b.pos.z, BROADCAST.BALL_Z_MIN, BROADCAST.BALL_Z_MAX) : NO_BALL_Z;
    framingPose(f, this.aspect, bx, bz, T);
    const m = modifierTargets(world, bz, MOD);
    this.z0Add = m.backcourt;
    this.shotLift = m.lift;
    this.widen = m.widen;
    this.push = this.pushOn ? BROADCAST.DUNK_PUSH : 0;
    this.pos.x = T.px; this.pos.y = T.py; this.pos.z = T.pz;
    this.look.x = T.lx; this.look.y = T.ly; this.look.z = T.lz;
    this.fovBase = T.fov;
    this.needsSnap = false;
    return this._compose(T.lens, out);
  }

  /**
   * Damped follow (frame time). Writes the composed pose (damped base + damped modifiers) into `out`.
   * @param {number} dt frame seconds
   * @param {object} world
   * @param {object} out
   */
  update(dt, world, out) {
    if (this.needsSnap) return this.snap(world, out);
    const k = dt > 0 ? dt : 0;
    const f = framingRow(this.cameraMode, this.aspect);
    const b = ballOf(world);
    const bx = b ? clamp(b.pos.x, -BROADCAST.BALL_X, BROADCAST.BALL_X) : 0;
    const bz = b ? clamp(b.pos.z, BROADCAST.BALL_Z_MIN, BROADCAST.BALL_Z_MAX) : NO_BALL_Z;
    framingPose(f, this.aspect, bx, bz, T);
    const m = modifierTargets(world, bz, MOD);
    // x += (target − x)·(1 − e^(−rate·dt)): frame-rate independent exponential approach.
    const kp = 1 - Math.exp(-BROADCAST.RATE_POS * k);
    const kf = 1 - Math.exp(-BROADCAST.RATE_FOV * k);
    const kl = 1 - Math.exp(-BROADCAST.RATE_LIFT * k);
    const kd = 1 - Math.exp(-BROADCAST.RATE_PUSH * k);
    const kw = 1 - Math.exp(-BROADCAST.RATE_WIDEN * k);
    const kb = 1 - Math.exp(-BROADCAST.RATE_BACKCOURT * k);
    this.z0Add += (m.backcourt - this.z0Add) * kb;
    this.shotLift += (m.lift - this.shotLift) * kl;
    this.widen += (m.widen - this.widen) * kw;
    this.push += ((this.pushOn ? BROADCAST.DUNK_PUSH : 0) - this.push) * kd;
    const p = this.pos, l = this.look;
    p.x += (T.px - p.x) * kp; p.y += (T.py - p.y) * kp; p.z += (T.pz - p.z) * kp;
    l.x += (T.lx - l.x) * kp; l.y += (T.ly - l.y) * kp; l.z += (T.lz - l.z) * kp;
    this.fovBase += (T.fov - this.fovBase) * kf;
    return this._compose(T.lens, out);
  }

  /** Damped base + damped modifiers → pose. */
  _compose(lens, out) {
    out.px = this.pos.x; out.py = this.pos.y; out.pz = this.pos.z + this.z0Add;
    out.lx = this.look.x; out.ly = this.look.y + this.shotLift; out.lz = this.look.z;
    if (this.push > 1e-4) blendLookToRim(out, BROADCAST.DUNK_LOOK_BLEND * (this.push / BROADCAST.DUNK_PUSH));
    out.fov = this.fovBase - this.push + this.widen;
    out.lens = lens;
    return out;
  }
}

/** Blends the look point a fraction `w` toward the rim centre. */
function blendLookToRim(out, w) {
  out.lx += (RIM.x - out.lx) * w;
  out.ly += (RIM.y - out.ly) * w;
  out.lz += (RIM.z - out.lz) * w;
}
