/**
 * ui/loading.js - the loading screen controller (spec v2 sections 6.5.3 and 6.6; PR 5.3, 7.3, 7.4).
 *
 * The loading screen itself is static HTML in index.html (#loading, visible before any JS runs: logo, shimmering bar,
 * status line, rotating tip, legal note). This module only drives it:
 *
 *   const loader = new Loader(document.getElementById('loading'));
 *   loader.phase(labelKey)        'load.engine' | 'load.assets' | 'load.paint' | 'load.arena' | 'load.compile';
 *                                 every label stays >= 0.25 s on screen (later labels queue)
 *   loader.progress(f)            global fraction 0..1; never moves backwards; stops the CSS shimmer
 *   loader.bytes(loaded, total)   byte counter "1.2 / 3.4 MB" next to the percentage (asset phase)
 *   loader.error({file, reason}, onRetry, onSimple)   #loadError panel (z 21): loadError.title, "{file} ({reason})",
 *                                 44 px buttons Retry / Simple mode; console.warn (never console.error)
 *   loader.hideError()            back to the progress view (after Retry)
 *   loader.done() -> Promise      0.3 s fade-out, then hidden; tip rotation stops
 *
 *   LOAD_WEIGHTS                  phase weights (sum 1.00): code 0.10, assets 0.47, paint 0.18, kit 0.04, arena 0.08,
 *                                 compile 0.13 (environment + shader warm-up)
 *   stageProgress(stage, f)       global fraction for fraction f inside one weighted stage (stages in that order)
 *
 * Tips rotate every 3.0 s through tip.1 ... tip.6. All strings come from i18n.js and re-render on a language toggle.
 */
import { t, onLangChange } from '../i18n.js';

export const LOAD_WEIGHTS = Object.freeze({ code: 0.10, assets: 0.47, paint: 0.18, kit: 0.04, arena: 0.08, compile: 0.13 });
const STAGES = ['code', 'assets', 'paint', 'kit', 'arena', 'compile'];
const STAGE_START = {};
{
  let acc = 0;
  for (let i = 0; i < STAGES.length; i++) { STAGE_START[STAGES[i]] = acc; acc += LOAD_WEIGHTS[STAGES[i]]; }
}

/** Global progress for fraction f (0..1) of `stage`: start of the stage + weight x f. */
export function stageProgress(stage, f) {
  const w = LOAD_WEIGHTS[stage];
  if (w === undefined) return 0;
  const c = f < 0 ? 0 : f > 1 ? 1 : f;
  return STAGE_START[stage] + w * c;
}

export const MIN_PHASE_MS = 250;
export const TIP_MS = 3000;
export const FADE_MS = 300;
const TIP_COUNT = 6;
const MB = 1048576;

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export class Loader {
  /** @param {HTMLElement|null} root  the #loading element */
  constructor(root) {
    this.root = root || null;
    this.doc = root && root.ownerDocument ? root.ownerDocument : (typeof document !== 'undefined' ? document : null);
    const q = (id) => (this.doc ? this.doc.getElementById(id) : null);
    this.els = {
      fill: q('loadFill'), bar: q('loadBar'), status: q('loadStatus'), tip: q('loadTip'),
      error: q('loadError'), errTitle: q('loadErrTitle'), errDetail: q('loadErrDetail'), retry: q('btnRetry'), simple: q('btnSimple'),
    };
    this.value = 0;
    this.label = 'load.engine';
    this._labelAt = nowMs();
    this._pending = [];
    this._labelTimer = 0;
    this._loaded = -1;
    this._total = -1;
    this._tipIdx = 0;
    this._done = false;
    this._err = null;
    this._onRetry = null;
    this._onSimple = null;
    this._tipTimer = setInterval(() => this._nextTip(), TIP_MS);
    this._wire();
    this._unsubLang = onLangChange(() => this._renderAll());
    this._renderAll();
  }

  _wire() {
    const e = this.els;
    if (e.retry) e.retry.addEventListener('click', (ev) => {
      ev.preventDefault();
      const cb = this._onRetry;
      this.hideError();
      if (cb) cb();
    });
    if (e.simple) e.simple.addEventListener('click', (ev) => {
      ev.preventDefault();
      const cb = this._onSimple;
      this.hideError();
      if (cb) cb();
    });
  }

  /** Show a phase label; labels change at most every 0.25 s so each one is readable. */
  phase(labelKey) {
    if (!labelKey || this._done) return;
    const since = nowMs() - this._labelAt;
    if (this._pending.length === 0 && since >= MIN_PHASE_MS) {
      this._setLabel(labelKey);
      return;
    }
    if (this._pending[this._pending.length - 1] !== labelKey && this.label !== labelKey) this._pending.push(labelKey);
    if (!this._labelTimer) this._schedule();
  }

  _schedule() {
    const wait = Math.max(0, MIN_PHASE_MS - (nowMs() - this._labelAt));
    this._labelTimer = setTimeout(() => {
      this._labelTimer = 0;
      const next = this._pending.shift();
      if (next) this._setLabel(next);
      if (this._pending.length) this._schedule();
    }, wait);
  }

  _setLabel(key) {
    this.label = key;
    this._labelAt = nowMs();
    this._renderStatus();
  }

  /** Global progress 0..1 (never backwards). */
  progress(f) {
    if (typeof f !== 'number' || !Number.isFinite(f)) return;
    const v = f < 0 ? 0 : f > 1 ? 1 : f;
    if (v <= this.value && this.root && this.root.classList.contains('determinate')) return;
    if (v > this.value) this.value = v;
    if (this.root) this.root.classList.add('determinate');
    if (this.els.fill) this.els.fill.style.transform = 'scaleX(' + this.value.toFixed(4) + ')';
    if (this.els.bar) this.els.bar.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
    this._renderStatus();
  }

  /** Byte counter of the asset phase. */
  bytes(loaded, total) {
    this._loaded = typeof loaded === 'number' ? loaded : -1;
    this._total = typeof total === 'number' ? total : -1;
    this._renderStatus();
  }

  _renderStatus() {
    const e = this.els.status;
    if (!e) return;
    let s = t('load.status', { label: t(this.label), pct: Math.floor(this.value * 100) });
    if (this._loaded >= 0 && this._total > 0 && this.label === 'load.assets') {
      s += ' · ' + t('load.bytes', { a: (this._loaded / MB).toFixed(1), b: (this._total / MB).toFixed(1) });
    }
    if (e.textContent !== s) e.textContent = s;
  }

  _nextTip() {
    this._tipIdx = (this._tipIdx + 1) % TIP_COUNT;
    const e = this.els.tip;
    if (!e) return;
    e.classList.remove('in');
    void e.offsetWidth;          // restart the fade-in animation
    e.textContent = t('tip.' + (this._tipIdx + 1));
    e.classList.add('in');
  }

  _renderAll() {
    this._renderStatus();
    if (this.els.tip) this.els.tip.textContent = t('tip.' + (this._tipIdx + 1));
    if (this._err) this._renderError();
  }

  /**
   * Show the error panel for a failed file. reason: HTTP status, 'timeout', 'parse' or 'size'.
   * onRetry re-fetches only the failed files (the caller's job); onSimple boots the primitive humanoids.
   */
  error(info, onRetry, onSimple) {
    const i = info || {};
    this._err = { file: String(i.file || ''), reason: String(i.reason === undefined ? '' : i.reason) };
    this._onRetry = typeof onRetry === 'function' ? onRetry : null;
    this._onSimple = typeof onSimple === 'function' ? onSimple : null;
    if (typeof console !== 'undefined') console.warn('[legends] asset load failed: ' + this._err.file + ' (' + this._err.reason + ')');
    this._renderError();
    if (this.els.error) this.els.error.classList.remove('hidden');
    if (this.els.retry && typeof this.els.retry.focus === 'function') {
      try { this.els.retry.focus({ preventScroll: true }); } catch (err) { /* focus is cosmetic */ }
    }
  }

  _renderError() {
    const e = this.els;
    if (e.errTitle) e.errTitle.textContent = t('loadError.title');
    if (e.errDetail) e.errDetail.textContent = t('loadError.detail', this._err);
  }

  hideError() {
    this._err = null;
    this._onRetry = null;
    this._onSimple = null;
    if (this.els.error) this.els.error.classList.add('hidden');
  }

  get errorVisible() {
    return !!this._err;
  }

  /** Fade out (0.3 s) and hide; resolves when hidden. */
  done() {
    if (this._done) return Promise.resolve();
    this._done = true;
    clearInterval(this._tipTimer);
    clearTimeout(this._labelTimer);
    this.hideError();
    if (this._unsubLang) { this._unsubLang(); this._unsubLang = null; }
    const root = this.root;
    if (!root) return Promise.resolve();
    root.classList.add('fadeOut');
    return new Promise((resolve) => {
      setTimeout(() => { root.classList.add('hidden'); root.classList.remove('fadeOut'); resolve(); }, FADE_MS);
    });
  }

  /** Bring the screen back (Retry from a later phase, or a reload of the assets). */
  show() {
    if (!this.root) return;
    this._done = false;
    this.root.classList.remove('hidden', 'fadeOut');
    clearInterval(this._tipTimer);
    this._tipTimer = setInterval(() => this._nextTip(), TIP_MS);
    if (!this._unsubLang) this._unsubLang = onLangChange(() => this._renderAll());
  }
}
