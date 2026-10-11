// Unit checks for src/render/quality.js (+ the shared blob shadows of src/render/shadows.js, R#5) in Node.
// Run: node test/unit-quality.mjs
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {
  TIERS, RUNGS, TOP_RUNG, BUDGETS, classifyRenderer, detectStatic, cadenceTarget, QualityMonitor, DECISION,
  tierOfRung, rungDpr, trackTexture, untrackTexture, texMB, createQuality, TARGET_60, TARGET_30, parseQualityParam,
} from '../src/render/quality.js';
import { sharedBlob, BlobShadows } from '../src/render/shadows.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

// ---- static detection (§7.2): one renderer string per row of the table ----
const ROWS = [
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software', 2, 2],
  ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software', 2, 2],
  ['Microsoft Basic Render Driver', 'software', 2, 2],
  ['Mali-400 MP', 'low', 2, 3],
  ['Mali-T830', 'low', 2, 3],
  ['Mali-G31 MC2', 'low', 2, 3],
  ['Mali-G51', 'low', 2, 3],
  ['Mali-G52 MC2', 'low', 2, 3],
  ['Mali-G71 MP2', 'low', 2, 3],
  ['Mali-G72 MP3', 'low', 2, 3],
  ['Adreno (TM) 306', 'low', 2, 3],
  ['Adreno (TM) 420', 'low', 2, 3],
  ['Adreno (TM) 505', 'low', 2, 3],
  ['Adreno (TM) 512', 'low', 2, 3],
  ['Adreno (TM) 610', 'low', 2, 3],
  ['Adreno (TM) 619', 'low', 2, 3],
  ['PowerVR Rogue GE8320', 'low', 2, 3],
  ['Mali-G57 MC2', 'mid', 4, 4],
  ['Mali-G68 MC4', 'mid', 4, 4],
  ['Mali-G76 MP10', 'mid', 4, 4],
  ['Mali-G77 MC9', 'mid', 4, 4],
  ['Adreno (TM) 620', 'mid', 4, 4],
  ['Adreno (TM) 650', 'mid', 4, 4],
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'mid', 4, 4],
  ['ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'mid', 4, 4],
  ['Mali-G78 MP14', 'upper', 4, 6],
  ['Mali-G610 MC6', 'upper', 4, 6],
  ['Mali-G710 MC10', 'upper', 4, 6],
  ['Immortalis-G715', 'upper', 4, 6],
  ['Adreno (TM) 660', 'upper', 4, 6],
  ['Adreno (TM) 690', 'upper', 4, 6],
  ['Adreno (TM) 730', 'upper', 4, 6],
  ['Adreno (TM) 840', 'upper', 4, 6],
  ['Samsung Xclipse 920', 'upper', 4, 6],
  ['Apple GPU', 'apple-mobile', 4, 6],
  ['Apple M1 Pro', 'desktop', 6, 6],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'desktop', 6, 6],
  ['AMD Radeon Pro 5500M', 'desktop', 6, 6],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'desktop', 6, 6],
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'desktop', 6, 6],
  ['Some Future GPU 9000', 'unknown', 4, 5],
];

check('every renderer-string row of §7.2 → class / start / cap', () => {
  for (const [s, cls, start, cap] of ROWS) {
    const c = classifyRenderer(s, false);
    assert.deepEqual([c.cls, c.start, c.cap], [cls, start, cap], s);
  }
  // `arc` counts as desktop only on non-touch devices; on touch it falls through to unknown.
  assert.equal(classifyRenderer('Intel(R) Arc(TM) A350M', true).cls, 'unknown');
  // Words containing "arc" are not Intel Arc.
  assert.equal(classifyRenderer('Research GPU', false).cls, 'unknown');
});

check('memory / core caps, fill-rate rule, ?quality= override', () => {
  const nv = 'NVIDIA GeForce GTX 1080';
  assert.deepEqual(pick(detectStatic(nv, { deviceMemory: 8, hardwareConcurrency: 8 }, { width: 1920, height: 1080, devicePixelRatio: 1 })), [6, 6]);
  assert.deepEqual(pick(detectStatic(nv, { deviceMemory: 2, hardwareConcurrency: 8 }, {})), [2, 2]);
  assert.deepEqual(pick(detectStatic(nv, { deviceMemory: 4, hardwareConcurrency: 8 }, {})), [4, 4]);
  assert.deepEqual(pick(detectStatic(nv, { deviceMemory: 8, hardwareConcurrency: 2 }, {})), [2, 2]);
  assert.deepEqual(pick(detectStatic(nv, { deviceMemory: 8, hardwareConcurrency: 4 }, {})), [4, 4]);
  // Touch, > 3.2 Mpx, class ≤ mid → start ≤ 3.
  const big = { width: 412, height: 915, devicePixelRatio: 3.5 };          // 4.6 Mpx
  assert.deepEqual(pick(detectStatic('Mali-G57 MC2', { maxTouchPoints: 5, hardwareConcurrency: 8 }, big)), [3, 4]);
  assert.deepEqual(pick(detectStatic('Mali-G78 MP14', { maxTouchPoints: 5, hardwareConcurrency: 8 }, big)), [4, 6]); // upper: rule n/a
  assert.deepEqual(pick(detectStatic('Mali-G57 MC2', { maxTouchPoints: 5, hardwareConcurrency: 8 }, { width: 360, height: 640, devicePixelRatio: 2 })), [4, 4]);
  // SwiftShader under iPhone emulation (B23): rung 2.
  const ss = detectStatic(ROWS[0][0], { maxTouchPoints: 5, hardwareConcurrency: 4 }, { width: 390, height: 844, devicePixelRatio: 3 });
  assert.equal(ss.startRung, 2);
  assert.equal(ss.touch, true);
  // Forced tier: top rung, cap = top rung.
  for (const t of ['low', 'medium', 'high']) {
    const d = detectStatic(ROWS[0][0], {}, {}, '?quality=' + t);
    assert.deepEqual([d.startRung, d.capRung, d.forced], [TOP_RUNG[t], TOP_RUNG[t], t]);
  }
  assert.equal(parseQualityParam('?quality=ultra'), null);
});

function pick(d) { return [d.startRung, d.capRung]; }

check('ladder, tiers and budgets tables', () => {
  assert.deepEqual(RUNGS.map((r) => r.touch), [0.85, 1.0, 1.25, 1.5, 1.75, 2.0]);
  assert.deepEqual(RUNGS.map((r) => r.desktop), [1.0, 1.0, 1.25, 1.5, 1.75, 2.0]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(tierOfRung), ['low', 'low', 'medium', 'medium', 'high', 'high']);
  assert.equal(rungDpr(1, true), 0.85);
  assert.deepEqual([TIERS.low.crowd.count, TIERS.medium.crowd.count, TIERS.high.crowd.count], [700, 1600, 2600]);
  assert.deepEqual([TIERS.low.shadows.map, TIERS.medium.shadows.mapSize, TIERS.high.shadows.mapSize], [false, 1024, 2048]);
  assert.deepEqual([TIERS.low.env.size, TIERS.medium.env.size, TIERS.high.env.size], [0, 128, 256]);
  assert.deepEqual([TIERS.low.floor.markings, TIERS.medium.floor.markings], [[1024, 816], [2048, 1632]]);
  assert.deepEqual([TIERS.low.net.strands, TIERS.low.net.rings, TIERS.medium.net.substeps], [12, 5, 2]);
  assert.equal(TIERS.high.floor.reflection, true);
  assert.equal(TIERS.medium.floor.reflection, false);
  assert.deepEqual([BUDGETS.low.calls, BUDGETS.medium.tris, BUDGETS.highTouch.texMB], [48, 190000, 230]);
  assert.ok(Object.isFrozen(TIERS.low.crowd));
});

check('cadence target (§7.3): 8.3 → 16.67, 16.6 → 16.67, 33 → 33.33; a busy loading probe (24 / 45 / 120 ms) → 16.67', () => {
  assert.equal(cadenceTarget(8.3), TARGET_60);
  assert.equal(cadenceTarget(16.6), TARGET_60);
  assert.equal(cadenceTarget(33), TARGET_30);
  for (const busy of [24, 45, 120]) assert.equal(cadenceTarget(busy), TARGET_60, `probe ${busy} ms is not a display cadence`);
});

// Feed `seconds` of constant intervals; returns the decisions seen.
function feed(m, ms, seconds, gate) {
  const out = [];
  const n = Math.round((seconds * 1000) / ms);
  for (let i = 0; i < n; i++) {
    const d = m.judge(ms, gate);
    if (d !== DECISION.NONE) out.push(d);
  }
  return out;
}
const LIVE = { judged: true, busyMs: 9 };

check('judge gate: frames with a menu / replay / intro (judged=false) never demote; resuming waits 2.0 s', () => {
  const m = new QualityMonitor({ startRung: 4, capRung: 6 });
  assert.deepEqual(feed(m, 60, 10, { judged: false }), []);
  assert.equal(m.rung, 4);
  // Menu closes: the first 2.0 s of slow judged frames are ignored, then 3.0 s of them demote.
  assert.deepEqual(feed(m, 60, 1.9, LIVE), []);
  assert.equal(m.rung, 4);
});

check('synthetic 3 s of 26 ms frames in LIVE at target 16.7 demotes exactly one rung', () => {
  const m = new QualityMonitor({ startRung: 4, capRung: 6 });
  m.judge(16.7, { judged: false });
  const d = feed(m, 26, 2.0 + 3.0 + 0.05, LIVE);    // holdoff + 3 s window
  assert.deepEqual(d, [DECISION.DEMOTE]);
  assert.equal(m.rung, 3);
});

check('an exact 30 Hz stream (1000/30 ms) at a 16.6 ms target never takes the 2.0 s severe demotion before the cadence rule', () => {
  const m = new QualityMonitor({ startRung: 2, capRung: 6, target: 16.6 });
  const d = feed(m, 1000 / 30, 2.0 + 3.0 + 0.1, { judged: true, busyMs: 1 });
  assert.deepEqual(d, [DECISION.RETARGET]);
  assert.equal(m.rung, 2); assert.equal(m.halfRate, false);
});

check('synthetic 33 ms vsync-locked cadence with light busy time re-targets instead of demoting (R#3)', () => {
  const m = new QualityMonitor({ startRung: 4, capRung: 6 });
  const d = feed(m, 33.3, 2.0 + 3.0 + 0.1, { judged: true, busyMs: 6 });
  assert.deepEqual(d, [DECISION.RETARGET]);
  assert.equal(m.rung, 4);
  assert.ok(Math.abs(m.target - TARGET_30) < 1e-9);
  // Keeps running at 33.3 ms: no demotion at the 33.3 target.
  assert.deepEqual(feed(m, 33.3, 8, { judged: true, busyMs: 6 }), []);
  // Then 16.7 ms intervals return the target to 16.67 (no rung change).
  const back = feed(m, 16.7, 2.0 + 3.0 + 0.1, { judged: true, busyMs: 6 });
  assert.equal(back[0], DECISION.RETARGET);
  assert.ok(Math.abs(m.target - TARGET_60) < 1e-9);
  assert.equal(m.rung, 4);
  assert.equal(m.changes, 0);              // a cadence switch never counts toward the 4-change limit
});

check('33 ms frames with a busy main thread are a slow device: demote', () => {
  const m = new QualityMonitor({ startRung: 4, capRung: 6 });
  const d = feed(m, 33.3, 2.0 + 3.0 + 0.1, { judged: true, busyMs: 14 });
  assert.ok(d.includes(DECISION.DEMOTE));
});

check('severe slowness (mean > 2× for 2.0 s) demotes before the 3 s window', () => {
  const m = new QualityMonitor({ startRung: 6, capRung: 6 });
  const d = feed(m, 40, 2.0 + 2.05, LIVE);
  assert.deepEqual(d, [DECISION.DEMOTE]);
  assert.equal(m.rung, 5);
});

check('p90 rule: mean under 1.30× but 1 frame in 8 at 45 ms (> 1.80×) demotes once', () => {
  const m = new QualityMonitor({ startRung: 4, capRung: 6 });
  let dem = 0, t = 0, i = 0;
  while (t < 5150) { const ms = i++ % 8 === 0 ? 45 : 16.7; t += ms; if (m.judge(ms, LIVE) === DECISION.DEMOTE) dem++; }
  assert.equal(dem, 1);
  // Same stream with only 1 frame in 20 slow: p90 is fine → no change.
  const k = new QualityMonitor({ startRung: 4, capRung: 6 });
  let d2 = 0; t = 0; i = 0;
  while (t < 8000) { const ms = i++ % 20 === 0 ? 45 : 16.7; t += ms; if (k.judge(ms, LIVE) !== DECISION.NONE) d2++; }
  assert.equal(d2, 0);
});

check('promotion: 10 s clean, ≤ cap, never back to a rung demoted from, ≤ 2 promotions', () => {
  const m = new QualityMonitor({ startRung: 2, capRung: 5 });
  assert.deepEqual(feed(m, 16.7, 2.0 + 10.05, LIVE), [DECISION.PROMOTE]);
  assert.equal(m.rung, 3);
  assert.deepEqual(feed(m, 16.7, 2.0 + 10.05, LIVE), [DECISION.PROMOTE]);
  assert.equal(m.rung, 4);
  assert.deepEqual(feed(m, 16.7, 30, LIVE), []);          // 2 promotions used
  assert.equal(m.rung, 4);
  const c = new QualityMonitor({ startRung: 5, capRung: 5 });
  assert.deepEqual(feed(c, 16.7, 20, LIVE), []);          // at the cap
  const d = new QualityMonitor({ startRung: 4, capRung: 6 });
  feed(d, 26, 5.1, LIVE);                                 // demoted 4 → 3
  assert.equal(d.rung, 3);
  assert.deepEqual(feed(d, 16.7, 30, LIVE), []);          // never promoted back to 4
});

check('max 4 changes then lock; below rung 1 → 30 Hz mode', () => {
  const m = new QualityMonitor({ startRung: 4, capRung: 6 });
  const all = feed(m, 30, 60, LIVE);
  assert.deepEqual(all, [DECISION.DEMOTE, DECISION.DEMOTE, DECISION.DEMOTE, DECISION.HALF_RATE]);
  assert.equal(m.rung, 1);
  assert.equal(m.halfRate, true);
  assert.equal(m.locked, true);
  assert.deepEqual(feed(m, 60, 20, LIVE), []);
});

check('createQuality: forced tier, DPR per rung, pending tier applied at commit, history, onTierChange', () => {
  const st = detectStatic(ROWS[0][0], {}, {}, '');
  const q = createQuality({ static: st, url: '?quality=high', devicePixelRatio: 3 });
  assert.deepEqual([q.tier, q.rung, q.dpr, q.auto], ['high', 6, 2, false]);
  const q2 = createQuality({ static: detectStatic('Mali-G57', {}, {}, ''), devicePixelRatio: 3 });
  assert.deepEqual([q2.tier, q2.rung, q2.dpr, q2.auto], ['medium', 4, 1.5, true]);
  let seen = null;
  q2.onTierChange((nt, ot) => { seen = [nt, ot]; });
  // Drive 3 demotions through frame(): 4 → 3 (DPR only), 3 → 2 (tier change pending until commit).
  let now = 0;
  q2.frame(now, { judged: false });
  for (let i = 0; i < 1200; i++) { now += 40; q2.frame(now, { judged: true, busyMs: 30 }); }
  assert.ok(q2.rung <= 2, 'rung ' + q2.rung);
  assert.equal(q2.tier, 'medium');
  assert.equal(q2.pendingTier, 'low');
  assert.equal(q2.commitPendingTier(), 'low');
  assert.deepEqual(seen, ['low', 'medium']);
  assert.equal(q2.loadTier, 'medium');             // texture sizes stay those of the load tier
  assert.ok(q2.history.length >= 2 && q2.history[0].reason === 'demote');
  assert.ok(q2.history.every((h) => typeof h.t === 'number' && 'from' in h && 'to' in h));
  // Settings choice forces a tier and reports the reload note.
  const r = q2.setManual('high');
  assert.deepEqual([q2.rung, q2.auto, r.reloadNote, q2.pendingTier], [6, false, true, 'high']);
});

check('30 Hz mode renders every 2nd rAF; 120 Hz panels capped at 60 fps', () => {
  const q = createQuality({ static: detectStatic('Mali-G57', {}, {}, ''), devicePixelRatio: 1 });
  q.setCadence(8.33);
  assert.equal(q.target, TARGET_60);
  let rendered = 0;
  for (let i = 0; i < 120; i++) if (q.frame(i * 8.333, { judged: false })) rendered++;
  assert.ok(rendered >= 58 && rendered <= 62, 'rendered ' + rendered);
  const h = createQuality({ static: detectStatic('Mali-G57', {}, {}, ''), devicePixelRatio: 1 });
  h.halfRate = true;
  let r2 = 0;
  for (let i = 0; i < 60; i++) if (h.frame(i * 16.67, { judged: false })) r2++;
  assert.equal(r2, 30);
});

check('texture ledger: Σ w·h·bpp·(mip ? 1.333 : 1); dispose untracks', () => {
  const base = texMB();
  const t = new THREE.DataTexture(new Uint8Array(1024 * 1024 * 4), 1024, 1024);
  trackTexture(t, 4, true);
  assert.ok(Math.abs(texMB() - base - 4 * 1.333) < 1e-9);
  trackTexture(t, 4, false);                      // re-tracking replaces the entry
  assert.ok(Math.abs(texMB() - base - 4) < 1e-9);
  t.dispose();
  assert.ok(Math.abs(texMB() - base) < 1e-9);
  const rt = new THREE.WebGLRenderTarget(512, 256);
  trackTexture(rt, 8, false);
  assert.ok(Math.abs(texMB() - base - 1) < 1e-9);
  untrackTexture(rt);
  assert.ok(Math.abs(texMB() - base) < 1e-9);
});

check('shadows.js: one blob texture + one geometry shared by all 7 instanced blobs (R#5)', () => {
  const a = sharedBlob(), b = sharedBlob();
  assert.equal(a.texture, b.texture);
  assert.equal(a.geometry, b.geometry);
  const scene = new THREE.Scene();
  const blobs = new BlobShadows(scene, 'low');
  const blobs2 = new BlobShadows(null, 'medium');
  assert.equal(blobs.mesh.geometry, a.geometry);
  assert.equal(blobs.material.map, a.texture);
  assert.equal(blobs2.mesh.geometry, a.geometry);
  assert.equal(blobs.mesh.count, 7);
  assert.ok(blobs.mesh.isInstancedMesh);
  assert.equal(blobs.mesh.renderOrder, -1);
  // Opacity in instanceColor.r: low players 0.45, ball 0.5 → 0.15 over 0 → 3 m; medium AO 0.25 / 0.20.
  blobs.setPlayer(0, 1, -5, 0.46, 0, true);
  blobs.setBall(0, 0, -4, true);
  assert.ok(Math.abs(blobs.mesh.instanceColor.getX(0) - 0.45) < 1e-6);
  assert.ok(Math.abs(blobs.mesh.instanceColor.getX(6) - 0.5) < 1e-6);
  blobs.setBall(0, 3, -4, true);
  assert.ok(Math.abs(blobs.mesh.instanceColor.getX(6) - 0.15) < 1e-6);
  blobs.setPlayer(1, 0, 0, 0.5, 0, false);
  assert.equal(blobs.mesh.instanceColor.getX(1), 0);
  blobs2.setPlayer(0, 1, -5, 0.46, 0, true);
  assert.ok(Math.abs(blobs2.mesh.instanceColor.getX(0) - 0.25) < 1e-6);
  // Player blob size 0.95·(sj/0.46) × 0.80 of that.
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  blobs.setPlayer(2, 0, 0, 0.92, 0, true);
  blobs.mesh.getMatrixAt(2, m);
  m.decompose(p, q, s);
  assert.ok(Math.abs(s.x - 1.9) < 1e-6 && Math.abs(s.z - 1.52) < 1e-6);
});

console.log(`\n${passed} checks passed`);
