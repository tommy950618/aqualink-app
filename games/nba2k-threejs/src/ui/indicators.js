/**
 * ui/indicators.js - world-anchored HUD widgets (spec v2 sections 6.4.3 and 6.5.7): off-screen teammate indicators,
 * the pass-target chevron and the controlled player's name tag with its stamina bar; plus the allocation-free
 * projection helpers the HUD shares.
 *
 * Exports
 *   px(n)                  cached 'Npx' string for an integer (no per-frame string building, H10)
 *   projectPoint(out, camera, x, y, z) -> w   NDC of a world point with this frame's camera matrices (the projection
 *                          matrix already holds a portrait setViewOffset, so NDC is "computed with the view offset")
 *   playerId(p), playerTeam(p), playerX(p), playerZ(p)   tolerant accessors for the v2 Player
 *   headAnchor(p, match, out)   world head point: Character.headWorld() when present, else feet + 0.93 x barefoot height
 *   class Indicators       update(world, camera, view, opts) once per frame after the director (R#4 ordering)
 *
 * Indicator rules (6.4.3): for each user teammate (and, on defence, the user's assignment): when neither the feet nor
 * the head projects inside |x|, |y| <= 0.98 NDC, a 30 px circle sits at the screen edge on the ray from the screen
 * centre, inset 14 px + safe insets, its centre clamped vertically to [56 + safe-top, H - 200 - safe-bottom] (portrait)
 * or [56, H - 90] (landscape); content = jersey number in kit colours (initials when a teammate shares the number);
 * 2 px white ring on the predicted receiver; a small triangle points outward.
 * Pass chevron: 16 x 10 px, 0.25 m above the predicted receiver's head while the user holds the ball (not in windups).
 * Name tag: head + 0.32 m, "#24 name", team UI colour at 85 %, stamina bar (36 x 3) while stamina < 0.98 (red < 0.25),
 * pop 1.25 -> 1.0 in 0.25 s on control change, hidden off-screen and while the meter shows.
 */
import * as THREE from '../../vendor/three.module.js';

const PX_MIN = -2048;
const PX_MAX = 8192;
const PX_TABLE = [];
for (let i = PX_MIN; i <= PX_MAX; i++) PX_TABLE.push(i + 'px');

/** Cached CSS pixel string for an integer value (clamped to the table range). */
export function px(n) {
  let i = n | 0;
  if (i < PX_MIN) i = PX_MIN; else if (i > PX_MAX) i = PX_MAX;
  return PX_TABLE[i - PX_MIN];
}

const ROT_STEPS = 72;                       // 5 degree steps for the outward triangle
const ROT_TABLE = [];
for (let i = 0; i < ROT_STEPS; i++) ROT_TABLE.push('rotate(' + (i * 360 / ROT_STEPS) + 'deg)');
const SCALE_TABLE = [];                     // stamina bar fills, 0..100 %
for (let i = 0; i <= 100; i++) SCALE_TABLE.push('scaleX(' + (i / 100) + ')');

/** Cached 'scaleX(f)' string for f in [0, 1] (1 % steps). */
export function scaleXStr(f) {
  const i = Math.round((f < 0 ? 0 : f > 1 ? 1 : f) * 100);
  return SCALE_TABLE[i];
}

/**
 * Project a world point with the camera's current matrices. Writes NDC into out.x / out.y (out.z = NDC depth) and
 * returns clip w (<= 0 means the point is behind the camera). Pure arithmetic on the matrix elements: v = P * V * p.
 */
export function projectPoint(out, camera, x, y, z) {
  const v = camera.matrixWorldInverse.elements;
  const p = camera.projectionMatrix.elements;
  // view-space point (column-major 4x4)
  const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
  const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
  const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
  const cx = p[0] * vx + p[4] * vy + p[8] * vz + p[12];
  const cy = p[1] * vx + p[5] * vy + p[9] * vz + p[13];
  const cz = p[2] * vx + p[6] * vy + p[10] * vz + p[14];
  const cw = p[3] * vx + p[7] * vy + p[11] * vz + p[15];
  const iw = Math.abs(cw) > 1e-9 ? 1 / cw : 1e9;
  out.x = cx * iw;
  out.y = cy * iw;
  out.z = cz * iw;
  return cw;
}

export function playerId(p) {
  if (!p) return null;
  if (typeof p.id === 'string') return p.id;
  if (typeof p.legendId === 'string') return p.legendId;
  if (p.legend && typeof p.legend.id === 'string') return p.legend.id;
  if (p.data && typeof p.data.id === 'string') return p.data.id;
  return null;
}

export function playerTeam(p) {
  if (!p) return -1;
  if (typeof p.team === 'number') return p.team;
  if (typeof p.teamIdx === 'number') return p.teamIdx;
  return -1;
}

export function playerX(p) {
  return p.pos ? p.pos.x : (typeof p.x === 'number' ? p.x : 0);
}

export function playerZ(p) {
  return p.pos ? p.pos.z : (typeof p.z === 'number' ? p.z : 0);
}

const HEAD_V3 = new THREE.Vector3();

/** Barefoot height of a player in metres (legend stats; 2.0 when unknown). */
export function playerHeight(p, match) {
  const l = match ? match.legend(playerId(p)) : null;
  if (l && l.stats) return l.stats.barefootM || l.stats.heightM || 2.0;
  return 2.0;
}

/** World head point of a player into out {x, y, z}. Character.headWorld() when present, else 0.93 x height + jump. */
export function headAnchor(p, match, out) {
  const c = p.character || null;
  if (c && typeof c.headWorld === 'function' && c.visible !== false) {
    c.headWorld(HEAD_V3);
    out.x = HEAD_V3.x; out.y = HEAD_V3.y; out.z = HEAD_V3.z;
    return out;
  }
  out.x = playerX(p);
  out.z = playerZ(p);
  out.y = (typeof p.jumpY === 'number' ? p.jumpY : 0) + 0.93 * playerHeight(p, match);
  return out;
}

/** Relative luminance (Rec. 709 weights on sRGB bytes) of a #rrggbb colour, 0..255. */
function luma(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/** The brighter of a team's chip background and text colour (pass chevron over the dark arena). */
function brighter(st) {
  return luma(st.bg) >= luma(st.text) ? st.bg : st.text;
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

const NDC_IN = 0.98;
const IND_R = 15;           // 30 px circle
const IND_INSET = 14;
const TAG_LIFT = 0.32;      // m above the head socket
const CHEVRON_LIFT = 0.25;  // m above the receiver's head

const S_FEET = { x: 0, y: 0, z: 0 };
const S_HEAD = { x: 0, y: 0, z: 0 };
const S_W = { x: 0, y: 0, z: 0 };

function makeSlot() {
  return { el: null, num: null, tri: null, id: null, ver: -1, on: false, recv: false, x: -1, y: -1, rot: -1 };
}

export class Indicators {
  /**
   * @param {Document} doc
   * @param {object} match  MatchView of ui/present.js
   */
  constructor(doc, match) {
    this.doc = doc;
    this.match = match;
    this.slots = [makeSlot(), makeSlot(), makeSlot()];
    const ids = ['offA', 'offB', 'offC'];
    for (let i = 0; i < 3; i++) {
      const s = this.slots[i];
      s.el = doc ? doc.getElementById(ids[i]) : null;
      if (s.el) { s.num = s.el.querySelector('.num'); s.tri = s.el.querySelector('.tri'); }
    }
    this.chev = doc ? doc.getElementById('passTarget') : null;
    this._chevOn = false; this._chevX = -1; this._chevY = -1; this._chevVer = -1;
    this.tag = doc ? doc.getElementById('nameTag') : null;
    this.tagText = doc ? doc.getElementById('nameTagText') : null;
    this.stam = doc ? doc.getElementById('nameStam') : null;
    this.stamFill = doc ? doc.getElementById('nameStamFill') : null;
    this._tagOn = false; this._tagX = -1; this._tagY = -1; this._tagId = null; this._tagVer = -1;
    this._stamOn = false; this._stamPct = -1; this._stamLow = false;
    this._targets = [null, null, null];
    this.headAnchor = null;   // optional (player, out) => void override of the head point
  }

  /** Head point of a player (override hook first, else headAnchor() of this module). */
  anchor(p, out) {
    if (this.headAnchor) this.headAnchor(p, out);
    else headAnchor(p, this.match, out);
    return out;
  }

  _slotShow(s, on) {
    if (s.on === on || !s.el) return;
    s.on = on;
    s.el.classList.toggle('on', on);
  }

  hideAll() {
    for (let i = 0; i < 3; i++) this._slotShow(this.slots[i], false);
    if (this._chevOn && this.chev) { this._chevOn = false; this.chev.classList.remove('on'); }
    this._tagShow(false);
  }

  _tagShow(on) {
    if (this._tagOn === on || !this.tag) return;
    this._tagOn = on;
    this.tag.classList.toggle('on', on);
  }

  /**
   * @param {object} world   game world {players[], controlled, offense, user}
   * @param {THREE.Camera} camera  this frame's camera (matrices updated by the director)
   * @param {{w:number,h:number,sl:number,sr:number,st:number,sb:number,portrait:boolean}} view
   * @param {{receiverId:string|null, meterActive:boolean, bannerOn:boolean, userOffense:boolean, userHasBall:boolean, assignment:object|null}} o
   */
  update(world, camera, view, o) {
    const players = world && world.players;
    const me = world ? world.controlled || world.userPlayer || null : null;
    if (!players || !camera || !me) { this.hideAll(); return; }
    const myTeam = playerTeam(me);
    const myId = playerId(me);
    // Targets: the two teammates, plus the defensive assignment when the user defends.
    let n = 0;
    for (let i = 0; i < players.length && n < 2; i++) {
      const p = players[i];
      if (p !== me && playerTeam(p) === myTeam) this._targets[n++] = p;
    }
    while (n < 2) this._targets[n++] = null;
    this._targets[2] = !o.userOffense ? o.assignment || null : null;
    for (let i = 0; i < 3; i++) this._updateSlot(this.slots[i], this._targets[i], camera, view, o.receiverId);
    this._updateChevron(players, camera, view, o);
    // The name tag also yields to a centre banner ("+3 name", period banners) so the two never stack.
    this._updateTag(me, myId, camera, view, o.meterActive || !!o.bannerOn);
  }

  _updateSlot(s, p, camera, view, receiverId) {
    if (!p) { this._slotShow(s, false); return; }
    const m = this.match;
    const x = playerX(p), z = playerZ(p);
    const wf = projectPoint(S_FEET, camera, x, 0, z);
    this.anchor(p, S_W);
    const wh = projectPoint(S_HEAD, camera, S_W.x, S_W.y, S_W.z);
    const feetIn = wf > 0 && Math.abs(S_FEET.x) <= NDC_IN && Math.abs(S_FEET.y) <= NDC_IN;
    const headIn = wh > 0 && Math.abs(S_HEAD.x) <= NDC_IN && Math.abs(S_HEAD.y) <= NDC_IN;
    if (feetIn || headIn) { this._slotShow(s, false); return; }
    // Direction from the screen centre toward the player's mid point (pixels, y down). A point behind the camera
    // projects mirrored, so its direction is flipped.
    let nx = 0.5 * (S_FEET.x + S_HEAD.x), ny = 0.5 * (S_FEET.y + S_HEAD.y);
    if (wf <= 0 && wh <= 0) { nx = -nx; ny = -ny; }
    let dx = nx * view.w * 0.5, dy = -ny * view.h * 0.5;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
    const cx = view.w * 0.5, cy = view.h * 0.5;
    const left = IND_INSET + IND_R + view.sl, right = view.w - IND_INSET - IND_R - view.sr;
    const top = IND_INSET + IND_R + view.st, bottom = view.h - IND_INSET - IND_R - view.sb;
    // Scale the ray so it touches the inset rectangle: t = min over the axes of half-extent / |component|.
    let tt = Infinity;
    if (dx > 0) tt = Math.min(tt, (right - cx) / dx); else if (dx < 0) tt = Math.min(tt, (left - cx) / dx);
    if (dy > 0) tt = Math.min(tt, (bottom - cy) / dy); else if (dy < 0) tt = Math.min(tt, (top - cy) / dy);
    let ex = cx + dx * tt, ey = cy + dy * tt;
    const yMin = 56 + view.st;
    const yMax = view.portrait ? view.h - 200 - view.sb : view.h - 90;
    if (ey < yMin) ey = yMin; else if (ey > yMax) ey = Math.max(yMin, yMax);
    const id = playerId(p);
    if (s.id !== id || s.ver !== m.version) {
      s.id = id; s.ver = m.version;
      const c = m.kitColours(id);
      if (s.num) s.num.textContent = m.indicatorLabel(id);
      s.el.style.background = c.bg;
      s.el.style.color = c.fg;
    }
    const recv = !!receiverId && receiverId === id;
    if (recv !== s.recv) { s.recv = recv; s.el.classList.toggle('recv', recv); }
    const ix = Math.round(ex), iy = Math.round(ey);
    if (ix !== s.x) { s.x = ix; s.el.style.left = px(ix - IND_R); }
    if (iy !== s.y) { s.y = iy; s.el.style.top = px(iy - IND_R); }
    // Outward angle (degrees, y down) quantised to the 5 degree table.
    let deg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    const ri = Math.round(deg / (360 / ROT_STEPS)) % ROT_STEPS;
    if (ri !== s.rot && s.tri) { s.rot = ri; s.tri.style.transform = ROT_TABLE[ri]; }
    this._slotShow(s, true);
  }

  _updateChevron(players, camera, view, o) {
    const ch = this.chev;
    if (!ch) return;
    let target = null;
    if (o.userHasBall && !o.meterActive && o.receiverId) {
      for (let i = 0; i < players.length; i++) if (playerId(players[i]) === o.receiverId) { target = players[i]; break; }
    }
    let on = false;
    if (target) {
      this.anchor(target, S_W);
      const w = projectPoint(S_HEAD, camera, S_W.x, S_W.y + CHEVRON_LIFT, S_W.z);
      if (w > 0 && Math.abs(S_HEAD.x) <= 1 && Math.abs(S_HEAD.y) <= 1) {
        on = true;
        const ix = Math.round((S_HEAD.x * 0.5 + 0.5) * view.w), iy = Math.round((0.5 - S_HEAD.y * 0.5) * view.h);
        if (ix !== this._chevX) { this._chevX = ix; ch.style.left = px(ix); }
        if (iy !== this._chevY) { this._chevY = iy; ch.style.top = px(iy); }
        if (this._chevVer !== this.match.version) {
          this._chevVer = this.match.version;
          const team = this.match.teamOf(o.receiverId);
          ch.style.color = team >= 0 ? brighter(this.match.style(team)) : '#ffffff';
        }
      }
    }
    if (on !== this._chevOn) { this._chevOn = on; ch.classList.toggle('on', on); }
  }

  _updateTag(me, id, camera, view, meterActive) {
    const tag = this.tag;
    if (!tag) return;
    const m = this.match;
    if (meterActive) { this._tagShow(false); return; }
    this.anchor(me, S_W);
    const w = projectPoint(S_HEAD, camera, S_W.x, S_W.y + TAG_LIFT, S_W.z);
    if (!(w > 0 && Math.abs(S_HEAD.x) <= 1 && Math.abs(S_HEAD.y) <= 1)) { this._tagShow(false); return; }
    if (id !== this._tagId || this._tagVer !== m.version) {
      const changed = id !== this._tagId;
      this._tagId = id; this._tagVer = m.version;
      const team = m.teamOf(id);
      const st = team >= 0 ? m.style(team) : null;
      if (this.tagText) this.tagText.textContent = '#' + m.number(id) + ' ' + m.short(id);
      tag.style.setProperty('--tagBg', st ? hexToRgba(st.bg, 0.85) : 'rgba(20,24,36,0.85)');
      tag.style.setProperty('--tagFg', st ? st.text : '#ffffff');
      if (changed) {
        // Pop 1.25 -> 1.0 over 0.25 s (CSS animation restarted on a control change).
        tag.classList.remove('pop');
        void tag.offsetWidth;
        tag.classList.add('pop');
      }
    }
    const ix = Math.round((S_HEAD.x * 0.5 + 0.5) * view.w), iy = Math.round((0.5 - S_HEAD.y * 0.5) * view.h);
    if (ix !== this._tagX) { this._tagX = ix; tag.style.left = px(ix); }
    if (iy !== this._tagY) { this._tagY = iy; tag.style.top = px(iy); }
    const st = typeof me.stamina === 'number' ? (me.stamina < 0 ? 0 : me.stamina > 1 ? 1 : me.stamina) : 1;
    const stamOn = st < 0.98;
    if (stamOn !== this._stamOn && this.stam) { this._stamOn = stamOn; this.stam.classList.toggle('on', stamOn); }
    if (stamOn && this.stamFill) {
      const pct = Math.round(st * 100);
      if (pct !== this._stamPct) { this._stamPct = pct; this.stamFill.style.transform = SCALE_TABLE[pct]; }
      const low = st < 0.25;
      if (low !== this._stamLow) { this._stamLow = low; this.stam.classList.toggle('low', low); }
    }
    this._tagShow(true);
  }
}
