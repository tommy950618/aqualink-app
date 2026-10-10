/**
 * ui/captions.js - the play-by-play caption line (spec v2 section 6.5.8; review findings R#19, R#20, R#42).
 *
 * Entries {key, params, priority, t}; priority 3 = score / turnover / violation / buzzer, 2 = block / steal / ankle /
 * ability, 1 = miss / rebound / check. Rules:
 *   - on push, queued entries older than 2.0 s are dropped (and stale entries are skipped when dequeued);
 *   - a priority-3 push flushes every queued lower-priority entry and cuts the caption on screen once it has been
 *     visible >= 0.6 s (immediately if it already has), so a score never sits behind a stale rebound line;
 *   - otherwise a caption shows 1.8 s and fades 0.3 s (ability captions `cap.ab.*`: 0.9 s, GP 8);
 *   - at most 4 queued (the oldest lowest-priority entry is dropped; a new entry lower than everything queued is
 *     discarded);
 *   - clear() empties everything (called by the router on Game.start() and Game.quit(), R#19);
 *   - refreshLang() re-renders the current caption (language toggle, R#20); `{name}` params may be `{zh, en}`.
 * Entries come from a fixed pool and params are copied into pooled objects (game event payloads are pooled and reused,
 * H10), so neither push nor update allocates beyond the translated string. Works in Node with `el = null`
 * (unit-captions reads `text`, `visible`, `current`).
 */
import { t } from '../i18n.js';

export const CAPTION = Object.freeze({ SHOW: 1.8, FADE: 0.3, ABILITY_SHOW: 0.9, MAX_AGE: 2.0, MIN_CUT: 0.6, QUEUE: 4 });

const P3 = { 'cap.make2': 1, 'cap.make3': 1, 'cap.layup': 1, 'cap.dunk': 1, 'cap.bank': 1, 'cap.buzzerBeater': 1, 'cap.winner': 1,
  'cap.firstDunk': 1, 'cap.hot': 1, 'cap.oob': 1, 'cap.shotClock': 1, 'cap.turnover': 1, 'cap.notCleared': 1, 'cap.rimOut': 1 };
const P2 = { 'cap.block': 1, 'cap.steal': 1, 'cap.ankle': 1, 'cap.chaseDown': 1, 'cap.clear': 1 };

/** Default priority of a caption key when the emitter did not pass one. */
export function priorityOf(key) {
  if (typeof key !== 'string') return 1;
  if (P3[key]) return 3;
  if (P2[key] || key.indexOf('cap.ab.') === 0) return 2;
  return 1;
}

/** Remove arr[i] in place without the temporary array that splice() returns (H10). */
function removeAt(arr, i) {
  for (let j = i; j < arr.length - 1; j++) arr[j] = arr[j + 1];
  arr.length--;
}

function makeEntry() {
  return { key: '', params: {}, hasParams: false, priority: 1, t: 0, live: false };
}

function copyParams(dst, src) {
  for (const k in dst) delete dst[k];
  let any = false;
  if (src) for (const k in src) { dst[k] = src[k]; any = true; }
  return any;
}

export class Captions {
  /**
   * @param {HTMLElement|null} el  the #caption element (null in Node)
   */
  constructor(el) {
    this.el = el || null;
    this.now = 0;
    this._pool = [];
    for (let i = 0; i < CAPTION.QUEUE + 4; i++) this._pool.push(makeEntry());
    this._queue = [];            // entries waiting (length <= QUEUE)
    this.current = null;         // entry on screen (or fading)
    this._shown = 0;             // seconds the current entry has been on screen
    this._fading = false;
    this._fadeT = 0;
    this._cutPending = false;    // a priority-3 entry waits for the 0.6 s minimum of the current one
    this.text = '';
    this.visible = false;
  }

  _alloc() {
    for (let i = 0; i < this._pool.length; i++) if (!this._pool[i].live) return this._pool[i];
    // Every pooled entry is queued or current: recycle the oldest queued entry.
    const e = this._queue.shift();
    e.live = false;
    return e;
  }

  _release(e) {
    if (e) e.live = false;
  }

  get queueLength() {
    return this._queue.length;
  }

  /** Queue a caption (key, params with `{name}` etc., priority 1/2/3; default by key). */
  push(key, params, priority) {
    if (!key) return;
    const pr = priority === 1 || priority === 2 || priority === 3 ? priority : priorityOf(key);
    // 1) drop stale queued entries
    this._dropStale();
    // 2) priority 3 flushes lower queued entries and cuts the current caption
    if (pr === 3) {
      for (let i = this._queue.length - 1; i >= 0; i--) {
        if (this._queue[i].priority < 3) { this._release(this._queue[i]); removeAt(this._queue, i); }
      }
    }
    // 3) bound the queue
    if (this._queue.length >= CAPTION.QUEUE) {
      let lo = -1;
      for (let i = 0; i < this._queue.length; i++) if (lo < 0 || this._queue[i].priority < this._queue[lo].priority) lo = i;
      if (pr < this._queue[lo].priority) return;   // everything queued matters more than the newcomer
      this._release(this._queue[lo]);
      removeAt(this._queue, lo);
    }
    const e = this._alloc();
    e.key = key;
    e.hasParams = copyParams(e.params, params);
    e.priority = pr;
    e.t = this.now;
    e.live = true;
    if (pr === 3 && this.current && !this._fading) {
      // Put it at the head so it is the one that replaces the current caption.
      this._queue.unshift(e);
      if (this._shown >= CAPTION.MIN_CUT) this._next();
      else this._cutPending = true;
      return;
    }
    this._queue.push(e);
    if (!this.current) this._next();
  }

  _dropStale() {
    for (let i = this._queue.length - 1; i >= 0; i--) {
      if (this.now - this._queue[i].t > CAPTION.MAX_AGE) { this._release(this._queue[i]); removeAt(this._queue, i); }
    }
  }

  /** Show the next fresh queued entry (or hide when none). */
  _next() {
    this._release(this.current);
    this.current = null;
    this._cutPending = false;
    this._fading = false;
    this._shown = 0;
    this._dropStale();
    if (this._queue.length > 0) {
      this.current = this._queue.shift();
      this._render(true);
    } else {
      this._render(false);
    }
  }

  _duration(e) {
    return e.key.indexOf('cap.ab.') === 0 ? CAPTION.ABILITY_SHOW : CAPTION.SHOW;
  }

  _render(show) {
    if (show && this.current) {
      const c = this.current;
      this.text = t(c.key, c.hasParams ? c.params : undefined);
      this.visible = true;
      if (this.el) {
        if (this.el.textContent !== this.text) this.el.textContent = this.text;
        this.el.classList.add('show');
      }
    } else {
      this.visible = false;
      if (this.el) this.el.classList.remove('show');
    }
  }

  /**
   * Advance by dt seconds. `time` (world.time) re-bases the clock used to stamp and age entries when given.
   * Allocation-free unless a caption changes.
   */
  update(dt, time) {
    const d = typeof dt === 'number' && dt > 0 ? (dt < 0.25 ? dt : 0.25) : 0;
    if (typeof time === 'number' && Number.isFinite(time)) this.now = time;
    else this.now += d;
    if (!this.current) {
      if (this._queue.length > 0) this._next();
      return;
    }
    this._shown += d;
    if (this._cutPending && this._shown >= CAPTION.MIN_CUT) { this._next(); return; }
    if (!this._fading) {
      if (this._shown >= this._duration(this.current)) {
        this._fading = true;
        this._fadeT = 0;
        this.visible = false;
        if (this.el) this.el.classList.remove('show');
      }
    } else {
      this._fadeT += d;
      if (this._fadeT >= CAPTION.FADE) this._next();
    }
  }

  /** Empty the queue and hide the line (Game.start / Game.quit, R#19). */
  clear() {
    for (let i = 0; i < this._queue.length; i++) this._release(this._queue[i]);
    this._queue.length = 0;
    this._release(this.current);
    this.current = null;
    this._fading = false;
    this._cutPending = false;
    this._shown = 0;
    this.text = '';
    this.visible = false;
    if (this.el) { this.el.classList.remove('show'); this.el.textContent = ''; }
  }

  /** Re-render the caption on screen in the current language (R#20). */
  refreshLang() {
    if (this.current && !this._fading) this._render(true);
    else if (this.current && this.el) {
      this.text = t(this.current.key, this.current.hasParams ? this.current.params : undefined);
      this.el.textContent = this.text;
    }
  }
}
