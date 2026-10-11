// Phase-A runtime loader prototype for the legends format VERSION 1 (PoC page test/scratch/legends-poc only;
// the game reads format v2 through src/legends/, see FORMAT.md).
//
//   import { loadLegends } from './loader-prototype.js';
//   const lib = await loadLegends('assets/poc.json');           // fetches header + shared bin
//   const p = await lib.createPlayer('tall', {                   // fetches that player's bin once
//     materials: { skin: mySkinMat, eye: myEyeMat },             // per-submesh materials (optional)
//     shells: { jersey: jerseyMat, shorts: shortsMat, hair: hairMat },  // shells to build + their materials
//   });
//   scene.add(p.object);              // THREE.Group (the player's root; move/rotate this in the world)
//   p.bones.upperarm_l.rotation.z = 1 // bones by name; rest pose has identity rotations (world-aligned axes)
//   p.resetPose();                    // back to the bind pose
//   createPlayer(id, { lod: 2 })      // body LOD (0 = full; header.lods lists the rest), shares all vertex data
//
// Rest pose: MakeHuman A-pose. Every bone's rest rotation is identity, so a bone's local axes are the
// character's axes (+x = character's left, +y up, +z forward); rotate about them directly. The bone's
// direction is p.boneAxis(name) (unit vector head -> tail) for twist rotations.
import * as THREE from '../../vendor/three.module.js';

const TYPE = { 'u8n*0.1m': Uint8Array, 'u16n*2': Uint16Array, u8: Uint8Array, u8n: Uint8Array, 'u8n*4': Uint8Array, u16: Uint16Array, u16n: Uint16Array, u16q: Uint16Array, oct8: Int8Array };

function view(buf, sec) {
  const T = TYPE[sec.type];
  if (!T) throw new Error(`unknown section type ${sec.type}`);
  return new T(buf, sec.offset, sec.count * sec.itemSize);
}

function octDecode(o, out) {
  for (let i = 0, n = o.length / 2; i < n; i++) {
    let x = o[i * 2] / 127, y = o[i * 2 + 1] / 127;
    let z = 1 - Math.abs(x) - Math.abs(y);
    if (z < 0) { const ox = x; x = (1 - Math.abs(y)) * Math.sign(ox || 1); y = (1 - Math.abs(ox)) * Math.sign(y || 1); }
    const l = Math.hypot(x, y, z) || 1;
    out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  return out;
}

async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

export async function loadLegends(headerUrl) {
  const base = new URL(headerUrl, location.href);
  const header = await (await fetch(base)).json();
  if (header.format !== 'legends-mesh' || header.version !== 1) throw new Error('unsupported legends format');
  const sharedBuf = await fetchBuf(new URL(header.shared.file, base));
  const S = header.shared.sections;
  const renderToKept = view(sharedBuf, S.renderToKept);
  const nRender = renderToKept.length;
  const nKept = header.counts.keptVertices;
  // Shared attributes: one GPU buffer each, reused by every player geometry.
  const uvAttr = new THREE.BufferAttribute(view(sharedBuf, S.uv), 2, true);
  const indexAttr = new THREE.BufferAttribute(view(sharedBuf, S.index), 1);
  const keptSkinIndex = view(sharedBuf, S.skinIndex), keptSkinWeight = view(sharedBuf, S.skinWeight);
  const skinIndex = new Uint8Array(nRender * 4), skinWeight = new Uint8Array(nRender * 4);
  for (let r = 0; r < nRender; r++) {
    const k = renderToKept[r];
    for (let j = 0; j < 4; j++) { skinIndex[r * 4 + j] = keptSkinIndex[k * 4 + j]; skinWeight[r * 4 + j] = keptSkinWeight[k * 4 + j]; }
  }
  const skinIndexAttr = new THREE.Uint8BufferAttribute(skinIndex, 4);
  const skinWeightAttr = new THREE.Uint8BufferAttribute(skinWeight, 4, true);
  const lodIndexAttrs = (header.lods || []).map((l) => new THREE.BufferAttribute(view(sharedBuf, l.section), 1));
  const shells = {};
  for (const sh of header.shells || []) {
    const A = view(sharedBuf, sh.sections.a), B = view(sharedBuf, sh.sections.b), T8 = view(sharedBuf, sh.sections.t);
    const n = A.length;
    const t = Float32Array.from(T8, (x) => x / 255);
    // skin: t-blend of the two source vertices' influences, top 4, renormalised
    const skI = new Uint8Array(n * 4), skW = new Float32Array(n * 4);
    const acc = new Map();
    for (let i = 0; i < n; i++) {
      acc.clear();
      for (const [k, w] of [[A[i], 1 - t[i]], [B[i], t[i]]]) {
        if (w <= 0) continue;
        for (let j = 0; j < 4; j++) { const bw = keptSkinWeight[k * 4 + j] / 255 * w; if (bw > 0) acc.set(keptSkinIndex[k * 4 + j], (acc.get(keptSkinIndex[k * 4 + j]) || 0) + bw); }
      }
      const top = [...acc].sort((p, q) => q[1] - p[1]).slice(0, 4);
      const sum = top.reduce((s2, e) => s2 + e[1], 0) || 1;
      top.forEach(([b, w], j) => { skI[i * 4 + j] = b; skW[i * 4 + j] = w / sum; });
    }
    const uv16 = view(sharedBuf, sh.sections.uv);
    shells[sh.name] = {
      info: sh, A, B, t, n,
      offsetScale: view(sharedBuf, sh.sections.offset),
      edge: view(sharedBuf, sh.sections.edge),
      cover: sh.sections.cover ? view(sharedBuf, sh.sections.cover) : null,
      uv: new THREE.BufferAttribute(Float32Array.from(uv16, (u) => u / 65535 * 2), 2),
      index: new THREE.BufferAttribute(view(sharedBuf, sh.sections.index), 1),
      skinIndex: new THREE.Uint8BufferAttribute(skI, 4), skinWeight: new THREE.BufferAttribute(skW, 4),
    };
  }
  const playerData = new Map();

  async function getPlayerData(id) {
    if (playerData.has(id)) return playerData.get(id);
    const info = header.players.find((p) => p.id === id);
    if (!info) throw new Error(`no player ${id}`);
    const buf = await fetchBuf(new URL(info.file, base));
    const q = view(buf, info.sections.position);
    const kept = new Float32Array(nKept * 3);
    for (let k = 0; k < nKept; k++) for (let a = 0; a < 3; a++) kept[k * 3 + a] = info.posMin[a] + q[k * 3 + a] * info.posStep[a];
    const keptN = octDecode(view(buf, info.sections.normal), new Float32Array(nKept * 3));
    const pos = new Float32Array(nRender * 3), nrm = new Float32Array(nRender * 3);
    for (let r = 0; r < nRender; r++) {
      const k = renderToKept[r];
      for (let a = 0; a < 3; a++) { pos[r * 3 + a] = kept[k * 3 + a]; nrm[r * 3 + a] = keptN[k * 3 + a]; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv', uvAttr);
    geo.setAttribute('skinIndex', skinIndexAttr);
    geo.setAttribute('skinWeight', skinWeightAttr);
    geo.setIndex(indexAttr);
    header.shared.groups.forEach((g, i) => geo.addGroup(g.start, g.count, i));
    geo.computeBoundingSphere();
    // LOD geometries share every attribute with LOD 0 and only swap the index buffer + groups.
    const lods = [geo];
    for (const lod of header.lods || []) {
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
      g.setIndex(lodIndexAttrs[lods.length - 1]);
      lod.groups.forEach((gr, i) => g.addGroup(gr.start, gr.count, i));
      g.boundingSphere = geo.boundingSphere;
      lods.push(g);
    }
    const d = { info, geo, lods, kept, keptN };
    playerData.set(id, d);
    return d;
  }

  // fade (metres): when set, adds an RGBA 'color' attribute whose alpha ramps 0 -> 1 over that distance from
  // the shell boundary (use with material.vertexColors = true + alphaTest for soft hairlines/beard edges).
  // The raw boundary distance is always available as the normalised 'edge' attribute (1.0 = 0.1 m).
  function shellGeometry(d, name, extraOffset = 0, fade = 0) {
    const sh = shells[name];
    if (!sh) throw new Error(`no shell ${name}`);
    const { n, A, B, t } = sh, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
    const off = sh.info.offset + extraOffset;
    const P = d.kept, N = d.keptN;
    for (let i = 0; i < n; i++) {
      const a = A[i] * 3, b = B[i] * 3, u = t[i], o = off * (sh.offsetScale[i] / 255 * 4);
      let nx = N[a] * (1 - u) + N[b] * u, ny = N[a + 1] * (1 - u) + N[b + 1] * u, nz = N[a + 2] * (1 - u) + N[b + 2] * u;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
      pos[i * 3] = P[a] * (1 - u) + P[b] * u + nx * o;
      pos[i * 3 + 1] = P[a + 1] * (1 - u) + P[b + 1] * u + ny * o;
      pos[i * 3 + 2] = P[a + 2] * (1 - u) + P[b + 2] * u + nz * o;
    }
    if (sh.info.relax) relaxShell(sh, pos, nrm, off);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', sh.uv);
    g.setAttribute('skinIndex', sh.skinIndex);
    g.setAttribute('skinWeight', sh.skinWeight);
    g.setAttribute('edge', new THREE.BufferAttribute(sh.edge, 1, true));
    if (fade > 0) {
      const col = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1; col[i * 4 + 3] = Math.min(1, sh.edge[i] / 255 * 0.1 / fade); }
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    }
    g.setIndex(sh.index);
    g.computeBoundingSphere();
    return g;
  }

  // Cloth relaxation: Laplacian smoothing that may only move a vertex OUTWARD from its minimum offset
  // (dot(p - base, n) >= offset). Concavities (buttock cleft, crotch, between the pecs) get bridged like real
  // fabric instead of being shrink-wrapped. Boundary vertices only smooth along the boundary.
  function relaxShell(sh, pos, nrm, off) {
    const { n } = sh;
    if (!sh.adj) {
      const weld = new Map(), wid = new Int32Array(n);
      for (let i = 0; i < n; i++) { const k = `${sh.A[i]}_${sh.B[i]}_${sh.t[i]}`; let w = weld.get(k); if (w == null) { w = weld.size; weld.set(k, w); } wid[i] = w; }
      const m = weld.size, sets = Array.from({ length: m }, () => new Set());
      const idx = sh.index.array;
      for (let t = 0; t < idx.length; t += 3) for (let j = 0; j < 3; j++) { const a = wid[idx[t + j]], b = wid[idx[t + (j + 1) % 3]]; sets[a].add(b); sets[b].add(a); }
      const boundary = new Uint8Array(m);
      for (let i = 0; i < n; i++) if (sh.edge[i] === 0) boundary[wid[i]] = 1;
      sh.adj = sets.map((st, i) => [...st].filter((j) => !boundary[i] || boundary[j]));
      sh.wid = wid; sh.wm = m;
    }
    const { adj, wid, wm } = sh;
    const P = new Float32Array(wm * 3), B = new Float32Array(wm * 3), N = new Float32Array(wm * 3), O = new Float32Array(wm);
    for (let i = 0; i < n; i++) {
      const w = wid[i], o = off * (sh.offsetScale[i] / 255 * 4);
      for (let a = 0; a < 3; a++) { P[w * 3 + a] = pos[i * 3 + a]; N[w * 3 + a] = nrm[i * 3 + a]; B[w * 3 + a] = pos[i * 3 + a] - nrm[i * 3 + a] * o; }
      O[w] = o;
    }
    const { iterations = 10, strength = 0.5 } = sh.info.relax;
    const Q = new Float32Array(wm * 3);
    for (let it = 0; it < iterations; it++) {
      for (let w = 0; w < wm; w++) {
        const nb = adj[w];
        if (!nb.length) { for (let a = 0; a < 3; a++) Q[w * 3 + a] = P[w * 3 + a]; continue; }
        let x = 0, y = 0, z = 0;
        for (const j of nb) { x += P[j * 3]; y += P[j * 3 + 1]; z += P[j * 3 + 2]; }
        x = P[w * 3] + (x / nb.length - P[w * 3]) * strength;
        y = P[w * 3 + 1] + (y / nb.length - P[w * 3 + 1]) * strength;
        z = P[w * 3 + 2] + (z / nb.length - P[w * 3 + 2]) * strength;
        const d = (x - B[w * 3]) * N[w * 3] + (y - B[w * 3 + 1]) * N[w * 3 + 1] + (z - B[w * 3 + 2]) * N[w * 3 + 2];
        if (d < O[w]) { const k = O[w] - d; x += N[w * 3] * k; y += N[w * 3 + 1] * k; z += N[w * 3 + 2] * k; }
        Q[w * 3] = x; Q[w * 3 + 1] = y; Q[w * 3 + 2] = z;
      }
      P.set(Q);
    }
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] = P[wid[i] * 3 + a];
  }

  // Body geometry variant without the triangles hidden by a set of shells (shares all attributes; cached per
  // player x LOD x shell set). Only the 'body' group is filtered.
  const coveredCache = new Map();
  function coveredGeometry(d, l, key, worn) {
    const ck = `${d.info.id}|${l}|${key}`;
    if (coveredCache.has(ck)) return coveredCache.get(ck);
    const covered = new Uint8Array(nKept);
    for (const n of worn) for (const k of shells[n].cover) covered[k] = 1;
    const src = d.lods[l];
    const idx = src.index.array, out = [];
    const groups = src.groups.map((g) => ({ ...g }));
    let removedBefore = 0;
    const g0 = groups[0];                                 // body group is always first
    for (let i = 0; i < idx.length; i += 3) {
      const inBody = i >= g0.start && i < g0.start + g0.count;
      if (inBody && covered[renderToKept[idx[i]]] && covered[renderToKept[idx[i + 1]]] && covered[renderToKept[idx[i + 2]]]) { removedBefore += 3; continue; }
      out.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    g0.count -= removedBefore;
    for (let j = 1; j < groups.length; j++) groups[j].start -= removedBefore;
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, a);
    g.setIndex(new THREE.BufferAttribute(Uint16Array.from(out), 1));
    groups.forEach((gr) => g.addGroup(gr.start, gr.count, gr.materialIndex));
    g.boundingSphere = src.boundingSphere;
    coveredCache.set(ck, g);
    return g;
  }

  function buildSkeleton(info) {
    const bones = [], byName = {};
    header.bones.forEach((b, i) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      const h = info.bones[i].head;
      if (b.parent >= 0) {
        const ph = info.bones[b.parent].head;
        bone.position.set(h[0] - ph[0], h[1] - ph[1], h[2] - ph[2]);
        bones[b.parent].add(bone);
      } else bone.position.set(h[0], h[1], h[2]);
      bones.push(bone); byName[b.name] = bone;
    });
    return { bones, byName };
  }

  async function createPlayer(id, opts = {}) {
    const d = await getPlayerData(id);
    const { info } = d;
    const mats = opts.materials || {};
    const defaults = { skin: () => new THREE.MeshStandardMaterial({ color: 0xc58c6a, roughness: 0.6 }), eye: () => new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.2 }), mouth: () => new THREE.MeshStandardMaterial({ color: 0xd8c8c0 }) };
    const materialArray = header.shared.groups.map((g) => mats[g.material] || (defaults[g.material] || defaults.skin)());
    const { bones, byName } = buildSkeleton(info);
    const object = new THREE.Group();
    object.name = `legend:${id}`;
    const lod = Math.max(0, Math.min(d.lods.length - 1, opts.lod | 0));
    // Hide body triangles fully covered by the worn shells (opts.hideCovered !== false).
    const worn = Object.keys(opts.shells || {}).filter((n) => shells[n] && shells[n].cover);
    const coverKey = opts.hideCovered === false ? '' : worn.sort().join(',');
    const geoFor = (l) => (coverKey ? coveredGeometry(d, l, coverKey, worn) : d.lods[l]);
    const mesh = new THREE.SkinnedMesh(geoFor(lod), materialArray);
    mesh.name = `${id}:body`;
    mesh.add(bones[0]);
    mesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    mesh.bind(skeleton);
    mesh.frustumCulled = false;        // skinned bounds change with poses; cull the whole player yourself if needed
    object.add(mesh);
    const shellMeshes = {};
    for (const [name, mat] of Object.entries(opts.shells || {})) {
      const m = new THREE.SkinnedMesh(shellGeometry(d, name, (opts.shellOffsets || {})[name] || 0, (opts.shellFade || {})[name] || 0), mat);
      m.name = `${id}:${name}`;
      m.bind(skeleton, mesh.bindMatrix);  // shares the body skeleton: one bone texture, identical deformation
      m.frustumCulled = false;
      object.add(m);
      shellMeshes[name] = m;
    }
    const rest = bones.map((b) => b.quaternion.clone());
    const restPos = bones.map((b) => b.position.clone());
    return {
      id, info, object, mesh, skeleton, bones: byName, shells: shellMeshes,
      setLod(n) { mesh.geometry = geoFor(Math.max(0, Math.min(d.lods.length - 1, n | 0))); },
      resetPose() { bones.forEach((b, i) => { b.quaternion.copy(rest[i]); b.position.copy(restPos[i]); }); },
      boneAxis(name) {
        const i = header.bones.findIndex((b) => b.name === name);
        const { head, tail } = info.bones[i];
        return new THREE.Vector3(tail[0] - head[0], tail[1] - head[1], tail[2] - head[2]).normalize();
      },
      landmark(name) { const p = info.landmarks[name]; return p ? new THREE.Vector3(p[0], p[1], p[2]) : null; },
    };
  }

  return { header, players: header.players.map((p) => p.id), shellNames: Object.keys(shells), createPlayer, getPlayerData };
}
