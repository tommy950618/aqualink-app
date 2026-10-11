/**
 * @module render/quality
 * Quality tiers, the 6-rung DPR ladder, static GPU detection, the runtime frame-time monitor and the
 * texture-memory ledger (SPEC-v2 §7, PR §6).
 *
 * - `TIERS` is the binding per-tier settings table of §7.4 (consumed by WP2 characters, WP3 animation, WP6 render,
 *   WP7 cameras, WP8 UI). Sizes marked "load" are decided once from the start tier and never change at runtime.
 * - `RUNGS` is the ladder of §7.1: rung = tier × DPR cap; `dpr = min(devicePixelRatio, rungDpr)`.
 * - `detectStatic(gl, nav, screen, url)` classifies the unmasked renderer string (§7.2) and applies the memory /
 *   core / fill-rate caps and the `?quality=` override.
 * - `QualityMonitor` is the pure (DOM-free, Node-testable) judge of §7.3: cadence re-targeting, demotion,
 *   promotion, lock after 4 changes, 30 Hz mode below rung 1. It never allocates per frame: samples live in
 *   preallocated typed rings and percentiles come from a fixed histogram.
 * - `createQuality(...)` wraps the monitor with the renderer: DPR changes apply immediately (setPixelRatio +
 *   setSize, never a render), tier changes are held as `pendingTier` until `commitPendingTier()` at the next
 *   CHECK (WP9 calls it after `renderer.compile`), and `onTierChange` listeners are told.
 * - `trackTexture(tex, bpp, mip)` / `texMB()` keep the §7.5 texture accounting
 *   (`Σ w·h·bpp·(mip ? 1.333 : 1) / 2^20`), automatically untracking on `dispose`.
 *
 * Node-safe: nothing here touches `window`/`document` at import time.
 */

/** Frame-time targets (ms). */
export const TARGET_60 = 1000 / 60;   // 16.67
export const TARGET_30 = 1000 / 30;   // 33.33

/**
 * Ladder (§7.1). DPR per rung for touch and desktop devices.
 * @type {ReadonlyArray<{rung:number, tier:'low'|'medium'|'high', touch:number, desktop:number}>}
 */
export const RUNGS = Object.freeze([
  Object.freeze({ rung: 1, tier: 'low', touch: 0.85, desktop: 1.0 }),
  Object.freeze({ rung: 2, tier: 'low', touch: 1.0, desktop: 1.0 }),
  Object.freeze({ rung: 3, tier: 'medium', touch: 1.25, desktop: 1.25 }),
  Object.freeze({ rung: 4, tier: 'medium', touch: 1.5, desktop: 1.5 }),
  Object.freeze({ rung: 5, tier: 'high', touch: 1.75, desktop: 1.75 }),
  Object.freeze({ rung: 6, tier: 'high', touch: 2.0, desktop: 2.0 }),
]);

/** Top rung of each tier (what `?quality=` / a manual choice forces). */
export const TOP_RUNG = Object.freeze({ low: 2, medium: 4, high: 6 });

/** Tier of a rung (1..6). */
export function tierOfRung(rung) {
  const r = rung < 1 ? 1 : rung > 6 ? 6 : rung | 0;
  return RUNGS[r - 1].tier;
}

/** DPR cap of a rung for a touch / desktop device. */
export function rungDpr(rung, touch) {
  const r = rung < 1 ? 1 : rung > 6 ? 6 : rung | 0;
  return touch ? RUNGS[r - 1].touch : RUNGS[r - 1].desktop;
}

function freezeDeep(o) {
  for (const k in o) if (o[k] && typeof o[k] === 'object') freezeDeep(o[k]);
  return Object.freeze(o);
}

/**
 * Settings per tier (§7.4, binding). Grouped by consumer. Fields documented in place.
 * `fixed` groups are decided once at load from the start tier; `runtime` groups may change with the ladder.
 */
export const TIERS = freezeDeep({
  low: {
    name: 'low',
    dprCap: 1.0,
    // ---- characters (WP2, CHR §9.1) ----
    characters: {
      lodPlay: 3, lodMenus: 2, lodNearPx: null, lodNear: null, // LOD 3 (menus 2)
      skin: 512, skinTouch: 512, kit: 512, strand: 256, eye: 128,
      morphs: false, lashes: false, groom: 'inner',
      skinMaterial: 'standard', kitMaterial: 'lambert', groomAlpha: 'test', wetMaterial: 'lambert',
      kitSheen: false, mouthguard: false,
      replayLod: { rule: 'nearest2', lod: 1 },
    },
    // ---- animation (WP3, ANIM §12) ----
    animation: { budgetMs: 2.0, fullRate: 'ownerAndAction', othersHz: 30 },
    // ---- shadows ----
    shadows: { map: false, mapSize: 0, radius: 0, bias: 0, normalBias: 0, intensity: 0, blobPlayer: 0.45, blobBallNear: 0.5, blobBallFar: 0.15, proxies: false },
    // ---- lights / environment ----
    lights: { hemi: 1.10, key: 2.40, rim: 0.90, fill: 1.70, spot: false },
    env: { size: 0 },
    // ---- floor / decal / reflection ----
    floor: { material: 'lambert', markings: [1024, 816], wood: 512, wear: false, anisotropy: 4, reflection: false },
    decal: { size: 512, material: 'lambert' },
    // ---- crowd ----
    crowd: { count: 700, material: 'basic', atlas: 512, flashes: false },
    // ---- ball ----
    ball: { segments: [20, 14], tex: [512, 256], normal: false, material: 'lambert' },
    // ---- net ----
    net: { strands: 12, rings: 5, substeps: 1 },
    // ---- LED / jumbotron ----
    led: { tex: [1024, 32] }, jumbo: { tex: [512, 256], hz: 1 },
    ribbon: false, centreHung: false, fixtures: true,
    introSpot: false,
    hoop: { detail: 'low' },
    msaa: true, fog: true, toneMapping: 'neutral',
  },
  medium: {
    name: 'medium',
    dprCap: 1.5,
    characters: {
      lodPlay: 2, lodMenus: 1, lodNearPx: 300, lodNear: 1, // LOD 2 (≥ 300 px → 1; menus 0–1)
      skin: 1024, skinTouch: 1024, kit: 1024, strand: 512, eye: 256,
      morphs: true, lashes: true, groom: 'all',
      skinMaterial: 'standard', kitMaterial: 'standard', groomAlpha: 'hash', wetMaterial: 'standard',
      kitSheen: false, mouthguard: false,
      replayLod: { rule: 'nearest2', lod: 0 },
    },
    animation: { budgetMs: 1.2, fullRate: 'ownerAndAction', othersHz: 30 },
    shadows: { map: true, mapSize: 1024, radius: 2.0, bias: -0.0005, normalBias: 0.025, intensity: 0.78, blobPlayer: 0.25, blobBallNear: 0.20, blobBallFar: 0.20, proxies: true },
    lights: { hemi: 0.35, key: 2.85, rim: 1.30, fill: 1.40, spot: true },
    env: { size: 128 },
    floor: { material: 'standard', markings: [2048, 1632], wood: 512, wear: true, anisotropy: 8, reflection: false },
    decal: { size: 512, material: 'standard' },
    crowd: { count: 1600, material: 'lambert', atlas: 1024, flashes: false },
    ball: { segments: [32, 24], tex: [512, 256], normal: true, material: 'standard' },
    net: { strands: 16, rings: 8, substeps: 2 },
    led: { tex: [2048, 64] }, jumbo: { tex: [1024, 512], hz: 2 },
    ribbon: true, centreHung: true, fixtures: true,
    introSpot: true,
    hoop: { detail: 'full' },
    msaa: true, fog: true, toneMapping: 'neutral',
  },
  high: {
    name: 'high',
    dprCap: 2.0,
    characters: {
      lodPlay: 1, lodMenus: 0, lodNearPx: 640, lodNear: 0, // LOD 1 (≥ 640 px → 0; menus 0)
      skin: 2048, skinTouch: 1024, kit: 1024, strand: 1024, eye: 512,
      morphs: true, lashes: true, groom: 'all',
      skinMaterial: 'physical', kitMaterial: 'standard', groomAlpha: 'hash', wetMaterial: 'physical',
      kitSheen: true, mouthguard: true,
      replayLod: { rule: 'within7m', lod: 0 },
    },
    animation: { budgetMs: 0.9, fullRate: 'all', othersHz: 60 },
    shadows: { map: true, mapSize: 2048, radius: 2.5, bias: -0.0004, normalBias: 0.020, intensity: 0.80, blobPlayer: 0.25, blobBallNear: 0.20, blobBallFar: 0.20, proxies: true },
    lights: { hemi: 0.30, key: 2.85, rim: 1.30, fill: 1.40, spot: true },
    env: { size: 256 },
    floor: { material: 'standard', markings: [2048, 1632], wood: 1024, wear: true, anisotropy: 8, reflection: true },
    decal: { size: 1024, material: 'standard' },
    crowd: { count: 2600, material: 'lambert', atlas: 1024, flashes: true },
    ball: { segments: [48, 32], tex: [1024, 512], normal: true, material: 'standard' },
    net: { strands: 16, rings: 8, substeps: 2 },
    led: { tex: [2048, 64] }, jumbo: { tex: [1024, 512], hz: 2 },
    ribbon: true, centreHung: true, fixtures: true,
    introSpot: true,
    hoop: { detail: 'full' },
    msaa: true, fog: true, toneMapping: 'neutral',
  },
});

/** §7.5 budgets of a gameplay frame (all passes). Texture MB = binary MB. */
export const BUDGETS = freezeDeep({
  low: { calls: 48, tris: 70000, texMB: 48, jsMs: 9.0 },
  medium: { calls: 75, tris: 190000, texMB: 150, jsMs: 7.0 },
  highTouch: { calls: 105, tris: 330000, texMB: 230, jsMs: 6.0 },
  highDesktop: { calls: 105, tris: 330000, texMB: 300, jsMs: 4.0 },
});

// -------------------------------------------------------------------------------------------------
// Static detection (§7.2)
// -------------------------------------------------------------------------------------------------

// Classes ordered as in the table; the first matching row wins. Mali short model names carry a "not a
// digit" look-ahead so `mali-g71` does not swallow `mali-g710` (an "upper" GPU).
const CLASS_ROWS = [
  { cls: 'software', start: 2, cap: 2, re: /swiftshader|llvmpipe|software|basic render/ },
  {
    cls: 'low', start: 2, cap: 3,
    re: /mali-4|mali-t|mali-g31(?!\d)|mali-g51(?!\d)|mali-g52(?!\d)|mali-g71(?!\d)|mali-g72(?!\d)|adreno \(tm\) 3|adreno \(tm\) 4|adreno \(tm\) 50|adreno \(tm\) 51|adreno \(tm\) 61[0-9]|powervr|ge8/,
  },
  { cls: 'mid', start: 4, cap: 4, re: /mali-g57(?!\d)|mali-g68(?!\d)|mali-g76(?!\d)|mali-g77(?!\d)|adreno \(tm\) 6[2-5]|intel\(r\) (uhd|hd) graphics/ },
  { cls: 'upper', start: 4, cap: 6, re: /mali-g78(?!\d)|mali-g6[1-9]0|mali-g7[1-9]0|immortalis|adreno \(tm\) 6[6-9]|adreno \(tm\) [78]|xclipse/ },
  { cls: 'apple-mobile', start: 4, cap: 6, re: /apple gpu/ },
  { cls: 'desktop', start: 6, cap: 6, re: /apple m|nvidia|geforce|radeon|amd|iris\(r\) xe/, arc: /\barc\b/ },
];
const CLASS_RANK = { software: 0, low: 1, mid: 2, upper: 3, 'apple-mobile': 3, desktop: 4, unknown: 2 };

/**
 * Classify an (unmasked) renderer string. `touch` gates the `arc` (Intel Arc) desktop pattern.
 * @returns {{cls:string, start:number, cap:number}}
 */
export function classifyRenderer(rendererString, touch = false) {
  const s = String(rendererString || '').toLowerCase();
  for (let i = 0; i < CLASS_ROWS.length; i++) {
    const row = CLASS_ROWS[i];
    if (row.re.test(s) || (row.arc && !touch && row.arc.test(s))) return { cls: row.cls, start: row.start, cap: row.cap };
  }
  return { cls: 'unknown', start: 4, cap: 5 };
}

/** Read the unmasked renderer string from a WebGL context, a THREE renderer or a plain string. */
export function rendererString(gl) {
  if (gl == null) return '';
  if (typeof gl === 'string') return gl;
  let ctx = gl;
  if (typeof gl.getContext === 'function' && typeof gl.getParameter !== 'function') {
    try { ctx = gl.getContext(); } catch (err) { return ''; }
  }
  if (!ctx || typeof ctx.getParameter !== 'function') return '';
  try {
    const ext = ctx.getExtension('WEBGL_debug_renderer_info');
    const v = ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    if (v) return String(v);
  } catch (err) { /* fall through to RENDERER */ }
  try { return String(ctx.getParameter(ctx.RENDERER) || ''); } catch (err) { return ''; }
}

/** Parse `?quality=low|medium|high` (string, URLSearchParams or Location-like). */
export function parseQualityParam(url) {
  if (!url) return null;
  let v = null;
  try {
    if (typeof url === 'string') {
      const q = url.indexOf('?') >= 0 ? url.slice(url.indexOf('?') + 1) : url;
      v = new URLSearchParams(q).get('quality');
    } else if (typeof url.get === 'function') {
      v = url.get('quality');
    } else if (typeof url.search === 'string') {
      v = new URLSearchParams(url.search).get('quality');
    }
  } catch (err) { v = null; }
  return v === 'low' || v === 'medium' || v === 'high' ? v : null;
}

/** Parse `?aa=0` (MSAA off, debug). */
export function parseAaParam(url) {
  try {
    let q = '';
    if (typeof url === 'string') q = url.indexOf('?') >= 0 ? url.slice(url.indexOf('?') + 1) : url;
    else if (url && typeof url.search === 'string') q = url.search;
    else if (url && typeof url.get === 'function') return url.get('aa') !== '0';
    return new URLSearchParams(q).get('aa') !== '0';
  } catch (err) { return true; }
}

/**
 * Static start rung (§7.2).
 * @param {WebGLRenderingContext|object|string|null} gl  context, THREE renderer or renderer string
 * @param {object} [nav]     navigator-like ({deviceMemory, hardwareConcurrency, maxTouchPoints})
 * @param {object} [screen]  screen-like ({width, height, devicePixelRatio?, touch?})
 * @param {string|object} [url] location.search / URLSearchParams
 * @returns {{cls:string, startRung:number, capRung:number, forced:(string|null), touch:boolean, renderer:string}}
 */
export function detectStatic(gl, nav, screen, url) {
  const n = nav || {};
  const sc = screen || {};
  const touch = sc.touch !== undefined ? !!sc.touch : (n.maxTouchPoints | 0) > 0;
  const str = rendererString(gl);
  const c = classifyRenderer(str, touch);
  let start = c.start;
  let cap = c.cap;
  const mem = typeof n.deviceMemory === 'number' ? n.deviceMemory : null;
  const cores = typeof n.hardwareConcurrency === 'number' ? n.hardwareConcurrency : null;
  if (mem !== null) { if (mem <= 2) cap = Math.min(cap, 2); else if (mem <= 4) cap = Math.min(cap, 4); }
  if (cores !== null) { if (cores <= 2) cap = Math.min(cap, 2); else if (cores <= 4) cap = Math.min(cap, 4); }
  const dpr = typeof sc.devicePixelRatio === 'number' ? sc.devicePixelRatio
    : (typeof globalThis !== 'undefined' && typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1);
  const px = (sc.width || 0) * (sc.height || 0) * dpr * dpr;
  // Fill-rate rule: big touch screens on a GPU of class ≤ mid start no higher than rung 3.
  if (touch && px > 3.2e6 && CLASS_RANK[c.cls] <= CLASS_RANK.mid) start = Math.min(start, 3);
  start = Math.min(start, cap);
  const forced = parseQualityParam(url);
  if (forced) { start = TOP_RUNG[forced]; cap = TOP_RUNG[forced]; }
  return { cls: c.cls, startRung: start, capRung: cap, forced, touch, renderer: str };
}

/** Cadence target from the probed median rAF interval (§7.3): 120 Hz panels are capped at 60 fps. */
export function cadenceTarget(medianMs) {
  return medianMs < 12 ? TARGET_60 : medianMs;
}

// -------------------------------------------------------------------------------------------------
// Runtime monitor (§7.3), pure
// -------------------------------------------------------------------------------------------------

const RING = 4096;            // judged samples kept (≥ 10 s at 240 Hz)
const HIST_BINS = 1024;       // 0.25 ms bins up to 256 ms
const HIST_STEP = 0.25;
const HOLDOFF_MS = 2000;      // ≥ 2.0 s after a rung change / resize / tab return / menu close
const DEMOTE_WIN = 3000;
const SEVERE_WIN = 2000;
const PROMOTE_WIN = 10000;
const CADENCE_WIN = 3000;
const MAX_CHANGES = 4;
const MAX_PROMOTIONS = 2;

/** Decision codes returned by `QualityMonitor.judge`. */
export const DECISION = Object.freeze({ NONE: 0, DEMOTE: 1, PROMOTE: 2, RETARGET: 3, HALF_RATE: 4 });

/**
 * Pure judge of measured frame intervals. All time is the monitor's own clock: the sum of the intervals it has
 * been fed (so synthetic streams in tests are exact). Zero allocations per `judge` call.
 */
export class QualityMonitor {
  /**
   * @param {{startRung?:number, capRung?:number, auto?:boolean, target?:number}} [opts]
   */
  constructor(opts) {
    const o = opts || {};
    this.rung = o.startRung || 2;
    this.capRung = o.capRung || 6;
    this.auto = o.auto !== false;
    this.target = o.target || TARGET_60;
    this.locked = false;
    this.halfRate = false;
    this.changes = 0;
    this.promotions = 0;
    this.demotedFrom = 0;          // bit r set = demoted away from rung r this session
    this.clock = 0;                // ms, advanced by every interval fed in
    this.windowStart = 0;          // judged samples count only at clock ≥ windowStart
    this.lastJudged = false;
    this.lastDecision = DECISION.NONE;
    this.lastReason = '';
    this._t = new Float64Array(RING);   // sample end time (clock)
    this._ms = new Float32Array(RING);  // interval
    this._busy = new Float32Array(RING);
    this._head = 0;
    this._n = 0;
    this._hist = new Uint16Array(HIST_BINS);
    this._stat = { n: 0, mean: 0, busy: 0 };
  }

  /** Start a fresh judging window: samples are dropped and the next 2.0 s are ignored (R#13). */
  clearWindow() {
    this._n = 0;
    this._head = 0;
    this.windowStart = this.clock + HOLDOFF_MS;
  }

  /** Effective target of judged intervals (doubled in 30 Hz mode, where every 2nd rAF renders). */
  get effectiveTarget() { return this.halfRate ? this.target * 2 : this.target; }

  /**
   * Feed one rendered-frame interval.
   * @param {number} frameMs interval since the previous rendered frame (ms)
   * @param {{judged:boolean, busyMs?:number}} gate judged = WP9's judging conditions (§7.3)
   * @returns {number} a DECISION code (rung/target already updated on the monitor)
   */
  judge(frameMs, gate) {
    this.lastDecision = DECISION.NONE;
    if (!(frameMs >= 0) || !Number.isFinite(frameMs)) return DECISION.NONE;
    this.clock += frameMs;
    const judged = !!(gate && gate.judged);
    if (!judged) { this.lastJudged = false; return DECISION.NONE; }
    if (!this.lastJudged) { this.lastJudged = true; this.clearWindow(); return DECISION.NONE; } // menu close etc.
    if (this.clock < this.windowStart) return DECISION.NONE;
    const busy = gate && typeof gate.busyMs === 'number' && gate.busyMs >= 0 ? gate.busyMs : 0;
    const i = this._head;
    this._t[i] = this.clock;
    this._ms[i] = frameMs;
    this._busy[i] = busy;
    this._head = (i + 1) % RING;
    if (this._n < RING) this._n++;
    if (!this.auto || this.locked) return DECISION.NONE;
    return this._decide();
  }

  // Window statistics over the samples newer than clock − span. Fills this._stat. Returns false if the judged
  // coverage (time since the window opened) is shorter than span.
  _stats(span) {
    const st = this._stat;
    st.n = 0; st.mean = 0; st.busy = 0;
    if (this.clock - this.windowStart < span) return false;
    const from = this.clock - span;
    let sum = 0, bsum = 0, n = 0;
    for (let k = 0, i = (this._head - 1 + RING) % RING; k < this._n; k++, i = (i - 1 + RING) % RING) {
      if (this._t[i] <= from) break;
      sum += this._ms[i];
      bsum += this._busy[i];
      n++;
    }
    if (n === 0) return false;
    st.n = n; st.mean = sum / n; st.busy = bsum / n;
    return true;
  }

  // Fraction of samples (newer than clock − span) whose interval lies within c ± tol.
  _fractionNear(span, c, tol) {
    const from = this.clock - span;
    let n = 0, hit = 0;
    for (let k = 0, i = (this._head - 1 + RING) % RING; k < this._n; k++, i = (i - 1 + RING) % RING) {
      if (this._t[i] <= from) break;
      n++;
      if (Math.abs(this._ms[i] - c) <= tol) hit++;
    }
    return n > 0 ? hit / n : 0;
  }

  // Percentile (0..1) of the intervals newer than clock − span, from a 0.25 ms histogram (allocation-free).
  _percentile(span, p) {
    const h = this._hist;
    h.fill(0);
    const from = this.clock - span;
    let n = 0;
    for (let k = 0, i = (this._head - 1 + RING) % RING; k < this._n; k++, i = (i - 1 + RING) % RING) {
      if (this._t[i] <= from) break;
      let b = Math.floor(this._ms[i] / HIST_STEP);
      if (b >= HIST_BINS) b = HIST_BINS - 1;
      h[b]++;
      n++;
    }
    if (n === 0) return 0;
    const want = Math.ceil(p * n);
    let acc = 0;
    for (let b = 0; b < HIST_BINS; b++) {
      acc += h[b];
      if (acc >= want) return (b + 1) * HIST_STEP; // upper edge of the bin (conservative)
    }
    return HIST_BINS * HIST_STEP;
  }

  _decide() {
    // 1. Cadence re-target (CRITIC, rest of R#3): a vsync-locked 30 Hz stream with a light main thread is a
    //    display/power mode, not a slow GPU.
    if (!this.halfRate && this._stats(CADENCE_WIN)) {
      if (this.target < 25) {
        if (this._fractionNear(CADENCE_WIN, TARGET_30, 2.0) >= 0.9 && this._stat.busy < 0.5 * TARGET_60) {
          this.target = TARGET_30;
          this.lastReason = 'cadence';
          this.clearWindow();
          return (this.lastDecision = DECISION.RETARGET);
        }
      } else if (this._fractionNear(CADENCE_WIN, TARGET_60, 2.0) >= 0.9) {
        this.target = TARGET_60;
        this.lastReason = 'cadence';
        this.clearWindow();
        return (this.lastDecision = DECISION.RETARGET);
      }
    }
    const tgt = this.effectiveTarget;
    // 2. Demotion: severe (2.0 s, mean > 2×) or regular (3.0 s, mean > 1.30× or p90 > 1.80×).
    let demote = false;
    if (this._stats(SEVERE_WIN) && this._stat.mean > 2.0 * tgt) demote = true;
    if (!demote && this._stats(DEMOTE_WIN)) {
      if (this._stat.mean > 1.30 * tgt || this._percentile(DEMOTE_WIN, 0.90) > 1.80 * tgt) demote = true;
    }
    if (demote) {
      if (this.halfRate) return DECISION.NONE;          // nothing below 30 Hz mode
      if (this.rung <= 1) {
        this.halfRate = true;
        this.lastReason = 'halfRate';
        this._countChange();
        this.clearWindow();
        return (this.lastDecision = DECISION.HALF_RATE);
      }
      this.demotedFrom |= 1 << this.rung;
      this.rung -= 1;
      this.lastReason = 'demote';
      this._countChange();
      this.clearWindow();
      return (this.lastDecision = DECISION.DEMOTE);
    }
    // 3. Promotion: 10 s clean, under the cap, never demoted from the next rung, < 2 promotions.
    if (!this.halfRate && this.rung < this.capRung && this.promotions < MAX_PROMOTIONS &&
        !(this.demotedFrom & (1 << (this.rung + 1))) && this._stats(PROMOTE_WIN)) {
      if (this._stat.mean < 1.08 * tgt && this._percentile(PROMOTE_WIN, 0.95) < 1.25 * tgt) {
        this.rung += 1;
        this.promotions++;
        this.lastReason = 'promote';
        this._countChange();
        this.clearWindow();
        return (this.lastDecision = DECISION.PROMOTE);
      }
    }
    return DECISION.NONE;
  }

  _countChange() {
    this.changes++;
    if (this.changes >= MAX_CHANGES) this.locked = true;
  }
}

// -------------------------------------------------------------------------------------------------
// Texture-memory ledger (§7.5)
// -------------------------------------------------------------------------------------------------

const LEDGER = new Map();     // key object → bytes
let ledgerBytes = 0;

function texDims(tex, out) {
  out.w = 0; out.h = 0; out.d = 1;
  if (!tex) return out;
  if (tex.isWebGLRenderTarget || tex.isRenderTarget) { out.w = tex.width | 0; out.h = tex.height | 0; out.d = tex.depth || 1; return out; }
  if (tex.isLightShadow) { out.w = tex.mapSize.x | 0; out.h = tex.mapSize.y | 0; return out; }
  const img = tex.image;
  if (img) {
    out.w = (img.width || img.videoWidth || 0) | 0;
    out.h = (img.height || img.videoHeight || 0) | 0;
    out.d = img.depth || 1;
  }
  if (tex.isCubeTexture) out.d = 6;
  return out;
}
const DIMS = { w: 0, h: 0, d: 1 };

function onDispose(ev) {
  untrackTexture(ev.target);
}

/**
 * Register a texture / render target / light shadow in the ledger.
 * @param {object} tex   THREE.Texture, WebGLRenderTarget or LightShadow (mapSize)
 * @param {number} [bytesPerPixel=4]  RGBA8 4, half-float RGBA 8, depth/shadow 4
 * @param {boolean} [mip=true]  ×1.333 for a full mip chain
 * @param {number} [w] override width   @param {number} [h] override height
 * @returns {number} bytes accounted for this entry
 */
export function trackTexture(tex, bytesPerPixel = 4, mip = true, w, h) {
  if (!tex) return 0;
  texDims(tex, DIMS);
  const ww = w !== undefined ? w : DIMS.w;
  const hh = h !== undefined ? h : DIMS.h;
  const bytes = ww * hh * DIMS.d * bytesPerPixel * (mip ? 1.333 : 1);
  const old = LEDGER.get(tex);
  if (old !== undefined) ledgerBytes -= old;
  else if (typeof tex.addEventListener === 'function' && !tex.isLightShadow) tex.addEventListener('dispose', onDispose);
  LEDGER.set(tex, bytes);
  ledgerBytes += bytes;
  return bytes;
}

/** Remove an entry (automatic on `tex.dispose()`). */
export function untrackTexture(tex) {
  const old = LEDGER.get(tex);
  if (old === undefined) return;
  ledgerBytes -= old;
  LEDGER.delete(tex);
  if (typeof tex.removeEventListener === 'function' && !tex.isLightShadow) tex.removeEventListener('dispose', onDispose);
}

/** Tracked texture memory in binary MB. */
export function texMB() {
  return ledgerBytes / 1048576;
}

/** Number of ledger entries (tests / debugging). */
export function trackedCount() {
  return LEDGER.size;
}

// -------------------------------------------------------------------------------------------------
// The quality object (§1.4 shape)
// -------------------------------------------------------------------------------------------------

function settingQuality(settings) {
  if (!settings || typeof settings.get !== 'function') return null;
  let v = null;
  try { v = settings.get('quality'); } catch (err) { v = null; }
  return v === 'low' || v === 'medium' || v === 'high' ? v : null;
}

/**
 * Build the quality object.
 * @param {object} args
 * @param {object} [args.renderer]  THREE.WebGLRenderer (DPR + shadow map switch are applied to it)
 * @param {object} [args.settings]  WP8 settings ({get('quality') → 'auto'|'low'|'medium'|'high'})
 * @param {string|object} [args.url]  location.search
 * @param {object} args.static  result of detectStatic
 * @param {number} [args.devicePixelRatio]  defaults to window.devicePixelRatio
 * @param {HTMLCanvasElement} [args.canvas]  defaults to renderer.domElement
 * @returns {object} quality = { tier, rung, dpr, cadence, target, auto, history, onTierChange, frame, ... }
 */
export function createQuality(args) {
  const a = args || {};
  const st = a.static || detectStatic(a.renderer || null, null, null, a.url);
  const renderer = a.renderer || null;
  const canvas = a.canvas || (renderer && renderer.domElement) || null;
  const touch = !!st.touch;
  const urlTier = parseQualityParam(a.url) || st.forced || null;
  const setTier = urlTier ? null : settingQuality(a.settings);
  const forced = urlTier || setTier;
  const startRung = forced ? TOP_RUNG[forced] : st.startRung;
  const capRung = forced ? TOP_RUNG[forced] : st.capRung;
  const monitor = new QualityMonitor({ startRung, capRung, auto: !forced });
  const listeners = [];
  const hasWindow = typeof window !== 'undefined' && window;

  function deviceDpr() {
    if (typeof a.devicePixelRatio === 'number') return a.devicePixelRatio;
    return hasWindow && typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
  }

  const q = {
    /** Live tier (runtime switchable settings follow it). */
    tier: tierOfRung(startRung),
    /** Tier at load: fixes texture sizes, material classes, capacities (§7.4 "decided once"). */
    loadTier: tierOfRung(startRung),
    rung: startRung,
    capRung,
    dpr: Math.min(deviceDpr(), rungDpr(startRung, touch)),
    cadence: TARGET_60,
    target: TARGET_60,
    auto: !forced,
    locked: false,
    halfRate: false,
    touch,
    cls: st.cls,
    aa: parseAaParam(a.url),
    pendingTier: null,
    history: [],
    monitor,
    /** Load-time settings table (sizes, capacities). */
    get settings() { return TIERS[q.loadTier]; },
    /** Runtime settings table of the live tier. */
    get live() { return TIERS[q.tier]; },
    trackTexture,
    untrackTexture,
    texMB,
    onTierChange(cb) {
      if (typeof cb !== 'function') return () => {};
      listeners.push(cb);
      return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    },
    clearWindow() { monitor.clearWindow(); },
    frame,
    shouldRender,
    probeCadence,
    setCadence,
    commitPendingTier,
    setManual,
    applyDpr,
    _lastNow: -1,
    _lastRender: -1,
    _parity: 0,
  };

  // Write DPR to the renderer: setPixelRatio + setSize (no render, R#3).
  function applyDpr() {
    q.dpr = Math.min(deviceDpr(), rungDpr(q.rung, touch));
    if (!renderer) return;
    if (Math.abs(renderer.getPixelRatio() - q.dpr) < 1e-6) return;
    renderer.setPixelRatio(q.dpr);
    if (canvas) {
      const w = canvas.clientWidth || (renderer.domElement && renderer.domElement.width / q.dpr) || 1;
      const h = canvas.clientHeight || (renderer.domElement && renderer.domElement.height / q.dpr) || 1;
      renderer.setSize(w, h, false);
    }
  }

  function record(from, to, reason) {
    const t = hasWindow && window.performance ? window.performance.now() / 1000 : monitor.clock / 1000;
    q.history.push({ t, from, to, reason });
  }

  function syncFromMonitor(decision) {
    if (decision === DECISION.NONE) return;
    if (decision === DECISION.RETARGET) {
      record(q.rung, q.rung, 'cadence');
      q.target = monitor.target;
      return;
    }
    if (decision === DECISION.HALF_RATE) {
      q.halfRate = true;
      record(q.rung, q.rung, 'halfRate');
      q.locked = monitor.locked;
      return;
    }
    const from = q.rung;
    q.rung = monitor.rung;
    q.locked = monitor.locked;
    record(from, q.rung, decision === DECISION.DEMOTE ? 'demote' : 'promote');
    applyDpr();
    const newTier = tierOfRung(q.rung);
    q.pendingTier = newTier !== q.tier ? newTier : null;
  }

  /**
   * Should this rAF render? Caps 120 Hz panels at 60 fps (`now − lastRender ≥ 16.67 − 1.5`) and implements 30 Hz
   * mode (every 2nd rAF). Pure query: does not advance state.
   */
  function shouldRender(now) {
    if (q.halfRate) return (q._parity & 1) === 0;
    if (q.cadence < 12 && q._lastRender >= 0) return now - q._lastRender >= TARGET_60 - 1.5;
    return true;
  }

  /**
   * Once per rAF (main.js). Returns true when this rAF should render. Intervals between rendered frames are
   * judged when `gate.judged` (WP9 decides: state ∈ {CHECK, LIVE, DEAD}, not paused, no menu/overlay/intro/replay,
   * document visible). `gate.busyMs` = end of hud.update − start of the rAF callback (previous frame).
   */
  function frame(now, gate) {
    const render = shouldRender(now);
    q._parity++;
    if (!render) return false;
    if (q._lastRender >= 0) syncFromMonitor(monitor.judge(now - q._lastRender, gate));
    q._lastRender = now;
    q._lastNow = now;
    q.auto = monitor.auto;
    return true;
  }

  /** Set the probed cadence (median rAF interval, ms) → target (§7.3). */
  function setCadence(medianMs) {
    q.cadence = medianMs;
    q.target = cadenceTarget(medianMs);
    monitor.target = q.target;
  }

  /** Probe 30 rAF intervals (during the loading screen, before WebGL rendering) → Promise<median ms>. */
  function probeCadence(raf) {
    const rf = raf || (hasWindow && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null);
    if (!rf) { setCadence(TARGET_60); return Promise.resolve(TARGET_60); }
    return new Promise((resolve) => {
      const iv = new Float64Array(30);
      let n = -1, last = 0;
      const tick = (t) => {
        if (n >= 0) iv[n] = t - last;
        last = t;
        n++;
        if (n < 30) { rf(tick); return; }
        const sorted = Array.from(iv).sort((x, y) => x - y);
        const med = 0.5 * (sorted[14] + sorted[15]);
        setCadence(med);
        resolve(med);
      };
      rf(tick);
    });
  }

  /**
   * Apply a pending tier change (call at the start of CHECK, before `renderer.compile`). Fires onTierChange
   * listeners with (newTier, oldTier). Returns the new tier or null.
   */
  function commitPendingTier() {
    if (!q.pendingTier || q.pendingTier === q.tier) { q.pendingTier = null; return null; }
    const old = q.tier;
    q.tier = q.pendingTier;
    q.pendingTier = null;
    for (let i = 0; i < listeners.length; i++) {
      try { listeners[i](q.tier, old); } catch (err) { if (typeof console !== 'undefined') console.warn('onTierChange listener failed', err); }
    }
    return q.tier;
  }

  /**
   * Settings choice: 'auto' | 'low' | 'medium' | 'high'. A manual tier forces its top rung and disables auto; the
   * tier part is applied at the next CHECK (pendingTier). Returns { reloadNote } (texture sizes change next launch).
   */
  function setManual(choice) {
    const from = q.rung;
    if (choice === 'low' || choice === 'medium' || choice === 'high') {
      monitor.auto = false;
      monitor.rung = TOP_RUNG[choice];
      monitor.capRung = TOP_RUNG[choice];
      monitor.halfRate = false;
      q.halfRate = false;
    } else {
      monitor.auto = true;
      monitor.locked = false;
      monitor.changes = 0;
      monitor.promotions = 0;
      monitor.demotedFrom = 0;
      monitor.rung = st.startRung;
      monitor.capRung = st.capRung;
    }
    q.auto = monitor.auto;
    q.capRung = monitor.capRung;
    q.rung = monitor.rung;
    monitor.clearWindow();
    if (from !== q.rung) record(from, q.rung, 'manual');
    applyDpr();
    const newTier = tierOfRung(q.rung);
    q.pendingTier = newTier !== q.tier ? newTier : null;
    return { reloadNote: newTier !== q.loadTier };
  }

  // Window events clear the judging window (resize, orientation change, tab return).
  if (hasWindow && typeof window.addEventListener === 'function') {
    const clear = () => monitor.clearWindow();
    window.addEventListener('resize', clear);
    window.addEventListener('orientationchange', clear);
    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', clear);
    }
  }

  // Boot configuration of the renderer: DPR of the start rung and the shadow-map switch of the start tier.
  if (renderer) {
    renderer.shadowMap.enabled = TIERS[q.tier].shadows.map;
    applyDpr();
  }
  return q;
}
