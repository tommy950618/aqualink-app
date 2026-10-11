// Unit checks for src/audio.js + src/audio/crowd.js outside a browser (spec v2 §6.7, §9.4: new SFX with a mock
// AudioContext, squeak rate limit, voice cap 16, crowd envelopes; B27: every call safe while suspended).
// Run: node test/unit-audio.mjs        (add --expose-gc to also run the allocation probe)
// Part 1: no AudioContext at all (plain Node) -> every method is a silent no-op, ctx stays null.
// Part 2: a mock AudioContext -> graph, buses, voices, spatialisation, replay variants, squeaks, crowd.
import assert from 'node:assert/strict';
import { Audio, CrowdAudio, MAX_VOICES, MAX_SQUEAKS, CROWD_VOLUMES, CROWD_REACTIONS, BASE_CLUTCH,
  squeakIntensity, thudWeight } from '../src/audio.js';
import { fillPink, foldLoop, bandpassLoop, CROWD_RATE } from '../src/audio/crowd.js';
import { Rng } from '../src/math.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Every public SFX with representative arguments (v1 + v2).
const CALLS = [
  ['bounce', [0.7, 1, -8]], ['bounce', [0.5]], ['rim', [3]], ['rim', [0.5]], ['rim', [2, 'clank']], ['rim', [1, 'tap']],
  ['rim', [1, 'rattle']], ['rim', [1, 'grab']], ['board', []], ['board', ['bank']], ['board', ['thud']],
  ['net', ['swish']], ['net', ['rimIn']], ['net', ['snap']], ['swish', []], ['block', [0, -11]], ['dunk', []],
  ['squeak', [1, 2, -9, 'kobe']], ['thud', [0.8, 0, -10]], ['whistle', []], ['horn', []], ['buzzer', []],
  ['shotHorn', []], ['tick', []], ['click', []], ['select', []], ['whoosh', []], ['boom', []], ['sting', []],
  ['wipe', []], ['crowd', [1, 1.5]], ['groan', []],
];
const CROWD_CALLS = [
  ['excite', [0.8, 2]], ['setBase', [0.25]], ['burst', ['ooh', 0.8]], ['burst', ['aah', 1]], ['burst', ['aww', 0.6]],
  ['applause', [2]], ['chant', [true]], ['chant', [false]], ['anticipate', []], ['resolveAnticipation', ['cheer']],
  ['react', ['dunk']], ['react', ['make3']], ['react', ['cpuMake']], ['react', ['winner']], ['react', ['nope']],
  ['update', [0.016]], ['stop', []], ['setBase', [0.05]],
];

function callEverything(audio) {
  for (const [name, args] of CALLS) audio[name](...args);
  for (const [name, args] of CROWD_CALLS) audio.crowdAudio[name](...args);
  audio.setSlow(true); audio.tick(); audio.setSlow(false);
  audio.setListener(0, 6.5, 4.5); audio.bounce(0.5, 3, -5); audio.clearListener();
  audio.setCrowdVolume('high'); audio.setCrowdVolume(0.7); audio.setCrowdVolume('bogus');
  audio.update(0.016);
  audio.update(0.016, { position: { x: 0, y: 6, z: 4 } });
  audio.suspend();
  audio.resume();
}

// ---- Part 1: no AudioContext available -----------------------------------------------------------

check('module exports and constructs without a DOM', () => {
  assert.equal(typeof Audio, 'function');
  assert.equal(typeof CrowdAudio, 'function');
  assert.equal(MAX_VOICES, 16);
  assert.equal(MAX_SQUEAKS, 3);
  assert.deepEqual({ ...CROWD_VOLUMES }, { low: 0.4, mid: 0.7, high: 1.0 });
  assert.equal(typeof globalThis.AudioContext, 'undefined');
  const a = new Audio();
  assert.equal(a.ctx, null);
  assert.equal(a.master, null);
  assert.equal(a.ready, false);
  assert.equal(typeof a.muted, 'boolean');
  assert.equal(a.crowdAudio.attached, false);
});

check('every v1 + v2 SFX, crowd call, update, suspend/resume is a no-op with no AudioContext', () => {
  const a = new Audio();
  a.unlock();
  a.unlock();
  assert.equal(a.ctx, null);
  callEverything(a);
  a.update(0); a.update(-1); a.update(NaN);
  a.stopAll();
  assert.equal(a.ctx, null);
  assert.equal(a.ready, false);
  assert.equal(a.voiceCount, 0);
});

check('setMuted works without AudioContext and without localStorage', () => {
  const a = new Audio();
  a.setMuted(true);
  assert.equal(a.muted, true);
  assert.equal(a.crowdAudio.muted, true);
  callEverything(a);
  a.setMuted(false);
  assert.equal(a.muted, false);
  assert.equal(a.toggleMuted(), true);
  assert.equal(a.muted, true);
  assert.equal(a.ctx, null);
});

check('crowd excitement bookkeeping runs without a context (visual crowd model §2.8)', () => {
  const c = new CrowdAudio({ seed: 7 });
  assert.equal(c.level, 0.05);
  c.excite(0.6, 1.5);
  assert.equal(c.level, 0.6);
  c.update(1.0);
  assert.equal(c.level, 0.6, 'held');
  c.update(0.5);                         // hold ends exactly
  c.update(0.5);                         // 0.5 s of decay at 0.5 /s
  assert.ok(near(c.level, 0.35, 1e-9), `decays at 0.5/s (${c.level})`);
  c.update(5);
  assert.equal(c.level, 0.05, 'settles on the normal base');
  c.setBase(BASE_CLUTCH);
  c.update(0.2);
  assert.ok(near(c.level, 0.15, 1e-9), 'rises toward the clutch base at 0.5/s');
  c.update(1);
  assert.equal(c.level, 0.25);
  c.excite(0.3, 1); c.excite(0.2, 5);
  assert.equal(c.level, 0.3, 'a lower level never cuts the current one');
  assert.equal(c.react('block'), true);
  assert.equal(c.level, CROWD_REACTIONS.block.excite);
  assert.equal(c.react('unknown'), false);
});

check('squeakIntensity and thudWeight follow the §6.7 trigger rules', () => {
  assert.equal(squeakIntensity(6, 0), 0);
  assert.equal(squeakIntensity(11, 0), 0.5);
  assert.equal(squeakIntensity(16, 0), 1);
  assert.equal(squeakIntensity(30, 0), 1);
  assert.equal(squeakIntensity(2, 360), 1);
  assert.equal(squeakIntensity(2, -400), 1);
  assert.equal(squeakIntensity(NaN, NaN), 0);
  assert.equal(thudWeight(95, 0.3), 0, 'light player, small hop: no thud');
  assert.equal(thudWeight(95, 0.5), 0.4, 'every landing from 0.5 m');
  assert.equal(thudWeight(141, 0.1), clampN(0.4 + 31 * 0.015, 0.4, 1), 'Yao-weight landing');
  assert.equal(thudWeight(141, 0.9), 1);
});

function clampN(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

check('offline loop builders: pink spectrum tilt, seamless fold, band-pass', () => {
  const rng = new Rng(3);
  const n = 1 << 15;
  const d = new Float32Array(n);
  fillPink(d, 0, n, rng);
  // Pink noise: low-frequency energy dominates. Compare the variance of the signal with that of its
  // first difference (a crude high-pass): white noise gives diff/sig ≈ 2, pink noise far less.
  let s2 = 0, d2 = 0;
  for (let i = 1; i < n; i++) { s2 += d[i] * d[i]; d2 += (d[i] - d[i - 1]) ** 2; }
  assert.ok(d2 / s2 < 0.6, `pink tilt (${(d2 / s2).toFixed(3)})`);
  const data = new Float32Array(1000).fill(1);
  const tail = new Float32Array(100).fill(1);
  tail[0] = 0.25;
  foldLoop(data, tail);
  assert.ok(near(data[0], 0.25), 'the loop start equals the sample that follows the end');
  const tone = new Float32Array(CROWD_RATE);
  for (let i = 0; i < tone.length; i++) tone[i] = Math.sin(2 * Math.PI * 1200 * i / CROWD_RATE) + Math.sin(2 * Math.PI * 60 * i / CROWD_RATE);
  bandpassLoop(tone, CROWD_RATE, 1200, 1.5);
  let peak = 0;
  for (let i = 0; i < tone.length; i++) peak = Math.max(peak, Math.abs(tone[i]));
  assert.ok(peak > 0.9 && peak < 1.1, `band-pass keeps 1.2 kHz at 0 dB and removes 60 Hz (peak ${peak.toFixed(3)})`);
});

// ---- Part 2: mock AudioContext ----------------------------------------------------------------------

class Param {
  constructor(v) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this._num(v, t); this.events.push(['set', v, t]); }
  linearRampToValueAtTime(v, t) { this._num(v, t); this.events.push(['lin', v, t]); }
  exponentialRampToValueAtTime(v, t) { this._num(v, t); assert.ok(v > 0, 'exp ramp target must be > 0'); this.events.push(['exp', v, t]); }
  setTargetAtTime(v, t, tc) { this._num(v, t); assert.ok(tc > 0); this.events.push(['target', v, t, tc]); }
  cancelScheduledValues(t) { this._num(0, t); this.events.push(['cancel', 0, t]); }
  _num(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t) && t >= 0, `bad param value ${v} @ ${t}`); }
  get last() { return this.events[this.events.length - 1]; }
}
class Node {
  constructor(ctx) { this.ctx = ctx; this.connections = []; ctx.nodes.push(this); }
  connect(dst) { assert.ok(dst instanceof Node || dst instanceof Param, 'connect target'); this.connections.push(dst); return dst; }
  disconnect() { this.connections.length = 0; this.disconnected = (this.disconnected || 0) + 1; }
}
class Gain extends Node { constructor(ctx) { super(ctx); this.gain = new Param(1); } }
class Panner extends Node { constructor(ctx) { super(ctx); this.pan = new Param(0); } }
class Comp extends Node {
  constructor(ctx) { super(ctx); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) this[k] = new Param(0); }
}
class Biquad extends Node {
  constructor(ctx) { super(ctx); this.type = 'lowpass'; this.frequency = new Param(350); this.Q = new Param(1); }
}
class Source extends Node {
  constructor(ctx) { super(ctx); this.started = false; this.stopped = false; this.onended = null; ctx.sources.push(this); }
  start(t, offset) {
    assert.equal(this.started, false, 'start called twice');
    assert.ok(Number.isFinite(t) && t >= 0, 'start time');
    if (offset !== undefined) {
      const len = this.buffer ? this.buffer.duration : 1;
      assert.ok(offset >= 0 && offset < len, `buffer offset ${offset} in range`);
    }
    this.started = true; this.t0 = t;
  }
  stop(t) { assert.equal(this.started, true, 'stop before start'); this.stopped = true; this.t1 = t === undefined ? this.ctx.currentTime : t; }
  end() { if (this.onended) this.onended(); }
}
class Osc extends Source {
  constructor(ctx) { super(ctx); this.type = 'sine'; this.frequency = new Param(440); this.detune = new Param(0); }
}
class BufSrc extends Source { constructor(ctx) { super(ctx); this.buffer = null; this.loop = false; } }
class Buffer {
  constructor(ch, len, sr) {
    assert.ok(Number.isInteger(len) && len >= 1, 'buffer length');
    assert.ok(sr >= 3000 && sr <= 768000, 'buffer sample rate');
    this.length = len; this.sampleRate = sr; this.duration = len / sr; this.data = new Float32Array(len);
  }
  getChannelData() { return this.data; }
}
class MockContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.nodes = [];
    this.sources = [];
    this.destination = new Node(this);
    this.resumes = 0;
    this.suspends = 0;
    this.buffers = [];
    MockContext.last = this;
  }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve(); }
  suspend() { this.suspends++; this.state = 'suspended'; return Promise.resolve(); }
  createGain() { return new Gain(this); }
  createStereoPanner() { return new Panner(this); }
  createDynamicsCompressor() { return new Comp(this); }
  createBiquadFilter() { return new Biquad(this); }
  createOscillator() { return new Osc(this); }
  createBufferSource() { return new BufSrc(this); }
  createBuffer(ch, len, sr) { const b = new Buffer(ch, len, sr); this.buffers.push(b); return b; }
}
// A context the browser refuses to resume (unlock outside a gesture): stays 'suspended'.
class StuckContext extends MockContext {
  resume() { this.resumes++; return Promise.reject(new Error('NotAllowedError')); }
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
};
globalThis.AudioContext = MockContext;

function unlocked(opts) {
  const a = new Audio(opts);
  a.unlock();
  return a;
}
const oneShots = (ctx) => ctx.sources.filter((s) => !s.loop && !(s.buffer && s.buffer.length === 1));
function endAll(ctx) { for (const s of ctx.sources) if (s.started && !s.loop) s.end(); }

check('unlock(): lazy context, resume, master → compressor → destination, buses, silent buffer', () => {
  const a = new Audio();
  assert.equal(a.ctx, null, 'null before a gesture (B27)');
  const t0 = performance.now();
  a.unlock();
  const ms = performance.now() - t0;
  const ctx = a.ctx;
  assert.ok(ctx instanceof MockContext);
  assert.equal(ctx.state, 'running');
  assert.equal(a.ready, true);
  assert.equal(a.master.gain.value, 0.8);
  const comp = a.compressor;
  assert.ok(a.master.connections.includes(comp) && comp.connections.includes(ctx.destination));
  assert.deepEqual([comp.threshold.value, comp.knee.value, comp.ratio.value, comp.attack.value, comp.release.value], [-18, 12, 4, 0.003, 0.25]);
  assert.equal(a.buses.sfx.gain.value, 1.0);
  assert.equal(a.buses.crowd.gain.value, 0.7);
  assert.equal(a.buses.ui.gain.value, 0.6);
  for (const b of ['sfx', 'crowd', 'ui']) assert.ok(a.buses[b].connections.includes(a.master), `${b} bus → master`);
  const silent = ctx.sources.find((s) => s.buffer && s.buffer.length === 1);
  assert.ok(silent && silent.started, 'silent 1-sample buffer played');
  assert.ok(ms < 150, `graph + buffers built quickly (${ms.toFixed(1)} ms)`);
  a.unlock(); a.unlock();
  assert.equal(a.ctx, ctx, 'unlock is idempotent');
  assert.equal(ctx.sources.filter((s) => s.buffer && s.buffer.length === 1).length, 1, 'no silent buffer once running');
});

check('crowd beds: four persistent loops, 4.0 s pink beds, generated buffers ≤ 2 MB', () => {
  const a = unlocked();
  const ctx = a.ctx;
  const loops = ctx.sources.filter((s) => s.loop);
  assert.equal(loops.length, 4, 'murmur, excite, applause, chant');
  for (const l of loops) assert.ok(l.started, 'loop started');
  const beds = loops.filter((l) => near(l.buffer.duration, 4.0));
  assert.equal(beds.length, 2, 'two 4.0 s beds');
  assert.ok(loops.some((l) => near(l.buffer.duration, 2.0)), 'applause loop');
  assert.ok(loops.some((l) => near(l.buffer.duration, 1.0)), 'chant loop');
  for (const b of beds) {
    let nz = 0, peak = 0;
    for (const v of b.buffer.data) { if (v !== 0) nz++; peak = Math.max(peak, Math.abs(v)); }
    assert.ok(nz > b.buffer.length * 0.99 && peak <= 0.95 + 1e-6, 'bed filled and normalised');
    // Seamless wrap: the jump across the loop point is no larger than typical neighbour steps.
    const d = b.buffer.data, n = d.length;
    let mean = 0;
    for (let i = 1; i < n; i++) mean += Math.abs(d[i] - d[i - 1]);
    mean /= n - 1;
    assert.ok(Math.abs(d[0] - d[n - 1]) < 6 * mean, 'loop wrap is continuous');
  }
  const filters = ctx.nodes.filter((n) => n instanceof Biquad);
  assert.ok(filters.some((f) => f.type === 'lowpass' && f.frequency.value === 500), 'murmur lowpass 500 Hz');
  assert.ok(filters.some((f) => f.type === 'bandpass' && f.frequency.value === 900 && f.Q.value === 0.7), 'excite bandpass 900 Hz Q 0.7');
  let bytes = 0;
  for (const b of ctx.buffers) bytes += b.length * 4;
  assert.equal(a.bufferBytes, bytes, 'bufferBytes accounts for every generated buffer');
  assert.ok(bytes <= 2 * 1048576, `buffers ${bytes} B ≤ 2 MB`);
});

check('every SFX synthesizes on a running context, has stop times and frees its voice', () => {
  const a = unlocked();
  const ctx = a.ctx;
  for (const [name, args] of CALLS) {
    if (name === 'crowd' || name === 'groan') continue;
    const before = oneShots(ctx).length;
    a[name](...args);
    const made = oneShots(ctx).slice(before);
    assert.ok(made.length > 0, `${name}(${args.join(',')}) creates sources`);
    for (const s of made) assert.ok(s.started && s.stopped && s.t1 > s.t0, `${name}: every one-shot has a stop time`);
    ctx.currentTime += 2;
    endAll(ctx);
    assert.equal(a.voiceCount, 0, `${name}: voice released after its sources ended`);
  }
  // Released voices disconnect their per-sound nodes (no graph leak).
  const perSound = ctx.nodes.filter((n) => (n instanceof Biquad || n instanceof Osc) && n.disconnected);
  assert.ok(perSound.length > 20, 'per-sound nodes disconnected on release');
});

check('recipe spot checks (§8.2 numbers)', () => {
  const a = unlocked();
  const ctx = a.ctx;
  const newOsc = (fn) => { const n = ctx.sources.length; fn(); return ctx.sources.slice(n).filter((s) => s instanceof Osc); };
  let o = newOsc(() => a.horn());
  assert.deepEqual(o.filter((x) => x.type === 'sawtooth').map((x) => x.frequency.value).sort((p, q) => p - q), [233, 277, 349]);
  assert.ok(o.some((x) => x.type === 'sine' && x.frequency.value === 6), 'horn vibrato 6 Hz');
  assert.ok(near(o[0].t1 - o[0].t0, 1.21, 1e-9), 'horn 1.2 s');
  o = newOsc(() => a.shotHorn());
  assert.deepEqual(o.map((x) => x.type + x.frequency.value).sort(), ['sawtooth331', 'square330']);
  o = newOsc(() => a.rim(2, 'clank'));
  assert.deepEqual(o.map((x) => x.frequency.value).sort((p, q) => p - q), [540, 810, 1290]);
  o = newOsc(() => a.rim(1, 'grab'));
  assert.deepEqual(o.map((x) => x.frequency.value).sort((p, q) => p - q), [9, 55, 380, 1200]);
  o = newOsc(() => a.rim(1, 'rattle'));
  assert.ok(o.length >= 3 && o.length <= 6 && o.every((x) => x.frequency.value === 930), 'rattle: 3–6 taps of 930 Hz');
  const starts = o.map((x) => x.t0);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 0.04 - 1e-9 && starts[i] - starts[i - 1] <= 0.09 + 1e-9);
  o = newOsc(() => a.sting());
  assert.deepEqual(o.map((x) => x.frequency.value).sort((p, q) => p - q), [220, 277, 330, 440]);
  o = newOsc(() => a.select());
  assert.equal(o[0].frequency.value, 880);
  assert.deepEqual(o[0].frequency.last.slice(0, 2), ['exp', 1320]);
  o = newOsc(() => a.whistle());
  const am = o.find((x) => x.frequency.value !== 2100);
  assert.ok(am.frequency.value >= 32 && am.frequency.value <= 45, 'pea AM 32–45 Hz');
  o = newOsc(() => a.bounce(0.5));
  const thump = o.find((x) => x.frequency.value < 300);
  assert.ok(thump.frequency.value >= 180 * 0.94 - 1e-9 && thump.frequency.value <= 180 * 1.06 + 1e-9, 'bounce pitch jitter');
  assert.ok(o.some((x) => near(x.frequency.value / thump.frequency.value, 420 / 180, 1e-9)), 'hardwood ring 420 Hz');
});

check(`at most ${MAX_VOICES} simultaneous voices; the oldest is stopped`, () => {
  const a = unlocked();
  const ctx = a.ctx;
  const osc = () => ctx.sources.filter((s) => s instanceof Osc);
  for (let i = 0; i < 20; i++) { a.tick(); ctx.currentTime += 0.001; }
  assert.equal(a.voiceCount, 16);
  assert.equal(osc().length, 20);
  const evicted = osc().filter((s) => s.onended === null);
  assert.equal(evicted.length, 4, 'evicted voices lose their onended');
  for (const s of evicted) assert.ok(s.t1 < s.t0 + 0.04, 'evicted voices are stopped immediately, not at their scheduled end');
});

check('squeaks: ≤ 1 per player per 250 ms, probability 1 at i ≥ 0.6 else ≈ 0.35, ≤ 3 concurrent', () => {
  const a = unlocked();
  const ctx = a.ctx;
  assert.equal(a.squeak(1, 0, -5, 'kobe'), true);
  ctx.currentTime += 0.1;
  assert.equal(a.squeak(1, 0, -5, 'kobe'), false, 'rate limited');
  assert.equal(a.squeak(1, 0, -5, 'yao'), true, 'another player is independent');
  ctx.currentTime += 0.16;
  assert.equal(a.squeak(1, 0, -5, 'kobe'), true, '250 ms later');
  // Three squeaks alive: the next one steals the oldest squeak, never another SFX.
  a.bounce(0.6);
  assert.equal(a.squeak(1, 0, -5, 'lebron'), true);
  const live = a._voices.filter((v) => v.busy && v.kind === 1).length;
  assert.equal(live, MAX_SQUEAKS);
  assert.equal(a._voices.filter((v) => v.busy && v.kind === 0).length, 1, 'bounce untouched');
  // Probability for i < 0.6.
  let hits = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) { ctx.currentTime += 0.3; if (a.squeak(0.4, 0, -5, 'giannis')) hits++; endAll(ctx); }
  assert.ok(hits / N > 0.30 && hits / N < 0.40, `p(i < 0.6) ≈ 0.35 (${(hits / N).toFixed(3)})`);
  hits = 0;
  for (let i = 0; i < 200; i++) { ctx.currentTime += 0.3; if (a.squeak(0.6, 0, -5, 'giannis')) hits++; endAll(ctx); }
  assert.equal(hits, 200, 'p(i ≥ 0.6) = 1');
  assert.equal(a.squeak(0, 0, -5, 'kyrie'), false, 'i = 0 is silent');
});

check('squeak recipe: triangle 2,200 ± 400 Hz, +600 Hz at 70 ms, −300 Hz at 140 ms, FM 35 Hz ± 80 Hz, BP 2.6 kHz Q 3', () => {
  const a = unlocked();
  const ctx = a.ctx;
  ctx.currentTime = 10;
  const n = ctx.sources.length;
  a.squeak(1, 0, 0, 'jordan');
  const o = ctx.sources.slice(n).filter((s) => s instanceof Osc);
  const tri = o.find((x) => x.type === 'triangle');
  const f0 = tri.frequency.value;
  assert.ok(f0 >= 1800 && f0 <= 2600);
  const ev = tri.frequency.events;
  assert.ok(near(ev[1][1], f0 + 600) && near(ev[1][2], 10.07) && near(ev[2][1], f0 - 300) && near(ev[2][2], 10.14));
  const fmOsc = o.find((x) => x.type === 'sine');
  assert.equal(fmOsc.frequency.value, 35);
  const depth = fmOsc.connections[0];
  assert.equal(depth.gain.value, 80);
  assert.ok(depth.connections.includes(tri.frequency), 'FM depth drives the carrier frequency');
  const bp = tri.connections[0];
  assert.equal(bp.type, 'bandpass'); assert.equal(bp.frequency.value, 2600); assert.equal(bp.Q.value, 3);
});

check('spatial: pan = clamp(dx/8, ±0.7), distance gain = clamp(9/d, 0.35, 1); non-positional sounds centred', () => {
  const a = unlocked();
  a.bounce(0.5, 4, -10);                         // no listener yet → centred, full gain
  let v = a._voices.find((x) => x.busy);
  assert.equal(v.out.gain.value, 1); assert.equal(v.pan.pan.value, 0);
  a.stopAll();
  a.setListener(0, 6.5, 4.5);
  a.bounce(0.5, 4, -10);
  v = a._voices.find((x) => x.busy);
  const d = Math.hypot(4, 6.5, 14.5);
  assert.ok(near(v.pan.pan.value, 0.5) && near(v.out.gain.value, Math.max(0.35, 9 / d)), `pan ${v.pan.pan.value} gain ${v.out.gain.value}`);
  a.stopAll();
  a.bounce(0.5, -9, 4);                          // far left, close
  v = a._voices.find((x) => x.busy);
  assert.equal(v.pan.pan.value, -0.7);
  a.stopAll();
  a.update(0.016, { position: { x: 0, y: 3, z: -12 } });
  a.rim(2, 'clank');
  v = a._voices.find((x) => x.busy);
  assert.equal(v.out.gain.value, 1, 'listener next to the rim: gain clamps at 1');
  a.stopAll();
  a.whistle();
  v = a._voices.find((x) => x.busy);
  assert.equal(v.pan.pan.value, 0, 'whistle is not positional');
  a.stopAll();
  a.tick();
  v = a._voices.find((x) => x.busy);
  assert.ok(v.pan.connections.includes(a.buses.ui), 'UI sounds use the ui bus');
  a.stopAll();
  a.bounce(0.5);
  v = a._voices.find((x) => x.busy);
  assert.ok(v.pan.connections.includes(a.buses.sfx) && !v.pan.connections.includes(a.buses.ui), 'voice re-routed to the sfx bus');
});

check('replay variants: frequencies × 0.7, durations × 1.6', () => {
  const a = unlocked();
  const ctx = a.ctx;
  ctx.currentTime = 1;
  a.setSlow(true);
  assert.equal(a.slow, true);
  let n = ctx.sources.length;
  a.tick();
  let o = ctx.sources[n];
  assert.ok(near(o.frequency.value, 700));
  assert.ok(near(o.t1 - o.t0, 0.04 * 1.6 + 0.01));
  n = ctx.sources.length;
  a.horn();
  const saws = ctx.sources.slice(n).filter((s) => s.type === 'sawtooth').map((s) => s.frequency.value).sort((p, q) => p - q);
  assert.ok(near(saws[0], 233 * 0.7) && near(saws[2], 349 * 0.7));
  a.setSlow(false);
  n = ctx.sources.length;
  a.tick();
  o = ctx.sources[n];
  assert.equal(o.frequency.value, 1000);
});

check('suspended context (gesture refused): every call is safe and schedules nothing (B27)', () => {
  globalThis.AudioContext = StuckContext;
  const a = new Audio();
  a.unlock();
  assert.ok(a.ctx instanceof StuckContext);
  assert.equal(a.ctx.state, 'suspended');
  assert.equal(a.ready, false);
  const n = a.ctx.sources.length;
  callEverything(a);
  a.stopAll();
  assert.equal(a.ctx.sources.length, n, 'nothing scheduled while suspended');
  assert.equal(a.voiceCount, 0);
  a.unlock();
  assert.ok(a.ctx.resumes >= 2, 'each gesture retries resume()');
  globalThis.AudioContext = MockContext;
});

check('suspend/resume and mute: no-ops while suspended or muted; mute drives master gain and persists', () => {
  const a = unlocked();
  a.suspend();
  assert.equal(a.ctx.state, 'suspended');
  const n = a.ctx.sources.length;
  for (const [name, args] of CALLS) a[name](...args);
  assert.equal(a.ctx.sources.length, n, 'nothing scheduled while suspended');
  a.resume();
  assert.equal(a.ctx.state, 'running');
  a.setMuted(true);
  assert.equal(a.master.gain.value, 0);
  assert.equal(store.get('hoop.muted'), '1');
  const m = a.ctx.sources.length;
  for (const [name, args] of CALLS) a[name](...args);
  a.crowdAudio.react('dunk');
  assert.equal(a.ctx.sources.length, m, 'nothing scheduled while muted');
  a.setMuted(false);
  assert.equal(a.master.gain.value, 0.8);
  assert.equal(store.get('hoop.muted'), '0');
  store.set('hoop.muted', '1');
  assert.equal(new Audio().muted, true, 'mute state read back from localStorage');
  store.set('hoop.muted', '0');
});

check('crowd volume setting drives the crowd bus (0.4 / 0.7 / 1.0)', () => {
  const a = new Audio();
  a.setCrowdVolume('low');
  a.unlock();
  assert.equal(a.buses.crowd.gain.value, 0.4, 'value chosen before unlock is applied at unlock');
  a.setCrowdVolume('high');
  assert.equal(a.buses.crowd.gain.value, 1.0);
  a.setCrowdVolume(0.7);
  assert.equal(a.crowdVolume, 0.7);
  a.setCrowdVolume(NaN);
  assert.equal(a.crowdVolume, 0.7);
});

check('crowd: excite bed follows 0.20 · excite; vowels, applause, chant, anticipation', () => {
  const a = unlocked();
  const c = a.crowdAudio, ctx = a.ctx;
  const exciteGain = c._exciteGain.gain;
  assert.ok(near(exciteGain.value, 0.20 * 0.05), 'bed starts at the base level');
  c.excite(1.0, 0.5);
  a.update(0.016);
  assert.deepEqual(exciteGain.last.slice(0, 2), ['target', 0.2]);
  a.update(0.5);
  a.update(0.5);
  assert.ok(near(exciteGain.last[1], 0.20 * c.level, 1e-12) && c.level < 1, 'decaying after the hold');
  // Vowels: formants per kind.
  const vowelFilters = () => ctx.nodes.filter((nd) => nd instanceof Biquad && nd.type === 'bandpass' && (nd.Q.value === 5 || nd.Q.value === 4));
  let n0 = vowelFilters().length;
  assert.equal(c.burst('ooh', 0.8), true);
  let f = vowelFilters().slice(n0);
  assert.deepEqual(f.map((x) => x.frequency.events[0][1]).sort((p, q) => p - q), [300, 800]);
  assert.equal(f.find((x) => x.Q.value === 5).frequency.last[1], 350, 'ooh F1 glides to 350 Hz');
  n0 = vowelFilters().length;
  c.burst('aww', 0.6);
  f = vowelFilters().slice(n0);
  assert.deepEqual(f.map((x) => x.frequency.last[1]).sort((p, q) => p - q), [280, 700], 'aww glides 450 → 280, 900 → 700');
  assert.equal(c.burst('nope', 1), false);
  // Vowel envelope: attack 0.25 s, release 0.8 s.
  const outGain = c._vowels.find((v) => v.busy).out.gain;
  const t = ctx.currentTime;
  assert.ok(near(outGain.events[1][2] - t, 0.25) && near(outGain.events[3][2] - outGain.events[2][2], 0.8));
  // Cap of 6 vowel voices, oldest dropped.
  for (let i = 0; i < 10; i++) { ctx.currentTime += 0.01; c.burst('aah', 1); }
  assert.equal(c._vowels.filter((v) => v.busy).length, 6);
  // Applause envelope: rise now, fall before the end.
  const ap = c._applauseGain.gain;
  ctx.currentTime = 20;
  c.applause(2.5, 1);
  const ev = ap.events.slice(-3);
  assert.deepEqual(ev[0].slice(0, 1), ['cancel']);
  assert.ok(ev[1][0] === 'target' && ev[1][1] > 0 && near(ev[1][2], 20));
  assert.ok(ev[2][0] === 'target' && ev[2][1] === 0 && near(ev[2][2], 22));
  // Chant on/off.
  c.chant(true);
  assert.ok(c._chantGain.gain.last[1] > 0 && c.chanting);
  c.chant(false);
  assert.equal(c._chantGain.gain.last[1], 0);
  // Anticipation: F1 300 → 420, resolved by a cheer.
  c.stop();
  assert.equal(c.anticipate(), true);
  assert.equal(c.anticipate(), false, 'one anticipation at a time');
  const antic = c._antic;
  assert.deepEqual(antic.f1.frequency.events.slice(-2).map((e) => e[1]), [300, 420]);
  c.resolveAnticipation('cheer');
  assert.equal(c.anticipating, false);
  assert.ok(c._vowels.some((v) => v.busy && v !== antic), 'cheer burst scheduled');
  // An unresolved anticipation fades by itself after 4 s.
  c.stop();
  c.anticipate();
  for (let i = 0; i < 300; i++) a.update(1 / 60);
  assert.equal(c.anticipating, false);
});

check('crowd reactions follow the PR §8.3 table; v1 crowd()/groan()/dunk() map onto it', () => {
  const a = unlocked();
  const c = a.crowdAudio;
  c.stop();
  const busy = () => c._vowels.filter((v) => v.busy).length;
  c.react('dunk');
  assert.equal(c.level, 1.0);
  assert.equal(busy(), 2, 'ooh then aah');
  const delayed = c._vowels.filter((v) => v.busy).map((v) => v.start - a.ctx.currentTime).sort();
  assert.ok(near(delayed[1], 0.35), 'aah 0.35 s after the ooh');
  c.stop();
  c.react('make3');
  assert.equal(c.level, 0.85);
  assert.equal(c.hold, 2.0);
  c.stop();
  a.crowd(0.9, 2);
  assert.equal(c.level, 0.9);
  assert.equal(c.hold, 2);
  c.stop();
  a.groan();
  assert.equal(busy(), 1, 'groan = aww');
  c.stop();
  a.dunk();
  assert.equal(c.level, 1.0, 'v1 dunk() triggers the crowd dunk reaction');
  for (const k of Object.keys(CROWD_REACTIONS)) assert.equal(c.react(k), true, k);
});

check('update() reaps voices whose onended never fired; stopAll() kills everything', () => {
  const a = unlocked();
  const ctx = a.ctx;
  a.horn(); a.tick(); a.squeak(1, 0, 0, 1);
  assert.equal(a.voiceCount, 3);
  ctx.currentTime += 1.0;
  a.update(0.016);
  assert.equal(a.voiceCount, 1, 'tick and squeak reaped, horn still sounding');
  ctx.currentTime += 1.0;
  a.update(0.016);
  assert.equal(a.voiceCount, 0);
  a.horn(); a.boom();
  a.stopAll();
  assert.equal(a.voiceCount, 0);
});

check('fallbacks: no StereoPanner, no compressor, throwing AudioContext, missing/throwing localStorage', () => {
  class Bare extends MockContext {}
  Bare.prototype.createStereoPanner = undefined;
  Bare.prototype.createDynamicsCompressor = undefined;
  globalThis.AudioContext = Bare;
  const a = unlocked();
  assert.ok(a.master.connections.includes(a.ctx.destination), 'master straight to destination');
  for (const [name, args] of CALLS) a[name](...args);
  assert.ok(a.voiceCount > 0);
  a.stopAll();
  globalThis.AudioContext = class { constructor() { throw new Error('not allowed'); } };
  const b = new Audio();
  b.unlock();
  assert.equal(b.ctx, null);
  callEverything(b);
  globalThis.AudioContext = MockContext;
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const c = new Audio();
  assert.equal(c.muted, false);
  c.setMuted(true);
  assert.equal(c.muted, true);
  delete globalThis.localStorage;
  const d = new Audio();
  d.setMuted(true);
  assert.equal(d.muted, true);
});

if (typeof globalThis.gc === 'function') {
  check('update() allocates nothing (heap probe, --expose-gc)', () => {
    const a = unlocked();
    a.setListener(0, 6.5, 4.5);
    const cam = { position: { x: 1, y: 6, z: 4 } };
    a.crowdAudio.excite(1, 0.1);
    for (let i = 0; i < 2000; i++) a.update(1 / 60, cam);      // warm-up (JIT, param event arrays)
    a.crowdAudio.excite(1, 0);
    a.crowdAudio._exciteGain.gain.events.length = 0;
    a.crowdAudio._exciteGain.gain.setTargetAtTime = () => {};  // the mock's event log would allocate
    globalThis.gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100000; i++) a.update(1 / 60, cam);
    globalThis.gc();
    const grown = process.memoryUsage().heapUsed - h0;
    assert.ok(grown < 64 * 1024, `heap grew ${grown} B over 100k updates`);
  });
}

console.log(`\n${passed} audio checks passed`);
