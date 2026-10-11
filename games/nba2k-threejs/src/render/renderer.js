/**
 * @module render/renderer
 * The WebGL renderer of v2 (SPEC-v2 §6.1, PR §1.1): MSAA on every tier (`?aa=0` debug off), sRGB output, Khronos
 * PBR Neutral tone mapping at exposure 1.0 on all tiers (D-PR-1), PCF shadow maps on medium/high only, a fixed clear
 * colour, `info.autoReset = false` (main.js resets once per frame so shadow + reflection passes count), and a resize
 * helper that never renders (R#3).
 *
 * Boot order (WP9): `createRenderer(canvas, {aa})` → `detectStatic(renderer, navigator, screen, location.search)` →
 * `createQuality({renderer, settings, url, static})` (sets the DPR of the start rung and `shadowMap.enabled`).
 * `createRenderer(canvas, quality)` with a full quality object works as well.
 */
import * as THREE from '../../vendor/three.module.js';

export const CLEAR_COLOUR = 0x0b0d14;

/**
 * Create the renderer.
 * @param {HTMLCanvasElement} canvas
 * @param {{tier?:string, dpr?:number, aa?:boolean}} [quality]  quality object (or a subset)
 * @returns {THREE.WebGLRenderer}
 * @throws when WebGL2 is unavailable (three r186 requires WebGL2; WP9 switches to simplified mode, H12)
 */
export function createRenderer(canvas, quality) {
  const q = quality || {};
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: q.aa !== false,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false,
  });
  configureRenderer(renderer, q);
  return renderer;
}

/** Apply the v2 renderer state (idempotent; also used after a tier change for the shadow switch). */
export function configureRenderer(renderer, quality) {
  const q = quality || {};
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;   // D-PR-1
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = q.tier !== undefined ? q.tier !== 'low' : false;
  renderer.shadowMap.type = THREE.PCFShadowMap;      // r186: PCFSoftShadowMap removed
  renderer.shadowMap.autoUpdate = true;
  renderer.info.autoReset = false;
  renderer.setClearColor(CLEAR_COLOUR, 1);
  if (typeof q.dpr === 'number' && q.dpr > 0) renderer.setPixelRatio(q.dpr);
  return renderer;
}

/**
 * Resize the drawing buffer and the camera. Never renders (a resize from the quality ladder must not trigger an
 * extra frame, R#3). A camera with an enabled view offset (portrait lens shift, WP7) keeps its offset proportions.
 * @param {THREE.WebGLRenderer} r
 * @param {THREE.PerspectiveCamera|null} cam
 * @param {number} w CSS px
 * @param {number} h CSS px
 */
export function resizeRenderer(r, cam, w, h) {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  r.setSize(W, H, false);
  if (cam && cam.isPerspectiveCamera) {
    cam.aspect = W / H;
    const v = cam.view;
    if (v && v.enabled && v.fullWidth > 0 && v.fullHeight > 0) {
      const sx = W / v.fullWidth, sy = H / v.fullHeight;
      cam.setViewOffset(W, H, v.offsetX * sx, v.offsetY * sy, W, H);
    } else {
      cam.updateProjectionMatrix();
    }
  }
}

const STATS = { calls: 0, triangles: 0, points: 0, lines: 0, geometries: 0, textures: 0 };

/**
 * Snapshot of `renderer.info` for the frame so far (all passes, since info.autoReset is false). Returns a module
 * scratch object (do not keep a reference across frames).
 */
export function frameStats(renderer) {
  const i = renderer.info;
  STATS.calls = i.render.calls;
  STATS.triangles = i.render.triangles;
  STATS.points = i.render.points;
  STATS.lines = i.render.lines;
  STATS.geometries = i.memory.geometries;
  STATS.textures = i.memory.textures;
  return STATS;
}
