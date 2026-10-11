/**
 * ui/present.js - presentation helpers shared by the v2 UI and the `#present` layer (spec v2 sections 2.4, 2.7, 2.9,
 * 6.4.3, 6.4.4, 6.4.6, 6.5.6, 6.5.9).
 *
 * Pure helpers (Node-testable, no DOM):
 *   TEAM_STYLE            team UI colours of section 2.9 (legends.js TEAM_UI) + i18n keys {bg, text, accent, nameKey,
 *                         abbrKey} per team key
 *   normTeamKey(v)        'dark' | 'bright' | 'allstarA' | 'allstarB' from a key, alias ('white'/'black') or {id|key}
 *   kitColours(legend, mode)  number-chip colours {bg, fg} for 'classic' | 'allstarA' | 'allstarB' (legend.kit,
 *                         ALLSTAR_KITS of legends.js)
 *   mvpScore(s)           PTS + 1.2 REB + 1.5 AST + 3 STL + 3 BLK - 0.8 (FGA - FGM)
 *   pickMvp(rows, winner) winning-team row with the max score; ties -> more PTS -> lower roster index
 *   fmtHeight(m)          '1.98'
 *   class MatchView       one shared view of the current match (lineup, team keys, kit modes) used by HUD, screens,
 *                         indicators and the presenter: names, numbers, team colours, duplicate-number labels
 * Display composites and card stat chips come from legends.js (`composites(id)`, `topStats(id)`, section 2.4).
 * DOM:
 *   class Presenter       intro lower-thirds, team cards, matchup title, skip button, replay chrome (wipe, letterbox,
 *                         tag, vignette), toasts and first-time tips
 *
 * No CJK literals here (H6): every string comes from i18n.js or legends.js.
 */
import { t, pick, getLang, onLangChange } from '../i18n.js';
import { LEGENDS, TEAM_UI, ALLSTAR_KITS } from '../legends.js';

// ---------------------------------------------------------------------------------------------------------------
// Teams and kits
// ---------------------------------------------------------------------------------------------------------------

/** Section 2.9 team UI colours (legends.js TEAM_UI) with the i18n keys of each team's name and abbreviation. */
export const TEAM_STYLE = Object.freeze({
  dark: style('dark', 'team.dark', 'abbr.dark'),
  bright: style('bright', 'team.bright', 'abbr.bright'),
  allstarA: style('allstarA', 'team.white', 'abbr.white'),
  allstarB: style('allstarB', 'team.black', 'abbr.black'),
});

function style(key, nameKey, abbrKey) {
  const ui = TEAM_UI[key];
  return Object.freeze({ key, bg: ui.bg, text: ui.text, accent: ui.accent, nameKey, abbrKey });
}

const TEAM_ALIAS = { dark: 'dark', bright: 'bright', allstarA: 'allstarA', allstarB: 'allstarB', white: 'allstarA', black: 'allstarB', allstara: 'allstarA', allstarb: 'allstarB' };

/** Normalise any team descriptor (key string, alias, {id}/{key}/{team} object) to a TEAM_STYLE key. */
export function normTeamKey(v, fallback) {
  let k = v;
  if (k && typeof k === 'object') k = k.key || k.id || k.team || k.name;
  if (typeof k === 'string') {
    if (TEAM_ALIAS[k]) return TEAM_ALIAS[k];
    const lower = k.toLowerCase();
    if (TEAM_ALIAS[lower]) return TEAM_ALIAS[lower];
    if (lower.indexOf('dark') >= 0) return 'dark';
    if (lower.indexOf('bright') >= 0) return 'bright';
    if (lower.indexOf('white') >= 0) return 'allstarA';
    if (lower.indexOf('black') >= 0) return 'allstarB';
  }
  return fallback || 'dark';
}

function hexOf(v) {
  if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) return v;
  if (typeof v === 'number' && v >= 0) return '#' + (v & 0xffffff).toString(16).padStart(6, '0');
  return null;
}

/** Number-chip colours {bg, fg} of a legend in a kit mode ('classic' | 'allstarA' | 'allstarB'). */
export function kitColours(legend, mode) {
  if (mode === 'allstarA' || mode === 'allstarB') return { bg: ALLSTAR_KITS[mode].base, fg: ALLSTAR_KITS[mode].number };
  const kit = legend && legend.kit;
  const side = kit && typeof kit === 'object' ? kit[kit.classic] : null;
  const bg = side ? hexOf(side.base) : null, fg = side ? hexOf(side.number) : null;
  if (bg && fg) return { bg, fg };
  return { bg: '#3a4050', fg: '#ffffff' };
}

// ---------------------------------------------------------------------------------------------------------------
// MVP
// ---------------------------------------------------------------------------------------------------------------

function r0(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** MVP score of one box-score row (6.5.9). */
export function mvpScore(s) {
  return r0(s.pts) + 1.2 * r0(s.reb) + 1.5 * r0(s.ast) + 3 * r0(s.stl) + 3 * r0(s.blk) - 0.8 * (r0(s.fga) - r0(s.fgm));
}

/**
 * Pick the MVP row: winning-team rows only (all rows when winner is not 0/1), max mvpScore, ties -> more PTS -> lower
 * roster index (`index`, falling back to the row order inside its team).
 */
export function pickMvp(rows, winner) {
  if (!rows || !rows.length) return null;
  let best = null, bestScore = 0, bestIdx = 0;
  const seen = [0, 0];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const team = typeof r.team === 'number' ? r.team : -1;
    const idx = typeof r.index === 'number' ? r.index : (team >= 0 ? seen[team] : i);
    if (team >= 0) seen[team]++;
    if ((winner === 0 || winner === 1) && team !== winner) continue;
    const s = mvpScore(r);
    const better = !best || s > bestScore + 1e-9 ||
      (Math.abs(s - bestScore) <= 1e-9 && (r0(r.pts) > r0(best.pts) || (r0(r.pts) === r0(best.pts) && idx < bestIdx)));
    if (better) { best = r; bestScore = s; bestIdx = idx; }
  }
  return best;
}

export function fmtHeight(m) {
  return typeof m === 'number' && m > 0 ? m.toFixed(2) : '';
}

// ---------------------------------------------------------------------------------------------------------------
// MatchView
// ---------------------------------------------------------------------------------------------------------------

const EMPTY_IDS = Object.freeze([]);

/**
 * The current match as the UI sees it. Team index 0 = lineup.a, 1 = lineup.b (game team order).
 * set({lineup, teams, kits}): lineup {a:[ids], b:[ids], user:'a'|'b'}; teams = lineup.js teamNames(lineup) ({a,b},
 * [a,b] or keys/aliases); kits = lineup.js resolveKitModes(lineup) ({a, b} of 'classic'|'allstarA'|'allstarB').
 * `version` increments on every change (and on a language toggle) so DOM caches know when to rebuild.
 */
export class MatchView {
  constructor(legends) {
    this.legends = legends || LEGENDS;
    this.ids = [EMPTY_IDS, EMPTY_IDS];
    this.keys = ['dark', 'bright'];
    this.modes = ['classic', 'classic'];
    this.userTeam = 0;
    this.version = 0;
    this._team = Object.create(null);
    this._index = Object.create(null);
    this._dup = Object.create(null);
    this._unsub = onLangChange(() => { this.version++; });
  }

  setLegends(legends) {
    this.legends = legends || LEGENDS;
    this._rebuild();
  }

  set(m) {
    const o = m || {};
    const lu = o.lineup || null;
    if (lu) {
      this.ids = [Array.isArray(lu.a) ? lu.a.slice(0, 3) : EMPTY_IDS, Array.isArray(lu.b) ? lu.b.slice(0, 3) : EMPTY_IDS];
      this.userTeam = lu.user === 'b' ? 1 : 0;
    }
    const tm = o.teams;
    if (tm) {
      const a = Array.isArray(tm) ? tm[0] : tm.a;
      const b = Array.isArray(tm) ? tm[1] : tm.b;
      this.keys = [normTeamKey(a, 'dark'), normTeamKey(b, 'bright')];
    }
    const km = o.kits;
    if (km) {
      const a = Array.isArray(km) ? km[0] : km.a;
      const b = Array.isArray(km) ? km[1] : km.b;
      this.modes = [modeOf(a), modeOf(b)];
    }
    if (typeof o.userTeam === 'number') this.userTeam = o.userTeam === 1 ? 1 : 0;
    this._rebuild();
  }

  _rebuild() {
    this._team = Object.create(null);
    this._index = Object.create(null);
    this._dup = Object.create(null);
    for (let ti = 0; ti < 2; ti++) {
      const ids = this.ids[ti];
      for (let i = 0; i < ids.length; i++) { this._team[ids[i]] = ti; this._index[ids[i]] = i; }
      for (let i = 0; i < ids.length; i++) {
        for (let j = 0; j < ids.length; j++) {
          if (i !== j && this.number(ids[i]) !== '' && this.number(ids[i]) === this.number(ids[j])) this._dup[ids[i]] = true;
        }
      }
    }
    this.version++;
  }

  legend(id) {
    return this.legends && id ? this.legends[id] || null : null;
  }
  teamOf(id) {
    const v = this._team[id];
    return v === undefined ? -1 : v;
  }
  rosterIndex(id) {
    const v = this._index[id];
    return v === undefined ? -1 : v;
  }
  idsOf(team) {
    return this.ids[team === 1 ? 1 : 0];
  }
  teamKey(team) {
    return this.keys[team === 1 ? 1 : 0];
  }
  style(team) {
    return TEAM_STYLE[this.teamKey(team)];
  }
  teamName(team) {
    return t(this.style(team).nameKey);
  }
  teamAbbr(team) {
    return t(this.style(team).abbrKey);
  }
  kitMode(id) {
    const ti = this.teamOf(id);
    return ti < 0 ? 'classic' : this.modes[ti];
  }
  kitColours(id) {
    return kitColours(this.legend(id), this.kitMode(id));
  }
  /** Short name in the current language (captions, HUD, box score). */
  short(id) {
    const l = this.legend(id);
    return l ? String(pick(l.short || l.name) || id) : String(id || '');
  }
  /** Full name in the current language. */
  full(id) {
    const l = this.legend(id);
    return l ? String(pick(l.name) || id) : String(id || '');
  }
  /** Full name in the other language (secondary line of cards and lower-thirds). */
  other(id) {
    const l = this.legend(id);
    if (!l || !l.name) return '';
    return String(getLang() === 'zh' ? l.name.en || '' : l.name.zh || '');
  }
  number(id) {
    const l = this.legend(id);
    return l && l.number !== undefined && l.number !== null ? String(l.number) : '';
  }
  /** Off-screen indicator content: the number, or the short-name initial(s) when a teammate shares it (6.4.3). */
  indicatorLabel(id) {
    if (!this._dup[id]) return this.number(id);
    const l = this.legend(id);
    if (!l || !l.short) return this.number(id);
    return getLang() === 'zh' ? String(l.short.zh || '').charAt(0) : String(l.short.en || '').slice(0, 2).toUpperCase();
  }
  dispose() {
    if (this._unsub) this._unsub();
    this._unsub = null;
  }
}

function modeOf(v) {
  return v === 'allstarA' || v === 'allstarB' ? v : 'classic';
}

// ---------------------------------------------------------------------------------------------------------------
// Presenter (#present)
// ---------------------------------------------------------------------------------------------------------------

const RESERVED_KEYS = { KeyP: 1, Escape: 1, KeyM: 1, KeyT: 1 };
const TIP_STORE = 'legends3v3.tips.v1';
const TIP_MS = 2500;
const TOAST_MS = 1200;

export class Presenter {
  /**
   * @param {Document|Element} root  document (or #app)
   * @param {{match: MatchView, onSkipLegend?: Function, onSkipIntro?: Function, onSkipReplay?: Function}} opts
   */
  constructor(root, opts) {
    const o = opts || {};
    this.root = root || (typeof document !== 'undefined' ? document : null);
    this.doc = this.root && this.root.ownerDocument ? this.root.ownerDocument : this.root;
    this.match = o.match || new MatchView(LEGENDS);
    this.cb = { onSkipLegend: o.onSkipLegend || null, onSkipIntro: o.onSkipIntro || null, onSkipReplay: o.onSkipReplay || null };
    this.mode = null;            // null | 'intro' | 'replay'
    this._lt = null;             // last lower-third request (re-rendered on a language toggle)
    this._mu = null;             // last matchup request
    this._toastTimer = 0;
    this._tipTimer = 0;
    this._wipeTimer = 0;
    this._toast = null;
    this._tip = null;
    this._tipsSeen = this._loadTips();
    this._listeners = [];
    this.els = {};
    if (this.doc) this._attach();
    this._unsubLang = onLangChange(() => this.refreshLang());
  }

  _id(id) {
    return this.doc.getElementById(id);
  }

  _on(target, type, fn, options) {
    if (!target) return;
    target.addEventListener(type, fn, options);
    this._listeners.push([target, type, fn, options]);
  }

  _attach() {
    const ids = ['present', 'lowerThird', 'ltTeam', 'ltNum', 'ltName', 'ltOther', 'ltLine', 'matchup', 'muA', 'muB', 'muVs',
      'lbTop', 'lbBot', 'replayTag', 'skipBtn', 'skipLbl', 'wipe', 'wipeTag', 'vignette', 'presentTap', 'toast', 'tip'];
    for (let i = 0; i < ids.length; i++) this.els[ids[i]] = this._id(ids[i]);
    const e = this.els;
    this._on(e.skipBtn, 'click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (this.mode === 'intro' && this.cb.onSkipIntro) this.cb.onSkipIntro();
      else if (this.mode === 'replay' && this.cb.onSkipReplay) this.cb.onSkipReplay();
    });
    this._on(e.presentTap, 'pointerdown', (ev) => {
      if (ev.target === e.skipBtn) return;
      if (this.mode === 'intro' && this.cb.onSkipLegend) this.cb.onSkipLegend();
      else if (this.mode === 'replay' && this.cb.onSkipReplay) this.cb.onSkipReplay();
    });
    // Window capture phase runs before input.js's document listeners: a skip key is consumed here so Escape in the
    // intro skips instead of also pausing (the R#21 class of double handling).
    const win = this.doc.defaultView;
    if (win) {
      this._on(win, 'keydown', (ev) => {
        if (ev.repeat || !this.mode) return;
        if (this.mode === 'intro' && (ev.code === 'Escape' || ev.code === 'Enter' || ev.code === 'NumpadEnter')) {
          ev.stopImmediatePropagation();
          ev.preventDefault();
          if (this.cb.onSkipIntro) this.cb.onSkipIntro();
        } else if (this.mode === 'replay' && !RESERVED_KEYS[ev.code]) {
          ev.stopImmediatePropagation();
          if (this.cb.onSkipReplay) this.cb.onSkipReplay();
        }
      }, true);
    }
  }

  setCallbacks(cb) {
    Object.assign(this.cb, cb || {});
  }

  // ---- intro ----

  /** Enter / leave intro mode: shows the skip button and the tap-to-skip layer. */
  intro(on) {
    this._setMode(on ? 'intro' : null);
    if (!on) { this.hideLowerThird(); this.hideMatchup(); }
  }

  /** Lower-third of one legend; `first` adds the "{team} · Starters" header (6.5.6). */
  lowerThird(id, first) {
    this._lt = { kind: 'legend', id, first: !!first };
    this._renderLowerThird();
  }

  /** Short-intro team card: team name + the three names on one lower-third (6.4.4). */
  teamCard(team) {
    this._lt = { kind: 'team', team: team === 1 ? 1 : 0 };
    this._renderLowerThird();
  }

  hideLowerThird() {
    this._lt = null;
    const e = this.els;
    if (e.lowerThird) e.lowerThird.classList.remove('show');
  }

  _renderLowerThird() {
    const e = this.els, lt = this._lt, m = this.match;
    if (!lt || !e.lowerThird) return;
    if (lt.kind === 'legend') {
      const l = m.legend(lt.id);
      const team = m.teamOf(lt.id);
      const c = m.kitColours(lt.id);
      e.ltNum.textContent = m.number(lt.id);
      e.ltNum.style.background = c.bg;
      e.ltNum.style.color = c.fg;
      e.ltName.textContent = m.full(lt.id);
      e.ltOther.textContent = m.other(lt.id);
      const ovr = l && l.ratings ? l.ratings.overall : '';
      const h = l && l.stats ? fmtHeight(l.stats.heightM) : '';
      e.ltLine.textContent = t('intro.line', { ovr, h, era: l ? l.era || '' : '' });
      if (e.ltTeam) {
        e.ltTeam.textContent = lt.first && team >= 0 ? t('intro.starters', { team: m.teamName(team) }) : '';
        e.ltTeam.classList.toggle('hidden', !(lt.first && team >= 0));
      }
      e.lowerThird.style.setProperty('--tc', team >= 0 ? m.style(team).bg : '#3a4050');
    } else {
      const st = m.style(lt.team);
      const ids = m.idsOf(lt.team);
      e.ltNum.textContent = m.teamAbbr(lt.team);
      e.ltNum.style.background = st.bg;
      e.ltNum.style.color = st.text;
      e.ltName.textContent = m.teamName(lt.team);
      e.ltOther.textContent = '';
      let names = '';
      for (let i = 0; i < ids.length; i++) names += (i ? ' · ' : '') + m.short(ids[i]);
      e.ltLine.textContent = names;
      // The team card already carries the team name: no separate "{team} · Starters" header.
      if (e.ltTeam) { e.ltTeam.textContent = ''; e.ltTeam.classList.add('hidden'); }
      e.lowerThird.style.setProperty('--tc', st.bg);
    }
    e.lowerThird.classList.toggle('team', lt.kind === 'team');
    // Restart the slide-in: remove, force a style flush, add (6.5.6: -40 px + fade 0.25 s).
    e.lowerThird.classList.remove('show');
    void e.lowerThird.offsetWidth;
    e.lowerThird.classList.add('show');
  }

  /** Matchup title "{teamA} VS {teamB}" with team-colour underlines (intro shot 8). */
  matchup() {
    this._mu = true;
    const e = this.els, m = this.match;
    if (!e.matchup) return;
    e.muA.textContent = m.teamName(0);
    e.muB.textContent = m.teamName(1);
    e.muVs.textContent = t('intro.vs');
    e.muA.style.setProperty('--tc', m.style(0).bg === '#121212' ? '#5a5f6e' : m.style(0).bg);
    e.muB.style.setProperty('--tc', m.style(1).bg === '#121212' ? '#5a5f6e' : m.style(1).bg);
    e.matchup.classList.add('show');
  }

  hideMatchup() {
    this._mu = null;
    if (this.els.matchup) this.els.matchup.classList.remove('show');
  }

  // ---- replay chrome (6.4.6) ----

  /**
   * phase: 'wipeIn' (gold bar sweep with the tag, 0.25 s), 'on' (letterbox 7 % slides in 0.2 s, tag, vignette, skip),
   * 'off' (wipe-out 0.25 s; fast = true -> 0.15 s after a skip), 'none' (hide everything immediately).
   */
  replay(phase, fast) {
    const e = this.els;
    const p = e.present;
    if (!p) return;
    clearTimeout(this._wipeTimer);
    if (phase === 'wipeIn') {
      this._setMode('replay');
      this._wipe(250);
    } else if (phase === 'on') {
      this._setMode('replay');
      p.classList.add('replayOn');
    } else if (phase === 'off') {
      this._wipe(fast ? 150 : 250);
      this._wipeTimer = setTimeout(() => { p.classList.remove('replayOn'); this._setMode(null); }, fast ? 150 : 250);
    } else {
      p.classList.remove('replayOn', 'wiping');
      this._setMode(null);
    }
  }

  _wipe(ms) {
    const e = this.els;
    if (!e.wipe) return;
    e.wipe.style.animationDuration = ms + 'ms';
    e.present.classList.remove('wiping');
    void e.wipe.offsetWidth;
    e.present.classList.add('wiping');
  }

  _setMode(mode) {
    this.mode = mode;
    const p = this.els.present;
    if (!p) return;
    p.classList.toggle('intro', mode === 'intro');
    p.classList.toggle('replay', mode === 'replay');
    if (this.els.skipLbl) {
      const key = mode === 'replay' ? 'replay.skip' : 'intro.skip';
      this.els.skipLbl.setAttribute('data-i18n', key);
      this.els.skipLbl.textContent = t(key);
    }
  }

  // ---- toasts and tips ----

  /** Toast line (z 9) for `ms` (default 1.2 s), e.g. toast.allstar, toast.webgl1, toast.tier {tier}. */
  toast(key, params, ms) {
    const e = this.els.toast;
    this._toast = { key, params: params || null };
    if (!e) return;
    e.textContent = t(key, params);
    e.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { e.classList.remove('show'); this._toast = null; }, typeof ms === 'number' && ms > 0 ? ms : TOAST_MS);
  }

  /** In-game tip under the caption band for 2.5 s (GP 9.5); hidden at once while the shot meter shows. */
  tip(key, params) {
    const e = this.els.tip;
    this._tip = { key, params: params || null };
    if (!e) return;
    e.textContent = t(key, params);
    e.classList.add('show');
    clearTimeout(this._tipTimer);
    this._tipTimer = setTimeout(() => this.hideTip(), TIP_MS);
  }

  /** Show a first-time tip once per browser (stored with try/catch); returns true when it was shown. */
  tipOnce(key) {
    if (this._tipsSeen[key]) return false;
    this._tipsSeen[key] = 1;
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(TIP_STORE, JSON.stringify(this._tipsSeen));
    } catch (err) {
      // in-memory only: the tip may show again next launch
    }
    this.tip(key);
    return true;
  }

  hideTip() {
    clearTimeout(this._tipTimer);
    this._tip = null;
    if (this.els.tip) this.els.tip.classList.remove('show');
  }

  _loadTips() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TIP_STORE) : null;
      const o = raw ? JSON.parse(raw) : null;
      return o && typeof o === 'object' ? o : {};
    } catch (err) {
      return {};
    }
  }

  /** Per-frame hook (allocation-free): hides the tip while the meter is active. */
  update(meterActive) {
    if (meterActive && this._tip) this.hideTip();
  }

  refreshLang() {
    if (this._lt) this._renderLowerThird();
    if (this._mu) this.matchup();
    if (this._toast && this.els.toast) this.els.toast.textContent = t(this._toast.key, this._toast.params);
    if (this._tip && this.els.tip) this.els.tip.textContent = t(this._tip.key, this._tip.params);
    if (this.els.skipLbl) this.els.skipLbl.textContent = t(this.mode === 'replay' ? 'replay.skip' : 'intro.skip');
  }

  dispose() {
    for (let i = 0; i < this._listeners.length; i++) {
      const l = this._listeners[i];
      l[0].removeEventListener(l[1], l[2], l[3]);
    }
    this._listeners.length = 0;
    clearTimeout(this._toastTimer);
    clearTimeout(this._tipTimer);
    clearTimeout(this._wipeTimer);
    if (this._unsubLang) this._unsubLang();
  }
}

