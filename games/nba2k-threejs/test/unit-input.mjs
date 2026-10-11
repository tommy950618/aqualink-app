// Unit checks for src/input.js with a fake DOM (spec v2 §5.7/§5.9 gestures, §6.5.7 controls, §12 R#7/R#9/R#10).
// Run: node test/unit-input.mjs        (add --expose-gc to also run the allocation probe of sample())
// Covers: Intent shape and helpers, quick-tap (< 120 ms) and double-tap (≤ 350 ms) timing, latches (press +
// release in one step), multi-touch ownership, slide-over, joystick edge start (R#9), tether re-clamp (R#10),
// .panel/.scroll touchmove exemption (R#7), gesture callbacks, keyboard map, enable/disable, relabel, destroy.
import assert from 'node:assert/strict';
import {
  Input, makeIntent, clearEdges, pressButton, releaseButton, notePress, noteRelease, isQuickTap,
  copyIntent, copyButtonState, QUICK_TAP_MS, DOUBLE_TAP_MS, STICK_IDLE_MAG,
} from '../src/input.js';
import { t } from '../src/i18n.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---- fake clock: event timestamps and performance.now() share it ----------------------------------
let clock = 1000;
performance.now = () => clock;

// ---- fake DOM ------------------------------------------------------------------------------------------
class ClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) { const on = force === undefined ? !this.set.has(c) : !!force; if (on) this.set.add(c); else this.set.delete(c); return on; }
}
class Listeners {
  constructor() { this.list = []; }
  addEventListener(type, fn, opts) { this.list.push({ type, fn, capture: !!(opts && (opts === true || opts.capture)), opts }); }
  removeEventListener(type, fn, opts) {
    const cap = !!(opts && (opts === true || opts.capture));
    const i = this.list.findIndex((l) => l.type === type && l.fn === fn && l.capture === cap);
    if (i >= 0) this.list.splice(i, 1);
  }
  _run(e, capture) {
    for (const l of this.list.slice()) if (l.type === e.type && l.capture === capture) { e.currentTarget = this; l.fn(e); }
  }
}
class El extends Listeners {
  constructor(id, rect, classes) {
    super();
    this.id = id;
    this.nodeType = 1;
    this.tagName = 'DIV';
    this.classList = new ClassList();
    for (const c of classes || []) this.classList.add(c);
    this.style = {};
    this.attrs = {};
    this.textContent = '';
    this.children = [];
    this.parentNode = null;
    this.rect = rect || { left: 0, top: 0, right: 0, bottom: 0 };
    this.captured = [];
  }
  append(child) { child.parentNode = this; this.children.push(child); return child; }
  getBoundingClientRect() { const r = this.rect; return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - r.left, height: r.bottom - r.top }; }
  setPointerCapture(id) { this.captured.push(id); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  querySelector(sel) {
    if (sel[0] !== '.') return null;
    const c = sel.slice(1);
    for (const ch of this.children) { if (ch.classList.contains(c)) return ch; const d = ch.querySelector(sel); if (d) return d; }
    return null;
  }
  closest(sel) {
    const classes = sel.split(',').map((s) => s.trim().slice(1));
    for (let el = this; el && el.nodeType === 1; el = el.parentNode) if (classes.some((c) => el.classList.contains(c))) return el;
    return null;
  }
  contains(x, y) { const r = this.rect; return x >= r.left && x < r.right && y >= r.top && y < r.bottom; }
}
class Win extends Listeners { constructor(w, h) { super(); this.innerWidth = w; this.innerHeight = h; this.navigator = {}; } }
class Doc extends Listeners {
  constructor(w, h) {
    super();
    this.nodeType = 9;
    this.hidden = false;
    this.defaultView = new Win(w, h);
    this.byId = {};
    this.hitList = [];
    this.body = new El('body', { left: 0, top: 0, right: w, bottom: h });
  }
  add(el, parent, hittable) { this.byId[el.id] = el; (parent || this.body).append(el); if (hittable) this.hitList.push(el); return el; }
  getElementById(id) { return this.byId[id] || null; }
  elementFromPoint(x, y) {
    for (let i = this.hitList.length - 1; i >= 0; i--) if (this.hitList[i].contains(x, y)) return this.hitList[i];
    return this.body;
  }
}

// Landscape 844×390 layout (v1 §3.2): zone = left 45 % from y 72; cluster 156×228 at right/bottom 16.
function buildDom(w = 844, h = 390, opts = {}) {
  const doc = new Doc(w, h);
  const controls = doc.add(new El('controls', { left: 0, top: 0, right: w, bottom: h }));
  const zr = opts.zone || { left: 0, top: 72, right: Math.round(w * 0.45), bottom: h };
  doc.add(new El('stickZone', zr), controls, true);
  const ring = doc.add(new El('stickRing'), controls);
  doc.add(new El('stickKnob'), ring);
  const cl = { left: w - 16 - 156, top: h - 16 - 228, right: w - 16, bottom: h - 16 };
  const cluster = doc.add(new El('cluster', cl, ['offense']), controls);
  const at = (x0, y0, ww, hh) => ({ left: cl.left + x0, right: cl.left + x0 + ww, bottom: cl.bottom - y0, top: cl.bottom - y0 - hh });
  const mk = (id, r) => { const b = doc.add(new El(id, r), cluster, true); b.tagName = 'BUTTON'; b.append(new El(id + 'Glyph', null, ['glyph'])); b.append(new El(id + 'Label', null, ['label'])); return b; };
  mk('btnSprint', at(12, 0, 132, 56));
  mk('btnSecondary', at(0, 68, 72, 72));
  mk('btnTertiary', at(84, 68, 72, 72));
  mk('btnPrimary', at(42, 152, 72, 72));
  doc.add(new El('btnPause', { left: w - 52, top: 8, right: w - 8, bottom: 52 }), controls, true);
  const panel = doc.add(new El('menuOver', { left: 100, top: 20, right: 500, bottom: 300 }, ['panel']));
  doc.add(new El('boxRow', { left: 110, top: 40, right: 490, bottom: 60 }), panel);
  return doc;
}

function centre(el) { const r = el.rect; return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }

// Dispatch like a browser: document capture → target (+ ancestors, bubbling) → document bubble.
function fire(doc, target, type, props = {}) {
  const e = {
    type, target, currentTarget: null, cancelable: true, defaultPrevented: false, timeStamp: clock,
    pointerId: 1, pointerType: 'touch', button: 0, clientX: 0, clientY: 0, repeat: false, code: '',
    preventDefault() { this.defaultPrevented = true; }, ...props,
  };
  doc._run(e, true);
  for (let el = target; el && el !== doc; el = el.parentNode) if (el instanceof Listeners) el._run(e, false);
  doc._run(e, false);
  return e;
}
function down(doc, el, id, x, y, extra) {
  const p = x === undefined ? centre(el) : { x, y };
  return fire(doc, el, 'pointerdown', { pointerId: id, clientX: p.x, clientY: p.y, ...extra });
}
function move(doc, id, x, y) { return fire(doc, doc.body, 'pointermove', { pointerId: id, clientX: x, clientY: y }); }
function up(doc, id, x = 0, y = 0) { return fire(doc, doc.body, 'pointerup', { pointerId: id, clientX: x, clientY: y }); }
function key(doc, type, code, repeat = false) { return fire(doc, doc.body, type, { code, repeat }); }

function setup(w, h, opts = {}) {
  const doc = buildDom(w, h, opts);
  const log = { gestures: 0, pause: 0, mute: 0, lang: 0 };
  const cb = { onGesture: () => log.gestures++, onMute: () => log.mute++, onLang: () => log.lang++ };
  if (!opts.noPause) cb.onPause = () => log.pause++;
  const input = new Input(doc, cb);
  return { doc, input, log, it: input.intent, $: (id) => doc.getElementById(id) };
}

// ---- pure helpers ---------------------------------------------------------------------------------

check('makeIntent: v1 shape + v2 tap fields; clearEdges clears edges only', () => {
  const it = makeIntent();
  assert.deepEqual(Object.keys(it).sort(), ['move', 'pause', 'post', 'primary', 'secondary', 'sprint', 'tertiary']);
  assert.deepEqual(Object.keys(it.move).sort(), ['idle', 'mag', 'x', 'z']);
  assert.deepEqual(Object.keys(it.primary).sort(),
    ['doubleTap', 'heldTime', 'held', 'justPressed', 'justReleased', 'prevPressTs', 'pressTs', 'quickTap', 'releaseTs', 'tapDur', 'taps'].sort());
  pressButton(it.primary, 100);
  releaseButton(it.primary, 150);
  pressButton(it.tertiary, 200);
  pressButton(it.tertiary, 300);
  it.pause.justPressed = true;
  clearEdges(it);
  for (const b of [it.primary, it.secondary, it.tertiary]) {
    assert.equal(b.justPressed || b.justReleased || b.doubleTap || b.quickTap, false);
  }
  assert.equal(it.pause.justPressed, false);
  assert.equal(it.tertiary.held, true, 'held survives');
  assert.equal(it.tertiary.taps, 2, 'tap count survives');
});

check(`quick tap: release − press < ${QUICK_TAP_MS} ms (119 yes, 120 no)`, () => {
  const b = makeIntent().primary;
  pressButton(b, 5000); releaseButton(b, 5119);
  assert.equal(b.quickTap, true); assert.ok(near(b.tapDur, 0.119)); assert.ok(near(b.heldTime, 0.119));
  assert.equal(b.justReleased, true); assert.equal(b.held, false);
  pressButton(b, 6000); releaseButton(b, 6120);
  assert.equal(b.quickTap, false);
  releaseButton(b, 7000);
  assert.ok(near(b.tapDur, 0.12), 'release without a press is ignored');
  const raw = { pressTs: 0, releaseTs: 0, taps: 0, prevPressTs: 0, tapDur: 0 };
  notePress(raw, 10); noteRelease(raw, 60);
  assert.equal(isQuickTap(raw), true);
});

check(`double tap: press-to-press ≤ ${DOUBLE_TAP_MS} ms (350 yes, 351 no), chains count up, world clock may start at 0`, () => {
  const b = makeIntent().tertiary;
  pressButton(b, 0); releaseButton(b, 40);
  assert.equal(b.taps, 1); assert.equal(b.doubleTap, false);
  pressButton(b, 350);
  assert.equal(b.taps, 2); assert.equal(b.doubleTap, true); assert.equal(b.prevPressTs, 0);
  releaseButton(b, 380);
  pressButton(b, 600);
  assert.equal(b.taps, 3, 'triple tap (Kyrie combo)');
  releaseButton(b, 650);
  pressButton(b, 951);
  assert.equal(b.taps, 1); assert.equal(b.doubleTap, false);
});

check('copyIntent / copyButtonState copy every field without allocating new objects', () => {
  const a = makeIntent(), b = makeIntent();
  const prim = b.primary;
  a.move.x = 0.6; a.move.z = -0.8; a.move.mag = 1; a.move.idle = 2; a.sprint = true; a.post = true;
  pressButton(a.tertiary, 10); pressButton(a.tertiary, 100);
  pressButton(a.primary, 50); releaseButton(a.primary, 90);
  copyIntent(b, a);
  assert.equal(b.primary, prim);
  assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)));
  const c = makeIntent().tertiary;
  copyButtonState(c, a.tertiary);
  assert.equal(c.taps, 2); assert.equal(c.held, true); assert.equal(c.justPressed, false, 'edges not copied');
});

// ---- Input with a fake DOM -------------------------------------------------------------------------

check('constructs in a fake DOM, labels the cluster from i18n, relabels on defence', () => {
  const { input, $ } = setup();
  assert.equal($('btnPrimary').querySelector('.label').textContent, t('btn.shoot'));
  assert.equal($('btnTertiary').querySelector('.label').getAttribute('data-i18n'), 'btn.cross');
  input.setOffense(false);
  assert.equal($('btnPrimary').querySelector('.label').textContent, t('btn.block'));
  assert.equal($('btnSecondary').querySelector('.label').textContent, t('btn.switch'));
  assert.equal($('cluster').classList.contains('defense'), true);
  assert.equal($('cluster').classList.contains('offense'), false);
  input.destroy();
});

check('button latches: press → justPressed once; press + release inside one step → both edges', () => {
  const { doc, input, it, $ } = setup();
  clock = 2000;
  down(doc, $('btnPrimary'), 7);
  assert.equal($('btnPrimary').classList.contains('pressed'), true);
  assert.deepEqual($('btnPrimary').captured, [7], 'pointer captured');
  clock = 2016; input.sample(clock);
  assert.equal(it.primary.justPressed, true); assert.equal(it.primary.held, true); assert.equal(it.primary.pressTs, 2000);
  assert.ok(near(it.primary.heldTime, 0.016));
  clock = 2033; input.sample(clock);
  assert.equal(it.primary.justPressed, false, 'edge lasts one step');
  clock = 2600; up(doc, 7);
  input.sample(clock);
  assert.equal(it.primary.justReleased, true); assert.equal(it.primary.held, false);
  assert.ok(near(it.primary.heldTime, 0.6)); assert.equal(it.primary.quickTap, false);
  clock = 3000; down(doc, $('btnSecondary'), 8); clock = 3005; up(doc, 8);
  clock = 3010; input.sample(clock);
  assert.equal(it.secondary.justPressed && it.secondary.justReleased, true, 'both edges in one step');
  assert.equal(it.secondary.held, false);
  input.destroy();
});

check('catch-up steps: a press / release later than the step time waits for the step that reaches it', () => {
  const { doc, input, it, $ } = setup();
  clock = 30000; down(doc, $('btnPrimary'), 5); clock = 30050; up(doc, 5);
  // one slow frame delivered both events; its catch-up steps stand for 29950, 29967, … 30067
  input.sample(29950);
  assert.equal(it.primary.justPressed, false, 'step before the press: nothing yet'); assert.equal(it.primary.held, false);
  input.sample(30017);
  assert.equal(it.primary.justPressed, true); assert.equal(it.primary.held, true); assert.equal(it.primary.justReleased, false);
  input.sample(30034);
  assert.equal(it.primary.justPressed, false); assert.equal(it.primary.held, true, 'still held before the release time');
  input.sample(30051);
  assert.equal(it.primary.justReleased, true); assert.equal(it.primary.held, false); assert.equal(it.primary.quickTap, true);
  // a release that ended an earlier hold is folded even when the next press is still ahead
  clock = 31000; down(doc, $('btnSecondary'), 6); input.sample(31001);
  clock = 31100; up(doc, 6); clock = 31200; down(doc, $('btnSecondary'), 6);
  input.sample(31150);
  assert.equal(it.secondary.justReleased, true); assert.equal(it.secondary.held, false); assert.equal(it.secondary.justPressed, false);
  input.sample(31210);
  assert.equal(it.secondary.justPressed, true); assert.equal(it.secondary.held, true);
  clock = 31300; up(doc, 6); input.sample(clock);
  input.destroy();
});

check('touch quick tap on SHOOT (< 120 ms) sets quickTap on the release step; a 150 ms hold does not', () => {
  const { doc, input, it, $ } = setup();
  clock = 10000; down(doc, $('btnPrimary'), 3);
  input.sample(clock + 4);
  clock = 10080; up(doc, 3);
  input.sample(clock + 4);
  assert.equal(it.primary.quickTap, true); assert.ok(near(it.primary.tapDur, 0.08));
  input.sample(clock + 20);
  assert.equal(it.primary.quickTap, false, 'quickTap is an edge');
  clock = 11000; down(doc, $('btnPrimary'), 3); clock = 11150; up(doc, 3);
  input.sample(clock + 1);
  assert.equal(it.primary.quickTap, false);
  input.destroy();
});

check('touch double tap on CROSS within 350 ms → doubleTap, taps 2; triple → 3; slower → 1', () => {
  const { doc, input, it, $ } = setup();
  const tap = (t0) => { clock = t0; down(doc, $('btnTertiary'), 4); clock = t0 + 50; up(doc, 4); };
  tap(20000); input.sample(clock);
  assert.equal(it.tertiary.taps, 1); assert.equal(it.tertiary.doubleTap, false);
  tap(20300); input.sample(clock);
  assert.equal(it.tertiary.taps, 2); assert.equal(it.tertiary.doubleTap, true); assert.equal(it.tertiary.prevPressTs, 20000);
  tap(20600); input.sample(clock);
  assert.equal(it.tertiary.taps, 3);
  tap(21000); input.sample(clock);
  assert.equal(it.tertiary.taps, 1); assert.equal(it.tertiary.doubleTap, false);
  // Two complete taps between two samples still report the double tap.
  tap(30000); tap(30040); input.sample(clock + 1);
  assert.equal(it.tertiary.doubleTap, true); assert.equal(it.tertiary.taps, 2);
  input.destroy();
});

check('keyboard: L L = double tap, Space quick tap = quickTap, key repeat ignored, Shift = sprint, WASD 8-way', () => {
  const { doc, input, it, log } = setup();
  clock = 40000; key(doc, 'keydown', 'KeyL'); clock = 40060; key(doc, 'keyup', 'KeyL');
  clock = 40200; key(doc, 'keydown', 'KeyL'); key(doc, 'keydown', 'KeyL', true); clock = 40250; key(doc, 'keyup', 'KeyL');
  input.sample(clock);
  assert.equal(it.tertiary.doubleTap, true); assert.equal(it.tertiary.taps, 2);
  clock = 41000; key(doc, 'keydown', 'Space'); clock = 41090; key(doc, 'keyup', 'Space');
  input.sample(clock);
  assert.equal(it.primary.quickTap, true);
  key(doc, 'keydown', 'ShiftLeft'); key(doc, 'keydown', 'KeyW'); key(doc, 'keydown', 'KeyD');
  input.sample(clock);
  assert.equal(it.sprint, true);
  assert.ok(near(it.move.x, Math.SQRT1_2) && near(it.move.z, -Math.SQRT1_2) && it.move.mag === 1);
  key(doc, 'keyup', 'ShiftLeft'); key(doc, 'keyup', 'KeyW'); key(doc, 'keyup', 'KeyD');
  input.sample(clock);
  assert.equal(it.sprint, false); assert.equal(it.move.mag, 0);
  const g = log.gestures;
  key(doc, 'keydown', 'KeyM'); key(doc, 'keydown', 'KeyT'); key(doc, 'keydown', 'KeyP'); key(doc, 'keydown', 'KeyP', true);
  assert.deepEqual([log.mute, log.lang, log.pause], [1, 1, 1]);
  assert.equal(log.gestures, g + 3, 'non-repeat keydowns are gestures');
  input.destroy();
});

check('multi-touch ownership: stick + button + ignored second stick finger + slide-over', () => {
  const { doc, input, it, $ } = setup();
  clock = 50000;
  down(doc, $('stickZone'), 1, 150, 250);
  down(doc, $('btnPrimary'), 2);
  down(doc, $('stickZone'), 3, 250, 200);          // second finger in the zone: ignored
  move(doc, 3, 300, 200);
  input.sample(clock);
  assert.equal(it.move.mag, 0, 'neither the second finger nor the button moves the stick');
  assert.equal(it.primary.held, true);
  assert.equal(input.stick.pointerId, 1);
  move(doc, 1, 150, 250 - 56);                     // full deflection up (toward the hoop)
  input.sample(clock);
  assert.ok(near(it.move.z, -1) && near(it.move.x, 0) && near(it.move.mag, 1));
  down(doc, $('btnPrimary'), 4);                   // another finger on a held button: ignored
  up(doc, 4);
  input.sample(clock);
  assert.equal(it.primary.held, true, 'finger 4 never owned the button');
  // Slide finger 2 from SHOOT onto PASS: SHOOT released, PASS pressed.
  const p = centre($('btnSecondary'));
  clock = 50100; move(doc, 2, p.x, p.y);
  input.sample(clock);
  assert.equal(it.primary.justReleased, true); assert.equal(it.secondary.justPressed, true);
  assert.equal(it.secondary.held, true);
  up(doc, 1);
  input.sample(clock);
  assert.equal(it.move.mag, 0); assert.equal(it.secondary.held, true, 'lifting the stick finger keeps the button');
  fire(doc, doc.body, 'pointercancel', { pointerId: 2 });
  input.sample(clock);
  assert.equal(it.secondary.held, false, 'pointercancel releases');
  input.destroy();
});

check('R#9: a thumb landing at the edge starts with zero deflection; a 60 px drag still reaches > 0.5', () => {
  for (const [x, y, w, h] of [[4, 300, 844, 390], [150, 386, 844, 390], [4, 820, 390, 844]]) {
    const portrait = h > w;
    const zone = portrait ? { left: 0, top: Math.round(h * 0.55), right: w - 190, bottom: h } : undefined;
    const { doc, input, it, $ } = setup(w, h, { zone });
    down(doc, $('stickZone'), 1, x, y);
    input.sample(clock);
    assert.equal(it.move.mag, 0, `touch at (${x}, ${y}) without a move`);
    const s = input.stick;
    assert.ok(s.cx >= 24 && s.cy <= h - 24, 'ring centre ≥ 24 px from the edges');
    assert.ok(s.knobX === 0 && s.knobY === 0, 'knob centred');
    move(doc, 1, s.cx + 60, s.cy);
    input.sample(clock);
    assert.ok(it.move.mag > 0.5 && it.move.x > 0.5, `drag works (mag ${it.move.mag})`);
    input.destroy();
  }
});

check('dead zone 0.15 remapped (8 px → 0, 28 px → 0.41, 56 px → 1) and stick idle time', () => {
  const { doc, input, it, $ } = setup();
  clock = 60000;
  input.sample(clock);
  down(doc, $('stickZone'), 1, 150, 250);
  move(doc, 1, 158, 250);
  clock = 60500; input.sample(clock);
  assert.equal(it.move.mag, 0);
  assert.ok(near(it.move.idle, 0.5), `idle accumulates under 0.15 raw (${it.move.idle})`);
  move(doc, 1, 178, 250);
  input.sample(clock);
  assert.ok(near(it.move.mag, (0.5 - 0.15) / 0.85, 1e-9));
  assert.equal(it.move.idle, 0, 'idle resets at raw ≥ STICK_IDLE_MAG');
  assert.equal(STICK_IDLE_MAG, 0.15);
  move(doc, 1, 150, 250 + 56);
  input.sample(clock);
  assert.ok(near(it.move.mag, 1) && near(it.move.z, 1));
  up(doc, 1);
  clock = 60400 + 500; input.sample(clock);
  assert.ok(near(it.move.idle, 0.4), 'idle counts from the last active step');
  input.destroy();
});

check('R#10: tethered ring centre stays inside the stick box; the vector saturates at the box edge', () => {
  const { doc, input, it, $ } = setup();
  down(doc, $('stickZone'), 1, 150, 250);
  for (let x = 150; x <= 780; x += 30) move(doc, 1, x, 250);
  input.sample(clock);
  const s = input.stick;
  assert.ok(s.cx <= $('stickZone').rect.right, `ring centre x ${s.cx} inside the zone`);
  assert.ok(near(it.move.mag, 1) && it.move.x > 0.99, 'still full right');
  assert.ok(Math.hypot(s.knobX, s.knobY) <= 56 + 1e-9, 'knob clamped to the 56 px radius');
  // Coming back left the vector reverses immediately (no 600 px of dead travel).
  move(doc, 1, s.cx - 40, 250);
  input.sample(clock);
  assert.ok(it.move.x < -0.5, `reverses (${it.move.x})`);
  input.destroy();
});

check('R#10: in a narrow portrait layout the ring never reaches under the cluster', () => {
  const w = 390, h = 844;
  const zone = { left: 0, top: Math.round(h * 0.55), right: w - 190, bottom: h };
  const { doc, input, $ } = setup(w, h, { zone });
  const cl = $('cluster').rect;
  down(doc, $('stickZone'), 1, 195, 700);
  const s = input.stick;
  assert.ok(s.cx + 60 <= cl.left, `ring right edge ${s.cx + 60} ≤ cluster left ${cl.left}`);
  for (let x = 195; x <= 380; x += 20) move(doc, 1, x, 700);
  assert.ok(s.cx + 60 <= cl.left, 'still clear after tethering');
  assert.ok(s.cx + s.knobX + 26 <= cl.left, 'the knob (56 + 26 px reach) stays clear too');
  assert.ok($('stickRing').style.transform.startsWith('translate3d('), 'ring drawn');
  assert.equal($('stickRing').classList.contains('active'), true);
  up(doc, 1);
  assert.equal($('stickRing').classList.contains('active'), false);
  input.destroy();
});

check('R#7: document touchmove is cancelled except inside .panel / .scroll', () => {
  const { doc, input, $ } = setup();
  const e1 = fire(doc, $('stickZone'), 'touchmove');
  assert.equal(e1.defaultPrevented, true);
  const e2 = fire(doc, $('boxRow'), 'touchmove');
  assert.equal(e2.defaultPrevented, false, 'panel content scrolls');
  const text = { nodeType: 3, parentNode: $('boxRow') };
  const e3 = fire(doc, text, 'touchmove');
  assert.equal(e3.defaultPrevented, false, 'text node inside the panel');
  const e4 = fire(doc, doc.body, 'dblclick');
  assert.equal(e4.defaultPrevented, true);
  input.destroy();
});

check('audio-unlock gestures: pointerdown, pointerup, touchend, click all call onGesture / onAnyGesture', () => {
  const { doc, input, log, $ } = setup();
  let extra = 0;
  const off = input.onAnyGesture(() => extra++);
  input.onAnyGesture(() => { throw new Error('a failing callback must not break input'); });
  down(doc, $('btnPrimary'), 5);
  up(doc, 5);
  fire(doc, doc.body, 'touchend');
  fire(doc, doc.body, 'click');
  assert.equal(log.gestures, 4); assert.equal(extra, 4);
  assert.equal(input.isTouch, true, 'touch seen');
  off();
  fire(doc, doc.body, 'click');
  assert.equal(extra, 4); assert.equal(log.gestures, 5);
  input.destroy();
});

check('pause: button pointerup calls onPause; without onPause the latch reaches intent.pause once', () => {
  let s = setup();
  down(s.doc, s.$('btnPause'), 9);
  assert.equal(s.$('btnPause').classList.contains('pressed'), true);
  up(s.doc, 9);
  assert.equal(s.log.pause, 1);
  s.input.destroy();
  s = setup(844, 390, { noPause: true });
  down(s.doc, s.$('btnPause'), 9); up(s.doc, 9);
  s.input.sample(clock);
  assert.equal(s.it.pause.justPressed, true);
  s.input.sample(clock);
  assert.equal(s.it.pause.justPressed, false);
  s.input.destroy();
});

check('setEnabled(false) releases everything, drops edges and tap chains; disabled input ignores presses', () => {
  const { doc, input, it, $ } = setup();
  clock = 70000;
  down(doc, $('stickZone'), 1, 150, 250); move(doc, 1, 200, 250);
  down(doc, $('btnTertiary'), 2); up(doc, 2);
  input.setEnabled(false);
  input.sample(clock);
  assert.equal(it.move.mag, 0); assert.equal(it.tertiary.justPressed, false); assert.equal(it.tertiary.taps, 0);
  down(doc, $('btnPrimary'), 3);
  input.sample(clock);
  assert.equal(it.primary.held, false, 'ignored while disabled');
  up(doc, 3);
  input.setEnabled(true);
  clock = 70100; down(doc, $('btnTertiary'), 4); up(doc, 4);
  input.sample(clock);
  assert.equal(it.tertiary.taps, 1, 'a tap before the menu never pairs with one after it');
  assert.equal(input.anyHeld, false);
  input.destroy();
});

check('window blur and hidden visibility release held controls; destroy() removes every listener', () => {
  const { doc, input, it, $ } = setup();
  down(doc, $('btnPrimary'), 2);
  key(doc, 'keydown', 'KeyK');
  input.sample(clock);
  assert.equal(it.primary.held && it.secondary.held, true);
  doc.defaultView._run({ type: 'blur' }, false);
  input.sample(clock);
  assert.equal(it.primary.held || it.secondary.held, false);
  assert.equal(it.primary.justReleased, true);
  down(doc, $('btnPrimary'), 3);
  doc.hidden = true;
  fire(doc, doc, 'visibilitychange');
  input.sample(clock);
  assert.equal(it.primary.held, false);
  input.destroy();
  assert.equal(doc.list.length, 0, 'document listeners removed');
  assert.equal(doc.defaultView.list.length, 0, 'window listeners removed');
  assert.equal($('btnPrimary').list.length, 0, 'button listeners removed');
});

check('Input works without a DOM (Node / headless game)', () => {
  const input = new Input(null, {});
  const it = input.sample(1234);
  assert.equal(it.move.mag, 0);
  input.setOffense(false); input.setEnabled(false); input.setEnabled(true); input.destroy();
});

if (typeof globalThis.gc === 'function') {
  check('sample() allocates nothing (heap probe, --expose-gc)', () => {
    const { doc, input, $ } = setup();
    down(doc, $('stickZone'), 1, 150, 250); move(doc, 1, 190, 230);
    key(doc, 'keydown', 'KeyW');
    for (let i = 0; i < 5000; i++) input.sample(clock + i);
    globalThis.gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200000; i++) input.sample(clock + i);
    globalThis.gc();
    const grown = process.memoryUsage().heapUsed - h0;
    assert.ok(grown < 64 * 1024, `heap grew ${grown} B over 200k samples`);
    up(doc, 1); key(doc, 'keyup', 'KeyW');
    input.destroy();
  });
}

console.log(`\n${passed} input checks passed`);
