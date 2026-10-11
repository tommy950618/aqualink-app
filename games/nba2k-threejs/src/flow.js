/**
 * @module flow
 * Screen / state flow and the presentation router of LEGENDS 3v3 (spec v2 §1.3, §1.4.1, §1.4.2, §5.12, §6.4, §6.5).
 *
 *   new Flow(app)   app = everything main.js built: { game, lib, characters ({id: Character} | null), humanoids
 *                   ({id: humanoid} | null, simplified mode), simplified, scene, renderer, quality, director, lights,
 *                   arena, hoop, crowd, fx, ballVis, blobs, floor, decal, stripe, audio, input, settings, screens, hud,
 *                   present, match, recorder, triggers, replayPlayer, params, lineup }
 *
 * Owns:
 *  - the flow MENU (title) → LINEUP → INTRO → CHECK/LIVE/DEAD … → HALFTIME → GAME_OVER → rematch / lineup / menu,
 *    pause / resume (1.0 s countdown in game.js), quick game, the lineup screen's 3D side (arc placement, 0.6 s swap jog,
 *    setKit at the midpoint, turntable, §1.4.2), the intro timeline cues (§6.4.4) and instant replays inside DEAD
 *    (§6.4.6, game-winners after the final buzzer);
 *  - the event router (§1.4.1): game.js only emits; every presentation sink (captions, HUD banner, audio, crowd audio,
 *    crowd visual, jumbotron, LED boards, net / rim, camera director, replay triggers, fx) is called from here;
 *  - the per-frame presentation pass (§1.3 steps 4–9): render-root interpolation of the six, animator evaluation or
 *    replay playback, the replay recorder, ball visual, director, character culling / LOD, lights, blobs, crowd,
 *    arena, hoop / net, fx, back-court stripe, planar reflection; simplified-mode humanoid posing.
 * Zero allocation in fixedStep / frame (H10): scratch objects only; events allocate nothing except on rare cues.
 */
import * as THREE from '../vendor/three.module.js';
import { CLOCK } from './constants.js';
import { lerp, lerpAngle, wrapAngle, clamp } from './math.js';
import { t, pick } from './i18n.js';
import { LEGENDS, TEAM_UI } from './legends.js';
import { resolveKitModes, teamNames, normalizeLineup, resetLineup } from './lineup.js';
import { introShots, INTRO_SPOTS, MATCHUP_SPOTS, TITLE_SPOTS, LINEUP_SPOTS } from './cam/shots.js';
import { REPLAY, EVT } from './cam/replay.js';
import { thudWeight, squeakIntensity, BASE_CLUTCH, BASE_NORMAL } from './audio.js';
import { SOCK } from './anim/rig.js';
import { EV, FX, clipIndex } from './anim/clip.js';
import { LineupScreen } from './ui/lineup.js';

const RAD2DEG = 180 / Math.PI;
const SWAP_T = 0.6;                 // §5.12.2 swap jog seconds
const JOG_MAX = 4.5, WALK = 2.2, WALK_ACC = 8;   // walker speeds (m/s), acceleration (m/s²)
const DUNK_PUSH_HOLD = 0.5;         // dunk push off at SLAM + 0.5 s (§1.4.1)
const ROUTED_REPLAY = { takeoff: 1, release: 1, slam: 1, score: 1, block: 1, steal: 1, buzzer: 1, ankle: 1, ball: 1 };
/** Intro showcase loop per legend (§6.4.4 "showcase loop"; LeBron's chalk toss gets the chalk burst). */
const SHOWCASE_CLIP = {
  kobe: 'cel.kobe.jawJut', jordan: 'cel.jordan.shrug', lebron: 'cel.lebron.chalk', giannis: 'cel.giannis.chestThump',
  yao: 'cel.yao.fistPump', kyrie: 'cel.kyrie.skyPoint',
};
const PLAY_STATES = { CHECK: 1, LIVE: 1, DEAD: 1 };
/** Above this speed (m/s) an off-ball player keeps the full animation rate on low / medium (§4.14 30 Hz players). */
const HALF_RATE_MAX_SPEED = 2.5;
/** Game-over stand-off spots of the five non-MVP legends (≥ 4.5 m from the MVP at (0, −5.6)). */
const GAMEOVER_SPOTS = [[-5.0, -8.6], [-2.6, -10.6], [2.6, -10.6], [5.0, -8.6], [0, -11.6]];

// ---------------------------------------------------------------------------------------------------- scratch
const V = new THREE.Vector3();
const HEAD = new THREE.Vector3();
const POSE_P = { t: 0, dt: 0, speed: 0, f: 0, ballY: 1, handSign: 1, jumpY: 0, releaseAge: 0 };
const KIT_TMP = { a: 'classic', b: 'classic' };
const TEAM_TMP = { a: 'dark', b: 'bright' };

function idsOf(l) { return [l.a[0], l.a[1], l.a[2], l.b[0], l.b[1], l.b[2]]; }

export class Flow {
  constructor(app) {
    this.app = app;
    const a = app;
    this.game = a.game;
    this.world = a.game.world;
    this.simplified = !!a.simplified;
    this.lineup = normalizeLineup(a.lineup) || resetLineup();
    this.players = this.game.players;
    this.index = Object.create(null);
    for (let i = 0; i < 6; i++) this.index[this.players[i].id] = i;
    // per-player presentation state
    this.walk = [];
    for (let i = 0; i < 6; i++) this.walk.push({ active: false, x: 0, z: 0, yaw: 0, speed: WALK, v: 0, kit: null, kitD: 0, d0: 0, settle: true });
    this.kitQueue = [];
    this.focusId = null;
    this.screenMode = 'boot';         // boot | title | lineup | intro | game | gameover
    this.introPaused = false;
    this.pausedView = false;          // pause menu shown
    this.bannerStash = null;
    this.pendingHold = 0;
    this.dunkPushT = -1;
    this.gameOverData = null;
    this.gameOverPending = false;
    this.lastCaptionName = null;
    this.chantOn = false; this.clutchOn = false;
    this.shotClockShown = -2;
    this.scoreShown = [-1, -1];
    this.firstLive = true; this.firstDefence = true;
    this.liveData = {
      a: { abbr: '', score: 0, colour: '#6F263D' }, b: { abbr: '', score: 0, colour: '#CE1141' },
      period: '', clock: 0, shotClock: null, leaders: [{ short: '', pts: 0 }, { short: '', pts: 0 }],
    };
    this._periodQ = -1; this._periodLang = '';
    this.lastShooterTeam = -1;
    // event router (§1.4.1)
    this.game.on('*', (e, type) => this.onEvent(e, type));
    // replay cues
    if (a.replayPlayer) a.replayPlayer.onCue = (name, x, y) => this.onReplayCue(name, x, y);
    // intro cues
    a.director.intro.onCue = (type, shot) => this.onIntroCue(type, shot);
    // UI callbacks
    a.screens.setCallbacks({
      onPlay: () => this.toLineup(), onQuick: () => this.quickGame(), onResume: () => this.resume(), onQuit: () => this.quit(),
      onRematch: () => this.rematch(), onLineup: () => this.toLineup(), onHalftimeSkip: () => this.game.skipHalftime(),
    });
    a.present.setCallbacks({
      onSkipLegend: () => { if (!this.introPaused) a.director.intro.skipShot(); },
      onSkipIntro: () => { if (!this.introPaused) a.director.intro.skipAll(); },
      onSkipReplay: () => { if (a.replayPlayer) a.replayPlayer.skip(); },
    });
    this.lineupScreen = new LineupScreen(document.getElementById('screenLineup'), {
      lineup: this.lineup, legends: LEGENDS, match: a.match, seed: a.params.seed, persist: !a.params.lineupFromUrl,
      onSwap: (i, j, l) => this.onLineupChange(l, i, j),
      onSelect: (id) => this.onLineupSelect(id),
      onUser: (u, l) => this.onLineupChange(l, -1, -1),
      onKits: (m, l) => this.onLineupChange(l, -1, -1),
      onShuffle: (l) => this.onLineupChange(l, -1, -1),
      onReset: (l) => this.onLineupChange(l, -1, -1),
      onStart: (l) => { this.lineup = normalizeLineup(l) || this.lineup; this.startMatch(this.introVariant(false)); },
      onBack: () => this.toTitle(false),
      onDrag: (dx) => a.director.turntable.drag(dx),
      onRelease: (vx) => a.director.turntable.release(vx),
    });
    // kits setting ↔ lineup.kits (C17: one stored value)
    a.settings.bindExternal('kits', {
      get: () => this.lineup.kits,
      set: (v) => {
        const l = normalizeLineup(Object.assign({}, this.lineup, { kits: v }));
        if (l) { this.lineup = l; this.lineupScreen.setLineup(l); this.applyKits(false); }
      },
    });
    this.applyMatchView();
  }

  // ================================================================================================ helpers
  character(i) { const c = this.app.characters; return c ? c[this.players[i].id] : null; }
  charOf(id) { const c = this.app.characters; return c ? c[id] || null : null; }
  slotIds() { return idsOf(this.lineup); }
  get paused() { return this.game.paused || this.introPaused; }
  get portrait() { const d = this.app.director; return d.width < d.height; }

  introVariant(rematch) {
    const v = this.app.settings.get('intro');
    if (v === 'off') return 'off';
    if (rematch) return 'short';
    return v === 'short' ? 'short' : 'full';
  }

  applyMatchView() {
    const l = this.lineup;
    resolveKitModes(l, KIT_TMP); teamNames(l, TEAM_TMP);
    this.app.match.set({ lineup: l, teams: { a: TEAM_TMP.a, b: TEAM_TMP.b }, kits: { a: KIT_TMP.a, b: KIT_TMP.b } });
    const ua = TEAM_UI[TEAM_TMP.a], ub = TEAM_UI[TEAM_TMP.b];
    const user = l.user === 'b' ? 1 : 0;
    const uc = user === 0 ? ua.bg : ub.bg, oc = user === 0 ? ub.bg : ua.bg;
    if (this.app.crowd && this.app.crowd.setTeamColours) this.app.crowd.setTeamColours(uc, oc);
    if (this.app.fx && this.app.fx.ring) this.app.fx.ring.setColour(uc);
    const d = this.liveData;
    d.a.colour = ua.bg; d.b.colour = ub.bg;
  }

  /** Kit mode of every legend from the lineup; immediate (setKit now) or queued one per frame. */
  applyKits(immediate) {
    resolveKitModes(this.lineup, KIT_TMP);
    const ids = this.slotIds();
    for (let k = 0; k < 6; k++) {
      const mode = k < 3 ? KIT_TMP.a : KIT_TMP.b;
      this.setKitOf(ids[k], mode, immediate);
    }
    this.applyMatchView();
  }

  setKitOf(id, mode, immediate) {
    if (this.simplified) { this.app.recolour(id, mode); return; }
    const c = this.charOf(id);
    if (!c || c.kitMode === mode) return;
    if (immediate) c.setKit({ mode });
    else {
      for (let i = 0; i < this.kitQueue.length; i++) if (this.kitQueue[i].id === id) { this.kitQueue[i].mode = mode; return; }
      this.kitQueue.push({ id, mode });
    }
  }

  setLodMode(mode) {
    const cs = this.app.characters;
    if (!cs) return;
    for (const id in cs) { cs[id].lodMode = mode; cs[id].hidden = false; }
  }

  clearYawOverrides() {
    for (let i = 0; i < 6; i++) { const an = this.players[i].animator; if (an.setYawOverride) an.setYawOverride(null); }
  }

  /** Teleport a player (no sim) to (x, z, yaw) and stop his walker. */
  place(id, x, z, yaw) {
    const i = this.index[id];
    this.game.teleport(id, x, z, yaw);
    const w = this.walk[i];
    w.active = false; w.x = x; w.z = z; w.yaw = yaw; w.v = 0;
    const an = this.players[i].animator;
    if (an.crossfade) an.crossfade(0.2);
  }

  walkTo(id, x, z, yaw, speed, kitMode) {
    const i = this.index[id], p = this.players[i], w = this.walk[i];
    const d = Math.hypot(x - p.pos.x, z - p.pos.z);
    w.x = x; w.z = z; w.yaw = yaw; w.speed = speed > 0 ? speed : WALK; w.active = d > 0.02 || Math.abs(wrapAngle(yaw - p.yaw)) > 0.02;
    w.d0 = d; w.kit = kitMode || null;
  }

  // ================================================================================================ screens
  /** MENU: the six in the title arc; title screen. `snap` places them at once (boot). */
  toTitle(snap) {
    const a = this.app, g = this.game;
    this.endPauseView();
    this.hideReplay();
    this.screenMode = 'title';
    if (g.world.state !== 'MENU') g.quit();
    a.hud.captions.clear();
    this.focusId = null;
    this.clearYawOverrides();
    this.setLodMode('menu');
    a.present.intro(false);
    a.screens.show('title');
    a.director.setMode('title', { transition: snap ? 'cut' : 'ease' });
    a.lights.setPreset('play', snap ? 0 : 0.6);
    a.arena.jumbo.setMode('title', {});
    a.arena.led.message('led.brand');
    a.crowd.excite(0.15, 1e6);
    a.audio.crowdAudio.setBase(BASE_NORMAL);
    const ids = this.slotIds();
    for (let k = 0; k < 6; k++) {
      const s = TITLE_SPOTS[k];
      if (snap) this.place(ids[k], s.x, s.z, s.yaw); else this.walkTo(ids[k], s.x, s.z, s.yaw, WALK, null);
    }
    if (a.hoop) a.hoop.setShotClock(null);
  }

  /** LINEUP: lineup screen + the six on the lineup arc (§1.4.2). */
  toLineup() {
    const a = this.app, g = this.game;
    this.endPauseView();
    this.hideReplay();
    this.screenMode = 'lineup';         // set first: the MENU state event of quit() must not bounce to the title
    if (g.world.state !== 'MENU') g.quit();
    g.enterLineup();
    a.hud.captions.clear();
    this.screenMode = 'lineup';
    this.setLodMode('menu');
    a.audio.select();
    this.lineupScreen.setLineup(this.lineup);
    a.screens.show('lineup');
    a.arena.jumbo.setMode('lineup', {});
    const ids = this.slotIds();
    for (let k = 0; k < 6; k++) { const s = LINEUP_SPOTS[k]; this.walkTo(ids[k], s.x, s.z, s.yaw, WALK, null); }
    this.applyKits(false);
    this.focusLineup(this.portrait ? this.handlerId() : null);
  }

  handlerId() { return this.lineup.user === 'b' ? this.lineup.b[0] : this.lineup.a[0]; }

  focusLineup(id) {
    const a = this.app;
    const prev = this.focusId;
    if (prev && prev !== id) { const pi = this.index[prev]; const an = this.players[pi].animator; if (an.setYawOverride) an.setYawOverride(null); }
    this.focusId = id;
    const cs = a.characters;
    if (id && cs) {
      const c = cs[id];
      a.director.setMode('lineup', { focus: c.object, h: c.dims.heightBarefoot, focusId: id, yawDeg: 0 });
    } else if (id && this.simplified) {
      const p = this.players[this.index[id]];
      a.director.setMode('lineup', { focus: p.pos, h: LEGENDS[id].stats.barefootM, focusId: id, yawDeg: 0 });
    } else {
      a.director.setMode('lineup', { focus: null });
    }
    // portrait: only the focused legend is shown (the stage is a single turntable)
    if (cs) for (const k in cs) cs[k].hidden = !!(id && this.portrait && k !== id);
  }

  onLineupSelect(id) {
    if (this.screenMode !== 'lineup') return;
    if (id) this.focusLineup(id);
    else this.focusLineup(this.portrait ? this.handlerId() : null);
  }

  /** A lineup change from the screen: swap jog for (i, j), walks for everyone else; kits at the midpoint. */
  onLineupChange(l, i, j) {
    const next = normalizeLineup(l);
    if (!next) return;
    this.lineup = next;
    resolveKitModes(next, KIT_TMP);
    const ids = this.slotIds();
    for (let k = 0; k < 6; k++) {
      const id = ids[k], s = LINEUP_SPOTS[k], p = this.players[this.index[id]];
      const d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z);
      const mode = k < 3 ? KIT_TMP.a : KIT_TMP.b;
      const swapping = k === i || k === j;
      const speed = swapping || d > 0.05 ? clamp(d / SWAP_T, WALK, JOG_MAX) : WALK;
      this.walkTo(id, s.x, s.z, s.yaw, speed, d > 0.05 ? mode : null);
      if (d <= 0.05) this.setKitOf(id, mode, false);
    }
    this.applyMatchView();
    if (this.portrait) this.focusLineup(this.focusId && this.focusId !== this.handlerId() && i < 0 ? this.focusId : this.handlerId());
  }

  // ================================================================================================ match
  quickGame() {
    this.startMatch(this.app.params.quick ? 'off' : 'short');
  }

  /** Applies the lineup and options and starts a game with the intro variant ('full' | 'short' | 'off'). */
  startMatch(variant) {
    const a = this.app, g = this.game, s = a.settings;
    this.endPauseView();
    this.hideReplay();
    a.screens.show('intro');
    this.screenMode = 'intro';          // set first: the MENU state event of quit() must not bounce to the title
    if (g.world.state !== 'MENU' && g.world.state !== 'LINEUP') g.quit();
    g.setLineup(this.lineup);
    g.setRules({ clear: !!s.get('clear'), autoSwitch: s.get('autoSwitch') !== false });
    g.setDifficulty(s.get('difficulty') || 'normal');
    a.hud.captions.clear();
    a.recorder.reset();
    a.triggers.resetGame();
    a.triggers.setMode(this.simplified ? 'off' : s.get('replays'));
    a.triggers.quarterSec = s.get('quarter') || CLOCK.DEFAULT_Q;
    this.applyKits(true);
    this.kitQueue.length = 0;
    this.gameOverData = null; this.gameOverPending = false;
    this.scoreShown[0] = -1; this.scoreShown[1] = -1; this.shotClockShown = -2;
    this.focusId = null;
    this.clearYawOverrides();
    this.setLodMode('auto');
    for (let i = 0; i < 6; i++) this.walk[i].active = false;
    const opts = { quarterSec: s.get('quarter') || CLOCK.DEFAULT_Q, difficulty: s.get('difficulty') || 'normal', auto: !!a.params.auto, intro: variant !== 'off' };
    g.start(opts);
    a.crowd.excite(0.3, 2);
    if (variant === 'off') return;   // state event CHECK finishes the hand-off
    const l = this.lineup;
    for (let k = 0; k < 3; k++) {
      const sa = INTRO_SPOTS.a[k], sb = INTRO_SPOTS.b[k];
      this.place(l.a[k], sa.x, sa.z, sa.yaw);
      this.place(l.b[k], sb.x, sb.z, sb.yaw);
    }
    const heights = {};
    for (let k = 0; k < 6; k++) { const id = this.slotIds()[k]; const c = this.charOf(id); heights[id] = c ? c.dims.heightBarefoot : LEGENDS[id].stats.barefootM; }
    a.present.intro(true);
    a.screens.show('intro');
    a.lights.setPreset('intro', 0);
    a.director.setMode('intro', { shots: introShots(l, { variant, heights }), transition: 'cut' });
  }

  rematch() {
    this.startMatch(this.introVariant(true));
  }

  quit() {
    this.endPauseView();
    this.screenMode = 'quit';
    this.toTitle(false);  // quits the game (state MENU) and shows the title
  }

  onIntroCue(type, shot) {
    const a = this.app;
    if (type === 'end') { this.endIntro(); return; }
    if (!shot) return;
    a.present.hideLowerThird();
    if (shot.kind === 'crane') {
      a.lights.setPreset('intro', 0);
      a.arena.jumbo.setMode('title', {});
      a.audio.sting();
      a.audio.crowdAudio.react('intro');
      a.crowd.excite(0.6, 2.5);
    } else if (shot.kind === 'legend') {
      const id = shot.id, L = LEGENDS[id];
      a.lights.setSpotTarget(shot.spot.x, shot.chestY, shot.spot.z);
      a.present.lowerThird(id, shot.first);
      a.arena.jumbo.setMode('intro', { number: L.number, nameZh: L.name.zh, nameEn: L.name.en, ovr: L.ratings.overall,
        height: L.stats.heightM, colour: a.match.kitColours(id).bg });
      a.audio.boom();
      const ci = clipIndex(SHOWCASE_CLIP[id] || '');
      const p = this.players[this.index[id]];
      if (ci >= 0 && !this.simplified) p.animator.play(ci, { layer: 'action', blendIn: 0.2 });
      if (id === 'lebron') this.chalkAt = 0.9;
    } else if (shot.kind === 'team') {
      a.present.teamCard(shot.team);
      a.audio.boom();
    } else if (shot.kind === 'matchup') {
      const l = this.lineup;
      for (let k = 0; k < 3; k++) {
        const ma = MATCHUP_SPOTS.a[k], mb = MATCHUP_SPOTS.b[k];
        this.place(l.a[k], ma.x, ma.z, ma.yaw);
        this.place(l.b[k], mb.x, mb.z, mb.yaw);
      }
      a.lights.setPreset('play', 0.6);
      a.present.matchup();
      a.audio.whoosh();
      a.crowd.excite(0.7, 2);
    }
  }

  endIntro() {
    const a = this.app;
    a.present.intro(false);
    for (let i = 0; i < 6; i++) this.players[i].animator.stopAction(0.1);
    this.introPaused = false;
    if (this.game.world.state === 'INTRO') this.game.endIntro();
  }

  // ================================================================================================ pause
  togglePause() {
    if (this.pausedView) this.resume(); else this.pause();
  }

  pause() {
    const a = this.app, g = this.game, st = g.world.state;
    if (this.pausedView) return;
    if (st === 'INTRO') this.introPaused = true;
    else if (PLAY_STATES[st]) { if (!g.pause()) return; } else return;
    this.pausedView = true;
    this.bannerStash = a.hud.bannerState();
    a.screens.pause(true);
    a.audio.suspend();
    a.quality.clearWindow();
    if (st !== 'INTRO' && !(a.replayPlayer && a.replayPlayer.started)) {
      a.director.setMode('pause', { transition: 'ease', seconds: 0.6 });
      a.lights.setPreset('pause', 0.6);
    }
  }

  resume() {
    const a = this.app, g = this.game;
    if (!this.pausedView) return;
    this.pausedView = false;
    a.screens.pause(false);
    a.audio.resume();
    a.quality.clearWindow();
    if (this.introPaused) { this.introPaused = false; return; }
    g.resume();
    if (a.replayPlayer && a.replayPlayer.started) return;
    a.director.setMode('broadcast', { transition: 'cut' });
    a.lights.setPreset('play', 0.3);
    this.resumeBanner = true;
  }

  endPauseView() {
    if (this.pausedView) { this.pausedView = false; this.app.screens.pause(false); this.app.audio.resume(); }
    this.introPaused = false;
    this.resumeBanner = false;
  }

  /** Tab hidden: pause the game / intro and never auto-resume (§6.6 visibility). */
  onHidden() {
    if (!this.pausedView) this.pause();
  }

  // ================================================================================================ replay
  hideReplay() {
    const rp = this.app.replayPlayer;
    if (rp && rp.busy) { rp.skip(); if (rp.busy) rp._finish('cancel'); }
    this.app.present.replay('none');
  }

  onReplayCue(name, x, y) {
    const a = this.app;
    switch (name) {
      case 'wipeIn': a.present.replay('wipeIn'); a.audio.wipe(); break;
      case 'on': {
        a.present.replay('on');
        a.director.setMode('replay', { source: a.replayPlayer, transition: 'cut' });
        const f = a.replayPlayer.focus;
        a.arena.jumbo.setMode('replay', { name: f >= 0 ? pick(LEGENDS[this.players[f].id].short) : '' });
        a.lights.setPreset('replay', 0);
        a.screens.show('replay');
        a.audio.setSlow(true);
        break;
      }
      case 'event': {
        const code = x;
        if (code === EVT.slam) { a.audio.rim(1, 'grab'); a.hoop.net.impulse('slam', 1); }
        else if (code === EVT.rim) { a.audio.rim(0.6, 'clank'); a.hoop.net.impulse('rim', 0.6); }
        else if (code === EVT.swish) { a.audio.net('swish'); a.hoop.net.impulse('swish', 1); }
        break;
      }
      case 'off': a.present.replay('off', !!x); a.audio.wipe(); break;
      case 'done': case 'cancel': {
        a.present.replay('none');
        a.audio.setSlow(false);
        const cs = a.characters;
        if (cs) for (const k in cs) cs[k].lodOverride = null;
        a.lights.setPreset('play', 0);
        a.arena.jumbo.setMode('live', this.liveData);
        if (this.gameOverPending) { this.gameOverPending = false; this.showGameOver(); break; }
        if (PLAY_STATES[this.game.world.state] || this.game.world.state === 'QUARTER_END') {
          a.screens.show('game');
          if (!this.pausedView) a.director.setMode('broadcast', { transition: 'cut' });
        }
        break;
      }
      default: break;
    }
  }

  // ================================================================================================ events (§1.4.1)
  onEvent(e, type) {
    const a = this.app, g = this.game, w = this.world;
    // replay ring + triggers first (payloads are pooled: read now)
    if (ROUTED_REPLAY[type] && a.triggers && !this.simplified) {
      const r = a.triggers.onGameEvent(e, type);
      if (r.start && a.replayPlayer && !a.replayPlayer.busy) {
        if (r.deferred) a.replayPlayer.schedule(r);
        else if (a.replayPlayer.schedule(r)) { if (w.state === 'DEAD') g.holdDead(g.deadT + REPLAY.HOLD_DEAD); else this.pendingHold = REPLAY.HOLD_DEAD; }
      }
    }
    switch (type) {
      case 'caption':
        if (e.priority >= 3 && e.params.name) this.lastCaptionName = e.params.name;
        a.hud.captions.push(e.key, e.params, e.priority);
        break;
      case 'banner':
        if (e.key === 'banner.plus') { e.params.name = this.lastCaptionName; a.hud.banner(e.key, e.params, e.ms); e.params.name = null; }
        else a.hud.banner(e.key, e.params, e.ms);
        break;
      case 'state': this.onState(e.from, e.to); break;
      case 'shot':
        this.lastShooterTeam = e.team;
        if (g.inClutch(e.team)) a.audio.crowdAudio.anticipate();
        if (e.team === w.user && !w.auto) {
          if (e.kind === 'fade' || e.kind === 'turnFade') a.present.tipOnce('tip.fade');
        }
        break;
      case 'pumpFake': break;
      case 'takeoff':
        if (e.kind === 'dunk') { a.director.dunkPush(true); this.dunkPushT = -1; }
        break;
      case 'slam':
        a.hoop.rim.shake(0);
        a.hoop.net.impulse('slam', 1);
        a.audio.rim(1, 'grab');
        a.audio.net('snap');
        a.director.shake(0.03, 0.25, 12);
        this.dunkPushT = DUNK_PUSH_HOLD;
        break;
      case 'land': {
        const wgt = thudWeight(e.massKg, e.dropH);
        if (wgt > 0) a.audio.thud(wgt, e.x, e.z);
        break;
      }
      case 'plant': {
        const i = squeakIntensity(e.decel, e.turnRate * RAD2DEG);
        if (i > 0) a.audio.squeak(i, e.x, e.z, e.playerId);
        break;
      }
      case 'ball': this.onBallEvent(e); break;
      case 'score': this.onScore(e); break;
      case 'miss':
        if (e.airball) a.audio.crowdAudio.react('airball');
        if (a.audio.crowdAudio.anticipating) a.audio.crowdAudio.resolveAnticipation('aww');
        break;
      case 'block':
        a.audio.block(e.x, e.z);
        a.crowd.excite(0.8, 2.0);
        a.audio.crowdAudio.react(e.chaseDown ? 'chaseDown' : 'block');
        a.arena.jumbo.setMode('event', { kind: 'block', name: this.shortOf(e.blockerId || e.playerId), number: this.numberOf(e.blockerId || e.playerId), colour: this.teamColour(e.team) });
        a.arena.led.takeover(t('jumbo.block'), this.teamColour(e.team), 2.0);
        if (a.audio.crowdAudio.anticipating) a.audio.crowdAudio.resolveAnticipation(null);
        break;
      case 'steal': case 'intercept': case 'deflect':
        a.crowd.excite(0.4, 1.0);
        break;
      case 'ankle':
        a.crowd.excite(0.9, 2.0);
        a.audio.crowdAudio.react('ankle');
        a.director.shake(0.04, 0.15, 14);
        break;
      case 'possession':
        if (!w.auto) a.arena.led.message(w.offense === w.user ? 'led.noise' : 'led.defense');
        break;
      case 'turnover':
        if (e.reason === 'shotClock') a.audio.shotHorn(); else a.audio.whistle();
        break;
      case 'clock':
        if (e.what === 'game' || (e.what === 'shot' && w.offense === w.user)) a.audio.tick();
        break;
      case 'buzzer':
        if (e.kind === 'period') { a.audio.horn(); a.hoop.flashStrip(1.0); } else a.audio.shotHorn();
        break;
      case 'gameover': this.onGameOver(e); break;
      default: break;
    }
  }

  shortOf(id) { const L = LEGENDS[id]; return L ? pick(L.short) : ''; }
  numberOf(id) { const L = LEGENDS[id]; return L ? L.number : 0; }
  teamColour(team) { return team === 1 ? this.liveData.b.colour : this.liveData.a.colour; }

  onBallEvent(e) {
    const a = this.app, s = e.strength > 0 ? e.strength : 0.5;
    switch (e.what) {
      case 'bounce': case 'floor': a.audio.bounce(s, e.x, e.z); break;
      case 'rim': a.audio.rim(s, s > 0.5 ? 'clank' : 'tap'); a.hoop.net.impulse('rim', Math.min(1, s)); a.hoop.rim.shake(0); break;
      case 'board': a.audio.board(s > 0.4 ? 'bank' : 'thud'); break;
      case 'swish': a.audio.net('swish'); a.hoop.net.impulse('swish', 1); break;
      case 'rimIn': a.audio.net('rimIn'); a.hoop.net.impulse('rim', 0.6); break;
      default: break;
    }
  }

  onScore(e) {
    const a = this.app, w = this.world;
    const user = e.team === w.user && !w.auto;
    const dunk = e.kind === 'dunk';
    const three = e.points === 3;
    const winner = e.winner >= 0;
    let level = dunk ? 1.0 : three ? 0.8 : 0.6;
    if (!user && !w.auto) level *= 0.55;
    if (winner) level = 1.0;
    a.crowd.excite(level, winner ? 6.0 : dunk ? 2.5 : 1.5);
    const ca = a.audio.crowdAudio;
    if (ca.anticipating) ca.resolveAnticipation('cheer');
    ca.react(winner ? 'winner' : dunk ? 'dunk' : (!user && !w.auto) ? 'cpuMake' : three ? 'make3' : 'make2');
    if (dunk || three || winner) {
      const kind = winner ? 'winner' : dunk ? 'dunk' : 'three';
      a.arena.jumbo.setMode('event', { kind, name: this.shortOf(e.playerId), number: this.numberOf(e.playerId), colour: this.teamColour(e.team) });
      a.arena.led.takeover(t('jumbo.' + kind), this.teamColour(e.team), 2.5);
      a.fx.flash(kind);
    }
  }

  onState(from, to) {
    const a = this.app, g = this.game, w = this.world;
    if (to === 'CHECK') {
      // pending quality tier applies at the start of CHECK (§7.3), then the programs are compiled
      if (a.quality.commitPendingTier() && a.renderer) a.renderer.compile(a.scene, a.director.camera);
      if (from === 'INTRO' || from === 'MENU' || from === 'LINEUP' || from === 'HALFTIME' || from === 'QUARTER_END' || from === 'CHECK' || this.screenMode !== 'game') {
        this.screenMode = 'game';
        a.present.intro(false);
        a.screens.halftime(null);
        a.screens.show('game');
        if (!(a.replayPlayer && a.replayPlayer.started)) a.director.setMode('broadcast', { transition: 'cut' });
        a.lights.setPreset('play', from === 'INTRO' ? 0.6 : 0);
        a.arena.jumbo.setMode('live', this.liveData);
        a.audio.crowdAudio.setBase(BASE_NORMAL);
      }
      a.input.setOffense(g.userIsOffense());
    } else if (to === 'LIVE') {
      if (!w.auto) {
        if (this.firstLive && g.userIsOffense()) { this.firstLive = false; a.present.tipOnce('tip.pumpFake'); }
        if (this.firstDefence && !g.userIsOffense()) { this.firstDefence = false; a.present.tipOnce('tip.block'); }
      }
    } else if (to === 'DEAD') {
      if (this.pendingHold > 0) { g.holdDead(g.deadT + this.pendingHold); this.pendingHold = 0; }   // DEAD(MADE) 1.5 + 2.9 s
    } else if (to === 'HALFTIME') {
      a.hud.banner(null);
      a.screens.halftime({ score: [g.score[0], g.score[1]], box: this.boxRows() });
      a.director.setMode('halftime', { transition: 'ease' });
      a.crowd.excite(0.3, 3);
    } else if (to === 'MENU') {
      if (this.screenMode === 'game' || this.screenMode === 'gameover') this.toTitle(false);   // a quit from elsewhere (hooks, tests)
    }
  }

  boxRows() {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const p = this.players[i], s = p.stats;
      out.push({ id: p.id, team: p.team, index: p.index, pts: s.pts, fgm: s.fgm, fga: s.fga, tpm: s.tpm, tpa: s.tpa, reb: s.reb, ast: s.ast, stl: s.stl, blk: s.blk });
    }
    return out;
  }

  onGameOver(e) {
    const a = this.app, g = this.game;
    const rows = [];
    for (let i = 0; i < e.box.length; i++) rows.push(Object.assign({}, e.box[i]));
    this.gameOverData = { winner: e.winner, score: [g.score[0], g.score[1]], box: rows, mvpId: e.mvpId };
    a.crowd.excite(e.winner >= 0 ? 1.0 : 0.6, 6.0);
    a.audio.crowdAudio.applause(3.0);
    a.arena.led.message('led.gg');
    const rp = a.replayPlayer;
    if (rp && rp.phase === 'armed') { this.gameOverPending = true; rp.begin(); return; }
    if (rp && rp.busy) { this.gameOverPending = true; return; }
    this.showGameOver();
  }

  showGameOver() {
    const a = this.app, d = this.gameOverData;
    if (!d) return;
    this.screenMode = 'gameover';
    a.screens.gameOver(d);
    const id = d.mvpId || (a.screens.mvp && a.screens.mvp.id) || this.players[0].id;
    const p = this.players[this.index[id]];
    const c = this.charOf(id);
    const h = c ? c.dims.heightBarefoot : LEGENDS[id].stats.barefootM;
    // the MVP takes centre stage; the other five step back so the 3.2 m orbit never passes through a body
    this.place(id, 0, -5.6, 0);
    for (let i = 0; i < 6; i++) this.players[i].offense = true;     // everyone stands up (no defensive crouch)
    const cel = clipIndex(SHOWCASE_CLIP[id] || '');
    if (cel >= 0 && !this.simplified) p.animator.play(cel, { layer: 'action', blendIn: 0.2 });
    let k = 0;
    for (let i = 0; i < 6; i++) {
      const q = this.players[i];
      if (q.id === id) continue;
      const s = GAMEOVER_SPOTS[k++];
      this.place(q.id, s[0], s[1], Math.atan2(-s[0], -5.6 - s[1]));
    }
    a.director.setMode('gameover', { subject: c ? c.object : { x: p.pos.x, z: p.pos.z, yaw: p.yaw }, h, hold: 0, transition: 'cut' });
    a.lights.setPreset('gameover', 0.6);
    a.lights.setSpotTarget(p.pos.x, 0.72 * h, p.pos.z);
    const ld = this.liveData;
    a.arena.jumbo.setMode('gameover', { a: { abbr: ld.a.abbr, score: d.score[0] }, b: { abbr: ld.b.abbr, score: d.score[1] }, mvp: this.shortOf(id) });
    a.hoop.setShotClock(null);
  }

  // ================================================================================================ fixed step (non-sim states)
  /** Called once per fixed step after game.step: walkers and kinematic stepping while the game does not step. */
  fixedStep(dt) {
    const st = this.world.state;
    if (st !== 'MENU' && st !== 'LINEUP' && st !== 'INTRO') return;
    if (this.introPaused) return;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i], w = this.walk[i];
      let x = p.pos.x, z = p.pos.z, yaw = p.yaw;
      if (w.active) {
        const dx = w.x - x, dz = w.z - z, d = Math.sqrt(dx * dx + dz * dz);
        if (d > 0.02) {
          // accelerate / brake (8 m/s²) so the gait never sees a velocity jump
          const vmax = Math.min(w.speed, Math.sqrt(2 * WALK_ACC * d));
          w.v = w.v < vmax ? Math.min(vmax, w.v + WALK_ACC * dt) : vmax;
          const step = Math.min(d, w.v * dt);
          x += dx / d * step; z += dz / d * step;
          const hd = Math.atan2(dx, dz);
          yaw += clamp(wrapAngle(hd - yaw), -12 * dt, 12 * dt);
          if (w.kit && d - step <= 0.5 * w.d0) { this.setKitOf(p.id, w.kit, true); w.kit = null; }
        } else {
          x = w.x; z = w.z; w.v = 0;
          if (w.kit) { this.setKitOf(p.id, w.kit, true); w.kit = null; }
          const e = wrapAngle(w.yaw - yaw);
          yaw += clamp(e, -7 * dt, 7 * dt);
          if (Math.abs(e) < 0.01) { yaw = w.yaw; w.active = false; }
        }
      }
      p.offense = true;                       // menus / intro: everyone stands (no defensive crouch)
      p.stepKinematic(dt, x, z, yaw);
      const an = p.animator;
      for (let ev; (ev = an.events.next());) {
        if (ev.code === EV.FX && ev.param === FX.chalkBurst) {
          const c = this.character(i);
          if (c) { c.handWorld(V, 1); this.app.fx.chalkBurst(V); }
        }
      }
    }
    if (this.chalkAt > 0) {
      this.chalkAt -= dt;
      if (this.chalkAt <= 0) {
        const c = this.charOf('lebron');
        if (c) { c.handsMidWorld(V); V.y += 0.25; this.app.fx.chalkBurst(V); }
      }
    }
  }

  // ================================================================================================ frame
  /**
   * Presentation pass of one rendered frame (§1.3 steps 4–9). frameDt in seconds; alpha = sim interpolation.
   */
  frame(frameDt, alpha) {
    const a = this.app, g = this.game, w = this.world, st = w.state;
    const paused = this.paused;
    const dt = paused ? 0 : frameDt;
    const rp = a.replayPlayer;
    // queued kit repaints (one per frame)
    if (this.kitQueue.length && !paused) { const k = this.kitQueue.shift(); this.setKitOf(k.id, k.mode, true); }
    // dunk push hold
    if (this.dunkPushT > 0) { this.dunkPushT -= dt; if (this.dunkPushT <= 0) { this.dunkPushT = -1; a.director.dunkPush(false); } }
    // resume countdown finished → re-issue the stashed banner (R#22)
    if (this.resumeBanner && !g.paused) {
      this.resumeBanner = false;
      const s = this.bannerStash;
      if (s && s.key && s.key !== 'banner.resume') a.hud.banner(s.key, s.params, s.ms);
      this.bannerStash = null;
    }
    // ---- 4. animation / replay ----
    if (rp && rp.busy) rp.update(dt);
    const replaying = !!(rp && rp.busy && rp.started);
    if (replaying) {
      rp.apply();
      const cs = a.characters;
      if (cs) for (let i = 0; i < 6; i++) { const c = cs[this.players[i].id]; const l = rp.lod[i]; c.lodOverride = l < 0 ? null : l; }
    } else {
      const lowDetail = a.quality.tier !== 'high';
      for (let i = 0; i < 6; i++) {
        const p = this.players[i];
        const x = lerp(p.prevPos.x, p.pos.x, alpha), z = lerp(p.prevPos.z, p.pos.z, alpha), yaw = lerpAngle(p.prevYaw, p.yaw, alpha);
        if (this.simplified) { this.poseHumanoid(p, x, z, yaw, frameDt); continue; }
        const c = this.character(i);
        if (c) { c.object.position.x = x; c.object.position.z = z; c.object.rotation.y = yaw; }
        const an = p.animator;
        // 30 Hz only for players standing or walking (§4.14 "others"): a running player's limbs turn > 25° per 30 Hz
        // update (B49 / R#37) and read as choppy
        if (an.detail) an.detail.halfRate = lowDetail && PLAY_STATES[st] === 1 && !p.isUser && !p.hasBall && an.action < 0 && !p.isJumping && p.speed < HALF_RATE_MAX_SPEED;
        if (this.focusId === p.id && an.setYawOverride) an.setYawOverride(a.director.turntable.yaw);
        an.evaluate(alpha, paused ? 0 : frameDt);
      }
      if (!this.simplified && PLAY_STATES[st] && !paused) a.recorder.capture(w.time, a.animators, a.ballVis.mesh);
    }
    // ---- 5. ball ----
    const ball = g.ball;
    if (!replaying) a.ballVis.update(frameDt, ball);
    const ballShown = st !== 'MENU' && st !== 'LINEUP' && st !== 'INTRO' && this.screenMode !== 'gameover';
    if (!ballShown) a.ballVis.mesh.visible = false;
    // ---- 6. camera ----
    const camDt = this.introPaused ? 0 : (g.paused && a.director.mode !== 'pause' ? 0 : frameDt);
    a.director.update(camDt, w);
    const cam = a.director.camera;
    // ---- 7. characters ----
    if (a.lib) {
      a.lib.beginFrame(cam, a.viewportPx());
      const cs = a.characters;
      for (let i = 0; i < 6; i++) cs[this.players[i].id].update(frameDt);
    }
    // ---- 8. lights, blobs, crowd, arena, hoop, fx ----
    a.lights.update(frameDt);
    a.lights.updateShadowFit(this.players, ball);
    const blobs = a.blobs;
    for (let i = 0; i < 6; i++) {
      const p = this.players[i];
      let x, z, yaw, vis = true;
      if (replaying) { x = rp.roots[i * 4]; z = rp.roots[i * 4 + 2]; yaw = rp.roots[i * 4 + 3]; vis = rp.vis[i] === 1; } else {
        x = lerp(p.prevPos.x, p.pos.x, alpha); z = lerp(p.prevPos.z, p.pos.z, alpha); yaw = p.yaw;
      }
      const c = this.character(i);
      if (c && c.hidden) vis = false;
      blobs.setPlayer(i, x, z, p.legend.shoulderJoints || 0.46, yaw, vis);
    }
    const bm = a.ballVis.mesh;
    blobs.setBall(bm.position.x, bm.position.y, bm.position.z, bm.visible);
    blobs.commit();
    this.updateCrowdMood();
    a.crowd.update(frameDt);
    this.updateLive();
    a.arena.update(frameDt);
    if (replaying) a.hoop.update(frameDt * REPLAY.RATE, rp.ball);
    else a.hoop.update(frameDt, ball.state === 'flight' || ball.state === 'loose' || ball.state === 'scored' ? ball : null);
    a.fx.update(frameDt);
    // control ring under the user's player
    const u = w.controlled;
    const ringOn = !!u && !w.auto && !replaying && (st === 'CHECK' || st === 'LIVE' || st === 'DEAD') && this.screenMode === 'game';
    a.fx.ring.setVisible(ringOn);
    if (ringOn) a.fx.ring.update(frameDt, lerp(u.prevPos.x, u.pos.x, alpha), lerp(u.prevPos.z, u.pos.z, alpha), u.legend.shoulderJoints || 0.46);
    let hz = null, hvz = 0;
    if (!w.auto && st === 'LIVE' && ball.owner && ball.owner.team === w.user && ball.owner === u) { hz = u.pos.z; hvz = u.vel.z; }
    a.stripe.update(frameDt, hz, hvz);
    a.present.update(g.meter.active);
  }

  /** Simplified mode: humanoid pose from the player state (v1 pose names). */
  poseHumanoid(p, x, z, yaw, dt) {
    const h = this.app.humanoids[p.id];
    if (!h) return;
    h.group.position.set(x, 0, z);
    h.group.rotation.y = yaw;
    const P = POSE_P;
    P.t = this.world.time; P.dt = dt; P.speed = p.speed; P.jumpY = p.jumpY; P.f = 0; P.releaseAge = p.stateT;
    P.ballY = this.game.ball.pos.y; P.handSign = p.handSign;
    let pose = 'idle';
    switch (p.state) {
      case 'idle': case 'move': case 'post': case 'faceUp':
        pose = p.hasBall ? (p.dribbling ? 'dribble' : 'idle') : (p.offense ? 'run' : 'defend');
        break;
      case 'cross': pose = 'cross'; break;
      case 'windup': pose = 'windup'; P.f = this.game.meter.active && this.game.meter.shooterId === p.id ? this.game.meter.fill : clamp(p.stateT / 0.5, 0, 1); break;
      case 'release': pose = 'release'; break;
      case 'layup': pose = 'layup'; break;
      case 'dunk': pose = 'dunk'; break;
      case 'jump': pose = 'block'; break;
      case 'steal': pose = 'steal'; break;
      case 'stunned': case 'fallen': pose = 'stunned'; break;
      case 'celebrate': pose = 'celebrate'; break;
      default: break;
    }
    h.setPose(pose, P);
  }

  /** Crowd chant / clutch (§6.7: CPU on offence, Q4/OT last 2:00 or margin ≤ 5, shot clock ≤ 8). */
  updateCrowdMood() {
    const a = this.app, g = this.game, w = this.world;
    const live = w.state === 'LIVE';
    const late = w.quarter >= CLOCK.QUARTERS && (w.gameClock <= 120 || Math.abs(g.score[0] - g.score[1]) <= 5);
    const chant = live && !w.auto && w.offense !== w.user && late && w.shotClock <= 8;
    if (chant !== this.chantOn) { this.chantOn = chant; a.crowd.chant(chant); a.audio.crowdAudio.chant(chant); }
    const clutch = PLAY_STATES[w.state] === 1 && (g.inClutch(0) || g.inClutch(1));
    if (clutch !== this.clutchOn) {
      this.clutchOn = clutch;
      a.crowd.setClutch(clutch);
      a.audio.crowdAudio.setBase(clutch ? BASE_CLUTCH : BASE_NORMAL);
      if (clutch) a.arena.led.message('led.clutch');
    }
  }

  /** Jumbotron live data, LED score, shot-clock digits (allocation only when a value changes). */
  updateLive() {
    const a = this.app, g = this.game, w = this.world, d = this.liveData, m = a.match;
    if (!PLAY_STATES[w.state] && w.state !== 'QUARTER_END') return;
    const lang = a.lang();
    if (w.quarter !== this._periodQ || lang !== this._periodLang) {
      this._periodQ = w.quarter; this._periodLang = lang;
      d.period = w.quarter > CLOCK.QUARTERS ? (w.quarter === 5 ? t('hud.ot') : t('hud.ot2', { n: w.quarter - 4 })) : t('hud.q', { n: w.quarter });
      d.a.abbr = m.teamAbbr(0); d.b.abbr = m.teamAbbr(1);
      this.scoreShown[0] = -1;
    }
    d.a.score = g.score[0]; d.b.score = g.score[1];
    d.clock = w.gameClock; d.shotClock = w.state === 'LIVE' || w.state === 'CHECK' ? w.shotClock : null;
    if (this.scoreShown[0] !== g.score[0] || this.scoreShown[1] !== g.score[1]) {
      this.scoreShown[0] = g.score[0]; this.scoreShown[1] = g.score[1];
      a.arena.led.setScore(d.a.abbr, g.score[0], g.score[1], d.b.abbr);
      for (let t2 = 0; t2 < 2; t2++) {
        let best = null;
        for (let i = 0; i < 6; i++) { const p = this.players[i]; if (p.team === t2 && (!best || p.stats.pts > best.stats.pts)) best = p; }
        d.leaders[t2].short = best ? pick(best.short) : ''; d.leaders[t2].pts = best ? best.stats.pts : 0;
      }
    }
    if (a.arena.jumbo.mode === 'live') a.arena.jumbo.setLive(d);
    const sc = w.state === 'LIVE' || w.state === 'CHECK' ? Math.max(0, Math.ceil(w.shotClock - 1e-4)) : -1;
    if (sc !== this.shotClockShown) { this.shotClockShown = sc; a.hoop.setShotClock(sc >= 0 ? sc : null); }
  }

  /** Meter anchor for the HUD (B61): midpoint of spine_03 and the head socket, at this frame's matrices. */
  meterAnchor(p, out) {
    const c = p.character;
    if (!c) { out.x = p.pos.x; out.y = 1.5 + p.jumpY; out.z = p.pos.z; return out; }
    c.headWorld(HEAD);
    const b = c.bones.spine_03;
    b.updateWorldMatrix(true, false);
    V.setFromMatrixPosition(b.matrixWorld);
    out.x = 0.5 * (V.x + HEAD.x); out.y = 0.5 * (V.y + HEAD.y); out.z = 0.5 * (V.z + HEAD.z);
    return out;
  }

  /** Ball socket of the holder at render time (BallVisual resolveHeld). */
  resolveHeld(ball, out) {
    const o = ball.owner;
    if (!o || !o.animator || !o.animator.renderSocket) return false;
    if (this.simplified) {
      const h = this.app.humanoids[o.id];
      if (!h) return false;
      h.handWorld(out, o.handSign);
      if (ball.state === 'dribble') out.y = ball.pos.y;
      return true;
    }
    o.animator.renderSocket(SOCK.ball, out);
    return out.x === out.x;
  }
}

