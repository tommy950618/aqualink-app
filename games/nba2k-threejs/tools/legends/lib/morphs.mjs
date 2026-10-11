/**
 * morphs.mjs — the 9 facial expression morph channels of SPEC-v2 §3.9 (CHR §8), baked as sparse per-player
 * deltas on kept vertices.
 *
 * Channel recipe (per player, `expressions.<channel>` in legends.config.json):
 *   modifiers  MakeHuman detail modifiers added on top of the player's own values. The delta is
 *              f(v_player + v_expr) − f(v_player) with MakeHuman's two-target split (a value crossing 0 swaps
 *              the decr/incr target), times the player's OBJ → metre scale (UNIT·scale).
 *   jaw        {rotDeg, translate}: rotation about the x axis through the player's jaw pivot (`joint-mouth`
 *              cube, the default rig's jaw head) by rotDeg·wJ, then translation·wJ (metres). Positive rotDeg
 *              opens the mouth (R_x(α) maps +z toward −y). wJ is the shared jaw field below.
 *   tongue     {translate}: tongue vertices move by translate·wT (metres, after the jaw rotation).
 *   lids       true (or a fraction 0..1): procedural blink (§8.3): upper lid rotates down about the x axis through the eye centre,
 *              lower lid rises by a quarter of that, lash cards follow their lid.
 * Storage (§3.9): per target the kept indices (u16) and Δ as int16 × 0.00002 m; vertices with |Δ| < 0.05 mm are
 * dropped. Only the channels listed for a player are baked.
 */
import { detailTargetList, applyTarget } from './targets.mjs';
import { LANDMARK_OBJ } from './landmarks.mjs';

export const MORPH_NAMES = Object.freeze(['jawOpen', 'tongueOut', 'jawJut', 'roar', 'grin', 'smirk', 'scowl', 'puff', 'blink']);
export const DELTA_STEP = 0.00002;    // metres per int16 unit (i16q)
export const DROP_BELOW = 0.00005;    // |Δ| < 0.05 mm is not stored

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Jaw field wJ per base.obj vertex (CHR §8.2), evaluated once on the base mesh (metres).
 * wJ = clamp(max(wDefaultJaw, wLip·mouthRegion, wSide), 0, 1) on head-family vertices; neck below ME fades
 * 1 → 0 over 0.035 m; lower teeth and tongue = 1.
 * @param {object} o
 * @param {Float64Array} o.basePosM base.obj positions in metres
 * @param {object} o.weightsDefault MPFB weights.default.json ({weights: {bone: [[v, w]…]}})
 * @param {Float32Array} o.headFamily per obj vertex: summed game_engine weight of head + neck_01
 * @param {number[]} o.pivot jaw pivot on the base mesh (metres)
 * @param {{lowerTeeth:number[], tongue:number[]}} o.helpers obj indices
 * @param {number} o.nObj
 */
export function jawField({ basePosM, weightsDefault, headFamily, pivot, helpers, nObj, ecY }) {
  const W = weightsDefault.weights || weightsDefault;
  const wDef = new Float64Array(nObj);
  for (const [v, w] of W.jaw || []) if (v < nObj) wDef[v] = Math.max(wDef[v], w);
  const P = (o, a) => basePosM[o * 3 + a];
  const L = (n) => [P(LANDMARK_OBJ[n], 0), P(LANDMARK_OBJ[n], 1), P(LANDMARK_OBJ[n], 2)];
  const ST = L('ST'), CH = L('CH_l'), ME = L('ME'), GO = L('GO_l');
  const CHx = Math.abs(CH[0]);
  // lip seam curve yS(x) (CHR §2.3): from the stomion to the mouth corners
  const yS = (x) => ST[1] + (CH[1] - ST[1]) * Math.min(1, (Math.abs(x) / CHx)) ** 2;
  const out = new Float64Array(nObj);
  for (let o = 0; o < nObj; o++) {
    if (headFamily[o] <= 0) continue;
    const x = P(o, 0), y = P(o, 1), z = P(o, 2), ax = Math.abs(x);
    let w = wDef[o];
    // lips: 1 below the seam (split 1 mm below it), inside the mouth region incl. the cavity lining
    if (ax < CHx + 0.006 && y > ST[1] - 0.03 && y < ST[1] + 0.012 && z > 0.10) {
      const s = yS(x);
      w = Math.max(w, smooth(s + 0.0006, s - 0.0012, y));
    }
    // cheek sides between the mouth corner and the gonion: below the line CH → pivot in the (z, y) plane
    if (ax >= CHx && ax <= Math.abs(GO[0]) + 0.01) {
      const dz = pivot[2] - CH[2], dy = pivot[1] - CH[1];
      const len = Math.hypot(dz, dy) || 1;
      // signed distance below the line (positive below): 2D cross product dir × (p − CH) in the (z, y) plane;
      // the line runs backward (dz < 0) and up, so a point under it gives a positive cross product
      const below = (dz * (y - CH[1]) - dy * (z - CH[2])) / len;
      const fadeUp = 1 - smooth(ecY - 0.03, ecY - 0.02, y);
      w = Math.max(w, smooth(-0.004, 0.012, below) * fadeUp);
    }
    if (y < ME[1]) w *= smooth(ME[1] - 0.035, ME[1], y);
    out[o] = Math.max(0, Math.min(1, w));
  }
  for (const o of helpers.lowerTeeth) out[o] = 1;
  for (const o of helpers.tongue) out[o] = 1;
  return out;
}

/** Tongue weight wT per obj vertex: default-rig tongue03–07 weight × 1, tongue00–02 × 0.4 (CHR §8.1). */
export function tongueField(weightsDefault, nObj) {
  const W = weightsDefault.weights || weightsDefault;
  const out = new Float64Array(nObj);
  for (const [bone, list] of Object.entries(W)) {
    const m = /^tongue0(\d)/.exec(bone);
    if (!m) continue;
    const k = +m[1] >= 3 ? 1 : 0.4;
    for (const [v, w] of list) if (v < nObj) out[v] = Math.min(1, out[v] + w * k);
  }
  return out;
}

/**
 * Modifier delta f(v0 + dv) − f(v0) in OBJ units for one config key.
 * @param {object} targetIndex target.json
 * @param {string} key "<group>/<modifier>"
 * @param {number|{l:number,r:number}} v0 the player's value (0 if absent)
 * @param {number} dv expression amount
 */
function modifierDelta(targetIndex, getTarget, nObj, key, v0, dv) {
  const out = new Float64Array(nObj * 3);
  const sides = typeof v0 === 'object' && v0 ? v0 : null;
  const before = sides ? { [key]: { l: sides.l ?? 0, r: sides.r ?? 0 } } : { [key]: v0 || 0 };
  const after = sides ? { [key]: { l: (sides.l ?? 0) + dv, r: (sides.r ?? 0) + dv } } : { [key]: (v0 || 0) + dv };
  for (const [rel, w] of detailTargetList(targetIndex, after)) applyTarget(out, getTarget(rel), w);
  for (const [rel, w] of detailTargetList(targetIndex, before)) applyTarget(out, getTarget(rel), -w);
  return out;
}

/** Every target file the expressions of a config need (for fetching). */
export function expressionTargetFiles(targetIndex, player) {
  const files = new Set();
  for (const ch of Object.values(player.expressions || {})) {
    for (const [key, dv] of Object.entries(ch.modifiers || {})) {
      const v0 = (player.targets || {})[key] ?? 0;
      const sides = typeof v0 === 'object';
      for (const v of [v0, sides ? { l: (v0.l ?? 0) + dv, r: (v0.r ?? 0) + dv } : v0 + dv]) {
        for (const [rel] of detailTargetList(targetIndex, { [key]: v })) files.add(rel);
      }
    }
  }
  return [...files];
}

/** Quadratic through three (x, y) points, evaluated at x (eyelid margin curves EN–PS–EX / EN–PI–EX). */
function quad3(p0, p1, p2) {
  const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2;
  return (x) => y0 * ((x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2)) + y1 * ((x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2)) + y2 * ((x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1));
}

/**
 * Blink deltas (CHR §8.3) on the player's kept positions.
 * @returns {Float64Array} Δ per kept vertex (metres)
 */
function blinkDelta({ keptPos, nKept, keptToObj, bodyKeptCount, lashKept, eyes, face }) {
  const out = new Float64Array(nKept * 3);
  for (const side of ['l', 'r']) {
    const s = side === 'l' ? 1 : -1;
    const EC = side === 'l' ? face.EC_l : face.EC_r;
    const EN = face[`EN_${side}`], EX = face[`EX_${side}`], PS = face[`PS_${side}`], PI = face[`PI_${side}`];
    const R = eyes[side].r;
    const yU = quad3([EN[0], EN[1]], [PS[0], PS[1]], [EX[0], EX[1]]);
    const yLo = quad3([EN[0], EN[1]], [PI[0], PI[1]], [EX[0], EX[1]]);
    const yMid = (x) => yLo(x) + (yU(x) - yLo(x)) * 0.35;
    // θ: angle that brings the top of the upper margin (PS) down to the fissure mid-line, about the EC x-axis
    const Rp = Math.hypot(PS[1] - EC[1], PS[2] - EC[2]);
    const theta = Math.asin(Math.max(-1, Math.min(1, (PS[1] - EC[1]) / Rp))) - Math.asin(Math.max(-1, Math.min(1, (yMid(PS[0]) - EC[1]) / Rp)));
    const rot = (k, alpha) => {
      // rotate kept vertex k about the axis through EC parallel to x by alpha (positive = top toward −y in front)
      const y = keptPos[k * 3 + 1] - EC[1], z = keptPos[k * 3 + 2] - EC[2];
      const c = Math.cos(alpha), sn = Math.sin(alpha);
      out[k * 3 + 1] += (y * c - z * sn) - y;
      out[k * 3 + 2] += (y * sn + z * c) - z;
    };
    for (let k = 0; k < bodyKeptCount; k++) {
      const x = keptPos[k * 3], y = keptPos[k * 3 + 1], z = keptPos[k * 3 + 2];
      if (Math.sign(x) !== s || Math.abs(x - EC[0]) >= 0.016 || z <= EC[2]) continue;
      if (Math.hypot(x - EC[0], y - EC[1], z - EC[2]) > R + 0.010) continue;
      const mid = yMid(x);
      if (y > mid) {
        const above = y - yU(x);
        const wL = 1 - smooth(0.002, 0.009, above);
        if (wL > 0) rot(k, theta * wL);
      } else {
        const below = yLo(x) - y;
        const wLow = 1 - smooth(0.0015, 0.003, below);
        if (wLow > 0) rot(k, -0.25 * theta * wLow);
      }
    }
    for (const k of lashKept[side].upper) rot(k, theta);
    for (const k of lashKept[side].lower) rot(k, -0.25 * theta);
    eyes[side].blinkDeg = theta * 180 / Math.PI;
  }
  return out;
}

/**
 * Bakes the expression channels of one player.
 * @param {object} o
 * @param {object} o.player config player (targets, expressions)
 * @param {object} o.targetIndex target.json
 * @param {(rel:string)=>{idx:Int32Array,d:Float64Array}} o.getTarget
 * @param {number} o.nObj
 * @param {number} o.s OBJ → metre scale of this player (UNIT·scale)
 * @param {Float64Array} o.keptPos player kept positions (metres)
 * @param {number[]} o.keptToObj kept → obj (65535 = generated vertex)
 * @param {number} o.bodyKeptCount kept vertices [0, bodyKeptCount) are body skin
 * @param {Float64Array} o.wJ jaw weight per KEPT vertex (the field of jawField(), lip seam resolved by side)
 * @param {Float64Array} o.wT tongue field per obj vertex
 * @param {number[]} o.pivot jaw pivot (player metres)
 * @param {object} o.lashKept {l:{upper,lower}, r:{…}} kept indices of the lash cards
 * @param {object} o.eyes {l:{c,r}, r:{c,r}}
 * @param {object} o.face landmark positions on the player (metres, incl. EC_l/EC_r)
 * @returns {{name:string, idx:Uint16Array, delta:Int16Array, count:number, maxAbs:number}[]} in MORPH_NAMES order
 */
export function bakeMorphs(o) {
  const { player, targetIndex, getTarget, nObj, s, keptPos, keptToObj, wJ, wT, pivot } = o;
  const nKept = keptToObj.length;
  const res = [];
  for (const name of MORPH_NAMES) {
    const ch = (player.expressions || {})[name];
    if (!ch) continue;
    const D = new Float64Array(nKept * 3);
    // 1. modifiers (OBJ units → metres)
    for (const [key, dv] of Object.entries(ch.modifiers || {})) {
      const d = modifierDelta(targetIndex, getTarget, nObj, key, (player.targets || {})[key], dv);
      for (let k = 0; k < nKept; k++) {
        const ob = keptToObj[k];
        if (ob >= nObj) continue;
        D[k * 3] += d[ob * 3] * s; D[k * 3 + 1] += d[ob * 3 + 1] * s; D[k * 3 + 2] += d[ob * 3 + 2] * s;
      }
    }
    // 2. jaw rotation + translation about the pivot (on the neutral positions)
    if (ch.jaw) {
      const a0 = (ch.jaw.rotDeg || 0) * Math.PI / 180;
      const tr = ch.jaw.translate || [0, 0, 0];
      for (let k = 0; k < nKept; k++) {
        const ob = keptToObj[k];
        if (ob >= nObj) continue;
        const w = wJ[k];
        if (!(w > 0)) continue;
        const y = keptPos[k * 3 + 1] - pivot[1], z = keptPos[k * 3 + 2] - pivot[2];
        const a = a0 * w, c = Math.cos(a), sn = Math.sin(a);
        D[k * 3] += tr[0] * w;
        D[k * 3 + 1] += (y * c - z * sn) - y + tr[1] * w;
        D[k * 3 + 2] += (y * sn + z * c) - z + tr[2] * w;
      }
    }
    // 3. tongue translation
    if (ch.tongue) {
      const tr = ch.tongue.translate || [0, 0, 0];
      for (let k = 0; k < nKept; k++) {
        const ob = keptToObj[k];
        if (ob >= nObj || !(wT[ob] > 0)) continue;
        for (let a = 0; a < 3; a++) D[k * 3 + a] += tr[a] * wT[ob];
      }
    }
    // 4. procedural blink
    if (ch.lids) {
      const b = blinkDelta({ keptPos, nKept, keptToObj, bodyKeptCount: o.bodyKeptCount, lashKept: o.lashKept, eyes: o.eyes, face: o.face });
      // `lids: true` = full blink; a number in (0, 1] = that fraction of it (e.g. Yao's grin squeezing the eyes)
      const lk = typeof ch.lids === 'number' ? Math.max(0, Math.min(1, ch.lids)) : 1;
      for (let i = 0; i < D.length; i++) D[i] += b[i] * lk;
    }
    // sparse i16q
    const idx = [], dl = [];
    let maxAbs = 0;
    for (let k = 0; k < nKept; k++) {
      const m = Math.hypot(D[k * 3], D[k * 3 + 1], D[k * 3 + 2]);
      if (m < DROP_BELOW) continue;
      maxAbs = Math.max(maxAbs, m);
      idx.push(k);
      for (let a = 0; a < 3; a++) dl.push(Math.max(-32767, Math.min(32767, Math.round(D[k * 3 + a] / DELTA_STEP))));
    }
    res.push({ name, idx: Uint16Array.from(idx), delta: Int16Array.from(dl), count: idx.length, maxAbs });
  }
  return res;
}
