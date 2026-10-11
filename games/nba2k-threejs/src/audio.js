/**
 * @module audio
 * Procedural sound for LEGENDS 3v3 (spec v2 §6.7; recipes [ref PR:§8.2 Court sounds], v1 §12 where not
 * replaced). No audio files: every sound is synthesized on one AudioContext created lazily by `unlock()`
 * inside a user gesture (H5: iOS unlock on the first gesture). Every public method is a safe no-op while the
 * context does not exist, is not running, or the game is muted, so callers never check state themselves.
 *
 * Graph: ctx → buses (`sfx` 1.0, `crowd` 0.4 / 0.7 / 1.0, `ui` 0.6) → master Gain (0.8, 0 muted)
 *        → DynamicsCompressor (−18 dB, knee 12, ratio 4, attack 0.003 s, release 0.25 s) → destination.
 * Voices: 16 pooled slots (oldest stolen), each = Gain (distance gain) → StereoPanner → bus. Positional
 * sounds get `pan = clamp((x − listener.x)/8, −0.7, 0.7)` and `gain = clamp(9/|src − listener|, 0.35, 1)`
 * once `setListener` (or `update(dt, camera)`) has supplied the camera. Squeaks: ≤ 3 concurrent, ≤ 1 per
 * player per 250 ms. Replay variants (`setSlow(true)`): frequencies × 0.7, durations × 1.6.
 *
 * Public API (v1 kept): unlock, ready, ctx, muted, setMuted, toggleMuted, suspend, resume, update(dt[, camera]),
 *   bounce(s[, x, z]), rim(s[, kind]), board([kind]), swish(), block([x, z]), dunk(), whistle(), buzzer(),
 *   tick(), click(), crowd(level, seconds), groan().
 * v2: squeak(i, x, z[, who]), thud(w[, x, z]), net(kind), horn(), shotHorn(), select(), whoosh(), boom(),
 *   sting(), wipe(), setSlow(on), setListener(x, y, z), clearListener(), setCrowdVolume(v), stopAll(),
 *   crowdAudio (CrowdAudio: excite, burst, applause, chant, anticipate, resolveAnticipation, react, setBase),
 *   bufferBytes, voiceCount; helpers squeakIntensity(decel, turnRateDeg), thudWeight(massKg, dropH).
 *
 * Cosmetic randomness only (pitch jitter, squeak probability, noise texture) from private seeded Rng
 * instances (H8). `update()` allocates nothing (H10).
 */
import { Rng } from './math.js';
import { CrowdAudio } from './audio/crowd.js';

export { CrowdAudio, CROWD_REACTIONS, BASE_NORMAL, BASE_CLUTCH } from './audio/crowd.js';

const MASTER_GAIN = 0.8;
const COMP = { threshold: -18, knee: 12, ratio: 4, attack: 0.003, release: 0.25 };
const BUS_SFX = 1.0;
const BUS_UI = 0.6;
/** Crowd bus levels of the crowd-volume setting (low / **mid** / high). */
export const CROWD_VOLUMES = Object.freeze({ low: 0.4, mid: 0.7, high: 1.0 });
const STORAGE_KEY = 'hoop.muted';            // v1 key kept (§6.5.10)

export const MAX_VOICES = 16;
export const MAX_SQUEAKS = 3;
const SQUEAK_GAP_S = 0.25;                   // ≤ 1 squeak per player per 250 ms
const SQUEAK_KEYS = 12;                      // rate-limit table size (6 players + spare keys)
const PAN_DIV = 8;
const PAN_MAX = 0.7;
const DIST_REF = 9;
const DIST_MIN_GAIN = 0.35;
const SLOW_F = 0.7;
const SLOW_T = 1.6;
const SRC_CAP = 10;                          // sources tracked per voice
const NODE_CAP = 28;                         // nodes tracked per voice (disconnected on release)
const REAP_S = 0.5;                          // a voice past its end by this much is reaped by update()

// Fixed source positions (court constants v1: rim (0, 3.048, −12.75), board front z −13.105).
const RIM_X = 0, RIM_Y = 3.048, RIM_Z = -12.75;
const BOARD_Y = 3.4, BOARD_Z = -13.105;
const PLAYER_Y = 1.0;

const NOISE_S = 1.0;                         // shared white-noise buffer for the short bursts
const NOISE_HOP_S = 0.173;                   // read-offset advance per burst so bursts are not identical
const SILENT = 0.0005;                       // exponential ramps cannot reach 0; this is −66 dB
const DEFAULT_SEED = 0x1e6e2d5;

// Voice kinds (squeaks are capped separately).
const K_SFX = 0, K_SQUEAK = 1;

function noop() {}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

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

/** Squeak intensity from a PLANT_* event (§6.7): i = clamp((decel − 6)/10, 0, 1), or 1 when turning ≥ 360°/s. */
export function squeakIntensity(decel, turnRateDeg) {
  if (Number.isFinite(turnRateDeg) && Math.abs(turnRateDeg) >= 360) return 1;
  return clamp(((Number.isFinite(decel) ? decel : 0) - 6) / 10, 0, 1);
}

/**
 * Thud weight for a LAND event (§6.7: players ≥ 110 kg and every landing from ≥ 0.5 m). Returns 0 when
 * neither applies, else w ∈ [0.4, 1]: 0.4 at the threshold, growing with mass above 110 kg (+0.3 per
 * 20 kg) and with drop height above 0.5 m (+1.0 per metre).
 */
export function thudWeight(massKg, dropH) {
  const m = Number.isFinite(massKg) ? massKg : 0, h = Number.isFinite(dropH) ? dropH : 0;
  if (m < 110 && h < 0.5) return 0;
  return clamp(0.4 + Math.max(0, m - 110) * 0.015 + Math.max(0, h - 0.5), 0.4, 1);
}

// Percussive envelope: instant attack to `peak`, optional hold, exponential decay to silence.
function decayEnv(param, t0, peak, hold, decay) {
  param.setValueAtTime(peak, t0);
  if (hold > 0) param.setValueAtTime(peak, t0 + hold);
  param.exponentialRampToValueAtTime(SILENT, t0 + hold + decay);
}

// Short linear attack then exponential decay (clicks-free onsets for tonal sounds).
function attackDecayEnv(param, t0, peak, attack, decay) {
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + attack);
  param.exponentialRampToValueAtTime(SILENT, t0 + attack + decay);
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

// One pooled voice slot. `out` carries the distance gain, `pan` the stereo position; per-sound nodes feed
// `out` and are tracked so a release can disconnect them.
class Voice {
  constructor(owner, index) {
    this.index = index;
    this.busy = false;
    this.kind = K_SFX;
    this.start = 0;
    this.end = 0;
    this.bus = null;
    this.out = null;
    this.pan = null;
    this.last = null;
    this.sources = new Array(SRC_CAP).fill(null);
    this.nSrc = 0;
    this.nodes = new Array(NODE_CAP).fill(null);
    this.nNodes = 0;
    this.onEnded = () => owner._release(this);
  }
}

export class Audio {
  /** @param opts { seed } — cosmetic seed (noise texture, pitch jitter, squeak probability, crowd). */
  constructor(opts) {
    const seed = opts && Number.isFinite(opts.seed) ? opts.seed | 0 : DEFAULT_SEED;
    this.ctx = null;            // AudioContext, null until unlock() succeeds (B27)
    this.master = null;         // master GainNode (0.8, or 0 when muted), null until unlocked
    this.compressor = null;
    this.buses = { sfx: null, crowd: null, ui: null };
    this._muted = readStoredMuted();
    this._crowdVolume = CROWD_VOLUMES.mid;
    this._rng = new Rng((seed ^ 0x5eed1e55) | 0);
    this._noise = null;         // shared white-noise AudioBuffer for bursts
    this._noiseCursor = 0;      // read offset into the noise buffer (seconds)
    this._silent = null;        // 1-sample buffer played inside gestures until the context runs
    this._voices = [];
    this._fm = 1;               // replay variant multipliers (frequency, duration)
    this._tm = 1;
    this._hasListener = false;
    this._lx = 0; this._ly = 0; this._lz = 0;
    this._squeakWho = new Array(SQUEAK_KEYS).fill(null);
    this._squeakT = new Float64Array(SQUEAK_KEYS).fill(-1e9);
    this._squeakNext = 0;
    this._hasPanner = false;
    this.bufferBytes = 0;       // bytes of every AudioBuffer generated at unlock (budget ≤ 2 MB)
    this.crowdAudio = new CrowdAudio({ seed });
    this.crowdAudio.muted = this._muted;
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  /** Safe to call on every gesture: creates the context once, then keeps nudging it to 'running'. */
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
    if (ctx.state === 'running' || ctx.state === 'closed') return;
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch (e) { /* resume outside a gesture is refused on some browsers */ }
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
    const sr = ctx.sampleRate;
    this._silent = ctx.createBuffer(1, 1, sr);
    this._noise = ctx.createBuffer(1, Math.round(NOISE_S * sr), sr);
    fillNoise(this._noise, this._rng);

    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : MASTER_GAIN;
    let comp = null;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = COMP.threshold;
      comp.knee.value = COMP.knee;
      comp.ratio.value = COMP.ratio;
      comp.attack.value = COMP.attack;
      comp.release.value = COMP.release;
      master.connect(comp);
      comp.connect(ctx.destination);
    } else {
      master.connect(ctx.destination);
    }
    this.master = master;
    this.compressor = comp;

    const sfx = ctx.createGain(); sfx.gain.value = BUS_SFX; sfx.connect(master);
    const crowd = ctx.createGain(); crowd.gain.value = this._crowdVolume; crowd.connect(master);
    const ui = ctx.createGain(); ui.gain.value = BUS_UI; ui.connect(master);
    this.buses.sfx = sfx; this.buses.crowd = crowd; this.buses.ui = ui;

    this._hasPanner = typeof ctx.createStereoPanner === 'function';
    for (let i = 0; i < MAX_VOICES; i++) {
      const v = new Voice(this, i);
      v.out = ctx.createGain();
      if (this._hasPanner) {
        v.pan = ctx.createStereoPanner();
        v.out.connect(v.pan);
      }
      this._voices.push(v);
    }

    let bytes = 4 * (1 + this._noise.length);
    try {
      bytes += this.crowdAudio.attach(ctx, crowd);
    } catch (e) { /* crowd unavailable: SFX still work */ }
    this.bufferBytes = bytes;
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
    this.crowdAudio.setMuted(this._muted);
  }

  toggleMuted() {
    this.setMuted(!this._muted);
    return this._muted;
  }

  /** Crowd bus level: a number 0..1 or a CROWD_VOLUMES key ('low' 0.4, 'mid' 0.7, 'high' 1.0). */
  setCrowdVolume(v) {
    const val = typeof v === 'string' ? CROWD_VOLUMES[v] : v;
    if (!Number.isFinite(val)) return;
    this._crowdVolume = clamp(val, 0, 1);
    if (this.buses.crowd !== null) this.buses.crowd.gain.value = this._crowdVolume;
  }

  get crowdVolume() {
    return this._crowdVolume;
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

  /** Replay variants: frequencies × 0.7 and durations × 1.6 while on. */
  setSlow(on) {
    this._fm = on ? SLOW_F : 1;
    this._tm = on ? SLOW_T : 1;
  }

  get slow() {
    return this._fm !== 1;
  }

  /** Listener (camera) position for pan and distance gain. */
  setListener(x, y, z) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    this._hasListener = true;
    this._lx = x; this._ly = y; this._lz = z;
  }

  clearListener() {
    this._hasListener = false;
  }

  /** Number of busy SFX voices (tests, debug). */
  get voiceCount() {
    let n = 0;
    for (let i = 0; i < this._voices.length; i++) if (this._voices[i].busy) n++;
    return n;
  }

  // True when a sound scheduled now would actually be heard.
  _active() {
    return this.master !== null && !this._muted && this.ctx.state === 'running';
  }

  // ---- voice management -------------------------------------------------------------------------

  // Take a voice slot on `bus`, placed at (x, y, z) if given. Steals the oldest voice when all 16 are busy
  // (or the oldest squeak when 3 squeaks already sound).
  _begin(bus, kind, x, y, z) {
    const vs = this._voices;
    let free = null, oldest = null, oldestSq = null, squeaks = 0;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (!v.busy) { if (free === null) free = v; continue; }
      if (oldest === null || v.start < oldest.start) oldest = v;
      if (v.kind === K_SQUEAK) { squeaks++; if (oldestSq === null || v.start < oldestSq.start) oldestSq = v; }
    }
    let v = free;
    if (kind === K_SQUEAK && squeaks >= MAX_SQUEAKS) { this._kill(oldestSq); v = oldestSq; } else if (v === null) { this._kill(oldest); v = oldest; }
    v.busy = true;
    v.kind = kind;
    v.start = this.ctx.currentTime;
    v.end = v.start;
    v.last = null;
    const head = v.pan !== null ? v.pan : v.out;
    if (v.bus !== bus) {
      if (v.bus !== null) { try { head.disconnect(); } catch (e) { /* not connected */ } }
      head.connect(bus);
      v.bus = bus;
    }
    let g = 1, p = 0;
    if (this._hasListener && Number.isFinite(x) && Number.isFinite(z)) {
      const dx = x - this._lx, dy = (Number.isFinite(y) ? y : PLAYER_Y) - this._ly, dz = z - this._lz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      g = d > 1e-6 ? clamp(DIST_REF / d, DIST_MIN_GAIN, 1) : 1;
      p = clamp(dx / PAN_DIV, -PAN_MAX, PAN_MAX);
    }
    v.out.gain.value = g;
    if (v.pan !== null) v.pan.pan.value = p;
    return v;
  }

  _track(v, node) {
    if (v.nNodes < NODE_CAP) v.nodes[v.nNodes++] = node;
    return node;
  }

  _start(v, src, t0, t1, offset) {
    if (offset > 0) src.start(t0, offset);
    else src.start(t0);
    src.stop(t1);
    if (v.nSrc < SRC_CAP) v.sources[v.nSrc++] = src;
    if (t1 >= v.end) {
      v.end = t1;
      v.last = src;
    }
  }

  // The voice frees itself when its longest-living source ends (or update() reaps it).
  _finish(v) {
    if (v.last !== null) v.last.onended = v.onEnded;
    else this._release(v);
  }

  _release(v) {
    if (!v.busy) return;
    v.busy = false;
    for (let i = 0; i < v.nSrc; i++) { v.sources[i].onended = null; v.sources[i] = null; }
    v.nSrc = 0;
    for (let i = 0; i < v.nNodes; i++) {
      try { v.nodes[i].disconnect(); } catch (e) { /* already gone */ }
      v.nodes[i] = null;
    }
    v.nNodes = 0;
    v.last = null;
  }

  _kill(v) {
    if (!v.busy) return;
    for (let i = 0; i < v.nSrc; i++) {
      const s = v.sources[i];
      s.onended = null;
      try {
        s.stop();
      } catch (e) { /* not started yet or already stopped */ }
    }
    this._release(v);
  }

  _gain(v, dest) {
    const g = this._track(v, this.ctx.createGain());
    g.connect(dest);
    return g;
  }

  _filter(v, type, freq, q, dest) {
    const f = this._track(v, this.ctx.createBiquadFilter());
    f.type = type;
    f.frequency.value = freq * this._fm;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  _osc(v, type, freq) {
    const o = this._track(v, this.ctx.createOscillator());
    o.type = type;
    o.frequency.value = freq * this._fm;
    return o;
  }

  // White-noise source reading the shared buffer from a hopping offset.
  _noiseSrc(v, dest) {
    const src = this._track(v, this.ctx.createBufferSource());
    src.buffer = this._noise;
    src.connect(dest);
    return src;
  }

  _noiseOffset() {
    const o = this._noiseCursor;
    this._noiseCursor = (this._noiseCursor + NOISE_HOP_S) % (NOISE_S - 0.3);
    return o;
  }

  // Filtered white-noise burst decaying to silence over `dur` (already time-scaled by the caller).
  _noiseBurst(v, t0, dur, filterType, freq, q, peak) {
    const g = this._gain(v, v.out);
    decayEnv(g.gain, t0, peak, 0, dur);
    const f = this._filter(v, filterType, freq, q, g);
    const src = this._noiseSrc(v, f);
    this._start(v, src, t0, t0 + dur + 0.02, this._noiseOffset());
  }

  // Short sine blip on the ui bus (v1 tick / click recipe), optional exponential glide to `freqTo`.
  _blip(freq, freqTo, dur, peak) {
    if (!this._active()) return;
    const tm = this._tm, t0 = this.ctx.currentTime, d = dur * tm;
    const v = this._begin(this.buses.ui, K_SFX);
    const g = this._gain(v, v.out);
    const edge = d * 0.15;                       // short linear edges avoid clicks
    holdEnv(g.gain, t0, peak, edge, d - 2 * edge, edge);
    const o = this._osc(v, 'sine', freq);
    if (freqTo > 0) o.frequency.exponentialRampToValueAtTime(freqTo * this._fm, t0 + d);
    o.connect(g);
    this._start(v, o, t0, t0 + d + 0.01, 0);
    this._finish(v);
  }

  // ---- court SFX ----------------------------------------------------------------------------------

  /** Floor bounce (v1 recipe + pitch × 0.94–1.06 + "hardwood ring" sine 420 Hz 60 ms gain 0.04 at s ≥ 0.5). */
  bounce(strength, x, z) {
    if (!this._active()) return;
    const s = clamp(Number.isFinite(strength) ? strength : 0, 0, 1);
    if (s <= 0.01) return;
    const tm = this._tm, t0 = this.ctx.currentTime;
    const v = this._begin(this.buses.sfx, K_SFX, x, 0, z);
    const pitch = this._rng.range(0.94, 1.06);
    const o = this._osc(v, 'sine', 180 * pitch);
    o.frequency.exponentialRampToValueAtTime(90 * pitch * this._fm, t0 + 0.09 * tm);
    const g = this._gain(v, v.out);
    decayEnv(g.gain, t0, 0.25 * s, 0, 0.12 * tm);
    o.connect(g);
    this._start(v, o, t0, t0 + 0.14 * tm, 0);
    this._noiseBurst(v, t0, 0.03 * tm, 'lowpass', 600, 0.7, 0.12 * s);
    // The ring is at full 0.04 for a dribble (strength 0.5, ANIM §4.8) and fades with softer bounces.
    const ring = this._osc(v, 'sine', 420 * pitch);
    const rg = this._gain(v, v.out);
    decayEnv(rg.gain, t0, 0.04 * Math.min(1, s / 0.5), 0, 0.06 * tm);
    ring.connect(rg);
    this._start(v, ring, t0, t0 + 0.07 * tm, 0);
    this._finish(v);
  }

  /**
   * Rim contact. `kind` ∈ 'tap' | 'clank' | 'rattle' | 'grab'; omitted → tap when s < 1.2 else clank
   * (v1 callers pass only a strength).
   */
  rim(strength, kind) {
    if (!this._active()) return;
    const s = clamp(Number.isFinite(strength) ? strength : 0, 0, 8);
    const explicit = kind === 'tap' || kind === 'clank' || kind === 'rattle' || kind === 'grab';
    if (!explicit && s <= 0.01) return;      // v1 callers: a grazing contact makes no sound
    const k = explicit ? kind : (s < 1.2 ? 'tap' : 'clank');
    const v = this._begin(this.buses.sfx, K_SFX, RIM_X, RIM_Y, RIM_Z);
    const t0 = this.ctx.currentTime, tm = this._tm;
    if (k === 'tap') {
      this._rimTap(v, t0, 0.12);
    } else if (k === 'clank') {
      // Front-rim clank: partials 540 / 810 / 1,290 Hz, square → bandpass Q 8, decay 0.5 s, gain 0.32·s/4.
      const g = this._gain(v, v.out);
      decayEnv(g.gain, t0, 0.32 * Math.min(s / 4, 1), 0, 0.5 * tm);
      for (let i = 0; i < 3; i++) {
        const f = i === 0 ? 540 : i === 1 ? 810 : 1290;
        const bp = this._filter(v, 'bandpass', f, 8, g);
        const o = this._osc(v, 'square', f);
        o.connect(bp);
        this._start(v, o, t0, t0 + 0.52 * tm, 0);
      }
    } else if (k === 'rattle') {
      // 3–6 taps 40–90 ms apart, each × 0.7 of the previous one.
      const n = 3 + Math.floor(this._rng.next() * 4);
      let t = t0, peak = 0.12;
      for (let i = 0; i < n; i++) {
        this._rimTap(v, t, peak);
        t += this._rng.range(0.04, 0.09) * tm;
        peak *= 0.7;
      }
    } else {
      // Dunk grab: 380 + 1,200 Hz clang with a 9 Hz AM wobble for 0.4 s, stanchion rumble 55 Hz 0.6 s gain 0.20.
      const d = 0.4 * tm;
      const g = this._gain(v, v.out);
      decayEnv(g.gain, t0, 0.30, 0, d);
      const am = this._gain(v, g);           // AM stage: 0.6 ± 0.4 → never fully silent
      am.gain.value = 0.6;
      const lfo = this._osc(v, 'sine', 9);
      const depth = this._gain(v, am.gain);
      depth.gain.value = 0.4;
      lfo.connect(depth);
      this._start(v, lfo, t0, t0 + d + 0.02, 0);
      for (let i = 0; i < 2; i++) {
        const f = i === 0 ? 380 : 1200;
        const bp = this._filter(v, 'bandpass', f, 6, am);
        const o = this._osc(v, 'square', f);
        o.connect(bp);
        this._start(v, o, t0, t0 + d + 0.02, 0);
      }
      const rg = this._gain(v, v.out);
      attackDecayEnv(rg.gain, t0, 0.20, 0.01, 0.6 * tm);
      const rumble = this._osc(v, 'sine', 55);
      rumble.connect(rg);
      this._start(v, rumble, t0, t0 + 0.62 * tm, 0);
    }
    this._finish(v);
  }

  // Light rim tap: 930 Hz square through a bandpass Q 8, 90 ms.
  _rimTap(v, t0, peak) {
    const g = this._gain(v, v.out);
    decayEnv(g.gain, t0, peak, 0, 0.09 * this._tm);
    const bp = this._filter(v, 'bandpass', 930, 8, g);
    const o = this._osc(v, 'square', 930);
    o.connect(bp);
    this._start(v, o, t0, t0 + 0.1 * this._tm, 0);
  }

  /** Backboard: 'bank' (glass: triangle 180 Hz 150 ms + 1.1 kHz click) or 'thud' (v1, default). */
  board(kind) {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm;
    const v = this._begin(this.buses.sfx, K_SFX, RIM_X, BOARD_Y, BOARD_Z);
    if (kind === 'bank') {
      const o = this._osc(v, 'triangle', 180);
      const g = this._gain(v, v.out);
      decayEnv(g.gain, t0, 0.25, 0, 0.15 * tm);
      o.connect(g);
      this._start(v, o, t0, t0 + 0.17 * tm, 0);
      const c = this._osc(v, 'sine', 1100);
      const cg = this._gain(v, v.out);
      decayEnv(cg.gain, t0, 0.12, 0, 0.02 * tm);
      c.connect(cg);
      this._start(v, c, t0, t0 + 0.03 * tm, 0);
    } else {
      const o = this._osc(v, 'triangle', 140);
      const g = this._gain(v, v.out);
      decayEnv(g.gain, t0, 0.3, 0, 0.2 * tm);
      o.connect(g);
      this._start(v, o, t0, t0 + 0.22 * tm, 0);
      this._noiseBurst(v, t0, 0.06 * tm, 'lowpass', 800, 0.7, 0.25);
    }
    this._finish(v);
  }

  /** Net on a make: 'swish' (clean, v1), 'rimIn' (rim contact ≤ 0.3 s before), 'snap' (dunk). */
  net(kind) {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm, fm = this._fm;
    const v = this._begin(this.buses.sfx, K_SFX, RIM_X, RIM_Y - 0.25, RIM_Z);
    if (kind === 'snap') {
      this._noiseBurst(v, t0, 0.12 * tm, 'highpass', 1500, 0.7, 0.28);
    } else {
      const rimIn = kind === 'rimIn';
      const dur = (rimIn ? 0.16 : 0.25) * tm;
      const peak = rimIn ? 0.18 : 0.25;
      const g = this._gain(v, v.out);
      if (rimIn) holdEnv(g.gain, t0, peak, 0.015 * tm, 0.07 * tm, 0.075 * tm);
      else holdEnv(g.gain, t0, peak, 0.02 * tm, 0.13 * tm, 0.10 * tm);
      const bp = this._filter(v, 'bandpass', rimIn ? 1800 : 2500, 1.5, g);
      bp.frequency.setValueAtTime((rimIn ? 1800 : 2500) * fm, t0);
      bp.frequency.exponentialRampToValueAtTime((rimIn ? 900 : 800) * fm, t0 + dur);
      const src = this._noiseSrc(v, bp);
      this._start(v, src, t0, t0 + dur + 0.02, this._noiseOffset());
    }
    this._finish(v);
  }

  /** v1 alias: clean swish. */
  swish() {
    this.net('swish');
  }

  /** Block: 80 ms noise burst highpassed at 1 kHz, gain 0.35, plus a 90 Hz sine thump (v1). */
  block(x, z) {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm;
    const v = this._begin(this.buses.sfx, K_SFX, x, 2.6, z);
    this._noiseBurst(v, t0, 0.08 * tm, 'highpass', 1000, 0.7, 0.35);
    const o = this._osc(v, 'sine', 90);
    const g = this._gain(v, v.out);
    decayEnv(g.gain, t0, 0.3, 0, 0.15 * tm);
    o.connect(g);
    this._start(v, o, t0, t0 + 0.17 * tm, 0);
    this._finish(v);
  }

  /** v1 composite kept for old callers: rim grab + net snap + the crowd's dunk reaction. */
  dunk() {
    this.rim(1, 'grab');
    this.net('snap');
    this.crowdAudio.react('dunk');
  }

  /**
   * Shoe squeak (§6.7): intensity i (see squeakIntensity), position (x, z), `who` = player key for the
   * 250 ms rate limit. Plays with probability 1 when i ≥ 0.6, else 0.35. Returns true when it sounded.
   */
  squeak(i, x, z, who) {
    if (!this._active()) return false;
    const s = clamp(Number.isFinite(i) ? i : 0, 0, 1);
    if (s <= 0) return false;
    const now = this.ctx.currentTime;
    const key = who === undefined ? null : who;
    let slot = -1;
    for (let k = 0; k < SQUEAK_KEYS; k++) if (this._squeakWho[k] === key) { slot = k; break; }
    if (slot >= 0 && now - this._squeakT[slot] < SQUEAK_GAP_S) return false;
    if (s < 0.6 && this._rng.next() >= 0.35) return false;
    if (slot < 0) {
      slot = this._squeakNext;
      this._squeakNext = (this._squeakNext + 1) % SQUEAK_KEYS;
      this._squeakWho[slot] = key;
    }
    this._squeakT[slot] = now;

    const tm = this._tm, fm = this._fm, t0 = now;
    const v = this._begin(this.buses.sfx, K_SQUEAK, x, 0, z);
    // Triangle around 2,200 ± 400 Hz: +600 Hz over 70 ms, then down to f0 − 300 Hz at 140 ms, with a
    // 35 Hz FM wobble of ± 80 Hz added to the frequency param.
    const f0 = 2200 + this._rng.range(-400, 400);
    const g = this._gain(v, v.out);
    attackDecayEnv(g.gain, t0, 0.10 * s, 0.005 * tm, 0.135 * tm);
    const bp = this._filter(v, 'bandpass', 2600, 3, g);
    const o = this._osc(v, 'triangle', f0);
    o.frequency.setValueAtTime(f0 * fm, t0);
    o.frequency.linearRampToValueAtTime((f0 + 600) * fm, t0 + 0.07 * tm);
    o.frequency.linearRampToValueAtTime((f0 - 300) * fm, t0 + 0.14 * tm);
    const fmOsc = this._osc(v, 'sine', 35);
    const fmDepth = this._gain(v, o.frequency);
    fmDepth.gain.value = 80 * fm;
    fmOsc.connect(fmDepth);
    o.connect(bp);
    this._start(v, fmOsc, t0, t0 + 0.15 * tm, 0);
    this._start(v, o, t0, t0 + 0.15 * tm, 0);
    this._noiseBurst(v, t0, 0.015 * tm, 'highpass', 3000, 0.7, 0.05 * s);
    this._finish(v);
    return true;
  }

  /** Landing thud: sine 70 → 45 Hz over 120 ms gain 0.18·w + noise LP 300 Hz 60 ms gain 0.06. */
  thud(w, x, z) {
    if (!this._active()) return;
    const s = clamp(Number.isFinite(w) ? w : 0, 0, 1);
    if (s <= 0) return;
    const tm = this._tm, t0 = this.ctx.currentTime;
    const v = this._begin(this.buses.sfx, K_SFX, x, 0, z);
    const o = this._osc(v, 'sine', 70);
    o.frequency.exponentialRampToValueAtTime(45 * this._fm, t0 + 0.12 * tm);
    const g = this._gain(v, v.out);
    attackDecayEnv(g.gain, t0, 0.18 * s, 0.004 * tm, 0.14 * tm);
    o.connect(g);
    this._start(v, o, t0, t0 + 0.16 * tm, 0);
    this._noiseBurst(v, t0, 0.06 * tm, 'lowpass', 300, 0.7, 0.06);
    this._finish(v);
  }

  // ---- officials / clock -----------------------------------------------------------------------

  /** Referee whistle: sine 2.1 kHz, "pea" AM at a random 32–45 Hz, 350 ms, gain 0.25. */
  whistle() {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm;
    const v = this._begin(this.buses.sfx, K_SFX);
    const g = this._gain(v, v.out);
    holdEnv(g.gain, t0, 0.25, 0.02 * tm, 0.28 * tm, 0.05 * tm);
    const trem = this._gain(v, g);
    trem.gain.value = 0.5;                 // the LFO swings this between 0 and 1
    const lfo = this._osc(v, 'sine', this._rng.range(32, 45));
    const depth = this._gain(v, trem.gain);
    depth.gain.value = 0.5;
    lfo.connect(depth);
    const carrier = this._osc(v, 'sine', 2100);
    carrier.connect(trem);
    this._start(v, lfo, t0, t0 + 0.36 * tm, 0);
    this._start(v, carrier, t0, t0 + 0.36 * tm, 0);
    this._finish(v);
  }

  /** Period-end horn: sawtooths 233 / 277 / 349 Hz, lowpass 1.6 kHz, 6 Hz vibrato ± 3 Hz, 1.2 s, gain 0.35. */
  horn() {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm, d = 1.2 * tm;
    const v = this._begin(this.buses.sfx, K_SFX);
    const g = this._gain(v, v.out);
    holdEnv(g.gain, t0, 0.35, 0.02 * tm, d - 0.1 * tm, 0.08 * tm);
    const lp = this._filter(v, 'lowpass', 1600, 0.8, g);
    const lfo = this._osc(v, 'sine', 6);
    const depth = this._track(v, this.ctx.createGain());
    depth.gain.value = 3 * this._fm;
    lfo.connect(depth);
    this._start(v, lfo, t0, t0 + d + 0.01, 0);
    for (let i = 0; i < 3; i++) {
      const o = this._osc(v, 'sawtooth', i === 0 ? 233 : i === 1 ? 277 : 349);
      depth.connect(o.frequency);
      o.connect(lp);
      this._start(v, o, t0, t0 + d + 0.01, 0);
    }
    this._finish(v);
  }

  /** v1 name for the period buzzer. */
  buzzer() {
    this.horn();
  }

  /** Shot-clock horn: square 330 Hz + saw 331 Hz, lowpass 1.4 kHz, 0.6 s, gain 0.30. */
  shotHorn() {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm, d = 0.6 * tm;
    const v = this._begin(this.buses.sfx, K_SFX);
    const g = this._gain(v, v.out);
    holdEnv(g.gain, t0, 0.30, 0.01 * tm, d - 0.06 * tm, 0.05 * tm);
    const lp = this._filter(v, 'lowpass', 1400, 0.8, g);
    const a = this._osc(v, 'square', 330);
    const b = this._osc(v, 'sawtooth', 331);
    a.connect(lp);
    b.connect(lp);
    this._start(v, a, t0, t0 + d + 0.01, 0);
    this._start(v, b, t0, t0 + d + 0.01, 0);
    this._finish(v);
  }

  // ---- UI ---------------------------------------------------------------------------------------

  /** Tick (menus, game clock < 5 s): sine 1 kHz, 40 ms, gain 0.15. */
  tick() {
    this._blip(1000, 0, 0.04, 0.15);
  }

  /** v1 UI click: sine 600 Hz, 30 ms, gain 0.12. */
  click() {
    this._blip(600, 0, 0.03, 0.12);
  }

  /** Select (lineup swap): sine 880 → 1,320 Hz, 60 ms, gain 0.10. */
  select() {
    this._blip(880, 1320, 0.06, 0.10);
  }

  /** Whoosh (intro announcement): noise through a bandpass sweeping 400 → 2,400 Hz, 0.20 s, gain 0.12. */
  whoosh() {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm, d = 0.2 * tm;
    const v = this._begin(this.buses.ui, K_SFX);
    const g = this._gain(v, v.out);
    holdEnv(g.gain, t0, 0.12, 0.06 * tm, 0.06 * tm, 0.08 * tm);
    const bp = this._filter(v, 'bandpass', 400, 1.2, g);
    bp.frequency.setValueAtTime(400 * this._fm, t0);
    bp.frequency.exponentialRampToValueAtTime(2400 * this._fm, t0 + d);
    const src = this._noiseSrc(v, bp);
    this._start(v, src, t0, t0 + d + 0.02, this._noiseOffset());
    this._finish(v);
  }

  /** Boom (title / intro): sine 55 → 38 Hz over 0.6 s gain 0.35 + noise LP 200 Hz 0.15 s gain 0.20. */
  boom() {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm, d = 0.6 * tm;
    const v = this._begin(this.buses.ui, K_SFX);
    const o = this._osc(v, 'sine', 55);
    o.frequency.exponentialRampToValueAtTime(38 * this._fm, t0 + d);
    const g = this._gain(v, v.out);
    attackDecayEnv(g.gain, t0, 0.35, 0.01 * tm, d);
    o.connect(g);
    this._start(v, o, t0, t0 + d + 0.03, 0);
    this._noiseBurst(v, t0, 0.15 * tm, 'lowpass', 200, 0.7, 0.20);
    this._finish(v);
  }

  /** Sting (title): sawtooth chord 220/277/330/440 Hz, lowpass 900 Hz, attack 0.4 s, release 1.2 s, gain 0.12. */
  sting() {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm;
    const att = 0.4 * tm, rel = 1.2 * tm;
    const v = this._begin(this.buses.ui, K_SFX);
    const g = this._gain(v, v.out);
    holdEnv(g.gain, t0, 0.12, att, 0, rel);
    const lp = this._filter(v, 'lowpass', 900, 0.7, g);
    for (let i = 0; i < 4; i++) {
      const o = this._osc(v, 'sawtooth', i === 0 ? 220 : i === 1 ? 277 : i === 2 ? 330 : 440);
      o.connect(lp);
      this._start(v, o, t0, t0 + att + rel + 0.02, 0);
    }
    this._finish(v);
  }

  /** Wipe (replay in/out): noise, highpass sweeping 2 → 6 kHz over 0.25 s, gain 0.10. */
  wipe() {
    if (!this._active()) return;
    const t0 = this.ctx.currentTime, tm = this._tm, d = 0.25 * tm;
    const v = this._begin(this.buses.ui, K_SFX);
    const g = this._gain(v, v.out);
    holdEnv(g.gain, t0, 0.10, 0.05 * tm, 0.10 * tm, 0.10 * tm);
    const hp = this._filter(v, 'highpass', 2000, 0.7, g);
    hp.frequency.setValueAtTime(2000 * this._fm, t0);
    hp.frequency.exponentialRampToValueAtTime(6000 * this._fm, t0 + d);
    const src = this._noiseSrc(v, hp);
    this._start(v, src, t0, t0 + d + 0.02, this._noiseOffset());
    this._finish(v);
  }

  // ---- crowd (v1 API on top of audio/crowd.js) ----------------------------------------------------

  /** v1: crowd swell to `level` (0..1) held for `seconds`, then the v2 decay toward the base. */
  crowd(level, seconds) {
    this.crowdAudio.excite(level, Number.isFinite(seconds) && seconds > 0 ? seconds : 1.5);
  }

  /** v1 air-ball groan → the v2 `aww` burst. */
  groan() {
    this.crowdAudio.burst('aww', 0.6);
  }

  /** Stop every SFX voice and silence the crowd's transient layers (quit, page hide). */
  stopAll() {
    for (let i = 0; i < this._voices.length; i++) this._kill(this._voices[i]);
    this.crowdAudio.stop();
  }

  // ---- per frame --------------------------------------------------------------------------------

  /**
   * Per frame (§1.3 step 11): optional camera → listener, crowd envelope, reaping of voices whose
   * `onended` never fired (e.g. a context suspended mid-sound). Zero allocations.
   */
  update(dt, camera) {
    if (camera && camera.position) {
      const p = camera.position;
      this.setListener(p.x, p.y, p.z);
    }
    if (!(dt > 0)) return;
    this.crowdAudio.update(dt);
    if (this.ctx === null) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this._voices.length; i++) {
      const v = this._voices[i];
      if (v.busy && now > v.end + REAP_S) this._kill(v);
    }
  }
}
