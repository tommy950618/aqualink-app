// Court geometry, rules and tuning constants (spec section 2, 7, 14).
// Units are metres and seconds. Y is up, X is court width, Z is court length.
// The playable half is z in [-14.325, 0]; the hoop sits at negative Z, the camera at positive Z.

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

export const BALL = Object.freeze({
  R: 0.12,
  REST_FLOOR: 0.75,
  FRICTION_FLOOR: 0.85,
  REST_RIM: 0.55,
  REST_BOARD: 0.60,
  G: 9.81,
  DRAG: 0.02,              // v *= (1 - DRAG*dt) per step
  ROLL_DECEL: 2.5,         // rolling: v.xz *= (1 - ROLL_DECEL*dt)
  SETTLE_VY: 0.6,          // |v.y| below this after a floor bounce -> rolling
  REST_SPEED: 0.3,         // |v| below this while rolling -> resting
  MAX_RIM_CONTACTS: 4,     // more than this in one flight -> kicked out of the rim
  BOUNCE_SFX_MS: 80,       // rate limit for the bounce sound
  RESCUE_SPEED: 0.2,       // free ball slower than this counts as resting (rescue rule)
  CATCH_R: 0.55,           // catch radius (scaled by height rating)
  CATCH_R_RECEIVER: 0.80,  // catch radius for the intended pass receiver
  CATCH_MIN_Y: 0.15,
  CATCH_MAX_Y: 2.3,        // + jumpY
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

// Spacing slots (3-pt spots). Indexable both as an array and by id.
const slotList = [
  { id: 'top', x: 0, z: -4.9 },
  { id: 'leftWing', x: -5.4, z: -7.6 },
  { id: 'rightWing', x: 5.4, z: -7.6 },
  { id: 'leftCorner', x: -7.0, z: -13.3 },
  { id: 'rightCorner', x: 7.0, z: -13.3 },
];
for (const s of slotList) { Object.freeze(s); slotList[s.id] = s; }
export const SLOTS = Object.freeze(slotList);

// CHECK formation. Yaw convention (three.js): forward = (sin(yaw), cos(yaw)), so
// facing -Z (toward the hoop) is yaw = PI and facing +Z (toward the camera) is yaw = 0.
export const FORMATION = Object.freeze({
  HANDLER: Object.freeze({ x: 0, z: -4.6 }),
  TEAMMATES: Object.freeze([SLOTS.leftWing, SLOTS.rightWing]),
  DEF_LERP: 0.18,          // defender = lerp(attacker, rim, 0.18)
  OFFENSE_YAW: Math.PI,    // facing -Z
  DEFENSE_YAW: 0,          // facing +Z
  TWEEN_T: 0.8,            // smoothstep tween to formation during CHECK
});

export const MOVE = Object.freeze({
  RUN: 5.2,
  SPRINT_MUL: 1.35,
  HANDLER_MUL: 0.92,
  ACCEL: 24,
  DECEL: 16,
  RADIUS: 0.40,
  TURN: 12,                // rad/s yaw rate
  WALK_MAG: 0.5,           // joystick magnitude below this walks
  SEPARATION: 0.80,        // pairwise push-apart distance
  AI_CLAMP_X: 7.4,
  AI_CLAMP_Z_MIN: -14.1,
  AI_CLAMP_Z_MAX: -0.3,
  STAMINA_DRAIN: 1 / 4,    // per second while sprinting
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

export const JUMP = Object.freeze({ T: 0.55, H_SHOT: 0.55, H_BLOCK: 0.75 });

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
  BUZZER_LOOSE: 0.5,       // period ends this long after a buzzer shot goes loose
  CAPTION: 1.8,
  CAPTION_FADE: 0.3,
});

// Spec section 7 table. userGreen is the human green half-width (section 4.2).
export const DIFFICULTY = Object.freeze({
  easy: Object.freeze({ id: 'easy', reaction: 0.40, cpuSigma: 0.14, userGreen: 0.07, stealRate: 0.10, defGap: 1.7, help: 0.3, shootOpen: 1.9, sprintProb: 0.3, crossFreeze: 0.35 }),
  normal: Object.freeze({ id: 'normal', reaction: 0.26, cpuSigma: 0.10, userGreen: 0.06, stealRate: 0.18, defGap: 1.3, help: 0.6, shootOpen: 1.5, sprintProb: 0.6, crossFreeze: 0.55 }),
  hard: Object.freeze({ id: 'hard', reaction: 0.14, cpuSigma: 0.06, userGreen: 0.05, stealRate: 0.28, defGap: 1.0, help: 0.9, shootOpen: 1.2, sprintProb: 0.9, crossFreeze: 0.70 }),
});

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

// Team-independent palette. Team jersey/shorts colours live in teams.js.
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

// True when a point (feet) is at or beyond the 3-pt line.
export function isThree(x, z) {
  if (z <= LINES.CORNER_Z_END) return Math.abs(x) >= LINES.CORNER_X;
  return Math.hypot(x - RIM.x, z - RIM.z) >= LINES.THREE_R;
}
