// Unit checks for src/audio.js outside a browser.
// Run: node test/unit-audio.mjs
// Part 1: no AudioContext at all (plain Node) -> every method is a silent no-op, ctx stays null.
// Part 2: a minimal stub AudioContext -> the synthesis paths run, voices are capped at 8,
//         mute drives the master gain, and the crowd envelope decays.
import assert from 'node:assert/strict';
import { Audio } from '../src/audio.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

const SFX = ['bounce', 'rim', 'board', 'swish', 'block', 'dunk', 'whistle', 'buzzer', 'tick', 'click', 'crowd', 'groan'];
const ARGS = { bounce: [0.7], rim: [3], crowd: [1, 1.5] };

function callEverything(audio) {
  for (const name of SFX) audio[name](...(ARGS[name] || []));
  audio.update(0.016);
  audio.suspend();
  audio.resume();
}

// ---- Part 1: no AudioContext available -----------------------------------------------------------

check('module exports class Audio and constructs without a DOM', () => {
  assert.equal(typeof Audio, 'function');
  assert.equal(typeof globalThis.AudioContext, 'undefined');
  const a = new Audio();
  assert.equal(a.ctx, null);
  assert.equal(a.master, null);
  assert.equal(a.ready, false);
  assert.equal(typeof a.muted, 'boolean');
});

check('every SFX + update + suspend/resume is a no-op with no AudioContext (nothing throws)', () => {
  const a = new Audio();
  a.unlock();
  a.unlock();
  assert.equal(a.ctx, null);
  callEverything(a);
  a.update(0);
  a.update(-1);
  a.update(NaN);
  assert.equal(a.ctx, null);
  assert.equal(a.ready, false);
});

check('setMuted works without AudioContext and without localStorage', () => {
  const a = new Audio();
  a.setMuted(true);
  assert.equal(a.muted, true);
  callEverything(a);
  a.setMuted(false);
  assert.equal(a.muted, false);
  assert.equal(a.toggleMuted(), true);
  assert.equal(a.muted, true);
  assert.equal(a.ctx, null);
});

// ---- Part 2: stub AudioContext ----------------------------------------------------------------------

class Param {
  constructor(v) { this.value = v; this.events = 0; }
  setValueAtTime(v, t) { this._num(v, t); this.events++; }
  linearRampToValueAtTime(v, t) { this._num(v, t); this.events++; }
  exponentialRampToValueAtTime(v, t) { this._num(v, t); assert.ok(v > 0, 'exp ramp target must be > 0'); this.events++; }
  setTargetAtTime(v, t, tc) { this._num(v, t); assert.ok(tc > 0); this.events++; }
  cancelScheduledValues(t) { this._num(0, t); }
  _num(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t) && t >= 0, `bad param value ${v} @ ${t}`); }
}
class Node {
  constructor(ctx) { this.ctx = ctx; this.connections = []; }
  connect(dst) { assert.ok(dst instanceof Node || dst instanceof Param, 'connect target'); this.connections.push(dst); return dst; }
  disconnect() { this.connections.length = 0; }
}
class Gain extends Node { constructor(ctx) { super(ctx); this.gain = new Param(1); } }
class Biquad extends Node {
  constructor(ctx) { super(ctx); this.type = 'lowpass'; this.frequency = new Param(350); this.Q = new Param(1); }
}
class Source extends Node {
  constructor(ctx) { super(ctx); this.started = false; this.stopped = false; this.onended = null; ctx.sources.push(this); }
  start(t, offset) {
    assert.equal(this.started, false, 'start called twice');
    assert.ok(offset === undefined || (offset >= 0 && offset < 1), 'noise offset in range');
    this.started = true;
  }
  stop(t) { assert.equal(this.started, true, 'stop before start'); this.stopped = true; }
  end() { if (this.onended) this.onended(); }
}
class Osc extends Source {
  constructor(ctx) { super(ctx); this.type = 'sine'; this.frequency = new Param(440); this.detune = new Param(0); }
}
class BufSrc extends Source { constructor(ctx) { super(ctx); this.buffer = null; this.loop = false; } }
class Buffer {
  constructor(ch, len, sr) { this.length = len; this.sampleRate = sr; this.data = new Float32Array(len); }
  getChannelData() { return this.data; }
}
class StubContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.destination = new Node(this);
    this.sources = [];
    this.resumes = 0;
    this.suspends = 0;
  }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve(); }
  createGain() { return new Gain(this); }
  createBiquadFilter() { return new Biquad(this); }
  createOscillator() { return new Osc(this); }
  createBufferSource() { return new BufSrc(this); }
  createBuffer(ch, len, sr) { return new Buffer(ch, len, sr); }
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
};
globalThis.AudioContext = StubContext;

check('unlock() creates the context lazily, resumes it, builds the graph and plays the silent buffer', () => {
  const a = new Audio();
  assert.equal(a.ctx, null);
  a.unlock();
  assert.ok(a.ctx instanceof StubContext);
  assert.equal(a.ctx.state, 'running');
  assert.equal(a.ready, true);
  assert.equal(a.master.gain.value, 0.8);
  assert.ok(a.master.connections.includes(a.ctx.destination));
  const crowdLoop = a.ctx.sources.find((s) => s instanceof BufSrc && s.loop);
  assert.ok(crowdLoop && crowdLoop.started, 'crowd loop started');
  assert.equal(crowdLoop.buffer.length, 2 * 48000);
  let nonZero = 0;
  for (let i = 0; i < crowdLoop.buffer.length; i++) if (crowdLoop.buffer.data[i] !== 0) nonZero++;
  assert.ok(nonZero > crowdLoop.buffer.length * 0.99, 'crowd buffer is filled with noise');
  const silent = a.ctx.sources.find((s) => s instanceof BufSrc && s.buffer && s.buffer.length === 1);
  assert.ok(silent && silent.started, 'silent 1-sample buffer played');
  const ctx = a.ctx;
  a.unlock();
  a.unlock();
  assert.equal(a.ctx, ctx, 'unlock is idempotent');
});

check('every SFX synthesizes on a running context and cleans up its voice', () => {
  const a = new Audio();
  a.unlock();
  const before = a.ctx.sources.length;
  for (const name of SFX) {
    a[name](...(ARGS[name] || []));
    a.ctx.currentTime += 0.5;
    for (const s of a.ctx.sources) if (s.started && !s.loop) s.end();
    assert.equal(a._voices.length, 0, `${name}: voice released after its sources ended`);
  }
  // bounce 2 + rim 2 + board 2 + swish 1 + block 2 + dunk (board+rim) 4 + whistle 2 + buzzer 2 + tick 1 + click 1
  assert.equal(a.ctx.sources.length, before + 19, 'every recipe creates exactly its sources');
  for (const s of a.ctx.sources) if (!s.loop) assert.ok(s.stopped || s.buffer?.length === 1, 'every one-shot source has a stop time');
});

check('at most 8 simultaneous voices; the oldest is stopped', () => {
  const a = new Audio();
  a.unlock();
  const oscCount = () => a.ctx.sources.filter((s) => s instanceof Osc).length;
  for (let i = 0; i < 12; i++) a.tick();
  assert.equal(a._voices.length, 8);
  assert.equal(oscCount(), 12);
  const stopped = a.ctx.sources.filter((s) => s instanceof Osc && s.stopped).length;
  assert.equal(stopped, 12, 'stop() scheduled on all, immediate on the evicted 4');
  assert.equal(a.ctx.sources.filter((s) => s instanceof Osc && s.onended === null).length, 4, 'evicted voices lose their onended');
});

check('SFX are no-ops while suspended and while muted; setMuted drives master gain and persists', () => {
  const a = new Audio();
  a.unlock();
  a.suspend();
  assert.equal(a.ctx.state, 'suspended');
  assert.equal(a.ready, false);
  const n = a.ctx.sources.length;
  callEverything(a); // resume() inside callEverything runs last
  assert.equal(a.ctx.sources.length, n, 'nothing scheduled while suspended');
  assert.equal(a.ctx.state, 'running');
  a.setMuted(true);
  assert.equal(a.master.gain.value, 0);
  assert.equal(store.get('hoop.muted'), '1');
  const m = a.ctx.sources.length;
  for (const name of SFX) a[name](...(ARGS[name] || []));
  assert.equal(a.ctx.sources.length, m, 'nothing scheduled while muted');
  a.setMuted(false);
  assert.equal(a.master.gain.value, 0.8);
  assert.equal(store.get('hoop.muted'), '0');
  store.set('hoop.muted', '1');
  assert.equal(new Audio().muted, true, 'mute state read back from localStorage');
  store.set('hoop.muted', '0');
});

check('crowd envelope: swell to 0.06 + 0.25*level and linear decay over `seconds`', () => {
  const a = new Audio();
  a.unlock();
  const g = a._crowdGain.gain;
  assert.equal(g.value, 0.06);
  a.crowd(1, 2);
  a.update(0);
  a.update(0.5);
  assert.ok(Math.abs(g.value - (0.06 + 0.25 * 0.75)) < 1e-9, 'after 0.5 of 2 s: level 0.75');
  a.crowd(0.5, 2); // lower level does not cut the current swell
  a.update(0.5);
  assert.ok(Math.abs(g.value - (0.06 + 0.25 * 0.5)) < 1e-9);
  a.update(5);
  assert.equal(g.value, 0.06);
  a.dunk();
  a.update(1e-6);
  assert.ok(g.value > 0.30, 'dunk swells the crowd to level 1.0');
  a.update(1.5);
  assert.ok(Math.abs(g.value - 0.06) < 1e-6, 'dunk swell decays over the default 1.5 s');
  a.groan();
  assert.ok(a._crowdFilter.frequency.events >= 2, 'groan schedules the lowpass drop and recovery');
});

check('missing localStorage and a throwing AudioContext constructor are tolerated', () => {
  delete globalThis.localStorage;
  const a = new Audio();
  assert.equal(a.muted, false);
  a.setMuted(true);
  assert.equal(a.muted, true);
  globalThis.AudioContext = class { constructor() { throw new Error('not allowed'); } };
  const b = new Audio();
  b.unlock();
  assert.equal(b.ctx, null);
  callEverything(b);
});

console.log(`\n${passed} audio checks passed`);
