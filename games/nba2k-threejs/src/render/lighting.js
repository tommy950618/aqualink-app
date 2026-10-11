/**
 * @module render/lighting
 * Arena lighting rig, presets and the per-frame shadow fit (SPEC-v2 §6.1, PR §1.2–§1.3).
 *
 * Lights are all created at boot (light counts are part of the program cache key; presets change intensity only,
 * so no shader recompiles mid-game, D-PR-2):
 *   hemi  HemisphereLight sky #fff1e0 / ground #5a3f28, 1.10 / 0.35 / 0.30 (low / medium / high)
 *   key   DirectionalLight #fff4e5, 2.40 / 2.85 / 2.85 (spec 2.50, tuned inside the allowed [2.0, 3.2] so the B42 wood
 *         patch measures ≈ 0.63 luma at 844×390 medium), position = target + 30·normalize(4, 20, 6); the only shadow
 *         caster (medium/high): PCF 1024² r 2.0 / 2048² r 2.5, bias −0.0005/−0.0004, normalBias 0.025/0.020,
 *         intensity 0.78/0.80, ortho fitted each frame around the players (texel-snapped)
 *   rim   DirectionalLight #d6e4ff, 0.90 / 1.30 / 1.30, from (0, 9, −32) toward (0, 1.0, −6)
 *   fill  DirectionalLight #f2f5ff, 1.00 / 0.80 / 0.80, from the broadcast side (0, 7, 34) toward (0, 1.0, −6): the
 *         arena's front (camera-side) lighting. The key comes from 70° above, so vertical surfaces got only ≈ 0.28 of
 *         it and a white kit's chest measured luma 0.59 (B30 wants > 0.7) while the floor was calibrated (B42); the
 *         fill lights what the cameras see (chests, faces) and adds only ≈ 4 % to the floor (n·L 0.15). Slightly cool
 *         (LED broadcast lighting) against the warm hemi bounce that pushed the wine kit toward red. No shadows.
 *   spot  SpotLight #ffffff (medium/high boot tier only), 12 m above the presented player, angle 0.32, penumbra 0.55,
 *         decay 2; 0 in play, 1,100 cd intro, 900 cd game-over MVP
 * Every light also lives on layer 2 so the high-tier planar reflection (layer 2 camera) is lit by the same rig
 * (three tests light layers against the camera; a different light set would also recompile every material).
 *
 * Presets (linear over `seconds`, default 0.6): multipliers of key / hemi / rim / fill, scene.environmentIntensity, crowd
 * colour (forwarded to a registered crowd's `setDim`), spot candela.
 */
import * as THREE from '../../vendor/three.module.js';
import { TIERS, trackTexture, untrackTexture } from './quality.js';

/** Preset table (PR §1.2). */
export const PRESETS = Object.freeze({
  play: Object.freeze({ key: 1.0, hemi: 1.0, rim: 1.0, fill: 1.0, env: 0.55, crowd: 1.0, spot: 0 }),
  intro: Object.freeze({ key: 0.35, hemi: 0.5, rim: 1.2, fill: 0.45, env: 0.20, crowd: 0.4, spot: 1100 }),
  pause: Object.freeze({ key: 0.8, hemi: 0.8, rim: 1.0, fill: 0.8, env: 0.45, crowd: 0.7, spot: 0 }),
  replay: Object.freeze({ key: 1.0, hemi: 1.0, rim: 1.25, fill: 1.0, env: 0.55, crowd: 1.0, spot: 0 }),
  gameover: Object.freeze({ key: 0.6, hemi: 0.7, rim: 1.3, fill: 0.7, env: 0.35, crowd: 0.8, spot: 900 }),
});

/** Key light direction (unit), from the target toward the light. */
export const KEY_DIR = Object.freeze(new THREE.Vector3(4, 20, 6).normalize());
const KEY_DIST = 30;
const DEFAULT_TARGET_X = 0, DEFAULT_TARGET_Z = -7;
const FIT_MARGIN = 1.6;
const H_MIN = 4.5, H_MAX = 11.0, H_QUANT = 0.5;
const SPOT_HEIGHT = 12;
export const REFLECT_LAYER = 2;

// Light-space basis of the shadow camera. The shadow camera is placed at the light and looks at the target with
// up = +Y, so its x axis = normalize(cross(up, dir)) and its y axis = cross(dir, x). Because the camera position
// is target + 30·dir and dir ⟂ x, y, the light-space x/y of the frustum centre equal the target's x/y components:
// snapping the target's components to the texel grid snaps the whole shadow map (no crawling edges).
const LX = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), KEY_DIR).normalize();
const LY = new THREE.Vector3().crossVectors(KEY_DIR, LX).normalize();

/**
 * Fit the shadow frustum half-size to an AABB (pure; exported for tests).
 * h = 0.5·max(w, d)·1.08 (the light is tilted ≈ 18° from vertical), quantised up to 0.5 m, clamped [4.5, 11].
 */
export function fitHalfSize(minX, maxX, minZ, maxZ) {
  const w = maxX - minX + 2 * FIT_MARGIN;
  const d = maxZ - minZ + 2 * FIT_MARGIN;
  let h = 0.5 * Math.max(w, d) * 1.08;
  h = Math.ceil(h / H_QUANT - 1e-9) * H_QUANT;
  return h < H_MIN ? H_MIN : h > H_MAX ? H_MAX : h;
}

const SNAP = new THREE.Vector3();

/** Snap a target point to the light-space texel grid (texel = 2h / mapSize) in place. */
export function snapToTexels(target, h, mapSize) {
  const texel = (2 * h) / mapSize;
  const u = target.dot(LX), v = target.dot(LY);
  const du = Math.round(u / texel) * texel - u;
  const dv = Math.round(v / texel) * texel - v;
  SNAP.copy(LX).multiplyScalar(du);
  target.add(SNAP);
  SNAP.copy(LY).multiplyScalar(dv);
  target.add(SNAP);
  return target;
}

/** Shared material of all shadow proxies: invisible in the main pass (no colour, no depth), casts in the shadow pass. */
let PROXY_MAT = null;
export function proxyMaterial() {
  if (!PROXY_MAT) {
    PROXY_MAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    PROXY_MAT.name = 'shadowProxy';
  }
  return PROXY_MAT;
}

let CURRENT = null;

/**
 * Create the light rig.
 * @param {THREE.Scene} scene
 * @param {object} quality  quality object (tier = boot tier; loadTier decides whether the spot exists)
 * @returns {LightRig}
 */
export function createLights(scene, quality) {
  const rig = new LightRig(scene, quality);
  CURRENT = rig;
  return rig;
}

/** Module-level convenience: preset on the most recently created rig. */
export function setPreset(name, seconds) {
  if (CURRENT) CURRENT.setPreset(name, seconds);
}

/** Module-level convenience: shadow fit on the most recently created rig. */
export function updateShadowFit(players, ball) {
  if (CURRENT) CURRENT.updateShadowFit(players, ball);
}

/**
 * Create a shadow proxy for a character (WP2 `Character.createShadowProxy(material)`), registered with the rig so
 * tier changes toggle it. Returns the SkinnedMesh (or null when the character lacks the hook).
 */
export function createShadowProxy(character, mat) {
  if (!character || typeof character.createShadowProxy !== 'function') return null;
  const proxy = character.createShadowProxy(mat || proxyMaterial());
  if (proxy) {
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.renderOrder = 100;
    if (CURRENT) CURRENT.addProxy(proxy);
  }
  return proxy;
}

class LightRig {
  constructor(scene, quality) {
    const q = quality || { tier: 'low', loadTier: 'low' };
    this.scene = scene;
    this.quality = q;
    this.tier = q.tier || 'low';
    const bootTier = q.loadTier || this.tier;
    const L = TIERS[this.tier].lights;
    this.base = { key: L.key, hemi: L.hemi, rim: L.rim, fill: L.fill || 0 };

    this.hemi = new THREE.HemisphereLight(0xfff1e0, 0x5a3f28, L.hemi);
    this.hemi.name = 'hemi';
    this.hemi.position.set(0, 20, 0);

    this.key = new THREE.DirectionalLight(0xfff4e5, L.key);
    this.key.name = 'key';
    this.key.target.position.set(DEFAULT_TARGET_X, 0, DEFAULT_TARGET_Z);
    this.key.position.copy(this.key.target.position).addScaledVector(KEY_DIR, KEY_DIST);
    const cam = this.key.shadow.camera;
    cam.near = 1; cam.far = 60;
    cam.left = -H_MIN; cam.right = H_MIN; cam.top = H_MIN; cam.bottom = -H_MIN;
    cam.updateProjectionMatrix();
    this.h = H_MIN;

    this.rim = new THREE.DirectionalLight(0xd6e4ff, L.rim);
    this.rim.name = 'rim';
    this.rim.position.set(0, 9, -32);
    this.rim.target.position.set(0, 1.0, -6);

    this.fill = new THREE.DirectionalLight(0xf2f5ff, this.base.fill);
    this.fill.name = 'fill';
    this.fill.position.set(0, 7, 34);
    this.fill.target.position.set(0, 1.0, -6);

    this.spot = null;
    if (TIERS[bootTier].introSpot) {
      this.spot = new THREE.SpotLight(0xffffff, 0, 0, 0.32, 0.55, 2);
      this.spot.name = 'spot';
      this.spot.position.set(0, SPOT_HEIGHT, -6);
      this.spot.target.position.set(0, 1.4, -6);
    }

    const lights = [this.hemi, this.key, this.key.target, this.rim, this.rim.target, this.fill, this.fill.target];
    if (this.spot) lights.push(this.spot, this.spot.target);
    for (let i = 0; i < lights.length; i++) {
      lights[i].layers.enable(REFLECT_LAYER);
      if (scene) scene.add(lights[i]);
    }

    this.proxies = [];
    this.crowd = null;
    // Preset blend state.
    this.cur = { key: 1, hemi: 1, rim: 1, fill: 1, env: 0.55, crowd: 1, spot: 0 };
    this.from = { key: 1, hemi: 1, rim: 1, fill: 1, env: 0.55, crowd: 1, spot: 0 };
    this.to = PRESETS.play;
    this.blendT = 1;
    this.blendDur = 0;
    this.presetName = 'play';
    if (scene) scene.environmentIntensity = this.cur.env;
    this.setTier(this.tier, null);
    this._apply();
  }

  /** Register a crowd (object with setDim(v)) driven by the preset crowd multiplier. */
  setCrowd(crowd) {
    this.crowd = crowd || null;
    this._apply();
  }

  addProxy(proxy) {
    this.proxies.push(proxy);
    proxy.visible = TIERS[this.tier].shadows.proxies;
  }

  removeProxy(proxy) {
    const i = this.proxies.indexOf(proxy);
    if (i >= 0) this.proxies.splice(i, 1);
  }

  /**
   * Start a preset blend (§6.1). Unknown names are ignored.
   * @param {string} name play | intro | pause | replay | gameover
   * @param {number} [seconds=0.6] 0 = immediate
   */
  setPreset(name, seconds) {
    const p = PRESETS[name];
    if (!p) return;
    const c = this.cur, f = this.from;
    f.key = c.key; f.hemi = c.hemi; f.rim = c.rim; f.fill = c.fill; f.env = c.env; f.crowd = c.crowd; f.spot = c.spot;
    this.to = p;
    this.presetName = name;
    this.blendDur = seconds === undefined ? 0.6 : Math.max(0, seconds);
    this.blendT = 0;
    if (this.blendDur === 0) { this.blendT = 1; this._lerp(1); this._apply(); }
  }

  /** Aim the spot 12 m above a presented player, at his chest (y = chest height). */
  setSpotTarget(x, chestY, z) {
    if (!this.spot) return;
    this.spot.position.set(x, SPOT_HEIGHT, z);
    this.spot.target.position.set(x, chestY, z);
  }

  /** Advance the preset blend (once per frame). Allocation-free. */
  update(dt) {
    if (this.blendT >= 1) return;
    this.blendT = this.blendDur > 0 ? Math.min(1, this.blendT + dt / this.blendDur) : 1;
    this._lerp(this.blendT);
    this._apply();
  }

  _lerp(t) {
    const c = this.cur, f = this.from, p = this.to;
    c.key = f.key + (p.key - f.key) * t;
    c.hemi = f.hemi + (p.hemi - f.hemi) * t;
    c.rim = f.rim + (p.rim - f.rim) * t;
    c.fill = f.fill + (p.fill - f.fill) * t;
    c.env = f.env + (p.env - f.env) * t;
    c.crowd = f.crowd + (p.crowd - f.crowd) * t;
    c.spot = f.spot + (p.spot - f.spot) * t;
  }

  _apply() {
    const c = this.cur;
    this.key.intensity = this.base.key * c.key;
    this.hemi.intensity = this.base.hemi * c.hemi;
    this.rim.intensity = this.base.rim * c.rim;
    this.fill.intensity = this.base.fill * c.fill;
    if (this.spot) this.spot.intensity = c.spot;
    if (this.scene) this.scene.environmentIntensity = c.env;
    if (this.crowd && typeof this.crowd.setDim === 'function') this.crowd.setDim(c.crowd);
  }

  /** Override the key base intensity (B42 calibration window [2.0, 3.2]). */
  setKeyBase(v) {
    this.base.key = Math.min(3.2, Math.max(2.0, v));
    this._apply();
  }

  /**
   * Runtime tier switch (at a CHECK, before renderer.compile): base intensities of the tier, shadow map on/off
   * and map size (the old map is disposed, `map = null`, every material in the scene `needsUpdate`), proxies.
   * @param {string} tier
   * @param {THREE.WebGLRenderer|null} renderer
   */
  setTier(tier, renderer) {
    const T = TIERS[tier] || TIERS.low;
    const prevMap = this.key.castShadow;
    const prevSize = this.key.shadow.mapSize.x;
    this.tier = tier;
    this.base.key = T.lights.key;
    this.base.hemi = T.lights.hemi;
    this.base.rim = T.lights.rim;
    this.base.fill = T.lights.fill || 0;
    const S = T.shadows;
    const on = !!S.map;
    if (renderer) renderer.shadowMap.enabled = on;
    this.key.castShadow = on;
    if (on) {
      if (prevSize !== S.mapSize && this.key.shadow.map) {
        this.key.shadow.map.dispose();
        this.key.shadow.map = null;
      }
      this.key.shadow.mapSize.set(S.mapSize, S.mapSize);
      this.key.shadow.radius = S.radius;
      this.key.shadow.bias = S.bias;
      this.key.shadow.normalBias = S.normalBias;
      this.key.shadow.intensity = S.intensity;
      trackTexture(this.key.shadow, 4, false, S.mapSize, S.mapSize);
    } else {
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
      untrackTexture(this.key.shadow);
    }
    for (let i = 0; i < this.proxies.length; i++) this.proxies[i].visible = !!S.proxies;
    if ((prevMap !== on || prevSize !== S.mapSize) && this.scene && renderer) {
      this.scene.traverse((o) => {
        const m = o.material;
        if (!m) return;
        if (Array.isArray(m)) for (let k = 0; k < m.length; k++) m[k].needsUpdate = true;
        else m.needsUpdate = true;
      });
    }
    this._apply();
  }

  /**
   * Fit the shadow frustum around the players and the ball (allocation-free; call after animation, before
   * render). `players` items may expose `pos` ({x, z}), `object.position`, `position` or `x/z`.
   * @param {ArrayLike<object>} players
   * @param {{pos?:{x:number,z:number}, x?:number, z?:number}|null} ball
   */
  updateShadowFit(players, ball) {
    if (!this.key.castShadow) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const n = players ? players.length : 0;
    for (let i = 0; i < n; i++) {
      const p = players[i];
      if (!p) continue;
      const src = p.pos || (p.object && p.object.position) || p.position || p;
      const x = src.x, z = src.z;
      if (!(x === x) || !(z === z)) continue;             // NaN guard
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (ball) {
      const src = ball.pos || ball.position || ball;
      if (src.x === src.x && src.z === src.z) {
        if (src.x < minX) minX = src.x; if (src.x > maxX) maxX = src.x;
        if (src.z < minZ) minZ = src.z; if (src.z > maxZ) maxZ = src.z;
      }
    }
    if (minX === Infinity) { minX = maxX = DEFAULT_TARGET_X; minZ = maxZ = DEFAULT_TARGET_Z; }
    const h = fitHalfSize(minX, maxX, minZ, maxZ);
    const cam = this.key.shadow.camera;
    if (h !== this.h) {
      this.h = h;
      cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h;
      cam.updateProjectionMatrix();
    }
    const t = this.key.target.position;
    t.set(0.5 * (minX + maxX), 0, 0.5 * (minZ + maxZ));
    snapToTexels(t, h, this.key.shadow.mapSize.x || 1024);
    this.key.position.copy(t).addScaledVector(KEY_DIR, KEY_DIST);
  }

  dispose() {
    const lights = [this.hemi, this.key, this.key.target, this.rim, this.rim.target, this.fill, this.fill.target];
    if (this.spot) lights.push(this.spot, this.spot.target);
    for (let i = 0; i < lights.length; i++) if (lights[i].parent) lights[i].parent.remove(lights[i]);
    if (this.key.shadow.map) this.key.shadow.map.dispose();
    untrackTexture(this.key.shadow);
    if (CURRENT === this) CURRENT = null;
  }
}

export { LightRig };
