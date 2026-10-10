/**
 * @module cam/shots
 * Scripted camera shots of v2 (SPEC-v2 §6.4.4 intro, §6.4.5 title / lineup / pause / halftime / game over; PR §4.4,
 * §4.5) and the intro timeline runner. Everything here is pure maths on plain pose objects
 * {px, py, pz, lx, ly, lz, fov, lens} (degrees for fov, NDC for the portrait lens shift); the Director (director.js)
 * eases between poses and writes them into the one PerspectiveCamera.
 *
 * Exports
 *   POSE helpers: makePose(), setPose(out, …), copyPose(dst, src), lerpPose(out, a, b, t), easeInOutCubic(u),
 *     easeOutCubic(u), fitWidth(out, aspect, halfW, fovMax), bandFit(cy, y0, y1, b0, b1, lens, fovDeg, out)
 *   Spots (world metres, yaw = Object3D.rotation.y; yaw 0 faces +z toward the broadcast side):
 *     INTRO_SPOTS {a:[3], b:[3]}, MATCHUP_SPOTS {a:[3], b:[3]}, TITLE_SPOTS [6] (a0 a1 a2 b0 b1 b2),
 *     LINEUP_SPOTS [6], legendHeight(id)
 *   Shots: titleShot(t, aspect, out), lineupShot(p, aspect, out), pauseShot(t, out), pauseRenderHz(t),
 *     halftimeShot(t, aspect, out), gameoverShot(t, subject, aspect, out), INTRO, introShots(lineup, opts),
 *     class IntroTimeline, class Turntable, SHOTS (constants)
 *
 * Portrait handling: the spec gives landscape cameras for the group shots; in portrait (aspect < 1) `fitWidth` first
 * widens the fov (up to a per-shot cap) and then dollies back along the view axis so the named half-width stays inside
 * the frame. No allocation per frame (H10): every runtime path writes into caller-owned or module scratch objects.
 */
import { LEGENDS } from '../legends.js';

const DEG = Math.PI / 180;

/** Shot constants (§6.4.4, §6.4.5). Positions/looks are world metres, fov degrees, times seconds. */
export const SHOTS = Object.freeze({
  TITLE: Object.freeze({ pos: [0, 0.9, 6.0], look: [0, 1.25, -4], fov: 38, pivot: [0, 1.2, -4], orbitDeg: 12, orbitDegPerS: 3, lensPortrait: 0.10, halfW: 3.45, fovMax: 60 }),
  LINEUP: Object.freeze({ pos: [0, 1.6, 2.5], look: [0, 1.2, -7], fov: 40, halfW: 4.8, fovMax: 60 }),
  FOCUS: Object.freeze({ up: 1.35, lookUp: 1.15, fov: 30, halfDeg: 15, extra: 0.35, lensPortrait: 0.30, halfW: 0.6, fovMax: 50,
    // portrait: feet − 0.05 … head + 0.12 inside the lineup stage band NDC [−0.10, 0.88] (top bar above, cards below)
    bandLo: -0.10, bandHi: 0.88, footPad: 0.05, headPad: 0.12 }),
  PAUSE: Object.freeze({ pos: [9, 5.5, 3], look: [0, 1.5, -8], fov: 40, ease: 0.6, drift: 0.12, driftS: 8 }),
  HALFTIME: Object.freeze({ pos: [0, 14, 12], look: [0, 0, -8], fov: 46, panFrom: -3, panTo: 3, panS: 6, halfW: 6.0, fovMax: 70 }),
  GAMEOVER: Object.freeze({ hold: 1.0, r: 3.2, y: 1.5, degPerS: 12, fov: 32, chest: 0.72, lensPortrait: 0.30,
    // portrait: the MVP stands in the top 38 % of the screen above the box score (NDC [0.30, 0.94]) at fov 60
    fovPortrait: 60, bandLo: 0.30, bandHi: 0.94, headPad: 0.15 }),
  TURNTABLE: Object.freeze({ idleDegPerS: 20, degPerPx: 0.5, decay: 4, resumeS: 3, rampS: 0.5 }),
});

// ------------------------------------------------------------------------------------------------------ pose helpers

/** New pose object (allocates; for construction only). */
export function makePose() { return { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: -1, fov: 42, lens: 0 }; }

/** Writes a pose. */
export function setPose(out, px, py, pz, lx, ly, lz, fov, lens = 0) {
  out.px = px; out.py = py; out.pz = pz; out.lx = lx; out.ly = ly; out.lz = lz; out.fov = fov; out.lens = lens;
  return out;
}

/** dst ← src. */
export function copyPose(dst, src) {
  dst.px = src.px; dst.py = src.py; dst.pz = src.pz; dst.lx = src.lx; dst.ly = src.ly; dst.lz = src.lz;
  dst.fov = src.fov; dst.lens = src.lens;
  return dst;
}

/** out ← a + (b − a)·t, component-wise (position, look, fov, lens). */
export function lerpPose(out, a, b, t) {
  out.px = a.px + (b.px - a.px) * t; out.py = a.py + (b.py - a.py) * t; out.pz = a.pz + (b.pz - a.pz) * t;
  out.lx = a.lx + (b.lx - a.lx) * t; out.ly = a.ly + (b.ly - a.ly) * t; out.lz = a.lz + (b.lz - a.lz) * t;
  out.fov = a.fov + (b.fov - a.fov) * t; out.lens = a.lens + (b.lens - a.lens) * t;
  return out;
}

/** Cubic ease-in-out on [0, 1] (the Director's 'ease' transition curve, §6.4.1). */
export function easeInOutCubic(u) {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return x < 0.5 ? 4 * x * x * x : 1 - 4 * (1 - x) * (1 - x) * (1 - x);
}

/** Cubic ease-out on [0, 1]. */
export function easeOutCubic(u) {
  const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
  const r = 1 - x;
  return 1 - r * r * r;
}

/**
 * Keeps `halfW` metres either side of the look point inside the frame horizontally. The horizontal half-angle of a
 * perspective camera is atan(tan(fov/2)·aspect); if that covers less than halfW at the camera→look distance D, the fov
 * is raised (≤ fovMax) and then, if still short, the camera dollies back along look→camera until
 * D' = halfW / (tan(fov/2)·aspect). Landscape frames normally pass unchanged.
 */
export function fitWidth(out, aspect, halfW, fovMax) {
  if (!(halfW > 0) || !(aspect > 0)) return out;
  const dx = out.px - out.lx, dy = out.py - out.ly, dz = out.pz - out.lz;
  const D = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (D < 1e-6) return out;
  const need = halfW / D;                                      // required tan(horizontal half-angle)
  let t = Math.tan(out.fov * DEG * 0.5) * aspect;
  if (t >= need) return out;
  const fovNeed = 2 * Math.atan(need / aspect) / DEG;
  const cap = fovMax > out.fov ? fovMax : out.fov;
  out.fov = fovNeed < cap ? fovNeed : cap;
  t = Math.tan(out.fov * DEG * 0.5) * aspect;
  if (t >= need - 1e-9) return out;
  const s = (halfW / t) / D;                                   // dolly factor along look→camera
  out.px = out.lx + dx * s; out.py = out.ly + dy * s; out.pz = out.lz + dz * s;
  return out;
}

const BAND = { D: 0, ly: 0 };

/**
 * Vertical band fit for a camera at height `cy`: finds the horizontal distance D to the subject and the look height
 * `ly` (on the subject's vertical) so that the subject's range [y0, y1] lands on NDC [b0, b1] after a lens shift
 * `lens`, at vertical fov `fovDeg`. A point at height Y seen from distance D sits at angle a = atan((Y − cy)/D); with
 * the optical axis pitched by φ its NDC is tan(a − φ)/tan(fov/2) + lens. The subject's angular extent
 * a(y1) − a(y0) must equal K = atan(B1) − atan(B0) (Bk = (bk − lens)·tan(fov/2)); that extent shrinks monotonically
 * with D, so D is found by bisection, then φ = a(y1) − atan(B1). Writes {D, ly} into `out` (module scratch default).
 */
export function bandFit(cy, y0, y1, b0, b1, lens, fovDeg, out = BAND) {
  const T = Math.tan(fovDeg * DEG * 0.5);
  const B0 = (b0 - lens) * T, B1 = (b1 - lens) * T;
  const K = Math.atan(B1) - Math.atan(B0);
  let lo = 0.2, hi = 80;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi);
    if (Math.atan((y1 - cy) / mid) - Math.atan((y0 - cy) / mid) > K) lo = mid; else hi = mid;
  }
  const D = 0.5 * (lo + hi);
  const phi = Math.atan((y1 - cy) / D) - Math.atan(B1);
  out.D = D;
  out.ly = cy + D * Math.tan(phi);
  return out;
}

// ------------------------------------------------------------------------------------------------------------ spots

function spot(x, z, yaw) { return Object.freeze({ x, z, yaw }); }
/** Yaw (rotation.y) that turns a character at (x, z) to face the point (tx, tz); +z forward. */
function faceYaw(x, z, tx, tz) { return Math.atan2(tx - x, tz - z); }

/** Intro spots (§6.4.4): team A x −4.2, −2.8, −1.4; team B 1.4, 2.8, 4.2; z −6.0 facing +z. Index = lineup slot. */
export const INTRO_SPOTS = Object.freeze({
  a: Object.freeze([spot(-4.2, -6.0, 0), spot(-2.8, -6.0, 0), spot(-1.4, -6.0, 0)]),
  b: Object.freeze([spot(1.4, -6.0, 0), spot(2.8, -6.0, 0), spot(4.2, -6.0, 0)]),
});

/**
 * Matchup spots (§6.4.4 shot 8, PR §4.4): two rows of three facing each other — team A at x −2.4 / −1.2 / 0, z −4.4;
 * team B mirrored (x 0 / 1.2 / 2.4) at z −6.0. Each player faces the centroid of the other row, which turns both rows
 * three-quarter to the matchup camera at (0, 1.7, 3.0).
 */
export const MATCHUP_SPOTS = (() => {
  const ax = [-2.4, -1.2, 0], bx = [0, 1.2, 2.4];
  const az = -4.4, bz = -6.0, acx = -1.2, bcx = 1.2;
  return Object.freeze({
    a: Object.freeze(ax.map((x) => spot(x, az, faceYaw(x, az, bcx, bz)))),
    b: Object.freeze(bx.map((x) => spot(x, bz, faceYaw(x, bz, acx, az)))),
  });
})();

/**
 * Title arc (§6.4.5): the six 1.25 m apart around z −4 (team A left, team B right), a shallow arc whose ends come
 * forward (z = −4 + 0.05·x²) so every legend is ≈ 10 m from the camera, each turned to face the camera position.
 */
export const TITLE_SPOTS = Object.freeze([0, 1, 2, 3, 4, 5].map((i) => {
  const x = -3.125 + 1.25 * i;
  const z = -4 + 0.05 * x * x;
  return spot(x, z, faceYaw(x, z, SHOTS.TITLE.pos[0], SHOTS.TITLE.pos[2]));
}));

/** Lineup overview spots (§6.4.5): x −4.2, −2.8, −1.4, 1.4, 2.8, 4.2 at z −7, facing the lineup camera. */
export const LINEUP_SPOTS = Object.freeze([-4.2, -2.8, -1.4, 1.4, 2.8, 4.2].map((x) => spot(x, -7, faceYaw(x, -7, 0, 2.5))));

/** Barefoot height of a legend (m) from legends.js (§2.2; equals Character.dims.heightBarefoot ± 0.02). */
export function legendHeight(id) {
  const l = LEGENDS[id];
  return l && l.stats && l.stats.barefootM > 0 ? l.stats.barefootM : 2.0;
}

// -------------------------------------------------------------------------------------------------------- shots

/**
 * Title (§6.4.5): (0, 0.9, 6.0) look (0, 1.25, −4) fov 38, orbiting ±12° about (0, 1.2, −4) at 3°/s ping-pong
 * (θ = 12°·sin(t·3/12): peak angular speed 3°/s, turning smoothly at the ends). Portrait lens 0.10 + width fit.
 */
export function titleShot(t, aspect, out) {
  const S = SHOTS.TITLE;
  const th = S.orbitDeg * Math.sin(t * (S.orbitDegPerS / S.orbitDeg)) * DEG;
  // Orbit the camera about the pivot in the xz plane (radius = pivot→camera horizontal distance).
  const rx = S.pos[0] - S.pivot[0], rz = S.pos[2] - S.pivot[2];
  const c = Math.cos(th), s = Math.sin(th);
  setPose(out, S.pivot[0] + rx * c + rz * s, S.pos[1], S.pivot[2] - rx * s + rz * c,
    S.look[0], S.look[1], S.look[2], S.fov, aspect < 1 ? S.lensPortrait : 0);
  if (aspect < 1) fitWidth(out, aspect, S.halfW, S.fovMax);
  return out;
}

/**
 * Lineup (§6.4.5). Overview (landscape): (0, 1.6, 2.5) look (0, 1.2, −7) fov 40. Focus (portrait always; landscape
 * after a tap): camera player + (0, 1.35, d), look player + (0, 1.15, 0), fov 30, d = (h + 0.35)/(2·tan 15°)
 * (Yao 4.9 m, Kyrie 4.1 m), portrait lens 0.30.
 * @param {{focus?:{x:number,z:number}|null, h?:number}} p focus position (null = overview) and barefoot height
 */
export function lineupShot(p, aspect, out) {
  if (p && p.focus) {
    const F = SHOTS.FOCUS;
    const h = p.h > 0 ? p.h : 2.0;
    const d = (h + F.extra) / (2 * Math.tan(F.halfDeg * DEG));
    const x = p.focus.x, z = p.focus.z;
    if (aspect < 1) {
      // The spec's d frames exactly h + 0.35 over the whole screen; with the 0.30 lens shift the head would leave the
      // top edge, and the portrait stage is only the upper part of the screen. Keep camera height, fov and lens, and
      // solve the distance / look height so the whole body fits the stage band.
      const b = bandFit(F.up, -F.footPad, h + F.headPad, F.bandLo, F.bandHi, F.lensPortrait, F.fov);
      setPose(out, x, F.up, z + b.D, x, b.ly, z, F.fov, F.lensPortrait);
      fitWidth(out, aspect, F.halfW, F.fovMax);
      return out;
    }
    setPose(out, x, F.up, z + d, x, F.lookUp, z, F.fov, 0);
    return out;
  }
  const L = SHOTS.LINEUP;
  setPose(out, L.pos[0], L.pos[1], L.pos[2], L.look[0], L.look[1], L.look[2], L.fov, 0);
  fitWidth(out, aspect, L.halfW, L.fovMax);
  return out;
}

/**
 * Pause (§6.4.5): (9, 5.5, 3) look (0, 1.5, −8) fov 40 (the Director eases 0.6 s into it), then a drift of +0.12 m/s
 * in x for 8 s. `t` = seconds since the pause began.
 */
export function pauseShot(t, out) {
  const P = SHOTS.PAUSE;
  const u = t - P.ease;
  const drift = P.drift * (u <= 0 ? 0 : u >= P.driftS ? P.driftS : u);
  return setPose(out, P.pos[0] + drift, P.pos[1], P.pos[2], P.look[0], P.look[1], P.look[2], P.fov, 0);
}

/** Render rate during pause (§6.4.5): 60 Hz while easing in, 30 Hz during the 8 s drift, then 0 (frozen canvas). */
export function pauseRenderHz(t) {
  const P = SHOTS.PAUSE;
  if (t < P.ease) return 60;
  return t < P.ease + P.driftS ? 30 : 0;
}

/** Halftime (§6.4.5): (0, 14, 12) look (0, 0, −8) fov 46, pan x −3 → +3 over 6 s (cubic in-out, then hold). */
export function halftimeShot(t, aspect, out) {
  const H = SHOTS.HALFTIME;
  const x = H.panFrom + (H.panTo - H.panFrom) * easeInOutCubic(t / H.panS);
  setPose(out, H.pos[0] + x, H.pos[1], H.pos[2], H.look[0] + x, H.look[1], H.look[2], H.fov, 0);
  if (aspect < 1) fitWidth(out, aspect, H.halfW, H.fovMax);
  return out;
}

/**
 * Game-over orbit (§6.4.5) after the 1.0 s broadcast hold (the Director applies the hold): orbit the MVP at r 3.2 m,
 * height 1.5 m, 12°/s, fov 32, look at the chest (0.72·h); portrait lens 0.30. The orbit starts in front of him
 * (azimuth = his yaw) so the first frame shows his face. `t` = seconds since the orbit started.
 * @param {{x:number, z:number, yaw?:number, h?:number}} subject
 */
export function gameoverShot(t, subject, aspect, out) {
  const G = SHOTS.GAMEOVER;
  const h = subject && subject.h > 0 ? subject.h : 2.0;
  const sx = subject ? subject.x : 0, sz = subject ? subject.z : -6;
  const a = (subject && typeof subject.yaw === 'number' ? subject.yaw : 0) + G.degPerS * DEG * t;
  if (aspect < 1) {
    // portrait: the MVP must stand in the top 38 % above the box-score panel; r 3.2 at fov 32 cannot hold a 2 m body
    // there, so the orbit radius and look height come from the band fit at fov 60 (camera height kept at 1.5 m).
    const b = bandFit(G.y, 0, h + G.headPad, G.bandLo, G.bandHi, G.lensPortrait, G.fovPortrait);
    return setPose(out, sx + b.D * Math.sin(a), G.y, sz + b.D * Math.cos(a), sx, b.ly, sz, G.fovPortrait, G.lensPortrait);
  }
  return setPose(out, sx + G.r * Math.sin(a), G.y, sz + G.r * Math.cos(a), sx, G.chest * h, sz, G.fov, 0);
}

// ------------------------------------------------------------------------------------------------------------ intro

/** Intro constants (§6.4.4). */
export const INTRO = Object.freeze({
  CRANE: Object.freeze({ from: [-14, 11, 14], to: [-6, 6.5, 8], lookFrom: [0, 1, -6], lookTo: [0, 1.2, -7], fovFrom: 50, fovTo: 42, dur: 2.5, durShort: 1.5 }),
  LEGEND: Object.freeze({ dur: 1.6, durLebron: 3.2, side: 0.35, camH: 0.72, lookH: 0.80, dFrom: 3.2, dTo: 2.6, fov: 28, orbitDeg: 8, halfW: 0.6, fovMax: 56 }),
  TEAM: Object.freeze({ dur: 0.75, dist: 5.2, camY: 1.5, lookY: 1.15, fov: 36, halfW: 2.3, fovMax: 60 }),
  MATCHUP: Object.freeze({ pos: [0, 1.7, 3.0], look: [0, 1.4, -5], fov: 44, dur: 2.0, durShort: 1.5, halfW: 3.4, fovMax: 64 }),
  FULL_S: 15.7, SHORT_S: 4.5,
});

/**
 * Builds the intro shot list (called once per game; allocates).
 * Full (≈ 15.7 s): crane 2.5 s → one shot per legend, team A (★ = lineup.a[0] first) then team B, 1.6 s each
 * (LeBron 3.2 s for his chalk toss) → matchup 2.0 s. Short (4.5 s): crane 1.5 s → one 0.75 s team card per team →
 * matchup 1.5 s. 'off' → [].
 * Shot objects: {kind: 'crane'|'legend'|'team'|'matchup', dur, start, id?, team (0 = a, 1 = b, −1), slot, first,
 * spot {x, z, yaw}, h, chestY}; flow reacts to each start cue (spot light at (spot.x, chestY, spot.z), lower-third,
 * jumbotron 'intro', showcase loop, "boom").
 * @param {{a:string[], b:string[]}} lineup
 * @param {{variant?:'full'|'short'|'off', heights?:Object<string,number>}} [opts]
 */
export function introShots(lineup, opts = {}) {
  const variant = opts.variant || 'full';
  const shots = [];
  if (variant === 'off' || !lineup) return shots;
  const hOf = (id) => (opts.heights && opts.heights[id] > 0 ? opts.heights[id] : legendHeight(id));
  const short = variant === 'short';
  shots.push({ kind: 'crane', dur: short ? INTRO.CRANE.durShort : INTRO.CRANE.dur, id: null, team: -1, slot: -1, first: false, spot: null, h: 0, chestY: 0, start: 0 });
  const teams = ['a', 'b'];
  if (short) {
    for (let t = 0; t < 2; t++) {
      const sp = INTRO_SPOTS[teams[t]][1];      // the middle spot = the team's centre
      shots.push({ kind: 'team', dur: INTRO.TEAM.dur, id: null, team: t, slot: -1, first: true, spot: sp, h: 0, chestY: 1.4, start: 0 });
    }
  } else {
    for (let t = 0; t < 2; t++) {
      const ids = lineup[teams[t]] || [];
      for (let i = 0; i < 3; i++) {
        const id = ids[i];
        if (!id) continue;
        const h = hOf(id);
        shots.push({
          kind: 'legend', dur: id === 'lebron' ? INTRO.LEGEND.durLebron : INTRO.LEGEND.dur, id, team: t, slot: i,
          first: i === 0, spot: INTRO_SPOTS[teams[t]][i], h, chestY: INTRO.LEGEND.camH * h, start: 0,
        });
      }
    }
  }
  shots.push({ kind: 'matchup', dur: short ? INTRO.MATCHUP.durShort : INTRO.MATCHUP.dur, id: null, team: -1, slot: -1, first: false, spot: null, h: 0, chestY: 1.4, start: 0 });
  let t = 0;
  for (const s of shots) { s.start = t; t += s.dur; }
  return shots;
}

/** Camera pose of one intro shot at local time `u` seconds. Pure. */
export function introShotPose(shot, u, aspect, out) {
  const k = shot.dur > 0 ? u / shot.dur : 1;
  if (shot.kind === 'crane') {
    const C = INTRO.CRANE;
    const e = easeInOutCubic(k);
    setPose(out,
      C.from[0] + (C.to[0] - C.from[0]) * e, C.from[1] + (C.to[1] - C.from[1]) * e, C.from[2] + (C.to[2] - C.from[2]) * e,
      C.lookFrom[0] + (C.lookTo[0] - C.lookFrom[0]) * e, C.lookFrom[1] + (C.lookTo[1] - C.lookFrom[1]) * e,
      C.lookFrom[2] + (C.lookTo[2] - C.lookFrom[2]) * e, C.fovFrom + (C.fovTo - C.fovFrom) * e, 0);
    return out;
  }
  if (shot.kind === 'legend') {
    const L = INTRO.LEGEND;
    const sp = shot.spot, h = shot.h;
    const d = L.dFrom + (L.dTo - L.dFrom) * easeOutCubic(k);
    // p = player + R(yaw + θ)·(0.35, 0.72h, d); θ sweeps the 8° orbit left → right (−4° → +4°) linearly.
    // R(a) is three's rotation about +y: local (x, z) → world (x·cos a + z·sin a, −x·sin a + z·cos a).
    const a = sp.yaw + (k - 0.5) * L.orbitDeg * DEG;
    const c = Math.cos(a), s = Math.sin(a);
    setPose(out, sp.x + L.side * c + d * s, L.camH * h, sp.z - L.side * s + d * c,
      sp.x, L.lookH * h, sp.z, L.fov, 0);
    if (aspect < 1) fitWidth(out, aspect, L.halfW, L.fovMax);
    return out;
  }
  if (shot.kind === 'team') {
    const T = INTRO.TEAM;
    const sp = shot.spot;
    // a slow 0.3 m push-in over the card keeps the frame alive
    const d = T.dist - 0.3 * easeOutCubic(k);
    setPose(out, sp.x, T.camY, sp.z + d, sp.x, T.lookY, sp.z, T.fov, 0);
    fitWidth(out, aspect, T.halfW, T.fovMax);
    return out;
  }
  const M = INTRO.MATCHUP;
  setPose(out, M.pos[0], M.pos[1], M.pos[2], M.look[0], M.look[1], M.look[2], M.fov, 0);
  fitWidth(out, aspect, M.halfW, M.fovMax);
  return out;
}

/**
 * Intro timeline runner (director mode 'intro'). Owns no camera; `pose(out, dt, ctx)` writes the current shot's pose.
 * Cues (`onCue(type, shot, index)`): 'shot' at every shot start (including the first, fired by start()), 'end' once
 * when the sequence finishes or is skipped. Tap → skipShot() (skip the current legend/card); Skip button / Esc / Enter →
 * skipAll() (ends immediately; flow then cuts to CHECK, ≤ 0.3 s).
 */
export class IntroTimeline {
  constructor() {
    this.shots = [];
    this.index = -1;
    this.t = 0;              // seconds into the current shot
    this.elapsed = 0;        // seconds since start (skips jump forward)
    this.running = false;
    this.done = false;
    this.onCue = null;
    this._last = makePose();
  }

  /** Total length (s) of the loaded sequence. */
  get total() { let s = 0; for (let i = 0; i < this.shots.length; i++) s += this.shots[i].dur; return s; }
  /** The current shot (null before start / after the end). */
  get shot() { return this.index >= 0 && this.index < this.shots.length ? this.shots[this.index] : null; }

  /** Loads a shot list from introShots(); resets the runner. */
  load(shots) {
    this.shots = shots || [];
    this.index = -1; this.t = 0; this.elapsed = 0; this.running = false; this.done = false;
    return this;
  }

  /** Starts at shot 0 (fires its 'shot' cue); an empty list ends at once. */
  start() {
    this.running = true; this.done = false; this.elapsed = 0;
    this._enter(0);
    return this;
  }

  /** Advances by dt seconds (0 while paused); fires cues on shot boundaries. */
  update(dt) {
    if (!this.running || !(dt > 0)) return;
    this.t += dt; this.elapsed += dt;
    // While loops only on huge dt (tab switch) — each iteration consumes one whole shot.
    while (this.running) {
      const s = this.shots[this.index];
      if (!s || this.t < s.dur) break;
      const over = this.t - s.dur;
      this._enter(this.index + 1);
      if (this.running) this.t = over;
    }
  }

  /** Tap: skip the current shot (legend / team card / crane); on the last shot this ends the intro. */
  skipShot() {
    if (!this.running) return;
    const s = this.shots[this.index];
    if (s) this.elapsed += Math.max(0, s.dur - this.t);
    this._enter(this.index + 1);
  }

  /** Skip button / Esc / Enter: end now. */
  skipAll() {
    if (!this.running) return;
    this._finish();
  }

  /**
   * Camera pose for the current shot (after the end: the last pose is held).
   * @param {object} out pose
   * @param {number} dt (unused; the timeline advances in update())
   * @param {{aspect:number}} ctx
   */
  pose(out, dt, ctx) {
    const s = this.shot;
    if (!s) return copyPose(out, this._last);
    introShotPose(s, this.t, ctx && ctx.aspect > 0 ? ctx.aspect : 16 / 9, out);
    return copyPose(this._last, out);
  }

  _enter(i) {
    if (i >= this.shots.length) { this._finish(); return; }
    this.index = i; this.t = 0;
    if (this.onCue) this.onCue('shot', this.shots[i], i);
  }

  _finish() {
    if (this.done) return;
    this.running = false; this.done = true;
    this.index = this.shots.length;
    if (this.onCue) this.onCue('end', null, -1);
  }
}

// -------------------------------------------------------------------------------------------------------- turntable

/**
 * Lineup focus turntable (§6.4.5): the focused legend's yaw turns 20°/s when idle; a drag rotates 0.5°/px; a release
 * keeps spinning with the release velocity × 0.5°/px decaying at 4/s; auto-spin resumes 3 s after the last touch
 * (ramped in over 0.5 s so it does not jerk). flow applies `yaw` (radians) to the focused character
 * (animator.setYawOverride or object.rotation.y).
 */
export class Turntable {
  constructor() { this.reset(0); }

  /** Resets to yawDeg (degrees), idle spinning. */
  reset(yawDeg = 0) {
    this.yawDeg = yawDeg;
    this.vel = 0;             // inertia (deg/s)
    this.touching = false;
    this.idle = SHOTS.TURNTABLE.resumeS + SHOTS.TURNTABLE.rampS;   // never touched → spinning at full speed
  }

  /** Drag by dxPx CSS pixels (pointer move while touching). */
  drag(dxPx) {
    this.touching = true;
    this.vel = 0;
    this.idle = 0;
    this.yawDeg += SHOTS.TURNTABLE.degPerPx * dxPx;
  }

  /** Release with the pointer's horizontal velocity (px/s). */
  release(vxPxPerS) {
    this.touching = false;
    this.idle = 0;
    this.vel = SHOTS.TURNTABLE.degPerPx * (vxPxPerS || 0);
  }

  /** Advances the turntable; returns the yaw in radians. */
  update(dt) {
    const T = SHOTS.TURNTABLE;
    if (this.touching || !(dt > 0)) return this.yaw;
    // inertia: ω(t) = ω0·e^(−4t); the exact integral over dt is ω0·(1 − e^(−4dt))/4.
    const e = Math.exp(-T.decay * dt);
    this.yawDeg += this.vel * (1 - e) / T.decay;
    this.vel *= e;
    this.idle += dt;
    if (this.idle > T.resumeS) {
      const ramp = Math.min(1, (this.idle - T.resumeS) / T.rampS);
      this.yawDeg += T.idleDegPerS * ramp * dt;
    }
    if (this.yawDeg > 360 || this.yawDeg < -360) this.yawDeg %= 360;
    return this.yaw;
  }

  /** Current yaw (radians). */
  get yaw() { return this.yawDeg * DEG; }
}
