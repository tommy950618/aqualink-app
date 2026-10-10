// Unit checks for the vector block numerals and kit layout of src/legends/kitPainter.js (spec v2 §3.8, [CHR §7.3,
// §12]): 10 digits on the 4 × 8 grid, advance / height constants, the 24 / 23 / 34 / 11 / 2 layouts fit their front
// and back number boxes (after the horizontal squeeze the painter applies), serif '1', kit resolution per mode,
// atlas rects and UV mapping.
// Run: node test/unit-glyphs.mjs
import assert from 'node:assert/strict';
import { GLYPHS, GLYPH, glyphInk, layoutNumber, KIT_LAYOUT, SHELL_RECT, resolveKit, shoeColors, atlasMap, mapToAtlas, swatchU } from '../src/legends/kitPainter.js';
import { LEGENDS, LEGEND_IDS } from '../src/legends.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

check('ten digits, every stroke on the 4 × 8 grid', () => {
  for (let d = 0; d <= 9; d++) {
    const g = GLYPHS[d];
    assert.ok(Array.isArray(g) && g.length >= 1, `digit ${d}`);
    for (const s of g) {
      assert.ok(s.p.length >= 2);
      for (const [x, y] of s.p) assert.ok(x >= 0 && x <= 4 && y >= 0 && y <= 8, `${d}: ${x},${y}`);
    }
  }
  assert.equal(Object.keys(GLYPHS).filter((k) => /^[0-9]$/.test(k)).length, 10);
  assert.ok(GLYPHS[0][0].closed && GLYPHS[8][0].closed && !GLYPHS[2][0].closed);
});

check('constants: line 1.6 u, outline 0.45, keyline 0.50, advance 6.8 (1: 4.6), height 9.6', () => {
  assert.equal(GLYPH.lineWidth, 1.6);
  assert.equal(GLYPH.outline, 0.45);
  assert.equal(GLYPH.keyline, 0.50);
  assert.equal(GLYPH.advance, 6.8);
  assert.equal(GLYPH.advanceOne, 4.6);
  assert.equal(GLYPH.height, 9.6);
  // height incl. strokes = 8 + line width
  assert.ok(Math.abs(8 + GLYPH.lineWidth - GLYPH.height) < 1e-9);
  const l = layoutNumber('11');
  assert.equal(l.glyphs[1].x, 4.6);
  assert.equal(layoutNumber('23').glyphs[1].x, 6.8);
});

check('serif 1 adds the foot; ink extents', () => {
  assert.deepEqual(glyphInk('1', false), [1, 2.2]);
  assert.deepEqual(glyphInk('1', true), [0.8, 3.6]);
  assert.deepEqual(glyphInk('0', false), [0, 4]);
  const plain = layoutNumber('11', {}), serif = layoutNumber('11', { serifOne: true });
  assert.ok(serif.width > plain.width);
});

check('24, 23, 34, 11, 2 fit their back and front boxes (after the squeeze), height within the box', () => {
  for (const str of ['24', '23', '34', '11', '2']) {
    for (const side of ['front', 'back']) {
      for (const style of [{}, { serifOne: true, keyline: true }, { outlineU: 0.30 }]) {
        const N = KIT_LAYOUT.number[side], lay = layoutNumber(str, style), unit = N.heightM / GLYPH.height;
        const squeeze = Math.min(1, N.boxW / (lay.width * unit));
        assert.ok(lay.width * unit * squeeze <= N.boxW + 1e-9, `${str} ${side} width`);
        assert.ok(squeeze >= 0.6, `${str} ${side} squeeze ${squeeze} stays legible`);
        assert.ok(lay.height * unit <= N.boxH + 1e-9, `${str} ${side} height ${lay.height * unit}`);
      }
    }
  }
  assert.equal(KIT_LAYOUT.number.front.heightM, 0.20);
  assert.equal(KIT_LAYOUT.number.back.heightM, 0.28);
});

check('every player number lays out (digits only) and the kit modes resolve', () => {
  for (const id of LEGEND_IDS) {
    const L = LEGENDS[id];
    assert.ok(/^[0-9]+$/.test(L.number));
    const c = resolveKit(L, 'classic'), a = resolveKit(L, 'allstarA'), b = resolveKit(L, 'allstarB'), g = resolveKit(L, 'grey');
    assert.equal(c.base, L.kit[L.kit.classic].base);
    assert.equal(a.base, '#F4F4F1');
    assert.equal(b.base, '#121212');
    assert.equal(a.number, L.number);
    assert.equal(g.numbers, false);
    assert.equal(c.backName, L.kit.backName);
    assert.ok(shoeColors(L, 'classic').upper && shoeColors(L, 'allstarA').outsole);
  }
  assert.equal(resolveKit(LEGENDS.kobe, 'allstarB').accessories.sleeve_r, '#111111', 'sleeve never recoloured');
  assert.equal(resolveKit(LEGENDS.kobe, 'allstarB').accessories.tape_r_im, '#111111');
  assert.equal(resolveKit(LEGENDS.lebron, 'allstarA').accessories.headband_high, '#FFFFFF');
  assert.equal(resolveKit(LEGENDS.jordan, 'classic').accessories.wristband_l, '#CE1141');
  assert.equal(resolveKit(LEGENDS.yao, 'classic').keyline, '#000000');
  assert.equal(resolveKit(LEGENDS.kobe, 'classic').glyph, 'rounded');
  assert.equal(shoeColors(LEGENDS.jordan, 'classic').outsole, '#CE1141', 'Jordan classic = away colourway');
  assert.equal(shoeColors(LEGENDS.jordan, 'allstarA').outsole, '#a8d8f0', 'All-Star A = home colourway');
  assert.equal(shoeColors(LEGENDS.jordan, 'allstarA').panel, null, 'no side panel on Jordan home');
});

check('atlas rects inside the unit square, non-overlapping; UV mapping inside the rect with gutters', () => {
  const R = Object.entries(KIT_LAYOUT.rects);
  for (const [, r] of R) assert.ok(r[0] >= 0 && r[1] >= 0 && r[2] <= 1 && r[3] <= 1 && r[2] > r[0] && r[3] > r[1]);
  for (let i = 0; i < R.length; i++) {
    for (let j = i + 1; j < R.length; j++) {
      const a = R[i][1], b = R[j][1];
      const overlap = a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
      assert.ok(!overlap, `${R[i][0]} overlaps ${R[j][0]}`);
    }
  }
  for (const shell of Object.keys(SHELL_RECT)) assert.ok(KIT_LAYOUT.rects[SHELL_RECT[shell]]);
  const m = atlasMap('socks', [0.005, 0, 1.0714, 1]), o = [0, 0];
  for (const [u, v] of [[0.005, 0], [1.0714, 1], [0.5, 0.5]]) {
    mapToAtlas(m, u, v, o);
    const r = KIT_LAYOUT.rects.socks;
    assert.ok(o[0] > r[0] && o[0] < r[2], 'x inside the rect');
    assert.ok(1 - o[1] > r[1] && 1 - o[1] < r[3], 'y inside the rect');
  }
  const j = atlasMap('jersey', [0, 0, 1.05, 0.96]);
  assert.equal(j.u0, -0.04);
  assert.ok(j.u1 >= 1.055);
  assert.ok(swatchU('lining') > 0 && swatchU('lining') < 1);
});

console.log(`\nunit-glyphs: ${passed} passed`);
