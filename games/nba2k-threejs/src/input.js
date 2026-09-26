// Touch (Pointer Events) and keyboard input (spec sections 3.1 - 3.3).
// DOM handlers only set latches and timestamps; sample() folds them into the shared Intent once per
// fixed step. Safe to import in Node: the DOM is touched only inside the constructor and methods.
import { t, onLangChange } from './i18n.js';

// The canonical Intent shape (spec 3.1). player.js re-exports these so either import path works.
export function makeIntent() {
  return {
    move: { x: 0, z: 0, mag: 0 },
    sprint: false,
    primary: makeButtonIntent(),
    secondary: makeButtonIntent(),
    tertiary: makeButtonIntent(),
    pause: { justPressed: false },
  };
}

function makeButtonIntent() {
  return { held: false, justPressed: false, justReleased: false, heldTime: 0, pressTs: 0, releaseTs: 0 };
}

// Clear the one-step edge flags (justPressed/justReleased/pause) without touching held state.
export function clearEdges(intent) {
  intent.primary.justPressed = false; intent.primary.justReleased = false;
  intent.secondary.justPressed = false; intent.secondary.justReleased = false;
  intent.tertiary.justPressed = false; intent.tertiary.justReleased = false;
  intent.pause.justPressed = false;
}

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator;
  if (nav && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 0) return true;
  if ('ontouchstart' in window) return true;
  try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; }
}

const STICK = { RING: 120, KNOB: 52, RADIUS: 56, DEAD: 0.15, EDGE: 24 };
const BUTTONS = ['primary', 'secondary', 'tertiary', 'sprint'];
const BUTTON_IDS = { primary: 'btnPrimary', secondary: 'btnSecondary', tertiary: 'btnTertiary', sprint: 'btnSprint' };
const LABELS = {
  offense: { primary: 'btn.shoot', secondary: 'btn.pass', tertiary: 'btn.cross', sprint: 'btn.sprint' },
  defense: { primary: 'btn.block', secondary: 'btn.switch', tertiary: 'btn.steal', sprint: 'btn.sprint' },
};
// Keyboard map (spec 3.3), by KeyboardEvent.code.
const KEY_BUTTON = {
  Space: 'primary', KeyJ: 'primary', KeyK: 'secondary', KeyL: 'tertiary', ShiftLeft: 'sprint', ShiftRight: 'sprint',
};
const KEY_MOVE = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

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

export class Input {
  // dom: document (or any element that supports getElementById/querySelector).
  // opts: { onGesture, onPause, onMute, onLang }. When onPause is given the pause key/button call it
  // instead of latching intent.pause.justPressed, so exactly one path fires.
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
    for (let i = 0; i < BUTTONS.length; i++) {
      this._btn[BUTTONS[i]] = { pointerId: -1, keys: new Set(), down: false, pressLatch: false, releaseLatch: false, pressTs: 0, releaseTs: 0 };
    }
    this._moveKeys = new Set();
    this._stick = { active: false, pointerId: -1, cx: 0, cy: 0, vx: 0, vz: 0, mag: 0, knobX: 0, knobY: 0 };
    this._els = {};
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
    this._byEl = new Map();
    for (let i = 0; i < BUTTONS.length; i++) {
      const name = BUTTONS[i];
      const el = byId(this.dom, BUTTON_IDS[name]);
      els[name] = el;
      if (el) this._byEl.set(el, name);
    }
    const nonPassive = { passive: false };
    const doc = this.doc;
    // Global mobile hygiene (spec 11): no scroll, pinch, double-tap zoom or long-press menu anywhere.
    this._on(doc, 'touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, nonPassive);
    this._on(doc, 'gesturestart', (e) => e.preventDefault(), nonPassive);
    this._on(doc, 'dblclick', (e) => e.preventDefault(), nonPassive);
    this._on(doc, 'contextmenu', (e) => e.preventDefault(), nonPassive);
    // Audio-unlock gestures.
    this._on(doc, 'pointerdown', (e) => { if (e.pointerType === 'touch') this._touchSeen = true; this._fireGesture(e); }, { capture: true, passive: true });
    this._on(doc, 'touchend', (e) => { this._touchSeen = true; this._fireGesture(e); }, { capture: true, passive: true });
    this._on(doc, 'keydown', (e) => { if (!e.repeat) this._fireGesture(e); }, { capture: true, passive: true });
    // Joystick.
    if (els.zone) this._on(els.zone, 'pointerdown', (e) => this._onStickDown(e), nonPassive);
    // Cluster buttons and pause.
    for (let i = 0; i < BUTTONS.length; i++) {
      const name = BUTTONS[i];
      if (els[name]) this._on(els[name], 'pointerdown', (e) => this._onButtonDown(e, name), nonPassive);
    }
    if (els.pause) this._on(els.pause, 'pointerdown', (e) => this._onPauseDown(e), nonPassive);
    // Shared move/up/cancel handling keyed by pointer ownership.
    this._on(doc, 'pointermove', (e) => this._onPointerMove(e), nonPassive);
    this._on(doc, 'pointerup', (e) => this._onPointerUp(e), nonPassive);
    this._on(doc, 'pointercancel', (e) => this._onPointerUp(e), nonPassive);
    this._on(doc, 'lostpointercapture', (e) => this._onPointerUp(e), nonPassive);
    // Keyboard.
    this._on(doc, 'keydown', (e) => this._onKeyDown(e), nonPassive);
    this._on(doc, 'keyup', (e) => this._onKeyUp(e), nonPassive);
    if (this.win) {
      this._on(this.win, 'blur', () => this._releaseAll());
    }
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

  onAnyGesture(cb) {
    if (typeof cb !== 'function') return () => {};
    this._gestureCbs.push(cb);
    return () => { const i = this._gestureCbs.indexOf(cb); if (i >= 0) this._gestureCbs.splice(i, 1); };
  }

  get isTouch() {
    return this._touchSeen || isTouchDevice();
  }

  // ---------- joystick ----------
  _zoneRect() {
    const z = this._els.zone;
    return z && z.getBoundingClientRect ? z.getBoundingClientRect() : null;
  }

  _onStickDown(e) {
    if (e.cancelable) e.preventDefault();
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const s = this._stick;
    if (s.active || this._owners.has(e.pointerId)) return; // second finger in the zone is ignored
    const w = this.win ? this.win.innerWidth : 0, h = this.win ? this.win.innerHeight : 0;
    const r = this._zoneRect();
    // Ring centre clamped inside the zone and >= 24 px from every viewport edge.
    let minX = STICK.EDGE, maxX = w - STICK.EDGE, minY = STICK.EDGE, maxY = h - STICK.EDGE;
    if (r) {
      minX = Math.max(minX, r.left); maxX = Math.min(maxX, r.right);
      minY = Math.max(minY, r.top); maxY = Math.min(maxY, r.bottom);
    }
    s.cx = Math.min(Math.max(e.clientX, minX), Math.max(minX, maxX));
    s.cy = Math.min(Math.max(e.clientY, minY), Math.max(minY, maxY));
    s.active = true;
    s.pointerId = e.pointerId;
    s.vx = 0; s.vz = 0; s.mag = 0; s.knobX = 0; s.knobY = 0;
    this._owners.set(e.pointerId, 'stick');
    this._capture(this._els.zone, e.pointerId);
    this._updateStickVector(e.clientX, e.clientY);
    this._drawStick();
  }

  _updateStickVector(px, py) {
    const s = this._stick;
    let dx = px - s.cx, dy = py - s.cy;
    let len = Math.sqrt(dx * dx + dy * dy);
    if (len > STICK.RADIUS) {
      // Tethered: the ring centre trails the finger so long strafes never drop input.
      const k = (len - STICK.RADIUS) / len;
      s.cx += dx * k; s.cy += dy * k;
      dx = px - s.cx; dy = py - s.cy;
      len = STICK.RADIUS;
    }
    s.knobX = dx; s.knobY = dy;
    const m = len / STICK.RADIUS; // 0..1
    if (m < STICK.DEAD) {
      s.vx = 0; s.vz = 0; s.mag = 0;
    } else {
      const mm = (m - STICK.DEAD) / (1 - STICK.DEAD); // remap dead zone 0.15 -> 0, 1 -> 1
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
    s.active = false; s.pointerId = -1; s.vx = 0; s.vz = 0; s.mag = 0; s.knobX = 0; s.knobY = 0;
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
    if (down) { b.pressLatch = true; b.pressTs = ts; } else { b.releaseLatch = true; b.releaseTs = ts; }
    const el = this._els[name];
    if (el) el.classList.toggle('pressed', down);
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
  // Fold latches into the intent: called exactly once per fixed step, before game.step().
  sample(now) {
    const it = this.intent;
    const tNow = typeof now === 'number' ? now : nowMs();
    for (let i = 0; i < 3; i++) {
      const name = BUTTONS[i], b = this._btn[name], a = it[name];
      a.justPressed = b.pressLatch;
      a.justReleased = b.releaseLatch;
      a.held = b.down;
      if (b.pressLatch) a.pressTs = b.pressTs;
      if (b.releaseLatch) a.releaseTs = b.releaseTs;
      if (b.down) a.heldTime = Math.max(0, (tNow - a.pressTs) / 1000);
      else if (b.releaseLatch) a.heldTime = Math.max(0, (a.releaseTs - a.pressTs) / 1000);
      else a.heldTime = 0;
      b.pressLatch = false; b.releaseLatch = false;
    }
    const sp = this._btn.sprint;
    it.sprint = sp.down;
    sp.pressLatch = false; sp.releaseLatch = false;
    // Movement: the joystick wins while active, otherwise the 8-way keyboard vector.
    const s = this._stick, mv = it.move;
    if (s.active) {
      mv.x = s.vx; mv.z = s.vz; mv.mag = s.mag;
    } else if (this._moveKeys.size > 0) {
      keyAcc.x = 0; keyAcc.z = 0;
      this._moveKeys.forEach(addKeyMove);
      const x = keyAcc.x, z = keyAcc.z;
      const len = Math.sqrt(x * x + z * z);
      if (len > 0) { mv.x = x / len; mv.z = z / len; mv.mag = 1; } else { mv.x = 0; mv.z = 0; mv.mag = 0; }
    } else {
      mv.x = 0; mv.z = 0; mv.mag = 0;
    }
    it.pause.justPressed = this._pauseLatch;
    this._pauseLatch = false;
    return it;
  }

  // ---------- labels / state ----------
  setOffense(isOffense) {
    this.offense = !!isOffense;
    const c = this._els.cluster;
    if (c) { c.classList.toggle('offense', this.offense); c.classList.toggle('defense', !this.offense); }
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

  setEnabled(on) {
    on = !!on;
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) {
      this._releaseAll();
      // Drop pending edges too: nothing pressed before a menu opened should fire after it closes.
      for (let i = 0; i < BUTTONS.length; i++) { const b = this._btn[BUTTONS[i]]; b.pressLatch = false; b.releaseLatch = false; }
      const it = this.intent;
      clearEdges(it);
      it.primary.held = false; it.secondary.held = false; it.tertiary.held = false; it.sprint = false;
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

// Allocation-free accumulator for the keyboard move vector (Set.forEach cannot return values).
const keyAcc = { x: 0, z: 0 };
function addKeyMove(code) {
  const d = KEY_MOVE[code];
  if (d) { keyAcc.x += d[0]; keyAcc.z += d[1]; }
}
