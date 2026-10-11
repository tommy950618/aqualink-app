// test/unit-anim-runtime.mjs — animator runtime tests (WP3b: ik.js, locomotion.js, dribble.js, look.js, animator.js;
// spec §4.2–§4.8, §4.14, §4.15, [ANIM §11.2] groups 3 IK, 4 gait, 6 dunk IK, 8 zero allocation + layers, events,
// dribble, look-at, foot locks, faces, capture / applyBlend). Node ≥ 18, no browser.
//   node test/unit-anim-runtime.mjs                 all groups (alloc re-spawns itself with --expose-gc)
//   node test/unit-anim-runtime.mjs --group=gait    one group: ik, footlock, gait, layers, events, dribble, look, dunk,
//                                                   faces, capture, alloc
// Test clips: WP3a's worked examples (EXAMPLE_CROSS, exampleJumper from test/unit-anim.mjs) plus the generic
// dunk.power2 ([ANIM §5.6]), pass.chest (§7.2), def.block1 (§6.5) and an upper-body wave written below (test data
// only — the shipped clip library is src/anim/clips/*, WP3c).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

import * as THREE from '../vendor/three.module.js';
import { BONE, BONE_COUNT, BONE_NAMES, BONE_PARENT, SOCK, buildRig, anatQuat, AQ, toLocal, qrotate } from '../src/anim/rig.js';
import { EV, BM, HAND, defineClip, registerClip, clipIndex, clipTiming, sampleRoot } from '../src/anim/clip.js';
import { MASK_W, MASK, EXPR } from '../src/anim/pose.js';
import { FINGER_ID, FINGER_BONES, fingerQuats } from '../src/anim/presets.js';
import { FORMS, STYLE, SHORT, PLAYER_IDS } from '../src/anim/presets.js';
import { RIM_POS, CLIP_IDS } from '../src/anim/select.js';
import { Skel, twoBoneIK, footLock, FootTarget, handToPoint, LEG_IK, ARM_IK } from '../src/anim/ik.js';
import { Gait, GAIT, FOOT, strideOf, gaitParams } from '../src/anim/locomotion.js';
import { Dribble, dribbleKinematics } from '../src/anim/dribble.js';
import { LookAt, LOOK_LIMITS } from '../src/anim/look.js';
import { Animator, ANIM_CAPTURE_FLOATS, FACE_AR } from '../src/anim/animator.js';
import { EXAMPLE_CROSS, exampleJumper } from './unit-anim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const G = 9.81, DT = 1 / 60, DEG = Math.PI / 180;
const th = (h, g = 1) => Math.sqrt(2 * h / (G * g));

// ------------------------------------------------------------------------------------------------ tiny harness
let failures = 0, passes = 0;
const log = [];
function ok(cond, msg) { if (cond) passes++; else { failures++; log.push('  FAIL ' + msg); } return !!cond; }
function near(a, b, tol, msg) { return ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`); }
function note(msg) { log.push('  note: ' + msg); }
/** Deterministic test RNG (mulberry32; tests only). */
function testRng(seed) {
  let a = seed >>> 0;
  return { next() { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } };
}

// ------------------------------------------------------------------------------------------------ rigs
const HDR_FILE = [path.join(ROOT, 'assets/legends/legends.json'), path.join(ROOT, 'test/scratch/legends-poc/assets/legends.json')].find((f) => fs.existsSync(f));
const HDR = JSON.parse(fs.readFileSync(HDR_FILE, 'utf8'));
const RIGS = {};
for (const p of HDR.players) if (PLAYER_IDS.includes(p.id)) RIGS[p.id] = buildRig(p, HDR.bones);

// ------------------------------------------------------------------------------------------------ test clips
/** dunk.power2 ([ANIM §5.6]) for player p (two-hand, jump stop, hang 0.20 s), per-player times. */
export function testDunk(p) {
  const h = FORMS[p].dunk.h2, TO = 0.26, T = th(h);
  const slam = TO + T - 0.03, grab = slam + 0.03, rel = grab + 0.20, land = rel + Math.sqrt(2 * (h - 0.05) / G);
  // air drift dTO − 0.35 = 0.85 m in WORLD metres (spec §4.9.4): R is × sLeg at runtime, so author 0.85 / sLeg
  const air = 0.85 / RIGS[p].metrics.sLeg;
  return defineClip({
    id: 'dunk.power2', dur: land + 0.35, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false,
    jump: { h, hang: 0.20 }, hand: 'R', cancel: land + 0.20, blendIn: 0.10, blendOut: 0.20, target: 'takeoff',
    params: { cat: 'dunk', hands: 2, hang: 0.20, gatherWindow: [0.6, 4.0] },
    keys: [
      [0.00, { P: [0, -0.10, 0, 15, 0, 0], S: [18, 0, 0], RA: [40, 25, 30, 110, 30, -30, 0], LA: [40, 25, 30, 110, 30, -30, 0], B: 'both', RF: 'grip', LF: 'grip', R: [0, 0, 0], look: 'rim', ev: 'gather' }],
      [0.12, { P: [0, -0.18, 0, 18, 0, 0], Rft: [-0.25, 0.60, 5, 'f'], Lft: [0.25, 0.60, -5, 'f'], RL: [50, 8, 0, 85, -25, 0], LL: [50, 8, 0, 85, -25, 0], R: [0, 0.60, 0], ev: ['plantL', 'plantR'] }],
      [TO, { P: [0, -0.02, 0, 0, 0, 0], S: [-5, 0, 0], RA: [150, 15, 10, 40, 40, -30, 0], LA: [150, 15, 10, 40, 40, -30, 0], Rft: null, Lft: null, RL: [10, 6, 0, 15, 40, 0], LL: [10, 6, 0, 15, 40, 0], E: { roar: 0.4 }, R: [0, 0.62, 0], ev: 'takeoff' }],
      [TO + T - 0.10, { RA: [178, 18, 0, 95, 30, -20, 0], LA: [178, 18, 0, 95, 30, -20, 0], S: [-12, 0, 0], N: [-15, 0, 0], RL: [70, 10, 0, 110, 30, 0], LL: [70, 10, 0, 110, 30, 0] }],
      [slam, { RA: [150, 15, 0, 10, 90, 60, 0], LA: [150, 15, 0, 10, 90, 60, 0], S: [15, 0, 0], B: 'free', E: { roar: 0.9 }, R: [0, 0.62 + air, 0], ev: 'slam' }],
      [grab, { RF: 'claw', LF: 'claw', RL: [60, 15, 0, 80, 20, 0], LL: [60, 15, 0, 80, 20, 0], ev: 'rimGrab' }],
      [rel, { RA: [140, 15, 0, 20, 90, 30, 0], LA: [140, 15, 0, 20, 90, 30, 0], ev: 'rimRelease' }],
      [land, { P: [0, -0.15, 0, 15, 0, 0], S: [10, 0, 0], N: [0, 0, 0], RL: [40, 10, 0, 60, -15, 0], LL: [40, 10, 0, 60, -15, 0], Rft: [-0.25, 0.62 + air, 5, 'f'], Lft: [0.25, 0.62 + air, -5, 'f'], RA: [60, 20, 0, 40, 30, 0, 0], LA: [60, 20, 0, 40, 30, 0, 0], RF: 'relax', LF: 'relax', R: [0, 0.62 + air, 0], ev: 'land' }],
      [land + 0.35, { P: [0, -0.04, 0, 5, 0, 0], S: [4, 0, 0], ...SHORT.DOWN }],
    ],
  });
}
/** pass.chest ([ANIM §7.2]); arms and spine only (legs untracked). */
export const TEST_PASS = defineClip({
  id: 'pass.chest', dur: 0.45, mask: 'full', hand: 'R', tempo: true, meter: false, blendIn: 0.06, blendOut: 0.20, params: { cat: 'pass' },
  keys: [
    [0.00, { RA: [35, 15, 30, 105, 20, -30, 0], LA: [35, 15, 30, 105, 20, -30, 0], S: [0, 0, 0], B: 'both', RF: 'grip', LF: 'grip' }],
    [0.05, { RA: [30, 20, 35, 115, 10, -40, 0], LA: [30, 20, 35, 115, 10, -40, 0], S: [-4, null, null] }],
    [0.10, { RA: [75, 10, 10, 15, 80, 40, 0], LA: [75, 10, 10, 15, 80, 40, 0], S: [8, null, null], B: 'free', ev: 'release' }],
    [0.22, { RA: [80, 10, 5, 5, 95, 50, 0], LA: [80, 10, 5, 5, 95, 50, 0] }],
    [0.45, { RA: [5, 10, 0, 12, 0, 0, 0], LA: [5, 10, 0, 12, 0, 0, 0], S: [0, 0, 0] }],
  ],
});
/** def.block1 ([ANIM §6.5]) at the nominal h 0.70. */
export function testBlock(h = 0.70) {
  const TO = 0.08, T = th(h), land = TO + 2 * T;
  return defineClip({
    id: 'def.block1', dur: land + 0.25, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 30, tempo: false, jump: { h }, hand: 'R', blendIn: 0.05, params: { cat: 'block' },
    keys: [
      [0.00, { P: [0, -0.12, 0, 12, 0, 0], RL: [40, 10, 0, 55, -18, 0], LL: [40, 10, 0, 55, -18, 0], RA: [-15, 15, 0, 20, 0, 0, 0], LA: [-15, 15, 0, 20, 0, 0, 0], Rft: [-0.20, 0, 0, 'f'], Lft: [0.20, 0, 0, 'f'], R: [0, 0, 0] }],
      [TO, { P: [0, -0.02, 0, 4, 0, 0], RL: [10, 6, 0, 15, 40, 0], LL: [10, 6, 0, 15, 40, 0], RA: [90, 10, 0, 10, -20, 0, 0], Rft: null, Lft: null, ev: 'takeoff' }],
      [TO + T, { RA: [165, 10, 0, 5, -20, -10, 0], RF: 'spread', S: [8, 10, 0], LA: [120, 30, 0, 30, 0, 0, 0], RL: [20, 8, 0, 35, 35, 0], LL: [20, 8, 0, 35, 35, 0], ev: 'apex' }],
      [land, { P: [0, -0.10, 0, 10, 0, 0], S: [4, 0, 0], RL: [35, 10, 0, 50, -15, 0], LL: [35, 10, 0, 50, -15, 0], Rft: [-0.20, 0, 0, 'f'], Lft: [0.20, 0, 0, 'f'], RA: [60, 20, 0, 30, 0, 0, 0], LA: [60, 20, 0, 30, 0, 0, 0], ev: 'land' }],
      [land + 0.25, { P: [0, -0.04, 0, 5, 0, 0], S: [2, 0, 0], ...SHORT.DOWN, RF: 'relax' }],
    ],
  });
}
/** Upper-layer wave (mask upper): spine, neck, both arms. */
export const TEST_WAVE = defineClip({
  id: 'test.wave', dur: 1.0, mask: 'upper', layer: 'upper', hand: 'R', blendIn: 0.06, blendOut: 0.20, params: { cat: 'other' },
  keys: [
    [0.0, { S: [10, 20, 5], N: [5, 15, 0], RA: [150, 30, 0, 40, 0, 0, 0], LA: [40, 20, 0, 60, 20, 0, 0], RF: 'spread' }],
    [0.5, { RA: [160, 40, 0, 20, 0, 0, 0] }],
    [1.0, { S: [10, 20, 5], N: [5, 15, 0], RA: [150, 30, 0, 40, 0, 0, 0], LA: [40, 20, 0, 60, 20, 0, 0] }],
  ],
});
const IDX = {};
function registerTestClips() {
  if (IDX.done) return;
  registerClip(EXAMPLE_CROSS); registerClip(TEST_PASS); registerClip(testBlock()); registerClip(TEST_WAVE);
  for (const p of PLAYER_IDS) { registerClip(testDunk(p), p); registerClip(exampleJumper(p, 'mid'), p); }
  for (const id of ['move.cross', 'pass.chest', 'def.block1', 'test.wave', 'dunk.power2', 'shot.mid']) IDX[id] = clipIndex(id);
  IDX.done = true;
}

// ------------------------------------------------------------------------------------------------ helpers
function makeOwner(x = 0, z = 0, yaw = 0) { return { pos: { x, z }, yaw, vel: { x: 0, z: 0 }, jumpY: 0, stamina: 1 }; }
function makeAnimator(id, owner, character = null, seed = 5) {
  return new Animator(RIGS[id], character, { id, owner, rng: testRng(seed) });
}
/** One fixed step + render evaluate; the owner integrates the root motion like Player.step. */
function tick(a, o, alpha = 1) {
  a.step(DT);
  if (a.motion.active) { o.vel.x = a.motion.vx; o.vel.z = a.motion.vz; o.yaw += a.motion.dyaw; }
  o.pos.x += o.vel.x * DT; o.pos.z += o.vel.z * DT;
  a.evaluate(alpha, DT);
}
/** Rotation angle (deg) between two quaternions, robust to float32 storage (normalised; atan2 form, exact near 0). */
function quatAngle(a, ao, b, bo) {
  const na = Math.hypot(a[ao], a[ao + 1], a[ao + 2], a[ao + 3]), nb = Math.hypot(b[bo], b[bo + 1], b[bo + 2], b[bo + 3]);
  let dot = 0, dd = 0;
  for (let i = 0; i < 4; i++) dot += (a[ao + i] / na) * (b[bo + i] / nb);
  const sg = dot < 0 ? -1 : 1;
  for (let i = 0; i < 4; i++) { const d = a[ao + i] / na - sg * b[bo + i] / nb; dd += d * d; }
  // |a − b| = 2·sin(θ/4) for unit quaternions on the same hemisphere
  return 4 * Math.asin(Math.min(1, Math.sqrt(dd) / 2)) / DEG;
}
/** World position of bone b of an animator's render skeleton. */
function boneWorld(a, b, out = {}) {
  const v = Float64Array.of(a.sk.P[b * 3], a.sk.P[b * 3 + 1], a.sk.P[b * 3 + 2]);
  return a.toWorld(v, a.rx, a.rz, a.ryaw, out);
}
/** A Character stand-in with real three.js bones (spec §1.4 fields the Animator uses). */
function fakeCharacter(rig) {
  const object = new THREE.Group();
  const bones = [];
  for (let b = 0; b < BONE_COUNT; b++) {
    const bone = new THREE.Bone(); bone.name = BONE_NAMES[b];
    bone.position.set(rig.restPos[b * 3], rig.restPos[b * 3 + 1], rig.restPos[b * 3 + 2]);
    if (BONE_PARENT[b] >= 0) bones[BONE_PARENT[b]].add(bone); else object.add(bone);
    bones.push(bone);
  }
  const morphIndex = { jawOpen: 0, tongueOut: 1, jawJut: 2, roar: 3, grin: 4, smirk: 5, scowl: 6, puff: 7, blink: 8 };
  return { id: rig.id, object, bones, boneIndex: (n) => BONE_NAMES.indexOf(n), morph: new Float32Array(9), morphIndex, eyeOffset: new THREE.Vector2(), visible: true };
}

// =============================================================================================================
export const GROUPS = [];

// ------------------------------------------------------------------------------------------------ IK
GROUPS.push(['ik', () => {
  const rig = RIGS.kobe, sk = new Skel(rig), rng = testRng(11);
  const q = new Float64Array(BONE_COUNT * 4), t = new Float64Array(3), e = new Float64Array(3);
  let maxErr = 0, n = 0;
  for (let i = 0; i < 10000; i++) {
    sk.reset();
    for (let b = 0; b < BONE_COUNT; b++) { q[b * 4] = 0; q[b * 4 + 1] = 0; q[b * 4 + 2] = 0; q[b * 4 + 3] = 1; }
    const side = i & 1, leg = (i >> 1) & 1, sg = side ? 1 : -1;
    const ch = leg ? LEG_IK[side] : ARM_IK[side];
    if (leg) { anatQuat(AQ.THIGH, sg, [rng.next() * 90 - 20, rng.next() * 30, rng.next() * 30 - 15], q, ch[0] * 4); anatQuat(AQ.CALF, sg, [5 + rng.next() * 110], q, ch[1] * 4); }
    else { anatQuat(AQ.UPPERARM, sg, [rng.next() * 160, rng.next() * 90, rng.next() * 60 - 30], q, ch[1] * 4); anatQuat(AQ.LOWERARM, sg, [5 + rng.next() * 120, rng.next() * 90], q, ch[2] * 4); }
    for (let b = 0; b < BONE_COUNT; b++) toLocal(rig, b, q, sk.L, b * 4, b * 4);
    sk.fkAll();
    const a = leg ? ch[0] : ch[1], bm = leg ? ch[1] : ch[2], c = leg ? ch[2] : ch[3];
    const eff = leg ? null : Float64Array.from(rig.sock.subarray((side ? SOCK.palm_l : SOCK.palm_r) * 4 + 1, (side ? SOCK.palm_l : SOCK.palm_r) * 4 + 4));
    sk.point(c, eff || new Float64Array(3), 0, e, 0);
    const lab = Math.hypot(sk.P[bm * 3] - sk.P[a * 3], sk.P[bm * 3 + 1] - sk.P[a * 3 + 1], sk.P[bm * 3 + 2] - sk.P[a * 3 + 2]);
    const lcb = Math.hypot(e[0] - sk.P[bm * 3], e[1] - sk.P[bm * 3 + 1], e[2] - sk.P[bm * 3 + 2]);
    // a reachable target: distance inside (law-of-cosines minimum at the 30° interior limit, 0.995·reach)
    const dMin = Math.sqrt(lab * lab + lcb * lcb - 2 * lab * lcb * Math.cos(30 * DEG)) + 0.01, dMax = 0.995 * (lab + lcb);
    const r = dMin + (dMax - dMin) * rng.next(), u = 2 * rng.next() - 1, ph = 2 * Math.PI * rng.next(), s = Math.sqrt(1 - u * u);
    t[0] = sk.P[a * 3] + r * s * Math.cos(ph); t[1] = sk.P[a * 3 + 1] + r * u; t[2] = sk.P[a * 3 + 2] + r * s * Math.sin(ph);
    const err = twoBoneIK(sk, a, bm, c, eff, t, null, 1, 0, null);
    if (err > maxErr) maxErr = err;
    n++;
  }
  ok(maxErr <= 1e-3, `10,000 reachable two-bone targets end within 1 mm (max ${(maxErr * 1000).toFixed(4)} mm, n ${n})`);
  // unreachable targets straighten the chain toward the target
  let worstDir = 0, worstLen = 0;
  for (let i = 0; i < 200; i++) {
    sk.reset();
    const side = i & 1, ch = ARM_IK[side];
    const A = [sk.P[ch[1] * 3], sk.P[ch[1] * 3 + 1], sk.P[ch[1] * 3 + 2]];
    const u = 2 * rng.next() - 1, ph = 2 * Math.PI * rng.next(), s = Math.sqrt(1 - u * u);
    t[0] = A[0] + 1.6 * s * Math.cos(ph); t[1] = A[1] + 1.6 * u; t[2] = A[2] + 1.6 * s * Math.sin(ph);
    const eff = Float64Array.from(rig.sock.subarray((side ? SOCK.palm_l : SOCK.palm_r) * 4 + 1, (side ? SOCK.palm_l : SOCK.palm_r) * 4 + 4));
    sk.point(ch[3], eff, 0, e, 0);
    const lab = Math.hypot(sk.P[ch[2] * 3] - A[0], sk.P[ch[2] * 3 + 1] - A[1], sk.P[ch[2] * 3 + 2] - A[2]);
    const lcb = Math.hypot(e[0] - sk.P[ch[2] * 3], e[1] - sk.P[ch[2] * 3 + 1], e[2] - sk.P[ch[2] * 3 + 2]);
    twoBoneIK(sk, ch[1], ch[2], ch[3], eff, t, null, 1, 0, null);
    sk.point(ch[3], eff, 0, e, 0);
    const d = [e[0] - A[0], e[1] - A[1], e[2] - A[2]], dl = Math.hypot(...d);
    const dirErr = Math.acos(Math.min(1, (d[0] * (t[0] - A[0]) + d[1] * (t[1] - A[1]) + d[2] * (t[2] - A[2])) / (dl * 1.6))) / DEG;
    worstDir = Math.max(worstDir, dirErr); worstLen = Math.max(worstLen, Math.abs(dl - 0.999 * (lab + lcb)));
  }
  ok(worstDir < 0.5 && worstLen < 0.002, `unreachable targets straighten the arm toward them (dir ${worstDir.toFixed(3)}°, length ${(worstLen * 1000).toFixed(2)} mm)`);
  // foot lock: knee pole forward (knees track the toes), flat foot sole flat, toe lock keeps the ball joint
  const T = new FootTarget();
  let kneeOk = true, flatOk = true, toeErr = 0;
  for (let i = 0; i < 400; i++) {
    sk.reset();
    sk.T[BONE.pelvis * 3 + 1] -= 0.10 + 0.15 * rng.next(); sk.fkAll();
    const side = i & 1;
    T.mode = i % 3 === 0 ? 1 : 0; T.w = 1; T.yaw = (rng.next() - 0.5) * 0.8; T.pitch = T.mode ? 0.3 * rng.next() : 0;
    T.x = (side ? 0.14 : -0.14) + (rng.next() - 0.5) * 0.2; T.z = (rng.next() - 0.5) * 0.4; T.y = T.mode ? 0.012 : rig.metrics.ankleY;
    const err = footLock(sk, side, T);
    const ch = LEG_IK[side];
    // knee in front of the hip–ankle line along the foot direction
    const hx = sk.P[ch[0] * 3], hz = sk.P[ch[0] * 3 + 2], kx = sk.P[ch[1] * 3], kz = sk.P[ch[1] * 3 + 2], ax = sk.P[ch[2] * 3], az = sk.P[ch[2] * 3 + 2];
    const fx = Math.sin(T.yaw), fz = Math.cos(T.yaw);
    if ((kx - 0.5 * (hx + ax)) * fx + (kz - 0.5 * (hz + az)) * fz < -0.005) kneeOk = false;
    const f = new Float64Array(3); qrotate(sk.W, ch[2] * 4, Float64Array.of(0, 0, 1), 0, f, 0);
    if (T.mode === 0 && Math.abs(f[1]) > 1e-6) flatOk = false;
    if (T.mode === 1) toeErr = Math.max(toeErr, err);
  }
  ok(kneeOk, 'knee pole: knees in front of the hip–ankle line (toward the toes)');
  ok(flatOk, 'flat locks: the sole stays level after the leg IK');
  ok(toeErr < 0.002, `toe locks: ball joint on its lock (max ${(toeErr * 1000).toFixed(3)} mm, heel pitch adapts)`);
  // handToPoint with an elbow pole puts the elbow on the pole side
  sk.reset();
  const ch = ARM_IK[0];
  t[0] = sk.P[ch[1] * 3] - 0.15; t[1] = sk.P[ch[1] * 3 + 1] + 0.35; t[2] = sk.P[ch[1] * 3 + 2] + 0.25;
  const pole = Float64Array.of(sk.P[ch[1] * 3] - 0.35, sk.P[ch[1] * 3 + 1] - 0.10, sk.P[ch[1] * 3 + 2] + 0.05);
  const err = handToPoint(sk, 0, SOCK.palm_r, t, pole, 1, 1);
  ok(err < 1e-3 && sk.P[ch[2] * 3] < sk.P[ch[1] * 3] - 0.02, `elbow pole respected (elbow x ${(sk.P[ch[2] * 3] - sk.P[ch[1] * 3]).toFixed(3)} m, err ${(err * 1000).toFixed(3)} mm)`);
}]);

// ------------------------------------------------------------------------------------------------ foot locks
GROUPS.push(['footlock', () => {
  for (const id of ['yao', 'kyrie']) {
    const o = makeOwner(0, 0, 0), a = makeAnimator(id, o);
    for (let i = 0; i < 60; i++) tick(a, o);
    const d0 = a.footLocks().map((d) => d.locked);
    ok(d0[0] && d0[1], `${id}: both feet locked at idle`);
    // the ball joint never moves on a lock (flat feet: whole sole; toe locks / idle toe-bounce pivot about it)
    const before = [0, 1].map((s) => boneWorld(a, LEG_IK[s][3]));
    // a 6 cm separation push: locks hold in world space (feet do not slide with the body)
    o.pos.x += 0.06;
    let maxMove = 0, maxSlide = 0;
    for (let i = 0; i < 20; i++) {
      tick(a, o);
      for (let s = 0; s < 2; s++) { const w = boneWorld(a, LEG_IK[s][3]); maxMove = Math.max(maxMove, Math.hypot(w.x - before[s].x, w.y - before[s].y, w.z - before[s].z)); }
      for (const d of a.footLocks()) if (d.locked) maxSlide = Math.max(maxSlide, d.slide);
    }
    ok(maxMove < 0.001, `${id}: locked feet stay put through a 6 cm push (moved ${(maxMove * 1000).toFixed(3)} mm)`);
    ok(maxSlide < 0.001, `${id}: lock error ${(maxSlide * 1000).toFixed(3)} mm`);
    // a 0.5 m push: settle steps re-plant the feet (at most 2), then the stance is restored
    o.pos.x += 0.5;
    let steps = 0; const prev = [FOOT.PLANT, FOOT.PLANT];
    for (let i = 0; i < 120; i++) {
      tick(a, o);
      for (let s = 0; s < 2; s++) { const st = a.gait.feet[s].state; if (st === FOOT.STEP && prev[s] !== FOOT.STEP) steps++; prev[s] = st; }
    }
    ok(steps >= 1 && steps <= 2, `${id}: ${steps} settle steps after a 0.5 m teleport-free push (≤ 2)`);
    const tg = a.gait.stanceTarget(0), an = a.gait.ankleOf(a.gait.feet[0]);
    ok(Math.hypot(an[0] - tg[0], an[2] - tg[1]) < 0.12 * a.sLeg + 1e-6, `${id}: right foot back on its stance target`);
  }
}]);

// ------------------------------------------------------------------------------------------------ gait
/** Table of [ANIM §3.4] / spec §4.7 (step m, steps/s) at 1.4 / 3.2 / 5.2 / 7.0 m/s. */
const GAIT_TABLE = {
  kobe: [[0.75, 1.87], [1.23, 2.61], [1.64, 3.17], [1.96, 3.57]], jordan: [[0.75, 1.87], [1.22, 2.61], [1.64, 3.17], [1.96, 3.57]],
  lebron: [[0.76, 1.84], [1.25, 2.56], [1.68, 3.10], [2.00, 3.49]], giannis: [[0.85, 1.65], [1.39, 2.29], [1.87, 2.79], [2.23, 3.14]],
  yao: [[0.77, 1.83], [1.26, 2.55], [1.68, 3.09], [2.01, 3.48]], kyrie: [[0.69, 2.04], [1.13, 2.84], [1.51, 3.44], [1.80, 3.88]],
};
GROUPS.push(['gait', () => {
  const speeds = [0, 0.5, 1.4, 2.2, 3.2, 5.2, 7.0, 9.0];
  let worstSlide = 0, worstWhere = '';
  for (const id of PLAYER_IDS) {
    for (const v of speeds) {
      const o = makeOwner(0, 0, 0), a = makeAnimator(id, o);
      const strikes = [];
      let last = 0;
      for (let i = 0; i < 60 * 12; i++) {
        const t = i * DT, sp = Math.min(v, v * t);       // 1 s ramp, then 11 s constant
        o.vel.x = 0; o.vel.z = sp;
        tick(a, o);
        if (t > 2) {
          for (const d of a.footLocks()) if (d.locked && d.slide > worstSlide) { worstSlide = d.slide; worstWhere = `${id} ${v} m/s`; }
          if (a.gait.strikes > last) strikes.push(a.time);
        }
        last = a.gait.strikes;
      }
      const k = [1.4, 3.2, 5.2, 7.0].indexOf(v);
      if (k >= 0 && strikes.length > 4) {
        const cad = (strikes.length - 1) / (strikes[strikes.length - 1] - strikes[0]);
        const [stepT, cadT] = GAIT_TABLE[id][k];
        ok(Math.abs(cad / cadT - 1) <= 0.03, `${id} ${v} m/s cadence ${cad.toFixed(3)} vs table ${cadT} (±3 %)`);
        ok(Math.abs(v / cad / stepT - 1) <= 0.03, `${id} ${v} m/s step ${(v / cad).toFixed(3)} m vs table ${stepT} (±3 %)`);
        const lam = strideOf(RIGS[id].metrics.hipH, v, STYLE[id].stride);
        near(cad, 2 * v / lam, 0.03 * cad, `${id} ${v} m/s cadence = 2v/λ (Alexander)`);
      }
      if (v === 0) ok(a.gait.mode === GAIT.IDLE && a.gait.strikes === 0, `${id} stands still at 0 m/s`);
    }
  }
  ok(worstSlide < 0.005, `locked-foot slide < 5 mm over 0–9 m/s × six × 10 s (max ${(worstSlide * 1000).toFixed(3)} mm at ${worstWhere})`);
  // a toe lock carried into the walk band (toeAt = 1, e.g. jog → 0.3 m/s) holds its heel pitch at the end of
  // stance instead of 0/0 (regression: NaN pitch → endless toe-pitch scan)
  {
    const o = makeOwner(0, 0, 0), a = makeAnimator('kobe', o);
    for (let i = 0; i < 90; i++) { o.vel.z = 0.3; tick(a, o); }
    const g = a.gait, f = g.feet[0], save = [f.mode, f.toe, f.pitch, g.prm.toeAt, g.mode];
    ok(g.mode === GAIT.MOVE && g.prm.toeAt > 0.95, `0.3 m/s is the slow-walk band (mode ${g.mode}, toeAt ${g.prm.toeAt})`);
    f.mode = 1; f.toe = 1; f.pitch = 0.1; g.prm.toeAt = 1; g.mode = GAIT.MOVE;
    const pEnd = g.stancePitch(f, g.beta(), 0), pMid = g.stancePitch(f, 0.5 * g.beta(), 0);
    ok(pEnd === 0.1 && pMid === 0.1, `carried toe lock holds its pitch through a toeAt = 1 stance end (${pEnd}, ${pMid})`);
    [f.mode, f.toe, f.pitch, g.prm.toeAt, g.mode] = save;
    const sk = a.sk, T = new FootTarget(); T.x = 0.1; T.y = 0.012; T.z = 0.3; T.yaw = 0; T.mode = 1; T.w = 1;
    let fin = true;
    for (const pv of [NaN, -Infinity, Infinity, -1e9]) { T.pitch = pv; footLock(sk, 0, T); for (let j = 0; j < sk.P.length; j++) if (!Number.isFinite(sk.P[j])) fin = false; sk.fkAll(); }
    ok(fin, 'toe locks with a non-finite / huge request pitch terminate and stay finite');
  }
  // defensive slide: feet never cross, ≥ 0.25 m apart, toe-locked; then a stop: ≤ 2 settle steps
  for (const id of ['kobe', 'yao', 'kyrie']) {
    const o = makeOwner(0, 0, 0), a = makeAnimator(id, o);
    a.ctx.onDefence = true;
    let crossed = false, minGap = 9, sawSlide = false;
    for (let i = 0; i < 60 * 6; i++) {
      const t = i * DT, dir = Math.floor(t / 1.5) % 2 ? -1 : 1, sp = Math.min(2.0, 2.0 * t);
      o.vel.x = dir * sp; o.vel.z = 0;                 // lateral (character x) while facing +z
      tick(a, o);
      if (a.gait.mode === GAIT.SLIDE) sawSlide = true;
      const r = a.gait.ankleOf(a.gait.feet[0])[0], l = a.gait.ankleOf(a.gait.feet[1])[0];
      if (t > 0.5) { if (r > l) crossed = true; minGap = Math.min(minGap, Math.hypot(r - l, a.gait.ankleOf(a.gait.feet[0])[2] - a.gait.ankleOf(a.gait.feet[1])[2])); }
    }
    ok(sawSlide, `${id}: lateral defence at 2 m/s uses the defensive slide`);
    ok(!crossed, `${id}: slide never crosses the feet`);
    ok(minGap >= 0.25 - 1e-6, `${id}: slide keeps the feet ≥ 0.25 m apart (min ${minGap.toFixed(3)})`);
    // forward run then a stop
    const o2 = makeOwner(0, 0, 0), b = makeAnimator(id, o2);
    for (let i = 0; i < 120; i++) { o2.vel.z = Math.min(3, 3 * i * DT); tick(b, o2); }
    o2.vel.z = 0;
    let steps = 0; const prev = [b.gait.feet[0].state, b.gait.feet[1].state];
    for (let i = 0; i < 120; i++) {
      tick(b, o2);
      for (let s = 0; s < 2; s++) { const st = b.gait.feet[s].state; if (st === FOOT.STEP && prev[s] !== FOOT.STEP) steps++; prev[s] = st; }
    }
    ok(steps <= 2, `${id}: ${steps} settle steps after a stop (≤ 2)`);
    ok(b.gait.mode === GAIT.IDLE && b.footLocks()[0].locked && b.footLocks()[1].locked, `${id}: idle with both feet locked after the stop`);
  }
  // gait table interpolation sanity ([ANIM §3.2] anchors)
  const prm = {}; gaitParams(3.2, prm);
  ok(prm.beta === 0.42 && prm.swingH === 0.16 && prm.armAmp === 35 && Math.abs(prm.lean - 9.36) < 1e-9, 'gait parameters at the 3.2 m/s anchor');
}]);

// ------------------------------------------------------------------------------------------------ layers
GROUPS.push(['layers', () => {
  registerTestClips();
  // entry ease-out w = 1 − (1 − u)³: 70 % at a third of the fade; exit smoothstep
  {
    const o = makeOwner(), a = makeAnimator('kobe', o);
    for (let i = 0; i < 30; i++) tick(a, o);
    a.play(IDX['pass.chest'], { blendIn: 0.06 });
    a.step(DT); a.evaluate(1, DT);
    near(a.layerWeights[0], 1 - Math.pow(1 - (1 / 60) / 0.06, 3), 1e-6, 'entry weight after one step (ease-out)');
    a.step(DT); a.evaluate(0.2, DT);                  // render age = 0.02 s = a third of 0.06
    near(a.layerWeights[0], 1 - Math.pow(2 / 3, 3), 1e-6, 'entry weight at u = 1/3 is 70.4 %');
    for (let i = 0; i < 6; i++) tick(a, o);
    a.stopAction(0.20);
    const ws = [];
    for (let i = 0; i < 6; i++) { tick(a, o); ws.push(a.layerWeights[0]); }
    const u = 3 / 60 / 0.20;
    near(ws[2], 1 - u * u * (3 - 2 * u), 1e-6, 'exit weight follows 1 − smoothstep');
  }
  // masks: an upper-layer clip leaves the legs and pelvis exactly as the base, spine_01 at 35 %, arms fully
  {
    const oa = makeOwner(), ob = makeOwner(), a = makeAnimator('lebron', oa), b = makeAnimator('lebron', ob);
    for (let i = 0; i < 40; i++) { oa.vel.z = ob.vel.z = 1.5; tick(a, oa); tick(b, ob); }
    a.play(IDX['test.wave']);
    for (let i = 0; i < 30; i++) { tick(a, oa); tick(b, ob); }
    let legDiff = 0;
    for (const n of ['pelvis', 'thigh_r', 'calf_r', 'foot_r', 'thigh_l', 'calf_l', 'foot_l']) legDiff = Math.max(legDiff, quatAngle(a.sk.L, BONE[n] * 4, b.sk.L, BONE[n] * 4));
    ok(legDiff < 1e-3, `upper mask: legs and pelvis untouched (max ${legDiff.toExponential(2)}°)`);
    ok(quatAngle(a.sk.L, BONE.upperarm_r * 4, b.sk.L, BONE.upperarm_r * 4) > 20, 'upper mask: the waving arm overrides the gait arm');
    // spine_01 = nlerp(base, clip, 0.35), spine_02 0.75, spine_03 1 (layered pose before the additive layer)
    for (const [n, k] of [['spine_01', 0.35], ['spine_02', 0.75], ['spine_03', 1]]) {
      const o = BONE[n] * 4, full = quatAngle(a.pUp.q, o, b.pLast.q, o), part = quatAngle(a.pLast.q, o, b.pLast.q, o);
      near(part, k * full, 0.02 * full + 0.02, `upper mask: ${n} takes ${k * 100} % of the clip`);
    }
    near(MASK_W[MASK.upper][BONE.spine_01], 0.35, 1e-6, 'upper mask table spine_01');
  }
  // untracked bones show through: pass.chest (arms + spine) over a jog keeps the gait legs
  {
    const oa = makeOwner(), ob = makeOwner(), a = makeAnimator('kyrie', oa), b = makeAnimator('kyrie', ob);
    for (let i = 0; i < 60; i++) { oa.vel.z = ob.vel.z = 3.2; tick(a, oa); tick(b, ob); }
    a.play(IDX['pass.chest']);
    let legDiff = 0;
    for (let i = 0; i < 12; i++) {
      tick(a, oa); tick(b, ob);
      for (const n of ['thigh_r', 'calf_r', 'thigh_l', 'calf_l']) legDiff = Math.max(legDiff, quatAngle(a.sk.L, BONE[n] * 4, b.sk.L, BONE[n] * 4));
    }
    ok(legDiff < 1e-3, `untracked legs of a full-mask clip keep the gait (max ${legDiff.toExponential(2)}°)`);
  }
  // interrupted fade: no pop (consecutive frames ≤ 12°), snapshot of the old per-bone weights
  {
    const o = makeOwner(), a = makeAnimator('kobe', o);
    a.setBallMode('both');
    for (let i = 0; i < 30; i++) tick(a, o);
    a.play(IDX['test.wave'], { layer: 'action' });
    for (let i = 0; i < 9; i++) tick(a, o);
    const palm = () => { const p = {}; a.renderSocket(SOCK.palm_r, p); return p; };
    const p0 = palm();
    a.play(IDX['pass.chest'], { blendIn: 0.06 });
    tick(a, o);
    // the first frame is a partial blend from the snapshot (ease-out at u = 0.28 → 62 %), not a snap to the new clip
    const p1 = palm(), path = [p1];
    for (let i = 0; i < 3; i++) { tick(a, o); path.push(palm()); }
    const dist = (u, v) => Math.hypot(u.x - v.x, u.y - v.y, u.z - v.z);
    const total = dist(p0, path[path.length - 1]), step1 = dist(p0, p1);
    ok(total > 0.2 && step1 < 0.85 * total && step1 > 0.3 * total, `interrupted fade starts from the current pose (palm moves ${step1.toFixed(3)} of ${total.toFixed(3)} m in the first frame)`);
  }
  // teleport (> 1.5 m): 0.20 s crossfade, no bone rotates > 25° between frames (R#37)
  {
    const o = makeOwner(), a = makeAnimator('giannis', o);
    for (let i = 0; i < 90; i++) { o.vel.z = 4; tick(a, o); }
    let worst = 0;
    let prev = Float64Array.from(a.sk.L);
    o.pos.x += 3; o.vel.z = 0;
    for (let i = 0; i < 30; i++) {
      tick(a, o);
      for (let b = 1; b < BONE_COUNT; b++) worst = Math.max(worst, quatAngle(prev, b * 4, a.sk.L, b * 4));
      prev = Float64Array.from(a.sk.L);
    }
    ok(worst < 25, `teleport: crossfade + re-plant, max frame-to-frame bone rotation ${worst.toFixed(2)}° (< 25°)`);
  }
}]);

// ------------------------------------------------------------------------------------------------ events
GROUPS.push(['events', () => {
  registerTestClips();
  for (const id of PLAYER_IDS) {
    const o = makeOwner(0, -8, Math.PI), a = makeAnimator(id, o);
    a.setBallMode('both');
    for (let i = 0; i < 10; i++) tick(a, o);
    const t0 = a.time;
    a.play(IDX['shot.mid']);
    const tm = clipTiming(a.actionClip);
    const F = FORMS[id], h = F.h.mid, air = 2 * th(h);
    const tIdeal = tm.params.tIdeal;
    const got = {}; let inWindow = true, sorted = true, released = false, rel = -1, launch = null;
    for (let i = 0; i < 120 && (a.slots[0].state === 1 || i < 5); i++) {
      const before = a.time;
      if (!released && before - t0 >= tIdeal - 1e-9) { a.releaseNow(); released = true; rel = before; }
      a.step(DT);
      let lt = -1;
      for (let e; (e = a.events.next());) {
        if (e.t < before - 1e-9 || e.t > before + DT + 1e-9) inWindow = false;
        if (e.t < lt - 1e-12) sorted = false; lt = e.t;
        if (got[e.code] === undefined) got[e.code] = e.t;
        if (e.code === EV.TAKEOFF) { a.setJump(h, air); o.jumpStart = e.t; }
        if (e.code === EV.RELEASE) { launch = {}; a.querySocket(SOCK.ball, launch); }
      }
      o.jumpY = o.jumpStart !== undefined && a.time - o.jumpStart < air ? Math.max(0, Math.sqrt(2 * G * h) * (a.time - o.jumpStart) - 0.5 * G * (a.time - o.jumpStart) ** 2) : 0;
      if (a.motion.active) { o.vel.x = a.motion.vx; o.vel.z = a.motion.vz; }
      o.pos.x += o.vel.x * DT; o.pos.z += o.vel.z * DT;
      a.evaluate(1, DT);
    }
    ok(inWindow && sorted, `${id}: events carry exact times inside their fixed step, in order`);
    near(got[EV.TAKEOFF] - t0, tm.takeoff, 1e-6, `${id}: TAKEOFF at the clip's takeoff`);
    near(got[EV.RELEASE] - rel, 0.050, 1e-6, `${id}: RELEASE exactly 0.050 s after the release input`);
    near(got[EV.LAND] - got[EV.TAKEOFF], air, 1e-6, `${id}: LAND at takeoff + airtime (setJump)`);
    // launch at apex + rva ± 1 step (the meter mapping, spec §4.9.1)
    near(got[EV.RELEASE] - got[EV.TAKEOFF], th(h) + F.rva, DT + 1e-6, `${id}: perfect input launches at apex + rva`);
    ok(launch && launch.y > 2.2, `${id}: launch socket queried at RELEASE (y ${launch && launch.y.toFixed(3)} m)`);
    if (launch) note(`${id}: example-jumper launch ${launch.y.toFixed(3)} m (§4.9.2 table ${F.launchMid}; final value depends on WP3c's clips)`);
    ok(a.ballMode === BM.FREE, `${id}: ball free after RELEASE`);
  }
  // CATCH → READY + 0.30 s; ring of 32
  {
    const o = makeOwner(), a = makeAnimator('kyrie', o);
    tick(a, o);
    const t = a.time; a.onCatch('held');
    let ready = -1, caught = -1;
    for (let i = 0; i < 30; i++) { a.step(DT); }
    for (let e; (e = a.events.next());) { if (e.code === EV.CATCH) caught = e.t; if (e.code === EV.READY) ready = e.t; }
    near(caught, t, 1e-9, 'CATCH at the catch'); near(ready - caught, 0.30, 1e-9, 'READY 0.30 s after CATCH');
    ok(a.ballMode === BM.BOTH && a.events.size === 32, 'held ball in both hands; event ring of 32');
  }
}]);

// ------------------------------------------------------------------------------------------------ dribble
GROUPS.push(['dribble', () => {
  registerTestClips();
  const k = dribbleKinematics(0.95, 1.9);
  near(k.w, 3.8, 0.05, 'still dribble: w = 3.8 m/s down'); near(k.u, 4.65, 0.05, 'still dribble: u = 4.65 m/s up');
  // still mode: bounce period 1/f, the ball touches the floor (centre at R) at the bounce, contact under the palm
  {
    const o = makeOwner(), a = makeAnimator('kobe', o);
    tick(a, o); a.setBallMode('drib', 'R');
    const bounces = []; let minY = 9, palmErr = 0, low = false;
    for (let i = 0; i < 60 * 6; i++) {
      tick(a, o);
      for (let e; (e = a.events.next());) if (e.code === EV.BOUNCE) bounces.push(e.t);
      const b = {}; a.querySocket(SOCK.ball, b); minY = Math.min(minY, b.y);
      if (a.drib.lowWindow) low = true;
      const psi = a.drib.psi;
      if (i > 60 && psi > 0.75 && psi < 0.95) {
        const p = {}; a.renderSocket(SOCK.palm_r, p); const r = {}; a.renderSocket(SOCK.ball, r);
        palmErr = Math.max(palmErr, Math.hypot(p.x - r.x, p.y - (r.y + 0.132), p.z - r.z));
      }
    }
    const per = bounces.slice(2).map((t, i) => t - bounces[i + 1]);
    ok(per.length > 5 && per.every((d) => Math.abs(d - 1 / 1.9) < 1e-6), `still dribble period 1/1.9 s (${per.slice(0, 3).map((d) => d.toFixed(4)).join(', ')})`);
    near(minY, 0.12, 0.01, 'the ball touches the floor (centre ≈ R) at the bounce');
    ok(low, 'lowWindow (ball centre < 0.45 m) occurs every cycle');
    ok(palmErr < 0.02, `contact window: the palm rides on the ball top (max ${(palmErr * 1000).toFixed(1)} mm)`);
  }
  // abrupt velocity changes (sprint → dead stop, reversals, hard cuts, every 0.37 s): the released ball keeps its designed
  // offset from the player (no farther from the root than in a steady 6 m/s speed dribble, whose bounce point is pushed
  // ≈ 1.3 m ahead, + 0.2 m) instead of flying on toward the bounce point predicted before the change
  {
    const run = (vel) => {
      const o = makeOwner(), a = makeAnimator('lebron', o);
      tick(a, o); a.setBallMode('drib', 'R');
      let worst = 0;
      for (let i = 0; i < 60 * 9; i++) {
        const v = vel(i); o.vel.x = v[0]; o.vel.z = v[1];
        tick(a, o);
        if (i > 90) worst = Math.max(worst, Math.hypot(a.drib.pos[0] - o.pos.x, a.drib.pos[2] - o.pos.z));
      }
      return worst;
    };
    const steady = run(() => [0, 6]);
    const V = [[0, 6], [0, 0], [0, -5], [5, 0], [0, 0], [-6, 0], [0, 6], [4, -4], [0, 0]];
    const worst = run((i) => V[Math.floor(i / 22) % V.length]);
    ok(worst < steady + 0.2, `abrupt velocity changes: dribbled ball ≤ ${(steady + 0.2).toFixed(2)} m from the root (max ${worst.toFixed(2)} m)`);
  }
  // jog: release phase-locked to the foot strikes (one bounce per step), PLL converges
  for (const id of ['yao', 'kyrie']) {
    const o = makeOwner(), a = makeAnimator(id, o);
    tick(a, o); a.setBallMode('drib', 'R');
    let err = 0, n = 0, maxErr = 0;
    const rel = [], str = [];
    let lastStrikes = 0;
    for (let i = 0; i < 60 * 8; i++) {
      o.vel.z = Math.min(3.2, 3.2 * i * DT);
      const p0 = a.drib.psi;
      tick(a, o);
      if (i > 60 * 4) {
        const target = (2 * a.gait.phi) % 1, d = ((target - a.drib.psi + 1.5) % 1) - 0.5;
        err += Math.abs(d); n++; maxErr = Math.max(maxErr, Math.abs(d));
        if (a.drib.psi < p0) rel.push(a.time);
        if (a.gait.strikes > lastStrikes) str.push(a.time);
      }
      lastStrikes = a.gait.strikes;
    }
    const per = (t) => (t[t.length - 1] - t[0]) / (t.length - 1);
    near(per(rel), per(str), 0.03 * per(str), `${id}: jog dribble frequency-locked to the steps (one bounce per step)`);
    // bounded phase lag: (cadence − f)/2 cycles when the cadence leaves the player's dribble range (Yao f × 0.85)
    const M = 2.8 * STYLE[id].dribble.f, cad = 1 / per(str), lag = Math.max(0, cad - M) / 2;
    ok(err / n < lag + 0.02 && maxErr < lag + 0.06, `${id}: release phase-locked to the strikes (mean error ${(err / n).toFixed(4)}, max ${maxErr.toFixed(4)} cycles, expected lag ${lag.toFixed(3)})`);
    // pickup: a jump shot keyed B 'both' takes the ball at the next contact (≤ 0.30 s), then holds it
    a.play(IDX['shot.mid']);
    let picked = -1; const t0 = a.time;
    for (let i = 0; i < 30 && picked < 0; i++) { tick(a, o); for (let e; (e = a.events.next());) if (e.code === EV.PICKUP) picked = e.t; }
    ok(picked >= 0 && picked - t0 <= 0.30 && a.ballMode === BM.BOTH, `${id}: pickup after ${(picked - t0).toFixed(3)} s, ball in both hands`);
  }
}]);

// ------------------------------------------------------------------------------------------------ look-at
GROUPS.push(['look', () => {
  const rig = RIGS.kobe, sk = new Skel(rig), lk = new LookAt();
  const eye = new Float64Array(3); sk.sock(SOCK.eyeC, eye, 0);
  const run = (yawDeg, pitchDeg, w, spine, n = 240) => {
    const d = 5, tx = eye[0] + d * Math.sin(yawDeg * DEG) * Math.cos(pitchDeg * DEG), tz = eye[2] + d * Math.cos(yawDeg * DEG) * Math.cos(pitchDeg * DEG);
    const ty = eye[1] - d * Math.sin(pitchDeg * DEG);
    let vmax = 0, prev = lk.st[0];
    for (let i = 0; i < n; i++) { sk.reset(); lk.update(sk, DT, tx, ty, tz, w, spine); vmax = Math.max(vmax, Math.abs(lk.st[0] - prev) / DT); prev = lk.st[0]; }
    return vmax;
  };
  run(30, 0, 1, true);
  near(lk.st[0] / DEG, 30, 0.5, 'look yaw 30° reached (spring ω 12)');
  const neckYaw = 2 * Math.asin(Math.min(1, Math.abs(sk.L[BONE.neck_01 * 4 + 1]))) / DEG;
  near(neckYaw, 0.4 * 30, 0.5, 'neck takes 40 % of the yaw (head 60 %)');
  lk.reset();
  const vmax = run(150, 0, 1, true);
  near(lk.st[0] / DEG, 80, 0.5, 'yaw limited to ±80°'); near(lk.st[4] / DEG, 12, 0.3, 'excess beyond 70° goes to spine_03 (≤ 12°)');
  ok(vmax <= LOOK_LIMITS.maxSpeed * 1.001, `angular speed ≤ 400°/s (max ${(vmax / DEG).toFixed(1)}°/s)`);
  near(lk.out.x, 0.10, 1e-3, 'iris x = clamp(remYaw / 35°)·0.10 (saturated)');
  lk.reset(); run(-150, 0, 1, false);
  near(lk.st[0] / DEG, -80, 0.5, 'no spine help unless the base is locomotion / idle (−80°)'); near(lk.st[4], 0, 1e-6, 'spine yaw 0');
  lk.reset(); run(0, -70, 1, true); near(lk.st[2] / DEG, -40, 0.5, 'pitch up limited to −40°');
  lk.reset(); run(0, 60, 1, true); near(lk.st[2] / DEG, 30, 0.5, 'pitch down limited to +30°');
  lk.reset(); run(20, 10, 0.5, true); near(lk.st[0] / DEG, 10, 0.5, 'look weight 0.5 halves the angle (shots)');
  run(20, 10, 0, true, 300); ok(Math.abs(lk.st[0]) < 1e-3 && Math.abs(lk.out.x) < 1e-3, 'weight 0 returns the head and eyes to the clip pose');
  // iris residual within its clamp; saccades only from the step RNG
  const r = testRng(3); let sac = false;
  for (let i = 0; i < 600; i++) { lk.step(DT, r, true); if (lk.sacLeft > 0) sac = true; }
  ok(sac, 'idle saccades scheduled every 0.6–2.2 s from the cosmetic RNG');
}]);

// ------------------------------------------------------------------------------------------------ dunk IK
GROUPS.push(['dunk', () => {
  registerTestClips();
  for (const id of PLAYER_IDS) {
    const rig = RIGS[id];
    const o = makeOwner(0, 0, Math.PI), a = makeAnimator(id, o);
    a.setBallMode('both');
    // start so that the takeoff (target-matched) is 1.2 m in front of the rim
    const def = testDunk(id);
    const probe = makeAnimator(id, makeOwner()); probe.play(IDX['dunk.power2']);
    const tm0 = clipTiming(probe.actionClip), r = sampleRoot(probe.actionClip, tm0.targetT, new Float64Array(3));
    o.pos.z = RIM_POS.z + 1.2 + r[1] * rig.metrics.sLeg;
    a.step(DT);
    a.play(IDX['dunk.power2'], { target: { x: 0, z: RIM_POS.z + 1.2 } });
    const h = def.jump.h, T = th(h), slamAfter = T - 0.03, hang = 0.20, air = T + hang + Math.sqrt(2 * (h - 0.05) / G);
    let tTO = -1, slamQ = null, lastRender = null, hookErr = 0, hookN = 0;
    const slamPt = { x: 0, y: RIM_POS.y + 0.18, z: RIM_POS.z + 0.10 };
    for (let i = 0; i < 180 && a.slots[0].state !== 0; i++) {
      a.step(DT);
      for (let e; (e = a.events.next());) {
        if (e.code === EV.TAKEOFF) { tTO = e.t; a.setJump(h, air, { slam: slamAfter, hang }); }
        if (e.code === EV.SLAM) { slamQ = {}; a.querySocket(SOCK.ball, slamQ); }
      }
      // gameplay's rise–hang–drop jumpY (spec §4.9.4)
      if (tTO >= 0) { const tau = a.time - tTO; o.jumpY = a.jumpAt(tau); }
      if (a.motion.active) { o.vel.x = a.motion.vx; o.vel.z = a.motion.vz; o.yaw += a.motion.dyaw; }
      o.pos.x += o.vel.x * DT; o.pos.z += o.vel.z * DT;
      a.evaluate(1, DT);
      if (a.ballMode === BM.BOTH && tTO >= 0) { lastRender = {}; a.renderSocket(SOCK.ball, lastRender); }
      const tm = clipTiming(a.slots[0].src), t = a.slots[0].clock.t;
      if (a.slots[0].state === 1 && t > tm.rimGrab + 0.02 && t < tm.rimRelease - 0.01) {
        const rim = new Float64Array(3); a.rimPoint(rim);
        for (const [s, sock] of [[1, SOCK.rimHook_r], [-1, SOCK.rimHook_l]]) {
          const p = {}; a.renderSocket(sock, p);
          // two-hand grip: hooks 0.11 m either side of the rim front (character x)
          const c = Math.cos(a.ryaw), sn = Math.sin(a.ryaw), off = s > 0 ? -0.11 : 0.11;
          hookErr = Math.max(hookErr, Math.hypot(p.x - (rim[0] + off * c), p.y - rim[1], p.z - (rim[2] - off * sn))); hookN++;
        }
      }
    }
    ok(slamQ && slamQ.y >= 3.20 && Math.hypot(slamQ.x - slamPt.x, slamQ.z - slamPt.z) <= 0.15, `${id}: ball at SLAM (sim) y ${slamQ && slamQ.y.toFixed(3)} m, xz ${slamQ && Math.hypot(slamQ.x - slamPt.x, slamQ.z - slamPt.z).toFixed(3)} m from the slam point`);
    ok(lastRender && lastRender.y >= 3.15 && Math.hypot(lastRender.x - slamPt.x, lastRender.z - slamPt.z) <= 0.15, `${id}: rendered ball in the last attached frame y ${lastRender && lastRender.y.toFixed(3)}, xz ${lastRender && Math.hypot(lastRender.x - slamPt.x, lastRender.z - slamPt.z).toFixed(3)}`);
    ok(hookN > 0 && hookErr <= 0.03, `${id}: rimHook within 0.03 m of the rim during the hang (max ${(hookErr * 1000).toFixed(1)} mm)`);
  }
}]);

// ------------------------------------------------------------------------------------------------ faces
GROUPS.push(['faces', () => {
  registerTestClips();
  const rig = RIGS.kobe, c = fakeCharacter(rig), o = makeOwner(), a = new Animator(rig, c, { id: 'kobe', owner: o, rng: testRng(9) });
  for (let i = 0; i < 60; i++) tick(a, o);
  near(c.morph[EXPR.scowl], 0.35, 1e-6, 'Kobe idle scowl baseline 0.35 written to the morph array');
  a.setFace('smirk', 0.8);
  for (let i = 0; i < 6; i++) tick(a, o);
  near(c.morph[EXPR.smirk], Math.min(0.8, 6 * DT / FACE_AR[EXPR.smirk][0]), 1e-6, 'attack ramp 0.20 s (§3.9)');
  let blinks = 0, maxLen = 0, len = 0;
  for (let i = 0; i < 60 * 8; i++) { tick(a, o); if (c.morph[EXPR.blink] > 0) len += DT; else { if (len > 0) { blinks++; maxLen = Math.max(maxLen, len); } len = 0; } }
  ok(blinks >= 1 && maxLen <= 0.12 + 2 * DT, `blinks every 2.5–5.5 s, ≤ 0.12 s (${blinks} blinks, longest ${maxLen.toFixed(3)} s)`);
  // Jordan: tongue out from GATHER to LAND + 0.10 on a dunk clip
  const rj = RIGS.jordan, cj = fakeCharacter(rj), oj = makeOwner(0, RIM_POS.z + 3, Math.PI), j = new Animator(rj, cj, { id: 'jordan', owner: oj, rng: testRng(2) });
  j.setBallMode('both'); tick(j, oj);
  j.play(IDX['dunk.power2']);
  let maxT = 0;
  for (let i = 0; i < 40; i++) { tick(j, oj); for (let e; (e = j.events.next());) if (e.code === EV.TAKEOFF) j.setJump(0.8, 0.9, { slam: 0.37, hang: 0.2 }); maxT = Math.max(maxT, cj.morph[EXPR.tongueOut]); }
  ok(maxT >= 0.99, `Jordan tongueOut on a dunk clip (${maxT.toFixed(2)})`);
  ok(cj.eyeOffset.x !== undefined, 'eye offset uniform written');
}]);

// ------------------------------------------------------------------------------------------------ capture / applyBlend
GROUPS.push(['capture', () => {
  registerTestClips();
  const rig = RIGS.yao, c = fakeCharacter(rig), o = makeOwner(1, -3, 0.5), a = new Animator(rig, c, { id: 'yao', owner: o, rng: testRng(4) });
  for (let i = 0; i < 40; i++) { o.vel.z = 2; tick(a, o); }
  const buf = new Float32Array(ANIM_CAPTURE_FLOATS * 2);
  ok(a.capture(buf, 0) === 233, 'capture writes 233 floats');
  const L0 = Float64Array.from(a.sk.L), face0 = Float32Array.from(a.face);
  a.play(IDX['test.wave'], { layer: 'action' });
  for (let i = 0; i < 20; i++) tick(a, o);
  a.capture(buf, ANIM_CAPTURE_FLOATS);
  const L1 = Float64Array.from(a.sk.L);
  a.external = true;
  a.applyBlend(buf, 0, ANIM_CAPTURE_FLOATS, 0);
  let e0 = 0; for (let b = 0; b < BONE_COUNT; b++) e0 = Math.max(e0, quatAngle(a.sk.L, b * 4, L0, b * 4));
  ok(e0 < 0.01, `applyBlend α 0 reproduces frame A (max ${e0.toFixed(4)}°)`);
  let qe = 0; for (let b = 0; b < BONE_COUNT; b++) qe = Math.max(qe, quatAngle(c.bones[b].quaternion.toArray(), 0, L0, b * 4));
  ok(qe < 0.01, 'bones receive the blended quaternions');
  near(c.object.position.x, buf[0], 1e-6, 'root restored'); near(c.morph[EXPR.scowl], face0[EXPR.scowl], 1e-6, 'expressions restored');
  a.applyBlend(buf, 0, ANIM_CAPTURE_FLOATS, 1);
  let e1 = 0; for (let b = 0; b < BONE_COUNT; b++) e1 = Math.max(e1, quatAngle(a.sk.L, b * 4, L1, b * 4));
  ok(e1 < 0.01, `applyBlend α 1 reproduces frame B (max ${e1.toFixed(4)}°)`);
  a.applyBlend(buf, 0, ANIM_CAPTURE_FLOATS, 0.5);
  const b = BONE.upperarm_r * 4, full = quatAngle(L0, b, L1, b), half = quatAngle(L0, b, a.sk.L, b);
  near(half, full / 2, Math.max(0.5, 0.05 * full), 'α 0.5 lies halfway');
  near(c.object.position.z, 0.5 * (buf[2] + buf[ANIM_CAPTURE_FLOATS + 2]), 1e-5, 'root interpolated');
  // while external, evaluate() leaves the replayed pose alone
  const keep = Float64Array.from(a.sk.L);
  a.step(DT); a.evaluate(1, DT);
  let ek = 0; for (let k = 0; k < keep.length; k++) ek = Math.max(ek, Math.abs(keep[k] - a.sk.L[k]));
  ok(ek === 0, 'external = true: evaluate() does not overwrite the replay');
}]);

// ------------------------------------------------------------------------------------------------ catalog / presentation
GROUPS.push(['catalog', () => {
  // every clip id select.js can choose × six players: plays, steps and evaluates with finite output (B44 headless);
  // clips without registered data run on their catalog timing (base layer visible)
  registerTestClips();
  let bad = '', n = 0;
  for (const id of PLAYER_IDS) {
    const o = makeOwner(0, -6, Math.PI), a = makeAnimator(id, o);
    a.setBallMode('both');
    for (let k = 0; k < CLIP_IDS.length; k++) {
      const idx = clipIndex(CLIP_IDS[k]);
      a.play(idx, { mirror: (k & 1) === 1 });
      for (let i = 0; i < 10; i++) {
        tick(a, o);
        for (let e; (e = a.events.next());) if (e.code === EV.TAKEOFF) a.setJump(0.5, 0.64);
      }
      for (let i = 0; i < a.sk.L.length; i++) if (!Number.isFinite(a.sk.L[i])) { bad = `${id} ${CLIP_IDS[k]}`; break; }
      if (o.pos.z < -12 || o.pos.z > 0 || Math.abs(o.pos.x) > 7) { o.pos.x = 0; o.pos.z = -6; }
      n++;
    }
  }
  ok(!bad && n === 6 * CLIP_IDS.length, `${n} clip × player runs render 10 frames with finite poses${bad ? ' (NaN in ' + bad + ')' : ''}`);
}]);

GROUPS.push(['present', () => {
  registerTestClips();
  // walkTo: self-driven root (no owner, no game steps): walks there, then turns to the final yaw
  {
    const a = new Animator(RIGS.kobe, null, { id: 'kobe', rng: testRng(1) });
    a.walkTo(2, 1, Math.PI / 2, 1.4);
    let moved = false;
    for (let i = 0; i < 60 * 5; i++) { a.evaluate(1, DT); if (a.gait.mode === GAIT.MOVE) moved = true; }
    ok(moved && Math.hypot(a.x - 2, a.z - 1) < 0.03 && Math.abs(a.yaw - Math.PI / 2) < 0.02, `walkTo reaches (2, 1) facing +x with the gait (at ${a.x.toFixed(3)}, ${a.z.toFixed(3)}, yaw ${a.yaw.toFixed(3)})`);
    ok(a.gait.mode === GAIT.IDLE && a.footLocks()[0].locked, 'walkTo ends standing with planted feet');
    a.walkTo(-3, 0, 0, 0);
    a.evaluate(1, DT);
    ok(a.x === -3 && a.rx === -3, 'walkTo with speed 0 places instantly (the gait re-plants with a crossfade)');
  }
  // freeze: the clip holds at t through evaluates; setYawOverride drives the rendered yaw only
  {
    const c = fakeCharacter(RIGS.yao), a = new Animator(RIGS.yao, c, { id: 'yao', rng: testRng(2) });
    a.freeze('pass.chest', 0.10);
    for (let i = 0; i < 20; i++) a.evaluate(1, DT);
    near(a.actionTime, 0.10, 1e-9, 'freeze holds the clip time');
    a.setYawOverride(1.2); a.evaluate(1, DT);
    near(c.object.rotation.y, 1.2, 1e-9, 'yaw override on the character object'); near(a.yaw, 0, 1e-9, 'root yaw untouched');
    a.setYawOverride(null); a.evaluate(1, DT); near(c.object.rotation.y, 0, 1e-9, 'override cleared');
  }
  // automatic grip: a held ball curls both hands to `grip` within 0.06 s
  {
    const o = makeOwner(), a = makeAnimator('jordan', o);
    for (let i = 0; i < 10; i++) tick(a, o);
    a.setBallMode('both');
    for (let i = 0; i < 12; i++) tick(a, o);
    ok(a.gripW[0] > 0.999 && a.gripW[1] > 0.999, `automatic grip on both hands (${a.gripW[0].toFixed(2)}, ${a.gripW[1].toFixed(2)})`);
    const g = new Float32Array(60); fingerQuats(FINGER_ID.grip, 0, 0, g, 0);
    const b = FINGER_BONES.r[1];
    ok(quatAngle(a.pLast.q, b * 4, g, 4) < 1e-3 || quatAngle(a.pBase.q, b * 4, g, 4) < 1e-3, 'finger bones take the grip preset');
    a.setBallMode('free');
    for (let i = 0; i < 12; i++) tick(a, o);
    ok(a.gripW[0] < 1e-3, 'grip released when the ball is gone');
  }
  // Kyrie's idle combos: cosmetic, in place, after 0.8 s of standing dribble; cancelled by movement; ballHand kept
  {
    registerClip({ ...EXAMPLE_CROSS, id: 'move.btl' });
    const o = makeOwner(), a = makeAnimator('kyrie', o);
    tick(a, o); a.setBallMode('drib', 'R');
    let combo = false, leaked = false;
    for (let i = 0; i < 60 * 2; i++) {
      tick(a, o);
      if (a.slots[0].state === 1 && a.slots[0].cosmetic) combo = true;
      for (let e; (e = a.events.next());) if (e.layer === 0 && e.code !== EV.BOUNCE && a.slots[0].cosmetic) leaked = true;
    }
    ok(combo, 'Kyrie standing dribble > 0.8 s starts the btl / cross combo');
    ok(!leaked && a.motion.active === false, 'combo is cosmetic: in place, no gameplay events but bounces');
    ok(a.ballHand === HAND.R, 'ballHand keeps its sign during the combo');
    o.vel.z = 2;
    for (let i = 0; i < 20; i++) tick(a, o);
    ok(a.combo === -1 && !(a.slots[0].state === 1 && a.slots[0].cosmetic), 'movement cancels the combo');
  }
}]);

// ------------------------------------------------------------------------------------------------ zero allocation
GROUPS.push(['alloc', () => {
  if (typeof globalThis.gc !== 'function') {
    const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--group=alloc'], { encoding: 'utf8' });
    process.stdout.write(r.stdout.split('\n').filter((l) => /alloc|heap|FAIL|ms/.test(l)).map((l) => '  [child] ' + l.trim()).join('\n') + '\n');
    ok(r.status === 0, 'zero-allocation probe (child with --expose-gc)');
    return;
  }
  registerTestClips();
  const owners = PLAYER_IDS.map((p, i) => makeOwner(i * 2 - 5, -6, Math.PI));
  const chars = PLAYER_IDS.map((p) => fakeCharacter(RIGS[p]));
  const anims = PLAYER_IDS.map((p, i) => new Animator(RIGS[p], chars[i], { id: p, owner: owners[i], rng: testRng(i + 1) }));
  const out = { x: 0, y: 0, z: 0 };
  const fam = ['move.cross', 'pass.chest', 'shot.mid', 'dunk.power2', 'def.block1', 'test.wave'];
  const PLAY = { mirror: false, blendIn: 0.06 };
  let k0 = 0;
  const run = (steps) => {
    for (let i = 0; i < steps; i++) {
      for (let k = 0; k < 6; k++) {
        const a = anims[k], o = owners[k];
        const ph = (i + k * 37) % 240;
        // cycle: run, dribble, holding + shot / pass / dunk / block / move / upper clip, idle
        o.vel.x = 0; o.vel.z = ph < 60 ? -4 * Math.min(1, ph / 20) : ph < 120 ? -1.5 : 0;
        if (ph === 30) a.setBallMode('drib', 'R');
        if (ph === 100) { a.setBallMode('both'); PLAY.mirror = (k0++ & 1) === 1; a.play(IDX[fam[(i / 240 + k) % fam.length | 0]], PLAY); }
        if (ph === 130) a.releaseNow();
        if (ph === 200) a.stopAction(0.2);
        a.ctx.onDefence = ph > 210;
        a.setLookTarget(0, 3.05, -12.75, ph < 120 ? 1 : 0.5);
        if (ph === 150) a.contact(o.pos.x, 2.9, o.pos.z - 0.3, k & 1);
        if (ph === 160) a.setCatch(o.pos.x + 0.3, 1.3, o.pos.z - 0.4, 0.12);
        a.step(DT);
        for (let e; (e = a.events.next());) if (e.code === EV.TAKEOFF) a.setJump(0.5, 0.64, a.slots[0].cat === 3 ? DUNK_PROFILE : undefined);
        if (a.motion.active) { o.vel.x = a.motion.vx; o.vel.z = a.motion.vz; o.yaw += a.motion.dyaw; }
        o.pos.x += o.vel.x * DT; o.pos.z += o.vel.z * DT;
        if (o.pos.z < -12 || o.pos.z > 0) { o.pos.z = -6; }
        a.querySocket(SOCK.ball, out); a.querySocket(SOCK.palm_r, out); a.querySocket(SOCK.ankle_l, out); a.querySocket(SOCK.eyeC, out);
        chars[k].object.position.set(o.pos.x, 0, o.pos.z); chars[k].object.rotation.y = o.yaw;
        a.evaluate(0.5, DT);
        a.renderSocket(SOCK.ball, out);
      }
    }
  };
  const WARM = Number(process.env.WARM || 1800), MEASURE = Number(process.env.MEASURE || 600);
  run(WARM);
  let growth = Infinity;
  for (let w = 0; w < 3; w++) {
    globalThis.gc(); globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    run(MEASURE);
    globalThis.gc(); globalThis.gc();
    growth = Math.min(growth, process.memoryUsage().heapUsed - before);
  }
  console.log(`alloc probe: heap growth ${(growth / 1024).toFixed(1)} KB over ${MEASURE} steps + evaluates × 6 animators with three.js bones (min of 3 windows)`);
  ok(growth < 64 * 1024, `heap growth ${growth} B < 64 KB`);
  const t0 = process.hrtime.bigint();
  run(600);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 600;
  console.log(`alloc probe: six animators step + evaluate (bones, IK, look, face): ${ms.toFixed(3)} ms per frame`);
  if (process.env.CI_DESKTOP) ok(ms < 0.5, `desktop budget < 0.5 ms per frame for six (${ms.toFixed(3)})`);
}]);
const DUNK_PROFILE = Object.freeze({ slam: 0.30, hang: 0.15 });

// ------------------------------------------------------------------------------------------------ runner
const argGroup = (process.argv.find((a) => a.startsWith('--group=')) || '').slice(8);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  for (const [name, fn] of GROUPS) {
    if (argGroup && name !== argGroup) continue;
    const f0 = failures, p0 = passes;
    try { fn(); } catch (e) { failures++; log.push(`  FAIL ${name} threw: ${e.stack}`); }
    console.log(`${failures === f0 ? 'ok  ' : 'FAIL'} ${name.padEnd(9)} ${passes - p0} passed, ${failures - f0} failed`);
    for (const l of log.splice(0)) console.log(l);
  }
  console.log(`unit-anim-runtime: ${passes} passed, ${failures} failed (header: ${path.relative(ROOT, HDR_FILE)})`);
  process.exit(failures ? 1 : 0);
}
