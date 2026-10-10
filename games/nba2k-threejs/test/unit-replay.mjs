// Unit checks for src/cam/replay.js in Node (SPEC-v2 §6.4.6, §9.4 unit-replay row): ring wrap-around, bracketing,
// slerp at α 0.5, 0.5× time mapping, windows per kind, triggers (modes, cooldown, max, clutch, deferred winner),
// player timeline and cues, camera constraints, LOD rule, and no Float32Array constructed after init.
// Uses a fake animator with the frozen Animator capture interface (capture / applyBlend / external).
// Run: node test/unit-replay.mjs
import assert from 'node:assert/strict';
import {
  REPLAY, CAP, EVT, replayWindow, slerp4, replayLod, ReplayRecorder, ReplayTriggers, ReplayPlayer,
} from '../src/cam/replay.js';
import { RIM } from '../src/constants.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b} ± ${eps}, got ${a}`);

/**
 * Fake animator: deterministic pose from a root path p(t) = {x, z, yaw, jump}. Bone b's quaternion is a rotation
 * about +y by 0.1·(b+1)·t; pelvis local (0, 1.0 + jump, 0); expressions/eyes from t. applyBlend slerps bone 0 into
 * `blended` (the real Animator composes every bone) and records the offsets it was given.
 */
class FakeAnimator {
  constructor(path) {
    this.path = path; this.t = 0; this.external = false;
    this.lastA = -1; this.lastB = -1; this.lastAlpha = -1; this.blendCalls = 0;
    this.blended = new Float32Array(4);
    this.root = { x: 0, z: 0, yaw: 0, jump: 0 };
  }
  capture(f, o) {
    const p = this.path(this.t, this.root);
    f[o] = p.x; f[o + 1] = 0; f[o + 2] = p.z; f[o + 3] = p.yaw;
    for (let b = 0; b < 53; b++) {
      const a = 0.1 * (b + 1) * this.t;
      const q = o + CAP.QUAT + b * 4;
      f[q] = 0; f[q + 1] = Math.sin(a / 2); f[q + 2] = 0; f[q + 3] = Math.cos(a / 2);
    }
    f[o + CAP.PELVIS] = 0; f[o + CAP.PELVIS + 1] = 1.0 + p.jump; f[o + CAP.PELVIS + 2] = 0;
    for (let k = 0; k < 9; k++) f[o + CAP.EXPR + k] = Math.min(1, this.t * 0.01 * (k + 1));
    f[o + CAP.EYE] = 0.01; f[o + CAP.EYE + 1] = -0.01;
    f[o + CAP.VISIBLE] = 1;
    f[o + CAP.SPARE] = 0; f[o + CAP.SPARE + 1] = 0;
    return REPLAY.PLAYER_FLOATS;
  }
  applyBlend(f, oa, ob, alpha) {
    this.lastA = oa; this.lastB = ob; this.lastAlpha = alpha; this.blendCalls++;
    slerp4(f, oa + CAP.QUAT, f, ob + CAP.QUAT, alpha, this.blended, 0);
  }
}

const standAt = (x, z) => (t, r) => { r.x = x; r.z = z; r.yaw = 0; r.jump = 0; return r; };
// The dunker: runs from the right wing (5, −6) toward the rim, takeoff at T0 + 1.0, slam at T0 + 1.5.
const T0 = 10;
const dunkPath = (t, r) => {
  const u = Math.max(0, Math.min(1, (t - T0) / 1.5));
  r.x = 5 + (0.3 - 5) * u; r.z = -6 + (-12.3 + 6) * u; r.yaw = Math.atan2(-4.7, -6.3);
  const air = t - (T0 + 1.0);
  r.jump = air > 0 && air < 0.9 ? 0.9 * Math.sin(Math.PI * air / 0.9) : 0;
  return r;
};

function makeSix(firstPath) {
  const a = [new FakeAnimator(firstPath || dunkPath)];
  const spots = [[-5.4, -7.6], [5.4, -7.6], [0.5, -10.5], [-3.5, -8.5], [3.0, -10.0]];
  for (const [x, z] of spots) a.push(new FakeAnimator(standAt(x, z)));
  return a;
}

const ball = { position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, quaternion: { x: 0, y: 0, z: 0, w: 1, set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; } }, visible: true };

/** Records frames at `hz` from t0 to t1 (game time), moving the ball with the dunker's hands. */
function record(rec, anims, t0, t1, hz = 60) {
  const n = Math.round((t1 - t0) * hz);
  for (let i = 0; i <= n; i++) {
    const t = t0 + i / hz;
    for (const a of anims) a.t = t;
    const r = anims[0].path(t, anims[0].root);
    ball.position.set(r.x, 1.2 + r.jump + 0.8 * Math.max(0, Math.min(1, (t - T0 - 1.0) / 0.5)), r.z);
    rec.capture(t, anims, ball);
  }
}

// ---------------------------------------------------------------------------------------------------------- checks

check('layout: 1 + 6 × 233 + 8 = 1,407 floats per frame, Float32Array(240 × 1407) ≈ 1.35 MB, CAP offsets', () => {
  assert.equal(REPLAY.FRAME_FLOATS, 1407);
  const rec = new ReplayRecorder();
  assert.ok(rec.buf instanceof Float32Array);
  assert.equal(rec.buf.length, 240 * 1407);
  near(rec.buf.byteLength / 1e6, 1.35, 0.01);
  assert.deepEqual([CAP.ROOT, CAP.QUAT, CAP.PELVIS, CAP.EXPR, CAP.EYE, CAP.VISIBLE, CAP.SPARE], [0, 4, 216, 219, 228, 230, 231]);
  assert.equal(CAP.SPARE + 2, REPLAY.PLAYER_FLOATS);
});

check('ring wrap-around: 300 frames keep the newest 240 in order; ≤ 1 sample per 1/60 s; time reset clears', () => {
  const rec = new ReplayRecorder();
  const anims = makeSix();
  record(rec, anims, T0, T0 + 299 / 60);
  assert.equal(rec.count, 240);
  near(rec.oldest, T0 + 60 / 60, 1e-9);
  near(rec.newest, T0 + 299 / 60, 1e-9);
  for (let k = 1; k < rec.count; k++) assert.ok(rec.time(k) > rec.time(k - 1));
  // stored root x of the dunker in the oldest frame equals the path at that time
  const r = dunkPath(rec.oldest, {});
  near(rec.buf[rec.offset(0) + 1 + CAP.ROOT], r.x, 1e-5);
  near(rec.buf[rec.offset(0)], rec.oldest, 1e-3);                 // float32 copy of the time
  // 120 Hz rendering → one sample per 1/60 s
  const r2 = new ReplayRecorder();
  record(r2, anims, 0, 1, 120);
  assert.equal(r2.count, 61);
  // time going backwards (rematch) resets
  r2.capture(0.5, anims, ball);
  assert.equal(r2.count, 1);
  // suspended → nothing recorded
  r2.suspended = true;
  assert.equal(r2.capture(0.6, anims, ball), false);
});

check('bracketing: alpha between samples, clamps outside, binary search over the ring', () => {
  const rec = new ReplayRecorder();
  const anims = makeSix();
  record(rec, anims, T0, T0 + 299 / 60);
  const out = { a: 0, b: 0, ka: 0, kb: 0, alpha: 0 };
  const tq = rec.time(100) + 0.5 / 60;
  rec.bracket(tq, out);
  assert.equal(out.ka, 100); assert.equal(out.kb, 101);
  near(out.alpha, 0.5, 1e-6);
  assert.equal(out.a, rec.offset(100)); assert.equal(out.b, rec.offset(101));
  rec.bracket(rec.time(37), out);
  assert.equal(out.ka, 37); near(out.alpha, 0, 1e-9);
  rec.bracket(0, out); assert.equal(out.ka, 0); assert.equal(out.alpha, 0);
  rec.bracket(1e9, out); assert.equal(out.ka, 239);
});

check('slerp at α 0.5: identity ↔ 90° about y → 45°; shortest arc for a negated quaternion', () => {
  const s = Math.SQRT1_2;
  const a = new Float32Array([0, 0, 0, 1]), b = new Float32Array([0, s, 0, s]), o = new Float32Array(4);
  slerp4(a, 0, b, 0, 0.5, o, 0);
  near(o[1], Math.sin(Math.PI / 8), 1e-6); near(o[3], Math.cos(Math.PI / 8), 1e-6);
  const nb = new Float32Array([0, -s, 0, -s]);
  slerp4(a, 0, nb, 0, 0.5, o, 0);
  near(o[1], Math.sin(Math.PI / 8), 1e-6); near(o[3], Math.cos(Math.PI / 8), 1e-6);
  slerp4(a, 0, b, 0, 0, o, 0); near(o[3], 1, 1e-7);
  slerp4(a, 0, b, 0, 1, o, 0); near(o[1], s, 1e-7);
});

check('windows per kind (§6.4.6): dunk [slam − 1.15, + 0.35], jumper [release − 0.30, + 1.20], block/ankle [−1.0, +0.5]', () => {
  const w = {};
  replayWindow('dunk', 20, w); near(w.t0, 18.85, 1e-9); near(w.t1, 20.35, 1e-9);
  replayWindow('jumper', 20, w); near(w.t0, 19.7, 1e-9); near(w.t1, 21.2, 1e-9);
  replayWindow('block', 20, w); near(w.t0, 19.0, 1e-9); near(w.t1, 20.5, 1e-9);
  replayWindow('ankle', 20, w); near(w.t0, 19.0, 1e-9); near(w.t1, 20.5, 1e-9);
  for (const k of ['dunk', 'jumper', 'block']) { replayWindow(k, 0, w); near((w.t1 - w.t0) / REPLAY.RATE, 3.0, 1e-9); }
});

check('triggers: dunk anchored at SLAM; plain jumper none; off none; cooldown 45 s; max 6; winner exempt + deferred', () => {
  const world = { quarter: 2, gameClock: 100, score: [10, 8], players: ['kobe', 'jordan', 'lebron', 'giannis', 'yao', 'kyrie'].map((id) => ({ id })), time: 0 };
  const rec = new ReplayRecorder();
  const trig = new ReplayTriggers({ recorder: rec, world, quarterSec: 120 });
  trig.onGameEvent({ t: 11.0, playerId: 'kobe' }, 'takeoff');
  trig.onGameEvent({ t: 11.5, playerId: 'kobe' }, 'slam');
  let r = trig.onGameEvent({ t: 11.6, playerId: 'kobe', team: 0, kind: 'dunk', points: 2 }, 'score');
  assert.equal(r.start, true); assert.equal(r.kind, 'dunk'); assert.equal(r.focus, 0);
  near(r.window.anchor, 11.5, 1e-9); near(r.window.t0, 10.35, 1e-9); near(r.window.t1, 11.85, 1e-9);
  assert.equal(r.deferred, false);
  assert.equal(rec.evCount, 3);
  near(rec.lastEvent(EVT.takeoff, 0, 99, 0), 11.0, 1e-9);
  // plain jumper → none
  r = trig.onGameEvent({ t: 30, playerId: 'jordan', team: 1, kind: 'jumper', points: 2 }, 'score');
  assert.equal(r.start, false); assert.equal(r.reason, 'plain');
  // second dunk 20 s of game clock later → cooldown
  world.gameClock = 80;
  r = trig.onGameEvent({ t: 50, playerId: 'giannis', team: 0, kind: 'dunk', points: 2 }, 'score');
  assert.equal(r.start, false); assert.equal(r.reason, 'cooldown');
  // 46 s after the first → allowed (across the quarter boundary as well)
  world.quarter = 3; world.gameClock = 120 - 26;   // elapsed: (240 + 26) − (120 + 20) = 126 s
  r = trig.onGameEvent({ t: 70, playerId: 'giannis', team: 0, kind: 'dunk', points: 2 }, 'score');
  assert.equal(r.start, true); assert.equal(r.focus, 3);
  near(r.window.anchor, 70 - 0.05, 1e-9);           // no SLAM logged → score time − 0.05
  // max 6 per game
  for (let i = 0; i < 10; i++) { world.gameClock -= 0; world.quarter++; trig.onGameEvent({ t: 100 + i, playerId: 'yao', team: 1, kind: 'dunk', points: 2 }, 'score'); }
  assert.equal(trig.count, 6);
  r = trig.onGameEvent({ t: 300, playerId: 'yao', team: 1, kind: 'dunk', points: 2, winner: false }, 'score');
  assert.equal(r.reason, 'max');
  // mode off
  const t2 = new ReplayTriggers({ recorder: new ReplayRecorder(), world, mode: 'off' });
  assert.equal(t2.onGameEvent({ t: 1, playerId: 'kobe', kind: 'dunk', points: 2 }, 'score').start, false);
  // game-winner: exempt from the cooldown, deferred
  const t3 = new ReplayTriggers({ recorder: new ReplayRecorder(), world: { quarter: 4, gameClock: 1.0, score: [50, 49], players: world.players } });
  t3.onGameEvent({ t: 5, playerId: 'kobe', team: 0, kind: 'dunk', points: 2 }, 'score');
  t3.recorder.recordEvent(EVT.release, 9.0, 1);
  r = t3.onGameEvent({ t: 10, playerId: 'jordan', team: 1, kind: 'jumper', points: 3, winner: true }, 'score');
  assert.equal(r.start, true); assert.equal(r.winner, true); assert.equal(r.deferred, true); assert.equal(r.kind, 'jumper');
  near(r.window.anchor, 9.0, 1e-9);
});

check('triggers: clutch make that wins or ties in the last 3.0 s of Q4/OT, buzzer make; all-mode blocks/ankles', () => {
  const world = { quarter: 4, gameClock: 2.5, score: [50, 50], players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id })) };
  const mk = (mode) => new ReplayTriggers({ recorder: new ReplayRecorder(), world, mode });
  // tie: team 1 just scored 3 to reach 50-50 (before −3, after 0)
  assert.equal(mk('dunks').onGameEvent({ t: 1, playerId: 'd', team: 1, kind: 'jumper', points: 3 }, 'score').start, true);
  // still behind after the make → no
  world.score = [53, 51];
  assert.equal(mk('dunks').onGameEvent({ t: 1, playerId: 'd', team: 1, kind: 'jumper', points: 2 }, 'score').start, false);
  // already ahead before the make → not "wins or ties"
  world.score = [55, 50];
  assert.equal(mk('dunks').onGameEvent({ t: 1, playerId: 'a', team: 0, kind: 'jumper', points: 2 }, 'score').start, false);
  // 3.5 s left → no; Q3 → no
  world.score = [50, 50]; world.gameClock = 3.5;
  assert.equal(mk('dunks').onGameEvent({ t: 1, playerId: 'd', team: 1, kind: 'jumper', points: 2 }, 'score').start, false);
  world.gameClock = 1; world.quarter = 3;
  assert.equal(mk('dunks').onGameEvent({ t: 1, playerId: 'd', team: 1, kind: 'jumper', points: 2 }, 'score').start, false);
  // any make at a period buzzer
  assert.equal(mk('dunks').onGameEvent({ t: 1, playerId: 'd', team: 1, kind: 'jumper', points: 2, buzzer: true }, 'score').start, true);
  // OT counts as Q4+
  world.quarter = 5; world.gameClock = 2; world.score = [62, 61];
  assert.equal(mk('dunks').onGameEvent({ t: 1, playerId: 'a', team: 0, kind: 'jumper', points: 2 }, 'score').start, true);
  // blocks / ankles only in 'all'
  const blk = { t: 3, blockerId: 'c', shooterId: 'd', chaseDown: true };
  assert.equal(mk('dunks').onGameEvent(blk, 'block').start, false);
  const ra = mk('all').onGameEvent(blk, 'block');
  assert.equal(ra.start, true); assert.equal(ra.kind, 'block'); assert.equal(ra.focus, 2); assert.equal(ra.other, 3);
  near(ra.window.t0, 2.0, 1e-9); near(ra.window.t1, 3.5, 1e-9);
  assert.equal(mk('all').onGameEvent({ t: 3, blockerId: 'c', shooterId: 'd' }, 'block').start, false);   // plain block
  const an = mk('all').onGameEvent({ t: 4, playerId: 'a', defenderId: 'e' }, 'ankle');
  assert.equal(an.start, true); assert.equal(an.kind, 'ankle'); assert.equal(an.other, 4);
  // ball contacts are logged for the slow replay sounds
  const t4 = mk('dunks');
  t4.onGameEvent({ t: 7, what: 'rim', playerId: null }, 'ball');
  t4.onGameEvent({ t: 7.2, what: 'swish' }, 'ball');
  near(t4.recorder.lastEvent(EVT.rim, 0, 99), 7, 1e-9); near(t4.recorder.lastEvent(EVT.swish, 0, 99), 7.2, 1e-9);
});

/** Full dunk replay at 60 Hz; returns the per-frame log. */
function runDunkReplay(opts = {}) {
  const rec = new ReplayRecorder();
  const anims = makeSix();
  const world = { quarter: 2, gameClock: 90, score: [0, 0], players: [0, 1, 2, 3, 4, 5].map((i) => ({ id: 'p' + i })) };
  const trig = new ReplayTriggers({ recorder: rec, world });
  const player = new ReplayPlayer({ recorder: rec, animators: anims, ball, heights: [1.96, 1.96, 2.03, 2.09, 2.27, 1.87], tier: opts.tier || 'high' });
  const cues = [];
  let clock = 0;
  player.onCue = (name, a, b) => cues.push({ name, a, b, clock });
  // live play until the score, logging the events at their times
  record(rec, anims, T0 - 2, T0 + 1.0 - 1 / 60);
  trig.onGameEvent({ t: T0 + 1.0, playerId: 'p0' }, 'takeoff');
  record(rec, anims, T0 + 1.0, T0 + 1.5 - 1 / 60);
  trig.onGameEvent({ t: T0 + 1.5, playerId: 'p0' }, 'slam');
  record(rec, anims, T0 + 1.5, T0 + 1.6 - 1 / 60);
  const r = trig.onGameEvent({ t: T0 + 1.6, playerId: 'p0', team: 0, kind: 'dunk', points: 2 }, 'score');
  assert.equal(r.start, true);
  assert.equal(player.schedule(r), true);
  const log = [];
  const pose = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 0, lens: 0 };
  let gameT = T0 + 1.6;
  for (let i = 0; i < 60 * 6; i++) {
    const dt = 1 / 60;
    clock += dt;
    gameT += dt;
    if (opts.skipAt && Math.abs(clock - opts.skipAt) < 1e-9 + dt / 2) player.skip();
    player.update(dt);
    if (player.phase === 'playing' || player.phase === 'out') {
      player.apply();
      player.pose(pose, dt);
      log.push({ clock, active: player.active, tPlay: player.tPlay, playT: player.playT, ...pose, lod: Array.from(player.lod), pelvis: Array.from(player.pelvis), vis: Array.from(player.vis) });
    } else {
      for (const a of anims) a.t = gameT;
      rec.capture(gameT, anims, ball);
    }
    if (!player.busy) break;
  }
  return { rec, anims, player, cues, log, r };
}

check('player timeline: wipeIn 0.9 s, on 1.15 s, active 3.0 s at 0.5×, off 4.15 s, done 4.40 s; external + suspend', () => {
  const { cues, log, anims, rec, player } = runDunkReplay();
  const at = (n) => cues.find((c) => c.name === n);
  near(at('wipeIn').clock, 0.9, 1 / 60 + 1e-9);
  near(at('on').clock, 1.15, 1 / 60 + 1e-9);
  near(at('off').clock, 4.15, 1 / 60 + 1e-9);
  assert.equal(at('off').a, false);
  near(at('done').clock, 4.40, 1 / 60 + 1e-9);
  const activeFrames = log.filter((f) => f.active).length;
  near(activeFrames / 60, 3.0, 0.2);
  // 0.5× mapping: after 1 s on screen the replay shows window start + 0.5 s
  const f60 = log.find((f) => Math.abs(f.playT - 1.0) < 1e-6);
  near(f60.tPlay, T0 + 1.5 - 1.15 + 0.5, 1e-6);
  // events re-fire during playback (takeoff, slam, score) for the slow audio variants
  const evs = cues.filter((c) => c.name === 'event').map((c) => c.a);
  assert.ok(evs.includes(EVT.takeoff) && evs.includes(EVT.slam));
  // flags restored
  assert.equal(anims.every((a) => a.external === false), true);
  assert.equal(rec.suspended, false);
  assert.equal(player.busy, false);
  assert.deepEqual(Array.from(player.lod), [-1, -1, -1, -1, -1, -1]);
});

check('playback applies bracketing frames per player (slerp α) and lerps / slerps the ball', () => {
  const rec = new ReplayRecorder();
  const anims = makeSix();
  record(rec, anims, T0, T0 + 2);
  const player = new ReplayPlayer({ recorder: rec, animators: anims, ball });
  const r = { start: true, kind: 'dunk', focus: 0, other: -1, deferred: false, t: T0 + 1.6, window: { t0: T0 + 0.35, t1: T0 + 1.85, anchor: T0 + 1.5 } };
  player.schedule(r);
  player.update(1.15);                 // → on
  assert.equal(player.active, true);
  player.update(0.5 / 60 / REPLAY.RATE * 1.0);   // advance half a frame of game time
  player.apply();
  const a = anims[0];
  near(a.lastAlpha, 0.5, 1e-3);
  assert.equal(a.lastB - a.lastA === REPLAY.FRAME_FLOATS || a.lastB < a.lastA, true);
  // bone 0 slerped halfway between the two samples' angles (rotation about y by 0.1·t)
  const tMid = player.tPlay;
  near(2 * Math.atan2(a.blended[1], a.blended[3]), 0.1 * tMid, 2e-4);
  // ball position lerped between the samples; the replayed ball has a velocity for the net sim
  const out = { a: 0, b: 0, ka: 0, kb: 0, alpha: 0 };
  rec.bracket(tMid, out);
  const bx = rec.buf[out.a + 1 + 6 * 233], bx2 = rec.buf[out.b + 1 + 6 * 233];
  near(ball.position.x, bx + (bx2 - bx) * out.alpha, 1e-5);
  assert.ok(Math.hypot(player.ball.vel.x, player.ball.vel.z) > 1);
  assert.equal(anims.every((x) => x.external), true);
  assert.equal(rec.suspended, true);
});

check('dunk camera: r 3.6 orbit starting 60° to the camera side, sweeping 50°, height 1.2 → 2.2, fov 32, constraints', () => {
  const { log } = runDunkReplay();
  const act = log.filter((f) => f.active);
  for (const f of act) {
    assert.ok(f.pz >= -12.0 - 1e-9, `z ${f.pz}`);
    assert.ok(f.py >= 0.8 - 1e-9, `y ${f.py}`);
    for (let i = 0; i < 6; i++) {
      if (!f.vis[i]) continue;
      const d = Math.hypot(f.px - f.pelvis[i * 3], f.py - f.pelvis[i * 3 + 1], f.pz - f.pelvis[i * 3 + 2]);
      assert.ok(d >= 0.9 - 1e-6, `pelvis ${i} at ${d}`);
    }
    assert.equal(f.fov, 32);
  }
  near(act[0].py, 1.2, 0.05);
  near(act[act.length - 1].py, 2.2, 0.05);
  // the first camera position is on the +z (broadcast) side of the dunker's path
  const first = act[0];
  assert.ok(first.pz > first.pelvis[2], 'camera side');
  // the azimuth swept ≈ 50° around the (moving) subject
  const az = (f) => Math.atan2(f.px - f.pelvis[0], f.pz - f.pelvis[2]) * 180 / Math.PI;
  const sweep = Math.abs(az(act[act.length - 1]) - az(act[0]));
  assert.ok(sweep > 35 && sweep < 65, `sweep ${sweep}`);
  // LOD rule (high): LOD0 within 7 m of the camera, others 1
  const f = act[60];
  for (let i = 0; i < 6; i++) {
    const d = Math.hypot(f.px - f.pelvis[i * 3], f.py - f.pelvis[i * 3 + 1], f.pz - f.pelvis[i * 3 + 2]);
    assert.equal(f.lod[i], d <= 7 ? 0 : 1);
  }
});

check('jumper camera: behind the shooter at 1.9 m over the shoulder, then the rim cam on the far side, fov 35 → 28', () => {
  const rec = new ReplayRecorder();
  const shooter = (t, r) => { r.x = 5.4; r.z = -7.6; r.yaw = Math.atan2(-5.4, -5.15); r.jump = 0; return r; };
  const anims = makeSix(shooter);
  record(rec, anims, T0, T0 + 3);
  const player = new ReplayPlayer({ recorder: rec, animators: anims, ball, tier: 'medium' });
  player.schedule({ start: true, kind: 'jumper', focus: 0, other: -1, deferred: false, t: T0 + 2, window: { t0: T0 + 0.7, t1: T0 + 2.2, anchor: T0 + 1.0 } });
  player.update(1.15);
  const p = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 0, lens: 0 };
  player.apply(); player.pose(p, 1 / 60);
  const dRim = Math.hypot(RIM.x - 5.4, RIM.z + 7.6);
  near(Math.hypot(RIM.x - p.px, RIM.z - p.pz), Math.hypot(dRim + 2.8, 0.45), 0.05);
  near(p.py, 1.9, 1e-6); assert.equal(p.fov, 35);
  assert.deepEqual([p.lx, p.ly, p.lz], [RIM.x, RIM.y, RIM.z]);
  for (let i = 0; i < 100; i++) { player.update(1 / 60); player.apply(); player.pose(p, 1 / 60); }   // past 55 %
  near(p.px, RIM.x - 2.4, 1e-9); near(p.py, 3.8, 1e-9); near(p.pz, RIM.z + 3.0, 1e-9);
  assert.ok(p.fov < 35 && p.fov > 28);
  // medium LOD: the 2 nearest at 0, the rest 1
  assert.equal(Array.from(player.lod).filter((x) => x === 0).length, 2);
  assert.equal(Array.from(player.lod).filter((x) => x === 1).length, 4);
});

check('block camera: side-on 5 m from the shot line at 1.6 m, fov 30, tracking the ball, on the +z side', () => {
  const rec = new ReplayRecorder();
  const anims = makeSix(standAt(-1.0, -10.0));     // focus = blocker
  record(rec, anims, T0, T0 + 3);
  const player = new ReplayPlayer({ recorder: rec, animators: anims, ball, tier: 'low' });
  // shooter = index 3 at (0.5, −10.5)
  player.schedule({ start: true, kind: 'block', focus: 0, other: 3, deferred: false, t: T0 + 2, window: { t0: T0 + 1.0, t1: T0 + 2.5, anchor: T0 + 2 } });
  player.update(1.15);
  const p = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 0, lens: 0 };
  player.apply(); player.pose(p, 1 / 60);
  assert.equal(p.fov, 30); near(p.py, 1.6, 1e-6);
  // distance from the shot line (shooter → rim) is 5 m (unless a constraint pushed it)
  const sx = 0.5, sz = -10.5, dx = RIM.x - sx, dz = RIM.z - sz, L = Math.hypot(dx, dz);
  const dist = Math.abs((p.px - sx) * dz - (p.pz - sz) * dx) / L;
  near(dist, 5, 0.05);
  assert.ok(p.pz >= -12);
  near(p.lx, ball.position.x, 0.3);
  // low LOD: LOD1 for the 2 nearest only
  assert.deepEqual(Array.from(player.lod).filter((x) => x === 1).length, 2);
  assert.deepEqual(Array.from(player.lod).filter((x) => x === -1).length, 4);
});

check('skip: 0.15 s wipe-out during playback; silent cancel before the wipe-in; deferred winner waits for begin()', () => {
  const { cues } = runDunkReplay({ skipAt: 2.0 });
  const off = cues.find((c) => c.name === 'off');
  assert.equal(off.a, true);
  near(off.clock, 2.0, 1e-6);
  near(cues.find((c) => c.name === 'done').clock - off.clock, 0.15, 1 / 60 + 1e-9);
  const c2 = runDunkReplay({ skipAt: 0.5 }).cues;
  assert.deepEqual(c2.map((c) => c.name), ['cancel']);
  // skip during the wipe-in (0.9 – 1.15 s): fast wipe-out, playback never starts, no pose is applied
  const w = runDunkReplay({ skipAt: 1.0 });
  assert.deepEqual(w.cues.map((c) => c.name), ['wipeIn', 'off', 'done']);
  assert.equal(w.cues[1].a, true);
  assert.equal(w.anims[0].blendCalls, 0);
  // deferred (game-winner): armed, the ring stops at the window end, begin() → wipeIn now, on after 0.25 s
  const rec = new ReplayRecorder();
  const anims = makeSix();
  record(rec, anims, T0, T0 + 1.6);
  const player = new ReplayPlayer({ recorder: rec, animators: anims, ball });
  const names = [];
  player.onCue = (n) => names.push(n);
  player.schedule({ start: true, kind: 'dunk', focus: 0, other: -1, deferred: true, t: T0 + 1.6, window: { t0: T0 + 0.35, t1: T0 + 1.85, anchor: T0 + 1.5 } });
  assert.equal(player.phase, 'armed');
  record(rec, anims, T0 + 1.6 + 1 / 60, T0 + 5);   // after the window end the recorder holds
  assert.ok(rec.newest >= T0 + 1.85 && rec.newest < T0 + 1.85 + 2 / 60, `newest ${rec.newest}`);
  player.update(10);
  assert.equal(player.phase, 'armed');
  player.begin();
  assert.deepEqual(names, ['wipeIn']);
  player.update(0.26);
  assert.equal(player.active, true);
  near(player.t0, T0 + 0.35, 1e-9);
});

check('replayLod rule per tier (§7.4)', () => {
  const pos = new Float32Array([0, 1, 0, 3, 1, 0, 6, 1, 0, 9, 1, 0, 12, 1, 0, 1, 1, 0]);
  const vis = new Uint8Array([1, 1, 1, 1, 1, 1]);
  const out = new Int8Array(6);
  assert.deepEqual(Array.from(replayLod('high', 0, 1, 0, pos, vis, out)), [0, 0, 0, 1, 1, 0]);
  assert.deepEqual(Array.from(replayLod('medium', 0, 1, 0, pos, vis, out)), [0, 1, 1, 1, 1, 0]);
  assert.deepEqual(Array.from(replayLod('low', 0, 1, 0, pos, vis, out)), [1, -1, -1, -1, -1, 1]);
});

check('no Float32Array (or Float64Array) constructed after init: capture, triggers, schedule, update, apply, pose', () => {
  const rec = new ReplayRecorder();
  const anims = makeSix();
  const world = { quarter: 2, gameClock: 90, score: [0, 0], players: [0, 1, 2, 3, 4, 5].map((i) => ({ id: 'p' + i })) };
  const trig = new ReplayTriggers({ recorder: rec, world });
  const player = new ReplayPlayer({ recorder: rec, animators: anims, ball, tier: 'high' });
  const pose = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 0, lens: 0 };
  const ev = { t: 0, playerId: 'p0', team: 0, kind: 'dunk', points: 2 };
  const F32 = globalThis.Float32Array, F64 = globalThis.Float64Array;
  let made = 0;
  const trap = { construct(T, args) { made++; return Reflect.construct(T, args); } };
  globalThis.Float32Array = new Proxy(F32, trap);
  globalThis.Float64Array = new Proxy(F64, trap);
  try {
    let t = T0;
    for (let i = 0; i < 300; i++) { t += 1 / 60; for (const a of anims) a.t = t; rec.capture(t, anims, ball); }
    ev.t = t;
    trig.onGameEvent(ev, 'slam');
    const r = trig.onGameEvent(ev, 'score');
    player.schedule(r);
    for (let i = 0; i < 300 && player.busy; i++) {
      player.update(1 / 60);
      if (player.phase === 'playing' || player.phase === 'out') { player.apply(); player.pose(pose, 1 / 60); } else { t += 1 / 60; rec.capture(t, anims, ball); }
    }
    assert.equal(player.busy, false);
  } finally {
    globalThis.Float32Array = F32;
    globalThis.Float64Array = F64;
  }
  assert.equal(made, 0);
});

console.log(`\n${passed} checks passed`);
