// Unit checks for src/humanoid.js (spec section 6 / 6.1). three.js core runs in Node; scene.js's
// makeBlobTexture falls back to an inert canvas without a DOM.
// Run: node test/unit-humanoid.mjs
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { buildSharedGeometry, getTeamMaterials, createHumanoid, createMarker } from '../src/humanoid.js';
import { TEAMS } from '../src/teams.js';
import { COLORS } from '../src/constants.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

const PART_NAMES = ['shorts', 'torso', 'head', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR', 'legL', 'legR', 'shoeL', 'shoeR'];
const POSES = ['idle', 'run', 'move', 'dribble', 'cross', 'windup', 'shoot', 'release', 'layup', 'dunk', 'defend', 'jump', 'block', 'steal', 'stunned', 'celebrate', 'unknown-pose'];

function assertFinite(h, label) {
  for (const name of PART_NAMES) {
    const m = h.parts[name];
    for (const k of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(m.rotation[k]), label + ': ' + name + '.rotation.' + k);
      assert.ok(Number.isFinite(m.position[k]), label + ': ' + name + '.position.' + k);
    }
  }
  assert.ok(Number.isFinite(h.pelvis.position.y), label + ': pelvis y');
  for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(h.shadow.scale[k]), label + ': shadow scale ' + k);
}

const V = new THREE.Vector3();

check('shared geometry is built once and covers every part', () => {
  const g1 = buildSharedGeometry(), g2 = buildSharedGeometry();
  assert.equal(g1, g2);
  for (const k of ['shorts', 'torso', 'head', 'upperArm', 'forearm', 'leg', 'shoe', 'shadow', 'cone', 'ring']) {
    assert.ok(g1[k] instanceof THREE.BufferGeometry, k);
  }
  const shorts = g1.shorts.boundingBox || (g1.shorts.computeBoundingBox(), g1.shorts.boundingBox);
  assert.ok(Math.abs(shorts.max.y) < 1e-6 && Math.abs(shorts.min.y + 0.30) < 1e-6, 'shorts hang from the hips');
  const torso = (g1.torso.computeBoundingBox(), g1.torso.boundingBox);
  assert.ok(Math.abs(torso.min.y) < 1e-6 && Math.abs(torso.max.y - 0.52) < 1e-6, 'torso rises from the hips');
  const leg = (g1.leg.computeBoundingBox(), g1.leg.boundingBox);
  assert.ok(Math.abs(leg.max.y) < 1e-6 && Math.abs(leg.min.y + 0.85) < 1e-6, 'leg hangs from the hip');
  const cone = (g1.cone.computeBoundingBox(), g1.cone.boundingBox);
  assert.ok(Math.abs(cone.min.y) < 1e-6 && Math.abs(cone.max.y - 0.3) < 1e-6, 'cone apex at origin pointing down');
});

check('team materials are cached per team id and use the team colours', () => {
  const a = getTeamMaterials(TEAMS[0]), b = getTeamMaterials(TEAMS[0]), c = getTeamMaterials(TEAMS[1]);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.jersey.color.getHex(), TEAMS[0].jersey);
  assert.equal(a.shorts.color.getHex(), TEAMS[0].shorts);
  assert.equal(c.jersey.color.getHex(), TEAMS[1].jersey);
  assert.ok(a.jersey.isMeshLambertMaterial && a.shorts.isMeshLambertMaterial);
  assert.equal(a.skin, c.skin, 'skin materials shared across teams');
  assert.equal(a.shoe, c.shoe, 'shoe material shared across teams');
  assert.equal(a.skin.length, 3);
  assert.equal(a.skin[0].color.getHex(), COLORS.skin[0]);
  assert.equal(a.shoe.color.getHex(), COLORS.shoe);
});

check('createHumanoid builds the section 6 hierarchy with 11 Lambert meshes and a blob shadow', () => {
  const h = createHumanoid(TEAMS[0], 1);
  assert.ok(h.group.isGroup && h.pelvis.isGroup);
  assert.equal(h.pelvis.parent, h.group);
  for (const name of PART_NAMES) {
    const m = h.parts[name];
    assert.ok(m && m.isMesh, name);
    assert.ok(m.material.isMeshLambertMaterial, name + ' is Lambert');
  }
  const p = h.parts;
  assert.equal(p.shorts.parent, h.pelvis);
  assert.equal(p.torso.parent, h.pelvis);
  assert.equal(p.head.parent, p.torso);
  assert.equal(p.upperArmL.parent, p.torso);
  assert.equal(p.upperArmR.parent, p.torso);
  assert.equal(p.forearmL.parent, p.upperArmL);
  assert.equal(p.forearmR.parent, p.upperArmR);
  assert.equal(p.legL.parent, h.pelvis);
  assert.equal(p.legR.parent, h.pelvis);
  assert.equal(p.shoeL.parent, p.legL);
  assert.equal(p.shoeR.parent, p.legR);
  assert.equal(h.shadow.parent, h.group);
  assert.ok(h.shadow.material.transparent && h.shadow.material.depthWrite === false);
  assert.equal(h.shadow.material.opacity, 0.45);
  assert.equal(h.shadow.position.y, 0.01);
  let meshCount = 0;
  h.group.traverse((o) => { if (o.isMesh) meshCount++; });
  assert.equal(meshCount, 12, '11 body meshes + shadow');
  assert.equal(p.head.material, getTeamMaterials(TEAMS[0]).skin[1], 'skin by index');
  const h2 = createHumanoid(TEAMS[1], 5);
  assert.equal(h2.parts.head.material, getTeamMaterials(TEAMS[1]).skin[2], 'skin index wraps');
  assert.equal(h2.parts.shorts.geometry, h.parts.shorts.geometry, 'geometry shared');
  assert.equal(h2.shadow.material, h.shadow.material, 'shadow material shared');
});

check('standing idle: head at 1.72 m, hand at the hip, soles at the floor', () => {
  const h = createHumanoid(TEAMS[0], 0);
  h.setPose('idle', { t: 0, dt: 0 });
  h.headWorld(V);
  assert.ok(Math.abs(V.y - 1.72) < 1e-6, 'head y ' + V.y);
  h.handWorld(V, 'R');
  assert.ok(Math.abs(V.y - (1.42 - 0.6 * Math.cos(0.1))) < 1e-6, 'hand y ' + V.y);
  assert.ok(V.x > 0.27, 'right hand on +x');
  h.handWorld(V, -1);
  assert.ok(V.x < -0.27, 'left hand on -x');
  const shoe = h.parts.shoeL;
  h.group.updateMatrixWorld(true);
  V.set(0, -0.04, 0).applyMatrix4(shoe.matrixWorld);
  assert.ok(V.y >= -1e-6 && V.y < 0.03, 'sole near the floor: ' + V.y);
  assert.equal(h.headY(), 1.72);
});

check('every pose over 40 frames leaves no NaN anywhere', () => {
  const h = createHumanoid(TEAMS[1], 2);
  for (const pose of POSES) {
    for (let i = 0; i < 40; i++) {
      const tt = i / 60;
      h.setPose(pose, {
        t: tt, speed: 4 * (i % 3), f: (i % 12) / 10, ballY: 0.12 + 0.8 * Math.abs(Math.sin(tt * 8)),
        handSign: i % 2 ? 1 : -1, jumpY: 0.55 * Math.sin(Math.PI * tt / 0.55), lean: 0.05, releaseAge: tt, dt: 1 / 60,
      });
      assertFinite(h, pose + '#' + i);
    }
    // Degenerate params must not poison the joints either.
    h.setPose(pose, { t: NaN, speed: NaN, f: undefined, ballY: null, jumpY: -1, dt: NaN });
    assertFinite(h, pose + ' (degenerate params)');
    h.setPose(pose);
    assertFinite(h, pose + ' (no params)');
  }
});

check('windup hand point is 2.0-2.4 m high and in front of the shooter', () => {
  const h = createHumanoid(TEAMS[0], 0);
  h.group.position.set(0, 0, -8.3);
  h.group.rotation.y = Math.PI;   // facing -Z (toward the hoop)
  // Mid-jump release frame: f = 0.8 on a 0.55 s meter over a 0.55 s jump of 0.55 m.
  const jumpY = 0.55 * Math.sin(Math.PI * 0.8);
  h.setPose('windup', { f: 0.8, jumpY, handSign: 1, dt: 0 });
  h.handWorld(V);
  assert.ok(V.y >= 2.0 && V.y <= 2.4, 'hand y ' + V.y.toFixed(3));
  assert.ok(V.z < -8.3 - 0.15, 'hand in front (toward -Z): ' + V.z.toFixed(3));
  assert.ok(Math.abs(V.x) < 0.5, 'hand near the centre line: ' + V.x.toFixed(3));
  // Full extension without a jump still clears 1.85 m; with the block jump it is well above the rim height reach.
  h.setPose('windup', { f: 1, jumpY: 0, dt: 0 });
  h.handWorld(V, 1);
  assert.ok(V.y > 1.85 && V.y < 2.0, 'standing extension ' + V.y.toFixed(3));
  h.setPose('jump', { jumpY: 0.75, dt: 0 });
  h.handWorld(V, 1);
  assert.ok(V.y > 2.7, 'block reach ' + V.y.toFixed(3));
  h.setPose('dunk', { jumpY: 0.9, dt: 0 });
  h.handsMidWorld(V);
  assert.ok(V.y > 2.8 && Math.abs(V.x) < 0.1, 'dunk hands mid ' + V.y.toFixed(3));
});

check('joints blend smoothly (damped at 18/s) instead of popping', () => {
  const h = createHumanoid(TEAMS[0], 0);
  h.setPose('idle', { t: 0, dt: 0 });
  assert.ok(Math.abs(h.parts.upperArmR.rotation.x) < 1e-9);
  h.setPose('windup', { f: 0, dt: 1 / 60 });
  const after1 = h.parts.upperArmR.rotation.x;
  const expected = -2.4 * (1 - Math.exp(-18 / 60));
  assert.ok(Math.abs(after1 - expected) < 1e-9, 'one frame of damping: ' + after1);
  for (let i = 0; i < 120; i++) h.setPose('windup', { f: 0, dt: 1 / 60 });
  assert.ok(Math.abs(h.parts.upperArmR.rotation.x + 2.4) < 1e-6, 'converged');
  assert.ok(Math.abs(h.parts.forearmR.rotation.x + 1.2) < 1e-6, 'forearm folded at f=0');
  // Release snaps the forearms straight immediately (follow-through), upper arms keep blending.
  h.setPose('release', { releaseAge: 0, jumpY: 0.3, dt: 1 / 60 });
  assert.ok(Math.abs(h.parts.forearmR.rotation.x) < 1e-9, 'forearm snapped to 0');
  assert.ok(Math.abs(h.parts.legL.rotation.x) > 0.01, 'legs start tucking in the air');
  // dt = 0 snaps every joint.
  h.setPose('defend', { speed: 0, dt: 0 });
  assert.equal(h.pelvis.position.y, 0.85);
  assert.equal(h.parts.upperArmR.rotation.z, 1.2);
  assert.equal(h.parts.upperArmL.rotation.z, -1.2);
  assert.equal(h.parts.legR.rotation.z, 0.25);
  h.setPose('defend', { speed: 3, phi: 0, dt: 0 });
  assert.equal(h.pelvis.position.y, 0.95, 'fast defender runs instead of crouching');
});

check('run cycle, dribble arm, jump height and shadow scale follow the params', () => {
  const h = createHumanoid(TEAMS[0], 0);
  h.setPose('run', { speed: 5.2, phi: Math.PI / 2, dt: 0 });
  const A = 0.35 + 0.05 * 5.2;
  assert.ok(Math.abs(h.parts.legL.rotation.x - A) < 1e-9 && Math.abs(h.parts.legR.rotation.x + A) < 1e-9);
  assert.ok(Math.abs(h.parts.upperArmL.rotation.x + 0.8 * A) < 1e-9);
  assert.ok(Math.abs(h.pelvis.position.y - (0.95 + 0.04)) < 1e-9, 'bob at |sin|=1');
  assert.ok(Math.abs(h.parts.torso.rotation.x - (0.05 + 0.02 * 5.2)) < 1e-9, 'lean');
  h.setPose('run', { speed: 0.1, t: 1, dt: 0 });
  assert.ok(Math.abs(h.parts.legL.rotation.x) < 1e-9, 'slow run is idle');
  // Internal phase advances with speed when phi is not supplied.
  h.phase = 0;
  for (let i = 0; i < 60; i++) h.setPose('run', { speed: 5.2, dt: 1 / 60 });
  assert.ok(Math.abs(h.phase - (5.2 * 1.9 - 2 * Math.PI)) < 1e-9, 'phase wraps at 2pi: ' + h.phase);
  // Dribbling hand: extended when the ball is low, bent when it is high; other arm swings.
  h.setPose('dribble', { speed: 0, ballY: 0.12, handSign: 1, dt: 0 });
  assert.ok(Math.abs(h.parts.upperArmR.rotation.x + 0.4) < 1e-9);
  assert.ok(Math.abs(h.parts.forearmR.rotation.x + 0.3) < 1e-9, 'low ball, forearm -0.3');
  h.setPose('dribble', { speed: 0, ballY: 0.92, handSign: -1, dt: 0 });
  assert.ok(Math.abs(h.parts.forearmL.rotation.x + 1.2) < 1e-9, 'high ball, forearm -1.2');
  assert.ok(Math.abs(h.parts.upperArmR.rotation.x) < 1e-9, 'other arm idle');
  assert.equal(h.handSign, -1);
  // Jump lifts the pelvis and shrinks the shadow.
  h.setPose('jump', { jumpY: 0.45, dt: 0 });
  assert.ok(Math.abs(h.pelvis.position.y - 1.40) < 1e-9);
  assert.ok(Math.abs(h.shadow.scale.x - (1 - 0.4 * 0.5)) < 1e-9 && h.shadow.scale.y === 1);
  h.setPose('jump', { jumpY: 2, dt: 0 });
  assert.ok(Math.abs(h.shadow.scale.z - 0.6) < 1e-9, 'shadow scale clamps at 0.6');
  h.setPose('celebrate', { t: 0.2, dt: 0 });
  assert.ok(Math.abs(h.pelvis.position.y - 1.10) < 1e-9, 'celebration hop peak');
  h.setPose('celebrate', { t: 0.6, dt: 0 });
  assert.ok(h.pelvis.position.y >= 0.95, 'hop never sinks below the floor');
  h.setPose('layup', { handSign: 1, dt: 0 });
  assert.ok(Math.abs(h.parts.upperArmR.rotation.x + 2.9) < 1e-9 && Math.abs(h.parts.upperArmL.rotation.x + 1.2) < 1e-9);
  h.setPose('stunned', { dt: 0 });
  assert.ok(Math.abs(h.parts.torso.rotation.x + 0.2) < 1e-9 && Math.abs(h.parts.upperArmR.rotation.z - 0.3) < 1e-9);
  h.setPose('steal', { handSign: 1, dt: 0 });
  assert.ok(Math.abs(h.parts.upperArmR.rotation.x + 1.4) < 1e-9 && Math.abs(h.parts.torso.rotation.x - 0.35) < 1e-9);
});

check('createMarker gives a downward cone above the head and a floor ring in the team colour', () => {
  const m = createMarker(TEAMS[0].jersey);
  assert.ok(m.cone.isMesh && m.ring.isMesh && m.group.isGroup);
  assert.equal(m.cone.parent, m.group);
  assert.equal(m.ring.parent, m.group);
  assert.equal(m.cone.material.color.getHex(), TEAMS[0].jersey);
  assert.equal(m.ring.material.opacity, 0.8);
  assert.ok(m.ring.material.transparent);
  m.update(1.5, -6, 1.72, 0.125);   // sin(2*pi*2*0.125) = 1 -> +0.05
  assert.equal(m.group.position.x, 1.5);
  assert.equal(m.group.position.z, -6);
  assert.ok(Math.abs(m.cone.position.y - (1.72 + 0.35 + 0.05)) < 1e-9, 'cone bob ' + m.cone.position.y);
  m.setColor(TEAMS[1].jersey);
  assert.equal(m.ring.material.color.getHex(), TEAMS[1].jersey);
});

check('setPose and handWorld do not allocate (heap stable over 20k calls)', () => {
  const h = createHumanoid(TEAMS[0], 0);
  const params = { t: 0, speed: 4, f: 0.5, ballY: 0.5, handSign: 1, jumpY: 0.2, lean: 0, releaseAge: 0.1, dt: 1 / 60 };
  const run = () => {
    for (let i = 0; i < 20000; i++) {
      params.t = i / 60;
      h.setPose(POSES[i % POSES.length], params);
      h.handWorld(V, i % 2 ? 1 : -1);
    }
  };
  run(); // warm up
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    run();
    globalThis.gc();
    const after = process.memoryUsage().heapUsed;
    // 40k calls that allocated even one small object each would retain far more than this after a GC.
    assert.ok(after - before < 64 * 1024, 'heap grew by ' + (after - before) + ' bytes');
  }
});

console.log(passed + ' checks passed');
