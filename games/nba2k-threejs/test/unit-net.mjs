// Unit checks for the net simulation and hoop pieces of src/render/hoop.js in Node (R#6 glass included).
// Run: node test/unit-net.mjs
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { NetSim, rimShake, createGlass, buildHoop, paintNetTexture, ShotClockDigits } from '../src/render/hoop.js';
import { RIM, BOARD } from '../src/constants.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

const finite = (a) => { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; };

check('topology: rest radii / heights, odd rings rotated half a strand, 224 triangles (low 12 × 5)', () => {
  const s = new NetSim();
  assert.equal(s.n, 16 * 8);
  const r = (k) => Math.hypot(s.rest[k * 16 * 3] - RIM.x, s.rest[k * 16 * 3 + 2] - RIM.z);
  assert.ok(Math.abs(r(0) - 0.2286) < 1e-6 && Math.abs(r(7) - 0.125) < 1e-6);
  const f = Math.pow(3 / 7, 0.85);
  assert.ok(Math.abs(r(3) - (0.2286 + (0.125 - 0.2286) * f)) < 1e-6);
  assert.ok(Math.abs(s.rest[1] - 3.048) < 1e-6 && Math.abs(s.rest[7 * 16 * 3 + 1] - (3.048 - 0.45)) < 1e-6);
  const a0 = Math.atan2(s.rest[2] - RIM.z, s.rest[0] - RIM.x);
  const a1 = Math.atan2(s.rest[16 * 3 + 2] - RIM.z, s.rest[16 * 3] - RIM.x);
  assert.ok(Math.abs(Math.abs(a1 - a0) - Math.PI / 16) < 1e-4);   // Float32 positions near z −12.75
  const hoop = buildHoop(null, { tier: 'medium', loadTier: 'medium' }, { far: false });
  assert.equal(hoop.netMesh.geometry.index.count / 3, 224);
  const low = buildHoop(null, { tier: 'low', loadTier: 'low' }, { far: false });
  assert.equal(low.netMesh.geometry.index.count / 3, 12 * 4 * 2);
  assert.deepEqual([low.netSim.S, low.netSim.R, low.netSim.substeps], [12, 5, 1]);
});

check('rest is stable: no motion, offsets stay exactly 0 (also with a ball far away)', () => {
  const s = new NetSim();
  const ball = { pos: { x: 3, y: 1, z: -5 }, vel: { x: 0, y: 0, z: 0 } };
  for (let i = 0; i < 600; i++) s.step(1 / 60, i % 2 ? ball : null);
  assert.equal(s.maxOffset(), 0);
  assert.equal(s.moving, false);
});

check('an impulse decays below 1 mm within 1.5 s; |o| ≤ 0.18 m throughout', () => {
  for (const kind of ['swish', 'rim', 'slam']) {
    for (const [substeps, strands, rings] of [[2, 16, 8], [1, 12, 5]]) {
      const s = new NetSim({ substeps, strands, rings, seed: 3 });
      s.impulse(kind, kind === 'rim' ? 4 : 1);
      let peak = 0;
      for (let t = 0; t < 1.5 - 1e-9; t += 1 / 60) {
        s.step(1 / 60, null);
        peak = Math.max(peak, s.maxOffset());
        assert.ok(s.maxOffset() <= 0.18 + 1e-6);
      }
      assert.ok(peak > 0.005, kind + ' moved ' + peak);
      assert.ok(s.maxOffset() < 0.001, `${kind}/${substeps}: ${s.maxOffset()}`);
    }
  }
});

check('huge repeated kicks stay clamped to 0.18 m and finite', () => {
  const s = new NetSim();
  for (let i = 0; i < 120; i++) { s.impulse('slam', 1.5); s.impulse('rim', 4); s.step(1 / 60, null); assert.ok(s.maxOffset() <= 0.18 + 1e-6); }
  assert.ok(finite(s.o) && finite(s.v));
});

check('no NaN for dt ∈ [0, 0.1] (incl. 0, tiny, > 1/30), with the ball inside the net', () => {
  const s = new NetSim();
  const ball = { pos: { x: RIM.x, y: RIM.y - 0.1, z: RIM.z }, vel: { x: 0.3, y: -4, z: -0.2 } };
  for (const dt of [0, 1e-6, 0.001, 1 / 120, 1 / 60, 1 / 30, 0.05, 0.1]) {
    for (let i = 0; i < 30; i++) { ball.pos.y -= 0.01; s.step(dt, ball); }
    assert.ok(finite(s.o) && finite(s.v), 'dt ' + dt);
  }
  s.step(NaN, ball); s.step(-1, ball);
  assert.ok(finite(s.o) && finite(s.v));
});

check('the ball pushes cords out of its 0.132 m sphere; a swish snaps the bottom rings up', () => {
  const s = new NetSim();
  const ball = { pos: { x: RIM.x, y: RIM.y - 0.30, z: RIM.z }, vel: { x: 0, y: -3, z: 0 } };
  s.step(1 / 60, ball);
  for (let i = 0; i < s.n; i++) {
    const dx = s.rest[i * 3] + s.o[i * 3] - ball.pos.x, dy = s.rest[i * 3 + 1] + s.o[i * 3 + 1] - ball.pos.y, dz = s.rest[i * 3 + 2] + s.o[i * 3 + 2] - ball.pos.z;
    const d = Math.hypot(dx, dy, dz);
    assert.ok(d >= 0.132 - 1e-4 || s.maxOffset() >= 0.18 - 1e-6, 'vertex ' + i + ' at ' + d);
  }
  const t = new NetSim();
  t.impulse('swish', 1);
  // Deferred until the ball drops below the bottom ring.
  t.step(1 / 60, { pos: { x: RIM.x, y: RIM.y, z: RIM.z }, vel: { x: 0, y: -3, z: 0 } });
  assert.equal(t.maxSpeed, 0);
  t.step(1 / 60, { pos: { x: RIM.x, y: RIM.y - 0.6, z: RIM.z }, vel: { x: 0, y: -3, z: 0 } });
  let vy = 0;
  for (let j = 0; j < 16; j++) vy += t.v[(7 * 16 + j) * 3 + 1];
  assert.ok(vy / 16 > 1.0, 'bottom ring upward ' + vy / 16);
});

check('rim shake: 0.035·e^(−9t)·sin(2π·11t) for 0.6 s', () => {
  assert.equal(rimShake(0), 0);
  assert.ok(Math.abs(rimShake(1 / 44) - 0.035 * Math.exp(-9 / 44)) < 1e-12);
  assert.equal(rimShake(0.6), 0);
  assert.equal(rimShake(-0.1), 0);
});

check('glass is a single FrontSide plane, opacity 0.16, depthWrite false (R#6)', () => {
  const g = createGlass(true, null);
  assert.equal(g.geometry.type, 'PlaneGeometry');
  assert.equal(g.material.side, THREE.FrontSide);
  assert.equal(g.material.opacity, 0.16);
  assert.equal(g.material.transparent, true);
  assert.equal(g.material.depthWrite, false);
  assert.equal(g.material.envMapIntensity, 1.6);
  assert.ok(Math.abs(g.position.z - BOARD.max.z) < 1e-9);
  assert.ok(Math.abs(g.geometry.parameters.width - 1.83) < 1e-9 && Math.abs(g.geometry.parameters.height - 1.07) < 1e-9);
  const hoop = buildHoop(null, { tier: 'high', loadTier: 'high' }, { far: true });
  const glasses = [];
  hoop.group.traverse((o) => { if (o.name === 'glass') glasses.push(o); });
  assert.equal(glasses.length, 2);          // near + far hoop, one plane each
  for (const o of glasses) assert.equal(o.material.side, THREE.FrontSide);
  // Rim torus parameters and colour.
  assert.ok(hoop.rimMesh && hoop.rimMesh.layers.isEnabled(2) && hoop.netMesh.layers.isEnabled(2));
});

check('hoop update: rim shake via the sink, LED strip timer, shot-clock digits repaint only on change', () => {
  const hoop = buildHoop(new THREE.Scene(), { tier: 'medium', loadTier: 'medium' }, { far: false });
  hoop.rim.shake(0);
  hoop.update(1 / 44, null);
  const rimGroup = hoop.group.getObjectByName('rimGroup');
  assert.ok(Math.abs(rimGroup.rotation.x - rimShake(1 / 44)) < 1e-12);
  for (let i = 0; i < 40; i++) hoop.update(1 / 60, null);
  assert.equal(rimGroup.rotation.x, 0);
  hoop.flashStrip(1.0);
  assert.equal(hoop.strip.visible, true);
  for (let i = 0; i < 61; i++) hoop.update(1 / 60, null);
  assert.equal(hoop.strip.visible, false);
  const d = new ShotClockDigits();
  const r0 = d.repaints;
  assert.equal(d.set(14), true);
  assert.equal(d.set(14), false);
  assert.equal(d.set(13.4), true);
  assert.equal(d.repaints, r0 + 2);
});

check('net texture: diagonal cords, transparent cell centres', () => {
  const t = paintNetTexture(128);
  const a = (x, y) => t[(y * 128 + x) * 4 + 3];
  assert.equal(a(64, 64), 255);       // cords cross at the centre
  assert.equal(a(0, 0), 255);         // and at the corners
  assert.equal(a(64, 4), 0);          // open between cords
  assert.equal(a(4, 64), 0);
});

console.log(`\n${passed} checks passed`);
