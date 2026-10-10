/**
 * @module legends/kitPainter
 * Kit atlas painter (spec v2 §2.7, §3.8, [CHR §7.1–§7.8]): jersey, shorts, socks, accessories and sneakers of one
 * player in one 1024² (512² on low) atlas, painted with canvas 2D and read back into an RGBA `DataTexture`
 * (rgb = sRGB albedo, a = linear roughness from a parallel grey canvas).
 *
 * Exports
 *   KIT_LAYOUT                  atlas rects, gutters, roughness values, number / name dimensions, fold counts
 *   SHELL_RECT                  shell name → atlas rect name
 *   GLYPHS, GLYPH               vector block numerals (4 × 8 grid, centre-line strokes) and their constants
 *   glyphInk(d, serif), layoutNumber(str, style)   pure layout in glyph units (Node-testable)
 *   resolveKit(legend, mode)    → resolved colours of a kit mode ('classic'|'allstarA'|'allstarB'|'grey')
 *   shoeColors(legend, mode)    → normalised sneaker colourway
 *   atlasMap(rectName, uvRange?) / mapToAtlas(map, u, v, out)   local UV → atlas UV (also used by the assembler)
 *   paintKit(ctx2d, rough2d, job, size)   paints one atlas (albedo canvas + roughness canvas)
 *   readKit(ctx2d, rough2d, size, out)    → canvas pixels flipped into DataTexture order (row 0 = v 0)
 *   kitTexture(data, size, anisotropy)    → THREE.DataTexture
 *
 * Atlas convention: canvas y down; local (u, v) of a rect → canvas x = x0 + (u − u0)/(u1 − u0)·(x1 − x0),
 * y = y1 − (v − v0)/(v1 − v0)·(y1 − y0) over the rect INSET by the gutter (8 px at 1024², 4 px at 512² = the same
 * fraction 8/1024), so painting the whole rect paints the gutter as a continuation of the content; atlas UV =
 * (x/S, 1 − y/S) because readKit flips the canvas rows into the bottom-up texture.
 *
 * Sizes on the cloth (trim mm, number heights, name cap height) are player metres. The `job.surfaces[shell].metric`
 * of each worn shell gives the local metres per unit u and per unit v measured on the player's own shell mesh (the
 * Jacobian of the UV map, see shells.js `uvMetric`), so the header perimeter table / kitScaleV approximation is not
 * needed: it is exact at the drawing location (front number, side stripe, each trim segment).
 */
import * as THREE from '../../vendor/three.module.js';
import { ALLSTAR_KITS } from '../legends.js';

const GUTTER = 8 / 1024;

/** Atlas layout and paint constants (§3.8 / [CHR §7]). Rects are (x0, y0, x1, y1) canvas fractions, y down. */
export const KIT_LAYOUT = Object.freeze({
  rects: Object.freeze({
    jersey: [0, 0, 1, 0.50], shorts: [0, 0.50, 1, 0.74], socks: [0, 0.74, 0.50, 0.82], sleeve: [0.50, 0.74, 0.75, 0.82],
    headband: [0.75, 0.74, 1.0, 0.78], wristband: [0.75, 0.78, 1.0, 0.82], tape: [0, 0.82, 0.25, 0.84],
    swatch: [0.25, 0.82, 1.0, 0.84], upper: [0, 0.84, 0.75, 1.0], soleWall: [0.75, 0.84, 1.0, 0.92], soleBottom: [0.75, 0.92, 1.0, 1.0],
  }),
  gutter: GUTTER,
  /** swatch cells (equal widths across the swatch rect) */
  swatches: Object.freeze(['lining', 'midsole', 'outsole', 'black']),
  rough: Object.freeze({
    jersey: 0.78, shorts: 0.72, socks: 0.90, sleeve: 0.45, cuff: 0.35, headband: 0.95, wristband: 0.95, tape: 0.70,
    number: 0.60, trim: 0.70, leather: 0.45, mesh: 0.75, rubber: 0.85, midsole: 0.75,
  }),
  number: Object.freeze({
    front: Object.freeze({ heightM: 0.20, centreY: 0.334, u: 0.75, boxW: 0.22, boxH: 0.25 }),
    back: Object.freeze({ heightM: 0.28, centreY: 0.315, u: 0.25, boxW: 0.26, boxH: 0.34 }),
  }),
  name: Object.freeze({ capM: 0.065, centreY: 0.475, u: 0.25, maxW: 0.30, sag: 0.015,
    family: '"Arial Narrow","Roboto Condensed","Helvetica Neue",Arial,sans-serif', weight: 800 }),
  folds: Object.freeze({ shortsPerLeg: 6, shortsWidthM: [0.02, 0.04], shortsLum: 0.08, shortsTopV: 0.45,
    jerseyPerArmhole: 2, jerseyLum: 0.06, jerseyWidthM: 0.035 }),
  sleeveCuffM: 0.025,
});

/** Worn shell → atlas rect. */
export const SHELL_RECT = Object.freeze({
  jersey: 'jersey', shorts: 'shorts', socks_low: 'socks', socks_crew: 'socks', socks_mid: 'socks', socks_high: 'socks',
  socks_high_brace: 'socks', socks_crew_brace: 'socks', sleeve_r: 'sleeve', tape_r_im: 'tape', wristband_l: 'wristband',
  headband_high: 'headband', headband_low: 'headband',
});

/** Glyph constants (§3.8): line width, outline / keyline growth per side, advances and full height (units). */
export const GLYPH = Object.freeze({ lineWidth: 1.6, outline: 0.45, keyline: 0.50, advance: 6.8, advanceOne: 4.6, height: 9.6 });

const S = (closed, ...p) => Object.freeze({ closed, p: Object.freeze(p.map((q) => Object.freeze(q))) });
/** Block numerals: centre-line strokes on a 4 × 8 box (x right, y down). `'1s'` = the serif foot of a serif '1'. */
export const GLYPHS = Object.freeze({
  0: Object.freeze([S(true, [0, 0], [4, 0], [4, 8], [0, 8])]),
  1: Object.freeze([S(false, [1, 1.2], [2.2, 0], [2.2, 8])]),
  2: Object.freeze([S(false, [0, 0], [4, 0], [4, 4], [0, 4], [0, 8], [4, 8])]),
  3: Object.freeze([S(false, [0, 0], [4, 0], [4, 8], [0, 8]), S(false, [1.2, 4], [4, 4])]),
  4: Object.freeze([S(false, [0, 0], [0, 5], [4, 5]), S(false, [3, 0], [3, 8])]),
  5: Object.freeze([S(false, [4, 0], [0, 0], [0, 4], [4, 4], [4, 8], [0, 8])]),
  6: Object.freeze([S(false, [4, 0], [0, 0], [0, 8], [4, 8], [4, 4], [0, 4])]),
  7: Object.freeze([S(false, [0, 0], [4, 0], [1.6, 8])]),
  8: Object.freeze([S(true, [0, 0], [4, 0], [4, 8], [0, 8]), S(false, [0, 4], [4, 4])]),
  9: Object.freeze([S(false, [4, 4], [0, 4], [0, 0], [4, 0], [4, 8], [0, 8])]),
  '1s': Object.freeze([S(false, [0.8, 8], [3.6, 8])]),
});

/** Strokes of digit d (with the serif foot when `serif` and d = '1'). */
function strokesOf(d, serif) {
  const g = GLYPHS[d];
  if (!g) throw new Error(`kitPainter: no glyph ${d}`);
  return serif && d === '1' ? g.concat(GLYPHS['1s']) : g;
}

/**
 * Horizontal ink extent of a digit's centre-line strokes (units, before the stroke half width): [xMin, xMax].
 */
export function glyphInk(d, serif) {
  let a = Infinity, b = -Infinity;
  for (const s of strokesOf(d, serif)) for (const p of s.p) { if (p[0] < a) a = p[0]; if (p[0] > b) b = p[0]; }
  return [a, b];
}

/**
 * Lays out a number string in glyph units. Pen starts at 0; each glyph advances 6.8 u ('1' 4.6 u).
 * `half` = half the widest stroke layer (fill 0.8 + outline 0.45 + keyline 0.50 when present).
 * @param {string} str
 * @param {{serifOne?: boolean, outlineU?: number, keyline?: boolean}} [style]
 * @returns {{glyphs: Array<{d, x}>, inkX0, inkX1, width, height, centreX, half}}
 */
export function layoutNumber(str, style) {
  const st = style || {};
  const half = GLYPH.lineWidth / 2 + (st.outlineU != null ? st.outlineU : GLYPH.outline) + (st.keyline ? GLYPH.keyline : 0);
  const glyphs = [];
  let pen = 0, x0 = Infinity, x1 = -Infinity;
  for (const d of String(str)) {
    const ink = glyphInk(d, !!st.serifOne);
    glyphs.push({ d, x: pen });
    x0 = Math.min(x0, pen + ink[0] - half);
    x1 = Math.max(x1, pen + ink[1] + half);
    pen += d === '1' ? GLYPH.advanceOne : GLYPH.advance;
  }
  // square caps add half a line width beyond the end points; the glyph box is 8 tall + strokes = 9.6 u (+ outline)
  const height = 8 + 2 * half;
  return { glyphs, inkX0: x0, inkX1: x1, width: x1 - x0, height, centreX: (x0 + x1) / 2, half };
}

/** Normalised colourway (`[c0, c1, c2]` arrays or Jordan's override objects, §2.7). */
function normShoes(cw) {
  if (Array.isArray(cw)) {
    return { id: null, upper: cw[0], upperRough: KIT_LAYOUT.rough.leather, accent: cw[1], panel: cw[2], mudguard: null,
      mudguardRough: 0, heelTab: null, midsole: '#F2F2F0', outsole: cw[2], outsoleRough: KIT_LAYOUT.rough.rubber, lining: cw[1], laces: cw[0] };
  }
  const up = typeof cw.upper === 'string' ? { color: cw.upper, roughness: KIT_LAYOUT.rough.leather } : cw.upper;
  const mg = cw.mudguard || null;
  return {
    id: cw.id || null, upper: up.color, upperRough: up.roughness, accent: mg ? mg.color : up.color,
    panel: cw.sidePanel === false ? null : (cw.panel || null), mudguard: mg ? mg.color : null, mudguardRough: mg ? mg.roughness : 0,
    heelTab: cw.heelTab || null, midsole: cw.midsole || '#F2F2F0', outsole: cw.outsole.color, outsoleRough: cw.outsole.roughness,
    lining: up.color === '#FFFFFF' ? '#FFFFFF' : (mg ? mg.color : up.color), laces: up.color,
  };
}

/** Sneaker colourway for a kit mode: classic → `shoes.classic`, All-Star A → home, B → away (§2.7). */
export function shoeColors(legend, mode) {
  const sh = legend.kit.shoes;
  const side = mode === 'allstarA' ? 'home' : mode === 'allstarB' ? 'away' : sh.classic;
  const out = normShoes(sh[side]);
  if (mode === 'grey') {
    for (const k of ['upper', 'accent', 'panel', 'mudguard', 'heelTab', 'midsole', 'outsole', 'lining', 'laces']) if (out[k]) out[k] = '#808080';
  }
  return out;
}

/**
 * Resolved colours of one kit mode (pure). `grey` (showcase `kit=grey`, §10.4) forces every kit colour to #808080 and
 * turns numbers / names off.
 */
export function resolveKit(legend, mode) {
  const K = legend.kit;
  const classic = K[K.classic];
  const acc = {};
  for (const a of K.accessories) if (a.shell && a.worn) acc[a.shell] = a.colors ? (a.colors[mode] || a.colors.classic) : '#111111';
  const base = {
    mode, number: legend.number, backName: K.backName, glyph: classic.glyph, serifOne: classic.serifOne,
    outlineU: GLYPH.outline, keyline: classic.keyline, numbers: true,
    undershort: K.extras.undershort, shortsNumber: K.extras.shortsNumber,
    socks: K.socks.color, accessories: acc, shoes: shoeColors(legend, mode),
  };
  if (mode === 'allstarA' || mode === 'allstarB') {
    const A = ALLSTAR_KITS[mode];
    for (const k of Object.keys(acc)) if (k !== 'sleeve_r') acc[k] = A.accessory;
    return Object.assign(base, {
      base: A.base, numberColor: A.number, outline: A.outline, outlineU: A.outlineU != null ? A.outlineU : GLYPH.outline,
      keyline: null, glyph: 'block', serifOne: false, bands: A.bands, shortsStripe: A.shortsStripe,
      waistband: A.waistband || [], hem: A.hem || [], socks: A.socks,
    });
  }
  if (mode === 'grey') {
    for (const k of Object.keys(acc)) acc[k] = '#808080';
    return Object.assign(base, { base: '#808080', numberColor: '#808080', outline: '#808080', keyline: null, numbers: false,
      bands: [], shortsStripe: [], waistband: [], hem: [], socks: '#808080', undershort: null, shortsNumber: null });
  }
  return Object.assign(base, {
    base: classic.base, numberColor: classic.number, outline: classic.outline,
    bands: classic.bands, shortsStripe: classic.shortsStripe, waistband: classic.waistband, hem: classic.hem,
  });
}

/**
 * Local-UV → atlas mapping of a rect. Cloth shells pass their header `uvRange` so seam-crossing UVs (u up to ≈ 1.14)
 * stay inside the rect: u span = [min(−0.04, uMin − 0.005), max(1.04, uMax + 0.005)] ([CHR §7.1] −0.04 … 1.04,
 * widened where the bake needs it); v span 0 … 1. Without a range (sneaker parts, swatches) u, v span 0 … 1.
 */
export function atlasMap(rectName, uvRange) {
  const r = KIT_LAYOUT.rects[rectName];
  if (!r) throw new Error(`kitPainter: no rect ${rectName}`);
  const m = { rect: rectName, x0: r[0] + GUTTER, y0: r[1] + GUTTER, x1: r[2] - GUTTER, y1: r[3] - GUTTER, u0: 0, u1: 1, v0: 0, v1: 1,
    fx0: r[0], fy0: r[1], fx1: r[2], fy1: r[3] };
  if (uvRange) { m.u0 = Math.min(-0.04, uvRange[0] - 0.005); m.u1 = Math.max(1.04, uvRange[2] + 0.005); }
  return m;
}

/** Atlas texture UV of local (u, v) (writes out[0..1]). */
export function mapToAtlas(m, u, v, out) {
  out[0] = m.x0 + (u - m.u0) / (m.u1 - m.u0) * (m.x1 - m.x0);
  out[1] = 1 - (m.y1 - (v - m.v0) / (m.v1 - m.v0) * (m.y1 - m.y0));
  return out;
}

// ------------------------------------------------------------------------------------------------- canvas helpers

const px = (m, u, S) => (m.x0 + (u - m.u0) / (m.u1 - m.u0) * (m.x1 - m.x0)) * S;
const py = (m, v, S) => (m.y1 - (v - m.v0) / (m.v1 - m.v0) * (m.y1 - m.y0)) * S;
/** Pixels per unit u / v of a mapping. */
const pxU = (m, S) => (m.x1 - m.x0) * S / (m.u1 - m.u0);
const pxV = (m, S) => (m.y1 - m.y0) * S / (m.v1 - m.v0);
const grey = (r) => { const g = Math.round(Math.min(1, Math.max(0, r)) * 255); return `rgb(${g},${g},${g})`; };

function hexRgb(hex) {
  const v = parseInt(String(hex).slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function shade(hex, k) {
  const c = hexRgb(hex).map((x) => Math.round(Math.min(255, Math.max(0, x * k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Deterministic RNG for the fold layout (mulberry32). */
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fills the whole rect (gutters included) on both canvases. */
function fillRect(ctx, rctx, rectName, color, rough, S) {
  const r = KIT_LAYOUT.rects[rectName];
  const x = r[0] * S, y = r[1] * S, w = (r[2] - r[0]) * S, h = (r[3] - r[1]) * S;
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  rctx.fillStyle = grey(rough); rctx.fillRect(x, y, w, h);
}

function clipRect(c, rectName, S) {
  const r = KIT_LAYOUT.rects[rectName];
  c.save();
  c.beginPath();
  c.rect(r[0] * S, r[1] * S, (r[2] - r[0]) * S, (r[3] - r[1]) * S);
  c.clip();
}

/** Offsets k (u + k) at which a polyline spanning [a, b] in u intersects the mapped u range. */
function wrapOffsets(m, a, b) {
  const out = [];
  for (let k = -2; k <= 2; k++) if (b + k >= m.u0 - 0.05 && a + k <= m.u1 + 0.05) out.push(k);
  return out;
}

/**
 * Strokes the bands of a boundary loop ([CHR §7.2] step 4): the band list `[{color, mm}]` runs from the edge inward;
 * each band is stroked at 2 × its cumulative width in descending order (only the inner half lies on the cloth).
 * The pen is anisotropic: the canvas transform is (px per metre along u, px per metre along v) at the loop, taken as
 * the median of the shell metric over the loop's segments (one smooth path per band; per-segment pens leave
 * saw-tooth edges where the metric changes along a strap), line width in metres, round caps / joins.
 */
function strokeLoop(ctx, rctx, surf, loop, bands, rough, S) {
  if (!bands || !bands.length || !loop || loop.uv.length < 2) return;
  const m = surf.map, P = loop.uv;
  let ua = Infinity, ub = -Infinity;
  for (const p of P) { if (p[0] < ua) ua = p[0]; if (p[0] > ub) ub = p[0]; }
  const cum = [];
  let acc = 0;
  for (const b of bands) { acc += b.mm / 1000; cum.push(acc); }
  const met = [0, 0], mus = [], mvs = [];
  for (let i = 0; i < P.length - 1; i++) {
    surf.metric((P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2, met);
    mus.push(met[0]); mvs.push(met[1]);
  }
  mus.sort((x, y) => x - y); mvs.sort((x, y) => x - y);
  const sx = pxU(m, S) / mus[mus.length >> 1], sy = pxV(m, S) / mvs[mvs.length >> 1];   // px per metre
  const offs = wrapOffsets(m, ua, ub);
  for (const c of [ctx, rctx]) {
    clipRect(c, m.rect, S);
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.setTransform(sx, 0, 0, sy, 0, 0);
  }
  for (let bi = bands.length - 1; bi >= 0; bi--) {
    ctx.strokeStyle = bands[bi].color;
    rctx.strokeStyle = grey(rough);
    for (const c of [ctx, rctx]) {
      c.lineWidth = 2 * cum[bi];
      c.beginPath();
      for (const k of offs) {
        c.moveTo(px(m, P[0][0] + k, S) / sx, py(m, P[0][1], S) / sy);
        for (let i = 1; i < P.length; i++) c.lineTo(px(m, P[i][0] + k, S) / sx, py(m, P[i][1], S) / sy);
      }
      c.stroke();
    }
  }
  for (const c of [ctx, rctx]) { c.setTransform(1, 0, 0, 1, 0, 0); c.restore(); }
}

/** Soft lens-shaped band from (x0, y0) to (x1, y1) px, max width wPx, centre colour `rgba` (gradient across). */
function softBand(ctx, x0, y0, x1, y1, wPx, rgba) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l * wPx / 2, ny = dx / l * wPx / 2;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const g = ctx.createLinearGradient(mx - nx, my - ny, mx + nx, my + ny);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, rgba);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx + nx * 2, my + ny * 2, x1, y1);
  ctx.quadraticCurveTo(mx - nx * 2, my - ny * 2, x0, y0);
  ctx.fill();
}

function foldColor(sign, lum) {
  return sign > 0 ? `rgba(255,255,255,${lum})` : `rgba(0,0,0,${lum})`;
}

/** Shorts: 6 soft vertical folds per leg; jersey: 2 diagonal folds under each armhole ([CHR §7.2] step 2). */
function paintFolds(ctx, job, S) {
  const F = KIT_LAYOUT.folds, rnd = mulberry(4099 + 131 * (job.seed | 0));
  const met = [0, 0];
  const sh = job.surfaces.shorts;
  if (sh) {
    const m = sh.map;
    clipRect(ctx, m.rect, S);
    for (const kind of ['leg_l', 'leg_r']) {
      const loop = sh.info.loops.find((l) => l.kind === kind);
      if (!loop) continue;
      let ua = Infinity, ub = -Infinity;
      for (const p of loop.uv) { ua = Math.min(ua, p[0]); ub = Math.max(ub, p[0]); }
      for (let i = 0; i < F.shortsPerLeg; i++) {
        const u = ua + (ub - ua) * (i + 0.2 + 0.6 * rnd()) / F.shortsPerLeg;
        const wM = F.shortsWidthM[0] + (F.shortsWidthM[1] - F.shortsWidthM[0]) * rnd();
        sh.metric(u, 0.15, met);
        const wPx = wM / met[0] * pxU(m, S);
        const sign = rnd() < 0.5 ? -1 : 1;
        const top = F.shortsTopV * (0.7 + 0.3 * rnd()), lean = (rnd() - 0.5) * 0.02;
        for (const k of wrapOffsets(m, u, u)) {
          softBand(ctx, px(m, u + k, S), py(m, -0.02, S), px(m, u + k + lean, S), py(m, top, S), wPx, foldColor(sign, F.shortsLum));
        }
      }
    }
    ctx.restore();
  }
  const je = job.surfaces.jersey;
  if (je) {
    const m = je.map;
    clipRect(ctx, m.rect, S);
    for (const kind of ['armhole_l', 'armhole_r']) {
      const loop = je.info.loops.find((l) => l.kind === kind);
      if (!loop) continue;
      let pit = loop.uv[0];
      for (const p of loop.uv) if (p[1] < pit[1]) pit = p;
      je.metric(pit[0], pit[1] - 0.1, met);
      const wPx = F.jerseyWidthM / met[0] * pxU(m, S);
      for (let i = 0; i < F.jerseyPerArmhole; i++) {
        const dir = i === 0 ? 1 : -1;                             // toward u + (front for the right side) / u −
        const sign = rnd() < 0.5 ? -1 : 1;
        const du = 0.10 / met[0] * 0.25;                          // ≈ 2.5 cm sideways per 10 cm of drop
        for (const k of wrapOffsets(m, pit[0] - 0.2, pit[0] + 0.2)) {
          const u0 = pit[0] + k + dir * 0.01, v0 = pit[1] - 0.02;
          softBand(ctx, px(m, u0, S), py(m, v0, S), px(m, u0 + dir * du * 2.4, S), py(m, v0 - 0.30, S), wPx, foldColor(sign, F.jerseyLum));
        }
      }
    }
    ctx.restore();
  }
}

/** Shorts side stripes at u 0.5 and 0 ≡ 1, bands centred, width measured per height ([CHR §7.2] step 3). */
function paintStripes(ctx, rctx, job, kit, S) {
  const sh = job.surfaces.shorts;
  const bands = kit.shortsStripe;
  if (!sh || !bands || !bands.length) return;
  const m = sh.map;
  const total = bands.reduce((a, b) => a + b.mm, 0) / 1000;
  const met = [0, 0], N = 24;
  for (const c of [ctx, rctx]) clipRect(c, m.rect, S);
  for (const uc of [0, 0.5, 1]) {
    let off = -total / 2;
    for (const b of bands) {
      const a0 = off, a1 = off + b.mm / 1000;
      off = a1;
      const left = [], right = [];
      for (let i = 0; i <= N; i++) {
        const v = -0.02 + 1.04 * i / N;
        sh.metric(uc, Math.min(0.98, Math.max(0.02, v)), met);
        left.push([px(m, uc + a0 / met[0], S), py(m, v, S)]);
        right.push([px(m, uc + a1 / met[0], S), py(m, v, S)]);
      }
      ctx.fillStyle = b.color;
      rctx.fillStyle = grey(KIT_LAYOUT.rough.trim);
      for (const c of [ctx, rctx]) {
        c.beginPath();
        c.moveTo(left[0][0], left[0][1]);
        for (const p of left) c.lineTo(p[0], p[1]);
        for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
        c.closePath();
        c.fill();
      }
    }
  }
  for (const c of [ctx, rctx]) c.restore();
}

/** Draws a number string centred at canvas (cx, cy) with px-per-unit (sxu, syu) (§3.8 glyphs). */
function drawNumber(ctx, rctx, str, kit, cx, cy, sxu, syu) {
  const st = { serifOne: kit.serifOne, outlineU: kit.outlineU, keyline: !!kit.keyline };
  const lay = layoutNumber(str, st);
  const join = kit.glyph === 'rounded' ? 'round' : 'miter';
  const layers = [];
  if (kit.keyline) layers.push([kit.keyline, GLYPH.lineWidth + 2 * (kit.outlineU + GLYPH.keyline)]);
  layers.push([kit.outline, GLYPH.lineWidth + 2 * kit.outlineU]);
  layers.push([kit.numberColor, GLYPH.lineWidth]);
  for (let li = 0; li < layers.length; li++) {
    const [color, lw] = layers[li];
    const targets = li === 0 ? [ctx, rctx] : [ctx];
    for (const c of targets) {
      c.setTransform(sxu, 0, 0, syu, cx - lay.centreX * sxu, cy - 4 * syu);
      c.lineWidth = lw;
      c.lineCap = 'square';
      c.lineJoin = join;
      c.miterLimit = 10;
      c.strokeStyle = c === ctx ? color : grey(KIT_LAYOUT.rough.number);
      for (const g of lay.glyphs) {
        for (const s of strokesOf(g.d, st.serifOne)) {
          c.beginPath();
          c.moveTo(g.x + s.p[0][0], s.p[0][1]);
          for (let i = 1; i < s.p.length; i++) c.lineTo(g.x + s.p[i][0], s.p[i][1]);
          if (s.closed) c.closePath();
          c.stroke();
        }
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  rctx.setTransform(1, 0, 0, 1, 0, 0);
  return lay;
}

/** Front and back numbers on the jersey, squeezed horizontally only if wider than their box. */
function paintNumbers(ctx, rctx, job, kit, S) {
  const je = job.surfaces.jersey;
  if (!je || !kit.numbers) return;
  const m = je.map, vr = je.info.vRange, met = [0, 0];
  for (const c of [ctx, rctx]) clipRect(c, m.rect, S);
  for (const side of ['front', 'back']) {
    const N = KIT_LAYOUT.number[side];
    const v = (N.centreY - vr[0]) / (vr[1] - vr[0]);
    je.metric(N.u, v, met);
    const unitM = N.heightM / GLYPH.height;
    const lay = layoutNumber(kit.number, { serifOne: kit.serifOne, outlineU: kit.outlineU, keyline: !!kit.keyline });
    const squeeze = Math.min(1, N.boxW / (lay.width * unitM));
    const sxu = unitM / met[0] * pxU(m, S) * squeeze, syu = unitM / met[1] * pxV(m, S);
    drawNumber(ctx, rctx, kit.number, kit, px(m, N.u, S), py(m, v, S), sxu, syu);
  }
  for (const c of [ctx, rctx]) c.restore();
}

/**
 * Width (metres) of cloth around centre u `uc` at local v between the nearest armhole-loop crossings (Infinity when
 * no armhole crosses that height, i.e. below the armpits).
 */
function backRoom(je, v, uc) {
  let lo = -Infinity, hi = Infinity;
  for (const l of je.info.loops) {
    if (l.kind !== 'armhole_l' && l.kind !== 'armhole_r') continue;
    const P = l.uv;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      if ((a[1] - v) * (b[1] - v) > 0 || a[1] === b[1]) continue;
      let u = a[0] + (b[0] - a[0]) * (v - a[1]) / (b[1] - a[1]);
      u -= Math.round(u - uc);                                  // nearest periodic copy to the centre
      if (u < uc && u > lo) lo = u;
      if (u > uc && u < hi) hi = u;
    }
  }
  if (!isFinite(lo) || !isFinite(hi)) return Infinity;
  const met = [0, 0];
  je.metric(uc, v, met);
  return (hi - lo) * met[0];
}

/** Arched surname on the back (§3.8 name): cap height 0.065 m, max width 0.30 m (scaleX squeeze), sag 0.015 m. */
function paintName(ctx, rctx, job, kit, S) {
  const je = job.surfaces.jersey;
  if (!je || !kit.numbers || !kit.backName) return;
  const NM = KIT_LAYOUT.name, m = je.map, vr = je.info.vRange, met = [0, 0];
  const v = (NM.centreY - vr[0]) / (vr[1] - vr[0]);
  je.metric(NM.u, v, met);
  const sx = pxU(m, S) / met[0], sy = pxV(m, S) / met[1];             // px per metre
  ctx.font = `${NM.weight} 100px ${NM.family}`;
  const mH = ctx.measureText('H');
  const capRatio = mH.actualBoundingBoxAscent > 0 ? mH.actualBoundingBoxAscent / 100 : 0.716;
  const capPx = NM.capM * sy, fontPx = capPx / capRatio;
  const font = `${NM.weight} ${fontPx.toFixed(2)}px ${NM.family}`;
  ctx.font = font; rctx.font = font;
  const letters = [...kit.backName];
  const widths = letters.map((ch) => ctx.measureText(ch).width / sy);    // metres (font is isotropic in metres)
  const W0 = widths.reduce((a, b) => a + b, 0);
  // the name must also stay between the armhole openings at its height (deep tank-top armholes reach above it)
  const room = 0.9 * backRoom(je, v, NM.u);
  const k = Math.min(1, Math.min(NM.maxW, room) / W0), W = W0 * k;
  const R = (W * W / 4 + NM.sag * NM.sag) / (2 * NM.sag);              // circle through both ends, sag at the middle
  const cx = px(m, NM.u, S), cy = py(m, v, S);
  for (const c of [ctx, rctx]) clipRect(c, m.rect, S);
  let x = -W / 2;
  for (let i = 0; i < letters.length; i++) {
    const wM = widths[i] * k, dx = x + wM / 2;
    x += wM;
    const drop = R - Math.sqrt(Math.max(0, R * R - dx * dx));            // ends sit lower: arch with the crown in the middle
    const ang = Math.asin(Math.max(-1, Math.min(1, dx / R)));
    for (const c of [ctx, rctx]) {
      c.setTransform(sx, 0, 0, sy, cx, cy);
      c.translate(dx, drop);
      c.rotate(ang);
      c.scale(k / sy, 1 / sy);
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillStyle = c === ctx ? kit.numberColor : grey(KIT_LAYOUT.rough.number);
      c.fillText(letters[i], 0, capPx / 2);
    }
  }
  for (const c of [ctx, rctx]) { c.setTransform(1, 0, 0, 1, 0, 0); c.restore(); }
}

/** Jordan's 0.075 m shorts number on the left leg front, 0.10 m above the hem (placement from the mesh). */
function paintShortsNumber(ctx, rctx, job, kit, S) {
  const sh = job.surfaces.shorts, sn = kit.shortsNumber;
  if (!sh || !sn || !kit.numbers || !job.shortsNumberUV) return;
  const m = sh.map, met = [0, 0];
  const [u, v] = job.shortsNumberUV;
  sh.metric(u, v, met);
  const unitM = sn.heightM / GLYPH.height;
  for (const c of [ctx, rctx]) clipRect(c, m.rect, S);
  drawNumber(ctx, rctx, kit.number, kit, px(m, u, S), py(m, v, S), unitM / met[0] * pxU(m, S), unitM / met[1] * pxV(m, S));
  for (const c of [ctx, rctx]) c.restore();
}

/** Trims along the baked boundary loops (§3.8 step 4) + the sleeve cuff band. */
function paintTrims(ctx, rctx, job, kit, S) {
  const R = KIT_LAYOUT.rough;
  const je = job.surfaces.jersey;
  if (je) for (const l of je.info.loops) if (l.kind === 'neck' || l.kind === 'armhole_l' || l.kind === 'armhole_r') strokeLoop(ctx, rctx, je, l, kit.bands, R.trim, S);
  const sh = job.surfaces.shorts;
  if (sh) {
    for (const l of sh.info.loops) {
      if (l.kind === 'waist') strokeLoop(ctx, rctx, sh, l, kit.waistband, R.trim, S);
      else if (l.kind === 'leg_l' || l.kind === 'leg_r') {
        const bands = kit.undershort ? [{ color: kit.undershort.color, mm: kit.undershort.widthM * 1000 }].concat(kit.hem) : kit.hem;
        strokeLoop(ctx, rctx, sh, l, bands, R.trim, S);
      }
    }
  }
  const sl = job.surfaces.sleeve_r;
  if (sl) {
    const color = kit.accessories.sleeve_r || '#111111';
    for (const l of sl.info.loops) if (l.kind === 'cuff') strokeLoop(ctx, rctx, sl, l, [{ color, mm: KIT_LAYOUT.sleeveCuffM * 1000 }], R.cuff, S);
  }
}

/** Sneaker upper / sole rects (§3.8, [CHR §7.6] colour parts; no logo shapes). */
function paintShoes(ctx, rctx, kit, S) {
  const C = kit.shoes, R = KIT_LAYOUT.rough;
  const up = atlasMap('upper');
  // (s, v) → px transform of the upper rect: x = s, y = v (v up)
  const T = (c) => c.setTransform((up.x1 - up.x0) * S, 0, 0, -(up.y1 - up.y0) * S, up.x0 * S, up.y1 * S);
  fillRect(ctx, rctx, 'upper', C.upper, C.upperRough, S);
  for (const c of [ctx, rctx]) { clipRect(c, 'upper', S); T(c); }
  const poly = (pts, color, rough) => {
    ctx.fillStyle = color; rctx.fillStyle = grey(rough);
    for (const c of [ctx, rctx]) {
      c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      c.closePath(); c.fill();
    }
  };
  const both = (fn) => { fn((v) => v); fn((v) => 1 - v); };              // medial (v < 0.5) and lateral mirror
  if (C.mudguard) {
    // lower 45 % of the upper height (v < 0.225 medial / > 0.775 lateral) for s > 0.10, patent; wraps the heel low
    both((f) => poly([[0.10, f(-0.05)], [1.05, f(-0.05)], [1.05, f(0.225)], [0.10, f(0.225)]], C.mudguard, C.mudguardRough));
    both((f) => poly([[-0.05, f(-0.05)], [0.10, f(-0.05)], [0.10, f(0.225)], [-0.05, f(0.225)]], C.mudguard, C.mudguardRough));
  } else {
    // heel counter s < 0.16 in the accent colour
    poly([[-0.05, -0.05], [0.16, -0.05], [0.16, 1.05], [-0.05, 1.05]], C.accent, R.leather);
  }
  if (C.panel) {
    // abstract curved side band: (s 0.12, 55 % height) → (s 0.62, 30 %), width 10 % of the height (0.05 in v), tapering
    both((f) => {
      const pts = [], back = [], n = 16;
      for (let i = 0; i <= n; i++) {
        const t = i / n, s = 0.12 + 0.50 * t;
        const h = 0.55 + (0.30 - 0.55) * t + 0.06 * Math.sin(Math.PI * t);
        const w = 0.10 * (1 - 0.85 * t) / 2;                    // half of "10 % of the height", tapering
        pts.push([s, f((h + w) / 2)]);                           // height fraction h → v = h / 2 (medial half)
        back.push([s, f((h - w) / 2)]);
      }
      poly(pts.concat(back.reverse()), C.panel, R.leather);
    });
  }
  // toe-cap seam (s 0.86) and eyestays + lace bars (s 0.24–0.60) / laces
  ctx.strokeStyle = shade(C.upper, 0.78); ctx.lineWidth = 0.004;
  ctx.beginPath(); ctx.moveTo(0.86, -0.05); ctx.lineTo(0.86, 1.05); ctx.stroke();
  for (const [a, b] of [[0.38, 0.43], [0.57, 0.62]]) poly([[0.22, a], [0.62, a], [0.62, b], [0.22, b]], C.accent, R.leather);
  for (let k = 0; k < 6; k++) {
    const s = 0.24 + k * (0.60 - 0.24) / 5;
    poly([[s - 0.006, 0.39], [s + 0.006, 0.39], [s + 0.006, 0.61], [s - 0.006, 0.61]], shade(C.laces, 0.72), R.leather);
    poly([[s - 0.0045, 0.40], [s + 0.0045, 0.40], [s + 0.0045, 0.60], [s - 0.0045, 0.60]], C.laces, R.leather);
  }
  if (C.heelTab) poly([[-0.05, 0.30], [0.06, 0.30], [0.06, 0.70], [-0.05, 0.70]], C.heelTab, R.leather);
  for (const c of [ctx, rctx]) { c.setTransform(1, 0, 0, 1, 0, 0); c.restore(); }
  // sole side wall: v < 0.25 outsole, above midsole
  const sw = KIT_LAYOUT.rects.soleWall;
  fillRect(ctx, rctx, 'soleWall', C.midsole, R.midsole, S);
  const wm = atlasMap('soleWall');
  const yCut = (wm.y1 - 0.25 * (wm.y1 - wm.y0)) * S;
  ctx.fillStyle = C.outsole; rctx.fillStyle = grey(C.outsoleRough);
  for (const c of [ctx, rctx]) c.fillRect(sw[0] * S, yCut, (sw[2] - sw[0]) * S, sw[3] * S - yCut);
  // sole bottom: outsole with a subtle herringbone (±6 % luminance)
  fillRect(ctx, rctx, 'soleBottom', C.outsole, C.outsoleRough, S);
  const sb = KIT_LAYOUT.rects.soleBottom;
  clipRect(ctx, 'soleBottom', S);
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = Math.max(1, S / 512);
  const x0 = sb[0] * S, y0 = sb[1] * S, w = (sb[2] - sb[0]) * S, h = (sb[3] - sb[1]) * S, step = Math.max(3, S / 170);
  for (let x = -h; x < w + h; x += step) {
    ctx.beginPath(); ctx.moveTo(x0 + x, y0); ctx.lineTo(x0 + x + h / 2, y0 + h / 2); ctx.lineTo(x0 + x, y0 + h); ctx.stroke();
  }
  ctx.restore();
  // swatches
  const swR = KIT_LAYOUT.rects.swatch, cells = KIT_LAYOUT.swatches, cw = (swR[2] - swR[0]) / cells.length;
  const swCol = { lining: C.lining, midsole: C.midsole, outsole: C.outsole, black: '#111111' };
  const swRough = { lining: R.leather, midsole: R.midsole, outsole: C.outsoleRough, black: R.leather };
  cells.forEach((name, i) => {
    ctx.fillStyle = swCol[name]; rctx.fillStyle = grey(swRough[name]);
    for (const c of [ctx, rctx]) c.fillRect((swR[0] + i * cw) * S, swR[1] * S, cw * S + 1, (swR[3] - swR[1]) * S);
  });
}

/** Local swatch coordinate (u in the swatch rect's 0..1 span) of a named cell. */
export function swatchU(name) {
  const i = KIT_LAYOUT.swatches.indexOf(name);
  return (i + 0.5) / KIT_LAYOUT.swatches.length;
}

/**
 * Paints a whole kit atlas.
 * @param {CanvasRenderingContext2D} ctx   albedo canvas (S × S)
 * @param {CanvasRenderingContext2D} rctx  roughness canvas (S × S, grey = round(255·roughness))
 * @param {{kit: object, surfaces: Object<string, {info, map, metric(u, v, out)}>, seed: number,
 *          shortsNumberUV?: [number, number]}} job   kit = resolveKit(...); surfaces of the worn cloth shells
 * @param {number} S
 */
export function paintKit(ctx, rctx, job, S) {
  const kit = job.kit, R = KIT_LAYOUT.rough;
  for (const c of [ctx, rctx]) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, S, S);
  rctx.fillStyle = grey(0.8); rctx.fillRect(0, 0, S, S);
  // 1 base fills
  fillRect(ctx, rctx, 'jersey', kit.base, R.jersey, S);
  fillRect(ctx, rctx, 'shorts', kit.base, R.shorts, S);
  fillRect(ctx, rctx, 'socks', kit.socks, R.socks, S);
  fillRect(ctx, rctx, 'sleeve', kit.accessories.sleeve_r || '#111111', R.sleeve, S);
  const hb = kit.accessories.headband_high || kit.accessories.headband_low || '#111111';
  fillRect(ctx, rctx, 'headband', hb, R.headband, S);
  fillRect(ctx, rctx, 'wristband', kit.accessories.wristband_l || '#111111', R.wristband, S);
  fillRect(ctx, rctx, 'tape', kit.accessories.tape_r_im || '#f4f4f4', R.tape, S);
  // 2 folds, 3 stripes, 4 trims, 5 numbers / name / shorts number
  paintFolds(ctx, job, S);
  paintStripes(ctx, rctx, job, kit, S);
  paintTrims(ctx, rctx, job, kit, S);
  paintNumbers(ctx, rctx, job, kit, S);
  paintName(ctx, rctx, job, kit, S);
  paintShortsNumber(ctx, rctx, job, kit, S);
  // sneakers + swatches
  paintShoes(ctx, rctx, kit, S);
}

/**
 * Reads both canvases into `out` (RGBA, row 0 = v 0 = the canvas bottom row): rgb from the albedo canvas, a from the
 * roughness canvas's red channel.
 */
export function readKit(ctx, rctx, S, out) {
  const a = ctx.getImageData(0, 0, S, S).data, r = rctx.getImageData(0, 0, S, S).data;
  const o = out || new Uint8Array(S * S * 4);
  const row = S * 4;
  for (let y = 0; y < S; y++) {
    const src = (S - 1 - y) * row, dst = y * row;
    for (let x = 0; x < row; x += 4) {
      o[dst + x] = a[src + x]; o[dst + x + 1] = a[src + x + 1]; o[dst + x + 2] = a[src + x + 2]; o[dst + x + 3] = r[src + x];
    }
  }
  return o;
}

/** Kit DataTexture: RGBA8 sRGB (alpha = linear roughness), mipmaps, trilinear, clamp. */
export function kitTexture(data, size, anisotropy) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  t.flipY = false;
  t.name = 'legends.kit';
  t.needsUpdate = true;
  return t;
}
