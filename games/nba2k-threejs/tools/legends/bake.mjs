/**
 * bake.mjs — bakes the CC0 MakeHuman (MPFB2) legends into the runtime format version 2 (FORMAT.md, SPEC-v2 §3.1,
 * §8.2–§8.3): header JSON, one shared binary, one binary per player and 15 mask PNGs.
 *
 *   node bake.mjs <config.json> [--out <dir>] [--name <basename>] [--no-lod] [--fast]
 *
 * Per player: base.obj → macro targets (MakeHuman weighting, lib/targets.mjs) → detail targets → uniform scale to
 * the barefoot height, soles on y = 0, pelvis over x = z = 0 → joints from the game_engine rig strategies →
 * procedural eyeballs (24 × 16 UV spheres at the player's measured eye centre/radius with a cornea bulge) → smooth
 * normals → per-player groom shells, shoe covers, expression morphs, groom/extra masks → quantisation.
 * Shared: topology (body + teeth/tongue + eyeballs; lash cards are kept vertices used only by the `lashes` shell),
 * UVs, vertex colours of the wet group, skin weights, LOD0–3 indices (meshoptimizer), cloth/accessory shells,
 * shared skin masks, landmarks, UV islands.
 *
 * `--no-lod` (no meshoptimizer) writes `"devOnly": true` so the runtime refuses the files outside `?debug=1`;
 * without meshoptimizer and without `--no-lod` the bake exits 1. `--fast` (used by calibrate.mjs) skips shells,
 * morphs, masks and LODs. The bake is deterministic: same config + cache → byte-identical files.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ensureCore, ensureAsset, pool, useRef, saveLock, CACHE_DIR } from './fetch.mjs';
import { macroTargetList, detailTargetList, readTarget, applyTarget, normaliseMacro } from './lib/targets.mjs';
import { parseObj, groupIndices, evalJoint, sortBones, skinWeights, quantiseWeights, computeNormals, octEncode } from './lib/mesh.mjs';
import { buildSharedShells, buildGroomShells, shoeCovers } from './lib/shells.mjs';
import { landmarkTable, faceFrame, earSetRefined, mirrorIndex, metricSets, LANDMARK_OBJ, BODY_LAST } from './lib/landmarks.mjs';
import { MORPH_NAMES, DELTA_STEP, jawField, tongueField, bakeMorphs, expressionTargetFiles } from './lib/morphs.mjs';
import { MASK_SPEC, ATTR_NAMES, sampleMap, evaluate, vertexAttrs, sharedFields, playerFields, writeMask } from './lib/masks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = (rel) => path.join(CACHE_DIR, rel);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const UNIT = 0.1; // OBJ decimetres -> metres
const KB = 1024;

/** Size budgets (bytes, SPEC-v2 §3.1). */
export const BUDGET = Object.freeze({ header: 140 * KB, shared: 800 * KB, player: 300 * KB, total: 3.5 * 1048576 });

const EYE_SEG = 24, EYE_RINGS = 16;          // UV sphere: rings measured from the front pole (+z)
const CORNEA_DEG = 24, CORNEA_K = 0.06;
const MOUTH_GROUPS = ['helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue'];
const LASH_GROUPS = { l: { upper: 'helper-l-eyelashes-2', lower: 'helper-l-eyelashes-1' }, r: { upper: 'helper-r-eyelashes-2', lower: 'helper-r-eyelashes-1' } };
const COLOR = { eye: [255, 255, 255], teeth: [0xe9, 0xe3, 0xd4], gums: [0xa8, 0x50, 0x4a], tongue: [0xb0, 0x60, 0x5a], body: [255, 255, 255] };

// Joint cubes exported per player as landmarks (metres) — used by the animation rig (sockets) and masks.
const JOINT_LANDMARKS = ['joint-l-eye', 'joint-r-eye', 'joint-mouth', 'joint-jaw', 'joint-head', 'joint-head-2', 'joint-neck',
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
    for (const ch of Object.keys(p.expressions || {})) if (!MORPH_NAMES.includes(ch)) throw new Error(`${p.id}: unknown expression channel ${ch}`);
  }
  return cfg;
}

export async function requiredTargetFiles(cfg) {
  useRef(cfg.mpfbRef);
  await ensureCore({ quiet: true });
  const macro = readJson(C('targets/macrodetails/macro.json'));
  const index = readJson(C('targets/target.json'));
  const set = new Set();
  for (const p of cfg.players) {
    for (const m of macroVariants(p.macro)) for (const [f] of macroTargetList(macro, m)) set.add(f);
    for (const [f] of detailTargetList(index, p.targets)) set.add(f);
    for (const f of expressionTargetFiles(index, p)) set.add(f);
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
  for (let i = 0; i <= BODY_LAST; i++) { const y = pos[i * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minY, maxY, h: (maxY - minY) * UNIT };
}

const align4 = (n) => (n + 3) & ~3;
const round5 = (x) => Math.round(x * 1e5) / 1e5;
const r5v = (v) => v.map(round5);
/** 0.1 mm rounding for joint / landmark coordinates in the header (metres) */
const r4v = (v) => v.map((x) => Math.round(x * 1e4) / 1e4);

class BinWriter {
  constructor() { this.chunks = []; this.size = 0; this.sections = {}; }
  add(name, arr, type, itemSize) {
    const pad = align4(this.size) - this.size;
    if (pad) { this.chunks.push(Buffer.alloc(pad)); this.size += pad; }
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    if (this.sections[name]) throw new Error(`duplicate section ${name}`);
    this.sections[name] = { offset: this.size, count: arr.length / itemSize, type, itemSize, bytes: buf.length };
    this.chunks.push(Buffer.from(buf)); this.size += buf.length;
    // nested header entries reference a section by its name in this file's `sections` table
    return name;
  }
  write(file) { const b = Buffer.concat(this.chunks); fs.writeFileSync(file, b); return b.length; }
}

/** Canonical eye UV sphere (front pole at +z): unit directions + cornea scale, hi and low index lists. */
function eyeTopology() {
  const dirs = [];
  const ringStart = [];
  dirs.push([0, 0, 1]); ringStart.push(0);
  for (let i = 1; i < EYE_RINGS; i++) {
    ringStart.push(dirs.length);
    const th = Math.PI * i / EYE_RINGS;
    for (let j = 0; j < EYE_SEG; j++) {
      const ph = 2 * Math.PI * j / EYE_SEG;
      dirs.push([Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]);
    }
  }
  ringStart.push(dirs.length); dirs.push([0, 0, -1]);
  // cornea: directions within 24° of forward pushed out by 0.06·R·cos(π/2·θ/24°)
  const scale = dirs.map((d) => { const th = Math.acos(Math.max(-1, Math.min(1, d[2]))) * 180 / Math.PI; return 1 + (th < CORNEA_DEG ? CORNEA_K * Math.cos(Math.PI / 2 * th / CORNEA_DEG) : 0); });
  const vid = (ring, seg) => (ring === 0 ? 0 : ring === EYE_RINGS ? dirs.length - 1 : ringStart[ring] + (seg % EYE_SEG));
  const build = (rStep, sStep) => {
    const tris = [];
    for (let r = 0; r < EYE_RINGS; r += rStep) {
      for (let s = 0; s < EYE_SEG; s += sStep) {
        const s2 = (s + sStep) % EYE_SEG;
        const a = vid(r, s), b = vid(r, s2), c = vid(r + rStep, s), d = vid(r + rStep, s2);
        if (r === 0) tris.push(a, c, d);
        else if (r + rStep === EYE_RINGS) tris.push(a, c, b);
        else tris.push(a, c, d, a, d, b);
      }
    }
    // orient outward: flip any triangle whose normal points toward the centre
    for (let t = 0; t < tris.length; t += 3) {
      const [p, q, w] = [dirs[tris[t]], dirs[tris[t + 1]], dirs[tris[t + 2]]];
      const n = cross(sub(q, p), sub(w, p));
      const m = [(p[0] + q[0] + w[0]) / 3, (p[1] + q[1] + w[1]) / 3, (p[2] + q[2] + w[2]) / 3];
      if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) { const x = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = x; }
    }
    return tris;
  };
  return { dirs, scale, hi: build(1, 1), lo: build(2, 2) };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Logs and returns a budget line. */
function budgetLine(label, bytes, budget) {
  const ok = bytes <= budget;
  console.log(`budget ${label}: ${(bytes / KB).toFixed(1)} KB / ${(budget / KB).toFixed(0)} KB ${ok ? 'ok' : 'OVER'}`);
  return ok;
}

export async function bake(cfg, { outDir, name, fast = false, noLod = false }) {
  useRef(cfg.mpfbRef);
  await ensureCore({ quiet: true });
  const files = await requiredTargetFiles(cfg);
  await pool(files, 6, (f) => ensureAsset(f, { quiet: true }));

  const obj = parseObj(C('3dobjs/base.obj'));
  const groups = readJson(C('mesh_metadata/basemesh_vertex_groups.json'));
  const rig = readJson(C('rigs/standard/rig.game_engine.json'));
  const weights = readJson(C('rigs/standard/weights.game_engine.json'));
  const rigDefault = readJson(C('rigs/standard/rig.default.json'));
  const weightsDefault = readJson(C('rigs/standard/weights.default.json'));
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

  let meshopt = null;
  if (!fast) {
    try { const m = await import('meshoptimizer'); await m.MeshoptSimplifier.ready; meshopt = m.MeshoptSimplifier; meshopt.useExperimentalFeatures = true; }
    catch (e) {
      if (!noLod) throw new Error('meshoptimizer is not installed (npm install in tools/legends): the runtime needs LOD1-3 and shell LOD1; pass --no-lod for a dev-only bake');
      console.warn('meshoptimizer not installed: dev-only bake without LODs (--no-lod)');
    }
  }

  // --- Shared topology -----------------------------------------------------------------------------------
  const keepMouth = cfg.keepMouth !== false;
  const faceSet = (names) => obj.faces.filter((f) => names.includes(f.g));
  const bodyFaces = faceSet(['body']), mouthFaces = keepMouth ? faceSet(MOUTH_GROUPS) : [];
  const lashGroupNames = Object.values(LASH_GROUPS).flatMap((s) => [s.upper, s.lower]);
  const lashFaces = faceSet(lashGroupNames);
  const usedSorted = (faces) => [...new Set(faces.flatMap((f) => f.v))].sort((a, b) => a - b);
  const keptToObj = [];
  const keptMap = new Int32Array(nObj).fill(-1);
  const keep = (list) => { const s = keptToObj.length; for (const v of list) { keptMap[v] = keptToObj.length; keptToObj.push(v); } return [s, list.length]; };
  keep(usedSorted(bodyFaces));
  // lip seam split: vertices shared by upper-lip and lower-lip faces get a second kept copy used by the lower
  // faces (coincident when the mouth is closed, so the face stays watertight), so jawOpen opens the mouth
  // instead of stretching the lip contact and the inner fold into a curtain over the teeth
  const lip = lipSeamSplit(obj, bodyFaces);
  const seamDup = new Map();
  for (const v of lip.seam) { seamDup.set(v, keptToObj.length); keptToObj.push(v); }
  const rangeBody = [0, keptToObj.length];
  const rangeMouth = keep(usedSorted(mouthFaces));
  const rangeLash = keep(usedSorted(lashFaces).filter((v) => keptMap[v] < 0));
  const eyeTop = eyeTopology();
  const nEye = eyeTop.dirs.length;
  const rangeEye = { l: [keptToObj.length, nEye], r: [keptToObj.length + nEye, nEye] };
  for (let i = 0; i < 2 * nEye; i++) keptToObj.push(65535);       // generated vertices: no obj index
  const nKept = keptToObj.length;
  const bodyKeptCount = rangeBody[1];
  if (rangeBody[0] !== 0) throw new Error('body vertices must come first');

  const renderKey = new Map();
  const renderToKept = [], renderUv = [], renderCol = [];
  const index = [], keptTris = [], bodyTris = [];
  const dist2 = (a, b) => { const p = obj.pos; return (p[a * 3] - p[b * 3]) ** 2 + (p[a * 3 + 1] - p[b * 3 + 1]) ** 2 + (p[a * 3 + 2] - p[b * 3 + 2]) ** 2; };
  const triangulate = (f) => (f.v.length === 4
    ? (dist2(f.v[0], f.v[2]) <= dist2(f.v[1], f.v[3]) ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]])
    : Array.from({ length: f.v.length - 2 }, (_, i) => [0, i + 1, i + 2]));
  const renderV = (key, k, u, v, col) => {
    let r = renderKey.get(key);
    if (r == null) { r = renderToKept.length; renderKey.set(key, r); renderToKept.push(k); renderUv.push(u, v); renderCol.push(...col); }
    return r;
  };
  // body
  for (const f of bodyFaces) {
    const low = lip.lowerFaces.has(f);
    const kOf = (v) => (low && seamDup.has(v) ? seamDup.get(v) : keptMap[v]);
    const r = f.v.map((v, i) => renderV(`b${kOf(v)}/${f.t[i]}`, kOf(v), obj.uv[f.t[i] * 2], obj.uv[f.t[i] * 2 + 1], COLOR.body));
    for (const t of triangulate(f)) {
      index.push(r[t[0]], r[t[1]], r[t[2]]);
      const k = t.map((i) => kOf(f.v[i]));
      keptTris.push(...k); bodyTris.push(...k);
    }
  }
  const bodyIndexCount = index.length;
  // eyes (hi), then mouth: the wet group
  const eyeRender = { l: [], r: [] };
  for (const side of ['l', 'r']) {
    for (let i = 0; i < nEye; i++) {
      const d = eyeTop.dirs[i], s = eyeTop.scale[i];
      // front-disc UV: 0.5 + (x − cx, y − cy)/(2R)
      eyeRender[side].push(renderV(`e${side}${i}`, rangeEye[side][0] + i, 0.5 + d[0] * s / 2, 0.5 + d[1] * s / 2, COLOR.eye));
    }
  }
  const wetStart = index.length;
  for (const side of ['l', 'r']) for (let t = 0; t < eyeTop.hi.length; t += 3) {
    const tri = [eyeTop.hi[t], eyeTop.hi[t + 1], eyeTop.hi[t + 2]];
    index.push(...tri.map((i) => eyeRender[side][i]));
    keptTris.push(...tri.map((i) => rangeEye[side][0] + i));
  }
  const eyesCount = index.length - wetStart;
  const mouthStart = index.length;
  if (keepMouth) {
    const ty = {};
    for (const g of MOUTH_GROUPS) { const ids = groupIndices(groups, g); ty[g] = ids.reduce((s, i) => s + obj.pos[i * 3 + 1] * UNIT, 0) / ids.length; }
    for (const f of mouthFaces) {
      const r = f.v.map((v) => {
        const y = obj.pos[v * 3 + 1] * UNIT;
        let col = COLOR.tongue;
        if (f.g === 'helper-upper-teeth') col = y > ty[f.g] + 0.003 ? COLOR.gums : COLOR.teeth;
        else if (f.g === 'helper-lower-teeth') col = y < ty[f.g] - 0.003 ? COLOR.gums : COLOR.teeth;
        return renderV(`m${v}`, keptMap[v], 2.0, 0.0, col);       // UV u = 2.0 → constant eye-texture texel
      });
      for (const t of triangulate(f)) { index.push(r[t[0]], r[t[1]], r[t[2]]); keptTris.push(...t.map((i) => keptMap[f.v[i]])); }
    }
  }
  const mouthCount = index.length - mouthStart;
  // low eyes (12 × 8) — wet group of LOD3 and the low tier
  const eyeLowIndex = [];
  for (const side of ['l', 'r']) for (const i of eyeTop.lo) eyeLowIndex.push(eyeRender[side][i]);
  // lash card triangles (kept space; normals and the lashes shell only)
  const lashTris = [];
  for (const f of lashFaces) for (const t of triangulate(f)) lashTris.push(...t.map((i) => keptMap[f.v[i]]));
  const nRender = renderToKept.length;
  if (nRender > 65535) throw new Error('too many render vertices for Uint16 indices');
  const groupsHdr = [
    { name: 'body', material: 'skin', start: 0, count: bodyIndexCount },
    { name: 'wet', material: 'wet', start: wetStart, count: index.length - wetStart },
  ];
  const wetParts = { eyes: [wetStart, eyesCount], mouth: [mouthStart, mouthCount] };

  // --- Skeleton --------------------------------------------------------------------------------------------
  const boneOrder = sortBones(rig);
  const boneParents = boneOrder.map((b) => (rig[b].parent ? boneOrder.indexOf(rig[b].parent) : -1));
  const realKept = keptToObj.map((o) => (o === 65535 ? 0 : o));
  const skin = skinWeights(weights, boneOrder, realKept, 'head');
  const headB = boneOrder.indexOf('head');
  for (const s of ['l', 'r']) for (let i = 0; i < nEye; i++) {
    const k = rangeEye[s][0] + i;
    for (let j = 0; j < 4; j++) { skin.idx[k * 4 + j] = j === 0 ? headB : 0; skin.w[k * 4 + j] = j === 0 ? 1 : 0; }
  }
  console.log(`lip seam: ${lip.seam.length} vertices split (upper/lower copies)`);
  console.log(`skin: ${nKept} kept vertices (body ${bodyKeptCount}, mouth ${rangeMouth[1]}, lashes ${rangeLash[1]}, eyes 2 x ${nEye}), ${skin.unweighted} unweighted (-> head), ${skin.truncated} truncated to 4 influences`);
  const skinW8 = quantiseWeights(skin.w);

  // --- Base mesh data (metres) ------------------------------------------------------------------------------
  const basePosM = new Float64Array(nObj * 3);
  for (let i = 0; i < nObj * 3; i++) basePosM[i] = obj.pos[i] * UNIT;
  const baseJoints = {};
  for (const b of boneOrder) baseJoints[b] = { head: evalJoint(rig[b].head, obj.pos, groups).map((x) => x * UNIT), tail: evalJoint(rig[b].tail, obj.pos, groups).map((x) => x * UNIT) };
  const eyeHelper = { l: groupIndices(groups, 'helper-l-eye'), r: groupIndices(groups, 'helper-r-eye') };
  const eyeFit = (P) => {   // centre = mean of the helper-eye vertices, radius = max distance
    const out = {};
    for (const s of ['l', 'r']) {
      const ids = eyeHelper[s];
      const c = [0, 0, 0];
      for (const i of ids) for (let a = 0; a < 3; a++) c[a] += P(i, a) / ids.length;
      let r = 0;
      for (const i of ids) r = Math.max(r, Math.hypot(P(i, 0) - c[0], P(i, 1) - c[1], P(i, 2) - c[2]));
      out[s] = { c, r };
    }
    return out;
  };
  const keptPositions = (P, eyes) => {
    const kp = new Float64Array(nKept * 3);
    for (let k = 0; k < nKept; k++) { const o = keptToObj[k]; if (o === 65535) continue; for (let a = 0; a < 3; a++) kp[k * 3 + a] = P(o, a); }
    for (const s of ['l', 'r']) for (let i = 0; i < nEye; i++) {
      const k = rangeEye[s][0] + i, d = eyeTop.dirs[i], sc = eyeTop.scale[i] * eyes[s].r;
      for (let a = 0; a < 3; a++) kp[k * 3 + a] = eyes[s].c[a] + d[a] * sc;
    }
    return kp;
  };
  const normalTris = keptTris.concat(lashTris);
  const baseEyes = eyeFit((o, a) => basePosM[o * 3 + a]);
  const baseKept = keptPositions((o, a) => basePosM[o * 3 + a], baseEyes);
  const baseNrm = computeNormals(baseKept, normalTris, nKept);
  const lmTable = landmarkTable(basePosM);
  const earObj = earSetRefined(basePosM);
  const earKept = new Set(earObj.map((o) => keptMap[o]).filter((k) => k >= 0));
  const cube = (pos, nm) => evalJoint({ strategy: 'CUBE', cube_name: nm }, pos, groups);

  // --- Player geometry (macro + detail targets, scale, eyes): computed first, the shared-shell decimation uses it
  const targetCache = new Map();
  const getTarget = (rel) => { if (!targetCache.has(rel)) targetCache.set(rel, readTarget(C(rel))); return targetCache.get(rel); };
  const playerGeo = new Map();
  for (const p of cfg.players) {
    const detailList = detailTargetList(targetIndex, p.targets);
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
    const posM = new Float64Array(nObj * 3);
    for (let i = 0; i < nObj; i++) { posM[i * 3] = pos[i * 3] * s + T[0]; posM[i * 3 + 1] = pos[i * 3 + 1] * s + T[1]; posM[i * 3 + 2] = pos[i * 3 + 2] * s + T[2]; }
    const PM = (o, a) => posM[o * 3 + a];
    const eyes = eyeFit(PM);
    // posObj: OBJ units, pre-scale (morph deltas use it)
    playerGeo.set(p.id, { detailList, macroIn, macroList, posObj: pos, posM, rawHeight, scale, s, T, eyes, kp: keptPositions(PM, eyes) });
  }

  // --- Shared shells --------------------------------------------------------------------------------------
  const lashKeptAll = [];
  const lashUpper = new Set();
  const lashKept = {};
  for (const [s, gl] of Object.entries(LASH_GROUPS)) {
    lashKept[s] = { upper: groupIndices(groups, gl.upper).map((o) => keptMap[o]).filter((k) => k >= 0), lower: groupIndices(groups, gl.lower).map((o) => keptMap[o]).filter((k) => k >= 0) };
    for (const k of lashKept[s].upper) lashUpper.add(k);
    lashKeptAll.push(...lashKept[s].upper, ...lashKept[s].lower);
  }
  const lashKeptSorted = [...new Set(lashKeptAll)].sort((a, b) => a - b);
  const sharedShells = fast ? [] : buildSharedShells({
    keptToObj, bodyTris, basePos: baseKept, baseNrm, skinIdx: skin.idx, skinW: skin.w, boneOrder, joints: baseJoints, simplifier: meshopt,
    lash: { kept: lashKeptSorted, tris: lashTris, eye: baseEyes, upper: lashUpper },
    playerPos: [...playerGeo.values()].map((g) => g.kp),
  });
  for (const s of sharedShells) console.log(`shell ${s.name}: ${s.vertexCount} vertices (${s.dups || 0} uv-seam duplicates), ${s.tris.length / 3} triangles${s.simplifiedFrom ? ` (simplified from ${s.simplifiedFrom})` : ''}${s.lod1 ? `, LOD1 ${s.lod1.length / 3}` : ''}, covers ${s.cover.length} body vertices, ${(s.loops || []).length} loops`);

  // --- Body LODs: simplified index buffers over the SAME render vertices ------------------------------------
  const lodHeaders = [], lodIndex = [];
  const lodDefs = fast ? [] : (cfg.lods || []);
  if (lodDefs.length && meshopt) {
    const bodyIdx = Uint32Array.from(index.slice(0, bodyIndexCount));
    const rp = new Float32Array(nRender * 3);
    for (let r = 0; r < nRender; r++) for (let a = 0; a < 3; a++) rp[r * 3 + a] = baseKept[renderToKept[r] * 3 + a];
    meshopt.useExperimentalFeatures = true;
    const rn = new Float32Array(computeNormals(rp, Array.from(bodyIdx), nRender));
    for (const [li, lod] of lodDefs.entries()) {
      const target = Math.floor(bodyIdx.length * lod.ratio / 3) * 3;
      const lock = new Uint8Array(nRender);
      if (lod.lockHead) for (let r = 0; r < nRender; r++) {
        const k = renderToKept[r];
        let hw = 0; for (let j = 0; j < 4; j++) if (skin.idx[k * 4 + j] === headB) hw += skin.w[k * 4 + j];
        // lock the face only (front of the head in base.obj, z > 8 cm): skull, ears and neck still simplify
        lock[r] = hw > 0.5 && rp[r * 3 + 2] > 0.08 ? 1 : 0;
      }
      const [simp, err] = meshopt.simplifyWithAttributes(bodyIdx, rp, 3, rn, 3, [0.25, 0.25, 0.25], lock, target, lod.maxError ?? 0.02, lod.lockBorder ? ['LockBorder'] : []);
      // wet group: full eyes + mouth for LOD1–2, 12 × 8 eyes only for the last (LOD3) level
      const last = li === lodDefs.length - 1;
      const wet = last ? eyeLowIndex : index.slice(wetStart);
      const idx = Uint16Array.from([...simp, ...wet]);
      lodIndex.push(idx);
      lodHeaders.push({ ratio: lod.ratio, lockHead: !!lod.lockHead, triangles: idx.length / 3, bodyTriangles: simp.length / 3, error: +(err * meshopt.getScale(rp, 3)).toFixed(5),
        groups: [{ name: 'body', material: 'skin', start: 0, count: simp.length }, { name: 'wet', material: 'wet', start: simp.length, count: wet.length }], wet: last ? 'eyesLow' : 'eyes+mouth' });
      console.log(`LOD${li + 1} ratio ${lod.ratio}: body ${simp.length / 3} tris (from ${bodyIdx.length / 3}), wet ${wet.length / 3}, error ${(err * meshopt.getScale(rp, 3) * 1000).toFixed(2)} mm on the base mesh`);
    }
  }

  // --- Shared binary -------------------------------------------------------------------------------------
  const shared = new BinWriter();
  shared.add('renderToKept', Uint16Array.from(renderToKept), 'u16', 1);
  shared.add('uv', Uint16Array.from(renderUv, (u) => Math.round(Math.max(0, Math.min(2, u)) / 2 * 65535)), 'u16n*2', 2);
  shared.add('color', Uint8Array.from(renderCol), 'u8n', 3);
  shared.add('index', Uint16Array.from(index), 'u16', 3);
  shared.add('eyeLow.index', Uint16Array.from(eyeLowIndex), 'u16', 3);
  shared.add('skinIndex', skin.idx, 'u8', 4);
  shared.add('skinWeight', skinW8, 'u8n', 4);
  shared.add('keptToObj', Uint16Array.from(keptToObj), 'u16', 1);
  lodIndex.forEach((idx, i) => { lodHeaders[i].section = shared.add(`lod${i + 1}.index`, idx, 'u16', 3); });
  const shellHeaders = sharedShells.map((s) => writeShell(shared, s, 'shell'));
  // base-mesh vertex sets (kept indices) of the likeness metrics (lib/landmarks.mjs metricSets) for measure.mjs
  const measureSetSections = Object.fromEntries(Object.entries(metricSets(basePosM)).map(([k, list]) => [k, shared.add(`measure.${k}`, Uint16Array.from(list.map((o) => keptMap[o]).filter((k2) => k2 >= 0)), 'u16', 1)]));
  fs.mkdirSync(outDir, { recursive: true });
  const sharedFile = `${name}.shared.bin`;
  const sharedBytes = shared.write(path.join(outDir, sharedFile));

  // --- Shared masks (base mesh) ---------------------------------------------------------------------------
  const bodyRenderTris = index.slice(0, bodyIndexCount);
  const maps = {};
  const mapFor = (size, ss) => (maps[`${size}x${ss}`] ||= sampleMap(size, Float64Array.from(renderUv), bodyRenderTris, ss));
  const attrs = vertexAttrs({ renderToKept, skinIdx: skin.idx, skinW: skin.w, boneOrder, earKept });
  const renderArrays = (kp, nr) => {
    const P = new Float64Array(nRender * 3), N = new Float64Array(nRender * 3);
    for (let r = 0; r < nRender; r++) { const k = renderToKept[r]; for (let a = 0; a < 3; a++) { P[r * 3 + a] = kp[k * 3 + a]; N[r * 3 + a] = nr[k * 3 + a]; } }
    return { pos: P, nrm: N, attr: attrs, attrSize: ATTR_NAMES.length };
  };
  const triHead = (verts) => (t) => { const a = bodyRenderTris[t * 3]; return attrs[a * ATTR_NAMES.length] + attrs[a * ATTR_NAMES.length + 1] > 0.01 || attrs[bodyRenderTris[t * 3 + 1] * ATTR_NAMES.length] > 0.01; };
  const masksHdr = {};
  let maskBytes = 0;
  const baseFrame = faceFrame((o) => [basePosM[o * 3], basePosM[o * 3 + 1], basePosM[o * 3 + 2]], {
    l: cube(obj.pos, 'joint-l-eye').map((x) => x * UNIT), r: cube(obj.pos, 'joint-r-eye').map((x) => x * UNIT),
  });
  baseFrame.L.EC_l = cube(obj.pos, 'joint-l-eye').map((x) => x * UNIT);
  baseFrame.L.EC_r = cube(obj.pos, 'joint-r-eye').map((x) => x * UNIT);
  for (const [nm, o] of Object.entries(lmTable)) if (!baseFrame.L[nm]) baseFrame.L[nm] = [basePosM[o * 3], basePosM[o * 3 + 1], basePosM[o * 3 + 2]];
  if (!fast) {
    const extra = baseMaskExtras(basePosM, earObj, baseFrame, baseJoints);
    const sf = sharedFields(baseFrame, baseJoints, extra);
    const verts = renderArrays(baseKept, baseNrm);
    for (const kind of ['skin0', 'skin1', 'skin2']) {
      const spec = MASK_SPEC[kind];
      const t0 = Date.now();
      const { img, covered } = evaluate(mapFor(spec.size, spec.ss), verts, sf[kind], 3, kind === 'skin0' ? triHead(verts) : null);
      const m = writeMask(fs, path, outDir, `${name}.${kind}.png`, kind, img, covered, spec.size, spec.size >= 1024 ? 8 : 4);
      masksHdr[kind] = { file: m.file, size: spec.size, channels: spec.channels, bytes: m.bytes };
      maskBytes += m.bytes;
      console.log(`mask ${m.file}: ${spec.size}², ${(m.bytes / KB).toFixed(1)} KB${m.overBudget ? ' OVER budget (within 20 %)' : ' within budget'} (${Date.now() - t0} ms)`);
    }
  }

  // --- Players -------------------------------------------------------------------------------------------
  const headFamily = new Float32Array(nObj);
  {
    const W = weights.weights;
    for (const b of ['head', 'neck_01']) for (const [v, w] of W[b] || []) if (v < nObj) headFamily[v] += w;
  }
  const jawPivotBase = evalJoint(rigDefault.jaw.head, obj.pos, groups).map((x) => x * UNIT);
  const wJ = fast ? null : jawField({ basePosM, weightsDefault, headFamily, pivot: jawPivotBase, nObj, ecY: baseFrame.EC[1], helpers: { lowerTeeth: groupIndices(groups, 'helper-lower-teeth'), tongue: groupIndices(groups, 'helper-tongue') } });
  const wT = fast ? null : tongueField(weightsDefault, nObj);
  // jaw weight per kept vertex: the field, with the lip region resolved by side (upper copy 0, lower copy 1)
  const wJk = fast ? null : Float64Array.from(keptToObj, (o, k) => {
    if (o >= nObj) return 0;
    if (seamDup.has(o)) return seamDup.get(o) === k ? 1 : 0;
    if (lip.lowerOnly.has(o)) return 1;
    if (lip.upperOnly.has(o)) return 0;
    return wJ[o];
  });
  const players = [];
  let playerBytes = 0;
  for (const [pi, p] of cfg.players.entries()) {
    const { detailList, macroIn, macroList, posObj, posM, rawHeight, scale, s, T, eyes, kp } = playerGeo.get(p.id);
    const toM = (q) => [q[0] * s + T[0], q[1] * s + T[1], q[2] * s + T[2]];
    const bones = boneOrder.map((b) => ({
      head: b === 'Root' ? [0, 0, 0] : r4v(toM(evalJoint(rig[b].head, posObj, groups))),
      tail: r4v(toM(evalJoint(rig[b].tail, posObj, groups))),
      roll: round5(rig[b].roll || 0),
    }));
    const joints = Object.fromEntries(boneOrder.map((b, i) => [b, bones[i]]));
    const landmarks = {};
    for (const l of JOINT_LANDMARKS) landmarks[l.replace('joint-', '')] = r4v(toM(cube(posObj, l)));

    // normals of the kept vertices
    const nr = computeNormals(kp, normalTris, nKept);

    // face frame + landmarks
    const f = faceFrame((o) => [posM[o * 3], posM[o * 3 + 1], posM[o * 3 + 2]], { l: landmarks['l-eye'], r: landmarks['r-eye'] });
    for (const [nm, o] of Object.entries(lmTable)) if (!f.L[nm]) f.L[nm] = [posM[o * 3], posM[o * 3 + 1], posM[o * 3 + 2]];
    const face = Object.fromEntries(Object.entries(f.L).map(([k, v]) => [k, r4v(v)]));
    f.arcDy = foreheadArc(kp, bodyKeptCount, f);
    const earPts = earObj.map((o) => [posM[o * 3], posM[o * 3 + 1], posM[o * 3 + 2]]);

    const pw = new BinWriter();
    const q = quantisePositions(kp, nKept);
    pw.add('position', q.q, 'u16q', 3);
    pw.add('normal', octEncode(nr), 'oct8', 2);

    // per-player groom shells, shoe covers
    const ap = p.appearance || {};
    let groomHdr = [], hmInfo = null;
    if (!fast) {
      const gs = buildGroomShells({ keptToObj, bodyTris, pos: kp, nrm: nr, skinIdx: skin.idx, skinW: skin.w, boneOrder, frame: f, appearance: ap, earKept, earPts, simplifier: meshopt });
      hmInfo = gs.headMetric;
      groomHdr = gs.shells.map((sh) => writeShell(pw, sh, 'shell'));
      for (const sh of gs.shells) console.log(`player ${p.id} shell ${sh.name}: ${sh.vertexCount} vertices, ${sh.tris.length / 3} triangles${sh.lod1 ? `, LOD1 ${sh.lod1.length / 3}` : ''}`);
    }
    const covers = {};
    if (!fast) for (const [cn, list] of Object.entries(shoeCovers({ keptToObj, pos: kp, skinIdx: skin.idx, skinW: skin.w, boneOrder }))) covers[cn] = pw.add(`cover.${cn}`, Uint16Array.from(list), 'u16', 1);

    // expression morphs
    let morphHdr = null;
    if (!fast) {
      const pivot = toM(evalJoint(rigDefault.jaw.head, posObj, groups));
      const mt = bakeMorphs({ player: p, targetIndex, getTarget, nObj, s, keptPos: kp, keptToObj, bodyKeptCount, wJ: wJk, wT, pivot, lashKept, eyes, face: f.L });
      const idxAll = [], dAll = [];
      const targets = [];
      for (const m of mt) {
        targets.push({ name: m.name, channel: MORPH_NAMES.indexOf(m.name), count: m.count, offset: idxAll.length, maxAbs: round5(m.maxAbs) });
        idxAll.push(...m.idx); dAll.push(...m.delta);
        console.log(`player ${p.id} morph ${m.name}: ${m.count} vertices, max |delta| ${(m.maxAbs * 1000).toFixed(2)} mm`);
      }
      morphHdr = { step: DELTA_STEP, targets, sections: { index: pw.add('morph.index', Uint16Array.from(idxAll), 'u16', 1), delta: pw.add('morph.delta', Int16Array.from(dAll), 'i16q', 3) }, jawPivot: r5v(pivot) };
    }

    // per-player masks
    const pmasks = {};
    if (!fast) {
      const scapY = (landmarks['l-scapula'][1] + landmarks['r-scapula'][1]) / 2;
      const neckHoleY = joints.clavicle_l.head[1] - 0.045 * scale;
      const tq = tattooQuantiles(ap, kp, nKept, keptToObj, skin, boneOrder, f, pi);
      const pf = playerFields(f, ap, { ...joints, scapulaY: scapY, neckHoleY }, earPts, pi, tq);
      const verts = renderArrays(kp, nr);
      for (const kind of ['groom', 'extra']) {
        const spec = MASK_SPEC[kind];
        const t0 = Date.now();
        const { img, covered } = evaluate(mapFor(spec.size, spec.ss), verts, pf[kind], 3, kind === 'groom' ? triHead(verts) : null);
        const m = writeMask(fs, path, outDir, `${name}.${p.id}.${kind}.png`, kind, img, covered, spec.size, spec.size >= 1024 ? 8 : 4);
        pmasks[kind] = { file: m.file, size: spec.size, channels: spec.channels, bytes: m.bytes };
        maskBytes += m.bytes;
        console.log(`mask ${m.file}: ${spec.size}², ${(m.bytes / KB).toFixed(1)} KB${m.overBudget ? ' OVER budget (within 20 %)' : ' within budget'} (${Date.now() - t0} ms)`);
      }
    }

    const file = `${name}.${p.id}.bin`;
    const bytes = pw.write(path.join(outDir, file));
    playerBytes += bytes;
    let bodyMaxY = -Infinity;
    for (let k = 0; k < bodyKeptCount; k++) bodyMaxY = Math.max(bodyMaxY, kp[k * 3 + 1]);
    const eyeY = (landmarks['l-eye'][1] + landmarks['r-eye'][1]) / 2;
    const feet = footData(kp, keptToObj, skin, boneOrder, joints);
    players.push({
      id: p.id, label: p.label || p.id, file, bytes, sections: pw.sections,
      height: round5(bodyMaxY), scale: round5(scale), rawHeight: round5(rawHeight),
      posMin: q.min.map((x) => +x.toFixed(7)), posStep: q.step.map((x) => +x.toPrecision(8)),
      bones, landmarks,
      eyes: { l: { c: r5v(eyes.l.c), r: round5(eyes.l.r), ...(eyes.l.blinkDeg != null ? { blinkDeg: +eyes.l.blinkDeg.toFixed(2) } : {}) }, r: { c: r5v(eyes.r.c), r: round5(eyes.r.r), ...(eyes.r.blinkDeg != null ? { blinkDeg: +eyes.r.blinkDeg.toFixed(2) } : {}) } },
      feet, face,
      frame: { Gy: round5(f.Gy), EC: r5v(f.EC), headCZ: round5(f.headCZ), CHx: round5(f.CHx), phiT: round5(f.phiT), rT: round5(f.rT), ...(hmInfo || {}) },
      dims: {
        shoulderJoints: round5(Math.hypot(...sub(joints.upperarm_l.head, joints.upperarm_r.head))), heightBarefoot: round5(bodyMaxY),
        eyeY: round5(eyeY), headTopY: round5(bodyMaxY), headCentreAboveHeadBone: round5(eyeY + 0.01 - landmarks.head[1]),
      },
      morphs: morphHdr, shells: groomHdr, covers, masks: pmasks,
      // the runtime look/kit data live in src/legends.js (SPEC-v2 §2.6–§2.7); the header keeps only what the
      // bake measured or generated, plus the config meta (names, number, stats) that unit-lineup cross-checks
      macro: normaliseMacro(macroIn), meta: p.meta || {},
    });
    console.log(`player ${p.id}: height ${bodyMaxY.toFixed(3)} m (raw MakeHuman ${rawHeight.toFixed(3)} m, scale ${scale.toFixed(4)}), ${macroList.length} macro + ${detailList.length} detail targets, eyes r ${(eyes.l.r * 1000).toFixed(1)} mm, ${bytes} B`);
  }
  console.log(`players: ${players.length}`);

  // --- Header --------------------------------------------------------------------------------------------
  const landmarksHdr = {};
  for (const [nm, o] of Object.entries(lmTable)) {
    const k = keptMap[o];
    let r = -1; for (let i = 0; i < nRender; i++) if (renderToKept[i] === k) { r = i; break; }
    landmarksHdr[nm] = { obj: o, kept: k, base: r5v([basePosM[o * 3], basePosM[o * 3 + 1], basePosM[o * 3 + 2]]), uv: r >= 0 ? [round5(renderUv[r * 2]), round5(renderUv[r * 2 + 1])] : null };
  }
  const baseTop = (() => { let m = -Infinity; for (let o = 0; o <= BODY_LAST; o++) m = Math.max(m, basePosM[o * 3 + 1]); return m; })();
  const header = {
    format: 'legends-mesh', version: 2,
    ...(noLod && !meshopt ? { devOnly: true } : {}),
    ...(fast ? { devOnly: true, fast: true } : {}),
    source: 'MakeHuman hm08 base mesh + MPFB2 targets/rigs/weights (CC0 1.0)', mpfbRef: cfg.mpfbRef,
    coords: 'metres, +y up, character faces +z, soles on y=0, pelvis over x=z=0',
    counts: { renderVertices: nRender, keptVertices: nKept, bodyKeptVertices: bodyKeptCount, triangles: index.length / 3, bones: boneOrder.length, eyeVertices: nEye },
    kept: { body: rangeBody, mouth: rangeMouth, lashes: rangeLash, eyeL: rangeEye.l, eyeR: rangeEye.r },
    shared: { file: sharedFile, bytes: sharedBytes, sections: shared.sections, groups: groupsHdr, wetParts },
    eye: { segments: EYE_SEG, rings: EYE_RINGS, lowSegments: EYE_SEG / 2, lowRings: EYE_RINGS / 2, corneaDeg: CORNEA_DEG, corneaK: CORNEA_K, irisRadiusUv: 0.225 },
    bones: boneOrder.map((b, i) => ({ name: b, parent: boneParents[i] })),
    baseBones: Object.fromEntries(boneOrder.map((b) => [b, r5v(baseJoints[b].head)])),
    baseScaleRefs: {
      headH: round5(baseTop - basePosM[LANDMARK_OBJ.ME * 3 + 1]), crownY: round5(baseTop), menY: round5(basePosM[LANDMARK_OBJ.ME * 3 + 1]),
      pelvisY: round5(baseJoints.pelvis.head[1]), spine03Y: round5(baseJoints.spine_03.head[1]), ankleY: -0.745,
    },
    landmarks: landmarksHdr,
    // base-mesh vertex sets (kept indices) of the likeness metrics (lib/landmarks.mjs metricSets) for measure.mjs
    measureSets: measureSetSections,
    uvIslands: uvIslands(index, bodyIndexCount, renderUv, renderToKept, skin, boneOrder),
    masks: masksHdr,
    morphNames: MORPH_NAMES,
    shells: shellHeaders,
    lods: lodHeaders,
    players,
  };
  const headerFile = path.join(outDir, `${name}.json`);
  const headerText = JSON.stringify(header);
  fs.writeFileSync(headerFile, headerText);
  saveLock();

  // --- Budgets ---------------------------------------------------------------------------------------------
  const headerBytes = Buffer.byteLength(headerText);
  let ok = budgetLine(`${name}.json`, headerBytes, BUDGET.header);
  ok = budgetLine(sharedFile, sharedBytes, BUDGET.shared) && ok;
  for (const p of players) ok = budgetLine(p.file, p.bytes, BUDGET.player) && ok;
  const total = headerBytes + sharedBytes + playerBytes + maskBytes;
  ok = budgetLine('total', total, BUDGET.total) && ok;
  console.log(`wrote ${outDir}/${name}.json + shared ${sharedBytes} B + players ${playerBytes} B + masks ${maskBytes} B = ${(total / 1048576).toFixed(3)} MB`);
  if (!ok && !fast) throw new Error('size budget exceeded (SPEC-v2 §3.1)');
  return header;
}

/**
 * Forehead midline profile of a player: maps a surface distance from the glabella (arc length up the midline,
 * metres) to the height above the glabella at that point. Used for the hairline `above` value (groom.mjs).
 */
function foreheadArc(kp, bodyKeptCount, f) {
  const mid = [];
  for (let k = 0; k < bodyKeptCount; k++) {
    const x = kp[k * 3], y = kp[k * 3 + 1], z = kp[k * 3 + 2];
    if (Math.abs(x) < 0.0015 && y >= f.Gy && z > f.headCZ) mid.push([y, z]);
  }
  mid.sort((a, b) => a[0] - b[0]);
  const prof = [[0, 0]];                     // [arc, dy]
  let arc = 0, prev = [f.Gy, f.L.G[2]];
  for (const p of mid) { arc += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; prof.push([arc, p[0] - f.Gy]); }
  return (a) => {
    for (let i = 1; i < prof.length; i++) if (prof[i][0] >= a) { const t = (a - prof[i - 1][0]) / (prof[i][0] - prof[i - 1][0] || 1); return prof[i - 1][1] + (prof[i][1] - prof[i - 1][1]) * t; }
    return prof[prof.length - 1][1];
  };
}

/**
 * Lip seam of the base mesh: body faces around the mouth (centroid |x| < CHx + 2 mm, within 12 mm of the lip
 * seam curve yS(x), z > 0.12 m incl. the inner fold) are classified upper/lower by their centroid against yS(x);
 * seam = vertices used by both sides (|x| < CHx − 1 mm, so the commissures stretch instead of tearing).
 */
function lipSeamSplit(obj, bodyFaces) {
  const P = (v, a) => obj.pos[v * 3 + a] * UNIT;
  const ST = [P(LANDMARK_OBJ.ST, 0), P(LANDMARK_OBJ.ST, 1)], CHx = Math.abs(P(LANDMARK_OBJ.CH_l, 0)), CHy = P(LANDMARK_OBJ.CH_l, 1);
  const yS = (x) => ST[1] + (CHy - ST[1]) * Math.min(1, Math.abs(x) / CHx) ** 2;
  const side = new Map(), up = new Set(), lo = new Set(), lowerFaces = new Set();
  for (const f of bodyFaces) {
    const n = f.v.length;
    const c = [0, 1, 2].map((a) => f.v.reduce((acc, v) => acc + P(v, a), 0) / n);
    if (Math.abs(c[0]) > CHx + 0.002 || Math.abs(c[1] - yS(c[0])) > 0.012 || c[2] < 0.12) continue;
    const isUp = c[1] > yS(c[0]);
    side.set(f, isUp);
    for (const v of f.v) (isUp ? up : lo).add(v);
    if (!isUp) lowerFaces.add(f);
  }
  const seam = [...up].filter((v) => lo.has(v) && Math.abs(P(v, 0)) < CHx - 0.001).sort((a, b) => a - b);
  const inner = (v) => Math.abs(P(v, 0)) < CHx - 0.001;
  return {
    seam, lowerFaces,
    lowerOnly: new Set([...lo].filter((v) => !up.has(v) && inner(v))),
    upperOnly: new Set([...up].filter((v) => !lo.has(v) && inner(v))),
  };
}

/** u16 quantisation of kept positions (per-axis min/step). */
function quantisePositions(kp, n) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], kp[k * 3 + a]); max[a] = Math.max(max[a], kp[k * 3 + a]); }
  const step = max.map((m, a) => (m - min[a]) / 65535 || 1e-6);
  const q = new Uint16Array(n * 3);
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) q[k * 3 + a] = Math.round((kp[k * 3 + a] - min[a]) / step[a]);
  return { q, min, step };
}

/** Writes one shell's sections and returns its header entry (FORMAT.md § Shells). */
function writeShell(w, s, prefix) {
  const n = s.vertexCount;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i++) { u0 = Math.min(u0, s.uv[i * 2]); u1 = Math.max(u1, s.uv[i * 2]); v0 = Math.min(v0, s.uv[i * 2 + 1]); v1 = Math.max(v1, s.uv[i * 2 + 1]); }
  // round the range outward so u0 + q·scale reproduces every value within one u16 step
  u0 = Math.floor(u0 * 1e4) / 1e4; v0 = Math.floor(v0 * 1e4) / 1e4; u1 = Math.ceil(u1 * 1e4) / 1e4; v1 = Math.ceil(v1 * 1e4) / 1e4;
  const su = (u1 - u0) / 2 || 1e-4, sv = (v1 - v0) / 2 || 1e-4;
  const uvq = new Uint16Array(n * 2);
  for (let i = 0; i < n; i++) {
    uvq[i * 2] = Math.round(Math.max(0, Math.min(2, (s.uv[i * 2] - u0) / su)) / 2 * 65535);
    uvq[i * 2 + 1] = Math.round(Math.max(0, Math.min(2, (s.uv[i * 2 + 1] - v0) / sv)) / 2 * 65535);
  }
  const h = {
    name: s.name, kind: s.kind, material: s.material, offset: s.offset, uvMode: s.uvMode,
    uvRange: [u0, v0, u1, v1], uvScale: [+su.toFixed(6), +sv.toFixed(6)],
    vertexCount: n, triCount: s.tris.length / 3,
    ...(s.players ? { players: s.players } : {}),
    ...(s.relax ? { relax: s.relax } : {}),
    ...(s.vRange ? { vRange: s.vRange, vMetres: s.vMetres } : {}),
    ...(s.perimeter ? { perimeter: s.perimeter } : {}),
    ...(s.loops && s.loops.length ? { loops: s.loops.map((l) => ({ kind: l.kind, ...(l.side ? { side: l.side } : {}), uv: l.uv.map(([a, b]) => [Math.round(a * 1e4) / 1e4, Math.round(b * 1e4) / 1e4]) })) } : {}),
    ...(s.Nu ? { Nu: s.Nu } : {}),
    sections: {},
  };
  const sec = h.sections;
  sec.a = w.add(`${prefix}.${s.name}.a`, Uint16Array.from(s.a), 'u16', 1);
  sec.b = w.add(`${prefix}.${s.name}.b`, Uint16Array.from(s.b), 'u16', 1);
  sec.t = w.add(`${prefix}.${s.name}.t`, Uint8Array.from(s.t, (x) => Math.round(Math.max(0, Math.min(1, x)) * 255)), 'u8n', 1);
  sec.uv = w.add(`${prefix}.${s.name}.uv`, uvq, 'u16n*2', 2);
  sec.offsetScale = w.add(`${prefix}.${s.name}.offsetScale`, Uint8Array.from(s.offsetScale, (x) => Math.round(Math.max(0, Math.min(1, x / 4)) * 255)), 'u8n*4', 1);
  sec.edge = w.add(`${prefix}.${s.name}.edge`, Uint8Array.from(s.edge, (d) => Math.round(Math.max(0, Math.min(1, d / 0.1)) * 255)), 'u8n*0.1m', 1);
  sec.index = w.add(`${prefix}.${s.name}.index`, Uint16Array.from(s.tris), 'u16', 3);
  if (s.cover && s.cover.length) sec.cover = w.add(`${prefix}.${s.name}.cover`, Uint16Array.from(s.cover), 'u16', 1);
  if (s.lod1) h.lods = [{ ratio: 0.4, triCount: s.lod1.length / 3, section: w.add(`${prefix}.${s.name}.lod1`, Uint16Array.from(s.lod1), 'u16', 3) }];
  if (s.groom) {
    h.groom = {
      family: s.groom.family, part: s.groom.part, layer: s.groom.layer, fadeMm: s.groom.fadeMm,
      density: w.add(`${prefix}.${s.name}.density`, Uint8Array.from(s.density, (x) => Math.round(Math.max(0, Math.min(1, x)) * 255)), 'u8n', 1),
      fade: w.add(`${prefix}.${s.name}.fade`, Uint8Array.from(s.fade, (x) => Math.round(Math.max(0, Math.min(1, x)) * 255)), 'u8n', 1),
    };
  }
  return h;
}

/** Base-mesh helpers for the shared mask fields (ear rim, ear back, navel, neck creases, floor). */
function baseMaskExtras(P, earObj, f, j) {
  const pt = (o) => [P[o * 3], P[o * 3 + 1], P[o * 3 + 2]];
  const ear = earObj.map(pt);
  const bins = new Map();
  for (const p of ear) { const b = Math.round(p[1] / 0.004); bins.set(b, Math.max(bins.get(b) || 0, Math.abs(p[0]))); }
  const earMaxX = (y) => { const b = Math.round(y / 0.004); return bins.get(b) ?? bins.get(b - 1) ?? bins.get(b + 1) ?? 0.08; };
  const zMin = Math.min(...ear.map((p) => p[2]));
  const back = ear.filter((p) => p[2] < zMin + 0.008);
  const nearEarBack = (pl) => { if (pl[2] > zMin + 0.004 || pl[2] < zMin - 0.012) return false; for (const q of back) if (Math.hypot(pl[0] - q[0], pl[1] - q[1], pl[2] - q[2]) < 0.006) return true; return false; };
  // navel: the deepest point of the front midline between pelvis + 0.05 and + 0.15
  let navel = [0, 0, 0], zb = Infinity;
  const py = j.pelvis.head[1];
  for (let o = 0; o <= BODY_LAST; o++) {
    const p = pt(o);
    if (Math.abs(p[0]) > 0.003 || p[1] < py + 0.05 || p[1] > py + 0.15 || p[2] < 0.05) continue;
    if (p[2] < zb) { zb = p[2]; navel = p; }
  }
  // neck front z at mid-neck
  let nz = -Infinity;
  const ny = (j.neck_01.head[1] + f.L.ME[1]) / 2;
  for (let o = 0; o <= BODY_LAST; o++) { const p = pt(o); if (Math.abs(p[0]) < 0.005 && Math.abs(p[1] - ny) < 0.005) nz = Math.max(nz, p[2]); }
  let floorY = Infinity;
  for (let o = 0; o <= BODY_LAST; o++) floorY = Math.min(floorY, P[o * 3 + 1]);
  return { earMaxX, nearEarBack, navel, neckFrontZ: nz, neckCreases: [f.L.ME[1] - 0.035, f.L.ME[1] - 0.055], floorY };
}

/** Per-region noise quantiles so the tattoo threshold yields the requested arm coverage (≈70 % upper, 35 % fore). */
function tattooQuantiles(ap, kp, nKept, keptToObj, skin, boneOrder, f, seed) {
  const T = (ap.tattoos || []).find((t) => t.kind === 'armBlobs');
  const out = {};
  if (!T) return out;
  const pf = playerFields(f, { ...ap, tattoos: [] }, {}, [], seed, {});
  for (const s of ['l', 'r']) for (const [part, bone, cov] of [['up', `upperarm_${s}`, T.coverageUpper], ['lo', `lowerarm_${s}`, T.coverageFore]]) {
    const bi = boneOrder.indexOf(bone);
    const vals = [];
    for (let k = 0; k < nKept; k++) {
      if (keptToObj[k] > BODY_LAST) continue;
      let w = 0; for (let j = 0; j < 4; j++) if (skin.idx[k * 4 + j] === bi) w += skin.w[k * 4 + j];
      if (w > 0.5) vals.push(pf.tatNoise([kp[k * 3], kp[k * 3 + 1], kp[k * 3 + 2]]));
    }
    vals.sort((a, b) => a - b);
    // the (1 − coverage) quantile becomes the 0.45 threshold
    out[`${part}_${s}`] = vals.length ? vals[Math.min(vals.length - 1, Math.floor((1 - cov) * vals.length))] : 0.5;
  }
  return out;
}

/** Foot data for the procedural sneakers (CHR §7.6), per side, player metres. */
function footData(kp, keptToObj, skin, boneOrder, joints) {
  const out = {};
  for (const s of ['l', 'r']) {
    const fb = new Set([`foot_${s}`, `ball_${s}`].map((b) => boneOrder.indexOf(b)));
    const pts = [];
    for (let k = 0; k < keptToObj.length; k++) {
      if (keptToObj[k] > BODY_LAST) continue;
      let w = 0; for (let j = 0; j < 4; j++) if (fb.has(skin.idx[k * 4 + j])) w += skin.w[k * 4 + j];
      if (w > 0.5) pts.push([kp[k * 3], kp[k * 3 + 1], kp[k * 3 + 2]]);
    }
    let heel = null, toe = null;
    for (const p of pts) { if (p[1] <= 0.03 && (!heel || p[2] < heel[2])) heel = p; if (!toe || p[2] > toe[2]) toe = p; }
    const span = (sel) => { let a = Infinity, b = -Infinity; for (const p of pts) if (sel(p)) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); } return b - a; };
    const ball = joints[`ball_${s}`].head, ankle = joints[`foot_${s}`].head;
    out[s] = {
      heel: r5v(heel), toe: r5v(toe), ball: r5v(ball), ankle: r5v(ankle),
      widthBall: round5(span((p) => Math.abs(p[2] - ball[2]) < 0.02)),
      widthHeel: round5(span((p) => p[2] > heel[2] + 0.03 && p[2] < heel[2] + 0.05 && p[1] < 0.06)),
      length: round5(Math.hypot(toe[0] - heel[0], toe[2] - heel[2])),
    };
  }
  return out;
}

/** UV islands of the body (connected render-vertex components): rect, triangle count, dominant region. */
function uvIslands(index, bodyCount, uv, renderToKept, skin, boneOrder) {
  const parent = new Int32Array(renderToKept.length).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < bodyCount; t += 3) { const a = find(index[t]); parent[find(index[t + 1])] = a; parent[find(index[t + 2])] = a; }
  const isl = new Map();
  const region = (b) => {
    const n = boneOrder[b];
    if (/^(head|neck_01)$/.test(n)) return 'head';
    if (/^(pelvis|spine_0\d|clavicle_[lr])$/.test(n)) return 'torso';
    const m = /_([lr])$/.exec(n);
    if (/^(upperarm|lowerarm)/.test(n)) return `arm_${m[1]}`;
    if (/^(hand|thumb|index|middle|ring|pinky)/.test(n)) return `hand_${m[1]}`;
    if (/^(thigh|calf)/.test(n)) return `leg_${m[1]}`;
    if (/^(foot|ball)/.test(n)) return `foot_${m[1]}`;
    return 'other';
  };
  for (let t = 0; t < bodyCount; t += 3) {
    const r = find(index[t]);
    let e = isl.get(r);
    if (!e) { e = { rect: [Infinity, Infinity, -Infinity, -Infinity], tris: 0, votes: {} }; isl.set(r, e); }
    e.tris++;
    for (let j = 0; j < 3; j++) {
      const v = index[t + j];
      e.rect[0] = Math.min(e.rect[0], uv[v * 2]); e.rect[1] = Math.min(e.rect[1], uv[v * 2 + 1]);
      e.rect[2] = Math.max(e.rect[2], uv[v * 2]); e.rect[3] = Math.max(e.rect[3], uv[v * 2 + 1]);
      const k = renderToKept[v];
      const rg = region(skin.idx[k * 4]);
      e.votes[rg] = (e.votes[rg] || 0) + 1;
    }
  }
  return [...isl.values()].filter((e) => e.tris >= 4).sort((a, b) => b.tris - a.tris).map((e) => ({
    rect: e.rect.map(round5), tris: e.tris, region: Object.entries(e.votes).sort((a, b) => b[1] - a[1])[0][0],
  }));
}

/** SHA-256 of every file of a bake output (deterministic re-bake check). */
export function hashOutputs(dir, name) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(`${name}.`)).sort()) out[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const cfgFile = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--out', '--name'].includes(args[i - 1])));
  if (!cfgFile) { console.error('usage: node bake.mjs <config.json> [--out dir] [--name base] [--no-lod] [--fast]'); process.exit(2); }
  const cfg = loadConfig(path.resolve(cfgFile));
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const outDir = path.resolve(opt('--out') || (cfg.output ? path.resolve(cfg._dir, cfg.output) : path.join(HERE, 'out')));
  const name = opt('--name') || cfg.name || 'legends';
  const t0 = Date.now();
  bake(cfg, { outDir, name, fast: args.includes('--fast'), noLod: args.includes('--no-lod') })
    .then(() => console.log(`bake done in ${((Date.now() - t0) / 1000).toFixed(1)} s`))
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}

export { mirrorIndex };
