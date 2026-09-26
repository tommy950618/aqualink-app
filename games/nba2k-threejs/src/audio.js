// Procedural sound effects (spec section 12). No audio files: every sound is synthesized on one
// AudioContext that is created lazily by unlock() inside a user gesture. Every public method is a
// safe no-op while the context does not exist, is not running, or the game is muted, so callers
// (game.js, hud.js, main.js) never have to check state themselves.
import { Rng } from './math.js';

const MASTER_GAIN = 0.8;
const MAX_VOICES = 8;
const STORAGE_KEY = 'hoop.muted';

const CROWD_BASE = 0.06;          // idle crowd murmur gain
const CROWD_SWELL = 0.25;         // extra gain at level 1
const CROWD_DECAY_S = 1.5;        // default swell decay time
const CROWD_LOOP_S = 2;           // looping noise buffer length
const CROWD_LP_HZ = 400;          // "pink-ish": white noise through this lowpass
const GROAN_LP_HZ = 200;          // lowpass drop on an air ball ...
const GROAN_S = 0.8;              // ... for this long

const NOISE_S = 1.0;              // shared white-noise buffer for the short bursts
const NOISE_HOP_S = 0.173;        // read-offset advance per burst so bursts are not identical
const SILENT = 0.0005;            // exponential ramps cannot reach 0; this is -66 dB
const NOISE_SEED = 0x5eed1e55;    // fixed seed: noise texture is cosmetic, not gameplay randomness

function noop() {}

function readStoredMuted() {
  try {
    const ls = globalThis.localStorage;
    return !!ls && ls.getItem(STORAGE_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function writeStoredMuted(b) {
  try {
    const ls = globalThis.localStorage;
    if (ls) ls.setItem(STORAGE_KEY, b ? '1' : '0');
  } catch (e) { /* private mode / blocked storage: mute is simply not persisted */ }
}

// Percussive envelope: instant attack to `peak`, optional hold, exponential decay to silence.
function decayEnv(param, t0, peak, hold, decay) {
  param.setValueAtTime(peak, t0);
  if (hold > 0) param.setValueAtTime(peak, t0 + hold);
  param.exponentialRampToValueAtTime(SILENT, t0 + hold + decay);
}

// Sustained envelope: linear attack, hold at `peak`, linear release to 0.
function holdEnv(param, t0, peak, attack, hold, release) {
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + attack);
  param.setValueAtTime(peak, t0 + attack + hold);
  param.linearRampToValueAtTime(0, t0 + attack + hold + release);
}

function fillNoise(buffer, rng) {
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rng.range(-1, 1);
}

export class Audio {
  constructor() {
    this.ctx = null;            // AudioContext, null until unlock() succeeds
    this.master = null;         // master GainNode (0.8, or 0 when muted), null until unlocked
    this._muted = readStoredMuted();
    this._voices = [];          // active SFX voices, oldest first
    this._noise = null;         // shared white-noise AudioBuffer for bursts
    this._noiseCursor = 0;      // read offset into the noise buffer (seconds)
    this._silent = null;        // 1-sample buffer played on every unlock
    this._crowdGain = null;
    this._crowdFilter = null;
    this._crowdLevel = 0;       // current swell level 0..1
    this._crowdDecay = CROWD_DECAY_S;
    this._crowdLast = -1;       // last gain written, to avoid redundant param writes per frame
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  // Safe to call on every gesture: creates the context once, then keeps nudging it to 'running'.
  unlock() {
    if (this.ctx === null) {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (typeof Ctor !== 'function') return;
      let ctx;
      try {
        ctx = new Ctor();
      } catch (e) {
        return;
      }
      this.ctx = ctx;
      try {
        this._buildGraph(ctx);
      } catch (e) {
        this.master = null;      // graph unusable: every SFX stays a no-op, ctx remains for tests
      }
    }
    const ctx = this.ctx;
    if (ctx.state === 'closed') return;
    if (ctx.state !== 'running') {
      try {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(noop);
      } catch (e) { /* resume outside a gesture is refused on some browsers */ }
    }
    // A 1-sample silent buffer counts as "playback started by a gesture" on iOS Safari.
    if (this._silent !== null) {
      try {
        const src = ctx.createBufferSource();
        src.buffer = this._silent;
        src.connect(ctx.destination);
        src.start(0);
      } catch (e) { /* ignore */ }
    }
  }

  _buildGraph(ctx) {
    const rng = new Rng(NOISE_SEED);
    const sr = ctx.sampleRate;

    this._silent = ctx.createBuffer(1, 1, sr);

    this._noise = ctx.createBuffer(1, Math.round(NOISE_S * sr), sr);
    fillNoise(this._noise, rng);

    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
    this.master = master;

    // Crowd bed: looping white noise -> lowpass 400 Hz -> gain 0.06, always running.
    const crowdBuf = ctx.createBuffer(1, Math.round(CROWD_LOOP_S * sr), sr);
    fillNoise(crowdBuf, rng);
    const crowdSrc = ctx.createBufferSource();
    crowdSrc.buffer = crowdBuf;
    crowdSrc.loop = true;
    const crowdFilter = ctx.createBiquadFilter();
    crowdFilter.type = 'lowpass';
    crowdFilter.frequency.value = CROWD_LP_HZ;
    crowdFilter.Q.value = 0.5;
    const crowdGain = ctx.createGain();
    crowdGain.gain.value = CROWD_BASE;
    crowdSrc.connect(crowdFilter);
    crowdFilter.connect(crowdGain);
    crowdGain.connect(master);
    crowdSrc.start(0);
    this._crowdFilter = crowdFilter;
    this._crowdGain = crowdGain;
    this._crowdLast = CROWD_BASE;
  }

  get ready() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get muted() {
    return this._muted;
  }

  setMuted(b) {
    this._muted = !!b;
    writeStoredMuted(this._muted);
    if (this.master !== null) this.master.gain.value = this._muted ? 0 : MASTER_GAIN;
  }

  toggleMuted() {
    this.setMuted(!this._muted);
    return this._muted;
  }

  suspend() {
    const ctx = this.ctx;
    if (ctx === null || ctx.state !== 'running') return;
    try {
      const p = ctx.suspend();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch (e) { /* ignore */ }
  }

  resume() {
    const ctx = this.ctx;
    if (ctx === null || ctx.state === 'running' || ctx.state === 'closed') return;
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch (e) { /* ignore */ }
  }

  // True when a sound scheduled now would actually be heard.
  _active() {
    return this.master !== null && !this._muted && this.ctx.state === 'running';
  }

  // ---- voice management -------------------------------------------------------------------------

  // A voice is one SFX: a private output gain plus the sources feeding it. At most MAX_VOICES
  // are alive; starting a new one beyond that stops the oldest.
  _voice() {
    if (this._voices.length >= MAX_VOICES) this._kill(this._voices[0]);
    const out = this.ctx.createGain();
    out.connect(this.master);
    const voice = { out, sources: [], last: null, end: 0 };
    this._voices.push(voice);
    return voice;
  }

  _start(voice, src, t0, t1, offset) {
    if (offset > 0) src.start(t0, offset);
    else src.start(t0);
    src.stop(t1);
    voice.sources.push(src);
    if (t1 > voice.end) {
      voice.end = t1;
      voice.last = src;
    }
  }

  // Register cleanup on the longest-living source; the voice frees itself when that one ends.
  _finish(voice) {
    if (voice.last !== null) voice.last.onended = () => this._release(voice);
  }

  _release(voice) {
    const i = this._voices.indexOf(voice);
    if (i >= 0) this._voices.splice(i, 1);
    try {
      voice.out.disconnect();
    } catch (e) { /* already gone */ }
  }

  _kill(voice) {
    for (let i = 0; i < voice.sources.length; i++) {
      const s = voice.sources[i];
      s.onended = null;
      try {
        s.stop();
      } catch (e) { /* not started yet or already stopped */ }
    }
    this._release(voice);
  }

  _osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  // Filtered white-noise burst decaying to silence over `dur`.
  _noiseBurst(voice, t0, dur, filterType, freq, q, peak) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    decayEnv(g.gain, t0, peak, 0, dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(voice.out);
    const offset = this._noiseCursor;
    this._noiseCursor = (this._noiseCursor + NOISE_HOP_S) % (NOISE_S - 0.3);
    this._start(voice, src, t0, t0 + dur + 0.02, offset);
  }

  // ---- SFX ------------------------------------------------------------------------------------------

  // Floor bounce: sine 180 -> 90 Hz over 90 ms, gain 0.25*strength, exp decay 0.12 s + 30 ms noise.
  bounce(strength) {
    if (!this._active()) return;
    const s = Math.min(Math.max(strength, 0), 1);
    if (s <= 0.01) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const v = this._voice();
    const o = this._osc('sine', 180);
    o.frequency.exponentialRampToValueAtTime(90, t0 + 0.09);
    const g = ctx.createGain();
    decayEnv(g.gain, t0, 0.25 * s, 0, 0.12);
    o.connect(g);
    g.connect(v.out);
    this._start(v, o, t0, t0 + 0.14, 0);
    this._noiseBurst(v, t0, 0.03, 'lowpass', 600, 0.7, 0.12 * s);
    this._finish(v);
  }

  // Rim clang: square 620 Hz and 930 Hz, each through a bandpass Q 8, gain 0.3*min(strength/4, 1).
  rim(strength) {
    if (!this._active()) return;
    const peak = 0.3 * Math.min(Math.max(strength, 0) / 4, 1);
    if (peak <= 0.002) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const v = this._voice();
    const g = ctx.createGain();
    decayEnv(g.gain, t0, peak, 0, 0.35);
    g.connect(v.out);
    const freqs = [620, 930];
    for (let i = 0; i < 2; i++) {
      const o = this._osc('square', freqs[i]);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freqs[i];
      bp.Q.value = 8;
      o.connect(bp);
      bp.connect(g);
      this._start(v, o, t0, t0 + 0.37, 0);
    }
    this._finish(v);
  }

  // Backboard thud: triangle 140 Hz gain 0.3 decay 0.2 s + 60 ms noise burst lowpassed at 800 Hz.
  board() {
    if (!this._active()) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const v = this._voice();
    const o = this._osc('triangle', 140);
    const g = ctx.createGain();
    decayEnv(g.gain, t0, 0.3, 0, 0.2);
    o.connect(g);
    g.connect(v.out);
    this._start(v, o, t0, t0 + 0.22, 0);
    this._noiseBurst(v, t0, 0.06, 'lowpass', 800, 0.7, 0.25);
    this._finish(v);
  }

  // Net swish: 250 ms white noise through a bandpass sweeping 2.5 kHz -> 800 Hz, gain 0.25.
  swish() {
    if (!this._active()) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const v = this._voice();
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(2500, t0);
    bp.frequency.exponentialRampToValueAtTime(800, t0 + 0.25);
    const g = ctx.createGain();
    holdEnv(g.gain, t0, 0.25, 0.02, 0.13, 0.10);
    src.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const offset = this._noiseCursor;
    this._noiseCursor = (this._noiseCursor + NOISE_HOP_S) % (NOISE_S - 0.3);
    this._start(v, src, t0, t0 + 0.27, offset);
    this._finish(v);
  }

  // Block: 80 ms noise burst highpassed at 1 kHz, gain 0.35, plus a 90 Hz sine thump.
  block() {
    if (!this._active()) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const v = this._voice();
    this._noiseBurst(v, t0, 0.08, 'highpass', 1000, 0.7, 0.35);
    const o = this._osc('sine', 90);
    const g = ctx.createGain();
    decayEnv(g.gain, t0, 0.3, 0, 0.15);
    o.connect(g);
    g.connect(v.out);
    this._start(v, o, t0, t0 + 0.17, 0);
    this._finish(v);
  }

  dunk() {
    this.board();
    this.rim(4);
    this.crowd(1.0, CROWD_DECAY_S);
  }

  // Referee whistle: sine 2.1 kHz with a 40 Hz tremolo, 350 ms, gain 0.25.
  whistle() {
    if (!this._active()) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const v = this._voice();
    const carrier = this._osc('sine', 2100);
    const trem = ctx.createGain();
    trem.gain.value = 0.5;                 // LFO swings this between 0 and 1
    const lfo = this._osc('sine', 40);
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth);
    depth.connect(trem.gain);
    const g = ctx.createGain();
    holdEnv(g.gain, t0, 0.25, 0.02, 0.28, 0.05);
    carrier.connect(trem);
    trem.connect(g);
    g.connect(v.out);
    this._start(v, lfo, t0, t0 + 0.36, 0);
    this._start(v, carrier, t0, t0 + 0.36, 0);
    this._finish(v);
  }

  // Buzzer: sawtooth 220 Hz + 225 Hz (detuned beat), lowpass 1.2 kHz, 900 ms, gain 0.35.
  buzzer() {
    if (!this._active()) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const v = this._voice();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.Q.value = 1;
    const g = ctx.createGain();
    holdEnv(g.gain, t0, 0.35, 0.01, 0.83, 0.06);
    lp.connect(g);
    g.connect(v.out);
    const a = this._osc('sawtooth', 220);
    const b = this._osc('sawtooth', 225);
    a.connect(lp);
    b.connect(lp);
    this._start(v, a, t0, t0 + 0.92, 0);
    this._start(v, b, t0, t0 + 0.92, 0);
    this._finish(v);
  }

  // Shot-clock tick: sine 1 kHz, 40 ms, gain 0.15.
  tick() {
    this._blip(1000, 0.04, 0.15);
  }

  // UI click: sine 600 Hz, 30 ms, gain 0.12.
  click() {
    this._blip(600, 0.03, 0.12);
  }

  _blip(freq, dur, peak) {
    if (!this._active()) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const v = this._voice();
    const o = this._osc('sine', freq);
    const g = ctx.createGain();
    const edge = dur * 0.15;                       // short linear edges avoid clicks
    holdEnv(g.gain, t0, peak, edge, dur - 2 * edge, edge);
    o.connect(g);
    g.connect(v.out);
    this._start(v, o, t0, t0 + dur + 0.01, 0);
    this._finish(v);
  }

  // Crowd swell: gain jumps to 0.06 + 0.25*level and decays back to 0.06 over `seconds`.
  crowd(level, seconds) {
    if (!this._active()) return;
    const l = Math.min(Math.max(level, 0), 1);
    if (l > this._crowdLevel) this._crowdLevel = l;
    this._crowdDecay = seconds > 0 ? seconds : CROWD_DECAY_S;
  }

  // Air-ball groan: the crowd lowpass drops from 400 Hz to 200 Hz for 0.8 s, then recovers.
  groan() {
    if (!this._active()) return;
    const f = this._crowdFilter.frequency, now = this.ctx.currentTime;
    f.cancelScheduledValues(now);
    f.setTargetAtTime(GROAN_LP_HZ, now, 0.04);
    f.setTargetAtTime(CROWD_LP_HZ, now + GROAN_S, 0.12);
  }

  // Per-frame crowd envelope. Zero allocations; only writes the gain param when it changes.
  update(dt) {
    if (!(dt > 0)) return;
    if (this._crowdLevel > 0) {
      this._crowdLevel = Math.max(0, this._crowdLevel - dt / this._crowdDecay);
    }
    if (this._crowdGain !== null) {
      const g = CROWD_BASE + CROWD_SWELL * this._crowdLevel;
      if (g !== this._crowdLast) {
        this._crowdGain.gain.value = g;
        this._crowdLast = g;
      }
    }
  }
}
