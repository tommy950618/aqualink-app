/**
 * @module abilities
 * The 22 signature abilities (spec §5.8, GP §8, with C10/C11 windows): frozen descriptors, the hook queries the
 * gameplay code calls (`mul`, `add`, `trigger`, `eligible`), rule helpers for the effects that are not a single
 * multiplier (contest range, block modifiers, bumps, passes, post gains, combos, euro dodge, fixed make), and the
 * ability log ring (`AbilityLog`, 256 entries) that backs `game.abilityLog` / `__game.abilityLog`.
 *
 * Hooks: `shotKind, pg, contestA, blockShooter, blockDefender, steal, pass, move, drive, post, airtime, clutch`.
 *   - `mul(player, hook, ctx)` → product of the player's ability multipliers at that hook (1 = no effect).
 *     Override-style effects ("typeMul 1.00 (generic 0.94)", "A ×= 0.65 (generic 0.85)") are returned as the ratio
 *     override / `ctx.generic`, so `generic × mul` equals the override; plain effects multiply.
 *   - `add(player, hook, ctx)` → sum of additive bonuses (Jordan `hawk` steal range / interception radius).
 *   - `trigger(player, hook, ctx)` → id of the first of the player's trigger abilities at that hook whose
 *     conditions hold (priority order), else null. Rolls (Jordan's mid-air switch) use `ctx.rng`.
 *   - `eligible(player, id, ctx)` → the same condition test for one id, never rolls and never logs (AI estimates).
 * Every applied multiplier ≠ 1 and every trigger is logged to `ctx.log` (an `AbilityLog`, or null for estimates).
 *
 * Player shape read here (gameplay `Player`): `id` (legend id; or `legend` = the LEGENDS record), `team`, `pos {x,z}`,
 * `vel {x,z}`, `stamina`, `attrs` (ratings.js), `jumpY`, `isJumping`, `state`, `defAssign` (the attacker a defender
 * is assigned to, or null). World shape: `{ players: Player[] }`.
 *
 * Zero allocation per call: descriptors and per-legend hook lists are built once; the log ring is preallocated.
 */
import { LEGENDS, LEGEND_IDS } from './legends.js';
import { RIM, TRIGGERS, BLOCK, SHAKE, STRENGTH, POST, PASS, SHOT_V2 } from './constants.js';
import { n } from './ratings.js';

const DEG = Math.PI / 180;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The legend record of a gameplay player (or of a legend record itself). */
export function legendOf(p) {
  if (!p) return null;
  if (p.legend && p.legend.ratings) return p.legend;
  if (p.ratings && p.stats) return p;
  return LEGENDS[p.id] || null;
}

/** Listed height of a player (m). */
function heightOf(p) {
  const L = legendOf(p);
  return L ? L.stats.heightM : 2.0;
}

function strengthOf(p) {
  const L = legendOf(p);
  return L ? L.ratings.strength : 50;
}

// --------------------------------------------------------------------------------------------------------------------
// Geometry helpers (planar, x/z)
// --------------------------------------------------------------------------------------------------------------------

/** Horizontal distance of a player's feet to the rim centre. */
export function rimDist(p) {
  const dx = RIM.x - p.pos.x, dz = RIM.z - p.pos.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Horizontal speed of a player. */
export function speedOf(p) {
  const v = p.vel;
  return v ? Math.sqrt(v.x * v.x + v.z * v.z) : 0;
}

/** Cosine of the angle between a player's velocity and the direction to the rim (0 when standing). */
export function headingCos(p) {
  const v = p.vel;
  if (!v) return 0;
  const sp = Math.sqrt(v.x * v.x + v.z * v.z);
  const dx = RIM.x - p.pos.x, dz = RIM.z - p.pos.z;
  const dl = Math.sqrt(dx * dx + dz * dz);
  if (sp < 1e-6 || dl < 1e-6) return 0;
  return (v.x * dx + v.z * dz) / (sp * dl);
}

/** Planar distance from point (px, pz) to the segment (ax, az) → (bx, bz). */
export function segDist(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-12 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + abx * t - px, cz = az + abz * t - pz;
  return Math.sqrt(cx * cx + cz * cz);
}

/** True when no opponent of `p` stands within `r` of the segment p → rim. */
export function pathClear(p, world, r) {
  const players = world && world.players;
  if (!players) return true;
  for (let i = 0; i < players.length; i++) {
    const o = players[i];
    if (o === p || o.team === p.team) continue;
    if (segDist(o.pos.x, o.pos.z, p.pos.x, p.pos.z, RIM.x, RIM.z) < r) return false;
  }
  return true;
}

/**
 * True when no opponent is closer to the rim than `p` inside the cone of full aperture `apertureDeg` around the
 * p → rim direction (FT-line dunk: 60°, i.e. ±30°).
 */
export function coneClear(p, world, apertureDeg) {
  const players = world && world.players;
  if (!players) return true;
  const dx = RIM.x - p.pos.x, dz = RIM.z - p.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d < 1e-6) return true;
  const cosHalf = Math.cos(0.5 * apertureDeg * DEG);
  for (let i = 0; i < players.length; i++) {
    const o = players[i];
    if (o === p || o.team === p.team) continue;
    const ox = o.pos.x - p.pos.x, oz = o.pos.z - p.pos.z;
    const ol = Math.sqrt(ox * ox + oz * oz);
    if (ol < 1e-6) return false;
    const orx = RIM.x - o.pos.x, orz = RIM.z - o.pos.z;
    if (Math.sqrt(orx * orx + orz * orz) >= d) continue;          // not closer to the rim
    if ((ox * dx + oz * dz) / (ol * d) >= cosHalf) return false;   // inside the cone
  }
  return true;
}

/** dot(dir(a → b), dir(a → rim)); 0 when degenerate. Positive = b is between a and the rim side. */
export function frontDot(a, b) {
  const bx = b.pos.x - a.pos.x, bz = b.pos.z - a.pos.z;
  const rx = RIM.x - a.pos.x, rz = RIM.z - a.pos.z;
  const bl = Math.sqrt(bx * bx + bz * bz), rl = Math.sqrt(rx * rx + rz * rz);
  if (bl < 1e-6 || rl < 1e-6) return 0;
  return (bx * rx + bz * rz) / (bl * rl);
}

/** Clutch window (§5.3.4): quarter ≥ 4 (OT included), game clock ≤ 24 s, |score diff| ≤ 3. */
export function clutchWindow(quarter, gameClock, scoreDiff) {
  return quarter >= SHOT_V2.CLUTCH_QUARTER && gameClock <= SHOT_V2.CLUTCH_CLOCK && Math.abs(scoreDiff) <= SHOT_V2.CLUTCH_DIFF;
}

// --------------------------------------------------------------------------------------------------------------------
// Context object
// --------------------------------------------------------------------------------------------------------------------

/**
 * A reusable hook context (one per call site; reset with `resetAbilityCtx`). Field meanings:
 * - `t` game time (log), `log` AbilityLog | null (null = estimate: nothing is logged), `rng` Rng | null, `world`.
 * - shot: `kind`, `variant`, `zone`, `d` (feet → rim), `generic` (generic value at an override hook), `pg` (Pg × typeMul).
 * - clutch: `quarter`, `gameClock`, `scoreDiff` (the acting player's team minus the opponent).
 * - input (context resolver): `holding`, `dribbling`, `inPost`, `inMove` (current move id | null), `stickMag` (0–1),
 *   `stickRim` (cos stick vs player→rim), `stickLat` (signed lateral component, + = right when facing the rim),
 *   `stickDef` (cos stick vs player→on-ball defender), `backToRim` (facing away / side-on to the rim),
 *   `jabsThisHold`, `comboIndex` (1 = first move, 2 = 2nd chained, 3 = 3rd), `sinceTap` (s since the previous CROSS).
 * - timers (s since; Infinity = never): `sinceJab`, `sinceBumpWon`.
 * - people: `shooter`, `defender` (the other party of a block / contest / steal / bump / post), `helpDefender` (bool).
 * - scalars: `what` (sub-quantity at multi-value hooks: steal 'stealF'|'range'|'intR', move 'bite', post 'gain',
 *   drive 'push'), `speed` (handler speed for drive hooks), `dist` (pass distance), `kickOut` (bool), `handDist`
 *   (nearest block-eligible hand → ball for Jordan's mid-air switch), `ftDunksUsed` (this game, this player).
 */
export function makeAbilityCtx() {
  return resetAbilityCtx({});
}

/** Reset every field of a context to its neutral value (no allocation). Returns ctx. */
export function resetAbilityCtx(ctx) {
  ctx.t = 0; ctx.log = null; ctx.rng = null; ctx.world = null;
  ctx.kind = null; ctx.variant = null; ctx.zone = null; ctx.d = 0; ctx.generic = 1; ctx.pg = 1;
  ctx.quarter = 1; ctx.gameClock = Infinity; ctx.scoreDiff = 0;
  ctx.holding = false; ctx.dribbling = false; ctx.inPost = false; ctx.inMove = null;
  ctx.stickMag = 0; ctx.stickRim = 0; ctx.stickLat = 0; ctx.stickDef = 0; ctx.backToRim = false;
  ctx.jabsThisHold = 0; ctx.comboIndex = 1; ctx.sinceTap = Infinity;
  ctx.sinceJab = Infinity; ctx.sinceBumpWon = Infinity;
  ctx.shooter = null; ctx.defender = null; ctx.helpDefender = false;
  ctx.what = null; ctx.speed = 0; ctx.dist = 0; ctx.kickOut = false; ctx.handDist = Infinity; ctx.ftDunksUsed = 0;
  return ctx;
}

const STICK_NEUTRAL = 0.15;   // |stick| below this = neutral (§5.9.3 idle definition)

function stickTowardRim(ctx) {
  return ctx.stickMag >= STICK_NEUTRAL && ctx.stickRim >= 0.5;
}

// --------------------------------------------------------------------------------------------------------------------
// Descriptors
// --------------------------------------------------------------------------------------------------------------------

const JUMP_FAMILY = { jumper: true, fade: true, stepback: true, turnFade: true };
const YAO_JUMP_SHOTS = { jumper: true, fade: true, stepback: true, turnFade: true, hook: true };
// Jordan's signature finishes keep their own jump heights and normal gravity (C12).
const JORDAN_SIGNATURE_VARIANTS = { switch: true, ftDunk: true, cradle: true };

function inClutch(p, ctx) {
  return clutchWindow(ctx.quarter, ctx.gameClock, ctx.scoreDiff);
}

/** Effects keyed by ability id: `mul[hook]`, `add[hook]` return numbers; `test[hook]` returns a boolean condition. */
const IMPL = {
  clutch: {
    mul: {
      clutch: (p, c) => (inClutch(p, c) ? SHOT_V2.CLUTCH_K : 1),
      contestA: (p, c) => (inClutch(p, c) ? 0.90 : 1),
    },
  },
  'jordan.fade': {
    mul: {
      pg: (p, c) => (c.kind === 'fade' || c.kind === 'turnFade' ? 1.00 / c.generic : 1),
      contestA: (p, c) => (c.kind === 'fade' || c.kind === 'turnFade' ? 0.65 / c.generic : 1),
    },
  },
  'jordan.air': {
    mul: {
      airtime: (p, c) => ((c.kind === 'layup' || c.kind === 'dunk') && !JORDAN_SIGNATURE_VARIANTS[c.variant] ? 0.80 : 1),
      contestA: (p, c) => (c.kind === 'layup' && c.variant === 'switch' ? 0.70 : 1),
      blockShooter: (p, c) => (c.kind === 'layup' && c.variant === 'switch' ? 0.40 : 1),
    },
    test: {
      // Mid-air switch: during the ascent of a layup a block-eligible defender's hand within 0.70 m of the ball,
      // then a 0.75 roll (once per layup; the caller rolls at most once).
      blockShooter: (p, c, roll) => c.kind === 'layup' && c.variant !== 'switch' && c.handDist <= TRIGGERS.JORDAN_SWITCH.HAND_R
        && (!roll || !c.rng || c.rng.next() < TRIGGERS.JORDAN_SWITCH.P),
    },
  },
  'jordan.ftDunk': {
    test: {
      shotKind: (p, c) => {
        const T = TRIGGERS.FT_DUNK;
        const d = rimDist(p);
        return d >= T.D_MIN && d <= T.D_MAX && speedOf(p) >= T.SPEED && headingCos(p) >= Math.cos(T.HEADING_DEG * DEG)
          && p.stamina >= T.STAMINA && c.ftDunksUsed < T.MAX_PER_GAME
          && pathClear(p, c.world, T.LANE_R) && coneClear(p, c.world, T.CONE_DEG);
      },
    },
  },
  'jordan.hawk': {
    mul: { steal: (p, c) => (c.what === 'stealF' ? 1.15 : 1) },
    add: { steal: (p, c) => (c.what === 'range' ? 0.15 : c.what === 'intR' ? 0.20 : 0) },
  },
  'kobe.postFade': {
    mul: {
      pg: (p, c) => (c.kind === 'turnFade' && c.variant === 'postFade' ? 1.00 / c.generic : 1),
      contestA: (p, c) => (c.kind === 'turnFade' && c.variant === 'postFade' ? 0.55 / c.generic : 1),
    },
    test: { shotKind: (p, c) => c.inPost && !stickTowardRim(c) },
  },
  'kobe.jab': {
    mul: {
      move: (p, c) => (c.what === 'bite' ? 1.3 : 1),
      contestA: (p, c) => (c.variant === 'jabPullup' ? 0.70 : 1),
    },
    // Holding (triple threat) + CROSS with the stick neutral or toward the defender, at most 2 jabs per hold.
    test: { move: (p, c) => c.holding && !c.inPost && (c.stickMag < STICK_NEUTRAL || c.stickDef >= 0.5) && c.jabsThisHold < 2 },
  },
  'kobe.tough': {
    mul: { contestA: (p, c) => ((c.zone === 'mid' || c.zone === 'close') && JUMP_FAMILY[c.kind] ? 0.70 : 1) },
  },
  'lebron.powerDrive': {
    mul: {
      contestA: (p, c) => ((c.kind === 'layup' || c.kind === 'dunk') && c.sinceBumpWon <= 0.8 ? 0.60 : 1),
      drive: (p, c) => (c.what === 'push' && c.speed >= 4.0 ? 1.5 : 1),
    },
  },
  'lebron.chaseDown': {
    // An opponent starts a layup/dunk while LeBron is behind him (dot < −0.2) within 4.0 m.
    test: {
      blockDefender: (p, c) => {
        const sh = c.shooter;
        if (!sh || (c.kind !== 'layup' && c.kind !== 'dunk')) return false;
        const dx = p.pos.x - sh.pos.x, dz = p.pos.z - sh.pos.z;
        return Math.sqrt(dx * dx + dz * dz) <= TRIGGERS.CHASE.R && frontDot(sh, p) < TRIGGERS.CHASE.DOT;
      },
    },
  },
  'lebron.skipPass': {
    mul: { pass: (p, c) => (c.what === 'sigma' && (c.dist >= 8 || c.kickOut) ? 0.6 : 1) },
  },
  'lebron.bully': {
    mul: {
      post: (p, c) => {
        if (c.what !== 'gain' || !c.defender) return 1;
        const shorter = heightOf(p) - heightOf(c.defender) >= 0.05 - 1e-9;
        const weaker = strengthOf(p) - strengthOf(c.defender) >= 15;
        return shorter || weaker ? 1.3 : 1;
      },
    },
  },
  'giannis.euro': {
    test: {
      shotKind: (p, c) => {
        const T = TRIGGERS.EURO;
        const d = rimDist(p);
        return (c.dribbling || c.holding) && d >= T.D_MIN && d <= T.D_MAX && speedOf(p) >= T.SPEED
          && headingCos(p) >= Math.cos(T.HEADING_DEG * DEG);
      },
    },
  },
  'giannis.longDunk': {
    mul: {
      pg: (p, c) => (c.kind === 'dunk' && c.variant === 'longGather' ? 0.99 / c.pg : 1),
      contestA: (p, c) => (c.kind === 'dunk' && c.variant === 'longGather' ? 0.50 : 1),
      blockShooter: (p, c) => (c.kind === 'dunk' && c.variant === 'longGather' ? 0.60 : 1),
    },
    test: {
      shotKind: (p, c) => {
        const T = TRIGGERS.LONG_GATHER;
        const d = rimDist(p);
        return d >= T.D_MIN && d <= T.D_MAX && speedOf(p) >= T.SPEED && pathClear(p, c.world, T.PATH_R);
      },
    },
  },
  'giannis.helpBlock': {
    mul: { blockDefender: (p, c) => (c.helpDefender ? 1.25 : 1) },
  },
  'yao.hook': {
    mul: {
      pg: (p, c) => (c.kind === 'hook' ? 1.00 / c.generic : 1),
      contestA: (p, c) => (c.kind === 'hook' ? 0.45 / c.generic : 1),
    },
    test: {
      shotKind: (p, c) => (c.inPost && !stickTowardRim(c)) || (rimDist(p) <= TRIGGERS.YAO_HOOK_D && c.backToRim),
    },
  },
  'yao.highRelease': {
    mul: {
      blockShooter: (p, c) => (YAO_JUMP_SHOTS[c.kind] && c.defender && heightOf(c.defender) < TRIGGERS.BIG_H ? 0.60 : 1),
    },
  },
  'yao.anchor': {
    mul: {
      blockDefender: (p, c) => (rimDist(p) <= TRIGGERS.YAO_ANCHOR.BLOCK_RIM_R ? 1.20 : 1),
    },
  },
  'yao.post': {
    mul: { pg: (p, c) => (c.kind === 'layup' && c.variant === 'upUnder' ? 1.00 / c.generic : 1) },
  },
  'kyrie.combo': {
    // A queued 2nd / 3rd move: CROSS tapped ≤ 0.35 s after the previous one (or during a move).
    test: { move: (p, c) => c.comboIndex >= 2 && c.comboIndex <= 3 && (c.sinceTap <= SHAKE.COMBO_WINDOW || c.inMove !== null) },
  },
  'kyrie.finisher': {
    mul: {
      pg: (p, c) => (c.kind === 'floater' ? 1.00 / c.generic : 1),
      contestA: (p, c) => (c.kind === 'layup' ? 0.55 : c.kind === 'floater' ? 0.60 / c.generic : 1),
      blockShooter: (p, c) => (c.kind === 'layup' ? 0.55 : 1),
    },
  },
  'kyrie.stepback': {
    mul: {
      pg: (p, c) => (c.kind === 'stepback' ? 1.00 / c.generic : 1),
      contestA: (p, c) => (c.kind === 'stepback' ? 0.60 / c.generic : 1),
    },
    test: {
      shotKind: (p, c) => (c.dribbling && c.stickMag >= TRIGGERS.STEPBACK_STICK && c.stickRim <= -TRIGGERS.STEPBACK_STICK)
        || c.inMove === 'move.stepback',
    },
  },
};

/** Descriptor table: owners, type, hooks (derived from IMPL), parameters, trigger priority, caption key. */
const DEFS = [
  ['clutch', ['kobe', 'jordan', 'kyrie'], 'passive', 0, { K: SHOT_V2.CLUTCH_K, A: 0.90, aiShotMul: 1.5 }],
  ['jordan.fade', ['jordan'], 'passive', 0, { A: 0.65, genericA: 0.85, typeMul: 1.00, genericTypeMul: 0.94, drift: 0.55 }],
  ['jordan.air', ['jordan'], 'passive', 0, { gScale: 0.80, std2MaxD: TRIGGERS.LAYUP.STD2_MAX_JORDAN, switchHandR: TRIGGERS.JORDAN_SWITCH.HAND_R,
    switchP: TRIGGERS.JORDAN_SWITCH.P, switchBlockMul: 0.40, switchA: 0.70 }],
  ['jordan.ftDunk', ['jordan'], 'trigger', 10, { ...TRIGGERS.FT_DUNK, noBlockFromBehind: true, crowd: 1.0 }],
  ['jordan.hawk', ['jordan'], 'passive', 0, { stealF: 1.15, stealRange: 0.15, intR: 0.20, aiGamble: 1.30 }],
  ['kobe.postFade', ['kobe'], 'trigger', 20, { drift: 0.45, A: 0.55, typeMul: 1.00 }],
  ['kobe.jab', ['kobe'], 'trigger', 30, { bite: 1.3, pullupA: 0.70, pullupWindow: 0.8, maxJabs: 2 }],
  ['kobe.tough', ['kobe'], 'passive', 0, { A: 0.70 }],
  ['lebron.powerDrive', ['lebron'], 'passive', 0, { minSpeed: 4.0, stunDiff: 10, pushMul: 1.5, keepMin: 0.80, finishWindow: 0.8, A: 0.60 }],
  ['lebron.chaseDown', ['lebron'], 'trigger', 40, { ...TRIGGERS.CHASE, rHand: BLOCK.R_HAND_CHASE, window: BLOCK.CHASE_WINDOW, B0: BLOCK.CHASE_B0,
    cap: BLOCK.CHASE_CAP, pinBoardR: BLOCK.PIN_BOARD_R }],
  ['lebron.skipPass', ['lebron'], 'passive', 0, { minDist: 8, range: 14, speed: 15, release: 0.10, sigmaMul: 0.6, aiPass: 1.35 }],
  ['lebron.bully', ['lebron'], 'passive', 0, { gainMul: 1.3, shorter: 0.05, weaker: 15 }],
  ['giannis.euro', ['giannis'], 'trigger', 60, { ...TRIGGERS.EURO }],
  ['giannis.longDunk', ['giannis'], 'passive', 50, { ...TRIGGERS.LONG_GATHER, pg: 0.99, A: 0.50, stuffMul: 0.60 }],
  ['giannis.helpBlock', ['giannis'], 'passive', 0, { helpRadius: TRIGGERS.HELP_RADIUS_GIANNIS, reactionMul: 0.5, Rc: TRIGGERS.GIANNIS_HELP_RC,
    rHand: BLOCK.R_HAND_BIG, blockMul: 1.25, chaseLevel: 1 }],
  ['yao.hook', ['yao'], 'trigger', 70, { maxD: TRIGGERS.YAO_HOOK_D, A: 0.45, release: 3.55, minBlockerH: TRIGGERS.BIG_H, B0Mul: 0.5 }],
  ['yao.highRelease', ['yao'], 'passive', 0, { blockMul: 0.60, vsBelowH: TRIGGERS.BIG_H }],
  ['yao.anchor', ['yao'], 'passive', 0, { ...TRIGGERS.YAO_ANCHOR, rHand: BLOCK.R_HAND_BIG, blockMul: 1.20 }],
  ['yao.post', ['yao'], 'passive', 0, { entryD: 5.5, dropStepDunkD: 1.5, upUnderWindow: 0.6, upUnderTypeMul: 1.0 }],
  ['kyrie.combo', ['kyrie'], 'trigger', 80, { chain: SHAKE.CHAIN_KYRIE, comboMul2: SHAKE.COMBO_2_KYRIE, comboMul3: SHAKE.COMBO_3, AB0: SHAKE.AB0_KYRIE }],
  ['kyrie.finisher', ['kyrie'], 'passive', 0, { layupA: 0.55, blockMul: 0.55, floaterTypeMul: 1.00, floaterA: 0.60, bigH: TRIGGERS.BIG_H,
    bigR: 1.5, baselineDeg: 35 }],
  ['kyrie.stepback', ['kyrie'], 'trigger', 90, { drift: 0.80, genericDrift: 0.70, lebronDrift: 0.50, A: 0.60, typeMul: 1.00 }],
];

const HOOKS = ['shotKind', 'pg', 'contestA', 'blockShooter', 'blockDefender', 'steal', 'pass', 'move', 'drive', 'post', 'airtime', 'clutch'];

/**
 * Caption keys (GP §16 i18n list; the chase-down uses `cap.chaseDown`, Yao's drop step `cap.ab.yao.dropStep`).
 * The game shows a caption for `kind === 'trigger'` abilities when they fire (§5.8); the passive keys are available
 * for the moments the game chooses (e.g. a power-drive bump that wins).
 */
const CAPTIONS = {
  'jordan.ftDunk': 'cap.ab.jordan.ftDunk', 'jordan.fade': 'cap.ab.jordan.fade', 'kobe.postFade': 'cap.ab.kobe.postFade',
  'kobe.jab': 'cap.ab.kobe.jab', 'lebron.powerDrive': 'cap.ab.lebron.powerDrive', 'lebron.chaseDown': 'cap.chaseDown',
  'lebron.skipPass': 'cap.ab.lebron.skipPass', 'giannis.euro': 'cap.ab.giannis.euro', 'giannis.longDunk': 'cap.ab.giannis.longDunk',
  'yao.hook': 'cap.ab.yao.hook', 'yao.post': 'cap.ab.yao.dropStep', 'kyrie.combo': 'cap.ab.kyrie.combo',
  'kyrie.finisher': 'cap.ab.kyrie.finisher', 'kyrie.stepback': 'cap.ab.kyrie.stepback',
};

function buildDescriptor([id, owners, kind, priority, params]) {
  const impl = IMPL[id];
  const hooks = [];
  for (const h of HOOKS) {
    if ((impl.mul && impl.mul[h]) || (impl.add && impl.add[h]) || (impl.test && impl.test[h])) hooks.push(h);
  }
  return Object.freeze({
    id, legend: owners.length === 1 ? owners[0] : Object.freeze(owners.slice()), owners: Object.freeze(owners.slice()), kind,
    hooks: Object.freeze(hooks), params: Object.freeze(params), priority, caption: CAPTIONS[id] || null,
  });
}

/** The 22 frozen ability descriptors by id. */
export const ABILITIES = Object.freeze(Object.fromEntries(DEFS.map((d) => [d[0], buildDescriptor(d)])));

/** All ability ids in table order. */
export const ABILITY_IDS = Object.freeze(DEFS.map((d) => d[0]));

/** Trigger-test hooks per ability id (precomputed so `eligible` iterates without allocating). */
const TEST_HOOKS = {};
for (const id of ABILITY_IDS) TEST_HOOKS[id] = Object.freeze(IMPL[id].test ? HOOKS.filter((h) => IMPL[id].test[h]) : []);

// Hook lists per ability list (mul/add lists in ability order, test lists by trigger priority), cached per
// `abilities` array identity: built once for each legend record (a test fixture may pass its own record).
const LISTS = new WeakMap();
const EMPTY = Object.freeze([]);
const NO_LISTS = { mul: {}, add: {}, test: {} };

function buildLists(ids) {
  const out = { mul: {}, add: {}, test: {} };
  for (const h of HOOKS) {
    const m = [], a = [], t = [];
    for (const id of ids) {
      const impl = IMPL[id];
      if (!impl) continue;
      if (impl.mul && impl.mul[h]) m.push(id);
      if (impl.add && impl.add[h]) a.push(id);
      if (impl.test && impl.test[h]) t.push(id);
    }
    t.sort((x, y) => ABILITIES[x].priority - ABILITIES[y].priority);
    out.mul[h] = Object.freeze(m); out.add[h] = Object.freeze(a); out.test[h] = Object.freeze(t);
  }
  return out;
}

function listsOf(p) {
  const L = legendOf(p);
  if (!L || !L.abilities) return NO_LISTS;
  let lists = LISTS.get(L.abilities);
  if (!lists) { lists = buildLists(L.abilities); LISTS.set(L.abilities, lists); }
  return lists;
}
for (const lid of LEGEND_IDS) listsOf(LEGENDS[lid]);   // warm the cache for the six legends at load

function legendIdOf(p) {
  const L = legendOf(p);
  return L ? L.id : null;
}

/** True when the player's legend owns ability `id`. */
export function has(p, id) {
  const L = legendOf(p);
  if (!L) return false;
  const list = L.abilities;
  for (let i = 0; i < list.length; i++) if (list[i] === id) return true;
  return false;
}

/** Parameters of an ability (frozen), or null. */
export function params(id) {
  return ABILITIES[id] ? ABILITIES[id].params : null;
}

/**
 * Product of the player's ability multipliers at `hook` (1 = no effect). Each factor ≠ 1 is logged to `ctx.log`.
 */
export function mul(p, hook, ctx) {
  const list = listsOf(p).mul[hook] || EMPTY;
  let m = 1;
  for (let i = 0; i < list.length; i++) {
    const f = IMPL[list[i]].mul[hook](p, ctx);
    if (f !== 1) {
      m *= f;
      if (ctx.log) ctx.log.push(ctx.t, list[i], p.id, hook, ctx.kind);
    }
  }
  return m;
}

/** Sum of the player's additive ability bonuses at `hook` (0 = none). Each bonus ≠ 0 is logged. */
export function add(p, hook, ctx) {
  const list = listsOf(p).add[hook] || EMPTY;
  let s = 0;
  for (let i = 0; i < list.length; i++) {
    const v = IMPL[list[i]].add[hook](p, ctx);
    if (v !== 0) {
      s += v;
      if (ctx.log) ctx.log.push(ctx.t, list[i], p.id, hook, ctx.kind);
    }
  }
  return s;
}

/**
 * First trigger ability of the player at `hook` whose conditions hold (rolls included), logged; null if none.
 */
export function trigger(p, hook, ctx) {
  const list = listsOf(p).test[hook] || EMPTY;
  for (let i = 0; i < list.length; i++) {
    if (IMPL[list[i]].test[hook](p, ctx, true)) {
      if (ctx.log) ctx.log.push(ctx.t, list[i], p.id, hook, ctx.kind);
      return list[i];
    }
  }
  return null;
}

/** Condition test of one ability at any of its trigger hooks, without rolls and without logging. */
export function eligible(p, id, ctx) {
  if (!has(p, id)) return false;
  const impl = IMPL[id];
  const hooks = TEST_HOOKS[id];
  for (let i = 0; i < hooks.length; i++) if (impl.test[hooks[i]](p, ctx, false)) return true;
  return false;
}

/** Log an ability whose effect the caller applied directly (rule helpers below, release heights, …). */
export function noteApplied(ctx, id, p, hook) {
  if (ctx && ctx.log) ctx.log.push(ctx.t, id, p.id, hook, ctx.kind);
}

// --------------------------------------------------------------------------------------------------------------------
// Rule helpers (effects that are ranges, thresholds or caps rather than one multiplier)
// --------------------------------------------------------------------------------------------------------------------

/**
 * Contest range of defender `def` against `shooter` (§5.3.6): `{Rc, deter, id}` written into `out`.
 * Yao `anchor`: Yao within 2.5 m of the rim, zone close/layup/dunk, shooter within 3.0 m of Yao → Rc 3.0, deter 0.15.
 * Giannis `helpBlock`: he is a help defender (assigned to someone other than the shooter) → Rc 2.6.
 */
export function contestRange(def, shooter, zone, ctx, out) {
  out.Rc = SHOT_V2.RC; out.deter = 0; out.id = null;
  if (has(def, 'yao.anchor') && (zone === 'close' || zone === 'layup' || zone === 'dunk') && rimDist(def) <= TRIGGERS.YAO_ANCHOR.RIM_R) {
    const dx = def.pos.x - shooter.pos.x, dz = def.pos.z - shooter.pos.z;
    if (Math.sqrt(dx * dx + dz * dz) <= TRIGGERS.YAO_ANCHOR.SHOOTER_R) {
      out.Rc = TRIGGERS.YAO_ANCHOR.RC; out.deter = TRIGGERS.YAO_ANCHOR.DETER; out.id = 'yao.anchor';
      return out;
    }
  }
  if (has(def, 'giannis.helpBlock') && def.defAssign != null && def.defAssign !== shooter) {
    out.Rc = TRIGGERS.GIANNIS_HELP_RC; out.id = 'giannis.helpBlock';
  }
  return out;
}

/**
 * Block modifiers for one defender against one shot (§5.4): writes into `out`
 * `{eligible, behindOK, rHand, window, B0Mul, B0, cap, abilityMul, chase, pin}`.
 * `ctx.kind`/`ctx.variant` describe the shot; `ctx.helpDefender` whether `def` is a help defender; `chasing` true when
 * LeBron's chase-down trigger fired for this shot. Multipliers are logged (shooter- and defender-side hooks).
 * B0/cap/window are the per-kind values with the chase-down overrides; `eligible` false = may not block at all
 * (Yao's hook vs a defender shorter than 2.05 m).
 */
export function blockModifiers(shooter, def, ctx, chasing, out) {
  const kind = ctx.kind;
  out.eligible = true;
  out.chase = false;
  out.pin = false;
  out.rHand = BLOCK.R_HAND;
  out.window = BLOCK.WINDOW[kind] !== undefined ? BLOCK.WINDOW[kind] : 0;
  out.B0 = BLOCK.B0[kind] !== undefined ? BLOCK.B0[kind] : 0;
  out.cap = BLOCK.CAP[kind] !== undefined ? BLOCK.CAP[kind] : 0;
  out.B0Mul = 1;
  const L = legendOf(def);
  out.behindOK = !!(L && L.traits.chaseBlock >= 1 && (kind === 'layup' || kind === 'dunk'));
  // Yao's hook: only defenders with H ≥ 2.05 may block it, and their B0 is halved.
  if (kind === 'hook' && has(shooter, 'yao.hook')) {
    if (heightOf(def) < TRIGGERS.BIG_H) out.eligible = false;
    else out.B0Mul = 0.5;
    noteApplied(ctx, 'yao.hook', shooter, 'blockShooter');
  }
  if (has(def, 'yao.anchor') && rimDist(def) <= TRIGGERS.YAO_ANCHOR.BLOCK_RIM_R) out.rHand = BLOCK.R_HAND_BIG;
  if (has(def, 'giannis.helpBlock') && ctx.helpDefender) out.rHand = BLOCK.R_HAND_BIG;
  if (chasing && has(def, 'lebron.chaseDown') && (kind === 'layup' || kind === 'dunk')) {
    out.chase = true;
    out.pin = true;
    out.behindOK = true;
    out.rHand = BLOCK.R_HAND_CHASE;
    out.window = kind === 'layup' ? BLOCK.CHASE_WINDOW : out.window;
    out.B0 = BLOCK.CHASE_B0;
    out.cap = BLOCK.CHASE_CAP;
  }
  const saveDef = ctx.defender;
  ctx.defender = def;
  out.abilityMul = mul(shooter, 'blockShooter', ctx) * mul(def, 'blockDefender', ctx);
  ctx.defender = saveDef;
  return out;
}

/**
 * Drive bump rule for a handler (§5.6): `{stunDiff, pushMul, keepMin, id}` into `out`. LeBron `powerDrive` at speed
 * ≥ 4.0: stun threshold strDiff ≥ 10 (generic 20), push × 1.5, his keep ≥ 0.80.
 */
export function bumpRule(handler, speed, ctx, out) {
  out.stunDiff = STRENGTH.STUN_DIFF; out.pushMul = 1; out.keepMin = STRENGTH.KEEP_MIN; out.id = null;
  if (has(handler, 'lebron.powerDrive') && speed >= ABILITIES['lebron.powerDrive'].params.minSpeed) {
    const P = ABILITIES['lebron.powerDrive'].params;
    out.stunDiff = P.stunDiff; out.pushMul = P.pushMul; out.keepMin = P.keepMin; out.id = 'lebron.powerDrive';
  }
  return out;
}

/**
 * Pass rule (§5.5, LeBron `skipPass`): `{range, speed, release, sigmaMul, jumpPenalty, id}` into `out` for a pass of
 * `dist` metres (`kickOut` = a kick-out while driving). `attrs` = the passer's derived attributes.
 */
export function passRule(passer, attrs, dist, kickOut, out) {
  out.range = PASS.RANGE; out.speed = attrs.passSpeed; out.release = attrs.passRelease; out.sigmaMul = 1;
  out.jumpPenalty = PASS.JUMP_SIGMA; out.id = null;
  if (has(passer, 'lebron.skipPass')) {
    const P = ABILITIES['lebron.skipPass'].params;
    out.range = P.range;
    out.jumpPenalty = 1;                      // no jump-pass or drive-pass penalty
    if (dist >= P.minDist || kickOut) {
      out.speed = P.speed; out.release = P.release; out.sigmaMul = P.sigmaMul; out.id = 'lebron.skipPass';
    }
  }
  return out;
}

/** Post-up entry distance (§5.6): 5.0 m, Yao `post` 5.5 m. */
export function postEntryD(p) {
  return has(p, 'yao.post') ? ABILITIES['yao.post'].params.entryD : POST.ENTRY_D;
}

/**
 * Backdown gain per shove (§5.6): `clamp((0.12 + 0.006·strDiff + 0.15·(massF − 1)) × bully, 0.02, 0.35)` with LeBron
 * `bully` 1.3 when the defender is ≥ 0.05 m shorter or ≥ 15 strength weaker. The 0.35 m cap still applies with the
 * bully factor (GP §6.2 example: LeBron vs Kyrie 0.35).
 */
export function postGain(off, def, ctx) {
  const Lo = legendOf(off), Ld = legendOf(def);
  const strDiff = Lo.ratings.strength - Ld.ratings.strength;
  const massF = Lo.stats.weightKg / Ld.stats.weightKg;
  const raw = POST.GAIN_BASE + POST.GAIN_K * strDiff + POST.GAIN_MASS * (massF - 1);
  const saveW = ctx.what, saveD = ctx.defender;
  ctx.what = 'gain'; ctx.defender = def;
  const m = mul(off, 'post', ctx);
  ctx.what = saveW; ctx.defender = saveD;
  return clamp(raw * m, POST.GAIN_MIN, POST.GAIN_MAX);
}

/** Combo chain length (§5.7): Kyrie 3, Yao 0 (no dribble moves), others 2. */
export function chainLength(p) {
  const L = legendOf(p);
  if (L && L.traits.noDribbleMoves) return SHAKE.CHAIN_YAO;
  return has(p, 'kyrie.combo') ? SHAKE.CHAIN_KYRIE : SHAKE.CHAIN;
}

/** comboMul of the `index`-th move of a chain (1 = first): 1; 2nd Kyrie 2.0 / others 1.5; 3rd (Kyrie only) 3.0. */
export function comboMul(p, index) {
  if (index <= 1) return 1;
  const kyrie = has(p, 'kyrie.combo');
  if (index === 2) return kyrie ? SHAKE.COMBO_2_KYRIE : SHAKE.COMBO_2;
  return kyrie ? SHAKE.COMBO_3 : SHAKE.COMBO_2;
}

/** Ankle-break base AB0 (§5.7): Kyrie 0.06, everyone else 0.03. */
export function ankleBase(p) {
  return has(p, 'kyrie.combo') ? SHAKE.AB0_KYRIE : SHAKE.AB0;
}

/**
 * Euro-step dodge probability of the lane defender (§5.8 giannis.euro): `0.70 × (1.15 − 0.35·n(perimeterD))`
 * (Jordan 0.57, Yao 0.72); the generic `lay.euro` of the other legends uses × 0.6.
 */
export function euroDodgeP(stepper, laneDef) {
  const T = TRIGGERS.EURO;
  const Ld = legendOf(laneDef);
  const p = T.DODGE_BASE * (T.DODGE_K1 - T.DODGE_K2 * n(Ld.ratings.perimeterD));
  return has(stepper, 'giannis.euro') ? p : p * TRIGGERS.EURO_GENERIC.DODGE_MUL;
}

/** Fixed make probability of a shot (Jordan's FT-line dunk 0.97, no timing), or −1 when the normal model applies. */
export function fixedMake(p, ctx) {
  if (ctx.kind === 'dunk' && ctx.variant === 'ftDunk' && has(p, 'jordan.ftDunk')) {
    noteApplied(ctx, 'jordan.ftDunk', p, 'pg');
    return TRIGGERS.FT_DUNK.MAKE;
  }
  return -1;
}

/** Back-drift of a stepback (§5.8 kyrie.stepback): Kyrie 0.80, LeBron 0.50, generic 0.70 m. */
export function stepbackDrift(p) {
  const P = ABILITIES['kyrie.stepback'].params;
  if (has(p, 'kyrie.stepback')) return P.drift;
  return legendIdOf(p) === 'lebron' ? P.lebronDrift : P.genericDrift;
}

/** Help trigger radius (§5.10): Giannis 4.0 m, generic 3.2 m. */
export function helpRadius(p) {
  return has(p, 'giannis.helpBlock') ? TRIGGERS.HELP_RADIUS_GIANNIS : TRIGGERS.HELP_RADIUS;
}

// --------------------------------------------------------------------------------------------------------------------
// Ability log
// --------------------------------------------------------------------------------------------------------------------

/**
 * Ring of the last `capacity` (256) ability applications `{t, id, player, ctx, kind}` (`ctx` = the hook name,
 * `kind` = the shot kind or null). Entries are preallocated and rewritten in place. A repeated `(t, id, player)` —
 * e.g. the `pg` and `contestA` hooks of the same shot — is booked once. `counts[id]` counts bookings per ability.
 * `onPush(entry, descriptor)` (optional) lets the game emit the `ability` event and the `cap.ab.*` caption.
 */
export class AbilityLog {
  constructor(capacity = 256, onPush = null) {
    this.capacity = capacity;
    this.entries = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.entries[i] = { t: 0, id: null, player: null, ctx: null, kind: null };
    this.head = 0;            // next write index
    this.size = 0;
    this.total = 0;
    this.onPush = onPush;
    this.counts = {};
    for (const id of ABILITY_IDS) this.counts[id] = 0;
  }

  /** Book one application; returns the entry, or null when it duplicates the previous booking. */
  push(t, id, player, hook, kind) {
    if (this.size > 0) {
      const last = this.entries[(this.head - 1 + this.capacity) % this.capacity];
      if (last.t === t && last.id === id && last.player === player) return null;
    }
    const e = this.entries[this.head];
    e.t = t; e.id = id; e.player = player; e.ctx = hook || null; e.kind = kind || null;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
    this.total++;
    if (this.counts[id] !== undefined) this.counts[id]++;
    if (this.onPush) this.onPush(e, ABILITIES[id] || null);
    return e;
  }

  /** i-th entry from the oldest (0) to the newest (size − 1). */
  at(i) {
    return this.entries[(this.head - this.size + i + this.capacity * 2) % this.capacity];
  }

  /** Number of bookings of `id` (since the last clear). */
  count(id) {
    return this.counts[id] || 0;
  }

  /** Copy of the ring, oldest first (tests / snapshots; allocates). */
  toArray() {
    const out = [];
    for (let i = 0; i < this.size; i++) {
      const e = this.at(i);
      out.push({ t: e.t, id: e.id, player: e.player, ctx: e.ctx, kind: e.kind });
    }
    return out;
  }

  clear() {
    this.head = 0; this.size = 0; this.total = 0;
    for (const id of ABILITY_IDS) this.counts[id] = 0;
  }
}
