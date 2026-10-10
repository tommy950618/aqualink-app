/**
 * masks.mjs — the 15 mask textures of SPEC-v2 §3.1 / §3.5.3 (CHR §2.3–§2.4), evaluated as scalar fields of 3D
 * position + normal per texel through uvraster.mjs and written as RGB PNGs (png.mjs).
 *
 *   legends.skin0.png  1024²  R lips, G cavity, B highlight         (shared, base mesh)
 *   legends.skin1.png   512²  R redness, G body AO, B mottle        (shared, base mesh)
 *   legends.skin2.png   512²  R palms, G nails, B 0                  (shared, base mesh)
 *   legends.<id>.groom.png 1024²  R scalp-hair density, G beard density (incl. jaw shadow), B brow density
 *   legends.<id>.extra.png  512²  R tattoo, G scalp gloss, B sweat zones
 * Shared masks use base.obj (metres); per-player masks use the player's morphed mesh and face frame, with the same
 * groom fields as the shells (groom.mjs). Dilation 8 px at 1024², 4 px at 512²; 2 × 2 supersampling at 1024².
 */
import { sampleMap, evaluate, dilate, toRgbRows } from './uvraster.mjs';
import { encodePngRgb } from './png.mjs';
import { hairFields, beardFields, browFields, baldFields, lipCurves, earInfo, smooth } from './groom.mjs';

export const MASK_BUDGET = Object.freeze({ skin0: 160 * 1024, skin1: 120 * 1024, skin2: 25 * 1024, groom: 70 * 1024, extra: 30 * 1024 });
export const MASK_SPEC = Object.freeze({
  skin0: { size: 1024, ss: 2, channels: ['lips', 'cavity', 'highlight'] },
  skin1: { size: 512, ss: 1, channels: ['redness', 'ao', 'mottle'] },
  skin2: { size: 512, ss: 1, channels: ['palms', 'nails', 'reserved'] },
  groom: { size: 1024, ss: 2, channels: ['hair', 'beard', 'brow'] },
  extra: { size: 512, ss: 1, channels: ['tattoo', 'gloss', 'sweat'] },
});

/** Per-vertex attribute channels interpolated over the texels (bone weights by name, `handfam_*`, `f03_*`, `ear`). */
export const ATTR_NAMES = ['head', 'neck_01', 'spine_03', 'spine_02', 'spine_01', 'pelvis', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r',
  'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'handfam_l', 'handfam_r', 'f03_l', 'f03_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r',
  'foot_l', 'foot_r', 'ball_l', 'ball_r', 'ear'];
const AI = Object.fromEntries(ATTR_NAMES.map((n, i) => [n, i]));

// ---------------------------------------------------------------------------------------- value noise ----
/** Deterministic 3D value noise in [0, 1] (integer lattice hash, smoothstep trilinear), `seed` selects the field. */
export function valueNoise3(seed) {
  const h = (x, y, z) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1103515245);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967295;
  };
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fx = x - xi, fy = y - yi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
  };
}

/** Builds the per-render-vertex attribute array (ATTR_NAMES order) from the kept skin weights. */
export function vertexAttrs({ renderToKept, skinIdx, skinW, boneOrder, earKept }) {
  const nR = renderToKept.length, n = ATTR_NAMES.length;
  const out = new Float32Array(nR * n);
  const bi = new Map(boneOrder.map((b, i) => [b, i]));
  const fam = { l: new Set(), r: new Set() }, f03 = { l: new Set(), r: new Set() };
  for (const b of boneOrder) {
    const m = /^(hand|thumb|index|middle|ring|pinky)(_0\d)?_([lr])$/.exec(b);
    if (m) fam[m[3]].add(bi.get(b));
    const m3 = /_03_([lr])$/.exec(b);
    if (m3) f03[m3[1]].add(bi.get(b));
  }
  for (let r = 0; r < nR; r++) {
    const k = renderToKept[r];
    for (let j = 0; j < 4; j++) {
      const b = skinIdx[k * 4 + j], w = skinW[k * 4 + j];
      if (!w) continue;
      const name = boneOrder[b];
      if (AI[name] != null) out[r * n + AI[name]] += w;
      for (const s of ['l', 'r']) {
        if (fam[s].has(b)) out[r * n + AI[`handfam_${s}`]] += w;
        if (f03[s].has(b)) out[r * n + AI[`f03_${s}`]] = Math.max(out[r * n + AI[`f03_${s}`]], w);
      }
    }
    if (earKept.has(k)) out[r * n + AI.ear] = 1;
  }
  return out;
}

/** Wraps a sample (p, n, attrs) as the `v` object the groom fields expect (reused, no allocation per texel). */
function sampleView() {
  const v = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, ear: 0, a: null };
  v.w = (...names) => { let s = 0; for (const nm of names) s += v.a[AI[nm]]; return s; };
  v.set = (p, n, a) => { v.x = p[0]; v.y = p[1]; v.z = p[2]; v.nx = n[0]; v.ny = n[1]; v.nz = n[2]; v.a = a; v.ear = a[AI.ear]; return v; };
  return v;
}

const gauss = (d2, s) => Math.exp(-d2 / (2 * s * s));
const d3 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
/** soft ellipse membership in (x, y): 1 inside, falls to 0 over the outer `soft` fraction of the radius */
const ell = (dx, dy, rx, ry, soft = 0.3) => 1 - smooth(1 - soft, 1, Math.hypot(dx / rx, dy / ry));
const band = (d, half, soft) => 1 - smooth(half, half + soft, Math.abs(d));
/** quadratic through 3 points (x, y) */
const quad3 = (p0, p1, p2) => (x) => p0[1] * ((x - p1[0]) * (x - p2[0])) / ((p0[0] - p1[0]) * (p0[0] - p2[0]))
  + p1[1] * ((x - p0[0]) * (x - p2[0])) / ((p1[0] - p0[0]) * (p1[0] - p2[0])) + p2[1] * ((x - p0[0]) * (x - p1[0])) / ((p2[0] - p0[0]) * (p2[0] - p1[0]));

// ------------------------------------------------------------------------------------- shared fields ----
/**
 * Shared skin fields on base.obj.
 * @param {object} f face frame of the base mesh
 * @param {object} j base joints {bone: {head, tail}}
 * @param {object} extra {earMaxX, earZMin, navel:[x,y,z], neckFrontZ}
 */
export function sharedFields(f, j, extra) {
  const { L } = f;
  const { yU, yL, yS } = lipCurves(f);
  const CHx = f.CHx, EC = L.EC_l;
  const eyeU = quad3([L.EN_l[0], L.EN_l[1]], [L.PS_l[0], L.PS_l[1]], [L.EX_l[0], L.EX_l[1]]);
  const eyeL = quad3([L.EN_l[0], L.EN_l[1]], [L.PI_l[0], L.PI_l[1]], [L.EX_l[0], L.EX_l[1]]);
  const exMin = Math.min(L.EN_l[0], L.EX_l[0]), exMax = Math.max(L.EN_l[0], L.EX_l[0]);
  const ALx = Math.abs(L.AL_l[0]), ALy = L.AL_l[1];
  // nasolabial fold: quadratic from the outer ala to (CHx + 0.006, CH.y − 0.004), bowed 0.003 outward
  const nl0 = [ALx + 0.002, ALy - 0.002], nl1 = [CHx + 0.006, L.CH_l[1] - 0.004];
  const nlCtl = [(nl0[0] + nl1[0]) / 2 + 0.003, (nl0[1] + nl1[1]) / 2];
  // the quadratic Bézier as a 16-segment polyline; distance to the nearest segment (not to its sample points)
  const nlPts = Array.from({ length: 17 }, (_, i) => {
    const t = i / 16, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
    return [a * nl0[0] + b * nlCtl[0] + c * nl1[0], a * nl0[1] + b * nlCtl[1] + c * nl1[1]];
  });
  const nlDist = (x, y) => {
    let best = Infinity;
    for (let i = 0; i < 16; i++) {
      const [ax0, ay0] = nlPts[i], [bx0, by0] = nlPts[i + 1];
      const dx = bx0 - ax0, dy = by0 - ay0;
      const t = Math.max(0, Math.min(1, ((x - ax0) * dx + (y - ay0) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(x - ax0 - dx * t, y - ay0 - dy * t));
    }
    return best;
  };
  const mottleN = valueNoise3(1337);
  const palmN = {};
  for (const s of ['l', 'r']) {
    // bind palm normal Z_h of the hand frame (ANIM §1.4): Y = W − M, X = knuckle line toward thumb (l) / pinky (r)
    const W = j[`hand_${s}`].head, M = j[`middle_01_${s}`].head, I = j[`index_01_${s}`].head, K = j[`pinky_01_${s}`].head;
    let Y = [W[0] - M[0], W[1] - M[1], W[2] - M[2]]; const yl = Math.hypot(...Y); Y = Y.map((c) => c / yl);
    const knk = s === 'l' ? [I[0] - K[0], I[1] - K[1], I[2] - K[2]] : [K[0] - I[0], K[1] - I[1], K[2] - I[2]];
    const dk = knk[0] * Y[0] + knk[1] * Y[1] + knk[2] * Y[2];
    let X = [knk[0] - dk * Y[0], knk[1] - dk * Y[1], knk[2] - dk * Y[2]]; const xl = Math.hypot(...X); X = X.map((c) => c / xl);
    palmN[s] = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  }
  const fingerJoints = Object.entries(j).filter(([b]) => /^(index|middle|ring|pinky)_0[12]_[lr]$/.test(b)).map(([b, v]) => [b.slice(-1), v.head]);
  const tips = Object.entries(j).filter(([b]) => /_03_[lr]$/.test(b)).map(([b, v]) => [b.slice(-1), v.tail]);
  const webs = [];
  for (const s of ['l', 'r']) {
    const fs = ['index', 'middle', 'ring', 'pinky'].map((n) => j[`${n}_01_${s}`].head);
    for (let i = 0; i < 3; i++) webs.push(fs[i].map((c, k) => (c + fs[i + 1][k]) / 2));
  }
  const nostrilY = ALy - 0.0055;
  const v = sampleView();

  function face(p, n, out) {
    const x = p[0], y = p[1], z = p[2], ax = Math.abs(x);
    const pl = [ax, y, z];                     // mirrored onto the left side
    // ---- lips (skin0.R)
    if (z > L.SM[2] - 0.004) {
      out[0] = smooth(-0.0007, 0.0007, yU(x) - y) * smooth(-0.0007, 0.0007, y - yL(x)) * smooth(-0.0005, 0.0010, CHx + 0.0005 - ax);
    }
    // ---- cavity (skin0.G)
    let cav = 0;
    if (ax <= CHx + 0.002 && z > L.SM[2] - 0.004) cav = Math.max(cav, 0.9 * (1 - smooth(0, 0.0012, Math.abs(y - yS(x)))));
    cav = Math.max(cav, 0.7 * gauss(d3(pl, L.CH_l), 0.0025));
    if (n[1] < -0.2 && z > L.SN[2] - 0.02) cav = Math.max(cav, 0.9 * ell(ax - 0.0085, y - nostrilY, 0.0045, 0.0022, 0.25));
    // alar crease: 0.8 mm band as a Gaussian profile (a sub-texel hard band aliases into dots at 0.86 mm/px)
    // (lateral half of the circle only: the medial arc would cross the nose tip)
    if (n[2] > 0 && z > L.AL_l[2] - 0.015) cav = Math.max(cav, 0.45 * gauss((Math.hypot(ax - (ALx - 0.004), y - (ALy - 0.001)) - 0.006) ** 2, 0.0006) * smooth(ALx - 0.007, ALx - 0.003, ax));
    if (z > EC[2] && ax > exMin - 0.006 && ax < exMax + 0.008) {
      const xs = EC[0] + (ax - EC[0]) / 1.15;
      if (xs > exMin && xs < exMax) cav = Math.max(cav, 0.5 * (1 - smooth(0.0002, 0.0015, Math.abs(y - (eyeU(xs) + 0.0040)))));
      if (ax > exMin && ax < exMax) {
        cav = Math.max(cav, 0.8 * gauss((y - eyeU(ax)) ** 2, 0.00045));
        cav = Math.max(cav, 0.4 * gauss((y - eyeL(ax)) ** 2, 0.0004));
      }
    }
    cav = Math.max(cav, 0.6 * gauss(d3(pl, L.EN_l), 0.002));
    if (n[2] > 0.2) cav = Math.max(cav, 0.25 * ell(ax - EC[0], y - EC[1], 0.026, 0.018, 0.3));
    // nasolabial fold: soft 1.2 mm band (no hard edge), fading out at both ends of the curve
    if (n[2] > -0.2 && z > L.CH_l[2] - 0.03) cav = Math.max(cav, 0.35 * gauss(nlDist(ax, y) ** 2, 0.0008) * smooth(nl1[1] - 0.004, nl1[1] + 0.004, y) * (1 - smooth(nl0[1] - 0.003, nl0[1] + 0.001, y)));
    if (v.ear > 0.5) {
      if (ax < extra.earMaxX(y) - 0.004 && n[0] * Math.sign(x) > 0.2) cav = Math.max(cav, 0.5 * v.ear);
    } else if (extra.nearEarBack(pl)) cav = Math.max(cav, 0.4);
    // mouth cavity lining: inside the lips (behind the vermilion, not facing forward) around the lip seam
    if (ax < CHx && Math.abs(y - yS(x)) < 0.006 && z < 0.152 && z > 0.10 && n[2] < 0.5) cav = Math.max(cav, 0.8 * (1 - smooth(0.2, 0.5, n[2])));
    out[1] = cav;
    // ---- highlight (skin0.B)
    let hl = 0;
    if (n[2] > 0.3) {
      hl = Math.max(hl, 0.7 * ell(x, y - (f.Gy + 0.022), 0.022, 0.016, 0.5));
      if (y < L.N[1] && y > L.PRN[1]) hl = Math.max(hl, 0.6 * band(x, 0.002, 0.0015));
      hl = Math.max(hl, 0.6 * ell(ax - 0.040, y - (EC[1] - 0.016), 0.012, 0.007, 0.5));
      hl = Math.max(hl, 0.6 * ell(x, y - (L.ST[1] - 0.006), 0.007, 0.002, 0.5));
      if (ax < CHx) hl = Math.max(hl, 0.35 * band(y - (yU(x) + 0.0008), 0.0003, 0.0003));
    }
    hl = Math.max(hl, 1.0 * gauss(d3(p, L.PRN), 0.004));
    hl = Math.max(hl, 0.5 * gauss(d3(p, L.PG), 0.006));
    out[2] = hl;
  }

  return {
    /** skin0: lips, cavity, highlight (face only) */
    skin0(p, n, a, out) {
      v.set(p, n, a);
      if (v.w('head') + v.w('neck_01') < 0.05) return;
      face(p, n, out);
    },
    /** skin1: redness, AO, mottle */
    skin1(p, n, a, out) {
      v.set(p, n, a);
      const x = p[0], y = p[1], z = p[2], ax = Math.abs(x), pl = [ax, y, z];
      const head = v.w('head');
      let red = 0, ao = 0;
      if (head > 0.05) {
        if (v.ear > 0) red = Math.max(red, 0.8 * v.ear);
        red = Math.max(red, 0.6 * Math.max(gauss(d3(p, L.PRN), 0.012), gauss(d3(pl, L.AL_l), 0.012)));
        if (n[2] > 0.3) {
          red = Math.max(red, 0.35 * gauss((ax - 0.038) ** 2 + (y - (EC[1] - 0.025)) ** 2, 0.015));
          red = Math.max(red, 0.35 * ell(ax - EC[0], y - EC[1], 0.018, 0.010, 0.4));
          const dl = Math.max(y - (yU(x) + 0.001), (yL(x) - 0.001) - y, ax - CHx);
          if (dl > 0 && z > L.SM[2] - 0.01) red = Math.max(red, 0.3 * (1 - smooth(0.002, 0.003, dl)));
        }
        if (y < L.ME[1] && z > extra.neckFrontZ - 0.01) ao = Math.max(ao, 0.35 * smooth(L.ME[1], L.ME[1] - 0.03, y) * (1 - smooth(L.ME[1] - 0.04, L.ME[1] - 0.07, y)));
        if (n[1] < -0.2 && z > L.SN[2] - 0.02) ao = Math.max(ao, 0.4 * ell(ax - 0.0085, y - nostrilY, 0.0045, 0.0022, 0.25));
      }
      for (const s of ['l', 'r']) {
        const fam = v.w(`handfam_${s}`);
        if (fam > 0.05) {
          const pn = palmN[s];
          const dpn = n[0] * pn[0] + n[1] * pn[1] + n[2] * pn[2];
          for (const [sd, q] of fingerJoints) if (sd === s && dpn < 0) red = Math.max(red, 0.6 * (1 - smooth(0.004, 0.006, Math.sqrt(d3(p, q)))));
          for (const [sd, q] of tips) if (sd === s) red = Math.max(red, 0.5 * (1 - smooth(0.008, 0.012, Math.sqrt(d3(p, q)))));
          if (dpn > 0) red = Math.max(red, 0.2 * fam * smooth(0, 0.5, dpn));
        }
        const ua = j[`upperarm_${s}`].head;
        if (y < ua[1] && Math.sqrt(d3(p, ua)) < 0.05 + 0.03) ao = Math.max(ao, 0.6 * (1 - smooth(0.05, 0.08, Math.sqrt(d3(p, ua)))) * smooth(ua[1], ua[1] - 0.03, y));
        const el = j[`lowerarm_${s}`].head;
        if (n[2] < 0 && Math.sqrt(d3(p, el)) < 0.03) red = Math.max(red, 0.3 * (1 - smooth(0.02, 0.03, Math.sqrt(d3(p, el)))));
        const kn = j[`calf_${s}`].head;
        const dk = Math.sqrt(d3(p, kn));
        if (dk < 0.04) {
          if (n[2] > 0.2) red = Math.max(red, 0.3 * (1 - smooth(0.02, 0.03, dk)));
          if (n[2] < -0.3) ao = Math.max(ao, 0.3 * (1 - smooth(0.03, 0.04, dk)));
        }
        if (v.w(`ball_${s}`) > 0.3 && Math.abs(n[0]) > 0.5 && y < extra.floorY + 0.02) ao = Math.max(ao, 0.5 * v.w(`ball_${s}`));
      }
      for (const q of webs) ao = Math.max(ao, 0.5 * (1 - smooth(0.005, 0.008, Math.sqrt(d3(p, q)))));
      ao = Math.max(ao, 0.5 * gauss(d3(p, extra.navel), 0.006));
      if (v.w('neck_01') > 0.3 && n[2] > 0.3) {
        for (const yc of extra.neckCreases) ao = Math.max(ao, 0.2 * band(y - yc, 0.0008, 0.0012));
      }
      const mot = 0.6 * mottleN(x / 0.040, y / 0.040, z / 0.040) + 0.4 * mottleN(x / 0.012 + 101.3, y / 0.012 + 57.1, z / 0.012 + 13.7);
      // 32 levels: the composite uses ±6 % of mottle, so 1/32 steps are 0.4 % colour steps (invisible) and the
      // dropped low bits of this full-coverage noise keep the PNG inside its 120 KB budget
      out[0] = red; out[1] = ao; out[2] = Math.round(mot * 31) / 31;
    },
    /** skin2: palms, nails */
    skin2(p, n, a, out) {
      v.set(p, n, a);
      for (const s of ['l', 'r']) {
        const fam = v.w(`handfam_${s}`);
        if (fam < 0.05) continue;
        const pn = palmN[s];
        const dpn = n[0] * pn[0] + n[1] * pn[1] + n[2] * pn[2];
        if (dpn > 0) out[0] = Math.max(out[0], smooth(0, 0.5, dpn) * Math.min(1, fam));
        if (v.w(`f03_${s}`) > 0.6 && -dpn > 0.5) {
          for (const [sd, q] of tips) if (sd === s) out[1] = Math.max(out[1], 1 - smooth(0.010, 0.012, Math.sqrt(d3(p, q))));
        }
      }
    },
    palmN,
  };
}

// ----------------------------------------------------------------------------------- per-player fields ----
/**
 * Per-player groom + extra fields on the player's mesh.
 * @param {object} f player face frame, ap appearance, j player joints, earPts ear vertex positions, seed player index
 */
export function playerFields(f, ap, j, earPts, seed, tattooQuantiles) {
  const ear = earInfo(f, earPts);
  const hair = ap.hair || {};
  const hf = hair.layers && hair.layers.length ? hairFields(f, hair, ap.beard, ear) : null;
  const bald = hair.horseshoe ? baldFields(f, hair) : null;
  const bf = ap.beard ? beardFields(f, ap.beard) : null;
  const br = ap.eyebrows ? browFields(f, ap.eyebrows) : null;
  const innerHair = hf ? hair.layers[0] : null;
  const beardFade = ap.beard && ap.beard.layers && ap.beard.layers[0] ? ap.beard.layers[0].fadeMm / 1000 : 0.0015;
  const v = sampleView();
  const { yU } = lipCurves(f);
  const tn = valueNoise3(4242 + seed);
  const tat = ap.tattoos || [];
  const tatNoise = (p) => 0.6 * tn(p[0] / 0.04, p[1] / 0.04, p[2] / 0.04) + 0.4 * tn(p[0] / 0.02 + 31.7, p[1] / 0.02 + 7.3, p[2] / 0.02 + 19.1);
  const letters = valueNoise3(777 + seed);

  const groom = (p, n, a, out) => {
    v.set(p, n, a);
    if (v.w('head', 'neck_01') < 0.05) return;
    if (hf) out[0] = hf.densityAt(v, innerHair.density) * smooth(0, Math.max(0.0005, innerHair.fadeMm / 1000), hf.region(v));
    else if (bald) out[0] = bald.horseshoe(v);
    if (bf) {
      let g = bf.jawShadow(v);
      for (const k of bf.shellComps) {
        const fc = bf.comps[k](v);
        if (fc > -0.001) g = Math.max(g, bf.density(v) * smooth(0, beardFade, fc));
      }
      out[1] = g;
    }
    if (br) {
      const fr = br.region(v);
      if (fr > -0.001) out[2] = br.density(v) * smooth(0, 0.0005, fr) * br.fade(v);
    }
  };

  const extraF = (p, n, a, out) => {
    v.set(p, n, a);
    const x = p[0], y = p[1], z = p[2];
    // R tattoo
    let t = 0;
    for (const T of tat) {
      if (T.kind === 'armBlobs') {
        for (const s of ['l', 'r']) {
          const up = v.w(`upperarm_${s}`), lo = v.w(`lowerarm_${s}`);
          if (up + lo < 0.5 || v.w(`handfam_${s}`) > 0.2) continue;
          const nz = tatNoise(p);
          const q = up >= lo ? tattooQuantiles[`up_${s}`] : tattooQuantiles[`lo_${s}`];
          // threshold 0.45 after shifting the noise so the region's coverage matches (≈70 % upper, 35 % fore)
          t = Math.max(t, smooth(0.44, 0.46, 0.45 + (nz - q)) * smooth(0.5, 0.7, up + lo));
        }
      } else if (T.kind === 'backArch') {
        // 26 × 5 cm arched band of blackletter-like strokes at scapula height on the upper back
        const yc = j.scapulaY + T.dyM + 0.015 * (1 - (x / 0.13) ** 2);
        if (n[2] < -0.3 && Math.abs(x) < 0.13 && Math.abs(y - yc) < 0.025 && v.w('spine_03', 'spine_02', 'clavicle_l', 'clavicle_r') > 0.4) {
          const strokes = 0.5 + 0.5 * Math.cos(2 * Math.PI * x / 0.016);
          const val = 0.6 * letters(x / 0.008, y / 0.008, z / 0.008) + 0.4 * strokes;
          t = Math.max(t, smooth(0.52, 0.56, val) * (1 - smooth(0.11, 0.13, Math.abs(x))) * (1 - smooth(0.021, 0.025, Math.abs(y - yc))));
        }
      } else if (T.kind === 'dottedBracket') {
        // 10 × 3 cm: two bracket outlines of 2.5 mm dots (6 mm pitch) on the outer face of the left mid-forearm
        if (v.w('lowerarm_l') > 0.5 && x > 0) {
          const e = j.lowerarm_l.head, w = j.lowerarm_l.tail;
          const axv = [w[0] - e[0], w[1] - e[1], w[2] - e[2]], len = Math.hypot(...axv), u = axv.map((c) => c / len);
          const q = [x - e[0], y - e[1], z - e[2]];
          const s = q[0] * u[0] + q[1] * u[1] + q[2] * u[2];
          const rad = [q[0] - u[0] * s, q[1] - u[1] * s, q[2] - u[2] * s];
          const rl = Math.hypot(...rad) || 1;
          // outer face = lateral (+x) direction; arc coordinate across the band
          const lat = [1, 0, 0], ld = lat[0] * u[0];
          let lo2 = [lat[0] - ld * u[0], -ld * u[1], -ld * u[2]]; const ll = Math.hypot(...lo2); lo2 = lo2.map((c) => c / ll);
          const cosA = (rad[0] * lo2[0] + rad[1] * lo2[1] + rad[2] * lo2[2]) / rl;
          const sinA = (rad[0] * (u[1] * lo2[2] - u[2] * lo2[1]) + rad[1] * (u[2] * lo2[0] - u[0] * lo2[2]) + rad[2] * (u[0] * lo2[1] - u[1] * lo2[0])) / rl;
          const across = Math.atan2(sinA, cosA) * rl;
          const along = s - len * 0.5;
          if (Math.abs(along) < 0.055 && Math.abs(across) < 0.02) {
            const pitch = 0.006, r = 0.00125;
            let dmin = Infinity;
            for (const side of [-1, 1]) {
              // vertical bar of the bracket at across = ±0.015, along from −0.05 to 0.05, serifs inward at the ends
              const bx = side * 0.015;
              for (let k = -8; k <= 8; k++) dmin = Math.min(dmin, Math.hypot(along - k * pitch, across - bx));
              for (const endA of [-0.048, 0.048]) for (let k = 1; k <= 2; k++) dmin = Math.min(dmin, Math.hypot(along - endA, across - (bx - side * k * pitch)));
            }
            t = Math.max(t, 1 - smooth(r * 0.8, r * 1.2, dmin));
          }
        }
      }
    }
    out[0] = t;
    // G scalp gloss (Jordan: above Gy + 0.06, 2 cm fade; others: the scalp under the hair)
    if (bald) out[1] = bald.gloss(v);
    else if (hf) out[1] = smooth(0, 0.002, hf.region(v)) * (1 - v.ear);
    // B sweat zones: forehead + scalp (above G.y), upper lip, neck front, chest above the jersey neckline
    let sw = 0;
    const head = v.w('head');
    if (head > 0.3 && y > f.Gy && v.ear < 0.5) sw = Math.max(sw, smooth(f.Gy, f.Gy + 0.004, y));
    if (head > 0.3) {
      const fm = Math.min(f.CHx + 0.006 - Math.abs(x), y - (yU(x) + 0.001), (f.L.SN[1] - 0.001) - y, z - (f.L.SN[2] - 0.03));
      sw = Math.max(sw, smooth(0, 0.002, fm));
    }
    if (v.w('neck_01') > 0.3 && n[2] > 0.2 && y < f.L.ME[1]) sw = Math.max(sw, smooth(0.2, 0.5, n[2]));
    if (v.w('spine_03', 'clavicle_l', 'clavicle_r') > 0.3 && n[2] > 0.3 && y > j.neckHoleY && Math.abs(x) < 0.09) sw = Math.max(sw, smooth(j.neckHoleY, j.neckHoleY + 0.01, y));
    out[2] = sw;
  };
  return { groom, extra: extraF, tatNoise };
}

/** Encodes and budget-checks one mask; returns {file, bytes, size}. */
export function writeMask(fs, path, dir, file, kind, img, covered, size, iters) {
  dilate(img, covered, size, 3, iters);
  const png = encodePngRgb(size, size, toRgbRows(img, size, 3));
  fs.writeFileSync(path.join(dir, file), png);
  const budget = MASK_BUDGET[kind];
  if (png.length > budget * 1.2) throw new Error(`${file}: ${png.length} B exceeds the ${kind} budget ${budget} B by more than 20 %`);
  return { file, bytes: png.length, size, overBudget: png.length > budget };
}

export { sampleMap, evaluate };
