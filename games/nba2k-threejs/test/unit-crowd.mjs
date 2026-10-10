// Unit checks for src/render/crowd.js in Node: seat layout, counts / occupancy per tier, determinism by seed,
// palette shares, atlas encoding, excitement. Run: node test/unit-crowd.mjs
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import {
  seatLayout, seats, paintCrowdAtlas, buildCrowd, TIER_COUNTS, NEAR_POOL, SHARE_USER, SHARE_OPP, STANDS, SEAT_SPACING,
} from '../src/render/crowd.js';
import { Rng } from '../src/math.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

const SEED = 7 ^ 0xC20D;

check('seat layout: ≈ 2,830 seats in the five sections, all outside the court and LED boards', () => {
  const L = seatLayout(new Rng(SEED));
  assert.ok(Math.abs(L.count - 2830) / 2830 < 0.02, 'seats ' + L.count);
  const per = [0, 0, 0, 0, 0];
  for (let i = 0; i < L.count; i++) {
    per[L.section[i]]++;
    const x = L.x[i], z = L.z[i];
    assert.ok(Math.abs(x) > 8.5 || z < -16.9, `seat on the court at ${x},${z}`);
    assert.ok(L.y[i] >= 0.4 && L.y[i] < 11.0);
  }
  assert.equal(per[0], 42);                     // courtside 2 × 21 at |x| 9.4, z −13.5 … −1.0, 0.6 m apart
  for (let i = 0; i < L.count; i++) if (L.courtside[i]) assert.ok(Math.abs(Math.abs(L.x[i]) - STANDS.courtside.x) < 1e-5);
  assert.ok(per.every((n) => n > 0));
  // Spacing 0.55 m along a row (± 0.12 jitter).
  assert.ok(Math.abs(Math.abs(L.x[50] - L.x[49]) - SEAT_SPACING) < 0.121);
});

check('seat counts per tier 700 / 1,600 / 2,600; occupancy 35 % / 80 % of the near pool, ≈ 92 % of all', () => {
  for (const tier of ['low', 'medium', 'high']) {
    const S = seats(tier, new Rng(SEED));
    assert.equal(S.count, TIER_COUNTS[tier]);
  }
  const lo = seats('low', new Rng(SEED)), md = seats('medium', new Rng(SEED)), hi = seats('high', new Rng(SEED));
  assert.equal(lo.pool, NEAR_POOL);
  assert.ok(Math.abs(lo.count / lo.pool - 0.35) < 0.005);
  assert.ok(Math.abs(md.count / md.pool - 0.80) < 0.005);
  assert.ok(Math.abs(hi.count / hi.total - 0.92) < 0.01, 'high occupancy ' + hi.count / hi.total);
  // Every tier is a prefix of the next (runtime tier change = mesh.count only).
  for (let i = 0; i < lo.count; i++) assert.equal(lo.order[i], hi.order[i]);
  for (let i = 0; i < md.count; i++) assert.equal(md.order[i], hi.order[i]);
  assert.equal(new Set(hi.order).size, hi.count);
});

check('determinism by seed: same seed → same crowd; different seed → different crowd', () => {
  const a = seats('high', new Rng(SEED)), b = seats('high', new Rng(SEED)), c = seats('high', new Rng(SEED + 1));
  assert.deepEqual(Array.from(a.order), Array.from(b.order));
  assert.deepEqual(Array.from(a.x), Array.from(b.x));
  assert.deepEqual(Array.from(a.column), Array.from(b.column));
  assert.deepEqual(Array.from(a.shirtCat), Array.from(b.shirtCat));
  assert.notDeepEqual(Array.from(a.order.slice(0, 50)), Array.from(c.order.slice(0, 50)));
});

check('palette shares ±3 %: 30 % user team, 12 % opponent, 58 % palette (every tier); skin/hair from palettes', () => {
  for (const seed of [SEED, 1, 2, 99]) {
    for (const tier of ['low', 'medium', 'high']) {
      const S = seats(tier, new Rng(seed));
      const cnt = [0, 0, 0];
      for (let i = 0; i < S.count; i++) cnt[S.shirtCat[i]]++;
      assert.ok(Math.abs(cnt[0] / S.count - SHARE_USER) <= 0.03, `${tier} user ${cnt[0] / S.count}`);
      assert.ok(Math.abs(cnt[1] / S.count - SHARE_OPP) <= 0.03, `${tier} opp ${cnt[1] / S.count}`);
      assert.ok(Math.abs(cnt[2] / S.count - (1 - SHARE_USER - SHARE_OPP)) <= 0.03);
      for (let i = 0; i < S.count; i++) {
        assert.ok(S.column[i] < 8 && S.skinIdx[i] < 6 && S.hairIdx[i] < 6 && S.shirtIdx[i] < 12);
        assert.ok(S.threshold[i] >= 0 && S.threshold[i] < 1 && S.phase[i] >= 0 && S.phase[i] < 2 * Math.PI);
      }
    }
  }
});

check('atlas: 8 × 4 cells, channel encoding (one mask per texel), outlines, hair above 0.70 of the cell', () => {
  const N = 512, A = paintCrowdAtlas(N);
  assert.equal(A.length, N * N * 4);
  const cw = N / 8, ch = N / 4;
  let covered = 0, mixed = 0, outline = 0;
  for (let i = 0; i < N * N; i++) {
    const r = A[i * 4], g = A[i * 4 + 1], b = A[i * 4 + 2], a = A[i * 4 + 3];
    if (!a) { assert.equal(r + g + b, 0); continue; }
    covered++;
    if ((r > 0) + (g > 0) + (b > 0) > 1) mixed++;
    if (r + g + b === 0) outline++;
    const s = Math.max(r, g, b);
    assert.ok(s === 0 || (s >= 0.55 * 255 - 1 && s <= 255), 'shade ' + s);
  }
  assert.equal(mixed, 0);
  assert.ok(outline > 0);
  // Every cell holds a figure, filling 15–70 % of it.
  for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
    let c = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (A[(((row * ch + y) * N) + col * cw + x) * 4 + 3]) c++;
    const f = c / (cw * ch);
    assert.ok(f > 0.12 && f < 0.7, `cell ${row},${col}: ${f}`);
  }
  // Short-haired man, seated: hair (B) pixels are all above 0.70 of the cell height.
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const o = ((y * N) + x) * 4;
    if (A[o + 2] > 0 && y / ch > 0.6) assert.ok(y / ch > 0.70, 'hair at ' + y / ch);
  }
  assert.ok(covered > 0);
});

check('buildCrowd: one InstancedMesh draw, capacity of the cap tier, count of the live tier, sinks', () => {
  const scene = new THREE.Scene();
  const q = { tier: 'medium', loadTier: 'medium', capRung: 6 };
  const c = buildCrowd(scene, q, { user: '#6F263D', opp: '#CE1141' }, new Rng(SEED));
  assert.ok(c.mesh.isInstancedMesh);
  assert.equal(c.capacity, 2600);
  assert.equal(c.mesh.count, 1600);
  assert.equal(c.mesh.geometry.parameters.width, 0.62);
  assert.equal(c.mesh.geometry.parameters.height, 1.05);
  assert.equal(c.material.type, 'MeshLambertMaterial');
  c.setTier('low');
  assert.equal(c.mesh.count, 700);
  c.setTier('high');
  assert.equal(c.mesh.count, 2600);
  // Shirt colours: user team share coloured exactly with the user UI colour.
  const user = new THREE.Color('#6F263D');
  let n = 0;
  const col = new THREE.Color();
  for (let i = 0; i < c.mesh.count; i++) { c.mesh.getColorAt(i, col); if (Math.abs(col.r - user.r) + Math.abs(col.g - user.g) + Math.abs(col.b - user.b) < 1e-5) n++; }
  assert.ok(Math.abs(n / c.mesh.count - 0.30) <= 0.03);
  // Excitement: hold, then decay toward base at 0.5 /s; a weaker event does not cut a stronger hold.
  c.excite(1.0, 3.0);
  c.excite(0.3, 1.0);
  assert.equal(c.uniforms.uExcite.value, 1.0);
  for (let i = 0; i < 180; i++) c.update(1 / 60);
  assert.ok(c.excitement > 0.99);
  for (let i = 0; i < 60; i++) c.update(1 / 60);
  assert.ok(Math.abs(c.excitement - 0.5) < 0.02, 'decay ' + c.excitement);
  for (let i = 0; i < 120; i++) c.update(1 / 60);
  assert.ok(Math.abs(c.excitement - 0.05) < 1e-9);
  c.setClutch(true);
  c.update(1 / 60);
  assert.equal(c.excitement, 0.25);
  c.chant(true);
  assert.equal(c.uniforms.uChant.value, 1);
  c.setDim(0.4);
  assert.equal(c.uniforms.uDim.value, 0.4);
  const low = buildCrowd(null, { tier: 'low', loadTier: 'low', capRung: 2 }, null, new Rng(SEED));
  assert.equal(low.capacity, 700);
  assert.equal(low.material.type, 'MeshBasicMaterial');
  assert.equal(low.atlas.image.width, 512);
});

console.log(`\n${passed} checks passed`);
