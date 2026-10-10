/**
 * uvraster.mjs — rasterises body triangles into UV space so mask channels can be evaluated as scalar fields of
 * the interpolated 3D position and normal (seam-free by construction, SPEC-v2 §3.5.1 / §8.3).
 *
 * Step 1 `sampleMap(size, uv, tris, ss)`: for every sub-sample (ss × ss per texel) the covering triangle and its
 * barycentric coordinates (top-left fill rule, so a sample on a shared edge belongs to exactly one triangle).
 * The map depends only on the shared UV layout, so it is built once per size and reused for every mask and
 * player. Step 2 `evaluate(map, verts, field, channels)`: interpolates position / normal / extra per-vertex
 * attributes at every sample, calls `field`, and averages the covered sub-samples of each texel (edge texels are
 * not darkened by empty samples). Step 3 `dilate`: iterative 4-neighbour max into empty texels. Step 4
 * `toRgbRows`: float 0..1 → bytes with row 0 = v 1 (PNG top), as §3.1 specifies.
 */

/**
 * @param {number} size texture size S (power of two)
 * @param {Float32Array|Float64Array} uv per render vertex (u, v), v up (OBJ convention)
 * @param {Uint32Array|number[]} tris render-vertex triangle indices (body only)
 * @param {number} ss sub-samples per axis (2 at 1024 → 4 per texel)
 */
export function sampleMap(size, uv, tris, ss = 1) {
  const S = size * ss;
  const owner = new Int32Array(S * S).fill(-1);
  const B1 = new Float32Array(S * S), B2 = new Float32Array(S * S);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    // sample-space coordinates: sample (i, j) centre at ((i + 0.5)/S, (j + 0.5)/S)
    let ax = uv[a * 2] * S, ay = uv[a * 2 + 1] * S, bx = uv[b * 2] * S, by = uv[b * 2 + 1] * S, cx = uv[c * 2] * S, cy = uv[c * 2 + 1] * S;
    let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    // make the triangle counter-clockwise; `swapped` remembers that b and c traded places
    const swapped = area < 0;
    if (swapped) { [bx, cx] = [cx, bx]; [by, cy] = [cy, by]; area = -area; }
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(S - 1, Math.ceil(Math.max(ay, by, cy)));
    // edge functions for a counter-clockwise triangle; top-left rule: an edge owns its samples when it is a
    // "left" edge (dy < 0) or a "top" edge (dy == 0, dx < 0) in this y-up frame
    const tl = (ex, ey) => (ey < 0 || (ey === 0 && ex < 0));
    const e0tl = tl(cx - bx, cy - by), e1tl = tl(ax - cx, ay - cy), e2tl = tl(bx - ax, by - ay);
    for (let j = y0; j <= y1; j++) {
      const py = j + 0.5;
      for (let i = x0; i <= x1; i++) {
        const px = i + 0.5;
        const w0 = (cx - bx) * (py - by) - (cy - by) * (px - bx);   // weight of a
        const w1 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);   // weight of b
        const w2 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);   // weight of c
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        if ((w0 === 0 && !e0tl) || (w1 === 0 && !e1tl) || (w2 === 0 && !e2tl)) continue;
        const k = j * S + i;
        owner[k] = t / 3;
        // B1/B2 = weights of the ORIGINAL second/third vertex of the triangle
        B1[k] = (swapped ? w2 : w1) / area; B2[k] = (swapped ? w1 : w2) / area;
      }
    }
  }
  // compact
  let n = 0;
  for (let k = 0; k < owner.length; k++) if (owner[k] >= 0) n++;
  const sample = new Int32Array(n), tri = new Int32Array(n), b1 = new Float32Array(n), b2 = new Float32Array(n);
  n = 0;
  for (let k = 0; k < owner.length; k++) {
    if (owner[k] < 0) continue;
    const i = k % S, j = (k / S) | 0;
    sample[n] = ((j / ss) | 0) * size + ((i / ss) | 0);   // texel index (row j from the bottom)
    tri[n] = owner[k]; b1[n] = B1[k]; b2[n] = B2[k];
    n++;
  }
  return { size, ss, count: n, texel: sample, tri, b1, b2, tris };
}

/**
 * Evaluates a field over every sample of a map.
 * @param {ReturnType<typeof sampleMap>} map
 * @param {{pos: Float64Array|Float32Array, nrm: Float64Array|Float32Array, attr?: Float32Array, attrSize?: number}} verts
 *        per render vertex: position (3), normal (3), optional extra attributes (attrSize each, e.g. bone weights)
 * @param {(p:Float64Array, n:Float64Array, a:Float64Array, out:Float64Array, tri:number)=>void} field writes `channels` values
 * @param {number} channels
 * @param {(tri:number)=>boolean} [triFilter] skip triangles (field = 0) for speed
 * @returns {{img: Float32Array, covered: Uint8Array}} texel values (row 0 = v 0) and coverage
 */
export function evaluate(map, verts, field, channels, triFilter = null) {
  const { size, count, texel, tri, b1, b2, tris } = map;
  const img = new Float32Array(size * size * channels);
  const hits = new Uint16Array(size * size);
  const p = new Float64Array(3), n = new Float64Array(3), out = new Float64Array(channels);
  const as = verts.attrSize || 0, a = new Float64Array(Math.max(1, as));
  const P = verts.pos, N = verts.nrm, A = verts.attr;
  for (let s = 0; s < count; s++) {
    const t = tri[s], tx = texel[s];
    hits[tx]++;
    if (triFilter && !triFilter(t)) continue;
    const ia = tris[t * 3], ib = tris[t * 3 + 1], ic = tris[t * 3 + 2];
    const wb = b1[s], wc = b2[s], wa = 1 - wb - wc;
    for (let k = 0; k < 3; k++) {
      p[k] = P[ia * 3 + k] * wa + P[ib * 3 + k] * wb + P[ic * 3 + k] * wc;
      n[k] = N[ia * 3 + k] * wa + N[ib * 3 + k] * wb + N[ic * 3 + k] * wc;
    }
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= l; n[1] /= l; n[2] /= l;
    for (let k = 0; k < as; k++) a[k] = A[ia * as + k] * wa + A[ib * as + k] * wb + A[ic * as + k] * wc;
    out.fill(0);
    field(p, n, a, out, t);
    for (let c = 0; c < channels; c++) img[tx * channels + c] += out[c];
  }
  const covered = new Uint8Array(size * size);
  for (let k = 0; k < size * size; k++) {
    if (!hits[k]) continue;
    covered[k] = 1;
    for (let c = 0; c < channels; c++) img[k * channels + c] /= hits[k];
  }
  return { img, covered };
}

/** Iterative 4-neighbour max into empty texels (`iters` px), in place; marks filled texels covered. */
export function dilate(img, covered, size, channels, iters) {
  let cov = covered;
  for (let it = 0; it < iters; it++) {
    const next = cov.slice();
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const k = j * size + i;
      if (cov[k]) continue;
      let any = false;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= size || jj >= size) continue;
        const q = jj * size + ii;
        if (!cov[q]) continue;
        any = true;
        for (let c = 0; c < channels; c++) if (img[q * channels + c] > img[k * channels + c]) img[k * channels + c] = img[q * channels + c];
      }
      if (any) next[k] = 1;
    }
    cov = next;
  }
  covered.set(cov);
  return img;
}

/** Float channels 0..1 (row 0 = v 0) → RGB bytes with row 0 = v 1 (top of the PNG). Missing channels = 0. */
export function toRgbRows(img, size, channels) {
  const out = new Uint8Array(size * size * 3);
  for (let j = 0; j < size; j++) {
    const row = size - 1 - j;
    for (let i = 0; i < size; i++) {
      const k = j * size + i, o = (row * size + i) * 3;
      for (let c = 0; c < 3; c++) {
        const v = c < channels ? img[k * channels + c] : 0;
        out[o + c] = Math.round(Math.max(0, Math.min(1, v)) * 255);
      }
    }
  }
  return out;
}

/** Box-downsamples a float image by 2 (used where a field is evaluated at 1024 and stored at 512). */
export function downsample2(img, size, channels) {
  const h = size >> 1, out = new Float32Array(h * h * channels);
  for (let j = 0; j < h; j++) for (let i = 0; i < h; i++) for (let c = 0; c < channels; c++) {
    let s = 0;
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) s += img[((j * 2 + dj) * size + i * 2 + di) * channels + c];
    out[(j * h + i) * channels + c] = s / 4;
  }
  return out;
}
