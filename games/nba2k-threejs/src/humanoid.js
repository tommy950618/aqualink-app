// Low-poly player model (spec section 6 / 6.1, section 14 row 12): shared geometries built once,
// two Lambert materials per team plus shared skin/shoe materials, a blob shadow, the controlled-player
// marker and the pose system. Every pose writes joint targets into a module-level scratch object and the
// joints are damped toward them each frame, so state changes never pop. No allocations in setPose/handWorld.
import * as THREE from '../vendor/three.module.js';
import { COLORS } from './constants.js';
import { clamp, damp, TAU } from './math.js';
import { makeBlobTexture } from './scene.js';

// Skeleton dimensions (metres). Feet at y 0, hips 0.95, shoulders 1.42, head centre 1.72 (top 1.84).
const HIP_Y = 0.95;
const HIP_Y_DEFEND = 0.85;
const HIP_X = 0.11;
const SHOULDER_X = 0.27;
const SHOULDER_Y = 1.42;
const HEAD_Y = 1.72;
const UPPER_ARM_LEN = 0.30;
const FOREARM_LEN = 0.30;
const LEG_LEN = 0.85;
const SHOE_H = 0.08;
const SHOE_FWD = 0.05;
const SHOE_Y = -LEG_LEN - SHOE_H / 2;   // shoe centre at the leg end, sole 2 cm below it

// Pose tuning (section 6.1).
const BLEND_RATE = 18;                  // joint damping rate (1/s)
const RUN_MIN_SPEED = 0.3;              // below this "run" collapses to idle
const RUN_PHASE_RATE = 1.9;             // phi += speed * 1.9 * dt
const DEFEND_MAX_SPEED = 2.0;           // defensive stance only while slower than this
const FOLLOW_THROUGH_T = 0.25;          // forearms snap straight for this long after release
const ARMS_OUT = 0.1;                   // idle arm splay (rotZ)

// Shadow and marker (section 6).
const SHADOW_Y = 0.01;
const SHADOW_OPACITY = 0.45;
const SHADOW_JUMP_REF = 0.9;            // scale = 1 - 0.4 * clamp(jumpY / 0.9)
const SHADOW_SHRINK = 0.4;
const MARKER_ABOVE_HEAD = 0.35;
const MARKER_BOB = 0.05;
const MARKER_HZ = 2;
const RING_Y = 0.02;

const EMPTY_PARAMS = Object.freeze({});
const JOINT_KEYS = Object.freeze([
  'torsoX', 'torsoZ',
  'uaLX', 'uaLZ', 'uaRX', 'uaRZ',
  'faLX', 'faRX',
  'legLX', 'legLZ', 'legRX', 'legRZ',
  'hipY',
]);

// Module-level scratch: the pose targets for the humanoid currently being posed.
const TGT = {
  torsoX: 0, torsoZ: 0,
  uaLX: 0, uaLZ: -ARMS_OUT, uaRX: 0, uaRZ: ARMS_OUT,
  faLX: 0, faRX: 0,
  legLX: 0, legLZ: 0, legRX: 0, legRZ: 0,
  hipY: HIP_Y,
  bob: 0,             // applied to the pelvis without damping (run bob, celebration hop)
  snapForearms: false // bypass damping on the forearms this frame (release follow-through)
};
const V_HAND_L = new THREE.Vector3();
const V_HAND_R = new THREE.Vector3();

let sharedGeometry = null;
let sharedMaterials = null;
const teamMaterialCache = new Map();

// Shared geometry and materials

// Builds every geometry once. Boxes are translated so each mesh's local origin is its pivot:
// limbs hang down from (0,0,0), the torso rises from the hips, the shorts hang from the hips.
export function buildSharedGeometry() {
  if (sharedGeometry) return sharedGeometry;
  const shorts = new THREE.BoxGeometry(0.40, 0.30, 0.24).translate(0, -0.15, 0);
  const torso = new THREE.BoxGeometry(0.42, 0.52, 0.24).translate(0, 0.26, 0);
  const head = new THREE.SphereGeometry(0.12, 8, 6);
  const upperArm = new THREE.BoxGeometry(0.10, UPPER_ARM_LEN, 0.10).translate(0, -UPPER_ARM_LEN / 2, 0);
  const forearm = new THREE.BoxGeometry(0.09, FOREARM_LEN, 0.09).translate(0, -FOREARM_LEN / 2, 0);
  const leg = new THREE.BoxGeometry(0.14, LEG_LEN, 0.14).translate(0, -LEG_LEN / 2, 0);
  const shoe = new THREE.BoxGeometry(0.14, SHOE_H, 0.26);
  const shadow = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
  // Marker cone: apex at the mesh origin, pointing down.
  const cone = new THREE.ConeGeometry(0.15, 0.3, 6).rotateX(Math.PI).translate(0, 0.15, 0);
  const ring = new THREE.RingGeometry(0.45, 0.55, 24).rotateX(-Math.PI / 2);
  sharedGeometry = Object.freeze({ shorts, torso, head, upperArm, forearm, leg, shoe, shadow, cone, ring });
  return sharedGeometry;
}

function getSharedMaterials() {
  if (sharedMaterials) return sharedMaterials;
  const skin = COLORS.skin.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const shoe = new THREE.MeshLambertMaterial({ color: COLORS.shoe });
  let blob = null;
  try { blob = makeBlobTexture(); } catch (err) { blob = null; } // headless (no canvas) fallback
  const shadow = new THREE.MeshBasicMaterial({
    map: blob,
    color: blob ? 0xffffff : 0x000000,
    transparent: true,
    depthWrite: false,
    opacity: SHADOW_OPACITY,
  });
  sharedMaterials = Object.freeze({ skin: Object.freeze(skin), shoe, shadow, blob });
  return sharedMaterials;
}

// Jersey + shorts Lambert materials, cached per team id, plus the shared skin[] and shoe materials.
export function getTeamMaterials(team) {
  const key = team && team.id !== undefined ? team.id : String(team);
  let mats = teamMaterialCache.get(key);
  if (!mats) {
    const shared = getSharedMaterials();
    mats = Object.freeze({
      jersey: new THREE.MeshLambertMaterial({ color: team.jersey }),
      shorts: new THREE.MeshLambertMaterial({ color: team.shorts }),
      skin: shared.skin,
      shoe: shared.shoe,
    });
    teamMaterialCache.set(key, mats);
  }
  return mats;
}

function makeMesh(geometry, material, name, parent, x, y, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// Pose targets. Conventions: negative rotX swings a hanging limb forward/up (local +Z is forward),
// positive torso rotX leans forward, rotZ splays the right limb outward for +, the left for -.

function resetTargets(lean) {
  TGT.torsoX = lean; TGT.torsoZ = 0;
  TGT.uaLX = 0; TGT.uaLZ = -ARMS_OUT; TGT.uaRX = 0; TGT.uaRZ = ARMS_OUT;
  TGT.faLX = 0; TGT.faRX = 0;
  TGT.legLX = 0; TGT.legLZ = 0; TGT.legRX = 0; TGT.legRZ = 0;
  TGT.hipY = HIP_Y;
  TGT.bob = 0;
  TGT.snapForearms = false;
}

function poseIdle(t) {
  TGT.torsoZ = Math.sin(t * 1.5) * 0.03;
}

// Stride cycle. Damping softens the sinusoid slightly (about 13 % at run speed), which is intended.
function poseRun(phi, s) {
  const A = 0.35 + 0.05 * s;
  const sw = Math.sin(phi);
  TGT.legLX = A * sw;
  TGT.legRX = -A * sw;
  TGT.uaLX = -0.8 * A * sw;
  TGT.uaRX = 0.8 * A * sw;
  TGT.faLX = -0.6;
  TGT.faRX = -0.6;
  TGT.bob = 0.04 * Math.abs(sw);
  TGT.torsoX += 0.05 + 0.02 * s;
}

function poseLocomotion(t, phi, s) {
  if (s > RUN_MIN_SPEED) poseRun(phi, s); else poseIdle(t);
}

// Dribbling arm follows the ball: bent at the chest when the ball is up, extended when it is low.
function poseDribbleArm(handSign, ballY) {
  const fa = -0.3 - 0.9 * clamp((ballY - 0.12) / 0.8, 0, 1);
  if (handSign > 0) { TGT.uaRX = -0.4; TGT.faRX = fa; } else { TGT.uaLX = -0.4; TGT.faLX = fa; }
}

function poseWindup(f, jumpY) {
  TGT.uaLX = -2.4; TGT.uaRX = -2.4;
  const fa = -1.2 + 1.2 * clamp(f, 0, 1);
  TGT.faLX = fa; TGT.faRX = fa;
  if (jumpY > 0) { TGT.legLX = -0.3; TGT.legRX = -0.3; }
}

// Follow-through: forearms snap straight at release, then the arms settle while landing.
function poseRelease(releaseAge, jumpY) {
  if (releaseAge < FOLLOW_THROUGH_T) {
    TGT.uaLX = -2.4; TGT.uaRX = -2.4;
    TGT.faLX = 0; TGT.faRX = 0;
    TGT.snapForearms = true;
  } else {
    TGT.uaLX = -1.6; TGT.uaRX = -1.6;
    TGT.faLX = -0.4; TGT.faRX = -0.4;
  }
  if (jumpY > 0) { TGT.legLX = -0.3; TGT.legRX = -0.3; }
}

function poseLayup(handSign) {
  if (handSign > 0) {
    TGT.uaRX = -2.9; TGT.uaLX = -1.2;
    TGT.legLX = -0.6; TGT.legRX = 0.4;    // off-hand knee drives up, shooting-side leg trails
  } else {
    TGT.uaLX = -2.9; TGT.uaRX = -1.2;
    TGT.legRX = -0.6; TGT.legLX = 0.4;
  }
  TGT.torsoX += 0.05;
}

function poseDunk() {
  TGT.uaLX = -3.0; TGT.uaRX = -3.0;
  TGT.uaLZ = -0.2; TGT.uaRZ = 0.2;
  TGT.torsoX += 0.15;
  TGT.legLX = -0.6; TGT.legRX = -0.6;
}

function poseDefend() {
  TGT.hipY = HIP_Y_DEFEND;
  TGT.legLZ = -0.25; TGT.legRZ = 0.25;
  TGT.torsoX += 0.25;
  TGT.uaLZ = -1.2; TGT.uaRZ = 1.2;
  TGT.uaLX = -0.5; TGT.uaRX = -0.5;
  TGT.faLX = -0.4; TGT.faRX = -0.4;
}

function poseJump() {
  TGT.uaLX = -3.0; TGT.uaRX = -3.0;
  TGT.uaLZ = -0.15; TGT.uaRZ = 0.15;
  TGT.legLX = -0.4; TGT.legRX = -0.4;
}

function poseSteal(handSign) {
  if (handSign > 0) { TGT.uaRX = -1.4; TGT.faRX = 0; } else { TGT.uaLX = -1.4; TGT.faLX = 0; }
  TGT.torsoX += 0.35;
}

function poseStunned() {
  TGT.torsoX += -0.2;
  TGT.uaLZ = -0.3; TGT.uaRZ = 0.3;
}

function poseCelebrate(t) {
  TGT.uaLX = -2.8; TGT.uaRX = -2.8;
  TGT.uaLZ = -0.25; TGT.uaRZ = 0.25;
  TGT.bob = 0.15 * Math.abs(Math.sin(Math.PI * t / 0.4));
}

function poseCross(handSign) {
  TGT.torsoX += 0.15;
  TGT.torsoZ = -handSign * 0.12;   // tilt into the new dribbling side
}

function sideSign(side) {
  if (side === undefined || side === null) return 0;
  if (typeof side === 'number') return side < 0 ? -1 : 1;
  const c = String(side).charAt(0);
  return c === 'L' || c === 'l' || c === '-' ? -1 : 1;
}

// Humanoid

// group origin = feet on the floor; callers set group.position (x, 0, z) and group.rotation.y = yaw.
export function createHumanoid(team, skinIdx) {
  const g = buildSharedGeometry();
  const m = getTeamMaterials(team);
  const skin = m.skin[((skinIdx | 0) % m.skin.length + m.skin.length) % m.skin.length];

  const group = new THREE.Group();
  group.name = 'humanoid';
  const pelvis = new THREE.Group();
  pelvis.name = 'pelvis';
  pelvis.position.y = HIP_Y;
  group.add(pelvis);

  const shorts = makeMesh(g.shorts, m.shorts, 'shorts', pelvis, 0, 0, 0);
  const torso = makeMesh(g.torso, m.jersey, 'torso', pelvis, 0, 0, 0);
  const head = makeMesh(g.head, skin, 'head', torso, 0, HEAD_Y - HIP_Y, 0);
  const upperArmL = makeMesh(g.upperArm, m.jersey, 'upperArmL', torso, -SHOULDER_X, SHOULDER_Y - HIP_Y, 0);
  const upperArmR = makeMesh(g.upperArm, m.jersey, 'upperArmR', torso, SHOULDER_X, SHOULDER_Y - HIP_Y, 0);
  const forearmL = makeMesh(g.forearm, skin, 'forearmL', upperArmL, 0, -UPPER_ARM_LEN, 0);
  const forearmR = makeMesh(g.forearm, skin, 'forearmR', upperArmR, 0, -UPPER_ARM_LEN, 0);
  const legL = makeMesh(g.leg, skin, 'legL', pelvis, -HIP_X, 0, 0);
  const legR = makeMesh(g.leg, skin, 'legR', pelvis, HIP_X, 0, 0);
  const shoeL = makeMesh(g.shoe, m.shoe, 'shoeL', legL, 0, SHOE_Y, SHOE_FWD);
  const shoeR = makeMesh(g.shoe, m.shoe, 'shoeR', legR, 0, SHOE_Y, SHOE_FWD);

  const shadow = makeMesh(g.shadow, getSharedMaterials().shadow, 'shadow', group, 0, SHADOW_Y, 0);
  shadow.renderOrder = -1;

  upperArmL.rotation.z = -ARMS_OUT;
  upperArmR.rotation.z = ARMS_OUT;

  const parts = Object.freeze({ shorts, torso, head, upperArmL, upperArmR, forearmL, forearmR, legL, legR, shoeL, shoeR });

  // Current (damped) joint values; same keys as TGT minus bob/snap.
  resetTargets(0);
  const joints = {};
  for (let i = 0; i < JOINT_KEYS.length; i++) joints[JOINT_KEYS[i]] = TGT[JOINT_KEYS[i]];

  const h = {
    group,
    pelvis,
    parts,
    shadow,
    team,
    handSign: 1,
    jumpY: 0,
    phase: 0,        // internal stride phase, used when params.phi is not supplied
    pose: 'idle',
    joints,

    // params: { t, phi, speed, f, ballY, handSign, jumpY, lean, releaseAge, dt }. Omitted fields default
    // to 0 (handSign to +1, ballY to the floor). dt = 0 (or omitted) snaps joints to the target.
    setPose(pose, params) {
      const p = params || EMPTY_PARAMS;
      const dt = p.dt > 0 ? p.dt : 0;
      const t = p.t || 0;
      const s = p.speed > 0 ? p.speed : 0;
      const f = p.f || 0;
      const ballY = p.ballY > 0 ? p.ballY : 0.12;
      const hs = p.handSign === undefined || p.handSign === null ? this.handSign : (p.handSign < 0 ? -1 : 1);
      const jumpY = p.jumpY > 0 ? p.jumpY : 0;
      const lean = p.lean || 0;
      const releaseAge = p.releaseAge > 0 ? p.releaseAge : 0;
      let phi;
      if (typeof p.phi === 'number' && Number.isFinite(p.phi)) {
        phi = p.phi;
      } else {
        this.phase += s * RUN_PHASE_RATE * dt;
        if (this.phase > TAU) this.phase -= TAU;
        phi = this.phase;
      }
      this.handSign = hs;
      this.jumpY = jumpY;
      this.pose = pose;

      resetTargets(lean);
      switch (pose) {
        case 'run':
        case 'move':
          poseLocomotion(t, phi, s);
          break;
        case 'dribble':
          poseLocomotion(t, phi, s);
          poseDribbleArm(hs, ballY);
          break;
        case 'cross':
          poseLocomotion(t, phi, s);
          poseDribbleArm(hs, ballY);
          poseCross(hs);
          break;
        case 'windup':
        case 'shoot':
          poseWindup(f, jumpY);
          break;
        case 'release':
          poseRelease(releaseAge, jumpY);
          break;
        case 'layup':
          poseLayup(hs);
          break;
        case 'dunk':
          poseDunk();
          break;
        case 'defend':
          if (s < DEFEND_MAX_SPEED) poseDefend(); else poseRun(phi, s);
          break;
        case 'jump':
        case 'block':
          poseJump();
          break;
        case 'steal':
          poseLocomotion(t, phi, s);
          poseSteal(hs);
          break;
        case 'stunned':
          poseStunned();
          break;
        case 'celebrate':
          poseCelebrate(t);
          break;
        default:
          poseIdle(t);
          break;
      }

      // Blend every joint toward its target; dt = 0 snaps.
      const j = this.joints;
      if (dt > 0) {
        for (let i = 0; i < JOINT_KEYS.length; i++) {
          const k = JOINT_KEYS[i];
          j[k] = damp(j[k], TGT[k], BLEND_RATE, dt);
        }
      } else {
        for (let i = 0; i < JOINT_KEYS.length; i++) {
          const k = JOINT_KEYS[i];
          j[k] = TGT[k];
        }
      }
      if (TGT.snapForearms) { j.faLX = TGT.faLX; j.faRX = TGT.faRX; }

      torso.rotation.x = j.torsoX;
      torso.rotation.z = j.torsoZ;
      upperArmL.rotation.x = j.uaLX;
      upperArmL.rotation.z = j.uaLZ;
      upperArmR.rotation.x = j.uaRX;
      upperArmR.rotation.z = j.uaRZ;
      forearmL.rotation.x = j.faLX;
      forearmR.rotation.x = j.faRX;
      legL.rotation.x = j.legLX;
      legL.rotation.z = j.legLZ;
      legR.rotation.x = j.legRX;
      legR.rotation.z = j.legRZ;
      pelvis.position.y = j.hipY + jumpY + TGT.bob;

      const sc = 1 - SHADOW_SHRINK * clamp(jumpY / SHADOW_JUMP_REF, 0, 1);
      shadow.scale.set(sc, 1, sc);
    },

    // World position of a hand (end of the forearm). side: +1/'R' right, -1/'L' left, omitted = the
    // current dribbling/shooting hand. Refreshes the matrices so it is valid mid-step, before a render.
    handWorld(out, side) {
      const sgn = sideSign(side) || this.handSign;
      group.updateMatrixWorld(true);
      const fa = sgn < 0 ? forearmL : forearmR;
      return out.set(0, -FOREARM_LEN, 0).applyMatrix4(fa.matrixWorld);
    },

    // Midpoint of both hands (the ball position during a dunk).
    handsMidWorld(out) {
      group.updateMatrixWorld(true);
      V_HAND_L.set(0, -FOREARM_LEN, 0).applyMatrix4(forearmL.matrixWorld);
      V_HAND_R.set(0, -FOREARM_LEN, 0).applyMatrix4(forearmR.matrixWorld);
      return out.copy(V_HAND_L).add(V_HAND_R).multiplyScalar(0.5);
    },

    // World position of the head centre (meter placement, marker anchor).
    headWorld(out) {
      group.updateMatrixWorld(true);
      return out.set(0, 0, 0).applyMatrix4(head.matrixWorld);
    },

    // Head centre height above the floor for the current pose (cheap, no matrix update).
    headY() {
      return pelvis.position.y + (HEAD_Y - HIP_Y);
    },
  };
  return h;
}

// Controlled-player marker: a downward cone bobbing above the head and a floor ring, team colour.

export function createMarker(color) {
  const g = buildSharedGeometry();
  const coneMat = new THREE.MeshBasicMaterial({ color });
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(g.cone, coneMat);
  cone.name = 'markerCone';
  const ring = new THREE.Mesh(g.ring, ringMat);
  ring.name = 'markerRing';
  ring.position.y = RING_Y;
  const group = new THREE.Group();
  group.name = 'marker';
  group.add(cone, ring);
  return {
    group,
    cone,
    ring,
    // Place the marker over a player: feet (x, z), head centre height headY, animation time t.
    update(x, z, headY, t) {
      group.position.x = x;
      group.position.z = z;
      cone.position.y = headY + MARKER_ABOVE_HEAD + MARKER_BOB * Math.sin(TAU * MARKER_HZ * t);
    },
    setColor(c) {
      coneMat.color.set(c);
      ringMat.color.set(c);
    },
  };
}
