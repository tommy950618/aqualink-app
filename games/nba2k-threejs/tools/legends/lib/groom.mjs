/**
 * groom.mjs — per-player grooming fields (hair, beard, brows) on the player's morphed mesh, in the player's face
 * frame (landmarks.mjs `faceFrame`). The same functions drive the groom shells (evaluated per kept vertex by
 * shells.mjs) and the skin masks (evaluated per texel by masks.mjs), so shell edges and painted skin edges agree.
 *
 * Conventions: every region function returns a signed, distance-like value in metres (> 0 inside), built from
 * terms such as `y − line(φ)` or `(φ − φ0)·r` (r = horizontal head radius), so marching-triangle cuts land at
 * the right place and `smooth(0, fade, f)` is a metric soft edge. A vertex/sample is `v = {x, y, z, nx, ny, nz,
 * w(...bones), ear}` (`ear` = 1 on the ear vertex set, interpolated for texels).
 *
 * Definitions: hairline function CHR §4.4 / SPEC-v2 §2.8, beard components CHR §5.1–§5.2, brows CHR §6.
 */

export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mix = (a, b, t) => a + (b - a) * t;
/** polynomial smooth maximum (rounded union), k = blend width in metres */
const smax = (a, b, k) => { if (k <= 0) return Math.max(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

/**
 * Parses a landmark-relative height such as "T.y-0.004", "CH.y+0.012", "EL.y+0.002" (player metres).
 * Landmark names without side suffix use the left side (`T` → `T_l`).
 */
export function landmarkY(expr, L) {
  if (typeof expr === 'number') return expr;
  const m = /^([A-Z]+)\.y\s*([+-]\s*[0-9.]+)?$/.exec(expr.replace(/\s+/g, ''));
  if (!m) throw new Error(`bad landmark expression ${expr}`);
  const p = L[m[1]] || L[`${m[1]}_l`];
  if (!p) throw new Error(`unknown landmark ${m[1]} in ${expr}`);
  return p[1] + (m[2] ? parseFloat(m[2]) : 0);
}

/** Lip curves of CHR §2.3 re-evaluated with the player's landmarks. */
export function lipCurves(f) {
  const { L } = f;
  const LS = L.LS, LI = L.LI, CH = L.CH_l, ST = L.ST, CHx = f.CHx;
  const q = (x) => Math.abs(x) / CHx;
  return {
    yU: (x) => LS[1] + 0.0008 * Math.exp(-(((Math.abs(x) - 0.0045) / 0.0030) ** 2)) - 0.0005 * Math.exp(-((x / 0.0018) ** 2)) - (LS[1] - CH[1]) * q(x) ** 2,
    yL: (x) => LI[1] + 0.0010 + (CH[1] - LI[1] - 0.0010) * Math.min(1.2, q(x)) ** 1.6,
    yS: (x) => ST[1] + (CH[1] - ST[1]) * q(x) ** 2,
  };
}

/** Ear geometry of the player: back-edge azimuth and box (from the ear vertex set). */
export function earInfo(f, earPts) {
  let phiEb = 0, zMin = Infinity, zMax = -Infinity, xMin = Infinity;
  for (const p of earPts) {
    phiEb = Math.max(phiEb, f.phi(p[0], p[2]));
    zMin = Math.min(zMin, p[2]); zMax = Math.max(zMax, p[2]); xMin = Math.min(xMin, Math.abs(p[0]));
  }
  return { phiEb, zMin, zMax, xMin };
}

// ------------------------------------------------------------------------------------------------- hair ----
/**
 * Hair region and attributes (CHR §4.4–§4.5).
 * @param {object} f face frame
 * @param {object} hair config appearance.hair ({hairline:{…}, layers:[…]})
 * @param {object|null} beard config appearance.beard (for sideburnBottom 'beard')
 * @param {object} ear earInfo()
 */
export function hairFields(f, hair, beard, ear) {
  const { L } = f;
  const hl = hair.hairline;
  const Gy = f.Gy, ETy = L.ET_l[1], ELy = L.EL_l[1];
  // `above` is the forehead height as the profiles give it: distance from the glabella measured up the forehead
  // surface (midline arc), converted to a height on this player's mesh (f.arcDy, built by the bake). As a plain
  // vertical offset, 6–7.5 cm would leave only ~2–3 cm of scalp in front of the vertex on these heads.
  const above = f.arcDy ? f.arcDy(hl.aboveCm / 100) : hl.aboveCm / 100;
  const frontCurve = (hl.frontCurveCm || 0) / 100, rec = (hl.recCm || 0) / 100;
  const phiC = f.phiT - (hl.sideburnWidthCm / 100) / f.rT;
  const earGap = hl.earGapMm / 1000;
  const napeY = ELy - hl.napeBelowLobeCm / 100;
  let ySB;
  if (hl.sideburnBottom === 'mid-ear') ySB = (ETy + ELy) / 2;
  else if (hl.sideburnBottom === 'beard') {
    if (!beard || !beard.components || !beard.components.F) throw new Error('sideburnBottom "beard" needs a full beard (components.F)');
    ySB = landmarkY(beard.components.F.yA, L);
  } else ySB = landmarkY(hl.sideburnBottom, L);
  const yF = (phi) => Gy + above + frontCurve * Math.min(1, phi / 0.6) ** 2;
  const yM = (phi) => yF(phi) + 0.9 * rec * Math.exp(-(((phi - 0.68) / 0.14) ** 2));
  const yBack = (phi) => (phi < ear.phiEb + 0.05 ? ETy + earGap
    : phi < 2.35 ? mix(ETy + earGap, napeY, smooth(ear.phiEb + 0.05, 2.35, phi)) : napeY);
  // temple corner: square = 1.5 mm smoothing, round = blend over 0.15 rad (as a metric width at the temple)
  const kCorner = hl.temple === 'square' ? 0.0015 : 0.15 * f.rT;
  // Temporal hairline (WP1 addition to CHR §4.4): the frontal line ends at the temple corner φK = φC − 0.35 rad and
  // descends to the over-the-ear line (ET.y + earGap) at the sideburn front φC. Square temples drop almost
  // vertically right after the corner (edge-up), round temples follow a smoothstep. Without it the frontal line
  // ran back at Gy + 5–6 cm to φC, leaving the whole temple bare (a flat cap in 3/4 and profile views).
  const phiK = phiC - 0.35, yK = yM(phiK), yTemple = ETy + earGap;
  const templeW = (t) => (hl.temple === 'square' ? Math.min(1, smooth(0, 0.18, t) * 0.85 + t * 0.15) : smooth(0, 1, t));
  const yFront = (phi) => (phi <= phiK ? yM(phi) : yK + (yTemple - yK) * templeW(Math.min(1, (phi - phiK) / (phiC - phiK))));
  const region = (v) => {
    const phi = f.phi(v.x, v.z), r = f.r(v.x, v.z);
    const fTop = v.y - yFront(phi);
    const fSb = Math.min((phi - phiC) * r, v.y - ySB);
    const fBack = Math.min((phi - (f.phiT - 0.02)) * r, v.y - yBack(phi));
    // the sideburn → over-the-ear step is rounded (5 mm) so the line wraps the ear instead of a square notch
    const fU = smax(smax(fTop, fSb, kCorner), fBack, 0.005);
    const fW = (v.w('head', 'neck_01') - 0.5) * 0.05;
    // ear vertices are excluded (cut halfway along edges into the ear); ±1 cm so insets up to 1 cm stay valid
    const fEar = 0.01 * (1 - 2 * v.ear);
    return Math.min(fU, fW, fEar);
  };
  const taper = hair.hairline.nape === 'taper';
  const densityAt = (v, base) => (taper ? base * mix(0.45, 1, smooth(napeY, ELy, v.y)) : base);
  return {
    region, densityAt, yM, yFront, ySB, napeY, phiC, phiK,
    /** outer-layer offsetScale: sides taper + optional fringe overhang at the front */
    outerScale(v, layer) {
      let s = mix(layer.sidesScale ?? 1, 1, smooth(ETy + 0.02, ETy + 0.05, v.y));
      if (layer.fringe) {
        const phi = f.phi(v.x, v.z);
        const wFront = (1 - smooth(layer.fringe.depthCm / 100 * 0.66, layer.fringe.depthCm / 100 * 1.33, v.y - yFront(phi))) * (1 - smooth(phiK - 0.15, phiK, phi));
        s *= mix(1, layer.fringe.scale, wFront);
      }
      return s;
    },
  };
}

/** Jordan's bald look: faint horseshoe of the old hairline (groom.R only) + scalp gloss mask. */
export function baldFields(f, hair) {
  const { L } = f;
  const hs = hair.horseshoe;
  return {
    horseshoe(v) {
      const phi = f.phi(v.x, v.z);
      const fIn = Math.min((phi - hs.phiMin) * f.r(v.x, v.z), v.y - L.EL_l[1], landmarkY(hs.top, L) - v.y, (v.w('head', 'neck_01') - 0.5) * 0.05, 0.01 * (1 - 2 * v.ear));
      return hs.density * smooth(0, (hs.fadeMm || 4) / 1000, fIn);
    },
    gloss(v) {
      const y0 = f.Gy + hair.gloss.aboveGyM;
      return smooth(y0 - hair.gloss.fadeCm / 100, y0, v.y) * clamp01((v.w('head') - 0.3) / 0.4) * (1 - v.ear);
    },
  };
}

// ------------------------------------------------------------------------------------------------ beard ----
/**
 * Beard components and zones (CHR §5.1–§5.2). Returns region functions per component, the shell region (union
 * of shell components), per-vertex density, offsetScale zones and the skin mask value.
 */
export function beardFields(f, beard) {
  const { L } = f;
  const { yU, yL } = lipCurves(f);
  const C = beard.components || {};
  const CHx = f.CHx, CH = L.CH_l, SN = L.SN, ME = L.ME, PG = L.PG, LI = L.LI, SM = L.SM, ST = L.ST;
  const frontZ = SN[2] - 0.03;
  // lips dilated by 1.0 mm (inside > 0): excluded from every beard component
  const lips = (v) => Math.min(v.y - (yL(v.x) - 0.001), (yU(v.x) + 0.001) - v.y, CHx + 0.001 - Math.abs(v.x));
  const comps = {};

  if (C.M) {
    const h = C.M.heightMm != null ? C.M.heightMm / 1000 : null, gap = C.M.gapMm / 1000, drop = (C.M.dropMm || 0) / 1000;
    comps.M = (v) => {
      const ax = Math.abs(v.x);
      const top = h == null ? SN[1] - gap : Math.min(SN[1] - gap, yU(v.x) + h);
      let fb = Math.min(CHx + 0.003 - ax, v.y - (yU(v.x) + 0.0008), top - v.y);
      if (drop > 0) {
        const cx = CHx + 0.002, cy = CH[1] - drop / 2, rx = 0.0025, ry = drop / 2;
        fb = Math.max(fb, (1 - Math.hypot((ax - cx) / rx, (v.y - cy) / ry)) * Math.min(rx, ry));
      }
      return Math.min(fb, v.z - frontZ, -lips(v));
    };
  }
  if (C.Gt) {
    const w = C.Gt.wCm / 100, hgt = C.Gt.hCm / 100, soulW = C.Gt.soulWCm / 100;
    const cy = (LI[1] + ME[1]) / 2 + 0.002;
    comps.Gt = (v) => {
      const fe = (1 - Math.hypot(v.x / (w / 2), (v.y - cy) / (hgt / 2))) * Math.min(w, hgt) / 2;
      const fs = Math.min(soulW / 2 - Math.abs(v.x), v.y - (SM[1] - 0.002), (LI[1] - 0.0008) - v.y);
      return Math.min(Math.max(fe, fs), (v.nz - 0.2) * 0.02, -lips(v));
    };
  }
  if (C.Lk) {
    const gw = C.Gt ? C.Gt.wCm / 100 : 0.03;
    const A = [CHx + 0.003, CH[1] - 0.004], B = [gw / 2 - 0.002, PG[1] + 0.004];
    const half = (C.Lk.widthMm || 4) / 2000;
    comps.Lk = (v) => {
      const px = Math.abs(v.x) - A[0], py = v.y - A[1], bx = B[0] - A[0], by = B[1] - A[1];
      const t = clamp01((px * bx + py * by) / (bx * bx + by * by));
      return Math.min(half - Math.hypot(px - bx * t, py - by * t), v.nz * 0.02, -lips(v));
    };
  }
  let F = null;
  if (C.F) {
    const yA = landmarkY(C.F.yA, L), yB = landmarkY(C.F.yB, L);
    const phiA = f.phiT - C.F.dA / f.rT, phiB = f.phiCH + C.F.dB / f.rCH;
    const dN = C.F.dN, gap = (C.F.moustacheGapMm ?? 0.5) / 1000;
    const yCheek = (phi) => (phi <= phiB ? yB : phi >= phiA ? yA : mix(yB, yA, (phi - phiB) / (phiA - phiB)));
    const yN = (phi) => ME[1] - dN + (L.EL_l[1] - 0.015 - (ME[1] - dN)) * smooth(0.35, 1.45, phi);
    F = { yA, yB, phiA, phiB, yCheek, yN };
    comps.F = (v) => {
      const phi = f.phi(v.x, v.z), r = f.r(v.x, v.z);
      let fc = Math.min(yCheek(phi) - v.y, v.y - yN(phi), (f.phiT - 0.02 - phi) * r, v.z - (f.headCZ - 0.02), (v.w('head', 'neck_01') - 0.5) * 0.05);
      if (C.F.moustache) {
        const fm = Math.min(CHx + 0.006 - Math.abs(v.x), v.y - (yU(v.x) + 0.001), (SN[1] - gap) - v.y, v.z - frontZ);
        fc = smax(fc, fm, 0.004);          // rounded junction of the moustache and the cheek beard
      }
      return Math.min(fc, -lips(v), 0.01 * (1 - 2 * v.ear));
    };
  }

  // component densities
  const dens = {
    M: (v) => {
      const m = C.M; if (!m) return 0;
      const ax = Math.abs(v.x);
      let d = m.density;
      if (m.centreScale != null) d *= mix(m.centreScale, 1, smooth(m.centreMm / 1000 - 0.001, m.centreMm / 1000 + 0.001, ax));
      if (m.outerScale != null) d *= mix(1, m.outerScale, smooth(m.outerMm / 1000 - 0.001, m.outerMm / 1000 + 0.001, ax));
      return d;
    },
    Gt: () => (C.Gt ? C.Gt.density : 0),
    Lk: () => (C.Lk ? C.Lk.density : 0),
    F: (v) => {
      const z = C.F && C.F.zones;
      if (!z) return 0;
      if (z.all != null) return z.all;
      // jaw band / chin / cheeks blended over 1 cm (Giannis)
      const wChin = chinWeight(v), wJaw = 1 - smooth(0.010, 0.020, jawLineDist(v));
      return mix(mix(z.cheeks, z.jaw, wJaw), z.chin, wChin);
    },
  };
  // chin zone (|x| < CHx, y < ST.y) blended over 1 cm
  const chinWeight = (v) => (1 - smooth(CHx - 0.005, CHx + 0.005, Math.abs(v.x))) * (1 - smooth(ST[1] - 0.005, ST[1] + 0.005, v.y));
  // distance to the jaw line GO → ME (both sides) in 3D
  const GOl = L.GO_l, GOr = L.GO_r;
  const segDist = (p, a, b) => {
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
    const t = clamp01(((p[0] - a[0]) * bx + (p[1] - a[1]) * by + (p[2] - a[2]) * bz) / (bx * bx + by * by + bz * bz));
    return Math.hypot(p[0] - a[0] - bx * t, p[1] - a[1] - by * t, p[2] - a[2] - bz * t);
  };
  // mandible border GO → ME as a quadratic Bézier bowed out to the side (control point at 85 % of the gonion's
  // |x|, mid height, 1 cm behind the chin): the straight chord runs ~2 cm inside the jaw halfway along
  const jawPoly = [];
  for (const G of [GOl, GOr]) {
    const C = [G[0] * 0.85, (G[1] + ME[1]) / 2, ME[2] - 0.01];
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
      pts.push([0, 1, 2].map((k) => a * G[k] + b * C[k] + c * ME[k]));
    }
    jawPoly.push(pts);
  }
  const jawLineDist = (v) => {
    const p = [v.x, v.y, v.z];
    let d = Infinity;
    for (const pts of jawPoly) for (let i = 0; i < 12; i++) d = Math.min(d, segDist(p, pts[i], pts[i + 1]));
    return d;
  };

  const shellComps = Object.keys(comps);
  /** union of the shell components (signed) */
  const region = (v) => { let m = -1; for (const k of shellComps) m = Math.max(m, comps[k](v)); return m; };
  /** density of the dominant component at v (soft at component borders) */
  const density = (v) => {
    let d = 0;
    for (const k of shellComps) d = Math.max(d, dens[k](v) * smooth(-0.0005, 0.0005, comps[k](v)));
    return d;
  };
  /** offsetScale: chin vs cheeks (cheekMm / chinMm), blended over 1 cm */
  const offsetScale = (v, layer) => mix(layer.cheeksMm / layer.chinMm, 1, chinWeight(v));
  /** jaw shadow J (skin only) and Yao's stubble zones */
  const J = C.J;
  const jawShadow = (v) => {
    if (!J) return 0;
    let s = 0;
    if (J.jaw) {
      const d = jawLineDist(v);
      const band = 1 - smooth(J.bandM * 0.66, J.bandM, d);
      // under the chin down to ME.y − 0.02, soft on every side (no hard cut where the band ends)
      const under = smooth(ME[1] - 0.02, ME[1] - 0.012, v.y) * (1 - smooth(ME[1], ME[1] + 0.006, v.y))
        * (1 - smooth(Math.abs(GOl[0]) - 0.012, Math.abs(GOl[0]), Math.abs(v.x))) * smooth(-0.05, -0.3, v.ny);
      s = Math.max(s, Math.max(band, under) * J.jaw * clamp01((v.w('head', 'neck_01') - 0.3) / 0.4));
    }
    if (J.upperLip) {
      // soft ellipse over the upper lip between the vermilion and the subnasale (a stubble shadow, no hard box)
      const y0 = yU(0) + 0.001, cy = (y0 + SN[1]) / 2, ry = (SN[1] - y0) / 2 + 0.002, rx = CHx + 0.004;
      const e = 1 - smooth(0.55, 1, Math.hypot(v.x / rx, (v.y - cy) / ry));
      s = Math.max(s, J.upperLip * e * smooth(0, 0.002, Math.min(v.z - frontZ, -lips(v))));
    }
    if (J.chin) {
      const cy = (LI[1] + ME[1]) / 2;
      const e = 1 - smooth(0.5, 1, Math.hypot(v.x / 0.024, (v.y - cy) / 0.018));
      s = Math.max(s, J.chin * e * smooth(0, 0.003, Math.min((v.nz + 0.2) * 0.02, -lips(v))));
    }
    return s;
  };
  return { comps, region, density, offsetScale, jawShadow, chinWeight, F, lips, shellComps };
}

// ------------------------------------------------------------------------------------------------ brows ----
/**
 * Eyebrow field (CHR §6) for both sides. Returns region (signed), density, fade and the brow-local UV.
 */
export function browFields(f, b) {
  const L = f.L;
  const ECy = f.EC[1], ECx = f.ECx, ECz = f.EC[2];
  const x0 = ECx - 0.013, x1 = ECx + 0.025, len = x1 - x0;
  const jordanK = b.archOuter === true;
  const k = (t) => (jordanK ? smooth(0.2, 0.7, t) : 1);
  const yc = (t) => ECy + b.gap + b.arch * 4 * t * (1 - t) * k(t) + b.tail * smooth(0.65, 1, t);
  const h = (t) => b.hIn * (1 - t) + b.hOut * t;
  const tOf = (x) => (Math.abs(x) - x0) / len;
  const region = (v) => {
    if (v.z < ECz - 0.01) return -0.01;
    const t = tOf(v.x);
    let fb;
    if (t < 0) fb = b.hIn - Math.hypot(Math.abs(v.x) - x0, v.y - yc(0));           // rounded inner cap
    else if (t > 1) fb = Math.min(h(1) - Math.abs(v.y - yc(1)), (1 - t) * len);      // tail end
    else fb = Math.min(h(t) - Math.abs(v.y - yc(t)), (1 - t) * len);
    return Math.min(fb, (v.w('head') - 0.5) * 0.05, v.z - (ECz - 0.01));
  };
  const density = (v) => { const t = clamp01(tOf(v.x)); return b.density * (0.75 + 0.25 * smooth(0, 0.2, t)) * (1 - 0.5 * smooth(0.8, 1, t)); };
  const fade = (v) => {
    const t = tOf(v.x), tc = clamp01(t);
    const edge = h(tc) - Math.abs(v.y - yc(tc));
    const ends = t < 0 ? b.hIn - Math.hypot(Math.abs(v.x) - x0, v.y - yc(0)) : Math.min((1 - t) * len, t * len + b.hIn);
    return smooth(0, 0.0005, edge) * smooth(0, 0.0008, ends);
  };
  const uv = (x, y) => {
    const t = clamp01(tOf(x));
    const s = Math.max(-1, Math.min(1, (y - yc(t)) / h(t)));
    return [(s + 1) / 2 * 0.2, t * (len / 0.05)];
  };
  return { region, density, fade, uv, yc, h, x0, x1, len, L };
}
