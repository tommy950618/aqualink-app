// DOM HUD: score bug, clocks, captions, banner, shot meter, stamina bar and the menus (spec section 11).
// Every DOM write goes through a last-string cache so an unchanged frame touches nothing.
// Safe to import in Node: the document is only used inside the constructor and methods.
import { t, getLang, toggleLang, applyDom, onLangChange } from './i18n.js';
import { TEAMS } from './teams.js';
import { CLOCK } from './constants.js';
import { SCRATCH } from './math.js';

const CAPTION_T = CLOCK.CAPTION;          // 1.8 s visible
const CAPTION_FADE = CLOCK.CAPTION_FADE;  // 0.3 s fade
const FLASH_T = 0.6;                      // meter result flash
const BANNER_DEFAULT_MS = 1500;
const METER_OFFSET_X = 28;
const METER_H = 64;
const ROTATE_KEY = 'hoop.rotateHintSeen';
const PANELS = { main: 'menuMain', pause: 'menuPause', over: 'menuOver' };
const OVERLAYS = { halftime: 'halftime', ctxLost: 'ctxLost', nowebgl: 'nowebgl' };
const ZERO_SCORE = [0, 0];
const param = { n: 0 };                   // reused params object for hud.q / hud.ot2

function localize(v) {
  if (v && typeof v === 'object') { const l = getLang(); return v[l] !== undefined ? v[l] : (v.en !== undefined ? v.en : ''); }
  return v;
}

function localizeParams(params) {
  if (!params) return params;
  let out = null;
  for (const k in params) {
    const v = params[k];
    if (v && typeof v === 'object') { if (!out) out = Object.assign({}, params); out[k] = localize(v); }
  }
  return out || params;
}

function hexCss(n) {
  return '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// Team descriptor for a world.teams entry: a TEAMS row, a wrapper with .data, or an id string.
function teamInfo(entry, idx) {
  let src = entry;
  if (typeof src === 'string') src = TEAMS.find((tm) => tm.id === src) || null;
  else if (src && src.data && src.data.id) src = src.data;
  if (!src || !src.id) src = TEAMS[idx] || TEAMS[0];
  const base = TEAMS.find((tm) => tm.id === src.id) || TEAMS[idx] || TEAMS[0];
  return { id: src.id, jersey: src.jersey !== undefined ? src.jersey : base.jersey, name: src.name || base.name };
}

export class HUD {
  // root: document (or the #app element). callbacks: {onStart(options), onResume, onQuit, onRematch,
  // onSetting(key, value), onLang(lang), onSkip}.
  constructor(root, callbacks) {
    this.cb = callbacks || {};
    this.root = root || (typeof document !== 'undefined' ? document : null);
    this.doc = this.root && this.root.ownerDocument ? this.root.ownerDocument : this.root;
    this.win = this.doc && this.doc.defaultView ? this.doc.defaultView : (typeof window !== 'undefined' ? window : null);
    this.game = null; this.input = null; this.audio = null;
    this.options = { team: 0, difficulty: 'normal', quarter: CLOCK.DEFAULT_Q, lang: getLang(), sound: true };
    this.menu = null;
    this._last = new Map();
    this._queue = [];
    this._capT = -1; this._capFading = false; this._capCur = null;
    this._bannerT = 0;
    this._camera = null;
    this._meterWant = false; this._meterHold = 0; this._meterPct = -1; this._meterG = -1; this._meterOn = false;
    this._stamPct = -1; this._stamLow = false;
    this._teamsRef = null; this._teamInfo = [teamInfo(null, 0), teamInfo(null, 1)];
    this._chipColor = ['', ''];
    this._lastQ = -1; this._lastGame = -1; this._lastShot = -1; this._shotWarn = false;
    this._overData = null; this._halftimeScore = null;
    this._pressedBtn = null;
    this._listeners = [];
    this._unsubLang = null;
    this.els = {};
    if (this.doc) this._attach();
  }

  _id(id) {
    return typeof this.root.getElementById === 'function' ? this.root.getElementById(id) : this.root.querySelector('#' + id);
  }

  _all(sel) {
    return this.root.querySelectorAll(sel);
  }

  _on(target, type, fn, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, options);
    this._listeners.push([target, type, fn, options]);
  }

  _attach() {
    const ids = ['scoreBug', 'chipA', 'chipB', 'possA', 'possB', 'abbrA', 'abbrB', 'scoreA', 'scoreB', 'period', 'gameClock', 'shotClock',
      'caption', 'banner', 'meter', 'meterBand', 'meterFill', 'meterFlash', 'stamina', 'staminaFill', 'menus', 'menuMain', 'menuPause',
      'menuOver', 'overWinner', 'finalScore', 'boxRows', 'halftime', 'halftimeScore', 'rotateHint', 'btnRotateDismiss', 'ctxLost',
      'btnReload', 'nowebgl', 'btnStart', 'btnResume', 'btnQuit', 'btnQuitOver', 'btnRematch'];
    for (let i = 0; i < ids.length; i++) this.els[ids[i]] = this._id(ids[i]);
    const e = this.els;
    const click = (el, fn) => this._on(el, 'click', (ev) => { ev.preventDefault(); this._click(); fn(ev); });
    click(e.btnStart, () => { if (this.cb.onStart) this.cb.onStart(this.getOptions()); });
    click(e.btnResume, () => { if (this.cb.onResume) this.cb.onResume(); });
    click(e.btnQuit, () => { if (this.cb.onQuit) this.cb.onQuit(); });
    click(e.btnQuitOver, () => { if (this.cb.onQuit) this.cb.onQuit(); });
    click(e.btnRematch, () => { if (this.cb.onRematch) this.cb.onRematch(); });
    click(e.halftime, () => { if (this.cb.onSkip) this.cb.onSkip(); });
    click(e.btnRotateDismiss, () => this.dismissRotateHint());
    click(e.btnReload, () => { if (this.win && this.win.location) this.win.location.reload(); });
    const teamBtns = this._all('[data-team]');
    for (let i = 0; i < teamBtns.length; i++) {
      const b = teamBtns[i];
      click(b, () => this.setOption('team', parseInt(b.getAttribute('data-team'), 10) || 0));
    }
    const settingBtns = this._all('[data-setting]');
    for (let i = 0; i < settingBtns.length; i++) {
      const b = settingBtns[i], key = b.getAttribute('data-setting'), raw = b.getAttribute('data-value');
      click(b, () => this.setOption(key, key === 'quarter' ? parseInt(raw, 10) : raw));
    }
    const langBtns = this._all('[data-action=lang]');
    for (let i = 0; i < langBtns.length; i++) click(langBtns[i], () => this.toggleLanguage());
    const soundBtns = this._all('[data-action=sound]');
    for (let i = 0; i < soundBtns.length; i++) click(soundBtns[i], () => this.setOption('sound', !this.options.sound));
    // Pressed feedback for menu buttons (class toggled on pointerdown, never :active).
    this._on(this.doc, 'pointerdown', (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest('#menus button, .overlay button, #rotateHint button') : null;
      if (b) { this._pressedBtn = b; b.classList.add('pressed'); }
    }, { passive: true });
    const unpress = () => { if (this._pressedBtn) { this._pressedBtn.classList.remove('pressed'); this._pressedBtn = null; } };
    this._on(this.doc, 'pointerup', unpress, { passive: true });
    this._on(this.doc, 'pointercancel', unpress, { passive: true });
    // Any key skips the halftime overlay.
    this._on(this.doc, 'keydown', (ev) => { if (this.menu === 'halftime' && !ev.repeat && this.cb.onSkip) this.cb.onSkip(); });
    if (this.win) this._on(this.win, 'resize', () => { if (!this._isPortrait()) this.dismissRotateHint(); });
    this._unsubLang = onLangChange(() => this.refreshLang());
    this._syncOptions();
    this.refreshLang();
    this.maybeShowRotateHint();
  }

  bind(game, input, audio) {
    this.game = game || null;
    this.input = input || null;
    this.audio = audio || null;
    if (this.audio && typeof this.audio.muted === 'boolean') this.options.sound = !this.audio.muted;
    this._syncOptions();
    return this;
  }

  _click() {
    if (this.audio && typeof this.audio.click === 'function') {
      try { this.audio.click(); } catch (err) { /* audio is optional */ }
    }
  }

  _text(node, str) {
    if (!node) return;
    if (this._last.get(node) === str) return;
    this._last.set(node, str);
    node.textContent = str;
  }

  // ---------- options ----------
  getOptions() {
    const o = this.options;
    return { team: o.team, difficulty: o.difficulty, quarter: o.quarter, quarterSeconds: o.quarter, lang: getLang(), sound: o.sound };
  }

  setOption(key, value) {
    const o = this.options;
    if (key === 'team') o.team = value === 1 ? 1 : 0;
    else if (key === 'difficulty') o.difficulty = value === 'easy' || value === 'hard' ? value : 'normal';
    else if (key === 'quarter') o.quarter = CLOCK.QUARTER_OPTIONS.indexOf(value) >= 0 ? value : CLOCK.DEFAULT_Q;
    else if (key === 'sound') {
      o.sound = !!value;
      if (this.audio && typeof this.audio.setMuted === 'function') this.audio.setMuted(!o.sound);
    } else return;
    this._syncOptions();
    if (this.cb.onSetting) this.cb.onSetting(key, o[key]);
  }

  toggleLanguage() {
    const lang = toggleLang(); // i18n re-labels every [data-i18n]; the onLangChange hook refreshes the rest
    this.options.lang = lang;
    if (this.cb.onLang) this.cb.onLang(lang);
    if (this.cb.onSetting) this.cb.onSetting('lang', lang);
    return lang;
  }

  _syncOptions() {
    const o = this.options;
    const teamBtns = this._all('[data-team]');
    for (let i = 0; i < teamBtns.length; i++) {
      const b = teamBtns[i], idx = parseInt(b.getAttribute('data-team'), 10) || 0;
      b.classList.toggle('selected', idx === o.team);
      b.style.setProperty('--tc', hexCss(TEAMS[idx] ? TEAMS[idx].jersey : 0x3a4050));
    }
    const settingBtns = this._all('[data-setting]');
    for (let i = 0; i < settingBtns.length; i++) {
      const b = settingBtns[i], key = b.getAttribute('data-setting');
      b.classList.toggle('selected', String(o[key]) === b.getAttribute('data-value'));
    }
    const soundBtns = this._all('[data-action=sound]');
    for (let i = 0; i < soundBtns.length; i++) {
      const b = soundBtns[i], key = o.sound ? 'common.on' : 'common.off';
      if (b.getAttribute('data-i18n') !== key) { b.setAttribute('data-i18n', key); applyDom(b); }
      b.classList.toggle('selected', o.sound);
    }
  }

  // Everything not driven by [data-i18n]: team names, language toggle, score bug period, over/halftime text.
  refreshLang() {
    const lang = getLang();
    this.options.lang = lang;
    const teamBtns = this._all('[data-team]');
    for (let i = 0; i < teamBtns.length; i++) {
      const b = teamBtns[i], idx = parseInt(b.getAttribute('data-team'), 10) || 0;
      const tm = TEAMS[idx];
      if (tm) this._text(b, localize(tm.name));
    }
    const langBtns = this._all('[data-action=lang]');
    for (let i = 0; i < langBtns.length; i++) this._text(langBtns[i], t(lang === 'zh' ? 'menu.lang.zh' : 'menu.lang.en'));
    this._lastQ = -1;
    if (this._overData) this._renderOver(this._overData);
    if (this._halftimeScore) this._renderHalftime(this._halftimeScore);
    if (this._capT >= 0 && this._capCur) this._text(this.els.caption, t(this._capCur.key, localizeParams(this._capCur.params)));
  }

  // ---------- per-frame ----------
  update(dt, world, camera) {
    dt = typeof dt === 'number' && dt > 0 ? (dt < 0.25 ? dt : 0.25) : 0;
    const g = this.game;
    const w = world || (g && g.world) || null;
    this._renderBug(w, g);
    this._renderStamina(w, g);
    this._tickCaption(dt);
    this._tickBanner(dt);
    this._tickMeter(dt);
    this._camera = camera || this._camera;
  }

  _renderBug(w, g) {
    const e = this.els;
    const teams = w && w.teams ? w.teams : null;
    if (teams !== this._teamsRef) {
      this._teamsRef = teams;
      this._teamInfo[0] = teamInfo(teams ? teams[0] : null, 0);
      this._teamInfo[1] = teamInfo(teams ? teams[1] : null, 1);
    }
    const score = (g && g.score) || (w && w.score) || ZERO_SCORE;
    for (let i = 0; i < 2; i++) {
      const info = this._teamInfo[i], chip = i === 0 ? e.chipA : e.chipB;
      this._text(i === 0 ? e.abbrA : e.abbrB, info.id);
      this._text(i === 0 ? e.scoreA : e.scoreB, String(score[i] | 0));
      const col = hexCss(info.jersey);
      if (chip && this._chipColor[i] !== col) { this._chipColor[i] = col; chip.style.setProperty('--tc', col); }
    }
    const inGame = !!w && typeof w.offense === 'number' && w.state !== 'MENU';
    if (e.possA) e.possA.classList.toggle('on', inGame && w.offense === 0);
    if (e.possB) e.possB.classList.toggle('on', inGame && w.offense === 1);
    const q = w && typeof w.quarter === 'number' && w.quarter > 0 ? w.quarter : 1;
    if (q !== this._lastQ) {
      this._lastQ = q;
      let label;
      if (q <= CLOCK.QUARTERS) { param.n = q; label = t('hud.q', param); }
      else if (q === CLOCK.QUARTERS + 1) label = t('hud.ot');
      else { param.n = q - CLOCK.QUARTERS; label = t('hud.ot2', param); }
      this._text(e.period, label);
    }
    const gameSec = w && typeof w.gameClock === 'number' ? w.gameClock : this.options.quarter;
    const gs = Math.max(0, Math.ceil(gameSec - 1e-4));
    if (gs !== this._lastGame) {
      this._lastGame = gs;
      this._text(e.gameClock, pad2(Math.floor(gs / 60)) + ':' + pad2(gs % 60));
    }
    const shotSec = w && typeof w.shotClock === 'number' ? w.shotClock : CLOCK.SHOT;
    const ss = Math.max(0, Math.ceil(shotSec - 1e-4));
    if (ss !== this._lastShot) { this._lastShot = ss; this._text(e.shotClock, String(ss)); }
    const warn = shotSec < CLOCK.TICK_BELOW;
    if (warn !== this._shotWarn && e.shotClock) { this._shotWarn = warn; e.shotClock.classList.toggle('warn', warn); }
  }

  _renderStamina(w, g) {
    const p = (w && w.userPlayer) || (g && g.controlled) || null;
    const v = p && typeof p.stamina === 'number' ? (p.stamina < 0 ? 0 : p.stamina > 1 ? 1 : p.stamina) : 1;
    const pct = Math.round(v * 100);
    if (pct !== this._stamPct && this.els.staminaFill) {
      this._stamPct = pct;
      this.els.staminaFill.style.transform = 'scaleX(' + (pct / 100) + ')';
    }
    const low = v < 0.25;
    if (low !== this._stamLow && this.els.stamina) { this._stamLow = low; this.els.stamina.classList.toggle('low', low); }
  }

  // ---------- captions / banner ----------
  caption(key, params) {
    if (!key) return;
    if (this._queue.length >= 6) this._queue.shift();
    this._queue.push({ key, params: params || null });
  }

  _tickCaption(dt) {
    const el = this.els.caption;
    if (this._capT >= 0) {
      this._capT += dt;
      if (!this._capFading && this._capT >= CAPTION_T) { this._capFading = true; if (el) el.classList.remove('show'); }
      if (this._capT >= CAPTION_T + CAPTION_FADE) { this._capT = -1; this._capFading = false; this._capCur = null; }
    }
    if (this._capT < 0 && this._queue.length > 0) {
      const c = this._queue.shift();
      this._capCur = c;
      this._text(el, t(c.key, localizeParams(c.params)));
      if (el) el.classList.add('show');
      this._capT = 0; this._capFading = false;
    }
  }

  banner(key, params, ms) {
    const el = this.els.banner;
    if (!key) { this._bannerT = 0; if (el) el.classList.remove('show'); return; }
    this._text(el, t(key, localizeParams(params)));
    if (el) el.classList.add('show');
    this._bannerT = (typeof ms === 'number' && ms > 0 ? ms : BANNER_DEFAULT_MS) / 1000;
  }

  _tickBanner(dt) {
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) { this._bannerT = 0; if (this.els.banner) this.els.banner.classList.remove('show'); }
    }
  }

  // ---------- shot meter ----------
  // f: fill fraction (0..1.25), g: green half-width, screenX/Y: CSS px of the shooter's head.
  setMeter(f, g, visible, screenX, screenY) {
    const e = this.els;
    this._meterWant = !!visible;
    if (visible && e.meter) {
      e.meter.style.transform = 'translate3d(' + Math.round(screenX + METER_OFFSET_X) + 'px,' + Math.round(screenY - METER_H / 2) + 'px,0)';
      const pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
      if (pct !== this._meterPct && e.meterFill) { this._meterPct = pct; e.meterFill.style.height = pct + '%'; }
      if (g !== this._meterG && e.meterBand) {
        this._meterG = g;
        e.meterBand.style.bottom = ((0.8 - g) * 100).toFixed(1) + '%';
        e.meterBand.style.height = (2 * g * 100).toFixed(1) + '%';
      }
    }
    this._applyMeterVisible();
  }

  // Convenience for the game: project a world point with a THREE camera (or a wrapper exposing .camera).
  projectMeter(f, g, visible, x, y, z, camera) {
    const c = camera || this._camera;
    const cam = c && c.isCamera ? c : (c && c.camera && c.camera.isCamera ? c.camera : null);
    if (!visible || !cam) { this.setMeter(f, g, false, 0, 0); return; }
    const v = SCRATCH.v3a.set(x, y, z).project(cam);
    if (v.z > 1) { this.setMeter(f, g, false, 0, 0); return; }
    const app = this._id('app');
    const w = app && app.clientWidth ? app.clientWidth : (this.win ? this.win.innerWidth : 0);
    const h = app && app.clientHeight ? app.clientHeight : (this.win ? this.win.innerHeight : 0);
    this.setMeter(f, g, true, (v.x * 0.5 + 0.5) * w, (0.5 - v.y * 0.5) * h);
  }

  flashMeter(kind) {
    const el = this.els.meterFlash;
    const k = kind === 'perfect' || kind === 'early' || kind === 'late' ? kind : 'late';
    if (el) {
      this._text(el, t('meter.' + k));
      el.classList.remove('perfect', 'early', 'late');
      el.classList.add(k, 'show');
    }
    this._meterHold = FLASH_T;
    this._applyMeterVisible();
  }

  _tickMeter(dt) {
    if (this._meterHold > 0) {
      this._meterHold -= dt;
      if (this._meterHold <= 0) {
        this._meterHold = 0;
        if (this.els.meterFlash) this.els.meterFlash.classList.remove('show');
        this._applyMeterVisible();
      }
    }
  }

  _applyMeterVisible() {
    const on = this._meterWant || this._meterHold > 0;
    if (on !== this._meterOn && this.els.meter) { this._meterOn = on; this.els.meter.classList.toggle('visible', on); }
  }

  // ---------- menus / overlays ----------
  // name: 'main' | 'pause' | 'over' | 'halftime' | 'ctxLost' | 'nowebgl' | 'rotate' | null (hide all).
  // data for 'over': {winner: 0|1|null, score:[a,b], rows:[{name, pts, fgm, fga, tpm, reb, stl, blk, team}]};
  // for 'halftime': {score:[a,b]}.
  showMenu(name, data) {
    const e = this.els;
    if (name === 'rotate') { this.maybeShowRotateHint(true); return; }
    for (const k in PANELS) { const el = e[PANELS[k]]; if (el) el.classList.toggle('hidden', k !== name); }
    for (const k in OVERLAYS) { const el = e[OVERLAYS[k]]; if (el) el.classList.toggle('hidden', k !== name); }
    if (e.menus) e.menus.classList.toggle('hidden', !PANELS[name]);
    this.menu = name || null;
    if (name === 'over') this._renderOver(data || {});
    else if (name === 'halftime') this._renderHalftime((data && data.score) || (this.game && this.game.score) || ZERO_SCORE);
    if (name === 'main') this._syncOptions();
    if (this.input && typeof this.input.setEnabled === 'function') this.input.setEnabled(!name);
  }

  _scoreLine(score) {
    const a = this._teamInfo[0], b = this._teamInfo[1];
    return localize(a.name) + ' ' + (score[0] | 0) + ' : ' + (score[1] | 0) + ' ' + localize(b.name);
  }

  _renderHalftime(score) {
    this._halftimeScore = score;
    this._text(this.els.halftimeScore, this._scoreLine(score));
  }

  _renderOver(data) {
    this._overData = data;
    const e = this.els;
    const score = data.score || (this.game && this.game.score) || ZERO_SCORE;
    let winner = data.winner;
    if (winner && typeof winner === 'object' && winner.name) winner = localize(winner.name);
    else if (winner === 0 || winner === 1) winner = localize(this._teamInfo[winner].name);
    else winner = null;
    this._text(e.overWinner, winner ? t('over.winner', { team: winner }) : t('over.tie'));
    this._text(e.finalScore, this._scoreLine(score));
    const rows = data.rows || data.box || data.players || [];
    const body = e.boxRows;
    if (!body) return;
    body.textContent = '';
    let prevTeam = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const tr = this.doc.createElement('tr');
      const team = typeof r.team === 'number' ? r.team : (typeof r.teamIdx === 'number' ? r.teamIdx : -1);
      if (team >= 0 && prevTeam >= 0 && team !== prevTeam) tr.classList.add('sep');
      prevTeam = team;
      const cells = [localize(r.name), r.pts | 0, (r.fgm | 0) + '/' + (r.fga | 0), r.tpm | 0, r.reb | 0, r.stl | 0, r.blk | 0];
      for (let c = 0; c < cells.length; c++) {
        const td = this.doc.createElement('td');
        td.textContent = String(cells[c]);
        if (c === 0 && team >= 0 && this._teamInfo[team]) td.style.setProperty('--tc', hexCss(this._teamInfo[team].jersey));
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  // ---------- rotate hint ----------
  _isPortrait() {
    return !!this.win && this.win.innerHeight > this.win.innerWidth;
  }

  _rotateSeen() {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem(ROTATE_KEY) === '1'; } catch (err) { return false; }
  }

  maybeShowRotateHint(force) {
    const el = this.els.rotateHint;
    if (!el) return false;
    if (!force && (!this._isPortrait() || this._rotateSeen())) return false;
    el.classList.remove('hidden');
    return true;
  }

  dismissRotateHint() {
    const el = this.els.rotateHint;
    if (!el || el.classList.contains('hidden')) return;
    el.classList.add('hidden');
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(ROTATE_KEY, '1'); } catch (err) { /* private mode */ }
  }

  destroy() {
    for (let i = 0; i < this._listeners.length; i++) {
      const l = this._listeners[i];
      l[0].removeEventListener(l[1], l[2], l[3]);
    }
    this._listeners.length = 0;
    if (this._unsubLang) { this._unsubLang(); this._unsubLang = null; }
    this._last.clear();
  }
}
