// Clothing / hair shells derived from the shared body topology.
//
// A shell vertex is a point on the body surface, either a body vertex or a point on a body edge:
//     base = lerp(P[a], P[b], t),  n = normalize(lerp(N[a], N[b], t))
//     p    = base + n * shell.offset * offsetScale
// (t = 0 and a = b for interior vertices). Skin weights are the t-blend of a's and b's weights (top 4), so a
// shell deforms exactly like the skin underneath, and it fits every player because P/N are that player's.
//
// Regions are chosen ONCE on the unmorphed base.obj (metres, +y up, +z forward) by a signed region
// function f(v) (> 0 inside) built from skin weights and base-mesh landmarks. Body triangles are clipped at
// f = 0 (marching triangles), so cut lines (necklines, armholes, hairlines, hems) are smooth instead of
// following the quad grid. The result is identical for every player and lives in the shared binary.
//
// Stored per shell vertex: a, b (kept vertex indices), t (u8), uv (projection), offsetScale (0..4),
// edge (geodesic distance to the shell boundary, metres, clamped to 0.1).

// hm08 base.obj landmarks (metres), measured on the unmorphed mesh:
const L = {
  eyeY: 0.728, eyeZ: 0.125, browY: 0.752, noseTipY: 0.694, mouthY: 0.668, chinY: 0.64, underChinY: 0.616,
  headTopY: 0.849, headCZ: 0.057, headHalfW: 0.075, neckY: 0.589, clavY: 0.519,
  shoulderX: 0.168, shoulderY: 0.525, armpitY: 0.40, torsoCZ: 0.057,
  pelvisY: 0.073, kneeY: -0.369, ankleY: -0.745,
  ear: { y0: 0.686, y1: 0.742, z0: 0.026, z1: 0.068, x0: 0.066 },
};

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const AND = Math.min, OR = Math.max;

export const DEFAULT_SHELLS = [
  { name: 'jersey', kind: 'cloth', coverInset: 0.025, simplify: 0.5, offset: 0.007, material: 'jersey', uvMode: 'cylinder-torso' },
  { name: 'shorts', kind: 'cloth', coverInset: 0.02, simplify: 0.6, offset: 0.010, material: 'shorts', uvMode: 'cylinder-torso' },
  { name: 'socks', kind: 'cloth', coverInset: 0.015, simplify: 0.5, offset: 0.0025, material: 'socks', uvMode: 'cylinder-torso' },
  { name: 'shoes', kind: 'cloth', coverInset: 0.01, simplify: 0.2, maxError: 0.006, offset: 0.006, material: 'shoes', uvMode: 'cylinder-torso' },
  { name: 'headband', kind: 'cloth', offset: 0.008, material: 'headband', uvMode: 'sphere-head' },
  { name: 'hair', kind: 'hair', simplify: 0.7, offset: 0.0035, material: 'hair', uvMode: 'sphere-head' },
  { name: 'sleeve_r', kind: 'cloth', coverInset: 0.015, offset: 0.003, material: 'sleeve', uvMode: 'cylinder-torso' },
  { name: 'eyebrows', kind: 'hair', offset: 0.0015, material: 'eyebrows', uvMode: 'sphere-head' },
  { name: 'beard', kind: 'hair', simplify: 0.5, offset: 0.0025, material: 'beard', uvMode: 'sphere-head' },
];

// Each region: f(v) signed inside value (> 0 inside), g(v) offsetScale. v = {x, y, z, w(...bones)}.
export const REGIONS = {
  jersey: {
    f(v) {
      const ax = Math.abs(v.x);
      // coarse masks (far from the final edge): torso-ish vertices only
      const mask = AND(0.6 - v.w('upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'),
        0.9 - v.w('neck_01', 'head'), 0.7 - v.w('thigh_l', 'thigh_r'));
      if (mask <= 0) return -1;
      const hem = v.y - (L.pelvisY - 0.15);
      // round neck hole: ellipse in (x, y); deeper in front (6.5 cm below the collar bones) than at the back
      const front = smooth(L.torsoCZ - 0.03, L.torsoCZ + 0.04, v.z);
      const top = L.clavY + 0.06, bottom = L.clavY - 0.012 - 0.03 * front;
      const neck = Math.hypot(v.x / 0.078, (v.y - top) / (top - bottom)) - 1;
      // tank-top armholes: ellipse around the shoulder reaching 3 cm below the armpit; side wall cut
      const arm = Math.hypot((ax - (L.shoulderX + 0.035)) / 0.085, (v.y - (L.shoulderY - 0.005)) / 0.155) - 1;
      const side = 0.19 - ax;
      return AND(hem, neck * 0.08, arm * 0.08, side, (L.clavY + 0.07) - v.y);
    },
    // hangs loose below the chest (offset grows toward the hem), no extra offset at the straps
    g: (v) => 1 + 1.8 * smooth(L.armpitY - 0.05, L.pelvisY - 0.05, v.y),
    relax: { iterations: 12, strength: 0.5 },
  },
  shorts: {
    f(v) {
      const hip = v.w('pelvis', 'thigh_l', 'thigh_r', 'spine_01') - 0.45;
      const notCalf = 0.2 - v.w('calf_l', 'calf_r');
      const notHand = 0.05 - v.w('hand_l', 'hand_r', 'lowerarm_l', 'lowerarm_r');
      const waist = (L.pelvisY + 0.085) - v.y;
      const hem = v.y - (L.kneeY + 0.065);
      return AND(hip, notCalf, notHand, waist, hem);
    },
    g: (v) => 1 + 2.8 * smooth(L.pelvisY - 0.10, L.kneeY + 0.06, v.y),
    relax: { iterations: 60, strength: 0.7 },
  },
  socks: {
    f(v) { return AND(v.w('calf_l', 'calf_r', 'foot_l', 'foot_r', 'ball_l', 'ball_r') - 0.5, (L.ankleY + 0.13) - v.y, v.y - (L.ankleY - 0.01)); },
    g: () => 1,
  },
  shoes: {
    f(v) { return AND(v.w('foot_l', 'foot_r', 'ball_l', 'ball_r', 'calf_l', 'calf_r') - 0.5, (L.ankleY + 0.04) - v.y); },
    g: (v) => 1 + 2.0 * smooth(L.ankleY, L.ankleY - 0.06, v.y),
  },
  headband: {
    f(v) {
      const tilt = 0.12 * (L.headCZ + 0.06 - v.z);                   // band rides a little higher at the back
      const lo = L.browY + 0.026 + tilt, hi = L.browY + 0.056 + tilt;
      return AND(v.w('head') - 0.8, v.y - lo, hi - v.y);
    },
    g: () => 1,
  },
  hair: {
    f(v) {
      const dz = v.z - L.headCZ, phi = Math.abs(Math.atan2(v.x, dz));   // 0 = face, pi = back
      // hairline: forehead (+7 cm above the eyes), temples, above the ears, down to the nape
      const line = L.eyeY + 0.07 - 0.02 * smooth(0.45, 0.9, phi)
        - 0.095 * smooth(1.0, 1.3, phi)            // temples down into the sideburns (in front of the ear)
        + 0.06 * smooth(1.42, 1.62, phi)           // back up over the ear
        - 0.045 * smooth(1.9, 2.4, phi) - 0.05 * smooth(2.3, 2.8, phi);   // down to the nape
      // keep the ear bare: only vertices that stick out sideways past the skull, in the ear's y/z window
      const earGap = Math.abs(v.x) > 0.071
        ? OR(v.y - (L.ear.y1 + 0.004), (L.ear.y0 - 0.004) - v.y, v.z - (L.ear.z1 + 0.003), (L.ear.z0 - 0.01) - v.z)
        : 1;
      return AND(v.w('head') - 0.5, v.y - line, earGap);
    },
    g: () => 1,
  },
  // compression arm sleeve on the right (shooting) arm: mid upper arm to the wrist
  sleeve_r: {
    f(v) {
      const arm = v.w('upperarm_r', 'lowerarm_r') - 0.5;
      const notHand = 0.35 - v.w('hand_r');
      // stop half way up the upper arm (in A-pose the arm runs down and out, so use distance from the shoulder)
      const fromShoulder = Math.hypot(v.x + L.shoulderX, v.y - L.shoulderY, v.z - 0.015);
      return AND(arm, notHand, fromShoulder - 0.13);
    },
    g: () => 1,
  },
  eyebrows: {
    f(v) {
      const ax = Math.abs(v.x);
      if (v.z < L.eyeZ - 0.03) return -1;
      // arch over each eye: centre line rises toward the middle of the brow and drops at the tail
      const t = (ax - 0.012) / 0.05;                                   // 0 at the inner end, 1 at the tail
      const centre = L.eyeY + 0.021 + 0.006 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)) * 0.9) - 0.006 * Math.max(0, t - 0.7);
      const half = 0.0055 - 0.0025 * Math.max(0, t);
      return AND(half - Math.abs(v.y - centre), ax - 0.011, 0.064 - ax);
    },
    g: () => 1,
  },
  beard: {
    f(v) {
      const dz = v.z - L.headCZ, phi = Math.abs(Math.atan2(v.x, dz));
      // upper edge: under the nose at the centre, rising over the cheeks into the sideburns
      const top = L.noseTipY - 0.014 + 0.012 * smooth(0.2, 0.5, phi) + 0.03 * smooth(0.6, 1.1, phi) + 0.03 * smooth(1.2, 1.45, phi);
      // lower edge: under the jaw; at the front it follows the chin down onto the throat a little
      const bottom = L.underChinY - 0.03 * smooth(1.2, 0.3, phi) + 0.035 * smooth(1.2, 1.55, phi);
      const sides = 1.6 - phi;                                           // stop at the ears
      const lips = Math.hypot(v.x / 0.028, (v.y - (L.mouthY - 0.002)) / 0.0125) - 1;
      const lipsOut = OR(lips, (L.eyeZ + 0.005) - v.z);
      const throat = OR(v.y - (L.underChinY - 0.004), v.z - (L.headCZ + 0.035));
      return AND(v.w('head', 'neck_01') - 0.5, top - v.y, v.y - bottom, sides * 0.05, lipsOut * 0.02, throat);
    },
    g: () => 1,
  },
};

function uvFor(mode, x, y, z) {
  if (mode === 'sphere-head') {
    const dx = x, dy = y - (L.eyeY + 0.02), dz = z - L.headCZ;
    return [Math.atan2(dx, dz) / (2 * Math.PI) + 0.5, Math.atan2(dy, Math.hypot(dx, dz)) / Math.PI + 0.5];
  }
  // cylinder around the body axis (u = 0.5 front centre, 0/1 back centre); v spans ankle-0.1 .. head top
  return [Math.atan2(x, z - L.torsoCZ) / (2 * Math.PI) + 0.5, (y - (L.ankleY - 0.1)) / (L.headTopY - L.ankleY + 0.1)];
}

export function buildShells({ keptToObj, keptTris, triFaceGroup, basePos, skinIdx, skinW, boneOrder, defs, simplifier = null }) {
  const list = defs === 'default' || !defs ? DEFAULT_SHELLS : defs;
  const boneIdx = new Map(boneOrder.map((b, i) => [b, i]));
  const nKept = keptToObj.length;
  const P = (k, a) => basePos[keptToObj[k] * 3 + a];
  const out = [];
  for (let def of list) {
    const reg = REGIONS[def.region || def.name];
    if (!reg) throw new Error(`no shell region ${def.region || def.name}`);
    const fv = new Float64Array(nKept).fill(-1);
    for (let k = 0; k < nKept; k++) {
      if (keptToObj[k] > 13379) continue;                    // body vertices only
      const w = (...names) => { let s = 0; for (const n of names) { const b = boneIdx.get(n); for (let j = 0; j < 4; j++) if (skinIdx[k * 4 + j] === b) s += skinW[k * 4 + j]; } return s; };
      const f = reg.f({ x: P(k, 0), y: P(k, 1), z: P(k, 2), w });
      fv[k] = Math.abs(f) < 1e-7 ? 1e-7 : f;                  // never exactly 0: avoids degenerate slivers
    }
    // marching triangles
    const vkey = new Map(), verts = [];                      // verts: [a, b, t]
    const vid = (a, b, t) => {
      if (t <= 0 || a === b) { b = a; t = 0; }
      const key = a === b ? `${a}` : (a < b ? `${a}_${b}` : `${b}_${a}`);
      let i = vkey.get(key);
      if (i == null) { i = verts.length; vkey.set(key, i); verts.push(a < b || b === a ? [a, b, t] : [b, a, 1 - t]); }
      return i;
    };
    let tris = [];
    for (let t = 0; t < keptTris.length; t += 3) {
      if (triFaceGroup[t / 3] !== 'body') continue;
      const tri = [keptTris[t], keptTris[t + 1], keptTris[t + 2]];
      const ins = tri.map((k) => fv[k] > 0);
      if (!ins[0] && !ins[1] && !ins[2]) continue;
      const poly = [];
      for (let j = 0; j < 3; j++) {
        const a = tri[j], b = tri[(j + 1) % 3];
        if (fv[a] > 0) poly.push(vid(a, a, 0));
        if ((fv[a] > 0) !== (fv[b] > 0)) poly.push(vid(a, b, fv[a] / (fv[a] - fv[b])));
      }
      for (let j = 1; j + 1 < poly.length; j++) tris.push(poly[0], poly[j], poly[j + 1]);
    }
    tris = dropSmallIslands(tris, def.minIsland || 20);
    // body vertices hidden under this shell: interior body vertices at least coverInset (geodesic) from the
    // shell boundary. The loader drops body triangles whose 3 vertices are all covered by worn shells, which
    // removes skin poke-through (e.g. the hip crease under the shorts when the thigh flexes) and saves tris.
    const cover = [];
    if (def.coverInset > 0) {
      const used = [...new Set(tris)];
      const remapC = new Map(used.map((v, i) => [v, i]));
      const ptsC = used.map((i) => { const [a, b, t] = verts[i]; return [0, 1, 2].map((ax) => P(a, ax) * (1 - t) + P(b, ax) * t); });
      const distC = edgeDistance(tris.map((v) => remapC.get(v)), ptsC);
      used.forEach((vi, i) => { const [a, b, t] = verts[vi]; if (a === b && t === 0 && distC[i] >= def.coverInset) cover.push(a); });
      cover.sort((x, y) => x - y);
    }
    // optional decimation (meshoptimizer), borders locked so cut lines stay exactly where they are
    if (simplifier && def.simplify && def.simplify < 1) {
      const vp = new Float32Array(verts.length * 3);
      verts.forEach(([a, b, t], i) => { for (let ax = 0; ax < 3; ax++) vp[i * 3 + ax] = P(a, ax) * (1 - t) + P(b, ax) * t; });
      const before = tris.length / 3;
      const [simp] = simplifier.simplify(Uint32Array.from(tris), vp, 3, Math.floor(tris.length * def.simplify / 3) * 3, def.maxError ?? 0.004, ['LockBorder']);
      tris = Array.from(simp);
      def = { ...def, simplifiedFrom: before };
    }
    // compact
    const remap = new Map(), vlist = [];
    const local = tris.map((i) => { let r = remap.get(i); if (r == null) { r = vlist.length; remap.set(i, r); vlist.push(verts[i]); } return r; });
    const basePt = ([a, b, t]) => [0, 1, 2].map((ax) => P(a, ax) * (1 - t) + P(b, ax) * t);
    const uv = [], offsetScale = [], A = [], B = [], T = [], pts = [];
    for (const v of vlist) {
      const p = basePt(v);
      pts.push(p);
      const [u, vv] = uvFor(def.uvMode, p[0], p[1], p[2]);
      uv.push(u, vv);
      offsetScale.push(reg.g({ x: p[0], y: p[1], z: p[2] }));
      A.push(v[0]); B.push(v[1]); T.push(v[2]);
    }
    const edge = edgeDistance(local, pts);
    const attrs = { A, B, T, uv, offsetScale, edge };
    const dups = splitUvSeam(local, attrs);
    out.push({ ...def, cover, relax: def.relax || reg.relax || null, a: A, b: B, t: T, tris: local, uv, offsetScale, edge, vertexCount: A.length });
    console.log(`shell ${def.name}: ${A.length} vertices (${dups} uv-seam duplicates), ${local.length / 3} triangles${def.simplifiedFrom ? ` (simplified from ${def.simplifiedFrom})` : ''}, covers ${cover.length} body vertices`);
  }
  return out;
}

// Triangles straddling the u = 0/1 wrap of the cylindrical/spherical projection would smear the texture
// across the whole map: their low-u corners are duplicated with u + 1 (textures use RepeatWrapping).
function splitUvSeam(tris, attrs) {
  const dup = new Map();
  const u = attrs.uv;
  for (let t = 0; t < tris.length; t += 3) {
    const us = [0, 1, 2].map((j) => u[tris[t + j] * 2]);
    if (Math.max(...us) - Math.min(...us) <= 0.5) continue;
    for (let j = 0; j < 3; j++) {
      const i = tris[t + j];
      if (u[i * 2] >= 0.5) continue;
      let d = dup.get(i);
      if (d == null) {
        d = attrs.A.length; dup.set(i, d);
        for (const k of ['A', 'B', 'T', 'offsetScale', 'edge']) attrs[k].push(attrs[k][i]);
        attrs.uv.push(u[i * 2] + 1, u[i * 2 + 1]);
      }
      tris[t + j] = d;
    }
  }
  return dup.size;
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

// Dijkstra over mesh edges from boundary vertices (edges used by exactly one triangle).
function edgeDistance(tris, pts) {
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
