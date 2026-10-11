/**
 * @module legends/library
 * Loads the baked legends (spec v2 §3.1–§3.3, §6.6, [CHR §1.3]) and creates `Character`s.
 *
 *   loadLegends({ tier, onProgress, renderer, scene?, camera?, touch?, allowDev?, baseUrl?, prebuild? }) → Promise<Library>
 *   Library: ids, header, tier, meta(id), createCharacter(id, { kit: { mode }, lodMode }) → Promise<Character>,
 *            beginFrame(camera, viewportHeightPx), dispose(), perf, settings, warm(scene, camera)
 *   LegendsLoadError (file, reason: HTTP status | 'timeout' | 'parse' | 'size' | 'webgl1' | 'decode')
 *   CHAR_TIERS (character settings per tier, §7.4)
 *
 * Load order and progress (library fraction → global loader §3.3): header 0.03 → shared bin 0.25 → 6 player bins
 * 0.30 → 15 PNGs fetched + decoded to v-up Uint8Array planes 0.12 (= 0.70) → 6 skins painted in ≤ 8 ms slices with
 * MessageChannel yields 0.20 (= 0.90) → six characters built with classic kits 0.05 (= 0.95) → `renderer.compile`
 * of all six (invisible) + texture upload 0.05 (= 1.00). Each fetch: 20 s timeout (AbortController), 2 retries after
 * 500 / 1,500 ms, ≤ 6 concurrent; every bin's byteLength must equal its header entry. Failure or WebGL1 rejects
 * with a LegendsLoadError (the caller falls back to simplified mode). No localStorage.
 *
 * PNG decode: createImageBitmap(blob, {premultiplyAlpha:'none', colorSpaceConversion:'none'}) → plain
 * createImageBitmap(blob) → new Image() + decode() (object URL revoked); one scratch canvas (willReadFrequently)
 * sized to the largest PNG, shrunk to 1 × 1 after the last read. Mask planes are dropped once the skins are painted.
 *
 * The six characters built during loading (classic kits, invisible, in a private scene) are handed out by the first
 * `createCharacter(id)` per id (re-kitted when another mode is asked for); later calls build new ones.
 */
import * as THREE from '../../vendor/three.module.js';
import { parseHeader, decodeShared, decodePlayer, morphKeptDelta, keptToRender, CUT_KEYS } from './format.js';
import { splitPlanes, SkinPaintJob, clearcoatData, skinTexture } from './skinPainter.js';
import { paintKit, readKit } from './kitPainter.js';
import { paintStrandTexture, strandTexture } from './groom.js';
import { paintEyeTexture, makePoreNormalMap, makeMeshNormalMap } from './materials.js';
import { coveredLodIndex } from './shells.js';
import { Character } from './character.js';
import { legend as legendData } from '../legends.js';
import { trackTexture } from '../render/quality.js';

/** Character settings per tier (§7.4 / §3.10). LOD clamps [finest, coarsest] in play and in menus. */
export const CHAR_TIERS = Object.freeze({
  low: Object.freeze({ skin: 512, skinTouch: 512, kit: 512, strand: 256, eye: 128, aniso: 1, morphs: false, lashes: false,
    groomOuter: false, groomLod1: true, mouthguard: false, play: [3, 3], menu: [2, 2] }),
  medium: Object.freeze({ skin: 1024, skinTouch: 1024, kit: 1024, strand: 512, eye: 256, aniso: 2, morphs: true, lashes: true,
    groomOuter: true, groomLod1: false, mouthguard: false, play: [1, 2], menu: [0, 1] }),
  high: Object.freeze({ skin: 2048, skinTouch: 1024, kit: 1024, strand: 1024, eye: 512, aniso: 4, morphs: true, lashes: true,
    groomOuter: true, groomLod1: false, mouthguard: true, play: [0, 1], menu: [0, 0] }),
});

const W = Object.freeze({ header: 0.03, shared: 0.25, players: 0.30, png: 0.12, skins: 0.20, kits: 0.05, compile: 0.05 });
const FETCH_TIMEOUT_MS = 20000;
const RETRY_MS = [500, 1500];
const MAX_CONCURRENT = 6;

/** Load failure with the failing file and a short reason (for the §6.6 error panel). */
export class LegendsLoadError extends Error {
  constructor(file, reason, cause) {
    super(`legends: ${file} (${reason})`);
    this.name = 'LegendsLoadError';
    this.file = file;
    this.reason = reason;
    if (cause) this.cause = cause;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Yield to the event loop through a MessageChannel post (not setTimeout(0), which iOS clamps after nesting). */
const yieldNow = (() => {
  if (typeof MessageChannel === 'undefined') return () => new Promise((r) => setTimeout(r, 0));
  let ch = null;
  const q = [];
  return () => new Promise((resolve) => {
    if (!ch) { ch = new MessageChannel(); ch.port1.onmessage = () => { const f = q.shift(); if (f) f(); }; }
    q.push(resolve);
    ch.port2.postMessage(0);
  });
})();

/** Canvas factory (DOM canvas, or OffscreenCanvas in a worker-like context). */
export function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('legends: no canvas available');
}

/**
 * fetch with timeout, retries and per-file byte progress.
 * @param {URL} url  @param {string} file  @param {'json'|'buffer'|'blob'} kind  @param {function(number)} onBytes
 */
async function fetchFile(url, file, kind, onBytes) {
  let lastErr = null;
  for (let attempt = 0; attempt <= RETRY_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_MS[attempt - 1]);
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; if (ac) ac.abort(); }, FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, ac ? { signal: ac.signal } : undefined);
      if (!res.ok) throw new LegendsLoadError(file, `HTTP ${res.status}`);
      // Whole-body reads: a ReadableStream reader made headless Chromium report fully read responses as
      // net::ERR_ABORTED now and then (B1 counts failed requests); progress therefore advances per file.
      const buf = await res.arrayBuffer();
      onBytes(buf.byteLength);
      clearTimeout(timer);
      if (kind === 'json') {
        try { return JSON.parse(new TextDecoder().decode(new Uint8Array(buf))); } catch (e) { throw new LegendsLoadError(file, 'parse', e); }
      }
      if (kind === 'blob') return new Blob([buf], { type: 'image/png' });
      return buf;
    } catch (e) {
      clearTimeout(timer);
      lastErr = timedOut ? new LegendsLoadError(file, 'timeout', e) : (e instanceof LegendsLoadError ? e : new LegendsLoadError(file, 'network', e));
      if (lastErr.reason === 'parse' || lastErr.reason === 'size') break;
      if (attempt < RETRY_MS.length && typeof console !== 'undefined') console.warn(`[legends] ${file}: ${lastErr.reason}, retrying`);
    }
  }
  throw lastErr;
}

/** Runs async jobs with at most `n` in flight. */
async function pool(jobs, n) {
  let next = 0;
  const results = new Array(jobs.length);
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return results;
}

/** PNG blob → {w, h, data: RGBA bytes} through the shared scratch canvas (§3.3 decode fallbacks). */
async function decodePng(blob, scratch, file) {
  let src = null, bmp = null, url = null;
  try {
    if (typeof createImageBitmap === 'function') {
      try { bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); } catch (e) { bmp = await createImageBitmap(blob); }
      src = bmp;
    }
  } catch (e) { bmp = null; src = null; }
  if (!src) {
    if (typeof Image === 'undefined' || typeof URL === 'undefined') throw new LegendsLoadError(file, 'decode');
    url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new LegendsLoadError(file, 'decode', e); }
    src = img;
  }
  const w = src.width, h = src.height;
  if (scratch.canvas.width < w || scratch.canvas.height < h) { scratch.canvas.width = Math.max(scratch.canvas.width, w); scratch.canvas.height = Math.max(scratch.canvas.height, h); }
  const g = scratch.ctx;
  g.globalCompositeOperation = 'copy';
  g.drawImage(src, 0, 0);
  const data = g.getImageData(0, 0, w, h).data;
  if (bmp && bmp.close) bmp.close();
  if (url) URL.revokeObjectURL(url);
  return { w, h, data };
}

/**
 * The loaded legends.
 */
export class Library {
  constructor(header, shared, tier, opts) {
    this.header = header;
    this.shared = shared;
    this.tier = tier;
    this.settings = CHAR_TIERS[tier];
    this.touch = !!opts.touch;
    this.ids = header.players.map((p) => p.id);
    this.renderer = opts.renderer || null;
    this.players = new Map();                 // id → per-player assets (see _assets)
    this.textures = {};                       // strand, eye, pore, mesh (shared by every character)
    this.frustum = new THREE.Frustum();
    this.cam = { valid: false, ortho: false, e: new Float32Array(16), pxPerM1: 0, orthoPxPerM: 0 };
    this.perf = { fetchMs: 0, decodeMs: 0, skinMs: 0, kitMs: 0, uploadMs: 0, compileMs: 0 };
    this.prebuilt = new Map();                // id → Character built during loading, not handed out yet
    this.scene = new THREE.Scene();           // private holding scene for the prebuilt characters
    this.characters = new Set();
    this._kitCanvas = null;
    this._m = new THREE.Matrix4();
    this.disposed = false;
  }

  /** Skin texture size of this load (§3.5.1: high = 2048 desktop / 1024 touch). */
  get skinSize() { return this.touch ? this.settings.skinTouch : this.settings.skin; }

  /** Header player record + names/stats meta + dims for `id`. */
  meta(id) {
    const a = this._assets(id);
    return Object.assign({ id, index: a.index, dims: a.info.dims, height: a.info.height }, a.info.meta);
  }

  /** Per-player cached CPU data (decoded positions, render expansions, morphs, index caches). */
  _assets(id) {
    const a = this.players.get(id);
    if (!a) throw new Error(`legends: unknown player ${id}`);
    return a;
  }

  /** Render-vertex positions / normals and morph arrays of a player (expanded once, cached). */
  _render(a) {
    if (a.render) return a.render;
    const S = this.shared, nK = S.nKept, nR = S.nRender;
    const position = keptToRender(a.data.kept, S.renderToKept, 3);
    const normal = keptToRender(a.data.keptN, S.renderToKept, 3);
    const keptDeltas = new Array(9).fill(null), morph = new Array(9).fill(null);
    if (this.settings.morphs) {
      for (const t of a.data.morphs) {
        const kd = morphKeptDelta(t, nK);
        keptDeltas[t.channel] = kd;
        morph[t.channel] = keptToRender(kd, S.renderToKept, 3);
      }
    }
    a.render = { position, normal, keptDeltas, morph, nR };
    return a.render;
  }

  /** Render-vertex expansions shared by every body: skin indices / weights (u8) and linear wet vertex colours. */
  _sharedRender() {
    if (this._sr) return this._sr;
    const S = this.shared, nR = S.nRender, r2k = S.renderToKept;
    const skinIndex = keptToRender(S.skinIndex, r2k, 4, new Uint8Array(nR * 4));
    const skinWeight = keptToRender(S.skinWeight, r2k, 4, new Uint8Array(nR * 4));
    const color = new Float32Array(nR * 3);
    const lin = new Float32Array(256);
    // vertex colours are sRGB bytes → linear (exact sRGB EOTF)
    for (let i = 0; i < 256; i++) { const c = i / 255; lin[i] = c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4); }
    for (let i = 0; i < nR * 3; i++) color[i] = lin[S.color[i]];
    this._sr = { skinIndex, skinWeight, color };
    return this._sr;
  }

  /** Shared all-zero Float32Array (3 per vertex) for morph channels a player has no target for. */
  _zeroMorph(n) {
    const len = (n || this.shared.nRender) * 3;
    if (!this._zeros) this._zeros = new Map();
    let z = this._zeros.get(len);
    if (!z) { z = new Float32Array(len); this._zeros.set(len, z); }
    return z;
  }

  /** Concatenated LOD indices without the covered triangles, cached per (player, cover key). */
  _bodyIndex(a, coverKey, coverLists) {
    let e = a.indexCache.get(coverKey);
    if (!e) {
      const covered = new Uint8Array(this.shared.nKept);
      for (const list of coverLists) for (let i = 0; i < list.length; i++) covered[list[i]] = 1;
      e = coveredLodIndex(this.shared, covered);
      a.indexCache.set(coverKey, e);
    }
    return e;
  }

  /** Skin texture of a player, ref-counted: GPU memory is released with the last character (CPU data kept). */
  _acquireSkin(a) {
    if (a.skinRefs++ === 0) {
      trackTexture(a.skinTex, 4, true);
      if (a.ccTex) trackTexture(a.ccTex, 4, true);
    }
    return a.skinTex;
  }

  _releaseSkin(a) {
    if (--a.skinRefs === 0) {
      a.skinTex.dispose();
      if (a.ccTex) a.ccTex.dispose();
    }
  }

  /** Two kit canvases (albedo, roughness) of size S, created on demand and shrunk after each use (iOS memory). */
  _kitCanvases(S) {
    if (!this._kitCanvas) {
      const c0 = makeCanvas(S, S), c1 = makeCanvas(S, S);
      this._kitCanvas = { c0, c1, ctx: c0.getContext('2d', { willReadFrequently: true }), rctx: c1.getContext('2d', { willReadFrequently: true }) };
    }
    const k = this._kitCanvas;
    if (k.c0.width !== S) { k.c0.width = k.c0.height = S; k.c1.width = k.c1.height = S; }
    return k;
  }

  /** Paints a kit job into `out` (RGBA, DataTexture order). */
  _paintKit(job, S, out) {
    const k = this._kitCanvases(S);
    paintKit(k.ctx, k.rctx, job, S);
    readKit(k.ctx, k.rctx, S, out);
    if (!this._holdKitCanvas) { k.c0.width = k.c0.height = 1; k.c1.width = k.c1.height = 1; }
    return out;
  }

  /**
   * Creates (or hands out the prebuilt) character of `id`.
   * @param {string} id
   * @param {{kit?: {mode: 'classic'|'allstarA'|'allstarB'|'grey'}, lodMode?: 'auto'|'menu'}} [opts]
   * @returns {Promise<Character>}
   */
  async createCharacter(id, opts) {
    if (this.disposed) throw new Error('legends: library disposed');
    const o = opts || {};
    const mode = (o.kit && o.kit.mode) || 'classic';
    let c = this.prebuilt.get(id);
    if (c) {
      this.prebuilt.delete(id);
      if (c.kitMode !== mode) c.setKit({ mode });
    } else {
      c = new Character(this, id, { kit: { mode } });
      this.characters.add(c);
    }
    c.lodMode = o.lodMode || 'auto';
    if (c.object.parent === this.scene) this.scene.remove(c.object);
    c.object.visible = true;
    c.visible = true;
    return c;
  }

  /**
   * Once per frame before `c.update()`: frustum and px-per-metre of the camera (zero allocation).
   * @param {THREE.Camera} camera  (matrices current)
   * @param {number} viewportHeightPx  device pixels of the viewport height
   */
  beginFrame(camera, viewportHeightPx) {
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);
    const c = this.cam;
    c.e.set(camera.matrixWorldInverse.elements);
    if (camera.isPerspectiveCamera) {
      c.ortho = false;
      // hpx = h · vpH / (2·d·tan(fov/2)): store vpH / (2·tan(fov/2)) and divide by the view depth later
      c.pxPerM1 = viewportHeightPx / (2 * Math.tan(camera.fov * Math.PI / 360) / (camera.zoom || 1));
    } else {
      c.ortho = true;
      c.orthoPxPerM = viewportHeightPx * (camera.zoom || 1) / Math.max(1e-6, camera.top - camera.bottom);
    }
    c.valid = true;
  }

  /** Compiles every character program for `scene` (lights) and uploads the textures (also done during loading). */
  warm(scene, camera) {
    if (!this.renderer) return;
    const t0 = now();
    const cam = camera || new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    for (const c of this.prebuilt.values()) c.object.visible = false;
    this.renderer.compile(this.scene, cam, scene || this.scene);
    this.perf.compileMs += now() - t0;
    const t1 = now();
    const tex = new Set(Object.values(this.textures));
    for (const a of this.players.values()) { tex.add(a.skinTex); if (a.ccTex) tex.add(a.ccTex); }
    for (const c of this.prebuilt.values()) tex.add(c.kitTexture);
    for (const t of tex) if (t) this.renderer.initTexture(t);
    this.perf.uploadMs += now() - t1;
  }

  /** Disposes prebuilt characters still held, the shared textures, and drops every cached array. */
  dispose() {
    if (this.disposed) return;
    for (const c of this.prebuilt.values()) c.dispose();
    this.prebuilt.clear();
    for (const t of Object.values(this.textures)) if (t) t.dispose();
    for (const a of this.players.values()) {
      if (a.skinRefs > 0) { a.skinTex.dispose(); if (a.ccTex) a.ccTex.dispose(); }
      a.skinTex = null; a.ccTex = null; a.data = null; a.render = null; a.indexCache.clear();
    }
    this.players.clear();
    this.shared = null;
    if (this._kitCanvas) { this._kitCanvas.c0.width = this._kitCanvas.c1.width = 1; this._kitCanvas = null; }
    this.disposed = true;
  }
}

/**
 * Loads the legends.
 * @param {{tier?: 'low'|'medium'|'high', onProgress?: function(number), renderer?: THREE.WebGLRenderer, scene?: THREE.Scene,
 *   camera?: THREE.Camera, touch?: boolean, allowDev?: boolean, baseUrl?: URL|string, prebuild?: boolean}} [opts]
 * @returns {Promise<Library>}
 */
export async function loadLegends(opts) {
  const o = opts || {};
  const tier = o.tier === 'low' || o.tier === 'high' ? o.tier : 'medium';
  const renderer = o.renderer || null;
  if (renderer) {
    const gl = renderer.getContext ? renderer.getContext() : null;
    const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (!isGL2 || (renderer.capabilities && renderer.capabilities.isWebGL2 === false)) throw new LegendsLoadError('webgl', 'webgl1');
  }
  const touch = o.touch != null ? !!o.touch
    : (typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0)) || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
  const base = o.baseUrl ? new URL(o.baseUrl, import.meta.url) : new URL('../../assets/legends/', import.meta.url);
  let frac = 0;
  const report = (f) => { frac = Math.max(frac, Math.min(1, f)); if (o.onProgress) { try { o.onProgress(frac); } catch (e) { /* UI errors never break loading */ } } };
  const t0 = now();

  // ---- header + shared bin ----
  const headerJson = await fetchFile(new URL('legends.json', base), 'legends.json', 'json', () => {});
  let header;
  try { header = parseHeader(headerJson, { allowDev: !!o.allowDev }); } catch (e) { throw new LegendsLoadError('legends.json', 'parse', e); }
  report(W.header);
  const sharedBytes = header.shared.bytes;
  const sharedBuf = await fetchFile(new URL(header.shared.file, base), header.shared.file, 'buffer', (b) => report(W.header + W.shared * b / sharedBytes));
  if (sharedBuf.byteLength !== sharedBytes) throw new LegendsLoadError(header.shared.file, 'size');
  let shared;
  try { shared = decodeShared(sharedBuf, header); } catch (e) { throw new LegendsLoadError(header.shared.file, 'parse', e); }
  report(W.header + W.shared);

  // ---- 6 player bins + 15 PNGs (≤ 6 in flight) ----
  const lib = new Library(header, shared, tier, { touch, renderer });
  const binTotal = header.players.reduce((s, p) => s + p.bytes, 0);
  const binGot = new Map();
  const binProgress = () => { let s = 0; for (const v of binGot.values()) s += v; return s / binTotal; };
  const pngFiles = [];
  for (const k of ['skin0', 'skin1', 'skin2']) pngFiles.push({ key: k, file: header.masks[k].file, owner: null });
  for (const p of header.players) for (const k of ['groom', 'extra']) pngFiles.push({ key: k, file: p.masks[k].file, owner: p.id });
  let pngDone = 0;
  const p0 = W.header + W.shared;
  const prog = () => report(p0 + W.players * binProgress() + W.png * pngDone / pngFiles.length);
  const scratchCanvas = makeCanvas(1024, 1024);
  const scratch = { canvas: scratchCanvas, ctx: scratchCanvas.getContext('2d', { willReadFrequently: true }) };
  let decodeChain = Promise.resolve();
  const sharedPlanes = {};
  const playerPlanes = new Map(header.players.map((p) => [p.id, {}]));
  const PLANE_NAMES = {
    skin0: ['lips', 'cavity', 'highlight'], skin1: ['redness', 'ao', 'mottle'], skin2: ['palms', 'nails', null],
    groom: ['hair', 'beard', 'brow'], extra: ['tattoo', 'gloss', 'sweat'],
  };
  let decodeMs = 0;
  const jobs = [];
  header.players.forEach((info, index) => {
    jobs.push(async () => {
      const buf = await fetchFile(new URL(info.file, base), info.file, 'buffer', (b) => { binGot.set(info.id, b); prog(); });
      if (buf.byteLength !== info.bytes) throw new LegendsLoadError(info.file, 'size');
      let data;
      try { data = decodePlayer(buf, info, shared); } catch (e) { throw new LegendsLoadError(info.file, 'parse', e); }
      lib.players.set(info.id, {
        id: info.id, index, info, data, legend: legendData(info.id), render: null, indexCache: new Map(),
        skinTex: null, skinData: null, ccTex: null, skinRefs: 0,
      });
      binGot.set(info.id, info.bytes);
      prog();
    });
  });
  for (const pf of pngFiles) {
    jobs.push(async () => {
      const blob = await fetchFile(new URL(pf.file, base), pf.file, 'blob', () => {});
      decodeChain = decodeChain.then(async () => {
        const td = now();
        const img = await decodePng(blob, scratch, pf.file);
        const target = pf.owner ? playerPlanes.get(pf.owner) : sharedPlanes;
        splitPlanes(img.data, img.w, img.h, 4, PLANE_NAMES[pf.key], target);
        decodeMs += now() - td;
        pngDone++;
        prog();
      });
      await decodeChain;
    });
  }
  await pool(jobs, MAX_CONCURRENT);
  await decodeChain;
  scratchCanvas.width = scratchCanvas.height = 1;
  lib.perf.fetchMs = now() - t0 - decodeMs;
  lib.perf.decodeMs = decodeMs;
  for (const id of lib.ids) if (!lib.players.has(id)) throw new LegendsLoadError(id, 'missing');
  report(0.70);

  // ---- shared procedural textures ----
  const st = lib.settings;
  lib.textures.strand = strandTexture(paintStrandTexture(st.strand, makeCanvas), st.strand);
  lib.textures.eye = paintEyeTexture(st.eye, tier, makeCanvas);
  if (tier !== 'low') { lib.textures.pore = makePoreNormalMap(256); lib.textures.mesh = makeMeshNormalMap(128); }
  for (const t of Object.values(lib.textures)) if (t) trackTexture(t, 4, true);
  await yieldNow();

  // ---- skins (sliced) ----
  const tSkin = now();
  const S = lib.skinSize;
  for (let i = 0; i < lib.ids.length; i++) {
    const a = lib._assets(lib.ids[i]);
    const planes = Object.assign({}, sharedPlanes, playerPlanes.get(a.id));
    const job = new SkinPaintJob(planes, a.legend.look, S, { alpha: tier !== 'low', seed: a.index });
    while (!job.run(now() + 8)) {
      report(0.70 + W.skins * (i + job.y / S) / lib.ids.length);
      await yieldNow();
    }
    a.skinData = job.out;
    a.skinTex = skinTexture(a.skinData, S, st.aniso);
    if (tier === 'high') {
      const cc = clearcoatData(planes, 256);
      const t = new THREE.DataTexture(cc, 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter; t.flipY = false; t.name = 'legends.clearcoat'; t.needsUpdate = true;
      a.ccTex = t;
    }
    report(0.70 + W.skins * (i + 1) / lib.ids.length);
    await yieldNow();
  }
  lib.perf.skinMs = now() - tSkin;
  for (const k of Object.keys(sharedPlanes)) delete sharedPlanes[k];
  playerPlanes.clear();                       // mask planes dropped (§3.3)

  // ---- characters with classic kits (prebuilt, invisible) ----
  const tKit = now();
  if (o.prebuild !== false) {
    lib._holdKitCanvas = true;
    for (let i = 0; i < lib.ids.length; i++) {
      const c = new Character(lib, lib.ids[i], { kit: { mode: 'classic' } });
      lib.characters.add(c);
      c.object.visible = false;
      c.visible = false;
      lib.scene.add(c.object);
      lib.prebuilt.set(c.id, c);
      report(0.90 + W.kits * (i + 1) / lib.ids.length);
      await yieldNow();
    }
    lib._holdKitCanvas = false;
    if (lib._kitCanvas) { lib._kitCanvas.c0.width = lib._kitCanvas.c0.height = 1; lib._kitCanvas.c1.width = lib._kitCanvas.c1.height = 1; }
  }
  lib.perf.kitMs = now() - tKit;

  // ---- compile + upload ----
  if (renderer) lib.warm(o.scene || null, o.camera || null);
  report(1);
  return lib;
}

export { CUT_KEYS };
