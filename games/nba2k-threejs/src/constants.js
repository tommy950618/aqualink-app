/**
 * @module constants
 * Court geometry, rules and every tuning table of the gameplay (v1 spec §2/§7/§14, v2 spec §5).
 *
 * Units are metres and seconds. Y is up, X is court width, Z is court length. The playable half is
 * z in [-14.325, 0]; the hoop sits at negative Z, the broadcast camera at positive Z.
 *
 * Contents
 * - v1 court constants (`COURT`, `RIM`, `BOARD`, `LINES`, `BALL`, `FIXED_DT`, `isThree`): unchanged, v2 keeps them.
 * - v1 tuning objects still imported by v1 modules during the v2 transition (`SLOTS`, `MOVE`, `JUMP`, `SHOT`, `PERF`,
 *   `COLORS`): marked DEPRECATED. Spec C30 removes `MOVE.SEPARATION`, `JUMP.T`, `SHOT.METER_T*`, `SHOT.LAYUP_D`; they
 *   stay here only until the last v1 importer is replaced (WP9 integration), then the deprecated objects go.
 * - v2 tables (spec §5): `DIFFICULTY` (v2, §5.11), `RIM_PHYS`, `SEPARATION`, `SLOTS_V2`, `SHOT_V2`, `BLOCK`, `STEAL`,
 *   `PASS`, `INTERCEPT`, `STRENGTH`, `POST`, `REBOUND`, `MOVES_V2`, `SHAKE`, `JAB`, `PUMP_FAKE`, `TRIGGERS`, `RULES_V2`.
 *
 * Everything is frozen; nothing here allocates after module evaluation.
 */

export const COURT = Object.freeze({
  HALF_W: 7.62,            // x in [-7.62, 7.62]
  BASELINE_Z: -14.325,     // baseline
  MID_Z: 0,                // half-court line (backcourt boundary)
  OOB_MARGIN: 0.30,        // free-ball tolerance beyond lines (x and baseline only)
  APRON: 2.0,              // painted dark apron around the court, no gameplay effect
  // Court canvas plane: x [-9.62, 9.62], z [-16.325, 1.0] -> 1024x1024 canvas.
  PLANE_W: 19.24,
  PLANE_D: 17.325,
  PLANE_CENTER_Z: -7.6625,
  PLANE_MIN_X: -9.62,
  PLANE_MIN_Z: -16.325,
  CANVAS_SIZE: 1024,
});

export const RIM = Object.freeze({ x: 0, y: 3.048, z: -12.75, r: 0.2286, tube: 0.012, collideTube: 0.02 });

// Backboard AABB; the front face (max.z) faces +z, toward the court.
export const BOARD = Object.freeze({
  min: Object.freeze({ x: -0.915, y: 2.90, z: -13.145 }),
  max: Object.freeze({ x: 0.915, y: 3.97, z: -13.105 }),
});

export const LINES = Object.freeze({
  THREE_R: 7.24,           // arc radius about (RIM.x, RIM.z)
  CORNER_X: 6.71,          // corner straights at |x| = 6.71 ...
  CORNER_Z_END: -10.03,    // ... from the baseline up to z = -10.03 where they meet the arc
  ARC_TOP_Z: -5.51,        // RIM.z + 7.24
  KEY_HALF_W: 2.44,
  FT_Z: -8.535,
  FT_CIRCLE_R: 1.8,
  RESTRICTED_R: 1.22,
  CENTER_R: 1.8,
  LINE_W: 0.05,
});

// Ball physics (v1 §5). REST_RIM / REST_BOARD / CATCH_* are the v1 values; v2 code reads RIM_PHYS for the rim and
// board restitution (R#31) and the per-player `attrs` (ratings.js) for catch radii and heights.
export const BALL = Object.freeze({
  R: 0.12,
  REST_FLOOR: 0.75,
  FRICTION_FLOOR: 0.85,
  REST_RIM: 0.55,          // v1; v2 → RIM_PHYS.REST_RIM
  REST_BOARD: 0.60,        // v1; v2 → RIM_PHYS.REST_BOARD
  G: 9.81,
  DRAG: 0.02,              // v *= (1 - DRAG*dt) per step
  ROLL_DECEL: 2.5,         // rolling: v.xz *= (1 - ROLL_DECEL*dt)
  SETTLE_VY: 0.6,          // |v.y| below this after a floor bounce -> rolling
  REST_SPEED: 0.3,         // |v| below this while rolling -> resting
  MAX_RIM_CONTACTS: 4,     // more than this in one flight -> kicked out of the rim
  BOUNCE_SFX_MS: 80,       // rate limit for the bounce sound
  RESCUE_SPEED: 0.2,       // free ball slower than this counts as resting (rescue rule)
  CATCH_R: 0.55,           // v1 catch radius (v2: attrs.catchR)
  CATCH_R_RECEIVER: 0.80,  // v1 receiver radius (v2: attrs.passReceiveR)
  CATCH_MIN_Y: 0.15,
  CATCH_MAX_Y: 2.3,        // v1 (+ jumpY); v2: attrs.catchTopY
  CATCH_MAX_SPEED: 14,
  CATCH_FLIGHT_AGE: 0.3,   // a shot may be caught only after this age
  HOLD_AFTER_CATCH: 0.35,  // seconds held at the chest before dribbling
  CHEST_Y: 1.3,
  SCORED_T: 0.5,           // rim/board collision off and net drag after a make
  NET_DRAG: 0.35,
  SCORE_R: 0.157,          // RIM.r - 0.6*R: horizontal tolerance of the made-basket test
  NEAR_RIM_R: 1.2,         // sub-stepping radius around the rim
});

export const FIXED_DT = 1 / 60;

// DEPRECATED (v1 spacing slots, five arc spots). v2 uses SLOTS_V2 + per-legend `spots` (legends.js).
const slotList = [
  { id: 'top', x: 0, z: -4.9 },
  { id: 'leftWing', x: -5.4, z: -7.6 },
  { id: 'rightWing', x: 5.4, z: -7.6 },
  { id: 'leftCorner', x: -7.0, z: -13.3 },
  { id: 'rightCorner', x: 7.0, z: -13.3 },
];
for (const s of slotList) { Object.freeze(s); slotList[s.id] = s; }
export const SLOTS = Object.freeze(slotList);

// CHECK formation (kept in v2, §5.12.4: handler (0, -4.6), defenders lerp(attacker, rim, 0.18); v2 teammates stand
// at their top `spots`, the v1 TEAMMATES entry is deprecated). Yaw convention (three.js): forward = (sin(yaw),
// cos(yaw)), so facing -Z (toward the hoop) is yaw = PI and facing +Z (toward the camera) is yaw = 0.
export const FORMATION = Object.freeze({
  HANDLER: Object.freeze({ x: 0, z: -4.6 }),
  TEAMMATES: Object.freeze([SLOTS.leftWing, SLOTS.rightWing]),   // DEPRECATED (v1)
  DEF_LERP: 0.18,          // defender = lerp(attacker, rim, 0.18)
  OFFENSE_YAW: Math.PI,    // facing -Z
  DEFENSE_YAW: 0,          // facing +Z
  TWEEN_T: 0.8,            // smoothstep tween to formation during CHECK
});

// DEPRECATED as a whole for movement speeds (v2: per-player `attrs` from ratings.js). Still valid in v2:
// WALK_MAG, AI_CLAMP_*, STAMINA_REFILL, STAMINA_RELOCK, STAMINA_TIRED, SPRINT_RECENT (spec §5.2).
// Removed by C30 once v1 importers are gone: SEPARATION (v2: SEPARATION + attrs.bodyR).
export const MOVE = Object.freeze({
  RUN: 5.2,
  SPRINT_MUL: 1.35,
  HANDLER_MUL: 0.92,
  ACCEL: 24,
  DECEL: 16,
  RADIUS: 0.40,
  TURN: 12,                // rad/s yaw rate
  WALK_MAG: 0.5,           // joystick magnitude below this walks
  SEPARATION: 0.80,        // DEPRECATED (C30)
  AI_CLAMP_X: 7.4,
  AI_CLAMP_Z_MIN: -14.1,
  AI_CLAMP_Z_MAX: -0.3,
  STAMINA_DRAIN: 1 / 4,    // per second while sprinting (v2: attrs.staminaDrain)
  STAMINA_REFILL: 1 / 6,   // per second while not sprinting
  STAMINA_RELOCK: 0.25,    // sprint re-enabled at this level after hitting 0
  STAMINA_TIRED: 0.30,     // fatigue shooting penalty below this
  SPRINT_RECENT: 0.30,     // "sprinted recently" window for dunks
  STUN_STEAL_FAIL: 0.35,
  CROSS_T: 0.35,
  CROSS_SPEED: 7.5,
  CROSS_COOLDOWN: 0.9,
  CROSS_FREEZE_T: 0.40,
  CROSS_FREEZE_R: 1.0,
  CROSS_FREEZE_P: 0.55,    // human crossover freeze probability
  CROSS_DEF_R: 1.5,        // no defender within this -> joystick side
  STEAL_RANGE: 1.1,
  STEAL_BASE: 0.22,
  STEAL_LOW_BONUS: 0.20,
  STEAL_LOW_Y: 0.45,
  STEAL_SLOW_BONUS: 0.15,
  STEAL_SLOW_SPEED: 0.5,
  STEAL_COOLDOWN: 0.7,
  STEAL_CPU_INTERVAL: 1.5,
  STEAL_CPU_RANGE: 1.0,
  CELEBRATE_T: 0.8,
});

// DEPRECATED (v1 jump; C30 removes T). v2: attrs.hJump / attrs.airtime and ANIM FORMS heights.
export const JUMP = Object.freeze({ T: 0.55, H_SHOT: 0.55, H_BLOCK: 0.75 });

// DEPRECATED (v1 shot model; C30 removes METER_T*, LAYUP_D). v2: SHOT_V2 and src/shot.js.
export const SHOT = Object.freeze({
  METER_T: 0.55,
  METER_T_LAYUP: 0.40,
  F_IDEAL: 0.80,
  F_MAX: 1.25,             // auto-release
  LAYUP_D: 2.2,
  LAYUP_G_BONUS: 0.04,     // layups widen the green window
  LAYUP_MIN_D: 1.0,        // base(d) for layups uses d clamped >= 1.0
  DUNK_MIN: 0.6,           // dunk rating required
  DUNK_LANE_R: 1.2,        // no defender within this of the player->rim segment
  DUNK_T: 0.55,
  DUNK_H: 0.9,
  DUNK_BALL_T: 0.42,
  DUNK_STOP: 0.55,         // player tweens to RIM - fwd*0.55
  AIRBALL_E: -0.32,
  TIMING_MAX_E: 0.30,
  TIMING_GREEN: 1.60,
  TIMING_EDGE: 0.30,
  TIMING_BAD: 0.20,
  CONTEST_FAR: 2.0,
  CONTEST_NEAR: 0.5,
  CONTEST_MIN: 0.45,
  CONTEST_JUMP_MUL: 0.8,
  CONTEST_DOT: 0.3,
  FATIGUE_MUL: 0.90,
  MOVE_SPEED: 2.5,
  MOVE_MUL: 0.85,
  P_MIN: 0.02,
  P_MAX: 0.97,
  BLOCK_WINDOW: 0.35,      // releaseAge below this can be blocked
  BLOCK_R: 0.40,
  BLOCK_HAND_Y: 2.55,
  BLOCK_HAND_FWD: 0.35,
  RELEASE_Y: 2.05,
  RELEASE_FWD: 0.25,
  FOLLOW_THROUGH: 0.25,
  RESULT_FLASH: 0.6,
});

// Game clock and dead-ball timings (v1, kept in v2 §5.13).
export const CLOCK = Object.freeze({
  SHOT: 14,
  QUARTER_OPTIONS: Object.freeze([60, 120, 180, 300]),
  DEFAULT_Q: 120,
  OT: 60,
  QUARTERS: 4,
  CHECK: 1.2,
  DEAD: Object.freeze({ MADE: 1.5, OOB: 1.2, SHOT_CLOCK: 1.2, TURNOVER: 1.0 }),
  QUARTER_END: 2.5,
  HALFTIME: 3.0,
  RESUME_COUNTDOWN: 1.0,
  TICK_BELOW: 5,           // audio tick on each shot-clock second below this
  REST_RESCUE: 1.5,        // resting free ball -> dead after this long
  BUZZER_LOOSE: 0.5,       // period ends this long after a buzzer shot goes loose (R4: total looseT)
  CAPTION: 1.8,
  CAPTION_FADE: 0.3,
});

/**
 * DIFFICULTY v2 (spec §5.11; only the opponent changes). The user's CPU teammates always use the `normal` column for
 * the behaviour rows (`reaction` … `riskTolMul`) and multiplier 1.0 for make / block. v1 `shootOpen`, `crossFreeze`
 * and `stealRate` are removed (C30). `userGreen` is G_DIFF in seconds (§5.3.2).
 */
export const DIFFICULTY = Object.freeze({
  easy: Object.freeze({
    id: 'easy', reaction: 0.36, cpuSigma: 0.075, cpuMakeMul: 0.88, userMakeMul: 1.06, userGreen: 0.040,
    userBlockMul: 1.15, cpuBlockMul: 0.55, contestJumpP: 0.35, jumpSigma: 0.12, cpuStealS0: 0.14, cpuStealInterval: 2.4,
    defGap: 1.60, help: 0.30, sprintProb: 0.35, cpuShakeMul: 0.60, humanShakeMul: 1.15, cpuPassMul: 1.40,
    cpuDriveMul: 0.70, biteBase: 0.55, interceptGamble: 0.50, riskTolMul: 1.60,
  }),
  normal: Object.freeze({
    id: 'normal', reaction: 0.24, cpuSigma: 0.055, cpuMakeMul: 0.96, userMakeMul: 1.00, userGreen: 0.033,
    userBlockMul: 1.00, cpuBlockMul: 0.80, contestJumpP: 0.55, jumpSigma: 0.08, cpuStealS0: 0.21, cpuStealInterval: 1.6,
    defGap: 1.25, help: 0.60, sprintProb: 0.60, cpuShakeMul: 0.85, humanShakeMul: 1.00, cpuPassMul: 1.00,
    cpuDriveMul: 1.00, biteBase: 0.40, interceptGamble: 0.80, riskTolMul: 1.00,
  }),
  hard: Object.freeze({
    id: 'hard', reaction: 0.15, cpuSigma: 0.038, cpuMakeMul: 1.00, userMakeMul: 0.97, userGreen: 0.027,
    userBlockMul: 0.90, cpuBlockMul: 1.00, contestJumpP: 0.75, jumpSigma: 0.05, cpuStealS0: 0.28, cpuStealInterval: 1.1,
    defGap: 1.00, help: 0.90, sprintProb: 0.85, cpuShakeMul: 1.00, humanShakeMul: 0.85, cpuPassMul: 0.80,
    cpuDriveMul: 1.10, biteBase: 0.25, interceptGamble: 1.00, riskTolMul: 0.70,
  }),
});

// DEPRECATED (v1 DPR heuristics; v2: src/render/quality.js tiers §7).
export const PERF = Object.freeze({
  DPR_TOUCH: 1.5,
  DPR_DESKTOP: 2,
  DPR_LOW: 1.0,
  DOWNGRADE_MS: 24,        // rolling average frame time above this -> DPR_LOW (sticky)
  WARMUP_S: 5,
  WINDOW_S: 2,
  MAX_STEPS: 4,            // fixed steps per frame cap
  MAX_FRAME_DT: 0.1,
  DRAW_BUDGET: 110,
  TRI_BUDGET: 40000,
});

// DEPRECATED (v1 palette; v2 team colours live in legends.js TEAM_UI / kits, arena colours in src/render/*).
// Still read by the simplified-mode fallback (humanoid.js) and the v1 court/scene until WP9 removes them.
export const COLORS = Object.freeze({
  background: 0x0b0d14,
  rim: 0xff6a1a,
  skin: Object.freeze([0xc68642, 0x8d5524, 0xe0ac69]),
  shoe: 0x222222,
  offense: 0xff7a1f,
  defense: 0x2f8cff,
  courtWood: 0xc9975a,
  lines: 0xffffff,
  keyPaint: 0x7a2e1e,
  apron: 0x1a1d26,
  board: 0xffffff,
  net: 0xffffff,
  pole: 0x333944,
  stands: 0x2a2e38,
  hemiGround: 0x445566,
  shotClockWarn: 0xff3b3b,
  crowd: Object.freeze([0xd94a3a, 0x3a6fd9, 0xe8c547, 0x3ab07a, 0xf0f0f0, 0x8a5cd9]),
});

/**
 * True when a point (feet) is at or beyond the 3-pt line. (sqrt instead of v1's Math.hypot: same classification —
 * at most one ulp apart exactly on the arc — but Math.hypot allocates in V8 and this runs every step, H10.)
 */
export function isThree(x, z) {
  if (z <= LINES.CORNER_Z_END) return Math.abs(x) >= LINES.CORNER_X;
  const dx = x - RIM.x, dz = z - RIM.z;
  return Math.sqrt(dx * dx + dz * dz) >= LINES.THREE_R;
}

// ---------------------------------------------------------------------------------------------------------------------
// v2 tables
// ---------------------------------------------------------------------------------------------------------------------

/** Rim and board restitution v2 (§5.3.7, R#31): rim 0.55 → 0.40, tangential 0.92 → 0.80, board 0.60 → 0.50. */
export const RIM_PHYS = Object.freeze({ REST_RIM: 0.40, TANGENTIAL: 0.80, REST_BOARD: 0.50 });

/**
 * Separation v2 (§5.2, C3): pair minimum = bodyR_a + bodyR_b (attrs.bodyR = 0.18 + 0.5·shoulderJoints),
 * + AIR_ADD when either player is airborne, at least DUNKER_MIN against a dunker in the hang phase. A hanging dunker
 * or a player in a root-motion signature clip is immovable (the other player takes the whole push).
 */
export const SEPARATION = Object.freeze({ AIR_ADD: 0.10, DUNKER_MIN: 0.95 });

/** Named off-ball spots (§2.5, world metres). Indexable by id; `SLOTS_V2.list` keeps the table order. */
const slotV2List = [
  { id: 'top', x: 0, z: -4.9 },
  { id: 'leftElbow', x: -2.44, z: -8.6 },
  { id: 'rightElbow', x: 2.44, z: -8.6 },
  { id: 'leftWing', x: -5.4, z: -7.6 },
  { id: 'rightWing', x: 5.4, z: -7.6 },
  { id: 'leftBlock', x: -2.0, z: -11.6 },
  { id: 'rightBlock', x: 2.0, z: -11.6 },
  { id: 'leftCorner', x: -7.0, z: -13.3 },
  { id: 'rightCorner', x: 7.0, z: -13.3 },
  { id: 'leftDunker', x: -3.0, z: -13.6 },
  { id: 'rightDunker', x: 3.0, z: -13.6 },
  { id: 'rightBaseline', x: 5.0, z: -12.8 },
];
const slotV2 = { list: Object.freeze(slotV2List.map((s) => Object.freeze(s))) };
for (const s of slotV2.list) slotV2[s.id] = s;
export const SLOTS_V2 = Object.freeze(slotV2);

/** Shot kinds (§5.3.1). Jump-shot families score 3 from beyond the arc (C1); layup/dunk/tip always score 2. */
export const SHOT_KINDS = Object.freeze(['jumper', 'fade', 'stepback', 'turnFade', 'hook', 'floater', 'layup', 'dunk', 'tip']);

/**
 * Shooting model v2 constants (§5.3). Pg coefficients are `[base, k]` of `base + k·n(rating)`; distance factors are
 * applied in shot.js. TYPE_MUL / CONTEST_A are the generic (legend-agnostic) shot-type multipliers on `Pg` and on the
 * contest product `A`; signature abilities override them through abilities.js (`pg` / `contestA` hooks).
 */
export const SHOT_V2 = Object.freeze({
  CLOSE_D: 3.5,                 // rating zone close if d ≤ 3.5 else mid (jumpers)
  G_DIFF: Object.freeze({ easy: 0.040, normal: 0.033, hard: 0.027 }),   // = DIFFICULTY[*].userGreen
  G_RATING_BASE: 0.80, G_RATING_K: 0.40,                               // gS = G_DIFF × (0.80 + 0.40·n(zoneRating))
  LAYUP_G_ADD: 0.022,           // layups: gS + 22 ms
  METER_IDEAL: 0.80,            // green centre at 80 % of the bar (METER_T = tIdeal / 0.80)
  METER_MAX: 1.25,              // auto-release at 1.25·METER_T
  T_GREEN: 1.00, T_EDGE_HI: 0.80, T_EDGE_LO: 0.22, T_EDGE: 0.165, T_BAD: 0.12,
  AIRBALL_ET: -0.175,           // eT ≤ −0.175 s → forced air ball
  CPU_ET_MIN: -0.25, CPU_ET_MAX: 0.22,                                 // eT_cpu ~ N(0, cpuSigma) clamped
  CPU_TBAR: Object.freeze({ easy: 0.73, normal: 0.81, hard: 0.89 }),   // expected CPU T (AI estimates)
  HUMAN_SIGMA_AVG: 0.050, HUMAN_SIGMA_GOOD: 0.030,
  TIP_T: 0.85,                  // tips: fixed timing factor
  PG: Object.freeze({
    dunk: Object.freeze([0.93, 0.06]),
    layup: Object.freeze([0.78, 0.18]),
    close: Object.freeze([0.66, 0.28]), CLOSE_D0: 1.5, CLOSE_K: 0.03,    // × (1 − 0.03·max(0, d − 1.5))
    mid: Object.freeze([0.52, 0.36]), MID_D0: 3.5, MID_K: 0.025,         // × (1 − 0.025·(d − 3.5))
    three: Object.freeze([0.40, 0.42]), THREE_D0: 7.8, THREE_K: 0.12, THREE_MIN: 0.20,   // d > 7.8: max(0.20, 1 − 0.12·(d − 7.8))
  }),
  TYPE_MUL: Object.freeze({
    fade: 0.94, stepback: 0.95, turnFade: 0.95, floater: 0.92, hook: 0.90, tip: 0.85,
    layup: Object.freeze({ reverse: 0.97, euro: 0.98, power: 1.00, fingerRoll: 1.00, upUnder: 0.95 }),
  }),
  CONTEST_A: Object.freeze({
    fade: 0.85, stepback: 0.80, turnFade: 0.80, hook: 0.85, floater: 0.75,
    layup: Object.freeze({ reverse: 0.80 }),
  }),
  CMAX: Object.freeze({ three: 0.55, mid: 0.55, close: 0.60, layup: 0.50, dunk: 0.12 }),
  RC: 2.2, RC_INNER: 0.6,       // Kd = clamp((Rc − dd)/(Rc − 0.6), 0, 1)
  FRONT_DOT: 0.20, FRONT_NEAR: 0.90,
  HANDS_UP_DY: -0.05,           // handY = reachM − 0.05 when grounded (auto hands-up, C22)
  KH_BASE: 0.65, KH_DIV: 1.2, KH_MIN: 0.40, KH_MAX: 1.00,
  KS_BASE: 0.70, KS_K: 0.40,
  SECOND_W: 0.35,               // Xraw = max + 0.35·second
  A_FLOOR: 0.35,                // X uses max(0.35, A)
  GREEN_X: 0.65,                // green release: X × 0.65
  DUNK_REL_Y: 3.23, LAYUP_REL_ADD: 0.15, FLOATER_REL_ADD: 0.10,
  CONTACT_R: 0.80, CONTACT_BASE: 0.88, CONTACT_K: 0.004, CONTACT_MIN: 0.75, CONTACT_MAX: 1.00,
  FATIGUE_STAMINA: 0.30, FATIGUE_MUL: 0.92,
  MOVE_V: 2.5, MOVE_K: 0.07, MOVE_MIN: 0.80,
  CLUTCH_K: 1.05, CLUTCH_QUARTER: 4, CLUTCH_CLOCK: 24, CLUTCH_DIFF: 3,
  P_MIN: 0.02, P_MAX: 0.97, P_MAX_DUNK: 0.995,
  // Miss targets (§5.3.7; v1 §4.4 offsets kept): signed distance along the shooter→rim direction from the rim centre.
  MAKE_DISC: 0.05, MAKE_DISC_LAYUP: 0.04,
  SHORT_MIN: 0.3, SHORT_SPAN: 0.8, LONG_MIN: 0.3, LONG_SPAN: 0.6, LAYUP_MISS: 0.6,
  SIDE_BASE: 0.05, SIDE_CONTEST: 0.25,
  AIRBALL_ALONG_MIN: 0.50, AIRBALL_ALONG_SPAN: 0.30, AIRBALL_DY: -0.55,
});

/** Block model (§5.4, D-GP-4, C2). Windows are releaseAge limits; radii are palm_s → ball centre. */
export const BLOCK = Object.freeze({
  WINDOW: Object.freeze({ jumper: 0.22, fade: 0.22, stepback: 0.22, turnFade: 0.22, hook: 0.26, floater: 0.26, close: 0.26, tip: 0, layup: 0.30, dunk: 0 }),
  R_HAND: 0.30, R_HAND_CHASE: 0.36, R_HAND_BIG: 0.34,   // generic / LeBron chase-down / Yao anchor & Giannis help
  BEHIND_DOT: -0.20,
  B0: Object.freeze({ jumper: 0.30, fade: 0.30, stepback: 0.30, turnFade: 0.30, hook: 0.35, floater: 0.35, close: 0.35, layup: 0.40 }),
  CAP: Object.freeze({ jumper: 0.30, fade: 0.30, stepback: 0.30, turnFade: 0.30, hook: 0.40, floater: 0.40, close: 0.40, layup: 0.45, dunk: 0.30 }),
  BLKF_BASE: 0.35, BLKF_K: 0.85,                       // blkF = 0.35 + 0.85·n(block)
  HADV_K: 0.625, HADV_MIN: 0.60, HADV_MAX: 1.35,       // hAdv = clamp(1 + 0.625·(H_def − H_sh), 0.60, 1.35)
  CHASE_B0: 0.50, CHASE_CAP: 0.55, CHASE_WINDOW: 0.40, CHASE_R: 4.0, CHASE_DOT: -0.20,
  DUNK_B0: 0.22, DUNK_CAP: 0.30, DUNK_SLAM_MARGIN: 0.05, DUNK_FRONT_DOT: 0.20,
  PIN_BOARD_R: 1.2,
  // Success velocities: (−0.30·vx + U(−0.8, 0.8)·side, 2.0 + 1.5·U, −0.30·vz); pin (0.2·side·U, 1.0, −3.5);
  // dunk stuff (−0.2·fwd, 2.5); dunk rim-out (0.6·fwd, 3.0).
  BACK_K: 0.30, SIDE_V: 0.8, UP_V: 2.0, UP_V_RAND: 1.5,
  PIN_V: Object.freeze({ side: 0.2, up: 1.0, z: -3.5 }),
  STUFF_FWD: -0.2, STUFF_UP: 2.5, RIMOUT_FWD: 0.6, RIMOUT_UP: 3.0,
  HEADLESS_HAND_FWD: 0.30, HEADLESS_HAND_DY: -0.24,   // proxy palm = root + facing·0.30 + (0, reachM − 0.24 + jumpY, 0)
});

/** On-ball poke (§5.5). */
export const STEAL = Object.freeze({
  S0_HUMAN: 0.30,              // CPU: DIFFICULTY[*].cpuStealS0
  STEALF_BASE: 0.45, STEALF_K: 0.75,
  HANDLEF_BASE: 1.35, HANDLEF_K: 0.75,
  SIDE_NEAR: 1.15, SIDE_FAR: 0.55, EXPOSED: 1.25, EXPOSED_Y: 0.45, PROTECT: 0.60, BEHIND: 0.80, BEHIND_DOT: -0.2,
  P_MIN: 0.03, P_MAX: 0.45,
  STUN: 0.30, STUN_REPEAT: 0.55, REPEAT_WINDOW: 3.0,
  COOLDOWN_HUMAN: 0.8, LIVE_GRACE: 0.8, CATCH_GRACE: 0.5,
  LOOSE_SPEED: 2.0, LOOSE_UP: 1.5, VICTIM_EXCLUSION: 0.3,
});

/** Passes (§5.5, C6). Release offsets are added to attrs.passRelease. */
export const PASS = Object.freeze({
  RANGE: 9.5, MIN_FLIGHT: 0.25, LOB_HOLD: 0.30, LOB_APEX: 1.8,
  BEYOND_SPEED: 10, BEYOND_SIGMA: 1.6,
  PRESSURE_R: 1.0, PRESSURE_K: 0.6, DIST_BASE: 0.6, DIST_K: 0.05, JUMP_SIGMA: 1.5,
  BOUNCE_ADD: 0.02, LOB_ADD: 0.06, OVERHEAD_ADD: 0.08, PUSH1: 0.08, PUSH1_MAX: 0.20, PICKUP_MAX: 0.12, TURN_MAX: 0.12,
  YAO_OVERHEAD: 0.25, YAO_OVERHEAD_CHINNED: 0.20,
  CATCH_MIN_Y: 0.15,
});

/** Interceptions (§5.5, R#34). */
export const INTERCEPT = Object.freeze({
  R_ADD: 0.05,                 // intR = catchR + 0.05 (Jordan hawk +0.20)
  LUNGE_ADD: 0.20, LUNGE_T: 0.40, LUNGE_DIST: 1.0, LUNGE_DUR: 0.25, LANE_R: 2.5,
  MIN_Y: 0.30,
  P_BASE: 0.35, P_K: 0.45, P_DIST_K: 0.15, P_MIN: 0.15, P_MAX: 0.85,
  DEFLECT_P: 0.5, DEFLECT_V: 0.35, DEFLECT_LATERAL: 1.5,
});

/** Drive bump (§5.6). */
export const STRENGTH = Object.freeze({
  BUMP_SPEED: 3.0, BUMP_CONE_DEG: 45, BUMP_INTERVAL: 0.6,
  KEEP_BASE: 0.55, KEEP_K: 0.006, KEEP_MASS: 0.25, KEEP_MIN: 0.25, KEEP_MAX: 0.95,
  PUSH_BASE: 0.10, PUSH_K: 0.008, PUSH_MIN: 0, PUSH_MAX: 0.45, PUSH_T: 0.15,
  STUN_DIFF: 20, STUN_SPEED: 4.0, STUN_T: 0.30,
});

/** Post-up (§5.6). */
export const POST = Object.freeze({
  ENTRY_D: 5.0, DEF_R: 1.2, DEF_DOT: 0.5, STICK_DOT: 0.5, STICK_MIN: 0.15, STICK_MAX: 0.75, HOLD: 0.35,
  SHOVE_T: 0.30, GAIN_BASE: 0.12, GAIN_K: 0.006, GAIN_MASS: 0.15, GAIN_MIN: 0.02, GAIN_MAX: 0.35,
  EXIT_STICK: 0.6, EXIT_T: 0.20, FACE_UP_T: 0.35, IDLE_T: 3.5,
});

/** Rebounds (§5.6). */
export const REBOUND = Object.freeze({
  BOX_R: 2.0, BOX_T: 0.4, BOX_BASE: 0.3, BOX_K: 0.004,
  RAND_MAX: 0.20, RATING_W: 0.6, HEIGHT_W: 0.15, HEIGHT_REF: 2.0, HEIGHT_DIV: 0.3,
  TIP_RIM_R: 1.2, PUTBACK_REACH: 3.15, PUTBACK_RIM_R: 1.0,
});

/**
 * Dribble moves (§5.7): steal-immunity window [t0, t1] (s after the move start; null = none), shake `moveMul`,
 * ankle eligibility and cooldown. `ankleKyrieOnly` marks moves that are ankle-eligible only for Kyrie (the cross part
 * of Kobe's `hesiCrossStepback` uses the `sig.kyrie.hesiCross` row without ankle eligibility).
 */
export const MOVES_V2 = Object.freeze({
  'move.cross': Object.freeze({ imm: Object.freeze([0.05, 0.30]), moveMul: 1.0, ankle: true, ankleKyrieOnly: false, cooldown: 0.9 }),
  'sig.kyrie.hesiCross': Object.freeze({ imm: Object.freeze([0.05, 0.40]), moveMul: 1.2, ankle: true, ankleKyrieOnly: true, cooldown: 0.9 }),
  'move.btl': Object.freeze({ imm: Object.freeze([0.05, 0.28]), moveMul: 0.8, ankle: false, ankleKyrieOnly: false, cooldown: 0.7 }),
  'move.btb': Object.freeze({ imm: Object.freeze([0.06, 0.30]), moveMul: 0.9, ankle: false, ankleKyrieOnly: false, cooldown: 0.8 }),
  'move.spin': Object.freeze({ imm: Object.freeze([0.08, 0.40]), moveMul: 1.0, ankle: false, ankleKyrieOnly: false, cooldown: 1.0 }),
  'move.hesi': Object.freeze({ imm: null, moveMul: 0.9, ankle: false, ankleKyrieOnly: false, cooldown: 0.8 }),
  'move.stepback': Object.freeze({ imm: Object.freeze([0.08, 0.36]), moveMul: 0.7, ankle: false, ankleKyrieOnly: false, cooldown: 0.9, space: 0.75 }),
  'sig.kyrie.doubleBtlStepback': Object.freeze({ imm: Object.freeze([0.05, 0.60]), moveMul: 1.1, ankle: true, ankleKyrieOnly: false, cooldown: 1.0 }),
});

/** Shakes, ankle-breakers and combos (§5.7, C4). */
export const SHAKE = Object.freeze({
  RESOLVE_R: 1.3, RESOLVE_DOT: 0.3,
  HANDLE_DIV: 50, HANDLE_MIN: 0.4, HANDLE_MAX: 1.6,
  COMMIT: 1.5, COMMIT_SPEED: 2.0, COMMIT_WINDOW: 0.4,
  P_BASE: 0.22, P_MIN: 0.04, P_MAX: 0.60,
  AB0: 0.03, AB0_KYRIE: 0.06, ANKLE_MAX: 0.35,
  COMBO_2: 1.5, COMBO_2_KYRIE: 2.0, COMBO_3: 3.0,
  COMBO_WINDOW: 0.35, CHAIN: 2, CHAIN_KYRIE: 3, CHAIN_YAO: 0,
  FALLEN_T: 1.60, FALL_T: 0.50, GROUND_T: 0.80, GETUP_T: 0.30,
  ANKLE_IMMUNITY_ADD: 0.10, ANKLE_SHAKE_T: 0.15, ANKLE_SHAKE_AMP: 0.04, ANKLE_CROWD: 0.9,
  STUN_T: 0.40, SLIDE: 0.30,
});

/** Jab (§5.7). pBite = biteBase × (1.15 − 0.50·n(perimeterD)) (Kobe jab × 1.3). */
export const JAB = Object.freeze({
  BITE_R: 1.6, BITE_BASE_K: 1.15, BITE_PERD_K: 0.50,
  SAG_P: 0.55, SAG_DIST: 0.5, SAG_A: 0.5, SAG_WINDOW: 0.8, LUNGE_STUN: 0.35, MAX_PER_HOLD: 2, PULLUP_WINDOW: 0.8,
});

/** Pump fake and up-and-under (§5.7). */
export const PUMP_FAKE = Object.freeze({ TAP_MAX: 0.12, BITE_R: 1.6, UP_UNDER_WINDOW: 0.6, UP_UNDER_D: 3.0, CLIP_T: 0.40 });

/**
 * Ability trigger windows (§5.8 with C10 / C11; all distances = horizontal feet → rim centre at the press).
 * Boundaries are inclusive at the lower end (unit: FT-line press 5.99 → no, 6.00 → yes; euro 5.39 → no, 5.40 → yes).
 */
export const TRIGGERS = Object.freeze({
  FT_DUNK: Object.freeze({ D_MIN: 6.0, D_MAX: 7.6, SPEED: 6.0, HEADING_DEG: 25, LANE_R: 2.5, CONE_DEG: 60, STAMINA: 0.30, MAX_PER_GAME: 2, AI_P: 0.25, MAKE: 0.97, H: 1.00, G_SCALE: 0.70, AIRTIME: 1.08 }),
  EURO: Object.freeze({ D_MIN: 5.4, D_MAX: 7.6, SPEED: 3.5, HEADING_DEG: 45, LAT: 0.35, AI_P: 0.35, DODGE_BASE: 0.70, DODGE_K1: 1.15, DODGE_K2: 0.35, DODGE_STUN: 0.35, LANE_R: 1.5 }),
  EURO_GENERIC: Object.freeze({ D_MIN: 3.0, D_MAX: 5.2, SPEED: 3.0, HEADING_DEG: 45, DODGE_MUL: 0.6 }),
  LONG_GATHER: Object.freeze({ D_MIN: 6.4, D_MAX: 7.8, SPEED: 5.0, PATH_R: 1.5 }),
  LAYUP: Object.freeze({ STD1_MAX: 2.5, STD2_MAX: 4.0, STD2_MAX_JORDAN: 4.6, STD2_SPEED: 2.0, HEADING_DEG: 45 }),
  DUNK: Object.freeze({ D_MIN: 0.6, D_MAX: 4.0 }),
  STEPBACK_STICK: 0.5,
  YAO_HOOK_D: 4.5,
  CHASE: Object.freeze({ R: 4.0, DOT: -0.20, RUN_MUL: 1.08, RUN_T: 2.0, STAMINA: 0.2, AI_HAND_BALL: 0.50 }),
  JORDAN_SWITCH: Object.freeze({ HAND_R: 0.70, P: 0.75 }),
  HELP_RADIUS: 3.2, HELP_RADIUS_GIANNIS: 4.0,
  YAO_ANCHOR: Object.freeze({ RIM_R: 2.5, SHOOTER_R: 3.0, RC: 3.0, DETER: 0.15, BLOCK_RIM_R: 2.0, AI_HAND_BALL: 0.40 }),
  GIANNIS_HELP_RC: 2.6, BIG_H: 2.05,
});

/** Rule and bookkeeping constants v2 (§5.13, C27). */
export const RULES_V2 = Object.freeze({
  ASSIST_WINDOW: 3.0,          // AST: receiver's FG press ≤ 3.0 s after his catch, no possession change, tips excluded
  CLEAR_SHOT_CLOCK: 14,        // R9 live flip
  NON_URGENT_SHOT_CLOCK: 2,    // catchToPress counts only presses with shot clock > 2 s
  DRIVE_MIN_T: 0.5,            // metrics: a drive is a handler `drive` action lasting ≥ 0.5 s
});
