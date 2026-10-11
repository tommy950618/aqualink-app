/**
 * @module legends/character
 * One on-court legend (spec v2 §1.4 frozen API, §3.4 assembly, §3.10 draw calls / LOD, [CHR §1.4–§1.8]).
 *
 * Four draw calls on every tier: `body` (SkinnedMesh, groups skin + wet), `kitMesh` (jersey, shorts, socks,
 * accessories, two sneakers in one atlas), `groomMesh` (hair, beard, brows, lashes) — all bound to one `skeleton`
 * with `body.bindMatrix` — (+1 for Kyrie's mouthguard on high while it is visible).
 *
 * API (§1.4): id, info, object, body, kitMesh, groomMesh, skeleton, bones (by name), boneIndex(name), morph
 * (Float32Array(9) in `Pose.expr` order, shared by body & groom; channels the player has no target for are no-ops),
 * morphIndex (name → channel of the baked targets), eyeOffset (Vector2, wet-material uniform), setKit({mode}), kitMode,
 * setLod(n), lod, lodOverride (n | null), lodMode ('auto' play clamps | 'menu' clamps), update(dt), setSweat(s),
 * visible, dims, handWorld(out, side), handsMidWorld(out), headWorld(out), headY(), createShadowProxy(material),
 * setReflectable(on), resetPose(), dispose(), jumpY. Extras: rig (anim/rig.js buildRig of this player), kitTexture,
 * hidden (when true `update` keeps the object invisible), index (header order).
 *
 * One body BufferGeometry per character (CRITIC §3.4): all four LOD index ranges live in one index buffer (covered
 * triangles removed) and an LOD switch only rewrites the two groups' start/count, so the morph texture is built once
 * and nothing is uploaded on a switch. Kit and groom pick their LOD variant with `setDrawRange` (kit: shell LOD1 +
 * low sneakers, groom: inner layers only, when body LOD = 3). `update` is allocation-free.
 */
import * as THREE from '../../vendor/three.module.js';
import { buildRig, SOCK } from '../anim/rig.js';
import { CUT_KEYS } from './format.js';
import { shellSkin, shellPositions, shellMorphs, uvMetric, proxyGeometry } from './shells.js';
import { buildSneaker, PART } from './sneaker.js';
import { SHELL_RECT, atlasMap, mapToAtlas, resolveKit, swatchU, kitTexture } from './kitPainter.js';
import { groomAttributes, GROOM_ORDER } from './groom.js';
import { createSkinMaterial, createWetMaterial, createKitMaterial, createGroomMaterial, setSkinSweat } from './materials.js';
import { trackTexture } from '../render/quality.js';

const LOD_PX = [640, 300, 110];        // hpx needed to enter LOD 0 / 1 / 2 (§3.10)
const HYST = 0.12;                     // ±12 % hysteresis
const _sphere = new THREE.Sphere();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);

/** Shoe cut name in legends.js → sneaker cut. */
const CUT = { low: 'low', 'low-mid': 'low-mid', 'mid-high': 'mid-high', high: 'high' };

function sideSign(side) {
  if (side === 'L' || side === 'l' || side === -1) return -1;
  return 1;
}

export class Character {
  /**
   * @param {Library} lib  (library.js)
   * @param {string} id
   * @param {{kit?: {mode: string}}} [opts]
   */
  constructor(lib, id, opts) {
    const a = lib._assets(id);
    const info = a.info, st = lib.settings, tier = lib.tier;
    this.lib = lib;
    this.id = id;
    this.info = info;
    this.index = a.index;
    this.legend = a.legend;
    this._a = a;
    this.dims = Object.freeze(Object.assign({}, info.dims));
    this.rig = buildRig(info, lib.header.bones);
    this.jumpY = 0;
    this.visible = true;
    this.hidden = false;
    this.lodOverride = null;
    this.lodMode = 'auto';
    this.lod = -1;
    this.eyeOffset = new THREE.Vector2(0, 0);
    this.morph = new Float32Array(9);
    this.kitMode = null;
    this.disposed = false;
    this._pelvisY = info.bones[1].head[1];
    this._proxies = [];

    // ---- skeleton (rest rotations identity: bone.position = head − parent head) ----
    const hb = lib.header.bones;
    this.boneList = [];
    this.bones = {};
    this._boneIdx = {};
    hb.forEach((b, i) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      bone.matrixAutoUpdate = false;
      const h = info.bones[i].head;
      if (b.parent >= 0) {
        const ph = info.bones[b.parent].head;
        bone.position.set(h[0] - ph[0], h[1] - ph[1], h[2] - ph[2]);
        this.boneList[b.parent].add(bone);
      } else bone.position.set(h[0], h[1], h[2]);
      bone.matrix.compose(bone.position, bone.quaternion, bone.scale);
      this.boneList.push(bone);
      this.bones[b.name] = bone;
      this._boneIdx[b.name] = i;
    });
    this._restPos = this.boneList.map((b) => b.position.clone());

    // ---- body ----
    const R = lib._render(a), SR = lib._sharedRender();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(R.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(R.normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(lib.shared.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(SR.color, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(SR.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(SR.skinWeight, 4, true));
    const dict = {};
    if (st.morphs) {
      // always 9 targets (zeros where the player has none) so every player compiles the same program (B56)
      g.morphAttributes.position = R.morph.map((arr, c) => {
        const at = new THREE.BufferAttribute(arr || lib._zeroMorph(), 3);
        at.name = lib.header.morphNames[c];
        if (arr) dict[at.name] = c;
        return at;
      });
      g.morphTargetsRelative = true;
    }
    const worn = this._wornShells();
    const cut = CUT[this.legend.kit.shoes.cut];
    const coverLists = worn.filter((w) => w.shell.cover).map((w) => w.shell.cover);
    const shoeCover = a.data.covers[CUT_KEYS[cut]];
    if (shoeCover) coverLists.push(shoeCover);
    const coverKey = worn.map((w) => w.name).sort().join(',') + '|' + cut;
    const bi = lib._bodyIndex(a, coverKey, coverLists);
    g.setIndex(new THREE.BufferAttribute(bi.index, 1));
    g.addGroup(0, 0, 0);
    g.addGroup(0, 0, 1);
    this._lodGroups = bi.groups;
    this._lodTris = bi.triangles;
    const h = this.dims.heightBarefoot;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.55 * h, 0), 0.85 * h + 0.30);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -0.2, -1.2), new THREE.Vector3(1.2, h + 1.0, 1.2));
    const look = this.legend.look;
    this.skinMaterial = createSkinMaterial(tier, { map: lib._acquireSkin(a), pore: lib.textures.pore, clearcoatMap: a.ccTex, look });
    this.wetMaterial = createWetMaterial(tier, { eyeTex: lib.textures.eye, eyeOffset: this.eyeOffset });
    const body = new THREE.SkinnedMesh(g, [this.skinMaterial, this.wetMaterial]);
    body.name = `${id}:body`;
    if (st.morphs) { body.morphTargetInfluences = this.morph; body.morphTargetDictionary = dict; }
    this.morphIndex = dict;
    this.body = body;

    // ---- kit ----
    this._buildKit(worn, cut);
    // ---- groom ----
    this._buildGroom(R);
    /** Worn shell names (cloth / accessories, then the player's groom shells), e.g. ['jersey', 'shorts', 'socks_high', 'sleeve_r', …, 'hair_inner']. */
    const groomNames = GROOM_ORDER.inner.concat(GROOM_ORDER.outer).filter((n) => !!a.data.shells[n]);
    this.shells = Object.freeze(worn.map((w) => w.name).concat(groomNames));

    // ---- assemble & bind ----
    const object = new THREE.Group();
    object.name = `legend:${id}`;
    object.add(body);
    body.add(this.boneList[0]);
    body.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.boneList);
    body.bind(this.skeleton);
    for (const m of [this.kitMesh, this.groomMesh]) { object.add(m); m.bind(this.skeleton, body.bindMatrix); }
    for (const m of [body, this.kitMesh, this.groomMesh]) {
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.castShadow = false;
      m.receiveShadow = false;
    }
    this.object = object;
    if (st.mouthguard) this._buildMouthguard();
    this.setLod(st.play[1]);
    this.setKit(opts && opts.kit ? opts.kit : { mode: 'classic' });
  }

  /** Worn cloth shells (jersey, shorts, sock variant, accessories) as [{name, shell}] (decoded shared shells). */
  _wornShells() {
    const S = this.lib.shared.shells, K = this.legend.kit, out = [];
    const add = (name) => { if (S[name]) out.push({ name, shell: S[name] }); };
    add('jersey');
    add('shorts');
    // sock shell: the brace variant naming this player, else the plain shell of the configured height
    const plain = `socks_${K.socks.shell}`;
    const brace = Object.keys(S).find((n) => n.startsWith(plain + '_') && S[n].players && S[n].players.includes(this.id));
    add(brace || plain);
    for (const acc of K.accessories) if (acc.shell && acc.worn && S[acc.shell]) add(acc.shell);
    return out;
  }

  /** Kit geometry: worn shells + 2 sneakers (high and low variants), UVs remapped into the atlas (§3.8). */
  _buildKit(worn, cut) {
    const lib = this.lib, a = this._a, sh = lib.shared, tier = lib.tier, st = lib.settings;
    const parts = [];
    this._surfaces = {};
    for (const w of worn) {
      const s = w.shell;
      const P = shellPositions(s, a.data.kept, a.data.keptN);
      const sk = shellSkin(s, sh.skinIndex, sh.skinWeight);
      const map = atlasMap(SHELL_RECT[w.name], s.info.uvRange);
      const uv = new Float32Array(s.n * 2), t2 = [0, 0];
      for (let i = 0; i < s.n; i++) { mapToAtlas(map, s.uv[i * 2], s.uv[i * 2 + 1], t2); uv[i * 2] = t2[0]; uv[i * 2 + 1] = t2[1]; }
      const met = uvMetric(P.position, s.uv, s.index);
      this._surfaces[w.name] = { info: s.info, map, metric: met.metric };
      parts.push({ position: P.position, normal: P.normal, uv, skinIndex: sk.skinIndex, skinWeight: sk.skinWeight,
        full: s.index, low: s.lod1 || s.index });
      if (w.name === 'shorts') this._shortsNumberUV = this._shortsNumberPlacement(s, P.position);
    }
    const maps = { [PART.UPPER]: atlasMap('upper'), [PART.WALL]: atlasMap('soleWall'), [PART.BOTTOM]: atlasMap('soleBottom'), [PART.LIP]: atlasMap('soleWall') };
    const swatch = atlasMap('swatch'), lu = swatchU('lining');
    const shoes = {};
    for (const lod of ['high', 'low']) {
      for (const side of ['l', 'r']) {
        const sn = buildSneaker(this.info.feet, cut, side, lod);
        const uv = new Float32Array(sn.vertexCount * 2), t2 = [0, 0];
        for (let i = 0; i < sn.vertexCount; i++) {
          const p = sn.partId[i];
          if (p === PART.LINING) mapToAtlas(swatch, lu, 0.5, t2);
          else mapToAtlas(maps[p], sn.uv[i * 2], sn.uv[i * 2 + 1], t2);
          uv[i * 2] = t2[0]; uv[i * 2 + 1] = t2[1];
        }
        shoes[lod + side] = { position: sn.position, normal: sn.normal, uv, skinIndex: sn.skinIndex, skinWeight: sn.skinWeight, index: sn.index };
      }
    }
    // vertex layout: shells, then the four sneaker meshes; index: [full block][low block]
    const blocks = parts.slice();
    for (const k of ['highl', 'highr', 'lowl', 'lowr']) blocks.push(shoes[k]);
    let nv = 0;
    for (const b of blocks) { b.base = nv; nv += b.position.length / 3; }
    const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const skinIndex = new Uint8Array(nv * 4), skinWeight = new Float32Array(nv * 4);
    for (const b of blocks) {
      position.set(b.position, b.base * 3); normal.set(b.normal, b.base * 3); uv.set(b.uv, b.base * 2);
      skinIndex.set(b.skinIndex, b.base * 4); skinWeight.set(b.skinWeight, b.base * 4);
    }
    const idx = [];
    const push = (arr, base) => { for (let i = 0; i < arr.length; i++) idx.push(arr[i] + base); };
    for (const p of parts) push(p.full, p.base);
    push(shoes.highl.index, shoes.highl.base); push(shoes.highr.index, shoes.highr.base);
    const fullCount = idx.length;
    for (const p of parts) push(p.low, p.base);
    push(shoes.lowl.index, shoes.lowl.base); push(shoes.lowr.index, shoes.lowr.base);
    this._kitFull = { start: 0, count: fullCount };
    this._kitLow = { start: fullCount, count: idx.length - fullCount };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    g.setIndex(new THREE.BufferAttribute(Uint16Array.from(idx), 1));
    g.boundingSphere = this.body.geometry.boundingSphere.clone();
    g.boundingBox = this.body.geometry.boundingBox.clone();
    const S = st.kit;
    this._kitSize = S;
    this.kitTexture = kitTexture(new Uint8Array(S * S * 4), S, st.aniso);
    trackTexture(this.kitTexture, 4, true);
    this.kitMaterial = createKitMaterial(tier, { map: this.kitTexture, meshNormal: lib.textures.mesh });
    this.kitMesh = new THREE.SkinnedMesh(g, this.kitMaterial);
    this.kitMesh.name = `${this.id}:kit`;
  }

  /**
   * Jordan's shorts number placement: the front-most shorts vertex on the left leg (x > 0.02) 0.10 m above the left
   * hem (lowest left-leg vertex), returned as its shell UV (the spec's u 0.82 does not land on the left leg front in
   * the baked torso-ellipse layout, where the thigh front sits at u ≈ 0.93).
   */
  _shortsNumberPlacement(s, pos) {
    const sn = this.legend.kit.extras.shortsNumber;
    if (!sn) return null;
    const sgn = sn.leg === 'R' ? -1 : 1;
    let yMin = Infinity;
    for (let i = 0; i < s.n; i++) if (pos[i * 3] * sgn > 0.02 && pos[i * 3 + 1] < yMin) yMin = pos[i * 3 + 1];
    const yt = yMin + sn.aboveHemM;
    let best = -1, bz = -Infinity;
    for (let i = 0; i < s.n; i++) {
      if (pos[i * 3] * sgn <= 0.02 || Math.abs(pos[i * 3 + 1] - yt) > 0.012) continue;
      if (pos[i * 3 + 2] > bz) { bz = pos[i * 3 + 2]; best = i; }
    }
    return best >= 0 ? [s.uv[best * 2], s.uv[best * 2 + 1]] : null;
  }

  /** Groom geometry: inner layers, outer layers, lashes; morphs propagated from the body (§3.4, §3.7). */
  _buildGroom(R) {
    const lib = this.lib, a = this._a, sh = lib.shared, st = lib.settings, tier = lib.tier;
    const list = [];
    for (const n of GROOM_ORDER.inner) if (a.data.shells[n]) list.push({ shell: a.data.shells[n], inner: true });
    if (st.groomOuter) for (const n of GROOM_ORDER.outer) if (a.data.shells[n]) list.push({ shell: a.data.shells[n], inner: false });
    if (st.lashes && sh.shells[GROOM_ORDER.lashes]) list.push({ shell: sh.shells[GROOM_ORDER.lashes], inner: false });
    let nv = 0;
    for (const e of list) { e.base = nv; nv += e.shell.n; }
    const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const skinIndex = new Uint8Array(nv * 4), skinWeight = new Float32Array(nv * 4);
    const groom = new Float32Array(nv * 3), groomDF = new Float32Array(nv * 2);
    const morph = st.morphs ? R.keptDeltas.map((d) => (d ? new Float32Array(nv * 3) : null)) : null;
    const idx = [];
    let inner = 0;
    for (const e of list) {
      const s = e.shell, P = shellPositions(s, a.data.kept, a.data.keptN), sk = shellSkin(s, sh.skinIndex, sh.skinWeight), ga = groomAttributes(s);
      position.set(P.position, e.base * 3); normal.set(P.normal, e.base * 3); uv.set(s.uv, e.base * 2);
      skinIndex.set(sk.skinIndex, e.base * 4); skinWeight.set(sk.skinWeight, e.base * 4);
      groom.set(ga.groom, e.base * 3); groomDF.set(ga.groomDF, e.base * 2);
      if (morph) shellMorphs(s, R.keptDeltas).forEach((d, c) => { if (d && morph[c]) morph[c].set(d, e.base * 3); });
      const src = st.groomLod1 ? (s.lod1 || s.index) : s.index;
      for (let i = 0; i < src.length; i++) idx.push(src[i] + e.base);
      if (e.inner) inner = idx.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    g.setAttribute('groom', new THREE.BufferAttribute(groom, 3));
    g.setAttribute('groomDF', new THREE.BufferAttribute(groomDF, 2));
    if (morph) {
      g.morphAttributes.position = morph.map((arr, c) => {
        const at = new THREE.BufferAttribute(arr || lib._zeroMorph(nv), 3);
        at.name = lib.header.morphNames[c];
        return at;
      });
      g.morphTargetsRelative = true;
    }
    g.setIndex(new THREE.BufferAttribute(Uint16Array.from(idx), 1));
    g.boundingSphere = this.body.geometry.boundingSphere.clone();
    g.boundingBox = this.body.geometry.boundingBox.clone();
    this._groomInner = inner;
    this._groomAll = idx.length;
    const look = this.legend.look;
    this.groomMaterial = createGroomMaterial(tier, { strand: lib.textures.strand, color: look.hair, sheenColor: look.sheenColor });
    this.groomMesh = new THREE.SkinnedMesh(g, this.groomMaterial);
    this.groomMesh.name = `${this.id}:groom`;
    if (morph) { this.groomMesh.morphTargetInfluences = this.morph; this.groomMesh.morphTargetDictionary = this.morphIndex; }
  }

  /**
   * Kyrie's mouthguard (§2.7, high tier only): a 3.0 × 2.5 × 0.6 cm slab (12 triangles) on the head bone sharing the
   * wet material (u = 2 → constant eye texel, vertex colour #f2f2f2), protruding ≈ 1.25 cm from the left mouth corner.
   */
  _buildMouthguard() {
    const acc = this.legend.kit.accessories.find((x) => x.id === 'mouthguard');
    if (!acc) return;
    const [wx, wz, wy] = acc.sizeCm.map((c) => c / 100);          // width (x), depth (z), thickness (y)
    const geo = new THREE.BoxGeometry(wx, wy, wz);
    geo.deleteAttribute('normal');
    geo.computeVertexNormals();
    const n = geo.attributes.position.count;
    const uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    const c = new THREE.Color(acc.colors.classic);
    for (let i = 0; i < n; i++) { uv[i * 2] = 2; uv[i * 2 + 1] = 0; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const f = this.info.face, head = this.info.bones[this._boneIdx.head].head;
    const m = new THREE.Mesh(geo, this.wetMaterial);
    m.name = `${this.id}:mouthguard`;
    // centre: halfway to the left corner, 2 mm below the stomion, front edge 1.25 cm beyond the lips; tipped 15° down
    _v.set(f.CH_l[0] * 0.5 - head[0], f.ST[1] - 0.002 - head[1], f.ST[2] + wz / 2 - 0.0125 - head[2]);
    _q.setFromAxisAngle(_w.set(1, 0, 0), 15 * Math.PI / 180);
    m.matrix.compose(_v, _q, _one);
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    m.visible = false;
    this.bones.head.add(m);
    this.mouthguard = m;
  }

  /** Bone index of `name` in the header / skeleton order (−1 if unknown). */
  boneIndex(name) {
    const i = this._boneIdx[name];
    return i === undefined ? -1 : i;
  }

  /**
   * Repaints the kit atlas in place (§3.8: no reallocation): 'classic' | 'allstarA' | 'allstarB' (| 'grey' showcase).
   * @param {{mode: string}} k
   */
  setKit(k) {
    const mode = (k && k.mode) || 'classic';
    const kit = resolveKit(this.legend, mode);
    this.lib._paintKit({ kit, surfaces: this._surfaces, seed: this.index, shortsNumberUV: this._shortsNumberUV }, this._kitSize, this.kitTexture.image.data);
    this.kitTexture.needsUpdate = true;
    this.kitMode = mode;
  }

  /**
   * Body LOD 0..3 (§3.10): points the skin / wet groups at that LOD's index range; kit and groom switch to their low
   * variants at LOD 3. Allocation-free.
   */
  setLod(n) {
    const l = n < 0 ? 0 : n > 3 ? 3 : n | 0;
    if (l === this.lod) return;
    const G = this._lodGroups[l], gr = this.body.geometry.groups;
    gr[0].start = G[0].start; gr[0].count = G[0].count;
    gr[1].start = G[1].start; gr[1].count = G[1].count;
    const kr = l === 3 ? this._kitLow : this._kitFull;
    this.kitMesh.geometry.setDrawRange(kr.start, kr.count);
    this.groomMesh.geometry.setDrawRange(0, l === 3 ? this._groomInner : this._groomAll);
    this.lod = l;
  }

  /** Triangles of the current body LOD (after covering). */
  get bodyTriangles() { return this._lodTris[this.lod]; }

  /**
   * Per frame after `lib.beginFrame` (§3.4): cull sphere (root + (0, 0.55 h + jumpY, 0), r 0.85 h + 0.30), LOD by
   * projected height with ±12 % hysteresis and the tier clamp (unless `lodOverride`), mouthguard visibility.
   */
  update(dt) {
    void dt;
    const o = this.object, cam = this.lib.cam;
    if (this.hidden) { o.visible = false; this.visible = false; return; }
    const h = this.dims.heightBarefoot;
    if (cam.valid) {
      _sphere.center.set(o.position.x, 0.55 * h + this.jumpY, o.position.z);
      _sphere.radius = 0.85 * h + 0.30;
      const vis = this.lib.frustum.intersectsSphere(_sphere);
      o.visible = vis;
      this.visible = vis;
      if (vis) this._autoLod(h);
    } else {
      o.visible = true;
      this.visible = true;
      if (this.lodOverride != null) this.setLod(this.lodOverride);
    }
    if (this.mouthguard) {
      const ci = this.morphIndex.smirk, ji = this.morphIndex.jawOpen;
      this.mouthguard.visible = (ci !== undefined && this.morph[ci] > 0.1) || (ji !== undefined && this.morph[ji] >= 0.15);
    }
  }

  _autoLod(h) {
    if (this.lodOverride != null) { this.setLod(this.lodOverride); return; }
    const cam = this.lib.cam, e = cam.e, o = this.object;
    let hpx;
    if (cam.ortho) hpx = h * cam.orthoPxPerM;
    else {
      const x = o.position.x, y = this._pelvisY + this.jumpY, z = o.position.z;
      const d = -(e[2] * x + e[6] * y + e[10] * z + e[14]);           // view depth of the pelvis
      hpx = h * cam.pxPerM1 / (d > 0.05 ? d : 0.05);
    }
    let l = this.lod < 0 ? 3 : this.lod;
    while (l > 0 && hpx >= LOD_PX[l - 1] * (1 + HYST)) l--;
    while (l < 3 && hpx < LOD_PX[l] * (1 - HYST)) l++;
    const clamp = this.lodMode === 'menu' ? this.lib.settings.menu : this.lib.settings.play;
    if (l < clamp[0]) l = clamp[0];
    if (l > clamp[1]) l = clamp[1];
    this.setLod(l);
  }

  /** Sweat 0..1 (§3.5.5; the game calls this each dead ball with min(1, minutes/8)). */
  setSweat(s) {
    setSkinSweat(this.skinMaterial, this.lib.tier, this.legend.look, s < 0 ? 0 : s > 1 ? 1 : s);
  }

  /** World position of a socket (bone matrixWorld of the chain refreshed first). */
  _socket(sockIdx, out) {
    const k = sockIdx * 4, s = this.rig.sock;
    const bone = this.boneList[s[k]];
    bone.updateWorldMatrix(true, false);
    return out.set(s[k + 1], s[k + 2], s[k + 3]).applyMatrix4(bone.matrixWorld);
  }

  /** v1 helper: `palm_s` socket world position; side +1/'R' right (default), −1/'L' left. */
  handWorld(out, side) {
    return this._socket(sideSign(side) < 0 ? SOCK.palm_l : SOCK.palm_r, out);
  }

  /** v1 helper: midpoint of both `palm_s` sockets. */
  handsMidWorld(out) {
    this._socket(SOCK.palm_l, _w);
    return this._socket(SOCK.palm_r, out).add(_w).multiplyScalar(0.5);
  }

  /** v1 helper: `eyeC` socket + (0, 0.02, −0.03) in head space. */
  headWorld(out) {
    const k = SOCK.eyeC * 4, s = this.rig.sock;
    const bone = this.boneList[s[k]];
    bone.updateWorldMatrix(true, false);
    return out.set(s[k + 1], s[k + 2] + 0.02, s[k + 3] - 0.03).applyMatrix4(bone.matrixWorld);
  }

  /** v1 helper: head bone world y + dims.headCentreAboveHeadBone (no matrix update). */
  headY() {
    return this.bones.head.matrixWorld.elements[13] + this.dims.headCentreAboveHeadBone;
  }

  /**
   * Shadow proxy (§3.4): a SkinnedMesh over the uncovered LOD3 body (compact vertices) on the same skeleton,
   * castShadow, never receives, renderOrder 100. The caller owns `material`; the geometry is disposed with the character.
   */
  createShadowProxy(material) {
    const p = proxyGeometry(this.lib.shared, this._a.data.kept);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(p.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(p.skinWeight, 4, true));
    g.setIndex(new THREE.BufferAttribute(p.index, 1));
    g.boundingSphere = this.body.geometry.boundingSphere.clone();
    const m = new THREE.SkinnedMesh(g, material);
    m.name = `${this.id}:shadowProxy`;
    this.object.add(m);
    m.bind(this.skeleton, this.body.bindMatrix);
    m.castShadow = true;
    m.receiveShadow = false;
    m.renderOrder = 100;
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    this._proxies.push(m);
    return m;
  }

  /** Layer 2 (planar reflection) on body + kit. */
  setReflectable(on) {
    for (const m of [this.body, this.kitMesh]) { if (on) m.layers.enable(2); else m.layers.disable(2); }
  }

  /** Debug only: every bone back to the bind pose (identity rotations). */
  resetPose() {
    for (let i = 0; i < this.boneList.length; i++) {
      const b = this.boneList[i];
      b.position.copy(this._restPos[i]);
      b.quaternion.identity();
      b.scale.set(1, 1, 1);
      b.matrix.compose(b.position, b.quaternion, b.scale);
    }
    this.object.updateMatrixWorld(true);
  }

  /** Removes the object and frees every character-owned GPU resource (§3.4). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.object.parent) this.object.parent.remove(this.object);
    this.body.geometry.dispose();
    this.kitMesh.geometry.dispose();
    this.groomMesh.geometry.dispose();
    for (const p of this._proxies) p.geometry.dispose();
    if (this.mouthguard) this.mouthguard.geometry.dispose();
    this.kitTexture.dispose();
    this.lib._releaseSkin(this._a);
    for (const m of [this.skinMaterial, this.wetMaterial, this.kitMaterial, this.groomMaterial]) m.dispose();
    this.skeleton.dispose();
    this.lib.characters.delete(this);
    this._surfaces = null;
  }
}
