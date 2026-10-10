/**
 * clip.js — clip DSL, compiler, sampler, clip clock (time-warp / holds / jumps), root motion, event ring and the
 * clip registry (spec §4.2–§4.5, [ANIM §2.2, §2.4, §2.5]).
 *
 * Exports
 *   EV, EV_NAMES, BM, BM_NAMES, HAND, FX, FPS, defineClip, mirrorDef, compileClip, sampleClip, sampleRoot, sampleBall,
 *   clipTiming, makeTimingClip, timingDef, validateClip, rhythmElev, hermiteMonotone, ClipClock, RootMotion, EventRing,
 *   registry: clipIndex, registerClip, getClip, getDef, hasClip, clipIdOf, clipCount, clipIds, compileAll,
 *   SAMPLE_AIR_LINEAR (sampleClip flag), FINGER_PRESETS (re-export).
 *
 * ================================================ AUTHORING GUIDE ================================================
 *
 * 1. A clip is a plain object passed to defineClip() (clips/*.js modules: data only, no fetch/JSON):
 *
 *      export const CLIPS = [defineClip({
 *        id: 'move.cross', dur: 0.40, mask: 'full', root: 'motion', entry: 'replace', hand: 'R', cancel: 0.30,
 *        tempo: true, blendIn: 0.06, blendOut: 0.12, params: { imm: [0.05, 0.30], exitV: [2.6, 3.0] },
 *        keys: [
 *          [0.00, { P: [0, -0.06, 0, 10, 0, 0], S: [14, 0, 0], RA: [30, 14, 15, 70, 90, 10, 0], B: 'path', Bp: [-0.30, 0.80, 0.28],
 *                   Rft: [-0.24, 0.10, 0, 't'], Lft: [0.22, -0.30, 0, 't'], R: [0, 0, 0] }],
 *          [0.13, { Bp: [0.00, 0.12, 0.36], Lft: null, LL: [45, 20, 0, 70, 15, 0], ev: 'bounce' }],
 *          ...
 *        ],
 *        ev: [[0.05, 'plantR'], [0.24, 'handOnL']],      // events may also be written inline as key `ev`
 *      })];
 *
 *    Clip-level fields (defaults): id (required, namespaces loco. drib. move. catch. shot. lay. dunk. put. def. reb. pass.
 *    cel. idle. chk. post. loose. sig.<player>.), dur (required, s), loop false, mask 'full' ('upper' 'arms' 'armR' 'armL'
 *    'legs' 'face'), layer 'action' ('upper' | 'add'), root 'none' ('motion' = the R curve drives velocity), entry
 *    'replace' ('carry' | 'stop'; root entry policy), entryDecel 18 (m/s², entry 'stop'), jump null or { h, hang, descending,
 *    gScale } (the clip has an airborne [takeoff, land] segment), tempo true (the player's STYLE.tempo scales non-air time;
 *    use false for clips whose times are already final: signature clips and the per-player generator output), meter
 *    (auto: 'hold' when the clip has set + release; write 'key' for layups / hooks / floaters that launch at their release
 *    key, false for passes), hand 'R' (the dominant hand; mirrorDef builds the 'L' twin), blendIn 0.06, blendOut 0.20,
 *    cancel = dur (from this clip time gameplay may interrupt), target null (event name used for target matching, e.g.
 *    'takeoff'), noRhythm false (true suppresses the automatic shoulder shrug), chain false, params {} (free data for
 *    select.js / gameplay: gatherWindow [dMin, dMax], imm [t0, t1], exitV [x, z] (m/s, clip-start frame), meterFrom,
 *    tIdeal, METER_T, carryScale [[t0, t1, k], ...], hands 1|2, cat), per { <playerId>: { tempo, jump, params, keys, ev } }
 *    (per-player overrides merged into a per-player compiled copy; keys are merged by time).
 *
 * 2. Key channels (sparse; omit any group; inside an array `null` means "not keyed here"):
 *      P   [dx, dy, dz, pitch, yaw, roll]  pelvis offsets in REFERENCE metres (× sLeg at runtime) + degrees
 *      S   [pitch, yaw, roll] total spine, split 0.30/0.35/0.35 (pitch, roll) and 0.30/0.33/0.37 (yaw) over
 *          spine_01/02/03; S1 / S2 / S3 key one segment explicitly (they override the split in the same key)
 *      N   [pitch, yaw, roll] total neck+head, split 0.40 neck / 0.60 head; Nk / Hd key one bone explicitly
 *      RC LC [elev, prot]   RA LA [flex, abd, int, elbow, pron, wFlex, wDev]   RL LL [hip, abd, int, knee, ank, toe]
 *      RF LF  finger preset name or [name, weight] (weight blends from 'relax'); presets: relax grip shoot snap spread
 *             palmUp fist point claw shh flat curlTape
 *      Rft Lft [x, z, yawDeg, 'f'|'t'] foot plant in the clip-start frame (m × sLeg; 'f' flat = ankle locked, 't' toe
 *             = ball joint locked) or null = released (FK swing). A planted foot may only change yaw / mode until it
 *             is released: put a null key between two different plant positions (compile throws otherwise).
 *      B   'R' 'L' 'both' 'drib' 'path' 'free' 'keep'   ball attachment from this key on (step)
 *      Bp  [x, y, z] ball centre in the clip-start frame (m × sLeg) for B 'path' (Catmull-Rom through the keys)
 *      E   { jawOpen, tongueOut, jawJut, roar, grin, smirk, scowl, puff, blink: weight }; an expression starts from 0
 *          at t = 0 unless keyed there, and holds its last value
 *      R   [x, z, yawDeg] cumulative root displacement in the clip-start frame (m × sLeg); implicit [0, 0, 0] at t = 0
 *      look 'rim' 'ball' 'man' 'target' 'passer' 'crowd' 'none' 'receiver' or [name, weight] (step)
 *      ev  'name' | ['name', ...] | [['fx', 'chalkBurst']] inline events at the key time
 *    Shorthands live in presets.js: SHORT.HIP_R / CHEST / CHIN / DOWN ({RA, LA}, spread them: `{...SHORT.CHEST}`),
 *    SET(p) GUIDE(p) REL(p) FOLLOW(p) (form arrays), ARM.*, LEG.*, STANCE.*, FORMS[p].
 *
 * 3. Signs (degrees, per side anatomical — the same numbers mean the same motion on either side):
 *      P: dx → character's left, dy up, dz forward; pitch = trunk forward (anterior tilt), yaw = turn to own left,
 *         roll = top of the pelvis toward own left. S/N: pitch = flex forward / nod down, yaw = turn left, roll = bend /
 *         ear toward own left. RC: elev = shrug, prot = shoulder forward. RA: flex = arm raised forward (0 hanging,
 *         90 horizontal, 180 overhead), abd = raised sideways, int = internal rotation, elbow 0 straight, pron relative to
 *         the bind palm (0 palms to the thighs, +90 palm back, −90 palm forward), wFlex palmar flexion (− cocked back),
 *         wDev toward the thumb. RL: hip = thigh forward, abd outward, int knee inward, knee flexion, ank plantar flexion
 *         (toes down; − = dorsiflexion), toe = toes bent up. R yaw positive = counter-clockwise from above (own left).
 *
 * 4. Mirror rule (exact, mirrorDef): swap the R and L groups (RA↔LA, RC↔LC, RL↔LL, RF↔LF, Rft↔Lft), negate P.dx, P.yaw,
 *    P.roll, every S/N yaw and roll, R.x, R.yaw, foot-target x and yaw, Bp.x, params.exitV[0]; B 'R'↔'L'; events
 *    plantL↔plantR, handOnL↔handOnR; hand R↔L; id gets the suffix '_L'. Author right-handed; the twin is automatic.
 *
 * 5. Events (EV codes): gather plantL plantR takeoff set release apex contact slam rimGrab rimRelease land catch bounce
 *    handOn(L/R) pickup swipe ready end handoff step slowmoIn slowmoOut fx fake. `end` is added at dur when missing.
 *    Every jumping clip needs takeoff < land (gameplay starts the ballistic jump at TAKEOFF and the clock warps
 *    [takeoff, land] to the airtime it computes); jump shots need set < release (the clock holds at set until the
 *    release input, then the push to release always takes 0.050 s); layups/hooks/floaters (meter 'key') launch at their
 *    release key unless the input is > 0.10 s off; dunks fire slam (+ rimGrab / rimRelease for hangs).
 *
 * 6. Root curves: R is sampled linearly from 30 Hz frames; velocity = dR/dt rotated by the start yaw (× sLeg). Entry
 *    'replace' takes the clip velocity, 'carry' adds the entry velocity decaying with τ 0.25 s (or params.carryScale
 *    factors), 'stop' adds the entry velocity braking at entryDecel until takeoff, constant in the air.
 *    Target matching (play(..., {target})) bends R by Δ·smoothstep(t / t_target), |Δ| ≤ max(0.25 m, 35 % of the
 *    clip's own displacement), |Δyaw| ≤ 25°.
 *
 * 7. Per-player parameters: generators (makeJumper/makeLayup/makeDunk) build one def per player and register it with
 *    registerClip(def, playerId); hand-authored clips may carry `per` overrides. Per-player numbers come from
 *    presets.FORMS / STYLE; never copy them into clip data.
 *
 * 8. Jump-shot tips (measured on the baked rig, see test/unit-anim.mjs `exampleJumper`): key the trunk (P pitch, S, N)
 *    again at the release so it stays extended through the launch — otherwise it pitches toward the landing key in
 *    flight and the ball leaves ≈ 0.07 m low; when `set` precedes `takeoff` (Giannis) do not re-key the arms at the
 *    takeoff (the clock holds at max(set, takeoff), the arms are already set). The animator replaces the authored
 *    pelvis dy inside [takeoff, land] (SAMPLE_AIR_LINEAR) and adds jumpY.
 *
 * 9. Compilation: monotone cubic Hermite (Fritsch–Carlson, no overshoot) per scalar, clamp to the §1.7 joint limits,
 *    scapulohumeral rhythm added to the clavicle (elevAuto = 0.22·max(0, armElev − 60°) ≤ 26°, unless noRhythm), dense
 *    uniform frames (≈ 30 Hz, the last frame exactly at dur) of anatomical quaternions shared by all players.
 *    Hip flexion above 95° outside the airborne segment is reported by validateClip (cloth guard), not an error.
 * ==================================================================================================================
 */
import {
  BONE, BONE_COUNT, BONE_KIND, BONE_SIDE, anatQuat, qnlerp, qrotate, qmul,
} from './rig.js';
import { FINGER_ID, FINGER_PRESETS, FINGER_BONES, fingerQuats, STYLE } from './presets.js';
import { EXPR, LOOK, MASK, maskCode } from './pose.js';

/** Compile rate (frames per second, nominal). */
export const FPS = 30;

/** Event codes (spec §4.2). */
export const EV = Object.freeze({
  GATHER: 1, PLANT_L: 2, PLANT_R: 3, TAKEOFF: 4, SET: 5, RELEASE: 6, APEX: 7, CONTACT: 8, SLAM: 9, RIM_GRAB: 10,
  RIM_RELEASE: 11, LAND: 12, CATCH: 13, BOUNCE: 14, HAND_ON: 15, PICKUP: 16, SWIPE: 17, READY: 18, END: 19,
  HANDOFF: 20, STEP: 21, SLOWMO_IN: 22, SLOWMO_OUT: 23, FX: 24, FAKE: 25,
});
/** Event code → canonical authoring name. */
export const EV_NAMES = Object.freeze(['', 'gather', 'plantL', 'plantR', 'takeoff', 'set', 'release', 'apex', 'contact',
  'slam', 'rimGrab', 'rimRelease', 'land', 'catch', 'bounce', 'handOn', 'pickup', 'swipe', 'ready', 'end', 'handoff',
  'step', 'slowmoIn', 'slowmoOut', 'fx', 'fake']);

/** Hand codes used as HAND_ON params and AnimProxy/Animator `ballHand`. */
export const HAND = Object.freeze({ none: 0, R: 1, L: 2 });
/** FX ids carried by FX events. */
export const FX = Object.freeze({ chalkBurst: 1, ooh: 2 });
/** Ball attachment modes (spec §4.5); KEEP (0) = unchanged. */
export const BM = Object.freeze({ KEEP: 0, R: 1, L: 2, BOTH: 3, DRIB: 4, PATH: 5, FREE: 6 });
export const BM_NAMES = Object.freeze(['keep', 'R', 'L', 'both', 'drib', 'path', 'free']);
const BM_BY_NAME = Object.freeze({ keep: 0, R: 1, L: 2, both: 3, drib: 4, path: 5, free: 6 });

/** sampleClip flag: replace authored pelvis dy inside (takeoff, land) by the straight line between its end values. */
export const SAMPLE_AIR_LINEAR = 1;

// authoring event name → [code, param]
const EVN = (() => {
  const m = {};
  for (let c = 1; c < EV_NAMES.length; c++) m[EV_NAMES[c]] = [c, 0];
  m.handOnR = [EV.HAND_ON, HAND.R]; m.handOnL = [EV.HAND_ON, HAND.L]; m.handOff = [EV.HANDOFF, 0];
  m.plantl = m.plantL; m.plantr = m.plantR;
  return m;
})();
const EV_MIRROR = { plantL: 'plantR', plantR: 'plantL', handOnL: 'handOnR', handOnR: 'handOnL' };

// ---------------------------------------------------------------------------------------------------------------
// Channel schema
// ---------------------------------------------------------------------------------------------------------------

const DIMS = { P: 6, S1: 3, S2: 3, S3: 3, Nk: 3, Hd: 3, RC: 2, LC: 2, RA: 7, LA: 7, RL: 6, LL: 6, R: 3, Bp: 3 };
const NUM_GROUPS = ['P', 'S1', 'S2', 'S3', 'Nk', 'Hd', 'RC', 'LC', 'RA', 'LA', 'RL', 'LL'];   // completed first/last
const KEY_FIELDS = new Set(['P', 'S', 'S1', 'S2', 'S3', 'N', 'Nk', 'Hd', 'RC', 'LC', 'RA', 'LA', 'RL', 'LL', 'RF', 'LF',
  'Rft', 'Lft', 'B', 'Bp', 'E', 'R', 'look', 'ev']);
const S_SPLIT_PR = [0.30, 0.35, 0.35];
const S_SPLIT_Y = [0.30, 0.33, 0.37];
const N_SPLIT = [0.40, 0.60];

// Joint limits [ANIM §1.7] per group scalar (deg; null = unlimited).
const LIM = {
  P: [null, null, null, [-25, 40], null, [-20, 20]],
  S1: [[-15, 30], [-25, 25], [-20, 20]], S2: [[-15, 30], [-25, 25], [-20, 20]], S3: [[-15, 30], [-25, 25], [-20, 20]],
  Nk: [[-30, 35], [-50, 50], [-25, 25]], Hd: [[-35, 35], [-45, 45], [-25, 25]],
  RC: [[-10, 35], [-15, 25]], LC: [[-10, 35], [-15, 25]],
  RA: [[-60, 180], [-15, 180], [-80, 80], [0, 150], [-100, 100], [-85, 85], [-20, 30]],
  LA: [[-60, 180], [-15, 180], [-80, 80], [0, 150], [-100, 100], [-85, 85], [-20, 30]],
  RL: [[-30, 125], [-15, 50], [-40, 40], [0, 150], [-30, 55], [-10, 60]],
  LL: [[-30, 125], [-15, 50], [-40, 40], [0, 150], [-30, 55], [-10, 60]],
};

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------------------------
// defineClip — validation and normalisation
// ---------------------------------------------------------------------------------------------------------------

function fail(def, msg) { throw new Error(`clip '${def && def.id}': ${msg}`); }

function numArr(def, t, g, v, dim) {
  if (!Array.isArray(v) || v.length !== dim) fail(def, `t=${t} ${g} must be an array of ${dim}`);
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) {
    const x = v[i];
    if (x === null || x === undefined) out[i] = null;
    else if (typeof x === 'number' && Number.isFinite(x)) out[i] = x;
    else fail(def, `t=${t} ${g}[${i}] is not a number`);
  }
  return out;
}

function normFinger(def, t, g, v) {
  if (v === null || v === undefined) return null;
  const name = Array.isArray(v) ? v[0] : v;
  const w = Array.isArray(v) ? v[1] : 1;
  if (FINGER_ID[name] === undefined) fail(def, `t=${t} ${g} unknown finger preset '${name}'`);
  if (typeof w !== 'number' || !(w >= 0 && w <= 1)) fail(def, `t=${t} ${g} weight must be in [0, 1]`);
  return [name, w];
}

function normFoot(def, t, g, v) {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length < 3 || v.length > 4) fail(def, `t=${t} ${g} must be [x, z, yaw, mode] or null`);
  const mode = v.length === 4 ? v[3] : 'f';
  if (mode !== 'f' && mode !== 't') fail(def, `t=${t} ${g} mode must be 'f' or 't'`);
  for (let i = 0; i < 3; i++) if (typeof v[i] !== 'number' || !Number.isFinite(v[i])) fail(def, `t=${t} ${g}[${i}] is not a number`);
  return [v[0], v[1], v[2], mode];
}

function normLook(def, t, v) {
  const name = Array.isArray(v) ? v[0] : v;
  const w = Array.isArray(v) ? v[1] : 1;
  if (LOOK[name] === undefined || name === 'inherit') fail(def, `t=${t} unknown look target '${name}'`);
  return [name, w];
}

function normEvList(def, t, v, out) {
  const push = (e) => {
    const name = Array.isArray(e) ? e[0] : e;
    const param = Array.isArray(e) ? e[1] : undefined;
    if (!EVN[name]) fail(def, `unknown event '${name}' at ${t}`);
    if (name === 'fx' && (param === undefined || FX[param] === undefined)) fail(def, `fx event at ${t} needs a known FX id`);
    out.push(param === undefined ? [t, name] : [t, name, param]);
  };
  if (typeof v === 'string') push(v);
  else if (Array.isArray(v)) {
    if (v.length === 2 && v[0] === 'fx' && typeof v[1] === 'string' && FX[v[1]] !== undefined) push(v);
    else for (const e of v) push(e);
  } else fail(def, `bad inline ev at ${t}`);
}

/**
 * Normalises one key object: expands S → S1/S2/S3 and N → Nk/Hd (explicit segment keys win per scalar), copies arrays.
 */
function normKey(def, t, k) {
  const o = {};
  for (const g of Object.keys(k)) if (!KEY_FIELDS.has(g)) fail(def, `t=${t} unknown channel '${g}'`);
  if (k.P !== undefined) o.P = numArr(def, t, 'P', k.P, 6);
  if (k.S !== undefined) {
    const s = numArr(def, t, 'S', k.S, 3);
    for (let j = 0; j < 3; j++) {
      o['S' + (j + 1)] = [s[0] === null ? null : s[0] * S_SPLIT_PR[j], s[1] === null ? null : s[1] * S_SPLIT_Y[j],
        s[2] === null ? null : s[2] * S_SPLIT_PR[j]];
    }
  }
  for (const g of ['S1', 'S2', 'S3']) {
    if (k[g] === undefined) continue;
    const v = numArr(def, t, g, k[g], 3);
    if (!o[g]) o[g] = v; else for (let i = 0; i < 3; i++) if (v[i] !== null) o[g][i] = v[i];
  }
  if (k.N !== undefined) {
    const n = numArr(def, t, 'N', k.N, 3);
    o.Nk = n.map((x) => (x === null ? null : x * N_SPLIT[0]));
    o.Hd = n.map((x) => (x === null ? null : x * N_SPLIT[1]));
  }
  for (const g of ['Nk', 'Hd']) {
    if (k[g] === undefined) continue;
    const v = numArr(def, t, g, k[g], 3);
    if (!o[g]) o[g] = v; else for (let i = 0; i < 3; i++) if (v[i] !== null) o[g][i] = v[i];
  }
  for (const g of ['RC', 'LC', 'RA', 'LA', 'RL', 'LL', 'R', 'Bp']) if (k[g] !== undefined) o[g] = numArr(def, t, g, k[g], DIMS[g]);
  if (k.RF !== undefined) o.RF = normFinger(def, t, 'RF', k.RF);
  if (k.LF !== undefined) o.LF = normFinger(def, t, 'LF', k.LF);
  if (k.Rft !== undefined) o.Rft = normFoot(def, t, 'Rft', k.Rft);
  if (k.Lft !== undefined) o.Lft = normFoot(def, t, 'Lft', k.Lft);
  if (k.B !== undefined) {
    if (BM_BY_NAME[k.B] === undefined) fail(def, `t=${t} unknown ball mode '${k.B}'`);
    o.B = k.B;
  }
  if (k.E !== undefined) {
    if (typeof k.E !== 'object' || k.E === null) fail(def, `t=${t} E must be an object`);
    o.E = {};
    for (const n of Object.keys(k.E)) {
      if (EXPR[n] === undefined) fail(def, `t=${t} unknown expression '${n}'`);
      const w = k.E[n];
      if (typeof w !== 'number' || !(w >= 0 && w <= 1)) fail(def, `t=${t} expression ${n} weight must be in [0, 1]`);
      o.E[n] = w;
    }
  }
  if (k.look !== undefined) o.look = normLook(def, t, k.look);
  return o;
}

/**
 * Validates and normalises a clip definition (see the authoring guide). Returns a frozen ClipDef whose keys are
 * sorted, whose S/N totals are expanded per bone, whose first and last keys define every numeric channel the clip
 * keys anywhere (values held from the nearest key), and whose events are sorted [t, name, param?] with `end` present.
 * Throws an Error naming the clip and the offending key on any malformed input.
 */
export function defineClip(def) {
  if (def && def.__normalized) return def;
  if (!def || typeof def.id !== 'string' || !def.id) throw new Error('clip: id required');
  if (!(typeof def.dur === 'number' && def.dur > 0)) fail(def, 'dur must be > 0');
  if (!Array.isArray(def.keys) || def.keys.length === 0) fail(def, 'keys must be a non-empty array');
  const dur = def.dur;
  const evs = [];
  let keys = def.keys.map((entry) => {
    const t = Array.isArray(entry) ? entry[0] : entry.t;
    const k = Array.isArray(entry) ? entry[1] : entry;
    if (!(typeof t === 'number' && t >= -1e-9 && t <= dur + 1e-6)) fail(def, `key time ${t} outside [0, ${dur}]`);
    if (!k || typeof k !== 'object') fail(def, `key at ${t} must be an object`);
    const kk = {};
    for (const g of Object.keys(k)) if (g !== 't') kk[g] = k[g];
    if (kk.ev !== undefined) normEvList(def, t, kk.ev, evs);
    delete kk.ev;
    return [Math.min(dur, Math.max(0, t)), normKey(def, t, kk)];
  });
  // merge keys that share a time (later entries win per scalar)
  keys.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [t, k] of keys) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last[0] - t) < 1e-6) mergeKey(last[1], k); else merged.push([t, k]);
  }
  keys = merged;
  for (const e of def.ev || []) {
    if (!Array.isArray(e) || typeof e[0] !== 'number') fail(def, 'ev entries are [t, name, param?]');
    if (e[0] < -1e-9 || e[0] > dur + 1e-6) fail(def, `event ${e[1]} at ${e[0]} outside [0, ${dur}]`);
    normEvList(def, e[0], e.length > 2 ? [[e[1], e[2]]] : e[1], evs);
  }
  if (!evs.some((e) => e[1] === 'end')) evs.push([dur, 'end']);
  evs.sort((a, b) => a[0] - b[0] || EVN[a[1]][0] - EVN[b[1]][0]);
  completeKeys(keys);

  const mask = def.mask || 'full';
  maskCode(mask);
  const layer = def.layer || 'action';
  if (layer !== 'action' && layer !== 'upper' && layer !== 'add') fail(def, `bad layer '${layer}'`);
  const root = def.root || 'none';
  if (root !== 'none' && root !== 'motion') fail(def, `bad root '${root}'`);
  const entry = def.entry || 'replace';
  if (entry !== 'replace' && entry !== 'carry' && entry !== 'stop') fail(def, `bad entry '${entry}'`);
  const hand = def.hand || 'R';
  if (hand !== 'R' && hand !== 'L') fail(def, `bad hand '${hand}'`);
  if (def.target !== undefined && def.target !== null && !evs.some((e) => e[1] === def.target)) {
    fail(def, `target event '${def.target}' is not in the clip`);
  }
  if (def.jump && !(typeof def.jump.h === 'number' && def.jump.h >= 0)) fail(def, 'jump.h must be a number');
  const hasSet = evs.some((e) => e[1] === 'set'), hasRel = evs.some((e) => e[1] === 'release');
  const meter = def.meter !== undefined ? def.meter : (hasSet && hasRel ? 'hold' : false);
  if (meter !== false && meter !== 'hold' && meter !== 'key') fail(def, `bad meter '${meter}'`);
  if (meter && !hasRel) fail(def, 'meter clips need a release event');
  if (meter === 'hold' && !hasSet) fail(def, "meter 'hold' needs a set event");
  if (def.per) {
    for (const pid of Object.keys(def.per)) {
      if (!STYLE[pid]) fail(def, `per: unknown player '${pid}'`);
    }
  }
  const out = {
    __normalized: true,
    id: def.id, dur, loop: !!def.loop, mask, layer, root, entry,
    entryDecel: def.entryDecel !== undefined ? def.entryDecel : 18,
    jump: def.jump ? Object.freeze({ ...def.jump }) : null,
    tempo: def.tempo !== undefined ? !!def.tempo : true,
    tempoValue: typeof def.tempoValue === 'number' ? def.tempoValue : undefined,
    meter, hand,
    blendIn: def.blendIn !== undefined ? def.blendIn : 0.06,
    blendOut: def.blendOut !== undefined ? def.blendOut : 0.20,
    cancel: def.cancel !== undefined ? def.cancel : dur,
    target: def.target || null,
    noRhythm: !!def.noRhythm, chain: !!def.chain,
    params: Object.freeze({ ...(def.params || {}) }),
    per: def.per || null,
    keys: Object.freeze(keys),
    ev: Object.freeze(evs),
  };
  return Object.freeze(out);
}

function mergeKey(dst, src) {
  for (const g of Object.keys(src)) {
    const v = src[g];
    if (Array.isArray(v) && Array.isArray(dst[g]) && DIMS[g] && v.length === DIMS[g]) {
      for (let i = 0; i < v.length; i++) if (v[i] !== null) dst[g][i] = v[i];
    } else if (g === 'E' && dst.E) Object.assign(dst.E, v);
    else dst[g] = v;
  }
}

/** First/last key completion: every numeric scalar keyed anywhere is defined at the first and last key (hold). */
function completeKeys(keys) {
  const first = keys[0][1], last = keys[keys.length - 1][1];
  for (const g of NUM_GROUPS) {
    const dim = DIMS[g];
    for (let i = 0; i < dim; i++) {
      let fv = null, lv = null;
      for (const [, k] of keys) { const a = k[g]; if (a && a[i] !== null) { if (fv === null) fv = a[i]; lv = a[i]; } }
      if (fv === null) continue;
      if (!first[g]) first[g] = new Array(dim).fill(null);
      if (first[g][i] === null) first[g][i] = fv;
      if (!last[g]) last[g] = new Array(dim).fill(null);
      if (last[g][i] === null) last[g][i] = lv;
    }
  }
  for (const g of ['Rft', 'Lft']) {
    if (keys.some(([, k]) => k[g] !== undefined) && first[g] === undefined) first[g] = null;
  }
  if (keys.some(([, k]) => k.B !== undefined) && first.B === undefined) first.B = 'keep';
}

// ---------------------------------------------------------------------------------------------------------------
// mirrorDef
// ---------------------------------------------------------------------------------------------------------------

const SWAP = { RA: 'LA', LA: 'RA', RC: 'LC', LC: 'RC', RL: 'LL', LL: 'RL', RF: 'LF', LF: 'RF', Rft: 'Lft', Lft: 'Rft' };

function mirrorKey(k) {
  const o = {};
  for (const g of Object.keys(k)) {
    const v = k[g];
    const dst = SWAP[g] || g;
    if (g === 'P') o.P = [neg(v[0]), v[1], v[2], v[3], neg(v[4]), neg(v[5])];
    else if (g === 'S1' || g === 'S2' || g === 'S3' || g === 'Nk' || g === 'Hd') o[g] = [v[0], neg(v[1]), neg(v[2])];
    else if (g === 'R') o.R = [neg(v[0]), v[1], neg(v[2])];
    else if (g === 'Bp') o.Bp = [neg(v[0]), v[1], v[2]];
    else if (g === 'Rft' || g === 'Lft') o[dst] = v === null ? null : [-v[0], v[1], -v[2], v[3]];
    else if (g === 'B') o.B = v === 'R' ? 'L' : v === 'L' ? 'R' : v;
    else if (Array.isArray(v)) o[dst] = v.slice();
    else if (v && typeof v === 'object') o[dst] = { ...v };
    else o[dst] = v;
  }
  return o;
}
function neg(x) { return x === null ? null : -x; }

/**
 * Builds the mirrored ('_L') twin of a normalised ClipDef per the mirror rule (authoring guide §4). The twin of a
 * twin is the original id. `per` overrides are mirrored too.
 */
export function mirrorDef(def) {
  const d = defineClip(def);
  const id = d.id.endsWith('_L') ? d.id.slice(0, -2) : d.id + '_L';
  const params = { ...d.params };
  if (Array.isArray(params.exitV)) params.exitV = [-params.exitV[0], params.exitV[1]];
  let per = null;
  if (d.per) {
    per = {};
    for (const pid of Object.keys(d.per)) {
      const p = d.per[pid];
      per[pid] = { ...p };
      if (p.keys) per[pid].keys = normPerKeys(p.keys).map(([t, k]) => [t, mirrorKey(normKey(d, t, k))]);
      if (p.ev) per[pid].ev = p.ev.map((e) => [e[0], EV_MIRROR[e[1]] || e[1], ...e.slice(2)]);
    }
  }
  return defineClip({
    ...d, __normalized: false, id, hand: d.hand === 'R' ? 'L' : 'R', params, per,
    keys: d.keys.map(([t, k]) => [t, mirrorKey(k)]),
    ev: d.ev.map((e) => [e[0], EV_MIRROR[e[1]] || e[1], ...e.slice(2)]),
  });
}

function normPerKeys(keys) {
  if (Array.isArray(keys)) return keys.map((e) => (Array.isArray(e) ? e : [e.t, e]));
  return Object.keys(keys).map((t) => [Number(t), keys[t]]);
}

/** Merges a `per[playerId]` override into a normalised def (keys merged by time). */
function applyPer(d, pid) {
  const p = d.per && d.per[pid];
  if (!p) return d;
  const keys = d.keys.map(([t, k]) => [t, JSON.parse(JSON.stringify(k))]);
  const extra = p.keys ? normPerKeys(p.keys) : [];
  return defineClip({
    ...d, __normalized: false, per: null,
    tempo: p.tempo !== undefined ? true : d.tempo,
    tempoValue: p.tempo,
    jump: p.jump !== undefined ? p.jump : d.jump,
    params: p.params ? { ...d.params, ...p.params } : d.params,
    keys: keys.concat(extra),
    ev: d.ev.filter((e) => e[1] !== 'end').concat(p.ev || []),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------------------------------------------

/**
 * Monotone cubic Hermite (Fritsch–Carlson) through (ts[i], vs[i]); returns an evaluator f(t) (allocates; compile time
 * only). Tangents: one-sided at the ends, harmonic-safe average inside, zeroed at local extrema and limited by the
 * α² + β² ≤ 9 rule, so flat holds stay flat and the curve never overshoots its keys.
 */
export function hermiteMonotone(ts, vs) {
  const n = ts.length;
  if (n === 1) return () => vs[0];
  const d = new Float64Array(n - 1), m = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 0.5 * (d[i - 1] + d[i]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    if (a < 0) m[i] = 0;
    if (b < 0) m[i + 1] = 0;
    const s = a * a + b * b;
    if (s > 9) { const tau = 3 / Math.sqrt(s); m[i] = tau * a * d[i]; m[i + 1] = tau * b * d[i]; }
  }
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (i < n - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], u = (t - ts[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

/** Catmull-Rom (Hermite with finite-difference tangents for non-uniform times); allocates, compile time only. */
function catmullRom(ts, vs) {
  const n = ts.length;
  if (n === 1) return () => vs[0];
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    m[i] = (vs[b] - vs[a]) / (ts[b] - ts[a]);
  }
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (i < n - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i], u = (t - ts[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

/**
 * Ball path data: key times bpT, values bpV (k·3) and Catmull-Rom tangents bpM (k·3, finite differences over the
 * neighbouring keys, one-sided at the ends). A coordinate left unkeyed at a key is filled from the per-axis spline.
 */
function buildPath(bpKeys) {
  const k = bpKeys.length;
  const T = new Float64Array(k), V = new Float64Array(k * 3), Mt = new Float64Array(k * 3);
  for (let i = 0; i < k; i++) T[i] = bpKeys[i][0];
  for (let a = 0; a < 3; a++) {
    const ts = [], vs = [];
    for (const [t, key] of bpKeys) if (key.Bp[a] !== null) { ts.push(t); vs.push(key.Bp[a]); }
    const cr = ts.length ? catmullRom(ts, vs) : () => 0;
    for (let i = 0; i < k; i++) V[i * 3 + a] = cr(T[i]);
  }
  for (let i = 0; i < k; i++) {
    const p = Math.max(0, i - 1), q = Math.min(k - 1, i + 1);
    for (let a = 0; a < 3; a++) Mt[i * 3 + a] = q > p ? (V[q * 3 + a] - V[p * 3 + a]) / (T[q] - T[p]) : 0;
  }
  return { k, T, V, M: Mt };
}

/** Evaluates the ball path at clip time t into out[0..2] (short linear scan over ≤ a dozen keys; no allocation). */
function evalPath(bp, t, out) {
  const T = bp.T, V = bp.V, Mt = bp.M, k = bp.k;
  if (k === 1 || t <= T[0]) { out[0] = V[0]; out[1] = V[1]; out[2] = V[2]; return; }
  if (t >= T[k - 1]) { const o = (k - 1) * 3; out[0] = V[o]; out[1] = V[o + 1]; out[2] = V[o + 2]; return; }
  let i = 0;
  while (i < k - 2 && t > T[i + 1]) i++;
  const h = T[i + 1] - T[i], u = (t - T[i]) / h, u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  for (let a = 0; a < 3; a++) {
    out[a] = h00 * V[i * 3 + a] + h10 * h * Mt[i * 3 + a] + h01 * V[(i + 1) * 3 + a] + h11 * h * Mt[(i + 1) * 3 + a];
  }
}

function smooth01(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); }

const _armDir = new Float64Array(3), _qua = new Float64Array(4);
const DOWN = Float64Array.from([0, -1, 0]);

/**
 * Scapulohumeral rhythm ([ANIM §1.4]): automatic clavicle elevation (deg) for upper-arm channels [flex, abd, int]:
 * elevAuto = 0.22 · max(0, armElev − 60°), armElev = angle between the upper arm and straight down, capped at 26°.
 */
export function rhythmElev(flex, abd, int, side = -1) {
  _armDir[0] = flex; _armDir[1] = abd; _armDir[2] = int;
  anatQuat(BONE_KIND[BONE.upperarm_r], side, _armDir, _qua, 0, 0);
  qrotate(_qua, 0, DOWN, 0, _armDir, 0);
  const elev = Math.acos(Math.max(-1, Math.min(1, -_armDir[1]))) / DEG;
  const e = 0.22 * Math.max(0, elev - 60);
  return e > 26 ? 26 : e;
}

// ---------------------------------------------------------------------------------------------------------------
// compileClip
// ---------------------------------------------------------------------------------------------------------------

// bone ← group scalars ([group, index] list in anatQuat channel order)
const BONE_SRC = (() => {
  const m = [];
  const ax = (b, g) => m.push([b, [[g, 0], [g, 1], [g, 2]]]);
  m.push([BONE.pelvis, [['P', 3], ['P', 4], ['P', 5]]]);
  ax(BONE.spine_01, 'S1'); ax(BONE.spine_02, 'S2'); ax(BONE.spine_03, 'S3'); ax(BONE.neck_01, 'Nk'); ax(BONE.head, 'Hd');
  for (const [s, C, A, L] of [['r', 'RC', 'RA', 'RL'], ['l', 'LC', 'LA', 'LL']]) {
    m.push([BONE['clavicle_' + s], [[C, 0], [C, 1]]]);
    m.push([BONE['upperarm_' + s], [[A, 0], [A, 1], [A, 2]]]);
    m.push([BONE['lowerarm_' + s], [[A, 3], [A, 4]]]);
    m.push([BONE['hand_' + s], [[A, 4], [A, 5], [A, 6]]]);
    m.push([BONE['thigh_' + s], [[L, 0], [L, 1], [L, 2]]]);
    m.push([BONE['calf_' + s], [[L, 3]]]);
    m.push([BONE['foot_' + s], [[L, 4], null]]);
    m.push([BONE['ball_' + s], [[L, 5]]]);
  }
  return m;
})();

/**
 * Compiles a clip definition into dense tracks (allocates; load time only). `opts`: a player id string or
 * { player } to apply `per` overrides. Returns a Clip:
 *   { id, def, player, dur, n (frames), fps (= (n − 1)/dur), loop, mask (code), layer, tracked (Uint8Array bone list),
 *     qOff (Int32Array(53), −1 untracked), qData (Float32Array anatomical quaternions), hasPel, pel, hasRoot, root
 *     (x, z, yaw rad per frame), hasBall, ball (Uint8Array BM per frame), hasBp, bp (analytic ball-path keys), fing ([right, left] finger tracks
 *     or null), expr (Array(9) Float32Array|null), hasLook, look, lookW, ftOn ([R, L] Uint8Array), ft ([R, L]
 *     Float32Array(n·4)), hasFeet, evCount, evT, evCode, evParam, dyTO, dyLand, timing (clipTiming) }.
 */
export function compileClip(def, opts) {
  let d = defineClip(def);
  const player = typeof opts === 'string' ? opts : opts && opts.player ? opts.player : null;
  if (player && d.per && d.per[player]) d = applyPer(d, player);
  const dur = d.dur;
  const n = Math.max(2, Math.ceil(dur * FPS - 1e-6) + 1);
  const fps = (n - 1) / dur;
  const frameT = (i) => (i === n - 1 ? dur : i / fps);
  const half = 0.5 / fps;

  // ---- scalar curves ----
  const curve = {};
  for (const g of [...NUM_GROUPS, 'R']) {
    const dim = DIMS[g];
    curve[g] = new Array(dim).fill(null);
    for (let i = 0; i < dim; i++) {
      const ts = [], vs = [];
      for (const [t, k] of d.keys) { const a = k[g]; if (a && a[i] !== null) { ts.push(t); vs.push(a[i]); } }
      if (!ts.length) continue;
      if (g === 'R' && ts[0] > 1e-6) { ts.unshift(0); vs.unshift(0); }
      const lim = LIM[g] && LIM[g][i];
      const h = hermiteMonotone(ts, vs);
      curve[g][i] = lim ? (t) => Math.min(lim[1], Math.max(lim[0], h(t))) : h;
    }
  }
  const val = (g, i, t) => (curve[g][i] ? curve[g][i](t) : 0);
  const keyed = (g, i) => !!curve[g][i];

  // ---- bone tracks ----
  const tracked = [];
  const qOff = new Int32Array(BONE_COUNT).fill(-1);
  const boneSrc = [];
  for (const [b, src] of BONE_SRC) {
    if (src.some((s) => s && keyed(s[0], s[1]))) { tracked.push(b); boneSrc.push([b, src]); }
  }
  // scapulohumeral rhythm may track a clavicle whose arm is keyed
  const rhythm = { r: null, l: null };
  if (!d.noRhythm) {
    for (const [s, A] of [['r', 'RA'], ['l', 'LA']]) {
      if (![0, 1, 2].some((i) => keyed(A, i))) continue;
      const add = new Float64Array(n);
      let any = false;
      for (let f = 0; f < n; f++) {
        const t = frameT(f);
        add[f] = rhythmElev(val(A, 0, t), val(A, 1, t), val(A, 2, t), s === 'l' ? 1 : -1);
        if (add[f] > 0) any = true;
      }
      if (any) {
        rhythm[s] = add;
        const cb = BONE['clavicle_' + s];
        if (!tracked.includes(cb)) { tracked.push(cb); boneSrc.push([cb, BONE_SRC.find((e) => e[0] === cb)[1]]); }
      }
    }
  }
  tracked.sort((a, b) => a - b);
  // clavicles (13, 14) precede the upper arms (15, 18) in bone order, so the applied shrug is known per side
  boneSrc.sort((a, b) => a[0] - b[0]);
  const rhAppliedBy = { r: new Float64Array(n), l: new Float64Array(n) };
  let rhApplied = rhAppliedBy.r;
  const qData = new Float32Array(tracked.length * n * 4);
  tracked.forEach((b, j) => { qOff[b] = j * n * 4; });
  const ch = new Float64Array(3), qa = new Float64Array(4), qc = new Float64Array(4);
  for (const [b, src] of boneSrc) {
    const side = BONE_SIDE[b], kind = BONE_KIND[b];
    const isClav = b === BONE.clavicle_r || b === BONE.clavicle_l;
    const isUpper = b === BONE.upperarm_r || b === BONE.upperarm_l;
    const rh = isClav || isUpper ? rhythm[side > 0 ? 'l' : 'r'] : null;
    rhApplied = rhAppliedBy[side > 0 ? 'l' : 'r'];
    for (let f = 0; f < n; f++) {
      const t = frameT(f);
      for (let c = 0; c < 3; c++) ch[c] = src[c] ? val(src[c][0], src[c][1], t) : 0;
      if (rh && isClav) {
        // clavicle elev limit after the automatic shrug; the applied amount is what the upper arm compensates
        const authored = ch[0];
        ch[0] = Math.min(35, authored + rh[f]);
        rhApplied[f] = ch[0] - authored;
      }
      if (rh && isUpper && rhApplied[f] !== 0) {
        // The automatic shrug must raise the shoulder without tilting the authored arm direction: the arm frame
        // rides on the clavicle, so pre-multiply the upper arm by the inverse of the automatic clavicle rotation.
        anatQuat(kind, side, ch, qa, 0);
        qc[0] = rhApplied[f]; qc[1] = 0;
        anatQuat(BONE_KIND[BONE.clavicle_r], side, qc, qc, 0);
        qc[0] = -qc[0]; qc[1] = -qc[1]; qc[2] = -qc[2];
        qmul(qc, 0, qa, 0, qData, qOff[b] + f * 4);
        continue;
      }
      anatQuat(kind, side, ch, qData, qOff[b] + f * 4);
    }
  }

  // ---- pelvis offsets / root ----
  const hasPel = [0, 1, 2].some((i) => keyed('P', i));
  const pel = new Float32Array(n * 3);
  const hasRoot = [0, 1, 2].some((i) => keyed('R', i));
  const root = new Float32Array(n * 3);
  for (let f = 0; f < n; f++) {
    const t = frameT(f);
    if (hasPel) for (let i = 0; i < 3; i++) pel[f * 3 + i] = val('P', i, t);
    if (hasRoot) { root[f * 3] = val('R', 0, t); root[f * 3 + 1] = val('R', 1, t); root[f * 3 + 2] = val('R', 2, t) * DEG; }
  }

  // ---- step tracks: ball mode, look (nearest-frame assignment) ----
  const stepAt = (field, f, fallback) => {
    const t = frameT(f) + half;
    let v = fallback;
    for (const [kt, k] of d.keys) { if (kt > t) break; if (k[field] !== undefined) v = k[field]; }
    return v;
  };
  const hasBall = d.keys.some(([, k]) => k.B !== undefined);
  const ball = new Uint8Array(n);
  if (hasBall) {
    let cur = 0;
    for (let f = 0; f < n; f++) {
      const t = frameT(f) + half;
      for (const [kt, k] of d.keys) { if (kt > t) break; if (k.B !== undefined && k.B !== 'keep') cur = BM_BY_NAME[k.B]; }
      ball[f] = cur;
    }
  }
  const hasLook = d.keys.some(([, k]) => k.look !== undefined);
  const look = new Uint8Array(n), lookW = new Float32Array(n);
  if (hasLook) {
    for (let f = 0; f < n; f++) {
      const v = stepAt('look', f, null);
      if (v) { look[f] = LOOK[v[0]]; lookW[f] = v[1]; }
    }
  }

  // ---- ball path: Catmull-Rom keys kept analytic so bounces touch the floor exactly at their key ----
  const bpKeys = d.keys.filter(([, k]) => k.Bp);
  const hasBp = bpKeys.length > 0;
  const bp = hasBp ? buildPath(bpKeys) : null;

  // ---- fingers ----
  const fing = [null, null];
  for (const [s, G] of [[0, 'RF'], [1, 'LF']]) {
    const fk = d.keys.filter(([, k]) => k[G] !== undefined && k[G] !== null).map(([t, k]) => [t, FINGER_ID[k[G][0]], k[G][1]]);
    if (!fk.length) continue;
    const ids = new Uint8Array(n * 2), ws = new Float32Array(n * 3);
    for (let f = 0; f < n; f++) {
      const t = frameT(f);
      let a = 0;
      while (a < fk.length - 1 && fk[a + 1][0] <= t) a++;
      const b = Math.min(fk.length - 1, fk[a][0] <= t ? a + 1 : a);
      const k0 = fk[a][0] <= t ? fk[a] : fk[0], k1 = fk[b];
      const u = k1[0] > k0[0] ? smooth01((t - k0[0]) / (k1[0] - k0[0])) : 1;
      ids[f * 2] = k0[1]; ids[f * 2 + 1] = k1[1];
      ws[f * 3] = k0[2]; ws[f * 3 + 1] = k1[2]; ws[f * 3 + 2] = k0 === k1 ? 0 : u;
    }
    fing[s] = { ids, ws };
  }

  // ---- expressions ----
  const expr = new Array(9).fill(null);
  for (const name of Object.keys(EXPR)) {
    const ts = [], vs = [];
    for (const [t, k] of d.keys) if (k.E && k.E[name] !== undefined) { ts.push(t); vs.push(k.E[name]); }
    if (!ts.length) continue;
    if (ts[0] > 1e-6) { ts.unshift(0); vs.unshift(0); }
    const h = hermiteMonotone(ts, vs);
    const tr = new Float32Array(n);
    for (let f = 0; f < n; f++) tr[f] = Math.min(1, Math.max(0, h(frameT(f))));
    expr[EXPR[name]] = tr;
  }

  // ---- feet ----
  const ftOn = [new Uint8Array(n), new Uint8Array(n)];
  const ft = [new Float32Array(n * 4), new Float32Array(n * 4)];
  let hasFeet = false;
  for (const [s, G] of [[0, 'Rft'], [1, 'Lft']]) {
    const fk = d.keys.filter(([, k]) => k[G] !== undefined).map(([t, k]) => [t, k[G]]);
    if (!fk.length) continue;
    hasFeet = true;
    for (let i = 1; i < fk.length; i++) {
      const a = fk[i - 1][1], b = fk[i][1];
      if (a && b && (Math.abs(a[0] - b[0]) > 1e-3 || Math.abs(a[1] - b[1]) > 1e-3)) {
        fail(d, `${G} moves while planted between ${fk[i - 1][0]} and ${fk[i][0]} (insert a null key)`);
      }
    }
    for (let f = 0; f < n; f++) {
      const t = frameT(f), tq = t + half;
      let a = -1;
      for (let i = 0; i < fk.length; i++) if (fk[i][0] <= tq) a = i;
      if (a < 0 || fk[a][1] === null) continue;
      const cur = fk[a][1];
      let yaw = cur[2];
      // pivot: yaw interpolates linearly toward the next key of the same plant
      const nx = a + 1 < fk.length ? fk[a + 1] : null;
      if (nx && nx[1] && fk[a][0] <= t) {
        const u = Math.min(1, Math.max(0, (t - fk[a][0]) / (nx[0] - fk[a][0])));
        yaw = cur[2] + (nx[1][2] - cur[2]) * u;
      }
      ftOn[s][f] = 1;
      ft[s][f * 4] = cur[0]; ft[s][f * 4 + 1] = cur[1]; ft[s][f * 4 + 2] = yaw * DEG; ft[s][f * 4 + 3] = cur[3] === 't' ? 1 : 0;
    }
  }

  // ---- events ----
  const evCount = d.ev.length;
  const evT = new Float64Array(evCount), evCode = new Uint8Array(evCount), evParam = new Int16Array(evCount);
  d.ev.forEach((e, i) => {
    const [code, p] = EVN[e[1]];
    evT[i] = e[0]; evCode[i] = code;
    evParam[i] = e[1] === 'fx' ? FX[e[2]] : (e.length > 2 && typeof e[2] === 'number' ? e[2] : p);
  });

  const clip = {
    id: d.id, def: d, player, dur, n, fps, loop: d.loop, mask: MASK[d.mask], layer: d.layer,
    tracked: Uint8Array.from(tracked), qOff, qData, hasPel, pel, hasRoot, root, hasBall, ball, hasBp, bp, fing, expr,
    hasLook, look, lookW, ftOn, ft, hasFeet, evCount, evT, evCode, evParam,
    tempoValue: d.tempoValue !== undefined ? d.tempoValue : null,
    dyTO: 0, dyLand: 0, timing: null,
  };
  clip.timing = buildTiming(clip, d);
  if (hasPel && clip.timing.takeoff >= 0 && clip.timing.land > clip.timing.takeoff) {
    clip.dyTO = val('P', 1, clip.timing.takeoff); clip.dyLand = val('P', 1, clip.timing.land);
  }
  return clip;
}

function firstEv(clip, code) {
  for (let i = 0; i < clip.evCount; i++) if (clip.evCode[i] === code) return clip.evT[i];
  return -1;
}

function buildTiming(clip, d) {
  const ev = (c) => firstEv(clip, c);
  const events = [];
  for (let i = 0; i < clip.evCount; i++) {
    events.push(Object.freeze({ code: clip.evCode[i], name: EV_NAMES[clip.evCode[i]], t: clip.evT[i], param: clip.evParam[i] }));
  }
  const p = d.params;
  const gw = Array.isArray(p.gatherWindow) ? Object.freeze(p.gatherWindow.slice(0, 2)) : Object.freeze([0, 0]);
  const t = {
    id: d.id, dur: d.dur, loop: d.loop, events: Object.freeze(events),
    gather: ev(EV.GATHER), plantL: ev(EV.PLANT_L), plantR: ev(EV.PLANT_R), takeoff: ev(EV.TAKEOFF), set: ev(EV.SET),
    release: ev(EV.RELEASE), apex: ev(EV.APEX), contact: ev(EV.CONTACT), slam: ev(EV.SLAM), rimGrab: ev(EV.RIM_GRAB),
    rimRelease: ev(EV.RIM_RELEASE), land: ev(EV.LAND), catch: ev(EV.CATCH), swipe: ev(EV.SWIPE), ready: ev(EV.READY),
    end: ev(EV.END),
    jumpH: d.jump ? d.jump.h : 0, hasJump: !!d.jump || (ev(EV.TAKEOFF) >= 0 && ev(EV.LAND) > ev(EV.TAKEOFF)),
    hold: d.meter === 'hold', keyRelease: d.meter === 'key', meter: d.meter,
    // the set hold never delays the takeoff (Giannis' 0.14 s setLead puts `set` 0.03 s before it)
    holdAt: d.meter === 'hold' ? Math.max(ev(EV.SET), ev(EV.TAKEOFF)) : -1,
    tempo: d.tempo, cancel: d.cancel, mask: MASK[d.mask], maskName: d.mask, layer: d.layer,
    root: d.root === 'motion', entry: d.entry, entryDecel: d.entryDecel,
    target: d.target ? EVN[d.target][0] : 0, targetT: d.target ? ev(EVN[d.target][0]) : -1,
    blendIn: d.blendIn, blendOut: d.blendOut, hand: d.hand,
    gatherWindow: gw,
    meterFrom: typeof p.meterFrom === 'number' ? p.meterFrom : 0,
    tIdeal: typeof p.tIdeal === 'number' ? p.tIdeal : (d.meter === 'hold' || d.meter === 'key' ? ev(EV.RELEASE) - 0.05 : -1),
    METER_T: typeof p.METER_T === 'number' ? p.METER_T : -1,
    exitV: Array.isArray(p.exitV) ? Object.freeze(p.exitV.slice(0, 2)) : null,
    imm: Array.isArray(p.imm) ? Object.freeze(p.imm.slice(0, 2)) : null,
    cat: p.cat || '',
    params: p,
  };
  if (t.METER_T < 0 && t.tIdeal >= 0) t.METER_T = (t.tIdeal - t.meterFrom) / 0.80;
  return Object.freeze(t);
}

/** Timing summary of a compiled clip: { events, takeoff, set, release, slam, apex, land, dur, gatherWindow, ... }. */
export function clipTiming(clip) { return clip.timing; }

// ---------------------------------------------------------------------------------------------------------------
// Sampling (zero allocation)
// ---------------------------------------------------------------------------------------------------------------

const _fA = new Float32Array(60), _fB = new Float32Array(60), _fRelax = new Float32Array(60);

/**
 * Samples clip at clip time t (clamped, or wrapped when looping) into pose: tracked bones (w = 1), untracked bones
 * reset to identity (w = 0), pelvis offsets, root curve, ball mode, ball path, fingers, expressions, foot plants and
 * look-at. flags & SAMPLE_AIR_LINEAR replaces pelvis dy inside (takeoff, land) by the straight line between its
 * takeoff and land values (the animator adds gameplay's jumpY there). No search, no allocation.
 */
export function sampleClip(clip, t, pose, flags = 0) {
  const dur = clip.dur;
  let tt = t;
  if (clip.loop) { tt = t % dur; if (tt < 0) tt += dur; } else if (tt < 0) tt = 0; else if (tt > dur) tt = dur;
  const n = clip.n;
  const fpos = tt * clip.fps;
  let i = Math.floor(fpos), u = fpos - i;
  if (i >= n - 1) { i = n - 2; u = 1; }
  const ir = u >= 0.5 ? i + 1 : i;
  const q = pose.q, w = pose.w;
  for (let b = 0; b < BONE_COUNT; b++) { q[b * 4] = 0; q[b * 4 + 1] = 0; q[b * 4 + 2] = 0; q[b * 4 + 3] = 1; w[b] = 0; }
  const tr = clip.tracked, qd = clip.qData, qOff = clip.qOff;
  for (let j = 0; j < tr.length; j++) {
    const b = tr[j], o = qOff[b] + i * 4;
    qnlerp(qd, o, qd, o + 4, u, q, b * 4);
    w[b] = 1;
  }
  if (clip.hasPel) {
    const p = clip.pel, o = i * 3;
    pose.pel[0] = p[o] + (p[o + 3] - p[o]) * u;
    pose.pel[1] = p[o + 1] + (p[o + 4] - p[o + 1]) * u;
    pose.pel[2] = p[o + 2] + (p[o + 5] - p[o + 2]) * u;
    pose.pelW = 1;
    if (flags & SAMPLE_AIR_LINEAR) {
      const tm = clip.timing;
      if (tm.takeoff >= 0 && tt > tm.takeoff && tt < tm.land) {
        pose.pel[1] = clip.dyTO + (clip.dyLand - clip.dyTO) * (tt - tm.takeoff) / (tm.land - tm.takeoff);
      }
    }
  } else { pose.pel[0] = pose.pel[1] = pose.pel[2] = 0; pose.pelW = 0; }
  if (clip.hasRoot) {
    const r = clip.root, o = i * 3;
    pose.root[0] = r[o] + (r[o + 3] - r[o]) * u;
    pose.root[1] = r[o + 1] + (r[o + 4] - r[o + 1]) * u;
    pose.root[2] = r[o + 2] + (r[o + 5] - r[o + 2]) * u;
  } else { pose.root[0] = pose.root[1] = pose.root[2] = 0; }
  pose.ball[0] = clip.hasBall ? clip.ball[ir] : 0;
  if (clip.hasBp) { evalPath(clip.bp, tt, pose.bpath); pose.bpathOn = 1; } else pose.bpathOn = 0;
  for (let s = 0; s < 2; s++) {
    const fg = clip.fing[s];
    if (!fg) { pose.fingers[s] = -1; continue; }
    const pA = fg.ids[i * 2], pB = fg.ids[i * 2 + 1];
    const wA = fg.ws[i * 3], wB = fg.ws[i * 3 + 1];
    const sB = fg.ws[i * 3 + 2] + ((i + 1 < n ? fg.ws[(i + 1) * 3 + 2] : fg.ws[i * 3 + 2]) - fg.ws[i * 3 + 2]) * u;
    const bones = s === 0 ? FINGER_BONES.r : FINGER_BONES.l;
    fingerQuats(0, s, tt, _fRelax, 0);
    fingerQuats(pA, s, tt, _fA, 0);
    if (pA !== pB || wA !== wB) fingerQuats(pB, s, tt, _fB, 0);
    for (let k = 0; k < 15; k++) {
      const b = bones[k], o = k * 4;
      if (pA !== pB || wA !== wB) {
        qnlerp(_fRelax, o, _fA, o, wA, _fA, o);
        qnlerp(_fRelax, o, _fB, o, wB, _fB, o);
        qnlerp(_fA, o, _fB, o, sB, q, b * 4);
      } else qnlerp(_fRelax, o, _fA, o, wA, q, b * 4);
      w[b] = 1;
    }
    const domW = sB < 0.5 ? wA : wB;
    pose.fingers[s] = domW >= 0.5 ? (sB < 0.5 ? pA : pB) : 0;
  }
  for (let j = 0; j < 9; j++) {
    const e = clip.expr[j];
    if (e) { pose.expr[j] = e[i] + (e[i + 1] - e[i]) * u; pose.exprK[j] = 1; } else { pose.expr[j] = 0; pose.exprK[j] = 0; }
  }
  for (let s = 0; s < 2; s++) {
    const on = clip.ftOn[s], fd = clip.ft[s];
    pose.ftOn[s] = on[ir];
    const o = s * 4;
    if (on[i] && on[i + 1]) {
      for (let j = 0; j < 3; j++) pose.ftRL[o + j] = fd[i * 4 + j] + (fd[(i + 1) * 4 + j] - fd[i * 4 + j]) * u;
      pose.ftRL[o + 3] = fd[ir * 4 + 3];
    } else {
      for (let j = 0; j < 4; j++) pose.ftRL[o + j] = fd[ir * 4 + j];
    }
  }
  if (clip.hasLook) { pose.look[0] = clip.look[ir]; pose.look[1] = clip.lookW[ir]; } else { pose.look[0] = 0; pose.look[1] = 0; }
  return pose;
}

/** Root curve sample at clip time t into out[0..2] = (x, z (reference m), yaw (rad)); zeros when untracked. */
export function sampleRoot(clip, t, out) {
  if (!clip.hasRoot) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  const dur = clip.dur;
  let tt = t;
  if (clip.loop) { tt = t % dur; if (tt < 0) tt += dur; } else if (tt < 0) tt = 0; else if (tt > dur) tt = dur;
  const fpos = tt * clip.fps;
  let i = Math.floor(fpos), u = fpos - i;
  if (i >= clip.n - 1) { i = clip.n - 2; u = 1; }
  const r = clip.root, o = i * 3;
  out[0] = r[o] + (r[o + 3] - r[o]) * u;
  out[1] = r[o + 1] + (r[o + 4] - r[o + 1]) * u;
  out[2] = r[o + 2] + (r[o + 5] - r[o + 2]) * u;
  return out;
}

/** Ball mode code of a clip at clip time t (nearest frame); 0 = keep. */
export function sampleBall(clip, t) {
  if (!clip.hasBall) return 0;
  const tt = t < 0 ? 0 : t > clip.dur ? clip.dur : t;
  const i = Math.round(tt * clip.fps);
  return clip.ball[i < clip.n ? i : clip.n - 1];
}

/**
 * Builds a timing-only clip (no bone tracks) from a compact description, used by select.js for headless timing
 * and by AnimProxy when a clip's authored data is not registered:
 *   { id, dur, ev: [[t, name, param?]], jump: {h} | null, tempo, root, entry, entryDecel, R: [x, z, yawDeg] (end
 *     displacement), rWin: [t0, t1] (window of the root displacement; default [0, dur]) or Rkeys: [[t, [x, z, yaw]]]
 *     (a multi-point root curve), ball: [[t, mode]], mask,
 *     layer, hand, cancel, target, meter, params, loop }
 */
export function makeTimingClip(s) { return compileClip(timingDef(s)); }

/** The normalised ClipDef behind makeTimingClip (mirror it with mirrorDef for the left-handed twin). */
export function timingDef(s) {
  const keys = [[0, {}]];
  const r0 = s.rWin ? s.rWin[0] : 0, r1 = s.rWin ? s.rWin[1] : s.dur;
  if (s.Rkeys) {
    for (const [t, r] of s.Rkeys) keys.push([t, { R: r.slice() }]);
  } else if (s.R) {
    keys[0][1].R = [0, 0, 0];
    if (r0 > 0) keys.push([r0, { R: [0, 0, 0] }]);
    keys.push([r1, { R: s.R.slice() }]);
  }
  for (const [t, m] of s.ball || []) keys.push([t, { B: m }]);
  keys.push([s.dur, {}]);
  return defineClip({
    id: s.id, dur: s.dur, loop: !!s.loop, mask: s.mask || 'full', layer: s.layer || 'action', root: s.root || (s.R ? 'motion' : 'none'),
    entry: s.entry || 'replace', entryDecel: s.entryDecel, jump: s.jump || null, tempo: s.tempo !== undefined ? s.tempo : true,
    meter: s.meter, hand: s.hand || 'R', cancel: s.cancel, target: s.target, params: s.params || {},
    blendIn: s.blendIn, blendOut: s.blendOut, keys, ev: s.ev || [],
  });
}

/**
 * Authoring checks beyond compile errors (returns an array of warning strings): hip flexion > 95° on a frame
 * outside the airborne segment (cloth guard), jumping clips without takeoff < land, meter clips without release,
 * events outside [0, dur].
 */
export function validateClip(clip) {
  const out = [];
  const tm = clip.timing;
  if (clip.def.jump && !(tm.takeoff >= 0 && tm.land > tm.takeoff)) out.push(`${clip.id}: jump clip without takeoff < land`);
  if (tm.meter && tm.release < 0) out.push(`${clip.id}: meter clip without release`);
  for (let i = 0; i < clip.evCount; i++) if (clip.evT[i] < 0 || clip.evT[i] > clip.dur + 1e-6) out.push(`${clip.id}: event outside [0, dur]`);
  for (const [s, L] of [['r', 'RL'], ['l', 'LL']]) {
    const b = BONE['thigh_' + s];
    if (clip.qOff[b] < 0) continue;
    for (const [t, k] of clip.def.keys) {
      const a = k[L];
      if (a && a[0] !== null && a[0] > 95 && !(tm.takeoff >= 0 && t > tm.takeoff && t < tm.land)) {
        out.push(`${clip.id}: ${L} hip ${a[0]}° > 95° at ${t} outside the air segment`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// EventRing (32 preallocated records; writer head, reader tail; monotonic counters)
// ---------------------------------------------------------------------------------------------------------------

/** Ring of preallocated {code, t, param, clip, layer} records. Read with `for (let e; (e = ring.next());)`. */
export class EventRing {
  constructor(size = 32) {
    this.size = size;
    this.buf = new Array(size);
    for (let i = 0; i < size; i++) this.buf[i] = { code: 0, t: 0, param: 0, clip: -1, layer: 0 };
    this.head = 0;
    this.tail = 0;
  }
  /** Appends an event; the oldest unread one is dropped when full. */
  push(code, t, param, clip, layer) {
    const r = this.buf[this.head % this.size];
    r.code = code; r.t = t; r.param = param; r.clip = clip; r.layer = layer;
    this.head++;
    if (this.head - this.tail > this.size) this.tail = this.head - this.size;
  }
  /** Next unread record or null. The record is reused: copy fields you keep. */
  next() { return this.tail === this.head ? null : this.buf[this.tail++ % this.size]; }
  /** Number of unread events. */
  get count() { return this.head - this.tail; }
  clear() { this.tail = this.head; }
}

// ---------------------------------------------------------------------------------------------------------------
// ClipClock — game time → clip time with warp anchors, set/key holds, the 0.05 s release push and the jump segment
// ---------------------------------------------------------------------------------------------------------------

const MAX_ANCHORS = 8;
const RATE_MIN = 0.4, RATE_MAX = 2.5;         // warp anchor rates ([ANIM §2.4.2])
const EXACT_MIN = 0.02, EXACT_MAX = 60;       // gameplay-exact anchors (release push, land, slam)
const RELEASE_PUSH = 0.050;                   // set → release always 3 fixed steps (spec §4.9.1)
const KEY_TOL = 0.10;                         // layup/hook/floater key-release tolerance (spec §4.9.3)
const HOLD_TIMEOUT = 2.0;

/**
 * Advances one clip's time in the fixed step (spec §4.4): piecewise-linear warp through anchors (gameTime → clip
 * event time; rates clamped to [0.4, 2.5] unless exact), the player's tempo outside the air segment, a hold at `set`
 * for meter 'hold' clips until releaseNow() (push to release = exactly 0.050 s), a hold at the release key for meter
 * 'key' clips when the input is late (launch at input + 0.050), the jump segment warped to the gameplay airtime
 * (setJump), and event emission with exact crossing times. Shared by Animator and AnimProxy so both time events
 * identically. Allocation free after construction.
 */
export class ClipClock {
  constructor() {
    this.src = null;
    this.aC = new Float64Array(MAX_ANCHORS); this.aG = new Float64Array(MAX_ANCHORS); this.aX = new Uint8Array(MAX_ANCHORS);
    this.reset();
  }
  reset() {
    this.src = null; this.tm = null; this.active = false; this.done = false;
    this.t = 0; this.prevT = 0; this.g = 0; this.rate = 1; this.tempo = 1; this.na = 0; this.first = true;
    this.holding = false; this.holdKind = 0; this.holdStartG = 0; this.holdUntilG = -1; this.released = false; this.inclNext = false;
    this.takeoffG = -1; this.landG = -1; this.airT = -1; this.slamT = -1; this.hangT = 0; this.jumpPending = false;
  }
  /**
   * Starts clip `src` (compiled or timing clip). `rate` multiplies everything (e.g. 0.35/stun for def.stealMiss),
   * `tempo` = the player's STYLE.tempo (ignored when the clip has tempo false), `warp` = { [EV code]: game seconds
   * since play } anchors (any subset of the clip's events).
   */
  start(src, rate = 1, tempo = 1, warp = null) {
    this.reset();
    this.src = src; this.tm = src.timing; this.active = true;
    this.rate = rate > 0 ? rate : 1;
    this.tempo = this.tm.tempo ? (src.tempoValue || tempo || 1) : 1;
    if (warp) {
      for (let i = 0; i < src.evCount; i++) {
        const c = src.evCode[i], gt = warp[c];
        if (gt !== undefined && gt !== null && i === firstIndex(src, c)) this.addAnchor(src.evT[i], gt, 0);
      }
    }
  }
  /** Inserts an anchor (clip time cT reached at game time gT since start); exact anchors bypass the rate clamp. */
  addAnchor(cT, gT, exact) {
    if (cT <= this.t + 1e-9) return;
    let n = this.na;
    // replace an anchor at the same clip time, else insert sorted by clip time
    let j = 0;
    while (j < n && this.aC[j] < cT - 1e-9) j++;
    if (j < n && Math.abs(this.aC[j] - cT) <= 1e-9) { this.aG[j] = gT; this.aX[j] = exact; }
    else {
      if (n === MAX_ANCHORS) { n--; this.na = n; if (j > n) return; }
      for (let k = n; k > j; k--) { this.aC[k] = this.aC[k - 1]; this.aG[k] = this.aG[k - 1]; this.aX[k] = this.aX[k - 1]; }
      this.aC[j] = cT; this.aG[j] = gT; this.aX[j] = exact; this.na = n + 1;
    }
    // keep game times increasing: an exact anchor removes conflicting soft ones; a conflicting soft one is dropped
    for (let k = 0; k < this.na; k++) {
      if (k === j) continue;
      const bad = (k < j && this.aG[k] >= this.aG[j]) || (k > j && this.aG[k] <= this.aG[j]);
      if (!bad) continue;
      if (exact && !this.aX[k]) { this.removeAnchor(k); if (k < j) j--; k--; }
      else if (!exact) { this.removeAnchor(j); return; }
    }
  }
  removeAnchor(k) {
    for (let i = k; i < this.na - 1; i++) { this.aC[i] = this.aC[i + 1]; this.aG[i] = this.aG[i + 1]; this.aX[i] = this.aX[i + 1]; }
    this.na--;
  }
  removeAnchorsUpTo(cT) {
    while (this.na > 0 && this.aC[0] <= cT + 1e-9) this.removeAnchor(0);
  }
  /**
   * Gameplay ballistic parameters for the air segment: airtime airT (s) from TAKEOFF to LAND; optional dunk profile
   * { slam: s after takeoff, hang: s } places SLAM (and RIM_GRAB at slam + 0.03, RIM_RELEASE after the hang).
   */
  setJump(h, airT, profile) {
    if (!this.active || !(airT > 0)) return;
    this.airT = airT;
    this.slamT = profile && profile.slam > 0 ? profile.slam : -1;
    this.hangT = profile && profile.hang > 0 ? profile.hang : 0;
    if (this.takeoffG >= 0) this.applyJump(); else this.jumpPending = true;
  }
  applyJump() {
    const tm = this.tm;
    this.jumpPending = false;
    if (tm.land > tm.takeoff && tm.takeoff >= 0) { this.landG = this.takeoffG + this.airT; this.addAnchor(tm.land, this.landG, 1); }
    if (this.slamT > 0 && tm.slam > tm.takeoff) {
      this.addAnchor(tm.slam, this.takeoffG + this.slamT, 1);
      if (tm.rimGrab > tm.slam) this.addAnchor(tm.rimGrab, this.takeoffG + this.slamT + 0.03, 1);
      if (tm.rimRelease > tm.rimGrab && tm.rimGrab > 0 && this.hangT > 0) this.addAnchor(tm.rimRelease, this.takeoffG + this.slamT + 0.03 + this.hangT, 1);
    }
  }
  /**
   * The shot release input (spec §4.9.1). Meter 'hold' clips: the remaining clip to `release` is warped into exactly
   * 0.050 s. Meter 'key' clips: an input more than 0.10 s before the key's ideal input compresses the same way;
   * otherwise the launch stays on the key; a late input (the clip waiting at the key) launches at input + 0.050
   * (immediately when within the tolerance). Returns false when the clip has no release or already released.
   */
  releaseNow() {
    if (!this.active || this.released) return false;
    const tm = this.tm;
    if (tm.release < 0 || this.t > tm.release + 1e-9) return false;
    this.released = true;
    if (tm.hold) {
      this.holding = false;
      this.removeAnchorsUpTo(tm.release);
      this.addAnchor(tm.release, this.g + RELEASE_PUSH, 1);
      return true;
    }
    if (tm.keyRelease) {
      if (this.holding) {
        this.holdUntilG = this.g - this.holdStartG <= RELEASE_PUSH ? this.g : this.g + RELEASE_PUSH;
        return true;
      }
      const gKey = this.g + this.estimateTo(tm.release);
      if (this.g + RELEASE_PUSH < gKey - KEY_TOL) {
        this.removeAnchorsUpTo(tm.release);
        this.addAnchor(tm.release, this.g + RELEASE_PUSH, 1);
      }
      return true;
    }
    return true;
  }
  /** Estimated game seconds until clip time cT under the current anchors / base rate (no allocation). */
  estimateTo(cT) {
    let t = this.t, g = 0;
    for (let k = 0; k < this.na && this.aC[k] <= cT; k++) { g = this.aG[k] - this.g; t = this.aC[k]; }
    const r = this.baseRate(t);
    return g + (cT - t) / r;
  }
  inAir(t) { const tm = this.tm; return tm.takeoff >= 0 && tm.land > tm.takeoff && t >= tm.takeoff && t < tm.land; }
  baseRate(t) { return this.inAir(t) ? this.rate : this.rate / this.tempo; }
  /** Stops the clip (no events). */
  stop() { this.active = false; }

  /**
   * Advances dt game seconds. Events crossed are pushed into ring with absolute time now + offset (now = game time
   * at the start of this step); clipIdx / layer tag the records. Returns the new clip time.
   */
  step(dt, now, ring, clipIdx, layer) {
    if (!this.active) return this.t;
    const tm = this.tm;
    this.prevT = this.t;
    let rem = dt, el = 0;
    for (let guard = 0; guard < 32 && rem > 1e-12; guard++) {
      // ---- holds: 1 = at `set` until the release input, 2 = at the release key of a 'key' clip ----
      if (this.holding) {
        if (!this.released && ((this.landG >= 0 && this.g >= this.landG - KEY_TOL - 1e-9) || this.g - this.holdStartG >= HOLD_TIMEOUT - 1e-9)) {
          this.releaseNow();                       // safety: never land or stall with the ball in the hands
        }
        if (this.holdKind === 1 && this.released) this.holding = false;
        else if (this.holdKind === 2 && this.released && this.g >= this.holdUntilG - 1e-9) { this.holding = false; this.inclNext = true; }
        if (this.holding) {
          let wait = rem;
          if (this.released) wait = this.holdUntilG - this.g;
          else {
            let lim = this.holdStartG + HOLD_TIMEOUT - this.g;
            if (this.landG >= 0 && this.landG - KEY_TOL - this.g < lim) lim = this.landG - KEY_TOL - this.g;
            wait = lim;
          }
          if (wait < 1e-6) wait = 1e-6;
          if (wait > rem) wait = rem;
          this.g += wait; el += wait; rem -= wait;
          continue;
        }
      }
      // ---- rate for this segment ----
      let r;
      let bound = tm.dur;
      if (this.na > 0) {
        const dG = this.aG[0] - this.g, dC = this.aC[0] - this.t;
        const ex = this.aX[0] === 1;
        const lo = ex ? EXACT_MIN : RATE_MIN, hi = ex ? EXACT_MAX : RATE_MAX;
        r = dG > 1e-9 ? dC / dG : hi;
        r = r < lo ? lo : r > hi ? hi : r;
        if (this.aC[0] < bound) bound = this.aC[0];
      } else r = this.baseRate(this.t);
      const setHold = tm.hold && !this.released && this.t < tm.holdAt - 1e-9;
      const keyHold = tm.keyRelease && !this.released && this.t < tm.release - 1e-9;
      if (setHold && tm.holdAt < bound) bound = tm.holdAt;
      if (keyHold && tm.release < bound) bound = tm.release;
      // in the air segment without anchors the clip runs untempo'd; crossing takeoff changes the base rate
      if (this.na === 0 && tm.takeoff > this.t + 1e-9 && tm.takeoff < bound && this.tempo !== 1) bound = tm.takeoff;
      if (this.na === 0 && tm.land > this.t + 1e-9 && tm.land < bound && this.tempo !== 1 && this.inAir(this.t)) bound = tm.land;
      const tEnd = this.t + r * rem;
      if (tEnd < bound - 1e-9) {
        this.fire(this.t, tEnd, now + el, r, ring, clipIdx, layer, false);
        this.t = tEnd; this.g += rem; el += rem; rem = 0;
        break;
      }
      const seg = r > 0 ? Math.min(rem, (bound - this.t) / r) : rem;
      const atKey = keyHold && Math.abs(bound - tm.release) < 1e-9;
      this.fire(this.t, bound, now + el, r, ring, clipIdx, layer, atKey);
      this.t = bound; this.g += seg; el += seg; rem -= seg;
      if (this.na > 0 && Math.abs(this.aC[0] - bound) < 1e-9) this.removeAnchor(0);
      if (setHold && Math.abs(bound - tm.holdAt) < 1e-9) { this.holding = true; this.holdKind = 1; this.holdStartG = this.g; continue; }
      if (atKey) { this.holding = true; this.holdKind = 2; this.holdStartG = this.g; this.holdUntilG = -1; continue; }
      if (bound >= tm.dur - 1e-9) {
        if (this.src.loop) { this.t = 0; this.first = true; this.na = 0; }
        else { this.done = true; this.active = false; break; }
      }
    }
    return this.t;
  }

  /** Emits events with clip time in (t0, t1]; inclusive of t0 on the first segment or after a key hold; exclusive of
   *  t1 when stopping at a key hold (the release fires when the hold ends). */
  fire(t0, t1, g0, r, ring, clipIdx, layer, exclEnd) {
    const src = this.src;
    const incl = this.first || this.inclNext;
    this.first = false; this.inclNext = false;
    for (let i = 0; i < src.evCount; i++) {
      const te = src.evT[i];
      if (te > t1 + 1e-9) break;
      if (incl ? te < t0 - 1e-9 : te <= t0 + 1e-9) continue;
      if (exclEnd && te >= t1 - 1e-9) continue;
      const code = src.evCode[i];
      const off = r > 0 ? (te - t0) / r : 0;
      if (ring) ring.push(code, g0 + off, src.evParam[i], clipIdx, layer);
      if (code === EV.TAKEOFF && this.takeoffG < 0) {
        this.takeoffG = this.g + off;
        if (this.jumpPending) this.applyJump();
      }
    }
  }
}

function firstIndex(src, code) {
  for (let i = 0; i < src.evCount; i++) if (src.evCode[i] === code) return i;
  return -1;
}

// ---------------------------------------------------------------------------------------------------------------
// RootMotion — clip root curve → desired world velocity and yaw delta per fixed step (spec §4.4)
// ---------------------------------------------------------------------------------------------------------------

const _r0 = new Float64Array(3), _r1 = new Float64Array(3), _rT = new Float64Array(3);
const ENTRY = { replace: 0, carry: 1, stop: 2 };

/**
 * Per-play root motion state. begin() at play time, step() every fixed step with the clock's old/new clip time.
 * Outputs (fields): vx, vz (desired world velocity, m/s), dyaw (yaw change this step, rad), active; exitVx/exitVz/
 * hasExit when the clip ends with params.exitV. Entry policies: replace / carry (vIn·e^(−t/0.25) or
 * params.carryScale) / stop (vIn braking at entryDecel until takeoff); the carried part is frozen in the air.
 */
export class RootMotion {
  constructor() {
    this.active = false; this.vx = 0; this.vz = 0; this.dyaw = 0;
    this.exitVx = 0; this.exitVz = 0; this.hasExit = false;
    this.psi0 = 0; this.cos0 = 1; this.sin0 = 0; this.sLeg = 1;
    this.vInX = 0; this.vInZ = 0; this.vIn = 0; this.entry = 0; this.decel = 18;
    this.dX = 0; this.dZ = 0; this.dYaw = 0; this.tTarget = -1; this.fits = true;
    this.kAir = -1; this.src = null;
  }
  /**
   * Starts root motion for clip src from world position (x0, z0), yaw psi0, entry velocity (vInX, vInZ).
   * `target` {x, z, yaw?} (world) bends the curve so the clip's target event lands there; returns false when the
   * requested correction exceeds the limits (it is clamped; select.js should have chosen another clip).
   */
  begin(src, sLeg, x0, z0, psi0, vInX, vInZ, target) {
    const tm = src.timing;
    this.src = src; this.active = tm.root; this.sLeg = sLeg;
    this.psi0 = psi0; this.cos0 = Math.cos(psi0); this.sin0 = Math.sin(psi0);
    this.vInX = vInX; this.vInZ = vInZ; this.vIn = Math.hypot(vInX, vInZ);
    this.entry = ENTRY[tm.entry] || 0; this.decel = tm.entryDecel;
    this.dX = 0; this.dZ = 0; this.dYaw = 0; this.tTarget = -1; this.fits = true; this.kAir = -1;
    this.vx = 0; this.vz = 0; this.dyaw = 0; this.hasExit = false;
    if (target && tm.targetT > 0) {
      sampleRoot(src, tm.targetT, _rT);
      // world offset → clip-start frame (inverse yaw rotation), in reference metres
      const wx = target.x - x0, wz = target.z - z0;
      const lx = (wx * this.cos0 - wz * this.sin0) / sLeg, lz = (wx * this.sin0 + wz * this.cos0) / sLeg;
      let dx = lx - _rT[0], dz = lz - _rT[1];
      const lim = Math.max(0.25 / sLeg, 0.35 * Math.hypot(_rT[0], _rT[1]));
      const dl = Math.hypot(dx, dz);
      if (dl > lim) { dx *= lim / dl; dz *= lim / dl; this.fits = false; }
      let dy = 0;
      if (typeof target.yaw === 'number') {
        dy = wrapPi(target.yaw - (psi0 + _rT[2]));
        const ylim = 25 * DEG;
        if (Math.abs(dy) > ylim) { dy = Math.sign(dy) * ylim; this.fits = false; }
      }
      this.dX = dx; this.dZ = dz; this.dYaw = dy; this.tTarget = tm.targetT;
    }
    return this.fits;
  }
  /** Carried entry-velocity factor at game seconds gs since play (frozen at the takeoff once airborne). */
  carryFactor(gs, airborne, gsTakeoff = -1) {
    if (airborne && this.kAir >= 0) return this.kAir;
    if (airborne && gsTakeoff >= 0 && gsTakeoff < gs) gs = gsTakeoff;
    let k;
    const cs = this.src.timing.params.carryScale;
    if (this.entry === 0) k = 0;
    else if (this.entry === 1) {
      if (cs) { k = 1; for (let i = 0; i < cs.length; i++) if (gs >= cs[i][0] && gs < cs[i][1]) k = cs[i][2]; }
      else k = Math.exp(-gs / 0.25);
    } else k = this.vIn > 1e-6 ? Math.max(0, 1 - this.decel * gs / this.vIn) : 0;
    if (airborne) this.kAir = k;
    return k;
  }
  /**
   * One fixed step from clip time tOld to tNew (dt game seconds, gs = game seconds since play, airborne = the clip
   * is inside its air segment, gsTakeoff = game seconds since play at the TAKEOFF event or −1 — the clock's
   * takeoffG). Writes vx, vz, dyaw.
   */
  step(tOld, tNew, dt, gs, airborne, gsTakeoff = -1) {
    if (!this.active) { this.vx = 0; this.vz = 0; this.dyaw = 0; return; }
    const src = this.src;
    sampleRoot(src, tOld, _r0);
    sampleRoot(src, tNew, _r1);
    let dx = _r1[0] - _r0[0], dz = _r1[1] - _r0[1], dyw = _r1[2] - _r0[2];
    if (this.tTarget > 0) {
      const s = smooth01(tNew / this.tTarget) - smooth01(tOld / this.tTarget);
      dx += this.dX * s; dz += this.dZ * s; dyw += this.dYaw * s;
    }
    dx *= this.sLeg; dz *= this.sLeg;
    // clip-start frame (x = own left, z = forward) → world: rotateY(ψ0)
    const inv = dt > 1e-9 ? 1 / dt : 0;
    const k = this.carryFactor(gs, airborne, gsTakeoff);
    this.vx = (dx * this.cos0 + dz * this.sin0) * inv + this.vInX * k;
    this.vz = (-dx * this.sin0 + dz * this.cos0) * inv + this.vInZ * k;
    this.dyaw = dyw;
    const ev = src.timing.exitV;
    if (ev && tNew >= src.dur - 1e-9 && !this.hasExit) {
      this.hasExit = true;
      this.exitVx = ev[0] * this.cos0 + ev[1] * this.sin0;
      this.exitVz = -ev[0] * this.sin0 + ev[1] * this.cos0;
    }
  }
}

function wrapPi(a) {
  a %= 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI; else if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---------------------------------------------------------------------------------------------------------------
// Registry: string ids ↔ integer indices; shared and per-player defs; lazily compiled twins
// ---------------------------------------------------------------------------------------------------------------

const REG = { ids: [], byId: new Map(), entries: [] };

/** Integer index of clip id (reserved on first use, so select.js can resolve ids before clip modules register). */
export function clipIndex(id) {
  let i = REG.byId.get(id);
  if (i !== undefined) return i;
  i = REG.ids.length;
  REG.ids.push(id); REG.byId.set(id, i);
  REG.entries.push({ id, def: null, per: null, comp: null, compL: null, perComp: null });
  return i;
}

/**
 * Registers a clip definition (shared, or for one player when playerId is given — generator output). Re-registering
 * replaces the previous def and drops its compiled copies. Returns the clip index.
 */
export function registerClip(def, playerId) {
  const d = defineClip(def);
  if (d.id.endsWith('_L')) throw new Error(`clip '${d.id}': register the right-handed clip; '_L' twins are automatic`);
  const i = clipIndex(d.id);
  const e = REG.entries[i];
  if (playerId) {
    if (!STYLE[playerId]) throw new Error(`clip '${d.id}': unknown player '${playerId}'`);
    if (!e.per) e.per = {};
    e.per[playerId] = d;
    if (e.perComp) e.perComp[playerId] = null;
  } else { e.def = d; e.comp = null; e.compL = null; e.perComp = null; }
  return i;
}

/** The registered definition (per-player when one exists for playerId), or null. */
export function getDef(idx, playerId) {
  const e = REG.entries[idx];
  if (!e) return null;
  if (playerId && e.per && e.per[playerId]) return e.per[playerId];
  return e.def;
}

/** True when a definition is registered for clip idx (and player, if given). */
export function hasClip(idx, playerId) { return getDef(idx, playerId) !== null; }

/**
 * Compiled clip for (idx, playerId, mirror) or null when no def is registered. Compiles on first use (allocation;
 * call compileAll at load so the frame loop never compiles).
 */
export function getClip(idx, playerId, mirror) {
  const e = REG.entries[idx];
  if (!e) return null;
  const perDef = playerId && e.per && e.per[playerId];
  const usesPer = perDef || (playerId && e.def && e.def.per && e.def.per[playerId]);
  if (usesPer) {
    if (!e.perComp) e.perComp = {};
    let c = e.perComp[playerId];
    if (!c) {
      const d = perDef || e.def;
      c = e.perComp[playerId] = [compileClip(d, playerId), null, d];
    }
    if (mirror) { if (!c[1]) c[1] = compileClip(mirrorDef(c[2]), playerId); return c[1]; }
    return c[0];
  }
  if (!e.def) return null;
  if (mirror) return e.compL || (e.compL = compileClip(mirrorDef(e.def)));
  return e.comp || (e.comp = compileClip(e.def));
}

/** Pre-compiles every registered clip (both sides) for the given players; returns the number of compiled clips. */
export function compileAll(playerIds = Object.keys(STYLE)) {
  let n = 0;
  for (let i = 0; i < REG.entries.length; i++) {
    const e = REG.entries[i];
    if (e.def) { getClip(i, null, false); getClip(i, null, true); n += 2; }
    for (const p of playerIds) {
      if ((e.per && e.per[p]) || (e.def && e.def.per && e.def.per[p])) { getClip(i, p, false); getClip(i, p, true); n += 2; }
    }
  }
  return n;
}

/** Clip id of an index. */
export function clipIdOf(idx) { return REG.ids[idx]; }
/** Number of reserved clip indices. */
export function clipCount() { return REG.ids.length; }
/** All reserved ids (copy). */
export function clipIds() { return REG.ids.slice(); }

/** FINGER preset names re-exported for authoring convenience. */
export { FINGER_PRESETS };
