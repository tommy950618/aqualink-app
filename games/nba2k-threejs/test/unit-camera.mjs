// Unit checks for src/cam/{broadcast,director,shots}.js in Node (SPEC-v2 §6.4, §9.4 unit-camera row).
// Reproduces the §6.4.2 [M] framing measurements with the vendored three.js, the real court/rim constants and the
// six legends' heights, through the Director's own camera (fov, aspect, portrait lens shift via setViewOffset).
// Run: node test/unit-camera.mjs
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { FRAMING, baseFov, BroadcastCamera, framingRow, BROADCAST, CAMERA_MODES } from '../src/cam/broadcast.js';
import { Director, MODES } from '../src/cam/director.js';
import {
  introShots, IntroTimeline, Turntable, INTRO, INTRO_SPOTS, MATCHUP_SPOTS, TITLE_SPOTS, LINEUP_SPOTS, lineupShot,
  titleShot, pauseShot, pauseRenderHz, halftimeShot, gameoverShot, makePose, fitWidth, easeInOutCubic, legendHeight, SHOTS,
} from '../src/cam/shots.js';
import { RIM, COURT } from '../src/constants.js';
import { LEGENDS, DEFAULT_LINEUP } from '../src/legends.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b} ± ${eps}, got ${a}`);

// ------------------------------------------------------------------------------------------------ scenarios (PR [M])
// Six ball scenarios × six players: offence at the listed spots, each defender 18 % of the way from his man to the
// rim. Feet at y 0, heads at y 2.1 (the [M] definition); the handler's pixel height uses 2.0 m.
const lerpToRim = (p) => ({ x: p.x + (RIM.x - p.x) * 0.18, z: p.z + (RIM.z - p.z) * 0.18 });
const SCEN = {
  check: { ball: { x: 0.2, z: -4.6 }, off: [{ x: 0, z: -4.6 }, { x: -5.4, z: -7.6 }, { x: 5.4, z: -7.6 }] },
  wingR: { ball: { x: 5.6, z: -7.6 }, off: [{ x: 5.4, z: -7.6 }, { x: 0, z: -4.9 }, { x: -7.0, z: -13.3 }] },     // far-corner teammate
  wingR2: { ball: { x: 5.6, z: -7.6 }, off: [{ x: 5.4, z: -7.6 }, { x: 0, z: -4.9 }, { x: -5.4, z: -7.6 }] },    // weak-wing teammate
  cornerL: { ball: { x: -7.0, z: -13.3 }, off: [{ x: -7.0, z: -13.3 }, { x: 0, z: -4.9 }, { x: 5.4, z: -7.6 }] },
  paint: { ball: { x: 0.8, z: -11 }, off: [{ x: 0.8, z: -11 }, { x: -5.4, z: -7.6 }, { x: 5.4, z: -7.6 }] },
  near: { ball: { x: 0.2, z: -1.2 }, off: [{ x: 0, z: -1.0 }, { x: -5.4, z: -7.6 }, { x: 5.4, z: -7.6 }] },
};
// The default lineup's offence (team A) and defence (team B) heights, matched slot by slot.
const H_OFF = DEFAULT_LINEUP.a.map((id) => LEGENDS[id].stats.barefootM);
const H_DEF = DEFAULT_LINEUP.b.map((id) => LEGENDS[id].stats.barefootM);

const worldFor = (s) => ({ ball: { pos: { x: s.ball.x, y: 1.0, z: s.ball.z }, vel: { x: 0, y: 0, z: 0 }, state: 'held', owner: null } });
const inside = (p) => Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;

function measure(mode, W, H, heads = 'spec') {
  const d = new Director({ width: W, height: H, cameraMode: mode });
  d.setMode('broadcast', { transition: 'cut' });
  const r = { feet: 0, heads: 0, tot: 0, minPx: Infinity, maxPx: 0, worst: 0, detail: {} };
  const a = {}, b = {};
  for (const [name, s] of Object.entries(SCEN)) {
    d.broadcast.requestSnap();
    d.update(1 / 60, worldFor(s));
    const players = [...s.off.map((p, i) => [p, H_OFF[i]]), ...s.off.map((p, i) => [lerpToRim(p), H_DEF[i]])];
    for (const [p, h] of players) {
      r.feet += inside(d.ndc(a, p.x, 0, p.z)) ? 1 : 0;
      r.heads += inside(d.ndc(a, p.x, heads === 'spec' ? 2.1 : h, p.z)) ? 1 : 0;
      r.tot++;
    }
    const f = d.ndc(a, s.off[0].x, 0, s.off[0].z).y, hh = d.ndc(b, s.off[0].x, 2.0, s.off[0].z).y;
    const px = (hh - f) / 2 * H;
    r.minPx = Math.min(r.minPx, px); r.maxPx = Math.max(r.maxPx, px);
    const rim = d.ndc(a, RIM.x, RIM.y, RIM.z);
    const ball = d.ndc(b, s.ball.x, 1.0, s.ball.z);
    r.worst = Math.max(r.worst, Math.abs(rim.x), Math.abs(rim.y), Math.abs(ball.x), Math.abs(ball.y));
    r.detail[name] = { rimY: rim.y, half: d.ndc({}, 0, 0, 0).y, fov: d.camera.fov };
  }
  return r;
}

// ---------------------------------------------------------------------------------------------------------- checks

check('FRAMING table values (§6.4.2) and modes', () => {
  const exp = {
    standard: { landscape: [42, 0.35, 6.5, 4.5, 0.30, 1.0, -8.0, -4.0, 0.5, 0.6, 3, 0], portrait: [72, 0.35, 9.0, 12.0, 0, 1.0, -7.0, null, 0, 0, 4, 0.25] },
    close: { landscape: [38, 0.45, 5.2, 3.5, 0.40, 1.1, -8.5, -4.0, 0.7, 0.9, 3, 0], portrait: [66, 0.40, 7.5, 10.5, 0.10, 1.0, -7.0, null, 0, 0, 4, 0.25] },
    high: { landscape: [46, 0.30, 11.0, 6.0, 0.20, 1.0, -8.5, -4.0, 0.4, 0.5, 3, 0], portrait: [74, 0.40, 13.0, 10.0, 0, 0.0, -6.0, null, 0, 0, 4, 0.15] },
  };
  for (const m of Object.keys(exp)) {
    for (const o of ['landscape', 'portrait']) {
      const f = FRAMING[m][o];
      assert.deepEqual([f.fov, f.kx, f.y, f.z0, f.kz, f.lookY, f.lookZ, f.nearZ, f.nearZ0, f.nearLook, f.paintZoom, f.lens], exp[m][o], `${m}/${o}`);
      assert.ok(Object.isFrozen(f));
    }
  }
  assert.deepEqual(CAMERA_MODES, ['standard', 'close', 'high']);
  assert.deepEqual(MODES, ['broadcast', 'intro', 'replay', 'lineup', 'title', 'pause', 'halftime', 'gameover', 'showcase']);
  assert.equal(framingRow('standard', 0.99), FRAMING.standard.portrait);
  assert.equal(framingRow('standard', 1.0), FRAMING.standard.landscape);
});

check('baseFov: 4:3 → 54.2 ± 0.1, 1:1 → 68.6, 16:9 and wider unchanged, portrait keeps its row', () => {
  near(baseFov(4 / 3, 42), 54.2, 0.1, '4:3');
  near(baseFov(1, 42), 68.6, 0.1, '1:1');
  assert.equal(baseFov(16 / 9, 42), 42);
  assert.equal(baseFov(844 / 390, 42), 42);
  assert.equal(baseFov(390 / 844, FRAMING.standard.portrait), 72);
  assert.equal(baseFov(1.5, FRAMING.high.landscape) > 46, true);
});

check('landscape standard 844×390: 36/36 feet + 36/36 heads, handler 56–93 px, worst |NDC| ≤ 0.68', () => {
  const r = measure('standard', 844, 390);
  assert.equal(r.feet, 36); assert.equal(r.heads, 36);
  assert.ok(r.minPx >= 55.5 && r.minPx < 57, `min handler px ${r.minPx}`);
  assert.ok(r.maxPx <= 93.5, `max handler px ${r.maxPx}`);
  assert.ok(r.worst <= 0.68, `worst ${r.worst}`);
  // with the six real heights (default lineup) every head is still in view
  assert.equal(measure('standard', 844, 390, 'real').heads, 36);
});

check('portrait standard 390×844: 34/36 feet (36/36 at 360×640), handler 42–66 px, worst ≤ 0.52, fov 72', () => {
  const r = measure('standard', 390, 844);
  assert.equal(r.feet, 34);
  assert.ok(r.heads >= 33, `heads ${r.heads}`);
  assert.ok(r.minPx >= 41.5 && r.maxPx <= 66.5, `handler px ${r.minPx}–${r.maxPx}`);
  assert.ok(r.worst <= 0.52, `worst ${r.worst}`);
  assert.equal(r.detail.check.fov, 72);
  const s = measure('standard', 360, 640);
  assert.equal(s.feet, 36); assert.equal(s.heads, 36);
  assert.equal(measure('standard', 360, 640, 'real').feet, 36);
});

check('other camera options keep their measured counts (close L 34/36, high L 36/36, high P ≥ 33/36)', () => {
  assert.ok(measure('close', 844, 390).feet >= 34);
  assert.equal(measure('high', 844, 390).feet, 36);
  assert.ok(measure('high', 390, 844).feet >= 33);
  assert.ok(measure('close', 390, 844).feet >= 29);
});

check('handler at z −1 (landscape): feet −0.67, half line −0.83 ± 0.03; half line visible down to z −2', () => {
  const d = new Director({ width: 844, height: 390 });
  const o = {};
  for (const [hz, half, feet] of [[-1, -0.83, -0.67], [-2, -0.96, -0.63]]) {
    d.broadcast.requestSnap();
    d.update(0, { ball: { pos: { x: 0.2, y: 1, z: hz - 0.2 }, vel: { x: 0, y: 0, z: 0 }, state: 'held' } });
    near(d.ndc(o, 0, 0, 0).y, half, 0.03, `half line @${hz}`);
    near(d.ndc(o, 0, 0, hz).y, feet, 0.03, `feet @${hz}`);
    assert.ok(d.ndc(o, 0, 0, 0).y >= -1.0);
  }
});

check('portrait lens shift 0.25 moves the rim from NDC y 0.23 to 0.48 ± 0.02 (half line −0.09, jumbotron 0.76–0.95)', () => {
  const d = new Director({ width: 390, height: 844 });
  const w = worldFor(SCEN.check);
  d.update(0, w);
  const o = {};
  near(d.ndc(o, RIM.x, RIM.y, RIM.z).y, 0.48, 0.02, 'rim with lens');
  near(d.ndc(o, 0, 0, 0).y, -0.09, 0.02, 'half line');
  near(d.ndc(o, 0, 7.25, -27).y, 0.76, 0.02, 'jumbotron bottom');
  near(d.ndc(o, 0, 11.75, -27).y, 0.95, 0.02, 'jumbotron top');
  assert.equal(d.camera.view.enabled, true);
  near(d.camera.view.offsetY, 0.25 * 844 / 2, 1e-9);
  // the same camera without the view offset
  const c = d.camera.clone();
  c.clearViewOffset();
  c.updateMatrixWorld();
  near(new THREE.Vector3(RIM.x, RIM.y, RIM.z).project(c).y, 0.23, 0.02, 'rim without lens');
  // landscape never uses a lens
  d.setSize(844, 390);
  d.update(0, w);
  assert.equal(d.camera.view.enabled, false);
});

check('target() is pure and follows the §6.4.2 formula (near rule, paint zoom, clamps)', () => {
  const bc = new BroadcastCamera({ aspect: 844 / 390 });
  const world = { ball: { pos: { x: 9, y: 1, z: 3 }, vel: { x: 0, y: 0, z: 0 }, state: 'held', owner: null } };
  const before = JSON.stringify(world) + JSON.stringify(bc);
  const a = bc.target(world, makePose()), b = bc.target(world, makePose());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(world) + JSON.stringify(bc), before);
  // clamped bx = 7.62, bz = 0 → near = 4: pos z = 4.5 + 0.3·9 + 0.5·4 = 9.2, look z = −8 + 0.6·4 = −5.6
  near(a.px, 0.35 * COURT.HALF_W, 1e-9); near(a.pz, 9.2, 1e-9); near(a.lz, -5.6, 1e-9); near(a.py, 6.5, 1e-9);
  assert.equal(a.lx, a.px);                    // fixed yaw
  // paint zoom: ball 3 m from the rim → fov 42 − 3
  world.ball.pos.x = 0; world.ball.pos.z = RIM.z + 3;
  near(bc.target(world, makePose()).fov, 39, 1e-9);
  world.ball.pos.z = RIM.z + 4.6;
  near(bc.target(world, makePose()).fov, 42, 1e-9);
});

check('modifiers: shot lift 0.5, dunk push 4° + 30 % rim look, break widen 2°, backcourt +0.6 m', () => {
  const bc = new BroadcastCamera({ aspect: 16 / 9 });
  const base = bc.target({ ball: { pos: { x: 0, y: 1, z: -6 }, vel: { x: 0, y: 0, z: 0 }, state: 'held' } }, makePose());
  const lift = bc.target({ ball: { pos: { x: 0, y: 4.5, z: -6 }, vel: { x: 0, y: 0, z: 0 }, state: 'flight' } }, makePose());
  near(lift.ly - base.ly, 0.5, 1e-9);
  const pass = bc.target({ ball: { pos: { x: 0, y: 4.5, z: -6 }, vel: { x: 0, y: 0, z: 0 }, state: 'pass' } }, makePose());
  near(pass.ly, base.ly, 1e-9);
  const brk = bc.target({ ball: { pos: { x: 0, y: 1, z: -6 }, vel: { x: 0, y: 0, z: -6.5 }, state: 'dribble' } }, makePose());
  near(brk.fov - base.fov, 2, 1e-9);
  const slow = bc.target({ ball: { pos: { x: 3, y: 1, z: -8.5 }, vel: { x: 0, y: 0, z: -7 }, state: 'dribble' } }, makePose());
  near(slow.fov, base.fov, 1e-9);              // bz −8.5 < −8 (outside the paint): no widen
  const owner = { pos: { x: 0, z: -0.5 }, vel: { x: 0, z: 2 } };
  const bk = bc.target({ ball: { pos: { x: 0, y: 1, z: -0.6 }, vel: { x: 0, y: 0, z: 0 }, state: 'dribble', owner } }, makePose());
  const bk0 = bc.target({ ball: { pos: { x: 0, y: 1, z: -0.6 }, vel: { x: 0, y: 0, z: 0 }, state: 'dribble', owner: { pos: { x: 0, z: -0.5 }, vel: { x: 0, z: -2 } } } }, makePose());
  near(bk.pz - bk0.pz, 0.6, 1e-9);
  bc.setDunkPush(true);
  const dk = bc.target({ ball: { pos: { x: 0, y: 1, z: -6 }, vel: { x: 0, y: 0, z: 0 }, state: 'held' } }, makePose());
  near(base.fov - dk.fov, 4, 1e-9);
  near(dk.lz, base.lz + (RIM.z - base.lz) * 0.3, 1e-9);
  // damped: after 1 s of updates the push is at 4·(1 − e^−4)
  bc.setDunkPush(false);
  const w = { ball: { pos: { x: 0, y: 1, z: -6 }, vel: { x: 0, y: 0, z: 0 }, state: 'held' } };
  const out = makePose();
  bc.snap(w, out);
  bc.setDunkPush(true);
  for (let i = 0; i < 60; i++) bc.update(1 / 60, w, out);
  near(bc.push, 4 * (1 - Math.exp(-4)), 1e-6);
  near(out.fov, base.fov - bc.push, 1e-9);
});

check('damping: position/look rate 5, fov rate 3 (frame-rate independent)', () => {
  const run = (hz) => {
    const bc = new BroadcastCamera({ aspect: 16 / 9 });
    const o = makePose();
    bc.snap({ ball: { pos: { x: 0, y: 1, z: -6 }, vel: { x: 0, y: 0, z: 0 } } }, o);
    const w = { ball: { pos: { x: 2, y: 1, z: -12 }, vel: { x: 0, y: 0, z: 0 } } };
    for (let i = 0; i < hz; i++) bc.update(1 / hz, w, o);
    return o;
  };
  const a = run(60), b = run(30);
  const tx = 0.35 * 2, x0 = 0;
  near(a.px, tx + (x0 - tx) * Math.exp(-5), 1e-9);
  near(a.px, b.px, 1e-9);
  near(a.fov, b.fov, 1e-9);
  near(a.fov, 39 + (42 - 39) * Math.exp(-3), 1e-9);     // paint zoom target 39 from 42
});

check('director: R#4 matrices current after update, ease is cubic in-out, cut on broadcast, shake decays', () => {
  const d = new Director({ width: 844, height: 390 });
  const w = worldFor(SCEN.wingR);
  d.update(1 / 60, w);
  const c = d.camera;
  const e = c.matrixWorld.elements;
  near(e[12], c.position.x, 1e-9); near(e[13], c.position.y, 1e-9); near(e[14], c.position.z, 1e-9);
  const inv = new THREE.Matrix4().copy(c.matrixWorld).invert();
  for (let i = 0; i < 16; i++) near(c.matrixWorldInverse.elements[i], inv.elements[i], 1e-9);
  // ndc == Vector3.project with the camera's current matrices
  const o = {};
  const v = new THREE.Vector3(5.4, 1, -7.6).project(c);
  d.ndc(o, 5.4, 1, -7.6);
  near(o.x, v.x, 1e-9); near(o.y, v.y, 1e-9);
  // ease 0.6 s into the title: at 0.3 s the pose is halfway (cubic in-out at 0.5 = 0.5)
  const from = { ...d.pose };
  d.setMode('title', { transition: 'ease', seconds: 0.6 });
  d.update(0.3, w);
  const to = titleShot(0.3, 844 / 390, makePose());
  near(d.pose.px, from.px + (to.px - from.px) * 0.5, 1e-6);
  near(d.pose.fov, from.fov + (to.fov - from.fov) * easeInOutCubic(0.5), 1e-6);
  d.update(0.31, w);
  const to2 = titleShot(0.61, 844 / 390, makePose());
  near(d.pose.px, to2.px, 1e-9);
  // cut back to broadcast snaps to the target exactly
  d.setMode('broadcast', { transition: 'cut' });
  d.update(1 / 60, w);
  const t = d.broadcast.target(w, makePose());
  near(d.pose.px, t.px, 1e-9); near(d.pose.pz, t.pz, 1e-9); near(d.camera.fov, t.fov, 1e-9);
  // shake: offsets only during the window, zero after
  d.shake(0.03, 0.25, 12);
  let maxOff = 0;
  for (let i = 0; i < 30; i++) {
    d.update(1 / 60, w);
    maxOff = Math.max(maxOff, Math.abs(d.camera.position.y - d.pose.py));
  }
  assert.ok(maxOff > 0.005 && maxOff <= 0.03 + 1e-9, `shake ${maxOff}`);
  near(d.camera.position.y, d.pose.py, 1e-12);
  // settings camera option: 0.4 s ease to the close framing
  d.setCameraMode('close');
  assert.equal(d.cameraMode, 'close');
  for (let i = 0; i < 30; i++) d.update(1 / 60, w);
  const tc = d.broadcast.target(w, makePose());
  near(d.pose.py, tc.py, 0.05);
});

check('intro: full 15.7 s (LeBron 3.2 s), short 4.5 s, off 0; team A ★ first; spots; cues; skips', () => {
  const full = introShots(DEFAULT_LINEUP, { variant: 'full' });
  const tot = full.reduce((s, x) => s + x.dur, 0);
  near(tot, INTRO.FULL_S, 1e-9);
  assert.ok(tot <= 16.5);
  assert.deepEqual(full.map((s) => s.kind), ['crane', 'legend', 'legend', 'legend', 'legend', 'legend', 'legend', 'matchup']);
  assert.deepEqual(full.filter((s) => s.id).map((s) => s.id), [...DEFAULT_LINEUP.a, ...DEFAULT_LINEUP.b]);
  assert.equal(full.find((s) => s.id === 'lebron').dur, 3.2);
  assert.equal(full.find((s) => s.id === 'kyrie').dur, 1.6);
  assert.equal(full[1].first, true); assert.equal(full[4].first, true); assert.equal(full[2].first, false);
  assert.deepEqual([full[1].spot.x, full[1].spot.z], [-4.2, -6.0]);
  assert.deepEqual([full[6].spot.x, full[6].spot.z], [4.2, -6.0]);
  near(full[5].h, 1.96, 1e-9);
  const short = introShots(DEFAULT_LINEUP, { variant: 'short' });
  near(short.reduce((s, x) => s + x.dur, 0), INTRO.SHORT_S, 1e-9);
  assert.deepEqual(short.map((s) => s.kind), ['crane', 'team', 'team', 'matchup']);
  assert.equal(introShots(DEFAULT_LINEUP, { variant: 'off' }).length, 0);
  // legend shot pose: start d 3.2, end d 2.6, look at 0.80 h, fov 28
  const tl = new IntroTimeline();
  const cues = [];
  tl.onCue = (type, s, i) => cues.push(type + ':' + (s ? s.kind + (s.id ? '/' + s.id : '') : '') + ':' + i);
  tl.load(full).start();
  const p = makePose();
  tl.update(2.5);                       // into the first legend shot
  tl.pose(p, 0, { aspect: 16 / 9 });
  const L = full[1];
  near(Math.hypot(p.px - L.spot.x, p.pz - L.spot.z), Math.hypot(0.35, 3.2), 1e-6);
  near(p.py, 0.72 * L.h, 1e-9); near(p.ly, 0.80 * L.h, 1e-9); assert.equal(p.fov, 28);
  tl.update(L.dur - 1e-6);                 // LeBron's 3.2 s shot (★ of team A)
  tl.pose(p, 0, { aspect: 16 / 9 });
  near(Math.hypot(p.px - L.spot.x, p.pz - L.spot.z), Math.hypot(0.35, 2.6), 1e-3);
  // tap skips the current legend (LeBron 3.2 s here: index 1 → 2)
  const before = tl.index;
  tl.skipShot();
  assert.equal(tl.index, before + 1);
  // run to the end
  for (let i = 0; i < 2000 && tl.running; i++) tl.update(1 / 60);
  assert.equal(tl.done, true);
  assert.equal(cues[0], 'shot:crane:0');
  assert.equal(cues[cues.length - 1], 'end::-1');
  assert.equal(cues.filter((c) => c.startsWith('shot:legend')).length, 6);
  // skipAll ends at once
  const t2 = new IntroTimeline();
  let ended = 0;
  t2.onCue = (type) => { if (type === 'end') ended++; };
  t2.load(full).start();
  t2.update(1);
  t2.skipAll();
  assert.equal(ended, 1); assert.equal(t2.running, false);
  t2.skipAll();
  assert.equal(ended, 1);
  // matchup and crane poses (§6.4.4)
  const m = full[7];
  tl.load(full).start(); tl.update(full[7].start + 0.5);
  tl.pose(p, 0, { aspect: 16 / 9 });
  assert.deepEqual([p.px, p.py, p.pz, p.lx, p.ly, p.lz, p.fov], [0, 1.7, 3.0, 0, 1.4, -5, 44]);
  assert.equal(m.kind, 'matchup');
  tl.load(full).start(); tl.pose(p, 0, { aspect: 16 / 9 });
  assert.deepEqual([p.px, p.py, p.pz, p.fov], [-14, 11, 14, 50]);
  // intro spots / matchup rows face each other
  assert.deepEqual(INTRO_SPOTS.a.map((s) => s.x), [-4.2, -2.8, -1.4]);
  assert.deepEqual(INTRO_SPOTS.b.map((s) => s.x), [1.4, 2.8, 4.2]);
  assert.ok(MATCHUP_SPOTS.a.every((s) => Math.sin(s.yaw) > 0) && MATCHUP_SPOTS.b.every((s) => Math.sin(s.yaw) < 0));
});

check('portrait intro shots keep the subject width in frame (fitWidth)', () => {
  const full = introShots(DEFAULT_LINEUP, { variant: 'full' });
  const tl = new IntroTimeline().load(full).start();
  tl.update(2.6);
  const p = tl.pose(makePose(), 0, { aspect: 390 / 844 });
  const D = Math.hypot(p.px - p.lx, p.py - p.ly, p.pz - p.lz);
  assert.ok(Math.tan(p.fov * Math.PI / 360) * (390 / 844) * D >= 0.6 - 1e-6);
  const q = fitWidth({ px: 0, py: 1.7, pz: 3, lx: 0, ly: 1.4, lz: -5, fov: 44, lens: 0 }, 390 / 844, 3.4, 64);
  const Dq = Math.hypot(q.px - q.lx, q.py - q.ly, q.pz - q.lz);
  near(Math.tan(q.fov * Math.PI / 360) * (390 / 844) * Dq, 3.4, 1e-6);
  assert.equal(q.fov, 64);
});

check('lineup focus d = (h + 0.35)/(2 tan 15°): Yao 4.9 m, Kyrie 4.1 m, fov 30, portrait lens 0.30; overview (§6.4.5)', () => {
  const p = makePose();
  lineupShot({ focus: { x: 2.8, z: -7 }, h: legendHeight('yao') }, 16 / 9, p);
  near(p.pz - (-7), 4.9, 0.05); near(p.py, 1.35, 1e-9); near(p.ly, 1.15, 1e-9); assert.equal(p.fov, 30); assert.equal(p.lens, 0);
  lineupShot({ focus: { x: 0, z: -7 }, h: legendHeight('kyrie') }, 16 / 9, p);
  near(p.pz - (-7), 4.1, 0.05);
  // portrait (deviation, see shots.js): same height / fov / lens 0.30, distance + look solved so the whole body sits in
  // the stage band NDC [−0.10, 0.88]; checked with the Director's real camera (view offset included)
  for (const id of ['kyrie', 'yao']) {
    const h = legendHeight(id);
    const dp = new Director({ width: 390, height: 844 });
    dp.setMode('lineup', { focus: { x: 1.4, z: -7 }, h, transition: 'cut' });
    dp.update(0, null);
    assert.equal(dp.pose.lens, 0.30); assert.equal(dp.camera.fov, 30); near(dp.pose.py, 1.35, 1e-9);
    const o = {};
    near(dp.ndc(o, 1.4, h + 0.12, -7).y, 0.88, 0.01, id + ' head');
    near(dp.ndc(o, 1.4, -0.05, -7).y, -0.10, 0.01, id + ' feet');
  }
  lineupShot({ focus: null }, 844 / 390, p);
  assert.deepEqual([p.px, p.py, p.pz, p.lx, p.ly, p.lz, p.fov], [0, 1.6, 2.5, 0, 1.2, -7, 40]);
  assert.deepEqual(LINEUP_SPOTS.map((s) => s.x), [-4.2, -2.8, -1.4, 1.4, 2.8, 4.2]);
  // within the lineup screen: a new focus eases 0.5 s; repeated calls for the same focus only set the yaw
  const dl = new Director({ width: 390, height: 844 });
  const yao = { position: { x: 2.8, z: -7 }, rotation: { y: 0 } }, kobe = { position: { x: -1.4, z: -7 }, rotation: { y: 0 } };
  dl.setMode('lineup', { focus: yao, focusId: 'yao', h: 2.27, transition: 'cut' });
  dl.update(0, null);
  dl.setMode('lineup', { focus: kobe, focusId: 'kobe', h: 1.96 });
  assert.equal(dl.trans.active, true); near(dl.trans.T, 0.5, 1e-12);
  dl.update(0.25, null);
  assert.ok(dl.pose.px < 2.8 && dl.pose.px > -1.4);
  dl.setMode('lineup', { focus: kobe, focusId: 'kobe', h: 1.96, yawDeg: 45 });
  near(dl.trans.t, 0.25, 1e-12);                 // transition not restarted
  near(dl.turntable.yawDeg, 45, 1e-12);
  dl.update(0.3, null);
  near(dl.pose.px, -1.4, 1e-9);
  // all six of the overview inside the landscape frame
  const d = new Director({ width: 844, height: 390 });
  d.setMode('lineup', { transition: 'cut' });
  d.update(0, null);
  const o = {};
  for (const s of LINEUP_SPOTS) { assert.ok(inside(d.ndc(o, s.x, 0, s.z)) && inside(d.ndc(o, s.x, 2.27, s.z))); }
});

check('title orbit ±12° ping-pong at 3°/s, pause drift + render rate, halftime pan, game-over orbit', () => {
  const p = makePose();
  titleShot(0, 16 / 9, p);
  assert.deepEqual([p.px, p.py, p.pz, p.lx, p.ly, p.lz, p.fov], [0, 0.9, 6.0, 0, 1.25, -4, 38]);
  let maxDeg = 0;
  for (let t = 0; t < 30; t += 0.05) {
    titleShot(t, 16 / 9, p);
    maxDeg = Math.max(maxDeg, Math.abs(Math.atan2(p.px - 0, p.pz + 4)) * 180 / Math.PI);
  }
  near(maxDeg, 12, 0.05);
  titleShot(0.01, 16 / 9, p);
  near(Math.atan2(p.px, p.pz + 4) * 180 / Math.PI / 0.01, 3, 0.01);   // 3°/s at the centre
  assert.equal(TITLE_SPOTS.length, 6);
  near(TITLE_SPOTS[1].x - TITLE_SPOTS[0].x, 1.25, 1e-9);
  pauseShot(0, p); assert.deepEqual([p.px, p.py, p.pz, p.fov], [9, 5.5, 3, 40]);
  pauseShot(0.6 + 4, p); near(p.px, 9 + 0.48, 1e-9);
  pauseShot(30, p); near(p.px, 9 + 0.96, 1e-9);
  assert.deepEqual([pauseRenderHz(0.3), pauseRenderHz(1), pauseRenderHz(8.5), pauseRenderHz(8.7)], [60, 30, 30, 0]);
  halftimeShot(0, 16 / 9, p); assert.deepEqual([p.px, p.py, p.pz, p.lx, p.ly, p.lz, p.fov], [-3, 14, 12, -3, 0, -8, 46]);
  halftimeShot(6, 16 / 9, p); near(p.px, 3, 1e-9);
  const subj = { x: 1, z: -6, yaw: 0, h: 2.0 };
  gameoverShot(0, subj, 16 / 9, p);
  near(Math.hypot(p.px - 1, p.pz + 6), 3.2, 1e-9); near(p.py, 1.5, 1e-9); near(p.ly, 0.72 * 2, 1e-9); assert.equal(p.fov, 32);
  near(p.pz, -6 + 3.2, 1e-9);                       // starts in front of him
  gameoverShot(1, subj, 390 / 844, p);
  near(Math.atan2(p.px - 1, p.pz + 6) * 180 / Math.PI, 12, 1e-6); assert.equal(p.lens, 0.30);
  // portrait: the MVP stands in the top 38 % (NDC 0.30 … 0.94) above the box score
  const dg = new Director({ width: 390, height: 844 });
  dg.setMode('gameover', { subject: { position: { x: 1, z: -6 }, rotation: { y: 0.4 } }, h: 2.0, hold: 0 });
  dg.update(0.5, null);
  const og = {};
  near(dg.ndc(og, 1, 2.15, -6).y, 0.94, 0.01, 'mvp head'); near(dg.ndc(og, 1, 0, -6).y, 0.30, 0.01, 'mvp feet');
  // Director: game-over holds broadcast 1.0 s, then cuts to the orbit; pause → renderHz 0 after 8.6 s
  const d = new Director({ width: 844, height: 390 });
  const w = worldFor(SCEN.check);
  d.update(0, w);
  d.setMode('gameover', { subject: { position: { x: 1, z: -6 }, rotation: { y: 0 } }, h: 2.0 });
  d.update(0.5, w);
  near(d.pose.py, 6.5, 0.01);
  d.update(0.6, w);
  near(Math.hypot(d.pose.px - 1, d.pose.pz + 6), 3.2, 1e-6);
  d.setMode('pause', { transition: 'ease', seconds: 0.6 });
  for (let i = 0; i < 9 * 60; i++) d.update(1 / 60, w);
  assert.equal(d.renderHz, 0);
});

check('turntable: 20°/s idle, 0.5°/px drag, inertia decays at 4/s, auto-spin resumes 3 s after the touch', () => {
  const t = new Turntable();
  t.update(1);
  near(t.yawDeg, 20, 1e-9);
  t.drag(40);
  near(t.yawDeg, 40, 1e-9);
  t.update(1);
  near(t.yawDeg, 40, 1e-9);          // held: no spin
  t.release(100);                    // 50°/s
  t.update(1);
  near(t.yawDeg, 40 + 50 * (1 - Math.exp(-4)) / 4, 1e-6);
  t.update(1.9);                     // idle total 2.9 s: still no auto-spin
  const y = t.yawDeg;
  t.update(0.1);                     // idle 3.0 s
  assert.ok(t.yawDeg - y < 0.1);
  t.update(1);                       // ramping back to 20°/s
  assert.ok(t.yawDeg - y > 5);
  t.reset(90);
  near(t.yaw, Math.PI / 2, 1e-12);
  assert.equal(SHOTS.TURNTABLE.idleDegPerS, 20);
});

console.log(`\n${passed} checks passed`);
