/**
 * select.js — every animation timing table and the clip-selection logic (spec §4.8–§4.13, [ANIM §4.3, §5–§10]).
 *
 * Exports
 *   getTiming(playerId, kind, variant) → frozen timing record (below); variant may also be a clip id
 *   timingByClip(playerId, clipId) → the timing record of a shot / finish clip (or null)
 *   selectClip(player, resolved {kind, variant, side, clipHint?}, ctx) → { clipIdx, mirror, warp, target, timing, clipId }
 *   selectMove(player, stick {lat, fwd}, ctx) → { clipIdx, mirror, moveId }
 *   selectPass(player, ctx) → { clipIdx, mirror, passId, releaseT, warp, layer, turn, noLook }
 *   selectDefJump(player, ctx) → { clipIdx, mirror, clipId, takeoffT, h, chase, entry }
 *   selectCelebration(player, ctx) → { clipIdx, mirror, celId, chainIdx, face, faceW, celebrate }
 *   selectIdleHabit(player, ctx) → { clipIdx, habitId, dur }
 *   timingClip(clipIdx, playerId, mirror) → compiled clip, or the catalog timing clip when the clip's data is not
 *   registered (headless / AnimProxy); prepareTiming(playerIds) pre-builds them all (load time, zero alloc after)
 *   catOf(clipIdx) → category string; CAT (category codes); CLIP_IDS (every clip id this module can select — the
 *   authoring list for clips/*.js); CATALOG_IDS; HJUMP, PASS_RELEASE (GP-derived nominal values, spec §5.1);
 *   KINDS (kind → variant list covered by getTiming); RIM_POS.
 *
 * Timing record (getTiming / selectClip().timing; all numbers finite; times in game seconds from the press):
 *   { clipId, kind, variant, player, meter ('hold' | 'key' | false), tIdeal, METER_T, meterFrom, takeoffT, h, gScale,
 *     rva, setLead, setT, releaseT, landT, slamT, slamAfterTO, hangT, airT, apexT, dur, hands, dTO (takeoff distance
 *     from the rim centre, −1 none), toDist (nominal root travel from the press to the takeoff, −1 none), baseSide,
 *     gatherWindow [dMin, dMax], warp ({EV code: game s} anchors for play()), profile ({slam, hang} for setJump) }
 *   Jump shots ('hold'): tIdeal = takeoffT + T½(h) + rva − 0.050 (ball launch = release input + 0.050 at apex + rva),
 *   METER_T = (tIdeal − meterFrom)/0.80 unless the spec tabulates it. Layups/hooks/floaters ('key'): tIdeal =
 *   release key − 0.050. Dunks / tips have no meter (meter false): tIdeal = the slam / contact time, METER_T =
 *   tIdeal/0.80 only so the record stays finite. T½(h) = sqrt(2h/(g·gScale)).
 *
 * Decisions taken here where the spec is silent or self-contradictory (also listed in the WP3a report):
 *   • Yao pull-up: FORMS (TO 0.38, h 0.20) give tIdeal 0.512 / METER_T 0.640 (the derived table prints 0.502 / 0.628).
 *   • shot.stepbackJ uses the stated formula (Kyrie 0.612 / 0.765; the parenthetical example prints 0.627 / 0.78).
 *   • Generic shot.turnFade: meterFrom = tIdeal − 0.80·METER_T(mid) so the bar fills like the player's jumper.
 *   • Generic shot.hook = Yao's hook keys × the player's tempo; shot.floaterGeneric = Kyrie's floater at tempo 1.08,
 *     h × 0.9, air keys scaled with the airtime; lay.reverse / lay.euro / lay.upUnder generics scale the source
 *     player's keys by tempo_p / tempo_source; Giannis has no fade form → his fade is his mid-range jumper.
 *   • Branch shots are separate clips that start at the press: sig.kyrie.doubleBtlStepbackShot (the Ky2 keys from
 *     0.57 on), sig.kobe.hesiCrossStepbackShot (K6 from 0.27 on).
 */
import { FORMS, STYLE, PLAYER_IDS, SLEG } from './presets.js';
import {
  EV, clipIndex, clipIdOf, getClip, getDef, compileClip, mirrorDef, timingDef,
} from './clip.js';

const G = 9.81;
/** Half airtime of a ballistic jump of height h under gravity g·gScale. */
const th = (h, gScale = 1) => Math.sqrt(2 * h / (G * gScale));
const r3 = (x) => Math.round(x * 1000) / 1000;
const tempoOf = (p) => STYLE[p].tempo;

/** Rim centre on the floor plane (v1 court constants: rim (0, 3.048, −12.75)). */
export const RIM_POS = Object.freeze({ x: 0, y: 3.048, z: -12.75 });

/** GP `hJump` (spec §5.1 binding table): nominal jump heights for generic defensive jumps and tips (C8). */
export const HJUMP = Object.freeze({ kobe: 0.79, jordan: 0.82, lebron: 0.76, giannis: 0.80, yao: 0.44, kyrie: 0.75 });
/** GP `passRelease` (spec §5.1 / C6). */
export const PASS_RELEASE = Object.freeze({ kobe: 0.158, jordan: 0.158, lebron: 0.133, giannis: 0.162, yao: 0.184, kyrie: 0.154 });

/** Category codes used by AnimProxy socket rules and gameplay. */
export const CAT = Object.freeze({
  other: 0, jumper: 1, layup: 2, dunk: 3, block: 4, contest: 5, rebound: 6, steal: 7, tip: 8, pass: 9, move: 10,
  catch: 11, cel: 12, idle: 13, stun: 14, defence: 15,
});

// ---------------------------------------------------------------------------------------------------------------
// Timing records
// ---------------------------------------------------------------------------------------------------------------

function finalize(o) {
  const r = {
    clipId: o.clipId, kind: o.kind, variant: o.variant, player: o.player, meter: o.meter === undefined ? false : o.meter,
    tIdeal: o.tIdeal, METER_T: o.METER_T, meterFrom: o.meterFrom || 0, takeoffT: o.takeoffT, h: o.h, gScale: o.gScale || 1,
    rva: o.rva || 0, setLead: o.setLead || 0, setT: o.setT === undefined ? -1 : o.setT, releaseT: o.releaseT === undefined ? -1 : o.releaseT,
    landT: o.landT, slamT: o.slamT === undefined ? -1 : o.slamT, slamAfterTO: o.slamAfterTO === undefined ? -1 : o.slamAfterTO,
    hangT: o.hangT || 0, airT: o.airT, apexT: o.apexT, dur: o.dur, hands: o.hands || 0, dTO: o.dTO === undefined ? -1 : o.dTO,
    toDist: o.toDist === undefined ? -1 : o.toDist,
    baseSide: o.baseSide || 'R', gatherWindow: Object.freeze(o.gatherWindow || [0, 0]),
    warp: null, profile: null,
  };
  if (r.METER_T === undefined || r.METER_T === null) r.METER_T = (r.tIdeal - r.meterFrom) / 0.80;
  const warp = {};
  if (o.warpTakeoff !== false) warp[EV.TAKEOFF] = r.takeoffT;
  if (o.warpSet) warp[EV.SET] = r.setT;
  r.warp = Object.freeze(warp);
  r.profile = Object.freeze({ slam: r.slamAfterTO > 0 ? r.slamAfterTO : 0, hang: r.hangT });
  for (const k of ['tIdeal', 'METER_T', 'meterFrom', 'takeoffT', 'h', 'landT', 'airT', 'apexT', 'dur']) {
    if (!Number.isFinite(r[k])) throw new Error(`select: non-finite ${k} for ${o.player} ${o.kind}/${o.variant}`);
  }
  r.spec = o.spec || null;
  return Object.freeze(r);
}

/**
 * Generic jump-shot record ([ANIM §5.3]): TO, h, rva, setLead → tIdeal, set, release, land, end.
 * `extra` may override meterFrom/METER_T, add pre-takeoff events/root and adjust the end.
 */
function jumpShot(p, clipId, kind, variant, TO, h, extra = {}) {
  const F = FORMS[p];
  const rva = extra.rva !== undefined ? extra.rva : F.rva;
  const setLead = extra.setLead !== undefined ? extra.setLead : F.setLead;
  const tI = extra.tIdeal !== undefined ? extra.tIdeal : TO + th(h) + rva - 0.05;
  const setT = extra.setT !== undefined ? extra.setT : Math.max(TO - 0.05, tI - setLead);
  const relT = tI + 0.05;
  const landT = extra.landT !== undefined ? extra.landT : TO + 2 * th(h);
  const follow = extra.followHold !== undefined ? extra.followHold : F.followHold;
  const dur = extra.dur !== undefined ? extra.dur : Math.max(landT + 0.25, relT + follow + 0.15);
  const ev = (extra.ev || []).concat([[TO, 'takeoff'], [TO + th(h), 'apex'], [setT, 'set'], [relT, 'release'], [landT, 'land']]);
  const spec = {
    id: clipId, dur, ev, jump: { h }, tempo: false, meter: 'hold', mask: 'full',
    root: 'motion', entry: extra.entry || 'stop', entryDecel: extra.entryDecel || 18,
    R: extra.R || [0, 0, 0], rWin: extra.rWin, ball: extra.ball || [[0, 'both'], [relT, 'free']],
    target: extra.target, params: { cat: 'jumper', meterFrom: extra.meterFrom || 0, tIdeal: tI, ...(extra.params || {}) },
  };
  return finalize({
    clipId, kind, variant, player: p, meter: 'hold', tIdeal: tI, METER_T: extra.METER_T, meterFrom: extra.meterFrom || 0,
    takeoffT: TO, h, rva, setLead, setT, releaseT: relT, landT, airT: landT - TO, apexT: TO + th(h), dur,
    baseSide: extra.baseSide, warpSet: extra.warpSet !== false, warpTakeoff: true, spec,
  });
}

/** makeJumper(p, variant) timing: mid | three | pull12 | pullHop | fade. */
function jumper(p, v) {
  const F = FORMS[p];
  const key = v === 'pull12' || v === 'pullHop' ? 'pull' : v;
  if (key === 'fade' && F.takeoff.fade === null) return jumper(p, 'mid');   // Giannis: no fade form
  const TO = F.takeoff[key], h = F.h[key];
  const extra = { ball: [[0, 'both']] };
  if (v === 'pull12') extra.ev = [[0.06, 'plantL'], [0.14, 'plantR']], extra.entryDecel = 20, extra.ball = [[0, 'drib'], [0.12, 'both']];
  if (v === 'pullHop') extra.ev = [[0.12, 'plantL'], [0.12, 'plantR']], extra.entryDecel = 24, extra.ball = [[0, 'drib'], [0.12, 'both']];
  const drift = key === 'fade' ? F.fadeDrift : -F.forwardDrift;      // R z: fades drift back, Giannis drifts forward
  if (drift) { extra.R = [0, -drift, 0]; extra.rWin = [TO, TO + 2 * th(h)]; }
  const rec = jumpShot(p, 'shot.' + (v === 'fade' ? 'fade' : v), 'jumper', v, TO, h, extra);
  return rec;
}

function sig(p, clipId, kind, variant, o) {
  const F = FORMS[p];
  if (o.meter === 'hold') {
    return jumpShot(p, clipId, kind, variant, o.TO, o.h, {
      tIdeal: o.tIdeal, METER_T: o.METER_T, meterFrom: o.meterFrom, setT: o.setT, landT: o.landT, dur: o.dur, rva: o.rva,
      ev: o.ev, R: o.R, rWin: o.rWin, entry: o.entry, entryDecel: o.entryDecel, ball: o.ball, baseSide: o.baseSide,
      warpSet: false, target: o.target, params: o.params, followHold: o.followHold,
    });
  }
  // 'key' release (layups, hooks, floaters): launch at the release key
  const gScale = o.gScale || 1;
  const apexT = o.TO + th(o.h, gScale);
  const relT = o.releaseT !== undefined ? o.releaseT : apexT + (o.relVsApex || 0);
  const landT = o.landT !== undefined ? o.landT : o.TO + 2 * th(o.h, gScale);
  const tI = o.tIdeal !== undefined ? o.tIdeal : relT - 0.05;
  const dur = o.dur !== undefined ? o.dur : landT + 0.30;
  // approach clips: nominal root travel toDist to the takeoff, then the airborne drift toward 0.45 m in front of the rim
  // (root curves are × sLeg at runtime: world distances are divided by the player's sLeg here)
  const k = 1 / SLEG[p];
  const Rkeys = o.toDist > 0 ? [[0, [0, 0, 0]], [o.TO, [0, o.toDist * k, 0]], [landT, [0, (o.toDist + Math.max(0, (o.dTO > 0 ? o.dTO : 0.75) - 0.45)) * k, 0]]] : undefined;
  const spec = {
    id: clipId, dur, ev: (o.ev || []).concat([[o.TO, 'takeoff'], [apexT, 'apex'], [relT, 'release'], [landT, 'land']]),
    jump: { h: o.h, gScale }, tempo: false, meter: 'key', root: o.R || Rkeys ? 'motion' : 'none', entry: o.entry || 'replace',
    entryDecel: o.entryDecel, R: o.R, rWin: o.rWin, Rkeys, ball: o.ball || [[0, 'both'], [relT, 'free']], target: o.target || (Rkeys ? 'takeoff' : undefined),
    params: { cat: o.cat || 'layup', meterFrom: o.meterFrom || 0, tIdeal: tI, gatherWindow: o.gatherWindow, exitV: o.exitV },
  };
  return finalize({
    clipId, kind, variant, player: p, meter: 'key', tIdeal: tI, METER_T: o.METER_T, meterFrom: o.meterFrom || 0,
    takeoffT: o.TO, h: o.h, gScale, rva: relT - apexT, releaseT: relT, landT, airT: landT - o.TO, apexT, dur,
    gatherWindow: o.gatherWindow, dTO: o.dTO, toDist: o.toDist, baseSide: o.baseSide, warpTakeoff: true, spec, setLead: F.setLead,
  });
}

/** Generic layup ([ANIM §5.5], spec §4.9.3): two-step (std2) or one-step (std1); fingerRoll releases at apex + 0.02. */
function layup(p, clipId, variant, steps, fingerRoll) {
  const L = FORMS[p].lay;
  const TO = steps === 2 ? L.to2 : L.to1;
  const g = L.gScale;
  const half = th(L.h, g);
  const relT = fingerRoll ? TO + half + 0.02 : TO + half - 0.03;
  const dTO = Math.min(2.0, Math.max(1.0, L.vAir * 2 * half * 0.75));
  const far = p === 'jordan' ? 4.6 : 4.0;
  const ev = steps === 2
    ? [[0, 'gather'], [0, 'plantR'], [0.26 * tempoOf(p), 'plantL']]
    : [[0, 'gather'], [0, 'plantL']];
  // nominal travel to the takeoff: the press-window midpoint minus dTO (two steps); one step ≈ 0.5 m
  const toDist = steps === 2 ? (2.5 + far) / 2 - dTO : 0.5;
  return sig(p, clipId, 'layup', variant, {
    TO, h: L.h, gScale: g, releaseT: relT, ev, toDist, dTO,
    ball: [[0, 'both'], [TO + 0.10, 'R'], [relT, 'free']], target: 'takeoff',
    gatherWindow: steps === 2 ? [2.5, far] : [0, 2.5],
  });
}

/** Scaled re-use of a source player's layup keys: times × s (non-air), h = the user's layup h (or given). */
function layScaled(p, clipId, variant, src) {
  const L = FORMS[p].lay;
  const s = tempoOf(p) / src.tempo;
  const TO = src.TO * s;
  const h = src.h !== undefined ? src.h : L.h;
  const g = L.gScale;
  const apexT = TO + th(h, g);
  const relT = apexT + src.relVsApex;
  return sig(p, clipId, 'layup', variant, {
    TO, h, gScale: g, releaseT: relT, meterFrom: src.meterFrom * s, ev: src.ev.map(([t, n]) => [t * s, n]),
    R: src.toDist ? undefined : src.R, rWin: [0, TO + 2 * th(h, g)], target: src.dTO ? 'takeoff' : undefined, dTO: src.dTO,
    toDist: src.toDist, gatherWindow: src.gatherWindow,
  });
}

/** Generic dunk (makeDunk, [ANIM §5.6]): power2 (two-hand, two feet), tomahawk1 (one-hand, off one foot), simple1. */
function dunk(p, type) {
  const D = FORMS[p].dunk;
  const g = p === 'jordan' ? 0.80 : 1;                 // C12: Jordan generic dunks gravity × 0.80
  const two = type === 'power2';
  const h = two ? D.h2 : D.h1;
  const slamAfter = (two ? D.slam2 : D.slam1) / Math.sqrt(g);
  const TO = (type === 'tomahawk1' ? 0.32 : 0.26) * tempoOf(p);
  const hang = type === 'power2' ? 0.20 : type === 'tomahawk1' ? 0.15 : 0;
  const ev = type === 'tomahawk1'
    ? [[0, 'gather'], [0, 'plantR'], [0.24 * tempoOf(p), 'plantL']]
    : [[0, 'gather'], [0.12 * tempoOf(p), 'plantL'], [0.12 * tempoOf(p), 'plantR']];
  return dunkRec(p, 'dunk.' + type, type, {
    TO, h, gScale: g, slamAfter, hang, ev, hands: two ? 2 : 1, dTO: type === 'tomahawk1' ? 1.6 : 1.15,
    toDist: type === 'tomahawk1' ? 1.3 : 0.5, gatherWindow: [0.6, 4.0], endAfterLand: two ? 0.35 : 0.30,
  });
}

/** Dunk record: rise–(hang)–drop vertical profile (spec §4.9.4). */
function dunkRec(p, clipId, variant, o) {
  const g = o.gScale || 1;
  const slamT = o.TO + o.slamAfter;
  // airtime: hang dunks drop from h − 0.05 after slam + 0.03 + hang; others are plain ballistic
  const airT = o.airT !== undefined ? o.airT
    : o.hang > 0 ? o.slamAfter + 0.03 + o.hang + Math.sqrt(2 * (o.h - 0.05) / (G * g)) : 2 * th(o.h, g);
  const landT = o.TO + airT;
  const dur = o.dur !== undefined ? o.dur : landT + (o.endAfterLand || 0.30);
  const ev = (o.ev || []).concat([[o.TO, 'takeoff'], [o.TO + th(o.h, g), 'apex'], [slamT, 'slam'], [landT, 'land']]);
  if (o.hang > 0) ev.push([slamT + 0.03, 'rimGrab'], [slamT + 0.03 + o.hang, 'rimRelease']);
  if (o.extraEv) ev.push(...o.extraEv);
  // root: nominal travel toDist to the takeoff, then the air velocity (dTO − 0.35)/tSlam toward the rim
  const air = o.dTO > 0 ? Math.max(0, o.dTO - 0.35) : 0.3;
  const k = 1 / SLEG[p];                                   // world metres → authored (× sLeg at runtime)
  const Rkeys = o.toDist > 0 && !o.R ? [[0, [0, 0, 0]], [o.TO, [0, o.toDist * k, 0]], [slamT, [0, (o.toDist + air) * k, 0]]] : undefined;
  const spec = {
    id: clipId, dur, ev, jump: { h: o.h, gScale: g, hang: o.hang || 0 }, tempo: false, meter: false, root: 'motion',
    entry: 'replace', Rkeys, R: Rkeys ? undefined : (o.R || [0, 1.2 + air, 0]), rWin: [0, landT],
    ball: [[0, o.hands === 2 ? 'both' : 'R'], [slamT, 'free']], target: o.dTO > 0 ? 'takeoff' : undefined,
    params: { cat: 'dunk', hands: o.hands, gatherWindow: o.gatherWindow },
  };
  return finalize({
    clipId, kind: 'dunk', variant, player: p, meter: false, tIdeal: slamT, takeoffT: o.TO, h: o.h, gScale: g,
    slamT, slamAfterTO: o.slamAfter, hangT: o.hang || 0, airT, landT, apexT: o.TO + th(o.h, g), dur, hands: o.hands,
    dTO: o.dTO, toDist: o.toDist, gatherWindow: o.gatherWindow, releaseT: slamT, spec,
  });
}

/** Builds the full timing table of one player: TABLE[kind][variant] and BY_CLIP[clipId]. */
function buildPlayer(p) {
  const F = FORMS[p];
  const T = { jumper: {}, fade: {}, stepback: {}, turnFade: {}, hook: {}, floater: {}, layup: {}, dunk: {}, tip: {} };
  const tempo = tempoOf(p);

  // ---- jumpers (spec §4.9.2, §4.12, §4.13) ----
  T.jumper.set = jumper(p, 'mid');
  T.jumper.three = jumper(p, 'three');
  T.jumper.pull12 = jumper(p, 'pull12');
  T.jumper.pullHop = jumper(p, 'pullHop');
  if (p === 'jordan') {
    // J6: makeJumper(jordan, pull12), h 0.55, knees together, drift 0.15 back: tIdeal 0.475 / 0.594
    T.jumper.pull12 = T.jumper.pullHop = jumpShot(p, 'sig.jordan.pullup', 'jumper', 'pull12', F.takeoff.pull, 0.55, {
      ev: [[0.06, 'plantL'], [0.14, 'plantR']], entryDecel: 20, R: [0, -0.15, 0], rWin: [F.takeoff.pull, F.takeoff.pull + 2 * th(0.55)],
      ball: [[0, 'drib'], [0.12, 'both']], METER_T: 0.594,
    });
  }
  T.jumper.jabPullup = T.jumper.set;
  if (p === 'kobe') {
    T.jumper.jabPullup = sig(p, 'sig.kobe.ripPullup', 'jumper', 'jabPullup', {
      meter: 'hold', TO: 0.19, h: 0.55, tIdeal: 0.465, METER_T: 0.58, setT: 0.385, landT: 0.86, dur: 1.05,
    });
    T.jumper.sideStepPullup = sig(p, 'sig.kobe.sideStepPullup', 'jumper', 'sideStepPullup', {
      meter: 'hold', TO: 0.33, h: 0.50, meterFrom: 0.12, tIdeal: 0.589, METER_T: 0.586, setT: 0.509, landT: 0.97, dur: 1.05,
      ev: [[0.08, 'bounce'], [0.12, 'plantR'], [0.17, 'plantL']], R: [-0.63, 0.60, 0], rWin: [0, 0.97], entry: 'replace',
      ball: [[0, 'path'], [0.12, 'both']],
    });
  }
  if (p === 'jordan') {
    T.jumper.jabPullup = sig(p, 'sig.jordan.jabShot', 'jumper', 'jabPullup', {
      meter: 'hold', TO: 0.13, h: 0.50, tIdeal: 0.40, METER_T: 0.50, dur: 0.95,
    });
  }
  if (p === 'yao') {
    T.jumper.jabPullup = sig(p, 'sig.yao.jabJumper', 'jumper', 'jabPullup', {
      meter: 'hold', TO: 0.53, h: 0.15, meterFrom: 0.20, tIdeal: 0.635, METER_T: 0.54, ev: [[0.12, 'plantR'], [0.33, 'gather']],
    });
  }
  if (p === 'kyrie') {
    T.jumper.btbPullup = sig(p, 'sig.kyrie.btbPullup', 'jumper', 'btbPullup', {
      meter: 'hold', TO: 0.45, h: 0.40, meterFrom: 0.24, tIdeal: 0.676, METER_T: 0.54, landT: 1.02, dur: 1.25, entryDecel: 24,
      ev: [[0, 'plantL'], [0, 'plantR'], [0.14, 'bounce'], [0.22, 'handOnL'], [0.24, 'gather']],
      ball: [[0, 'path'], [0.24, 'both']],
    });
  }
  if (!T.jumper.sideStepPullup) T.jumper.sideStepPullup = T.jumper.pull12;
  if (!T.jumper.btbPullup) T.jumper.btbPullup = T.jumper.pull12;

  // ---- fades ----
  T.fade[''] = jumper(p, 'fade');
  T.fade.baseline = T.fade[''];
  if (p === 'kobe') {
    T.fade.baseline = sig(p, 'sig.kobe.baselineSpinFade', 'fade', 'baseline', {
      meter: 'hold', TO: 0.62, h: 0.50, meterFrom: 0.40, tIdeal: 0.879, METER_T: 0.60, setT: 0.80, landT: 1.26, dur: 1.52,
      ev: [[0.13, 'plantL'], [0.20, 'gather'], [0.47, 'plantR']], R: [0.45, 0.0, -180], rWin: [0, 1.26], entry: 'replace',
      ball: [[0, 'drib'], [0.20, 'both']],
    });
  }

  // ---- step-backs ([ANIM §5.4], §4.12 L6/K6/Ky2) ----
  {
    const TO = 0.42 * tempo, h = F.h.pull;
    const push = p === 'kyrie' ? 0.80 : p === 'lebron' ? 0.50 : 0.70;
    T.stepback[''] = jumpShot(p, 'shot.stepbackJ', 'stepback', '', TO, h, {
      ev: [[0.06 * tempo, 'plantL'], [0.28 * tempo, 'plantL'], [0.32 * tempo, 'plantR']], entry: 'replace',
      R: [0, -(push + 0.12), 0], rWin: [0.10 * tempo, TO + 2 * th(h)], ball: [[0, 'drib'], [0.12, 'both']],
    });
  }
  T.stepback.branch = T.stepback[''];
  if (p === 'lebron') {
    T.stepback[''] = T.stepback.branch = sig(p, 'sig.lebron.stepback3', 'stepback', '', {
      meter: 'hold', TO: 0.36, h: 0.25, tIdeal: 0.496, METER_T: 0.62, followHold: 0.33,
      ev: [[0.05, 'plantR'], [0.25, 'plantL'], [0.29, 'plantR']], R: [0, -0.60, 0], rWin: [0.08, 0.81], entry: 'replace',
      ball: [[0, 'drib'], [0.12, 'both']],
    });
  }
  if (p === 'kyrie') {
    // Ky2 shot branch re-timed to start at the press (0.57 in the full clip): takeoff 0.83 → 0.26, release 1.09 → 0.52
    T.stepback.branch = sig(p, 'sig.kyrie.doubleBtlStepbackShot', 'stepback', 'branch', {
      meter: 'hold', TO: 0.26, h: 0.35, tIdeal: 0.47, METER_T: 0.59, setT: 0.41, landT: 0.79, dur: 0.98,
      ev: [[0.13, 'plantL'], [0.16, 'plantR']], R: [0, -0.95, 0], rWin: [0, 0.79], entry: 'replace',
    });
  }
  if (p === 'kobe') {
    // K6 shot branch from a press at 0.27: step-back lands 0.13, takeoff 0.20, h 0.50 (mid form), tIdeal 0.459
    T.stepback.branch = sig(p, 'sig.kobe.hesiCrossStepbackShot', 'stepback', 'branch', {
      meter: 'hold', TO: 0.20, h: 0.50, tIdeal: 0.459, METER_T: 0.574,
      ev: [[0.13, 'plantL'], [0.13, 'plantR']], R: [0, -0.80, 0], rWin: [0, 0.84], entry: 'replace',
    });
  }

  // ---- turnarounds ----
  {
    const fadeH = F.h.fade !== null ? F.h.fade : F.h.mid;
    const TO = 0.70 * tempo;
    const tI = TO + th(fadeH) + F.rva - 0.05;
    const mf = tI - 0.80 * T.jumper.set.METER_T;
    const generic = jumpShot(p, 'shot.turnFade', 'turnFade', '', TO, fadeH, {
      meterFrom: mf, METER_T: T.jumper.set.METER_T, ev: [[0.33 * tempo, 'plantR'], [0.60 * tempo, 'gather']],
      R: [0.45, -(F.fadeDrift || 0.30), -180], rWin: [0.33 * tempo, TO + 2 * th(fadeH)], baseSide: 'L', target: 'takeoff',
    });
    T.turnFade[''] = T.turnFade.R = T.turnFade.L = generic;
  }
  if (p === 'kobe') {
    T.turnFade[''] = T.turnFade.R = T.turnFade.L = sig(p, 'sig.kobe.turnFade', 'turnFade', '', {
      meter: 'hold', TO: 0.70, h: 0.50, meterFrom: 0.50, tIdeal: 0.959, METER_T: 0.574, setT: 0.83, landT: 1.34, dur: 1.60,
      ev: [[0.30, 'fake'], [0.50, 'plantR'], [0.50, 'gather']], R: [0.42, 0.51, 165], rWin: [0.32, 1.34], entryDecel: 20,
      baseSide: 'R', target: 'takeoff',
    });
  }
  if (p === 'jordan') {
    T.turnFade[''] = T.turnFade.R = T.turnFade.L = sig(p, 'sig.jordan.turnFade', 'turnFade', '', {
      meter: 'hold', TO: 0.68, h: 0.62, meterFrom: 0.45, tIdeal: 0.986, METER_T: 0.67, setT: 0.80, landT: 1.39, dur: 1.75,
      ev: [[0.60, 'plantR'], [0.60, 'gather']], R: [0.52, 0.55, -180], rWin: [0.33, 1.39], entryDecel: 20, baseSide: 'L',
      target: 'takeoff',
    });
  }
  if (p === 'lebron') {
    T.turnFade.L = sig(p, 'sig.lebron.leftBlockFade', 'turnFade', 'L', {
      meter: 'hold', TO: 0.42, h: 0.40, meterFrom: 0.15, tIdeal: 0.616, METER_T: 0.58, setT: 0.55, landT: 0.99, dur: 1.30,
      ev: [[0.30, 'plantR'], [0.30, 'gather']], R: [0.86, 0.25, -150], rWin: [0.08, 0.99], baseSide: 'L', target: 'takeoff',
    });
  }
  if (p === 'yao') {
    T.turnFade[''] = T.turnFade.R = T.turnFade.L = sig(p, 'sig.yao.turnFade', 'turnFade', '', {
      meter: 'hold', TO: 0.53, h: 0.28, meterFrom: 0.27, tIdeal: 0.699, METER_T: 0.54, setT: 0.67, landT: 1.01, dur: 1.20,
      ev: [[0.53, 'plantR'], [0.53, 'gather']], R: [0.72, 0.24, -160], rWin: [0.27, 1.01], baseSide: 'R', target: 'takeoff',
    });
  }

  // ---- hooks ----
  if (p === 'yao') {
    T.hook[''] = sig(p, 'sig.yao.hook', 'hook', '', {
      TO: 0.60, h: 0.22, releaseT: 0.79, meterFrom: 0.30, tIdeal: 0.74, METER_T: 0.55, landT: 1.02, dur: 1.50, cat: 'layup',
      ev: [[0.10, 'bounce'], [0.10, 'contact'], [0.40, 'plantL'], [0.55, 'gather']], R: [0.30, -0.08, 70], rWin: [0.20, 0.40],
      entry: 'stop', baseSide: 'L',
    });
    T.hook.upUnder = sig(p, 'sig.yao.upUnder', 'hook', 'upUnder', {
      TO: 0.40, h: 0.15, releaseT: 0.57, meterFrom: 0.10, tIdeal: 0.52, METER_T: 0.525, landT: 0.75, dur: 1.00,
      ev: [[0.20, 'plantR']], R: [0, 0.60, 0], rWin: [0, 0.40],
    });
  } else {
    const s = tempo;                                      // Yao's hook keys at the player's tempo
    const TO = 0.60 * s, h = 0.22;
    const rel = TO + th(h) - 0.02;
    T.hook[''] = sig(p, 'shot.hook', 'hook', '', {
      TO, h, releaseT: rel, meterFrom: 0.30 * s, ev: [[0.10 * s, 'bounce'], [0.40 * s, 'plantL'], [0.55 * s, 'gather']],
      R: [0.30, -0.08, 70], rWin: [0.20 * s, 0.40 * s], entry: 'stop', cat: 'layup', baseSide: 'L',
    });
    T.hook.upUnder = null;                                 // filled from the layup table below
  }

  // ---- floaters ----
  if (p === 'kyrie') {
    T.floater[''] = sig(p, 'sig.kyrie.floater', 'floater', '', {
      TO: 0.17, h: 0.40, releaseT: 0.40, tIdeal: 0.35, METER_T: 0.44, landT: 0.74, dur: 0.95,
      ev: [[0, 'gather'], [0, 'plantL']], R: [0, 0.45, 0], rWin: [0, 0.74], gatherWindow: [2.2, 4.5],
    });
    T.floater.scoop = sig(p, 'sig.kyrie.scoop', 'floater', 'scoop', {
      TO: 0.17, h: 0.30, releaseT: 0.38, landT: 0.66, dur: 0.90, ev: [[0, 'gather'], [0, 'plantL']], R: [0, 0.40, 0],
      rWin: [0, 0.66], gatherWindow: [2.2, 4.5],
    });
  } else {
    // Kyrie's floater keys at tempo 1.08, h × 0.9; air keys scale with the airtime
    const TO = 0.17 * 1.08, h = 0.40 * 0.9;
    const airScale = th(h) / th(0.40);
    T.floater[''] = sig(p, 'shot.floaterGeneric', 'floater', '', {
      TO, h, releaseT: TO + (0.40 - 0.17) * airScale, ev: [[0, 'gather'], [0, 'plantL']], R: [0, 0.40, 0],
      rWin: [0, TO + 2 * th(h)], gatherWindow: [2.2, 4.5],
    });
    T.floater.scoop = T.floater[''];
  }

  // ---- layups (spec §4.9.3 table; C12 for Jordan) ----
  T.layup.std2 = layup(p, 'lay.std2', 'std2', 2, false);
  T.layup.std1 = layup(p, 'lay.std1', 'std1', 1, false);
  T.layup.std = T.layup.std2;
  T.layup.fingerRoll = layup(p, 'lay.fingerRoll', 'fingerRoll', 2, true);
  T.layup.fingerRoll1 = layup(p, 'lay.fingerRoll1', 'fingerRoll1', 1, true);
  T.layup.reverse = layScaled(p, 'lay.reverse', 'reverse', {
    tempo: STYLE.kyrie.tempo, TO: 0.37, relVsApex: -0.03, meterFrom: 0.20, R: [0, 2.0, 0],
    ev: [[0.20, 'gather'], [0.20, 'plantL'], [0.33, 'plantR']], gatherWindow: [0.8, 4.0],
  });
  T.layup.euro = layScaled(p, 'lay.euro', 'euro', {
    tempo: STYLE.giannis.tempo, TO: 0.83, relVsApex: 0, meterFrom: 0.60, R: [0.40, 3.0, 0], dTO: 1.6, toDist: 2.5,
    ev: [[0.23, 'gather'], [0.33, 'plantR'], [0.60, 'plantL']], gatherWindow: [3.0, 5.2],
  });
  T.layup.power = layScaled(p, 'lay.power', 'power', {
    tempo: 1, TO: 0.26, relVsApex: -0.03, meterFrom: 0, R: [0, 0.6, 0],
    ev: [[0, 'gather'], [0.12, 'plantL'], [0.12, 'plantR']], gatherWindow: [0, 4.0],
  });
  T.layup.upUnder = layScaled(p, 'lay.upUnder', 'upUnder', {
    tempo: STYLE.yao.tempo, TO: 0.40, h: 0.15 * FORMS[p].lay.h / FORMS.yao.lay.h, relVsApex: 0, meterFrom: 0.10,
    R: [0, 0.60, 0], ev: [[0.20, 'plantR']], gatherWindow: [0, 3.0],
  });
  T.layup.switch = T.layup.spin = T.layup.baseline = T.layup.std2;
  T.layup.sigEuro = T.layup.euro;
  if (p === 'jordan') {
    T.layup.switch = sig(p, 'sig.jordan.theMove', 'layup', 'switch', {
      TO: 0.12, h: 0.95, releaseT: 0.84, meterFrom: 0.30, tIdeal: 0.79, METER_T: 0.61, landT: 1.00, dur: 1.25,
      ev: [[0, 'gather'], [0, 'plantL']], toDist: 0.50, dTO: 2.0, target: 'takeoff', exitV: [0, 3],
      gatherWindow: [2.0, 4.6],
    });
  }
  if (p === 'kyrie') {
    T.layup.spin = sig(p, 'sig.kyrie.spinFinish', 'layup', 'spin', {
      TO: 0.53, h: 0.50, releaseT: 0.82, meterFrom: 0.33, tIdeal: 0.77, METER_T: 0.55, landT: 1.17, dur: 1.40,
      ev: [[0.10, 'plantL'], [0.33, 'handoff'], [0.43, 'plantR'], [0.43, 'gather']], R: [-0.40, 0.34, 270], rWin: [0, 0.53],
      ball: [[0, 'drib'], [0.13, 'R'], [0.33, 'L'], [0.43, 'both'], [0.53, 'L'], [0.82, 'free']], gatherWindow: [0, 4.0],
    });
    T.layup.reverse = sig(p, 'sig.kyrie.reverseLay', 'layup', 'reverse', {
      TO: 0.37, h: 0.55, releaseT: 0.675, meterFrom: 0.20, tIdeal: 0.625, METER_T: 0.53, landT: 1.04, dur: 1.25,
      ev: [[0.20, 'gather'], [0.20, 'plantL'], [0.33, 'plantR']], R: [0, 2.0, 0], rWin: [0, 1.04], target: 'plantR',
      gatherWindow: [0.8, 4.0],
    });
  }
  if (p === 'giannis') {
    T.layup.spin = sig(p, 'sig.giannis.spinGather', 'layup', 'spin', {
      TO: 0.83, h: 0.50, releaseT: 1.12, meterFrom: 0.63, tIdeal: 1.07, METER_T: 0.55, landT: 1.47, dur: 1.70,
      ev: [[0.23, 'plantL'], [0.23, 'gather'], [0.63, 'plantR']], R: [-0.31, 0.64, 300], rWin: [0, 0.63], target: 'plantR',
      ball: [[0, 'drib'], [0.23, 'both'], [0.83, 'L'], [1.12, 'free']], gatherWindow: [0, 4.0],
    });
    T.layup.sigEuro = sig(p, 'sig.giannis.euroLay', 'layup', 'sigEuro', {
      TO: 0.83, h: 0.72, releaseT: 1.20, meterFrom: 0.60, tIdeal: 1.15, METER_T: 0.69, dur: 1.90,
      ev: [[0.23, 'gather'], [0.33, 'plantR'], [0.60, 'plantL']], toDist: 3.60, dTO: 2.9,
      target: 'takeoff', ball: [[0, 'drib'], [0.23, 'both'], [1.00, 'R'], [1.20, 'free']], gatherWindow: [5.4, 7.6],
    });
  }
  if (p === 'kobe') {
    T.layup.baseline = sig(p, 'sig.kobe.baselineSpinLay', 'layup', 'baseline', {
      TO: 0.60, h: 0.55, releaseT: 0.905, meterFrom: 0.47, tIdeal: 0.855, METER_T: 0.48, landT: 1.27, dur: 1.30,
      ev: [[0.13, 'plantL'], [0.20, 'gather'], [0.47, 'plantR']], R: [0.45, 0.45, -180], rWin: [0, 0.47],
      ball: [[0, 'drib'], [0.20, 'both'], [0.80, 'R'], [0.905, 'free']], gatherWindow: [0, 4.5],
    });
  }
  if (p === 'yao') {
    T.layup.upUnder = T.hook.upUnder;
    T.layup.dropStepLay = sig(p, 'sig.yao.dropStepLay', 'layup', 'dropStepLay', {
      TO: 0.47, h: 0.48, releaseT: 0.78, meterFrom: 0.27, ev: [[0.13, 'bounce'], [0.27, 'plantR'], [0.27, 'gather']],
      R: [0.49, -0.21, -120], rWin: [0, 0.27], dur: 1.40, gatherWindow: [0, 4.5],
    });
  }
  if (!T.hook.upUnder) T.hook.upUnder = T.layup.upUnder;

  // ---- dunks (spec §4.9.4, §4.12) ----
  T.dunk.power2 = dunk(p, 'power2');
  T.dunk.tomahawk1 = dunk(p, 'tomahawk1');
  T.dunk.simple1 = dunk(p, 'simple1');
  T.dunk.tomahawk = T.dunk.tomahawk1;
  T.dunk.jumpStop = T.dunk.power2;
  T.dunk[''] = p === 'kyrie' || p === 'yao' ? T.dunk.simple1 : p === 'giannis' ? T.dunk.power2 : T.dunk.tomahawk1;
  if (p === 'kobe') {
    T.dunk.tomahawk = dunkRec(p, 'sig.kobe.tomahawk', 'tomahawk', {
      TO: 0.36, h: 0.73, slamAfter: 0.356, hang: 0.10, hands: 1, dTO: 1.65, toDist: 1.30, dur: 1.50,
      ev: [[0, 'gather'], [0, 'plantR'], [0.28, 'plantL']], gatherWindow: [2.25, 3.65],
    });
    T.dunk.reverse = dunkRec(p, 'sig.kobe.reverse2', 'reverse', {
      TO: 0.28, h: 0.85, slamAfter: 0.44, hang: 0.15, hands: 2, dTO: -1, dur: 1.60, airT: 1.04,
      ev: [[0.14, 'plantL'], [0.14, 'plantR']], gatherWindow: [1.0, 2.6],
    });
  }
  if (p === 'jordan') {
    T.dunk.ftLine = dunkRec(p, 'sig.jordan.ftDunk', 'ftLine', {
      TO: 0.48, h: 1.00, gScale: 0.70, slamAfter: 0.704, hang: 0, hands: 1, dTO: 4.4, toDist: 2.40, dur: 2.00,
      ev: [[0, 'gather'], [0.14, 'plantR'], [0.42, 'plantL'], [0.60, 'slowmoIn'], [1.184, 'slowmoOut']],
      gatherWindow: [6.0, 7.6],
    });
    T.dunk.cradle = dunkRec(p, 'sig.jordan.cradle', 'cradle', {
      TO: 0.13, h: 1.00, slamAfter: 0.42, hang: 0.13, hands: 1, dTO: 1.4, toDist: 0.40, dur: 1.40, airT: 1.02,
      ev: [[0, 'gather'], [0, 'plantL']], gatherWindow: [1.46, 2.14],
    });
  }
  if (p === 'lebron') {
    T.dunk.tomahawk = dunkRec(p, 'sig.lebron.tomahawk', 'tomahawk', {
      TO: 0.20, h: 0.80, slamAfter: 0.374, hang: 0.15, hands: 1, dTO: 1.75, toDist: 1.40, dur: 1.44, airT: 0.94,
      ev: [[0, 'gather'], [0, 'plantR'], [0.12, 'plantL']], gatherWindow: [2.41, 3.89],
    });
    const ps = FORMS.lebron.dunk;
    T.dunk.jumpStop = dunkRec(p, 'sig.lebron.jumpStopDunk', 'jumpStop', {
      TO: 0.26 * tempo, h: ps.h2, slamAfter: ps.slam2, hang: 0.20, hands: 2, dTO: 1.15, toDist: 0.50,
      ev: [[0, 'gather'], [0.12 * tempo, 'plantL'], [0.12 * tempo, 'plantR']], gatherWindow: [0.6, 4.0], endAfterLand: 0.35,
    });
  }
  if (p === 'giannis') {
    T.dunk.euro = dunkRec(p, 'sig.giannis.euroDunk', 'euro', {
      TO: 0.83, h: 0.72, slamAfter: 0.48, hang: 0.20, hands: 1, dTO: 2.9, toDist: 3.60, dur: 2.21,
      ev: [[0.23, 'gather'], [0.33, 'plantR'], [0.60, 'plantL']], gatherWindow: [5.4, 7.6],
    });
    T.dunk.longGather = dunkRec(p, 'sig.giannis.longGather', 'longGather', {
      TO: 0.60, h: 0.66, slamAfter: 0.467, hang: 0.30, hands: 2, dTO: 2.9, toDist: 4.20, dur: 2.05,
      ev: [[0.27, 'gather'], [0.27, 'plantR'], [0.53, 'plantL']], gatherWindow: [6.4, 7.8],
    });
  }
  if (p === 'yao') {
    T.dunk.dropStep = dunkRec(p, 'sig.yao.dropStep', 'dropStep', {
      TO: 0.47, h: 0.48, slamAfter: 0.28, hang: 0.10, hands: 2, dTO: -1, dur: 1.65, airT: 0.71,
      ev: [[0.13, 'bounce'], [0.27, 'plantR'], [0.27, 'gather']], gatherWindow: [0, 1.5], R: [0.49, -0.21, -120],
    });
  }
  for (const v of ['reverse', 'ftLine', 'cradle', 'euro', 'longGather', 'dropStep']) if (!T.dunk[v]) T.dunk[v] = T.dunk[''];

  // ---- tips / putbacks (C8: h = hJump) ----
  {
    const h = HJUMP[p], TO = 0.10;
    T.tip[''] = finalize({
      clipId: 'put.tip', kind: 'tip', variant: '', player: p, meter: false, tIdeal: TO + th(h), takeoffT: TO, h,
      landT: TO + 2 * th(h), airT: 2 * th(h), apexT: TO + th(h), dur: TO + 2 * th(h) + 0.25,
      spec: { id: 'put.tip', dur: TO + 2 * th(h) + 0.25, jump: { h }, tempo: false,
        ev: [[TO, 'takeoff'], [TO + th(h), 'apex'], [TO + th(h), 'contact'], [TO + 2 * th(h), 'land']], params: { cat: 'tip' } },
    });
    if (p === 'lebron' || p === 'giannis' || p === 'yao') {
      const slam = TO + th(h) + 0.10;
      T.tip.dunk = finalize({
        clipId: 'put.dunk', kind: 'tip', variant: 'dunk', player: p, meter: false, tIdeal: slam, takeoffT: TO, h,
        slamT: slam, slamAfterTO: slam - TO, landT: TO + 2 * th(h), airT: 2 * th(h), apexT: TO + th(h), hands: 2,
        dur: TO + 2 * th(h) + 0.30, releaseT: slam,
        spec: { id: 'put.dunk', dur: TO + 2 * th(h) + 0.30, jump: { h }, tempo: false,
          ev: [[TO, 'takeoff'], [TO + th(h), 'apex'], [TO + th(h), 'catch'], [slam, 'slam'], [TO + 2 * th(h), 'land']],
          ball: [[TO + th(h), 'both'], [slam, 'free']], params: { cat: 'dunk', hands: 2 } },
      });
    } else T.tip.dunk = T.tip[''];
  }

  const BY_CLIP = {};
  for (const k of Object.keys(T)) for (const v of Object.keys(T[k])) { const r = T[k][v]; if (r) BY_CLIP[r.clipId] = BY_CLIP[r.clipId] || r; }
  return { T, BY_CLIP };
}

const TABLE = {};
for (const p of PLAYER_IDS) TABLE[p] = buildPlayer(p);

/** Kind → variants covered by getTiming (the spec's resolver kinds §5.3.1 plus the context variants above). */
export const KINDS = Object.freeze({
  jumper: Object.freeze(['set', 'three', 'pull12', 'pullHop', 'jabPullup', 'sideStepPullup', 'btbPullup']),
  fade: Object.freeze(['', 'baseline']),
  stepback: Object.freeze(['', 'branch']),
  turnFade: Object.freeze(['', 'R', 'L']),
  hook: Object.freeze(['', 'upUnder']),
  floater: Object.freeze(['', 'scoop']),
  layup: Object.freeze(['std', 'std1', 'std2', 'fingerRoll', 'fingerRoll1', 'reverse', 'euro', 'power', 'switch', 'spin', 'upUnder', 'baseline', 'sigEuro']),
  dunk: Object.freeze(['', 'power2', 'tomahawk1', 'simple1', 'tomahawk', 'reverse', 'ftLine', 'cradle', 'jumpStop', 'euro', 'longGather', 'dropStep']),
  tip: Object.freeze(['', 'dunk']),
});
const DEFAULT_VARIANT = { jumper: 'set', layup: 'std', fade: '', stepback: '', turnFade: '', hook: '', floater: '', dunk: '', tip: '' };

/**
 * Timing record for (playerId, kind, variant) (spec §1.4). `variant` may be a resolver variant, one of the context
 * variants listed in KINDS, or a clip id (e.g. 'sig.giannis.euroLay'); unknown variants fall back to the kind's
 * default. Returns null for an unknown player or kind. Pure lookup, no allocation.
 */
export function getTiming(playerId, kind, variant) {
  const P = TABLE[playerId];
  if (!P) return null;
  const K = P.T[kind];
  if (!K) return null;
  if (variant !== undefined && variant !== null) {
    const r = K[variant];
    if (r) return r;
    const c = P.BY_CLIP[variant];
    if (c) return c;
  }
  return K[DEFAULT_VARIANT[kind]];
}

/** Timing record by clip id for a player (null when the clip is not a timed finish/shot). */
export function timingByClip(playerId, clipId) {
  const P = TABLE[playerId];
  return P ? P.BY_CLIP[clipId] || null : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Fallback timing catalog (clips whose authored data is not registered: headless runs, AnimProxy)
// ---------------------------------------------------------------------------------------------------------------

const E = (...a) => { const o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i + 1], a[i]]); return o; };

/** Static catalog entries (player-independent unless a function of p). Fields as makeTimingClip specs + cat. */
const STATIC = {
  // ---- dribble moves ([ANIM §4.2], spec §4.8) ----
  'move.cross': { dur: 0.40, cat: 'move', entry: 'replace', cancel: 0.30, R: [1.00, 0.60, 0], ev: E('plantR', 0.05, 'bounce', 0.13, 'handOnL', 0.24, 'plantL', 0.28, 'plantR', 0.40), ball: [[0, 'path'], [0.24, 'drib']], params: { imm: [0.05, 0.30], exitV: [2.6, 3.0] } },
  'move.btl': { dur: 0.36, cat: 'move', entry: 'carry', R: [0.15, 0.05, 0], ev: E('bounce', 0.14, 'handOnL', 0.22), ball: [[0, 'path'], [0.36, 'drib']], params: { imm: [0.05, 0.28] } },
  'move.btb': { dur: 0.38, cat: 'move', entry: 'carry', R: [0.35, 0, 0], ev: E('bounce', 0.17, 'handOnL', 0.26), ball: [[0, 'path'], [0.38, 'drib']], params: { imm: [0.06, 0.30] } },
  'move.hesi': { dur: 0.45, cat: 'move', entry: 'carry', R: [0, 0.10, 0], ev: E('plantR', 0.20), ball: [[0, 'drib']], params: { carryScale: [[0.05, 0.22, 0.40], [0.26, 0.45, 1.25]] } },
  'move.spin': { dur: 0.50, cat: 'move', entry: 'replace', R: [0.75, 1.20, 360], ev: E('plantL', 0.06, 'handoff', 0.30, 'plantR', 0.34), ball: [[0, 'path'], [0.30, 'L'], [0.42, 'drib']], params: { imm: [0.08, 0.40], exitV: [0.6, 4.2] } },
  'move.stepback': { dur: 0.45, cat: 'move', entry: 'replace', R: [0, -0.75, 0], rWin: [0.10, 0.30], ev: E('plantL', 0.08, 'plantL', 0.30, 'plantR', 0.34), ball: [[0, 'path'], [0.22, 'both'], [0.36, 'drib']], params: { imm: [0.08, 0.36], exitV: [0, 0] } },
  'move.jab': { dur: 0.35, cat: 'move', ev: E('plantR', 0.12, 'fake', 0.12), ball: [[0, 'both']] },
  'move.pumpFake': { dur: 0.40, cat: 'move', ev: E('fake', 0.12), ball: [[0, 'both']] },
  'move.rip': { dur: 0.30, cat: 'move', ball: [[0, 'both']] },
  'move.protect': { dur: 0.50, cat: 'move', layer: 'upper', mask: 'upper', loop: true, ball: [[0, 'drib']] },
  'move.backdown': { dur: 0.36, cat: 'move', entry: 'replace', R: [0, -0.25, 0], ev: E('contact', 0.18, 'contact', 0.36), ball: [[0, 'drib']] },
  'move.gather': { dur: 0.10, cat: 'move', layer: 'upper', mask: 'upper', ev: E('pickup', 0.10), ball: [[0, 'both']] },
  'post.faceUp': { dur: 0.35, cat: 'move', entry: 'replace', R: [0, 0, 180], ev: E('plantR', 0.30), ball: [[0, 'both']] },
  'sig.kyrie.hesiCross': { dur: 0.67, cat: 'move', entry: 'carry', R: [1.10, 1.60, 30], ev: E('plantR', 0.10, 'fake', 0.10, 'bounce', 0.22, 'handOnL', 0.27, 'plantR', 0.47), ball: [[0, 'path'], [0.27, 'L'], [0.47, 'drib']], params: { imm: [0.05, 0.40], exitV: [2.0, 5.0], carryScale: [[0, 0.17, 0.40]] }, tempo: false },
  'sig.kyrie.doubleBtlStepback': { dur: 0.53, cat: 'move', entry: 'carry', R: [0, 0.10, 0], ev: E('bounce', 0.10, 'handOnL', 0.20, 'bounce', 0.30, 'handOnR', 0.40, 'plantR', 0.43, 'fake', 0.43), ball: [[0, 'path'], [0.53, 'drib']], params: { imm: [0.05, 0.53] }, tempo: false },
  'sig.kobe.jabSeries': { dur: 0.53, cat: 'move', cancel: 0.47, ev: E('plantR', 0.12, 'fake', 0.12, 'fake', 0.40), ball: [[0, 'both']], tempo: false },
  'sig.kobe.jabGo': { dur: 0.40, cat: 'move', entry: 'replace', R: [0.10, 1.30, 0], ev: E('plantR', 0.20), ball: [[0, 'both'], [0.18, 'drib']], params: { exitV: [0, 4.5] }, tempo: false },
  'sig.kobe.pump': { dur: 0.30, cat: 'move', ev: E('fake', 0.18), ball: [[0, 'both']], tempo: false },
  'sig.kobe.hesiCrossStepback': { dur: 0.40, cat: 'move', entry: 'carry', cancel: 0.27, R: [0.30, 0.40, 0], ev: E('bounce', 0.13, 'handOnL', 0.20, 'plantL', 0.27), ball: [[0, 'path'], [0.20, 'drib']], tempo: false },
  'sig.jordan.jab': { dur: 0.47, cat: 'move', ev: E('plantR', 0.40, 'fake', 0.40), ball: [[0, 'both']], tempo: false },
  'sig.jordan.ripDrive': { dur: 0.45, cat: 'move', entry: 'replace', R: [-0.30, 0.80, 0], ev: E('plantR', 0.18), ball: [[0, 'both'], [0.18, 'drib']], params: { exitV: [-0.5, 4.8] }, tempo: false },
  'sig.lebron.powerDrive': { dur: 1.00, cat: 'move', entry: 'replace', R: [0.15, 5.20, 0], target: 'plantR', ev: E('fake', 0.10, 'plantL', 0.20, 'contact', 0.60, 'gather', 0.80, 'plantL', 1.00, 'plantR', 1.00), ball: [[0, 'drib'], [0.80, 'both']], tempo: false },
  'sig.giannis.elbowDrive': { dur: 0.83, cat: 'move', entry: 'replace', R: [0.20, 3.75, 0], target: 'plantR', ev: E('fake', 0.10, 'bounce', 0.30, 'plantL', 0.50, 'gather', 0.53, 'plantR', 0.83), ball: [[0, 'both'], [0.23, 'path'], [0.53, 'both']], tempo: false },
  'sig.yao.pumpHook': { dur: 0.20, cat: 'move', ev: E('fake', 0.10), ball: [[0, 'both']], tempo: false },
  // ---- defence ([ANIM §6], spec §4.10) ----
  'def.closeout': { dur: 0.60, cat: 'defence', entry: 'stop', entryDecel: 10, root: 'motion', R: [0, 0, 0] },
  'def.handUp': { dur: 1.00, cat: 'contest', layer: 'upper', mask: 'upper' },
  'def.steal': (p) => ({ dur: 0.42, cat: 'steal', entry: 'replace', R: [0, 0.30, 0], rWin: [0.04, 0.16], ev: E('swipe', p === 'kyrie' ? 0.10 : p === 'yao' || p === 'lebron' ? 0.14 : 0.12) }),
  'sig.jordan.steal': { dur: 0.42, cat: 'steal', entry: 'replace', R: [0, 0.30, 0], rWin: [0.04, 0.16], ev: E('swipe', 0.12), params: { exitV: [0, 4.0] }, tempo: false },
  'def.stealMiss': { dur: 0.35, cat: 'stun' },
  'def.boxout': { dur: 1.00, cat: 'defence', loop: true },
  'def.stumble': { dur: 0.40, cat: 'stun', entry: 'replace', R: [0.20, 0, 0], rWin: [0, 0.25] },
  'def.ankleFall': { dur: 1.60, cat: 'stun', entry: 'replace', R: [0.30, 0, 0], rWin: [0, 0.50], ev: [[0.50, 'fx', 'ooh']] },
  'def.bumped': { dur: 0.30, cat: 'stun', layer: 'add' },
  'loose.scoop': { dur: 0.30, cat: 'catch', ev: E('catch', 0.20), ball: [[0.20, 'both']] },
  // ---- passing ([ANIM §7], C6: release keys are warped to the GP release times by selectPass) ----
  'pass.chest': { dur: 0.45, cat: 'pass', ev: E('release', 0.10), ball: [[0, 'both'], [0.10, 'free']], meter: false },
  'pass.bounce': { dur: 0.45, cat: 'pass', ev: E('release', 0.12), ball: [[0, 'both'], [0.12, 'free']], meter: false },
  'pass.lob': { dur: 0.40, cat: 'pass', ev: E('release', 0.16), ball: [[0, 'both'], [0.16, 'free']], meter: false },
  'pass.overhead': { dur: 0.45, cat: 'pass', ev: E('release', 0.18), ball: [[0, 'both'], [0.18, 'free']], meter: false },
  'pass.push1': { dur: 0.30, cat: 'pass', layer: 'upper', mask: 'upper', ev: E('release', 0.08), ball: [[0, 'R'], [0.08, 'free']], meter: false },
  'sig.yao.overheadPass': { dur: 0.60, cat: 'pass', ev: E('release', 0.25), ball: [[0, 'both'], [0.25, 'free']], meter: false, tempo: false },
  'sig.lebron.skipPass': { dur: 0.55, cat: 'pass', layer: 'upper', mask: 'upper', ev: E('release', 0.16), ball: [[0, 'R'], [0.16, 'free']], meter: false, tempo: false },
  'sig.lebron.skipOverhead': { dur: 0.45, cat: 'pass', ev: E('release', 0.18), ball: [[0, 'both'], [0.18, 'free']], meter: false, tempo: false },
  // ---- catching ([ANIM §7.4]) ----
  'catch.ready': { dur: 0.30, cat: 'catch', layer: 'upper', mask: 'upper', loop: true },
  'catch.chest': { dur: 0.45, cat: 'catch', layer: 'upper', mask: 'upper', ev: E('catch', 0, 'ready', 0.30), ball: [[0, 'both']] },
  'catch.high': { dur: 0.45, cat: 'catch', layer: 'upper', mask: 'upper', ev: E('catch', 0, 'ready', 0.30), ball: [[0, 'both']] },
  'catch.low': { dur: 0.45, cat: 'catch', ev: E('catch', 0, 'ready', 0.30), ball: [[0, 'both']] },
  'catch.run': { dur: 0.45, cat: 'catch', layer: 'upper', mask: 'upper', ev: E('catch', 0, 'ready', 0.30), ball: [[0, 'both']] },
  // ---- celebrations ([ANIM §8.2]) and showcase ----
  'cel.kobe.jawJut': { dur: 1.50, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.kobe.fingerUp': { dur: 1.40, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.kobe.fistClench': { dur: 1.00, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.kobe.shrug': { dur: 1.00, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.jordan.shrug': { dur: 1.20, cat: 'cel', tempo: false, R: [0, 0, 30], rWin: [0, 0.30], entry: 'replace' },
  'cel.jordan.leapPump': { dur: 1.40, cat: 'cel', tempo: false, jump: { h: 0.30 }, ev: E('takeoff', 0.15, 'land', 0.15 + 2 * th(0.30)) },
  'cel.jordan.fistJog': { dur: 1.00, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.jordan.pointSmirk': { dur: 1.20, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.jordan.lastShot': { dur: 1.40, cat: 'cel', tempo: false },
  'cel.lebron.roar': { dur: 1.30, cat: 'cel', tempo: false },
  'cel.lebron.roarPound': { dur: 1.30, cat: 'cel', tempo: false },
  'cel.lebron.flexLite': { dur: 1.00, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.lebron.point': { dur: 0.90, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.lebron.fistPump': { dur: 0.50, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.giannis.flexRoar': { dur: 1.40, cat: 'cel', tempo: false },
  'cel.giannis.airplane': { dur: 1.20, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.giannis.chestThump': { dur: 0.90, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.giannis.fingerUp': { dur: 1.00, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.yao.fistPump': { dur: 1.20, cat: 'cel', tempo: false },
  'cel.yao.nod': { dur: 1.00, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.kyrie.holdFollow': { dur: 1.50, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.kyrie.skyPoint': { dur: 1.20, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.kyrie.shh': { dur: 1.20, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.kyrie.walkAway': { dur: 1.30, cat: 'cel', tempo: false, R: [0, 0.6, 150], entry: 'replace' },
  'cel.kyrie.bow': { dur: 0.60, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.highFive': { dur: 0.80, cat: 'cel', layer: 'upper', mask: 'upper' },
  'cel.block.yaoPoint': { dur: 0.90, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.block.stare': { dur: 0.80, cat: 'cel', layer: 'upper', mask: 'upper', tempo: false },
  'cel.lebron.chalk': { dur: 3.20, cat: 'cel', tempo: false, ev: [[2.45, 'fx', 'chalkBurst']] },
};

// ---- idle habits ([ANIM §8.3]): id → [player, weight, dur, condition] ----
const HABITS = [
  ['idle.kobe.neckRoll', 'kobe', 0.30, 2.0, ''], ['idle.kobe.fingerFlex', 'kobe', 0.30, 1.6, ''],
  ['idle.kobe.handsKnees', 'kobe', 0.25, 2.4, ''], ['idle.kobe.collarBite', 'kobe', 0.15, 2.0, ''],
  ['idle.kobe.floorSlap', 'kobe', 1.00, 0.9, 'onBallDef'],
  ['idle.jordan.shortsGrip', 'jordan', 0.40, 2.4, ''], ['idle.jordan.soleWipe', 'jordan', 0.25, 2.4, ''],
  ['idle.jordan.clap', 'jordan', 0.35, 0.6, 'toDefence'], ['idle.jordan.palmsFloor', 'jordan', 0.30, 0.9, 'onBallDef'],
  ['idle.lebron.headband', 'lebron', 0.30, 0.6, ''], ['idle.lebron.handsHips', 'lebron', 0.30, 2.0, ''],
  ['idle.lebron.handsKnees', 'lebron', 0.25, 2.4, ''], ['idle.lebron.shimmy', 'lebron', 0.15, 0.8, ''],
  ['idle.giannis.handsHips', 'giannis', 0.35, 2.0, ''], ['idle.giannis.bounceRoll', 'giannis', 0.35, 2.0, ''],
  ['idle.giannis.faceWipe', 'giannis', 0.15, 0.8, ''], ['idle.giannis.grin', 'giannis', 0.15, 1.5, ''],
  ['idle.yao.handsKnees', 'yao', 0.35, 2.4, ''], ['idle.yao.waistband', 'yao', 0.30, 0.8, ''],
  ['idle.yao.handsHips', 'yao', 0.20, 2.0, ''], ['idle.yao.puff', 'yao', 0.15, 0.6, ''],
  ['idle.kyrie.ballWrap', 'kyrie', 0.50, 1.6, 'ball'], ['idle.kyrie.fingerSpin', 'kyrie', 0.30, 1.4, 'ball'],
  ['idle.kyrie.handsHips', 'kyrie', 0.30, 2.0, 'noBall'], ['idle.kyrie.bounceWalk', 'kyrie', 0.30, 1.6, 'noBall'],
  ['idle.kyrie.chestTap', 'kyrie', 0.20, 1.0, 'noBall'], ['idle.kyrie.mouthguard', 'kyrie', 0.20, 1.2, 'noBall'],
];
for (const [id, , , dur, cond] of HABITS) {
  STATIC[id] = { dur, cat: 'idle', tempo: false, ball: cond === 'ball' ? [[0, 'path'], [dur, 'both']] : undefined };
}

/** Per-player defensive jumps (C8: h = hJump; signature heights fixed). */
function defJumpSpec(id, p) {
  const h = HJUMP[p];
  const mk = (cat, TO, hh, tail, extra = {}) => ({
    dur: TO + 2 * th(hh) + tail, cat, jump: { h: hh }, entry: extra.entry || 'stop', entryDecel: extra.decel || 30,
    root: extra.root || 'none', R: extra.R, tempo: false,
    ev: [[TO, 'takeoff'], [TO + th(hh), 'apex'], [TO + 2 * th(hh), 'land'], ...(extra.ev || [])],
  });
  switch (id) {
    case 'def.contest1': return mk('contest', 0.08, h, 0.20);
    case 'def.vertical': return mk('contest', 0.10, h, 0.40);
    case 'def.block1': return mk('block', p === 'yao' ? 0.13 : 0.08, h, 0.25);
    case 'reb.jump2': return mk('rebound', p === 'yao' ? 0.10 : 0.12, h, 0.45);
    case 'sig.lebron.chasedown': return mk('block', 0.13, 0.85, 0.34, { entry: 'carry', root: 'motion', R: [0, 0, 0], ev: E('plantR', 0, 'plantL', 0.13) });
    case 'sig.giannis.helpBlock': return mk('block', 0.15, 0.785, 0.35, { entry: 'carry', root: 'motion', R: [0, 0, 0], ev: E('plantR', 0, 'plantL', 0.08) });
    case 'sig.yao.vertical': return mk('contest', 0.13, h, 0.40);
    case 'sig.yao.block': return mk('block', 0.13, h, 0.40);
    case 'sig.yao.rebound': return mk('rebound', 0.10, h, 0.70);
    default: return null;
  }
}
const DEF_JUMP_IDS = ['def.contest1', 'def.vertical', 'def.block1', 'reb.jump2', 'sig.lebron.chasedown', 'sig.giannis.helpBlock', 'sig.yao.vertical', 'sig.yao.block', 'sig.yao.rebound'];

/** Catalog spec for clip id `id` and player p (null when unknown). */
function catalogSpec(id, p) {
  const rec = TABLE[p] && TABLE[p].BY_CLIP[id];
  if (rec && rec.spec) return rec.spec;
  // finishing clips of another player's table (e.g. a generic id only built for others) → first table that has it
  if (DEF_JUMP_IDS.includes(id)) return { id, ...defJumpSpec(id, p) };
  const s = STATIC[id];
  if (s) return { id, ...(typeof s === 'function' ? s(p) : s) };
  for (const q of PLAYER_IDS) { const r = TABLE[q].BY_CLIP[id]; if (r && r.spec) return r.spec; }
  return null;
}

/** Every clip id selectable by this module (the authoring list for WP3c's clips/*.js). */
export const CLIP_IDS = Object.freeze((() => {
  const s = new Set(Object.keys(STATIC));
  for (const id of DEF_JUMP_IDS) s.add(id);
  for (const p of PLAYER_IDS) for (const id of Object.keys(TABLE[p].BY_CLIP)) s.add(id);
  return [...s].sort();
})());
/** Same list (alias kept for readability where "catalog" is meant). */
export const CATALOG_IDS = CLIP_IDS;
for (const id of CLIP_IDS) clipIndex(id);       // reserve indices so selection never allocates

const PSEUDO = new Map();        // clipIdx → { [player]: [clip, clipL] }

/**
 * Clip used for timing by AnimProxy (and by Animator for clips without data): the registered compiled clip when
 * one exists, else the catalog timing clip of this player (built on first use; prepareTiming() pre-builds all).
 */
export function timingClip(clipIdx, playerId, mirror) {
  if (getDef(clipIdx, playerId)) return getClip(clipIdx, playerId, mirror);
  let m = PSEUDO.get(clipIdx);
  if (!m) { m = {}; PSEUDO.set(clipIdx, m); }
  let pair = m[playerId];
  if (!pair) {
    const spec = catalogSpec(clipIdOf(clipIdx), playerId);
    if (!spec) return null;
    const d = timingDef(spec);
    pair = m[playerId] = [compileClip(d), null, d];
  }
  if (mirror) return pair[1] || (pair[1] = compileClip(mirrorDef(pair[2])));
  return pair[0];
}

/** Pre-builds every catalog timing clip (both sides) for the given players. Returns the count. */
export function prepareTiming(playerIds = PLAYER_IDS) {
  let n = 0;
  for (const id of CLIP_IDS) {
    const idx = clipIndex(id);
    for (const p of playerIds) if (timingClip(idx, p, false)) { timingClip(idx, p, true); n += 2; }
  }
  return n;
}

const CAT_BY_IDX = [];
/** Category string of a clip ('jumper', 'layup', 'dunk', 'block', 'contest', 'rebound', 'steal', 'tip', ...). */
export function catOf(clipIdx) {
  let c = CAT_BY_IDX[clipIdx];
  if (c !== undefined) return c;
  const id = clipIdOf(clipIdx);
  const def = getDef(clipIdx);
  c = (def && def.params && def.params.cat) || '';
  if (!c) {
    const spec = catalogSpec(id, 'kobe') || catalogSpec(id, 'yao');
    c = (spec && (spec.cat || (spec.params && spec.params.cat))) || '';
  }
  if (!c) {
    c = id.startsWith('shot.') ? 'jumper' : id.startsWith('lay.') ? 'layup' : id.startsWith('dunk.') ? 'dunk'
      : id.startsWith('pass.') ? 'pass' : id.startsWith('move.') ? 'move' : id.startsWith('cel.') ? 'cel'
        : id.startsWith('idle.') ? 'idle' : id.startsWith('catch.') ? 'catch' : 'other';
  }
  CAT_BY_IDX[clipIdx] = c;
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// selectClip (spec §4.13, C14: the resolver decides kind/variant; this maps to a clip)
// ---------------------------------------------------------------------------------------------------------------

const pidOf = (player) => (typeof player === 'string' ? player : (player.legendId || (player.legend && player.legend.id) || player.id));

const SEL = { clipIdx: -1, mirror: false, warp: null, target: null, timing: null, clipId: '' };
const TGT = { x: 0, z: 0, yaw: 0 };

function lastMoveIs(ctx, id, maxAge) {
  return !!(ctx && ctx.lastMove && ctx.lastMove.id === id && (ctx.lastMove.age === undefined || ctx.lastMove.age <= maxAge));
}

/**
 * Maps the context resolver's { kind, variant, side, clipHint? } to a clip for this player. ctx (all optional):
 * { x, z (world position), rimX, rimZ, d, speed, lastMove: {id, age}, baseline (bool), blockSide ('L'|'R'),
 *   dribbleHand ('R'|'L') }. Returns the shared SEL object (overwritten by the next call; copy what you keep).
 */
export function selectClip(player, resolved, ctx) {
  const p = pidOf(player);
  const kind = resolved.kind;
  let variant = resolved.variant || '';
  const side = resolved.side === 'L' ? 'L' : 'R';
  let rec = null;
  if (resolved.clipHint) rec = timingByClip(p, resolved.clipHint);
  if (!rec) {
    switch (kind) {
      case 'jumper':
        if (variant === 'pull12' || variant === 'pullHop') {
          if (p === 'kobe' && lastMoveIs(ctx, 'sig.kobe.pump', 0.6)) variant = 'sideStepPullup';
          else if (p === 'kyrie' && lastMoveIs(ctx, 'move.btb', 0.25)) variant = 'btbPullup';
          else variant = (p === 'kyrie' || p === 'giannis' || (ctx && ctx.speed > 4)) ? 'pullHop' : 'pull12';
        }
        break;
      case 'fade':
        if (p === 'kobe' && ctx && ctx.baseline) variant = 'baseline';
        break;
      case 'stepback':
        variant = (p === 'kyrie' && lastMoveIs(ctx, 'sig.kyrie.doubleBtlStepback', 0.30))
          || (p === 'kobe' && lastMoveIs(ctx, 'sig.kobe.hesiCrossStepback', 0.30)) ? 'branch' : '';
        break;
      case 'turnFade':
        variant = (ctx && ctx.blockSide) || side;
        break;
      case 'hook':
        if (p === 'yao' && lastMoveIs(ctx, 'sig.yao.pumpHook', 0.6)) variant = 'upUnder';
        break;
      case 'layup':
        if (variant === 'std' || variant === 'fingerRoll') {
          const d = ctx && Number.isFinite(ctx.d) ? ctx.d : 3;
          if (d <= 2.5) variant = variant === 'std' ? 'std1' : 'fingerRoll1'; else variant = variant === 'std' ? 'std2' : 'fingerRoll';
        }
        if (variant === 'euro' && p === 'giannis' && ctx && ctx.d >= 5.4) variant = 'sigEuro';
        if (p === 'kobe' && ctx && ctx.baseline && (variant === 'std2' || variant === 'std1')) variant = 'baseline';
        break;
      default: break;
    }
    rec = getTiming(p, kind, variant);
  }
  if (!rec) { SEL.clipIdx = -1; SEL.timing = null; SEL.clipId = ''; SEL.target = null; SEL.warp = null; SEL.mirror = false; return SEL; }
  SEL.timing = rec;
  SEL.clipId = rec.clipId;
  SEL.clipIdx = clipIndex(rec.clipId);
  SEL.warp = rec.warp;
  // mirroring: shots are right-handed; finishes follow the hand side; post moves follow the block side
  if (kind === 'turnFade' || kind === 'hook') SEL.mirror = ((ctx && ctx.blockSide) || side) !== rec.baseSide;
  else if (kind === 'layup' || kind === 'dunk' || kind === 'floater' || kind === 'tip') SEL.mirror = side === 'L';
  else SEL.mirror = false;
  SEL.target = null;
  if (rec.dTO > 0 && ctx && Number.isFinite(ctx.x) && Number.isFinite(ctx.z)) {
    const rx = Number.isFinite(ctx.rimX) ? ctx.rimX : RIM_POS.x, rz = Number.isFinite(ctx.rimZ) ? ctx.rimZ : RIM_POS.z;
    const dx = ctx.x - rx, dz = ctx.z - rz, d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const ux = dx / d, uz = dz / d;
      // aim the takeoff at dTO from the rim, clamped into what target matching can bend the clip to
      // (|Δ| ≤ max(0.25 m, 35 % of the nominal travel), spec §4.4)
      let dist = rec.dTO;
      if (rec.toDist > 0) {
        const lim = Math.max(0.25, 0.35 * rec.toDist);
        const travel = Math.min(rec.toDist + lim, Math.max(rec.toDist - lim, d - rec.dTO));
        dist = d - travel;
      }
      TGT.x = rx + ux * dist; TGT.z = rz + uz * dist;
      TGT.yaw = Math.atan2(-ux, -uz);                     // facing the rim from the takeoff spot
      SEL.target = TGT;
    }
  }
  return SEL;
}

// ---------------------------------------------------------------------------------------------------------------
// selectMove (spec §4.8 table; tertiary tap on offence)
// ---------------------------------------------------------------------------------------------------------------

const MOVE_SEL = { clipIdx: -1, mirror: false, moveId: '' };
const MOVE_WEIGHTS = {
  kyrie: [['move.cross', 0.35], ['move.btl', 0.30], ['move.btb', 0.20], ['sig.kyrie.hesiCross', 0.15]],
  kobe: [['move.cross', 0.6], ['move.btl', 0.25], ['move.btb', 0.15]],
  jordan: [['move.cross', 0.6], ['move.btl', 0.25], ['move.btb', 0.15]],
  lebron: [['move.cross', 0.7], ['move.btl', 0.3]],
  giannis: [['move.cross', 1.0]],
  yao: [['move.cross', 1.0]],
};

function setMove(id, mirror) {
  MOVE_SEL.moveId = id; MOVE_SEL.clipIdx = clipIndex(id); MOVE_SEL.mirror = mirror;
  return MOVE_SEL;
}

/**
 * Dribble move / holding move for the tertiary tap. stick {lat, fwd} relative to the facing (lat > 0 = toward the
 * player's left). ctx { holding, speed, dribbleHand ('R'|'L'), post, defFront (m, defender in front), rng (gameplay
 * Rng with next() → [0, 1); the weighted rows use it) }. Moves are authored right → left: mirrored when the
 * dribble hand is the left. Returns the shared MOVE_SEL object.
 */
export function selectMove(player, stick, ctx = {}) {
  const p = pidOf(player);
  const lat = stick ? stick.lat || 0 : 0, fwd = stick ? stick.fwd || 0 : 0;
  const speed = ctx.speed || 0;
  const handL = ctx.dribbleHand === 'L' || ctx.dribbleHand === 2;
  const towardOff = handL ? lat < -0.45 : lat > 0.45;      // off hand = the hand without the ball
  const towardDrib = handL ? lat > 0.45 : lat < -0.45;
  if (ctx.holding) {
    if (fwd < -0.5) return setMove('move.pumpFake', false);
    return setMove(p === 'kobe' ? 'sig.kobe.jabSeries' : p === 'jordan' ? 'sig.jordan.jab' : 'move.jab', false);
  }
  if (p === 'yao') return setMove(ctx.post ? 'sig.yao.dropStep' : 'move.pumpFake', false);
  if (fwd < -0.5) return setMove(p === 'kyrie' && towardOff ? 'sig.kyrie.doubleBtlStepback' : 'move.stepback', handL);
  if (towardOff && speed > 3.5) {
    return setMove(p === 'kyrie' ? 'sig.kyrie.hesiCross' : p === 'kobe' ? 'sig.kobe.hesiCrossStepback' : 'move.cross', handL);
  }
  if (towardOff) {
    const w = MOVE_WEIGHTS[p];
    let u = ctx.rng && typeof ctx.rng.next === 'function' ? ctx.rng.next() : 0;
    for (let i = 0; i < w.length; i++) { u -= w[i][1]; if (u < 0 || i === w.length - 1) return setMove(w[i][0], handL); }
  }
  if (towardDrib && Number.isFinite(ctx.defFront) && ctx.defFront <= 1.2) return setMove('move.spin', handL);
  if (speed > 2.5) return setMove('move.hesi', handL);
  return setMove(p === 'kyrie' || p === 'kobe' || p === 'jordan' ? 'move.btl' : 'move.cross', handL);
}

// ---------------------------------------------------------------------------------------------------------------
// selectPass (C6 release times)
// ---------------------------------------------------------------------------------------------------------------

const PASS_SEL = { clipIdx: -1, mirror: false, passId: '', releaseT: 0, warp: null, layer: 'action', turn: 0, noLook: false };
const PASS_WARP = {};

/**
 * Pass clip and release time (s after the input, spec C6). ctx { dist, lob, bounce, post, doubled, chinned,
 * fromDribble, inHand (ball in the dribble hand), pickup (s until the next contact, ≤ 0.12), angle (target azimuth
 * relative to the facing, rad), speed, passRelease (attrs.passRelease; defaults to PASS_RELEASE), rng (cosmetic;
 * LeBron's 40 % no-look) }. warp = { RELEASE: releaseT } for play(). Returns the shared PASS_SEL object.
 */
export function selectPass(player, ctx = {}) {
  const p = pidOf(player);
  const pr = Number.isFinite(ctx.passRelease) ? ctx.passRelease : PASS_RELEASE[p];
  let id, rel;
  const moving = (ctx.speed || 0) > 0.5;
  if (p === 'lebron' && ctx.dist >= 8) { id = ctx.post ? 'sig.lebron.skipOverhead' : 'sig.lebron.skipPass'; rel = ctx.post ? 0.18 : 0.10; }
  else if (p === 'yao' && ctx.doubled) { id = 'sig.yao.overheadPass'; rel = ctx.chinned ? 0.20 : 0.25; }
  else if (ctx.lob) { id = 'pass.lob'; rel = pr + 0.06; }
  else if (ctx.post) { id = 'pass.overhead'; rel = pr + 0.08; }
  else if (ctx.fromDribble && moving) { id = 'pass.push1'; rel = ctx.inHand ? 0.08 : Math.min(0.20, Math.max(0.08, ctx.pickup || 0.20)); }
  else if (ctx.bounce) { id = 'pass.bounce'; rel = pr + 0.02; }
  else { id = 'pass.chest'; rel = pr; }
  if (ctx.fromDribble && id !== 'pass.push1' && id !== 'sig.lebron.skipPass') rel += Math.min(0.12, Math.max(0, ctx.pickup || 0));
  const ang = Math.abs(ctx.angle || 0);
  const turn = ang > Math.PI / 3 ? Math.min(0.12, (ang - Math.PI / 4) / 15) : 0;   // root yaw 15 rad/s, ≤ 0.12 s
  PASS_SEL.passId = id; PASS_SEL.clipIdx = clipIndex(id); PASS_SEL.mirror = false;
  PASS_SEL.releaseT = r3(rel + turn); PASS_SEL.turn = turn;
  PASS_SEL.layer = moving && (id === 'pass.chest' || id === 'pass.bounce' || id === 'pass.lob') ? 'upper'
    : (id === 'pass.push1' || id === 'sig.lebron.skipPass') ? 'upper' : 'action';
  PASS_SEL.noLook = p === 'lebron' && (id === 'sig.lebron.skipPass' || (ctx.rng && typeof ctx.rng.next === 'function' && ctx.rng.next() < 0.40));
  PASS_WARP[EV.RELEASE] = PASS_SEL.releaseT;
  PASS_SEL.warp = PASS_WARP;
  return PASS_SEL;
}

// ---------------------------------------------------------------------------------------------------------------
// selectDefJump (spec §4.10, C8)
// ---------------------------------------------------------------------------------------------------------------

const DEF_SEL = { clipIdx: -1, mirror: false, clipId: '', takeoffT: 0, h: 0, chase: false, entry: 'stop', layer: 'action' };

/**
 * Defensive jump / hands-up clip. ctx { intent: 'block' | 'contest' | 'rebound' | 'handUp', chase (from behind in
 * transition), help (help-side rim protection), arm ('R'|'L' — the defender arm that contests: clips are authored with
 * the right arm and mirrored for the left), hJump (attrs.hJump; defaults to HJUMP) }. Returns the shared DEF_SEL.
 */
export function selectDefJump(player, ctx = {}) {
  const p = pidOf(player);
  const hJ = Number.isFinite(ctx.hJump) ? ctx.hJump : HJUMP[p];
  let id, TO, h = hJ, entry = 'stop', layer = 'action';
  switch (ctx.intent) {
    case 'block':
      if (p === 'lebron' && ctx.chase) { id = 'sig.lebron.chasedown'; TO = 0.13; h = 0.85; entry = 'carry'; }
      else if (p === 'giannis' && (ctx.chase || ctx.help)) { id = 'sig.giannis.helpBlock'; TO = 0.15; h = 0.785; entry = 'carry'; }
      else if (p === 'yao') { id = 'sig.yao.block'; TO = 0.13; }
      else { id = 'def.block1'; TO = 0.08; if (ctx.chase) entry = 'carry'; }
      break;
    case 'rebound':
      if (p === 'yao') { id = 'sig.yao.rebound'; TO = 0.10; } else { id = 'reb.jump2'; TO = 0.12; }
      break;
    case 'handUp':
      id = 'def.handUp'; TO = 0; h = 0; layer = 'upper';
      break;
    default: // contest
      if (p === 'yao') { id = 'sig.yao.vertical'; TO = 0.13; }
      else if (p === 'giannis' && ctx.help) { id = 'def.vertical'; TO = 0.10; }
      else { id = 'def.contest1'; TO = 0.08; }
  }
  DEF_SEL.clipId = id; DEF_SEL.clipIdx = clipIndex(id); DEF_SEL.mirror = ctx.arm === 'L';
  DEF_SEL.takeoffT = TO; DEF_SEL.h = h; DEF_SEL.chase = !!ctx.chase; DEF_SEL.entry = entry; DEF_SEL.layer = layer;
  return DEF_SEL;
}

// ---------------------------------------------------------------------------------------------------------------
// selectCelebration (spec §4.11, [ANIM §8.2]) — cosmetic RNG
// ---------------------------------------------------------------------------------------------------------------

const CEL_SEL = { clipIdx: -1, mirror: false, celId: '', chainIdx: -1, face: '', faceW: 0, celebrate: false };
const CEL_P = { dunk: 0.85, clutch: 1.0, three: 0.6, tough: 0.5, normal: 0.2 };

function pick2(rng, a, pa, b) { return rng && rng.next() < pa ? a : (rng ? b : a); }

/**
 * Scorer / blocker celebration. ctx { cls: 'dunk'|'clutch'|'three'|'tough'|'normal', rng (cosmetic Rng), streak
 * (consecutive makes by him incl. this one), assisted, gameWinner, jumper (the make was a jump shot), blocker,
 * chaseDown }. celebrate false → nothing; clipIdx −1 with a face → face-only reaction. Returns the shared CEL_SEL.
 */
export function selectCelebration(player, ctx = {}) {
  const p = pidOf(player);
  const rng = ctx.rng && typeof ctx.rng.next === 'function' ? ctx.rng : null;
  CEL_SEL.clipIdx = -1; CEL_SEL.chainIdx = -1; CEL_SEL.celId = ''; CEL_SEL.face = ''; CEL_SEL.faceW = 0; CEL_SEL.mirror = false;
  let id = '', chain = '', face = '', faceW = 0;
  if (ctx.blocker) {
    if (p === 'yao') id = 'cel.block.yaoPoint';
    else if ((p === 'lebron' || p === 'giannis') && ctx.chaseDown) { id = 'cel.block.stare'; face = 'roar'; faceW = 0.8; }
    CEL_SEL.celebrate = !!(id || face);
  } else {
    const cls = CEL_P[ctx.cls] !== undefined ? ctx.cls : 'normal';
    CEL_SEL.celebrate = rng ? rng.next() < CEL_P[cls] : CEL_P[cls] >= 0.5;
    if (!CEL_SEL.celebrate) return CEL_SEL;
    if (p === 'kyrie' && ctx.streak >= 3) id = 'cel.kyrie.bow';
    else {
      switch (p) {
        case 'kobe':
          if (cls === 'dunk') id = 'cel.kobe.jawJut';
          else if (cls === 'clutch') id = pick2(rng, 'cel.kobe.fingerUp', 0.6, 'cel.kobe.fistClench');
          else if (cls === 'three') id = pick2(rng, 'cel.kobe.shrug', 0.5, 'cel.kobe.jawJut');
          else if (cls === 'tough') id = 'cel.kobe.shrug';
          else { face = 'jawJut'; faceW = 0.6; }
          break;
        case 'jordan':
          if (cls === 'dunk') id = 'cel.jordan.fistJog';
          else if (cls === 'clutch') id = ctx.gameWinner && ctx.jumper ? 'cel.jordan.lastShot' : 'cel.jordan.leapPump';
          else if (cls === 'three') id = ctx.streak >= 3 ? 'cel.jordan.shrug' : 'cel.jordan.pointSmirk';
          else if (cls === 'tough') id = 'cel.jordan.pointSmirk';
          else { face = 'smirk'; faceW = 0.5; }
          break;
        case 'lebron':
          if (cls === 'dunk') id = 'cel.lebron.roar';
          else if (cls === 'clutch') id = 'cel.lebron.roarPound';
          else if (cls === 'three') id = ctx.assisted ? 'cel.lebron.point' : 'cel.lebron.flexLite';
          else if (cls === 'tough') id = 'cel.lebron.flexLite';
          else id = 'cel.lebron.fistPump';
          break;
        case 'giannis':
          if (cls === 'dunk') id = 'cel.giannis.flexRoar';
          else if (cls === 'clutch') { id = 'cel.giannis.flexRoar'; chain = 'cel.giannis.chestThump'; }
          else if (cls === 'three') id = 'cel.giannis.airplane';
          else if (cls === 'tough') id = 'cel.giannis.chestThump';
          else id = 'cel.giannis.fingerUp';
          break;
        case 'yao':
          id = cls === 'dunk' || cls === 'clutch' ? 'cel.yao.fistPump' : 'cel.yao.nod';
          break;
        default: // kyrie
          if (cls === 'dunk') { face = 'smirk'; faceW = 0.8; }
          else if (cls === 'clutch') {
            const u = rng ? rng.next() : 0;
            id = u < 0.5 ? 'cel.kyrie.holdFollow' : u < 0.8 ? 'cel.kyrie.skyPoint' : 'cel.kyrie.shh';
          } else if (cls === 'three') id = pick2(rng, 'cel.kyrie.holdFollow', 0.6, 'cel.kyrie.skyPoint');
          else if (cls === 'tough') id = 'cel.kyrie.walkAway';
          else { face = 'smirk'; faceW = 0.8; }
      }
    }
  }
  if (id) { CEL_SEL.celId = id; CEL_SEL.clipIdx = clipIndex(id); }
  if (chain) CEL_SEL.chainIdx = clipIndex(chain);
  CEL_SEL.face = face; CEL_SEL.faceW = faceW;
  return CEL_SEL;
}

// ---------------------------------------------------------------------------------------------------------------
// selectIdleHabit ([ANIM §8.3]) — cosmetic RNG
// ---------------------------------------------------------------------------------------------------------------

const HABIT_SEL = { clipIdx: -1, habitId: '', dur: 0 };

/**
 * Idle habit for a stationary player in DEAD / CHECK / QUARTER_END. ctx { rng (cosmetic), hasBall, onBallDef (the
 * on-ball defender at CHECK), toDefence (just switched to defence), timeLeft (s until the state change; CHECK
 * habits need ≥ 1.0 s), check (bool) }. The 6 s per-player cooldown is the caller's. Returns HABIT_SEL (clipIdx −1
 * when nothing fits).
 */
export function selectIdleHabit(player, ctx = {}) {
  const p = pidOf(player);
  const rng = ctx.rng && typeof ctx.rng.next === 'function' ? ctx.rng : null;
  const left = Number.isFinite(ctx.timeLeft) ? ctx.timeLeft : Infinity;
  HABIT_SEL.clipIdx = -1; HABIT_SEL.habitId = ''; HABIT_SEL.dur = 0;
  if (ctx.check && left < 1.0) return HABIT_SEL;
  let total = 0;
  for (let i = 0; i < HABITS.length; i++) if (habitOk(HABITS[i], p, ctx, left)) total += HABITS[i][2];
  if (total <= 0) return HABIT_SEL;
  // a special row (floor slap, clap) wins outright when its condition holds and it fits
  for (let i = 0; i < HABITS.length; i++) {
    const h = HABITS[i];
    if ((h[4] === 'onBallDef' || h[4] === 'toDefence') && habitOk(h, p, ctx, left) && (!rng || rng.next() < h[2])) {
      HABIT_SEL.habitId = h[0]; HABIT_SEL.clipIdx = clipIndex(h[0]); HABIT_SEL.dur = h[3];
      return HABIT_SEL;
    }
  }
  let u = (rng ? rng.next() : 0) * total;
  for (let i = 0; i < HABITS.length; i++) {
    const h = HABITS[i];
    if (!habitOk(h, p, ctx, left) || h[4] === 'onBallDef' || h[4] === 'toDefence') continue;
    u -= h[2];
    if (u < 0) { HABIT_SEL.habitId = h[0]; HABIT_SEL.clipIdx = clipIndex(h[0]); HABIT_SEL.dur = h[3]; return HABIT_SEL; }
  }
  return HABIT_SEL;
}

function habitOk(h, p, ctx, left) {
  if (h[1] !== p || h[3] > left) return false;
  switch (h[4]) {
    case 'onBallDef': return !!ctx.onBallDef;
    case 'toDefence': return !!ctx.toDefence;
    case 'ball': return !!ctx.hasBall;
    case 'noBall': return !ctx.hasBall;
    default: return !ctx.hasBall;
  }
}
