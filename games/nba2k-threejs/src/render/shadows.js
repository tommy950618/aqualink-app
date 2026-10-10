/**
 * @module render/shadows
 * Shared blob contact shadows (SPEC-v2 §6.1, PR §1.3, R#5): ONE blob texture and ONE plane geometry for every
 * blob in the game, drawn as one `InstancedMesh` of 7 (6 players + ball). Per-instance opacity is written into
 * `instanceColor.r` and applied by a one-line `onBeforeCompile` patch (`diffuseColor.a *= vColor.r;` after
 * `<color_fragment>`); rgb stays black because the material colour is black.
 *
 * Low tier: blobs are the only shadows (players 0.45, ball 0.5 → 0.15 over 0 → 3 m height).
 * Medium/high: they stay as contact AO (players 0.25, ball 0.20) under the PCF shadow map.
 * The texture is a DataTexture (pure, Node-safe; no canvas).
 */
import * as THREE from '../../vendor/three.module.js';
import { TIERS, trackTexture } from './quality.js';

const BLOB_SIZE = 64;
const BLOB_Y = 0.004;
const PLAYERS = 6;
const BALL_SLOT = 6;
const BALL_BLOB_M = 0.35;

let SHARED = null;

/**
 * Radial falloff of the blob: opaque core, smooth edge (alpha only; rgb black).
 * Alpha = (1 − smoothstep(0.15, 1.0, r))^1.6 with r = distance from the centre / half size.
 */
export function blobAlpha(r) {
  if (r >= 1) return 0;
  const t = r <= 0.15 ? 0 : (r - 0.15) / 0.85;
  const s = t * t * (3 - 2 * t);
  return Math.pow(1 - s, 1.6);
}

/** The one shared blob `{texture, geometry}` (R#5). */
export function sharedBlob() {
  if (SHARED) return SHARED;
  const n = BLOB_SIZE;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
      const a = blobAlpha(Math.sqrt(dx * dx + dy * dy));
      const i = (y * n + x) * 4;
      data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  trackTexture(texture, 4, true);
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  SHARED = { texture, geometry };
  return SHARED;
}

const M4 = new THREE.Matrix4();
const POS = new THREE.Vector3();
const QUAT = new THREE.Quaternion();
const SCL = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const COL = new THREE.Color();

/**
 * Seven instanced blobs. Slots 0..5 = players, 6 = ball.
 * Usage per frame: `setPlayer(i, x, z, shoulderJoints, yaw, visible)` ×6, `setBall(x, y, z, visible)`, `commit()`.
 */
export class BlobShadows {
  /**
   * @param {THREE.Scene|null} scene
   * @param {string} [tier='low']  live tier (opacities)
   */
  constructor(scene, tier = 'low') {
    const { texture, geometry } = sharedBlob();
    const material = new THREE.MeshBasicMaterial({
      map: texture, color: 0x000000, transparent: true, depthWrite: false,
    });
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n\tdiffuseColor.a *= vColor.r;'
      );
    };
    material.customProgramCacheKey = () => 'blob-v2';
    this.material = material;
    this.mesh = new THREE.InstancedMesh(geometry, material, PLAYERS + 1);
    this.mesh.name = 'blobShadows';
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i <= PLAYERS; i++) {
      M4.makeScale(0, 1, 0);
      this.mesh.setMatrixAt(i, M4);
      this.mesh.setColorAt(i, COL.setRGB(0, 0, 0));
    }
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.setTier(tier);
    if (scene) scene.add(this.mesh);
  }

  /** Tier switch: opacities 0.45 / 0.5→0.15 (low) or 0.25 / 0.20 (medium/high AO). */
  setTier(tier) {
    const s = (TIERS[tier] || TIERS.low).shadows;
    this.playerOpacity = s.blobPlayer;
    this.ballNear = s.blobBallNear;
    this.ballFar = s.blobBallFar;
  }

  /**
   * Player blob under the pelvis: scale x = 0.95·(shoulderJoints/0.46) m, z = 0.80 × that, rotated by the yaw.
   * @param {number} i slot 0..5
   */
  setPlayer(i, x, z, shoulderJoints, yaw, visible) {
    if (i < 0 || i >= PLAYERS) return;
    const sx = 0.95 * ((shoulderJoints || 0.46) / 0.46);
    if (visible) {
      POS.set(x, BLOB_Y, z);
      QUAT.setFromAxisAngle(UP, yaw || 0);
      SCL.set(sx, 1, sx * 0.8);
      M4.compose(POS, QUAT, SCL);
      this.mesh.setMatrixAt(i, M4);
      this.mesh.setColorAt(i, COL.setRGB(this.playerOpacity, 0, 0));
    } else {
      this.mesh.setColorAt(i, COL.setRGB(0, 0, 0));
    }
  }

  /** Ball blob: 0.35 m; opacity lerps near → far as the ball height goes 0 → 3 m. */
  setBall(x, y, z, visible) {
    if (visible) {
      const t = Math.min(1, Math.max(0, y / 3));
      const op = this.ballNear + (this.ballFar - this.ballNear) * t;
      POS.set(x, BLOB_Y + 0.0005, z);
      QUAT.identity();
      SCL.set(BALL_BLOB_M, 1, BALL_BLOB_M);
      M4.compose(POS, QUAT, SCL);
      this.mesh.setMatrixAt(BALL_SLOT, M4);
      this.mesh.setColorAt(BALL_SLOT, COL.setRGB(op, 0, 0));
    } else {
      this.mesh.setColorAt(BALL_SLOT, COL.setRGB(0, 0, 0));
    }
  }

  /** Upload the instance buffers once per frame (after the set* calls). */
  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.dispose();
    this.material.dispose();
  }
}
