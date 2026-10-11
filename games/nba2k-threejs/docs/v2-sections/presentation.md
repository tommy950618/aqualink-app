# PRESENTATION, RENDERING & PERFORMANCE (v2 section)

Scope: how 传奇对决 3v3 / LEGENDS 3v3 looks, sounds, frames and flows: renderer settings, tone mapping, the arena
lighting rig, shadows, the procedural environment map, materials and their cost; the court, hoop, net, arena,
LED boards, jumbotron and crowd; the ball; every camera (broadcast, intro, replay, lineup turntable, pause, halftime,
game over, title); the UI flow from loading screen to box score with phone-exact layouts; quality tiers, auto-detection,
budgets and pause/visibility handling; asset loading for static hosting and the Claude artifact; synthesized audio; and
the test plan. Character meshes/skin/kits are CHARACTERS'; poses and clips are ANIMATION's; rules, ratings, lineup
logic and AI are GAMEPLAY's. This section consumes their outputs and says exactly what it needs from them (§13).

## Inputs and citation keys

| key | source |
|---|---|
| [POC] | `phaseA.json → poc` (mesh stats, perf table: 6 × LOD1 + kit = 102k tris / 67 calls; LOD0–3 = 27,036 / 13,658 / 6,968 / 3,490 tris; risks) |
| [PROF:id] | `phaseA.json → profiles[]` (jersey hexes, mannerisms, ratings, signature moves) |
| [XCHK] | `phaseA.json → xcheck` (barefoot heights 1.96/1.96/2.03/2.09/2.27/1.87 m, shoulder joints) |
| [SHOT:name] | PoC renders looked at: `legends_lineup_groom_1_yaw_0.5.png` (bodies read correctly, beards are one blocky black mask), `legends_heads_groom_1.png` (faces generic, hard shell edges, blocky beards), `perf_lod_1_w_844_h_390.png` (six legends ≈ 70 px tall on an untextured plane in the dark: no arena, no shadow, no tone mapping) |
| [R1#n] | `review-r1-all.json`, **1-based** index (same numbering as GAMEPLAY §14; CHARACTERS cites the same list 0-based: its [R1#4] = #5 here) with verification status |
| [V1 §n] | v1 `SPEC.md` (§9 camera, §10 rendering, §11 HUD, §12 audio, §15 acceptance) |
| [CODE] | v1 sources read: `src/camera.js`, `scene.js`, `court.js`, `main.js`, `constants.js`, `css/style.css`, `index.html`, `test/acceptance.cjs` |
| [3JS] | the vendored `three.module.js` r186, inspected: `REVISION 186`; `NeutralToneMapping = 7`, `AgXToneMapping = 6`; `PCFSoftShadowMap` is **removed** (logs a warning and falls back to `PCFShadowMap`); PCF = 5 Vogel-disk taps on a `sampler2DShadow`, radius in texels; `light.shadow.intensity` exists; `PMREMGenerator.fromScene(scene, sigma, near, far, {size = 256, position})`; `Scene.environmentIntensity`; the shadow pass tests `object.layers` against the **main** camera's layers and skips `material.visible === false` |
| [CHR §n] | sibling `sections/characters.md` (4 draw calls per player, per-tier triangles/textures §9.1, LOD thresholds §9.2, loader + progress weights §1.3, Character API §1.4, culling §1.7) |
| [ANIM §n] | sibling `sections/animation.md` (events `SLOWMO_IN/OUT`, `FX chalkBurst` §8.4, presentation showcase loops §8.4, `eyeOffset`, anim budgets per tier §12.2) |
| [GP §n] | sibling `sections/gameplay.md` (`src/legends.js`, `TEAMS_V2`, lineup interactions §12, finding dispositions §14, test hooks §15) |
| [DEC] | orchestrator decisions (real names, kits, All-Star rule, tiers required, zh default, three core only) |
| [M] | measurements made for this section: `scratchpad/nba2k-v2/measure/pres/{cam,run1,search,detail,lens,near,apex}.mjs` (projections with the vendored three.js in Node; outputs quoted where used) |

Decisions are marked **D-PR-n**.

---

## 0. Key decisions (summary)

- **D-PR-1 Tone mapping = `NeutralToneMapping`, exposure 1.0, sRGB output, all tiers.** Khronos PBR Neutral leaves
  base colours below ~0.76 linear untouched and only compresses highlights, so the kit hexes the decisions fix
  (#CE1141, #FDB927, #6F263D, #00471B) stay recognisable; ACES shifts saturated reds/golds toward orange/yellow and
  crushes the dark wine/green kits; AgX desaturates them. LED boards, jumbotron, sky and HUD-like world sprites use
  `toneMapped: false`.
- **D-PR-2 Lighting = one key DirectionalLight (shadow caster on medium/high) + a back rim DirectionalLight + a
  HemisphereLight + a procedural PMREM environment** built once from a tiny "arena" scene (ceiling light banks, dark
  stands, warm floor). Every light exists from boot on its tier; presentation effects change *intensity only*, so no
  shader ever recompiles mid-game.
- **D-PR-3 Shadows**: low = shared blob textures only ([R1#5] fix); medium/high = one 1024²/2048² PCF shadow map fitted
  tightly (texel-snapped) around the players each frame, cast **only by per-player LOD3 shadow proxies** (3,490 tris,
  uncovered, same skeleton, `colorWrite:false` in the main pass) and the ball; received only by the floor; blob
  contact shadows stay at 0.25 opacity as ambient occlusion.
- **D-PR-4 Floor = two textures, not one huge one**: a tiling 2.28 m maple tile (512²/1024², RGBA = albedo +
  roughness) and a half-court markings texture (1024×816 / 2048×1632, mirrored for the far half) combined in an
  `onBeforeCompile` patch; centre logo "LEGENDS / 传奇对决" is a separate decal. Planar reflection on **high only**
  (half-res, players + ball + hoop); medium/low get gloss from roughness + PMREM.
- **D-PR-5 Arena that fills the screen**: an end-zone jumbotron with the live score and event graphics, scrolling LED
  boards, stepped stands, a GPU-animated instanced billboard crowd (700 / 1,600 / 2,600) whose reactions are driven by
  two uniforms, a dark gradient dome + fog. In portrait the jumbotron and upper stands fill the band that v1 left black
  ([R1#1]).
- **D-PR-6 Broadcast camera re-framed and measured** [M]: landscape `{fov 42, kx 0.35, y 6.5, z0 4.5, kz 0.30, lookY 1.0,
  lookZ −8.0}` + a near-half-line rule; portrait `{fov 72, kx 0.35, y 9.0, z0 12.0, lookY 1.0, lookZ −7.0}` + a 0.25-NDC
  lens shift (`setViewOffset`). Landscape keeps all 36 feet/head points of 6 scenarios on screen with the handler
  56–93 px tall at 844×390 (v1: 49–78 px, one point off); portrait keeps 34/36 (v1 28/36) and off-screen teammates get
  edge indicators. **This overrides GAMEPLAY §14 #1/#2 numbers** (GAMEPLAY delegated re-verification to the camera owner).
- **D-PR-7 Instant replay = recorded final poses, not re-simulation**: a 4.0 s ring buffer of every player's 53 local
  bone quaternions + root/pelvis/face values and the ball (1.35 MB, allocated once) is played back at 0.5× with slerp
  under orbit/track cameras; LOD0 for focus players; 3.0 s; skippable by any tap/key.
- **D-PR-8 Presentation flow like a 2K game**: HTML loading screen with real progress → 3D title cover → lineup/draft
  with turntable and detail card → pre-game intro announcing the six legends (≈ 15.7 s, skippable, short version on
  rematch) → game with redesigned HUD (top-centre score bug, name tag + stamina over the controlled player, meter beside
  the shooter, pass-target chevron, off-screen indicators) → halftime card → game over with box score and MVP card.
- **D-PR-9 Quality = 3 tiers on a 6-rung ladder** (tier × DPR). Static detection from the unmasked renderer string,
  cores, memory and touch picks the start rung; measured gameplay frame intervals (cadence-normalised, judged only in
  LIVE with no menu/overlay/replay/intro, [R1#3][R1#13]) demote/promote with hysteresis; tier swaps apply at dead balls.
  Menus never use `backdrop-filter` on touch devices.
- **D-PR-10 Loading works identically on static hosting and inside the artifact**: everything is fetched by
  `new URL(rel, import.meta.url)`; byte-accurate progress; per-file timeout/retry; an error panel with 重试 / 简化模式
  (v1 primitive humanoids). Total payload ≤ 5.4 MB raw (≈ 3.4 MB gzip): ≈ 5.5 s cold on "Fast 4G" worst case.
- **D-PR-11 Audio stays 100 % synthesized**: sneaker squeaks from ANIMATION's plant events, rim/net/board variants,
  a layered crowd with vowel-formant "ooh/aah", synchronized clap chants, an arena horn; no voices, no PA, no name chants.
- **D-PR-12 Tests**: A2/A3 recurse `src/**`; the denylist drops the six names but keeps team names, `NBA`, `2K`, brands
  and trademark nicknames; 15 new acceptance items (legends heights, six distinct bodies, lineup/draft, intro, replay,
  tiers, showcase page `?showcase=1`, perf budgets, load size, mobile layouts, camera framing, captions, asset failure,
  memory) and 9 new unit test files.

---

## 1. Rendering pipeline

### 1.1 Renderer (`src/render/renderer.js` → `createRenderer(canvas, quality)`; replaces v1 `scene.createRenderer`)

```js
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: false, depth: true, stencil: false,
  powerPreference: 'high-performance', preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;   // D-PR-1
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = quality.tier !== 'low'; // decided at boot; see §6.3 "Applying" for runtime changes
renderer.shadowMap.type = THREE.PCFShadowMap;        // r186: PCFSoft removed [3JS]
renderer.shadowMap.autoUpdate = true;
renderer.info.autoReset = false;                     // main.js resets once per frame so shadow + reflection passes count
renderer.setClearColor(0x0b0d14, 1);
renderer.setPixelRatio(quality.dpr);                 // §6.1 ladder
```

- `antialias: true` on every tier: MSAA 4× is cheap on tile-based mobile GPUs at DPR ≤ 1.5, and the context cannot be
  re-created when the tier changes. `?aa=0` disables it (debug only).
- **WebGL2 is required for the legends** ([CHR §1.3]); `!renderer.capabilities.isWebGL2` → simplified mode (v1
  primitives, §7.4), toast `toast.webgl1`.
- One render per frame of `scene` with the active camera of the director (§4), preceded on medium/high by the shadow
  pass (automatic) and on high by the reflection pass (§2.3). No post-processing passes (no bloom, no DOF, no FXAA): the
  "glow" of LEDs and lights comes from `toneMapped:false` colours > 1 plus the PMREM highlights.
- Resize: `renderer.setSize(w, h, false)` + camera aspect + (portrait) view offset; **no render inside resize when
  called from the quality ladder** ([R1#3] double render).

### 1.2 Lighting rig (`src/render/lighting.js` → `createLights(scene, quality) → {hemi, key, rim, spot, setPreset(name, t)}`)

All lights are created at boot (light counts are part of the program cache key; changing them recompiles every
material). The intro spotlight exists only if the boot tier is medium/high and is otherwise kept at intensity 0.

| light | type | colour | intensity low / medium / high | placement | shadow |
|---|---|---|---|---|---|
| `hemi` | HemisphereLight | sky `#fff1e0`, ground `#5a3f28` (wood bounce) | 1.10 / 0.35 / 0.30 | — | — |
| `key` ("overhead court lights") | DirectionalLight | `#fff4e5` (≈ 4,600 K) | 2.40 / 2.50 / 2.50 | `position = target + 30 · normalize(4, 20, 6)`; target = shadow-fit centre (§1.3), default (0, 0, −7) | medium/high |
| `rim` (back light) | DirectionalLight | `#d6e4ff` | 0.90 / 1.30 / 1.30 | position (0, 9, −32), target (0, 1.0, −6): lights shoulders/heads from behind the hoop so players separate from the dark stands under the broadcast camera | no |
| `spot` (intro / title) | SpotLight | `#ffffff` | 0 in play; 1,100 cd during an announcement | 12 m above the presented player, target his chest; `angle 0.32 rad`, `penumbra 0.55`, `decay 2`, `distance 0` | no |

Calibration target (asserted in A41, §9): in the CHECK frame at 844×390 medium, the mean sRGB luminance of a 40×20 px
patch of bare wood between the FT line and the arc top is **0.60–0.72**; tune `key` within [2.0, 3.2] to hit it,
never the exposure.

Presets (`setPreset(name, seconds)`, linear in 0.6 s unless noted; multipliers on the table values):

| preset | key | hemi | rim | env intensity (§1.4) | crowd colour (§2.8) | spot |
|---|---|---|---|---|---|---|
| `play` | ×1.0 | ×1.0 | ×1.0 | 0.55 | ×1.0 | 0 |
| `intro` (announcements, title, lineup) | ×0.35 | ×0.5 | ×1.2 | 0.20 | ×0.4 | 1,100 cd on the focus player |
| `pause` | ×0.8 | ×0.8 | ×1.0 | 0.45 | ×0.7 | 0 |
| `replay` | ×1.0 | ×1.0 | ×1.25 | 0.55 | ×1.0 | 0 |
| `gameover` | ×0.6 | ×0.7 | ×1.3 | 0.35 | ×0.8 | 900 cd on the MVP |

### 1.3 Shadows (`lighting.js` → `updateShadowFit(players, ball)`, called after animation, before render)

**Low**: no shadow map. One shared blob texture/geometry for players and ball ([R1#5]: `makeBlobTexture` called once;
`ball.js` imports the shared `{geometry, texture}` from `src/render/shadows.js`), drawn as **one `InstancedMesh` of 7**
(6 players + ball, `renderOrder −1`, y = 0.004): geometry `PlaneGeometry(1, 1).rotateX(−π/2)`;
material `MeshBasicMaterial({ map: blob, color: 0x000000, transparent: true, depthWrite: false })` with one
`onBeforeCompile` line after `#include <color_fragment>`: `diffuseColor.a *= vColor.r;` — i.e. the per-instance
**opacity is written into `instanceColor.r`** (`setColorAt(i, color.setRGB(opacity, 0, 0))`; rgb stays black because the
material colour is black). Player blob: scale `0.95 · (shoulderJoints / 0.46)` m in x, `0.80 ×` that in z, opacity
0.45, centred under the pelvis xz; ball blob: scale 0.35 m, opacity `0.5 → 0.15` as the ball height goes 0 → 3 m (v1
rule). Hidden instances get opacity 0.

**Medium / high** — one shadow map on `key`:

| parameter | medium | high |
|---|---|---|
| `shadow.mapSize` | 1024² | 2048² |
| ortho half-size `h` | fitted (below), quantised to 0.5 m, clamp [4.5, 11.0] m | same |
| `shadow.radius` (texels, 5-tap Vogel PCF [3JS]) | 2.0 | 2.5 |
| `shadow.bias` / `normalBias` | −0.0005 / 0.025 | −0.0004 / 0.020 |
| `shadow.intensity` | 0.78 | 0.80 |
| camera near / far | 1 / 60 | 1 / 60 |
| casters | 6 shadow proxies + ball | same |
| receivers | floor, centre decal | same |

Fit (every frame, allocation-free): AABB of the six pelvis xz positions and the ball xz, expanded by 1.6 m; centre
`(cx, cz)`; `h = 0.5 · max(width, depth) · 1.08` (the light is tilted ≈ 18° from vertical) quantised up to 0.5 m and
clamped; `shadow.camera.left = −h, right = h, top = h, bottom = −h` (projection updated only when `h` changes);
`key.target.position = (cx, 0, cz)` snapped to the shadow texel grid in light space (texel = 2h / mapSize; snap the
target's light-space x/y with `Math.round(v / texel) · texel`) so moving players never make the shadow edges crawl.
Typical CHECK formation: 9.6 × 9.4 m → `h = 5.5` → **1.07 cm/texel (medium), 0.54 cm (high)** vs 1.8 cm for a static
whole-court fit.

**Shadow proxies** (CHARACTERS hands over the LOD3 index; [POC] LOD3 = 3,490 tris, face-unlocked, fine at broadcast
distance): per character one extra `SkinnedMesh(sharedBodyGeometryWithLod3Index_uncovered, proxyMat, skeleton)`,
`proxyMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })` (shared), `castShadow = true`,
`receiveShadow = false`, `renderOrder = 100`. The body, kit and groom meshes have `castShadow = false`,
`receiveShadow = false`. Reasons: (1) the shadow pass uses the main camera's layers and material visibility [3JS], so a
"shadow-only" object must be visible — `colorWrite:false` makes it invisible at near-zero cost; (2) the visible body
has its covered triangles removed ([CHR §1.5]), which would punch holes in the shadow; (3) 6 × 3.5k = 21k shadow
triangles instead of ≈ 108k; (4) characters do not receive shadows, avoiding acne from the proxy/body mismatch and
saving one shadow lookup per skin pixel. The ball (`castShadow = true`) uses its own sphere.

Blob contact shadows remain on medium/high at opacity 0.25 (players) / 0.20 (ball) as ambient occlusion under the
feet.

### 1.4 Environment map (`src/render/envmap.js` → `buildArenaEnv(renderer, quality) → Texture | null`)

Low: none (`scene.environment = null`, the hemi at 1.10 carries the fill). Medium/high: build a throw-away scene, bake it
with `new THREE.PMREMGenerator(renderer).fromScene(envScene, 0, 0.1, 120, { size, position: new Vector3(0, 1.6, −7) })`,
dispose the scene and the generator, keep the texture.

| element | geometry | material (all `MeshBasicMaterial`, `side` as noted, `fog:false`) |
|---|---|---|
| shell | `BoxGeometry(70, 30, 70)` centred (0, 15, −7), BackSide | `vertexColors`: walls y = 0 `#22252f`, y = 8 `#11131a`, top `#07080b`; ceiling `#050608` |
| floor | `PlaneGeometry(30, 18)` at y 0.01, centre (0, 0, −7) | `#b9824e` × 0.9 |
| stands band | `CylinderGeometry(24, 24, 8, 32, 1, true)` y 2–10, BackSide | 64×16 canvas of random crowd-palette speckles (§2.8 palette), colour × 0.5 |
| ceiling light banks ×8 | `PlaneGeometry(7, 1.4)` facing down at y 24, x ∈ {−9, −3, 3, 9}, z ∈ {−12, −2} | `color = (1, 0.96, 0.9) × 12` (HDR; PMREM targets are half-float, values > 1 survive) |
| jumbotron | `PlaneGeometry(10, 4.5)` at (0, 9.5, −27) | `#3050a0 × 2.5` |
| LED ribbon | box ring y 0.4–1.2 behind the baseline | `#ff8a30 × 1.8` |

`size` = 128 (medium) / 256 (high). Bake cost: one cube render (≈ 12 draws) + PMREM blur, measured budget ≤ 40 ms on an
iPhone 11, done in the loading "compile" phase. `scene.environment = tex`; `scene.environmentIntensity = 0.55`
(presets in §1.2). `envMapIntensity` per material: floor 1.0, glass 1.6, rim 1.0, ball 0.8, net 0.6, characters per
CHARACTERS (default 1.0). `scene.background` stays `null` (the sky dome draws the background, §2.7).

### 1.5 Materials and their cost

Relative fragment cost on a mobile GPU (MeshBasic = 1; measured order of magnitude from the shader chunk counts in r186,
to rank choices, not to promise ms):

| material | used for | relative cost | notes |
|---|---|---|---|
| `MeshBasicMaterial` | sky dome, LED boards, jumbotron, ceiling fixtures, shadow proxies (`colorWrite:false`), blobs, crowd (low) | 1 | `toneMapped:false` for emissive-looking surfaces |
| `MeshLambertMaterial` | floor (low), stands, crowd (medium/high), stanchion base (low) | 2 | per-fragment Lambert in r186 |
| `MeshStandardMaterial` (no maps) | rim, frame, pole, shot-clock box | 4 | + env lookup on medium/high |
| `MeshStandardMaterial` + map + normal/rough patch + env | floor (medium/high), ball, net, glass, kits [CHR], skin medium [CHR] | 6 | the floor patch adds 2 texture fetches |
| `MeshPhysicalMaterial` sheen + clearcoat | skin high [CHR §2.6] | ≈ 10 | sheen = extra BRDF + env sample (+40–60 % over Standard) |
| + shadow receive (PCF 5 taps) | floor | +1.5 | characters do not receive |
| + planar reflection (high) | floor | +1.5 | 5 taps of a half-res target |

Choices: **no `MeshPhysicalMaterial` outside skin-high**; cloth sheen for kits is a CHARACTERS option (recommendation:
high only, `sheen 0.35, sheenRoughness 0.6, sheenColor = kit colour × 1.2` — cheap enough there because kits are ≈ 20 %
of character pixels). The glass is `MeshStandardMaterial` (transmission would need an extra opaque pass).

### 1.6 Per-frame render order and passes

1. `renderer.info.reset()`; quality monitor tick (§6.3).
2. Fixed steps (sim), animation evaluate ([ANIM D-ANIM-3]), replay apply if active (§4.6).
3. `lib.beginFrame(camera, viewportHeightPx)` + `c.update(dt)` ([CHR §1.7, §9.2] culling and LOD).
4. Shadow fit (§1.3); crowd/LED/jumbotron uniforms and texture repaints (≤ 2 Hz, §2.6–§2.8); net sim (§2.4); ball spin (§3.3).
5. High only: reflection pass into its render target (every frame on desktop, every 2nd frame on touch, §2.3).
6. `renderer.render(scene, director.camera)` (shadow pass runs inside).
7. HUD projection with the **same-frame** camera matrices: `camera.updateMatrixWorld()` is called by the director at the
   end of its update, before any `Vector3.project` ([R1#4]).

---
## 2. Court and arena

Coordinates and court constants are v1's ([V1 §2], `constants.js`: half court z ∈ [−14.325, 0], rim (0, 3.048, −12.75),
board AABB x ±0.915, y 2.90–3.97, front z −13.105). The camera now sees past the half-court line and the intro/replay
cameras look in every direction, so the floor, the far hoop and the stands cover the **full** arena.

### 2.1 Floor geometry and textures (`src/render/floor.js`)

- Mesh: `PlaneGeometry(22, 35)` rotated flat, centre (0, 0, 0): x ∈ [−11, 11], z ∈ [−17.5, +17.5]. UV: `u = (x + 11)/22`,
  `v = (z + 17.5)/17.5` ∈ [0, 2]. One draw, `receiveShadow = true`.
- **Markings texture** (`CanvasTexture`, `flipY = false`, `colorSpace = SRGBColorSpace`, mipmaps, `anisotropy = min(8,
  max)` (low 4), `wrapS = ClampToEdge`, `wrapT = MirroredRepeatWrapping`): size **1024×816** (low) / **2048×1632**
  (medium, high). Canvas row 0 ↔ v = 0 ↔ z = −17.5; the last row ↔ z = 0 (half line); the mirror makes the far half.
  Mapping: `px = (x + 11)/22 · W`, `py = (z + 17.5)/17.5 · H`. Canvas starts fully transparent (alpha = paint coverage;
  wood shows where alpha = 0). Painted in this order (sRGB hex, alpha):
  1. Apron (out of bounds): everything with |x| > 7.62 or z < −14.325 → `#141821`, α 0.96.
  2. Key: x ∈ [−2.44, 2.44], z ∈ [−14.325, −8.535] → `#1d2b4f`, α 0.90.
  3. Centre circle fill r ≤ 1.83 around (0, 0) → `#1d2b4f`, α 0.90 (mirrored into a full disc; the logo decal sits on top).
  4. Lines `#f4f2ec`, α 1.0, width 0.0508 m: sidelines, baseline, key outline, FT circle (solid half toward the half
     line, dashed half 0.35 on / 0.25 off toward the rim), lane hash marks (v1 positions), restricted arc r 1.22, the
     3-pt corners at |x| 6.71 to z −10.03 + arc r 7.24 about the rim, centre circle r 1.83 outline and inner circle
     r 0.61, a 0.6 m baseline-to-backboard-plane tick (v1). **The half-court line is drawn as the band
     z ∈ [−0.0254, 0]** so that the mirror produces exactly 0.0508 m.
  5. Apron wordmarks (text from i18n, §5.11): `brand.wordmark` "LEGENDS 3V3" centred at (0, −16.0), `#d9a520` α 0.90,
     cap height 0.55 m, letter spacing 0.10 m, glyph tops toward −z (reads upright from the broadcast side);
     `brand.zh` "传奇对决" on both side aprons at x = ±9.3, z = −7.0, cap height 0.60 m, rotated so it reads from the
     court centre (−90° on the left, +90° on the right), `#f4f2ec` α 0.55.
  No NBA marks, no team names, no sponsor marks ([DEC]); the strings are checked by the denylist (A2).
- **Wood tile** (`DataTexture` RGBA, `colorSpace = SRGBColorSpace` — sRGB decode applies to RGB only, alpha stays linear
  roughness; `wrapS/T = Repeat`, mipmaps, same anisotropy): **512²** (low, medium) / **1024²** (high), covering
  **2.28 × 2.28 m** = 40 maple boards of 5.7 cm running along z. Painted once by a pure function
  `paintWoodTile(size, rng) → Uint8Array` (Node-testable), seeded `Rng(0x600D)`:
  - per board: HSL hue 30° ± 2°, saturation 0.50 ± 0.05, lightness 0.62 ± 0.035 (≈ `#d8a46b`); boards are split into
    segments of 0.40–1.60 m with the start offset random per board and lengths wrapping across the tile edge
    (seamless); segment joints = 1 px line × 0.80 value;
  - grain: per segment 7 dark streaks (value × 0.90–0.96) and 2 light streaks (× 1.05), each a 1 px sinusoid along z
    (amplitude 0.6 px at 512, wavelength 0.3–0.9 m); 64² value-noise pattern multiplied at α 0.25;
  - board edges: 1 px × 0.86 on each board's left edge;
  - alpha = roughness × 255: 0.20 base, ± 0.03 per board, + 0.02 on streaks; medium/high add 6 "wear" blobs
    (r 0.3–0.8 m, +0.08 roughness, −3 % value) — they repeat every 2.28 m, which the macro variation below hides.
  Budget: ≤ 25 ms (512²) / ≤ 90 ms (1024²) on an iPhone 11, chunked in the loading "arena" phase.
- **Material**: low = `MeshLambertMaterial({ map: markings })`; medium/high = `MeshStandardMaterial({ map: markings,
  roughness: 1, metalness: 0, envMapIntensity: 1.0 })`. Both get the same `onBeforeCompile` patch
  (`customProgramCacheKey = () => 'floor-v2'`), uniform `woodMap`:
  ```glsl
  // replaces #include <map_fragment>
  vec4 mk = texture2D( map, vMapUv );                            // paint rgb + coverage a
  vec2 wuv = vec2( vMapUv.x * 22.0, vMapUv.y * 17.5 ) / 2.28;   // metres → tiles
  vec4 wd = texture2D( woodMap, wuv );
  float macro = texture2D( woodMap, wuv * 0.11 + vec2( 0.37 ) ).g; // low-frequency variation, hides tiling
  vec3 wood = wd.rgb * mix( 0.93, 1.07, macro );
  diffuseColor.rgb *= mix( wood, mk.rgb, mk.a );
  float floorRough = mix( wd.a, 0.34, mk.a );                    // paint is a little less glossy
  // Standard only — replaces #include <roughnessmap_fragment>:
  float roughnessFactor = floorRough;
  ```
- **Backcourt warning stripe** ([GP §14 #41]): `PlaneGeometry(15.24, 0.30)` at (0, 0.003, −0.15), `MeshBasicMaterial({
  color: #ff3b3b, transparent: true, opacity: 0, depthWrite: false, toneMapped: false })`; opacity pulses
  `0.55 · |sin(π t / 0.3)|` while the human handler is within 1.0 m of z = 0 and moving toward it; `visible = false`
  otherwise (0 draws).

### 2.2 Centre decal (`floor.js`)

`PlaneGeometry(4.0, 4.0)` flat at (0, 0.002, 0), `CanvasTexture` 512² (low, medium) / 1024² (high), material
`MeshStandardMaterial({ map, transparent: true, roughness: 0.30, depthWrite: false, polygonOffset: true,
polygonOffsetFactor: −2, polygonOffsetUnits: −2 })` (low: Lambert), `receiveShadow = true`. Content (2 px = 0.78 cm at
1024): circle r 1.83 filled `#1d2b4f` α 0.92 (alpha 0 outside), gold ring `#d9a520` r 1.45–1.50 m; `brand.wordmark`
"LEGENDS" `#f4f2ec`, bold system font (`font-stretch: condensed` where supported), cap height 0.40 m, letter spacing
0.06 m, centred at z = −0.10; `brand.zh` "传奇对决" `#d9a520`, cap height 0.26 m at z = +0.42; "3V3" `#f4f2ec` cap
height 0.18 m at z = −0.65. Glyph tops toward −z.

### 2.3 Floor reflection

- **Low**: none (Lambert).
- **Medium**: gloss only: roughness 0.20–0.34 + PMREM → the eight ceiling banks appear as soft blurred streaks.
- **High** (`src/render/reflection.js`): planar reflection.
  - Target: `WebGLRenderTarget(ceil(w·dpr/2), ceil(h·dpr/2), { type: HalfFloatType, samples: 0, depthBuffer: true })`
    (linear HDR; tone mapping is applied later by the floor's own shader).
  - Mirror camera: copy of the active camera with `position.y = −y`, `up = (0, −1, 0)`-equivalent via reflecting the
    world matrix by `diag(1, −1, 1)`; projection identical. No clip plane is needed (nothing exists below y = 0).
  - Content: `camera.layers` = layer 2 only. Layer 2 members: character `body` + `kitMesh` (not groom), ball, rim,
    net, board frame, stanchion. Characters use whatever LOD they have this frame.
  - Floor patch addition (after the lights): `vec2 suv = gl_FragCoord.xy / uReflRes; suv.y += 0.004 * (wd.g - 0.5);`
    4-tap blur (offsets (±1.5, 0) and (0, ±3) target texels), `float fres = 0.04 + 0.96 * pow(1.0 - saturate(dot(normal,
    viewDir)), 5.0); float w = uReflStrength * (0.35 + 0.65 * fres) * (1.0 - 1.8 * (floorRough - 0.18)) * (1.0 - mk.a *
    0.5); outgoingLight += refl.rgb * clamp(w, 0.0, 0.35);` with `uReflStrength = 0.22`.
  - Rate: every frame on desktop; every 2nd frame on touch devices (blurred reflections hide 30 Hz).
  - Cost: +17 draw calls, ≈ +110k triangles (players at LOD1) at quarter pixel count.

### 2.4 Hoop, backboard, rim, net (`src/render/hoop.js`)

Geometry and materials (sRGB colours; "merged" = one `BufferGeometry` with vertex colours, one draw):

| part | geometry | material | draws (low / med-high) |
|---|---|---|---|
| stanchion base pad | box 1.40 × 1.25 × 1.90 at (0, 0.625, −16.6) | Standard `#1c2233` r 0.85 (low Lambert) | merged |
| pole | box 0.25 × 2.35 × 0.25 from the pad top, at z −16.2 | Standard `#2b2f36` metal 0.6 r 0.4 | merged |
| arm | box 0.22 × 0.22 × 2.9 from (0, 3.60, −16.0) to the board back at (0, 3.45, −13.25), pitched 3° | same | merged |
| board glass | `PlaneGeometry(1.83, 1.07)` at z = −13.105 (front face only, [R1#6]) | Standard `#ffffff` **opacity 0.16**, transparent, r 0.05, metal 0, envMapIntensity 1.6, `depthWrite:false`, `side: FrontSide` | 1 |
| board markings | same plane + 1 mm toward +z | Basic, `CanvasTexture` 512×256: border 5 cm `#f4f4f4`, shooter's square 0.59 × 0.45 m with its bottom 0.15 m above the rim (v1), α 0.95 elsewhere 0; `polygonOffset −1` | 1 (low: baked into the glass texture, 0) |
| board frame + bottom pad | 4 bars 4 cm deep `#2b2f36` metal 0.8 r 0.35 + pad 1.83 × 0.05 × 0.06 `#111111` | Standard | 1 (low merged) |
| rim | `TorusGeometry(0.2286, 0.0095, 10, 40)` + bracket box 0.15 × 0.05 × 0.20 to the board | Standard `#ff5a1f` metal 0.55 r 0.32 | 1 (low merged) |
| shot-clock unit | box 0.60 × 0.25 × 0.12 at (0, 4.15, −13.13) | Standard `#15171c` | merged |
| shot-clock digits | plane 0.50 × 0.20 on the unit front, `CanvasTexture` 128×64 repainted only when the integer changes: two 7-segment digits `#ff3b1f`, unlit segments `#2a0d08` | Basic `toneMapped:false` × 1.4 | 1 |
| board LED edge strip | 4 thin quads (1.5 cm) around the glass edge | Basic `#ff2020` `toneMapped:false`, `visible` only while the shot clock or game clock reads 0 (1.0 s) and during the final buzzer | 0–1 |
| net | §2.4.1 | Standard `#f2f2f2` r 0.85, `side: DoubleSide`, `alphaTest 0.45`, `alphaToCoverage: true` | 1 |
| far hoop (z = +12.75, mirrored) | stanchion + board + rim merged, glass plane | as above, low detail | 2 (frustum-culled in play) |

Draws in play: low 4 (merged opaque, glass, net, digits), medium/high 8.

#### 2.4.1 Net mesh and swish simulation

- Topology: rings k = 0..7 (k = 0 on the rim), 16 strands; ring k rest radius
  `r_k = 0.2286 + (0.125 − 0.2286)·(k/7)^0.85`, rest height `y_k = 3.048 − 0.45·(k/7)`; odd rings rotated by π/16 so
  cords form diamonds; triangles between rings = 16 × 7 × 2 = 224. Texture: 128² alpha lattice (two diagonal cords
  per cell, cord width 9 px, soft 2 px edges) repeated 16 × 7. Low: 12 strands × 5 rings (120 tris).
- State per vertex k ≥ 1: offset `o` and velocity `v` (Float32Array, allocated once). Integration each render frame with
  `dt = min(frameDt, 1/30)` split in 2 substeps (low: 1): `a = −K o − C v + 0.25 · (mean(o of 4 neighbours) − o)·K`,
  `K = 260 s⁻²`, `C = 10 s⁻¹`; `|o| ≤ 0.18 m`.
- Ball interaction: for each vertex within `0.12 + 0.012` m of the ball centre, project it onto that sphere (position)
  and add `0.4 ×` the ball's velocity component that points outward/downward.
- Make: when the ball's centre passes below `y_7` after a make, rings 5–7 get `v.y += 1.6 m/s` and radial `−0.3 m/s`
  (the "snap" of a clean swish). Rim contact of strength s ∈ [0, 4]: every vertex with k ≥ 2 gets a random
  horizontal kick `0.4 · s/4 m/s`.
- Normals recomputed only while any `|v| > 0.005` (static otherwise). CPU ≤ 0.05 ms. The replay re-runs the sim with the
  replayed ball at the slowed `dt` (§4.6).

### 2.5 LED boards (`src/render/arena.js`)

- Baseline boards: two boxes x ∈ [−8.5, −1.4] and [1.4, 8.5], y 0–0.9, z −16.9, depth 0.15; sideline boards: x = ±10.4,
  z ∈ [−15.5, +2.0], y 0–0.9; ribbon board (medium/high): x ∈ [−16, 16], y 5.6–6.4, z −22.2 (fascia of the upper
  deck). One merged geometry, one draw; faces toward the court use the LED texture, the other faces `#0b0c10`.
- Texture: `CanvasTexture` **2048×64** (medium/high) / **1024×32** (low), `wrapS = Repeat`, `magFilter = Nearest` for
  a pixel-grid look, 6 message slots of 341 px each, `toneMapped:false`, colour multiplier 1.4. Each board face maps
  u ∈ [0, 1] with `repeat.x = boardLength / 6 m`; scroll by `map.offset.x += 0.045 · dt` (no repaint).
- Messages (bilingual by design: LED boards show both languages; strings in i18n `led.*`): `led.brand` "传奇对决 ·
  LEGENDS 3V3", `led.defense` "DEFENSE · 防守!", `led.noise` "MAKE SOME NOISE · 呐喊吧", `led.score` "{a} {sa} – {sb} {b}"
  (live, repainted on a score change), `led.clutch` "CLUTCH TIME · 关键时刻" (Q4/OT last 60 s), `led.gg` "GOOD GAME ·
  精彩比赛" (game over). Background `#07080b`, text `#ffffff`/`#d9a520`, 1 px dot-matrix mask (every 3rd pixel row
  darkened 35 %).
- Event takeover (one repaint, 2.5 s): whole texture flashes the scoring team's UI colour (§5.2) with "+3 {short}" /
  "暴扣! {short}" / "盖帽! {short}" in white; then the rotation resumes. Repaints ≤ 1 per 0.5 s; each ≤ 2 ms.

### 2.6 Jumbotron and centre-hung scoreboard (`arena.js`)

- End-zone video board: frame box 10.6 × 5.1 × 0.6 `#0c0d10` at (0, 9.6, −26.9); screen plane 10 × 4.5 at z −26.58 with
  `CanvasTexture` **1024×512** (medium/high) / **512×256** (low), `MeshBasicMaterial({ toneMapped: false })`, colour × 1.15.
  In portrait it occupies NDC y 0.76–0.95 [M] — it fills the top band v1 left empty ([R1#1]).
- Layouts (repainted only when a displayed value changes, ≤ 2 Hz; ≤ 3 ms per repaint incl. upload):
  | mode | content |
  |---|---|
  | `live` | top 62 %: team A name + score (left, team UI colour bar), period + game clock (centre, 0.6 of the height of the scores), team B (right); bottom 38 %: shot clock in a red box + ticker "{short} {pts} 分 · {short} {pts} 分" (leading scorer per team) |
  | `event` (2.5 s) | "暴扣!" / "三分!" / "盖帽!" / "绝杀!" (i18n `jumbo.*`) 40 % height + player full name + number on the team colour |
  | `replay` | "回放 · REPLAY" + scorer's name |
  | `intro` | presented player: number, full name zh + en, OVR, height (mirrors the lower-third, §5.6) |
  | `title` / `lineup` | "传奇对决 / LEGENDS 3V3" logo + slow gold sweep (one repaint per 2 s) |
  | `gameover` | "终场" + final score + "MVP {name}" |
- Centre-hung cube (medium/high, for title/intro/replay angles): `BoxGeometry(5.6, 3.2, 5.6)` at (0, 15.5, 0); the four
  side faces sample the same jumbotron texture, bottom face `#0c0d10`; 1 draw (frustum-culled during play).

### 2.7 Stands, dome, darkness

- Sky dome: `SphereGeometry(85, 24, 12)`, BackSide, `vertexColors` by elevation: horizon `#12151e`, 25° `#0c0e15`, zenith
  `#040508`; `MeshBasicMaterial({ fog: false, toneMapped: false, depthWrite: false })`, `renderOrder −10`.
- `scene.fog = new THREE.Fog(0x0b0d14, 34, 90)`: the court (≤ 30 m from every gameplay camera) is untouched; upper rows
  and the far end fade into the dark — the "arena darkness gradient".
- Stands (one merged geometry, `MeshLambertMaterial #1a1d27`): behind the hoop 10 rows, front edge z −17.4, row depth
  0.85 m, rise 0.42 m, x ∈ [−16, 16]; both sidelines 8 rows from |x| = 11.6, rise 0.42 m, z ∈ [−22, +6]; upper deck
  behind the hoop: 10 rows starting at y 6.5, set back 2 m, above the ribbon board. ≈ 330 triangles.
- Courtside: a row of floor seats at |x| = 9.4, z ∈ [−13.5, −1.0], 0.6 m apart (crowd instances, seated cells only).
- Ceiling: `InstancedMesh(BoxGeometry(1.4, 0.35, 0.7), 16)` light fixtures at y 26, x ∈ {−12, −4, 4, 12}, z ∈ {−20, −10,
  0, 10}, `MeshBasicMaterial #fff6e8 × 2.2, toneMapped:false` (visible in intro/replay/title angles).

### 2.8 Crowd (`src/render/crowd.js`)

- Mesh: `InstancedMesh(PlaneGeometry(0.62, 1.05).translate(0, 0.525, 0), N)`, `frustumCulled = false`, 1 draw, 2 N
  triangles. Material: medium/high `MeshLambertMaterial({ map: atlas, alphaTest: 0.5, alphaToCoverage: true })`, low
  `MeshBasicMaterial` (shading painted into the atlas). `onBeforeCompile` patch (`customProgramCacheKey 'crowd-v2'`).
- Counts: **low 700, medium 1,600, high 2,600** (seat occupancy 35 % / 80 % / 92 % of ≈ 2,830 seats); seat spacing
  0.55 m, x jitter ± 0.06 m, faces fixed per section (behind the hoop +z; sidelines face the court rotated 20° toward
  +z). Seed `Rng(seed ^ 0xC20D)`; the same seed gives the same crowd.
- Atlas: **1024² (medium/high) / 512² (low)**, 8 columns × 4 rows of 128 × 256 px cells (low 64 × 128). Rows = poses
  (0 sit, 1 sit-lean hands on knees, 2 stand arms up, 3 stand clap); columns = 8 people (short-haired man, broad man with
  cap, long-haired woman, woman with bun, kid (cell scaled 0.75), bald man, man in hoodie, woman with ponytail).
  Painted procedurally at load (ellipses + rounded rects + 2 px dark outline) with **channel encoding**: R = shirt mask ×
  shade, G = skin mask × shade, B = hair/trousers mask × shade (shade 0.55–1.0 from a top-left light), A = coverage.
- Per-instance attributes: `instanceColor` = shirt; `aSkin` (vec3), `aHair` (vec3), `aMisc` (vec4: column 0–7, phase
  0–2π, threshold 0–1, courtside flag). Palettes: shirts 30 % the user's team UI colour, 12 % the opponent's, 58 % from
  [`#f2f2f2, #1c1c1c, #3a4a6b, #6b3a3a, #4e6b3a, #c9b38a, #808a99, #2e5f8a, #8a2e5f, #d0d0c8, #5a5a5a, #b05a2a`]; skin
  [`#f1c7a5, #e0ac83, #c68a5e, #a0673f, #74482b, #4a2e1d`]; hair [`#1a1410, #3b2a1c, #6b4a2a, #b08850, #888888,
  #2a2a2a`]; trousers `#222630` ± 8 %.
- Fragment: `albedo = R·shirt + G·skin + B·(cellV > 0.70 ? hair : trousers)`; vertex: row = `uExcite < threshold − 0.15`
  → 0 (1 if column parity is odd), `< threshold` → 1, else 2 or 3 alternating with `sin(2π·2.2·t + phase) > 0`; standing
  bob `y += 0.10 · max(0, sin(2π·1.8·t + phase)) · uExcite`; seated sway `x += 0.015 · sin(2π·0.25·t + phase)`;
  chant mode (`uChant = 1`): every instance with threshold < 0.30 stands and claps in sync on the 1.0 s pattern of §8.3.
  Uniforms `uTime, uExcite, uChant, uDim` (presets §1.2). **Zero CPU per frame** beyond 4 uniform writes.
- Excitement (`crowd.excite(level, holdS)`, decays toward `base` at 0.5 /s after the hold):
  | event | level | hold (s) |
  |---|---|---|
  | user-team make 2 / 3 | 0.60 / 0.85 | 1.5 / 2.0 |
  | CPU make | 0.30 | 1.0 |
  | any dunk | 1.00 | 3.0 |
  | block, ankle-breaker, chase-down | 0.80 | 2.0 |
  | game-winner / buzzer-beater | 1.00 | 6.0 |
  | base: normal / clutch (Q4 or OT, ≤ 60 s, margin ≤ 5) | 0.05 / 0.25 | — |
- Camera flashes (high): `Points` of 64 with a 32² soft-disc sprite, `size 0.35`, additive, `toneMapped:false`; each
  flash lives 70 ms at a random seat; bursts: dunk 40 over 1.2 s, three 20 over 0.8 s, game-winner 64 over 2.0 s.

### 2.9 Particles and small effects (`src/render/fx.js`)

- `chalkBurst` ([ANIM §8.4], LeBron intro/lineup): `Points` of 120, sprite 32² soft disc `#f6f3ea`, size 0.05–0.12 m,
  spawn at the mid-point of both `palm_s` sockets, velocity radial 1.2–2.0 m/s + up 0.8–1.6 m/s, drag 2.5 /s, gravity
  −0.6 m/s², alpha 0.6 → 0 over 1.5 s, `NormalBlending`, `depthWrite:false`. 1 draw while alive.
- Controlled-player ring: `RingGeometry(0.42, 0.50, 48)` flat at y 0.006 under the pelvis, `MeshBasicMaterial` team UI
  colour, opacity 0.85, `toneMapped:false`; pulse scale 1.25 → 1.0 over 0.25 s when control changes; hidden in
  intro/replay. Radius × `(shoulderJoints / 0.46)`.
- Dunk rim shake: rim + net group rotation.x `0.035 · e^(−9t) · sin(2π·11 t)` for 0.6 s from the `slam` event; the
  backboard glass and LED strip shake with it.

---

## 3. Ball (`src/render/ballvis.js`; physics stays in `ball.js`)

### 3.1 Mesh and material

| | low | medium | high |
|---|---|---|---|
| geometry | `SphereGeometry(0.12, 20, 14)` | `(0.12, 32, 24)` | `(0.12, 48, 32)` |
| albedo + roughness (`DataTexture` RGBA, equirect) | 512×256 | 512×256 | 1024×512 |
| normal map | none | 512×256, `normalScale (0.6, 0.6)` | 1024×512 |
| material | Lambert | Standard r 0.72 (× alpha roughness patch), metal 0, envMapIntensity 0.8 | same |
| shadow | blob | map caster + blob 0.20 | same |

### 3.2 Texture generation (pure `paintBall(size) → {albedo, normal}`, Node-testable; budget ≤ 40 ms at 512, ≤ 140 ms at
1024 on an iPhone 11, chunked)

For every texel compute the unit direction `n` on the sphere (equirect: `φ = 2π u`, `θ = π v`) so all features are
uniform on the sphere (no polar pinching):
- **Seams** (8-panel ball): great circle `|n.x| < w`, great circle `|n.z| < w`, and two curved seams
  `| |n.y| − (0.62 + 0.25·cos 2φ') | < w` with φ' = atan2(n.z, n.x) rotated 45°; `w = 0.029` (≈ 7 mm on a 0.754 m
  circumference). Seam colour `#1a1410`, roughness 0.85, height −1.0 (groove) with a 1-texel bevel.
- **Pebbles**: 3D cellular noise on `n · (1/0.0115)` (≈ 2.8 mm cells): height = `smoothstep(0.52, 0.0, F1)·0.25`,
  albedo × `(0.96 + 0.08·hash(cell))`, roughness 0.70 + 0.06·hash.
- Base colour `#c4521c` with 3 % large-scale value noise; normal map = Sobel of the height with strength 2.0, encoded
  0–255 tangent space (three's default sphere UV tangents).
- No logos, no text ([DEC]; denylist adds ball brands, §9.3).

### 3.3 Spin (visual only, no Magnus force; `ballvis.update(dt, ball)` integrates `q ← q ⊗ exp(ω dt / 2)`)

| ball state (`ball.js`) | ω |
|---|---|
| held / in hand socket | 0 (orientation follows the hand); Kyrie finger spin flag [ANIM §13] → (0, 2π·3, 0) rad/s |
| dribble | axis ⟂ horizontal travel, `|ω| = 0.5·|v_y| / r` (spins with each bounce) |
| shot in flight | backspin 2π·2.2 rad/s about `normalize(cross(dirXZ, up))` (top of the ball turns back toward the shooter) |
| chest / overhead pass | backspin 2π·3.0 rad/s; bounce pass: topspin 2π·2.0 rad/s |
| rolling / free | `ω = cross(up, v) / r` |
| rim contact | `ω *= 0.6`, plus random ± 3 rad/s per axis |
| floor bounce | `ω = 0.6·cross(up, v_xz)/r + 0.4·ω` |

---
## 4. Cameras (`src/cam/`)

### 4.1 Director (`src/cam/director.js`)

One `PerspectiveCamera` (`near 0.3`, `far 160`) owned by the director; shots are *modes* that write its pose:
`broadcast`, `intro`, `replay`, `lineup`, `title`, `pause`, `halftime`, `gameover`, `showcase`. Transitions: `cut`
(snap) or `ease` (position/look/fov cubic ease-in-out over the given seconds). Every update ends with
`camera.updateProjectionMatrix()` when fov/aspect/view offset changed and `camera.updateMatrixWorld()` so the HUD
projects with the same frame's matrices ([R1#4]). API:

```js
director.setMode(name, { transition: 'cut' | 'ease', seconds = 0.6, ...modeParams });
director.update(frameDt, world);          // after animation, before shadow fit
director.camera;                          // the only camera passed to renderer.render
director.mode; director.cameraMode;       // 'standard' | 'close' | 'high' (settings)
director.ndc(out, x, y, z);               // projection helper including the view offset
```

### 4.2 Broadcast camera (`src/cam/broadcast.js`, v1 `camera.js` upgraded)

Fixed yaw (camera x = look x), elevated behind the offence, exponential damping in frame time (position/look rate 5,
fov rate 3 — v1). Targets from the ball (`bx = clamp(ball.x, ±7.62)`, `bz = clamp(ball.z, −14.3, 0)`):

```
near = max(0, bz − nearZ)                                     // metres past the near threshold
camPos = ( kx·bx, y, z0 + kz·(bz + 9) + nearZ0·near )
lookAt = ( kx·bx, lookY + shotLift, lookZ + nearLook·near )
fov    = baseFov(aspect) − (hypot(bx − RIM.x, bz − RIM.z) < 4.5 ? paintZoom : 0) − dunkPush + breakWiden
portrait: camera.setViewOffset(W, H, 0, lensShift·H/2, W, H)   // content moves up by lensShift NDC
```

`FRAMING` (exported constant; [M] = verified with the vendored three.js over 6 ball scenarios — CHECK, right wing with a
far-corner teammate, right wing with a weak-wing teammate, left corner, paint, handler at z −1 — counting feet (y 0)
and heads (y 2.1) of all six players):

| mode | orientation | fov | kx | y | z0 | kz | lookY | lookZ | nearZ / nearZ0 / nearLook | paintZoom | lens shift | result [M] |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **standard** (default) | landscape | **42** | 0.35 | 6.5 | 4.5 | 0.30 | 1.0 | −8.0 | −4.0 / 0.5 / 0.6 | 3 | 0 | 36/36 points in view at 844×390, 16:9; handler 56–93 px tall at 390 px; rim+ball worst \|NDC\| 0.68; handler at z −1: feet −0.67, half line −0.83 |
| standard | portrait | **72** | 0.35 | 9.0 | 12.0 | 0 | 1.0 | −7.0 | — | 4 | **0.25** | 34/36 at 390×844 (36/36 at 360×640); handler 42–66 px at 844 px; worst 0.51; rim at NDC y 0.48, half line −0.09, jumbotron 0.76–0.95 |
| close (近景) | landscape | 38 | 0.45 | 5.2 | 3.5 | 0.40 | 1.1 | −8.5 | −4.0 / 0.7 / 0.9 | 3 | 0 | 34/36; handler 71–121 px; weak corner off-screen → indicators |
| close | portrait | 66 | 0.40 | 7.5 | 10.5 | 0.10 | 1.0 | −7.0 | — | 4 | 0.25 | 29/36 at 390×844; handler ≥ 52 px |
| high (高位) | landscape | 46 | 0.30 | 11.0 | 6.0 | 0.20 | 1.0 | −8.5 | −4.0 / 0.4 / 0.5 | 3 | 0 | 36/36; handler 39–50 px |
| high | portrait | 74 | 0.40 | 13.0 | 10.0 | 0 | 0.0 | −6.0 | — | 4 | 0.15 | 33/36 (GAMEPLAY §14 #1 proposal, kept as the "high" option) |

v1 for comparison [M]: landscape `{44, 0.35, 8, 4.5, 0.20, 1, −9}` → 35/36 points, handler 49–78 px, half line at
NDC −1.31 with the handler at z −1 (feet −1.08, off-screen: [R1#2][R1#41]); portrait `{70, 0.80, 11, 8}` → 28/36 points,
court band NDC 0.11…−0.62 ([R1#1]). The review's adjusted landscape fix `{46, 0.35, 8, 5.5, 0.25, 1, −8}` → 36/36 but
handler only 46–69 px; the chosen framing is lower (pitch 23° instead of 30°) and closer, which suits the realistic
bodies and puts more faces on screen.

- **Aspect rule (landscape)**: for 1 ≤ aspect < 16/9 the vertical fov widens to keep the 16:9 horizontal coverage:
  `baseFov = max(fov, 2·atan(tan(fov/2)·(16/9) / aspect))` (standard at 4:3 → 54.2°, at 1:1 → 68.6°). Portrait is chosen
  by `aspect < 1` only (v1).
- **Shot lift**: while a shot is in flight and `ball.y > 4.0`, `shotLift → 0.5` (rate 3), else 0. Apex of a top-of-key
  three (y 5.6 at z −9) stays at NDC y ≤ 0.77 [M].
- **Dunk push-in**: from the dunker's `takeoff` event to `slam + 0.5 s`, `dunkPush → 4°` (rate 4) and the look point
  blends 30 % toward the rim.
- **Break widen**: when the ball moves toward the rim faster than 6 m/s with `bz > −8` (clear-the-ball transitions
  [GP §13]), `breakWiden → 2°`.
- **Snap** (cut) on MENU/INTRO → CHECK and after replays; ease 0.4 s after a camera-mode change in settings.
- Accessors used by tests: `broadcast.target(world, out)` (pure), `FRAMING`, `baseFov(aspect, f)`.

### 4.3 Off-screen and pass indicators (`src/ui/indicators.js`)

- For each of the user's two teammates (and the user's defensive assignment on defence): project the feet and head;
  if neither is inside `|x| ≤ 0.98, |y| ≤ 0.98`, show a 30 px circle at the screen edge on the ray from the screen
  centre toward the projected point, inset 14 px + safe insets, clamped vertically to
  `[56 px + safe-top, H − 200 px − safe-bottom]` (portrait) / `[56, H − 90]` (landscape); content = jersey number in the
  kit colours, 2 px white ring when he is the predicted pass receiver; a small triangle points outward.
- Pass-target chevron: on offence while the user's player holds the ball, a 16 × 10 px chevron in the team UI colour
  floats 0.25 m above the head of the predicted receiver (`game.passPreview()` [GP §15]); hidden during windups.

### 4.4 Intro camera (`src/cam/shots.js` → `introShots(lineup)`; director mode `intro`)

Sequence (full ≈ 15.7 s; short 4.5 s; off 0 s — setting §5.10; rematch uses short):

| # | shot | duration | camera | other |
|---|---|---|---|---|
| 1 | establishing crane | 2.5 s | from (−14, 11, 14) → (−6, 6.5, 8), look (0, 1, −6) → (0, 1.2, −7), fov 50 → 42, ease-in-out | preset `intro`; jumbotron `title`; horn sting + crowd swell 0.6 |
| 2–7 | one per legend: team A (★ first) then team B | 1.6 s each; LeBron 3.2 s (his `cel.lebron.chalk` [ANIM §8.4]) | `p = player + R(yaw)·(0.35, 0.72 h, d)` with `d` 3.2 → 2.6 m (ease-out), look `player + (0, 0.80 h, 0)`, fov 28, 8° orbit left → right; `h` = barefoot height | spot on the player; lower-third card (§5.6); jumbotron `intro`; the legend plays his showcase loop [ANIM §8.4]; audio "boom" hit |
| 8 | matchup | 2.0 s | (0, 1.7, 3.0) look (0, 1.4, −5), fov 44 | the six face each other in two rows of 3 (team A x −2.4/−1.2/0, z −4.4…; team B mirrored at z −6.0), "暗夜队 VS 烈阳队" title |
| — | cut to CHECK | — | broadcast snap | preset `play` over 0.6 s |

Players stand on intro spots: team A at x = −4.2, −2.8, −1.4, team B at 1.4, 2.8, 4.2, all at z = −6.0 facing +z, moved
there by the director before the sequence (no sim). Tap = skip the current legend; the 跳过 button (or Esc/Enter) skips
the whole intro. Total budget without skipping ≤ 16.5 s (A31).

### 4.5 Lineup turntable, title, pause, halftime, game over, showcase

| mode | camera | subject / behaviour |
|---|---|---|
| `title` | (0, 0.9, 6.0) look (0, 1.25, −4) fov 38, slow orbit ± 12° about (0, 1.2, −4) at 3°/s, ping-pong | the six legends in a shallow arc at z −4 (team A left, team B right, 1.25 m apart), idle loops; preset `intro`; spot at 0 |
| `lineup` (landscape, overview) | (0, 1.6, 2.5) look (0, 1.2, −7) fov 40 | six on the arc x = −4.2, −2.8, −1.4, 1.4, 2.8, 4.2 at z −7 (≈ 113 px tall at 390 px); DOM cards pinned under each projected pair of feet |
| `lineup` (focus; portrait always) | `player + (0, 1.35, d)`, look `player + (0, 1.15, 0)`, fov 30, `d = (h + 0.35)/(2·tan 15°)` (Yao 4.9 m, Kyrie 4.1 m); portrait lens shift 0.30 (subject in the upper half) | **turntable**: the focus player's object yaw turns 20°/s when idle; drag rotates 0.5°/px with inertia (decay 4 /s); auto-spin resumes 3 s after the last touch; others hidden in portrait; 0.5 s ease between focus players |
| `pause` | ease 0.6 s to (9, 5.5, 3) look (0, 1.5, −8) fov 40, then drift +0.12 m/s in x for 8 s | rendered at 30 Hz during the drift, then **rendering stops** (frozen canvas) until resume; resume = cut to broadcast + v1 1.0 s countdown |
| `halftime` | (0, 14, 12) look (0, 0, −8) fov 46, pan x −3 → +3 over 6 s | players idle; tap/any non-reserved key skips ([R1#21]) |
| `gameover` | 1.0 s hold on broadcast after the buzzer, then cut: orbit the MVP at r 3.2 m, height 1.5 m, 12°/s, fov 32, look at chest; portrait lens shift 0.30 | MVP celebration, winners behind [ANIM §8.4]; preset `gameover` |
| `showcase` | fixed (§9.6) | likeness screenshots |

### 4.6 Instant replay (`src/cam/replay.js`)

**Recorder** (always on in CHECK/LIVE/DEAD; skipped in other states):
- Ring buffer of **240 frames** (4.0 s at 60 Hz; at most one sample per 1/60 s of game time; slower frame rates simply
  record fewer frames). Per frame: game time (1 float) + 6 × 233 floats per player + 8 floats for the ball = 1,407
  floats → `Float32Array(240 × 1,407)` = **1.35 MB, allocated once per page**.
- Per player (233): root position x, y, z + yaw (4), 53 local bone quaternions (212), pelvis local position (3), 9
  expression weights (9), eye offset (2), visible flag (1), 2 spare. Ball (8): position (3), quaternion (4), visible (1).
- Event ring (32 entries: time, kind, playerIndex): `takeoff`, `release`, `slam`, `score`, `block`, `steal`, `buzzer`
  from game/animation events.
- Requires from ANIMATION (§13): `animator.capture(f32, offset)` writes the 233 floats after all layers/IK, and
  `animator.applyBlend(f32, offA, offB, alpha)` composes the slerped/lerped pose into the bone matrices (allocation-free,
  bypasses evaluation while `animator.external = true`).

**Triggers** (setting `replays`: 关 / 扣篮与绝杀 (default) / 全部精彩):
| trigger | default | 全部精彩 |
|---|---|---|
| made dunk | ✓ | ✓ |
| made shot that wins or ties in the last 3.0 s of Q4/OT, or any make at a period buzzer | ✓ | ✓ |
| chase-down / help block, ankle-breaker ([GP] ability log) | — | ✓ |
Cooldown: 45 s of game clock between replays (game-winners exempt); max 6 per game.

**Window and timing**: replayed game-time window = 1.5 s, played at **0.5× → 3.0 s on screen**:
dunk `[slam − 1.15, slam + 0.35]`; jumper `[release − 0.30, release + 1.20]`; block `[block − 1.0, block + 0.5]`.
Sequence after the triggering event (t = 0 = the score/block event): 0–0.9 s live celebration on broadcast; 0.9 s DOM
wipe-in (gold bar sweep with "回放 REPLAY", 0.25 s); 1.15 s replay starts, letterbox bars slide in (0.2 s); 4.15 s replay
ends; wipe-out 0.25 s; 4.40 s back to the game, which continues to CHECK (camera snap). GAMEPLAY extends the dead ball with
`game.holdDead(2.9)` (§13); the game clock is stopped in DEAD anyway. Game-winner: plays after the final buzzer, before
the game-over panel.

**Playback**: `t_play += 0.5 · frameDt` (paused with the game); find the bracketing samples; per player
`quaternion.slerpQuaternions` (scratch objects) and lerp for positions/expressions; ball idem; the net sim is driven by the
replayed ball with `dt × 0.5`. Recording is suspended during playback. Skip: any tap on the canvas/HUD, any key, or the
44 px "跳过 ▶▶" button → 0.15 s wipe-out.

**Camera paths** (subject = recorded pelvis of the focus player, smoothed with a 0.15 s critically damped follow):
| kind | path |
|---|---|
| dunk | orbit the subject at radius 3.6 m, height 1.2 → 2.2 m, azimuth starting 60° to the camera side of the dunker's approach, sweeping −50° over the 3.0 s, fov 32, look at subject + (0, 0.9·h·0.55, 0) blended 40 % toward the rim after `takeoff`; at `slam` a 0.25 s shake 0.03 m at 12 Hz |
| jumper | first 55 %: 2.8 m behind and 1.9 m above the shooter, looking over his shoulder at the rim, fov 35; then cut to the rim cam at (rim.x ± 2.4, 3.8, rim.z + 3.0) (side away from the shooter) looking at the rim, fov 35 → 28 |
| block | side-on, 5 m from the shot line at 1.6 m height, fov 30, tracking the ball |
Constraints: camera z ≥ −12.0 (never behind the backboard plane), y ≥ 0.8, ≥ 0.9 m from every recorded pelvis.

**Presentation**: letterbox bars 7 % of the height top and bottom (`#lbTop/#lbBot`, black), tag "回放 REPLAY" 13 px gold in
the top bar, CSS vignette, jumbotron `replay`, preset `replay`, HUD/controls hidden (pointer-events none except skip).
LOD: high — LOD0 for every player within 7 m of the replay camera; medium — LOD0 for at most the 2 nearest, LOD1 for the
rest; low — LOD1 for the 2 nearest; expressions/morphs on where the tier has morphs [CHR §9.1]; restored on exit. Audio
(§8): crowd bed low-passed to 600 Hz at × 0.6 gain; the recorded `slam`/`rim`/`swish` re-fire at their replay times with
the slow variants.

---
## 5. UI and presentation flow

### 5.1 Screen flow and states

```
BOOT(HTML loading screen) → LOADING → TITLE ─开始游戏→ LINEUP ─开始→ INTRO → CHECK/LIVE/DEAD… → HALFTIME → … → GAME_OVER
                                  │                                             ↑ replays run inside DEAD (§4.6)
                                  ├─快速比赛→ INTRO (default lineup, short intro) ─────────┘
                                  └─设置→ SETTINGS (sheet) → back
LOADING → LOAD_ERROR (重试 → LOADING; 简化模式 → TITLE with primitive humanoids)
GAME_OVER → 再来一局 → INTRO(short) → CHECK;  更换阵容 → LINEUP;  主菜单 → TITLE
PAUSE (overlay on CHECK/LIVE/DEAD/INTRO/replay) → 继续 (countdown 1.0 s) | 设置 | 返回主菜单
```
`game.state` gains `TITLE`, `LINEUP` (GAMEPLAY §12.1 calls the old `MENU` the title) and `INTRO`; `__game.ui.screen`
mirrors the visible screen for tests. `?quick=1` (tests) = TITLE → 快速比赛 with intro off; `?intro=0`, `?replay=0`
override settings for one session without persisting.

### 5.2 Design tokens (`css/style.css` `:root`; v1 tokens kept)

| token | value | use |
|---|---|---|
| `--bg` | `#0b0d14` | page, theme-color (A2 unchanged) |
| `--gold` / `--gold-2` | `#d9a520` / `#f6d27a` | brand, OVR, MVP, replay tag |
| `--panel`, `--panel-2`, `--panel-3` | v1 | menus |
| `--bug` | `rgba(10,12,20,0.82)` | score bug, tags |
| `--scrim` | `rgba(5,6,10,0.80)` | menus on touch (no blur) |
| team UI colours (score bug chip bg / text / accent) | DARK `#6F263D` / `#FFB81C` / `#FFB81C`; BRIGHT `#CE1141` / `#ffffff` / `#000000`; All-Star A `#f4f4f4` / `#1a1a1a` / `#d9a520`; All-Star B `#15161a` / `#ffffff` / `#CE1141` | chips, ring, LED takeovers, crowd shirts |
| fonts | v1 system stack; numbers `font-variant-numeric: tabular-nums`; no web fonts (no network) | — |
| minimum sizes | CJK text ≥ 13 px; secondary Latin labels ≥ 11 px; every tappable element ≥ 44 × 44 px; in-game buttons ≥ 56 px (A9) | [R1#12] |
| z-index | canvas 0, `#hud` 1, `#controls` 2, `#screens` (title/lineup) 8, `#present` (intro/replay chrome) 9, `#menus` 10, `#halftime` 11, `#rotateHint` 12, `#loading` 20, `#loadError` 21 | — |

Touch devices (`@media (hover: none)`): `#menus` and `.overlay` use `background: var(--scrim)` and **no
`backdrop-filter`** (a full-screen blur of a live WebGL canvas is the most expensive frame the page can produce,
[R1#13]); desktop keeps `blur(6px)`.

### 5.3 Loading screen (static HTML in `index.html`, visible before any JS)

- `#loading` (z 20): background `radial-gradient(ellipse at 50% 35%, #151a2a, #0b0d14 70%)`; logo block centred at 34 %
  height: "传奇对决" 40 px (portrait 36 px) weight 900, letter-spacing 0.08 em, gold gradient text
  (`--gold-2 → --gold`), "LEGENDS 3V3" 14 px letter-spacing 0.4 em; progress bar at 62 %: width `min(280px, 70vw)`,
  height 6 px, radius 3, track `rgba(255,255,255,0.12)`, fill `--gold`, CSS shimmer animation until JS sets a value;
  status line 13 px `--muted` ("正在加载球员… 42 %"); tip line 13 px rotating every 3.0 s (`tip.1…tip.6`: controls,
  meter timing, pump fake, crossover combo, rotate for landscape, quality settings); fan-project note 11 px at the
  bottom (`legal.note`).
- Progress = weighted sum (weights sum to 1.00): code 0.10 (set when `main.js` starts executing), assets 0.47 (by bytes
  received; `legends.json` lists every bin's byte size, PNG sizes come from `Content-Length` or a manifest constant),
  skin paint 0.18 (per character), kit paint 0.04, arena textures 0.08 (wood, markings, decal, crowd atlas, ball, LED,
  jumbotron), environment + shader warm-up 0.13 (`renderer.compile(scene, camera)` with every character visible + 2
  warm frames). The bar never moves backwards; ≥ 0.25 s per phase label.
- Phase labels: `load.engine` 正在启动引擎 / Starting engine, `load.assets` 正在下载球员模型 / Downloading players,
  `load.paint` 正在绘制球员 / Painting players, `load.arena` 正在布置球馆 / Building the arena, `load.compile` 正在准备着色器 /
  Preparing shaders.
- Fade-out 0.3 s into TITLE.

### 5.4 Title screen (`#screenTitle`, mode `title` §4.5)

| element | portrait (390 × 844 ref.) | landscape (844 × 390 ref.) |
|---|---|---|
| logo | centred, top 14 % (≥ 64 px + safe-top), "传奇对决" 36 px + "LEGENDS 3V3" 14 px | top 10 %, 34 px + 13 px |
| 3D | six legends filling 30–70 % of the height (lens shift 0.10) | arc fills the middle 60 % |
| buttons | column, centred, top 72 %: 开始游戏 primary 260 × 52, 快速比赛 secondary 260 × 46, 设置 secondary 260 × 46, gap 10 | row at bottom calc(18px + safe-bottom): three 180 × 48 buttons, gap 12 |
| language chip | bottom-left calc(12px + safe), 64 × 44, "中 / EN" | same |
| note | bottom centre 11 px `legal.note` "非商业粉丝作品 · 球员姓名与形象归其本人所有" / "Non-commercial fan project · names and likenesses belong to the players" | same |

### 5.5 Lineup / draft screen (`#screenLineup`; interactions are GAMEPLAY §12.2's, layout and 3D are this section's)

**Landscape** (≥ 568 × 300):
- Top bar 44 px (+ safe-top): back 44 × 44, title `lineup.title` 18 px, segmented `我方 [A][B]` and `球衣 [自动][经典]`
  (44 px tall), help "?" 44 × 44.
- Left column team A, right column team B: x inset 12 px + safe; header 24 px (team name 15 px, kit swatch 16 × 16,
  "我方 / YOU" tag, rename ✎ 44 × 44 hit area); three cards **168 × 72 px**, gap 8 px.
- Centre: the 3D overview arc (or the focus turntable after a tap); detail card overlay bottom-centre 300 × 104 px.
- Bottom bar 52 px (+ safe-bottom): 随机 / 重置 secondary 96 × 44, 开始 primary 160 × 46 on the right.
- `@media (max-height: 360px)`: cards 168 × 56 (stat chips hidden; they stay in the detail card), headers 20 px, top bar
  40 px, bottom bar 48 px; the screen scrolls vertically if still short (`.panel`-style scroll exemption, [R1#7]).

**Portrait** (≥ 360 × 640):
- Top bar 48 px (+ safe-top) as above.
- Stage: flex 1, min 200 px: focus turntable (portrait always uses focus mode; default focus = the user's ★ handler);
  detail card pinned to the stage bottom, full width − 24 px, 112 px tall.
- Two team strips: header 22 px + a row of three cards each `(100vw − 24 − 16)/3` wide (114 px at 390, 106 px at 360) ×
  72 px: number chip 24 px, short name 15 px (one line, ellipsis), OVR badge 13 px; top-3 stat chips move to the detail
  card. Gap 8 px; strips separated by 10 px.
- Actions row: 随机 / 重置 (44 px) + 开始 primary 52 px full width at the bottom (+ safe-bottom).
- Height check [M-arith]: 48 + 200 (min stage) + 2 × (22 + 72 + 8) + 54 + 60 = 566 ≤ 640 − 0 (360 × 640 Android) and
  ≤ 763 (390 × 844 minus notch 47 + home bar 34); the stage takes the rest (≈ 397 px on 390 × 844).

**Detail card** (focus player; both orientations): number badge 32 px circle in kit colours; name zh 20 px / 800 and
en 12 px uppercase `--muted`; OVR in a 44 px gold circle (24 px digits); four composite bars — label 13 px, bar 72 × 6 px,
value 13 px — computed from [PROF ratings] / `src/legends.js`:

| composite | formula | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|---|
| 投篮 SHT | 0.25 closeShot + 0.40 midRange + 0.35 three | 92 | 90 | 83 | 70 | 66 | 91 |
| 突破 DRV | 0.30 layup + 0.25 dunk + 0.25 speed + 0.20 ballHandle | 90 | 94 | 92 | 90 | 58 | 86 |
| 内线 INS | 0.40 closeShot + 0.30 strength + 0.30 rebound | 76 | 79 | 93 | 93 | 91 | 66 |
| 防守 DEF | 0.30 perimeterD + 0.30 interiorD + 0.20 block + 0.20 steal | 72 | 78 | 81 | 86 | 72 | 53 |

(rounded; every legend has at least one composite ≥ 90 so each card reads as a star.) Then up to four signature chips
(13 px, 28 px tall) named from the ability ids of [GP §1.2] via i18n `ability.<id>` (§5.11), plus height/era line 13 px.
Swap animation: the two characters walk (ANIM jog) to each other's spots over 0.6 s while the cards cross-fade; kit
repaint ([CHR] `setKit`, ≤ 15 ms) happens when they pass the midpoint. The All-Star switch shows a 1.2 s toast
`toast.allstar` "非默认阵容：已换上全明星球衣" / "Custom lineup: All-Star kits".

### 5.6 Intro overlay (`#present`)

- Lower-third card, slide in from −40 px + fade 0.25 s, out 0.2 s: landscape left calc(24px + safe-left), bottom
  calc(28px + safe-bottom); portrait left 16, bottom 34 % (above the thumbs). Size 300 × 84: number block 64 px wide
  (34 px digits, kit colours), name zh 22 px / 800, name en 12 px uppercase letter-spacing 0.12 em, line 3 13 px
  "OVR 97 · 1.98 m · 2008-10". Team header for the first legend of each team ("暗夜队 · 首发" 13 px).
- Matchup title: centred, 32 px (portrait 28), "{teamA} VS {teamB}" with team colour underlines 4 px.
- Skip: "跳过 ▶▶" top-right calc(8px + safe), 88 × 44.

### 5.7 HUD (`#hud`, read-only overlay; `src/ui/hud.js`)

| element | landscape | portrait | content / behaviour |
|---|---|---|---|
| `#scoreBug` | top calc(6px + safe-top), centred (`left 50%; translateX(−50%)`), height 40 px; grid `6px 44px 36px 104px 36px 44px 6px` + `#shotClock` 36 × 36 px 6 px to the right (total 318 px) | top calc(6px + safe-top), left calc(8px + safe-left), right calc(60px + safe-right); grid `6px 1fr 34px 92px 34px 1fr 6px` + shot clock 34 × 34 inside on the right | colour bars (6 px, team UI colour), abbreviations 14 px / 800 (≤ 2 CJK chars or 3 Latin, from `TEAMS_V2.abbr` or the user's name), scores 20 px / 900, centre = period 11 px `--muted` over game clock 16 px / 800; shot clock 18 px / 800, `#ff3b3b` < 5 s, pulsing (opacity 1 ↔ 0.55 at 2 Hz) < 3 s; possession = 3 px bar under the team cell (`#possA/#possB.on` kept for tests) |
| `#pauseBtn` | v1: top-right 44 × 44 | same | — |
| `#caption` | top calc(52px + safe-top), centred, max-width min(92vw, 560px) | top calc(56px + safe-top) | 16 px / 700 (15 px when height ≤ 420), pill background `rgba(8,10,16,0.55)`, radius 6, padding 4 px 10 px; rules §5.8 |
| `#banner` | v1 (top 32 %, 40 px) | top 30 %, 32 px | "+3 科比" style: value 40 px + short name 20 px |
| `#nameTag` | anchored at head socket + 0.32 m (projected), `translate(−50%, −100%)` | same | "#24 科比" 13 px / 800 on the team UI colour at 85 % opacity, radius 4, padding 2 px 6 px, height 20 px; 36 × 3 px stamina bar under it while stamina < 0.98 (red < 0.25; replaces v1 `#stamina`); pop 1.25 → 1.0 over 0.25 s on control change; hidden when off-screen, in intro/replay, and while the meter shows |
| `#meter` | 12 × 80 px (10 × 64 when height ≤ 420), radius 6, at the projected chest–head midpoint + (+40 px, −40 px); flips to −52 px when x > W − 80 | same | green band and fill from GAMEPLAY/ANIMATION (`meterFrom`, `METER_T`) [GP §3.2][ANIM §5.1]; `#meterPts` chip 22 × 18 above the bar: "3" gold when the feet are outside the arc, "2" white (live, D-GP-5); flash 完美/稍早/稍晚 14 px above; projection uses this frame's matrices ([R1#4]) |
| indicators | §4.3 | §4.3 | — |
| controls | v1 positions; `#cluster` z-index above `#stickRing` ([R1#10]) | v1 | relabel on offence/defence (v1) |
| `#rotateHint` | — | only on TITLE/LINEUP, first launches until 知道了; top calc(64px + safe-top); auto-hide after 6 s; button 44 px tall, padding 0 14 px | never during play ([R1#8]) |

### 5.8 Captions and commentary (`src/ui/captions.js`)

- Queue entries `{key, params, priority, t}` (`t = world.time`). Priorities: 3 = score / turnover / violation /
  buzzer, 2 = block / steal / ankle-breaker / ability, 1 = miss / rebound / check. On push: entries older than 2.0 s
  are dropped; a priority-3 caption flushes all lower-priority queued entries and cuts the current one after it has
  shown ≥ 0.6 s ([R1#42]); otherwise each caption shows 1.8 s + 0.3 s fade (v1); at most 4 queued. `clear()` on
  `Game.start()` and `Game.quit()` (not in gameOver) ([R1#19]); the current caption and banner re-render on a language
  toggle ([R1#20]); the banner state survives pause ([R1#22], `hud.bannerState()` per GP §14).
- Names: captions use `short` names from `src/legends.js` (`{name}`); new keys in §5.11. Streak line: a player's 3rd
  consecutive make → `cap.hot` "{name} 手感火热！"; game-winner → `cap.winner`; first dunk of the game → `cap.firstDunk`.
  Neutral wording only (no nicknames that the denylist bans).

### 5.9 Pause, halftime, game over

- **Pause** (`#menuPause`, max-width 380): 继续 primary 46 px; settings rows (画质, 语言, 音效, 观众音量, 镜头, 难度, 回放;
  §5.10); 返回主菜单 secondary 44 px. No lineup changes mid-game (GP). Camera `pause` (§4.5).
- **Halftime** (`#halftime`, 3.0 s or tap, v1 rule): "半场" 32 px; score 28 px; one leader line per team
  ("{name} 12 分 5 板" 13 px); `menu.tapToSkip`. Reserved keys P/Esc/M/T do not skip ([R1#21]).
- **Game over** (`#menuOver` + `#mvpCard`):
  - Box score columns: 球员, 得分, 投篮 (m/a), 三分 (m/a), 篮板, 助攻 (only if GAMEPLAY books `ast`), 抢断, 盖帽; one row per
    legend (team order, team separator rule), 13 px, row height 18 px (16 px under 360 px height), MVP row with a gold ★.
  - **MVP** = winning-team player with the highest `PTS + 1.2·REB + 1.5·AST + 3·STL + 3·BLK − 0.8·(FGA − FGM)`; ties →
    more PTS → lower roster index. `#mvpCard` 240 × 96: "MVP" 13 px gold, name zh 20 px / 800, en 12 px, stat line 13 px
    "28 分 · 9 板 · 4 助"; the 3D camera orbits him (§4.5).
  - Landscape layout: panel right calc(12px + safe-right), top/bottom 12 px + safe, width min(520px, 62vw); MVP card
    bottom-left calc(16px + safe). Heights [M-arith]: 12 + 22 + 8 + 30 + 8 + 7 × 20 + 8 + 44 + 12 = 284 ≤ 300 (640 × 300);
    `@media (orientation: landscape) and (max-height: 360px)`: title 16 px, final score 20 px, rows 17 px → 247 px.
    Actions: 再来一局 primary, 更换阵容 secondary, 主菜单 secondary, all 44 px, one row.
  - Portrait: MVP in the top 38 % (lens shift 0.30) with the card at 38 %; panel below, width calc(100% − 32px), max 420;
    name column 76 px + 7 × 40 px = 356 px fits 360-wide phones at 13 px.
  - Fallback: `.panel { overflow-y: auto; touch-action: pan-y; overscroll-behavior: contain; }` and
    `.panel .actions { flex-shrink: 0 }`, with the `input.js` document `touchmove` handler exempting targets inside
    `.panel, .scroll` ([R1#7], as GAMEPLAY §14 #7).

### 5.10 Settings (`#menuSettings` sheet from TITLE; subset in PAUSE)

Persisted as one JSON under `localStorage['legends3v3.settings.v2']`, every access in try/catch, in-memory fallback.

| row | options (default **bold**) | applies |
|---|---|---|
| 画质 Quality | **自动 Auto (shows the current tier, e.g. "自动 · 中")**, 低, 中, 高 | DPR, shadows, reflection, crowd count, LOD clamps at the next dead ball; texture sizes at the next load (note `settings.reloadNote`) |
| 语言 Language | **简体中文**, English | immediately (all `t()` text, LED/jumbotron repaint) |
| 音效 Sound | **开**, 关 | immediately (v1 `M`) |
| 观众音量 Crowd | 低 0.4, **中 0.7**, 高 1.0 | crowd bus gain |
| 镜头 Camera | **标准**, 近景, 高位 | §4.2 FRAMING mode, ease 0.4 s |
| 难度 Difficulty | 简单, **普通**, 困难 | GAMEPLAY |
| 每节时长 Quarter | 1, **2**, 3, 5 分钟 | next game (TITLE only) |
| 回放 Replays | 关, **扣篮与绝杀**, 全部精彩 | §4.6 |
| 开场介绍 Intro | 完整 (**first game**), 简短 (**rematch**), 关闭 | §4.4 |
| 球衣 Kits | **自动**, 经典, 全明星 | [DEC] All-Star rule; GAMEPLAY §12.5 |

Rows: label column `flex-basis 60px` (52 px under 400 px wide, `word-break: keep-all`, [R1#11]); segmented options
44 px tall ([R1#12]); rows gap 8 (4 in short landscape); the sheet scrolls (exempt from the touchmove block). In landscape
≥ 700 px wide the sheet uses two columns of rows.

### 5.11 New i18n keys (all in `src/i18n.js`; zh / en)

| key | zh | en |
|---|---|---|
| `app.title` | 传奇对决 3v3 | LEGENDS 3v3 |
| `brand.wordmark` / `brand.zh` | LEGENDS / 传奇对决 | LEGENDS / 传奇对决 |
| `legal.note` | 非商业粉丝作品 · 球员姓名与形象归其本人所有 | Non-commercial fan project · names and likenesses belong to the players |
| `title.play` / `title.quick` / `title.settings` | 开始游戏 / 快速比赛 / 设置 | Play / Quick Game / Settings |
| `lineup.title` / `lineup.you` / `lineup.start` / `lineup.shuffle` / `lineup.reset` | 选择阵容 / 我方 / 开始 / 随机 / 重置 | Lineup / YOU / Start / Shuffle / Reset |
| `lineup.kits.auto` / `.classic` / `.allstar` | 自动 / 经典 / 全明星 | Auto / Classic / All-Star |
| `comp.sht` / `comp.drv` / `comp.ins` / `comp.def` | 投篮 / 突破 / 内线 / 防守 | SHT / DRV / INS / DEF |
| `ability.kobe.postFade` / `.jab` / `.tough` | 背身后仰 / 试探步急停 / 高难度投篮 | Post Fadeaway / Jab-Step Pull-Up / Tough Shots |
| `ability.jordan.fade` / `.air` / `.ftDunk` / `.hawk` | 招牌后仰 / 空中换手 / 罚球线起跳扣篮 / 抢断嗅觉 | Signature Fadeaway / Mid-Air Switch / Free-Throw-Line Dunk / Ball Hawk |
| `ability.lebron.powerDrive` / `.chaseDown` / `.skipPass` / `.bully` | 强力突破 / 追身大帽 / 跨场传球 / 背身碾压 | Power Drive / Chase-Down Block / Cross-Court Pass / Bully Ball |
| `ability.giannis.euro` / `.longDunk` / `.helpBlock` | 欧洲步 / 长途奔袭扣篮 / 协防封盖 | Eurostep / Long-Stride Dunk / Help-Side Block |
| `ability.yao.hook` / `.highRelease` / `.anchor` / `.post` | 勾手 / 高点出手 / 护框 / 背身单打 | Jump Hook / High Release / Rim Anchor / Post Scorer |
| `ability.kyrie.combo` / `.finisher` / `.stepback` | 连续变向 / 终结大师 / 后撤步三分 | Handle Combo / Acrobatic Finisher / Step-Back Three |
| `ability.clutch` | 关键先生 | Clutch |
| `intro.starters` / `intro.vs` / `intro.skip` | {team} · 首发 / VS / 跳过 | {team} · Starters / VS / Skip |
| `replay.tag` / `replay.skip` | 回放 / 跳过 | REPLAY / Skip |
| `jumbo.dunk` / `.three` / `.block` / `.winner` / `.final` | 暴扣! / 三分! / 盖帽! / 绝杀! / 终场 | DUNK! / THREE! / BLOCKED! / GAME WINNER! / FINAL |
| `led.brand` / `.defense` / `.noise` / `.clutch` / `.gg` / `.score` | (bilingual strings of §2.5) | (same) |
| `cap.dunk` / `cap.hot` / `cap.winner` / `cap.firstDunk` | {name} 暴扣！ / {name} 手感火热！ / {name} 绝杀！ / {name} 送上本场首扣！ | {name} throws it down! / {name} is heating up! / {name} wins it! / {name} with the first dunk of the game! |
| `over.mvp` / `over.lineup` | MVP / 更换阵容 | MVP / Change Lineup |
| `settings.*` row labels and options of §5.10; `settings.reloadNote` | 贴图尺寸将在下次启动时生效 | Texture sizes change on the next launch |
| `load.*` (§5.3), `tip.1…tip.6`, `loadError.title` / `.retry` / `.simple` / `.detail` | 加载失败 / 重试 / 简化模式 / {file}（{reason}） | Loading failed / Retry / Simple mode / {file} ({reason}) |
| `toast.allstar` / `toast.webgl1` / `toast.tier` | 非默认阵容：已换上全明星球衣 / 设备不支持高清球员，已切换简化模式 / 画质已调整为{tier} | Custom lineup: All-Star kits / High-detail players need WebGL2: simple mode / Quality set to {tier} |

Player names are not i18n keys: they come from `src/legends.js` (`name`, `short`) [GP §1.1].

### 5.12 Mobile findings fixed here

| finding | status | fix |
|---|---|---|
| [R1#1] portrait framing | 2/3 ✔ | §4.2 portrait framing + lens shift + jumbotron in the top band + indicators |
| [R1#2], [R1#41] near 1.9 m / backcourt hidden | 2/3 ✔, n.v. | §4.2 landscape framing + near rule + backcourt stripe (§2.1) |
| [R1#4] meter lags the head | 2/3 ✔ | director ends with `camera.updateMatrixWorld()`; HUD projects after it |
| [R1#7] game-over panel clipped | 3/3 ✔ | §5.9 heights + short-landscape query + scroll exemption |
| [R1#8] rotate hint during play | 3/3 ✔ | only on TITLE/LINEUP; `showMenu(null)` hides it without persisting |
| [R1#9] joystick edge start | 2/3 ✔ | delete the initial `_updateStickVector` call in `_onStickDown` (adjusted fix) + A35 probe |
| [R1#10] ring over the cluster | 0/3 (code reading: real) | `#cluster { z-index: 2 }` above `#stickRing { z-index: 1 }` inside `#controls`; ring centre re-clamped to the stick zone box after tethering |
| [R1#11] labels wrap | 3/3 ✔ | `.row .lbl { flex-basis: 52px; word-break: keep-all }` under 400 px |
| [R1#12] targets < 44 px | 2/3 ✔ | every menu/hint/lineup control ≥ 44 px; landscape `.rows { gap: 4px }` |
| [R1#13] judged under blur | 2/3 ✔ | §6.3 judging rule + no blur on touch |
| [R1#19], [R1#20], [R1#22], [R1#42] captions/banners | ✔ / n.v. | §5.8 |
| [R1#21], [R1#36] halftime hotkeys | 2/3 ✔ | reserved keys excluded |

---
## 6. Quality tiers and performance (`src/render/quality.js`)

### 6.1 Ladder

Six rungs; a rung = tier × DPR. DPR caps per tier: low 1.0, medium 1.5, high 2.0 (A23).

| rung | tier | DPR (touch) | DPR (desktop) |
|---|---|---|---|
| 1 | low | 0.85 | 1.0 |
| 2 | low | 1.0 | 1.0 |
| 3 | medium | 1.25 | 1.25 |
| 4 | medium | 1.5 | 1.5 |
| 5 | high | 1.75 | 1.75 |
| 6 | high | 2.0 | 2.0 |

`dpr = min(window.devicePixelRatio, rungDpr)`. Below rung 1 with the demotion rule still firing → **30 Hz mode**
(render every 2nd rAF; the sim keeps 60 Hz fixed steps).

### 6.2 Settings per tier (binding; CHARACTERS §9.1 and ANIMATION §12.2 hold their own rows and are included by reference)

| setting | low | medium | high |
|---|---|---|---|
| shadows | shared blobs (0.45) | key-light PCF 1024², radius 2.0, proxies LOD3 + ball; blobs 0.25 | 2048², radius 2.5 |
| environment | none, hemi 1.10 | PMREM 128 | PMREM 256 |
| floor | Lambert; markings 1024×816; wood 512² | Standard + env; markings 2048×1632; wood 512² | + planar reflection; wood 1024² + wear |
| centre decal | 512² Lambert | 512² Standard | 1024² Standard |
| characters | [CHR §9.1] low (≈ 38k tris, 512 skin, no morphs) | medium (≈ 92k, 1024 skin) | high (≈ 135k; skin 2048 desktop / 1024 touch) |
| LOD clamp (play / menus & replays) | 3 / 2 (replay: LOD1 for 2 nearest) | 2–1 / 0–1 (replay: LOD0 for 2 nearest) | 1–0 / 0 (replay: LOD0 within 7 m) |
| animation | [ANIM §12.2] low | medium | high |
| crowd | 700, Basic, atlas 512² | 1,600, Lambert, 1024² | 2,600, Lambert, 1024² + camera flashes |
| ball | 20 × 14, 512×256 albedo | 32 × 24, + normal 512×256 | 48 × 32, 1024×512 albedo + normal |
| net | 12 × 5, 1 substep | 16 × 7, 2 substeps | same |
| LED / jumbotron textures | 1024×32 / 512×256, jumbotron repaint ≤ 1 Hz | 2048×64 / 1024×512, ≤ 2 Hz | same |
| ribbon board, centre-hung cube, ceiling fixtures | off / off / on | on / on / on | on / on / on |
| fog | on | on | on |
| MSAA (context) | on | on | on |
| intro spotlight | absent (preset uses dimming only) | present | present |

### 6.3 Detection and runtime adaptation

**Static start rung** (boot, before the loading screen's asset phase):
1. `gl.getExtension('WEBGL_debug_renderer_info')` → `UNMASKED_RENDERER_WEBGL` (fallback `RENDERER`), lower-cased:

| pattern | class | start / cap rung |
|---|---|---|
| `swiftshader`, `llvmpipe`, `software`, `basic render` | software | 2 / 2 |
| `mali-4`, `mali-t`, `mali-g31`, `mali-g51`, `mali-g52`, `mali-g71`, `mali-g72`, `adreno (tm) 3`, `adreno (tm) 4`, `adreno (tm) 50`, `adreno (tm) 51`, `adreno (tm) 61[0-9]`, `powervr`, `ge8` | low | 2 / 3 |
| `mali-g57`, `mali-g68`, `mali-g76`, `mali-g77`, `adreno (tm) 6[2-5]`, `intel(r) (uhd\|hd) graphics` | mid | 4 / 4 |
| `mali-g78`, `mali-g6[1-9]0`, `mali-g7[1-9]0`, `immortalis`, `adreno (tm) 6[6-9]`, `adreno (tm) [78]`, `xclipse` | upper | 4 / 6 |
| `apple gpu` (iOS/iPadOS Safari masks the model) | apple-mobile | 4 / 6 |
| `apple m`, `nvidia`, `geforce`, `radeon`, `amd`, `iris(r) xe`, `arc` (non-touch) | desktop | 6 / 6 |
| anything else | unknown | 4 / 5 |

2. Caps: `navigator.deviceMemory ≤ 2` → cap 2; `≤ 4` → cap 4. `navigator.hardwareConcurrency ≤ 2` → cap 2; `≤ 4` →
   cap 4. Touch device with `screen.width·screen.height·dpr² > 3.2 Mpx` and class ≤ mid → start at rung 3 (fill-rate).
3. `?quality=low|medium|high` (tests) or the settings choice overrides: forces the tier's top rung, disables auto.

**Cadence probe**: during the loading screen (no WebGL rendering yet) sample 30 rAF intervals; `cadence` = median.
`target = cadence < 12 ms ? 16.67 : cadence` (120 Hz displays are capped at 60 fps: a frame renders only when
`now − lastRender ≥ 16.67 − 1.5 ms`); iOS Low Power Mode / 30 Hz panels give `target ≈ 33.3` so they are not mistaken
for slow GPUs ([R1#3]).

**Judged frames** — a frame interval counts only if all hold: `game.state ∈ {CHECK, LIVE, DEAD}`, not paused, no menu
or overlay or settings sheet open, no intro, no replay, document visible, ≥ 2.0 s since the last rung change, resize,
orientation change, tab return or menu close (window cleared on each) ([R1#13]).

**Demote** one rung when, over the last 3.0 s of judged frames, `mean > 1.30 × target` or `p90 > 1.80 × target`;
severe (`mean > 2.0 × target` for 2.0 s) demotes immediately. **Promote** one rung when, over 10 s of judged frames,
`mean < 1.08 × target` and `p95 < 1.25 × target`, the rung is ≤ the cap, it was not demoted from that rung earlier in the
session, and fewer than 2 promotions happened. Max 4 rung changes per session; after that auto locks.

**Applying**: DPR-only changes apply immediately (`setPixelRatio` + `setSize`, no extra render, [R1#3]); tier changes
(shadow map on/off → program recompiles) apply at the next CHECK start, preceded by `renderer.compile(scene, camera)`;
a toast `toast.tier` reports a tier change (not a DPR change). Texture sizes never change at runtime.

`window.__game.quality = { tier, rung, dpr, cadence, target, auto, history: [{t, from, to, reason}] }`.

### 6.4 Budgets (all render passes in a frame counted: `renderer.info.autoReset = false`)

| budget (gameplay frame, CHECK/LIVE) | low | medium | high (touch) | high (desktop) |
|---|---|---|---|---|
| draw calls | ≤ 48 (est. 39) | ≤ 75 (est. 58 = 51 main + 7 shadow) | ≤ 105 (est. 76 + 17 reflection) | ≤ 105 |
| triangles | ≤ 70k (est. 50k) | ≤ 190k (est. 145k: characters 92k + proxies 21k ×2 passes + crowd 3.2k + ball/arena 9k) | ≤ 330k (est. 300k incl. reflection 110k) | ≤ 330k |
| texture memory (own accounting, §6.5) | ≤ 48 MB (est. 30) | ≤ 150 MB (est. 118) | ≤ 230 MB (est. 190) | ≤ 300 MB (est. 260) |
| JS time per frame (mean, reference device) | ≤ 9.0 ms (2021 low-end Android: PowerVR GE8320 / Mali-G52) | ≤ 7.0 ms (iPhone 11) | ≤ 6.0 ms (iPhone 13) | ≤ 4.0 ms |
| of which: steps / animation / render submit / HUD+audio+camera+net+crowd | 1.5 / 2.0 / 4.5 / 1.0 | 1.2 / 1.2 / 3.8 / 0.8 | 1.0 / 0.9 / 3.5 / 0.6 | — |
| frame rate | 60 aim, 30 floor | 60 | 60 | 60 |
| replay frames | + LOD0 focus: ≤ 60 calls, ≤ 90k tris | ≤ 85 calls, ≤ 230k | ≤ 115 calls, ≤ 420k | — |

Allocations: zero per frame in step/render/HUD/camera/replay/crowd/net (v1 rule); measured as in v1 (heap sampling,
[R1] verdict).

### 6.5 Texture memory accounting

`quality.trackTexture(tex, bytesPerPixel = 4, mip = true)` registers every texture/render target this game creates (CHARACTERS
registers theirs the same way); `__game.perf.texMB = Σ w·h·bpp·(mip ? 1.333 : 1) / 2²⁰` (+ depth/shadow maps at 4 B/px,
half-float targets 8 B/px; the default framebuffer is excluded). Tier estimates: low — characters ≈ 17, markings 3.4,
wood 1.4, decal 1.4, crowd 1.4, ball 0.7, LED/jumbo 0.9, misc 0.5 → ≈ 27 MB; medium — characters ≈ 80 (incl. morph
textures), markings 17.8, wood 1.4, decal 1.4, crowd 5.6, ball 1.4, LED/jumbo 3.5, PMREM 1.6, shadow 4.2, misc 0.8 → ≈ 118 MB;
high (touch) — characters ≈ 120, markings 17.8, wood 5.6, decal 5.6, crowd 5.6, ball 5.6, LED/jumbo 3.5, PMREM 6.3,
shadow 16.8, reflection 3.9 → ≈ 191 MB.

### 6.6 Pause, visibility, context loss

- `visibilitychange → hidden` (and `pagehide`): if a game is running (CHECK/LIVE/DEAD/INTRO/replay) → `game.pause()`
  (replay/intro timelines pause too), `audio.suspend()`, stop rAF; on other screens just stop rAF. `visible`: restart rAF
  (`acc = 0`), `audio.resume()`, show the pause menu if a game was paused (never auto-resume, v1), clear the judging
  window.
- Pause menu: render policy of §4.5 `pause` (30 Hz drift for 8 s, then no rendering until a change). Title and lineup
  render at 60 Hz (turntable) but are never judged.
- `webglcontextlost` / `restored`: v1 behaviour (pause, `#ctxLost`, reload on restore).
- Window `blur` without `hidden` (desktop alt-tab): no pause (v1).

---

## 7. Asset loading (static hosting and the Claude artifact)

### 7.1 Files and URLs

All fetches use `new URL(rel, import.meta.url)` from the module that owns them (`src/legends/library.js` uses
`'../../assets/legends/<file>'` [CHR §1.1]); no absolute URLs, no other origin, no service worker, no dynamic
`import()` (A2). This works next to the page on static hosting and inside the artifact wrapper, whose supporting files are
served next to the page.

| path | type (artifact `files` contentType) | size (raw) | fetched by |
|---|---|---|---|
| `index.html` | page | ≤ 14 KB | host |
| `css/style.css` | `text/css` | ≤ 40 KB | link |
| `src/**/*.js` (≈ 75 modules) | `text/javascript` | ≤ 1.1 MB (≈ 300 KB gzip) | module graph |
| `vendor/three.module.js` | `text/javascript` | 742 KB (189 KB gzip) [M] | import |
| `assets/legends/legends.json` | `application/json` | ≤ 140 KB | loader |
| `assets/legends/legends.shared.bin` | `application/octet-stream` (pass `{from, contentType}` explicitly) | ≤ 800 KB | loader |
| `assets/legends/legends.<id>.bin` × 6 | `application/octet-stream` | ≤ 300 KB each | loader |
| `assets/legends/legends.skin0/1/2.png`, `legends.<id>.groom.png` × 6, `legends.<id>.extra.png` × 6 | `image/png` | ≤ 0.9 MB total | loader |
| `assets/legends/README.md` | not fetched (shipped for provenance) | — | — |

Totals: ≤ 5.4 MB raw (assets ≤ 3.5 MB [CHR]), ≈ 3.4 MB if the host gzips text (bins/PNGs do not compress). Requests at
load ≤ 100 (A34). Artifact publishing: one publish (≈ 105 files < 255), `.bin` with explicit
`application/octet-stream`.

### 7.2 Speed

- `index.html` contains `<link rel="modulepreload" href="./vendor/three.module.js">` and modulepreloads for the 12 largest
  `src` modules (flattens the import waterfall; harmless if a host strips them), and
  `<link rel="preload" href="./assets/legends/legends.shared.bin" as="fetch" crossorigin="anonymous">` (+ `legends.json`).
  The `crossorigin` value matches `fetch()`'s default `same-origin` credentials mode so the preload is reused.
- The six player bins and the 15 PNGs are fetched in parallel (≤ 6 concurrent).
- Budgets ("Fast 4G": 9 Mbps down, 170 ms RTT, cold cache): loading screen painted ≤ 1.0 s; title interactive ≤ 7.5 s on
  an iPhone 11 (transfer ≈ 3.7 s gzip / 5.5 s worst raw + ≈ 1.2 s paint/compile), ≤ 12 s on the low-tier reference
  Android; warm cache ≤ 2.5 s.

### 7.3 Progress, timeouts, retries

- Byte progress from `response.body.getReader()` when `Content-Length` is present; otherwise the known size from
  `legends.json` (bins) or the manifest constant (PNGs) is credited when the file completes.
- Per file: timeout 20 s (`AbortController`), 2 retries after 500 ms and 1,500 ms [CHR §1.3]; a retry restarts that
  file only.
- Validation: header `format === 'legends-mesh' && version === 2`; every bin's `byteLength` equals its header entry;
  PNG decode via `createImageBitmap(blob, {premultiplyAlpha: 'none', colorSpaceConversion: 'none'})` [CHR].

### 7.4 Error UI and simplified mode

- After the last retry fails: `#loadError` panel (z 21) over the loading screen: title `loadError.title`, detail
  `{file} ({reason})` (`reason` = HTTP status, `timeout`, `parse`, `size`), buttons 重试 (re-runs only the failed files;
  successful buffers are kept) and 简化模式 (boots with the v1 primitive humanoids; `src/humanoid.js` stays as the
  fallback [CHR]), both 44 px. The failure is `console.warn`, not `console.error` (A1 stays clean in normal runs; A39
  inspects the panel).
- `!isWebGL2` → simplified mode directly with `toast.webgl1`.
- `localStorage` failures never block (try/catch, in-memory settings).

---
## 8. Audio (`src/audio.js` v2 + `src/audio/crowd.js`; all synthesized, no samples, no voices, no PA)

### 8.1 Graph and mixing

`ctx → master Gain (0.8; 0 muted; v1 unlock/suspend rules) → DynamicsCompressor (threshold −18 dB, knee 12, ratio 4,
attack 0.003 s, release 0.25 s) → destination`. Buses into master: `sfx` 1.0, `crowd` (setting 0.4 / **0.7** / 1.0),
`ui` 0.6. Spatial: `StereoPannerNode` per voice, `pan = clamp((x − camera.x)/8, −0.7, 0.7)`; distance gain
`clamp(9 / |source − camera|, 0.35, 1.0)`. Voices ≤ 16 (oldest dropped; squeaks ≤ 3 and clap grains pooled separately).
Budget: ≤ 0.3 ms main-thread JS per frame; generated buffers ≤ 2 MB, built at unlock (≤ 30 ms).

### 8.2 Court sounds (new or changed; v1 recipes [V1 §12] kept where not listed)

| sound | trigger | recipe |
|---|---|---|
| `squeak(i, x, z)` | ANIMATION `PLANT_*` events on cuts/stops [ANIM §13]: `i = clamp((decel − 6 m/s²)/10, 0, 1)` or turn rate ≥ 360°/s → i = 1 | triangle osc f0 2,200 ± 400 Hz (cosmetic RNG), +600 Hz over 70 ms then −300 Hz to 140 ms, FM sine 35 Hz depth 80 Hz, bandpass 2,600 Hz Q 3, gain 0.10·i (attack 5 ms, exp decay to 140 ms) + noise transient 15 ms highpass 3 kHz gain 0.05·i. Played with probability 1 if i ≥ 0.6 else 0.35; ≤ 1 per player per 250 ms; ≤ 3 concurrent |
| `thud(w)` | `LAND` of players ≥ 110 kg and every jump landing ≥ 0.5 m | sine 70 → 45 Hz over 120 ms gain 0.18·w + noise LP 300 Hz 60 ms gain 0.06 |
| `bounce` | dribble (v1) | v1 + random pitch × 0.94–1.06 + "hardwood ring" sine 420 Hz 60 ms gain 0.04 |
| `rim(s, kind)` | rim contacts | `tap` (s < 1.2): 930 Hz bandpassed square 90 ms gain 0.12; `clank` (front rim, s ≥ 1.2): partials 540 / 810 / 1,290 Hz (square → bandpass Q 8), decay 0.5 s, gain 0.32·s/4; `rattle`: 3–6 taps 40–90 ms apart, each × 0.7; `grab` (dunk): 380 + 1,200 Hz clang, 9 Hz AM wobble 0.4 s, stanchion rumble sine 55 Hz 0.6 s gain 0.20 |
| `net(kind)` | made basket | `swish` (clean, v1: noise 250 ms, bandpass 2.5 kHz → 800 Hz, gain 0.25); `rimIn` (rim contact ≤ 0.3 s before): 160 ms, 1.8 kHz → 900 Hz, gain 0.18; `snap` (dunk): noise 120 ms highpass 1.5 kHz gain 0.28 |
| `board(kind)` | backboard | `bank` (glass): triangle 180 Hz 150 ms gain 0.25 + click 1.1 kHz 20 ms gain 0.12; `thud` = v1 |
| `whistle` | v1 events | v1 + "pea" AM at a random 32–45 Hz |
| `horn` | period end | 3 sawtooths 233 / 277 / 349 Hz, lowpass 1.6 kHz, 6 Hz vibrato ± 3 Hz, 1.2 s, gain 0.35 |
| `shotHorn` | shot clock 0 | square 330 Hz + saw 331 Hz, lowpass 1.4 kHz, 0.6 s, gain 0.30 |
| UI: `tick`, `select`, `whoosh`, `boom`, `sting`, `wipe` | menus; swap; intro announcement; title; replay wipe | v1 tick; sine 880 → 1,320 Hz 60 ms gain 0.10; noise bandpass sweep 400 → 2,400 Hz 0.20 s gain 0.12; sine 55 → 38 Hz 0.6 s gain 0.35 + noise LP 200 Hz 0.15 s gain 0.20; saw chord 220/277/330/440 Hz LP 900 Hz attack 0.4 s release 1.2 s gain 0.12; noise highpass 2 kHz sweep 0.25 s gain 0.10 |
| replay variants | §4.6 | same recipes with frequencies × 0.7 and durations × 1.6 |

### 8.3 Crowd (`src/audio/crowd.js`)

- Beds: two 4.0 s looping pink-noise buffers (Voss–McCartney, 7 rows): `murmur` lowpass 500 Hz gain 0.06 (base) and
  `excite` bandpass 900 Hz Q 0.7 gain `0.20 · excite` — `excite` follows the same value as the visual crowd (§2.8).
- Vowel bursts (filtered noise through two parallel bandpasses = formants; attack 0.25 s, release 0.8 s):
  `ooh` F1 300 → 350 Hz Q 5, F2 800 Hz Q 4; `aah` F1 700 Hz, F2 1,200 Hz; `aww` (groan) F1 450 → 280 Hz, F2 900 → 700 Hz.
- Applause: 60 clap grains/s (each 12 ms noise, bandpass 1.2 kHz Q 1.5, gain 0.3–1.0 random) for 1.5–3.0 s.
- Chant (no words): two claps 0.25 s apart + a stomp (sine 60 Hz 80 ms) on beat 3 of a 1.0 s cycle, 30 grain voices
  jittered ± 25 ms; on while the visual chant is on (§2.8: CPU on offence, Q4/OT last 2:00 or margin ≤ 5, shot clock ≤ 8).
- Anticipation (clutch only): `ooh` with F1 gliding 300 → 420 Hz while a shot is in flight, resolved by cheer or `aww`.

| event | sound |
|---|---|
| user-team make 2 / 3 | swell 0.6 / 0.85 + `aah` + applause 1.5 / 2.5 s |
| CPU make | `aww` 0.4 + applause 0.3 for 1.0 s |
| dunk (any team) | swell 1.0 + `ooh` → `aah` + applause 3 s |
| block / ankle-breaker / chase-down | `ooh` 0.8 |
| air ball | `aww` (v1 groan replaced) |
| game-winner / buzzer-beater | swell 1.0 for 6 s + applause 4 s |
| intro announcement | swell 0.5 + `boom` |

---

## 9. Test plan

### 9.1 Harness (`test/harness.cjs`)

- Devices: v1 `desktop` 1280×720, `phonePortrait` 390×844 (iPhone 11), `phoneLandscape` 844×390, `androidPortrait`
  393×851 (Pixel 5) + new `androidSmall` 360×640 (DPR 3, touch), `landscapeShort` 740×304, `seLandscape` 568×320,
  `tabletLandscape` 1024×768.
- Helpers: `startGame` → `index.html?quick=1&intro=0` + click 快速比赛 (v1 helper semantics); `openLineup`, `forceTier`
  (`?quality=`), `waitLegends()` (`__game.legends.ready`), `frameStats()` (calls/tris/texMB of one complete frame).
- All items run headless Chromium with SwiftShader; it is classified "software" → rung 2 (low) unless `?quality=` forces a
  tier. Frame-rate budgets are not asserted headless (SwiftShader runs skinning on the CPU [POC perf]); counts and bytes are.

### 9.2 Changes to v1 items

| item | v2 change |
|---|---|
| A1 | `?quick=1`; also asserts all requests (incl. `assets/legends/*`) are same-origin and none fails |
| A2 | scan `src/**/*.js` recursively; a `src/a/b.js` file must import exactly `'../../vendor/three.module.js'` (depth-correct path); CJK allowed only in `src/i18n.js` and `src/legends.js`; dynamic `import()` still banned; also scans `assets/legends/legends.json` and `css/style.css`; **DENYLIST v2** (§9.3) |
| A3 | total lines of `src/**/*.js` in **[16,000, 32,000]**; no single file > 1,600 lines except `src/anim/clips/*.js`; `vendor/` still exactly `three.module.js` + `LICENSE.three.txt` |
| A4 | also checks the jumbotron/LED repaint on a language toggle (`__game.arena.jumbo.lastText` changes language) |
| A5 | score bug abbreviations from `TEAMS_V2` (zh/en) instead of HBT/RRF; 6 legends present |
| A9 | unchanged for in-game buttons (≥ 56 px); menus move to A35 |
| A18 | game-over panel has 6 rows + `#mvpCard` with a name present in `LEGENDS` |
| A20 | `#scoreBug` ∩ (`#btnPrimary`, `#btnPause`, `#cluster`) = ∅ on 8 viewports |
| A21 | expects fov 42 (landscape ≥ 16:9) and 72 (portrait), `baseFov` for 4:3 = 54.2 ± 0.5; rim + ball inside NDC computed **with the view offset** |
| A22 | hint shown on the first portrait TITLE; hidden in LIVE even if not dismissed ([R1#8]) |
| A23 | `?quality=low` → DPR ≤ 1.0; medium ≤ 1.5; high ≤ 2.0 |
| A25 | per forced tier after 5 s LIVE: draw calls / triangles / texMB ≤ §6.4 budgets (all passes); sim step < 1.5 ms (v1) |
| A26 | "non-background" = luma > 0.12 over > 25 % of pixels; team colours checked on the DOM chips (exact) and in 3D as a hue within ± 18° and saturation > 0.30 in a 24×24 px crop at the projected chest of each team's ★ player |
| A27 | + every new SFX function and the crowd module run without throwing while the context is suspended |

### 9.3 Denylist v2 (A2; word-boundary, case-sensitive like v1)

Removed: `LeBron`, `Jordan`, `Kobe` (the six legends' real names are required [DEC]). Kept: the 30 franchise names of
v1 (`Lakers … Wizards`, `Sixers`, `76ers`), `Curry`, `Durant`, `Jokic`, `NBA`, `2K`. Added: `Air Jordan`, `Jumpman`,
`Mamba`, `Black Mamba`, `King James`, `Greek Freak`, `Uncle Drew` (trademark-like nicknames, [GP §1.1]); brands `Nike`,
`Adidas`, `Spalding`, `Wilson`, `Swoosh`, `Gatorade`, `Under Armour`; zh team/brand names `湖人`, `公牛`, `骑士`, `雄鹿`,
`火箭`, `凯尔特人`, `勇士`, `热火`, `篮网`, `耐克`, `阿迪达斯`, `黑曼巴`, `飞人`, `小皇帝`, `德鲁大叔` (CJK entries are
matched without `\b`). Scanned: `src/**`, `index.html`, `css/style.css`, `README.md`, `assets/legends/legends.json`.

### 9.4 New acceptance items

| id | title | method and pass criteria |
|---|---|---|
| A28 | Legends loaded with correct heights | `__game.legends.ready === true` within 30 s; ids = the six; `dims.heightBarefoot` within ± 0.02 m of 1.96/1.96/2.03/2.09/2.27/1.87 [XCHK]; in the showcase lineup the projected pixel-height ratio Yao/Kyrie = 2.27/1.87 ± 3 % |
| A29 | Six distinct bodies | pairwise RMS distance of the six players' kept positions (from `lib`) > 0.008 m; showcase head and full-body crops pairwise differ by > 6 % of pixels (Δ > 24) |
| A30 | Lineup / draft flow | TITLE → 开始游戏 → LINEUP shows DARK (LeBron ★, Kyrie, Giannis) vs BRIGHT (Jordan ★, Kobe, Yao); tap Kobe then LeBron → swapped; kits switch to All-Star (`c.kitMode` `allstarA/B`; chest crop luma: A > 0.7, B < 0.2); 球衣 经典 restores classic hexes; 重置 restores; 开始 → score bug names; all lineup cards and buttons ≥ 44 px on 390×844, 844×390, 360×640 |
| A31 | Intro | full intro shows 6 lower-thirds with the current-language names in team order, jumbotron `intro` mode, total ≤ 16.5 s to CHECK; tap skips one legend; 跳过 skips all ≤ 0.3 s; rematch uses the short intro (≤ 5.0 s) |
| A32 | Instant replay | `debugShoot({kind:'dunk', p:1})` → `__game.replay.active` within 1.2 s of the score; camera mode `replay`; duration 3.0 ± 0.2 s at rate 0.5; focus player's LOD = tier rule (high: 0); a tap ends it ≤ 0.2 s; game reaches CHECK; a made jumper (not clutch) triggers no replay; setting 关 → none; renderer.info.memory unchanged after 3 replays |
| A33 | Quality tiers | `?quality=low/medium/high` → `__game.quality.tier`, shadows on/off, reflection on high only, crowd count 700/1,600/2,600; settings change applies at the next CHECK; auto on SwiftShader → rung 2; simulated slow frames while a menu is open do not demote ([R1#13]); a synthetic 33 ms cadence does not demote ([R1#3]); synthetic 3 s of 26 ms frames in LIVE at target 16.7 demotes exactly one rung |
| A34 | Load size and requests | Σ bytes of `index.html`, `css/`, `src/`, `vendor/`, `assets/legends/` ≤ 5.4 MB; `assets/legends/` ≤ 3.5 MB; requests during load ≤ 100; loading screen visible in the first screenshot ≤ 1.0 s after navigation (no throttling) |
| A35 | Mobile layouts | on the 8 viewports × zh/en: every visible `button`/`.opt`/card ≥ 44 px; zh `.lbl` = 1 line; game-over buttons fully inside `#menuOver`; lineup fits or scrolls by touch; joystick touchStart at (4, 300) and (150, H − 4) with no move → `intent.move.mag === 0` ([R1#9]); `#stickRing` never covers `#cluster` buttons ([R1#10]) |
| A36 | Camera framing | landscape and portrait, scenarios CHECK / wing / corner / paint / handler at z −1: rim and ball |NDC| ≤ 0.9; controlled player's feet NDC y ≥ −0.95; half line visible (y ≥ −1.0) when the handler is at z ≥ −2 (landscape); off-screen indicator present when a teammate's feet project outside NDC |
| A37 | Captions and banners | captions contain the player's `short` name; a score caption replaces a stale rebound caption within 0.7 s ([R1#42]); queue empty after rematch and quit ([R1#19]); banner re-renders on a language toggle ([R1#20]) and survives pause ([R1#22]) |
| A38 | Showcase page | `index.html?showcase=1&view=lineup` and `view=heads` set `__showcase.ready`; no console errors; screenshots saved to `test/results/showcase/` (lineup yaw 0 / 0.5 / π/2, heads yaw 0 / 0.6, kits classic / all-star); deterministic (two runs differ by < 0.5 % of pixels) |
| A39 | Asset failure | route-abort `assets/legends/legends.kobe.bin` → `#loadError` visible ≤ 25 s naming the file; 重试 after un-blocking → loads; 简化模式 → 6 primitive players, playable, no `console.error` |
| A40 | Memory stability | `renderer.info.memory` and `__game.perf.texMB` equal after 5 rematches + 5 lineup/kit changes + 3 replays (± 0) |
| A41 | Lighting calibration | renderer `toneMapping === NeutralToneMapping`, exposure 1; CHECK frame at 844×390 medium: wood patch mean luma 0.60–0.72 (§1.2); kit chest crops keep their hue (± 18°) |
| A42 | Artifact-like embedding | the page loaded inside `<iframe sandbox="allow-scripts allow-same-origin">` from a different directory depth, with `Storage.prototype.getItem/setItem` throwing: boots to TITLE, quick game reaches LIVE, settings work in memory, no cross-origin requests |

### 9.5 New unit tests (Node, no WebGL; `node test/unit-*.mjs`)

| file | covers |
|---|---|
| `unit-quality.mjs` | every renderer-string row of §6.3 → class/rung; memory/core caps; cadence target (8.3 → 16.67, 33 → 33); judge gate per state/menu/replay/intro; demote/promote/lock with synthetic interval streams |
| `unit-camera.mjs` | `FRAMING` values; `target()` purity; reproduces the [M] counts (landscape 36/36, portrait 34/36 at 390×844, 36/36 at 360×640); handler at z −1 → half line −0.83 ± 0.03; `baseFov(4/3) = 54.2 ± 0.1`; lens shift moves the rim from 0.23 to 0.48 ± 0.02 |
| `unit-replay.mjs` | ring wrap-around, bracketing, slerp at α 0.5, 0.5× time mapping, windows per kind, no `Float32Array` constructed after init |
| `unit-net.mjs` | rest stable; an impulse decays below 1 mm within 1.5 s; `|o| ≤ 0.18`; no NaN for dt ∈ [0, 0.1] |
| `unit-floorpaint.mjs` | wood tile seamless (edge rows/columns mean abs diff < 6/255), roughness alpha in [0.15, 0.40]; `worldToMarkPx` corners; half-line band 0.0254 m; strings from i18n and denylist-clean |
| `unit-ballpaint.mjs` | seam coverage 6–10 %; pebble density equator vs 60° latitude ratio 0.85–1.15; spin: backspin axis sign, rolling `|ω| r = |v|` |
| `unit-crowd.mjs` | seat counts per tier, occupancy, determinism by seed, palette shares ± 3 % |
| `unit-captions.mjs` | priority flush, 2.0 s age drop, `clear()`, language re-render |
| `unit-present.mjs` | MVP formula and tie-breaks; composite table of §5.5 for the six; settings schema defaults and try/catch persistence |
| `unit-audio.mjs` (extended) | new SFX with the mock AudioContext; squeak rate limit; voice cap 16; crowd envelopes |

Manual device matrix for phase D (results recorded in `test/README.md`): iPhone 11 (iOS Safari, medium/high), iPhone 13
(high), a 2021 low-end Android (PowerVR GE8320 or Mali-G52, low), a desktop with integrated graphics (medium) — each must
hold the §6.4 JS budget and ≥ 55 fps median (≥ 28 fps on low) over a 60 s LIVE sample, read from `__game.perf`.

---

## 10. Files and exports (this section's modules; all relative imports, three.js core only)

| file | ≈ lines | exports |
|---|---|---|
| `src/render/renderer.js` | 140 | `createRenderer(canvas, quality)`, `resizeRenderer(r, cam, w, h, {render:false})` |
| `src/render/quality.js` | 320 | `TIERS`, `RUNGS`, `detectStatic({renderer, nav, screen, touch})`, `class QualityMonitor {probeCadence(), judge(frameMs, gate), decision()}`, `trackTexture(tex, bpp, mip)`, `texMB()` |
| `src/render/lighting.js` | 220 | `createLights(scene, quality)`, `setPreset(name, s)`, `updateShadowFit(players, ball)`, `createShadowProxy(character, mat)` |
| `src/render/shadows.js` | 90 | `sharedBlob()` (texture + geometry, [R1#5]), `class BlobShadows` (instanced, 7) |
| `src/render/envmap.js` | 150 | `buildArenaEnv(renderer, quality)` |
| `src/render/floor.js` | 420 | `paintWoodTile(size, rng)` (pure), `drawMarkings(ctx, W, H, strings)`, `worldToMarkPx(x, z, W, H, out)`, `buildFloor(scene, quality)`, `buildCentreDecal`, `BackcourtStripe` |
| `src/render/reflection.js` | 200 | `class PlanarReflection {update(renderer, scene, camera), texture}` |
| `src/render/hoop.js` | 430 | `buildHoop(scene, quality, {far:true})`, `class NetSim` (pure core), `ShotClockDigits`, `rimShake(t)` |
| `src/render/arena.js` | 450 | `buildArena(scene, quality, rng)` → `{dome, stands, led, jumbo, centreHung, fixtures}`, `class Jumbotron {show(mode, data)}`, `class LedBoards {message(key), takeover(team, text)}` |
| `src/render/crowd.js` | 380 | `seats(tier, rng)` (pure), `paintCrowdAtlas(size)`, `buildCrowd(scene, quality, palette, rng)`, `crowd.excite(level, hold)`, `crowd.chant(on)` |
| `src/render/ballvis.js` | 260 | `paintBall(size)` (pure), `class BallVisual {update(dt, ball)}` |
| `src/render/fx.js` | 200 | `ChalkBurst`, `CameraFlashes`, `ControlRing` |
| `src/cam/director.js` | 380 | `class Director` (§4.1) |
| `src/cam/broadcast.js` | 240 | `FRAMING`, `baseFov(aspect, f)`, `class BroadcastCamera {target(world, out), update(dt, world)}` |
| `src/cam/shots.js` | 300 | `introShots(lineup, chars)`, `lineupShot`, `titleShot`, `pauseShot`, `halftimeShot`, `gameoverShot` |
| `src/cam/replay.js` | 360 | `class ReplayRecorder`, `class ReplayPlayer`, `replayWindow(kind, events)` |
| `src/ui/loading.js` | 220 | `class Loader {phase(name, w), bytes(n), error(file, reason)}` |
| `src/ui/screens.js` | 420 | title, settings sheet, pause, halftime, game over + MVP |
| `src/ui/lineup.js` | 420 | lineup layout, turntable input, detail card (logic calls GAMEPLAY's lineup API) |
| `src/ui/hud.js` | 560 | v2 HUD (replaces `src/hud.js`) |
| `src/ui/captions.js` | 170 | `class Captions` (§5.8) |
| `src/ui/indicators.js` | 150 | off-screen indicators, pass chevron, name tag |
| `src/ui/present.js` | 220 | intro lower-thirds, matchup title, replay chrome, toasts |
| `src/ui/settings.js` | 150 | `SETTINGS_SCHEMA`, `loadSettings()`, `saveSettings()` (try/catch) |
| `src/audio.js` (v2) | 780 | v1 API + §8.2 |
| `src/audio/crowd.js` | 300 | §8.3 |
| `src/showcase.js` | 260 | `?showcase=1` page (§9.4 A38): views `lineup`, `heads`, `turn`, `kits`; params `yaw`, `kit`, `groom`, `tier`, `expr`, `id`; `window.__showcase = {ready, setView}`; seeded, time frozen, no crowd/HUD, background `#2a2f3a`, lineup camera fov 18 at 26 m (near-orthographic), head cameras at eye height 0.85 m away fov 28 in a 6 × 2 scissor grid |

≈ 8,100 lines. Retired/replaced v1 files: `scene.js` (split into `render/*`), `camera.js` (→ `cam/broadcast.js`),
`court.js` (→ `render/floor.js` + `render/hoop.js`), `hud.js` (→ `ui/hud.js`). `main.js` wires the director, quality
monitor, loader and screens.

### 10.1 `index.html` / `css/style.css` changes

- `<title data-i18n="app.title">传奇对决 3v3</title>`; theme-color, viewport meta and the module script line unchanged (A2).
- Preload links of §7.2.
- New DOM: `#loading`, `#loadError`, `#screens > #screenTitle, #screenLineup`, `#present > #lowerThird, #matchup,
  #lbTop, #lbBot, #replayTag, #skipBtn, #wipe, #toast`, `#mvpCard`, `#menuSettings`; HUD additions `#nameTag`,
  `#meterPts`, `#offA`, `#offB`, `#passTarget`; `#stamina` removed (now in the name tag).
- CSS: tokens of §5.2, layouts of §5.3–§5.10 with the media queries `(orientation: portrait)`, `(max-width: 399px)`,
  `(orientation: landscape) and (max-height: 420px)`, `(orientation: landscape) and (max-height: 360px)`,
  `(hover: none)`.

---

## 11. Disposition of v1 review findings owned or touched here

| # | finding | status | v2 |
|---|---|---|---|
| 1 | portrait framing | 2/3 ✔ | fixed, §4.2 (numbers override GP §14 #1; GP's values kept as the "high" option) |
| 2 | landscape near 1.9 m hidden | 2/3 ✔ | fixed, §4.2 (overrides GP §14 #2's numbers; same intent, larger players) |
| 3 | DPR downgrade keyed on rAF | 1/3 | fixed, §6.3 cadence target + judged frames + no double render |
| 4 | meter projected one frame late | 2/3 ✔ | fixed, §1.6 step 7 / §4.1 |
| 5 | ball owns a second blob texture | 2/3 ✔ | fixed, `render/shadows.js` shared blob |
| 6 | backboard DoubleSide box | 2/3 ✔ | fixed, front-only glass plane at opacity 0.16 + separate markings |
| 7 | game-over clipped | 3/3 ✔ | fixed, §5.9 |
| 8 | rotate hint in play | 3/3 ✔ | fixed, §5.7 |
| 9 | joystick edge start | 2/3 ✔ | fixed (input.js), A35 |
| 10 | ring over cluster | 0/3 | fixed cosmetically, §5.12 |
| 11 | labels wrap | 3/3 ✔ | fixed, §5.10 |
| 12 | targets < 44 px | 2/3 ✔ | fixed, §5.2 rule + A35 |
| 13 | judged under blur | 2/3 ✔ | fixed, §6.3 + no blur on touch |
| 19, 20, 22, 42 | captions/banners | ✔ / n.v. | fixed, §5.8, A37 |
| 21, 36 | halftime hotkeys | 2/3 ✔ | fixed, §5.9 |
| 33 | dunk teleports ball | n.v. | moot (ANIM socket-driven slam); presentation adds rim shake + replay |
| 41 | backcourt hidden | n.v. | fixed, §4.2 near rule + §2.1 stripe |
| 43 | bodies merge under the rim | n.v. | GAMEPLAY separation; replay camera keeps ≥ 0.9 m from every pelvis |
| 44 | verdict | — | framing priority handled (D-PR-6) |

---

## 12. Numbers at a glance

| item | value |
|---|---|
| tone mapping / exposure | Neutral / 1.0 |
| key / rim / hemi (medium) | 2.5 / 1.3 / 0.35; env 0.55 |
| shadow map | 1024² (medium), 2048² (high), fit 9–22 m, ≈ 1.07 cm/texel at CHECK (medium) |
| floor textures | markings 1024×816 / 2048×1632, wood tile 512² / 1024² over 2.28 m |
| crowd | 700 / 1,600 / 2,600 instances, 1 draw |
| broadcast landscape / portrait | fov 42, cam (0.35 bx, 6.5, 4.5 + 0.3 (bz + 9)) / fov 72, cam (0.35 bx, 9, 12), lens 0.25 |
| replay | 1.5 s window at 0.5× = 3.0 s, buffer 240 frames = 1.35 MB |
| intro | 15.7 s full, 4.5 s short |
| ladder DPR | 0.85 / 1.0 / 1.25 / 1.5 / 1.75 / 2.0 |
| budgets (calls / tris / texMB) | low 48 / 70k / 48; medium 75 / 190k / 150; high 105 / 330k / 230 (touch) |
| payload | ≤ 5.4 MB raw, ≤ 100 requests, title ≤ 7.5 s on Fast 4G (iPhone 11) |

---

## 13. Requirements on sibling sections

- **ANIMATION**: `animator.capture(f32, off)` (233 floats, §4.6) and `animator.applyBlend(f32, offA, offB, α)` with
  `animator.external` to bypass evaluation during replays; an event callback with world time for `takeoff`, `release`,
  `slam`, `PLANT_*` (with deceleration/turn rate), `LAND` (with drop height), `SLOWMO_IN/OUT`, `FX chalkBurst`;
  `animator.freeze(clipId, t)` for the showcase; a yaw override for the turntable that does not trigger locomotion;
  a "walk/jog to spot" for intro placement and lineup swaps.
- **CHARACTERS**: an uncovered LOD3 body index for `createShadowProxy` (or `c.createShadowProxy(material)`); register
  textures with `quality.trackTexture`; `c.setReflectable(on)` enabling layer 2 on body + kit; LOD override API for
  replays/lineup (`c.lodOverride = n | null`); sockets `headWorld`, `handWorld`, `palm_s` for HUD/FX; `c.kitMode`
  readable for A30.
- **GAMEPLAY**: `game.holdDead(seconds)`; game events with `{kind, points, playerId, team, clutch, buzzer, time}` for
  score, block, steal, ankle-breaker, possession change; `game.passPreview()`; states `TITLE`, `LINEUP`, `INTRO`;
  `stats.ast` if booked; `TEAMS_V2.abbr` of ≤ 2 CJK characters (proposal: 暗夜 / 烈阳 / 白队 / 黑队, en DRK / BRT / WHT /
  BLK); user-editable team names (≤ 8 CJK / 12 Latin characters); the framing numbers of GP §14 #1/#2 are superseded by
  §4.2 (A21 expects fov 42 / 72).
