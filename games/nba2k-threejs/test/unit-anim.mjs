// test/unit-anim.mjs — animation unit tests (spec §4.15, [ANIM §11.2]); Node ≥ 18, no browser.
//   node test/unit-anim.mjs                 all groups (the alloc group re-spawns itself with --expose-gc)
//   node test/unit-anim.mjs --group=clip    one group (rig, clip, pose, presets, select, proxy, motion, alloc)
// Groups owned by WP3a: rig frames & mirror symmetry, clip DSL / compile / limits / events / clock, pose blending,
// presets, select / getTiming tables, AnimProxy, first-33-ms motion, zero-allocation probe. The IK / gait / dunk-IK
// groups of [ANIM §11.2] belong to the modules that implement them (ik.js, locomotion.js, animator.js) and are added
// to this file by their owners through the GROUPS registry below.
//
// It also contains the FULLY WORKED EXAMPLE CLIPS for clip authors (WP3c): `move.cross` written key by key from
// [ANIM §4.2] and a generator `exampleJumper(p, variant)` implementing [ANIM §5.3] `makeJumper` from presets.FORMS.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

import {
  BONE, BONE_COUNT, BONE_NAMES, BONE_PARENT, MIRROR, BONE_SIDE, BONE_KIND, AQ, SOCK, SOCKET_COUNT,
  assertBoneTable, buildRig, anatQuat, toLocal, fkWorld, socketWorld, qrotate, qmul,
} from '../src/anim/rig.js';
import {
  EV, BM, HAND, FX, defineClip, mirrorDef, compileClip, sampleClip, sampleRoot, clipTiming, makeTimingClip, validateClip,
  hermiteMonotone, rhythmElev, ClipClock, RootMotion, EventRing, clipIndex, registerClip, getClip, getDef, compileAll,
  clipIdOf, SAMPLE_AIR_LINEAR,
} from '../src/anim/clip.js';
import { Pose, copyPose, blendPose, addPose, resetPose, MASK, MASK_W, EXPR, EXPR_NAMES, LOOK } from '../src/anim/pose.js';
import {
  FINGERS, FINGER_PRESETS, FINGER_ID, FINGER_BONES, FINGER_Q, fingerQuats, ARM, LEG, SHORT, SET, GUIDE, REL, FOLLOW,
  STANCE, FORMS, STYLE, PLAYER_IDS, DIP_ARMS,
} from '../src/anim/presets.js';
import {
  getTiming, selectClip, selectMove, selectPass, selectDefJump, selectCelebration, selectIdleHabit, timingClip,
  prepareTiming, catOf, CLIP_IDS, KINDS, HJUMP, PASS_RELEASE, timingByClip,
} from '../src/anim/select.js';
import { AnimProxy, PROXY_METRICS } from '../src/anim/proxy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const G = 9.81;
const DT = 1 / 60;
const th = (h, g = 1) => Math.sqrt(2 * h / (G * g));

// ------------------------------------------------------------------------------------------------ tiny harness
let failures = 0, passes = 0;
const log = [];
function ok(cond, msg) { if (cond) passes++; else { failures++; log.push('  FAIL ' + msg); } return !!cond; }
function near(a, b, tol, msg) { return ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`); }
function throws(fn, re, msg) {
  try { fn(); } catch (e) { return ok(!re || re.test(e.message), `${msg}: message '${e.message}'`); }
  return ok(false, `${msg}: did not throw`);
}

/** Deterministic test RNG (mulberry32; tests only — src never uses Math.random). */
function testRng(seed) {
  let a = seed >>> 0;
  return { next() { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } };
}

// ------------------------------------------------------------------------------------------------ headers
function loadHeaders() {
  const out = [];
  const poc = path.join(ROOT, 'test/scratch/legends-poc/assets/legends.json');
  const v2 = path.join(ROOT, 'assets/legends/legends.json');
  for (const [name, f] of [['poc', poc], ['v2', v2]]) {
    if (fs.existsSync(f)) {
      try { out.push([name, JSON.parse(fs.readFileSync(f, 'utf8'))]); } catch (e) { log.push(`  note: ${name} header unreadable (${e.message})`); }
    }
  }
  return out;
}
const HEADERS = loadHeaders();
const HDR = HEADERS.length ? HEADERS[0][1] : null;
const RIGS = {};
if (HDR) for (const p of HDR.players) RIGS[p.id] = buildRig(p, HDR.bones);

// =============================================================================================================
// WORKED EXAMPLE 1 — `move.cross`, hand-authored from [ANIM §4.2] (crossover right → left; generic; mirrored).
// Read it with the authoring guide at the top of src/anim/clip.js:
//   • offsets in reference metres (× sLeg at runtime), angles in degrees, `null` = not keyed at this key;
//   • feet: planted targets in the clip-start frame; a planted foot is released (null) before it is re-planted;
//   • B 'path' + Bp keys move the ball along an authored Catmull-Rom path until B 'drib' hands it to dribble.js;
//   • R is the cumulative root displacement (implicit [0, 0, 0] at t = 0), applied as velocity (root 'motion');
//   • params feed gameplay: steal-immunity window and exit velocity (clip-start frame, m/s).
// =============================================================================================================
export const EXAMPLE_CROSS = defineClip({
  id: 'move.cross', dur: 0.40, mask: 'full', root: 'motion', entry: 'replace', hand: 'R', cancel: 0.30,
  blendIn: 0.06, blendOut: 0.12, tempo: true,
  params: { imm: [0.05, 0.30], exitV: [2.6, 3.0], cat: 'move' },
  keys: [
    [0.00, { P: [0, -0.06, 0, 10, 0, 0], S: [14, 0, 0], RA: [30, 14, 15, 70, 90, 10, 0], LA: [20, 12, 0, 30, 15, 0, 0],
      Rft: [-0.24, 0.10, 0, 't'], Lft: [0.22, -0.30, 0, 't'], B: 'path', Bp: [-0.30, 0.80, 0.28], R: [0, 0, 0],
      RF: 'grip', look: 'man' }],
    [0.05, { ev: 'plantR' }],
    [0.08, { P: [-0.06, -0.14, 0, 16, -8, 4], S: [20, -10, 6], RA: [25, 5, 35, 80, 95, 30, 0], RC: [null, 15], Bp: [-0.20, 0.55, 0.30] }],
    [0.10, { R: [-0.05, 0.10, 0] }],
    [0.13, { ev: 'bounce', Bp: [0.00, 0.12, 0.36], Lft: null, LL: [45, 20, 0, 70, 15, 0] }],
    [0.18, { P: [0.04, -0.15, 0.05, 18, 10, -6], S: [22, 12, -8], RA: [20, 10, 20, 40, 40, 0, 0], LA: [28, 15, 20, 70, 90, 10, 0], Bp: [0.18, 0.45, 0.34] }],
    [0.20, { R: [0.35, 0.25, 0] }],
    [0.22, { Rft: null, RL: [10, 5, 0, 35, 35, 0] }],                       // push-off complete
    [0.24, { ev: 'handOnL', Bp: [0.30, 0.68, 0.32], B: 'drib', LF: 'grip', RF: 'relax' }],
    [0.28, { ev: 'plantL', Lft: [1.00, 0.52, 10, 't'], RL: [40, 10, 0, 80, 10, 0] }],
    [0.30, { R: [0.78, 0.42, 0] }],
    [0.40, { P: [0.02, -0.09, 0, 12, 4, 0], S: [16, 4, 0], Rft: [0.80, 0.85, 0, 't'], R: [1.00, 0.60, 0], ev: ['plantR', 'end'] }],
  ],
});

// =============================================================================================================
// WORKED EXAMPLE 2 — `exampleJumper(p, variant)`: [ANIM §5.3] makeJumper as a generator over presets.FORMS
// (right-handed; mirror for the left). Times are final for the player (tempo: false), so the clip's takeoff / set /
// release land exactly on select.getTiming(p, 'jumper', …) and the clock only has to hold at `set`.
// =============================================================================================================
export function exampleJumper(p, variant = 'mid') {
  const F = FORMS[p];
  const key = variant === 'pull12' || variant === 'pullHop' ? 'pull' : variant;
  const TO = F.takeoff[key], h = F.h[key];
  const tI = TO + th(h) + F.rva - 0.05;                       // ideal input: launch (input + 0.05) at apex + rva
  const tSet = Math.max(TO - 0.05, tI - F.setLead);
  const tRel = tI + 0.05;
  const tLand = TO + 2 * th(h);
  const tEnd = Math.max(tLand + 0.25, tRel + F.followHold + 0.15);
  const D = DIP_ARMS[F.ballAtDip];
  const fade = key === 'fade';
  const lean = fade ? F.fadeLean : 0;
  const air = fade ? F.airFade : { R: [10, 15], L: [10, 15] };
  const drift = fade ? F.fadeDrift : -F.forwardDrift;
  const g = F.guide;
  return defineClip({
    id: 'shot.' + variant, dur: tEnd, mask: 'full', root: 'motion', entry: 'stop', entryDecel: 18, tempo: false,
    jump: { h }, hand: 'R', cancel: tLand + 0.10, blendIn: 0.06, blendOut: 0.20,
    params: { cat: 'jumper', meterFrom: 0, tIdeal: tI },
    keys: [
      [0, { P: [0, -0.03, 0, 4, 0, 0], S: [8, 0, 0], N: [-6, 0, 0], ...SHORT.CHEST, RL: LEG.shotStart, LL: LEG.shotStart,
        Rft: [-0.20, 0.05, 10, 'f'], Lft: [0.20, -0.02, 10, 'f'], RF: 'grip', LF: 'grip', B: 'both', look: 'rim', R: [0, 0, 0] }],
      [0.6 * TO, { P: [0, -F.dip, 0, 10, 0, 0], S: [10, 0, 0], N: [-12, 0, 0], RA: D.RA, LA: D.LA,
        RL: [30, 6, 4, F.kneeDip, -(F.kneeDip - 30), 0], LL: [30, 6, 4, F.kneeDip, -(F.kneeDip - 30), 0] }],
      // takeoff: arms rising through the chest — omitted when `set` comes first (Giannis' 0.14 s setLead: the ball is
      // already at the set point, re-keying the takeoff arms would pull it back down: the "hitch" is the hold itself)
      [TO, { P: [0, -0.02, 0, 2, 0, 0], S: [3, 0, 0], N: [-4, 0, 0], RL: LEG.takeoff, LL: LEG.takeoff, Rft: null, Lft: null,
        R: [0, 0, 0], ev: 'takeoff', ...(TO < tSet ? { RA: [80, 8, 20, 115, 80, -55, 0], LA: [75, 15, 40, 110, 0, -20, 0] } : {}) }],
      [tSet, { RA: SET(p), LA: GUIDE(p), RF: 'shoot', N: F.head, P: [0, 0, 0, -lean / 2, 0, 0], S: [-lean / 2, 0, 0],
        RL: [air.R[0], 4, 0, air.R[1], 30, 0], LL: [air.L[0], 4, 0, air.L[1], 30, 0], ev: 'set' }],
      // release: the trunk stays extended through the launch (otherwise it pitches toward the landing key mid-air and
      // the ball leaves ≈ 0.07 m low); the pelvis dy in the air is the animator's (SAMPLE_AIR_LINEAR + jumpY)
      [tRel, { RA: REL(p), LA: [g[0] + 5, g[1] + 15, g[2] - 15, g[3] - 20, g[4] - 20, 0, 0], B: 'free', ev: 'release',
        P: [null, null, null, -lean / 2, 0, 0], S: [-lean / 2, 0, 0], N: F.head }],
      [tRel + 0.10, { RA: FOLLOW(p), RF: 'snap' }],
      [tLand, { P: [0, -0.10, 0, 8, 0, 0], S: [6, 0, 0], RL: LEG.land, LL: LEG.land, Rft: [-0.20, -drift, 10, 'f'],
        Lft: [0.20, -drift - 0.03, 10, 'f'], R: [0, -drift, 0], ev: 'land' }],
      [Math.max(tLand, tRel + F.followHold), { RA: [F.relFlex - 5, 4, 15, 0, 95, F.followWrist, 0] }],
      [tEnd, { P: [0, -0.03, 0, 4, 0, 0], S: [4, 0, 0], N: [0, 0, 0], ...SHORT.DOWN, RF: 'relax', LF: 'relax' }],
    ],
  });
}

// ------------------------------------------------------------------------------------------------ helpers
function symRig() {
  if (!HDR) return null;
  // the PoC header is exactly left/right symmetric; the mirror test below would also catch an asymmetric bake
  return RIGS.kobe;
}

function quatAngleDeg(q, o, r, ro) {
  const d = Math.abs(q[o] * r[ro] + q[o + 1] * r[ro + 1] + q[o + 2] * r[ro + 2] + q[o + 3] * r[ro + 3]);
  return 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI;
}

function poseWorld(rig, clip, t, flags = 0) {
  const pose = new Pose();
  sampleClip(clip, t, pose, flags);
  const s = rig.metrics.sLeg;
  return { pose, fk: fkWorld(rig, pose.q, [pose.pel[0] * s, pose.pel[1] * s, pose.pel[2] * s]) };
}

function runClock(src, opts = {}) {
  const clock = new ClipClock();
  const ring = new EventRing(64);
  clock.start(src, opts.rate || 1, opts.tempo || 1, opts.warp || null);
  const out = [];
  let now = 0;
  for (let i = 0; i < (opts.steps || 240) && clock.active; i++) {
    if (opts.onStep) opts.onStep(clock, now);
    clock.step(DT, now, ring, 0, 0);
    for (let e; (e = ring.next());) {
      out.push({ code: e.code, t: e.t, param: e.param });
      if (opts.onEvent) opts.onEvent(e, clock);
    }
    now += DT;
  }
  return out;
}
const firstT = (evs, code) => { const e = evs.find((x) => x.code === code); return e ? e.t : -1; };

// =============================================================================================================
// GROUPS
// =============================================================================================================
export const GROUPS = [];

GROUPS.push(['rig', () => {
  ok(BONE_COUNT === 53 && BONE_NAMES.length === 53, 'bone count');
  ok(BONE.hand_r === 20 && BONE.thumb_03_r === 52 && BONE.neck_01 === 21, 'canonical indices');
  for (let i = 0; i < BONE_COUNT; i++) {
    ok(MIRROR[MIRROR[i]] === i, `MIRROR involution ${BONE_NAMES[i]}`);
    if (BONE_SIDE[i] !== 0) ok(BONE_SIDE[MIRROR[i]] === -BONE_SIDE[i] && MIRROR[i] !== i, `MIRROR swaps sides ${BONE_NAMES[i]}`);
    else ok(MIRROR[i] === i, `axial self-mirror ${BONE_NAMES[i]}`);
    ok(BONE_PARENT[i] < i, `parents first ${BONE_NAMES[i]}`);
  }
  throws(() => assertBoneTable([{ name: 'Root', parent: -1 }]), /53/, 'assertBoneTable rejects short tables');
  if (!HEADERS.length) { ok(false, 'no baked header found (PoC or v2)'); return; }
  for (const [name, hdr] of HEADERS) {
    ok(assertBoneTable(hdr.bones) === true, `${name} header bone table equals [ANIM §1.1]`);
    for (const p of hdr.players) {
      const rig = buildRig(p, hdr.bones);
      for (const k of ['ua_l', 'la_l', 'h_l', 'ua_r', 'la_r', 'h_r']) {
        const ax = rig.frames['axes_' + k];
        const { X, Y, Z } = ax;
        const det = X[0] * (Y[1] * Z[2] - Y[2] * Z[1]) - X[1] * (Y[0] * Z[2] - Y[2] * Z[0]) + X[2] * (Y[0] * Z[1] - Y[1] * Z[0]);
        ok(Math.abs(det - 1) < 1e-4, `${name}/${p.id} frame ${k} det 1 (${det})`);
        const orth = Math.abs(X[0] * Y[0] + X[1] * Y[1] + X[2] * Y[2]) + Math.abs(Y[0] * Z[0] + Y[1] * Z[1] + Y[2] * Z[2]);
        ok(orth < 1e-6, `${name}/${p.id} frame ${k} orthogonal`);
      }
      ok(rig.frames.axes_h_l.Z[0] < -0.3, `${p.id} left palm normal points medially (−x)`);
      ok(rig.frames.axes_h_r.Z[0] > 0.3, `${p.id} right palm normal points medially (+x)`);
      ok(rig.frames.hinge_l[0] > 0 && rig.frames.hinge_r[0] > 0, `${p.id} hinges oriented to +x`);
      ok(rig.frames.bindElbow_l > 40 && rig.frames.bindElbow_l < 55, `${p.id} bind elbow ≈ 47° (${rig.frames.bindElbow_l.toFixed(1)})`);
      for (let s = 0; s < SOCKET_COUNT; s++) ok(rig.sock[s * 4 + 0] >= 0, `${p.id} socket ${s} defined`);
    }
  }
  // metrics vs PROXY_METRICS (spec §4.1 re-measured on the shipped v2 bake): the shipped header must match within a
  // few millimetres; the historical PoC bake (test/scratch, local only) is reported, not enforced, since the likeness
  // re-bake changed shoulder widths / arm lengths on purpose
  const T = PROXY_METRICS;
  for (const [name, hdr] of HEADERS) {
    if (name === 'poc') {
      for (const p of hdr.players) {
        const m = buildRig(p, hdr.bones).metrics, t = T[p.id];
        const off = ['hipH', 'sLeg', 'shoulderY', 'armLen', 'handLen', 'reach0', 'eyeY'].filter((f) => Math.abs(m[f] - t[f]) > 0.004);
        if (off.length) log.push(`  note: poc/${p.id} differs from the v2 bake in ${off.map((f) => `${f} ${(m[f] - t[f]).toFixed(3)}`).join(', ')}`);
      }
      continue;
    }
    const k = 3;
    for (const p of hdr.players) {
      const m = buildRig(p, hdr.bones).metrics, t = T[p.id];
      near(m.hipH, t.hipH, 0.002 * k, `${name}/${p.id} hipH`);
      near(m.sLeg, t.sLeg, 0.0015 * k, `${name}/${p.id} sLeg`);
      near(m.shoulderY, t.shoulderY, 0.002 * k, `${name}/${p.id} shoulderY`);
      near(m.armLen, t.armLen, 0.002 * k, `${name}/${p.id} armLen`);
      near(m.handLen, t.handLen, 0.001 * k, `${name}/${p.id} handLen`);
      near(m.ankleY, t.ankleY, 0.002 * k, `${name}/${p.id} ankleY`);
      near(m.reach0, t.reach0, 0.006 + 0.002 * k, `${name}/${p.id} reach0`);
      near(m.reachAug, t.reachAug, 0.006 + 0.002 * k, `${name}/${p.id} reachAug`);
      near(m.eyeY, t.eyeY, 0.002 * k, `${name}/${p.id} eyeY`);
    }
  }
  // sign checks [ANIM §1.4] (Kobe, standing)
  const rig = RIGS.kobe;
  const posed = (list) => {
    const q = new Float32Array(BONE_COUNT * 4);
    for (let i = 0; i < BONE_COUNT; i++) q[i * 4 + 3] = 1;
    for (const [b, ch] of list) anatQuat(BONE_KIND[b], BONE_SIDE[b], ch, q, b * 4);
    return fkWorld(rig, q, null);
  };
  const arm = (s, a) => [[BONE['upperarm_' + s], [a[0], a[1], a[2]]], [BONE['lowerarm_' + s], [a[3], a[4]]], [BONE['hand_' + s], [a[4], a[5], a[6]]]];
  const P = (fk, b) => [fk.pos[BONE[b] * 3], fk.pos[BONE[b] * 3 + 1], fk.pos[BONE[b] * 3 + 2]];
  let fk = posed(arm('r', [90, 0, 0, 0, 0, 0, 0]));
  const fwd = P(fk, 'hand_r')[2] - P(fk, 'upperarm_r')[2];
  ok(fwd >= 0.55 && fwd <= 0.62, `RA flex 90 puts the hand 0.55–0.62 m in front of the shoulder (${fwd.toFixed(3)})`);
  fk = posed(arm('r', [0, 90, 0, 0, 0, 0, 0]));
  ok(P(fk, 'upperarm_r')[0] - P(fk, 'hand_r')[0] >= 0.55, 'RA abd 90 puts the hand ≥ 0.55 m to the right');
  fk = posed([[BONE.calf_r, [90]]]);
  ok(P(fk, 'foot_r')[2] < P(fk, 'calf_r')[2] - 0.3, 'RL knee 90 puts the ankle behind the knee');
  fk = posed([[BONE.thigh_r, [60, 0, 0]]]);
  ok(P(fk, 'calf_r')[2] > 0.3, 'hip flexion lifts the thigh forward');
  fk = posed(arm('r', [0, 0, 0, 90, 0, 0, 0]));
  let Z = new Float64Array(rig.frames.axes_h_r.Z); qrotate(fk.rot, BONE.hand_r * 4, Z, 0, Z, 0);
  const fa = [P(fk, 'hand_r')[0] - P(fk, 'lowerarm_r')[0], P(fk, 'hand_r')[1] - P(fk, 'lowerarm_r')[1], P(fk, 'hand_r')[2] - P(fk, 'lowerarm_r')[2]];
  ok(Math.abs(fa[1]) < 0.01 && fa[2] > 0.25, 'elbow 90: forearm horizontal forward');
  ok(Z[0] > 0.9, 'elbow 90: palm faces medially');
  fk = posed(arm('r', [0, 0, 0, 90, 90, 0, 0]));
  Z = new Float64Array(rig.frames.axes_h_r.Z); qrotate(fk.rot, BONE.hand_r * 4, Z, 0, Z, 0);
  ok(Z[1] < -0.9, 'pron 90 turns the palm down');
  // anatomical mirror: right-side channels = reflection of the same left-side channels
  const rng = testRng(7);
  const qa = new Float64Array(4), qb = new Float64Array(4), v = new Float64Array([0.3, -0.7, 0.2]), va = new Float64Array(3), vb = new Float64Array(3);
  for (let k = 0; k < 200; k++) {
    const kind = [AQ.AXIAL, AQ.CLAV, AQ.UPPERARM, AQ.LOWERARM, AQ.THIGH, AQ.CALF, AQ.FOOT, AQ.TOE, AQ.FINGER, AQ.THUMB1][k % 10];
    const ch = [rng.next() * 160 - 60, rng.next() * 120 - 40, rng.next() * 80 - 40];
    anatQuat(kind, 1, ch, qa); anatQuat(kind, -1, ch, qb);
    qrotate(qa, 0, v, 0, va, 0);
    const mv = new Float64Array([-v[0], v[1], v[2]]);
    qrotate(qb, 0, mv, 0, vb, 0);
    if (kind === AQ.AXIAL) continue;  // axial bones have no side
    ok(Math.abs(va[0] + vb[0]) < 1e-9 && Math.abs(va[1] - vb[1]) < 1e-9 && Math.abs(va[2] - vb[2]) < 1e-9, `anatQuat mirror kind ${kind}`);
  }
  // toLocal on a THREE-like quaternion object
  const qo = { _x: 0, _y: 0, _z: 0, _w: 1, isQuaternion: true };
  const qan = new Float32Array([0, 0, 0, 1]);
  toLocal(rig, BONE.upperarm_r, qan, qo);
  near(Math.hypot(qo._x, qo._y, qo._z, qo._w), 1, 1e-6, 'toLocal writes a unit quaternion into a Quaternion-like object');
}]);

GROUPS.push(['clip', () => {
  const cross = compileClip(EXAMPLE_CROSS);
  const tm = clipTiming(cross);
  ok(tm.dur === 0.40 && cross.n === 13 && Math.abs(cross.fps - 30) < 1e-9, 'move.cross frames at 30 Hz with the last at dur');
  ok(tm.events.map((e) => e.name).join(',') === 'plantR,bounce,handOn,plantL,plantR,end', `events sorted (${tm.events.map((e) => e.name)})`);
  ok(tm.events[2].param === HAND.L, 'handOnL → HAND_ON param L');
  ok(tm.exitV[0] === 2.6 && tm.imm[1] === 0.30 && tm.cancel === 0.30, 'params exported by clipTiming');
  // first/last key completeness after normalisation
  const first = EXAMPLE_CROSS.keys[0][1], last = EXAMPLE_CROSS.keys[EXAMPLE_CROSS.keys.length - 1][1];
  for (const g of ['P', 'S1', 'S2', 'S3', 'RA', 'LA', 'RL', 'LL']) {
    ok(first[g] && first[g].every((x) => x !== null), `first key complete: ${g}`);
    ok(last[g] && last[g].every((x) => x !== null), `last key complete: ${g}`);
  }
  ok(first.RC && first.RC[1] === 15 && first.RC[0] === null, 'unkeyed clavicle elev stays unkeyed (0), prot held back');
  // sampled values: no NaN, unit quaternions
  const pose = new Pose();
  for (let t = 0; t <= 0.40001; t += 0.01) {
    sampleClip(cross, t, pose);
    let bad = 0;
    for (let i = 0; i < BONE_COUNT; i++) { const l = Math.hypot(pose.q[i * 4], pose.q[i * 4 + 1], pose.q[i * 4 + 2], pose.q[i * 4 + 3]); if (!(Math.abs(l - 1) < 1e-5)) bad++; }
    ok(bad === 0, `unit quaternions at ${t.toFixed(2)}`);
  }
  sampleClip(cross, 0, pose);
  ok(pose.ball[0] === BM.PATH && pose.ftOn[0] === 1 && pose.ftOn[1] === 1 && pose.look[0] === LOOK.man, 'step tracks at t=0');
  sampleClip(cross, 0.16, pose);
  ok(pose.ftOn[1] === 0 && pose.ftOn[0] === 1, 'left foot released at 0.13, right still planted');
  sampleClip(cross, 0.30, pose);
  ok(pose.ball[0] === BM.DRIB && pose.ftOn[0] === 0 && pose.ftOn[1] === 1, 'ball handed to the dribble, left foot re-planted');
  near(pose.ftRL[4], 1.00, 1e-6, 'left foot plant x');
  sampleClip(cross, 0.40, pose);
  near(pose.root[0], 1.00, 1e-6, 'root end x'); near(pose.root[1], 0.60, 1e-6, 'root end z');
  sampleClip(cross, 0.13, pose);
  near(pose.bpath[1], 0.12, 1e-6, 'ball path passes the bounce key exactly');
  // root curve monotone between keys (Fritsch–Carlson: no overshoot past the end value)
  const r = new Float64Array(3);
  let maxX = -Infinity;
  for (let t = 0; t <= 0.4; t += 0.005) { sampleRoot(cross, t, r); maxX = Math.max(maxX, r[0]); }
  ok(maxX <= 1.0 + 1e-6, 'root x never overshoots its last key');
  // Hermite monotone: flat holds stay flat, no overshoot
  const hm = hermiteMonotone([0, 1, 2, 3], [0, 1, 1, 0]);
  ok(Math.abs(hm(1.5) - 1) < 1e-12, 'flat hold stays flat');
  let mx = 0; for (let t = 0; t <= 3; t += 0.01) mx = Math.max(mx, hm(t));
  ok(mx <= 1 + 1e-12, 'no overshoot');
  // joint limits clamp after interpolation
  const lim = compileClip(defineClip({ id: 'test.limits', dur: 1, keys: [[0, { RA: [0, 0, 0, 0, 0, 0, 0] }], [1, { RA: [0, 0, 0, 170, 0, 0, 0] }]] }));
  sampleClip(lim, 1, pose);
  const want = new Float64Array(4); anatQuat(AQ.LOWERARM, -1, [150, 0], want);
  ok(quatAngleDeg(pose.q, BONE.lowerarm_r * 4, want, 0) < 0.06, 'elbow clamped to 150°');
  // scapulohumeral rhythm
  near(rhythmElev(180, 0, 0), 26, 1e-9, 'rhythm caps at 26° overhead');
  near(rhythmElev(90, 0, 0), 6.6, 1e-6, 'rhythm 0.22·(90 − 60)');
  ok(rhythmElev(30, 0, 0) === 0, 'no rhythm below 60°');
  const up = compileClip(defineClip({ id: 'test.up', dur: 1, keys: [[0, { RA: [180, 0, 0, 0, 0, 0, 0] }], [1, {}]] }));
  ok(up.qOff[BONE.clavicle_r] >= 0 && up.qOff[BONE.clavicle_l] < 0, 'rhythm tracks the clavicle of the raised arm');
  const noR = compileClip(defineClip({ id: 'test.noR', dur: 1, noRhythm: true, keys: [[0, { RA: [180, 0, 0, 0, 0, 0, 0] }], [1, {}]] }));
  ok(noR.qOff[BONE.clavicle_r] < 0, 'noRhythm suppresses the shrug');
  if (HDR) {
    // the shrug raises the shoulder ≈ 0.07–0.08 m and leaves the arm direction unchanged
    const a = poseWorld(RIGS.kobe, up, 0.5), b = poseWorld(RIGS.kobe, noR, 0.5);
    const sy = a.fk.pos[BONE.upperarm_r * 3 + 1] - b.fk.pos[BONE.upperarm_r * 3 + 1];
    ok(sy > 0.06 && sy < 0.10, `rhythm raises the shoulder ${sy.toFixed(3)} m`);
    const dirA = [0, 1, 2].map((k) => a.fk.pos[BONE.hand_r * 3 + k] - a.fk.pos[BONE.upperarm_r * 3 + k]);
    const dirB = [0, 1, 2].map((k) => b.fk.pos[BONE.hand_r * 3 + k] - b.fk.pos[BONE.upperarm_r * 3 + k]);
    ok(Math.hypot(dirA[0] - dirB[0], dirA[1] - dirB[1], dirA[2] - dirB[2]) < 1e-4, 'rhythm keeps the authored arm direction');
  }
  // errors
  throws(() => defineClip({ id: 'x', dur: 1, keys: [[0, { RA: [1, 2, 3] }]] }), /RA must be an array of 7/, 'bad arity');
  throws(() => defineClip({ id: 'x', dur: 1, keys: [[0, { Foo: [1] }]] }), /unknown channel/, 'unknown channel');
  throws(() => defineClip({ id: 'x', dur: 1, keys: [[0, { RF: 'wave' }]] }), /unknown finger preset/, 'unknown preset');
  throws(() => defineClip({ id: 'x', dur: 1, keys: [[0, {}]], ev: [[0.5, 'jumpp']] }), /unknown event/, 'unknown event');
  throws(() => defineClip({ id: 'x', dur: 1, keys: [[1.5, {}]] }), /outside/, 'key outside dur');
  throws(() => defineClip({ id: 'x', dur: 1, keys: [[0, {}]], target: 'takeoff' }), /target event/, 'target needs its event');
  throws(() => compileClip(defineClip({ id: 'x', dur: 1, keys: [[0, { Rft: [0, 0, 0, 'f'] }], [0.5, { Rft: [0.3, 0, 0, 'f'] }], [1, {}]] })), /moves while planted/, 'planted feet never translate');
  ok(!!compileClip(defineClip({ id: 'x', dur: 1, keys: [[0, { Rft: [0, 0, 0, 't'] }], [0.5, { Rft: [0, 0, 90, 'f'] }], [1, {}]] })), 'yaw-only pivot allowed');
  // mirror symmetry: mirror(sample(clip)) == sample(mirror(clip)) reflected in x (world positions)
  const rig = symRig();
  if (rig) {
    const jumper = compileClip(exampleJumper('kobe', 'fade'));
    for (const c of [cross, jumper]) {
      const cm = compileClip(mirrorDef(c.def));
      ok(cm.id === c.id + '_L', `mirror id ${cm.id}`);
      let worst = 0;
      for (const [t] of c.def.keys) {
        const A = poseWorld(rig, c, t), B = poseWorld(rig, cm, t);
        for (let b = 0; b < BONE_COUNT; b++) {
          const m = MIRROR[b];
          worst = Math.max(worst, Math.abs(A.fk.pos[b * 3] + B.fk.pos[m * 3]), Math.abs(A.fk.pos[b * 3 + 1] - B.fk.pos[m * 3 + 1]), Math.abs(A.fk.pos[b * 3 + 2] - B.fk.pos[m * 3 + 2]));
        }
        const ra = new Float64Array(3), rb = new Float64Array(3);
        sampleRoot(c, t, ra); sampleRoot(cm, t, rb);
        worst = Math.max(worst, Math.abs(ra[0] + rb[0]), Math.abs(ra[1] - rb[1]), Math.abs(ra[2] + rb[2]));
      }
      ok(worst < 1e-4, `${c.id}: mirror symmetry within 1e-4 (worst ${worst.toExponential(2)})`);
      ok(clipTiming(cm).events.some((e) => e.code === EV.HAND_ON) === clipTiming(c).events.some((e) => e.code === EV.HAND_ON), 'mirrored events');
    }
    const cm = compileClip(mirrorDef(cross.def));
    ok(clipTiming(cm).events[2].param === HAND.R, 'handOnL mirrors to handOnR');
    ok(cm.def.params.exitV[0] === -2.6, 'exitV x mirrored');
  }
  // timing clip + validate
  const tc = makeTimingClip({ id: 'test.timing', dur: 1.0, ev: [[0.2, 'takeoff'], [0.4, 'release'], [0.8, 'land']], jump: { h: 0.4 }, meter: 'key', R: [0, 1, 0] });
  ok(tc.tracked.length === 0 && tc.hasRoot && clipTiming(tc).keyRelease, 'timing clip: no bones, root, key meter');
  ok(validateClip(tc).length === 0, 'timing clip validates');
  const bad = compileClip(defineClip({ id: 'test.hip', dur: 1, keys: [[0, { RL: [100, 0, 0, 0, 0, 0] }], [1, {}]] }));
  ok(validateClip(bad).some((w) => /95/.test(w)), 'validateClip flags hip > 95° on the ground');
  // per-player overrides and the registry
  const idx = registerClip(defineClip({ id: 'test.per', dur: 0.5, keys: [[0, { S: [10, 0, 0] }], [0.5, {}]],
    per: { yao: { keys: [[0.25, { S: [20, 0, 0] }]], tempo: 1.12 } } }));
  ok(clipIdOf(idx) === 'test.per' && clipIndex('test.per') === idx, 'registry ids');
  const shared = getClip(idx, null, false), yaoC = getClip(idx, 'yao', false);
  ok(shared !== yaoC && yaoC.def.keys.length === 3 && shared.def.keys.length === 2, 'per-player compiled copy');
  ok(getClip(idx, 'kobe', false) === shared, 'players without overrides share the clip');
  ok(getClip(idx, null, true).id === 'test.per_L', 'lazy mirrored twin');
  throws(() => registerClip(defineClip({ id: 'test.per_L', dur: 0.5, keys: [[0, {}]] })), /twins are automatic/, 'register refuses _L ids');
  const reserved = clipIndex('test.notYet');
  ok(getClip(reserved, null, false) === null && getDef(reserved) === null, 'reserved index without data');
  ok(compileAll(PLAYER_IDS) >= 4, 'compileAll');
}]);

GROUPS.push(['clock', () => {
  const kobeJ = compileClip(exampleJumper('kobe', 'mid'));
  const T = getTiming('kobe', 'jumper', 'set');
  const tm = clipTiming(kobeJ);
  near(tm.takeoff, T.takeoffT, 1e-6, 'example jumper takeoff = getTiming'); near(tm.release, T.releaseT, 1e-6, 'release = getTiming');
  near(tm.set, T.setT, 1e-6, 'set = getTiming'); near(tm.land, T.landT, 1e-6, 'land = getTiming');
  // perfect input
  const inputAt = (tu) => (clock, now) => { if (!clock.released && now + 1e-9 >= tu) clock.releaseNow(); };
  let evs = runClock(kobeJ, { warp: T.warp, onStep: inputAt(T.tIdeal) });
  const tuQ = Math.ceil(T.tIdeal / DT - 1e-9) * DT;
  near(firstT(evs, EV.RELEASE), tuQ + 0.05, 1e-6, 'RELEASE = input + 0.050');
  near(firstT(evs, EV.TAKEOFF), T.takeoffT, 1e-6, 'TAKEOFF on time');
  ok(Math.abs(firstT(evs, EV.RELEASE) - (T.takeoffT + th(T.h) + T.rva)) <= DT + 1e-9, 'perfect input launches at apex + rva ± 1 step');
  // late input holds at set (2 Hz micro-motion is the animator's), early input compresses into 0.05
  evs = runClock(kobeJ, { warp: T.warp, onStep: inputAt(0.60) });
  near(firstT(evs, EV.RELEASE), 0.60 + 0.05, 1e-6, 'late input: release = input + 0.05');
  evs = runClock(kobeJ, { warp: T.warp, onStep: inputAt(0.10) });
  near(firstT(evs, EV.RELEASE), 0.10 + 0.05, 1e-6, 'early input: rushed push still 0.05');
  ok(firstT(evs, EV.TAKEOFF) <= firstT(evs, EV.RELEASE), 'rushed push passes takeoff first');
  // no input + setJump: auto release before landing
  let airT = 2 * th(T.h);
  evs = runClock(kobeJ, { warp: T.warp, onEvent: (e, c) => { if (e.code === EV.TAKEOFF) c.setJump(T.h, airT); } });
  const land = firstT(evs, EV.LAND);
  near(land, T.takeoffT + airT, 1e-6, 'LAND at takeoff + ballistic airtime');
  near(firstT(evs, EV.RELEASE), land - 0.05, 1e-6, 'unreleased shot auto-launches 0.05 before landing');
  // a different gameplay airtime warps the air segment
  airT = 0.9;
  evs = runClock(kobeJ, { warp: T.warp, onStep: inputAt(T.tIdeal), onEvent: (e, c) => { if (e.code === EV.TAKEOFF) c.setJump(0.99, airT); } });
  near(firstT(evs, EV.LAND), T.takeoffT + 0.9, 1e-6, 'setJump airtime drives LAND');
  // Giannis: set lies 0.034 s before takeoff — the hold must not delay the takeoff
  const gT = getTiming('giannis', 'jumper', 'set');
  const gJ = compileClip(exampleJumper('giannis', 'mid'));
  ok(clipTiming(gJ).set < clipTiming(gJ).takeoff, 'giannis set precedes takeoff');
  evs = runClock(gJ, { warp: gT.warp, onStep: inputAt(gT.tIdeal) });
  near(firstT(evs, EV.TAKEOFF), gT.takeoffT, 1e-6, 'giannis takeoff not delayed by the hold');
  // key-release clip (layup)
  const lay = timingClip(clipIndex('lay.std2'), 'kobe', false);
  const L = getTiming('kobe', 'layup', 'std2');
  evs = runClock(lay, { onStep: inputAt(L.tIdeal + 0.03) });
  near(firstT(evs, EV.RELEASE), L.releaseT, 1e-6, 'layup input within tolerance launches at the key');
  evs = runClock(lay, { onStep: inputAt(L.tIdeal - 0.25) });
  near(firstT(evs, EV.RELEASE), Math.ceil((L.tIdeal - 0.25) / DT - 1e-9) * DT + 0.05, 1e-6, 'layup input > 0.10 early: input + 0.05');
  evs = runClock(lay, { onStep: inputAt(L.tIdeal + 0.30) });
  near(firstT(evs, EV.RELEASE), Math.ceil((L.tIdeal + 0.30) / DT - 1e-9) * DT + 0.05, 1e-6, 'layup input > 0.10 late: input + 0.05');
  // dunk profile: slam / rim grab / land from setJump
  const D = getTiming('kobe', 'dunk', 'tomahawk');
  const dk = timingClip(clipIndex(D.clipId), 'kobe', false);
  evs = runClock(dk, { onEvent: (e, c) => { if (e.code === EV.TAKEOFF) c.setJump(D.h, D.airT, D.profile); } });
  near(firstT(evs, EV.SLAM), D.slamT, 1e-6, 'SLAM at takeoff + slam');
  near(firstT(evs, EV.RIM_GRAB), D.slamT + 0.03, 1e-6, 'RIM_GRAB 0.03 after the slam');
  near(firstT(evs, EV.LAND), D.landT, 1e-6, 'dunk LAND after rise–hang–drop');
  near(D.landT, 1.22, 0.005, 'sig.kobe.tomahawk lands at 1.22 ([ANIM §9.1 K5])');
  // warp anchors clamp to [0.4, 2.5]
  const mv = timingClip(clipIndex('move.cross'), 'kobe', false);
  evs = runClock(mv, { warp: { [EV.PLANT_L]: 0.05 } });
  ok(firstT(evs, EV.PLANT_L) > 0.28 / 2.5 - 1e-6, 'anchor rate clamped to 2.5');
  // tempo (generic clips) and rate (time-scaled stun, C5)
  evs = runClock(mv, { tempo: STYLE.yao.tempo });
  near(firstT(evs, EV.END), 0.40 * 1.12, 1e-6, 'tempo 1.12 stretches a generic clip');
  const miss = timingClip(clipIndex('def.stealMiss'), 'kobe', false);
  evs = runClock(miss, { rate: 0.35 / 0.55 });
  near(firstT(evs, EV.END), 0.55, 1e-6, 'def.stealMiss time-scaled to a 0.55 s stun');
  // looping clips re-fire, t = 0 events fire on the first step
  const loop = makeTimingClip({ id: 'test.loop', dur: 0.25, loop: true, ev: [[0, 'step'], [0.1, 'bounce']] });
  evs = runClock(loop, { steps: 60 });
  ok(evs.filter((e) => e.code === EV.STEP).length === 4 && evs[0].code === EV.STEP && evs[0].t === 0, 'loop events (t = 0 included)');
  // EventRing overflow drops the oldest
  const ring = new EventRing(4);
  for (let i = 0; i < 6; i++) ring.push(EV.STEP, i, 0, 0, 0);
  ok(ring.count === 4 && ring.next().t === 2, 'ring keeps the newest 4');
}]);

GROUPS.push(['pose', () => {
  ok(MASK_W.length === 7 && MASK_W[MASK.full].every((w) => w === 1), 'full mask');
  const up = MASK_W[MASK.upper];
  ok(up[BONE.pelvis] === 0 && Math.abs(up[BONE.spine_01] - 0.35) < 1e-6 && up[BONE.spine_02] === 0.75 && up[BONE.spine_03] === 1 && up[BONE.thigh_l] === 0 && up[BONE.index_02_r] === 1 && up[BONE.head] === 1, 'upper mask column values');
  const ar = MASK_W[MASK.armR];
  ok(ar[BONE.hand_r] === 1 && ar[BONE.hand_l] === 0 && Math.abs(ar[BONE.spine_03] - 0.15) < 1e-6 && ar[BONE.clavicle_l] === 0, 'armR mask');
  const lg = MASK_W[MASK.legs];
  ok(lg[BONE.pelvis] === 1 && Math.abs(lg[BONE.spine_01] - 0.25) < 1e-6 && lg[BONE.foot_r] === 1 && lg[BONE.Root] === 1 && lg[BONE.hand_r] === 0, 'legs mask');
  ok(EXPR_NAMES.join() === 'jawOpen,tongueOut,jawJut,roar,grin,smirk,scowl,puff,blink' && EXPR.scowl === 6, 'expression order §3.9');
  const a = new Pose(), b = new Pose(), o = new Pose();
  for (let i = 0; i < BONE_COUNT; i++) { a.w[i] = 1; }
  anatQuat(AQ.THIGH, -1, [40, 0, 0], a.q, BONE.thigh_r * 4);
  anatQuat(AQ.UPPERARM, -1, [10, 0, 0], a.q, BONE.upperarm_r * 4);
  anatQuat(AQ.UPPERARM, -1, [90, 0, 0], b.q, BONE.upperarm_r * 4); b.w[BONE.upperarm_r] = 1;
  anatQuat(AQ.THIGH, -1, [0, 0, 0], b.q, BONE.thigh_r * 4); b.w[BONE.thigh_r] = 1;
  b.ball[0] = BM.BOTH; b.exprK[EXPR.roar] = 1; b.expr[EXPR.roar] = 1;
  blendPose(o, a, b, 1, MASK_W[MASK.upper]);
  const want = new Float64Array(4);
  anatQuat(AQ.UPPERARM, -1, [90, 0, 0], want);
  ok(quatAngleDeg(o.q, BONE.upperarm_r * 4, want, 0) < 0.05, 'upper mask overrides the arm');
  anatQuat(AQ.THIGH, -1, [40, 0, 0], want);
  ok(quatAngleDeg(o.q, BONE.thigh_r * 4, want, 0) < 0.05, 'upper mask leaves the legs');
  ok(o.ball[0] === BM.BOTH && o.expr[EXPR.roar] === 1, 'discrete fields and keyed expressions switch');
  blendPose(o, a, b, 0.5, MASK_W[MASK.full]);
  anatQuat(AQ.UPPERARM, -1, [50, 0, 0], want);
  ok(quatAngleDeg(o.q, BONE.upperarm_r * 4, want, 0) < 0.5, 'half blend ≈ halfway');
  // untracked bones of b keep a
  anatQuat(AQ.CALF, -1, [30], a.q, BONE.calf_r * 4);
  blendPose(o, a, b, 1, MASK_W[MASK.full]);
  anatQuat(AQ.CALF, -1, [30], want);
  ok(quatAngleDeg(o.q, BONE.calf_r * 4, want, 0) < 0.05, 'untracked bones show the lower layer');
  // additive: lean on the spine
  const add = new Pose();
  anatQuat(AQ.AXIAL, 0, [10, 0, 0], add.q, BONE.spine_02 * 4); add.w[BONE.spine_02] = 1;
  resetPose(o); addPose(o, add, 1);
  anatQuat(AQ.AXIAL, 0, [10, 0, 0], want);
  ok(quatAngleDeg(o.q, BONE.spine_02 * 4, want, 0) < 0.05, 'additive applies on bind');
  addPose(o, add, 0.5);
  anatQuat(AQ.AXIAL, 0, [15, 0, 0], want);
  ok(quatAngleDeg(o.q, BONE.spine_02 * 4, want, 0) < 0.05, 'additive accumulates (10° + 5°)');
  copyPose(a, o);
  ok(quatAngleDeg(a.q, BONE.spine_02 * 4, want, 0) < 0.05, 'copyPose');
}]);

GROUPS.push(['presets', () => {
  ok(FINGER_PRESETS.length === 12 && FINGER_ID.curlTape === 11, '12 finger presets');
  ok(FINGER_BONES.r.length === 15 && FINGER_BONES.r[0] === BONE.index_01_r && FINGER_BONES.l[14] === BONE.thumb_03_l, 'finger bone order');
  let bad = 0;
  for (let i = 0; i < FINGER_Q.length; i += 4) if (Math.abs(Math.hypot(FINGER_Q[i], FINGER_Q[i + 1], FINGER_Q[i + 2], FINGER_Q[i + 3]) - 1) > 1e-5) bad++;
  ok(bad === 0, 'finger quaternions are unit');
  const a = new Float32Array(60), b = new Float32Array(60);
  fingerQuats(FINGER_ID.curlTape, 0, 0, a, 0); fingerQuats(FINGER_ID.curlTape, 0, 0.625, b, 0);
  ok(quatAngleDeg(a, 0, b, 0) > 50, 'curlTape animates (index curls ≈ 60° at half period)');
  fingerQuats(FINGER_ID.fist, 0, 0, a, 0); fingerQuats(FINGER_ID.relax, 0, 0, b, 0);
  ok(quatAngleDeg(a, 4, b, 4) > 70, 'fist curls the index _02');
  for (const p of PLAYER_IDS) {
    ok(!!FORMS[p] && !!STYLE[p] && !!STANCE.def[p], `${p} has form, style and defensive stance`);
    ok(FORMS[p].set.length === 7 && REL(p)[0] === FORMS[p].relFlex && FOLLOW(p)[5] === FORMS[p].followWrist, `${p} form arrays`);
  }
  ok(SET('kobe')[0] === 115 && GUIDE('yao')[2] === 45, 'SET/GUIDE');
  ok(STYLE.yao.tempo === 1.12 && STYLE.kyrie.dribble.f === 1.10 && STYLE.giannis.toeBounce.hz === 2.0, 'STYLE spot checks §4.7');
  ok(STANCE.def.giannis.width === 0.90 && STANCE.postUp.Rft[0] === -0.38 && ARM.contestApex[0] === 172, 'stance / arm spot checks');
  ok(FORMS.jordan.lay.gScale === 0.80 && FORMS.yao.lay.vAir === 1.8 && FORMS.kyrie.dunk.h2 === 0.93, 'finish numbers');
}]);

GROUPS.push(['select', () => {
  // every player × kind × variant finite
  let count = 0;
  for (const p of PLAYER_IDS) {
    for (const kind of Object.keys(KINDS)) {
      for (const v of KINDS[kind]) {
        const r = getTiming(p, kind, v);
        count++;
        const fields = ['tIdeal', 'takeoffT', 'h', 'rva', 'meterFrom', 'METER_T', 'landT', 'airT', 'dur'];
        ok(!!r && fields.every((f) => Number.isFinite(r[f])) && r.gatherWindow.length === 2 && r.gatherWindow.every(Number.isFinite) && typeof r.clipId === 'string', `getTiming finite ${p}/${kind}/${v}`);
        ok(r.METER_T > 0 && r.tIdeal > 0 && r.h > 0 && r.landT > r.takeoffT, `getTiming sane ${p}/${kind}/${v}`);
        if (r.meter === 'hold') near(r.tIdeal, r.takeoffT + th(r.h, r.gScale) + r.rva - 0.05, 0.004, `meter formula ${p}/${kind}/${v}`);   // signature rows are tabulated to 0.01
        if (r.meter === 'key') near(r.tIdeal, r.releaseT - 0.05, 1e-9, `key release ${p}/${kind}/${v}`);
      }
    }
  }
  ok(count === 6 * Object.values(KINDS).reduce((s, v) => s + v.length, 0), `covered ${count} records`);
  ok(getTiming('kobe', 'nope', '') === null && getTiming('nobody', 'jumper', 'set') === null, 'unknown kind/player → null');
  ok(getTiming('kobe', 'jumper', 'weird') === getTiming('kobe', 'jumper', 'set'), 'unknown variant → default');
  ok(getTiming('giannis', 'layup', 'sig.giannis.euroLay').clipId === 'sig.giannis.euroLay', 'variant may be a clip id');
  // §4.9.2 derived table (tIdeal / METER_T)
  const TAB = {
    set: { kobe: [0.429, 0.536], jordan: [0.435, 0.544], lebron: [0.417, 0.521], giannis: [0.466, 0.583], yao: [0.442, 0.553], kyrie: [0.377, 0.471] },
    three: { kobe: [0.443, 0.554], jordan: [0.426, 0.533], lebron: [0.412, 0.515], giannis: [0.456, 0.570], yao: [0.446, 0.558], kyrie: [0.387, 0.484] },
    pull12: { kobe: [0.486, 0.607], jordan: [0.475, 0.594], lebron: [0.498, 0.623], giannis: [0.506, 0.633], yao: [0.512, 0.640], kyrie: [0.436, 0.545] },
  };
  for (const v of Object.keys(TAB)) for (const p of PLAYER_IDS) {
    const r = getTiming(p, 'jumper', v);
    near(r.tIdeal, TAB[v][p][0], 0.0015, `${p} ${v} tIdeal`); near(r.METER_T, TAB[v][p][1], 0.002, `${p} ${v} METER_T`);
  }
  const FADE = { kobe: [0.469, 0.586], jordan: [0.490, 0.613], lebron: [0.496, 0.620], yao: [0.529, 0.661], kyrie: [0.436, 0.545] };
  for (const p of Object.keys(FADE)) { const r = getTiming(p, 'fade', ''); near(r.tIdeal, FADE[p][0], 0.0015, `${p} fade tIdeal`); near(r.METER_T, FADE[p][1], 0.002, `${p} fade METER_T`); }
  ok(getTiming('giannis', 'fade', '').clipId === 'shot.mid', 'Giannis has no fade form → mid');
  // §4.9.3 layup table (C12 Jordan)
  const LAY = { kobe: [0.630, 0.390, 0.79, 0.49], jordan: [0.692, 0.462, 0.865, 0.578], lebron: [0.640, 0.392, 0.80, 0.49], giannis: [0.664, 0.410, 0.83, 0.51], yao: [0.567, 0.301, 0.71, 0.38], kyrie: [0.585, 0.365, 0.73, 0.46] };
  for (const p of PLAYER_IDS) {
    const s2 = getTiming(p, 'layup', 'std2'), s1 = getTiming(p, 'layup', 'std1');
    near(s2.tIdeal, LAY[p][0], 0.0015, `${p} std2 tIdeal`); near(s1.tIdeal, LAY[p][1], 0.0045, `${p} std1 tIdeal`);   // the std1 column is rounded inconsistently (LeBron = Kobe's inputs)
    near(s2.METER_T, LAY[p][2], 0.006, `${p} std2 METER_T`); near(s1.METER_T, LAY[p][3], 0.009, `${p} std1 METER_T`);
    ok(s2.gatherWindow[0] === 2.5 && s2.gatherWindow[1] === (p === 'jordan' ? 4.6 : 4.0) && s1.gatherWindow[1] === 2.5, `${p} layup press windows (C9)`);
  }
  // §4.12 signature numbers
  const SIG = [
    ['kobe', 'turnFade', '', 'sig.kobe.turnFade', 0.50, 0.959, 0.574, 0.70, 0.50], ['kobe', 'jumper', 'jabPullup', 'sig.kobe.ripPullup', 0, 0.465, 0.58, 0.19, 0.55],
    ['kobe', 'jumper', 'sideStepPullup', 'sig.kobe.sideStepPullup', 0.12, 0.589, 0.586, 0.33, 0.50], ['kobe', 'layup', 'baseline', 'sig.kobe.baselineSpinLay', 0.47, 0.855, 0.48, 0.60, 0.55],
    ['kobe', 'fade', 'baseline', 'sig.kobe.baselineSpinFade', 0.40, 0.879, 0.60, 0.62, 0.50], ['kobe', 'stepback', 'branch', 'sig.kobe.hesiCrossStepbackShot', 0, 0.459, 0.574, 0.20, 0.50],
    ['jordan', 'turnFade', '', 'sig.jordan.turnFade', 0.45, 0.986, 0.67, 0.68, 0.62], ['jordan', 'layup', 'switch', 'sig.jordan.theMove', 0.30, 0.79, 0.61, 0.12, 0.95],
    ['jordan', 'jumper', 'jabPullup', 'sig.jordan.jabShot', 0, 0.40, 0.50, 0.13, 0.50], ['jordan', 'jumper', 'pull12', 'sig.jordan.pullup', 0, 0.475, 0.594, 0.19, 0.55],
    ['lebron', 'turnFade', 'L', 'sig.lebron.leftBlockFade', 0.15, 0.616, 0.58, 0.42, 0.40], ['lebron', 'stepback', '', 'sig.lebron.stepback3', 0, 0.496, 0.62, 0.36, 0.25],
    ['giannis', 'layup', 'sigEuro', 'sig.giannis.euroLay', 0.60, 1.15, 0.69, 0.83, 0.72], ['giannis', 'layup', 'spin', 'sig.giannis.spinGather', 0.63, 1.07, 0.55, 0.83, 0.50],
    ['yao', 'hook', '', 'sig.yao.hook', 0.30, 0.74, 0.55, 0.60, 0.22], ['yao', 'turnFade', '', 'sig.yao.turnFade', 0.27, 0.699, 0.54, 0.53, 0.28],
    ['yao', 'jumper', 'jabPullup', 'sig.yao.jabJumper', 0.20, 0.635, 0.54, 0.53, 0.15], ['yao', 'hook', 'upUnder', 'sig.yao.upUnder', 0.10, 0.52, 0.525, 0.40, 0.15],
    ['kyrie', 'stepback', 'branch', 'sig.kyrie.doubleBtlStepbackShot', 0, 0.47, 0.59, 0.26, 0.35], ['kyrie', 'layup', 'spin', 'sig.kyrie.spinFinish', 0.33, 0.77, 0.55, 0.53, 0.50],
    ['kyrie', 'layup', 'reverse', 'sig.kyrie.reverseLay', 0.20, 0.625, 0.53, 0.37, 0.55], ['kyrie', 'floater', '', 'sig.kyrie.floater', 0, 0.35, 0.44, 0.17, 0.40],
    ['kyrie', 'jumper', 'btbPullup', 'sig.kyrie.btbPullup', 0.24, 0.676, 0.54, 0.45, 0.40],
  ];
  for (const [p, k, v, id, mf, ti, mt, to, h] of SIG) {
    const r = getTiming(p, k, v);
    ok(r.clipId === id, `${p} ${k}/${v} → ${id} (${r.clipId})`);
    near(r.meterFrom, mf, 1e-9, `${id} meterFrom`); near(r.tIdeal, ti, 0.0011, `${id} tIdeal`); near(r.METER_T, mt, 0.006, `${id} METER_T`);
    near(r.takeoffT, to, 1e-9, `${id} takeoff`); near(r.h, h, 1e-9, `${id} h`);
  }
  // dunks §4.9.4 / §4.12 / C10 / C11
  const DK = { kobe: [0.73, 0.79, 0.36, 0.37], jordan: [0.74, 0.80, 0.36, 0.37], lebron: [0.67, 0.73, 0.34, 0.36], giannis: [0.58, 0.64, 0.31, 0.33], yao: [0.42, 0.48, 0.26, 0.28], kyrie: [0.87, 0.93, 0.39, 0.41] };
  for (const p of PLAYER_IDS) {
    const one = getTiming(p, 'dunk', 'tomahawk1'), two = getTiming(p, 'dunk', 'power2');
    const k = p === 'jordan' ? 1 / Math.sqrt(0.8) : 1;
    near(one.h, DK[p][0], 1e-9, `${p} h one-hand`); near(two.h, DK[p][1], 1e-9, `${p} h two-hand`);
    near(one.slamAfterTO, DK[p][2] * k, 1e-9, `${p} slam one`); near(two.slamAfterTO, DK[p][3] * k, 1e-9, `${p} slam two`);
    // slam ≈ apex − 0.03 (ascending) within the table's rounding
    near(one.slamAfterTO, th(one.h, one.gScale) - 0.03, 0.012, `${p} one-hand slam at apex − 0.03`);
    ok(one.meter === false && one.gatherWindow[0] === 0.6 && one.gatherWindow[1] === 4.0, `${p} generic dunk window [0.6, 4.0]`);
  }
  const ft = getTiming('jordan', 'dunk', 'ftLine');
  ok(ft.clipId === 'sig.jordan.ftDunk' && ft.gatherWindow[0] === 6.0 && ft.gatherWindow[1] === 7.6 && ft.gScale === 0.70 && ft.h === 1.00, 'C10 FT-line dunk');
  near(ft.slamT, 0.48 + 0.704, 1e-9, 'FT-line slam at takeoff + 0.704'); near(ft.airT, 1.08, 0.005, 'FT-line airtime 1.08');
  const eu = getTiming('giannis', 'dunk', 'euro'), lg = getTiming('giannis', 'dunk', 'longGather');
  ok(eu.gatherWindow[0] === 5.4 && eu.gatherWindow[1] === 7.6 && lg.gatherWindow[0] === 6.4 && lg.gatherWindow[1] === 7.8, 'C11 Giannis windows');
  near(eu.slamT, 1.31, 1e-9, 'euroDunk slam 1.31'); near(eu.landT, 1.91, 0.005, 'euroDunk land 1.91'); near(lg.slamT, 1.067, 1e-9, 'longGather slam 1.067'); near(lg.landT, 1.75, 0.005, 'longGather land 1.75');
  const geu = getTiming('kobe', 'layup', 'euro');
  ok(geu.clipId === 'lay.euro' && geu.gatherWindow[0] === 3.0 && geu.gatherWindow[1] === 5.2, 'C11 generic lay.euro window');
  // tips use hJump (C8)
  for (const p of PLAYER_IDS) near(getTiming(p, 'tip', '').h, HJUMP[p], 1e-9, `${p} tip h = hJump`);
  ok(getTiming('lebron', 'tip', 'dunk').clipId === 'put.dunk' && getTiming('kyrie', 'tip', 'dunk').clipId === 'put.tip', 'put.dunk only for LeBron/Giannis/Yao');
  // selectClip mappings (§4.13)
  const S = (p, r, c) => { const s = selectClip(p, r, c); return { id: s.clipId, mirror: s.mirror, idx: s.clipIdx, timing: s.timing, target: s.target && { ...s.target }, warp: s.warp }; };
  ok(S('kobe', { kind: 'jumper', variant: 'set' }, {}).id === 'shot.mid', 'set → shot.mid');
  ok(S('kyrie', { kind: 'jumper', variant: 'pull12' }, { speed: 3 }).id === 'shot.pullHop', 'Kyrie pull-ups hop');
  ok(S('kobe', { kind: 'jumper', variant: 'pullHop' }, { speed: 3 }).id === 'shot.pull12', 'Kobe 1-2 stop at speed 3');
  ok(S('kobe', { kind: 'jumper', variant: 'pull12' }, { speed: 4.5 }).id === 'shot.pullHop', 'speed > 4 hops');
  ok(S('kobe', { kind: 'jumper', variant: 'pull12' }, { lastMove: { id: 'sig.kobe.pump', age: 0.3 } }).id === 'sig.kobe.sideStepPullup', 'Kobe after pump');
  ok(S('kyrie', { kind: 'jumper', variant: 'pull12' }, { lastMove: { id: 'move.btb', age: 0.2 } }).id === 'sig.kyrie.btbPullup', 'Kyrie after btb');
  ok(S('jordan', { kind: 'jumper', variant: 'pull12' }, {}).id === 'sig.jordan.pullup', 'Jordan pull-up');
  ok(S('yao', { kind: 'jumper', variant: 'jabPullup' }, {}).id === 'sig.yao.jabJumper', 'Yao jab jumper');
  ok(S('kobe', { kind: 'fade', variant: '' }, { baseline: true }).id === 'sig.kobe.baselineSpinFade', 'Kobe baseline fade');
  ok(S('kyrie', { kind: 'stepback' }, { lastMove: { id: 'sig.kyrie.doubleBtlStepback', age: 0.1 } }).id === 'sig.kyrie.doubleBtlStepbackShot', 'Kyrie branch');
  ok(S('kyrie', { kind: 'stepback' }, {}).id === 'shot.stepbackJ', 'Kyrie generic stepback');
  ok(S('lebron', { kind: 'stepback' }, {}).id === 'sig.lebron.stepback3', 'LeBron stepback3');
  const lbl = S('lebron', { kind: 'turnFade', side: 'L' }, {}), lbr = S('lebron', { kind: 'turnFade', side: 'R' }, {});
  ok(lbl.id === 'sig.lebron.leftBlockFade' && !lbl.mirror && lbr.id === 'shot.turnFade' && lbr.mirror, 'LeBron left block signature, right block generic mirrored');
  const kr = S('kobe', { kind: 'turnFade', side: 'R' }, {}), kl = S('kobe', { kind: 'turnFade', side: 'L' }, {});
  ok(kr.id === 'sig.kobe.turnFade' && !kr.mirror && kl.mirror, 'Kobe right block base, left block mirrored');
  ok(S('yao', { kind: 'hook', side: 'L' }, {}).id === 'sig.yao.hook' && !S('yao', { kind: 'hook', side: 'L' }, {}).mirror, 'Yao hook from the left block');
  ok(S('yao', { kind: 'hook' }, { lastMove: { id: 'sig.yao.pumpHook', age: 0.4 } }).id === 'sig.yao.upUnder', 'Yao up-and-under after the pump hook');
  ok(S('giannis', { kind: 'hook' }, {}).id === 'shot.hook' && S('kobe', { kind: 'floater' }, {}).id === 'shot.floaterGeneric', 'generic hook / floater');
  ok(S('kyrie', { kind: 'floater', variant: 'scoop' }, {}).id === 'sig.kyrie.scoop', 'Kyrie scoop');
  ok(S('kobe', { kind: 'layup', variant: 'std' }, { d: 2.0 }).id === 'lay.std1' && S('kobe', { kind: 'layup', variant: 'std' }, { d: 3.2 }).id === 'lay.std2', 'std1 / std2 by distance');
  ok(S('kyrie', { kind: 'layup', variant: 'reverse' }, {}).id === 'sig.kyrie.reverseLay' && S('kobe', { kind: 'layup', variant: 'reverse' }, {}).id === 'lay.reverse', 'reverse layups');
  ok(S('jordan', { kind: 'layup', variant: 'switch' }, {}).id === 'sig.jordan.theMove' && S('kobe', { kind: 'layup', variant: 'switch' }, {}).id === 'lay.std2', 'switch is Jordan only');
  ok(S('giannis', { kind: 'layup', variant: 'euro' }, { d: 6.0 }).id === 'sig.giannis.euroLay' && S('giannis', { kind: 'layup', variant: 'euro' }, { d: 4.5 }).id === 'lay.euro', 'Giannis euro by distance');
  ok(S('kobe', { kind: 'layup', variant: 'std', side: 'L' }, { d: 3 }).mirror, 'left-hand layup mirrors');
  ok(S('giannis', { kind: 'dunk', clipHint: 'sig.giannis.longGather' }, {}).id === 'sig.giannis.longGather', 'clipHint selects a signature clip');
  ok(S('yao', { kind: 'dunk', variant: 'dropStep' }, {}).id === 'sig.yao.dropStep', 'Yao drop step');
  ok(S('kyrie', { kind: 'dunk' }, {}).id === 'dunk.simple1', 'Kyrie simple dunk');
  // targets: takeoff spot on the approach line at dTO from the rim, facing the rim
  const lay = S('kobe', { kind: 'layup', variant: 'std' }, { x: 0, z: -9.5, d: 3.25 });
  ok(!!lay.target && Math.abs(lay.target.x) < 1e-9, 'layup target on the approach line');
  near(Math.hypot(lay.target.x - 0, lay.target.z + 12.75), lay.timing.dTO, 1e-9, 'layup target at dTO');
  near(lay.timing.dTO, Math.min(2, Math.max(1, 2.6 * 2 * th(0.60) * 0.75)), 1e-9, 'dTO formula');
  near(Math.abs(lay.target.yaw), Math.PI, 1e-9, 'target faces the rim (−z)');
  ok(S('kobe', { kind: 'jumper', variant: 'set' }, { x: 0, z: -6 }).target === null, 'jumpers have no target');
  const w = S('kobe', { kind: 'jumper', variant: 'set' }, {}).warp;
  near(w[EV.TAKEOFF], 0.17, 1e-9, 'warp takeoff'); near(w[EV.SET], getTiming('kobe', 'jumper', 'set').setT, 1e-9, 'warp set');
  // selectMove (§4.8 table)
  const M = (p, st, c) => { const m = selectMove(p, st, c); return [m.moveId, m.mirror]; };
  ok(M('kobe', { lat: 0, fwd: -0.8 }, { holding: true })[0] === 'move.pumpFake', 'holding + back → pump fake');
  ok(M('kobe', { lat: 0, fwd: 0 }, { holding: true })[0] === 'sig.kobe.jabSeries' && M('jordan', { lat: 0, fwd: 0 }, { holding: true })[0] === 'sig.jordan.jab' && M('lebron', { lat: 0, fwd: 0 }, { holding: true })[0] === 'move.jab', 'jabs');
  ok(M('yao', { lat: 0.8, fwd: 0 }, { post: true })[0] === 'sig.yao.dropStep' && M('yao', { lat: 0.8, fwd: 0 }, {})[0] === 'move.pumpFake', 'Yao has no dribble moves');
  ok(M('kyrie', { lat: 0.8, fwd: -0.8 }, { dribbleHand: 'R' })[0] === 'sig.kyrie.doubleBtlStepback' && M('kobe', { lat: 0, fwd: -0.8 }, {})[0] === 'move.stepback', 'stepbacks');
  ok(M('kyrie', { lat: 0.8, fwd: 0 }, { speed: 4, dribbleHand: 'R' })[0] === 'sig.kyrie.hesiCross' && M('kobe', { lat: 0.8, fwd: 0 }, { speed: 4 })[0] === 'sig.kobe.hesiCrossStepback' && M('giannis', { lat: 0.8, fwd: 0 }, { speed: 4 })[0] === 'move.cross', 'fast crossovers');
  const hist = {};
  const rng = testRng(42);
  for (let i = 0; i < 4000; i++) { const id = selectMove('kyrie', { lat: 0.8, fwd: 0 }, { speed: 2, dribbleHand: 'R', rng }).moveId; hist[id] = (hist[id] || 0) + 1; }
  near(hist['move.cross'] / 4000, 0.35, 0.03, 'Kyrie cross weight'); near(hist['sig.kyrie.hesiCross'] / 4000, 0.15, 0.03, 'Kyrie hesiCross weight');
  ok(M('kobe', { lat: -0.8, fwd: 0 }, { speed: 2, dribbleHand: 'R', defFront: 1.0 })[0] === 'move.spin', 'spin toward the dribble hand with a defender in front');
  ok(M('kobe', { lat: 0.8, fwd: 0 }, { speed: 2, dribbleHand: 'L', defFront: 1.0 })[0] === 'move.spin' && M('kobe', { lat: 0.8, fwd: 0 }, { speed: 2, dribbleHand: 'L', defFront: 1.0 })[1], 'left-hand spin mirrors');
  ok(M('lebron', { lat: 0, fwd: 0.5 }, { speed: 3 })[0] === 'move.hesi' && M('kobe', { lat: 0, fwd: 0 }, { speed: 1 })[0] === 'move.btl' && M('lebron', { lat: 0, fwd: 0 }, { speed: 1 })[0] === 'move.cross', 'defaults');
  // selectPass (C6)
  for (const p of PLAYER_IDS) near(selectPass(p, { dist: 5 }).releaseT, PASS_RELEASE[p], 1e-9, `${p} chest pass = passRelease`);
  near(selectPass('kobe', { dist: 5, lob: true }).releaseT, 0.158 + 0.06, 1e-9, 'lob +0.06');
  near(selectPass('kobe', { dist: 5, bounce: true }).releaseT, 0.158 + 0.02, 1e-9, 'bounce +0.02');
  near(selectPass('kobe', { dist: 5, post: true }).releaseT, 0.158 + 0.08, 1e-9, 'overhead +0.08');
  ok(selectPass('lebron', { dist: 9 }).passId === 'sig.lebron.skipPass' && selectPass('lebron', { dist: 9 }).releaseT === 0.10 && selectPass('lebron', { dist: 9 }).noLook, 'LeBron skip pass 0.10 no-look');
  ok(selectPass('yao', { dist: 5, doubled: true }).releaseT === 0.25 && selectPass('yao', { dist: 5, doubled: true, chinned: true }).releaseT === 0.20, 'Yao overhead 0.25 / 0.20');
  ok(selectPass('kobe', { dist: 5, fromDribble: true, speed: 4, inHand: true }).releaseT === 0.08, 'push pass 0.08 in hand');
  ok(selectPass('kobe', { dist: 5, fromDribble: true, pickup: 0.10 }).releaseT === 0.258, 'standing pass from the dribble adds the pickup');
  ok(selectPass('kobe', { dist: 5, angle: 2.0 }).turn > 0 && selectPass('kobe', { dist: 5, angle: 2.0 }).turn <= 0.12, 'pass.turn ≤ 0.12 s');
  ok(selectPass('kobe', { dist: 5 }).warp[EV.RELEASE] === 0.158, 'pass warp');
  // selectDefJump (§4.10, C8)
  ok(selectDefJump('lebron', { intent: 'block', chase: true }).clipId === 'sig.lebron.chasedown' && selectDefJump('lebron', { intent: 'block', chase: true }).h === 0.85, 'LeBron chase-down h 0.85');
  ok(selectDefJump('giannis', { intent: 'block', help: true }).h === 0.785 && selectDefJump('yao', { intent: 'block' }).takeoffT === 0.13, 'Giannis help block / Yao block load');
  ok(selectDefJump('kobe', { intent: 'block' }).h === HJUMP.kobe && selectDefJump('kobe', { intent: 'block', hJump: 0.7 }).h === 0.7, 'generic block uses hJump');
  ok(selectDefJump('kyrie', { intent: 'contest', arm: 'L' }).mirror && selectDefJump('yao', { intent: 'contest' }).clipId === 'sig.yao.vertical' && selectDefJump('jordan', { intent: 'handUp' }).layer === 'upper', 'contest / verticality / hands up');
  ok(selectDefJump('yao', { intent: 'rebound' }).takeoffT === 0.10 && selectDefJump('kobe', { intent: 'rebound' }).takeoffT === 0.12, 'rebound takeoffs');
  // selectCelebration / selectIdleHabit (cosmetic RNG)
  const always = { next: () => 0 };
  ok(selectCelebration('kobe', { cls: 'dunk', rng: always }).celId === 'cel.kobe.jawJut', 'Kobe dunk celebration');
  ok(selectCelebration('jordan', { cls: 'clutch', rng: always, gameWinner: true, jumper: true }).celId === 'cel.jordan.lastShot', 'Last Shot');
  ok(selectCelebration('kyrie', { cls: 'three', rng: always, streak: 3 }).celId === 'cel.kyrie.bow', 'Kyrie bow after 3 straight');
  ok(selectCelebration('giannis', { cls: 'clutch', rng: always }).chainIdx === clipIndex('cel.giannis.chestThump'), 'Giannis clutch chains the chest thump');
  const face = selectCelebration('jordan', { cls: 'normal', rng: always });
  ok(face.clipIdx === -1 && face.face === 'smirk' && face.faceW === 0.5, 'face-only reaction');
  ok(!selectCelebration('kobe', { cls: 'normal', rng: { next: () => 0.9 } }).celebrate, 'normal makes rarely celebrate');
  ok(selectCelebration('yao', { blocker: true }).celId === 'cel.block.yaoPoint', 'Yao block: point to a teammate');
  ok(selectIdleHabit('kobe', { rng: always, onBallDef: true, check: true, timeLeft: 3 }).habitId === 'idle.kobe.floorSlap', 'Kobe floor slap');
  ok(selectIdleHabit('kyrie', { rng: always, hasBall: true, timeLeft: 3 }).habitId === 'idle.kyrie.ballWrap', 'Kyrie ball wrap');
  ok(selectIdleHabit('yao', { rng: always, check: true, timeLeft: 0.8 }).clipIdx === -1, 'CHECK habits need ≥ 1.0 s');
  ok(selectIdleHabit('lebron', { rng: { next: () => 0.99 }, timeLeft: 0.7 }).habitId === 'idle.lebron.headband', 'habits must fit the time left');
  // catalog: every selectable id resolves to a timing clip for every player; structural checks
  ok(prepareTiming(PLAYER_IDS) === CLIP_IDS.length * 12, 'prepareTiming builds every clip × player × side');
  const NEED = ['sig.kobe.turnFade', 'sig.kobe.jabSeries', 'sig.kobe.ripPullup', 'sig.kobe.jabGo', 'sig.kobe.pump', 'sig.kobe.sideStepPullup', 'sig.kobe.baselineSpinLay', 'sig.kobe.baselineSpinFade', 'sig.kobe.tomahawk', 'sig.kobe.reverse2', 'sig.kobe.hesiCrossStepback', 'sig.jordan.turnFade', 'sig.jordan.ftDunk', 'sig.jordan.theMove', 'sig.jordan.cradle', 'sig.jordan.jab', 'sig.jordan.jabShot', 'sig.jordan.ripDrive', 'sig.jordan.pullup', 'sig.jordan.steal', 'sig.lebron.chasedown', 'sig.lebron.tomahawk', 'sig.lebron.jumpStopDunk', 'sig.lebron.powerDrive', 'sig.lebron.skipPass', 'sig.lebron.skipOverhead', 'sig.lebron.leftBlockFade', 'sig.lebron.stepback3', 'sig.giannis.euroDunk', 'sig.giannis.euroLay', 'sig.giannis.longGather', 'sig.giannis.spinGather', 'sig.giannis.helpBlock', 'sig.giannis.elbowDrive', 'sig.yao.hook', 'sig.yao.turnFade', 'sig.yao.jabJumper', 'sig.yao.dropStep', 'sig.yao.dropStepLay', 'sig.yao.vertical', 'sig.yao.block', 'sig.yao.pumpHook', 'sig.yao.upUnder', 'sig.yao.overheadPass', 'sig.yao.rebound', 'sig.kyrie.hesiCross', 'sig.kyrie.doubleBtlStepback', 'sig.kyrie.spinFinish', 'sig.kyrie.reverseLay', 'sig.kyrie.floater', 'sig.kyrie.scoop', 'sig.kyrie.btbPullup',
    'move.cross', 'move.btl', 'move.btb', 'move.hesi', 'move.spin', 'move.stepback', 'move.jab', 'move.pumpFake', 'move.rip', 'move.protect', 'move.backdown', 'move.gather', 'post.faceUp',
    'shot.mid', 'shot.three', 'shot.pull12', 'shot.pullHop', 'shot.fade', 'shot.stepbackJ', 'shot.turnFade', 'shot.hook', 'shot.floaterGeneric', 'lay.std2', 'lay.std1', 'lay.fingerRoll', 'lay.reverse', 'lay.euro', 'lay.power', 'lay.upUnder', 'dunk.power2', 'dunk.tomahawk1', 'dunk.simple1', 'put.tip', 'put.dunk',
    'def.closeout', 'def.contest1', 'def.handUp', 'def.vertical', 'def.block1', 'def.steal', 'def.stealMiss', 'def.boxout', 'reb.jump2', 'def.stumble', 'def.ankleFall', 'def.bumped', 'loose.scoop',
    'pass.chest', 'pass.bounce', 'pass.lob', 'pass.overhead', 'pass.push1', 'catch.ready', 'catch.chest', 'catch.high', 'catch.low', 'catch.run', 'cel.lebron.chalk', 'cel.highFive'];
  for (const id of NEED) ok(CLIP_IDS.includes(id), `catalog has ${id}`);
  for (const p of PLAYER_IDS) {
    for (const id of CLIP_IDS) {
      const c = timingClip(clipIndex(id), p, false);
      if (!ok(!!c, `timing clip ${p}/${id}`)) continue;
      const tm = clipTiming(c);
      const evOk = tm.events.every((e, i, a) => e.t >= 0 && e.t <= tm.dur + 1e-9 && (i === 0 || a[i - 1].t <= e.t));
      ok(evOk, `${p}/${id} events sorted in [0, dur]`);
      if (tm.hasJump || tm.takeoff >= 0) ok(tm.takeoff >= 0 && tm.land > tm.takeoff, `${p}/${id} takeoff < land`);
      const cat = catOf(clipIndex(id));
      if (cat === 'jumper' || cat === 'layup' || cat === 'pass') ok(tm.release >= 0, `${p}/${id} has RELEASE`);
      if (cat === 'dunk') ok(tm.slam > tm.takeoff, `${p}/${id} has SLAM after TAKEOFF`);
      if (cat === 'steal') ok(tm.swipe > 0, `${p}/${id} has SWIPE`);
    }
    // getTiming ↔ catalog clip agreement
    for (const kind of Object.keys(KINDS)) for (const v of KINDS[kind]) {
      const r = getTiming(p, kind, v);
      const c = timingClip(clipIndex(r.clipId), p, false);
      const tm = clipTiming(c);
      if (timingByClip(p, r.clipId) !== r) continue;     // shared record of another variant
      near(tm.takeoff, r.takeoffT, 1e-5, `${p}/${r.clipId} catalog takeoff`);
      near(tm.land, r.landT, 1e-5, `${p}/${r.clipId} catalog land`);
      if (r.releaseT >= 0) near(r.meter === false ? tm.slam >= 0 ? tm.slam : tm.release : tm.release, r.releaseT, 1e-5, `${p}/${r.clipId} catalog release/slam`);
    }
  }
}]);

GROUPS.push(['proxy', () => {
  const owner = { pos: { x: 0, z: -6 }, yaw: Math.PI, vel: { x: 0, z: 0 }, jumpY: 0 };
  // meter (spec §4.15 #5): perfect input launches at apex + rva ± 1 step, ball height ±0.08 m of §4.9.2
  for (const p of PLAYER_IDS) {
    for (const v of ['set', 'three', 'pull12']) {
      const a = new AnimProxy(p);
      a.setRoot(0, -6, Math.PI);
      const T = getTiming(p, 'jumper', v);
      const sel = selectClip(p, { kind: 'jumper', variant: v }, { speed: 2 });
      a.play(sel.clipIdx, { warp: sel.warp, mirror: sel.mirror });
      let rel = -1, relY = 0, to = -1, now = 0;
      const out = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < 90; i++) {
        if (now + 1e-9 >= T.tIdeal) a.releaseNow();
        a.step(DT);
        for (let e; (e = a.events.next());) {
          if (e.code === EV.TAKEOFF) { to = e.t; a.setJump(T.h, 2 * th(T.h)); }
          if (e.code === EV.RELEASE) { rel = e.t; a.querySocket(SOCK.ball, out); relY = out.y; }
        }
        now += DT;
      }
      near(to, T.takeoffT, 1e-6, `${p} ${v} proxy takeoff`);
      ok(Math.abs(rel - (T.takeoffT + th(T.h) + T.rva)) <= DT + 1e-6, `${p} ${v} launch at apex + rva ± 1 step (${rel.toFixed(3)})`);
      if (v === 'set') near(relY, FORMS[p].launchMid, 0.08, `${p} mid launch height`);
      ok(a.action === -1 || a.actionTime > T.landT - 0.2, `${p} ${v} clip ran on`);
    }
  }
  // owner-driven sockets: palm high only in defensive jump clips
  const a = new AnimProxy('yao', PROXY_METRICS.yao, { owner });
  const v3 = { x: 0, y: 0, z: 0 };
  a.querySocket(SOCK.palm_r, v3);
  near(v3.y, 1.05 * PROXY_METRICS.yao.sLeg, 1e-9, 'resting palm 1.05·sLeg');
  near(v3.z, -6.30, 1e-9, 'palm 0.30 in front (facing −z)');
  const dj = selectDefJump('yao', { intent: 'block' });
  a.play(dj.clipIdx, { mirror: dj.mirror });
  owner.jumpY = 0.3;
  a.querySocket(SOCK.palm_r, v3);
  near(v3.y, 2.95 - 0.24 + 0.3, 1e-9, 'blocking palm = reachM − 0.24 + jumpY');
  owner.jumpY = 0;
  // events: block timing, LAND from setJump, SWIPE per player
  let evs = [];
  for (let i = 0; i < 80; i++) { a.step(DT); for (let e; (e = a.events.next());) { evs.push([e.code, e.t]); if (e.code === EV.TAKEOFF) a.setJump(0.44, 2 * th(0.44)); } }
  near(evs.find((e) => e[0] === EV.TAKEOFF)[1], 0.13, 1e-6, 'Yao block load 0.13');
  near(evs.find((e) => e[0] === EV.LAND)[1], 0.13 + 2 * th(0.44), 1e-6, 'LAND = takeoff + airtime');
  for (const [p, sw] of [['kyrie', 0.10], ['kobe', 0.12], ['lebron', 0.14], ['yao', 0.14]]) {
    const s = new AnimProxy(p, PROXY_METRICS[p], { owner });
    s.play(clipIndex('def.steal'));
    let t = -1;
    for (let i = 0; i < 30; i++) { s.step(DT); for (let e; (e = s.events.next());) if (e.code === EV.SWIPE) t = e.t; }
    near(t, sw * STYLE[p].tempo, 1e-6, `${p} swipe time (× tempo)`);
  }
  // onCatch → CATCH now, READY +0.30; ball modes
  const c = new AnimProxy('kobe', PROXY_METRICS.kobe, { owner });
  c.step(DT);
  c.onCatch('held');
  ok(c.ballMode === BM.BOTH, 'catch holds with both hands');
  evs = [];
  for (let i = 0; i < 30; i++) { c.step(DT); for (let e; (e = c.events.next());) evs.push([e.code, e.t]); }
  const catchT = evs.find((e) => e[0] === EV.CATCH)[1], readyT = evs.find((e) => e[0] === EV.READY)[1];
  near(readyT - catchT, 0.30, 1e-9, 'READY 0.30 after CATCH');
  c.play(clipIndex('pass.chest'), { warp: selectPass('kobe', { dist: 5 }).warp });
  let relT = -1; const t0 = c.time;
  for (let i = 0; i < 30; i++) { c.step(DT); for (let e; (e = c.events.next());) if (e.code === EV.RELEASE) relT = e.t - t0; }
  near(relT, 0.158, 1e-6, 'pass RELEASE warped to passRelease');
  ok(c.ballMode === BM.FREE, 'ball free after release');
  c.setBallMode('dribble', 'L');
  c.querySocket(SOCK.ball, v3);
  ok(c.ballMode === BM.DRIB && c.ballHand === HAND.L && v3.x < -0.2, 'left-hand dribble socket on the character’s left (−x when facing −z)');
  // dunk: ball at SLAM ≥ 3.20 for every player's generic dunks (spec §4.15 #6, closed form)
  for (const p of PLAYER_IDS) {
    for (const v of ['power2', 'tomahawk1', 'simple1', '']) {
      const D = getTiming(p, 'dunk', v);
      const d = new AnimProxy(p);
      d.setRoot(0, -10, Math.PI);
      d.play(clipIndex(D.clipId));
      let slamY = -1;
      for (let i = 0; i < 150; i++) {
        d.step(DT);
        for (let e; (e = d.events.next());) {
          if (e.code === EV.TAKEOFF) d.setJump(D.h, D.airT, D.profile);
          if (e.code === EV.SLAM) { d.querySocket(SOCK.ball, v3); slamY = v3.y; }
        }
      }
      ok(slamY >= 3.20, `${p} ${D.clipId} ball at SLAM ${slamY.toFixed(3)} ≥ 3.20`);
    }
  }
}]);

GROUPS.push(['motion', () => {
  // root motion: move.cross (replace) displacement = R end × sLeg rotated by the start yaw
  const cross = compileClip(EXAMPLE_CROSS);
  for (const [p, yaw] of [['kobe', 0], ['yao', Math.PI / 2], ['kyrie', -2.0]]) {
    const rm = new RootMotion(), clock = new ClipClock();
    clock.start(cross, 1, 1, null);
    rm.begin(cross, PROXY_METRICS[p].sLeg, 0, 0, yaw, 0, 0, null);
    let x = 0, z = 0, g = 0;
    while (clock.active) {
      const t0 = clock.t; clock.step(DT, g, null, 0, 0); g += DT;
      rm.step(t0, clock.t, DT, g, false);
      x += rm.vx * DT; z += rm.vz * DT;
    }
    const s = PROXY_METRICS[p].sLeg;
    near(x, (1.0 * Math.cos(yaw) + 0.6 * Math.sin(yaw)) * s, 1e-6, `${p} cross displacement x`);
    near(z, (-1.0 * Math.sin(yaw) + 0.6 * Math.cos(yaw)) * s, 1e-6, `${p} cross displacement z`);
    ok(rm.hasExit && Math.abs(Math.hypot(rm.exitVx, rm.exitVz) - Math.hypot(2.6, 3.0)) < 1e-9, `${p} exit velocity`);
  }
  // entry 'stop': a 5.2 m/s runner takes off at ≈ 2.1 m/s with 18 m/s² (spec §4.9.1)
  const T = getTiming('kobe', 'jumper', 'set');
  const sh = timingClip(clipIndex('shot.mid'), 'kobe', false);
  const rm = new RootMotion(), ck = new ClipClock();
  ck.start(sh, 1, 1, T.warp);
  rm.begin(sh, 1, 0, 0, 0, 0, 5.2, null);
  let g = 0, vTO = -1;
  while (ck.active && g < 1) {
    const t0 = ck.t; ck.step(DT, g, null, 0, 0); g += DT;
    rm.step(t0, ck.t, DT, g, ck.inAir(ck.t), ck.takeoffG);
    if (vTO < 0 && ck.t >= T.takeoffT) vTO = Math.hypot(rm.vx, rm.vz);
  }
  near(vTO, 5.2 - 18 * T.takeoffT, 1e-6, 'stop entry: speed at takeoff = vIn − 18·TO (Kobe 2.14)');
  // target matching moves the takeoff spot, within limits
  const L = getTiming('kobe', 'layup', 'std2');
  const lay = timingClip(clipIndex('lay.std2'), 'kobe', false);
  const sel = selectClip('kobe', { kind: 'layup', variant: 'std' }, { x: 0.3, z: -9.6, d: 3.16 });
  const rm2 = new RootMotion(), ck2 = new ClipClock();
  ck2.start(lay, 1, 1, sel.warp);
  const fits = rm2.begin(lay, PROXY_METRICS.kobe.sLeg, 0.3, -9.6, sel.target.yaw, 0, 0, sel.target);
  let x = 0.3, z = -9.6, tg = 0, at = null, yaw = sel.target.yaw;
  while (ck2.active && tg < 2) {
    const t0 = ck2.t; ck2.step(DT, tg, null, 0, 0); tg += DT;
    rm2.step(t0, ck2.t, DT, tg, ck2.inAir(ck2.t), ck2.takeoffG);
    x += rm2.vx * DT; z += rm2.vz * DT; yaw += rm2.dyaw;
    if (!at && ck2.t >= L.takeoffT - 1e-9) at = [x, z];
  }
  ok(fits, 'layup target fits');
  near(Math.hypot(at[0] - sel.target.x, at[1] - sel.target.z), 0, 0.03, 'target matched at takeoff');
  for (const [p, x0, z0] of [['yao', -0.4, -9.2], ['kyrie', 0.6, -9.0], ['giannis', 0, -6.0]]) {
    const v = p === 'giannis' ? 'sigEuro' : 'std';
    const sl = selectClip(p, { kind: 'layup', variant: v }, { x: x0, z: z0, d: Math.hypot(x0, z0 + 12.75) });
    const src = timingClip(sl.clipIdx, p, false), rec = sl.timing;
    const r3 = new RootMotion(), c3 = new ClipClock();
    c3.start(src, 1, 1, sl.warp);
    ok(r3.begin(src, PROXY_METRICS[p].sLeg, x0, z0, sl.target.yaw, 0, 0, sl.target), `${p} ${sl.clipId} target fits`);
    let px = x0, pz = z0, gg = 0, hit = null;
    while (c3.active && gg < 3) {
      const t0 = c3.t; c3.step(DT, gg, null, 0, 0); gg += DT;
      r3.step(t0, c3.t, DT, gg, c3.inAir(c3.t), c3.takeoffG);
      px += r3.vx * DT; pz += r3.vz * DT;
      if (!hit && c3.t >= rec.takeoffT - 1e-9) hit = [px, pz];
    }
    near(Math.hypot(hit[0] - sl.target.x, hit[1] - sl.target.z), 0, 0.03, `${p} ${sl.clipId} takeoff on target`);
  }
  const far = rm2.begin(lay, 1, 0, -6, Math.PI, 0, 0, { x: 0, z: -12.75 });
  ok(!far, 'unreachable target reported (clamped)');
  // proxy motion output
  const owner = { pos: { x: 0, z: 0 }, yaw: 0, vel: { x: 0, z: 0 }, jumpY: 0 };
  const a = new AnimProxy('kobe', PROXY_METRICS.kobe, { owner });
  a.play(clipIndex('move.spin'));
  let yawSum = 0, exit = false;
  for (let i = 0; i < 40; i++) { a.step(DT); yawSum += a.motion.dyaw; if (a.motion.exit) exit = true; }
  near(yawSum, 2 * Math.PI, 1e-6, 'spin turns the root 360°');
  ok(exit && a.action === -1, 'exit velocity reported when the move ends');
  // first-33-ms motion (spec §4.15 #7) for the authored example clips
  if (HDR) {
    for (const c of [cross, compileClip(exampleJumper('kobe', 'mid')), compileClip(exampleJumper('yao', 'three'))]) {
      const A = poseWorld(RIGS.kobe, c, 0), B = poseWorld(RIGS.kobe, c, 2 * DT);
      let hand = 0, joint = 0;
      for (const b of [BONE.hand_r, BONE.hand_l]) hand = Math.max(hand, Math.hypot(A.fk.pos[b * 3] - B.fk.pos[b * 3], A.fk.pos[b * 3 + 1] - B.fk.pos[b * 3 + 1], A.fk.pos[b * 3 + 2] - B.fk.pos[b * 3 + 2]));
      for (const b of [BONE.pelvis, BONE.spine_02, BONE.upperarm_r, BONE.lowerarm_r, BONE.thigh_r, BONE.calf_r, BONE.thigh_l, BONE.calf_l]) joint = Math.max(joint, quatAngleDeg(A.pose.q, b * 4, B.pose.q, b * 4));
      ok(hand >= 0.02 || joint >= 3, `${c.id}: visible motion in the first 33 ms (hand ${(hand * 100).toFixed(1)} cm, joint ${joint.toFixed(1)}°)`);
    }
    // FK of the FORMS release pose on the real rig at apex + rva (arms REL/GUIDE, head N, trunk extended, shrug):
    // reported against the §4.9.2 table; the example generator's landing-crouch keys are reported separately
    for (const p of PLAYER_IDS) {
      const rig = RIGS[p];
      if (!rig) continue;
      const F = FORMS[p];
      const pure = compileClip(defineClip({ id: 'test.release.' + p, dur: 1, keys: [[0, { N: F.head, RA: REL(p), LA: GUIDE(p) }], [1, {}]] }));
      const jy = F.h.mid - 0.5 * G * F.rva * F.rva;
      const { fk } = poseWorld(rig, pure, 0.5);
      const y = socketWorld(rig, fk, SOCK.ball1_r)[1] + jy;
      ok(Math.abs(y - F.launchMid) <= 0.11, `${p} real-rig release-pose launch ${y.toFixed(3)} vs table ${F.launchMid} (±0.11)`);
      if (Math.abs(y - F.launchMid) > 0.08) log.push(`  note: ${p} real-rig release-pose launch ${y.toFixed(3)} m is ${(y - F.launchMid).toFixed(3)} from the §4.9.2 table`);
      const c = compileClip(exampleJumper(p, 'mid'));
      const tm = clipTiming(c);
      const e = poseWorld(rig, c, tm.release, SAMPLE_AIR_LINEAR);
      const ye = socketWorld(rig, e.fk, SOCK.ball1_r)[1] + jy;
      log.push(`  note: ${p} example jumper (AIR_LINEAR pelvis) launch ${ye.toFixed(3)} m (${(ye - F.launchMid).toFixed(3)} vs table)`);
    }
  }
}]);

GROUPS.push(['alloc', () => {
  if (typeof globalThis.gc !== 'function') {
    const r = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--group=alloc'], { encoding: 'utf8' });
    process.stdout.write(r.stdout.split('\n').filter((l) => /alloc|heap|FAIL/.test(l)).map((l) => '  [child] ' + l.trim()).join('\n') + '\n');
    ok(r.status === 0, 'zero-allocation probe (child with --expose-gc)');
    return;
  }
  // six proxies × 600 steps cycling through every clip family + sampling / blending compiled clips
  prepareTiming(PLAYER_IDS);
  const owners = PLAYER_IDS.map((p, i) => ({ pos: { x: i - 3, z: -6 }, yaw: Math.PI, vel: { x: 0, z: 1 }, jumpY: 0 }));
  const proxies = PLAYER_IDS.map((p, i) => new AnimProxy(p, PROXY_METRICS[p], { owner: owners[i] }));
  const cross = compileClip(EXAMPLE_CROSS), jump = compileClip(exampleJumper('kobe', 'fade'));
  const pa = new Pose(), pb = new Pose(), po = new Pose();
  const out = { x: 0, y: 0, z: 0 };
  const rng = testRng(9);
  const fam = [
    (p) => { const s = selectClip(p, KIND_SET, CTX); return [s.clipIdx, s.warp, s.mirror, 1]; },
    (p) => { const s = selectClip(p, KIND_LAY, CTX); return [s.clipIdx, s.warp, s.mirror, 1]; },
    (p) => { const s = selectClip(p, KIND_DUNK, CTX); return [s.clipIdx, s.warp, s.mirror, 2]; },
    (p) => { const m = selectMove(p, STICK, { speed: 2, dribbleHand: 'R', rng }); return [m.clipIdx, null, m.mirror, 0]; },
    (p) => { const s = selectPass(p, PASS_CTX); return [s.clipIdx, s.warp, s.mirror, 0]; },
    (p) => { const s = selectDefJump(p, DEF_CTX); return [s.clipIdx, null, s.mirror, 3]; },
  ];
  const run = (steps) => {
    for (let i = 0; i < steps; i++) {
      for (let k = 0; k < 6; k++) {
        const a = proxies[k], p = PLAYER_IDS[k];
        if (i % 60 === 0) {
          const f = fam[(i / 60 + k) % fam.length](p);
          PLAY.mirror = f[2]; PLAY.warp = f[1];
          a.play(f[0], PLAY);
          a.jumpKind = f[3];
        }
        if (i % 60 === 25) a.releaseNow();
        a.step(DT);
        for (let e; (e = a.events.next());) {
          if (e.code === EV.TAKEOFF) a.setJump(0.5, 0.64, a.jumpKind === 2 ? PROFILE : null);
        }
        a.querySocket(SOCK.ball, out); a.querySocket(SOCK.palm_r, out);
        owners[k].pos.x += a.motion.vx * DT; owners[k].pos.z += a.motion.vz * DT;
        if (a.motion.active) owners[k].yaw += a.motion.dyaw;
        getTiming(p, 'jumper', 'three');
      }
      sampleClip(cross, (i % 24) / 60, pa);
      sampleClip(jump, (i % 70) / 60, pb, SAMPLE_AIR_LINEAR);
      blendPose(po, pa, pb, 0.5, MASK_W[MASK.upper]);
      addPose(po, pa, 0.3);
    }
  };
  // warm-up long enough for V8 tier-up (optimised code and feedback vectors live on the heap too)
  const WARM = Number(process.env.WARM || 2400), MEASURE = Number(process.env.MEASURE || 1200);
  run(WARM);
  // a real per-step allocation grows the heap in every window; GC / JIT noise does not: take the smallest of three
  let growth = Infinity;
  for (let w = 0; w < 3; w++) {
    globalThis.gc(); globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    run(MEASURE);
    globalThis.gc(); globalThis.gc();
    growth = Math.min(growth, process.memoryUsage().heapUsed - before);
  }
  console.log(`alloc probe: heap growth ${(growth / 1024).toFixed(1)} KB over ${MEASURE} steps × 6 proxies + ${MEASURE} samples/blends (min of 3 windows)`);
  ok(growth < 64 * 1024, `heap growth ${growth} B < 64 KB`);
  // timing probe (reported only; budget asserted on desktop CI by the animator's own probe)
  const t0 = process.hrtime.bigint();
  run(600);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`alloc probe: 600 frames of six proxies + samples/blends: ${(ms / 600).toFixed(4)} ms per frame`);
}]);
const KIND_SET = { kind: 'jumper', variant: 'set' }, KIND_LAY = { kind: 'layup', variant: 'std' }, KIND_DUNK = { kind: 'dunk', variant: '' };
const CTX = { x: 0, z: -9.5, d: 3.25, speed: 3 }, STICK = { lat: 0.8, fwd: 0 }, PASS_CTX = { dist: 6 }, DEF_CTX = { intent: 'contest' };
const PLAY = { mirror: false, warp: null }, PROFILE = { slam: 0.3, hang: 0.1 };

// ------------------------------------------------------------------------------------------------ runner
const argGroup = (process.argv.find((a) => a.startsWith('--group=')) || '').slice(8);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  for (const [name, fn] of GROUPS) {
    if (argGroup && name !== argGroup) continue;
    const f0 = failures, p0 = passes;
    try { fn(); } catch (e) { failures++; log.push(`  FAIL ${name} threw: ${e.stack}`); }
    console.log(`${failures === f0 ? 'ok  ' : 'FAIL'} ${name.padEnd(8)} ${passes - p0} passed, ${failures - f0} failed`);
    for (const l of log.splice(0)) console.log(l);
  }
  console.log(`unit-anim: ${passes} passed, ${failures} failed${HEADERS.length ? ' (headers: ' + HEADERS.map((h) => h[0]).join(', ') + ')' : ''}`);
  process.exit(failures ? 1 : 0);
}
