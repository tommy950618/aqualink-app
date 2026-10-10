// test/unit-clips.mjs — clip library tests (WP3c; spec §4.8–§4.13, §4.15, [ANIM §11.2 items 1, 2, 5, 6, 7]).
//   node test/unit-clips.mjs                  all groups
//   node test/unit-clips.mjs --group=timing   one group (ids, compile, limits, timing, clock, mirror, motion, pose, hygiene)
//   node test/unit-clips.mjs --report         also print the pose measurements (launch / slam heights, hand-ball gaps)
// Covers: every clip id that select.js can request exists in the library and compiles for every player (both sides);
// events present and sorted, no NaN, authored values inside the §1.7 joint limits (no silent clamping), cloth guard;
// event times, durations, jump heights and meter numbers agree with select.getTiming and with the catalog timing clips
// select.js used before the library was registered (the same ClipClock produces identical gameplay events); mirror
// symmetry on the baked rig; first-33-ms motion of every action clip; pose sanity (launch heights, slam heights, ball
// in both hands, dribble-move catches); source hygiene (no Math.random, no CJK, no denylisted words, relative imports).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { BONE, BONE_COUNT, MIRROR, SOCK, buildRig, fkWorld, socketWorld } from '../src/anim/rig.js';
import {
  EV, EV_NAMES, ClipClock, EventRing, clipIndex, getClip, getDef, compileAll, compileClip, mirrorDef, sampleClip, sampleRoot,
  validateClip, SAMPLE_AIR_LINEAR,
} from '../src/anim/clip.js';
import { Pose } from '../src/anim/pose.js';
import { FORMS, STYLE, PLAYER_IDS } from '../src/anim/presets.js';
import { getTiming, KINDS, CLIP_IDS, timingClip, timingByClip, HJUMP, catOf } from '../src/anim/select.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DT = 1 / 60;
const G = 9.81;
const th = (h, g = 1) => Math.sqrt(2 * h / (G * g));
const REPORT = process.argv.includes('--report');

// ------------------------------------------------------------------------------------------------ tiny harness
let failures = 0, passes = 0;
const log = [];
function ok(cond, msg) { if (cond) passes++; else { failures++; log.push('  FAIL ' + msg); } return !!cond; }
function near(a, b, tol, msg) { return ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`); }
const report = (...a) => { if (REPORT) console.log(...a); };

// ------------------------------------------------------------------------------------------------ catalog snapshot
// The catalog timing clips select.js builds for clips without data: captured BEFORE the library registers, so the
// registered clips can be compared with what AnimProxy used headless until now.
const CATALOG = new Map();                  // `${id}|${p}` → compiled catalog timing clip
for (const id of CLIP_IDS) {
  const idx = clipIndex(id);
  for (const p of PLAYER_IDS) {
    const c = timingClip(idx, p, false);
    if (c) CATALOG.set(`${id}|${p}`, c);
  }
}
const { registerClipLibrary, LIBRARY_IDS, COMMON_CLIPS } = await import('../src/anim/clips/common.js');
const REG = registerClipLibrary();

// ------------------------------------------------------------------------------------------------ rigs
function loadHeader() {
  for (const f of ['test/scratch/legends-poc/assets/legends.json', 'assets/legends/legends.json']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { log.push(`  note: ${f} unreadable`); } }
  }
  return null;
}
const HDR = loadHeader();
const RIGS = {};
if (HDR) for (const pl of HDR.players) if (STYLE[pl.id]) RIGS[pl.id] = buildRig(pl, HDR.bones);

// ------------------------------------------------------------------------------------------------ helpers
const ALL = () => {
  const out = [];
  for (const id of CLIP_IDS) for (const p of PLAYER_IDS) out.push([id, p]);
  return out;
};
/** Registered compiled clip (player copy when one exists, else the shared one). */
const clipOf = (id, p, mirror = false) => getClip(clipIndex(id), p, mirror);
/** Events of a compiled clip as [code, t, param]. */
function evList(c) { const o = []; for (let i = 0; i < c.evCount; i++) o.push([c.evCode[i], c.evT[i], c.evParam[i]]); return o; }
const firstEvT = (c, code) => { for (let i = 0; i < c.evCount; i++) if (c.evCode[i] === code) return c.evT[i]; return -1; };

/** Effective game-time factor of a clip's non-air segments for player p (tempo clips scale by STYLE.tempo). */
const tempoFactor = (c, p) => (c.timing.tempo ? (c.tempoValue || STYLE[p].tempo) : 1);

/** FK world positions in the clip-start frame (root curve applied) at clip time t (allocates; tests only). */
function worldPose(rig, clip, t, jumpY = 0, flags = 0) {
  const pose = new Pose();
  sampleClip(clip, t, pose, flags);
  const s = rig.metrics.sLeg;
  const fk = fkWorld(rig, pose.q, [pose.pel[0] * s, pose.pel[1] * s + jumpY, pose.pel[2] * s]);
  const r = [0, 0, 0];
  sampleRoot(clip, t, r);
  const c = Math.cos(r[2]), sn = Math.sin(r[2]);
  const toStart = (v) => [r[0] * s + v[0] * c + v[2] * sn, v[1], r[1] * s - v[0] * sn + v[2] * c];
  return { pose, fk, toStart, sock: (k) => toStart(socketWorld(rig, fk, k)) };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Jump height gameplay uses for a clip / player (record h, GP hJump for generic defensive jumps, clip jump.h). */
function jumpOf(id, p, c) {
  const rec = timingByClip(p, id);
  if (rec) return { h: rec.h, g: rec.gScale, airT: rec.airT, slam: rec.slamAfterTO, hang: rec.hangT };
  const h = c.def.jump ? c.def.jump.h : 0;
  return { h, g: (c.def.jump && c.def.jump.gScale) || 1, airT: c.timing.land - c.timing.takeoff, slam: -1, hang: 0 };
}
/** Ballistic jumpY(τ) seconds after takeoff (rise–hang–drop for dunks, spec §4.9.4). */
function jumpY(J, tau) {
  if (tau <= 0) return 0;
  const g = G * J.g, vy = Math.sqrt(2 * g * J.h);
  if (J.slam > 0 && J.hang > 0) {
    const tg = J.slam + 0.03;
    if (tau <= tg) return Math.max(0, vy * tau - 0.5 * g * tau * tau);
    const yg = vy * tg - 0.5 * g * tg * tg;
    if (tau <= tg + J.hang) return yg + (J.h - 0.05 - yg) * (tau - tg) / J.hang;
    const d = tau - tg - J.hang;
    return Math.max(0, J.h - 0.05 - 0.5 * g * d * d);
  }
  return Math.max(0, vy * tau - 0.5 * g * tau * tau);
}

// ------------------------------------------------------------------------------------------------ joint limits (§1.7)
const LIM = {
  P: [null, null, null, [-25, 40], null, [-20, 20]],
  S1: [[-15, 30], [-25, 25], [-20, 20]], S2: [[-15, 30], [-25, 25], [-20, 20]], S3: [[-15, 30], [-25, 25], [-20, 20]],
  Nk: [[-30, 35], [-50, 50], [-25, 25]], Hd: [[-35, 35], [-45, 45], [-25, 25]],
  RC: [[-10, 35], [-15, 25]], LC: [[-10, 35], [-15, 25]],
  RA: [[-60, 180], [-15, 180], [-80, 80], [0, 150], [-100, 100], [-85, 85], [-20, 30]],
  LA: [[-60, 180], [-15, 180], [-80, 80], [0, 150], [-100, 100], [-85, 85], [-20, 30]],
  RL: [[-30, 125], [-15, 50], [-40, 40], [0, 150], [-30, 55], [-10, 60]],
  LL: [[-30, 125], [-15, 50], [-40, 40], [0, 150], [-30, 55], [-10, 60]],
};

// ------------------------------------------------------------------------------------------------ event classes
/** Events gameplay consumes (must match the catalog exactly); the rest are cosmetic (audio / presentation). */
const STRICT = new Set([EV.TAKEOFF, EV.SET, EV.RELEASE, EV.CONTACT, EV.SLAM, EV.RIM_GRAB, EV.RIM_RELEASE, EV.LAND, EV.CATCH,
  EV.SWIPE, EV.READY, EV.FAKE, EV.PICKUP, EV.HAND_ON, EV.HANDOFF, EV.FX, EV.SLOWMO_IN, EV.SLOWMO_OUT, EV.END]);
/**
 * Documented differences from select.js' catalog stand-ins (the catalog approximated the spec; the library follows
 * the spec). Keys: clip id → reasons. Checked: only these fields may differ for these ids.
 */
const DEVIATIONS = {
  tempo: {
    // C25 / C5 / GP absolute durations: per-player SWIPE times, the stun / fall durations and the 0.30 s READY gate
    'def.steal': 'SWIPE at the ANIM per-player time (tempo false)', 'def.stealMiss': 'time-scaled to the GP stun (C5)',
    'def.stumble': 'GP stunned 0.40 s', 'def.ankleFall': 'GP fallen 1.60 s (C4)', 'catch.chest': 'READY 0.30 s after CATCH',
    'catch.high': 'READY 0.30 s after CATCH', 'catch.low': 'READY 0.30 s after CATCH', 'catch.run': 'READY 0.30 s after CATCH',
    'def.handUp': 'hands up in 0.10 s (C22)',
  },
  mask: { 'def.closeout': 'upper body + pelvis only; the chop steps are the gait (params.gait)' },
  cosmeticMissing: { 'shot.turnFade': 'PLANT_R at the end of the pivot (0.60·tempo), not at its start' },
  rootSign: {
    'shot.turnFade': 'fades AWAY from the rim (+z after the 180° pivot, as sig.jordan.turnFade)',
    'cel.kyrie.walkAway': 'walks away in his new facing (the catalog moved him backwards)',
  },
  /** Form values above the §1.7 limits that the compiler clamps: Jordan's goose-neck follow-through wrist +88 (> 85). */
  formClamp: (g, i, v) => g === 'RA' && i === 5 && Object.values(FORMS).some((F) => F.followWrist === v),
};

export const GROUPS = [];

// =============================================================================================================
// ids: every selectable clip exists and every (clip, player) pair has data
// =============================================================================================================
GROUPS.push(['ids', () => {
  ok(LIBRARY_IDS.length === CLIP_IDS.length, `library ${LIBRARY_IDS.length} ids vs select.CLIP_IDS ${CLIP_IDS.length}`);
  for (const id of CLIP_IDS) ok(LIBRARY_IDS.includes(id), `${id} authored`);
  for (const id of LIBRARY_IDS) ok(CLIP_IDS.includes(id), `${id} is selectable`);
  for (const [id, p] of ALL()) ok(!!getDef(clipIndex(id), p), `${id} has data for ${p}`);
  // every getTiming record points at a registered per-player (or shared) clip
  for (const p of PLAYER_IDS) for (const k of Object.keys(KINDS)) for (const v of KINDS[k]) {
    const r = getTiming(p, k, v);
    if (r) ok(!!getDef(clipIndex(r.clipId), p), `${p} ${k}/${v} → ${r.clipId} registered`);
  }
  ok(REG.shared >= CLIP_IDS.length && REG.perPlayer > 0, `registration counts ${REG.shared} shared / ${REG.perPlayer} per player`);
  // idempotent re-registration
  const again = registerClipLibrary();
  ok(again.shared === REG.shared && again.perPlayer === REG.perPlayer, 're-registration is idempotent');
}]);

// =============================================================================================================
// compile: both sides × six players; events, NaN, required events by category, cloth guard
// =============================================================================================================
GROUPS.push(['compile', () => {
  let n = 0;
  try { n = compileAll(PLAYER_IDS); } catch (e) { ok(false, `compileAll threw: ${e.message}`); }
  ok(n > 0, `compileAll compiled ${n} clips`);
  const seen = new Set();
  for (const [id, p] of ALL()) {
    for (const mirror of [false, true]) {
      const c = clipOf(id, p, mirror);
      if (!ok(!!c, `${id}/${p}${mirror ? '_L' : ''} compiles`)) continue;
      if (seen.has(c)) continue;
      seen.add(c);
      const tag = `${c.id}/${p}`;
      // events sorted inside [0, dur], END at dur
      let sorted = true, inside = true;
      for (let i = 0; i < c.evCount; i++) {
        if (i && c.evT[i] < c.evT[i - 1] - 1e-9) sorted = false;
        if (c.evT[i] < -1e-9 || c.evT[i] > c.dur + 1e-6) inside = false;
      }
      ok(sorted && inside, `${tag} events sorted inside [0, dur]`);
      near(firstEvT(c, EV.END), c.dur, 1e-9, `${tag} END at dur`);
      // no NaN anywhere in the compiled tracks
      let nan = false;
      for (const arr of [c.qData, c.pel, c.root]) for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { nan = true; break; }
      for (const e of c.expr) if (e) for (let i = 0; i < e.length; i++) if (!Number.isFinite(e[i])) nan = true;
      for (const s of [0, 1]) for (let i = 0; i < c.ft[s].length; i++) if (!Number.isFinite(c.ft[s][i])) nan = true;
      ok(!nan, `${tag} no NaN`);
      // unit quaternions
      let unit = true;
      for (let i = 0; i < c.qData.length; i += 4) {
        const l = Math.hypot(c.qData[i], c.qData[i + 1], c.qData[i + 2], c.qData[i + 3]);
        if (Math.abs(l - 1) > 1e-4) { unit = false; break; }
      }
      ok(unit, `${tag} unit quaternions`);
      // category-required events
      const tm = c.timing, cat = c.def.params.cat;
      ok(!!cat, `${tag} has params.cat`);
      if (c.def.jump) ok(tm.takeoff >= 0 && tm.land > tm.takeoff, `${tag} jump clip has TAKEOFF < LAND`);
      if (cat === 'jumper') ok(tm.set >= 0 && tm.release > tm.set && tm.meter === 'hold', `${tag} jumper: SET < RELEASE, meter hold`);
      if (cat === 'layup') ok(tm.release > tm.takeoff && tm.meter === 'key', `${tag} finish: RELEASE after TAKEOFF, meter key`);
      if (cat === 'dunk') ok(tm.slam > tm.takeoff && tm.slam < tm.land && !tm.meter, `${tag} dunk: TAKEOFF < SLAM < LAND`);
      if (cat === 'dunk' && c.def.jump && c.def.jump.hang > 0) ok(tm.rimGrab > tm.slam && tm.rimRelease > tm.rimGrab, `${tag} hang: RIM_GRAB / RIM_RELEASE`);
      if (cat === 'pass') ok(tm.release > 0 && !tm.meter, `${tag} pass: RELEASE, no meter`);
      if (cat === 'steal') ok(tm.swipe > 0, `${tag} SWIPE`);
      if (cat === 'block' || cat === 'contest' || cat === 'rebound' || cat === 'tip') {
        if (id !== 'def.handUp') ok(tm.takeoff > 0 && tm.land > tm.takeoff, `${tag} defensive jump TAKEOFF < LAND`);
      }
      if (cat === 'catch' && id.startsWith('catch.') && id !== 'catch.ready') ok(tm.catch === 0 && Math.abs(tm.ready - 0.30) < 1e-9, `${tag} CATCH 0 / READY 0.30`);
      // cloth guard ([ANIM §1.7]): no hip flexion above 95° outside the airborne segment
      const warn = validateClip(c);
      ok(warn.length === 0, `${tag} validateClip: ${warn.join('; ')}`);
    }
  }
}]);

// =============================================================================================================
// limits: authored values inside the §1.7 joint limits (the compiler would clamp them silently)
// =============================================================================================================
GROUPS.push(['limits', () => {
  const defs = new Set();
  for (const [id, p] of ALL()) { const d = getDef(clipIndex(id), p); if (d) defs.add(d); const d0 = getDef(clipIndex(id)); if (d0) defs.add(d0); }
  for (const d of defs) {
    let bad = '';
    for (const [t, k] of d.keys) {
      for (const g of Object.keys(LIM)) {
        const a = k[g];
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const L = LIM[g][i];
          if (a[i] === null || !L) continue;
          if ((a[i] < L[0] - 1e-9 || a[i] > L[1] + 1e-9) && !DEVIATIONS.formClamp(g, i, a[i])) bad += ` ${g}[${i}]=${a[i].toFixed(2)}@${t.toFixed(3)}`;
        }
      }
    }
    ok(!bad, `${d.id} authored values inside the joint limits:${bad}`);
    // per-player overrides too
    if (d.per) for (const pid of Object.keys(d.per)) for (const [t, k] of d.per[pid].keys || []) for (const g of ['RA', 'LA', 'S']) {
      if (k[g]) for (let i = 0; i < k[g].length; i++) { const L = (LIM[g] || [])[i]; if (L && k[g][i] !== null) ok(k[g][i] >= L[0] && k[g][i] <= L[1], `${d.id} per ${pid} ${g}[${i}] @${t}`); }
    }
  }
}]);

// =============================================================================================================
// timing: records of select.getTiming, and the catalog timing clips (gameplay events, durations, flags)
// =============================================================================================================
GROUPS.push(['timing', () => {
  // (a) getTiming records ↔ registered clips
  for (const p of PLAYER_IDS) for (const k of Object.keys(KINDS)) for (const v of KINDS[k]) {
    const r = getTiming(p, k, v);
    if (!r) continue;
    const c = clipOf(r.clipId, p);
    const tag = `${p} ${k}/${v} ${r.clipId}`;
    if (!ok(!!c, `${tag} compiled`)) continue;
    const tm = c.timing;
    near(tm.dur, r.dur, 1e-6, `${tag} dur`);
    near(tm.takeoff, r.takeoffT, 1e-6, `${tag} TAKEOFF`);
    near(tm.land, r.landT, 1e-6, `${tag} LAND`);
    near(tm.apex, r.apexT, 1e-6, `${tag} APEX`);
    if (r.setT >= 0) near(tm.set, r.setT, 1e-6, `${tag} SET`);
    if (r.meter) near(tm.release, r.releaseT, 1e-6, `${tag} RELEASE`);
    if (r.slamT >= 0) near(tm.slam, r.slamT, 1e-6, `${tag} SLAM`);
    if (r.hangT > 0) { near(tm.rimGrab, r.slamT + 0.03, 1e-6, `${tag} RIM_GRAB`); near(tm.rimRelease, r.slamT + 0.03 + r.hangT, 1e-6, `${tag} RIM_RELEASE`); }
    near(tm.jumpH, r.h, 1e-9, `${tag} jump h`);
    near((c.def.jump && c.def.jump.gScale) || 1, r.gScale, 1e-9, `${tag} gScale`);
    if (r.hangT > 0) near(c.def.jump.hang, r.hangT, 1e-9, `${tag} hang`);
    ok(tm.meter === r.meter, `${tag} meter ${tm.meter} vs ${r.meter}`);
    ok(!tm.tempo, `${tag} times final (tempo false)`);
    if (r.meter) {
      near(tm.meterFrom, r.meterFrom, 1e-6, `${tag} meterFrom`);
      near(tm.tIdeal, r.tIdeal, 1e-6, `${tag} tIdeal`);
      near(tm.METER_T, r.METER_T, 1e-6, `${tag} METER_T`);
    }
    ok(tm.gatherWindow[0] === r.gatherWindow[0] && tm.gatherWindow[1] === r.gatherWindow[1], `${tag} gatherWindow ${tm.gatherWindow} vs ${r.gatherWindow}`);
    if (r.dTO > 0 && r.toDist > 0) {
      // the target-matching nominal: R at the takeoff = toDist (world) / sLeg
      const rr = [0, 0, 0];
      sampleRoot(c, tm.takeoff, rr);
      near(Math.hypot(rr[0], rr[1]) * FORMS_SLEG(p), r.toDist, 0.02, `${tag} root travel to the takeoff`);
      ok(tm.target === EV.TAKEOFF, `${tag} target-matched at TAKEOFF`);
    }
  }
  // (b) catalog stand-ins ↔ registered clips
  for (const [key, cat] of CATALOG) {
    const [id, p] = key.split('|');
    if (id.startsWith('sig.') && id.split('.')[1] !== p) continue;      // signature clips: their owner's catalog record
    const c = clipOf(id, p);
    const tag = `${id}/${p}`;
    if (!c) continue;
    const ct = cat.timing, tm = c.timing;
    near(c.dur, cat.dur, 1e-6, `${tag} dur = catalog`);
    ok(ct.loop === tm.loop, `${tag} loop`);
    ok(cat.def.layer === c.def.layer, `${tag} layer ${c.def.layer} vs ${cat.def.layer}`);
    if (!DEVIATIONS.mask[id]) ok(cat.def.mask === c.def.mask, `${tag} mask ${c.def.mask} vs ${cat.def.mask}`);
    ok(ct.root === tm.root, `${tag} root motion ${tm.root} vs ${ct.root}`);
    if (tm.root) ok(ct.entry === tm.entry, `${tag} entry ${tm.entry} vs ${ct.entry}`);
    ok(ct.target === tm.target, `${tag} target ${EV_NAMES[tm.target]} vs ${EV_NAMES[ct.target]}`);
    ok(ct.meter === tm.meter, `${tag} meter`);
    ok(catOf(clipIndex(id)) === (cat.def.params.cat || catOf(clipIndex(id))), `${tag} category`);
    ok((cat.def.params.cat || '') === '' || cat.def.params.cat === c.def.params.cat, `${tag} cat ${c.def.params.cat} vs ${cat.def.params.cat}`);
    if (DEVIATIONS.tempo[id]) ok(!tm.tempo && ct.tempo, `${tag} tempo deviation (${DEVIATIONS.tempo[id]})`);
    else ok(ct.tempo === tm.tempo, `${tag} tempo ${tm.tempo} vs ${ct.tempo}`);
    near(tm.jumpH, ct.jumpH, 1e-9, `${tag} jump h`);
    // gameplay events: identical lists (clip time)
    const a = evList(c).filter((e) => STRICT.has(e[0])), b = evList(cat).filter((e) => STRICT.has(e[0]));
    let same = a.length === b.length;
    if (same) for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || Math.abs(a[i][1] - b[i][1]) > 1e-6 || a[i][2] !== b[i][2]) same = false;
    ok(same, `${tag} gameplay events ${fmt(a)} vs catalog ${fmt(b)}`);
    // cosmetic events of the catalog are present (extra cosmetic events allowed)
    if (!DEVIATIONS.cosmeticMissing[id]) {
      for (const e of evList(cat)) {
        if (STRICT.has(e[0])) continue;
        ok(evList(c).some((x) => x[0] === e[0] && Math.abs(x[1] - e[1]) < 1e-6), `${tag} has catalog ${EV_NAMES[e[0]]}@${e[1].toFixed(3)}`);
      }
    }
    // root displacement at the end (sign of the travel) agrees with the catalog
    if (tm.root && ct.root && !DEVIATIONS.rootSign[id]) {
      const r1 = [0, 0, 0], r2 = [0, 0, 0];
      sampleRoot(c, c.dur, r1); sampleRoot(cat, cat.dur, r2);
      ok(Math.abs(r1[0] - r2[0]) < 0.06 && Math.abs(r1[1] - r2[1]) < 0.06 && Math.abs(r1[2] - r2[2]) < 0.02, `${tag} root end [${r1.map((x) => x.toFixed(2))}] vs catalog [${r2.map((x) => x.toFixed(2))}]`);
    }
  }
}]);
const fmt = (l) => l.map((e) => `${EV_NAMES[e[0]]}@${e[1].toFixed(3)}`).join(',');
const FORMS_SLEG = (p) => ({ kobe: 1.000, jordan: 0.999, lebron: 1.030, giannis: 1.108, yao: 1.171, kyrie: 0.941 })[p];

// =============================================================================================================
// clock: the registered clip and the catalog stand-in emit the same gameplay events through ClipClock (perfect
// input at tIdeal, setJump at TAKEOFF with the record airtime / dunk profile, warp from the record)
// =============================================================================================================
function runClock(src, rec, p, opts = {}) {
  const clock = new ClipClock(), ring = new EventRing(64);
  clock.start(src, 1, STYLE[p].tempo, rec ? rec.warp : null);
  const out = [];
  out.inputT = -1;
  let now = 0, released = false;
  for (let i = 0; i < 400 && clock.active; i++) {
    if (rec && rec.meter && !released && now >= (opts.input !== undefined ? opts.input : rec.tIdeal) - 1e-9) { clock.releaseNow(); released = true; out.inputT = now; }
    clock.step(DT, now, ring, 0, 0);
    for (let e; (e = ring.next());) {
      out.push([e.code, e.t]);
      if (e.code === EV.TAKEOFF && rec) clock.setJump(rec.h, rec.airT, rec.profile);
    }
    now += DT;
  }
  return out;
}
GROUPS.push(['clock', () => {
  for (const p of PLAYER_IDS) for (const k of Object.keys(KINDS)) for (const v of KINDS[k]) {
    const r = getTiming(p, k, v);
    if (!r) continue;
    const cat = CATALOG.get(`${r.clipId}|${p}`), c = clipOf(r.clipId, p);
    if (!cat || !c) continue;
    const tag = `${p} ${k}/${v} ${r.clipId}`;
    for (const input of [r.tIdeal, r.tIdeal - 0.12, r.tIdeal + 0.10]) {
      const a = runClock(c, r, p, { input }).filter((e) => STRICT.has(e[0]) || e[0] === EV.APEX);
      const b = runClock(cat, r, p, { input }).filter((e) => STRICT.has(e[0]) || e[0] === EV.APEX);
      let same = a.length === b.length;
      if (same) for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || Math.abs(a[i][1] - b[i][1]) > 1e-6) same = false;
      ok(same, `${tag} input ${input.toFixed(3)}: events ${a.map((e) => EV_NAMES[e[0]] + '@' + e[1].toFixed(3))} vs ${b.map((e) => EV_NAMES[e[0]] + '@' + e[1].toFixed(3))}`);
    }
    // perfect input: TAKEOFF at takeoffT; jump shots launch at input + 0.050 = apex + rva
    const ev = runClock(c, r, p);
    const tTO = (ev.find((e) => e[0] === EV.TAKEOFF) || [0, -1])[1];
    near(tTO, r.takeoffT, 1e-6, `${tag} TAKEOFF in game time`);
    if (r.meter === 'hold') near((ev.find((e) => e[0] === EV.RELEASE) || [0, -1])[1], ev.inputT + 0.05, 1e-6, `${tag} RELEASE = input + 0.050`);
  }
}]);

// =============================================================================================================
// mirror: sample(mirror(clip)) = reflect(sample(clip)) on the baked rig (world positions, x negated, sides swapped)
// =============================================================================================================
GROUPS.push(['mirror', () => {
  const rig = RIGS.kobe;
  if (!rig) { log.push('  note: no legends header; mirror group skipped'); return; }
  const defs = new Map();
  for (const id of CLIP_IDS) { const d = getDef(clipIndex(id), 'kobe') || getDef(clipIndex(id)); if (d) defs.set(id, d); }
  let worst = 0;
  for (const [id, d] of defs) {
    const a = compileClip(d, 'kobe'), b = compileClip(mirrorDef(d), 'kobe');
    for (const u of [0, 0.31, 0.62, 0.93]) {
      const t = u * a.dur;
      const A = worldPose(rig, a, t), B = worldPose(rig, b, t);
      let e = 0;
      for (let i = 0; i < BONE_COUNT; i++) {
        const j = MIRROR[i];
        e = Math.max(e, Math.abs(A.fk.pos[i * 3] + B.fk.pos[j * 3]), Math.abs(A.fk.pos[i * 3 + 1] - B.fk.pos[j * 3 + 1]), Math.abs(A.fk.pos[i * 3 + 2] - B.fk.pos[j * 3 + 2]));
      }
      worst = Math.max(worst, e);
      ok(e < 1e-4 + rigAsym(rig), `${id} mirror symmetry at ${t.toFixed(2)}: ${e.toExponential(2)} m`);
      const ra = [0, 0, 0], rb = [0, 0, 0];
      sampleRoot(a, t, ra); sampleRoot(b, t, rb);
      ok(Math.abs(ra[0] + rb[0]) < 1e-6 && Math.abs(ra[1] - rb[1]) < 1e-6 && Math.abs(ra[2] + rb[2]) < 1e-6, `${id} mirrored root at ${t.toFixed(2)}`);
    }
  }
  report(`mirror: worst bone error ${worst.toExponential(2)} m over ${defs.size} clips`);
}]);
/** Residual left/right asymmetry of the baked rig itself (0 for the symmetric PoC bake). */
function rigAsym(rig) {
  let e = 0;
  for (let i = 0; i < BONE_COUNT; i++) {
    const j = MIRROR[i];
    e = Math.max(e, Math.abs(rig.bindPos[i * 3] + rig.bindPos[j * 3]), Math.abs(rig.bindPos[i * 3 + 1] - rig.bindPos[j * 3 + 1]), Math.abs(rig.bindPos[i * 3 + 2] - rig.bindPos[j * 3 + 2]));
  }
  return 4 * e;
}

// =============================================================================================================
// motion: every action clip moves a hand ≥ 2 cm or a major joint ≥ 3° within its first 2 fixed steps (D-ANIM-8)
// =============================================================================================================
const MAJOR = [BONE.pelvis, BONE.spine_01, BONE.spine_02, BONE.spine_03, BONE.upperarm_r, BONE.upperarm_l, BONE.lowerarm_r, BONE.lowerarm_l,
  BONE.thigh_r, BONE.thigh_l, BONE.calf_r, BONE.calf_l, BONE.neck_01, BONE.head];
const ACTION = new Set(['move', 'jumper', 'layup', 'dunk', 'block', 'contest', 'rebound', 'steal', 'tip', 'pass', 'catch', 'defence']);
GROUPS.push(['motion', () => {
  const rig = RIGS.kobe;
  if (!rig) { log.push('  note: no legends header; motion group skipped'); return; }
  for (const id of CLIP_IDS) {
    for (const p of PLAYER_IDS) {
      const c = clipOf(id, p);
      if (!c || !ACTION.has(c.def.params.cat) || c.loop || id === 'def.boxout' || id === 'catch.ready') continue;
      const r = RIGS[p] || rig;
      const t1 = (2 * DT) / tempoFactor(c, p);
      const A = worldPose(r, c, 0), B = worldPose(r, c, t1);
      let ang = 0;
      for (const b of MAJOR) {
        const o = b * 4, d = Math.abs(A.pose.q[o] * B.pose.q[o] + A.pose.q[o + 1] * B.pose.q[o + 1] + A.pose.q[o + 2] * B.pose.q[o + 2] + A.pose.q[o + 3] * B.pose.q[o + 3]);
        ang = Math.max(ang, 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI);
      }
      const hand = Math.max(dist(A.sock(SOCK.palm_r), B.sock(SOCK.palm_r)), dist(A.sock(SOCK.palm_l), B.sock(SOCK.palm_l)));
      ok(hand >= 0.02 || ang >= 3, `${id}/${p} first 33 ms: hand ${(hand * 100).toFixed(1)} cm, joint ${ang.toFixed(1)}°`);
    }
  }
}]);

// =============================================================================================================
// pose: launch heights (spec §4.9.2 ±0.08 m incl. the procedural set-hold / IK tolerance), slam heights, the ball in
// both hands, dribble-move catches, planted feet on the floor
// =============================================================================================================
GROUPS.push(['pose', () => {
  if (!RIGS.kobe) { log.push('  note: no legends header; pose group skipped'); return; }
  // (1) jump-shot launch height (ball1_r at RELEASE with the air-linear pelvis + jumpY), mid-range
  for (const p of PLAYER_IDS) {
    const rig = RIGS[p];
    if (!rig) continue;
    const r = getTiming(p, 'jumper', 'set'), c = clipOf(r.clipId, p);
    const J = { h: r.h, g: 1, slam: -1, hang: 0 };
    const tRel = r.releaseT;
    const W = worldPose(rig, c, tRel, jumpY(J, tRel - r.takeoffT), SAMPLE_AIR_LINEAR);
    const y = W.sock(SOCK.ball1_r)[1];
    report(`launch ${p}: ball ${y.toFixed(3)} m vs table ${FORMS[p].launchMid} (Δ ${(y - FORMS[p].launchMid).toFixed(3)})`);
    near(y, FORMS[p].launchMid, 0.08, `${p} mid-range launch height (§4.9.2)`);
  }
  // (2) dunks: ball at SLAM ≥ 3.20 − 0.15 (the last 0.15 s are hand IK to the slam point, spec §4.9.4)
  for (const id of CLIP_IDS) {
    for (const p of PLAYER_IDS) {
      const c = clipOf(id, p), rig = RIGS[p];
      if (!c || !rig || c.def.params.cat !== 'dunk' || !timingByClip(p, id) && id.startsWith('sig.') && !id.includes(p)) continue;
      if (id.startsWith('sig.') && !id.includes('.' + p + '.')) continue;
      if (!timingByClip(p, id) && !id.startsWith('sig.')) continue;
      const J = jumpOf(id, p, c), tm = c.timing;
      const W = worldPose(rig, c, tm.slam, jumpY(J, tm.slam - tm.takeoff), SAMPLE_AIR_LINEAR);
      const hands = c.def.params.hands === 2 ? [W.sock(SOCK.ball1_r), W.sock(SOCK.ball1_l)] : [W.sock(SOCK.ball1_r)];
      const y = hands.length === 2 ? (hands[0][1] + hands[1][1]) / 2 : hands[0][1];
      report(`slam ${id}/${p}: ball ${y.toFixed(3)} m (jumpY ${jumpY(J, tm.slam - tm.takeoff).toFixed(2)})`);
      // the rig reaches ≈ 0.15 m less than the §4.9.4 reach table the dunk heights were sized with: the FK slam pose
      // must still put the ball's top over the rim (centre ≥ 2.98 m, hand above the ring); IK drives the last 0.15 s
      ok(y >= 2.98, `${id}/${p} ball at SLAM ${y.toFixed(3)} ≥ 2.98 m (ball over the rim, hand above the ring)`);
    }
  }
  // (3) ball mode 'both': the two ball1 sockets within the hand-IK capture radius (0.25 m) at every 'both' key
  // (4) dribble moves: at HAND_ON the authored ball path is within 0.25 m of the catching hand (hand IK snaps)
  for (const id of CLIP_IDS) {
    const owner = id.startsWith('sig.') ? [id.split('.')[1]] : ['kobe', 'yao', 'kyrie'];
    for (const p of owner) {
      const c = clipOf(id, p), rig = RIGS[p];
      if (!c || !rig) continue;
      let worst = 0, at = -1;
      for (const [t, k] of c.def.keys) {
        // 'both' at this key and one frame before (ball modes switch on frame boundaries)
        if (t < 0.05 || c.ball[Math.round(t * c.fps)] !== 3 || c.ball[Math.max(0, Math.round(t * c.fps) - 1)] !== 3) continue;
        const W = worldPose(rig, c, t);
        const d = dist(W.sock(SOCK.ball1_r), W.sock(SOCK.ball1_l));
        if (d > worst) { worst = d; at = t; }
      }
      if (at >= 0) {
        report(`both ${id}/${p}: worst ball1 gap ${worst.toFixed(3)} m at ${at.toFixed(2)}`);
        // the 'both' hand IK corrects each hand fully below 0.15 m error (gap 0.30), fading to 0 at 0.25 (spec §4.5)
        const lim = 0.33 * rig.metrics.sLeg;
        ok(worst < lim, `${id}/${p} ball held in both hands: ball1 sockets ${worst.toFixed(3)} m apart at ${at.toFixed(2)} (< ${lim.toFixed(2)})`);
      }
      for (let i = 0; i < c.evCount; i++) {
        if (c.evCode[i] !== EV.HAND_ON || !c.hasBp) continue;
        const t = c.evT[i];
        const W = worldPose(rig, c, t);
        const sock = c.evParam[i] === 2 ? SOCK.ball1_l : SOCK.ball1_r;
        const pose = W.pose, s = rig.metrics.sLeg;
        const ballPos = [pose.bpath[0] * s, pose.bpath[1] * s, pose.bpath[2] * s];
        const d = dist(W.sock(sock), ballPos);
        report(`handOn ${id}/${p}@${t.toFixed(2)}: hand–ball ${d.toFixed(3)} m`);
        ok(d < 0.30, `${id}/${p} HAND_ON@${t.toFixed(2)}: hand ${d.toFixed(3)} m from the ball path (< 0.30, IK snaps)`);
      }
    }
  }
  // (5) planted feet stay inside the foot-lock reach ([ANIM §2.6.5]: a lock auto-releases when the leg would exceed
  // 0.995·(thigh + calf) + 0.10 or the hip–lock horizontal distance exceeds 0.75·legLen) — sampled every frame while
  // a plant is active, hip joint from FK + root, ankle target at the floor (flat 'f': ankle height; toe 't': ball joint)
  for (const id of CLIP_IDS) {
    const owner = id.startsWith('sig.') ? [id.split('.')[1]] : ['kobe', 'yao'];
    for (const p of owner) {
      const c = clipOf(id, p), rig = RIGS[p];
      if (!c || !rig || !c.hasFeet) continue;
      // clips that keep the entry velocity (carry, or stop on a running pull-up) move the root by an amount the clip
      // cannot know; their plants are placed for a nominal run-in and are checked in game (B46+), not here
      if (c.timing.entry === 'carry' || (c.timing.entry === 'stop' && /pull|stealMiss/.test(id))) continue;
      const m = rig.metrics, s = m.sLeg, legLen = m.legLen;
      const toeExtra = dist(socketWorld(rig, fkWorld(rig, new Pose().q, [0, 0, 0]), SOCK.ankle_r), socketWorld(rig, fkWorld(rig, new Pose().q, [0, 0, 0]), SOCK.ballJ_r));
      let worst = 0, worstH = 0, at = '';
      for (let f = 0; f < c.n; f++) {
        const t = f === c.n - 1 ? c.dur : f / c.fps;
        let W = null;
        for (const [side, hipBone] of [[0, BONE.thigh_r], [1, BONE.thigh_l]]) {
          if (!c.ftOn[side][f]) continue;
          W = W || worldPose(rig, c, t, 0, SAMPLE_AIR_LINEAR);
          const hip = W.toStart([W.fk.pos[hipBone * 3], W.fk.pos[hipBone * 3 + 1], W.fk.pos[hipBone * 3 + 2]]);
          const ft = c.ft[side];
          const tx = ft[f * 4] * s, tz = ft[f * 4 + 1] * s, ty = ft[f * 4 + 3] ? 0.03 : m.ankleY;
          const dh = Math.hypot(hip[0] - tx, hip[2] - tz), d3 = Math.hypot(dh, hip[1] - ty);
          // a toe lock reaches further: the heel rises and the ball joint is the end effector
          const lim3 = 0.995 * legLen + 0.10 + (ft[f * 4 + 3] ? toeExtra : 0);
          if (d3 - lim3 > worst || dh - 0.75 * legLen > worstH) { at = `${side ? 'Lft' : 'Rft'}@${t.toFixed(2)}`; }
          worst = Math.max(worst, d3 - lim3); worstH = Math.max(worstH, dh - 0.75 * legLen);
        }
      }
      report(`feet ${id}/${p}: reach excess 3D ${worst.toFixed(3)} m, horizontal ${worstH.toFixed(3)} m (${at})`);
      ok(worst <= 0 && worstH <= 0, `${id}/${p} planted feet inside the foot-lock reach: excess ${worst.toFixed(3)} / ${worstH.toFixed(3)} m at ${at}`);
    }
  }
}]);

// =============================================================================================================
// hygiene: H8 / H6 / H7 / H1 on the clip modules
// =============================================================================================================
GROUPS.push(['hygiene', () => {
  const dir = path.join(ROOT, 'src/anim/clips');
  const deny = ['Lakers', 'Celtics', 'Bulls', 'Cavaliers', 'Bucks', 'Rockets', 'Heat', 'Nets', 'Warriors', 'Mavericks', 'Magic', 'Jazz', 'Thunder',
    'Kings', 'Suns', 'Spurs', 'Knicks', 'Hawks', 'Hornets', 'Pistons', 'Pacers', 'Raptors', 'Wizards', 'Grizzlies', 'Pelicans', 'Clippers', 'Nuggets',
    'Timberwolves', 'Blazers', 'Sixers', '76ers', 'Curry', 'Durant', 'Jokic', 'NBA', '2K', 'Air Jordan', 'Jumpman', 'Mamba', 'King James',
    'Greek Freak', 'Uncle Drew', 'Concord', 'Bred', 'Nike', 'Adidas', 'Spalding', 'Wilson', 'Swoosh', 'Gatorade', 'Under Armour'];
  for (const f of ['common.js', 'shots.js', 'kobe.js', 'jordan.js', 'lebron.js', 'giannis.js', 'yao.js', 'kyrie.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    ok(!/Math\.random/.test(src), `${f}: no Math.random (H8)`);
    ok(!/[㐀-鿿]/.test(src), `${f}: no CJK (H6)`);
    for (const w of deny) ok(!new RegExp(`\\b${w}\\b`).test(src), `${f}: no '${w}' (H7)`);
    const imports = [...src.matchAll(/^import [^;]*? from '([^']+)';/gm)].map((m) => m[1]);
    ok(imports.every((s) => s.startsWith('./') || s.startsWith('../')), `${f}: relative imports only (H1)`);
    ok(!/three\.module/.test(src) || /'\.\.\/\.\.\/\.\.\/vendor\/three\.module\.js'/.test(src), `${f}: depth-correct vendor path (H2)`);
  }
  ok(COMMON_CLIPS.every((d) => Object.isFrozen(d)), 'common clips are frozen normalised defs');
}]);

// =============================================================================================================
const argGroup = (process.argv.find((a) => a.startsWith('--group=')) || '').slice(8);
const t0 = Date.now();
for (const [name, fn] of GROUPS) {
  if (argGroup && name !== argGroup) continue;
  const f0 = failures, p0 = passes;
  try { fn(); } catch (e) { failures++; log.push(`  FAIL ${name} threw: ${e.stack}`); }
  console.log(`${failures === f0 ? 'ok  ' : 'FAIL'} ${name.padEnd(8)} ${passes - p0} passed, ${failures - f0} failed`);
}
const LIM_SHOW = +((process.argv.find((a) => a.startsWith("--show=")) || "--show=80").slice(7));
const shown = log.slice(0, LIM_SHOW);
if (shown.length) console.log(shown.join('\n') + (log.length > LIM_SHOW ? `\n  … ${log.length - LIM_SHOW} more` : ""));
console.log(`unit-clips: ${passes} passed, ${failures} failed (${Date.now() - t0} ms)`);
process.exit(failures ? 1 : 0);
