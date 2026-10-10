# CHARACTERS — runtime character system, grooming, kits, likeness (v2 section)

Scope: everything that turns the baked MakeHuman legends into the six on-court players: the shipped asset
layout and runtime loader, skin/eye/hair/beard/brow/lash rendering, kits (jersey, shorts, socks, sneakers,
accessories, All-Star variant), facial expression morph targets, material and draw-call budgets per quality tier,
the likeness tuning pass with numeric targets and a review loop, and every required change to `tools/legends/`.
Poses, clips, look-at and the face-layer *weights* belong to the ANIMATION section; this section supplies the
meshes, morph targets, sockets data and the eye-offset shader that ANIMATION drives.

## Inputs and citation keys

| key | source |
|---|---|
| [POC] | `phaseA.json → poc` (mesh stats, rig notes, runtime format, clothing/hair plan, perf table, risks) |
| [PROF:id] | `phaseA.json → profiles[]` for kobe, jordan, lebron, giannis, yao, kyrie (face, hair, facialHair, accessories, jersey, likenessPriorities) |
| [XCHK] | `phaseA.json → xcheck` (calibration corrections, open issues) |
| [CFG] | `tools/legends/legends.config.json` (current morphs, `meta`, `appearance`, `expressions`) |
| [FMT] | `tools/legends/FORMAT.md` (v1 binary format) |
| [LDR] | `tools/legends/loader-prototype.js` |
| [SHL] | `tools/legends/lib/shells.mjs` (region functions, landmarks `L`, `uvFor`, seam split, edge distance) |
| [BAKE] | `tools/legends/bake.mjs` |
| [SHOT:name] | PoC renders in `test/scratch/legends-poc/shots/` (looked at: `legends_heads.png`, `legends_heads_groom_1.png`, `legends_lineup*.png`, `clothes_*.png`, `lod.png`, `perf_lod_1_w_844_h_390.png`) |
| [R1#n] | `review-r1-all.json` finding n |
| [ANIM] | the ANIMATION section (`sections/animation.md`): 53-bone rig asserted unchanged, morph-only mouth, iris UV offset, 9 expression channels, sockets |
| [M] | measurements made for this section on the baked PoC and `base.obj` (scripts: `scratchpad/nba2k-v2/measure/{uv,profile,lid,eyeball,torso,face,lm,jaw}.mjs`; outputs quoted below) |

---

## 0. Key decisions (summary)

- **D-CHR-1 Rig stays the 53-bone game_engine rig** [ANIM §1.1]. No jaw, eye or tongue bones: jaw, tongue, lips,
  brows and lids move only by **baked morph targets**; the eyes look around by an **iris UV offset**. The mouth
  interior (teeth + tongue) is kept (`keepMouth: true`) so open-mouth expressions show teeth.
- **D-CHR-2 Four draw calls per player on every tier**: `body` SkinnedMesh with 2 groups (`skin`, `wet` =
  eyeballs + teeth + tongue), `kit` SkinnedMesh (jersey, shorts, socks, accessories, sneakers in one atlas),
  `groom` SkinnedMesh (hair, beard, brows, lashes with one shared strand texture). Six players = 24 calls
  (+ the shared blob shadows owned by RENDERING, [R1#4]).
- **D-CHR-3 Skin is painted at load time per player** into a `DataTexture` (RGB albedo + roughness in alpha) by a
  per-pixel JS compositor that reads **masks baked offline in UV space from 3D region functions** (seam-free by
  construction) plus the header's UV landmarks. Sizes: 512 / 1024 / 2048 (low / medium / high).
- **D-CHR-4 Grooming = per-player shells** baked on each player's *morphed* mesh with physical (cm) parameters
  (hairline height, cheek line, neckline), one or two layers (inner dense + outer volume for coils/crew cut),
  density by a rank-threshold strand texture shared by all players, soft edges by hashed alpha. Kobe and Jordan
  get moustache + goatee, Giannis a low-cheek short beard, LeBron/Kyrie full beards, Yao none.
- **D-CHR-5 Kits**: one 1024² (medium) atlas per player painted on a canvas with our own vector **block-numeral
  glyphs** (no fonts for numbers), names on the back in a system font stack, trims drawn along baked boundary
  loops. Sneakers are a **procedural mesh** (high / mid-high / low-mid / low cuts) rigidly skinned to
  `foot_*`/`ball_*`, no logos. All-Star kits repaint the same atlas.
- **D-CHR-6 Expressions**: 9 morph channels in ANIMATION's order (`jawOpen, tongueOut, jawJut, roar, grin, smirk,
  scowl, puff, blink`), baked sparse per player (only the channels that player uses) from MakeHuman modifiers +
  procedural jaw rotation / tongue translation / lid rotation. Shells (beard, brows, lashes, hair) receive the same
  deltas by the `(a, b, t)` blend.
- **D-CHR-7 No sole lift**: shoes are built around the barefoot foot with the outsole on y = 0 so ANIMATION's
  floor (y = 0) and foot IK stay valid; covered foot triangles are removed. Displayed heights use `meta.stats`.
- **D-CHR-8 Likeness is judged numerically and visually**: `measure.mjs --likeness` checks 7 face metrics per player
  against target bands (§10.2), and a screenshot loop with per-player checklists and a blind identification test
  (§10.4) decides when tuning stops.

---

## 1. Assets and runtime loader

### 1.1 Shipped files (`assets/legends/`, committed) [FMT][POC]

| file | content | size budget (raw) |
|---|---|---|
| `legends.json` | header, format **version 2** (§11.1) | ≤ 140 KB (≈ 45 KB gzip) |
| `legends.shared.bin` | v1 shared sections + `mouth` geometry, lashes shell, accessory/sock shells, shell LOD1 indices, procedural eyeball topology | ≤ 800 KB (v1: 627,668 B) |
| `legends.<id>.bin` ×6 | positions (u16q) + normals (oct8) for kept vertices **incl. eyeball/teeth/tongue/lash vertices**, sparse morph deltas, per-player groom shells | ≤ 300 KB each |
| `legends.skin0.png` | shared masks RGB 1024²: R lips, G cavity, B highlight | ≤ 160 KB |
| `legends.skin1.png` | shared masks RGB 512²: R redness, G body AO, B mottle (3D noise) | ≤ 120 KB |
| `legends.skin2.png` | shared masks RGB 512²: R palms, G nails, B 0 (reserved) | ≤ 25 KB |
| `legends.<id>.groom.png` ×6 | per-player RGB 1024²: R scalp-hair density, G beard density, B brow density | ≤ 70 KB each |
| `legends.<id>.extra.png` ×6 | per-player RGB 512²: R tattoo, G scalp gloss, B sweat zones | ≤ 30 KB each |
| `README.md` | CC0 provenance of the MakeHuman data (copied from `tools/legends/README.md` § Licence) + "non-commercial fan project; names and likenesses belong to the players" | — |

Total ≤ 3.5 MB raw (estimate 3.1 MB). PNGs are RGB (colour type 2, no alpha, no gAMA/iCCP chunks) so decoding
through a canvas never premultiplies or colour-converts the data. Every fetch uses
`new URL('../../assets/legends/<file>', import.meta.url)` from `src/legends/library.js` (works next to the page and
inside the artifact wrapper; no absolute URLs, no other origin).

### 1.2 Runtime modules (`src/legends/`, relative imports only, three.js core only)

| file | ≈ lines | exports / role |
|---|---|---|
| `format.js` | 160 | `parseHeader(json)` (asserts `format === 'legends-mesh' && version === 2`), `view(buf, sec)` (types of [FMT] + `i16q` + `u8n*k`), `octDecode`, `decodePlayer(buf, info, shared)` → `{kept: Float32Array, keptN: Float32Array, morphs, shells}` — pure, Node-testable |
| `library.js` | 260 | `loadLegends({tier, onProgress}) → Library`; shared attributes, shared shells, masks, strand/eye/pore textures, `dispose()` |
| `character.js` | 420 | `class Character` (§1.4) |
| `shells.js` | 220 | shell geometry (port of [LDR] `shellGeometry`, `relaxShell`, `coveredGeometry`) + morph propagation + kit/groom geometry merge |
| `skinPainter.js` | 240 | `paintSkin(maskData, player, size) → Uint8Array RGBA` (pure loop, Node-testable) + `skinTexture()` wrapper |
| `kitPainter.js` | 380 | kit atlas painter (§7), `GLYPHS` (§7.3), `KIT_LAYOUT` |
| `sneaker.js` | 260 | `buildSneaker(feet, cut, side, lod) → {position, normal, uv, skinIndex, skinWeight, index, partId}` (pure) |
| `groom.js` | 200 | strand texture generator (§4.2), groom attribute builder, groom material |
| `materials.js` | 220 | skin / wet / kit / groom material factories per tier with the `onBeforeCompile` patches of §9.3 |
| `data.js` | 90 | `LEGEND_IDS`, default teams, kit selection logic (§7.7), names fallback (`meta.nameZh/nameEn` from the header) |

### 1.3 Library API

```js
import { loadLegends } from './legends/library.js';
const lib = await loadLegends({ tier: 'medium', onProgress: (f) => {} });   // f in 0..1
lib.ids;                // ['kobe','jordan','lebron','giannis','yao','kyrie'] (header order)
lib.meta(id);           // header.players[i].meta + dims (§1.6): names, number, listed stats
const c = await lib.createCharacter(id, { kit: { mode: 'classic' | 'allstarA' | 'allstarB' }, lodMode: 'auto' });
lib.beginFrame(camera, viewportHeightPx);  // once per frame: frustum + px-per-metre for LOD/culling
lib.dispose();          // after every Character is disposed
```

Load sequence (progress weights in brackets): header [0.03] → shared bin [0.25] → 6 player bins in parallel
[0.30] → 3 shared PNGs + 12 per-player PNGs via `fetch → blob → createImageBitmap(blob, {premultiplyAlpha:'none',
colorSpaceConversion:'none'})` → drawn once to a scratch canvas → `getImageData` → kept as `Uint8Array` channel
planes, bitmaps `close()`d [0.12] → paint 6 skins (chunked: yield to the event loop every 64 rows) [0.20] → paint 6
kits [0.05] → `renderer.compile(scene, camera)` with all characters added and invisible [0.05].
Each fetch: timeout 20 s, 2 retries after 500 ms and 1500 ms. Any failure (or `!renderer.capabilities.isWebGL2`)
rejects; the game then falls back to the v1 primitive humanoids (`src/humanoid.js` stays in the tree as fallback)
and shows the i18n toast `legendsLoadFailed`. `localStorage` is not touched by this module.

### 1.4 `Character` API

```js
c.id; c.info;                    // header.players[i]
c.object;                        // THREE.Group: the game sets position (x, 0, z) and rotation.y = yaw  [ANIM §1.2]
c.body; c.kitMesh; c.groomMesh;  // SkinnedMeshes, all bound to c.skeleton with body.bindMatrix
c.skeleton; c.bones;             // bones by name (53, identity rest rotations [FMT]); c.boneIndex(name)
c.morph;                         // Float32Array: the SAME array object is assigned to body.morphTargetInfluences and
                                 // groomMesh.morphTargetInfluences; c.morphIndex = body.morphTargetDictionary
c.eyeOffset;                     // THREE.Vector2 uniform (wet material) written by ANIMATION look.js [ANIM §2.6.3]
c.setKit({ mode }) ;             // repaint kit atlas in place (≤ 15 ms medium), shoes/accessory colours included
c.setLod(n); c.lod;              // 0..3; swaps body index (+ kit/groom LOD per §9.2)
c.update(dt);                    // culling (§1.7), LOD (§9.2), sweat, nothing else (pose/face = ANIMATION)
c.setSweat(s);                   // 0..1 (§2.6)
c.visible;                       // result of the last cull test (ANIMATION may skip evaluate() when false)
c.dims;                          // §1.6
c.resetPose();                   // debug only: snaps every bone to rest (never called by gameplay, see [R1#36])
c.dispose();
```

v1 compatibility (used by `ball.js` / `game.js`): `handWorld(out, side)` returns ANIMATION's `palm_s` socket world
position, `handsMidWorld(out)` the midpoint of both `palm_s`, `headWorld(out)` the `eyeC` socket + (0, 0.02, −0.03)
in head space, `headY()` = head bone world y + `dims.headCentreAboveHeadBone` (no matrix update).

Object hierarchy: `object` → `body` (Root bone is its child, [LDR]) + `kitMesh` + `groomMesh`. All
`frustumCulled = false` [POC]; culling is per character (§1.7). `matrixAutoUpdate` of the three meshes = false
(identity), bones per [ANIM §2.9].

### 1.5 Geometry assembly per character

1. **Body**: positions/normals expanded kept → render with `renderToKept` [LDR]; shared `uv`, `skinIndex`,
   `skinWeight` attributes; groups `[skin: body triangles, wet: eyeballs + teeth + tongue]`; `morphAttributes.position`
   = the player's sparse deltas expanded to render vertices (Float32, zeros elsewhere),
   `morphTargetsRelative = true`, no morph normals. LOD geometries and covered variants **copy `morphAttributes`
   and `morphTargetsRelative`** (the [LDR] `coveredGeometry` copies only `attributes` — fix).
2. **Covered triangles** (`hideCovered`, [FMT]): union of cover lists of the worn jersey, shorts, sock shell,
   accessory shells and the per-player `shoeCover` list (§7.6). Cached per player × LOD × cover key [LDR].
3. **Kit**: the worn cloth shells (after `relaxShell`) + 2 sneakers concatenated into one `BufferGeometry`;
   shell UVs remapped into their atlas rect (§7.1); sneaker UVs generated in the shoe rects.
4. **Groom**: worn groom shells (per-player hair inner/outer, beard inner/outer, brows) + shared `lashes` shell
   concatenated; index order **inner layers first, outer layers last** so LOD3 draws `setDrawRange(0, innerCount)`;
   custom attributes `groom` (vec3 family weights) and `groomDF` (vec2 density, fade) (§4.1); `morphAttributes.position` propagated from the body deltas:
   `d = lerp(D[a], D[b], t)` per shell vertex.
5. Shell skin weights: t-blend of a/b influences, top 4, renormalised [LDR] (unchanged).

### 1.6 Per-character dims (computed at load; values from [CFG] meta + [XCHK] + [ANIM §1.5])

| id | barefoot h (m) | listed h | shoulder joints [XCHK] | collisionRadius = 0.5·(shoulderJoints + 0.10) | listed standing reach |
|---|---|---|---|---|---|
| kobe | 1.96 | 1.98 | 0.455 | **0.28** | 2.64 |
| jordan | 1.96 | 1.98 | 0.460 | **0.28** | 2.65 |
| lebron | 2.03 | 2.06 | 0.505 | **0.30** | 2.69 |
| giannis | 2.09 | 2.11 | 0.485 | **0.29** | 2.81 |
| yao | 2.27 | 2.29 | 0.490 | **0.31** (0.30 + 0.01 for his thick waist) | 2.95 |
| kyrie | 1.87 | 1.88 | 0.425 | **0.26** | 2.515 |

`dims` also carries `eyeY` (mean of the `l-eye`/`r-eye` landmarks), `headTopY` and `heightBarefoot`. PHYSICS owns
the separation rule; it should use `rA + rB + 0.06` instead of the fixed 0.80 m ([R1#42]: bodies now differ by up
to 8 cm in half-width). `dims.headCentreAboveHeadBone` = landmark `head` (joint-head cube) → eye centre y + 0.01.

### 1.7 Culling

Per frame `lib.beginFrame(camera, viewportHeightPx)` builds one `Frustum` from
`camera.projectionMatrix × camera.matrixWorldInverse`. `c.update()` tests the sphere
centre = `pelvis` bone world position (read from `bone.matrixWorld.elements[12..14]`, previous frame),
radius = `0.85 · heightBarefoot + 0.10` (covers arms fully overhead and a 0.9 m jump; Yao 2.03 m, Kyrie 1.69 m).
Outside → `object.visible = false`, `c.visible = false` (ANIMATION may then skip `evaluate` but must keep
stepping). Zero allocation (module-scope `Sphere`, `Vector3`).

### 1.8 Dispose

`c.dispose()`: remove `object` from its parent; dispose the character-owned geometries (body LOD/covered
variants are cached per player id in the library with a ref count; dispose when it reaches 0), kit and groom
geometries, skin and kit `DataTexture`s, the four per-character materials (skin, wet, kit, groom),
`skeleton.dispose()` (bone texture). `lib.dispose()`: strand, eye and pore textures, mask planes dropped, shared
attribute references released. Acceptance: after 5 rematches and 5 lineup changes `renderer.info.memory`
returns to the post-load value (± 0) — same method as [R1#4]'s measurement.

---

## 2. Skin

### 2.1 Pipeline

Bake (offline, §11.6): for each mask channel a scalar field `f(p, n)` of the **3D position and normal** is
evaluated per texel by rasterising every body triangle into UV space (barycentric interpolation of the base or
per-player morphed positions), then each channel is dilated 8 px (1024²) / 4 px (512²) into empty texels. Because
the value comes from 3D, both sides of every UV seam get the same value (the head island is cut at the back of the
skull and the under-jaw/neck lies in the torso island [M: 9 UV islands; head island u 0.641–0.994, v 0.149–0.818;
under-chin uv (0.38, 0.95), nape (0.26, 0.95), jaw angle (0.43, 0.95)]).

Runtime (`skinPainter.js`): per player, per texel of the target size S, one pass over `Uint8Array` planes
(masks sampled bilinearly when the mask size ≠ S) → RGBA bytes; rows are written bottom-up (v = 0 first) so the
`DataTexture` needs no flip. Texture: `RGBAFormat`, `UnsignedByteType`, `colorSpace = SRGBColorSpace` (alpha stays
linear), `generateMipmaps = true`, `minFilter = LinearMipmapLinearFilter`, anisotropy 4 (high) / 2 (medium) / 1.
Cost [estimate]: ≈ 40 ops/texel → medium 1M texels ≈ 30 ms per player on a mid phone; done behind the loading bar.

| tier | skin texture | masks read at | memory per player (with mips) |
|---|---|---|---|
| low | 512² (alpha unused, constant roughness) | 512 (downsampled at load) | 1.4 MB |
| medium | 1024² | native | 5.6 MB |
| high | 2048² on non-touch devices, 1024² on touch devices | native, bilinear ×2 | 22.4 MB |

Texel density at 1024² [M]: head 11.6 px/cm (0.86 mm/px), neck 11.2, hands 6.6, torso 6.3, feet 5.4, arms 5.2,
legs 4.6. The MakeHuman layout already gives the head ≈ 2× the torso density, so no UV repack.

### 2.2 Face landmarks (base mesh; obj index → base metres) [M]

Kept-vertex indices are written to the header (§11.1); right-side landmarks are the exact x-mirror (hm08 is
symmetric to 0.00 mm [M]). Names follow anthropometry.

| name | obj | base (x, y, z) m | | name | obj | base (x, y, z) m |
|---|---|---|---|---|---|---|
| G glabella | 237 | (0, .7560, .1534) | | CH_l cheilion | 7174 | (.0230, .6629, .1463) |
| N nasion | 132 | (0, .7323, .1506) | | AL_l alare | 11685 | (.0171, .6932, .1488) |
| PRN pronasale | 297 | (0, .6909, .1681) | | EN_l inner canthus | 7795 | (.0205, .7275, .1346) |
| SN subnasale | 342 | (0, .6792, .1568) | | EX_l outer canthus | 7782 | (.0435, .7277, .1308) |
| LS labrale sup. | 455 | (0, .6696, .1597) | | PS_l upper lid top | 7774 | (.0314, .7325, .1368) |
| ST stomion | 468 | (0, .6630, .1578) | | PI_l lower lid | 7787 | (.0310, .7247, .1361) |
| LI lower vermilion | 492 | (0, .6489, .1557) | | ZY_l cheekbone | 11798 | (.0666, .7123, .0989) |
| SM supramentale | 491 | (0, .6458, .1503) | | GO_l gonion | 7530 | (.0448, .6352, .0325) |
| PG pogonion | 733 | (0, .6388, .1498) | | T_l tragus | 12332 | (.0710, .7121, .0676) |
| ME menton | 5296 | (0, .6177, .1403) | | EL_l ear lobe | 12050 | (.0756, .6909, .0490) |
| FH forehead | 983 | (0, .8014, .1395) | | ET_l ear top | 7565 | (.0740, .7502, .0416) |
| V vertex/crown | 879 | (0, .849, ·) | | OP back of head | 5389 | (0, .744, −.039) |
| EC_l eye centre | joint-l-eye | (.0308, .7284, .1245) | | eyeball radius | helper-l-eye | 0.0150 m (27.6 mm Ø, 8-segment sphere) |

Eye fissure (base): 23.0 mm wide (EN→EX), 7.8 mm tall (PI→PS). Lips (base): upper vermilion 6.6 mm (LS→ST),
lower to LI 14 mm — the lower vermilion border is taken at `LI.y + 0.0010`. These are "initial picks by nearest
vertex"; the landmark debug view (§10.4 shot `landmarks.png`, dots on the LOD0 head) must be checked once and any
index moved to the visually correct vertex before freezing them in `tools/legends/lib/landmarks.mjs`.

Per-player frame for all per-player fields: `Gy = y(G)`, `EC = mean(EC_l, EC_r)`, `headCZ = 0.5·(z(G) + z(OP))`,
azimuth `φ = atan2(|x|, z − headCZ)` ∈ [0, π] (0 = face centre), `CHx = |x(CH_l)|`.

### 2.3 Shared mask fields (evaluated on base.obj; smooth(a, b, x) = smoothstep)

`skin0.R lips`: upper border `yU(x) = LS.y + 0.0008·exp(−((|x|−0.0045)/0.0030)²) − 0.0005·exp(−(x/0.0018)²)
− (LS.y − CH.y)·(|x|/CHx)²`; lower border `yL(x) = LI.y + 0.0010 + (CH.y − LI.y − 0.0010)·(|x|/CHx)^1.6`;
`lips = smooth(−0.0007, 0.0007, yU − y) · smooth(−0.0007, 0.0007, y − yL) · smooth(−0.0005, 0.0010, CHx + 0.0005 − |x|)`,
only for vertices with z > SM.z − 0.004 (includes the inner lip lining).

`skin0.G cavity` = max of: lip seam `0.9·(1 − smooth(0, 0.0012, |y − yS(x)|))` with
`yS(x) = ST.y + (CH.y − ST.y)(|x|/CHx)²`, |x| ≤ CHx + 0.002; mouth-corner pit Gaussian σ 0.0025 at CH → 0.7;
nostrils: ellipse centred (±0.0085, AL.y − 0.0055) radii (0.0045, 0.0022) where nₙ.y < −0.2 → 0.9; alar crease band
0.0008 around the circle centre (±(AL.x − 0.004), AL.y − 0.001), r 0.006 → 0.45; upper lid crease = upper-margin
curve shifted +0.0040 in y and scaled ×1.15 in x about EC, band 0.0015 → 0.5; upper lash line (margin) band
0.0007 → 0.8; lower margin band 0.0006 → 0.4; inner canthus pit σ 0.002 at EN → 0.6; socket ellipse around EC
radii (0.026, 0.018), soft edge 0.008 → 0.25; nasolabial fold: quadratic curve AL(outer) → (CHx + 0.006, CH.y − 0.004)
bowed 0.003 outward, band 0.0012 → 0.35; ear concha (ear vertices more than 0.004 inside the rim) → 0.5; behind-ear
crease → 0.4; mouth cavity lining (inside the mouth region, z < 0.152) → 0.8.

`skin0.B highlight` = max of: forehead ellipse at (0, G.y + 0.022) radii (0.022, 0.016) → 0.7; nose bridge band
0.004 wide N→PRN → 0.6; nose tip σ 0.004 at PRN → 1.0; cheekbones at (±0.040, EC.y − 0.016) radii (0.012, 0.007),
front-facing → 0.6; chin σ 0.006 at PG → 0.5; lower-lip moist spot at (0, ST.y − 0.006) radii (0.007, 0.002) → 0.6;
cupid's-bow ridge band 0.0006 along `yU + 0.0008` → 0.35.

`skin1.R redness`: ears 0.8; nose tip + alae σ 0.012 → 0.6; cheeks at (±0.038, EC.y − 0.025) σ 0.015 → 0.35; 3 mm
ring around the lips → 0.3; lids ellipse radii (0.018, 0.010) around EC → 0.35; knuckles (within 0.006 of any
`*_01`/`*_02` finger joint, dorsal side) → 0.6; fingertips (within 0.012 of `*_03` tails) → 0.5; elbows/knees
(within 0.03 of `lowerarm_*`/`calf_*` heads, dorsal/anterior) → 0.3; palms 0.2.

`skin1.G body AO`: armpit (within 0.05 of `upperarm_*` head and below it) → 0.6; finger webs → 0.5; under chin (y
< ME.y, z > neck front − 0.01) gradient to 0.35; navel σ 0.006 → 0.5; behind knee → 0.3; nostrils 0.4; neck
creases 0.2; between toes 0.5.

`skin1.B mottle`: `0.6·vnoise(p/0.040) + 0.4·vnoise(p/0.012)`, 3D value noise seeded 1337, normalised to 0..1
(seam-free low-frequency variation; UV-space noise would show island seams).

`skin2.R palms`: hand vertices with `dot(n, nPalm) > 0` → `smooth(0, 0.5, dot)` × hand-family weight, where
`nPalm` per hand = ANIMATION's bind palm normal `Z_h` [ANIM §1.4] (e.g. Kobe left `(−0.72, −0.63, 0.00)`).
`skin2.G nails`: vertices weighted > 0.6 to a `*_03` bone, `dot(n, −nPalm) > 0.5`, within 0.011 m of the bone tail → 1.

### 2.4 Per-player masks (evaluated on the player's morphed mesh, §4–§6 define the fields)

`groom.R` scalp-hair density, `groom.G` beard density (incl. jaw shadow), `groom.B` brow density, `extra.R` tattoo,
`extra.G` scalp gloss, `extra.B` sweat zones (forehead above G.y, upper lip, scalp, neck front, chest above the
jersey neckline → 1).

### 2.5 Composite (per texel; colours sRGB 0..1; `mix(a, b, k)`)

```
c = skinHex                                                   // [CFG] appearance.skin
c *= 1 + 0.12·(mottle − 0.5)                                  // ±6 %
c  = mix(c, c·warmTint, redness·warmK)                        // warmTint (1.12, 0.90, 0.86); warmK 0.45, Yao 0.60
c *= 1 − 0.30·ao
c *= 1 − cavityK·0.45·cavity                                  // cavityK: kobe 1.0, jordan 1.0, lebron 1.0, giannis 1.0, kyrie 0.85, yao 0.70
c  = c + (1 − c)·hlK·highlight                                 // hlK 0.10; yao 0.05
c  = mix(c, lipsHex, 0.85·lips)                                // [CFG] appearance.lips
c  = mix(c, palmsHex, 0.90·palms)                              // [CFG] appearance.palms
c  = mix(c, mix(palmsHex, #f0d8d0, 0.4), 0.80·nails)
c  = mix(c, hairHex, scalpDarken·hairDens)                     // §4.4 table
c  = mix(c, beardHex, beardSkinDarken·beardDens)               // §5 table
c  = mix(c, browHex, 0.35·browDens)
c  = mix(c, desat(c, 0.3)·0.82, tattooK·tattoo)                // tattooK: lebron 1.0, kyrie 1.0, others 0
// stubble stipple (texel hash h ∈ [0,1) from integer texel coords, seed = player index):
c  = mix(c, hairHex, 0.25·max(hairDens·stubbleHair, beardDens)·step(0.62, h))   // stubbleHair: kobe 1, lebron 0.5, others 0
rough = skinRoughness                                          // [CFG]: kobe .48, jordan .45, lebron .42, giannis .45, yao .50, kyrie .46
      − 0.10·highlight − 0.15·lips + 0.15·beardDens + 0.10·palms
rough = mix(rough, 0.25, nails); rough = mix(rough, scalpRoughness, gloss)   // jordan scalpRoughness 0.32 [CFG]
alpha = round(255·clamp(rough, 0.2, 0.9))
```

`desat(c, k)` = mix(c, luma(c), k), luma = 0.2126/0.7152/0.0722. Low tier writes RGB only (alpha 255).

### 2.6 Skin materials and sweat (§9.3 has the patches)

- low: `MeshStandardMaterial({map, roughness: skinRoughness, metalness: 0})` (Standard kept so Jordan's scalp
  still gets a highlight).
- medium: `MeshStandardMaterial({map, roughness: 1, metalness: 0, normalMap: pore, normalScale: (0.15, 0.15)})` +
  roughness-from-map-alpha patch. `pore` = shared 256² tangent-space normal map generated once (value noise
  σ 1.2 px dimples, 900 random pores r 0.8–1.6 px depth 0.5), `repeat = (60, 60)` → on the face one tile ≈ 1.5 cm.
- high: `MeshPhysicalMaterial` with the same maps + `sheen 0.25`, `sheenColor #b0503c`, `sheenRoughness 0.8`
  (cheap forward-scatter rim), `clearcoatRoughness 0.30`, `clearcoatMap` = a 256² texture built at load whose R =
  `max(extra.G, extra.B)` (gloss | sweat zones; three samples `.r`), `clearcoat = max(glossBase, 0.30·sweat)` with
  `glossBase` = 0.55 for Jordan (bald sheen, clearcoatRoughness 0.22 for him), 0 for the others.
- Sweat `s = min(1, minutesPlayedByThisPlayer / 8)` (GAME calls `c.setSweat`): `material.roughness = 1 − 0.15·s`
  (multiplies the per-texel roughness), clearcoat as above (high). Jordan's scalp gloss is in the texture
  (roughness 0.32) on medium/high from tip-off.

### 2.7 Seam rules (summary)

1. Masks from 3D fields + 8 px dilation; 2. the base colour fills the whole texture, so gutters are skin-coloured;
3. normals are welded per kept vertex in the bake [FMT] — no lighting seams; 4. pore normal map and stipple are
UV-space (sub-millimetre, invisible at seams); 5. kit seams are hidden under a side stripe (§7.1);
6. groom strand tiles repeat an integer number of times around the head (§4.3).

---

## 3. Eyes

- **Geometry** (bake, §11.4): the 8-segment hm08 eyeballs (radius 15.0 mm base, 27.6 mm Ø [M]) are replaced by a
  smooth UV sphere per eye: 24 segments × 16 rings (medium/high; low uses the LOD index with 12 × 8), centre = the
  player's eye centre (mean of the morphed `helper-*-eye` vertices), radius = the player's measured eyeball radius
  (max distance of those vertices from the centre). Cornea: vertices within 24° of the forward axis are pushed out
  by `0.06·R·cos(π/2·θ/24°)`. Skinned 100 % to `head`. Part of the body geometry, group `wet`.
- **UV** = front-disc projection [BAKE]: `uv = 0.5 + (x − cx, y − cy)/(2R)`. Iris radius **0.225 UV** (13.5 mm Ø on
  the 27.6 mm MakeHuman eyeball = the human 11.7/24 ratio; the PoC's 0.22–0.25 read best [POC][XCHK]).
- **Texture** (shared by all players; 128² low / 256² medium / 512² high; drawn once on a canvas, `CanvasTexture`,
  sRGB, ClampToEdge): sclera radial gradient `#e9e2d8` (r 0) → `#d9c9bc` (r 0.38) → `#b99086` (r 0.5); 14 vessels
  (`#b04a40`, alpha 0.25, width 0.8 px @256, from the rim inward 30 %; high only); iris `#2A1A12` (all six profiles
  are #1e1410–#2B1A12, one shared colour) with 120 radial fibres (alternating `#5a3a26` and `#120a06`, alpha
  0.18), limbal ring = last 12 % of the iris radius darkened to `#0b0705`; pupil radius 0.40 × iris, `#050302`;
  painted catchlight only on low (circle r 0.025 UV at (0.44, 0.58), white alpha 0.85) — medium/high get real
  speculars. Texels in u, v < 0.06 are pure `#e8e2d6` (teeth sample there, see below).
- **No lid shadow is painted on the eyeball** (the iris moves): the lid shadow comes from `skin0.G` (lash line 0.8,
  crease 0.5) and from the 3D lids.
- **Gaze**: per-character `eyeOffset` uniform (vec2) written by ANIMATION look.js [ANIM §2.6.3]; the wet material
  samples `map` at `vMapUv + eyeOffset` for eye vertices (`vMapUv.x < 1.0`) and at a constant `(0.03, 0.03)` for
  teeth/tongue (their UV u is set to 2.0 by the bake). Clamp `|eyeOffset| ≤ (0.12, 0.09)`.
- **Teeth/tongue**: from `helper-upper-teeth` (96 tris), `helper-lower-teeth` (96), `helper-tongue` (448) [M];
  colour via a per-vertex `color` attribute: teeth `#e9e3d4`, gums (teeth vertices with y above the tooth crown
  midline + 3 mm) `#a8504a`, tongue `#b0605a`.
- **Wet material** (per character, one program): medium/high `MeshStandardMaterial({map: eyeTex, vertexColors: true,
  roughness 0.06 (eye) — mouth uses the same value, metalness 0})`; high = `MeshPhysicalMaterial` + `clearcoat 1.0`,
  `clearcoatRoughness 0.03`; low = `MeshLambertMaterial({map})` with the painted catchlight. Teeth are only
  visible when `jawOpen`/`roar`/`grin` > 0.

---

## 4. Hair

### 4.1 Groom system (shared by hair, beard, brows, lashes)

One `groom` SkinnedMesh per player, one material, one **shared strand texture** for the whole game; per-vertex
attributes `groom = (wStraight, wCoil, wStipple)` and `groomDF = (density, fade)` and a per-player uniform `groomColor`
([CFG] `appearance.hair.color`; beards/brows use the same colour: the six configs differ by ≤ 2/255).

Fragment logic (patch of the `map_fragment` chunk, §9.3):
```
vec4 tx   = texture2D(map, vMapUv);                 // R straight, G coil, B stipple: strand RANK (0 = no strand)
float rk  = dot(tx.rgb, vGroom.rgb);                // the family mix of this vertex
float dens = vGroomDF.x;                            // density in 0..1 (coverage)
float a   = smoothstep(1.0 - dens - 0.04, 1.0 - dens + 0.04, rk) * vGroomDF.y;   // .y = edge fade
diffuseColor = vec4(groomColor * (0.70 + 0.60 * tx.a), a);   // tx.a = shade variation 0.35..1
```
`density` keeps a strand iff its random rank ≥ 1 − density (deterministic, no shimmer); `fade` (edge ramp) is the
only soft value. Medium/high: `alphaHash = true` (soft hairlines through hashed coverage, depth-writing, no
sorting); low: `alphaTest = 0.5`. `side = DoubleSide` (lashes/brows are thin), `roughness 0.55`, `metalness 0`;
high adds `sheen 0.3`, `sheenColor #6a5a50` (Yao `#8090a0`, the "cool sheen" of [PROF:yao]).

### 4.2 Strand texture (512² medium; 256² low; 1024² high — all counts/px scale with size/512)

Drawn on 4 canvases (white strokes on black, globalCompositeOperation `lighten` so overlaps keep the max rank),
tileable (every stroke near a border is redrawn at ±512 offsets), then interleaved into one RGBA `DataTexture`
(`RepeatWrapping`, mipmaps, linear colour, `colorSpace NoColorSpace`):

| channel | content | count | geometry | rank |
|---|---|---|---|---|
| R straight | short strands | 2,400 | length 18–30 px, width 1.3–1.9 px, direction +v ± 10°, quadratic bend ± 3 px | uniform (0.02, 1] per strand |
| G coil | coils | 2,800 | arc radius 2.5–4.5 px, sweep 280°–340°, width 1.4–2.0 px; 10 % are 2-turn spirals | uniform |
| B stipple | stubble | 7,000 dots r 0.8–1.4 px + 3,000 strokes 3–5 px | random direction | uniform |
| A shade | value noise | — | cell 32 px, 2 octaves, mapped to 0.35–1.0 | — |

Seed 20260101 (mulberry32); generation ≈ 40 ms at 512².

### 4.3 Groom UV modes (bake, per shell)

- `head-metric` (hair and beard shells): `u = (φs/2π)·Nu` with `φs = atan2(x, z − headCZ)` (signed, seam at the back),
  `Nu = round(headCircumference_at_ET / 0.05)` (≈ 12 tiles; integer so the wrap is seamless, seam triangles get
  `u + Nu` [SHL `splitUvSeam`]); `v = θ·R_h/0.05`, `θ = atan2(y − (EC.y + 0.02), hypot(x, z − headCZ))`,
  `R_h` = mean head radius at EC.y + 0.02. One tile = 5 cm → coils 3–5 mm wide on screen-real scale.
- `brow-local`: `u = s` (across the brow, −1..1 → 0..0.2 tile), `v = t·(browLength/0.05)` along the brow, so R
  strands run along the brow.
- `lash-local`: `u = lid parameter (angle around EC, 0..1)·0.6`, `v = (distance from the lid margin / lash length)·0.04`
  (one strand spans a whole lash).
The loader multiplies stored UVs by the header `uvScale` (the u16 encodings stay in 0..2 [FMT]).

### 4.4 Hairline function (per player, on the morphed mesh, metres)

Hair region `f = y − yH(φ) > 0` ∧ head(+neck_01 for the nape) weight > 0.5 ∧ the [SHL] ear exclusion
(re-parameterised with the player's ear box from T, EL, ET and the ear vertices' z range).
```
φC  = φ(T) − sideburnWidth / r(T)          // temple corner (start of the sideburn); r(T) = hypot(x_T, z_T − headCZ)
yF  = Gy + above + frontCurve·min(1, φ/0.6)²                    // front line
yM  = yF + 0.9·rec·exp(−((φ − 0.68)/0.14)²)                    // temple recession ("M")
yH  = φ < φC                     : yM
      φC ≤ φ < φ(T) − 0.02        : ySB  (square corner: step with 1.5 mm smoothing; round: blend over 0.15 rad)
      φ(T) − 0.02 ≤ φ < φEb + 0.05: ET.y + earGap                // over the ear; φEb = azimuth of the ear's back edge
      φEb + 0.05 ≤ φ < 2.35       : mix(ET.y + earGap, napeY, smooth(φEb + 0.05, 2.35, φ))
      φ ≥ 2.35                    : napeY,   napeY = EL.y − napeBelowLobe
ySB = sideburnBottom: 'mid-ear' → (ET.y + EL.y)/2; 'beard' → beard cheek-line top at the ear (shells meet)
```
Inner-shell `fade` = `smooth(0, fadeMm/1000, edgeDistance)`; outer shells are inset by `insetMm` from the inner
boundary. Nape taper (`napeShape 'taper'`): density × `mix(0.45, 1, smooth(napeY, EL.y, y))`.
Side taper: outer-shell `offsetScale` = `sidesScale` below `ET.y + 0.02`, blending to 1 over 3 cm.

### 4.5 Per-player hair (new `appearance.hair` schema; lengths from [PROF] hair, [CFG] hair)

| | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| style [PROF] | buzz 1–2 mm stubble scalp | bald, sheen | buzz 3–5 mm, receded, under headband | coils 8–12 mm, low fade, edge-up | straight crew 12–18 mm, fringe | coils 8–12 mm, taper, edge-up |
| inner shell offset / family / density / fadeMm | 0.6 mm / stipple 0.7 + straight 0.3 / **0.42** / 4.0 | — | 1.5 mm / stipple 0.5 + coil 0.5 / 0.85 / 3.0 | 1.5 mm / coil / 0.95 / **0.8** | 2.0 mm / straight / 0.98 / 2.0 | 1.5 mm / coil / 0.95 / **0.8** |
| outer shell offset (top) / sidesScale / density / inset / fade | — | — | — | 7.0 mm / 0.20 / 0.55 / 3 mm / 2.5 | 9.0 mm / 0.33 / 0.60 / 0 / 3.0; front 1.5 cm offsetScale × 1.25 (fringe overhang) | 6.0 mm / 0.40 / 0.50 / 2 mm / 2.0 |
| above (cm above glabella) | 6.8 | — | 7.5 | 6.5 | 6.0 | 6.2 |
| frontCurve / rec (cm) | 0.3 / 1.0 | — | 0.4 / 2.5 | 0.1 / 0.5 | 0.0 / 0.4 | 0.0 / 0.3 |
| temple corner | round | — | round (deep M) | **square** | round | **square** |
| sideburn bottom / width (cm) | mid-ear / 1.4 | — | beard / 1.8 | beard / 1.6 | mid-ear / 1.3 | beard / 1.6 |
| earGap (mm) / napeBelowLobe (cm) / nape | 8 / 2.5 / square | — | 5 / 3.0 / square | 4 / 3.5 / taper | 6 / 3.0 / taper | 4 / 3.0 / square |
| scalpDarken (skin under hair) | 0.38 | 0 (stubble ring 0.12, below) | 0.60 | 0.85 | 0.85 | 0.85 |
| scalp roughness (skin) | 0.62 | **0.32**, gloss mask = scalp above Gy + 0.06 | 0.70 | 0.75 | 0.70 | 0.75 |
| colour | #151010 | #0E0A09 | #141010 | #141110 | #121010 | #141010 |

Jordan: no hair shell; `groom.R` = "old hairline" horseshoe (φ > 1.0, EL.y < y < ET.y + 0.04) at density 0.12
[PROF:jordan hair]; `extra.G` gloss = 1 above Gy + 0.06 fading over 2 cm → roughness 0.32, high-tier clearcoat 0.55
(clearcoatRoughness 0.22) on that mask. Kobe: crown sweat sheen = `extra.B` on the scalp (high clearcoat via
sweat). LeBron: the headband (§7.5) covers Gy + 0.040 … Gy + 0.090, so the receded front line at 7.5 cm sits under
the band; hair shows above it and on the sides [PROF:lebron hair]. Giannis/Kyrie: the edge-up is the inner shell's
0.8 mm fade + `groom.R` with the same 0.8 mm edge; outer shells are inset so nothing overhangs the line.

---

## 5. Facial hair (beard shells + skin masks)

All fields on the morphed mesh in the per-player frame (§2.2). `yU(x)`, `yL(x)`, `yS(x)` are §2.3's lip curves
re-evaluated with the player's landmarks. Beard shell offsets use `offsetScale` zones: **chin** (|x| < CHx,
y < ST.y), **cheeks** (rest), blended over 1 cm. Inner layer fade 0.6–1.5 mm (crisp lines), outer layer inset 2 mm.

### 5.1 Components (metres)

- **Moustache band M**: |x| ≤ CHx + 0.003, `yU(x) + 0.0008 ≤ y ≤ min(SN.y − gap, yU(x) + height)`; corner drops
  = ellipses at (±(CHx + 0.002), CH.y − drop/2) radii (0.0025, drop/2).
- **Goatee Gt**: ellipse centred (0, (LI.y + ME.y)/2 + 0.002) radii (w/2, h/2), front-facing (n.z > 0.2); soul patch
  |x| < soulW/2, `SM.y − 0.002 ≤ y ≤ LI.y − 0.0008`.
- **Links Lk**: capsules from (±(CHx + 0.003), CH.y − 0.004) to (±(w/2 − 0.002), PG.y + 0.004), width linkW.
- **Full/short beard F**: below the cheek line `y < lerp(yA, yB, (φ − φA)/(φB − φA))` for φB ≤ φ ≤ φA, above the
  neckline `y > yN(φ) = ME.y − dN + (EL.y − 0.015 − (ME.y − dN))·smooth(0.35, 1.45, φ)`, φ ≤ φ(T) − 0.02, plus the
  sideburn band φC … φ(T) − 0.02 up to the hairline, plus the moustache zone (`yU + 0.001 … SN.y − gap`, |x| ≤ CHx +
  0.006) and the chin; minus the lips dilated by 1.0 mm; minus z < headCZ − 0.02 (back of the neck).
  Points: `A = (φ(T) − dA/r(T), yA)`, `B = (φ(CH) + dB/r(CH), yB)`.
- **Jaw shadow J** (skin only, no shell): band ±0.015 m around the jaw line GO → ME (+ under the chin to
  ME.y − 0.02) → beard density value `jaw`.

### 5.2 Per-player beard (new `appearance.beard` schema) [PROF facialHair]

| | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| style | moustache-goatee | moustache-goatee | full | short-full | none | full |
| components | M + Gt + Lk(0.15) + J | M + Gt + Lk(0.40) | F (+M connected) | F (low line) + M (thin, gap) | J only (stubble shadow) | F (+M connected) |
| moustache height / gap / drop (mm) | 6 / 1.5 / 4 | 7.5 / 1.0 / 5 | to SN − 0.5 / 0.5 / — | 4 / **2.0** / 3 | — | to SN − 0.5 / 0.5 / — |
| moustache density | 0.55 (×0.7 at \|x\| < 4 mm: sparse centre) | 0.85 (×0.8 beyond \|x\| > 15 mm: denser centre) | 0.95 | 0.70 | — | 0.95 |
| goatee w × h / soulW (cm) | 2.5 × 2.0 / 1.0 | 3.0 × 2.5 / 1.2 | — | — | — | — |
| goatee density | 0.60 | 0.85 | — | — | — | — |
| cheek line A: dA (in front of tragus) / yA | — | — | 0.010 / T.y − 0.004 | 0.009 / EL.y + 0.002 (**low**) | — | 0.008 / T.y − 0.002 |
| cheek line B: dB (lateral of CH) / yB | — | — | 0.015 / CH.y + 0.004 | 0.006 / CH.y − 0.006 | — | 0.008 / CH.y + 0.012 (**high, to the moustache corner**) |
| neckline dN below ME | — | — | 0.025 | 0.006 (jaw shadow line) | — | 0.022 (≈ 2 cm above the Adam's apple) |
| zone densities | jaw shadow 0.45 | cheeks 0 | all 0.95 | jaw 0.80, chin 0.90, cheeks 0.35 | upper lip + chin **0.07** | all 0.95 |
| inner layer offset / family | 1.0 mm / stipple 0.6 + straight 0.4 | 1.2 mm / stipple 0.5 + straight 0.5 | 1.5 mm / coil, density × 1.0 | 1.0 mm / coil | — | 1.5 mm / coil |
| outer layer offset chin / cheeks, density | — | — | 6 mm / 3 mm, 0.60 | 2.5 mm / 2.0 mm, 0.50 | — | 6 mm / 3 mm, 0.60 |
| beardSkinDarken | 0.35 | 0.40 | 0.55 | 0.45 | 1.0 (× 0.07 mask) | 0.55 |
| colour | #151010 | #0E0A09 | #120E0C | #141110 | #2a2420 | #121010 |

The current shared full-beard `beard` shell [SHL] is deleted; Kobe/Jordan no longer render a LeBron-style beard
[XCHK correction 15][SHOT:legends_heads_groom_1].

---

## 6. Eyebrows and lashes

Brow shell per player (offset 1.0 mm, `brow-local` UV, R straight strands, fade 0.8 mm at the ends, 0.5 mm along
the edges). With `t = (|x| − (EC.x − 0.013)) / ((EC.x + 0.025) − (EC.x − 0.013))` ∈ [0, 1] (inner end 13 mm medial
of the eye centre, tail 25 mm lateral), centre line `yc(t) = EC.y + gap + arch·4t(1 − t)·k(t) + tail·smooth(0.65, 1, t)`
(`k(t)` = 1, Jordan uses `k = smooth(0.2, 0.7, t)` to put the soft arch in the outer third), half thickness
`h(t) = hIn·(1 − t) + hOut·t` with a rounded inner cap; density `d·(0.75 + 0.25·smooth(0, 0.2, t))·(1 − 0.5·smooth(0.8, 1, t))`.

| (metres) | gap | arch | tail | hIn | hOut | d | shape [CFG] |
|---|---|---|---|---|---|---|---|
| kobe | 0.0235 | 0.0025 | −0.002 | 0.0045 | 0.0020 | 0.80 | straight-low |
| jordan | 0.0225 | 0.0030 | −0.003 | 0.0035 | 0.0015 | 0.70 | thin-low-straight |
| lebron | 0.0225 | 0.0015 | −0.004 | 0.0055 | 0.0030 | 0.95 | thick-low-straight |
| giannis | 0.0225 | 0.0010 | −0.005 | 0.0055 | 0.0028 | 0.90 | thick, outer ends down |
| yao | 0.0235 | 0.0010 | **+0.003** | 0.0055 | 0.0032 | 0.95 | thick, outer ends up |
| kyrie | 0.0235 | 0.0020 | −0.002 | 0.0050 | 0.0028 | 0.95 | thick-low-straight |

(Base-mesh brow centre is ≈ EC.y + 0.0246 [M]; "low" brows sit 1–2 mm lower.) `groom.B` = the same field for
the skin underlayer (§2.5, 0.35 darken).

Lashes: the hm08 `helper-*-eyelashes-1/2` cards (88 + 96 tris per eye [M]) are kept as a **shared** `lashes`
shell (a = b = the helper's kept vertex, t = 0, offset 0) with `lash-local` UV, R straight family, density 0.9,
fade 0 — they follow `blink` because their deltas are baked like any kept vertex. Medium/high only.

---

## 7. Kits

### 7.1 Kit atlas (one per player; 512² low, 1024² medium/high; canvas y down, `v = 1 − y/H`)

| rect (x0, y0, x1, y1) fractions | content | shell UV in the rect |
|---|---|---|
| (0, 0, 1, 0.50) | jersey | `torso-ellipse` u ∈ [−0.04, 1.04] → x, local v (hem 0 → top 1) → y |
| (0, 0.50, 1, 0.74) | shorts | idem |
| (0, 0.74, 0.50, 0.82) | socks (per sock shell) | idem |
| (0.50, 0.74, 0.75, 0.82) | arm sleeve | idem |
| (0.75, 0.74, 1.0, 0.78) | headband | idem |
| (0.75, 0.78, 1.0, 0.82) | wristband | idem |
| (0, 0.82, 0.25, 0.84) | finger tape | flat colour |
| (0.25, 0.82, 1.0, 0.84) | swatches (flat colours: collar lining, mouthguard) | point UVs |
| (0, 0.84, 0.75, 1.0) | sneaker upper (both shoes; right = mirrored) | §7.6 |
| (0.75, 0.84, 1.0, 0.92) / (0.75, 0.92, 1.0, 1.0) | sole side wall / sole bottom | §7.6 |

Gutters: each rect's content is painted 8 px (4 px at 512) beyond its bounds. `torso-ellipse` (bake, §11.5):
`θ = atan2(x/0.135, (z − 0.065)/0.095)` on base.obj (half-width/depth of the base chest [M: y 0.30–0.35:
x ±0.10–0.13, z −0.03…0.16]), `u = frac(θ/2π + 0.75)` → **front centre u = 0.75, back centre 0.25, right side 0.5,
left side 0 ≡ 1 (the seam, under the left side stripe)**; v = `(y − y0)/(y1 − y0)` per shell (jersey y0 −0.087,
y1 0.599; shorts −0.314 … 0.168 base metres). The painter converts metres to pixels with the header's
`perimeter` table (base perimeter at 8 heights) and `vMetres` (base), and draws anything that crosses u = 0/1 twice
(at u and u ± 1). Player-space sizes are converted to base metres with
`kitScaleV = (spine_03.y − pelvis.y)_player / (spine_03.y − pelvis.y)_base` (header `baseBones`).

The PoC's back number looked thin and distorted because the old cylinder UV spread v over ankle → head (1.69 m)
on a square texture [SHOT:clothes_yaw_2.6]; the local v range and the perimeter-aware painter fix it.

### 7.2 Painter order (canvas 2D, then `getImageData`, rows flipped into a `DataTexture` RGBA: rgb = albedo, a = roughness from a parallel grey canvas)

1. Fill each rect with its base colour; roughness: jersey 0.78, shorts 0.72, socks 0.90, sleeve 0.45, headband /
   wristband 0.95 (terry), tape 0.70.
2. Fabric shading: shorts 6 vertical soft folds per leg (width 2–4 cm, luminance ±8 %, seeded); jersey 2 diagonal
   folds under each armhole (±6 %).
3. Side panels / stripes (shorts at u = 0.5 and 0/1; jersey side panel only where the table says).
4. Trims along the shell boundary loops (header `loops`, kinds `neck`, `armhole_l/r`, `hem`, `waist`, `leg_l/r`,
   `cuff`): each band list `[[colour, mm], …]` from the edge inward is stroked as polylines of width
   2·(cumulative width) in descending order (only the inner half is on the cloth).
5. Numbers (§7.3), name (§7.4), small shorts number (Jordan only).
6. Roughness for numbers/letters 0.60 (tackle twill), trims 0.70.
Normal map (medium/high): shared 128² "dazzle mesh" (hexagonal 2 mm holes, depth 0.4), `repeat (90, 90)`,
`normalScale (0.35, 0.35)` on the jersey/shorts; same texture for all players.

### 7.3 Block numerals (vector glyphs, no font dependency)

Grid units: centre-line strokes on a 4 × 8 box (x right, y down), `lineWidth = 1.6 u`, `lineCap 'square'`,
`lineJoin 'miter'` (style `block`: Jordan, LeBron, Kyrie, Giannis, Yao) or `'round'` (style `rounded`: Kobe).
Layers: keyline (Yao only, `lineWidth + 2·0.50 u`, `#000000`) → outline (`lineWidth + 2·0.45 u`) → fill.

| digit | strokes (M = move, L = line, Z = close) |
|---|---|
| 0 | M0,0 L4,0 L4,8 L0,8 Z |
| 1 | M1,1.2 L2.2,0 L2.2,8 (serif style adds M0.8,8 L3.6,8) |
| 2 | M0,0 L4,0 L4,4 L0,4 L0,8 L4,8 |
| 3 | M0,0 L4,0 L4,8 L0,8 ; M1.2,4 L4,4 |
| 4 | M0,0 L0,5 L4,5 ; M3,0 L3,8 |
| 5 | M4,0 L0,0 L0,4 L4,4 L4,8 L0,8 |
| 6 | M4,0 L0,0 L0,8 L4,8 L4,4 L0,4 |
| 7 | M0,0 L4,0 L1.6,8 |
| 8 | M0,0 L4,0 L4,8 L0,8 Z ; M0,4 L4,4 |
| 9 | M4,4 L0,4 L0,0 L4,0 L4,8 L0,8 |

Advance 6.8 u per digit ('1' 4.6 u), glyph height incl. strokes 9.6 u. Heights on the player: **front 0.20 m,
back 0.28 m** ([PROF:jordan jersey] 22/30 cm, rounded to fit all six chests); Jordan's shorts number 0.075 m on
the left leg front (u 0.82, 0.10 m above the hem). Front number centre y = 0.334 base, back number centre 0.315
base, both converted with `kitScaleV`; `serif` style for '1' on Yao's #11 only.

### 7.4 Name on the back

Surnames uppercase: BRYANT, JORDAN, JAMES, ANTETOKOUNMPO, YAO, IRVING (header `meta.nameEn` last token; Yao's
family name). Font `800 <px>px "Arial Narrow","Roboto Condensed","Helvetica Neue",Arial,sans-serif` (system
fonts only; no network), cap height 0.065 m, centred at y = 0.475 base, max width 0.30 m (scaleX squeeze when
wider), arched: each letter placed on a circular arc with 0.015 m sag over the full width (ANTETOKOUNMPO uses
it fully), colour = number colour, no outline.

### 7.5 Per-player classic kits (DARK = LeBron, Kyrie, Giannis; BRIGHT = Jordan, Kobe, Yao) [decision][CFG][PROF jersey]

| | base | number / outline / keyline | neck & armhole bands (edge → in, mm) | shorts side stripe (mm) | waistband / hem | socks (shell, colour) |
|---|---|---|---|---|---|---|
| lebron (away, wine) | #6F263D | #FFB81C / #041E42 / — | #FFB81C 8, #041E42 4 | #041E42 10, #FFB81C 20, #041E42 10 | #FFB81C 6 / #041E42 6 | crew, #111111 |
| kyrie (away, wine) | #6F263D | #FFB81C / #FFFFFF / — | #FFB81C 8, #FFFFFF 3 | #FFFFFF 6, #FFB81C 24, #FFFFFF 6 | #FFB81C 6 / #FFB81C 6 | crew, #FFFFFF |
| giannis (away, green) | #00471B | #EEE1C6 / #FFFFFF / — | #EEE1C6 8, #0077C0 2 | #0077C0 2, #EEE1C6 40, #0077C0 2 | #EEE1C6 6 / #EEE1C6 6 | mid, #FFFFFF |
| jordan (away, red) | #CE1141 | #FFFFFF / #000000 / — | #000000 5, #FFFFFF 3, #000000 5 | #000000 12, #FFFFFF 6 | #000000 8, #FFFFFF 4, #000000 8 / #000000 6 | low, #000000 |
| kobe (home, gold) | #FDB927 | #552583 / #FFFFFF / — (rounded) | #552583 9, #FFFFFF 3 | #FFFFFF 6, #552583 30, #FFFFFF 6 | #552583 40 / #552583 12 | high, #FFFFFF |
| yao (away, red) | #CE1141 | #FFFFFF / #C4CED4 / #000000 | #FFFFFF 6, #C4CED4 4 | #FFFFFF 12, #C4CED4 8, #000000 4 | #FFFFFF 6 / #C4CED4 6 | crew, #FFFFFF (+ ankle brace bulge) |

Jordan extra: 1.5 cm light-blue `#9bc4e2` undershort band below the left/right shorts hem (painted on the hem's
inner 1.5 cm) [CFG kit.undershort]. Sock shells (shared, base metres above the ankle landmark y −0.745):
`socks_low` +0.09, `socks_crew` +0.13, `socks_mid` +0.19, `socks_high` +0.27 (≈ 11 / 16 / 23 / 32 cm on the
players); Kobe and Yao sock `offsetScale` +3 mm bump ±4 cm around the ankle (braces) [PROF:kobe, yao accessories].

### 7.6 Sneakers (procedural, `sneaker.js`)

Inputs per foot (header `players[i].feet`, rest pose, metres): heel `H` (rearmost foot vertex at y ≤ 0.03),
toe `T` (frontmost), `ball` and `ankle` joints, `widthBall` (foot span within ±0.02 of the ball joint),
`widthHeel` (span 0.04 in front of H). Frame: `f = normalize((T − H)_xz)`, lateral `l = ±(up × f)` (mirrored for
the right foot), `L = |T − H|_xz + 0.020`, start 0.006 behind H.

- Outline half-width `w(s)` (s = 0 heel → 1 toe), Catmull-Rom through: s 0 → 0; 0.04 → 0.36·Wh; 0.15 → 0.50·Wh;
  0.35 → 0.47·Wb (medial ×0.92 for s 0.30–0.50: arch); 0.68 → 0.50·Wb (widest); 0.85 → 0.44·Wb; 0.95 → 0.30·Wb;
  1 → 0, with `Wh = widthHeel + 0.012`, `Wb = widthBall + 0.014`; toe centre shifted 0.08·Wb medially for s > 0.8.
- Sole: outsole bottom y = 0.000 (toe spring: +0.012·((s − 0.85)/0.15)² for s > 0.85), outsole top 0.006,
  midsole top 0.026 (heel) → 0.020 (forefoot), side wall flared 0.003 beyond the outline.
- Upper: superellipse sections (exponent 2.6) between the midsole top and the top line. Collar height above the
  floor at the heel `Hc`: **low 0.085, low-mid 0.100, mid-high 0.125, high 0.145**, dipping 0.012 (low: 0.020) at the
  ankle sides (s ≈ 0.18); throat open from s = 0.22 to 0.62; tongue top Hc + 0.010 at s = 0.30; instep / toe-box
  top heights: s 0.62 → 0.080, 0.75 → 0.065, 0.85 → 0.052, 0.95 → 0.038, 1.0 → 0.025. Collar lining: the collar
  ring duplicated 3 mm inward and 15 mm down (swatch colour).
- Tessellation: stations `s_i = 0.5 − 0.5cos(πi/(N − 1))`, N = 22 (medium/high) / 12 (low); 16 / 10 points per
  section; sole perimeter 44 / 24 → ≈ 970 / 320 triangles per shoe.
- Skinning: `sBall` = projection of the ball joint; s < sBall − 0.06 → `foot` 1; s > sBall + 0.03 → `ball` 1;
  linear between. High and mid-high collars (top 30 % of the height for s < 0.3): foot 0.75 + calf 0.25.
- UV: upper `u = s`, `v` = section parameter (0 medial bottom → 0.5 top line → 1 lateral bottom) into the upper rect;
  sole wall `u` = perimeter fraction, `v` = 0 bottom → 1 midsole top; sole bottom planar.
- Cover: per-player `shoeCover_<cut>` list (bake): foot/ball/calf-weighted body vertices with y < Hc − 0.012 →
  removed from the body index (no toes poking through, fewer triangles).
- Colour parts (painted in the upper rect): `upper = c0`, `toe cap (s > 0.86) = c0`, `heel counter (s < 0.16) = c1`,
  `side panel` = abstract curved band from (s 0.12, 55 % height) to (s 0.62, 30 %) width 10 % of the height,
  tapering — **no logo shapes** = c2, `eyestay + lace bars (6 bars, s 0.24–0.60) = c1 / laces c0`, `collar lining = c1`,
  `midsole = #F2F2F0`, `outsole = c2`. Arrays `[c0, c1, c2]` = [CFG] `shoes.home|away`. Overrides: Jordan home
  ("Concord-like"): mudguard (lower 45 % of the upper, s > 0.10) patent `#0a0a0a` roughness **0.10**, side panel
  off, outsole `#a8d8f0` roughness 0.30; Jordan away ("Bred-like"): upper `#0a0a0a` mesh (0.80), patent mudguard
  `#0a0a0a`, heel tab `#CE1141`, midsole `#FFFFFF`, outsole `#CE1141`. Roughness: leather 0.45, mesh 0.75, rubber 0.85.

| cut ([CFG] shoes.cut) | kobe low | jordan mid-high | lebron high | giannis low-mid | yao high | kyrie low |
|---|---|---|---|---|---|---|
| default colourway with the classic kit | home `#FFFFFF,#FDB927,#552583` | away Bred | away `#6F263D,#FFB81C,#111111` | away `#111111,#00471B,#EEE1C6` | away `#CE1141,#FFFFFF,#111111` | away `#111111,#FFB81C,#111111` |

### 7.7 Accessories (shells in the kit mesh unless noted)

| accessory | who (default) | shell / region | offset | colour classic / All-Star A / B |
|---|---|---|---|---|
| compression sleeve | kobe, right arm | `sleeve_r` [SHL] (13 cm below the shoulder joint → wrist) + 2.5 cm cuff band at the top loop (roughness 0.35) | 3 mm | #111111 / #111111 / #111111 (likeness cue, never recoloured) |
| finger tape | kobe, right index + middle | new shared `tape_r_im`: weight(index_01/02_r, middle_01/02_r) > 0.55 | 0.8 mm | home #f4f4f4 [CFG] / #f4f4f4 / #111111 |
| wristband | jordan, left forearm | new shared `wristband_l`: lowerarm_l weight > 0.5, 3.4–11.0 cm (base) below the elbow joint (= 4–13 cm on him, mid-forearm, 9 cm wide) | 4 mm | kit base #CE1141 / #FFFFFF / #111111 |
| headband (high, level) | lebron | `headband_high`: Gy + 0.036 … + 0.082 (base), back edge +0.005 | 6 mm | #111111 / #FFFFFF / #111111 |
| headband (low) | kyrie, **off** (alt only) | `headband_low`: Gy + 0.012 … + 0.048 | 5 mm | #111111 |
| tattoos | lebron (both arms, upper back arch), kyrie (left forearm) | skin `extra.R` (§2.4): LeBron arms = 3D noise blobs 2–6 cm thresholded at 0.45 on `upperarm_*`/`lowerarm_*` (coverage ≈ 70 % upper arms, 35 % forearms), upper-back arch band 26 × 5 cm of illegible blackletter-like blobs at scapula height; Kyrie = 10 × 3 cm dotted bracket pattern mid left forearm | — | darken 12 %, desaturate 30 % [CFG] |
| mouthguard (P2, high tier) | kyrie | small mesh (3.0 × 2.5 × 0.6 cm curved slab) in the wet group, parented to the head, visible only while `smirk` or idle with `jawOpen` ≥ 0.15 | — | #f2f2f2 |

No headband, sleeve or wristband on anyone else [PROF accessories]. Knee pads none.

### 7.8 Kit selection and All-Star variant

`mode 'classic'` = the table in §7.5 (each player's [CFG] `away` or `home` per the decided team colours: LeBron
away, Kyrie away (wine alternate), Giannis away, Jordan away, Kobe home, Yao away). When the lineup differs from
the default (decision), `mode` becomes `allstarA` (team A, the first team on the lineup screen) / `allstarB`
unless the user forces classic:

| | base | number / outline | neck & armhole | shorts stripe | socks | headband / wristband / tape | shoes |
|---|---|---|---|---|---|---|---|
| allstarA | #F4F4F1 | #C9A227 / #111111 (0.30 u) | #C9A227 8, #111111 2 | #C9A227 30 | #FFFFFF | #FFFFFF | player's `home` colourway |
| allstarB | #121212 | #D22630 / #FFFFFF | #D22630 8, #FFFFFF 2 | #D22630 30 | #111111 | #111111 | player's `away` colourway |

Each player keeps his number and name. `c.setKit()` repaints in place (`texture.image.data` overwritten,
`needsUpdate = true`), no reallocation.

---

## 8. Expressions (morph targets)

### 8.1 Channels (order = ANIMATION's `Pose.expr` [ANIM §2.8]); only the listed players get a target baked

| # | name | players | bake recipe (deltas from the player's neutral morphed body; MakeHuman modifiers added on top of [CFG] targets) |
|---|---|---|---|
| 0 | `jawOpen` | all | jaw rotation **18°** about the jaw pivot (default rig `jaw.head` = `joint-mouth` cube, evaluated per player) around the x axis, applied to the jaw field `wJ` (§8.2): `Δ = R(18°·wJ)(p − pivot) + pivot − p`; lower teeth and tongue `wJ = 1` |
| 1 | `tongueOut` | jordan | jaw rotation 11° (= 0.6 jawOpen) + tongue vertices (`wT` = default-rig tongue03–07 weight 1, tongue00–02 0.4) translated `(+0.005, −0.010, +0.030)·wT` (5 mm to his left, 1 cm down, 3 cm out) |
| 2 | `jawJut` | kobe | [CFG] `chin-prognathism +1, mouth-lowerlip-ext +0.4` + jaw-field translation `(0, +0.002, +0.008)·wJ` + `mouth-lowerlip-volume +0.3` |
| 3 | `roar` | lebron, giannis, yao | jaw rotation 22° + `mouth-upperlip-ext +1.0, nose-flaring +0.6, nose-nostrils-width +0.3, mouth-scale-horiz +0.25, mouth-laugh-lines +0.6, eyebrows-trans-down-up −0.8` (Giannis: brows −0.4, wide-eyed [PROF:giannis]) |
| 4 | `grin` | yao, giannis | jaw rotation 6° + `mouth-angles-down-up +1.0, mouth-scale-horiz +0.45, mouth-laugh-lines +0.8, cheek-trans-down-up +0.5, cheek-volume +0.3, mouth-dimples-in-out +0.3, eye-height2 −0.5` (Yao: eye-height1/2/3 −0.7, eyes nearly shut [PROF:yao]) |
| 5 | `smirk` | kyrie, jordan | [CFG kyrie] `asym-mouth-1-l-r +0.4, mouth-angles-down-up +0.15` + `cheek-trans-down-up +0.15` (one-sided by the asym target) |
| 6 | `scowl` | all | `eyebrows-trans-down-up −1.0, eyebrows-angle-down-up −0.6, eye-height1 −0.4, eye-height2 −0.5, eye-height3 −0.4, eye-bag +0.3, cheek-trans-down-up +0.2` |
| 7 | `puff` | yao, lebron | `cheek-volume +1.0, cheek-inner +1.0, mouth-scale-horiz −0.2, mouth-trans-backward-forward +0.2` |
| 8 | `blink` | all | procedural lid rotation (§8.3); upper lash vertices included |

Modifier deltas are computed in OBJ units like the bake's targets and then scaled by the player's uniform scale
(`UNIT·scale` [BAKE]). The [CFG] descriptors `chin/chin-jaw-drop-decr-incr` (Jordan, LeBron, Giannis) are **shape**
modifiers (they lengthen the jaw, the mouth stays shut) and are replaced by the jaw rotation. Signs of
`*-ext-down-up` are verified in the expression debug view (§10.4 `expressions.png`) and flipped in the config if
the lip moves the wrong way.

### 8.2 Jaw field `wJ` (base mesh, shared; head-family vertices only)

`wJ = clamp(max(wDefaultJaw, wLip·mouthRegion, wSide), 0, 1)`:
- `wDefaultJaw`: MPFB `weights.default.json` bone `jaw` (792 body vertices, y 0.537–0.731; chin 0.52, under-chin
  0.44–0.77 [M]); it **does not include the lips** [M: LS…LI midline weights are 0], hence:
- `wLip = smooth(yS(x) + 0.0006, yS(x) − 0.0012, y)` (1 below the lip seam, 0 above), `mouthRegion` = |x| < CHx + 0.006,
  ST.y − 0.03 < y < ST.y + 0.012, z > 0.10 (cavity lining included, split 1 mm below the seam);
- `wSide = smooth(−0.004, 0.012, d)` where `d` = distance below the line CH → jaw pivot in the (z, y) plane, for
  |x| between CHx and the gonion; fades to 0 above the zygomatic level (EC.y − 0.02).
Neck below ME fades from 1 to 0 over 0.035 m.

### 8.3 Blink

Upper-lid vertices (|x − EC.x| < 0.016, above the fissure mid-line `yMid(x) = mix(lower margin, upper margin, 0.35)`,
z > EC.z, within R + 0.010 of EC) rotate about the axis through EC parallel to x by `θ·wL`, `θ = asin((PS.y −
EC.y)/R′) − asin((yMid − EC.y)/R′)` (R′ = distance of the margin from EC; ≈ 34° on the base mesh), `wL = 1` within
2 mm of the margin → 0 at 9 mm above it. Lower-lid vertices within 3 mm of the margin rotate up by 0.25·θ. Upper
lash card vertices use `wL = 1`. Per player (computed on the morphed mesh) so Yao's narrower fissure still closes.

### 8.4 Storage and runtime

Sparse per target: `count`, `kept indices (u16)`, `Δ (i16 × 3, step 0.02 mm)`; vertices with |Δ| < 0.05 mm are
dropped. Expected ≈ 1,500 vertices per target (jaw/tongue ≈ 2,200) → 9–15 KB each, ≤ 75 KB per player.
Loader: expand to Float32 render-vertex arrays; shells get `lerp(Δa, Δb, t)` (beard, brows, lashes, hair move with
the face). Low tier: morph targets are not created (all expression channels are no-ops [ANIM §2.8]).
GPU: three packs morphs into a `DataArrayTexture` (4096 × 4 × n texels) → ≤ 1.6 MB per player at 6 targets.

---

## 9. Materials, draw calls, triangles, LOD

### 9.1 Per-tier table (per player; six players ×6)

| | low | medium | high |
|---|---|---|---|
| draw calls | 4 | 4 | 4 |
| body LOD in play / in menus & replays | 3 / 2 | 2 (≥ 300 px → 1) / 0–1 | 1 (≥ 640 px → 0) / 0 |
| body tris (LOD 0/1/2/3 = 27,036 / 13,658 / 6,688 / 3,490 [POC][XCHK], minus ≈ 5 % covered) | ≈ 3.3k | ≈ 6.4k | ≈ 13.0k |
| wet tris (eyes + mouth) | 340 (12×8 eyes, no mouth) | 2,080 | 2,080 |
| kit tris (jersey 1,518, shorts 1,000, socks ≈ 360, accessories 0–1,100, sneakers 2 × 970) | ≈ 2.1k (shell LOD1 40 %, sneakers 2 × 320) | ≈ 4.8–5.9k | ≈ 4.8–5.9k |
| groom tris (inner + outer + brows 120 + lashes 368) | ≈ 0.6k (inner only, LOD1, no lashes) | 1.1k (Jordan) – 3.7k (LeBron) | same |
| total per player (play) | ≈ 6.4k | ≈ 15k | ≈ 22k |
| total for six (play) | ≈ 38k | ≈ 92k | ≈ 135k |
| skin / kit / strand / eye textures | 512 / 512 / 256 / 128 | 1024 / 1024 / 512 / 256 | 2048 (touch 1024) / 1024 / 1024 / 512 |
| GPU texture memory, six players | ≈ 17 MB | ≈ 70 MB (+ morph textures ≈ 10 MB) | ≈ 190 MB (desktop) |
| morph targets | none | yes | yes |
| skin material | Standard, map only | Standard + rough(alpha) + pore normal | Physical + sheen + clearcoat |
| kit material | Lambert, map | Standard + rough(alpha) + mesh normal | same |
| groom material | Standard, alphaTest 0.5 | Standard, alphaHash | Physical + sheen, alphaHash |
| wet material | Lambert + painted catchlight | Standard r 0.06 | Physical, clearcoat 1 |

The PoC measured LOD1 + full kit for six = 102k triangles and 67 draw calls [POC perf]; this plan is ≈ 92k with
24 draw calls on medium. Tier selection itself is RENDERING's (auto-detect + menu override; it must not judge
from menu frames, [R1#2][R1#12]); this section only consumes `tier`.

### 9.2 LOD selection

`hpx = heightBarefoot · pxPerMetre(at the pelvis depth)`, `pxPerMetre = viewportHeightPx / (2·d·tan(fov/2))`
(perspective, d = view-space depth of the pelvis). Thresholds (device px): LOD0 ≥ 640, LOD1 ≥ 300, LOD2 ≥ 110,
else LOD3; hysteresis: switch up only when 12 % past a threshold, down when 12 % below. Clamps per tier as §9.1.
Kit LOD: shell LOD1 + low sneakers when body LOD = 3. Groom: `setDrawRange(0, innerCount)` (no outer layers, no
lashes) when body LOD = 3. LOD3 is face-unlocked [POC]: never used for portraits.

### 9.3 Shader patches (`onBeforeCompile`, `customProgramCacheKey()` returns the patch id so all players share
programs; exact chunk names of three r186)

- **roughness from map alpha** (skin, kit; medium/high): after `#include <map_fragment>` insert
  `float mapRough = sampledDiffuseColor.a; diffuseColor.a = opacity;`; replace `#include <roughnessmap_fragment>` with
  `float roughnessFactor = roughness * mapRough;`.
- **groom**: vertex: `attribute vec3 groom; attribute vec2 groomDF; varying vec3 vGroom; varying vec2 vGroomDF;`
  assigned after `#include <begin_vertex>`; fragment: replace `#include <map_fragment>` by §4.1's block; uniform
  `groomColor` (per character; same program for all).
- **wet**: replace `#include <map_fragment>` with
  `vec2 euv = vMapUv.x < 1.0 ? vMapUv + eyeOffset : vec2(0.03); vec4 sampledDiffuseColor = texture2D(map, euv); diffuseColor *= sampledDiffuseColor;`
  (+ `vColor` from `vertexColors`); uniform `eyeOffset` (vec2) per character.
All patches are unit-tested by compiling a 1 × 1 render in the acceptance harness (no WebGL errors, programs
count after six players = 4 + other game programs).

---

## 10. Likeness tuning

### 10.1 What the PoC renders show [SHOT:legends_heads.png, legends_heads_groom_1.png, legends_lineup*.png]

- Bodies and heights read correctly (Yao tallest, LeBron broadest, Giannis long-legged, Kyrie compact) [XCHK].
- Skin was a 65 % grey tint of the profile hex (PoC material), so tones look grey/pale (Yao pink-white). v2 uses
  the hex directly (§2.5).
- Kobe and Kyrie heads are nearly identical; Kobe's chin does not project in profile; Kobe's face is the
  **widest-for-its-length** of the six (contrary to "long narrow oval").
- Giannis's lower face is very long ("horse face"): face length 16.5 cm vs 12.7–15.0 for the others [M].
- Yao's eyes are the **largest** opening of the six (10.2 mm tall vs 6.7–7.4) — he needs small narrow eyes.
- Grooming: every beard is the same blocky full beard; hair caps are opaque with hard edges (Kobe's 1.5 mm buzz
  renders as a solid black cap); eyebrows are blocky strips; no lip colour; nostrils/lid lines not darkened.

### 10.2 Face metrics (`measure.mjs --likeness`, new) — baseline [M] → target band

Definitions (on the baked mesh, landmarks §2.2): `faceLW` = (N.y − ME.y) / head breadth at y ∈ [EC.y − 0.028,
EC.y − 0.006] for vertices with z ∈ [headCZ − 0.007, headCZ + 0.073] (the vertex set of [M] `zygSet`);
`chinProj` = PG.z − SN.z (mm); `earOut` = max |x| of the ear set − max |x| of the skull just above the ear (mm);
`fissH` = PS_l.y − PI_l.y (mm); `lipsH` = LS.y − LI.y (mm); `noseIcd` = alar width / 2·|EN.x|.

| metric | kobe | jordan | lebron | giannis | yao | kyrie | ordering rule |
|---|---|---|---|---|---|---|---|
| faceLW baseline → target | 0.74 → **0.80–0.84** | 0.77 → 0.80–0.83 | 0.79 → **0.74–0.78** | 1.02 → **0.86–0.92** | 0.80 → **0.86–0.92** | 0.78 → 0.78–0.82 | LeBron lowest; Giannis, Yao highest |
| chinProj mm | −3.2 → **≥ +1.0** | −6.2 → −5…−2 | −6.6 → −5…−2 | −6.5 → −4…−1 | −6.5 → −5…−2 | −5.9 → −6…−3 | Kobe max by ≥ 3 mm |
| earOut mm | 13.9 → 13–17 | 23.1 → **≥ 27** | 7.5 → ≤ 9 | 18.6 → 20–24 | 26.5 → 23–27 | 10.2 → ≤ 11 | Jordan max; LeBron, Kyrie min |
| fissH mm | 6.7 → 6.0–6.6 | 6.8 → 5.8–6.4 | 7.4 → 6.0–6.6 | 7.0 → 6.4–7.2 | 10.2 → **≤ 6.0** | 7.0 → 6.0–6.6 | Yao min |
| lipsH mm | 26.4 → 26–28 | 27.0 → 28–30 | 28.8 → 29–31 | 32.0 → 29–32 | 26.2 → 25–27 | 25.6 → **28–30** | Yao min |
| headH (cm, calibrated) | 24.0 | 24.5 | 24.5 | 23.2 → **23.2 (target 0.232)** | 26.4 | 23.2 | [XCHK] |
| noseIcd | 1.49 → 1.40–1.48 | 1.50 → 1.52–1.60 | 1.52 → 1.52–1.60 | 1.49 → 1.48–1.56 | 1.40 → 1.40–1.48 | 1.46 → 1.40–1.46 | Jordan, LeBron widest |

(The [M] alar set includes some cheek–nose junction vertices, so `noseIcd` is used for ordering only.)

### 10.3 Morph changes for `legends.config.json` (current → new; re-run `calibrate.mjs --write` afterwards)

- **kobe**: chin/chin-prominent 0.45 → 0.65; chin-prognathism 0.35 → 0.55; chin-height 0.20 → 0.45; chin-bones
  0.35 → 0.45; head/head-scale-horiz −0.15 → −0.30; head-fat −0.40 → −0.50; cheek/cheek-volume −0.45 → −0.60;
  cheek-bones 0.45 → 0.55; eyes/eye-push1-in-out −0.20 → −0.35; eye-height2 −0.25 → −0.35;
  eyebrows-trans-down-up −0.20 → −0.30; mouth-scale-horiz 0.20 → 0.30; nose-flaring 0.35 → 0.25;
  `meta.calibration.craniumFace` 0.98 → **0.95** (more face, less crown).
- **jordan**: ears/ear-wing 0.60 → 0.85; ear-flap 0.30 → 0.45; ear-scale 0.45 → 0.55; chin-height 0.25 → 0.40;
  head-scale-horiz −0.12 → −0.20; eye-eyefold-down-up −0.30 → −0.45; eye-height2 −0.20 → −0.30;
  nose-flaring 0.50 → 0.65; nose-scale-horiz 0.35 → 0.45; mouth-lowerlip-volume 0.45 → 0.55;
  cheek-volume −0.35 → −0.45.
- **lebron**: head-square 0.55 → 0.70; chin-width 0.50 → 0.60; head-scale-horiz 0.15 → 0.25;
  eyebrows-trans-backward-forward 0.45 → 0.60 (heavier brow ridge); eye-push1 −0.20 → −0.35; eye-height2
  −0.25 → −0.40; eye-eyefold −0.30 → −0.45; ear-flap −0.35 → −0.50; nose-scale-vert 0.20 → 0.30.
- **giannis**: chin-height 0.85 → **0.55**; head-scale-horiz −0.25 → −0.30; head-back-scale-depth 0.10 → −0.15
  (flat-ish back [PROF]); ear-wing 0.35 → 0.55; cheek-volume −0.45 → −0.55; `meta.calibration.headH` 0.236 →
  **0.232**, `craniumFace` 1.05 → **1.10** (the calibrated head knobs then trade face length for crown; target 9.0
  heads tall kept: 2.09 / 0.232 = 9.0).
- **yao**: eyes/eye-height1 0 → −0.40; eye-height2 −0.25 → −0.65; eye-height3 0 → −0.40; eye-scale −0.20 → −0.35;
  eye-epicanthus-in-out 0.20 → 0.40; eye-eyefold −0.30 → −0.50; chin-height 0.35 → 0.55; head-rectangular
  0.45 → 0.60; head-scale-horiz −0.10 → −0.20; nose-scale-horiz 0.15 → 0.30; nose-point-width 0.30 → 0.40;
  nose-scale-vert 0.35 → 0.45; mouth-scale-horiz 0.25 → 0.35.
- **kyrie**: head-oval 0.50 → 0.60; head-scale-horiz −0.15 → −0.25; chin-height 0.10 → 0.20; chin-width −0.05 →
  −0.15; cheek-bones 0.35 → 0.50; cheek-volume −0.30 → −0.45; mouth-lowerlip-volume 0.40 → 0.50;
  mouth-upperlip-volume 0.35 → 0.45; eye-eyefold −0.20 → −0.40; ear-flap −0.25 → −0.35.

Each step changes a modifier by at most ±0.30 per review round; values stay in [−1, 1] (one-sided ≥ 0).
`appearance.*` grooming values are §4.5 / §5.2 / §6 / §7.5; [CFG] `appearance.hair.coverage` is replaced by the
per-layer densities.

### 10.4 Review loop

Committed tooling: `test/likeness/likeness.html` (port of the PoC `legends.html` using the real `src/legends/`
modules, high tier, LOD0, final materials) and `test/likeness/shoot.cjs` (Playwright, headless Chromium,
outputs to `test/likeness/out/`, gitignored). Shots:

| file | content |
|---|---|
| `heads.png` | 6 columns × 3 rows (yaw 0, 0.6, π/2), 360 × 360 px each, FOV 16°, distance 1.3 m, studio key/fill/rim of the PoC, neutral face |
| `expressions.png` | 6 columns × 3 rows: the player's signature channel at 1.0, `scowl` 0.6, `blink` 1.0 |
| `lineup_kit_front.png`, `lineup_kit_back.png` | orthographic lineup in classic kits (numbers, names, socks, shoes, accessories) |
| `lineup_allstar.png` | All-Star A/B |
| `gameplay.png` | 844 × 390 @ DPR 1.5, the game camera, players at the CHECK formation; plus `crop_<id>.png` 120 px tall |
| `grey_crops.png` | same crops with every kit forced to neutral grey #808080 and numbers off (body/head/hair only) |
| `landmarks.png` | LOD0 heads with the §2.2 landmark dots (one-time index check) |

Per-player checklist (each pass / partial / fail; derived from [PROF] likenessPriorities):

- **kobe**: K1 smooth dark-stubble scalp (not glossy, not a solid cap), long narrow oval head, visible hairline
  6.8 cm above the brow with mild M; K2 chin forward of the subnasale in profile (chinProj ≥ +1 mm), long strong
  lower face; K3 thin moustache + small goatee, faint jaw shadow, no full beard; K4 hollow cheeks under high
  cheekbones, low straight brows, narrowed deep-set eyes; K5 gold #24 with purple numbers + white outline, black
  right sleeve, white tape on right index + middle, low-tops, high white socks; K6 `jawJut` thrusts the chin ≈ 1 cm.
- **jordan**: J1 shiny bald egg head with a visible specular highlight, no hair shell; J2 largest protruding ears
  (earOut ≥ 27 mm, max of six); J3 thin moustache + small goatee + faint linking lines, clean cheeks; J4 broad
  flared nose, full lower lip, hooded low brows; J5 red #23 white/black, baggy knee shorts, red wristband mid left
  forearm, black patent mid-highs with red outsole, low black socks; J6 `tongueOut` tongue visible outside the
  lips, to one side.
- **lebron**: L1 broadest shoulders, thick neck/traps; L2 black headband high and level, receded buzz visible
  above it at the sides/crown, no hair below the band at the front; L3 full dense beard, crisp high cheek line,
  connected thick moustache, squared chin, neckline ≈ 2.5 cm under the jaw; L4 heavy straight brow over deep-set
  hooded eyes, broad nose; L5 wine #23 gold/navy, darkened tattooed arms; L6 `roar` teeth visible, brows down.
- **giannis**: G1 small head (9.0 heads) on a long neck; G2 tight ≈ 1 cm coils on top, faded sides, crisp straight
  edge-up with square temples; G3 short close beard with LOW cheek line (upper cheeks bare), thin moustache with a
  gap under the nose; G4 long but not horse-like face (faceLW 0.86–0.92), high cheekbones, hollow cheeks,
  protruding ears; G5 green #34 cream/white, bare arms, white socks, long low-mid shoes; G6 wide-eyed `roar`,
  `grin` for menu cards.
- **yao**: Y1 tallest, small head, long neck; Y2 jet-black straight crew cut ≈ 1.5 cm with a straight hairline,
  flat-ish top, tapered sides, ears exposed; Y3 small narrow monolid eyes (fissH ≤ 6 mm, min of six), thick low
  straight brows tilting up at the outer ends; Y4 long rectangular face (faceLW 0.86–0.92), long chin, large
  protruding ears, long nose with a broad tip; Y5 clean-shaven light warm-tan skin #D8A985, red #11 white/silver +
  black keyline, baggy shorts, white socks with ankle bulge, red high-tops; Y6 `grin` squeezes the eyes nearly shut.
- **kyrie**: I1 full dense groomed beard, sharp high cheek line, connected moustache — a clear dark jaw mass at
  120 px; I2 shortest and compact, thick thighs; I3 short coiled crop with a crisp edge-up and square temples, no
  headband; I4 slim oval face (narrower than LeBron/Giannis), high cheekbones, full lips (lipsH ≥ 28 mm),
  heavy-lidded calm eyes, skin #8A5A3B lighter than Jordan/LeBron/Giannis; I5 wine #2 gold/white, low-cut black/gold
  shoes, white crew socks; I6 asymmetric `smirk`.

Judging (a reviewer subagent with image input plus the human; no real photos are stored in the repo):
1. `measure.mjs --likeness` exits 0 (all §10.2 bands met, orderings hold).
2. Checklists: per player ≥ 5 of 6 pass and no fail among items 1–3.
3. Blind identification: the six `heads.png` columns shuffled with names hidden → 6/6 correct; `grey_crops.png`
   (no kit colours/numbers) → ≥ 5/6; `crop_<id>.png` with kits → 6/6.
4. Grooming sanity: no visible hard cap edge at the hairline at 360 px (inner fade 0.8–4 mm), Kobe's and Jordan's
   beards are not full beards, Yao has no beard shell.
Loop: max 4 rounds; each round = edit config (≤ ±0.30 per modifier) → `bake` → `calibrate --write` (if head or
face-length modifiers changed) → `measure --likeness` → shots → checklist. If round 4 still fails an item, record
it as a known gap in the phase-D report rather than exceeding the modifier step.

---

## 11. Required changes to `tools/legends/`

### 11.1 Format version 2 (`bake.mjs`, `FORMAT.md`)

- `header.version = 2`; the runtime rejects v1.
- `shared.groups = [{name:'body', material:'skin'}, {name:'wet', material:'wet'}]`; `wet` = procedural eyeballs +
  teeth + tongue (eyelash helpers are kept vertices but only in the `lashes` shell).
- New top-level keys: `landmarks: {<name>: {obj, kept, base:[x,y,z], uv:[u,v]}}` (§2.2, right side mirrored);
  `uvIslands: [{rect:[u0,v0,u1,v1], tris, region}]`; `masks: {skin0|skin1|skin2: {file, size, channels}}`;
  `morphNames` = the 9 names in §8.1 order; `baseBones` (bone heads on base.obj) and `baseScaleRefs`
  (base head height 0.2313 m, crown→ME).
- `shells[i]` += `uvRange`, `uvScale`, `perimeter: [[y, P] × 8]`, `loops: [{kind, uv: [[u, v], …] (unwrapped)}]`,
  `lods: [{ratio, section}]`, `groom: {family:[r,g,b], density section | constant, fade section}`, `players?: [ids]`.
- `players[i]` += `eyes: {l: {c, r}, r: {c, r}}`, `feet: {l|r: {heel, toe, ball, ankle, widthBall, widthHeel}}`,
  `face: {<landmark>: [x, y, z]}`, `morphs: {targets: [{name, count, offset}], section}`,
  `shells: [...]` (per-player groom shells, sections in the player bin), `covers: {shoeCover_<cut>: section}`,
  `masks: {groom: {file, size}, extra: {file, size}}`, `dims` (§1.6 inputs: shoulder joints, collision radius).
- New section types: `i16q` (int16 × 0.00002 m, morph deltas), `u8n*k` generalised for shell attributes.

### 11.2 Mouth and eyes (`bake.mjs`)

- `keepMouth: true` in `legends.config.json`; mouth helper groups go into the `wet` group with `color` per §3;
  teeth/tongue UV u = 2.0.
- Replace the eye helper triangles by generated 24 × 16 UV spheres per eye (+ LOD 12 × 8 index range for low),
  centre/radius measured per player from the morphed helper vertices, cornea bulge (§3), UV front-disc; the new
  vertices are appended to the kept set (positions per player in the player bin, skin weight head = 255).
- Keep `helper-*-eyelashes-1/2` vertices in the kept set (no body triangles) for the `lashes` shell.

### 11.3 Landmarks (`lib/landmarks.mjs`, new)

Exports the §2.2 table (obj indices), `mirrorIndex(obj)` (exact x-mirror search on base.obj, cached), the
derived per-player frame (§2.2) and ear vertex set selection `|x| > 0.071 ∧ 0.682 < y < 0.746 ∧ 0.016 < z < 0.075`
(base). Used by shells, masks, morphs and `measure.mjs`.

### 11.4 Per-player shells (`lib/shells.mjs`)

- `buildShells` takes `{pos, normals, frame}` so region functions can run on a **player's morphed kept positions**
  (metres) with the per-player frame; shared shells keep running on base.obj.
- New region builders parameterised by config: `hairInner/hairOuter(params)` (§4.4), `beardInner/beardOuter(params)`
  (§5.1), `brows(params)` (§6), `lashes` (helper cards, a = b), `socks_low|crew|mid|high`, `tape_r_im`,
  `wristband_l`, `headband_high|low`, `shoeCover_low|lowmid|midhigh|high` (cover-only, no triangles emitted).
- Remove `beard`, `hair`, `eyebrows`, `shoes`, `headband`, `socks` from `DEFAULT_SHELLS` (replaced).
- Per-vertex `offsetScale` from zone functions (beard chin/cheeks, hair sides taper, Yao fringe, sock brace bump);
  per-vertex `density` (u8n) from the style density fields; `fade` derived at load from `edge` and the layer's
  `fadeMm` (store `fadeMm` in the shell header).
- New uvModes `torso-ellipse` (§7.1), `head-metric`, `brow-local`, `lash-local` (§4.3); seam split keeps working
  with `u + Nu` for `head-metric`.
- Boundary loops: after marching triangles, chain boundary edges into loops, classify (jersey: mean y > clavY − 0.05
  ∧ mean |x| < 0.08 → `neck`; mean |x| > 0.1 → `armhole_l/r`; else `hem`; shorts: top → `waist`, bottom → `leg_l/r`;
  socks: top → `cuff`), store their UV polylines unwrapped.
- Shell LOD1 index (`simplify 0.4`, LockBorder) for every cloth and groom shell.

### 11.5 Morphs (`lib/morphs.mjs`, new; called per player in `bake.mjs`)

Computes the §8.1 targets: modifier deltas via the existing `detailTargetList`/`applyTarget` on a copy of the
player's pre-scale positions, the jaw field (§8.2, downloads `rigs/standard/weights.default.json` and
`rig.default.json` through `fetch.mjs`; both CC0 MPFB data, 5.0 MB + 126 KB, cached), tongue weights, blink
rotation; scales by `UNIT·scale`; writes sparse `i16q`. Config `expressions` becomes
`{<channel>: {modifiers: {...}, jaw: {rotDeg, translate: [x,y,z]}, tongue: {translate: [x,y,z]}}}`; the old
descriptor values are migrated as listed in §8.1.

### 11.6 Masks (`lib/uvraster.mjs`, `lib/png.mjs`, `lib/masks.mjs`, new)

- `uvraster.mjs`: rasterise body triangles (render indices + UVs) at size S; per texel barycentric → interpolated
  position + normal (base or player) → field callback; top-left fill rule; supersample 2 × 2 at 1024 for edges;
  dilation (iterative 4-neighbour max into empty texels, 8 px at 1024, 4 px at 512).
- `png.mjs`: minimal RGB PNG writer (signature, IHDR colour type 2 depth 8, IDAT = `zlib.deflateSync(level 9)` of
  rows with adaptive filter (min sum of |bytes| over filters 0–4), IEND, CRC-32 table) — Node built-ins only.
  Rows written top = v 1.
- `masks.mjs`: the §2.3 shared fields → `legends.skin0/1/2.png`; per player §4–§7.7 fields →
  `legends.<id>.groom.png`, `legends.<id>.extra.png`. Log the byte size of every file; fail the bake if the §1.1
  budgets are exceeded by > 20 %.

### 11.7 Config, measure, calibrate, output

- `legends.config.json`: `"output": "../../assets/legends"`, `"keepMouth": true`, new `appearance` schema (§4.5,
  §5.2, §6, §7.5–§7.7: `hair.layers[]`, `hair.hairline{}`, `hair.scalp{}`, `beard.components{}`, `beard.layers[]`,
  `eyebrows{gap, arch, tail, hIn, hOut, density, archOuter?}`, `kit.classic` side, trims, `socks.shell`,
  `shoes.overrides`), §10.3 morph values, `expressions` per §11.5, `mpfbRef` (commit SHA recorded by `fetch.mjs`;
  pin the raw URLs to it [POC risks]).
- `measure.mjs --likeness`: the §10.2 metrics and bands (table embedded in `lib/landmarks.mjs`), exit code 1 on
  any miss; `--json` includes them.
- `calibrate.mjs`: unchanged knobs; reads the edited `meta.calibration` (Giannis headH 0.232 / craniumFace 1.10,
  Kobe craniumFace 0.95).
- `README.md`/`FORMAT.md`: document v2 sections, masks, per-player shells, morphs, `--likeness`.
- `package.json` scripts: `bake:legends` writes to `assets/legends/`; `likeness` = bake + measure --likeness + shoot.

### 11.8 Bake acceptance (log lines checked by `test/unit-legends-bake.mjs`, runs only when `.cache` exists)

Rig check still 0.00 mm; `players: 6`; every per-player shell non-empty (Jordan has no hair shell; Yao no beard
shell); every morph target count > 50 vertices and max |Δ| < 0.06 m; masks written with sizes in budget;
`legends.json` validates against `format.js parseHeader`; total `assets/legends/` ≤ 3.5 MB.

---

## 12. Tests and acceptance hooks (for the QA section)

- `test/unit-legends-format.mjs` (Node): parse the committed header + bins with `format.js`: kept counts, every
  index < renderVertices, every shell vertex a/b < keptVertices, morph indices in range, eye radii 0.013–0.019 m,
  feet length 0.27–0.36 m.
- `test/unit-skinpaint.mjs`: 8 × 8 synthetic mask planes → known RGBA (lip texel = lipsHex mix, roughness alpha
  values, nail texel 0.25).
- `test/unit-sneaker.mjs`: vertex/triangle counts per tier, all skin weights sum to 1 and use only foot/ball/calf,
  outsole min y = 0 ± 1e-6, no NaN.
- `test/unit-glyphs.mjs`: glyph table has 10 digits; advance/height constants; `24`, `23`, `34`, `11`, `2` layouts fit
  their back-number box.
- Acceptance (Playwright): after load at medium, `renderer.info.render.calls` per frame ≤ 24 + other scene calls
  (character calls counted by toggling characters off), triangles ≤ 100k for characters at the CHECK camera; no
  console errors; network requests only to the page origin; `renderer.info.memory` stable after 5 rematches and
  5 lineup/kit changes; WebGL program count does not grow with the number of players (shared patches).

## 13. Review findings touched by this section

| finding | how |
|---|---|
| [R1#4] shared shadow assets | characters never create shadow textures/geometry; RENDERING's shared blob is used |
| [R1#42] players merge under the rim | per-player `collisionRadius` (§1.6) exported for PHYSICS |
| [R1#32] dunk hands below the rim | real hand bones + `palm_s` socket; listed reach in `dims` for ANIMATION's `reachAug` |
| [R1#36] pose snap on reset | `Character.resetPose()` is debug-only; gameplay never snaps poses |
| [R1#2], [R1#12] DPR/tier misfires | tier is an input here; RENDERING must judge from gameplay frames only |
