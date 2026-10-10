/**
 * @module cam/replay
 * Instant replay (SPEC-v2 §6.4.6, PR §4.6, D-PR-7): recorded final poses, not re-simulation.
 *
 * Recorder — a ring of 240 frames (≤ 1 sample per 1/60 s of game time), each frame 1 + 6 × 233 + 8 = 1,407 floats in
 * one `Float32Array(240 × 1407)` (1.35 MB) allocated once per page:
 *   [0] game time · per player i (offset 1 + 233·i, written by `animator.capture(f32, offset)`, layout CAP):
 *   root x, y, z, yaw (4) · 53 local bone quaternions (212) · pelvis local position (3) · 9 expression weights ·
 *   eye offset (2) · visible flag · 2 spare · ball (offset 1399): position (3), quaternion (4), visible (1).
 * plus an exact Float64 copy of each frame's time (bracketing never suffers float32 rounding late in a session) and an
 * event ring of 32 {time, code, playerIndex} (EVT: takeoff, release, slam, score, block, steal, buzzer; plus rim / swish
 * ball contacts so the slow audio variants can re-fire at their replay times).
 *
 * Triggers (setting Replays: off / dunks (default) / all): made dunk; a make that wins or ties in the last 3.0 s of Q4/OT or
 * any make at a period buzzer; (all only) chase-down / help block and ankle-breaker. Cooldown 45 s of game clock
 * (game-winners exempt), max 6 per game. Windows (game time, played at 0.5× → 3.0 s): dunk [slam − 1.15, slam + 0.35],
 * jumper [release − 0.30, release + 1.20], block / ankle [event − 1.0, event + 0.5].
 *
 * Player timeline after the trigger (t = 0 = the score/block event): 0–0.9 s live on broadcast → cue 'wipeIn' (gold bar,
 * 0.25 s) → 1.15 s cue 'on' (playback + letterbox; animators `external = true`, recording suspended) → 4.15 s cue 'off'
 * (wipe-out 0.25 s) → 4.40 s cue 'done' (flow cuts the camera back to broadcast). skip(): 0.15 s wipe-out
 * (cue 'off' with fast = true). Playback: t += 0.5·frameDt, bracketing samples, `animator.applyBlend(f32, offA, offB,
 * α)` per player (the animator slerps / lerps), ball lerp + slerp (scratch), replayed ball state for the net sim.
 * Cameras (subject = recorded pelvis of the focus player, critically damped 0.15 s): dunk orbit r 3.6 m, height
 * 1.2 → 2.2 m, starting 60° to the camera side of the approach, sweeping −50° over 3.0 s, fov 32, look 0.495·h above
 * the floor under the subject (raised by the recorded jump) blended 40 % to the rim after takeoff, 0.25 s 0.03 m 12 Hz shake at the slam; jumper: first 55 %
 * 2.8 m behind / 1.9 m above the shooter over his shoulder at the rim (fov 35), then a rim cam at
 * (rim.x ± 2.4, 3.8, rim.z + 3.0) on the side away from the shooter, fov 35 → 28; block / ankle: side-on, 5 m from
 * the shot line at 1.6 m, fov 30, tracking the ball. Constraints: z ≥ −12.0, y ≥ 0.8, ≥ 0.9 m from every recorded
 * pelvis. LOD rule per tier (§7.4 'replay LOD') exposed as `player.lod` (Int8Array(6), −1 = no override).
 *
 * Exports: REPLAY, CAP, EVT, EVT_BY_NAME, replayWindow(kind, anchor, out), slerp4(...), replayLod(...),
 * class ReplayRecorder, class ReplayTriggers, class ReplayPlayer.
 * Zero allocation per frame / per capture after construction (H10); no three.js import (works headless in Node).
 */
import { RIM } from '../constants.js';

const DEG = Math.PI / 180;

/** Replay constants (§6.4.6). Seconds of game time for windows, screen seconds for the timeline. */
export const REPLAY = Object.freeze({
  FRAMES: 240, PLAYERS: 6, PLAYER_FLOATS: 233, BALL_FLOATS: 8,
  FRAME_FLOATS: 1 + 6 * 233 + 8,          // 1,407
  MIN_DT: 1 / 60, RATE: 0.5, EVENTS: 32,
  LIVE: 0.9, START: 1.15, WIPE_OUT: 0.25, SKIP_OUT: 0.15,
  COOLDOWN: 45, MAX_PER_GAME: 6, CLUTCH_S: 3.0, OT_S: 60, HOLD_DEAD: 2.9,
  WINDOWS: Object.freeze({
    dunk: Object.freeze([-1.15, 0.35]), jumper: Object.freeze([-0.30, 1.20]),
    block: Object.freeze([-1.0, 0.5]), ankle: Object.freeze([-1.0, 0.5]),
  }),
  SMOOTH: 0.15,
  DUNK: Object.freeze({ r: 3.6, y0: 1.2, y1: 2.2, startDeg: 60, sweepDeg: 50, fov: 32, lookH: 0.9 * 0.55, rimBlend: 0.40, blendS: 0.3, shakeS: 0.25, shakeM: 0.03, shakeHz: 12 }),
  JUMPER: Object.freeze({ split: 0.55, back: 2.8, up: 1.9, shoulder: 0.45, fov: 35, rimX: 2.4, rimY: 3.8, rimDz: 3.0, fovTo: 28 }),
  BLOCK: Object.freeze({ dist: 5.0, y: 1.6, fov: 30, chestUp: 0.35 }),
  MIN_Z: -12.0, MIN_Y: 0.8, MIN_PELVIS: 0.9,
  LOD_NEAR_M: 7,
});

/** Float offsets inside one player's 233-float block (the layout `animator.capture` writes). */
export const CAP = Object.freeze({ ROOT: 0, YAW: 3, QUAT: 4, PELVIS: 216, EXPR: 219, EYE: 228, VISIBLE: 230, SPARE: 231 });

/** Event codes of the event ring. */
export const EVT = Object.freeze({ takeoff: 1, release: 2, slam: 3, score: 4, block: 5, steal: 6, buzzer: 7, rim: 8, swish: 9 });
/** Name lookup for EVT codes (index = code). */
export const EVT_BY_NAME = Object.freeze(['', 'takeoff', 'release', 'slam', 'score', 'block', 'steal', 'buzzer', 'rim', 'swish']);

const BALL_OFF = 1 + 6 * 233;            // 1399

/**
 * Replay window for a trigger kind around its anchor event time (game seconds). Writes {t0, t1, anchor} into out.
 * @param {'dunk'|'jumper'|'block'|'ankle'} kind
 */
export function replayWindow(kind, anchor, out) {
  const w = REPLAY.WINDOWS[kind] || REPLAY.WINDOWS.jumper;
  out.t0 = anchor + w[0];
  out.t1 = anchor + w[1];
  out.anchor = anchor;
  return out;
}

/**
 * Quaternion slerp on [x, y, z, w] arrays (shortest arc; nlerp when nearly parallel). out may alias neither input.
 * Reads a[ao..ao+3], b[bo..bo+3]; writes out[oo..oo+3].
 */
export function slerp4(a, ao, b, bo, t, out, oo) {
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }   // hemisphere check: shortest arc
  let k0, k1;
  if (cos > 0.9995) { k0 = 1 - t; k1 = t; } else {
    const th = Math.acos(cos), s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s;
  }
  let x = ax * k0 + bx * k1, y = ay * k0 + by * k1, z = az * k0 + bz * k1, w = aw * k0 + bw * k1;
  const n = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  x /= n; y /= n; z /= n; w /= n;
  out[oo] = x; out[oo + 1] = y; out[oo + 2] = z; out[oo + 3] = w;
  return out;
}

/**
 * Replay LOD rule (§7.4): high — LOD0 within 7 m of the camera, others 1; medium — LOD0 for the 2 nearest, LOD1 for the
 * rest; low — LOD1 for the 2 nearest, others unchanged (−1). `pos` = Float32Array(6·3) world positions, `vis` flags.
 * Writes Int8Array(6) `out` (−1 = no override).
 */
export function replayLod(tier, cx, cy, cz, pos, vis, out) {
  let n1 = -1, n2 = -1, d1 = Infinity, d2 = Infinity;
  for (let i = 0; i < out.length; i++) {
    out[i] = -1;
    if (vis && !vis[i]) continue;
    const dx = pos[i * 3] - cx, dy = pos[i * 3 + 1] - cy, dz = pos[i * 3 + 2] - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (tier === 'high') { out[i] = d <= REPLAY.LOD_NEAR_M ? 0 : 1; continue; }
    if (d < d1) { d2 = d1; n2 = n1; d1 = d; n1 = i; } else if (d < d2) { d2 = d; n2 = i; }
  }
  if (tier === 'high') return out;
  if (tier === 'medium') {
    for (let i = 0; i < out.length; i++) if (!vis || vis[i]) out[i] = 1;
    if (n1 >= 0) out[n1] = 0;
    if (n2 >= 0) out[n2] = 0;
  } else {
    if (n1 >= 0) out[n1] = 1;
    if (n2 >= 0) out[n2] = 1;
  }
  return out;
}

// ======================================================================================================== recorder

/** Ring-buffer recorder of final poses (§6.4.6). */
export class ReplayRecorder {
  /** @param {{frames?:number, players?:number}} [opts] */
  constructor(opts = {}) {
    this.frames = opts.frames > 0 ? opts.frames | 0 : REPLAY.FRAMES;
    this.players = REPLAY.PLAYERS;
    this.stride = REPLAY.FRAME_FLOATS;
    this.buf = new Float32Array(this.frames * this.stride);       // 1.35 MB, once per page
    this.times = new Float64Array(this.frames);
    this.ev = new Float64Array(REPLAY.EVENTS * 3);                 // {t, code, playerIndex}
    this.head = 0;            // next slot to write
    this.count = 0;           // frames held
    this.evHead = 0;
    this.evCount = 0;
    this.lastT = -Infinity;
    this.suspended = false;   // set by ReplayPlayer during playback
    this.holdUntil = Infinity;  // deferred (game-winner) replays: stop once a frame at ≥ this time is held
  }

  /** Forget everything (rematch, quit). */
  reset() {
    this.head = 0; this.count = 0; this.evHead = 0; this.evCount = 0; this.lastT = -Infinity;
    this.suspended = false; this.holdUntil = Infinity;
  }

  /** Physical slot of logical frame k (0 = oldest). */
  slot(k) { return (this.head - this.count + k + this.frames * 2) % this.frames; }
  /** Float offset of logical frame k. */
  offset(k) { return this.slot(k) * this.stride; }
  /** Exact game time of logical frame k. */
  time(k) { return this.times[this.slot(k)]; }
  /** Oldest / newest recorded time (NaN when empty). */
  get oldest() { return this.count ? this.time(0) : NaN; }
  get newest() { return this.count ? this.time(this.count - 1) : NaN; }

  /**
   * Captures one frame (call after animation, once per rendered frame, only in CHECK/LIVE/DEAD). Skipped while
   * suspended, when less than 1/60 s of game time passed since the last sample, or past a deferred hold.
   * @param {number} t game time (world.time)
   * @param {Array<{capture:Function}|null>} animators six animators in replay index order
   * @param {{position:{x,y,z}, quaternion:{x,y,z,w}, visible:boolean}|null} ball the rendered ball (BallVisual.mesh)
   * @returns {boolean} recorded
   */
  capture(t, animators, ball) {
    if (this.suspended || !(t === t)) return false;
    if (t < this.lastT - 1e-6) this.reset();                   // time went backwards: a new game
    if (t - this.lastT < REPLAY.MIN_DT - 1e-4) return false;
    if (this.lastT >= this.holdUntil) return false;
    const s = this.head, o = s * this.stride, b = this.buf;
    b[o] = t;
    for (let i = 0; i < this.players; i++) {
      const po = o + 1 + i * REPLAY.PLAYER_FLOATS;
      const a = animators ? animators[i] : null;
      if (a && a.capture) a.capture(b, po);
      else { b.fill(0, po, po + REPLAY.PLAYER_FLOATS); b[po + CAP.QUAT + 3] = 1; }
    }
    const bo = o + BALL_OFF;
    if (ball && ball.position) {
      b[bo] = ball.position.x; b[bo + 1] = ball.position.y; b[bo + 2] = ball.position.z;
      const q = ball.quaternion;
      if (q) { b[bo + 3] = q.x; b[bo + 4] = q.y; b[bo + 5] = q.z; b[bo + 6] = q.w; } else { b[bo + 3] = 0; b[bo + 4] = 0; b[bo + 5] = 0; b[bo + 6] = 1; }
      b[bo + 7] = ball.visible === false ? 0 : 1;
    } else {
      b[bo] = 0; b[bo + 1] = 0; b[bo + 2] = 0; b[bo + 3] = 0; b[bo + 4] = 0; b[bo + 5] = 0; b[bo + 6] = 1; b[bo + 7] = 0;
    }
    this.times[s] = t;
    this.head = (s + 1) % this.frames;
    if (this.count < this.frames) this.count++;
    this.lastT = t;
    return true;
  }

  /** Logs an event {t, code (EVT), playerIndex (−1 none)} into the ring of 32. */
  recordEvent(code, t, playerIndex = -1) {
    const o = this.evHead * 3;
    this.ev[o] = t; this.ev[o + 1] = code; this.ev[o + 2] = playerIndex;
    this.evHead = (this.evHead + 1) % REPLAY.EVENTS;
    if (this.evCount < REPLAY.EVENTS) this.evCount++;
  }

  /**
   * Latest event of `code` with time in [tFrom, tTo] (and of `playerIndex` when ≥ 0). Returns its time or NaN.
   */
  lastEvent(code, tFrom, tTo, playerIndex = -1) {
    for (let k = 0; k < this.evCount; k++) {
      const o = ((this.evHead - 1 - k + REPLAY.EVENTS * 2) % REPLAY.EVENTS) * 3;
      const t = this.ev[o];
      if (this.ev[o + 1] !== code || t < tFrom || t > tTo) continue;
      if (playerIndex >= 0 && this.ev[o + 2] !== playerIndex) continue;
      return t;
    }
    return NaN;
  }

  /**
   * Bracketing samples for game time t: out.a / out.b = float offsets of the frames around t, out.alpha ∈ [0, 1],
   * out.ka / out.kb logical indices. Binary search over the logical order (≤ 8 probes for 240 frames).
   * Returns false when empty.
   */
  bracket(t, out) {
    const n = this.count;
    if (n === 0) return false;
    if (n === 1 || t <= this.time(0)) { const o = this.offset(0); out.a = o; out.b = o; out.ka = 0; out.kb = 0; out.alpha = 0; return true; }
    if (t >= this.time(n - 1)) { const o = this.offset(n - 1); out.a = o; out.b = o; out.ka = n - 1; out.kb = n - 1; out.alpha = 0; return true; }
    let lo = 0, hi = n - 1;                    // invariant: time(lo) ≤ t < time(hi)
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.time(mid) <= t) lo = mid; else hi = mid;
    }
    const ta = this.time(lo), tb = this.time(hi);
    out.ka = lo; out.kb = hi;
    out.a = this.offset(lo); out.b = this.offset(hi);
    out.alpha = tb > ta ? (t - ta) / (tb - ta) : 0;
    return true;
  }

  /**
   * World position of player i's pelvis in frame offset `fo`: root + R(yaw)·pelvisLocal (three's rotation about +y:
   * local (x, z) → (x·cos + z·sin, −x·sin + z·cos)). Writes out {x, y, z}; returns the visible flag.
   */
  pelvisAt(fo, i, out) {
    const b = this.buf, o = fo + 1 + i * REPLAY.PLAYER_FLOATS;
    const yaw = b[o + CAP.YAW], c = Math.cos(yaw), s = Math.sin(yaw);
    const px = b[o + CAP.PELVIS], py = b[o + CAP.PELVIS + 1], pz = b[o + CAP.PELVIS + 2];
    out.x = b[o] + px * c + pz * s;
    out.y = b[o + 1] + py;
    out.z = b[o + 2] - px * s + pz * c;
    return b[o + CAP.VISIBLE] > 0.5;
  }
}

// ======================================================================================================== triggers

const RESULT = { start: false, kind: '', window: { t0: 0, t1: 0, anchor: 0 }, focus: -1, other: -1, winner: false, deferred: false, t: 0, reason: '' };

function typeOf(e, type) {
  if (type) return type;
  return e ? (e.type || e.evt || e.event || e.name || '') : '';
}

/**
 * Decides when to replay (§6.4.6) and logs the replay-relevant events into the recorder's ring.
 * flow (WP9) calls `onGameEvent(e, type)` for 'takeoff', 'release', 'slam', 'score', 'block', 'steal', 'buzzer',
 * 'ankle' and 'ball' events (type = the game.on event name; it may also be carried as e.type).
 */
export class ReplayTriggers {
  /**
   * @param {object} opts
   * @param {ReplayRecorder} opts.recorder
   * @param {'off'|'dunks'|'all'} [opts.mode='dunks'] settings `replays`
   * @param {object} [opts.world] reads quarter, gameClock, score[team], players[i].id (event fields override:
   *        e.q / e.quarter, e.gameClock, e.scoreFor / e.scoreAgainst)
   * @param {number} [opts.quarterSec=120] quarter length (game clock s); OT = 60 s
   * @param {(id:string)=>number} [opts.indexOf] playerId → replay index (default: world.players[i].id match)
   */
  constructor(opts = {}) {
    this.recorder = opts.recorder || null;
    this.world = opts.world || null;
    this.quarterSec = opts.quarterSec > 0 ? opts.quarterSec : 120;
    this.indexOf = opts.indexOf || null;
    this.setMode(opts.mode || 'dunks');
    this.resetGame();
  }

  /** Settings `replays`: 'off' | 'dunks' | 'all'. */
  setMode(m) { this.mode = m === 'off' || m === 'all' ? m : 'dunks'; }

  /** New game: count and cooldown reset. */
  resetGame() { this.count = 0; this.lastElapsed = -Infinity; }

  /** Replay index of a player id (or e.playerIndex), −1 if unknown. */
  index(id) {
    if (typeof id === 'number') return id;
    if (id === undefined || id === null) return -1;
    if (this.indexOf) return this.indexOf(id);
    const ps = this.world && this.world.players;
    if (ps) for (let i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === id) return i;
    return -1;
  }

  /**
   * Elapsed game clock (s) over the whole game, monotone across periods: Q1–Q4 of quarterSec, then OTs of 60 s.
   */
  elapsed(quarter, gameClock) {
    const Q = this.quarterSec, q = quarter > 0 ? quarter : 1, gc = gameClock >= 0 ? gameClock : 0;
    if (q <= 4) return (q - 1) * Q + (Q - gc);
    return 4 * Q + (q - 5) * REPLAY.OT_S + (REPLAY.OT_S - gc);
  }

  /**
   * Routes one game event. Returns a module scratch object (read it before the next call):
   * {start, kind ('dunk'|'jumper'|'block'|'ankle'), window {t0, t1, anchor}, focus, other, winner, deferred, t, reason}.
   * `deferred` (game-winner): flow schedules it after the final buzzer (ReplayPlayer.schedule(r) then begin()).
   * On start the caller also does `game.holdDead(REPLAY.HOLD_DEAD)` (2.9 s) unless deferred.
   */
  onGameEvent(e, type) {
    const r = RESULT;
    r.start = false; r.kind = ''; r.focus = -1; r.other = -1; r.winner = false; r.deferred = false; r.reason = '';
    if (!e) return r;
    const ty = typeOf(e, type);
    const t = typeof e.t === 'number' ? e.t : (this.world && typeof this.world.time === 'number' ? this.world.time : 0);
    r.t = t;
    const pi = this.index(e.playerIndex !== undefined ? e.playerIndex : e.playerId);
    const rec = this.recorder;
    // 1. event ring
    if (rec) {
      if (ty === 'ball') {
        const w = e.what;
        if (w === 'rim') rec.recordEvent(EVT.rim, t, pi);
        else if (w === 'swish' || w === 'rimIn') rec.recordEvent(EVT.swish, t, pi);
      } else if (ty === 'block') {
        rec.recordEvent(EVT.block, t, this.index(e.blockerId !== undefined ? e.blockerId : e.playerId));
      } else {
        const code = EVT[ty];
        if (code && code <= EVT.buzzer) rec.recordEvent(code, t, pi);
      }
    }
    // 2. triggers
    if (this.mode === 'off') { r.reason = 'off'; return r; }
    let kind = '', anchor = t, focus = pi, other = -1;
    if (ty === 'score') {
      const dunk = e.kind === 'dunk';
      const clutch = this._clutchMake(e);
      if (!dunk && !clutch) { r.reason = 'plain'; return r; }
      r.winner = !!e.winner;
      if (dunk) {
        kind = 'dunk';
        const s = rec ? rec.lastEvent(EVT.slam, t - 2.5, t + 1e-3, pi) : NaN;
        anchor = s === s ? s : t - 0.05;
      } else {
        kind = 'jumper';
        const s = rec ? rec.lastEvent(EVT.release, t - 4.0, t + 1e-3, pi) : NaN;
        anchor = s === s ? s : t - 1.0;
      }
    } else if (ty === 'block' && this.mode === 'all') {
      if (!(e.chaseDown || e.help || e.helpBlock)) { r.reason = 'plainBlock'; return r; }
      kind = 'block';
      focus = this.index(e.blockerId !== undefined ? e.blockerId : e.playerId);
      other = this.index(e.shooterId);
    } else if (ty === 'ankle' && this.mode === 'all') {
      kind = 'ankle';
      other = this.index(e.defenderId);
    } else {
      return r;
    }
    if (this.count >= REPLAY.MAX_PER_GAME) { r.reason = 'max'; return r; }
    const el = this._elapsedOf(e);
    if (!r.winner && el - this.lastElapsed < REPLAY.COOLDOWN) { r.reason = 'cooldown'; return r; }
    this.count++;
    this.lastElapsed = el;
    r.start = true;
    r.kind = kind;
    r.focus = focus;
    r.other = other;
    r.deferred = r.winner;
    replayWindow(kind, anchor, r.window);
    return r;
  }

  _quarter(e) {
    if (typeof e.q === 'number') return e.q;
    if (typeof e.quarter === 'number') return e.quarter;
    return this.world && typeof this.world.quarter === 'number' ? this.world.quarter : 1;
  }

  _clock(e) {
    if (typeof e.gameClock === 'number') return e.gameClock;
    return this.world && typeof this.world.gameClock === 'number' ? this.world.gameClock : 0;
  }

  _elapsedOf(e) { return this.elapsed(this._quarter(e), this._clock(e)); }

  /** Make that wins or ties in the last 3.0 s of Q4/OT, a make at a period buzzer, or a game-winner. */
  _clutchMake(e) {
    if (e.winner || e.buzzer) return true;
    if (this._quarter(e) < 4 || this._clock(e) > REPLAY.CLUTCH_S) return false;
    let sf, sa;
    if (typeof e.scoreFor === 'number' && typeof e.scoreAgainst === 'number') { sf = e.scoreFor; sa = e.scoreAgainst; } else {
      const s = this.world && this.world.score;
      const team = e.team === 'b' ? 1 : e.team === 'a' ? 0 : e.team;
      if (!s || (team !== 0 && team !== 1)) return false;
      sf = s[team]; sa = s[1 - team];
    }
    const pts = e.points > 0 ? e.points : 2;
    const after = sf - sa, before = after - pts;   // the score is already counted when 'score' is emitted
    return before <= 0 && after >= 0;
  }
}

// ========================================================================================================== player

const BR = { a: 0, b: 0, ka: 0, kb: 0, alpha: 0 };
const P0 = { x: 0, y: 0, z: 0 };
const P1 = { x: 0, y: 0, z: 0 };

/** Critically damped follow toward a target (Unity-style SmoothDamp in closed form); state {x,y,z,vx,vy,vz}. */
function smoothFollow(s, tx, ty, tz, smoothTime, dt) {
  const omega = 2 / smoothTime, x = omega * dt;
  const ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);   // Padé approximation of e^(−x)
  let c = s.x - tx, tmp = (s.vx + omega * c) * dt; s.vx = (s.vx - omega * tmp) * ex; s.x = tx + (c + tmp) * ex;
  c = s.y - ty; tmp = (s.vy + omega * c) * dt; s.vy = (s.vy - omega * tmp) * ex; s.y = ty + (c + tmp) * ex;
  c = s.z - tz; tmp = (s.vz + omega * c) * dt; s.vz = (s.vz - omega * tmp) * ex; s.z = tz + (c + tmp) * ex;
}

/**
 * Plays a scheduled replay: timeline, pose application, replayed ball, cameras, LOD hints. One per page.
 */
export class ReplayPlayer {
  /**
   * @param {object} opts
   * @param {ReplayRecorder} opts.recorder
   * @param {Array<object|null>} [opts.animators] six animators (index order of the recorder)
   * @param {{position, quaternion, visible}} [opts.ball] the rendered ball object written during playback
   * @param {ArrayLike<number>} [opts.heights] barefoot heights of the six (m; default 2.0)
   * @param {'low'|'medium'|'high'} [opts.tier='medium']
   */
  constructor(opts = {}) {
    this.recorder = opts.recorder;
    this.animators = opts.animators || null;
    this.ballObj = opts.ball || null;
    this.heights = new Float32Array(REPLAY.PLAYERS).fill(2.0);
    if (opts.heights) for (let i = 0; i < REPLAY.PLAYERS; i++) if (opts.heights[i] > 0) this.heights[i] = opts.heights[i];
    this.tier = opts.tier || 'medium';
    this.onCue = null;               // (name: 'wipeIn'|'on'|'event'|'off'|'done'|'cancel', a, b) => void
    this.phase = 'idle';             // idle | armed | pending | playing | out
    this.clock = 0;                  // s since the trigger (pending)
    this.kind = '';
    this.focus = -1; this.other = -1;
    this.t0 = 0; this.t1 = 0; this.anchor = 0; this.trigT = 0;
    this.tPlay = 0;                  // game time being shown
    this.playT = 0;                  // screen seconds since playback start
    this.dur = 3.0;
    this.outT = 0; this.outDur = REPLAY.WIPE_OUT;
    this.wiped = false;
    this.started = false;            // playback began ('on'); a skip during the wipe-in never applies poses
    this.lod = new Int8Array(REPLAY.PLAYERS).fill(-1);
    this.roots = new Float32Array(REPLAY.PLAYERS * 4);     // lerped root x, y, z, yaw (for flow if needed)
    this.pelvis = new Float32Array(REPLAY.PLAYERS * 3);    // lerped pelvis world positions (camera constraints)
    this.vis = new Uint8Array(REPLAY.PLAYERS);
    /** Replayed ball for the net sim (hoop.update(dt × 0.5, player.ball)) and ballvis-like consumers. */
    this.ball = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, quat: new Float32Array(4), visible: false, state: 'flight' };
    // camera state
    this.subj = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    this.ballS = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    this.cam = { x: 0, y: 0, z: 0 };
    this.approach = { x: 0, z: -1 };
    this.startAz = 0; this.sweepSign = 1;
    this.takeoffT = NaN; this.slamT = NaN;
    this.lineX = 0; this.lineZ = 0; this.lineDx = 0; this.lineDz = -1; this.sideX = 0; this.sideZ = 1;
    this.shooterSide = 1; this.y0 = 1.0;
    this.lastCueT = 0;
  }

  /** True while the replay is on screen (cue 'on' → playback end, 3.0 s). */
  get active() { return this.phase === 'playing'; }
  /** True from schedule() until 'done' (recording suspended from 'on'). */
  get busy() { return this.phase !== 'idle'; }

  /** Tier for the LOD rule (call on tier changes). */
  setTier(tier) { this.tier = tier; }

  /**
   * Arms a replay from a ReplayTriggers result (copied; the result object may be reused). A normal trigger starts the
   * 0 → 4.40 s timeline now; a deferred one (game-winner) protects the window in the ring and waits for begin().
   * @returns {boolean} accepted (false while another replay is busy)
   */
  schedule(trig) {
    if (this.phase !== 'idle' || !trig || !trig.start) return false;
    this.kind = trig.kind; this.focus = trig.focus; this.other = trig.other;
    this.t0 = trig.window.t0; this.t1 = trig.window.t1; this.anchor = trig.window.anchor; this.trigT = trig.t;
    this.clock = 0; this.wiped = false;
    if (trig.deferred) {
      this.phase = 'armed';
      if (this.recorder) this.recorder.holdUntil = this.t1;
    } else {
      this.phase = 'pending';
    }
    return true;
  }

  /** Starts an armed (deferred) replay: wipe-in immediately, playback 0.25 s later (after the final buzzer). */
  begin() {
    if (this.phase !== 'armed') return false;
    this.phase = 'pending';
    this.clock = REPLAY.LIVE;
    this.wiped = true;
    if (this.onCue) this.onCue('wipeIn', false, 0);
    return true;
  }

  /** Any tap / key / the skip button: 0.15 s wipe-out (or a silent cancel before the wipe-in). */
  skip() {
    if (this.phase === 'idle' || this.phase === 'out') return;
    if ((this.phase === 'pending' || this.phase === 'armed') && !this.wiped) { this._finish('cancel'); return; }
    this.phase = 'out'; this.outT = 0; this.outDur = REPLAY.SKIP_OUT;
    if (this.onCue) this.onCue('off', true, 0);
  }

  /**
   * Advances the timeline by frameDt screen seconds (pass 0 while the game is paused). Time left over when a phase
   * ends carries into the next one, so the cue times do not drift by a frame at each boundary.
   */
  update(frameDt) {
    let dt = frameDt > 0 ? frameDt : 0;
    if (this.phase === 'pending') {
      this.clock += dt;
      if (!this.wiped && this.clock >= REPLAY.LIVE) { this.wiped = true; if (this.onCue) this.onCue('wipeIn', false, 0); }
      if (this.clock < REPLAY.START) return;
      dt = this.clock - REPLAY.START;
      this._start();
    }
    if (this.phase === 'playing') {
      const prev = this.tPlay;
      this.playT += dt;
      this.tPlay = this.t0 + REPLAY.RATE * this.playT;
      if (this.tPlay > this.t1) this.tPlay = this.t1;
      this._eventCues(prev, this.tPlay);
      if (this.playT < this.dur) return;
      dt = this.playT - this.dur;
      this.playT = this.dur;
      this.phase = 'out'; this.outT = 0; this.outDur = REPLAY.WIPE_OUT;
      if (this.onCue) this.onCue('off', false, 0);
    }
    if (this.phase === 'out') {
      this.outT += dt;
      if (this.outT >= this.outDur - 1e-9) this._finish('done');
    }
  }

  /**
   * Writes the replayed poses (call instead of animator.evaluate while busy past 'on'; main loop step 4) and the ball.
   * `alpha` (the sim interpolation factor) is unused: the replay interpolates between recorded frames itself.
   */
  apply() {
    if (!this.started || (this.phase !== 'playing' && this.phase !== 'out') || !this.recorder) return;
    const rec = this.recorder;
    if (!rec.bracket(this.tPlay, BR)) return;
    const b = rec.buf, al = BR.alpha;
    for (let i = 0; i < REPLAY.PLAYERS; i++) {
      const oa = BR.a + 1 + i * REPLAY.PLAYER_FLOATS, ob = BR.b + 1 + i * REPLAY.PLAYER_FLOATS;
      const a = this.animators ? this.animators[i] : null;
      if (a && a.applyBlend) a.applyBlend(b, oa, ob, al);
      for (let j = 0; j < 3; j++) this.roots[i * 4 + j] = b[oa + j] + (b[ob + j] - b[oa + j]) * al;
      this.roots[i * 4 + 3] = lerpAngle(b[oa + CAP.YAW], b[ob + CAP.YAW], al);
      const va = rec.pelvisAt(BR.a, i, P0);
      rec.pelvisAt(BR.b, i, P1);
      this.pelvis[i * 3] = P0.x + (P1.x - P0.x) * al;
      this.pelvis[i * 3 + 1] = P0.y + (P1.y - P0.y) * al;
      this.pelvis[i * 3 + 2] = P0.z + (P1.z - P0.z) * al;
      this.vis[i] = (al < 0.5 ? va : b[ob + CAP.VISIBLE] > 0.5) ? 1 : 0;
    }
    // ball: lerp position, slerp quaternion, velocity by finite difference of the bracketing samples (game time)
    const ba = BR.a + BALL_OFF, bb = BR.b + BALL_OFF, B = this.ball;
    B.pos.x = b[ba] + (b[bb] - b[ba]) * al;
    B.pos.y = b[ba + 1] + (b[bb + 1] - b[ba + 1]) * al;
    B.pos.z = b[ba + 2] + (b[bb + 2] - b[ba + 2]) * al;
    const dtab = rec.time(BR.kb) - rec.time(BR.ka);
    if (dtab > 1e-6) {
      B.vel.x = (b[bb] - b[ba]) / dtab; B.vel.y = (b[bb + 1] - b[ba + 1]) / dtab; B.vel.z = (b[bb + 2] - b[ba + 2]) / dtab;
    }
    slerp4(b, ba + 3, b, bb + 3, al, B.quat, 0);
    B.visible = (al < 0.5 ? b[ba + 7] : b[bb + 7]) > 0.5;
    const o = this.ballObj;
    if (o) {
      if (o.position) { if (o.position.set) o.position.set(B.pos.x, B.pos.y, B.pos.z); else { o.position.x = B.pos.x; o.position.y = B.pos.y; o.position.z = B.pos.z; } }
      if (o.quaternion) { if (o.quaternion.set) o.quaternion.set(B.quat[0], B.quat[1], B.quat[2], B.quat[3]); else { o.quaternion.x = B.quat[0]; o.quaternion.y = B.quat[1]; o.quaternion.z = B.quat[2]; o.quaternion.w = B.quat[3]; } }
      o.visible = B.visible;
    }
  }

  /**
   * Replay camera pose (director mode 'replay' source). Updates the smoothed subject, applies the kind's path and
   * the constraints, and refreshes `lod`.
   * @param {object} out pose {px,py,pz,lx,ly,lz,fov,lens}
   * @param {number} dt frame seconds (smoothing)
   */
  pose(out, dt) {
    const k = dt > 0 ? dt : 0;
    const f = this.focus >= 0 ? this.focus : 0;
    const sx = this.pelvis[f * 3], sy = this.pelvis[f * 3 + 1], sz = this.pelvis[f * 3 + 2];
    if (k > 0) {
      smoothFollow(this.subj, sx, sy, sz, REPLAY.SMOOTH, k);
      smoothFollow(this.ballS, this.ball.pos.x, this.ball.pos.y, this.ball.pos.z, REPLAY.SMOOTH, k);
    }
    const S = this.subj, u = this.dur > 0 ? Math.min(1, this.playT / this.dur) : 1;
    out.lens = 0;
    if (this.kind === 'dunk') {
      const D = REPLAY.DUNK, h = this.heights[f];
      // azimuth (about +y, measured like rotation.y: direction (sin θ, cos θ)) sweeps 50° back toward the approach axis
      const th = this.startAz - this.sweepSign * D.sweepDeg * DEG * u;
      out.px = S.x + D.r * Math.sin(th);
      out.pz = S.z + D.r * Math.cos(th);
      out.py = D.y0 + (D.y1 - D.y0) * u;
      // look at 0.495·h above the floor under the pelvis, carried up by the jump: the recorded pelvis height minus its
      // height at the window start (running, feet down) gives the jump, so the look starts at hip height, not the head
      out.lx = S.x; out.ly = D.lookH * h + Math.max(0, S.y - this.y0); out.lz = S.z;
      if (this.takeoffT === this.takeoffT && this.tPlay > this.takeoffT) {
        const w = D.rimBlend * Math.min(1, (this.tPlay - this.takeoffT) / D.blendS);
        out.lx += (RIM.x - out.lx) * w; out.ly += (RIM.y - out.ly) * w; out.lz += (RIM.z - out.lz) * w;
      }
      out.fov = D.fov;
      if (this.slamT === this.slamT) {
        const ts = this.playT - (this.slamT - this.t0) / REPLAY.RATE;
        if (ts >= 0 && ts < D.shakeS) {
          const a = D.shakeM * (1 - ts / D.shakeS), w = 2 * Math.PI * D.shakeHz * ts;
          out.px += a * Math.sin(w); out.py += a * Math.sin(w * 1.31 + 1.7); out.pz += a * 0.6 * Math.sin(w * 0.87 + 0.6);
        }
      }
    } else if (this.kind === 'jumper') {
      const J = REPLAY.JUMPER;
      if (u < J.split) {
        // behind the shooter (opposite the shooter→rim direction), over his right shoulder, at the rim
        let dx = RIM.x - S.x, dz = RIM.z - S.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        dx /= d; dz /= d;
        const rx = -dz, rz = dx;                // the shooter's right when facing (dx, dz): +x is his left
        out.px = S.x - dx * J.back + rx * J.shoulder;
        out.pz = S.z - dz * J.back + rz * J.shoulder;
        out.py = J.up + 0.5 * Math.max(0, S.y - this.y0);
        out.lx = RIM.x; out.ly = RIM.y; out.lz = RIM.z;
        out.fov = J.fov;
      } else {
        const v = (u - J.split) / (1 - J.split);
        out.px = RIM.x + this.shooterSide * J.rimX; out.py = J.rimY; out.pz = RIM.z + J.rimDz;
        out.lx = RIM.x; out.ly = RIM.y; out.lz = RIM.z;
        out.fov = J.fov + (J.fovTo - J.fov) * v;
      }
    } else {
      // block / ankle: side-on to the line, sliding with the ball's projection onto it, tracking the ball
      const B = REPLAY.BLOCK, Bs = this.ballS;
      const proj = (Bs.x - this.lineX) * this.lineDx + (Bs.z - this.lineZ) * this.lineDz;
      out.px = this.lineX + this.lineDx * proj + this.sideX * B.dist;
      out.pz = this.lineZ + this.lineDz * proj + this.sideZ * B.dist;
      out.py = B.y;
      // track the ball in x/z; vertically halfway between the ball and the focus player's chest so the bodies stay in
      // frame while the ball is high
      out.lx = Bs.x; out.ly = 0.5 * (Bs.y + S.y + B.chestUp); out.lz = Bs.z;
      out.fov = B.fov;
    }
    this._constrain(out);
    this.cam.x = out.px; this.cam.y = out.py; this.cam.z = out.pz;
    replayLod(this.tier, out.px, out.py, out.pz, this.pelvis, this.vis, this.lod);
    return out;
  }

  // ------------------------------------------------------------------------------------------------ internals

  _start() {
    const rec = this.recorder;
    if (!rec || rec.count < 2) { this._finish('cancel'); return; }
    if (this.t0 < rec.oldest) this.t0 = rec.oldest;
    if (this.t1 > rec.newest) this.t1 = rec.newest;
    if (this.t1 - this.t0 < 0.2) { this.phase = 'out'; this.outT = 0; this.outDur = REPLAY.SKIP_OUT; if (this.onCue) this.onCue('off', true, 0); return; }
    this.dur = (this.t1 - this.t0) / REPLAY.RATE;
    this.playT = 0; this.tPlay = this.t0; this.lastCueT = this.t0;
    rec.suspended = true;
    rec.holdUntil = Infinity;
    if (this.animators) for (let i = 0; i < this.animators.length; i++) if (this.animators[i]) this.animators[i].external = true;
    this.phase = 'playing';
    this.started = true;
    this.apply();
    this._initCamera();
    if (this.onCue) this.onCue('on', false, 0);
  }

  _finish(cue) {
    const was = this.phase;
    this.phase = 'idle';
    this.started = false;
    if (this.recorder) { this.recorder.suspended = false; this.recorder.holdUntil = Infinity; }
    if (this.animators) for (let i = 0; i < this.animators.length; i++) if (this.animators[i]) this.animators[i].external = false;
    this.lod.fill(-1);
    if (this.onCue && was !== 'idle') this.onCue(cue, false, 0);
  }

  _eventCues(from, to) {
    if (!this.onCue || !(to > from)) return;
    const rec = this.recorder, ev = rec.ev;
    for (let k = 0; k < rec.evCount; k++) {
      const o = k * 3, t = ev[o];
      if (t > from && t <= to) this.onCue('event', ev[o + 1], ev[o + 2]);
    }
  }

  /** One-time path set-up at playback start (approach, sides, event times). */
  _initCamera() {
    const rec = this.recorder, f = this.focus >= 0 ? this.focus : 0;
    rec.bracket(this.t0, BR);
    rec.pelvisAt(BR.a, f, P0);
    const S = this.subj;
    S.x = this.pelvis[f * 3]; S.y = this.pelvis[f * 3 + 1]; S.z = this.pelvis[f * 3 + 2]; S.vx = S.vy = S.vz = 0;
    const Bs = this.ballS;
    Bs.x = this.ball.pos.x; Bs.y = this.ball.pos.y; Bs.z = this.ball.pos.z; Bs.vx = Bs.vy = Bs.vz = 0;
    this.y0 = P0.y;
    this.takeoffT = rec.lastEvent(EVT.takeoff, this.t0 - 0.5, this.t1, this.focus);
    this.slamT = rec.lastEvent(EVT.slam, this.t0, this.t1, this.focus);
    if (this.kind === 'dunk') {
      // approach = pelvis motion from the window start to takeoff (or slam − 0.5 s) in xz
      const tA = this.takeoffT === this.takeoffT ? this.takeoffT : (this.slamT === this.slamT ? this.slamT - 0.5 : this.anchor - 0.5);
      rec.bracket(tA, BR);
      rec.pelvisAt(BR.a, f, P1);
      let ax = P1.x - P0.x, az = P1.z - P0.z;
      let d = Math.sqrt(ax * ax + az * az);
      if (d < 0.3) { ax = RIM.x - P1.x; az = RIM.z - P1.z; d = Math.sqrt(ax * ax + az * az) || 1; }
      ax /= d; az /= d;
      this.approach.x = ax; this.approach.z = az;
      // r = −approach (back along the path); start 60° off r toward the broadcast side (+z), sweep back toward r
      const thR = Math.atan2(-ax, -az);
      const zPlus = Math.cos(thR + REPLAY.DUNK.startDeg * DEG), zMinus = Math.cos(thR - REPLAY.DUNK.startDeg * DEG);
      this.sweepSign = zPlus >= zMinus ? 1 : -1;
      this.startAz = thR + this.sweepSign * REPLAY.DUNK.startDeg * DEG;
    } else if (this.kind === 'jumper') {
      this.shooterSide = P0.x >= 0 ? -1 : 1;     // the rim cam sits on the side away from the shooter
    } else {
      // block: shooter → rim line; ankle: handler → defender line. Anchor point = the focus at the event.
      let lx0, lz0, dx, dz;
      const o = this.other;
      if (this.kind === 'block' && o >= 0) {
        rec.pelvisAt(BR.a, o, P1);
        lx0 = P1.x; lz0 = P1.z; dx = RIM.x - P1.x; dz = RIM.z - P1.z;
      } else if (o >= 0) {
        rec.bracket(this.anchor, BR);
        rec.pelvisAt(BR.a, f, P0);
        rec.pelvisAt(BR.a, o, P1);
        lx0 = P0.x; lz0 = P0.z; dx = P1.x - P0.x; dz = P1.z - P0.z;
      } else {
        lx0 = P0.x; lz0 = P0.z; dx = RIM.x - P0.x; dz = RIM.z - P0.z;
      }
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1e-3) { dx = 0; dz = -1; } else { dx /= d; dz /= d; }
      this.lineX = lx0; this.lineZ = lz0; this.lineDx = dx; this.lineDz = dz;
      // perpendicular on the broadcast side (+z), or +x when the line runs along z
      let nx = -dz, nz = dx;
      if (nz < -1e-3 || (Math.abs(nz) <= 1e-3 && nx < 0)) { nx = -nx; nz = -nz; }
      this.sideX = nx; this.sideZ = nz;
    }
  }

  /** z ≥ −12.0, y ≥ 0.8, ≥ 0.9 m from every visible recorded pelvis (two relaxation passes). */
  _constrain(out) {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < REPLAY.PLAYERS; i++) {
        if (!this.vis[i]) continue;
        const dx = out.px - this.pelvis[i * 3], dy = out.py - this.pelvis[i * 3 + 1], dz = out.pz - this.pelvis[i * 3 + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= REPLAY.MIN_PELVIS) continue;
        if (d < 1e-4) { out.pz += REPLAY.MIN_PELVIS; continue; }
        const s = REPLAY.MIN_PELVIS / d;
        out.px = this.pelvis[i * 3] + dx * s; out.py = this.pelvis[i * 3 + 1] + dy * s; out.pz = this.pelvis[i * 3 + 2] + dz * s;
      }
      if (out.pz < REPLAY.MIN_Z) out.pz = REPLAY.MIN_Z;
      if (out.py < REPLAY.MIN_Y) out.py = REPLAY.MIN_Y;
    }
  }
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
