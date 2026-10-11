/**
 * shells.mjs — clothing, accessory and grooming shells derived from the body topology (SPEC-v2 §3.7–§3.8, §8.3).
 *
 * A shell vertex is a point on the body surface, a body vertex or a point on a body edge:
 *     base = lerp(P[a], P[b], t),  n = normalize(lerp(N[a], N[b], t)),  p = base + n · offset · offsetScale
 * (t = 0 and a = b for interior vertices). Skin weights are the t-blend of a's and b's (top 4), so a shell deforms
 * exactly like the skin underneath, and morph deltas propagate as lerp(Δa, Δb, t).
 *
 * Regions: a signed region function f(v) (> 0 inside, distance-like in metres) is evaluated on every body vertex
 * and body triangles are clipped at f = 0 (marching triangles), so cut lines are smooth instead of following the
 * quad grid. Shared shells (cloth, accessories, lashes) are cut once on base.obj; groom shells (hair, beard, brows)
 * are cut per player on that player's morphed mesh with the per-player face frame (groom.mjs), so hairlines and
 * beard lines are physical distances on each face.
 *
 * Per shell: a, b, t, uv (actual values; the bake stores them normalised with `uvRange`/`uvScale`),
 * offsetScale, edge (geodesic distance to the shell boundary), groom density + fade, cover list (body vertices
 * hidden under cloth), boundary loops (garment edges for trims), an 8-level perimeter table (metres per unit u),
 * and a LOD1 index (meshoptimizer `simplify` 0.4, LockBorder).
 */
import { hairFields, beardFields, browFields, baldFields, earInfo, smooth } from './groom.mjs';

/** hm08 base.obj landmarks (metres) measured on the unmorphed mesh (shared cloth regions). */
export const L = Object.freeze({
  eyeY: 0.728, eyeZ: 0.125, browY: 0.752, noseTipY: 0.694, mouthY: 0.668, chinY: 0.64, underChinY: 0.616,
  headTopY: 0.849, headCZ: 0.057, headHalfW: 0.075, neckY: 0.589, clavY: 0.519, Gy: 0.756,
  shoulderX: 0.168, shoulderY: 0.525, armpitY: 0.40, torsoCZ: 0.057,
  pelvisY: 0.073, kneeY: -0.369, ankleY: -0.745,
});

const AND = Math.min;
/** LeBron's high headband: bottom / top edge above the glabella at the front (base metres). */
const HB_LO = 0.024, HB_HI = 0.058;

/** Sock shell heights above the ankle landmark (base metres). */
// likeness round 4: crew 0.13 → 0.17 (LeBron / Yao / Kyrie showed only ≈ 4 cm of sock above the shoe), mid 0.19 → 0.23
// (Giannis ≈ 20 cm above the malleolus), high 0.27 → 0.22 (Kobe's socks reached the knee; the profile asks mid-calf)
export const SOCK_HEIGHTS = Object.freeze({ socks_low: 0.09, socks_crew: 0.17, socks_mid: 0.23, socks_high: 0.22 });
/** Shoe collar heights above the floor (player metres) per cut; covers remove body vertices below Hc − 0.012. */
export const SHOE_COLLAR = Object.freeze({ low: 0.085, lowmid: 0.100, midhigh: 0.125, high: 0.145 });

// ------------------------------------------------------------------------------------- shared cloth defs ----
const sockRegion = (h) => ({
  f(v) { return AND((v.w('calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r') - 0.5) * 0.05, (L.ankleY + h) - v.y, v.y - (L.ankleY - 0.01)); },
  g: () => 1,
});
// +3 mm ankle-brace bulge (Kobe, Yao): offsetScale 1 + 3/2.5 within ±4 cm of the ankle, 1 cm soft edges
const braceScale = (v) => 1 + (0.003 / 0.0025) * (1 - smooth(0.03, 0.04, Math.abs(v.y - L.ankleY)));

/** Lash card densities (likeness round 2: 0.9 on both cards read as mascara on the six male faces). */
export const LASH_DENSITY = Object.freeze({ upper: 0.5, lower: 0.15 });

/** Shared shell definitions (base mesh). `uv` selects the UV mode, `players` who wears it by default. */
export const SHARED_SHELLS = [
  { name: 'jersey', kind: 'cloth', material: 'kit', offset: 0.007, coverInset: 0.015, simplify: 0.55, maxError: 0.003, uv: { mode: 'torso-ellipse', y0: 0.103, y1: 0.599 },
    relax: { iterations: 24, strength: 0.5, pinBelowY: L.pelvisY + 0.10 } },
  { name: 'shorts', kind: 'cloth', material: 'kit', offset: 0.010, coverInset: 0.02, simplify: 0.6, maxError: 0.004, uv: { mode: 'torso-ellipse', y0: -0.314, y1: 0.168 },
    relax: { iterations: 60, strength: 0.7 } },
  ...Object.entries(SOCK_HEIGHTS).map(([name, h]) => ({ name, kind: 'cloth', material: 'kit', offset: 0.0025, coverInset: 0.008, simplify: 0.8, maxError: 0.0008, region: 'socks', h, uv: { mode: 'limb', chains: { l: ['calf_l', 'foot_l'], r: ['calf_r', 'foot_r'] } } })),
  { name: 'socks_high_brace', base: 'socks_high', kind: 'cloth', material: 'kit', offset: 0.0025, coverInset: 0.008, simplify: 0.8, maxError: 0.0008, region: 'socks', h: SOCK_HEIGHTS.socks_high, brace: true, players: ['kobe'], uv: { mode: 'limb', chains: { l: ['calf_l', 'foot_l'], r: ['calf_r', 'foot_r'] } } },
  { name: 'socks_crew_brace', base: 'socks_crew', kind: 'cloth', material: 'kit', offset: 0.0025, coverInset: 0.008, simplify: 0.8, maxError: 0.0008, region: 'socks', h: SOCK_HEIGHTS.socks_crew, brace: true, players: ['yao'], uv: { mode: 'limb', chains: { l: ['calf_l', 'foot_l'], r: ['calf_r', 'foot_r'] } } },
  { name: 'sleeve_r', kind: 'cloth', material: 'kit', offset: 0.003, coverInset: 0.015, simplify: 0.6, players: ['kobe'], uv: { mode: 'limb', chains: { r: ['upperarm_r', 'lowerarm_r', 'hand_r'] } } },
  { name: 'tape_r_im', kind: 'cloth', material: 'kit', offset: 0.0008, coverInset: 0.003, simplify: 0.3, maxError: 0.05, minIsland: 4, players: ['kobe'], uv: { mode: 'limb', chains: { r: ['hand_r', 'middle_01_r', 'middle_02_r', 'middle_03_r'] } } },
  { name: 'wristband_l', kind: 'cloth', material: 'kit', offset: 0.004, coverInset: 0.01, players: ['jordan'], uv: { mode: 'limb', chains: { l: ['lowerarm_l', 'hand_l'] } } },
  { name: 'headband_high', kind: 'cloth', material: 'kit', offset: 0.005, coverInset: 0.008, players: ['lebron'], uv: { mode: 'torso-ellipse', y0: L.Gy - 0.016, y1: L.Gy + 0.082 } },
  { name: 'headband_low', kind: 'cloth', material: 'kit', offset: 0.005, coverInset: 0.008, players: [], uv: { mode: 'torso-ellipse', y0: L.Gy + 0.006, y1: L.Gy + 0.058 } },
];

/** Region functions of the shared shells (v on base.obj, metres). */
export const REGIONS = {
  jersey: {
    f(v) {
      const ax = Math.abs(v.x);
      const mask = AND(0.6 - v.w('upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'),
        0.9 - v.w('neck_01', 'head'), 0.7 - v.w('thigh_l', 'thigh_r'));
      if (mask <= 0) return -1;
      // tucked hem (CRITIC C33): pelvisY + 0.03, 5.5 cm inside the shorts (shorts top pelvisY + 0.085)
      const hem = v.y - (L.pelvisY + 0.03);
      // round neck hole: ellipse in (x, y); deeper in front (6.5 cm below the collar bones) than at the back
      const front = smooth(L.torsoCZ - 0.03, L.torsoCZ + 0.04, v.z);
      const top = L.clavY + 0.06, bottom = L.clavY - 0.012 - 0.03 * front;
      const neck = Math.hypot(v.x / 0.078, (v.y - top) / (top - bottom)) - 1;
      // tank-top armholes: ellipse around the shoulder reaching 3 cm below the armpit; side wall cut
      const arm = Math.hypot((ax - (L.shoulderX + 0.035)) / 0.085, (v.y - (L.shoulderY - 0.005)) / 0.155) - 1;
      const side = 0.19 - ax;
      return AND(hem, neck * 0.08, arm * 0.08, side, (L.clavY + 0.07) - v.y);
    },
    // offset multiplier (offset 7 mm): 1 at y ≤ pelvisY + 0.10, linear to 2 at pelvisY + 0.14 (≤ 14 mm blouse
    // over the waistband), then 1 + smooth(armpitY − 0.05 → pelvisY + 0.14) back to 1 at the chest
    g(v) {
      const y0 = L.pelvisY + 0.10, y1 = L.pelvisY + 0.14;
      if (v.y <= y0) return 1;
      if (v.y < y1) return 1 + (v.y - y0) / (y1 - y0);
      // likeness round 4: the chest keeps ≥ 1.45× (≈ 10 mm of air) instead of 1× (the 7 mm shell followed the pecs, abs
      // and navel like body paint)
      return 1.45 + 0.55 * smooth(L.armpitY - 0.05, y1, v.y);
    },
  },
  shorts: {
    f(v) {
      const hip = v.w('pelvis', 'thigh_l', 'thigh_r', 'spine_01') - 0.45;
      // (no calf-weight term: its contour above the hem plane made the leg openings ragged; the hem plane at
      // kneeY + 0.065 already stays clear of the calf)
      const notHand = 0.05 - v.w('hand_l', 'hand_r', 'lowerarm_l', 'lowerarm_r');
      const waist = (L.pelvisY + 0.085) - v.y;
      // likeness round 4: hem kneeY + 0.065 → + 0.035 (every judge asked for longer, knee-length shorts: the hem sat
      // 7–12 cm above the kneecap)
      const hem = v.y - (L.kneeY + 0.035);
      return AND(hip * 0.05, notHand * 0.05, waist, hem);
    },
    g: (v) => 1 + 2.8 * smooth(L.pelvisY - 0.10, L.kneeY + 0.03, v.y),
  },
  socks: null,   // sockRegion(h) per definition
  sleeve_r: {
    f(v) {
      const arm = v.w('upperarm_r', 'lowerarm_r') - 0.5;
      const notHand = 0.35 - v.w('hand_r');
      // from 13 cm below the shoulder joint (distance from the joint, the arm hangs down-out in the A-pose)
      const fromShoulder = Math.hypot(v.x + L.shoulderX, v.y - L.shoulderY, v.z - 0.015);
      return AND(arm * 0.05, notHand * 0.05, fromShoulder - 0.13);
    },
    g: () => 1,
  },
  tape_r_im: {
    f(v) { return (v.w('index_01_r', 'index_02_r', 'middle_01_r', 'middle_02_r') - 0.55) * 0.02; },
    g: () => 1,
  },
  wristband_l: {
    // 3.4–11.0 cm below the elbow joint along the forearm (base), lowerarm_l weight > 0.5
    f(v, ctx) {
      const e = ctx.joints.lowerarm_l.head, w = ctx.joints.lowerarm_l.tail;
      const ax = [w[0] - e[0], w[1] - e[1], w[2] - e[2]], len = Math.hypot(...ax);
      const s = ((v.x - e[0]) * ax[0] + (v.y - e[1]) * ax[1] + (v.z - e[2]) * ax[2]) / len;
      return AND((v.w('lowerarm_l') - 0.5) * 0.05, s - 0.034, 0.110 - s);
    },
    g: () => 1,
  },
  headband_high: {
    // Gy + 0.034 … + 0.076 at the front (≈ 4.2 cm, high on the forehead), dropping 4 cm toward the back so it dips
    // under the occipital bulge (likeness round 3: with a 1.5 cm drop the band still covered the crown from the side
    // and read as a flat-top haircut / wedge; now the buzz-covered dome shows above it from the side, back and 3/4).
    // Round 4: the band stays level across the forehead and both temples (φ < 0.40π) and the whole drop happens behind
    // the ears (smooth 0.40π → 0.85π); the (1 − cos φ)/2 tilt curved the bottom edge down at the temples like a hairline.
    // (smooth(0.40π, 0.85π, φ) is the shared groom.mjs smoothstep)
    // Polish round 1: Gy + 0.034 … 0.076 → Gy + 0.024 … 0.058 (HB_LO / HB_HI). The top edge at 82 % of the glabella →
    // vertex height left only ≈ 1.7 cm of foreshortened dome above the band, so from the front the band ran into the
    // silhouette and read as a flat-top cap; ≈ 3.5 cm of buzz now shows above it from the front (band 3.4 cm tall).
    f(v) {
      const phi = Math.atan2(Math.abs(v.x), v.z - L.headCZ);
      const tilt = -0.040 * smooth(0.40 * Math.PI, 0.85 * Math.PI, phi);
      return AND((v.w('head') - 0.8) * 0.05, v.y - (L.Gy + HB_LO + tilt), (L.Gy + HB_HI + tilt) - v.y);
    },
    // rolled terry edges: the offset tapers to 0.5 within 6 mm of the top and bottom edges (no brim ledge)
    g(v) {
      const phi = Math.atan2(Math.abs(v.x), v.z - L.headCZ);
      const tilt = -0.040 * smooth(0.40 * Math.PI, 0.85 * Math.PI, phi);
      const d = Math.min(v.y - (L.Gy + HB_LO + tilt), (L.Gy + HB_HI + tilt) - v.y);
      return 0.5 + 0.5 * smooth(0, 0.006, d);
    },
  },
  headband_low: {
    f(v) {
      const phi = Math.atan2(Math.abs(v.x), v.z - L.headCZ);
      const tilt = 0.005 * (1 - Math.cos(phi)) / 2;
      return AND((v.w('head') - 0.8) * 0.05, v.y - (L.Gy + 0.012 + tilt), (L.Gy + 0.048 + tilt) - v.y);
    },
    g: () => 1,
  },
};

// ------------------------------------------------------------------------------------------ marching ----
/**
 * Clips body triangles to the region f > 0.
 * @param {Float64Array} fv region value per kept vertex (-1 for non-body)
 * @param {Int32Array|number[]} bodyTris kept-space triangles of the body skin
 * @returns {{verts: number[][], tris: number[]}} verts = [a, b, t] (a < b or a == b)
 */
function cutRegion(fv, bodyTris) {
  const vkey = new Map(), verts = [];
  const vid = (a, b, t) => {
    if (t <= 0 || a === b) { b = a; t = 0; }
    if (t >= 1) { a = b; t = 0; }
    const key = a === b ? `${a}` : (a < b ? `${a}_${b}` : `${b}_${a}`);
    let i = vkey.get(key);
    if (i == null) { i = verts.length; vkey.set(key, i); verts.push(a === b || a < b ? [a, b, t] : [b, a, 1 - t]); }
    return i;
  };
  const tris = [];
  for (let t = 0; t < bodyTris.length; t += 3) {
    const tri = [bodyTris[t], bodyTris[t + 1], bodyTris[t + 2]];
    if (fv[tri[0]] <= 0 && fv[tri[1]] <= 0 && fv[tri[2]] <= 0) continue;
    const poly = [];
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3];
      if (fv[a] > 0) poly.push(vid(a, a, 0));
      if ((fv[a] > 0) !== (fv[b] > 0)) poly.push(vid(a, b, fv[a] / (fv[a] - fv[b])));
    }
    for (let j = 1; j + 1 < poly.length; j++) if (poly[0] !== poly[j] && poly[j] !== poly[j + 1] && poly[0] !== poly[j + 1]) tris.push(poly[0], poly[j], poly[j + 1]);
  }
  return { verts, tris };
}

function dropSmallIslands(tris, minTris) {
  const parent = new Map();
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const add = (a) => { if (!parent.has(a)) parent.set(a, a); };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (let t = 0; t < tris.length; t += 3) {
    for (let j = 0; j < 3; j++) add(tris[t + j]);
    union(tris[t], tris[t + 1]); union(tris[t], tris[t + 2]);
  }
  const count = new Map();
  for (let t = 0; t < tris.length; t += 3) { const r = find(tris[t]); count.set(r, (count.get(r) || 0) + 1); }
  const keep = [];
  for (let t = 0; t < tris.length; t += 3) if (count.get(find(tris[t])) >= minTris) keep.push(tris[t], tris[t + 1], tris[t + 2]);
  return keep;
}

/** Geodesic (mesh-edge Dijkstra) distance from the boundary edges (used by exactly one triangle), clamped 0.1 m. */
export function edgeDistance(tris, pts) {
  const n = pts.length;
  const edgeCount = new Map(), adj = Array.from({ length: n }, () => []);
  const key = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);
  for (let t = 0; t < tris.length; t += 3) for (let j = 0; j < 3; j++) {
    const a = tris[t + j], b = tris[t + (j + 1) % 3];
    const k = key(a, b);
    if (!edgeCount.has(k)) {
      const d = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1], pts[a][2] - pts[b][2]);
      adj[a].push([b, d]); adj[b].push([a, d]);
    }
    edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
  }
  const dist = new Float64Array(n).fill(Infinity);
  const heap = [];
  const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const [k, c] of edgeCount) if (c === 1) { const a = Math.floor(k / 1048576), b = k % 1048576; for (const v of [a, b]) if (dist[v] > 0) { dist[v] = 0; push(0, v); } }
  while (heap.length) {
    const [d, v] = pop();
    if (d > dist[v]) continue;
    for (const [u, w] of adj[v]) if (d + w < dist[u]) { dist[u] = d + w; push(d + w, u); }
  }
  return Array.from(dist, (d) => (Number.isFinite(d) ? Math.min(d, 0.1) : 0.1));
}

/** Douglas–Peucker simplification of a 2D polyline (keeps the end points; `tol` in the same units). */
function douglasPeucker(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, bd = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - ax - dx * t, py - ay - dy * t);
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Boundary loops of a triangle set (vertex chains, closed), longest first. */
function boundaryLoops(tris) {
  const cnt = new Map();
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  for (let t = 0; t < tris.length; t += 3) for (let j = 0; j < 3; j++) { const k = key(tris[t + j], tris[t + (j + 1) % 3]); cnt.set(k, (cnt.get(k) || 0) + 1); }
  const next = new Map();
  for (let t = 0; t < tris.length; t += 3) for (let j = 0; j < 3; j++) {
    const a = tris[t + j], b = tris[t + (j + 1) % 3];
    if (cnt.get(key(a, b)) === 1) next.set(a, b);    // oriented boundary edge a → b
  }
  const seen = new Set(), loops = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let v = start;
    while (v != null && !seen.has(v)) { seen.add(v); loop.push(v); v = next.get(v); }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops.sort((a, b) => b.length - a.length);
}

/**
 * Duplicates the low-u corners of triangles straddling the u wrap (period `per`) with u + per.
 * attrs: arrays per vertex (`uv` has 2 entries per vertex); every other array is copied.
 */
function splitUvSeam(tris, attrs, per) {
  const dup = new Map();
  const u = attrs.uv;
  for (let t = 0; t < tris.length; t += 3) {
    const us = [0, 1, 2].map((j) => u[tris[t + j] * 2]);
    if (Math.max(...us) - Math.min(...us) <= per / 2) continue;
    for (let j = 0; j < 3; j++) {
      const i = tris[t + j];
      if (u[i * 2] >= Math.max(...us) - per / 2) continue;
      let d = dup.get(i);
      if (d == null) {
        d = attrs.A.length; dup.set(i, d);
        for (const [k, arr] of Object.entries(attrs)) if (k !== 'uv') arr.push(arr[i]);
        u.push(u[i * 2] + per, u[i * 2 + 1]);
      }
      tris[t + j] = d;
    }
  }
  return dup.size;
}

// ------------------------------------------------------------------------------------------- UV modes ----
const frac = (x) => x - Math.floor(x);

/** torso-ellipse (CHR §7.1): front centre u 0.75, back 0.25, right side 0.5, seam at the left side (u 0 ≡ 1). */
export function torsoEllipseU(x, z) {
  const th = Math.atan2(x / 0.135, (z - 0.065) / 0.095);
  return frac(th / (2 * Math.PI) + 0.75);
}

/** Limb-cylinder frame for one bone chain: per vertex the nearest segment, u = angle around it, v = arc length. */
function limbMapper(chain, joints) {
  const segs = [];
  let acc = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = joints[chain[i]].head, b = joints[chain[i + 1]].head;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d);
    const ax = d.map((c) => c / len);
    // reference "front" = +z projected off the axis (falls back to +x for a forward axis)
    let ref = [0, 0, 1];
    let dot = ref[0] * ax[0] + ref[1] * ax[1] + ref[2] * ax[2];
    if (Math.abs(dot) > 0.9) { ref = [1, 0, 0]; dot = ax[0]; }
    let r1 = [ref[0] - dot * ax[0], ref[1] - dot * ax[1], ref[2] - dot * ax[2]];
    const rl = Math.hypot(...r1); r1 = r1.map((c) => c / rl);
    const r2 = [ax[1] * r1[2] - ax[2] * r1[1], ax[2] * r1[0] - ax[0] * r1[2], ax[0] * r1[1] - ax[1] * r1[0]];
    segs.push({ a, ax, len, r1, r2, s0: acc });
    acc += len;
  }
  return (p) => {
    let best = null, bd = Infinity, bs = 0;
    for (const s of segs) {
      const q = [p[0] - s.a[0], p[1] - s.a[1], p[2] - s.a[2]];
      const tt = Math.max(-0.5 * s.len, Math.min(1.5 * s.len, q[0] * s.ax[0] + q[1] * s.ax[1] + q[2] * s.ax[2]));
      const c = Math.max(0, Math.min(s.len, tt));
      const d = Math.hypot(q[0] - s.ax[0] * c, q[1] - s.ax[1] * c, q[2] - s.ax[2] * c);
      if (d < bd) { bd = d; best = s; bs = tt; }
    }
    const q = [p[0] - best.a[0], p[1] - best.a[1], p[2] - best.a[2]];
    const ang = Math.atan2(q[0] * best.r2[0] + q[1] * best.r2[1] + q[2] * best.r2[2], q[0] * best.r1[0] + q[1] * best.r1[1] + q[2] * best.r1[2]);
    return [frac(ang / (2 * Math.PI) + 0.75), best.s0 + bs];
  };
}

/** head-metric UV parameters of a player (CHR §4.3): Nu tiles around the head at ET, R_h at EC.y + 0.02. */
export function headMetric(f, pos, nKept, isHead) {
  const ETy = f.L.ET_l[1], yR = f.EC[1] + 0.02;
  let sumE = 0, nE = 0, sumR = 0, nR = 0;
  for (let k = 0; k < nKept; k++) {
    if (!isHead(k)) continue;
    const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
    const r = Math.hypot(x, z - f.headCZ);
    if (Math.abs(y - ETy) < 0.004) { sumE += r; nE++; }
    if (Math.abs(y - yR) < 0.004) { sumR += r; nR++; }
  }
  const circ = 2 * Math.PI * (sumE / Math.max(1, nE));
  const Nu = Math.max(1, Math.round(circ / 0.05));
  const Rh = sumR / Math.max(1, nR);
  return {
    Nu, Rh, circ,
    uv: (x, y, z) => {
      const phiS = Math.atan2(x, z - f.headCZ);
      const th = Math.atan2(y - (f.EC[1] + 0.02), Math.hypot(x, z - f.headCZ));
      return [(phiS / (2 * Math.PI)) * Nu, th * Rh / 0.05];
    },
  };
}

// ------------------------------------------------------------------------------------ shell assembly ----
/**
 * Builds one shell from a cut.
 * @param {object} def {name, kind, offset, uv{…}, simplify?, minIsland?, coverInset?}
 * @param {{verts, tris}} cut
 * @param {object} c context: P(k, axis), N(k, axis), simplifier, attr(v) → {offsetScale, density, fade},
 *                   uvOf(p, v) → [u, v], period (u wrap) or 0, isBodyVertexInterior
 */
function assemble(def, cut, c) {
  let tris = dropSmallIslands(cut.tris, def.minIsland ?? 20);
  const { verts } = cut;
  const basePt = ([a, b, t]) => [0, 1, 2].map((ax) => c.P(a, ax) * (1 - t) + c.P(b, ax) * t);
  const baseN = ([a, b, t]) => { const n = [0, 1, 2].map((ax) => c.N(a, ax) * (1 - t) + c.N(b, ax) * t); const l = Math.hypot(...n) || 1; return n.map((x) => x / l); };
  // cover: body vertices at least coverInset (geodesic) inside the shell boundary
  const cover = [];
  if (def.coverInset > 0) {
    const used = [...new Set(tris)];
    const remapC = new Map(used.map((v, i) => [v, i]));
    const distC = edgeDistance(tris.map((v) => remapC.get(v)), used.map((i) => basePt(verts[i])));
    used.forEach((vi, i) => { const [a, b, t] = verts[vi]; if (a === b && t === 0 && distC[i] >= def.coverInset) cover.push(a); });
    cover.sort((x, y) => x - y);
  }
  // optional decimation (cut lines locked). Shared shells are cut on base.obj but worn by six differently shaped
  // bodies: their decimation also weighs every player's position of each shell vertex (simplifyWithAttributes),
  // so no collapse may flatten a chord into one player's chest or calf (poke-through).
  const decimate = (list, vertCount, posOf, ratio, err) => {
    const vp = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount; i++) { const p = posOf(i, null); vp[i * 3] = p[0]; vp[i * 3 + 1] = p[1]; vp[i * 3 + 2] = p[2]; }
    const target = Math.max(3, Math.floor(list.length * ratio / 3) * 3);
    if (c.multiPos && c.multiPos.length) {
      const m = c.multiPos.length, attr = new Float32Array(vertCount * m * 3);
      for (let i = 0; i < vertCount; i++) for (let pj = 0; pj < m; pj++) { const p = posOf(i, pj); for (let a = 0; a < 3; a++) attr[(i * m + pj) * 3 + a] = p[a]; }
      return Array.from(c.simplifier.simplifyWithAttributes(Uint32Array.from(list), vp, 3, attr, m * 3, new Array(m * 3).fill(1), null, target, err, ['LockBorder'])[0]);
    }
    return Array.from(c.simplifier.simplify(Uint32Array.from(list), vp, 3, target, err, ['LockBorder'])[0]);
  };
  const lerpOn = (Pfn, [a, b, t]) => [0, 1, 2].map((ax) => Pfn(a, ax) * (1 - t) + Pfn(b, ax) * t);
  let simplifiedFrom = 0;
  if (c.simplifier && def.simplify && def.simplify < 1) {
    simplifiedFrom = tris.length / 3;
    tris = decimate(tris, verts.length, (i, pj) => (pj == null ? basePt(verts[i]) : lerpOn((k, ax) => c.multiPos[pj][k * 3 + ax], verts[i])), def.simplify, def.maxError ?? 0.004);
  }
  // compact
  const remap = new Map(), vlist = [];
  const local = tris.map((i) => { let r = remap.get(i); if (r == null) { r = vlist.length; remap.set(i, r); vlist.push(verts[i]); } return r; });
  const pts = vlist.map(basePt);
  const nrm = vlist.map(baseN);
  const A = [], B = [], T = [], uv = [], offsetScale = [], density = [], fade = [];
  for (let i = 0; i < vlist.length; i++) {
    const [a, b, t] = vlist[i];
    A.push(a); B.push(b); T.push(t);
    const p = pts[i], n = nrm[i];
    const v = { x: p[0], y: p[1], z: p[2], nx: n[0], ny: n[1], nz: n[2], w: (...names) => c.wLerp(a, b, t, names), ear: c.earLerp ? c.earLerp(a, b, t) : 0 };
    const [u, vv] = c.uvOf(p, v);
    uv.push(u, vv);
    const at = c.attr(v);
    offsetScale.push(at.offsetScale ?? 1);
    density.push(at.density ?? 1);
    fade.push(at.fade ?? 1);
  }
  const edge = edgeDistance(local, pts);
  // garment edge loops on the welded topology (before the UV seam split), with unwrapped UVs
  const loops = def.kind === 'cloth' ? boundaryLoops(local).map((loop) => {
    const out = [];
    let prevU = null;
    for (const i of [...loop, loop[0]]) {
      let u = uv[i * 2];
      if (prevU != null && c.period) while (u - prevU > c.period / 2) u -= c.period;
      if (prevU != null && c.period) while (prevU - u > c.period / 2) u += c.period;
      prevU = u;
      out.push([u, uv[i * 2 + 1]]);
    }
    const my = loop.reduce((s, i) => s + pts[i][1], 0) / loop.length;
    const simplified = douglasPeucker(out, 0.001);
    const mx = loop.reduce((s, i) => s + pts[i][0], 0) / loop.length;
    const max = loop.reduce((s, i) => s + Math.abs(pts[i][0]), 0) / loop.length;
    return { uv: simplified, meanY: my, meanX: mx, meanAbsX: max, n: loop.length };
  }) : [];
  // fade from the shell boundary for groom shells: smooth(0, fadeMm, edge) × analytic fade
  if (def.fadeMm != null) for (let i = 0; i < fade.length; i++) fade[i] *= def.fadeMm > 0 ? smooth(0, def.fadeMm / 1000, edge[i]) : 1;
  const attrs = { A, B, T, uv, offsetScale, density, fade, edge };
  const dups = c.period ? splitUvSeam(local, attrs, c.period) : 0;
  // LOD1 index (simplify 0.4, LockBorder) over the final vertices
  let lod1 = null;
  if (c.simplifier && local.length >= 30) {
    lod1 = decimate(local, A.length, (i, pj) => (pj == null ? basePt([A[i], B[i], T[i]]) : lerpOn((k, ax) => c.multiPos[pj][k * 3 + ax], [A[i], B[i], T[i]])), 0.4, 0.05);
  }
  return {
    name: def.name, kind: def.kind, material: def.material, offset: def.offset, players: def.players, def,
    a: A, b: B, t: T, uv, offsetScale, density, fade, edge, tris: local, cover, loops, lod1,
    vertexCount: A.length, dups, simplifiedFrom,
  };
}

/** Perimeter table: 8 iso-v levels, metres (on the build mesh) per unit u (cross-section length / u span). */
function perimeterTable(sh, P) {
  const pos = (i) => [0, 1, 2].map((ax) => P(sh.a[i], ax) * (1 - sh.t[i]) + P(sh.b[i], ax) * sh.t[i]);
  const V = (i) => sh.uv[i * 2 + 1], U = (i) => sh.uv[i * 2];
  let vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < sh.vertexCount; i++) { vMin = Math.min(vMin, V(i)); vMax = Math.max(vMax, V(i)); }
  const out = [];
  for (let l = 0; l < 8; l++) {
    const lv = vMin + (vMax - vMin) * (l + 0.5) / 8;
    let len = 0, du = 0;
    for (let t = 0; t < sh.tris.length; t += 3) {
      const ids = [sh.tris[t], sh.tris[t + 1], sh.tris[t + 2]];
      const hit = [];
      for (let j = 0; j < 3; j++) {
        const a = ids[j], b = ids[(j + 1) % 3];
        const va = V(a), vb = V(b);
        if ((va - lv) * (vb - lv) < 0) {
          const s = (lv - va) / (vb - va);
          const pa = pos(a), pb = pos(b);
          hit.push([pa.map((x, k) => x + (pb[k] - x) * s), U(a) + (U(b) - U(a)) * s]);
        }
      }
      if (hit.length === 2) { len += Math.hypot(hit[0][0][0] - hit[1][0][0], hit[0][0][1] - hit[1][0][1], hit[0][0][2] - hit[1][0][2]); du += Math.abs(hit[0][1] - hit[1][1]); }
    }
    out.push([+lv.toFixed(4), du > 1e-6 ? +(len / du).toFixed(4) : 0]);
  }
  return out;
}

/** Classifies the boundary loops of a cloth shell into trim kinds (§8.3). */
function classifyLoops(sh) {
  const loops = sh.loops;
  if (!loops.length) return [];
  const name = sh.name;
  const sideOf = (l) => (l.meanX > 0 ? 'l' : 'r');
  const out = [];
  if (name === 'jersey') {
    for (const l of loops) {
      const kind = l.meanY > L.clavY - 0.05 && l.meanAbsX < 0.08 ? 'neck' : l.meanAbsX > 0.1 ? `armhole_${sideOf(l)}` : 'hem';
      out.push({ kind, uv: l.uv });
    }
  } else if (name === 'shorts') {
    const top = Math.max(...loops.map((l) => l.meanY));
    for (const l of loops) out.push({ kind: l.meanY === top ? 'waist' : `leg_${sideOf(l)}`, uv: l.uv });
  } else if (name.startsWith('socks')) {
    const ys = loops.map((l) => l.meanY).sort((a, b) => a - b);
    const mid = (ys[0] + ys[ys.length - 1]) / 2;
    for (const l of loops) out.push({ kind: l.meanY > mid ? 'cuff' : 'foot', side: sideOf(l), uv: l.uv });
  } else if (name === 'sleeve_r') {
    const top = Math.max(...loops.map((l) => l.meanY));
    for (const l of loops) out.push({ kind: l.meanY === top ? 'cuff' : 'wrist', uv: l.uv });
  } else if (name.startsWith('headband')) {
    const top = Math.max(...loops.map((l) => l.meanY));
    for (const l of loops) out.push({ kind: l.meanY === top ? 'top' : 'bottom', uv: l.uv });
  } else {
    for (const l of loops) out.push({ kind: 'edge', uv: l.uv });
  }
  return out;
}

/**
 * Shared shells (cloth + accessories on base.obj, lashes from the helper cards).
 * @param {object} ctx {keptToObj, bodyTris, basePos (kept, metres), baseNrm, skinIdx, skinW, boneOrder, joints,
 *                      simplifier, lash: {kept:[…], tris:[…], eye:{l:{c}, r:{c}}, upper:Set}}
 */
export function buildSharedShells(ctx) {
  const { keptToObj, bodyTris, basePos, baseNrm, skinIdx, skinW, boneOrder, joints } = ctx;
  const nKept = keptToObj.length;
  const boneIdx = new Map(boneOrder.map((b, i) => [b, i]));
  const wK = (k, names) => { let s = 0; for (const n of names) { const bi = boneIdx.get(n); for (let j = 0; j < 4; j++) if (skinIdx[k * 4 + j] === bi) s += skinW[k * 4 + j]; } return s; };
  const P = (k, a) => basePos[k * 3 + a], N = (k, a) => baseNrm[k * 3 + a];
  const isBody = (k) => keptToObj[k] <= 13379;
  const out = [];
  for (const def of SHARED_SHELLS) {
    const reg = def.region === 'socks' ? sockRegion(def.h) : REGIONS[def.name];
    const fv = new Float64Array(nKept).fill(-1);
    for (let k = 0; k < nKept; k++) {
      if (!isBody(k)) continue;
      const f = reg.f({ x: P(k, 0), y: P(k, 1), z: P(k, 2), w: (...n) => wK(k, n) }, ctx);
      fv[k] = Math.abs(f) < 1e-9 ? 1e-9 : f;
    }
    const cut = cutRegion(fv, bodyTris);
    let uvOf, period = 1;
    if (def.uv.mode === 'torso-ellipse') {
      uvOf = (p) => [torsoEllipseU(p[0], p[2]), (p[1] - def.uv.y0) / (def.uv.y1 - def.uv.y0)];
    } else {
      const maps = Object.fromEntries(Object.entries(def.uv.chains).map(([s, ch]) => [s, limbMapper(ch, joints)]));
      uvOf = (p) => (maps[p[0] >= 0 ? 'l' : 'r'] || Object.values(maps)[0])(p);
    }
    const g = def.brace ? braceScale : reg.g;
    const sh = assemble(def, cut, {
      P, N, simplifier: ctx.simplifier, period, multiPos: ctx.playerPos,
      wLerp: (a, b, t, names) => wK(a, names) * (1 - t) + wK(b, names) * t,
      uvOf, attr: (v) => ({ offsetScale: g(v) }),
    });
    // limb shells: local v from the arc length range; torso shells already local
    if (def.uv.mode === 'limb') {
      let vMin = Infinity, vMax = -Infinity;
      for (let i = 0; i < sh.vertexCount; i++) { vMin = Math.min(vMin, sh.uv[i * 2 + 1]); vMax = Math.max(vMax, sh.uv[i * 2 + 1]); }
      for (let i = 0; i < sh.uv.length; i += 2) sh.uv[i + 1] = (sh.uv[i + 1] - vMin) / (vMax - vMin);
      for (const l of sh.loops) for (const q of l.uv) q[1] = (q[1] - vMin) / (vMax - vMin);
      sh.vRange = [+vMin.toFixed(5), +vMax.toFixed(5)];
      sh.vMetres = +(vMax - vMin).toFixed(5);
      // socks/sleeve: v = 0 at the distal end (ankle / wrist), 1 at the top
      if (def.name.startsWith('socks') || def.name === 'sleeve_r' || def.name === 'tape_r_im' || def.name === 'wristband_l') {
        for (let i = 0; i < sh.uv.length; i += 2) sh.uv[i + 1] = 1 - sh.uv[i + 1];
        for (const l of sh.loops) for (const q of l.uv) q[1] = 1 - q[1];
        sh.vFlipped = true;
      }
    } else {
      sh.vRange = [def.uv.y0, def.uv.y1];
      sh.vMetres = +(def.uv.y1 - def.uv.y0).toFixed(5);
    }
    sh.uvMode = def.uv.mode;
    sh.loops = classifyLoops(sh);
    sh.perimeter = perimeterTable(sh, P);
    sh.relax = def.relax ? { iterations: def.relax.iterations, strength: def.relax.strength, ...(def.relax.pinBelowY != null ? { pinBelowV: +((def.relax.pinBelowY - def.uv.y0) / (def.uv.y1 - def.uv.y0)).toFixed(4) } : {}) } : null;
    out.push(sh);
  }
  // lashes: the helper cards as a shell (a = b = card vertex, t = 0, offset 0), lash-local UV, groom family R
  {
    const lz = ctx.lash;
    const map = new Map(lz.kept.map((k, i) => [k, i]));
    const tris = lz.tris.map((k) => map.get(k));
    const A = lz.kept.slice(), uv = [];
    // per card (eye side × upper/lower): u = angle around the eye centre normalised over the card, v = radial
    // distance from the lid margin / card length × 0.04 (one strand spans a whole lash)
    const groups = {};
    for (const k of lz.kept) { const side = P(k, 0) >= 0 ? 'l' : 'r'; const key = side + (lz.upper.has(k) ? 'u' : 'd'); (groups[key] ||= []).push(k); }
    const uvByK = new Map();
    for (const [key, ks] of Object.entries(groups)) {
      const c = lz.eye[key[0]].c;
      const ang = (k) => Math.atan2(P(k, 1) - c[1], (P(k, 0) - c[0]) * (key[0] === 'l' ? 1 : -1));
      const rad = (k) => Math.hypot(P(k, 0) - c[0], P(k, 1) - c[1]);
      const a0 = Math.min(...ks.map(ang)), a1 = Math.max(...ks.map(ang));
      const r0 = Math.min(...ks.map(rad)), r1 = Math.max(...ks.map(rad));
      for (const k of ks) uvByK.set(k, [(ang(k) - a0) / (a1 - a0 || 1) * 0.6, (rad(k) - r0) / (r1 - r0 || 1) * 0.04]);
    }
    for (const k of A) uv.push(...uvByK.get(k));
    const sh = {
      name: 'lashes', kind: 'groom', material: 'groom', offset: 0, a: A, b: A.slice(), t: A.map(() => 0), uv,
      offsetScale: A.map(() => 1), density: A.map((k) => (lz.upper.has(k) ? LASH_DENSITY.upper : LASH_DENSITY.lower)), fade: A.map(() => 1), edge: A.map(() => 0.1),
      tris, cover: [], loops: [], lod1: null, vertexCount: A.length, uvMode: 'lash-local',
      groom: { family: [1, 0, 0], fadeMm: 0, part: 'lashes', layer: 'detail' },
    };
    out.push(sh);
  }
  return out;
}

/**
 * Per-player groom shells (hair inner/outer, beard inner/outer, brows) on the player's morphed kept mesh.
 * @param {object} ctx {keptToObj, bodyTris, pos, nrm, skinIdx, skinW, boneOrder, frame, appearance, earKept:Set,
 *                      earPts, simplifier}
 */
export function buildGroomShells(ctx) {
  const { keptToObj, bodyTris, pos, nrm, skinIdx, skinW, boneOrder, frame: f, appearance: ap, earKept } = ctx;
  const nKept = keptToObj.length;
  const boneIdx = new Map(boneOrder.map((b, i) => [b, i]));
  const wK = (k, names) => { let s = 0; for (const n of names) { const bi = boneIdx.get(n); for (let j = 0; j < 4; j++) if (skinIdx[k * 4 + j] === bi) s += skinW[k * 4 + j]; } return s; };
  const P = (k, a) => pos[k * 3 + a], N = (k, a) => nrm[k * 3 + a];
  const isBody = (k) => keptToObj[k] <= 13379;
  const vAt = (k) => ({ x: P(k, 0), y: P(k, 1), z: P(k, 2), nx: N(k, 0), ny: N(k, 1), nz: N(k, 2), w: (...n) => wK(k, n), ear: earKept.has(k) ? 1 : 0 });
  const hm = headMetric(f, pos, nKept, (k) => isBody(k) && wK(k, ['head']) > 0.5 && !earKept.has(k));
  const out = [];
  const make = (name, region, def, attr, uvOf, period) => {
    const fv = new Float64Array(nKept).fill(-1);
    for (let k = 0; k < nKept; k++) {
      if (!isBody(k)) continue;
      const v = vAt(k);
      if (v.y < f.L.ME[1] - 0.12) continue;                       // groom lives on the head and upper neck
      const r = region(v);
      fv[k] = Math.abs(r) < 1e-9 ? 1e-9 : r;
    }
    const cut = cutRegion(fv, bodyTris);
    if (!cut.tris.length) return null;
    const sh = assemble({ name, kind: 'groom', minIsland: def.minIsland ?? 6, simplify: def.simplify, fadeMm: def.fadeMm, offset: def.offset }, cut, {
      P, N, simplifier: ctx.simplifier, period,
      wLerp: (a, b, t, names) => wK(a, names) * (1 - t) + wK(b, names) * t,
      earLerp: (a, b, t) => (earKept.has(a) ? 1 - t : 0) + (earKept.has(b) ? t : 0),
      uvOf, attr,
    });
    sh.offset = def.offset;
    sh.material = 'groom';
    sh.uvMode = def.uvMode;
    sh.groom = { family: def.family, fadeMm: def.fadeMm, part: def.part, layer: def.layer };
    sh.Nu = def.uvMode === 'head-metric' ? hm.Nu : undefined;
    out.push(sh);
    return sh;
  };
  const famVec = (fam) => [fam.straight || 0, fam.coil || 0, fam.stipple || 0];
  const hmUv = (p) => hm.uv(p[0], p[1], p[2]);
  const hair = ap.hair, beard = ap.beard;
  const ear = earInfo(f, ctx.earPts);
  if (hair && hair.layers && hair.layers.length) {
    const hf = hairFields(f, hair, beard, ear);
    const inner = hair.layers[0];
    make('hair_inner', hf.region, { offset: inner.offsetMm / 1000, family: famVec(inner.family), fadeMm: inner.fadeMm, simplify: inner.simplify ?? 0.7, part: 'hair', layer: 'inner', uvMode: 'head-metric' },
      (v) => ({ density: hf.densityAt(v, inner.density, inner), offsetScale: 1, fade: 1 }), hmUv, hm.Nu);
    const outer = hair.layers[1];
    if (outer) {
      const inset = (outer.insetMm || 0) / 1000;
      make('hair_outer', (v) => hf.region(v) - inset, { offset: outer.offsetMm / 1000, family: famVec(outer.family || inner.family), fadeMm: outer.fadeMm, simplify: outer.simplify ?? 0.7, part: 'hair', layer: 'outer', uvMode: 'head-metric' },
        (v) => ({ density: hf.densityAt(v, outer.density, outer), offsetScale: hf.outerScale(v, outer), fade: 1 }), hmUv, hm.Nu);
    }
  }
  if (beard && beard.layers && beard.layers.length) {
    const bf = beardFields(f, beard);
    const inner = beard.layers[0];
    if (bf.shellComps.length) {
      make('beard_inner', bf.region, { offset: inner.offsetMm / 1000, family: famVec(inner.family), fadeMm: inner.fadeMm, simplify: inner.simplify ?? 0.75, part: 'beard', layer: 'inner', uvMode: 'head-metric', minIsland: 2 },
        (v) => ({ density: bf.density(v), offsetScale: 1, fade: 1 }), hmUv, hm.Nu);
      const outer = beard.layers[1];
      if (outer && bf.comps.F) {
        const inset = (outer.insetMm || 0) / 1000;
        make('beard_outer', (v) => bf.comps.F(v) - inset, { offset: outer.chinMm / 1000, family: famVec(outer.family || inner.family), fadeMm: outer.fadeMm, simplify: outer.simplify ?? 0.75, part: 'beard', layer: 'outer', uvMode: 'head-metric' },
          (v) => ({ density: outer.density, offsetScale: bf.offsetScale(v, outer), fade: 1 }), hmUv, hm.Nu);
      }
    }
  }
  if (ap.eyebrows) {
    const br = browFields(f, ap.eyebrows);
    make('brows', br.region, { offset: (ap.eyebrows.offsetMm ?? 1.0) / 1000, family: [1, 0, 0], fadeMm: 0, simplify: 1, part: 'brows', layer: 'inner', uvMode: 'brow-local', minIsland: 2 },
      (v) => ({ density: br.density(v), offsetScale: 1, fade: br.fade(v) }), (p) => br.uv(p[0], p[1]), 0);
  }
  return { shells: out, headMetric: { Nu: hm.Nu, Rh: +hm.Rh.toFixed(5), circumference: +hm.circ.toFixed(4) } };
}

/** shoeCover_<cut>: foot/ball/calf-weighted body vertices below the collar height − 0.012 (player metres). */
export function shoeCovers({ keptToObj, pos, skinIdx, skinW, boneOrder }) {
  const feet = new Set(['foot_l', 'foot_r', 'ball_l', 'ball_r', 'calf_l', 'calf_r'].map((b) => boneOrder.indexOf(b)));
  const out = {};
  for (const [cut, hc] of Object.entries(SHOE_COLLAR)) {
    const list = [];
    for (let k = 0; k < keptToObj.length; k++) {
      if (keptToObj[k] > 13379) continue;
      let w = 0;
      for (let j = 0; j < 4; j++) if (feet.has(skinIdx[k * 4 + j])) w += skinW[k * 4 + j];
      if (w > 0.5 && pos[k * 3 + 1] < hc - 0.012) list.push(k);
    }
    out[`shoeCover_${cut}`] = list;
  }
  return out;
}
