/**
 * ui/lineup.js - the lineup / draft screen, DOM side (spec v2 sections 1.4.2, 5.12, 6.5.5; GP 12.2; PR 5.5).
 *
 *   new LineupScreen(root, { lineup, legends, match?, rng?, seed?, persist?, onSwap(slotA, slotB), onSelect(id|null),
 *                            onUser('a'|'b'), onKits(mode), onShuffle(), onReset(), onStart(), onBack(),
 *                            onDrag(dxPx), onRelease(vxPxPerS) })
 *
 * The screen only draws DOM and reports intents. Pure lineup logic comes from src/lineup.js (WP4): swap, setHandler,
 * setUser, setKits, shuffle, resetLineup, resolveKitModes, teamNames, kitClash, entersAllStar, saveLineup; the screen
 * re-renders from the (new) lineup they return. Composites and stat chips come from legends.js (section 2.4). Slots are flat indices 0..5 (0-2 = team A = lineup.a, 3-5 = team B = lineup.b). Every callback receives the
 * new lineup as an extra last argument. flow.js (WP9) owns the 3D side (arc placement, 0.6 s swap jog, setKit at the
 * midpoint, turntable via director.setMode('lineup', {focusId, yawDeg})).
 *
 * Interactions (5.12.2): tap a card -> selected (2 px #ff7a1f outline); tap another -> swap (cross-team swaps teams,
 * same team swaps order, which moves the star when index 0 is involved); tap the selected card again -> deselect; tap
 * the number / star area of a user-team card -> he becomes the ball handler (index 0). Controls: YOU [A][B], Kits
 * [Auto][Classic][All-Star] (C17), Shuffle (seeded Fisher-Yates via lineup.js; rng = gameplay seed ^ 0x5EED), Reset,
 * Start; hint `lineup.swapHint` (or the `lineup.clash` warning); a switch into All-Star shows `toast.allstar` 1.2 s.
 * The stage area (transparent, over the 3D canvas) reports turntable drags: onDrag(dx px since the last move) and
 * onRelease(horizontal velocity px/s at release).
 * Card content: landscape (height > 360 px) number chip, short + full name, height, OVR, top-3 stat chips; portrait and
 * short landscape OVR only, stat chips in the detail card (C18). Detail card: number badge, names, OVR circle, four
 * composites (2.4), up to four ability chips, height/era line.
 */
import { t, onLangChange } from '../i18n.js';
import { Rng } from '../math.js';
import { swap, setHandler, setUser, setKits, shuffle, resetLineup, resolveKitModes, teamNames, kitClash, entersAllStar,
  saveLineup, normalizeLineup } from '../lineup.js';
import { LEGENDS, composites, topStats } from '../legends.js';
import { MatchView, fmtHeight } from './present.js';

const SHUFFLE_SALT = 0x5EED;
const TOAST_MS = 1200;
const VEL_WINDOW_MS = 100;    // release velocity = displacement over the last 0.1 s of the drag
const COMP_KEYS = ['sht', 'drv', 'ins', 'def'];    // legends.js composites(id) fields = i18n comp.* suffixes

/** A valid copy of l (lineup.js normalizeLineup); an invalid lineup falls back to the default. */
function cloneLineup(l) {
  return normalizeLineup(l) || resetLineup();
}

function idAt(l, slot) {
  return slot < 3 ? l.a[slot] : l.b[slot - 3];
}

function mk(doc, tag, cls, parent, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function i18n(e, key) {
  e.setAttribute('data-i18n', key);
  e.textContent = t(key);
  return e;
}

export class LineupScreen {
  constructor(root, opts) {
    const o = opts || {};
    this.root = root;
    this.doc = root.ownerDocument;
    this.legends = o.legends || LEGENDS;
    this.match = o.match || new MatchView(this.legends);
    if (!this.match.legends && this.legends) this.match.setLegends(this.legends);
    this.persist = o.persist !== false;
    this.rng = o.rng || new Rng(((o.seed | 0) ^ SHUFFLE_SALT) | 0);
    this.cb = {};
    const names = ['onSwap', 'onSelect', 'onUser', 'onKits', 'onShuffle', 'onReset', 'onStart', 'onBack', 'onDrag', 'onRelease'];
    for (let i = 0; i < names.length; i++) this.cb[names[i]] = typeof o[names[i]] === 'function' ? o[names[i]] : null;
    this._lineup = cloneLineup(o.lineup || resetLineup());
    this.selected = -1;
    this._comp = { sht: 0, drv: 0, ins: 0, def: 0 };
    this._toastTimer = 0;
    this._drag = null;
    this._listeners = [];
    this._build();
    this._unsubLang = onLangChange(() => this.render());
    this._applyMatch();
    this.render();
  }

  get lineup() {
    return this._lineup;
  }

  /** Replace the lineup (e.g. URL ?lineup= or a stored one) and re-render; selection is cleared. */
  setLineup(l) {
    this._lineup = cloneLineup(l);
    this.selected = -1;
    this._applyMatch();
    this.render();
  }

  _on(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this._listeners.push([target, type, fn, options]);
  }

  _click(el, fn) {
    this._on(el, 'click', (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(ev); });
  }

  // ---- DOM ----

  _build() {
    const doc = this.doc, root = this.root;
    root.textContent = '';
    root.classList.add('lineup');
    const top = mk(doc, 'div', 'luTop', root);
    this.btnBack = mk(doc, 'button', 'iconBtn luBack', top, '‹');
    this.btnBack.type = 'button';
    this.btnBack.setAttribute('data-i18n-aria', 'btn.back');
    this.title = i18n(mk(doc, 'h2', 'luTitle', top), 'lineup.title');
    const ctrl = mk(doc, 'div', 'luCtrl', top);
    const segU = mk(doc, 'div', 'luSeg', ctrl);
    this.lblYou = i18n(mk(doc, 'span', 'segLbl', segU), 'lineup.you');
    this.userBtns = [];
    for (let i = 0; i < 2; i++) {
      const b = mk(doc, 'button', 'opt', segU);
      b.type = 'button';
      b.setAttribute('data-user', i === 0 ? 'a' : 'b');
      this.userBtns.push(b);
      this._click(b, () => this._setUser(i === 0 ? 'a' : 'b'));
    }
    const segK = mk(doc, 'div', 'luSeg', ctrl);
    this.lblKits = i18n(mk(doc, 'span', 'segLbl', segK), 'lineup.kits');
    this.kitBtns = [];
    const kitModes = ['auto', 'classic', 'allstar'];
    for (let i = 0; i < 3; i++) {
      const b = mk(doc, 'button', 'opt', segK);
      b.type = 'button';
      b.setAttribute('data-kits', kitModes[i]);
      i18n(b, 'lineup.kits.' + kitModes[i]);
      this.kitBtns.push(b);
      this._click(b, () => this._setKits(kitModes[i]));
    }
    this.btnHelp = mk(doc, 'button', 'iconBtn luHelpBtn', top, '?');
    this.btnHelp.type = 'button';
    this.btnHelp.setAttribute('data-i18n-aria', 'btn.help');

    const body = mk(doc, 'div', 'luBody', root);
    this.teams = [];
    this.cards = [];
    for (let ti = 0; ti < 2; ti++) {
      const sec = mk(doc, 'section', 'luTeam luTeam' + (ti === 0 ? 'A' : 'B'), body);
      const head = mk(doc, 'header', 'luHead', sec);
      const sw = mk(doc, 'span', 'swatch', head);
      const nm = mk(doc, 'span', 'tname', head);
      const you = i18n(mk(doc, 'span', 'youTag', head), 'lineup.you');
      const list = mk(doc, 'div', 'cards', sec);
      this.teams.push({ sec, sw, nm, you });
      for (let i = 0; i < 3; i++) this.cards.push(this._buildCard(list, ti * 3 + i));
      if (ti === 0) {
        this.stage = mk(doc, 'div', 'luStage', body);
        this._buildDetail(this.stage);
      }
    }

    const bottom = mk(doc, 'div', 'luBottom', root);
    this.hint = mk(doc, 'div', 'luHint', bottom);
    const acts = mk(doc, 'div', 'luActs', bottom);
    this.btnShuffle = i18n(mk(doc, 'button', 'secondary', acts), 'lineup.shuffle');
    this.btnReset = i18n(mk(doc, 'button', 'secondary', acts), 'lineup.reset');
    this.btnStart = i18n(mk(doc, 'button', 'primary luStart', bottom), 'lineup.start');
    this.btnShuffle.type = this.btnReset.type = this.btnStart.type = 'button';
    this.toastEl = mk(doc, 'div', 'luToast', root);
    this.helpEl = mk(doc, 'div', 'luHelp hidden', root);
    i18n(this.helpEl, 'lineup.help');

    this._click(this.btnBack, () => { if (this.cb.onBack) this.cb.onBack(this._lineup); });
    this._click(this.btnHelp, () => this.helpEl.classList.toggle('hidden'));
    this._click(this.helpEl, () => this.helpEl.classList.add('hidden'));
    this._click(this.btnShuffle, () => this._shuffle());
    this._click(this.btnReset, () => this._reset());
    this._click(this.btnStart, () => { if (this.cb.onStart) this.cb.onStart(this._lineup); });
    this._wireStage();
  }

  _buildCard(parent, slot) {
    const doc = this.doc;
    const el = mk(doc, 'div', 'card', parent);
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('data-slot', String(slot));
    const rowA = mk(doc, 'div', 'cRow cRowA', el);
    const num = mk(doc, 'span', 'cNum', rowA);
    const nm = mk(doc, 'span', 'cName', rowA);
    const ovr = mk(doc, 'span', 'cOvr', rowA);
    const rowB = mk(doc, 'div', 'cRow cRowB', el);
    const full = mk(doc, 'span', 'cFull', rowB);
    const ht = mk(doc, 'span', 'cHt', rowB);
    const chips = mk(doc, 'div', 'cChips', el);
    const chipEls = [];
    for (let i = 0; i < 3; i++) {
      const c = mk(doc, 'span', 'sChip', chips);
      chipEls.push({ el: c, lb: mk(doc, 'span', 'lb', c), v: mk(doc, 'b', '', c) });
    }
    const star = mk(doc, 'button', 'cStar', el);
    star.type = 'button';
    star.setAttribute('data-i18n-aria', 'lineup.makeHandler');
    const starGlyph = mk(doc, 'span', 'g', star, '★');
    const card = { el, slot, num, nm, ovr, full, ht, chipEls, star, starGlyph };
    this._click(star, () => this._makeHandler(slot));
    this._click(el, () => this._tapCard(slot));
    this._on(el, 'keydown', (ev) => {
      if (ev.code === 'Enter' || ev.code === 'Space') { ev.preventDefault(); this._tapCard(slot); }
    });
    return card;
  }

  _buildDetail(parent) {
    const doc = this.doc;
    const d = mk(doc, 'div', 'luDetail', parent);
    const head = mk(doc, 'div', 'dHead', d);
    const num = mk(doc, 'span', 'dNum', head);
    const names = mk(doc, 'div', 'dNames', head);
    const name = mk(doc, 'div', 'dName', names);
    const other = mk(doc, 'div', 'dOther', names);
    const ovr = mk(doc, 'span', 'dOvr', head);
    const bars = mk(doc, 'div', 'dBars', d);
    const barEls = [];
    for (let i = 0; i < 4; i++) {
      const b = mk(doc, 'div', 'dBar', bars);
      const top = mk(doc, 'div', 'dBarTop', b);
      const lb = i18n(mk(doc, 'span', 'lb', top), 'comp.' + COMP_KEYS[i]);
      const v = mk(doc, 'span', 'v', top);
      const track = mk(doc, 'div', 'track', b);
      const fill = mk(doc, 'div', 'fill', track);
      barEls.push({ lb, v, fill });
    }
    const foot = mk(doc, 'div', 'dFoot', d);
    const abil = mk(doc, 'div', 'dAbil', foot);
    const meta = mk(doc, 'div', 'dMeta', foot);
    const stats = mk(doc, 'div', 'dStats', d);
    this.detail = { el: d, num, name, other, ovr, barEls, abil, meta, stats };
  }

  _wireStage() {
    const st = this.stage;
    this._on(st, 'pointerdown', (ev) => {
      if (ev.target !== st) return;      // the detail card is not a drag surface
      if (this._drag) return;
      this._drag = { id: ev.pointerId, x: ev.clientX, hist: [], moved: 0 };
      this._drag.hist.push(ev.clientX, ev.timeStamp);
      try { st.setPointerCapture(ev.pointerId); } catch (err) { /* capture is best effort */ }
    });
    this._on(st, 'pointermove', (ev) => {
      const d = this._drag;
      if (!d || ev.pointerId !== d.id) return;
      const dx = ev.clientX - d.x;
      d.x = ev.clientX;
      d.moved += Math.abs(dx);
      d.hist.push(ev.clientX, ev.timeStamp);
      if (d.hist.length > 32) d.hist.splice(0, 2);
      if (dx !== 0 && this.cb.onDrag) this.cb.onDrag(dx);
    });
    const end = (ev) => {
      const d = this._drag;
      if (!d || ev.pointerId !== d.id) return;
      this._drag = null;
      // Velocity over the last 0.1 s of samples: (x_last - x_first) / (t_last - t_first).
      const h = d.hist, n = h.length;
      let vx = 0;
      if (n >= 4) {
        const tLast = h[n - 1], xLast = h[n - 2];
        let k = n - 4;
        while (k > 0 && tLast - h[k + 1] < VEL_WINDOW_MS) k -= 2;
        const dt = (tLast - h[k + 1]) / 1000;
        if (dt > 0) vx = (xLast - h[k]) / dt;
      }
      if (ev.type === 'pointercancel') vx = 0;
      if (this.cb.onRelease) this.cb.onRelease(vx);
    };
    this._on(st, 'pointerup', end);
    this._on(st, 'pointercancel', end);
  }

  // ---- intents ----

  _tapCard(slot) {
    this.helpEl.classList.add('hidden');
    if (this.selected < 0) {
      this.selected = slot;
      this.render();
      if (this.cb.onSelect) this.cb.onSelect(idAt(this._lineup, slot));
      return;
    }
    if (this.selected === slot) {
      this.selected = -1;
      this.render();
      if (this.cb.onSelect) this.cb.onSelect(null);
      return;
    }
    const a = this.selected;
    this.selected = -1;
    this._change(swap(this._lineup, a, slot));
    if (this.cb.onSwap) this.cb.onSwap(a, slot, this._lineup);
    if (this.cb.onSelect) this.cb.onSelect(null);
  }

  _makeHandler(slot) {
    const userBase = this._lineup.user === 'b' ? 3 : 0;
    if (slot < userBase || slot > userBase + 2) { this._tapCard(slot); return; }
    if (slot === userBase) return;
    this.selected = -1;
    this._change(setHandler(this._lineup, slot));
    if (this.cb.onSwap) this.cb.onSwap(userBase, slot, this._lineup);
  }

  _setUser(u) {
    if (this._lineup.user === u) return;
    this._change(setUser(this._lineup, u));
    if (this.cb.onUser) this.cb.onUser(u, this._lineup);
  }

  _setKits(mode) {
    if (this._lineup.kits === mode) return;
    this._change(setKits(this._lineup, mode));
    if (this.cb.onKits) this.cb.onKits(mode, this._lineup);
  }

  _shuffle() {
    this.selected = -1;
    this._change(shuffle(this._lineup, this.rng));
    if (this.cb.onShuffle) this.cb.onShuffle(this._lineup);
  }

  _reset() {
    this.selected = -1;
    this._change(resetLineup());
    if (this.cb.onReset) this.cb.onReset(this._lineup);
  }

  /** Adopt a lineup returned by lineup.js, persist it, toast a switch into All-Star kits, re-render. */
  _change(next) {
    const prev = this._lineup;
    this._lineup = cloneLineup(next && next.a && next.b ? next : prev);
    if (entersAllStar(prev, this._lineup)) this._toast('toast.allstar');
    if (this.persist) saveLineup(this._lineup);
    this._applyMatch();
    this.render();
  }

  _applyMatch() {
    this.match.set({ lineup: this._lineup, teams: teamNames(this._lineup), kits: resolveKitModes(this._lineup) });
  }

  _toast(key) {
    const e = this.toastEl;
    e.textContent = t(key);
    e.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => e.classList.remove('show'), TOAST_MS);
  }

  // ---- render ----

  render() {
    const l = this._lineup, m = this.match;
    const userTeam = l.user === 'b' ? 1 : 0;
    for (let i = 0; i < 2; i++) {
      this.userBtns[i].textContent = m.teamAbbr(i);
      this.userBtns[i].classList.toggle('selected', i === userTeam);
      this.userBtns[i].setAttribute('aria-pressed', i === userTeam ? 'true' : 'false');
    }
    for (let i = 0; i < 3; i++) {
      const on = this.kitBtns[i].getAttribute('data-kits') === l.kits;
      this.kitBtns[i].classList.toggle('selected', on);
      this.kitBtns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (let ti = 0; ti < 2; ti++) {
      const tm = this.teams[ti], st = m.style(ti);
      tm.nm.textContent = m.teamName(ti);
      tm.sw.style.background = st.bg;
      tm.sec.style.setProperty('--tc', st.bg);
      tm.you.classList.toggle('hidden', ti !== userTeam);
      tm.sec.classList.toggle('user', ti === userTeam);
    }
    for (let s = 0; s < 6; s++) this._renderCard(this.cards[s], idAt(l, s), s, userTeam);
    const clash = kitClash(l);
    this.hint.textContent = t(clash ? 'lineup.clash' : 'lineup.swapHint');
    this.hint.classList.toggle('warn', clash);
    const focusSlot = this.selected >= 0 ? this.selected : userTeam * 3;
    this._renderDetail(idAt(l, focusSlot));
    this.root.classList.toggle('hasSel', this.selected >= 0);
  }

  _renderCard(c, id, slot, userTeam) {
    const m = this.match, lg = m.legend(id);
    const team = slot < 3 ? 0 : 1, idx = slot % 3;
    const col = m.kitColours(id);
    c.el.setAttribute('data-id', id || '');
    c.num.textContent = m.number(id);
    c.num.style.background = col.bg;
    c.num.style.color = col.fg;
    c.nm.textContent = m.short(id);
    c.full.textContent = m.full(id);
    c.ht.textContent = lg && lg.stats ? t('lineup.height', { h: fmtHeight(lg.stats.heightM) }) : '';
    c.ovr.textContent = lg && lg.ratings ? String(lg.ratings.overall) : '';
    const top = topStats(id, 3) || [];
    for (let i = 0; i < 3; i++) {
      const ch = c.chipEls[i];
      ch.lb.textContent = top[i] ? t('statShort.' + top[i].key) : '';
      ch.el.title = top[i] ? t('stat.' + top[i].key) : '';
      ch.v.textContent = top[i] ? String(top[i].value) : '';
    }
    const isUser = team === userTeam;
    const handler = isUser && idx === 0;
    c.star.classList.toggle('hidden', !isUser);
    c.el.classList.toggle('handler', handler);
    c.starGlyph.textContent = handler ? '★' : '☆';
    c.el.classList.toggle('selected', this.selected === slot);
    c.el.setAttribute('aria-pressed', this.selected === slot ? 'true' : 'false');
    c.el.setAttribute('aria-label', m.full(id));
  }

  _renderDetail(id) {
    const d = this.detail, m = this.match, lg = m.legend(id);
    const col = m.kitColours(id);
    d.el.setAttribute('data-id', id || '');
    d.num.textContent = m.number(id);
    d.num.style.background = col.bg;
    d.num.style.color = col.fg;
    d.name.textContent = m.full(id);
    d.other.textContent = m.other(id);
    d.ovr.textContent = lg && lg.ratings ? String(lg.ratings.overall) : '';
    const comp = composites(id, this._comp) || this._comp;
    for (let i = 0; i < 4; i++) {
      const v = comp[COMP_KEYS[i]] || 0;
      d.barEls[i].v.textContent = String(v);
      d.barEls[i].fill.style.transform = 'scaleX(' + (Math.max(0, Math.min(99, v)) / 99).toFixed(3) + ')';
    }
    d.abil.textContent = '';
    const ab = lg && Array.isArray(lg.abilities) ? lg.abilities : [];
    for (let i = 0; i < ab.length && i < 4; i++) {
      const chip = this.doc.createElement('span');
      chip.className = 'aChip';
      chip.textContent = t('ability.' + ab[i]);
      d.abil.appendChild(chip);
    }
    d.meta.textContent = lg && lg.stats ? t('lineup.height', { h: fmtHeight(lg.stats.heightM) }) + ' · ' + (lg.era || '') : '';
    // Top-3 stat chips move into the detail card in portrait and short landscape (C18); CSS decides visibility.
    d.stats.textContent = '';
    const top = topStats(id, 3) || [];
    for (let i = 0; i < top.length; i++) {
      const s = this.doc.createElement('span');
      s.className = 'sChip';
      s.textContent = t('stat.' + top[i].key) + ' ' + top[i].value;
      d.stats.appendChild(s);
    }
    d.el.style.setProperty('--tc', m.teamOf(id) >= 0 ? m.style(m.teamOf(id)).bg : '#3a4050');
  }

  dispose() {
    for (let i = 0; i < this._listeners.length; i++) {
      const l = this._listeners[i];
      l[0].removeEventListener(l[1], l[2], l[3]);
    }
    this._listeners.length = 0;
    clearTimeout(this._toastTimer);
    if (this._unsubLang) this._unsubLang();
  }
}

