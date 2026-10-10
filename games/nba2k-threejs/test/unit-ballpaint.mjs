// Unit checks for src/render/ballvis.js in Node: texture painter (seams, pebbles, no polar pinching) and the
// visual spin rules. Run: node test/unit-ballpaint.mjs
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {
  paintBall, seamDistance, pebbleField, texelDir, backspinAxis, shotSpin, passSpin, rollingSpin, BallVisual,
  BALL_R, SEAM_W, SEAM_CORE, PEBBLE_CELL,
} from '../src/render/ballvis.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

const W = 512, H = 256;
const P = paintBall(W);

check('paintBall sizes; RGBA albedo with roughness alpha; normal map; deterministic', () => {
  assert.equal(P.width, W); assert.equal(P.height, H);
  assert.equal(P.albedo.length, W * H * 4);
  assert.equal(P.normal.length, W * H * 4);
  assert.equal(paintBall(W, { normal: false }).normal, null);
  assert.ok(Buffer.from(paintBall(W).albedo).equals(Buffer.from(P.albedo)));
  let mnA = 255, mxA = 0;
  for (let i = 3; i < P.albedo.length; i += 4) { mnA = Math.min(mnA, P.albedo[i]); mxA = Math.max(mxA, P.albedo[i]); }
  assert.ok(mnA / 255 >= 0.69 && mxA / 255 <= 0.86, `roughness ${mnA / 255}–${mxA / 255}`);
});

check('seam coverage (dark core) 6–10 % of the sphere area (texels weighted by sin θ)', () => {
  let area = 0, seam = 0;
  const n = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    const wgt = Math.sin((1 - (j + 0.5) / H) * Math.PI);
    for (let i = 0; i < W; i++) {
      texelDir((i + 0.5) / W, (j + 0.5) / H, n);
      area += wgt;
      if (seamDistance(n[0], n[1], n[2]) < SEAM_CORE) seam += wgt;
    }
  }
  const cov = seam / area;
  assert.ok(cov >= 0.06 && cov <= 0.10, 'coverage ' + cov.toFixed(4));
  // The painted texels agree: seam colour #1a1410 where the distance says seam core.
  let dark = 0, total = 0;
  for (let j = 0; j < H; j += 3) for (let i = 0; i < W; i += 3) {
    texelDir((i + 0.5) / W, (j + 0.5) / H, n);
    if (seamDistance(n[0], n[1], n[2]) < SEAM_CORE) { total++; if (P.albedo[(j * W + i) * 4] === 0x1a) dark++; }
  }
  assert.equal(dark, total);
});

check('pebbles uniform on the sphere: cell density equator vs 60° latitude ratio 0.85–1.15', () => {
  // Count distinct pebble cells per unit sphere area in two latitude bands of equal angular height.
  function density(latDeg) {
    const ids = new Set();
    let area = 0;
    const lat0 = (latDeg - 4) * Math.PI / 180, lat1 = (latDeg + 4) * Math.PI / 180;
    const Wd = 2048, Hd = 1024;               // fine sampling so every ≈ 2.8 mm pebble is hit
    for (let j = 0; j < Hd; j++) {
      const lat = Math.PI / 2 - (1 - (j + 0.5) / Hd) * Math.PI;
      if (lat < lat0 || lat > lat1) continue;
      const wgt = Math.cos(lat);
      for (let i = 0; i < Wd; i++) {
        const n = texelDir((i + 0.5) / Wd, (j + 0.5) / Hd, [0, 0, 0]);
        area += wgt;
        const p = pebbleField(n[0], n[1], n[2]);
        ids.add(p.id);
      }
    }
    return ids.size / area;
  }
  const eq = density(0), hi = density(60);
  const ratio = hi / eq;
  assert.ok(ratio > 0.85 && ratio < 1.15, 'ratio ' + ratio.toFixed(3));
  // ≈ 2.8 mm cells: 1 / 0.0115 cells per unit n → cell size on a 0.12 m ball.
  assert.ok(Math.abs(PEBBLE_CELL * BALL_R * 1000 * 2 - 2.76) < 0.1);
});

check('base colour #c4521c ± 3 % (+ pebble shade) away from the seams', () => {
  let r = 0, g = 0, b = 0, c = 0;
  const n = [0, 0, 0];
  for (let j = 10; j < H - 10; j += 2) for (let i = 0; i < W; i += 2) {
    texelDir((i + 0.5) / W, (j + 0.5) / H, n);
    if (seamDistance(n[0], n[1], n[2]) < SEAM_W * 2) continue;
    const o = (j * W + i) * 4;
    r += P.albedo[o]; g += P.albedo[o + 1]; b += P.albedo[o + 2]; c++;
  }
  r /= c; g /= c; b /= c;
  assert.ok(Math.abs(r - 0xc4) < 0x0c && Math.abs(g - 0x52) < 0x08 && Math.abs(b - 0x1c) < 0x06, `${r} ${g} ${b}`);
});

check('normal map is unit length, mostly +z, grooves tilt the normal', () => {
  let tilted = 0;
  for (let i = 0; i < W * H; i++) {
    const x = P.normal[i * 4] / 127.5 - 1, y = P.normal[i * 4 + 1] / 127.5 - 1, z = P.normal[i * 4 + 2] / 127.5 - 1;
    const l = Math.sqrt(x * x + y * y + z * z);
    assert.ok(Math.abs(l - 1) < 0.02);
    assert.ok(z > 0);
    if (z < 0.9) tilted++;
  }
  assert.ok(tilted > W * H * 0.02 && tilted < W * H * 0.5, 'tilted ' + tilted);
});

check('spin: shot backspin axis turns the top of the ball back toward the shooter', () => {
  const w = { x: 0, y: 0, z: 0 };
  for (const [dx, dz] of [[0, -1], [1, 0], [0.6, -0.8], [-0.3, 0.95]]) {
    shotSpin(dx, dz, w);
    assert.ok(Math.abs(Math.hypot(w.x, w.y, w.z) - 2 * Math.PI * 2.2) < 1e-9);
    // Surface velocity at the top point (0, r, 0): ω × r.
    const top = new THREE.Vector3(w.x, w.y, w.z).cross(new THREE.Vector3(0, BALL_R, 0));
    assert.ok(top.x * dx + top.z * dz < 0, 'top moves backward');
  }
  backspinAxis(0, 0, w);
  assert.deepEqual([w.x, w.y, w.z], [1, 0, 0]);
  passSpin('chest', 0, -1, w);
  assert.ok(Math.abs(Math.hypot(w.x, w.z) - 2 * Math.PI * 3.0) < 1e-9);
  const back = w.x;
  passSpin('bounce', 0, -1, w);
  assert.ok(Math.abs(Math.hypot(w.x, w.z) - 2 * Math.PI * 2.0) < 1e-9);
  assert.ok(Math.sign(w.x) === -Math.sign(back), 'bounce pass = topspin');
});

check('spin: rolling |ω|·r = |v| and the contact point is at rest', () => {
  const w = { x: 0, y: 0, z: 0 };
  for (const [vx, vz] of [[2, 0], [0, -3], [1.2, 0.7]]) {
    rollingSpin(vx, vz, w);
    assert.ok(Math.abs(Math.hypot(w.x, w.y, w.z) * BALL_R - Math.hypot(vx, vz)) < 1e-9);
    const contact = new THREE.Vector3(w.x, w.y, w.z).cross(new THREE.Vector3(0, -BALL_R, 0));
    assert.ok(Math.abs(contact.x + vx) < 1e-9 && Math.abs(contact.z + vz) < 1e-9);
  }
});

check('BallVisual: held → no spin, finger spin flag, flight backspin, floor bounce, no allocation of state', () => {
  const scene = new THREE.Scene();
  const bv = new BallVisual(scene, { tier: 'medium', loadTier: 'medium' }, { seed: 3 });
  assert.equal(bv.mesh.geometry.parameters.widthSegments, 32);
  assert.equal(bv.mesh.material.normalScale.x, 0.6);
  assert.equal(bv.mesh.material.envMapIntensity, 0.8);
  assert.ok(bv.mesh.layers.isEnabled(2));
  const ball = { state: 'held', pos: new THREE.Vector3(0, 1.2, -5), vel: new THREE.Vector3(), owner: null };
  const q0 = bv.mesh.quaternion.clone();
  bv.update(1 / 60, ball);
  bv.update(1 / 60, ball);
  assert.ok(bv.mesh.quaternion.equals(q0));
  ball.spinMode = 'finger';
  bv.update(0.1, ball);
  assert.ok(Math.abs(bv.omega.y - 2 * Math.PI * 3) < 1e-9);
  ball.spinMode = undefined;
  ball.state = 'flight';
  ball.vel.set(0, 6, -5);
  bv.update(1 / 60, ball);
  assert.ok(bv.omega.x > 0 && Math.abs(bv.omega.length() - 2 * Math.PI * 2.2) < 1e-9);
  // Free flight under gravity: no contact detected.
  for (let i = 0; i < 10; i++) { ball.vel.y -= 9.81 / 60; ball.pos.addScaledVector(ball.vel, 1 / 60); bv.update(1 / 60, ball); }
  assert.ok(Math.abs(bv.omega.length() - 2 * Math.PI * 2.2) < 1e-6);
  // Floor bounce: ω = 0.6·cross(up, v_xz)/r + 0.4·ω.
  ball.state = 'loose';
  ball.pos.set(0, 0.2, -8); ball.vel.set(0, -4, -5);           // falling onto the floor
  bv.update(1 / 60, ball);
  const before = bv.omega.clone();
  ball.pos.set(0, 0.13, -8); ball.vel.set(0, 4, -5);
  bv.update(1 / 60, ball);
  const exp = new THREE.Vector3(-5 / BALL_R, 0, 0).multiplyScalar(0.6).addScaledVector(before, 0.4);
  assert.ok(bv.omega.distanceTo(exp) < 1e-6);
  assert.ok(Number.isFinite(bv.mesh.quaternion.x) && Math.abs(bv.mesh.quaternion.length() - 1) < 1e-6);
  const low = new BallVisual(null, { tier: 'low' });
  assert.equal(low.mesh.material.type, 'MeshLambertMaterial');
  assert.equal(low.mesh.geometry.parameters.widthSegments, 20);
  assert.equal(low.normalMap, null);
});

console.log(`\n${passed} checks passed`);
