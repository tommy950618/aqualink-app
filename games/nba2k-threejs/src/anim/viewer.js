/**
 * viewer.js — the `?anim=` debug viewer (spec §1.3, §4.15, [ANIM §11.1]) and its Playwright API `window.__anim`.
 *
 * Exports
 *   runViewer(root, opts) → Promise<api>   (api is also assigned to window.__anim)
 *   parseViewerParams(search) → frozen params (defaults of [ANIM §11.1])
 *
 * opts: { library (WP2 Library: createCharacter(id, {kit, lodMode}) → Promise<Character>), header (parsed
 *   assets/legends/legends.json, for buildRig; else library.header), params (URLSearchParams | string, default
 *   location.search), renderer (optional THREE.WebGLRenderer to reuse), t (i18n lookup, default i18n.t) }.
 * URL parameters: anim (clip id | list | loco), player (kobe), mirror 0/1, speed 0.05–4, t (freeze time), loop 0/1,
 *   cam tq|side|front|top|orbit, lod 0–3, kit classic|allstar, bones 0/1, ball 0/1, grid 0/1, ghost n, loco (m/s), dir
 *   (deg: facing relative to the velocity), def 0/1, dribble still|protect|walk|jog|run|speed|backdown, h (jump height
 *   override), warp (e.g. `release:0.60,land:1.1`), ui 0/1.
 * window.__anim = { ready: Promise, clips: string[], players: string[], load(clipId, playerId, opts) → Promise,
 *   seek(t), play(), pause(), step(dt), sample(boneName) → [x, y, z], socket(name) → [x, y, z], ballPos() → [x, y, z],
 *   events() → [{t, name}], footLocks() → [{side, locked, slide}], stats() → {cpuMs, bonesUpdated}, animator, mode }.
 * The loco preview drives the root around a 12 m loop (radius 12/2π m) at `loco` m/s; the dribble preview runs the
 * same loop at the mode's nominal speed with the ball in `drib` mode. Labels are i18n keys `anim.*` (H6).
 */
import * as THREE from '../../vendor/three.module.js';
import { t as i18nT } from '../i18n.js';
import { buildRig, BONE_NAMES, BONE_PARENT, BONE_COUNT, SOCK, SOCKET_NAMES } from './rig.js';
import { EV, EV_NAMES, BM, BM_NAMES, clipIndex, clipIds, clipTiming, sampleRoot } from './clip.js';
import { PLAYER_IDS } from './presets.js';
import { timingClip, getTiming, RIM_POS, CLIP_IDS } from './select.js';
import { Animator } from './animator.js';

const DT = 1 / 60;
const G = 9.81;
const LOOP_R = 12 / (2 * Math.PI);
const DRIB_SPEED = Object.freeze({ still: 0, protect: 1.0, walk: 1.4, jog: 3.2, run: 5.0, speed: 6.5, backdown: 0.8 });
const NUM = (v, d, lo, hi) => { const x = parseFloat(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };

/** Viewer parameters with the [ANIM §11.1] defaults. */
export function parseViewerParams(search) {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search || new URLSearchParams('');
  const g = (k) => p.get(k);
  const warp = {};
  if (g('warp')) for (const part of g('warp').split(',')) { const [n, v] = part.split(':'); const c = EV_NAMES.indexOf(n); if (c > 0 && Number.isFinite(+v)) warp[c] = +v; }
  const player = PLAYER_IDS.includes(g('player')) ? g('player') : 'kobe';
  return Object.freeze({
    anim: g('anim') || (g('dribble') || g('loco') ? 'loco' : 'list'), player, mirror: g('mirror') === '1', speed: NUM(g('speed'), 1, 0.05, 4),
    t: g('t') !== null ? NUM(g('t'), 0, 0, 60) : null, loop: g('loop') !== '0', cam: ['tq', 'side', 'front', 'top', 'orbit'].includes(g('cam')) ? g('cam') : 'tq',
    lod: Math.round(NUM(g('lod'), 1, 0, 3)), kit: g('kit') === 'allstar' ? 'allstarA' : 'classic', bones: g('bones') === '1',
    ball: g('ball') !== '0', grid: g('grid') !== '0', ghost: Math.round(NUM(g('ghost'), 0, 0, 12)),
    loco: NUM(g('loco'), 0, 0, 9.5), dir: NUM(g('dir'), 0, -180, 180), def: g('def') === '1',
    dribble: DRIB_SPEED[g('dribble')] !== undefined ? g('dribble') : null, h: g('h') !== null ? NUM(g('h'), 0.5, 0.05, 1.2) : null,
    warp: Object.keys(warp).length ? Object.freeze(warp) : null, ui: g('ui') !== '0',
  });
}

/** Builds the viewer into `root` (module header). */
export async function runViewer(root, opts = {}) {
  const tr = opts.t || i18nT;
  let P = parseViewerParams(opts.params || (typeof location !== 'undefined' ? location.search : ''));
  const header = opts.header || (opts.library && opts.library.header);
  if (!header || !opts.library) throw new Error('runViewer: opts.library and opts.header are required');
  // ---------------------------------------------------------------- renderer / scene
  const renderer = opts.renderer || new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  if (!opts.renderer) { renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); root.appendChild(renderer.domElement); }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b3038);
  scene.add(new THREE.HemisphereLight(0xe8eef8, 0x403528, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(-3, 6, 4); scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x6b5641, roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const grid = new THREE.GridHelper(20, 40, 0x9aa4b0, 0x56606c); grid.position.y = 0.002; scene.add(grid);
  const hoop = buildHoop(); scene.add(hoop);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 16), new THREE.MeshStandardMaterial({ color: 0xc4521c, roughness: 0.7 }));
  scene.add(ballMesh);
  const lockMarks = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 20), new THREE.MeshBasicMaterial({ color: 0x48e078, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; scene.add(m); return m; });
  const ghostGroup = new THREE.Group(); scene.add(ghostGroup);
  // ---------------------------------------------------------------- UI
  const ui = buildUI(root, tr);
  // ---------------------------------------------------------------- state
  const state = {
    character: null, animator: null, owner: null, helper: null, clipIdx: -1, clipId: '', mode: 'clip', playing: true,
    evLog: [], playT: 0, target: null, start: 0, loopAngle: 0, ballFree: false, bp: new THREE.Vector3(), bv: new THREE.Vector3(), lastT: 0, acc: 0, frozenT: null,
  };
  const v3 = new THREE.Vector3();

  async function load(clipId, playerId, o = {}) {
    P = Object.freeze({ ...P, ...o, anim: clipId || P.anim, player: playerId || P.player });
    if (state.character) { scene.remove(state.character.object); if (state.character.dispose) state.character.dispose(); }
    if (state.helper) { scene.remove(state.helper); state.helper = null; }
    const id = P.player;
    const info = header.players.find((p) => p.id === id);
    const rig = buildRig(info, header.bones);
    const ch = await opts.library.createCharacter(id, { kit: { mode: P.kit }, lodMode: 'auto' });
    if (ch.setLod) ch.setLod(P.lod);
    scene.add(ch.object);
    state.character = ch;
    const owner = { pos: { x: 0, z: 0 }, yaw: 0, vel: { x: 0, z: 0 }, jumpY: 0, stamina: 1 };
    state.owner = owner;
    const a = new Animator(rig, ch, { id, owner, rng: viewerRng(7) });
    state.animator = a;
    state.evLog.length = 0; state.ballFree = false; state.loopAngle = 0; state.frozenT = P.t;
    if (P.bones) { state.helper = new THREE.SkeletonHelper(ch.object); scene.add(state.helper); }
    // mode
    if (P.anim === 'loco' || P.dribble) {
      state.mode = 'loco';
      a.ctx.onDefence = P.def;
      if (P.dribble) { a.setBallMode('drib', 'R'); a.ctx.protect = P.dribble === 'protect'; a.ctx.post = P.dribble === 'backdown'; }
      placeOnLoop(0);
      hoop.visible = false;
    } else if (P.anim === 'list') {
      state.mode = 'list';
      hoop.visible = false;
    } else {
      state.mode = 'clip';
      state.clipId = P.anim; state.clipIdx = clipIndex(P.anim);
      const src = timingClip(state.clipIdx, id, P.mirror);
      const tm = src ? clipTiming(src) : null;
      const shoots = tm && (tm.release >= 0 || tm.slam >= 0 || tm.targetT > 0);
      hoop.visible = !!shoots;
      // shots start 4.5 m in front of the rim facing it; approach clips (target event) start so that the target
      // (takeoff) lands dTO from the rim (dunks 1.2 m, layups 1.5 m) and play with target matching
      state.target = null;
      state.start = shoots ? RIM_POS.z + 4.5 : 0;
      if (shoots && tm.targetT > 0) {
        const r = sampleRoot(src, tm.targetT, new Float64Array(3));
        const dTO = tm.slam >= 0 ? 1.2 : 1.5;
        state.start = RIM_POS.z + dTO + r[1] * rig.metrics.sLeg;
        state.target = { x: RIM_POS.x, z: RIM_POS.z + dTO };
      }
      if (shoots) { owner.pos.x = RIM_POS.x; owner.pos.z = state.start; owner.yaw = Math.PI; }
      a.ctx.stance = 'auto';
      if (tm && tm.events.some((e) => e.code === EV.RELEASE || e.code === EV.SLAM)) a.setBallMode('both');
      startClip();
    }
    buildGhosts();
    ui.update(state, P);
    return a;
  }

  function startClip() {
    const a = state.animator;
    state.playT = 0;
    if (state.frozenT !== null && state.frozenT !== undefined) { a.freeze(state.clipIdx, state.frozenT, P.mirror); state.playing = false; return; }
    a.play(state.clipIdx, { mirror: P.mirror, warp: P.warp, blendIn: 0.06, target: state.target || undefined });
  }

  function placeOnLoop(dt) {
    const o = state.owner;
    const sp = state.mode === 'loco' ? (P.dribble ? DRIB_SPEED[P.dribble] : P.loco) : 0;
    state.loopAngle += sp * dt / LOOP_R;
    const th = state.loopAngle;
    o.pos.x = LOOP_R * Math.sin(th); o.pos.z = LOOP_R * (1 - Math.cos(th));
    // velocity tangent (counter-clockwise from above), heading + dir
    const vx = sp * Math.cos(th), vz = sp * Math.sin(th);
    o.vel.x = vx; o.vel.z = vz;
    const heading = sp > 0.01 ? Math.atan2(vx, vz) : o.yaw;
    o.yaw = heading + P.dir * Math.PI / 180;
  }

  // ghosts: onion-skin stick figures at the first n events (headless pre-run of the same clip)
  function buildGhosts() {
    ghostGroup.clear();
    if (!P.ghost || state.mode !== 'clip') return;
    const info = header.players.find((p) => p.id === P.player);
    const rig = buildRig(info, header.bones);
    const ow = { pos: { x: state.owner.pos.x, z: state.owner.pos.z }, yaw: state.owner.yaw, vel: { x: 0, z: 0 }, jumpY: 0 };
    const g = new Animator(rig, null, { id: P.player, owner: ow });
    g.play(state.clipIdx, { mirror: P.mirror, warp: P.warp, blendIn: 0 });
    const shots = [];
    for (let i = 0; i < 600 && shots.length < P.ghost && g.slots[0].state === 1; i++) {
      g.step(DT);
      let hit = false;
      for (let e; (e = g.events.next());) { if (e.code === EV.TAKEOFF) g.setJump(jumpH(g), 2 * Math.sqrt(2 * jumpH(g) / G)); hit = true; }
      ow.pos.x += g.motion.vx * DT; ow.pos.z += g.motion.vz * DT; if (g.motion.active) ow.yaw += g.motion.dyaw;
      ow.jumpY = g.jumpY;
      if (hit) { g.evaluate(1, DT); shots.push(stickFigure(g)); }
    }
    for (const s of shots) ghostGroup.add(s);
  }

  function stickFigure(a) {
    const pos = new Float32Array(BONE_COUNT * 6);
    let n = 0;
    for (let b = 1; b < BONE_COUNT; b++) {
      const p = BONE_PARENT[b]; if (p < 1) continue;
      for (const k of [p, b]) {
        v3.set(a.sk.P[k * 3], a.sk.P[k * 3 + 1], a.sk.P[k * 3 + 2]);
        const c = Math.cos(a.ryaw), s = Math.sin(a.ryaw);
        pos[n++] = a.rx + v3.x * c + v3.z * s; pos[n++] = v3.y; pos[n++] = a.rz - v3.x * s + v3.z * c;
      }
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n), 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.55 }));
  }

  function jumpH(a) {
    if (P.h !== null) return P.h;
    const src = a.actionClip; const tm = src ? clipTiming(src) : null;
    if (tm && tm.jumpH > 0) return tm.jumpH;
    try { return getTiming(a.id, 'jumper', 'set').h; } catch (e) { return 0.5; }
  }

  // ---------------------------------------------------------------- fixed step
  function stepOnce() {
    const a = state.animator, o = state.owner;
    if (!a) return;
    if (state.mode === 'loco') placeOnLoop(DT);
    // meter clips: a perfect release input at tIdeal (launch = input + 0.050 at apex + rva, spec §4.9.1)
    if (state.mode === 'clip' && a.slots[0].state === 1) {
      const tm = a.actionClip ? clipTiming(a.actionClip) : null;
      state.playT += DT;
      if (tm && tm.meter && tm.tIdeal > 0 && state.playT >= tm.tIdeal - 1e-9 && !a.slots[0].clock.released) a.releaseNow();
    }
    a.step(DT);
    for (let e; (e = a.events.next());) {
      state.evLog.push({ t: +e.t.toFixed(3), name: EV_NAMES[e.code] });
      if (state.evLog.length > 64) state.evLog.shift();
      if (e.code === EV.TAKEOFF) {
        const h = jumpH(a), tm = a.actionClip ? clipTiming(a.actionClip) : null;
        const air = 2 * Math.sqrt(2 * h / G);
        a.setJump(h, air, tm && tm.slam > 0 ? { slam: Math.max(0.1, Math.sqrt(2 * h / G) - 0.03), hang: tm.params.hang || 0.15 } : undefined);
      }
      if ((e.code === EV.RELEASE || e.code === EV.SLAM) && e.layer === 0) {
        a.querySocket(SOCK.ball, state.bp);            // the sim launch point (exactly what gameplay launches from)
        state.ballFree = true;
        // cosmetic arc toward the rim (viewer only; gameplay owns the real launch)
        const dx = RIM_POS.x - o.pos.x, dz = RIM_POS.z - o.pos.z, d = Math.hypot(dx, dz) || 1, tf = 0.25 + 0.12 * d;
        state.bv.set(dx / tf, (RIM_POS.y + 0.2 - state.bp.y + 0.5 * G * tf * tf) / tf, dz / tf);
        if (e.code === EV.SLAM) state.bv.set(0, -4.5, 0);
      }
    }
    // root motion (the viewer is the "gameplay")
    if (state.mode === 'clip') {
      if (a.motion.active) { o.vel.x = a.motion.vx; o.vel.z = a.motion.vz; o.yaw += a.motion.dyaw; }
      else if (a.motion.exit) { o.vel.x = a.motion.exitVx; o.vel.z = a.motion.exitVz; }
      else { o.vel.x *= 0.85; o.vel.z *= 0.85; }
      o.pos.x += o.vel.x * DT; o.pos.z += o.vel.z * DT;
      o.jumpY = a.jumpY;
      if (P.loop && a.slots[0].state === 0 && state.playing) {
        // loop: back to the start spot after the clip and its fade
        if (hoop.visible) { o.pos.x = RIM_POS.x; o.pos.z = state.start; o.yaw = Math.PI; }
        else { o.pos.x = 0; o.pos.z = 0; o.yaw = 0; }
        o.vel.x = 0; o.vel.z = 0;
        state.ballFree = false;
        if (a.ballMode === BM.FREE && hoop.visible) a.setBallMode('both');
        startClip();
      }
    }
    if (state.ballFree) {
      state.bv.y -= G * DT; state.bp.addScaledVector(state.bv, DT);
      if (state.bp.y < 0.12) { state.bp.y = 0.12; state.bv.y = Math.abs(state.bv.y) * 0.75; state.bv.x *= 0.8; state.bv.z *= 0.8; }
    }
  }

  // ---------------------------------------------------------------- frame
  let raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dtF = Math.min(0.1, state.lastT ? (now - state.lastT) / 1000 : DT);
    state.lastT = now;
    if (state.playing) {
      state.acc += dtF * P.speed;
      while (state.acc >= DT) { stepOnce(); state.acc -= DT; }
    }
    render(state.playing ? state.acc / DT : 1, dtF);
  }

  function render(alpha, dtF) {
    const a = state.animator;
    resize();
    if (a) {
      if (state.character && state.owner) {
        const o = state.owner;
        state.character.object.position.set(o.pos.x, 0, o.pos.z);
        state.character.object.rotation.y = o.yaw;
      }
      a.evaluate(alpha, dtF);
      if (P.ball && a.ballMode !== BM.FREE) { a.renderSocket(SOCK.ball, v3); ballMesh.position.copy(v3); ballMesh.visible = true; }
      else if (P.ball && state.ballFree) { ballMesh.position.copy(state.bp); ballMesh.visible = true; }
      else ballMesh.visible = false;
      for (let s = 0; s < 2; s++) {
        const d = a.footLocks()[s], m = lockMarks[s], T = a.ft[s];
        m.visible = d.locked;
        if (d.locked) { a.toWorld(Float64Array.of(T.x, 0.003, T.z), a.rx, a.rz, a.ryaw, m.position); m.position.y = 0.003; }
      }
      placeCamera(a);
      ui.readout(a, state, P);
    }
    renderer.render(scene, camera);
  }

  function resize() {
    const w = root.clientWidth || window.innerWidth, h = root.clientHeight || window.innerHeight;
    const c = renderer.domElement;
    if (c.width !== Math.floor(w * renderer.getPixelRatio()) || c.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); c.style.width = w + 'px'; c.style.height = h + 'px';
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
  }

  let orbit = 0;
  function placeCamera(a) {
    const h = a.rig.metrics.height || 2.0;
    const tx = a.rx, tz = a.rz;
    // near the rim (finishes) the camera frames body and rim together
    const dRim = Math.hypot(a.rx - RIM_POS.x, a.rz - RIM_POS.z);
    const kRim = hoop.visible ? Math.max(0, Math.min(1, (3.5 - dRim) / 1.5)) : 0;
    const ty = 0.55 * h + kRim * (0.5 * (RIM_POS.y + 0.2) - 0.275 * h);
    const yaw = a.ryaw;
    let ang, dist = 2.6 + 0.9 * h, el = 0.15;
    if (P.cam === 'side') ang = yaw + Math.PI / 2;
    else if (P.cam === 'front') ang = yaw;
    else if (P.cam === 'top') { ang = yaw; el = 1.3; }
    else if (P.cam === 'orbit') { orbit += 0.004; ang = orbit; }
    else ang = yaw + 0.6;
    if (state.mode === 'loco') { dist += 1.0; }
    dist += 1.2 * kRim;
    camera.position.set(tx + Math.sin(ang) * dist * Math.cos(el), ty + Math.sin(el) * dist + 0.25, tz + Math.cos(ang) * dist * Math.cos(el));
    camera.lookAt(tx, ty, tz);
  }

  // ---------------------------------------------------------------- API
  const api = {
    ready: null,
    clips: [], players: PLAYER_IDS.slice(),
    get animator() { return state.animator; },
    get mode() { return state.mode; },
    load: (clipId, playerId, o) => load(clipId, playerId, o || {}),
    seek(t) { state.frozenT = t; if (state.animator && state.mode === 'clip') { state.animator.freeze(state.clipIdx, t, P.mirror); state.playing = false; render(1, 0); } },
    play() { state.playing = true; if (state.frozenT !== null && state.mode === 'clip') { state.frozenT = null; startClip(); } },
    pause() { state.playing = false; },
    step(dt = DT) { const n = Math.max(1, Math.round(dt / DT)); for (let i = 0; i < n; i++) stepOnce(); render(1, DT); },
    sample(name) {
      const a = state.animator, b = BONE_NAMES.indexOf(name); if (!a || b < 0) return null;
      const p = Float64Array.of(a.sk.P[b * 3], a.sk.P[b * 3 + 1], a.sk.P[b * 3 + 2]);
      const o = a.toWorld(p, a.rx, a.rz, a.ryaw, { x: 0, y: 0, z: 0 }); return [o.x, o.y, o.z];
    },
    socket(name) { const a = state.animator, s = SOCKET_NAMES.indexOf(name); if (!a || s < 0) return null; a.renderSocket(s, v3); return [v3.x, v3.y, v3.z]; },
    ballPos() { const a = state.animator; if (!a) return null; if (a.ballMode === BM.FREE) return [state.bp.x, state.bp.y, state.bp.z]; a.renderSocket(SOCK.ball, v3); return [v3.x, v3.y, v3.z]; },
    events: () => state.evLog.slice(),
    footLocks: () => (state.animator ? state.animator.footLocks().map((d) => ({ side: d.side, locked: d.locked, slide: d.locked ? d.slide : 0, max: d.max })) : []),
    stats: () => (state.animator ? { cpuMs: state.animator.stats.cpuMs, bonesUpdated: state.animator.stats.bonesUpdated } : { cpuMs: 0, bonesUpdated: 0 }),
    stop() { cancelAnimationFrame(raf); },
  };
  ui.bind(api, () => P, (np) => { P = np; });
  if (typeof window !== 'undefined') window.__anim = api;
  api.ready = (async () => {
    const ids = new Set([...clipIds(), ...CLIP_IDS]);
    api.clips = [...ids].filter((id) => !id.endsWith('_L')).sort();
    ui.list(api.clips, P);
    await load(P.anim, P.player);
    raf = requestAnimationFrame(frame);
    return api;
  })();
  return api.ready;
}

/** Simple hoop for clips that shoot at the rim (rim torus, backboard, pole) at the court position. */
function buildHoop() {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2286, 0.01, 8, 32), new THREE.MeshStandardMaterial({ color: 0xd8501e }));
  rim.rotation.x = Math.PI / 2; rim.position.set(RIM_POS.x, RIM_POS.y, RIM_POS.z); g.add(rim);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.83, 1.07, 0.03), new THREE.MeshStandardMaterial({ color: 0xe8eef4, transparent: true, opacity: 0.6 }));
  board.position.set(0, 3.435, -13.12); g.add(board);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.9, 10), new THREE.MeshStandardMaterial({ color: 0x40464e }));
  pole.position.set(0, 1.95, -14.0); g.add(pole);
  return g;
}

/** Deterministic cosmetic RNG for the viewer (no Math.random in src, H8). */
function viewerRng(seed) {
  let a = seed >>> 0;
  return { next() { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; } };
}

/** DOM panels: pickers, transport, toggles, scrubber with event ticks, readout, clip list. */
function buildUI(root, tr) {
  const doc = root.ownerDocument || document;
  const el = (tag, css, text) => { const e = doc.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined) e.textContent = text; return e; };
  const view = doc.defaultView;
  if (view && view.getComputedStyle(root).position === 'static') root.style.position = 'relative';
  const panel = el('div', 'position:absolute;left:8px;top:8px;max-width:min(92vw,360px);background:rgba(16,20,26,.82);color:#e6ecf2;font:12px/1.45 system-ui,sans-serif;padding:8px 10px;border-radius:8px;z-index:5');
  const title = el('div', 'font-weight:600;margin-bottom:4px', tr('anim.title'));
  const row = () => el('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:3px 0');
  const btn = (key) => el('button', 'min-width:44px;min-height:32px;background:#2c3440;color:#e6ecf2;border:1px solid #4a5666;border-radius:6px;padding:2px 8px', tr(key));
  const sel = () => el('select', 'background:#2c3440;color:#e6ecf2;border:1px solid #4a5666;border-radius:6px;min-height:28px;max-width:200px');
  const r1 = row(); const pl = sel(); const cl = sel();
  r1.append(el('span', '', tr('anim.player')), pl, el('span', '', tr('anim.clip')), cl);
  const r2 = row(); const bPlay = btn('anim.play'), bPause = btn('anim.pause'), bStep = btn('anim.step');
  const cMirror = el('input'); cMirror.type = 'checkbox';
  r2.append(bPlay, bPause, bStep, el('span', '', tr('anim.mirror')), cMirror);
  const r3 = row(); const scrub = el('input', 'flex:1;min-width:160px'); scrub.type = 'range'; scrub.min = '0'; scrub.max = '1'; scrub.step = '0.001'; scrub.value = '0';
  const ticks = el('div', 'position:relative;height:6px;flex-basis:100%');
  r3.append(el('span', '', tr('anim.time')), scrub, ticks);
  const read = el('pre', 'margin:4px 0 0;font:11px/1.35 ui-monospace,monospace;white-space:pre-wrap');
  panel.append(title, r1, r2, r3, read);
  const list = el('div', 'position:absolute;right:8px;top:8px;bottom:8px;width:min(46vw,300px);overflow:auto;background:rgba(16,20,26,.82);color:#cfe0f0;font:12px/1.5 system-ui,sans-serif;padding:8px;border-radius:8px;z-index:5;display:none');
  list.className = 'scroll';
  root.append(panel, list);
  let api = null, getP = null, setP = null;
  return {
    bind(a, g, s) {
      api = a; getP = g; setP = s;
      bPlay.onclick = () => api.play(); bPause.onclick = () => api.pause(); bStep.onclick = () => { api.pause(); api.step(1 / 60); };
      pl.onchange = () => api.load(getP().anim, pl.value);
      cl.onchange = () => api.load(cl.value, getP().player);
      cMirror.onchange = () => api.load(getP().anim, getP().player, { mirror: cMirror.checked });
      scrub.oninput = () => api.seek(+scrub.value);
    },
    list(clips, P) {
      pl.innerHTML = ''; for (const p of PLAYER_IDS) { const o = doc.createElement('option'); o.value = p; o.textContent = p; pl.appendChild(o); }
      cl.innerHTML = ''; for (const c of ['loco', ...clips]) { const o = doc.createElement('option'); o.value = c; o.textContent = c; cl.appendChild(o); }
      list.innerHTML = '';
      const ns = {};
      for (const c of clips) { const k = c.split('.')[0]; (ns[k] = ns[k] || []).push(c); }
      list.appendChild(el('div', 'font-weight:600', tr('anim.list')));
      for (const k of Object.keys(ns).sort()) {
        list.appendChild(el('div', 'margin-top:6px;color:#8fb8e0', k));
        for (const c of ns[k]) {
          const a = el('a', 'display:block;color:#e6ecf2;text-decoration:none;padding:2px 0;min-height:24px', c);
          a.href = `?anim=${encodeURIComponent(c)}&player=${P.player}`;
          list.appendChild(a);
        }
      }
      list.style.display = P.anim === 'list' && !P.dribble ? 'block' : 'none';
      panel.style.display = P.ui ? 'block' : 'none';
      if (!P.ui) list.style.display = 'none';
    },
    update(state, P) {
      pl.value = P.player; cl.value = state.mode === 'loco' ? 'loco' : state.clipId; cMirror.checked = P.mirror;
      ticks.innerHTML = '';
      const a = state.animator;
      if (state.mode === 'clip' && a) {
        const src = timingClip(state.clipIdx, P.player, P.mirror);
        if (src) {
          const tm = clipTiming(src);
          scrub.max = String(tm.dur);
          for (const e of tm.events) { const m = el('div', `position:absolute;left:${(100 * e.t / tm.dur).toFixed(2)}%;top:0;width:2px;height:6px;background:#f0c040`); m.title = e.name; ticks.appendChild(m); }
        }
      }
    },
    readout(a, state, P) {
      if (!P.ui) return;
      const L = a.slots[0];
      const v = { x: 0, y: 0, z: 0 };
      const sock = (s) => (a.renderSocket(s, v), v.y.toFixed(3));
      const locks = a.footLocks().map((d) => `${d.side}:${d.locked ? 'L' : '-'} ${(d.locked ? d.slide * 1000 : 0).toFixed(1)}mm`).join('  ');
      if (L.state === 1 && document.activeElement !== scrub) scrub.value = String(L.clock.t);
      read.textContent = [
        `${tr('anim.time')} ${L.clock.t.toFixed(3)}  ${tr('anim.ballMode')} ${BM_NAMES[a.ballMode]}`,
        `${tr('anim.events')} ${state.evLog.slice(-4).map((e) => e.name + '@' + e.t.toFixed(2)).join(' ')}`,
        `${tr('anim.sockets')} ball ${sock(SOCK.ball)} palmR ${sock(SOCK.palm_r)} ankleL ${sock(SOCK.ankle_l)}`,
        `${tr('anim.root')} ${a.rx.toFixed(2)}, ${a.rz.toFixed(2)}  ${tr('anim.jumpY')} ${a.curJumpY().toFixed(3)}`,
        `${tr('anim.footLocks')} ${locks}`,
        `${tr('anim.cpu')} ${a.stats.cpuMs.toFixed(3)} ms  ${state.mode === 'loco' ? tr('anim.loco') + ' ' + (P.dribble ? tr('anim.dribble') + ' ' + P.dribble : P.loco + ' m/s') : ''}`,
      ].join('\n');
    },
  };
}

