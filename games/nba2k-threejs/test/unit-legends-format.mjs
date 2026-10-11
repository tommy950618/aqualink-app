// Unit checks for src/legends/format.js and the pure parts of src/legends/shells.js against the committed assets
// (spec v2 §3.1–§3.4, [CHR §12]): header validation (format/version/devOnly), bin sizes, kept / render counts, every
// index < renderVertices, every shell a/b < keptVertices, morph indices in range, eye radii 0.013–0.019 m, feet
// length 0.27–0.36 m, octahedral normals unit length, shell skin weights (top 4, sum 1), covered LOD index
// assembly, morph expansion, UV metric sanity, shadow-proxy compaction.
// Run: node test/unit-legends-format.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseHeader, view, octDecode, decodeShared, decodePlayer, morphKeptDelta, keptToRender, sectionScale, CUT_KEYS,
  FORMAT_NAME, FORMAT_VERSION,
} from '../src/legends/format.js';
import { shellSkin, shellPositions, shellMorphs, uvMetric, coveredLodIndex, proxyGeometry } from '../src/legends/shells.js';
import { LEGEND_IDS, LEGENDS } from '../src/legends.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', 'assets', 'legends');
const rd = (f) => { const b = readFileSync(path.join(DIR, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

const json = JSON.parse(readFileSync(path.join(DIR, 'legends.json'), 'utf8'));
const header = parseHeader(json);
const shared = decodeShared(rd(header.shared.file), header);
const players = {};
for (const info of header.players) players[info.id] = { info, data: decodePlayer(rd(info.file), info, shared) };
const nR = header.counts.renderVertices, nK = header.counts.keptVertices;

check('parseHeader accepts the committed v2 header and rejects other formats / versions / devOnly', () => {
  assert.equal(header.format, FORMAT_NAME);
  assert.equal(header.version, FORMAT_VERSION);
  assert.throws(() => parseHeader({ ...json, version: 1 }), /unsupported/);
  assert.throws(() => parseHeader({ ...json, format: 'x' }), /unsupported/);
  assert.throws(() => parseHeader({ ...json, devOnly: true }), /devOnly/);
  assert.doesNotThrow(() => parseHeader({ ...json, devOnly: true }, { allowDev: true }));
  assert.equal(parseHeader(JSON.stringify(json)).counts.keptVertices, nK);
  assert.deepEqual(header.players.map((p) => p.id), [...LEGEND_IDS], 'header order = LEGEND_IDS');
});

check('bin sizes match the header; truncated buffers are refused', () => {
  assert.equal(rd(header.shared.file).byteLength, header.shared.bytes);
  for (const p of header.players) assert.equal(rd(p.file).byteLength, p.bytes, p.id);
  const info = header.players[0];
  assert.throws(() => decodePlayer(rd(info.file).slice(0, info.bytes - 4), info, shared), /size/);
  assert.throws(() => view(new ArrayBuffer(8), { offset: 4, count: 4, type: 'u16', itemSize: 1 }), /exceeds/);
});

check('section scales of the format types', () => {
  assert.equal(sectionScale('u8n'), 1 / 255);
  assert.equal(sectionScale('u16n*2'), 2 / 65535);
  assert.ok(Math.abs(sectionScale('u8n*0.1m') - 0.1 / 255) < 1e-12);
  assert.equal(sectionScale('u8n*4'), 4 / 255);
  assert.throws(() => sectionScale('f64'), /unknown/);
});

check('kept / render counts and the kept layout', () => {
  assert.equal(shared.renderToKept.length, nR);
  for (let r = 0; r < nR; r++) assert.ok(shared.renderToKept[r] < nK);
  const k = header.kept;
  assert.equal(k.body[0], 0);
  assert.equal(k.eyeR[0] + k.eyeR[1], nK);
  assert.equal(shared.uv.length, nR * 2);
  assert.equal(shared.skinIndex.length, nK * 4);
  for (let i = 0; i < nK; i++) {
    let s = 0;
    for (let j = 0; j < 4; j++) { s += shared.skinWeight[i * 4 + j]; assert.ok(shared.skinIndex[i * 4 + j] < 53); }
    assert.equal(s, 255, 'kept skin weights sum to 255');
  }
  for (const id of LEGEND_IDS) {
    assert.equal(players[id].data.kept.length, nK * 3);
    for (const v of players[id].data.kept) assert.ok(Number.isFinite(v));
  }
});

check('every LOD index < renderVertices; groups inside their index section', () => {
  assert.equal(shared.lodIndex.length, 4);
  for (let l = 0; l < 4; l++) {
    const ix = shared.lodIndex[l], g = shared.lodGroups[l];
    for (let i = 0; i < ix.length; i++) assert.ok(ix[i] < nR);
    assert.equal(g[0].start, 0);
    assert.equal(g[0].count + g[1].count, ix.length);
    assert.equal(g[1].start, g[0].count);
  }
  assert.equal(shared.lodIndex[0].length / 3, header.counts.triangles);
});

check('every shell vertex a/b < keptVertices, indices in range, UVs finite (shared + per-player)', () => {
  const all = Object.values(shared.shells).map((s) => ['shared', s]);
  for (const id of LEGEND_IDS) for (const s of Object.values(players[id].data.shells)) all.push([id, s]);
  assert.ok(all.length >= 15);
  for (const [who, s] of all) {
    assert.equal(s.n, s.info.vertexCount, `${who} ${s.name} vertexCount`);
    assert.equal(s.index.length / 3, s.info.triCount, `${who} ${s.name} triCount`);
    for (let i = 0; i < s.n; i++) {
      assert.ok(s.a[i] < nK && s.b[i] < nK, `${who} ${s.name} a/b`);
      assert.ok(s.t[i] >= 0 && s.t[i] <= 1);
      assert.ok(Number.isFinite(s.uv[i * 2]) && Number.isFinite(s.uv[i * 2 + 1]));
    }
    for (const ix of [s.index, s.lod1]) if (ix) for (let i = 0; i < ix.length; i++) assert.ok(ix[i] < s.n);
    if (s.cover) for (const k of s.cover) assert.ok(k < nK);
    if (s.info.groom) { assert.equal(s.density.length, s.n); assert.equal(s.fade.length, s.n); }
  }
  for (const id of LEGEND_IDS) {
    const c = players[id].data.covers;
    assert.deepEqual(Object.keys(c).sort(), ['high', 'low', 'lowmid', 'midhigh']);
    assert.ok(c[CUT_KEYS[LEGENDS[id].kit.shoes.cut]], `${id} cover for its cut`);
  }
});

check('morph targets: channels, kept indices in range, deltas bounded, sparse expansion', () => {
  for (const id of LEGEND_IDS) {
    const d = players[id].data, info = players[id].info;
    assert.ok(d.morphs.length >= 4);
    const names = d.morphs.map((m) => m.name);
    for (const n of ['jawOpen', 'scowl', 'blink']) assert.ok(names.includes(n), `${id} ${n}`);
    for (const m of d.morphs) {
      assert.equal(header.morphNames[m.channel], m.name);
      for (const k of m.index) assert.ok(k < nK);
      let mx = 0;
      for (let i = 0; i < m.count; i++) mx = Math.max(mx, Math.hypot(m.delta[i * 3], m.delta[i * 3 + 1], m.delta[i * 3 + 2]));
      const want = info.morphs.targets.find((t) => t.name === m.name).maxAbs;
      assert.ok(Math.abs(mx - want) < 1e-4, `${id} ${m.name} maxAbs ${mx} vs ${want}`);
      const kd = morphKeptDelta(m, nK);
      assert.equal(kd.length, nK * 3);
      const k0 = m.index[0];
      assert.equal(kd[k0 * 3 + 1], m.delta[1]);
      const rdlt = keptToRender(kd, shared.renderToKept, 3);
      assert.equal(rdlt.length, nR * 3);
    }
  }
  assert.ok(players.jordan.data.morphs.some((m) => m.name === 'tongueOut'));
  assert.ok(players.kobe.data.morphs.some((m) => m.name === 'jawJut'));
});

check('eye radii 0.013–0.019 m, feet length 0.27–0.36 m, dims match the listed barefoot heights', () => {
  const H = { kobe: 1.96, jordan: 1.96, lebron: 2.03, giannis: 2.09, yao: 2.27, kyrie: 1.87 };
  for (const id of LEGEND_IDS) {
    const info = players[id].info;
    for (const s of ['l', 'r']) {
      assert.ok(info.eyes[s].r >= 0.013 && info.eyes[s].r <= 0.019, `${id} eye r ${info.eyes[s].r}`);
      assert.ok(info.feet[s].length >= 0.27 && info.feet[s].length <= 0.36, `${id} foot ${info.feet[s].length}`);
    }
    assert.ok(Math.abs(info.dims.heightBarefoot - H[id]) <= 0.02, `${id} height`);
    let top = 0;
    const d = players[id].data.kept;
    for (let k = 0; k < header.kept.body[1]; k++) top = Math.max(top, d[k * 3 + 1]);
    assert.ok(Math.abs(top - H[id]) < 0.02, `${id} mesh top ${top}`);
  }
});

check('octDecode returns unit vectors (axes, diagonal, folded lower half)', () => {
  const o = Int8Array.from([0, 0, 127, 0, 0, 127, -127, 0, 64, 64, 100, -100, 127, 127]);
  const out = octDecode(o, new Float32Array(21));
  for (let i = 0; i < 7; i++) assert.ok(Math.abs(Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) - 1) < 1e-6);
  assert.ok(Math.abs(out[2] - 1) < 1e-6, '(0,0) = +z');
  assert.ok(out[20] < 0, '(127,127) folds to −z');
  const nk = players.kobe.data.keptN;
  for (let i = 0; i < nk.length; i += 3) assert.ok(Math.abs(Math.hypot(nk[i], nk[i + 1], nk[i + 2]) - 1) < 1e-5);
});

check('shell skin weights: top 4 bones, sum 1; positions offset outward; morph propagation', () => {
  const kobe = players.kobe.data;
  for (const name of ['jersey', 'shorts', 'sleeve_r', 'socks_high_brace', 'lashes']) {
    const s = shared.shells[name], sk = shellSkin(s, shared.skinIndex, shared.skinWeight);
    assert.equal(shellSkin(s, shared.skinIndex, shared.skinWeight), sk, 'cached');
    for (let i = 0; i < s.n; i++) {
      let sum = 0;
      for (let j = 0; j < 4; j++) { sum += sk.skinWeight[i * 4 + j]; assert.ok(sk.skinIndex[i * 4 + j] < 53); }
      assert.ok(Math.abs(sum - 1) < 1e-5, `${name} weights sum ${sum}`);
    }
    const P = shellPositions(s, kobe.kept, kobe.keptN);
    let out = 0;
    for (let i = 0; i < s.n; i++) {
      const a = s.a[i] * 3, b = s.b[i] * 3, t = s.t[i];
      const d = [0, 1, 2].map((k) => P.position[i * 3 + k] - (kobe.kept[a + k] * (1 - t) + kobe.kept[b + k] * t));
      out += d[0] * P.normal[i * 3] + d[1] * P.normal[i * 3 + 1] + d[2] * P.normal[i * 3 + 2];
    }
    if (s.info.offset > 0) assert.ok(out / s.n >= s.info.offset * 0.5, `${name} offset outward`);
  }
  const kd = new Array(9).fill(null);
  for (const m of kobe.morphs) kd[m.channel] = morphKeptDelta(m, nK);
  const beard = kobe.shells.beard_inner, ms = shellMorphs(beard, kd);
  assert.equal(ms.length, 9);
  assert.ok(ms[0], 'jawOpen moves the goatee');
  assert.equal(ms[1], null, 'no tongueOut for Kobe');
});

check('covered LOD index: four ranges, covered body triangles removed, wet groups intact', () => {
  const covered = new Uint8Array(nK);
  for (const k of shared.shells.jersey.cover) covered[k] = 1;
  const full = coveredLodIndex(shared, null), cov = coveredLodIndex(shared, covered);
  assert.equal(full.groups.length, 4);
  for (let l = 0; l < 4; l++) {
    assert.equal(full.groups[l][0].count, shared.lodGroups[l][0].count);
    assert.ok(cov.groups[l][0].count < full.groups[l][0].count, `LOD ${l} lost covered triangles`);
    assert.equal(cov.groups[l][1].count, shared.lodGroups[l][1].count, 'wet untouched');
    assert.equal(cov.groups[l][1].start, cov.groups[l][0].start + cov.groups[l][0].count);
  }
  const last = cov.groups[3][1];
  assert.equal(last.start + last.count, cov.index.length);
  for (let i = 0; i < cov.index.length; i++) assert.ok(cov.index[i] < nR);
});

check('UV metric of the jersey: front/back metres per u and v are plausible, periodic in u', () => {
  const s = shared.shells.jersey, P = shellPositions(s, players.kyrie.data.kept, players.kyrie.data.keptN);
  const m = uvMetric(P.position, s.uv, s.index), o = [0, 0], o2 = [0, 0];
  m.metric(0.75, 0.47, o);
  assert.ok(o[0] > 0.6 && o[0] < 2.0, `mu ${o[0]}`);
  assert.ok(o[1] > 0.3 && o[1] < 1.0, `mv ${o[1]}`);
  m.metric(1.75, 0.47, o2);
  assert.ok(Math.abs(o2[0] - o[0]) < 1e-9, 'periodic');
});

check('shadow proxy: compact uncovered LOD3 body', () => {
  const p = proxyGeometry(shared, players.yao.data.kept);
  assert.equal(p.index.length, shared.lodGroups[3][0].count);
  const n = p.position.length / 3;
  assert.ok(n < 2500 && n > 1000, `proxy vertices ${n}`);
  for (const i of p.index) assert.ok(i < n);
});

console.log(`\nunit-legends-format: ${passed} passed`);
