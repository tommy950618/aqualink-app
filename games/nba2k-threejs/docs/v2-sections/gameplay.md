# GAMEPLAY v2 — ratings, signature abilities, AI, lineup, balance, fixes (v2 section)

Scope: everything that decides *what happens* on the court in 传奇对决 3v3 / LEGENDS 3v3: the legends data file and
how every rating turns into a mechanic, the shot / contest / block / steal / pass / strength / rebound models, the
six legends' signature abilities and how a phone player triggers them with the four existing buttons and the
joystick, the AI (per-legend tendencies, defensive styles, the v1 AI fixes), difficulty and balance targets with the
seeded verification that the tests assert, the lineup / draft / kit flow, rule changes, a disposition for every v1
review finding, and the test hooks. Rendering, skinning, clips and kits are owned by the CHARACTERS and ANIMATION
sections; this section owns rules, numbers and decisions (and says so where it overrides a sibling's suggestion).

## Inputs and citation keys

| key | source |
|---|---|
| [PROF:id] | `phaseA.json → profiles[]` (`ratings`, `tendencies`, `signatureMoves`, `shootingForm`, `stats`) for kobe, jordan, lebron, giannis, yao, kyrie |
| [XCHK] | `phaseA.json → xcheck` (barefoot heights, wingspans matched, Jordan reach 2.67 → 2.65, rig reach 22–26 cm below listed reach) |
| [CFG] | `tools/legends/legends.config.json` → `players[].meta` (names zh/en, number, stats, calibration incl. `shoulderJoints`) and `appearance.kit` |
| [V1] | v1 `SPEC.md` §1–§8 and v1 code: `src/constants.js`, `shot.js`, `ai.js`, `game.js`, `player.js`, `ball.js`, `main.js` (window.__game), `test/acceptance.cjs` |
| [REV#n] | `review-r1-all.json` finding n (44 findings; verification status quoted per item in §14) |
| [ANIM] | sibling section `sections/animation.md` (D-ANIM-1…10, §4.2 dribble moves, §4.3 `selectMove`, §5.1 meter↔clip, §5.2 `FORMS` and `tIdeal` table, §5.5 layups, §5.6 dunks, §5.7 putbacks) |
| [CHR] | sibling section `sections/characters.md` (§7.5 classic kits, §7.8 All-Star A/B, D-CHR-2) |
| [DEC] | the orchestrator's DECISIONS list (real names, default teams and kits, All-Star rule, tiers, zh default) |
| [M] | numbers computed for this section with `scratchpad/nba2k-v2/gp/model.py` and `gp/derive.py` (the derived tables in §2, §3.9, §4, §5, §7 are their output) |

Decisions taken here are marked **D-GP-n**.

---

## 0. Key decisions (summary)

- **D-GP-1 One data file, one derivation module.** `src/legends.js` holds the six legends (names, number, kits,
  stats, ratings 0–99 copied verbatim from [PROF], tendencies, ability ids, AI spots). `src/ratings.js` turns them into
  physical attributes with closed-form formulas (§2) once at load; nothing else reads raw ratings except the make /
  contest / block / steal formulas, which all use the same normaliser `n(r) = clamp((r − 25)/74, 0, 1)`.
- **D-GP-2 Shot timing is in seconds and per player.** The meter of each shot uses ANIMATION's per-player `tIdeal`
  ([ANIM §5.2], `METER_T = tIdeal / 0.80`, green still drawn at 80 % of the bar). Timing error `eT` (s) replaces v1's
  fraction `e`; the green half-width is a time (`gS` = 40 / 33 / 27 ms × a rating factor 0.80–1.20). The v1 fraction
  `e` survives only as `eT / METER_T` for `debugShoot` and the meter flash.
- **D-GP-3 Make probability = rating curve × timing × contest × context.** `p = Pg(kind, d, rating) × T(eT) × C × F × M ×
  clutch × diffMul`, clamped to [0.02, 0.97] (dunk 0.995). `Pg` is the *green, open* probability from the shooter's
  zone rating; contest `C = 1 − CMAX × X` with a contest strength `X` built from distance, defender reach vs release
  height and defender rating (§3.6). This removes v1's 1.6× green multiplier and its "contest barely matters"
  behaviour ([REV#27], [REV#29]).
- **D-GP-4 Blocks are a probability, not a sphere hit** ([REV#28], [REV#39]). A block needs (a) a hand-socket-to-ball
  contact within 0.30 m during a short ascending window and (b) a single roll per defender per shot with rating,
  height and kind-dependent caps (0.30 jumper … 0.45 layup; LeBron's chase-down 0.55) and a CPU difficulty multiplier.
  CPU contest jumps are timed to the shooter's predicted release with Gaussian error, and only some contests are
  jumps. Target: blocks 3–8 % of FGA overall.
- **D-GP-5 Points are decided by the feet at release** (rules release = the release input, [ANIM §5.1.6]):
  `points = isThree(root at release) ? 3 : 2` for jump shots — the instruction for this section; it fixes the verified
  press-vs-release bug [REV#14]. **This overrides [ANIM §5.1.7]'s "root at takeoff" wording**; the meter shows a live
  "3" chip so the player sees the value change while drifting.
- **D-GP-6 Signature abilities are passive multipliers + context-triggered variants** (§8): no new buttons. The
  context resolver (§9) maps press timing, stick direction relative to the rim, sprint, distance and state (holding /
  dribbling / post) to the shot or move. New input gestures: *quick tap of SHOOT (< 0.12 s) = pump fake*, *double-tap
  CROSS = combo*, *walk into your defender near the paint = post-up*. All learnable from one on-screen tip each.
- **D-GP-7 AI = expected-points utility × legend tendencies**, with a patience window per legend, a 0.40 s catch gate
  before any shot, closeouts during the pass flight, rating-based sag, a "guard beaten" drive test, timed contest
  jumps, risk-based passing (interceptable), countdown timers that reset per game (§10). Every v1 AI finding is fixed
  with numbers.
- **D-GP-8 Difficulty only changes the opponent** (§11.1): CPU make multiplier 0.88 / 0.96 / 1.00, CPU timing σ
  75 / 55 / 38 ms, block multiplier 0.55 / 0.80 / 1.00, steal base 0.14 / 0.21 / 0.28, contest-jump probability,
  reaction, gaps; the user's CPU teammates always run the `normal` behaviour row. Bands per difficulty are asserted
  by seeded headless games and a scripted "average human" bot (§11).
- **D-GP-9 Lineup screen with swap-draft** (§12): default DARK (LeBron ★, Kyrie, Giannis) vs BRIGHT (Jordan ★, Kobe,
  Yao), user picks a side, taps two cards to swap, can shuffle or reset; any non-default lineup switches kits to
  All-Star A (white/gold) / B (black/red) unless "classic" is forced. ★ marks the user's check-ball handler.
- **D-GP-10 Rules kept from v1** with these changes (§13): points at release; shot clock resets only after rim / board /
  block contact; a deflected make keeps its value; no CPU steal in the first 0.8 s after CHECK; check-ball receiver
  rules; optional **FIBA 3x3 "clear the ball" rule (default OFF)** that turns defensive rebounds and steals into live
  transition (it is what makes chase-downs and breakaway dunks frequent); defensive auto-switch on catch (default ON).
- **D-GP-11 Test hooks** (§15): `window.__game.legends`, `.setLineup()`, `.metrics()`, `.abilityLog`, extended
  `.debugShoot({eT, kind, variant})`, `.debugContest()`, `.debugBlock()`, `.forceAbility()`, `.bot`, and a headless
  `test/balance.mjs` that runs seeded games in Node without WebGL.

---

## 1. Data model — `src/legends.js`

### 1.1 Schema (frozen plain objects; the only `src` file besides `i18n.js` allowed CJK text — player names)

```js
// src/legends.js
export const LEGEND_IDS = ['kobe', 'jordan', 'lebron', 'giannis', 'yao', 'kyrie'];
export const LEGENDS = { <id>: {
  id, name: { zh, en }, short: { zh, en },          // short = HUD / caption name
  number: '24',                                     // string, kept in every kit mode [DEC]
  era: '2008-10',
  hand: 'R',                                        // shooting hand (all six 'R' [PROF shootingForm])
  stats: { heightM, barefootM, weightKg, wingspanM, reachM },   // listed; reach per [XCHK]
  shoulderJoints,                                   // [CFG meta.calibration] metres, for the body radius
  ratings: { overall, speed, strength, vertical, ballHandle, closeShot, midRange, three, dunk, layup,
             passing, perimeterD, interiorD, block, steal, rebound },   // verbatim [PROF ratings]
  release: { jumper, fade, hook },                  // gameplay release heights (m) for contest maths (§3.6)
  abilities: [ ...ability ids (§8) ],
  traits: { chaseBlock: 0|1|2, canDunkTraffic: bool, noDribbleMoves: bool, threeGate: m|null, maxDribbles: n|null },
  tend: { ... },                                    // AI tendencies (§10.2), numbers in [0, 2]
  spots: { <slotId>: weight },                      // off-ball spot preferences (§10.4)
  kit: { classic: 'home'|'away' },                  // which [CFG] kit is the classic default [CHR §7.5]
} };
export const TEAMS_V2 = {
  dark:   { id: 'dark',   abbr: { zh: '暗', en: 'DRK' }, name: { zh: '暗夜队', en: 'Team Dark' },   roster: ['lebron', 'kyrie', 'giannis'] },
  bright: { id: 'bright', abbr: { zh: '亮', en: 'BRT' }, name: { zh: '烈阳队', en: 'Team Bright' }, roster: ['jordan', 'kobe', 'yao'] },
  allstarA: { id: 'allstarA', abbr: { zh: '白', en: 'WHT' }, name: { zh: '白队', en: 'Team White' } },
  allstarB: { id: 'allstarB', abbr: { zh: '黑', en: 'BLK' }, name: { zh: '黑队', en: 'Team Black' } },
};
export const DEFAULT_LINEUP = { a: ['lebron', 'kyrie', 'giannis'], b: ['jordan', 'kobe', 'yao'], user: 'a', kits: 'auto' };
```
Roster index 0 of a team = its ★ check-ball handler for the user's team (§12.3). The v1 `src/teams.js` is deleted;
`TEAMS` imports in `game.js`, `humanoid.js`, `hud.js` move to `legends.js`. The v1 acceptance denylist
(`test/acceptance.cjs` `DENYLIST`) drops `Jordan`, `Kobe`, `LeBron` (real names are now required [DEC]) and keeps
the 30 franchise names, `NBA`, `2K`, and adds the brand-like nicknames `Mamba`, `King James`, `Air Jordan`,
`Jumpman`, `Greek Freak`, `Uncle Drew` (zh: `黑曼巴`, `飞人`, `小皇帝`, `字母哥` is allowed because it is the common
Chinese short name, not a mark). Captions use neutral text only; the README carries the fan-project note [DEC].

### 1.2 The six entries (numbers binding)

Ratings are [PROF ratings] verbatim. Stats: listed height / weight / wingspan from [CFG meta.stats]; reach from
[XCHK] (Jordan 2.65). Release heights are the profile figures ([PROF shootingForm]; Kyrie 2.55 standing + 0.25 at
the top of his 0.30–0.40 m jump), used **only** for contest/block maths (the physical ball always launches from the
animated hand socket [ANIM D-ANIM-6]).

| field | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| name.zh | 科比·布莱恩特 | 迈克尔·乔丹 | 勒布朗·詹姆斯 | 扬尼斯·阿德托昆博 | 姚明 | 凯里·欧文 |
| name.en | Kobe Bryant | Michael Jordan | LeBron James | Giannis Antetokounmpo | Yao Ming | Kyrie Irving |
| short.zh / en | 科比 / Kobe | 乔丹 / Jordan | 詹姆斯 / LeBron | 字母哥 / Giannis | 姚明 / Yao | 欧文 / Kyrie |
| number | 24 | 23 | 23 | 34 | 11 | 2 |
| era | 2008-10 | 1991-98 | 2016-18 | 2019-21 | 2004-09 | 2014-17 |
| heightM / barefootM | 1.98 / 1.96 | 1.98 / 1.96 | 2.06 / 2.03 | 2.11 / 2.09 | 2.29 / 2.27 | 1.88 / 1.87 |
| weightKg | 96 | 98 | 113.4 | 110 | 141 | 88 |
| wingspanM | 2.11 | 2.11 | 2.14 | 2.21 | 2.26 | 1.93 |
| reachM | 2.64 | 2.65 | 2.69 | 2.81 | 2.95 | 2.515 |
| shoulderJoints | 0.455 | 0.46 | 0.505 | 0.485 | 0.49 | 0.425 |
| overall | 97 | 98 | 98 | 96 | 89 | 93 |
| speed / strength / vertical | 85 / 72 / 88 | 91 / 72 / 94 | 87 / 98 / 88 | 88 / 92 / 95 | 38 / 86 / 42 | 91 / 55 / 80 |
| ballHandle | 91 | 88 | 88 | 76 | 42 | 99 |
| closeShot / midRange / three | 92 / 98 / 84 | 95 / 99 / 76 | 93 / 82 / 77 | 93 / 66 / 58 | 95 / 80 / 30 | 90 / 93 / 90 |
| dunk / layup | 88 / 95 | 96 / 98 | 96 / 96 | 99 / 95 | 72 / 74 | 55 / 99 |
| passing | 82 | 82 | 97 | 79 | 66 | 84 |
| perimeterD / interiorD | 93 / 55 | 97 / 58 | 88 / 82 | 87 / 91 | 50 / 97 | 70 / 36 |
| block / steal / rebound | 50 / 86 / 60 | 63 / 96 / 66 | 74 / 78 / 87 | 88 / 74 / 94 | 96 / 42 / 90 | 35 / 72 / 45 |
| release.jumper / fade / hook (m) | 3.00 / 2.95 / — | 3.00 / 3.00 / — | 2.85 / 2.85 / — | 2.90 / 2.90 / 3.05 | 3.45 / 3.40 / 3.55 | 2.80 / 2.80 / — |
| abilities (§8) | `kobe.postFade`, `kobe.jab`, `kobe.tough`, `clutch` | `jordan.fade`, `jordan.air`, `jordan.ftDunk`, `jordan.hawk`, `clutch` | `lebron.powerDrive`, `lebron.chaseDown`, `lebron.skipPass`, `lebron.bully` | `giannis.euro`, `giannis.longDunk`, `giannis.helpBlock` | `yao.hook`, `yao.highRelease`, `yao.anchor`, `yao.post` | `kyrie.combo`, `kyrie.finisher`, `kyrie.stepback`, `clutch` |
| traits.chaseBlock | 1 | 1 | 2 | 1 | 0 | 0 |
| traits.canDunkTraffic | true | true | true | true | false | false |
| traits.noDribbleMoves / maxDribbles | false / null | false / null | false / null | false / null | true / 2 | false / null |
| traits.threeGate (min openness m to shoot a three, AI only) | null | null | null | 2.5 | ∞ (never, except shot clock < 1.5 s) | null |
| kit.classic [CHR §7.8] | home (gold) | away (red) | away (wine) | away (green) | away (red) | away (wine) |

`tend` and `spots` per legend are tabulated in §10.2 and §10.4 and stored verbatim in the same entries.

---

## 2. Ratings → physical attributes (`src/ratings.js`)

`export function derive(legend) → attrs` (pure, called once per player at load; result frozen on `player.attrs`).
Notation: `n(r) = clamp((r − 25)/74, 0, 1)`; `H` listed height, `W` weight, `ws` wingspan; `w̃ = clamp((W − 88)/53, 0, 1)`.

| attr | formula | replaces v1 |
|---|---|---|
| `run` (m/s, stick mag 1) | `4.40 + 1.10·n(speed)` | `MOVE.RUN 5.2 × speed rating` |
| `sprintMul` | `1.22 + 0.16·n(speed)` | `1.35` |
| `handlerMul` (holding/dribbling) | `0.88 + 0.08·n(ballHandle)` | `0.92` |
| `accel` (m/s²) | `18 + 10·n(speed) − 6·w̃ − 8·max(0, H − 1.98)` | `24` |
| `decel` (m/s²) | `0.70·accel + 2` | `16` |
| `turn` (rad/s) | `9 + 5·n(speed)` | `12` |
| `slideMul` (on-ball defender, move ⟂ facing > 45°) | `0.80 + 0.20·n(perimeterD)` | — |
| `hJump` (m, block / rebound / contest jump) | `0.45 + 0.40·n(vertical) − 0.10·clamp((W − 100)/40, 0, 1)` | `0.75` |
| `airtime` (s) | `2·sqrt(2·hJump/9.81)` (ballistic [ANIM D-ANIM-7]; Jordan ×1.118 on layups/dunks, §8) | `0.55` fixed |
| `catchR` (free ball, m) | `0.50 + 0.45·(ws − 1.90)` | `0.55 × height` |
| `catchTopY` (m, + jumpY) | `reachM − 0.15` | `2.30` |
| `passReceiveR` (intended receiver) | `catchR + 0.25` | `0.80` |
| `stealRange` (m) | `0.90 + 0.75·(ws − 1.93)` | `1.1` human / `1.0` CPU |
| `bodyR` (m) | `0.18 + 0.5·shoulderJoints` | `0.40` |
| `passSpeed` (chest, m/s) | `9.5 + 4.5·n(passing)` | `12` |
| `passRelease` (s, input → ball leaves hand) | `clamp(0.25 − 0.12·n(passing), 0.10, 0.27)` (ANIM uses it to time the release key) | 0 |
| `passSigma` (m, lateral aim error at the receiver, before pressure/distance) | `0.04 + 0.22·(1 − n(passing))` | 0 |
| `staminaDrain` (/s sprinting) | `0.25 · (1 + 0.25·clamp((W − 100)/40, 0, 1))` | `0.25` |
| `rebReact` (s, delay before moving to the landing point) | `0.30 − 0.20·n(rebound)` | difficulty reaction |

Derived values [M] (binding expected values for `test/unit-ratings.mjs`, tolerance ±0.01 of the shown precision):

| id | run | sprint | handler run | accel | decel | turn | slideMul | hJump | airtime | catchR | catchTopY | stealRange | bodyR | passSpeed | passRelease | passSigma |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kobe | 5.29 | 7.14 | 5.03 | 25.2 | 19.6 | 13.1 | 0.98 | 0.79 | 0.80 | 0.595 | 2.49 | 1.03 | 0.408 | 13.0 | 0.158 | 0.091 |
| jordan | 5.38 | 7.33 | 5.10 | 25.8 | 20.1 | 13.5 | 0.99 | 0.82 | 0.82 | 0.595 | 2.50 | 1.03 | 0.410 | 13.0 | 0.158 | 0.091 |
| lebron | 5.32 | 7.21 | 5.05 | 22.9 | 18.0 | 13.2 | 0.97 | 0.76 | 0.79 | 0.608 | 2.54 | 1.06 | 0.433 | 13.9 | 0.133 | 0.046 |
| giannis | 5.34 | 7.24 | 4.99 | 23.0 | 18.1 | 13.3 | 0.97 | 0.80 | 0.81 | 0.640 | 2.66 | 1.11 | 0.423 | 12.8 | 0.162 | 0.099 |
| yao | 4.59 | 5.73 | 4.13 | 11.3 | 9.9 | 9.9 | 0.87 | 0.44 | 0.60 | 0.662 | 2.80 | 1.15 | 0.425 | 12.0 | 0.184 | 0.138 |
| kyrie | 5.38 | 7.33 | 5.17 | 26.9 | 20.8 | 13.5 | 0.92 | 0.75 | 0.78 | 0.514 | 2.37 | 0.90 | 0.393 | 13.1 | 0.154 | 0.085 |

Kinematics otherwise as v1 §5.10: `desired = move × run × (sprint ? sprintMul : 1) × (hasBall ? handlerMul : 1)`,
`v += clamp(desired − v, (desired = 0 ? decel : accel)·dt)`, walk below stick mag 0.5. Stamina: refill `1/6` per s,
sprint locked at 0 until 0.25 (v1). AI court clamp unchanged (|x| ≤ 7.4, −14.1 ≤ z ≤ −0.3); the human handler is not
clamped (stepping out is OOB, v1).

Separation (replaces v1 `MOVE.SEPARATION 0.80`, [REV#43]): pair minimum distance `bodyR_a + bodyR_b` (0.79–0.87 m),
`+0.10` when either player is airborne, `≥ 0.95` against a dunker in the hang phase [ANIM §5.6]; a dunker or a
player in a scripted signature clip with root motion is immovable (the other takes the whole push).

---

## 3. Shooting model (`src/shot.js` v2)

### 3.1 Shot kinds, families and the rating zone

| kind (gameplay) | clips [ANIM] | rating zone | meter | jump |
|---|---|---|---|---|
| `jumper` (set / pull-up: `mid`, `pull12`, `pullHop`) | `makeJumper` | `close` if d ≤ 3.5 else `mid`; `three` if isThree at release | per-player `METER_T` | FORMS h |
| `fade` (face-up fadeaway) | `makeJumper(fade)` / `sig.*` | as jumper | per-player | FORMS h fade |
| `stepback` | `shot.stepbackJ` / `sig.kyrie.*` | as jumper | per-player | pull-up h |
| `turnFade` (post turnaround) | `sig.kobe.turnFade`, `sig.jordan.*`, generic `shot.turnFade` | as jumper | per-player | fade h |
| `hook` | `sig.yao.hook`, generic `shot.hook` (Giannis) | `close` | per-player | hook h |
| `floater` | `shot.floater` (Kyrie), `shot.floaterGeneric` | `close` | per-player | 0.9 × layup h |
| `layup` (std, fingerRoll, reverse, euro, power, switch, spin, upUnder) | `lay.*` | `layup` | layup `METER_T` | layup h |
| `dunk` (power2, tomahawk1, simple1, longGather, ftLine, dropStep, putback) | `dunk.*`, `put.dunk` | `dunk` | none (no timing) | dunk h |
| `tip` | `put.tip` | `close` | none (`T = 0.85` fixed) | tip h |

`d` = horizontal distance feet → rim centre. For the rating zone and `Pg` the distance is taken **at release**;
the kind (clip) is chosen **at press** (§9).

### 3.2 Meter and timing (D-GP-2)

- `tIdeal(player, kind, variant)` from [ANIM §5.2 / §5.5] (examples: Kobe mid 0.429 s, Kyrie mid 0.377, Giannis
  mid 0.466, Kyrie stepback 0.627, Yao std2 layup 0.567). `METER_T = tIdeal / 0.80`. Auto-release at `1.25·METER_T`.
- Release input time `tu` (DOM `releaseTs`, v1 semantics). `eT = (tu − tPress) − tIdeal` seconds. `e = eT / METER_T`
  (meter flash and backward-compatible `debugShoot({e})`).
- Green half-width (human shooter) `gS = G_DIFF × (0.80 + 0.40·n(zoneRating))`, `G_DIFF` = **0.040 / 0.033 / 0.027 s**
  (easy / normal / hard, = v1 0.07 / 0.06 / 0.05 × 0.55 s); layups `+0.022 s`; dunks and tips have no meter.
  CPU shooters use `G_DIFF(normal)` for `gS` (their difficulty lives in σ and the make multiplier).
  Examples (normal) [M]: Kobe mid 39.4 ms, Kyrie three 38.0, Giannis three 32.3, Yao three 27.3, Jordan layup 61.4.
- Timing factor `T(eT)`: `|eT| ≤ gS → 1.00`; `gS < |eT| ≤ 0.165 → lerp(0.80, 0.22, (|eT| − gS)/(0.165 − gS))`;
  `|eT| > 0.165 → 0.12`. Air ball: `eT ≤ −0.175 s` → forced miss with the air-ball target (§3.8).
- Meter display: bar fills over `METER_T`; green band `[0.80 − gS/METER_T, 0.80 + gS/METER_T]`; flash 完美/稍早/稍晚
  (v1 keys) for 0.6 s; a "3" chip (`meter.three`, 14 px, orange `#ff7a1f`) is shown on the right end of the bar while
  `isThree(feet)` is true during the windup (updates every frame) — D-GP-5.
- CPU release: `eT_cpu ~ N(0, σ_cpu)`, clamped to [−0.25, +0.22] s; σ_cpu = **0.075 / 0.055 / 0.038 s** (§11.1). The CPU
  holds the button for `tIdeal + eT_cpu` (v1 mechanism, `pressTs` / `releaseTs` in world ms).
- Expected timing factors (used by the AI's shot-value estimate, §10.3) [M]: CPU `T̄` = 0.73 / 0.81 / 0.89
  (easy / normal / hard at gS 33 ms). "Average human" (σ 0.050 s): green 62 / 53 / 45 %, `T̄` 0.87 / 0.85 / 0.82;
  "good human" (σ 0.030): green 86 / 78 / 68 %.

### 3.3 Green-open probability `Pg(kind, d, ratings)`

| zone | `Pg` |
|---|---|
| dunk | `0.93 + 0.06·n(dunk)` |
| layup | `0.78 + 0.18·n(layup)` |
| close (d ≤ 3.5 m, incl. hook, floater, tip, short jumpers / turnarounds) | `(0.66 + 0.28·n(closeShot)) × (1 − 0.03·max(0, d − 1.5))` |
| mid (2-pt, d > 3.5) | `(0.52 + 0.36·n(midRange)) × (1 − 0.025·(d − 3.5))` |
| three | `(0.40 + 0.42·n(three)) × (d ≤ 7.8 ? 1 : max(0.20, 1 − 0.12·(d − 7.8)))` |

Shot-type multipliers on `Pg` (generic unless an ability overrides, §8): fade 0.94, stepback 0.95, turnFade 0.95,
floater 0.92, hook (non-Yao) 0.90, tip 0.85, layup variants `reverse` 0.97 / `euro` 0.98 / `power` 1.00 / `fingerRoll` 1.00.

Sanity table [M] (`Pg`, green, open; binding for `test/unit-shot.mjs`, ±0.005):

| id | dunk d1.0 | layup d1.5 | close d2.5 | mid d5.0 | three d7.3 |
|---|---|---|---|---|---|
| kobe | 0.981 | 0.950 | 0.886 | 0.842 | 0.735 |
| jordan | 0.988 | 0.958 | 0.897 | 0.847 | 0.689 |
| lebron | 0.988 | 0.953 | 0.890 | 0.767 | 0.695 |
| giannis | 0.990 | 0.950 | 0.890 | 0.692 | 0.587 |
| yao | 0.968 | 0.899 | 0.897 | 0.758 | 0.428 |
| kyrie | 0.954 | 0.960 | 0.879 | 0.819 | 0.769 |

### 3.4 Full formula

```
p = clamp( Pg × typeMul × T(eT) × C × F × M × K × diffMul , 0.02 , kind === 'dunk' ? 0.995 : 0.97 )
F (fatigue)   = stamina < 0.30 ? 0.92 : 1
M (movement)  = jumper/three/set/pull-up only: v = root speed at takeoff [ANIM §5.1.9];
                v > 2.5 ? max(0.80, 1 − 0.07·(v − 2.5)) : 1   (fade/stepback/turnFade: v = component toward the rim only)
K (clutch)    = has 'clutch' && quarter ≥ 4 && gameClock ≤ 24 && |scoreDiff| ≤ 3 ? 1.05 : 1
diffMul       = CPU shooter vs the human team: cpuMakeMul (0.88/0.96/1.00); human shooter: userMakeMul (1.06/1.00/0.97);
                auto (CPU-vs-CPU) games: 1.00 for both teams
```
Roll once at release (`rng.next() < p`), v1. `debugShoot({p})` overrides `p` (v1).

Expected open-shot make rates [M] (normal; H = average human σ 50 ms; C = CPU easy / normal / hard incl. cpuMakeMul):

| id | layup 1.5 m | close 2.5 m | mid 5 m | three 7.3 m |
|---|---|---|---|---|
| kobe | H 0.88, C 0.70/0.83/0.91 | H 0.76, C 0.60/0.71/0.78 | H 0.72, C 0.58/0.68/0.74 | H 0.62, C 0.50/0.58/0.64 |
| jordan | H 0.89, C 0.71/0.83/0.92 | H 0.77, C 0.61/0.72/0.79 | H 0.73, C 0.58/0.68/0.75 | H 0.58, C 0.46/0.54/0.60 |
| lebron | H 0.88, C 0.71/0.83/0.91 | H 0.76, C 0.61/0.71/0.78 | H 0.65, C 0.52/0.61/0.67 | H 0.59, C 0.47/0.55/0.60 |
| giannis | H 0.88, C 0.70/0.83/0.91 | H 0.76, C 0.61/0.71/0.78 | H 0.58, C 0.46/0.54/0.60 | H 0.49, C 0.39/0.45/0.50 |
| yao | H 0.82, C 0.66/0.77/0.85 | H 0.77, C 0.61/0.72/0.79 | H 0.64, C 0.51/0.60/0.66 | H 0.35, C 0.27/0.32/0.36 |
| kyrie | H 0.89, C 0.71/0.84/0.92 | H 0.75, C 0.60/0.70/0.77 | H 0.70, C 0.56/0.65/0.72 | H 0.65, C 0.52/0.61/0.68 |

Open looks are generous on purpose (arcade feel, legends); the AI and closeouts make most real looks contested
(contested values in §3.9), and the FG% bands of §11 are asserted on real games.

### 3.5 Points (D-GP-5)

- Jump shots (`jumper`, `fade`, `stepback`, `turnFade`, `hook`, `floater`): `points = isThree(feet at release) ? 3 : 2`.
  Feet = player root (x, z) at the step that processes the release input.
- `layup`, `dunk`, `tip`: 2.
- `ball.shotInfo.points` is written at release; `onScore` uses `shotInfo.points` whenever the scorer credited is the
  shooter of the pending shot, **including deflected/blocked shots that still drop** ([REV#18]); a different
  offensive player tipping it in scores 2 (`tip`, own FGA, v1).
- Shot clock and buzzer: a shot is valid if the release input happened with clock > 0 ([REV#16] fix, §13).

### 3.6 Contest strength `X` and factor `C`

For each opponent `i` of the shooter that is not `stunned` / `fallen`, at the release step:

```
dd_i    = horizontal distance shooter → i
front_i = dot(dir(shooter→i), dir(shooter→rim)) ≥ 0.20  ||  dd_i ≤ 0.90         (side contests count up close)
Rc      = 2.2 m  (Yao 'anchor' 3.0 for close/layup/dunk shots, Giannis 'helpBlock' 2.6 when he is the help defender)
Kd      = clamp((Rc − dd_i)/(Rc − 0.6), 0, 1)
handY   = reachM_i + (i airborne ? jumpY_i(t) : −0.05)                         (hands up: v2 auto hands-up, §9.3)
relY    = release height of the shot: jumper/fade/hook from legends.release; layup = reachM_sh + 0.15 + jumpY_sh(t);
          dunk = 3.23; floater = reachM_sh + 0.10 + jumpY_sh(t); tip = reachM_sh + jumpY_sh(t)
Kh      = clamp(0.65 + (handY − relY)/1.2, 0.40, 1.00)
Ks      = 0.70 + 0.40·n(zone ∈ {mid, three} ? perimeterD_i : interiorD_i)
X_i     = front_i ? Kd·Kh·Ks : 0
Xraw    = max_i X_i + 0.35 · second-largest X_i + deter     (deter = 0.15 if Yao 'anchor' applies to this shot, §8.5)
X       = clamp(Xraw × max(0.35, A) × (green ? 0.65 : 1), 0, 1)       A = product of the shooter's ability/shot-type contest multipliers
C       = 1 − CMAX[zone]·X        CMAX: three 0.55, mid 0.55, close 0.60, layup 0.50, dunk 0.12
contact = layup/close/dunk with a defender within 0.80 m in front at takeoff:
          C ×= clamp(0.88 + 0.004·(strength_sh − strength_def), 0.75, 1.00)
```
Generic shot-type contest multipliers in `A`: fade 0.85, stepback 0.80, turnFade 0.80, hook (non-Yao) 0.85,
floater 0.75, layup `reverse` 0.80, `euro` (vs the dodged defender: excluded entirely), others 1.0. `contestFactor`
returns `{C, X, defender, parts:{Kd,Kh,Ks}}` for tests (`__game.debugContest`).

v1 `C *= 0.8 if jumping` and the `defense` distance scaling are removed (subsumed by `Kh` and `Ks`).

### 3.7 Contest examples [M] (average human, normal; open value in §3.4)

| shooter | vs LeBron 1.2 m hands-up (layup / mid / three) | vs LeBron 0.9 m jumping 0.6 m | vs Yao on a layup: 1.0 m hands-up / 0.8 m jumping 0.4 | vs Kyrie 0.9 m jumping, mid 5 m |
|---|---|---|---|---|
| kobe | 0.81 / 0.65 / 0.56 | 0.65 / 0.49 / 0.42 | 0.74 / 0.60 | 0.53 |
| jordan | 0.82 / 0.66 / 0.52 | 0.66 / 0.50 / 0.39 | 0.74 / 0.61 | 0.54 |
| lebron | 0.79 / 0.56 / 0.51 | 0.63 / 0.41 / 0.37 | 0.71 / 0.59 | 0.45 |
| giannis | 0.79 / 0.51 / 0.43 | 0.63 / 0.37 / 0.31 | 0.71 / 0.58 | 0.41 |
| yao | 0.77 / 0.59 / 0.32 | 0.70 / 0.52 / 0.28 | 0.75 / 0.66 | 0.55 |
| kyrie | 0.79 / 0.60 / 0.56 | 0.63 / 0.45 / 0.42 | 0.70 / 0.59 | 0.48 |

(Ability multipliers and Yao's `anchor` range/deterrence not applied in this table; blocks are separate, §4.)

### 3.8 Miss targets (fixes [REV#30], [REV#32]) and rim physics ([REV#31])

`chooseTarget` v1 §4.4 with:
- Green miss (`|eT| ≤ gS`, make rolled false): short or long with `rng.next() < 0.5` (was always long).
- Air ball (`eT ≤ −0.175 s`): forced miss; target `along = −(0.50 + 0.30·rng)` m from the rim centre, **`y = RIM.y − 0.55`**
  so the ball drops in front of the rim; acceptance: ≥ 80 % of 300 air balls from 2.5 / 5 / 7.3 m come to rest inside
  the court (|x| ≤ 7.62, −14.325 ≤ z ≤ 0) and 0 % touch the rim.
- Rim: `REST_RIM 0.55 → 0.40`, tangential factor `0.92 → 0.80`; board `REST_BOARD 0.60 → 0.50`. Acceptance over 300
  free-sim misses each from 2.5 / 5 / 7.3 m (e = 0, +0.15 fraction): median rest-free first-bounce distance from the
  rim 1.5–3.5 m, ≥ 75 % come to rest inside the court, and the ball's first floor contact is within 4.5 m of the rim
  centre for ≥ 70 %.

### 3.9 Contested reality check (expected)

With the AI's closeouts the typical CPU-normal jumper is released with a defender at 0.9–1.5 m; expected make 0.45–0.60
for mid-range legends, 0.35–0.50 for threes. Team FG% bands are in §11.2.

---

## 4. Block model (`tryBlocks` v2, D-GP-4)

### 4.1 Eligibility (evaluated every fixed step while the ball is a fresh shot)

```
ball.state === 'flight' && shot.kind ∉ {dunk, tip}                     (dunks: §4.4)
releaseAge ≤ W[kind] : jumper/fade/stepback/turnFade/three 0.22 s, hook/floater/close 0.26 s, layup 0.30 s
ball.vel.y > 0                                                         (ascending only: no goaltending)
defender: isJumping, not stunned/fallen, not yet rolled for this shot
hand: the defender's hand socket nearer to the ball [ANIM §1.6] (headless fallback: root + facing·0.30 +
      (0, reachM − 0.24 + jumpY, 0)) within rHand of the ball centre;  rHand = 0.30 m (LeBron chase-down 0.36,
      Yao anchor / Giannis help 0.34)
position: not behind the shooter — dot(dir(shooter→def), dir(shooter→rim)) ≥ −0.20 — unless traits.chaseBlock ≥ 1
      and the shot is a layup/dunk (chase-down, §8.3)
```

### 4.2 Roll (once per defender per shot, on the first eligible step)

```
B0   : jumper/three/fade/stepback/turnFade 0.30, hook 0.35 (×0.5 vs Yao 'hook', §8.5), floater/close 0.35, layup 0.40
blkF = 0.35 + 0.85·n(block)
hAdv = clamp(1 + 0.625·(H_def − H_sh), 0.60, 1.35)
pB   = min(CAP[kind], B0 × blkF × hAdv × abilityMul) × (CPU blocker ? cpuBlockMul : userBlockMul)
CAP  : jumper family 0.30, close/hook/floater 0.40, layup 0.45, dunk 0.30, chase-down 0.55
abilityMul: shooter-side (Kyrie finisher 0.55, Jordan air-switch 0.40, Yao highRelease 0.60 vs H_def < 2.05,
            Giannis longDunk 0.60) × defender-side (Yao anchor 1.20 within 2.0 m of the rim, Giannis help 1.25,
            LeBron chase-down B0 = 0.50)
cpuBlockMul  = 0.55 / 0.80 / 1.00 ; userBlockMul = 1.15 / 1.00 / 0.90   (easy / normal / hard)
```
Success: ball → `loose`, `v = (−0.30·vx + rng.range(−0.8, 0.8)·side, 2.0 + 1.5·rng, −0.30·vz)`; chase-down pin
(`lebron.chaseDown` success with the ball within 1.2 m of the board): `v = (0.2·side·rng, 1.0, −3.5)` so it hits the
board and drops (event `pin`); `lastToucher = blocker`, `shot.touched = true`, `blk++`, caption `cap.block`
(`cap.chaseDown` for the pin), audio `block()`. Failure: nothing (the contest at release already priced the jump).

### 4.3 Block probability table [M] (geometric contact assumed; human blocker on normal; jumper / close / layup / dunk)

| blocker \ shooter | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| kobe | — | .19/.22/.25/.14 | .18/.21/.24/.13 | .18/.20/.23/.13 | .15/.18/.21/.11 | .20/.24/.27/.15 |
| jordan | .24/.28/.31/.17 | — | .22/.26/.30/.16 | .22/.25/.29/.16 | .19/.22/.25/.14 | .25/.29/.33/.18 |
| lebron | .29/.34/.38/.21 | .29/.34/.38/.21 | — | .27/.31/.35/.19 | .23/.27/.31/.17 | .30/.36/.41/.22 |
| giannis | .30/.40/.45/.26 | .30/.40/.45/.26 | .30/.39/.44/.24 | — | .29/.33/.38/.21 | .30/.40/.45/.27 |
| yao | .30/.40/.45/.30 | .30/.40/.45/.30 | .30/.40/.45/.29 | .30/.40/.45/.29 | — | .30/.40/.45/.30 |
| kyrie | .13/.15/.17/.10 | .13/.15/.17/.10 | .12/.14/.17/.09 | .12/.14/.16/.09 | .10/.12/.14/.08 | — |

(Before ability multipliers; a CPU blocker multiplies by 0.55 / 0.80 / 1.00.)

### 4.4 Dunk stuffs

During a dunk's rising phase up to `slam − 0.05 s`, a defender airborne in front (dot ≥ 0.2) whose hand socket comes
within 0.30 m of the ball rolls `pB` with `B0 = 0.22`, cap 0.30. Success: the dunk aborts (`dunk` clip cancels into
`land` [ANIM]), ball loose with `v = (−0.2·fwd, 2.5, ·)`, `blk++`, caption `cap.block`. Dunks are never "missed" otherwise
(`p ≤ 0.995` roll at slam: a fail = `rimOut`, ball pops out `v = (0.6·fwd, 3.0, ·)`, caption `cap.rimOut`).

### 4.5 Rates the model must produce (asserted in §11)

Blocks per FGA: 3–8 % per team in seeded CPU-vs-CPU normal games (≤ 12 % for a team defending with Yao), easy ≤ 5 %,
hard ≤ 10 %. Scripted "first-timer drive" (§11.4): blocked ≤ 25 % on normal, ≤ 12 % on easy (v1: 100 %, [REV#39]).

---

## 5. Steals, passes, interceptions

### 5.1 On-ball poke (tertiary on defence; CPU via the same intent)

```
eligible: handler dribbling (ball.state 'dribble'), not inside a dribble move's immunity window [ANIM §4.2 'imm'],
          not airborne / in windup / layup / dunk / post-shot; dist(def, handler) ≤ stealRange_def (Jordan +0.15)
pPoke = clamp(S0 × stealF × handleF × side × exposed × protect × behind, 0.03, 0.45)
S0      = human 0.30 ; CPU 0.14 / 0.21 / 0.28 (easy / normal / hard)
stealF  = 0.45 + 0.75·n(steal)   (Jordan 'hawk' ×1.15)
handleF = 1.35 − 0.75·n(ballHandle)
side    = ball on the dribble hand nearer to the defender ? 1.15 : 0.55      (handSign vs defender side)
exposed = ball in the free part of the dribble cycle with y < 0.45 m ? 1.25 : 1   (v1 low window)
protect = handler in dribble mode 'protect' [ANIM §4.1] ? 0.60 : 1
behind  = defender behind the handler (dot < −0.2) ? 0.80 : 1
```
The swipe resolves at the `swipe` event 0.12 s after the input [ANIM D-ANIM-7] (eligibility re-checked then).
Success: ball loose toward the defender (v1: 2.0 m/s + 1.5 up, 0.3 s victim exclusion); **STL is credited to the
defender who catches it** ([REV#23]); an offensive recovery credits nothing. Failure: stealer `stunned` 0.30 s; a
second failure within 3.0 s stuns 0.55 s. Cooldown 0.8 s (human), CPU attempt interval 2.4 / 1.6 / 1.1 s and never in
the first 0.8 s of LIVE or within 0.5 s after the handler's catch ([REV#39] strip at 0.4 s).

Per-attempt values [M] (human S0 / CPU-normal S0; side, exposed, protect, behind = 1):

| def \ handler | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| kobe | — | .23/.16 | .23/.16 | .27/.19 | .38/.26 | .19/.13 |
| jordan | .24/.17 | — | .25/.17 | .29/.20 | .41/.29 | .21/.15 |
| lebron | .20/.14 | .21/.15 | — | .25/.17 | .35/.24 | .18/.12 |
| giannis | .19/.14 | .20/.14 | .20/.14 | — | .33/.23 | .17/.12 |
| yao | .13/.09 | .13/.09 | .13/.09 | .16/.11 | — | .11/.08 |
| kyrie | .19/.13 | .20/.14 | .20/.14 | .23/.16 | .33/.23 | — |

(Jordan's row before `hawk`; with it ×1.15.)

### 5.2 Passes

- Chest pass: speed `passSpeed` (§2), flight time `max(dist/passSpeed, 0.25)`, released `passRelease` after the
  input; lob (hold ≥ 0.30 s, v1) apex 1.8 m.
- Range: 9.5 m for everyone; LeBron `skipPass` 14 m (§8.3). A human-aimed pass beyond range is allowed but flies at
  10 m/s with σ ×1.6.
- Aim error: lateral offset at the receiver `~ N(0, σ)`, `σ = passSigma × pressure × distF × cpuPassMul`;
  `pressure = 1 + 0.6·[a defender within 1.0 m of the passer]`, `distF = 0.6 + 0.05·dist`, `cpuPassMul` 1.4 / 1.0 / 0.8
  for CPU passers (1.0 human); jump passes (passer airborne) ×1.5 except LeBron.
- Catch by the intended receiver: within `passReceiveR` and `0.15 ≤ y ≤ catchTopY + jumpY`; else the ball continues
  (loose on the floor = a live ball; a defender catching it counts as STL, [REV#24]).

### 5.3 Interceptions ([REV#34])

While a pass is in flight, every defender `i` with the ball centre within `intR_i = catchR_i + 0.05` (Jordan `hawk`
+0.20; a human who taps STEAL during the pass gets +0.20 for 0.40 s and lunges 1.0 m toward the closest point of the
pass line in 0.25 s) and `0.30 ≤ ball.y ≤ catchTopY_i + jumpY` rolls once per pass:
`pInt = clamp(0.35 + 0.45·n(steal) − 0.15·(dist/intR), 0.15, 0.85)` → catch (STL, DEAD(TURNOVER) or the clear rule);
else with probability 0.5 → deflection (ball `loose`, `v ×= 0.35`, random lateral 1.5 m/s, `lastToucher = i`); else
the ball passes. Lobs above `catchTopY + jumpY` cannot be touched. Targets: CPU passes intercepted or deflected
2–6 % (normal) in seeded games; a defender standing 0.3 m off the line intercepts ≥ 30 % of 30 chest passes (A15 v2).

---

## 6. Strength, post play, rebounds

### 6.1 Drive contact ("bump")

When a ball handler moving ≥ 3.0 m/s comes within the separation distance of a defender whose position is within
±45° of the handler's velocity, at most once per 0.6 s:
```
strDiff = strength_off − strength_def ; massF = W_off / W_def
keep    = clamp(0.55 + 0.006·strDiff + 0.25·(massF − 1), 0.25, 0.95)   handler speed ×= keep
push    = clamp(0.10 + 0.008·strDiff, 0, 0.45) m, defender displaced along the drive over 0.15 s
bumped  = strDiff ≥ 20 && handler speed ≥ 4.0 → defender stunned 0.30 s       (LeBron powerDrive: strDiff ≥ 10, push ×1.5, keep ≥ 0.80)
```
Event `bump` (ANIM plays `hit.bump` reactions); caption none.

### 6.2 Post-up (backdown)

Entry (human detector and AI request `intent.post = true`, §9.1): d ≤ 5.0 m (Yao 5.5), holding or dribbling, a
defender within 1.2 m between handler and rim (dot ≥ 0.5), stick toward the rim (dot ≥ 0.5) with magnitude
0.15–0.75 and no sprint, held for 0.35 s → state `post` (dribble mode `backdown`, facing away from the rim).
Each shove (every 0.30 s while the stick points at the rim, [ANIM move.backdown]):
`gain = clamp(0.12 + 0.006·strDiff + 0.15·(massF − 1), 0.02, 0.35)` m toward the rim for both players (LeBron `bully`
×1.3 vs a defender ≥ 0.05 m shorter or ≥ 15 strength weaker). Examples: Yao vs Kyrie 0.35 (cap), LeBron vs Kyrie 0.35,
Kobe vs Jordan 0.11, Yao vs LeBron 0.08, Kyrie vs Yao 0.02.
Exit: stick away from the rim ≥ 0.6 for 0.20 s → `post.faceUp` (0.35 s) into triple threat; sprint press → drive;
3.5 s in post without an action → AI forced decision / human keeps control (no 3-second rule).

### 6.3 Rebounds

- Rebound reaction: CPU players start toward the landing point `rebReact` s after the release (§2), human immediately.
- Crash / box-out from tendencies (§10.2). A defender within 2.0 m of his man when the shot goes up and with
  `tend.boxOut` roll success turns and boxes for 0.4 s (holds his spot; separation pushes favour him by
  `0.3 + 0.004·strDiff`).
- Catch test v1 §5.8 with `catchR`, `catchTopY + jumpY`. When ≥ 2 players qualify in the same step, the winner is the
  highest `s = (1 − d/catchR) + 0.6·n(rebound) + boxBonus + 0.15·(H − 2.0)/0.3 + rng.range(0, 0.20)`,
  `boxBonus = 0.3 + 0.004·strDiff` for a player between the opponent and the ball.
- `put.tip` / `put.dunk` ([ANIM §5.7]): an offensive player airborne within 1.2 m of the rim whose hand reaches a free
  ball with `vy < 0` taps it at the rim: `tip` shot (close zone, T 0.85, X from defenders); LeBron / Giannis / Yao catch
  and dunk (`put.dunk`) when the catch is ≥ 3.15 m reach and within 1.0 m of the rim.
- Offensive rebound resets the shot clock only if the shot touched rim/board or was blocked ([REV#15], §13).

---

## 7. Dribble moves, shakes, ankle-breakers, jab and pump fake

### 7.1 Move selection

The tertiary tap on offence calls [ANIM §4.3] `selectMove` (stick relative to facing; holding → jab / pump fake;
Yao → drop step / pump fake). Gameplay values per move:

| move | immunity (steal) | shake `moveMul` | ankle eligible | cooldown after (s) |
|---|---|---|---|---|
| `move.cross` | [0.05, 0.30] | 1.0 | yes | 0.9 |
| `sig.kyrie.hesiCross` | [0.05, 0.40] | 1.2 | yes | 0.9 |
| `move.btl` | [0.05, 0.28] | 0.8 | no | 0.7 |
| `move.btb` | [0.06, 0.30] | 0.9 | no | 0.8 |
| `move.spin` | [0.08, 0.40] | 1.0 | no | 1.0 |
| `move.hesi` | — | 0.9 | no | 0.8 |
| `move.stepback` | [0.08, 0.36] | 0.7 (creates 0.75 m space) | no | 0.9 |
| `sig.kyrie.doubleBtlStepback` | [0.05, 0.60] | 1.1 | yes | 1.0 |

### 7.2 Shake and ankle-breaker (replaces v1 crossover freeze 0.55 / crossFreeze)

Resolved at the move's `plant` event against the on-ball defender within 1.3 m in front (dot ≥ 0.3), once per move:
```
handleAdv = clamp(1 + (ballHandle_h − perimeterD_d)/50, 0.4, 1.6)
commit    = 1.5 if the defender moves ≥ 2.0 m/s toward the side the ball comes from, or is within 0.4 s after a failed
            steal / a bite on a fake; else 1.0
diffMul   = human handler vs CPU defender: 1.15 / 1.00 / 0.85 ; CPU handler vs human defender (cpuShakeMul): 0.60 / 0.85 / 1.00 ;
            CPU vs CPU: 1.00
comboMul  = 1 (first move) ; chained 2nd: Kyrie 2.0 / others 1.5 ; 3rd (Kyrie only): 3.0
pAnkle    = ankle-eligible moves only: clamp(AB0 × handleAdv × commit × comboMul × diffMul, 0, 0.35),
            AB0 = Kyrie 0.06, everyone else 0.03 ; max 1 ankle-break per possession, each defender once per possession
pShake    = clamp(0.22 × moveMul × handleAdv × commit × diffMul, 0.04, 0.60)
roll ankle first, then shake
```
Ankle-break: defender state `fallen` 1.60 s (fall 0.50, ground 0.80, get-up 0.30 [ANIM `hit.ankle`]): no movement, jump,
steal, contest (`X_i = 0`) or block; handler gets `+0.10 s` of steal immunity; caption `cap.ankle`, crowd 0.9, camera
shake 0.15 s amplitude 0.04 m. Shake: defender `stunned` 0.40 s (v1 freeze time) and slides 0.30 m toward his
commitment direction.
Values [M] (single cross uncommitted pShake / committed 2nd-combo pAnkle, diffMul 1): Kyrie vs Yao 0.35 / 0.29,
Kyrie vs Jordan 0.23 / 0.19, Kobe vs Yao 0.35 / 0.11, Jordan vs Kobe 0.20 / 0.06, Giannis vs Jordan 0.13 / 0.04,
Yao (no moves) —.

### 7.3 Combos (double-tap CROSS)

A second tertiary tap within 0.35 s of the previous one (or while a move is playing) queues the next move; queued
moves start at the current move's `cancel` time with no cooldown between them; cooldown applies after the last.
Chain length: Kyrie up to 3 (`kyrie.combo`), everyone else 2; Yao none. The second / third move is chosen by
[ANIM §4.3] with the stick at the moment of the queued tap; if the stick is neutral the chain alternates direction
(cross → btl → cross_L). `comboMul` per §7.2.

### 7.4 Jab and pump fake (defender bite)

- Jab (`move.jab`, holding, tertiary): the on-ball defender within 1.6 m bites with
  `pBite = biteBase × (1.15 − 0.50·n(perimeterD))` (Kobe `jab` ×1.3), `biteBase` = 0.55 / 0.40 / 0.25 for CPU
  defenders; a human defender bites only through his own input. Bite outcome (rng): 55 % **sag** (defender steps back
  0.5 m; the shooter's next shot within 0.8 s gets `A ×= 0.5`), 45 % **lunge** (defender `stunned` 0.35 s; drive lane
  opens). Max 2 jabs per hold.
- Pump fake: primary pressed and released within **0.12 s** while the resolved kind is a jump shot (not layup /
  dunk) **and** before the clip's `takeoff` → the shot is cancelled into `move.pumpFake` (0.40 s, [ANIM]); CPU defenders
  within 1.6 m who already committed to a contest jump (§10.6) keep it with `pBite` (above); a CPU defender who bites
  is airborne for its `airtime` and cannot contest the real shot. A second primary press within 0.6 s after a pump
  fake while in the paint = up-and-under (`lay.upUnder`, Yao signature; generic for everyone at `Pg × 0.95`).

---

## 8. Signature abilities (`src/abilities.js`)

Each ability is a frozen descriptor `{ id, legend, kind: 'passive'|'trigger', hooks: [...], params: {...} }`; the
gameplay code queries `abilities.mul(player, hook, ctx)` / `abilities.trigger(player, hook, ctx)` at fixed hook points
(`shotKind`, `pg`, `contestA`, `blockShooter`, `blockDefender`, `steal`, `pass`, `move`, `drive`, `post`, `airtime`,
`clutch`). Every trigger and every passive that changes an outcome appends `{t, id, player, ctx}` to `game.abilityLog`
(ring of 256) and emits `ability(id, player)`; the HUD shows the caption key `cap.ab.<id>` (0.9 s, §16) for triggered
ones only. Clip ids in brackets are [ANIM §9] names; if ANIMATION renames a clip, the gameplay id stays.

Shared: **`clutch`** (Kobe, Jordan, Kyrie): `K = 1.05` (§3.4) and `A ×= 0.90` when quarter ≥ 4, gameClock ≤ 24 s and
|score diff| ≤ 3. AI usage ×1.5 for the owner in that window (§10.3).

### 8.1 Michael Jordan

| id | type | trigger (human input / AI) | effect (numbers) | clip |
|---|---|---|---|---|
| `jordan.fade` | passive on `fade`, `turnFade` | stick away from the rim at the press (holding, or in post) | contest `A ×= 0.65` (generic fade 0.85); `Pg` type multiplier 1.00 (generic 0.94); fade drift 0.55 m, leg kick | `sig.jordan.turnFade`, `makeJumper(fade)` |
| `jordan.air` | passive on layups and dunks | any layup/dunk | gravity scale 0.80 for his jump → airtime ×1.118 (hJump 0.82: 0.92 s); finish distance up to 2.8 m when speed ≥ 3.0; **mid-air switch**: if during the ascent a block-eligible defender's hand comes within 0.70 m of the ball, auto-switch hands (`lay.switch`, p 0.75 per layup) → block `abilityMul 0.40`, `A ×= 0.70` | `lay.switch`, `dunk.tomahawk1` |
| `jordan.ftDunk` | trigger | **Human**: sprinting (speed ≥ 6.0 m/s, velocity within 25° of the rim direction), press SHOOT at d ∈ [4.2, 4.7] m with no opponent within 2.5 m of the segment to the rim and none closer to the rim inside a 60° cone, stamina ≥ 0.30. **AI**: same conditions, chosen with p 0.25 per eligible approach. Max 2 per game. | dunk from the free-throw line: h 0.95 m, gravity scale 0.72 (airtime ≈ 1.03 s), make 0.97 (no timing), cannot be blocked from behind; caption `cap.ab.jordan.ftDunk`, crowd 1.0 | `dunk.ftLine` |
| `jordan.hawk` | passive (defence) | poke / intercept | `stealF ×1.15`, `stealRange +0.15 m`, interception radius +0.20 m; AI gamble tendency 1.30 | — |
| `clutch` | passive | — | see above | — |

### 8.2 Kobe Bryant

| id | type | trigger | effect | clip |
|---|---|---|---|---|
| `kobe.postFade` | trigger | in `post` (§6.2) + SHOOT with stick neutral / away (shoulder chosen by the stick's lateral sign, default toward the baseline) | turnaround fadeaway: drift 0.45 m, `A ×= 0.55`, `Pg` type multiplier 1.00 (generic turnFade 0.95), rating zone by d at release | `sig.kobe.turnFade` (1.4 s, release ≈ 0.83 s) |
| `kobe.jab` | trigger | holding (triple threat) + CROSS tap (stick neutral / toward the defender) | jab bite ×1.3 (§7.4); a shot within 0.8 s after a jab is a jab pull-up with `A ×= 0.70` (stacks with a bite's 0.5); up to 2 jabs then rip-through drive (stick toward the rim + SPRINT) | `sig.kobe.jabSeries` |
| `kobe.tough` | passive | mid-range and close jump shots (incl. fade / turnFade / stepback) | `A ×= 0.70` (A floor 0.35 still applies: Kobe post fade = 0.55 × 0.70 = 0.385) | — |
| `clutch` | passive | — | above | — |
| (variant) | trigger | moving > 3.5 m/s + CROSS toward the off hand | `sig.kobe.hesiCrossStepback` (cross part; `moveMul 1.2`), SHOOT during it → stepback | ANIM |

### 8.3 LeBron James

| id | type | trigger | effect | clip |
|---|---|---|---|---|
| `lebron.powerDrive` | passive | drive contact (§6.1) at speed ≥ 4.0 | bump threshold strDiff ≥ 10 (generic 20), push ×1.5, his `keep ≥ 0.80`; a layup/dunk started within 0.8 s after a won bump gets `A ×= 0.60` and the strength contact factor is skipped | `hit.bump`, `lay.power`, `dunk.power2` |
| `lebron.chaseDown` | trigger (defence) | an opponent starts a layup/dunk while LeBron is behind him (dot < −0.2) within 4.0 m; **Human**: SHOOT/BLOCK tap; **AI**: auto-jump when the predicted hand-ball distance at his apex ≤ 0.50 m | while chasing: +8 % run/sprint for up to 2.0 s (stamina > 0.2); from-behind eligibility, `rHand 0.36`, window to releaseAge 0.40 s (dunks: to `slam − 0.05`), `B0 0.50`, cap 0.55; success pins the ball to the board (§4.2); caption `cap.chaseDown` | `def.chaseBlock` |
| `lebron.skipPass` | passive | any pass ≥ 8 m or a kick-out while driving | range 14 m; passes ≥ 8 m use a one-hand flick at 15 m/s, release 0.10 s, `σ ×0.6`; no jump-pass or drive-pass penalty; AI pass tendency 1.35 | `pass.skip1h` |
| `lebron.bully` | passive | post vs a defender ≥ 0.05 m shorter or ≥ 15 strength weaker | backdown gain ×1.3 | — |

### 8.4 Giannis Antetokounmpo

| id | type | trigger | effect | clip |
|---|---|---|---|---|
| `giannis.euro` | trigger | driving (speed ≥ 3.5 m/s, velocity within 45° of the rim), SHOOT at d ∈ [2.6, 3.6] m; or at d ≤ 2.6 with a defender in the lane within 1.5 m in front. Direction: stick lateral sign if \|lat\| ≥ 0.35, else away from the lane defender. AI: 35 % of drives ([PROF tendencies]) | two-step gather 1.1 m + 1.3 m with 0.9 m lateral; the lane defender is **dodged** with `p = 0.70 × (1.15 − 0.35·n(perimeterD))` (Jordan 0.57, Yao 0.72): stunned 0.35 s and excluded from X and from block eligibility for this shot; finish = long dunk if sprinted recently and the lane is clear after the gather, else layup (`euro` type 0.98). Generic euro for others: d ≤ 2.2, dodge p × 0.6 | `sig.giannis.euro`, `lay.euro` |
| `giannis.longDunk` | passive | dunk classification up to 3.4 m (sprinting) | two-hand long-gather dunk; `Pg 0.99`; `A ×= 0.50` vs contests; dunk-stuff `abilityMul 0.60` | `dunk.longGather` |
| `giannis.helpBlock` | passive (defence) | he is not the shooter's assigned defender | help trigger radius 4.0 m (generic 3.2), help reaction × 0.5, contest range 2.6 m, `rHand 0.34`, block `abilityMul 1.25`; chase-down level 1 | — |

### 8.5 Yao Ming

| id | type | trigger | effect | clip |
|---|---|---|---|---|
| `yao.hook` | trigger | in `post` + SHOOT (default for Yao, any stick except toward the rim), or SHOOT within 4.5 m with his back / side to the rim | jump hook toward the middle (stick lateral picks the shoulder): close zone, `A ×= 0.45`, release 3.55 m; only defenders with H ≥ 2.05 m may block it (block `B0 ×0.5`) | `sig.yao.hook` |
| `yao.highRelease` | passive | all Yao jump shots | release heights 3.45 / 3.40 / 3.55 (§1.2) used in `Kh`; block `abilityMul 0.60` vs defenders with H < 2.05 m | — |
| `yao.anchor` | passive (defence) | Yao within 2.5 m of the rim | close / layup / dunk shots by opponents within 3.0 m of Yao: his contest range `Rc = 3.0`, `deter +0.15` (§3.6); block `rHand 0.34`, `abilityMul 1.20` inside 2.0 m of the rim; AI auto-jumps when the predicted hand-ball distance at his apex ≤ 0.40 m | `def.wall` |
| `yao.post` | passive | post (§6.2) and drop step | post entry radius 5.5 m; CROSS in post = drop step (`sig.yao.dropStep`, power layup, or dunk when d ≤ 1.5 m); quick SHOOT tap = pump fake → second press within 0.6 s = up-and-under (`lay.upUnder`, `Pg ×1.0`) | `sig.yao.dropStep`, `lay.upUnder` |
| trait | — | — | slow feet from §2 (run 4.59, sprint 5.73, accel 11.3, turn 9.9); never dribbles more than 2 times per hold (AI); no dribble moves; closeouts beyond 5.5 m from the rim run at ×0.85 | — |

### 8.6 Kyrie Irving

| id | type | trigger | effect | clip |
|---|---|---|---|---|
| `kyrie.combo` | trigger | CROSS double-tap (≤ 0.35 s) / triple-tap | chains up to 3 moves; `comboMul` 2.0 / 3.0; `AB0 0.06` (ankle); idle cosmetic combos [ANIM §4.2] have no gameplay effect | `sig.kyrie.hesiCross`, `move.btl`, `move.btb`, `sig.kyrie.doubleBtlStepback` |
| `kyrie.finisher` | passive | all layups; auto variant: `reverse` when a defender with H ≥ 2.05 m is within 1.5 m between him and the rim or on a baseline approach < 35°; `floater` when driving ≥ 3.0 m/s at d ∈ (2.2, 4.5] with such a defender within 2.0 m of the rim | layup `A ×= 0.55`, block `abilityMul 0.55`; floater type multiplier 1.00 (generic 0.92), floater `A ×= 0.60` | `lay.reverse`, `shot.floater`, `lay.spin` |
| `kyrie.stepback` | trigger | dribbling + SHOOT with the stick away from the rim (≥ 0.5), or SHOOT during `move.stepback` | back-drift 0.80 m (generic 0.70, LeBron 0.50), `A ×= 0.60` (generic 0.80), type multiplier 1.00 (generic 0.95) | `sig.kyrie.doubleBtlStepback`, `shot.stepbackJ` |
| `clutch` | passive | — | above | — |

Ability acceptance (unit, deterministic seeds; `test/unit-abilities.mjs`): for each ability, a fixture asserts the
multiplier is applied exactly once at its hook and absent for the other five legends; for each trigger, the trigger
conditions at their boundaries (e.g. FT-line dunk at d 4.19 → normal jumper, 4.20 → `dunk.ftLine`, speed 5.99 → no).

---

## 9. Inputs → actions (context resolver `src/context.js`)

### 9.1 Offence, ball handler (first matching row wins)

| # | state / condition | input | result |
|---|---|---|---|
| 1 | any | CROSS tap while a move is playing or within 0.35 s of the previous tap | queue combo (§7.3) |
| 2 | `post` | SHOOT, stick toward the rim (dot ≥ 0.5) | drop step: power layup / dunk (Yao `sig.yao.dropStep`) |
| 3 | `post` | SHOOT, otherwise | Yao/Giannis hook (Giannis only with \|lat\| ≥ 0.45, else turnFade); Kobe `kobe.postFade`; Jordan `sig.jordan.turnFade` (+`jordan.fade`); others `shot.turnFade` |
| 4 | `post` | CROSS | spin (`move.spin` from post) / Yao drop step |
| 5 | Jordan, `jordan.ftDunk` conditions (§8.1) | SHOOT | `dunk.ftLine` |
| 6 | Giannis, `giannis.euro` conditions | SHOOT | euro step |
| 7 | d ≤ dFinish (2.2; Jordan 2.8 at speed ≥ 3.0; Giannis 3.4 sprinting) | SHOOT | dunk if `dunkAllowed`, else layup family variant (§9.2) |
| 8 | dribbling, speed ≥ 3.0, d ∈ (2.2, 4.5], a defender H ≥ 2.05 within 2.0 m of the rim, stick toward the rim | SHOOT | floater |
| 9 | dribbling, stick away from the rim (dot ≤ −0.5, mag ≥ 0.5) | SHOOT | stepback jumper |
| 10 | holding (not dribbling), stick away (dot ≤ −0.5, mag ≥ 0.5) | SHOOT | fadeaway |
| 11 | within 0.8 s after a jab | SHOOT | jab pull-up |
| 12 | otherwise | SHOOT | jumper (pull-up if speed ≥ 1.5 or dribbling, set shot otherwise) |
| 13 | rows 3, 8–12 | SHOOT released < 0.12 s and before `takeoff` | pump fake (cancel, §7.4) |
| 14 | within 0.6 s after a pump fake, d ≤ 3.0 | SHOOT | up-and-under layup |
| 15 | holding | CROSS | jab (stick back: pump fake) [ANIM §4.3] |
| 16 | dribbling | CROSS | `selectMove` [ANIM §4.3] |
| 17 | walk toward the rim into a defender near the paint (§6.2 detector, 0.35 s) | stick only | post-up |
| 18 | any | PASS tap / hold ≥ 0.30 s | chest pass / lob (v1), target by stick or best (v1 `resolvePassTarget`); LeBron skip pass automatic (§8.3) |
| 19 | any | SPRINT held | sprint |

`dunkAllowed = sprintedRecently (0.30 s, v1) && laneOK`, `laneOK`: dunk ≥ 85 → no defender within 0.6 m of the
player→rim segment; 70 ≤ dunk < 85 → 1.2 m (v1); dunk < 70 (Kyrie) → no opponent within 3.0 m of the player
(open breaks only); Yao: any speed, d ≤ 1.5 m, 0.8 m lane.

### 9.2 Layup variant selection (finishing row 7; [ANIM §5.5] clips)

First match: Jordan with a block-eligible defender predicted at the rim → `lay.switch` (p 0.75); baseline approach
< 35° to the baseline → `reverse`; Kyrie with a big (H ≥ 2.05) within 1.5 m in front → `reverse`; defender in the lane
within 1.5 m in front → `euro` (Giannis 35 %, others 15 % — otherwise `power` for LeBron/Giannis/Yao when a defender is
within 1.0 m, else `std`); open lane → `fingerRoll` (Kyrie/Jordan/Giannis 40 %, others 15 %), else `std`. Stick lateral
≥ 0.45 at the press forces `euro` toward that side for everyone (it is the learnable manual override).

### 9.3 Defence

| input | result |
|---|---|
| SHOOT/BLOCK tap | jump (`hJump`); a block or contest per §3.6 / §4; LeBron chase-down from behind (§8.3) |
| (no input) | **auto hands-up**: the user-controlled defender within 1.6 m of a shooter in gather / windup / layup raises both hands (`Kh` uses `reach − 0.05`, ANIM `def.handsUp` upper-body layer) |
| STEAL tap | poke (§5.1); during an opponent's pass within 2.5 m of the pass line: lane lunge (§5.3) |
| SWITCH tap | v1 cycle (nearest to the ball, 0.25 s cooldown) |
| SPRINT held | sprint |
| auto-switch (default ON, §12.4) | on an opponent catch, control moves to the defender assigned to the catcher if the user's stick has been idle ≥ 0.40 s |

### 9.4 Keyboard

v1 map unchanged (Space/J = primary, K = secondary, L = tertiary, Shift = sprint); double-tap = `L L` within 0.35 s;
quick tap of Space < 0.12 s = pump fake.

### 9.5 First-time tips (i18n `tip.*`, shown once each, stored in `localStorage` with try/catch)

`tip.pumpFake` (first time the user holds the ball 2 s): 轻点投篮 = 假动作 / Tap SHOOT quickly to pump fake;
`tip.combo` (first crossover): 连点两下变向 = 连招 / Double-tap CROSS for a combo; `tip.post` (first time within 5 m
with a defender in front): 慢慢顶向防守人 = 背身单打 / Walk into your defender to post up; `tip.fade` (first post-up):
摇杆背离篮筐再投篮 = 后仰 / Stick away from the hoop + SHOOT = fadeaway; `tip.block` (first defensive possession):
盖帽要在对手出手时起跳 / Jump as he releases to block. 2.5 s each, under the caption band, never during the meter.

---

## 10. AI v2 (`src/ai.js`, `src/ai-tend.js`)

### 10.1 Architecture (changes to v1 §7)

- Decision tick 0.10 s staggered (v1), steering every step (v1), reaction via the 0.5 s ring buffer (v1).
- **All timers are countdowns** decremented in `updateAI` (`stealCd`, `probeFlipCd`, `cutCd`, `helpCd`, `contestCd`,
  `passHoldCd`, `releaseCd`), reset by `resetAI(player)` which `Game.start()` / `rematch()` / `quit()` call for all six
  players ([REV#35]). No absolute `world.time` stamps survive a game.
- Utility in expected-points units with legend tendencies (§10.3), argmax with per-tick noise `rng.range(0, 0.05)`
  per action and the v1 hysteresis 0.40 s (shot clock < 3 s bypasses it).
- The user's CPU teammates run the `normal` behaviour row regardless of difficulty (D-GP-8).

### 10.2 Tendencies per legend (`tend`, stored in `legends.js`; derived from [PROF tendencies])

Shot-mix multipliers use `m = 0.6 + 1.6·share` with the profile shares; other values are direct.

| tendency | kobe | jordan | lebron | giannis | yao | kyrie | used in |
|---|---|---|---|---|---|---|---|
| profile shot mix (rim / close / mid / three / post) | .25 / — / .45 / .15 / .15 | .38 / — / .45 / .10 / .07 | .45 / — / .15 / .20 / .10 | .60 / .15 / .10 / .15 / — | .05 / .30 / .35 / .00 / .60 | .40 / .10 / .25 / .25 / — | test §11.3 |
| `shotRim` (drive finish) | 1.00 | 1.21 | 1.32 | 1.56 | 0.68 | 1.24 | U_drive |
| `shotClose` | 0.80 | 0.80 | 0.80 | 0.84 | 1.08 | 0.76 | U_shoot close |
| `shotMid` | 1.32 | 1.32 | 0.84 | 0.76 | 1.16 | 1.00 | U_shoot mid |
| `shotThree` | 0.84 | 0.76 | 0.92 | 0.84 (gate 2.5 m) | 0 (gate) | 1.00 | U_shoot three |
| `post` (vs mismatch only, except Yao always) | 0.84 | 0.72 | 0.76 | 0.60 | 1.56 | 0 | U_post |
| `iso` (dribble-move utility) | 1.10 | 1.00 | 0.80 | 0.60 | 0 | 1.40 | U_move |
| `isoMoves` (moves before a non-urgent shot when guarded ≤ 1.5 m) | 1–2 | 1–2 | 0–1 | 0–1 | 0 | 2–4 | gate |
| `patience` (s from LIVE with threshold +0.5) | 2.5 | 2.5 | 3.0 | 1.5 | 2.0 | 3.5 | §10.3 |
| `pass` | 0.80 | 0.90 | 1.35 | 1.00 | 1.00 | 0.85 | U_pass |
| `kickWhenDoubled` | 0.60 | 0.70 | 0.90 | 0.75 | 0.95 | 0.70 | double team |
| `driveRight` (share of right-hand drives) | 0.60 | 0.60 | 0.50 | 0.65 | — | 0.60 | drive side |
| `jab` (per hold, triple threat) | 0.70 | 0.40 | 0.15 | 0.10 | 0.0 | 0.10 | U_move holding |
| `pumpFake` (per jumper decision) | 0.25 | 0.25 | 0.10 | 0.05 | 0.30 | 0.10 | fake roll |
| `fade` (P(fade | jumper, defender ≤ 1.0 m)) | 0.55 | 0.60 | 0.25 | 0.05 | 0.15 | 0.20 | variant |
| `stepback` (P(stepback | jumper off dribble, defender ≤ 1.2 m)) | 0.25 | 0.10 | 0.30 | 0.0 | 0.0 | 0.55 | variant |
| `checkShare` (CPU check-ball receiver weight) | 0.40 | 0.55 | 0.50 | 0.10 | 0.05 | 0.40 | §12.3 |
| `crash` (offensive rebound crash rate) | 0.20 | 0.30 | 0.35 | 0.55 | 0.60 | 0.05 | off-ball |
| `boxOut` | 0.40 | 0.50 | 0.70 | 0.60 | 1.00 | 0.30 | §6.3 |
| `stealGamble` | 1.20 | 1.30 | 1.00 | 0.80 | 0.20 | 1.20 | CPU poke / lane |
| `help` | 0.60 | 0.90 | 1.00 | 1.50 | 1.20 | 0.50 | help prob × |
| `contestJump` (perimeter / at the rim) | 0.70 / 0.70 | 0.80 / 0.80 | 0.80 / 0.90 | 0.80 / 0.95 | 0.40 / 1.00 | 0.50 / 0.30 | §10.6 |
| `closeout` (closeout speed factor; sprint if ≥ 1) | 1.0 | 1.0 | 1.0 | 1.0 | 0.85 | 1.0 | §10.5 |
| `guardBest` (prefers the opponent with the highest usage) | 1 | 1 | 0 | 0 | 0 | 0 | matchups |

### 10.3 Ball handler decision

Gates (no SHOOT/PASS/POST candidate while any is active, except shot clock < 3 s):
- SETUP 0.8 s after LIVE (v1); **catch gate 0.40 s** after any catch (`SHOOT_HOLD_MIN`, ANIM `ready` at 0.30 s)
  ([REV#25], [REV#40]); PASS gate 0.50 s (v1 `PASS_HOLD_MIN`).
- `isoMoves`: while the remaining iso-move budget > 0 and the on-ball defender is within 1.5 m, SHOOT is allowed only
  if `EP_shoot ≥ θ + 0.6`.
- Yao: never more than 2 dribbles per hold; no dribble moves (`traits`).

Candidates (each evaluated with the same functions the game uses, never with privileged randomness):
```
EP_shoot = pts × p_est ; p_est = Pg × typeMul × T̄_cpu(difficulty) × C_est × M_est × K       (T̄: §3.2)
           C_est: §3.6 with every defender's current hands-up height, and Kh +0.15 for the defender within 1.2 m
           (he is expected to jump with his contestJump probability)
U_shoot  = EP_shoot × tend.shot<zone> × (owner of 'clutch' in the clutch window ? 1.5 : 1) ; candidate only if
           U_shoot ≥ θ(shotClock) + (tLive < tend.patience && openness < 2.5 ? 0.5 : 0)
           θ = 0.85 + 0.35·clamp((shotClock − 3)/11, 0, 1)                              (1.20 at 14 s, 0.85 at ≤ 3 s)
           three gates: traits.threeGate (Giannis openness ≥ 2.5 m; Yao never unless shotClock < 1.5)
U_drive  = 2 × p_finish_est × pBeat × tend.shotRim × diff.cpuDriveMul ;
           pBeat = guardBeaten ? 0.90 : clamp(0.20 + 0.40·(run_h − run_def·slideMul_def) + 0.20·(ballHandle − perimeterD)/50
                   + (LeBron/Giannis with strDiff ≥ 10 ? 0.15 : 0), 0.05, 0.60)
           guardBeaten (fix [REV#26]): guard null, stunned/fallen, behind the handler (dot < 0), or |lateral offset of
           the guard from the handler→rim line| > 0.90 m ; laneClear = no OTHER defender within 0.90 m of the next 3 m
           of the handler→rim segment (the guard is excluded) ; U_drive = 0 if !laneClear && !(LeBron/Giannis/Yao)
U_move   = (U_drive(pBeat = 0.90) × pShake_est + 0.85 × (1 − pShake_est)) × tend.iso         (dribbling, guard ≤ 1.5 m)
U_jab    = 0.95 × tend.jab   (holding only; max 2 jabs)
U_post   = 2 × p_est(post shot at the expected depth) × tend.post ; candidate only when d ≤ 6.5 and
           (Yao || mismatch: H_off − H_def ≥ 0.08 or strength_off − strength_def ≥ 15)
U_pass   = max over teammates: (EP_shoot(receiver at the predicted catch point, after his defender's closeout)
           × 0.92 − 1.0 × risk) × tend.pass ; candidate only if U_pass ≥ max(U_shoot, U_drive, U_move) + 0.10
           risk = Σ_defenders interceptChance (§10.7) ; reject if risk > riskTol (LeBron 0.10, Jordan 0.12, Kobe 0.15,
           Kyrie 0.15, Yao 0.15, Giannis 0.18; × 1.6 easy, × 0.7 hard)
U_probe  = 0.85 (constant baseline, × 0.6 when shotClock ≤ 6)
RESET    = v1 rule (defender within 0.7 m and shotClock > 8 → back out to 7.5 m), score 0.65
urgent   = shotClock < 3 → best SHOOT variant regardless (v1); < 1 → release immediately (v1 PANIC)
```
Variant choices once SHOOT wins: fade with `tend.fade` if the defender ≤ 1.0 m (holding or post); stepback with
`tend.stepback` if dribbling and the defender ≤ 1.2 m; jab pull-up after a jab; pump fake first with `tend.pumpFake`
when the defender ≤ 1.2 m and was not already fooled this hold. Set-feet brake ([REV#25] fix): if speed > 2.5 and no
defender within 1.0 m, wait up to 0.35 s (stop) before pressing.

Double team: when the handler is in `post` or the paint and two defenders are within 1.5 m for 0.3 s, the next tick
forces PASS evaluation with `U_pass × (1 + tend.kickWhenDoubled)`.

### 10.4 Off-ball offence

Spots (`SLOTS_V2`, world metres; v1 five kept):

| id | x, z | id | x, z |
|---|---|---|---|
| top | 0, −4.9 | leftElbow / rightElbow | ∓2.44, −8.6 |
| leftWing / rightWing | ∓5.4, −7.6 | leftBlock / rightBlock | ∓2.0, −11.6 |
| leftCorner / rightCorner | ∓7.0, −13.3 | leftDunker / rightDunker | ∓3.0, −13.6 |
| rightBaseline | 5.0, −12.8 | | |

Preference weights `spots` (pick the unowned spot maximising `w − 0.15·distance`, ≥ 2.5 m from teammates and the
handler, v1 relocation rule kept):

| legend | spots |
|---|---|
| kobe | rightElbow .30, rightWing .30, rightBlock .15, leftWing .15, rightBaseline .10 |
| jordan | leftElbow .25, rightElbow .25, rightWing .25, leftBlock .125, rightBlock .125 |
| lebron | top .35, leftWing .30, rightWing .20, leftBlock .15 |
| giannis | top .25, rightWing .20, leftDunker .25, rightDunker .30 |
| yao | leftBlock .40, rightBlock .25, leftElbow .15, rightElbow .20 |
| kyrie | top .30, rightWing .30, leftCorner .15, rightCorner .15, leftWing .10 |

Cuts (v1 every 4–7 s; Jordan back-door cut when his defender denies within 1.0 m: p 0.5 per tick for 1.4 s; Giannis
dunker-spot baseline cut on the handler's drive). Offensive rebounding: on a teammate's shot each player crashes
with probability `tend.crash` (else goes to the nearest arc spot for the long rebound); the CHECK formation places
teammates at their top spot instead of the v1 wings.

### 10.5 Defence

- **Matchups at CHECK** (replaces v1 roster-index matching): evaluate the 6 permutations, minimise
  `Σ cost(d, a)`, `cost = 1.5·|H_d − H_a| + 0.02·max(0, speed_a − speed_d) + (guardBest_d && a = the opponent with
  the highest tend.checkShare ? −0.5 : 0) + (speed_a − speed_d > 30 ? 2.0 : 0)` (H in m, speed in rating points).
  Ties broken by roster order. Default lineup (binding test values): BRIGHT defending DARK → Jordan–Kyrie,
  Kobe–LeBron, Yao–Giannis (Σ 3.08); DARK defending BRIGHT → LeBron–Kobe, Kyrie–Jordan, Giannis–Yao (Σ 0.54).
  Greedy re-match after 1 s of doubling (v1).
- **On-ball gap**: `gap = diff.defGap × (1.10 − 0.20·n(perimeterD_def)) + sag`, `sag = man beyond the arc ?
  0.6·(1 − n(three_man)) : 0` (Giannis +0.27, Yao +0.57), `−0.15` if the man's three ≥ 85 (Kyrie, Kobe). Yao on the
  ball beyond 6.5 m from the rim: `gap = max(gap, 1.8)` (drop).
- **During the man's shot** ([REV#29]): when the man is in gather / windup / layup / airborne-with-ball, the on-ball
  defender stops steering to the gap point; he steers to `shooter + dir(shooter→rim)·0.70` at sprint if farther than
  1.0 m, never moves away from the shooter (velocity component away from the shooter clamped to 0), and his contest
  jump's horizontal velocity at takeoff is `clamp(v·dir(def→shooter), 0, 2.0)` along `dir(def→shooter)` (no backward
  hop).
- **Off-ball** sag: `k = lerp(0.40, 0.12, n(three_man))` if the man is beyond the arc (v1 0.35), `0.20` inside (v1),
  plus 0.6 m toward the ball (v1).
- **Closeouts** ([REV#40]): when a pass is released, the receiver's defender steers to `catchPoint + dir(catch→rim)·
  closeGap` (closeGap 1.0 m; Yao 1.5) at sprint × `tend.closeout`, arriving with hands up (counts for `Kh`).
- **Help** (v1 rule): probability per tick `clamp(diff.help × tend.help, 0, 0.95)`, trigger radius 3.2 m (Giannis
  4.0), commit 1.5 s. **Double team** on a post-up: if the handler is in `post` vs a mismatch and a help defender is
  within 3.5 m, he doubles with probability `0.5 × diff.help × tend.help` per post-up (once).
- **Yao drop**: Yao's goal is clamped to within 4.5 m of the rim unless his man is inside 5.5 m (post), never switches
  onto a player beyond the arc when another assignment exists (cost +2.0).
- **Rebound**: as offence (v1) + `rebReact` and box-out (§6.3).

### 10.6 Contest and block timing (CPU)

When the defender's man presses SHOOT (seen after `reaction`), the defender knows the clip's `tIdeal` and predicts the
release `tRel = tPress + tIdeal` (pump fakes look identical until their cancel at ≤ 0.12 s + reaction):
```
if dist ≤ 1.6 m (v1 CONTEST_R; Yao anchor / Giannis help: when the shooter is within their Rc):
  jumpDecision = rng < diff.contestJumpP × tend.contestJump[perimeter|rim]
  jump: start at tRel + 0.03 − airtime/2 + N(0, diff.jumpSigma) ; if already late by ≤ 0.10 s jump now, later → hands up
  no jump: hands up (Kh uses reach − 0.05)
```
`contestJumpP` 0.35 / 0.55 / 0.75, `jumpSigma` 0.12 / 0.08 / 0.05 s ([REV#39] jitter). Rim protectors (Yao anchor,
Giannis help, LeBron chase-down) jump at layups/dunks when the predicted hand-ball distance at their apex ≤ 0.40 /
0.45 / 0.50 m.

### 10.7 Passing risk and anticipation ([REV#34])

`interceptChance_i` for a candidate pass: closest distance `dl` of defender `i` to the pass segment, ball time to that
point `tb = s/passSpeed + passRelease`; `reachR = intR_i + run_i × max(0, tb − reaction)`; `chance = dl < reachR ?
0.6·(1 − dl/reachR) : 0`. The hard reject of v1 (`LANE_HARD_R 0.5 + 0.1·d`) is removed; `LANE_R 0.8` stays as a −0.6
score penalty inside `U_pass`. CPU defenders jump a lane when a pass is released with `dl < reachR` and
`rng < 0.6 × tend.stealGamble × diff.interceptGamble` (0.5 / 0.8 / 1.0): they sprint to the closest point.

### 10.8 Shot-clock management and pace

Target LIVE possession length 5.5–10 s (normal). Shot-clock violations ≤ 4 % of possessions. The patience window and
θ(shotClock) are the tuning knobs; implementers may scale `patience` by ±30 % and θ by ±0.1 to hit §11 bands, nothing
else.

---
## 11. Difficulty, balance targets and verification

### 11.1 `DIFFICULTY` v2 (`src/constants.js`, replaces the v1 table [REV#27])

| key | easy 简单 | normal 普通 (default) | hard 困难 | applies to |
|---|---|---|---|---|
| `reaction` (s) | 0.36 | 0.24 | 0.15 | CPU opponents' ring-buffer delay |
| `cpuSigma` (s) | 0.075 | 0.055 | 0.038 | CPU release timing σ |
| `cpuMakeMul` | 0.88 | 0.96 | 1.00 | CPU shooter vs the human team |
| `userMakeMul` | 1.06 | 1.00 | 0.97 | human shooter |
| `userGreen` G_DIFF (s) | 0.040 | 0.033 | 0.027 | human green half-width base |
| `userBlockMul` | 1.15 | 1.00 | 0.90 | human blocker |
| `cpuBlockMul` | 0.55 | 0.80 | 1.00 | CPU blocker |
| `contestJumpP` | 0.35 | 0.55 | 0.75 | CPU contest jump probability (× tend) |
| `jumpSigma` (s) | 0.12 | 0.08 | 0.05 | CPU contest-jump timing error |
| `cpuStealS0` | 0.14 | 0.21 | 0.28 | CPU poke base |
| `cpuStealInterval` (s) | 2.4 | 1.6 | 1.1 | min time between CPU pokes per defender |
| `defGap` (m) | 1.60 | 1.25 | 1.00 | on-ball gap before ratings / sag |
| `help` | 0.30 | 0.60 | 0.90 | help probability per tick (× tend) |
| `sprintProb` | 0.35 | 0.60 | 0.85 | CPU sprint on drives |
| `cpuShakeMul` | 0.60 | 0.85 | 1.00 | CPU moves vs a human defender |
| `humanShakeMul` | 1.15 | 1.00 | 0.85 | human moves vs CPU defenders |
| `cpuPassMul` (σ ×) | 1.40 | 1.00 | 0.80 | CPU pass accuracy |
| `cpuDriveMul` | 0.70 | 1.00 | 1.10 | CPU drive utility |
| `biteBase` | 0.55 | 0.40 | 0.25 | CPU defenders biting on jabs / pump fakes |
| `interceptGamble` | 0.50 | 0.80 | 1.00 | CPU lane jumping |
| `riskTolMul` | 1.60 | 1.00 | 0.70 | CPU pass risk tolerance |

Removed: `shootOpen` (replaced by EP utility), `crossFreeze` (replaced by `cpuShakeMul`), `stealRate`
(replaced by `cpuStealS0`). The user's CPU teammates always use the `normal` column for the behaviour rows
(`reaction` … `riskTolMul`) and multiplier 1.0 for make / block.

### 11.2 Metrics (`game.metrics`, §15) — definitions

- **Possession**: from LIVE (or a live change under the clear rule) to a possession change, a made basket or the end of
  a period. `liveSec` = game-clock seconds consumed. **PPP** = points / possessions.
- **FGA zones** by the shot's rating zone at release: `rim` (layup, dunk, tip), `close`, `mid`, `three`.
- **Drive** = a handler action `drive` lasting ≥ 0.5 s; **post touch** = entering `post`.
- **catchToPress** = time from a catch to the SHOOT press by the same player (non-urgent: shot clock > 2 s at press).
- **releaseSpeed** = root speed at takeoff for jumpers.
- **Turnovers** = steals + interceptions + OOB by the offence + shot-clock violations + not-cleared waves (clear rule).

### 11.3 Bands asserted by `test/balance.mjs` (headless, default lineup unless stated)

**A. CPU vs CPU** (`auto`, both teams AI, `diffMul = 1`), seeds 1–10, `q = 120` (4 × 2:00), difficulty `normal`
(behaviour rows normal); means over the 10 games, per team unless stated:

| metric | band |
|---|---|
| FG% | 42–58 % |
| 3PA / FGA | 12–35 % |
| rim FGA share | 25–50 %; **each team ≥ 15 % drives-finished FGA** ([REV#26]) |
| blocks / opponent FGA | 3–8 % (a team defending with Yao ≤ 12 %) |
| steals / possession (pokes caught by the defence + interceptions) | 4–10 % |
| turnovers / possession | 8–18 % |
| shot-clock violations / possession | ≤ 4 % |
| mean `liveSec` per possession | 5.5–10.0 s |
| PPP | 0.85–1.25 |
| catchToPress | median ≥ 0.45 s; share < 0.25 s = 0 % ([REV#25/#40]) |
| jumpers with releaseSpeed > 2.5 m/s | ≤ 25 % |
| CPU passes intercepted or deflected | 2–6 % ([REV#34]) |
| ankle-breaks per game (both teams) | 0.2–3.0 |
| air balls ending OOB | ≤ 20 % of air balls ([REV#30]) |
| untouched misses ending OOB | ≤ 25 % ([REV#31]) |
| every ability except `jordan.ftDunk`, `lebron.chaseDown` | triggered or applied ≥ 1 time over the 10 games |
| invariants (`invariantsBroken`, NaN, ball y ≥ 0.10, shot clock in [0, 14]) | 0 violations |

Per-legend style (pooled over the 10 games, a legend's check only when he has ≥ 40 FGA):
Yao 3PA ≤ 1 % of his FGA and post touches ≥ 40 % of his touches; Giannis 3PA ≤ 20 % of his FGA and every non-urgent
Giannis 3PA had openness ≥ 2.5 m; Kobe mid share ≥ 35 %; Jordan mid share ≥ 30 %; LeBron rim share ≥ 35 % and the
most assists on his team; Kyrie ≥ 1.5 dribble moves per possession in which he is the handler and stepbacks ≥ 20 %
of his jumpers; every legend's rim / mid / three shares within ±12 percentage points of his profile share (§10.2).

**B. Idle human** (`bot = 'idle'`: the user's player never moves; the user's teammates defend with the normal row;
user possessions end through `__game.turnover()` at LIVE + 0.5 s), seeds 1–5, `q = 120`, per difficulty:
CPU FG% easy 40–52 %, normal 48–60 %, hard 55–68 %; **strictly increasing easy < normal < hard with gaps ≥ 4 points**;
CPU PPP easy ≤ 1.05, hard ≥ 1.10 ([REV#27] measured 69 / 69 / 75 % in v1).

**C. Average human** (`bot = 'avg'`, §11.4), seeds 1–5, `q = 120`:

| | easy | normal | hard |
|---|---|---|---|
| human-team FG% | 52–68 % | 45–60 % | 38–54 % |
| CPU FG% | 38–50 % | 44–56 % | 50–62 % |
| human-team win share over the 15 games | ≥ 0.70 | 0.35–0.75 | ≤ 0.45 |

### 11.4 Scripted bot human (`src/testbot.js`, loaded only for `?bot=` or `__game.bot.set`)

Drives the user's Intent (the real input path, never internal setters):
- **offence** (`avg`): from LIVE + 0.8 s pick a play by rng: drive (40 %: sprint toward the rim, SHOOT at d ≤ 2.0 m),
  pull-up (30 %: run 1.5 s along the arc, SHOOT), pass-and-shoot (30 %: PASS, then on the return catch SHOOT after
  0.5 s); hold SHOOT for `tIdeal + N(0, 0.050)` s (`good`: σ 0.030); one CROSS tap with p 0.5 when a defender is
  within 1.2 m.
- **defence**: steer to the man's gap point (normal defGap), auto hands-up, BLOCK tap on 50 % of the man's shots at
  `tRel − airtime/2 + N(0, 0.10)`, STEAL tap every 2.5 s when within `stealRange`, SWITCH never.
- `drive` / `pullup` modes replay v1's `human-sim2` cases A1 / A4 exactly for §11.5 S1–S2.

### 11.5 Scenario tests (deterministic seeds; `test/balance.mjs --scenarios`; n trials each)

| id | setup | assertion |
|---|---|---|
| S1 first-timer drive (n 30 per difficulty) | user = default handler, `bot 'drive'` from the check spot vs the CPU defence | normal: scores 35–65 %, blocked ≤ 25 %, stripped before the shot ≤ 20 %; easy: scores ≥ 50 %, blocked ≤ 12 %; hard: scores 25–55 %, blocked ≤ 35 %; normal ≥ 0.6 × easy (no cliff, [REV#39] v1 87 % → 0 %) |
| S2 pull-up near the defender (n 30) | `bot 'pullup'`, SHOOT at d ≤ 3.5 m after a sprint | normal blocked ≤ 20 %, scores 25–55 % |
| S3 block probe (n 60) | v1 `contest-probe`: human `debugShoot({eT: 0})` from 6.0 m and 4.5 m, CPU on-ball defender at its natural gap, hard | blocked ≤ 15 % (6.0 m), ≤ 10 % (4.5 m) (v1 67 % / 0 %) |
| S4 no back-off (n 60) | defender teleported 0.91 m in front, `debugShoot({eT: 0})`, easy and normal | distance at release ≤ 1.00 m in ≥ 90 % ([REV#29]) |
| S5 catch gate (n 40 CPU catches) | auto game, normal | catchToPress ≥ 0.40 s for 100 % of non-urgent shots |
| S6 interception (n 30) | defender parked 0.3 m off a 6 m chest-pass line | intercepted or deflected ≥ 30 %; CPU `bestPassTarget` never returns a pass with risk > riskTol |
| S7 rating fixtures (n 400 each) | forced contact / forced conditions via `debugBlock`, `debugSteal`, forced ankle fixture (Kyrie 2nd combo move vs committed Yao) | observed rate within ±0.05 of the formula value |
| S8 points at release (n 10) | sprinting shooter presses 0.1 m outside the arc, releases 0.4 m inside | `shotInfo.points === 2`; stationary shooter 0.1 m outside → 3 ([REV#14]) |
| S9 FT-line dunk (n 10) | `forceAbility('jordan.ftDunk')` | clip `dunk.ftLine`, score +2, `abilityLog` entry; at d 4.19 → layup/jumper not ftDunk |
| S10 chase-down (n 100) | Kobe layup from 1.8 m, LeBron 2.5 m behind sprinting, forced jump at the predicted apex | eligible ≥ 70 %; block rate within ±0.05 of `min(0.55, 0.50 × blkF × hAdv)` (human blocker) |
| S11 rematch timers (n 1) | auto, q 120, seed 3: count CPU poke attempts in the first 120 s of game 1 and of game 2 after `rematch()` | game-2 attempts ≥ 0.5 × game-1 attempts ([REV#35]) |

---

## 12. Lineup, teams, draft, kits, control

### 12.1 Flow

`MENU` → 开始比赛 → **`LINEUP`** (new state, overlay panel, no sim; the 3D scene behind shows the six players in an
idle line-up [CHR]) → 开始 → `CHECK`. 再来一局 (rematch) keeps the lineup and skips `LINEUP`; 返回主菜单 → `MENU`; the
main menu gets a 阵容 / Lineup button that opens `LINEUP` with 开始 enabled. Pause menu: no lineup changes mid-game.

### 12.2 Lineup screen (`#menuLineup`, all text through `t()`)

- Two columns (landscape) / two stacked rows (portrait): team A (left / top) and team B, each with a header (team name
  per §12.5, kit swatch 16×16 px, "我方 / YOU" tag on the user's side) and three player cards.
- Card: 72 px tall (landscape width 168 px; portrait full width / 1 column per team), min touch target 44 px; number
  chip (28 px circle in the current kit colours), short name 16 px, full name 11 px, height `1.98 m`, overall badge,
  three stat chips = the player's three highest ratings excluding overall (labels `stat.<key>`: Kobe 中投 98 / 上篮 95 /
  外线防守 93 …), ★ badge on the handler (index 0 of the user's team).
- Interactions: tap a card → selected (2 px `#ff7a1f` outline); tap another card → **swap** (different teams: swap
  teams; same team: swap order, which changes ★ when index 0 is involved); tap the selected card again → deselect;
  tap ★ area of a user-team card → make him the handler. Buttons: `我方 [A][B]` segmented, `球衣 [自动][经典]`
  segmented, `随机 Shuffle` (seeded Fisher–Yates of the six into 3 + 3, rng = gameplay seed ^ 0x5EED), `重置 Reset`
  (default lineup), `开始 Start` (primary, 46 px). Hint line `lineup.swapHint`. The panel scrolls on short viewports
  (`.panel{overflow-y:auto}` + the input.js touchmove exemption for `.panel`, [REV#7]).
- Any 3 + 3 split of the six is valid; duplicate numbers on one team (LeBron and Jordan, both 23) are allowed — the HUD,
  captions and box score identify players by name, never by number.

### 12.3 Who has the ball at CHECK

User's team on offence: always the ★ handler (roster index 0) (replaces v1 "currently controlled player keeps it").
CPU team: weighted pick by `tend.checkShare` normalised over its three (default BRIGHT: Jordan .55, Kobe .40, Yao .05
→ 0.55 / 0.40 / 0.05; DARK: LeBron .50, Kyrie .40, Giannis .10), rng; the same CPU player may receive at most 3
consecutive checks (then re-roll excluding him). Formation: handler `(0, −4.6)`, teammates at their top spots
(§10.4), defenders `lerp(attacker, rim, 0.18)` (v1).

### 12.4 Control and switching

- Offence: the user controls the ball handler; on a completed pass control moves to the receiver (v1); offensive
  rebound → the catcher (v1).
- Defence at CHECK: the defender assigned (by §10.5 matchups) to the opposing handler (v1 rule, new matchups).
- SWITCH: v1 (cycle to the defender nearest the ball, 0.25 s cooldown).
- **Auto-switch** (option `rules.autoSwitch`, default ON): when an opponent catches a pass, control moves to the
  defender assigned to the catcher, but only if the user's stick has been idle (mag < 0.15) for ≥ 0.40 s and no button
  is held; never during the user's own jump. Reason: [REV#40] (CPU possessions resolved before the user could switch).
- Clear rule (if ON): a defensive catch makes the catcher the user's controlled player when the user's team gains the
  ball.

### 12.5 Kits and team names ([DEC], [CHR §7.8])

| lineup | kits = auto | kits = classic (forced) |
|---|---|---|
| equals the default as sets ({LeBron, Kyrie, Giannis} vs {Jordan, Kobe, Yao}, either side, any order) | classic kits; names 暗夜队 / Team Dark, 烈阳队 / Team Bright | same |
| anything else | team A All-Star A (white #F4F4F1 / gold #C9A227), team B All-Star B (black #121212 / red #D22630); names 白队 / Team White, 黑队 / Team Black | each player's classic kit; team names 白队 / 黑队; lineup shows `lineup.clash` |

Score bug abbreviations (3 chars, `TEAMS_V2.abbr`): DRK / BRT, WHT / BLK (zh 暗 / 亮, 白 / 黑). Team colour bars and the
controlled-player ring: DARK `#6F263D`, BRIGHT `#CE1141`, WHITE `#F4F4F1` (dark text), BLACK `#121212` (white text).

### 12.6 Persistence and URL

`localStorage['legends3v3.lineup.v1'] = JSON {a:[ids], b:[ids], user:'a'|'b', kits:'auto'|'classic'}` (read/write
inside try/catch; invalid → default). URL overrides for tests: `?lineup=lebron,kyrie,giannis~jordan,kobe,yao`
`&user=a|b&kits=auto|classic&clear=0|1&autoswitch=0|1&bot=idle|avg|good|drive|pullup` plus the v1 `seed`, `q`, `auto`,
`lang`, `debug`, and `diff=easy|normal|hard`.

---

## 13. Rules v2 (changes to v1 §1 with reasons)

| # | rule | v2 | reason |
|---|---|---|---|
| R1 | 3-point value | decided by the feet at the release input (§3.5) | [REV#14] verified; section instruction |
| R2 | shot-clock reset on an offensive catch | only if the shot touched rim/board or was blocked/deflected (`shot.touched`); otherwise the clock keeps running (and whistles at 0) | [REV#15], v1 §1 text |
| R3 | shot released in the step the shot clock expires | valid: whistle only if the clock was already 0 at the start of a step | [REV#16] |
| R4 | buzzer with a rattling shot | period ends 0.5 s after the shot becomes loose in total (`looseT`), a make in that window counts | [REV#17] |
| R5 | deflected make | keeps `shotInfo.points` for the shooter | [REV#18] |
| R6 | STL credit | to the defender who catches a poked ball or a pass (also floor-bounced passes) | [REV#23], [REV#24] |
| R7 | CHECK | no CPU poke in the first 0.8 s of LIVE and within 0.5 s of a catch | [REV#39] (9 of 14 strips at LIVE + 0.4 s) |
| R8 | check-ball receiver | ★ handler (user team), weighted `checkShare` (CPU) | §12.3 |
| R9 | **clear-the-ball** (option, default OFF) | defensive catch of a free ball (rebound, poke, interception, block recovery) keeps LIVE; possession flips, shot clock 14, `cap.clear`; the new offence must have a player holding/dribbling with feet beyond the arc for ≥ 1 step before a basket counts (else waved off → DEAD(TURNOVER) → CHECK for the other team, `cap.notCleared`); AI never shoots before clearing; made baskets, OOB, shot-clock violations still → DEAD → CHECK | real FIBA 3x3 rule; creates live transition where LeBron's chase-down, Jordan's steal-to-breakaway and Giannis' grab-and-go happen naturally; OFF by default to keep the v1 rhythm and tests |
| R10 | auto-switch on defence | option, default ON (§12.4) | [REV#40] |
| R11 | dunk rim-out | a dunk can rim out with `1 − p` (p ≤ 0.995) | realism of `Pg(dunk)` |
| R12 | goaltending | still not modelled; blocks only on the ascending ball within the windows of §4.1, so no block can be a goaltend | v1 §16 |
| — | kept | 3v3 half court, one hoop, 4 quarters 2:00 default (1/2/3/5 min), 14 s shot clock, OT 1:00, halftime 3 s, possession order (v1 §1), dead-ball timings (MADE 1.5, TURNOVER 1.0, OOB 1.2, SHOT_CLOCK 1.2, CHECK 1.2 s), OOB/backcourt, rest rescue 1.5 s, no fouls/free throws/travelling/3-seconds | [DEC] |

State machine deltas: new `LINEUP` (between `MENU` and `CHECK`, no sim, pause invalid); clear rule adds the LIVE →
LIVE possession flip (`emit('possession', team, catcher)`, `input.setOffense`, matchups recomputed greedily, AI
`newPossession`), and `clearPending` / `cleared` flags reset at every possession change. README "Rules" text is
rewritten to match (R-list above, the v1 possession order Q1 A / Q2 B / Q3 B / Q4 A, dead-ball pauses 1.0–1.5 s + 1.2 s
check, [REV#38]) and gets the note: 非商业粉丝作品；球员姓名与肖像归其本人所有。/ Non-commercial fan project; names and
likenesses belong to the players.

---

## 14. Disposition of every v1 review finding

Verification status in brackets. "Fix as" items are binding for v2 implementers; the owning section is named when
it is not gameplay.

| # | finding | status | disposition |
|---|---|---|---|
| 1 | portrait camera hides players / wastes top | 2/3 ✔ | **fix as** adjusted fix 2: `PORTRAIT = { fov 74, kx 0.40, y 13.0, z0 10.0, kz 0, lookY 0.0, lookZ −6.0 }` (A21 expects fov 74); camera owner re-verifies with the taller v2 bodies (Yao 2.29 m head stays on screen at the check formation) |
| 2 | landscape framing cuts the near 1.9 m | 2/3 ✔ | **fix as** adjusted fix 1: `LANDSCAPE = { fov 44, kx 0.35, y 8.0, z0 5.5, kz 0.25, lookY 1.0, lookZ −8.0 }` + the A21 handler-at-(0,−1) assertion |
| 3 | DPR downgrade keyed on the rAF interval | 1/3 | **fix as** adjusted fix (cadence-calibrated threshold `max(24, 1.4 × cadence)`, monitor only in LIVE, no double render); applies to the v2 quality-tier auto-downgrade |
| 4 | meter projected with the previous camera matrix | 2/3 ✔ | **fix as** hud-local `cam.updateMatrixWorld()` before `project` while the meter is visible |
| 5 | ball allocates its own blob texture | 2/3 ✔ | **fix as** share the humanoid shadow geometry/texture (RENDERING owns the v2 shadow; if blob shadows remain, share them) |
| 6 | backboard DoubleSide | 2/3 ✔ | **fix as** `side: THREE.FrontSide` |
| 7 | game-over panel clipped | 3/3 ✔ | **fix as** both: the `max-height: 360px` landscape media query AND `.panel{overflow-y:auto; touch-action:pan-y; overscroll-behavior:contain}` with the input.js touchmove exemption for `.panel` (needed anyway for the lineup screen) |
| 8 | rotate hint stays during play | 3/3 ✔ | **fix as** `showMenu(null)` hides `#rotateHint` without persisting the flag |
| 9 | joystick moves immediately at the screen edge | 2/3 ✔ | **fix as** delete the initial `_updateStickVector` call in `_onStickDown` + the regression probe |
| 10 | tethered ring drifts over the cluster | 0/3 | evaluated: cosmetic but real by code reading (no re-clamp after tethering); **fix as** `#cluster{position:absolute; z-index:2}` above `#stickRing` (no behaviour change) |
| 11 | menu labels wrap below 400 px | 3/3 ✔ | **fix as** `.row .lbl{flex-basis:52px; word-break:keep-all}` in the ≤ 399 px media query |
| 12 | touch targets < 44 px | 2/3 ✔ | **fix as** 44 px for `.seg .opt`, `.panel .secondary`, `#rotateHint button`, landscape `.rows{gap:4px}`; lineup cards ≥ 72 px |
| 13 | DPR judged under the menu blur | 2/3 ✔ | **fix as** feed the monitor only when `!hud.menu && state ∉ {MENU, LINEUP, GAME_OVER} && !paused`, reset its window when a menu closes |
| 14 | 3 pts decided at press | 3/3 ✔ | **fix as** R1 / §3.5 (feet at release) + S8 test |
| 15 | air-ball recovery resets the shot clock | 0/3 | evaluated: confirmed by code reading (`onCatch` resets for any `ctx === 'shot'`); **fix as** R2 (`shot.touched` set by rim/board events and blocks/deflections) |
| 16 | release at shot clock ≤ 1/60 s whistled | 1/3 | **fix as** R3 (`wasZero` test in `stepClocks`) |
| 17 | rattler killed at the buzzer | 2/3 ✔ | **fix as** R4 (`looseT` accumulation, `buzzerLooseT` seeded from it) |
| 18 | blocked three that drops scores 2 | 0/3 | evaluated: confirmed by code reading (`points === 3 ? 3 : 2` uses Ball.score's 2 for a defender `lastToucher`); **fix as** R5 |
| 19 | captions survive rematch/quit | 2/3 ✔ | **fix as** `hud.clearCaptions()` in `Game.start()` and `Game.quit()` (not in gameOver) |
| 20 | language toggle misses the banner | 2/3 ✔ | **fix as** store `_bannerKey/_bannerParams`, re-render in `refreshLang()` |
| 21 | P/Esc/M/T at halftime skip it | 2/3 ✔ | **fix as** reserved-key exclusion in the halftime handler |
| 22 | pause loses the period banner | 1/3 | **fix as** `hud.bannerState()` stashed in `pause()`, re-issued after the countdown |
| 23 | STL credited on the poke | 3/3 ✔ | **fix as** R6 (credit at the defensive catch) |
| 24 | floor-bounced pass caught by the defence = REB | 0/3 | evaluated: confirmed by code reading; **fix as** R6 (`ballCtx === 'pass'` → STL) |
| 25 | CPU shoots the instant it catches | 2/2 ✔ | **fix as** §10.3 catch gate 0.40 s + set-feet brake (defender > 1.0 m) + closeouts (§10.5); S5 |
| 26 | drives starved by the lane test | 1/1 ✔ | **fix as** §10.3 `guardBeaten` (lateral offset > 0.90 m / behind / stunned) + lane radius 0.90 m excluding the guard + `pBeat`; band "each team ≥ 15 % drive finishes" |
| 27 | difficulty does not scale CPU scoring | not verified | **fix as** §11.1 table (cpuMakeMul, cpuSigma, block / steal / contest knobs; teammates fixed at normal) + band B (strictly increasing, ≥ 4 points apart) |
| 28 | block window far too generous | not verified | **fix as** §4 probabilistic block model; S3 (hard 6 m ≤ 15 %), band blocks 3–8 % FGA |
| 29 | on-ball defender backs away during the windup | not verified | **fix as** §10.5 "during the man's shot" rule; S4 |
| 30 | air balls fly out of bounds | not verified | **fix as** §3.8 air-ball target below the rim plane + forced miss; band ≤ 20 % OOB |
| 31 | rim restitution gives very long rebounds | not verified | **fix as** §3.8 (`REST_RIM 0.40`, tangential 0.80, board 0.50) with the stated acceptance |
| 32 | green misses always long | not verified | **fix as** §3.8 rng short/long |
| 33 | dunk teleports the ball | not verified | **moot in v2 because** [ANIM §5.6] replaces the tween with the socket-driven slam at `RIM.y + 0.18` (D-ANIM-7); gameplay launches the scored ball from the dunk hand at the `slam` event |
| 34 | CPU never throws an interceptable pass | not verified | **fix as** §5.3 probabilistic interceptions + §10.7 risk-based selection (hard reject removed); S6 and band 2–6 % |
| 35 | rematch keeps absolute AI timers | not verified | **fix as** §10.1 countdown timers + `resetAI` in start/rematch/quit (also `p.lastStealAt` removed); S11 |
| 36 | halftime handler double-fires (dup of 21) | not verified | **fix as** #21 |
| 37 | reset snaps the pose to idle | not verified | **moot in v2 because** the animator never snaps on reset ([ANIM D-ANIM-7], [REV#36] in ANIM numbering); gameplay requirement: `Player.reset()` does not call any pose function and keeps the animator's stance |
| 38 | README rule text mismatch | not verified | **fix as** §13 README rewrite |
| 39 | normal drives blocked 74/74 | not verified | **fix as** §4 + §10.6 jump jitter + R7; S1 bands |
| 40 | instant catch-and-shoot, defence not interactive | not verified | **fix as** #25 fixes + closeouts + auto-switch (R10) |
| 41 | camera hides the last 1.5 m before the half-court line | not verified | **fix as** #2 framing **plus** a backcourt warning: when the human handler is within 1.0 m of `z = 0` and moving toward it, the half-court line paints red (`#ff3b3b`, 0.3 s pulse) and the camera's `z0` eases +0.6 m (camera owner); no auto-clamp (stepping over stays a turnover, v1) |
| 42 | captions lag the action | not verified | **fix as** captions carry `world.time`; skip queued captions older than 2.0 s; a score / possession caption flushes the queue and cuts the current one after 0.6 s |
| 43 | bodies clip under the rim | not verified | **fix as** §2 separation (bodyR sums, +0.10 airborne, 0.95 vs a hanging dunker) |
| 44 | verdict | not verified | accepted: priorities (blocks, catch-and-shoot, framing) are D-GP-4, D-GP-7 and #1/#2/#41 |

---

## 15. Test hooks (`window.__game` additions, `src/main.js`) and test files

All hooks exist in every build (as v1); none allocate per frame.

```js
window.__game = { ...v1,
  version: 'legends-3v3 v2',
  legends: LEGENDS,                                  // frozen data (§1)
  get lineup() { return { a: [...ids], b: [...ids], user: 'a'|'b', kits: 'auto'|'classic', mode: 'classic'|'allstar' }; },
  setLineup({ a, b, user, kits }),                   // validates 3+3 of the six; in a game → restarts with the same options
  setRules({ clear, autoSwitch }),                   // booleans; applies at the next CHECK
  setDifficulty(id),                                 // 'easy'|'normal'|'hard'
  player(id),                                        // { id, team, x, z, yaw, vx, vz, state, jumpY, stamina, hasBall, controlled, attrs, stats }
  place(id, x, z, yaw),                              // teleport by legend id (wraps v1 teleport)
  debugShoot({ shooter?, p?, e?, eT?, kind?, variant? }),   // kind/variant force the resolver; eT seconds wins over e
  debugContest({ shooter?, kind? }) → { C, X, Xraw, defender, parts: { Kd, Kh, Ks }, A },
  debugBlock({ blocker, shooter, kind, contact: true }) → { eligible, pB, blocked },
  debugSteal({ stealer, handler }) → { eligible, pPoke, parts },
  debugShake({ handler, defender, move, combo, committed }) → { pShake, pAnkle, outcome },
  forceAbility(id, opts?) → boolean,                 // stages the trigger conditions (e.g. Jordan sprinting at 4.4 m) and fires it
  abilityLog,                                        // ring of 256 { t, id, player, ctx }
  metrics(),                                         // snapshot, schema below
  resetMetrics(),
  ai(id) → { action, scores: { shoot, drive, move, jab, post, pass, probe }, gates: { setup, catch, iso, patience } },
  bot: { set(mode) },                                // 'off'|'idle'|'avg'|'good'|'drive'|'pullup'
};
```
`metrics()` schema:
```
{ games, gameSeconds,
  possessions: [{ team, liveSec, end: 'MADE'|'TURNOVER'|'OOB'|'SHOT_CLOCK'|'PERIOD'|'CLEAR', points }],
  team: [{ fga, fgm, pa3, pm3, zone: { rim:{a,m}, close:{a,m}, mid:{a,m}, three:{a,m} }, drivesFinished, blk, stl,
           tov: { steal, intercept, oob, shotClock, notCleared }, pts, passes, intercepts, deflects, oreb, dreb, ankles,
           airballs, airballOOB, untouchedMiss, untouchedMissOOB }],
  player: { <id>: { fga, fgm, zone, pa3, moves, jabs, pumpFakes, postTouches, touches, handlerPossessions, assists,
                    catchToPress: number[], releaseSpeed: number[], abilities: { <abilityId>: n } } },
  shots: [{ t, shooter, kind, variant, d, three, eT, X, C, p, make, blockedBy, releaseSpeed, catchToPress, defDist }] }  // ring 2000
```
Headless: `Game` runs in Node with `scene: null` (v1) and `anim: 'proxy'` — sockets from closed-form proxies
(hand = root + facing·0.30 + (0, release height of the current clip phase, 0); ball socket at release = the
`release` table height) so `test/balance.mjs` runs ≥ 50× real time; a browser test asserts proxy vs real socket heights
at release agree within 0.10 m for every legend's mid-range jumper.

Test files (Node unless noted): `test/unit-ratings.mjs` (§2 table), `test/unit-shot.mjs` (rewritten: §3.3 table, timing,
contest examples §3.7, points rule), `test/unit-block.mjs` (§4.3 table, windows, chase-down), `test/unit-steal.mjs`
(§5.1 table, credit rules), `test/unit-abilities.mjs` (§8 hook application and trigger boundaries),
`test/unit-ai.mjs` (updated: matchups §10.5 values, catch gate, guardBeaten, risk filter, countdown timers),
`test/unit-lineup.mjs` (swap/shuffle/reset, kit mode resolution, persistence fallback when localStorage throws),
`test/balance.mjs` (§11.3 bands A–C and §11.5 scenarios; `--quick` = seeds 1–3, q 60 for CI smoke).
`test/acceptance.cjs` (Playwright) changes: A2 denylist (§1.1); A5 score bug reads 暗 / 亮 (zh) or DRK / BRT (en) and
starts from `LINEUP` → 开始; A11 uses `debugShoot({p:1})` from (0, −8.3) → +2 and from (0, −4.8) → +3 (feet at release);
A12 air balls (`eT −0.20`) ≥ 6 of 10 + `cap.airball`, ≤ 2 of 10 end OOB; A13 thresholds become formula-derived
(`≥ mean − 2.5σ` for 40 trials); A15 interception ≥ 9 of 30 (defender 0.3 m off the line); A16 STL only after the
defender's catch; new **A28** lineup flow (open, swap Kobe↔Kyrie, kits switch to All-Star, start, CHECK with WHT/BLK);
**A29** reset → classic kits and DRK/BRT; **A30** touch gestures: quick SHOOT tap → `pumpFake` in `abilityLog`/events,
CROSS double-tap → 2 moves queued, walk into the defender at (2.0, −10.5) → `post`; **A31** `forceAbility` smoke for
all 22 ability ids (each logs once, no invariant break); **A32** `?bot=avg&seed=5&q=0.5` full game ends GAME_OVER with
FG% for both teams in 30–75 % (smoke band); **A33** lineup panel fully visible / scrollable at 740×304 and 851×337 in
zh and en ([REV#7]).

---

## 16. i18n keys added (`src/i18n.js`; `{name}` = short name)

| key | zh | en |
|---|---|---|
| `menu.lineup` | 阵容 | Lineup |
| `lineup.title` | 选择阵容 | Choose Lineups |
| `lineup.you` | 我方 | YOU |
| `lineup.kits` / `lineup.kitsAuto` / `lineup.kitsClassic` | 球衣 / 自动 / 经典 | Kits / Auto / Classic |
| `lineup.shuffle` / `lineup.reset` / `lineup.start` | 随机 / 重置 / 开始 | Shuffle / Reset / Start |
| `lineup.handler` | 持球核心 | Ball handler |
| `lineup.swapHint` | 依次点两名球员即可交换 | Tap two players to swap them |
| `lineup.clash` | 经典球衣可能撞色 | Classic kits may clash |
| `team.dark` / `team.bright` / `team.white` / `team.black` | 暗夜队 / 烈阳队 / 白队 / 黑队 | Team Dark / Team Bright / Team White / Team Black |
| `rules.clear` | 清球规则（3x3） | Clear-the-ball (3x3) |
| `rules.autoSwitch` | 防守自动换人 | Auto-switch on defence |
| `stat.speed` … `stat.rebound` | 速度 力量 弹跳 控球 近投 中投 三分 扣篮 上篮 传球 外线防守 内线防守 盖帽 抢断 篮板 | Speed Strength Vertical Handles Close Mid-range Three Dunk Layup Passing Perimeter D Interior D Block Steal Rebound |
| `cap.ankle` | {name} 晃倒了对手！ | {name} broke his ankles! |
| `cap.chaseDown` | {name} 追身大帽！ | {name} chase-down block! |
| `cap.rimOut` | {name} 扣篮砸框弹出 | {name}'s dunk rims out |
| `cap.clear` | 清球！ | Clear it! |
| `cap.notCleared` | 未清球，进球无效 | Not cleared — no basket |
| `cap.ab.jordan.ftDunk` | {name} 罚球线起跳扣篮！ | {name} from the free-throw line! |
| `cap.ab.jordan.fade` | {name} 后仰跳投 | {name} fadeaway |
| `cap.ab.kobe.postFade` | {name} 转身后仰 | {name} turnaround fade |
| `cap.ab.kobe.jab` | {name} 试探步急停跳投 | {name} jab-step jumper |
| `cap.ab.lebron.powerDrive` | {name} 强起撞开防守 | {name} powers through |
| `cap.ab.lebron.skipPass` | {name} 单手跨场传球 | {name} skip pass |
| `cap.ab.giannis.euro` | {name} 欧洲步 | {name} euro step |
| `cap.ab.giannis.longDunk` | {name} 长距离起跳扣篮 | {name} long-stride slam |
| `cap.ab.yao.hook` | {name} 勾手 | {name} jump hook |
| `cap.ab.yao.dropStep` | {name} 沉步转身 | {name} drop step |
| `cap.ab.kyrie.combo` | {name} 连续变向 | {name} crossover combo |
| `cap.ab.kyrie.stepback` | {name} 后撤步 | {name} step-back |
| `cap.ab.kyrie.finisher` | {name} 拉杆上篮 | {name} acrobatic finish |
| `meter.three` | 3 | 3 |
| `tip.pumpFake` / `tip.combo` / `tip.post` / `tip.fade` / `tip.block` | §9.5 | §9.5 |

Player names live in `legends.js` (§1.2), not in i18n.js [DEC].

---

## 17. Interfaces with the sibling sections (what gameplay consumes / overrides)

- From ANIMATION: events `gather`, `plantL/R`, `takeoff`, `set`, `release`, `land`, `swipe`, `slam`, `rimGrab`,
  `rimRelease`, `fake`, `contact`, `end`, `cancel`; `getTiming(playerId, kind, variant) → { tIdeal, takeoffT, h, rva }`
  (§5.2 tables) and `getLayupTiming`; `animator.ballHand`; socket queries in the fixed step (D-ANIM-3); clip ids listed
  in §8. New clips gameplay needs: `hit.bump`, `hit.ankle` (fall 0.50 / ground 0.80 / get-up 0.30 s), `hit.shake`
  (0.40 s), `def.handsUp` (upper layer), `def.chaseBlock`, `def.wall`, `pass.skip1h`, `dunk.ftLine`, `dunk.longGather`,
  `post.faceUp` (0.35 s).
- Overrides of ANIMATION suggestions: points at **release** (not takeoff, D-GP-5); block contact radius 0.30 m around
  the hand socket (not 0.14 + ball r; both shooter and blocker use rig sockets, so the 22–26 cm rig-reach deficit
  cancels); move penalty on takeoff speed (adopted); 0.30 s catch `ready` (adopted, gameplay gate 0.40 s); steal at
  `swipe` 0.12 s (adopted); pass release = `passRelease` (§2) within ANIM's 0.10–0.27 s; separation 0.95 m vs a hanging
  dunker (adopted); freeze multipliers of [ANIM §4.3] adopted as `moveMul` (§7.1).
- From CHARACTERS: kit modes `classic` / `allstarA` / `allstarB` via `c.setKit()`; gameplay decides the mode (§12.5).
- Performance: AI utility evaluation ≤ 0.25 ms per handler tick and ≤ 0.6 ms per step for all AI on an iPhone 11-class
  CPU; zero allocations per step in `ai.js`, `shot.js`, `abilities.js`, `context.js` (module scratch objects, v1 rule).
