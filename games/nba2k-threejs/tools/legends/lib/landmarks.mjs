/**
 * landmarks.mjs — frozen face landmarks of the MakeHuman hm08 base mesh, the per-player face frame used by every
 * per-player field (hair, beard, brows, masks, morphs), the ear vertex set, and the likeness metrics + target
 * bands checked by `measure.mjs --likeness` (SPEC-v2 §3.5.2, §10.2; CHR §2.2, §10.2).
 *
 * Indices are base.obj vertex indices (0-based). Left-side landmarks (`_l`, character's left = +x) are listed;
 * right-side ones are their exact x-mirror (hm08 is symmetric to 0.00 mm), found by `mirrorIndex`.
 * Checked on the base mesh: every quoted CHR §2.2 position is reproduced to < 0.1 mm except SN, whose quoted
 * index 342 lies 1.4 mm right of the midline; the midline vertex 343 at the quoted (0, .6789, .1563) is used.
 * GO (gonion): the quoted 7530 at (.0448, .6352, .0325) lies on the neck 3.5 cm behind the tragus; the mandible
 * angle is vertex 7691 at (.0539, .6614, .0658) (normal lateral-down-back, below and in front of the ear lobe).
 */

/** obj index per landmark (left side + midline). `EC_l` is not a vertex: it is the `joint-l-eye` cube mean. */
export const LANDMARK_OBJ = Object.freeze({
  G: 237, N: 132, PRN: 297, SN: 343, LS: 455, ST: 468, LI: 492, SM: 491, PG: 733, ME: 5296, FH: 983, V: 879, OP: 5389,
  CH_l: 7174, AL_l: 11685, EN_l: 7795, EX_l: 7782, PS_l: 7774, PI_l: 7787, ZY_l: 11798, GO_l: 7691, T_l: 12332,
  EL_l: 12050, ET_l: 7565,
});

/** Last body vertex of base.obj (0..13379 are the skin; helpers follow). */
export const BODY_LAST = 13379;

const mirrorCache = new WeakMap();

/**
 * Exact x-mirror of a base.obj vertex (search over the body vertices, cached per position array).
 * @param {number} obj vertex index
 * @param {Float64Array} basePos base.obj positions (any unit)
 */
export function mirrorIndex(obj, basePos) {
  let m = mirrorCache.get(basePos);
  if (!m) { m = new Map(); mirrorCache.set(basePos, m); }
  if (m.has(obj)) return m.get(obj);
  const x = -basePos[obj * 3], y = basePos[obj * 3 + 1], z = basePos[obj * 3 + 2];
  let best = -1, bd = Infinity;
  for (let j = 0; j <= BODY_LAST; j++) {
    const d = (basePos[j * 3] - x) ** 2 + (basePos[j * 3 + 1] - y) ** 2 + (basePos[j * 3 + 2] - z) ** 2;
    if (d < bd) { bd = d; best = j; }
  }
  m.set(obj, best);
  return best;
}

/** Full landmark table {name: obj} including the mirrored `_r` names. */
export function landmarkTable(basePos) {
  const out = {};
  for (const [name, obj] of Object.entries(LANDMARK_OBJ)) {
    out[name] = obj;
    if (name.endsWith('_l')) out[name.slice(0, -2) + '_r'] = mirrorIndex(obj, basePos);
  }
  return out;
}

/**
 * Per-player face frame (CHR §2.2): every per-player field is expressed in it.
 * @param {(obj:number)=>number[]} P position of a base.obj vertex on the player's mesh (metres)
 * @param {{l:number[], r:number[]}} eyeJoints `joint-l-eye` / `joint-r-eye` cube means on the player's mesh
 */
export function faceFrame(P, eyeJoints) {
  const L = {};
  for (const [name, obj] of Object.entries(LANDMARK_OBJ)) L[name] = P(obj);
  L.EC_l = eyeJoints.l; L.EC_r = eyeJoints.r;
  const EC = [(L.EC_l[0] + L.EC_r[0]) / 2, (L.EC_l[1] + L.EC_r[1]) / 2, (L.EC_l[2] + L.EC_r[2]) / 2];
  const headCZ = 0.5 * (L.G[2] + L.OP[2]);
  const f = {
    L, Gy: L.G[1], EC, ECx: Math.abs(L.EC_l[0]), headCZ, CHx: Math.abs(L.CH_l[0]),
    /** azimuth around the head, 0 = face centre, π = back (unsigned) */
    phi: (x, z) => Math.atan2(Math.abs(x), z - headCZ),
    /** signed azimuth (left of the face positive), seam at the back */
    phiS: (x, z) => Math.atan2(x, z - headCZ),
    /** horizontal distance from the head axis */
    r: (x, z) => Math.hypot(x, z - headCZ),
  };
  f.phiT = f.phi(L.T_l[0], L.T_l[2]);
  f.rT = f.r(L.T_l[0], L.T_l[2]);
  f.phiCH = f.phi(L.CH_l[0], L.CH_l[2]);
  f.rCH = f.r(L.CH_l[0], L.CH_l[2]);
  return f;
}

/** Ear vertex set on base.obj (metres): |x| > 0.071 ∧ 0.682 < y < 0.746 ∧ 0.016 < z < 0.075. */
export function earSet(basePosM) {
  const out = [];
  for (let o = 0; o <= BODY_LAST; o++) {
    const x = basePosM[o * 3], y = basePosM[o * 3 + 1], z = basePosM[o * 3 + 2];
    if (Math.abs(x) > 0.071 && y > 0.682 && y < 0.746 && z > 0.016 && z < 0.075) out.push(o);
  }
  return out;
}

/**
 * Refined ear vertex set for grooming and skin masks: the box of `earSet` also captures skull vertices around the
 * ear root (the skull reaches |x| ≈ 0.0715 at ear level), which showed as a bald, reddened block above each ear.
 * Ear = box vertices protruding past |x| > 0.074, plus every box vertex inside the convex hull of those in the
 * side (y, z) projection (the concha and the skull hidden behind the ear). The metric set stays `earSet`.
 */
export function earSetRefined(basePosM) {
  const box = earSet(basePosM);
  const out = new Set();
  for (const side of [1, -1]) {
    const mine = box.filter((o) => Math.sign(basePosM[o * 3]) === side);
    const strong = mine.filter((o) => Math.abs(basePosM[o * 3]) > 0.074);
    const pts = strong.map((o) => [basePosM[o * 3 + 2], basePosM[o * 3 + 1]]);   // (z, y)
    const hull = convexHull(pts);
    for (const o of strong) out.add(o);
    for (const o of mine) if (insideConvex(hull, basePosM[o * 3 + 2], basePosM[o * 3 + 1], 0.001)) out.add(o);
  }
  return [...out].sort((a, b) => a - b);
}

/** Andrew's monotone chain convex hull of 2D points (counter-clockwise). */
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Point inside a counter-clockwise convex polygon, grown by `margin`. */
function insideConvex(h, x, y, margin) {
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey) || 1;
    if ((ex * (y - a[1]) - ey * (x - a[0])) / len < -margin) return false;
  }
  return true;
}

// ---- likeness metrics (§10.2; definitions = the measurement scripts the baselines came from) ----------------
const sel = (basePosM, f) => { const r = []; for (let o = 0; o <= BODY_LAST; o++) if (f(basePosM[o * 3], basePosM[o * 3 + 1], basePosM[o * 3 + 2])) r.push(o); return r; };

/** Base-mesh vertex sets used by the metrics (selected once on base.obj, evaluated on each player). */
export function metricSets(basePosM) {
  return {
    // alar region incl. the cheek–nose junction (so noseIcd is an ordering metric only)
    nose: sel(basePosM, (x, y, z) => y > 0.680 && y < 0.700 && z > 0.135 && Math.abs(x) < 0.03),
    // bizygomatic band below the eyes (head breadth for faceLW)
    zyg: sel(basePosM, (x, y, z) => y > 0.700 && y < 0.722 && z > 0.05 && z < 0.13 && Math.abs(x) < 0.075),
    ear: earSet(basePosM),
    // skull surface just in front of / above the ear root (reference for earOut)
    skullAtEar: sel(basePosM, (x, y, z) => Math.abs(x) < 0.0715 && Math.abs(x) > 0.04 && y > 0.70 && y < 0.73 && z > 0 && z < 0.03),
  };
}

/**
 * Face metrics of one player.
 * @param {(i:number)=>number[]} P player position of a vertex (metres) in the index space of `sets` / `lm`
 * @param {ReturnType<typeof metricSets>} sets vertex sets (base.obj indices, or kept indices from the header)
 * @param {Record<string, number>} [lm] landmark → index in the same space (default: base.obj indices)
 * @returns {{faceLW:number, chinProj:number, earOut:number, fissH:number, lipsH:number, noseIcd:number}} (mm where noted)
 */
export function faceMetrics(P, sets, lm = LANDMARK_OBJ) {
  const mxAbsX = (set) => { let m = 0; for (const o of set) m = Math.max(m, Math.abs(P(o)[0])); return m; };
  const N = P(lm.N), ME = P(lm.ME), SN = P(lm.SN), PG = P(lm.PG);
  const faceH = N[1] - ME[1], bizyg = 2 * mxAbsX(sets.zyg);
  const icd = 2 * Math.abs(P(lm.EN_l)[0]);
  return {
    faceLW: faceH / bizyg,
    chinProj: (PG[2] - SN[2]) * 1000,
    earOut: (mxAbsX(sets.ear) - mxAbsX(sets.skullAtEar)) * 1000,
    fissH: (P(lm.PS_l)[1] - P(lm.PI_l)[1]) * 1000,
    lipsH: (P(lm.LS)[1] - P(lm.LI)[1]) * 1000,
    noseIcd: 2 * mxAbsX(sets.nose) / icd,
  };
}

const INF = Infinity;
/** Target bands [lo, hi] (inclusive) per metric and player (SPEC-v2 §10.2). headH uses meta.calibration ± 0.4 cm. */
export const LIKENESS_BANDS = Object.freeze({
  faceLW: { kobe: [0.80, 0.84], jordan: [0.80, 0.83], lebron: [0.74, 0.78], giannis: [0.86, 0.92], yao: [0.86, 0.92], kyrie: [0.78, 0.82] },
  chinProj: { kobe: [1.0, INF], jordan: [-5, -2], lebron: [-5, -2], giannis: [-4, -1], yao: [-5, -2], kyrie: [-6, -3] },
  earOut: { kobe: [13, 17], jordan: [27, INF], lebron: [-INF, 9], giannis: [20, 24], yao: [23, 27], kyrie: [-INF, 11] },
  fissH: { kobe: [6.0, 6.6], jordan: [5.8, 6.4], lebron: [6.0, 6.6], giannis: [6.4, 7.2], yao: [-INF, 6.0], kyrie: [6.0, 6.6] },
  lipsH: { kobe: [26, 28], jordan: [28, 30], lebron: [29, 31], giannis: [29, 32], yao: [25, 27], kyrie: [28, 30] },
});
export const HEADH_TOL_CM = 0.4;

/** Ordering rules (§10.2 last column). Each returns null when satisfied, else a message. */
export const LIKENESS_ORDER = Object.freeze([
  ['faceLW', 'LeBron lowest', (m) => minIs(m, 'faceLW', ['lebron'])],
  ['faceLW', 'Giannis, Yao highest', (m) => maxAre(m, 'faceLW', ['giannis', 'yao'])],
  ['chinProj', 'Kobe max by >= 3 mm', (m) => maxBy(m, 'chinProj', 'kobe', 3)],
  ['earOut', 'Jordan max', (m) => maxAre(m, 'earOut', ['jordan'])],
  ['earOut', 'LeBron, Kyrie min', (m) => minIs(m, 'earOut', ['lebron', 'kyrie'])],
  ['fissH', 'Yao min', (m) => minIs(m, 'fissH', ['yao'])],
  ['lipsH', 'Yao min', (m) => minIs(m, 'lipsH', ['yao'])],
  ['noseIcd', 'Jordan, LeBron widest', (m) => maxAre(m, 'noseIcd', ['jordan', 'lebron'])],
]);

function minIs(m, k, ids) {
  const others = Object.keys(m).filter((id) => !ids.includes(id));
  for (const id of ids) for (const o of others) if (!(m[id][k] < m[o][k])) return `${id} ${m[id][k].toFixed(2)} !< ${o} ${m[o][k].toFixed(2)}`;
  return null;
}
function maxAre(m, k, ids) {
  const others = Object.keys(m).filter((id) => !ids.includes(id));
  for (const id of ids) for (const o of others) if (!(m[id][k] > m[o][k])) return `${id} ${m[id][k].toFixed(2)} !> ${o} ${m[o][k].toFixed(2)}`;
  return null;
}
function maxBy(m, k, id, by) {
  for (const o of Object.keys(m)) if (o !== id && !(m[id][k] >= m[o][k] + by)) return `${id} ${m[id][k].toFixed(2)} !>= ${o} ${m[o][k].toFixed(2)} + ${by}`;
  return null;
}

/**
 * Checks all bands and orderings. `metrics` = {id: {faceLW, …, headH (m), headHTarget (m)}}.
 * @returns {string[]} misses (empty = pass)
 */
export function checkLikeness(metrics) {
  const miss = [];
  for (const [k, per] of Object.entries(LIKENESS_BANDS)) {
    for (const [id, [lo, hi]] of Object.entries(per)) {
      const v = metrics[id] && metrics[id][k];
      if (v == null) continue;
      if (v < lo || v > hi) miss.push(`${id}.${k} ${v.toFixed(2)} outside [${lo}, ${hi}]`);
    }
  }
  for (const [id, m] of Object.entries(metrics)) {
    if (m.headHTarget == null) continue;
    if (Math.abs(m.headH - m.headHTarget) * 100 > HEADH_TOL_CM) miss.push(`${id}.headH ${(m.headH * 100).toFixed(1)} cm vs target ${(m.headHTarget * 100).toFixed(1)} ± ${HEADH_TOL_CM}`);
  }
  const ids = Object.keys(metrics);
  if (['kobe', 'jordan', 'lebron', 'giannis', 'yao', 'kyrie'].every((id) => ids.includes(id))) {
    for (const [k, label, fn] of LIKENESS_ORDER) { const r = fn(metrics); if (r) miss.push(`order ${k} (${label}): ${r}`); }
  }
  return miss;
}
