// Boot and frame loop (spec sections 10 and 14.1): URL flags, renderer/scene/court/arena, camera,
// audio, input, HUD, the Game, resize handling (visualViewport + orientationchange retries), the
// fixed-step accumulator with interpolation, adaptive DPR, visibility pause, WebGL context loss and
// the window.__game test hooks. Side-effect module: boot() runs at import.
import { FIXED_DT, PERF, CLOCK } from './constants.js';
import { Rng } from './math.js';
import { setLang, getLang, applyDom } from './i18n.js';
import { createRenderer, createScene, buildArena, PerfMonitor } from './scene.js';
import { buildCourt } from './court.js';
import { BroadcastCamera } from './camera.js';
import { Audio } from './audio.js';
import { Input, isTouchDevice } from './input.js';
import { HUD } from './hud.js';
import { Game } from './game.js';

const ORIENTATION_RETRIES = [120, 400];   // ms after orientationchange (iOS reports stale sizes)
const PERF_INTERVAL_MS = 1000;
const ARENA_SEED_SALT = 0x9e3779b9;

function parseParams() {
  const out = { seed: Date.now() | 0, q: 0, auto: false, lang: '', debug: false };
  let sp = null;
  try { sp = new URLSearchParams(window.location.search); } catch (err) { return out; }
  const seed = parseInt(sp.get('seed'), 10);
  if (Number.isFinite(seed)) out.seed = seed | 0;
  const q = parseFloat(sp.get('q'));
  if (Number.isFinite(q) && q > 0) out.q = q * 60;
  const auto = sp.get('auto');
  out.auto = auto === '1' || auto === 'true';
  const lang = sp.get('lang');
  if (lang === 'zh' || lang === 'en') out.lang = lang;
  const dbg = sp.get('debug');
  out.debug = dbg === '1' || dbg === 'true';
  return out;
}

function appSize() {
  const app = document.getElementById('app');
  let w = app ? app.clientWidth : 0, h = app ? app.clientHeight : 0;
  if (!(w > 0) || !(h > 0)) { w = window.innerWidth; h = window.innerHeight; }
  return { w: Math.max(1, w | 0), h: Math.max(1, h | 0) };
}

function boot() {
  const params = parseParams();
  setLang(params.lang || getLang());
  applyDom(document);

  const canvas = document.getElementById('gl');
  const audio = new Audio();
  const hud = new HUD(document, {});
  let renderer = null, dpr = 1;
  try {
    ({ renderer, dpr } = createRenderer(canvas, isTouchDevice()));
  } catch (err) {
    hud.showMenu('nowebgl');
    window.__game = { error: String(err && err.message || err), audio, hud, params };
    return;
  }

  const rng = new Rng(params.seed);
  const { scene } = createScene();
  const arena = buildArena(scene, new Rng((params.seed ^ ARENA_SEED_SALT) | 0));
  const court = buildCourt(scene, { maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });
  const size0 = appSize();
  const cam = new BroadcastCamera(size0.w / size0.h);
  const input = new Input(document, {
    onGesture: () => audio.unlock(),
    onPause: () => { game.togglePause(); },
    onMute: () => { audio.toggleMuted(); hud.setOption('sound', !audio.muted); },
    onLang: () => hud.toggleLanguage(),
  });
  const options = { auto: params.auto, debug: params.debug };
  if (params.q > 0) options.quarterSeconds = params.q;
  const game = new Game({ scene, court, arena, camera: cam, audio, hud, input, rng, options });
  hud.cb.onStart = (o) => {
    const opts = Object.assign({}, o);
    if (params.q > 0) { opts.quarterSeconds = params.q; opts.quarter = params.q; }
    game.start(opts);
  };
  hud.cb.onResume = () => game.resume();
  hud.cb.onQuit = () => game.quit();
  hud.cb.onRematch = () => game.rematch();
  hud.cb.onSetting = (key, value) => { if (key === 'difficulty') game.setDifficulty(value); };
  hud.cb.onSkip = () => game.skipHalftime();
  hud.bind(game, input, audio);

  let acc = 0, last = 0, rafId = 0, running = false;

  // ---- resize (one rAF debounce; visualViewport and orientationchange retries) ----
  let resizeQueued = false;
  function resize() {
    resizeQueued = false;
    const { w, h } = appSize();
    renderer.setSize(w, h, false);
    cam.setAspect(w / h);
    if (running) renderer.render(scene, cam.camera);   // never leave a freshly resized canvas blank
  }
  function queueResize() {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(resize);
  }
  window.addEventListener('resize', queueResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', queueResize);
  window.addEventListener('orientationchange', () => {
    queueResize();
    for (let i = 0; i < ORIENTATION_RETRIES.length; i++) setTimeout(queueResize, ORIENTATION_RETRIES[i]);
  });
  resize();

  // ---- frame loop (section 10) ----
  const perfMon = new PerfMonitor();
  const perf = { fps: 0, avgFrameMs: 0, stepMs: 0, drawCalls: 0, triangles: 0, dpr };
  let stepMsSum = 0, stepCount = 0, perfLastMs = 0, downgraded = false;

  function renderFrame(frameDt, alpha) {
    game.render(alpha, frameDt);
    renderer.render(scene, cam.camera);
    hud.update(frameDt, game.world, cam.camera);
    audio.update(frameDt);
  }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const frameDt = last > 0 ? Math.min((now - last) / 1000, PERF.MAX_FRAME_DT) : FIXED_DT;
    last = now;
    acc += frameDt;
    let steps = 0;
    const t0 = performance.now();
    while (acc >= FIXED_DT && steps < PERF.MAX_STEPS) {
      input.sample(now);
      game.step(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === PERF.MAX_STEPS) acc = 0;
    if (steps > 0) { stepMsSum += (performance.now() - t0) / steps; stepCount++; }
    const alpha = acc / FIXED_DT;
    // Adaptive DPR (section 10), decided before this frame renders so a resized canvas is never
    // presented blank.
    perfMon.frame(frameDt * 1000);
    if (!downgraded && perfMon.shouldDowngrade()) {
      downgraded = true;
      renderer.setPixelRatio(PERF.DPR_LOW);
      perf.dpr = PERF.DPR_LOW;
      resize();
      console.log('[hoop] frame time ' + perfMon.avg.toFixed(1) + ' ms > ' + PERF.DOWNGRADE_MS + ' ms: pixel ratio lowered to ' + PERF.DPR_LOW);
    }
    renderFrame(frameDt, alpha);
    if (now - perfLastMs >= PERF_INTERVAL_MS) {
      perfLastMs = now;
      perf.fps = Math.round(perfMon.fps);
      perf.avgFrameMs = Math.round(perfMon.avg * 100) / 100;
      perf.stepMs = stepCount > 0 ? Math.round(stepMsSum / stepCount * 1000) / 1000 : 0;
      stepMsSum = 0; stepCount = 0;
      perf.drawCalls = renderer.info.render.calls;
      perf.triangles = renderer.info.render.triangles;
    }
  }

  function startLoop() {
    if (running) return;
    running = true;
    acc = 0; last = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ---- visibility (section 10): pause + suspend audio when hidden; never auto-resume ----
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.pause();
      audio.suspend();
      stopLoop();
    } else {
      audio.resume();
      acc = 0; last = 0;
      startLoop();
      if (game.paused) hud.showMenu('pause');
    }
  });

  // ---- WebGL context loss ----
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    game.pause();
    stopLoop();
    hud.showMenu('ctxLost');
  }, false);
  canvas.addEventListener('webglcontextrestored', () => { window.location.reload(); }, false);

  // ---- test hooks (section 14.1) ----
  function fastForward(sec) {
    const n = game.fastForward(sec);
    renderFrame(0, 1);
    return n;
  }
  window.__game = {
    game,
    get state() { return game.state; },
    world: game.world,
    get controlled() { return game.controlled; },
    get paused() { return game.paused; },
    ball: game.world.ball,
    perf, audio, renderer, camera: cam.camera, rng, input, hud, scene, court, arena, params,
    debug: game.debug,
    teleport: game.debug.teleport,
    debugShoot: game.debug.debugShoot,
    setClock: game.debug.setClock,
    turnover: game.debug.turnover,
    fastForward,
    get invariantsBroken() { return game.debug.invariantsBroken; },
    version: 'hoop-arena-3x3 r186',
  };
  if (params.debug) console.log('[hoop] seed ' + params.seed + ' q ' + (params.q || CLOCK.DEFAULT_Q) + 's auto ' + params.auto);

  hud.showMenu('main');
  startLoop();
}

boot();
