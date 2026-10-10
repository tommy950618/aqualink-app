// Bakes MakeHuman (MPFB2, CC0) bodies into the compact runtime format described in FORMAT.md.
//
//   node tools/legends/bake.mjs <config.json> [--out <dir>] [--name <basename>]
//
// Steps per player: base.obj -> macro targets (MakeHuman weighting, see lib/targets.mjs) -> detail targets
// -> scale to the requested barefoot height -> joint positions from rig.game_engine.json strategies ->
// smooth normals -> quantisation. Topology, UVs, skin weights and clothing/hair shell topology are shared.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCore, ensureAsset, pool, CACHE_DIR } from './fetch.mjs';
import { macroTargetList, detailTargetList, readTarget, applyTarget, normaliseMacro } from './lib/targets.mjs';
import { parseObj, groupIndices, evalJoint, sortBones, skinWeights, quantiseWeights, computeNormals, octEncode } from './lib/mesh.mjs';
import { buildShells } from './lib/shells.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = (rel) => path.join(CACHE_DIR, rel);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const UNIT = 0.1; // OBJ decimetres -> metres

// Submeshes taken from base.obj. Everything else (tights, skirt, hair, genitals, eyelash helpers, teeth,
// tongue, joint cubes) is dropped. Teeth/tongue can be enabled per bake with "keepMouth": true.
const SUBMESHES = [
  { name: 'body', groups: ['body'], material: 'skin' },
  { name: 'eyes', groups: ['helper-l-eye', 'helper-r-eye'], material: 'eye' },
];
const MOUTH = { name: 'mouth', groups: ['helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue'], material: 'mouth' };

// Joint cubes exported per player as landmarks (metres), handy for anchors and face regions.
const LANDMARKS = ['joint-l-eye', 'joint-r-eye', 'joint-mouth', 'joint-jaw', 'joint-head', 'joint-head-2', 'joint-neck',
  'joint-l-hand-2', 'joint-r-hand-2', 'joint-l-hand-3', 'joint-r-hand-3', 'joint-l-scapula', 'joint-r-scapula',
  'joint-l-foot-2', 'joint-r-foot-2', 'joint-pelvis'];

export function loadConfig(file) {
  const cfg = readJson(file);
  cfg._dir = path.dirname(file);
  if (!Array.isArray(cfg.players) || !cfg.players.length) throw new Error('config.players must be a non-empty array');
  const ids = new Set();
  for (const p of cfg.players) {
    if (!/^[a-z0-9_-]+$/i.test(p.id || '')) throw new Error(`bad player id ${p.id}`);
    if (ids.has(p.id)) throw new Error(`duplicate player id ${p.id}`);
    ids.add(p.id);
  }
  return cfg;
}

export async function requiredTargetFiles(cfg) {
  await ensureCore({ quiet: true });
  const macro = readJson(C('targets/macrodetails/macro.json'));
  const index = readJson(C('targets/target.json'));
  const set = new Set();
  for (const p of cfg.players) {
    for (const m of macroVariants(p.macro)) for (const [f] of macroTargetList(macro, m)) set.add(f);
    for (const [f] of detailTargetList(index, p.targets)) set.add(f);
  }
  return [...set].sort();
}

// "height": "auto" picks the MakeHuman height slider whose raw height matches the requested height, so the
// final uniform scale stays close to 1 (keeps MakeHuman's natural tall/short proportions).
function macroVariants(m = {}) {
  return m.height === 'auto' ? [{ ...m, height: 0 }, { ...m, height: 1 }] : [m];
}

function bodyHeight(pos) {
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i <= 13379; i++) { const y = pos[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minY, maxY, h: (maxY - minY) * UNIT };
}

function align4(n) { return (n + 3) & ~3; }

class BinWriter {
  constructor() { this.chunks = []; this.size = 0; this.sections = {}; }
  add(name, arr, type, itemSize) {
    const pad = align4(this.size) - this.size;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.size += pad; }
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    this.sections[name] = { offset: this.size, count: arr.length / itemSize, type, itemSize, bytes: buf.length };
    this.chunks.push(Buffer.from(buf)); this.size += buf.length;
    return this.sections[name];
  }
  write(file) { const b = Buffer.concat(this.chunks); fs.writeFileSync(file, b); return b.length; }
}

export async function bake(cfg, { outDir, name }) {
  await ensureCore({ quiet: true });
  const files = await requiredTargetFiles(cfg);
  await pool(files, 6, (f) => ensureAsset(f));

  const obj = parseObj(C('3dobjs/base.obj'));
  const groups = readJson(C('mesh_metadata/basemesh_vertex_groups.json'));
  const rig = readJson(C('rigs/standard/rig.game_engine.json'));
  const weights = readJson(C('rigs/standard/weights.game_engine.json'));
  const macroTable = readJson(C('targets/macrodetails/macro.json'));
  const targetIndex = readJson(C('targets/target.json'));
  const nObj = obj.pos.length / 3;

  // --- Sanity check: the rig's default_position values were saved on the default MakeHuman (all macros 0.5,
  // races 1/3). Rebuild that body with our macro maths and compare joints (verifies axes, units, weighting).
  {
    const def = { gender: 0.5, age: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5 };
    const list = macroTargetList(macroTable, def);
    await pool(list.map(([f]) => f), 6, (f) => ensureAsset(f, { quiet: true }));
    const pos = Float64Array.from(obj.pos);
    for (const [rel, w] of list) applyTarget(pos, readTarget(C(rel)), w);
    let maxErr = 0, worst = '';
    for (const [bn, b] of Object.entries(rig)) for (const e of ['head', 'tail']) {
      if (bn === 'Root') continue; // Root head is stored as the origin; its tail is a ground-cube helper
      const p = evalJoint(b[e], pos, groups);
      const d = b[e].default_position;
      const err = Math.hypot(p[0] * UNIT - d[0], -p[2] * UNIT - d[1], p[1] * UNIT - d[2]);
      if (err > maxErr) { maxErr = err; worst = `${bn}.${e}`; }
    }
    console.log(`rig check (default human, ${list.length} macro targets): max |joint - default_position| = ${(maxErr * 1000).toFixed(2)} mm (${worst})`);
  }

  // --- Shared topology -----------------------------------------------------------------------------------
  const subs = cfg.keepMouth ? [...SUBMESHES, MOUTH] : SUBMESHES;
  const keptMap = new Int32Array(nObj).fill(-1);   // obj vertex -> kept index
  const keptToObj = [];
  const renderKey = new Map();                     // "v/t" -> render index
  const renderToKept = [], renderUv = [];
  const index = [], subRanges = [];
  const keepV = (v) => { if (keptMap[v] < 0) { keptMap[v] = keptToObj.length; keptToObj.push(v); } return keptMap[v]; };
  const renderV = (v, t) => {
    const key = v * 65536 + t;
    let r = renderKey.get(key);
    if (r == null) {
      r = renderToKept.length; renderKey.set(key, r);
      renderToKept.push(keepV(v)); renderUv.push(obj.uv[t * 2], obj.uv[t * 2 + 1]);
    }
    return r;
  };
  const dist2 = (a, b) => { const p = obj.pos; return (p[a * 3] - p[b * 3]) ** 2 + (p[a * 3 + 1] - p[b * 3 + 1]) ** 2 + (p[a * 3 + 2] - p[b * 3 + 2]) ** 2; };
  const keptTris = [];                            // triangles in kept-vertex space (normals, shells)
  const triFaceGroup = [];
  for (const sm of subs) {
    const start = index.length;
    for (const f of obj.faces) {
      if (!sm.groups.includes(f.g)) continue;
      const r = f.v.map((v, k) => renderV(v, f.t[k]));
      const k = f.v.map((v) => keptMap[v]);
      let tris;
      if (f.v.length === 4) {
        // split along the shorter diagonal of the base mesh (stable across players)
        tris = dist2(f.v[0], f.v[2]) <= dist2(f.v[1], f.v[3]) ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
      } else tris = Array.from({ length: f.v.length - 2 }, (_, i) => [0, i + 1, i + 2]);
      for (const t of tris) { index.push(r[t[0]], r[t[1]], r[t[2]]); keptTris.push(k[t[0]], k[t[1]], k[t[2]]); triFaceGroup.push(sm.name); }
    }
    subRanges.push({ name: sm.name, material: sm.material, start, count: index.length - start });
  }
  // Eyes: replace the atlas UVs with a front-facing disc projection per eyeball (0.5,0.5 = pupil centre,
  // radius 0.5 = silhouette) so a procedural iris texture can be used.
  for (const g of ['helper-l-eye', 'helper-r-eye']) {
    const ids = groupIndices(groups, g);
    const c = [0, 0, 0];
    for (const i of ids) for (let a = 0; a < 3; a++) c[a] += obj.pos[i * 3 + a] / ids.length;
    let r = 0;
    for (const i of ids) r = Math.max(r, Math.hypot(obj.pos[i * 3] - c[0], obj.pos[i * 3 + 1] - c[1]));
    const idSet = new Set(ids);
    for (let ri = 0; ri < renderToKept.length; ri++) {
      const o = keptToObj[renderToKept[ri]];
      if (!idSet.has(o)) continue;
      renderUv[ri * 2] = 0.5 + (obj.pos[o * 3] - c[0]) / (2 * r);
      renderUv[ri * 2 + 1] = 0.5 + (obj.pos[o * 3 + 1] - c[1]) / (2 * r);
    }
  }
  const nKept = keptToObj.length, nRender = renderToKept.length;
  if (nRender > 65535) throw new Error('too many render vertices for Uint16 indices');
  const bodyKeptCount = subs[0] ? keptToObj.filter((v) => v <= 13379).length : 0;

  // --- Skeleton --------------------------------------------------------------------------------------------
  const boneOrder = sortBones(rig);
  const boneParents = boneOrder.map((b) => (rig[b].parent ? boneOrder.indexOf(rig[b].parent) : -1));
  const skin = skinWeights(weights, boneOrder, keptToObj, 'head');
  console.log(`skin: ${nKept} vertices, ${skin.unweighted} unweighted (-> head), ${skin.truncated} truncated to 4 influences`);
  const skinW8 = quantiseWeights(skin.w);

  let meshopt = null;
  if (cfg.simplify !== false) {
    try { const m = await import('meshoptimizer'); await m.MeshoptSimplifier.ready; meshopt = m.MeshoptSimplifier; }
    catch (e) { console.warn('meshoptimizer not installed (npm install in tools/legends): no LODs, shells not decimated'); }
  }

  // --- Shells (clothing / hair) built on the base mesh, shared by every player --------------------------
  const basePosM = new Float64Array(nObj * 3);
  for (let i = 0; i < nObj * 3; i++) basePosM[i] = obj.pos[i] * UNIT;
  const baseJoints = {};
  for (const b of boneOrder) baseJoints[b] = { head: evalJoint(rig[b].head, obj.pos, groups).map((x) => x * UNIT), tail: evalJoint(rig[b].tail, obj.pos, groups).map((x) => x * UNIT) };
  const baseLandmarks = {};
  for (const l of LANDMARKS) baseLandmarks[l] = evalJoint({ strategy: 'CUBE', cube_name: l }, obj.pos, groups).map((x) => x * UNIT);
  const shells = buildShells({
    keptToObj, keptTris, triFaceGroup, basePos: basePosM, skinIdx: skin.idx, skinW: skin.w, boneOrder,
    joints: baseJoints, landmarks: baseLandmarks, defs: cfg.shells || 'default', simplifier: meshopt,
  });

  // --- Optional LODs: simplified index buffers over the SAME render vertices (no extra per-player data). ---
  // Uses meshoptimizer (npm, MIT) when installed under tools/legends/node_modules; UV seams are respected
  // because meshopt classifies co-located render vertices as seams and only collapses along them.
  const lodHeaders = [];
  const lodIndex = [];
  if (Array.isArray(cfg.lods) && cfg.lods.length) {
    const MeshoptSimplifier = meshopt;
    if (MeshoptSimplifier) {
      const body = subRanges.find((g) => g.name === 'body');
      const bodyIdx = Uint32Array.from(index.slice(body.start, body.start + body.count));
      const rp = new Float32Array(nRender * 3);
      for (let r = 0; r < nRender; r++) for (let a = 0; a < 3; a++) rp[r * 3 + a] = obj.pos[keptToObj[renderToKept[r]] * 3 + a] * UNIT;
      // base-mesh normals as attributes (keeps creases), and optionally lock the face (lockHead) so likeness survives
      MeshoptSimplifier.useExperimentalFeatures = true;
      const tmpTris = [];
      for (let t = 0; t < bodyIdx.length; t++) tmpTris.push(bodyIdx[t]);
      const rn = new Float32Array(computeNormals(rp, tmpTris, nRender));
      const headBone = boneOrder.indexOf('head');
      for (const lod of cfg.lods) {
        const target = Math.floor(bodyIdx.length * lod.ratio / 3) * 3;
        const lock = new Uint8Array(nRender);
        if (lod.lockHead) for (let r = 0; r < nRender; r++) {
          const k = renderToKept[r];
          let hw = 0; for (let j = 0; j < 4; j++) if (skin.idx[k * 4 + j] === headBone) hw += skin.w[k * 4 + j];
          // lock the face only (front of the head in base.obj, z > 8 cm): skull, ears and neck still simplify
          lock[r] = hw > 0.5 && rp[r * 3 + 2] > 0.08 ? 1 : 0;
        }
        const [simp, err] = MeshoptSimplifier.simplifyWithAttributes(bodyIdx, rp, 3, rn, 3, [0.25, 0.25, 0.25], lock, target, lod.maxError ?? 0.02, lod.lockBorder ? ['LockBorder'] : []);
        const rest = index.slice(body.start + body.count);           // eyes (and mouth) unchanged
        const idx = Uint16Array.from([...simp, ...rest]);
        const groups = [{ name: 'body', material: 'skin', start: 0, count: simp.length }];
        let st = simp.length;
        for (const g of subRanges.filter((x) => x.name !== 'body')) { groups.push({ ...g, start: st }); st += g.count; }
        lodIndex.push(idx);
        lodHeaders.push({ ratio: lod.ratio, lockHead: !!lod.lockHead, triangles: idx.length / 3, bodyTriangles: simp.length / 3, error: +(err * MeshoptSimplifier.getScale(rp, 3)).toFixed(5), groups });
        console.log(`LOD ratio ${lod.ratio}: body ${simp.length / 3} tris (from ${bodyIdx.length / 3}), error ${(err * MeshoptSimplifier.getScale(rp, 3) * 1000).toFixed(2)} mm on the base mesh`);
      }
    }
  }

  // --- Shared binary -------------------------------------------------------------------------------------
  const shared = new BinWriter();
  shared.add('renderToKept', Uint16Array.from(renderToKept), 'u16', 1);
  shared.add('uv', Uint16Array.from(renderUv, (u) => Math.round(Math.max(0, Math.min(1, u)) * 65535)), 'u16n', 2);
  shared.add('index', Uint16Array.from(index), 'u16', 3);
  shared.add('skinIndex', skin.idx, 'u8', 4);
  shared.add('skinWeight', skinW8, 'u8n', 4);
  shared.add('keptToObj', Uint16Array.from(keptToObj), 'u16', 1);
  lodIndex.forEach((idx, i) => { lodHeaders[i].section = shared.add(`lod${i + 1}.index`, idx, 'u16', 3); });
  const shellHeaders = [];
  for (const s of shells) {
    const h = { name: s.name, kind: s.kind, offset: s.offset, relax: s.relax, material: s.material, vertexCount: s.vertexCount, triCount: s.tris.length / 3, uvMode: s.uvMode, sections: {} };
    h.sections.a = shared.add(`shell.${s.name}.a`, Uint16Array.from(s.a), 'u16', 1);
    h.sections.b = shared.add(`shell.${s.name}.b`, Uint16Array.from(s.b), 'u16', 1);
    h.sections.t = shared.add(`shell.${s.name}.t`, Uint8Array.from(s.t, (x) => Math.round(Math.max(0, Math.min(1, x)) * 255)), 'u8n', 1);
    h.sections.uv = shared.add(`shell.${s.name}.uv`, Uint16Array.from(s.uv, (u) => Math.round(Math.max(0, Math.min(2, u)) / 2 * 65535)), 'u16n*2', 2);
    h.sections.offset = shared.add(`shell.${s.name}.offsetScale`, Uint8Array.from(s.offsetScale, (x) => Math.round(Math.max(0, Math.min(1, x / 4)) * 255)), 'u8n*4', 1);
    h.sections.edge = shared.add(`shell.${s.name}.edge`, Uint8Array.from(s.edge, (d) => Math.round(Math.max(0, Math.min(1, d / 0.1)) * 255)), 'u8n*0.1m', 1);
    h.sections.index = shared.add(`shell.${s.name}.index`, Uint16Array.from(s.tris), 'u16', 3);
    if (s.cover.length) h.sections.cover = shared.add(`shell.${s.name}.cover`, Uint16Array.from(s.cover), 'u16', 1);
    shellHeaders.push(h);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const sharedFile = `${name}.shared.bin`;
  const sharedBytes = shared.write(path.join(outDir, sharedFile));

  // --- Players -------------------------------------------------------------------------------------------
  const targetCache = new Map();
  const getTarget = (rel) => { if (!targetCache.has(rel)) targetCache.set(rel, readTarget(C(rel))); return targetCache.get(rel); };
  const players = [];
  let playerBytes = 0;
  for (const p of cfg.players) {
    const detailList = detailTargetList(targetIndex, p.targets);
    // expressions are runtime blend descriptors (not baked yet): validate their modifier names now
    for (const ex of Object.values(p.expressions || {})) detailTargetList(targetIndex, ex);
    const morph = (macroIn) => {
      const pos = Float64Array.from(obj.pos);
      const macroList = macroTargetList(macroTable, macroIn);
      for (const [rel, w] of [...macroList, ...detailList]) {
        if (!fs.existsSync(C(rel))) throw new Error(`missing target ${rel} (404 upstream?)`);
        applyTarget(pos, getTarget(rel), w);
      }
      return { pos, macroList };
    };
    let macroIn = { ...(p.macro || {}) };
    if (macroIn.height === 'auto') {
      if (!p.height) throw new Error(`${p.id}: macro.height "auto" needs a player height`);
      let lo = 0, hi = 1;
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) / 2;
        if (bodyHeight(morph({ ...macroIn, height: mid }).pos).h < p.height) lo = mid; else hi = mid;
      }
      macroIn = { ...macroIn, height: Math.round((lo + hi) / 2 * 1e4) / 1e4 };
    }
    const { pos, macroList } = morph(macroIn);
    // Scale to the requested barefoot height and put the soles on y = 0, pelvis over the origin.
    const { minY, h: rawHeight } = bodyHeight(pos);
    const scale = p.height ? p.height / rawHeight : 1;
    const s = UNIT * scale;
    const pelvis = evalJoint(rig.pelvis.head, pos, groups);
    const T = [0, -minY * s, -pelvis[2] * s];
    for (let i = 0; i < nObj; i++) { pos[i * 3] = pos[i * 3] * s + T[0]; pos[i * 3 + 1] = pos[i * 3 + 1] * s + T[1]; pos[i * 3 + 2] = pos[i * 3 + 2] * s + T[2]; }

    const bones = boneOrder.map((b) => ({
      head: b === 'Root' ? [0, 0, 0] : evalJoint(rig[b].head, pos, groups).map(round5),
      tail: evalJoint(rig[b].tail, pos, groups).map(round5),
      roll: round5(rig[b].roll || 0),
    }));
    const landmarks = {};
    for (const l of LANDMARKS) landmarks[l.replace('joint-', '')] = evalJoint({ strategy: 'CUBE', cube_name: l }, pos, groups).map(round5);

    // kept positions + normals
    const kp = new Float64Array(nKept * 3);
    for (let k = 0; k < nKept; k++) { const v = keptToObj[k]; kp[k * 3] = pos[v * 3]; kp[k * 3 + 1] = pos[v * 3 + 1]; kp[k * 3 + 2] = pos[v * 3 + 2]; }
    const nr = computeNormals(kp, keptTris, nKept);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < nKept; k++) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], kp[k * 3 + a]); mx[a] = Math.max(mx[a], kp[k * 3 + a]); }
    const step = mx.map((m, a) => (m - mn[a]) / 65535 || 1e-6);
    const q = new Uint16Array(nKept * 3);
    for (let k = 0; k < nKept; k++) for (let a = 0; a < 3; a++) q[k * 3 + a] = Math.round((kp[k * 3 + a] - mn[a]) / step[a]);
    const pw = new BinWriter();
    pw.add('position', q, 'u16q', 3);
    pw.add('normal', octEncode(nr), 'oct8', 2);
    const file = `${name}.${p.id}.bin`;
    const bytes = pw.write(path.join(outDir, file));
    playerBytes += bytes;
    let bodyMaxY = -Infinity;
    for (let i = 0; i <= 13379; i++) bodyMaxY = Math.max(bodyMaxY, pos[i * 3 + 1]);
    players.push({
      id: p.id, label: p.label || p.id, file, bytes, sections: pw.sections,
      height: round5(bodyMaxY), scale: round5(scale), rawHeight: round5(rawHeight),
      posMin: mn.map((x) => +x.toFixed(7)), posStep: step.map((x) => +x.toPrecision(8)),
      bones, landmarks,
      macro: normaliseMacro(macroIn), targets: p.targets || {}, appearance: p.appearance || {},
      meta: p.meta || {}, expressions: p.expressions || {},
      macroTargets: macroList.map(([f, w]) => [f.replace('targets/macrodetails/', '').replace('.target.gz', ''), round5(w)]),
    });
    console.log(`player ${p.id}: height ${bodyMaxY.toFixed(3)} m (raw MakeHuman ${rawHeight.toFixed(3)} m, scale ${scale.toFixed(4)}), ${macroList.length} macro + ${detailList.length} detail targets, ${bytes} B`);
  }

  const header = {
    format: 'legends-mesh', version: 1,
    source: 'MakeHuman hm08 base mesh + MPFB2 targets/rig/weights (CC0 1.0)',
    coords: 'metres, +y up, character faces +z, soles on y=0, pelvis over x=z=0',
    counts: { renderVertices: nRender, keptVertices: nKept, bodyKeptVertices: bodyKeptCount, triangles: index.length / 3, bones: boneOrder.length },
    shared: { file: sharedFile, bytes: sharedBytes, sections: shared.sections, groups: subRanges.map((g) => ({ ...g, start: g.start, count: g.count })) },
    bones: boneOrder.map((b, i) => ({ name: b, parent: boneParents[i] })),
    shells: shellHeaders,
    lods: lodHeaders,
    players,
  };
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(header));
  console.log(`wrote ${outDir}/${name}.json + shared ${sharedBytes} B + players ${playerBytes} B = ${((sharedBytes + playerBytes) / 1024).toFixed(0)} KB`);
  return header;
}

function round5(x) { return Math.round(x * 1e5) / 1e5; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const cfgFile = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
  if (!cfgFile) { console.error('usage: node bake.mjs <config.json> [--out dir] [--name base]'); process.exit(2); }
  const cfg = loadConfig(path.resolve(cfgFile));
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const outDir = path.resolve(opt('--out') || (cfg.output ? path.resolve(cfg._dir, cfg.output) : path.join(HERE, 'out')));
  const name = opt('--name') || cfg.name || 'legends';
  bake(cfg, { outDir, name }).catch((e) => { console.error(e); process.exit(1); });
}
