/**
 * @module cam/director
 * The camera director of v2 (SPEC-v2 §6.4.1, PR §4.1): one PerspectiveCamera (near 0.3, far 160) whose pose is written
 * by modes — broadcast, intro, replay, lineup, title, pause, halftime, gameover, showcase — with 'cut' or 'ease'
 * (cubic in-out on position / look / fov / lens over `seconds`, default 0.6) transitions. Every update ends with
 * `updateProjectionMatrix()` (only when fov / aspect / lens changed) and `camera.updateMatrixWorld()` so the HUD
 * projects with this frame's matrices (R#4; main loop step 6, before render and hud.update).
 *
 * API (frozen, §1.4):
 *   director.setMode(name, { transition: 'cut'|'ease', seconds = 0.6, ...params });  director.update(dt, world);
 *   director.camera; director.mode; director.cameraMode ('standard'|'close'|'high'); director.ndc(out, x, y, z);
 *   director.shake(ampM, seconds, hz); director.dunkPush(on)
 * plus setSize(w, h) (call after every renderer resize), setCameraMode(m) (Camera setting, 0.4 s ease), renderHz
 * (60 / 30 / 0: pause drift then frozen canvas), intro (IntroTimeline), turntable (Turntable), broadcast
 * (BroadcastCamera), pose (the last composed pose), modeTime.
 *
 * Mode params:
 *   broadcast  —                                         (cut on MENU/INTRO → CHECK and after replays)
 *   intro      { shots? } (loads + starts director.intro when given; flow wires director.intro.onCue first)
 *   replay     { source: ReplayPlayer }                   (source.pose(out, dt, ctx) each frame)
 *   lineup     { focus?: Object3D|{x,z}|null, h?, focusId?, yawDeg? }   (null focus = landscape overview; while
 *              already in 'lineup' a new focus eases 0.5 s, the same focus only sets the turntable yaw; flow feeds
 *              drags to director.turntable.drag(dxPx) / release(vxPxPerS) and applies director.turntable.yaw to the
 *              focused character each frame)
 *   title      —            pause —            halftime —
 *   gameover   { subject: Object3D|{x,z,yaw}, h, hold = 1.0 }   (holds the broadcast framing for `hold` s, then cuts)
 *   showcase   { pos: {x,y,z}, look: {x,y,z}, fov, lens? }
 * Zero allocation per update (H10).
 */
import * as THREE from '../../vendor/three.module.js';
import { BroadcastCamera, CAMERA_MODES } from './broadcast.js';
import {
  makePose, copyPose, setPose, lerpPose, easeInOutCubic, titleShot, lineupShot, pauseShot, pauseRenderHz,
  halftimeShot, gameoverShot, IntroTimeline, Turntable,
} from './shots.js';

export const MODES = Object.freeze(['broadcast', 'intro', 'replay', 'lineup', 'title', 'pause', 'halftime', 'gameover', 'showcase']);

/** Director constants (§6.4.1). */
export const DIRECTOR = Object.freeze({ NEAR: 0.3, FAR: 160, EASE_S: 0.6, SETTINGS_EASE_S: 0.4, FOCUS_EASE_S: 0.5 });

const V = new THREE.Vector3();
const SUBJ = { x: 0, z: 0, yaw: 0, h: 2 };
const CTX = { aspect: 16 / 9, portrait: false, width: 1, height: 1 };

/** Reads {x, z, yaw} of an Object3D (position / rotation.y) or of a plain {x, z, yaw} / {pos: {x, z}} into SUBJ. */
function readSubject(src, out) {
  if (!src) { out.x = 0; out.z = -6; out.yaw = 0; return out; }
  const p = src.position || src.pos || src;
  out.x = p.x || 0; out.z = p.z || 0;
  out.yaw = src.rotation ? src.rotation.y : (typeof src.yaw === 'number' ? src.yaw : 0);
  return out;
}

export class Director {
  /**
   * @param {{width?:number, height?:number, cameraMode?:string}} [opts]
   */
  constructor(opts = {}) {
    const w = opts.width > 0 ? opts.width : 1280, h = opts.height > 0 ? opts.height : 720;
    this.camera = new THREE.PerspectiveCamera(42, w / h, DIRECTOR.NEAR, DIRECTOR.FAR);
    this.camera.name = 'director';
    // Allocate the view-offset record once (three creates it lazily); disabled until a mode asks for a lens shift.
    this.camera.setViewOffset(w, h, 0, 0, w, h);
    this.camera.view.enabled = false;
    this.width = w; this.height = h;
    this.broadcast = new BroadcastCamera({ cameraMode: opts.cameraMode, aspect: w / h });
    this.intro = new IntroTimeline();
    this.turntable = new Turntable();
    this.mode = 'broadcast';
    this.modeTime = 0;
    this.params = { source: null, focus: null, h: 2, focusId: null, subject: null, hold: 1.0, fixed: makePose() };
    this.pose = makePose();          // last composed pose (before shake)
    this._tgt = makePose();
    this._from = makePose();
    this._mix = makePose();
    this.trans = { active: false, t: 0, T: 0 };
    this._applied = { fov: NaN, aspect: NaN, lens: NaN, w: 0, h: 0 };
    this._shake = { amp: 0, T: 0, t: 0, hz: 0 };
    this._gameoverCut = false;
    this.renderHz = 60;
    this.broadcast.requestSnap();
    this.update(0, null);
  }

  /** Camera setting value. */
  get cameraMode() { return this.broadcast.cameraMode; }

  /** Viewport size in CSS px (after resizeRenderer). Portrait iff width < height. */
  setSize(width, height) {
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    this.width = w; this.height = h;
    this.broadcast.setAspect(w / h);
    this._applyCamera(this.pose);
  }

  /**
   * Switches mode. `transition` 'cut' (default for broadcast/replay/showcase) snaps; 'ease' blends from the current
   * pose to the new mode's live target over `seconds` (cubic in-out).
   */
  setMode(name, opts) {
    const o = opts || {};
    if (MODES.indexOf(name) < 0) throw new Error(`director: unknown mode '${name}'`);
    const p = this.params;
    if (name === 'lineup' && this.mode === 'lineup') {
      // Within the lineup screen: a new focus eases 0.5 s (turntable restarts at yawDeg or 0); the same focus (drag /
      // release updates from flow) only updates the yaw — no transition restart, no jitter.
      const focus = o.focus || null, id = o.focusId || null;
      const same = focus === p.focus && id === p.focusId;
      if (same) {
        if (typeof o.yawDeg === 'number') this.turntable.yawDeg = o.yawDeg;
        if (o.h > 0) p.h = o.h;
        return;
      }
      p.focus = focus; p.h = o.h > 0 ? o.h : 2; p.focusId = id;
      this.turntable.reset(typeof o.yawDeg === 'number' ? o.yawDeg : 0);
      const T = typeof o.seconds === 'number' ? o.seconds : DIRECTOR.FOCUS_EASE_S;
      if (o.transition !== 'cut' && T > 0) { copyPose(this._from, this.pose); this.trans.active = true; this.trans.t = 0; this.trans.T = T; } else this.trans.active = false;
      return;
    }
    p.source = o.source || null;
    if (name === 'lineup') {
      p.focus = o.focus || null; p.h = o.h > 0 ? o.h : 2; p.focusId = o.focusId || null;
      this.turntable.reset(typeof o.yawDeg === 'number' ? o.yawDeg : 0);
    } else if (name === 'gameover') {
      p.subject = o.subject || null; p.h = o.h > 0 ? o.h : 2; p.hold = typeof o.hold === 'number' ? o.hold : 1.0;
      this._gameoverCut = false;
    } else if (name === 'showcase') {
      const f = p.fixed;
      setPose(f, o.pos ? o.pos.x : 0, o.pos ? o.pos.y : 1.5, o.pos ? o.pos.z : 4, o.look ? o.look.x : 0, o.look ? o.look.y : 1.2,
        o.look ? o.look.z : 0, o.fov > 0 ? o.fov : 30, o.lens || 0);
    } else if (name === 'intro' && o.shots) {
      this.intro.load(o.shots).start();
    }
    const transition = o.transition || (name === 'broadcast' || name === 'replay' || name === 'showcase' ? 'cut' : 'ease');
    // The broadcast framing snaps (no damped glide) on an explicit cut and whenever it is (re)entered from another mode.
    const usesBroadcast = name === 'broadcast' || (name === 'gameover' && p.hold > 0);
    if (usesBroadcast && (transition === 'cut' || this.mode !== 'broadcast')) this.broadcast.requestSnap();
    const seconds = typeof o.seconds === 'number' ? o.seconds : DIRECTOR.EASE_S;
    if (transition === 'ease' && seconds > 0) {
      copyPose(this._from, this.pose);
      this.trans.active = true; this.trans.t = 0; this.trans.T = seconds;
    } else {
      this.trans.active = false;
    }
    this.mode = name;
    this.modeTime = 0;
    this.renderHz = 60;
  }

  /** Camera setting: 'standard' | 'close' | 'high'; eases 0.4 s while in broadcast. */
  setCameraMode(m) {
    if (CAMERA_MODES.indexOf(m) < 0 || m === this.broadcast.cameraMode) return;
    this.broadcast.setCameraMode(m);
    if (this.mode === 'broadcast') {
      copyPose(this._from, this.pose);
      this.trans.active = true; this.trans.t = 0; this.trans.T = DIRECTOR.SETTINGS_EASE_S;
      this.broadcast.requestSnap();
    }
  }

  /** Camera shake (slam 0.03 m / 0.25 s / 12 Hz, ankle-breaker 0.04 m / 0.15 s / 14 Hz): linear decay. */
  shake(ampM, seconds, hz) {
    const s = this._shake;
    s.amp = ampM > 0 ? ampM : 0; s.T = seconds > 0 ? seconds : 0; s.t = 0; s.hz = hz > 0 ? hz : 12;
  }

  /** Dunk push-in (§6.4.2): flow sets true at the dunker's TAKEOFF and false at SLAM + 0.5 s. */
  dunkPush(on) { this.broadcast.setDunkPush(on); }

  /**
   * Per-frame update (main loop step 6): mode target → transition blend → shake → camera, then
   * updateProjectionMatrix (if needed) and updateMatrixWorld.
   * @param {number} dt frame seconds
   * @param {object} world game world (ball for broadcast)
   */
  update(dt, world) {
    const k = dt > 0 ? dt : 0;
    this.modeTime += k;
    const aspect = this.width / this.height;
    CTX.aspect = aspect; CTX.portrait = aspect < 1; CTX.width = this.width; CTX.height = this.height;
    const tgt = this._tgt, p = this.params;
    this.renderHz = 60;
    switch (this.mode) {
      case 'broadcast':
        this.broadcast.update(k, world, tgt);
        break;
      case 'intro':
        this.intro.update(k);
        this.intro.pose(tgt, k, CTX);
        break;
      case 'replay':
        if (p.source && p.source.pose) p.source.pose(tgt, k, CTX); else copyPose(tgt, this.pose);
        break;
      case 'lineup': {
        this.turntable.update(k);
        if (p.focus) {
          readSubject(p.focus, SUBJ);
          LINEUP_P.focus = SUBJ; LINEUP_P.h = p.h;
        } else {
          LINEUP_P.focus = null;
        }
        lineupShot(LINEUP_P, aspect, tgt);
        break;
      }
      case 'title':
        titleShot(this.modeTime, aspect, tgt);
        break;
      case 'pause':
        pauseShot(this.modeTime, tgt);
        this.renderHz = pauseRenderHz(this.modeTime);
        break;
      case 'halftime':
        halftimeShot(this.modeTime, aspect, tgt);
        break;
      case 'gameover':
        if (this.modeTime < p.hold) {
          this.broadcast.update(k, world, tgt);
        } else {
          if (!this._gameoverCut) { this._gameoverCut = true; this.trans.active = false; }
          readSubject(p.subject, SUBJ);
          SUBJ.h = p.h;
          gameoverShot(this.modeTime - p.hold, SUBJ, aspect, tgt);
        }
        break;
      default:
        copyPose(tgt, p.fixed);
        break;
    }
    let out = tgt;
    if (this.trans.active) {
      const tr = this.trans;
      tr.t += k;
      const e = easeInOutCubic(tr.T > 0 ? tr.t / tr.T : 1);
      lerpPose(this._mix, this._from, tgt, e);
      out = this._mix;
      if (tr.t >= tr.T) tr.active = false;
    }
    copyPose(this.pose, out);
    // shake: three incommensurate sines (deterministic, no RNG) with a linear decay envelope
    const s = this._shake;
    let sx = 0, sy = 0, sz = 0;
    if (s.t < s.T) {
      s.t += k;
      const env = s.amp * Math.max(0, 1 - s.t / s.T), w = 2 * Math.PI * s.hz * s.t;
      sx = env * Math.sin(w); sy = env * Math.sin(w * 1.31 + 1.7); sz = env * 0.5 * Math.sin(w * 0.87 + 0.6);
    }
    const c = this.camera;
    c.position.set(out.px + sx, out.py + sy, out.pz + sz);
    c.lookAt(out.lx + sx, out.ly + sy, out.lz + sz);
    this._applyCamera(out);
    c.updateMatrixWorld();
  }

  /** Projects a world point to NDC with this frame's matrices (incl. the view offset). out {x, y, z}; z > 1 → behind. */
  ndc(out, x, y, z) {
    V.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = V.z > 0;
    V.applyMatrix4(this.camera.projectionMatrix);
    out.x = V.x; out.y = V.y; out.z = behind ? 2 : V.z;
    return out;
  }

  /** fov / aspect / lens → projection (only when changed). */
  _applyCamera(pose) {
    const c = this.camera, a = this._applied;
    const aspect = this.width / this.height;
    const fov = pose.fov, lens = pose.lens || 0;
    if (fov === a.fov && aspect === a.aspect && lens === a.lens && a.w === this.width && a.h === this.height) return;
    c.fov = fov;
    c.aspect = aspect;
    const v = c.view;
    // portrait lens shift: setViewOffset(W, H, 0, lens·H/2, W, H) moves the content up by `lens` NDC
    if (Math.abs(lens) > 1e-5) {
      v.enabled = true; v.fullWidth = this.width; v.fullHeight = this.height; v.offsetX = 0;
      v.offsetY = lens * this.height * 0.5; v.width = this.width; v.height = this.height;
    } else {
      v.enabled = false;
    }
    c.updateProjectionMatrix();
    a.fov = fov; a.aspect = aspect; a.lens = lens; a.w = this.width; a.h = this.height;
  }
}

const LINEUP_P = { focus: null, h: 2 };
