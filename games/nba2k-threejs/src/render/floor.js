/**
 * @module render/floor
 * PBR hardwood floor, court markings, centre decal and the backcourt warning stripe (SPEC-v2 §6.2, PR §2.1–§2.2).
 *
 * Floor = one `PlaneGeometry(22, 35)` draw (x ∈ [−11, 11], z ∈ [−17.5, 17.5]) with explicit UVs
 * `u = (x + 11)/22`, `v = (z + 17.5)/17.5 ∈ [0, 2]`, combining two textures in an `onBeforeCompile` patch
 * (`customProgramCacheKey 'floor-v2'`, D-PR-4):
 *  - markings: half-court `CanvasTexture` (1024×816 low / 2048×1632 medium-high), `flipY = false`, canvas row 0 ↔
 *    z = −17.5, last row ↔ z = 0, `wrapT = MirroredRepeat` so v ∈ [1, 2] mirrors the far half; alpha = paint coverage;
 *  - wood: a tiling 2.28 m maple tile `DataTexture` (RGB albedo, A = roughness) painted by the pure
 *    `paintWoodTile(size, rng)` (40 boards of 5.7 cm running along z, seamless).
 * High tier adds the planar reflection term (`setReflection`, layer-2 mirror pass from reflection.js).
 *
 * Text on the floor comes from i18n (`brand.sub` / `brand.wordmark`, `brand.zh`); nothing else is written.
 */
import * as THREE from '../../vendor/three.module.js';
import { COURT, RIM, LINES } from '../constants.js';
import { Rng } from '../math.js';
import { t, hasKey } from '../i18n.js';
import { TIERS, trackTexture } from './quality.js';

// ---- floor and marking constants (PR §2.1) ----
export const FLOOR_W = 22;
export const FLOOR_D = 35;
export const MARK_HALF_D = 17.5;          // canvas covers z ∈ [−17.5, 0]
export const TILE_M = 2.28;               // wood tile size (m)
export const BOARDS_PER_TILE = 40;        // 5.7 cm boards
export const LINE_W = 0.0508;             // 2 in lines
export const HALF_LINE_BAND = 0.0254;     // half-court line drawn as z ∈ [−0.0254, 0] (mirror → 0.0508)
export const CENTRE_R = 1.83;
export const CENTRE_INNER_R = 0.61;
const C_APRON = 'rgba(20,24,33,0.96)';    // #141821 α 0.96
const C_KEY = 'rgba(29,43,79,0.90)';      // #1d2b4f α 0.90
const C_LINE = '#f4f2ec';
const C_GOLD = '#d9a520';

const FONT_LATIN = '"Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", system-ui, sans-serif';
const FONT_CJK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", "WenQuanYi Micro Hei", system-ui, sans-serif';

// -------------------------------------------------------------------------------------------------
// Wood tile (pure)
// -------------------------------------------------------------------------------------------------

/** HSL (h in degrees, s, l in 0..1) → sRGB 0..1, written into out[0..2]. */
export function hslToRgb(h, s, l, out) {
  const hh = ((h % 360) + 360) % 360 / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; } else if (hh < 2) { r = x; g = c; } else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; } else if (hh < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = l - c / 2;
  out[0] = r + m; out[1] = g + m; out[2] = b + m;
  return out;
}

/**
 * Split a board of length `len` (m) into segments of 0.40–1.60 m whose lengths sum to `len` exactly (so the board
 * wraps seamlessly across the tile edge). Returns an array of lengths.
 */
export function boardSegments(rng, len) {
  const out = [];
  let rem = len;
  while (rem > 1.60) {
    const hi = Math.min(1.60, rem - 0.40);
    const L = rng.range(0.40, hi);
    out.push(L);
    rem -= L;
  }
  out.push(rem);
  return out;
}

/**
 * Paint the seamless maple tile (PR §2.1). Columns ↔ x (across boards), rows ↔ z (along boards).
 * @param {number} size  512 or 1024 (covers 2.28 × 2.28 m)
 * @param {Rng} rng  seeded Rng (the game uses `new Rng(0x600D)`)
 * @param {{wear?:boolean}} [opts]  medium/high add 6 wear blobs
 * @returns {Uint8Array} RGBA (sRGB albedo, alpha = roughness × 255)
 */
export function paintWoodTile(size, rng, opts) {
  const o = opts || {};
  const N = size | 0;
  if (N & (N - 1)) throw new Error('paintWoodTile: size must be a power of two');
  const M = N - 1;                           // wrap mask (seamless tile)
  const pxPerM = N / TILE_M;
  const val = new Float32Array(N * N);       // value multiplier
  const roughAdd = new Float32Array(N * N);  // roughness added by streaks / wear
  const segOf = new Uint16Array(N * N);      // pixel → segment (board piece) index
  const segRgb = [], segRough = [];
  val.fill(1);
  const rgb = [0, 0, 0];
  const ampPx = 0.6 * (N / 512);
  const bw = N / BOARDS_PER_TILE;            // board width in px (12.8 at 512)
  // Boards are offset by half a board so the tile edge column is a board interior (seamless edges).
  for (let b = 0; b < BOARDS_PER_TILE; b++) {
    const c0 = Math.round((b + 0.5) * bw);
    const c1 = Math.round((b + 1.5) * bw);   // exclusive
    const cols = c1 - c0;
    const segs = boardSegments(rng, TILE_M);
    let z = rng.range(0, TILE_M);            // start offset of the first joint (m)
    for (let s = 0; s < segs.length; s++) {
      const len = segs[s];
      const r0 = Math.round(z * pxPerM);
      const r1 = Math.round((z + len) * pxPerM);
      // Per segment (a physical board piece): HSL 30° ± 2, s 0.50 ± 0.05, l 0.62 ± 0.035; roughness 0.20 ± 0.03.
      hslToRgb(30 + rng.range(-2, 2), 0.50 + rng.range(-0.05, 0.05), 0.62 + rng.range(-0.035, 0.035), rgb);
      const si = segRough.length;
      segRgb.push(rgb[0], rgb[1], rgb[2]);
      segRough.push(0.20 + rng.range(-0.03, 0.03));
      for (let r = r0; r < r1; r++) {
        const rowOff = (r & M) * N;
        for (let c = 0; c < cols; c++) segOf[rowOff + ((c0 + c) & M)] = si;
      }
      // Grain: 7 dark (× 0.90–0.96) and 2 light (× 1.05) streaks, each a 1 px sinusoid along z
      // (amplitude 0.6 px at 512, wavelength 0.3–0.9 m), anti-aliased over the two nearest columns.
      for (let k = 0; k < 9; k++) {
        const f = k < 7 ? rng.range(0.90, 0.96) : 1.05;
        const x0 = rng.range(1.0, cols - 2.0);
        const w = (2 * Math.PI) / (rng.range(0.3, 0.9) * pxPerM);
        const phase = rng.range(0, Math.PI * 2);
        for (let r = r0; r < r1; r++) {
          const rowOff = (r & M) * N;
          // 1 px line filtered with a 1.5 px tent: weights over the three nearest columns sum to 1.
          const x = x0 + ampPx * Math.sin(w * (r - r0) + phase);
          const xc = Math.round(x);
          const d = x - xc;                                   // ∈ [−0.5, 0.5]
          const wl = 0.5 * (0.5 - d) * (0.5 - d), wr = 0.5 * (0.5 + d) * (0.5 + d), wm = 1 - wl - wr;
          const il = rowOff + ((c0 + xc - 1) & M), im = rowOff + ((c0 + xc) & M), ir = rowOff + ((c0 + xc + 1) & M);
          val[il] *= 1 + (f - 1) * wl;
          val[im] *= 1 + (f - 1) * wm;
          val[ir] *= 1 + (f - 1) * wr;
          roughAdd[il] += 0.02 * wl;
          roughAdd[im] += 0.02 * wm;
          roughAdd[ir] += 0.02 * wr;
        }
      }
      // Segment joint: 1 px line × 0.80.
      const jr = (r0 & M) * N;
      for (let c = 0; c < cols; c++) val[jr + ((c0 + c) & M)] *= 0.80;
      z += len;
    }
    // Board edge: 1 px × 0.86 on the board's left edge.
    const ec = c0 & M;
    for (let r = 0; r < N; r++) val[r * N + ec] *= 0.86;
  }
  // Wear blobs (medium/high): r 0.3–0.8 m, +0.08 roughness, −3 % value, toroidal (seamless); per-row chords.
  if (o.wear) {
    for (let k = 0; k < 6; k++) {
      const cx = rng.range(0, N), cy = rng.range(0, N);
      const rad = rng.range(0.3, 0.8) * pxPerM;
      const r2 = rad * rad;
      for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
        const dy = y + 0.5 - cy;
        const rem = r2 - dy * dy;
        if (rem <= 0) continue;
        const half = Math.sqrt(rem);
        const rowOff = (y & M) * N;
        for (let x = Math.ceil(cx - half - 0.5); x <= Math.floor(cx + half - 0.5); x++) {
          const dx = x + 0.5 - cx;
          const q = 1 - (dx * dx + dy * dy) / r2;
          if (q <= 0) continue;
          const wq = q * q;
          const i = rowOff + (x & M);
          roughAdd[i] += 0.08 * wq;
          val[i] *= 1 - 0.03 * wq;
        }
      }
    }
  }
  // 64² periodic value noise multiplied at α 0.25: factor = mix(1, 0.8 + 0.4·n, 0.25) ∈ [0.95, 1.05]. The lattice
  // weights are separable, so they are precomputed per column and per row.
  const L = 64;
  const lat = new Float32Array(L * L);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  const cx0 = new Int32Array(N), cx1 = new Int32Array(N), cfx = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i * L) / N, xi = Math.floor(x), f = x - xi;
    cx0[i] = xi % L; cx1[i] = (xi + 1) % L; cfx[i] = f * f * (3 - 2 * f);
  }
  const out = new Uint8Array(N * N * 4);
  for (let row = 0; row < N; row++) {
    const y0 = cx0[row] * L, y1 = cx1[row] * L, fy = cfx[row];
    const rowOff = row * N;
    for (let col = 0; col < N; col++) {
      const i = rowOff + col;
      const x0 = cx0[col], x1 = cx1[col], fx = cfx[col];
      const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
      const top = a + (b - a) * fx, bot = c + (d - c) * fx;
      const n = top + (bot - top) * fy;
      const k = val[i] * (0.95 + 0.1 * n) * 255;
      const si = segOf[i];
      const j = i * 4;
      out[j] = clampByte(segRgb[si * 3] * k);
      out[j + 1] = clampByte(segRgb[si * 3 + 1] * k);
      out[j + 2] = clampByte(segRgb[si * 3 + 2] * k);
      // Overlapping streaks + wear could stack past the paint range; keep roughness in [0.15, 0.40].
      const rg = segRough[si] + roughAdd[i];
      out[j + 3] = clampByte((rg < 0.15 ? 0.15 : rg > 0.40 ? 0.40 : rg) * 255);
    }
  }
  return out;
}

function clampByte(v) {
  return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
}

// -------------------------------------------------------------------------------------------------
// Markings
// -------------------------------------------------------------------------------------------------

/** World (x, z) → markings canvas pixel (px, py): `px = (x + 11)/22·W`, `py = (z + 17.5)/17.5·H`. */
export function worldToMarkPx(x, z, W, H, out) {
  const o = out || { px: 0, py: 0 };
  o.px = ((x + FLOOR_W / 2) / FLOOR_W) * W;
  o.py = ((z + MARK_HALF_D) / MARK_HALF_D) * H;
  return o;
}

/** Floor strings from i18n: apron wordmark (`brand.sub`) and the zh brand (`brand.zh`). Missing keys → ''. */
export function markingStrings() {
  const wm = hasKey('brand.sub') ? t('brand.sub') : hasKey('brand.wordmark') ? t('brand.wordmark') + ' 3V3' : '';
  const zh = hasKey('brand.zh') ? t('brand.zh') : '';
  return { wordmark: wm, zh };
}

// Cap-height → font pixel size, measured on the context (falls back to typical ratios: Latin 0.72, CJK 0.88 em).
function fontPxForCap(ctx, capPx, family, weight, sample, cjk) {
  const test = 100;
  ctx.font = weight + ' ' + test + 'px ' + family;
  let ratio = cjk ? 0.88 : 0.72;
  if (typeof ctx.measureText === 'function') {
    const m = ctx.measureText(sample);
    if (m && typeof m.actualBoundingBoxAscent === 'number' && m.actualBoundingBoxAscent > 0) {
      const h = cjk ? m.actualBoundingBoxAscent + (m.actualBoundingBoxDescent || 0) : m.actualBoundingBoxAscent;
      if (h > 10) ratio = h / test;
    }
  }
  return capPx / ratio;
}

// Draw `text` centred at the current origin with extra letter spacing (px), baseline placed so the cap box is
// vertically centred on the origin. Returns the total advance.
function drawSpacedText(ctx, text, fontPx, family, weight, spacingPx, capPx) {
  ctx.font = weight + ' ' + fontPx + 'px ' + family;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  let total = 0;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    total += ctx.measureText(chars[i]).width + (i < chars.length - 1 ? spacingPx : 0);
  }
  let x = -total / 2;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, capPx / 2);
    x += ctx.measureText(chars[i]).width + spacingPx;
  }
  return total;
}

function hasCjk(s) {
  return /[\u3000-\u9fff\uff00-\uffef]/.test(s);
}

/**
 * Paint the half-court markings (z ∈ [−17.5, 0]) on a transparent W×H canvas context (PR §2.1 paint order:
 * apron, key, centre-circle fill, lines, apron wordmarks). Pure drawing (works with any Canvas2D-like context).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 * @param {{wordmark:string, zh:string}} [strings]  defaults to markingStrings()
 */
export function drawMarkings(ctx, W, H, strings) {
  const str = strings || markingStrings();
  const sx = W / FLOOR_W, sz = H / MARK_HALF_D;
  const HW = COURT.HALF_W, BZ = COURT.BASELINE_Z;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // From here on 1 unit = 1 m with the origin at world (0, 0): canvas x = world x, canvas y = world z.
  ctx.setTransform(sx, 0, 0, sz, (FLOOR_W / 2) * sx, MARK_HALF_D * sz);
  ctx.globalAlpha = 1;
  // 1. Apron (out of bounds): |x| > 7.62 or z < −14.325.
  ctx.fillStyle = C_APRON;
  ctx.fillRect(-FLOOR_W / 2, -MARK_HALF_D, FLOOR_W / 2 - HW, MARK_HALF_D);
  ctx.fillRect(HW, -MARK_HALF_D, FLOOR_W / 2 - HW, MARK_HALF_D);
  ctx.fillRect(-HW, -MARK_HALF_D, 2 * HW, MARK_HALF_D + BZ);
  // 2. Key: x ∈ [−2.44, 2.44], z ∈ [−14.325, −8.535].
  ctx.fillStyle = C_KEY;
  ctx.fillRect(-LINES.KEY_HALF_W, BZ, 2 * LINES.KEY_HALF_W, LINES.FT_Z - BZ);
  // 3. Centre-circle fill r ≤ 1.83 (half disc here; the mirror completes it).
  ctx.beginPath();
  ctx.arc(0, 0, CENTRE_R, Math.PI, 2 * Math.PI, false);
  ctx.closePath();
  ctx.fill();
  // 4. Lines #f4f2ec, 0.0508 m.
  ctx.strokeStyle = C_LINE;
  ctx.fillStyle = C_LINE;
  ctx.lineWidth = LINE_W;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.setLineDash([]);
  // Sidelines and baseline (one open path: left sideline up from the half line, baseline, right sideline).
  ctx.beginPath();
  ctx.moveTo(-HW, 0);
  ctx.lineTo(-HW, BZ);
  ctx.lineTo(HW, BZ);
  ctx.lineTo(HW, 0);
  ctx.stroke();
  // Half-court line: band z ∈ [−0.0254, 0] (the mirrored far half completes the 0.0508 m line).
  ctx.fillRect(-HW - LINE_W / 2, -HALF_LINE_BAND, 2 * HW + LINE_W, HALF_LINE_BAND);
  // Key outline incl. the free-throw line.
  ctx.beginPath();
  ctx.moveTo(-LINES.KEY_HALF_W, BZ);
  ctx.lineTo(-LINES.KEY_HALF_W, LINES.FT_Z);
  ctx.lineTo(LINES.KEY_HALF_W, LINES.FT_Z);
  ctx.lineTo(LINES.KEY_HALF_W, BZ);
  ctx.stroke();
  // Free-throw circle: solid half toward the half line (+z), dashed half toward the rim (0.35 on / 0.25 off).
  ctx.beginPath();
  ctx.arc(0, LINES.FT_Z, LINES.FT_CIRCLE_R, 0, Math.PI, false);
  ctx.stroke();
  ctx.setLineDash([0.35, 0.25]);
  ctx.beginPath();
  ctx.arc(0, LINES.FT_Z, LINES.FT_CIRCLE_R, Math.PI, 2 * Math.PI, false);
  ctx.stroke();
  ctx.setLineDash([]);
  // Lane hash marks (v1 positions): three per side, 0.25 m long, outside the key.
  ctx.beginPath();
  for (let k = 1; k <= 3; k++) {
    const z = BZ + 0.9 + k * 0.9;
    ctx.moveTo(-LINES.KEY_HALF_W - 0.25, z); ctx.lineTo(-LINES.KEY_HALF_W, z);
    ctx.moveTo(LINES.KEY_HALF_W, z); ctx.lineTo(LINES.KEY_HALF_W + 0.25, z);
  }
  ctx.stroke();
  // Restricted arc r 1.22 about the rim (toward +z) with short straights back to the backboard plane.
  const boardZ = -13.105;
  ctx.beginPath();
  ctx.moveTo(-LINES.RESTRICTED_R, boardZ);
  ctx.lineTo(-LINES.RESTRICTED_R, RIM.z);
  ctx.arc(RIM.x, RIM.z, LINES.RESTRICTED_R, Math.PI, 0, true);
  ctx.lineTo(LINES.RESTRICTED_R, boardZ);
  ctx.stroke();
  // Three-point line: corners at |x| 6.71 from the baseline to z −10.03, joined by the r 7.24 arc about the rim.
  const aJoin = Math.atan2(LINES.CORNER_Z_END - RIM.z, LINES.CORNER_X - RIM.x);
  ctx.beginPath();
  ctx.moveTo(LINES.CORNER_X, BZ);
  ctx.lineTo(LINES.CORNER_X, LINES.CORNER_Z_END);
  ctx.arc(RIM.x, RIM.z, LINES.THREE_R, aJoin, Math.PI - aJoin, false);
  ctx.lineTo(-LINES.CORNER_X, BZ);
  ctx.stroke();
  // Centre circle r 1.83 and inner circle r 0.61 (half here; mirrored).
  ctx.beginPath();
  ctx.arc(0, 0, CENTRE_R, Math.PI, 2 * Math.PI, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, CENTRE_INNER_R, Math.PI, 2 * Math.PI, false);
  ctx.stroke();
  // Backboard-plane tick under the board: 0.6 m wide at z = −13.105 (v1 depth cue).
  ctx.beginPath();
  ctx.moveTo(-0.3, boardZ);
  ctx.lineTo(0.3, boardZ);
  ctx.stroke();

  // 5. Apron wordmarks, drawn in pixel space so glyphs are not affected by the (tiny) sx/sz difference.
  const P = { px: 0, py: 0 };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (str.wordmark) {
    worldToMarkPx(0, -16.0, W, H, P);
    const cap = 0.55 * sz;
    const cjk = hasCjk(str.wordmark);
    const fam = cjk ? FONT_CJK : FONT_LATIN;
    const fpx = fontPxForCap(ctx, cap, fam, '900', cjk ? str.wordmark : 'H', cjk);
    ctx.save();
    ctx.translate(P.px, P.py);
    ctx.globalAlpha = 0.90;
    ctx.fillStyle = C_GOLD;
    drawSpacedText(ctx, str.wordmark, fpx, fam, '900', 0.10 * sx, cap);  // glyph tops toward −z
    ctx.restore();
  }
  if (str.zh) {
    const cap = 0.60 * sx;
    const fpx = fontPxForCap(ctx, cap, FONT_CJK, '700', str.zh, true);
    for (let side = -1; side <= 1; side += 2) {
      worldToMarkPx(side * 9.3, -7.0, W, H, P);
      ctx.save();
      ctx.translate(P.px, P.py);
      ctx.rotate(side * Math.PI / 2);          // left −90°, right +90°: reads from the court centre
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = C_LINE;
      drawSpacedText(ctx, str.zh, fpx, FONT_CJK, '700', 0.04 * sx, cap);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

// -------------------------------------------------------------------------------------------------
// Canvas helper
// -------------------------------------------------------------------------------------------------

/** A 2D canvas of w×h (DOM canvas, OffscreenCanvas, or null in Node). */
export function makeCanvas(w, h) {
  let c = null;
  if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
    c = document.createElement('canvas');
  } else if (typeof OffscreenCanvas !== 'undefined') {
    c = new OffscreenCanvas(w, h);
  }
  if (c) { c.width = w; c.height = h; }
  return c;
}

// -------------------------------------------------------------------------------------------------
// Floor mesh + material patch
// -------------------------------------------------------------------------------------------------

const FLOOR_PARS = `#include <map_pars_fragment>
uniform sampler2D woodMap;
#ifdef FLOOR_REFL
uniform sampler2D uReflMap;
uniform vec2 uReflRes;
uniform vec2 uReflTexel;
uniform float uReflStrength;
#endif`;

const FLOOR_MAP = `vec4 mk = texture2D( map, vMapUv );
	vec2 wuv = vec2( vMapUv.x * 22.0, vMapUv.y * 17.5 ) / 2.28;
	vec4 wd = texture2D( woodMap, wuv );
	float macro = texture2D( woodMap, wuv * 0.11 + vec2( 0.37 ) ).g;
	vec3 wood = wd.rgb * mix( 0.93, 1.07, macro );
	diffuseColor.rgb *= mix( wood, mk.rgb, mk.a );
	float floorRough = mix( wd.a, 0.34, mk.a );`;

// Reflection term (high): the mirror pass is rendered with the projection's x flipped (keeps triangle winding),
// so the screen-space lookup flips u back. 4-tap blur, Schlick Fresnel, weight clamped at 0.35.
const FLOOR_REFL_CODE = `#ifdef FLOOR_REFL
	{
		vec2 suv = gl_FragCoord.xy / uReflRes;
		suv.x = 1.0 - suv.x;
		suv.y += 0.004 * ( wd.g - 0.5 );
		vec3 refl = texture2D( uReflMap, suv + vec2( 1.5, 0.0 ) * uReflTexel ).rgb;
		refl += texture2D( uReflMap, suv - vec2( 1.5, 0.0 ) * uReflTexel ).rgb;
		refl += texture2D( uReflMap, suv + vec2( 0.0, 3.0 ) * uReflTexel ).rgb;
		refl += texture2D( uReflMap, suv - vec2( 0.0, 3.0 ) * uReflTexel ).rgb;
		refl *= 0.25;
		float fres = 0.04 + 0.96 * pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 5.0 );
		float rw = uReflStrength * ( 0.35 + 0.65 * fres ) * ( 1.0 - 1.8 * ( floorRough - 0.18 ) ) * ( 1.0 - mk.a * 0.5 );
		outgoingLight += refl * clamp( rw, 0.0, 0.35 );
	}
#endif
#include <opaque_fragment>`;

/**
 * Patch a fragment shader so it ignores directional light #1, the back "rim" light. That light (from behind the far
 * stands, 17° above the horizon) separates the players from the dark stands; on the glossy floor and centre decal it
 * would put a broad grazing specular glare across the key under the broadcast camera. three orders shadow-casting
 * lights first and keeps scene order otherwise, and createLights adds key then rim on every tier: key = 0, rim = 1.
 */
export function skipRimLight(fs) {
  return '#define FLOOR_SKIP_DIR 1\n' + fs.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tif ( UNROLLED_LOOP_INDEX == FLOOR_SKIP_DIR ) directLight.color = vec3( 0.0 );'));
}

function floorGeometry() {
  const g = new THREE.PlaneGeometry(FLOOR_W, FLOOR_D, 1, 1);
  g.rotateX(-Math.PI / 2);
  // Explicit UVs: u = (x + 11)/22, v = (z + 17.5)/17.5 ∈ [0, 2].
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + FLOOR_W / 2) / FLOOR_W, (pos.getZ(i) + MARK_HALF_D) / MARK_HALF_D);
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * Build the floor (one draw). Textures are sized from the load tier.
 * @param {THREE.Scene|null} scene
 * @param {object} quality
 * @param {{maxAnisotropy?:number, strings?:object, rng?:Rng}} [opts]
 * @returns {{mesh, material, markings, wood, canvas, setReflection, setStrings, uniforms}}
 */
export function buildFloor(scene, quality, opts) {
  const o = opts || {};
  const tier = (quality && (quality.loadTier || quality.tier)) || 'low';
  const F = TIERS[tier].floor;
  const maxAniso = o.maxAnisotropy || 8;
  const aniso = Math.min(F.anisotropy, maxAniso);

  // Markings canvas.
  const W = F.markings[0], H = F.markings[1];
  const canvas = makeCanvas(W, H);
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (ctx) drawMarkings(ctx, W, H, o.strings);
  const markings = new THREE.CanvasTexture(canvas || { width: W, height: H });
  markings.flipY = false;
  markings.colorSpace = THREE.SRGBColorSpace;
  markings.wrapS = THREE.ClampToEdgeWrapping;
  markings.wrapT = THREE.MirroredRepeatWrapping;
  markings.anisotropy = aniso;
  markings.generateMipmaps = true;
  markings.minFilter = THREE.LinearMipmapLinearFilter;
  markings.magFilter = THREE.LinearFilter;
  markings.needsUpdate = !!ctx;
  trackTexture(markings, 4, true, W, H);

  // Wood tile.
  const ws = F.wood;
  const data = paintWoodTile(ws, o.rng || new Rng(0x600D), { wear: !!F.wear });
  const wood = new THREE.DataTexture(data, ws, ws, THREE.RGBAFormat, THREE.UnsignedByteType);
  wood.colorSpace = THREE.SRGBColorSpace;   // sRGB decode applies to rgb only; alpha (roughness) stays linear
  wood.wrapS = THREE.RepeatWrapping;
  wood.wrapT = THREE.RepeatWrapping;
  wood.generateMipmaps = true;
  wood.minFilter = THREE.LinearMipmapLinearFilter;
  wood.magFilter = THREE.LinearFilter;
  wood.anisotropy = aniso;
  wood.needsUpdate = true;
  trackTexture(wood, 4, true);

  const standard = F.material === 'standard';
  const material = standard
    ? new THREE.MeshStandardMaterial({ map: markings, roughness: 1, metalness: 0, envMapIntensity: 1.0 })
    : new THREE.MeshLambertMaterial({ map: markings });
  material.name = 'floor';
  const uniforms = {
    woodMap: { value: wood },
    uReflMap: { value: null },
    uReflRes: { value: new THREE.Vector2(1, 1) },
    uReflTexel: { value: new THREE.Vector2(1, 1) },
    uReflStrength: { value: 0.22 },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.woodMap = uniforms.woodMap;
    shader.uniforms.uReflMap = uniforms.uReflMap;
    shader.uniforms.uReflRes = uniforms.uReflRes;
    shader.uniforms.uReflTexel = uniforms.uReflTexel;
    shader.uniforms.uReflStrength = uniforms.uReflStrength;
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <map_pars_fragment>', FLOOR_PARS);
    fs = fs.replace('#include <map_fragment>', FLOOR_MAP);
    if (standard) fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = floorRough;');
    fs = fs.replace('#include <opaque_fragment>', FLOOR_REFL_CODE);
    shader.fragmentShader = skipRimLight(fs);
  };
  material.customProgramCacheKey = () => 'floor-v2';

  const mesh = new THREE.Mesh(floorGeometry(), material);
  mesh.name = 'floor';
  mesh.receiveShadow = true;
  mesh.renderOrder = -2;
  if (scene) scene.add(mesh);

  /** Attach / detach the high-tier planar reflection (a PlanarReflection or null). Triggers one recompile. */
  function setReflection(refl) {
    const on = !!(refl && refl.texture);
    uniforms.uReflMap.value = on ? refl.texture : null;
    const had = !!(material.defines && material.defines.FLOOR_REFL);
    if (on === had) return;
    material.defines = material.defines || {};
    if (on) material.defines.FLOOR_REFL = '';
    else delete material.defines.FLOOR_REFL;
    material.needsUpdate = true;
  }

  /** Re-paint the markings (language change of the floor wordmarks). */
  function setStrings(strings) {
    if (!ctx) return;
    drawMarkings(ctx, W, H, strings);
    markings.needsUpdate = true;
  }

  return { mesh, material, markings, wood, canvas, uniforms, setReflection, setStrings };
}

// -------------------------------------------------------------------------------------------------
// Centre decal (PR §2.2)
// -------------------------------------------------------------------------------------------------

/**
 * Paint the 4 × 4 m centre decal on a size×size context: navy disc r 1.83 (inside the white circle line), gold ring
 * r 1.45–1.50, the wordmark cap 0.40 at z −0.10, the zh brand in gold cap 0.26 at z +0.42, "3V3" cap 0.18 at z −0.65.
 * Canvas row 0 ↔ z = −2 (glyph tops toward −z).
 */
export function drawCentreDecal(ctx, size, strings) {
  const s = strings || { wordmark: hasKey('brand.wordmark') ? t('brand.wordmark') : '', zh: hasKey('brand.zh') ? t('brand.zh') : '' };
  const k = size / 4;                   // px per metre
  const c = size / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(29,43,79,0.92)';
  ctx.beginPath();
  ctx.arc(c, c, (CENTRE_R - LINE_W / 2) * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C_GOLD;
  ctx.lineWidth = 0.05 * k;
  ctx.beginPath();
  ctx.arc(c, c, 1.475 * k, 0, Math.PI * 2);
  ctx.stroke();
  const rows = [
    { text: s.wordmark || '', z: -0.10, cap: 0.40, colour: C_LINE, spacing: 0.06 },
    { text: s.zh || '', z: 0.42, cap: 0.26, colour: C_GOLD, spacing: 0.03 },
    { text: '3V3', z: -0.65, cap: 0.18, colour: C_LINE, spacing: 0.03 },
  ];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.text) continue;
    const cjk = hasCjk(r.text);
    const fam = cjk ? FONT_CJK : FONT_LATIN;
    const capPx = r.cap * k;
    const fpx = fontPxForCap(ctx, capPx, fam, '900', cjk ? r.text : 'H', cjk);
    ctx.save();
    ctx.translate(c, c + r.z * k);
    ctx.fillStyle = r.colour;
    // Condensed look for the long wordmark: squeeze horizontally if it would exceed the gold ring width.
    ctx.font = '900 ' + fpx + 'px ' + fam;
    let width = 0;
    const chars = Array.from(r.text);
    for (let j = 0; j < chars.length; j++) width += ctx.measureText(chars[j]).width + (j < chars.length - 1 ? r.spacing * k : 0);
    const maxW = 2.5 * k;
    if (width > maxW) ctx.scale(maxW / width, 1);
    drawSpacedText(ctx, r.text, fpx, fam, '900', r.spacing * k, capPx);
    ctx.restore();
  }
}

/**
 * Centre decal mesh: `PlaneGeometry(4, 4)` flat at (0, 0.002, 0), Standard r 0.30 (low Lambert), transparent,
 * `polygonOffset −2/−2`, receives shadows.
 */
export function buildCentreDecal(scene, quality, opts) {
  const o = opts || {};
  const tier = (quality && (quality.loadTier || quality.tier)) || 'low';
  const D = TIERS[tier].decal;
  const size = D.size;
  const canvas = makeCanvas(size, size);
  const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (ctx) drawCentreDecal(ctx, size, o.strings);
  const tex = new THREE.CanvasTexture(canvas || { width: size, height: size });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(TIERS[tier].floor.anisotropy, o.maxAnisotropy || 8);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = !!ctx;
  trackTexture(tex, 4, true, size, size);
  const common = { map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  const material = D.material === 'standard'
    ? new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.30, metalness: 0 }, common))
    : new THREE.MeshLambertMaterial(common);
  material.name = 'centreDecal';
  material.onBeforeCompile = (shader) => { shader.fragmentShader = skipRimLight(shader.fragmentShader); };
  material.customProgramCacheKey = () => 'decal-v2';
  const geo = new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'centreDecal';
  mesh.position.set(0, 0.002, 0);
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  if (scene) scene.add(mesh);
  return {
    mesh, material, texture: tex, canvas,
    setStrings(strings) { if (ctx) { drawCentreDecal(ctx, size, strings); tex.needsUpdate = true; } },
  };
}

// -------------------------------------------------------------------------------------------------
// Backcourt warning stripe (R#41)
// -------------------------------------------------------------------------------------------------

/**
 * Red stripe along the half line: `PlaneGeometry(15.24, 0.30)` at (0, 0.003, −0.15); opacity
 * `0.55·|sin(π t / 0.3)|` while the human handler is within 1.0 m of z = 0 and moving toward it; invisible otherwise.
 */
export class BackcourtStripe {
  constructor(scene) {
    this.material = new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(15.24, 0.30).rotateX(-Math.PI / 2), this.material);
    this.mesh.name = 'backcourtStripe';
    this.mesh.position.set(0, 0.003, -0.15);
    this.mesh.visible = false;
    this.t = 0;
    if (scene) scene.add(this.mesh);
  }

  /**
   * @param {number} dt
   * @param {number|null} handlerZ  human handler z (null = no human handler)
   * @param {number} handlerVz      his z velocity
   */
  update(dt, handlerZ, handlerVz) {
    const active = handlerZ !== null && handlerZ !== undefined && Math.abs(handlerZ) <= 1.0 &&
      ((handlerZ < 0 && handlerVz > 0.05) || (handlerZ > 0 && handlerVz < -0.05));
    if (!active) {
      this.mesh.visible = false;
      this.t = 0;
      return;
    }
    this.t += dt;
    this.mesh.visible = true;
    this.material.opacity = 0.55 * Math.abs(Math.sin((Math.PI * this.t) / 0.3));
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
