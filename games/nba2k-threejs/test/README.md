# Tests — 传奇对决 3v3 / LEGENDS 3v3 (v2)

Everything here runs from `games/nba2k-threejs/` with Node 20+ and no installed dependencies except Playwright
(`require('playwright')` from `NODE_PATH`, or the global install at `/opt/node22/lib/node_modules/playwright`; the
harness tries both). Chromium runs headless with SwiftShader through ANGLE (`--use-angle=swiftshader`), which
`quality.detectStatic` classifies as `software` → rung 2 (low) unless `?quality=` forces a tier. Frame rates are never
asserted headless; counts, bytes and simulation facts read through `window.__game` are.

| file | what |
|---|---|
| `harness.cjs` | static server (game folder at `/games/nba2k-threejs/`, `.bin` as `application/octet-stream`), the 8 devices of spec §9.1, `launchBrowser`, `openGame`, `startGame`, `openLineup`, `forceTier`, `frameStats`, touch helpers |
| `acceptance.cjs` | acceptance checklist v2, items B1–B61 (spec §9.3) |
| `integ-boot.cjs` | boot → title → quick game → LIVE on several devices, screenshots + diagnostics |
| `integ-input.cjs` | real touch input on 844×390: joystick, hold-to-shoot for `tIdeal`, pump fake, defence relabel, SWITCH, step cost |
| `integ-sim.cjs` | CPU-vs-CPU soak with a per-step watchdog (NaN, free ball, shot clock, ball bounds, invariants) |
| `layout-check.cjs` | WP8 layout check of the DOM screens with a stub game (9 viewports × zh/en) |
| `unit-*.mjs` | Node unit tests per work package (spec §9.4) |
| `balance.mjs` | headless balance bands A–C and scenarios S1–S11 (WP5, spec §5.14) |

## Acceptance (`acceptance.cjs`)

```sh
node test/acceptance.cjs                 # B1 → B61, sequential (long: several minutes per runtime item on SwiftShader)
node test/acceptance.cjs B5 B30-B33      # only these items (ids and ranges)
node test/acceptance.cjs --static        # static checks only: B2, B3 and the static halves of B35, B58, B59 (≈ 1 s)
node test/acceptance.cjs --list          # items, kind, virtual clock, and the __game hooks each item needs
node test/acceptance.cjs B26 --keep-shots   # keep screenshots under test/results/shots/
```

Other options: `--timeout=<s>` (overrides every item's own timeout), `--headed`, `--bail` (stop at the first failure).
Output: one ✅/❌ line per item, `·` notes (measured values), `⚠` observations and the `✗` failure text. A JSON summary
goes to `test/results/acceptance.json` (`--static`: `acceptance-static.json`) with `{passed, failed, skipped, total,
mode, ranAt, items: [{id, label, title, kind, ok, ms, error, warnings, notes, hooks}]}`. Exit code 1 when an item
failed, 2 on usage errors. B39 always writes its showcase screenshots to `test/results/showcase/`.

How it works:

- One static server and one shared Chromium per run; every item opens fresh browser contexts (one per device / page)
  and closes them at the end, so items can run alone and in any order. Each item has its own timeout.
- Runtime items fail fast with `game not integrated` while `src/main.js` / `src/flow.js` (WP9a) are missing, and with
  `missing __game hook(s)` when a hook they need does not exist.
- `window.__acc` (in-page helper library) spies on all §1.4.1 game events through `game.on` (payload copies, since
  payload objects are pooled), counts fixed steps by wrapping `game.step` (also used to freeze the simulation for still
  frames), simulates synchronously (`acc.sim`, `acc.simUntil`), runs shot / pass trials, projects with this frame's
  camera matrices (`acc.ndc`, `acc.torsoBox`) and imports `src/` modules by URL (same instances as the game).
- Items that judge frame-by-frame behaviour (B32–B34, B37, B38, B41, B48, B49, B60, B61) install a virtual clock
  before any page script runs: in fixed mode every rendered frame advances the rAF timestamp and `performance.now()`
  by exactly one step (16.67 ms unless the item sets another cadence), so timelines, camera easing and the quality
  monitor see a steady cadence however slowly SwiftShader renders. Their timings are virtual milliseconds.
- Screenshots are taken at CSS scale (1 image pixel = 1 CSS pixel) and decoded by a built-in PNG decoder. Pixel tests
  that look at the 3D scene hide the DOM layers first.
- Expected values come from the spec tables and, where the spec gives a formula, from the pure modules imported in
  Node: `getTiming` (B10, B46), `derive` (B7), the §5.3.4 make probability with `debugContest().C` (B13), kit colours
  from `legends.js` (B26, B31, B42), i18n strings (B38, B59), `ABILITY_IDS` (B54).

### Hooks the runtime items rely on (main.js / flow.js, WP9a)

All of spec §5.15 plus a few presentation handles. Items fail with a precise message when one is missing.

| hook | items |
|---|---|
| `game` (the Game: `step`, `on`, `emit`, `score`, `meter`, `userIsOffense`), `world` (`players`, `user`, `offense`, `quarter`, `gameClock`, `shotClock`, `time`), `ball` (`state`, `owner`, `pos`, `vel`, `shotInfo`), `input.intent`, `state`, `controlled`, `paused` | almost all |
| `legendsReady`, `characters` (`dims`, `bones`, `boneIndex`, `headWorld`, `body`, `kitMesh`, `groomMesh`, `kitMode`, `lod`, `lodOverride`, `morph` / `morphIndex`, `visible`, `object`), `lib`, `simplified` | B26, B28–B31, B40, B46–B52, B56–B58, B60, B61 |
| `player(id)` (`stats`, `attrs`, `stamina`, `state`), `place(id, x, z, yaw)`, `debugShoot`, `debugContest`, `setClock`, `turnover`, `fastForward`, `holdDead`, `passPreview`, `events` | B5–B19, B46–B55 |
| `debug.invariantsBroken`, `debug.forceCelebrate`, `forceAbility`, `abilityLog` (`count(id)`), `bot`, `metrics()` | B14, B51, B54, B55, B60 |
| `lineup` (getter), `ui.screen` (`loading, loadError, title, lineup, intro, game, replay, gameover, settings`) | B4, B22, B30–B32, B36, B41 |
| `quality` (`tier`, `rung`, `auto`, `target`, `history`, `texMB()`), `perf` (`drawCalls`, `triangles`, `texMB`, `stepMs`, `animMs`), `renderer` | B23, B25, B33, B34, B41, B56 |
| `replay` (`active`), `director` (`mode`, `camera`), `arena.jumbo` (`lastText`, `mode`) | B4, B21, B32, B33, B37, B41, B60, B61 |
| `audio` (`ctx`, `master`, `muted`, SFX methods, `crowdAudio`) | B27, B43 |
| beyond §5.15: `scene` (B34 crowd count), the planar reflection as `render.reflection` / `reflection` / `arena.reflection` (B34), `game.emit` (B38), worn shell names on each Character as `shells` or `info.shells` (B58), `window.__showcase` (B28, B29, B39), `window.__anim` (B44, B45) | |

### Items

| id | kind | summary |
|---|---|---|
| B1 | runtime | clean boot on 4 devices + a full `fastForward(120)` game with intro and replays: no console errors, failed or cross-origin requests |
| B2 | static | imports relative and depth-correct, no importmap / dynamic import / top-level await / `Math.random`, CJK only in `i18n.js` + `legends.js`, denylist v2 (§9.2) |
| B3 | static | `wc -l src/**/*.js` in [16,000, 32,000], ≤ 1,600 lines per file (clips excepted), `vendor/` contents |
| B4–B27 | runtime | v1 A4–A27 updated for v2 (i18n, quick game, input, shooting model, rules, flow, layout, rotation, tiers, visibility, budgets, screenshots, audio) |
| B28–B31 | runtime | legends (heights, distinct bodies), lineup screen, kits and handlers |
| B32–B34 | runtime, clock | intro, instant replay, quality tiers and the auto ladder |
| B35 | static + runtime | payload bytes; requests during load; loading screen ≤ 1.0 s |
| B36–B43 | runtime | layout on 8 viewports × zh/en, framing, captions, showcase screenshots, load errors and simplified mode, memory stability, tone mapping and colours, artifact iframe with throwing storage |
| B44–B52 | runtime | animation: viewer, gait, launch heights, dunks, input latency, CHECK pops, block reach, celebrations, pass launch |
| B53–B55 | runtime | gestures (pump fake, combo, post-up), 22 abilities, bot game FG% |
| B56–B58 | runtime (+ static) | character draw calls / triangles / programs / LOD memory, proxy sockets, morph channels and shells |
| B59 | static + runtime | document title, legal note on title and loading screens, README notes, asset provenance |
| B60–B61 | runtime, clock | signature faces in play; meter projection and off-screen indicator labels |

## Integration scripts

```sh
node test/integ-boot.cjs [device ...]          # default desktop phonePortrait phoneLandscape; shots in test/shots/
node test/integ-input.cjs                      # phoneLandscape touch input
node test/integ-sim.cjs [seeds] [device] [q]   # e.g. node test/integ-sim.cjs 3,11 desktop 0.2
node test/harness.cjs --device phoneLandscape --query "?quick=1" --out test/shots   # one load screenshot + fps sample
```

## Manual device matrix (spec §9.5, phase D)

Each device records `__game.perf.load` (`fetchMs, decodeMs, skinMs, kitMs, uploadMs, compileMs`) against the §7.6
phase budgets, the §7.5 JS budget and the median fps over a 60 s LIVE sample (`__game.perf`), plus one full game in
both orientations. Results are entered in this table during phase D:

| device | tier | load phases vs §7.6 | JS ms / frame | median fps (60 s LIVE) | full game portrait / landscape |
|---|---|---|---|---|---|
| iPhone 11, iOS Safari | medium | | | | |
| iPhone 11, iOS Safari | high | | | | |
| iPhone 13 | high | | | | |
| 2021 low-end Android (PowerVR GE8320 or Mali-G52) | low | | | | |
| desktop, integrated graphics | medium | | | | |
