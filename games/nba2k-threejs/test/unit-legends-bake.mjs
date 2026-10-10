/**
 * unit-legends-bake.mjs — WP1 bake pipeline tests (SPEC-v2 §3.1, §8.6).
 *
 *   node test/unit-legends-bake.mjs
 *
 * 1. Pure library checks (always): PNG writer round trip + CRC, UV rasteriser coverage / top-left rule, landmark
 *    mirror symmetry, likeness band checker.
 * 2. Committed assets (always): format v2 header structure, every section inside its file, indices and shell
 *    references in range, morph targets (> 50 vertices, |Δ| < 0.06 m), eye radii 0.013–0.019 m, feet 0.27–0.36 m,
 *    per-player groom shells by style (Jordan no hair shell, Yao no beard shell, Kobe/Jordan no full beard), mask
 *    PNGs (RGB colour type 2, no gAMA/iCCP, declared sizes), §3.1 size budgets, `format.js parseHeader` when
 *    WP2's src/legends/format.js exists.
 * 3. Re-bake (only when tools/legends/.cache and meshoptimizer exist): runs bake.mjs into a temp folder, checks the
 *    §8.6 log lines and that every output file is byte-identical to the committed assets (deterministic bake).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = path.join(ROOT, 'tools/legends');
const ASSETS = path.join(ROOT, 'assets/legends');
const imp = (p) => import(pathToFileURL(p).href);
const { encodePngRgb, decodePngRgb, crc32 } = await imp(path.join(TOOLS, 'lib/png.mjs'));
const { sampleMap, evaluate, dilate, toRgbRows } = await imp(path.join(TOOLS, 'lib/uvraster.mjs'));
const { checkLikeness, LIKENESS_BANDS } = await imp(path.join(TOOLS, 'lib/landmarks.mjs'));
const { MASK_BUDGET } = await imp(path.join(TOOLS, 'lib/masks.mjs'));
const { BUDGET } = await imp(path.join(TOOLS, 'bake.mjs'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL', msg); } };
const section = (name) => console.log(`\n# ${name}`);
const KB = 1024;

// ------------------------------------------------------------------------------------------------- 1. libs
section('png.mjs');
{
  ok(crc32(Buffer.from('IEND', 'ascii')) === 0xae426082, 'CRC-32 of "IEND" is ae426082');
  const w = 37, h = 23, rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 7919 + (i >> 3) * 31) & 255;
  const png = encodePngRgb(w, h, rgb);
  const d = decodePngRgb(png);
  ok(d.w === w && d.h === h && Buffer.compare(Buffer.from(d.rgb), Buffer.from(rgb)) === 0, 'PNG round trip is lossless');
  ok(png[25] === 2 && png[24] === 8, 'IHDR colour type 2, depth 8');
  ok(!png.includes(Buffer.from('gAMA')) && !png.includes(Buffer.from('iCCP')), 'no gAMA / iCCP chunks');
}
section('uvraster.mjs');
{
  // two triangles sharing the diagonal of the unit square: every texel covered exactly once
  const uv = new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const map = sampleMap(16, uv, [0, 1, 2, 0, 2, 3], 2);
  ok(map.count === 32 * 32, `top-left rule: ${map.count} samples for 1024 (no double / missing samples on the shared edge)`);
  const verts = { pos: new Float64Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), nrm: new Float64Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]) };
  const { img, covered } = evaluate(map, verts, (p, n, a, out) => { out[0] = p[0]; out[1] = p[1]; out[2] = n[2]; }, 3);
  let maxErr = 0;
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const k = j * 16 + i; maxErr = Math.max(maxErr, Math.abs(img[k * 3] - (i + 0.5) / 16), Math.abs(img[k * 3 + 1] - (j + 0.5) / 16)); }
  ok(maxErr < 1e-6, `barycentric interpolation reproduces position (max err ${maxErr.toExponential(1)})`);
  ok(covered.every((c) => c === 1), 'full coverage');
  // one small triangle in a 16² map → dilation fills 2 px around it
  const m2 = sampleMap(16, new Float64Array([0.4, 0.4, 0.6, 0.4, 0.5, 0.6]), [0, 1, 2], 1);
  const r2 = evaluate(m2, { pos: new Float64Array(9), nrm: new Float64Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) }, (p, n, a, out) => { out[0] = 1; }, 3);
  const before = r2.covered.reduce((s, c) => s + c, 0);
  dilate(r2.img, r2.covered, 16, 3, 2);
  const after = r2.covered.reduce((s, c) => s + c, 0);
  ok(after > before && r2.img[(8 * 16 + 5) * 3] === 1 && r2.img[(8 * 16 + 3) * 3] === 0, `dilation grows coverage (${before} → ${after}) with the edge value`);
  const rows = toRgbRows(r2.img, 16, 3);
  ok(rows[((15 - 8) * 16 + 8) * 3] === 255, 'row 0 of the PNG is v = 1 (flipped rows)');
}
section('landmarks.mjs');
{
  const m = { kobe: { faceLW: 0.82, chinProj: 4, earOut: 15, fissH: 6.3, lipsH: 27, noseIcd: 1.45 }, jordan: { faceLW: 0.81, chinProj: -3, earOut: 28, fissH: 6.1, lipsH: 29, noseIcd: 1.55 },
    lebron: { faceLW: 0.76, chinProj: -3, earOut: 8, fissH: 6.3, lipsH: 30, noseIcd: 1.56 }, giannis: { faceLW: 0.88, chinProj: -2, earOut: 22, fissH: 6.8, lipsH: 30, noseIcd: 1.50 },
    yao: { faceLW: 0.89, chinProj: -3, earOut: 25, fissH: 5.8, lipsH: 26, noseIcd: 1.42 }, kyrie: { faceLW: 0.80, chinProj: -4, earOut: 9, fissH: 6.2, lipsH: 29, noseIcd: 1.43 } };
  ok(checkLikeness(m).length === 0, 'a face set inside every band and ordering passes');
  ok(checkLikeness({ ...m, kobe: { ...m.kobe, chinProj: -1 } }).length === 2, 'Kobe chinProj -1 fails its band and the "Kobe max by 3 mm" ordering');
  ok(Object.keys(LIKENESS_BANDS).length === 5, 'five banded metrics (noseIcd is ordering only)');
}

// ------------------------------------------------------------------------------------------ 2. committed
section('committed assets (format v2)');
const H = JSON.parse(fs.readFileSync(path.join(ASSETS, 'legends.json'), 'utf8'));
const shared = fs.readFileSync(path.join(ASSETS, H.shared.file));
const TYPES = { u8: Uint8Array, u8n: Uint8Array, 'u8n*4': Uint8Array, 'u8n*0.1m': Uint8Array, u16: Uint16Array, 'u16n*2': Uint16Array, u16q: Uint16Array, oct8: Int8Array, i16q: Int16Array };
const view = (buf, table, name) => {
  const s = table[name];
  if (!s) throw new Error(`no section ${name}`);
  const T = TYPES[s.type];
  return new T(buf.buffer, buf.byteOffset + s.offset, s.count * s.itemSize);
};
ok(H.format === 'legends-mesh' && H.version === 2 && !H.devOnly, 'header format legends-mesh version 2, not devOnly');
ok(H.players.length === 6 && H.players.map((p) => p.id).join() === 'kobe,jordan,lebron,giannis,yao,kyrie', 'six players in header order');
ok(H.bones.length === 53, '53 bones');
ok(H.morphNames.join() === 'jawOpen,tongueOut,jawJut,roar,grin,smirk,scowl,puff,blink', 'morphNames = the 9 channels of §3.9');
ok(H.shared.groups.map((g) => g.name).join() === 'body,wet' && H.lods.length === 3, 'groups body + wet; LOD1–3');
const sectionsFit = (buf, table) => Object.values(table).every((s) => s.offset % 4 === 0 && s.offset + s.bytes <= buf.length && s.bytes === s.count * s.itemSize * TYPES[s.type].BYTES_PER_ELEMENT);
ok(sectionsFit(shared, H.shared.sections), 'every shared section is aligned and inside the shared bin');
const nR = H.counts.renderVertices, nK = H.counts.keptVertices;
const r2k = view(shared, H.shared.sections, 'renderToKept');
ok(r2k.length === nR && r2k.every((k) => k < nK), 'renderToKept in range');
const idxOk = (name) => view(shared, H.shared.sections, name).every((i) => i < nR);
ok(idxOk('index') && idxOk('eyeLow.index') && H.lods.every((l) => idxOk(l.section)), 'every body/wet/LOD index < renderVertices');
ok(view(shared, H.shared.sections, 'eyeLow.index').length / 3 === 336 && H.shared.wetParts.eyes[1] / 3 === 1440, 'eyes: 2 × 720 tris (24×16), low 2 × 168 (12×8)');
const sw = view(shared, H.shared.sections, 'skinWeight');
let wsOk = true; for (let k = 0; k < nK; k++) if (sw[k * 4] + sw[k * 4 + 1] + sw[k * 4 + 2] + sw[k * 4 + 3] !== 255) { wsOk = false; break; }
ok(wsOk, 'skin weights sum to 255 per kept vertex');
const checkShell = (sh, buf, table, label) => {
  const A = view(buf, table, sh.sections.a), B = view(buf, table, sh.sections.b), I = view(buf, table, sh.sections.index);
  ok(A.length === sh.vertexCount && A.every((k) => k < nK) && B.every((k) => k < nK), `${label}: a/b < keptVertices`);
  ok(I.length === sh.triCount * 3 && sh.triCount > 0 && I.every((i) => i < sh.vertexCount), `${label}: ${sh.triCount} tris, indices < vertexCount`);
  if (sh.lods) ok(view(buf, table, sh.lods[0].section).every((i) => i < sh.vertexCount), `${label}: LOD1 indices in range`);
  ok(Array.isArray(sh.uvRange) && sh.uvRange[2] >= sh.uvRange[0] && sh.uvRange[3] >= sh.uvRange[1], `${label}: uvRange`);
  if (sh.groom) ok(view(buf, table, sh.groom.density).length === sh.vertexCount && view(buf, table, sh.groom.fade).length === sh.vertexCount, `${label}: groom density/fade per vertex`);
};
for (const sh of H.shells) checkShell(sh, shared, H.shared.sections, `shared shell ${sh.name}`);
const need = ['jersey', 'shorts', 'socks_low', 'socks_crew', 'socks_mid', 'socks_high', 'sleeve_r', 'tape_r_im', 'wristband_l', 'headband_high', 'headband_low', 'lashes'];
ok(need.every((n) => H.shells.some((s) => s.name === n)), 'shared shells: jersey, shorts, 4 socks, sleeve, tape, wristband, 2 headbands, lashes');
const jersey = H.shells.find((s) => s.name === 'jersey');
ok(jersey.loops.some((l) => l.kind === 'neck') && jersey.loops.some((l) => l.kind === 'armhole_l') && jersey.loops.some((l) => l.kind === 'armhole_r') && jersey.loops.some((l) => l.kind === 'hem'), 'jersey loops: neck, armhole_l/r, hem');
ok(jersey.uvRange[1] >= -0.001 && jersey.relax && jersey.relax.pinBelowV > 0, 'jersey tucked: local v from the hem (pelvis + 0.03), relax pinned at the bottom');
ok(H.shells.find((s) => s.name === 'shorts').loops.filter((l) => l.kind.startsWith('leg_')).length === 2, 'shorts loops: waist + leg_l/r');

const BEARD = { kobe: 'partial', jordan: 'partial', lebron: 'full', giannis: 'full', yao: 'none', kyrie: 'full' };
for (const p of H.players) {
  const buf = fs.readFileSync(path.join(ASSETS, p.file));
  ok(sectionsFit(buf, p.sections), `${p.id}: sections inside ${p.file}`);
  ok(p.eyes.l.r >= 0.013 && p.eyes.l.r <= 0.019 && p.eyes.r.r >= 0.013 && p.eyes.r.r <= 0.019, `${p.id}: eye radii ${p.eyes.l.r} m in 0.013–0.019`);
  ok(['l', 'r'].every((s) => p.feet[s].length >= 0.27 && p.feet[s].length <= 0.36), `${p.id}: foot length ${p.feet.l.length} m in 0.27–0.36`);
  ok(Math.abs(p.dims.heightBarefoot - p.meta.stats.barefootM) < 0.005, `${p.id}: barefoot height ${p.dims.heightBarefoot} ≈ ${p.meta.stats.barefootM}`);
  const mi = view(buf, p.sections, p.morphs.sections.index), md = view(buf, p.sections, p.morphs.sections.delta);
  for (const t of p.morphs.targets) {
    let maxAbs = 0;
    for (let i = 0; i < t.count; i++) { const o = (t.offset + i) * 3; maxAbs = Math.max(maxAbs, Math.hypot(md[o], md[o + 1], md[o + 2]) * p.morphs.step); }
    const inRange = Array.from(mi.subarray(t.offset, t.offset + t.count)).every((k) => k < nK);
    ok(t.count > 50 && maxAbs < 0.06 && inRange, `${p.id} morph ${t.name}: ${t.count} vertices, max |Δ| ${(maxAbs * 1000).toFixed(1)} mm`);
  }
  ok(['jawOpen', 'scowl', 'blink'].every((n) => p.morphs.targets.some((t) => t.name === n)), `${p.id}: jawOpen, scowl, blink baked`);
  for (const sh of p.shells) checkShell(sh, buf, p.sections, `${p.id} shell ${sh.name}`);
  const names = p.shells.map((s) => s.name);
  ok(names.includes('brows'), `${p.id}: brows shell`);
  ok((p.id === 'jordan') === !names.includes('hair_inner'), `${p.id}: hair shell ${p.id === 'jordan' ? 'absent (bald)' : 'present'}`);
  if (BEARD[p.id] === 'none') ok(!names.some((n) => n.startsWith('beard')), `${p.id}: no beard shell`);
  if (BEARD[p.id] === 'partial') ok(names.includes('beard_inner') && !names.includes('beard_outer'), `${p.id}: moustache-goatee (no full-beard outer layer)`);
  if (BEARD[p.id] === 'full') ok(names.includes('beard_inner') && names.includes('beard_outer'), `${p.id}: full / short-full beard (inner + outer)`);
  ok(Object.keys(p.covers).length === 4 && Object.values(p.covers).every((c) => view(buf, p.sections, c).every((k) => k < nK)), `${p.id}: 4 shoeCover lists in range`);
  ok(p.bytes <= BUDGET.player, `${p.id}: ${(p.bytes / KB).toFixed(1)} KB ≤ 300 KB`);
}
{
  const kobe = H.players.find((p) => p.id === 'kobe'), lebron = H.players.find((p) => p.id === 'lebron');
  const tri = (p, n) => (p.shells.find((s) => s.name === n) || { triCount: 0 }).triCount;
  ok(tri(kobe, 'beard_inner') < tri(lebron, 'beard_inner'), 'Kobe beard area < LeBron full beard');
}
section('masks + budgets');
const pngInfo = (f) => { const b = fs.readFileSync(path.join(ASSETS, f)); return { bytes: b.length, w: b.readUInt32BE(16), h: b.readUInt32BE(20), ct: b[25], gama: b.includes(Buffer.from('gAMA')) || b.includes(Buffer.from('iCCP')) }; };
let total = fs.statSync(path.join(ASSETS, 'legends.json')).size + shared.length;
for (const p of H.players) total += p.bytes;
const pngs = [...Object.entries(H.masks).map(([k, m]) => [k, m]), ...H.players.flatMap((p) => Object.entries(p.masks))];
ok(pngs.length === 15, '15 mask PNGs declared');
for (const [kind, m] of pngs) {
  const i = pngInfo(m.file);
  total += i.bytes;
  ok(i.w === m.size && i.h === m.size && i.ct === 2 && !i.gama, `${m.file}: ${m.size}² RGB, no gAMA/iCCP`);
  ok(i.bytes <= MASK_BUDGET[kind], `${m.file}: ${(i.bytes / KB).toFixed(1)} KB ≤ ${MASK_BUDGET[kind] / KB} KB`);
}
ok(fs.statSync(path.join(ASSETS, 'legends.json')).size <= BUDGET.header, 'legends.json ≤ 140 KB');
ok(shared.length <= BUDGET.shared, `shared bin ${(shared.length / KB).toFixed(1)} KB ≤ 800 KB`);
ok(total <= BUDGET.total, `total ${(total / 1048576).toFixed(3)} MB ≤ 3.5 MB`);
ok(fs.existsSync(path.join(ASSETS, 'README.md')), 'assets/legends/README.md (provenance + fan-project note)');

const formatJs = path.join(ROOT, 'src/legends/format.js');
if (fs.existsSync(formatJs)) {
  section('src/legends/format.js parseHeader');
  try {
    const fmt = await imp(formatJs);
    fmt.parseHeader(H);
    ok(true, 'parseHeader accepts the header');
  } catch (e) { ok(false, `parseHeader: ${e.message}`); }
} else console.log('\n# src/legends/format.js not present yet (WP2): parseHeader check skipped');

// --------------------------------------------------------------------------------------------- 3. re-bake
const haveCache = fs.existsSync(path.join(TOOLS, '.cache'));
let haveMeshopt = false;
try { await import(pathToFileURL(path.join(TOOLS, 'node_modules/meshoptimizer/index.js')).href); haveMeshopt = true; } catch { /* optional dev dependency */ }
if (!haveCache || !haveMeshopt) {
  console.log(`\n# re-bake skipped (${!haveCache ? 'tools/legends/.cache absent' : 'meshoptimizer not installed'})`);
} else {
  section('re-bake (§8.6 log checks, deterministic output)');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'legends-bake-'));
  try {
    const r = spawnSync(process.execPath, [path.join(TOOLS, 'bake.mjs'), path.join(TOOLS, 'legends.config.json'), '--out', out], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const log = r.stdout + r.stderr;
    ok(r.status === 0, `bake exits 0${r.status ? `: ${log.slice(-400)}` : ''}`);
    ok(/rig check .* = 0\.00 mm/.test(log), 'log: rig check 0.00 mm');
    ok(/^players: 6$/m.test(log), 'log: players: 6');
    const shellLines = [...log.matchAll(/^player (\w+) shell (\w+): (\d+) vertices, (\d+) triangles/gm)];
    ok(shellLines.length >= 20 && shellLines.every((m) => +m[3] > 0 && +m[4] > 0), `log: ${shellLines.length} per-player shells, all non-empty`);
    ok(!shellLines.some((m) => m[1] === 'jordan' && m[2].startsWith('hair')) && !shellLines.some((m) => m[1] === 'yao' && m[2].startsWith('beard')), 'log: Jordan no hair shell, Yao no beard shell');
    const morphLines = [...log.matchAll(/^player (\w+) morph (\w+): (\d+) vertices, max \|delta\| ([\d.]+) mm/gm)];
    ok(morphLines.length >= 25 && morphLines.every((m) => +m[3] > 50 && +m[4] < 60), `log: ${morphLines.length} morph targets, each > 50 vertices and < 60 mm`);
    const maskLines = [...log.matchAll(/^mask (\S+): .* within budget/gm)];
    ok(maskLines.length === 15, `log: 15 masks within budget (${maskLines.length})`);
    ok(/^budget total: .* ok$/m.test(log) && !/OVER/.test(log), 'log: every size budget ok');
    const hash = (dir) => Object.fromEntries(fs.readdirSync(dir).filter((f) => f.startsWith('legends.')).sort().map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]));
    const a = hash(out), b = hash(ASSETS);
    const diff = Object.keys({ ...a, ...b }).filter((f) => a[f] !== b[f]);
    ok(diff.length === 0, `deterministic re-bake: output identical to the committed assets${diff.length ? ` (differs: ${diff.join(', ')})` : ''}`);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
