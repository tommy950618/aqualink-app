// Unit checks for court.js and scene.js in Node (no DOM, no WebGL).
// Run: node test/unit-court.mjs
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { worldToPx, drawCourtCanvas, buildCourt } from '../src/court.js';
import { createScene, buildArena, makeCanvasTexture, makeBlobTexture, makeBallTexture, PerfMonitor } from '../src/scene.js';
import { RIM, COURT, COLORS, LINES } from '../src/constants.js';
import { Rng } from '../src/math.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

// A 2D-context stand-in that records every call and tracks the current transform.
function recordingCtx() {
  const calls = [];
  const state = { transform: [1, 0, 0, 1, 0, 0] };
  const target = {
    calls, state,
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '', font: '', textAlign: '', textBaseline: '',
    measureText: (s) => ({ width: s.length * 20 }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => {
        if (k === 'setTransform') t.state.transform = args.slice();
        calls.push({ name: k, args, transform: t.state.transform.slice() });
      };
    },
  });
}
function applyTransform(m, x, y) {
  return { px: m[0] * x + m[2] * y + m[4], py: m[1] * x + m[3] * y + m[5] };
}

check('worldToPx maps the centre logo to (512, 965) and the rim inside the canvas', () => {
  const c = worldToPx(0, 0);
  assert.equal(c.px, 512);
  assert.ok(Math.abs(c.py - 965) <= 1, 'py=' + c.py);
  const r = worldToPx(RIM.x, RIM.z);
  assert.ok(r.px > 0 && r.px < 1024 && r.py > 0 && r.py < 1024);
  assert.ok(r.py < c.py, 'hoop side (world -z) is nearer the top of the canvas');
  const far = worldToPx(COURT.PLANE_MIN_X, COURT.PLANE_MIN_Z);
  assert.deepEqual([far.px, far.py], [0, 0]);
  const out = { px: 9, py: 9 };
  assert.equal(worldToPx(1, 1, out), out);
});

check('drawCourtCanvas paints in world metres through a transform consistent with worldToPx', () => {
  const ctx = recordingCtx();
  drawCourtCanvas(ctx, 1024);
  const arcs = ctx.calls.filter((c) => c.name === 'arc');
  const centre = arcs.find((c) => c.args[0] === 0 && c.args[1] === 0 && c.args[2] === LINES.CENTER_R);
  assert.ok(centre, 'centre circle drawn at world (0,0)');
  const p = applyTransform(centre.transform, 0, 0);
  assert.equal(Math.round(p.px), 512);
  assert.equal(Math.round(p.py), 965);
  // Any world point maps to the same pixel through the transform and through worldToPx.
  const q = applyTransform(centre.transform, 3.3, -9.1), w = worldToPx(3.3, -9.1);
  assert.ok(Math.abs(q.px - w.px) < 1e-6 && Math.abs(q.py - w.py) < 1e-6);
  const three = arcs.find((c) => c.args[2] === LINES.THREE_R);
  assert.ok(three && three.args[0] === RIM.x && three.args[1] === RIM.z, '3-pt arc about the rim');
  assert.ok(arcs.some((c) => c.args[2] === LINES.RESTRICTED_R), 'restricted arc');
  assert.equal(arcs.filter((c) => c.args[1] === LINES.FT_Z && c.args[2] === LINES.FT_CIRCLE_R).length, 2, 'FT circle halves');
  const text = ctx.calls.find((c) => c.name === 'fillText');
  assert.ok(text && text.args[1] === 512 && Math.abs(text.args[2] - 965) <= 1, 'logo text at the centre pixel');
  assert.ok(ctx.calls.some((c) => c.name === 'strokeRect' && c.args[0] === -COURT.HALF_W && c.args[1] === COURT.BASELINE_Z));
});

check('buildCourt works headless: plane orientation, hoop parts, net layout', () => {
  const { scene } = createScene();
  const court = buildCourt(scene);
  assert.equal(court.floor.position.z, COURT.PLANE_CENTER_Z);
  // The plane's v=1 edge (canvas row 0) must land at world -z (the hoop side).
  court.floor.updateMatrixWorld(true);
  const pos = court.floor.geometry.getAttribute('position');
  const uv = court.floor.geometry.getAttribute('uv');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(court.floor.matrixWorld);
    if (uv.getY(i) === 1) assert.ok(Math.abs(v.z - COURT.PLANE_MIN_Z) < 1e-6, 'top row at z=' + v.z);
    if (uv.getY(i) === 0) assert.ok(Math.abs(v.z - (COURT.PLANE_MIN_Z + COURT.PLANE_D)) < 1e-6);
    if (uv.getX(i) === 0) assert.ok(Math.abs(v.x - COURT.PLANE_MIN_X) < 1e-6);
    assert.ok(Math.abs(v.y) < 1e-6);
  }
  const h = court.hoop;
  assert.ok(h.group.children.length === 5, '5 hoop meshes');
  assert.deepEqual([h.rim.position.x, h.rim.position.y, h.rim.position.z], [RIM.x, RIM.y, RIM.z]);
  assert.ok(h.net.isLineSegments);
  const np = h.net.geometry.getAttribute('position');
  assert.equal(np.count, 8 * 4 * 2 * 2, '8 strands x 4 levels + 4 rings x 8, two vertices each');
  assert.equal(h.netBase.length, np.count * 3);
  assert.ok(h.netBase instanceof Float32Array && h.netBase !== np.array);
  let minY = Infinity, maxY = -Infinity, minR = Infinity, maxR = 0;
  for (let i = 0; i < np.count; i++) {
    const x = h.netBase[i * 3], y = h.netBase[i * 3 + 1], z = h.netBase[i * 3 + 2];
    const r = Math.hypot(x - RIM.x, z - RIM.z);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  assert.ok(Math.abs(maxY - RIM.y) < 1e-6 && Math.abs(minY - (RIM.y - 0.40)) < 1e-6, 'net spans 0.40 m below the rim');
  assert.ok(Math.abs(maxR - RIM.r) < 1e-6 && Math.abs(minR - 0.12) < 1e-6, 'net tapers 0.2286 -> 0.12');
  assert.equal(h.RIM, RIM);
  assert.ok(h.board.material.transparent && h.board.material.opacity === 0.35);
});

check('animateNet wobbles the lower rings, keeps the rim ring fixed, and restores', () => {
  const { scene } = createScene();
  const court = buildCourt(scene);
  const np = court.hoop.net.geometry.getAttribute('position');
  const base = court.hoop.netBase;
  court.animateNet(0.3);
  let moved = 0;
  for (let i = 0; i < np.count; i++) {
    const dy = np.getY(i) - base[i * 3 + 1];
    if (Math.abs(base[i * 3 + 1] - RIM.y) < 1e-6) assert.ok(Math.abs(dy) < 1e-9, 'rim ring fixed');
    else { assert.ok(dy < 0, 'lower vertices drop'); moved++; }
    assert.ok(Math.abs(dy) <= 0.08 + 1e-9);
  }
  assert.ok(moved > 0 && np.version > 0, 'attribute flagged for upload');
  court.animateNet(0.7);
  for (let i = 0; i < np.count; i++) assert.equal(np.getY(i), base[i * 3 + 1]);
  court.animateNet(-1);
});

check('buildArena: 600 seeded, palette-coloured instances; bob for 1.5 s then restore', () => {
  const build = (seed) => {
    const { scene } = createScene();
    return buildArena(scene, new Rng(seed));
  };
  const a = build(7), b = build(7), c = build(8);
  assert.equal(a.crowd.count, 600);
  assert.equal(a.stands.length, 4);
  assert.equal(a.banners.length, 2);
  assert.ok(a.crowd.instanceColor, 'setColorAt used');
  const palette = COLORS.crowd.map((n) => new THREE.Color(n));
  const col = new THREE.Color();
  for (let i = 0; i < 600; i++) {
    a.crowd.getColorAt(i, col);
    assert.ok(palette.some((p) => Math.abs(p.r - col.r) < 1e-6 && Math.abs(p.g - col.g) < 1e-6 && Math.abs(p.b - col.b) < 1e-6));
  }
  assert.deepEqual(Array.from(a.crowd.instanceMatrix.array), Array.from(b.crowd.instanceMatrix.array), 'seeded determinism');
  assert.notDeepEqual(Array.from(a.crowd.instanceMatrix.array), Array.from(c.crowd.instanceMatrix.array));
  const before = Float32Array.from(a.crowd.instanceMatrix.array);
  a.updateCrowd(0.1);
  assert.deepEqual(Array.from(a.crowd.instanceMatrix.array), Array.from(before), 'no rewrite while idle');
  a.bumpCrowd();
  a.updateCrowd(0.3);
  assert.ok(a.bobbing);
  let raised = 0;
  for (let i = 0; i < 600; i++) {
    const d = a.crowd.instanceMatrix.array[i * 16 + 13] - before[i * 16 + 13];
    assert.ok(d >= 0 && d <= 0.15 + 1e-6);
    if (d > 0.01) raised++;
  }
  assert.ok(raised > 300);
  for (let k = 0; k < 20; k++) a.updateCrowd(0.1);
  assert.ok(!a.bobbing);
  assert.deepEqual(Array.from(a.crowd.instanceMatrix.array), Array.from(before), 'restored after 1.5 s');
});

check('texture helpers are headless-safe and honour an injected canvas factory', () => {
  const t1 = makeBlobTexture(), t2 = makeBallTexture();
  assert.ok(t1.isCanvasTexture && t2.isCanvasTexture);
  assert.equal(t1.colorSpace, THREE.SRGBColorSpace);
  assert.equal(t2.image.width, 256);
  assert.equal(t2.image.height, 128);
  let drawn = 0;
  const factory = (w, h) => ({ width: w, height: h, getContext: () => recordingCtx() });
  const t3 = makeCanvasTexture(32, 16, (ctx, w, h) => { drawn++; assert.equal(w, 32); assert.equal(h, 16); ctx.fillRect(0, 0, w, h); }, factory);
  assert.equal(drawn, 1);
  assert.equal(t3.image.width, 32);
  makeBallTexture(factory);
  makeBlobTexture(factory);
});

check('PerfMonitor: rolling 2 s average, 5 s warm-up, single sticky downgrade', () => {
  const pm = new PerfMonitor();
  for (let i = 0; i < 100; i++) pm.frame(30);      // 3 s of slow frames, still warming up
  assert.ok(Math.abs(pm.avg - 30) < 1e-6);
  assert.equal(pm.shouldDowngrade(), false);
  for (let i = 0; i < 250; i++) pm.frame(10);      // 2.5 s of fast frames: window now holds only those
  assert.ok(Math.abs(pm.avg - 10) < 1e-6, 'avg=' + pm.avg);
  assert.ok(pm.warmedUp);
  assert.equal(pm.shouldDowngrade(), false);
  for (let i = 0; i < 100; i++) pm.frame(30);
  assert.ok(pm.avg > 24);
  assert.equal(pm.shouldDowngrade(), true);
  assert.equal(pm.shouldDowngrade(), false, 'fires once');
  for (let i = 0; i < 5000; i++) pm.frame(1);      // more frames than the ring capacity
  assert.ok(Math.abs(pm.avg - 1) < 1e-6);
  pm.frame(NaN); pm.frame(-5);
  assert.ok(Math.abs(pm.avg - 1) < 1e-6);
});

console.log(passed + ' checks passed');
