/**
 * @module main
 * Boot and frame loop of LEGENDS 3v3 (spec v2 §1.3, §5.12.6, §5.15, §6.6, §7). Side-effect module: boot() runs at
 * import.
 *
 * Boot: URL params (seed, q, auto, lang, debug, quality, quick, intro, replay, showcase, anim, aa, lineup, user, kits,
 * bot, diff, clear, autoswitch) → `?showcase=1` → showcase.js; `?anim=` → anim/viewer.js; otherwise i18n → settings →
 * renderer (WebGL2; none → the no-WebGL overlay, H12) → quality (static detection, start rung) → scene, lights,
 * director, audio, input, UI → loading phases (§6.6) run concurrently and time-sliced: legends assets + skin / kit
 * painting (library.js), arena build (one build call per slice), clip library compile (≤ 8 ms slices, the six legends
 * only, never a long task) → characters, Game (`anim: 'real'`), Flow → environment + `renderer.compile` + 2 warm frames
 * → title. Any asset failure → `#loadError` (Retry / Simple mode); simplified mode = v1 primitive humanoids (`anim: 'proxy'`).
 *
 * Frame (§1.3): quality.frame → fixed steps (input.sample, test bot, game.step, flow.fixedStep) → flow.frame
 * (animation / replay, recorder, ball, director, characters, lights, crowd, arena, net, fx, reflection) → render →
 * hud.update → audio.update. `window.__game` = makeDebugHooks(game) + the presentation hooks (§5.15).
 */
import * as THREE from '../vendor/three.module.js';
import { FIXED_DT, CLOCK } from './constants.js';
import { setLang, getLang, applyDom, toggleLang, t } from './i18n.js';
import { LEGENDS, LEGEND_IDS } from './legends.js';
import { lineupFromQuery, resolveKitModes } from './lineup.js';
import { Game, makeDebugHooks } from './game.js';
import * as AI from './ai.js';
import { TestBot } from './testbot.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { createRenderer, resizeRenderer, frameStats } from './render/renderer.js';
import { detectStatic, createQuality, texMB, TIERS, parseAaParam } from './render/quality.js';
import { createLights, createShadowProxy } from './render/lighting.js';
import { buildArenaEnv } from './render/envmap.js';
import { buildFloor, buildCentreDecal, BackcourtStripe, markingStrings } from './render/floor.js';
import { PlanarReflection } from './render/reflection.js';
import { buildHoop } from './render/hoop.js';
import { buildArena } from './render/arena.js';
import { buildCrowd } from './render/crowd.js';
import { BallVisual } from './render/ballvis.js';
import { BlobShadows } from './render/shadows.js';
import { createFx } from './render/fx.js';
import { Director } from './cam/director.js';
import { ReplayRecorder, ReplayTriggers, ReplayPlayer } from './cam/replay.js';
import { loadLegends } from './legends/library.js';
import { registerClipLibrary, registerClipLibrarySteps } from './anim/clips/common.js';
import { clipCount, getClip, getDef } from './anim/clip.js';
import { Loader } from './ui/loading.js';
import { Screens } from './ui/screens.js';
import { HUD } from './ui/hud.js';
import { Presenter, MatchView } from './ui/present.js';
import { Settings } from './ui/settings.js';
import { createHumanoid } from './humanoid.js';
import { Flow } from './flow.js';
import { runShowcase } from './showcase.js';
import { runViewer } from './anim/viewer.js';
import { Rng } from './math.js';

const ORIENTATION_RETRIES = [120, 400];
const MAX_STEPS = 15;
const SLICE_MS = 8;
const PERF_INTERVAL_MS = 500;
const GATE = { judged: false, busyMs: 0 };      // quality judging gate (scratch, no per-frame allocation)

// ------------------------------------------------------------------------------------------------ helpers
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Yield to the event loop (MessageChannel; not setTimeout(0), which browsers clamp). */
const yieldNow = (() => {
  let ch = null;
  const q = [];
  return () => new Promise((resolve) => {
    if (typeof MessageChannel === 'undefined') { setTimeout(resolve, 0); return; }
    if (!ch) { ch = new MessageChannel(); ch.port1.onmessage = () => { const f = q.shift(); if (f) f(); }; }
    q.push(resolve);
    ch.port2.postMessage(0);
  });
})();

function parseParams() {
  const out = {
    seed: (Date.now() & 0x7fffffff) | 0, q: 0, auto: false, lang: '', debug: false, quick: false, showcase: false, anim: null,
    bot: null, lineupFromUrl: false, search: '',
  };
  let sp = null;
  try { out.search = window.location.search || ''; sp = new URLSearchParams(out.search); } catch (err) { return out; }
  const seed = parseInt(sp.get('seed'), 10);
  if (Number.isFinite(seed)) out.seed = seed | 0;
  const q = parseFloat(sp.get('q'));
  if (Number.isFinite(q) && q > 0) out.q = q * 60;
  const on = (k) => { const v = sp.get(k); return v === '1' || v === 'true'; };
  out.auto = on('auto');
  out.debug = on('debug');
  out.quick = on('quick');
  out.showcase = on('showcase');
  out.anim = sp.get('anim');
  const lang = sp.get('lang');
  if (lang === 'zh' || lang === 'en') out.lang = lang;
  const bot = sp.get('bot');
  if (bot) out.bot = bot;
  out.lineupFromUrl = sp.has('lineup') || sp.has('user') || sp.has('kits');
  out.sp = sp;
  return out;
}

function appSize() {
  const app = document.getElementById('app');
  let w = app ? app.clientWidth : 0, h = app ? app.clientHeight : 0;
  if (!(w > 0) || !(h > 0)) { w = window.innerWidth; h = window.innerHeight; }
  return { w: Math.max(1, w | 0), h: Math.max(1, h | 0) };
}

/** Simplified-mode colours of a legend in a kit mode (§2.7 base / number, §2.6 skin). */
function humanoidColours(id, mode) {
  const L = LEGENDS[id];
  let jersey = '#6F263D', trim = '#ffffff';
  if (mode === 'allstarA' || mode === 'allstarB') {
    jersey = mode === 'allstarA' ? '#F4F4F1' : '#121212';
    trim = mode === 'allstarA' ? '#C9A227' : '#D22630';
  } else if (L && L.kit && L.kit[L.kit.classic]) {
    jersey = L.kit[L.kit.classic].base; trim = L.kit[L.kit.classic].number;
  }
  return { jersey, trim, skin: L && L.look ? L.look.skin : '#8d5524' };
}

// ------------------------------------------------------------------------------------------------ no-WebGL2 fallback
/** Any property / call / arithmetic-free use returns itself: stands in for the WebGL presentation sinks (flat mode). */
const NOOP = new Proxy(function noop() {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === 'visible' ? false : NOOP), apply: () => NOOP, set: () => true });

const COURT_LINES = (() => {
  const L = [];
  const seg = (pts) => L.push(pts);
  const W = 7.62, BZ = -14.325, KW = 2.44, FTZ = -8.535, RX = 0, RZ = -12.75, R3 = 7.24, CORNER = 6.6;
  seg([[-W, BZ], [W, BZ], [W, 0], [-W, 0], [-W, BZ]]);
  seg([[-KW, BZ], [-KW, FTZ], [KW, FTZ], [KW, BZ]]);
  const ft = []; for (let i = 0; i <= 16; i++) { const a = Math.PI * i / 16; ft.push([1.8 * Math.cos(a), FTZ + 1.8 * Math.sin(a)]); } seg(ft);
  const zc = RZ + Math.sqrt(R3 * R3 - CORNER * CORNER);
  const arc = [[-CORNER, BZ], [-CORNER, zc]];
  const a0 = Math.atan2(zc - RZ, -CORNER - RX), a1 = Math.atan2(zc - RZ, CORNER - RX);
  for (let i = 1; i < 32; i++) { const a = a0 + (a1 - a0) * i / 32; arc.push([RX + R3 * Math.cos(a), RZ + R3 * Math.sin(a)]); }
  arc.push([CORNER, zc], [CORNER, BZ]);
  seg(arc);
  const cc = []; for (let i = 0; i <= 24; i++) { const a = Math.PI + Math.PI * i / 24; cc.push([1.83 * Math.cos(a), 1.83 * Math.sin(a) * -1]); } seg(cc);
  return L;
})();

/** True when a WebGL2 context can be created (probed on a scratch canvas, released at once). */
function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch (e) { return false; }
}

/**
 * Simplified mode without WebGL2 (H12 "never a dead page"; three r186 needs WebGL2): the broadcast camera's view
 * drawn on a 2D canvas — court lines, hoop, the six legends as kit-coloured figures, the ball. Same game, HUD, input
 * and flow; only the 3D presentation is replaced. Returns null when no 2D context is available either.
 */
function createFlatRenderer(canvas) {
  let ctx = null;
  try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
  if (!ctx) return null;
  const P = { x: 0, y: 0, z: 0 }, Q = { x: 0, y: 0, z: 0 };
  let W = 1, H = 1, dpr = 1;
  const proj = (director, x, y, z, out) => {
    director.ndc(out, x, y, z);
    if (!(out.z < 1)) return false;
    out.x = (out.x * 0.5 + 0.5) * W; out.y = (0.5 - out.y * 0.5) * H;
    return true;
  };
  const pxPerM = (director, x, y, z) => { if (!proj(director, x, y, z, P)) return 0; proj(director, x, y + 1, z, Q); return Math.abs(P.y - Q.y); };
  return {
    flat: true,
    setSize(w, h) { dpr = Math.min(2, window.devicePixelRatio || 1); W = Math.max(1, Math.round(w * dpr)); H = Math.max(1, Math.round(h * dpr)); canvas.width = W; canvas.height = H; },
    render(game, director, colours) {
      ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, W, H);
      // floor
      ctx.fillStyle = '#b98a52';
      ctx.beginPath();
      const fl = [[-9.6, -16.3], [9.6, -16.3], [9.6, 1.0], [-9.6, 1.0]];
      for (let i = 0; i < fl.length; i++) { proj(director, fl[i][0], 0, fl[i][1], P); if (i === 0) ctx.moveTo(P.x, P.y); else ctx.lineTo(P.x, P.y); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, 1.5 * dpr);
      for (const line of COURT_LINES) {
        ctx.beginPath();
        for (let i = 0; i < line.length; i++) { proj(director, line[i][0], 0, line[i][1], P); if (i === 0) ctx.moveTo(P.x, P.y); else ctx.lineTo(P.x, P.y); }
        ctx.stroke();
      }
      // backboard + rim
      ctx.strokeStyle = '#e8eef5'; ctx.lineWidth = 3 * dpr; ctx.beginPath();
      proj(director, -0.915, 2.9, -13.105, P); ctx.moveTo(P.x, P.y);
      for (const c of [[0.915, 2.9], [0.915, 3.97], [-0.915, 3.97], [-0.915, 2.9]]) { proj(director, c[0], c[1], -13.105, P); ctx.lineTo(P.x, P.y); }
      ctx.stroke();
      ctx.strokeStyle = '#ff6a1a'; ctx.beginPath();
      for (let i = 0; i <= 20; i++) { const a = 2 * Math.PI * i / 20; proj(director, 0.2286 * Math.cos(a), 3.048, -12.75 + 0.2286 * Math.sin(a), P); if (i === 0) ctx.moveTo(P.x, P.y); else ctx.lineTo(P.x, P.y); }
      ctx.stroke();
      // players, far to near
      const ps = game.players.slice().sort((a, b) => a.pos.z - b.pos.z);
      for (const p of ps) {
        const h = p.legend.stats.heightM, k = pxPerM(director, p.pos.x, p.jumpY, p.pos.z);
        if (!k) continue;
        const col = colours[p.id] || { jersey: '#888', skin: '#8d5524' };
        proj(director, p.pos.x, p.jumpY, p.pos.z, P);
        const fx = P.x, fy = P.y;
        proj(director, p.pos.x, p.jumpY + h - 0.12, p.pos.z, Q);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(fx, fy, 0.4 * k, 0.12 * k, 0, 0, 2 * Math.PI); ctx.fill();
        ctx.lineCap = 'round';
        ctx.strokeStyle = col.skin; ctx.lineWidth = 0.16 * k;
        ctx.beginPath(); ctx.moveTo(fx - 0.1 * k, fy); ctx.lineTo(fx - 0.08 * k, fy - 0.9 * k); ctx.moveTo(fx + 0.1 * k, fy); ctx.lineTo(fx + 0.08 * k, fy - 0.9 * k); ctx.stroke();
        ctx.fillStyle = col.jersey; ctx.fillRect(fx - 0.22 * k, Q.y + 0.18 * k, 0.44 * k, (fy - 0.85 * k) - (Q.y + 0.18 * k));
        ctx.fillStyle = col.skin; ctx.beginPath(); ctx.arc(Q.x, Q.y, 0.12 * k, 0, 2 * Math.PI); ctx.fill();
        if (game.world.controlled === p && !game.world.auto) { ctx.strokeStyle = '#ff7a1f'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.ellipse(fx, fy, 0.5 * k, 0.16 * k, 0, 0, 2 * Math.PI); ctx.stroke(); }
      }
      const b = game.ball;
      if (proj(director, b.pos.x, b.pos.y, b.pos.z, P)) {
        const k = pxPerM(director, b.pos.x, b.pos.y, b.pos.z);
        ctx.fillStyle = '#c4521c'; ctx.beginPath(); ctx.arc(P.x, P.y, Math.max(2, 0.12 * k), 0, 2 * Math.PI); ctx.fill();
      }
    },
  };
}

// ------------------------------------------------------------------------------------------------ alternate pages
async function bootShowcase() {
  document.getElementById('app').style.display = 'none';
  await runShowcase(document.body, { search: window.location.search });
}

async function bootViewer(params) {
  const app = document.getElementById('app');
  app.style.display = 'none';
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;background:#0b0d14';
  document.body.appendChild(root);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  root.appendChild(renderer.domElement);
  const lib = await loadLegends({ tier: 'high', renderer });
  registerClipLibrary();
  await compileClipsSliced(null, () => {});
  await runViewer(root, { library: lib, header: lib.header, params: params.search, renderer });
}

// ------------------------------------------------------------------------------------------------ clip library
/**
 * Compiles every clip the six legends can play (shared defs, per-legend generator output, both sides) in ≤ 8 ms slices
 * with a yield between slices (no long task; orchestrator decision 2). getClip caches, so later calls are lookups.
 */
async function compileClipsSliced(ids, onProgress) {
  const players = ids || LEGEND_IDS;
  const n = clipCount();
  let deadline = nowMs() + SLICE_MS;
  for (let i = 0; i < n; i++) {
    if (getDef(i, null) !== null) { getClip(i, null, false); getClip(i, null, true); }
    for (let k = 0; k < players.length; k++) {
      if (nowMs() > deadline) { onProgress(i / n); await yieldNow(); deadline = nowMs() + SLICE_MS; }
      if (getDef(i, players[k]) !== null) { getClip(i, players[k], false); getClip(i, players[k], true); }
    }
    if (nowMs() > deadline) { onProgress((i + 1) / n); await yieldNow(); deadline = nowMs() + SLICE_MS; }
  }
  onProgress(1);
}

// ================================================================================================== boot
function boot() {
  const params = parseParams();
  if (params.lang) setLang(params.lang); else setLang(getLang());
  applyDom(document);
  if (params.showcase) { bootShowcase().catch((e) => console.warn('[legends] showcase failed', e)); return; }
  if (params.anim) { bootViewer(params).catch((e) => console.warn('[legends] viewer failed', e)); return; }

  const settings = new Settings({ search: params.search });
  const match = new MatchView(LEGENDS);
  const loader = new Loader(document.getElementById('loading'));
  const screens = new Screens(document, { settings, match });
  const hud = new HUD(document, { match });
  const present = new Presenter(document, { match });
  const audio = new Audio({ seed: params.seed });
  audio.setMuted(!settings.get('sound'));
  audio.setCrowdVolume(settings.get('crowd'));
  const lineup = lineupFromQuery(params.sp || params.search);

  let resolveReady = null;
  const legendsReady = new Promise((r) => { resolveReady = r; });
  const bs = { ui: screens.ui, legendsReady, simplified: false, version: 'legends-3v3 v2', params, audio, settings, loading: true };
  window.__game = {
    version: 'legends-3v3 v2', legendsReady, params, audio, settings, legends: LEGENDS,
    get ui() { return screens.ui; }, get simplified() { return bs.simplified; }, get state() { return 'BOOT'; },
  };
  loader.phase('load.engine');
  loader.progress(0.02);

  // ---- renderer (WebGL2 required by three r186) ----
  const canvas = document.getElementById('gl');
  let renderer = null;
  let flatR = null;
  try {
    if (!hasWebGL2()) throw new Error('WebGL2 not available');   // probe first: three logs console.error on failure
    renderer = createRenderer(canvas, { aa: parseAaParam(params.search) });
  } catch (err) {
    console.warn('[legends] WebGL2 unavailable: simplified mode', err && err.message);
    bs.simplified = true;
    flatR = createFlatRenderer(canvas);
    if (!flatR) {
      loader.done();
      screens.overlay('nowebgl');
      present.toast('toast.webgl1', null, 4000);
      resolveReady(false);
      return;
    }
  }
  const st = detectStatic(renderer, navigator, { width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio }, params.search);
  const quality = createQuality({ renderer, settings, url: params.search, static: st });
  screens.setTier(quality.tier);
  const scene = new THREE.Scene();
  const size0 = appSize();
  const director = new Director({ width: size0.w, height: size0.h, cameraMode: settings.get('camera') });
  if (renderer) resizeRenderer(renderer, director.camera, size0.w, size0.h); else flatR.setSize(size0.w, size0.h);
  director.setSize(size0.w, size0.h);
  director.setMode('title', { transition: 'cut' });
  const lights = renderer ? createLights(scene, quality) : NOOP;

  let flow = null, game = null;
  const input = new Input(document, {
    onGesture: () => audio.unlock(),
    onPause: () => { if (flow) flow.togglePause(); },
    onMute: () => { audio.toggleMuted(); settings.notifyExternal('sound', !audio.muted); },
    onLang: () => toggleLang(),
  });
  screens.bind({ input });
  hud.bind({ game: null });

  const app = {
    params, settings, match, loader, screens, hud, present, audio, input, renderer, quality, scene, director, lights,
    lineup, simplified: false, lib: null, characters: null, humanoids: null, animators: null,
    viewportPx: () => (renderer ? renderer.domElement.height : canvas.height),
    lang: () => getLang(),
    recolour: () => {},
  };

  // ---- resize ----
  let resizeQueued = false;
  function resize() {
    resizeQueued = false;
    const { w, h } = appSize();
    if (renderer) resizeRenderer(renderer, director.camera, w, h); else flatR.setSize(w, h);
    director.setSize(w, h);
    hud.resize();
    if (flow && flow.screenMode === 'lineup') flow.onLineupSelect(flow.focusId);
  }
  // resize at once (the canvas must follow a rotation within 500 ms even when a slow frame delays rAF), then once more
  // on the next frame for viewports that settle late (iOS visualViewport after an orientation change)
  function queueResize() { resize(); if (!resizeQueued) { resizeQueued = true; requestAnimationFrame(resize); } }
  window.addEventListener('resize', queueResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', queueResize);
  window.addEventListener('orientationchange', () => { queueResize(); for (const ms of ORIENTATION_RETRIES) setTimeout(queueResize, ms); });

  // ---- loading progress (§6.5.3 weights; concurrent phases add up, never backwards) ----
  const prog = { assets: 0, paint: 0, kit: 0, arena: 0, clips: 0, shader: 0 };
  let labelStage = '';
  function report() {
    const f = 0.10 + 0.47 * prog.assets + 0.18 * prog.paint + 0.04 * prog.kit + 0.08 * prog.arena + 0.13 * (0.5 * prog.clips + 0.5 * prog.shader);
    loader.progress(Math.min(1, f));
    const stage = prog.assets < 1 ? 'load.assets' : prog.paint < 1 || prog.kit < 1 ? 'load.paint' : prog.arena < 1 ? 'load.arena' : 'load.compile';
    if (stage !== labelStage) { labelStage = stage; loader.phase(stage); }
  }

  // ---- arena (sliced: one build call per slice) ----
  const crowdRng = new Rng((params.seed ^ 0xC20D) | 0);
  const arenaParts = {};
  async function buildArenaSliced() {
    if (!renderer) {
      for (const k of ['floor', 'decal', 'stripe', 'hoop', 'arena', 'crowd', 'ballVis', 'blobs', 'fx']) arenaParts[k] = NOOP;
      prog.arena = 1; report();
      return;
    }
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const steps = [
      () => { arenaParts.floor = buildFloor(scene, quality, { maxAnisotropy: maxAniso }); },
      () => { arenaParts.decal = buildCentreDecal(scene, quality, { maxAnisotropy: maxAniso }); arenaParts.stripe = new BackcourtStripe(scene); },
      () => { arenaParts.hoop = buildHoop(scene, quality, { far: true, seed: params.seed }); },
      () => { arenaParts.arena = buildArena(scene, quality, crowdRng); },
      () => { arenaParts.crowd = buildCrowd(scene, quality, { user: '#6F263D', opp: '#CE1141' }, crowdRng); lights.setCrowd(arenaParts.crowd); },
      () => {
        arenaParts.ballVis = new BallVisual(scene, quality, { seed: params.seed, resolveHeld: (ball, out) => (flow ? flow.resolveHeld(ball, out) : false) });
        arenaParts.blobs = new BlobShadows(scene, quality.tier);
        arenaParts.fx = createFx(scene, quality, { crowd: arenaParts.crowd, rng: crowdRng });
      },
    ];
    for (let i = 0; i < steps.length; i++) {
      steps[i]();
      prog.arena = (i + 1) / steps.length; report();
      await yieldNow();
    }
  }

  // ---- legends ----
  async function loadCharacters() {
    const lib = await loadLegends({
      tier: quality.loadTier, renderer, scene, camera: director.camera, touch: quality.touch,
      onProgress: (f) => {
        prog.assets = Math.min(1, f / 0.70);
        prog.paint = f <= 0.70 ? 0 : Math.min(1, (f - 0.70) / 0.20);
        prog.kit = f <= 0.90 ? 0 : Math.min(1, (f - 0.90) / 0.05);
        prog.shader = f <= 0.95 ? 0 : Math.min(1, (f - 0.95) / 0.05) * 0.5;
        report();
      },
    });
    return lib;
  }

  const clipsDone = (async () => {
    await yieldNow();
    // registration and compile both in ≤ 8 ms slices (orchestrator decision 2: no long task)
    const it = registerClipLibrarySteps(LEGEND_IDS);
    let deadline = nowMs() + SLICE_MS;
    for (let r = it.next(); !r.done; r = it.next()) {
      if (nowMs() > deadline) { await yieldNow(); deadline = nowMs() + SLICE_MS; }
    }
    prog.clips = 0.1; report();
    await compileClipsSliced(LEGEND_IDS, (f) => { prog.clips = 0.1 + 0.9 * f; report(); });
  })();
  quality.probeCadence();

  function useRealCharacters(lib) {
    const characters = {};
    return Promise.all(LEGEND_IDS.map(async (id) => {
      const km = {};
      resolveKitModes(lineup, km);
      const mode = lineup.a.indexOf(id) >= 0 ? km.a : km.b;
      const c = await lib.createCharacter(id, { kit: { mode }, lodMode: 'menu' });
      scene.add(c.object);
      createShadowProxy(c);
      c.setReflectable(TIERS[quality.tier].floor.reflection);
      characters[id] = c;
    })).then(() => characters);
  }

  function useHumanoids() {
    const humanoids = {};
    const km = {};
    resolveKitModes(lineup, km);
    for (const id of LEGEND_IDS) {
      const mode = lineup.a.indexOf(id) >= 0 ? km.a : km.b;
      const h = createHumanoid(humanoidColours(id, mode));
      h.shadow.visible = false;            // BlobShadows draws the shadows
      scene.add(h.group);
      humanoids[id] = h;
    }
    app.recolour = (id, mode) => {
      const old = humanoids[id];
      const h = createHumanoid(humanoidColours(id, mode));
      h.shadow.visible = false;
      h.group.position.copy(old.group.position); h.group.rotation.y = old.group.rotation.y;
      scene.remove(old.group); scene.add(h.group);
      humanoids[id] = h;
    };
    return humanoids;
  }

  // ---- after loading: game, flow, hooks, title ----
  const flatColours = {};
  async function finish(lib, characters, humanoids) {
    if (!renderer) {
      const km = {}; resolveKitModes(lineup, km);
      for (const id of LEGEND_IDS) flatColours[id] = humanoidColours(id, lineup.a.indexOf(id) >= 0 ? km.a : km.b);
      app.recolour = (id, mode) => { flatColours[id] = humanoidColours(id, mode); };
    }
    app.simplified = !characters;
    bs.simplified = app.simplified;
    app.lib = lib; app.characters = characters; app.humanoids = humanoids;
    Object.assign(app, arenaParts);
    const diff = settings.get('difficulty');
    game = new Game({
      scene, anim: characters ? 'real' : 'proxy', characters, header: lib ? lib.header : null, input, ai: AI, seed: params.seed,
      lineup, difficulty: diff, rules: { clear: !!settings.get('clear'), autoSwitch: settings.get('autoSwitch') !== false },
      quarterSec: settings.get('quarter') || CLOCK.DEFAULT_Q, auto: params.auto, tier: quality.tier,
    });
    app.game = game;
    app.animators = game.players.map((p) => p.animator);
    // replay
    app.recorder = new ReplayRecorder();
    const indexOf = (id) => { for (let i = 0; i < 6; i++) if (game.players[i].id === id) return i; return -1; };
    app.triggers = new ReplayTriggers({ recorder: app.recorder, world: game.world, mode: app.simplified ? 'off' : settings.get('replays'), quarterSec: settings.get('quarter') || CLOCK.DEFAULT_Q, indexOf });
    app.replayPlayer = new ReplayPlayer({
      recorder: app.recorder, animators: app.animators, ball: arenaParts.ballVis.mesh, tier: quality.tier,
      heights: game.players.map((p) => (characters ? characters[p.id].dims.heightBarefoot : LEGENDS[p.id].stats.barefootM)),
    });
    // test bot
    let bot = null;
    if (params.bot) { bot = new TestBot(game, { seed: params.seed }); bot.set(params.bot); game.input = bot; }
    app.bot = bot;
    flow = new Flow(app);
    app.flow = flow;
    hud.bind({ game });
    hud.meterAnchor = (p, out) => flow.meterAnchor(p, out);
    // reflection (high)
    app.reflection = null;
    const setReflection = (on) => {
      if (on && !app.reflection) {
        app.reflection = new PlanarReflection({ touch: quality.touch, shadowLight: lights.key });
        app.reflection.attachFloor(arenaParts.floor);
      } else if (!on && app.reflection) {
        app.reflection.dispose();
        arenaParts.floor.setReflection(null);
        app.reflection = null;
      }
      if (characters) for (const id in characters) characters[id].setReflectable(on);
    };
    if (renderer) setReflection(TIERS[quality.tier].floor.reflection);
    // tier changes (§7.3: at the next CHECK)
    if (renderer) quality.onTierChange((tier) => {
      lights.setTier(tier, renderer);
      arenaParts.crowd.setTier(tier); arenaParts.arena.setTier(tier); arenaParts.fx.setTier(tier);
      arenaParts.ballVis.setTier(tier); arenaParts.blobs.setTier(tier);
      app.replayPlayer.setTier(tier);
      setReflection(TIERS[tier].floor.reflection);
      for (let i = 0; i < 6; i++) { const an = game.players[i].animator; if (an.setDetail) an.setDetail(tier); }
      screens.setTier(tier);
      present.toast('toast.tier', { tier: t('settings.quality.' + tier) }, 1500);
    });
    // settings consumers
    settings.onChange((key, v) => {
      switch (key) {
        case 'quality': { const r = quality.setManual(v); screens.setTier(quality.pendingTier || quality.tier); const note = document.getElementById('settingsNote'); if (note) note.classList.toggle('hidden', !r.reloadNote); break; }
        case 'camera': director.setCameraMode(v); break;
        case 'sound': audio.setMuted(!v); break;
        case 'crowd': audio.setCrowdVolume(v); break;
        case 'replays': app.triggers.setMode(app.simplified ? 'off' : v); break;
        case 'lang': {
          if (!renderer) { hud.refreshLang(); break; }
          const s = markingStrings();
          arenaParts.floor.setStrings(s); arenaParts.decal.setStrings(s); arenaParts.arena.refresh();
          hud.refreshLang();
          break;
        }
        default: break;
      }
    });
    exposeHooks();
    // environment + shader warm-up (§6.6 compile phase)
    loader.phase('load.compile');
    if (renderer) buildArenaEnv(renderer, quality, scene);
    prog.shader = 0.6; report();
    await yieldNow();
    flow.toTitle(true);
    if (renderer) renderer.compile(scene, director.camera);
    prog.shader = 0.9; report();
    await yieldNow();
    for (let k = 0; k < 2; k++) { renderFrame(nowMs(), 1 / 60); await yieldNow(); }
    prog.shader = 1; report();
    if (lib) perf.load = Object.assign({}, lib.perf);
    await loader.done();
    bs.loading = false;
    resolveReady(!app.simplified);
    startLoop();
  }

  // ---- loading orchestration with retry / simplified mode ----
  const arenaDone = buildArenaSliced();
  async function attempt() {
    let lib = null, characters = null;
    if (!renderer) {                       // no WebGL2: simplified mode drawn on a 2D canvas (H12)
      await arenaDone;
      await clipsDone.catch(() => {});
      present.toast('toast.webgl1', null, 4000);
      await finish(null, null, {});
      return;
    }
    try {
      lib = await loadCharacters();
      await clipsDone;
      await arenaDone;
      characters = await useRealCharacters(lib);
    } catch (err) {
      await arenaDone;
      await clipsDone.catch(() => {});
      const file = err && err.file ? err.file : 'legends';
      const reason = err && err.reason ? err.reason : (err && err.message) || 'error';
      if (reason === 'webgl1') { present.toast('toast.webgl1', null, 3000); await finish(null, null, useHumanoids()); return; }
      screens.show('loadError');
      loader.error({ file, reason },
        () => { loader.hideError(); screens.show('loading'); attempt(); },
        () => { loader.hideError(); present.toast('legendsLoadFailed', null, 3000); finish(null, null, useHumanoids()); });
      return;
    }
    await finish(lib, characters, null);
  }
  attempt().catch((err) => {
    console.warn('[legends] boot failed', err);
    loader.error({ file: 'boot', reason: String(err && err.message || err) }, () => window.location.reload(), () => window.location.reload());
  });

  // ================================================================================================ loop
  const perf = { drawCalls: 0, triangles: 0, texMB: 0, stepMs: 0, animMs: 0, frameMs: 0, fps: 0, dpr: quality.dpr, load: null };
  let acc = 0, last = 0, rafId = 0, running = false, busyMs = 0;
  let stepSum = 0, stepN = 0, frameSum = 0, frameN = 0, perfLast = 0, renderParity = 0;

  function judged() {
    if (!game || !flow) return false;
    const s = game.world.state;
    return (s === 'CHECK' || s === 'LIVE' || s === 'DEAD') && !flow.paused && !screens.ui.overlay && screens.ui.screen === 'game' &&
      !(app.replayPlayer && app.replayPlayer.busy) && !document.hidden;
  }

  function renderFrame(now, frameDt) {
    const t0 = nowMs();
    flow.frame(frameDt, acc / FIXED_DT);
    const hz = director.renderHz;
    renderParity++;
    const skip = hz === 0 || (hz === 30 && (renderParity & 1) === 1);
    if (!skip && renderer) {
      if (app.reflection && TIERS[quality.tier].floor.reflection && (!quality.touch || (renderParity & 1) === 0)) app.reflection.update(renderer, scene, director.camera);
      renderer.render(scene, director.camera);
    } else if (!skip) flatR.render(game, director, flatColours);
    hud.update(frameDt, game.world, director);
    audio.update(frameDt, director.camera);
    frameSum += nowMs() - t0; frameN++;
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    GATE.judged = judged(); GATE.busyMs = busyMs;
    if (!quality.frame(now, GATE)) return;
    const start = nowMs();
    if (renderer) renderer.info.reset();
    const frameDt = last > 0 ? Math.min((now - last) / 1000, 0.25) : FIXED_DT;
    last = now;
    acc += frameDt;
    let steps = 0;
    const s0 = nowMs();
    // Each catch-up step samples the input at the time it stands for (the last one = now): a tap shorter than a slow
    // frame keeps its real length instead of being stretched over every catch-up step (pump fake vs shot, §5.7).
    const nSteps = Math.min(Math.floor(acc / FIXED_DT + 1e-9), MAX_STEPS);
    while (acc >= FIXED_DT && steps < MAX_STEPS) {
      input.sample(s0 - Math.max(0, nSteps - 1 - steps) * FIXED_DT * 1000);
      if (app.bot) app.bot.step(FIXED_DT);
      game.step(FIXED_DT);
      flow.fixedStep(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    if (steps > 0) { stepSum += (nowMs() - s0) / steps; stepN++; }
    renderFrame(now, frameDt);
    busyMs = nowMs() - start;
    if (now - perfLast >= PERF_INTERVAL_MS) {
      perfLast = now;
      const f = renderer ? frameStats(renderer) : null;
      if (f) { perf.drawCalls = f.calls; perf.triangles = f.triangles; } perf.texMB = +texMB().toFixed(2); perf.dpr = quality.dpr;
      perf.stepMs = stepN ? +(stepSum / stepN).toFixed(3) : perf.stepMs;
      perf.frameMs = frameN ? +(frameSum / frameN).toFixed(2) : perf.frameMs;
      let am = 0;
      if (app.animators) for (let i = 0; i < 6; i++) { const s = app.animators[i].stats; if (s && s.cpuMs) am += s.cpuMs; }
      perf.animMs = +am.toFixed(3);
      stepSum = 0; stepN = 0; frameSum = 0; frameN = 0;
    }
  }

  function startLoop() {
    if (running) return;
    running = true; acc = 0; last = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ---- visibility (§6.6): pause, suspend audio, stop rAF; on return show the pause menu, never auto-resume ----
  function onHidden() {
    if (!flow) return;
    flow.onHidden();
    audio.suspend();
    stopLoop();
  }
  document.addEventListener('visibilitychange', () => {
    if (!flow || bs.loading) return;
    if (document.hidden) onHidden();
    else { audio.resume(); quality.clearWindow(); startLoop(); }
  });
  window.addEventListener('pagehide', () => { if (flow && !bs.loading) onHidden(); });

  // ---- WebGL context loss (v1) ----
  if (renderer) canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (flow) flow.pause(); stopLoop(); screens.overlay('ctxLost'); }, false);
  if (renderer) canvas.addEventListener('webglcontextrestored', () => { window.location.reload(); }, false);

  // ---- window.__game (§5.15) ----
  function exposeHooks() {
    const extras = {
      legendsReady,
      get simplified() { return app.simplified; },
      get lib() { return app.lib; },
      get characters() { return app.characters; },
      get humanoids() { return app.humanoids; },
      get paused() { return game.paused || flow.paused; },
      get perf() { return perf; },
      quality,
      renderer,
      scene,
      get camera() { return director.camera; },
      input,
      audio,
      settings,
      params,
      flow,
      hud,
      screens,
      get ui() { return screens.ui; },
      get replay() { const r = app.replayPlayer; return { active: r.active, kind: r.kind, t: r.playT, busy: r.busy, phase: r.phase }; },
      get director() { return { mode: director.mode, cameraMode: director.cameraMode, camera: director.camera, obj: director }; },
      get arena() { return { jumbo: arenaParts.arena.jumbo, led: arenaParts.arena.led, reflection: app.reflection, hoop: arenaParts.hoop, crowd: arenaParts.crowd }; },
      get reflection() { return app.reflection; },
      bot: { set: (mode) => { if (!app.bot) { app.bot = new TestBot(game, { seed: params.seed }); game.input = app.bot; } const m = app.bot.set(mode); if (m === 'off') { game.input = input; app.bot = null; } return m; } },
      fastForward(sec) {
        const n = Math.max(0, Math.round((sec > 0 ? sec : 0) * 60));
        // same per-step order as the frame loop minus the DOM input: the test bot (?bot=) plays in fast-forward too
        for (let i = 0; i < n; i++) { if (app.bot) app.bot.step(FIXED_DT); game.step(FIXED_DT); flow.fixedStep(FIXED_DT); }
        if (running) renderFrame(nowMs(), 0);
        return n;
      },
    };
    window.__game = makeDebugHooks(game, extras);
  }

  // first paint of the loading screen ready → resize once
  resize();
}

boot();
