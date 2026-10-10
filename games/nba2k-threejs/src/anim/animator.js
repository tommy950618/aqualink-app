/**
 * animator.js — the layered skeletal animator of one legend (spec §1.4 "WP3 Animator", §4.2–§4.6, §4.8, §4.11,
 * §4.14, [ANIM §2.3–§2.9, §10]).
 *
 * Exports
 *   Animator (class), FACE_AR (attack / release seconds per expression channel, spec §3.9), ANIM_CAPTURE_FLOATS (233,
 *   floats written by capture()), DETAIL_TIERS (per quality tier detail flags, spec §4.14).
 *
 * Gameplay-facing API (identical to AnimProxy, which game code may use instead headless):
 *   play(clipIdx, { mirror, rate, warp: {[EV]: t}, target: {x, z, yaw}, layer: 'action'|'upper'|'add', blendIn }) → fits
 *   releaseNow()  setJump(h, airT, profile?)  stopAction(blendOut)  stopUpper(blendOut)  step(dt)  querySocket(s, out)
 *   onCatch(mode)  setBallMode(mode, hand)  events (EventRing of 32: {code, t, param, clip, layer})  ballMode (BM)
 *   ballHand (HAND)  action / actionTime / actionClip / upper / airborne  motion {active, vx, vz, dyaw, exit, exitVx,
 *   exitVz}  owner (the Player: {pos:{x,z}, yaw, vel:{x,z}, jumpY, stamina?})  time
 * Render API: evaluate(alpha, frameDt), renderSocket(s, out), capture(f32, off) → 233, applyBlend(f32, offA, offB, alpha),
 *   external (bool: replay drives the bones), freeze(clipId, t, mirror), setYawOverride(yaw|null), walkTo(x, z, yaw,
 *   speed), setFace(name, w), setLookTarget(x, y, z, w) / clearLookTarget(), setLookPoint(name, x, y, z),
 *   setAim(angleRad), contact(x, y, z, kind), setCatch(x, y, z, tArrive), setSlamPoint(x, y, z), crossfade(s),
 *   deepBreath(), setDetail(flags), resetPose(), footLocks(), stats.
 * Context written by gameplay each step (no allocation): animator.ctx = { onDefence, stance ('auto' | 'stand' |
 *   'tripleThreat' | 'postUp' | 'postSeal' | 'boxOut' | 'def'), protect (defender within 1.0 m in front), post (backdown
 *   dribble), drive (Jordan's tongue: dribbling at the rim > 4.5 m/s within 7 m), stamina (0..1) }.
 *
 * Layers (render order, [ANIM §2.3.1]): 0 base = procedural gait / stance (+ dribble arm and ball-holding overlays),
 * 1 action (override, per-bone mask × weight, only tracked bones), 2 upper (upper mask over the base), 3 additive (lean,
 * breathing, aim twist, hold micro-motion, landing absorb, swat, `add` layer clips), 4 procedural (foot locks with the
 * reachability pelvis drop and auto-release, hand IK: two-hand closure, dribble contact, ball path contacts, catch, dunk
 * slam / rim grab, block contact; look-at + iris), 5 face (expression targets smoothed with §3.9 attack / release,
 * blink, baselines, mannerisms of §4.11). Entry fades ease-out w = 1 − (1 − u)³, exits smoothstep; an interrupted fade
 * starts from a snapshot of the last layered pose with the old per-bone weights (never a pop); teleports and
 * crossfade(s) blend from a full snapshot (0.20 s, R#37).
 *
 * Timing (fixed step, deterministic): ClipClock / RootMotion from clip.js (the same classes AnimProxy uses, so proxy and
 * real timings are identical, B46/B57); events are pushed with exact crossing times; the render pass samples the clips
 * at prevClipTime + alpha·(clipTime − prevClipTime). querySocket() evaluates the step pose lazily (once per step) and
 * runs FK only along the socket's bone chain ([ANIM §2.4.6]); `ball` (SOCK.ball) is the current ball centre by ball
 * mode (both = midpoint of both ball1 sockets, drib = dribble.js, path = the clip's ball path, R/L = that ball1).
 *
 * Bones: `matrixAutoUpdate = false`; evaluate() writes quaternion fields directly (no Euler sync), composes the
 * matrices and calls one `object.updateMatrixWorld(true)`. No allocation in step / evaluate / queries (H10); without a
 * character (Node tests) the same math runs on the internal Skel only.
 */
import { BONE, BONE_COUNT, BONE_NAMES, BONE_PARENT, SOCK, anatQuat, AQ, toLocal, qnlerp, qmul, qrotate } from './rig.js';
import { EV, BM, HAND, EventRing, ClipClock, RootMotion, sampleClip, sampleBall, SAMPLE_AIR_LINEAR, clipIndex, getDef } from './clip.js';
import { Pose, copyPose, blendPose, addPose, MASK, MASK_W, EXPR, LOOK } from './pose.js';
import { STYLE, FINGER_ID, FINGER_BONES, fingerQuats, SHORT } from './presets.js';
import { timingClip, catOf, RIM_POS } from './select.js';
import { Skel, footLock, footReach, footDropFor, handToPoint, handOnBall, FootTarget, LEG_IK, ARM_IK, RyRx } from './ik.js';
import { Gait, GAIT, STANCE_CODE, poseArm } from './locomotion.js';
import { Dribble } from './dribble.js';
import { LookAt } from './look.js';

const DEG = Math.PI / 180;
const G = 9.81;
const RIM_R = 0.2286;
const BALL_R = 0.12;

/** Floats per player written by capture() (spec §6.4.6: root 4 + 53 quats + pelvis 3 + 9 expr + eye 2 + vis 1 + 2). */
export const ANIM_CAPTURE_FLOATS = 233;

/** Expression attack / release (s) in channel order (spec §3.9). */
export const FACE_AR = Object.freeze([
  [0.08, 0.15], [0.10, 0.12], [0.15, 0.30], [0.10, 0.25], [0.20, 0.30], [0.20, 0.40], [0.15, 0.30], [0.10, 0.20], [0.05, 0.07],
]);

/** Detail flags per quality tier (spec §4.14; the integrator also decides which players run at 30 Hz). */
export const DETAIL_TIERS = Object.freeze({
  high: Object.freeze({ fingers: true, footIK: true, handIK: true, look: true, eyes: true, breathing: true, expressions: true, halfRate: false }),
  medium: Object.freeze({ fingers: true, footIK: true, handIK: true, look: true, eyes: false, breathing: true, expressions: true, halfRate: false }),
  low: Object.freeze({ fingers: false, footIK: true, handIK: false, look: true, eyes: false, breathing: false, expressions: false, halfRate: false }),
});

const ONES = new Float32Array(BONE_COUNT).fill(1);
const LAYER = { action: 0, upper: 1, add: 2 };
const EMPTY = Object.freeze({});
const C_OTHER = 0, C_JUMPER = 1, C_LAYUP = 2, C_DUNK = 3, C_BLOCK = 4, C_REB = 5, C_PASS = 6, C_CEL = 7, C_TIP = 8;
const CAT_CODE = { jumper: C_JUMPER, fade: C_JUMPER, hook: C_JUMPER, floater: C_JUMPER, layup: C_LAYUP, dunk: C_DUNK,
  block: C_BLOCK, contest: C_BLOCK, rebound: C_REB, pass: C_PASS, celebration: C_CEL, cel: C_CEL, tip: C_TIP };
const E_JAW = EXPR.jawOpen, E_TONGUE = EXPR.tongueOut, E_ROAR = EXPR.roar, E_GRIN = EXPR.grin, E_SCOWL = EXPR.scowl, E_BLINK = EXPR.blink;
const LOOK_POINTS = 9;
const FOOT_SOCKS = [[SOCK.ankle_r, SOCK.ballJ_r, SOCK.heel_r, SOCK.toe_r], [SOCK.ankle_l, SOCK.ballJ_l, SOCK.heel_l, SOCK.toe_l]];

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function smooth(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); }
function easeOut3(u) { if (u <= 0) return 0; if (u >= 1) return 1; const r = 1 - u; return 1 - r * r * r; }
function wrapPi(a) { a %= 2 * Math.PI; if (a > Math.PI) a -= 2 * Math.PI; else if (a <= -Math.PI) a += 2 * Math.PI; return a; }
/** Dunk IK weight from the time left to SLAM: 0 → 1 over the last 0.15 s, complete one fixed step before it. */
function slamRamp(toSlam) { return toSlam >= 0.15 ? 0 : toSlam <= 1 / 60 ? 1 : (0.15 - toSlam) / (0.15 - 1 / 60); }

/** One clip layer (action / upper / add). */
class Layer {
  constructor(li) {
    this.li = li; this.clock = new ClipClock();
    this.idx = -1; this.src = null; this.mirror = false; this.cat = C_OTHER; this.lastBall = 0;
    this.state = 0;                  // 0 off, 1 playing (fading in / full), 2 fading out
    this.age = 0; this.agePrev = 0; this.fadeIn = 0.06;
    this.outAge = 0; this.outAgePrev = 0; this.fadeOut = 0.20; this.frozenT = 0;
    this.mask = MASK.full; this.start = 0;
    this.x0 = 0; this.z0 = 0; this.yaw0 = 0;   // clip-start frame (world)
    this.w = 0;                      // weight used by the last evaluate
    this.inPlace = false; this.cosmetic = false; this.frozen = false;
    this.gather = -1; this.land = -1; this.slamAt = -1; this.takeoffAt = -1;
  }
}

/** Clip-driven foot lock state (render side). */
class ClipFoot {
  constructor() { this.on = 0; this.x = 0; this.z = 0; this.yaw = 0; this.mode = 0; this.catchT = -1; this.fx = 0; this.fz = 0; this.fy = 0; }
}

/** Foot lock diagnostics (slide since the lock was taken). */
class LockDiag {
  constructor(s) { this.side = s === 0 ? 'R' : 'L'; this.locked = false; this.slide = 0; this.max = 0; this.lx = 0; this.ly = 0; this.lz = 0; }
}

/** The layered animator of one player (module header). */
export class Animator {
  /**
   * @param {object} rig buildRig(header.players[i], header.bones)
   * @param {object|null} character WP2 Character (object, bones / skeleton, morph, morphIndex, eyeOffset, visible) or null
   * @param {object} opts { id, owner, rng (cosmetic Rng: next() → [0, 1)), tier ('high'|'medium'|'low') }
   */
  constructor(rig, character, opts = {}) {
    this.rig = rig;
    this.ch = character || null;
    this.id = opts.id || rig.id || (character && character.id) || 'kobe';
    if (!STYLE[this.id]) throw new Error(`Animator: unknown player '${this.id}'`);
    this.owner = opts.owner || null;
    this.rng = opts.rng || null;
    this.sLeg = rig.metrics.sLeg;
    this.tempo = STYLE[this.id].tempo;
    this.time = 0; this.stepN = 0; this.stepCalls = 0;
    this.external = false;
    this.events = new EventRing(32);
    this.cosRing = new EventRing(32);
    this.slots = [new Layer(0), new Layer(1), new Layer(2)];
    this.root = new RootMotion();
    this.motion = { active: false, vx: 0, vz: 0, dyaw: 0, exit: false, exitVx: 0, exitVz: 0 };
    this.ballMode = BM.FREE; this.ballHand = HAND.R;
    this.pendingBall = 0;             // ball mode waiting for the dribble pickup
    this.dribHand = 0;                // hand of a move clip's handOn (cosmetic combos do not change ballHand)
    this.readyAt = -1;
    // root used without an owner (setRoot / walkTo / viewer) and the render root
    this.x = 0; this.z = 0; this.yaw = 0; this.vx = 0; this.vz = 0;
    this.rx = 0; this.rz = 0; this.ryaw = 0; this.yawOverride = null;
    this.walk = { active: false, x: 0, z: 0, yaw: 0, speed: 0, acc: 0 };
    // jump (internal ballistic when the owner has no jumpY)
    this.jumpY = 0; this.jumpYPrev = 0; this.jumpH = 0; this.jumpAir = 0; this.jumpStart = -1; this.jumpArmed = false;
    this.landVy = 0; this.jSlam = -1; this.jHang = 0; this.jG = G;
    // poses: base, action, upper, additive scratch, last layered, snapshot (six, [ANIM §2.9])
    this.pBase = new Pose(); this.pAct = new Pose(); this.pUp = new Pose(); this.pAdd = new Pose();
    this.pLast = new Pose(); this.pSnap = new Pose();
    this.snapK = 0; this.snapDur = 0.2; this.snapAge = 0; this.snapAgePrev = 0;
    this.xfL = new Float64Array(BONE_COUNT * 4); this.xfT = new Float64Array(BONE_COUNT * 3);
    this.xfOn = false; this.xfAge = 0; this.xfAgePrev = 0; this.xfDur = 0.20;
    this.hasLast = false;
    // skeletons: render and step-query
    this.sk = new Skel(rig); this.skQ = new Skel(rig);
    this.qStep = -1; this.qValid = new Uint8Array(BONE_COUNT); this.qStack = new Int8Array(BONE_COUNT);
    // procedural systems
    this.gait = new Gait(rig, this.id);
    this.drib = new Dribble(rig, this.id);
    this.look = new LookAt();
    this.gaitIn = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, onDefence: false, stance: 0, airborne: false, stamina: 1, rng: null };
    this.dribIn = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, gaitPhi: 0, gaitMoving: false, cadence: 0, protect: false, post: false };
    this.ctx = { onDefence: false, stance: 'auto', protect: false, post: false, drive: false, stamina: 1 };
    this.dribW = 0; this.holdW = 0;
    // feet
    this.ft = [new FootTarget(), new FootTarget()]; this.ft2 = new FootTarget(); this.dropPrev = 0;
    this.cfoot = [new ClipFoot(), new ClipFoot()];
    this.diag = [new LockDiag(0), new LockDiag(1)];
    this.catchUpReq = 0;
    // hands / ball (render)
    this.rBall = new Float64Array(3);      // rendered ball centre (char frame) of the last evaluate
    this.rBallW = new Float64Array(3);     // same, world
    this.rBallOn = false;
    this.gripW = new Float64Array(2);
    this.catchP = new Float64Array(4); this.catchT = -1;
    this.slamP = new Float64Array(3); this.slamSet = false;
    this.contactP = new Float64Array(3); this.contactT = -1; this.contactKind = 0; this.contactSide = 0;
    this.dunkW = 0;
    this.launch = { x: 0, y: 0, z: 0 }; this.launchStep = -10;
    // additive state (fixed step)
    this.leanP = 0; this.leanPv = 0; this.leanR = 0; this.leanRv = 0; this.leanW = 1;
    this.breathPh = 0; this.breathPhPrev = 0; this.deepT = 0;
    this.landT = -1; this.landA = 0;
    this.aim = 0; this.aimW = 0;
    // look-at
    this.lookPts = new Float64Array(LOOK_POINTS * 4);   // per LOOK code: x, y, z, set
    this.lookTx = 0; this.lookTy = 0; this.lookTz = 0; this.lookW = 0; this.lookOn = false;
    this.lookPts[LOOK.rim * 4] = RIM_POS.x; this.lookPts[LOOK.rim * 4 + 1] = RIM_POS.y; this.lookPts[LOOK.rim * 4 + 2] = RIM_POS.z; this.lookPts[LOOK.rim * 4 + 3] = 1;
    // face
    this.face = new Float32Array(9); this.faceSet = new Float32Array(9); this.faceRule = new Float32Array(9);
    this.faceClip = new Float32Array(9);
    this.blinkNext = 3.0; this.blinkT = -1;
    this.ruleUntil = new Float64Array(9);
    this.morphIdx = new Int16Array(9).fill(-1);
    this.comboT = 0; this.combo = -1;
    // detail / throttles
    this.detail = { fingers: true, footIK: true, handIK: true, look: true, eyes: true, breathing: true, expressions: true, halfRate: false };
    if (opts.tier && DETAIL_TIERS[opts.tier]) this.setDetail(DETAIL_TIERS[opts.tier]);
    this.frameN = 0;
    this.stats = { cpuMs: 0, bonesUpdated: 0, evals: 0 };
    // bones of the character
    this.bones = null;
    if (this.ch) this.bindCharacter(this.ch);
  }

  // =================================================================================================== character
  /** Resolves the 53 bones (array by header index, by name, or skeleton.bones), morph channels and eye uniform. */
  bindCharacter(c) {
    const out = new Array(BONE_COUNT).fill(null);
    for (let i = 0; i < BONE_COUNT; i++) {
      const n = BONE_NAMES[i];
      let b = null;
      if (c.bones) {
        if (Array.isArray(c.bones)) b = typeof c.boneIndex === 'function' ? c.bones[c.boneIndex(n)] : c.bones[i];
        else b = c.bones[n] || null;
      }
      if (!b && c.skeleton && c.skeleton.bones) { const sb = c.skeleton.bones; b = sb[i] && sb[i].name === n ? sb[i] : sb.find((x) => x.name === n) || null; }
      if (!b) throw new Error(`Animator: character has no bone '${n}'`);
      b.matrixAutoUpdate = false;
      out[i] = b;
    }
    this.bones = out;
    const dict = c.morphIndex || (c.body && c.body.morphTargetDictionary) || null;
    for (let k = 0; k < 9; k++) {
      const name = ['jawOpen', 'tongueOut', 'jawJut', 'roar', 'grin', 'smirk', 'scowl', 'puff', 'blink'][k];
      this.morphIdx[k] = dict && dict[name] !== undefined ? dict[name] : -1;
    }
  }

  // =================================================================================================== state
  get action() { return this.slots[0].state === 1 && this.slots[0].clock.active ? this.slots[0].idx : -1; }
  get actionTime() { return this.slots[0].clock.t; }
  get actionClip() { return this.slots[0].state === 1 && this.slots[0].clock.active ? this.slots[0].src : null; }
  get upper() { return this.slots[1].state === 1 && this.slots[1].clock.active ? this.slots[1].idx : -1; }
  get airborne() { const c = this.slots[0].clock; return c.active && c.takeoffG >= 0 && c.inAir(c.t); }
  /** Gait cycle phase (left strike at 0). */
  get phase() { return this.gait.phi; }
  /** Layer weights of the last evaluate [action, upper, add]. */
  get layerWeights() { _lw[0] = this.slots[0].w; _lw[1] = this.slots[1].w; _lw[2] = this.slots[2].w; return _lw; }

  /** Root transform when no owner is attached. */
  setRoot(x, z, yaw, vx = 0, vz = 0) { this.x = x; this.z = z; this.yaw = yaw; this.vx = vx; this.vz = vz; }
  rootX() { return this.owner ? this.owner.pos.x : this.x; }
  rootZ() { return this.owner ? this.owner.pos.z : this.z; }
  rootYaw() { return this.owner ? this.owner.yaw : this.yaw; }
  rootVx() { return this.owner ? (this.owner.vel ? this.owner.vel.x : 0) : this.vx; }
  rootVz() { return this.owner ? (this.owner.vel ? this.owner.vel.z : 0) : this.vz; }
  curJumpY() { return this.owner && typeof this.owner.jumpY === 'number' ? this.owner.jumpY : this.jumpY; }

  /** Per-tier detail flags (DETAIL_TIERS.*) merged into this.detail. */
  setDetail(f) { for (const k in f) this.detail[k] = f[k]; }

  // =================================================================================================== play / stop
  /**
   * Starts clip clipIdx on a layer (spec §1.4). Returns true when started and any target fits the matching limits.
   * The real compiled clip is used when registered (WP3c data), else select.js' catalog timing clip (no bone tracks:
   * the base layer shows through, timing / events / root motion stay exact).
   */
  play(clipIdx, opts) {
    const o = opts || EMPTY;
    const mirror = !!o.mirror;
    const src = timingClip(clipIdx, this.id, mirror);
    if (!src) return false;
    let li = o.layer ? LAYER[o.layer] : (src.timing.layer === 'upper' ? 1 : src.timing.layer === 'add' ? 2 : 0);
    if (li === undefined) li = 0;
    const L = this.slots[li];
    if (li === 0 && this.combo >= 0 && !o.cosmetic) this.combo = -1;
    // interruption: snapshot the last layered pose with the old layer's per-bone weights (fade from it, no pop)
    if (li < 2 && L.state !== 0 && this.hasLast) this.takeSnapshot(L, o.blendIn !== undefined ? o.blendIn : src.timing.blendIn);
    L.idx = clipIdx; L.src = src; L.mirror = mirror; L.lastBall = 0;
    L.cat = CAT_CODE[catOf(clipIdx)] || C_OTHER;
    L.state = 1; L.age = 0; L.agePrev = 0; L.frozen = false; L.cosmetic = !!o.cosmetic; L.inPlace = !!o.inPlace;
    L.fadeIn = o.blendIn !== undefined ? o.blendIn : src.timing.blendIn;
    L.fadeOut = src.timing.blendOut;
    L.mask = li === 1 && src.mask === MASK.full ? MASK.upper : src.mask;
    L.start = this.time;
    L.x0 = this.rootX(); L.z0 = this.rootZ(); L.yaw0 = this.rootYaw();
    L.gather = -1; L.land = -1; L.slamAt = -1; L.takeoffAt = -1;
    L.clock.start(src, o.rate || 1, this.tempo, o.warp || null);
    let fits = true;
    if (li === 0) {
      fits = this.root.begin(src, this.sLeg, L.x0, L.z0, L.yaw0, this.rootVx(), this.rootVz(), o.target || null);
      if (L.inPlace) this.root.active = false;
      this.motion.active = this.root.active; this.motion.vx = 0; this.motion.vz = 0; this.motion.dyaw = 0; this.motion.exit = false;
      this.jumpArmed = false;
      this.cfoot[0].on = 0; this.cfoot[1].on = 0; this.cfoot[0].catchT = -1; this.cfoot[1].catchT = -1;
      this.contactT = -1; this.catchT = -1;
    }
    return fits;
  }

  /**
   * Snapshot of the last layered pose for an interrupted fade: per-bone weights = the old layer's last effective
   * weights (max with what is left of a still-fading earlier snapshot), so untouched bones keep animating.
   */
  takeSnapshot(L, dur) {
    const prev = this.snapK > 0 ? 1 - smooth(this.snapAge / this.snapDur) : 0;
    for (let b = 0; b < BONE_COUNT; b++) _snapOld[b] = this.pSnap.w[b] * prev;
    const prevPel = this.pSnap.pelW * prev;
    const lw = L.w, mw = MASK_W[L.mask], pw = L.li === 0 ? this.pAct.w : this.pUp.w;
    copyPose(this.pSnap, this.pLast);
    for (let b = 0; b < BONE_COUNT; b++) {
      const k = lw * mw[b] * pw[b];
      this.pSnap.w[b] = k > _snapOld[b] ? k : _snapOld[b];
    }
    const kp = L.li === 0 ? lw * mw[0] * this.pAct.pelW : 0;
    this.pSnap.pelW = kp > prevPel ? kp : prevPel;
    this.snapK = 1; this.snapAge = 0; this.snapAgePrev = 0; this.snapDur = dur > 0.01 ? dur : 0.06;
  }

  /**
   * Full-pose crossfade from the current rendered pose over `seconds` (CHECK formation, rematch, teleport; R#37): the
   * final bone-local rotations and pelvis of the last frame (after IK and look-at) are blended into the new ones with a
   * smoothstep, so feet re-planted by the gait and IK targets never snap.
   */
  crossfade(seconds = 0.20) {
    if (!this.hasLast) return;
    this.xfL.set(this.sk.L); this.xfT.set(this.sk.T);
    this.xfAge = 0; this.xfAgePrev = 0; this.xfDur = seconds > 0.01 ? seconds : 0.20; this.xfOn = true;
  }

  /** Shot release input (spec §4.9.1): the guide hand leaves now (both → shooting hand); see ClipClock.releaseNow. */
  releaseNow() {
    const r = this.slots[0].clock.releaseNow();
    if (r && this.ballMode === BM.BOTH && this.slots[0].clock.tm && this.slots[0].clock.tm.hold) {
      this.ballMode = this.slots[0].mirror ? BM.L : BM.R;
      this.ballHand = this.slots[0].mirror ? HAND.L : HAND.R;
    }
    return r;
  }

  /** Gameplay ballistic parameters of the action's air segment; profile {slam, hang} for dunks. */
  setJump(h, airT, profile) {
    this.slots[0].clock.setJump(h, airT, profile);
    this.jumpH = h; this.jumpAir = airT; this.jumpArmed = true;
    // internal profile (used only without an owner jumpY): plain ballistic, or the dunk rise–hang–drop of spec
    // §4.9.4 (apex at slam + 0.03, jumpY eases h → h − 0.05 during the hang, free fall after it)
    this.jSlam = profile && profile.slam > 0 ? profile.slam : -1;
    this.jHang = profile && profile.hang > 0 ? profile.hang : 0;
    if (this.jSlam > 0) {
      const tUp = this.jSlam + 0.03;
      this.jG = 2 * h / (tUp * tUp);
      this.landVy = Math.sqrt(2 * this.jG * Math.max(0, h - (this.jHang > 0 ? 0.05 : 0)));
    } else this.landVy = airT > 0 ? 4 * h / airT : 0;    // vy at landing (symmetric ballistic arc)
    const c = this.slots[0].clock;
    if (c.takeoffG >= 0 && this.jumpStart < 0) this.jumpStart = this.slots[0].start + c.takeoffG;
  }

  /** Internal jumpY at tau seconds after takeoff (ballistic, or the dunk rise–hang–drop profile). */
  jumpAt(tau) {
    const h = this.jumpH;
    if (this.jSlam > 0) {
      const g = this.jG, tUp = this.jSlam + 0.03, vy = g * tUp;
      if (tau <= tUp) return vy * tau - 0.5 * g * tau * tau;
      const top = this.jHang > 0 ? h - 0.05 : h;
      if (tau <= tUp + this.jHang) return h + (top - h) * smooth((tau - tUp) / this.jHang);
      const d = tau - tUp - this.jHang, y = top - 0.5 * g * d * d;
      return y > 0 ? y : 0;
    }
    const T = this.jumpAir, gp = 8 * h / (T * T), vy = 4 * h / T;
    const y = vy * tau - 0.5 * gp * tau * tau;
    return y > 0 ? y : 0;
  }

  /** Ends the action layer (fade back to the base over blendOut, default the clip's blendOut). */
  stopAction(blendOut) { this.fadeOutLayer(this.slots[0], blendOut); }
  /** Ends the upper layer. */
  stopUpper(blendOut) { this.fadeOutLayer(this.slots[1], blendOut); }

  fadeOutLayer(L, blendOut) {
    if (L.state !== 1) return;
    L.frozenT = L.clock.t;
    L.clock.stop();
    L.state = 2; L.outAge = 0; L.outAgePrev = 0;
    if (typeof blendOut === 'number') L.fadeOut = blendOut;
    if (L.li === 0) {
      this.root.active = false;
      this.motion.active = false; this.motion.vx = 0; this.motion.vz = 0; this.motion.dyaw = 0;
      this.replantFromAction();
    }
  }

  /** Ball caught: mode 'held'|'both'|'dribble'|'drib'|'R'|'L' or a BM code. Emits CATCH now and READY at +0.30 s. */
  onCatch(mode) {
    this.setBallMode(mode === undefined ? BM.BOTH : mode);
    this.events.push(EV.CATCH, this.time, 0, -1, 0);
    this.readyAt = this.time + 0.30;
    this.catchT = -1;
  }

  /** Sets the ball attachment directly (gameplay: start / stop a dribble, free the ball). */
  setBallMode(mode, hand) {
    let bm = mode;
    if (typeof mode === 'string') {
      bm = mode === 'held' || mode === 'both' ? BM.BOTH : mode === 'dribble' || mode === 'drib' ? BM.DRIB
        : mode === 'R' ? BM.R : mode === 'L' ? BM.L : mode === 'path' ? BM.PATH : mode === 'free' ? BM.FREE : BM.BOTH;
    }
    if (hand === 'L' || hand === HAND.L) this.ballHand = HAND.L; else if (hand === 'R' || hand === HAND.R) this.ballHand = HAND.R;
    if (bm === BM.R) this.ballHand = HAND.R; else if (bm === BM.L) this.ballHand = HAND.L;
    if (bm === BM.DRIB && this.ballMode !== BM.DRIB) this.startDribble(0);
    if (bm !== BM.DRIB && this.drib.active) this.drib.stop();
    this.ballMode = bm; this.pendingBall = 0;
  }

  /** Starts the dribble from the current ball position (psi0 0 = release now, 0.80 = ball in the hand). */
  startDribble(psi0) {
    const hand = this.dribHand || this.ballHand;
    this.querySocket(hand === HAND.L ? SOCK.ball1_l : SOCK.ball1_r, _o3);
    this.drib.start(hand, _o3.x, _o3.y, _o3.z, this.rootX(), this.rootZ(), this.rootYaw(), psi0);
    this.dribHand = 0;
  }

  applyClipBall(L, bm) {
    const b = bm;                       // mirrored clips are compiled from mirrorDef (B 'R' ↔ 'L' already swapped)
    if (L.cosmetic && b !== BM.DRIB && b !== BM.PATH) return;
    if (this.drib.active && b !== BM.DRIB && b !== BM.PATH && b !== BM.FREE) {
      // the action's body starts now, the ball joins at the next hand contact (≤ 0.12 s)
      this.pendingBall = b; this.drib.requestPickup(); return;
    }
    if (b === BM.DRIB) {
      if (this.ballMode !== BM.DRIB) { this.ballMode = BM.DRIB; this.startDribble(0.80); }
      return;
    }
    if (b !== BM.PATH && this.drib.active) this.drib.stop();
    this.ballMode = b;
    if (b === BM.R) this.ballHand = HAND.R; else if (b === BM.L) this.ballHand = HAND.L;
  }

  // =================================================================================================== fixed step
  /** Advances every layer by dt (fixed step): events, ball mode, root motion, jump, gait, dribble, cosmetics. */
  step(dt) {
    this.stepCalls++;
    const ev = this.events;
    const h0 = ev.head;
    this.motion.exit = false;
    if (!this.root.active) { this.motion.active = false; this.motion.vx = 0; this.motion.vz = 0; this.motion.dyaw = 0; }
    const x = this.rootX(), z = this.rootZ(), yaw = this.rootYaw(), vx = this.rootVx(), vz = this.rootVz();
    // teleport (> 1.5 m in one step): crossfade 0.20 s, gait re-plant + settle (handled by Gait.update)
    if (this.stepN > 0 && Math.hypot(x - this.gait.x, z - this.gait.z) > 1.5) { this.crossfade(0.20); this.look.reset(); }
    for (let li = 0; li < 3; li++) {
      const L = this.slots[li];
      if (L.state === 2) {
        L.outAgePrev = L.outAge; L.outAge += dt;
        if (L.outAge >= L.fadeOut) { L.state = 0; L.w = 0; }
        continue;
      }
      if (L.state !== 1) continue;
      L.agePrev = L.age; L.age += dt;
      if (L.frozen) continue;
      const c = L.clock;
      if (!c.active) continue;
      const tOld = c.t, wasActive = c.active;
      // cosmetic clips (Kyrie's idle combos) report into a private ring: gameplay never sees their events
      const ring = L.cosmetic ? this.cosRing : ev;
      const e0 = ring.head;
      c.step(dt, this.time, ring, L.idx, li);
      const tNew = c.t;
      for (let i = e0; i < ring.head; i++) {
        const r = ring.buf[i % ring.size];
        if (L.cosmetic && r.code === EV.BOUNCE) ev.push(EV.BOUNCE, r.t, r.param, -1, li);   // still audible
        if (r.code === EV.GATHER) L.gather = r.t; else if (r.code === EV.LAND) L.land = r.t;
        else if (r.code === EV.SLAM) L.slamAt = r.t; else if (r.code === EV.TAKEOFF) L.takeoffAt = r.t;
        // the dribble hand must be known before this step's ball-mode change (a move's handOn + B 'drib' key)
        else if (r.code === EV.HAND_ON && (r.param === HAND.R || r.param === HAND.L)) { if (!L.cosmetic) this.ballHand = r.param; this.drib.setHand(r.param); this.dribHand = r.param; }
        else if (r.code === EV.HANDOFF && !L.cosmetic) this.ballHand = this.ballHand === HAND.R ? HAND.L : HAND.R;
      }
      const bm = sampleBall(L.src, tNew);
      if (bm !== 0 && bm !== L.lastBall) { L.lastBall = bm; this.applyClipBall(L, bm); }
      if (li === 0) {
        if (this.root.active) {
          this.root.step(tOld, tNew, dt, this.time + dt - L.start, c.takeoffG >= 0 && c.inAir(tNew), c.takeoffG);
          this.motion.active = c.active || wasActive;
          this.motion.vx = this.root.vx; this.motion.vz = this.root.vz; this.motion.dyaw = this.root.dyaw;
          if (!c.active) {
            this.motion.active = false;
            if (this.root.hasExit) { this.motion.exit = true; this.motion.exitVx = this.root.exitVx; this.motion.exitVz = this.root.exitVz; }
            this.root.active = false;
          }
        }
        if (c.takeoffG >= 0 && this.jumpArmed && this.jumpStart < 0) this.jumpStart = L.start + c.takeoffG;
      }
      if (L.cosmetic) ring.clear();
      if (!c.active) {
        // natural end: hold the last frame and fade out (celebrations 0.30 s, moves 0.12 s, … via the clip's blendOut)
        L.frozenT = L.src.dur; L.state = 2; L.outAge = 0; L.outAgePrev = 0;
        if (li === 0) this.replantFromAction();
        if (li === 0 && this.combo >= 0) this.nextCombo();
      }
    }
    // events emitted this step that change the animator's own state
    for (let i = h0; i < ev.head; i++) {
      const r = ev.buf[i % ev.size];
      switch (r.code) {
        case EV.RELEASE: case EV.SLAM:
          if (r.layer < 2 && this.ballMode !== BM.FREE) {
            // the launch point: the socket at this step (gameplay calls ball.launch from exactly here, spec §4.5)
            this.querySocket(SOCK.ball, this.launch);
            this.launchStep = this.stepN;
            this.ballMode = BM.FREE; if (this.drib.active) this.drib.stop();
          }
          if (r.code === EV.SLAM) this.ruleFace(E_ROAR, this.id === 'yao' ? 0.9 : (this.id === 'lebron' || this.id === 'giannis') ? 1.0 : 0, this.id === 'yao' ? 1.0 : 0.9);
          break;
        case EV.LAND:
          if (r.layer === 0) { this.landT = 0; this.landA = clamp(8 * Math.abs(this.landVy || 2.5), 20, 60); }
          break;
        case EV.TAKEOFF:
          if (r.layer === 0 && this.slots[0].cat === C_DUNK && (this.id === 'lebron' || this.id === 'giannis')) this.ruleFace(E_ROAR, 0.4, 2.0);
          break;
        default: break;
      }
    }
    if (this.readyAt >= 0 && this.time + dt >= this.readyAt) { ev.push(EV.READY, this.readyAt, 0, -1, 0); this.readyAt = -1; }
    // internal ballistic jumpY (only without an owner jumpY): vy = 4h/T, g' = 8h/T² so the airtime is T
    this.jumpYPrev = this.curJumpY();
    if (this.jumpStart >= 0 && this.jumpAir > 0) {
      const tau = this.time + dt - this.jumpStart;
      if (tau >= this.jumpAir) { this.jumpY = 0; this.jumpStart = -1; this.jumpArmed = false; }
      else if (tau > 0) this.jumpY = this.jumpAt(tau);
    }
    // ---- gait ----
    const gi = this.gaitIn;
    gi.x = x; gi.z = z; gi.vx = vx; gi.vz = vz; gi.yaw = yaw;
    const ctx = this.ctx;
    gi.onDefence = !!ctx.onDefence;
    gi.stance = this.stanceCode();
    gi.airborne = this.curJumpY() > 0.02;
    gi.stamina = this.owner && typeof this.owner.stamina === 'number' ? this.owner.stamina : ctx.stamina;
    gi.rng = this.rng;
    if (this.catchUpReq) { for (let s = 0; s < 2; s++) if (this.catchUpReq & (1 << s)) this.gait.catchUp(s); this.catchUpReq = 0; }
    this.gait.update(dt, gi);
    if (this.gait.plantEv) {
      if (this.gait.plantEv & 1) ev.push(EV.PLANT_R, this.time + dt, this.gait.plantKind, -1, 0);
      if (this.gait.plantEv & 2) ev.push(EV.PLANT_L, this.time + dt, this.gait.plantKind, -1, 0);
    }
    // ---- dribble ----
    if (this.drib.active) {
      const di = this.dribIn;
      di.x = x; di.z = z; di.vx = vx; di.vz = vz; di.yaw = yaw;
      // the gait phase at the start of this step (the dribble phase it is compared with is also start-of-step)
      di.gaitPhi = this.gait.phiPrev; di.gaitMoving = this.gait.mode === GAIT.MOVE; di.cadence = 2 * this.gait.rate;
      di.protect = !!ctx.protect; di.post = !!ctx.post;
      this.drib.update(dt, di);
      if (this.drib.bounced) ev.push(EV.BOUNCE, this.time + this.drib.bounceDt, 0, -1, 0);
      if (this.drib.picked) {
        this.drib.stop();
        ev.push(EV.PICKUP, this.time + dt, 0, -1, 0);
        if (this.pendingBall) {
          const b = this.pendingBall; this.pendingBall = 0;
          this.ballMode = b;
          if (b === BM.R) this.ballHand = HAND.R; else if (b === BM.L) this.ballHand = HAND.L;
        } else this.ballMode = BM.BOTH;
      }
    }
    // ---- additive / cosmetic state (fixed step) ----
    this.stepLean(dt, vx, vz, yaw);
    const sta = gi.stamina;
    this.breathPhPrev = this.breathPh;
    this.breathPh += dt * (0.25 + 0.30 * (1 - sta));
    if (this.deepT > 0) this.deepT -= dt;
    if (this.landT >= 0) { this.landT += dt; if (this.landT > 0.40) this.landT = -1; }
    const aimTarget = (this.slots[0].state === 1 && this.slots[0].cat === C_PASS) || (this.slots[1].state === 1 && this.slots[1].cat === C_PASS) ? 1 : 0;
    this.aimW += clamp(aimTarget - this.aimW, -dt / 0.10, dt / 0.10);
    if (this.contactT >= 0) { this.contactT += dt; if (this.contactT > 0.45) this.contactT = -1; }
    if (this.catchT >= 0) this.catchT -= dt;
    this.look.step(dt, this.rng, this.gait.mode === GAIT.IDLE && this.slots[0].state === 0);
    this.stepFace(dt, Math.hypot(vx, vz), sta);
    this.stepCombo(dt, Math.hypot(vx, vz));
    if (this.snapK > 0) { this.snapAgePrev = this.snapAge; this.snapAge += dt; if (this.snapAgePrev >= this.snapDur) this.snapK = 0; }
    if (this.xfOn) { this.xfAgePrev = this.xfAge; this.xfAge += dt; if (this.xfAgePrev >= this.xfDur) this.xfOn = false; }
    this.time += dt;
    this.stepN++;
  }

  /** Stance code from ctx.stance ('auto' = def on defence, tripleThreat with the ball held, else stand). */
  stanceCode() {
    const s = this.ctx.stance;
    if (s && s !== 'auto') { const c = STANCE_CODE[s]; return c === undefined ? 0 : c; }
    if (this.ctx.onDefence) return STANCE_CODE.def;
    if (this.ballMode === BM.BOTH) return STANCE_CODE.tripleThreat;
    return STANCE_CODE.stand;
  }

  /** Lean ([ANIM §2.6.1]): aF = accel·forward, aC = speed·yawRate → spring ω 8 toward the clamped targets. */
  stepLean(dt, vx, vz, yaw) {
    const g = this.gait;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const aF = g.ax * fx + g.az * fz;
    const aC = Math.hypot(vx, vz) * g.yawRate;
    const tp = clamp(1.6 * aF, -8, 12), tr = clamp(1.3 * aC, -14, 14);
    const w = 8;
    let a = w * w * (tp - this.leanP) - 2 * w * this.leanPv; this.leanPv += a * dt; this.leanP += this.leanPv * dt;
    a = w * w * (tr - this.leanR) - 2 * w * this.leanRv; this.leanRv += a * dt; this.leanR += this.leanRv * dt;
    const L = this.slots[0];
    const off = L.state === 1 && (L.src.timing.hasJump || L.cat === C_CEL) ? 0 : 1;
    this.leanW += clamp(off - this.leanW, -dt / 0.1, dt / 0.1);
  }

  /** A mannerism rule: channel ch to weight w for `dur` seconds (max-combined). */
  ruleFace(ch, w, dur) {
    if (w <= 0) return;
    if (w >= this.faceRule[ch] || this.ruleUntil[ch] < this.time) { this.faceRule[ch] = w; this.ruleUntil[ch] = this.time + dur; }
  }

  /** Face rules of spec §4.11 / [ANIM §8.1] that are tied to play, blink schedule (cosmetic RNG in the step). */
  stepFace(dt, speed, stamina) {
    for (let k = 0; k < 9; k++) if (this.ruleUntil[k] < this.time) this.faceRule[k] = 0;
    const L = this.slots[0];
    const playing = L.state === 1;
    // Jordan: tongue out from GATHER to LAND + 0.10 on any layup / dunk clip; on drives (ctx.drive)
    if (this.id === 'jordan') {
      if (playing && (L.cat === C_LAYUP || L.cat === C_DUNK) && (L.gather >= 0 || L.src.timing.gather < 0)) this.ruleFace(E_TONGUE, 1, L.land >= 0 ? Math.max(0, L.land + 0.10 - this.time) : 0.2);
      if (this.ctx.drive) this.ruleFace(E_TONGUE, 1, 0.05);
    }
    // all: effort (sprint at stamina < 0.4, rebounds, blocks) jawOpen 0.25–0.5
    if (speed > 5.8 && stamina < 0.4) this.ruleFace(E_JAW, 0.35, 0.05);
    if (playing && (L.cat === C_REB || L.cat === C_BLOCK)) this.ruleFace(E_JAW, 0.4, 0.05);
    // blink every 2.5 + 3.0·rng s, 0.12 s (attack 0.05 to 1, then release)
    this.blinkNext -= dt;
    if (this.blinkNext <= 0) {
      const r = this.rng ? this.rng.next() : 0.5;
      this.blinkNext = 2.5 + 3.0 * r;
      if (this.face[E_ROAR] <= 0.5 && this.face[E_GRIN] <= 0.5) this.blinkT = 0;
    }
    if (this.blinkT >= 0) { this.blinkT += dt; if (this.blinkT > 0.12) this.blinkT = -1; }
  }

  /** Kyrie's idle combos (cosmetic, in place): live dribble, speed < 0.5 for > 0.8 s, no action → btl, cross, btl_L, cross_L. */
  stepCombo(dt, speed) {
    if (this.id !== 'kyrie') return;
    if (this.combo >= 0 && (speed >= 0.5 || this.ballMode !== BM.DRIB && this.ballMode !== BM.PATH)) {
      // cancelled in 0.06 s; the ball returns to the gameplay hand at the next release (ballHand keeps its sign)
      this.combo = -1; this.stopAction(0.06); this.drib.setHand(this.ballHand); return;
    }
    if (this.combo >= 0) return;
    if (this.ballMode === BM.DRIB && speed < 0.5 && this.slots[0].state === 0) this.comboT += dt; else this.comboT = 0;
    if (this.comboT > 0.8 && hasMoveClips()) { this.combo = 0; this.comboT = 0; this.playCombo(); }
  }
  comboOn() { return this.combo >= 0; }
  /** btl, cross, btl, cross — each authored right → left, mirrored when the ball is in the left hand. */
  playCombo() {
    const k = this.combo & 3;
    const idx = k === 0 || k === 2 ? COMBO.btl : COMBO.cross;
    const left = this.drib.active ? this.drib.hand === 2 : this.dribHand === HAND.L;
    this.play(idx, { mirror: left, cosmetic: true, inPlace: true, blendIn: 0.06 });
  }
  nextCombo() { this.combo++; if (this.combo > 3) this.combo = 0; this.playCombo(); }

  // =================================================================================================== step pose / sockets
  /** Builds the pose at the current step time into skQ (locals only; FK lazily per chain). */
  buildStepPose() {
    this.qStep = this.stepN;
    this.qValid.fill(0);
    const pose = this.pBase;
    this.gait.writePose(pose, 1);
    this.overlays(pose, 1, 1 / 60, true);
    for (let li = 0; li < 2; li++) {
      const L = this.slots[li];
      if (L.state === 0) continue;
      const pl = li === 0 ? this.pAct : this.pUp;
      sampleClip(L.src, L.state === 1 ? L.clock.t : L.frozenT, pl, SAMPLE_AIR_LINEAR);
      const w = L.state === 1 ? easeOut3(L.fadeIn > 1e-6 ? L.age / L.fadeIn : 1) : 1 - smooth(L.outAge / L.fadeOut);
      blendPose(pose, pose, pl, w, MASK_W[L.mask]);
    }
    const sk = this.skQ;
    for (let b = 0; b < BONE_COUNT; b++) toLocal(this.rig, b, pose.q, sk.L, b * 4, b * 4);
    this.pelvisLocal(sk, pose, this.curJumpY());
  }

  /** Pelvis local translation = rest + pel·sLeg + (0, jumpY, 0) (Root and others at rest). */
  pelvisLocal(sk, pose, jy) {
    const rp = this.rig.restPos, s = this.sLeg, p = BONE.pelvis;
    for (let b = 0; b < BONE_COUNT; b++) { sk.T[b * 3] = rp[b * 3]; sk.T[b * 3 + 1] = rp[b * 3 + 1]; sk.T[b * 3 + 2] = rp[b * 3 + 2]; }
    sk.T[p * 3] += pose.pel[0] * s; sk.T[p * 3 + 1] += pose.pel[1] * s + jy; sk.T[p * 3 + 2] += pose.pel[2] * s;
  }

  /** FK of bone b in skQ along its (not yet valid) ancestors. */
  ensureQ(b) {
    const v = this.qValid, st = this.qStack;
    let n = 0;
    for (let i = b; i >= 0 && !v[i]; i = BONE_PARENT[i]) st[n++] = i;
    for (let k = n - 1; k >= 0; k--) { this.skQ.fkBone(st[k]); v[st[k]] = 1; }
  }

  /**
   * World position of socket sockIdx (SOCK.*) at the current step (FK of the socket chain only, spec §4.4); `ball`
   * (SOCK.ball) = the current ball centre by ball mode. out = {x, y, z} (THREE.Vector3 or plain). Returns out.
   */
  querySocket(sockIdx, out) {
    if (this.qStep !== this.stepN) this.buildStepPose();
    const sk = this.skQ;
    if (sockIdx === SOCK.ball) {
      if (this.ballMode === BM.FREE && this.launchStep === this.stepN - 1) { out.x = this.launch.x; out.y = this.launch.y; out.z = this.launch.z; return out; }
      if (this.ballMode === BM.DRIB && this.drib.active) { out.x = this.drib.pos[0]; out.y = this.drib.pos[1]; out.z = this.drib.pos[2]; return out; }
      if (this.ballMode === BM.PATH && this.slots[0].state !== 0 && this.slots[0].src.hasBp) { this.pathBall(this.slots[0], this.slots[0].state === 1 ? this.slots[0].clock.t : this.slots[0].frozenT, out); return out; }
      if (this.ballMode === BM.BOTH) {
        this.chainSock(SOCK.ball1_r, _q3, 0); this.chainSock(SOCK.ball1_l, _q3, 3);
        _q3[0] = 0.5 * (_q3[0] + _q3[3]); _q3[1] = 0.5 * (_q3[1] + _q3[4]); _q3[2] = 0.5 * (_q3[2] + _q3[5]);
      } else this.chainSock(this.ballMode === BM.L || (this.ballMode !== BM.R && this.ballHand === HAND.L) ? SOCK.ball1_l : SOCK.ball1_r, _q3, 0);
      this.toWorld(_q3, this.rootX(), this.rootZ(), this.rootYaw(), out);
      // dunk: the last 0.15 s before SLAM the ball is driven to the slam point (same weight as the render IK)
      const L0 = this.slots[0];
      if (L0.state === 1 && L0.cat === C_DUNK && L0.src.timing.slam > 0) {
        const toSlam = L0.clock.t >= L0.src.timing.slam - 1e-9 ? 0 : L0.clock.estimateTo(L0.src.timing.slam);
        if (toSlam < 0.15) {
          const w = slamRamp(toSlam);
          const rx = this.rx, rz = this.rz;
          this.rx = this.rootX(); this.rz = this.rootZ();
          this.slamPoint(_w3);
          this.rx = rx; this.rz = rz;
          out.x += (_w3[0] - out.x) * w; out.y += (_w3[1] - out.y) * w; out.z += (_w3[2] - out.z) * w;
        }
      }
      return out;
    }
    // planted feet: the lock target (the IK puts the foot there)
    for (let s = 0; s < 2; s++) {
      const fs = FOOT_SOCKS[s];
      if (sockIdx !== fs[0] && sockIdx !== fs[1] && sockIdx !== fs[2] && sockIdx !== fs[3]) continue;
      const f = this.gait.feet[s];
      if (f.state === 0 && this.slots[0].state === 0 && this.curJumpY() < 0.02) return this.footSockFromGait(s, sockIdx, out);
    }
    this.chainSock(sockIdx, _q3, 0);
    return this.toWorld(_q3, this.rootX(), this.rootZ(), this.rootYaw(), out);
  }

  /** Char-frame socket position in skQ (lazy chain FK) into a[o..o+2]. */
  chainSock(sockIdx, a, o) {
    const b = this.rig.sock[sockIdx * 4];
    this.ensureQ(b);
    return this.skQ.sock(sockIdx, a, o);
  }

  /** Foot sockets of a planted gait foot from its lock (flat sole / toe pivot geometry). */
  footSockFromGait(s, sockIdx, out) {
    const f = this.gait.feet[s];
    const rp = this.rig.restPos, ft = LEG_IK[s][2];
    const ank = this.gait.ankleOf(f);
    // socket offset in the foot frame: foot sockets are on foot_s / ball_s; rotate by Ry(yaw)·Rx(pitch)
    const sb = this.rig.sock[sockIdx * 4];
    let ox = this.rig.sock[sockIdx * 4 + 1], oy = this.rig.sock[sockIdx * 4 + 2], oz = this.rig.sock[sockIdx * 4 + 3];
    if (sb !== ft) { ox += rp[sb * 3]; oy += rp[sb * 3 + 1]; oz += rp[sb * 3 + 2]; }
    _v3[0] = ox; _v3[1] = oy; _v3[2] = oz;
    RyRx(f.yaw, f.mode === 1 ? f.pitch : 0, _q4, 0);
    qrotate(_q4, 0, _v3, 0, _v3, 0);
    out.x = ank[0] + _v3[0]; out.y = ank[1] + _v3[1]; out.z = ank[2] + _v3[2];
    return out;
  }

  /** Char-frame point a[0..2] → world {x, y, z} with root (x, z, yaw). */
  toWorld(a, x, z, yaw, out) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.x = x + a[0] * c + a[2] * s; out.y = a[1]; out.z = z - a[0] * s + a[2] * c;
    return out;
  }

  /** Ball-path point of a layer's clip at clip time t (clip-start frame × sLeg) → world. */
  pathBall(L, t, out) {
    const p = this.pAdd;
    sampleClip(L.src, t, p, 0);
    const s = this.sLeg;
    _v3[0] = p.bpath[0] * s; _v3[1] = p.bpath[1] * s; _v3[2] = p.bpath[2] * s;
    return this.toWorld(_v3, L.x0, L.z0, L.yaw0, out);
  }

  /** Render-time socket (world) after the last evaluate (IK and look included). */
  renderSocket(sockIdx, out) {
    if (sockIdx === SOCK.ball) {
      if (this.rBallOn) { out.x = this.rBallW[0]; out.y = this.rBallW[1]; out.z = this.rBallW[2]; return out; }
      this.sk.sock(this.ballHand === HAND.L ? SOCK.ball1_l : SOCK.ball1_r, _q3, 0);
    } else this.sk.sock(sockIdx, _q3, 0);
    return this.toWorld(_q3, this.rx, this.rz, this.ryaw, out);
  }

  // =================================================================================================== action exit
  /** At the action's exit the gait adopts the feet where the clip left them (step pose, deterministic). */
  replantFromAction() {
    if (this.qStep !== this.stepN) this.buildStepPose();
    const sk = this.skQ;
    for (let b = 0; b < BONE_COUNT; b++) this.qValid[b] = 0;
    sk.fkAll(); this.qValid.fill(1);
    const x = this.rootX(), z = this.rootZ(), yaw = this.rootYaw();
    for (let s = 0; s < 2; s++) {
      const ft = LEG_IK[s][2];
      const cf = this.cfoot[s];
      let ax, az, fyaw;
      if (cf.on) {
        // clip lock (world) → gait (flat ankle point / toe ball point)
        this.gait.replant(s, cf.x, cf.z, cf.yaw, cf.mode, cf.mode === 1 ? 8 * DEG : 0);
        continue;
      }
      _v3[0] = sk.P[ft * 3]; _v3[1] = sk.P[ft * 3 + 1]; _v3[2] = sk.P[ft * 3 + 2];
      this.toWorld(_v3, x, z, yaw, _o3);
      ax = _o3.x; az = _o3.z;
      // foot yaw: the foot's forward axis projected on the floor
      _v3[0] = 0; _v3[1] = 0; _v3[2] = 1;
      qrotate(sk.W, ft * 4, _v3, 0, _v3, 0);
      fyaw = yaw + Math.atan2(_v3[0], _v3[2]);
      this.gait.replant(s, ax, az, fyaw, 0, 0);
    }
  }

  // =================================================================================================== render
  /**
   * Full pose at the render time (alpha between the last two steps): layers, additive, procedural (IK, look), face;
   * writes the bones and the morph / eye uniforms. frameDt = render frame time (springs, face smoothing).
   */
  evaluate(alpha, frameDt) {
    if (this.external) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.frameN++;
    // self-driven root (no game stepping: lineup / intro / viewer without an owner)
    if (this.stepCalls === 0 && (this.walk.active || !this.owner)) this.selfDrive(frameDt);
    this.stepCalls = 0;
    const culled = this.ch && this.ch.visible === false;
    if (culled && (this.frameN & 3) !== 0) return;          // culled: 15 Hz, no IK, no look
    if (this.detail.halfRate && (this.frameN & 1) !== 0 && this.hasLast) return;
    const d = this.detail;
    const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    // ---- render root ----
    const obj = this.ch && this.ch.object;
    if (obj && this.owner) { this.rx = obj.position.x; this.rz = obj.position.z; this.ryaw = obj.rotation.y; }
    else if (this.owner) { this.rx = this.owner.pos.x; this.rz = this.owner.pos.z; this.ryaw = this.owner.yaw; }
    else { this.rx = this.x; this.rz = this.z; this.ryaw = this.yaw; }
    if (this.yawOverride !== null) this.ryaw = this.yawOverride;
    if (obj && (!this.owner || this.yawOverride !== null)) {
      obj.position.x = this.rx; obj.position.z = this.rz; obj.rotation.y = this.ryaw;
    }
    const jy = this.jumpYPrev + (this.curJumpY() - this.jumpYPrev) * a;
    // ---- 0 base ----
    const P = this.pBase;
    this.gait.writePose(P, a);
    this.overlays(P, a, frameDt, false);
    // interrupted-fade / teleport snapshot (fading out)
    if (this.snapK > 0) {
      const age = this.snapAgePrev + (this.snapAge - this.snapAgePrev) * a;
      const u = this.snapDur > 1e-6 ? age / this.snapDur : 1;
      const k = 1 - smooth(u);
      if (k > 0) blendPose(P, P, this.pSnap, k, ONES);
    }
    // ---- 1 action, 2 upper ----
    for (let li = 0; li < 2; li++) {
      const L = this.slots[li];
      if (L.state === 0) { L.w = 0; continue; }
      const pl = li === 0 ? this.pAct : this.pUp;
      sampleClip(L.src, this.renderClipT(L, a), pl, SAMPLE_AIR_LINEAR);
      let w;
      if (L.state === 1) { const age = L.agePrev + (L.age - L.agePrev) * a; w = easeOut3(L.fadeIn > 1e-6 ? age / L.fadeIn : 1); }
      else { const age = L.outAgePrev + (L.outAge - L.outAgePrev) * a; w = 1 - smooth(L.fadeOut > 1e-6 ? age / L.fadeOut : 1); }
      L.w = w;
      if (w > 0) blendPose(P, P, pl, w, MASK_W[L.mask]);
    }
    copyPose(this.pLast, P); this.hasLast = true;
    // ---- 3 additive ----
    this.additive(P, a);
    const L2 = this.slots[2];
    if (L2.state !== 0) {
      sampleClip(L2.src, this.renderClipT(L2, a), this.pAdd, 0);
      const w = L2.state === 1 ? easeOut3(L2.fadeIn > 1e-6 ? (L2.agePrev + (L2.age - L2.agePrev) * a) / L2.fadeIn : 1) : 1 - smooth((L2.outAgePrev + (L2.outAge - L2.outAgePrev) * a) / L2.fadeOut);
      L2.w = w;
      if (w > 0) addPose(P, this.pAdd, w);
    }
    // ---- dunk reach assist (pose level: shrug to 30°, side-bend 15°, takeoff pelvis height through the slam) ----
    this.dunkW = d.handIK && !culled ? this.dunkWeight(a) : 0;
    if (this.dunkW > 0) this.dunkAssist(P, this.dunkW);
    // ---- fingers: automatic grip (previous frame's hand / ball distance) ----
    if (d.fingers) this.autoGrip(P, frameDt);
    // ---- locals, FK ----
    const sk = this.sk;
    for (let b = 0; b < BONE_COUNT; b++) toLocal(this.rig, b, P.q, sk.L, b * 4, b * 4);
    this.pelvisLocal(sk, P, jy);
    sk.fkAll();
    // ---- 4 procedural ----
    if (d.footIK && !(culled)) this.feetIK(a, jy, frameDt);
    this.ballAndHands(a, d.handIK && !culled);
    if (d.look && !culled) this.lookAt(P, frameDt);
    // ---- teleport / reset crossfade of the final pose ----
    if (this.xfOn) {
      const age = this.xfAgePrev + (this.xfAge - this.xfAgePrev) * a, k = smooth(age / this.xfDur);
      if (k < 1) {
        for (let b = 0; b < BONE_COUNT; b++) qnlerp(this.xfL, b * 4, sk.L, b * 4, k, sk.L, b * 4);
        const p = BONE.pelvis * 3;
        for (let j = 0; j < 3; j++) sk.T[p + j] = this.xfT[p + j] + (sk.T[p + j] - this.xfT[p + j]) * k;
        sk.fkAll();
      }
    }
    // ---- write bones ----
    if (this.bones) this.writeBones();
    // ---- 5 face ----
    this.faceUpdate(P, frameDt, d.expressions);
    if (this.ch && this.ch.eyeOffset && d.eyes) { this.ch.eyeOffset.x = this.look.out.x; this.ch.eyeOffset.y = this.look.out.y; }
    this.stats.evals++;
    if (t0) this.stats.cpuMs = 0.9 * this.stats.cpuMs + 0.1 * (performance.now() - t0);
  }

  /** Render clip time of a layer: prevT + alpha·(t − prevT) (loop-aware), the frozen time when fading out. */
  renderClipT(L, a) {
    if (L.state !== 1) return L.frozenT;
    const c = L.clock;
    if (L.frozen) return c.t;
    let dT = c.t - c.prevT;
    if (dT < 0 && L.src.loop) dT += L.src.dur;
    let t = c.prevT + a * dT;
    if (L.src.loop && t > L.src.dur) t -= L.src.dur;
    return t;
  }

  /** Base overlays: dribble arm FK (dribble side, protect / backdown off arm) and the ball held at the chest on the move. */
  overlays(P, a, dt, stepMode) {
    const tDrib = this.drib.active ? 1 : 0;
    const tHold = this.ballMode === BM.BOTH && this.slots[0].state === 0 ? this.gait.moveW : 0;
    if (!stepMode) {
      const h = dt > 0.05 ? 0.05 : dt;
      this.dribW += clamp(tDrib - this.dribW, -h / 0.10, h / 0.10);
      this.holdW += clamp(tHold - this.holdW, -h / 0.15, h / 0.15);
    }
    const dw = stepMode ? tDrib : this.dribW, hw = stepMode ? tHold : this.holdW;
    if (dw > 0) {
      const q = this.pAdd; q.w.fill(0); q.pelW = 0;
      const s = this.drib.hand === 2 ? 1 : 0;
      poseArm(q, s, this.drib.armW, 0);
      if (this.drib.offK > 0.01) poseArm(q, 1 - s, this.drib.offW, 0);
      blendPose(P, P, q, dw, MASK_W[this.drib.offK > 0.01 ? MASK.arms : (s === 0 ? MASK.armR : MASK.armL)]);
    }
    if (hw > 0) {
      const q = this.pAdd; q.w.fill(0); q.pelW = 0;
      poseArm(q, 0, SHORT.CHEST.RA, 0); poseArm(q, 1, SHORT.CHEST.LA, 0);
      blendPose(P, P, q, hw, MASK_W[MASK.arms]);
    }
  }

  /** Additive layer: lean, breathing, aim twist, hold micro-motion, landing absorb, swat ([ANIM §2.6.1–2.6.2]). */
  additive(P, a) {
    const L0 = this.slots[0];
    const actW = L0.w;
    // lean: pelvis 40 % / spine 60 %
    const lw = this.leanW;
    if (lw > 0 && (Math.abs(this.leanP) > 0.01 || Math.abs(this.leanR) > 0.01)) {
      this.addAxial(P, BONE.pelvis, 0.4 * this.leanP * lw, 0, 0.4 * this.leanR * lw);
      this.addSpine(P, 0.6 * this.leanP * lw, 0, 0.6 * this.leanR * lw);
    }
    // breathing: weight 1 idle / 0.4 moving / 0 in actions
    if (this.detail.breathing) {
      const sta = this.owner && typeof this.owner.stamina === 'number' ? this.owner.stamina : this.ctx.stamina;
      const m = (1 + 1.5 * (1 - sta)) * (this.deepT > 0 ? 2.5 : 1);
      const ph = this.breathPhPrev + (this.breathPh - this.breathPhPrev) * a;
      const b = Math.sin(2 * Math.PI * ph);
      const w = (1 - 0.6 * this.gait.moveW) * (1 - actW);
      if (w > 0.001) {
        this.addAxial(P, BONE.spine_03, -1.2 * m * b * w, 0, 0);
        this.addAxial(P, BONE.neck_01, 0.6 * m * b * w, 0, 0);
        this.addClav(P, 0, 1.0 * m * b * w); this.addClav(P, 1, 1.0 * m * b * w);
      }
    }
    // aim twist for passes: spine yaw clamp(α, ±60°) split 0.20 / 0.35 / 0.45
    if (this.aimW > 0 && this.aim !== 0) {
      const al = clamp(this.aim / DEG, -60, 60) * this.aimW;
      this.addAxial(P, BONE.spine_01, 0, 0.20 * al, 0); this.addAxial(P, BONE.spine_02, 0, 0.35 * al, 0); this.addAxial(P, BONE.spine_03, 0, 0.45 * al, 0);
    }
    // hold at `set`: 2 Hz micro-motion of the shooting arm (elbow ±2°, wrist ±3°)
    if (L0.state === 1 && L0.clock.holding && L0.clock.holdKind === 1) {
      const s = L0.mirror ? 1 : 0, t = this.time + a / 60;
      const sn = Math.sin(2 * Math.PI * 2 * t);
      this.addElem(P, ARM_IK[s][2], AQ.LOWERARM, s, 2 * sn, 0);
      this.addElem(P, ARM_IK[s][3], AQ.HAND, s, 0, 3 * sn);
    }
    // landing absorb: pelvis drop and leg flexion, clamp(8°·|vy|, 20°, 60°)
    if (this.landT >= 0) {
      const t = this.landT + a / 60;
      const e = t < 0.08 ? smooth(t / 0.08) : 1 - smooth((t - 0.08) / 0.27);
      const A = this.landA * e;
      P.pel[1] -= 0.12 * (A / 60);
      for (let s = 0; s < 2; s++) {
        this.addElem(P, LEG_IK[s][0], AQ.THIGH, s, 0.5 * A, 0);
        this.addElem(P, LEG_IK[s][1], AQ.CALF, s, A, 0);
      }
    }
    // swat / pin additive after a block contact: wFlex −10 → +50, pron +30 over 0.06 s (pin: −40 → +20, no pron)
    if (this.contactT >= 0 && this.contactT > 0.06) {
      const t = this.contactT - 0.06;
      const e = smooth(t / 0.06) * (1 - smooth((t - 0.25) / 0.15));
      const s = this.contactSide;
      const pin = this.contactKind === 1;
      this.addElem(P, ARM_IK[s][3], AQ.HAND, s, pin ? 30 * e : 30 * e, pin ? 60 * e : 60 * e);
    }
  }

  addAxial(P, b, pitch, yaw, roll) {
    _c3[0] = pitch; _c3[1] = yaw; _c3[2] = roll;
    anatQuat(AQ.AXIAL, 0, _c3, _q4, 0);
    qmul(_q4, 0, P.q, b * 4, P.q, b * 4);
  }
  addSpine(P, pitch, yaw, roll) {
    this.addAxial(P, BONE.spine_01, 0.30 * pitch, 0.30 * yaw, 0.30 * roll);
    this.addAxial(P, BONE.spine_02, 0.35 * pitch, 0.33 * yaw, 0.35 * roll);
    this.addAxial(P, BONE.spine_03, 0.35 * pitch, 0.37 * yaw, 0.35 * roll);
  }
  addClav(P, s, elev) {
    _c3[0] = elev; _c3[1] = 0; _c3[2] = 0;
    anatQuat(AQ.CLAV, s === 0 ? -1 : 1, _c3, _q4, 0);
    const b = ARM_IK[s][0];
    qmul(_q4, 0, P.q, b * 4, P.q, b * 4);
  }
  /**
   * Additive elemental change on a limb bone: LOWERARM (elbow +a), HAND (pron +a, wFlex +b), THIGH (hip flex +a),
   * CALF (knee +a). Pre-multiplied in anatomical space (q = qAdd·q).
   */
  addElem(P, b, kind, s, va, vb) {
    const sg = s === 0 ? -1 : 1;
    if (kind === AQ.LOWERARM) { _c3[0] = va; _c3[1] = 0; anatQuat(kind, sg, _c3, _q4, 0); }
    else if (kind === AQ.HAND) { _c3[0] = va; _c3[1] = vb; _c3[2] = 0; anatQuat(kind, sg, _c3, _q4, 0); }
    else if (kind === AQ.THIGH) { _c3[0] = va; _c3[1] = 0; _c3[2] = 0; anatQuat(kind, sg, _c3, _q4, 0); }
    else { _c3[0] = va; anatQuat(kind, sg, _c3, _q4, 0); }
    qmul(_q4, 0, P.q, b * 4, P.q, b * 4);
  }

  /** Automatic grip: a hand whose ball1 is within 0.18 m of an owned ball blends to `grip` (keeps `shoot`) in 0.06 s. */
  autoGrip(P, dt) {
    const owned = this.ballMode !== BM.FREE && this.rBallOn;
    const h = dt > 0.05 ? 0.05 : dt;
    for (let s = 0; s < 2; s++) {
      let tgt = 0;
      if (owned) {
        this.sk.sock(s === 0 ? SOCK.ball1_r : SOCK.ball1_l, _q3, 0);
        const dx = _q3[0] - this.rBall[0], dy = _q3[1] - this.rBall[1], dz = _q3[2] - this.rBall[2];
        if (dx * dx + dy * dy + dz * dz < 0.18 * 0.18 && P.fingers[s] !== FINGER_ID.shoot) tgt = 1;
      }
      this.gripW[s] += clamp(tgt - this.gripW[s], -h / 0.06, h / 0.06);
      const w = this.gripW[s];
      if (w <= 0.001) continue;
      fingerQuats(FINGER_ID.grip, s, 0, _fq, 0);
      const bones = s === 0 ? FINGER_BONES.r : FINGER_BONES.l;
      for (let k = 0; k < 15; k++) qnlerp(P.q, bones[k] * 4, _fq, k * 4, w, P.q, bones[k] * 4);
    }
  }

  /** World (x, z) → char frame of the render root into a[o], a[o+2]. */
  toChar(wx, wy, wz, a, o) {
    const dx = wx - this.rx, dz = wz - this.rz, c = Math.cos(this.ryaw), s = Math.sin(this.ryaw);
    a[o] = dx * c - dz * s; a[o + 1] = wy; a[o + 2] = dx * s + dz * c;
    return a;
  }

  /**
   * Foot locks: gait targets (world) and clip plants (clip-start frame → world, latched while planted), weighted by
   * the action's leg weight; the pelvis drops just enough that every planted foot is reachable; auto-release when the
   * leg would need > 0.995·(thigh + calf) + 0.10 m or the hip–lock horizontal distance exceeds 0.75·legLen.
   */
  feetIK(a, jy, dt) {
    const sk = this.sk, m = this.rig.metrics, s = this.sLeg;
    const L0 = this.slots[0];
    const kLeg = L0.state !== 0 ? L0.w * MASK_W[L0.mask][BONE.thigh_r] * this.pAct.w[BONE.thigh_r] : 0;
    const air = clamp(1 - jy / 0.05, 0, 1);
    const yawC = this.ryaw;
    let drop = 0;
    for (let side = 0; side < 2; side++) {
      const gf = this.gait.feet[side], cf = this.cfoot[side], T = this.ft[side];
      // gait target → char frame
      this.toChar(gf.x, gf.y, gf.z, _a3, 0);
      let tx = _a3[0], ty = _a3[1], tz = _a3[2], tyaw = gf.oyaw - yawC, tpitch = gf.opitch, tmode = gf.omode;
      let wGait = (1 - kLeg) * air;
      let locked = gf.planted === 1 && wGait > 0.5;
      // clip plant
      const clipOn = L0.state !== 0 && this.pAct.ftOn[side] === 1 && kLeg > 0.01;
      if (clipOn) {
        const o = side * 4, f = this.pAct.ftRL;
        if (!cf.on) {
          // latch the world lock (target matching Δ weighted by the plant time)
          let lx = f[o], lz = f[o + 1];
          const rm = this.root;
          if (L0.li === 0 && rm.tTarget > 0) { const k = smooth(this.renderClipT(L0, a) / rm.tTarget); lx += rm.dX * k; lz += rm.dZ * k; }
          const c0 = Math.cos(L0.yaw0), s0 = Math.sin(L0.yaw0);
          cf.x = L0.x0 + (lx * c0 + lz * s0) * s; cf.z = L0.z0 + (-lx * s0 + lz * c0) * s;
          cf.mode = f[o + 3] > 0.5 ? 1 : 0; cf.on = 1;
        }
        cf.yaw = L0.yaw0 + f[o + 2];                       // pivots: yaw follows the clip while planted
        cf.mode = f[o + 3] > 0.5 ? 1 : 0;
        this.toChar(cf.x, cf.mode === 1 ? 0.012 : m.ankleY, cf.z, _b3, 0);
        // the clip's own foot pitch (pre-IK FK) for toe locks
        let cp = 0;
        if (cf.mode === 1) { const ft = LEG_IK[side][2]; _v3[0] = 0; _v3[1] = 0; _v3[2] = 1; qrotate(sk.W, ft * 4, _v3, 0, _v3, 0); cp = Math.max(0, -Math.asin(clamp(_v3[1], -1, 1))); }
        const k = kLeg;
        tx = tx + (_b3[0] - tx) * k; ty = ty + (_b3[1] - ty) * k; tz = tz + (_b3[2] - tz) * k;
        tyaw = tyaw + wrapPi(cf.yaw - yawC - tyaw) * k; tpitch = tpitch + (cp - tpitch) * k;
        if (k >= 0.5) tmode = cf.mode;
        wGait = 1; locked = true;
      } else cf.on = 0;
      T.x = tx; T.y = ty; T.z = tz; T.yaw = tyaw; T.pitch = tpitch; T.mode = tmode; T.w = wGait;
      // pelvis drop that keeps this foot reachable: planted feet now; a swinging gait foot ramps in over its last
      // 30 % with the requirement it will have at touchdown (plant point vs the hip predicted at that time), so the
      // drop is continuous through the strike
      const th = LEG_IK[side][0];
      if (locked) {
        const need = this.reqDrop(side, T, sk.P[th * 3], sk.P[th * 3 + 1], sk.P[th * 3 + 2]);
        if (need > drop) drop = need;
      } else if (wGait > 0 && gf.state !== 0 && gf.swingU > 0.7) {
        const g = this.gait, ramp = (gf.swingU - 0.7) / 0.3;
        const tl = (1 - gf.swingU) * (gf.state === 2 ? gf.stepDur : g.mode === GAIT.SLIDE ? 0.25 / (g.rate || 1) : (1 - g.beta()) / (g.rate || 1));
        const P2 = this.ft2;
        g.plantRequest(gf, _pr);
        this.toChar(_pr[0], _pr[3] === 1 ? 0.012 : m.ankleY, _pr[1], _a3, 0);
        P2.x = _a3[0]; P2.y = _a3[1]; P2.z = _a3[2]; P2.yaw = _pr[2] - yawC; P2.pitch = _pr[4]; P2.mode = _pr[3]; P2.w = 1;
        // hip at touchdown: the root moves by v·tl (world → char frame)
        const c = Math.cos(yawC), sn = Math.sin(yawC), wx = g.vx * tl, wz = g.vz * tl;
        const hx = sk.P[th * 3] + wx * c - wz * sn, hz = sk.P[th * 3 + 2] + wx * sn + wz * c;
        const need = ramp * this.reqDrop(side, P2, hx, sk.P[th * 3 + 1], hz);
        if (need > drop) drop = need;
      }
    }
    // the drop rises instantly (reachability) but relaxes at ≤ 0.8 m/s (a lower hip never hurts reach): no pops
    const rel = this.dropPrev - 0.8 * (dt > 0.05 ? 0.05 : dt);
    if (drop < rel) drop = rel;
    if (drop > 0.30 * s) drop = 0.30 * s;
    this.dropPrev = drop;
    if (drop > 0) {
      sk.T[BONE.pelvis * 3 + 1] -= drop;
      sk.fkAll();
    }
    for (let side = 0; side < 2; side++) {
      const T = this.ft[side], D = this.diag[side];
      if (T.w <= 0) { D.locked = false; continue; }
      // auto-release (> 0.10 m beyond the leg, or the hip too far ahead of the lock)
      footReach(sk, side, T, _r2);
      const gf = this.gait.feet[side], cf = this.cfoot[side];
      const isLock = (gf.planted === 1 && !cf.on) || cf.on === 1;
      if (isLock && (_r2[0] > 0.995 * (m.thighLen + m.calfLen) + 0.10 || _r2[1] > 0.75 * m.legLen)) {
        if (cf.on) { cf.on = 0; } else this.catchUpReq |= 1 << side;
        D.locked = false;
        footLock(sk, side, T);
        continue;
      }
      const err = footLock(sk, side, T);
      const lockedNow = isLock && T.w >= 0.999;
      if (lockedNow) {
        // slide = effector distance from the lock point (world), worst since the lock was taken
        if (!D.locked) { D.locked = true; D.max = 0; }
        D.slide = err; if (err > D.max) D.max = err;
      } else D.locked = false;
    }
  }

  /** Pelvis drop (m) that lets foot request T be reached from a hip at (hx, hy, hz) (ik.footDropFor, 5 mm margin). */
  reqDrop(side, T, hx, hy, hz) {
    const m = this.rig.metrics;
    return footDropFor(this.sk, side, T, hx, hy, hz, 0.995 * (m.thighLen + m.calfLen) - 0.005);
  }

  /** Ball (render) and hand IK by ball mode; dunk slam / rim grab; catch; block contact. */
  ballAndHands(a, handIK) {
    const sk = this.sk;
    this.rBallOn = false;
    const L0 = this.slots[0];
    const bm = this.ballMode;
    if (bm === BM.BOTH) {
      sk.sock(SOCK.ball1_r, _q3, 0); sk.sock(SOCK.ball1_l, _q3, 3);
      const cx = 0.5 * (_q3[0] + _q3[3]), cy = 0.5 * (_q3[1] + _q3[4]), cz = 0.5 * (_q3[2] + _q3[5]);
      this.rBall[0] = cx; this.rBall[1] = cy; this.rBall[2] = cz; this.rBallOn = true;
      if (handIK) {
        for (let s = 0; s < 2; s++) {
          const e = Math.hypot(_q3[s * 3] - cx, _q3[s * 3 + 1] - cy, _q3[s * 3 + 2] - cz);
          const w = e < 0.15 ? 1 : e < 0.25 ? (0.25 - e) / 0.10 : 0;
          if (w > 0 && e > 1e-4) handOnBall(sk, s, this.rBall, w);
        }
      }
    } else if (bm === BM.R || bm === BM.L) {
      sk.sock(bm === BM.R ? SOCK.ball1_r : SOCK.ball1_l, this.rBall, 0); this.rBallOn = true;
    } else if (bm === BM.DRIB && this.drib.active) {
      const psi = this.drib.renderPsi(a);
      this.drib.ballAt(psi, this.rx, this.rz, this.ryaw, _w3, 0);
      this.toChar(_w3[0], _w3[1], _w3[2], this.rBall, 0); this.rBallOn = true;
      if (handIK) {
        this.drib.handTarget(psi, this.rBall, _h4);
        if (_h4[3] > 0) {
          const s = this.drib.hand === 2 ? 1 : 0, sh = ARM_IK[s][1];
          // dribble-hand elbow pole: shoulder + (±0.10, −0.45, +0.25)
          _p3[0] = sk.P[sh * 3] + (s === 1 ? 0.10 : -0.10); _p3[1] = sk.P[sh * 3 + 1] - 0.45; _p3[2] = sk.P[sh * 3 + 2] + 0.25;
          handToPoint(sk, s, s === 0 ? SOCK.palm_r : SOCK.palm_l, _h4, _p3, _h4[3], 1);
        }
      }
    } else if (bm === BM.PATH && L0.state !== 0 && L0.src.hasBp) {
      const p = this.pAct;
      if (p.bpathOn) {
        const s = this.sLeg;
        _v3[0] = p.bpath[0] * s; _v3[1] = p.bpath[1] * s; _v3[2] = p.bpath[2] * s;
        this.toWorld(_v3, L0.x0, L0.z0, L0.yaw0, _o3);
        this.toChar(_o3.x, _o3.y, _o3.z, this.rBall, 0); this.rBallOn = true;
        if (handIK) {
          // contact windows: a hand within 0.20 m of the ball closes on it (full at ≤ 0.10 m)
          for (let s = 0; s < 2; s++) {
            sk.sock(s === 0 ? SOCK.ball1_r : SOCK.ball1_l, _q3, 0);
            const e = Math.hypot(_q3[0] - this.rBall[0], _q3[1] - this.rBall[1], _q3[2] - this.rBall[2]);
            const w = e < 0.10 ? 1 : e < 0.20 ? (0.20 - e) / 0.10 : 0;
            if (w > 0) handOnBall(sk, s, this.rBall, w);
          }
        }
      }
    }
    if (handIK && L0.state === 1) {
      const tm = L0.src.timing, t = this.renderClipT(L0, a);
      // dunk: last 0.15 s before SLAM the ball centre is driven to the slam point; rim grab with rimHook
      if (L0.cat === C_DUNK && tm.slam > 0) {
        const toSlam = this.slotTimeTo(L0, tm.slam, t);
        if (toSlam > 0 && toSlam <= 0.15 && this.rBallOn) {
          this.slamPoint(_w3);
          this.toChar(_w3[0], _w3[1], _w3[2], _b3, 0);
          const w = slamRamp(toSlam);
          const hands = bm === BM.BOTH ? 3 : bm === BM.L ? 2 : 1;
          this.slamIK(hands, _b3, w);
          // the arms alone may fall short of the rig-independent reach table: lift the body (visual, ≤ 0.20 m)
          const short = (_b3[1] - this.rBall[1]) * w;
          if (short > 0.003) {
            sk.T[BONE.pelvis * 3 + 1] += short < 0.20 ? short : 0.20;
            sk.fkAll();
            this.slamIK(hands, _b3, w);
          }
        }
        if (tm.rimGrab > 0 && t >= tm.rimGrab && (tm.rimRelease < 0 || t <= tm.rimRelease + 0.05)) {
          const w = tm.rimRelease > 0 && t > tm.rimRelease ? 1 - (t - tm.rimRelease) / 0.05 : 1;
          this.rimPoint(_w3);
          this.toChar(_w3[0], _w3[1], _w3[2], _b3, 0);
          const hands = L0.src.timing.params.hands === 2 ? 3 : (L0.mirror ? 2 : 1);
          // two-hand grabs: hooks 0.22 m apart along the rim tangent; a hang the arms cannot reach lifts the body
          // (visual, ≤ 0.20 m, like the slam) so the hooks stay on the rim
          let short = this.rimIK(hands, _b3, w);
          if (short > 0.003) {
            sk.T[BONE.pelvis * 3 + 1] += short < 0.20 ? short : 0.20;
            sk.fkAll();
            short = this.rimIK(hands, _b3, w);
            if (short > 0.003) { sk.T[BONE.pelvis * 3 + 1] += short < 0.05 ? short : 0.05; sk.fkAll(); this.rimIK(hands, _b3, w); }
          }
        }
      }
      // catch: hands to the predicted ball over the last 0.15 s before arrival
      if (this.catchT > 0 && this.catchT <= 0.15) {
        this.toChar(this.catchP[0], this.catchP[1], this.catchP[2], _b3, 0);
        const w = 1 - this.catchT / 0.15;
        handOnBall(sk, 0, _b3, w); handOnBall(sk, 1, _b3, w);
      }
    }
    // block / contest contact: palm IK to the ball over 0.06 s, held 2 frames, released over 0.10 s
    if (handIK && this.contactT >= 0) {
      const t = this.contactT;
      const w = t < 0.06 ? t / 0.06 : t < 0.093 ? 1 : 1 - clamp((t - 0.093) / 0.10, 0, 1);
      if (w > 0) {
        this.toChar(this.contactP[0], this.contactP[1], this.contactP[2], _b3, 0);
        const s = this.contactSide;
        handToPoint(sk, s, s === 0 ? SOCK.palm_r : SOCK.palm_l, _b3, this.overheadPole(s), w, 0.5);
      }
    }
    if (this.rBallOn) this.toWorld(this.rBall, this.rx, this.rz, this.ryaw, _o3), this.rBallW[0] = _o3.x, this.rBallW[1] = _o3.y, this.rBallW[2] = _o3.z;
  }

  /**
   * Dunk reach weight at the render time: 0 → 1 over the last 0.15 s before SLAM, 1 through the rim hang, then
   * 0.10 s down after RIM_RELEASE (or after SLAM without a hang).
   */
  dunkWeight(a) {
    const L0 = this.slots[0];
    if (L0.state !== 1 || L0.cat !== C_DUNK) return 0;
    const tm = L0.src.timing;
    if (!(tm.slam > 0)) return 0;
    const t = this.renderClipT(L0, a);
    const toSlam = this.slotTimeTo(L0, tm.slam, t);
    if (toSlam > 0.15) return 0;
    if (toSlam > 0) return slamRamp(toSlam);
    const end = tm.rimRelease > tm.slam ? tm.rimRelease : tm.slam + 0.03;
    if (t <= end) return 1;
    return clamp(1 - (t - end) / 0.10, 0, 1);
  }

  /**
   * reachDunk of spec §4.9.4: shoulder elevation 30° (clavicle) and a 15° spine side-bend toward a one-hand dunking
   * arm (two hands: 8° extension), and the takeoff pelvis height held through the slam (the landing crouch starts
   * after it), weighted by w.
   */
  dunkAssist(P, w) {
    const L0 = this.slots[0], tm = L0.src.timing, src = L0.src;
    const two = (src.timing.params && src.timing.params.hands === 2) || this.ballMode === BM.BOTH;
    const right = !L0.mirror;
    for (let s = 0; s < 2; s++) {
      if (!two && (s === 0) !== right) continue;
      // raise the clavicle toward 30° total elevation (authored + automatic rhythm are already in P)
      this.addClav(P, s, 10 * w);
    }
    if (two) this.addSpine(P, -8 * w, 0, 0);
    else this.addSpine(P, 0, 0, (right ? -15 : 15) * w);
    if (src.hasPel && tm.takeoff >= 0) P.pel[1] += (src.dyTO - P.pel[1]) * w * (P.pel[1] < src.dyTO ? 1 : 0);
  }

  /** Moves the ball-holding hand(s) so the ball centre goes to `target` (char frame), overhead elbow poles. */
  slamIK(hands, target, w) {
    const sk = this.sk;
    const dx = target[0] - this.rBall[0], dy = target[1] - this.rBall[1], dz = target[2] - this.rBall[2];
    for (let s = 0; s < 2; s++) {
      if (!(hands & (1 << s))) continue;
      sk.sock(s === 0 ? SOCK.ball1_r : SOCK.ball1_l, _q3, 0);
      _q3[0] += dx; _q3[1] += dy; _q3[2] += dz;
      handToPoint(sk, s, s === 0 ? SOCK.ball1_r : SOCK.ball1_l, _q3, this.overheadPole(s), w, 1);
    }
    if (hands === 3) { sk.sock(SOCK.ball1_r, _q3, 0); sk.sock(SOCK.ball1_l, _q3, 3); this.rBall[0] = 0.5 * (_q3[0] + _q3[3]); this.rBall[1] = 0.5 * (_q3[1] + _q3[4]); this.rBall[2] = 0.5 * (_q3[2] + _q3[5]); }
    else sk.sock(hands === 2 ? SOCK.ball1_l : SOCK.ball1_r, this.rBall, 0);
  }

  /** rimHook IK of the grabbing hand(s) to the rim front (char frame); returns the weighted vertical shortfall (m). */
  rimIK(hands, rim, w) {
    const sk = this.sk;
    let short = 0;
    for (let s = 0; s < 2; s++) {
      if (!(hands & (1 << s))) continue;
      _q3[0] = rim[0]; _q3[1] = rim[1]; _q3[2] = rim[2];
      if (hands === 3) _q3[0] += s === 1 ? 0.11 : -0.11;
      const sock = s === 0 ? SOCK.rimHook_r : SOCK.rimHook_l;
      handToPoint(sk, s, sock, _q3, this.overheadPole(s), w, 1);
      sk.sock(sock, _q3, 3);
      const d = (_q3[1] - _q3[4]) * w;
      if (d > short) short = d;
    }
    return short;
  }

  /** Game seconds from clip time t to clip event time te under the current clock (≥ 0 when ahead). */
  slotTimeTo(L, te, t) { return L.clock.estimateTo(te) - (L.clock.t - t) / (L.clock.rate || 1); }

  /** Elbow pole for overhead reaches: shoulder + (±0.35, −0.10, +0.05) (elbow out). */
  overheadPole(s) {
    const sh = ARM_IK[s][1], sk = this.sk;
    _p3[0] = sk.P[sh * 3] + (s === 1 ? 0.35 : -0.35); _p3[1] = sk.P[sh * 3 + 1] - 0.10; _p3[2] = sk.P[sh * 3 + 2] + 0.05;
    return _p3;
  }

  /** Slam point (world): setSlamPoint() or the rim front 0.10 m toward the dunker at RIM.y + 0.18. */
  slamPoint(out) {
    if (this.slamSet) { out[0] = this.slamP[0]; out[1] = this.slamP[1]; out[2] = this.slamP[2]; return out; }
    const dx = this.rx - RIM_POS.x, dz = this.rz - RIM_POS.z, l = Math.hypot(dx, dz) || 1;
    out[0] = RIM_POS.x + dx / l * 0.10; out[1] = RIM_POS.y + 0.18; out[2] = RIM_POS.z + dz / l * 0.10;
    return out;
  }

  /** Rim front point (world): RIM + n·RIM.r toward the dunker, y = RIM.y + 0.01. */
  rimPoint(out) {
    const dx = this.rx - RIM_POS.x, dz = this.rz - RIM_POS.z, l = Math.hypot(dx, dz) || 1;
    out[0] = RIM_POS.x + dx / l * RIM_R; out[1] = RIM_POS.y + 0.01; out[2] = RIM_POS.z + dz / l * RIM_R;
    return out;
  }

  /** Look-at target: the clip's look key (resolved through setLookPoint), else the gameplay target. */
  lookAt(P, dt) {
    let w = 0, tx = 0, ty = 0, tz = 0;
    const code = P.look[0] | 0;
    const L0 = this.slots[0];
    const inShot = L0.state === 1 && (L0.cat === C_JUMPER || L0.cat === C_LAYUP || L0.cat === C_DUNK);
    if (code === LOOK.none) w = 0;
    else if (code > 0 && this.lookPts[code * 4 + 3] > 0) {
      tx = this.lookPts[code * 4]; ty = this.lookPts[code * 4 + 1]; tz = this.lookPts[code * 4 + 2];
      w = (P.look[1] > 0 ? P.look[1] : 1) * (inShot ? 0.5 : 1);
    } else if (this.lookOn) {
      tx = this.lookTx; ty = this.lookTy; tz = this.lookTz; w = this.lookW * (inShot ? 0.5 : 1);
    }
    if (w > 0) this.toChar(tx, ty, tz, _b3, 0);
    const allowSpine = L0.state === 0;
    this.look.update(this.sk, dt, _b3[0], _b3[1], _b3[2], w, allowSpine);
  }

  /** Writes sk.L / pelvis translation into the bones, composes the matrices, one updateMatrixWorld. */
  writeBones() {
    const bones = this.bones, L = this.sk.L, T = this.sk.T;
    for (let b = 0; b < BONE_COUNT; b++) {
      const bone = bones[b], q = bone.quaternion;
      q._x = L[b * 4]; q._y = L[b * 4 + 1]; q._z = L[b * 4 + 2]; q._w = L[b * 4 + 3];
      if (b <= 1) { bone.position.x = T[b * 3]; bone.position.y = T[b * 3 + 1]; bone.position.z = T[b * 3 + 2]; }
      bone.matrix.compose(bone.position, q, bone.scale);
      bone.matrixWorldNeedsUpdate = true;
    }
    if (this.ch.object) this.ch.object.updateMatrixWorld(true);
    this.stats.bonesUpdated = BONE_COUNT;
  }

  /** Face layer: targets (clip, gameplay, rules, baselines, blink) smoothed with §3.9 attack / release → morphs. */
  faceUpdate(P, dt, enabled) {
    const h = dt > 0.1 ? 0.1 : dt;
    const t = this.time;
    const act = this.slots[0].w;
    for (let k = 0; k < 9; k++) {
      let tgt = this.faceSet[k];
      if (this.faceRule[k] > tgt) tgt = this.faceRule[k];
      if (P.exprK[k] > 0 && P.expr[k] > tgt) tgt = P.expr[k];
      if (k === E_SCOWL && this.id === 'kobe' && tgt < 0.35) tgt = 0.35;            // Mamba stare baseline
      if (k === E_JAW && this.id === 'jordan') {                                       // gum chew (idle)
        const chew = (0.06 + 0.06 * Math.max(0, Math.sin(2 * Math.PI * 1.5 * t))) * (1 - act);
        if (chew > tgt) tgt = chew;
      }
      if (k === E_BLINK) tgt = this.blinkT >= 0 && this.blinkT < 0.05 ? 1 : 0;
      const ar = FACE_AR[k], cur = this.face[k];
      const step = tgt > cur ? h / ar[0] : h / ar[1];
      this.face[k] = tgt > cur ? Math.min(tgt, cur + step) : Math.max(tgt, cur - step);
    }
    if (enabled && this.ch && this.ch.morph) {
      const mo = this.ch.morph;
      for (let k = 0; k < 9; k++) { const i = this.morphIdx[k]; if (i >= 0) mo[i] = this.face[k]; }
    }
  }

  // =================================================================================================== presentation API
  /** Self-driven fixed steps (no game: lineup / intro placement, viewer): walkTo motion + step(1/60). */
  selfDrive(frameDt) {
    const W = this.walk;
    W.acc += frameDt > 0.25 ? 0.25 : frameDt;
    const dt = 1 / 60;
    while (W.acc >= dt) {
      W.acc -= dt;
      if (W.active && !this.owner) {
        const dx = W.x - this.x, dz = W.z - this.z, d = Math.hypot(dx, dz);
        if (d > 0.02) {
          const sp = Math.min(W.speed, d / 0.35 + 0.3);
          const hx = dx / d, hz = dz / d;
          const tv = Math.min(sp, d / dt);
          this.vx += (hx * tv - this.vx) * Math.min(1, dt * 8); this.vz += (hz * tv - this.vz) * Math.min(1, dt * 8);
          this.x += this.vx * dt; this.z += this.vz * dt;
          const hd = Math.atan2(hx, hz);
          this.yaw += clamp(wrapPi(hd - this.yaw), -10 * dt, 10 * dt);
        } else {
          this.vx = 0; this.vz = 0;
          const e = wrapPi(W.yaw - this.yaw);
          this.yaw += clamp(e, -6 * dt, 6 * dt);
          if (Math.abs(e) < 0.01) W.active = false;
        }
      }
      this.step(dt);
    }
    this.stepCalls = 0;
  }

  /** Walk (self-driven) to (x, z), then face yaw; speed ≤ 0 → place instantly (teleport + settle, no snap). */
  walkTo(x, z, yaw, speed = 1.4) {
    if (speed <= 0) {
      this.x = x; this.z = z; this.yaw = yaw; this.vx = 0; this.vz = 0;
      this.walk.active = false;
      return;
    }
    this.walk.active = true; this.walk.x = x; this.walk.z = z; this.walk.yaw = yaw; this.walk.speed = speed;
  }

  /** Overrides the rendered yaw (lineup turntable / showcase); null returns to the root's yaw. */
  setYawOverride(yaw) { this.yawOverride = yaw === null || yaw === undefined ? null : yaw; }

  /** Plays clip id frozen at clip time t (showcase stills, viewer `t`). */
  freeze(clipId, t = 0, mirror = false) {
    const idx = typeof clipId === 'number' ? clipId : clipIndex(clipId);
    if (!this.play(idx, { mirror, blendIn: 0 })) return false;
    const L = this.slots[0];
    L.frozen = true; L.clock.t = t; L.clock.prevT = t; L.age = 1; L.agePrev = 1;
    this.root.active = false; this.motion.active = false;
    return true;
  }

  /** Gameplay face target: expression name → weight (held until changed; 0 clears). */
  setFace(name, w) { const k = EXPR[name]; if (k !== undefined) this.faceSet[k] = clamp(w, 0, 1); }

  /** Look-at target (world point) with weight (default 1). */
  setLookTarget(x, y, z, w = 1) { this.lookTx = x; this.lookTy = y; this.lookTz = z; this.lookW = w; this.lookOn = true; }
  clearLookTarget() { this.lookOn = false; }
  /** World point for a clip look code ('ball', 'man', 'passer', 'receiver', 'target', 'crowd', 'rim'). */
  setLookPoint(name, x, y, z) { const c = LOOK[name]; if (c > 0 && c < LOOK_POINTS) { this.lookPts[c * 4] = x; this.lookPts[c * 4 + 1] = y; this.lookPts[c * 4 + 2] = z; this.lookPts[c * 4 + 3] = 1; } }

  /** Pass aim: target azimuth relative to the facing (rad, + left); applied while a pass clip plays. */
  setAim(angle) { this.aim = angle || 0; }

  /**
   * Gameplay-detected block / tip contact at the ball centre (world): palm IK of the nearer hand over 0.06 s, then the
   * swat (kind 0) or pin (kind 1, chase-downs) additive. Yao: roar 0.9 for 1.0 s.
   */
  contact(x, y, z, kind = 0) {
    this.contactP[0] = x; this.contactP[1] = y; this.contactP[2] = z; this.contactT = 0; this.contactKind = kind === 'pin' || kind === 1 ? 1 : 0;
    this.querySocket(SOCK.palm_r, _o3); const dr = Math.hypot(_o3.x - x, _o3.y - y, _o3.z - z);
    this.querySocket(SOCK.palm_l, _o3); const dl = Math.hypot(_o3.x - x, _o3.y - y, _o3.z - z);
    this.contactSide = dl < dr ? 1 : 0;
    if (this.id === 'yao') this.ruleFace(E_ROAR, 0.9, 1.0);
  }

  /** Pass in flight to me: predicted ball position (world) and seconds to arrival (hand IK over the last 0.15 s). */
  setCatch(x, y, z, tArrive) { this.catchP[0] = x; this.catchP[1] = y; this.catchP[2] = z; this.catchT = tArrive; }

  /** Dunk slam point (world); default: rim front 0.10 m toward the dunker at RIM.y + 0.18. */
  setSlamPoint(x, y, z) { this.slamP[0] = x; this.slamP[1] = y; this.slamP[2] = z; this.slamSet = true; }

  /** "Deep breath" idle habit: breathing amplitude × 2.5 for one 3 s cycle. */
  deepBreath() { this.deepT = 3.0; }

  /** Debug: bind pose on the bones (never used by gameplay, R#37). */
  resetPose() { this.sk.reset(); if (this.bones) this.writeBones(); }

  /** Foot-lock diagnostics [{side, locked, slide (m), max (m)}] (shared records). */
  footLocks() { return this.diag; }

  // =================================================================================================== replay
  /**
   * Records this frame into f32[off .. off + 233): root x, y, z, yaw; 53 local quaternions; pelvis local position; 9
   * expression weights; eye offset (2); visible flag; jumpY; ball mode. Returns the float count.
   */
  capture(f32, off) {
    f32[off] = this.rx; f32[off + 1] = 0; f32[off + 2] = this.rz; f32[off + 3] = this.ryaw;
    const L = this.sk.L;
    for (let i = 0; i < BONE_COUNT * 4; i++) f32[off + 4 + i] = L[i];
    const p = BONE.pelvis, T = this.sk.T, o = off + 4 + BONE_COUNT * 4;
    f32[o] = T[p * 3]; f32[o + 1] = T[p * 3 + 1]; f32[o + 2] = T[p * 3 + 2];
    for (let k = 0; k < 9; k++) f32[o + 3 + k] = this.face[k];
    f32[o + 12] = this.look.out.x; f32[o + 13] = this.look.out.y;
    f32[o + 14] = this.ch && this.ch.visible === false ? 0 : 1;
    f32[o + 15] = this.curJumpY(); f32[o + 16] = this.ballMode;
    return ANIM_CAPTURE_FLOATS;
  }

  /** Replay playback: blends two captured frames (alpha 0 → A, 1 → B) onto the bones / object / morphs / eyes. */
  applyBlend(f32, offA, offB, alpha) {
    const u = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    const sk = this.sk;
    this.rx = f32[offA] + (f32[offB] - f32[offA]) * u;
    this.rz = f32[offA + 2] + (f32[offB + 2] - f32[offA + 2]) * u;
    this.ryaw = f32[offA + 3] + wrapPi(f32[offB + 3] - f32[offA + 3]) * u;
    for (let b = 0; b < BONE_COUNT; b++) qnlerp(f32, offA + 4 + b * 4, f32, offB + 4 + b * 4, u, sk.L, b * 4);
    const rp = this.rig.restPos;
    for (let b = 0; b < BONE_COUNT; b++) { sk.T[b * 3] = rp[b * 3]; sk.T[b * 3 + 1] = rp[b * 3 + 1]; sk.T[b * 3 + 2] = rp[b * 3 + 2]; }
    const oA = offA + 4 + BONE_COUNT * 4, oB = offB + 4 + BONE_COUNT * 4, p = BONE.pelvis;
    for (let j = 0; j < 3; j++) sk.T[p * 3 + j] = f32[oA + j] + (f32[oB + j] - f32[oA + j]) * u;
    sk.fkAll();
    for (let k = 0; k < 9; k++) this.face[k] = f32[oA + 3 + k] + (f32[oB + 3 + k] - f32[oA + 3 + k]) * u;
    this.look.out.x = f32[oA + 12] + (f32[oB + 12] - f32[oA + 12]) * u;
    this.look.out.y = f32[oA + 13] + (f32[oB + 13] - f32[oA + 13]) * u;
    const c = this.ch;
    if (c) {
      if (c.object) { c.object.position.x = this.rx; c.object.position.z = this.rz; c.object.rotation.y = this.ryaw; }
      if (this.bones) this.writeBones();
      if (c.morph) for (let k = 0; k < 9; k++) { const i = this.morphIdx[k]; if (i >= 0) c.morph[i] = this.face[k]; }
      if (c.eyeOffset) { c.eyeOffset.x = this.look.out.x; c.eyeOffset.y = this.look.out.y; }
    }
  }
}

// ------------------------------------------------------------------------------------------------- module scratch
const _lw = new Float32Array(3);
const _c3 = new Float64Array(3), _q4 = new Float64Array(4), _v3 = new Float64Array(3);
const _q3 = new Float64Array(6), _a3 = new Float64Array(3), _b3 = new Float64Array(3), _w3 = new Float64Array(3), _p3 = new Float64Array(3);
const _h4 = new Float64Array(4), _r2 = new Float64Array(4), _pr = new Float64Array(5);
const _o3 = { x: 0, y: 0, z: 0 };
const _fq = new Float32Array(60);
const _snapOld = new Float32Array(BONE_COUNT);
const COMBO = { btl: clipIndex('move.btl'), cross: clipIndex('move.cross') };
/** Kyrie's idle combos need the authored move clips (WP3c data), not just their catalog timing. */
function hasMoveClips() { return getDef(COMBO.btl) !== null && getDef(COMBO.cross) !== null; }
