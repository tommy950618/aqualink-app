/**
 * @module showcase
 * `index.html?showcase=1` likeness page (spec v2 §10.4, C23, B28/B29/B39): renders the six legends with the real
 * `src/legends/` runtime, studio lights, frozen time, no crowd / HUD, background #2a2f3a.
 *
 *   runShowcase(root, opts?) → Promise<showcase>   (also exposed as `window.__showcase`)
 *   showcase = { ready, params, lib, characters, setView(view, params?) → Promise, capture(opts?) → dataURL,
 *                montage(crops, height) → dataURL, crops, error }
 *
 * URL / setView parameters: view = lineup | heads | turn | kits | expr | landmarks | lod | gameplay; yaw (rad), kit =
 * classic | allstarA | allstarB | allstar (team A of the default lineup in All-Star A, team B in B) | grey, groom = 0|1,
 * tier (default high), expr = <channel> (ew = weight), id, ids (comma list), yaws (comma list, heads), fov, dist,
 * cell (px), lod (default 0), pose = rest | twist | flex, w, h, dpr, zoom, cy (heads: camera height offset, m), focus = eye | feet (heads).
 *   lineup    near-orthographic lineup: fov 18 at 26 m, players 1.0 m apart, all at `yaw`
 *   heads     6 columns × rows(yaws) scissor grid, cell 360 px, fov 16, distance 1.3 m at eye height, neutral face
 *   expr      6 × 3 grid: the player's signature channel at 1.0, scowl 0.6, blink 1.0
 *   kits      three lineup strips: classic, All-Star A, All-Star B
 *   turn      one player (`id`) in `pose` from yaw 0 / π/2 / π / 3π/2 (tucked-jersey check of §3.8)
 *   landmarks front heads with the header face landmarks as dots
 *   lod       one player (`id`) at LOD 0 / 1 / 2 / 3, full body and head
 *   gameplay  844 × 390 @ DPR 1.5 broadcast framing (cam/broadcast framingPose, standard row) at the CHECK
 *             formation (team A attacking); `crops` = 120-px-tall boxes per player for the likeness crops
 */
import * as THREE from '../vendor/three.module.js';
import { loadLegends } from './legends/library.js';
import { DEFAULT_LINEUP, LEGEND_IDS } from './legends.js';
import { FORMATION, RIM, SLOTS_V2 } from './constants.js';
import { framingPose, framingRow } from './cam/broadcast.js';

const BG = '#2a2f3a';
const SIGNATURE = Object.freeze({ kobe: 'jawJut', jordan: 'tongueOut', lebron: 'roar', giannis: 'roar', yao: 'grin', kyrie: 'smirk' });
const DEFAULTS = Object.freeze({ view: 'lineup', yaw: 0, kit: 'classic', groom: 1, tier: 'high', expr: '', ew: 1, id: 'kobe', ids: '',
  yaws: '0,0.6,1.5708', fov: 0, dist: 0, cell: 360, lod: 0, pose: 'rest', w: 0, h: 0, dpr: 1, zoom: 1, cy: 0, focus: 'eye' });
const NUM = new Set(['yaw', 'groom', 'ew', 'fov', 'dist', 'cell', 'lod', 'w', 'h', 'dpr', 'zoom', 'cy']);

function parseParams(search) {
  const q = new URLSearchParams(search || '');
  const p = Object.assign({}, DEFAULTS);
  for (const k of Object.keys(DEFAULTS)) if (q.has(k)) p[k] = NUM.has(k) ? Number(q.get(k)) : q.get(k);
  return p;
}

/** Studio environment for the PBR speculars: a dark room with key / fill / rim panels, PMREM-filtered (core only). */
function studioEnv(renderer) {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: '#30343c', side: THREE.BackSide }));
  s.add(room);
  const panel = (w, h, color, k, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 1.5, 0);
    s.add(m);
  };
  panel(4, 3, '#fff4e8', 2.5, 4, 5, 7);
  panel(3, 3, '#e8eeff', 1.2, -6, 3, 5);
  panel(3, 4, '#cfe0ff', 1.8, -4, 4, -7);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  s.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt;
}

/**
 * Starts the showcase.
 * @param {HTMLElement} root  host element (a full-window layer is appended to it)
 * @param {{search?: string}} [opts]  query string (defaults to location.search)
 */
export async function runShowcase(root, opts) {
  const o = opts || {};
  const params = parseParams(o.search != null ? o.search : (typeof location !== 'undefined' ? location.search : ''));
  const sc = { ready: false, params, lib: null, characters: {}, crops: {}, error: null, view: null };
  window.__showcase = sc;
  const layer = document.createElement('div');
  layer.style.cssText = `position:fixed;left:0;top:0;right:0;bottom:0;overflow:hidden;background:${BG};z-index:50`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block';
  const labels = document.createElement('div');
  labels.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;font:13px/1.2 Arial,sans-serif;color:#dde3ee';
  layer.appendChild(canvas);
  layer.appendChild(labels);
  root.appendChild(layer);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.setClearColor(BG, 1);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const envRT = studioEnv(renderer);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.30;
  scene.add(new THREE.HemisphereLight('#dfe6ff', '#3a3028', 0.9));
  const key = new THREE.DirectionalLight('#fff4e8', 2.4); key.position.set(2, 4, 5); scene.add(key);
  const fill = new THREE.DirectionalLight('#e8eeff', 0.7); fill.position.set(-4, 2, 3); scene.add(fill);
  const rim = new THREE.DirectionalLight('#cfe0ff', 1.1); rim.position.set(-3, 3, -4); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ color: '#a8784c', roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2;
  floor.visible = false;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(18, 1, 0.05, 200);

  let lib;
  try {
    lib = await loadLegends({ tier: params.tier, renderer, scene, camera });
  } catch (e) {
    sc.error = String(e && e.message ? e.message : e);
    console.warn('showcase: legends failed to load', e);
    throw e;
  }
  sc.lib = lib;
  for (const id of lib.ids) {
    const c = await lib.createCharacter(id, { kit: { mode: 'classic' }, lodMode: 'menu' });
    c.lodOverride = 0;
    c.resetPose();
    scene.add(c.object);
    sc.characters[id] = c;
  }
  const dots = new THREE.Group();
  scene.add(dots);

  const setSize = (w, h, dpr) => {
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    labels.style.width = w + 'px';
    labels.style.height = h + 'px';
  };
  const allHidden = () => { for (const c of Object.values(sc.characters)) c.object.visible = false; };
  const idsOf = (p) => (p.ids ? p.ids.split(',').filter((x) => sc.characters[x]) : lib.ids.slice());
  const label = (html) => { labels.innerHTML = html; };
  const kitFor = (p, id) => {
    if (p.kit === 'allstar') return DEFAULT_LINEUP.a.includes(id) ? 'allstarA' : 'allstarB';
    return p.kit;
  };
  const pose = (c, kind) => {
    c.resetPose();
    if (kind === 'twist') {
      // spine yaw +30° spread over spine_01..03, hip flex 95° on the right thigh (§3.8 tucked-jersey check)
      for (const n of ['spine_01', 'spine_02', 'spine_03']) c.bones[n].quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 10 * Math.PI / 180);
      c.bones.thigh_r.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -95 * Math.PI / 180);
      c.bones.calf_r.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 90 * Math.PI / 180);
    } else if (kind === 'flex') {
      for (const n of ['thigh_l', 'thigh_r']) c.bones[n].quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -95 * Math.PI / 180);
    }
    for (const b of c.boneList) b.matrix.compose(b.position, b.quaternion, b.scale);
    c.object.updateMatrixWorld(true);
  };
  const prepare = (p) => {
    lib.cam.valid = false;                     // static views: no culling / auto LOD (gameplay re-enables)
    for (const [id, c] of Object.entries(sc.characters)) {
      const mode = kitFor(p, id);
      if (c.kitMode !== mode) c.setKit({ mode });
      c.groomMesh.visible = p.groom !== 0;
      c.lodOverride = p.lod;
      c.setLod(p.lod);
      c.morph.fill(0);
      if (p.expr && c.morphIndex[p.expr] !== undefined) c.morph[c.morphIndex[p.expr]] = p.ew;
      c.object.position.set(0, 0, 0);
      c.object.rotation.set(0, 0, 0);
      pose(c, p.pose);
      if (c.mouthguard) c.update(0);
    }
    dots.clear();
    floor.visible = false;
  };
  const renderCell = (x, y, w, h, H) => {
    renderer.setViewport(x, H - y - h, w, h);
    renderer.setScissor(x, H - y - h, w, h);
    renderer.render(scene, camera);
  };
  const finish = () => { renderer.setScissorTest(false); };

  const views = {
    lineup(p) {
      const ids = idsOf(p), W = p.w || 1800, H = p.h || 900;
      setSize(W, H, p.dpr);
      prepare(p);
      ids.forEach((id, i) => {
        const c = sc.characters[id];
        c.object.position.x = (i - (ids.length - 1) / 2) * 1.0;
        c.object.rotation.y = p.yaw;
        c.object.visible = true;
        c.object.updateMatrixWorld(true);
      });
      for (const id of lib.ids) if (!ids.includes(id)) sc.characters[id].object.visible = false;
      camera.fov = p.fov || 18; camera.aspect = W / H; camera.zoom = p.zoom; camera.near = 1; camera.far = 100;
      const d = p.dist || 26;
      camera.position.set(0, 1.15, d); camera.lookAt(0, 1.15, 0); camera.updateProjectionMatrix();
      renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
      renderer.render(scene, camera);
      label(ids.map((id, i) => `<span style="position:absolute;left:${((i + 0.5) / ids.length) * W - 30}px;top:6px">${lib.meta(id).nameEn}</span>`).join(''));
    },
    heads(p, rowsOverride) {
      const ids = idsOf(p), yaws = rowsOverride || p.yaws.split(',').map(Number);
      const cs = p.cell, W = cs * ids.length, H = cs * yaws.length;
      setSize(W, H, p.dpr);
      prepare(p);
      renderer.setScissorTest(true);
      renderer.setClearColor(BG, 1);
      renderer.clear();
      camera.fov = p.fov || 16; camera.aspect = 1; camera.zoom = 1; camera.near = 0.05; camera.far = 20; camera.updateProjectionMatrix();
      const dist = p.dist || 1.3;
      yaws.forEach((yw, r) => ids.forEach((id, col) => {
        allHidden();
        const c = sc.characters[id];
        if (typeof yw === 'object') { c.morph.fill(0); for (const [ch, w] of Object.entries(yw.morph)) if (c.morphIndex[ch] !== undefined) c.morph[c.morphIndex[ch]] = w; c.update(0); }
        c.object.visible = true;
        c.object.rotation.y = typeof yw === 'object' ? yw.yaw : yw;
        c.object.updateMatrixWorld(true);
        const ey = p.focus === 'feet' ? 0.11 : c.dims.eyeY;
        camera.position.set(0, ey - 0.02 + p.cy, dist); camera.lookAt(0, ey - 0.03 + p.cy, 0);
        renderCell(col * cs, r * cs, cs, cs, H);
      }));
      finish();
      label(ids.map((id, i) => `<span style="position:absolute;left:${i * cs + 6}px;top:4px">${lib.meta(id).nameEn}</span>`).join(''));
    },
    expr(p) {
      const ids = idsOf(p);
      const rows = [
        (id) => ({ yaw: 0.25, morph: { [SIGNATURE[id]]: 1 } }),
        () => ({ yaw: 0, morph: { scowl: 0.6 } }),
        () => ({ yaw: 0, morph: { blink: 1 } }),
      ];
      const cs = p.cell, W = cs * ids.length, H = cs * rows.length;
      setSize(W, H, p.dpr);
      prepare(p);
      renderer.setScissorTest(true);
      renderer.clear();
      camera.fov = p.fov || 16; camera.aspect = 1; camera.zoom = 1; camera.near = 0.05; camera.far = 20; camera.updateProjectionMatrix();
      rows.forEach((rf, r) => ids.forEach((id, col) => {
        allHidden();
        const c = sc.characters[id], spec = rf(id);
        c.morph.fill(0);
        for (const [ch, w] of Object.entries(spec.morph)) if (c.morphIndex[ch] !== undefined) c.morph[c.morphIndex[ch]] = w;
        c.update(0);
        c.object.visible = true;
        c.object.rotation.y = spec.yaw;
        c.object.updateMatrixWorld(true);
        const ey = c.dims.eyeY;
        camera.position.set(0, ey - 0.03, p.dist || 1.3); camera.lookAt(0, ey - 0.045, 0);
        renderCell(col * cs, r * cs, cs, cs, H);
        c.morph.fill(0);
      }));
      finish();
      label(ids.map((id, i) => `<span style="position:absolute;left:${i * cs + 6}px;top:4px">${lib.meta(id).nameEn} · ${SIGNATURE[id]}</span>`).join(''));
    },
    kits(p) {
      const ids = idsOf(p), W = p.w || 1800, H = p.h || 1500, rows = ['classic', 'allstarA', 'allstarB'];
      setSize(W, H, p.dpr);
      renderer.setScissorTest(true);
      renderer.clear();
      const rh = Math.floor(H / rows.length);
      rows.forEach((mode, r) => {
        prepare(Object.assign({}, p, { kit: mode }));
        ids.forEach((id, i) => {
          const c = sc.characters[id];
          c.object.position.x = (i - (ids.length - 1) / 2) * 1.0;
          c.object.rotation.y = p.yaw;
          c.object.visible = true;
          c.object.updateMatrixWorld(true);
        });
        camera.fov = 18; camera.aspect = W / rh; camera.zoom = p.zoom; camera.near = 1; camera.far = 100;
        camera.position.set(0, 1.15, 12.5); camera.lookAt(0, 1.15, 0); camera.updateProjectionMatrix();
        renderCell(0, r * rh, W, rh, H);
      });
      finish();
      label(rows.map((m, r) => `<span style="position:absolute;left:8px;top:${r * rh + 6}px">${m}</span>`).join(''));
    },
    turn(p) {
      const id = sc.characters[p.id] ? p.id : 'kobe', cs = p.cell || 480, yaws = [0, Math.PI / 2, Math.PI, 1.5 * Math.PI];
      const W = cs * yaws.length, H = Math.round(cs * 1.6);
      setSize(W, H, p.dpr);
      prepare(p);
      renderer.setScissorTest(true);
      renderer.clear();
      const c = sc.characters[id], h = c.dims.heightBarefoot;
      camera.fov = 20; camera.aspect = cs / H; camera.zoom = 1; camera.near = 0.1; camera.far = 50; camera.updateProjectionMatrix();
      yaws.forEach((yw, i) => {
        allHidden();
        c.object.visible = true;
        c.object.rotation.y = yw;
        c.object.updateMatrixWorld(true);
        const d = (h * 0.62) / Math.tan(10 * Math.PI / 180);
        camera.position.set(0, h * 0.5, d); camera.lookAt(0, h * 0.5, 0);
        renderCell(i * cs, 0, cs, H, H);
      });
      finish();
      label(`<span style="position:absolute;left:8px;top:6px">${lib.meta(id).nameEn} · pose ${p.pose}</span>`);
    },
    landmarks(p) {
      const ids = idsOf(p), cs = p.cell, W = cs * ids.length, H = cs;
      setSize(W, H, p.dpr);
      prepare(p);
      renderer.setScissorTest(true);
      renderer.clear();
      const geo = new THREE.SphereGeometry(0.0012, 8, 6), mat = new THREE.MeshBasicMaterial({ color: '#ff3355', depthTest: false });
      camera.fov = p.fov || 16; camera.aspect = 1; camera.zoom = 1; camera.near = 0.05; camera.far = 20; camera.updateProjectionMatrix();
      ids.forEach((id, col) => {
        allHidden();
        const c = sc.characters[id];
        dots.clear();
        for (const v of Object.values(c.info.face)) { const m = new THREE.Mesh(geo, mat); m.position.set(v[0], v[1], v[2]); m.renderOrder = 10; dots.add(m); }
        c.object.visible = true;
        c.object.updateMatrixWorld(true);
        const ey = c.dims.eyeY;
        camera.position.set(0, ey - 0.02, p.dist || 1.3); camera.lookAt(0, ey - 0.03, 0);
        renderCell(col * cs, 0, cs, cs, H);
      });
      dots.clear();
      geo.dispose(); mat.dispose();
      finish();
      label(ids.map((id, i) => `<span style="position:absolute;left:${i * cs + 6}px;top:4px">${lib.meta(id).nameEn}</span>`).join(''));
    },
    lod(p) {
      const id = sc.characters[p.id] ? p.id : 'kobe', cs = p.cell || 360, W = cs * 4, H = cs * 3;
      setSize(W, H, p.dpr);
      prepare(p);
      renderer.setScissorTest(true);
      renderer.clear();
      const c = sc.characters[id], h = c.dims.heightBarefoot;
      for (let l = 0; l < 4; l++) {
        allHidden();
        c.lodOverride = l; c.setLod(l);
        c.object.visible = true; c.object.rotation.y = 0.35; c.object.updateMatrixWorld(true);
        camera.fov = 20; camera.aspect = cs / (2 * cs); camera.near = 0.1; camera.far = 60; camera.zoom = 1; camera.updateProjectionMatrix();
        const d = (h * 0.58) / Math.tan(10 * Math.PI / 180);
        camera.position.set(0, h * 0.5, d); camera.lookAt(0, h * 0.5, 0);
        renderCell(l * cs, 0, cs, 2 * cs, H);
        camera.fov = 16; camera.aspect = 1; camera.updateProjectionMatrix();
        camera.position.set(0, c.dims.eyeY - 0.02, 1.3); camera.lookAt(0, c.dims.eyeY - 0.03, 0);
        renderCell(l * cs, 2 * cs, cs, cs, H);
      }
      finish();
      label([0, 1, 2, 3].map((l) => `<span style="position:absolute;left:${l * cs + 6}px;top:4px">LOD ${l} · ${c._lodTris[l]} tris</span>`).join(''));
    },
    atlas(p) {
      // debug: the kit atlas of `id` (DataTexture rows are bottom-up → drawn flipped back to canvas order)
      const c = sc.characters[sc.characters[p.id] ? p.id : 'kobe'];
      const mode = kitFor(p, c.id);
      if (c.kitMode !== mode) c.setKit({ mode });
      const img = c.kitTexture.image, S = img.width, W = p.w || S;
      setSize(W, W, 1);
      renderer.setScissorTest(false); renderer.setViewport(0, 0, W, W); renderer.clear();
      const cv = document.createElement('canvas'); cv.width = cv.height = S;
      const g = cv.getContext('2d'), id = g.createImageData(S, S);
      for (let y = 0; y < S; y++) id.data.set(img.data.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
      for (let i = 3; i < id.data.length; i += 4) id.data[i] = 255;
      g.putImageData(id, 0, 0);
      sc.atlasURL = cv.toDataURL('image/png');
      label('');
    },
    gameplay(p) {
      const W = p.w || 844, H = p.h || 390, dpr = p.dpr !== 1 ? p.dpr : 1.5;
      setSize(W, H, dpr);
      prepare(p);
      floor.visible = true;
      const A = DEFAULT_LINEUP.a, B = DEFAULT_LINEUP.b;
      const spots = [FORMATION.HANDLER, SLOTS_V2.leftWing, SLOTS_V2.rightWing];
      const lerp = (s) => ({ x: s.x + (RIM.x - s.x) * FORMATION.DEF_LERP, z: s.z + (RIM.z - s.z) * FORMATION.DEF_LERP });
      const place = (id, s, yaw) => { const c = sc.characters[id]; c.object.position.set(s.x, 0, s.z); c.object.rotation.y = yaw; c.object.visible = true; c.object.updateMatrixWorld(true); };
      A.forEach((id, i) => place(id, spots[i], FORMATION.OFFENSE_YAW));
      B.forEach((id, i) => place(id, lerp(spots[i]), FORMATION.DEFENSE_YAW));
      const pose0 = framingPose(framingRow('standard', W / H), W / H, FORMATION.HANDLER.x, FORMATION.HANDLER.z, {});
      camera.fov = pose0.fov; camera.aspect = W / H; camera.zoom = 1; camera.near = 0.1; camera.far = 120;
      camera.position.set(pose0.px, pose0.py, pose0.pz); camera.lookAt(pose0.lx, pose0.ly, pose0.lz); camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      lib.beginFrame(camera, H * dpr);
      for (const c of Object.values(sc.characters)) { c.lodOverride = null; c.lodMode = 'auto'; c.update(0); c.object.visible = true; }
      renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H);
      renderer.render(scene, camera);
      // crops: projected feet → head top + margins, device pixels
      sc.crops = {};
      const v = new THREE.Vector3();
      for (const id of A.concat(B)) {
        const c = sc.characters[id], x = c.object.position.x, z = c.object.position.z, h = c.dims.heightBarefoot;
        v.set(x, h + 0.08, z).project(camera); const yTop = (1 - v.y) / 2 * H * dpr;
        v.set(x, -0.03, z).project(camera); const yBot = (1 - v.y) / 2 * H * dpr, xc = (v.x + 1) / 2 * W * dpr;
        const hh = yBot - yTop, ww = hh * 0.55;
        sc.crops[id] = [Math.round(xc - ww / 2), Math.round(yTop), Math.round(ww), Math.round(hh)];
        c.lodMode = 'menu'; c.lodOverride = 0;
      }
      floor.visible = false;
      label('');
    },
  };

  /** Re-renders `view` with params merged over the URL params; resolves after two animation frames. */
  sc.setView = async (view, extra) => {
    const p = Object.assign({}, params, extra || {}, { view: view || params.view });
    if (!views[p.view]) throw new Error(`showcase: unknown view ${p.view}`);
    sc.ready = false;
    sc.view = p.view;
    views[p.view](p);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    sc.ready = true;
    return sc.view;
  };
  /** PNG data URL of the whole canvas or of a crop [x, y, w, h] (device px) scaled to `height` px tall. */
  sc.capture = (opt) => {
    if (sc.view === 'atlas') return sc.atlasURL;
    const c = opt && opt.crop;
    if (!c) return canvas.toDataURL('image/png');
    const hh = (opt && opt.height) || c[3], ww = Math.round(c[2] * hh / c[3]);
    const out = document.createElement('canvas');
    out.width = ww; out.height = hh;
    const g = out.getContext('2d');
    g.fillStyle = BG; g.fillRect(0, 0, ww, hh);
    g.drawImage(canvas, c[0], c[1], c[2], c[3], 0, 0, ww, hh);
    return out.toDataURL('image/png');
  };
  /** Side-by-side montage of crops (each scaled to `height` px tall). */
  sc.montage = (crops, height) => {
    const hh = height || 120, list = crops.map((c) => ({ c, w: Math.round(c[2] * hh / c[3]) }));
    const out = document.createElement('canvas');
    out.width = list.reduce((s, e) => s + e.w + 4, 0); out.height = hh;
    const g = out.getContext('2d');
    g.fillStyle = BG; g.fillRect(0, 0, out.width, hh);
    let x = 0;
    for (const e of list) { g.drawImage(canvas, e.c[0], e.c[1], e.c[2], e.c[3], x, 0, e.w, hh); x += e.w + 4; }
    return out.toDataURL('image/png');
  };
  sc.ids = LEGEND_IDS.slice();
  await sc.setView(params.view);
  return sc;
}
