/**
 * @module render/reflection
 * High-tier planar floor reflection (SPEC-v2 §6.2, PR §2.3).
 *
 * A half-resolution `HalfFloatType` render target (linear HDR; tone mapping happens later in the floor's own
 * shader) receives the scene seen through a mirror camera:
 *   view' = view · S,  S = diag(1, −1, 1)          (the world reflected in the floor plane y = 0)
 *   proj' = F · proj,  F = diag(−1, 1, 1, 1)        (x flipped so the two flips keep the triangle winding)
 * The floor patch samples it at `1 − u` (undoing F) with gl_FragCoord / drawing-buffer size, so the full camera
 * projection incl. a portrait view offset is honoured. Only layer 2 is rendered (character body + kit, ball, rim,
 * net, board frame, stanchion; the lights are on layer 2 too). No clip plane is needed: nothing exists below y = 0.
 *
 * Rate: every frame on desktop, every 2nd frame on touch. During the pass the shadow map is not re-rendered
 * (autoUpdate is suspended) and `renderer.info` keeps counting (autoReset false), so the ≈ +17 draws show up.
 */
import * as THREE from '../../vendor/three.module.js';
import { trackTexture, untrackTexture } from './quality.js';
import { REFLECT_LAYER } from './lighting.js';

const S = new THREE.Matrix4().makeScale(1, -1, 1);
const F = new THREE.Matrix4().makeScale(-1, 1, 1);
const SIZE = new THREE.Vector2();
const CLEAR = new THREE.Color();

export class PlanarReflection {
  /**
   * @param {{touch?:boolean, strength?:number, shadowLight?:THREE.DirectionalLight}} [opts]
   *   shadowLight: the key light; the mirror pass waits until its shadow map exists (first frame / after a tier change),
   *   since the pass itself never renders the shadow map.
   */
  constructor(opts) {
    const o = opts || {};
    this.touch = !!o.touch;
    this.shadowLight = o.shadowLight || null;
    this.strength = o.strength !== undefined ? o.strength : 0.22;
    this.target = null;
    this.texture = null;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.camera.layers.set(REFLECT_LAYER);
    this.frame = 0;
    this.enabled = true;
    this._w = 0;
    this._h = 0;
    this.floor = null;
  }

  /** Bind the floor (object returned by buildFloor) whose shader samples this reflection. */
  attachFloor(floor) {
    this.floor = floor || null;
    if (this.floor) {
      this._ensureTarget(Math.max(1, this._w || 2), Math.max(1, this._h || 2));
      this.floor.uniforms.uReflStrength.value = this.strength;
      this.floor.setReflection(this);
    }
  }

  _ensureTarget(w, h) {
    if (this.target && this._w === w && this._h === h) return;
    if (!this.target) {
      this.target = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType, samples: 0, depthBuffer: true, stencilBuffer: false,
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
      });
      this.target.texture.name = 'floorReflection';
      this.texture = this.target.texture;
    } else {
      this.target.setSize(w, h);
    }
    this._w = w; this._h = h;
    // Colour half-float 8 B/px + depth 4 B/px.
    trackTexture(this.target, 12, false);
    if (this.floor) this.floor.uniforms.uReflMap.value = this.texture;
  }

  /**
   * Render the mirror pass (call after the director update, before the main render).
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera  the active camera (matrices current)
   */
  update(renderer, scene, camera) {
    if (!this.enabled || !this.floor) return;
    this.frame++;
    renderer.getDrawingBufferSize(SIZE);
    const w = Math.max(1, Math.ceil(SIZE.x / 2));
    const h = Math.max(1, Math.ceil(SIZE.y / 2));
    this._ensureTarget(w, h);
    const u = this.floor.uniforms;
    u.uReflRes.value.set(SIZE.x, SIZE.y);
    u.uReflTexel.value.set(1 / w, 1 / h);
    if (this.touch && (this.frame & 1) === 1) return;   // every 2nd frame on touch devices
    const sl = this.shadowLight;
    if (sl && sl.castShadow && renderer.shadowMap.enabled && !sl.shadow.map) return;

    const mc = this.camera;
    mc.matrixWorld.multiplyMatrices(S, camera.matrixWorld);
    mc.matrixWorldInverse.multiplyMatrices(camera.matrixWorldInverse, S);
    mc.projectionMatrix.multiplyMatrices(F, camera.projectionMatrix);
    mc.projectionMatrixInverse.copy(mc.projectionMatrix).invert();
    mc.near = camera.near; mc.far = camera.far;

    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    const prevNeeds = renderer.shadowMap.needsUpdate;
    renderer.getClearColor(CLEAR);
    const prevAlpha = renderer.getClearAlpha();
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    const bg = scene.background;
    scene.background = null;
    renderer.render(scene, mc);
    scene.background = bg;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(CLEAR, prevAlpha);
    renderer.shadowMap.autoUpdate = prevAuto;
    renderer.shadowMap.needsUpdate = prevNeeds;
  }

  /** Release the target (on demotion from high); the floor drops the reflection term. */
  dispose() {
    if (this.floor) this.floor.setReflection(null);
    if (this.target) {
      untrackTexture(this.target);
      this.target.dispose();
    }
    this.target = null;
    this.texture = null;
    this._w = 0; this._h = 0;
  }
}

/** Put an object (and its descendants) on the reflection layer 2 while keeping layer 0. */
export function setReflectable(obj, on) {
  if (!obj) return;
  obj.traverse((o) => { if (on) o.layers.enable(REFLECT_LAYER); else o.layers.disable(REFLECT_LAYER); });
}
