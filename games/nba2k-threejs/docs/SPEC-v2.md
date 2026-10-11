# 传奇对决 3v3 / LEGENDS 3v3 — v2 IMPLEMENTATION SPEC (authoritative)

This is the single authoritative spec for v2 of the game at `games/nba2k-threejs/` (paths below are relative to that
folder unless they start with `/tmp` or `scratchpad/`; scratchpad paths name one-off measurement scripts that are not shipped). Implementers read **this file instead of the four
section files**. Where a passage says "**[ref S:§x.y]**" the named heading of a section file is incorporated *verbatim*
into this spec (those passages are long keyframe / formula tables that would only be copied here); everything in this
file overrides anything in a referenced passage, and the conflict register (§0.4) lists every override.

Section files (part of the spec only where referenced):

| key | path (relative to `games/nba2k-threejs/`) |
|---|---|
| **CHR** | `docs/v2-sections/characters.md` |
| **ANIM** | `docs/v2-sections/animation.md` |
| **GP** | `docs/v2-sections/gameplay.md` |
| **PR** | `docs/v2-sections/presentation.md` |
| v1 | `docs/SPEC-v1.md` (v1 spec; still binding where v2 is silent, e.g. coordinate constants, ball physics integrator, Intent object, keyboard map) |
| inputs | `docs/v2-sections/phaseA-profiles.json` (poc, profiles, xcheck), `docs/v2-sections/review-r1-findings.json` (44 findings), `tools/legends/*` (bake pipeline), `test/scratch/legends-poc/` (PoC renders) |

Citation keys used inline: [CHR §n], [ANIM §n], [GP §n], [PR §n], [V1 §n], [PROF:id] (phaseA profiles), [XCHK]
(phaseA xcheck), [POC] (phaseA poc), [CFG] (`tools/legends/legends.config.json`), [DEC] (orchestrator decisions).

**Review finding numbering.** `R#n` in this file is the **1-based** index into `docs/v2-sections/review-r1-findings.json` (R#1 = portrait
camera … R#44 = verdict), the numbering GP and PR use. CHR and ANIM cite the same list **0-based**: their `[R1#4]`,
`[REV#13]`, `[REV#32]`, `[REV#36]`, `[REV#42]` are R#5, R#14, R#33, R#37, R#43 here.

---

## 0. Summary, hard constraints, what changed, conflict register

### 0.1 What v2 is

- The six legends with their real names (zh + en): **Kobe Bryant 科比·布莱恩特, Michael Jordan 迈克尔·乔丹, LeBron James
  勒布朗·詹姆斯, Giannis Antetokounmpo 扬尼斯·阿德托昆博, Yao Ming 姚明, Kyrie Irving 凯里·欧文**, rendered as baked, skinned
  MakeHuman (CC0) bodies with per-player face/body morphs calibrated to their listed measurements, painted skin, real
  eyes and mouths, per-player hair/beard/brow shells, painted kits with vector numbers, procedural sneakers and
  accessories, and 9 facial expression morphs.
- A layered skeletal animation system on the 53-bone game-engine rig: procedural locomotion with foot IK, procedural
  dribbling, a clip library with every profile signature move, per-player shooting forms tied to the shot meter,
  celebrations, idle habits and showcase loops.
- Gameplay v2: ratings-driven physics and probabilities, per-player shot timing, geometric contest, probabilistic
  blocks, steals/interceptions, strength, post play, 22 signature abilities triggered with the same 4 buttons +
  joystick, a new AI with legend tendencies, difficulty that actually scales, a lineup/draft screen, rule fixes, a
  headless balance harness.
- Presentation v2: Neutral tone mapping, arena lighting + shadow maps (medium/high), PBR floor, hoop with simulated
  net, LED boards, jumbotron, GPU crowd, new broadcast framing, intro, instant replay, title/lineup/game-over screens,
  quality tiers with auto-detection, synthesized arena audio.
- Title: **传奇对决 3v3 / LEGENDS 3v3**. zh-CN default, English toggle.

### 0.2 Hard constraints (binding; v1 §0 carried over unless marked CHANGED)

| # | constraint |
|---|---|
| H1 | Static site under `games/nba2k-threejs/`: `index.html`, `css/style.css`, `src/**/*.js`, `vendor/three.module.js` (+ `vendor/LICENSE.three.txt`), `assets/legends/*`, `README.md`. No build step, no bundler, no npm for players, no import map, no bare specifiers, no top-level `await`, no `<base>`, no `document.currentScript`, no service worker, no dynamic `import()`. |
| H2 | three.js r186 vendored single-file ESM; **core only** (no addons; anything we need is our own code). Every module imports it with the depth-correct relative path: `src/x.js` → `'../vendor/three.module.js'`, `src/a/x.js` → `'../../vendor/three.module.js'`, `src/anim/clips/x.js` → `'../../../vendor/three.module.js'`. r186 facts: `PCFSoftShadowMap` removed (use `PCFShadowMap`), `NeutralToneMapping` exists, `renderer.outputColorSpace = SRGBColorSpace`. |
| H3 | **CHANGED** No external assets *from other origins*. Runtime fetches only its own files via `new URL(rel, import.meta.url)`: the baked character assets in `assets/legends/` (made by our offline tools from CC0 MakeHuman data) are committed and shipped. Everything else (textures, audio, fonts) stays procedural; no web fonts. |
| H4 | **CHANGED** Performance: 60 fps target, 30 fps floor on iPhone 11 / 2021 low-end Android, enforced by three quality tiers (§7) with per-tier draw-call / triangle / texture-memory / JS budgets. Shadow maps allowed on medium/high only; Neutral tone mapping on all tiers; no post-processing passes. |
| H5 | Mobile: `touch-action:none`, no double-tap zoom, no pull-to-refresh (except inside `.panel`/`.scroll`, which scroll vertically), safe-area insets, portrait + landscape, resize/orientationchange, iOS audio unlock on first gesture, `100dvh`, every tappable ≥ 44 × 44 px, in-game buttons ≥ 56 px. |
| H6 | UI zh-CN default, English toggle; every UI string in `src/i18n.js`. **CHANGED** CJK literals allowed only in `src/i18n.js` and `src/legends.js` (player names). |
| H7 | **CHANGED** Real player names and likenesses of the six legends are required [DEC]. Still forbidden anywhere (code, strings, textures, shoes, ball): NBA / team names / team logos / "2K" / brand names / brand logos / trademark nicknames (denylist §9.2). README carries: 非商业粉丝作品；球员姓名与肖像归其本人所有。/ Non-commercial fan project; names and likenesses belong to the players. |
| H8 | All gameplay randomness through the seeded `Rng` (`src/math.js`); cosmetic randomness through a separate `Rng(seed ^ 0xA11CE5)` advanced only in fixed steps (animation) or `Rng(seed ^ 0xC20D)` (crowd). `Math.random` must not appear in `src/`. |
| H9 | **CHANGED** `wc -l src/**/*.js` total in **[16,000, 48,000]** (raised from 32,000 at integration [DEC]); no single file > 1,600 lines except `src/anim/clips/*.js` and `src/anim/clip.js`. |
| H10 | Zero allocations per frame / per fixed step in step, animation, render, HUD, camera, replay, crowd, net, AI (module scratch objects; v1 rule). |
| H11 | Works identically on static hosting and inside the Claude artifact iframe (supporting files next to the page; `localStorage` may throw → every access in try/catch with in-memory fallback). `.bin` files published with explicit `application/octet-stream`. |
| H12 | WebGL2 required for the legends; WebGL1 or any asset failure → **simplified mode** (v1 primitive humanoids, `src/humanoid.js` kept as fallback), never a dead page. |

Units in every budget of this spec: KB = 1,024 B, MB = 1,048,576 B (binary), ms of wall-clock time on the named
reference device. "Base metres" = coordinates on the unmorphed hm08 `base.obj` (≈ 1.68 m tall); "player metres" =
the player's baked mesh (head features ≈ base × 1.10).

### 0.3 What changed from v1 (overview; details in the chapters)

- Players: primitive humanoids → baked legends (`src/legends/*`, `assets/legends/*`); `src/teams.js` deleted →
  `src/legends.js`; `src/humanoid.js` kept only as the simplified-mode fallback.
- Animation: v1 pose functions → `src/anim/*` (layered animator, clips, IK, gait).
- Gameplay: fixed ratings/timings → per-player derived attributes (`src/ratings.js`), per-player meter, new make /
  contest / block / steal / pass / strength models, abilities (`src/abilities.js`), context resolver
  (`src/context.js`), lineup logic (`src/lineup.js`), metrics (`src/metrics.js`), new AI (`src/ai.js`,
  `src/ai-tend.js`), test bot (`src/testbot.js`).
- Rules: points by the feet at the release input; shot clock resets only after rim/board/block; buzzer/clock edge fixes;
  STL credit at the catch; no CPU poke 0.8 s after check; optional FIBA clear-the-ball (off); auto-switch (on).
- Rendering: `scene.js`, `court.js`, `camera.js`, `hud.js` replaced by `src/render/*`, `src/cam/*`, `src/ui/*`.
- Flow: loading screen → title (state `MENU`) → lineup (`LINEUP`) → intro (`INTRO`) → game → game over with box score
  and MVP; instant replays inside DEAD.
- Tests: A1–A27 updated, new B-items (§9), new unit files, headless `test/balance.mjs`.

### 0.4 Conflict register (every disagreement between sections, resolved; binding)

| # | topic | sections say | **decision** | why |
|---|---|---|---|---|
| C1 | 2 or 3 points | ANIM §5.1-7: root at `takeoff`; GP D-GP-5: feet at release | **Feet (player root x,z) at the fixed step that processes the release input** (`releaseTs`) for jump shots; layups/dunks/tips = 2. ANIM §5.1-7 is void. Meter shows a live 3/2 chip. | user instruction to GP; R#14 |
| C2 | block contact | ANIM §6.5: palm within 0.14 + 0.12 = 0.26 m; GP §4.1: hand socket within 0.30 m | **`palm_s` socket of the nearer hand within `rHand` = 0.30 m of the ball centre** (LeBron chase-down 0.36; Yao `anchor`, Giannis `helpBlock` 0.34) + all GP §4.1 eligibility + GP roll. A-ANIM-7 → B50 uses these radii. | GP owns rules; rig-reach deficit cancels (both shooter and blocker use rig sockets) |
| C3 | body radius / separation | CHR §1.6 `collisionRadius = 0.5·(shoulderJoints+0.10)`, pair `rA+rB+0.06`; GP §2 `bodyR = 0.18 + 0.5·shoulderJoints`, pair `bodyR_a+bodyR_b` | **GP**: `bodyR` (0.393–0.433 m), pair min = sum (0.79–0.87 m), +0.10 if either airborne, ≥ 0.95 vs a hanging dunker. `dims.collisionRadius` is removed from CHR's API. | GP owns physics; keeps v1 spacing feel (0.80) |
| C4 | ankle-break fall | ANIM §6.9 `def.ankleFall` 1.10 s, probabilities "0.10 of freezes"; GP §7.2 `fallen` 1.60 s with its own `pAnkle` | **GP**: `fallen` 1.60 s (fall 0.50 / ground 0.80 / get-up 0.30), GP `pAnkle` formula. `def.ankleFall` keys retimed: 0.00→0.00, 0.20→0.20, 0.45→0.50, 0.70→1.30, 1.10→1.60. ANIM's suggested probabilities are void. | GP owns outcomes |
| C5 | failed steal stun | ANIM `def.stealMiss` 0.35 s; GP 0.30 s (0.55 s on a 2nd fail within 3 s) | **GP** 0.30 / 0.55 s; `def.stealMiss` is played time-scaled to the stun (rate = 0.35/stun). | GP owns |
| C6 | pass release times | ANIM §7.1: chest 0.10, lob 0.16, overhead 0.18, skip 0.16; GP §2/§8.3: `passRelease = clamp(0.25 − 0.12·n(passing), 0.10, 0.27)`, skip ≥ 8 m 0.10 s | **chest = `passRelease`** (0.133–0.184 s, warped release key); **bounce = passRelease + 0.02; lob = passRelease + 0.06; overhead = passRelease + 0.08; push1 = 0.08 if the ball is in the hand else next contact (≤ 0.20); `sig.yao.overheadPass` 0.25 (0.20 chinned); LeBron passes ≥ 8 m (`sig.lebron.skipPass`) 0.10 s at 15 m/s**; from the dribble add the pickup (≤ 0.12 s); `pass.turn` adds ≤ 0.12 s. | GP owns values; stays inside ANIM's 0.08–0.27 range |
| C7 | broadcast camera numbers | GP §14 #1/#2 propose `{74,…}` / `{44,…}`; PR D-PR-6 measured `{42,…}` / `{72,…}+lens 0.25` | **PR §4.2 FRAMING** (§6.4 here). GP's portrait numbers survive as the "high" camera option. B-items expect fov 42 / 72. | PR measured with the real bodies |
| C8 | defensive jump heights | ANIM §6: `h_block = 0.80·vertical/100` etc.; GP §2: `hJump` | **GP `hJump`** (0.44–0.82 m) for every generic block/contest/rebound/tip jump; signature defensive clips keep their nominal h: `sig.lebron.chasedown` 0.85, `sig.giannis.helpBlock` 0.785. Shot jumps use ANIM `FORMS` (§4.9). | GP owns ratings→physics |
| C9 | finishing distance | v1/GP `dFinish` 2.2 m (Jordan 2.8, Giannis 3.4); ANIM layup press windows `lay.std1` 1.0–2.5, `lay.std2` 2.5–4.0, dunk gathers 2.0–4.0 | **Finish row triggers by press windows of the selected clip** (`params.gatherWindow`, exported by `clipTiming`): layups `std1` d ≤ 2.5, `std2` 2.5 < d ≤ 4.0 (speed ≥ 2.0 m/s, velocity within 45° of the rim), Jordan (`jordan.air`) std2 up to 4.6; generic dunks d ∈ [0.6, 4.0] with `dunkAllowed`. v1 `SHOT.LAYUP_D 2.2` retired. | gathers need distance; makes drives read correctly |
| C10 | FT-line dunk | ANIM §9.2 J2: takeoff 4.2–4.6 m, h 1.00, air 1.08 s, once per game, margin/crowd/0.25 roll; GP §8.1: press at d ∈ [4.2, 4.7], h 0.95, g × 0.72, max 2 per game | **Press window d ∈ [6.0, 7.6] m** (the clip's gather; takeoff target-matched to 4.2–4.6 m, \|x\| ≤ 1.2), speed ≥ 6.0 m/s within 25° of the rim, GP lane/cone conditions, stamina ≥ 0.30; **h 1.00, gravity × 0.70, airtime 1.08 s, slam descending at takeoff + 0.704**; max **2 per game**; AI picks it with p 0.25 per eligible approach. ANIM's margin/crowd conditions are void. Unit boundary: d 5.99 → no, 6.00 → yes. | the clip needs ≈ 3 m of gather |
| C11 | Giannis euro / long gather windows | GP: euro press d ∈ [2.6, 3.6], longDunk "up to 3.4 m"; ANIM G1 starts 7.2 m out, takeoff 2.6–3.2; G2 gather 5.0–5.4 | **`sig.giannis.euroDunk/euroLay` press d ∈ [5.4, 7.6] m** (takeoff matched to 2.6–3.2 m); **generic `lay.euro` (everyone, steps × 0.75) press d ∈ [3.0, 5.2] m** (takeoff 1.2–2.0 m); **`sig.giannis.longGather` press d ∈ [6.4, 7.8] m at speed ≥ 5.0 m/s**, gather warped to 5.0–5.4 m, takeoff 2.6–3.2 m. GP's ability effects unchanged. | press = clip start |
| C12 | Jordan `air` gravity | GP §8.1: gravity × 0.80 on his layups/dunks; ANIM signature clips already raised h | Gravity × 0.80 applies to **generic** `lay.*` and `dunk.*` clips only; signature clips use their own h (`theMove` 0.95 normal g, `cradle` 1.00 normal g, `ftDunk` per C10). Jordan's layup timing recomputed: std2 tIdeal 0.692 / METER_T 0.865; std1 0.462 / 0.578. | consistency of meter and air |
| C13 | gameplay clip names | GP: `hit.bump`, `hit.ankle`, `hit.shake`, `def.handsUp`, `def.chaseBlock`, `def.wall`, `pass.skip1h`, `dunk.ftLine`, `dunk.longGather`, `lay.switch`, `sig.giannis.euro` | **ANIM ids are canonical**; aliases: `hit.bump`=`def.bumped`, `hit.ankle`=`def.ankleFall`, `hit.shake`=`def.stumble`, `def.handsUp`=`def.handUp`, `def.chaseBlock`=`sig.lebron.chasedown` (LeBron) / `def.block1` with entry `carry` (others), `def.wall`=`sig.yao.vertical`, `pass.skip1h`=`sig.lebron.skipPass`, `dunk.ftLine`=`sig.jordan.ftDunk`, `dunk.longGather`=`sig.giannis.longGather`, `lay.switch`=`sig.jordan.theMove`, `sig.giannis.euro`=`sig.giannis.euroDunk`/`euroLay`. New clip `post.faceUp` (0.35 s) is added by WP3. Ability ids stay GP's. | one namespace |
| C14 | shot variant choice for CPU | ANIM §10.3 rule 7 fade probabilities (Kobe 0.55 …); GP `tend.fade` | **GP context resolver + `tend`** choose kind/variant (§5.9); `select.js` only maps (player, kind, variant, ctx) → clip (§4.13). ANIM rule 7 is void. | GP owns decisions |
| C15 | state names | GP: `MENU` + `LINEUP`; PR: `TITLE`, `LINEUP`, `INTRO` | `game.state` ∈ `MENU` (= the title screen PR calls TITLE), `LINEUP`, `INTRO`, `CHECK`, `LIVE`, `DEAD`, `QUARTER_END`, `HALFTIME`, `GAME_OVER` (+ `paused` flag); `__game.ui.screen` ∈ `loading, loadError, title, lineup, intro, game, replay, gameover, settings`. | v1 tests keep `MENU` |
| C16 | team abbreviations | GP: 暗 / 亮 / 白 / 黑; PR: ≤ 2 CJK 暗夜 / 烈阳 / 白队 / 黑队 | **zh 暗夜 / 烈阳 / 白队 / 黑队, en DRK / BRT / WHT / BLK.** PR's user-editable team names are dropped (§11). | legibility |
| C17 | kits option | GP: lineup 球衣 [自动][经典]; PR settings 自动/经典/全明星 | **Three values everywhere: `auto` / `classic` / `allstar`**, one stored value (`lineup.kits`), shown in the lineup screen and in settings. `auto` = classic for the default lineup, All-Star otherwise [DEC]; `classic` forces classic; `allstar` forces All-Star. | superset of [DEC] |
| C18 | lineup cards | GP: three stat chips on every card; PR: chips only in the detail card in portrait / short landscape | **PR layout**: landscape (height > 360 px) cards show OVR + top-3 stat chips; portrait and landscape ≤ 360 px show OVR only, chips in the detail card. | fits 360×640 |
| C19 | culling sphere | CHR §1.7 r = 0.85·h + 0.10 at the pelvis; ANIM §12.2 r = 0.6·h | **CHR test** (one per character per frame; centre/radius amended by C31); ANIM's off-screen throttle reads `c.visible`. | one test |
| C20 | LOD2 triangle count | CHR §9.1 6,688; POC/PR 6,968 | **6,968** (POC measured). | source data |
| C21 | turn rates | ANIM §3.6 STYLE suggestions (Kobe 12, Yao 8, Kyrie 14); GP `turn = 9 + 5·n(speed)` | **GP formula** (Yao 9.9, Kyrie 13.5 rad/s); ANIM's row is informational. | GP owns |
| C22 | auto hands-up | GP: "raises both hands"; ANIM `def.handUp` one contest arm | `def.handUp` (upper layer): contest arm `[165,12,0,10,−30,0,0]` `spread`, other arm `[120,30,0,30,0,0,0]`; raised in 0.10 s; `Kh` uses `reach − 0.05`. | both |
| C23 | likeness page | CHR §10.4 `test/likeness/likeness.html`; PR §9.4 A38 `index.html?showcase=1` | **One page: `index.html?showcase=1`** (`src/showcase.js`) implements CHR's shot list; `test/likeness/shoot.cjs` drives it; no separate HTML. | one code path, works in the artifact |
| C24 | `src/legends/data.js` (CHR) vs `src/legends.js` (GP) | both hold ids/teams/kit logic | **`src/legends.js`** holds all per-legend runtime data (§2); kit-mode resolution lives in `src/lineup.js`; `src/legends/data.js` is not created. | one data file |
| C25 | steal swipe timing | ANIM: swipe 0.12 (Kyrie 0.10, Yao/LeBron 0.14); GP "0.12 s" | Per-player `swipe` event times of ANIM; GP resolves at whatever time the event fires. | — |
| C26 | defender closeout / contest clip during windup | ANIM entry `stop`; GP steering rule | both: GP steering (never away from the shooter, takeoff horizontal velocity clamped toward the shooter 0–2.0 m/s) + ANIM clips with entry `stop`. | — |
| C27 | assists | PR: box score column only if booked; GP metrics use assists | **Assists are booked**: the last passer gets AST when the receiver makes a field goal whose press happens ≤ 3.0 s after his catch with no possession change in between (tips excluded). | needed for MVP and LeBron band |
| C28 | settings rows for GP options | GP has `rules.clear`, `rules.autoSwitch`; PR settings list lacks them | Add rows 清球规则 (关/开, default 关) and 防守自动换人 (开/关, default 开) to settings (title only; pause shows them read-only). | — |
| C29 | expression attack/release vs baked targets | consistent (9 channels, same order) | no change; low tier has no morphs → channels no-op. | — |
| C30 | `MOVE.SEPARATION`, `JUMP.T`, `SHOT.METER_T*`, `crossFreeze`, `shootOpen`, `stealRate` (v1 constants) | — | removed from `constants.js`; replaced by the v2 tables. | — |
| C31 | cull sphere centre (CRITIC) | CHR §1.7 / C19: pelvis bone `matrixWorld`, r 0.85·h + 0.10 | **root position + (0, 0.55·h + jumpY, 0), r 0.85·h + 0.30** (§3.4) | a culled character's bones are evaluated at 15 Hz only, so the pelvis matrix is stale |
| C32 | body geometry per LOD (CRITIC) | CHR §1.5: LOD/covered variants are separate geometries that copy `morphAttributes` | **one geometry per character; `setIndex` swaps** (§3.4) | three.js morph textures are per geometry |
| C33 | jersey hem (CRITIC) | CHR §7 / PoC shells: hem at pelvis − 0.15 over the shorts (untucked), jersey v from base y −0.087 | **tucked: hem pelvis + 0.03, enclosed by the shorts, v from 0.103; kit `DoubleSide`** (§3.8) | profiles: tucked; PoC slit |
| C34 | request budget (CRITIC) | PR §7.1: ≤ 100 requests | **≤ 110** (103 counted) (§6.6, B35) | 77 statically imported modules |
| C35 | event wiring (CRITIC) | v1 `game.js` calls `hud.*` / `audio.*` directly; sections silent for v2 | **`game.js` emits only; `flow.js` routes** (§1.4.1) | WP4 ↔ WP6/7/8 boundary, headless game |

---
## 1. Architecture

### 1.1 Final tree (N = new, C = changed, K = kept as is, F = kept as fallback only)

```
games/nba2k-threejs/
  index.html (C)  css/style.css (C)  README.md (C)  package.json (C: name "legends-3v3", scripts §8.4)
  vendor/three.module.js (K)  vendor/LICENSE.three.txt (K)
  assets/legends/ (N, generated by tools/legends, committed)
     legends.json  legends.shared.bin  legends.<id>.bin ×6  legends.skin0.png legends.skin1.png legends.skin2.png
     legends.<id>.groom.png ×6  legends.<id>.extra.png ×6  README.md
  src/
     main.js (C)  flow.js (N)  constants.js (C)  math.js (K)  i18n.js (C)  input.js (C)  physics.js (C)  ball.js (C)
     player.js (C)  game.js (C)  shot.js (C)  ai.js (C)  ai-tend.js (N)  legends.js (N)  ratings.js (N)
     abilities.js (N)  context.js (N)  lineup.js (N)  metrics.js (N)  testbot.js (N)  audio.js (C)  showcase.js (N)
     humanoid.js (F)
     audio/crowd.js (N)
     legends/ format.js library.js character.js shells.js skinPainter.js kitPainter.js sneaker.js groom.js materials.js (N)
     anim/ rig.js clip.js pose.js presets.js locomotion.js dribble.js ik.js look.js animator.js select.js proxy.js viewer.js (N)
     anim/clips/ common.js shots.js kobe.js jordan.js lebron.js giannis.js yao.js kyrie.js (N)
     render/ renderer.js quality.js lighting.js shadows.js envmap.js floor.js reflection.js hoop.js arena.js crowd.js ballvis.js fx.js (N)
     cam/ director.js broadcast.js shots.js replay.js (N)
     ui/ loading.js screens.js lineup.js hud.js captions.js indicators.js present.js settings.js (N)
  test/ (C: §9)  tools/legends/ (C: §8)
```

Removed: `src/teams.js`, `src/scene.js`, `src/court.js`, `src/camera.js`, `src/hud.js` (replaced by `src/render/*`,
`src/cam/broadcast.js`, `src/ui/hud.js`). `test/unit-humanoid.mjs` is rewritten for the fallback (colours by
argument; owner WP9); `test/unit-court.mjs` is deleted (its marking-coordinate cases move into
`test/unit-floorpaint.mjs`, owner WP6). v1 `test/unit-audio.mjs` → WP8, `test/unit-ai.mjs` → WP5,
`test/unit-{core,physics,ball}.mjs` → WP4, `test/integ-{boot,input,sim}.cjs` → WP9 (updated for v2 boot). `src/humanoid.js` stays only for simplified mode; its `TEAMS` import is replaced by a
`colors` argument (`createHumanoid({jersey, trim, skin}, …)` fed from §2.7 kits and §2.6 skin hexes).

### 1.2 File table (owner work package, ≈ lines, exports, responsibility)

| file | WP | ≈ lines | exports / responsibility |
|---|---|---|---|
| `src/legends.js` | 4 | 420 | `LEGEND_IDS`, `LEGENDS` (frozen, §2), `TEAMS_V2`, `DEFAULT_LINEUP`, `TEAM_UI` colours, `legend(id)` |
| `src/ratings.js` | 4 | 140 | `n(r)`, `derive(legend) → attrs` (§5.1) |
| `src/constants.js` | 4 | 260 | v1 court/ball/clock constants + `DIFFICULTY` v2 (§5.11), `SEPARATION` rules, `RIM_PHYS` (REST_RIM 0.40, tangential 0.80, REST_BOARD 0.50), `SLOTS_V2`, `isThree(x,z)`; v1 `MOVE.SEPARATION`, `JUMP.T`, `SHOT.METER_T*`, `SHOT.LAYUP_D` removed (C30) |
| `src/shot.js` | 4 | 520 | `resolveShotZone`, `pg(kind,d,ratings)`, `typeMul`, `timingFactor(eT,gS)`, `greenHalfWidth`, `contestFactor(shooter, world, kind) → {C,X,Xraw,defender,parts,A}`, `makeProbability(...)`, `chooseTarget(...)`, `airBallTarget` (§5.3) |
| `src/abilities.js` | 4 | 420 | `ABILITIES` (22 frozen descriptors), `mul(player, hook, ctx)`, `trigger(player, hook, ctx)`, log helper (§5.8) |
| `src/context.js` | 4 | 380 | `resolveOffense(player, intent, world) → {action, kind, variant, side, clipHint}`, `resolveDefense(...)`, post-up detector, combo queue, pump-fake detector (§5.9) |
| `src/lineup.js` | 4 | 220 | `isDefaultLineup`, `swap(lineup, i, j)`, `shuffle(lineup, rng)`, `resetLineup()`, `resolveKitModes(lineup) → {a, b}` (`classic`/`allstarA`/`allstarB`), `teamNames(lineup)`, `loadLineup()`, `saveLineup()` (try/catch), `parseLineupParam(str)` (§5.12) |
| `src/metrics.js` | 4 | 260 | `class Metrics` (`game.metrics()` schema §5.15), possession bookkeeping, assists (C27) |
| `src/physics.js` | 4 | 260 | v1 + rim/board constants (C30), separation pass with `bodyR` (C3) |
| `src/ball.js` | 4 | 420 | v1 + socket attachment (`attachTo(player, mode)` reads `animator.querySocket`), `launch` from sockets, `shot.touched`, `looseT`, spin flags for `ballvis` |
| `src/player.js` | 4 | 700 | v1 `Player` + `attrs`, `animator` (real or proxy), states v2 (`post`, `fallen`), jumps at `TAKEOFF` (ballistic), root-motion integration, facing rules, stamina/sweat |
| `src/game.js` | 4 | 1,450 | v1 `Game` + v2 rules (§5.13), blocks/steals/interceptions/bumps/shakes, events, `holdDead`, `passPreview`, lineup application, `__game` debug hooks (§5.15) |
| `src/ai.js` | 5 | 1,100 | `updateAI(world, dt)`, `resetAI(player)`, matchups, utilities, closeouts, contest timing, pass risk (§5.10) |
| `src/ai-tend.js` | 5 | 200 | per-legend tendency helpers; **imports** `SLOTS_V2` from `constants.js` and `tend`/`spots` from `legends.js` (no copied data, so nothing can drift) |
| `src/testbot.js` | 5 | 260 | `class TestBot` modes `off, idle, avg, good, drive, pullup` driving the real Intent (§5.14) |
| `src/legends/format.js` | 2 | 160 | `parseHeader`, `view`, `octDecode`, `decodePlayer` (§3.2) |
| `src/legends/library.js` | 2 | 280 | `loadLegends({tier, onProgress, renderer}) → Library` (§3.3) |
| `src/legends/character.js` | 2 | 460 | `class Character` (§3.4) |
| `src/legends/shells.js` | 2 | 220 | shell geometry, morph propagation, kit/groom merge |
| `src/legends/skinPainter.js` | 2 | 240 | `paintSkin(planes, look, size) → Uint8Array` (pure), `skinTexture()` |
| `src/legends/kitPainter.js` | 2 | 400 | `KIT_LAYOUT`, `GLYPHS`, `paintKit(ctx2d, player, mode, size)`, `kitTexture()` |
| `src/legends/sneaker.js` | 2 | 260 | `buildSneaker(feet, cut, side, lod)` (pure) |
| `src/legends/groom.js` | 2 | 200 | `paintStrandTexture(size)`, groom attribute builder, groom material |
| `src/legends/materials.js` | 2 | 230 | skin / wet / kit / groom / shadow-proxy material factories + `onBeforeCompile` patches (§3.10) |
| `src/showcase.js` | 2 | 300 | `?showcase=1` likeness page (§10) |
| `src/anim/rig.js` | 3 | 260 | `BONE`, `MIRROR`, `BONE_COUNT=53`, `buildRig`, `anatQuat`, `toLocal` |
| `src/anim/clip.js` | 3 | 330 | `defineClip`, `compileClip`, `sampleClip`, `clipTiming`, `EV`, `BM` |
| `src/anim/pose.js` | 3 | 160 | `Pose`, `copyPose`, `blendPose`, `addPose` |
| `src/anim/presets.js` | 3 | 240 | `FINGERS`, `ARM`, `LEG`, `STANCE`, `FORMS`, `STYLE` |
| `src/anim/locomotion.js` | 3 | 480 | `class Gait` |
| `src/anim/dribble.js` | 3 | 260 | `class Dribble` |
| `src/anim/ik.js` | 3 | 200 | `twoBoneIK`, `footLock`, `handOnBall`, `handToPoint` |
| `src/anim/look.js` | 3 | 130 | `class LookAt`, `eyeOffset` |
| `src/anim/animator.js` | 3 | 640 | `class Animator` (§4.2) |
| `src/anim/select.js` | 3 | 320 | `selectClip`, `selectMove`, `selectPass`, `selectDefJump`, `selectCelebration`, `selectIdleHabit`, `getTiming` |
| `src/anim/proxy.js` | 3 | 220 | `class AnimProxy` — same gameplay-facing API as `Animator`, closed-form sockets, no three.js scene (headless, §4.13) |
| `src/anim/viewer.js` | 3 | 280 | `?anim=` debug viewer, `window.__anim` |
| `src/anim/clips/common.js` | 3 | 700 | generic clips |
| `src/anim/clips/shots.js` | 3 | 320 | `makeJumper`, `makeLayup`, `makeDunk` |
| `src/anim/clips/<id>.js` ×6 | 3 | 6 × 220 | signature clips (§4.12) |
| `src/render/renderer.js` | 6 | 140 | `createRenderer(canvas, quality)`, `resizeRenderer` |
| `src/render/quality.js` | 6 | 320 | `TIERS`, `RUNGS`, `detectStatic`, `QualityMonitor`, `trackTexture`, `texMB` (§7) |
| `src/render/lighting.js` | 6 | 220 | `createLights`, `setPreset`, `updateShadowFit`, `createShadowProxy` |
| `src/render/shadows.js` | 6 | 90 | `sharedBlob()`, `BlobShadows` |
| `src/render/envmap.js` | 6 | 150 | `buildArenaEnv` |
| `src/render/floor.js` | 6 | 420 | `paintWoodTile`, `drawMarkings`, `worldToMarkPx`, `buildFloor`, `buildCentreDecal`, `BackcourtStripe` |
| `src/render/reflection.js` | 6 | 200 | `PlanarReflection` |
| `src/render/hoop.js` | 6 | 430 | `buildHoop`, `NetSim`, `ShotClockDigits`, `rimShake` |
| `src/render/arena.js` | 6 | 450 | `buildArena`, `Jumbotron`, `LedBoards` |
| `src/render/crowd.js` | 6 | 380 | `seats`, `paintCrowdAtlas`, `buildCrowd` (`excite`, `chant`) |
| `src/render/ballvis.js` | 6 | 260 | `paintBall`, `BallVisual` |
| `src/render/fx.js` | 6 | 200 | `ChalkBurst`, `CameraFlashes`, `ControlRing` |
| `src/cam/director.js` | 7 | 380 | `Director` (§6.4.1) |
| `src/cam/broadcast.js` | 7 | 240 | `FRAMING`, `baseFov`, `BroadcastCamera` |
| `src/cam/shots.js` | 7 | 320 | `introShots`, `lineupShot`, `titleShot`, `pauseShot`, `halftimeShot`, `gameoverShot`, intro timeline runner |
| `src/cam/replay.js` | 7 | 380 | `ReplayRecorder`, `ReplayPlayer`, `replayWindow`, `ReplayTriggers` |
| `src/ui/loading.js` | 8 | 220 | `Loader` (phases, bytes, error panel) |
| `src/ui/screens.js` | 8 | 420 | title, settings sheet, pause, halftime, game over + MVP |
| `src/ui/lineup.js` | 8 | 420 | lineup screen DOM, turntable input, detail card (calls `src/lineup.js`) |
| `src/ui/hud.js` | 8 | 560 | v2 HUD |
| `src/ui/captions.js` | 8 | 170 | `Captions` |
| `src/ui/indicators.js` | 8 | 150 | off-screen indicators, pass chevron, name tag |
| `src/ui/present.js` | 8 | 220 | intro lower-thirds, matchup title, replay chrome, toasts |
| `src/ui/settings.js` | 8 | 160 | `SETTINGS_SCHEMA`, `loadSettings`, `saveSettings` |
| `src/i18n.js` | 8 | 700 | v1 API + every key of §6.8 |
| `src/input.js` | 8 | 330 | v1 + R#9/R#10 fixes, double-tap detection, quick-tap timing, `.panel/.scroll` touchmove exemption |
| `src/audio.js` | 8 | 780 | v1 API + §6.7 sounds |
| `src/audio/crowd.js` | 8 | 300 | crowd beds, vowels, applause, chant |
| `src/main.js` | 9 | 420 | boot, URL params, loop (§1.4), `window.__game` assembly |
| `src/flow.js` | 9 | 380 | screen/state flow controller: MENU→LINEUP→INTRO→CHECK, rematch, quit, replays-in-DEAD hand-off, simplified mode; **event router** (§1.4.1: game events → captions, audio, crowd, jumbotron/LED, net, director, replay); lineup-screen 3D side (§1.4.2) |
| `src/humanoid.js` | 9 | 280 | v1 fallback, colours by argument |

Estimated total ≈ 24,000 lines (inside H9).

### 1.3 Runtime wiring

**Boot (`main.js`)**: parse URL (§5.12.6 list + `quality`, `quick`, `intro`, `replay`, `showcase`, `anim`, `aa`) →
`?showcase=1` → `showcase.js`; `?anim=` → `anim/viewer.js`; otherwise: i18n → `quality.detectStatic` → renderer →
`Loader` phases (§6.6): `loadLegends` (WP2) ∥ arena build (WP6) ∥ clip compile (WP3) → characters created (6, invisible)
→ `renderer.compile(scene, camera)` + 2 warm frames → `MENU` (title). On any load failure → `#loadError`
(重试 / 简化模式).

**Frame loop** (rAF; fixed step `FIXED_DT = 1/60`, accumulator clamp 0.25 s, v1):
1. `renderer.info.reset()`; `quality.frame(now, gate)` (judging rules §7.3).
2. While `acc ≥ FIXED_DT`: `input.sample()`; `testbot.step()` (if active); `game.step(FIXED_DT)`; `acc −= FIXED_DT`.
   `Game.step` order: (1) clocks + state machine (2) `updateAI` (3) apply intents → `context.resolve*` → actions
   (4) `Player.step` all (each runs `animator.step(dt)`; root motion → velocity; jump physics) (5) consume animator
   events (`TAKEOFF`, `RELEASE`, `SLAM`, `SWIPE`, `CONTACT`, `LAND`, `CATCH`, `READY`, `PLANT_*`, …) (6) blocks /
   interceptions / steals / bumps / shakes (7) separation (8) `Ball.step` → ball events (9) resolve events (score,
   catch, oob, captions, audio, metrics, crowd excitement, replay triggers).
3. `alpha = acc / FIXED_DT`.
4. Replay active → `replayPlayer.apply(alpha)`; else for each character with `c.visible` (previous frame) or in an
   action: `animator.evaluate(alpha, frameDt)` (throttles §4.14); then `replayRecorder.capture()`.
5. `ballvis.update(frameDt, ball)` (attached ball = rendered socket).
6. `director.update(frameDt, world)` (ends with `camera.updateMatrixWorld()`, R#4).
7. `lib.beginFrame(director.camera, viewportHeightPx)`; `c.update(frameDt)` ×6 (culling, LOD, sweat).
8. `lighting.updateShadowFit`; crowd/LED/jumbotron uniforms & ≤ 2 Hz repaints; `NetSim.step`; fx.
9. High tier: `reflection.update(...)` (every frame desktop, every 2nd frame touch).
10. `renderer.render(scene, director.camera)`.
11. `hud.update(frameDt, world, director)` (projections use this frame's matrices); `audio.update(frameDt)`.

**Headless (Node)**: `new Game({scene: null, anim: 'proxy', …})` runs steps only (≥ 50× real time); used by unit tests
and `test/balance.mjs`.

### 1.4 Cross-WP interfaces (frozen signatures; implement exactly)

```js
// WP2  src/legends/library.js / character.js
loadLegends({ tier, onProgress, renderer }) → Promise<Library>
Library: ids, meta(id), createCharacter(id, { kit: { mode: 'classic'|'allstarA'|'allstarB' }, lodMode: 'auto' }) → Promise<Character>,
         beginFrame(camera, viewportHeightPx), dispose()
Character: id, info, object (THREE.Group; game sets position (x,0,z), rotation.y = yaw), body, kitMesh, groomMesh,
           skeleton, bones, boneIndex(name), morph (Float32Array shared by body & groom), morphIndex, eyeOffset (Vector2),
           setKit({mode}), kitMode, setLod(n), lod, lodOverride (n|null), update(dt), setSweat(s), visible, dims,
           handWorld(out, side), handsMidWorld(out), headWorld(out), headY(), createShadowProxy(material) → SkinnedMesh,
           setReflectable(on), resetPose() (debug only), dispose(),
           jumpY (number, written by player.js each step; used by the cull sphere §3.4)
           dims = { heightBarefoot, eyeY, headTopY, headCentreAboveHeadBone, shoulderJoints }

// WP3  src/anim/animator.js (AnimProxy implements the gameplay subset marked *)
new Animator(rig, character, opts)
*play(clipIdx, { mirror, rate, warp: { [EV]: t }, target: { x, z, yaw }, layer: 'action'|'upper'|'add', blendIn })
*releaseNow()  *setJump(h, airT, profile?)  *stopAction(blendOut)  *step(dt)  *querySocket(sockIdx, out)
*onCatch(mode)  *events (ring of 32 {code, t, param}; head/tail)  *ballMode  *ballHand  *action  *actionTime
 evaluate(alpha, frameDt)  capture(f32, offset)  applyBlend(f32, offA, offB, alpha)  external (bool)
 freeze(clipId, t)  setYawOverride(yaw | null)  walkTo(x, z, yaw, speed) (intro/lineup placement, no sim)
 setFace(name, w)  look target setters
// WP3  src/anim/select.js
getTiming(playerId, kind, variant) → { tIdeal, takeoffT, h, rva, meterFrom, METER_T, gatherWindow: [dMin, dMax], clipId }
selectClip(player, resolved /* {kind, variant, side} */, ctx) → { clipIdx, mirror, warp, target }
selectMove(player, stick, ctx) → { clipIdx, mirror, moveId }

// WP4  src/game.js (plus __game hooks §5.15)
game.on(evt, cb)   evt ∈ the complete list of §1.4.1 ('caption','banner','state','shot','pumpFake','move','jab','takeoff',
                         'release','slam','land','plant','ball','score','miss','block','steal','intercept','deflect',
                         'ankle','bump','shake','ability','pass','catch','rebound','possession','turnover','clock',
                         'buzzer','quarter','gameover')
                   payload { kind, points, playerId, team, clutch, buzzer, time, x, z, ... }
game.holdDead(seconds)  game.passPreview() → playerId|null  game.setLineup(l)  game.start(opts)  game.rematch()  game.quit()

// WP6  src/render/quality.js
quality = { tier: 'low'|'medium'|'high', rung: 1..6, dpr, cadence, target, auto, history, onTierChange(cb) }
trackTexture(tex, bytesPerPixel = 4, mip = true); texMB()

// WP7  src/cam/director.js
director.setMode(name, { transition: 'cut'|'ease', seconds = 0.6, ...params }); director.update(dt, world);
director.camera; director.mode; director.cameraMode ('standard'|'close'|'high'); director.ndc(out, x, y, z)
replay: ReplayTriggers.onGameEvent(e) → { start: bool, window }; ReplayPlayer.active; skip()

// WP4  src/lineup.js
lineup = { a: [id,id,id], b: [id,id,id], user: 'a'|'b', kits: 'auto'|'classic'|'allstar' }

// WP4  construction (WP9 calls it; headless tests too)
new Game({ scene /* THREE.Scene | null */, anim: 'real'|'proxy', characters /* {id: Character} | null */, lineup,
           seed, difficulty: 'easy'|'normal'|'hard', rules: { clear, autoSwitch }, quarterSec })
// Player.animator = anim === 'real' ? new Animator(buildRig(header.players[i]), characters[id], opts)
//                                   : new AnimProxy(id, PROXY_METRICS[id])   // §4.1 metrics table embedded in proxy.js
game.meter    // one frozen-shape object rewritten in place each step (no allocation), read by the HUD:
              // { active, shooterId, fill /* 0..1.25 of the bar */, greenLo, greenHi, points /* 2|3 live */,
              //   flash /* null|'perfect'|'early'|'late' */, flashT /* s left */ }
// WP3  render-time sockets (after evaluate(); world space; used by ballvis, HUD name tag/meter, fx, replay)
animator.renderSocket(sockIdx, out)   // e.g. ball1_s of the ball hand, palm_s, eyeC
// WP6 presentation sinks (called only by the WP9 router)
crowd.excite(level, holdS); crowd.chant(on); jumbotron.setMode(mode, data); led.takeover(text, cssColour, s);
led.message(key); net.impulse(kind /* 'swish'|'rim'|'slam' */, strength); rim.shake(t0); fx.chalkBurst(pos)
// WP7
director.shake(ampM, seconds, hz); director.dunkPush(on)
// WP8
captions.push(key, params, priority); captions.clear(); hud.banner(key, params, ms); hud.bannerState();
audio.<sound>(…) per §6.7; crowdAudio.excite(level, holdS); crowdAudio.burst('ooh'|'aah'|'aww', gain); crowdAudio.applause(s)
settings.get(key); settings.set(key, value); settings.onChange(cb)        // src/ui/settings.js; WP9 wires consumers
const loader = new Loader(document.getElementById('loading'));             // src/ui/loading.js (WP8)
loader.phase(labelKey); loader.progress(globalFraction0to1); loader.bytes(loaded, total);
loader.error({ file, reason }, onRetry, onSimple); loader.done()          // fade-out 0.3 s
// WP6
detectStatic(gl, nav, screen, url) → { cls, startRung, capRung }; createQuality({ renderer, settings, url, static })
  → quality (§1.4 shape) with quality.frame(now, gate /* {judged, busyMs} */) called once per rAF by main.js
```

#### 1.4.1 Game events and their consumers (binding; `game.js` never imports or calls a presentation module)

`game.js` (WP4) only emits; `flow.js` (WP9) subscribes once at boot and routes. Every payload carries `{t, playerId,
team, x, z}` plus the fields below; payload objects come from a pool of 64 (H10). `__game.events` keeps the last 64.

| event | extra payload | emitted when | routed to (WP9) |
|---|---|---|---|
| `caption` | `key, params, priority` (1/2/3, §6.5.8) | wherever v1 called `hud.caption` (game chooses the key: bank, buzzer beater, first dunk, hot streak, abilities) | `captions.push` |
| `banner` | `key, params, ms` | period/OT/final/check banners (v1 `game.banner`) | `hud.banner` |
| `state` | `from, to, reason` | every `game.state` change | flow screens, presets (`lighting.setPreset`), director modes, audio horn on `QUARTER_END` |
| `shot` | `kind, variant, zone, points` | SHOOT press resolved to a shot (not a pump fake) | clutch anticipation `ooh` (crowd audio) if the clutch window is open |
| `pumpFake` / `move` / `jab` | `moveId` | §5.7 | (metrics only; B53 reads it from `__game.events`) |
| `takeoff` / `release` / `slam` / `land` / `plant` | `kind, h` / `kind, zone, points` / — / `dropH, massKg` / `decel, turnRate` | animator events consumed by game | `director.dunkPush(true)` from dunk `takeoff` to `slam` + 0.5 s; `slam` → `rim.shake`, `net.impulse('slam', 1)`, `audio.rim(1,'grab')`, `director.shake(0.03, 0.25, 12)`; `land` → `audio.thud` (§6.7 rule); `plant` → `audio.squeak` (§6.7 rule) |
| `ball` | `what: 'bounce'\|'rim'\|'board'\|'swish'\|'rimIn'\|'floor'`, `strength` | `Ball.step` contacts | `audio.bounce/rim/board/net`; `net.impulse('swish'\|'rim', strength)` |
| `score` | `points, kind, clutch, buzzer, assistId, winner, firstDunk` | basket counted | crowd visual + audio (§6.2 / §6.7 tables), `jumbotron.setMode('event', …)`, `led.takeover`, replay triggers, `cel.*` are started by `player.js` (WP4 → WP3), not by the router |
| `miss` | `kind, airball` | shot resolved as a miss | air ball → `crowdAudio.burst('aww', 0.6)` |
| `block` | `blockerId, shooterId, pin, chaseDown` | §5.4 success | `audio.block`, crowd 0.80 / 2.0 s + `ooh`, `jumbotron` `block`, replay triggers |
| `steal` / `intercept` / `deflect` | `how, fromId` | STL booked (at the catch) / pass caught / pass tipped | crowd 0.4 / 1.0 s |
| `ankle` | `defenderId` | §5.7 ankle-break | crowd 0.9 / 2.0 s + `ooh`, `director.shake(0.04, 0.15, 14)`, replay triggers (全部精彩) |
| `bump` / `shake` | `defenderId` | §5.6 / §5.7 | — |
| `ability` | `id` | §5.8 | — (captions come through `caption`) |
| `pass` / `catch` / `rebound` | `toId, kind` / `fromId` / `offensive` | v1 points | `audio` UI tick none; metrics only |
| `possession` | `reason` | possession change (incl. R9 live flip) | indicators reset, `led.message` |
| `turnover` | `reason: 'oob'\|'shotClock'\|'backcourt'\|'notCleared'` | v1 turnovers | `audio.whistle` (oob/backcourt/notCleared), `audio.shotHorn` (shotClock) |
| `clock` | `sec` | game clock crosses an integer below 5 s | `audio.tick` |
| `buzzer` | `kind: 'period'\|'shotClock'` | buzzers | `audio.horn`/`shotHorn`, hoop LED edge strip 1.0 s |
| `quarter` / `gameover` | `q, ot` / `winner, mvpId, box` | v1 points | screens, `jumbotron` `final`, crowd 1.0 / 6.0 s on a game-winner |

#### 1.4.2 Lineup screen ↔ flow (WP8 DOM, WP9 3D)

`new LineupScreen(root, { lineup, legends, onSwap(slotA, slotB), onSelect(id|null), onUser('a'|'b'),
onKits(mode), onShuffle(), onReset(), onStart(), onBack(), onDrag(dxPx), onRelease(vxPxPerS) })` (`src/ui/lineup.js`)
only draws DOM and reports intents; it calls `lineup.js` (WP4) for the pure logic and re-renders from the returned
lineup. `flow.js` (WP9) owns the 3D side: places the six with `animator.walkTo` (arc spots §6.4.5), runs the 0.6 s swap
jog, calls `character.setKit({mode})` when the two pass the midpoint (modes from `resolveKitModes`), and drives
`director.setMode('lineup', {focusId, yawDeg})` from `onSelect`/`onDrag`/`onRelease` (turntable §6.4.5).

### 1.5 Build order and milestones

```
WP1 (assets) ──M1: v2 header + bins (geometry, rig, eyes, mouth, shells), M2: masks + morphs + per-player groom──▶ WP2
WP3 (anim)  ── needs only the v2 header bone table (identical to the PoC header) ─────────────────────────────▶ WP4, WP7
WP4 (gameplay core) ── develops against AnimProxy (WP3 M-proxy, delivered first) ──▶ WP5 (AI), WP9
WP6 (render) independent ─▶ WP7 (cam/replay) ─▶ WP8 (UI) ─▶ WP9 (integration)
```
Order of first deliverables: WP3 `proxy.js` + `select.getTiming` tables (day 1, so WP4/WP5 can run headless) → WP1 M1
→ WP2 on M1 (masks may be flat placeholders until M2) → WP4/WP5 balance loop → WP6/WP7/WP8 → WP9 wiring → phase D
likeness loop (§10).

### 1.6 Work packages

Each WP owns its files exclusively (nobody else edits them; requests go through the interface list in §1.4). Shared
data files are owned by one WP and fully specified here, so others can rely on them before they exist.

| WP | name | files owned | inputs | outputs / exports | acceptance on its own |
|---|---|---|---|---|---|
| **WP1** | Bake pipeline & assets | `tools/legends/**` (bake.mjs, lib/{shells,targets,mesh,landmarks,morphs,uvraster,png,masks}.mjs, measure.mjs, calibrate.mjs, fetch.mjs, legends.config.json, FORMAT.md, README.md, package.json), `assets/legends/**`, `test/unit-legends-bake.mjs` | phaseA, §2.8, §3, §8 | format-v2 header + bins + 15 PNGs ≤ 3.5 MB; FORMAT.md v2; `measure --likeness` | §8.6 bake log checks; `unit-legends-bake` + `unit-legends-format` (header/bins) pass; budgets §3.1; `measure --likeness` exit 0 after the §10 loop |
| **WP2** | Character runtime & likeness page | `src/legends/*`, `src/showcase.js`, `test/unit-legends-format.mjs`, `test/unit-skinpaint.mjs`, `test/unit-sneaker.mjs`, `test/unit-glyphs.mjs`, `test/likeness/shoot.cjs` | WP1 assets (M1 → M2), §2.6–2.7, §3 | `loadLegends`, `Character` (§1.4) | the 4 unit files; B39 (showcase) and B28/B29 (heights, distinct bodies) run on `?showcase=1`; draw calls = 4 per character; memory stable after 10 setKit/dispose cycles |
| **WP3** | Animation | `src/anim/**`, `test/unit-anim.mjs` | v2 header bones/landmarks, §4 | `Animator`, `AnimProxy`, `select.*`, `getTiming`, viewer | `unit-anim` (8 groups §4.15); viewer items B44–B45 on `?anim=` (in-game items B46–B52 at integration); zero-alloc probe |
| **WP4** | Gameplay core | `src/{legends,ratings,constants,shot,abilities,context,lineup,metrics,physics,ball,player,game}.js`, `test/unit-{ratings,shot,block,steal,abilities,lineup,core,physics,ball}.mjs` | §2, §5, AnimProxy | rules, models, events, `__game` hooks | its unit files; `balance.mjs --scenarios S3,S4,S6,S7,S8,S9,S10` with AI from WP5 stubbed to v1 behaviour where needed |
| **WP5** | AI & balance | `src/ai.js`, `src/ai-tend.js`, `src/testbot.js`, `test/unit-ai.mjs`, `test/balance.mjs` | WP4 API, §5.10–5.14 | `updateAI`, `resetAI`, bots | `unit-ai`; `balance.mjs` bands A–C + S1–S11 (§5.14) |
| **WP6** | Rendering & arena & quality | `src/render/*`, `test/unit-{quality,floorpaint,ballpaint,net,crowd}.mjs` | §6.1–6.3, §7 | renderer, lights, shadows, env, floor, hoop, arena, crowd, ball visual, fx, quality monitor | its unit files; a standalone `?quality=` render of the empty arena meets §7.4 counts for the arena share |
| **WP7** | Cameras, intro, replay | `src/cam/*`, `test/unit-{camera,replay}.mjs` | §6.4, Animator capture API, game events | Director, framing, intro/lineup/title/pause/halftime/gameover shots, replay | its unit files (framing counts reproduce §6.4.2) |
| **WP8** | UI, i18n, input, audio | `index.html`, `css/style.css`, `src/i18n.js`, `src/input.js`, `src/ui/*`, `src/audio.js`, `src/audio/crowd.js`, `test/unit-{captions,present,audio,i18n}.mjs`, `test/layout-check.cjs` | §6.5–6.8, §5.12 | all DOM screens, HUD, captions, settings, loading UI, sounds | its unit files; layout-check on 8 viewports (B36) with a stub game |
| **WP9** | Integration & QA | `src/main.js`, `src/flow.js`, `src/humanoid.js`, `README.md`, `package.json`, `test/acceptance.cjs`, `test/harness.cjs`, `test/integ-*.cjs`, `test/README.md` | all WPs | the playable game, `window.__game`, acceptance suite | all of §9 (B1–B61) green; manual device matrix §9.5 (incl. the §7.6 load-phase budgets) |

---
## 2. Data — `src/legends.js` (WP4) and the bake config (WP1)

### 2.1 Schema

```js
// src/legends.js — frozen plain objects; with i18n.js the only src file allowed CJK text
export const LEGEND_IDS = ['kobe', 'jordan', 'lebron', 'giannis', 'yao', 'kyrie'];   // = header order
export const LEGENDS = { <id>: Object.freeze({
  id, name: { zh, en }, short: { zh, en }, number: '24', era: '2008-10', hand: 'R',
  stats: { heightM, barefootM, weightKg, wingspanM, reachM },
  shoulderJoints,                                   // m (bake calibration), body radius & blob scale
  ratings: { overall, speed, strength, vertical, ballHandle, closeShot, midRange, three, dunk, layup,
             passing, perimeterD, interiorD, block, steal, rebound },             // [PROF ratings] verbatim
  release: { jumper, fade, hook },                  // contest/block maths only (§5.3.5); ball launches from the socket
  abilities: [ ... ],                               // §5.8 ids
  traits: { chaseBlock, canDunkTraffic, noDribbleMoves, threeGate, maxDribbles },
  tend: { ... },                                    // §2.5
  spots: { <slotId>: weight },                      // §2.5
  look: { ... },                                    // §2.6 runtime paint parameters
  kit: { classic: 'home'|'away', home: {...}, away: {...}, socks, shoes, accessories },   // §2.7
}) };
export const TEAMS_V2 = { dark, bright, allstarA, allstarB };                         // §2.9
export const DEFAULT_LINEUP = { a: ['lebron','kyrie','giannis'], b: ['jordan','kobe','yao'], user: 'a', kits: 'auto' };
export const TEAM_UI = { dark: {...}, bright: {...}, allstarA: {...}, allstarB: {...} }; // §2.9
```
A unit test (`unit-lineup.mjs`) asserts that `LEGENDS[id].name`, `number` and `stats` equal the baked header
`players[i].meta` (`nameZh`, `nameEn`, `number`, `stats`), so the two sources cannot drift.

### 2.2 Identity and stats

| field | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| name.zh | 科比·布莱恩特 | 迈克尔·乔丹 | 勒布朗·詹姆斯 | 扬尼斯·阿德托昆博 | 姚明 | 凯里·欧文 |
| name.en | Kobe Bryant | Michael Jordan | LeBron James | Giannis Antetokounmpo | Yao Ming | Kyrie Irving |
| short.zh / en | 科比 / Kobe | 乔丹 / Jordan | 詹姆斯 / LeBron | 字母哥 / Giannis | 姚明 / Yao | 欧文 / Kyrie |
| number | 24 | 23 | 23 | 34 | 11 | 2 |
| era | 2008-10 | 1991-98 | 2016-18 | 2019-21 | 2004-09 | 2014-17 |
| hand | R | R | R | R | R | R |
| heightM / barefootM | 1.98 / 1.96 | 1.98 / 1.96 | 2.06 / 2.03 | 2.11 / 2.09 | 2.29 / 2.27 | 1.88 / 1.87 |
| weightKg | 96 | 98 | 113.4 | 110 | 141 | 88 |
| wingspanM | 2.11 | 2.11 | 2.14 | 2.21 | 2.26 | 1.93 |
| reachM (listed standing reach, [XCHK]) | 2.64 | 2.65 | 2.69 | 2.81 | 2.95 | 2.515 |
| shoulderJoints (m) | 0.455 | 0.460 | 0.505 | 0.485 | 0.490 | 0.425 |

### 2.3 Ratings, release heights, abilities, traits

| field | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| overall | 97 | 98 | 98 | 96 | 89 | 93 |
| speed / strength / vertical | 85 / 72 / 88 | 91 / 72 / 94 | 87 / 98 / 88 | 88 / 92 / 95 | 38 / 86 / 42 | 91 / 55 / 80 |
| ballHandle | 91 | 88 | 88 | 76 | 42 | 99 |
| closeShot / midRange / three | 92 / 98 / 84 | 95 / 99 / 76 | 93 / 82 / 77 | 93 / 66 / 58 | 95 / 80 / 30 | 90 / 93 / 90 |
| dunk / layup | 88 / 95 | 96 / 98 | 96 / 96 | 99 / 95 | 72 / 74 | 55 / 99 |
| passing | 82 | 82 | 97 | 79 | 66 | 84 |
| perimeterD / interiorD | 93 / 55 | 97 / 58 | 88 / 82 | 87 / 91 | 50 / 97 | 70 / 36 |
| block / steal / rebound | 50 / 86 / 60 | 63 / 96 / 66 | 74 / 78 / 87 | 88 / 74 / 94 | 96 / 42 / 90 | 35 / 72 / 45 |
| release.jumper / fade / hook (m) | 3.00 / 2.95 / — | 3.00 / 3.00 / — | 2.85 / 2.85 / — | 2.90 / 2.90 / 3.05 | 3.45 / 3.40 / 3.55 | 2.80 / 2.80 / — |
| abilities | `kobe.postFade`, `kobe.jab`, `kobe.tough`, `clutch` | `jordan.fade`, `jordan.air`, `jordan.ftDunk`, `jordan.hawk`, `clutch` | `lebron.powerDrive`, `lebron.chaseDown`, `lebron.skipPass`, `lebron.bully` | `giannis.euro`, `giannis.longDunk`, `giannis.helpBlock` | `yao.hook`, `yao.highRelease`, `yao.anchor`, `yao.post` | `kyrie.combo`, `kyrie.finisher`, `kyrie.stepback`, `clutch` |
| traits.chaseBlock | 1 | 1 | 2 | 1 | 0 | 0 |
| traits.canDunkTraffic | true | true | true | true | false | false |
| traits.noDribbleMoves / maxDribbles | false / null | false / null | false / null | false / null | true / 2 | false / null |
| traits.threeGate (AI: min openness m for a three) | null | null | null | 2.5 | `Infinity` (never, except shot clock < 1.5 s) | null |

### 2.4 Display composites (lineup detail card; computed by `legends.js → composites(id)`, rounded) [PR §5.5]

| composite (i18n `comp.*`) | formula | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|---|
| 投篮 SHT | 0.25 closeShot + 0.40 midRange + 0.35 three | 92 | 90 | 83 | 70 | 66 | 91 |
| 突破 DRV | 0.30 layup + 0.25 dunk + 0.25 speed + 0.20 ballHandle | 90 | 94 | 92 | 90 | 58 | 86 |
| 内线 INS | 0.40 closeShot + 0.30 strength + 0.30 rebound | 76 | 79 | 93 | 93 | 91 | 66 |
| 防守 DEF | 0.30 perimeterD + 0.30 interiorD + 0.20 block + 0.20 steal | 72 | 78 | 81 | 86 | 72 | 53 |

Card stat chips (landscape cards) = the player's three highest ratings excluding `overall` (ties → table order of
§2.3), labels `stat.<key>`.

### 2.5 Tendencies (`tend`) and spots (`spots`)

Shot-mix multipliers are `m = 0.6 + 1.6·share` of the profile shares; other values direct [GP §10.2].

| tendency | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| profile shot mix rim / close / mid / three / post (stored as `mix`) | .25/—/.45/.15/.15 | .38/—/.45/.10/.07 | .45/—/.15/.20/.10 | .60/.15/.10/.15/— | .05/.30/.35/.00/.60 | .40/.10/.25/.25/— |
| `shotRim` | 1.00 | 1.21 | 1.32 | 1.56 | 0.68 | 1.24 |
| `shotClose` | 0.80 | 0.80 | 0.80 | 0.84 | 1.08 | 0.76 |
| `shotMid` | 1.32 | 1.32 | 0.84 | 0.76 | 1.16 | 1.00 |
| `shotThree` | 0.84 | 0.76 | 0.92 | 0.84 | 0 | 1.00 |
| `post` (vs mismatch; Yao always) | 0.84 | 0.72 | 0.76 | 0.60 | 1.56 | 0 |
| `iso` | 1.10 | 1.00 | 0.80 | 0.60 | 0 | 1.40 |
| `isoMoves` [min, max] | [1,2] | [1,2] | [0,1] | [0,1] | [0,0] | [2,4] |
| `patience` (s) | 2.5 | 2.5 | 3.0 | 1.5 | 2.0 | 3.5 |
| `pass` | 0.80 | 0.90 | 1.35 | 1.00 | 1.00 | 0.85 |
| `kickWhenDoubled` | 0.60 | 0.70 | 0.90 | 0.75 | 0.95 | 0.70 |
| `driveRight` | 0.60 | 0.60 | 0.50 | 0.65 | 0.50 (unused) | 0.60 |
| `jab` | 0.70 | 0.40 | 0.15 | 0.10 | 0.00 | 0.10 |
| `pumpFake` | 0.25 | 0.25 | 0.10 | 0.05 | 0.30 | 0.10 |
| `fade` | 0.55 | 0.60 | 0.25 | 0.05 | 0.15 | 0.20 |
| `stepback` | 0.25 | 0.10 | 0.30 | 0.00 | 0.00 | 0.55 |
| `checkShare` | 0.40 | 0.55 | 0.50 | 0.10 | 0.05 | 0.40 |
| `crash` | 0.20 | 0.30 | 0.35 | 0.55 | 0.60 | 0.05 |
| `boxOut` | 0.40 | 0.50 | 0.70 | 0.60 | 1.00 | 0.30 |
| `stealGamble` | 1.20 | 1.30 | 1.00 | 0.80 | 0.20 | 1.20 |
| `help` | 0.60 | 0.90 | 1.00 | 1.50 | 1.20 | 0.50 |
| `contestJump` [perimeter, rim] | [0.70, 0.70] | [0.80, 0.80] | [0.80, 0.90] | [0.80, 0.95] | [0.40, 1.00] | [0.50, 0.30] |
| `closeout` | 1.0 | 1.0 | 1.0 | 1.0 | 0.85 | 1.0 |
| `guardBest` | 1 | 1 | 0 | 0 | 0 | 0 |
| `riskTol` (pass risk) | 0.15 | 0.12 | 0.10 | 0.18 | 0.15 | 0.15 |

Spots (`SLOTS_V2` world metres: top (0, −4.9); leftElbow/rightElbow (∓2.44, −8.6); leftWing/rightWing (∓5.4, −7.6);
leftBlock/rightBlock (∓2.0, −11.6); leftCorner/rightCorner (∓7.0, −13.3); leftDunker/rightDunker (∓3.0, −13.6);
rightBaseline (5.0, −12.8)):

| legend | spots weights |
|---|---|
| kobe | rightElbow .30, rightWing .30, rightBlock .15, leftWing .15, rightBaseline .10 |
| jordan | leftElbow .25, rightElbow .25, rightWing .25, leftBlock .125, rightBlock .125 |
| lebron | top .35, leftWing .30, rightWing .20, leftBlock .15 |
| giannis | top .25, rightWing .20, leftDunker .25, rightDunker .30 |
| yao | leftBlock .40, rightBlock .25, leftElbow .15, rightElbow .20 |
| kyrie | top .30, rightWing .30, leftCorner .15, rightCorner .15, leftWing .10 |

### 2.6 Runtime look (`look`, consumed by `skinPainter`, `groom`, `materials`) [CFG appearance][CHR §2.5, §4–§6]

| field | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| `skin` | #8B5A3C | #4E3122 | #6A4530 | #523326 | #D8A985 | #8A5A3B |
| `lips` | #6a4030 | #3A221B | #4a2e22 | #3e261c | #b8786a | #5e3a2c |
| `palms` | #b48466 | #A9785E | #A47A5E | #9c705a | #e4bea0 | #b88a6c |
| `skinRoughness` | 0.48 | 0.45 | 0.42 | 0.45 | 0.50 | 0.46 |
| `warmK` | 0.45 | 0.45 | 0.45 | 0.45 | 0.60 | 0.45 |
| `cavityK` | 1.0 | 1.0 | 1.0 | 1.0 | 0.70 | 0.85 |
| `hlK` | 0.10 | 0.10 | 0.10 | 0.10 | 0.05 | 0.10 |
| `tattooK` | 0 | 0 | 1.0 | 0 | 0 | 1.0 |
| `stubbleHair` | 1 | 0 | 0.5 | 0 | 0 | 0 |
| `hair` colour (`groomColor`, also beard/brow tint) | #151010 | #0E0A09 | #141010 | #141110 | #121010 | #141010 |
| `beard` colour | #151010 | #0E0A09 | #120E0C | #141110 | #2a2420 | #121010 |
| `scalpDarken` | 0.38 | 0 | 0.60 | 0.85 | 0.85 | 0.85 |
| `scalpRoughness` | 0.62 | 0.32 | 0.70 | 0.75 | 0.70 | 0.75 |
| `beardSkinDarken` | 0.35 | 0.40 | 0.55 | 0.45 | 1.0 (× 0.07 mask) | 0.55 |
| `browDarken` | 0.35 | 0.35 | 0.35 | 0.35 | 0.35 | 0.35 |
| `glossBase` (high-tier clearcoat on `extra.G`) / `clearcoatRoughness` | 0 / 0.30 | **0.55 / 0.22** | 0 / 0.30 | 0 / 0.30 | 0 / 0.30 | 0 / 0.30 |
| groom `sheenColor` (high) | #6a5a50 | #6a5a50 | #6a5a50 | #6a5a50 | #8090a0 | #6a5a50 |
| iris (all share one eye texture) | #2A1A12 | #2A1A12 | #2A1A12 | #2A1A12 | #2A1A12 | #2A1A12 |
| idle face baseline [ANIM §2.8] | `scowl` 0.35 | `jawOpen` gum chew `0.06 + 0.06·max(0, sin(2π·1.5t))` | 0 | 0 | 0 | 0 |

### 2.7 Kits, socks, shoes, accessories (`kit`) [CHR §7.5–§7.8][CFG][DEC]

**Classic kit used by default** (team DARK = LeBron, Kyrie, Giannis; BRIGHT = Jordan, Kobe, Yao):

| | `classic` side | base | number / outline / keyline | glyph style | neck & armhole bands (edge → in, mm) | shorts side stripe (mm) | waistband / hem (mm) | socks shell, colour |
|---|---|---|---|---|---|---|---|---|
| lebron | away (wine) | #6F263D | #FFB81C / #041E42 / — | block | #FFB81C 8, #041E42 4 | #041E42 10, #FFB81C 20, #041E42 10 | #FFB81C 6 / #041E42 6 | crew, #111111 |
| kyrie | away (wine alternate) | #6F263D | #FFB81C / #FFFFFF / — | block | #FFB81C 8, #FFFFFF 3 | #FFFFFF 6, #FFB81C 24, #FFFFFF 6 | #FFB81C 6 / #FFB81C 6 | crew, #FFFFFF |
| giannis | away (green) | #00471B | #EEE1C6 / #FFFFFF / — | block | #EEE1C6 8, #0077C0 2 | #0077C0 2, #EEE1C6 40, #0077C0 2 | #EEE1C6 6 / #EEE1C6 6 | mid, #FFFFFF |
| jordan | away (red) | #CE1141 | #FFFFFF / #000000 / — | block | #000000 5, #FFFFFF 3, #000000 5 | #000000 12, #FFFFFF 6 | #000000 8, #FFFFFF 4, #000000 8 / #000000 6 | low, #000000 |
| kobe | home (gold) | #FDB927 | #552583 / #FFFFFF / — | **rounded** | #552583 9, #FFFFFF 3 | #FFFFFF 6, #552583 30, #FFFFFF 6 | #552583 40 / #552583 12 | high, #FFFFFF |
| yao | away (red) | #CE1141 | #FFFFFF / #C4CED4 / #000000 | block, serif "1" | #FFFFFF 6, #C4CED4 4 | #FFFFFF 12, #C4CED4 8, #000000 4 | #FFFFFF 6 / #C4CED4 6 | crew, #FFFFFF (+3 mm ankle-brace bulge ±4 cm) |

Extras: Jordan 1.5 cm light-blue `#9bc4e2` undershort band painted on the inner 1.5 cm of both shorts hems and a 0.075 m
shorts number on the left leg front (u 0.82, 0.10 m above the hem); Kobe sock brace bulge like Yao's. Back name
(uppercase surname, colour = number colour): BRYANT, JORDAN, JAMES, ANTETOKOUNMPO, YAO, IRVING. Shorts fit (fold
painting only): Kobe/Yao baggy-2000s, Jordan baggy-1990s knee, LeBron/Kyrie 2010s knee, Giannis 2020s knee.

**All-Star variants** (repaint of the same atlas; each player keeps number and name):

| mode | base | number / outline | neck & armhole | shorts stripe | socks | headband / wristband / tape | shoes |
|---|---|---|---|---|---|---|---|
| `allstarA` | #F4F4F1 | #C9A227 / #111111 (0.30 u) | #C9A227 8, #111111 2 | #C9A227 30 | #FFFFFF | #FFFFFF | player's `home` colourway |
| `allstarB` | #121212 | #D22630 / #FFFFFF | #D22630 8, #FFFFFF 2 | #D22630 30 | #111111 | #111111 | player's `away` colourway |

**Shoes** (`[c0 upper, c1 accents/heel/collar lining/lace bars, c2 side panel/outsole]`; midsole #F2F2F0; no logos):

| | cut | `home` | `away` | default with classic kit |
|---|---|---|---|---|
| kobe | low | #FFFFFF, #FDB927, #552583 | #552583, #111111, #FDB927 | home |
| jordan | mid-high | white upper, patent mudguard #0a0a0a (roughness 0.10), side panel off, outsole #a8d8f0 (r 0.30) | upper #0a0a0a mesh (r 0.80), patent mudguard #0a0a0a, heel tab #CE1141, midsole #FFFFFF, outsole #CE1141 | away |
| lebron | high | #FFFFFF, #FFB81C, #6F263D | #6F263D, #FFB81C, #111111 | away |
| giannis | low-mid | #FFFFFF, #00471B, #EEE1C6 | #111111, #00471B, #EEE1C6 | away |
| yao | high | #FFFFFF, #CE1141, #FFFFFF | #CE1141, #FFFFFF, #111111 | away |
| kyrie | low | #FFFFFF, #6F263D, #FFB81C | #111111, #FFB81C, #111111 | away |

Code identifiers for Jordan's two colourways are `jordanHome` / `jordanAway` (never sneaker nicknames; denylist §9.2).

**Accessories** (in the kit mesh unless noted; nobody else wears any):

| accessory | who | shell / region | offset | classic / allstarA / allstarB |
|---|---|---|---|---|
| compression sleeve + 2.5 cm cuff band (r 0.35) | kobe, right arm | `sleeve_r` (13 cm below the shoulder joint → wrist) | 3 mm | #111111 always |
| finger tape | kobe, right index + middle | `tape_r_im`: weight(index_01/02_r, middle_01/02_r) > 0.55 | 0.8 mm | #f4f4f4 / #f4f4f4 / #111111 |
| wristband (9 cm wide) | jordan, left mid-forearm | `wristband_l`: lowerarm_l weight > 0.5, 3.4–11.0 cm (base) below the elbow joint | 4 mm | #CE1141 / #FFFFFF / #111111 |
| headband (high, level) | lebron | `headband_high`: Gy + 0.036 … + 0.082 (base metres; = Gy + 0.040 … + 0.090 player metres, the figure §3.7 uses), back edge +0.005 | 6 mm | #111111 / #FFFFFF / #111111 |
| headband (low) | kyrie, **off** (not worn in v2) | `headband_low`: Gy + 0.012 … + 0.048 | 5 mm | #111111 |
| tattoos (skin `extra.R`) | lebron (both arms ≈ 70 % upper arms / 35 % forearms coverage, 26 × 5 cm upper-back arch), kyrie (10 × 3 cm dotted bracket, mid left forearm) | 3D noise blobs 2–6 cm thresholded at 0.45 | — | darken 12 %, desaturate 30 % |
| mouthguard (3.0 × 2.5 × 0.6 cm rounded slab, 12 tris; a separate rigid `Mesh` child of the `head` bone sharing the character's wet material, so +1 draw call only while visible; **high tier only**) | kyrie | visible while `smirk` > 0.1 or idle with `jawOpen` ≥ 0.15 | — | #f2f2f2 |

### 2.8 Grooming geometry parameters (bake-time, `legends.config.json → appearance`, WP1) [CHR §4.5, §5.2, §6]

Hair (per player frame of §3.5.2; Jordan has no hair shell):

| | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| style | buzz 1–2 mm | bald + sheen | buzz 3–5 mm, receded, under headband | coils 8–12 mm, low fade, edge-up | straight crew 12–18 mm, fringe | coils 8–12 mm, taper, edge-up |
| inner shell offset / family / density / fadeMm | 0.6 mm / stipple 0.7 + straight 0.3 / 0.42 / 4.0 | — | 1.5 mm / stipple 0.5 + coil 0.5 / 0.85 / 3.0 | 1.5 mm / coil / 0.95 / 0.8 | 2.0 mm / straight / 0.98 / 2.0 | 1.5 mm / coil / 0.95 / 0.8 |
| outer shell offset (top) / sidesScale / density / inset / fadeMm | — | — | — | 7.0 mm / 0.20 / 0.55 / 3 mm / 2.5 | 9.0 mm / 0.33 / 0.60 / 0 / 3.0; front 1.5 cm offsetScale × 1.25 | 6.0 mm / 0.40 / 0.50 / 2 mm / 2.0 |
| `above` (cm above glabella) | 6.8 | — | 7.5 | 6.5 | 6.0 | 6.2 |
| frontCurve / rec (cm) | 0.3 / 1.0 | — | 0.4 / 2.5 | 0.1 / 0.5 | 0.0 / 0.4 | 0.0 / 0.3 |
| temple corner | round | — | round (deep M) | square | round | square |
| sideburn bottom / width (cm) | mid-ear / 1.4 | — | beard / 1.8 | beard / 1.6 | mid-ear / 1.3 | beard / 1.6 |
| earGap (mm) / napeBelowLobe (cm) / nape | 8 / 2.5 / square | — | 5 / 3.0 / square | 4 / 3.5 / taper | 6 / 3.0 / taper | 4 / 3.0 / square |
| Jordan only | — | `groom.R` horseshoe at φ > 1.0, EL.y < y < ET.y + 0.04, density 0.12; gloss mask above Gy + 0.06 fading over 2 cm | — | — | — | — |

Beard (components defined in [ref CHR:§5.1 Components]):

| | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| style / components | moustache-goatee: M + Gt + Lk(0.15) + J | moustache-goatee: M + Gt + Lk(0.40) | full: F (+M connected) | short-full: F (low line) + M (thin, gap) | none: J only (stubble shadow) | full: F (+M connected) |
| moustache height / gap / drop (mm) | 6 / 1.5 / 4 | 7.5 / 1.0 / 5 | to SN − 0.5 / 0.5 / — | 4 / 2.0 / 3 | — | to SN − 0.5 / 0.5 / — |
| moustache density | 0.55 (× 0.7 at \|x\| < 4 mm) | 0.85 (× 0.8 at \|x\| > 15 mm) | 0.95 | 0.70 | — | 0.95 |
| goatee w × h / soulW (cm); density | 2.5 × 2.0 / 1.0; 0.60 | 3.0 × 2.5 / 1.2; 0.85 | — | — | — | — |
| cheek line A: dA / yA | — | — | 0.010 / T.y − 0.004 | 0.009 / EL.y + 0.002 | — | 0.008 / T.y − 0.002 |
| cheek line B: dB / yB | — | — | 0.015 / CH.y + 0.004 | 0.006 / CH.y − 0.006 | — | 0.008 / CH.y + 0.012 |
| neckline dN below ME (m) | — | — | 0.025 | 0.006 | — | 0.022 |
| zone densities | jaw shadow 0.45 | cheeks 0 | all 0.95 | jaw 0.80, chin 0.90, cheeks 0.35 | upper lip + chin 0.07 | all 0.95 |
| inner layer offset / family | 1.0 mm / stipple 0.6 + straight 0.4 | 1.2 mm / stipple 0.5 + straight 0.5 | 1.5 mm / coil | 1.0 mm / coil | — | 1.5 mm / coil |
| outer layer offset chin / cheeks, density | — | — | 6 / 3 mm, 0.60 | 2.5 / 2.0 mm, 0.50 | — | 6 / 3 mm, 0.60 |

Brows (`yc(t) = EC.y + gap + arch·4t(1 − t)·k(t) + tail·smooth(0.65, 1, t)`, Jordan `k = smooth(0.2, 0.7, t)`, others 1;
inner end 13 mm medial of EC, tail 25 mm lateral; half-thickness `hIn·(1−t) + hOut·t`; offset 1.0 mm):

| (m) | gap | arch | tail | hIn | hOut | density | shape |
|---|---|---|---|---|---|---|---|
| kobe | 0.0235 | 0.0025 | −0.002 | 0.0045 | 0.0020 | 0.80 | straight-low |
| jordan | 0.0225 | 0.0030 | −0.003 | 0.0035 | 0.0015 | 0.70 | thin-low-straight |
| lebron | 0.0225 | 0.0015 | −0.004 | 0.0055 | 0.0030 | 0.95 | thick-low-straight |
| giannis | 0.0225 | 0.0010 | −0.005 | 0.0055 | 0.0028 | 0.90 | thick, outer ends down |
| yao | 0.0235 | 0.0010 | +0.003 | 0.0055 | 0.0032 | 0.95 | thick, outer ends up |
| kyrie | 0.0235 | 0.0020 | −0.002 | 0.0050 | 0.0028 | 0.95 | thick-low-straight |

Face/body morph changes for the config are in §10.3.

### 2.9 Teams, default lineup, team UI

| id | name zh / en | abbr zh / en | roster (default) | UI chip bg / text / accent (score bug, ring, LED, crowd shirts) |
|---|---|---|---|---|
| `dark` | 暗夜队 / Team Dark | 暗夜 / DRK | lebron ★, kyrie, giannis | #6F263D / #FFB81C / #FFB81C |
| `bright` | 烈阳队 / Team Bright | 烈阳 / BRT | jordan ★, kobe, yao | #CE1141 / #FFFFFF / #000000 |
| `allstarA` | 白队 / Team White | 白队 / WHT | (team A of a custom lineup) | #F4F4F1 / #1A1A1A / #D9A520 |
| `allstarB` | 黑队 / Team Black | 黑队 / BLK | (team B of a custom lineup) | #121212 / #FFFFFF / #CE1141 |

Roster index 0 = ★ check-ball handler of the user's team. `DEFAULT_LINEUP = {a: dark roster, b: bright roster, user:
'a', kits: 'auto'}`. Any 3 + 3 split of the six is valid; duplicate #23 on one team is allowed (HUD, captions and box
score name players, never number them).

---
## 3. Characters (WP1 assets, WP2 runtime) [CHR]

### 3.1 Shipped assets (`assets/legends/`, committed; format **version 2**)

| file | content | budget (raw) |
|---|---|---|
| `legends.json` | header v2 (§8.2) | ≤ 140 KB |
| `legends.shared.bin` | shared sections (uv, skin weights, indices LOD0–3 + covered variants, shared shells: jersey, shorts, socks_low/crew/mid/high, sleeve_r, tape_r_im, wristband_l, headband_high/low, lashes), mouth geometry, procedural eyeball topology (24×16 + 12×8 index range), shell LOD1 indices | ≤ 800 KB |
| `legends.<id>.bin` ×6 | positions (u16q) + normals (oct8) for kept vertices incl. eyeball/teeth/tongue/lash vertices, sparse morph deltas (`i16q`), per-player groom shells (hair inner/outer, beard inner/outer, brows), `shoeCover_<cut>` lists | ≤ 300 KB each |
| `legends.skin0.png` | RGB 1024²: R lips, G cavity, B highlight | ≤ 160 KB |
| `legends.skin1.png` | RGB 512²: R redness, G body AO, B mottle | ≤ 120 KB |
| `legends.skin2.png` | RGB 512²: R palms, G nails, B 0 | ≤ 25 KB |
| `legends.<id>.groom.png` ×6 | RGB 1024²: R scalp-hair density, G beard density (incl. jaw shadow), B brow density | ≤ 70 KB each |
| `legends.<id>.extra.png` ×6 | RGB 512²: R tattoo, G scalp gloss, B sweat zones | ≤ 30 KB each |
| `README.md` | CC0 provenance of the MakeHuman / MPFB data + the fan-project note (H7) | — |

Total ≤ 3.5 MB (estimate 3.1 MB). PNGs: colour type 2 (RGB), no alpha, no gAMA/iCCP. All fetches
`new URL('../../assets/legends/<file>', import.meta.url)` from `src/legends/library.js`.

### 3.2 Runtime modules and decoding

`format.js`: `parseHeader(json)` asserts `format === 'legends-mesh' && version === 2`; section types of FORMAT v1 +
`i16q` (int16 × 0.00002 m) + generalised `u8n*k`; `octDecode`; `decodePlayer(buf, info, shared) → {kept, keptN,
morphs, shells}` (pure, Node-testable).

### 3.3 Loading (`library.js`)

Order and progress weights (inside the global loader of §6.6): header 0.03 → shared bin 0.25 → 6 player bins in
parallel 0.30 → 3 shared + 12 per-player PNGs via `fetch → blob → createImageBitmap(blob, {premultiplyAlpha:'none',
colorSpaceConversion:'none'})` → scratch canvas `getImageData` → `Uint8Array` planes (bitmaps `close()`d) 0.12 → paint 6
skins (yield every 64 rows) 0.20 → paint 6 kits 0.05 → `renderer.compile` with all characters invisible 0.05. Each
fetch: timeout 20 s (AbortController), 2 retries after 500 ms and 1,500 ms; failure or `!isWebGL2` → reject →
simplified mode + toast `legendsLoadFailed` (= `toast.webgl1` for WebGL1). No `localStorage` use.

Decode details (binding): if `createImageBitmap` is missing or throws with the options object (older Safari), fall
back to `createImageBitmap(blob)` and then to `new Image()` + `img.decode()` (object URL revoked after). One scratch
canvas for all 15 PNGs, context `getContext('2d', {willReadFrequently: true})`, sized to the largest PNG; after the last
read it is shrunk to 1 × 1 (iOS keeps canvas backing stores alive otherwise). Mask planes are kept until the six skins
and kits are painted, then dropped (`lib.dispose` is not needed for that); only `setKit` needs nothing from them.

Time slicing: skin and kit painting run in slices of ≤ 8 ms (check `performance.now()` every 16 rows) and yield with
a `MessageChannel` post (never `setTimeout(0)`, which iOS clamps to ≥ 4 ms after 5 nested calls), so the loading bar
and its shimmer keep animating at ≥ 30 fps. Budgets per device: §7.6.

Progress mapping onto the global loader (§6.5.3): library fractions 0 → 0.70 (header, bins, PNG decode) fill the global
`assets` share (0.47, by bytes), 0.70 → 0.90 (skins) the `skin paint` share 0.18, 0.90 → 0.95 (kits) `kit paint` 0.04,
0.95 → 1.00 (`renderer.compile`) part of `environment + shader warm-up` 0.13.

### 3.4 Character assembly, dims, culling, dispose

- Hierarchy: `object` (Group) → `body` (Root bone child) + `kitMesh` + `groomMesh`, all `SkinnedMesh` bound to one
  `skeleton` with `body.bindMatrix`; `frustumCulled = false`, `matrixAutoUpdate = false` on the three meshes.
- **Body**: positions/normals expanded kept → render (`renderToKept`), shared `uv/skinIndex/skinWeight`; groups
  `[skin: body tris, wet: eyeballs + teeth + tongue]`; `morphAttributes.position` (Float32, render vertices),
  `morphTargetsRelative = true`, no morph normals. **One body `BufferGeometry` per character** (CRITIC): LOD and
  cover changes call `geometry.setIndex(cachedIndexAttribute)` and rewrite `geometry.groups` (`[skin start/count, wet
  start/count]`) instead of switching geometries. Reason: three.js r186 builds the morph `DataArrayTexture` per
  geometry (≈ 2.36 MB Float32 per player: 4,096 × 4 texels × 9 targets × 16 B), so separate LOD/covered geometries
  would allocate and upload a new 2.4 MB texture on the first switch to each LOD (frame hitch + up to 4× memory). The
  cached index attributes (per player × LOD × cover key, ref-counted) are the only per-LOD data; the PoC loader's
  "covered geometry copies only `attributes`" bug disappears with this rule. Covered triangles = union of cover lists
  of worn jersey, shorts, sock shell, accessory shells and `shoeCover_<cut>`.
- **Kit**: worn cloth shells (after `relaxShell`) + 2 sneakers → one geometry; UVs remapped into atlas rects (§3.8).
- **Groom**: per-player hair inner/outer, beard inner/outer, brows + shared lashes; index order inner layers first
  (LOD3 draws `setDrawRange(0, innerCount)`); attributes `groom` (vec3 family weights) and `groomDF` (vec2 density,
  fade); morph deltas propagated `d = lerp(D[a], D[b], t)`. Shell skin weights: t-blend of a/b, top 4, renormalised.
- `dims` (load time): `heightBarefoot` (1.96/1.96/2.03/2.09/2.27/1.87), `eyeY`, `headTopY`,
  `headCentreAboveHeadBone` (landmark `head` → eye centre y + 0.01), `shoulderJoints` (§2.2). (No collision radius, C3.)
- **Culling** (C19): `lib.beginFrame` builds one `Frustum`; `c.update()` tests a sphere centred at
  `(object.position.x, 0.55·heightBarefoot + jumpY, object.position.z)` (root position set by the game this frame;
  CRITIC: not the pelvis bone, whose `matrixWorld` goes stale while a culled character is evaluated at 15 Hz) with
  radius `0.85·heightBarefoot + 0.30` (covers arms overhead, a 0.9 m jump and ≤ 0.2 m pelvis offset from root
  motion; Yao 2.23, Kyrie 1.89 m); outside → `object.visible = c.visible = false` (animation keeps stepping, may skip
  `evaluate`). `jumpY` is read from `c.jumpY`, written by `player.js` each step. Zero allocation.
- **Dispose**: `c.dispose()` removes `object`, disposes character-owned geometries (ref-counted shared ones), skin & kit
  `DataTexture`s, the 4 materials, `skeleton.dispose()`. `lib.dispose()` disposes strand/eye/pore/mesh-normal textures
  and drops mask planes. B41: `renderer.info.memory` returns to the post-load value after 5 rematches + 5 lineup/kit
  changes + 3 replays.
- v1-compatible helpers: `handWorld(out, side)` = ANIM `palm_s` socket world position; `handsMidWorld(out)` midpoint of
  both `palm_s`; `headWorld(out)` = `eyeC` socket + (0, 0.02, −0.03) in head space; `headY()` = head bone world y +
  `dims.headCentreAboveHeadBone`.
- Presentation hooks: `createShadowProxy(material)` → extra `SkinnedMesh` on the **uncovered LOD3 index** with the
  same skeleton (`castShadow = true`, `receiveShadow = false`, `renderOrder 100`; body/kit/groom `castShadow =
  receiveShadow = false`); `setReflectable(on)` toggles layer 2 on body + kit; `lodOverride` (n | null) for replays /
  lineup / showcase; every texture registered via `quality.trackTexture`.

### 3.5 Skin

3.5.1 **Pipeline.** Masks are baked offline (WP1) by rasterising body triangles into UV space and evaluating scalar
fields of 3D position + normal per texel (seam-free; dilation 8 px at 1024², 4 px at 512²). At load (`skinPainter`)
each player's skin texture is composited per texel (masks sampled bilinearly if sizes differ), rows bottom-up (no flip):
`RGBAFormat`, `UnsignedByteType`, `colorSpace SRGBColorSpace` (alpha = linear roughness), mipmaps,
`LinearMipmapLinearFilter`, anisotropy 4 / 2 / 1 (high / medium / low).

| tier | skin texture | masks read at | memory / player |
|---|---|---|---|
| low | 512² (alpha unused, constant roughness) | 512 (downsampled) | 1.4 MB |
| medium | 1024² | native | 5.6 MB |
| high | 2048² non-touch, 1024² touch | native, bilinear ×2 | 22.4 MB |

Texel density at 1024² (MakeHuman layout, no repack): head 11.6 px/cm, neck 11.2, hands 6.6, torso 6.3, feet 5.4,
arms 5.2, legs 4.6.

3.5.2 **Landmarks and per-player frame**: [ref CHR:§2.2 Face landmarks] (obj indices, base positions, eye fissure
23.0 × 7.8 mm, frame `Gy`, `EC`, `headCZ`, azimuth φ, `CHx`). Indices are "initial picks"; WP1 checks them once on
`landmarks.png` and freezes them in `tools/legends/lib/landmarks.mjs`.

3.5.3 **Mask fields**: shared `skin0/1/2` [ref CHR:§2.3 Shared mask fields]; per-player `groom`/`extra`
[ref CHR:§2.4 Per-player masks] with the fields of §2.8 (hairline function [ref CHR:§4.4 Hairline function],
beard components [ref CHR:§5.1 Components], brows §2.8 table, tattoos §2.7).

3.5.4 **Composite** (per texel; sRGB 0..1; `look` values from §2.6; `h` = texel hash of integer coords, seed = player
index):
```
c = skin;  c *= 1 + 0.12·(mottle − 0.5);  c = mix(c, c·(1.12, 0.90, 0.86), redness·warmK);  c *= 1 − 0.30·ao
c *= 1 − cavityK·0.45·cavity;  c = c + (1 − c)·hlK·highlight;  c = mix(c, lips, 0.85·lipsMask)
c = mix(c, palms, 0.90·palmsMask);  c = mix(c, mix(palms, #f0d8d0, 0.4), 0.80·nails)
c = mix(c, hair, scalpDarken·hairDens);  c = mix(c, beard, beardSkinDarken·beardDens);  c = mix(c, hair, browDarken·browDens)
c = mix(c, desat(c, 0.3)·0.82, tattooK·tattoo)                       // desat(c,k) = mix(c, luma(c), k), luma 0.2126/0.7152/0.0722
c = mix(c, hair, 0.25·max(hairDens·stubbleHair, beardDens)·step(0.62, h))
rough = skinRoughness − 0.10·highlight − 0.15·lipsMask + 0.15·beardDens + 0.10·palmsMask
rough = mix(rough, 0.25, nails);  rough = mix(rough, scalpRoughness, gloss);  alpha = round(255·clamp(rough, 0.2, 0.9))
```
Low tier writes RGB only (alpha 255). Cost ≈ 40 ops/texel.

3.5.4a **Paint performance (CRITIC, measured).** A straight transcription of the formula above ran at 66 ms per
1024² skin in Node 22 on a 2.8 GHz Xeon VM (`scratchpad/critic/paintbench.mjs`); the optimised form below ran at
**11 / 27.5 / 107 ms** for 512² / 1024² / 2048² with realistic mask sparsity (`paintbench2.mjs`). The optimised form is
binding for `skinPainter.paintSkin`:
- one pass over texels, `Uint8Array` mask planes, output written straight into the `DataTexture`'s `Uint8Array`;
- per-player constants hoisted (colours as 0..1 floats, `warmK/255`, `hlK/255`, …); the multiplicative terms
  (mottle, AO, cavity) folded into one factor;
- every sparse term is skipped when its mask byte is 0: lips, palms, nails, hair/beard/brow (one combined branch
  `if (hd | bd | bw)`), tattoo, gloss; the stubble hash is `((x·73856093 ^ y·19349663) & 255) > 158` (= `step(0.62, h)`);
- no function calls, closures, `Math.*` or allocation inside the texel loop (inline clamps);
- masks of a smaller size are sampled with per-row precomputed bilinear weights (512 → 1024, 1024 → 2048).
Per-device budgets for the whole paint phase are in §7.6; `unit-skinpaint.mjs` asserts a 1024² paint of synthetic
sparse masks ≤ 90 ms in Node (3.3× the measured value, a regression guard, not a device claim).

3.5.5 **Skin materials**: low `MeshStandardMaterial({map, roughness: skinRoughness, metalness 0})`; medium Standard +
`roughness 1` + roughness-from-alpha patch + shared 256² pore normal map (value noise σ 1.2 px, 900 pores r 0.8–1.6 px
depth 0.5, `repeat (60, 60)`, `normalScale (0.15, 0.15)`); high `MeshPhysicalMaterial` + same maps + `sheen 0.25`,
`sheenColor #b0503c`, `sheenRoughness 0.8`, `clearcoatMap` (256², R = max(extra.G, extra.B)), `clearcoat =
max(glossBase, 0.30·sweat)`, `clearcoatRoughness` per §2.6. **Sweat** `s = min(1, minutesPlayed/8)` (`c.setSweat`,
called by the game each dead ball): medium/high `material.roughness = 1 − 0.15·s` (a multiplier on the alpha
roughness); low `material.roughness = skinRoughness·(1 − 0.15·s)` (low has no alpha roughness, CRITIC fix).

### 3.6 Eyes and mouth

- Eyes: hm08 8-segment eyeballs replaced at bake by UV spheres 24 × 16 (low: index range 12 × 8), centre = mean of the
  player's morphed `helper-*-eye` vertices, radius = max distance (base 15.0 mm); cornea: vertices within 24° of
  forward pushed out by `0.06·R·cos(π/2·θ/24°)`; skinned 100 % to `head`; group `wet`. UV = front disc
  `0.5 + (x − cx, y − cy)/(2R)`; iris radius 0.225 UV.
- Eye texture (shared; 128² / 256² / 512² low/medium/high; canvas, sRGB, ClampToEdge): sclera radial `#e9e2d8` (r 0) →
  `#d9c9bc` (0.38) → `#b99086` (0.5); 14 vessels `#b04a40` α 0.25 width 0.8 px@256, rim → 30 % inward (high only);
  iris `#2A1A12` with 120 radial fibres alternating `#5a3a26` / `#120a06` α 0.18; limbal ring = last 12 % of the iris
  radius `#0b0705`; pupil 0.40 × iris `#050302`; painted catchlight only on low (r 0.025 UV at (0.44, 0.58), white α
  0.85); texels with u, v < 0.06 pure `#e8e2d6`. No lid shadow painted.
- Gaze: per-character `eyeOffset` (vec2) uniform, clamped `|x| ≤ 0.12, |y| ≤ 0.09`, written by ANIM look (§4.6).
- Teeth (`helper-upper/lower-teeth` 96 + 96 tris) and tongue (448 tris) kept (`keepMouth: true`), UV u = 2.0, vertex
  colours teeth `#e9e3d4`, gums (≥ crown midline + 3 mm) `#a8504a`, tongue `#b0605a`.
- Wet material: medium Standard `{map: eyeTex, vertexColors, roughness 0.06, metalness 0}`; high Physical +
  `clearcoat 1.0, clearcoatRoughness 0.03`; low Lambert with the painted catchlight. Shader patch §3.10.

### 3.7 Groom (hair, beard, brows, lashes)

- One `groom` SkinnedMesh per player, one material, one shared **strand texture**; uniform `groomColor` = `look.hair`.
- Fragment (replaces `map_fragment`):
  ```glsl
  vec4 tx = texture2D(map, vMapUv);                // R straight, G coil, B stipple strand RANK; A shade
  float rk = dot(tx.rgb, vGroom.rgb);
  float a  = smoothstep(1.0 - vGroomDF.x - 0.04, 1.0 - vGroomDF.x + 0.04, rk) * vGroomDF.y;
  diffuseColor = vec4(groomColor * (0.70 + 0.60 * tx.a), a);
  ```
  medium/high `alphaHash = true`; low `alphaTest = 0.5`; `DoubleSide`, roughness 0.55, metalness 0; high
  `MeshPhysicalMaterial` + `sheen 0.3`, `sheenColor` per §2.6.
- Strand texture (512² medium, 256² low, 1024² high; counts/px × size/512; 4 canvases with `lighten`, tileable, packed
  into an RGBA `DataTexture`, RepeatWrapping, mipmaps, `NoColorSpace`; seed 20260101 mulberry32, ≈ 40 ms):
  R straight 2,400 strands (18–30 px long, 1.3–1.9 px wide, +v ± 10°, bend ± 3 px), G coil 2,800 (radius 2.5–4.5 px,
  sweep 280–340°, width 1.4–2.0 px, 10 % double spirals), B stipple 7,000 dots r 0.8–1.4 px + 3,000 strokes 3–5 px,
  A shade value noise cell 32 px, 2 octaves → 0.35–1.0; ranks uniform (0.02, 1].
- UV modes (bake): `head-metric` (u = φs/2π·Nu, Nu = round(head circumference at ET / 0.05) integer, v = θ·R_h/0.05;
  1 tile = 5 cm), `brow-local`, `lash-local` [ref CHR:§4.3 Groom UV modes]. Loader multiplies by header `uvScale`.
- Lashes: hm08 eyelash cards (88 + 96 tris per eye) as the shared `lashes` shell (density 0.9, fade 0), follow
  `blink`; medium/high only.
- Jordan: no hair shell; scalp gloss via `extra.G` (roughness 0.32; high clearcoat 0.55 / r 0.22). LeBron: headband
  covers Gy + 0.040 … + 0.090; hair visible above and on the sides.

### 3.8 Kits

- Atlas per player: 512² (low), 1024² (medium/high); canvas y down, `v = 1 − y/H`; rects (x0, y0, x1, y1 fractions):
  jersey (0, 0, 1, 0.50); shorts (0, 0.50, 1, 0.74); socks (0, 0.74, 0.50, 0.82); sleeve (0.50, 0.74, 0.75, 0.82);
  headband (0.75, 0.74, 1.0, 0.78); wristband (0.75, 0.78, 1.0, 0.82); finger tape (0, 0.82, 0.25, 0.84); swatches
  (0.25, 0.82, 1.0, 0.84); sneaker upper (0, 0.84, 0.75, 1.0); sole side wall (0.75, 0.84, 1.0, 0.92); sole bottom
  (0.75, 0.92, 1.0, 1.0). Gutters 8 px (4 at 512).
- `torso-ellipse` UV (bake): `θ = atan2(x/0.135, (z − 0.065)/0.095)` on base.obj, `u = frac(θ/2π + 0.75)` (front centre
  u 0.75, back 0.25, seam at u 0 ≡ 1 under the left side stripe); local v per shell (jersey y **0.103** … 0.599 —
  tucked, see below — shorts −0.314 … 0.168 base metres); painter uses the header `perimeter` table (8 heights) and
  `kitScaleV = (spine_03.y − pelvis.y)_player / (spine_03.y − pelvis.y)_base`; anything crossing u 0/1 is drawn twice.
- Painter order (canvas 2D → `getImageData` → `DataTexture`, rgb albedo, a = roughness from a parallel grey canvas):
  1 base fill (roughness jersey 0.78, shorts 0.72, socks 0.90, sleeve 0.45, headband/wristband 0.95, tape 0.70);
  2 folds: shorts 6 per leg (2–4 cm, ±8 % luminance, seeded), jersey 2 under each armhole (±6 %); 3 side panels /
  stripes (shorts at u 0.5 and 0/1); 4 trims along baked boundary loops (`neck`, `armhole_l/r`, `hem`, `waist`,
  `leg_l/r`, `cuff`), band lists edge → in, stroked at 2× cumulative width in descending order; 5 numbers, name,
  Jordan shorts number; 6 roughness numbers/letters 0.60, trims 0.70. Medium/high: shared 128² "dazzle mesh" normal
  map (hex holes 2 mm, depth 0.4) `repeat (90, 90)`, `normalScale (0.35, 0.35)` on jersey/shorts.
- **Glyphs** (vector, no font): 4 × 8 grid, `lineWidth 1.6 u`, `lineCap 'square'`, `lineJoin 'miter'` (`block`) or
  `'round'` (`rounded`, Kobe); layers keyline (Yao, +2·0.50 u, #000000) → outline (+2·0.45 u) → fill. Strokes:
  0 `M0,0 L4,0 L4,8 L0,8 Z`; 1 `M1,1.2 L2.2,0 L2.2,8` (serif adds `M0.8,8 L3.6,8`); 2 `M0,0 L4,0 L4,4 L0,4 L0,8 L4,8`;
  3 `M0,0 L4,0 L4,8 L0,8 ; M1.2,4 L4,4`; 4 `M0,0 L0,5 L4,5 ; M3,0 L3,8`; 5 `M4,0 L0,0 L0,4 L4,4 L4,8 L0,8`;
  6 `M4,0 L0,0 L0,8 L4,8 L4,4 L0,4`; 7 `M0,0 L4,0 L1.6,8`; 8 `M0,0 L4,0 L4,8 L0,8 Z ; M0,4 L4,4`;
  9 `M4,4 L0,4 L0,0 L4,0 L4,8 L0,8`. Advance 6.8 u ('1' 4.6 u), height incl. strokes 9.6 u. Number heights: front
  0.20 m (centre y 0.334 base), back 0.28 m (centre 0.315 base), × `kitScaleV`.
- **Name**: `800 <px>px "Arial Narrow","Roboto Condensed","Helvetica Neue",Arial,sans-serif`, cap height 0.065 m,
  centre y 0.475 base, max width 0.30 m (scaleX squeeze), arched with 0.015 m sag, number colour, no outline.
- **Sneakers** (`sneaker.js`, procedural, rigid to `foot_*`/`ball_*`): [ref CHR:§7.6 Sneakers] — outline Catmull-Rom
  (Wh = widthHeel + 0.012, Wb = widthBall + 0.014), outsole bottom y = 0 (toe spring +0.012 beyond s 0.85), outsole top
  0.006, midsole top 0.026 → 0.020, collar heights low 0.085 / low-mid 0.100 / mid-high 0.125 / high 0.145, N = 22 / 12
  stations (≈ 970 / 320 tris per shoe), skin s < sBall − 0.06 foot, > sBall + 0.03 ball, high/mid-high collars foot 0.75 +
  calf 0.25; `shoeCover_<cut>` removes body vertices below `Hc − 0.012`. **No sole lift**: the floor stays at y = 0 for
  ANIM's foot IK. Roughness leather 0.45, mesh 0.75, rubber 0.85.
- `c.setKit({mode})` repaints in place (`texture.image.data` overwritten, `needsUpdate`), ≤ 15 ms at medium,
  including shoe and accessory colours.
- **Tucked jersey** (CRITIC; every profile says "tucked in" and the PoC shows a jersey/shorts slit when twisting):
  `lib/shells.mjs` jersey region hem moves from `pelvisY − 0.15` to `pelvisY + 0.03` (base y 0.103), i.e. 5.5 cm
  inside the shorts (shorts top stays `pelvisY + 0.085`); jersey `offsetScale g(y) = 1 + 1.0·smooth(armpitY − 0.05,
  pelvisY + 0.14, y)` for y ≥ pelvisY + 0.14 (≤ 14 mm "blouse" over the waistband) and `g = 1` (7 mm) for
  y ≤ pelvisY + 0.10, linear in between; shorts waist offset stays 10 mm, so the shorts always enclose the jersey by
  ≥ 3 mm; jersey `relaxShell` is pinned (no outward push) below pelvisY + 0.10. Viewer check (B44 frames + showcase
  `view=turn`): no visible gap between jersey and shorts at spine yaw ±30° and hip flex 95°.
- **Cloth faces**: the kit material is `side: DoubleSide` (armholes, neck and hem openings would otherwise show the
  background through culled back faces, because covered body triangles are removed); back faces darken albedo × 0.55
  (patch: `if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;` after `map_fragment`). Sneakers are closed meshes and pay
  nothing visible for it. Kit triangle counts are unchanged; fragment cost is limited to the openings.

### 3.9 Expressions (morph channels; order = `Pose.expr`)

| # | name | players baked | recipe (deltas from the player's neutral) | attack / release (s) |
|---|---|---|---|---|
| 0 | `jawOpen` | all | jaw rotation 18° about the per-player jaw pivot (`joint-mouth`), x axis, field `wJ` | 0.08 / 0.15 |
| 1 | `tongueOut` | jordan | jaw 11° + tongue `(+0.005, −0.010, +0.030)·wT` | 0.10 / 0.12 |
| 2 | `jawJut` | kobe | `chin-prognathism +1, mouth-lowerlip-ext +0.4, mouth-lowerlip-volume +0.3` + jaw translate `(0, +0.002, +0.008)·wJ` | 0.15 / 0.30 |
| 3 | `roar` | lebron, giannis, yao | jaw 22° + `mouth-upperlip-ext +1.0, nose-flaring +0.6, nose-nostrils-width +0.3, mouth-scale-horiz +0.25, mouth-laugh-lines +0.6, eyebrows-trans-down-up −0.8` (Giannis brows −0.4) | 0.10 / 0.25 |
| 4 | `grin` | yao, giannis | jaw 6° + `mouth-angles-down-up +1.0, mouth-scale-horiz +0.45, mouth-laugh-lines +0.8, cheek-trans-down-up +0.5, cheek-volume +0.3, mouth-dimples-in-out +0.3, eye-height2 −0.5` (Yao eye-height1/2/3 −0.7) | 0.20 / 0.30 |
| 5 | `smirk` | kyrie, jordan | `asym-mouth-1-l-r +0.4, mouth-angles-down-up +0.15, cheek-trans-down-up +0.15` | 0.20 / 0.40 |
| 6 | `scowl` | all | `eyebrows-trans-down-up −1.0, eyebrows-angle-down-up −0.6, eye-height1 −0.4, eye-height2 −0.5, eye-height3 −0.4, eye-bag +0.3, cheek-trans-down-up +0.2` | 0.15 / 0.30 |
| 7 | `puff` | yao, lebron | `cheek-volume +1.0, cheek-inner +1.0, mouth-scale-horiz −0.2, mouth-trans-backward-forward +0.2` | 0.10 / 0.20 |
| 8 | `blink` | all | procedural lid rotation [ref CHR:§8.3 Blink] (≈ 34°), lashes included | 0.05 / 0.07 |

Jaw field `wJ` [ref CHR:§8.2 Jaw field]; old config `chin-jaw-drop` shape modifiers are replaced by the rotation.
Storage sparse: count, kept indices u16, Δ i16 × 0.02 mm, |Δ| < 0.05 mm dropped (≈ 1,500 verts per target, ≤ 75 KB per
player). Loader expands to Float32 render arrays, shells get `lerp(Δa, Δb, t)`. **Low tier: no morph targets**
(channels no-op; the code checks `morphTargetDictionary`).

### 3.10 Materials, draw calls, triangles, LOD, shader patches

| per player | low | medium | high |
|---|---|---|---|
| draw calls (main pass) | 4 (body skin, body wet, kit, groom) | 4 | 4 (+1 for Kyrie's mouthguard while visible) |
| + shadow proxy | — (blobs) | 1 main (colorWrite off) + 1 shadow pass | same |
| body LOD in play / menus / replays | 3 / 2 / 2 nearest LOD1, others 3 (§6.4.6) | 2 (≥ 300 px → 1) / 0–1 / 2 nearest LOD0, others 1 | 1 (≥ 640 px → 0) / 0 / LOD0 within 7 m, others 1 |
| body tris (LOD0/1/2/3 = 27,036 / 13,658 / 6,968 / 3,490, minus ≈ 5 % covered) | ≈ 3.3k | ≈ 6.6k | ≈ 13.0k |
| wet tris | 340 (12×8 eyes, no mouth) | 2,080 | 2,080 |
| kit tris (jersey 1,518, shorts 1,000, socks ≈ 360, accessories 0–1,100, sneakers 2 × 970) | ≈ 2.1k (shell LOD1, sneakers 2 × 320) | ≈ 4.8–5.9k | ≈ 4.8–5.9k |
| groom tris | ≈ 0.6k (inner LOD1, no lashes) | 1.1k (Jordan) – 3.7k (LeBron) | same |
| total per player / six (play) | ≈ 6.4k / 38k | ≈ 15k / 92k | ≈ 22k / 135k |
| skin / kit / strand / eye textures | 512 / 512 / 256 / 128 | 1024 / 1024 / 512 / 256 | 2048 (touch 1024) / 1024 / 1024 / 512 |
| GPU texture memory, six | ≈ 17 MB | ≈ 70 MB + morph textures ≈ 10 MB | ≈ 190 MB desktop (≈ 120 touch) |
| morph targets | none | yes | yes |
| skin / kit (`DoubleSide`, §3.8) / groom / wet material | Standard map / Lambert map / Standard alphaTest 0.5 / Lambert + catchlight | Standard + rough(α) + pore normal / Standard + rough(α) + mesh normal / Standard alphaHash / Standard r 0.06 | Physical sheen + clearcoat / same as medium / Physical + sheen, alphaHash / Physical clearcoat 1 |

**LOD selection**: `hpx = heightBarefoot · viewportHeightPx / (2·d·tan(fov/2))` (d = view depth of the pelvis);
LOD0 ≥ 640 px, LOD1 ≥ 300, LOD2 ≥ 110, else LOD3; hysteresis ±12 %; clamped per tier (table) unless `lodOverride`.
Kit uses shell LOD1 + low sneakers and groom draws inner layers only when body LOD = 3. LOD3 never for portraits.

**Patches** (`onBeforeCompile`; `customProgramCacheKey()` returns the patch id so the six players share programs):
- roughness from map alpha (skin, kit; medium/high): after `#include <map_fragment>` insert
  `float mapRough = sampledDiffuseColor.a; diffuseColor.a = opacity;`; replace `#include <roughnessmap_fragment>` with
  `float roughnessFactor = roughness * mapRough;`.
- groom: vertex `attribute vec3 groom; attribute vec2 groomDF; varying vec3 vGroom; varying vec2 vGroomDF;` set after
  `#include <begin_vertex>`; fragment replaces `#include <map_fragment>` with §3.7's block; uniform `groomColor`.
- wet: replace `#include <map_fragment>` with `vec2 euv = vMapUv.x < 1.0 ? vMapUv + eyeOffset : vec2(0.03); vec4
  sampledDiffuseColor = texture2D(map, euv); diffuseColor *= sampledDiffuseColor;` (+ vertex colours); uniform
  `eyeOffset`.
- kit (all tiers): after `#include <map_fragment>` insert `if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;` (cloth
  interior, §3.8); same patch id for all players.
- WebGL program count after six players = the 4 character programs (+ proxy; + 1 mouthguard program on high) + other
  game programs (does not grow with players; B56).

---
## 4. Animation (WP3) [ANIM]

Decisions D-ANIM-1…10 of ANIM §0 stand, with C1, C2, C4–C8, C12–C14, C19, C21, C22 applied.

### 4.1 Rig and conventions

- 53-bone game-engine rig, header order [ref ANIM:§1.1 Bones]; no jaw/eye/tongue bones (mouth = morphs, eyes = iris
  UV offset). `rig.js` builds `BONE` from `header.bones` and asserts it equals the table; `MIRROR` Int8Array(53).
- Character frame: `object` at `(pos.x, 0, pos.z)`, `rotation.y = yaw`; +x = character's left, +y up, +z forward;
  `Root` identity; vertical motion = pelvis translation; pelvis local = rest + clip `P.dx/dy/dz`·sLeg + `(0, jumpY, 0)`.
- Authoring channels (degrees, per-side anatomical signs, mirroring = swap `_l/_r` + negate axial yaw/roll, root x,
  root yaw): [ref ANIM:§1.3 Anatomical channels]. Anatomical → bone quaternion `Lb = PREb · Qb · POSTb` with per-player
  frames F_ua, F_la, F_h built from bind joints: [ref ANIM:§1.4 From anatomical angles to bone quaternions (exact)]
  (pronation split 40 % forearm / 60 % hand; scapulohumeral rhythm `elevAuto = 0.22·max(0, armElev − 60°)`, ≤ 26°).
- Joint limits (clamp after blending and IK) [ref ANIM:§1.7 Joint limits]; hip flex > 95° only while airborne.

Per-player metrics (`rig.metrics`, from the header; `sLeg` scales every authored metre offset):

| id | height | hip joint y (`hipH`) | thigh + calf | **sLeg** | shoulder y | arm (upper+lower) | hand | ankle y | `reach0` (palm, no shrug) | `reachAug` (+0.07 shrug +0.05 side-bend) |
|---|---|---|---|---|---|---|---|---|---|---|
| kobe | 1.96 | 1.077 | 0.488 + 0.511 | 1.000 | 1.573 | 0.599 | 0.232 | 0.085 | 2.31 | 2.43 |
| jordan | 1.96 | 1.074 | 0.484 + 0.515 | 0.999 | 1.570 | 0.584 | 0.245 | 0.083 | 2.30 | 2.42 |
| lebron | 2.03 | 1.109 | 0.513 + 0.516 | 1.030 | 1.646 | 0.583 | 0.238 | 0.087 | 2.37 | 2.49 |
| giannis | 2.09 | 1.190 | 0.546 + 0.561 | 1.108 | 1.691 | 0.616 | 0.252 | 0.091 | 2.46 | 2.58 |
| yao | 2.27 | 1.256 | 0.651 + 0.519 | 1.171 | 1.841 | 0.626 | 0.262 | 0.093 | 2.62 | 2.74 |
| kyrie | 1.87 | 1.013 | 0.463 + 0.477 | 0.941 | 1.500 | 0.543 | 0.212 | 0.081 | 2.17 | 2.29 |

Sockets (local offsets computed once at load; world = `bone.matrixWorld · offset`):

| socket | parent | definition (bind world) |
|---|---|---|
| `palm_s` | hand_s | `W + 0.55·(M − W) + 0.012·Z_h` |
| `ball1_s` | hand_s | `palm_s + (0.12 + 0.010)·Z_h − 0.015·Y_h` |
| `tip_s` | middle_03_s | `middle_03.tail` |
| `rimHook_s` | hand_s | `W + 0.80·(M − W) + 0.025·Z_h` |
| `heel_s` / `toe_s` / `ankle_s` / `ballJ_s` | foot / ball | `(ankle.x, 0, ankle.z − 0.06·sLeg)` / `ball.tail` at y 0.01 / foot head / ball joint |
| `eyeC` / `chin` | head | mean of l/r-eye landmarks / `jaw` landmark |

### 4.2 Runtime architecture

- Files: §1.2 (`src/anim/*`). Clip format and DSL: [ref ANIM:§2.2 Clip format] (keys `P S N RC LC RA LA RL LL RF LF
  Rft Lft B Bp E R look`, `_` = unkeyed, first/last key complete). Compilation: monotone cubic Hermite per scalar,
  clamp to limits, dense 30 Hz anatomical quaternion tracks shared by all players, step tracks for ball mode / finger
  preset / feet; events coded `GATHER 1, PLANT_L 2, PLANT_R 3, TAKEOFF 4, SET 5, RELEASE 6, APEX 7, CONTACT 8, SLAM 9,
  RIM_GRAB 10, RIM_RELEASE 11, LAND 12, CATCH 13, BOUNCE 14, HAND_ON 15, PICKUP 16, SWIPE 17, READY 18, END 19,
  HANDOFF 20, STEP 21, SLOWMO_IN 22, SLOWMO_OUT 23, FX 24, FAKE 25` (FAKE added for `fake` events). Mirror `_L`
  twins built before compiling. All clips referenced by the six players' tables are pre-compiled in the loading
  "compile" phase (target < 40 ms for ≈ 170 clip-seconds; ≈ 2.3 MB shared Float32Arrays). Sampling: `f = t·30`, nlerp
  with hemisphere check, linear pelvis/root/ball path, no search, no allocation.
- Generators `makeJumper/makeLayup/makeDunk` run once per player at load; per-player overrides via `per: {id: …}`.
- `Animator` API: §1.4. Six preallocated `Pose`s per animator (base, action, upper, scratch ×2, fadeSnapshot); event
  ring of 32; string ids resolved to ints at load; bones `matrixAutoUpdate = false`, `matrix.compose` with module
  scratch, one `group.updateMatrixWorld(true)` then IK sub-tree updates (H10).

### 4.3 Layers, crossfades, masks

Layers per player (render frame order): 0 base (gait or stance/idle), 1 action (override × per-bone mask × weight),
2 upper (upper mask over locomotion), 3 additive (`q = qAdd·q`: lean, breathing, aim twist, swat/flinch, nods),
4 procedural (look-at, foot locks, hand IK), 5 face (morph weights + blink). Only tracked bones override.

Fade curves: entry into actions ease-out `w = 1 − (1 − u)³`; exits and loco↔loco smoothstep; interrupted fades
start from a snapshot of the current blended pose.

| transition | s | transition | s |
|---|---|---|---|
| loco → shot / pull-up / fade | 0.06 | any → catch | 0.06 |
| loco → layup / dunk gather | 0.08 / 0.10 | chained action → action | 0.06 (0.04 with `chain: true`) |
| loco → block / contest / rebound jump | 0.05 | action → loco (default) | 0.20 (0.12 after dribble moves, 0.30 after celebrations) |
| loco → dribble move | 0.06 | gameplay interruption (stun, steal, loose ball, whistle) | 0.10 |
| loco → pass (upper) | 0.06 | reset / teleport (CHECK, rematch) | 0.20 crossfade + re-plant + settle steps (**never a snap**, R#37) |
| loco → steal swipe | 0.04 | stance ↔ upright on offence/defence switch | 0.25 |

| mask | pelvis | spine_01 | spine_02 | spine_03 | neck/head | clavicles, arms, hands, fingers | legs | root/pelvis offsets |
|---|---|---|---|---|---|---|---|---|
| full | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| upper | 0 | 0.35 | 0.75 | 1 | 1 | 1 | 0 | 0 |
| arms | 0 | 0 | 0 | 0.25 | 0 | 1 | 0 | 0 |
| armR / armL | 0 | 0 | 0 | 0.15 | 0 | that side 1 | 0 | 0 |
| legs | 1 | 0.25 | 0 | 0 | 0 | 0 | 1 | 1 |
| face | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### 4.4 Timing: clock, warp, root motion, target matching, jumps

- **Clock**: clip time advances in `Animator.step(dt)` inside `Player.step` (60 Hz); crossed events are appended with
  exact game time; `game.js` consumes them in the same step. Render evaluates at
  `prevClipTime + alpha·(clipTime − prevClipTime)`.
- **Warp**: monotone piecewise-linear map from game time since `play` to clip time from anchor pairs; anchor rates
  clamped to [0.4, 2.5] (outside → select another clip); anchors updatable while playing (rebuilt from the current
  point, never backwards); `hold(ev)` freezes at an event until `releaseNow()` or timeout. After the last anchor the
  clip runs at `1/tempo`.
- **Root motion** (`root:'motion'`): per step `dR = R(t_new) − R(t_old)` (clip-start frame, × sLeg) → `vDes =
  rotateY(ψ0, dR.xz)/dt`; entry `replace`: `vel = vDes`; `carry`: `vDes + vIn·exp(−(t − t0)/0.25)`; `stop`: `vDes + vIn·
  max(0, 1 − entryDecel·(t − t0)/|vIn|)` until takeoff, then constant. `yaw += dR.yaw`; v1 auto-yaw suspended while
  active. Collisions, separation and court clamps still apply (sim authoritative).
- **Target matching** (`target` event + `play(…, {target})`): `R'(t) = R(t) + Δ·smoothstep(t/tTarget)`, |Δ| ≤ 35 % of the
  clip's displacement to `tTarget` (min 0.25 m), |Δyaw| ≤ 25°; otherwise select another clip. This defines every press
  window (`params.gatherWindow`) of §4.12.
- **Jumps**: gameplay owns `jumpY`. Every jumping clip has `takeoff` and `land`; gameplay starts the ballistic jump
  **at the `TAKEOFF` event** with height `h` (§4.9 FORMS / layup / dunk tables, GP `hJump` for defence, C8) and
  gravity `g·gScale` (gScale 1, Jordan generic layups/dunks 0.80, FT-line dunk 0.70): `vy = sqrt(2·g'·h)`, airtime
  `T = 2·sqrt(2h/g')`; the animator warps `[takeoff, land]` to `T` (`setJump(h, T)`), ignores authored pelvis `dy`
  inside the segment and adds `jumpY`. Dunks use rise–hang–drop (§4.9.5). `LAND` fires when `jumpY` returns to 0;
  landing knee add `clamp(8°·|vy_land|, 20°, 60°)`.
- **Socket queries in the step** (`querySocket`): FK of the socket chain only (pelvis → spine ×3 → clavicle → upper
  arm → forearm → hand, + jumpY + root), two-hand closure when the ball mode is `both`; ≈ 2 µs. Used for held ball,
  shot/pass/dunk launch, block/contest hand, catch hand, steal hand.

### 4.5 Ball attachment and release

| mode | ball centre (sim and render) | hands |
|---|---|---|
| `R` / `L` | `ball1_s` of that hand | other hand FK |
| `both` | midpoint of both `ball1_s`; each hand IK-corrected to it when error < 0.15 m (weight → 0 at 0.25 m) | both |
| `drib` | procedural dribble path (§4.8) | dribble hand IK to the ball top during contact |
| `path` | authored `Bp` Catmull-Rom; `HAND_ON` snaps hand IK | IK during contact windows |
| `free` | physics (`ball.js`) | — |
| `keep` | unchanged | — |

Release: at a clip `RELEASE` (passes, layups, hooks, floaters), `SLAM` (dunks) or **release input + 0.050 s** (jump
shots) the animator emits the event with the socket world position of that step; `game.js` calls
`ball.launch(v, state, info)` from exactly that point (no pop). While attached, the **rendered** ball = the rendered
socket after IK; the sim ball = the step query (≤ one step apart). Catch: `ball.attachTo` → `animator.onCatch(mode)` →
catch clip; `CATCH`, then `READY` at +0.30 s.

### 4.6 Procedural layers

- **Lean** (additive): `aF = dot(accel, forward)`, `aC = speed·yawRate`; `leanPitch = clamp(1.6°·aF, −8°, +12°)` +
  gait trunk lean; `leanRoll = clamp(1.3°·aC, −14°, +14°)`; critically damped spring ω = 8 rad/s; pelvis 40 % /
  spine 60 %; accel = finite difference over 3 steps; off (0.1 s fade) in airborne clips and celebrations.
- **Breathing** (additive): `b = sin(2πft)`, `f = 0.25 + 0.30·(1 − stamina)` Hz, `m = 1 + 1.5·(1 − stamina)`:
  spine_03 pitch −1.2°·m·b, clavicle elev +1.0°·m·b, neck pitch +0.6°·m·b; weight 1 idle / 0.4 moving / 0 actions;
  "deep breath" habit ×2.5 for one 3 s cycle.
- **Look-at**: origin `eyeC`, yaw ±80° (excess beyond 70° → spine_03 up to 12° when the base is loco/idle), pitch −40°
  (up) … +30°; neck 40 % / head 60 %; spring ω 12 rad/s, ≤ 400°/s; weight 1 loco, 0.5 shots, 0 when `look:'none'`.
  Iris: `eyeOffset.x = clamp(remYaw/35°, −1, 1)·0.10`, `.y = clamp(remPitch/30°, −1, 1)·0.07`, spring ω 30; idle saccade
  every 0.6–2.2 s (cosmetic RNG) ±0.02 UV for 0.15 s. Defaults by role [ref ANIM:§10.2 Look-at defaults].
- **Two-bone IK**, pole hints, uses table and foot locking (lock, auto-release when leg > 0.995·(thigh+calf) + 0.10 or
  hip–lock horizontal > 0.75·legLen, catch-up step 0.18 s / arc 0.06·sLeg, toe pivots): [ref ANIM:§2.6.4 Two-bone IK
  (analytic, `ik.js`)] and [ref ANIM:§2.6.5 Foot locking (anti-slide)]. Reachable targets within 1 mm.
- **Finger presets** `relax, grip, shoot, snap, spread, palmUp, fist, point, claw, shh, flat, curlTape`:
  [ref ANIM:§2.7 Finger presets]; automatic `grip` when a hand's `ball1` is within 0.18 m of an owned ball (0.06 s).
- **Face**: weights smoothed with §3.9 attack/release; blink every `2.5 + 3.0·rng` s (cosmetic), 0.12 s, suppressed
  while `roar`/`grin` > 0.5; idle baselines §2.6.

### 4.7 Locomotion (procedural gait, `locomotion.js`)

Gait by speed: idle < 0.25; walk 0.25–2.0; walk→run blend 2.0–2.4; jog 2.4–4.0; run 4.0–5.8; sprint > 5.8 m/s.
Direction `θ = angle(v) − ψ`: forward ≤ 50°, side 50–130°, back ≥ 130°, 20° cross-fades.

| parameter (× sLeg for lengths) | 0.25 | 1.4 | 2.0 | 3.2 | 5.2 | 7.0 | 9.0 m/s |
|---|---|---|---|---|---|---|---|
| duty factor β | 0.66 | 0.62 | 0.58 | 0.42 | 0.36 | 0.30 | 0.27 |
| swing height (m) | 0.04 | 0.08 | 0.10 | 0.16 | 0.24 | 0.30 | 0.32 |
| pelvis base drop (m) | 0.00 | 0.01 | 0.02 | 0.04 | 0.06 | 0.07 | 0.08 |
| bob amplitude (m) | 0.010 | 0.025 | 0.025 | 0.045 | 0.050 | 0.045 | 0.040 |
| pelvis yaw / roll amp (deg) | 2 / 2 | 5 / 4 | 6 / 4 | 7 / 3 | 8 / 3 | 9 / 2 | 9 / 2 |
| lateral sway (m) | 0.010 | 0.020 | 0.018 | 0.012 | 0.010 | 0.008 | 0.006 |
| trunk lean `2 + 2.3·v` (cap 20) | 2.6 | 5.2 | 6.6 | 9.4 | 14.0 | 18.1 | 20 |
| arm swing amp / bias (shoulder flex deg) | 6 / 0 | 18 / 0 | 22 / 2 | 35 / 5 | 50 / 8 | 60 / 10 | 62 / 10 |
| elbow base / amp | 12/4 | 15/10 | 25/12 | 75/12 | 85/15 | 90/15 | 92/15 |
| arm abduction | 10 | 10 | 11 | 12 | 12 | 10 | 10 |
| foot pitch at strike / toe-off (deg) | −8 / 10 | −12 / 20 | −10 / 22 | −5 / 25 | +5 / 30 | +12 / 35 | +15 / 38 |
| lock mode in stance | flat | flat→toe 60 % | flat→toe 60 % | flat→toe 45 % | toe | toe | toe |

Stride (two steps) `λ = 2.3·hipH·(v²/(g·hipH))^0.3·STYLE.stride`; cadence `2v/λ`; first two steps after idle: length ×
0.6, cadence × 1.15. Foot placement, swing Bézier, pelvis/spine/arm/head formulas: [ref ANIM:§3.3 Foot placement and
swing]. Resulting step length / cadence (binding ±3 % in unit tests):

| player | walk 1.4 | jog 3.2 | run 5.2 | sprint 7.0 (step m / steps·s⁻¹) |
|---|---|---|---|---|
| kobe | 0.75 / 1.87 | 1.23 / 2.61 | 1.64 / 3.17 | 1.96 / 3.57 |
| jordan | 0.75 / 1.87 | 1.22 / 2.61 | 1.64 / 3.17 | 1.96 / 3.57 |
| lebron | 0.76 / 1.84 | 1.25 / 2.56 | 1.68 / 3.10 | 2.00 / 3.49 |
| giannis | 0.85 / 1.65 | 1.39 / 2.29 | 1.87 / 2.79 | 2.23 / 3.14 |
| yao | 0.77 / 1.83 | 1.26 / 2.55 | 1.68 / 3.09 | 2.01 / 3.48 |
| kyrie | 0.69 / 2.04 | 1.13 / 2.84 | 1.51 / 3.44 | 1.80 / 3.88 |

**Facing rules** (gameplay `Player.yaw`; rate = `attrs.turn`, C21): ball handler speed > 1.5 → velocity; ≤ 1.5 → rim
if within 9 m else velocity; off-ball offence speed > 2.5 → velocity, slower → ball; on-ball defender with the man
within 3.5 m and speed < 4.2 → the man (AI-delayed position); off-ball defender speed < 3.0 → ball; otherwise
velocity; root-motion clip → the clip.

**Backpedal / side gaits / defensive slide**: [ref ANIM:§3.5 Directional gaits and facing] (slide: `dc = clamp(0.30 +
0.12·v, 0.30, 0.75)·sLeg·STYLE.slide`, rate `v/dc`, double support 50 %, feet ≥ 0.25 m apart, toe-locked ank +8;
over 4.2 m/s or 1.2 s above 3.5 m/s → open hips and run). Idle shifts, settle steps, turn in place, starts, hard
stops, plant-foot cuts, teleport handling: [ref ANIM:§3.7 Idle, starts, stops, cuts, turns]. Stances (`stand`,
`tripleThreat`, `postUp`, `postSeal`, `boxOut`, per-player `def`): [ref ANIM:§3.8 Stances].

**STYLE** (per player):

| parameter | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| tempo (non-air action segments; > 1 slower) | 1.00 | 0.97 | 1.02 | 1.05 | 1.12 | 0.92 |
| stride × | 1.00 | 1.00 | 1.00 | 1.06 | 0.92 | 0.96 |
| trunk lean add (deg) | 0 | +1 | +2 | +1 | −4 | +1 |
| arm swing × / elbow add / arm abd add | 1.00 / 0 / 0 | 1.05 / 0 / 0 | 1.10 / 0 / +4 | 1.05 / 0 / +2 | 0.65 / +10 / +8 | 0.95 / −5 / 0 |
| bob × | 1.00 | 1.00 | 0.90 | 1.10 | 0.80 | 1.25 |
| shoulder sway (spine roll amp deg) | 1.5 | 1.5 | 2.0 | 2.0 | 4.0 | 1.5 |
| head carry (neck pitch add) | +5 | 0 | −3 | 0 | 0 | 0 |
| slide dc × | 1.00 | 1.05 | 0.95 | 1.10 | 0.80 | 1.00 |
| idle toe-bounce | — | — | — | 2.0 Hz ank ±4° | — | 1.6 Hz ank ±3° |
| dribble yTop × / f × / push × | 1/1/1 | 1/1/1 | 0.95/1/1.15 | 1/0.95/1.3 | 1.15/0.85/0.9 | 0.90/1.10/1 |

### 4.8 Ball handling

**Dribble** (`dribble.js`, phase ψd ∈ [0,1), period 1/f): release at 0, floor bounce at `a = 0.294` (`BOUNCE` →
`audio.bounce`), hand meets the ball at `c = 0.70`, contact window [0.70, 1.00) (top at 0.82). Exact vertical
kinematics `yr = yTop − 0.12`, `yc = yTop − 0.06`, R 0.12, `w = (yr − R − ½g·td²)/td`, `u = (yc − R + ½g·tu²)/tu`
(still mode, ref body: f 1.9 → w 3.8 m/s down, u 4.65 up). Horizontal: linear release → bounce point
`B = predictedRoot(t_bounce) + R(ψ)·(side·bx, bz)·sLeg`, then → predicted hand.

| mode | condition | f (Hz) | yTop (m × sLeg) | bounce (bx, bz) | hand rest (hx, hz) | arm FK between contacts |
|---|---|---|---|---|---|---|
| still | speed < 0.5 | 1.9 | 0.95 | (0.32, 0.22) | (0.30, 0.20) | `[25,15,15,65,90,10,0]` |
| protect | speed < 2.5 and a defender within 1.0 m in front | 2.8 | 0.62 | (0.42, 0.02) | (0.38, 0.02) | `[15,25,10,55,90,15,0]`; off arm bar `[60,45,40,90,20,0,0]` |
| walk | 0.5–2.4 | 1 per step, 1.6–2.2 | 0.92 | (0.30, 0.35 + 0.10·v) | (0.28, 0.25) | as still |
| jog | 2.4–4.0 | 1 per step, 2.2–2.8 | 0.88 | (0.28, 0.45 + 0.08·v) | (0.26, 0.30) | `[30,14,15,70,90,10,0]` |
| run | 4.0–5.8 | 1 per 2 steps, 1.5–1.8 | 0.95 | (0.24, 0.70 + 0.08·v) | (0.24, 0.40) | `[35,12,15,60,90,15,0]` |
| speed | > 5.8 | 1 per 2 steps, 1.7–1.95 | 1.00 | (0.22, 1.25) | (0.22, 0.45) | `[45,10,15,45,90,20,0]` |
| backdown | post | 1.6 | 0.70 | (0.35, −0.10) | (0.33, −0.05) | `[10,25,10,70,90,10,0]`; off arm `[45,30,−10,80,40,0,0]` |

Mode changes only while the ball is in the hand; release locked to the strike of the foot opposite the dribble hand
(PLL `ψd' = f + 2.0·wrap½(target − ψd)`). `lowWindow = ballY < 0.45` (GP `exposed`). Pickup: ψd ∈ [0.60, 1) → next
contact (≤ 0.12 s); else remaining path × 2 speed; other hand joins in 0.08 s; the body part of the requested action
starts at the input.

**Dribble moves** (`root:'motion'`, `B:'path'`, authored R→L, mirrored; keys [ref ANIM:§4.2 Dribble moves]):

| clip | dur (s) | entry | steal immunity (GP) | exitV (start frame m/s) | notes |
|---|---|---|---|---|---|
| `move.cross` | 0.40 | replace | [0.05, 0.30] | (2.6, 3.0) | cancel 0.30 |
| `move.btl` | 0.36 | carry | [0.05, 0.28] | — | left foot forward |
| `move.btb` | 0.38 | carry | [0.06, 0.30] | — | lateral 0.35 |
| `move.hesi` | 0.45 | carry (speed × 0.40 at 0.05–0.22, × 1.25 from 0.26) | — | — | rise +0.06, drop −0.10 |
| `move.spin` | 0.50 | replace | [0.08, 0.40] | (0.6, 4.2) | root yaw +360 |
| `move.stepback` | 0.45 | replace | [0.08, 0.36] | (0, 0) | push back 0.75 m, hop 0.12 |
| `move.jab` | 0.35 | none | — | — | holding |
| `move.pumpFake` | 0.40 | none | — | — | `fake` at 0.12 |
| `move.rip`, `move.protect`, `move.backdown`, `move.gather`, `post.faceUp` (0.35 s, new) | — | — | — | — | backdown shoves 0.25 m per dribble, `CONTACT` at each 0.18 s shove |
| `sig.kyrie.hesiCross` | 0.67 | carry (× 0.4 0–0.17) | [0.05, 0.40] (GP) | (2.0, 5.0) | ankle-eligible |
| `sig.kyrie.doubleBtlStepback` | (§4.12) | carry | [0.05, 0.60] | — | ankle-eligible |

Kyrie idle combos (cosmetic, in place): live dribble, speed < 0.5 for > 0.8 s, no input → loop `btl → cross → btl_L →
cross_L` (1.6 s), cancelled in 0.06 s by any input; `animator.ballHand` keeps `handSign`.

**`selectMove`** (tertiary on offence; stick relative to facing `lat`, `fwd`; dribble hand h; first match):

| condition | move |
|---|---|
| holding & `fwd < −0.5` | `move.pumpFake` |
| holding | `move.jab` (Kobe `sig.kobe.jabSeries`; Jordan `sig.jordan.jab`) |
| Yao | in post `sig.yao.dropStep`; else `move.pumpFake` |
| `fwd < −0.5` | `move.stepback` (Kyrie with `lat` toward the off hand → `sig.kyrie.doubleBtlStepback`) |
| `\|lat\| > 0.45` toward the off hand & speed > 3.5 | Kyrie `sig.kyrie.hesiCross`; Kobe `sig.kobe.hesiCrossStepback` (cross part); others `move.cross` |
| `\|lat\| > 0.45` toward the off hand & speed ≤ 3.5 | weighted (gameplay RNG): Kyrie cross .35 / btl .30 / btb .20 / hesiCross .15; Kobe & Jordan cross .6 / btl .25 / btb .15; LeBron cross .7 / btl .3; Giannis cross 1.0 |
| `\|lat\| > 0.45` toward the dribble hand & defender within 1.2 m in front | `move.spin` (not Yao) |
| speed > 2.5 | `move.hesi` |
| otherwise | `move.btl` (Kyrie, Kobe, Jordan), `move.cross` (others) |

### 4.9 Shooting and finishing

4.9.1 **Meter ↔ clip mapping** (all times from the SHOOT press; g' = g·gScale):
- `T½(h) = sqrt(2h/g')`; **ball launch = release input + 0.050 s** (the set → release push always takes 3 fixed steps);
  `tIdeal = takeoffT + T½(h) + rva − 0.050`; `METER_T = (tIdeal − meterFrom)/0.80` (green band centred at 80 % of
  the bar for everyone; `meterFrom = 0` for plain jumpers). Auto-release at `meterFrom + 1.25·METER_T`.
- Press → shot clip (0.06 s ease-out entry, dip visible in the first frame); warp so `takeoff` = `takeoffT` and
  `set` = `tIdeal − setLead`; gameplay starts the jump at `TAKEOFF`; reaching `set` early → `hold` with a 2 Hz micro
  motion (elbow ±2°, wrist ±3°) while following `jumpY`.
- Release input at `tu`: remaining clip to the `release` key warped into exactly 0.050 s (an input before `set`
  compresses the rest of the gather into the same 0.050 s = visibly rushed); guide hand leaves at `tu` (`both → R`);
  `RELEASE` fires at `tu + 0.050` with the socket position. Late input: the hold continues while descending.
- **Rules time** = `tu` (shot clock / buzzer). **Points** = feet at the step processing `tu` (C1). Move penalty uses
  root speed at `TAKEOFF` (entry `stop` 18 m/s² until takeoff: a 5.2 m/s runner takes off at ≈ 2.1 m/s).
- CPU: holds SHOOT for `tIdeal + eT_cpu` (§5.3.2). Long signature shots: bar empty until `meterFrom`, then fills over
  `METER_T`; `e = (tu − tPress − meterFrom)/METER_T − 0.80`, `eT = (tu − tPress) − tIdeal`.

4.9.2 **Forms (`FORMS`)** — arm arrays `[flex, abd, int, elbow, pron, wFlex, wDev]`:

| field | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| takeoffT mid (s) | 0.17 | 0.15 | 0.26 | 0.36 | 0.32 | 0.17 |
| + three / + pull-up / + fade (s) | +0.04 / +0.05 / +0.04 | +0.04 / +0.04 / +0.04 | +0.04 / +0.05 / +0.04 | +0.06 / +0.04 / — | +0.04 / +0.06 / +0.04 | +0.03 / +0.04 / +0.04 |
| dip (m × sLeg) / knee at dip | 0.10 / 50 | 0.11 / 52 | 0.12 / 50 | 0.09 / 40 | 0.05 / 30 | 0.08 / 48 |
| ball at dip | waist | waist | hip | belt | chest | belly |
| h mid / three / pull-up / fade (m) | 0.50 / 0.42 / 0.52 / 0.50 | 0.55 / 0.40 / 0.55 / 0.60 | 0.30 / 0.20 / 0.38 / 0.40 | 0.25 / 0.12 / 0.25 / — | 0.18 / 0.12 / 0.20 / 0.28 | 0.35 / 0.30 / 0.40 / 0.40 |
| rva (launch − apex, s) | −0.01 | 0.00 | −0.04 | −0.07 | −0.02 | −0.01 |
| setLead (s) | 0.08 | 0.08 | 0.08 | 0.14 | 0.10 | 0.07 |
| set `RA` | [115,6,18,95,85,−72,0] | [118,7,18,92,85,−70,0] | [110,13,14,90,80,−70,0] | [100,18,10,98,80,−65,0] | [118,8,16,95,85,−77,0] | [120,4,22,98,85,−72,0] |
| guide `LA` at set | [100,12,45,100,15,−20,0] | [102,14,40,98,10,−15,0] | [98,16,40,96,25,−15,0] | [92,18,35,100,10,−20,0] | [104,10,45,100,15,−20,0] | [104,10,45,100,15,−20,0] |
| release shoulder flex | 162 | 160 | 152 | 145 | 168 | 160 |
| follow-through wFlex / hold (s) | +70 / 0.45 | +88 / 0.45 (1.0 clutch make) | +60 / 0.30 | +60 / 0.40 | +75 / 0.60 | +70 / 0.40 |
| guide after release | peels 10 cm | opens 15 cm sideways | clean | pops to the side | stays up (mirror) | stays up 10 cm away |
| fade drift (m) / lean back (deg) | 0.45 / 18 | 0.55 / 15 | 0.45 / 15 | +0.15 forward drift on all jumpers / 0 | 0.35 / 12 | 0.10 / 8 |
| air legs on fades `RL` / `LL` (hip, knee) | 25,40 / 10,25 | 42,65 / 5,10 (scissor) | 30,30 / 10,15 | 15,20 / 15,20 | 15,15 / 15,15 | 10,20 / 10,20 |
| head at set `N` | [−8,0,0] | [−4,0,0] | [−3,0,0] | [0,0,0] | [−2,0,0] | [−3,0,0] |
| face during the shot | `scowl` 0.4 | — | — | — | — | — |
| expected ball height at launch, mid (±0.08 m, unit test) | 2.87 | 2.89 | 2.66 | 2.65 | 2.88 | 2.59 |

Derived `tIdeal / METER_T` (s):

| shot | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| mid-range | 0.429 / 0.536 | 0.435 / 0.544 | 0.417 / 0.521 | 0.466 / 0.583 | 0.442 / 0.553 | 0.377 / 0.471 |
| three | 0.443 / 0.554 | 0.426 / 0.533 | 0.412 / 0.515 | 0.456 / 0.570 | 0.446 / 0.558 | 0.387 / 0.484 |
| pull-up | 0.486 / 0.607 | 0.475 / 0.594 | 0.498 / 0.623 | 0.506 / 0.633 | 0.502 / 0.628 | 0.436 / 0.545 |
| face-up fade | 0.469 / 0.586 | 0.490 / 0.613 | 0.496 / 0.620 | — | 0.529 / 0.661 | 0.436 / 0.545 |
| `shot.stepbackJ` (takeoff 0.42·tempo, h pull-up) | per formula (Kyrie 0.627 / 0.78) | | | | | |

`makeJumper(form, variant ∈ {mid, three, pullHop, pull12, fade})` keys: [ref ANIM:§5.3 `makeJumper(form, variant)` —
generated keys]. Pull-up entries: `pull12` (1-2 stop; Kobe/Jordan/LeBron default; speed > 1.5) plants L 0.06 / R 0.14,
decel 20 m/s²; `pullHop` (Kyrie, Giannis, or speed > 4) both feet land at 0.12, decel 24 m/s². Other generic shots
(`shot.stepbackJ` push back 0.70 m × sLeg (Kyrie 0.80, LeBron 0.50), `shot.turnFade` takeoff 0.70·tempo,
`shot.hook` = Yao's keys at tempo 1.05 for Giannis, `shot.floaterGeneric` = Kyrie's floater at tempo 1.08 and h × 0.9,
`shot.scoop`): [ref ANIM:§5.4 Other shot types].

4.9.3 **Layups** (`makeLayup`, right hand off the left foot; mirrored). Hand: approach right of the rim line by
> 0.4 m → right hand; left → left; else away from the nearest defender (Kyrie, LeBron, Giannis) or right (Kobe,
Jordan, Yao). `lay.std2` press window 2.5 < d ≤ 4.0 m (Jordan 4.6) with speed ≥ 2.0 m/s heading within 45° of the
rim; `lay.std1` d ≤ 2.5 m or slower (C9). Takeoff target `dTO = clamp(vAir·2·T½(h)·0.75, 1.0, 2.0)`, `vAir` 2.6 m/s
(Yao 1.8); airborne root toward 0.45 m in front of the rim centre, never past the board plane − 0.5 m. Keys:
[ref ANIM:§5.5 Layups]. Meter: `tIdeal = (TO + T½ − 0.03) − 0.05`; launch at the clip's `release` key unless the
input is > 0.10 s early/late (then input + 0.05 rule).

| player | h layup (m) | gScale | TO std2 / std1 (s) | tIdeal std2 / std1 | METER_T std2 / std1 |
|---|---|---|---|---|---|
| kobe | 0.60 | 1 | 0.36 / 0.12 | 0.630 / 0.390 | 0.79 / 0.49 |
| jordan | 0.70 | **0.80** (C12) | 0.35 / 0.12 | **0.692 / 0.462** | **0.865 / 0.578** |
| lebron | 0.60 | 1 | 0.37 / 0.12 | 0.640 / 0.392 | 0.80 / 0.49 |
| giannis | 0.65 | 1 | 0.38 / 0.13 | 0.664 / 0.410 | 0.83 / 0.51 |
| yao | 0.30 | 1 | 0.40 / 0.13 | 0.567 / 0.301 | 0.71 / 0.38 |
| kyrie | 0.55 | 1 | 0.33 / 0.11 | 0.585 / 0.365 | 0.73 / 0.46 |

Layup family (variant chosen by GP §5.9.2; clips): `lay.fingerRoll` (palm up `RA[160,8,10,10,−70,15,0]`, release apex +
0.02, underspin), `lay.reverse` (generic = Kyrie keys at the user's tempo), `lay.euro` (Giannis keys, steps × 0.75;
press [3.0, 5.2] m, C11), `lay.power` (two-foot jump stop 1.2–1.8 m, pelvis −0.20·sLeg, off arm `[90,60,0,20,−30,0,0]`),
`lay.switch` = `sig.jordan.theMove`, `lay.spin` = `sig.kyrie.spinFinish` / `sig.giannis.spinGather`, `lay.upUnder`
= `sig.yao.upUnder` (generic users at their tempo).

4.9.4 **Dunks.** `ySlam = RIM.y + 0.18 = 3.228 m`, ball 0.10 m in front of the rim centre; `reachDunk = reachAug +
0.08`; ball reach one-hand +0.04, two-hand −0.02; `h = clamp(ySlam − ballReach + 0.05, 0.40, 1.05)`:

| player | reachDunk | h one-hand | h two-hand | slam after takeoff one / two (s) |
|---|---|---|---|---|
| kobe | 2.51 | 0.73 | 0.79 | 0.36 / 0.37 |
| jordan | 2.50 | 0.74 | 0.80 | 0.36 / 0.37 (× 1/sqrt(0.80) with gScale 0.80) |
| lebron | 2.57 | 0.67 | 0.73 | 0.34 / 0.36 |
| giannis | 2.66 | 0.58 | 0.64 | 0.31 / 0.33 |
| yao | 2.82 | 0.42 | 0.48 | 0.26 / 0.28 |
| kyrie | 2.37 | 0.87 | 0.93 | 0.39 / 0.41 (open breaks only) |

Vertical profile: ballistic rise; slam at apex − 0.03 (ascending) unless the clip says descending; **hang** from
slam + 0.03 for `hangT` 0.10–0.25 s (per clip; `jumpY` eases h → h − 0.05, elbows 30° on the rim); **drop** free fall
(landing `sqrt(2(h − 0.05)/g')` after the hang). Takeoff windows (rim centre → takeoff root): one-foot 1.2–2.0, two-foot
power 0.9–1.4, cradle 1.2–1.6, long gather 2.6–3.2, FT-line 4.2–4.6. Air velocity `(dTO − 0.35)/tSlam` toward the rim.
Over the last 0.15 s before `SLAM` the dunk hand(s) are IK-driven to the slam point; at `SLAM` the ball launches with
`v = (0, −4.5, 0) + 0.3·unit((rim − ball)xz)`, state `scored` (R#33 moot: no teleport); at `RIM_GRAB` `rimHook_s` is
IK-locked to `RIM + n·0.2286` at y RIM.y + 0.01, fingers `claw`, until `RIM_RELEASE`. Generic clips `dunk.power2`,
`dunk.tomahawk1`, `dunk.simple1`: [ref ANIM:§5.6 Dunks]. Generic dunk press window d ∈ [0.6, 4.0] m (power2 when the
gather does not fit a one-foot window and d ≤ 2.2).

4.9.5 **Putbacks**: `put.tip` (offensive player airborne within 1.2 m of the rim, hand reaches the free ball with
`vy < 0`; h = `hJump` (C8); wrist flick −10 → +40° in 0.06 s at `CONTACT`); `put.dunk` (LeBron, Giannis, Yao; catch at
the apex within 1.0 m of the rim with ball reach ≥ 3.15 m; slam 0.10 s later, no hang, `roar` 0.8) [ref ANIM:§5.7].

### 4.10 Defence, passing, catching clips

| clip | key numbers (keys [ref ANIM:§6 Defence]) | gameplay link |
|---|---|---|
| `def.closeout` | contest hand toward the shooter's shooting side `[150,20,0,20,−40,0,0]` `spread`; chop steps 5.0 steps/s, step 0.25·sLeg, pelvis −0.10, trunk 10°; decel 10 m/s², never reverses; exit at < 1.2 m or 0.60 s | GP closeouts §5.10 |
| `def.contest1` | dur `0.08 + 2·T½(h) + 0.20`, entry `stop` 30 m/s², load 0.08 → takeoff, apex arm `[172,10,0,5,−30,0,0]` | h = `hJump` (C8) |
| `def.handUp` | upper layer, C22 arms, up in 0.10 s, held during the man's windup, down 0.20 s after release | auto hands-up |
| `def.vertical` | both arms `[175,5,0,0,−90,0,0]` spread, straight body/legs, load 0.10 | Yao `sig.yao.vertical`, Giannis generic |
| `def.block1` | load 0.08 (Yao 0.13); apex arm `[165,10,0,5,−20,−10,0]`; on `CONTACT` hand IK 0.06 s + swat (wFlex −10 → +50, pron +30; chase pin −40 → +20) | contact radius C2 |
| chase-downs | `sig.lebron.chasedown` (h 0.85, entry `carry` ≈ 6 m/s), `sig.giannis.helpBlock` (h 0.785); others `def.block1` entry `carry` (85 % of run-in speed) | GP §5.4 |
| `def.steal` / `def.stealMiss` | dur 0.42, lunge 0.30·sLeg, swipe knee → waist; `SWIPE` 0.12 (Kyrie 0.10, Yao/LeBron 0.14); Jordan run-out exitV 4 m/s; miss clip time-scaled to the GP stun (C5) | GP §5.5 |
| `def.boxout` | stance `boxOut` + slide gait | GP §5.6 |
| `reb.jump2` | takeoff 0.12 (Yao 0.10), apex arms `[170,15,0,15,−60,−10,0]` spread, `CATCH` → `both`, land, "chin it" elbows 80° 0.45 s | h = `hJump` |
| `def.stumble` | 0.40 s, root 0.20·f in 0–0.25 | GP shake (`stunned` 0.40) |
| `def.ankleFall` | **1.60 s** (retimed C4), sits with the pelvis 0.16 m above the floor, `FX` crowd "ooh" | GP `fallen` 1.60 |
| `def.bumped` | additive 0.30 s: pelvis dx 0.12 away, trunk roll 10°, arms out 30° | GP bump |
| `loose.scoop` | upper+legs 0.30 s, S[60,0,0], knees 70, hand IK to the ball, `CATCH` | loose ball within 0.6 m |

**Passing** (input → `RELEASE`; ball launches from the hand socket; C6): `pass.chest` = `passRelease`
(Kobe/Jordan 0.158, LeBron 0.133, Giannis 0.162, Yao 0.184, Kyrie 0.154 s), `pass.bounce` +0.02, `pass.lob` +0.06,
`pass.overhead` +0.08, `pass.push1` 0.08 (in hand) / next contact ≤ 0.20, `sig.yao.overheadPass` 0.25 (0.20 chinned),
`sig.lebron.skipPass` 0.10 (passes ≥ 8 m, 15 m/s, no-look), `sig.lebron.skipOverhead` 0.18 (from the post, ≥ 8 m);
from the dribble + pickup ≤ 0.12; `pass.turn` when the target is > 60° off the facing (root yaw 15 rad/s, ≤ 0.12 s).
Keys [ref ANIM:§7.2 Keys]. Aim: additive spine yaw `clamp(α, −60°, 60°)` split 0.20/0.35/0.45; look at the receiver
except LeBron's no-look (skip pass and 40 % of his passes). **Catching**: `catch.ready` (hands up `[60,20,0,50,−60,0,0]`
spread, 0.12 s in) while a pass flies to him; `catch.chest/high (> 1.6 m)/low (< 0.8 m)/run` with hand IK over the last
0.15 s; absorb 0.15 s; `READY` 0.30 s after `CATCH` (GP gate is 0.40 s).

### 4.11 Mannerisms, celebrations, idle habits, showcase

Face timelines (from play):

| player | trigger | expression |
|---|---|---|
| jordan | drive (handler dribbling toward the rim, speed > 4.5, rim < 7 m) | `tongueOut` 0 → 1 in 0.10 s, held; retract 0.12 s |
| jordan | any layup/dunk clip | `tongueOut` 1 from `GATHER` to `LAND` + 0.10 (also in replays); none on jumpers; idle gum chew |
| kobe | always / own big make | `scowl` 0.35 / `jawJut` 1.0 held 1.2 s |
| lebron | dunk / power finish | `roar` 0.4 at takeoff → 1.0 at slam/land |
| giannis | dunk / dead balls | `roar` 0.4 → 1.0 / `grin` 0.7 (menu card too) |
| yao | dunk/block / teammate's big play / long possession | `roar` 0.9 for 1.0 s / `grin` 0.8 for 1.2 s / `puff` 0.8 for 0.5 s |
| kyrie | own three/tough make | `smirk` 0.8 for 1.5 s (never screaming) |
| all | sprint at stamina < 0.4, rebounds, blocks | `jawOpen` 0.25–0.5 |

**Celebrations**: only the scorer (teammates within 4 m may `cel.highFive`); full-body ones end (or are cut with a
0.30 s blend) by 1.4 s after the make; upper-body + face continue over the CHECK tween; blockers upper-body only
≤ 0.9 s. Classes: `dunk`, `clutch` (last 30 s, margin ≤ 3, go-ahead or buzzer-beater), `three`, `tough` (contest
C < 0.7 at release), `normal`; celebrate probability 0.85 / 1.0 / 0.6 / 0.5 / 0.2 (cosmetic RNG).

| player | dunk | clutch | three | tough | normal |
|---|---|---|---|---|---|
| kobe | `cel.kobe.jawJut` | `cel.kobe.fingerUp` .6 / `cel.kobe.fistClench` .4 | `cel.kobe.shrug` .5 / jawJut .5 | `cel.kobe.shrug` | jawJut face only (.6) |
| jordan | `cel.jordan.fistJog` | game-winning jumper `cel.jordan.lastShot`, else `cel.jordan.leapPump` | after 3 straight makes `cel.jordan.shrug`, else `cel.jordan.pointSmirk` | `cel.jordan.pointSmirk` | `smirk` .5 |
| lebron | `cel.lebron.roar` | roar + chest pound | assisted `cel.lebron.point`, else `cel.lebron.flexLite` | `cel.lebron.flexLite` | fist pump (upper 0.5 s) |
| giannis | `cel.giannis.flexRoar` | flexRoar + `cel.giannis.chestThump` | `cel.giannis.airplane` | `cel.giannis.chestThump` | finger up while backpedalling (1.0 s) |
| yao | `cel.yao.fistPump` | `cel.yao.fistPump` | nod jog | nod jog | nod jog (N pitch +12 twice) |
| kyrie | `smirk` + jog | `cel.kyrie.holdFollow` .5 / `cel.kyrie.skyPoint` .3 / `cel.kyrie.shh` .2 | `cel.kyrie.holdFollow` .6 / `cel.kyrie.skyPoint` .4 | `cel.kyrie.walkAway` | `smirk` |
| blocker | Yao: turn, jog, point to a teammate; LeBron/Giannis after a chase-down: stare back + `roar` 0.8 (upper fist); others none | | | | |

Kyrie never uses a three-finger "goggles" gesture; after his 3rd straight make `cel.kyrie.bow`. Clip keys:
[ref ANIM:§8.2 Celebrations (in game)] (table "Celebration clip keys"). Idle habits (DEAD, CHECK, QUARTER_END;
stationary ≥ 0.6 s; cosmetic RNG; 6 s cooldown per player; must finish before the state change, CHECK habits need
≥ 1.0 s left, ball habits end with the ball in both hands before LIVE): [ref ANIM:§8.3 Idle habits]. Showcase loops
(lineup/title/intro, every 6–8 s; LeBron `cel.lebron.chalk` 3.2 s with `FX chalkBurst` at 2.45 s), game-over
winners/losers: [ref ANIM:§8.4 Presentation screens].

### 4.12 Signature move catalog (keys: [ref ANIM:§9 Signature moves — keyframe tables]; numbers below are binding)

| clip | type | trigger (resolver §5.9 / AI) | h (m) | takeoff (s) | meterFrom / tIdeal / METER_T (s) | press window / target | notes |
|---|---|---|---|---|---|---|---|
| `sig.kobe.turnFade` | turnFade | post 1.0–5.0 m; Kobe `kobe.postFade` | 0.50 | 0.70 | 0.50 / 0.959 / 0.574 | yaw faces rim at 0.70 ±25° | dur 1.60, fade 0.45 + 0.10 baseline |
| `sig.kobe.jabSeries` / `ripPullup` / `jabGo` | move / jumper(jabPullup) / drive | holding + CROSS; SHOOT within 0.8 s; drive input after jab 2 | ripPullup 0.55 | 0.19 | 0 / 0.465 / 0.58 | — | jabSeries 0.53 s, branch points 0.17 / 0.47 |
| `sig.kobe.pump` / `sideStepPullup` | move / jumper | holding + CROSS stick back; SHOOT with stick sideways ≤ 0.6 s after | 0.50 | 0.33 | 0.12 / 0.589 / 0.586 | — | — |
| `sig.kobe.baselineSpinLay` / `baselineSpinFade` | layup / fade | dribbling along the right baseline within 4.5 m (fade: stick away) | 0.55 / form | 0.60 / 0.62 | 0.47 / 0.855 / 0.48 ; 0.40 / 0.879 / 0.60 | — | release lay 0.905 |
| `sig.kobe.tomahawk` / `reverse2` | dunk | transition speed > 5 (0.7) / baseline approach within 30°, \|x\| > 1.5 (0.4) | table §4.9.4 | — | — | one-foot 1.2–2.0 | — |
| `sig.kobe.hesiCrossStepback` (+`_btl`) | move → stepback | speed > 3.5, CROSS toward off hand; SHOOT during it | form pull-up | press + 0.20 | press / 0.459 / 0.574 (from a press at 0.27) | — | branch at 0.27 |
| `sig.jordan.turnFade` | turnFade | post 1.0–5.0 m | 0.62 | 0.68 | 0.45 / 0.986 / 0.67 | — | dur 1.75 (2.40 Last-Shot hold on a clutch make) |
| `sig.jordan.ftDunk` | dunk | C10 | 1.00 (gScale 0.70) | 0.48 | — | press [6.0, 7.6], takeoff 4.2–4.6 | slam takeoff + 0.704, air 1.08, `SLOWMO_IN/OUT` (replay only, 0.35×) |
| `sig.jordan.theMove` (`lay.switch`) | layup | defender big within 1.2 m of the rim on his path (p 0.75) | 0.95 | — | 0.30 / 0.79 / 0.61 | takeoff ≈ 2.0 | release takeoff + 0.72 descending |
| `sig.jordan.cradle` | dunk | breakaway (no defender within 4 m) 0.4 | 1.00 | — | — | takeoff 1.2–1.6 | rim hang 4 frames |
| `sig.jordan.jab` / `jabShot` / `ripDrive` | move / jumper / drive | holding + CROSS (40 % pump fake first) | jabShot 0.50 | 0.13 | 0 / 0.40 / 0.50 | — | — |
| `sig.jordan.pullup` | jumper | any Jordan pull-up | 0.55 | form | 0 / 0.475 / 0.594 | — | knees together, no split |
| `sig.jordan.steal` | steal | Jordan pokes | — | — | — | — | swipe knee → waist, run-out 4 m/s |
| `sig.lebron.chasedown` | block | `lebron.chaseDown` | 0.85 | — | — | within 4 m behind | palm ≈ 3.34 m at apex |
| `sig.lebron.tomahawk` / `jumpStopDunk` | dunk | transition 0.6 / 0.4; after powerDrive → power2 | 0.80 | — | — | takeoff 1.5–2.0 | slam 0.574, rim grab 0.15 |
| `sig.lebron.powerDrive` | move | LeBron drive at speed ≥ 4 with a defender ahead (AI) / SPRINT drive ≥ 4 m/s into contact (human) | — | — | — | jump stop 1.2–1.8 m | finish = next input |
| `sig.lebron.skipPass` / `skipOverhead` | pass | passes ≥ 8 m | — | — | — | — | release 0.10 / 0.18 (C6) |
| `sig.lebron.leftBlockFade` | turnFade | post, left block (generic `shot.turnFade` on the right) | 0.40 | 0.42 | 0.15 / 0.616 / 0.58 | — | dur 1.30 |
| `sig.lebron.stepback3` | stepback | after `move.cross_L` or stick back while dribbling | 0.25 | 0.36 | 0 / 0.496 / 0.62 | — | lands 0.50 m behind |
| `sig.giannis.euroDunk` / `euroLay` | dunk / layup | `giannis.euro` (C11) | 0.72 | 0.83 | lay: 0.60 / 1.15 / 0.69 | press [5.4, 7.6], takeoff 2.6–3.2 | slam 1.31 descending, rim hook 0.20 |
| `sig.giannis.longGather` | dunk | `giannis.longDunk` (C11) | 0.66 | — | — | press [6.4, 7.8], gather 5.0–5.4, takeoff 2.6–3.2 | slam 1.067, hang 0.30, land 1.75 |
| `sig.giannis.spinGather` | layup | layup press with stick toward the dribble hand and a defender in front within 1.2 m | 0.50 | — | 0.63 / 1.07 / 0.55 | yaw faces rim at 0.63 | dur 1.70, root yaw +300 |
| `sig.giannis.helpBlock` | block | `giannis.helpBlock` | 0.785 | — | — | — | pin wrist 40° |
| `sig.giannis.elbowDrive` | move | AI default drive when cut off at the elbow; human: holding at d 3.5–5.5 + SPRINT + stick toward the rim | — | — | — | — | finish `lay.std1_L` / `dunk.power2` |
| `sig.yao.hook` | hook | post / back to the rim ≤ 4.5 m | 0.22 | 0.60 | 0.30 / 0.74 / 0.55 | — | launch 55°, dur 1.50 |
| `sig.yao.turnFade` | turnFade | post, right block | 0.28 | 0.53 | 0.27 / 0.699 / 0.54 | — | launch 50° |
| `sig.yao.jabJumper` | jumper | high post after a jab | 0.15 | 0.53 | 0.20 / 0.635 / 0.54 | — | without jab: form values |
| `sig.yao.dropStep` / `dropStepLay` | dunk / layup | post + CROSS (or SHOOT toward the rim) | 0.48 | — | — | — | slam 0.75; dunk if d ≤ 1.5 |
| `sig.yao.vertical` / `sig.yao.block` | contest / block | rim protection | `hJump` 0.44 | — | — | — | verticality arms |
| `sig.yao.pumpHook` / `upUnder` | move / layup | quick SHOOT tap in post / second press ≤ 0.6 s | 0.15 | 0.40 | 0.10 / 0.52 / 0.525 | — | release 0.57 finger roll |
| `sig.yao.overheadPass` | pass | doubled within 0.8 s | — | — | — | — | release 0.25 (0.20) |
| `sig.yao.rebound` | rebound | Yao rebounds | `hJump` | — | — | — | elbows flared 80° |
| `sig.kyrie.hesiCross` | move | Kyrie CROSS toward off hand at speed > 3.5 | — | — | — | — | 0.67 s, ankle-eligible |
| `sig.kyrie.doubleBtlStepback` | move → stepback | CROSS stick back toward off hand; SHOOT at 0.43–0.57 | 0.35 | 0.83 | press / 0.47 (from a press at 0.57) / 0.59 | — | ankle-eligible |
| `sig.kyrie.spinFinish` | layup | layup press, stick toward the dribble hand, defender in front within 1.2 m | 0.50 | 0.53 | 0.33 / 0.77 / 0.55 | — | yaw +270, release 0.82 |
| `sig.kyrie.reverseLay` | layup | baseline approach < 35° or a rim protector (H ≥ 2.05) within 1.5 m | 0.55 | 0.37 | 0.20 / 0.625 / 0.53 | plant under the rim front | release 0.675 |
| `sig.kyrie.floater` / `scoop` | floater | §5.9 row 8 (scoop 0.2 when approach to the baseline < 30°) | 0.40 | 0.17 | 0 / 0.35 / 0.44 | d 2.2–4.5 | release on the way up 0.40 |
| `sig.kyrie.btbPullup` | jumper | SHOOT ≤ 0.25 s after `move.btb`, or stick away from travel at speed > 3 (AI 25 % of pull-ups) | 0.40 | 0.45 | 0.24 / 0.676 / 0.54 | — | release 0.726 |

### 4.13 Integration: state map and clip mapping

State → animation map: [ref ANIM:§10.1 State → animation map] (CHECK = 0.20 s crossfade, never a snap; paused →
animator clock frozen). Clip mapping (`select.selectClip`, C14) from the resolver's `{kind, variant}`:

| kind / variant | clip |
|---|---|
| jumper `set` / `three` | `makeJumper(p, mid / three)`; Yao at the high post after a jab → `sig.yao.jabJumper` |
| jumper `pull12` / `pullHop` | Jordan `sig.jordan.pullup`; Kobe after `sig.kobe.pump` → `sig.kobe.sideStepPullup`; Kyrie ≤ 0.25 s after `move.btb` → `sig.kyrie.btbPullup`; else `makeJumper(p, pull12)` / `makeJumper(p, pullHop)` (hop: Kyrie, Giannis, or speed > 4) |
| jumper `jabPullup` | Kobe `sig.kobe.ripPullup`; Jordan `sig.jordan.jabShot`; others `makeJumper(p, mid)` |
| fade | `makeJumper(p, fade)` (Kobe baseline → `sig.kobe.baselineSpinFade`) |
| stepback | Kyrie: `doubleBtlStepback` branch if it is the last move, else `shot.stepbackJ`; LeBron `sig.lebron.stepback3`; Kobe `hesiCrossStepback` branch if last move, else `shot.stepbackJ`; others `shot.stepbackJ` |
| turnFade | Kobe `sig.kobe.turnFade` (shoulder by court side / stick), Jordan `sig.jordan.turnFade`, LeBron `sig.lebron.leftBlockFade` (left block) else `shot.turnFade`, Yao `sig.yao.turnFade`, Giannis/Kyrie `shot.turnFade` |
| hook | Yao `sig.yao.hook` (`sig.yao.upUnder` if last move `pumpHook` ≤ 0.6 s), Giannis `shot.hook` |
| floater | Kyrie `sig.kyrie.floater` / `scoop`; others `shot.floaterGeneric` |
| layup `std`/`fingerRoll`/`reverse`/`euro`/`power`/`switch`/`spin`/`upUnder` | §4.9.3 family (Kyrie reverse = `sig.kyrie.reverseLay`; Kobe baseline = `sig.kobe.baselineSpinLay`; Giannis euro = `sig.giannis.euroLay`) |
| dunk | per player: Jordan ftDunk (C10) / breakaway cradle .4, tomahawk1 .4, power2 .2 / else tomahawk1 .5, power2 .5; Kobe transition `sig.kobe.tomahawk` .7 / power2 .3, baseline `sig.kobe.reverse2` .4; LeBron transition `sig.lebron.tomahawk` .6 / jumpStopDunk .4, after powerDrive power2; Giannis longGather / euroDunk / power2 .5, tomahawk1 .5; Yao from post `sig.yao.dropStep`, else `dunk.simple1` / power2; Kyrie `dunk.simple1` |
| tip | `put.tip`; LeBron/Giannis/Yao `put.dunk` when eligible |

`getTiming(playerId, kind, variant)` returns the tables of §4.9 / §4.12 (`clipTiming` of the compiled clip, including
`gatherWindow`); the meter, the AI contest timing and `debugShoot` read it. Gameplay hooks (all adopted with C1, C2,
C5, C6, C8): [ref ANIM:§10.4 Gameplay hooks changed or added by this section]. Ball protocol per possession:
[ref ANIM:§10.6 Ball protocol (one possession)].

**AnimProxy** (headless, WP3): same `play/releaseNow/setJump/step/querySocket/events/onCatch/ballMode/ballHand/action`
API; clip timing from the compiled clip tables (no three.js scene, no skinning); constructor `new AnimProxy(id,
PROXY_METRICS[id])` with the §4.1 metrics table embedded in `proxy.js` (so Node tests need no header); sockets
closed-form (one definition, used by §5.4 too): `palm_s` = root + facing·0.30 + (0, h, 0) with `h = reachM − 0.24 +
jumpY` while in a block/contest/rebound/steal clip and `h = 1.05·sLeg` otherwise; `ball1_s` of a held shot = the
release table height (§4.9.2 expected heights; layups `reach0 + 0.15 + jumpY`), of a held ball otherwise `0.95·sLeg`
at facing·0.30. B57 asserts proxy vs real socket height at release within
0.10 m for every legend's mid-range jumper.

### 4.14 Performance (per tier; six players; animation CPU per frame)

| tier | budget | full-rate players | 30 Hz players | fingers | foot IK | hand IK | look / eyes | breathing | expressions |
|---|---|---|---|---|---|---|---|---|---|
| high | ≤ 0.9 ms (iPhone 11 class) | all | — | all | all | all | head + eyes | all | all |
| medium | ≤ 1.2 ms | ball owner, his defender, players in an action clip, camera-near | others (alternating frames; root still moves) | owner + players > 160 px tall | all | all | head all, eyes in close-ups | owner + defenders | celebrations + close-ups |
| low | ≤ 2.0 ms (2021 low-end Android) | ball owner + action players | others | owner only | actions only; reduced gait solves every other frame | owner | head only | off | celebrations only (no morphs on low) |

Dynamic guard: rolling 2 s mean > 1.3 × budget for 2 s → demote one more off-ball player to 30 Hz (sticky 10 s).
Culled characters (C19): 15 Hz, no IK, no look; gameplay sockets still come from step queries. Memory: clips ≈ 2.3 MB +
rig frames + ≈ 12 KB per animator (< 2.5 MB). No per-frame garbage.

### 4.15 Viewer and animation tests

Viewer `index.html?anim=<clipId|list|loco>&player=<id>` (same page, works in the artifact): [ref ANIM:§11.1 Viewer]
including `window.__anim`. Unit tests `test/unit-anim.mjs` (8 groups: rig frames & mirror symmetry, compile/limits/
events, IK 10,000 targets ≤ 1 mm, gait slide < 5 mm & cadence ±3 %, meter launch at `apex + rva` ± 1 step & height ±0.08 m,
dunk ball ≥ 3.20 m at `SLAM` within 0.15 m, first-33-ms motion ≥ 2 cm / 3°, zero allocation < 64 KB heap growth):
[ref ANIM:§11.2 Unit tests]. Playwright items B44–B52 (§9).

---
## 5. Gameplay (WP4 rules/models, WP5 AI/balance) [GP]

### 5.1 Ratings → physical attributes (`ratings.js`, `derive(legend)`, frozen on `player.attrs`)

`n(r) = clamp((r − 25)/74, 0, 1)`; H listed height, W weight, ws wingspan; `w̃ = clamp((W − 88)/53, 0, 1)`.

| attr | formula | replaces v1 |
|---|---|---|
| `run` (m/s) | `4.40 + 1.10·n(speed)` | 5.2 × rating |
| `sprintMul` | `1.22 + 0.16·n(speed)` | 1.35 |
| `handlerMul` | `0.88 + 0.08·n(ballHandle)` | 0.92 |
| `accel` (m/s²) | `18 + 10·n(speed) − 6·w̃ − 8·max(0, H − 1.98)` | 24 |
| `decel` | `0.70·accel + 2` | 16 |
| `turn` (rad/s) | `9 + 5·n(speed)` | 12 |
| `slideMul` (on-ball, move ⟂ facing > 45°) | `0.80 + 0.20·n(perimeterD)` | — |
| `hJump` (m) | `0.45 + 0.40·n(vertical) − 0.10·clamp((W − 100)/40, 0, 1)` | 0.75 |
| `airtime` (s) | `2·sqrt(2·hJump/9.81)` | 0.55 |
| `catchR` (m) | `0.50 + 0.45·(ws − 1.90)` | 0.55 × height |
| `catchTopY` (m, + jumpY) | `reachM − 0.15` | 2.30 |
| `passReceiveR` | `catchR + 0.25` | 0.80 |
| `stealRange` (m) | `0.90 + 0.75·(ws − 1.93)` | 1.1 / 1.0 |
| `bodyR` (m) | `0.18 + 0.5·shoulderJoints` | 0.40 |
| `passSpeed` (m/s) | `9.5 + 4.5·n(passing)` | 12 |
| `passRelease` (s) | `clamp(0.25 − 0.12·n(passing), 0.10, 0.27)` | 0 |
| `passSigma` (m) | `0.04 + 0.22·(1 − n(passing))` | 0 |
| `staminaDrain` (/s sprinting) | `0.25·(1 + 0.25·clamp((W − 100)/40, 0, 1))` | 0.25 |
| `rebReact` (s) | `0.30 − 0.20·n(rebound)` | difficulty reaction |

Binding derived values (`unit-ratings.mjs`, ±0.01 of shown precision):

| id | run | sprint | handler | accel | decel | turn | slideMul | hJump | airtime | catchR | catchTopY | stealRange | bodyR | passSpeed | passRelease | passSigma |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kobe | 5.29 | 7.14 | 5.03 | 25.2 | 19.6 | 13.1 | 0.98 | 0.79 | 0.80 | 0.595 | 2.49 | 1.03 | 0.408 | 13.0 | 0.158 | 0.091 |
| jordan | 5.38 | 7.33 | 5.10 | 25.8 | 20.1 | 13.5 | 0.99 | 0.82 | 0.82 | 0.595 | 2.50 | 1.03 | 0.410 | 13.0 | 0.158 | 0.091 |
| lebron | 5.32 | 7.21 | 5.05 | 22.9 | 18.0 | 13.2 | 0.97 | 0.76 | 0.79 | 0.608 | 2.54 | 1.06 | 0.433 | 13.9 | 0.133 | 0.046 |
| giannis | 5.34 | 7.24 | 4.99 | 23.0 | 18.1 | 13.3 | 0.97 | 0.80 | 0.81 | 0.640 | 2.66 | 1.11 | 0.423 | 12.8 | 0.162 | 0.099 |
| yao | 4.59 | 5.73 | 4.13 | 11.3 | 9.9 | 9.9 | 0.87 | 0.44 | 0.60 | 0.662 | 2.80 | 1.15 | 0.425 | 12.0 | 0.184 | 0.138 |
| kyrie | 5.38 | 7.33 | 5.17 | 26.9 | 20.8 | 13.5 | 0.92 | 0.75 | 0.78 | 0.514 | 2.37 | 0.90 | 0.393 | 13.1 | 0.154 | 0.085 |

### 5.2 Movement and separation

- Kinematics (v1 §5.10): `desired = move × run × (sprint ? sprintMul : 1) × (hasBall ? handlerMul : 1)`,
  `v += clamp(desired − v, (desired = 0 ? decel : accel)·dt)`, walk below stick mag 0.5; facing per §4.7 at `turn`;
  root-motion clips replace the velocity (§4.4). Stamina: drain `staminaDrain`/s sprinting, refill 1/6 per s, sprint
  locked at 0 until 0.25. AI court clamp |x| ≤ 7.4, −14.1 ≤ z ≤ −0.3; the human handler is not clamped (OOB stays a turnover).
- Separation (C3): pair minimum `bodyR_a + bodyR_b` (0.79–0.87 m), +0.10 when either is airborne, ≥ 0.95 m against a
  dunker in the hang phase; a hanging dunker or a player in a root-motion signature clip is immovable (the other
  takes the whole push). Fixes R#43.

### 5.3 Shooting model (`shot.js`)

5.3.1 **Kinds** (resolved at the press, §5.9; zone at release): `jumper` (variants `set`, `three`, `pull12`,
`pullHop`, `jabPullup`), `fade`, `stepback`, `turnFade`, `hook`, `floater`, `layup` (variants `std`, `fingerRoll`,
`reverse`, `euro`, `power`, `switch`, `spin`, `upUnder`), `dunk`, `tip`. Rating zone: `close` if d ≤ 3.5 else `mid`;
`three` if `isThree(feet at release)`; layup → `layup`; dunk → `dunk`; hook/floater/tip → `close`. d = horizontal
distance feet → rim centre at release.

5.3.2 **Meter and timing** (D-GP-2): `tIdeal`, `meterFrom`, `METER_T` from `getTiming` (§4.9, §4.12).
`eT = (tu − tPress) − tIdeal` (s); `e = eT / METER_T` (meter flash, `debugShoot({e})` compatibility).
Green half-width (human) `gS = G_DIFF × (0.80 + 0.40·n(zoneRating))`, `G_DIFF` = **0.040 / 0.033 / 0.027 s**
(easy / normal / hard); layups +0.022 s; dunks and tips have no meter. CPU shooters use `G_DIFF(normal)`.
Examples (normal): Kobe mid 39.4 ms, Kyrie three 38.0, Giannis three 32.3, Yao three 27.3, Jordan layup 61.4.
Timing factor `T(eT)`: `|eT| ≤ gS → 1.00`; `gS < |eT| ≤ 0.165 → lerp(0.80, 0.22, (|eT| − gS)/(0.165 − gS))`;
`> 0.165 → 0.12`. **Air ball**: `eT ≤ −0.175` → forced miss with the air-ball target. Meter display: fill over `METER_T`
after `meterFrom`, green band `[0.80 − gS/METER_T, 0.80 + gS/METER_T]`, flash 完美/稍早/稍晚 0.6 s, live points chip
(§6.5.7). CPU release `eT_cpu ~ N(0, σ_cpu)` clamped [−0.25, +0.22], σ_cpu 0.075 / 0.055 / 0.038 s; expected `T̄_cpu`
0.73 / 0.81 / 0.89 (used by AI estimates); "average human" σ 0.050 → green 62 / 53 / 45 %.

5.3.3 **Green-open probability `Pg`**:

| zone | `Pg` |
|---|---|
| dunk | `0.93 + 0.06·n(dunk)` |
| layup | `0.78 + 0.18·n(layup)` |
| close (d ≤ 3.5) | `(0.66 + 0.28·n(closeShot)) × (1 − 0.03·max(0, d − 1.5))` |
| mid (2-pt, d > 3.5) | `(0.52 + 0.36·n(midRange)) × (1 − 0.025·(d − 3.5))` |
| three | `(0.40 + 0.42·n(three)) × (d ≤ 7.8 ? 1 : max(0.20, 1 − 0.12·(d − 7.8)))` |

Type multipliers on `Pg` (unless an ability overrides): fade 0.94, stepback 0.95, turnFade 0.95, floater 0.92, hook
(non-Yao) 0.90, tip 0.85, layup reverse 0.97 / euro 0.98 / power 1.00 / fingerRoll 1.00, upUnder generic 0.95 (Yao 1.0).

Binding table (`unit-shot.mjs`, ±0.005):

| id | dunk 1.0 m | layup 1.5 | close 2.5 | mid 5.0 | three 7.3 |
|---|---|---|---|---|---|
| kobe | 0.981 | 0.950 | 0.886 | 0.842 | 0.735 |
| jordan | 0.988 | 0.958 | 0.897 | 0.847 | 0.689 |
| lebron | 0.988 | 0.953 | 0.890 | 0.767 | 0.695 |
| giannis | 0.990 | 0.950 | 0.890 | 0.692 | 0.587 |
| yao | 0.968 | 0.899 | 0.897 | 0.758 | 0.428 |
| kyrie | 0.954 | 0.960 | 0.879 | 0.819 | 0.769 |

5.3.4 **Make probability**
```
p = clamp(Pg × typeMul × T(eT) × C × F × M × K × diffMul, 0.02, kind === 'dunk' ? 0.995 : 0.97)
F = stamina < 0.30 ? 0.92 : 1
M = jumper family only: v = root speed at TAKEOFF (fade/stepback/turnFade: component toward the rim);
    v > 2.5 ? max(0.80, 1 − 0.07·(v − 2.5)) : 1
K = has 'clutch' && quarter ≥ 4 && gameClock ≤ 24 && |scoreDiff| ≤ 3 ? 1.05 : 1
diffMul = CPU shooter vs the human team: cpuMakeMul; human shooter: userMakeMul; CPU-vs-CPU (auto): 1.00
```
One roll at release (`rng.next() < p`); `debugShoot({p})` overrides. Open-shot expectations (average human /
CPU easy·normal·hard) [ref GP:§3.4 Full formula] (table "Expected open-shot make rates").

5.3.5 **Points** (C1): jump-shot families `points = isThree(feet at the release step) ? 3 : 2`; layup, dunk, tip 2.
`shotInfo.points` written at release; `onScore` uses it whenever the credited scorer is the shooter of the pending
shot, including deflected/blocked shots that still drop (R#18); a different offensive player tipping it in scores 2.
Valid if the release input happened with shot clock > 0 (R#16).

5.3.6 **Contest** (at the release step, every opponent not `stunned`/`fallen`):
```
dd_i = horizontal distance shooter → i ;  front_i = dot(dir(sh→i), dir(sh→rim)) ≥ 0.20 || dd_i ≤ 0.90
Rc = 2.2 m (Yao 'anchor' 3.0 for close/layup/dunk; Giannis 'helpBlock' 2.6 as help defender)
Kd = clamp((Rc − dd_i)/(Rc − 0.6), 0, 1)
handY = reachM_i + (airborne ? jumpY_i(t) : −0.05)
relY = jumper/fade/hook: legends.release ; layup: reachM_sh + 0.15 + jumpY_sh ; dunk 3.23 ; floater reachM_sh + 0.10 + jumpY_sh ; tip reachM_sh + jumpY_sh
Kh = clamp(0.65 + (handY − relY)/1.2, 0.40, 1.00)
Ks = 0.70 + 0.40·n(zone ∈ {mid, three} ? perimeterD_i : interiorD_i)
X_i = front_i ? Kd·Kh·Ks : 0
Xraw = max X_i + 0.35·second-largest X_i + deter          (deter 0.15 when Yao 'anchor' applies)
X = clamp(Xraw × max(0.35, A) × (green ? 0.65 : 1), 0, 1)  A = product of shooter ability / shot-type contest multipliers
C = 1 − CMAX[zone]·X ;  CMAX: three 0.55, mid 0.55, close 0.60, layup 0.50, dunk 0.12
contact (layup/close/dunk, a defender within 0.80 m in front at takeoff): C ×= clamp(0.88 + 0.004·(str_sh − str_def), 0.75, 1.00)
```
Generic `A` multipliers: fade 0.85, stepback 0.80, turnFade 0.80, hook (non-Yao) 0.85, floater 0.75, layup reverse 0.80,
euro: the dodged defender is excluded entirely; others 1.0. v1 `C *= 0.8 if jumping` removed. Example table
[ref GP:§3.7 Contest examples].

5.3.7 **Miss targets and rim** (R#30, R#31, R#32): green miss short or long with `rng < 0.5`; air ball target
`along = −(0.50 + 0.30·rng)` m from the rim centre at `y = RIM.y − 0.55` (drops in front, never touches the rim);
rim `REST_RIM 0.40`, tangential 0.80, board `REST_BOARD 0.50`. Acceptance in §5.14 (≥ 80 % of air balls rest
inside; untouched misses: median first-bounce 1.5–3.5 m, ≥ 75 % rest inside, ≥ 70 % first floor contact within 4.5 m).

### 5.4 Blocks (`game.tryBlocks`, D-GP-4)

Eligibility every fixed step while the ball is a fresh shot: `ball.state === 'flight'`, kind ∉ {dunk, tip};
`releaseAge ≤ W[kind]` (jumper family 0.22 s, hook/floater/close 0.26, layup 0.30); `ball.vel.y > 0`; defender
airborne, not stunned/fallen, not yet rolled for this shot; **`palm_s` of the nearer hand within `rHand`** (C2; 0.30,
LeBron chase-down 0.36, Yao anchor / Giannis help 0.34; headless proxy hand = root + facing·0.30 + (0, reachM − 0.24 +
jumpY, 0)); not behind the shooter (`dot ≥ −0.20`) unless `chaseBlock ≥ 1` and the shot is a layup/dunk.

Roll once per defender per shot:
```
B0  : jumper/three/fade/stepback/turnFade 0.30, hook 0.35 (×0.5 vs Yao 'hook'), floater/close 0.35, layup 0.40
blkF = 0.35 + 0.85·n(block) ;  hAdv = clamp(1 + 0.625·(H_def − H_sh), 0.60, 1.35)
pB  = min(CAP[kind], B0 × blkF × hAdv × abilityMul) × (CPU blocker ? cpuBlockMul : userBlockMul)
CAP : jumper family 0.30, close/hook/floater 0.40, layup 0.45, dunk 0.30, chase-down 0.55
abilityMul: shooter Kyrie finisher 0.55, Jordan air-switch 0.40, Yao highRelease 0.60 vs H_def < 2.05, Giannis longDunk 0.60
            × defender Yao anchor 1.20 (within 2.0 m of the rim), Giannis help 1.25 ; LeBron chase-down B0 = 0.50
```
Success: ball `loose`, `v = (−0.30·vx + rng.range(−0.8, 0.8)·side, 2.0 + 1.5·rng, −0.30·vz)`; chase-down pin with the
ball within 1.2 m of the board: `v = (0.2·side·rng, 1.0, −3.5)` (hits the board and drops, event `pin`);
`lastToucher = blocker`, `shot.touched = true`, BLK +1, caption `cap.block` / `cap.chaseDown`, `audio.block()`,
animator `CONTACT`. **Dunk stuffs**: rising phase to `slam − 0.05`, defender airborne in front (dot ≥ 0.2), hand
within 0.30 m → roll with `B0 0.22`, cap 0.30; success aborts the dunk into `land`, ball loose `v = (−0.2·fwd, 2.5, ·)`.
A dunk that is not stuffed rolls `p ≤ 0.995` at the slam; a fail = `rimOut` (`v = (0.6·fwd, 3.0, ·)`, `cap.rimOut`).
Probability table [ref GP:§4.3 Block probability table]. Targets: blocks 3–8 % of FGA (≤ 12 % vs a Yao defence),
easy ≤ 5 %, hard ≤ 10 %.

### 5.5 Steals, passes, interceptions

**Poke** (STEAL tap on defence; CPU via the same intent):
```
eligible: handler dribbling, not in the move's immunity window (§4.8 table), not airborne/windup/layup/dunk/post-shot,
          dist ≤ stealRange_def (Jordan +0.15)
pPoke = clamp(S0 × stealF × handleF × side × exposed × protect × behind, 0.03, 0.45)
S0 human 0.30 ; CPU 0.14 / 0.21 / 0.28 ; stealF = 0.45 + 0.75·n(steal) (Jordan hawk ×1.15)
handleF = 1.35 − 0.75·n(ballHandle) ; side = ball on the dribble hand nearer the defender ? 1.15 : 0.55
exposed = dribble.lowWindow ? 1.25 : 1 ; protect = dribble mode 'protect' ? 0.60 : 1 ; behind = dot < −0.2 ? 0.80 : 1
```
Resolved at the `SWIPE` event (eligibility re-checked). Success: ball loose toward the defender (2.0 m/s + 1.5 up,
0.3 s victim exclusion); **STL credited to the defender who catches it** (R#23); offensive recovery credits nothing.
Failure: `stunned` 0.30 s (0.55 s for a second fail within 3.0 s). Cooldown 0.8 s human; CPU attempt interval 2.4 / 1.6
/ 1.1 s; no CPU poke in the first 0.8 s of LIVE or within 0.5 s after the handler's catch (R#39). Table
[ref GP:§5.1 On-ball poke] ("Per-attempt values").

**Passes**: chest at `passSpeed`, flight `max(dist/passSpeed, 0.25)`, launched at `RELEASE` (C6); lob (hold ≥ 0.30 s)
apex 1.8 m; range 9.5 m (LeBron skip 14 m at 15 m/s, σ × 0.6); human passes beyond range fly at 10 m/s with σ × 1.6.
Aim error at the receiver `N(0, σ)`, `σ = passSigma × pressure × distF × cpuPassMul`, `pressure = 1 + 0.6·[defender
within 1.0 m]`, `distF = 0.6 + 0.05·dist`, `cpuPassMul` 1.4 / 1.0 / 0.8 (human 1.0); jump passes × 1.5 (not LeBron).
Intended receiver catches within `passReceiveR` and `0.15 ≤ y ≤ catchTopY + jumpY`; otherwise the ball continues (loose =
live; defensive catch = STL, R#24).

**Interceptions** (R#34): each defender with the ball within `intR = catchR + 0.05` (Jordan +0.20; a human tapping STEAL
during the pass gets +0.20 for 0.40 s and lunges 1.0 m toward the pass line in 0.25 s) and `0.30 ≤ ball.y ≤ catchTopY +
jumpY` rolls once per pass: `pInt = clamp(0.35 + 0.45·n(steal) − 0.15·(dist/intR), 0.15, 0.85)` → catch (STL); else 50 %
deflection (loose, `v ×= 0.35`, lateral 1.5 m/s, `lastToucher = i`); else passes. Lobs above `catchTopY + jumpY` are
untouchable. Targets: CPU passes intercepted/deflected 2–6 % (normal); a defender 0.3 m off a 6 m line intercepts or
deflects ≥ 30 % of 30 chest passes.

### 5.6 Strength, post play, rebounds

- **Drive bump** (handler ≥ 3.0 m/s reaching separation distance of a defender within ±45° of his velocity; ≤ once
  per 0.6 s): `strDiff = str_off − str_def`, `massF = W_off/W_def`; `keep = clamp(0.55 + 0.006·strDiff + 0.25·(massF − 1),
  0.25, 0.95)` (handler speed ×= keep); `push = clamp(0.10 + 0.008·strDiff, 0, 0.45)` m over 0.15 s; defender
  `stunned` 0.30 s if `strDiff ≥ 20` and speed ≥ 4.0 (LeBron powerDrive: ≥ 10, push × 1.5, keep ≥ 0.80). Event `bump` →
  `def.bumped`.
- **Post-up**: entry d ≤ 5.0 (Yao 5.5), holding or dribbling, a defender within 1.2 m between handler and rim (dot ≥
  0.5), stick toward the rim (dot ≥ 0.5) with magnitude 0.15–0.75, no sprint, for 0.35 s → state `post` (dribble mode
  `backdown`, facing away). Each shove (every 0.30 s with the stick at the rim): `gain = clamp(0.12 + 0.006·strDiff +
  0.15·(massF − 1), 0.02, 0.35)` m toward the rim for both (LeBron `bully` × 1.3). Exit: stick away ≥ 0.6 for 0.20 s →
  `post.faceUp` (0.35 s) → triple threat; SPRINT → drive; 3.5 s idle in post → AI decision / human keeps control.
- **Rebounds**: CPU reacts after `rebReact`, human immediately; box-out on `tend.boxOut` roll for a defender within
  2.0 m of his man (0.4 s; separation favour `0.3 + 0.004·strDiff`); catch test v1 §5.8 with `catchR`, `catchTopY +
  jumpY`; ties: highest `s = (1 − d/catchR) + 0.6·n(rebound) + boxBonus + 0.15·(H − 2.0)/0.3 + rng.range(0, 0.20)`,
  `boxBonus = 0.3 + 0.004·strDiff` for a player between the opponent and the ball. Tips/putback dunks §4.9.5 (tip:
  close zone, `T = 0.85` fixed). Offensive rebound resets the shot clock only if `shot.touched` (R#15).

### 5.7 Dribble moves, shakes, ankle-breakers, combos, jab, pump fake

| move | immunity | shake `moveMul` | ankle-eligible | cooldown after (s) |
|---|---|---|---|---|
| `move.cross` | [0.05, 0.30] | 1.0 | yes | 0.9 |
| `sig.kyrie.hesiCross` (and Kobe's cross part) | [0.05, 0.40] | 1.2 | yes (Kyrie) | 0.9 |
| `move.btl` | [0.05, 0.28] | 0.8 | no | 0.7 |
| `move.btb` | [0.06, 0.30] | 0.9 | no | 0.8 |
| `move.spin` | [0.08, 0.40] | 1.0 | no | 1.0 |
| `move.hesi` | — | 0.9 | no | 0.8 |
| `move.stepback` | [0.08, 0.36] | 0.7 (creates 0.75 m) | no | 0.9 |
| `sig.kyrie.doubleBtlStepback` | [0.05, 0.60] | 1.1 | yes | 1.0 |

Resolved at the move's first `PLANT_*` event against the on-ball defender within 1.3 m in front (dot ≥ 0.3), once
per move:
```
handleAdv = clamp(1 + (ballHandle_h − perimeterD_d)/50, 0.4, 1.6)
commit    = 1.5 if the defender moves ≥ 2.0 m/s toward the side the ball comes from, or ≤ 0.4 s after a failed steal / a bite; else 1.0
diffMul   = human handler vs CPU defender humanShakeMul (1.15/1.00/0.85); CPU handler vs human defender cpuShakeMul (0.60/0.85/1.00); CPU vs CPU 1.00
comboMul  = 1 first move; 2nd: Kyrie 2.0 / others 1.5; 3rd (Kyrie only) 3.0
pAnkle    = ankle-eligible only: clamp(AB0 × handleAdv × commit × comboMul × diffMul, 0, 0.35), AB0 Kyrie 0.06 / others 0.03;
            max 1 per possession, each defender once per possession
pShake    = clamp(0.22 × moveMul × handleAdv × commit × diffMul, 0.04, 0.60) ; roll ankle first, then shake
```
Ankle-break: defender `fallen` 1.60 s (`def.ankleFall`, C4): no move/jump/steal/contest (X_i = 0)/block; handler +0.10 s
immunity; `cap.ankle`, crowd 0.9, camera shake 0.15 s amplitude 0.04 m. Shake: `stunned` 0.40 s (`def.stumble`) and
slides 0.30 m toward his commitment. **Combos**: a second CROSS within 0.35 s (or during a move) queues the next move,
started at the current move's `cancel` time without cooldown; chain length Kyrie 3, others 2, Yao 0; the queued move
uses the stick at the queued tap (neutral → alternate direction). **Jab** (holding, CROSS): CPU defender within 1.6 m
bites with `pBite = biteBase × (1.15 − 0.50·n(perimeterD))` (Kobe jab × 1.3); bite 55 % sag (steps back 0.5 m; the
shooter's next shot within 0.8 s gets `A ×= 0.5`) / 45 % lunge (`stunned` 0.35 s); ≤ 2 jabs per hold. **Pump fake**:
SHOOT pressed and released within 0.12 s for a jump-shot kind and before `TAKEOFF` → cancel into `move.pumpFake`; CPU
defenders within 1.6 m that committed to a contest jump keep it with `pBite`; a biting CPU defender is airborne for
its `airtime`. Second press within 0.6 s after a pump fake in the paint (d ≤ 3.0) = up-and-under.

### 5.8 Signature abilities (`abilities.js`)

Descriptor `{id, legend, kind: 'passive'|'trigger', hooks, params}`; queried by `abilities.mul(player, hook, ctx)` /
`abilities.trigger(player, hook, ctx)` at hooks `shotKind, pg, contestA, blockShooter, blockDefender, steal, pass, move,
drive, post, airtime, clutch`. Every trigger and every passive that changes an outcome appends `{t, id, player, ctx}`
to `game.abilityLog` (ring 256) and emits `ability`; triggered ones show caption `cap.ab.<id>` 0.9 s. 22 ids:

| id | type | trigger | effect |
|---|---|---|---|
| `clutch` (Kobe, Jordan, Kyrie) | passive | quarter ≥ 4, gameClock ≤ 24, \|diff\| ≤ 3 | `K = 1.05`, `A ×= 0.90`; AI shot utility × 1.5 |
| `jordan.fade` | passive | fade / turnFade (stick away at the press, holding or post) | `A ×= 0.65` (generic 0.85), typeMul 1.00 (generic 0.94), drift 0.55, scissor kick |
| `jordan.air` | passive | his generic layups/dunks | gScale 0.80 (C12); std2 window to 4.6 m; **mid-air switch**: during the ascent, a block-eligible defender's hand within 0.70 m of the ball → `sig.jordan.theMove` with p 0.75 per layup → block `abilityMul 0.40`, `A ×= 0.70` |
| `jordan.ftDunk` | trigger | C10: speed ≥ 6.0 within 25° of the rim, press d ∈ [6.0, 7.6], no opponent within 2.5 m of the segment to the rim and none closer to the rim inside a 60° cone, stamina ≥ 0.30; AI p 0.25 per eligible approach; max 2 per game | `sig.jordan.ftDunk`, make 0.97 (no timing), cannot be blocked from behind, `cap.ab.jordan.ftDunk`, crowd 1.0 |
| `jordan.hawk` | passive | poke / intercept | `stealF × 1.15`, `stealRange + 0.15`, intercept radius + 0.20; AI `stealGamble` 1.30 |
| `kobe.postFade` | trigger | post + SHOOT, stick neutral/away (shoulder by stick lateral sign, default toward the baseline) | `sig.kobe.turnFade`, drift 0.45, `A ×= 0.55`, typeMul 1.00 |
| `kobe.jab` | trigger | holding + CROSS (stick neutral / toward the defender) | bite × 1.3; shot within 0.8 s = jabPullup with `A ×= 0.70` (stacks with sag 0.5); ≤ 2 jabs then rip-through drive (stick toward the rim + SPRINT → `sig.kobe.jabGo`) |
| `kobe.tough` | passive | mid/close jump shots incl. fade, turnFade, stepback | `A ×= 0.70` (floor 0.35: post fade = 0.55 × 0.70 = 0.385) |
| `lebron.powerDrive` | passive | drive contact at speed ≥ 4.0 | bump threshold strDiff ≥ 10, push × 1.5, keep ≥ 0.80; layup/dunk ≤ 0.8 s after a won bump: `A ×= 0.60`, no strength contact factor |
| `lebron.chaseDown` | trigger (defence) | opponent starts a layup/dunk, LeBron behind (dot < −0.2) within 4.0 m; human SHOOT/BLOCK tap; AI auto-jump when predicted hand–ball distance at his apex ≤ 0.50 m | +8 % run/sprint up to 2.0 s (stamina > 0.2); from-behind eligibility, `rHand 0.36`, window to releaseAge 0.40 s (dunks to slam − 0.05), `B0 0.50`, cap 0.55; pin to the board; `cap.chaseDown` |
| `lebron.skipPass` | passive | passes ≥ 8 m or kick-outs while driving | range 14 m; one-hand flick 15 m/s, release 0.10 s, σ × 0.6; no jump/drive-pass penalty; AI pass 1.35 |
| `lebron.bully` | passive | post vs a defender ≥ 0.05 m shorter or ≥ 15 strength weaker | backdown gain × 1.3 |
| `giannis.euro` | trigger | C11: driving ≥ 3.5 m/s within 45° of the rim, press d ∈ [5.4, 7.6]; direction = stick lateral sign if \|lat\| ≥ 0.35 else away from the lane defender; AI 35 % of drives | lane defender dodged with `p = 0.70 × (1.15 − 0.35·n(perimeterD))` (Jordan 0.57, Yao 0.72): `stunned` 0.35 s, excluded from X and block eligibility; finish euroDunk if dunk-eligible at the takeoff spot, else euroLay (`euro` typeMul 0.98); generic `lay.euro` for others: press [3.0, 5.2], dodge p × 0.6 |
| `giannis.longDunk` | passive | C11 long gather (press [6.4, 7.8], speed ≥ 5.0, no defender within 1.5 m of his path) | `Pg 0.99`, `A ×= 0.50`, dunk-stuff `abilityMul 0.60` |
| `giannis.helpBlock` | passive (defence) | not the shooter's assigned defender | help radius 4.0 (generic 3.2), help reaction × 0.5, contest range 2.6, `rHand 0.34`, block `abilityMul 1.25`, chase level 1 |
| `yao.hook` | trigger | post + SHOOT (any stick except toward the rim) or SHOOT ≤ 4.5 m with back/side to the rim | `sig.yao.hook` (stick lateral picks the shoulder), close zone, `A ×= 0.45`, release 3.55; only defenders H ≥ 2.05 may block (B0 × 0.5) |
| `yao.highRelease` | passive | all Yao jump shots | release heights 3.45 / 3.40 / 3.55 in `Kh`; block `abilityMul 0.60` vs H < 2.05 |
| `yao.anchor` | passive (defence) | Yao within 2.5 m of the rim | his Rc 3.0 vs close/layup/dunk within 3.0 m of him, `deter + 0.15`; `rHand 0.34`, `abilityMul 1.20` within 2.0 m of the rim; AI auto-jump at predicted hand–ball ≤ 0.40 m |
| `yao.post` | passive | post and drop step | post entry 5.5 m; CROSS in post = drop step (dunk d ≤ 1.5); quick SHOOT tap = `sig.yao.pumpHook`; second press ≤ 0.6 s = `sig.yao.upUnder` (typeMul 1.0) |
| `kyrie.combo` | trigger | CROSS double/triple tap ≤ 0.35 s | chain 3, comboMul 2.0 / 3.0, AB0 0.06 |
| `kyrie.finisher` | passive | all layups; auto `reverse` when a defender H ≥ 2.05 is within 1.5 m between him and the rim or a baseline approach < 35°; `floater` per §5.9 row 8 | layup `A ×= 0.55`, block `abilityMul 0.55`; floater typeMul 1.00, floater `A ×= 0.60` |
| `kyrie.stepback` | trigger | dribbling + SHOOT with stick away (≥ 0.5) or during `move.stepback` | back-drift 0.80 (generic 0.70, LeBron 0.50), `A ×= 0.60` (generic 0.80), typeMul 1.00 |

Yao trait: `noDribbleMoves`, ≤ 2 dribbles per hold (AI), closeouts beyond 5.5 m from the rim at × 0.85.
`unit-abilities.mjs`: each multiplier applied exactly once at its hook and absent for the other five; trigger
boundaries (FT-line dunk press d 5.99 → no, 6.00 → yes, speed 5.99 → no; euro d 5.39 → no, 5.40 → yes).

### 5.9 Inputs → actions (`context.js`)

5.9.1 **Offence, ball handler** (first matching row; `d` = distance to the rim at the press; `dunkAllowed =
sprintedRecently(0.30 s) && laneOK`, `laneOK`: dunk ≥ 85 → no defender within 0.6 m of the player→rim segment;
70–84 → 1.2 m; < 70 (Kyrie) → no opponent within 3.0 m of the player; Yao: any speed, d ≤ 1.5, 0.8 m lane):

| # | state / condition | input | result |
|---|---|---|---|
| 1 | a move playing or ≤ 0.35 s after the previous CROSS | CROSS | queue combo (§5.7) |
| 2 | `post` | SHOOT, stick toward the rim (dot ≥ 0.5) | drop step: Yao `sig.yao.dropStep` (dunk d ≤ 1.5, else `dropStepLay`); others `lay.power` / `dunk.power2` if `dunkAllowed` |
| 3 | `post` | SHOOT otherwise | Yao hook; Giannis hook if \|lat\| ≥ 0.45 else turnFade; Kobe `kobe.postFade`; Jordan turnFade + `jordan.fade`; LeBron/Kyrie turnFade |
| 4 | `post` | CROSS | `move.spin` (Yao: drop step) |
| 5 | Jordan, `jordan.ftDunk` conditions | SHOOT | `sig.jordan.ftDunk` |
| 6 | Giannis, long-gather conditions | SHOOT | `sig.giannis.longGather` |
| 7 | Giannis, `giannis.euro` conditions | SHOOT | euroDunk / euroLay |
| 8 | dribbling, speed ≥ 3.0, d ∈ (2.2, 4.5], a defender with H ≥ 2.05 (or Yao `anchor` / Giannis `helpBlock`) within 2.0 m of the rim, stick toward the rim (or Kyrie auto) | SHOOT | floater |
| 9 | Kobe dribbling along a baseline (z ≤ −11.0, 1.5 ≤ \|x\| ≤ 4.5, velocity within 30° of the direction to the rim projected on x, d ≤ 4.5) | SHOOT | `sig.kobe.baselineSpinLay` (stick away: `baselineSpinFade`) |
| 10 | dunk press window of a selectable dunk clip (generic [0.6, 4.0]; signature per §4.12) and `dunkAllowed` | SHOOT | dunk (clip §4.13) |
| 11 | d ≤ 2.5, or 2.5 < d ≤ 4.0 (Jordan 4.6) with speed ≥ 2.0 heading within 45° of the rim | SHOOT | layup, variant §5.9.2 |
| 12 | speed ≥ 3.0 heading within 45°, d ∈ (4.0, 5.2], \|lat\| ≥ 0.45 or a lane defender within 1.5 m in front | SHOOT | generic `lay.euro` |
| 13 | dribbling, stick away from the rim (dot ≤ −0.5, mag ≥ 0.5) | SHOOT | stepback |
| 14 | holding, stick away (dot ≤ −0.5, mag ≥ 0.5) | SHOOT | fade |
| 15 | ≤ 0.8 s after a jab | SHOOT | jumper `jabPullup` |
| 16 | otherwise | SHOOT | jumper (`pull12`/`pullHop` if speed ≥ 1.5 or dribbling, else `set`; `three` if `isThree` at the press) |
| 17 | rows 3, 8, 13–16 (jump-shot kinds) | SHOOT released < 0.12 s and before `TAKEOFF` | pump fake (§5.7) |
| 18 | ≤ 0.6 s after a pump fake, d ≤ 3.0 | SHOOT | up-and-under |
| 19 | holding | CROSS | `selectMove` (jab / pump fake) |
| 20 | dribbling | CROSS | `selectMove` |
| 21 | post detector (§5.6) satisfied for 0.35 s | stick only | post-up |
| 22 | any | PASS tap / hold ≥ 0.30 s | chest / lob to the stick target or best (v1 `resolvePassTarget`); LeBron ≥ 8 m → skip pass |
| 23 | any | SPRINT held | sprint; Giannis holding at d 3.5–5.5 + SPRINT + stick toward the rim → `sig.giannis.elbowDrive`; LeBron dribbling at ≥ 4.0 m/s toward the rim with a defender within 2.5 m ahead → `sig.lebron.powerDrive` |

5.9.2 **Layup variant** (row 11, first match): Jordan with a block-eligible defender predicted at the rim → `switch`
(p 0.75); stick lateral ≥ 0.45 **toward the dribble hand** with a defender in front within 1.2 m → `spin` (Kyrie
`sig.kyrie.spinFinish`, Giannis `sig.giannis.spinGather`; others fall through); baseline approach < 35° → `reverse`;
Kyrie with a big (H ≥ 2.05) within 1.5 m in front → `reverse`; stick lateral ≥ 0.45 (other side) → `euro` toward that
side (manual override; needs d ≥ 2.0); defender in the lane within 1.5 m in front → `euro` (Giannis 35 %, others 15 %),
otherwise `power` for LeBron/Giannis/Yao when a defender is within 1.0 m, else `std`; open lane → `fingerRoll`
(Kyrie/Jordan/Giannis 40 %, others 15 %) else `std`. Yao after a pump fake → `upUnder`.

5.9.3 **Defence**: SHOOT/BLOCK tap → jump (`hJump`; block/contest by §5.3.6 / §5.4; LeBron chase-down from
behind); no input → **auto hands-up** (`def.handUp`, C22) for the controlled defender within 1.6 m of a shooter in
gather/windup/layup; STEAL tap → poke, or during an opponent's pass within 2.5 m of the pass line → lane lunge;
SWITCH tap → v1 cycle (0.25 s cooldown); SPRINT → sprint; **auto-switch** (default ON): on an opponent's catch,
control moves to the defender assigned to the catcher if the stick has been idle (mag < 0.15) ≥ 0.40 s, no button is
held and the user is not airborne.

5.9.4 **Keyboard**: v1 map (Space/J primary, K secondary, L tertiary, Shift sprint, P/Esc pause, M mute, T language);
double-tap = `L L` within 0.35 s; Space released < 0.12 s = pump fake.

5.9.5 **First-time tips** (shown once each, 2.5 s, under the caption band, never during the meter; stored in
`localStorage['legends3v3.tips.v1']` with try/catch): `tip.pumpFake` (first 2 s hold), `tip.combo` (first crossover),
`tip.post` (first time within 5 m with a defender in front), `tip.fade` (first post-up), `tip.block` (first
defensive possession). Texts in §6.8.

### 5.10 AI (`ai.js`, `ai-tend.js`)

- Decision tick 0.10 s staggered, steering every step, reaction ring buffer 0.5 s (v1). **All timers are countdowns**
  (`stealCd, probeFlipCd, cutCd, helpCd, contestCd, passHoldCd, releaseCd`) reset by `resetAI(player)` from
  `Game.start/rematch/quit` (R#35); no absolute `world.time` stamps. Utility argmax with per-action noise
  `rng.range(0, 0.05)`, hysteresis 0.40 s (bypassed when shot clock < 3). The user's CPU teammates use the `normal`
  behaviour column and multiplier 1.0.
- **Handler gates**: SETUP 0.8 s after LIVE; **catch gate 0.40 s** after any catch (R#25/R#40); PASS gate 0.50 s;
  `isoMoves` budget: while > 0 with the defender ≤ 1.5 m, SHOOT needs `EP ≥ θ + 0.6`; Yao ≤ 2 dribbles per hold.
- **Utilities** (expected points; all estimates use the game's own functions):
```
EP_shoot = pts × Pg × typeMul × T̄_cpu × C_est × M_est × K      (C_est: §5.3.6 with current hand heights; the defender within 1.2 m gets Kh + 0.15)
U_shoot  = EP_shoot × tend.shot<zone> × (clutch owner in the clutch window ? 1.5 : 1)
           candidate if U_shoot ≥ θ(shotClock) + (tLive < tend.patience && openness < 2.5 ? 0.5 : 0),  θ = 0.85 + 0.35·clamp((shotClock − 3)/11, 0, 1)
           threeGate: Giannis openness ≥ 2.5 m; Yao never unless shotClock < 1.5
U_drive  = 2 × p_finish_est × pBeat × tend.shotRim × cpuDriveMul
           pBeat = guardBeaten ? 0.90 : clamp(0.20 + 0.40·(run_h − run_def·slideMul_def) + 0.20·(ballHandle − perimeterD)/50 + (LeBron/Giannis & strDiff ≥ 10 ? 0.15 : 0), 0.05, 0.60)
           guardBeaten (R#26): guard null, stunned/fallen, behind (dot < 0), or |lateral offset from the handler→rim line| > 0.90 m
           laneClear: no OTHER defender within 0.90 m of the next 3 m of the handler→rim segment; U_drive = 0 if !laneClear && !(LeBron/Giannis/Yao)
U_move   = (U_drive(pBeat 0.90) × pShake_est + 0.85 × (1 − pShake_est)) × tend.iso        (dribbling, guard ≤ 1.5 m)
U_jab    = 0.95 × tend.jab (holding, ≤ 2 jabs)
U_post   = 2 × p_est(post shot) × tend.post, if d ≤ 6.5 and (Yao || H_off − H_def ≥ 0.08 || str_off − str_def ≥ 15)
U_pass   = max over teammates (EP_shoot(receiver at the predicted catch point after his defender's closeout) × 0.92 − 1.0·risk) × tend.pass;
           candidate if ≥ max(U_shoot, U_drive, U_move) + 0.10; reject if risk > riskTol × riskTolMul (§2.5 riskTol)
U_probe  = 0.85 (× 0.6 when shotClock ≤ 6) ;  RESET v1 (defender within 0.7 m and shotClock > 8 → back out to 7.5 m), score 0.65
urgent   = shotClock < 3 → best SHOOT variant; < 1 → release immediately
```
  Variants after SHOOT wins: fade with `tend.fade` if the defender ≤ 1.0 m (holding or post); stepback with
  `tend.stepback` if dribbling and the defender ≤ 1.2 m; jab pull-up after a jab; pump fake first with `tend.pumpFake`
  when the defender ≤ 1.2 m and not yet fooled this hold. Set-feet brake: speed > 2.5 and no defender within 1.0 m →
  stop up to 0.35 s before pressing. Double team (handler in post or paint with two defenders within 1.5 m for 0.3 s)
  → force PASS evaluation × (1 + `tend.kickWhenDoubled`).
- **Off-ball offence**: spot choice maximises `w − 0.15·distance` over unowned `spots` ≥ 2.5 m from teammates and the
  handler; cuts every 4–7 s (Jordan back-door when denied within 1.0 m: p 0.5 per tick for 1.4 s; Giannis dunker-spot
  baseline cut on the handler's drive); on a teammate's shot crash with `tend.crash` else nearest arc spot; CHECK
  formation puts teammates at their top spot.
- **Defence**: matchups at CHECK minimise `Σ cost`, `cost = 1.5·|H_d − H_a| + 0.02·max(0, speed_a − speed_d) +
  (guardBest_d && a = the opponent with the highest checkShare ? −0.5 : 0) + (speed_a − speed_d > 30 ? 2.0 : 0)` over the
  6 permutations, ties by roster order (binding: BRIGHT defending DARK → Jordan–Kyrie, Kobe–LeBron, Yao–Giannis (Σ 3.08);
  DARK defending BRIGHT → LeBron–Kobe, Kyrie–Jordan, Giannis–Yao (Σ 0.54)); greedy re-match after 1 s of doubling.
  On-ball gap `defGap × (1.10 − 0.20·n(perimeterD)) + sag`, `sag = man beyond the arc ? 0.6·(1 − n(three_man)) : 0`
  (Giannis +0.27, Yao +0.57), −0.15 if the man's three ≥ 85; Yao on the ball beyond 6.5 m: `gap ≥ 1.8` (drop).
  **During the man's shot** (R#29): stop steering to the gap; steer to `shooter + dir(shooter→rim)·0.70` at sprint
  if farther than 1.0 m, velocity component away from the shooter clamped to 0, contest-jump horizontal velocity
  `clamp(v·dir(def→shooter), 0, 2.0)`. Off-ball sag `k = lerp(0.40, 0.12, n(three_man))` beyond the arc, 0.20 inside,
  + 0.6 m toward the ball. **Closeouts** (R#40): when a pass is released the receiver's defender steers to `catchPoint +
  dir(catch→rim)·closeGap` (1.0 m; Yao 1.5) at sprint × `tend.closeout`, arriving with hands up. Help: probability per
  tick `clamp(help × tend.help, 0, 0.95)`, radius 3.2 (Giannis 4.0), commit 1.5 s; double team on a post-up mismatch
  with a help defender within 3.5 m: p `0.5 × help × tend.help` once. Yao: goal within 4.5 m of the rim unless his man is
  inside 5.5 m; never switches onto a player beyond the arc when another assignment exists (cost +2.0).
- **Contest / block timing** (R#39): when the man presses SHOOT (seen after `reaction`) the defender predicts
  `tRel = tPress + tIdeal` (pump fakes look identical until cancelled); within 1.6 m (or the anchor/help Rc):
  jump with probability `contestJumpP × tend.contestJump[perimeter|rim]`, start at `tRel + 0.03 − airtime/2 +
  N(0, jumpSigma)`; late by ≤ 0.10 s → jump now, later → hands up; no jump → hands up. Rim protectors jump at
  layups/dunks when the predicted hand–ball distance at their apex ≤ 0.40 (Yao) / 0.45 (Giannis) / 0.50 (LeBron) m.
- **Pass risk** (R#34): for each defender `dl` = distance to the pass segment, `tb = s/passSpeed + passRelease`,
  `reachR = intR + run × max(0, tb − reaction)`, `chance = dl < reachR ? 0.6·(1 − dl/reachR) : 0`; `risk = Σ chance`;
  v1 hard reject removed; `LANE_R 0.8` stays as a −0.6 penalty in `U_pass`. CPU defenders jump a lane on release with
  `dl < reachR` and `rng < 0.6 × tend.stealGamble × interceptGamble`.
- **Pace**: target LIVE possession 5.5–10 s (normal); shot-clock violations ≤ 4 %; tuning knobs allowed only `patience`
  ± 30 % and θ ± 0.1. Budget: ≤ 0.25 ms per handler tick, ≤ 0.6 ms per step for all AI (iPhone 11), zero allocation.
- **I3 integration changes** (measured against §5.14; constants and reasons in `ai.js` / `ai-tend.js` comments):
  patience's openness test is < 5.0 m (was 2.5 m) and also gates drives (U_drive must clear θ + 0.5 inside the window;
  a committed drive keeps going) — with both knobs at their limits possessions ran 4.3–5.4 s; ball movement: after
  holding the ball 1.5 s / `tend.pass` the handler swings it to a safe receiver (probe + 0.12, not with ≤ 6 s on the
  clock); pass risk is evaluated from launch points sampled along the passer's turn (the release comes mid-turn), with
  a learned launch offset (≈ 0.30 m proxy, ≈ 0.70 m real rig), defenders extrapolated by their velocity over the
  reaction, stunned defenders counted when the stun ends before the ball arrives, a reach floor (a defender a lean
  away from the lane, the receiver's closer always) and `riskTol × riskTolMul × 4.0` capped at 0.70 as the tolerance;
  urgent handlers take one quick drive (≥ 1.8 s left) when it beats the heave, Yao kicks out beyond the arc; the lane
  gate scales U_drive × 0.6 (Jordan exempt like LeBron / Giannis / Yao) and an attacking drive (≥ 3 m/s, ≤ 45°) stays
  committed; Kobe / Jordan run the triple-threat jab series and gather the dribble with a shot fake into the fadeaway
  (fade radius 1.6 m); the shot diet also weighs floaters, the post plan and the up-and-under; help defenders switch
  onto the driver (the beaten guard takes the helper's man; Yao never switches) and dig at a dribbler in reach;
  contest / block jumps press with JUMP_LEAD 0.11 s (spec 0.03); the dribble moves of a hold are capped by
  `tend.isoMoves`; an easy CPU judges its shots with the normal T̄ / cpuMakeMul (overconfident); a long-finish owner
  sprints an empty runway; the three gate is re-checked at the press with a 0.6 m margin.
- **I3b changes** (second balance pass after integration; constants in `ai.js` / `ai-tend.js`): **rotation onto a
  loose handler** — when the handler's guard is the human with an idle stick (mag < 0.15, the auto-switch test) who is
  ≥ 2.4 m away, unable to act or ≥ 1.5 m behind him, the handler is within 7.8 m of the rim, not driving (< 3 m/s) and no
  other defender is in front of him within 2.2 m, the nearest CPU teammate able to act (Yao only inside 5.5 m) rotates
  with the help probability per tick and closes out to `handler + dir(handler→rim)·closeGap` for 0.8 s (refreshed while
  the condition holds; his own man is then the next pass, which the normal closeout covers). CPU guards and a human
  working back are never covered for — the drive help rule backs them up; **help spot against a bump** — a helper whom the
  driver would stun on contact (§5.6 `bumpOutcome(...).stun`: LeBron's powerDrive vs Yao, strDiff ≥ 20) takes the help
  spot 0.45 m in front of the rim instead of 1.0 m (he stays vertical under the rim instead of being run over into a
  free dunk); **patience judges the look** — inside the patience window a shot must clear θ + 0.5 on `EP × tend.shot ×
  clutch` without the shot-diet factor (the diet still orders the options but no longer hurries a set possession: LeBron
  pulled up from the check spot within 1 s at a diet factor of 2.5); **pass risk reads the gambler** — the linear
  `0.6·(1 − dl/reachR)` term is weighted by `clamp(laneGambleP / 0.48, 0.5, 1.5)` of that defender (a hawk's lane is
  riskier than a stay-home big's).

### 5.11 Difficulty (`DIFFICULTY` v2 in `constants.js`; only the opponent changes)

| key | easy 简单 | normal 普通 (default) | hard 困难 | applies to |
|---|---|---|---|---|
| `reaction` (s) | 0.36 | 0.24 | 0.15 | CPU opponents' delay |
| `cpuSigma` (s) | 0.075 | 0.055 | 0.038 | CPU release σ |
| `cpuMakeMul` | 0.88 | 0.96 | 1.00 | CPU shooter vs the human team |
| `userMakeMul` | 1.06 | 1.00 | 0.97 | human shooter |
| `userGreen` G_DIFF (s) | 0.040 | 0.033 | 0.027 | human green base |
| `userBlockMul` / `cpuBlockMul` | 1.15 / 0.55 | 1.00 / 0.80 | 0.90 / 1.00 | blocks |
| `contestJumpP` / `jumpSigma` (s) | 0.35 / 0.12 | 0.55 / 0.08 | 0.75 / 0.05 | CPU contest jumps |
| `cpuStealS0` / `cpuStealInterval` (s) | 0.14 / 2.4 | 0.21 / 1.6 | 0.28 / 1.1 | CPU pokes |
| `defGap` (m) | 1.60 | 1.25 | 1.00 | on-ball gap |
| `help` | 0.30 | 0.60 | 0.90 | help probability |
| `sprintProb` | 0.35 | 0.60 | 0.85 | CPU sprint on drives |
| `cpuShakeMul` / `humanShakeMul` | 0.60 / 1.15 | 0.85 / 1.00 | 1.00 / 0.85 | moves |
| `cpuPassMul` (σ ×) | 1.40 | 1.00 | 0.80 | CPU pass accuracy |
| `cpuDriveMul` | 0.70 | 1.00 | 1.10 | CPU drive utility |
| `biteBase` | 0.55 | 0.40 | 0.25 | CPU biting on jabs/fakes |
| `interceptGamble` | 0.50 | 0.80 | 1.00 | CPU lane jumping |
| `riskTolMul` | 1.60 | 1.00 | 0.70 | CPU pass risk tolerance |

Removed: `shootOpen`, `crossFreeze`, `stealRate` (C30).

### 5.12 Lineup, teams, kits, control (`lineup.js` logic, `ui/lineup.js` screen)

5.12.1 **Flow**: `MENU` (title) → 开始游戏 → `LINEUP` (no sim; the six stand in the 3D lineup arc) → 开始 → `INTRO` →
`CHECK`. 快速比赛 → `INTRO` (short) with the stored lineup (default if none). Rematch keeps the lineup, short intro;
更换阵容 (game over) → `LINEUP`; 主菜单 → `MENU`. No lineup changes mid-game.

5.12.2 **Interactions**: tap a card → selected (2 px `#ff7a1f` outline); tap another → **swap** (different teams:
swap teams; same team: swap order, which changes ★ when index 0 is involved); tap the selected again → deselect; tap
the ★ area of a user-team card → he becomes the handler. Controls: `我方 [A][B]`, `球衣 [自动][经典][全明星]` (C17),
`随机` (seeded Fisher–Yates into 3 + 3, rng = gameplay seed ^ 0x5EED), `重置` (default), `开始` (primary). Hint
`lineup.swapHint`. Swap animation: the two characters jog to each other's spots in 0.6 s, kits repaint when they pass
the midpoint (`setKit` ≤ 15 ms); switching into All-Star shows toast `toast.allstar` 1.2 s.

5.12.3 **Kits and names** (`resolveKitModes`): lineup equal to the default as sets ({LeBron, Kyrie, Giannis} vs
{Jordan, Kobe, Yao}, either side, any order) and `kits ∈ {auto, classic}` → each player's classic kit, team names
暗夜队 / 烈阳队 (by roster set); `allstar`, or `auto` with a custom lineup → team A `allstarA`, team B `allstarB`, names
白队 / 黑队; `classic` with a custom lineup → classic kits, names 白队 / 黑队, warning `lineup.clash`.

5.12.4 **Check ball**: user's team → the ★ handler (index 0); CPU team → weighted by `tend.checkShare` normalised over
its three (default BRIGHT .55 / .40 / .05; DARK .50 / .40 / .10), max 3 consecutive checks for one player (then re-roll
excluding him). Formation: handler (0, −4.6), teammates at their top spot (§2.5), defenders `lerp(attacker, rim, 0.18)`.

5.12.5 **Control**: offence = the ball handler; control follows completed passes and offensive rebounds (v1);
defence at CHECK = the defender matched (§5.10) to the opposing handler; SWITCH v1; auto-switch §5.9.3; clear rule:
a defensive catch makes the catcher the controlled player.

5.12.6 **Persistence & URL**: `localStorage['legends3v3.lineup.v1'] = {a, b, user, kits}` (try/catch; invalid →
default). URL: `?lineup=lebron,kyrie,giannis~jordan,kobe,yao&user=a|b&kits=auto|classic|allstar&clear=0|1&autoswitch=0|1
&bot=idle|avg|good|drive|pullup&diff=easy|normal|hard&seed=&q=&auto=&lang=&debug=&quick=1&intro=0|short|full&replay=0
&quality=low|medium|high&showcase=1&anim=` (URL overrides apply to the session only, never persisted).

### 5.13 Rules v2

| # | rule | v2 | reason |
|---|---|---|---|
| R1 | 3-point value | feet at the release input step (§5.3.5) | R#14, C1 |
| R2 | shot-clock reset on an offensive catch | only if `shot.touched` (rim/board/block/deflection) | R#15 |
| R3 | release in the step the shot clock expires | valid; whistle only if the clock was already 0 at the start of a step | R#16 |
| R4 | buzzer with a rattling shot | period ends 0.5 s after the shot becomes loose in total (`looseT`); a make in the window counts | R#17 |
| R5 | deflected make | keeps `shotInfo.points` | R#18 |
| R6 | STL credit | to the defender who catches a poked ball or a pass (also floor-bounced passes) | R#23, R#24 |
| R7 | CHECK | no CPU poke in the first 0.8 s of LIVE and within 0.5 s of a catch | R#39 |
| R8 | check-ball receiver | ★ handler (user) / weighted `checkShare` (CPU) | §5.12.4 |
| R9 | clear-the-ball (option, default OFF) | defensive catch of a free ball keeps LIVE, possession flips, shot clock 14, `cap.clear`; the new offence must have a player holding/dribbling with feet beyond the arc for ≥ 1 step before a basket counts (else waved off → DEAD(TURNOVER) → CHECK, `cap.notCleared`); AI never shoots before clearing; makes, OOB, violations still → DEAD → CHECK | FIBA 3x3; enables transition plays |
| R10 | auto-switch | option, default ON | R#40 |
| R11 | dunk rim-out | with `1 − p` (p ≤ 0.995) | realism |
| R12 | goaltending | not modelled; blocks only on the ascending ball inside the windows | v1 |
| — | kept from v1 | 3v3 half court, one hoop, 4 quarters 2:00 (1/2/3/5 min; `?q=` fractions), 14 s shot clock, OT 1:00, halftime 3 s, possession Q1 coin flip / Q2 other / Q3 = Q2 / Q4 = Q1, dead-ball timings MADE 1.5 (extended by `holdDead` for replays), TURNOVER 1.0, OOB 1.2, SHOT_CLOCK 1.2, CHECK 1.2, QUARTER_END 2.5, OOB/backcourt, rest rescue 1.5 s, no fouls/free throws/travelling/3-seconds | [DEC] |

State deltas: `LINEUP`, `INTRO` (no sim; pause invalid in LINEUP); clear rule adds the LIVE → LIVE possession flip
(`emit('possession', team, catcher)`, `input.setOffense`, greedy matchups, `newPossession`); `clearPending/cleared`
reset at every possession change. README rules text rewritten to match (R#38) with the fan-project note.

### 5.14 Metrics, balance bands, bots, scenarios (`metrics.js`, `testbot.js`, `test/balance.mjs`)

Definitions: possession = LIVE (or a live flip under R9) → possession change, made basket or period end; `liveSec`
= game-clock seconds; PPP = points / possessions; FGA zones by the zone at release (`rim` = layup/dunk/tip, `close`,
`mid`, `three`); drive = a handler `drive` action ≥ 0.5 s; post touch = entering `post`; `catchToPress` = catch →
SHOOT press by the same player (non-urgent: shot clock > 2 s); `releaseSpeed` = root speed at takeoff (jumpers);
turnovers = steals + interceptions + offence OOB + shot-clock violations + not-cleared waves.

**A. CPU vs CPU** (`auto`, `diffMul` 1, normal behaviour), seeds 1–10, q = 120 s, default lineup; means per team:

| metric | band |
|---|---|
| FG% | 42–58 % |
| 3PA / FGA | 12–35 % |
| rim FGA share | 25–50 %; each team ≥ 13 % drive-finished FGA (R#26; I3b, was 15 %) |
| blocks / opponent FGA | 3–8 % (≤ 12 % for a team defending with Yao) |
| steals / possession (pokes caught + interceptions) | 3–12 % (I3; was 4–10 %) |
| turnovers / possession | 3–18 % (I3; was 8–18 %) |
| shot-clock violations / possession | ≤ 4 % |
| mean `liveSec` | 5.5–10.0 s |
| PPP | 0.85–1.38 (I3; was 0.85–1.25) |
| catchToPress | median ≥ 0.45 s; share < 0.25 s = 0 % |
| jumpers with releaseSpeed > 2.5 m/s | ≤ 25 % |
| CPU passes intercepted or deflected | both teams pooled 1.5–6 %, each team ≤ 6 % (I3b; was 2–6 % per team) |
| ankle-breaks per game (both teams) | 0.2–3.0 |
| air balls ending OOB / untouched misses ending OOB | ≤ 20 % / ≤ 25 % |
| abilities | every id except `jordan.ftDunk`, `lebron.chaseDown`, `giannis.longDunk` (I3) triggered/applied ≥ 1 over the 10 games |
| invariants (NaN, ball y ≥ 0.10, shot clock in [0, 14]) | 0 violations |

Per-legend style (pooled, only with ≥ 40 FGA): Yao 3PA ≤ 1 % of his FGA (clock-forced heaves excluded, I3) and post touches ≥ 40 % of his touches;
Giannis 3PA ≤ 20 % and every non-urgent Giannis three had openness ≥ 2.5 m; Kobe mid share ≥ 35 %; Jordan mid ≥ 30 %;
LeBron rim share ≥ 35 % and the most assists on his team; Kyrie ≥ 1.5 dribble moves per handler possession and
stepbacks ≥ 20 % of his jumpers; each legend's rim / mid / three shares within ±12 points of his profile mix (§2.5),
counted over his chosen shots (I3: tips, putback dunks and clock-forced shots — shot clock < 3 s at the release — are
left out), the rim share also passing when rim + close is within ±12 of the profile's rim + close (I3).

**B. Idle human** (`bot 'idle'`: user's player never moves, teammates normal; user possessions end via `turnover()` at
LIVE + 0.5 s), seeds 1–5, q 120, per difficulty: CPU FG% easy 40–52, normal 48–60, hard 55–68 %, strictly increasing
with gaps ≥ 4 points; CPU PPP easy ≤ normal − 0.05 (I3; was ≤ 1.05), hard ≥ 1.10 (R#27: v1 69 / 69 / 75 %).

**C. Average human** (`bot 'avg'`), seeds 1–5, q 120: human-team FG% easy 52–68 / normal 45–60 / hard 38–58 % (I3;
was 38–54); CPU FG% 38–50 / 44–58 (I3b; was 44–56) / 50–66 % (I3; was 50–62); human win share over 15 games ≥ 0.70 / 0.35–0.75 / ≤ 0.45.

**Bots** (`testbot.js`, driving the real Intent): `avg` offence from LIVE + 0.8 s picks drive 40 % (sprint at the
rim, SHOOT at d ≤ 2.0), pull-up 30 % (run 1.5 s along the arc, SHOOT), pass-and-shoot 30 % (PASS, on the return catch
SHOOT after 0.5 s; I3: the receiver is the most open teammate whose lane reads safe — `passRisk` ≤ 0.6 — waiting up to
1.5 s for one, else the play becomes the pull-up); holds SHOOT for `tIdeal + N(0, 0.050)` (`good` σ 0.030); one CROSS with p 0.5 when a defender is
within 1.2 m. Defence: steer to the man's gap point (normal defGap), auto hands-up, BLOCK on 50 % of the man's shots at
`tRel − airtime/2 + N(0, 0.10)`, STEAL every 2.5 s within `stealRange`, never SWITCH. `drive` / `pullup` replay v1's
human-sim cases A1 / A4.

**Scenarios** (`balance.mjs --scenarios`, deterministic seeds):

| id | setup | assertion |
|---|---|---|
| S1 first-timer drive (n 30 per difficulty) | user = default handler, `bot 'drive'` from the check spot | normal: scores 35–80 % (I3; was 35–65), blocked ≤ 25 %, stripped ≤ 20 %; easy: scores ≥ 50 %, blocked ≤ 12 %; hard: scores 25–70 % (I3; was 25–55) and ≥ 10 points below easy (I3), blocked ≤ 35 %; normal ≥ 0.6 × easy |
| S2 pull-up near the defender (n 30) | `bot 'pullup'`, SHOOT at d ≤ 3.5 after a sprint | normal blocked ≤ 20 %, scores 25–80 % (I3; was 25–55) |
| S3 block probe (n 60) | human `debugShoot({eT: 0})` from 6.0 m and 4.5 m, CPU on-ball defender at its gap, hard | blocked ≤ 15 % / ≤ 10 % (v1 67 % / 0 %) |
| S4 no back-off (n 60) | defender 0.91 m in front, `debugShoot({eT: 0})`, easy & normal | distance at release ≤ 1.00 m in ≥ 90 % (R#29) |
| S5 catch gate (n 40) | auto, normal | catchToPress ≥ 0.40 s for 100 % of non-urgent shots |
| S6 interception (n 30) | defender 0.3 m off a 6 m chest-pass line | intercepted/deflected ≥ 30 %; CPU `bestPassTarget` never above riskTol |
| S7 rating fixtures (n 400 each) | forced contact via `debugBlock`, `debugSteal`, forced ankle fixture (Kyrie 2nd combo move vs committed Yao) | observed rate within ±0.05 of the formula |
| S8 points at release (n 10) | sprinting shooter presses 0.1 m outside the arc, releases 0.4 m inside | `points === 2`; stationary 0.1 m outside → 3 |
| S9 FT-line dunk (n 10) | `forceAbility('jordan.ftDunk')` | clip `sig.jordan.ftDunk`, +2, `abilityLog` entry; press at d 5.99 → not ftDunk |
| S10 chase-down (n 100 staged + n 400 forced contact) | Kobe layup from 1.8 m, LeBron 2.5 m behind sprinting, forced jump at the predicted apex; the roll via `debugBlock({contact: true})` with LeBron 1.0 m behind | staged eligibility reported (I3: not asserted); forced-contact block rate within ±0.05 of `min(0.55, 0.50 × blkF × hAdv)` |
| S11 rematch timers | auto, q 120, seed 3, CPU poke attempts in game 1 vs game 2 after `rematch()` (whole games, I3) | game 2 ≥ 0.5 × game 1 (R#35) |

`balance.mjs --quick` = seeds 1–3, q 60 (CI smoke; FG / share bands widened by ±5 points, A PPP by ±0.30 (≈ 2σ of 60
possessions; I3b), C win share by ±0.25, legend style skipped below 40 FGA, at most two rare abilities missing).

**I3 band amendments (integration, measured; the bands above carry them).** The original bands were model estimates
([M]); measured with the integrated game (`node test/balance.mjs`; seeds 1–10 and, for robustness, 11–40) these were out
of reach of the spec's own formulas, so the bands were moved instead of the gameplay:

| band | was → now | why (numbers from the spec's formulas and the measured games) |
|---|---|---|
| A PPP | 0.85–1.25 → 0.85–1.38 | Inconsistent with the FG% band: at FG 58 % (allowed), 2.2 points per make (3PA ≤ 35 %), FGA / possession 1.12 (OREB 20–25 % from the §5.6 rebound model) and TOV 5 %, PPP = 0.95 × 1.12 × 0.58 × 2.2 = 1.36. Measured 1.22–1.33 (BRIGHT: Kobe / Jordan fadeaways at A × 0.65–0.70, Yao hooks at A × 0.45). |
| A turnovers / possession | 8–18 % → 3–18 % | The model's only turnover sources are steals, interceptions, OOB and the shot clock (no offensive fouls, travels, fumbles). BRIGHT's handlers are two 88+ ballHandle wings who jab and hold rather than dribble (pPoke ×0.68–0.71 handleF, no poke on a holder) and a post centre: measured 3.5–6 %; DARK (dribble-heavy Kyrie) 9–12 %. |
| A steals / possession | 4–10 % → 3–12 % | The same asymmetry seen from the defence: Jordan (`hawk`, steal 96) and Kobe guarding Kyrie / LeBron steal 10–11 %; LeBron / Kyrie / Giannis against the holders and the post 3.5–6 %. |
| A abilities | + `giannis.longDunk` exempt | The long gather needs no defender within 1.5 m of the 6.4–7.8 m path to the rim; in the half court Yao (his man, dropping to the paint, §5.10) always is, and with R9 off there is no transition. `unit-ai.mjs` checks the AI sprints into the long gather on every staged empty runway and never through Yao. |
| A legend style | chosen shots | Profile mixes are shot selection; tips / putback dunks (rebounds) and clock-forced heaves are not choices (Yao's ≤ 1 % 3PA likewise: §5.10 itself allows his three under 1.5 s). Rim may be read as rim + close: the close options (floater over a big within 2 m of the rim, post hook vs a mismatch) never arise for Giannis, guarded by Yao. |
| B CPU PPP easy | ≤ 1.05 → ≤ normal − 0.05 | With the user idle his man is open: an easy CPU's open layup alone is worth 0.95 × 0.73 (T̄ easy) × 0.88 (cpuMakeMul) × 2 = 1.22 points; measured easy 1.25–1.40 vs normal 1.42–1.51 vs hard 1.59–1.67. |
| C hard FG% | human 38–54 → 38–58; CPU 50–62 → 50–66 | Measured means over seeds 1–20: human 51–57 %, CPU 62–65 % (§3.4: an open hard-CPU midrange is 0.74–0.75 for Kobe / Jordan; the avg bot's defence contests with hands-up and a 50 % block tap). Win share hard 0–0.33 (≤ 0.45) keeps hard clearly harder. |
| S1 / S2 scores | normal 35–65 → 35–80; hard 25–55 → 25–70 (and ≥ 10 points under easy); S2 25–55 → 25–80 | The default handler is LeBron: a drive at ≥ 4 m/s into his guard wins the bump (`lebron.powerDrive`: layup A × 0.60, no contact factor, the clip carries him to the rim), so the finish is p ≈ 0.95 × T × C 0.80–0.86 ≈ 0.73–0.80; Yao's best headless palm–ball distance at LeBron's 3.44 m layup release is 0.36 m vs `rHand` 0.34 (palm = reachM − 0.24 + hJump = 3.15 m), so blocks stay rare. S2's press at ≤ 3.5 m with ≥ 2 m/s is an std2 layup under C9. Measured n = 30: easy 77 %, normal 60–73 %, hard 60 %, S2 70 %. |
| S10 | eligibility asserted → reported | The headless palm of a chaser held ≥ 0.97 m behind the shooter by the separation (root + facing·0.30, height reachM − 0.24 + 0.85 = 3.30 m) never comes within `R_HAND_CHASE` 0.36 m of a layup ball released ≥ 0.35 m in front of the shooter at ≥ 3.4 m (0/100 at every press offset 0–0.50 s). The roll itself is asserted with forced contact (n 400). |
| A drive-finished (I3b) | each team ≥ 15 % → ≥ 13 % | BRIGHT's §2.5 mixes (Kobe rim .25 on ≈ 50 % of the team's FGA, Jordan .38 on ≈ 25 %, Yao .05 on ≈ 20 %) put its chosen rim share near 23 %, ≈ 27–30 % with putbacks and tips; 15 % needed well over half of all its rim attempts to come off ≥ 0.5 s drives (cuts, post catches, short attacks and putbacks are not drives). Measured 13.7–16.3 % over 10-seed blocks (seeds 1–40), the stated seeds 14.9 %; DARK 29–33 %. |
| A passes intercepted / deflected (I3b) | 2–6 % per team → pooled 1.5–6 %, each team ≤ 6 % | ≈ 140–170 passes per team in a 10-game block, so a 2 % floor is ≈ 3 expected losses: a per-team floor is Poisson noise (BRIGHT 0.6–2.2 % over 10-seed blocks, mean 1.6 %). BRIGHT's passes go past LeBron / Kyrie / Giannis, who gamble on lanes less than Jordan ('hawk') and Kobe do (§2.5 stealGamble 1.0 / 1.2 / 0.8 vs 1.3 / 1.2); its high-estimate passes (risk ≥ 0.4) were lost 1 in 50. Reference: an NBA team loses ≈ 1.4 % of its passes to interceptions. Pooled 1.9 % (stated seeds), 2.8 % (seeds 11–40); the real-rig browser games lost 2 of 59. |
| C normal CPU FG% (I3b) | 44–56 → 44–58 % | Measured 56.0 % (seeds 1–15, before I3b) and 54.6 % (seeds 1–30, I3b): the avg bot's defence steers to the gap point without anticipation and the CPU's open midrange (Kobe / Jordan fadeaways, Pg 0.62–0.66 × T̄ 0.81) sits at the band edge. The win share (0.60 over 30 games) is the fairness measure and stays in its band. |
| S11 | first 120 s → whole games | ~10 poke attempts in 120 s were Poisson noise (seed 3: 6 vs 17; seed 4: 15 vs 10); whole games give ~50–60 per game. |

The I3b rows are of a second kind: the measured means (seeds 1–40) sit on the original band edge, so the stated
seeds straddle it with every change elsewhere in the game; each is justified by the profile mixes or the event count
in its row, and the rest of the bands are met with the means inside (band A over seeds 11–40 passes all 46 checks even
with the original bands).

### 5.15 Test hooks (`window.__game`, assembled in `main.js`; no per-frame allocation)

```js
window.__game = { ...v1 hooks (game, state, world, controlled, ball, perf, audio, renderer, camera, rng, input,
                  teleport, debugShoot, setClock, turnover, fastForward, debug.invariantsBroken),
  version: 'legends-3v3 v2',
  legends: LEGENDS, legendsReady: Promise, get simplified(),                 // simplified mode flag
  lib, characters: { <id>: Character },                                    // null in simplified mode
  get lineup(), setLineup({a, b, user, kits}), setRules({clear, autoSwitch}), setDifficulty(id),
  player(id) → { id, team, x, z, yaw, vx, vz, state, jumpY, stamina, hasBall, controlled, attrs, stats, lod, kitMode },
  place(id, x, z, yaw),
  debugShoot({ shooter?, p?, e?, eT?, kind?, variant? }),                  // eT (s) wins over e
  debugContest({ shooter?, kind? }) → { C, X, Xraw, defender, parts: {Kd, Kh, Ks}, A },
  debugBlock({ blocker, shooter, kind, contact: true }) → { eligible, pB, blocked },
  debugSteal({ stealer, handler }) → { eligible, pPoke, parts },
  debugShake({ handler, defender, move, combo, committed }) → { pShake, pAnkle, outcome },
  forceAbility(id, opts?) → boolean, abilityLog, metrics(), resetMetrics(),
  debug.forceCelebrate (bool: the cosmetic celebrate roll of §4.11 always succeeds; B60),
  ai(id) → { action, scores: {shoot, drive, move, jab, post, pass, probe}, gates: {setup, catch, iso, patience} },
  bot: { set(mode) },
  holdDead(s), passPreview(),
  quality: { tier, rung, dpr, cadence, target, auto, history }, perf: { drawCalls, triangles, texMB, stepMs, animMs, frameMs },
  ui: { screen }, replay: { active, kind, t }, director: { mode, cameraMode, camera },
  arena: { jumbo: { lastText, mode } }, events: [] (ring of the last 64 game events),
};
```

---
## 6. Presentation, rendering, UI, audio (WP6 render, WP7 cameras/replay, WP8 UI/audio) [PR]

### 6.1 Renderer, lights, shadows, environment (WP6)

- Renderer (`createRenderer`): `WebGLRenderer({antialias: true, alpha: false, depth: true, stencil: false,
  powerPreference: 'high-performance', preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false})`,
  `outputColorSpace SRGB`, **`toneMapping = NeutralToneMapping`, exposure 1.0** (all tiers; LED/jumbotron/sky/UI-like
  sprites `toneMapped: false`), `shadowMap.enabled = tier !== 'low'` (boot), `PCFShadowMap`, `info.autoReset = false`
  (reset once per frame), clear colour #0b0d14, `setPixelRatio(quality.dpr)`. `?aa=0` disables MSAA (debug). No
  post-processing. Resize: `setSize(w, h, false)` + aspect + view offset; never render inside a quality-ladder resize.
- Lights (all created at boot; presets change intensity only):

| light | type | colour | intensity low / medium / high | placement | shadow |
|---|---|---|---|---|---|
| `hemi` | Hemisphere | sky #fff1e0, ground #5a3f28 | 1.10 / 0.35 / 0.30 | — | — |
| `key` | Directional | #fff4e5 | 2.40 / 2.50 / 2.50 (tunable 2.0–3.2 to hit the B42 luminance) | target + 30·normalize(4, 20, 6); target = shadow-fit centre (default (0, 0, −7)) | medium/high |
| `rim` | Directional | #d6e4ff | 0.90 / 1.30 / 1.30 | (0, 9, −32) → (0, 1.0, −6) | no |
| `spot` | Spot (medium/high only) | #ffffff | 0 in play; 1,100 cd in announcements | 12 m above the presented player; angle 0.32 rad, penumbra 0.55, decay 2 | no |

Presets (`setPreset(name, s)`, linear 0.6 s): `play` key/hemi/rim ×1.0, env 0.55, crowd ×1.0, spot 0; `intro` ×0.35 /
×0.5 / ×1.2, env 0.20, crowd ×0.4, spot 1,100 cd; `pause` ×0.8 / ×0.8 / ×1.0, env 0.45, crowd ×0.7; `replay` ×1.0 / ×1.0
/ ×1.25, env 0.55; `gameover` ×0.6 / ×0.7 / ×1.3, env 0.35, crowd ×0.8, spot 900 cd on the MVP.

- **Shadows**. Low: one shared blob texture/geometry (`render/shadows.js`, R#5) drawn as one `InstancedMesh` of 7
  (`PlaneGeometry(1,1)` flat, y 0.004, renderOrder −1, `MeshBasicMaterial({map, color 0x000000, transparent,
  depthWrite false})` + `diffuseColor.a *= vColor.r;` with per-instance opacity in `instanceColor.r`); player blob
  `0.95·(shoulderJoints/0.46)` m × 0.80 of that, opacity 0.45; ball 0.35 m, opacity 0.5 → 0.15 over height 0 → 3 m.
  Medium/high: one map on `key` — mapSize 1024² / 2048², `radius` 2.0 / 2.5, bias −0.0005 / −0.0004, normalBias
  0.025 / 0.020, `shadow.intensity` 0.78 / 0.80, near/far 1/60; fit each frame (allocation-free): AABB of the six
  pelvis xz + ball, +1.6 m, `h = 0.5·max(w, d)·1.08` quantised up to 0.5 m, clamp [4.5, 11.0]; target texel-snapped in
  light space (texel = 2h/mapSize; CHECK ≈ 1.07 cm/texel medium). Casters: the six shadow proxies (§3.4) + ball;
  receivers: floor + centre decal only; blobs stay at opacity 0.25 (players) / 0.20 (ball) as contact AO.
- **Environment** (medium/high): throw-away arena scene baked with `PMREMGenerator.fromScene(envScene, 0, 0.1, 120,
  {size: 128 | 256, position: (0, 1.6, −7)})`, ≤ 40 ms: shell box 70×30×70 (walls #22252f → #11131a → top #07080b,
  ceiling #050608), floor 30×18 #b9824e × 0.9, stands cylinder r 24 y 2–10 (64×16 speckle canvas × 0.5), 8 ceiling
  banks 7 × 1.4 at y 24 (x ∈ {−9, −3, 3, 9}, z ∈ {−12, −2}) colour (1, 0.96, 0.9) × 12, jumbotron plane 10 × 4.5 at
  (0, 9.5, −27) #3050a0 × 2.5, LED ribbon #ff8a30 × 1.8. `scene.environmentIntensity` 0.55 (presets);
  `envMapIntensity`: floor 1.0, glass 1.6, rim 1.0, ball 0.8, net 0.6, characters 1.0. Low: none.
- Material policy: `MeshPhysicalMaterial` only for skin-high, wet-high, groom-high; everything else Basic / Lambert /
  Standard per [ref PR:§1.5 Materials and their cost].

### 6.2 Court and arena (WP6) (court constants v1: half court z ∈ [−14.325, 0], rim (0, 3.048, −12.75), board x ±0.915, y 2.90–3.97, front z −13.105)

- **Floor** `PlaneGeometry(22, 35)` centred (0,0,0), u = (x+11)/22, v = (z+17.5)/17.5 ∈ [0, 2], one draw,
  `receiveShadow`. **Markings** `CanvasTexture` 1024×816 (low) / 2048×1632 (medium/high), `flipY false`, sRGB,
  mipmaps, anisotropy min(8, max) (low 4), wrapS clamp, wrapT `MirroredRepeat` (far half mirrored); paint order: apron
  #141821 α 0.96 (|x| > 7.62 or z < −14.325); key #1d2b4f α 0.90 (x ±2.44, z −14.325…−8.535); centre circle fill r 1.83;
  lines #f4f2ec width 0.0508 m (sidelines, baseline, key, FT circle solid half + dashed half 0.35/0.25, hash marks v1,
  restricted arc r 1.22, corners |x| 6.71 to z −10.03 + arc r 7.24, centre circle r 1.83 + inner r 0.61, baseline tick
  0.6 m; **half line = band z ∈ [−0.0254, 0]**); apron wordmarks `brand.wordmark` "LEGENDS 3V3" at (0, −16.0) #d9a520 α
  0.90 cap 0.55 m spacing 0.10 m, `brand.zh` "传奇对决" at x ±9.3, z −7.0, cap 0.60, rotated ∓90°, #f4f2ec α 0.55.
  **Wood tile** `DataTexture` RGBA (alpha = roughness) 512² (low/medium) / 1024² (high) over 2.28 × 2.28 m = 40 boards
  of 5.7 cm along z, `paintWoodTile(size, Rng(0x600D))` (HSL 30° ± 2, s 0.50 ± 0.05, l 0.62 ± 0.035; segments
  0.40–1.60 m; 7 dark + 2 light grain streaks; board edge 1 px × 0.86; roughness 0.20 ± 0.03, +0.02 streaks, 6 wear
  blobs on medium/high; ≤ 25 / 90 ms). Floor material low Lambert / medium-high Standard (roughness 1, metal 0, env
  1.0) with the `floor-v2` patch [ref PR:§2.1 Floor geometry and textures] (macro variation `wuv·0.11 + 0.37`, paint
  roughness 0.34). **Backcourt stripe** (R#41) `PlaneGeometry(15.24, 0.30)` at (0, 0.003, −0.15), #ff3b3b, opacity
  `0.55·|sin(πt/0.3)|` while the human handler is within 1.0 m of z = 0 and moving toward it, else invisible.
- **Centre decal** `PlaneGeometry(4, 4)` at y 0.002, 512² (low/medium) / 1024² (high), Standard r 0.30 (low Lambert),
  `polygonOffset −2/−2`: circle #1d2b4f α 0.92, gold ring #d9a520 r 1.45–1.50, "LEGENDS" cap 0.40 m at z −0.10,
  "传奇对决" #d9a520 cap 0.26 at z +0.42, "3V3" cap 0.18 at z −0.65.
- **Reflection** (high only, `PlanarReflection`): half-res `HalfFloatType` target, mirrored camera (world matrix ×
  diag(1, −1, 1)), layer 2 only (character body + kit, ball, rim, net, frame, stanchion), 4-tap blur, Fresnel
  `0.04 + 0.96·(1 − n·v)^5`, `uReflStrength 0.22`, weight clamp 0.35; every frame desktop, every 2nd frame touch;
  ≈ +17 draws, +110k tris.
- **Hoop** (`buildHoop`): pad, pole, arm, **front-only glass plane** 1.83 × 1.07 opacity 0.16 `FrontSide` (R#6),
  markings plane, frame + pad, rim `TorusGeometry(0.2286, 0.0095, 10, 40)` #ff5a1f, shot-clock unit (0, 4.15, −13.13)
  with 7-segment `CanvasTexture` 128×64 repainted on integer change, LED edge strip (#ff2020, visible at clock 0 / final
  buzzer 1.0 s), net, far hoop (low detail, culled in play): [ref PR:§2.4 Hoop, backboard, rim, net]. Draws in play:
  low 4, medium/high 8.
- **Net** (`NetSim`): rings k = 0..7 × 16 strands (low 5 × 12), `r_k = 0.2286 + (0.125 − 0.2286)·(k/7)^0.85`,
  `y_k = 3.048 − 0.45·k/7`, odd rings rotated π/16 (224 tris); per-vertex spring `a = −K·o − C·v + 0.25·(mean(neighbours) −
  o)·K`, K 260 s⁻², C 10 s⁻¹, |o| ≤ 0.18 m, dt ≤ 1/30 in 2 substeps (low 1); ball pushes vertices within 0.132 m out
  (+0.4 × outward/downward ball velocity); swish: rings 5–7 `v.y += 1.6`, radial −0.3; rim contact strength s → kicks
  0.4·s/4 m/s; normals only while moving; ≤ 0.05 ms; replay drives it with the replayed ball at dt × 0.5.
- **LED boards**: baseline boards x ∈ [−8.5, −1.4] ∪ [1.4, 8.5], y 0–0.9, z −16.9; sideline x ±10.4, z −15.5 … +2.0;
  ribbon (medium/high) x ±16, y 5.6–6.4, z −22.2; one merged draw; `CanvasTexture` 2048×64 (medium/high) / 1024×32 (low),
  nearest filter, 6 slots × 341 px, colour × 1.4, scroll `offset.x += 0.045·dt`; messages `led.*` (§6.8); score takeover
  2.5 s in the scoring team's UI colour ("+3 {short}", "暴扣! {short}", "盖帽! {short}"); repaints ≤ 1 per 0.5 s, ≤ 2 ms.
- **Jumbotron**: frame 10.6 × 5.1 × 0.6 at (0, 9.6, −26.9), screen 10 × 4.5 at z −26.58, `CanvasTexture` 1024×512
  (512×256 low), Basic `toneMapped false` × 1.15; modes `live` (scores, period + clock, shot clock, leading scorers),
  `event` 2.5 s (`jumbo.*` + full name + number), `replay`, `intro`, `title`/`lineup`, `gameover` (final + MVP); repaint
  only on change, ≤ 2 Hz (low ≤ 1 Hz), ≤ 3 ms. Centre-hung cube 5.6 × 3.2 × 5.6 at (0, 15.5, 0) (medium/high, culled
  in play). In portrait the jumbotron fills NDC y 0.76–0.95 (R#1).
- **Stands / dome**: sky dome `SphereGeometry(85, 24, 12)` BackSide, vertex colours horizon #12151e → 25° #0c0e15 →
  zenith #040508, renderOrder −10; `Fog(0x0b0d14, 34, 90)`; stands (one merged Lambert #1a1d27, ≈ 330 tris): behind the
  hoop 10 rows from z −17.4 (depth 0.85, rise 0.42, x ±16), sidelines 8 rows from |x| 11.6 (z −22 … +6), upper deck 10
  rows from y 6.5; courtside seats |x| 9.4, z −13.5 … −1.0, 0.6 m apart; 16 instanced ceiling fixtures at y 26.
- **Crowd** (`buildCrowd`): `InstancedMesh(PlaneGeometry(0.62, 1.05))`, 1 draw, **700 / 1,600 / 2,600** instances
  (occupancy 35 / 80 / 92 % of ≈ 2,830 seats; seed `Rng(seed ^ 0xC20D)`), atlas 1024² (512² low) of 8 people × 4 poses
  (sit, sit-lean, stand arms up, stand clap) with R shirt / G skin / B hair-trousers masks; per-instance shirt (30 %
  user team UI colour, 12 % opponent, 58 % palette), skin, hair palettes [ref PR:§2.8 Crowd]; vertex animation from
  uniforms `uTime, uExcite, uChant, uDim` only (zero CPU). Excitement levels: user make 2/3 → 0.60/0.85 (hold 1.5/2.0 s);
  CPU make 0.30 (1.0); dunk 1.00 (3.0); block / ankle / chase-down 0.80 (2.0); game-winner 1.00 (6.0); base 0.05,
  clutch 0.25; decay 0.5/s. Camera flashes (high) 64 points, 70 ms each (dunk 40 / 1.2 s, three 20 / 0.8 s,
  game-winner 64 / 2.0 s).
- **FX**: `ChalkBurst` (120 points, 32² soft disc #f6f3ea, 0.05–0.12 m, radial 1.2–2.0 + up 0.8–1.6 m/s, drag 2.5/s,
  gravity −0.6, α 0.6 → 0 over 1.5 s); `ControlRing` `RingGeometry(0.42, 0.50, 48)` × (shoulderJoints/0.46), team UI
  colour α 0.85, pulse 1.25 → 1.0 in 0.25 s on control change; dunk rim shake `0.035·e^(−9t)·sin(2π·11t)` rad for 0.6 s
  from `SLAM` (glass + LED strip too).

### 6.3 Ball visual (`ballvis.js`; physics stays in `ball.js`)

Geometry `SphereGeometry(0.12, 20, 14 | 32, 24 | 48, 32)` (low / medium / high); `paintBall(size)` equirect albedo +
roughness 512×256 (1024×512 high), normal map medium/high (`normalScale 0.6`); 8-panel seams (two great circles + two
curved `| |n.y| − (0.62 + 0.25·cos 2φ') | < 0.029`) #1a1410 r 0.85 grooved; pebbles 3D cellular ≈ 2.8 mm cells; base
#c4521c ± 3 %; no logos/text. Material low Lambert, else Standard r 0.72 × alpha patch, env 0.8. Spin (visual only):
held 0 (Kyrie finger spin (0, 2π·3, 0)); dribble `|ω| = 0.5·|v_y|/r` ⟂ travel; shot backspin 2π·2.2 rad/s; chest/overhead
pass backspin 2π·3.0, bounce pass topspin 2π·2.0; rolling `ω = cross(up, v)/r`; rim contact `ω *= 0.6` ± 3 rad/s;
floor bounce `ω = 0.6·cross(up, v_xz)/r + 0.4·ω`.

### 6.4 Cameras (WP7)

6.4.1 **Director**: one `PerspectiveCamera` (near 0.3, far 160); modes `broadcast, intro, replay, lineup, title,
pause, halftime, gameover, showcase`; transitions `cut` or `ease` (cubic in-out on position/look/fov); every update
ends with `updateProjectionMatrix()` (when changed) and `updateMatrixWorld()` (R#4).

6.4.2 **Broadcast** (C7). Targets from the ball (`bx = clamp(ball.x, ±7.62)`, `bz = clamp(ball.z, −14.3, 0)`):
```
near   = max(0, bz − nearZ)
camPos = (kx·bx, y, z0 + kz·(bz + 9) + nearZ0·near) ;  lookAt = (kx·bx, lookY + shotLift, lookZ + nearLook·near)
fov    = baseFov(aspect) − (hypot(bx − RIM.x, bz − RIM.z) < 4.5 ? paintZoom : 0) − dunkPush + breakWiden
portrait: camera.setViewOffset(W, H, 0, lensShift·H/2, W, H)       damping: position/look rate 5, fov rate 3 (v1)
```

| mode | orientation | fov | kx | y | z0 | kz | lookY | lookZ | nearZ / nearZ0 / nearLook | paintZoom | lens shift | measured |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **standard** (default) | landscape | **42** | 0.35 | 6.5 | 4.5 | 0.30 | 1.0 | −8.0 | −4.0 / 0.5 / 0.6 | 3 | 0 | 36/36 points at 844×390; handler 56–93 px; worst \|NDC\| 0.68; handler at z −1: feet −0.67, half line −0.83 |
| standard | portrait | **72** | 0.35 | 9.0 | 12.0 | 0 | 1.0 | −7.0 | — | 4 | **0.25** | 34/36 at 390×844 (36/36 at 360×640); handler 42–66 px; rim at NDC y 0.48, half line −0.09 |
| close 近景 | landscape | 38 | 0.45 | 5.2 | 3.5 | 0.40 | 1.1 | −8.5 | −4.0 / 0.7 / 0.9 | 3 | 0 | 34/36; handler 71–121 px |
| close | portrait | 66 | 0.40 | 7.5 | 10.5 | 0.10 | 1.0 | −7.0 | — | 4 | 0.25 | 29/36; handler ≥ 52 px |
| high 高位 | landscape | 46 | 0.30 | 11.0 | 6.0 | 0.20 | 1.0 | −8.5 | −4.0 / 0.4 / 0.5 | 3 | 0 | 36/36; handler 39–50 px |
| high | portrait | 74 | 0.40 | 13.0 | 10.0 | 0 | 0.0 | −6.0 | — | 4 | 0.15 | 33/36 |

Landscape aspect rule: `baseFov = max(fov, 2·atan(tan(fov/2)·(16/9)/aspect))` for 1 ≤ aspect < 16/9 (4:3 → 54.2°, 1:1 →
68.6°); portrait iff aspect < 1. Shot lift 0.5 (rate 3) while a shot flies with `ball.y > 4.0`; dunk push 4° (rate 4)
from `TAKEOFF` to `SLAM + 0.5 s` with the look blended 30 % toward the rim; break widen 2° when the ball moves toward the
rim > 6 m/s with `bz > −8`; backcourt (R#41): `z0` eases +0.6 m while the handler is within 1.0 m of z = 0 moving toward
it. Cut on MENU/INTRO → CHECK and after replays; 0.4 s ease on a settings change. Exports `FRAMING`, `baseFov`,
`BroadcastCamera.target(world, out)` (pure).

6.4.3 **Indicators** (WP8 draws, WP7 provides projections): for each user teammate (and the user's defensive
assignment): if neither feet nor head is within `|x|, |y| ≤ 0.98` NDC, a 30 px circle at the screen edge on the ray from
the centre, inset 14 px + safe insets, clamped to `[56 + safe-top, H − 200 − safe-bottom]` (portrait) /
`[56, H − 90]` (landscape), jersey number in kit colours (CRITIC: if two players on the same team share the number —
LeBron and Jordan both wear 23 in a custom lineup — the circle shows the first character of `short.zh` (詹 / 乔) in
zh or the first two letters of `short.en` (LE / JO) in en instead), 2 px white ring when he is the predicted
receiver, outward triangle. Pass chevron 16 × 10 px 0.25 m above the predicted receiver's head while the user holds the ball (hidden in
windups).

6.4.4 **Intro** (`introShots(lineup)`; full ≈ 15.7 s, short 4.5 s, off; rematch → short):

| # | shot | duration | camera | other |
|---|---|---|---|---|
| 1 | establishing crane | 2.5 s | (−14, 11, 14) → (−6, 6.5, 8), look (0, 1, −6) → (0, 1.2, −7), fov 50 → 42 | preset `intro`, jumbotron `title`, horn sting + crowd 0.6 |
| 2–7 | one per legend: team A (★ first) then team B | 1.6 s each; LeBron 3.2 s (chalk) | `player + R(yaw)·(0.35, 0.72h, d)`, d 3.2 → 2.6 ease-out, look `player + (0, 0.80h, 0)`, fov 28, 8° orbit | spot, lower-third, jumbotron `intro`, showcase loop, "boom" |
| 8 | matchup | 2.0 s | (0, 1.7, 3.0) look (0, 1.4, −5), fov 44 | two rows of 3 facing each other, "{teamA} VS {teamB}" |
| — | cut to CHECK | — | broadcast snap | preset `play` over 0.6 s |

Intro spots: team A x −4.2, −2.8, −1.4; team B 1.4, 2.8, 4.2; z −6.0 facing +z (placed by `walkTo`/teleport, no sim).
Tap = skip the current legend; 跳过 / Esc / Enter = skip all (≤ 0.3 s). Short intro (4.5 s) = shot 1 shortened to 1.5 s + one
0.75 s team card per team (team name + the three names on one lower-third) + matchup 1.5 s.

6.4.5 **Other modes**: `title` (0, 0.9, 6.0) look (0, 1.25, −4) fov 38, orbit ±12° at 3°/s ping-pong, legends in an arc
at z −4 1.25 m apart; `lineup` overview (landscape) (0, 1.6, 2.5) look (0, 1.2, −7) fov 40, the six at x −4.2, −2.8,
−1.4, 1.4, 2.8, 4.2, z −7; `lineup` focus (portrait always; landscape after a tap) `player + (0, 1.35, d)`, look
`player + (0, 1.15, 0)`, fov 30, `d = (h + 0.35)/(2·tan 15°)`, portrait lens shift 0.30, turntable 20°/s idle, drag
0.5°/px with inertia decay 4/s, auto-spin resumes 3 s after the last touch, 0.5 s ease between players; `pause` ease
0.6 s to (9, 5.5, 3) look (0, 1.5, −8) fov 40, drift +0.12 m/s for 8 s at 30 Hz then **stop rendering** until resume
(resume = cut to broadcast + 1.0 s countdown); `halftime` (0, 14, 12) look (0, 0, −8) fov 46, pan x −3 → +3 over 6 s;
`gameover` 1.0 s hold then orbit the MVP r 3.2 m, height 1.5, 12°/s, fov 32 (portrait lens 0.30); `showcase` §10.

6.4.6 **Instant replay** (`replay.js`, D-PR-7):
- Recorder (CHECK/LIVE/DEAD): ring of **240 frames** (≤ 1 sample per 1/60 s game time); per frame 1 + 6 × 233 + 8 =
  1,407 floats → `Float32Array(240 × 1407)` = **1.35 MB allocated once**. Per player: root x, y, z, yaw; 53 local bone
  quaternions; pelvis local position; 9 expression weights; eye offset (2); visible flag; 2 spare (via
  `animator.capture`). Ball: position, quaternion, visible. Event ring of 32 (`takeoff, release, slam, score, block,
  steal, buzzer`).
- Triggers (setting 回放: 关 / **扣篮与绝杀** / 全部精彩): made dunk ✓/✓; made shot that wins or ties in the last 3.0 s of
  Q4/OT or any make at a period buzzer ✓/✓; chase-down / help block, ankle-breaker —/✓. Cooldown 45 s game clock
  (game-winners exempt), max 6 per game.
- Window 1.5 s game time at **0.5× = 3.0 s**: dunk `[slam − 1.15, slam + 0.35]`, jumper `[release − 0.30, release +
  1.20]`, block `[block − 1.0, block + 0.5]`. Timeline after the event (t = 0): 0–0.9 s live on broadcast; 0.9 s DOM
  wipe-in (gold bar "回放 REPLAY", 0.25 s); 1.15 s playback + letterbox (0.2 s slide); 4.15 s end; wipe-out 0.25 s; 4.40 s
  back to the game (camera snap). The game calls `holdDead(2.9)` (DEAD(MADE) 1.5 + 2.9 s). Game-winner replays play after
  the final buzzer, before the game-over panel.
- Playback: `t += 0.5·frameDt`, bracketing samples, `slerpQuaternions` / lerp (scratch objects) through
  `animator.applyBlend` with `animator.external = true`; net sim on the replayed ball at dt × 0.5; recording suspended;
  any tap, any key or the 44 px 跳过 ▶▶ → 0.15 s wipe-out.
- Cameras (subject = recorded pelvis smoothed 0.15 s): dunk orbit r 3.6 m, height 1.2 → 2.2, start 60° to the camera
  side of the approach, sweep −50° over 3.0 s, fov 32, look subject + (0, 0.495h, 0) blended 40 % to the rim after
  takeoff, slam shake 0.25 s 0.03 m 12 Hz; jumper first 55 % 2.8 m behind / 1.9 m above the shooter fov 35, then rim
  cam at (rim.x ± 2.4, 3.8, rim.z + 3.0) fov 35 → 28; block side-on 5 m from the shot line at 1.6 m, fov 30. Constraints:
  z ≥ −12.0, y ≥ 0.8, ≥ 0.9 m from every recorded pelvis.
- Chrome: letterbox 7 % top/bottom, tag "回放 REPLAY" 13 px gold, CSS vignette, jumbotron `replay`, preset `replay`, HUD
  hidden; LOD high LOD0 within 7 m, medium LOD0 for the 2 nearest + LOD1, low LOD1 for the 2 nearest; audio crowd
  low-passed 600 Hz × 0.6, recorded `slam/rim/swish` re-fired with slow variants.

### 6.5 UI flow and screens (WP8)

6.5.1 **Flow**:
```
BOOT (#loading HTML) → LOADING → MENU(title) ─开始游戏→ LINEUP ─开始→ INTRO → CHECK/LIVE/DEAD… → HALFTIME → … → GAME_OVER
                                   ├─快速比赛→ INTRO(short, stored/default lineup) ─────────────┘   (replays run inside DEAD)
                                   └─设置→ SETTINGS sheet → back
LOADING → LOAD_ERROR (重试 → LOADING; 简化模式 → MENU with primitive humanoids)
GAME_OVER → 再来一局 → INTRO(short) → CHECK ; 更换阵容 → LINEUP ; 主菜单 → MENU
PAUSE overlay (CHECK/LIVE/DEAD/INTRO/replay) → 继续 (1.0 s countdown) | 设置 | 返回主菜单
```
Test URLs: `?quick=1` boots straight to the title with intro off for 快速比赛; `?intro=0|short|full`, `?replay=0` override
settings for the session.

6.5.2 **Tokens** (`:root`): `--bg #0b0d14` (theme-color unchanged), `--gold #d9a520`, `--gold-2 #f6d27a`, v1
`--panel/-2/-3`, `--bug rgba(10,12,20,0.82)`, `--scrim rgba(5,6,10,0.80)`; team UI colours §2.9; system fonts only,
`tabular-nums` for numbers; CJK ≥ 13 px, Latin secondary ≥ 11 px; tappables ≥ 44 × 44, in-game buttons ≥ 56; z-index:
canvas 0, `#hud` 1, `#controls` 2, `#screens` 8, `#present` 9, `#menus` 10, `#halftime` 11, `#rotateHint` 12, `#loading`
20, `#loadError` 21. `@media (hover: none)`: menus/overlays use `--scrim`, **no `backdrop-filter`** (desktop keeps
`blur(6px)`) (R#13).

6.5.3 **Loading screen** (static HTML, visible before JS): radial gradient #151a2a → #0b0d14; "传奇对决" 40 px (portrait
36) weight 900, letter-spacing 0.08 em, gold gradient; "LEGENDS 3V3" 14 px spacing 0.4 em at 34 % height; progress bar at
62 %: `min(280px, 70vw)` × 6 px, radius 3, track rgba(255,255,255,0.12), fill `--gold`, CSS shimmer until JS sets a value;
status 13 px ("正在加载球员… 42 %"); tip line 13 px rotating every 3.0 s (`tip.1…6`); `legal.note` 11 px at the bottom.
Progress weights: code 0.10, assets 0.47 (by bytes), skin paint 0.18, kit paint 0.04, arena textures 0.08, environment
+ shader warm-up 0.13; never backwards; ≥ 0.25 s per phase label (`load.engine`, `load.assets`, `load.paint`,
`load.arena`, `load.compile`); fade-out 0.3 s.

6.5.4 **Title** (`#screenTitle`): portrait logo top 14 % (≥ 64 px + safe-top) 36 / 14 px; six legends fill 30–70 % of
the height (lens 0.10); buttons column at 72 %: 开始游戏 260 × 52 primary, 快速比赛 and 设置 260 × 46, gap 10. Landscape
logo top 10 % 34 / 13 px, arc fills the middle 60 %, row of three 180 × 48 buttons at bottom 18 px + safe, gap 12. Language
chip bottom-left 64 × 44 "中 / EN"; `legal.note` bottom centre 11 px.

6.5.5 **Lineup** (`#screenLineup`). Landscape (≥ 568 × 300): top bar 44 px + safe (back 44 × 44, title 18 px, segmented
`我方 [A][B]` and `球衣 [自动][经典][全明星]` 44 px tall, help 44 × 44); team columns inset 12 px + safe, header 24 px (name
15 px, kit swatch 16 × 16, "我方 / YOU" tag); three cards **168 × 72 px**, gap 8 (number chip 28 px circle in kit colours,
short name 16 px, full name 11 px, height "1.98 m", OVR badge, top-3 stat chips, ★ on the user's handler); centre 3D arc
(or focus turntable); detail card bottom-centre 300 × 104; bottom bar 52 px + safe: 随机 / 重置 96 × 44, 开始 160 × 46.
`@media (max-height: 360px)`: cards 168 × 56 without chips, headers 20, top bar 40, bottom 48; scrolls if still short.
Portrait (≥ 360 × 640): top bar 48 + safe; stage flex 1 (min 200 px) with the focus turntable (default focus = ★ handler)
and the detail card pinned at its bottom (full width − 24, 112 px); two team strips: header 22 px + three cards
`(100vw − 40)/3` × 72 px (number chip 24 px, short name 15 px ellipsis, OVR 13 px); strips 10 px apart; actions row
随机 / 重置 44 px + 开始 52 px full width + safe. Height check: 48 + 200 + 2 × (22 + 72 + 8) + 54 + 60 = 566 ≤ 640.
**Detail card**: number badge 32 px, name zh 20 px / 800 + en 12 px uppercase, OVR in a 44 px gold circle (24 px digits),
four composite bars (§2.4: label 13 px, bar 72 × 6, value 13 px), up to four ability chips (13 px, 28 px tall,
`ability.<id>`), height/era line 13 px.

6.5.6 **Intro overlay** (`#present`): lower-third 300 × 84 (landscape left 24 + safe, bottom 28 + safe; portrait left
16, bottom 34 %), slide in −40 px + fade 0.25 s, out 0.2 s: number block 64 px wide (34 px digits, kit colours), name zh
22 px / 800, en 12 px uppercase spacing 0.12 em, line "OVR 97 · 1.98 m · 2008-10" 13 px; team header for each team's
first legend (`intro.starters`); matchup title 32 px (portrait 28) "{teamA} VS {teamB}" with 4 px team-colour
underlines; skip button top-right 88 × 44.

6.5.7 **HUD** (`ui/hud.js`):

| element | landscape | portrait | behaviour |
|---|---|---|---|
| `#scoreBug` | top 6 px + safe, centred, 40 px tall, grid `6px 44px 36px 104px 36px 44px 6px` + `#shotClock` 36 × 36 px 6 px to the right (318 px) | top 6 + safe, left 8 + safe, right 60 + safe, grid `6px 1fr 34px 92px 34px 1fr 6px`, shot clock 34 × 34 inside right | colour bars 6 px (team UI), abbreviations 14 px / 800 (§2.9), scores 20 px / 900, period 11 px over game clock 16 px / 800; shot clock 18 px, #ff3b3b < 5 s, pulsing 1 ↔ 0.55 at 2 Hz < 3 s; possession bar 3 px (`#possA/#possB.on`) |
| `#pauseBtn` | top-right 44 × 44 | same | v1 |
| `#caption` | top 52 + safe, centred, max min(92vw, 560px) | top 56 + safe | 16 px / 700 (15 when height ≤ 420), pill rgba(8,10,16,0.55), radius 6, padding 4 × 10 |
| `#banner` | v1 (top 32 %, 40 px) | top 30 %, 32 px | "+3 科比": value 40 px + short name 20 px |
| `#nameTag` | head socket + 0.32 m projected, `translate(−50%, −100%)` | same | "#24 科比" 13 px / 800 on the team UI colour α 0.85, 20 px tall; stamina bar 36 × 3 under it while stamina < 0.98 (red < 0.25; v1 `#stamina` removed); pop 1.25 → 1.0 in 0.25 s on control change; hidden off-screen, in intro/replay and while the meter shows |
| `#meter` | 12 × 80 px (10 × 64 when height ≤ 420), radius 6, at the projected chest–head midpoint + (+40, −40) px; flips to −52 px when x > W − 80 | same | fill and green band from §5.3.2; `#meterPts` chip 22 × 18 above: "3" in `--gold` on `--bug` while `isThree(feet)`, "2" in white (updates every frame during the windup); flash 14 px above; projected with this frame's matrices |
| indicators / pass chevron | §6.4.3 | §6.4.3 | — |
| controls | v1 positions; `#cluster` z-index 2 above `#stickRing` z-index 1; ring centre re-clamped to the stick zone after tethering (R#10) | v1 | v1 relabel on offence/defence |
| `#rotateHint` | — | only on title/lineup for first launches until 知道了; top 64 + safe; auto-hide 6 s; 44 px button | `showMenu(null)` hides it without persisting (R#8) |

6.5.8 **Captions** (`ui/captions.js`): entries `{key, params, priority, t = world.time}`; priority 3 score / turnover /
violation / buzzer, 2 block / steal / ankle / ability, 1 miss / rebound / check; on push drop entries older than 2.0 s;
a priority-3 caption flushes lower ones and cuts the current one after ≥ 0.6 s (R#42); otherwise 1.8 s + 0.3 s fade; ≤ 4
queued; `clear()` in `Game.start()` and `Game.quit()` (R#19); caption and banner re-render on a language toggle (R#20);
`hud.bannerState()` stashed on pause and re-issued after the countdown (R#22). Names = `short`; streak `cap.hot` on a
player's 3rd consecutive make, `cap.winner`, `cap.firstDunk`. Neutral wording only.

6.5.9 **Pause / halftime / game over**: pause `#menuPause` (max-width 380): 继续 46 px primary, settings rows (画质, 语言,
音效, 观众音量, 镜头, 难度 (read-only in game), 回放), 返回主菜单 44 px; halftime `#halftime` 3.0 s or tap: "半场" 32 px,
score 28 px, one leader line per team ("{name} 12 分 5 板" 13 px), `menu.tapToSkip`; reserved keys P/Esc/M/T never skip
(R#21). Game over: box score (球员, 得分, 投篮 m/a, 三分 m/a, 篮板, 助攻, 抢断, 盖帽; rows 18 px, 16 px under 360 px height;
team separators; MVP row gold ★); **MVP** = winning-team player with max `PTS + 1.2·REB + 1.5·AST + 3·STL + 3·BLK −
0.8·(FGA − FGM)` (ties: more PTS, then lower roster index); `#mvpCard` 240 × 96 ("MVP" 13 px gold, name zh 20 px / 800, en
12 px, line "28 分 · 9 板 · 4 助" 13 px); landscape panel right 12 + safe, width min(520px, 62vw), MVP card bottom-left
16 + safe, height 284 ≤ 300 (`max-height: 360px` query: title 16, score 20, rows 17 → 247 px); actions 再来一局 /
更换阵容 / 主菜单 44 px in one row; portrait MVP in the top 38 % (lens 0.30), panel below width calc(100% − 32px) max 420,
name column 76 + 7 × 40 = 356 px. Fallback `.panel {overflow-y: auto; touch-action: pan-y; overscroll-behavior:
contain}`, `.panel .actions {flex-shrink: 0}` and the `input.js` touchmove exemption for `.panel, .scroll` (R#7).

6.5.10 **Settings** (`localStorage['legends3v3.settings.v2']`, try/catch, in-memory fallback; title sheet, subset in
pause; label column 60 px (52 px < 400 px wide, `keep-all`), options 44 px, gap 8 (4 in short landscape), two columns
when landscape ≥ 700 px):

| row | options (**default**) | applies |
|---|---|---|
| 画质 Quality | **自动 (shows e.g. "自动 · 中")**, 低, 中, 高 | DPR/shadows/reflection/crowd/LOD at the next CHECK; texture sizes at the next launch (`settings.reloadNote`) |
| 语言 Language | **简体中文**, English | immediately (incl. LED/jumbotron repaint) |
| 音效 Sound | **开**, 关 | immediately (v1 M) |
| 观众音量 Crowd | 低 0.4, **中 0.7**, 高 1.0 | crowd bus |
| 镜头 Camera | **标准**, 近景, 高位 | FRAMING mode, 0.4 s ease |
| 难度 Difficulty | 简单, **普通**, 困难 | next game (set on the title; read-only in pause) |
| 每节时长 Quarter | 1, **2**, 3, 5 分钟 | next game |
| 回放 Replays | 关, **扣篮与绝杀**, 全部精彩 | §6.4.6 |
| 开场介绍 Intro | 完整 (**first game**), 简短 (**rematch**), 关闭 | §6.4.4 |
| 球衣 Kits | **自动**, 经典, 全明星 | C17 (writes `lineup.kits`) |
| 清球规则 Clear-the-ball | **关**, 开 | R9 (title only) |
| 防守自动换人 Auto-switch | **开**, 关 | R10 |

Language keeps the v1 i18n storage key; mute keeps the v1 audio key.

### 6.6 Asset loading (WP2 + WP8 + WP9)

| path | publish contentType | size (raw) |
|---|---|---|
| `index.html` | page | ≤ 14 KB |
| `css/style.css` | text/css | ≤ 40 KB |
| `src/**/*.js` (≈ 80 modules) | text/javascript | ≤ 1.1 MB (≈ 300 KB gzip) |
| `vendor/three.module.js` | text/javascript | 742 KB |
| `assets/legends/legends.json` | application/json | ≤ 140 KB |
| `assets/legends/*.bin` (7) | **application/octet-stream** (explicit `{from, contentType}`) | ≤ 2.6 MB |
| `assets/legends/*.png` (15) | image/png | ≤ 0.9 MB |

Totals ≤ 5.4 MB raw (assets ≤ 3.5 MB), **≤ 110 requests** during load (CRITIC: the tree of §1.1 has 77 `src` modules, all loaded by static imports since H1 forbids dynamic `import()`; + vendor + css + html + 1 json + 7 bins + 15 PNGs = 103); artifact = one publish (≈ 105 files < 255; `assets/legends/README.md` and `tools/` are not published).
`index.html` has `<link rel="modulepreload" href="./vendor/three.module.js">` + the 12 largest `src` modules, and
`<link rel="preload" href="./assets/legends/legends.shared.bin" as="fetch" crossorigin="anonymous">` (+ legends.json).
Player bins and PNGs fetched in parallel (≤ 6 concurrent). Budgets ("Fast 4G" 9 Mbps / 170 ms RTT, cold): loading
screen ≤ 1.0 s, title interactive ≤ 7.5 s (iPhone 11), ≤ 12 s (low-tier Android), warm ≤ 2.5 s. Byte progress via
`response.body.getReader()` when `Content-Length` exists, else known sizes from `legends.json` / a manifest constant.
Per file timeout 20 s, 2 retries (500 / 1,500 ms). Validation: header format/version, every bin's byteLength equals its
header entry. Error panel `#loadError` (z 21): `loadError.title`, detail `{file} ({reason})` (HTTP status, `timeout`,
`parse`, `size`), 重试 (re-fetches failed files only) and 简化模式 (v1 primitives), both 44 px; the failure is
`console.warn`, never `console.error`. `!isWebGL2` → simplified mode directly + `toast.webgl1`.

Visibility: `visibilitychange → hidden`/`pagehide` while a game runs → `game.pause()` (intro/replay timelines pause),
`audio.suspend()`, stop rAF; `visible` → restart rAF (`acc = 0`), `audio.resume()`, show the pause menu (never
auto-resume), clear the quality judging window. Title and lineup render at 60 Hz but are never judged. Context
lost/restored: v1. Window `blur` without hidden: no pause.

### 6.7 Audio (WP8; all synthesized; no samples, no voices, no PA)

Graph `ctx → master Gain 0.8 (0 muted) → DynamicsCompressor (−18 dB, knee 12, ratio 4, attack 0.003, release 0.25) →
destination`; buses `sfx` 1.0, `crowd` 0.4 / **0.7** / 1.0, `ui` 0.6; per-voice `StereoPannerNode` `pan = clamp((x −
camera.x)/8, −0.7, 0.7)`, distance gain `clamp(9/|src − cam|, 0.35, 1.0)`; ≤ 16 voices (oldest dropped; squeaks ≤ 3, clap
grains pooled); ≤ 0.3 ms JS per frame; generated buffers ≤ 2 MB built at unlock (≤ 30 ms). Sounds `squeak(i,x,z)` (from
`PLANT_*` with `i = clamp((decel − 6)/10, 0, 1)` or turn rate ≥ 360°/s → 1; p 1 if i ≥ 0.6 else 0.35; ≤ 1 per player per
250 ms), `thud(w)` (`LAND` of players ≥ 110 kg or jumps ≥ 0.5 m), `bounce`, `rim(s, kind ∈ tap/clank/rattle/grab)`,
`net(swish/rimIn/snap)`, `board(bank/thud)`, `whistle`, `horn` (period end), `shotHorn`, UI `tick/select/whoosh/boom/
sting/wipe`, slow replay variants (frequencies × 0.7, durations × 1.6): recipes [ref PR:§8.2 Court sounds]. Crowd
(`audio/crowd.js`): murmur + excite beds (pink noise, 4.0 s loops), vowel bursts `ooh/aah/aww` (formant bandpasses),
applause (60 grains/s, 1.5–3.0 s), wordless chant (two claps + stomp per 1.0 s, on with the visual chant: CPU on
offence, Q4/OT last 2:00 or margin ≤ 5, shot clock ≤ 8), clutch anticipation glide; event map [ref PR:§8.3 Crowd].

### 6.8 i18n keys (WP8 owns `src/i18n.js`; zh / en; `{name}` = short name; player names come from `legends.js`)

v1 keys stay. New keys:

| key | zh | en |
|---|---|---|
| `app.title` | 传奇对决 3v3 | LEGENDS 3v3 |
| `brand.wordmark` / `brand.zh` | LEGENDS / 传奇对决 | LEGENDS / 传奇对决 |
| `legal.note` | 非商业粉丝作品 · 球员姓名与形象归其本人所有 | Non-commercial fan project · names and likenesses belong to the players |
| `title.play` / `title.quick` / `title.settings` | 开始游戏 / 快速比赛 / 设置 | Play / Quick Game / Settings |
| `menu.lineup` | 阵容 | Lineup |
| `lineup.title` / `lineup.you` / `lineup.start` / `lineup.shuffle` / `lineup.reset` | 选择阵容 / 我方 / 开始 / 随机 / 重置 | Choose Lineups / YOU / Start / Shuffle / Reset |
| `lineup.kits` / `lineup.kits.auto` / `.classic` / `.allstar` | 球衣 / 自动 / 经典 / 全明星 | Kits / Auto / Classic / All-Star |
| `lineup.handler` / `lineup.swapHint` / `lineup.clash` | 持球核心 / 依次点两名球员即可交换 / 经典球衣可能撞色 | Ball handler / Tap two players to swap them / Classic kits may clash |
| `team.dark` / `team.bright` / `team.white` / `team.black` | 暗夜队 / 烈阳队 / 白队 / 黑队 | Team Dark / Team Bright / Team White / Team Black |
| `abbr.dark` / `abbr.bright` / `abbr.white` / `abbr.black` | 暗夜 / 烈阳 / 白队 / 黑队 | DRK / BRT / WHT / BLK |
| `rules.clear` / `rules.autoSwitch` | 清球规则（3x3） / 防守自动换人 | Clear-the-ball (3x3) / Auto-switch on defence |
| `stat.speed … stat.rebound` (15) | 速度 力量 弹跳 控球 近投 中投 三分 扣篮 上篮 传球 外线防守 内线防守 盖帽 抢断 篮板 | Speed Strength Vertical Handles Close Mid-range Three Dunk Layup Passing Perimeter D Interior D Block Steal Rebound |
| `comp.sht` / `comp.drv` / `comp.ins` / `comp.def` | 投篮 / 突破 / 内线 / 防守 | SHT / DRV / INS / DEF |
| `ability.clutch` | 关键先生 | Clutch |
| `ability.kobe.postFade` / `.jab` / `.tough` | 背身后仰 / 试探步急停 / 高难度投篮 | Post Fadeaway / Jab-Step Pull-Up / Tough Shots |
| `ability.jordan.fade` / `.air` / `.ftDunk` / `.hawk` | 招牌后仰 / 空中换手 / 罚球线起跳扣篮 / 抢断嗅觉 | Signature Fadeaway / Mid-Air Switch / Free-Throw-Line Dunk / Ball Hawk |
| `ability.lebron.powerDrive` / `.chaseDown` / `.skipPass` / `.bully` | 强力突破 / 追身大帽 / 跨场传球 / 背身碾压 | Power Drive / Chase-Down Block / Cross-Court Pass / Bully Ball |
| `ability.giannis.euro` / `.longDunk` / `.helpBlock` | 欧洲步 / 长途奔袭扣篮 / 协防封盖 | Eurostep / Long-Stride Dunk / Help-Side Block |
| `ability.yao.hook` / `.highRelease` / `.anchor` / `.post` | 勾手 / 高点出手 / 护框 / 背身单打 | Jump Hook / High Release / Rim Anchor / Post Scorer |
| `ability.kyrie.combo` / `.finisher` / `.stepback` | 连续变向 / 终结大师 / 后撤步三分 | Handle Combo / Acrobatic Finisher / Step-Back Three |
| `cap.ankle` / `cap.chaseDown` / `cap.rimOut` / `cap.clear` / `cap.notCleared` | {name} 晃倒了对手！ / {name} 追身大帽！ / {name} 扣篮砸框弹出 / 清球！ / 未清球，进球无效 | {name} broke his ankles! / {name} chase-down block! / {name}'s dunk rims out / Clear it! / Not cleared — no basket |
| `cap.dunk` / `cap.hot` / `cap.winner` / `cap.firstDunk` | {name} 暴扣！ / {name} 手感火热！ / {name} 绝杀！ / {name} 送上本场首扣！ | {name} throws it down! / {name} is heating up! / {name} wins it! / {name} with the first dunk of the game! |
| `cap.ab.jordan.ftDunk` / `.jordan.fade` / `.kobe.postFade` / `.kobe.jab` / `.lebron.powerDrive` / `.lebron.skipPass` / `.giannis.euro` / `.giannis.longDunk` / `.yao.hook` / `.yao.dropStep` / `.kyrie.combo` / `.kyrie.stepback` / `.kyrie.finisher` | {name} 罚球线起跳扣篮！ / {name} 后仰跳投 / {name} 转身后仰 / {name} 试探步急停跳投 / {name} 强起撞开防守 / {name} 单手跨场传球 / {name} 欧洲步 / {name} 长距离起跳扣篮 / {name} 勾手 / {name} 沉步转身 / {name} 连续变向 / {name} 后撤步 / {name} 拉杆上篮 | {name} from the free-throw line! / {name} fadeaway / {name} turnaround fade / {name} jab-step jumper / {name} powers through / {name} skip pass / {name} euro step / {name} long-stride slam / {name} jump hook / {name} drop step / {name} crossover combo / {name} step-back / {name} acrobatic finish |
| `meter.three` / `meter.two` | 3 / 2 | 3 / 2 |
| `tip.pumpFake` / `tip.combo` / `tip.post` / `tip.fade` / `tip.block` | 轻点投篮 = 假动作 / 连点两下变向 = 连招 / 慢慢顶向防守人 = 背身单打 / 摇杆背离篮筐再投篮 = 后仰 / 盖帽要在对手出手时起跳 | Tap SHOOT quickly to pump fake / Double-tap CROSS for a combo / Walk into your defender to post up / Stick away from the hoop + SHOOT = fadeaway / Jump as he releases to block |
| `tip.1` … `tip.6` (loading) | 摇杆移动，投篮键按住松开出手 / 绿色区域松手最准 / 轻点投篮可做假动作 / 连点变向键打出连招 / 横屏体验更好 / 卡顿时可在设置中调低画质 | Move with the stick; hold and release SHOOT / Release in the green zone / Tap SHOOT quickly to pump fake / Double-tap CROSS for combos / Landscape plays best / Lower the quality in Settings if it stutters |
| `intro.starters` / `intro.vs` / `intro.skip` | {team} · 首发 / VS / 跳过 | {team} · Starters / VS / Skip |
| `replay.tag` / `replay.skip` | 回放 / 跳过 | REPLAY / Skip |
| `jumbo.dunk` / `.three` / `.block` / `.winner` / `.final` | 暴扣! / 三分! / 盖帽! / 绝杀! / 终场 | DUNK! / THREE! / BLOCKED! / GAME WINNER! / FINAL |
| `led.brand` / `.defense` / `.noise` / `.clutch` / `.gg` / `.score` | 传奇对决 · LEGENDS 3V3 / DEFENSE · 防守! / MAKE SOME NOISE · 呐喊吧 / CLUTCH TIME · 关键时刻 / GOOD GAME · 精彩比赛 / {a} {sa} – {sb} {b} | (same bilingual strings) |
| `over.mvp` / `over.lineup` | MVP / 更换阵容 | MVP / Change Lineup |
| `settings.*` (rows/options of §6.5.10), `settings.reloadNote` | … / 贴图尺寸将在下次启动时生效 | … / Texture sizes change on the next launch |
| `load.engine` / `.assets` / `.paint` / `.arena` / `.compile` | 正在启动引擎 / 正在下载球员模型 / 正在绘制球员 / 正在布置球馆 / 正在准备着色器 | Starting engine / Downloading players / Painting players / Building the arena / Preparing shaders |
| `loadError.title` / `.retry` / `.simple` / `.detail` | 加载失败 / 重试 / 简化模式 / {file}（{reason}） | Loading failed / Retry / Simple mode / {file} ({reason}) |
| `toast.allstar` / `toast.webgl1` / `toast.tier` / `legendsLoadFailed` | 非默认阵容：已换上全明星球衣 / 设备不支持高清球员，已切换简化模式 / 画质已调整为{tier} / 球员模型加载失败，已切换简化模式 | Custom lineup: All-Star kits / High-detail players need WebGL2: simple mode / Quality set to {tier} / Player models failed to load: simple mode |
| `anim.*` | viewer labels (WP3 lists them; WP8 adds them) | — |

---
## 7. Quality tiers and budgets (WP6 `quality.js`; consumed by WP2, WP3, WP7, WP8)

### 7.1 Ladder (tier × DPR; `dpr = min(devicePixelRatio, rungDpr)`)

| rung | tier | DPR touch | DPR desktop |
|---|---|---|---|
| 1 | low | 0.85 | 1.0 |
| 2 | low | 1.0 | 1.0 |
| 3 | medium | 1.25 | 1.25 |
| 4 | medium | 1.5 | 1.5 |
| 5 | high | 1.75 | 1.75 |
| 6 | high | 2.0 | 2.0 |

Below rung 1 with demotion still firing → 30 Hz render mode (render every 2nd rAF; sim stays 60 Hz).

### 7.2 Static detection (boot, before the asset phase)

`WEBGL_debug_renderer_info → UNMASKED_RENDERER_WEBGL` (fallback `RENDERER`), lower-cased:

| pattern | class | start / cap rung |
|---|---|---|
| `swiftshader`, `llvmpipe`, `software`, `basic render` | software | 2 / 2 |
| `mali-4`, `mali-t`, `mali-g31/g51/g52/g71/g72`, `adreno (tm) 3`, `adreno (tm) 4`, `adreno (tm) 50`, `adreno (tm) 51`, `adreno (tm) 61[0-9]`, `powervr`, `ge8` | low | 2 / 3 |
| `mali-g57/g68/g76/g77`, `adreno (tm) 6[2-5]`, `intel(r) (uhd\|hd) graphics` | mid | 4 / 4 |
| `mali-g78`, `mali-g6[1-9]0`, `mali-g7[1-9]0`, `immortalis`, `adreno (tm) 6[6-9]`, `adreno (tm) [78]`, `xclipse` | upper | 4 / 6 |
| `apple gpu` | apple-mobile | 4 / 6 |
| `apple m`, `nvidia`, `geforce`, `radeon`, `amd`, `iris(r) xe`, `arc` (non-touch) | desktop | 6 / 6 |
| other | unknown | 4 / 5 |

Caps: `deviceMemory ≤ 2` → cap 2, `≤ 4` → cap 4; `hardwareConcurrency ≤ 2` → cap 2, `≤ 4` → cap 4; touch with
`screen.w·screen.h·dpr² > 3.2 Mpx` and class ≤ mid → start at rung 3. `?quality=` or the settings choice forces the tier's
top rung and disables auto. **Texture sizes are chosen once at load from the start tier** (they never change at runtime;
a manual tier change shows `settings.reloadNote`).

### 7.3 Runtime adaptation

- Cadence probe during the loading screen: median of 30 rAF intervals; `target = cadence < 12 ms ? 16.67 : cadence`
  (120 Hz displays capped at 60 fps by skipping frames with `now − lastRender < 16.67 − 1.5`; 30 Hz panels / low-power
  mode → target 33.3, never mistaken for a slow GPU; R#3).
- **Cadence change mid-session** (CRITIC, rest of R#3: Low Power Mode switched on during a game, iframe throttling):
  each judged frame also records its busy time `busy = performance.now()` at the end of `hud.update` − at the start
  of the rAF callback. When over 3.0 s ≥ 90 % of judged intervals lie within 33.3 ± 2.0 ms and mean `busy` < 0.5 ×
  16.67 ms, the monitor re-probes instead of demoting: `target = 33.3`, history entry `{reason: 'cadence'}`, no rung
  change. When, with `target = 33.3`, ≥ 90 % of intervals over 3.0 s lie within 16.7 ± 2.0 ms, `target` returns to
  16.67. A cadence switch never counts toward the 4-change limit.
- Judged frames only when `state ∈ {CHECK, LIVE, DEAD}`, not paused, no menu/overlay/settings/intro/replay, document
  visible, ≥ 2.0 s since the last rung change / resize / orientation change / tab return / menu close (window cleared
  on each) (R#13).
- Demote one rung when over the last 3.0 s of judged frames `mean > 1.30 × target` or `p90 > 1.80 × target`; severe
  `mean > 2.0 × target` for 2.0 s demotes immediately. Promote one rung after 10 s with `mean < 1.08 × target` and
  `p95 < 1.25 × target`, rung ≤ cap, not previously demoted from that rung, < 2 promotions so far. Max 4 changes per
  session, then auto locks.
- Applying: DPR-only changes immediately (`setPixelRatio` + `setSize`, no extra render); tier changes (shadow map
  on/off, reflection, crowd count, LOD clamps, animation throttles) at the next CHECK after `renderer.compile`; toast
  `toast.tier` for tier changes only. `__game.quality.history` records `{t, from, to, reason}`.

### 7.4 Settings per tier (binding; merged from CHR §9, ANIM §12, PR §6)

| setting | low | medium | high |
|---|---|---|---|
| characters | LOD 3 (menus 2), skin 512, kit 512, strand 256, eye 128, no morphs, no lashes, groom inner only | LOD 2 (≥ 300 px → 1; menus 0–1), skin 1024, kit 1024, strand 512, eye 256, morphs, lashes | LOD 1 (≥ 640 px → 0; menus 0), skin 2048 desktop / 1024 touch, kit 1024, strand 1024, eye 512 |
| character materials | Standard skin (map), Lambert kit, groom alphaTest, Lambert wet | Standard + rough(α) + pore/mesh normals, groom alphaHash, wet r 0.06 | Physical skin (sheen 0.25 + clearcoat), Physical groom sheen, Physical wet clearcoat 1; kit cloth sheen 0.35 optional |
| animation | ≤ 2.0 ms; owner + action players full rate, others 30 Hz | ≤ 1.2 ms | ≤ 0.9 ms, all full rate |
| shadows | shared blobs 0.45 | PCF 1024², r 2.0, proxies LOD3 + ball; blobs 0.25 | PCF 2048², r 2.5 |
| environment | none (hemi 1.10) | PMREM 128 | PMREM 256 |
| floor | Lambert; markings 1024×816; wood 512² | Standard + env; markings 2048×1632; wood 512² | + planar reflection; wood 1024² + wear |
| centre decal | 512² Lambert | 512² Standard | 1024² Standard |
| crowd | 700, Basic, atlas 512² | 1,600, Lambert, 1024² | 2,600, Lambert, 1024², camera flashes |
| ball | 20 × 14, 512×256 albedo | 32 × 24, + normal 512×256 | 48 × 32, 1024×512 albedo + normal |
| net | 12 × 5, 1 substep | 16 × 7, 2 substeps | same |
| LED / jumbotron | 1024×32 / 512×256, ≤ 1 Hz | 2048×64 / 1024×512, ≤ 2 Hz | same |
| ribbon board / centre-hung / ceiling fixtures | off / off / on | on / on / on | on / on / on |
| intro spotlight | absent | present | present |
| replay LOD | LOD1 for the 2 nearest | LOD0 for the 2 nearest | LOD0 within 7 m |
| MSAA, fog, Neutral tone mapping | on | on | on |
| Kyrie mouthguard | off | off | on |

**Fixed at load vs switchable at runtime** (CRITIC; the auto ladder of §7.3 may move the tier mid-session, which
must never re-create textures or re-download anything):

| decided once at load from the **start tier** (a manual change shows `settings.reloadNote` and applies next launch) | applied at runtime on a tier change (at the next CHECK, after `renderer.compile`) |
|---|---|
| character texture sizes (skin, kit, strand, eye, pore, clearcoat), character material classes (Lambert / Standard / Physical), morph targets present or not, lashes, Kyrie's mouthguard mesh, groom `alphaTest` vs `alphaHash` | DPR (immediately), body LOD clamps and replay LOD rule, groom outer layers by LOD, animation throttles (§4.14) |
| floor markings / wood / decal / ball / LED / jumbotron canvas sizes, net ring count, ball sphere segments | shadow map on/off and `mapSize` (dispose `key.shadow.map`, set `map = null`, materials `needsUpdate`), shadow proxies visible, blob opacity 0.45 ↔ 0.25 |
| PMREM environment (built only if the start tier is medium/high; a later promotion from low keeps `env = null`) | planar reflection (render target created on first use, disposed on demotion; `trackTexture` updated) |
| crowd `InstancedMesh` capacity = instance count of the **cap rung's** tier (700 / 1,600 / 2,600) and its material (Basic on low start, else Lambert) | crowd `mesh.count` (≤ capacity), camera flashes, ribbon board / centre-hung visibility, LED/jumbotron repaint rate |

### 7.5 Budgets (gameplay frame, CHECK/LIVE, all passes counted, `info.autoReset = false`)

| budget | low | medium | high (touch) | high (desktop) |
|---|---|---|---|---|
| draw calls | ≤ 48 (est. 39) | ≤ 75 (est. 58 = 51 main + 7 shadow) | ≤ 105 (est. 76 + 17 reflection) | ≤ 105 |
| triangles | ≤ 70k (est. 50k) | ≤ 190k (est. 145k: characters 92k + proxies 21k × 2 passes + crowd 3.2k + ball/arena 9k) | ≤ 330k (est. 300k incl. reflection 110k) | ≤ 330k |
| texture memory (`texMB`) | ≤ 48 MB (est. 27–30) | ≤ 150 MB (est. 118) | ≤ 230 MB (est. 191) | ≤ 300 MB (est. 260) |
| JS per frame (mean, reference device) | ≤ 9.0 ms (PowerVR GE8320 / Mali-G52) | ≤ 7.0 ms (iPhone 11) | ≤ 6.0 ms (iPhone 13) | ≤ 4.0 ms |
| of which steps / animation / render submit / HUD+audio+camera+net+crowd | 1.5 / 2.0 / 4.5 / 1.0 | 1.2 / 1.2 / 3.8 / 0.8 | 1.0 / 0.9 / 3.5 / 0.6 | — |
| frame rate | 60 aim, 30 floor | 60 | 60 | 60 |
| replay frames | ≤ 60 calls, ≤ 90k tris | ≤ 85 calls, ≤ 230k | ≤ 115 calls, ≤ 420k | — |
| characters only (6) | 24 main calls, ≈ 38k tris | 24 main + 6 proxy + 6 proxy-shadow, ≈ 92k (+ proxies) | same, ≈ 135k | — |
| payload / requests | ≤ 5.4 MB raw, ≤ 110 requests, title ≤ 7.5 s on Fast 4G (iPhone 11) | | | |

Texture accounting: `quality.trackTexture(tex, bpp = 4, mip = true)` for every texture/render target (characters too);
`texMB = Σ w·h·bpp·(mip ? 1.333 : 1)/2²⁰` + depth/shadow maps 4 B/px, half-float targets 8 B/px; default framebuffer
excluded. Zero allocations per frame in step/render/HUD/camera/replay/crowd/net (H10).

### 7.6 Feasibility check and load-time budgets (CRITIC)

**Geometry vs the PoC.** The PoC (SwiftShader, CPU-skinned, relative numbers only) measured six players at LOD3 + kit
54k tris → 90 ms, LOD1 + kit 102k → 123–131 ms, LOD0 + kit 154k → 174 ms, empty scene 14.6 ms: cost ≈ 50 ms +
0.8 ms per 1k skinned triangles, i.e. linear in skinned vertices, with 67 draw calls. v2 cuts the draw calls to 4 per
player (24 + 6–12 proxy) and keeps the vertex load per tier at: low 38k character tris (≈ the PoC's LOD3 case, no
morphs, no shadow pass), medium 92k + 2 × 21k proxy (≈ the PoC LOD0 case, ≈ 80k unique skinned vertices per frame
incl. the shadow pass, 9 morph fetches each), high 135k + 42k proxy + reflection (layer 2 re-skins body + kit:
+≈ 110k). On real GPUs this is ≈ 25–35 M vertex-shader ALU ops per frame on medium (≈ 2 GFLOP/s at 60 Hz; iPhone 11
GPU ≈ 0.7 TFLOPS) and ≈ 0.3 GFLOP/s on low (Mali-G52 MC2 ≈ 30–40 GFLOPS), so vertex work is not the limit; fill rate
(alphaHash groom, DPR) and draw-call submission (§7.5 JS budget) are, which is what the DPR ladder adjusts. Headless
tests never assert frame time (SwiftShader would show ≈ 170 ms/frame for medium, as in the PoC). **Levers** if the
phase-D device matrix (§9.5) misses 55 fps on medium, in this order (each is a local change, no format change unless
noted): (1) kit low variant (shell LOD1 + 320-tri sneakers) already at body LOD 2 instead of 3 (−7.8k tris for six);
(2) medium shadow map 1024 → 768; (3) groom outer layers off at LOD 2; (4) bake the 12 × 8 eye range and no
teeth/tongue into the LOD2/LOD3 wet group (format change, WP1; −10k tris for six); (5) cap medium DPR at 1.25.

**Payload.** ≈ 5.0 MB raw expected (assets 3.1, three.js 0.72, src ≈ 1.1, css/html 0.05); over Fast 4G (9 Mbps,
170 ms RTT) with gzip on JS/CSS/JSON (bins and PNGs do not compress) ≈ 3.9 MB on the wire ≈ 3.6 s + ≈ 0.5 s of RTT
chains → assets done ≈ 4.1 s after navigation on iPhone 11, leaving ≈ 3.4 s of the 7.5 s title budget for the
phases below.

**Load phases after the bytes arrive** (all six players; reference devices of §7.5; measured by the loader into
`__game.perf.load = {fetchMs, decodeMs, skinMs, kitMs, uploadMs, compileMs}` and checked in the manual matrix §9.5):

| phase | low (2021 low-end Android, 512²) | medium (iPhone 11, 1024²) | high touch (iPhone 13, 1024²) | high desktop (2048²) |
|---|---|---|---|---|
| PNG decode → planes (15 files, §3.3) | ≤ 350 ms | ≤ 200 ms | ≤ 150 ms | ≤ 120 ms |
| skin composite, per player / six (§3.5.4a; Node VM reference 11 / 27.5 / 107 ms) | ≤ 80 / 480 ms | ≤ 45 / 270 ms | ≤ 35 / 210 ms | ≤ 150 / 900 ms |
| kit paint, per player / six (canvas 2D + `getImageData`) | ≤ 25 / 150 ms | ≤ 15 / 90 ms | ≤ 12 / 72 ms | ≤ 15 / 90 ms |
| texture upload + mipmaps (first `renderer.compile` + 2 warm frames) | ≤ 60 ms | ≤ 80 ms | ≤ 60 ms | ≤ 120 ms |
| **paint phase total** | **≤ 1.05 s** | **≤ 0.65 s** | **≤ 0.50 s** | **≤ 1.25 s** |
| arena textures (floor, decal, crowd atlas, ball, LED/jumbo) | ≤ 300 ms | ≤ 250 ms | ≤ 250 ms | ≤ 200 ms |
| shader compile + warm-up (`renderer.compile`, ≈ 15–20 programs incl. shadow-depth variants) | ≤ 2.5 s | ≤ 1.5 s | ≤ 1.2 s | ≤ 0.8 s |
| **title interactive after the last byte** | **≤ 4.0 s** | **≤ 2.6 s** | **≤ 2.1 s** | **≤ 2.3 s** |

Device JS speed factors used (relative to the Node VM reference): iPhone 11/13 Safari 1.0–1.5×, 2021 low-end Android
Chrome 5–7×, desktop 0.7–1.0×. If a phase misses its budget on a reference device by > 25 %, the fallback is to paint
the skin on the GPU (full-screen quad into an RGBA8 sRGB `WebGLRenderTarget` with mipmaps, same formula in GLSL,
≤ 2 ms per player) with the JS painter kept as the Node-tested reference; a Playwright check then compares a 64 × 64
read-back crop to the JS result within ±3/255.

---
## 8. Bake pipeline changes (`tools/legends/`, WP1) and regeneration commands

### 8.1 What stays

The working pipeline (CC0 MakeHuman hm08 base mesh, macro + detail targets per player, calibrated knobs, 53-bone
game-engine rig with weights, LOD0–3 index buffers via meshoptimizer 0.22 `simplifyWithAttributes` (LOD1 0.5 face-locked,
LOD2 0.25 face-locked, LOD3 0.12 unlocked), shared bin + per-player bins, shell builder) stays. Runtime still needs
nothing from `tools/`; meshoptimizer is an optional offline dev dependency (`npm install` in `tools/legends`).

### 8.2 Format version 2 (`bake.mjs`, `FORMAT.md`)

- `header.version = 2` (runtime rejects v1); `config.output = "../../assets/legends"`.
- `shared.groups = [{name: 'body', material: 'skin'}, {name: 'wet', material: 'wet'}]` (wet = procedural eyeballs +
  teeth + tongue).
- New top-level keys: `landmarks: {<name>: {obj, kept, base: [x,y,z], uv: [u,v]}}` (right side mirrored);
  `uvIslands: [{rect, tris, region}]`; `masks: {skin0|skin1|skin2: {file, size, channels}}`; `morphNames` (the 9 of §3.9
  in order); `baseBones` (bone heads on base.obj); `baseScaleRefs` (base head height 0.2313 m, crown → ME).
- `shells[i]` += `uvRange`, `uvScale`, `perimeter: [[y, P] × 8]`, `loops: [{kind, uv: [[u, v], …]}]` (unwrapped),
  `lods: [{ratio, section}]`, `groom: {family: [r,g,b], density: section | constant, fade: section, fadeMm}`,
  `players?: [ids]`.
- `players[i]` += `eyes: {l: {c, r}, r: {c, r}}`, `feet: {l|r: {heel, toe, ball, ankle, widthBall, widthHeel}}`,
  `face: {<landmark>: [x,y,z]}`, `morphs: {targets: [{name, count, offset}], section}`, `shells: [...]` (per-player
  groom shells in the player bin), `covers: {shoeCover_<cut>: section}`, `masks: {groom: {file, size}, extra: {file,
  size}}`, `dims: {shoulderJoints, heightBarefoot, eyeY, headTopY, headCentreAboveHeadBone}`, `meta` (names, number,
  stats — checked against `legends.js` by `unit-lineup.mjs`).
- New section types: `i16q` (int16 × 0.00002 m), generalised `u8n*k`.

### 8.3 Code changes

| file | change |
|---|---|
| `bake.mjs` | v2 header/sections; `keepMouth: true` (teeth/tongue → `wet`, vertex colours §3.6, UV u = 2.0); eye helpers replaced by generated 24 × 16 UV spheres (+ 12 × 8 LOD range) with per-player centre/radius and cornea bulge, front-disc UV, appended to kept vertices (head weight 255); eyelash helper vertices kept for the `lashes` shell; per-player shells; morphs; masks; feet/eyes/dims/face data; byte-size log with budget check; CRITIC: exits 1 when `meshoptimizer` is not installed (the runtime needs LOD1–3 and shell LOD1 for every tier) unless `--no-lod` is passed, which writes `"devOnly": true` into the header so `format.js` refuses it outside `?debug=1` |
| `lib/landmarks.mjs` (new) | §3.5.2 table (obj indices), `mirrorIndex(obj)` (exact x-mirror search, cached), per-player frame, ear set \|x\| > 0.071 ∧ 0.682 < y < 0.746 ∧ 0.016 < z < 0.075 (base); the §10.2 likeness metric definitions and bands |
| `lib/shells.mjs` | `buildShells({pos, normals, frame})` runs region functions on a player's morphed kept positions; new builders `hairInner/hairOuter(params)`, `beardInner/beardOuter(params)`, `brows(params)`, `lashes`, `socks_low/crew/mid/high` (+0.09 / +0.13 / +0.19 / +0.27 m above the ankle landmark y −0.745, base), `tape_r_im`, `wristband_l`, `headband_high/low`, `shoeCover_low/lowmid/midhigh/high` (cover-only); jersey region tucked (hem `pelvisY + 0.03`, offset rule and relax pin of §3.8); remove `beard`, `hair`, `eyebrows`, `shoes`, `headband`, `socks` from `DEFAULT_SHELLS`; per-vertex `offsetScale` zones (beard chin/cheeks, hair side taper, Yao fringe, sock brace bump), per-vertex density (u8n), `fadeMm` in the shell header; uvModes `torso-ellipse`, `head-metric` (seam split with `u + Nu`), `brow-local`, `lash-local`; boundary loops chained and classified (jersey: mean y > clavY − 0.05 ∧ mean \|x\| < 0.08 → `neck`, mean \|x\| > 0.1 → `armhole_l/r`, else `hem`; shorts: top `waist`, bottom `leg_l/r`; socks top `cuff`); shell LOD1 index (`simplify 0.4`, LockBorder) for every cloth and groom shell |
| `lib/morphs.mjs` (new) | §3.9 targets: modifier deltas via `detailTargetList`/`applyTarget` on a copy of the pre-scale positions; jaw field `wJ` from MPFB `weights.default.json` bone `jaw` + lip/side terms [ref CHR:§8.2 Jaw field]; tongue weights (tongue03–07 = 1, 00–02 = 0.4); blink lid rotation; scaled by `UNIT·scale`; sparse `i16q` |
| `lib/uvraster.mjs` (new) | rasterise body triangles at size S, barycentric position + normal → field callback, top-left rule, 2 × 2 supersample at 1024, dilation 8 px (1024) / 4 px (512) |
| `lib/png.mjs` (new) | minimal RGB PNG writer (signature, IHDR type 2 depth 8, IDAT `zlib.deflateSync(level 9)` with per-row adaptive filter (min Σ\|bytes\| over 0–4), IEND, CRC-32 table), Node built-ins only, rows top = v 1 |
| `lib/masks.mjs` (new) | shared fields → `legends.skin0/1/2.png`; per player → `legends.<id>.groom.png`, `legends.<id>.extra.png`; fail if any §3.1 budget is exceeded by > 20 % |
| `fetch.mjs` | also fetches MPFB `rigs/standard/weights.default.json` (5.0 MB) and `rig.default.json` (126 KB) (CC0), all raw URLs pinned to the commit SHA recorded as `mpfbRef` in the config; cache in `.cache/` (gitignored). CRITIC: `BASE_URL` currently points at `mpfb2/master`; set `mpfbRef = "d0a32e57a7f915cb2f2b95410e2117648c7bbb7e"` (mpfb2 `master` on 2026-10-10, from `git ls-remote https://github.com/makehumancommunity/mpfb2.git refs/heads/master`) and build URLs as `…/mpfb2/<mpfbRef>/src/mpfb/data/…`. `fetch.mjs` writes `tools/legends/cache-manifest.json` (committed: relative path → byte size + SHA-256 of every fetched file); `bake.mjs` verifies the cache against it and exits 1 on any mismatch. Because the existing `.cache` was fetched from `master` on 2026-10-10 17:00 UTC, WP1 re-fetches once with the pinned SHA into a fresh cache and, if any hash differs from the old cache, re-runs `calibrate --write` before the first v2 bake. |
| `measure.mjs` | `--likeness` computes the §10.2 metrics, prints a table, exit 1 on any band or ordering miss; `--json` includes them |
| `calibrate.mjs` | unchanged knobs; reads `meta.calibration` (Giannis headH 0.232, craniumFace 1.10; Kobe craniumFace 0.95) |
| `legends.config.json` | `output`, `keepMouth: true`, new `appearance` schema (hair `layers[]`, `hairline{}`, `scalp{}`, beard `components{}` + `layers[]`, `eyebrows{gap, arch, tail, hIn, hOut, density, archOuter?}`, kit classic side, trims, `socks.shell`, `shoes.overrides`) with §2.7–§2.8 values, §10.3 morph values, `expressions: {<channel>: {modifiers, jaw: {rotDeg, translate}, tongue: {translate}}}` per §3.9, `mpfbRef`; the old `chin-jaw-drop` descriptors removed; `appearance.hair.coverage` replaced by layer densities |
| `README.md`, `FORMAT.md` | v2 sections, masks, per-player shells, morphs, `--likeness`, licence (CC0 MakeHuman + MPFB data) |
| `package.json` | scripts §8.4 |

### 8.4 Commands to regenerate `assets/legends/` (run from `games/nba2k-threejs/`)

```bash
cd tools/legends && npm install                          # optional: meshoptimizer 0.22.0 (LOD indices); once
node fetch.mjs legends.config.json                       # CC0 MakeHuman base/targets + MPFB rig/weights, pinned to mpfbRef, cached in .cache/
node calibrate.mjs legends.config.json --write           # only after head/face/length modifier edits (§10.3)
node bake.mjs legends.config.json                        # → ../../assets/legends/ (header v2, 7 bins, 15 PNGs)
node measure.mjs ../../assets/legends/legends.json --likeness   # exit 0 required
cd ../.. && node test/unit-legends-bake.mjs && node test/unit-legends-format.mjs
node test/likeness/shoot.cjs                             # screenshots → test/likeness/out/ (gitignored)
```
`tools/legends/package.json` scripts: `fetch:legends`, `bake:legends`, `calibrate:legends`,
`measure:legends` (`--likeness` on `../../assets/legends/legends.json`), `likeness` (bake + measure --likeness + shoot).
Game `package.json` (name `legends-3v3`): `start` (`python3 -m http.server 8080`), `test` (`node test/acceptance.cjs`),
`test:unit` (every `test/unit-*.mjs`), `test:balance` (`node test/balance.mjs`), `test:balance:quick`
(`node test/balance.mjs --quick`), `bake` (`cd tools/legends && node bake.mjs legends.config.json`), `likeness`
(`node test/likeness/shoot.cjs`). The bake is deterministic: two runs with the same config and cache produce
byte-identical files (SHA-256 compared in `unit-legends-bake.mjs`).

### 8.5 (WP1) Expression, eye and mask details referenced
[ref CHR:§2.3 Shared mask fields], [ref CHR:§4.4 Hairline function], [ref CHR:§5.1 Components], [ref CHR:§8.2 Jaw
field], [ref CHR:§8.3 Blink], [ref CHR:§11 Required changes to `tools/legends/`] (where it does not conflict with §8.3).

### 8.6 Bake acceptance (log lines checked by `test/unit-legends-bake.mjs`, skipped when `tools/legends/.cache` is absent)

Rig check 0.00 mm; `players: 6`; every per-player shell non-empty (Jordan has no hair shell, Yao no beard shell); every
morph target > 50 vertices and max |Δ| < 0.06 m; low tier needs none; masks written within budget; `legends.json`
passes `format.js parseHeader`; total `assets/legends/` ≤ 3.5 MB; deterministic re-bake (identical hashes);
`unit-legends-format.mjs` (always runs on the committed files): kept counts, every index < renderVertices, every shell
a/b < keptVertices, morph indices in range, eye radii 0.013–0.019 m, feet length 0.27–0.36 m.

---
## 9. Acceptance checklist v2 (Playwright, `test/acceptance.cjs`, WP9)

### 9.1 Harness (`test/harness.cjs`)

Headless Chromium `--use-angle=swiftshader` (classified `software` → rung 2 = low unless `?quality=` forces a tier;
frame rates are never asserted headless, counts/bytes are). Devices: `desktop` 1280×720, `phonePortrait` 390×844
(iPhone 11, DPR 2, touch), `phoneLandscape` 844×390, `androidPortrait` 393×851 (Pixel 5), `androidSmall` 360×640 (DPR 3,
touch), `landscapeShort` 740×304, `seLandscape` 568×320, `tabletLandscape` 1024×768. Helpers: `startGame` →
`index.html?quick=1&intro=0&seed=7` + click 快速比赛 + `await __game.legendsReady`; `openLineup`; `forceTier`
(`?quality=`); `frameStats()` (calls / tris / texMB of one complete frame). Static server serves the game folder at
`/games/nba2k-threejs/`.

### 9.2 Denylist v2 (used by B2; word-boundary, case-sensitive; CJK entries without `\b`)

Removed from v1: `LeBron`, `Jordan`, `Kobe` (real names required). Kept: the 30 franchise names of v1 (`Lakers …
Wizards`, `Sixers`, `76ers`), `Curry`, `Durant`, `Jokic`, `NBA`, `2K`. Added: `Air Jordan`, `Jumpman`, `Mamba`, `Black
Mamba`, `King James`, `Greek Freak`, `Uncle Drew`, `Concord`, `Bred`, `Nike`, `Adidas`, `Spalding`, `Wilson`, `Swoosh`,
`Gatorade`, `Under Armour`, `湖人`, `公牛`, `骑士`, `雄鹿`, `火箭`, `凯尔特人`, `勇士`, `热火`, `篮网`, `耐克`, `阿迪达斯`,
`黑曼巴`, `飞人`, `小皇帝`, `德鲁大叔`. (`字母哥` is allowed: common Chinese short name.) Scanned: `src/**`, `index.html`,
`css/style.css`, `README.md`, `assets/legends/legends.json`, `tools/legends/legends.config.json`.

### 9.3 Items (B1–B27 replace v1 A1–A27 one-to-one; B28–B61 are new)

| id | from | check (pass criteria) |
|---|---|---|
| B1 | A1 changed | `startGame` on desktop, iPhone 11 portrait/landscape, Pixel 5: zero `console.error`, zero uncaught exceptions, zero failed requests, every request same-origin (incl. `assets/legends/*`); none during a full `fastForward(120)` game with intro and replays enabled |
| B2 | A2 changed | static scan of `src/**/*.js`: imports start with `./` or `../`; the three.js import is the depth-correct `vendor/three.module.js` path (H2); no `importmap`; no dynamic `import(`; no top-level `await`; no `Math.random`; CJK only in `src/i18n.js` and `src/legends.js`; denylist §9.2 over the scanned files returns nothing |
| B3 | A3 changed | `wc -l src/**/*.js` ∈ [16,000, 48,000]; no file > 1,600 lines except `src/anim/clips/*.js` and `src/anim/clip.js`; `vendor/` = `three.module.js` + `LICENSE.three.txt` |
| B4 | A4 changed | body text contains `开始游戏`; no empty `[data-i18n]`; `[data-action=lang]` → `Play`, not `开始游戏`, and `__game.arena.jumbo.lastText` changes language; toggling back restores; reload keeps the choice |
| B5 | A5 changed | 快速比赛 → `CHECK` then `LIVE` ≤ 3 s after `legendsReady`; 6 players; score bug `暗夜`/`烈阳` (zh) or `DRK`/`BRT` (en), `0 0`, `第1节`/`Q1`, `02:00`, shot clock `14`; after `fastForward(3)`: `01:57` and `11` |
| B6 | A6 kept | joystick drag +60 px for 1 s → controlled `pos.x` +> 1.0 m; release → speed < 0.1 m/s within 0.5 s; −60 px y → `pos.z` −> 1.0 m |
| B7 | A7 changed | multi-touch sprint + joystick: peak speed > 0.9 × `run·sprintMul·handlerMul` of the controlled legend within 1.5 s (default handler LeBron: > 6.1 m/s); release semantics as v1 |
| B8 | A8 kept | slide-over sprint → primary: `primary.held === true`, `sprint === false` |
| B9 | A9 kept | labels 投篮/传球/变向/冲刺 ↔ 盖帽/换人/抢断/冲刺 within 200 ms, `#cluster.defense`; buttons ≥ 56 × 56 inside the viewport in 844×390, 390×844, 812×375, 375×812; safe-bottom 34 px rule |
| B10 | A10 changed | keyboard: `d` 500 ms → x +> 1.0; `w` → z decreases; `Space` held for the controlled legend's `getTiming(set).tIdeal` then released → `ball.state === 'flight'`, fga +1; `p` pause / resume countdown |
| B11 | A11 changed | `place` handler at (0, −8.3) standing, `debugShoot({p:1, eT:0})` → +2 within 4 s, DEAD → CHECK → LIVE, possession switched; at (0, −4.8) → +3 (feet at release) |
| B12 | A12 changed | `debugShoot({p:0, eT:−0.08})` × 20: never scores, each emits `rim` or `board` first; `eT:−0.20` × 10: ≥ 6 without rim contact + `cap.airball`, ≤ 2 end OOB |
| B13 | A13 changed | at (0, −8.3), `debugShoot({eT:0})` × 40 open → makes ≥ 40p − 2.5·sqrt(40p(1−p)) with p from `debugContest` + §5.3.4; `eT:−0.20` × 40 → ≤ 40p + 2.5σ; with a defender placed at (0, −9.0) and forced jump → ≤ 40p + 2.5σ using the contested p |
| B14 | A14 changed | `?auto=1` seeds 3 and 11, `fastForward(60)`: no NaN in players/ball/character object positions; `invariantsBroken === 0`; \|ball.x\| ≤ 9, −16 ≤ ball.z ≤ 1; shot clock ∈ [0, 14]; FGA ≥ 6, each team FGM ≥ 1; no free ball > 6 s |
| B15 | A15 changed | pass to an open teammate → `pass` then the teammate owns it and is controlled within 1 s; defender 0.3 m off a 6 m line, 30 seeded trials → ≥ 9 intercepted or deflected |
| B16 | A16 changed | SWITCH changes the controlled defender; poke attempts → STL is credited only when the defence catches the ball (R#23); a poke recovered by the offence credits nothing; SHOOT on defence sets `isJumping` |
| B17 | A17 kept | shot clock 0.5 s while holding → `cap.shotClock`, DEAD(SHOT_CLOCK), possession switch; handler walked to x = 8.2 → `cap.oob` |
| B18 | A18 changed | quarter/halftime/OT flow as v1; game over shows `#menuOver` with 6 box-score rows (incl. 助攻) and `#mvpCard` whose name is in `LEGENDS`; tie → `加时赛`/`OVERTIME`, `加时`/`OT`, `01:00`; during `HALFTIME` pressing `p`, `Escape`, `m`, `t` does not end the halftime (R#21/R#36) while any other key or a tap does |
| B19 | A19 kept | `?q=0.1&auto=1&seed=5`, `fastForward(120)` → GAME_OVER (or OT) with both scores > 0 |
| B20 | A20 changed | on all 8 viewports: no page scroll, canvas = viewport, `#scoreBug` ∩ (`#btnPrimary`, `#btnPause`, `#cluster`) = ∅, `touch-action: none` on body/canvas, wheel does not scroll |
| B21 | A21 changed | 844×390 ↔ 390×844 mid-LIVE keeps LIVE, canvas resizes ≤ 500 ms, `camera.fov` 42 (landscape) / 72 (portrait) ± 4 during zooms; `baseFov(4/3) = 54.2 ± 0.5`; rim and ball inside NDC **computed with the view offset** |
| B22 | A22 changed | first portrait title shows `#rotateHint`; it is hidden in LIVE even if not dismissed (R#8); 知道了 persists across reload |
| B23 | A23 changed | `?quality=low/medium/high` → `getPixelRatio()` ≤ 1.0 / 1.5 / 2.0; auto under iPhone 11 emulation → rung 2 (≤ 1.0) |
| B24 | A24 kept | hidden → paused, clock frozen; visible → pause menu, clock frozen until resume |
| B25 | A25 changed | per forced tier after 5 s LIVE: draw calls, triangles, `texMB` ≤ §7.5; `stepMs` mean < 1.5 ms over `fastForward(10)`; `animMs` reported |
| B26 | A26 changed | screenshots title / LIVE 2 s / LIVE 8 s (landscape & portrait): luma > 0.12 on > 25 % of pixels, pairwise > 1 % different; team colours exact on the DOM chips; in 3D, for each team's ★ (CRITIC: a fixed 24 × 24 crop lands on the number), take the pixels inside the projected torso box (centre = projected `spine_02`, width 0.6 × `shoulderJoints`, height = projected `spine_03` − `pelvis`), drop pixels whose hue is within ±20° of the number colour or whose saturation < 0.30; the median hue of the rest is within ±18° of the kit base (DARK wine #6F263D, BRIGHT red #CE1141) with ≥ 40 % of the box pixels kept; plus the two ★ boxes differ in mean luma by ≥ 0.12 (dark vs bright readability) |
| B27 | A27 changed | audio null before a gesture, created on the first click; `M` mutes; every v1 + v2 SFX function and the crowd module run without throwing while suspended |
| B28 | new | `legendsReady` ≤ 30 s; ids = the six; `dims.heightBarefoot` within ±0.02 m of 1.96/1.96/2.03/2.09/2.27/1.87; showcase lineup pixel-height ratio Yao/Kyrie = 2.27/1.87 ± 3 % |
| B29 | new | pairwise RMS distance of the six players' kept positions > 0.008 m; showcase head and full-body crops pairwise differ by > 6 % of pixels (Δ > 24) |
| B30 | new | title → 开始游戏 → lineup shows DARK (LeBron ★, Kyrie, Giannis) vs BRIGHT (Jordan ★, Kobe, Yao); tap Kobe then LeBron → swapped; `kitMode` of all six becomes `allstarA/allstarB` (chest luma A > 0.7, B < 0.2); 开始 → score bug 白队/黑队 (WHT/BLK); every card/button ≥ 44 px on 390×844, 844×390, 360×640 |
| B31 | new | 重置 → classic kits (hex within ±6/255 on painted atlas texels) and 暗夜/烈阳; 球衣 全明星 with the default lineup → All-Star; 经典 with a custom lineup → classic + `lineup.clash`; `localStorage` throwing → default lineup, no error; `我方 B` → after 开始 the controlled player at the first user CHECK is `lineup.b[0]` (Jordan ★ by default); tapping the ★ area of another user-team card makes him the check handler |
| B32 | new | full intro: 6 lower-thirds with current-language names in team order, jumbotron `intro`, ≤ 16.5 s to CHECK; tap skips one legend; 跳过 skips all ≤ 0.3 s; rematch uses the short intro (≤ 5.0 s) |
| B33 | new | `debugShoot({kind:'dunk', p:1})` → `replay.active` ≤ 1.2 s after the score; director mode `replay`; duration 3.0 ± 0.2 s; focus LOD per tier rule; tap ends it ≤ 0.2 s; game reaches CHECK; a plain made jumper triggers none; setting 关 → none; `renderer.info.memory` unchanged after 3 replays |
| B34 | new | `?quality=` → tier, shadows on/off, reflection only on high, crowd 700/1,600/2,600; settings change applies at the next CHECK; SwiftShader auto → rung 2; slow frames with a menu open do not demote; synthetic 33 ms cadence does not demote; synthetic 3 s of 26 ms frames in LIVE at target 16.7 demotes exactly one rung |
| B35 | new | Σ bytes of `index.html`, `css/`, `src/`, `vendor/`, `assets/legends/` ≤ 5.4 MB; `assets/legends/` ≤ 3.5 MB; ≤ 110 requests during load; loading screen visible in a screenshot ≤ 1.0 s after navigation |
| B36 | new | 8 viewports × zh/en: every visible `button`/`.opt`/card ≥ 44 px; zh `.lbl` single line; game-over buttons inside `#menuOver`; lineup panel fully visible or touch-scrollable at 740×304 and 851×337; joystick `pointerdown` at (4, 300) and (150, H − 4) without move → `intent.move.mag === 0` (R#9); `#stickRing` never covers `#cluster` buttons (R#10) |
| B37 | new | landscape and portrait, scenarios CHECK / wing / corner / paint / handler at z −1: rim and ball \|NDC\| ≤ 0.9; controlled player's feet NDC y ≥ −0.95; half line visible (y ≥ −1.0) with the handler at z ≥ −2 (landscape); off-screen indicator present when a teammate's feet project outside |
| B38 | new | captions use `short` names; a score caption replaces a stale rebound caption within 0.7 s (R#42); queue empty after rematch and quit (R#19); banner re-renders on language toggle (R#20) and survives pause (R#22) |
| B39 | new | `?showcase=1&view=lineup` and `view=heads` set `__showcase.ready`; no console errors; screenshots to `test/results/showcase/` (lineup yaw 0 / 0.5 / π/2; heads yaw 0 / 0.6; kits classic / All-Star); two runs differ by < 0.5 % of pixels |
| B40 | new | route-abort `assets/legends/legends.kobe.bin` → `#loadError` naming the file ≤ 25 s; 重试 after unblocking → loads; 简化模式 → 6 primitive players, playable, no `console.error`; `getContext('webgl2')` stubbed to null → simplified mode + `toast.webgl1` |
| B41 | new | `renderer.info.memory` (geometries, textures) and `texMB` identical after 5 rematches + 5 lineup/kit changes + 3 replays |
| B42 | new | `toneMapping === NeutralToneMapping`, exposure 1; CHECK frame 844×390 medium: wood patch (40 × 20 px between FT line and arc top) mean luma 0.60–0.72; kit chest crops keep hue ±18° |
| B43 | new | page inside `<iframe sandbox="allow-scripts allow-same-origin">` from a different directory depth with `Storage.prototype.getItem/setItem` throwing: boots to the title, quick game reaches LIVE, settings work in memory, no cross-origin requests |
| B44 | A-ANIM-1 | `?anim=list` and every clip × six players render 10 frames with no console/page errors |
| B45 | A-ANIM-2 | `?anim=loco&loco=5.2&player=yao` and `kyrie`: max locked-foot slide < 0.01 m |
| B46 | A-ANIM-3 | in game, a perfect jumper per legend (`debugShoot({eT:0})` release at `tIdeal`): `e` within ±0.02 and launch ball height within ±0.08 m of §4.9.2 |
| B47 | A-ANIM-4 | debug dunk: ball y ≥ 3.15 m at `SLAM`; ball step displacement ≤ 0.30 m every step (no teleport) |
| B48 | A-ANIM-5 | Space keydown → first rendered frame where the shooter's right palm moved ≥ 2 cm ≤ 2 sim steps |
| B49 | A-ANIM-6 | CHECK → LIVE: no bone rotates more than 25° between consecutive frames (R#37) |
| B50 | A-ANIM-7 | every recorded block had palm–ball distance < `rHand` (0.30; 0.36 LeBron chase-down; 0.34 Yao anchor / Giannis help) (C2) |
| B51 | A-ANIM-8 | no full-body celebration is active when the CHECK tween starts |
| B52 | A-ANIM-9 | pass launch position equals the passer's hand socket within 0.02 m |
| B53 | GP A30 | touch gestures: quick SHOOT tap (< 0.12 s) → `pumpFake` in events; CROSS double-tap → 2 moves queued; walking into a defender placed at (2.0, −10.5) for 0.35 s → state `post` |
| B54 | GP A31 | `forceAbility(id)` for all 22 ids: each logs exactly once, no invariant break |
| B55 | GP A32 | `?bot=avg&seed=5&q=0.5` full game reaches GAME_OVER with FG% of both teams in 30–75 % |
| B56 | CHR §12 | medium: character draw calls = 4 per character (measured by toggling characters), character triangles ≤ 100k at the CHECK camera; WebGL program count does not grow from 1 to 6 characters; Kyrie's mouthguard absent on medium; kit material `side === DoubleSide`; forcing `lodOverride` 0 → 1 → 2 → 3 → null on all six leaves `renderer.info.memory.textures` and `texMB` unchanged (one morph texture per character, §3.4) |
| B57 | GP §15 | for every legend's mid-range jumper, AnimProxy socket height at `RELEASE` vs the real socket within 0.10 m |
| B58 | CHR | per legend on medium: `morphTargetDictionary` has exactly the channels of §3.9 (low: none); shells present per §2.7–§2.8 (Kobe sleeve + tape, Jordan wristband and no hair shell, LeBron headband, Yao no beard shell, Kyrie no headband) |
| B59 | CRITIC [DEC] | `document.title` is `传奇对决 3v3` (zh) / `LEGENDS 3v3` (en); the title and loading screens show `legal.note`; `README.md` contains both `非商业粉丝作品` and `Non-commercial fan project` and the names-and-likenesses sentence; `assets/legends/README.md` names the CC0 MakeHuman/MPFB source and the pinned `mpfbRef` |
| B60 | CRITIC [PROF mannerisms] | medium, signature faces fire in play: forced Jordan generic dunk → `tongueOut` weight ≥ 0.8 at `SLAM` (also in its replay); with `__game.debug.forceCelebrate = true`, a forced Kobe dunk → `jawJut` ≥ 0.8 within 0.5 s of the score and Kobe's idle `scowl` baseline 0.35 ± 0.05 in LIVE; LeBron dunk → `roar` ≥ 0.8 within 0.15 s after `SLAM`; Kyrie made three → `smirk` ≥ 0.6 within 0.5 s and `roar` stays 0; Yao block → `roar` ≥ 0.8; weights read from `__game.characters.<id>.morph` |
| B61 | CRITIC (R#4, §6.4.3) | during a windup while the broadcast camera is still easing (handler sprinting to the wing), the `#meter` element centre stays within 3 px of the projection, with this frame's matrices, of the shooter's chest–head midpoint + (40, −40) px; custom lineup with LeBron and Jordan on one team: their off-screen indicators show 詹 / 乔 (zh) or LE / JO (en), not two `23`s |

### 9.4 Unit and Node tests (`npm run test:unit`, `npm run test:balance`)

| file | WP | covers |
|---|---|---|
| `unit-legends-bake.mjs` | 1 | §8.6 (skipped without `.cache`) |
| `unit-legends-format.mjs` | 2 | committed header/bins (§8.6 list) |
| `unit-skinpaint.mjs` | 2 | 8 × 8 synthetic planes → known RGBA (lip texel = lips mix, roughness alpha, nail 0.25) |
| `unit-sneaker.mjs` | 2 | counts per tier, skin weights sum to 1 using only foot/ball/calf, outsole min y = 0 ± 1e−6, no NaN |
| `unit-glyphs.mjs` | 2 | 10 digits, advance/height constants, `24, 23, 34, 11, 2` fit the back-number box |
| `unit-anim.mjs` | 3 | §4.15 |
| `unit-ratings.mjs`, `unit-shot.mjs`, `unit-block.mjs`, `unit-steal.mjs`, `unit-abilities.mjs`, `unit-lineup.mjs` | 4 | §5.1 table; §5.3 Pg table, timing, contest examples, points; §5.4 table, windows, chase-down; §5.5 table, credit rules; §5.8; swap/shuffle/reset/kit modes/persistence with throwing storage, legends.js ↔ header meta |
| `unit-core.mjs`, `unit-physics.mjs`, `unit-ball.mjs` (updated) | 4 | v1 + rim constants, separation, socket attachment; CRITIC rule fixtures, one per §5.13 row: R1 feet at release (S8 geometry), R2 untouched air ball recovered by the offence keeps the shot clock running (no reset to 14) (R#15), R3 release in the step the clock expires is valid (R#16), R4 rim-rattler dropping 0.4 s after the buzzer counts, 0.6 s does not (R#17), R5 blocked three that drops = 3 (R#18), R6 floor-bounced pass caught by the defence = STL not REB (R#24), R7 no CPU poke in LIVE 0–0.8 s and catch + 0.5 s (R#39) |
| `unit-ai.mjs` | 5 | matchups (binding values §5.10), catch gate, guardBeaten, risk filter, countdown timers |
| `balance.mjs` | 5 | §5.14 bands A–C and S1–S11 (`--quick` for CI) |
| `unit-quality.mjs`, `unit-floorpaint.mjs`, `unit-ballpaint.mjs`, `unit-net.mjs`, `unit-crowd.mjs` | 6 | renderer-string table → class/rung, caps, cadence target, judge gate, demote/promote/lock; wood tile seamless (edge diff < 6/255), roughness alpha ∈ [0.15, 0.40], marking coordinates, half-line band 0.0254, i18n/denylist-clean strings; ball seam coverage 6–10 %, pebble density ratio 0.85–1.15, spin signs; net rest stable, impulse < 1 mm within 1.5 s, \|o\| ≤ 0.18, no NaN; seat counts/occupancy/determinism/palette shares ±3 %; `shadows.js`: one blob texture + one geometry for all 7 blobs (R#5); `hoop.js`: glass is a single `FrontSide` plane, opacity 0.16, `depthWrite false` (R#6); quality monitor: synthetic 33.3 ms vsync-locked intervals with busy 6 ms re-target to 33.3 without a rung change, then 16.7 ms intervals return the target (§7.3 cadence rule) |
| `unit-camera.mjs`, `unit-replay.mjs` | 7 | FRAMING values and the §6.4.2 measured counts (36/36, 34/36 at 390×844, 36/36 at 360×640), half line −0.83 ± 0.03 at z −1, `baseFov(4/3) = 54.2 ± 0.1`, lens shift rim 0.23 → 0.48 ± 0.02; ring wrap, bracketing, slerp α 0.5, 0.5× mapping, windows, no `Float32Array` after init |
| `unit-captions.mjs`, `unit-present.mjs`, `unit-audio.mjs`, `unit-i18n.mjs` | 8 | priority flush, 2.0 s drop, clear, re-render; MVP formula + ties, composites §2.4, settings defaults + try/catch; new SFX with a mock AudioContext, squeak rate limit, voice cap 16; every key has zh + en, no key missing for any `t()` call site (static scan) |

### 9.5 Manual device matrix (phase D; results in `test/README.md`)

Each device also records `__game.perf.load` and must meet the §7.6 phase budgets (≤ 25 % over → GPU-paint fallback of §7.6).
iPhone 11 (iOS Safari, medium and high), iPhone 13 (high), a 2021 low-end Android (PowerVR GE8320 or Mali-G52, low), a
desktop with integrated graphics (medium): each holds the §7.5 JS budget and ≥ 55 fps median (≥ 28 fps on low) over a
60 s LIVE sample (`__game.perf`), plus one full game per device in both orientations.

---
## 10. Likeness review protocol (phase D; WP1 + WP2, reviewed by a reviewer subagent with image input + the human)

### 10.1 What the PoC shows (looked at: `test/scratch/legends-poc/shots/legends_heads_groom_1.png`, `legends_lineup_groom_1_yaw_0.5.png`, `legends_heads.png`, `clothes_*.png`, `lod.png`)

Bodies and heights read correctly (Yao tallest, LeBron broadest, Giannis long-legged, Kyrie compact). Skin was a 65 %
grey tint (Yao pink-white) → v2 paints the hex directly. Every beard is the same blocky full-beard mask (wrong for Kobe,
Jordan, Giannis); hair caps are opaque with hard edges (Kobe's 1.5 mm buzz is a solid black cap); brows are blocky
strips; no lip colour, no darkened nostrils/lid lines. Kobe and Kyrie heads are nearly identical; Kobe's chin does not
project and his face is the widest for its length; Giannis's lower face is far too long; Yao has the largest eye opening.

### 10.2 Face metrics (`measure.mjs --likeness`; definitions [ref CHR:§10.2 Face metrics])

| metric | kobe | jordan | lebron | giannis | yao | kyrie | ordering rule |
|---|---|---|---|---|---|---|---|
| faceLW baseline → target | 0.74 → **0.80–0.84** | 0.77 → 0.80–0.83 | 0.79 → **0.74–0.78** | 1.02 → **0.86–0.92** | 0.80 → **0.86–0.92** | 0.78 → 0.78–0.82 | LeBron lowest; Giannis, Yao highest |
| chinProj (mm) | −3.2 → **≥ +1.0** | −6.2 → −5…−2 | −6.6 → −5…−2 | −6.5 → −4…−1 | −6.5 → −5…−2 | −5.9 → −6…−3 | Kobe max by ≥ 3 mm |
| earOut (mm) | 13.9 → 13–17 | 23.1 → **≥ 27** | 7.5 → ≤ 9 | 18.6 → 20–24 | 26.5 → 23–27 | 10.2 → ≤ 11 | Jordan max; LeBron, Kyrie min |
| fissH (mm) | 6.7 → 6.0–6.6 | 6.8 → 5.8–6.4 | 7.4 → 6.0–6.6 | 7.0 → 6.4–7.2 | 10.2 → **≤ 6.0** | 7.0 → 6.0–6.6 | Yao min |
| lipsH (mm) | 26.4 → 26–28 | 27.0 → 28–30 | 28.8 → 29–31 | 32.0 → 29–32 | 26.2 → 25–27 | 25.6 → **28–30** | Yao min |
| headH (cm, calibrated) | 24.0 | 24.5 | 24.5 | 23.2 (calibration target `headH` 0.236 → **0.232**, craniumFace 1.10) | 26.4 | 23.2 | [XCHK] |
| noseIcd (ordering only) | 1.49 → 1.40–1.48 | 1.50 → 1.52–1.60 | 1.52 → 1.52–1.60 | 1.49 → 1.48–1.56 | 1.40 → 1.40–1.48 | 1.46 → 1.40–1.46 | Jordan, LeBron widest |

### 10.3 Starting config changes (`legends.config.json`, current → new; then `calibrate --write`)

- **kobe**: chin-prominent 0.45 → 0.65; chin-prognathism 0.35 → 0.55; chin-height 0.20 → 0.45; chin-bones 0.35 → 0.45;
  head-scale-horiz −0.15 → −0.30; head-fat −0.40 → −0.50; cheek-volume −0.45 → −0.60; cheek-bones 0.45 → 0.55;
  eye-push1-in-out −0.20 → −0.35; eye-height2 −0.25 → −0.35; eyebrows-trans-down-up −0.20 → −0.30; mouth-scale-horiz
  0.20 → 0.30; nose-flaring 0.35 → 0.25; `meta.calibration.craniumFace` 0.98 → 0.95.
- **jordan**: ear-wing 0.60 → 0.85; ear-flap 0.30 → 0.45; ear-scale 0.45 → 0.55; chin-height 0.25 → 0.40;
  head-scale-horiz −0.12 → −0.20; eye-eyefold-down-up −0.30 → −0.45; eye-height2 −0.20 → −0.30; nose-flaring 0.50 → 0.65;
  nose-scale-horiz 0.35 → 0.45; mouth-lowerlip-volume 0.45 → 0.55; cheek-volume −0.35 → −0.45.
- **lebron**: head-square 0.55 → 0.70; chin-width 0.50 → 0.60; head-scale-horiz 0.15 → 0.25;
  eyebrows-trans-backward-forward 0.45 → 0.60; eye-push1 −0.20 → −0.35; eye-height2 −0.25 → −0.40; eye-eyefold −0.30 →
  −0.45; ear-flap −0.35 → −0.50; nose-scale-vert 0.20 → 0.30.
- **giannis**: chin-height 0.85 → 0.55; head-scale-horiz −0.25 → −0.30; head-back-scale-depth 0.10 → −0.15; ear-wing
  0.35 → 0.55; cheek-volume −0.45 → −0.55; `meta.calibration.headH` 0.236 → 0.232, `craniumFace` 1.05 → 1.10 (9.0 heads).
- **yao**: eye-height1 0 → −0.40; eye-height2 −0.25 → −0.65; eye-height3 0 → −0.40; eye-scale −0.20 → −0.35;
  eye-epicanthus-in-out 0.20 → 0.40; eye-eyefold −0.30 → −0.50; chin-height 0.35 → 0.55; head-rectangular 0.45 → 0.60;
  head-scale-horiz −0.10 → −0.20; nose-scale-horiz 0.15 → 0.30; nose-point-width 0.30 → 0.40; nose-scale-vert 0.35 →
  0.45; mouth-scale-horiz 0.25 → 0.35.
- **kyrie**: head-oval 0.50 → 0.60; head-scale-horiz −0.15 → −0.25; chin-height 0.10 → 0.20; chin-width −0.05 → −0.15;
  cheek-bones 0.35 → 0.50; cheek-volume −0.30 → −0.45; mouth-lowerlip-volume 0.40 → 0.50; mouth-upperlip-volume 0.35 →
  0.45; eye-eyefold −0.20 → −0.40; ear-flap −0.25 → −0.35.

Rule: each review round changes any modifier by at most ±0.30; values stay in [−1, 1] (one-sided ≥ 0).

### 10.4 Screenshots (`test/likeness/shoot.cjs` driving `index.html?showcase=1`, high tier, LOD0, final materials; output `test/likeness/out/`, gitignored)

| file | content |
|---|---|
| `heads.png` | 6 columns × 3 rows (yaw 0, 0.6, π/2), 360 × 360 px each, fov 16°, distance 1.3 m, studio key/fill/rim, neutral face |
| `expressions.png` | 6 × 3: the player's signature channel at 1.0, `scowl` 0.6, `blink` 1.0 |
| `lineup_kit_front.png`, `lineup_kit_back.png` | near-orthographic lineup (fov 18 at 26 m) in classic kits: numbers, names, socks, shoes, accessories |
| `lineup_allstar.png` | All-Star A/B |
| `gameplay.png` + `crop_<id>.png` | 844 × 390 @ DPR 1.5, game camera, CHECK formation; 120 px tall crops |
| `grey_crops.png` | same crops, every kit forced to #808080, numbers off |
| `landmarks.png` | LOD0 heads with the landmark dots (one-time index check before freezing `landmarks.mjs`) |

Showcase parameters: `view=lineup|heads|turn|kits|expr|landmarks`, `yaw`, `kit=classic|allstarA|allstarB|grey`,
`groom=0|1`, `tier`, `expr=<channel>`, `id`; seeded, time frozen, no crowd/HUD, background #2a2f3a, heads in a 6 × 2
scissor grid at eye height 0.85 m away fov 28 (game view) — `window.__showcase = {ready, setView}`.

### 10.5 Per-player checklist (pass / partial / fail; from [PROF] likenessPriorities)

- **kobe**: K1 smooth dark-stubble scalp (not glossy, not a solid cap), long narrow oval head, hairline 6.8 cm above the
  brow with a mild M; K2 chin forward of the subnasale in profile (chinProj ≥ +1 mm), long strong lower face; K3 thin
  moustache + small goatee, faint jaw shadow, no full beard; K4 hollow cheeks under high cheekbones, low straight brows,
  narrowed deep-set eyes; K5 gold #24 purple numbers + white outline (rounded digits), black right sleeve, white tape on
  right index + middle, low-tops, high white socks; K6 `jawJut` thrusts the chin ≈ 1 cm.
- **jordan**: J1 shiny bald egg head with a visible specular highlight, no hair shell; J2 largest protruding ears
  (earOut ≥ 27 mm, max of six); J3 thin moustache + small goatee + faint linking lines, clean cheeks; J4 broad flared
  nose, full lower lip, hooded low brows; J5 red #23 white/black, baggy knee shorts with the light-blue undershort band,
  red wristband mid left forearm, black patent mid-highs with red outsole, low black socks; J6 `tongueOut` visible
  outside the lips, to one side.
- **lebron**: L1 broadest shoulders, thick neck/traps; L2 black headband high and level, receded buzz visible above it at
  the sides/crown, no hair below the band at the front; L3 full dense beard, crisp high cheek line, connected thick
  moustache, squared chin, neckline ≈ 2.5 cm under the jaw; L4 heavy straight brow over deep-set hooded eyes, broad nose;
  L5 wine #23 gold/navy, darkened tattooed arms; L6 `roar` shows teeth, brows down.
- **giannis**: G1 small head (9.0 heads) on a long neck; G2 tight ≈ 1 cm coils on top, faded sides, crisp straight edge-up
  with square temples; G3 short close beard with a LOW cheek line (upper cheeks bare), thin moustache with a gap under the
  nose; G4 long but not horse-like face (faceLW 0.86–0.92), high cheekbones, hollow cheeks, protruding ears; G5 green #34
  cream/white, bare arms, white socks, long low-mid shoes; G6 wide-eyed `roar`, `grin` on menu cards.
- **yao**: Y1 tallest, small head, long neck; Y2 jet-black straight crew cut ≈ 1.5 cm, straight hairline, flat-ish top,
  tapered sides, ears exposed; Y3 small narrow monolid eyes (fissH ≤ 6 mm, min of six), thick low straight brows tilting up
  at the outer ends; Y4 long rectangular face (faceLW 0.86–0.92), long chin, large ears, long nose with a broad tip; Y5
  clean-shaven light warm-tan skin #D8A985, red #11 white/silver + black keyline, baggy shorts, white socks with an ankle
  bulge, red high-tops; Y6 `grin` squeezes the eyes nearly shut.
- **kyrie**: I1 full dense groomed beard, sharp high cheek line, connected moustache — a clear dark jaw mass at 120 px;
  I2 shortest and compact, thick thighs; I3 short coiled crop, crisp edge-up, square temples, no headband; I4 slim oval face
  (narrower than LeBron/Giannis), high cheekbones, full lips (lipsH ≥ 28 mm), heavy-lidded calm eyes, skin #8A5A3B lighter
  than Jordan/LeBron/Giannis; I5 wine #2 gold/white, low-cut black/gold shoes, white crew socks; I6 asymmetric `smirk`.

### 10.6 Pass rule and rounds

A round = edit config (≤ ±0.30 per modifier, §10.3 for round 1) → `fetch` (first time) → `calibrate --write` (if head or
face-length modifiers changed) → `bake` → `measure --likeness` → `shoot.cjs` → checklist. Pass when **all** hold:
1. `measure --likeness` exits 0 (bands and orderings of §10.2);
2. per player ≥ 5 of 6 checklist items pass and no fail among items 1–3;
3. blind identification by the reviewer: shuffled `heads.png` columns with names hidden → 6/6; `grey_crops.png` → ≥ 5/6;
   `crop_<id>.png` with kits → 6/6;
4. grooming sanity at 360 px: no hard cap edge at any hairline (inner fade 0.8–4 mm), Kobe's and Jordan's beards are not
   full beards, Yao has no beard shell.
**Maximum 4 rounds.** Whatever still fails after round 4 is recorded as a known gap in the phase-D report (with the
metric values and the crops) instead of exceeding the modifier step rule. No real photos are stored in the repository;
the reviewer compares against its own knowledge of the players and the profiles.

---

## 11. Known simplifications and risks

### 11.1 Simplifications (v1 §16 still applies where not listed)

- Half court, one hoop, both teams attack the same basket; automatic 1.2 s check after dead balls; clear-the-ball is an
  option (off); no fouls, free throws, travelling, double dribble, 3/5-second, goaltending, charging, timeouts,
  substitutions or injuries.
- Shot outcome is a probability roll at release; the arc is steered to a make or a physical rim/board miss. Blocks are
  a geometric eligibility + probability roll; contests are geometric (distance, hand height, rating), not collision.
- Players are kinematic capsules with separation; body contact is modelled only as drive bumps, post shoves and box-outs.
- Likeness comes from MakeHuman macro/detail modifiers (no sculpting, no photo textures); hair/beards are shells with a
  strand texture (no strand geometry or physics); cloth is skinned shells (no simulation; wrinkles are painted); shoes
  have no sole lift; eyes look by UV offset (no eye bones); facial expressions are 9 baked channels (Low tier: none).
- Animation is procedural + keyframed clips authored as joint-angle tables (no motion capture); the signature moves are
  hand-keyed from the profiles' frame descriptions.
- No team rename, no custom kits, no season/career modes; one arena; crowd is billboards; audio is synthesized (no
  commentary, no names chanted).
- Assists: last passer, ≤ 3.0 s catch → press (C27).
- Finishing is distance-driven (C9): a handler moving ≥ 2.0 m/s toward the rim who presses SHOOT within 4.0 m (Jordan
  4.6) always gets a layup/dunk; a short pull-up there needs speed < 2.0 m/s, a stepback (stick away) or a floater.

### 11.2 Risks and mitigations

| risk | impact | mitigation |
|---|---|---|
| Likeness misses after 4 rounds (generic MakeHuman faces, esp. Kobe/Kyrie similarity) | user goal | numeric metrics + blind ID test drive the loop; grooming (beard style, hairline, accessories) and kits carry identity at game distance; known-gap report rather than endless tuning |
| Phone GPU cost of skinned meshes + shadow proxies + alphaHash hair | frame rate | tiers with auto demotion judged in LIVE only; LOD by pixel height; proxies LOD3; low tier has blobs, no morphs, no lashes, groom inner only; 30 Hz mode as the last rung |
| Memory on iOS Safari (texture budget, 1.35 MB replay buffer, 2.3 MB clips) | crashes / reloads | high tier on touch caps skin at 1024²; texMB accounting asserted (B25, B41); textures never re-created at runtime |
| Linear-blend skinning artefacts (deltoid flattening, candy-wrapper > 60° twist, cloth slits at hip flex > 95°) | visual | pronation split 40/60, hip flex > 95° only airborne, phase-D viewer check; lower the offending keys by ≤ 10° |
| Root motion vs sim divergence (signature clips through traffic) | gameplay feel | root motion only proposes velocity; collisions/separation stay authoritative; target matching ≤ 35 % / 25°; foot locks absorb ≤ 0.10 m |
| Balance bands not met with the given formulas | difficulty | only `patience` ± 30 % and θ ± 0.1 may be tuned (§5.10); every probability has a seeded fixture (S7) |
| Load time on slow mobile networks (≈ 5.4 MB) | first impression | preloads, parallel fetch, byte progress, retries, 简化模式 fallback; warm cache ≤ 2.5 s |
| MPFB raw URLs drift | bake reproducibility | pinned `mpfbRef` SHA; `.cache`; deterministic bake asserted |
| Artifact host strips `modulepreload` / sets wrong MIME for `.bin` | load failure | explicit `application/octet-stream` on publish; preloads are optional hints; B43 iframe test |
| Real-name use | policy | non-commercial fan note in README and title; no marks, logos, brand nicknames (denylist B2) |
| Morph textures per geometry (three.js r186 keys them by `BufferGeometry`) | +2.4 MB and an upload hitch per LOD switch per player | one body geometry per character, LOD/cover = `setIndex` (§3.4); B56 asserts constant texture memory across LOD changes |
| Skin/kit painting on slow phones blocks the main thread | long loading, frozen loading bar | optimised painter (§3.5.4a), ≤ 8 ms slices with `MessageChannel` yields (§3.3), per-device budgets and GPU-paint fallback (§7.6) |
| iOS canvas / `createImageBitmap` quirks (older Safari ignores options; canvas backing stores leak) | decode failure → simplified mode | decode fallbacks and scratch-canvas shrink (§3.3); B40 covers the failure path |
| Cloth see-through and jersey/shorts slit (covered body triangles removed; PoC slit at twists) | visual holes | tucked jersey enclosed by the shorts + `DoubleSide` kit with darkened back faces (§3.8) |
| Shader compile time on iOS (synchronous, ≈ 15–20 programs) | title appears late | `renderer.compile` during loading with its own budget (§7.6); program count independent of players (B56) |
| Upper-arm axial twist beyond 60° (shoulder `int` limit is ±80°) | candy-wrapper at the shoulder | the viewer test (§4.15/B44) flags any authored key with \|shoulder int\| > 60°; such keys are lowered (≤ 10° steps) or moved into clavicle protraction |
| Large spec surface across 9 WPs | integration bugs | frozen interfaces §1.4, AnimProxy first, WP-local acceptance, B-suite at integration |

---

## 12. Disposition of every v1 review finding (R#n, 1-based)

| # | finding (short) | status | v2 disposition (where) |
|---|---|---|---|
| 1 | portrait camera hides players | 2/3 ✔ | fixed: portrait FRAMING + lens shift + jumbotron fills the top band + indicators (§6.4.2, §6.4.3) |
| 2 | landscape cuts the near 1.9 m | 2/3 ✔ | fixed: landscape FRAMING + near rule (§6.4.2) |
| 3 | DPR downgrade keyed on rAF interval | 1/3 | fixed: cadence target, judged frames, no double render, mid-session cadence re-target from busy time (§7.3; unit-quality) |
| 4 | meter projected with the previous camera | 2/3 ✔ | fixed: director ends with `updateMatrixWorld()`, HUD projects after (§1.3, §6.4.1); B61 |
| 5 | ball's own blob texture | 2/3 ✔ | fixed: shared blob + instanced blobs (§6.1); unit-quality/shadows case |
| 6 | backboard DoubleSide box | 2/3 ✔ | fixed: front-only glass plane opacity 0.16 (§6.2); hoop unit case |
| 7 | game-over panel clipped | 3/3 ✔ | fixed: layout heights, short-landscape query, `.panel` scroll + touchmove exemption (§6.5.9) |
| 8 | rotate hint during play | 3/3 ✔ | fixed: title/lineup only, hidden by `showMenu(null)` (§6.5.7) |
| 9 | joystick edge start | 2/3 ✔ | fixed: remove the initial `_updateStickVector` in `_onStickDown` (B36) |
| 10 | ring drifts over the cluster | 0/3 (real by code reading) | fixed: z-index + ring re-clamp (§6.5.7) |
| 11 | menu labels wrap < 400 px | 3/3 ✔ | fixed: 52 px label basis + keep-all (§6.5.10) |
| 12 | touch targets < 44 px | 2/3 ✔ | fixed: 44 px rule everywhere (§6.5.2, B36) |
| 13 | DPR judged under menu blur | 2/3 ✔ | fixed: judged frames only in play; no blur on touch (§7.3, §6.5.2) |
| 14 | 3 points decided at press | 3/3 ✔ | fixed: feet at release (C1, R1, S8, B11) |
| 15 | air-ball recovery resets the shot clock | 0/3 (confirmed by code reading) | fixed: R2 `shot.touched`; unit-core fixture |
| 16 | release at ≤ 1/60 s whistled | 1/3 | fixed: R3 `wasZero`; unit-core fixture |
| 17 | rattler killed at the buzzer | 2/3 ✔ | fixed: R4 `looseT`; unit-core fixture |
| 18 | deflected three scores 2 | 0/3 (confirmed by code reading) | fixed: R5; unit-core fixture |
| 19 | captions survive rematch/quit | 2/3 ✔ | fixed: `clear()` in start/quit (§6.5.8, B38) |
| 20 | language toggle misses the banner | 2/3 ✔ | fixed: banner key re-render (§6.5.8) |
| 21 | P/Esc/M/T at halftime skip it | 2/3 ✔ | fixed: reserved keys excluded (§6.5.9); B18 |
| 22 | pause loses the period banner | 1/3 | fixed: `bannerState()` stash (§6.5.8) |
| 23 | STL credited on the poke | 3/3 ✔ | fixed: R6 credit at the catch (B16) |
| 24 | floor-bounced pass caught by defence = REB | 0/3 (confirmed by code reading) | fixed: R6 (`ballCtx === 'pass'` → STL) |
| 25 | CPU shoots the instant it catches | 2/2 ✔ | fixed: 0.40 s catch gate + set-feet brake + closeouts (§5.10, S5) |
| 26 | drives starved by the lane test | 1/1 ✔ | fixed: `guardBeaten`, lane excluding the guard, `pBeat`; band ≥ 15 % drive finishes |
| 27 | difficulty does not scale CPU scoring | n.v. | fixed: §5.11 + band B (strictly increasing ≥ 4 points) |
| 28 | block window too generous | n.v. | fixed: §5.4 contact + probability; S3; band 3–8 % |
| 29 | defender backs away during the windup | n.v. | fixed: §5.10 during-shot steering + `stop` contest entries (C26); S4 |
| 30 | air balls fly OOB | n.v. | fixed: §5.3.7 air-ball target; band ≤ 20 % |
| 31 | long rim rebounds | n.v. | fixed: REST_RIM 0.40, tangential 0.80, board 0.50 + acceptance |
| 32 | green misses always long | n.v. | fixed: rng short/long |
| 33 | dunk teleports the ball | n.v. | moot: socket-driven slam at RIM.y + 0.18 with rim IK (§4.9.4); B47 |
| 34 | CPU never throws an interceptable pass | n.v. | fixed: §5.5 interceptions + §5.10 pass risk; S6; band 2–6 % |
| 35 | rematch keeps absolute AI timers | n.v. | fixed: countdown timers + `resetAI` (S11) |
| 36 | halftime handler double-fires (dup of 21) | n.v. | fixed with #21 |
| 37 | reset snaps the pose | n.v. | moot: animator crossfades, never snaps (§4.3; B49); `Player.reset()` calls no pose function |
| 38 | README rule text mismatch | n.v. | fixed: README rewrite (§5.13) |
| 39 | normal drives blocked 74/74 | n.v. | fixed: §5.4 + contest-jump jitter + R7; S1 |
| 40 | instant catch-and-shoot, defence not interactive | n.v. | fixed: #25 fixes + closeouts + auto-switch (R10) |
| 41 | camera hides the last 1.5 m before half court | n.v. | fixed: near rule, z0 ease +0.6 m, backcourt stripe (§6.2, §6.4.2) |
| 42 | captions lag the action | n.v. | fixed: priority queue with 2.0 s age drop and 0.6 s cut (§6.5.8; B38) |
| 43 | bodies clip under the rim | n.v. | fixed: `bodyR` separation, +0.10 airborne, 0.95 vs a hanging dunker (C3, §5.2) |
| 44 | verdict | — | accepted: priorities (blocks, catch-and-shoot, framing) covered by §5.4, §5.10, §6.4 |

---

## 13. Critic changes (completeness pass; every change is marked "CRITIC" in place)

Checked against: all six [PROF] profiles (likenessPriorities, hair, facialHair, accessories, jersey, signatureMoves,
mannerisms), the 44 findings of `review-r1-all.json`, [POC] risks / perf / meshStats, the PoC renders
(`legends_heads_groom_1.png`, `legends_lineup_groom_1_yaw_0.5.png`, `clothes_yaw_0.6_pose_1.png`), [DEC], and the
vendored three.js r186. Verified without change: §2.3 ratings equal the profiles verbatim; heights/reach/shoulder
widths agree across §2.2, §3.4, §4.1, B28; §2.4 composites, §5.1 derived table, §5.3.3 `Pg` spot checks and the
§5.10 matchup sums (3.08 / 0.54) recompute exactly; classic and All-Star kit colours match [DEC]; every profile
signature move has a clip in §4.12 and every mannerism a face/celebration/idle entry (§4.11, [ANIM §8.3]); every
profile hair, beard, brow and accessory item is in §2.6–§2.8; all 44 review findings are dispositioned in §12.

1. §0.2 — unit definitions (binary KB/MB; base vs player metres).
2. §0.4 — conflict rows C31–C35 added for the overrides below; C19 amended.
3. §1.1 — owners for the v1 test files (`unit-humanoid` WP9, `unit-court` deleted → `unit-floorpaint` WP6, v1 unit and
   integ files assigned), closing the only file-ownership gaps.
4. §1.2 — `ai-tend.js` imports `SLOTS_V2`/`tend`/`spots` instead of mirroring them; `flow.js` grows to ≈ 380 lines (router +
   lineup 3D).
5. §1.4 — missing interfaces added: `new Game({...})`, `game.meter` (HUD meter source), `animator.renderSocket`,
   `Character.jumpY`, WP6/WP7/WP8 sink signatures, `settings`, `Loader`, `detectStatic`/`createQuality`; complete
   `game.on` event list.
6. §1.4.1 — binding event-routing table (game emits, `flow.js` routes to captions, audio, crowd, jumbotron/LED, net,
   director, replay); §1.4.2 — lineup screen ↔ flow interface (who moves characters and repaints kits).
7. §2.7 — LeBron headband base vs player metres reconciled with §3.7; Kyrie mouthguard defined as a rigid head-bone
   child (+1 draw call / +1 program on high only).
8. §3.3 — decode fallbacks for older Safari, scratch-canvas handling, `MessageChannel` time slicing ≤ 8 ms, mapping of
   the library's progress onto the global loader.
9. §3.4 — one body geometry per character with `setIndex` LOD/cover swaps (three.js morph textures are per geometry:
   avoids +2.4 MB and an upload hitch per LOD per player); cull sphere centred on the root, radius 0.85·h + 0.30 (C31).
10. §3.5.4a — paint cost measured (66 → 27.5 ms per 1024² skin in Node after optimisation); optimised painter rules are
    binding; Node regression guard ≤ 90 ms. §3.5.5 — low-tier sweat roughness no longer overwrites `skinRoughness`.
11. §3.8 / §3.10 — tucked jersey enclosed by the shorts (fixes the PoC slit; profiles say tucked) and `DoubleSide` kit
    with darkened back faces (covered body triangles made openings see-through); jersey v range 0.103 … 0.599; replay
    LOD per tier reconciled with §6.4.6; patch list and program count updated.
12. §4.13 — `AnimProxy` constructor and one closed-form socket definition shared with §5.4.
13. §6.4.3 — off-screen indicators disambiguate duplicate numbers (LeBron/Jordan #23 in custom lineups).
14. §6.6, §7.5, B35 — request budget ≤ 110 (103 counted; 77 statically imported modules).
15. §7.3 — mid-session cadence re-target from busy time (the remaining half of R#3: Low Power Mode toggled in play).
16. §7.4 — table of what is fixed at load vs switchable at runtime (texture sizes, material classes, morphs, crowd
    capacity, PMREM vs DPR, shadows, reflection, LOD, throttles), including how to resize/dispose the shadow map.
17. §7.6 (new) — feasibility against the PoC perf table, ordered device levers, payload/time-to-title estimate,
    per-device load-phase budgets (paint phase ≤ 1.05 / 0.65 / 0.50 / 1.25 s), GPU-paint fallback.
18. §8.3 — MPFB pinned to `d0a32e57a7f915cb2f2b95410e2117648c7bbb7e` with a committed cache manifest and a one-time
    re-fetch/recalibrate rule; bake refuses to run without meshoptimizer (except `--no-lod`, dev-only header);
    shells builder gets the tucked jersey.
19. §5.15 — `debug.forceCelebrate` hook (for B60).
20. §9.3 — B18 (R#21/R#36 reserved keys), B26 (robust torso-colour measurement + dark/bright luma gap), B31 (user
    controls team B), B56 (`DoubleSide`, constant texture memory across LOD changes); new B59 (title, legal note,
    README, asset provenance), B60 (signature expressions fire in play), B61 (meter projection R#4, duplicate-number
    indicators); WP9 acceptance now B1–B61.
21. §9.4 — `unit-core` fixtures for R1–R7 (R#15–R#18, R#24, R#39); WP6 unit cases for R#5, R#6 and the cadence rule;
    `unit-skinpaint` performance guard. §9.5 — load-phase budgets recorded per device.
22. §11.2 — six risks added (morph textures, paint blocking, iOS decode/canvas quirks, cloth see-through/slit, shader
    compile time, shoulder axial twist > 60°).
23. §12 — dispositions of R#3–R#6, R#15–R#18, R#21 now name their tests.

Open questions (not resolvable from the inputs; owners decide in phase C/D):
- The §7.6 device budgets are extrapolated from a Node VM benchmark with assumed device speed factors; phase D must
  confirm them on real devices (the GPU-paint fallback is pre-specified if they miss by > 25 %).
- Whether the existing `tools/legends/.cache` (fetched from `master` on 2026-10-10 17:00 UTC) equals the pinned SHA is
  unknown until WP1 re-fetches; if it differs, calibration is re-run before the first v2 bake.
- `legends.release` (contest maths) sits 0.13–0.57 m above the animated ball launch heights (Yao 3.45 m vs 2.88 m).
  GP intends it (Yao `highRelease`); balance band A will show whether Yao's jumper is under-contested.
- Kyrie's half-out mouthguard (a profile mannerism) only exists on high; on medium (iPhone 11 default) it is absent.
- All-Star UI accents (#D9A520 / #CE1141) differ slightly from the All-Star kit trims (#C9A227 / #D22630); left as two
  palettes (UI gold token vs fabric); unify if the art review prefers.
- The tucked-jersey rule changes a PoC-validated shell; it needs the viewer/showcase check named in §3.8 early in WP1.
