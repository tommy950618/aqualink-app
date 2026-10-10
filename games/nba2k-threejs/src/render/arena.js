/**
 * @module render/arena
 * The arena around the court (SPEC-v2 §6.2, PR §2.5–§2.7): gradient sky dome + fog ("arena darkness"), stepped
 * stands (one merged Lambert draw, ≈ 330 tris), ceiling light fixtures (instanced), scrolling LED boards (baseline,
 * sideline and the upper-deck ribbon, one merged draw), the end-zone jumbotron (frame + screen merged, one draw) and
 * the centre-hung cube (medium/high, culled in play).
 *
 * LED and jumbotron textures are canvases repainted only on change (LED ≤ 1 per 0.5 s; jumbotron ≤ 2 Hz, low ≤ 1 Hz);
 * all their strings come from i18n (`led.*`, `jumbo.*`, `app.title`, `legal.note`, `brand.*`) or from the data passed
 * in (player names from legends.js via the router). `__game.arena.jumbo = {lastText, mode}` reads this module's
 * Jumbotron.
 */
import * as THREE from '../../vendor/three.module.js';
import { t, hasKey, getLang } from '../i18n.js';
import { TIERS, trackTexture } from './quality.js';
import { makeCanvas } from './floor.js';
import { STANDS, ROW_DEPTH, ROW_RISE } from './crowd.js';

const FONT = '"Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "WenQuanYi Micro Hei", system-ui, sans-serif';
const GOLD = '#d9a520';
const DARK_UV = 0.002;               // uv of the dark border texel (frame / back faces)

function tr(key, params, fallback) {
  return hasKey(key) ? t(key, params) : (fallback !== undefined ? fallback : '');
}

// -------------------------------------------------------------------------------------------------
// Dome, fog
// -------------------------------------------------------------------------------------------------

/** Sky dome: SphereGeometry(85, 24, 12) BackSide, vertex colours by elevation (horizon → 25° → zenith). */
export function buildDome() {
  const g = new THREE.SphereGeometry(85, 24, 12);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const cH = new THREE.Color(0x12151e), c25 = new THREE.Color(0x0c0e15), cZ = new THREE.Color(0x040508), c = new THREE.Color();
  const e25 = (25 * Math.PI) / 180;
  for (let i = 0; i < pos.count; i++) {
    const el = Math.asin(Math.max(-1, Math.min(1, pos.getY(i) / 85)));
    if (el <= 0) c.copy(cH);
    else if (el < e25) c.copy(cH).lerp(c25, el / e25);
    else c.copy(c25).lerp(cZ, (el - e25) / (Math.PI / 2 - e25));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false });
  m.name = 'dome';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'dome';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// -------------------------------------------------------------------------------------------------
// Stands (quads; same layout numbers as the crowd seats)
// -------------------------------------------------------------------------------------------------

class QuadBuilder {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
  // Quad a-b-c-d (counter-clockwise seen from the front), flat normal, colour.
  quad(a, b, c, d, colour) {
    const o = this.p.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const pts = [a, b, c, d];
    for (let k = 0; k < 4; k++) {
      this.p.push(pts[k][0], pts[k][1], pts[k][2]);
      this.n.push(nx, ny, nz);
      this.c.push(colour.r, colour.g, colour.b);
    }
    this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  // Axis-aligned box (12 tris).
  box(x0, y0, z0, x1, y1, z1, colour) {
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], colour);   // top
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], colour);   // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], colour);   // −z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], colour);   // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], colour);   // −x
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], colour);   // bottom
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Stand geometry: per row a riser (vertical) and a tread (horizontal) quad; upper decks get a fascia (where the
 * ribbon board hangs) and a soffit; courtside benches. One merged Lambert draw (#1a1d27 treads, darker risers).
 */
export function buildStands() {
  const q = new QuadBuilder();
  const tread = new THREE.Color(0x1a1d27), riser = new THREE.Color(0x13151d), soffit = new THREE.Color(0x0d0f15);
  // End stand behind the hoop (faces +z): rows step back toward −z and up.
  const EL = STANDS.endLower;
  for (let i = 0; i < EL.rows; i++) {
    const h = i < EL.narrowRows ? EL.narrowX + 0.3 : EL.wideX + 0.3;
    const zf = EL.zFront - i * ROW_DEPTH, zb = zf - ROW_DEPTH;
    const y0 = i * ROW_RISE, y1 = (i + 1) * ROW_RISE;
    q.quad([-h, y0, zf], [h, y0, zf], [h, y1, zf], [-h, y1, zf], riser);
    q.quad([-h, y1, zf], [h, y1, zf], [h, y1, zb], [-h, y1, zb], tread);
  }
  // Sideline stands (left faces +x, right faces −x).
  const SL = STANDS.sideLower;
  for (let s = -1; s <= 1; s += 2) {
    for (let i = 0; i < SL.rows; i++) {
      const xf = s * (SL.xFront + i * ROW_DEPTH), xb = s * (SL.xFront + (i + 1) * ROW_DEPTH);
      const y0 = i * ROW_RISE, y1 = (i + 1) * ROW_RISE;
      const za = SL.z0 - 0.3, zb = SL.z1 + 0.3;
      if (s < 0) {
        q.quad([xf, y0, za], [xf, y0, zb], [xf, y1, zb], [xf, y1, za], riser);
        q.quad([xf, y1, za], [xf, y1, zb], [xb, y1, zb], [xb, y1, za], tread);
      } else {
        q.quad([xf, y0, zb], [xf, y0, za], [xf, y1, za], [xf, y1, zb], riser);
        q.quad([xf, y1, zb], [xf, y1, za], [xb, y1, za], [xb, y1, zb], tread);
      }
    }
  }
  // Upper end deck (two halves around the jumbotron): fascia, rows, soffit.
  const EU = STANDS.endUpper;
  const zLast = EU.zFront - EU.rows * ROW_DEPTH;
  for (let s = -1; s <= 1; s += 2) {
    const xa = s < 0 ? -EU.x - 0.3 : EU.gapX - 0.3, xb = s < 0 ? -EU.gapX + 0.3 : EU.x + 0.3;
    q.quad([xa, EU.fasciaY, EU.zFront], [xb, EU.fasciaY, EU.zFront], [xb, EU.y0 - ROW_RISE, EU.zFront], [xa, EU.y0 - ROW_RISE, EU.zFront], riser);
    for (let i = 0; i < EU.rows; i++) {
      const zf = EU.zFront - i * ROW_DEPTH, zb = zf - ROW_DEPTH;
      const y0 = EU.y0 + (i - 1) * ROW_RISE, y1 = EU.y0 + i * ROW_RISE;
      q.quad([xa, y0, zf], [xb, y0, zf], [xb, y1, zf], [xa, y1, zf], riser);
      q.quad([xa, y1, zf], [xb, y1, zf], [xb, y1, zb], [xa, y1, zb], tread);
    }
    q.quad([xa, EU.fasciaY, zLast], [xb, EU.fasciaY, zLast], [xb, EU.fasciaY, EU.zFront], [xa, EU.fasciaY, EU.zFront], soffit);
  }
  // Upper sideline decks.
  const SU = STANDS.sideUpper;
  for (let s = -1; s <= 1; s += 2) {
    const za = SU.z0 - 0.3, zb = SU.z1 + 0.3;
    const xLast = s * (SU.xFront + SU.rows * ROW_DEPTH);
    const xf0 = s * SU.xFront;
    const face = (xf, y0, y1, colour) => {
      if (s < 0) q.quad([xf, y0, za], [xf, y0, zb], [xf, y1, zb], [xf, y1, za], colour);
      else q.quad([xf, y0, zb], [xf, y0, za], [xf, y1, za], [xf, y1, zb], colour);
    };
    face(xf0, SU.fasciaY, SU.y0 - ROW_RISE, riser);
    for (let i = 0; i < SU.rows; i++) {
      const xf = s * (SU.xFront + i * ROW_DEPTH), xb = s * (SU.xFront + (i + 1) * ROW_DEPTH);
      const y0 = SU.y0 + (i - 1) * ROW_RISE, y1 = SU.y0 + i * ROW_RISE;
      face(xf, y0, y1, riser);
      if (s < 0) q.quad([xf, y1, za], [xf, y1, zb], [xb, y1, zb], [xb, y1, za], tread);
      else q.quad([xf, y1, zb], [xf, y1, za], [xb, y1, za], [xb, y1, zb], tread);
    }
    if (s < 0) q.quad([xLast, SU.fasciaY, za], [xLast, SU.fasciaY, zb], [xf0, SU.fasciaY, zb], [xf0, SU.fasciaY, za], soffit);
    else q.quad([xf0, SU.fasciaY, za], [xf0, SU.fasciaY, zb], [xLast, SU.fasciaY, zb], [xLast, SU.fasciaY, za], soffit);
  }
  // Courtside benches (|x| 9.4, z −13.5 … −1.0): low boxes the courtside fans sit on.
  const C = STANDS.courtside;
  const bench = new THREE.Color(0x22252f);
  for (let s = -1; s <= 1; s += 2) {
    q.box(s * C.x - 0.25, 0, C.z0 - 0.35, s * C.x + 0.25, C.seatY, C.z1 + 0.35, bench);
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.name = 'stands';
  const mesh = new THREE.Mesh(q.geometry(), mat);
  mesh.name = 'stands';
  return mesh;
}

// -------------------------------------------------------------------------------------------------
// LED boards
// -------------------------------------------------------------------------------------------------

/** Board length covered by one LED texture width: square texels (64 px over 0.9 m → 2048 px over 28.8 m). */
export const LED_SPAN_M = 28.8;
export const LED_SLOTS = 6;
const DEFAULT_SLOTS = ['brand', 'noise', 'brand', 'defense', 'brand', 'noise'];

/**
 * LED boards: baseline x ∈ [−8.5, −1.4] ∪ [1.4, 8.5], y 0–0.9, z −16.9 (depth 0.15); sidelines x = ±10.4,
 * z −15.5 … +2.0; ribbon (medium/high) x ±16, y 5.6–6.4, z −22.2. One merged draw (ribbon last in the index so it can
 * be dropped with a draw range). Court-facing faces show the scrolling texture; other faces are dark.
 */
export class LedBoards {
  /**
   * @param {object} quality
   */
  constructor(quality) {
    const q = quality || { tier: 'low' };
    const tier = q.loadTier || q.tier || 'low';
    const T = TIERS[tier];
    this.W = T.led.tex[0];
    this.H = T.led.tex[1];
    this.canvas = makeCanvas(this.W, this.H);
    this.ctx = this.canvas && typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
    this.texture = new THREE.CanvasTexture(this.canvas || { width: this.W, height: this.H });
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    trackTexture(this.texture, 4, true, this.W, this.H);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, vertexColors: true, toneMapped: false });
    this.material.color.setScalar(1.4);
    this.material.name = 'led';
    const { geometry, ribbonStart } = LedBoards.geometry();
    this.geometry = geometry;
    this.ribbonStart = ribbonStart;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'ledBoards';
    this.slots = DEFAULT_SLOTS.slice();
    this.score = null;               // { a, sa, sb, b }
    this.takeoverT = 0;
    this.takeoverText = '';
    this.takeoverColour = '#000000';
    this.sinceRepaint = 1e9;
    this.dirty = true;
    this.repaints = 0;
    this.setRibbon(T.ribbon);
    this._repaint();
  }

  static geometry() {
    const p = [], n = [], uv = [], c = [], idx = [];
    const lit = new THREE.Color(1, 1, 1), dark = new THREE.Color(0x0b0c10);
    let uOff = 0;
    const quad = (a, b, cc, d, nrm, colour, u0, u1) => {
      const o = p.length / 3;
      const pts = [a, b, cc, d];
      const uvs = colour === lit ? [[u0, 0], [u1, 0], [u1, 1], [u0, 1]] : [[DARK_UV, DARK_UV], [DARK_UV, DARK_UV], [DARK_UV, DARK_UV], [DARK_UV, DARK_UV]];
      for (let k = 0; k < 4; k++) {
        p.push(pts[k][0], pts[k][1], pts[k][2]);
        n.push(nrm[0], nrm[1], nrm[2]);
        uv.push(uvs[k][0], uvs[k][1]);
        c.push(colour.r, colour.g, colour.b);
      }
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    // A board box whose LED face points along `face` (+z: baseline/ribbon, +x: left sideline, −x: right sideline).
    const board = (face, a0, a1, y0, y1, plane, depth) => {
      const L = a1 - a0;
      const u0 = uOff, u1 = uOff + L / LED_SPAN_M;
      uOff = (u1 + 0.37) % 1;          // stagger the message phase between boards
      if (face === 'z') {
        const zf = plane + depth / 2, zb = plane - depth / 2;
        quad([a0, y0, zf], [a1, y0, zf], [a1, y1, zf], [a0, y1, zf], [0, 0, 1], lit, u0, u1);
        quad([a1, y0, zb], [a0, y0, zb], [a0, y1, zb], [a1, y1, zb], [0, 0, -1], dark);
        quad([a0, y1, zf], [a1, y1, zf], [a1, y1, zb], [a0, y1, zb], [0, 1, 0], dark);
        quad([a0, y0, zb], [a0, y0, zf], [a0, y1, zf], [a0, y1, zb], [-1, 0, 0], dark);
        quad([a1, y0, zf], [a1, y0, zb], [a1, y1, zb], [a1, y1, zf], [1, 0, 0], dark);
      } else {
        const s = face === '+x' ? 1 : -1;            // LED face normal = (s, 0, 0)
        const xf = plane + s * depth / 2, xb = plane - s * depth / 2;
        // Seen from the court: on the left board (+x normal) u runs toward −z, on the right board toward +z.
        if (s > 0) quad([xf, y0, a1], [xf, y0, a0], [xf, y1, a0], [xf, y1, a1], [1, 0, 0], lit, u0, u1);
        else quad([xf, y0, a0], [xf, y0, a1], [xf, y1, a1], [xf, y1, a0], [-1, 0, 0], lit, u0, u1);
        if (s > 0) quad([xb, y0, a0], [xb, y0, a1], [xb, y1, a1], [xb, y1, a0], [-1, 0, 0], dark);
        else quad([xb, y0, a1], [xb, y0, a0], [xb, y1, a0], [xb, y1, a1], [1, 0, 0], dark);
        quad([Math.min(xf, xb), y1, a1], [Math.max(xf, xb), y1, a1], [Math.max(xf, xb), y1, a0], [Math.min(xf, xb), y1, a0], [0, 1, 0], dark);
      }
    };
    board('z', -8.5, -1.4, 0, 0.9, -16.9, 0.15);
    board('z', 1.4, 8.5, 0, 0.9, -16.9, 0.15);
    board('+x', -15.5, 2.0, 0, 0.9, -10.4, 0.15);
    board('-x', -15.5, 2.0, 0, 0.9, 10.4, 0.15);
    const ribbonStart = idx.length;
    board('z', -16, 16, 5.6, 6.4, -22.2, 0.15);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return { geometry: g, ribbonStart };
  }

  /** Ribbon board on/off (runtime tier switch) via the draw range. */
  setRibbon(on) {
    this.ribbon = !!on;
    this.geometry.setDrawRange(0, on ? Infinity : this.ribbonStart);
  }

  /** Presentation sink `led.message(key)`: show `led.<key>` in alternating slots (brand in between). */
  message(key) {
    const k = typeof key === 'string' ? key.replace(/^led\./, '') : 'brand';
    if (k === 'brand') this.slots = DEFAULT_SLOTS.slice();
    else for (let i = 0; i < LED_SLOTS; i++) this.slots[i] = i % 2 === 1 ? k : 'brand';
    this.dirty = true;
  }

  /** Live score shown in two slots (`led.score`); repainted on change. */
  setScore(a, sa, sb, b) {
    const s = this.score;
    if (s && s.a === a && s.sa === sa && s.sb === sb && s.b === b) return;
    this.score = { a, sa, sb, b };
    this.slots[2] = 'score';
    this.slots[5] = 'score';
    this.dirty = true;
  }

  /** Presentation sink `led.takeover(text, cssColour, s)`: whole texture in the team colour for s seconds. */
  takeover(text, cssColour, s) {
    this.takeoverText = String(text || '');
    this.takeoverColour = cssColour || '#d9a520';
    this.takeoverT = s > 0 ? s : 2.5;
    this.dirty = true;
  }

  /** Language change etc. */
  refresh() { this.dirty = true; }

  /** Per frame: scroll (no repaint), timers, rate-limited repaint (≤ 1 per 0.5 s). */
  update(dt) {
    const off = this.texture.offset;
    off.x = (off.x + 0.045 * dt) % 1;
    this.sinceRepaint += dt;
    if (this.takeoverT > 0) {
      this.takeoverT -= dt;
      if (this.takeoverT <= 0) { this.takeoverT = 0; this.dirty = true; }
    }
    if (this.dirty && this.sinceRepaint >= 0.5) this._repaint();
  }

  _slotText(key) {
    if (key === 'score') {
      const s = this.score;
      if (!s) return tr('led.brand');
      return tr('led.score', s, s.a + ' ' + s.sa + ' - ' + s.sb + ' ' + s.b);
    }
    return tr('led.' + key);
  }

  _repaint() {
    this.dirty = false;
    this.sinceRepaint = 0;
    this.repaints++;
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.W, H = this.H, sw = W / LED_SLOTS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const take = this.takeoverT > 0;
    ctx.fillStyle = take ? this.takeoverColour : '#07080b';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < LED_SLOTS; i++) {
      const text = take ? this.takeoverText : this._slotText(this.slots[i]);
      if (!text) continue;
      const gold = !take && (this.slots[i] === 'brand' || this.slots[i] === 'clutch');
      ctx.fillStyle = take ? '#ffffff' : gold ? GOLD : '#ffffff';
      fitText(ctx, text, sw * (i + 0.5), H * 0.54, sw * 0.92, H * 0.62, '800');
      // Separator dot between slots.
      ctx.fillStyle = take ? 'rgba(255,255,255,0.5)' : 'rgba(217,165,32,0.6)';
      ctx.fillRect(Math.round(sw * (i + 1)) - 2, H * 0.42, 3, H * 0.16);
    }
    // Dot-matrix mask: every 3rd pixel row darkened 35 %.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 2; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    this.texture.needsUpdate = true;
  }
}

// Fit `text` centred at (x, y) into maxW × maxH: font size from the height, then shrink / squeeze to the width.
function fitText(ctx, text, x, y, maxW, maxH, weight) {
  let px = Math.max(6, Math.floor(maxH));
  ctx.font = weight + ' ' + px + 'px ' + FONT;
  let w = ctx.measureText(text).width;
  while (w > maxW && px > maxH * 0.6) {
    px -= 1;
    ctx.font = weight + ' ' + px + 'px ' + FONT;
    w = ctx.measureText(text).width;
  }
  if (w > maxW) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(maxW / w, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(text, x, y);
  }
}

// -------------------------------------------------------------------------------------------------
// Jumbotron
// -------------------------------------------------------------------------------------------------

/**
 * End-zone video board + its texture (also used by the centre-hung cube). Modes: `live`, `event` (2.5 s, then back),
 * `replay`, `intro`, `title`, `lineup`, `gameover`. Data contracts (all fields optional):
 *   live     { a:{abbr, score, colour}, b:{abbr, score, colour}, period:string, clock:number s, shotClock:number|null,
 *              leaders:[{short, pts}, {short, pts}] }   (pass the same object every frame; it is compared field by field)
 *   event    { kind:'dunk'|'three'|'block'|'winner', name, number, colour }
 *   replay   { name }
 *   intro    { number, nameZh, nameEn, ovr, height, colour }
 *   gameover { a:{abbr, score}, b:{abbr, score}, mvp:string }
 */
export class Jumbotron {
  constructor(quality) {
    const q = quality || { tier: 'low' };
    const tier = q.loadTier || q.tier || 'low';
    const T = TIERS[tier];
    this.W = T.jumbo.tex[0];
    this.H = T.jumbo.tex[1];
    this.hz = TIERS[q.tier || tier].jumbo.hz;
    this.canvas = makeCanvas(this.W, this.H);
    this.ctx = this.canvas && typeof this.canvas.getContext === 'function' ? this.canvas.getContext('2d') : null;
    this.texture = new THREE.CanvasTexture(this.canvas || { width: this.W, height: this.H });
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    trackTexture(this.texture, 4, true, this.W, this.H);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, vertexColors: true, toneMapped: false });
    this.material.color.setScalar(1.15);
    this.material.name = 'jumbotron';
    this.mesh = new THREE.Mesh(Jumbotron.geometry(), this.material);
    this.mesh.name = 'jumbotron';
    this.mode = 'title';
    this.data = null;
    this.prevMode = 'live';
    this.prevData = null;
    this.eventT = 0;
    this.sweep = 0;
    this.sweepT = 0;
    this.sinceRepaint = 1e9;
    this.dirty = true;
    this.repaints = 0;
    this.lastText = '';
    this.lastLang = '';
    // Snapshot of the displayed live values (compared without allocating).
    this.snap = { sa: -1, sb: -1, clock: -1, shot: -2, period: null, abbrA: null, abbrB: null, l0: null, p0: -1, l1: null, p1: -1 };
    this._repaint();
  }

  /** Frame box 10.6 × 5.1 × 0.6 at (0, 9.6, −26.9) + screen 10 × 4.5 at z −26.58, one geometry. */
  static geometry() {
    const frame = new THREE.BoxGeometry(10.6, 5.1, 0.6);
    frame.translate(0, 9.6, -26.9);
    const screen = new THREE.PlaneGeometry(10, 4.5);
    screen.translate(0, 9.6, -26.58);
    return mergeTextured([[frame, false], [screen, true]]);
  }

  /** Presentation sink `jumbotron.setMode(mode, data)`. */
  setMode(mode, data) {
    if (mode === 'event') {
      if (this.mode !== 'event') { this.prevMode = this.mode; this.prevData = this.data; }
      this.eventT = 2.5;
      this.sinceRepaint = 1e9;     // events are shown at once
    }
    if (mode !== this.mode) this.sinceRepaint = 1e9;   // a mode change shows at once; data churn is rate limited
    this.mode = mode;
    this.data = data || null;
    this.dirty = true;
  }

  /** Alias (PR §10). */
  show(mode, data) { this.setMode(mode, data); }

  /** Live data update without changing mode; repaints only when a displayed value changed. */
  setLive(data) {
    if (this.mode === 'event') { this.prevMode = 'live'; this.prevData = data; return; }
    this.mode = 'live';
    this.data = data;
    if (this._liveChanged(data)) this.dirty = true;
  }

  refresh() { this.dirty = true; }

  /** Runtime tier change: repaint rate. */
  setTier(tier) { this.hz = TIERS[tier] ? TIERS[tier].jumbo.hz : this.hz; }

  _liveChanged(d) {
    const s = this.snap;
    if (!d) return false;
    const a = d.a || {}, b = d.b || {};
    const clock = d.clock >= 0 ? Math.ceil(d.clock - 1e-6) : -1;
    const shot = d.shotClock === null || d.shotClock === undefined ? -1 : Math.ceil(d.shotClock - 1e-6);
    const L = d.leaders || null;
    const l0 = L && L[0] ? L[0].short : null, p0 = L && L[0] ? L[0].pts : -1;
    const l1 = L && L[1] ? L[1].short : null, p1 = L && L[1] ? L[1].pts : -1;
    if (s.sa === a.score && s.sb === b.score && s.clock === clock && s.shot === shot && s.period === d.period &&
        s.abbrA === a.abbr && s.abbrB === b.abbr && s.l0 === l0 && s.p0 === p0 && s.l1 === l1 && s.p1 === p1) return false;
    s.sa = a.score; s.sb = b.score; s.clock = clock; s.shot = shot; s.period = d.period;
    s.abbrA = a.abbr; s.abbrB = b.abbr; s.l0 = l0; s.p0 = p0; s.l1 = l1; s.p1 = p1;
    return true;
  }

  /** Per frame: event timer, title sweep, rate-limited repaint (≤ hz). */
  update(dt) {
    this.sinceRepaint += dt;
    if (this.mode === 'event') {
      this.eventT -= dt;
      if (this.eventT <= 0) { this.mode = this.prevMode || 'live'; this.data = this.prevData; this.dirty = true; this.snap.sa = -1; }
    } else if (this.mode === 'live' && this.data && this._liveChanged(this.data)) {
      this.dirty = true;
    } else if (this.mode === 'title' || this.mode === 'lineup') {
      this.sweepT += dt;
      if (this.sweepT >= 2) { this.sweepT = 0; this.sweep = (this.sweep + 1) % 4; this.dirty = true; }
    }
    if (getLang() !== this.lastLang) this.dirty = true;
    if (this.dirty && this.sinceRepaint >= 1 / this.hz - 1e-6) this._repaint();
  }

  _repaint() {
    this.dirty = false;
    this.sinceRepaint = 0;
    this.repaints++;
    this.lastLang = getLang();
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0c0d10';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#05070d';
      const b = Math.max(4, Math.round(W / 256));
      ctx.fillRect(b, b, W - 2 * b, H - 2 * b);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }
    const d = this.data || {};
    let text = '';
    switch (this.mode) {
      case 'live': text = this._paintLive(ctx, W, H, d); break;
      case 'event': text = this._paintEvent(ctx, W, H, d); break;
      case 'replay': text = this._paintReplay(ctx, W, H, d); break;
      case 'intro': text = this._paintIntro(ctx, W, H, d); break;
      case 'gameover': text = this._paintGameover(ctx, W, H, d); break;
      default: text = this._paintTitle(ctx, W, H); break;
    }
    this.lastText = text;
    if (ctx) this.texture.needsUpdate = true;
  }

  _paintTitle(ctx, W, H) {
    const zh = tr('brand.zh'), en = tr('brand.sub', null, tr('brand.wordmark'));
    const sub = tr('app.title');
    const legal = tr('legal.note');
    if (ctx) {
      // Slow gold sweep: a diagonal band whose position steps every 2 s.
      const sx = ((this.sweep + 0.5) / 4) * W;
      const g = ctx.createLinearGradient(sx - W * 0.25, 0, sx + W * 0.25, H);
      g.addColorStop(0, 'rgba(217,165,32,0)');
      g.addColorStop(0.5, 'rgba(217,165,32,0.18)');
      g.addColorStop(1, 'rgba(217,165,32,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = GOLD;
      fitText(ctx, zh, W / 2, H * 0.34, W * 0.8, H * 0.30, '900');
      ctx.fillStyle = '#f4f2ec';
      fitText(ctx, en, W / 2, H * 0.60, W * 0.7, H * 0.14, '800');
      ctx.fillStyle = 'rgba(244,242,236,0.75)';
      fitText(ctx, sub, W / 2, H * 0.78, W * 0.6, H * 0.08, '700');
      ctx.fillStyle = 'rgba(244,242,236,0.5)';
      fitText(ctx, legal, W / 2, H * 0.90, W * 0.9, H * 0.045, '500');
    }
    return sub + ' | ' + legal;
  }

  _paintLive(ctx, W, H, d) {
    const a = d.a || {}, b = d.b || {};
    const period = d.period || '';
    const clock = d.clock >= 0 ? d.clock : 0;
    const mm = Math.floor(Math.ceil(clock - 1e-6) / 60), ss = Math.ceil(clock - 1e-6) % 60;
    const clockText = mm + ':' + (ss < 10 ? '0' : '') + ss;
    if (ctx) {
      const top = H * 0.62;
      for (let side = 0; side < 2; side++) {
        const tm = side === 0 ? a : b;
        const x0 = side === 0 ? W * 0.03 : W * 0.67;
        ctx.fillStyle = tm.colour || (side === 0 ? '#6F263D' : '#CE1141');
        ctx.fillRect(x0, H * 0.08, W * 0.30, H * 0.06);
        ctx.fillStyle = '#ffffff';
        fitText(ctx, String(tm.abbr || ''), x0 + W * 0.15, H * 0.23, W * 0.28, H * 0.12, '800');
        fitText(ctx, String(tm.score !== undefined ? tm.score : 0), x0 + W * 0.15, H * 0.44, W * 0.28, H * 0.28, '900');
      }
      ctx.fillStyle = GOLD;
      fitText(ctx, period, W / 2, H * 0.20, W * 0.30, H * 0.10, '800');
      ctx.fillStyle = '#ffffff';
      fitText(ctx, clockText, W / 2, H * 0.42, W * 0.30, H * 0.28 * 0.6, '900');
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(W * 0.03, top, W * 0.94, 2);
      // Shot clock in a red box + leading scorers ticker.
      const shot = d.shotClock === null || d.shotClock === undefined ? '' : String(Math.max(0, Math.ceil(d.shotClock - 1e-6)));
      ctx.fillStyle = '#b3121f';
      ctx.fillRect(W * 0.04, H * 0.70, W * 0.14, H * 0.22);
      ctx.fillStyle = '#ffffff';
      fitText(ctx, shot, W * 0.11, H * 0.81, W * 0.12, H * 0.18, '900');
      ctx.fillStyle = '#e8e6df';
      fitText(ctx, this._ticker(d), W * 0.59, H * 0.81, W * 0.74, H * 0.11, '700');
    }
    return period + ' ' + clockText;
  }

  _ticker(d) {
    const L = d.leaders;
    if (!L || !L.length) return '';
    let s = '';
    for (let i = 0; i < L.length && i < 2; i++) {
      if (!L[i]) continue;
      const one = hasKey('jumbo.leader') ? t('jumbo.leader', { name: L[i].short, pts: L[i].pts }) : L[i].short + ' ' + L[i].pts + ' ' + tr('stats.pts');
      s += (s ? '  ·  ' : '') + one;
    }
    return s;
  }

  _paintEvent(ctx, W, H, d) {
    const key = 'jumbo.' + (d.kind || 'dunk');
    const big = tr(key);
    if (ctx) {
      ctx.fillStyle = d.colour || '#CE1141';
      ctx.fillRect(W * 0.02, H * 0.62, W * 0.96, H * 0.30);
      ctx.fillStyle = GOLD;
      fitText(ctx, big, W / 2, H * 0.32, W * 0.9, H * 0.40, '900');
      ctx.fillStyle = '#ffffff';
      const line = (d.number !== undefined && d.number !== null ? '#' + d.number + '  ' : '') + (d.name || '');
      fitText(ctx, line, W / 2, H * 0.77, W * 0.9, H * 0.16, '800');
    }
    return big;
  }

  _paintReplay(ctx, W, H, d) {
    const tag = tr('replay.tagFull', null, tr('replay.tag'));
    if (ctx) {
      ctx.fillStyle = GOLD;
      ctx.fillRect(0, H * 0.36, W, H * 0.04);
      fitText(ctx, tag, W / 2, H * 0.24, W * 0.8, H * 0.20, '900');
      ctx.fillStyle = '#ffffff';
      fitText(ctx, d.name || '', W / 2, H * 0.62, W * 0.8, H * 0.16, '800');
    }
    return tag;
  }

  _paintIntro(ctx, W, H, d) {
    const zh = d.nameZh || '', en = d.nameEn || '';
    const lang = getLang();
    if (ctx) {
      ctx.fillStyle = d.colour || '#1d2b4f';
      ctx.fillRect(0, 0, W * 0.30, H);
      ctx.fillStyle = '#ffffff';
      fitText(ctx, d.number !== undefined ? String(d.number) : '', W * 0.15, H * 0.45, W * 0.26, H * 0.5, '900');
      ctx.fillStyle = '#ffffff';
      fitText(ctx, lang === 'zh' ? zh : en, W * 0.64, H * 0.30, W * 0.62, H * 0.20, '900');
      ctx.fillStyle = 'rgba(244,242,236,0.75)';
      fitText(ctx, lang === 'zh' ? en : zh, W * 0.64, H * 0.50, W * 0.62, H * 0.11, '700');
      ctx.fillStyle = GOLD;
      const line = (d.ovr !== undefined ? 'OVR ' + d.ovr : '') + (d.height !== undefined ? '   ' + Number(d.height).toFixed(2) + ' m' : '');
      fitText(ctx, line, W * 0.64, H * 0.70, W * 0.62, H * 0.12, '800');
    }
    return lang === 'zh' ? zh : en;
  }

  _paintGameover(ctx, W, H, d) {
    const fin = tr('jumbo.final');
    const a = d.a || {}, b = d.b || {};
    if (ctx) {
      ctx.fillStyle = GOLD;
      fitText(ctx, fin, W / 2, H * 0.17, W * 0.6, H * 0.18, '900');
      ctx.fillStyle = '#ffffff';
      fitText(ctx, (a.abbr || '') + '  ' + (a.score !== undefined ? a.score : '') + ' - ' + (b.score !== undefined ? b.score : '') + '  ' + (b.abbr || ''), W / 2, H * 0.47, W * 0.9, H * 0.26, '900');
      ctx.fillStyle = GOLD;
      fitText(ctx, d.mvp ? tr('over.mvp', null, 'MVP') + '  ' + d.mvp : '', W / 2, H * 0.78, W * 0.8, H * 0.14, '800');
    }
    return fin;
  }
}

// Merge geometries into one (position, normal, uv, color). [geo, textured]: textured parts are white with their
// own UVs, others are #0c0d10 with the dark border UV.
function mergeTextured(list, darkHex) {
  const dark = new THREE.Color(darkHex || 0x0c0d10);
  const p = [], n = [], uv = [], c = [], idx = [];
  for (let k = 0; k < list.length; k++) {
    const g = list[k][0], textured = list[k][1];
    const o = p.length / 3;
    const pa = g.getAttribute('position'), na = g.getAttribute('normal'), ua = g.getAttribute('uv');
    for (let i = 0; i < pa.count; i++) {
      p.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      n.push(na.getX(i), na.getY(i), na.getZ(i));
      if (textured) { uv.push(ua.getX(i), ua.getY(i)); c.push(1, 1, 1); }
      else { uv.push(DARK_UV, DARK_UV); c.push(dark.r, dark.g, dark.b); }
    }
    const ix = g.index;
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + o);
    else for (let i = 0; i < pa.count; i++) idx.push(i + o);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

/** Centre-hung cube 5.6 × 3.2 × 5.6 at (0, 15.5, 0): four sides show the jumbotron texture, top/bottom dark. */
function buildCentreHung(material) {
  const g = new THREE.BoxGeometry(5.6, 3.2, 5.6);
  g.translate(0, 15.5, 0);
  const uv = g.getAttribute('uv');
  const col = new Float32Array(uv.count * 3).fill(1);
  const dark = new THREE.Color(0x0c0d10);
  // BoxGeometry face order: +x, −x, +y, −y, +z, −z (4 vertices each).
  for (let i = 8; i < 16; i++) { uv.setXY(i, DARK_UV, DARK_UV); col[i * 3] = dark.r; col[i * 3 + 1] = dark.g; col[i * 3 + 2] = dark.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'centreHung';
  return mesh;
}

/** 16 instanced ceiling fixtures at y 26 (x ∈ {−12, −4, 4, 12}, z ∈ {−20, −10, 0, 10}), #fff6e8 × 2.2. */
function buildFixtures() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false, fog: false });
  mat.color.multiplyScalar(2.2);
  mat.name = 'fixtures';
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.35, 0.7), mat, 16);
  mesh.name = 'fixtures';
  const m = new THREE.Matrix4();
  const xs = [-12, -4, 4, 12], zs = [-20, -10, 0, 10];
  let k = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { m.makeTranslation(xs[i], 26, zs[j]); mesh.setMatrixAt(k++, m); }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Build the arena.
 * @param {THREE.Scene|null} scene  receives the meshes and `fog = Fog(0x0b0d14, 34, 90)`
 * @param {object} quality
 * @param {Rng} [rng]  cosmetic Rng (accepted for API symmetry with PR §10; the arena geometry is deterministic)
 * @returns {{dome, stands, led:LedBoards, jumbo:Jumbotron, jumbotron:Jumbotron, centreHung, fixtures, update, setTier, refresh, dispose}}
 */
// eslint-disable-next-line no-unused-vars
export function buildArena(scene, quality, rng) {
  const q = quality || { tier: 'low' };
  const tier = q.tier || q.loadTier || 'low';
  const T = TIERS[tier];
  const dome = buildDome();
  const stands = buildStands();
  const led = new LedBoards(q);
  const jumbo = new Jumbotron(q);
  const centreHung = buildCentreHung(jumbo.material);
  centreHung.visible = T.centreHung;
  const fixtures = buildFixtures();
  fixtures.visible = T.fixtures;
  if (scene) {
    scene.add(dome, stands, led.mesh, jumbo.mesh, centreHung, fixtures);
    scene.fog = new THREE.Fog(0x0b0d14, 34, 90);
  }
  const arena = {
    dome, stands, led, jumbo, jumbotron: jumbo, centreHung, fixtures,
    /** Per frame: LED scroll + timers, jumbotron timers; repaints are rate limited. */
    update(dt) { led.update(dt); jumbo.update(dt); },
    /** Runtime tier change: ribbon / centre-hung / fixtures visibility, jumbotron repaint rate. */
    setTier(t2) {
      const S = TIERS[t2] || T;
      led.setRibbon(S.ribbon);
      centreHung.visible = S.centreHung;
      fixtures.visible = S.fixtures;
      jumbo.setTier(t2);
    },
    /** Language change: repaint LED and jumbotron. */
    refresh() { led.refresh(); jumbo.refresh(); },
    dispose() {
      const list = [dome, stands, led.mesh, jumbo.mesh, centreHung, fixtures];
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
      }
      dome.material.dispose(); stands.material.dispose(); led.material.dispose(); jumbo.material.dispose(); fixtures.material.dispose();
      led.texture.dispose(); jumbo.texture.dispose();
      if (scene && scene.fog) scene.fog = null;
    },
  };
  return arena;
}
