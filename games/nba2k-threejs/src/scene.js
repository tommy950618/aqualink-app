// Renderer, lights, arena dressing (stands, crowd, banners), procedural textures and the
// adaptive-DPR frame monitor (spec section 10, section 14 row 10).
// Module top level never touches the DOM, so this file imports cleanly in Node for tests.
import * as THREE from '../vendor/three.module.js';
import { PERF, COLORS } from './constants.js';
import { Rng, TAU } from './math.js';
import { STRINGS, t } from './i18n.js';

const CROWD_COUNT = 600;
const CROWD_BOB_T = 1.5;      // seconds of bobbing after bumpCrowd()
const CROWD_BOB_H = 0.15;     // metres
const BANNER_W = 512, BANNER_H = 128;

// Scratch objects for arena construction and the crowd bob (never allocated per frame).
const M4 = new THREE.Matrix4();
const V_POS = new THREE.Vector3();
const V_SCALE = new THREE.Vector3(1, 1, 1);
const Q_ID = new THREE.Quaternion();
const COLOR = new THREE.Color();

// ---------------------------------------------------------------------------------------------
// Renderer and scene
// ---------------------------------------------------------------------------------------------

// WebGLRenderer tuned for phones: DPR cap per PERF, AA only at low DPR, no tone mapping, no shadows.
// Throws (like THREE) when WebGL is unavailable; main.js shows the #nowebgl fallback in that case.
export function createRenderer(canvas, isTouch) {
  const deviceDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const dpr = Math.min(deviceDpr, isTouch ? PERF.DPR_TOUCH : PERF.DPR_DESKTOP);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: dpr <= 1.5,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(COLORS.background, 1);
  return { renderer, dpr };
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  const hemi = new THREE.HemisphereLight(0xffffff, COLORS.hemiGround, 1.0);
  hemi.position.set(0, 20, 0);
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(6, 14, 10);
  dir.target.position.set(0, 0, -8);
  scene.add(hemi, dir, dir.target);
  return { scene, hemi, dir };
}

// ---------------------------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------------------------

function defaultCanvas(w, h) {
  if (typeof document !== 'undefined' && document && typeof document.createElement === 'function') {
    return document.createElement('canvas');
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  // Headless fallback (Node tests): a texture with an inert image, nothing is drawn.
  return { width: w, height: h, getContext: () => null };
}

// Build a w x h sRGB CanvasTexture painted by drawFn(ctx, w, h). createCanvas(w, h) may be injected;
// without a 2D context (Node) the draw step is skipped and an inert texture is returned.
export function makeCanvasTexture(w, h, drawFn, createCanvas) {
  const canvas = createCanvas ? createCanvas(w, h) : defaultCanvas(w, h);
  canvas.width = w;
  canvas.height = h;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (ctx && drawFn) drawFn(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// 64x64 radial gradient, black centre fading to transparent: the shared blob shadow.
export function makeBlobTexture(createCanvas) {
  const tex = makeCanvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, createCanvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// 256x128 equirectangular ball skin: orange with black seams (equator, two meridians, two curved seams).
export function makeBallTexture(createCanvas) {
  return makeCanvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8641b';
    ctx.fillRect(0, 0, w, h);
    // Subtle pebble shading bands so the sphere reads as round even when unlit from one side.
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 0, w, 8);
    ctx.fillRect(0, h - 8, w, 8);
    ctx.strokeStyle = '#1a1210';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);            // equator
    ctx.moveTo(w * 0.25, 0); ctx.lineTo(w * 0.25, h);        // meridians (u = 0.25 and 0.75)
    ctx.moveTo(w * 0.75, 0); ctx.lineTo(w * 0.75, h);
    ctx.stroke();
    // Two curved seams: sinusoids in (u, v) map to the tilted great circles of a real ball.
    for (let s = 0; s < 2; s++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = h / 2 + (s === 0 ? 1 : -1) * 0.34 * h * Math.sin((x / w) * TAU);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, createCanvas);
}

// 512x128 arena banner: dark field, orange accent bar and the arena name (CJK part from i18n).
function drawBanner(ctx, w, h) {
  ctx.fillStyle = '#141824';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ff7a1f';
  ctx.fillRect(0, 0, w, 8);
  ctx.fillRect(0, h - 8, w, 8);
  const zhTitle = (STRINGS.zh && STRINGS.zh['app.title']) || t('app.title');
  const text = 'HOOP ARENA ' + zhTitle.replace(/\s*3x3\s*$/, '');
  const family = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  let px = 56;
  ctx.font = 'bold ' + px + 'px ' + family;
  while (px > 24 && ctx.measureText(text).width > w - 32) {
    px -= 2;
    ctx.font = 'bold ' + px + 'px ' + family;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f4f4f4';
  ctx.fillText(text, w / 2, h / 2 + 2);
}

// ---------------------------------------------------------------------------------------------
// Arena: 4 stepped stand blocks, one instanced crowd, 2 banners (7 draw calls)
// ---------------------------------------------------------------------------------------------

// Stand blocks: [w, h, d, cx, cy, cz]. Two tiers behind the hoop, one block per sideline.
const STANDS = [
  [30, 1.2, 3, 0, 0.6, -18.0],
  [30, 2.4, 3, 0, 1.2, -21.0],
  [3, 1.5, 24, -12.5, 0.75, -8.0],
  [3, 1.5, 24, 12.5, 0.75, -8.0],
];
// Seat rows: [count, axis ('x' = row runs along x), fixed coordinate, top y, start, end].
const ROWS = [
  [50, 'x', -17.0, 1.2, -14.5, 14.5], [50, 'x', -18.0, 1.2, -14.5, 14.5], [50, 'x', -19.0, 1.2, -14.5, 14.5],
  [50, 'x', -20.0, 2.4, -14.5, 14.5], [50, 'x', -21.0, 2.4, -14.5, 14.5], [50, 'x', -22.0, 2.4, -14.5, 14.5],
  [50, 'z', -11.5, 1.5, -19.5, 3.5], [50, 'z', -12.5, 1.5, -19.5, 3.5], [50, 'z', -13.5, 1.5, -19.5, 3.5],
  [50, 'z', 11.5, 1.5, -19.5, 3.5], [50, 'z', 12.5, 1.5, -19.5, 3.5], [50, 'z', 13.5, 1.5, -19.5, 3.5],
];

// Builds the stands, the 600-box crowd and the banners. rng is the seeded Rng (crowd colours,
// seat jitter); when omitted a fixed-seed Rng keeps the arena deterministic.
export function buildArena(scene, rng, createCanvas) {
  const r = rng || new Rng(0x9e3779b9);
  const standGeo = new THREE.BoxGeometry(1, 1, 1);
  const standMat = new THREE.MeshLambertMaterial({ color: COLORS.stands });
  const stands = [];
  for (let i = 0; i < STANDS.length; i++) {
    const s = STANDS[i];
    const m = new THREE.Mesh(standGeo, standMat);
    m.scale.set(s[0], s[1], s[2]);
    m.position.set(s[3], s[4], s[5]);
    scene.add(m);
    stands.push(m);
  }

  const crowd = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.4, 0.6, 0.4),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    CROWD_COUNT
  );
  crowd.frustumCulled = false;
  const baseY = new Float32Array(CROWD_COUNT);
  const phase = new Float32Array(CROWD_COUNT);
  let i = 0;
  for (let rIdx = 0; rIdx < ROWS.length && i < CROWD_COUNT; rIdx++) {
    const row = ROWS[rIdx];
    const count = row[0], alongX = row[1] === 'x', fixed = row[2], top = row[3], a = row[4], b = row[5];
    const step = (b - a) / (count - 1);
    for (let k = 0; k < count && i < CROWD_COUNT; k++, i++) {
      const along = a + step * k + r.range(-0.08, 0.08);
      const across = fixed + r.range(-0.12, 0.12);
      const sy = r.range(0.85, 1.15);
      V_POS.set(alongX ? along : across, top + 0.3 * sy, alongX ? across : along);
      V_SCALE.set(1, sy, 1);
      M4.compose(V_POS, Q_ID, V_SCALE);
      crowd.setMatrixAt(i, M4);
      COLOR.setHex(r.pick(COLORS.crowd));
      crowd.setColorAt(i, COLOR);
      baseY[i] = V_POS.y;
      phase[i] = r.range(0, TAU);
    }
  }
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  scene.add(crowd);

  const bannerTex = makeCanvasTexture(BANNER_W, BANNER_H, drawBanner, createCanvas);
  const bannerGeo = new THREE.PlaneGeometry(8, 2);
  const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex });
  const banners = [];
  for (let b = 0; b < 2; b++) {
    const m = new THREE.Mesh(bannerGeo, bannerMat);
    m.position.set(b === 0 ? -8 : 8, 4.3, -22.6);
    scene.add(m);
    banners.push(m);
  }

  // Crowd bob (spec section 10): only during the 1.5 s after a score are the matrices rewritten.
  let bobT = -1;
  const arr = crowd.instanceMatrix.array;
  function bumpCrowd() {
    bobT = 0;
  }
  function updateCrowd(dt) {
    if (bobT < 0) return;
    bobT += dt;
    if (bobT >= CROWD_BOB_T) {
      for (let k = 0; k < CROWD_COUNT; k++) arr[k * 16 + 13] = baseY[k];
      bobT = -1;
    } else {
      const w = TAU * bobT;
      for (let k = 0; k < CROWD_COUNT; k++) {
        arr[k * 16 + 13] = baseY[k] + CROWD_BOB_H * Math.abs(Math.sin(w + phase[k]));
      }
    }
    crowd.instanceMatrix.needsUpdate = true;
  }
  return { crowd, stands, banners, bumpCrowd, updateCrowd, get bobbing() { return bobT >= 0; } };
}

// ---------------------------------------------------------------------------------------------
// Frame-time monitor for the adaptive DPR rule
// ---------------------------------------------------------------------------------------------

// Rolling average of frame times over PERF.WINDOW_S seconds. After PERF.WARMUP_S seconds of frames,
// shouldDowngrade() returns true exactly once if the average exceeds PERF.DOWNGRADE_MS.
export class PerfMonitor {
  constructor(opts) {
    const o = opts || {};
    this.windowMs = (o.windowS !== undefined ? o.windowS : PERF.WINDOW_S) * 1000;
    this.warmupMs = (o.warmupS !== undefined ? o.warmupS : PERF.WARMUP_S) * 1000;
    this.thresholdMs = o.thresholdMs !== undefined ? o.thresholdMs : PERF.DOWNGRADE_MS;
    this.capacity = 1024;
    this.buf = new Float32Array(this.capacity);
    this.head = 0;            // next write slot
    this.count = 0;           // frames currently inside the window
    this.sum = 0;             // sum of those frames' ms
    this.elapsedMs = 0;       // total time observed since construction
    this.downgraded = false;
  }

  // Record one frame of `ms` milliseconds and slide the window.
  frame(ms) {
    if (!(ms >= 0) || !Number.isFinite(ms)) return;
    if (this.count === this.capacity) this._dropOldest();
    this.buf[this.head] = ms;
    this.head = (this.head + 1) % this.capacity;
    this.count++;
    this.sum += ms;
    this.elapsedMs += ms;
    // Keep at least one frame; drop old ones until the window holds <= windowMs.
    while (this.count > 1 && this.sum - this._oldest() >= this.windowMs) this._dropOldest();
  }

  _oldestIndex() {
    return (this.head - this.count + this.capacity) % this.capacity;
  }

  _oldest() {
    return this.buf[this._oldestIndex()];
  }

  _dropOldest() {
    this.sum -= this.buf[this._oldestIndex()];
    this.count--;
    if (this.count === 0) this.sum = 0;
  }

  // Average frame time (ms) over the rolling window; 0 before the first frame.
  get avg() {
    return this.count > 0 ? this.sum / this.count : 0;
  }

  get fps() {
    const a = this.avg;
    return a > 0 ? 1000 / a : 0;
  }

  get warmedUp() {
    return this.elapsedMs >= this.warmupMs;
  }

  // True once, after the warm-up, when the rolling average is above the threshold (sticky).
  shouldDowngrade() {
    if (this.downgraded || !this.warmedUp || this.count === 0) return false;
    if (this.avg > this.thresholdMs) {
      this.downgraded = true;
      return true;
    }
    return false;
  }
}
