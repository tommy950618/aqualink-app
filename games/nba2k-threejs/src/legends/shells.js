/**
 * @module legends/shells
 * Shell geometry and body index assembly (spec v2 §3.4, [CHR §1.5], FORMAT.md § Shells) — pure typed-array code, no
 * three.js (character.js wraps the results in BufferGeometries).
 *
 * Exports
 *   shellSkin(shell, keptSkinIndex, keptSkinWeight)  → {skinIndex: Uint8Array, skinWeight: Float32Array} (cached on shell)
 *   shellPositions(shell, kept, keptN, extraOffset?)  → {position, normal}  (offset along the blended normal + relax)
 *   relaxShell(shell, pos, nrm)                       cloth relaxation (outward-only Laplacian, pinned below pinBelowV)
 *   shellMorphs(shell, keptDeltas)                    → per-channel Float32Array | null  (Δ = lerp(Δa, Δb, t))
 *   uvMetric(position, uv, index, opts?)              → {metric(u, v, out)} metres per unit u / v (UV Jacobian grid)
 *   coveredLodIndex(shared, covered)                  → {index: Uint16Array, groups[lod] = [{start, count} skin, wet]}
 *   proxyGeometry(shared, kept)                       → compact uncovered-LOD3 body arrays for the shadow proxy
 *
 * A shell vertex lies on the body surface: base = lerp(P[a], P[b], t), n = normalize(lerp(N[a], N[b], t)),
 * position = base + n · offset · offsetScale. Skin weights are the t-blend of a's and b's influences, top 4,
 * renormalised; morph deltas are lerp(Δ[a], Δ[b], t), so shells follow the face and the jaw exactly like the skin.
 */

/** Skin weights of a shell (t-blend of the two source vertices, top 4, renormalised). Cached on the shell object. */
export function shellSkin(shell, keptSkinIndex, keptSkinWeight) {
  if (shell._skin) return shell._skin;
  const n = shell.n, A = shell.a, B = shell.b, T = shell.t;
  const skinIndex = new Uint8Array(n * 4), skinWeight = new Float32Array(n * 4);
  const bi = new Int32Array(8), bw = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let side = 0; side < 2; side++) {
      const k = side === 0 ? A[i] : B[i], w = side === 0 ? 1 - T[i] : T[i];
      if (w <= 0) continue;
      for (let j = 0; j < 4; j++) {
        const wt = keptSkinWeight[k * 4 + j] / 255 * w;
        if (wt <= 0) continue;
        const b = keptSkinIndex[k * 4 + j];
        let f = -1;
        for (let q = 0; q < m; q++) if (bi[q] === b) { f = q; break; }
        if (f >= 0) bw[f] += wt; else { bi[m] = b; bw[m] = wt; m++; }
      }
    }
    // top 4 by weight (selection sort over ≤ 8 entries)
    let sum = 0;
    for (let j = 0; j < 4; j++) {
      let best = -1;
      for (let q = j; q < m; q++) if (best < 0 || bw[q] > bw[best]) best = q;
      if (best < 0) { skinIndex[i * 4 + j] = skinIndex[i * 4]; skinWeight[i * 4 + j] = 0; continue; }
      const tb = bi[j], tw = bw[j];
      bi[j] = bi[best]; bw[j] = bw[best]; bi[best] = tb; bw[best] = tw;
      skinIndex[i * 4 + j] = bi[j]; skinWeight[i * 4 + j] = bw[j];
      sum += bw[j];
    }
    if (sum > 0) for (let j = 0; j < 4; j++) skinWeight[i * 4 + j] /= sum;
    else skinWeight[i * 4] = 1;
  }
  shell._skin = { skinIndex, skinWeight };
  return shell._skin;
}

/**
 * Shell positions and normals on one player's kept mesh (bind pose).
 * @param {object} shell  decodeShell() result
 * @param {Float32Array} kept  kept positions  @param {Float32Array} keptN  kept normals
 * @param {number} [extraOffset=0]  metres added to the header offset
 */
export function shellPositions(shell, kept, keptN, extraOffset = 0) {
  const n = shell.n, A = shell.a, B = shell.b, T = shell.t, OS = shell.offsetScale;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const off = shell.info.offset + extraOffset;
  for (let i = 0; i < n; i++) {
    const a = A[i] * 3, b = B[i] * 3, u = T[i], o = off * OS[i];
    let nx = keptN[a] * (1 - u) + keptN[b] * u, ny = keptN[a + 1] * (1 - u) + keptN[b + 1] * u, nz = keptN[a + 2] * (1 - u) + keptN[b + 2] * u;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
    pos[i * 3] = kept[a] * (1 - u) + kept[b] * u + nx * o;
    pos[i * 3 + 1] = kept[a + 1] * (1 - u) + kept[b + 1] * u + ny * o;
    pos[i * 3 + 2] = kept[a + 2] * (1 - u) + kept[b + 2] * u + nz * o;
  }
  if (shell.info.relax) relaxShell(shell, pos, nrm);
  return { position: pos, normal: nrm };
}

/**
 * Cloth relaxation (FORMAT.md `relax`, PoC loader port restricted to the normal): Laplacian smoothing over welded shell vertices
 * (vertices duplicated at UV seams share a,b,t) that may only move a vertex OUTWARD from its minimum offset
 * (dot(p − base, n) ≥ offset), so concavities (crotch, buttock cleft, between the pecs) are bridged like fabric.
 * Boundary vertices only smooth along the boundary; vertices with local v < `pinBelowV` (jersey inside the shorts)
 * are pinned at their minimum offset (no outward push, §3.8 tucked jersey).
 */
export function relaxShell(shell, pos, nrm) {
  const n = shell.n;
  if (!shell._adj) {
    const weld = new Map(), wid = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const key = shell.a[i] * 65536 * 256 + shell.b[i] * 256 + Math.round(shell.t[i] * 255);
      let w = weld.get(key);
      if (w === undefined) { w = weld.size; weld.set(key, w); }
      wid[i] = w;
    }
    const m = weld.size, sets = Array.from({ length: m }, () => new Set());
    const idx = shell.index;
    for (let t = 0; t < idx.length; t += 3) {
      for (let j = 0; j < 3; j++) {
        const a = wid[idx[t + j]], b = wid[idx[t + (j + 1) % 3]];
        sets[a].add(b); sets[b].add(a);
      }
    }
    const boundary = new Uint8Array(m);
    for (let i = 0; i < n; i++) if (shell.edge[i] === 0) boundary[wid[i]] = 1;
    shell._adj = sets.map((st, i) => Int32Array.from([...st].filter((j) => !boundary[i] || boundary[j])));
    shell._wid = wid; shell._wm = m;
    const pin = new Uint8Array(m), pinV = shell.info.relax.pinBelowV;
    if (pinV != null) for (let i = 0; i < n; i++) if (shell.uv[i * 2 + 1] < pinV) pin[wid[i]] = 1;
    shell._pin = pin;
  }
  const adj = shell._adj, wid = shell._wid, wm = shell._wm, pin = shell._pin;
  const P = new Float32Array(wm * 3), Bs = new Float32Array(wm * 3), N = new Float32Array(wm * 3), O = new Float32Array(wm);
  const off = shell.info.offset;
  for (let i = 0; i < n; i++) {
    const w = wid[i], o = off * shell.offsetScale[i];
    for (let a = 0; a < 3; a++) {
      P[w * 3 + a] = pos[i * 3 + a]; N[w * 3 + a] = nrm[i * 3 + a]; Bs[w * 3 + a] = pos[i * 3 + a] - nrm[i * 3 + a] * o;
    }
    O[w] = o;
  }
  const it = shell.info.relax.iterations || 10, strength = shell.info.relax.strength || 0.5;
  const Q = new Float32Array(wm * 3);
  for (let k = 0; k < it; k++) {
    for (let w = 0; w < wm; w++) {
      const nb = adj[w];
      if (!nb.length || pin[w]) { Q[w * 3] = P[w * 3]; Q[w * 3 + 1] = P[w * 3 + 1]; Q[w * 3 + 2] = P[w * 3 + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let q = 0; q < nb.length; q++) { const j = nb[q] * 3; x += P[j]; y += P[j + 1]; z += P[j + 2]; }
      x = P[w * 3] + (x / nb.length - P[w * 3]) * strength;
      y = P[w * 3 + 1] + (y / nb.length - P[w * 3 + 1]) * strength;
      z = P[w * 3 + 2] + (z / nb.length - P[w * 3 + 2]) * strength;
      // keep only the NORMAL component of the smoothing step (a tangential slide would drag the vertex away from the
      // spot its baked UV belongs to and warp numbers / trims), and never below the minimum offset (outward-only)
      let d = (x - Bs[w * 3]) * N[w * 3] + (y - Bs[w * 3 + 1]) * N[w * 3 + 1] + (z - Bs[w * 3 + 2]) * N[w * 3 + 2];
      if (d < O[w]) d = O[w];
      Q[w * 3] = Bs[w * 3] + N[w * 3] * d; Q[w * 3 + 1] = Bs[w * 3 + 1] + N[w * 3 + 1] * d; Q[w * 3 + 2] = Bs[w * 3 + 2] + N[w * 3 + 2] * d;
    }
    P.set(Q);
  }
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] = P[wid[i] * 3 + a];
}

/**
 * Morph deltas of a shell per channel: lerp(Δ[a], Δ[b], t) of the kept-space deltas (null channels stay null).
 * @param {object} shell
 * @param {Array<Float32Array|null>} keptDeltas  kept-space deltas per channel (3 floats per kept vertex)
 */
export function shellMorphs(shell, keptDeltas) {
  const n = shell.n, A = shell.a, B = shell.b, T = shell.t;
  return keptDeltas.map((D) => {
    if (!D) return null;
    const out = new Float32Array(n * 3);
    let any = false;
    for (let i = 0; i < n; i++) {
      const a = A[i] * 3, b = B[i] * 3, u = T[i];
      for (let c = 0; c < 3; c++) {
        const v = D[a + c] * (1 - u) + D[b + c] * u;
        out[i * 3 + c] = v;
        if (v !== 0) any = true;
      }
    }
    return any ? out : null;
  });
}

/**
 * Local metric of a shell's UV map: metres of surface per unit u and per unit v, from the Jacobian of every triangle
 * (dP/du, dP/dv solved from two edges and their UV deltas), area-weighted into a grid over the UV range and dilated
 * into empty cells. `metric(u, v, out)` is periodic in u (u is taken mod 1: torso and limb UVs wrap) and bilinear.
 * @param {Float32Array} position  @param {Float32Array} uv  @param {Uint16Array} index
 * @param {{nu?: number, nv?: number}} [opts]
 */
export function uvMetric(position, uv, index, opts) {
  const NU = (opts && opts.nu) || 48, NV = (opts && opts.nv) || 24;
  const u0 = 0, u1 = 1;
  let v0 = Infinity, v1 = -Infinity;
  for (let i = 1; i < uv.length; i += 2) { if (uv[i] < v0) v0 = uv[i]; if (uv[i] > v1) v1 = uv[i]; }
  if (!(v1 > v0)) { v0 = 0; v1 = 1; }
  const su = new Float64Array(NU * NV), sv = new Float64Array(NU * NV), sw = new Float64Array(NU * NV);
  const tri = [];
  for (let t = 0; t < index.length; t += 3) {
    const i0 = index[t], i1 = index[t + 1], i2 = index[t + 2];
    const ax = position[i0 * 3], ay = position[i0 * 3 + 1], az = position[i0 * 3 + 2];
    const e1x = position[i1 * 3] - ax, e1y = position[i1 * 3 + 1] - ay, e1z = position[i1 * 3 + 2] - az;
    const e2x = position[i2 * 3] - ax, e2y = position[i2 * 3 + 1] - ay, e2z = position[i2 * 3 + 2] - az;
    const d1u = uv[i1 * 2] - uv[i0 * 2], d1v = uv[i1 * 2 + 1] - uv[i0 * 2 + 1];
    const d2u = uv[i2 * 2] - uv[i0 * 2], d2v = uv[i2 * 2 + 1] - uv[i0 * 2 + 1];
    const det = d1u * d2v - d2u * d1v;
    if (Math.abs(det) < 1e-12) continue;
    // [dP/du dP/dv] = [e1 e2] · [[d1u d2u] [d1v d2v]]⁻¹
    const pux = (e1x * d2v - e2x * d1v) / det, puy = (e1y * d2v - e2y * d1v) / det, puz = (e1z * d2v - e2z * d1v) / det;
    const pvx = (e2x * d1u - e1x * d2u) / det, pvy = (e2y * d1u - e1y * d2u) / det, pvz = (e2z * d1u - e1z * d2u) / det;
    const mu = Math.sqrt(pux * pux + puy * puy + puz * puz), mv = Math.sqrt(pvx * pvx + pvy * pvy + pvz * pvz);
    if (!isFinite(mu) || !isFinite(mv) || mu > 50 || mv > 50) continue;
    const area = Math.abs(det) + 1e-9;
    const cu = (uv[i0 * 2] + uv[i1 * 2] + uv[i2 * 2]) / 3, cv = (uv[i0 * 2 + 1] + uv[i1 * 2 + 1] + uv[i2 * 2 + 1]) / 3;
    const uw = cu - Math.floor(cu);
    const gx = Math.min(NU - 1, Math.max(0, Math.floor((uw - u0) / (u1 - u0) * NU)));
    const gy = Math.min(NV - 1, Math.max(0, Math.floor((cv - v0) / (v1 - v0) * NV)));
    const c = gy * NU + gx;
    su[c] += mu * area; sv[c] += mv * area; sw[c] += area;
    tri.push(mu, mv, area);
  }
  // robust range: area-weighted medians of the whole shell; cells are clamped to [0.6, 1.7] × median so the few
  // degenerate UV triangles of a cylindrical map (crotch V, seam fans) cannot blow a trim up
  const wmed = (k) => {
    const n = tri.length / 3, ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => tri[a * 3 + k] - tri[b * 3 + k]);
    let tot = 0;
    for (let i = 0; i < n; i++) tot += tri[i * 3 + 2];
    let acc = 0;
    for (const i of ord) { acc += tri[i * 3 + 2]; if (acc >= tot / 2) return tri[i * 3 + k]; }
    return 1;
  };
  const medU = tri.length ? wmed(0) : 1, medV = tri.length ? wmed(1) : 1;
  const MU = new Float32Array(NU * NV), MV = new Float32Array(NU * NV), ok = new Uint8Array(NU * NV);
  for (let c = 0; c < NU * NV; c++) if (sw[c] > 0) { MU[c] = su[c] / sw[c]; MV[c] = sv[c] / sw[c]; ok[c] = 1; }
  // dilate: empty cells take the mean of filled 4-neighbours (u wraps), until every cell is filled
  for (let pass = 0; pass < NU + NV; pass++) {
    let missing = 0;
    const add = [];
    for (let y = 0; y < NV; y++) {
      for (let x = 0; x < NU; x++) {
        const c = y * NU + x;
        if (ok[c]) continue;
        let a = 0, b = 0, k = 0;
        const nb = [y * NU + (x + 1) % NU, y * NU + (x + NU - 1) % NU, y > 0 ? c - NU : -1, y < NV - 1 ? c + NU : -1];
        for (const q of nb) if (q >= 0 && ok[q]) { a += MU[q]; b += MV[q]; k++; }
        if (k) add.push(c, a / k, b / k); else missing++;
      }
    }
    for (let i = 0; i < add.length; i += 3) { MU[add[i]] = add[i + 1]; MV[add[i]] = add[i + 2]; ok[add[i]] = 1; }
    if (!missing) break;
  }
  for (let c = 0; c < NU * NV; c++) {
    if (!ok[c]) { MU[c] = medU; MV[c] = medV; }
    MU[c] = Math.min(1.7 * medU, Math.max(0.6 * medU, MU[c]));
    MV[c] = Math.min(1.7 * medV, Math.max(0.6 * medV, MV[c]));
  }
  // one 3 × 3 box pass (u wraps) so per-segment pens and stripe widths vary smoothly
  for (const G of [MU, MV]) {
    const src = G.slice();
    for (let y = 0; y < NV; y++) {
      for (let x = 0; x < NU; x++) {
        let a = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= NV) continue;
          for (let dx = -1; dx <= 1; dx++) { a += src[yy * NU + (x + dx + NU) % NU]; k++; }
        }
        G[y * NU + x] = a / k;
      }
    }
  }
  return {
    v0, v1, medU, medV,
    /** Writes [metres per unit u, metres per unit v] at (u, v) into out. */
    metric(u, v, out) {
      const uw = u - Math.floor(u);
      const fx = uw * NU - 0.5, fy = Math.min(NV - 1, Math.max(0, (v - v0) / (v1 - v0) * NV - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const xa = (x0 + NU) % NU, xb = (x0 + 1 + NU) % NU, ya = y0, yb = Math.min(NV - 1, y0 + 1);
      const lerp2 = (G) => (G[ya * NU + xa] * (1 - tx) + G[ya * NU + xb] * tx) * (1 - ty) + (G[yb * NU + xa] * (1 - tx) + G[yb * NU + xb] * tx) * ty;
      out[0] = lerp2(MU); out[1] = lerp2(MV);
      return out;
    },
  };
}

/**
 * The four body LOD indices concatenated into ONE index array with covered body triangles removed (a triangle goes
 * when all three of its kept vertices are covered). LOD n is drawn by pointing the two geometry groups (skin, wet) at
 * its range, so one BufferGeometry (one morph texture) serves every LOD and cover set (§3.4 CRITIC) and an LOD switch
 * uploads nothing.
 * @param {object} shared  decodeShared() result
 * @param {Uint8Array|null} covered  per kept vertex (1 = hidden under worn cloth / shoes)
 * @returns {{index: Uint16Array, groups: Array<[{start, count}, {start, count}]>, triangles: number[]}}
 */
export function coveredLodIndex(shared, covered) {
  const r2k = shared.renderToKept;
  const parts = [], groups = [], tris = [];
  let total = 0;
  for (let l = 0; l < shared.lodIndex.length; l++) {
    const src = shared.lodIndex[l], g = shared.lodGroups[l];
    const body = g[0], wet = g[1];
    const out = new Uint16Array(body.count + wet.count);
    let o = 0;
    for (let i = body.start; i < body.start + body.count; i += 3) {
      const a = src[i], b = src[i + 1], c = src[i + 2];
      if (covered && covered[r2k[a]] && covered[r2k[b]] && covered[r2k[c]]) continue;
      out[o++] = a; out[o++] = b; out[o++] = c;
    }
    const bodyCount = o;
    for (let i = wet.start; i < wet.start + wet.count; i++) out[o++] = src[i];
    parts.push(out.subarray(0, o));
    groups.push([{ start: total, count: bodyCount }, { start: total + bodyCount, count: o - bodyCount }]);
    tris.push(o / 3);
    total += o;
  }
  const index = new Uint16Array(total);
  let off = 0;
  for (const p of parts) { index.set(p, off); off += p.length; }
  return { index, groups, triangles: tris };
}

/**
 * Compact arrays for the shadow proxy: the uncovered LOD3 body triangles (no wet group) over only the render
 * vertices they use (≈ 1.8k), with positions from the player's kept mesh and the shared skin weights.
 * @param {object} shared  decodeShared()  @param {Float32Array} kept  player kept positions
 */
export function proxyGeometry(shared, kept) {
  const src = shared.lodIndex[3], g = shared.lodGroups[3][0], r2k = shared.renderToKept;
  const remap = new Int32Array(shared.nRender).fill(-1);
  const verts = [];
  const index = new Uint16Array(g.count);
  for (let i = 0; i < g.count; i++) {
    const r = src[g.start + i];
    if (remap[r] < 0) { remap[r] = verts.length; verts.push(r); }
    index[i] = remap[r];
  }
  const n = verts.length;
  const position = new Float32Array(n * 3), skinIndex = new Uint8Array(n * 4), skinWeight = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = r2k[verts[i]];
    position[i * 3] = kept[k * 3]; position[i * 3 + 1] = kept[k * 3 + 1]; position[i * 3 + 2] = kept[k * 3 + 2];
    for (let j = 0; j < 4; j++) { skinIndex[i * 4 + j] = shared.skinIndex[k * 4 + j]; skinWeight[i * 4 + j] = shared.skinWeight[k * 4 + j]; }
  }
  return { position, skinIndex, skinWeight, index };
}
