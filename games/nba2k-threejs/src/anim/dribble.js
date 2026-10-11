/**
 * dribble.js — procedural, phase-locked dribble (spec §4.8, [ANIM §4.1]).
 *
 * Exports
 *   Dribble (class), DRIB (mode codes), DRIB_NAMES, DRIB_MODES (frozen per-mode table), dribbleKinematics(yTop, f)
 *   (the exact vertical constants {yr, yc, w, u, td, tu}).
 *
 * Cycle phase ψ ∈ [0, 1), period T = 1/f: ψ = 0 the ball leaves the palm moving down; free fall to the floor bounce at
 * a = 0.294 (EV.BOUNCE); free rise until the hand meets it at c = 0.70; contact window [0.70, 1.00): the hand cushions
 * the ball up to the top (0.82, ease-out) and pushes it down (ease-in) to the release height. Exact vertical
 * kinematics, recomputed at every release from the parameters then in force (R = 0.12):
 *   yr = yTop − 0.12, yc = yTop − 0.06, td = a·T, tu = (c − a)·T,
 *   down y(τ) = yr − w·τ − ½gτ², w = (yr − R − ½g·td²)/td;  up y(τ) = R + u·τ − ½gτ², u = (yc − R + ½g·tu²)/tu
 *   (still mode, reference body: f 1.9 Hz → w 3.8 m/s, u 4.65 m/s). Horizontal: release point → bounce point
 *   B = predictedRoot(t_bounce) + Ry(ψ)·(side·bx, bz)·sLeg → the predicted hand at the catch (re-predicted every step
 *   during the rise, so the catch lands in the hand); in contact the ball hangs (R + 0.010) below the palm.
 * Modes (table below, STYLE.dribble multiplies yTop / f / the forward push bz): still < 0.5 m/s, protect (< 2.5 m/s
 * with a defender within 1.0 m in front), walk 0.5–2.4 (one bounce per step, f clamped 1.6–2.2), jog 2.4–4.0 (one per
 * step, 2.2–2.8), run 4.0–5.8 (one per two steps, 1.5–1.8), speed > 5.8 (one per two steps, 1.7–1.95), backdown
 * (post). Mode changes only while the ball is in the hand (ψ ∈ [0.70, 1)) and blend over one cycle. Step sync: the
 * release is phase-locked to the strike of the foot opposite the dribble hand (every strike for one-per-step) by the
 * PLL ψ' = f + 2.0·wrap½(ψ_target − ψ); STYLE.dribble.f scales the synced modes' clamp range (not the synced value),
 * so a cadence outside the player's range leaves a bounded lag of (cadence − f)/2 cycles. Pickup: ψ ∈ [0.60, 1) → caught at the next contact; else the remaining path is
 * time-compressed × 2. lowWindow = ball centre below 0.45 m (GP `exposed`).
 *
 * Positions are world space (x, y, z). Zero allocation per step / render (H10).
 */
import { ARM, STYLE } from './presets.js';

const G = 9.81;
const R_BALL = 0.12;
const A_BOUNCE = 0.294, C_CATCH = 0.70, TOP = 0.82;

/** Dribble modes. */
export const DRIB = Object.freeze({ STILL: 0, PROTECT: 1, WALK: 2, JOG: 3, RUN: 4, SPEED: 5, BACKDOWN: 6 });
export const DRIB_NAMES = Object.freeze(['still', 'protect', 'walk', 'jog', 'run', 'speed', 'backdown']);

const md = (o) => Object.freeze(o);
/**
 * [ANIM §4.1] table: f (Hz; synced modes: [fMin, fMax] and sync 1 = one bounce per step, 2 = per two steps), yTop (m ×
 * sLeg), bounce (bx, bz(v) = bz0 + bzv·v), hand rest (hx, hz), arm FK between contacts, off arm (protect bar / backdown).
 */
export const DRIB_MODES = Object.freeze([
  md({ f: 1.9, sync: 0, fMin: 1.9, fMax: 1.9, yTop: 0.95, bx: 0.32, bz0: 0.22, bzv: 0, hx: 0.30, hz: 0.20, arm: ARM.dribStill, off: null }),
  md({ f: 2.8, sync: 0, fMin: 2.8, fMax: 2.8, yTop: 0.62, bx: 0.42, bz0: 0.02, bzv: 0, hx: 0.38, hz: 0.02, arm: ARM.dribProtect, off: ARM.protectBar }),
  md({ f: 1.9, sync: 1, fMin: 1.6, fMax: 2.2, yTop: 0.92, bx: 0.30, bz0: 0.35, bzv: 0.10, hx: 0.28, hz: 0.25, arm: ARM.dribStill, off: null }),
  md({ f: 2.5, sync: 1, fMin: 2.2, fMax: 2.8, yTop: 0.88, bx: 0.28, bz0: 0.45, bzv: 0.08, hx: 0.26, hz: 0.30, arm: ARM.dribJog, off: null }),
  md({ f: 1.65, sync: 2, fMin: 1.5, fMax: 1.8, yTop: 0.95, bx: 0.24, bz0: 0.70, bzv: 0.08, hx: 0.24, hz: 0.40, arm: ARM.dribRun, off: null }),
  md({ f: 1.8, sync: 2, fMin: 1.7, fMax: 1.95, yTop: 1.00, bx: 0.22, bz0: 1.25, bzv: 0, hx: 0.22, hz: 0.45, arm: ARM.dribSpeed, off: null }),
  md({ f: 1.6, sync: 0, fMin: 1.6, fMax: 1.6, yTop: 0.70, bx: 0.35, bz0: -0.10, bzv: 0, hx: 0.33, hz: -0.05, arm: ARM.dribBackdown, off: ARM.backdownBar }),
]);

const _kin = { yr: 0, yc: 0, w: 0, u: 0, td: 0, tu: 0 };
/** Exact vertical constants for top height yTop (m) and frequency f (Hz) (shared object; copy what you keep). */
export function dribbleKinematics(yTop, f) {
  const T = 1 / f;
  const yr = yTop - 0.12, yc = yTop - 0.06, td = A_BOUNCE * T, tu = (C_CATCH - A_BOUNCE) * T;
  _kin.yr = yr; _kin.yc = yc; _kin.td = td; _kin.tu = tu;
  _kin.w = (yr - R_BALL - 0.5 * G * td * td) / td;
  _kin.u = (yc - R_BALL + 0.5 * G * tu * tu) / tu;
  return _kin;
}

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function frac(x) { return x - Math.floor(x); }
function wrapHalf(x) { x = frac(x + 0.5) - 0.5; return x; }
function easeOut(u) { const r = 1 - u; return 1 - r * r; }
function easeIn(u) { return u * u; }

/** Procedural dribble of one player (module header). */
export class Dribble {
  /** @param {object} rig buildRig() result (metrics.sLeg) @param {string} id player id (STYLE.dribble) */
  constructor(rig, id) {
    this.sLeg = rig.metrics.sLeg;
    this.sty = (STYLE[id] || STYLE.kobe).dribble;
    this.active = false;
    this.hand = 1;                   // HAND code: 1 right, 2 left
    this.mode = DRIB.STILL; this.target = DRIB.STILL;
    this.psi = 0; this.psiPrev = 0; this.dpsi = 0;
    this.f = 1.9; this.fRel = 1.9;   // current frequency and the one latched at the last release
    // blended parameters (approach the mode's values over one cycle)
    this.yTop = 0.95; this.bx = 0.32; this.bz = 0.22; this.hx = 0.30; this.hz = 0.20;
    this.armW = new Float64Array(7); this.offW = new Float64Array(7); this.offK = 0;
    // trajectory constants latched at release
    this.yr = 0.83; this.yc = 0.89; this.w = 3.8; this.u = 4.65; this.T = 1 / 1.9;
    this.r0x = 0; this.r0z = 0; this.bpx = 0; this.bpz = 0; this.hcx = 0; this.hcz = 0;
    // root and velocity at the release (and its phase): the root the free-flight path was predicted for
    this.relX = 0; this.relZ = 0; this.relVx = 0; this.relVz = 0; this.relPsi = 0;
    // contact entry blend (the ball arrives at a predicted hand point; the live hand point takes over)
    this.cEnterX = 0; this.cEnterY = 0; this.cEnterZ = 0;
    // root state of the last step
    this.x = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vz = 0; this.speed = 0;
    this.pickup = false; this.picked = false; this.pendingHand = 0;
    this.bounced = false; this.bounceDt = 0; this.released = false;
    this.ballY = 1;
    this.pos = new Float64Array(3);  // ball at the current step (sim)
    this.lowWindow = false;
    for (let i = 0; i < 7; i++) this.armW[i] = DRIB_MODES[0].arm[i];
  }

  /** Side sign in the character frame: +1 left hand, −1 right hand. */
  get side() { return this.hand === 2 ? 1 : -1; }

  /**
   * Starts dribbling with hand (HAND code) from ball centre (bx, by, bz) world at root (x, z, yaw). psi0: start phase
   * (0 = release now; 0.80 = in the hand, e.g. after a move clip's handOn).
   */
  start(hand, bx, by, bz, x, z, yaw, psi0 = 0) {
    this.active = true; this.hand = hand === 2 ? 2 : 1; this.pendingHand = 0;
    this.x = x; this.z = z; this.yaw = yaw;
    this.psi = psi0; this.psiPrev = psi0; this.dpsi = 0;
    this.pickup = false; this.picked = false;
    this.cEnterX = bx; this.cEnterY = by; this.cEnterZ = bz;
    this.pos[0] = bx; this.pos[1] = by; this.pos[2] = bz;
    if (psi0 < C_CATCH) this.latchRelease(bx, by, bz);
  }

  /** Stops (ball picked up, shot, pass, steal). */
  stop() { this.active = false; this.pickup = false; }

  /** Requests a pickup (shot / pass / hold): the ball reaches the hand at the next contact (module header). */
  requestPickup() { if (this.active) this.pickup = true; }

  /**
   * Switches the dribble hand: immediately while the dribble is not running, else at the next release (the ball
   * never jumps sides mid-cycle). Clip moves that hand the ball over restart the dribble with start().
   */
  setHand(hand) {
    const h = hand === 2 ? 2 : 1;
    if (!this.active) { this.hand = h; this.pendingHand = 0; } else if (h !== this.hand) this.pendingHand = h; else this.pendingHand = 0;
  }

  /** Chooses the mode from speed / protect / post. */
  modeFor(speed, protect, post) {
    if (post) return DRIB.BACKDOWN;
    if (protect && speed < 2.5) return DRIB.PROTECT;
    if (speed < 0.5) return DRIB.STILL;
    if (speed < 2.4) return DRIB.WALK;
    if (speed < 4.0) return DRIB.JOG;
    if (speed < 5.8) return DRIB.RUN;
    return DRIB.SPEED;
  }

  /** Release: latch period and vertical constants; bounce point from the root predicted at the bounce time. */
  latchRelease(px, py, pz) {
    const sL = this.sLeg;
    this.fRel = this.f; this.T = 1 / this.f;
    const k = dribbleKinematics(this.yTop * sL, this.f);
    this.yr = k.yr; this.yc = k.yc; this.w = k.w; this.u = k.u;
    // the release height is where the ball actually is (continuity), the constants keep the timing
    this.yr = py;
    this.w = (this.yr - R_BALL - 0.5 * G * k.td * k.td) / k.td;
    this.r0x = px; this.r0z = pz;
    this.relX = this.x; this.relZ = this.z; this.relVx = this.vx; this.relVz = this.vz; this.relPsi = this.psi < C_CATCH ? this.psi : 0;
    const tb = (A_BOUNCE - (this.psi < A_BOUNCE ? this.psi : 0)) * this.T;
    this.predictPoint(tb, this.side * this.bx, this.bz, 0);
    this.bpx = _pp[0]; this.bpz = _pp[1];
    this.predictPoint((C_CATCH - this.psi) * this.T, this.side * this.hx, this.hz, 0);
    this.hcx = _pp[0]; this.hcz = _pp[1];
  }

  /** World point root(t + dt) + Ry(yaw)·(cx, cz)·sLeg into _pp (cx = character left, cz = forward). */
  predictPoint(dt, cx, cz, _u) {
    const sL = this.sLeg, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const rx = this.x + this.vx * dt, rz = this.z + this.vz * dt;
    _pp[0] = rx + (cx * c + cz * s) * sL; _pp[1] = rz + (-cx * s + cz * c) * sL;
    return _pp;
  }

  /**
   * One fixed step. inp = { x, z, vx, vz, yaw, gaitPhi (left strike at 0, right at 0.5), gaitMoving, cadence
   * (steps/s), protect, post }. Sets `bounced` (with `bounceDt` = seconds into the step), `released`, `picked`, the
   * sim ball position `pos` and `lowWindow`.
   */
  update(dt, inp) {
    this.bounced = false; this.released = false; this.picked = false;
    if (!this.active) return;
    this.x = inp.x; this.z = inp.z; this.yaw = inp.yaw; this.vx = inp.vx; this.vz = inp.vz;
    const v = Math.hypot(inp.vx, inp.vz);
    this.speed = v;
    this.target = this.modeFor(v, !!inp.protect, !!inp.post);
    // mode / parameter changes only while the ball is in the hand
    const inHand = this.psi >= C_CATCH;
    if (inHand) this.mode = this.target;
    const M = DRIB_MODES[this.mode], sty = this.sty;
    // frequency: fixed modes × STYLE f; synced modes follow the cadence (one per step / per two steps) inside the
    // mode's clamp scaled by STYLE f, so the PLL below locks without a standing phase lag whenever the cadence fits
    let f = M.f * sty.f;
    if (M.sync && inp.gaitMoving && inp.cadence > 0) f = clamp(M.sync === 1 ? inp.cadence : inp.cadence / 2, M.fMin * sty.f, M.fMax * sty.f);
    this.f = f;
    // parameters approach the mode over one cycle (only while in the hand)
    if (inHand) {
      const k = clamp(dt * f / (1 - C_CATCH), 0, 1);
      this.yTop += (M.yTop * sty.yTop - this.yTop) * k;
      this.bx += (M.bx - this.bx) * k;
      this.bz += ((M.bz0 + M.bzv * v) * sty.push - this.bz) * k;
      this.hx += (M.hx - this.hx) * k;
      this.hz += (M.hz - this.hz) * k;
    }
    const ka = clamp(dt * 6, 0, 1);
    for (let i = 0; i < 7; i++) this.armW[i] += (M.arm[i] - this.armW[i]) * ka;
    if (M.off) { for (let i = 0; i < 7; i++) this.offW[i] += (M.off[i] - this.offW[i]) * ka; this.offK += (1 - this.offK) * ka; }
    else this.offK += (0 - this.offK) * ka;
    // phase rate: PLL to the opposite-foot strike for synced modes
    let rate = f;
    if (M.sync && inp.gaitMoving) {
      const phi = inp.gaitPhi;
      const tgt = M.sync === 1 ? frac(2 * phi) : (this.hand === 1 ? phi : frac(phi - 0.5));
      rate = f + 2.0 * wrapHalf(tgt - this.psi);
      if (rate < 0.5 * f) rate = 0.5 * f;
    }
    if (this.pickup && this.psi < 0.60) rate *= 2;
    const p0 = this.psi;
    let p1 = p0 + rate * dt;
    this.psiPrev = p0; this.dpsi = rate * dt;
    // events inside the step
    if (p0 < A_BOUNCE && p1 >= A_BOUNCE) { this.bounced = true; this.bounceDt = (A_BOUNCE - p0) / rate; }
    if (p0 < C_CATCH && p1 >= C_CATCH) {
      // entering contact: remember where the ball meets the hand (blend toward the live hand point)
      // the end of the rise (psi just below C_CATCH): ballAt(C_CATCH) itself is the contact branch, which blends from
      // cEnter and would return the stale cEnter of the previous contact (the ball then jumped back toward an old
      // catch point, up to several metres once the player had moved)
      this.ballAt(C_CATCH - 1e-9, this.x, this.z, this.yaw, _bp, 0);
      this.cEnterX = _bp[0]; this.cEnterY = _bp[1]; this.cEnterZ = _bp[2];
      if (this.pickup) { this.picked = true; this.pickup = false; p1 = C_CATCH; }
    } else if (this.pickup && p0 >= C_CATCH) { this.picked = true; this.pickup = false; p1 = p0; }
    if (p1 >= 1) {
      // release: the ball leaves the palm at its current position
      this.ballAt(0.999999, this.x, this.z, this.yaw, _bp, 0);
      p1 -= 1;
      this.psi = p1;
      this.released = true;
      if (this.pendingHand) { this.hand = this.pendingHand; this.pendingHand = 0; }
      this.latchRelease(_bp[0], _bp[1], _bp[2]);
    } else this.psi = p1;
    // re-predict the catch point during the rise so the ball meets the live hand
    if (this.psi >= A_BOUNCE && this.psi < C_CATCH) {
      this.predictPoint((C_CATCH - this.psi) / (rate > 1e-6 ? rate : f), this.side * this.hx, this.hz, 0);
      this.hcx = _pp[0]; this.hcz = _pp[1];
    }
    this.ballAt(this.psi, this.x, this.z, this.yaw, this.pos, 0);
    this.ballY = this.pos[1];
    this.lowWindow = this.ballY < 0.45;
  }

  /**
   * Ball centre (world) at phase psi with the root at (rx, rz, ryaw) into out[o..o+2]. Fall and rise follow the
   * latched kinematics (world-anchored xz path); in contact the ball hangs under the hand rest point.
   */
  ballAt(psi, rx, rz, ryaw, out, o) {
    const T = this.T;
    if (psi < C_CATCH) {
      // The bounce point was placed for the root predicted at the release (root + v·t). When the root leaves that
      // prediction (a stop, a cut, root motion of a move clip, a separation push), the ball's path moves with the
      // deviation, so it stays at its designed offset from the player instead of drifting up to metres away; at
      // constant velocity the deviation is 0 and the path is the world-anchored one. The deviation is 0 at the
      // release (continuity) and fades out over the rise, where the catch point is re-predicted from the live root.
      const tp = (psi - this.relPsi) * T;
      const dx = rx - (this.relX + this.relVx * tp), dz = rz - (this.relZ + this.relVz * tp);
      if (psi < A_BOUNCE) {
        const tau = psi * T;
        out[o + 1] = this.yr - this.w * tau - 0.5 * G * tau * tau;
        const k = psi / A_BOUNCE;
        out[o] = this.r0x + (this.bpx - this.r0x) * k + dx; out[o + 2] = this.r0z + (this.bpz - this.r0z) * k + dz;
        return out;
      }
      const tau = (psi - A_BOUNCE) * T;
      out[o + 1] = R_BALL + this.u * tau - 0.5 * G * tau * tau;
      const k = (psi - A_BOUNCE) / (C_CATCH - A_BOUNCE);
      out[o] = this.bpx + (this.hcx - this.bpx) * k + dx * (1 - k); out[o + 2] = this.bpz + (this.hcz - this.bpz) * k + dz * (1 - k);
      return out;
    }
    // contact: y follows yc → yTop (ease-out, 0.70 → 0.82) → yr (ease-in, 0.82 → 1.00)
    const sL = this.sLeg, yTop = this.yTop * sL, yc = yTop - 0.06, yr = yTop - 0.12;
    let y;
    if (psi < TOP) y = yc + (yTop - yc) * easeOut((psi - C_CATCH) / (TOP - C_CATCH));
    else y = yTop + (yr - yTop) * easeIn((psi - TOP) / (1 - TOP));
    const c = Math.cos(ryaw), s = Math.sin(ryaw), cx = this.side * this.hx, cz = this.hz;
    const hx = rx + (cx * c + cz * s) * sL, hz = rz + (-cx * s + cz * c) * sL;
    // the first 40 % of the contact blends from where the ball met the hand to the live hand point
    const k = clamp((psi - C_CATCH) / (0.4 * (1 - C_CATCH)), 0, 1);
    out[o] = this.cEnterX + (hx - this.cEnterX) * k;
    out[o + 2] = this.cEnterZ + (hz - this.cEnterZ) * k;
    out[o + 1] = k < 1 ? this.cEnterY + (y - this.cEnterY) * k : y;
    return out;
  }

  /** Render phase at alpha (the step's phase advance interpolated; wraps). */
  renderPsi(alpha) { return frac(this.psiPrev + alpha * this.dpsi); }

  /**
   * Hand IK target for the render time: palm = ball top + 0.012 (palm faces down), weight 1 in the contact window
   * with 0.05 s ramps. Writes [x, y, z, weight] into out.
   */
  handTarget(psi, ball, out) {
    out[0] = ball[0]; out[1] = ball[1] + R_BALL + 0.012; out[2] = ball[2];
    const ramp = 0.05 * this.f;                    // 0.05 s in phase units
    let w;
    if (psi >= C_CATCH) w = 1;
    else if (psi >= C_CATCH - ramp) w = (psi - (C_CATCH - ramp)) / ramp;
    else if (psi < ramp) w = 1 - psi / ramp;
    else w = 0;
    out[3] = w;
    return out;
  }
}

const _pp = new Float64Array(2);
const _bp = new Float64Array(3);
