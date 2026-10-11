// Unit checks for src/legends/skinPainter.js (spec v2 §3.5.4 / §3.5.4a, [CHR §12]): 8 × 8 synthetic mask planes →
// known RGBA (base texel, lip texel = lips mix, roughness alpha, nail texel 0.25, low tier alpha 255), every texel
// against an independent straight transcription of the composite formula, bilinear up/down-sampling of masks of
// another size, plane splitting (v flip), the clearcoat mask, slicing (resumable job), and the performance guard:
// a 1024² paint of synthetic sparse masks ≤ 90 ms in Node.
// Run: node test/unit-skinpaint.mjs
import assert from 'node:assert/strict';
import { SKIN_CHANNELS, hexToRgb01, splitPlanes, SkinPaintJob, paintSkin, clearcoatData } from '../src/legends/skinPainter.js';
import { LEGENDS, LEGEND_IDS } from '../src/legends.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

// deterministic test RNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const plane = (size, fill = 0) => ({ size, data: new Uint8Array(size * size).fill(fill) });

/** Straight transcription of §3.5.4 (reference; allocates freely). Masks given as 0..1 values. */
function reference(L, m, x, y, seed, alpha) {
  const hx = (h) => hexToRgb01(h).slice();
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const skin = hx(L.skin), lips = hx(L.lips), palms = hx(L.palms), hair = hx(L.hair), beard = hx(L.beard);
  let c = skin.map((v) => v * (1 + 0.12 * (m.mottle - 0.5)));
  c = mix(c, [c[0] * 1.12, c[1] * 0.90, c[2] * 0.86], m.redness * L.warmK);
  c = c.map((v) => v * (1 - 0.30 * m.ao));
  c = c.map((v) => v * (1 - L.cavityK * 0.45 * m.cavity));
  c = c.map((v) => v + (1 - v) * L.hlK * m.highlight);
  c = mix(c, lips, 0.85 * m.lips);
  c = mix(c, palms, 0.90 * m.palms);
  c = mix(c, mix(palms, hx('#f0d8d0'), 0.4), 0.80 * m.nails);
  c = mix(c, hair, L.scalpDarken * m.hair);
  c = mix(c, beard, L.beardSkinDarken * m.beard);
  c = mix(c, hair, L.browDarken * m.brow);
  const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const des = c.map((v) => (v + (luma - v) * 0.3) * 0.82);
  c = mix(c, des, L.tattooK * m.tattoo);
  const h = ((((x * 73856093) ^ (y * 19349663) ^ ((seed * 83492791) | 0)) & 255) > 158) ? 1 : 0;
  c = mix(c, hair, 0.25 * Math.max(m.hair * L.stubbleHair, m.beard) * h);
  let rough = L.skinRoughness - 0.10 * m.highlight - (L.lipRoughK ?? 0.15) * m.lips + 0.15 * m.beard + 0.10 * m.palms;
  rough = rough + (0.25 - rough) * m.nails;
  rough = rough + (L.scalpRoughness - rough) * m.gloss;
  const a = alpha ? Math.round(255 * Math.min(0.9, Math.max(0.2, rough))) : 255;
  return [...c.map((v) => Math.round(255 * Math.min(1, Math.max(0, v)))), a];
}

function synthPlanes(size, seed) {
  const r = rng(seed), P = {};
  for (const ch of SKIN_CHANNELS) {
    const p = plane(size);
    for (let i = 0; i < p.data.length; i++) if (r() < 0.45) p.data[i] = Math.floor(r() * 256);
    P[ch] = p;
  }
  return P;
}

// ------------------------------------------------------------------------------------------------ 8 × 8 known texels

check('8×8: base texel, lip texel, nail roughness 0.25, low-tier alpha', () => {
  const L = LEGENDS.kobe.look;
  const P = {};
  for (const ch of SKIN_CHANNELS) P[ch] = plane(8);
  P.mottle.data.fill(128);
  P.lips.data[1 * 8 + 1] = 255;
  P.nails.data[2 * 8 + 2] = 255;
  P.palms.data[3 * 8 + 3] = 255;
  P.gloss.data[4 * 8 + 4] = 255;
  const out = paintSkin(P, L, 8, { seed: 0 });
  const skin = hexToRgb01(L.skin);
  const mot = 1 + 0.12 * (128 / 255 - 0.5);
  // texel (0, 0): only mottle (stubble hash irrelevant: no hair/beard)
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(out[k] - Math.round(255 * skin[k] * mot)) <= 1, 'base colour');
  assert.equal(out[3], Math.round(255 * L.skinRoughness), 'base roughness alpha');
  // lip texel: c = mix(c, lips, 0.85), rough − 0.15
  const o1 = (1 * 8 + 1) * 4, lips = hexToRgb01(L.lips);
  for (let k = 0; k < 3; k++) {
    const want = Math.round(255 * (skin[k] * mot + (lips[k] - skin[k] * mot) * 0.85));
    assert.ok(Math.abs(out[o1 + k] - want) <= 1, `lip channel ${k}: ${out[o1 + k]} vs ${want}`);
  }
  assert.equal(out[o1 + 3], Math.round(255 * (L.skinRoughness - (L.lipRoughK ?? 0.15))), 'lip roughness');
  assert.equal(out[(2 * 8 + 2) * 4 + 3], Math.round(255 * 0.25), 'nail roughness 0.25');
  assert.equal(out[(3 * 8 + 3) * 4 + 3], Math.round(255 * (L.skinRoughness + 0.10)), 'palm roughness');
  assert.equal(out[(4 * 8 + 4) * 4 + 3], Math.round(255 * L.scalpRoughness), 'gloss → scalp roughness');
  const low = paintSkin(P, L, 8, { alpha: false });
  for (let i = 3; i < low.length; i += 4) assert.equal(low[i], 255, 'low tier alpha 255');
  for (let i = 0; i < low.length; i++) if (i % 4 !== 3) assert.equal(low[i], out[i], 'low tier RGB identical');
});

check('every texel of random 8×8 masks matches the straight formula (all six looks, seeded stubble)', () => {
  LEGEND_IDS.forEach((id, pi) => {
    const L = LEGENDS[id].look;
    const P = synthPlanes(8, 100 + pi);
    const out = paintSkin(P, L, 8, { seed: pi });
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const m = {};
        for (const ch of SKIN_CHANNELS) m[ch] = P[ch].data[y * 8 + x] / 255;
        const want = reference(L, m, x, y, pi, true);
        const o = (y * 8 + x) * 4;
        for (let k = 0; k < 4; k++) assert.ok(Math.abs(out[o + k] - want[k]) <= 1, `${id} (${x},${y}) ch${k}: ${out[o + k]} vs ${want[k]}`);
      }
    }
  });
});

check('masks of another size: bilinear 4 → 8 upsample and 16 → 8 box downsample', () => {
  const L = { ...LEGENDS.yao.look, tattooK: 1 };
  const base = {};
  for (const ch of SKIN_CHANNELS) base[ch] = plane(8);
  const ref = paintSkin(base, L, 8);
  // a 4×4 lips plane with one full texel at (1, 1): output texel (2, 2) samples f = 2.5·0.5 − 0.5 = 0.75 → weight 0.25·0.25
  const up = { ...base, lips: plane(4) };
  up.lips.data[1 * 4 + 1] = 255;
  const o = paintSkin(up, L, 8);
  const lipsAt = (out, x, y, k) => out[(y * 8 + x) * 4 + k];
  // texel (3, 3): f = 3.5·0.5 − 0.5 = 1.25 → i0 = 1 (w 0.75 of texel 1) → weight 0.75² = 0.5625
  const lips = hexToRgb01(L.lips), sk = (k) => ref[(3 * 8 + 3) * 4 + k] / 255;
  for (let k = 0; k < 3; k++) {
    const want = Math.round(255 * (sk(k) + (lips[k] - sk(k)) * 0.85 * (Math.round(0.5625 * 255) / 255)));
    assert.ok(Math.abs(lipsAt(o, 3, 3, k) - want) <= 2, `upsampled lip ${lipsAt(o, 3, 3, k)} vs ${want}`);
  }
  assert.deepEqual([0, 1, 2].map((k) => lipsAt(o, 7, 7, k)), [0, 1, 2].map((k) => lipsAt(ref, 7, 7, k)), 'far texel untouched');
  // 16×16 tattoo plane with a 2×2 block at (4..5, 4..5) → output texel (2, 2) = box average = 255
  const dn = { ...base, tattoo: plane(16) };
  for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]]) dn.tattoo.data[y * 16 + x] = 255;
  const od = paintSkin(dn, L, 8);
  const c = [0, 1, 2].map((k) => ref[(2 * 8 + 2) * 4 + k] / 255), lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (let k = 0; k < 3; k++) {
    const want = Math.round(255 * (c[k] * 0.7 + lum * 0.3) * 0.82);
    assert.ok(Math.abs(od[(2 * 8 + 2) * 4 + k] - want) <= 2, `downsampled tattoo ${od[(2 * 8 + 2) * 4 + k]} vs ${want}`);
  }
  assert.deepEqual([0, 1, 2].map((k) => od[(3 * 8 + 3) * 4 + k]), [0, 1, 2].map((k) => ref[(3 * 8 + 3) * 4 + k]), 'neighbour block untouched');
});

check('splitPlanes flips rows to v-up and separates channels', () => {
  const w = 4, bytes = new Uint8Array(w * w * 4);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; bytes[o] = y * 10 + x; bytes[o + 1] = 200 + x; bytes[o + 2] = 7; bytes[o + 3] = 255; }
  const P = splitPlanes(bytes, w, w, 4, ['a', 'b', null], {});
  assert.equal(P.a.size, 4);
  assert.equal(P.a.data[0], 30, 'row 0 of the plane = last image row (v 0)');
  assert.equal(P.a.data[3 * 4 + 2], 2, 'last plane row = first image row');
  assert.equal(P.b.data[5], 201);
  assert.equal(P.c, undefined);
});

check('clearcoat mask = max(gloss, sweat), 2×2 box onto half size', () => {
  const g = plane(4), s = plane(4);
  g.data[0] = 200; s.data[1] = 100; s.data[4] = 255;
  const out = clearcoatData({ gloss: g, sweat: s }, 2);
  assert.equal(out[0], Math.round((200 + 100 + 255 + 0) / 4));
  assert.equal(out[1], out[0]);
  assert.equal(out[3], 255);
  assert.equal(out[4], 0);
});

check('resumable job: sliced painting equals one-shot painting', () => {
  const L = LEGENDS.lebron.look, P = synthPlanes(64, 7);
  const whole = paintSkin(P, L, 64, { seed: 2 });
  const job = new SkinPaintJob(P, L, 64, { seed: 2 });
  let slices = 0;
  while (!job.run(-Infinity)) slices++;               // deadline already passed → one 16-row block per slice
  assert.equal(slices, 3, '64 rows = 4 blocks of 16 rows');
  assert.deepEqual(job.out, whole);
});

check('performance guard: 1024² paint of synthetic sparse masks ≤ 90 ms (Node)', () => {
  const r = rng(42);
  const P = {};
  const sparse = (size, frac, blob) => {
    const p = plane(size);
    const n = Math.round(size * size * frac / (blob * blob));
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(r() * size), cy = Math.floor(r() * size), v = 1 + Math.floor(r() * 254);
      for (let y = cy; y < Math.min(size, cy + blob); y++) for (let x = cx; x < Math.min(size, cx + blob); x++) p.data[y * size + x] = v;
    }
    return p;
  };
  // sizes as shipped: skin0 + groom 1024², skin1/skin2/extra 512²; dense mottle/AO/redness, sparse features
  P.lips = sparse(1024, 0.004, 16); P.cavity = sparse(1024, 0.05, 8); P.highlight = sparse(1024, 0.03, 16);
  P.hair = sparse(1024, 0.06, 32); P.beard = sparse(1024, 0.03, 16); P.brow = sparse(1024, 0.004, 8);
  P.redness = sparse(512, 0.2, 16); P.ao = sparse(512, 0.15, 16);
  P.mottle = plane(512); for (let i = 0; i < P.mottle.data.length; i++) P.mottle.data[i] = Math.floor(r() * 256);
  P.palms = sparse(512, 0.02, 8); P.nails = sparse(512, 0.002, 4); P.tattoo = sparse(512, 0.02, 8);
  P.gloss = sparse(512, 0.05, 16); P.sweat = sparse(512, 0.08, 16);
  const L = LEGENDS.lebron.look;
  const out = new Uint8Array(1024 * 1024 * 4);
  paintSkin(P, L, 1024, { out });                       // warm-up (JIT)
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    paintSkin(P, L, 1024, { out, seed: i });
    times.push(performance.now() - t0);
  }
  const best = Math.min(...times);
  console.log(`   1024² paint: best ${best.toFixed(1)} ms (runs ${times.map((t) => t.toFixed(1)).join(', ')})`);
  assert.ok(best <= 90, `1024² paint took ${best.toFixed(1)} ms > 90 ms`);
});

console.log(`\nunit-skinpaint: ${passed} passed`);
