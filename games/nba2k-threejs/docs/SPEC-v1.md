# HOOP ARENA 3x3 (街头篮球场 3x3) — FINAL IMPLEMENTATION SPEC

Authoritative, single-document spec for a 2K-style 3v3 half-court basketball game in three.js.
The implementer reads only this file. Every number here is binding; anything not covered is the
implementer's choice but must stay inside the hard constraints in §0.

Answer to the user's question "can this phone play it directly?": **yes**. It is a static page. Open
`index.html` from any static host (or the artifact URL) in Safari/Chrome on the phone, tap 开始比赛 (this
also unlocks audio), rotate to landscape for the best layout; portrait also works. No install, no build.

---

## 0. Hard constraints (non-negotiable)

- Plain static site under `games/nba2k-threejs/`: `index.html`, `css/style.css`, `src/*.js`, `vendor/three.module.js`, `README.md`.
  No build step, no bundler, no npm for end users, no import map, no bare specifiers, no top-level `await`,
  no `<base>` tag, no `document.currentScript`, no service worker.
- **three.js is vendored at `games/nba2k-threejs/vendor/three.module.js` — r186, single-file ESM (verified in the repo,
  742 KB, MIT licence beside it as `vendor/LICENSE.three.txt`).** Every `src/*.js` imports it exactly as
  `import * as THREE from '../vendor/three.module.js';`. No addons. r186 facts to obey: `renderer.outputColorSpace = THREE.SRGBColorSpace`
  (not `outputEncoding`), `texture.colorSpace = THREE.SRGBColorSpace` for colour textures, light intensities are
  physical-ish (Hemisphere ~0.9–1.2, Directional ~1.5–2.0), `CapsuleGeometry` exists (allowed), `MeshLambertMaterial` exists.
- No external assets of any kind (no textures, models, audio files, web fonts). Everything procedural.
- Target 60 fps, floor 30 fps on iPhone 11 / 2021 mid-range Android: DPR cap, **blob shadows only (no shadow maps)**,
  ≤ 110 draw calls, ≤ 40k triangles, no post-processing, no tone mapping.
- Mobile: `touch-action:none`, no double-tap zoom, no pull-to-refresh, safe-area insets, portrait + landscape,
  resize/orientationchange, iOS audio unlock on first gesture, `100dvh`.
- UI: Simplified Chinese default, English toggle, all strings in one table (`src/i18n.js`). No CJK literals in any other JS file except `src/teams.js`.
- Fictional teams/players only. No NBA/2K team, player, logo or slogan. Total hand-written JS in `src/`: **2500–4000 lines** (`wc -l`).
- All gameplay randomness goes through the seeded RNG in `src/math.js`. `Math.random` must not appear in `src/` (grep-enforced).

---

## 1. Game mode and rules

**Mode:** 3v3 half-court, one hoop, both teams attack the same basket (there is no halftime side flip; see §2).

| Rule | Value |
|---|---|
| Quarters | 4 |
| Quarter length | default **2:00**; menu options 1:00 / 2:00 / 3:00 / 5:00; URL `?q=<minutes>` accepts fractions (e.g. `?q=0.1` = 6 s) |
| Shot clock | **14 s**; reset to 14 on every possession change and on an offensive rebound (any catch by the offence of a free ball after a shot touched rim/board or was blocked); stops during CHECK/DEAD; keeps running while a shot is in flight and is reset by the rebound outcome |
| Scoring | 2 inside, 3 if the shooter's feet at release are outside the 3-pt line (`isThree(x,z)`, §2); dunks and layups = 2 |
| Overtime | if tied after Q4: 1:00 periods until not tied; labelled OT, OT2, … |
| Halftime | after Q2: 3.0 s overlay banner with score (tap/any key skips); possession for Q3 goes to the team that did not get Q1's ball |
| Possession per quarter | Q1 by seeded coin flip; Q2 to the other team; Q3 same as Q2; Q4 same as Q1; each OT alternates from the previous period's opening possession |
| After a made basket | other team gets the ball → CHECK |
| Dead balls → CHECK reset | made basket, defensive rebound (defence catches a free ball), steal/interception, out of bounds, shot-clock violation, resting-ball rescue |
| Out of bounds | a **free** ball whose centre has `x` outside ±7.62+0.30 or `z < −14.325−0.30` or `z > 0` (half-court line = backcourt), or a **held** ball whose holder's feet centre is outside `|x| ≤ 7.62`, `−14.325 ≤ z ≤ 0`. Possession to the team that did not touch it last (`ball.lastToucher.team`). |
| Shot-clock violation | shot clock reaches 0 while the offence holds the ball or the ball is a free ball last touched by the offence and not yet released as a shot → whistle, possession change. A shot released before 0 is valid. |
| Quarter buzzer | game clock 0 → buzzer. If a shot is in flight (released while clock > 0) the period ends when the ball is resolved (score or 0.5 s after it becomes LOOSE). Caption `cap.buzzerBeater` if it goes in. |
| Kept violations | shot clock, out of bounds/backcourt |
| Dropped (see §16) | travelling, double dribble, 3-seconds, fouls/free throws, goaltending, jump ball, clear-the-ball rule |
| Rebounds | live: a free ball can be caught by anyone (§5.8). Defensive catch → DEAD(TURNOVER) → CHECK. Offensive catch → play on, shot clock 14. |
| Box score (per player) | PTS, FGM, FGA, 3PM, REB, STL, BLK. A defensive catch of a blocked/loose ball counts as REB; a steal/interception counts as STL for the catcher. |

A full game at 2:00 quarters takes about 7–9 real minutes.

---

## 2. Coordinate system and court constants (`src/constants.js`)

Units are metres. **Y is up. X is court width (sideline to sideline). Z is court length.** The origin is the centre
of the full court (mid-point of the half-court line). The playable half is `z ∈ [−14.325, 0]`; the hoop is at negative Z
(far from the camera); the camera sits at positive Z behind the half-court line looking toward −Z. Screen-up ≈ −Z (toward the hoop),
screen-right = +X. Because there is one hoop, **nothing flips at halftime**; possession alternation replaces the side change.

```js
export const COURT = {
  HALF_W: 7.62,            // x in [-7.62, 7.62]
  BASELINE_Z: -14.325,     // baseline
  MID_Z: 0,                // half-court line (backcourt boundary)
  OOB_MARGIN: 0.30,        // free-ball tolerance beyond lines (x and baseline only)
  APRON: 2.0,              // painted dark apron around the court, no gameplay effect
  // texture plane covers x [-9.62, 9.62], z [-16.325, 1.0]  (19.24 x 17.325 m) -> 1024x1024 canvas
};
export const RIM = { x: 0, y: 3.048, z: -12.75, r: 0.2286, tube: 0.012, collideTube: 0.02 };
export const BOARD = {                    // AABB, front face faces +z (toward the court)
  min: { x: -0.915, y: 2.90, z: -13.145 },
  max: { x:  0.915, y: 3.97, z: -13.105 },
};
export const LINES = {
  THREE_R: 7.24,           // arc radius about (RIM.x, RIM.z)
  CORNER_X: 6.71,          // corner straights at |x| = 6.71 ...
  CORNER_Z_END: -10.03,    // ... from the baseline up to z = -10.03 where they meet the arc (sqrt(7.24^2-6.71^2)=2.72)
  ARC_TOP_Z: -5.51,        // rim z + 7.24
  KEY_HALF_W: 2.44, FT_Z: -8.535, FT_CIRCLE_R: 1.8, RESTRICTED_R: 1.22, CENTER_R: 1.8, LINE_W: 0.05,
};
export const BALL = { R: 0.12, REST_FLOOR: 0.75, FRICTION_FLOOR: 0.85, REST_RIM: 0.55, REST_BOARD: 0.60, G: 9.81 };
export const FIXED_DT = 1 / 60;
```

`isThree(x, z)`: `if (z <= LINES.CORNER_Z_END) return Math.abs(x) >= LINES.CORNER_X; return Math.hypot(x - RIM.x, z - RIM.z) >= LINES.THREE_R;`

Spacing slots (`SLOTS`, world coords): `top (0, −4.9)`, `leftWing (−5.4, −7.6)`, `rightWing (5.4, −7.6)`, `leftCorner (−7.0, −13.3)`, `rightCorner (7.0, −13.3)`. All are ≥ 7.3 m from the rim (3-pt spots).

CHECK formation: handler `(0, −4.6)` facing −Z; teammates at `leftWing`, `rightWing`. Defenders at `lerp(attacker, rimXZ, 0.18)` facing +Z.

Court canvas mapping (1024×1024 over the plane above, `PlaneGeometry(19.24, 17.325)` rotated `−π/2` about X, centred at `(0, 0, −7.6625)`, `CanvasTexture` default `flipY=true`):
`px = (x + 9.62) / 19.24 * 1024`, `py = (z + 16.325) / 17.325 * 1024` (canvas row 0 = far baseline side). Verify once by drawing the
centre logo at world `(0,0)` → `px=512, py=965`.

---

## 3. Controls

### 3.1 Shared Intent object (`src/input.js` → `makeIntent()`)

```js
{
  move: { x: 0, z: 0, mag: 0 },        // world-space direction, |(x,z)| <= 1; screen-up => z = -1 (toward hoop), screen-right => x = +1
  sprint: false,
  primary:   { held:false, justPressed:false, justReleased:false, heldTime:0, pressTs:0, releaseTs:0 }, // Shoot | Block
  secondary: { held:false, justPressed:false, justReleased:false, heldTime:0, pressTs:0, releaseTs:0 }, // Pass  | Switch
  tertiary:  { held:false, justPressed:false, justReleased:false, heldTime:0, pressTs:0, releaseTs:0 }, // Cross | Steal
  pause: { justPressed:false },
}
```

`pressTs/releaseTs` are `performance.now()` values captured **in the DOM event handler** (the shot meter is evaluated from these,
never from frame counts). DOM handlers set latch flags; `Input.sample()` is called once per fixed step: it turns latches into
`justPressed/justReleased` (a press and release inside one step yields both true in that step), updates `heldTime`, and clears latches.
AI writes into an identical object per CPU player, so `Player.step` has one code path.

### 3.2 Touch layout (CSS px, Pointer Events only)

General: `pointerdown` handlers call `preventDefault()`; `Map<pointerId, control>`; `setPointerCapture` on buttons; `pointercancel` and
`lostpointercapture` = release; pressed CSS class toggled in the `pointerdown` handler (never `:active`). The overlay `#hud` has
`pointer-events:none`; only control elements and menus have `pointer-events:auto`.

**Joystick zone** `#stickZone`: left **45%** of the viewport width, from `72px` below the top (under the score bug) to the bottom, in
landscape. In portrait: left 50% width, bottom 45% of height. Floating, tethered:
- On `pointerdown` in the zone with no owner: ring (120 px diameter, knob 52 px) appears at the touch point, clamped so the ring centre is
  ≥ 24 px from any viewport edge (iOS/Android edge-swipe safety) and inside the zone.
- `intent.move.x = dx/56`, `intent.move.z = dy/56` (dy positive = screen-down = +Z, away from the hoop), clamped to |v| ≤ 1; dead zone 0.15
  (remapped so 0.15→0, 1→1); `mag = |v|`.
- If the finger goes beyond 56 px the ring centre follows (tethered) so long strafes never drop input.
- A second finger in the zone while owned is ignored. `pointerup/cancel` of the owner → move = 0, ring hidden.

**Right cluster** `#cluster`: `position:absolute; right: calc(16px + env(safe-area-inset-right)); bottom: calc(16px + env(safe-area-inset-bottom)); width:156px; height:228px;`
Children positioned from the cluster's bottom-left (x→right, y→up):

| id | role | size | x | y |
|---|---|---|---|---|
| `#btnSprint` | Sprint (both roles) | 132×56 pad | 12–144 | 0–56 |
| `#btnSecondary` | 传球 Pass / 换人 Switch | 72 circle | 0–72 | 68–140 |
| `#btnTertiary` | 变向 Cross / 抢断 Steal | 72 circle | 84–156 | 68–140 |
| `#btnPrimary` | 投篮 Shoot / 盖帽 Block | 72 circle | 42–114 | 152–224 |

Slide-over: while any cluster pointer is held, `pointermove` entering another cluster button (hit-test by `elementFromPoint`) releases the
old one and presses the new one (sprint → shoot with one thumb). Each button's label = icon glyph (`●`,`➜`,`⇄`,`»`) + i18n text; class
`.offense` (orange `#ff7a1f`) or `.defense` (blue `#2f8cff`) on `#cluster`, re-applied on possession change by `Input.setOffense(bool)`.
Pause button `#btnPause`: 44×44, `top: calc(8px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right))`. All targets ≥ 44 px.
Sizes are identical in portrait (thumbs do not shrink). Cluster and joystick zone never overlap (`45vw + 172px ≤ 100vw` for widths ≥ 320 px;
at < 400 px width the joystick zone is `calc(100vw − 190px)`).

Hold-to-shoot: `primary.held` starts the meter; `primary.justReleased` fires. Pass/Cross/Switch/Steal are taps (`justPressed`).
Sprint = `held`. Context (offence/defence) is decided by `game.userIsOffense()` each step.

### 3.3 Keyboard map

| Key | Action |
|---|---|
| W/A/S/D, arrows | move (8-way, normalised; W = z −1 toward hoop) |
| Shift (hold) | sprint |
| Space or J | primary (hold/release shoot; block on defence) |
| K | secondary (pass / switch) |
| L | tertiary (crossover / steal) |
| P or Esc | pause / resume |
| M | mute toggle |
| T | language toggle |
| Enter | confirm focused menu button |

---

## 4. Shot mechanic (`src/shot.js`)

### 4.1 Classification at press (`classifyShot(player)`)
`d = hypot(x−RIM.x, z−RIM.z)` from the shooter's feet.
- `dunk` if `d ≤ 2.2` **and** `player.sprintedRecently` (sprint was held within the last 0.30 s) **and** `player.dunk ≥ 0.6` **and** no defender within 1.2 m of the segment player→rim.
- `layup` if `d ≤ 2.2` otherwise.
- `three` if `isThree(x, z)`; else `jumper`.

### 4.2 Meter
Press starts the jump (§5.10) and the meter. `METER_T = 0.55 s` (jumper/three), `0.40 s` (layup). Fill fraction
`f = clamp((releaseTs − pressTs)/1000 / METER_T, 0, 1.25)`; auto-release at `f = 1.25` (very late). Ideal `F_IDEAL = 0.80`.
Timing error `e = f − 0.80`. Green half-width `g` = **0.07 / 0.06 / 0.05** (easy/normal/hard, human only); layups use `g + 0.04`.
CPU shooters draw `e ~ N(0, σ)`, σ = **0.14 / 0.10 / 0.06**. The DOM meter shows a bar filling over METER_T with the green band at `[0.80−g, 0.80+g]`
and a result flash: 完美/稍早/稍晚 (`meter.perfect / meter.early / meter.late`) for 0.6 s.

### 4.3 Make probability
```
base(d): d<=1.5 → 0.92 ; 1.5–4 → lerp(0.85→0.62) ; 4–6.75 → lerp(0.62→0.50) ; 6.75–8 → lerp(0.50→0.40) ; d>8 → max(0.10, 0.40 − 0.08*(d−8))
timing(e): |e|<=g → 1.60 ; g<|e|<=0.30 → lerp(1.60→0.30 over |e| from g to 0.30) ; |e|>0.30 → 0.20
contest: defender = nearest opponent with dot(normalize(def−shooter), normalize(rim−shooter)) > 0.3 (in front) ; dd = its distance
         C = dd>=2.0 → 1.0 ; dd<=0.5 → 0.45 ; lerp between. If that defender isJumping: C *= 0.8. No defender → 1.0
fatigue: stamina < 0.30 → 0.90 else 1.0
move:    horizontal speed at release > 2.5 m/s → 0.85 (not applied to layup/dunk)
rating:  shooter.shooting (0.90–1.10)
p = clamp(base * timing * C * fatigue * move * rating, 0.02, 0.97) ; dunk → p = 1.0 ; layup uses base(d) with d clamped ≥ 1.0
```
Roll once at release with `rng.next() < p`. `debugShoot({p, e})` overrides `p` and/or `e`.
Sanity values: 4.5 m, green, open → 0.598·1.6 = 0.96 → 0.96. 7.3 m green open → 0.46·1.6 = 0.74. 4.5 m, e = −0.35 → 0.12.

### 4.4 Target selection (`chooseTarget(make, e, C, shooterXZ)`)
`fwd = normalize(rimXZ − shooterXZ)` (2D), `side = perp(fwd)`.
- MAKE: `target = RIM + disc(0.05)` (uniform disc of radius 0.05 m in xz), `y = RIM.y`.
- MISS, early (e < 0): short → `target = RIM − fwd*(RIM.r + BALL.R*(0.3 + 0.8*rng))`; if `e < −0.32` → `RIM − fwd*0.45` (air ball, front rim usually missed; crowd groan).
- MISS, late (e ≥ 0): long → `target = RIM + fwd*(RIM.r + BALL.R*(0.3 + 0.6*rng))` (back rim / board).
- MISS side error added to both: `side * (0.05 + 0.25*(1 − C)) * rng.range(−1, 1)`.
- MISS when `make` rolled false but `|e| ≤ g` (green miss): treat as late with rng sign.
- Layup MISS: `target = RIM − fwd*(RIM.r + BALL.R*0.6)` (front rim). Layup MAKE: `RIM + disc(0.04)`.

### 4.5 Arc solver (`physics.solveArc(from, to, apexAbove, g, out)`)
```
apexY = max(from.y, to.y) + apexAbove ; vy0 = sqrt(2 g (apexY − from.y)) ; tUp = vy0/g ; tDown = sqrt(2 (apexY − to.y)/g) ; T = tUp + tDown
vx = (to.x−from.x)/T ; vz = (to.z−from.z)/T ; out = {vx, vy: vy0, vz, T}
apexAbove(d): d<2 → 1.0 ; d<5 → 1.6 ; d<7.5 → 2.1 ; else 2.6
```
Release point = shooting hand world position at release (`humanoid.handWorld`), ≈ feet + `(fwd*0.25, 2.05 + jumpY)`.
`ball.shotInfo = {shooter, releaseTime, points: isThree ? 3 : 2, kind}` stored at release; scoring uses it.

### 4.6 Dunk (scripted, no ball physics)
Duration 0.55 s. Player tweens from its position to `RIM − fwd*0.55` (xz) while `jumpY = 0.9*sin(π t/0.55)`; ball follows the two raised hands; at
`t = 0.42` the ball teleports to `(RIM.x, RIM.y − 0.05, RIM.z)`, `v = (0, −4, 0)`, state `scored`, score awarded, `audio.dunk()`, crowd 1.0.

### 4.7 Block
A defender in `jumping` with hand point `H = feet + facing*0.35 + (0, 2.55 + jumpY, 0)`. If `ball.state === 'flight'`, `releaseAge < 0.35 s`, and
`|ball.pos − H| < 0.40`: `v = (−0.3 vx, 2.5 + 1.5*rng, −0.3 vz)`, state `loose`, `lastToucher = blocker`, `blocker.stats.blk++`, caption `cap.block`, `audio.block()`.

---

## 5. Ball physics (`src/physics.js` pure functions, `src/ball.js` entity)

5.1 **Integration**: fixed `dt = 1/60`, semi-implicit Euler: `v.y −= G dt; v *= (1 − 0.02 dt); p += v dt`. When `hypot(p−RIM) < 1.2` the free step runs as two half-steps (each with full collision pass).

5.2 **Floor**: if `p.y < R && v.y < 0`: `p.y = R; v.y = −v.y*0.75; v.xz *= 0.85; emit bounce(|v.y|)`. If after that `|v.y| < 0.6` → `v.y = 0`, rolling: `v.xz *= (1 − 2.5 dt)`; `|v| < 0.3` → `v = 0` (resting). Rate-limit bounce SFX to 1 per 80 ms.

5.3 **Rim (sphere vs torus)**: `q = p − RIM; d = (q.x, 0, q.z); if |d| < 1e-4 skip; ring = normalize(d)*RIM.r; n = q − ring; dist = |n|;`
`if dist < R + collideTube: n /= dist; p = RIM + ring + n*(R + collideTube); vn = dot(v,n); if vn < 0: v −= (1+0.55) vn n; tangential *= 0.92; v *= (1 + rng.range(−0.05, 0.05)); rimContacts++; emit rim(|vn|)`.
If `rimContacts > 4` in one flight: `v.xz = normalize(d)*2.0; v.y = max(v.y, 0.5)`; rim collision off for the rest of that flight.

5.4 **Backboard (sphere vs AABB)**: `c = clamp(p, BOARD.min, BOARD.max); n = p − c; if |n| < R: n = |n|>1e-4 ? n/|n| : (0,0,1); p = c + n*R; vn = dot(v,n); if vn<0: v −= 1.6 vn n; tangential *= 0.90; emit board(|vn|)`.
No collision with pole, stands or players.

5.5 **Made-basket detector** (every step while state is `flight` or `loose`): `prev.y > RIM.y && p.y <= RIM.y && v.y < 0 && hypot(p.x−RIM.x, p.z−RIM.z) < RIM.r − 0.6 R (=0.157)` → emit `score(shotInfo.points, shooter)`; state `scored`: rim/board collision disabled 0.5 s, `v *= 0.35` (net drag), net wobble, catch disabled; after 0.5 s becomes `loose` (already DEAD so nobody catches). Points always from `shotInfo` (a tipped-in loose ball scores 2 for `lastToucher`).

5.6 **States**: `held` (kinematic, chest 1.3 m, 0.35 s after a catch or during windup at the shooting hand), `dribble` (kinematic bounce), `flight` (shot), `pass`, `loose`, `scored`. `held/dribble` have `owner`; free states have `lastToucher`.

5.7 **Dribble animation** (owner moving `mag > 0.1`): hand offset from feet `= right*0.32*handSign + fwd*0.20`; `y = R + 0.80*|sin(π φ)|`, `φ += f dt`, `f = 2.2 Hz` (run), `2.8` (sprint), stationary `f = 1.8, amplitude 0.65`. `audio.bounce(0.5)` at each `φ` wrap. `handSign` flips on crossover. Low-bounce window = `ballY < 0.45` (steal bonus).

5.8 **Catch**: for each player without the ball, if ball state ∈ {`pass`,`loose`} or (`flight` and `releaseAge > 0.3`), `distXZ(player, ball) < 0.55` (0.80 if `passInfo.receiver === player`), `0.15 ≤ ball.y ≤ 2.3 + jumpY`, `|v| < 14`, and ball is not the player's own shot with `releaseAge < 0.3`: nearest qualifying player catches → `held`. Offence catching own missed shot → REB, shot clock 14. Defence catching → STL if state was `pass`, REB otherwise → DEAD(TURNOVER). Interception uses this same test (no separate deflection system).

5.9 **Passes** (`Game.pass(from, to, lob)`): chest pass: `solveArc(hand, receiverChest(1.3 m) + receiverVel*0.25, 0.25)` then if `T > dist/12` scale so `T = max(dist/12, 0.30)` (recompute `vy` for that T: `vy = (Δy + 0.5 g T²)/T`). Lob (`secondary.heldTime ≥ 0.30 s` on release, or auto when a defender is within 0.8 m of the pass line **and** the receiver is cutting): `apexAbove = 1.8`. Bounce passes are not implemented. `passInfo = {receiver, from}`; user control transfers to the receiver on catch.

5.10 **Player kinematics** (`src/player.js`): 2D kinematic circles r 0.40. `desired = move * maxSpeed`; `maxSpeed = 5.2 * clamp(mag,0,1)` (mag < 0.5 walks), `×1.35` sprinting (7.0), `×0.92` while holding the ball. `v += clamp(desired − v, accel*dt)` with `accel = 24` (16 when `desired = 0`). Yaw turns toward velocity (or the hoop when stationary on offence) at 12 rad/s. Separation: for each pair with `dist < 0.80`, push each apart by half the overlap. AI clamped to `|x| ≤ 7.4, −14.1 ≤ z ≤ −0.3`; the human handler is **not** clamped (stepping out = OOB). Jump: `jumpY = h sin(π t/0.55)`, `h = 0.55` (shot) / `0.75` (block, rebound), no air control, 0.55 s. Stamina: 0..1, sprinting drains `1/4 s`, refills `1/6 s` when not sprinting; when it hits 0 sprint is disabled until it refills to 0.25.

5.11 **Steal**: human tap: requires `distXZ(def, handler) < 1.1`, handler in `dribble` and not in crossover immunity; `pSteal = 0.22 + (ballY < 0.45 ? 0.20 : 0) + (handler speed < 0.5 ? 0.15 : 0)`; success → ball `loose` with `v = normalize(def − handler)*2 + (0,1.5,0)`, then caught by the catch rule (usually the stealer); failure → stealer `stunned` 0.35 s (no movement). Cooldown 0.7 s. CPU: attempts at most every 1.5 s when within 1.0 m, `pSteal = stealRate` (§7 table) × the same bonuses, same stun on failure.

5.12 **Crossover** (`tertiary` on offence): 0.35 s lateral burst at 7.5 m/s in direction `−sign(dot(side, defender − handler)) * side` (away from the on-ball defender; joystick side if no defender within 1.5 m); `handSign` flips; steal immunity during the burst; cooldown 0.9 s. A defender within 1.0 m is frozen (`stunned`) 0.40 s with probability 0.55 (human's crossover). CPU crossover freezes the human with probability `crossFreeze` (§7).

5.13 **Rescue rules**: a free ball resting (`|v| < 0.2`) for 1.5 s untouched → DEAD(OOB rules: possession to non-last-toucher). NaN guard: if any ball coordinate is not finite → reset to the handler's hand / CHECK.

5.14 **Landing prediction** (`predictLanding(ball, targetY=1.8)`): closed form of the current parabola ignoring collisions: time to reach `y = 1.8` on the descending branch; returns `{x, z, t}` or null. Recomputed every 0.1 s while the ball is free.

---

## 6. Player model (`src/humanoid.js`)

11 meshes per player from **shared geometries** (built once), `MeshLambertMaterial` only, 2 materials per team (jersey, shorts) + 2 shared (skin `#c68642`, shoe `#222`):

| part | geometry (w×h×d) | pivot (local origin) | material |
|---|---|---|---|
| shorts | Box 0.40×0.30×0.24 | hips at y 0.95 | shorts |
| torso | Box 0.42×0.52×0.24 | bottom at hips (0.95→1.47) | jersey |
| head | Sphere r 0.12 (8×6) | centre y 1.72 | skin |
| upperArm L/R | Box 0.10×0.30×0.10 | shoulder (±0.27, 1.42), hangs down | jersey (sleeve) |
| forearm L/R | Box 0.09×0.30×0.09 | elbow = end of upper arm | skin |
| leg L/R | Box 0.14×0.85×0.14 | hip (±0.11, 0.95), hangs down (no knee) | skin (top 30 % hidden by shorts) |
| shoe L/R | Box 0.14×0.08×0.26 | at leg end, offset +0.05 forward | shoe |

Hierarchy: `group(feet at floor, yaw)` → `pelvis(y = 0.95 + jumpY + bob)` → {shorts, torso → head, arm pivots}, legs are children of `pelvis`. Total ≈ 1.84 m tall; the rim is 3.05 m so a standing reach with hand ≈ 2.05 + jump 0.75 = 2.8 m (blocks use the hand point in §4.7).
Jersey number canvas texture: **not implemented** (cut). Skin tone: one of 3 hex values by player index.

Blob shadow: shared `PlaneGeometry(0.9, 0.9)` with a 64² radial-gradient canvas texture (black→transparent), `transparent, depthWrite:false, opacity 0.45`, at `y = 0.01`, scale `1 − 0.4*clamp(jumpY/0.9)`. Ball shadow same texture scaled 0.35, opacity fades with height (`0.5 → 0.15` from 0 to 4 m).
Controlled-player marker: `ConeGeometry(0.15, 0.3, 6)` pointing down at head + 0.35 m bobbing ±0.05 at 2 Hz, team colour; floor ring `RingGeometry(0.45, 0.55, 24)` team colour, opacity 0.8.

### 6.1 Pose functions (`setPose(h, pose, params)`), radians; `φ` = anim phase; `s` = horizontal speed
- **idle**: arms 0.1 out, torso sway `sin(t*1.5)*0.03`; legs straight.
- **run** (s > 0.3): `φ += s*1.9 dt` (rad; ≈1.6 strides/s at run speed); `A = 0.35 + 0.05 s`; legL.rotX = `A sin φ`, legR = `−A sin φ`; upperArmL.rotX = `−0.8 A sin φ`, R opposite; forearms rotX `−0.6`; bob `= 0.04 |sin φ|`; torso lean forward `0.05 + 0.02 s`.
- **dribble** (run/idle with ball): the dribbling arm (side = `handSign`) upperArm.rotX = `−0.4`, forearm.rotX = `−0.3 − 0.9*(1 − clamp((ballY−0.12)/0.8))`; other arm as run.
- **windup/shoot**: both upperArms.rotX = `−2.4` (raised), forearms rotX = `−1.2 + 1.2*f` (extend as the meter fills); at release forearms snap to `0` (follow-through) for 0.25 s; legs tuck `0.3` while `jumpY > 0`.
- **layup**: one arm fully up (`−2.9`), other `−1.2`; legs asymmetric (`+0.6/−0.4`).
- **dunk**: both arms `−3.0`, torso lean `0.15`, legs tucked `0.6`.
- **defend** (defensive stance, when on defence and s < 2): pelvis y `0.85` (knees "bent" via lowered pelvis + legs splayed rotZ ±0.25), torso lean `0.25`, arms out rotZ ±1.2, rotX `−0.5`.
- **jump/block**: arms `−3.0` straight up, legs tucked `0.4`.
- **steal reach**: dribbling-side arm rotX `−1.4` toward the target, torso lean 0.35 for 0.3 s.
- **stunned**: torso lean back `−0.2`, arms `0.3` outward.
- **celebrate** (0.8 s after own make): both arms `−2.8`, small hop `0.15 sin(π t/0.4)`.
Pose is evaluated once per rendered frame (not per step) from interpolated state.

---

## 7. AI (`src/ai.js`)

Decision tick per CPU player every **0.10 s**, staggered by `index * (1/60)`; steering (writing `intent.move/sprint`) every step. Reaction delay is implemented by reading the opponent's position from a ring buffer of the last 30 steps (0.5 s) at `reactionDelay` back.

| Difficulty | reaction s | cpuSigma | userGreen ± | stealRate | defGap m | help | shootOpen m | sprintProb | crossFreeze |
|---|---|---|---|---|---|---|---|---|---|
| easy 简单 | 0.40 | 0.14 | 0.07 | 0.10 | 1.7 | 0.3 | 1.9 | 0.3 | 0.35 |
| normal 普通 (default) | 0.26 | 0.10 | 0.06 | 0.18 | 1.3 | 0.6 | 1.5 | 0.6 | 0.55 |
| hard 困难 | 0.14 | 0.06 | 0.05 | 0.28 | 1.0 | 0.9 | 1.2 | 0.9 | 0.70 |

Human shooting is not scaled except the green window. The CPU never exceeds human speed limits.

### 7.1 Offence — CPU ball handler (utility with hysteresis, re-evaluated per tick; a chosen action persists ≥ 0.4 s unless the shot clock < 3)
- `openness = distance to nearest defender in front (dot > 0.3)`; `laneClear = no defender within 1.3 m of the segment handler→rim over the next 3 m`.
- **SETUP** (first 0.8 s after CHECK): hold, face the rim.
- **PROBE** (default): dribble laterally along the arc toward the side with more space at run speed; crossover (`tertiary`) with cooldown when the on-ball defender is within 0.9 m (prob 0.5 per tick).
- **DRIVE**: score `= laneClear ? 0.6 + 0.05*(d−2) : 0`; +0.2 if defender > 1.8 m. Sprint with `sprintProb`. At `d ≤ 1.8` → layup/dunk (dunk if `dunk ≥ 0.6`, sprinted, lane clear).
- **SHOOT**: score `= (openness ≥ shootOpen ? 0.5 : 0) + (d ≤ range ? 0.2 : −0.5) + (shotClock < 6 ? 0.3 : 0) + 0.15*(shooting − 1)*10`; `range = 7.6` if `shooting ≥ 1.0` else `6.2`. Release timing `e ~ N(0, cpuSigma)`; the CPU holds the meter for `(0.80 + e)*METER_T` seconds.
- **PASS**: for each teammate `t`: `score_t = 1.2*openness_t + (t.cutting ? 0.5 : 0) − (laneBlocked(handler,t) ? 0.6 : 0) − 0.08*dist(handler,t)`; pass if `max score_t > own openness + 0.6`. Lob if the receiver is cutting and the lane is blocked at floor height.
- **RESET**: if a defender is within 0.7 m and shot clock > 8: dribble back out to ≥ 7.5 m.
- Shot clock < 3 → SHOOT regardless. Shot clock < 1 → shoot immediately.

### 7.2 Offence — off-ball (CPU and the human's teammates)
Each off-ball player owns one of the 5 `SLOTS` (nearest unoccupied at possession start, excluding the handler's zone; keep ≥ 2.5 m from teammates). Behaviour: ARRIVE at slot (run speed) → if the handler drives toward my side, RELOCATE to the next slot away → every `rng.range(4, 7)` s CUT toward `RIM − fwd*1.2` for 1.4 s (flag `cutting`) if my defender is > 1.6 m away and the lane is empty, then return to a slot. After a teammate's shot, everyone within 4.5 m of the rim goes to the predicted landing point (§5.14) and jumps (`primary`) when the ball is below 3.2 m and within 1.0 m. Human teammates never shoot unless they hold the ball with shot clock < 3; otherwise they pass back to the user's player within 0.6 s of catching (the user's control then follows the ball).

### 7.3 Defence (all non-controlled defenders)
- Assignment: at possession start match by roster index (guard↔guard …); re-run greedy nearest matching whenever two defenders are within 0.8 m of the same attacker for > 1 s.
- **On-ball**: goal = point on segment attacker→rim at `defGap` from the attacker, using the delayed attacker position; sprint if the attacker sprints. Contest: when my man starts a windup within 1.6 m → `primary` (jump) after `reactionDelay`. Steal per §5.11.
- **Off-ball**: goal = `lerp(attacker, rimXZ, attacker is beyond arc ? 0.35 : 0.20) + toward-ball 0.6 m`.
- **Help**: if the handler is within 3.2 m of the rim and his defender is behind him (`dot(handler→def, handler→rim) < 0`), the nearest off-ball defender rotates to `RIM + fwd_handler*(−1.0)` (1 m in front of the rim on the handler's path) with probability `help` per tick (once decided, stays 1.5 s).
- **Rebound**: same as offence.
- **Loose ball**: everyone within 5 m chases the ball; nearest catch wins.

### 7.4 User control rules
- Offence: the user always controls the ball handler; on a caught pass control moves to the receiver instantly (the passer's intent is dropped).
- Defence: at CHECK the user controls the defender assigned to the handler. `secondary` (Switch) → the defender nearest the ball excluding the current one (cycle by distance rank), 0.25 s cooldown. **No automatic switching mid-possession.**
- Loose ball / rebound: the controlled player stays; if a teammate catches on defence, the game goes DEAD anyway; on offence control moves to the catcher.

---

## 8. Game state machine (`src/game.js`)

States: `MENU`, `CHECK`, `LIVE`, `DEAD(reason)`, `QUARTER_END`, `HALFTIME`, `GAME_OVER`. `paused: boolean` is an overlay flag valid in CHECK/LIVE/DEAD (clocks and sim frozen; menu shown).

| From | Event | To | Notes |
|---|---|---|---|
| MENU | start | CHECK | build teams, coin flip (rng), quarter 1, clocks reset |
| CHECK | 1.2 s elapsed | LIVE | players tween (smoothstep) to formation over the first 0.8 s; ball `held` by handler; caption `cap.check`; shot clock = 14, stopped |
| LIVE | score event | DEAD(MADE, 1.5 s) | +2/+3, caption, crowd swell 1.0, net wobble; possession → other team |
| LIVE | defence catches free ball | DEAD(TURNOVER, 1.0 s) | REB or STL stat |
| LIVE | OOB | DEAD(OOB, 1.2 s) | whistle, caption `cap.oob` |
| LIVE | shot clock 0 | DEAD(SHOT_CLOCK, 1.2 s) | buzzer short, caption `cap.shotClock` |
| LIVE | resting free ball 1.5 s | DEAD(OOB rule) | rescue |
| DEAD | timer | CHECK | if the game clock is 0 → QUARTER_END instead |
| LIVE | game clock 0, ball not in flight | QUARTER_END | buzzer |
| LIVE | game clock 0, ball in flight | (wait) | resolve shot, then QUARTER_END; buzzer-beater caption on make |
| QUARTER_END | 2.5 s | CHECK (next quarter) or HALFTIME (after Q2) or GAME_OVER (after Q4/OT if not tied) or CHECK (OT if tied) | possession per §1 |
| HALFTIME | 3.0 s or tap/key | CHECK (Q3) | overlay shows score |
| GAME_OVER | 再来一局 / 返回主菜单 | CHECK (same settings, new coin flip) / MENU | box score table |
| any (not MENU/GAME_OVER) | pause | paused=true | visibilitychange hidden also pauses (never auto-resumes) |
| paused | resume | same state | 1.0 s countdown overlay before clocks run |

Clocks: game clock decrements only in LIVE; shot clock decrements in LIVE; both display-frozen otherwise. `audio.tick()` on each shot-clock second below 5.
Tip-off is replaced by the coin flip + CHECK (no jump ball).

---

## 9. Camera (`src/camera.js`)

`PerspectiveCamera(fov, aspect, 0.5, 120)`. Fixed yaw (never rotates), elevated behind the offence, looking toward the hoop — 2K's default framing for a half court. All smoothing uses exponential damping in **frame time**: `x += (target − x) * (1 − exp(−rate*dt))`, `rate = 5`.

```
ballX = ball.pos.x (clamped ±7.62), ballZ = ball.pos.z (clamped [-14.3, 0])
landscape (aspect >= 1): fov 44 ; camPos = (0.35*ballX, 8.0, 4.5 + 0.20*(ballZ + 9)) ; lookAt = (0.35*ballX, 1.0, -9.0)
portrait  (aspect <  1): fov 70 ; camPos = (0.80*ballX, 11.0, 8.0)                    ; lookAt = (0.80*ballX, 1.0, -9.0)
paint zoom: if hypot(ballX - RIM.x, ballZ - RIM.z) < 4.5 → fov target −4 (40 / 66), damped at rate 3
CHECK: snapTo(target) with no damping on the first frame after MENU→CHECK
```
`setAspect(aspect)` is called on resize; choose portrait by `aspect < 1`, never by `screen.orientation`. No behind-player camera (cut).

---

## 10. Rendering and performance budget (`src/scene.js`, `src/main.js`)

- Renderer: `new THREE.WebGLRenderer({canvas, antialias: dpr <= 1.5, powerPreference: 'high-performance'})`; `outputColorSpace = SRGBColorSpace`; `toneMapping = NoToneMapping`; `shadowMap.enabled = false`.
- DPR: `dpr = min(devicePixelRatio, isTouch ? 1.5 : 2.0)`. Adaptive: after a 5 s warm-up, if the rolling 2 s average frame time > 24 ms → `dpr = 1.0` (sticky for the session, logged once). `renderer.setSize(w, h, false)`; canvas CSS is `100%/100%`.
- Lights: `HemisphereLight(0xffffff, 0x445566, 1.0)` + `DirectionalLight(0xffffff, 1.6)` at `(6, 14, 10)` (from the camera side), no shadows.
- Scene: `background 0x0b0d14`, no fog. Court plane (1 draw), apron is painted into the same canvas (0 extra draws), hoop = pole (cylinder r 0.06, h 3.9 at `z = −15.3`), arm (box 0.1×0.1×2.2 from pole to board at y 3.4), board (Box 1.83×1.07×0.04, `transparent, opacity 0.35`, white; inner target square painted on a 256² canvas texture), rim (`TorusGeometry(0.2286, 0.012, 8, 24)`, orange `#ff6a1a`), net (`LineSegments`: 8 strands × 4 rings, 0.40 m long tapering to r 0.12, white opacity 0.9) = 5 draws. Stands: 4 stepped `BoxGeometry` blocks, dark grey (4). Crowd: one `InstancedMesh(BoxGeometry(0.4,0.6,0.4), 600)` with `setColorAt` from 6 palette colours (1). 2 banner planes with a 512×128 canvas text "HOOP ARENA 街头篮球场" (2). Ball 1, players 66, blob shadows 7, marker + ring 2. **Total ≈ 90 draws (budget ≤ 110), triangles ≈ 15k (budget ≤ 40k).**
- Textures: court 1024² (sRGB, mipmaps, anisotropy `min(4, max)`), ball 256×128 (orange + black seams), backboard 256², blob 64², banner 512×128. Generated at boot in < 100 ms.
- Net wobble: for 0.6 s after a score, strand vertex `y −= 0.08*sin(π t/0.6)*(1 − k/4)`, radial scale `1 + 0.15*sin(2π t/0.6)`; rewrite the position attribute.
- Crowd bob: for 1.5 s after a score, instance `y += 0.15*|sin(2π t + phase_i)|` via `setMatrixAt` (only during those 1.5 s).
- Frame loop (`main.js`): `frameDt = min((now − last)/1000, 0.1); acc += frameDt; steps = 0; while (acc >= FIXED_DT && steps < 4) { input.sample(); game.step(FIXED_DT); acc −= FIXED_DT; steps++; } if (steps === 4) acc = 0; alpha = acc/FIXED_DT; game.render(alpha, frameDt); renderer.render(scene, camera); hud.update(frameDt)`. Every Player and the Ball keep `prevPos/pos`, `prevYaw/yaw` (copied at the start of each step) and render `lerp(prev, pos, alpha)`.
- Zero allocations in step/render: module-level scratch `Vector3`s, plain `{x,z}` objects reused.
- `visibilitychange → hidden`: `game.pause()`, `audio.suspend()`, stop rAF; on `visible`: restart rAF, reset `acc = 0`, show the pause menu (no auto-resume).
- `webglcontextlost`: `preventDefault`, pause, show `#ctxLost` overlay with a reload button. `webglcontextrestored`: `location.reload()` is acceptable.
- `perf` object (updated every 1 s): `{fps, avgFrameMs, stepMs, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, dpr}`.

---

## 11. HUD / DOM (`index.html`, `css/style.css`, `src/hud.js`)

All HUD text goes through `t()`; DOM writes only when the string changes (cache last value per node).

- `#scoreBug` (top-left, `top: calc(8px + env(safe-area-inset-top)); left: calc(8px + env(safe-area-inset-left))`, 64 px high, dark translucent `rgba(10,12,20,.78)`, radius 8): `[HBT 12] [RRF 9] | Q2 01:23 | 14`. Team abbreviation chips in team colours; possession arrow `▶/◀` next to the team with the ball; shot clock turns `#ff3b3b` when < 5.
- `#meter`: 10×64 px vertical bar positioned by projecting the shooter's head (`Vector3.project` → CSS `translate3d`), offset +28 px right; green band drawn as a child div; visible only during windup + 0.6 s result flash.
- `#stamina`: 120×6 px bar above the joystick zone bottom-left (`bottom: calc(24px + env(safe-area-inset-bottom)); left: calc(16px + env(safe-area-inset-left))`), fill = stamina, red when < 0.25.
- `#caption`: play-by-play, centred at `top: 84px`, 18 px bold with text-shadow; queue, each shown 1.8 s, fade 0.3 s; max 1 visible.
- `#banner`: large centred text for quarter end/halftime/check (`发球`, `第一节结束`, `半场`, `加时`, `+2/+3`).
- Menus (`.panel`, centred, max-width 360 px, 16 px gutters): `#menuMain` (title, team pick 海城潮汐/赤岩火狐, difficulty 3-way, quarter length 4-way, language, sound, 开始比赛), `#menuPause` (继续, 设置: language/difficulty/sound, 返回主菜单), `#menuOver` (winner line, final score, box-score table per player: 姓名 得分 投篮 三分 篮板 抢断 盖帽, 再来一局, 返回主菜单), `#halftime` overlay, `#rotateHint` (dismissible, shown once in portrait; flag in localStorage, try/catch), `#ctxLost`, `#nowebgl` fallback text.
- Controlled-player marker is 3D (§6). Buttons relabel via `Input.setOffense`.
- Fonts: `system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`; min 13 px.
- CSS essentials: `html,body,#app,canvas,#hud{touch-action:none;overscroll-behavior:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}`; `#app{position:fixed;inset:0;height:100vh;height:100dvh;min-height:-webkit-fill-available;overflow:hidden}`; landscape/portrait via `@media (orientation: portrait)` for zone sizes only.
- `index.html` viewport: `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`; `<meta name="theme-color" content="#0b0d14">`; non-passive `touchmove`, `gesturestart`, `dblclick`, `contextmenu` listeners calling `preventDefault` on `document`.

---

## 12. Audio (`src/audio.js`)

One `AudioContext`, created lazily inside the first `pointerdown` **and** `touchend` **and** `keydown` handler (whichever fires first; listeners stay attached and call `unlock()` on every gesture until `ctx.state === 'running'`); `unlock()` = create ctx if needed, `resume()`, play a 1-sample silent buffer. `visibilitychange visible` → `resume()`; hidden → `suspend()`. Master `GainNode` (0.8; 0 when muted; mute persisted in localStorage with try/catch). ≤ 8 simultaneous voices (drop the oldest). All SFX are synthesized:

| name | recipe |
|---|---|
| `bounce(strength)` | sine 180→90 Hz over 90 ms, gain `0.25*strength` exp decay 0.12 s + lowpassed noise burst 30 ms |
| `rim(strength)` | two square oscillators 620 & 930 Hz through bandpass Q 8, gain `0.3*min(strength/4,1)` decay 0.35 s |
| `board()` | triangle 140 Hz gain 0.3 decay 0.2 s + noise burst 60 ms lowpass 800 Hz |
| `swish()` | white noise 250 ms through bandpass sweeping 2.5 kHz→800 Hz, gain 0.25 |
| `block()` | noise burst 80 ms highpass 1 kHz gain 0.35 + sine 90 Hz thump |
| `dunk()` | `board()` + `rim(4)` + crowd swell 1.0 |
| `whistle()` | sine 2.1 kHz with 40 Hz tremolo, 350 ms, gain 0.25 |
| `buzzer()` | sawtooth 220 Hz + 225 Hz detuned, lowpass 1.2 kHz, 900 ms, gain 0.35 |
| `tick()` | sine 1 kHz 40 ms gain 0.15 |
| `click()` | sine 600 Hz 30 ms gain 0.12 (UI) |
| `crowd(level, seconds)` | looping 2 s pink-ish noise buffer (white noise through lowpass 400 Hz) at base gain 0.06; `level` (0–1) raises gain to `0.06 + 0.25*level` and decays back over `seconds` (1.5 default); groan on air ball = lowpass drop to 200 Hz for 0.8 s |

`audio.update(dt)` handles the crowd envelope. `window.__game.audio.ctx` exposes the context for tests.

---

## 13. i18n (`src/i18n.js`)

```js
export const STRINGS = { zh: { /* key: text */ }, en: { /* same keys */ } };
export function t(key, params)        // '{name}' interpolation; falls back to en, then to the key
export function setLang(l), getLang(), toggleLang()   // persists 'hoop.lang' in localStorage (try/catch); default 'zh'
export function applyDom(root=document) // sets textContent of every [data-i18n] (attribute value = key)
export function onLangChange(cb)
```
Full key table (zh / en). Every visible string must come from here:

```
app.title           街头篮球场 3x3 / HOOP ARENA 3x3
menu.start          开始比赛 / Start Game        menu.resume  继续 / Resume       menu.quit  返回主菜单 / Main Menu
menu.rematch        再来一局 / Rematch           menu.settings 设置 / Settings    menu.team  选择球队 / Your Team
menu.difficulty     难度 / Difficulty            diff.easy 简单 / Easy   diff.normal 普通 / Normal   diff.hard 困难 / Hard
menu.quarter        每节时长 / Quarter Length    menu.min {n} 分钟 / {n} min
menu.language       语言 / Language              menu.lang.zh 简体中文 / 简体中文   menu.lang.en English / English
menu.sound          音效 / Sound                 common.on 开 / On   common.off 关 / Off
menu.pause          暂停 / Paused                menu.tapToSkip 点击跳过 / Tap to skip
hint.landscape      横屏体验更佳 / Landscape recommended        hint.dismiss 知道了 / Got it
hint.nowebgl        您的浏览器不支持 WebGL / Your browser does not support WebGL
hint.ctxLost        图形上下文丢失，点击重新加载 / Graphics context lost, tap to reload
btn.shoot 投篮 / SHOOT   btn.block 盖帽 / BLOCK   btn.pass 传球 / PASS   btn.switch 换人 / SWITCH
btn.cross 变向 / CROSS   btn.steal 抢断 / STEAL   btn.sprint 冲刺 / SPRINT   btn.pause 暂停 / PAUSE
hud.q {n} 第{n}节 / Q{n}     hud.ot 加时 / OT      hud.ot2 加时{n} / OT{n}     hud.shotClock 进攻时间 / Shot
meter.perfect 完美 / PERFECT   meter.early 稍早 / EARLY   meter.late 稍晚 / LATE
banner.check 发球 / CHECK BALL    banner.quarterEnd 第{n}节结束 / END OF Q{n}    banner.halftime 半场 / HALFTIME
banner.overtime 加时赛 / OVERTIME  banner.final 全场结束 / FINAL   banner.plus +{n} / +{n}   banner.resume {n} / {n}
cap.make2 {name} 两分命中 / {name} scores       cap.make3 {name} 三分命中！/ {name} hits the three!
cap.layup {name} 上篮得分 / {name} lays it in     cap.dunk {name} 灌篮！/ {name} DUNKS!
cap.miss {name} 投篮不中 / {name} misses          cap.airball {name} 三不沾 / {name} air ball
cap.block {name} 盖帽！/ {name} blocks it!         cap.steal {name} 抢断！/ {name} steals it!
cap.rebound {name} 抢下篮板 / {name} rebounds     cap.oob 出界 / Out of bounds
cap.shotClock 进攻超时 / Shot clock violation      cap.turnover 失误 / Turnover
cap.buzzerBeater {name} 压哨命中！/ {name} beats the buzzer!   cap.bank {name} 打板命中 / {name} banks it in
over.winner {team} 获胜 / {team} win       over.tie 平局 / Tie
stats.name 球员 / Player  stats.pts 得分 / PTS  stats.fg 投篮 / FG  stats.tp 三分 / 3PM  stats.reb 篮板 / REB  stats.stl 抢断 / STL  stats.blk 盖帽 / BLK
```
Language toggle lives in the main menu, the pause menu and key `T`. On change: `applyDom()`, `Input.setOffense()` re-labels buttons, `hud` re-renders the score bug.

`src/teams.js` (only other file allowed CJK):
```js
export const TEAMS = [
  { id:'HBT', name:{zh:'海城潮汐', en:'Harbor Tide'},   jersey:0x1e6fd9, shorts:0x0f3a75,
    players:[ {name:{zh:'林海',en:'Lin Hai'},   num:7,  speed:1.08, shooting:1.08, defense:0.95, dunk:0.4, height:0.95},
              {name:{zh:'周潮',en:'Zhou Chao'}, num:11, speed:1.02, shooting:0.98, defense:1.00, dunk:0.7, height:1.00},
              {name:{zh:'石岳',en:'Shi Yue'},   num:23, speed:0.92, shooting:0.92, defense:1.08, dunk:0.9, height:1.10} ] },
  { id:'RRF', name:{zh:'赤岩火狐', en:'Redrock Foxes'}, jersey:0xd9341e, shorts:0x7a1a0e,
    players:[ {name:{zh:'赵炎',en:'Zhao Yan'},  num:3,  speed:1.10, shooting:1.04, defense:0.94, dunk:0.5, height:0.94},
              {name:{zh:'胡烈',en:'Hu Lie'},    num:9,  speed:1.00, shooting:1.00, defense:1.02, dunk:0.8, height:1.02},
              {name:{zh:'岩铮',en:'Yan Zheng'}, num:31, speed:0.90, shooting:0.90, defense:1.10, dunk:0.9, height:1.12} ] },
];
```
Ratings: `speed` multiplies max speeds, `shooting` is the §4.3 rating, `defense` multiplies steal chance and shrinks contest distance, `dunk ≥ 0.6` enables dunks, `height` multiplies rebound catch radius (0.55·height).

---

## 14. File-by-file architecture, exports, and build order

Write files in this order; each has a line target (sum ≈ 3300).

| # | file | lines | exports |
|---|---|---|---|
| 1 | `index.html` | 120 | markup only: `#app > canvas#gl`, `#hud` (scoreBug, caption, banner, meter, stamina), `#controls` (stickZone, stickRing, stickKnob, cluster with 4 buttons, btnPause), menus, `<script type="module" src="./src/main.js">` |
| 2 | `css/style.css` | 260 | — |
| 3 | `src/constants.js` | 120 | `COURT, RIM, BOARD, LINES, BALL, FIXED_DT, SLOTS, FORMATION, MOVE {RUN:5.2, SPRINT_MUL:1.35, HANDLER_MUL:0.92, ACCEL:24, DECEL:16, RADIUS:0.40, TURN:12}, JUMP {T:0.55, H_SHOT:0.55, H_BLOCK:0.75}, SHOT {METER_T:0.55, METER_T_LAYUP:0.40, F_IDEAL:0.80, LAYUP_D:2.2}, CLOCK {SHOT:14, QUARTER_OPTIONS:[60,120,180,300], DEFAULT_Q:120, OT:60, CHECK:1.2, DEAD:{MADE:1.5,OOB:1.2,SHOT_CLOCK:1.2,TURNOVER:1.0}, QUARTER_END:2.5, HALFTIME:3.0}, DIFFICULTY {easy,normal,hard} (table §7), PERF {DPR_TOUCH:1.5, DPR_DESKTOP:2, DOWNGRADE_MS:24}, COLORS, isThree(x,z)` |
| 4 | `src/i18n.js` | 170 | `STRINGS, t, setLang, getLang, toggleLang, applyDom, onLangChange` |
| 5 | `src/teams.js` | 30 | `TEAMS` |
| 6 | `src/math.js` | 90 | `clamp, lerp, damp(a,b,rate,dt), lerpAngle, wrapAngle, dist2(ax,az,bx,bz), norm2(out,x,z), smoothstep; class Rng { constructor(seed) next() range(a,b) gauss(mu,sigma) pick(arr) int(n) }` (mulberry32); `SCRATCH = {v3a,v3b,v3c}` |
| 7 | `src/physics.js` | 200 | `integrateBall(ball,dt), collideFloor(ball)→speed|0, collideRim(ball,rng)→speed|0, collideBackboard(ball)→speed|0, testMadeBasket(prevY, ball)→bool, solveArc(from,to,apexAbove,g,out), apexForDistance(d), solvePass(from,to,lob,out), predictLanding(ball,targetY,out)→{x,z,t}|null` |
| 8 | `src/shot.js` | 150 | `classifyShot(player, world)→'dunk'|'layup'|'jumper'|'three', contestFactor(shooter, world)→{C, defender}, makeProbability(kind,d,e,C,stamina,speed,rating,g)→p, timingFactor(e,g), chooseTarget(make,e,C,kind,shooterXZ,rng,out), meterDuration(kind)` |
| 9 | `src/audio.js` | 220 | `class Audio { unlock() get ready() setMuted(b) get muted bounce(s) rim(s) board() swish() block() dunk() whistle() buzzer() tick() click() crowd(level,seconds) groan() suspend() resume() update(dt) ctx }` |
| 10 | `src/scene.js` | 220 | `createRenderer(canvas, isTouch)→{renderer, dpr}, createScene()→{scene, hemi, dir}, buildArena(scene)→{crowd, bumpCrowd(), updateCrowd(dt)}, makeCanvasTexture(w,h,drawFn)→CanvasTexture, makeBlobTexture(), makeBallTexture(), class PerfMonitor { frame(ms) get avg() shouldDowngrade() }` |
| 11 | `src/court.js` | 220 | `buildCourt(scene)→{floor, hoop:{group, rim:RIM, board:BOARD, net, netBase:Float32Array}, animateNet(t)}, drawCourtCanvas(ctx, size)` |
| 12 | `src/humanoid.js` | 260 | `buildSharedGeometry(), getTeamMaterials(team), createHumanoid(team, skinIdx)→{group, pelvis, parts{…}, shadow, handWorld(out, side), setPose(pose, params)}, createMarker(color)→{cone, ring}` |
| 13 | `src/player.js` | 320 | `class Player { constructor({team, teamIdx, index, data, humanoid}) reset(x,z,yaw) intent step(dt, world) render(alpha, t) pos prevPos vel yaw state ('idle'|'move'|'windup'|'release'|'jump'|'layup'|'dunk'|'steal'|'stunned'|'cross'|'celebrate') stamina hasBall isJumping jumpY sprintedRecently handSign stats{pts,fgm,fga,tpm,reb,stl,blk} }` ; `makeIntent(), clearEdges(intent)` |
| 14 | `src/ball.js` | 230 | `class Ball { constructor(scene) state owner lastToucher shotInfo passInfo pos prevPos vel rimContacts attachTo(player, mode) launch(v, state, info) step(dt, world)→events[] render(alpha) get isFree }` events `{type:'bounce'|'rim'|'board'|'score'|'catch'|'oob'|'rest', value, player}` |
| 15 | `src/input.js` | 260 | `class Input { constructor(dom, opts) intent sample() setOffense(bool) setEnabled(bool) get isTouch onAnyGesture(cb) destroy() }` ; `isTouchDevice()` |
| 16 | `src/ai.js` | 360 | `updateAI(world, dt)` (loops CPU players), `assignDefense(world), openness(p, world), laneBlocked(a, b, world), bestPassTarget(handler, world), steerTo(player, x, z, sprint), pickSlot(player, world)` |
| 17 | `src/camera.js` | 80 | `class BroadcastCamera { camera update(dt, world) setAspect(aspect) snapTo(world) }` |
| 18 | `src/game.js` | 420 | `class Game { constructor({scene, court, audio, hud, input, rng, options}) start(options) step(dt) render(alpha, dt) pause() resume() userIsOffense() controlled world:{players, teams, ball, offense (0|1), user (0|1), userPlayer, quarter, gameClock, shotClock, state, deadReason, difficulty, rng, time} score:[n,n] on(evt,cb) shoot(player, e, kind, force) pass(from, to, lob) changePossession(reason) switchDefender() debug:{teleport(i,x,z), debugShoot({p,e}), setClock({game,shot}), turnover(), fastForward(sec)} }`; `STATES` |
| 19 | `src/hud.js` | 260 | `class HUD { constructor(root, {onStart,onResume,onQuit,onRematch,onSetting}) bind(game, input, audio) update(dt, world, camera) caption(key, params) banner(key, params, ms) showMenu(name|null, data) setMeter(f, g, visible, screenX, screenY) flashMeter(kind) }` |
| 20 | `src/main.js` | 160 | side-effect module: `boot()`; sets `window.__game` |
| 21 | `README.md` | — | run instructions (static server, e.g. `python3 -m http.server` from `games/nba2k-threejs`, or the artifact URL), controls table zh/en, rules, URL flags, three.js r186 licence notice, non-goals |

### 14.1 Game-loop wiring (`main.js`)
```
parse URL: seed (default Date.now()|0), q (minutes), auto (0/1), lang, debug
i18n.setLang(lang || stored || 'zh'); applyDom()
canvas = #gl; {renderer, dpr} = createRenderer(canvas, isTouchDevice()); {scene} = createScene(); arena = buildArena(scene); court = buildCourt(scene)
cam = new BroadcastCamera(w/h); audio = new Audio(); input = new Input(document, {onGesture: () => audio.unlock()})
hud = new HUD(document, callbacks); game = new Game({scene, court, audio, hud, input, rng: new Rng(seed), options})
resize(): read #app clientWidth/Height (fallback window.inner*), renderer.setSize(w,h,false), cam.setAspect(w/h); called on 'resize', on visualViewport 'resize', and at +120 ms & +400 ms after 'orientationchange' (debounced to one rAF)
rAF loop as in §10; game.step consumes input.intent when the user is offence/defence controlled; AI runs inside game.step
auto=1: the user's player is driven by AI too (for soak tests); q overrides quarter seconds
window.__game = { game, get state(), world: game.world, get controlled(), ball: game.world.ball, perf, audio, renderer, camera: cam.camera, rng, ...game.debug, input }
```
`Game.step` order: (1) clocks + state machine (2) `updateAI` for CPU players (3) apply `input.intent` to the controlled player (4) `Player.step` all (5) `Ball.step` → events (6) resolve events (score, catch, oob, sounds, captions, stats).
`fastForward(sec)` runs `round(sec*60)` fixed steps synchronously (skipping render and `input.sample`) then renders one frame.

---

## 15. Acceptance checklist (Playwright, headless Chromium `--use-angle=swiftshader`, devices `iPhone 11` and `Pixel 5` with `hasTouch`, plus desktop 1280×720)

Static/hygiene
- A1 `page.goto('/index.html?debug=1&seed=7')` on desktop, iPhone 11 (390×844 and 844×390), Pixel 5: zero `console.error`, zero uncaught exceptions, zero failed requests, every request URL same-origin under `/games/nba2k-threejs/` (or the served root). No request to any other origin during a full `fastForward(120)` game.
- A2 grep: every `import` in `src/*.js` starts with `'./'` or `'../'`; `index.html` contains no `importmap`; the only import outside `src/` is `../vendor/three.module.js`; no `Math.random` in `src/`; no `await` at module top level; no CJK character in `src/*.js` except `i18n.js` and `teams.js`; a denylist grep (Lakers, Celtics, Warriors, Bulls, Knicks, Heat, Nets, Spurs, Suns, Bucks, Mavericks, Rockets, Clippers, Nuggets, Jazz, Raptors, Sixers, 76ers, Cavaliers, Thunder, Grizzlies, Kings, Hawks, Hornets, Magic, Pacers, Pelicans, Pistons, Timberwolves, Trail Blazers, Wizards, LeBron, Curry, Durant, Jokic, Jordan, Kobe, NBA, 2K) over `src/`, `index.html`, `README.md` returns nothing.
- A3 `wc -l src/*.js` total is between 2500 and 4000; `vendor/` contains only `three.module.js` and `LICENSE.three.txt`.

i18n / menu
- A4 On load `document.body.innerText` contains `开始比赛`; no `[data-i18n]` element is empty. Clicking `[data-action=lang]` makes it contain `Start Game` and not `开始比赛`; clicking again restores; after `page.reload()` the last choice is shown (localStorage present).
- A5 Clicking 开始比赛 → `__game.state` becomes `CHECK` then `LIVE` within 3 s; `__game.world.players.length === 6`; the score bug shows both abbreviations `HBT`/`RRF`, `0 0`, `第1节`/`Q1`, `02:00`, and shot clock `14`; after `fastForward(3)` the game clock text is `01:57` and the shot clock `11`.

Input
- A6 (iPhone 11 landscape, LIVE, user on offence) `pointerdown` (pointerType touch) at (15% w, 70% h), `pointermove` +60 px in x, hold 1 s: `__game.controlled.pos.x` increases by > 1.0 m; `pointerup` → controlled speed < 0.1 m/s within 0.5 s. A `pointermove` −60 px in y (up) decreases `pos.z` by > 1.0 m in 1 s.
- A7 Multi-touch: pointer 1 holds `#btnSprint`, pointer 2 drags the joystick up: peak speed > 6 m/s within 1.5 s; releasing pointer 1 keeps pointer 2's movement; releasing pointer 2 leaves sprint held (`__game.input.intent.sprint === true`).
- A8 Slide-over: pointerdown on `#btnSprint`, pointermove into `#btnPrimary` → `intent.primary.held === true` and `intent.sprint === false`.
- A9 Labels: on offence the four buttons read 投篮/传球/变向/冲刺 (en: SHOOT/PASS/CROSS/SPRINT); after `__game.turnover()` they read 盖帽/换人/抢断/冲刺 within 200 ms and `#cluster` has class `defense`. Each button's bounding box ≥ 56×56 and fully inside the viewport in 844×390, 390×844, 812×375, 375×812; with `--safe-bottom:34px` injected via `style` on `:root` (`env()` fallback variable), the cluster bottom is ≥ 50 px above the viewport bottom.
- A10 Keyboard (desktop): holding `d` 500 ms increases `pos.x` > 1.0; `w` decreases `pos.z`; `Space` down 440 ms then up → `ball.state === 'flight'` and `userPlayer.stats.fga` +1; `p` → `paused === true` and `#menuPause` visible; `p` again → countdown then `paused === false`.

Shooting / physics
- A11 `teleport(userIdx, 0, −8.3)` (4.45 m, 2-pt zone), `debugShoot({p:1, e:0})` → within 4 s a `score` event with 2 points, offence score +2, state passes DEAD → CHECK → LIVE, possession switched. `teleport(userIdx, 0, −4.8)` (7.95 m) with `debugShoot({p:1,e:0})` → +3.
- A12 `debugShoot({p:0, e:−0.15})` ×20 (seeded): never scores; each attempt emits a `rim` or `board` event before the ball is caught or DEAD; `debugShoot({p:0, e:−0.40})` ×10: at least 6 attempts emit no rim event (air balls) and `cap.airball` appears.
- A13 Timing model: `teleport(userIdx, 0, −8.3)` open, `debugShoot({e:0})` (p not forced) ×40 seeded → ≥ 34 makes; `debugShoot({e:−0.35})` ×40 → ≤ 8 makes; teleport a defender to `(0, −9.0)` with `jump` forced and `debugShoot({e:0})` ×40 → ≤ 28 makes.
- A14 Fuzz: `fastForward(60)` with `?auto=1&seed=3` and again `seed=11`: no NaN in any player/ball coordinate; `ball.pos.y ≥ 0.10` always (sampled each step via a debug hook `__game.debug.invariantsBroken === 0`); `|ball.x| ≤ 9`, `−16 ≤ ball.z ≤ 1`; shot clock always in `[0, 14]`; total FGA ≥ 6 and each team FGM ≥ 1; no free ball stays free > 6 s.
- A15 Pass: on offence with a teammate open, `intent.secondary` tap → `ball.state === 'pass'` then `ball.owner` is a teammate and `__game.controlled === ball.owner` within 1 s. With a defender teleported onto the pass line 0.3 m off, in a 30-trial seeded loop at least one pass is intercepted (`cap.steal` caption, possession change).
- A16 Defence: after `turnover()`, `intent.secondary` tap changes `__game.controlled` to a different defender; `teleport` the controlled defender 0.8 m from the CPU handler and tap `tertiary` up to 30 times (0.8 s apart, seeded) → at least one `cap.steal` and possession change; `intent.primary` tap sets `controlled.isJumping === true`.

Rules
- A17 `setClock({shot: 0.5})` while the user holds the ball and stands still → within 1.5 s `cap.shotClock` caption, DEAD(SHOT_CLOCK), possession switched. Walking the handler to `x = 8.2` → `cap.oob` and possession switched.
- A18 `setClock({game: 1})` in LIVE → QUARTER_END within 2 s, quarter counter → 2; repeat to reach the end of Q2 → `#halftime` visible ≥ 1 s, then Q3 CHECK; force quarter 4 with clock 1 and a non-tied score → `#menuOver` visible within 4 s with a box-score table of 6 rows and a winner line; with a tied score → banner `加时赛`/`OVERTIME`, quarter label `加时`/`OT`, game clock `01:00`.
- A19 `?q=0.1&auto=1&seed=5` and `fastForward(120)` → GAME_OVER reached (or OT in progress if tied) with final scores both > 0.

Layout / mobile
- A20 In 844×390, 390×844, 812×375, 375×812, 1280×720: `document.scrollingElement.scrollWidth === innerWidth` and `scrollHeight === innerHeight`; canvas client size equals the viewport; `#scoreBug` and `#btnPrimary` boxes do not intersect; computed `touch-action` of `body` and `canvas` is `none`; a dispatched `wheel` does not change `scrollY`.
- A21 Switching the viewport 844×390 → 390×844 mid-LIVE keeps `__game.state === 'LIVE'`, canvas resizes within 500 ms, `camera.fov` is 70 (portrait) / 44 (landscape) (±4 during paint zoom); projecting `RIM` and the ball to NDC gives both inside `[−1, 1]` in both orientations.
- A22 Portrait first load shows `#rotateHint`; clicking 知道了 hides it and it does not reappear after reload.
- A23 `renderer.getPixelRatio() ≤ 1.5` under iPhone 11 emulation (`deviceScaleFactor` 2) and `≤ 2` on desktop.
- A24 `document.visibilityState` forced to hidden (CDP `Emulation.setFocusEmulationEnabled` / `page.evaluate` dispatching `visibilitychange` with a stubbed `document.hidden`) → `paused === true`; game clock unchanged after 1 s; on visible the pause menu is shown and the clock still unchanged until resume.

Performance / rendering
- A25 After 5 s of LIVE: `__game.perf.drawCalls ≤ 110`, `triangles ≤ 40000`; `__game.perf.stepMs` average < 1.5 ms over `fastForward(10)` (sim cost only; never assert GPU fps under SwiftShader).
- A26 Screenshots at menu, LIVE t=2 s, LIVE t=8 s (landscape and portrait): each has > 5 % non-background pixels and pairwise differ by > 1 % of pixels; both team colours (`#1e6fd9`-ish and `#d9341e`-ish, tolerance 60) are present in the LIVE screenshot.
- A27 Audio: before any gesture `__game.audio.ctx` is null; after one `click` on the start button `ctx` exists and `ctx.state` is `'running'` or `'suspended'` with no exception; `M` key sets master gain to 0 and `audio.muted === true`; `audio.swish()` etc. never throw when called with `ctx` suspended.

---

## 16. Known simplifications vs. real basketball

- Half court, one hoop, 3v3; no transition/fast breaks, no backcourt play, no side switch at halftime (possession alternation instead).
- Automatic 1.2 s check-ball reset after every dead ball; no inbound passes, no jump ball/tip-off (coin flip), no 3x3 "clear the ball" rule.
- No fouls, free throws, travelling, double dribble, 3-second, 5-second, goaltending, charging or timeouts.
- Shot clock resets to 14 on any offensive rebound (real: 14 only after rim contact) and does not stop for anything but dead balls.
- Shot outcome is decided by a probability roll at release; the ball's flight is steered to a make or a physical rim/board miss (no true rigid-body simulation of the release). Dunks are scripted.
- Players are kinematic circles (no collisions with the ball in flight except catches/blocks, no body contact, no screens, no box-outs).
- Passing: chest and lob only (no bounce pass); interception folds into the catch rule.
- Interception/loose-ball recovery by the defence counts as a steal or rebound by a simplified rule; assists are not tracked.
- Blocks use a hand-point proximity test in the first 0.35 s of flight; contest is a distance factor, not geometric.
- No player fatigue beyond the sprint stamina bar; no substitutions, no injuries; ratings are 5 scalars.
- Halftime is a 3 s banner; box score only at game over.
