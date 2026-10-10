/**
 * @module audio/crowd
 * Synthesized arena crowd (spec v2 §6.7; [ref PR:§8.3 Crowd]). No samples, no voices, no PA.
 *
 *  - Beds: two 4.0 s seamless pink-noise loops (Voss–McCartney, 7 rows): `murmur` → lowpass 500 Hz, gain 0.06
 *    (always on) and `excite` → bandpass 900 Hz Q 0.7, gain 0.20 · excite. `excite` follows the same model as
 *    the visual crowd (§2.8): `excite(level, holdS)` jumps up, holds, then decays toward the base level at
 *    0.5 /s (base 0.05 normal, 0.25 clutch via `setBase`).
 *  - Vowel bursts `ooh` / `aah` / `aww`: pink noise through two parallel formant bandpasses, attack 0.25 s,
 *    release 0.8 s (ooh F1 300 → 350 Hz Q 5, F2 800 Hz Q 4; aah F1 700, F2 1,200; aww F1 450 → 280, F2 900 → 700).
 *  - Applause: 60 clap grains/s (12 ms noise, bandpass 1.2 kHz Q 1.5, gain 0.3–1.0) pre-rendered once into a
 *    2.0 s loop (the "pooled" grains), gated by an envelope for 1.5–3.0 s per call.
 *  - Chant (wordless): two claps 0.25 s apart + a stomp (sine 60 Hz, 80 ms) on beat 3 of a 1.0 s cycle,
 *    30 grain voices jittered ± 25 ms, pre-rendered into a 1.0 s loop and faded in/out by `chant(on)`.
 *  - Clutch anticipation: an `ooh` whose F1 glides 300 → 420 Hz while the shot is in flight, resolved by a
 *    cheer or an `aww`.
 *
 * Cosmetic randomness only, from `Rng(seed ^ 0xC20D)` (H8). Everything is built in `attach()` (called by
 * `Audio.unlock()` inside a user gesture); before that, and while the context is not running, every method
 * is a safe no-op apart from bookkeeping. `update(dt)` allocates nothing (H10).
 */
import { Rng } from '../math.js';

/** Sample rate of the generated crowd buffers: everything here sits below 5 kHz, so 22.05 kHz is plenty. */
export const CROWD_RATE = 22050;
const BED_S = 4.0;
const APPLAUSE_LOOP_S = 2.0;
const CHANT_LOOP_S = 1.0;
const LOOP_XFADE_S = 0.05;          // crossfade folded into each loop so the wrap point is seamless

const MURMUR_LP_HZ = 500;
const MURMUR_GAIN = 0.06;
const EXCITE_BP_HZ = 900;
const EXCITE_Q = 0.7;
const EXCITE_GAIN = 0.20;           // bed gain = 0.20 · excite
export const BASE_NORMAL = 0.05;
export const BASE_CLUTCH = 0.25;
const EXCITE_DECAY_PER_S = 0.5;
const EXCITE_EPS = 0.002;           // only re-target the bed gain when it moved this much

const VOWEL_ATTACK = 0.25;
const VOWEL_HOLD = 0.15;
const VOWEL_RELEASE = 0.8;
const VOWEL_F1_GAIN = 0.8;          // formant path gains (bandpass on pink noise keeps ~17 % of the amplitude)
const VOWEL_F2_GAIN = 0.5;
const VOWEL_LEVEL = 0.55;           // overall vowel level relative to `gain` 1.0
const MAX_VOWELS = 6;
const VOWELS = {
  ooh: { f1a: 300, f1b: 350, q1: 5, f2a: 800, f2b: 800, q2: 4 },
  aah: { f1a: 700, f1b: 700, q1: 5, f2a: 1200, f2b: 1200, q2: 4 },
  aww: { f1a: 450, f1b: 280, q1: 5, f2a: 900, f2b: 700, q2: 4 },
};

const ANTIC_F1_FROM = 300;
const ANTIC_F1_TO = 420;
const ANTIC_GLIDE_S = 1.6;
const ANTIC_GAIN = 0.5;
const ANTIC_TIMEOUT_S = 4.0;        // an unresolved anticipation fades by itself

const CLAP_RATE = 60;               // grains per second
const CLAP_S = 0.012;
const CLAP_BP_HZ = 1200;
const CLAP_Q = 1.5;
const APPLAUSE_LEVEL = 0.45;
const APPLAUSE_MIN_S = 0.3;
const APPLAUSE_MAX_S = 6.0;
const APPLAUSE_RISE_TC = 0.08;      // setTargetAtTime time constants
const APPLAUSE_FALL_TC = 0.25;
const APPLAUSE_FALL_LEAD = 0.5;     // release starts this long before the nominal end

const CHANT_VOICES = 30;
const CHANT_JITTER_S = 0.025;
const CHANT_CLAPS_S = [0.0, 0.25];  // beats 1 and 2 of the 1.0 s cycle
const CHANT_STOMP_S = 0.5;          // beat 3
const CHANT_STOMP_HZ = 60;
const CHANT_STOMP_DUR = 0.08;
const CHANT_LEVEL = 0.35;
const CHANT_TC = 0.3;

/**
 * Crowd reactions of [PR §8.3] (event → sound) with the visual crowd's excitement levels/holds (§2.8).
 * `react(kind)` plays one row; the router (flow.js) picks the row from the game event.
 */
export const CROWD_REACTIONS = Object.freeze({
  make2: Object.freeze({ excite: 0.60, hold: 1.5, vowel: 'aah', vowelGain: 0.60, applause: 1.5, applauseGain: 1.0 }),
  make3: Object.freeze({ excite: 0.85, hold: 2.0, vowel: 'aah', vowelGain: 0.85, applause: 2.5, applauseGain: 1.0 }),
  cpuMake: Object.freeze({ excite: 0.30, hold: 1.0, vowel: 'aww', vowelGain: 0.40, applause: 1.0, applauseGain: 0.3 }),
  dunk: Object.freeze({ excite: 1.00, hold: 3.0, vowel: 'ooh', vowelGain: 1.00, then: 'aah', thenDelay: 0.35, applause: 3.0, applauseGain: 1.0 }),
  block: Object.freeze({ excite: 0.80, hold: 2.0, vowel: 'ooh', vowelGain: 0.80 }),
  ankle: Object.freeze({ excite: 0.90, hold: 2.0, vowel: 'ooh', vowelGain: 0.80 }),
  chaseDown: Object.freeze({ excite: 0.80, hold: 2.0, vowel: 'ooh', vowelGain: 0.80 }),
  airball: Object.freeze({ vowel: 'aww', vowelGain: 0.60 }),
  winner: Object.freeze({ excite: 1.00, hold: 6.0, applause: 4.0, applauseGain: 1.0 }),
  intro: Object.freeze({ excite: 0.50, hold: 2.0 }),
});

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function disconnect(node) {
  if (node) { try { node.disconnect(); } catch (e) { /* already gone */ } }
}

// Number of trailing zero bits of a positive integer (Voss–McCartney row selector).
function ctz(n) {
  let k = 0;
  while ((n & 1) === 0 && k < 31) { n >>>= 1; k++; }
  return k;
}

/**
 * Voss–McCartney pink noise with 7 rows plus a white row: row k is redrawn every 2^k samples, so the
 * sum has roughly equal energy per octave over ~7 octaves. Writes `n` samples into `out` (from `off`).
 */
export function fillPink(out, off, n, rng) {
  const rows = [0, 0, 0, 0, 0, 0, 0];
  let sum = 0;
  for (let k = 0; k < 7; k++) { rows[k] = rng.range(-1, 1); sum += rows[k]; }
  for (let i = 0; i < n; i++) {
    const k = ctz(i + 1);
    if (k < 7) { sum -= rows[k]; rows[k] = rng.range(-1, 1); sum += rows[k]; }
    out[off + i] = (sum + rng.range(-1, 1)) / 8;
  }
}

/**
 * Make `data` (length N) loop seamlessly: `tail` holds the F samples that would follow sample N−1; they are
 * crossfaded (equal power, uncorrelated noise) into the first F samples, so data[N−1] → data[0] is continuous.
 */
export function foldLoop(data, tail) {
  const f = tail.length;
  for (let i = 0; i < f; i++) {
    const w = i / f;
    data[i] = data[i] * Math.sqrt(w) + tail[i] * Math.sqrt(1 - w);
  }
}

/** Scale so the absolute peak equals `peak` (no-op on silence). */
export function normalizePeak(data, peak) {
  let m = 0;
  for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > m) m = a; }
  if (m > 0) { const k = peak / m; for (let i = 0; i < data.length; i++) data[i] *= k; }
}

/**
 * RBJ-cookbook band-pass (constant 0 dB peak gain) run over a loop buffer in place. The loop is filtered
 * twice in a row and only the second pass is kept, so the filter state at the start equals the state at the
 * end and the wrap stays seamless.
 */
export function bandpassLoop(data, rate, f0, q) {
  const w0 = 2 * Math.PI * f0 / rate;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - alpha) / a0;
  const n = data.length;
  const src = Float32Array.from(data);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const x = src[i];
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      if (pass === 1) data[i] = y;
    }
  }
}

// One 12 ms clap grain added at time `t` (wrapping around the loop): ~1 ms linear attack, then an
// exponential decay with a 3 ms time constant (hand claps are a sharp transient, not a tone).
function addClap(data, rate, t, gain, rng) {
  const n = data.length;
  const len = Math.round(CLAP_S * rate);
  const att = Math.max(1, Math.round(0.001 * rate));
  let i0 = Math.round(t * rate) % n;
  if (i0 < 0) i0 += n;
  for (let j = 0; j < len; j++) {
    const env = j < att ? j / att : Math.exp(-(j - att) / (0.003 * rate));
    data[(i0 + j) % n] += rng.range(-1, 1) * env * gain;
  }
}

class VowelVoice {
  constructor(owner, index) {
    this.index = index;
    this.busy = false;
    this.start = 0;
    this.end = 0;
    this.src = null;
    this.f1 = null; this.f2 = null; this.g1 = null; this.g2 = null; this.out = null;
    this.onEnded = () => owner._releaseVowel(this);
  }
}

export class CrowdAudio {
  /** @param opts { seed } — cosmetic seed; the module uses Rng(seed ^ 0xC20D) (H8). */
  constructor(opts) {
    const seed = opts && Number.isFinite(opts.seed) ? opts.seed | 0 : 0x1e6e2d5;
    this.rng = new Rng((seed ^ 0xC20D) | 0);
    this.ctx = null;
    this.out = null;                // crowd sub-mix (connected to the caller's crowd bus)
    this.muted = false;             // set by Audio.setMuted: bursts are skipped, bookkeeping continues
    this.base = BASE_NORMAL;
    this.level = BASE_NORMAL;       // current excitement 0..1 (same model as the visual crowd)
    this.hold = 0;
    this.bytes = 0;                 // bytes of generated AudioBuffers
    this.chanting = false;
    this._pink = null;              // murmur bed buffer (also the vowel source)
    this._murmurGain = null;
    this._exciteGain = null;
    this._applauseGain = null;
    this._chantGain = null;
    this._exciteLast = -1;
    this._vowels = [];
    for (let i = 0; i < MAX_VOWELS; i++) this._vowels.push(new VowelVoice(this, i));
    this._antic = null;             // VowelVoice playing the clutch anticipation
    this._anticT = 0;
  }

  get attached() {
    return this.ctx !== null && this.out !== null;
  }

  _running() {
    return this.attached && this.ctx.state === 'running';
  }

  /**
   * Build buffers and the persistent graph on `ctx`, output into `dest` (the crowd bus). Returns the bytes of
   * generated buffers. Throws only if the context itself is unusable (Audio catches it).
   */
  attach(ctx, dest) {
    if (this.attached) return this.bytes;
    const rate = CROWD_RATE, rng = this.rng;
    const xf = Math.round(LOOP_XFADE_S * rate);
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(dest);

    // Beds: two independent 4.0 s pink loops.
    const bedLen = Math.round(BED_S * rate);
    const murmurBuf = ctx.createBuffer(1, bedLen, rate);
    const exciteBuf = ctx.createBuffer(1, bedLen, rate);
    const tmp = new Float32Array(bedLen + xf);
    const bufs = [murmurBuf, exciteBuf];
    for (let b = 0; b < 2; b++) {
      fillPink(tmp, 0, bedLen + xf, rng);
      const data = bufs[b].getChannelData(0);
      for (let i = 0; i < bedLen; i++) data[i] = tmp[i];
      foldLoop(data, tmp.subarray(bedLen, bedLen + xf));
      normalizePeak(data, 0.95);
    }
    this._pink = murmurBuf;

    const murmurSrc = ctx.createBufferSource();
    murmurSrc.buffer = murmurBuf;
    murmurSrc.loop = true;
    const murmurLp = ctx.createBiquadFilter();
    murmurLp.type = 'lowpass';
    murmurLp.frequency.value = MURMUR_LP_HZ;
    murmurLp.Q.value = 0.5;
    const murmurGain = ctx.createGain();
    murmurGain.gain.value = MURMUR_GAIN;
    murmurSrc.connect(murmurLp);
    murmurLp.connect(murmurGain);
    murmurGain.connect(out);

    const exciteSrc = ctx.createBufferSource();
    exciteSrc.buffer = exciteBuf;
    exciteSrc.loop = true;
    const exciteBp = ctx.createBiquadFilter();
    exciteBp.type = 'bandpass';
    exciteBp.frequency.value = EXCITE_BP_HZ;
    exciteBp.Q.value = EXCITE_Q;
    const exciteGain = ctx.createGain();
    exciteGain.gain.value = EXCITE_GAIN * this.level;
    exciteSrc.connect(exciteBp);
    exciteBp.connect(exciteGain);
    exciteGain.connect(out);

    // Applause loop: 60 grains/s at random times, gains 0.3–1.0, band-passed at 1.2 kHz.
    const apLen = Math.round(APPLAUSE_LOOP_S * rate);
    const apBuf = ctx.createBuffer(1, apLen, rate);
    const ap = apBuf.getChannelData(0);
    const grains = Math.round(CLAP_RATE * APPLAUSE_LOOP_S);
    for (let g = 0; g < grains; g++) addClap(ap, rate, rng.range(0, APPLAUSE_LOOP_S), rng.range(0.3, 1.0), rng);
    bandpassLoop(ap, rate, CLAP_BP_HZ, CLAP_Q);
    normalizePeak(ap, 0.95);
    const apSrc = ctx.createBufferSource();
    apSrc.buffer = apBuf;
    apSrc.loop = true;
    const apGain = ctx.createGain();
    apGain.gain.value = 0;
    apSrc.connect(apGain);
    apGain.connect(out);

    // Chant loop: 30 clappers on beats 1 and 2 (± 25 ms), a 60 Hz stomp on beat 3.
    const chLen = Math.round(CHANT_LOOP_S * rate);
    const chBuf = ctx.createBuffer(1, chLen, rate);
    const ch = chBuf.getChannelData(0);
    for (let c = 0; c < CHANT_CLAPS_S.length; c++) {
      for (let v = 0; v < CHANT_VOICES; v++) {
        addClap(ch, rate, CHANT_CLAPS_S[c] + rng.range(-CHANT_JITTER_S, CHANT_JITTER_S), rng.range(0.3, 1.0), rng);
      }
    }
    bandpassLoop(ch, rate, CLAP_BP_HZ, CLAP_Q);
    normalizePeak(ch, 0.9);
    // The stomp is added after the clap band-pass (a 60 Hz thump would not survive it): 5 ms attack,
    // then a cosine-shaped decay to zero over the 80 ms, so the tone starts and ends without a click.
    const s0 = Math.round(CHANT_STOMP_S * rate), sLen = Math.round(CHANT_STOMP_DUR * rate);
    const sAtt = Math.round(0.005 * rate);
    for (let j = 0; j < sLen; j++) {
      const env = j < sAtt ? j / sAtt : 0.5 + 0.5 * Math.cos(Math.PI * (j - sAtt) / (sLen - sAtt));
      ch[(s0 + j) % chLen] += 0.85 * env * Math.sin(2 * Math.PI * CHANT_STOMP_HZ * j / rate);
    }
    const chSrc = ctx.createBufferSource();
    chSrc.buffer = chBuf;
    chSrc.loop = true;
    const chGain = ctx.createGain();
    chGain.gain.value = 0;
    chSrc.connect(chGain);
    chGain.connect(out);

    murmurSrc.start(0);
    exciteSrc.start(0, rng.range(0, BED_S));
    apSrc.start(0);
    chSrc.start(0);

    this.ctx = ctx;
    this.out = out;
    this._murmurGain = murmurGain;
    this._exciteGain = exciteGain;
    this._applauseGain = apGain;
    this._chantGain = chGain;
    this._exciteLast = EXCITE_GAIN * this.level;
    this.bytes = 4 * (bedLen * 2 + apLen + chLen);
    if (this.chanting) this._setChantGain(true);
    return this.bytes;
  }

  // ---- excitement ---------------------------------------------------------------------------------

  /** Raise excitement to `level` (0..1) and hold it `holdS` seconds before decaying toward the base. */
  excite(level, holdS) {
    const l = clamp(Number.isFinite(level) ? level : 0, 0, 1);
    const h = Number.isFinite(holdS) && holdS > 0 ? holdS : 0;
    if (l > this.level) { this.level = l; this.hold = h; } else if (l >= this.level - 0.05) this.hold = Math.max(this.hold, h);
  }

  /** Base excitement: BASE_NORMAL 0.05, BASE_CLUTCH 0.25 (Q4/OT, ≤ 60 s, margin ≤ 5). */
  setBase(level) {
    this.base = clamp(Number.isFinite(level) ? level : BASE_NORMAL, 0, 1);
  }

  // ---- vowels -----------------------------------------------------------------------------------

  _releaseVowel(v) {
    if (!v.busy) return;
    v.busy = false;
    if (this._antic === v) this._antic = null;
    if (v.src) { v.src.onended = null; }
    disconnect(v.src); disconnect(v.f1); disconnect(v.f2); disconnect(v.g1); disconnect(v.g2); disconnect(v.out);
    v.src = null; v.f1 = null; v.f2 = null; v.g1 = null; v.g2 = null; v.out = null;
  }

  _killVowel(v) {
    if (!v.busy) return;
    if (v.src) { v.src.onended = null; try { v.src.stop(); } catch (e) { /* not started */ } }
    this._releaseVowel(v);
  }

  _takeVowel() {
    let free = null, oldest = null;
    for (let i = 0; i < this._vowels.length; i++) {
      const v = this._vowels[i];
      if (!v.busy) { if (free === null) free = v; } else if (v !== this._antic && (oldest === null || v.start < oldest.start)) oldest = v;
    }
    if (free !== null) return free;
    if (oldest === null) return null;
    this._killVowel(oldest);
    return oldest;
  }

  // Build one formant voice; envelope and formant automation are scheduled by the caller.
  _vowelGraph(v, spec, t0) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._pink;
    src.loop = true;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(spec.f1a, t0);
    f1.Q.value = spec.q1;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.setValueAtTime(spec.f2a, t0);
    f2.Q.value = spec.q2;
    const g1 = ctx.createGain();
    g1.gain.value = VOWEL_F1_GAIN;
    const g2 = ctx.createGain();
    g2.gain.value = VOWEL_F2_GAIN;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t0);
    src.connect(f1); src.connect(f2);
    f1.connect(g1); f2.connect(g2);
    g1.connect(out); g2.connect(out);
    out.connect(this.out);
    v.busy = true; v.start = t0;
    v.src = src; v.f1 = f1; v.f2 = f2; v.g1 = g1; v.g2 = g2; v.out = out;
    return src;
  }

  /**
   * Vowel burst `kind` ∈ 'ooh' | 'aah' | 'aww' at `gain` (0..1), optionally `delay` seconds from now.
   * Returns true when scheduled.
   */
  burst(kind, gain, delay) {
    if (!this._running() || this.muted) return false;
    const spec = VOWELS[kind];
    if (!spec) return false;
    const g = clamp(Number.isFinite(gain) ? gain : 1, 0, 1);
    if (g <= 0) return false;
    const v = this._takeVowel();
    if (v === null) return false;
    const t0 = this.ctx.currentTime + (Number.isFinite(delay) && delay > 0 ? delay : 0);
    const src = this._vowelGraph(v, spec, t0);
    const dur = VOWEL_ATTACK + VOWEL_HOLD + VOWEL_RELEASE;
    // Formant glides span the whole burst (ooh: F1 300 → 350; aww: F1 450 → 280, F2 900 → 700).
    if (spec.f1b !== spec.f1a) v.f1.frequency.linearRampToValueAtTime(spec.f1b, t0 + dur);
    if (spec.f2b !== spec.f2a) v.f2.frequency.linearRampToValueAtTime(spec.f2b, t0 + dur);
    const peak = g * VOWEL_LEVEL;
    const p = v.out.gain;
    p.linearRampToValueAtTime(peak, t0 + VOWEL_ATTACK);
    p.setValueAtTime(peak, t0 + VOWEL_ATTACK + VOWEL_HOLD);
    p.linearRampToValueAtTime(0, t0 + dur);
    src.start(t0, this.rng.range(0, BED_S - 0.1));
    src.stop(t0 + dur + 0.02);
    v.end = t0 + dur + 0.02;
    src.onended = v.onEnded;
    return true;
  }

  /** Clutch anticipation: an `ooh` whose F1 glides 300 → 420 Hz while the shot is in flight. */
  anticipate() {
    if (!this._running() || this.muted || this._antic !== null) return false;
    const v = this._takeVowel();
    if (v === null) return false;
    const t0 = this.ctx.currentTime;
    const spec = VOWELS.ooh;
    const src = this._vowelGraph(v, spec, t0);
    v.f1.frequency.setValueAtTime(ANTIC_F1_FROM, t0);
    v.f1.frequency.linearRampToValueAtTime(ANTIC_F1_TO, t0 + ANTIC_GLIDE_S);
    v.out.gain.linearRampToValueAtTime(ANTIC_GAIN * VOWEL_LEVEL, t0 + 0.4);
    src.start(t0, this.rng.range(0, BED_S - 0.1));
    v.end = t0 + ANTIC_TIMEOUT_S + 1;
    src.onended = v.onEnded;
    this._antic = v;
    this._anticT = 0;
    return true;
  }

  /** End the anticipation: `outcome` 'cheer' → `aah` + excitement, 'aww' → groan, anything else → fade only. */
  resolveAnticipation(outcome) {
    const v = this._antic;
    if (v !== null && this.attached) {
      const t0 = this.ctx.currentTime;
      const p = v.out.gain;
      p.cancelScheduledValues(t0);
      p.setTargetAtTime(0, t0, 0.1);
      try { v.src.stop(t0 + 0.6); } catch (e) { /* already stopped */ }
      v.end = t0 + 0.6;
      this._antic = null;
    }
    if (outcome === 'cheer') { this.excite(0.8, 1.5); this.burst('aah', 0.9); } else if (outcome === 'aww') this.burst('aww', 0.6);
  }

  get anticipating() {
    return this._antic !== null;
  }

  // ---- applause / chant -------------------------------------------------------------------------

  /** Applause for `seconds` (clamped 0.3–6.0) at relative `gain` (default 1). */
  applause(seconds, gain) {
    if (!this._running() || this.muted) return false;
    const s = clamp(Number.isFinite(seconds) ? seconds : 2, APPLAUSE_MIN_S, APPLAUSE_MAX_S);
    const g = clamp(Number.isFinite(gain) ? gain : 1, 0, 1) * APPLAUSE_LEVEL;
    const p = this._applauseGain.gain, t0 = this.ctx.currentTime;
    // Cancel the pending release of a previous call; setTargetAtTime starts from the current value.
    p.cancelScheduledValues(t0);
    p.setTargetAtTime(g, t0, APPLAUSE_RISE_TC);
    p.setTargetAtTime(0, t0 + Math.max(0.1, s - APPLAUSE_FALL_LEAD), APPLAUSE_FALL_TC);
    return true;
  }

  /** Wordless chant on/off (on together with the visual chant: CPU on offence in clutch, shot clock ≤ 8). */
  chant(on) {
    const b = !!on;
    if (b === this.chanting) return;
    this.chanting = b;
    if (this.attached) this._setChantGain(b);
  }

  _setChantGain(on) {
    const p = this._chantGain.gain, t0 = this.ctx.currentTime;
    p.cancelScheduledValues(t0);
    p.setTargetAtTime(on && !this.muted ? CHANT_LEVEL : 0, t0, CHANT_TC);
  }

  /** Called by Audio.setMuted so the persistent loops fall silent with the master anyway. */
  setMuted(b) {
    this.muted = !!b;
    if (this.attached && this.chanting) this._setChantGain(true);
  }

  // ---- event map --------------------------------------------------------------------------------

  /** Play one row of CROWD_REACTIONS ('make2', 'make3', 'cpuMake', 'dunk', 'block', 'ankle', 'chaseDown',
   *  'airball', 'winner', 'intro'). Returns false for an unknown kind. Excitement is tracked even when silent. */
  react(kind) {
    const r = CROWD_REACTIONS[kind];
    if (!r) return false;
    if (r.excite !== undefined) this.excite(r.excite, r.hold);
    if (r.vowel !== undefined) this.burst(r.vowel, r.vowelGain);
    if (r.then !== undefined) this.burst(r.then, r.vowelGain, r.thenDelay);
    if (r.applause !== undefined) this.applause(r.applause, r.applauseGain);
    return true;
  }

  // ---- per frame ----------------------------------------------------------------------------------

  /** Excitement envelope + anticipation timeout + reaping of vowels whose onended never fired. No allocation. */
  update(dt) {
    if (!(dt > 0)) return;
    if (this.hold > 0) {
      this.hold -= dt;
    } else if (this.level > this.base) {
      this.level = Math.max(this.base, this.level - EXCITE_DECAY_PER_S * dt);
    } else if (this.level < this.base) {
      this.level = Math.min(this.base, this.level + EXCITE_DECAY_PER_S * dt);
    }
    if (!this.attached) return;
    const g = EXCITE_GAIN * this.level;
    if (Math.abs(g - this._exciteLast) >= EXCITE_EPS || (g === EXCITE_GAIN * this.base && g !== this._exciteLast)) {
      this._exciteGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
      this._exciteLast = g;
    }
    if (this._antic !== null) {
      this._anticT += dt;
      if (this._anticT >= ANTIC_TIMEOUT_S) this.resolveAnticipation(null);
    }
    const now = this.ctx.currentTime;
    for (let i = 0; i < this._vowels.length; i++) {
      const v = this._vowels[i];
      if (v.busy && v !== this._antic && now > v.end + 0.5) this._killVowel(v);
    }
  }

  /** Silence everything immediately (quit to menu, page hide); excitement returns to the base. */
  stop() {
    for (let i = 0; i < this._vowels.length; i++) this._killVowel(this._vowels[i]);
    this._antic = null;
    this.level = this.base;
    this.hold = 0;
    if (!this.attached) return;
    const t0 = this.ctx.currentTime;
    const ap = this._applauseGain.gain;
    ap.cancelScheduledValues(t0);
    ap.setTargetAtTime(0, t0, 0.05);
    this.chanting = false;
    this._setChantGain(false);
  }
}
