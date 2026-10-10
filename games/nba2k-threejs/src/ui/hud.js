/**
 * ui/hud.js - the v2 in-game HUD (spec v2 section 6.5.7; replaces v1 src/hud.js).
 *
 * Elements (index.html, inside #hud): #scoreBug (grid: colour bar | abbr | score | period over clock | score | abbr |
 * colour bar) with #shotClock, #possA/#possB possession bars, #caption (driven by ui/captions.js), #banner, #meter
 * (#meterBand, #meterFill, #meterPts, #meterFlash), and the world-anchored widgets of ui/indicators.js (#offA/#offB/#offC,
 * #passTarget, #nameTag).
 *
 * API
 *   new HUD(doc, { match, captions? })      match: shared MatchView (ui/present.js)
 *   hud.bind({ game })                        game.meter (frozen-shape object, 1.4) and game.passPreview() are read
 *   hud.update(frameDt, world, director)      once per frame AFTER director.update() (R#4: this frame's matrices)
 *   hud.banner(key, params, ms)               "+3 name" style when params.name is given; key null hides it
 *   hud.bannerState() -> {key, params, ms}|null   stash on pause, re-issue after the resume countdown (R#22)
 *   hud.captions                              the Captions instance (router: captions.push / clear)
 *   hud.resize()                              re-measure viewport and safe-area insets (also on window resize)
 *   hud.refreshLang()                         period label, team abbreviations, banner, caption, meter flash (R#20)
 *   hud.meterAnchor = (player, out) => void   optional: world point the meter hangs off (default: chest-head midpoint
 *                                             = head anchor lowered by 0.105 x height); flow.js may supply the real
 *                                             chest/head render sockets so B61 measures the same point
 *   hud.indicators.headAnchor = (player, out) => void   optional override of the head point (name tag, chevron)
 *
 * Per-frame work is allocation-free: every number shown comes from string tables built once (scores, clocks, shot
 * clock, percentages) and DOM writes happen only when a value changes (H10).
 */
import { t, pick, onLangChange } from '../i18n.js';
import { Captions } from './captions.js';
import { Indicators, projectPoint, playerId, playerHeight, px } from './indicators.js';

const QUARTERS = 4;
const SHOT_WARN = 5;          // red below 5 s
const SHOT_PULSE = 3;         // pulsing below 3 s
const METER_DX = 40;          // meter centre offset from the chest-head midpoint (px)
const METER_DX_FLIP = -52;    // flipped offset when the anchor is within 80 px of the right edge
const METER_DY = -40;
const METER_FLIP_MARGIN = 80;
const BANNER_DEFAULT_MS = 1500;

const SCORE_STR = [];
for (let i = 0; i < 300; i++) SCORE_STR.push(String(i));
const CLOCK_STR = [];         // 'mm:ss' for 0 .. 3600 s
for (let s = 0; s <= 3600; s++) {
  const m = Math.floor(s / 60), r = s % 60;
  CLOCK_STR.push((m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r);
}
const PCT_STR = [];           // '0%' .. '125%' for the meter fill (fill runs to 1.25 of the bar)
for (let i = 0; i <= 125; i++) PCT_STR.push(i + '%');

function scoreStr(n) {
  const i = n | 0;
  return i >= 0 && i < SCORE_STR.length ? SCORE_STR[i] : String(i);
}

function clockStr(sec) {
  let s = Math.ceil(sec - 1e-4);
  if (!(s > 0)) s = 0;
  if (s > 3600) s = 3600;
  return CLOCK_STR[s];
}

const S_HEAD = { x: 0, y: 0, z: 0 };
const S_NDC = { x: 0, y: 0, z: 0 };

/** The controlled defender's assignment: player.matchup / mark / assignment / guarding (object or legend id). */
function assignmentOf(world, me) {
  if (!me) return null;
  const a = me.matchup || me.mark || me.assignment || me.guarding || null;
  if (!a) return null;
  if (typeof a === 'object') return a;
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) if (playerId(ps[i]) === a) return ps[i];
  return null;
}

export class HUD {
  /**
   * @param {Document} doc
   * @param {{match: object, captions?: Captions}} opts  match = the shared MatchView of ui/present.js
   */
  constructor(doc, opts) {
    const o = opts || {};
    this.doc = doc || (typeof document !== 'undefined' ? document : null);
    this.win = this.doc && this.doc.defaultView ? this.doc.defaultView : null;
    this.match = o.match;
    this.game = null;
    this.els = {};
    const ids = ['app', 'hud', 'scoreBug', 'chipA', 'chipB', 'barA', 'barB', 'abbrA', 'abbrB', 'scoreA', 'scoreB', 'possA', 'possB',
      'period', 'gameClock', 'shotClock', 'caption', 'banner', 'bannerVal', 'bannerName', 'meter', 'meterBand', 'meterFill',
      'meterPts', 'meterFlash', 'safeProbe'];
    for (let i = 0; i < ids.length; i++) this.els[ids[i]] = this.doc ? this.doc.getElementById(ids[i]) : null;
    this.captions = o.captions || new Captions(this.els.caption);
    this.indicators = new Indicators(this.doc, this.match);
    this.view = { w: 1, h: 1, sl: 0, sr: 0, st: 0, sb: 0, portrait: false };
    this.meterAnchor = null;
    this._ind = { receiverId: null, meterActive: false, bannerOn: false, userOffense: true, userHasBall: false, assignment: null };
    // caches
    this._ver = -1; this._q = -1; this._gs = ''; this._ss = ''; this._sA = ''; this._sB = '';
    this._possA = false; this._possB = false; this._warn = false; this._pulse = false;
    this._banner = null; this._bannerT = 0;
    this._meterOn = false; this._mx = -9999; this._my = -9999; this._fillI = -1; this._lo = -1; this._hi = -1;
    this._pts = 0; this._flash = null; this._flashOn = false;
    this._listeners = [];
    if (this.win) {
      const onResize = () => this.resize();
      this.win.addEventListener('resize', onResize);
      this._listeners.push([this.win, 'resize', onResize]);
      if (this.win.visualViewport) {
        this.win.visualViewport.addEventListener('resize', onResize);
        this._listeners.push([this.win.visualViewport, 'resize', onResize]);
      }
    }
    this._unsubLang = onLangChange(() => this.refreshLang());
    this.resize();
  }

  bind(o) {
    if (o && o.game !== undefined) this.game = o.game;
    return this;
  }

  /** Re-measure the viewport and the resolved safe-area insets (probe element padded with the --safe-* variables). */
  resize() {
    const v = this.view, app = this.els.app;
    let w = app && app.clientWidth ? app.clientWidth : 0, h = app && app.clientHeight ? app.clientHeight : 0;
    if (!(w > 0 && h > 0) && this.win) { w = this.win.innerWidth; h = this.win.innerHeight; }
    v.w = w > 0 ? w : 1; v.h = h > 0 ? h : 1;
    v.portrait = v.h > v.w;
    const probe = this.els.safeProbe;
    if (probe && this.win) {
      const cs = this.win.getComputedStyle(probe);
      v.st = parseFloat(cs.paddingTop) || 0;
      v.sr = parseFloat(cs.paddingRight) || 0;
      v.sb = parseFloat(cs.paddingBottom) || 0;
      v.sl = parseFloat(cs.paddingLeft) || 0;
    }
    this._mx = -9999;   // force a meter re-position
  }

  _set(el, str) {
    if (el && el.textContent !== str) el.textContent = str;
  }

  // ---- banner ----

  banner(key, params, ms) {
    if (!key) {
      this._banner = null; this._bannerT = 0;
      if (this.els.banner) this.els.banner.classList.remove('show');
      return;
    }
    const p = params ? Object.assign({}, params) : null;
    this._banner = { key, params: p };
    this._bannerT = (typeof ms === 'number' && ms > 0 ? ms : BANNER_DEFAULT_MS) / 1000;
    this._renderBanner();
    if (this.els.banner) this.els.banner.classList.add('show');
  }

  /** Current banner {key, params, ms remaining} (null when none) - stashed by pause, re-issued after the countdown. */
  bannerState() {
    if (!this._banner || this._bannerT <= 0) return null;
    return { key: this._banner.key, params: this._banner.params ? Object.assign({}, this._banner.params) : null, ms: Math.round(this._bannerT * 1000) };
  }

  _renderBanner() {
    const b = this._banner;
    if (!b) return;
    const hasName = !!b.params && b.params.name !== undefined && b.params.name !== null;
    this._set(this.els.bannerVal, t(b.key, b.params || undefined));
    this._set(this.els.bannerName, hasName ? String(pick(b.params.name)) : '');
    if (this.els.bannerName) this.els.bannerName.classList.toggle('hidden', !hasName);
  }

  // ---- per frame ----

  /**
   * @param {number} frameDt seconds
   * @param {object} world   game world (players, score, offense, user, controlled, quarter, gameClock, shotClock, time)
   * @param {object} director WP7 Director ({camera}) or a THREE camera
   */
  update(frameDt, world, director) {
    const dt = typeof frameDt === 'number' && frameDt > 0 ? (frameDt < 0.25 ? frameDt : 0.25) : 0;
    this.captions.update(dt, world && typeof world.time === 'number' ? world.time : undefined);
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) { this._bannerT = 0; this._banner = null; if (this.els.banner) this.els.banner.classList.remove('show'); }
    }
    if (!world) return;
    const g = this.game || world.game || null;
    this._bug(world, g);
    const camera = director && director.camera ? director.camera : (director && director.isCamera ? director : null);
    const meter = g && g.meter ? g.meter : null;
    const meterActive = this._meter(world, meter, camera);
    const me = world.controlled || world.userPlayer || null;
    const ind = this._ind;
    ind.meterActive = meterActive;
    ind.bannerOn = this._bannerT > 0;
    ind.userOffense = typeof world.offense === 'number' && typeof world.user === 'number' ? world.offense === world.user : !!(me && me.offense);
    ind.userHasBall = !!(me && me.hasBall);
    ind.receiverId = ind.userOffense && ind.userHasBall && g && typeof g.passPreview === 'function' ? g.passPreview() : null;
    ind.assignment = ind.userOffense ? null : assignmentOf(world, me);
    if (camera) this.indicators.update(world, camera, this.view, ind);
    else this.indicators.hideAll();
  }

  _bug(w, g) {
    const e = this.els, m = this.match;
    if (m && this._ver !== m.version) {
      this._ver = m.version;
      for (let i = 0; i < 2; i++) {
        const st = m.style(i);
        const chip = i === 0 ? e.chipA : e.chipB, bar = i === 0 ? e.barA : e.barB;
        if (chip) { chip.style.background = st.bg; chip.style.color = st.text; }
        if (bar) bar.style.background = st.accent;
        this._set(i === 0 ? e.abbrA : e.abbrB, m.teamAbbr(i));
      }
      this._q = -1;
    }
    const score = w.score || (g && g.score) || null;
    const sa = scoreStr(score ? score[0] : 0), sb = scoreStr(score ? score[1] : 0);
    if (sa !== this._sA) { this._sA = sa; this._set(e.scoreA, sa); }
    if (sb !== this._sB) { this._sB = sb; this._set(e.scoreB, sb); }
    const live = w.state === 'CHECK' || w.state === 'LIVE' || w.state === 'DEAD';
    const pa = live && w.offense === 0, pb = live && w.offense === 1;
    if (pa !== this._possA && e.possA) { this._possA = pa; e.possA.classList.toggle('on', pa); }
    if (pb !== this._possB && e.possB) { this._possB = pb; e.possB.classList.toggle('on', pb); }
    const q = typeof w.quarter === 'number' && w.quarter > 0 ? w.quarter : 1;
    if (q !== this._q) {
      this._q = q;
      let label;
      if (q <= QUARTERS) label = t('hud.q', { n: q });
      else if (q === QUARTERS + 1) label = t('hud.ot');
      else label = t('hud.ot2', { n: q - QUARTERS });
      this._set(e.period, label);
    }
    const gs = clockStr(typeof w.gameClock === 'number' ? w.gameClock : 0);
    if (gs !== this._gs) { this._gs = gs; this._set(e.gameClock, gs); }
    const shot = typeof w.shotClock === 'number' ? w.shotClock : 14;
    const ss = scoreStr(Math.max(0, Math.ceil(shot - 1e-4)));
    if (ss !== this._ss) { this._ss = ss; this._set(e.shotClock, ss); }
    const warn = shot < SHOT_WARN, pulse = shot < SHOT_PULSE && w.state === 'LIVE';
    if (warn !== this._warn && e.shotClock) { this._warn = warn; e.shotClock.classList.toggle('warn', warn); }
    if (pulse !== this._pulse && e.shotClock) { this._pulse = pulse; e.shotClock.classList.toggle('pulse', pulse); }
  }

  /** Shot meter from game.meter; returns true while the meter (or its result flash) is on screen. */
  _meter(w, meter, camera) {
    const e = this.els;
    const flashing = !!meter && !!meter.flash && meter.flashT > 0;
    const want = !!meter && (meter.active || flashing) && !!camera;
    let shooter = null;
    if (want) {
      const ps = w.players;
      for (let i = 0; ps && i < ps.length; i++) if (playerId(ps[i]) === meter.shooterId) { shooter = ps[i]; break; }
    }
    let on = want && !!shooter;
    if (on) {
      if (this.meterAnchor) this.meterAnchor(shooter, S_HEAD);
      else {
        // Chest-head midpoint: the head anchor lowered by half of the head-to-chest span (0.21 x height).
        this.indicators.anchor(shooter, S_HEAD);
        S_HEAD.y -= 0.105 * playerHeight(shooter, this.match);
      }
      const wv = projectPoint(S_NDC, camera, S_HEAD.x, S_HEAD.y, S_HEAD.z);
      if (wv <= 0) on = false;
      else {
        const ax = (S_NDC.x * 0.5 + 0.5) * this.view.w, ay = (0.5 - S_NDC.y * 0.5) * this.view.h;
        const cx = Math.round(ax + (ax > this.view.w - METER_FLIP_MARGIN ? METER_DX_FLIP : METER_DX));
        const cy = Math.round(ay + METER_DY);
        if (cx !== this._mx && e.meter) { this._mx = cx; e.meter.style.left = px(cx); }
        if (cy !== this._my && e.meter) { this._my = cy; e.meter.style.top = px(cy); }
        let fi = Math.round((meter.fill > 0 ? meter.fill : 0) * 100);
        if (fi > 125) fi = 125;
        if (fi !== this._fillI && e.meterFill) { this._fillI = fi; e.meterFill.style.height = PCT_STR[fi]; }
        if ((meter.greenLo !== this._lo || meter.greenHi !== this._hi) && e.meterBand) {
          this._lo = meter.greenLo; this._hi = meter.greenHi;
          e.meterBand.style.bottom = (this._lo * 100).toFixed(1) + '%';
          e.meterBand.style.height = (Math.max(0, this._hi - this._lo) * 100).toFixed(1) + '%';
        }
        const pts = meter.points === 3 ? 3 : 2;
        if (pts !== this._pts && e.meterPts) {
          this._pts = pts;
          e.meterPts.textContent = t(pts === 3 ? 'meter.three' : 'meter.two');
          e.meterPts.classList.toggle('three', pts === 3);
        }
        const fl = flashing ? meter.flash : null;
        if (fl !== this._flash && e.meterFlash) {
          this._flash = fl;
          e.meterFlash.classList.remove('perfect', 'early', 'late', 'show');
          if (fl) { e.meterFlash.textContent = t('meter.' + fl); e.meterFlash.classList.add(fl, 'show'); }
        }
      }
    }
    if (on !== this._meterOn && e.meter) {
      this._meterOn = on;
      e.meter.classList.toggle('visible', on);
      if (e.hud) e.hud.classList.toggle('meterOn', on);   // CSS hides first-time tips while the meter shows (GP 9.5)
    }
    if (!on && this._flash !== null) { this._flash = null; if (e.meterFlash) e.meterFlash.classList.remove('show'); }
    return on;
  }

  refreshLang() {
    this._ver = -1;
    this._q = -1;
    this._pts = 0;
    if (this._flash && this.els.meterFlash) this.els.meterFlash.textContent = t('meter.' + this._flash);
    if (this._banner) this._renderBanner();
    this.captions.refreshLang();
  }

  dispose() {
    for (let i = 0; i < this._listeners.length; i++) {
      const l = this._listeners[i];
      l[0].removeEventListener(l[1], l[2]);
    }
    this._listeners.length = 0;
    if (this._unsubLang) this._unsubLang();
  }
}
