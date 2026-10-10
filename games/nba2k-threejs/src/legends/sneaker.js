/**
 * @module legends/sneaker
 * Procedural basketball sneakers (spec v2 §3.8, [CHR §7.6]) — pure, no three.js, Node-testable.
 *
 *   buildSneaker(feet, cut, side, lod, opts?) → { position, normal, uv, skinIndex, skinWeight, index, partId,
 *                                                 vertexCount, triangleCount, frame }
 *
 * Geometry is built in the player's bind (rest) space around the barefoot foot, with the outsole bottom on y = 0 (no
 * sole lift, D-CHR-7). Parts (`partId` per vertex, `PART`): upper (superellipse sections over the foot, open at the
 * collar), sole side wall (outsole + midsole bands), sole bottom, collar lining, sole top lip (not on the low LOD).
 * UVs are LOCAL per part (0..1); the kit assembler remaps them into the atlas rects of `kitPainter.KIT_LAYOUT`:
 *   upper  u = s (heel 0 → toe 1), v = height fraction h of the section: 0.5·h medial, 1 − 0.5·h lateral (0 medial
 *          bottom → 0.5 top line / collar → 1 lateral bottom), so "lower 45 %" is v < 0.225 or v > 0.775 everywhere;
 *   wall   u = perimeter fraction, v = 0 outsole bottom → 0.25 outsole top → 1 midsole top;
 *   bottom planar (u = s, v = 0.5 + q / (2·maxHalfWidth)); lining / lip: constant swatch coordinates.
 * Skinning ([CHR §7.6]): s < sBall − 0.06 → foot 1; s > sBall + 0.03 → ball 1; linear in between; high and mid-high
 * collars add calf 0.25 (foot 0.75) on the top 30 % of the collar height for s < 0.3 (ramped over ±5 % of the height
 * so an ankle flex bends the collar instead of creasing it).
 *
 * Frame note: the header's toe point is the frontmost foot vertex (the big toe, ≈ 3.4 cm medial of the foot axis),
 * so the axis `f` runs from the heel to the BALL joint (the measured foot centreline) and the length is the toe's
 * projection on it: L = s(T) + 0.020, start 0.006 behind the heel. The spec's toe-centre medial shift (0.08·Wb for
 * s > 0.8) then lands the toe box on the big toe as intended.
 */

/** Part ids written to `partId`. */
export const PART = Object.freeze({ UPPER: 0, WALL: 1, BOTTOM: 2, LINING: 3, LIP: 4 });

/** Collar height Hc above the floor at the heel (m) per cut ([CHR §7.6]). */
export const COLLAR_H = Object.freeze({ low: 0.085, 'low-mid': 0.100, 'mid-high': 0.125, high: 0.145 });

/** Tessellation per LOD: stations N, section points P, sole perimeter points ([CHR §7.6]). */
export const SNEAKER_LOD = Object.freeze({
  high: Object.freeze({ stations: 22, section: 16, perimeter: 44, lip: true }),
  low: Object.freeze({ stations: 12, section: 10, perimeter: 24, lip: false }),
});

/** Default bone indices (header / rig order): foot, ball, calf per side. */
export const SNEAKER_BONES = Object.freeze({
  l: Object.freeze({ foot: 4, ball: 5, calf: 3 }),
  r: Object.freeze({ foot: 8, ball: 9, calf: 7 }),
});

const SUPER_N = 2.6;          // superellipse exponent of the upper sections
// Leg opening. [CHR §7.6] opens the lacing throat at s 0.22 with the tongue top (Hc + 0.010) at s 0.30; on the baked
// feet the shin column at collar height spans s ≈ 0.09–0.32, so a closed tongue at s 0.22–0.30 cuts through the
// leg. The collar opening therefore runs to s 0.34 (≈ 11 cm long, a real high-top opening) and the tongue rises to
// Hc + 0.010 at its front edge; the lacing throat (eyestays, painted) still spans s 0.22–0.62.
const THROAT_S0 = 0.34;       // collar opening ends / tongue front edge
const THROAT_TONGUE_S = 0.36; // tongue top Hc + 0.010 here
const HEEL_LEAN = 0.16;       // heel counter leans forward 0.16 m per m of height (follows the Achilles)
const COLLAR_FLARE = 0.20;    // collar walls widen up to +20 % at the collar line so ankle / sock stay inside
const COLLAR_DIP_S = 0.18;    // ankle-side dip of the collar line
const LINING_IN = 0.003, LINING_DOWN = 0.015;
const FLARE = 0.003;          // sole side wall beyond the outline
const LIP_IN = 0.004;         // sole lip reaches this far inside the outline (hides the upper/sole joint)

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Normalised cut name ('lowmid' → 'low-mid', …). */
export function normCut(cut) {
  if (cut === 'lowmid') return 'low-mid';
  if (cut === 'midhigh') return 'mid-high';
  if (!(cut in COLLAR_H)) throw new Error(`sneaker: unknown cut ${cut}`);
  return cut;
}

/**
 * Monotone-free cardinal (Catmull-Rom) Hermite interpolation through non-uniform knots; tangents are central
 * differences (one-sided at the ends). Used for the outline half-width w(s).
 */
function catmull(ks, vs, s) {
  const n = ks.length;
  if (s <= ks[0]) return vs[0];
  if (s >= ks[n - 1]) return vs[n - 1];
  let i = 0;
  while (s > ks[i + 1]) i++;
  const h = ks[i + 1] - ks[i], t = (s - ks[i]) / h;
  const m = (k) => (k <= 0 ? (vs[1] - vs[0]) / (ks[1] - ks[0]) : k >= n - 1 ? (vs[n - 1] - vs[n - 2]) / (ks[n - 1] - ks[n - 2])
    : (vs[k + 1] - vs[k - 1]) / (ks[k + 1] - ks[k - 1]));
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * vs[i] + (t3 - 2 * t2 + t) * h * m(i) + (-2 * t3 + 3 * t2) * vs[i + 1] + (t3 - t2) * h * m(i + 1);
}

/** Piecewise-linear interpolation through (ks, vs). */
function lin(ks, vs, s) {
  if (s <= ks[0]) return vs[0];
  for (let i = 0; i < ks.length - 1; i++) if (s <= ks[i + 1]) return vs[i] + (vs[i + 1] - vs[i]) * (s - ks[i]) / (ks[i + 1] - ks[i]);
  return vs[vs.length - 1];
}

/**
 * Shoe profile functions of one foot (pure, exported for tests).
 * @returns {{L, sBall, Hc, w(s), wMed(s), wLat(s), centre(s), yBottom(s), yMid(s), top(s), collar(s), point(s, q, y, out)}}
 */
export function sneakerProfile(foot, cut, side) {
  const c = normCut(cut);
  const H = foot.heel, T = foot.toe, B = foot.ball;
  let fx = B[0] - H[0], fz = B[2] - H[2];
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl; fz /= fl;
  // up × f = (fz, 0, −fx) points to the character's LEFT for a forward foot; lateral is outward for each foot.
  const sg = side === 'l' ? 1 : -1;
  const lx = sg * fz, lz = -sg * fx;
  const sT = (T[0] - H[0]) * fx + (T[2] - H[2]) * fz;
  const L = sT + 0.020;
  const ox = H[0] - 0.006 * fx, oz = H[2] - 0.006 * fz;
  const sBall = ((B[0] - ox) * fx + (B[2] - oz) * fz) / L;
  const Wh = foot.widthHeel + 0.012, Wb = foot.widthBall + 0.014;
  const KS = [0, 0.04, 0.15, 0.35, 0.68, 0.85, 0.95, 1];
  const VS = [0, 0.36 * Wh, 0.50 * Wh, 0.47 * Wb, 0.50 * Wb, 0.44 * Wb, 0.30 * Wb, 0];
  const Hc = COLLAR_H[c];
  const dip = c === 'low' ? 0.020 : 0.012;
  // heel / ankle region 12 % wider than the knots (fading out by s 0.45): the baked heels are up to ±3.9 cm wide at
  // ankle height while 0.5·Wh ≈ 3.6 cm, and the sock shell (+2.5 mm) must stay inside the counter
  const w = (s) => Math.max(0, catmull(KS, VS, s)) * (1 + 0.12 * (1 - smooth(0.25, 0.45, s)));
  // medial arch: ×0.92 for s 0.30–0.50 (ramped over 0.05 at both ends)
  const archK = (s) => 1 - 0.08 * smooth(0.25, 0.30, s) * (1 - smooth(0.50, 0.55, s));
  const wLat = (s) => w(s);
  const wMed = (s) => w(s) * archK(s);
  const centre = (s) => -0.08 * Wb * smooth(0.8, 1.0, s);          // toe centre shifted medially (q < 0 = medial)
  const spring = (s) => (s > 0.85 ? 0.012 * ((s - 0.85) / 0.15) ** 2 : 0);
  const yBottom = (s) => spring(s);
  const yMid = (s) => 0.026 + (0.020 - 0.026) * smooth(0.30, 0.70, s) + spring(s);
  // collar line (open region) and closed-section top line (tongue → instep → toe box)
  const collar = (s) => Hc - dip * Math.exp(-(((s - COLLAR_DIP_S) / 0.07) ** 2));
  const top = (s) => {
    if (s < THROAT_S0) return collar(s);
    if (s <= THROAT_TONGUE_S) return lin([THROAT_S0, THROAT_TONGUE_S], [Hc + 0.006, Hc + 0.010], s);
    return lin([THROAT_TONGUE_S, 0.62, 0.75, 0.85, 0.95, 1.0], [Hc + 0.010, 0.080, 0.065, 0.052, 0.038, 0.025], s) + spring(s);
  };
  const point = (s, q, y, out) => {
    const d = s * L;
    out[0] = ox + fx * d + lx * q;
    out[1] = y;
    out[2] = oz + fz * d + lz * q;
    return out;
  };
  return { cut: c, L, sBall, Hc, Wh, Wb, fx, fz, lx, lz, ox, oz, w, wMed, wLat, centre, yBottom, yMid, top, collar, point };
}

/**
 * Builds one sneaker.
 * @param {object} feet  header `players[i].feet` ({l, r}) or a single foot record
 * @param {string} cut   'low' | 'low-mid' | 'mid-high' | 'high' (also 'lowmid', 'midhigh')
 * @param {'l'|'r'} side
 * @param {'high'|'low'} lod  'high' = medium/high tiers (≈ 950 tris), 'low' = low tier / body LOD 3 (≈ 320 tris)
 * @param {{bones?: {foot, ball, calf}}} [opts]
 */
export function buildSneaker(feet, cut, side, lod, opts) {
  const foot = feet && feet.heel ? feet : feet[side];
  if (!foot) throw new Error('sneaker: no foot data');
  const Lp = SNEAKER_LOD[lod === 'low' ? 'low' : 'high'];
  const bones = (opts && opts.bones) || SNEAKER_BONES[side];
  const pr = sneakerProfile(foot, cut, side);
  const N = Lp.stations, P = Lp.section, M = Lp.perimeter, half = P >> 1, m = M >> 1;
  const highCollar = pr.cut === 'high' || pr.cut === 'mid-high';

  const pos = [], uv = [], part = [], sv = [], hv = [];   // sv = s per vertex (skinning), hv = height fraction
  const idx = [];
  const tmp = [0, 0, 0];
  const push = (x, y, z, u, v, pid, s, hf) => { pos.push(x, y, z); uv.push(u, v); part.push(pid); sv.push(s); hv.push(hf); return part.length - 1; };
  const quad = (a, b, c, d) => { idx.push(a, b, c, a, c, d); };

  // ---- upper ----
  const stS = new Float64Array(N);
  for (let i = 0; i < N; i++) stS[i] = 0.5 - 0.5 * Math.cos(Math.PI * i / (N - 1));
  const open = new Uint8Array(N);
  const upperBase = part.length;
  const e = 2 / SUPER_N;
  for (let i = 0; i < N; i++) {
    const s = stS[i];
    const isOpen = s < THROAT_S0;
    open[i] = isOpen ? 1 : 0;
    const ym = pr.yMid(s), c = pr.centre(s), wm = pr.wMed(s), wl = pr.wLat(s);
    // Open (collar) sections: a superellipse of virtual height (collar + 0.10) cut at the collar line, so the walls
    // stay near-vertical (opening ≈ 0.9 w) and the leg fits through the opening.
    let topY, tc = 0.5;
    if (isOpen) {
      const C = pr.collar(s);
      topY = C + 0.10;
      const fy = (C - ym) / (topY - ym);                       // = |cos ψc|^(2/n)
      const psiC = Math.acos(Math.min(1, Math.pow(fy, SUPER_N / 2)));
      tc = 0.5 - psiC / Math.PI;                                // t of the cut on the medial wall
    } else topY = pr.top(s);
    for (let j = 0; j < P; j++) {
      let t;
      if (isOpen) t = j < half ? tc * j / (half - 1) : 1 - tc * (P - 1 - j) / (half - 1);
      else t = j / (P - 1);
      const psi = (t - 0.5) * Math.PI;                          // −π/2 medial bottom … 0 top … +π/2 lateral bottom
      const sp = Math.sin(psi), cp = Math.cos(psi);
      const sx = Math.sign(sp) * Math.pow(Math.abs(sp), e), sy = Math.pow(Math.abs(cp), e);
      const y = ym + (topY - ym) * sy;
      const flare = isOpen || s < THROAT_S0 + 0.08 ? 1 + COLLAR_FLARE * smooth(0.3, 1, (y - ym) / Math.max(1e-6, pr.Hc - ym)) * (1 - smooth(0.2, THROAT_S0 + 0.08, s)) : 1;
      const q = c + (sx < 0 ? wm : wl) * sx * flare;
      // heel lean: the back of the upper moves forward with height, fading out by the end of the opening
      const sl = s + HEEL_LEAN * (y - ym) * (1 - smooth(0, THROAT_S0, s)) / pr.L;
      pr.point(sl, q, y, tmp);
      // v = height fraction of the section (collar line for open sections): medial half 0 → 0.5, lateral 0.5 → 1
      const hfr = isOpen ? (y - ym) / Math.max(1e-6, pr.collar(s) - ym) : sy;
      push(tmp[0], tmp[1], tmp[2], s, j < half ? 0.5 * hfr : 1 - 0.5 * hfr, PART.UPPER, s, (y - ym) / Math.max(1e-6, pr.Hc - ym));
    }
  }
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < P - 1; j++) {
      if (j === half - 1 && open[i]) continue;                  // collar opening (and its front edge at the tongue)
      const a = upperBase + i * P + j, b = upperBase + (i + 1) * P + j;
      // winding: outward normals (s forward × t from medial to lateral over the top)
      quad(a, a + 1, b + 1, b);
    }
  }

  // ---- collar lining: the collar edge duplicated 3 mm inward and 15 mm down ----
  const edge = [];
  for (let i = N - 1; i >= 0; i--) if (open[i]) edge.push(upperBase + i * P + half);        // lateral top, front → back
  for (let i = 0; i < N; i++) if (open[i]) edge.push(upperBase + i * P + half - 1);          // medial top, back → front
  const liningBase = part.length;
  for (let k = 0; k < edge.length; k++) {
    const vi = edge[k], s = sv[vi];
    const x = pos[vi * 3], y = pos[vi * 3 + 1], z = pos[vi * 3 + 2];
    pr.point(s, pr.centre(s), 0, tmp);                           // section centre (ground) → inward direction
    let dx = tmp[0] - x, dz = tmp[2] - z;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = pr.fx; dz = pr.fz; }      // heel back: inward = forward
    push(x, y, z, 0.5, 0.5, PART.LINING, s, hv[vi]);
    push(x + dx * LINING_IN, y - LINING_DOWN, z + dz * LINING_IN, 0.5, 0.5, PART.LINING, s, hv[vi] * 0.85);
  }
  for (let k = 0; k < edge.length - 1; k++) {
    const a = liningBase + k * 2, b = liningBase + (k + 1) * 2;
    quad(a, b, b + 1, a + 1);
  }

  // ---- sole rings: perimeter stations (lateral heel → toe, medial toe → heel) ----
  const ring = [];                                              // [s, q, tipDir] per perimeter point
  for (let k = 0; k <= m; k++) ring.push([0.5 - 0.5 * Math.cos(Math.PI * k / m), 1]);
  for (let k = m - 1; k >= 1; k--) ring.push([0.5 - 0.5 * Math.cos(Math.PI * k / m), -1]);
  let maxW = 0;
  for (let k = 0; k <= 40; k++) maxW = Math.max(maxW, pr.w(k / 40));
  const ringPoint = (k, y0fn, flare, out) => {
    const [s, sd] = ring[k];
    const c = pr.centre(s);
    const ww = (sd > 0 ? pr.wLat(s) : pr.wMed(s)) + flare;
    let ss = s;
    if (k === 0) ss = s - flare / pr.L;                         // heel tip pushed back by the flare
    else if (k === m) ss = s + flare / pr.L;                    // toe tip pushed forward
    const q = (k === 0 || k === m) ? c : c + sd * ww;
    return pr.point(ss, q, y0fn(s), out);
  };
  const wallBase = part.length;
  const levels = [[pr.yBottom, 0], [(s) => pr.yBottom(s) + 0.006, 0.25], [pr.yMid, 1]];
  for (let L = 0; L < 3; L++) {
    for (let k = 0; k < M; k++) {
      ringPoint(k, levels[L][0], FLARE, tmp);
      push(tmp[0], tmp[1], tmp[2], k / M, levels[L][1], PART.WALL, ring[k][0], 0);
    }
  }
  for (let L = 0; L < 2; L++) {
    for (let k = 0; k < M; k++) {
      const k1 = (k + 1) % M;
      const a = wallBase + L * M + k, b = wallBase + L * M + k1, c2 = wallBase + (L + 1) * M + k1, d = wallBase + (L + 1) * M + k;
      // ring order runs lateral-forward then medial-backward, i.e. counter-clockwise seen from above for the left
      // foot and clockwise for the right foot — the winding is fixed below by the normal orientation pass.
      quad(a, b, c2, d);
    }
  }
  // ---- sole bottom: strip between the lateral (k) and medial (M − k) halves of the ring ----
  const botBase = part.length;
  for (let k = 0; k < M; k++) {
    ringPoint(k, pr.yBottom, FLARE, tmp);
    const s = ring[k][0], sd = (k === 0 || k === m) ? 0 : ring[k][1];
    push(tmp[0], tmp[1], tmp[2], s, 0.5 + sd * ((sd > 0 ? pr.wLat(s) : pr.wMed(s)) + FLARE) / (2 * (maxW + FLARE)), PART.BOTTOM, s, 0);
  }
  for (let k = 0; k < m; k++) {
    const l0 = botBase + k, l1 = botBase + k + 1;
    const m0 = botBase + (k === 0 ? 0 : M - k), m1 = botBase + (k + 1 === m ? m : M - (k + 1));
    if (k === 0) idx.push(l0, l1, m1);
    else if (k + 1 === m) idx.push(l0, l1, m0);
    else quad(l0, l1, m1, m0);
  }
  // ---- sole lip (medium/high): ring at the midsole top from the flare to 4 mm inside the outline ----
  if (Lp.lip) {
    const lipBase = part.length;
    for (let k = 0; k < M; k++) {
      ringPoint(k, pr.yMid, FLARE, tmp);
      push(tmp[0], tmp[1], tmp[2], k / M, 0.95, PART.LIP, ring[k][0], 0);
      ringPoint(k, pr.yMid, -LIP_IN, tmp);
      push(tmp[0], tmp[1], tmp[2], k / M, 0.95, PART.LIP, ring[k][0], 0);
    }
    for (let k = 0; k < M; k++) {
      const k1 = (k + 1) % M;
      quad(lipBase + k * 2, lipBase + k1 * 2, lipBase + k1 * 2 + 1, lipBase + k * 2 + 1);
    }
  }

  const n = part.length;
  const position = Float32Array.from(pos);
  const index = Uint16Array.from(idx);
  orientOutward(position, index, part, pr);
  const normal = computeNormals(position, index, n);

  // ---- skinning ----
  const skinIndex = new Uint8Array(n * 4), skinWeight = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const s = sv[v];
    const wb = Math.min(1, Math.max(0, (s - (pr.sBall - 0.06)) / 0.09));   // linear from sBall − 0.06 to sBall + 0.03
    let wf = 1 - wb, wc = 0;
    if (highCollar && part[v] !== PART.WALL && part[v] !== PART.BOTTOM && part[v] !== PART.LIP && s < 0.3) {
      wc = 0.25 * smooth(0.65, 0.75, hv[v]) * (1 - smooth(0.25, 0.3, s));
      wf -= wc;
    }
    skinIndex[v * 4] = bones.foot; skinWeight[v * 4] = wf;
    skinIndex[v * 4 + 1] = bones.ball; skinWeight[v * 4 + 1] = wb;
    skinIndex[v * 4 + 2] = bones.calf; skinWeight[v * 4 + 2] = wc;
    skinIndex[v * 4 + 3] = bones.foot; skinWeight[v * 4 + 3] = 0;
  }
  return {
    position, normal, uv: Float32Array.from(uv), skinIndex, skinWeight, index, partId: Uint8Array.from(part),
    vertexCount: n, triangleCount: index.length / 3,
    frame: { L: pr.L, sBall: pr.sBall, Hc: pr.Hc, cut: pr.cut },
  };
}

/**
 * Flips triangles whose face normal points into the shoe. Inside reference = the foot axis at mid sole height
 * (y 0.03) at s clamped to [0.12, 0.88], so heel-back and toe-tip faces are judged against a point ahead of / behind
 * them. Bottom faces must point down, lip faces up, lining faces inward (toward the leg). Independent of the side
 * (the right foot's mirrored lateral axis reverses every hand-written winding).
 */
function orientOutward(p, idx, part, pr) {
  const ref = [0, 0, 0];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const pid = part[idx[t]];
    let dot;
    if (pid === PART.BOTTOM) dot = -ny;
    else if (pid === PART.LIP) dot = ny;
    else {
      const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      const s = Math.min(0.88, Math.max(0.12, ((cx - pr.ox) * pr.fx + (cz - pr.oz) * pr.fz) / pr.L));
      pr.point(s, pr.centre(s), 0.03, ref);
      dot = nx * (cx - ref[0]) + ny * (cy - ref[1]) + nz * (cz - ref[2]);
      if (pid === PART.LINING) dot = -dot;
    }
    if (dot < 0) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
  }
}

/** Area-weighted vertex normals. */
function computeNormals(p, idx, n) {
  const out = new Float32Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { out[k] += nx; out[k + 1] += ny; out[k + 2] += nz; }
  }
  for (let v = 0; v < n; v++) {
    const x = out[v * 3], y = out[v * 3 + 1], z = out[v * 3 + 2];
    const l = Math.sqrt(x * x + y * y + z * z);
    if (l > 1e-12) { out[v * 3] = x / l; out[v * 3 + 1] = y / l; out[v * 3 + 2] = z / l; } else out[v * 3 + 1] = 1;
  }
  return out;
}
