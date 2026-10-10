/**
 * clips/shots.js — shot / finish generators and the shared authoring helpers of the clip library (spec §4.9,
 * [ANIM §5.3–§5.7, §9]).
 *
 * Exports
 *   helpers  G, th(h, gScale), remap(src, dst), retime(keys, map, posScale?), rootAt(keys, t), relBall(keys),
 *            jumperTimes(p, variant), jumpTail(p, T, o), guideAfter(p), FACE_DUNK, faceKeysJordan(gather, land)
 *   templates (functions of anchor times, used by the signature files and by the generic derivatives below)
 *            tplHook(A), tplFloater(A, scoop), tplReverseLay(A), tplEuro(A, mode), tplUpUnder(A)
 *   generators (one def per player; times final for that player, tempo: false)
 *            makeJumper(p, variant ∈ mid|three|pull12|pullHop|fade), makeLayup(p, variant ∈ std2|std1|fingerRoll|
 *            fingerRoll1), makeLayFamily(p, variant ∈ reverse|euro|power|upUnder), makeDunk(p, type ∈ power2|
 *            tomahawk1|simple1), makeStepbackJ(p), makeTurnFade(p), makeHook(p), makeFloater(p), makeTip(p),
 *            makePutDunk(p)
 *   SHOT_GENERATORS: { clipId: (p) → def } for every generator-built id (common.js registers them per player).
 *
 * Conventions (authoring guide at the top of ../clip.js): right-handed clips (the '_L' twin is automatic), degrees,
 * offsets in reference metres (× sLeg at runtime). Event times reproduce select.getTiming exactly (the formulas below
 * are the ones of spec §4.9 / [ANIM §5]); test/unit-clips.mjs cross-checks every clip against the timing tables.
 *
 * Ball paths: the [ANIM §4.2 / §9] tables give `Bp` relative to the moving character (character frame at that key),
 * while the clip format stores the path in the clip-start frame; relBall() converts each Bp key by adding the root
 * curve R(t) (rotated by its yaw) so the ball stays at the authored place on the body while the root travels / spins.
 */
import { defineClip, hermiteMonotone } from '../clip.js';
import { FORMS, STYLE, SLEG, SET, GUIDE, REL, FOLLOW, DIP_ARMS, SHORT, LEG, ARM, STANCE, defFeet } from '../presets.js';
import { HJUMP } from '../select.js';

/** Gravity (m/s²), as select.js. */
export const G = 9.81;
/** Half airtime of a ballistic jump of height h (m) under g·gScale. */
export const th = (h, gScale = 1) => Math.sqrt(2 * h / (G * gScale));
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------------------------
// Time / space helpers (load time only; they allocate)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Piecewise-linear time map through anchor pairs src[i] → dst[i] (both increasing). Outside the anchors the end
 * segments are extended. Used to re-time a source clip's keys onto another player's event times.
 */
export function remap(src, dst) {
  const n = src.length;
  return (t) => {
    let i = 0;
    while (i < n - 2 && t > src[i + 1]) i++;
    const a = src[i], b = src[i + 1];
    return dst[i] + (t - a) * (dst[i + 1] - dst[i]) / (b - a);
  };
}

/**
 * Airborne pelvis line of a jumping clip (applied by defineJump): gameplay owns the height in the air (jumpY) and the
 * sampler draws the pelvis offset on the straight line between its take-off and landing values (SAMPLE_AIR_LINEAR).
 * At the take-off the legs are extended with the toes pointed, so the pelvis is up on the toes (dy +0.05; the tables'
 * −0.02…−0.04 would sink the toes into the floor); the touchdown is on soft, nearly straight legs (dy −0.03) and the
 * keyed landing crouch moves to land + 0.08 (the knees absorb after the contact). Keys must carry `ev` inline.
 */
export function airLine(keys, dur) {
  const out = keys.map(([t, k]) => [t, { ...k }]);
  const has = (k, n) => k.ev === n || (Array.isArray(k.ev) && k.ev.includes(n));
  let iTO = -1, iL = -1;
  out.forEach(([, k], i) => { if (iTO < 0 && has(k, 'takeoff')) iTO = i; if (has(k, 'land')) iL = i; });
  if (iTO < 0 || iL < 0) return out;
  const kTO = out[iTO][1];
  kTO.P = kTO.P ? kTO.P.slice() : [null, null, null, null, null, null];
  kTO.P[1] = 0.05;
  // the heels rise before the toe-off: a foot still planted 0.06 s before the takeoff switches to a toe lock
  const tTO = out[iTO][0];
  for (const g of ['Rft', 'Lft']) {
    let last = null;
    for (const [t, k] of out) if (t < tTO - 0.06 - 1e-6 && k[g] !== undefined) last = k[g];
    if (last && last[3] === 'f') out.push([tTO - 0.06, { [g]: [last[0], last[1], last[2], 't'] }]);
  }
  const [tL, kL] = out[iL];
  if (tL + 0.08 < dur - 0.02 && (kL.P || kL.RL || kL.LL)) {
    const absorb = {};
    if (kL.P) absorb.P = kL.P.slice();
    if (kL.RL) absorb.RL = kL.RL;
    if (kL.LL) absorb.LL = kL.LL;
    out.push([tL + 0.08, absorb]);
  }
  kL.P = kL.P ? kL.P.slice() : [null, null, null, null, null, null];
  kL.P[1] = -0.03;
  if (kL.RL) kL.RL = [12, 6, 2, 18, 5, 0];
  if (kL.LL) kL.LL = [12, 6, 2, 18, 5, 0];
  return out;
}

/** defineClip for jumping clips that are not built by jumpTail: applies airLine to the keys first. */
export function defineJump(def) { return defineClip({ ...def, keys: airLine(def.keys, def.dur) }); }

/** Deep-copies keys, mapping each key time with `map` and (optionally) scaling R / foot positions by posScale. */
export function retime(keys, map, posScale = 1) {
  return keys.map(([t, k]) => {
    const o = {};
    for (const g of Object.keys(k)) {
      const v = k[g];
      if ((g === 'R') && posScale !== 1) o[g] = [v[0] * posScale, v[1] * posScale, v[2]];
      else if ((g === 'Rft' || g === 'Lft') && v && posScale !== 1) o[g] = [v[0] * posScale, v[1] * posScale, v[2], v[3]];
      else if (Array.isArray(v)) o[g] = v.slice();
      else if (v && typeof v === 'object') o[g] = { ...v };
      else o[g] = v;
    }
    return [map(t), o];
  });
}

/**
 * Root curve value at time t (reference metres / degrees) through the R keys of `keys`, interpolated exactly as the
 * compiler does (monotone cubic Hermite per scalar, implicit [0, 0, 0] at t = 0).
 */
export function rootAt(keys, t) {
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const ts = [], vs = [];
    for (const [kt, k] of [...keys].sort((a, b) => a[0] - b[0])) {
      if (k.R && k.R[c] !== null && k.R[c] !== undefined) { ts.push(kt); vs.push(k.R[c]); }
    }
    if (!ts.length) continue;
    if (ts[0] > 1e-6) { ts.unshift(0); vs.unshift(0); }
    out[c] = hermiteMonotone(ts, vs)(t);
  }
  return out;
}

/**
 * Converts the Bp keys of `keys` from the character frame (as tabulated by the spec) to the clip-start frame:
 * Bp_start = R.xz(t) + rotY(R.yaw(t)) · Bp_rel. Returns new key arrays (input untouched).
 */
export function relBall(keys) {
  const sorted = [...keys].sort((a, b) => a[0] - b[0]);
  return sorted.map(([t, k]) => {
    if (!k.Bp) return [t, k];
    const r = rootAt(sorted, t), c = Math.cos(r[2] * DEG), s = Math.sin(r[2] * DEG);
    const [x, y, z] = k.Bp;
    // rotateY(ψ): start-frame (x, z) = (x·cos ψ + z·sin ψ, −x·sin ψ + z·cos ψ) (+x = left, yaw CCW from above)
    return [t, { ...k, Bp: [r[0] + x * c + z * s, y, r[1] - x * s + z * c] }];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Fitted grips (measured on the baked rig with the scratch fitters of test/scratch/wp3c: the ball1 sockets of both
// hands meet within 3 cm, so the 'both' ball mode puts the ball between the palms and the release never pops)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Guide arm at the set point per player: the nearest arm to the form's guide array (spec §4.9.2) whose ball socket
 * meets the shooting hand's within 4 cm. The form arrays themselves leave the guide hand 0.2–0.35 m off the ball on
 * the baked rig (the ball would sit between the hands and pop to the shooting hand at the release input).
 */
export const GUIDE_SET = Object.freeze({
  kobe: Object.freeze([141, 11, 41, 92, 15, -20, 0]), jordan: Object.freeze([127, -14, 17, 80, 10, -15, 0]),
  lebron: Object.freeze([141, -13, 42, 71, 47, -15, 0]), giannis: Object.freeze([144, -4, 57, 76, 36, -20, 0]),
  yao: Object.freeze([129, -13, 25, 86, 15, -20, 0]), kyrie: Object.freeze([132, 7, 26, 100, 15, -20, 0]),
});
/** Guide arm at the set point (fitted, see GUIDE_SET). */
export const guideSet = (p) => GUIDE_SET[p];

/** Symmetric two-hand grips ([RA = LA]; ball between the palms on the midline). */
export const GRIP2 = Object.freeze({
  rise: Object.freeze([150, -5, 21, 40, 40, -30, 0]),          // ball rising overhead (two-hand dunk takeoff)
  chinY: Object.freeze([40, 40, 58, 128, 15, -25, 0]),         // Yao chinned, elbows out 40 (spec abd 60 leaves the hands apart)
  chinOut: Object.freeze([50, 28, 40, 120, 20, -25, 0]),       // chinned, elbows out (post turnarounds)
  hipTight: Object.freeze([40, 15, 30, 110, 20, -25, 0]),      // ball tight at the hip / chest in a spin, elbows in
  cock: Object.freeze([178, 5, 20, 95, 30, -20, 0]),           // ball behind the head (power dunk cock)
  overhead: Object.freeze([170, -5, 16, 35, 30, -20, 0]),      // ball held overhead (put-back catch, drop step)
  slam: Object.freeze([170, 0, 10, 0, -60, -20, 0]),           // two-hand slam: arms up, ball over the rim
  passLoad: Object.freeze([165, -5, 13, 70, 30, -30, 0]),      // overhead pass, ball behind the head
  skip: Object.freeze([175, -5, 20, 35, 12, -40, 0]),          // arms straight overhead (skip overhead)
  scoop: Object.freeze([55, -5, 15, 15, -30, -10, 0]),         // loose-ball scoop at the floor
  catchChest: Object.freeze([60, 0, 20, 37, -40, 0, 0]),       // catch target at the chest
  catchHigh: Object.freeze([140, -5, 18, 30, -60, 0, 0]),      // catch above 1.6 m
  catchLow: Object.freeze([20, 0, 20, 40, -40, 0, 0]),         // catch below 0.8 m
});
/**
 * One-hand slam (ball released over the rim): arm up with the wrist cocked back so the ball sits above the palm, the
 * spine bent 15° toward the dunking arm and the clavicle raised (spec §4.9.4 reachDunk). The spec's slam array
 * [120,10,0,5,90,70,0] is the hammer follow-through (HAMMER1, 0.06 s later).
 */
export const SLAM1 = Object.freeze({ RA: Object.freeze([172, 5, 20, 0, 60, -50, 0]), S: Object.freeze([4, 0, -15]), RC: Object.freeze([10, 0]) });
export const HAMMER1 = Object.freeze([125, 10, 0, 5, 90, 60, 0]);
/** Ball low across the left knee (rip / jab): both ball sockets meet (the profile's right arm stays on the right). */
export const RIP_LOW = Object.freeze({ RA: Object.freeze([15, -10, 60, 45, 92, -10, 0]), LA: Object.freeze([20, 10, 50, 40, 20, -10, 0]) });
/** Ball swept to the left hip (rip), guide fitted to the right hand. */
export const RIP_HIP_L = Object.freeze({ RA: Object.freeze([10, 15, 50, 60, 40, -10, 0]), LA: Object.freeze([5, -7, 37, 55, 60, -10, 0]) });
/** Jab ball sway 0.20 to the right (Kobe's jab series), right arm fitted to the left hand. */
export const JAB_SWAY = Object.freeze({ RA: Object.freeze([17, 35, 40, 105, 40, -25, 0]), LA: Object.freeze([40, 20, 60, 85, 0, -15, 0]) });
/** Kobe's triple threat from the jab series (left arm fitted). */
export const JAB_HOLD = Object.freeze({ RA: Object.freeze([15, 25, 20, 75, 40, -25, 0]), LA: Object.freeze([42, -15, 60, 48, 66, -15, 0]) });
export const HAMMER2 = Object.freeze([150, 15, 0, 10, 90, 60, 0]);

// ---------------------------------------------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------------------------------------------

/** Expression weights held during jump shots ([ANIM §5.2] "face during the shot"; Jordan: tongue in on jumpers). */
const FACE_SHOT = {
  kobe: { scowl: 0.4 }, jordan: { tongueOut: 0 }, lebron: null, giannis: null, yao: null, kyrie: null,
};

/** Dunk faces ([ANIM §8.1]): [takeoff weights, slam weights]. */
export const FACE_DUNK = Object.freeze({
  kobe: [{ jawJut: 0.3 }, { jawJut: 0.6 }],
  jordan: [{ tongueOut: 1 }, { tongueOut: 1 }],
  lebron: [{ roar: 0.4 }, { roar: 1.0 }],
  giannis: [{ roar: 0.4 }, { roar: 1.0 }],
  yao: [{ roar: 0.5 }, { roar: 0.9 }],
  kyrie: [{ jawOpen: 0.25 }, { jawOpen: 0.45 }],
});

/**
 * Jordan's tongue on every layup / dunk ([ANIM §8.1]): 0 → 1 over 0.10 s from the gather, held to land + 0.10,
 * retracted over 0.12 s. Returns keys to merge into a clip whose duration covers land + 0.22.
 */
export function faceKeysJordan(gather, land, dur) {
  const out = [[gather, { E: { tongueOut: 0 } }], [gather + 0.10, { E: { tongueOut: 1 } }], [Math.min(dur, land + 0.10), { E: { tongueOut: 1 } }]];
  if (land + 0.22 <= dur + 1e-9) out.push([land + 0.22, { E: { tongueOut: 0 } }]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Jumper (spec §4.9.2, [ANIM §5.3])
// ---------------------------------------------------------------------------------------------------------------

/**
 * Event times of makeJumper(p, variant): TO, h, apex, tI (ideal input), tSet, tRel, tLand, tEnd (s from the press).
 * Giannis has no fade form: his fade is the mid-range jumper (select.js decision).
 */
export function jumperTimes(p, variant) {
  const F = FORMS[p];
  let key = variant === 'pull12' || variant === 'pullHop' ? 'pull' : variant;
  if (key === 'fade' && F.takeoff.fade === null) key = 'mid';
  const TO = F.takeoff[key], h = F.h[key];
  const half = th(h);
  const tI = TO + half + F.rva - 0.05;                 // ball launch (input + 0.050) at apex + rva
  const tSet = Math.max(TO - 0.05, tI - F.setLead);
  const tRel = tI + 0.05;
  const tLand = TO + 2 * half;
  const tEnd = Math.max(tLand + 0.25, tRel + F.followHold + 0.15);
  return { key, TO, h, half, apex: TO + half, tI, tSet, tRel, tLand, tEnd };
}

/** Guide-arm pose 0.10 s after the release by the form's "guide after release" ([ANIM §5.2]). */
export function guideAfter(p) {
  const g = GUIDE_SET[p];
  switch (FORMS[p].guideAfter.mode) {
    case 'peel': return [g[0], g[1] + 20, g[2] - 20, g[3] - 30, g[4] - 30, 0, 0];     // peels 10 cm, thumb up
    case 'open': return [g[0] - 5, g[1] + 25, g[2] - 25, g[3] - 25, g[4] - 20, 0, 0]; // opens 15 cm sideways
    case 'clean': return [g[0] - 25, g[1] + 10, g[2] - 10, g[3] - 10, g[4], 0, 0];   // comes off clean, drops
    case 'pop': return [g[0] - 10, g[1] + 40, g[2] - 20, g[3] - 30, g[4] - 20, 0, 0]; // pops to the side
    case 'mirror': return [g[0] + 30, g[1] + 5, g[2] - 30, g[3] - 60, g[4], 0, 0];    // stays up beside the shooting arm
    default: return [g[0] + 5, g[1] + 15, g[2] - 15, g[3] - 20, g[4] - 20, 0, 0];     // stays up 10 cm away
  }
}

/** The guide arm at the release key ([ANIM §5.3]: flex+5, abd+15, int−15, elbow−20, pron−20). */
function guideRel(p) {
  const g = GUIDE_SET[p];
  return [g[0] + 5, g[1] + 15, g[2] - 15, g[3] - 20, g[4] - 20, 0, 0];
}

/**
 * Jumper keys from the takeoff on ([ANIM §5.3] rows TO … tEnd), shared by makeJumper and every signature jump shot
 * that says "makeJumper keys from 'TO' on". T = { TO, apex, tSet, tRel, tLand, tEnd }; o = { lean (deg back), air
 * {R: [hip, knee], L: [hip, knee]}, airAnk, land: {R: [x, z], L: [x, z], yaw}, R: [x, z, yaw] root at land,
 * followHold, legsTO (true: re-key the takeoff legs), trunkTO, face (E weights held), armsTO (rising arms at TO) }.
 */
export function jumpTail(p, T, o = {}) {
  const F = FORMS[p];
  const lean = o.lean || 0;
  const air = o.air || { R: [10, 15], L: [10, 15] };
  const ank = o.airAnk !== undefined ? o.airAnk : 30;
  const yaw = o.land ? o.land.yaw : 10;
  const fh = o.followHold !== undefined ? o.followHold : F.followHold;
  const keys = [];
  const setFirst = T.tSet < T.TO - 1e-9;
  // takeoff: legs extend, trunk rises; the rising arms only when the set comes later (Giannis sets first)
  // takeoff: legs extended, toes pointed (ankle 35°): the pelvis is up on the toes (+0.05) — with the table's −0.02 the
  // pointed toes would sink into the floor at the take-off frame
  const kTO = { RL: LEG.takeoff, LL: LEG.takeoff, Rft: null, Lft: null, ev: 'takeoff' };
  if (o.trunkTO !== false) Object.assign(kTO, { P: [0, 0.05, 0, 2, null, null], S: [3, null, null], N: [-4, null, null] });
  if (!setFirst && o.armsTO !== false) Object.assign(kTO, { RA: [80, 8, 20, 115, 80, -55, 0], LA: [75, 15, 40, 110, 0, -20, 0] });
  keys.push([T.TO, kTO]);
  keys.push([T.apex, { ev: 'apex' }]);
  const kSet = { RA: SET(p), LA: GUIDE_SET[p], RF: 'shoot', LF: 'grip', N: F.head, ev: 'set' };
  if (!setFirst) Object.assign(kSet, { P: [0, 0, 0, -lean / 2, 0, 0], S: [-lean / 2, 0, 0] });
  keys.push([T.tSet, kSet]);
  // air legs (fade split / scissor) once the feet are off the floor
  const tAir = setFirst ? T.TO + 0.08 : Math.max(T.tSet, T.TO + 0.06);
  keys.push([tAir, {
    RL: [air.R[0], 4, 0, air.R[1], ank, 0], LL: [air.L[0], 4, 0, air.L[1], ank, 0],
    ...(setFirst ? { P: [0, 0, 0, -lean / 2, 0, 0], S: [-lean / 2, 0, 0] } : {}),
  }]);
  // release: the trunk stays extended through the launch (authoring guide tip 8)
  keys.push([T.tRel, {
    RA: REL(p), LA: guideRel(p), B: 'free', ev: 'release', P: [null, null, null, -lean / 2, 0, 0], S: [-lean / 2, 0, 0], N: F.head,
  }]);
  if (T.tRel + 0.10 < T.tLand) keys.push([T.tRel + 0.10, { RA: FOLLOW(p), RF: 'snap', LA: guideAfter(p) }]);
  else keys.push([T.tRel + 0.10, { RA: FOLLOW(p), RF: 'snap' }]);
  const lR = o.land ? o.land.R : [-0.20, -(o.drift || 0)], lL = o.land ? o.land.L : [0.20, -(o.drift || 0) - 0.03];
  // touchdown on soft, nearly straight legs; the knees absorb over the next 0.08 s (the air-segment pelvis line runs
  // from the take-off value to this one, so the body stays extended through the release)
  keys.push([T.tLand, {
    P: [0, -0.03, 0, 4, 0, 0], S: [4, 0, 0], RL: [12, 6, 2, 18, 5, 0], LL: [12, 6, 2, 18, 5, 0], Rft: [lR[0], lR[1], yaw, 'f'], Lft: [lL[0], lL[1], yaw, 'f'],
    ...(o.R ? { R: o.R } : {}), ev: 'land',
  }]);
  if (T.tLand + 0.08 < T.tEnd - 0.03) keys.push([T.tLand + 0.08, { P: [0, -0.10, 0, 8, 0, 0], S: [6, 0, 0], RL: LEG.land, LL: LEG.land }]);
  // follow-through hold ends (≥ land; clips whose spec duration is shorter than release + hold end it 0.03 s early)
  keys.push([Math.min(T.tEnd - 0.03, Math.max(T.tLand, T.tRel + fh)), { RA: [F.relFlex - 5, 4, 15, 0, 95, F.followWrist, 0] }]);
  keys.push([T.tEnd, {
    P: [0, -0.03, 0, 4, 0, 0], S: [4, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax',
    ...(o.face ? { E: o.face } : {}),
  }]);
  return keys;
}

/**
 * makeJumper(p, variant) ([ANIM §5.3]): variant ∈ mid | three | pull12 | pullHop | fade → clip id 'shot.<variant>'.
 * Pull-up entries replace the first 0.12–0.14 s (1-2 stop: plantL 0.06 / plantR 0.14, decel 20; hop: both feet at
 * 0.12, decel 24); fades drift back by the form's fade distance with its lean and air legs; Giannis drifts 0.15 m
 * forward on every jumper.
 */
export function makeJumper(p, variant, opt = {}) {
  const F = FORMS[p];
  const T = jumperTimes(p, variant);
  if (opt.h !== undefined) {
    // a signature pull-up with its own jump height (Jordan's 0.55): same formulas, other h
    T.h = opt.h; T.half = th(opt.h); T.apex = T.TO + T.half; T.tI = T.TO + T.half + F.rva - 0.05;
    T.tSet = Math.max(T.TO - 0.05, T.tI - F.setLead); T.tRel = T.tI + 0.05; T.tLand = T.TO + 2 * T.half;
    T.tEnd = Math.max(T.tLand + 0.25, T.tRel + F.followHold + 0.15);
  }
  const fade = T.key === 'fade';
  const drift = opt.drift !== undefined ? opt.drift : fade ? F.fadeDrift : -F.forwardDrift;   // + = back
  const lean = fade ? F.fadeLean : 0;
  const air = opt.air || (fade ? { R: F.airFade.R, L: F.airFade.L } : { R: [10, 15], L: [10, 15] });
  const D = DIP_ARMS[F.ballAtDip];
  const face = FACE_SHOT[p];
  const pull = variant === 'pull12' || variant === 'pullHop';
  const keys = [];
  if (!pull) {
    keys.push([0, {
      P: [0, -0.03, 0, 4, 0, 0], S: [8, 0, 0], N: [-6, 0, 0], ...SHORT.CHEST, RL: LEG.shotStart, LL: LEG.shotStart,
      Rft: [-0.20, 0.05, 10, 'f'], Lft: [0.20, -0.02, 10, 'f'], RF: 'grip', LF: 'grip', B: 'both', look: 'rim', R: [0, 0, 0],
      ...(face ? { E: face } : {}),
    }]);
  } else if (variant === 'pull12') {
    // 1-2 stop off the dribble: left foot plants at 0.06, right at 0.14; pickup by 0.12
    keys.push([0, {
      P: [0, -0.08, 0, 10, 0, 0], S: [12, 0, 0], N: [-8, 0, 0], RA: ARM.dribJog, LA: [30, 20, 0, 40, 10, 0, 0],
      RL: [30, 6, 0, 45, 10, 0], LL: [-5, 4, 0, 25, 25, 0], Rft: null, Lft: null, RF: 'grip', LF: 'relax', B: 'drib',
      look: 'rim', R: [0, 0, 0], ...(face ? { E: face } : {}),
    }]);
    keys.push([0.06, { Lft: [0.20, 0.35, 10, 'f'], LL: [30, 6, 0, 35, -8, 0], ev: 'plantL' }]);
    keys.push([0.12, { ...SHORT.CHEST, LF: 'grip', B: 'both' }]);
    keys.push([0.14, { Rft: [-0.20, 0.45, 10, 'f'], RL: [30, 6, 0, 40, -10, 0], ev: 'plantR' }]);
  } else {
    // hop into the shot: both feet leave at 0.00 and land together at 0.12
    keys.push([0, {
      P: [0, -0.06, 0, 10, 0, 0], S: [12, 0, 0], N: [-8, 0, 0], RA: ARM.dribJog, LA: [30, 20, 0, 40, 10, 0, 0],
      RL: [25, 6, 0, 40, 25, 0], LL: [20, 6, 0, 35, 25, 0], Rft: null, Lft: null, RF: 'grip', LF: 'relax', B: 'drib',
      look: 'rim', R: [0, 0, 0], ...(face ? { E: face } : {}),
    }]);
    keys.push([0.12, {
      Rft: [-0.20, 0.30, 10, 'f'], Lft: [0.20, 0.30, 10, 'f'], RL: [30, 6, 4, 40, -12, 0], LL: [30, 6, 4, 40, -12, 0],
      ...SHORT.CHEST, LF: 'grip', B: 'both', ev: ['plantL', 'plantR'],
    }]);
  }
  // dip (0.6·TO; after the plants for the pull-ups)
  const tDip = pull ? Math.min(T.TO - 0.03, Math.max(0.6 * T.TO, variant === 'pull12' ? 0.16 : 0.14)) : 0.6 * T.TO;
  keys.push([tDip, {
    P: [0, -F.dip, 0, 10, 0, 0], S: [10, 0, 0], N: [-12, 0, 0], RA: D.RA, LA: D.LA,
    RL: [30, 6, 4, F.kneeDip, -(F.kneeDip - 30), 0], LL: [30, 6, 4, F.kneeDip, -(F.kneeDip - 30), 0],
  }]);
  keys.push(...jumpTail(p, T, {
    lean, air, drift, R: [0, -drift, 0], face, airAnk: opt.airAnk,
  }));
  keys.push([T.TO, { R: [0, 0, 0] }]);
  return defineClip({
    id: opt.id || 'shot.' + variant, dur: T.tEnd, mask: 'full', root: 'motion', entry: 'stop',
    entryDecel: variant === 'pull12' ? 20 : variant === 'pullHop' ? 24 : 18, tempo: false, jump: { h: T.h }, hand: 'R',
    cancel: T.tLand + 0.10, blendIn: 0.06, blendOut: 0.20,
    params: { cat: 'jumper', meterFrom: 0, tIdeal: T.tI, METER_T: opt.METER_T || T.tI / 0.80 },
    keys,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Layups (spec §4.9.3, [ANIM §5.5])
// ---------------------------------------------------------------------------------------------------------------

/** Layup timing per select.js: TO, h, g, half, apex, rel, land, dur, dTO, toDist, gatherWindow, plantL. */
function layTimes(p, steps, fingerRoll) {
  const L = FORMS[p].lay;
  const TO = steps === 2 ? L.to2 : L.to1;
  const g = L.gScale;
  const half = th(L.h, g);
  const rel = fingerRoll ? TO + half + 0.02 : TO + half - 0.03;
  const land = TO + 2 * half;
  const dTO = Math.min(2.0, Math.max(1.0, L.vAir * 2 * half * 0.75));
  const far = p === 'jordan' ? 4.6 : 4.0;
  const toDist = steps === 2 ? (2.5 + far) / 2 - dTO : 0.5;
  return {
    TO, h: L.h, g, half, apex: TO + half, rel, land, dur: land + 0.30, dTO, toDist,
    gatherWindow: steps === 2 ? [2.5, far] : [0, 2.5], plantL: steps === 2 ? 0.26 * STYLE[p].tempo : 0,
  };
}

/**
 * makeLayup(p, variant): 'std2' (two-step gather, right hand off the left foot), 'std1' (one step: the std2 keys
 * from its plantL key), 'fingerRoll' / 'fingerRoll1' (palm up `[160,8,10,10,−70,15,0]`, release at apex + 0.02).
 */
export function makeLayup(p, variant) {
  const two = variant === 'std2' || variant === 'fingerRoll';
  const fr = variant === 'fingerRoll' || variant === 'fingerRoll1';
  const T = layTimes(p, two ? 2 : 1, fr);
  const k = 1 / SLEG[p];                                          // world metres → authored metres
  const Rkeys = [[0, { R: [0, 0, 0] }], [T.TO, { R: [0, T.toDist * k, 0] }], [T.land, { R: [0, (T.toDist + Math.max(0, T.dTO - 0.45)) * k, 0] }]];
  const zTO = T.toDist * k, zLand = (T.toDist + Math.max(0, T.dTO - 0.45)) * k;
  const keys = [...Rkeys];
  if (two) {
    const tL = T.plantL;
    const zL = rootAt(Rkeys, tL)[1] + 0.30;                        // penultimate step lands ahead of the hips
    keys.push([0, {
      P: [0, -0.08, 0, 12, 0, 0], S: [15, 0, 0], N: [-10, 0, 0], RA: [30, 20, 25, 90, 40, -25, 0], LA: [35, 15, 40, 95, 0, -15, 0],
      B: 'both', RF: 'grip', LF: 'grip', Rft: [-0.12, 0.00, 0, 'f'], Lft: null, LL: [40, 5, 0, 70, 10, 0], RL: [15, 5, 0, 25, -5, 0],
      look: 'rim', ev: ['gather', 'plantR'],
    }]);
    keys.push([0.10 * STYLE[p].tempo, { Rft: null, RL: [35, 5, 0, 60, 15, 0], LL: [20, 5, 0, 30, 0, 0] }]);
    keys.push([tL, { P: [0, -0.14, 0, 5, 0, 0], S: [5, 0, 0], Lft: [0.10, zL, 0, 'f'], RL: [50, 5, 0, 90, 20, 0], LL: [25, 5, 0, 35, -15, 0], ev: 'plantL' }]);
  } else {
    // one step: the plantL key is the gather
    keys.push([0, {
      P: [0, -0.14, 0, 5, 0, 0], S: [8, 0, 0], N: [-10, 0, 0], RA: [30, 20, 25, 90, 40, -25, 0], LA: [35, 15, 40, 95, 0, -15, 0],
      B: 'both', RF: 'grip', LF: 'grip', Lft: [0.10, zTO * 0.6 + 0.15, 0, 'f'], Rft: null, RL: [50, 5, 0, 90, 20, 0],
      LL: [25, 5, 0, 35, -15, 0], look: 'rim', ev: ['gather', 'plantL'],
    }]);
  }
  keys.push([T.TO, {
    P: [0, -0.04, 0, 0, 0, 0], S: [2, 0, 0], N: [-15, 0, 0], RL: [95, 5, 0, 100, 30, 0], LL: [-10, 3, 0, 10, 40, 0], Lft: null,
    RA: [100, 10, 20, 80, fr ? 20 : 60, -40, 0], LA: [90, 15, 40, 90, 10, -20, 0], ev: 'takeoff',
  }]);
  keys.push([T.TO + 0.10, { B: 'R', LA: ARM.layGuard, RA: fr ? [140, 8, 15, 40, -40, -20, 0] : ARM.layCarry, LF: 'relax' }]);
  keys.push([T.apex, { ev: 'apex' }]);
  keys.push([T.rel, {
    RA: fr ? ARM.fingerRollRel : ARM.layRelease, B: 'free', E: { jawOpen: 0.3 }, ev: 'release', ...(fr ? { RF: 'relax' } : {}),
  }]);
  keys.push([T.rel + 0.10, fr ? { RA: [158, 8, 10, 5, -70, 30, 0] } : { RA: ARM.layFlick, RF: 'snap' }]);
  keys.push([T.land, {
    P: [0, -0.10, 0, 8, 0, 0], S: [8, 0, 0], RL: LEG.layLand, LL: LEG.layLand, Rft: [-0.175, zLand, 0, 'f'], Lft: [0.175, zLand, 0, 'f'],
    RA: [120, 10, 10, 30, 40, 10, 0], E: { jawOpen: 0.1 }, ev: 'land',
  }]);
  keys.push([T.dur, { P: [0, -0.04, 0, 4, 0, 0], S: [4, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax', E: { jawOpen: 0 } }]);
  if (p === 'jordan') keys.push(...faceKeysJordan(0, T.land, T.dur));
  return defineJump({
    id: 'lay.' + variant, dur: T.dur, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h: T.h, gScale: T.g },
    meter: 'key', hand: 'R', cancel: T.land + 0.10, blendIn: 0.08, blendOut: 0.20, target: 'takeoff',
    params: { cat: 'layup', meterFrom: 0, tIdeal: T.rel - 0.05, gatherWindow: T.gatherWindow },
    keys,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Templates shared by signature clips and their generic derivatives (times = anchors A, see each function)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Yao's right-hand jump hook ([ANIM §9.5] Y1) on anchors A = { s (pre-takeoff time scale), TO, rel, land, end,
 * contact (bool: the shoulder-bump CONTACT event) }. Source times: TO 0.60, release 0.79, land 1.02, end 1.50.
 */
export function tplHook(A) {
  const m = remap([0, 0.60, 0.79, 1.02, 1.50], [0, A.TO, A.rel, A.land, A.end]);
  const keys = [
    [0, { P: [0, -0.12, 0, 6, 0, 0], S1: [5, 0, 0], S2: [5, 0, 0], S3: [5, 0, 0], N: [-8, 30, 0], RA: GRIP2.chinY, LA: GRIP2.chinY,
      RL: [35, 8, 0, 45, -10, 0], LL: [35, 8, 0, 45, -10, 0], Rft: [-0.38, 0, 0, 'f'], Lft: [0.37, 0, 0, 'f'], B: 'both', RF: 'grip', LF: 'grip', look: 'none', R: [0, 0, 0] }],
    // one hard right-hand dribble outside the right foot with a shoulder bump into the defender
    [0.03, { B: 'path', Bp: [-0.42, 0.95, 0.20], RA: [30, 40, 20, 80, 70, 0, 0], S2: [-8, null, null], P: [null, null, -0.05, null, null, null] }],
    [0.10, { Bp: [-0.68, 0.12, 0.0], ev: A.contact ? ['bounce', 'contact'] : 'bounce' }],
    [0.20, { B: 'both', Bp: [-0.25, 1.05, 0.25], RA: GRIP2.chinY, S2: [5, 0, 0], P: [0, -0.12, 0, 6, 0, 0], Lft: null, LL: [40, 10, 0, 55, 0, 0], R: [0, 0, 0] }],
    // left foot steps toward the middle and the rim (spec 0.55 / 0.15, pulled in to 0.74 / −0.12 so the planted leg stays
    // inside its reach under the fixed root R [0.30, −0.08, 70]); root turns 70° CCW (left shoulder to the rim)
    [0.40, { Lft: [0.74, -0.12, 70, 'f'], LL: [35, 8, 0, 45, -10, 0], R: [0.30, -0.08, 70], ...SHORT.HIP_R, Rft: null, RL: [30, 10, 0, 50, 5, 0], ev: 'plantL' }],
    [0.48, { ...SHORT.CHEST }],
    // the right hand takes the ball alone as it swings to the ear (the left only steadies it, no two-hand grip)
    [0.50, { B: 'R' }],
    // ball at the right ear in the right hand (under-behind); the left hand only steadies it beside the head
    [0.55, { Rft: [0.64, 0.17, 70, 'f'], RL: [40, 8, 0, 50, -12, 0], LL: [40, 8, 0, 50, -12, 0], RA: [110, 60, -20, 130, 60, -40, 0], LA: [90, 40, 30, 110, 0, -20, 0], N: [-12, 30, 0], B: 'R', LF: 'relax',
      P: [0, -0.10, 0, 6, 0, 0], ev: 'gather' }],   // hips stay loaded on the gather step; the rise is the take-off
    [0.565, { Rft: [0.64, 0.17, 70, 't'], Lft: [0.74, -0.12, 70, 't'] }],   // heels rise: the push-off is from the toes
    [0.60, { LA: [50, 75, 0, 95, 0, 0, 0], RA: [30, 95, 0, 90, 60, -40, 0], RL: LEG.takeoff, LL: LEG.takeoff, Rft: null, Lft: null, P: [0, -0.03, 0, 2, 0, 0], B: 'R', LF: 'relax', ev: 'takeoff' }],
    [0.70, { RA: [20, 135, 0, 50, 60, -25, 0], N: [-20, 20, 10], RL: [12, 4, 0, 18, 30, 0], LL: [12, 4, 0, 18, 30, 0] }],
    [0.73, { RA: [12, 160, 0, 20, 60, -10, 0] }],
    [0.79, { RA: [10, 170, 0, 10, 60, 30, 0], B: 'free', ev: 'release' }],
    [0.86, { RA: [10, 172, 0, 8, 60, 60, 0], RF: 'snap', LA: [30, 55, 0, 50, 0, 0, 0] }],
    [1.02, { RL: [25, 6, 0, 30, -8, 0], LL: [25, 6, 0, 30, -8, 0], Rft: [0.64, 0.17, 70, 'f'], Lft: [0.74, -0.12, 70, 'f'], P: [0, -0.08, 0, 5, 0, 0], LA: [20, 45, 0, 30, 0, 0, 0], ev: 'land' }],
    [1.20, { RA: [10, 165, 0, 10, 60, 55, 0] }],
    [1.27, { S: [4, 0, 0] }],
    [1.50, { S: [4, 20, 0], P: [0, -0.03, 0, 3, 0, 0], N: [-5, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax' }],
  ];
  const out = relBall(keys).map(([t, k]) => [t <= 0.60 ? t * A.s : m(t), k]);
  out.push([A.TO + th(A.h || 0.22), { ev: 'apex' }]);
  return out;
}

/**
 * Kyrie's floater ([ANIM §9.6] Ky5) / scoop on anchors A = { TO, rel, land, end, h }. Source: takeoff 0.17,
 * release 0.40 (floater) / 0.38 (scoop), land 0.74 / 0.66, end 0.95 / 0.90.
 */
export function tplFloater(A, scoop) {
  const src = scoop ? [0, 0.17, 0.38, 0.66, 0.90] : [0, 0.17, 0.40, 0.74, 0.95];
  const m = remap(src, [0, A.TO, A.rel, A.land, A.end]);
  const keys = [
    [0, { B: 'both', ...SHORT.CHEST, Lft: [0.10, 0.20, 0, 'f'], Rft: null, P: [0, -0.10, 0, 8, 0, 0], S: [10, 0, 0], N: [-12, 0, 0],
      RL: [40, 5, 0, 55, 10, 0], LL: [20, 5, 0, 30, -10, 0], RF: 'grip', LF: 'grip', look: 'rim', R: [0, 0, 0], ev: ['gather', 'plantL'] }],
    [0.10, { RL: [30, 6, 0, 35, -10, 0], LL: [30, 6, 0, 35, -10, 0], P: [0, -0.07, 0, 6, 0, 0], RA: [60, 15, 25, 100, 40, -30, 0], LA: [55, 15, 35, 100, 0, -20, 0] }],
    [0.17, { Lft: null, LL: LEG.takeoff, RL: [45, 5, 0, 60, 30, 0], P: [0, -0.02, 0, 2, 0, 0], S: [4, 0, 0], ev: 'takeoff' }],
  ];
  if (!scoop) {
    keys.push(
      [0.25, { RA: [110, 10, 15, 80, 60, -40, 0], LA: [80, 25, 20, 70, 20, -10, 0], B: 'R', LF: 'relax' }],
      [0.33, { RA: [150, 8, 10, 30, 70, -30, 0] }],
      [0.40, { RA: [155, 8, 10, 10, 70, 15, 0], B: 'free', LA: [60, 45, 0, 30, 0, 0, 0], ev: 'release' }],
      [0.47, { RA: [155, 8, 10, 10, 70, 25, 0], RF: 'relax' }],
      [0.60, { RA: [150, 8, 10, 15, 70, 25, 0] }],
      [0.74, { Lft: [0.10, 0.75, 0, 'f'], LL: [25, 6, 0, 35, -10, 0], RL: [35, 6, 0, 50, 20, 0], P: [0, -0.09, 0, 6, 0, 0], ev: 'land' }],
      [0.80, { Rft: [-0.12, 0.85, 0, 'f'], RL: [20, 6, 0, 30, -8, 0], ev: 'plantR' }],
      [0.95, { P: [0, -0.04, 0, 4, 0, 0], S: [4, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax' }],
    );
  } else {
    keys.push(
      [0.25, { RA: [0, 15, 0, 20, -80, 10, 0], LA: [60, 30, 20, 60, 10, 0, 0], B: 'R', LF: 'relax' }],
      [0.32, { RA: [60, 12, 0, 15, -80, 0, 0] }],
      [0.38, { RA: [110, 10, 0, 10, -80, 20, 0], B: 'free', ev: 'release' }],
      [0.48, { RA: [125, 10, 0, 10, -80, 30, 0], RF: 'relax' }],
      [0.66, { Lft: [0.15, 0.70, 0, 'f'], Rft: [-0.15, 0.70, 0, 'f'], RL: LEG.layLand, LL: LEG.layLand, P: [0, -0.09, 0, 6, 0, 0], ev: 'land' }],
      [0.90, { P: [0, -0.04, 0, 4, 0, 0], S: [4, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax' }],
    );
  }
  const out = keys.map(([t, k]) => [m(t), k]);
  out.push([A.TO + th(A.h), { ev: 'apex' }]);
  return out;
}

/**
 * Kyrie's reverse layup along the right baseline ([ANIM §9.6] Ky4) on anchors A = { s (pre-takeoff scale), TO,
 * rel, land, end, h }. Source: gather/plantL 0.20, plantR 0.33, takeoff 0.37, release 0.675, land 1.04, end 1.25.
 */
export function tplReverseLay(A) {
  const m = remap([0, 0.37, 0.675, 1.04, 1.25], [0, A.TO, A.rel, A.land, A.end]);
  const keys = [
    [0, { P: [0, -0.10, 0, 10, 0, -12], S: [12, 0, -10], N: [-10, 0, 0], RA: ARM.dribRun, LA: [35, 20, 0, 40, 10, 0, 0], B: 'drib', RF: 'grip',
      RL: [30, 6, 0, 45, 10, 0], LL: [-5, 4, 0, 25, 25, 0], Rft: null, Lft: null, look: 'rim', R: [0, 0, 0] }],
    [0.20, { B: 'both', ...SHORT.CHEST, LF: 'grip', Lft: [0.10, 0.60, 0, 'f'], LL: [30, 6, 0, 40, -8, 0], P: [0, -0.10, 0, 8, 0, -8], ev: ['gather', 'plantL'] }],
    [0.33, { Rft: [-0.10, 1.40, 0, 'f'], RL: [45, 8, 0, 60, -15, 0], LL: [45, 8, 0, 60, -15, 0], Lft: null, N: [-30, 20, 0], P: [0, -0.15, 0, 10, 0, 0], ...SHORT.CHEST, ev: 'plantR' }],
    [0.37, { Rft: null, RL: LEG.takeoff, LL: [40, 5, 0, 70, 30, 0], P: [0, -0.03, 0, 0, 0, 0], RA: [120, 10, 10, 60, 20, -30, 0], LA: [60, 30, 20, 60, 0, 0, 0], B: 'R', LF: 'relax', R: [0, 1.40, 0], ev: 'takeoff' }],
    [0.50, { S: [-10, 40, 0], N: [-35, 40, 0], RA: [175, 10, 0, 15, -60, -40, 0], B: 'R', LF: 'relax', LA: [60, 40, 0, 40, 0, 0, 0] }],
    [0.60, { LA: [80, 60, 0, 30, 0, 0, 0] }],
    [0.675, { RA: [178, 12, 0, 10, -20, 20, -20], B: 'free', ev: 'release' }],
    [0.73, { LA: [80, 60, 0, 30, 0, 0, 0], RA: [170, 12, 0, 10, -20, 30, -10], RF: 'relax' }],
    [1.04, { Rft: [-0.17, 2.0, 0, 'f'], Lft: [0.17, 2.0, 0, 'f'], RL: LEG.layLand, LL: LEG.layLand, S: [8, 20, 0], N: [-5, 20, 0], P: [0, -0.10, 0, 8, 0, 0], R: [0, 2.0, 0], ev: 'land' }],
    [1.25, { S: [4, 0, 0], N: [0, 0, 0], P: [0, -0.04, 0, 4, 0, 0], ...SHORT.DOWN, RF: 'relax' }],
  ];
  const out = keys.map(([t, k]) => [t <= 0.37 ? t * A.s : m(t), k]);
  out.push([A.TO + th(A.h, A.g || 1), { ev: 'apex' }]);
  return out;
}

/**
 * Giannis' Eurostep ([ANIM §9.4] G1) on anchors A = { s (pre-takeoff scale), TO, rel (layup) / slam (dunk), land,
 * end, h, g, steps (step-length scale), toDist (authored root travel to the takeoff), air (authored root travel in
 * the air), hang (dunk) }. mode 'lay' | 'dunk'. Source: gather 0.23, plantR 0.33, plantL 0.60, takeoff 0.83.
 */
export function tplEuro(A, mode) {
  const sc = A.steps;
  const Rk = [[0, { R: [0, 0, 0] }], [0.83, { R: [0, A.toDist, 0] }]];
  const zAt = (t) => rootAt(Rk, t)[1];
  // heel strikes ahead of the hips; the second (take-off) step lands further ahead so the planted left leg still
  // reaches the foot when the hips have travelled on to the take-off at 0.83
  const z1 = zAt(0.33) + 0.45 * sc, z2 = zAt(0.60) + 0.50 * sc;
  const keys = [
    [0, { P: [0, -0.13, 0, 8, 0, 0], S1: [8, 0, 0], S2: [8, 0, 0], S3: [6, 0, 0], N: [-20, 0, 0], B: 'drib', RA: ARM.dribRun,
      LA: [35, 20, 0, 40, 10, 0, 0], RF: 'grip', RL: [35, 6, 0, 45, 10, 0], LL: [-10, 4, 0, 25, 30, 0], Rft: null, Lft: null, look: 'rim' }],
    [0.10, { RA: [40, 10, 15, 15, 90, 20, 0] }],                       // long push dribble ahead
    [0.23, { B: 'both', ...SHORT.HIP_R, LF: 'grip', LA: [45, 10, 50, 95, 0, -15, 0], ev: 'gather' }],
    [0.33, { Rft: [-0.55 * sc, z1, -25, 'f'], P: [-0.10, -0.16, 0, 6, -15, 0], S2: [null, null, -10], N: [-20, -20, 0],
      RA: [40, 35, 30, 110, 20, -25, 0], LA: [40, 35, 30, 110, 20, -25, 0], RL: [35, 10, 0, 45, -10, 0], LL: [30, 6, 0, 50, 15, 0], ev: 'plantR' }],
    [0.45, { RL: [30, 10, 0, 40, 10, 0], LL: [40, 5, 0, 30, 10, 0], Rft: null }],
    [0.60, { Lft: [0.65 * sc, z2, 20, 'f'], LL: [55, 8, 0, 65, -12, 0], RL: [30, 8, 0, 60, 20, 0], P: [0.10, -0.24, 0, 8, 0, 0],
      S1: [null, null, 6], S2: [null, null, 6], S3: [null, null, 4], N: [-15, 0, 0], ev: 'plantL' }],
    [0.80, { RA: [100, 10, 40, 120, 40, -30, 0], LA: [118, 30, 5, 112, 20, -30, 0], LL: [55, 8, 0, 75, -18, 0], RL: [90, 5, 0, 100, 20, 0] }],
    [0.83, { Lft: null, LL: [-10, 3, 0, 10, 40, 0], RL: [95, 5, 0, 100, 30, 0], S1: [0, 0, 0], S2: [0, 0, 0], S3: [0, 0, 0], P: [0, -0.03, 0, 0, 0, 0], ev: 'takeoff' }],
  ];
  const post = [];
  if (mode === 'dunk') {
    const m = remap([0.83, 1.31, 1.91, 2.21], [A.TO, A.slam, A.land, A.end]);
    post.push(
      ...[
        [1.00, { B: 'R', RA: [170, 20, -30, 70, 0, -40, 0], LA: [150, 30, 0, 30, -30, 0, 0], N: [-15, 0, 0], E: { roar: 0.4 } }],
        [1.20, { RA: [175, 20, -30, 90, 0, -40, 0], S: [-6, 0, 0] }],
        [1.27, { RA: [175, 12, 0, 20, 40, -45, 0], S: [-2, 0, -8] }],
        [1.31, { ...SLAM1, B: 'free', E: { roar: 1.0 }, ev: 'slam' }],
        [1.37, { RA: [160, 8, 10, 15, 90, 40, 0], S: [10, 0, -5], RC: [0, 0], RL: [60, 10, 0, 70, 20, 0], LL: [60, 10, 0, 70, 20, 0] }],
        [1.91, { RL: LEG.dunkLand, LL: LEG.dunkLand, Rft: [-0.25, 0, 0, 'f'], Lft: [0.25, 0, 0, 'f'], P: [0, -0.15, 0, 12, 0, 0], ev: 'land' }],
        [2.21, { P: [0, -0.06, 0, 6, 0, 0], S: [6, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax', E: { roar: 0.3 } }],
      ].map(([t, k]) => [m(t), k]),
      // the rim grab / release sit exactly 0.03 s / 0.03 + hang after the slam (gameplay profile)
      [A.slam + 0.03, { RF: 'claw', ev: 'rimGrab' }],
      [A.slam + 0.03 + A.hang, { RA: [150, 15, 0, 40, 60, 0, 0], RF: 'relax', ev: 'rimRelease' }],
    );
  } else {
    const m = remap([0.83, 1.20, 1.596, 1.90], [A.TO, A.rel, A.land, A.end]);
    post.push(
      ...[
        [1.00, { B: 'R', RA: [150, 15, 10, 50, 60, -35, 0], LA: [130, 30, 0, 40, -20, 0, 0], LF: 'relax' }],
        [1.20, { RA: ARM.layRelease, B: 'free', ev: 'release' }],
        [1.30, { RA: ARM.layFlick, RF: 'snap', LA: [90, 35, 0, 40, 0, 0, 0] }],
        [1.596, { RL: LEG.layLand, LL: LEG.layLand, Rft: [-0.18, 0, 0, 'f'], Lft: [0.18, 0, 0, 'f'], P: [0, -0.10, 0, 8, 0, 0], ev: 'land' }],
        [1.90, { P: [0, -0.04, 0, 4, 0, 0], S: [4, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax' }],
      ].map(([t, k]) => [m(t), k]),
    );
  }
  // pre-takeoff keys at the player's tempo; root: nominal travel to the takeoff, then the air drift
  const out = keys.map(([t, k]) => [t * A.s, k]).concat(post);
  const tEnd = mode === 'dunk' ? A.slam : A.land;
  out.push([0, { R: [0, 0, 0] }], [A.TO, { R: [0, A.toDist, 0] }], [tEnd, { R: [0, A.toDist + A.air, 0] }]);
  // landing feet re-lock beside the landed root
  for (const [, k] of out) {
    if (k.ev === 'land' || (Array.isArray(k.ev) && k.ev.includes('land'))) {
      k.Rft = [-0.22, A.toDist + A.air, 0, 'f']; k.Lft = [0.22, A.toDist + A.air, 0, 'f'];
    }
  }
  out.push([A.TO + th(A.h, A.g || 1), { ev: 'apex' }]);
  return out;
}

/**
 * Yao's up-and-under ([ANIM §9.5] Y6, shot part) on anchors A = { s, TO, rel, land, end, h, g }. Source: plantR 0.20,
 * takeoff 0.40, release 0.57, land 0.75, end 1.00; root 0.60 forward over [0, takeoff].
 */
export function tplUpUnder(A) {
  const m = remap([0, 0.40, 0.57, 0.75, 1.00], [0, A.TO, A.rel, A.land, A.end]);
  const keys = [
    [0, { RA: [110, 60, -20, 130, 60, -40, 0], LA: [90, 40, 30, 110, 0, -20, 0], B: 'R', RF: 'grip', LF: 'relax', P: [0, -0.10, 0, 6, 0, 0],
      S: [8, 0, 0], N: [-10, 0, 0], Rft: null, Lft: [0.37, 0, 0, 't'], RL: [30, 10, 0, 50, 10, 0], LL: [35, 8, 0, 45, -10, 0], look: 'rim', R: [0, 0, 0] }],
    [0.10, { ...SHORT.CHEST, S2: [20, null, null], N: [-15, 0, 0], RL: [40, 5, 0, 60, 15, 0], B: 'both' }],
    [0.20, { Rft: [-0.05, 0.60, 0, 'f'], RL: [40, 6, 0, 50, -15, 0], P: [0, -0.16, 0, 14, 0, 0], ev: 'plantR' }],
    [0.30, { Lft: null, LL: [60, 8, 0, 90, 15, 0], RA: [100, 15, 15, 90, 0, -30, 0], LA: [95, 15, 30, 90, 0, -20, 0], B: 'R' }],
    [0.40, { Rft: null, RL: LEG.takeoff, LL: [80, 5, 0, 90, 30, 0], P: [0, -0.03, 0, 2, 0, 0], S: [2, 0, 0], RA: [140, 10, 10, 40, -50, -10, 0], LA: [60, 30, 30, 60, 0, 0, 0], B: 'R', LF: 'relax', R: [0, 0.60, 0], ev: 'takeoff' }],
    [0.57, { RA: [160, 10, 0, 10, -70, 15, 0], B: 'free', RF: 'relax', ev: 'release' }],
    [0.65, { RA: [158, 10, 0, 8, -70, 30, 0] }],
    [0.75, { RL: LEG.layLand, LL: LEG.layLand, Rft: [-0.20, 0.68, 0, 'f'], Lft: [0.20, 0.68, 0, 'f'], P: [0, -0.09, 0, 6, 0, 0], ev: 'land' }],
    [1.00, { P: [0, -0.03, 0, 3, 0, 0], S: [4, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax' }],
  ];
  const out = keys.map(([t, k]) => [t <= 0.40 ? t * A.s : m(t), k]);
  out.push([A.TO + th(A.h, A.g || 1), { ev: 'apex' }]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Layup family generics (spec §4.9.3; select.js layScaled)
// ---------------------------------------------------------------------------------------------------------------

/**
 * makeLayFamily(p, variant): 'reverse' (Kyrie's keys at the player's tempo), 'euro' (Giannis' keys, steps × 0.75,
 * press [3.0, 5.2]), 'power' (two-foot jump stop, shield arm), 'upUnder' (Yao's keys at the player's tempo).
 */
export function makeLayFamily(p, variant) {
  const L = FORMS[p].lay;
  const g = L.gScale;
  const tp = STYLE[p].tempo;
  let src, h = L.h, keys, extra = {};
  if (variant === 'reverse') src = { tempo: STYLE.kyrie.tempo, TO: 0.37, relVsApex: -0.03, meterFrom: 0.20, gw: [0.8, 4.0] };
  else if (variant === 'euro') src = { tempo: STYLE.giannis.tempo, TO: 0.83, relVsApex: 0, meterFrom: 0.60, gw: [3.0, 5.2], dTO: 1.6, toDist: 2.5 };
  else if (variant === 'power') src = { tempo: 1, TO: 0.26, relVsApex: -0.03, meterFrom: 0, gw: [0, 4.0] };
  else { src = { tempo: STYLE.yao.tempo, TO: 0.40, relVsApex: 0, meterFrom: 0.10, gw: [0, 3.0] }; h = 0.15 * L.h / FORMS.yao.lay.h; }
  const s = tp / src.tempo;
  const TO = src.TO * s, half = th(h, g), apex = TO + half, rel = apex + src.relVsApex, land = TO + 2 * half, dur = land + 0.30;
  const A = { s, TO, rel, land, end: dur, h, g };
  if (variant === 'reverse') keys = tplReverseLay(A);
  else if (variant === 'upUnder') keys = tplUpUnder(A);
  else if (variant === 'euro') {
    const k = 1 / SLEG[p];
    keys = tplEuro({ ...A, steps: 0.75, toDist: src.toDist * k, air: Math.max(0, src.dTO - 0.45) * k }, 'lay');
    extra = { target: 'takeoff' };
  } else {
    // lay.power: two-foot jump stop 1.2–1.8 m out (pelvis −0.20·sLeg), two-foot takeoff, off arm shields
    const tS = 0.12 * s;
    keys = [
      [0, { P: [0, -0.10, 0, 12, 0, 0], S: [15, 0, 0], N: [-10, 0, 0], ...SHORT.CHEST, B: 'both', RF: 'grip', LF: 'grip', Rft: null, Lft: null,
        RL: [40, 6, 0, 60, 20, 0], LL: [10, 6, 0, 40, 25, 0], look: 'rim', R: [0, 0, 0], ev: 'gather' }],
      [tS, { P: [0, -0.20, 0, 16, 0, 0], S: [18, 0, 0], Rft: [-0.25, 0.45, 5, 'f'], Lft: [0.25, 0.45, -5, 'f'], RL: LEG.dunkPlant, LL: LEG.dunkPlant,
        RA: GRIP2.chinOut, LA: GRIP2.chinOut, ev: ['plantL', 'plantR'] }],
      // the grip holds through the deepest load; the right hand takes the ball alone as both arms start to swing
      [(tS + TO) / 2, { RA: GRIP2.chinOut, LA: GRIP2.chinOut, B: 'R' }],
      [TO, { P: [0, -0.03, 0, 2, 0, 0], S: [4, 0, 0], N: [-15, 0, 0], RL: LEG.dunkTakeoff, LL: LEG.dunkTakeoff, Rft: null, Lft: null,
        RA: [110, 15, 15, 70, 50, -35, 0], LA: [90, 50, 0, 30, -20, 0, 0], B: 'R', LF: 'spread', ev: 'takeoff' }],
      [TO + 0.08, { LA: ARM.powerShield, RA: ARM.layCarry, RL: [25, 8, 0, 40, 30, 0], LL: [25, 8, 0, 40, 30, 0] }],
      [apex, { ev: 'apex' }],
      [rel, { RA: ARM.layRelease, B: 'free', E: { jawOpen: 0.4 }, ev: 'release' }],
      [rel + 0.10, { RA: ARM.layFlick, RF: 'snap' }],
      [land, { RL: LEG.dunkLand, LL: LEG.dunkLand, Rft: [-0.25, 0.6, 0, 'f'], Lft: [0.25, 0.6, 0, 'f'], P: [0, -0.15, 0, 12, 0, 0], LA: [40, 30, 0, 40, 0, 0, 0], ev: 'land' }],
      [dur, { P: [0, -0.05, 0, 5, 0, 0], S: [5, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax', E: { jawOpen: 0 } }],
    ];
  }
  if (variant !== 'power') keys.push([rel, { E: { jawOpen: 0.3 } }], [dur, { E: { jawOpen: 0 } }]);
  if (p === 'jordan') {
    const tg = variant === 'reverse' ? 0.20 * s : variant === 'euro' ? 0.23 * s : 0;
    keys.push(...faceKeysJordan(tg, land, dur));
  }
  // root: reverse / power / upUnder travel R over [0, land] (select layScaled rWin); euro is target-matched
  if (variant === 'reverse') keys.push([land, { R: [0, 2.0, 0] }]);
  if (variant === 'upUnder') keys.push([land, { R: [0, 0.60, 0] }]);
  if (variant === 'power') keys.push([0.12 * s, { R: [0, 0.45, 0] }], [TO, { R: [0, 0.55, 0] }], [land, { R: [0, 0.6, 0] }]);
  return defineJump({
    id: 'lay.' + variant, dur, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h, gScale: g }, meter: 'key',
    hand: 'R', cancel: land + 0.10, blendIn: 0.08, blendOut: 0.20, ...extra,
    params: { cat: 'layup', meterFrom: src.meterFrom * s, tIdeal: rel - 0.05, gatherWindow: src.gw },
    keys,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Dunks (spec §4.9.4, [ANIM §5.6])
// ---------------------------------------------------------------------------------------------------------------

/**
 * makeDunk(p, type): 'power2' (two hands off two feet, hang 0.20), 'tomahawk1' (right hand off the left foot,
 * 2-step, hang 0.15), 'simple1' (one hand off two feet, no hang). Jordan's generic dunks use gravity × 0.80 (C12).
 * Vertical profile rise–hang–drop: SLAM at takeoff + the §4.9.4 slam time, RIM_GRAB 0.03 later, RIM_RELEASE after
 * the hang, LAND after the drop from h − 0.05.
 */
export function makeDunk(p, type) {
  const D = FORMS[p].dunk;
  const tp = STYLE[p].tempo;
  const g = p === 'jordan' ? 0.80 : 1;
  const two = type === 'power2';
  const h = two ? D.h2 : D.h1;
  const slamAfter = (two ? D.slam2 : D.slam1) / Math.sqrt(g);
  const TO = (type === 'tomahawk1' ? 0.32 : 0.26) * tp;
  const hang = type === 'power2' ? 0.20 : type === 'tomahawk1' ? 0.15 : 0;
  const slam = TO + slamAfter;
  const airT = hang > 0 ? slamAfter + 0.03 + hang + Math.sqrt(2 * (h - 0.05) / (G * g)) : 2 * th(h, g);
  const land = TO + airT;
  const dur = land + (two ? 0.35 : 0.30);
  const dTO = type === 'tomahawk1' ? 1.6 : 1.15, toDist = type === 'tomahawk1' ? 1.3 : 0.5;
  const k = 1 / SLEG[p];
  const zTO = toDist * k, zSlam = (toDist + Math.max(0, dTO - 0.35)) * k;
  const [f0, f1] = FACE_DUNK[p];
  const keys = [[0, { R: [0, 0, 0] }], [TO, { R: [0, zTO, 0] }], [slam, { R: [0, zSlam, 0] }]];
  const Rk = keys.slice();
  if (type === 'tomahawk1') {
    const tL = 0.24 * tp;
    keys.push(
      [0, { B: 'R', RA: ARM.ballCupped, LA: [35, 20, 0, 40, 10, 0, 0], Rft: [-0.12, 0, 0, 'f'], Lft: null, P: [0, -0.08, 0, 10, 0, 0], S: [12, 0, 0],
        N: [-10, 0, 0], RL: [15, 5, 0, 25, -5, 0], LL: [40, 5, 0, 70, 10, 0], RF: 'grip', look: 'rim', ev: ['gather', 'plantR'] }],
      [0.10 * tp, { Rft: null, RL: [35, 5, 0, 60, 15, 0], LL: [20, 5, 0, 30, 0, 0] }],
      [tL, { Lft: [0.10, rootAt(Rk, tL)[1] + 0.30, 0, 'f'], P: [0, -0.14, 0, -8, 0, 0], S: [-4, 0, 0], LL: [30, 5, 0, 45, -15, 0], RL: [50, 5, 0, 90, 20, 0], ev: 'plantL' }],
      [TO, { Lft: null, LL: [-10, 3, 0, 10, 40, 0], RL: [95, 5, 0, 100, 30, 0], LA: [120, 20, 20, 20, 0, 0, 0], P: [0, -0.03, 0, 0, 0, 0], E: f0, ev: 'takeoff' }],
      [TO + 0.05, { RL: [100, 5, 0, 100, 30, 0] }],
      // ball cocked behind the right ear, then thrown over the rim; the hammer follows the release
      [Math.min(TO + 0.20, slam - 0.08), { RA: [175, 20, -15, 110, 0, -40, 0], S: [-15, 0, 0], N: [-15, 0, 0], LL: [20, 5, 0, 40, 30, 0], E: { jawOpen: 0.5 } }],
      [slam - 0.04, { RA: [174, 10, 10, 15, 50, -45, 0] }],
      [slam, { ...SLAM1, B: 'free', N: [-10, 0, 0], E: f1, ev: 'slam' }],
      [slam + 0.03, { RF: 'claw', LA: [60, 30, 0, 40, 0, 0, 0], RL: LEG.dunkHang, LL: LEG.dunkHang, ev: 'rimGrab' }],
      [slam + 0.07, { RA: [160, 8, 10, 15, 90, 40, 0], S: [10, 0, -5], RC: [0, 0] }],
      [slam + 0.03 + hang, { RA: [140, 12, 0, 30, 60, 0, 0], RF: 'relax', ev: 'rimRelease' }],
    );
  } else {
    const tS = 0.12 * tp;
    keys.push(
      [0, { P: [0, -0.10, 0, 15, 0, 0], S: [18, 0, 0], N: [-12, 0, 0], RA: [40, 25, 30, 110, 30, -30, 0], LA: [40, 25, 30, 110, 30, -30, 0], B: 'both',
        RF: 'grip', LF: 'grip', Rft: null, Lft: null, RL: [30, 5, 0, 45, 10, 0], LL: [-5, 5, 0, 25, 25, 0], look: 'rim', ev: 'gather' }],
      [tS, { P: [0, -0.18, 0, 18, 0, 0], Rft: [-0.25, rootAt(Rk, tS)[1] + 0.15, 5, 'f'], Lft: [0.25, rootAt(Rk, tS)[1] + 0.15, -5, 'f'],
        RL: LEG.dunkPlant, LL: LEG.dunkPlant, ev: ['plantL', 'plantR'] }],
      [TO, { P: [0, -0.02, 0, 0, 0, 0], S: [-5, 0, 0], RA: GRIP2.rise, LA: GRIP2.rise, Rft: null, Lft: null,
        RL: LEG.dunkTakeoff, LL: LEG.dunkTakeoff, E: f0, ev: 'takeoff' }],
    );
    if (two) {
      keys.push(
        [slam - 0.10, { RA: GRIP2.cock, LA: GRIP2.cock, S: [-12, 0, 0], N: [-15, 0, 0], RL: LEG.dunkTuck, LL: LEG.dunkTuck }],
        [slam, { RA: GRIP2.slam, LA: GRIP2.slam, RC: [10, 0], LC: [10, 0], S: [4, 0, 0], N: [-10, 0, 0], B: 'free', E: f1, ev: 'slam' }],
        [slam + 0.03, { RF: 'claw', LF: 'claw', RL: LEG.dunkHang, LL: LEG.dunkHang, ev: 'rimGrab' }],
        [slam + 0.09, { RA: [160, 12, 0, 25, 90, 30, 0], LA: [160, 12, 0, 25, 90, 30, 0], RC: [0, 0], LC: [0, 0], S: [12, 0, 0] }],
        [slam + 0.03 + hang, { RA: [140, 15, 0, 40, 60, 0, 0], LA: [140, 15, 0, 40, 60, 0, 0], RF: 'relax', LF: 'relax', ev: 'rimRelease' }],
      );
    } else {
      keys.push(
        [TO + 0.10, { B: 'R', LA: [110, 25, 0, 30, 0, 0, 0], LF: 'relax', RA: [170, 15, 0, 30, 40, -20, 0] }],
        [slam - 0.06, { RA: [172, 10, 10, 25, 50, -40, 0], RL: [50, 10, 0, 80, 30, 0], LL: [50, 10, 0, 80, 30, 0] }],
        [slam, { ...SLAM1, B: 'free', E: f1, ev: 'slam' }],
        [slam + 0.10, { RA: [140, 10, 0, 5, 90, 60, 0], RF: 'relax', S: [8, 0, 0], RC: [0, 0] }],
      );
    }
  }
  keys.push(
    [TO + th(h, g), { ev: 'apex' }],
    [land, { RL: LEG.dunkLand, LL: LEG.dunkLand, Rft: [-0.25, zSlam + 0.10, 0, 'f'], Lft: [0.25, zSlam + 0.10, 0, 'f'], P: [0, -0.15, 0, 15, 0, 0],
      S: [10, 0, 0], RA: [60, 25, 0, 50, 30, 0, 0], LA: [50, 25, 0, 50, 30, 0, 0], ev: 'land' }],
    [dur, { P: [0, -0.06, 0, 6, 0, 0], S: [6, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax', ...(p === 'jordan' ? {} : { E: settleFace(f1) }) }],
  );
  if (p === 'jordan') keys.push(...faceKeysJordan(0, land, dur));
  return defineJump({
    id: 'dunk.' + type, dur, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h, gScale: g, hang }, meter: false,
    hand: 'R', cancel: land + 0.10, blendIn: 0.10, blendOut: 0.25, target: 'takeoff',
    params: { cat: 'dunk', hands: two ? 2 : 1, gatherWindow: [0.6, 4.0], dTO, toDist },
    keys,
  });
}

/** Face at the end of a dunk: the slam expression settles (a roar keeps 0.3 for the celebration that follows). */
function settleFace(f) { const o = {}; for (const n of Object.keys(f)) o[n] = n === 'roar' ? 0.3 : 0; return o; }

// ---------------------------------------------------------------------------------------------------------------
// Other generic shots (spec §4.9.2, [ANIM §5.4]; select.js timing)
// ---------------------------------------------------------------------------------------------------------------

/** shot.stepbackJ: plant 0.06, push back (0.70 m; Kyrie 0.80, LeBron 0.50) + 0.12 fade, land 0.28/0.32, takeoff 0.42·tempo. */
export function makeStepbackJ(p) {
  const F = FORMS[p];
  const tp = STYLE[p].tempo;
  const TO = 0.42 * tp, h = F.h.pull, half = th(h);
  const tI = TO + half + F.rva - 0.05;
  const T = { TO, apex: TO + half, tSet: Math.max(TO - 0.05, tI - F.setLead), tRel: tI + 0.05, tLand: TO + 2 * half };
  T.tEnd = Math.max(T.tLand + 0.25, T.tRel + F.followHold + 0.15);
  const push = p === 'kyrie' ? 0.80 : p === 'lebron' ? 0.50 : 0.70;
  const zl = -push;                                                // landing of the push-back (start frame)
  const keys = [
    [0, { P: [0, -0.10, 0, 12, 0, 0], S: [14, 0, 0], N: [-10, 0, 0], RA: ARM.dribJog, LA: [30, 20, 0, 40, 10, 0, 0], B: 'drib', RF: 'grip',
      Rft: [-0.20, 0.0, 0, 'f'], Lft: null, RL: [25, 6, 0, 40, -8, 0], LL: [40, 5, 0, 55, 10, 0], look: 'rim', R: [0, 0, 0] }],
    [0.06 * tp, { Lft: [0.18, 0.35, 5, 'f'], LL: [40, 6, 0, 55, -12, 0], Rft: null, RL: [20, 6, 0, 50, 20, 0], P: [0, -0.14, 0.03, 14, 0, 0], ev: 'plantL' }],
    [0.10 * tp, { R: [0, 0, 0] }],
    [0.12, { B: 'both', ...SHORT.CHEST, LF: 'grip' }],
    [0.16 * tp, { Lft: null, LL: [30, 6, 0, 50, 25, 0], RL: [25, 6, 0, 45, 25, 0], P: [0, -0.04, 0, 6, 0, 0], S: [6, 0, 0] }],
    [0.28 * tp, { Lft: [0.20, zl, 10, 'f'], LL: [40, 6, 4, 60, -20, 0], P: [0, -0.12, 0, 10, 0, 0], ev: 'plantL' }],
    [0.32 * tp, { Rft: [-0.20, zl, 10, 'f'], RL: [40, 6, 4, 60, -20, 0], ev: 'plantR' }],
    [0.6 * (TO - 0.32 * tp) + 0.32 * tp, { P: [0, -F.dip, 0, 10, 0, 0], RL: [30, 6, 4, F.kneeDip + 10, Math.max(-30, -(F.kneeDip - 20)), 0],
      LL: [30, 6, 4, F.kneeDip + 10, Math.max(-30, -(F.kneeDip - 20)), 0],
      RA: DIP_ARMS[F.ballAtDip].RA, LA: DIP_ARMS[F.ballAtDip].LA, N: [-12, 0, 0] }],
  ];
  keys.push(...jumpTail(p, T, {
    lean: F.fadeLean ? F.fadeLean * 0.5 : 0, air: { R: [12, 18], L: [12, 18] }, drift: push + 0.12,
    land: { R: [-0.20, zl - 0.12], L: [0.20, zl - 0.15], yaw: 10 }, R: [0, -(push + 0.12), 0], face: FACE_SHOT[p],
  }));
  keys.push([0.28 * tp, { R: [0, -push * 0.95, 0] }]);
  return defineClip({
    id: 'shot.stepbackJ', dur: T.tEnd, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h }, hand: 'R',
    cancel: T.tLand + 0.10, blendIn: 0.06, blendOut: 0.20,
    params: { cat: 'jumper', meterFrom: 0, tIdeal: tI },
    keys,
  });
}

/**
 * Generic post turnaround (`shot.turnFade`, [ANIM §5.4]): Jordan-style left-foot pivot 180° over the right shoulder
 * (authored for the left block; the right block plays '_L'), pivot over 0.33–0.60·tempo, load to 0.70·tempo,
 * takeoff 0.70·tempo, fade per form. meterFrom = tIdeal − 0.80·METER_T(mid) (select.js).
 */
export function makeTurnFade(p) {
  const F = FORMS[p];
  const tp = STYLE[p].tempo;
  const fadeH = F.h.fade !== null ? F.h.fade : F.h.mid;
  const TO = 0.70 * tp, half = th(fadeH);
  const tI = TO + half + F.rva - 0.05;
  const T = { TO, apex: TO + half, tSet: Math.max(TO - 0.05, tI - F.setLead), tRel: tI + 0.05, tLand: TO + 2 * half };
  T.tEnd = Math.max(T.tLand + 0.25, T.tRel + F.followHold + 0.15);
  const jm = jumperTimes(p, 'mid');
  const MT = jm.tI / 0.80;
  const mf = tI - 0.80 * MT;
  const drift = F.fadeDrift || 0.30;
  const lean = F.fadeLean || 8;
  const air = F.takeoff.fade !== null ? F.airFade : { R: [15, 20], L: [15, 20] };
  const keys = [
    [0, { P: [0, -0.12, 0, 12, 0, 0], S: [20, 0, 0], N: [-20, -30, 0], RA: [50, 45, 30, 120, 20, -25, 0], LA: [50, 45, 30, 120, 20, -25, 0],
      RL: LEG.postUp, LL: LEG.postUp, Rft: [-0.28, 0, 0, 'f'], Lft: [0.27, 0, 0, 't'], B: 'both', RF: 'grip', LF: 'grip', look: 'none', R: [0, 0, 0] }],
    [0.20 * tp, { P: [null, null, null, null, 12, null], S: [null, 12, null] }],
    [0.30 * tp, { P: [null, null, null, null, 0, null], S: [null, 0, null], Rft: null, RL: [30, 25, 0, 60, 10, 0] }],
    [0.33 * tp, { R: [0, 0, 0] }],
    [0.45 * tp, { R: [0.40, 0.02, -90], P: [0, -0.15, 0, 10, -15, 0], ...SHORT.CHIN, look: 'rim' }],
    [0.60 * tp, { R: [0.45, 0, -180], Lft: [0.27, 0, -180, 't'], Rft: [0.72, 0, -180, 'f'], P: [0, -0.17, 0, 10, 0, 0], S: [8, 0, 0], N: [-12, 0, 0],
      RL: [45, 6, 0, 65, -20, 0], LL: [45, 6, 0, 65, -20, 0], ev: ['plantR', 'gather'] }],
    [0.66 * tp, { RA: DIP_ARMS.chest.RA, LA: DIP_ARMS.chest.LA, Lft: [0.27, 0, -180, 'f'] }],
  ];
  keys.push(...jumpTail(p, T, {
    lean, air, land: { R: [0.65, drift], L: [0.25, drift], yaw: -180 }, R: [0.45, drift, -180], face: FACE_SHOT[p],
  }));
  return defineClip({
    id: 'shot.turnFade', dur: T.tEnd, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false, jump: { h: fadeH },
    hand: 'R', cancel: T.tLand + 0.10, blendIn: 0.06, blendOut: 0.20, target: 'takeoff',
    params: { cat: 'jumper', meterFrom: mf, tIdeal: tI, METER_T: MT, baseSide: 'L' },
    keys,
  });
}

/** Generic jump hook (`shot.hook` = Yao's keys at the player's tempo, h 0.22, release apex − 0.02). */
export function makeHook(p) {
  const s = STYLE[p].tempo;
  const TO = 0.60 * s, h = 0.22, rel = TO + th(h) - 0.02, land = TO + 2 * th(h), dur = land + 0.30;
  return defineJump({
    id: 'shot.hook', dur, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false, jump: { h }, meter: 'key',
    hand: 'R', cancel: land + 0.10, blendIn: 0.06, blendOut: 0.20,
    params: { cat: 'layup', meterFrom: 0.30 * s, tIdeal: rel - 0.05, baseSide: 'L' },
    keys: tplHook({ s, TO, rel, land, end: dur, h, contact: false }),
  });
}

/** Generic floater (`shot.floaterGeneric` = Kyrie's floater at tempo 1.08, h × 0.9, air keys × the airtime ratio). */
export function makeFloater(/* p */) {
  const TO = 0.17 * 1.08, h = 0.40 * 0.9;
  const airScale = th(h) / th(0.40);
  const rel = TO + (0.40 - 0.17) * airScale, land = TO + 2 * th(h), dur = land + 0.30;
  const keys = tplFloater({ TO, rel, land, end: dur, h }, false);
  keys.push([land, { R: [0, 0.40, 0] }]);
  return defineJump({
    id: 'shot.floaterGeneric', dur, mask: 'full', root: 'motion', entry: 'replace', tempo: false, jump: { h }, meter: 'key',
    hand: 'R', cancel: land + 0.10, blendIn: 0.06, blendOut: 0.20,
    params: { cat: 'layup', meterFrom: 0, tIdeal: rel - 0.05, gatherWindow: [2.2, 4.5] },
    keys,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Putbacks ([ANIM §5.7]; C8: h = hJump)
// ---------------------------------------------------------------------------------------------------------------

/** Tip / putback jump heights = GP hJump (C8), the nominal values select.js times them with. */
const HJ = HJUMP;

/** put.tip: load 0.10 (P dy −0.14), two-foot takeoff, tipping arm up, CONTACT at the apex with a wrist flick. */
export function makeTip(p) {
  const h = HJ[p], TO = 0.10, half = th(h), apex = TO + half, land = TO + 2 * half, dur = land + 0.25;
  return defineJump({
    id: 'put.tip', dur, mask: 'full', root: 'none', tempo: false, jump: { h }, hand: 'R', cancel: land + 0.05, blendIn: 0.05, blendOut: 0.20,
    params: { cat: 'tip' },
    keys: [
      [0, { P: [0, -0.05, 0, 8, 0, 0], S: [8, 0, 0], N: [-20, 0, 0], RA: [60, 20, 0, 40, 0, 0, 0], LA: [50, 25, 0, 40, 0, 0, 0], RL: [20, 8, 0, 30, -8, 0],
        LL: [20, 8, 0, 30, -8, 0], look: 'ball' }],
      [0.06, { P: [0, -0.14, 0, 12, 0, 0], RL: LEG.load, LL: LEG.load, RA: [-15, 15, 0, 20, 0, 0, 0], LA: [-15, 15, 0, 20, 0, 0, 0] }],
      [TO, { P: [0, -0.03, 0, 2, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, RA: [140, 10, 0, 20, 0, -10, 0], LA: [100, 25, 0, 30, 0, 0, 0], RF: 'spread', ev: 'takeoff' }],
      [apex - 0.06, { RA: ARM.tipArm, LA: ARM.tipOther, RL: [10, 6, 0, 15, 30, 0], LL: [10, 6, 0, 15, 30, 0], S: [0, 0, 0], N: [-30, 0, 0] }],
      [apex, { RA: [175, 10, 0, 5, 0, -10, 0], ev: ['apex', 'contact'] }],
      [apex + 0.06, { RA: [175, 10, 0, 5, 0, 40, 0] }],
      [land, { P: [0, -0.12, 0, 10, 0, 0], RL: LEG.contestLand, LL: LEG.contestLand, RA: [120, 15, 0, 30, 0, 20, 0], LA: [80, 25, 0, 40, 0, 0, 0], RF: 'relax', ev: 'land' }],
      [dur, { P: [0, -0.04, 0, 4, 0, 0], S: [4, 0, 0], N: [-5, 0, 0], ...SHORT.DOWN }],
    ],
  });
}

/** put.dunk: catch both hands at the apex, slam 0.10 s later, no hang, roar 0.8 (LeBron, Giannis, Yao). */
export function makePutDunk(p) {
  const h = HJ[p], TO = 0.10, half = th(h), apex = TO + half, slam = apex + 0.10, land = TO + 2 * half, dur = land + 0.30;
  return defineJump({
    id: 'put.dunk', dur, mask: 'full', root: 'none', tempo: false, jump: { h }, meter: false, hand: 'R', cancel: land + 0.10,
    blendIn: 0.05, blendOut: 0.25, params: { cat: 'dunk', hands: 2 },
    keys: [
      [0, { P: [0, -0.05, 0, 8, 0, 0], S: [8, 0, 0], N: [-20, 0, 0], RA: [60, 20, 0, 40, 0, 0, 0], LA: [60, 20, 0, 40, 0, 0, 0], RL: [20, 8, 0, 30, -8, 0],
        LL: [20, 8, 0, 30, -8, 0], look: 'ball' }],
      [0.06, { P: [0, -0.14, 0, 12, 0, 0], RL: LEG.load, LL: LEG.load, RA: [-15, 15, 0, 20, 0, 0, 0], LA: [-15, 15, 0, 20, 0, 0, 0] }],
      [TO, { P: [0, -0.03, 0, 2, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, RA: [140, 15, 0, 25, -40, -10, 0], LA: [140, 15, 0, 25, -40, -10, 0], RF: 'spread', LF: 'spread', ev: 'takeoff' }],
      [apex - 0.05, { RA: [172, 15, 0, 20, -60, -10, 0], LA: [172, 15, 0, 20, -60, -10, 0], RL: LEG.reboundAir, LL: LEG.reboundAir, E: { roar: 0.4 } }],
      [apex, { B: 'both', RF: 'grip', LF: 'grip', RA: GRIP2.overhead, LA: GRIP2.overhead, ev: ['apex', 'catch'] }],
      [slam, { RA: GRIP2.slam, LA: GRIP2.slam, RC: [10, 0], LC: [10, 0], B: 'free', S: [6, 0, 0], E: { roar: 0.8 }, ev: 'slam' }],
      [slam + 0.09, { RA: HAMMER2, LA: HAMMER2, RC: [0, 0], LC: [0, 0], S: [12, 0, 0] }],
      [land, { P: [0, -0.15, 0, 12, 0, 0], RL: LEG.dunkLand, LL: LEG.dunkLand, RA: [60, 25, 0, 50, 30, 0, 0], LA: [60, 25, 0, 50, 30, 0, 0], RF: 'relax', LF: 'relax', ev: 'land' }],
      [dur, { P: [0, -0.06, 0, 6, 0, 0], S: [6, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, E: { roar: 0.3 } }],
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Defensive stance key and the steal generator ([ANIM §6.7]; C25) — shared by common.js and jordan.js
// ---------------------------------------------------------------------------------------------------------------

const DEFS = STANCE.def.default;
/** Defensive stance feet (default width 0.75 × sLeg, toe-locked). */
export const DEF_FEET = defFeet(DEFS.width);
/** Defensive stance key (start pose of the defensive clips). */
export const DEF_KEY = Object.freeze({
  P: DEFS.P, S: DEFS.S, N: DEFS.N, RA: DEFS.RA, LA: DEFS.LA,
  RL: [40, 14, 0, 60, -12 + DEF_FEET.ank, 0], LL: [40, 14, 0, 60, -12 + DEF_FEET.ank, 0],
});

/** Swipe time per player ([ANIM §6.7]; C25): 0.12, Kyrie 0.10, Yao / LeBron 0.14. */
export const SWIPE = Object.freeze({ kobe: 0.12, jordan: 0.12, lebron: 0.14, giannis: 0.12, yao: 0.14, kyrie: 0.10 });

/**
 * def.steal (and Jordan's sig.jordan.steal): lunge 0.30·sLeg with the ball-side foot, the reaching arm swipes upward
 * knee → waist, SWIPE at the player's time. Times are absolute (tempo false) so SWIPE fires at the spec time; Jordan
 * runs out at 4 m/s toward the ball (exitV).
 */
export function makeSteal(p, id = 'def.steal') {
  const sw = SWIPE[p];
  const jordan = id === 'sig.jordan.steal';
  return defineClip({
    id, dur: 0.42, mask: 'full', root: 'motion', entry: 'replace', tempo: false, hand: 'R', cancel: 0.30, blendIn: 0.04, blendOut: 0.15,
    params: { cat: 'steal', ...(jordan ? { exitV: [0, 4.0] } : {}) },
    keys: [
      [0.00, { ...DEF_KEY, Rft: DEF_FEET.Rft, Lft: DEF_FEET.Lft, R: [0, 0, 0], look: 'ball' }],
      [0.02, { Rft: null, RL: [50, 10, 0, 70, 10, 0] }],
      [0.04, { R: [0, 0, 0], S: [15, -20, 0], P: [0, -0.16, 0.08, 18, -10, 0], RA: ARM.stealStart, LA: [60, 45, 0, 40, 0, 0, 0] }],
      [sw, { RA: [50, 25, 10, 22, 60, 5, 0], Rft: [-0.30, 0.30, 0, 't'], RL: [45, 10, 0, 55, -15, 0], ev: 'swipe' }],
      [0.16, { R: [0, 0.30, 0] }],
      [sw + 0.04, { RA: ARM.stealEnd, RF: 'claw' }],
      [0.20, { RA: [75, 25, 10, 20, 60, 35, 0], S: [18, -15, 0] }],
      jordan
        ? [0.42, { P: [0, -0.10, 0, 16, 0, 0], S: [20, 0, 0], N: [-15, 0, 0], RA: [40, 15, 0, 80, 20, 0, 0], LA: [-20, 15, 0, 80, 20, 0, 0], RF: 'relax', RL: [45, 6, 0, 60, 20, 0], look: 'ball' }]
        : [0.42, { ...DEF_KEY, RF: 'relax' }],
    ],
  });
}

/** Clip id → generator(p) for every generator-built id (registered per player by common.js). */
export const SHOT_GENERATORS = Object.freeze({
  'shot.mid': (p) => makeJumper(p, 'mid'),
  'shot.three': (p) => makeJumper(p, 'three'),
  'shot.pull12': (p) => makeJumper(p, 'pull12'),
  'shot.pullHop': (p) => makeJumper(p, 'pullHop'),
  'shot.fade': (p) => makeJumper(p, 'fade'),
  'shot.stepbackJ': makeStepbackJ,
  'shot.turnFade': makeTurnFade,
  'shot.hook': makeHook,
  'shot.floaterGeneric': makeFloater,
  'lay.std2': (p) => makeLayup(p, 'std2'),
  'lay.std1': (p) => makeLayup(p, 'std1'),
  'lay.fingerRoll': (p) => makeLayup(p, 'fingerRoll'),
  'lay.fingerRoll1': (p) => makeLayup(p, 'fingerRoll1'),
  'lay.reverse': (p) => makeLayFamily(p, 'reverse'),
  'lay.euro': (p) => makeLayFamily(p, 'euro'),
  'lay.power': (p) => makeLayFamily(p, 'power'),
  'lay.upUnder': (p) => makeLayFamily(p, 'upUnder'),
  'dunk.power2': (p) => makeDunk(p, 'power2'),
  'dunk.tomahawk1': (p) => makeDunk(p, 'tomahawk1'),
  'dunk.simple1': (p) => makeDunk(p, 'simple1'),
  'put.tip': makeTip,
  'put.dunk': makePutDunk,
});
