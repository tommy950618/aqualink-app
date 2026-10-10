// Unit checks for src/render/floor.js in Node (no DOM, no WebGL): wood tile, marking coordinates, the half-line
// band, floor strings (from i18n, denylist-clean). Replaces the marking cases of the v1 unit-court.mjs.
// Run: node test/unit-floorpaint.mjs
import assert from 'node:assert/strict';
import {
  paintWoodTile, boardSegments, worldToMarkPx, drawMarkings, drawCentreDecal, markingStrings, hslToRgb,
  TILE_M, HALF_LINE_BAND, LINE_W, FLOOR_W, MARK_HALF_D,
} from '../src/render/floor.js';
import { drawBoardMarkings } from '../src/render/hoop.js';
import { COURT, LINES, RIM } from '../src/constants.js';
import { Rng } from '../src/math.js';
import { STRINGS } from '../src/i18n.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

// Denylist v2 (SPEC-v2 §9.2). CJK entries are matched without word boundaries.
const DENY = ['Lakers', 'Celtics', 'Warriors', 'Bulls', 'Heat', 'Knicks', 'Nets', 'Spurs', 'Rockets', 'Mavericks', 'Suns',
  'Clippers', 'Bucks', 'Cavaliers', 'Raptors', 'Sixers', '76ers', 'Curry', 'Durant', 'Jokic', 'NBA', '2K', 'Air Jordan',
  'Jumpman', 'Mamba', 'Black Mamba', 'King James', 'Greek Freak', 'Uncle Drew', 'Concord', 'Bred', 'Nike', 'Adidas',
  'Spalding', 'Wilson', 'Swoosh', 'Gatorade', 'Under Armour'];
const DENY_CJK = ['湖人', '公牛', '骑士', '雄鹿', '火箭', '凯尔特人',
  '勇士', '热火', '篮网', '耐克', '阿迪达斯', '黑曼巴',
  '飞人', '小皇帝', '德鲁大叔'];
function denylistClean(s) {
  for (const w of DENY) if (new RegExp('\\b' + w.replace(/ /g, '\\s+') + '\\b').test(s)) return w;
  for (const w of DENY_CJK) if (s.includes(w)) return w;
  return null;
}

const N = 512;
const tile = paintWoodTile(N, new Rng(0x600D), { wear: true });
const lum = (i) => 0.2126 * tile[i] + 0.7152 * tile[i + 1] + 0.0722 * tile[i + 2];

check('wood tile: size, deterministic by seed', () => {
  assert.equal(tile.length, N * N * 4);
  const again = paintWoodTile(N, new Rng(0x600D), { wear: true });
  assert.deepEqual(Buffer.from(again).equals(Buffer.from(tile)), true);
  const other = paintWoodTile(N, new Rng(0x600E), { wear: true });
  assert.equal(Buffer.from(other).equals(Buffer.from(tile)), false);
});

check('wood tile is seamless: edge rows / columns mean abs diff < 6/255 (and like interior neighbours)', () => {
  let rowDiff = 0, colDiff = 0;
  for (let k = 0; k < N; k++) {
    rowDiff += Math.abs(lum(k * 4) - lum(((N - 1) * N + k) * 4));          // row 0 vs row N−1
    colDiff += Math.abs(lum((k * N) * 4) - lum((k * N + N - 1) * 4));        // col 0 vs col N−1
  }
  rowDiff /= N; colDiff /= N;
  assert.ok(rowDiff < 6, 'row seam ' + rowDiff.toFixed(2));
  assert.ok(colDiff < 6, 'column seam ' + colDiff.toFixed(2));
  // A non-seamless tile would differ far more than two interior neighbours do.
  let inner = 0;
  for (let k = 0; k < N; k++) inner += Math.abs(lum((k * N + 200) * 4) - lum((k * N + 201) * 4));
  inner /= N;
  assert.ok(colDiff < inner * 2 + 2, `col seam ${colDiff.toFixed(2)} vs interior ${inner.toFixed(2)}`);
});

check('roughness alpha in [0.15, 0.40]; mean ≈ 0.20–0.26; albedo ≈ maple HSL 30° / l 0.62', () => {
  let mn = 255, mx = 0, sum = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < N * N; i++) {
    const a = tile[i * 4 + 3];
    mn = Math.min(mn, a); mx = Math.max(mx, a); sum += a;
    r += tile[i * 4]; g += tile[i * 4 + 1]; b += tile[i * 4 + 2];
  }
  assert.ok(mn / 255 >= 0.15 && mx / 255 <= 0.40, `alpha ${mn / 255}–${mx / 255}`);
  const mean = sum / (N * N) / 255;
  assert.ok(mean > 0.19 && mean < 0.27, 'mean roughness ' + mean);
  r /= N * N; g /= N * N; b /= N * N;
  const ref = hslToRgb(30, 0.5, 0.62, [0, 0, 0]).map((v) => v * 255);   // ≈ #d8a46b
  assert.ok(Math.abs(r - ref[0]) < 20 && Math.abs(g - ref[1]) < 20 && Math.abs(b - ref[2]) < 20, `mean ${r},${g},${b} vs ${ref}`);
  assert.ok(r > g && g > b);
});

check('boards run along z: luminance varies more across columns than along rows', () => {
  let alongRow = 0, alongCol = 0;
  for (let y = 1; y < N; y += 7) for (let x = 1; x < N; x += 7) {
    alongRow += Math.abs(lum((y * N + x) * 4) - lum((y * N + x - 1) * 4));   // across boards (x)
    alongCol += Math.abs(lum((y * N + x) * 4) - lum(((y - 1) * N + x) * 4)); // along a board (z)
  }
  assert.ok(alongRow > alongCol * 1.3, `${alongRow} vs ${alongCol}`);
});

check('board segments are 0.40–1.60 m and sum to the 2.28 m tile', () => {
  const rng = new Rng(3);
  for (let i = 0; i < 500; i++) {
    const s = boardSegments(rng, TILE_M);
    const tot = s.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(tot - TILE_M) < 1e-9);
    for (const L of s) assert.ok(L >= 0.4 - 1e-9 && L <= 1.6 + 1e-9, 'segment ' + L);
  }
});

check('worldToMarkPx corners and court points', () => {
  const W = 2048, H = 1632, o = { px: 0, py: 0 };
  assert.deepEqual(worldToMarkPx(-11, -17.5, W, H, o), { px: 0, py: 0 });
  assert.deepEqual(worldToMarkPx(11, 0, W, H, { px: 0, py: 0 }), { px: W, py: H });
  worldToMarkPx(0, COURT.BASELINE_Z, W, H, o);
  assert.ok(Math.abs(o.px - W / 2) < 1e-9 && Math.abs(o.py - (3.175 / 17.5) * H) < 1e-9);
  worldToMarkPx(COURT.HALF_W, 0, W, H, o);
  assert.ok(Math.abs(o.px - ((7.62 + 11) / 22) * W) < 1e-9);
  // ≈ 93 px per metre in both axes at 2048×1632 (lines keep their width).
  assert.ok(Math.abs(W / FLOOR_W - H / MARK_HALF_D) < 0.3);
});

// A 2D-context stand-in that records calls with the transform of the moment.
function recordingCtx() {
  const calls = [];
  const st = { m: [1, 0, 0, 1, 0, 0], stack: [] };
  const t = {
    calls, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '', font: '10px x', textAlign: '', textBaseline: '', globalAlpha: 1,
    measureText: (s) => ({ width: [...s].length * 20, actualBoundingBoxAscent: 72, actualBoundingBoxDescent: 16 }),
    setTransform(a, b, c, d, e, f) { st.m = [a, b, c, d, e, f]; },
    save() { st.stack.push(st.m.slice()); }, restore() { st.m = st.stack.pop(); },
    translate(x, y) { st.m[4] += st.m[0] * x + st.m[2] * y; st.m[5] += st.m[1] * x + st.m[3] * y; },
    rotate(a) { const [m0, m1, m2, m3] = st.m, c = Math.cos(a), s = Math.sin(a); st.m[0] = m0 * c + m2 * s; st.m[1] = m1 * c + m3 * s; st.m[2] = m2 * c - m0 * s; st.m[3] = m3 * c - m1 * s; },
    scale(x, y) { st.m[0] *= x; st.m[1] *= x; st.m[2] *= y; st.m[3] *= y; },
  };
  return new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      return (...args) => calls.push({ name: k, args, m: st.m.slice(), fill: o.fillStyle, alpha: o.globalAlpha });
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

check('markings: paint order, half-court line band z ∈ [−0.0254, 0], apron, key', () => {
  const W = 2048, H = 1632;
  const ctx = recordingCtx();
  drawMarkings(ctx, W, H, { wordmark: 'LEGENDS 3V3', zh: 'X' });
  const fills = ctx.calls.filter((c) => c.name === 'fillRect' && c.m[0] !== 1);
  // Half line: the band ends exactly at the canvas bottom (z = 0) and is 0.0254 m tall (mirror → 0.0508).
  const band = fills.find((c) => Math.abs(c.args[3] - HALF_LINE_BAND) < 1e-12);
  assert.ok(band, 'half-line band drawn');
  assert.equal(HALF_LINE_BAND * 2, LINE_W);
  const top = apply(band.m, band.args[0], band.args[1]);
  const bottom = apply(band.m, band.args[0], band.args[1] + band.args[3]);
  assert.ok(Math.abs(bottom[1] - H) < 1e-6, 'band bottom at the last row (z = 0)');
  assert.ok(Math.abs((bottom[1] - top[1]) / (H / MARK_HALF_D) - 0.0254) < 1e-9);
  // Apron fills first (α 0.96), then the key (α 0.90) covering x ±2.44, z −14.325…−8.535.
  assert.ok(fills[0].fill.includes('0.96'));
  const key = fills.find((c) => c.fill.includes('0.90') && Math.abs(c.args[2] - 2 * LINES.KEY_HALF_W) < 1e-9);
  assert.ok(key);
  assert.ok(Math.abs(key.args[1] - COURT.BASELINE_Z) < 1e-9 && Math.abs(key.args[1] + key.args[3] - LINES.FT_Z) < 1e-9);
  // Three-point arc about the rim with r 7.24; FT circle dashed 0.35 / 0.25.
  assert.ok(ctx.calls.some((c) => c.name === 'arc' && c.args[0] === RIM.x && c.args[1] === RIM.z && c.args[2] === LINES.THREE_R));
  assert.ok(ctx.calls.some((c) => c.name === 'setLineDash' && c.args[0][0] === 0.35 && c.args[0][1] === 0.25));
  // Wordmark at (0, −16.0): glyphs drawn in pixel space around that point, gold α 0.90.
  const texts = ctx.calls.filter((c) => c.name === 'fillText');
  assert.equal(texts.filter((c) => c.alpha === 0.9).length, [...'LEGENDS 3V3'].length);
  const first = texts[0];
  const p = apply(first.m, first.args[1], first.args[2]);
  const want = worldToMarkPx(0, -16.0, W, H);
  assert.ok(Math.abs(p[1] - want.py) < 0.6 * H / MARK_HALF_D, 'wordmark row');
  // The zh brand is rotated ∓90° on both side aprons (x ±9.3, z −7.0).
  const zh = texts.filter((c) => c.args[0] === 'X');
  assert.equal(zh.length, 2);
  assert.ok(Math.abs(zh[0].m[1] + 1) < 1e-9 && Math.abs(zh[1].m[1] - 1) < 1e-9);
});

check('floor / decal / LED / jumbotron strings come from i18n and are denylist-clean', () => {
  const s = markingStrings();
  assert.ok(s.wordmark.length > 0 && s.zh.length > 0);
  for (const lang of ['zh', 'en']) {
    const T = STRINGS[lang];
    for (const k of ['brand.wordmark', 'brand.zh', 'led.brand', 'led.defense', 'led.noise', 'led.clutch', 'led.gg', 'led.score',
      'jumbo.dunk', 'jumbo.three', 'jumbo.block', 'jumbo.winner', 'jumbo.final']) {
      assert.ok(typeof T[k] === 'string' && T[k].length > 0, lang + ' ' + k);
      assert.equal(denylistClean(T[k]), null, lang + ' ' + k);
    }
  }
  assert.equal(denylistClean(s.wordmark + ' ' + s.zh), null);
  // The self-check works.
  assert.equal(denylistClean('NBA Finals'), 'NBA');
});

check('centre decal and board markings draw on any Canvas2D-like context', () => {
  const ctx = recordingCtx();
  drawCentreDecal(ctx, 512, { wordmark: 'LEGENDS', zh: 'X' });
  assert.ok(ctx.calls.filter((c) => c.name === 'fillText').length >= 9);
  const b = recordingCtx();
  drawBoardMarkings(b, 512, 256, 0);
  const rects = b.calls.filter((c) => c.name === 'strokeRect');
  assert.equal(rects.length, 2);
  // Shooter's square: bottom edge (outer) at the rim height row.
  const py = 256 / 1.07;
  const sq = rects[1];
  const bottom = sq.args[1] + sq.args[3] + 0.05 * Math.min(512 / 1.83, py) / 2;
  assert.ok(Math.abs(bottom - (3.97 - RIM.y) * py) < 1e-6);
});

console.log(`\n${passed} checks passed`);
