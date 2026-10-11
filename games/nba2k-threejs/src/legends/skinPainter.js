/**
 * @module legends/skinPainter
 * Per-player skin texture composite (spec v2 §3.5.4 / §3.5.4a, [CHR §2.5]).
 *
 * Exports
 *   SKIN_CHANNELS                         mask channel names read by the painter
 *   hexToRgb01(hex, out?)                 '#rrggbb' → [r, g, b] in 0..1 (sRGB)
 *   splitPlanes(rgba, w, h, stride, names, target)  ImageData-like bytes (row 0 = v 1) → v-up Uint8Array planes
 *   SkinPaintJob                          resumable painter (rows of ≤ 8 ms slices, §3.3)
 *   paintSkin(planes, look, size, opts?)  → Uint8Array RGBA (pure; the whole texture in one call)
 *   clearcoatData(planes, size)           → Uint8Array RGBA, R = G = B = max(gloss, sweat) (high-tier clearcoatMap)
 *   skinTexture(data, size, anisotropy)   → THREE.DataTexture (sRGB, mipmaps, trilinear)
 *
 * Planes: `{ <channel>: { size, data: Uint8Array(size²) } }`, rows bottom-up (row 0 = v 0, the DataTexture order),
 * so output row y reads mask row y directly (or with per-row bilinear weights when the mask size differs: 512 → 1024,
 * 1024 → 2048, and the 1024 → 512 box downsample of the low tier). Missing channels read as 0.
 *
 * Composite per texel (all colours sRGB 0..1; `look` = legends.js `look`, §2.6):
 *   c = skin · (1 + 0.12(mottle − 0.5)) · (1 − 0.30·ao) · (1 − cavityK·0.45·cavity)      (one folded factor)
 *       · (1 + (warm − 1)·redness·warmK)  per channel, warm = (1.12, 0.90, 0.86)          (= mix(c, c·warm, …))
 *   c += (1 − c)·hlK·highlight;  c = mix(c, lips, 0.85·lips);  c = mix(c, palms, 0.90·palms)
 *   c = mix(c, mix(palms, #f0d8d0, 0.4), 0.80·nails)
 *   c = mix(c, hair, scalpDarken·hair); c = mix(c, beard, beardSkinDarken·beard); c = mix(c, hair, browDarken·brow)
 *   c = mix(c, desat(c, 0.3)·0.82, tattooK·tattoo)        desat(c, k) = mix(c, luma(c), k), Rec.709 luma
 *   c = mix(c, hair, 0.25·max(hair·stubbleHair, beard)·step(0.62, h)),  h = texel hash (seeded by player index)
 *   rough = skinRoughness − 0.10·hl − lipRoughK·lips + 0.15·beard + 0.10·palms; rough = mix(rough, 0.25, nails);
 *   (lipRoughK = look.lipRoughK, default 0.15; polish round 2: 0 for Kobe / Giannis / Kyrie, whose lower lips read as
 *   glossy pale pouts at 0.15 below the skin)
 *   rough = mix(rough, scalpRoughness, gloss); alpha = round(255·clamp(rough, 0.2, 0.9))  (alpha 255 on low)
 * The texel loop has no function calls, closures, Math.* or allocation; sparse terms are skipped on zero bytes.
 */
import * as THREE from '../../vendor/three.module.js';

export const SKIN_CHANNELS = Object.freeze(['lips', 'cavity', 'highlight', 'redness', 'ao', 'mottle', 'palms', 'nails',
  'hair', 'beard', 'brow', 'tattoo', 'gloss', 'sweat']);

/** '#rrggbb' → [r, g, b] (0..1, sRGB values, no conversion). */
export function hexToRgb01(hex, out) {
  const o = out || [0, 0, 0];
  const v = parseInt(String(hex).replace('#', ''), 16);
  o[0] = ((v >> 16) & 255) / 255; o[1] = ((v >> 8) & 255) / 255; o[2] = (v & 255) / 255;
  return o;
}

/**
 * Splits interleaved image bytes into per-channel planes flipped to v-up (row 0 of the source = v 1, the PNG /
 * canvas order). `names[c]` names channel c (falsy = skip). Writes `target[name] = {size, data}` (w must equal h).
 */
export function splitPlanes(bytes, w, h, stride, names, target) {
  if (w !== h) throw new Error('skinPainter: masks must be square');
  for (let c = 0; c < names.length; c++) {
    if (!names[c]) continue;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * stride + c, dst = y * w;
      for (let x = 0; x < w; x++) data[dst + x] = bytes[src + x * stride];
    }
    target[names[c]] = { size: w, data };
  }
  return target;
}

/** Per-row occupancy (1 = the row has a non-zero byte) of a plane, cached on the plane object. */
function occupancy(pl) {
  if (pl.occ) return pl.occ;
  const M = pl.size, d = pl.data, occ = new Uint8Array(M);
  for (let y = 0; y < M; y++) {
    const o = y * M;
    for (let x = 0; x < M; x++) if (d[o + x]) { occ[y] = 1; break; }
  }
  pl.occ = occ;
  return occ;
}

/**
 * Bilinear sampling tables mapping S output texels onto M mask texels (texel centres aligned:
 * f = (i + 0.5)·M/S − 0.5): integer source index i0, i1 and weight w (0..256) of i1.
 */
function resampleTable(M, S) {
  const i0 = new Int32Array(S), i1 = new Int32Array(S), w = new Int32Array(S);
  for (let i = 0; i < S; i++) {
    let f = (i + 0.5) * M / S - 0.5;
    if (f < 0) f = 0;
    if (f > M - 1) f = M - 1;
    const a = Math.floor(f);
    i0[i] = a; i1[i] = Math.min(M - 1, a + 1); w[i] = Math.round((f - a) * 256);
  }
  return { i0, i1, w };
}

const WARM_R = 0.12, WARM_G = -0.10, WARM_B = -0.14;   // warmTint (1.12, 0.90, 0.86) − 1

/**
 * Resumable skin painter. `run(deadline)` paints rows until `now() ≥ deadline` (checked every 16 rows) and returns
 * true when the texture is complete; `paintSkin` runs it to completion.
 */
export class SkinPaintJob {
  /**
   * @param {object} planes  mask planes (see module doc)
   * @param {object} look    legends.js `look`
   * @param {number} size    output size (512 / 1024 / 2048)
   * @param {{out?: Uint8Array, alpha?: boolean, seed?: number}} [opts]  alpha false = low tier (alpha 255)
   */
  constructor(planes, look, size, opts) {
    const o = opts || {};
    this.size = size;
    this.out = o.out || new Uint8Array(size * size * 4);
    this.alpha = o.alpha !== false;
    this.seedHash = ((o.seed | 0) * 83492791) | 0;
    this.y = 0;
    this.look = look;
    this.zero = new Uint8Array(size);
    this.zeroH = new Uint16Array(size);
    // channel sources: native planes are read in place; other sizes are resampled into one row buffer each
    this.ch = SKIN_CHANNELS.map((name) => {
      const pl = planes[name];
      if (!pl) return { name, pl: null };
      const M = pl.size;
      const c = { name, pl, M, occ: occupancy(pl), native: M === size, row: null, tab: null, arr: this.zero, off: 0 };
      if (!c.native) {
        c.row = new Uint8Array(size); c.tab = resampleTable(M, size);
        c.hA = new Uint16Array(size); c.hB = new Uint16Array(size); c.rA = -1; c.rB = -1;
      }
      return c;
    });
    const L = look, tmp = [0, 0, 0];
    const col = (hex) => hexToRgb01(hex, tmp).slice();
    this.k = {
      skin: col(L.skin), lips: col(L.lips), palms: col(L.palms), hair: col(L.hair), beard: col(L.beard),
      nail: (() => { const p = col(L.palms), w = col('#f0d8d0'); return [p[0] + (w[0] - p[0]) * 0.4, p[1] + (w[1] - p[1]) * 0.4, p[2] + (w[2] - p[2]) * 0.4]; })(),
    };
  }

  /** True when every row is painted. */
  get done() { return this.y >= this.size; }

  /**
   * Horizontally resampled source row `r` of channel c (values ×256), from the 2-slot cache; `keep` is the other
   * row needed by the current output row (its slot is not evicted). Empty source rows return the zero row.
   */
  _hrow(c, r, keep) {
    if (!c.occ[r]) return this.zeroH;
    if (c.rA === r) return c.hA;
    if (c.rB === r) return c.hB;
    let h;
    if (c.rA !== keep) { h = c.hA; c.rA = r; } else { h = c.hB; c.rB = r; }
    const d = c.pl.data, o = r * c.M, i0 = c.tab.i0, i1 = c.tab.i1, wx = c.tab.w, S = this.size;
    for (let x = 0; x < S; x++) { const a = d[o + i0[x]]; h[x] = a * 256 + (d[o + i1[x]] - a) * wx[x]; }
    return h;
  }

  /** Prepares channel row pointers for output row y (bilinear row resample of non-native masks). */
  _row(y) {
    const S = this.size;
    for (let i = 0; i < this.ch.length; i++) {
      const c = this.ch[i];
      if (!c.pl) continue;
      if (c.native) {
        if (c.occ[y]) { c.arr = c.pl.data; c.off = y * S; } else { c.arr = this.zero; c.off = 0; }
        continue;
      }
      const M = c.M;
      let f = (y + 0.5) * M / S - 0.5;
      if (f < 0) f = 0;
      if (f > M - 1) f = M - 1;
      const y0 = Math.floor(f), y1 = Math.min(M - 1, y0 + 1), wy = Math.round((f - y0) * 256);
      if (!c.occ[y0] && !c.occ[y1]) { c.arr = this.zero; c.off = 0; continue; }
      // separable bilinear: horizontally resampled source rows (×256 fixed point) are cached in two slots, so each
      // source row is resampled once even though 2–4 output rows read it
      const h0 = this._hrow(c, y0, y1), h1 = this._hrow(c, y1, y0), row = c.row, w0 = 256 - wy;
      for (let x = 0; x < S; x++) row[x] = (h0[x] * w0 + h1[x] * wy + 32768) >>> 16;
      c.arr = row; c.off = 0;
    }
  }

  /**
   * Paints rows until `now() >= deadline` (checked every 16 rows).
   * @param {number} [deadline=Infinity]  ms timestamp
   * @param {function} [now]  clock (default performance.now)
   * @returns {boolean} done
   */
  run(deadline = Infinity, now) {
    const clock = now || (() => performance.now());
    const S = this.size, out = this.out, L = this.look, K = this.k, ch = this.ch;
    const sR = K.skin[0], sG = K.skin[1], sB = K.skin[2];
    const lR = K.lips[0], lG = K.lips[1], lB = K.lips[2];
    const pR = K.palms[0], pG = K.palms[1], pB = K.palms[2];
    const nR = K.nail[0], nG = K.nail[1], nB = K.nail[2];
    const hR = K.hair[0], hG = K.hair[1], hB = K.hair[2];
    const bR = K.beard[0], bG = K.beard[1], bB = K.beard[2];
    const kMot = 0.12 / 255, kMot0 = 1 - 0.06;
    const kAo = 0.30 / 255, kCav = L.cavityK * 0.45 / 255, kRed = L.warmK / 255, kHl = L.hlK / 255;
    const kLip = 0.85 / 255, kPalm = 0.90 / 255, kNail = 0.80 / 255, kLipR = (L.lipRoughK ?? 0.15) / 255;
    const kScalp = L.scalpDarken / 255, kBeard = L.beardSkinDarken / 255, kBrow = L.browDarken / 255;
    const kTat = L.tattooK / 255, stubH = L.stubbleHair, kStub = 0.25 / 255;
    const rough0 = L.skinRoughness, scalpR = L.scalpRoughness;
    const writeAlpha = this.alpha, seedHash = this.seedHash;
    const [cLips, cCav, cHl, cRed, cAo, cMot, cPalm, cNail, cHair, cBeard, cBrow, cTat, cGloss] = ch;
    let y = this.y;
    while (y < S) {
      const yEnd = Math.min(S, y + 16);
      for (; y < yEnd; y++) {
        this._row(y);
        const aLips = cLips.arr, oLips = cLips.off, aCav = cCav.arr, oCav = cCav.off, aHl = cHl.arr, oHl = cHl.off;
        const aRed = cRed.arr, oRed = cRed.off, aAo = cAo.arr, oAo = cAo.off, aMot = cMot.arr, oMot = cMot.off;
        const aPalm = cPalm.arr, oPalm = cPalm.off, aNail = cNail.arr, oNail = cNail.off;
        const aHair = cHair.arr, oHair = cHair.off, aBeard = cBeard.arr, oBeard = cBeard.off, aBrow = cBrow.arr, oBrow = cBrow.off;
        const aTat = cTat.arr, oTat = cTat.off, aGloss = cGloss.arr, oGloss = cGloss.off;
        const yHash = y * 19349663;
        let o = y * S * 4;
        for (let x = 0; x < S; x++, o += 4) {
          // multiplicative terms folded: mottle ±6 %, AO, cavity
          const f = (kMot0 + kMot * aMot[oMot + x]) * (1 - kAo * aAo[oAo + x]) * (1 - kCav * aCav[oCav + x]);
          const rk = kRed * aRed[oRed + x];
          let r = sR * f * (1 + WARM_R * rk), g = sG * f * (1 + WARM_G * rk), b = sB * f * (1 + WARM_B * rk);
          let rough = rough0;
          const hl = aHl[oHl + x];
          if (hl) { const k = kHl * hl; r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k; rough -= 0.10 / 255 * hl; }
          const lp = aLips[oLips + x];
          if (lp) { const k = kLip * lp; r += (lR - r) * k; g += (lG - g) * k; b += (lB - b) * k; rough -= kLipR * lp; }
          const pm = aPalm[oPalm + x];
          if (pm) { const k = kPalm * pm; r += (pR - r) * k; g += (pG - g) * k; b += (pB - b) * k; rough += 0.10 / 255 * pm; }
          const nl = aNail[oNail + x];
          if (nl) { const k = kNail * nl; r += (nR - r) * k; g += (nG - g) * k; b += (nB - b) * k; }
          const hd = aHair[oHair + x], bd = aBeard[oBeard + x], bw = aBrow[oBrow + x];
          if (hd | bd | bw) {
            let k = kScalp * hd; r += (hR - r) * k; g += (hG - g) * k; b += (hB - b) * k;
            k = kBeard * bd; r += (bR - r) * k; g += (bG - g) * k; b += (bB - b) * k;
            k = kBrow * bw; r += (hR - r) * k; g += (hG - g) * k; b += (hB - b) * k;
            rough += 0.15 / 255 * bd;
          }
          const tt = aTat[oTat + x];
          if (tt) {
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b, k = kTat * tt;
            r += ((r * 0.7 + lum * 0.3) * 0.82 - r) * k;
            g += ((g * 0.7 + lum * 0.3) * 0.82 - g) * k;
            b += ((b * 0.7 + lum * 0.3) * 0.82 - b) * k;
          }
          if (hd | bd) {
            // stubble stipple: step(0.62, h) ≡ hash byte > 158
            if ((((x * 73856093) ^ yHash ^ seedHash) & 255) > 158) {
              const hs = hd * stubH, m = hs > bd ? hs : bd, k = kStub * m;
              r += (hR - r) * k; g += (hG - g) * k; b += (hB - b) * k;
            }
          }
          if (nl) rough += (0.25 - rough) * (nl / 255);
          const gl = aGloss[oGloss + x];
          if (gl) rough += (scalpR - rough) * (gl / 255);
          r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b;
          out[o] = (r * 255 + 0.5) | 0; out[o + 1] = (g * 255 + 0.5) | 0; out[o + 2] = (b * 255 + 0.5) | 0;
          if (writeAlpha) { rough = rough < 0.2 ? 0.2 : rough > 0.9 ? 0.9 : rough; out[o + 3] = (rough * 255 + 0.5) | 0; } else out[o + 3] = 255;
        }
      }
      this.y = y;
      if (y < S && clock() >= deadline) return false;
    }
    this.y = S;
    return true;
  }
}

/**
 * Paints a whole skin texture (pure).
 * @param {object} planes  mask planes
 * @param {object} look    legends.js look
 * @param {number} size    512 | 1024 | 2048
 * @param {{out?: Uint8Array, alpha?: boolean, seed?: number}} [opts]
 * @returns {Uint8Array} RGBA, row 0 = v 0
 */
export function paintSkin(planes, look, size, opts) {
  const job = new SkinPaintJob(planes, look, size, opts);
  job.run(Infinity);
  return job.out;
}

/**
 * High-tier clearcoat mask (§3.5.5): R = G = B = max(gloss, sweat) box-filtered onto `size`² (A 255).
 */
export function clearcoatData(planes, size) {
  const out = new Uint8Array(size * size * 4);
  const g = planes.gloss, s = planes.sweat;
  const M = (g || s) ? (g || s).size : size;
  const step = Math.max(1, Math.round(M / size));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let j = 0; j < step; j++) {
        for (let i = 0; i < step; i++) {
          const sx = Math.min(M - 1, x * step + i), sy = Math.min(M - 1, y * step + j), k = sy * M + sx;
          const a = g ? g.data[k] : 0, b = s ? s.data[k] : 0;
          acc += a > b ? a : b;
        }
      }
      const v = Math.round(acc / (step * step)), o = (y * size + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Wraps painted bytes in a DataTexture: RGBA8, sRGB (alpha stays linear roughness), mipmaps, trilinear, clamp.
 * @param {Uint8Array} data  @param {number} size  @param {number} anisotropy 4 / 2 / 1 (high / medium / low)
 */
export function skinTexture(data, size, anisotropy) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = anisotropy;
  t.flipY = false;
  t.name = 'legends.skin';
  t.needsUpdate = true;
  return t;
}
