/**
 * @module testbot
 * Scripted human for balance tests and `?bot=` (spec §5.14, GP §11.4). The bot drives an Intent exactly like the
 * touch / keyboard input does — the stick, SPRINT and the three buttons with ms timestamps — so the game resolves its
 * actions through the real input path (game.applyInput copies `bot.intent` into the controlled player, with the same
 * edge dedupe as for a human). It never calls internal setters; the only game call is `turnover()` of the `idle` mode
 * (§5.14 B: user possessions end through `__game.turnover()` at LIVE + 0.5 s).
 *
 *   const bot = new TestBot(game, { seed, intent? });  game.input = bot;   // or pass `intent` = input.intent (main.js)
 *   bot.set('avg');   // off | idle | avg | good | drive | pullup
 *   per fixed step:  bot.step(FIXED_DT);  game.step(FIXED_DT);
 *
 * Modes
 *   off     the intent is left alone
 *   idle    the user's player never moves; on offence the possession is turned over at LIVE + 0.5 s
 *   avg     offence from LIVE + 0.8 s: drive 40 % (sprint at the rim, SHOOT at d ≤ 2.0), pull-up 30 % (run 1.5 s along
 *           the arc, SHOOT), pass-and-shoot 30 % (PASS, the return pass, SHOOT 0.5 s after the return catch); SHOOT is
 *           held tIdeal + N(0, 0.050) s; one CROSS with p 0.5 when a defender is within 1.2 m. Defence: steer to the
 *           man's gap point (normal defGap), BLOCK on 50 % of the man's shots at tRel − airtime/2 + N(0, 0.10), STEAL
 *           every 2.5 s within stealRange, never SWITCH (the game's auto hands-up does the rest)
 *   good    avg with the SHOOT hold σ 0.030 s
 *   drive   v1 human-sim case A1: sprint straight at the rim from the check spot, SHOOT at d ≤ 2.0 (hold as avg)
 *   pullup  v1 human-sim case A4: sprint at the rim, stop at d ≤ 3.5, wait 6 steps, SHOOT (hold as avg)
 *
 * The bot's own randomness is a private Rng (seed ^ 0xB07), so it never shifts the gameplay Rng sequence.
 * Zero allocation per step.
 */
import { RIM, FIXED_DT, DIFFICULTY, LINES } from './constants.js';
import { Rng } from './math.js';
import { makeIntent, clearEdges, pressButton, releaseButton } from './input.js';
import { onBallGap } from './ai-tend.js';

export const BOT_MODES = Object.freeze(['off', 'idle', 'avg', 'good', 'drive', 'pullup']);

const SIGMA_AVG = 0.050, SIGMA_GOOD = 0.030;
const PLAY_DELAY = 0.8;                 // offence starts at LIVE + 0.8 s
const P_DRIVE = 0.40, P_PULLUP = 0.30;  // pass-and-shoot = the rest (0.30)
const DRIVE_SHOOT_D = 2.0, PULLUP_RUN_T = 1.5, PULLUP_D = 3.5, PULLUP_WAIT = 6 * FIXED_DT;
const RETURN_PASS_T = 0.4, RETURN_SHOOT_T = 0.5, CROSS_R = 1.2, CROSS_P = 0.5;
const BLOCK_P = 0.5, BLOCK_SIGMA = 0.10, STEAL_EVERY = 2.5, IDLE_TURNOVER_T = 0.5;
const HOLD_MIN = 0.13;                  // a SHOOT released under 0.12 s would be a pump fake
const STICK_IDLE = 0.15;

function dist(ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; return Math.sqrt(dx * dx + dz * dz); }

export class TestBot {
  /**
   * @param {object} game a Game (reads `world`, calls `turnover()` in idle mode)
   * @param {{seed?: number, intent?: object}} [opts] `intent`: write into this Intent (e.g. the real Input's) instead
   *   of the bot's own
   */
  constructor(game, opts = {}) {
    this.game = game;
    this.mode = 'off';
    this.intent = opts.intent || makeIntent();
    this.rng = new Rng(((opts.seed | 0) || 1) ^ 0xB07);
    this.enabled = true;
    this.offense = false;
    this.resetPlay();
  }

  /** Mode switch (`__game.bot.set(mode)`); unknown modes turn the bot off. */
  set(mode) {
    this.mode = BOT_MODES.indexOf(mode) >= 0 ? mode : 'off';
    this.resetPlay();
    this.silence();
    return this.mode;
  }

  /** Input-compatible hooks used by Game (enterCheck / pause). */
  setOffense(on) { this.offense = !!on; }
  setEnabled(on) { this.enabled = !!on; }

  resetPlay() {
    this.play = '';            // drive | pullup | pass | ''
    this.phase = 0;
    this.phaseT = 0;
    this.liveSeen = false;
    this.lastLiveT = 0;
    this.holdT = -1;           // planned SHOOT hold of the press in progress (s)
    this.pressT = 0;           // game time of that press
    this.crossDone = false;
    this.stealCd = 0;
    this.blockShot = -1;       // pressT of the man's shot already decided
    this.blockAt = -1;         // game time of the planned BLOCK tap
    this.passer = null;
    this.catchSeenT = -1;
    this.turnedOver = false;
  }

  silence() {
    const it = this.intent, m = it.move;
    m.x = 0; m.z = 0; m.mag = 0; it.sprint = false;
    it.primary.held = false; it.secondary.held = false; it.tertiary.held = false;
    clearEdges(it);
  }

  /** One fixed step (call before game.step). */
  step(dt) {
    const it = this.intent;
    clearEdges(it);
    if (this.mode === 'off' || !this.enabled) return;
    const g = this.game, w = g.world;
    const m = it.move;
    m.idle = m.mag < STICK_IDLE ? (m.idle || 0) + dt : 0;
    if (w.state !== 'LIVE') {
      m.x = 0; m.z = 0; m.mag = 0; it.sprint = false;
      if (it.primary.held) releaseButton(it.primary, this.ms());
      if (w.state !== 'DEAD') this.resetPlay();
      else { this.play = ''; this.phase = 0; this.liveSeen = false; this.holdT = -1; this.crossDone = false; }
      return;
    }
    // a new LIVE period (CHECK → LIVE resets liveT)
    if (!this.liveSeen || w.liveT < this.lastLiveT) { this.resetPlay(); this.liveSeen = true; }
    this.lastLiveT = w.liveT;
    const me = w.controlled;
    if (!me) return;
    if (this.mode === 'idle') { this.idle(me, w); return; }
    if (w.offense === w.user) this.offenceStep(me, w, dt); else this.defenceStep(me, w, dt);
  }

  /** ms timestamp of the step about to run (game time advances before the intent is applied). */
  ms() { return (this.game.world.time + FIXED_DT) * 1000; }

  idle(me, w) {
    const m = this.intent.move;
    m.x = 0; m.z = 0; m.mag = 0; this.intent.sprint = false;
    if (w.offense === w.user && w.liveT >= IDLE_TURNOVER_T && !this.turnedOver) { this.turnedOver = true; this.game.turnover(); }
  }

  sigma() { return this.mode === 'good' ? SIGMA_GOOD : SIGMA_AVG; }

  stickTo(me, x, z, sprint) {
    const it = this.intent, m = it.move;
    const dx = x - me.pos.x, dz = z - me.pos.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.05) { m.x = 0; m.z = 0; m.mag = 0; it.sprint = false; return d; }
    m.x = dx / d; m.z = dz / d; m.mag = 1; it.sprint = !!sprint;
    return d;
  }

  stop() { const it = this.intent, m = it.move; m.x = 0; m.z = 0; m.mag = 0; it.sprint = false; }

  /** SHOOT press, or the hold of a press in progress (released at tIdeal + N(0, σ)). Returns true while shooting. */
  shootStep(me, w) {
    const b = this.intent.primary;
    if (b.held) {
      const s = me.shot;
      if (!s.active) { releaseButton(b, this.ms()); this.holdT = -1; return false; }
      if (this.holdT < 0) this.holdT = Math.max(HOLD_MIN, s.tIdeal + this.rng.gauss(0, this.sigma()));
      if (w.time + FIXED_DT - this.pressT >= this.holdT - 1e-9) { releaseButton(b, b.pressTs + this.holdT * 1000); this.holdT = -1; }
      return true;
    }
    return false;
  }

  pressShoot(w) {
    this.stop();
    pressButton(this.intent.primary, this.ms());
    this.pressT = w.time + FIXED_DT;
    this.holdT = -1;
  }

  /** Offence (§5.14 bots): one play per possession from LIVE + 0.8 s. */
  offenceStep(me, w, dt) {
    if (this.shootStep(me, w)) { this.stop(); return; }
    const it = this.intent;
    const hasBall = me.hasBall && w.ball.owner === me;
    if (this.mode === 'drive' || this.mode === 'pullup') { if (hasBall) this.scripted(me, w); else this.stop(); return; }
    if (!hasBall) {
      // the pass-and-shoot return: control followed the ball to the receiver, who passes it straight back
      this.stop();
      return;
    }
    if (w.liveT < PLAY_DELAY) { this.stop(); return; }
    // control followed my pass to the receiver: he gives it straight back
    if (this.passer && this.passer !== me && this.play === 'wait') this.play = 'return';
    if (this.play === '') {
      const u = this.rng.next();
      this.play = this.passer ? 'return' : u < P_DRIVE ? 'drive' : u < P_DRIVE + P_PULLUP ? 'pullup' : 'pass';
      this.phase = 0; this.phaseT = 0;
      if (this.play === 'pullup') this.pullDir = me.pos.x >= 0 ? 1 : -1;
    }
    this.phaseT += dt;
    // one CROSS when a defender is within 1.2 m (p 0.5, once per possession)
    if (!this.crossDone && me.dribbling && this.nearestDef(me, w) <= CROSS_R) {
      this.crossDone = true;
      if (this.rng.next() < CROSS_P) { const t = this.ms(); pressButton(it.tertiary, t); releaseButton(it.tertiary, t); }
    }
    const d = dist(me.pos.x, me.pos.z, RIM.x, RIM.z);
    switch (this.play) {
      case 'drive':
        if (d <= DRIVE_SHOOT_D) { this.pressShoot(w); return; }
        this.stickTo(me, RIM.x, RIM.z, true);
        return;
      case 'pullup': {
        if (this.phaseT >= PULLUP_RUN_T) { this.pressShoot(w); return; }
        // along the arc (tangent of the rim circle), staying near 7.6 m
        const rx = me.pos.x - RIM.x, rz = me.pos.z - RIM.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
        let tx = -rz / rl * this.pullDir, tz = rx / rl * this.pullDir;
        const radial = (LINES.THREE_R + 0.4 - rl) * 0.8;
        tx += rx / rl * radial; tz += rz / rl * radial;
        if (Math.abs(me.pos.x) > 6.2) this.pullDir = -Math.sign(me.pos.x) || 1;
        const l = Math.sqrt(tx * tx + tz * tz) || 1;
        it.move.x = tx / l; it.move.z = tz / l; it.move.mag = 1; it.sprint = false;
        return;
      }
      case 'pass': {
        // aim the stick at the most open teammate and tap PASS
        const q = this.openMate(me, w);
        if (!q) { this.play = 'pullup'; this.pullDir = 1; return; }
        const dx = q.pos.x - me.pos.x, dz = q.pos.z - me.pos.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
        it.move.x = dx / l; it.move.z = dz / l; it.move.mag = 1; it.sprint = false;
        const t = this.ms();
        pressButton(it.secondary, t); releaseButton(it.secondary, t);
        this.passer = me;
        this.play = 'wait';
        return;
      }
      case 'return': {
        // I am the receiver (control followed the pass): give it back after 0.4 s, then shoot 0.5 s after its catch
        const back = this.passer;
        if (back === me) {
          if (w.time - me.cx.catchT >= RETURN_SHOOT_T) { this.passer = null; this.play = 'done'; this.pressShoot(w); }
          else this.stop();
          return;
        }
        if (w.time - me.cx.catchT < RETURN_PASS_T) { this.stop(); return; }
        const dx = back.pos.x - me.pos.x, dz = back.pos.z - me.pos.z, l = Math.sqrt(dx * dx + dz * dz) || 1;
        it.move.x = dx / l; it.move.z = dz / l; it.move.mag = 1; it.sprint = false;
        const t = this.ms();
        pressButton(it.secondary, t); releaseButton(it.secondary, t);
        this.play = 'returned';
        return;
      }
      case 'returned':
        // the original passer has the ball again (control came back): shoot 0.5 s after his catch
        if (this.passer === me) {
          if (w.time - me.cx.catchT >= RETURN_SHOOT_T) { this.passer = null; this.play = 'done'; this.pressShoot(w); } else this.stop();
        } else this.stop();
        return;
      case 'wait':
        // the pass did not leave (e.g. no clear target): shoot instead
        if (this.phaseT > 1.0) { this.play = 'done'; this.pressShoot(w); } else this.stop();
        return;
      default:
        // after the play (offensive rebound / a kept ball): a new play
        if (w.time - me.cx.catchT >= PLAY_DELAY) { this.play = ''; this.passer = null; }
        this.stop();
    }
  }

  /** Scripted v1 cases A1 (drive) / A4 (pullup). */
  scripted(me, w) {
    const d = dist(me.pos.x, me.pos.z, RIM.x, RIM.z);
    if (this.mode === 'drive') {
      if (d <= DRIVE_SHOOT_D) { this.pressShoot(w); return; }
      this.stickTo(me, RIM.x, RIM.z, true);
      return;
    }
    if (this.phase === 0) {
      if (d <= PULLUP_D) { this.phase = 1; this.phaseT = 0; this.stop(); return; }
      this.stickTo(me, RIM.x, RIM.z, true);
      return;
    }
    if (this.phase === 1) {
      this.stop();
      this.phaseT += FIXED_DT;
      if (this.phaseT >= PULLUP_WAIT - 1e-9) { this.phase = 2; this.pressShoot(w); }
    }
  }

  nearestDef(me, w) {
    const ps = w.players;
    let best = Infinity;
    for (let i = 0; i < ps.length; i++) {
      const o = ps[i];
      if (o.team === me.team) continue;
      const d = dist(o.pos.x, o.pos.z, me.pos.x, me.pos.z);
      if (d < best) best = d;
    }
    return best;
  }

  openMate(me, w) {
    const ps = w.players;
    let best = null, bestOpen = -1;
    for (let i = 0; i < ps.length; i++) {
      const q = ps[i];
      if (q === me || q.team !== me.team) continue;
      const open = this.nearestDef(q, w);
      if (open > bestOpen) { bestOpen = open; best = q; }
    }
    return best;
  }

  /** Defence (§5.14 bots): the man's gap point, BLOCK on half his shots, STEAL every 2.5 s in range. */
  defenceStep(me, w, dt) {
    const it = this.intent;
    if (it.primary.held) releaseButton(it.primary, this.ms());
    this.stealCd -= dt;
    const man = me.defAssign && me.defAssign.team === w.offense ? me.defAssign : null;
    if (!man) { this.stop(); return; }
    // planned block tap
    const s = man.shot;
    if (s.active && !s.launched && this.blockShot !== s.pressT) {
      this.blockShot = s.pressT;
      this.blockAt = this.rng.next() < BLOCK_P ? s.pressT + s.tIdeal - me.attrs.airtime * 0.5 + this.rng.gauss(0, BLOCK_SIGMA) : -1;
    }
    if (this.blockAt >= 0 && w.time + FIXED_DT >= this.blockAt) {
      this.blockAt = -1;
      if (me.canAct) { const t = this.ms(); pressButton(it.primary, t); releaseButton(it.primary, t); }
    }
    // gap point (normal defGap)
    const rx = RIM.x - man.pos.x, rz = RIM.z - man.pos.z, rl = Math.sqrt(rx * rx + rz * rz) || 1;
    const gap = Math.min(onBallGap(me, man, DIFFICULTY.normal.defGap), Math.max(0, rl - 0.3));
    const tx = man.pos.x + rx / rl * gap, tz = man.pos.z + rz / rl * gap;
    const d = dist(me.pos.x, me.pos.z, tx, tz);
    if (d < 0.08) this.stop();
    else { it.move.x = (tx - me.pos.x) / d; it.move.z = (tz - me.pos.z) / d; it.move.mag = d < 1 ? d : 1; it.sprint = d > 2.5; }
    // steal tap every 2.5 s within range of a dribbler
    if (this.stealCd <= 0 && man.dribbling && dist(me.pos.x, me.pos.z, man.pos.x, man.pos.z) <= me.attrs.stealRange && me.canAct) {
      this.stealCd = STEAL_EVERY;
      const t = this.ms(); pressButton(it.tertiary, t); releaseButton(it.tertiary, t);
    }
  }
}
