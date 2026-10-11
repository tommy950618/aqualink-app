/**
 * ui/screens.js - screen flow DOM of LEGENDS 3v3 (spec v2 sections 6.5.1, 6.5.2, 6.5.4, 6.5.7 rotate hint, 6.5.9,
 * 6.5.10; review findings R#7, R#8, R#11, R#12, R#21): title, settings sheet, pause menu, halftime, game over with box
 * score and MVP card, rotate hint, context-lost / no-WebGL overlays.
 *
 * Screen state lives on #app: data-screen = loading | loadError | title | settings | lineup | intro | game | replay |
 * gameover (C15, mirrored to `screens.ui.screen` for __game.ui) and data-overlay = pause | halftime | ctxLost | nowebgl
 * | '' (`screens.ui.overlay`). CSS shows/hides the HUD, controls and panels from these two attributes, so a screen change
 * is one attribute write.
 *
 * API
 *   new Screens(doc, { settings, match, onPlay, onQuick, onResume, onQuit, onRematch, onLineup, onHalftimeSkip })
 *   screens.bind({ input })        input.setEnabled(on) follows the screen (enabled only in 'game' without overlay)
 *   screens.show(name)             switch screen (see list above); leaving title/lineup hides the rotate hint (R#8)
 *   screens.openSettings() / closeSettings()   settings sheet over the title
 *   screens.pause(on)              pause menu overlay (subset of settings rows; difficulty / rules read-only, C28)
 *   screens.halftime(data|null)    {score:[a,b], box:[rows]}; tap or any key except P/Esc/M/T skips (R#21)
 *   screens.gameOver(data)         {winner, score:[a,b], box:[rows], mvpId?}; rows {id, team, index?, pts, fgm, fga, tpm,
 *                                  tpa?, reb, ast, stl, blk} (flat or under .stats); MVP = pickMvp unless mvpId given
 *   screens.overlay(name|null)     'ctxLost' | 'nowebgl'
 *   screens.setTier(tier)          current quality tier for the "Auto · Med" label
 *   screens.ui                     { screen, overlay } (read by main.js for __game.ui)
 */
import { t, getLang, setLang, onLangChange, applyDom } from '../i18n.js';
import { SETTINGS_SCHEMA } from './settings.js';
import { pickMvp } from './present.js';

const ROTATE_KEY = 'hoop.rotateHintSeen';    // v1 key: "Got it" persists across reloads (B22)
const ROTATE_AUTO_HIDE_MS = 6000;
const RESERVED_KEYS = { KeyP: 1, Escape: 1, KeyM: 1, KeyT: 1 };
const SCREENS = { loading: 1, loadError: 1, title: 1, settings: 1, lineup: 1, intro: 1, game: 1, replay: 1, gameover: 1 };

function stat(r, k) {
  const s = r && r.stats && typeof r.stats === 'object' ? r.stats : r;
  const v = s ? s[k] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function num(r, k) {
  const v = stat(r, k);
  return v === undefined ? 0 : v;
}

/** Flatten a box-score row into the fields the MVP formula and the table need. */
export function boxRow(r, i) {
  const id = r.id || r.playerId || (r.legend && r.legend.id) || null;
  return {
    id, team: typeof r.team === 'number' ? r.team : (typeof r.teamIdx === 'number' ? r.teamIdx : -1),
    index: typeof r.index === 'number' ? r.index : undefined, order: i,
    pts: num(r, 'pts'), fgm: num(r, 'fgm'), fga: num(r, 'fga'), tpm: num(r, 'tpm'), tpa: stat(r, 'tpa'),
    reb: num(r, 'reb'), ast: num(r, 'ast'), stl: num(r, 'stl'), blk: num(r, 'blk'),
  };
}

export class Screens {
  constructor(doc, opts) {
    const o = opts || {};
    this.doc = doc || (typeof document !== 'undefined' ? document : null);
    this.win = this.doc && this.doc.defaultView ? this.doc.defaultView : null;
    this.settings = o.settings || null;
    this.match = o.match || null;
    this.cb = {
      onPlay: o.onPlay || null, onQuick: o.onQuick || null, onResume: o.onResume || null, onQuit: o.onQuit || null,
      onRematch: o.onRematch || null, onLineup: o.onLineup || null, onHalftimeSkip: o.onHalftimeSkip || null,
    };
    this.input = null;
    this.ui = { screen: 'loading', overlay: null };
    this.tier = null;
    this._over = null;
    this._half = null;
    this._rotateTimer = 0;
    this._qualityTouched = false;
    this._listeners = [];
    this.els = {};
    const ids = ['app', 'screenTitle', 'btnStart', 'btnQuick', 'btnSettings', 'btnLang', 'menus', 'menuSettings', 'settingsRows',
      'btnSettingsBack', 'settingsNote', 'menuPause', 'pauseRows', 'btnResume', 'btnQuit', 'menuOver', 'overWinner', 'finalScore',
      'overNameA', 'overNameB', 'overScore', 'boxRows', 'btnRematch', 'btnLineup', 'btnQuitOver', 'mvpCard', 'mvpName', 'mvpOther',
      'mvpLine', 'halftime', 'halftimeScore', 'halfLeaders', 'rotateHint', 'btnRotateDismiss', 'ctxLost', 'btnReload', 'nowebgl'];
    for (let i = 0; i < ids.length; i++) this.els[ids[i]] = this.doc ? this.doc.getElementById(ids[i]) : null;
    if (this.doc) this._attach();
  }

  _on(target, type, fn, options) {
    if (!target) return;
    target.addEventListener(type, fn, options);
    this._listeners.push([target, type, fn, options]);
  }

  _click(el, fn) {
    this._on(el, 'click', (ev) => { ev.preventDefault(); fn(ev); });
  }

  _attach() {
    const e = this.els, cb = this.cb;
    this._click(e.btnStart, () => { if (cb.onPlay) cb.onPlay(); });
    this._click(e.btnQuick, () => { if (cb.onQuick) cb.onQuick(); });
    this._click(e.btnSettings, () => this.openSettings());
    this._click(e.btnSettingsBack, () => this.closeSettings());
    this._click(e.btnLang, () => this._toggleLang());
    this._click(e.btnResume, () => { if (cb.onResume) cb.onResume(); });
    this._click(e.btnQuit, () => { if (cb.onQuit) cb.onQuit(); });
    this._click(e.btnRematch, () => { if (cb.onRematch) cb.onRematch(); });
    this._click(e.btnLineup, () => { if (cb.onLineup) cb.onLineup(); });
    this._click(e.btnQuitOver, () => { if (cb.onQuit) cb.onQuit(); });
    this._click(e.btnRotateDismiss, () => this.dismissRotateHint());
    this._click(e.btnReload, () => { if (this.win && this.win.location) this.win.location.reload(); });
    this._on(e.halftime, 'click', (ev) => { ev.preventDefault(); this._skipHalftime(); });
    this._on(this.doc, 'keydown', (ev) => {
      if (this.ui.overlay !== 'halftime' || ev.repeat || RESERVED_KEYS[ev.code]) return;
      this._skipHalftime();
    });
    // Pressed feedback on menu buttons (a class on pointerdown, never :active, which sticks on iOS).
    let pressed = null;
    this._on(this.doc, 'pointerdown', (ev) => {
      const b = ev.target && ev.target.closest ? ev.target.closest('#screens button, #menus button, .overlay button, #rotateHint button, #loadError button') : null;
      if (b) { pressed = b; b.classList.add('pressed'); }
    }, { passive: true });
    const unpress = () => { if (pressed) { pressed.classList.remove('pressed'); pressed = null; } };
    this._on(this.doc, 'pointerup', unpress, { passive: true });
    this._on(this.doc, 'pointercancel', unpress, { passive: true });
    if (this.win) this._on(this.win, 'resize', () => { if (!this._isPortrait()) this._hideRotate(); });
    this._buildRows(e.settingsRows, 'title');
    this._buildRows(e.pauseRows, 'pause');
    if (this.settings && typeof this.settings.onChange === 'function') {
      this._unsubSettings = this.settings.onChange((key) => this._syncRow(key));
    }
    this._unsubLang = onLangChange(() => this.refreshLang());
    this._syncAll();
  }

  bind(o) {
    if (o && o.input !== undefined) this.input = o.input;
    this._applyInput();
    return this;
  }

  setCallbacks(cb) {
    Object.assign(this.cb, cb || {});
  }

  // ---- screens and overlays ----

  show(name) {
    if (!SCREENS[name]) return;
    this.ui.screen = name;
    if (this.els.app) this.els.app.setAttribute('data-screen', name);
    if (name === 'title' || name === 'lineup') this.maybeShowRotateHint();
    else this._hideRotate();
    if (name !== 'gameover' && this.els.mvpCard) this.els.mvpCard.classList.add('hidden');
    if (name === 'title' || name === 'lineup' || name === 'loading') {
      if (this.ui.overlay === 'pause' || this.ui.overlay === 'halftime') this._setOverlay(null);
    }
    this._applyInput();
  }

  _setOverlay(name) {
    this.ui.overlay = name || null;
    if (this.els.app) this.els.app.setAttribute('data-overlay', name || '');
    this._applyInput();
  }

  overlay(name) {
    this._setOverlay(name === 'ctxLost' || name === 'nowebgl' ? name : null);
  }

  _applyInput() {
    if (this.input && typeof this.input.setEnabled === 'function') this.input.setEnabled(this.ui.screen === 'game' && !this.ui.overlay);
  }

  openSettings() {
    this._syncAll();
    this.show('settings');
  }

  closeSettings() {
    this.show('title');
  }

  pause(on) {
    if (on) {
      this._syncAll();
      this._setOverlay('pause');
      this._hideRotate();
    } else if (this.ui.overlay === 'pause') {
      this._setOverlay(null);
    }
  }

  // ---- settings rows ----

  _buildRows(container, ctx) {
    if (!container) return;
    container.textContent = '';
    const doc = this.doc;
    for (let i = 0; i < SETTINGS_SCHEMA.length; i++) {
      const r = SETTINGS_SCHEMA[i];
      if (ctx === 'pause' && r.pause === 'hide') continue;
      const ro = ctx === 'pause' && r.pause === 'ro';
      const row = doc.createElement('div');
      row.className = 'row' + (ro ? ' ro' : '');
      row.setAttribute('data-key', r.key);
      const lbl = doc.createElement('span');
      lbl.className = 'lbl';
      lbl.setAttribute('data-i18n', r.label);
      lbl.textContent = t(r.label);
      row.appendChild(lbl);
      const seg = doc.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'group');
      for (let j = 0; j < r.options.length; j++) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'opt';
        b.setAttribute('data-key', r.key);
        b.setAttribute('data-idx', String(j));
        if (ro) { b.disabled = true; b.classList.add('ro'); b.setAttribute('aria-disabled', 'true'); }
        else this._click(b, () => this._choose(r.key, r.options[j]));
        seg.appendChild(b);
      }
      row.appendChild(seg);
      container.appendChild(row);
    }
    if (ctx === 'pause') {
      const note = doc.createElement('div');
      note.className = 'note roNote';
      note.setAttribute('data-i18n', 'settings.readOnly');
      note.textContent = t('settings.readOnly');
      container.appendChild(note);
    }
    this._labelOptions(container);
  }

  _choose(key, value) {
    if (key === 'quality') this._qualityTouched = true;
    if (this.settings) this.settings.set(key, value);
    this._syncRow(key);
  }

  _optLabel(r, v) {
    if (r.key === 'quality' && v === 'auto' && this.tier) return t('settings.quality.autoTier', { tier: t('settings.tier.' + this.tier) });
    if (r.key === 'quarter') return t('settings.quarter.n', { n: Math.round(v / 60) });
    return t(r.optLabel(v));
  }

  _labelOptions(container) {
    if (!container) return;
    const opts = container.querySelectorAll('.opt');
    for (let i = 0; i < opts.length; i++) {
      const b = opts[i];
      const r = SETTINGS_SCHEMA.find((x) => x.key === b.getAttribute('data-key'));
      if (!r) continue;
      const v = r.options[parseInt(b.getAttribute('data-idx'), 10)];
      const s = this._optLabel(r, v);
      if (b.textContent !== s) b.textContent = s;
    }
  }

  _syncRow(key) {
    const cur = this.settings ? this.settings.get(key) : undefined;
    const r = SETTINGS_SCHEMA.find((x) => x.key === key);
    if (!r || !this.doc) return;
    const opts = this.doc.querySelectorAll('.opt[data-key="' + key + '"]');
    for (let i = 0; i < opts.length; i++) {
      const v = r.options[parseInt(opts[i].getAttribute('data-idx'), 10)];
      opts[i].classList.toggle('selected', v === cur);
      opts[i].setAttribute('aria-pressed', v === cur ? 'true' : 'false');
    }
    if (key === 'quality' && this.els.settingsNote) this.els.settingsNote.classList.toggle('hidden', !this._qualityTouched);
  }

  _syncAll() {
    for (let i = 0; i < SETTINGS_SCHEMA.length; i++) this._syncRow(SETTINGS_SCHEMA[i].key);
  }

  /** Current quality tier for the "Auto · tier" option label. */
  setTier(tier) {
    this.tier = tier === 'low' || tier === 'medium' || tier === 'high' ? tier : null;
    this._labelOptions(this.els.settingsRows);
    this._labelOptions(this.els.pauseRows);
  }

  _toggleLang() {
    const next = getLang() === 'zh' ? 'en' : 'zh';
    if (this.settings) this.settings.set('lang', next);
    else setLang(next);   // no Settings bound: toggle through i18n directly
  }

  // ---- halftime ----

  halftime(data) {
    if (!data) {
      this._half = null;
      if (this.ui.overlay === 'halftime') this._setOverlay(null);
      return;
    }
    this._half = data;
    this._renderHalftime();
    this._setOverlay('halftime');
  }

  _skipHalftime() {
    if (this.ui.overlay !== 'halftime') return;
    if (this.cb.onHalftimeSkip) this.cb.onHalftimeSkip();
  }

  _renderHalftime() {
    const e = this.els, d = this._half, m = this.match;
    if (!d) return;
    const score = d.score || [0, 0];
    if (e.halftimeScore) e.halftimeScore.textContent = (m ? m.teamName(0) : 'A') + '  ' + (score[0] | 0) + ' : ' + (score[1] | 0) + '  ' + (m ? m.teamName(1) : 'B');
    const box = d.box || d.rows || [];
    if (!e.halfLeaders) return;
    e.halfLeaders.textContent = '';
    for (let team = 0; team < 2; team++) {
      let best = null;
      for (let i = 0; i < box.length; i++) {
        const r = boxRow(box[i], i);
        if (r.team !== team) continue;
        if (!best || r.pts > best.pts || (r.pts === best.pts && r.reb > best.reb)) best = r;
      }
      if (!best) continue;
      const line = this.doc.createElement('div');
      line.className = 'leader';
      line.style.setProperty('--tc', m ? m.style(team).bg : '#3a4050');
      line.textContent = t('half.leader', { name: m ? m.short(best.id) : String(best.id), pts: best.pts, reb: best.reb });
      e.halfLeaders.appendChild(line);
    }
  }

  // ---- game over ----

  gameOver(data) {
    this._over = data || {};
    this._renderOver();
    this.show('gameover');
    if (this.els.mvpCard) this.els.mvpCard.classList.toggle('hidden', !this._mvpRow);
  }

  _renderOver() {
    const e = this.els, d = this._over, m = this.match;
    if (!d) return;
    const score = d.score || [0, 0];
    const winner = d.winner === 0 || d.winner === 1 ? d.winner : (score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1);
    if (e.overWinner) e.overWinner.textContent = winner >= 0 ? t('over.winner', { team: m ? m.teamName(winner) : '' }) : t('over.tie');
    if (e.overNameA) { e.overNameA.textContent = m ? m.teamName(0) : ''; e.overNameA.style.setProperty('--tc', m ? m.style(0).bg : '#3a4050'); }
    if (e.overNameB) { e.overNameB.textContent = m ? m.teamName(1) : ''; e.overNameB.style.setProperty('--tc', m ? m.style(1).bg : '#3a4050'); }
    if (e.overScore) e.overScore.textContent = (score[0] | 0) + ' : ' + (score[1] | 0);
    const src = d.box || d.rows || [];
    const rows = [];
    for (let i = 0; i < src.length; i++) rows.push(boxRow(src[i], i));
    // Team order (A then B), roster order inside a team.
    rows.sort((a, b) => (a.team - b.team) || ((a.index !== undefined && b.index !== undefined) ? a.index - b.index : a.order - b.order));
    let mvp = null;
    if (d.mvpId) for (let i = 0; i < rows.length; i++) if (rows[i].id === d.mvpId) mvp = rows[i];
    if (!mvp) mvp = pickMvp(rows, winner >= 0 ? winner : null);
    this._mvpRow = mvp;
    const body = e.boxRows;
    if (body) {
      body.textContent = '';
      let prevTeam = -1;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const tr = this.doc.createElement('tr');
        if (prevTeam >= 0 && r.team !== prevTeam) tr.classList.add('sep');
        prevTeam = r.team;
        if (r === mvp) tr.classList.add('mvp');
        const name = m ? m.short(r.id) : String(r.id);
        const cells = [name, r.pts, r.fgm + '/' + r.fga, r.tpa === undefined ? String(r.tpm) : r.tpm + '/' + r.tpa, r.reb, r.ast, r.stl, r.blk];
        for (let c = 0; c < cells.length; c++) {
          const td = this.doc.createElement('td');
          if (c === 0) {
            td.style.setProperty('--tc', m && r.team >= 0 ? teamTextColour(m, r.team) : '#f2f4f8');
            if (r === mvp) { const star = this.doc.createElement('span'); star.className = 'star'; star.textContent = '★'; td.appendChild(star); }
            td.appendChild(this.doc.createTextNode(String(cells[c])));
          } else td.textContent = String(cells[c]);
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
    }
    if (mvp && m) {
      if (e.mvpName) e.mvpName.textContent = m.full(mvp.id);
      if (e.mvpOther) e.mvpOther.textContent = m.other(mvp.id);
      if (e.mvpLine) e.mvpLine.textContent = t('over.mvpLine', { pts: mvp.pts, reb: mvp.reb, ast: mvp.ast });
      if (e.mvpCard) e.mvpCard.style.setProperty('--tc', m.style(mvp.team >= 0 ? mvp.team : 0).bg);
    }
  }

  /** The MVP row of the last game-over panel ({id, team, pts, ...}) or null. */
  get mvp() {
    return this._mvpRow || null;
  }

  // ---- rotate hint (R#8) ----

  _isPortrait() {
    return !!this.win && this.win.innerHeight > this.win.innerWidth;
  }

  _rotateSeen() {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(ROTATE_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  /** Show the hint on the title / lineup in portrait until "Got it" was pressed once; auto-hides after 6 s. */
  maybeShowRotateHint() {
    const el = this.els.rotateHint;
    if (!el || !this._isPortrait() || this._rotateSeen() || this._rotateDismissedSession) return false;
    el.classList.remove('hidden');
    clearTimeout(this._rotateTimer);
    this._rotateTimer = setTimeout(() => this._hideRotate(), ROTATE_AUTO_HIDE_MS);
    return true;
  }

  _hideRotate() {
    clearTimeout(this._rotateTimer);
    if (this.els.rotateHint) this.els.rotateHint.classList.add('hidden');
  }

  dismissRotateHint() {
    this._hideRotate();
    this._rotateDismissedSession = true;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(ROTATE_KEY, '1');
    } catch (err) {
      // private mode: dismissed for this session only
    }
  }

  // ---- language ----

  refreshLang() {
    applyDom(this.doc);
    this._labelOptions(this.els.settingsRows);
    this._labelOptions(this.els.pauseRows);
    if (this._over) this._renderOver();
    if (this._half) this._renderHalftime();
  }

  dispose() {
    for (let i = 0; i < this._listeners.length; i++) {
      const l = this._listeners[i];
      l[0].removeEventListener(l[1], l[2], l[3]);
    }
    this._listeners.length = 0;
    clearTimeout(this._rotateTimer);
    if (this._unsubLang) this._unsubLang();
    if (this._unsubSettings) this._unsubSettings();
  }
}

/** Readable name colour of a team on the dark panel (white for the black team, the chip text colour otherwise). */
function teamTextColour(m, team) {
  const st = m.style(team);
  if (st.key === 'allstarB') return '#ffffff';
  if (st.key === 'allstarA') return '#f4f4f1';
  if (st.key === 'bright') return '#ff5a7a';
  return st.text;
}
