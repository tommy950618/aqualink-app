/**
 * proxy.js — AnimProxy: the headless stand-in for Animator (spec §1.3 "Headless", §1.4 entries marked *, §4.13).
 *
 * Exports
 *   PROXY_METRICS (frozen per-player rig metrics of spec §4.1 + listed reach, eye height, foot length),
 *   AnimProxy (class).
 *
 * Same gameplay-facing API as Animator, no three.js scene and no skinning, so `new Game({scene: null, anim: 'proxy'})`
 * runs in Node:
 *   play(clipIdx, { mirror, rate, warp: {[EV]: t}, target: {x, z, yaw}, layer: 'action'|'upper'|'add', blendIn })
 *   releaseNow()  setJump(h, airT, profile?)  stopAction(blendOut)  step(dt)  querySocket(sockIdx, out)  onCatch(mode)
 *   events (EventRing of 32 {code, t, param, clip, layer}; read with `for (let e; (e = a.events.next());)`)
 *   ballMode (BM code), ballHand (HAND code), action (clip index or −1), actionTime (clip s), actionClip (timing clip)
 * plus the render-side calls as harmless no-ops (evaluate, capture, applyBlend, freeze, setYawOverride, walkTo,
 * setFace, setLook) and renderSocket = querySocket, so game code never branches on the animator type.
 *
 * Conventions shared with Animator (the integrator must keep them identical):
 *   • owner: the Player ({pos: {x, z}, yaw, vel: {x, z}, jumpY}) read for the root transform, the entry velocity
 *     and jumpY; pass it as opts.owner or assign `proxy.owner`. Without an owner the proxy uses setRoot() values and
 *     its own ballistic jumpY (from setJump at TAKEOFF).
 *   • motion: {active, vx, vz, dyaw, exit, exitVx, exitVz} rewritten every step — while `active` the player's
 *     velocity is (vx, vz) and yaw += dyaw (root motion, spec §4.4); `exit` is true on the step the clip ends with an
 *     exit velocity (exitVx, exitVz).
 *   • Clip timing: the registered compiled clip when its data is loaded, else select.js' catalog timing clip; the
 *     clock (ClipClock) and root motion (RootMotion) are the same classes Animator uses.
 *   • onCatch(mode): mode 'held' | 'both' | 'dribble' | 'drib' | 'R' | 'L' (or a BM code); emits CATCH now and READY
 *     0.30 s later. setBallMode(mode, hand) lets gameplay start/stop a dribble or free the ball.
 *
 * Closed-form sockets (one definition, also used by spec §5.4): palm = root + facing·0.30 + (0, h, 0) with
 * h = reachM − 0.24 + jumpY during block / contest / rebound / steal / tip clips, else 1.05·sLeg; ball1 of a held
 * jump shot = the release-table height generalised to any jump (launchMid − hMid + ½·g·rva² + jumpY), of a
 * layup / hook / floater reach0 + 0.15 + jumpY, of a dunk the ball reach (reachDunk + 0.04 one hand, −0.02 two
 * hands) + jumpY, of a dribble the hand-rest point (side·0.30, 0.95, 0.20)·sLeg, of any other held ball 0.95·sLeg at
 * facing·0.30. Zero allocation per step (H10) once prepareTiming() has run (the constructor does it by default).
 * Constructor opts: { owner, prepare (default true), launchMid (m; overrides FORMS[id].launchMid for the held-shot
 * ball height, so the proxy can be calibrated to the real rig for B57) }.
 */
import { SOCK } from './rig.js';
import { BM, HAND, EV, EventRing, ClipClock, RootMotion, sampleBall } from './clip.js';
import { FORMS, STYLE } from './presets.js';
import { timingClip, catOf, prepareTiming } from './select.js';

const G = 9.81;

const m = (o) => Object.freeze(o);
/**
 * Per-player metrics (spec §4.1 table; reachM §2.2). The measured rig fields (hipH, sLeg, shoulderY, armLen, handLen,
 * ankleY, reach0, reachAug, eyeY, footLen, ankleX) are re-measured on the shipped v2 bake (assets/legends after the
 * likeness re-bake moved shoulders / arms by up to 19 mm), so the headless proxy keeps matching the real rig (B57).
 */
export const PROXY_METRICS = Object.freeze({
  kobe: m({ height: 1.96, hipH: 1.080, thigh: 0.488, calf: 0.511, sLeg: 1.004, shoulderY: 1.578, armLen: 0.599, handLen: 0.232, ankleY: 0.085, reach0: 2.316, reachAug: 2.436, reachM: 2.64, eyeY: 1.847, footLen: 0.305, ankleX: 0.226 }),
  jordan: m({ height: 1.96, hipH: 1.073, thigh: 0.484, calf: 0.515, sLeg: 0.998, shoulderY: 1.569, armLen: 0.584, handLen: 0.245, ankleY: 0.084, reach0: 2.300, reachAug: 2.420, reachM: 2.65, eyeY: 1.838, footLen: 0.300, ankleX: 0.224 }),
  lebron: m({ height: 2.03, hipH: 1.109, thigh: 0.513, calf: 0.516, sLeg: 1.030, shoulderY: 1.646, armLen: 0.564, handLen: 0.238, ankleY: 0.087, reach0: 2.353, reachAug: 2.473, reachM: 2.69, eyeY: 1.907, footLen: 0.316, ankleX: 0.229 }),
  giannis: m({ height: 2.09, hipH: 1.188, thigh: 0.546, calf: 0.561, sLeg: 1.103, shoulderY: 1.688, armLen: 0.607, handLen: 0.258, ankleY: 0.094, reach0: 2.450, reachAug: 2.570, reachM: 2.81, eyeY: 1.980, footLen: 0.335, ankleX: 0.242 }),
  yao: m({ height: 2.27, hipH: 1.262, thigh: 0.651, calf: 0.519, sLeg: 1.177, shoulderY: 1.850, armLen: 0.607, handLen: 0.262, ankleY: 0.093, reach0: 2.614, reachAug: 2.734, reachM: 2.95, eyeY: 2.154, footLen: 0.336, ankleX: 0.234 }),
  kyrie: m({ height: 1.87, hipH: 1.014, thigh: 0.463, calf: 0.477, sLeg: 0.941, shoulderY: 1.502, armLen: 0.544, handLen: 0.212, ankleY: 0.081, reach0: 2.173, reachAug: 2.293, reachM: 2.515, eyeY: 1.756, footLen: 0.290, ankleX: 0.215 }),
});

// category codes for socket rules (resolved once per clip index)
const C_OTHER = 0, C_HOLD = 1, C_KEY = 2, C_DUNK = 3, C_HIGH = 4;
const CAT_CODE = [];
function catCode(idx, src) {
  let c = CAT_CODE[idx];
  if (c !== undefined) return c;
  const s = catOf(idx);
  if (s === 'block' || s === 'contest' || s === 'rebound' || s === 'steal' || s === 'tip') c = C_HIGH;
  else if (s === 'dunk') c = C_DUNK;
  else if (src && src.timing.meter === 'hold') c = C_HOLD;
  else if (src && src.timing.meter === 'key') c = C_KEY;
  else if (s === 'jumper') c = C_HOLD;
  else if (s === 'layup') c = C_KEY;
  else c = C_OTHER;
  CAT_CODE[idx] = c;
  return c;
}

/** One animation layer of the proxy (clock + clip identity). */
class Slot {
  constructor(layer) {
    this.layer = layer; this.clock = new ClipClock(); this.idx = -1; this.src = null; this.mirror = false;
    this.cat = C_OTHER; this.lastBall = 0; this.start = 0; this.hasBall = false;
  }
}

const LAYER = { action: 0, upper: 1, add: 2 };

/** Headless animator (see the module header). */
export class AnimProxy {
  constructor(id, metrics = PROXY_METRICS[id], opts = {}) {
    if (!STYLE[id]) throw new Error(`AnimProxy: unknown player '${id}'`);
    this.id = id;
    this.metrics = metrics;
    this.sLeg = metrics.sLeg;
    this.tempo = STYLE[id].tempo;
    this.owner = opts.owner || null;
    this.external = false;
    this.time = 0;                                   // proxy game clock (s), advanced by step()
    this.events = new EventRing(32);
    this.slots = [new Slot(0), new Slot(1), new Slot(2)];
    this.root = new RootMotion();
    this.motion = { active: false, vx: 0, vz: 0, dyaw: 0, exit: false, exitVx: 0, exitVz: 0 };
    this.ballMode = BM.FREE;
    this.ballHand = HAND.R;
    this.readyAt = -1;
    // root transform used when there is no owner (setRoot)
    this.x = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vz = 0;
    // internal ballistic jump (used when there is no owner.jumpY)
    this.jumpY = 0; this.jumpH = 0; this.jumpAir = 0; this.jumpStart = -1; this.jumpArmed = false;
    // closed-form constants
    const F = FORMS[id];
    // ball height at launch minus jumpY; opts.launchMid overrides the §4.9.2 table value (rig calibration, B57)
    const launchMid = typeof opts.launchMid === 'number' ? opts.launchMid : F.launchMid;
    this.shotBase = launchMid - F.h.mid + 0.5 * G * F.rva * F.rva;
    this.layBase = metrics.reach0 + 0.15;
    this.dunk1 = F.dunk.reach + 0.04;
    this.dunk2 = F.dunk.reach - 0.02;
    if (opts.prepare !== false) prepareTiming([id]);
  }

  // ------------------------------------------------------------------ state getters
  /** Current action clip index (−1 none). */
  get action() { return this.slots[0].clock.active ? this.slots[0].idx : -1; }
  /** Current action clip time (s). */
  get actionTime() { return this.slots[0].clock.t; }
  /** Timing clip of the current action (clipTiming(actionClip) gives its events), or null. */
  get actionClip() { return this.slots[0].clock.active ? this.slots[0].src : null; }
  /** Current upper-layer clip index (−1 none). */
  get upper() { return this.slots[1].clock.active ? this.slots[1].idx : -1; }
  /** True while the action clip is inside its air segment. */
  get airborne() { const c = this.slots[0].clock; return c.active && c.takeoffG >= 0 && c.inAir(c.t); }

  /** Root transform when no owner is attached. */
  setRoot(x, z, yaw, vx = 0, vz = 0) { this.x = x; this.z = z; this.yaw = yaw; this.vx = vx; this.vz = vz; }

  rootX() { return this.owner ? this.owner.pos.x : this.x; }
  rootZ() { return this.owner ? this.owner.pos.z : this.z; }
  rootYaw() { return this.owner ? this.owner.yaw : this.yaw; }
  curJumpY() { return this.owner && typeof this.owner.jumpY === 'number' ? this.owner.jumpY : this.jumpY; }

  // ------------------------------------------------------------------ fixed-step API
  /**
   * Starts clip clipIdx on a layer. Returns true when started and any target fits the clip's matching limits,
   * false when the target was clamped or the clip is unknown.
   */
  play(clipIdx, opts) {
    const o = opts || EMPTY;
    const mirror = !!o.mirror;
    const src = timingClip(clipIdx, this.id, mirror);
    if (!src) return false;
    const li = o.layer ? LAYER[o.layer] : (src.timing.layer === 'upper' ? 1 : src.timing.layer === 'add' ? 2 : 0);
    const s = this.slots[li === undefined ? 0 : li];
    s.idx = clipIdx; s.src = src; s.mirror = mirror; s.cat = catCode(clipIdx, src); s.lastBall = 0;
    s.start = this.time; s.hasBall = this.ballMode !== BM.FREE;
    s.clock.start(src, o.rate || 1, this.tempo, o.warp || null);
    let fits = true;
    if (s.layer === 0) {
      const ow = this.owner;
      const vx = ow ? ow.vel.x : this.vx, vz = ow ? ow.vel.z : this.vz;
      fits = this.root.begin(src, this.sLeg, this.rootX(), this.rootZ(), this.rootYaw(), vx, vz, o.target || null);
      this.motion.active = this.root.active; this.motion.vx = 0; this.motion.vz = 0; this.motion.dyaw = 0; this.motion.exit = false;
      this.jumpArmed = false;
    }
    return fits;
  }

  /** Shot release input (spec §4.9.1): see ClipClock.releaseNow. */
  releaseNow() { return this.slots[0].clock.releaseNow(); }

  /** Gameplay ballistic parameters of the action's air segment; profile {slam, hang} for dunks. */
  setJump(h, airT, profile) {
    this.slots[0].clock.setJump(h, airT, profile);
    this.jumpH = h; this.jumpAir = airT; this.jumpArmed = true;
    const c = this.slots[0].clock;
    if (c.takeoffG >= 0 && this.jumpStart < 0) this.jumpStart = this.slots[0].start + c.takeoffG;
  }

  /** Ends the action layer (back to locomotion). */
  stopAction() {
    this.slots[0].clock.stop();
    this.root.active = false;
    this.motion.active = false; this.motion.vx = 0; this.motion.vz = 0; this.motion.dyaw = 0;
  }

  /** Ends the upper layer. */
  stopUpper() { this.slots[1].clock.stop(); }

  /** Ball caught: mode 'held'|'both'|'dribble'|'drib'|'R'|'L' or a BM code. Emits CATCH now, READY at +0.30 s. */
  onCatch(mode) {
    this.setBallMode(mode === undefined ? BM.BOTH : mode);
    this.events.push(EV.CATCH, this.time, 0, -1, 0);
    this.readyAt = this.time + 0.30;
  }

  /** Sets the ball attachment directly (gameplay: start/stop a dribble, free the ball). */
  setBallMode(mode, hand) {
    let bm = mode;
    if (typeof mode === 'string') {
      bm = mode === 'held' || mode === 'both' ? BM.BOTH : mode === 'dribble' || mode === 'drib' ? BM.DRIB
        : mode === 'R' ? BM.R : mode === 'L' ? BM.L : mode === 'path' ? BM.PATH : mode === 'free' ? BM.FREE : BM.BOTH;
    }
    this.ballMode = bm;
    if (bm === BM.R) this.ballHand = HAND.R;
    else if (bm === BM.L) this.ballHand = HAND.L;
    if (hand === 'L' || hand === HAND.L) this.ballHand = HAND.L; else if (hand === 'R' || hand === HAND.R) this.ballHand = HAND.R;
  }

  /** Advances every layer by dt (fixed step): events, ball mode, root motion, jump. */
  step(dt) {
    const ev = this.events;
    const h0 = ev.head;
    this.motion.exit = false;
    if (!this.root.active) { this.motion.active = false; this.motion.vx = 0; this.motion.vz = 0; this.motion.dyaw = 0; }
    for (let li = 0; li < 3; li++) {
      const s = this.slots[li];
      const c = s.clock;
      if (!c.active) continue;
      const tOld = c.t;
      const wasActive = c.active;
      c.step(dt, this.time, ev, s.idx, li);
      const tNew = c.t;
      // ball attachment keyed by the clip (step track; 0 = keep)
      const bm = sampleBall(s.src, tNew);
      if (bm !== 0 && bm !== s.lastBall) { s.lastBall = bm; this.applyClipBall(bm, s.mirror); }
      if (li === 0) {
        if (this.root.active) {
          this.root.step(tOld, tNew, dt, this.time + dt - s.start, c.takeoffG >= 0 && c.inAir(tNew), c.takeoffG);
          this.motion.active = c.active || wasActive;
          this.motion.vx = this.root.vx; this.motion.vz = this.root.vz; this.motion.dyaw = this.root.dyaw;
          if (!c.active) {
            this.motion.active = false;
            if (this.root.hasExit) { this.motion.exit = true; this.motion.exitVx = this.root.exitVx; this.motion.exitVz = this.root.exitVz; }
            this.root.active = false;
          }
        }
        if (c.takeoffG >= 0 && this.jumpArmed && this.jumpStart < 0) this.jumpStart = s.start + c.takeoffG;
      }
    }
    // events emitted this step that change the ball state
    for (let i = h0; i < ev.head; i++) {
      const r = ev.buf[i % ev.size];
      switch (r.code) {
        case EV.RELEASE: case EV.SLAM: this.ballMode = BM.FREE; break;
        case EV.HAND_ON: if (r.param === HAND.R || r.param === HAND.L) this.ballHand = r.param; break;
        case EV.HANDOFF: this.ballHand = this.ballHand === HAND.R ? HAND.L : HAND.R; break;
        default: break;
      }
    }
    if (this.readyAt >= 0 && this.time + dt >= this.readyAt) {
      ev.push(EV.READY, this.readyAt, 0, -1, 0);
      this.readyAt = -1;
    }
    // internal ballistic jumpY (only meaningful without an owner): vy = 4h/T, g' = 8h/T² so the airtime is T
    if (this.jumpStart >= 0 && this.jumpAir > 0) {
      const tau = this.time + dt - this.jumpStart;
      if (tau >= this.jumpAir) { this.jumpY = 0; this.jumpStart = -1; this.jumpArmed = false; }
      else if (tau > 0) {
        const gp = 8 * this.jumpH / (this.jumpAir * this.jumpAir), vy = 4 * this.jumpH / this.jumpAir;
        const y = vy * tau - 0.5 * gp * tau * tau;
        this.jumpY = y > 0 ? y : 0;
      }
    }
    this.time += dt;
  }

  applyClipBall(bm, mirror) {
    // `mirror` is informational: both timing sources (registered clips via getClip and the catalog timing clips) build
    // the '_L' side with mirrorDef, which already swaps R/L ball modes; swapping again here put the ball in the wrong
    // hand for mirrored clips (the Animator does not swap either, so proxy and real now agree).
    void mirror;
    const b = bm;
    this.ballMode = b;
    if (b === BM.R) this.ballHand = HAND.R; else if (b === BM.L) this.ballHand = HAND.L;
  }

  /**
   * World position of socket sockIdx (SOCK.*) at the current step, closed form (module header). `out` gets x/y/z
   * (THREE.Vector3 or any {x, y, z}). Returns out.
   */
  querySocket(sockIdx, out) {
    const M = this.metrics, sL = this.sLeg;
    const yaw = this.rootYaw();
    const fx = Math.sin(yaw), fz = Math.cos(yaw);        // forward
    const lx = Math.cos(yaw), lz = -Math.sin(yaw);       // character's left
    const x0 = this.rootX(), z0 = this.rootZ(), jy = this.curJumpY();
    const s0 = this.slots[0];
    const cat = s0.clock.active ? s0.cat : C_OTHER;
    let fwd = 0.30, lat = 0, y = 0;
    switch (sockIdx) {
      case SOCK.palm_r: case SOCK.palm_l: case SOCK.tip_r: case SOCK.tip_l: case SOCK.rimHook_r: case SOCK.rimHook_l: {
        const high = cat === C_HIGH || (this.slots[1].clock.active && this.slots[1].cat === C_HIGH);
        y = high ? M.reachM - 0.24 + jy : 1.05 * sL;
        if (sockIdx === SOCK.tip_r || sockIdx === SOCK.tip_l) y += high ? 0.39 * M.handLen : -0.39 * M.handLen;
        else if (sockIdx === SOCK.rimHook_r || sockIdx === SOCK.rimHook_l) y += high ? 0.25 * M.handLen : -0.25 * M.handLen;
        break;
      }
      case SOCK.ball1_r: case SOCK.ball1_l: case SOCK.ball: {
        if (cat === C_HOLD) y = this.shotBase + jy;
        else if (cat === C_KEY) y = this.layBase + jy;
        else if (cat === C_DUNK) { y = (s0.src && s0.src.timing.params.hands === 2 ? this.dunk2 : this.dunk1) + jy; fwd = 0.25; }
        else if (this.ballMode === BM.DRIB) {
          y = 0.95 * sL; fwd = 0.20 * sL; lat = (this.ballHand === HAND.L ? 1 : -1) * 0.30 * sL;
        } else y = 0.95 * sL;
        break;
      }
      case SOCK.heel_r: case SOCK.heel_l:
        lat = (sockIdx === SOCK.heel_l ? 1 : -1) * M.ankleX * sL; fwd = -0.06 * sL; y = 0; break;
      case SOCK.toe_r: case SOCK.toe_l:
        lat = (sockIdx === SOCK.toe_l ? 1 : -1) * M.ankleX * sL; fwd = M.footLen - 0.06 * sL; y = 0.01; break;
      case SOCK.ankle_r: case SOCK.ankle_l:
        lat = (sockIdx === SOCK.ankle_l ? 1 : -1) * M.ankleX * sL; fwd = 0; y = M.ankleY + jy; break;
      case SOCK.ballJ_r: case SOCK.ballJ_l:
        lat = (sockIdx === SOCK.ballJ_l ? 1 : -1) * M.ankleX * sL; fwd = 0.13 * sL; y = 0.03 + jy; break;
      case SOCK.eyeC: fwd = 0.10; y = M.eyeY + jy; break;
      case SOCK.chin: fwd = 0.12; y = M.eyeY - 0.11 + jy; break;
      default: fwd = 0; y = jy; break;
    }
    out.x = x0 + fx * fwd + lx * lat;
    out.y = y;
    out.z = z0 + fz * fwd + lz * lat;
    return out;
  }

  /** Render-time socket: identical to querySocket in headless mode. */
  renderSocket(sockIdx, out) { return this.querySocket(sockIdx, out); }

  // ------------------------------------------------------------------ render-side API (no-ops headless)
  evaluate() {}
  capture() { return 0; }
  applyBlend() {}
  freeze() {}
  setYawOverride() {}
  walkTo() {}
  setFace() {}
  setLook() {}
  setBlockAim() {}     // block aim (I4): the closed-form palm already sits 0.30 m in front of the defender
}

const EMPTY = Object.freeze({});
