/**
 * @module input
 * Touch (Pointer Events) and keyboard input for LEGENDS 3v3 (spec v2 §5.9, §6.5.7, §12 R#7/R#9/R#10;
 * v1 §3.1–§3.3 still binding for the Intent object, the touch layout and the keyboard map).
 *
 * DOM handlers only set latches and DOM timestamps; `Input.sample(now)` folds them into the shared
 * Intent once per fixed step (zero allocations per step, H10). The Intent keeps the v1 shape and adds
 * per-button tap statistics so `context.js` can recognise the v2 gestures without its own timers:
 *
 *   button = { held, justPressed, justReleased, heldTime, pressTs, releaseTs,      // v1 (ms / s)
 *              prevPressTs, taps, tapDur, doubleTap, quickTap }                    // v2
 *
 *   taps      consecutive presses whose press-to-press gap is ≤ DOUBLE_TAP_MS (1 = single, 2 = double, …)
 *   doubleTap edge: true on the step whose press made taps ≥ 2 (CROSS combo, `L L` on the keyboard)
 *   tapDur    seconds between the last press and its release (valid after a release)
 *   quickTap  edge: true on the step of a release with tapDur < QUICK_TAP_MS (SHOOT pump fake)
 *
 * `pressButton()` / `releaseButton()` apply exactly the same rules to an Intent written by the AI or
 * the test bot, so every producer of an Intent yields identical gesture semantics.
 *
 * v2 fixes: no initial joystick deflection when the ring centre is clamped away from the finger
 * (R#9); the tethered ring centre is re-clamped into the stick box and never slides under the
 * cluster (R#10); document `touchmove` is not cancelled inside `.panel` / `.scroll` so menus can
 * scroll (R#7); audio unlock fires on every activation-capable gesture (pointerdown, pointerup,
 * touchend, click, keydown) because Chrome only counts touch *up* events as user activation.
 *
 * Safe to import in Node: the DOM is touched only inside the constructor and methods.
 */
import { t, onLangChange } from './i18n.js';

/** A press and its release closer than this (ms) is a quick tap (pump fake, spec §5.7 / §5.9 row 17). */
export const QUICK_TAP_MS = 120;
/** Two presses of one button whose press times differ by ≤ this (ms) form a double tap (§5.7 combos). */
export const DOUBLE_TAP_MS = 350;
/** Raw stick magnitude below which the stick counts as idle (auto-switch rule §5.9.3). */
export const STICK_IDLE_MAG = 0.15;

function makeButtonIntent() {
  return {
    held: false, justPressed: false, justReleased: false, heldTime: 0, pressTs: 0, releaseTs: 0,
    prevPressTs: 0, taps: 0, tapDur: 0, doubleTap: false, quickTap: false,
  };
}

/**
 * The canonical Intent shape (v1 §3.1 + v2 fields). player.js re-exports it so either import path works.
 * `move.idle` = seconds the user's stick has been idle (raw magnitude < 0.15); `post` = AI post-up
 * request (GP §6.2; a human never sets it, the detector in context.js decides for him).
 */
export function makeIntent() {
  return {
    move: { x: 0, z: 0, mag: 0, idle: 0 },
    sprint: false,
    post: false,
    primary: makeButtonIntent(),
    secondary: makeButtonIntent(),
    tertiary: makeButtonIntent(),
    pause: { justPressed: false },
  };
}

/** Clear the one-step edge flags (justPressed/justReleased/doubleTap/quickTap/pause), never held state. */
export function clearEdges(intent) {
  clearButtonEdges(intent.primary);
  clearButtonEdges(intent.secondary);
  clearButtonEdges(intent.tertiary);
  intent.pause.justPressed = false;
}

function clearButtonEdges(b) {
  b.justPressed = false; b.justReleased = false; b.doubleTap = false; b.quickTap = false;
}

/**
 * Tap bookkeeping shared by the DOM path and `pressButton`: updates prevPressTs/pressTs/taps of any
 * object carrying those fields. `taps === 0` means "no earlier press" (world clocks may start at 0 ms).
 */
export function notePress(b, ts) {
  const gap = ts - b.pressTs;
  b.taps = b.taps > 0 && gap >= 0 && gap <= DOUBLE_TAP_MS ? b.taps + 1 : 1;
  b.prevPressTs = b.pressTs;
  b.pressTs = ts;
}

/** Release bookkeeping: releaseTs and tapDur (seconds, never negative). */
export function noteRelease(b, ts) {
  b.releaseTs = ts;
  const d = (ts - b.pressTs) / 1000;
  b.tapDur = d > 0 ? d : 0;
}

/** True when the release recorded in `b` closed a quick tap (strictly shorter than QUICK_TAP_MS). */
export function isQuickTap(b) {
  return b.tapDur * 1000 < QUICK_TAP_MS;
}

/**
 * Press a button of an Intent directly (AI, test bot) with the same semantics as a DOM press.
 * `ts` is in ms on whatever clock the caller uses for pressTs/releaseTs.
 */
export function pressButton(b, ts) {
  notePress(b, ts);
  b.held = true;
  b.justPressed = true;
  b.doubleTap = b.taps >= 2;
  b.heldTime = 0;
}

/** Release a button of an Intent directly (AI, test bot); sets justReleased, heldTime and quickTap. */
export function releaseButton(b, ts) {
  if (!b.held) return;
  noteRelease(b, ts);
  b.held = false;
  b.justReleased = true;
  b.heldTime = b.tapDur;
  b.quickTap = isQuickTap(b);
}

/** Copy the level (non-edge) state of one button intent into another (game.js applies its own edge dedupe). */
export function copyButtonState(dst, src) {
  dst.held = src.held; dst.heldTime = src.heldTime;
  dst.pressTs = src.pressTs; dst.releaseTs = src.releaseTs;
  dst.prevPressTs = src.prevPressTs; dst.taps = src.taps; dst.tapDur = src.tapDur;
}

/** Full copy of an Intent including edges (no allocation). */
export function copyIntent(dst, src) {
  dst.move.x = src.move.x; dst.move.z = src.move.z; dst.move.mag = src.move.mag; dst.move.idle = src.move.idle;
  dst.sprint = src.sprint; dst.post = src.post;
  copyButtonFull(dst.primary, src.primary);
  copyButtonFull(dst.secondary, src.secondary);
  copyButtonFull(dst.tertiary, src.tertiary);
  dst.pause.justPressed = src.pause.justPressed;
}

function copyButtonFull(dst, src) {
  copyButtonState(dst, src);
  dst.justPressed = src.justPressed; dst.justReleased = src.justReleased;
  dst.doubleTap = src.doubleTap; dst.quickTap = src.quickTap;
}

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator;
  if (nav && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0) return true;
  if ('ontouchstart' in window) return true;
  try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
}

// Joystick geometry (v1 §3.2): ring 120 px (radius 60), knob 52 px, full deflection at 56 px, dead zone
// 0.15, ring centre ≥ 24 px from every viewport edge. REACH = how far the drawn stick extends from the
// centre (knob centre at 56 px + knob radius 26 = 82 px > ring radius 60); CLUSTER_GAP keeps it off the
// cluster (R#10).
const STICK = { RING: 120, RING_R: 60, KNOB: 52, RADIUS: 56, DEAD: 0.15, EDGE: 24, CLUSTER_GAP: 4 };
const STICK_REACH = Math.max(STICK.RING_R, STICK.RADIUS + STICK.KNOB / 2);
const BUTTONS = ['primary', 'secondary', 'tertiary', 'sprint'];
const BUTTON_IDS = { primary: 'btnPrimary', secondary: 'btnSecondary', tertiary: 'btnTertiary', sprint: 'btnSprint' };
const LABELS = {
  offense: { primary: 'btn.shoot', secondary: 'btn.pass', tertiary: 'btn.cross', sprint: 'btn.sprint' },
  defense: { primary: 'btn.block', secondary: 'btn.switch', tertiary: 'btn.steal', sprint: 'btn.sprint' },
};
// Keyboard map (v1 §3.3, unchanged in v2 §5.9.4), by KeyboardEvent.code.
const KEY_BUTTON = {
  Space: 'primary', KeyJ: 'primary', KeyK: 'secondary', KeyL: 'tertiary', ShiftLeft: 'sprint', ShiftRight: 'sprint',
};
const KEY_MOVE = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
// Touches inside these keep their native vertical scrolling (R#7: game-over / lineup panels).
const SCROLL_SELECTOR = '.panel, .scroll';

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

// Event timestamps are DOMHighResTimeStamps on the performance.now() clock in every current browser;
// fall back to performance.now() if a stamp is missing or clearly on another clock.
function stamp(e) {
  const now = nowMs();
  const ts = e && e.timeStamp;
  if (typeof ts === 'number' && ts > 0 && ts <= now + 5 && now - ts < 5000) return ts;
  return now;
}

function byId(dom, id) {
  if (!dom) return null;
  if (typeof dom.getElementById === 'function') return dom.getElementById(id);
  if (typeof dom.querySelector === 'function') return dom.querySelector('#' + id);
  return null;
}

function insideScrollable(target) {
  let el = target;
  // Text nodes have no closest(); start from their parent element.
  if (el && el.nodeType === 3) el = el.parentNode;
  return !!(el && typeof el.closest === 'function' && el.closest(SCROLL_SELECTOR));
}

function makeButtonState() {
  return {
    pointerId: -1, keys: new Set(), down: false, pressLatch: false, releaseLatch: false,
    pressTs: 0, releaseTs: 0, prevPressTs: 0, taps: 0, tapDur: 0, doubleLatch: false,
  };
}

export class Input {
  /**
   * @param dom document (or any node supporting getElementById/querySelector)
   * @param opts { onGesture, onPause, onMute, onLang }. When onPause is given the pause key/button call
   *   it instead of latching intent.pause.justPressed, so exactly one path fires.
   */
  constructor(dom, opts) {
    this.opts = opts || {};
    this.dom = dom || (typeof document !== 'undefined' ? document : null);
    this.doc = this.dom && this.dom.ownerDocument ? this.dom.ownerDocument : this.dom;
    this.win = this.doc && this.doc.defaultView ? this.doc.defaultView : (typeof window !== 'undefined' ? window : null);
    this.intent = makeIntent();
    this.enabled = true;
    this.offense = true;
    this._touchSeen = false;
    this._gestureCbs = [];
    if (typeof this.opts.onGesture === 'function') this._gestureCbs.push(this.opts.onGesture);
    this._owners = new Map(); // pointerId -> 'stick' | button name | 'pause'
    this._pauseLatch = false;
    // Physical button state; a button is down while a pointer or any mapped key holds it.
    this._btn = {};
    for (let i = 0; i < BUTTONS.length; i++) this._btn[BUTTONS[i]] = makeButtonState();
    this._moveKeys = new Set();
    // Stick: centre (cx, cy) in viewport px, clamp box fixed at touch-down, vector, knob offset.
    this._stick = {
      active: false, pointerId: -1, cx: 0, cy: 0, minX: 0, maxX: 0, minY: 0, maxY: 0,
      vx: 0, vz: 0, mag: 0, raw: 0, knobX: 0, knobY: 0,
    };
    this._idleSince = -1;     // ms timestamp the stick went idle (-1 = not yet sampled)
    this._els = {};
    this._byEl = new Map();
    this._listeners = [];
    this._unsubLang = null;
    if (this.doc) this._attach();
  }

  _on(target, type, fn, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, options);
    this._listeners.push([target, type, fn, options]);
  }

  _attach() {
    const els = this._els;
    els.zone = byId(this.dom, 'stickZone');
    els.ring = byId(this.dom, 'stickRing');
    els.knob = byId(this.dom, 'stickKnob');
    els.cluster = byId(this.dom, 'cluster');
    els.pause = byId(this.dom, 'btnPause');
    for (let i = 0; i < BUTTONS.length; i++) {
      const name = BUTTONS[i];
      const el = byId(this.dom, BUTTON_IDS[name]);
      els[name] = el;
      if (el) this._byEl.set(el, name);
    }
    const nonPassive = { passive: false };
    const doc = this.doc;
    // Global mobile hygiene (H5): no scroll, pinch, double-tap zoom or long-press menu, except that
    // touches inside a .panel/.scroll keep their vertical scroll (R#7; CSS gives them touch-action: pan-y).
    this._on(doc, 'touchmove', (e) => { if (e.cancelable && !insideScrollable(e.target)) e.preventDefault(); }, nonPassive);
    this._on(doc, 'gesturestart', (e) => e.preventDefault(), nonPassive);
    this._on(doc, 'dblclick', (e) => e.preventDefault(), nonPassive);
    this._on(doc, 'contextmenu', (e) => e.preventDefault(), nonPassive);
    // Audio-unlock gestures. Chrome counts keydown, mouse pointerdown, non-mouse pointerup, touchend and
    // click as user activation; iOS Safari counts touchend. Every one of them calls the callbacks
    // (unlock() is idempotent and cheap once running).
    const capPassive = { capture: true, passive: true };
    this._on(doc, 'pointerdown', (e) => { if (e.pointerType === 'touch') this._touchSeen = true; this._fireGesture(e); }, capPassive);
    this._on(doc, 'pointerup', (e) => this._fireGesture(e), capPassive);
    this._on(doc, 'touchend', (e) => { this._touchSeen = true; this._fireGesture(e); }, capPassive);
    this._on(doc, 'click', (e) => this._fireGesture(e), capPassive);
    this._on(doc, 'keydown', (e) => { if (!e.repeat) this._fireGesture(e); }, capPassive);
    // Joystick.
    if (els.zone) this._on(els.zone, 'pointerdown', (e) => this._onStickDown(e), nonPassive);
    // Cluster buttons and pause.
    for (let i = 0; i < BUTTONS.length; i++) {
      const name = BUTTONS[i];
      if (els[name]) this._on(els[name], 'pointerdown', (e) => this._onButtonDown(e, name), nonPassive);
    }
    if (els.pause) this._on(els.pause, 'pointerdown', (e) => this._onPauseDown(e), nonPassive);
    // Shared move/up/cancel handling keyed by pointer ownership (multi-touch: one owner per pointerId).
    this._on(doc, 'pointermove', (e) => this._onPointerMove(e), nonPassive);
    this._on(doc, 'pointerup', (e) => this._onPointerUp(e), nonPassive);
    this._on(doc, 'pointercancel', (e) => this._onPointerUp(e), nonPassive);
    this._on(doc, 'lostpointercapture', (e) => this._onPointerUp(e), nonPassive);
    // Keyboard.
    this._on(doc, 'keydown', (e) => this._onKeyDown(e), nonPassive);
    this._on(doc, 'keyup', (e) => this._onKeyUp(e), nonPassive);
    if (this.win) this._on(this.win, 'blur', () => this._releaseAll());
    this._on(doc, 'visibilitychange', () => { if (doc.hidden) this._releaseAll(); });
    this._unsubLang = onLangChange(() => this._relabel());
    this._relabel();
  }

  // ---------- gestures ----------
  _fireGesture(e) {
    for (let i = 0; i < this._gestureCbs.length; i++) {
      try { this._gestureCbs[i](e); } catch (err) { /* a failing unlock must never break input */ }
    }
  }

  /** Register a callback for every user gesture; returns an unsubscribe function. */
  onAnyGesture(cb) {
    if (typeof cb !== 'function') return () => {};
    this._gestureCbs.push(cb);
    return () => { const i = this._gestureCbs.indexOf(cb); if (i >= 0) this._gestureCbs.splice(i, 1); };
  }

  get isTouch() {
    return this._touchSeen || isTouchDevice();
  }

  /** Read-only view of the joystick state (tests and debug overlays). */
  get stick() {
    return this._stick;
  }

  // ---------- joystick ----------
  _rect(el) {
    return el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  }

  // Box the ring centre may occupy: inside the zone, ≥ 24 px from every viewport edge, and far enough
  // left of the cluster that neither the 120 px ring nor the knob ever paints under a button (R#10).
  _computeBox() {
    const s = this._stick;
    const w = this.win ? this.win.innerWidth : 0, h = this.win ? this.win.innerHeight : 0;
    let minX = STICK.EDGE, maxX = w - STICK.EDGE, minY = STICK.EDGE, maxY = h - STICK.EDGE;
    const r = this._rect(this._els.zone);
    if (r) {
      minX = Math.max(minX, r.left); maxX = Math.min(maxX, r.right);
      minY = Math.max(minY, r.top); maxY = Math.min(maxY, r.bottom);
    }
    const c = this._rect(this._els.cluster);
    if (c && c.width > 0 && c.height > 0) {
      // Only matters when the stick's vertical span can reach the cluster's rows.
      if (maxY + STICK_REACH > c.top && minY - STICK_REACH < c.bottom) {
        maxX = Math.min(maxX, c.left - STICK_REACH - STICK.CLUSTER_GAP);
      }
    }
    if (maxX < minX) maxX = minX;
    if (maxY < minY) maxY = minY;
    s.minX = minX; s.maxX = maxX; s.minY = minY; s.maxY = maxY;
  }

  _onStickDown(e) {
    if (e.cancelable) e.preventDefault();
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const s = this._stick;
    if (s.active || this._owners.has(e.pointerId)) return; // second finger in the zone is ignored
    this._computeBox();
    s.cx = clampN(e.clientX, s.minX, s.maxX);
    s.cy = clampN(e.clientY, s.minY, s.maxY);
    s.active = true;
    s.pointerId = e.pointerId;
    // R#9: the vector starts at zero even when the centre was clamped away from the finger; the first
    // pointermove measures from the clamped centre.
    s.vx = 0; s.vz = 0; s.mag = 0; s.raw = 0; s.knobX = 0; s.knobY = 0;
    this._owners.set(e.pointerId, 'stick');
    this._capture(this._els.zone, e.pointerId);
    this._drawStick();
  }

  _updateStickVector(px, py) {
    const s = this._stick;
    let dx = px - s.cx, dy = py - s.cy;
    let len = Math.sqrt(dx * dx + dy * dy);
    if (len > STICK.RADIUS) {
      // Tethered: the centre trails the finger so long strafes never drop input …
      const k = (len - STICK.RADIUS) / len;
      // … but stays inside the box fixed at touch-down (R#10); beyond it the vector saturates.
      s.cx = clampN(s.cx + dx * k, s.minX, s.maxX);
      s.cy = clampN(s.cy + dy * k, s.minY, s.maxY);
      dx = px - s.cx; dy = py - s.cy;
      len = Math.sqrt(dx * dx + dy * dy);
    }
    if (len > STICK.RADIUS) {
      const k = STICK.RADIUS / len;
      dx *= k; dy *= k; len = STICK.RADIUS;
    }
    s.knobX = dx; s.knobY = dy;
    const m = len / STICK.RADIUS; // 0..1
    s.raw = m;
    if (m < STICK.DEAD) {
      s.vx = 0; s.vz = 0; s.mag = 0;
    } else {
      const mm = (m - STICK.DEAD) / (1 - STICK.DEAD); // remap dead zone: 0.15 -> 0, 1 -> 1
      s.vx = (dx / len) * mm; s.vz = (dy / len) * mm; s.mag = mm;
    }
  }

  _drawStick() {
    const s = this._stick, ring = this._els.ring, knob = this._els.knob;
    if (!ring) return;
    if (!s.active) { ring.classList.remove('active'); return; }
    ring.classList.add('active');
    ring.style.transform = 'translate3d(' + s.cx + 'px,' + s.cy + 'px,0)';
    if (knob) knob.style.transform = 'translate3d(' + s.knobX + 'px,' + s.knobY + 'px,0)';
  }

  _releaseStick() {
    const s = this._stick;
    if (!s.active) return;
    this._owners.delete(s.pointerId);
    s.active = false; s.pointerId = -1; s.vx = 0; s.vz = 0; s.mag = 0; s.raw = 0; s.knobX = 0; s.knobY = 0;
    this._drawStick();
  }

  // ---------- buttons ----------
  _capture(el, id) {
    if (el && typeof el.setPointerCapture === 'function') {
      try { el.setPointerCapture(id); } catch (err) { /* capture is best effort */ }
    }
  }

  _setDown(name, down, ts) {
    const b = this._btn[name];
    if (b.down === down) return;
    b.down = down;
    if (down) {
      notePress(b, ts);
      b.pressLatch = true;
      if (b.taps >= 2) b.doubleLatch = true;
    } else {
      noteRelease(b, ts);
      b.releaseLatch = true;
    }
    const el = this._els[name];
    if (el && el.classList) el.classList.toggle('pressed', down);
  }

  _pressPointer(name, pointerId, ts) {
    const b = this._btn[name];
    b.pointerId = pointerId;
    this._owners.set(pointerId, name);
    this._setDown(name, true, ts);
  }

  _releasePointer(name, ts) {
    const b = this._btn[name];
    if (b.pointerId !== -1) this._owners.delete(b.pointerId);
    b.pointerId = -1;
    if (b.keys.size === 0) this._setDown(name, false, ts);
  }

  _onButtonDown(e, name) {
    if (e.cancelable) e.preventDefault();
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this._owners.has(e.pointerId)) return;
    const b = this._btn[name];
    if (b.pointerId !== -1) return; // already held by another finger
    this._capture(e.currentTarget || this._els[name], e.pointerId);
    this._pressPointer(name, e.pointerId, stamp(e));
  }

  _onPauseDown(e) {
    if (e.cancelable) e.preventDefault();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this._owners.has(e.pointerId)) return;
    this._owners.set(e.pointerId, 'pause');
    this._capture(e.currentTarget || this._els.pause, e.pointerId);
    if (this._els.pause) this._els.pause.classList.add('pressed');
  }

  _buttonAt(x, y) {
    const doc = this.doc;
    if (!doc || typeof doc.elementFromPoint !== 'function') return null;
    let el = doc.elementFromPoint(x, y);
    while (el && !this._byEl.has(el)) el = el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : null;
    return el ? this._byEl.get(el) : null;
  }

  _onPointerMove(e) {
    const owner = this._owners.get(e.pointerId);
    if (owner === undefined) return;
    if (e.cancelable) e.preventDefault();
    if (owner === 'stick') {
      if (this._stick.pointerId !== e.pointerId) return;
      this._updateStickVector(e.clientX, e.clientY);
      this._drawStick();
      return;
    }
    if (owner === 'pause' || !this.enabled) return;
    // Slide-over: entering another cluster button releases the old one and presses the new one.
    const over = this._buttonAt(e.clientX, e.clientY);
    if (over && over !== owner && this._btn[over].pointerId === -1) {
      const ts = stamp(e);
      this._releasePointer(owner, ts);
      this._pressPointer(over, e.pointerId, ts);
    }
  }

  _onPointerUp(e) {
    const owner = this._owners.get(e.pointerId);
    if (owner === undefined) return;
    if (e.type !== 'lostpointercapture' && e.cancelable) e.preventDefault();
    if (owner === 'stick') { this._releaseStick(); return; }
    if (owner === 'pause') {
      this._owners.delete(e.pointerId);
      if (this._els.pause) this._els.pause.classList.remove('pressed');
      if (e.type === 'pointerup') this._pause();
      return;
    }
    this._releasePointer(owner, stamp(e));
  }

  _releaseAll() {
    const ts = nowMs();
    this._releaseStick();
    for (let i = 0; i < BUTTONS.length; i++) {
      const name = BUTTONS[i], b = this._btn[name];
      b.keys.clear();
      if (b.pointerId !== -1) this._owners.delete(b.pointerId);
      b.pointerId = -1;
      this._setDown(name, false, ts);
    }
    this._moveKeys.clear();
    this._owners.clear();
    if (this._els.pause) this._els.pause.classList.remove('pressed');
  }

  // ---------- keyboard ----------
  _isTextTarget(e) {
    const el = e.target;
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
  }

  _onKeyDown(e) {
    if (this._isTextTarget(e)) return;
    const code = e.code;
    if (code === 'KeyP' || code === 'Escape') { if (!e.repeat) this._pause(); e.preventDefault(); return; }
    if (code === 'KeyM') { if (!e.repeat && typeof this.opts.onMute === 'function') this.opts.onMute(); e.preventDefault(); return; }
    if (code === 'KeyT') { if (!e.repeat && typeof this.opts.onLang === 'function') this.opts.onLang(); e.preventDefault(); return; }
    if (!this.enabled) return;
    if (KEY_MOVE[code]) { this._moveKeys.add(code); e.preventDefault(); return; }
    const name = KEY_BUTTON[code];
    if (name) {
      e.preventDefault();
      if (e.repeat) return;
      const b = this._btn[name];
      b.keys.add(code);
      this._setDown(name, true, stamp(e));
    }
  }

  _onKeyUp(e) {
    const code = e.code;
    if (KEY_MOVE[code]) { this._moveKeys.delete(code); return; }
    const name = KEY_BUTTON[code];
    if (name) {
      const b = this._btn[name];
      b.keys.delete(code);
      if (b.keys.size === 0 && b.pointerId === -1) this._setDown(name, false, stamp(e));
    }
  }

  _pause() {
    if (typeof this.opts.onPause === 'function') this.opts.onPause();
    else this._pauseLatch = true;
  }

  // ---------- per-step sampling ----------
  /**
   * Fold latches into the intent: called exactly once per fixed step, before game.step().
   * A press and a release inside one step yield both edges in that step (v1 rule); tap fields are
   * computed at DOM time, so two presses inside one step still report taps = 2 and doubleTap.
   */
  sample(now) {
    const it = this.intent;
    const tNow = typeof now === 'number' ? now : nowMs();
    for (let i = 0; i < 3; i++) {
      const name = BUTTONS[i], b = this._btn[name], a = it[name];
      a.justPressed = b.pressLatch;
      a.justReleased = b.releaseLatch;
      a.doubleTap = b.doubleLatch;
      a.held = b.down;
      a.pressTs = b.pressTs;
      a.releaseTs = b.releaseTs;
      a.prevPressTs = b.prevPressTs;
      a.taps = b.taps;
      a.tapDur = b.tapDur;
      a.quickTap = b.releaseLatch && isQuickTap(b);
      if (b.down) a.heldTime = Math.max(0, (tNow - b.pressTs) / 1000);
      else if (b.releaseLatch) a.heldTime = b.tapDur;
      else a.heldTime = 0;
      b.pressLatch = false; b.releaseLatch = false; b.doubleLatch = false;
    }
    const sp = this._btn.sprint;
    it.sprint = sp.down;
    sp.pressLatch = false; sp.releaseLatch = false; sp.doubleLatch = false;
    // Movement: the joystick wins while active, otherwise the 8-way keyboard vector.
    const s = this._stick, mv = it.move;
    let raw = 0;
    if (s.active) {
      mv.x = s.vx; mv.z = s.vz; mv.mag = s.mag; raw = s.raw;
    } else if (this._moveKeys.size > 0) {
      keyAcc.x = 0; keyAcc.z = 0;
      this._moveKeys.forEach(addKeyMove);
      const x = keyAcc.x, z = keyAcc.z;
      const len = Math.sqrt(x * x + z * z);
      if (len > 0) { mv.x = x / len; mv.z = z / len; mv.mag = 1; raw = 1; } else { mv.x = 0; mv.z = 0; mv.mag = 0; }
    } else {
      mv.x = 0; mv.z = 0; mv.mag = 0;
    }
    // Stick idle time for the auto-switch rule (§5.9.3: magnitude < 0.15 for ≥ 0.40 s).
    if (raw >= STICK_IDLE_MAG || this._idleSince < 0) this._idleSince = tNow;
    mv.idle = Math.max(0, (tNow - this._idleSince) / 1000);
    it.pause.justPressed = this._pauseLatch;
    this._pauseLatch = false;
    return it;
  }

  /** True while any of the three action buttons or sprint is physically held. */
  get anyHeld() {
    const b = this._btn;
    return b.primary.down || b.secondary.down || b.tertiary.down || b.sprint.down;
  }

  // ---------- labels / state ----------
  setOffense(isOffense) {
    this.offense = !!isOffense;
    const c = this._els.cluster;
    if (c && c.classList) { c.classList.toggle('offense', this.offense); c.classList.toggle('defense', !this.offense); }
    this._relabel();
  }

  _relabel() {
    const table = this.offense ? LABELS.offense : LABELS.defense;
    for (let i = 0; i < BUTTONS.length; i++) {
      const name = BUTTONS[i], el = this._els[name];
      if (!el) continue;
      const key = table[name];
      const label = el.querySelector ? el.querySelector('.label') : null;
      const target = label || el;
      if (target.getAttribute('data-i18n') !== key) target.setAttribute('data-i18n', key);
      const text = t(key);
      if (target.textContent !== text) target.textContent = text;
    }
  }

  /** Disabling (menus, replays) releases everything and drops pending edges and tap chains. */
  setEnabled(on) {
    on = !!on;
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) {
      this._releaseAll();
      // Drop pending edges too: nothing pressed before a menu opened should fire after it closes, and
      // a tap before the menu must not pair with one after it into a double tap.
      for (let i = 0; i < BUTTONS.length; i++) {
        const b = this._btn[BUTTONS[i]];
        b.pressLatch = false; b.releaseLatch = false; b.doubleLatch = false; b.taps = 0;
      }
      const it = this.intent;
      clearEdges(it);
      it.primary.held = false; it.secondary.held = false; it.tertiary.held = false; it.sprint = false;
      it.primary.taps = 0; it.secondary.taps = 0; it.tertiary.taps = 0;
      it.move.x = 0; it.move.z = 0; it.move.mag = 0;
      it.primary.heldTime = 0; it.secondary.heldTime = 0; it.tertiary.heldTime = 0;
    }
  }

  destroy() {
    this._releaseAll();
    for (let i = 0; i < this._listeners.length; i++) {
      const l = this._listeners[i];
      l[0].removeEventListener(l[1], l[2], l[3]);
    }
    this._listeners.length = 0;
    if (this._unsubLang) { this._unsubLang(); this._unsubLang = null; }
    this._gestureCbs.length = 0;
    this._owners.clear();
  }
}

function clampN(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Allocation-free accumulator for the keyboard move vector (Set.forEach cannot return values).
const keyAcc = { x: 0, z: 0 };
function addKeyMove(code) {
  const d = KEY_MOVE[code];
  if (d) { keyAcc.x += d[0]; keyAcc.z += d[1]; }
}
