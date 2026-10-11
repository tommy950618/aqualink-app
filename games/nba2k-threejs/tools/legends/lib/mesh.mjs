// OBJ parsing (as data), rig joint evaluation and skin weights for the MakeHuman hm08 base mesh.
import fs from 'node:fs';

// Parses the hm08 base.obj: returns positions (Float64, OBJ units = decimetres, y up, face toward +z),
// uvs (Float64 pairs), and faces [{g: groupName, v: [i..], t: [i..]}] with 0-based indices.
export function parseObj(file) {
  const txt = fs.readFileSync(file, 'latin1');
  const pos = [], uv = [], faces = [];
  let group = '';
  for (const line of txt.split('\n')) {
    if (line.startsWith('v ')) { const p = line.split(/\s+/); pos.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('vt ')) { const p = line.split(/\s+/); uv.push(+p[1], +p[2]); }
    else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ')) {
      const parts = line.trim().split(/\s+/).slice(1);
      const v = [], t = [];
      for (const q of parts) { const [a, b] = q.split('/'); v.push(parseInt(a, 10) - 1); t.push(b ? parseInt(b, 10) - 1 : -1); }
      faces.push({ g: group, v, t });
    }
  }
  return { pos: Float64Array.from(pos), uv: Float64Array.from(uv), faces };
}

// basemesh_vertex_groups.json stores groups as inclusive [start, end] ranges.
export function groupIndices(groups, name) {
  const r = groups[name];
  if (!r) throw new Error(`no vertex group ${name}`);
  const out = [];
  for (const [a, b] of r) for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export function meanOf(pos, idx) {
  let x = 0, y = 0, z = 0;
  for (const i of idx) { x += pos[i * 3]; y += pos[i * 3 + 1]; z += pos[i * 3 + 2]; }
  const n = idx.length || 1;
  return [x / n, y / n, z / n];
}

// Rig strategies (rig.<name>.json head/tail): CUBE = mean of the 8 vertices of the named joint cube,
// MEAN = mean of vertex_indices, VERTEX = one vertex_index. Positions are evaluated on the morphed mesh,
// so joints follow every macro/detail target. Unknown strategies fall back to default_position
// (Blender coords, metres: x, -z_obj, y_obj).
export function evalJoint(spec, pos, groups, unit = 0.1) {
  switch (spec.strategy) {
    case 'CUBE': return meanOf(pos, groupIndices(groups, spec.cube_name));
    case 'MEAN': return meanOf(pos, spec.vertex_indices);
    case 'VERTEX': return meanOf(pos, [spec.vertex_index]);
    default: {
      const d = spec.default_position;
      return [d[0] / unit, d[2] / unit, -d[1] / unit];
    }
  }
}

// Topologically sorted bone list from the rig JSON (parents before children).
export function sortBones(rig) {
  const names = Object.keys(rig);
  const out = [], seen = new Set();
  const visit = (n) => {
    if (seen.has(n)) return;
    const p = rig[n].parent;
    if (p && rig[p]) visit(p);
    seen.add(n); out.push(n);
  };
  for (const n of names.sort()) visit(n);
  return out;
}

// Per-vertex top-4 influences from weights.<rig>.json ({weights: {bone: [[vertex, w], ...]}}).
// Returns {idx: Uint8Array(n*4), w: Float32Array(n*4)} for the requested vertex list (OBJ indices),
// normalised to sum 1. Vertices without any weight inherit `fallbackBone`.
export function skinWeights(weightsJson, boneOrder, objIndices, fallbackBone) {
  const boneIdx = new Map(boneOrder.map((b, i) => [b, i]));
  const per = new Map();
  for (const [bone, list] of Object.entries(weightsJson.weights)) {
    const bi = boneIdx.get(bone);
    if (bi == null) continue;
    for (const [v, w] of list) {
      if (!(w > 0)) continue;
      let a = per.get(v); if (!a) per.set(v, a = []);
      a.push([bi, w]);
    }
  }
  const n = objIndices.length;
  const idx = new Uint8Array(n * 4), wts = new Float32Array(n * 4);
  let unweighted = 0, truncated = 0;
  for (let k = 0; k < n; k++) {
    let a = per.get(objIndices[k]);
    if (!a || !a.length) { a = [[boneIdx.get(fallbackBone), 1]]; unweighted++; }
    a = a.slice().sort((p, q) => q[1] - p[1]);
    if (a.length > 4) truncated++;
    a = a.slice(0, 4);
    const s = a.reduce((t, e) => t + e[1], 0);
    for (let j = 0; j < 4; j++) {
      idx[k * 4 + j] = a[j] ? a[j][0] : 0;
      wts[k * 4 + j] = a[j] ? a[j][1] / s : 0;
    }
  }
  return { idx, w: wts, unweighted, truncated };
}

// Quantises normalised weights to Uint8 so each vertex sums to exactly 255.
export function quantiseWeights(w) {
  const out = new Uint8Array(w.length);
  for (let k = 0; k < w.length; k += 4) {
    let s = 0, big = k;
    for (let j = 0; j < 4; j++) { out[k + j] = Math.round(w[k + j] * 255); s += out[k + j]; if (w[k + j] > w[big]) big = k + j; }
    out[big] += 255 - s;
  }
  return out;
}

// Area-weighted smooth normals over triangles (indices into pos).
export function computeNormals(pos, tris, n) {
  const nr = new Float64Array(n * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
    const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) { nr[v * 3] += nx; nr[v * 3 + 1] += ny; nr[v * 3 + 2] += nz; }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2]) || 1;
    nr[i * 3] /= l; nr[i * 3 + 1] /= l; nr[i * 3 + 2] /= l;
  }
  return nr;
}

// Octahedral normal encoding to two signed bytes.
export function octEncode(nr) {
  const n = nr.length / 3, out = new Int8Array(n * 2);
  for (let i = 0; i < n; i++) {
    let x = nr[i * 3], y = nr[i * 3 + 1], z = nr[i * 3 + 2];
    const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
    x /= l1; y /= l1; z /= l1;
    if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1); y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1); }
    out[i * 2] = Math.round(Math.max(-1, Math.min(1, x)) * 127);
    out[i * 2 + 1] = Math.round(Math.max(-1, Math.min(1, y)) * 127);
  }
  return out;
}
