/**
 * @module context
 * Inputs → actions (spec §5.9, GP §9, C9–C11, C14): the context resolver that turns the four buttons + stick of an
 * Intent into a gameplay action with a shot kind / variant (select.js then maps it to a clip, §4.13), the post-up
 * detector (§5.6), the combo queue (§5.7), the pump-fake detector (§5.7 row 17), the defensive resolver (§5.9.3),
 * the dunk lane rule (`dunkAllowed`) and the pass-target choice. At the end: the clearly marked FALLBACK AI DRIVER,
 * used by game.js only when no v2 AI module (`{updateAI, resetAI}`, WP5 `src/ai.js`) is injected.
 *
 * Exports
 *   resolveOffense(player, intent, world) → RESOLVED (shared object, overwritten by the next call)
 *     { action: 'none'|'shot'|'move'|'combo'|'jab'|'pumpFake'|'pass'|'drive'|'post'|'faceUp', kind, variant, side,
 *       clipHint, ability, moveId, mirror, baseline, blockSide, lob, target, dodged, comboIndex, euroDunk }
 *   resolveShot(player, world), resolveCross(player, world), resolveDefense(player, intent, world) → DEF_RESOLVED
 *     { action: 'none'|'jump'|'poke'|'lunge'|'switch', intent: 'block'|'contest'|'rebound', chase, help, shooter }
 *   stickFrame(player, intent, world, out), dunkAllowed(player, world, d), laneDefender(player, world, r),
 *   updatePostDetector(player, intent, world, dt) → bool, postExit(player, intent, dt) → 'none'|'faceUp'|'drive',
 *   isPumpFake(player, intent), resolvePassTarget(player, world, human), pickDunk(player, world, d),
 *   pickLayupVariant(player, world, d, sf), comboAllowed(player, world), selCtx(player, world, out),
 *   FALLBACK_AI { updateAI, resetAI, name, planCpuRelease }, isFallbackAI(ai), planCpuRelease(player, world),
 *   DebugMixin (Game methods debugContest / debugBlock / debugSteal / debugShake / forceAbility, §5.15),
 *   makeDebugHooks(game, extras?) → the gameplay part of `window.__game` (§5.15).
 *
 * Conventions: stick vectors are world x / z (the joystick is mapped to the court by input.js). `stickRim` = cos of
 * the stick against the player → rim direction; `latRim` = lateral component, + = right when facing the rim
 * (abilities.js `stickLat`); `latF` / `fwdF` = relative to the player's facing, latF + = toward the player's left
 * (select.js `selectMove` convention: forward = (sin yaw, cos yaw), left = (cos yaw, −sin yaw)).
 * Zero allocation per call (H10): every result is a module scratch object.
 */
import { RIM, TRIGGERS, SHAKE, POST, JAB, FIXED_DT, isThree, DIFFICULTY } from './constants.js';
import { clamp } from './math.js';
import {
  makeAbilityCtx, resetAbilityCtx, eligible, has, noteApplied, chainLength, postEntryD, segDist, headingCos, mul, postGain,
  ABILITIES,
} from './abilities.js';
import { getTiming, selectMove } from './anim/select.js';
import { pressButton, releaseButton, clearEdges } from './input.js';
import { cpuReleaseError, contestFactor, resolveShotZone } from './shot.js';
import { blockChance, pokeChance, shakeChance, frontDotTo, sideOf } from './physics.js';
import { LEGENDS } from './legends.js';
import { resolveKitModes } from './lineup.js';

const DEG = Math.PI / 180;
const STICK_NEUTRAL = 0.15;
const COS45 = Math.cos(45 * DEG);
const COS30 = Math.cos(30 * DEG);
const SIN35 = Math.sin(35 * DEG);
const BIG_H = TRIGGERS.BIG_H;
const JUMP_SHOT_KINDS = { jumper: true, fade: true, stepback: true, turnFade: true, hook: true, floater: true };

/** Shared offensive result. */
const RES = {
  action: 'none', kind: null, variant: null, side: 'R', clipHint: null, ability: null, moveId: '', mirror: false,
  baseline: false, blockSide: null, lob: false, target: null, dodged: null, comboIndex: 1, euroDunk: false,
};
/** Shared defensive result. */
const DRES = { action: 'none', intent: 'contest', chase: false, help: false, shooter: null };
const SF = { mag: 0, x: 0, z: 0, rim: 0, latRim: 0, latF: 0, fwdF: 0, def: 0, defender: null };
const ACTX = makeAbilityCtx();
const SEL_CTX = { x: 0, z: 0, d: 0, speed: 0, lastMove: { id: '', age: Infinity }, baseline: false, blockSide: null, dribbleHand: 'R', rimX: RIM.x, rimZ: RIM.z };

function clearRes() {
  RES.action = 'none'; RES.kind = null; RES.variant = null; RES.side = 'R'; RES.clipHint = null; RES.ability = null;
  RES.moveId = ''; RES.mirror = false; RES.baseline = false; RES.blockSide = null; RES.lob = false; RES.target = null;
  RES.dodged = null; RES.comboIndex = 1; RES.euroDunk = false;
  return RES;
}

function heightOf(p) { return p.legend.stats.heightM; }

/** Nearest active opponent of p (distance in `out.d`), optionally only in front (dot ≥ minDot with p → rim). */
function nearestOpp(p, world, frontRimDot) {
  const ps = world.players;
  let best = null, bestD = Infinity;
  const rx = RIM.x - p.pos.x, rz = RIM.z - p.pos.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || o.disabled) continue;
    const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (frontRimDot !== undefined && d > 1e-6 && (dx * rx + dz * rz) / (d * rl) < frontRimDot) continue;
    if (d < bestD) { bestD = d; best = o; }
  }
  NEAR.p = best; NEAR.d = bestD;
  return NEAR;
}
const NEAR = { p: null, d: Infinity };

/**
 * Stick frame of a player (module conventions). `defender` = the on-ball defender (assigned to p, else the nearest
 * opponent within 3 m); `def` = cos of the stick against the direction to him.
 */
export function stickFrame(p, intent, world, out = SF) {
  const m = intent.move;
  let mag = m.mag > 0 ? m.mag : Math.sqrt(m.x * m.x + m.z * m.z);
  if (mag > 1) mag = 1;
  const l = Math.sqrt(m.x * m.x + m.z * m.z);
  out.mag = mag;
  out.x = l > 1e-9 ? m.x / l : 0; out.z = l > 1e-9 ? m.z / l : 0;
  let rx = RIM.x - p.pos.x, rz = RIM.z - p.pos.z;
  const rl = Math.sqrt(rx * rx + rz * rz);
  if (rl > 1e-9) { rx /= rl; rz /= rl; } else { rx = 0; rz = -1; }
  out.rim = l > 1e-9 ? out.x * rx + out.z * rz : 0;
  // right of the rim direction (rx, rz) = (−rz, rx)
  out.latRim = l > 1e-9 ? out.x * -rz + out.z * rx : 0;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  out.fwdF = (out.x * fx + out.z * fz) * mag;
  out.latF = (out.x * Math.cos(p.yaw) - out.z * Math.sin(p.yaw)) * mag;   // left = (cos yaw, −sin yaw)
  let def = null;
  if (world && world.players) {
    const ps = world.players;
    for (let i = 0; i < ps.length; i++) if (ps[i].team !== p.team && ps[i].defAssign === p) { def = ps[i]; break; }
    if (!def) { const n = nearestOpp(p, world); if (n.d <= 3.0) def = n.p; }
  }
  out.defender = def;
  if (def && l > 1e-9) {
    const dx = def.pos.x - p.pos.x, dz = def.pos.z - p.pos.z, dl = Math.sqrt(dx * dx + dz * dz) || 1;
    out.def = (out.x * dx + out.z * dz) / dl;
  } else out.def = 0;
  return out;
}

/** Fills the shared ability context with the player's input facts (spec §5.8 hook context). */
function fillCtx(p, world, sf) {
  const c = resetAbilityCtx(ACTX);
  c.t = world.time; c.log = world.abilityLog || null; c.rng = world.rng || null; c.world = world;
  c.holding = p.holding; c.dribbling = p.dribbling; c.inPost = p.state === 'post';
  c.inMove = p.state === 'cross' && p.move.active ? p.move.id : null;
  c.stickMag = sf.mag; c.stickRim = sf.rim; c.stickLat = sf.latRim * sf.mag; c.stickDef = sf.def;
  const rx = RIM.x - p.pos.x, rz = RIM.z - p.pos.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
  // back / side to the rim: facing more than 70° away from the rim direction
  c.backToRim = (Math.sin(p.yaw) * rx + Math.cos(p.yaw) * rz) / rl < Math.cos(70 * DEG);
  c.jabsThisHold = p.cx.jabsThisHold; c.comboIndex = p.cx.comboIndex;
  c.sinceTap = world.time - p.cx.lastCrossT;
  c.sinceJab = world.time - p.cx.lastJabT;
  c.sinceBumpWon = world.time - p.cx.wonBumpT;
  c.ftDunksUsed = p.cx.ftDunks | 0;
  c.d = p.rimDist(); c.speed = p.speed;
  if (world.quarter !== undefined) { c.quarter = world.quarter; c.gameClock = world.gameClock; }
  if (world.score) c.scoreDiff = world.score[p.team] - world.score[1 - p.team];
  return c;
}

/** True when no opponent is within r of the segment p → rim (optionally ignoring one player). */
function laneClear(p, world, r, ignore) {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || o === ignore || o.disabled) continue;
    if (segDist(o.pos.x, o.pos.z, p.pos.x, p.pos.z, RIM.x, RIM.z) < r) return false;
  }
  return true;
}

/**
 * `dunkAllowed` (§5.9.1): sprintedRecently (0.30 s) && laneOK; laneOK by the dunk rating: ≥ 85 → no defender within
 * 0.6 m of the player → rim segment; 70–84 → 1.2 m; < 70 (Kyrie) → no opponent within 3.0 m of the player (open breaks
 * only); Yao: any speed, d ≤ 1.5 m, 0.8 m lane.
 */
export function dunkAllowed(p, world, d, ignore) {
  if (p.id === 'yao') return d <= 1.5 && laneClear(p, world, 0.8, ignore);
  if (!p.sprintedRecently) return false;
  const dunk = p.legend.ratings.dunk;
  if (dunk >= 85) return laneClear(p, world, 0.6, ignore);
  if (dunk >= 70) return laneClear(p, world, 1.2, ignore);
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || o === ignore || o.disabled) continue;
    const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
    if (dx * dx + dz * dz < 9.0) return false;
  }
  return true;
}

/** The lane defender: nearest opponent within r in front of p toward the rim (dot ≥ 0.5), or null. */
export function laneDefender(p, world, r) {
  const n = nearestOpp(p, world, 0.5);
  return n.p && n.d <= r ? n.p : null;
}

/** A rim protector (§5.9.1 row 8): an opponent with H ≥ 2.05 within 2.0 m of the rim. */
function rimProtector(p, world) {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || o.disabled) continue;
    if (heightOf(o) < BIG_H) continue;
    const dx = o.pos.x - RIM.x, dz = o.pos.z - RIM.z;
    if (dx * dx + dz * dz <= 4.0) return o;
  }
  return null;
}

function inWindow(rec, d) {
  return !!rec && d >= rec.gatherWindow[0] - 1e-9 && d <= rec.gatherWindow[1] + 1e-9;
}

/**
 * Dunk clip choice (§4.13 dunk row, gameplay RNG): returns the getTiming variant whose press window contains d, or
 * '' (no dunk fits → the caller falls back to the layup family). Signature rows that need a context (Jordan FT-line,
 * Giannis long gather / euro, Yao drop step) are resolved by their own rows.
 */
export function pickDunk(p, world, d) {
  const rng = world.rng;
  const u = rng ? rng.next() : 0;
  const sp = p.speed;
  let v = 'power2';
  switch (p.id) {
    case 'jordan': {
      const n = nearestOpp(p, world);
      if (n.d > 4.0) v = u < 0.4 ? 'cradle' : u < 0.8 ? 'tomahawk1' : 'power2';
      else v = u < 0.5 ? 'tomahawk1' : 'power2';
      break;
    }
    case 'kobe': {
      const vx = p.vel.x, vz = p.vel.z, s = Math.sqrt(vx * vx + vz * vz) || 1;
      const alongBaseline = Math.abs(vx) / s >= COS30 && Math.abs(p.pos.x) > 1.5;
      if (alongBaseline && u < 0.4) v = 'reverse';
      else if (sp > 5) v = u < 0.7 ? 'tomahawk' : 'power2';
      else v = u < 0.5 ? 'tomahawk1' : 'power2';
      break;
    }
    case 'lebron':
      if (p.cx.lastMoveId === 'sig.lebron.powerDrive' && world.time - p.cx.lastMoveEndT <= 1.0) v = 'power2';
      else if (sp > 5) v = u < 0.6 ? 'tomahawk' : 'jumpStop';
      else v = u < 0.5 ? 'tomahawk1' : 'power2';
      break;
    case 'giannis': v = u < 0.5 ? 'power2' : 'tomahawk1'; break;
    case 'yao': v = u < 0.5 ? 'simple1' : 'power2'; break;
    default: v = 'simple1';
  }
  if (inWindow(getTiming(p.id, 'dunk', v), d)) return v;
  if (inWindow(getTiming(p.id, 'dunk', 'power2'), d)) return 'power2';
  return '';
}

/**
 * Layup variant (§5.9.2, first match): Jordan switch (p 0.75) with a block-eligible defender at the rim; spin toward
 * the dribble hand (Kyrie / Giannis); baseline approach < 35° → reverse; Kyrie with a big in front → reverse; stick
 * lateral ≥ 0.45 → euro (d ≥ 2.0); lane defender within 1.5 m → euro (Giannis 35 %, others 15 %) else power
 * (LeBron / Giannis / Yao, defender within 1.0 m) else std; open lane → fingerRoll (Kyrie / Jordan / Giannis 40 %,
 * others 15 %) else std. Writes RES.variant / RES.side; returns the variant.
 */
export function pickLayupVariant(p, world, d, sf) {
  const rng = world.rng;
  // finishing hand: the side of the rim the player attacks from (facing the rim, his left is −x)
  RES.side = p.pos.x < -0.3 ? 'L' : 'R';
  const handR = !p.animator || p.animator.ballHand !== 2;
  const front = nearestOpp(p, world, 0.3);
  const frontP = front.p, frontD = front.d;
  if (p.id === 'jordan') {
    const prot = rimProtector(p, world) || nearDefAtRim(p, world);
    if (prot && rollU(rng) < TRIGGERS.JORDAN_SWITCH.P) return (RES.variant = 'switch');
  }
  const towardDrib = handR ? sf.latF <= -0.45 : sf.latF >= 0.45;
  if (towardDrib && frontP && frontD <= 1.2 && (p.id === 'kyrie' || p.id === 'giannis')) return (RES.variant = 'spin');
  const vx = p.vel.x, vz = p.vel.z, s = Math.sqrt(vx * vx + vz * vz);
  if (s > 1.0 && Math.abs(vz) / s < SIN35 && p.pos.z < -11.0) return (RES.variant = 'reverse');
  if (p.id === 'kyrie' && frontP && frontD <= 1.5 && heightOf(frontP) >= BIG_H) {
    if (world.abilityLog) noteApplied(fillCtx(p, world, sf), 'kyrie.finisher', p, 'shotKind');
    return (RES.variant = 'reverse');
  }
  if (Math.abs(sf.latF) >= 0.45 && d >= 2.0) {
    RES.side = sf.latF > 0 ? 'L' : 'R';
    return (RES.variant = 'euro');
  }
  const lane = laneDefender(p, world, 1.5);
  if (lane) {
    if (rollU(rng) < (p.id === 'giannis' ? 0.35 : 0.15)) return (RES.variant = 'euro');
    if ((p.id === 'lebron' || p.id === 'giannis' || p.id === 'yao') && frontD <= 1.0) return (RES.variant = 'power');
    return (RES.variant = 'std');
  }
  const fr = p.id === 'kyrie' || p.id === 'jordan' || p.id === 'giannis' ? 0.40 : 0.15;
  return (RES.variant = rollU(rng) < fr ? 'fingerRoll' : 'std');
}

/** One gameplay roll (1 = never when no Rng is attached). */
function rollU(rng) { return rng ? rng.next() : 1; }

function nearDefAtRim(p, world) {
  const ps = world.players;
  for (let i = 0; i < ps.length; i++) {
    const o = ps[i];
    if (o.team === p.team || o.disabled) continue;
    const dx = o.pos.x - RIM.x, dz = o.pos.z - RIM.z;
    if (dx * dx + dz * dz <= 2.25) return o;
  }
  return null;
}

/** Side ('R'|'L') for post moves: the stick's lateral sign when |lat| ≥ 0.35, else the block side (court x). */
function postSide(p, sf) {
  if (Math.abs(sf.latRim * sf.mag) >= 0.35) return sf.latRim > 0 ? 'R' : 'L';
  return p.pos.x >= 0 ? 'R' : 'L';
}

/**
 * SHOOT press by the ball handler (§5.9.1 rows 2–16 and 18, first match; row 17 pump fakes are detected on the
 * release, `isPumpFake`). Returns RES with action 'shot' and the resolved kind / variant / side / clipHint.
 */
export function resolveShot(p, world) {
  const R = clearRes();
  R.action = 'shot';
  const it = p.intent;
  const sf = stickFrame(p, it, world);
  const c = fillCtx(p, world, sf);
  const d = c.d, speed = p.speed, hc = headingCos(p);
  const t = world.time, cx = p.cx;
  const towardRim = sf.mag >= STICK_NEUTRAL && sf.rim >= 0.5;
  const awayFromRim = sf.mag >= 0.5 && sf.rim <= -0.5;
  const inPost = p.state === 'post';

  // row 18: up-and-under within 0.6 s after a pump fake in the paint
  if (t - cx.lastPumpFakeT <= 0.6 && d <= 3.0) {
    R.kind = 'layup'; R.variant = 'upUnder';
    R.side = p.pos.x < 0 ? 'L' : 'R';
    if (p.id === 'yao') noteApplied(c, 'yao.post', p, 'shotKind');
    return R;
  }
  if (inPost) {
    if (towardRim) {                                             // row 2: drop step
      if (p.id === 'yao') {
        noteApplied(c, 'yao.post', p, 'shotKind');
        if (d <= 1.5) { R.kind = 'dunk'; R.variant = 'dropStep'; R.clipHint = 'sig.yao.dropStep'; }
        else { R.kind = 'layup'; R.variant = 'power'; R.clipHint = 'sig.yao.dropStepLay'; }
      } else if (dunkAllowed(p, world, d) && inWindow(getTiming(p.id, 'dunk', 'power2'), d)) { R.kind = 'dunk'; R.variant = 'power2'; }
      else { R.kind = 'layup'; R.variant = 'power'; }
      R.side = postSide(p, sf);
      return R;
    }
    R.side = postSide(p, sf); R.blockSide = p.pos.x >= 0 ? 'R' : 'L';   // row 3
    switch (p.id) {
      case 'yao': R.kind = 'hook'; noteApplied(c, 'yao.hook', p, 'shotKind'); R.ability = 'yao.hook'; break;
      case 'giannis': R.kind = Math.abs(sf.latRim * sf.mag) >= 0.45 ? 'hook' : 'turnFade'; break;
      case 'kobe': R.kind = 'turnFade'; R.variant = 'postFade'; noteApplied(c, 'kobe.postFade', p, 'shotKind'); R.ability = 'kobe.postFade'; break;
      default: R.kind = 'turnFade';
    }
    return R;
  }
  if (!it.plain) {
    if (has(p, 'jordan.ftDunk') && eligible(p, 'jordan.ftDunk', c)) {          // row 5
      noteApplied(c, 'jordan.ftDunk', p, 'shotKind');
      R.kind = 'dunk'; R.variant = 'ftDunk'; R.clipHint = 'sig.jordan.ftDunk'; R.ability = 'jordan.ftDunk';
      return R;
    }
    if (has(p, 'giannis.longDunk') && eligible(p, 'giannis.longDunk', c)) {   // row 6
      noteApplied(c, 'giannis.longDunk', p, 'shotKind');
      R.kind = 'dunk'; R.variant = 'longGather'; R.clipHint = 'sig.giannis.longGather'; R.ability = 'giannis.longDunk';
      return R;
    }
    if (has(p, 'giannis.euro') && eligible(p, 'giannis.euro', c)) {           // row 7
      noteApplied(c, 'giannis.euro', p, 'shotKind');
      R.ability = 'giannis.euro';
      const lane = laneDefender(p, world, TRIGGERS.EURO.LANE_R + 1.0);
      R.dodged = lane;
      const lat = sf.latRim * sf.mag;
      R.side = Math.abs(lat) >= TRIGGERS.EURO.LAT ? (lat > 0 ? 'R' : 'L') : euroAwaySide(p, lane);
      if (p.sprintedRecently && laneClear(p, world, 0.6, lane)) { R.kind = 'dunk'; R.variant = 'euro'; R.clipHint = 'sig.giannis.euroDunk'; R.euroDunk = true; }
      else { R.kind = 'layup'; R.variant = 'euro'; R.clipHint = 'sig.giannis.euroLay'; }
      return R;
    }
  }
  if (has(p, 'yao.hook') && d <= TRIGGERS.YAO_HOOK_D && c.backToRim) {
    noteApplied(c, 'yao.hook', p, 'shotKind');
    R.kind = 'hook'; R.ability = 'yao.hook'; R.side = sf.latRim > 0 ? 'R' : 'L';
    return R;
  }
  // row 8: floater over a rim protector
  if (p.dribbling && speed >= 3.0 && d > 2.2 && d <= 4.5 && rimProtector(p, world) && (towardRim || p.id === 'kyrie')) {
    R.kind = 'floater';
    if (p.id === 'kyrie') noteApplied(c, 'kyrie.finisher', p, 'shotKind');
    return R;
  }
  // row 9: Kobe along the baseline
  if (p.id === 'kobe' && p.dribbling && p.pos.z <= -11.0 && Math.abs(p.pos.x) >= 1.5 && Math.abs(p.pos.x) <= 4.5 && d <= 4.5) {
    const vx = p.vel.x, vz = p.vel.z, s = Math.sqrt(vx * vx + vz * vz);
    const wantX = -Math.sign(p.pos.x);
    if (s > 0.5 && (vx * wantX) / s >= COS30) {
      R.baseline = true;
      if (awayFromRim) { R.kind = 'fade'; return R; }
      R.kind = 'layup'; R.variant = 'std'; R.side = p.pos.x < 0 ? 'L' : 'R';
      return R;
    }
  }
  // row 10: dunk inside a dunk clip's press window with dunkAllowed
  if (d >= TRIGGERS.DUNK.D_MIN && dunkAllowed(p, world, d)) {
    const v = pickDunk(p, world, d);
    if (v) {
      R.kind = 'dunk'; R.variant = v; R.clipHint = getTiming(p.id, 'dunk', v).clipId;
      R.side = p.pos.x < -0.3 ? 'L' : 'R';
      return R;
    }
  }
  // row 11: layup by distance / approach (C9)
  const std2Max = p.id === 'jordan' ? TRIGGERS.LAYUP.STD2_MAX_JORDAN : TRIGGERS.LAYUP.STD2_MAX;
  if (d <= TRIGGERS.LAYUP.STD1_MAX || (d <= std2Max && speed >= TRIGGERS.LAYUP.STD2_SPEED && hc >= COS45)) {
    R.kind = 'layup';
    pickLayupVariant(p, world, d, sf);
    if (p.id === 'jordan' && d > TRIGGERS.LAYUP.STD2_MAX) noteApplied(c, 'jordan.air', p, 'shotKind');
    return R;
  }
  // row 12: generic euro step from (4.0, 5.2]
  if (speed >= TRIGGERS.EURO_GENERIC.SPEED && hc >= COS45 && d > 4.0 && d <= TRIGGERS.EURO_GENERIC.D_MAX
    && (Math.abs(sf.latF) >= 0.45 || laneDefender(p, world, 1.5))) {
    R.kind = 'layup'; R.variant = 'euro';
    const lane = laneDefender(p, world, 2.5);
    R.dodged = lane;
    R.side = Math.abs(sf.latF) >= 0.45 ? (sf.latF > 0 ? 'L' : 'R') : euroAwaySide(p, lane);
    return R;
  }
  // row 13: stepback (Kyrie's trigger also fires during move.stepback)
  const kyrieStep = has(p, 'kyrie.stepback') && eligible(p, 'kyrie.stepback', c);
  if ((p.dribbling && awayFromRim) || kyrieStep) {
    if (kyrieStep) { noteApplied(c, 'kyrie.stepback', p, 'shotKind'); R.ability = 'kyrie.stepback'; }
    R.kind = 'stepback';
    return R;
  }
  if (p.holding && awayFromRim) { R.kind = 'fade'; return R; }      // row 14
  R.kind = 'jumper';
  if (t - cx.lastJabT <= JAB.PULLUP_WINDOW) { R.variant = 'jabPullup'; return R; }   // row 15 (≤ 0.8 s after a jab)
  if (isThree(p.pos.x, p.pos.z)) R.variant = 'three';                // row 16
  else R.variant = speed >= 1.5 || p.dribbling ? 'pull12' : 'set';
  return R;
}

function euroAwaySide(p, lane) {
  if (!lane) return p.pos.x < 0 ? 'L' : 'R';
  // away from the lane defender: his lateral offset relative to the p → rim line
  const rx = RIM.x - p.pos.x, rz = RIM.z - p.pos.z;
  const ox = lane.pos.x - p.pos.x, oz = lane.pos.z - p.pos.z;
  const right = ox * -rz + oz * rx;        // + = defender on the right of the drive line
  return right > 0 ? 'L' : 'R';
}

/** True when a CROSS now may queue a combo move (§5.7): inside a move or ≤ 0.35 s after the previous tap. */
export function comboAllowed(p, world) {
  const chain = chainLength(p);
  if (chain <= 1) return false;
  const inMove = p.state === 'cross' && p.move.active;
  const recent = world.time - p.cx.lastCrossT <= SHAKE.COMBO_WINDOW || p.intent.tertiary.doubleTap;
  return (inMove || recent) && p.cx.comboIndex < chain && p.dribbling;
}

/**
 * CROSS press by the ball handler (§5.9.1 rows 1, 4, 19, 20). Returns RES with action 'combo' (queue the next move),
 * 'move' (moveId, mirror), 'jab', 'pumpFake' (holding, stick back), 'dropStep' (Yao in the post) or 'none'.
 */
export function resolveCross(p, world) {
  const R = clearRes();
  const it = p.intent;
  const sf = stickFrame(p, it, world);
  const cx = p.cx;
  const L = p.legend;
  if (p.state === 'post') {                                        // row 4
    const c = fillCtx(p, world, sf);
    if (p.id === 'yao') {
      noteApplied(c, 'yao.post', p, 'move');
      const d = c.d;
      R.action = 'shot';
      if (d <= 1.5) { R.kind = 'dunk'; R.variant = 'dropStep'; R.clipHint = 'sig.yao.dropStep'; }
      else { R.kind = 'layup'; R.variant = 'power'; R.clipHint = 'sig.yao.dropStepLay'; }
      R.side = postSide(p, sf);
      return R;
    }
    R.action = 'move'; R.moveId = 'move.spin'; R.mirror = sf.latRim < 0;
    return R;
  }
  if (comboAllowed(p, world)) {                                    // row 1
    R.action = 'combo'; R.comboIndex = cx.comboIndex + 1;
    return R;
  }
  if (p.state === 'cross') { R.action = 'none'; return R; }       // chain exhausted: the current move plays out
  SEL_MOVE.lat = sf.latF; SEL_MOVE.fwd = sf.fwdF;
  MOVE_CTX.holding = p.holding; MOVE_CTX.speed = p.speed; MOVE_CTX.post = false;
  MOVE_CTX.dribbleHand = p.animator && p.animator.ballHand === 2 ? 'L' : 'R';
  const front = nearestOpp(p, world, 0.3);
  MOVE_CTX.defFront = front.p ? front.d : Infinity;
  MOVE_CTX.rng = world.rng;
  if (p.holding) {                                                 // row 19
    if (sf.fwdF < -0.5) { R.action = 'pumpFake'; R.moveId = p.id === 'yao' && p.state === 'post' ? 'sig.yao.pumpHook' : 'move.pumpFake'; return R; }
    if (cx.jabsThisHold >= 2) { R.action = 'none'; return R; }
    const sel = selectMove(p, SEL_MOVE, MOVE_CTX);
    R.action = 'jab'; R.moveId = sel.moveId; R.mirror = sel.mirror;
    return R;
  }
  if (p.dribbling) {                                               // row 20
    if (L.traits.noDribbleMoves) { R.action = 'none'; return R; }
    if (p.moveCd > 0) { R.action = 'none'; return R; }
    const sel = selectMove(p, SEL_MOVE, MOVE_CTX);
    if (sel.clipIdx < 0 || sel.moveId === 'move.pumpFake' || sel.moveId === 'sig.yao.dropStep') { R.action = 'none'; return R; }
    R.action = 'move'; R.moveId = sel.moveId; R.mirror = sel.mirror;
    return R;
  }
  return R;
}
const SEL_MOVE = { lat: 0, fwd: 0 };
const MOVE_CTX = { holding: false, speed: 0, dribbleHand: 'R', post: false, defFront: Infinity, rng: null };

/**
 * Dispatcher (spec §1.2 `resolveOffense(player, intent, world)`): SHOOT press → resolveShot; CROSS press →
 * resolveCross; PASS release (or a tap) → 'pass' with target / lob; SPRINT specials (row 23: Giannis elbow drive,
 * LeBron power drive) → 'drive'. Only the first applicable edge of this step is resolved.
 */
export function resolveOffense(p, intent, world) {
  const it = intent || p.intent;
  if (it.primary.justPressed) return resolveShot(p, world);
  if (it.tertiary.justPressed) return resolveCross(p, world);
  const R = clearRes();
  if (it.secondary.justReleased || (it.secondary.justPressed && !it.secondary.held)) {
    const target = resolvePassTarget(p, world, !!p.isUser);
    if (target) { R.action = 'pass'; R.target = target; R.lob = it.secondary.heldTime >= 0.30; }
    return R;
  }
  if (it.sprint && p.id === 'kobe' && p.holding && p.cx.jabsThisHold >= 2 && world.time - p.cx.lastJabT <= JAB.PULLUP_WINDOW) {
    // kobe.jab: after the second jab, stick toward the rim + SPRINT = rip-through drive (sig.kobe.jabGo, exitV 4.5)
    const sf = stickFrame(p, it, world);
    if (sf.rim >= 0.5 && sf.mag >= 0.5) { R.action = 'drive'; R.moveId = 'sig.kobe.jabGo'; return R; }
  }
  if (it.sprint && p.speed > 0.5) {
    const sf = stickFrame(p, it, world);
    const d = p.rimDist();
    if (p.id === 'giannis' && p.holding && d >= 3.5 && d <= 5.5 && sf.rim >= 0.5 && sf.mag >= 0.5 && p.cx.lastMoveId !== 'sig.giannis.elbowDrive') {
      R.action = 'drive'; R.moveId = 'sig.giannis.elbowDrive'; return R;
    }
    if (p.id === 'lebron' && p.dribbling && p.speed >= 4.0 && headingCos(p) >= COS45 && laneDefender(p, world, 2.5)
      && world.time - p.cx.lastMoveEndT > 1.5) {
      R.action = 'drive'; R.moveId = 'sig.lebron.powerDrive'; return R;
    }
  }
  return R;
}

/**
 * Post-up detector (§5.6, row 21): d ≤ 5.0 (Yao 5.5), holding or dribbling, a defender within 1.2 m between handler
 * and rim (dot ≥ 0.5), stick toward the rim (dot ≥ 0.5) with magnitude 0.15–0.75 and no sprint (AI: `intent.post`
 * instead of the stick), held for 0.35 s. Returns true on the step the post is entered.
 */
export function updatePostDetector(p, intent, world, dt) {
  const cx = p.cx;
  if (!p.hasBall || p.state === 'post' || !(p.state === 'idle' || p.state === 'move')) { cx.postT = 0; return false; }
  const d = p.rimDist();
  let ok = d <= postEntryD(p) && !intent.sprint;
  if (ok) {
    const def = laneDefender(p, world, POST.DEF_R);
    ok = !!def;
    if (ok) {
      if (intent.post) ok = true;
      else {
        const sf = stickFrame(p, intent, world);
        ok = sf.rim >= POST.STICK_DOT && sf.mag >= POST.STICK_MIN && sf.mag <= POST.STICK_MAX;
      }
    }
  }
  if (!ok) { cx.postT = 0; return false; }
  cx.postT += dt;
  if (cx.postT >= POST.HOLD) { cx.postT = 0; return true; }
  return false;
}

/**
 * Post exit (§5.6): stick away from the rim ≥ 0.6 for 0.20 s → 'faceUp'; SPRINT → 'drive'; else 'none'.
 */
export function postExit(p, intent, dt) {
  const cx = p.cx;
  if (intent.sprint && !intent.post) { cx.postExitT = 0; return 'drive'; }
  const m = intent.move;
  const mag = m.mag > 0 ? m.mag : Math.sqrt(m.x * m.x + m.z * m.z);
  let away = false;
  if (mag >= POST.EXIT_STICK) {
    const rx = RIM.x - p.pos.x, rz = RIM.z - p.pos.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
    const l = Math.sqrt(m.x * m.x + m.z * m.z) || 1;
    away = (m.x * rx + m.z * rz) / (l * rl) <= -0.5;
  }
  if (!away) { cx.postExitT = 0; return 'none'; }
  cx.postExitT += dt;
  if (cx.postExitT >= POST.EXIT_T) { cx.postExitT = 0; return 'faceUp'; }
  return 'none';
}

/**
 * Pump fake (§5.7, row 17): SHOOT released < 0.12 s after the press, for a jump-shot kind, before TAKEOFF.
 * `elapsed` = seconds between press and release.
 */
export function isPumpFake(p, elapsed) {
  const s = p.shot;
  return s.active && !s.released && !s.takeoff && JUMP_SHOT_KINDS[s.kind] === true && elapsed < 0.12;
}

/**
 * Defensive input (§5.9.3): SHOOT tap → jump ('block' at a shooter within 2.5 m or a fresh shot, 'rebound' for a free
 * ball, else 'contest'; LeBron chase flag from behind, Giannis help flag); STEAL tap → 'lunge' during an opponent's
 * pass within 2.5 m of the pass line, else 'poke'; SWITCH tap → 'switch'.
 */
export function resolveDefense(p, intent, world) {
  const R = DRES;
  R.action = 'none'; R.intent = 'contest'; R.chase = false; R.help = false; R.shooter = null;
  const it = intent || p.intent;
  const ball = world.ball;
  if (it.primary.justPressed) {
    R.action = 'jump';
    let sh = null;
    const ps = world.players;
    for (let i = 0; i < ps.length; i++) {
      const o = ps[i];
      if (o.team !== p.team && o.shot.active && !o.shot.launched) { sh = o; break; }
    }
    if (!sh && ball.state === 'flight' && ball.ctx === 'shot' && ball.releaseAge < 0.3) sh = ball.shot.shooter;
    if (sh) {
      R.shooter = sh;
      const dx = sh.pos.x - p.pos.x, dz = sh.pos.z - p.pos.z, d = Math.sqrt(dx * dx + dz * dz);
      R.intent = d <= 2.5 ? 'block' : 'contest';
      R.help = p.defAssign !== null && p.defAssign !== sh;
      if ((sh.shot.kind === 'layup' || sh.shot.kind === 'dunk') && d <= TRIGGERS.CHASE.R) {
        // behind the shooter: dot(dir(shooter → p), dir(shooter → rim)) < −0.2
        const rx = RIM.x - sh.pos.x, rz = RIM.z - sh.pos.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
        if (d > 1e-6 && (-dx * rx - dz * rz) / (d * rl) < TRIGGERS.CHASE.DOT) R.chase = true;
      }
    } else if (ball.isFree) R.intent = 'rebound';
    return R;
  }
  if (it.tertiary.justPressed) {
    if (ball.state === 'pass' && ball.passInfo.from && ball.passInfo.from.team !== p.team) {
      const f = ball.passInfo.from, r = ball.passInfo.receiver;
      if (r && segDist(p.pos.x, p.pos.z, ball.pos.x, ball.pos.z, r.pos.x, r.pos.z) <= 2.5) { R.action = 'lunge'; return R; }
      if (f && r && segDist(p.pos.x, p.pos.z, f.pos.x, f.pos.z, r.pos.x, r.pos.z) <= 2.5) { R.action = 'lunge'; return R; }
    }
    R.action = 'poke';
    return R;
  }
  if (it.secondary.justPressed && p.isUser) R.action = 'switch';
  return R;
}

/**
 * Pass target (v1 `resolvePassTarget` + §5.5): a human aims with the stick (best alignment ≥ 0.2); the user's CPU
 * teammate passes back to the user; otherwise the most open teammate (largest distance to his nearest opponent).
 */
export function resolvePassTarget(p, world, human) {
  const ps = world.players;
  const t = p.passTarget;
  if (t && t !== p && t.team === p.team) return t;
  const m = p.intent.move;
  if (human && m.mag > 0.3) {
    let best = null, bestDot = 0.2;
    const ml = Math.sqrt(m.x * m.x + m.z * m.z) || 1;
    for (let i = 0; i < ps.length; i++) {
      const q = ps[i];
      if (q === p || q.team !== p.team) continue;
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z, dl = Math.sqrt(dx * dx + dz * dz) || 1;
      const dot = (dx * m.x + dz * m.z) / (dl * ml);
      if (dot > bestDot) { bestDot = dot; best = q; }
    }
    if (best) return best;
  }
  if (!world.auto && world.userPlayer && world.userPlayer !== p && world.userPlayer.team === p.team && p.team === world.user) return world.userPlayer;
  let best = null, bestOpen = -1;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q === p || q.team !== p.team) continue;
    let open = Infinity;
    for (let j = 0; j < ps.length; j++) {
      const o = ps[j];
      if (o.team === p.team) continue;
      const dx = o.pos.x - q.pos.x, dz = o.pos.z - q.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < open) open = d;
    }
    if (open > bestOpen) { bestOpen = open; best = q; }
  }
  return best;
}

/** select.js context for a player (§4.13 / [ANIM §10.3]) written into `out`. */
export function selCtx(p, world, out = SEL_CTX) {
  out.x = p.pos.x; out.z = p.pos.z; out.d = p.rimDist(); out.speed = p.speed;
  out.lastMove.id = p.cx.lastMoveId;
  out.lastMove.age = world.time - p.cx.lastMoveT;
  out.baseline = false; out.blockSide = null;
  out.dribbleHand = p.animator && p.animator.ballHand === 2 ? 'L' : 'R';
  return out;
}

// =====================================================================================================================
// FALLBACK AI DRIVER — used by game.js ONLY when no v2 AI module ({updateAI, resetAI}) is injected (WP5 owns
// src/ai.js). It drives the same Intent as a human so headless games run end to end: the handler drives, pulls up,
// passes, posts (Yao), makes dribble moves and shoots with a CPU release error; off-ball players hold their top spot
// (legends `spots`); defenders guard their man at the difficulty gap, contest jumps, poke, and chase free balls. Every
// timer is a countdown (R#35). It is intentionally simple: it is not the balance-tuned v2 AI of §5.10.
// =====================================================================================================================

const AI_TICK = 0.10;
const SETUP_T = 0.8;
const CATCH_GATE = 0.40;

function makeAiState() {
  return {
    tick: 0, setup: SETUP_T, catchGate: 0, plan: 'probe', planT: 0, shootRel: -1, passRel: -1, crossRel: -1,
    pokeCd: 0, contestCd: 0, spotX: 0, spotZ: -6, hadBall: false, lastState: '', jumpAt: -1, holdRel: 0, lastOffense: -1,
    dribbles: 0, postT: 0, cpuSigma: 0, cpuErr: 0,
  };
}

function silence(it) {
  it.move.x = 0; it.move.z = 0; it.move.mag = 0; it.sprint = false; it.post = false;
  it.primary.held = false; it.primary.heldTime = 0;
  it.secondary.held = false; it.secondary.heldTime = 0;
  it.tertiary.held = false; it.tertiary.heldTime = 0;
  clearEdges(it);
}

function steer(p, x, z, sprint, slowR) {
  const it = p.intent;
  const dx = x - p.pos.x, dz = z - p.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 0.15) { it.move.x = 0; it.move.z = 0; it.move.mag = 0; it.sprint = false; return d; }
  const mag = clamp(d / (slowR || 1.0), 0.25, 1);
  it.move.x = dx / d; it.move.z = dz / d; it.move.mag = mag; it.sprint = !!sprint && d > 1.5;
  return d;
}

const BEST_SPOT = {};
/** The legend's highest-weighted spot id (§2.5), cached per legend (no per-tick for-in). */
function bestSpot(p) {
  let b = BEST_SPOT[p.id];
  if (b === undefined) {
    let bw = -1; b = null;
    const spots = p.legend.spots;
    for (const k of Object.keys(spots)) if (spots[k] > bw) { bw = spots[k]; b = k; }
    BEST_SPOT[p.id] = b;
  }
  return b;
}

function openness(p, world) {
  return nearestOpp(p, world).d;
}

function aiDiff(world, p) {
  if (world.auto || p.team === world.user) return DIFFICULTY.normal;
  return world.difficulty && world.difficulty.reaction !== undefined ? world.difficulty : DIFFICULTY.normal;
}

function fallbackResetAI(p) {
  p.ai = makeAiState();
}

function fallbackUpdateAI(world, dt) {
  const ps = world.players, ball = world.ball;
  const live = world.state === 'LIVE';
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (!p.ai || p.ai.tick === undefined || p.ai.plan === undefined) p.ai = makeAiState();
    const ai = p.ai;
    if (world.isUserControlled(p)) { ai.hadBall = false; continue; }
    const it = p.intent;
    clearEdges(it);
    if (!live) { silence(it); ai.setup = SETUP_T; ai.hadBall = false; continue; }
    if (ai.lastOffense !== world.offense) { ai.lastOffense = world.offense; ai.setup = SETUP_T; ai.plan = 'probe'; }
    ai.tick -= dt; ai.setup -= dt; ai.catchGate -= dt; ai.pokeCd -= dt; ai.contestCd -= dt; ai.planT -= dt;
    const ms = world.time * 1000;
    if (it.primary.held) it.primary.heldTime += dt;
    if (it.secondary.held) it.secondary.heldTime += dt;
    if (p.team === world.offense) {
      if (p.hasBall) aiHandler(p, ai, world, dt, ms);
      else { ai.hadBall = false; if (it.primary.held) releaseButton(it.primary, ms); aiOffBall(p, ai, world); }
    } else {
      ai.hadBall = false;
      if (it.primary.held) releaseButton(it.primary, ms);
      aiDefence(p, ai, world, dt, ms, ball);
    }
  }
}

function aiHandler(p, ai, world, dt, ms) {
  const it = p.intent;
  if (!ai.hadBall) {
    ai.hadBall = true; ai.catchGate = CATCH_GATE; ai.plan = 'probe'; ai.planT = 0; ai.shootRel = -1; ai.passRel = -1;
    const k = bestSpot(p);
    ai.spotX = k && world.slots && world.slots[k] ? world.slots[k].x : 0;
    ai.spotZ = k && world.slots && world.slots[k] ? world.slots[k].z : -6;
    if (p.rimDist() > 7.5) { ai.spotX = p.pos.x * 0.5; ai.spotZ = -7.2; }   // from beyond the arc: attack to the arc first
  }
  // a shot in progress: hold the button until the planned release time
  if (p.shot.active) {
    it.move.mag = 0; it.move.x = 0; it.move.z = 0; it.sprint = false; it.post = false;
    if (it.primary.held && ai.shootRel >= 0 && world.time >= ai.shootRel) { releaseButton(it.primary, ms); ai.shootRel = -1; }
    return;
  }
  if (it.primary.held) releaseButton(it.primary, ms);
  if (ai.passRel >= 0) { if (world.time >= ai.passRel) { releaseButton(it.secondary, ms); ai.passRel = -1; } return; }
  if (!(p.state === 'idle' || p.state === 'move' || p.state === 'post' || p.state === 'cross')) { it.post = false; return; }
  const d = p.rimDist();
  const open = openness(p, world);
  const clock = world.shotClock;
  const D = aiDiff(world, p);
  const rng = world.rng;
  const tick = ai.tick <= 0;
  if (tick) ai.tick += AI_TICK;
  if (ai.tick < -AI_TICK) ai.tick = AI_TICK;
  const ready = ai.setup <= 0 && ai.catchGate <= 0;
  // decisions
  if (tick && ready && p.state !== 'cross') {
    const urgent = clock < 2.5;
    const L = p.legend;
    const three = isThree(p.pos.x, p.pos.z);
    const shootRating = three ? L.ratings.three : d > 3.5 ? L.ratings.midRange : L.ratings.closeShot;
    const wantShot = urgent || (open > 1.6 && d < 7.9 && (!three || (shootRating >= 80 && L.traits.threeGate === null) || open > 3.0)
      && rng.next() < 0.10 + (shootRating - 60) / 300 + (ai.planT < -3 ? 0.15 : 0))
      || (d < 2.6 && rng.next() < 0.5);
    if (p.state === 'post') {
      ai.postT += AI_TICK;
      if (ai.postT > 1.2 || urgent) { it.post = false; pressPrimary(p, ai, world, ms, D, rng); ai.postT = 0; }
      return;
    }
    if (wantShot && !(three && L.id === 'yao' && clock > 1.5)) { pressPrimary(p, ai, world, ms, D, rng); return; }
    if (rng.next() < 0.05 && clock > 4 && (p.passTarget = safeReceiver(p, world)) !== null) {
      pressButton(it.secondary, ms);
      ai.passRel = world.time + (rng.next() < 0.15 ? 0.35 : 0.05);
      return;
    }
    if (p.dribbling && !L.traits.noDribbleMoves && open < 1.6 && p.moveCd <= 0 && rng.next() < 0.12) {
      pressButton(it.tertiary, ms); releaseButton(it.tertiary, ms);
      it.move.x = Math.cos(p.yaw); it.move.z = -Math.sin(p.yaw); it.move.mag = 0.8;
      return;
    }
    if (p.holding && open < 1.4 && rng.next() < 0.08) { pressButton(it.tertiary, ms); releaseButton(it.tertiary, ms); return; }
    if (ai.planT <= 0) {
      const u = rng.next();
      ai.plan = (p.id === 'yao' && d < 6.5) || (u < 0.12 && d < 6.5) ? 'post' : u < 0.55 ? 'drive' : 'spot';
      ai.planT = 2.5 + rng.next() * 2;
    }
  }
  // movement
  it.post = false;
  if (p.state === 'post') { steer(p, RIM.x, RIM.z, false, 3.0); it.move.mag = Math.min(it.move.mag, 0.6); return; }
  if (!ready) { it.move.mag = 0; it.move.x = 0; it.move.z = 0; it.sprint = false; return; }
  if (ai.plan === 'drive') {
    steer(p, RIM.x + (p.pos.x > 0 ? 0.6 : -0.6), RIM.z + 0.9, rng.next() < D.sprintProb + 0.2, 1.0);
    if (d < 2.4 && ai.tick <= AI_TICK * 0.5) pressPrimary(p, ai, world, ms, D, rng);
  } else if (ai.plan === 'post') {
    const tx = p.pos.x > 0 ? 2.0 : -2.0;
    steer(p, tx, -11.0, false, 1.5);
    if (d <= 5.4) { it.post = true; steer(p, RIM.x, RIM.z, false, 3.0); it.move.mag = 0.5; }
  } else {
    steer(p, ai.spotX, ai.spotZ, false, 1.5);
  }
}

const LANE_MARGIN = 0.40;                                 // fallback pass lane margin beyond a defender's intercept radius
/**
 * The most open teammate within 9.5 m whose pass lane is clear (every defender farther than his intercept radius
 * catchR + 0.05 (+0.20 Jordan) + LANE_MARGIN from the passer→receiver segment), or null — a crude stand-in for the
 * §5.10 pass risk so the fallback rarely throws picks.
 */
function safeReceiver(p, world) {
  const ps = world.players;
  let best = null, bestOpen = -1;
  for (let i = 0; i < ps.length; i++) {
    const q = ps[i];
    if (q === p || q.team !== p.team) continue;
    const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z;
    if (dx * dx + dz * dz > 9.5 * 9.5) continue;
    let clear = true, open = Infinity;
    for (let j = 0; j < ps.length && clear; j++) {
      const o = ps[j];
      if (o.team === p.team) continue;
      const need = o.attrs.catchR + 0.05 + (has(o, 'jordan.hawk') ? 0.20 : 0) + LANE_MARGIN;
      if (segDist(o.pos.x, o.pos.z, p.pos.x, p.pos.z, q.pos.x, q.pos.z) < need) clear = false;
      const ox = o.pos.x - q.pos.x, oz = o.pos.z - q.pos.z, od = Math.sqrt(ox * ox + oz * oz);
      if (od < open) open = od;
    }
    if (clear && open > bestOpen) { bestOpen = open; best = q; }
  }
  return best;
}

function pressPrimary(p, ai, world, ms, D, rng) {
  const it = p.intent;
  pressButton(it.primary, ms);
  // planned release: tIdeal of the kind the resolver will pick + a CPU error (§5.3.2); resolved on the next steps
  ai.shootRel = -2;
  ai.cpuSigma = D.cpuSigma;
  ai.cpuErr = cpuReleaseError(rng, D.cpuSigma);
}

/** Called by game.js right after a CPU shot press is resolved: plan the release at tIdeal + eT_cpu. */
export function planCpuRelease(p, world) {
  const ai = p.ai;
  if (!ai || ai.shootRel !== -2) return;
  const s = p.shot;
  ai.shootRel = world.time + Math.max(0.02, s.tIdeal + (ai.cpuErr || 0) - FIXED_DT * 0.5);
}

function aiOffBall(p, ai, world) {
  const ball = world.ball;
  const k = bestSpot(p);
  let tx = k && world.slots && world.slots[k] ? world.slots[k].x : 0;
  let tz = k && world.slots && world.slots[k] ? world.slots[k].z : -6;
  // keep 2.5 m from the handler
  const h = ball.owner;
  if (h && h !== p) {
    const dx = tx - h.pos.x, dz = tz - h.pos.z, dd = Math.sqrt(dx * dx + dz * dz);
    if (dd < 2.5) { tx = Math.abs(tx) > 0.5 ? -tx : (h.pos.x > 0 ? -4.0 : 4.0); tz = tz < -9 ? -7.5 : tz - 2.0; }   // mirror away from the handler
  }
  if (ball.isFree && ball.ctx === 'shot') {
    // crash toward the rim side of the landing
    tx = RIM.x + (p.pos.x > 0 ? 1.2 : -1.2); tz = RIM.z + 1.4;
    if (ball.state === 'loose') { tx = ball.pos.x; tz = ball.pos.z; }
  } else if (ball.state === 'loose') { tx = ball.pos.x; tz = ball.pos.z; }
  steer(p, tx, tz, ball.state === 'loose', 1.2);
}

function aiDefence(p, ai, world, dt, ms, ball) {
  const it = p.intent;
  const D = aiDiff(world, p);
  const rng = world.rng;
  const man = p.defAssign;
  if (ball.state === 'loose' || (ball.isFree && ball.ctx !== 'pass' && ball.releaseAge > 0.4)) {
    steer(p, ball.pos.x, ball.pos.z, true, 0.8);
    return;
  }
  if (!man) { steer(p, RIM.x, RIM.z + 3, false, 1.5); return; }
  const onBall = ball.owner === man;
  const rx = RIM.x - man.pos.x, rz = RIM.z - man.pos.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
  const gap = onBall ? D.defGap * (1.10 - 0.20 * ((p.legend.ratings.perimeterD - 25) / 74)) : 2.4;
  let tx = man.pos.x + rx / rl * Math.min(gap, rl * 0.8), tz = man.pos.z + rz / rl * Math.min(gap, rl * 0.8);
  if (!onBall && ball.owner) { tx += (ball.owner.pos.x - tx) * 0.25; tz += (ball.owner.pos.z - tz) * 0.25; }
  // during the man's shot: close out toward him, no backing away (R#29)
  if (man.shot.active && !man.shot.launched) {
    tx = man.pos.x + rx / rl * 0.7; tz = man.pos.z + rz / rl * 0.7;
    const dx = man.pos.x - p.pos.x, dz = man.pos.z - p.pos.z, dd = Math.sqrt(dx * dx + dz * dz);
    if (ai.jumpAt < 0 && dd <= 1.8 && ai.contestCd <= 0) {
      ai.contestCd = 1.5;
      if (rng.next() < D.contestJumpP * (p.legend.tend.contestJump ? p.legend.tend.contestJump[man.shot.kind === 'layup' || man.shot.kind === 'dunk' ? 1 : 0] : 1)) {
        const tRel = man.shot.pressT + man.shot.tIdeal;
        ai.jumpAt = tRel + 0.03 - p.attrs.airtime * 0.5 + rng.gauss(0, D.jumpSigma) + D.reaction * 0.2;
      }
    }
  }
  if (ai.jumpAt >= 0 && world.time >= ai.jumpAt) {
    ai.jumpAt = -1;
    if (p.canAct) { pressButton(it.primary, ms); return; }
  }
  if (!man.shot.active) ai.jumpAt = -1;
  steer(p, tx, tz, man.speed > 3.5, 0.6);
  // pokes: CPU attempt interval (difficulty)
  if (onBall && man.dribbling && ai.pokeCd <= 0 && p.canAct) {
    const dx = man.pos.x - p.pos.x, dz = man.pos.z - p.pos.z;
    if (dx * dx + dz * dz <= p.attrs.stealRange * p.attrs.stealRange) {
      ai.pokeCd = D.cpuStealInterval;
      if (rng.next() < 0.5) { pressButton(it.tertiary, ms); releaseButton(it.tertiary, ms); }
    }
  }
}

/** The fallback driver as an AI module ({updateAI, resetAI}). */
export const FALLBACK_AI = Object.freeze({ name: 'fallback', updateAI: fallbackUpdateAI, resetAI: fallbackResetAI, planCpuRelease });

/** True when `ai` is the built-in fallback driver. */
export function isFallbackAI(ai) { return ai === FALLBACK_AI; }

// =====================================================================================================================
// DEBUG HOOKS (§5.15): Game methods installed by game.js (DebugMixin) and the `__game` factory (makeDebugHooks). They
// allocate result objects: tests and the console only, never per frame.
// =====================================================================================================================

const DBG = makeAbilityCtx();

function idOf(p) { return p ? p.id : null; }

export class DebugMixin {
  /** §5.15 debugContest({shooter?, kind?}) → {C, X, Xraw, defender, parts: {Kd, Kh, Ks}, A}. */
  debugContest(o) {
    const opts = o || {}, w = this.world;
    const sh = (opts.shooter && this.byId[opts.shooter]) || this.ball.owner || w.controlled;
    if (!sh) return null;
    const kind = opts.kind || (sh.shot.active ? sh.shot.kind : 'jumper');
    const r = contestFactor(sh, w, kind);
    return { C: r.C, X: r.X, Xraw: r.Xraw, defender: idOf(r.defender), parts: { Kd: r.parts.Kd, Kh: r.parts.Kh, Ks: r.parts.Ks }, A: r.A };
  }

  /**
   * §5.15 debugBlock({blocker, shooter, kind, contact: true}) → {eligible, pB, blocked}: the §5.4 roll with geometric
   * contact assumed (contact: true) — eligibility = the blocker is active and may block this kind (Yao hook vs
   * H < 2.05); without forced contact he must also not be behind the shooter unless his chase level allows it.
   */
  debugBlock(o) {
    const opts = o || {}, w = this.world;
    const b = this.byId[opts.blocker], s = this.byId[opts.shooter];
    if (!b || !s || b.team === s.team) return { eligible: false, pB: 0, blocked: false };
    const kind = opts.kind || 'jumper';
    const d = s.rimDist();
    const zone = resolveShotZone(kind, d, s.pos.x, s.pos.z);
    const behind = frontDotTo(s, b, RIM.x, RIM.z) < -0.20;
    const chasing = has(b, 'lebron.chaseDown') && behind && (kind === 'layup' || kind === 'dunk');
    const help = b.defAssign !== null && b.defAssign !== s;
    const B = blockChance(s, b, kind, { variant: opts.variant || null, zone, side: sideOf(b, this), difficulty: this.difficultyId, chasing, help,
      log: this.abilityLog, t: w.time, dunk: kind === 'dunk' });
    // contact: true forces the geometric contact (S7); otherwise the position rule applies (not behind unless chase)
    const eligible = B.eligible && !b.disabled && (opts.contact === true || !behind || B.behindOK);
    const blocked = eligible && this.rng.next() < B.pB;
    return { eligible, pB: B.pB, blocked };
  }

  /** §5.15 debugSteal({stealer, handler}) → {eligible, pPoke, parts, stolen} (stolen = one roll unless roll: false). */
  debugSteal(o) {
    const opts = o || {}, w = this.world;
    const d = this.byId[opts.stealer], h = this.byId[opts.handler] || this.ball.owner;
    if (!d || !h || d.team === h.team) return { eligible: false, pPoke: 0, parts: null, stolen: false };
    const dx = d.pos.x - h.pos.x, dz = d.pos.z - h.pos.z, dist = Math.sqrt(dx * dx + dz * dz);
    DBG.what = 'range'; DBG.log = null;
    const range = d.attrs.stealRange + (has(d, 'jordan.hawk') ? ABILITIES['jordan.hawk'].params.stealRange : 0);
    const dribbling = this.ball.owner === h && this.ball.state === 'dribble';
    const eligible = dribbling && dist <= range && w.time > h.immuneUntil && !h.isJumping && !h.shot.active && !d.disabled;
    const lx = Math.cos(h.yaw), lz = -Math.sin(h.yaw);
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const P = pokeChance(d, h, { side: sideOf(d, this), difficulty: this.difficultyId, ballNear: (dx * lx + dz * lz > 0) === (h.animator.ballHand === 2),
      exposed: dribbling && this.ball.pos.y < 0.45, protect: h.speed < 2.5 && !!h.nearestOpponentInFront(w, 1.0),
      behind: dist > 1e-6 && (dx * fx + dz * fz) / dist < -0.2, eligible, log: this.abilityLog, t: w.time });
    const pr = P.parts;
    const stolen = opts.roll === false ? false : eligible && this.rng.next() < P.pPoke;
    return { eligible, pPoke: P.pPoke, parts: { S0: pr.S0, stealF: pr.stealF, handleF: pr.handleF, side: pr.side, exposed: pr.exposed, protect: pr.protect, behind: pr.behind }, stolen };
  }

  /** §5.15 debugShake({handler, defender, move, combo, committed}) → {pShake, pAnkle, outcome: 'ankle'|'shake'|'none'}. */
  debugShake(o) {
    const opts = o || {};
    const h = this.byId[opts.handler], d = this.byId[opts.defender];
    if (!h || !d) return { pShake: 0, pAnkle: 0, outcome: 'none' };
    const hu = this.isUserControlled(h), du = this.isUserControlled(d);
    const D = DIFFICULTY[this.difficultyId];
    const dm = hu && !du ? D.humanShakeMul : (!hu && du ? D.cpuShakeMul : 1);
    const S = shakeChance(h, d, opts.move || 'move.cross', { committed: !!opts.committed, combo: opts.combo || 1, diffMul: dm });
    let outcome = 'none';
    if (S.pAnkle > 0 && this.rng.next() < S.pAnkle) outcome = 'ankle';
    else if (this.rng.next() < S.pShake) outcome = 'shake';
    return { pShake: S.pShake, pAnkle: S.pAnkle, outcome };
  }

  /** Puts `team` on offence in LIVE with `handler` holding the ball (debug staging). */
  stageLive(team, handler) {
    const w = this.world;
    if (w.state !== 'LIVE' || w.offense !== team) { this.enterCheck(team, 'debug'); this.goLive(); }
    for (let i = 0; i < 6; i++) {
      const q = this.players[i];
      q.animator.stopAction(); q.state = 'idle'; q.isJumping = false; q.jumpY = 0; q.stunT = 0; q.fallenT = 0;
      q.shot.active = false; q.move.active = false; q.passAct.active = false; q.stealAct.active = false; q.defJump.active = false;
      q.intent.move.x = 0; q.intent.move.z = 0; q.intent.move.mag = 0; q.intent.sprint = false;
      clearEdges(q.intent);
    }
    // everyone else out of the way (backcourt, spread in x)
    let k = 0;
    for (let i = 0; i < 6; i++) { const q = this.players[i]; if (q !== handler) this.teleport(q, -6 + 2.4 * k++, -1.5, 0); }
    if (this.ball.owner !== handler) this.giveBall(handler, 'held', null);
    handler.cx.catchT = -1e9;
    return handler;
  }

  /** Places p at (x, z) facing the rim with speed v toward it (and recent sprint), stamina full. */
  stageRun(p, x, z, v) {
    const dx = RIM.x - x, dz = RIM.z - z, d = Math.sqrt(dx * dx + dz * dz) || 1;
    this.teleport(p, x, z, Math.atan2(dx, dz));
    p.vel.set(dx / d * v, 0, dz / d * v);
    p.stamina = 1; p.sprintRecentT = 0.3; p.sprintedRecently = true;
  }

  /**
   * §5.15 forceAbility(id, opts?) → boolean: stages the trigger conditions and fires the ability through the real game
   * path (signature triggers start their action: FT-line dunk, euro, post fade, Yao hook, stepback, jab, combo,
   * chase-down); passives are evaluated at their hook in a staged context. True when the log booked it.
   */
  forceAbility(id, opts) {
    const desc = ABILITIES[id];
    if (!desc) return false;
    const w = this.world, o = opts || {};
    const ownerId = o.player && desc.owners.indexOf(o.player) >= 0 ? o.player : desc.owners[0];
    const p = this.byId[ownerId];
    const before = this.abilityLog.count(id);
    const c = resetAbilityCtx(DBG);
    c.t = w.time; c.log = this.abilityLog; c.world = w; c.rng = this.rng;
    const shoot = () => { const r = resolveShot(p, w); r.dodged = r.dodged || null; this.startShot(p, r, 0); };
    switch (id) {
      case 'jordan.ftDunk': this.stageLive(p.team, p); this.stageRun(p, 0, RIM.z + 6.8, 6.6); shoot(); break;
      case 'giannis.euro': {
        this.stageLive(p.team, p); this.stageRun(p, 0, RIM.z + 6.0, 4.2);
        const lane = this.roster[1 - p.team][0];
        this.teleport(lane, 0, RIM.z + 4.6, 0);
        shoot(); break;
      }
      case 'kobe.postFade': {
        this.stageLive(p.team, p); this.teleport(p, 2.2, -10.3, 0);
        this.teleport(this.roster[1 - p.team][0], 2.0, -11.2, Math.PI);
        p.setState('post'); shoot(); break;
      }
      case 'yao.hook': this.stageLive(p.team, p); this.teleport(p, 1.2, -10.4, 0); shoot(); break;
      case 'kyrie.stepback': {
        this.stageLive(p.team, p); this.teleport(p, 0, -6.6, Math.PI); this.startDribble(p);
        p.intent.move.x = 0; p.intent.move.z = 1; p.intent.move.mag = 1;
        shoot(); p.intent.move.z = 0; p.intent.move.mag = 0; break;
      }
      case 'kobe.jab': {
        this.stageLive(p.team, p); this.teleport(p, 0, -6.6, Math.PI);
        this.teleport(this.roster[1 - p.team][0], 0, -7.6, 0);
        const r = resolveCross(p, w);
        if (r.action === 'jab') this.startJab(p, r.moveId, r.mirror);
        break;
      }
      case 'kyrie.combo': {
        this.stageLive(p.team, p); this.teleport(p, 0, -6.6, Math.PI); this.startDribble(p);
        this.startMove(p, 'move.cross', false, 1);
        p.cx.lastCrossT = w.time; p.cx.comboNext = 2; p.cx.queuedMag = 0; p.cx.queuedLat = 0; p.cx.queuedFwd = 0;
        this.runQueuedMove(p); break;
      }
      case 'lebron.chaseDown': {
        const h = this.roster[1 - p.team][0];
        this.stageLive(h.team, h); this.stageRun(h, 0, RIM.z + 1.8, 4.0);
        this.teleport(p, 0, RIM.z + 4.3, Math.PI); p.vel.set(0, 0, -5);
        const r = resolveShot(h, w);
        r.kind = 'layup'; r.variant = 'std'; r.clipHint = null; r.dodged = null;
        this.startShot(h, r, 0); break;
      }
      case 'clutch': c.quarter = 4; c.gameClock = 10; c.scoreDiff = 0; mul(p, 'clutch', c); break;
      case 'jordan.fade': c.kind = 'fade'; c.zone = 'mid'; c.generic = 0.85; mul(p, 'contestA', c); break;
      case 'jordan.air': c.kind = 'layup'; c.variant = 'std'; mul(p, 'airtime', c); break;
      case 'jordan.hawk': c.what = 'stealF'; mul(p, 'steal', c); break;
      case 'kobe.tough': c.kind = 'jumper'; c.variant = 'set'; c.zone = 'mid'; c.generic = 1; mul(p, 'contestA', c); break;
      case 'lebron.powerDrive': c.what = 'push'; c.speed = 4.5; mul(p, 'drive', c); break;
      case 'lebron.skipPass': c.what = 'sigma'; c.dist = 10; mul(p, 'pass', c); break;
      case 'lebron.bully': postGain(p, this.byId.kyrie, c); break;
      case 'giannis.longDunk': c.kind = 'dunk'; c.variant = 'longGather'; c.zone = 'dunk'; c.pg = 0.95; c.generic = 1; mul(p, 'pg', c); break;
      case 'giannis.helpBlock': c.helpDefender = true; mul(p, 'blockDefender', c); break;
      case 'yao.highRelease': c.kind = 'jumper'; c.defender = this.byId.kyrie; mul(p, 'blockShooter', c); break;
      case 'yao.anchor': {
        const sx = p.pos.x, sz = p.pos.z;
        p.pos.x = RIM.x + 0.6; p.pos.z = RIM.z + 0.9;
        mul(p, 'blockDefender', c);
        p.pos.x = sx; p.pos.z = sz;
        break;
      }
      case 'yao.post': noteApplied(c, 'yao.post', p, 'post'); break;
      case 'kyrie.finisher': c.kind = 'layup'; c.variant = 'std'; c.zone = 'layup'; mul(p, 'contestA', c); break;
      default: return false;
    }
    return this.abilityLog.count(id) > before;
  }
}

/**
 * The gameplay part of `window.__game` (§5.15); main.js (WP9) merges the presentation hooks (renderer, camera,
 * director, quality, perf, ui, replay, arena, audio, input, bot, lib, characters, legendsReady, simplified) via
 * `extras`. Getters read live state; snapshot methods allocate (debug only).
 */
export function makeDebugHooks(game, extras) {
  const g = game;
  const hooks = {
    version: 'legends-3v3 v2',
    game: g,
    legends: LEGENDS,
    get state() { return g.world.state; },
    get world() { return g.world; },
    get controlled() { return g.world.controlled; },
    get ball() { return g.ball; },
    get rng() { return g.rng; },
    get meter() { return g.meter; },
    get debug() { return g.debug; },
    get abilityLog() { return g.abilityLog; },
    get events() { return g.recentEvents().map((e) => Object.assign({}, e, { params: Object.assign({}, e.params) })); },
    get lineup() {
      const l = g.lineup;
      return { a: l.a.slice(), b: l.b.slice(), user: l.user, kits: l.kits, mode: resolveKitModes(l).a === 'classic' ? 'classic' : 'allstar' };
    },
    teleport: (i, x, z, yaw) => g.teleport(i, x, z, yaw),
    place: (id, x, z, yaw) => !!g.teleport(id, x, z, yaw),
    debugShoot: (o) => g.debugShoot(o),
    setClock: (o) => g.setClock(o),
    turnover: () => g.turnover(),
    fastForward: (s) => g.fastForward(s),
    setLineup: (l) => g.setLineup(l),
    setRules: (r) => g.setRules(r),
    setDifficulty: (id) => g.setDifficulty(id),
    player(id) {
      const p = g.byId[id];
      if (!p) return null;
      const ch = p.character;
      const s = p.stats;
      return {
        id: p.id, team: p.team, x: p.pos.x, z: p.pos.z, yaw: p.yaw, vx: p.vel.x, vz: p.vel.z, state: p.state, jumpY: p.jumpY,
        stamina: p.stamina, hasBall: p.hasBall, controlled: g.world.controlled === p, attrs: p.attrs,
        stats: { pts: s.pts, fgm: s.fgm, fga: s.fga, tpm: s.tpm, tpa: s.tpa, reb: s.reb, oreb: s.oreb, ast: s.ast, stl: s.stl, blk: s.blk },
        lod: ch ? ch.lod : null, kitMode: ch ? ch.kitMode : null,
      };
    },
    debugContest: (o) => g.debugContest(o),
    debugBlock: (o) => g.debugBlock(o),
    debugSteal: (o) => g.debugSteal(o),
    debugShake: (o) => g.debugShake(o),
    forceAbility: (id, o) => g.forceAbility(id, o),
    metrics: () => g.metrics.snapshot(),
    resetMetrics: () => g.metrics.reset(),
    ai(id) {
      const p = g.byId[id];
      if (!p) return null;
      if (g.ai && typeof g.ai.aiDebug === 'function') return g.ai.aiDebug(p);
      const a = p.ai || {};
      return { action: a.action || a.plan || null, scores: Object.assign({}, a.scores || {}), gates: Object.assign({}, a.gates || {}) };
    },
    holdDead: (s) => g.holdDead(s),
    passPreview: () => g.passPreview(),
  };
  if (extras) {
    for (const k of Object.keys(extras)) Object.defineProperty(hooks, k, Object.getOwnPropertyDescriptor(extras, k));
  }
  return hooks;
}

