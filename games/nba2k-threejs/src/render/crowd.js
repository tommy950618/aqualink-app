/**
 * @module render/crowd
 * GPU-animated billboard crowd (SPEC-v2 §6.2, PR §2.8): one `InstancedMesh(PlaneGeometry(0.62, 1.05))` draw of
 * 700 / 1,600 / 2,600 people (low / medium / high) in the seats of the stand layout below; reactions come from four
 * uniforms only (`uTime, uExcite, uChant, uDim`): zero CPU per frame beyond the uniform writes.
 *
 * Seats (≈ 2,830; pure `seatLayout()`): courtside chairs (|x| 9.4, z −13.5 … −1.0, 0.6 m apart), the lower end
 * stand behind the hoop (10 rows from z −17.4, depth 0.85, rise 0.42; x ±11.55 where the sideline stands start at
 * |x| 11.6, ±16 behind them), lower sideline stands (8 rows from |x| 11.6, z −22 … +7), the upper end deck (10 rows
 * from y 6.5 behind the ribbon fascia at z −22.2, split around the jumbotron) and upper sideline decks (10 rows from
 * y 6.5, |x| ≥ 20.4). Spacing 0.55 m, x jitter ±0.06 m. Occupancy: low/medium draw from the 2,000 seats nearest the
 * court (35 % / 80 %), high from all seats (≈ 92 %); one seeded ordering makes every tier a prefix of the next, so a
 * runtime tier change only changes `mesh.count`.
 *
 * Atlas (pure `paintCrowdAtlas(size)`): 8 people × 4 poses (sit, sit-lean, stand arms up, stand clap) painted with
 * channel encoding R = shirt mask × shade, G = skin × shade, B = hair/trousers × shade, A = coverage (2 px dark
 * outline). The fragment shader recombines `R·shirt + G·skin + B·(cellV > 0.70 ? hair : trousers)`.
 */
import * as THREE from '../../vendor/three.module.js';
import { Rng } from '../math.js';
import { TIERS, trackTexture, tierOfRung } from './quality.js';

// ---- palettes (PR §2.8) ----
export const SHIRT_PALETTE = Object.freeze([0xf2f2f2, 0x1c1c1c, 0x3a4a6b, 0x6b3a3a, 0x4e6b3a, 0xc9b38a, 0x808a99, 0x2e5f8a, 0x8a2e5f, 0xd0d0c8, 0x5a5a5a, 0xb05a2a]);
export const SKIN_PALETTE = Object.freeze([0xf1c7a5, 0xe0ac83, 0xc68a5e, 0xa0673f, 0x74482b, 0x4a2e1d]);
export const HAIR_PALETTE = Object.freeze([0x1a1410, 0x3b2a1c, 0x6b4a2a, 0xb08850, 0x888888, 0x2a2a2a]);
export const TROUSERS = 0x222630;
export const SHARE_USER = 0.30;
export const SHARE_OPP = 0.12;

// ---- seat layout (shared with arena.js, which builds the stand geometry from the same numbers) ----
export const SEAT_SPACING = 0.55;
export const ROW_DEPTH = 0.85;
export const ROW_RISE = 0.42;
export const STANDS = Object.freeze({
  courtside: Object.freeze({ x: 9.4, z0: -13.5, z1: -1.0, step: 0.6, seatY: 0.45 }),
  endLower: Object.freeze({ rows: 10, zFront: -17.4, narrowRows: 6, narrowX: 11.55, wideX: 16 }),
  sideLower: Object.freeze({ rows: 8, xFront: 11.6, z0: -22, z1: 7 }),
  endUpper: Object.freeze({ rows: 10, zFront: -22.35, y0: 6.5, gapX: 5.8, x: 16, fasciaY: 5.6 }),
  sideUpper: Object.freeze({ rows: 10, xFront: 20.4, y0: 6.5, z0: -22, z1: 7, fasciaY: 5.6 }),
});
export const TIER_COUNTS = Object.freeze({ low: 700, medium: 1600, high: 2600 });
export const NEAR_POOL = 2000;
const SIDE_TURN = (20 * Math.PI) / 180;      // sideline sections face the court rotated 20° toward +z

/**
 * All seats (pure, deterministic; jitter from `rng`). Each seat: x, y (tread / chair height), z, yaw (billboard
 * facing; 0 = +z), courtside flag, section id. Returned as typed arrays.
 * @param {Rng} [rng]
 */
export function seatLayout(rng) {
  const r = rng || new Rng(0xC20D);
  const xs = [], ys = [], zs = [], yaws = [], cs = [], sec = [];
  const push = (x, y, z, yaw, court, s) => { xs.push(x); ys.push(y); zs.push(z); yaws.push(yaw); cs.push(court); sec.push(s); };
  const jit = () => r.range(-0.06, 0.06);
  const C = STANDS.courtside;
  for (let side = -1; side <= 1; side += 2) {
    for (let z = C.z0; z <= C.z1 + 1e-6; z += C.step) push(side * C.x, C.seatY, z, side < 0 ? Math.PI / 2 - SIDE_TURN : -Math.PI / 2 + SIDE_TURN, 1, 0);
  }
  const EL = STANDS.endLower;
  for (let i = 0; i < EL.rows; i++) {
    const half = i < EL.narrowRows ? EL.narrowX : EL.wideX;
    const z = EL.zFront - (i + 0.5) * ROW_DEPTH;
    const y = (i + 1) * ROW_RISE;
    for (let x = -half; x <= half + 1e-6; x += SEAT_SPACING) push(x + jit(), y, z, 0, 0, 1);
  }
  const SL = STANDS.sideLower;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < SL.rows; i++) {
      const x = side * (SL.xFront + (i + 0.5) * ROW_DEPTH);
      const y = (i + 1) * ROW_RISE;
      for (let z = SL.z0; z <= SL.z1 + 1e-6; z += SEAT_SPACING) push(x, y, z + jit(), side < 0 ? Math.PI / 2 - SIDE_TURN : -Math.PI / 2 + SIDE_TURN, 0, 2);
    }
  }
  const EU = STANDS.endUpper;
  for (let i = 0; i < EU.rows; i++) {
    const z = EU.zFront - (i + 0.5) * ROW_DEPTH;
    const y = EU.y0 + i * ROW_RISE;
    for (let side = -1; side <= 1; side += 2) {
      for (let a = EU.gapX; a <= EU.x + 1e-6; a += SEAT_SPACING) push(side * a + jit(), y, z, 0, 0, 3);
    }
  }
  const SU = STANDS.sideUpper;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < SU.rows; i++) {
      const x = side * (SU.xFront + (i + 0.5) * ROW_DEPTH);
      const y = SU.y0 + i * ROW_RISE;
      for (let z = SU.z0; z <= SU.z1 + 1e-6; z += SEAT_SPACING) push(x, y, z + jit(), side < 0 ? Math.PI / 2 - SIDE_TURN : -Math.PI / 2 + SIDE_TURN, 0, 4);
    }
  }
  return {
    count: xs.length,
    x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs),
    yaw: Float32Array.from(yaws), courtside: Uint8Array.from(cs), section: Uint8Array.from(sec),
  };
}

/**
 * Occupied seats of a tier (pure, deterministic by the rng seed). The returned arrays have `count` entries in a
 * fixed order whose prefixes are the lower tiers (700 ⊂ 1,600 ⊂ 2,600). Per instance: position, yaw, person column
 * 0–7, phase, threshold, courtside, shirt category (0 user team, 1 opponent, 2 palette) and palette indices.
 * @param {'low'|'medium'|'high'} tier
 * @param {Rng} rng  the crowd Rng (`Rng(seed ^ 0xC20D)`)
 */
export function seats(tier, rng) {
  const r = rng || new Rng(0xC20D);
  const L = seatLayout(r);
  const N = L.count;
  // Nearest pool by distance to the court centre (0, 1, −7).
  const dist = new Float32Array(N);
  const key = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dx = L.x[i], dy = L.y[i] - 1, dz = L.z[i] + 7;
    dist[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    key[i] = r.next();
  }
  const byDist = Array.from({ length: N }, (_, i) => i).sort((a, b) => dist[a] - dist[b] || a - b);
  const pool = Math.min(NEAR_POOL, N);
  const inner = byDist.slice(0, pool).sort((a, b) => key[a] - key[b]);
  const outer = byDist.slice(pool);
  // Order: inner shuffled (first 700 = low, next 900 = medium), then the inner remainder + outer shuffled (high).
  const lowN = TIER_COUNTS.low, medN = TIER_COUNTS.medium, highN = Math.min(TIER_COUNTS.high, N);
  const order = inner.slice(0, medN);
  const rest = inner.slice(medN).concat(outer).sort((a, b) => key[a] - key[b]);
  for (let i = 0; i < rest.length && order.length < highN; i++) order.push(rest[i]);
  const count = tier === 'high' ? highN : tier === 'medium' ? Math.min(medN, order.length) : Math.min(lowN, order.length);
  const out = {
    count, total: N, pool, order: Int32Array.from(order.slice(0, count)),
    x: new Float32Array(count), y: new Float32Array(count), z: new Float32Array(count), yaw: new Float32Array(count),
    column: new Uint8Array(count), phase: new Float32Array(count), threshold: new Float32Array(count),
    courtside: new Uint8Array(count), shirtCat: new Uint8Array(count), shirtIdx: new Uint8Array(count),
    skinIdx: new Uint8Array(count), hairIdx: new Uint8Array(count), trousersK: new Float32Array(count),
  };
  // Shirt categories by a low-discrepancy (golden-ratio) sequence along the order: every prefix (every tier) has
  // shares within ~1/N of 30 / 12 / 58 %, and the random order spreads them over the stands.
  const PHI = 0.6180339887498949;
  const off = r.next();
  for (let k = 0; k < count; k++) {
    const i = order[k];
    out.x[k] = L.x[i]; out.y[k] = L.y[i]; out.z[k] = L.z[i]; out.yaw[k] = L.yaw[i];
    out.courtside[k] = L.courtside[i];
    out.column[k] = r.int(8);
    out.phase[k] = r.range(0, Math.PI * 2);
    out.threshold[k] = r.next();
    const u = (off + k * PHI) % 1;
    out.shirtCat[k] = u < SHARE_USER ? 0 : u < SHARE_USER + SHARE_OPP ? 1 : 2;
    out.shirtIdx[k] = r.int(SHIRT_PALETTE.length);
    out.skinIdx[k] = r.int(SKIN_PALETTE.length);
    out.hairIdx[k] = r.int(HAIR_PALETTE.length);
    out.trousersK[k] = 1 + r.range(-0.08, 0.08);
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Atlas painter (pure)
// -------------------------------------------------------------------------------------------------

// Shape list of one person in billboard metres (x ∈ [−0.31, 0.31], y up). ch: 0 shirt (R), 1 skin (G),
// 2 hair/trousers (B), 3 dark (shoes / outline colour, all channels 0).
function personShapes(col, pose) {
  const S = [];
  const standing = pose >= 2;
  const broad = col === 1 ? 1.18 : col === 6 ? 1.08 : 1.0;
  const fem = col === 2 || col === 3 || col === 7;
  const tw = 0.15 * broad * (fem ? 0.92 : 1);
  const E = (cx, cy, rx, ry, ch) => S.push({ t: 0, cx, cy, rx, ry, ch });
  const B = (x0, y0, x1, y1, rad, ch) => S.push({ t: 1, x0, y0, x1, y1, r: rad, ch });
  const Cp = (x0, y0, x1, y1, rad, ch) => S.push({ t: 2, x0, y0, x1, y1, r: rad, ch });
  let headY, shoulderY, hipY;
  if (!standing) {
    const lean = pose === 1 ? 0.05 : 0;
    headY = 0.93 - lean; shoulderY = 0.79 - lean; hipY = 0.45;
    // Legs: shins + thighs (trousers), shoes.
    Cp(-0.085, 0.36, -0.085, 0.05, 0.048, 2);
    Cp(0.085, 0.36, 0.085, 0.05, 0.048, 2);
    B(-0.15 * broad, 0.33, 0.15 * broad, 0.47, 0.05, 2);
    E(-0.09, 0.03, 0.06, 0.03, 3);
    E(0.09, 0.03, 0.06, 0.03, 3);
  } else {
    headY = 1.30; shoulderY = 1.16; hipY = 0.80;
    Cp(-0.075, hipY, -0.085, 0.06, 0.056, 2);
    Cp(0.075, hipY, 0.085, 0.06, 0.056, 2);
    E(-0.095, 0.03, 0.065, 0.032, 3);
    E(0.095, 0.03, 0.065, 0.032, 3);
  }
  // Long hair / hood behind the head.
  if (col === 2) E(0, headY - 0.05, 0.105, 0.15, 2);
  if (col === 6) E(0, headY - 0.01, 0.12, 0.135, 0);
  if (col === 7) Cp(0.07, headY + 0.02, 0.13, headY - 0.13, 0.032, 2);
  // Torso (shirt), neck.
  B(-tw, hipY, tw, shoulderY + 0.03, 0.055, 0);
  B(-0.032, shoulderY, 0.032, shoulderY + 0.07, 0.015, 1);
  // Arms.
  const sx = tw - 0.01;
  if (pose === 0) {
    Cp(-sx, shoulderY - 0.01, -sx - 0.03, hipY + 0.12, 0.04, 0);
    Cp(sx, shoulderY - 0.01, sx + 0.03, hipY + 0.12, 0.04, 0);
    Cp(-sx - 0.03, hipY + 0.12, -0.08, hipY + 0.02, 0.032, 1);
    Cp(sx + 0.03, hipY + 0.12, 0.08, hipY + 0.02, 0.032, 1);
  } else if (pose === 1) {
    Cp(-sx, shoulderY - 0.01, -sx - 0.02, hipY + 0.06, 0.04, 0);
    Cp(sx, shoulderY - 0.01, sx + 0.02, hipY + 0.06, 0.04, 0);
    Cp(-sx - 0.02, hipY + 0.06, -0.10, 0.37, 0.032, 1);
    Cp(sx + 0.02, hipY + 0.06, 0.10, 0.37, 0.032, 1);
  } else if (pose === 2) {
    Cp(-sx, shoulderY - 0.02, -0.22, shoulderY + 0.14, 0.045, 0);
    Cp(sx, shoulderY - 0.02, 0.22, shoulderY + 0.14, 0.045, 0);
    Cp(-0.22, shoulderY + 0.14, -0.25, shoulderY + 0.33, 0.035, 1);
    Cp(0.22, shoulderY + 0.14, 0.25, shoulderY + 0.33, 0.035, 1);
    E(-0.255, shoulderY + 0.36, 0.035, 0.04, 1);
    E(0.255, shoulderY + 0.36, 0.035, 0.04, 1);
  } else {
    Cp(-sx, shoulderY - 0.02, -sx - 0.04, shoulderY - 0.22, 0.045, 0);
    Cp(sx, shoulderY - 0.02, sx + 0.04, shoulderY - 0.22, 0.045, 0);
    Cp(-sx - 0.04, shoulderY - 0.22, -0.02, shoulderY - 0.08, 0.035, 1);
    Cp(sx + 0.04, shoulderY - 0.22, 0.02, shoulderY - 0.08, 0.035, 1);
    E(0, shoulderY - 0.07, 0.04, 0.045, 1);
  }
  // Head.
  E(0, headY, 0.085, 0.105, 1);
  // Hair / cap on top.
  if (col === 0) E(0, headY + 0.055, 0.088, 0.06, 2);
  if (col === 1) { B(-0.092, headY + 0.03, 0.092, headY + 0.11, 0.04, 0); B(-0.02, headY + 0.03, 0.15, headY + 0.055, 0.012, 0); }
  if (col === 2) E(0, headY + 0.06, 0.092, 0.06, 2);
  if (col === 3) { E(0, headY + 0.055, 0.09, 0.06, 2); E(0, headY + 0.13, 0.042, 0.04, 2); }
  if (col === 4) E(0, headY + 0.05, 0.09, 0.065, 2);
  if (col === 7) E(0, headY + 0.055, 0.09, 0.06, 2);
  return { shapes: S, height: standing ? 1.42 : 1.05, scale: col === 4 ? 0.75 : 1 };
}

// Signed distance (metres, negative inside) of point (x, y) to a shape.
function sdf(s, x, y) {
  if (s.t === 0) {
    const nx = (x - s.cx) / s.rx, ny = (y - s.cy) / s.ry;
    const k = Math.sqrt(nx * nx + ny * ny);
    return (k - 1) * Math.min(s.rx, s.ry);
  }
  if (s.t === 1) {
    const cx = 0.5 * (s.x0 + s.x1), cy = 0.5 * (s.y0 + s.y1);
    const hx = 0.5 * Math.abs(s.x1 - s.x0) - s.r, hy = 0.5 * Math.abs(s.y1 - s.y0) - s.r;
    const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - s.r;
  }
  const px = x - s.x0, py = y - s.y0, bx = s.x1 - s.x0, by = s.y1 - s.y0;
  const h = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)));
  const dx = px - bx * h, dy = py - by * h;
  return Math.sqrt(dx * dx + dy * dy) - s.r;
}

// Shade 0.55–1.0 from a top-left light: a pseudo-normal across the shape (cylindrical) + a vertical gradient.
function shadeOf(s, x, y) {
  let u = 0, v = 0;
  if (s.t === 0) { u = (x - s.cx) / s.rx; v = (y - s.cy) / s.ry; }
  else if (s.t === 1) {
    u = (x - 0.5 * (s.x0 + s.x1)) / (0.5 * Math.abs(s.x1 - s.x0) || 1);
    v = (y - 0.5 * (s.y0 + s.y1)) / (0.5 * Math.abs(s.y1 - s.y0) || 1);
  } else {
    const bx = s.x1 - s.x0, by = s.y1 - s.y0, L = Math.sqrt(bx * bx + by * by) || 1;
    u = ((x - s.x0) * (-by / L) + (y - s.y0) * (bx / L)) / s.r;     // across the capsule
    v = 0;
  }
  u = Math.max(-1, Math.min(1, u)); v = Math.max(-1, Math.min(1, v));
  const nz = Math.sqrt(Math.max(0, 1 - u * u));
  const lit = 0.55 * nz - 0.35 * u + 0.25 * v;                   // light from top-left-front
  return Math.max(0.55, Math.min(1.0, 0.62 + 0.42 * lit));
}

// Bounding box (metres) of a shape.
function shapeBox(s, out) {
  if (s.t === 0) { out[0] = s.cx - s.rx; out[1] = s.cy - s.ry; out[2] = s.cx + s.rx; out[3] = s.cy + s.ry; }
  else {
    const pad = s.t === 2 ? s.r : 0;
    out[0] = Math.min(s.x0, s.x1) - pad; out[1] = Math.min(s.y0, s.y1) - pad;
    out[2] = Math.max(s.x0, s.x1) + pad; out[3] = Math.max(s.y0, s.y1) + pad;
  }
  return out;
}

/**
 * Paint the 8 × 4 crowd atlas (size², cells size/8 × size/4). Row r (pose) occupies v ∈ [r/4, (r+1)/4] with the
 * figure's feet at the cell bottom; data row 0 is v = 0 (upload with flipY = false). Shapes are rasterised over
 * their bounding boxes in painter's order; the outline is a separable 2-px dilation of the coverage.
 * @param {number} size 1024 (medium/high) or 512 (low)
 * @returns {Uint8Array} RGBA
 */
export function paintCrowdAtlas(size) {
  const N = size | 0;
  const cw = N / 8, ch = N / 4;
  const out = new Uint8Array(N * N * 4);
  const chan = new Int8Array(cw * ch);
  const shade = new Float32Array(cw * ch);
  const hdil = new Uint8Array(cw * ch);
  const box = [0, 0, 0, 0];
  const R = Math.max(1, Math.round(2 * N / 1024));
  for (let pose = 0; pose < 4; pose++) {
    for (let col = 0; col < 8; col++) {
      const P = personShapes(col, pose);
      const mx = 0.62 / cw;                     // metres per px (billboard 0.62 m wide)
      const my = P.height / ch;                 // 1.05 m (sit) or 1.42 m (stand, stretched in the shader)
      const sc = P.scale;                       // kid: 0.75 about the bottom centre
      chan.fill(-1);
      for (let k = 0; k < P.shapes.length; k++) {
        const sh = P.shapes[k];
        shapeBox(sh, box);
        const px0 = Math.max(0, Math.floor((box[0] * sc + 0.31) / mx) - 1), px1 = Math.min(cw - 1, Math.ceil((box[2] * sc + 0.31) / mx) + 1);
        const py0 = Math.max(0, Math.floor((box[1] * sc) / my) - 1), py1 = Math.min(ch - 1, Math.ceil((box[3] * sc) / my) + 1);
        for (let py = py0; py <= py1; py++) {
          const y = ((py + 0.5) * my) / sc;
          for (let px = px0; px <= px1; px++) {
            const x = ((px + 0.5) * mx - 0.31) / sc;
            if (sdf(sh, x, y) > 0) continue;
            const i = py * cw + px;
            chan[i] = sh.ch;
            shade[i] = sh.ch === 3 ? 0 : shadeOf(sh, x, y);
          }
        }
      }
      // Horizontal then vertical dilation of the coverage (outline ring = dilated − covered).
      for (let py = 0; py < ch; py++) {
        for (let px = 0; px < cw; px++) {
          let hit = 0;
          for (let d = -R; d <= R && !hit; d++) { const x = px + d; if (x >= 0 && x < cw && chan[py * cw + x] >= 0) hit = 1; }
          hdil[py * cw + px] = hit;
        }
      }
      const ox = col * cw, oy = pose * ch;
      for (let py = 0; py < ch; py++) {
        for (let px = 0; px < cw; px++) {
          const i = py * cw + px;
          const o = ((oy + py) * N + (ox + px)) * 4;
          const c = chan[i];
          if (c >= 0) {
            const v = Math.round(shade[i] * 255);
            out[o] = c === 0 ? v : 0;
            out[o + 1] = c === 1 ? v : 0;
            out[o + 2] = c === 2 ? v : 0;
            out[o + 3] = 255;
            continue;
          }
          let hit = 0;
          for (let d = -R; d <= R && !hit; d++) { const y = py + d; if (y >= 0 && y < ch && hdil[y * cw + px]) hit = 1; }
          if (hit) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 255; }
        }
      }
    }
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Instanced crowd
// -------------------------------------------------------------------------------------------------

const VERT_PARS = `#include <common>
attribute vec3 aSkin;
attribute vec3 aHair;
attribute vec4 aMisc;
uniform float uTime;
uniform float uExcite;
uniform float uChant;
varying vec3 vSkin;
varying vec3 vHair;
varying vec3 vTrou;
varying float vCellV;
varying float vCourt;`;

// Pose row from the excitement vs the instance threshold; standing poses stretch the billboard ×1.35 (the standing
// figures are painted pre-squashed), bob with the excitement; seated people sway slightly. Chant: everyone with a
// threshold < 0.30 stands and claps on the 1.0 s pattern (claps at 0 and 0.25 s of each cycle).
const VERT_BEGIN = `#include <begin_vertex>
	float cCol = aMisc.x;
	float cPh = aMisc.y;
	float cThr = aMisc.z;
	float cRow;
	bool chanting = uChant > 0.5 && cThr < 0.30;
	if ( chanting ) {
		float cyc = fract( uTime );
		cRow = ( cyc < 0.12 || ( cyc > 0.25 && cyc < 0.37 ) ) ? 3.0 : 2.0;
	} else if ( uExcite < cThr - 0.15 ) {
		cRow = mod( cCol, 2.0 ) > 0.5 ? 1.0 : 0.0;
	} else if ( uExcite < cThr ) {
		cRow = 1.0;
	} else {
		cRow = sin( 6.2831853 * 2.2 * uTime + cPh ) > 0.0 ? 2.0 : 3.0;
	}
	float cStand = cRow > 1.5 ? 1.0 : 0.0;
	transformed.y *= mix( 1.0, 1.35, cStand );
	float cEx = chanting ? max( uExcite, 0.6 ) : uExcite;
	transformed.y += cStand * 0.10 * max( 0.0, sin( 6.2831853 * 1.8 * uTime + cPh ) ) * cEx;
	transformed.x += ( 1.0 - cStand ) * 0.015 * sin( 6.2831853 * 0.25 * uTime + cPh );
	vMapUv = ( vec2( cCol, cRow ) + uv ) / vec2( 8.0, 4.0 );
	vCellV = uv.y;
	vSkin = aSkin;
	vHair = aHair;
	vTrou = vec3( 0.0159, 0.0185, 0.0284 ) * ( 0.92 + 0.16 * fract( cPh * 7.13 ) );
	vCourt = aMisc.w;`;

const FRAG_PARS = `#include <common>
uniform float uDim;
uniform float uBright;
varying vec3 vSkin;
varying vec3 vHair;
varying vec3 vTrou;
varying float vCellV;
varying float vCourt;`;

const FRAG_MAP = `vec4 cell = texture2D( map, vMapUv );
	vec3 alb = cell.r * vColor.rgb + cell.g * vSkin + cell.b * ( vCellV > 0.70 ? vHair : vTrou );
	diffuseColor.rgb = alb * uDim * uBright * mix( 0.80, 1.0, vCourt );
	diffuseColor.a = cell.a;`;

const COL = new THREE.Color();

/**
 * Build the crowd.
 * @param {THREE.Scene|null} scene
 * @param {object} quality  (loadTier → material & atlas; capRung → instance capacity; tier → visible count)
 * @param {{user?:string|number, opp?:string|number}} [palette]  team UI colours (user team 30 %, opponent 12 %)
 * @param {Rng} [rng]  `Rng(seed ^ 0xC20D)`
 */
export function buildCrowd(scene, quality, palette, rng) {
  const q = quality || { tier: 'low' };
  const loadTier = q.loadTier || q.tier || 'low';
  const capTier = q.capRung ? tierOfRung(q.capRung) : loadTier;
  const T = TIERS[loadTier].crowd;
  const capacity = Math.max(TIERS[capTier].crowd.count, TIERS[q.tier || loadTier].crowd.count);
  const capTierName = capacity >= TIER_COUNTS.high ? 'high' : capacity >= TIER_COUNTS.medium ? 'medium' : 'low';
  const S = seats(capTierName, rng || new Rng(0xC20D));
  const n = S.count;

  // Atlas.
  const size = T.atlas;
  const atlasData = paintCrowdAtlas(size);
  const atlas = new THREE.DataTexture(atlasData, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  atlas.flipY = false;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  atlas.needsUpdate = true;     // linear data (channel masks), not sRGB
  trackTexture(atlas, 4, true);

  const uniforms = {
    uTime: { value: 0 }, uExcite: { value: 0.05 }, uChant: { value: 0 }, uDim: { value: 1 },
    uBright: { value: T.material === 'basic' ? 0.62 : 1.0 },
  };
  const lambert = T.material !== 'basic';
  const material = lambert
    ? new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
  material.name = 'crowd';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', VERT_PARS)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <color_fragment>', '');
  };
  material.customProgramCacheKey = () => 'crowd-v2';

  const geo = new THREE.PlaneGeometry(0.62, 1.05).translate(0, 0.525, 0);
  const aSkin = new Float32Array(n * 3), aHair = new Float32Array(n * 3), aMisc = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    COL.setHex(SKIN_PALETTE[S.skinIdx[i]]);
    aSkin[i * 3] = COL.r; aSkin[i * 3 + 1] = COL.g; aSkin[i * 3 + 2] = COL.b;
    COL.setHex(HAIR_PALETTE[S.hairIdx[i]]);
    aHair[i * 3] = COL.r; aHair[i * 3 + 1] = COL.g; aHair[i * 3 + 2] = COL.b;
    aMisc[i * 4] = S.column[i]; aMisc[i * 4 + 1] = S.phase[i]; aMisc[i * 4 + 2] = S.threshold[i]; aMisc[i * 4 + 3] = S.courtside[i];
  }
  geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(aSkin, 3));
  geo.setAttribute('aHair', new THREE.InstancedBufferAttribute(aHair, 3));
  geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(aMisc, 4));

  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.name = 'crowd';
  mesh.frustumCulled = false;
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    p.set(S.x[i], S.y[i], S.z[i]);
    qt.setFromAxisAngle(up, S.yaw[i]);
    m4.compose(p, qt, one);
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;

  const pal = { user: 0x6f263d, opp: 0xce1141 };
  function writeShirts() {
    for (let i = 0; i < n; i++) {
      const cat = S.shirtCat[i];
      COL.setHex(cat === 0 ? pal.user : cat === 1 ? pal.opp : SHIRT_PALETTE[S.shirtIdx[i]]);
      mesh.setColorAt(i, COL);
    }
    mesh.instanceColor.needsUpdate = true;
  }
  function setTeamColours(user, opp) {
    if (user !== undefined && user !== null) pal.user = typeof user === 'string' ? new THREE.Color(user).getHex() : user;
    if (opp !== undefined && opp !== null) pal.opp = typeof opp === 'string' ? new THREE.Color(opp).getHex() : opp;
    writeShirts();
  }
  setTeamColours(palette && palette.user, palette && palette.opp);
  mesh.count = Math.min(n, TIERS[q.tier || loadTier].crowd.count);
  if (scene) scene.add(mesh);

  // Excitement state (PR §2.8): level held for holdS, then decays toward base at 0.5 /s.
  const ex = { level: 0.05, hold: 0, base: 0.05, chant: false };

  // Seat positions of the visible instances (CameraFlashes); `count` follows runtime tier changes.
  const visibleSeats = { x: S.x, y: S.y, z: S.z, get count() { return mesh.count; } };

  const crowd = {
    mesh, material, atlas, uniforms, seats: S, capacity: n, visibleSeats,
    /** Presentation sink: excitement to `level` for `holdS` seconds (keeps the larger of a running hold). */
    excite(level, holdS) {
      const l = Math.max(0, Math.min(1, level));
      // A weaker event during a stronger hold does not cut the crowd down.
      if (ex.hold > 0 && l < ex.level) return;
      ex.level = Math.max(l, ex.base);
      ex.hold = holdS > 0 ? holdS : 0;
      uniforms.uExcite.value = ex.level;
    },
    /** Presentation sink: synchronized clap chant on/off. */
    chant(on) { ex.chant = !!on; uniforms.uChant.value = ex.chant ? 1 : 0; },
    /** Base excitement: normal 0.05, clutch 0.25. */
    setBase(level) { ex.base = Math.max(0, Math.min(1, level)); if (ex.level < ex.base) ex.level = ex.base; },
    setClutch(on) { this.setBase(on ? 0.25 : 0.05); },
    /** Preset crowd colour multiplier (lighting presets). */
    setDim(v) { uniforms.uDim.value = v; },
    setTeamColours,
    /** Runtime tier change: visible count only (capacity fixed at load). */
    setTier(tier) { mesh.count = Math.min(n, TIERS[tier] ? TIERS[tier].crowd.count : n); },
    /** Per frame: 4 uniform writes. */
    update(dt) {
      uniforms.uTime.value = (uniforms.uTime.value + dt) % 3600;
      if (ex.hold > 0) ex.hold -= dt;
      else if (ex.level > ex.base) ex.level = Math.max(ex.base, ex.level - 0.5 * dt);
      else if (ex.level < ex.base) ex.level = ex.base;
      uniforms.uExcite.value = ex.level;
    },
    get excitement() { return ex.level; },
    dispose() {
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.dispose();
      geo.dispose();
      material.dispose();
      atlas.dispose();
    },
  };
  return crowd;
}
