# Legends mesh format — version 2

Written by `bake.mjs`, read by `src/legends/format.js` / `library.js` (SPEC-v2 §3). One bake writes 23 files into
`assets/legends/`:

| file | content |
|---|---|
| `legends.json` | the header (this document) |
| `legends.shared.bin` | topology, UVs, wet-group vertex colours, skin weights, LOD indices, shared shells, metric vertex sets |
| `legends.<id>.bin` ×6 | per player: positions, normals, expression morph deltas, groom shells, shoe cover lists |
| `legends.skin0/1/2.png` | shared skin masks |
| `legends.<id>.groom.png`, `legends.<id>.extra.png` ×6 | per-player masks |

The runtime rejects anything but `format === "legends-mesh" && version === 2`. A header with `"devOnly": true`
(baked with `--no-lod`, or `--fast` for calibration) must be refused outside `?debug=1`.

## Binary sections

All binary data is little-endian; every section starts on a 4-byte boundary. Each file has one section table
(`header.shared.sections`, `players[i].sections`): `name → { offset, count, type, itemSize, bytes }` — `count`
items of `itemSize` components, typed-array length `count · itemSize`.

**Every other place in the header references a section by its name** (a string key into the table of the file it
lives in: shared shells → `shared.sections`; per-player shells, morphs and covers → that player's `sections`).

| type | storage | value |
|---|---|---|
| `u8` | Uint8 | integer |
| `u8n` | Uint8 | v / 255 |
| `u8n*4` | Uint8 | v / 255 · 4 (shell offsetScale, 0..4) |
| `u8n*0.1m` | Uint8 | v / 255 · 0.1 m (shell boundary distance) |
| `u16` | Uint16 | integer (indices) |
| `u16n` | Uint16 | v / 65535 |
| `u16n*2` | Uint16 | v / 65535 · 2 (0..2) |
| `u16q` | Uint16 | `posMin[axis] + v · posStep[axis]` (metres) |
| `i16q` | Int16 | v · `morphs.step` (= 0.00002 m) — morph deltas |
| `oct8` | Int8 ×2 | octahedral unit normal, components / 127 |

## Coordinates and vertex spaces

- Metres, +y up, the character faces +z, soles on y = 0, pelvis over x = z = 0; `_l` / `l-` = character's left (+x).
- **kept vertices** (`counts.keptVertices`): per-player positions, normals, skin weights and morph deltas live
  here. Layout (`header.kept`, `[start, count]`):
  - `body` — the hm08 skin vertices (obj 0..13379) in obj order, then **36 lip-seam copies**: vertices shared by
    upper-lip and lower-lip faces at the stomion and the inner lip fold are duplicated; the lower-lip faces use
    the copy. Copies coincide in the rest pose (the face is watertight) and separate under `jawOpen`.
  - `mouth` — upper teeth, lower teeth, tongue (MakeHuman helpers).
  - `lashes` — the eyelash card vertices (no body triangles; used only by the `lashes` shell).
  - `eyeL`, `eyeR` — 362 generated eyeball vertices each (below).
- `keptToObj` (u16): base.obj index per kept vertex; 65535 for generated eyeball vertices. Lip-seam copies point to
  the same obj vertex as their original.
- **render vertices** (`counts.renderVertices`): kept vertices split at UV seams; `renderToKept` maps them back.
  UVs, vertex colours and every index buffer address render vertices.

## Shared binary

| section | type | content |
|---|---|---|
| `renderToKept` | u16 ×1 | kept index per render vertex |
| `uv` | u16n*2 ×2 | body: MakeHuman atlas UV (v up). Eyes: front-disc projection `0.5 + (x − cx, y − cy)/(2R)` (iris radius `eye.irisRadiusUv` 0.225). Teeth/tongue: (2.0, 0.0) → the wet shader samples the constant eye-texture texel for u ≥ 1 |
| `color` | u8n ×3 | vertex colour (sRGB bytes): eyes and body white, teeth `#e9e3d4`, gums `#a8504a` (upper teeth > crown midline + 3 mm, lower < midline − 3 mm), tongue `#b0605a` |
| `index` | u16 ×3 | LOD0 triangles; groups below |
| `eyeLow.index` | u16 ×3 | the 12 × 8 eyeballs (2 × 168 tris) — wet group of the low tier |
| `lod1.index` … `lod3.index` | u16 ×3 | body LODs over the SAME render vertices (`header.lods[i].section`) |
| `skinIndex` / `skinWeight` | u8 ×4 / u8n ×4 | per kept vertex, top 4 influences, each vertex sums to exactly 255; eyeballs 100 % `head` |
| `keptToObj` | u16 ×1 | see above |
| `measure.<set>` | u16 ×1 | kept vertex sets of the likeness metrics (`header.measureSets`) |
| `shell.<name>.<attr>` | | shared shells (below) |

`shared.groups`: `[{name:'body', material:'skin', start, count}, {name:'wet', material:'wet', start, count}]`
(start/count in indices). `shared.wetParts`: `{eyes: [start, count], mouth: [start, count]}` inside the wet group.

`lods[i]` = `{ratio, lockHead, triangles, bodyTriangles, error, section, groups, wet}`: LOD1 0.5 and LOD2 0.25 with
the face locked, LOD3 0.12 unlocked (meshoptimizer `simplifyWithAttributes`); their wet group is eyes (24 × 16) +
mouth, except LOD3 whose wet group is the 12 × 8 eyes only (`wet: 'eyesLow'`).

## Eyes

`header.eye` = `{segments 24, rings 16, lowSegments 12, lowRings 8, corneaDeg 24, corneaK 0.06, irisRadiusUv 0.225}`.
Generated UV spheres with the pole at +z (front): vertex 0 = front pole, then 15 rings of 24, then the back pole.
Per player: centre = mean of the morphed `helper-*-eye` vertices, radius R = their max distance from it
(`players[i].eyes`); directions within 24° of +z are pushed out by `0.06·R·cos(π/2·θ/24°)` (cornea). Skinned
100 % to `head`.

## Header top level

| key | content |
|---|---|
| `counts` | `{renderVertices, keptVertices, bodyKeptVertices, triangles, bones, eyeVertices}` |
| `kept` | kept ranges (above) |
| `shared` | `{file, bytes, sections, groups, wetParts}` |
| `eye` | eyeball topology constants |
| `bones` | `[{name, parent}]`, 53 game_engine bones, parents first |
| `baseBones` | `{bone: [x,y,z]}` bone heads on the unmorphed base.obj (metres) — e.g. kit scale `(spine_03.y − pelvis.y)_player / (…)_base` |
| `baseScaleRefs` | base.obj references: `headH` 0.2314 (crown → ME), `crownY`, `menY`, `pelvisY`, `spine03Y`, `ankleY` |
| `landmarks` | `{name: {obj, kept, base: [x,y,z], uv: [u,v]}}` — the SPEC §3.5.2 face landmarks (`G N PRN SN LS ST LI SM PG ME FH V OP` + `_l/_r` of `CH AL EN EX PS PI ZY GO T EL ET`), right side = exact x-mirror |
| `measureSets` | `{nose, zyg, ear, skullAtEar}` → section names (likeness metrics, `measure.mjs --likeness`) |
| `uvIslands` | `[{rect: [u0,v0,u1,v1], tris, region}]` body UV islands (head, torso, arm/hand/leg/foot `_l/_r`) |
| `masks` | `{skin0|skin1|skin2: {file, size, channels, bytes}}` |
| `morphNames` | the 9 expression channels in `Pose.expr` order |
| `shells` | shared shell headers |
| `lods` | body LODs |
| `players` | per player (below) |

## Shells

A shell vertex lies on the body surface: `base = lerp(P[a], P[b], t)`, `n = normalize(lerp(N[a], N[b], t))`,
`position = base + n · offset · offsetScale`, with P/N the player's kept positions/normals. Skin weights = t-blend
of a's and b's influences, top 4, renormalised; morph deltas `lerp(Δ[a], Δ[b], t)`.

Header entry: `{name, kind: 'cloth'|'groom', material: 'kit'|'groom', offset (m), uvMode, uvRange, uvScale,
vertexCount, triCount, sections, lods?, players?, relax?, vRange?, vMetres?, perimeter?, loops?, Nu?, groom?}`.

| section | type | meaning |
|---|---|---|
| `a`, `b` | u16 | kept vertex indices |
| `t` | u8n | blend factor |
| `uv` | u16n*2 ×2 | `uv = uvRange[0..1] + stored · uvScale` (stored 0..2; `uvScale = (uvRange[2..3] − uvRange[0..1]) / 2`) |
| `offsetScale` | u8n*4 | multiplier on `offset` |
| `edge` | u8n*0.1m | geodesic distance to the shell boundary (metres, clamped 0.1) |
| `index` | u16 ×3 | triangles over the shell vertices |
| `cover` | u16 | (cloth) kept body vertices hidden under this shell; remove body triangles whose 3 vertices are covered by the worn shells |
| `lod1` | u16 ×3 | `lods: [{ratio: 0.4, triCount, section}]` — shell LOD1 (meshoptimizer, borders locked) |
| `density`, `fade` | u8n | (groom) per-vertex strand density and edge fade → the `groomDF` attribute (`fade` already includes `smooth(0, fadeMm, edge)`) |

UV modes:
- `torso-ellipse` (jersey, shorts, headbands): `θ = atan2(x/0.135, (z − 0.065)/0.095)` on base.obj,
  `u = frac(θ/2π + 0.75)` (front centre 0.75, back 0.25, right side 0.5, seam u 0 ≡ 1 under the left side);
  triangles crossing the seam use u + 1 (u ≤ ~1.05). `v = (y − vRange[0]) / (vRange[1] − vRange[0])` with base
  metres (jersey 0.103 … 0.599, tucked; shorts −0.314 … 0.168).
- `limb` (socks, sleeve, wristband, finger tape): u = angle around the nearest bone segment of a chain
  (`frac(angle/2π + 0.75)`, 0.75 = front), v = arc length along the chain normalised to 0..1, **0 at the distal end
  (ankle / wrist), 1 at the top**; `vRange` = the arc-length range (m), `vMetres` its length.
- `head-metric` (hair, beard): `u = (φs/2π)·Nu` (φs = atan2(x, z − headCZ), signed, seam at the back, seam
  triangles use u + Nu), `v = θ·R_h/0.05` with `θ = atan2(y − (EC.y + 0.02), hypot(x, z − headCZ))`; one tile = 5 cm;
  `Nu` (integer, per player, in the shell header and `frame`) = round(head circumference at ET / 0.05).
- `brow-local`: `u = (s + 1)/2 · 0.2` (s = −1..1 across the brow), `v = t · (browLength/0.05)` along it.
- `lash-local`: u = angle around the eye centre normalised over the card · 0.6, v = radial distance from the lid
  margin / card length · 0.04.

`perimeter: [[v, P] × 8]` (cloth): P = metres of surface per unit u at local v (cross-section length / u span,
base mesh) — converts trim widths in mm into atlas pixels. `loops: [{kind, side?, uv: [[u, v], …]}]` (cloth): the
shell's boundary loops with unwrapped UVs (draw again at u ± 1 when crossing the seam); kinds: jersey `neck`,
`armhole_l`, `armhole_r`, `hem`; shorts `waist`, `leg_l`, `leg_r`; socks `cuff`/`foot` (+`side`); sleeve `cuff`
(top, 2.5 cm band) / `wrist`; headbands `top`/`bottom`; wristband, tape `edge`.

`relax: {iterations, strength, pinBelowV?}`: Laplacian relaxation that may only push vertices outward from their
minimum offset; vertices with local v < `pinBelowV` are pinned (jersey: below pelvis + 0.10, i.e. inside the shorts).

`players: [ids]` on accessory shells names who wears them by default: `sleeve_r`, `tape_r_im` (kobe), `wristband_l`
(jordan), `headband_high` (lebron), `headband_low` (none), `socks_high_brace` (kobe), `socks_crew_brace` (yao) —
the `_brace` variants are the sock shells with the +3 mm ankle-brace bulge (±4 cm around the ankle).

Shared shells: `jersey`, `shorts`, `socks_low|crew|mid|high` (+0.09 / +0.13 / +0.19 / +0.27 m above the ankle,
base), `socks_high_brace`, `socks_crew_brace`, `sleeve_r`, `tape_r_im`, `wristband_l`, `headband_high`,
`headband_low`, `lashes` (groom; a = b = card vertex, t = 0, offset 0).

Groom shells: `groom = {family: [straight, coil, stipple], part: 'hair'|'beard'|'brows'|'lashes', layer:
'inner'|'outer'|'detail', fadeMm, density: section, fade: section}`. Per-player groom shells (in the player bin):
`hair_inner`, `hair_outer`, `beard_inner`, `beard_outer`, `brows` — only those the player's style has (Jordan has
no hair shell; Yao no beard shell; Kobe and Jordan have no `beard_outer`). Draw order: inner layers (hair_inner,
beard_inner, brows) first, then outer layers and lashes, so LOD3 can `setDrawRange(0, innerCount)`.

## Players

| key | content |
|---|---|
| `id`, `label`, `file`, `bytes`, `sections` | per-player binary (`position` u16q ×3, `normal` oct8 ×2, `morph.index`, `morph.delta`, `shell.*`, `cover.*`) |
| `posMin`, `posStep` | dequantisation of `position` |
| `height`, `scale`, `rawHeight` | barefoot height (m), the uniform scale after MakeHuman targets, MakeHuman's raw height |
| `bones` | `[{head, tail, roll}]` in `header.bones` order (metres, 0.1 mm); runtime bones have identity rest rotations, `bone.position = head − parent.head` |
| `landmarks` | joint-cube landmarks: `l-eye r-eye mouth jaw head head-2 neck l/r-hand-2 l/r-hand-3 l/r-scapula l/r-foot-2 pelvis` |
| `face` | the face landmarks of `header.landmarks` on this player (+ `EC_l`, `EC_r` = eye joint cubes) |
| `frame` | `{Gy, EC, headCZ, CHx, phiT, rT, Nu, Rh, circumference}` — the per-player face frame of the groom fields |
| `eyes` | `{l|r: {c, r, blinkDeg}}` eyeball centre/radius, lid rotation of the `blink` target |
| `feet` | `{l|r: {heel, toe, ball, ankle, widthBall, widthHeel, length}}` (sneaker generator inputs) |
| `dims` | `{shoulderJoints, heightBarefoot, eyeY, headTopY, headCentreAboveHeadBone}` |
| `morphs` | `{step: 0.00002, targets: [{name, channel, count, offset, maxAbs}], sections: {index, delta}, jawPivot}` — target k uses items `offset … offset + count − 1` of `morph.index` (kept indices) and `morph.delta` (i16q ×3); only the channels the player uses are baked |
| `shells` | per-player groom shell headers (sections in this player's bin) |
| `covers` | `{shoeCover_low|lowmid|midhigh|high: section}` — kept body vertices below the shoe collar (0.085 / 0.100 / 0.125 / 0.145 m) − 0.012 |
| `masks` | `{groom: {file, size, channels, bytes}, extra: {…}}` |
| `macro` | the normalised MakeHuman macro state |
| `meta` | config meta: `nameZh`, `nameEn`, `era`, `number`, `stats {heightM, barefootM, weightKg, wingspanM, reachM}`, `calibration` |

## Expression channels (`morphNames`)

`jawOpen` (all), `tongueOut` (jordan), `jawJut` (kobe), `roar` (lebron, giannis, yao), `grin` (yao, giannis), `smirk`
(kyrie, jordan), `scowl` (all), `puff` (yao, lebron), `blink` (all). Recipes in `lib/morphs.mjs` / SPEC-v2 §3.9:
MakeHuman modifier deltas (`f(v_player + v) − f(v_player)`), jaw rotation about the player's `joint-mouth` pivot
(x axis, weighted by the jaw field; lip-seam copies resolve the split), tongue translation, procedural lids.
Vertices with |Δ| < 0.05 mm are dropped.

## Masks (PNG, colour type 2 RGB, 8 bit, no gAMA/iCCP, row 0 = v 1)

| file | size | R | G | B |
|---|---|---|---|---|
| `skin0` | 1024² | lips | cavity | highlight |
| `skin1` | 512² | redness | body AO | mottle (32 levels) |
| `skin2` | 512² | palms | nails | 0 |
| `<id>.groom` | 1024² | scalp-hair density (incl. the hairline edge) | beard density incl. jaw shadow | brow density |
| `<id>.extra` | 512² | tattoo | scalp gloss (Jordan: bald gloss; others: scalp under the hair) | sweat zones |

Fields are evaluated per texel from the interpolated 3D position and normal (2 × 2 supersampling at 1024²) and
dilated into empty texels (8 px at 1024², 4 px at 512²), so UV seams carry identical values on both sides.
