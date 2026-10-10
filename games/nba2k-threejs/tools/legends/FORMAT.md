# Legends mesh format (version 1)

Written by `bake.mjs`, read by `loader-prototype.js`. One bake produces:

| file | content |
|---|---|
| `<name>.json` | header (this document) |
| `<name>.shared.bin` | topology, UVs, skin weights, LOD index buffers, clothing/hair shells: identical for every player |
| `<name>.<playerId>.bin` | per player: quantised positions + octahedral normals (108 192 bytes for the hm08 body) |

All binary data is little-endian. Every section starts on a 4-byte boundary. A section descriptor is
`{ offset, count, type, itemSize, bytes }`: `count` items of `itemSize` components each, so the typed array
length is `count * itemSize`.

| type | storage | meaning |
|---|---|---|
| `u8` | Uint8 | integers |
| `u8n` | Uint8 | value / 255 |
| `u8n*4` | Uint8 | value / 255 * 4 (shell offset multiplier, 0..4) |
| `u8n*0.1m` | Uint8 | value / 255 * 0.1 metres (shell boundary distance) |
| `u16` | Uint16 | integers (indices) |
| `u16n` | Uint16 | value / 65535 |
| `u16n*2` | Uint16 | value / 65535 * 2 (shell UVs, 0..2 so a wrapped seam can use u > 1) |
| `u16q` | Uint16 | `posMin[axis] + value * posStep[axis]` (metres) |
| `oct8` | Int8 x2 | octahedral unit normal, components / 127 |

## Coordinates and vertex spaces

- Metres, +y up, the character faces +z, soles on y = 0, pelvis over x = z = 0. `_l` bones / `l-` landmarks
  are on +x (the character's left).
- **kept vertices** (`counts.keptVertices`, 13 524): the hm08 base.obj vertices that are kept (body 0..13379
  plus the two eyeballs), in base.obj order. Per-player positions/normals and skin weights live here.
- **render vertices** (`counts.renderVertices`, 14 677): kept vertices split at UV seams. `renderToKept` maps
  each render vertex to its kept vertex; UVs and the index buffers address render vertices.

## Header

```jsonc
{
  "format": "legends-mesh", "version": 1,
  "counts": { "renderVertices", "keptVertices", "bodyKeptVertices", "triangles", "bones" },
  "shared": {
    "file": "poc.shared.bin", "bytes": 627668,
    "sections": {
      "renderToKept": u16 x1 [render],      // kept index per render vertex
      "uv":           u16n x2 [render],     // body: MakeHuman atlas UV (OBJ convention, v up)
                                            // eyes: front disc projection, (0.5,0.5) = pupil, r 0.5 = silhouette
      "index":        u16 x3 [triangles],   // LOD 0, render-vertex indices, groups below
      "skinIndex":    u8 x4 [kept],         // bone index into header.bones
      "skinWeight":   u8n x4 [kept],        // each vertex sums to exactly 255
      "keptToObj":    u16 x1 [kept],        // original base.obj vertex index (for future runtime morphs)
      "lod<N>.index": u16 x3,               // LOD N index buffer over the SAME render vertices
      "shell.<name>.<a|b|t|uv|offsetScale|edge|index|cover>"  // see Shells
    },
    "groups": [ { "name": "body", "material": "skin", "start", "count" },   // start/count in indices
                { "name": "eyes", "material": "eye",  "start", "count" } ]
  },
  "bones": [ { "name": "Root", "parent": -1 }, { "name": "pelvis", "parent": 0 }, ... ],   // parents first
  "lods": [ { "ratio", "lockHead", "triangles", "bodyTriangles", "error", "section", "groups" } ],
  "shells": [ { "name", "kind": "cloth|hair", "material", "offset", "relax", "uvMode", "vertexCount",
                "triCount", "sections": { "a", "b", "t", "uv", "offset", "edge", "index", "cover"? } } ],
  "players": [ {
    "id", "label", "file", "bytes",
    "sections": { "position": u16q x3 [kept], "normal": oct8 x2 [kept] },
    "posMin": [x, y, z], "posStep": [x, y, z],   // dequantise: posMin + q * posStep
    "height": 2.29,          // max y of the baked body (barefoot), metres
    "scale": 1.0,            // uniform scale applied after MakeHuman targets to hit "height"
    "rawHeight": 2.29,       // MakeHuman height before that scale
    "bones": [ { "head": [x,y,z], "tail": [x,y,z], "roll": r } ],   // same order as header.bones, metres
    "landmarks": { "l-eye", "r-eye", "mouth", "jaw", "head", "head-2", "neck", "l-hand-2", "r-hand-2",
                   "l-hand-3", "r-hand-3", "l-scapula", "r-scapula", "l-foot-2", "r-foot-2", "pelvis" },
    "macro": { "gender", "age", "muscle", "weight", "height", "proportions", "race": {...} },  // normalised
    "macroTargets": [ [ "asian-male-young", 0.829 ], ... ],         // what was applied (debug)
    "targets": { ...detail modifiers from the config },
    "appearance": { ...passed through from the config (skin, iris, hair, beard, accessories) },
    "meta": { ...passed through (names, era, number, stats, calibration) },
    "expressions": { "<name>": { "<group>/<modifier>": value } }   // runtime blend descriptors, names validated
  } ]
}
```

## Skeleton (game_engine rig, 53 bones)

`Root` (at the origin) > `pelvis` > `spine_01` > `spine_02` > `spine_03` > `neck_01` > `head`;
`spine_03` > `clavicle_l|r` > `upperarm_l|r` > `lowerarm_l|r` > `hand_l|r` > `{thumb,index,middle,ring,pinky}_0{1,2,3}_l|r`;
`pelvis` > `thigh_l|r` > `calf_l|r` > `foot_l|r` > `ball_l|r`.

Joint positions are evaluated per player on the morphed mesh with the rig's strategies (CUBE = mean of the
8 vertices of the named `joint-*` cube, MEAN = mean of `vertex_indices`, VERTEX = one vertex), so bones follow
every macro/detail target. Bone `head` is the joint; `tail` is the child joint (for the bone direction);
`roll` is Blender's roll (radians), only needed to rebuild Blender-style bone frames.

Runtime bones use **identity rest rotations**: `bone.position = head - parent.head`. A bone's local axes are
therefore the character's axes in the rest (A-)pose: rotating `upperarm_l` by +z raises the left arm,
`calf_r.rotation.x = +pi/2` bends the right knee 90 degrees, `spine_0N.rotation.y` twists. Use
`tail - head` for twists about the bone's own axis. Skin weights: at most 4 influences per vertex,
normalised (608 of 13 524 vertices had more than 4 in the source and were truncated + renormalised).

## Positions and normals

Per player, per kept vertex: `position = posMin + q * posStep` (step about 0.02 to 0.035 mm), normals are
area-weighted smooth normals computed by the bake on the kept (welded) mesh, so UV seams do not show.
The loader expands kept -> render vertices with `renderToKept`.

## Shells (clothing / hair)

A shell vertex lies on the body surface: `base = lerp(P[a], P[b], t)`, `n = normalize(lerp(N[a], N[b], t))`,
`position = base + n * shell.offset * offsetScale` where P/N are the player's kept positions/normals.
`a == b, t == 0` for body vertices; otherwise the vertex is where a cut line (neckline, armhole, hem,
hairline) crosses the body edge a-b (marching-triangle clip of a signed region function evaluated once on
base.obj). Skin weights = t-blend of a's and b's influences, top 4, renormalised (computed by the loader).

| section | type | meaning |
|---|---|---|
| `a`, `b` | u16 | kept vertex indices |
| `t` | u8n | blend factor |
| `uv` | u16n*2 | `cylinder-torso`: u = 0.5 front centre, 0/1 back centre, v = 0 at ankle - 0.1 m .. 1 at the head top of base.obj; `sphere-head`: u = azimuth around the head (0.5 = face), v = elevation. Triangles crossing the back seam use u > 1 (textures need RepeatWrapping) |
| `offsetScale` | u8n*4 | multiplier on `shell.offset` (loose fit toward hems) |
| `edge` | u8n*0.1m | geodesic distance to the shell boundary, metres (hairline fades, trims) |
| `index` | u16 x3 | triangles over the shell's vertices |
| `cover` | u16 | kept vertices hidden under this shell (>= coverInset from its boundary). The loader removes body triangles whose 3 vertices are all covered by the worn shells (no poke-through, fewer triangles) |

`relax: {iterations, strength}` (jersey, shorts): the loader runs a Laplacian smoothing that may only push
vertices outward from their minimum offset, so fabric bridges concavities instead of shrink-wrapping.

## Size (2 test players)

shared 627 668 B (402 KB gzip) + 108 192 B per player (does not compress). Six players: about 1.28 MB raw.
