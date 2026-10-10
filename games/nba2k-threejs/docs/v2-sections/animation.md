# ANIMATION — skeletal animation system and move library (v2 section)

Scope: everything that makes the six baked legends move: the runtime animation architecture (clip format, sampling,
blending, layers, IK, look-at, fingers, expressions), procedural locomotion, ball handling, shooting with the meter
mapping, finishing (layups, dunks, putbacks), defence, passing, mannerisms and celebrations, a keyframe table for
every signature move in the six profiles, the gameplay integration contract, a debug viewer, tests and the
performance budget.

Inputs used (cited as [tag] below):
- [RIG] `phaseA.json` → `poc.rigNotes` and `tools/legends/FORMAT.md` (53-bone game_engine rig, identity rest
  rotations, A-pose, axes: +x character's left, +y up, +z forward; verified poses `upperarm_l.rotation.z=+2.35`
  raises the arm, `calf_r.rotation.x=+π/2` bends the knee, `thigh_r.rotation.x=−0.8` lifts the thigh).
- [HDR] the baked header `test/scratch/legends-poc/assets/legends.json` (per-player bone heads/tails, landmarks;
  measured numbers in §1.5 come from it).
- [PERF] `poc.perf` (posing 6 skeletons incl. `updateMatrixWorld` + `skeleton.update` = 0.5–0.85 ms/frame on desktop
  CPU), [RISK] `poc.risks` (LBS deltoid flattening, candy-wrapper > 60° twist, cloth slits when thigh > 90°).
- [PROF:<id>] the six likeness profiles in `phaseA.json.profiles` (`shootingForm`, `signatureMoves`,
  `mannerisms`, `tendencies`, `ratings`, `stats`), [XCHK] `phaseA.json.xcheck` (rig reach sits 22–26 cm below
  the listed standing reach; wingspans matched).
- [CFG] `tools/legends/legends.config.json` (`expressions`: kobe `jawJut`, jordan `tongueOut`, lebron/giannis
  `roar`, yao `grin`, kyrie `smirk`; not baked yet).
- [V1] v1 `SPEC.md` (§3 intent, §4 meter `METER_T 0.55`, `F_IDEAL 0.80`, §5.7 dribble, §5.10 kinematics,
  §5.11 steal, §5.12 crossover, §6.1 poses, §8 states, §10 loop with `prevPos/pos` interpolation) and v1
  `src/constants.js`, `src/player.js` (states `idle|move|windup|release|jump|layup|dunk|steal|stunned|cross|celebrate`;
  yaw convention forward = `(sin yaw, cos yaw)`, `yaw = π` faces −Z).
- [REV#n] `review-r1-all.json` finding n. Animation-relevant: #13 (3 pts decided at press), #24/#39 (instant
  catch-and-shoot), #27/#38 (block sphere too generous, contest beats every layup), #28 (defender hops backward
  while contesting), #32 (dunk ball teleports, hands below rim), #36 (pose snaps to idle at every reset),
  #42 (bodies interpenetrate in dunks/rebounds).

Decisions taken in this section are marked **D-ANIM-n** so other sections can reference them.

---

## 0. Key decisions (summary)

- **D-ANIM-1 Authoring space.** Clips are authored as sparse keys of *anatomical joint angles in degrees*
  (flex / abd / twist per joint, per-side signs so that mirroring = swap `_l`/`_r` + negate axial yaw/roll) plus
  pelvis offsets, root-motion curves, foot-plant targets, ball attachment, finger presets, expression weights and
  events. A load-time compiler turns them into dense 30 Hz quaternion tracks (shared by all six players);
  per-player rig frames convert anatomical quaternions to three.js bone-local quaternions at output time
  (2 quaternion multiplies per bone).
- **D-ANIM-2 Locomotion is procedural** (gait generator with analytic two-bone leg IK and foot locking), driven
  by the *actual* interpolated velocity, facing, acceleration and turn rate, with stride length/cadence from
  Alexander's dimensionless relation scaled by each player's hip height. No sliding feet by construction.
- **D-ANIM-3 One animation clock, two evaluations.** Clip time advances in the 60 Hz fixed step (deterministic,
  events fire there); gameplay-relevant sockets (ball, blocking hand, dunk hand) are queried in the step; the
  full skinned pose is evaluated once per rendered frame at the interpolated time.
- **D-ANIM-4 Segment time-warp.** Every action clip is split by its events; gameplay may retime any event
  (takeoff, release, land, contact, slam). This is how the jump physics, the shot meter, dunk contact and landing
  stay synchronised with the art.
- **D-ANIM-5 Shot meter ↔ clip.** The shooter reaches his *set point* 0.07–0.14 s before the ideal release
  input `tIdeal`, holds a loaded micro-pose until the release input, then the push (set→release key) always takes
  exactly 0.05 s and the ball leaves the real hand at the `release` key. Takeoff is scheduled so that ball launch
  coincides with apex + the player's `releaseVsApex`. Per-player `tIdeal` (0.377–0.466 s mid-range) and the
  resulting `METER_T = tIdeal / 0.80` are tabulated (§5.2); if gameplay keeps one global `METER_T` the same
  machinery back-solves the takeoff time.
- **D-ANIM-6 Ball attachment** is socket based: one-hand sockets in each hand bone, two-hand mode = average of
  both sockets plus a hand IK pass that closes the hands on the ball; dribble mode = procedural ball path
  phase-locked to footsteps; `path` mode = authored ball path for crossovers/between-legs/behind-back.
- **D-ANIM-7 Gameplay hooks that change v1 timing** (the gameplay section must adopt them; values in §10.4):
  jumps start at the clip's `takeoff` event (not at the press), airtime is ballistic `2·sqrt(2h/g)`, passes leave
  the hand at the `release` event 0.10–0.27 s after input, steals resolve at the `swipe` event 0.12 s after input,
  block/contest contact uses the real hand socket (r = 0.14 m + ball r) instead of the 0.40 m sphere
  ([REV#27/#38]), shot points are decided by the root position at `takeoff` ([REV#13]), the catch clip gives a
  0.30 s `ready` gate before a CPU shot ([REV#24/#39]), reset never snaps the pose ([REV#36]), dunks put the ball
  through the rim from the real hand with hand-to-rim IK ([REV#32]).
- **D-ANIM-8 Input-to-motion < 80 ms**: every action clip moves the hand ≥ 2 cm or a major joint ≥ 3° within its
  first 33 ms, entry crossfades use an ease-out curve, and an input is consumed in the next fixed step, so the
  first changed rendered frame is ≤ 2 steps (33 ms) after the DOM event plus display latency.
- **D-ANIM-9 Budget**: ≤ 0.15 ms CPU per player per frame on an iPhone 11-class phone at the high tier
  (≤ 0.9 ms for six), ≤ 2.0 ms for six (≈ 0.33 ms per player) on the low tier with the throttles in §12; bones use
  `matrixAutoUpdate = false` and matrices are composed directly (no Euler sync).
- **D-ANIM-10 Cosmetic randomness** (idle habits, celebration choice, blink timing) uses a separate seeded
  `Rng(seed ^ 0xA11CE5)` advanced only in fixed steps, never the gameplay RNG; choices that change gameplay
  (dribble-move displacement, shot variant drift) use the gameplay RNG in the step.

---

## 1. Rig conventions

### 1.1 Bones (header order, parents first) [HDR]

| idx | bone | parent | idx | bone | parent | idx | bone | parent |
|---|---|---|---|---|---|---|---|---|
| 0 | Root | — | 18 | upperarm_r | 14 | 36 | pinky_01_r | 20 |
| 1 | pelvis | 0 | 19 | lowerarm_r | 18 | 37 | pinky_02_l | 35 |
| 2 | thigh_l | 1 | 20 | hand_r | 19 | 38 | pinky_02_r | 36 |
| 3 | calf_l | 2 | 21 | neck_01 | 12 | 39 | pinky_03_l | 37 |
| 4 | foot_l | 3 | 22 | head | 21 | 40 | pinky_03_r | 38 |
| 5 | ball_l | 4 | 23 | index_01_l | 17 | 41 | ring_01_l | 17 |
| 6 | thigh_r | 1 | 24 | index_01_r | 20 | 42 | ring_01_r | 20 |
| 7 | calf_r | 6 | 25 | index_02_l | 23 | 43 | ring_02_l | 41 |
| 8 | foot_r | 7 | 26 | index_02_r | 24 | 44 | ring_02_r | 42 |
| 9 | ball_r | 8 | 27 | index_03_l | 25 | 45 | ring_03_l | 43 |
| 10 | spine_01 | 1 | 28 | index_03_r | 26 | 46 | ring_03_r | 44 |
| 11 | spine_02 | 10 | 29 | middle_01_l | 17 | 47 | thumb_01_l | 17 |
| 12 | spine_03 | 11 | 30 | middle_01_r | 20 | 48 | thumb_01_r | 20 |
| 13 | clavicle_l | 12 | 31 | middle_02_l | 29 | 49 | thumb_02_l | 47 |
| 14 | clavicle_r | 12 | 32 | middle_02_r | 30 | 50 | thumb_02_r | 48 |
| 15 | upperarm_l | 13 | 33 | middle_03_l | 31 | 51 | thumb_03_l | 49 |
| 16 | lowerarm_l | 15 | 34 | middle_03_r | 32 | 52 | thumb_03_r | 50 |
| 17 | hand_l | 16 | 35 | pinky_01_l | 17 | | | |

`src/anim/rig.js` exports `BONE` (frozen name→index map built from `header.bones` at load and asserted equal to
this table) and `MIRROR` (Int8Array(53): index of the opposite-side bone, self for axial bones). There are no jaw
or eye bones [RIG]; the mouth moves only by morph targets (§2.8) and the eyes only by an iris UV offset (§2.6.3).

### 1.2 Character frame and root

- The player's `THREE.Group` (= `Root` bone parent) is placed at the gameplay position `(pos.x, 0, pos.z)` with
  `rotation.y = yaw` [V1]. In the character frame **+x = character's left, +y up, +z forward**. A positive yaw
  turns the character to his own left (counter-clockwise seen from above).
- `Root` stays identity. All vertical motion (crouch, jump) is the pelvis translation.
- The pelvis local position = rest head + `P.dx, P.dy, P.dz` (clip offsets, scaled by `sLeg`, §1.5) +
  `(0, jumpY, 0)` from gameplay while airborne (§2.4).

### 1.3 Anatomical channels (the authoring convention)

Each joint has named channels in degrees. Signs are **per side, anatomical**: "+abd" always moves the limb away
from the body for either side, so a right-handed clip mirrors to a left-handed one by swapping `_l`/`_r` tracks
and negating axial yaw/roll, root x and root yaw (§2.2.6).

| group (DSL key) | bones | channels (deg; offsets in m) | positive direction |
|---|---|---|---|
| `P` | pelvis | `[dx, dy, dz, pitch, yaw, roll]` | dx → character's left, dy up, dz forward; pitch = anterior tilt (trunk forward); yaw = turn to own left; roll = top of the pelvis toward own left |
| `S` (or `S1`,`S2`,`S3`) | spine_01/02/03 | `[pitch, yaw, roll]` total, split 0.30/0.35/0.35 (pitch, roll) and 0.30/0.33/0.37 (yaw) | pitch = flex forward; yaw = turn left; roll = bend to own left |
| `N` (or `Nk`,`Hd`) | neck_01, head | `[pitch, yaw, roll]` total, split 0.40/0.60 | pitch = nod down (chin to chest); yaw = look left; roll = ear toward own left shoulder |
| `RC`/`LC` | clavicle_r / _l | `[elev, prot]` | elev = shrug up; prot = shoulder forward |
| `RA`/`LA` | upperarm, lowerarm, hand | `[flex, abd, int, elbow, pron, wFlex, wDev]` | flex = arm raised forward (0 hanging, 90 horizontal forward, 180 overhead); abd = arm raised sideways; int = internal rotation; elbow = flexion (0 straight); pron = forearm pronation **relative to the bind palm (0 = palms facing the thighs, thumbs forward; +90 = palm back; −90 = palm forward = anatomical position)**; wFlex = palmar flexion (− = wrist cocked back); wDev = radial deviation (toward the thumb) |
| `RL`/`LL` | thigh, calf, foot, ball | `[hip, abd, int, knee, ank, toe]` | hip = thigh forward; abd = thigh outward; int = knee turns inward; knee = flexion; ank = plantar flexion (toes down; − = dorsiflexion); toe = toes bent up (extension) |
| `RF`/`LF` | 15 finger bones per hand | preset name or `[name, weight]` | §2.7 |

Joint zeros: axial, clavicle and leg zeros are the bind pose (bind legs stand with each ankle at `x = ±0.225·sLeg`,
hips ~5.6° abducted [HDR]; "abd 0" therefore keeps that natural width). Shoulder and elbow zeros are **arm hanging
straight down, elbow straight, elbow hinge medial–lateral** (the A-pose's 41° abduction and the bind elbow's 47°
flexion [HDR] are removed by the rig frames, §1.4). Wrist, finger and thumb zeros are the bind hand.

### 1.4 From anatomical angles to bone quaternions (exact)

Each bone `b` gets an anatomical quaternion `Qb` built from its channels, then its three.js local quaternion is
`Lb = PREb · Qb · POSTb` with two constant per-player quaternions computed at load:

| bones | PRE | POST | meaning |
|---|---|---|---|
| pelvis, spine_0x, neck_01, head, clavicles, thighs, calves, feet, balls | I | I | angles relative to bind, world-aligned axes |
| upperarm_s | I (clavicle frame is world-aligned) | `F_ua⁻¹` | arm-hanging zero |
| lowerarm_s | `F_ua` | `F_la⁻¹` | straight-elbow zero, hinge shared with the upper arm |
| hand_s | `F_h` | `F_h⁻¹` | bind-wrist zero, axes in the hand frame |
| fingers & thumb of side s | `F_h` | `F_h⁻¹` | bind-finger zero, axes in the hand frame |

Frames are rotation matrices whose columns are unit axes in bind world space (rest rotations are identity, so bind
world = rest local) [RIG]. Built per side from bind joint heads: shoulder `S = upperarm.head`, elbow
`E = lowerarm.head`, wrist `W = hand.head`, knuckles `I = index_01.head`, `K = pinky_01.head`,
`M = middle_01.head`:

```
hinge  = normalize(cross(E − S, W − E));  if (hinge.x < 0) hinge = −hinge      // ≈ +x after re-aiming, both sides
F_ua : Y = normalize(S − E);  X = normalize(hinge − (hinge·Y)Y);  Z = cross(X, Y)
F_la : Y = normalize(E − W);  X = normalize(hinge − (hinge·Y)Y);  Z = cross(X, Y)
knk  = left ? (I − K) : (K − I)                                                 // points to the thumb on the left, to the pinky on the right
F_h  : Y = normalize(W − M);  X = normalize(knk − (knk·Y)Y);  Z = cross(X, Y)   // Z = palm normal at bind
```

Check values (Kobe, left) [HDR]: `hinge ≈ (0.75, 0.66, −0.07)`, bind palm normal `Z_h ≈ (−0.72, −0.63, 0.00)`
(medial-down), bind elbow flexion 46.7°. The unit test asserts `|det F − 1| < 1e−4` and that `Z_h` points medially.

Anatomical quaternions (`Rx(a)` = rotation by `a` degrees about +x, etc.; products apply right-to-left to vectors,
i.e. the left factor is the outermost/parent-most rotation). **Left side shown; for the right side negate every
`Ry` and `Rz` angle** (`Rx` unchanged):

| bone | Qb (left side) |
|---|---|
| pelvis, spine_0x, neck_01, head | `Ry(yaw) · Rx(pitch) · Rz(−roll)` (axial bones have no side) |
| clavicle | `Rz(elev) · Ry(−prot)` |
| upperarm | `Rx(−flex) · Rz(abd) · Ry(−int)` |
| lowerarm | `Rx(−elbow) · Ry(−0.40·pron)` |
| hand | `Ry(−0.60·pron) · Rx(−wFlex) · Rz(wDev)` |
| finger_0k | `Rx(−curl_k) · Rz(spread·sgn)` (sgn: index +1, middle 0, ring −1, pinky −1; spread only on `_01`) |
| thumb_01 | `Rx(−tFlex) · Rz(tAbd) · Ry(−tRot)`; thumb_02/03 `Rx(−curl)` |
| thigh | `Rx(−hip) · Rz(abd) · Ry(−int)` |
| calf | `Rx(+knee)` |
| foot | `Rx(+ank) · Rz(−inv)` (inv = inversion, rarely used) |
| ball (toes) | `Rx(−toe)` |

Pronation is split 40 % forearm / 60 % hand so the largest single twist relative to bind is 0.6·|pron| ≤ 60° for
`pron ∈ [−100, +100]`, inside the candy-wrapper limit [RISK]. Sanity checks for the unit test (Kobe, standing):
`RA flex 90` puts the right hand 0.55–0.62 m in front of the right shoulder; `RA abd 90` puts it ≥ 0.55 m to the
character's right; `RL knee 90` puts the right ankle behind the knee; `RA [0,0,0,90,0,0,0]` puts the forearm
horizontal forward with the palm facing medially; adding `pron 90` turns the palm down.

**Scapulohumeral rhythm (automatic, on top of authored `elev`)**: `elevAuto = 0.22 · max(0, armElev − 60°)` where
`armElev` = angle between the upper arm and straight down (0–180). This adds up to 26° of shrug (≈ +0.07 m shoulder
height) when the arm is overhead, recovering part of the 22–26 cm reach deficit [XCHK]. Clips can suppress it with
`noRhythm: true` (shrug-free poses such as hands on hips).

### 1.5 Per-player metrics (computed at load from the header; values below are the measured bake) [HDR]

`sLeg = (|thigh| + |calf|) / 1.000` scales all authored metre offsets (pelvis offsets, root motion, foot targets,
ball path) — the reference body is Kobe. `sArm` scales arm-reach targets in tests only.

| id | height (barefoot) | pelvis y | hip joint y | thigh | calf | leg | **sLeg** | shoulder joint y | upper+lower arm | sArm | hand len [XCHK] | ankle y |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kobe | 1.96 | 1.086 | 1.077 | 0.488 | 0.511 | 0.999 | **1.000** | 1.573 | 0.599 | 1.000 | 0.232 | 0.085 |
| jordan | 1.96 | 1.084 | 1.074 | 0.484 | 0.515 | 0.999 | **0.999** | 1.570 | 0.584 | 0.975 | 0.245 | 0.083 |
| lebron | 2.03 | 1.124 | 1.109 | 0.513 | 0.516 | 1.029 | **1.030** | 1.646 | 0.583 | 0.973 | 0.238 | 0.087 |
| giannis | 2.09 | 1.197 | 1.190 | 0.546 | 0.561 | 1.107 | **1.108** | 1.691 | 0.616 | 1.028 | 0.252 | 0.091 |
| yao | 2.27 | 1.265 | 1.256 | 0.651 | 0.519 | 1.170 | **1.171** | 1.841 | 0.626 | 1.045 | 0.262 | 0.093 |
| kyrie | 1.87 | 1.020 | 1.013 | 0.463 | 0.477 | 0.940 | **0.941** | 1.500 | 0.543 | 0.907 | 0.212 | 0.081 |

Derived at load and stored in `rig.metrics`: `hipH` (hip joint y), `legLen`, `sLeg`, `shoulderY`, `armLen`,
`handLen`, `footLen` (heel→toe tip), `ankleY`, `eyeY` (landmark mean of l/r-eye), `reach0` = shoulderY + armLen +
0.6·handLen (arm straight up, no shrug) and `reachAug` = reach0 + 0.07 (rhythm shrug) + 0.05 (spine side-bend
toward the reaching arm, used by dunks/blocks only). `reach0` (palm, no shrug): kobe 2.31, jordan 2.30, lebron 2.37,
giannis 2.46, yao 2.62, kyrie 2.17 m (fingertips ≈ +0.09 m, i.e. 22–26 cm below the listed reach as [XCHK] states);
`reachAug`: kobe 2.43, jordan 2.42, lebron 2.49, giannis 2.58, yao 2.74, kyrie 2.29 m.

### 1.6 Sockets and anchors (local offsets in the parent bone, computed once at load)

| socket | parent bone | definition (bind world, then expressed relative to the bone head; rest rotation = I) |
|---|---|---|
| `palm_s` | hand_s | `W + 0.55·(M − W) + 0.012·Z_h` |
| `ball1_s` (one-hand ball centre) | hand_s | `palm_s + (BALL.R + 0.010)·Z_h − 0.015·Y_h` (ball sits on palm and finger pads; R = 0.12) |
| `tip_s` (middle fingertip) | middle_03_s | `middle_03.tail` |
| `rimHook_s` (rim grip point) | hand_s | `W + 0.80·(M − W) + 0.025·Z_h` |
| `heel_s` | foot_s | `(ankle.x, 0.0, ankle.z − 0.06·sLeg)` |
| `toe_s` | ball_s | `ball.tail` with y = 0.01 |
| `ankle_s` | foot_s | the foot head (IK end effector for flat feet) |
| `ballJ_s` | ball_s | the ball-of-foot joint (IK end effector for toe-locked feet) |
| `eyeC` | head | mean of `l-eye`/`r-eye` landmarks (look-at origin) |
| `chin` | head | `jaw` landmark (ball "chinned" check in tests) |

`Z_h`/`Y_h` are the hand frame axes of §1.4. Socket world positions are `bone.matrixWorld · offset` (one
`applyMatrix4` into a reused vector).

### 1.7 Joint limits (degrees; clamp after blending and after IK)

| joint | limits | joint | limits |
|---|---|---|---|
| spine_0x pitch / yaw / roll (each) | −15..+30 / ±25 / ±20 | neck_01 pitch / yaw / roll | −30..+35 / ±50 / ±25 |
| head pitch / yaw / roll | −35..+35 / ±45 / ±25 | pelvis pitch / roll (rel. root) | −25..+40 / ±20 |
| clavicle elev / prot | −10..+35 / −15..+25 | shoulder flex / abd / int | −60..+180 / −15..+180 / −80..+80 |
| elbow | 0..150 | pron | −100..+100 |
| wrist flex / dev | −85..+85 / −20..+30 | finger curl _01/_02/_03 | −10..95 / 0..105 / 0..80 |
| hip flex / abd / int | −30..+125 / −15..+50 / −40..+40 | knee | 0..150 |
| ankle | −30..+55 | toe | −10..+60 |

Cloth guard [RISK]: keys may exceed hip flex 95° only during airborne tucks (dunks, Jordan's free-throw-line
scissor); the viewer test (§11) flags any non-airborne key above 95°.

---

## 2. Runtime architecture

### 2.1 Files and exports (all under `src/anim/`, relative imports only, three.js core only)

| file | ≈ lines | exports |
|---|---|---|
| `rig.js` | 260 | `BONE`, `MIRROR`, `BONE_COUNT = 53`, `buildRig(playerData) → Rig {pre: Float32Array(53*4), post: Float32Array(53*4), hasPrePost: Uint8Array(53), restPos: Float32Array(53*3), metrics, sockets: {name: Float32Array(4: boneIdx,x,y,z)}}`, `anatQuat(group, side, channels, out)`, `toLocal(rig, b, qAnat, outQuat)` |
| `clip.js` | 330 | `defineClip(def) → ClipDef`, `compileClip(def) → Clip`, `sampleClip(clip, t, pose)`, `clipTiming(clip) → {events, takeoff, release, land, dur}`, `EV` (event codes), `BM` (ball-mode codes) |
| `pose.js` | 160 | `class Pose {q: Float32Array(212), w: Float32Array(53), pel: Float32Array(3), root: Float32Array(3), ball: Uint8Array(1), bpath: Float32Array(3), fingers: Float32Array(2), expr: Float32Array(9), ftRL: Float32Array(8), ftOn: Uint8Array(2)}`, `copyPose`, `blendPose(out, a, b, w, maskW)`, `addPose(out, add, w)` |
| `presets.js` | 220 | `FINGERS` (§2.7), `ARM`, `LEG`, `STANCE` (named channel arrays used by clip data), `FORMS` (§5.2), `STYLE` (§3.6) |
| `locomotion.js` | 480 | `class Gait {update(dtStep, inp), writePose(pose, alpha)}` — procedural walk/jog/run/sprint/backpedal/slide/turn/idle (§3) |
| `dribble.js` | 260 | `class Dribble {update(dtStep, inp), ballPos(out), handTarget(out), lowWindow}` (§4.1) |
| `ik.js` | 200 | `twoBoneIK(a, b, c, target, pole, weight)`, `footLock`, `handOnBall`, `handToPoint` (§2.6) |
| `look.js` | 130 | `class LookAt {update(dt, targetWorld, weight), apply(bones)}`, `eyeOffset(out)` |
| `animator.js` | 560 | `class Animator` (§2.3) |
| `select.js` | 300 | `selectShot`, `selectLayup`, `selectDunk`, `selectMove`, `selectPass`, `selectDefJump`, `selectCelebration`, `selectIdleHabit` (§10) |
| `clips/common.js` | 700 | shared clips (handling, passing, defence, catch, generic layups/dunks, generic celebrations) |
| `clips/shots.js` | 320 | `makeJumper(form, variant)`, `makeLayup(...)`, `makeDunk(...)` generators + generic fades/pull-ups |
| `clips/kobe.js` … `clips/kyrie.js` | 6 × 220 | signature clips of §9 (data only) |
| `viewer.js` | 280 | debug viewer `?anim=` (§11) |

Total ≈ 5,500 lines, of which ≈ 2,700 are clip data.

### 2.2 Clip format

#### 2.2.1 Definition object (authoring, a plain JS literal in a `clips/*.js` module — no fetch, no JSON parse)

```js
defineClip({
  id: 'sig.kobe.turnFade',     // unique; namespaces: loco.*, drib.*, move.*, catch.*, shot.*, lay.*, dunk.*,
                               // put.*, def.*, reb.*, pass.*, cel.*, idle.*, chk.*, sig.<player>.*
  dur: 1.60,                   // seconds (authoring rate 30 fps; key times may be any decimal)
  loop: false,
  mask: 'full',                // 'full' | 'upper' | 'arms' | 'armR' | 'armL' | 'legs' | 'face' (§2.3.3)
  root: 'motion',              // 'none' (in place) | 'motion' (R curve applied as velocity, §2.4.3)
  entry: 'stop',               // root entry policy when root='motion': 'stop' | 'carry' | 'replace'
  entryDecel: 18,              // m/s², for entry 'stop'
  jump: { h: 0.50 },           // optional: the clip contains an airborne segment [takeoff, land]
  tempo: true,                 // per-player tempo multiplier applies to non-air segments (§3.6 STYLE.tempo)
  hand: 'R',                   // the dominant hand; mirror() produces the 'L' version
  blendIn: 0.06, blendOut: 0.20,
  cancel: 1.10,                // from this clip time on gameplay may interrupt into locomotion
  target: 'takeoff',           // optional target-matching event for root warping (§2.4.4)
  keys: [ [t, {channels}], ... ],
  ev:   [ [t, 'event'], ... ],
  params: { ... },             // free data for select.js (takeoff distance window, contact offset ...)
});
```

#### 2.2.2 Key channels (sparse; any group may be omitted from any key)

| key | value | notes |
|---|---|---|
| `P` | `[dx,dy,dz, pitch,yaw,roll]` | metres × sLeg; degrees |
| `S` / `S1` `S2` `S3` | `[pitch,yaw,roll]` | `S` = total split per §1.3; explicit ones override |
| `N` / `Nk` `Hd` | `[pitch,yaw,roll]` | `N` split 0.40 / 0.60 |
| `RC` `LC` | `[elev, prot]` | |
| `RA` `LA` | `[flex,abd,int,elbow,pron,wFlex,wDev]` | |
| `RL` `LL` | `[hip,abd,int,knee,ank,toe]` | |
| `RF` `LF` | `'preset'` or `['preset', w]` | w blends from `relax` |
| `Rft` `Lft` | `[x, z, yaw, mode]` or `null` | foot plant target in the **clip-start frame** (m × sLeg, deg, mode `'f'` flat (ankle locked, default) or `'t'` toe (ball joint locked, heel free)); `null` = released (FK swing) |
| `B` | `'R' 'L' 'both' 'drib' 'path' 'free' 'keep'` | ball attachment from this key on (step function, §2.5) |
| `Bp` | `[x, y, z]` | ball centre in the clip-start frame (m × sLeg) for `B:'path'` |
| `E` | `{name: w}` | expression weights (§2.9) |
| `R` | `[x, z, yaw]` | cumulative root displacement in the clip-start frame (m × sLeg, deg) |
| `look` | `'rim' 'ball' 'man' 'target' 'passer' 'crowd' 'none'` or `[name, w]` | look-at target from this key on (§2.6) |

Inside an array, `_` (written `null` in code) means "not keyed at this time" for that single channel.
Doc tables below write `_` for brevity. Every clip must key every tracked channel at its first and last key
(the compiler throws otherwise), so interpolation is always bounded.

#### 2.2.3 Compilation (`compileClip`, at load, during the loading screen)

1. Collect per scalar channel the keys that set it (skipping `_`).
2. Interpolate each scalar with **monotone cubic Hermite (Fritsch–Carlson)** through its keys (no overshoot, so
   flat holds stay flat); clamp to §1.7 limits.
3. Sample at a fixed 30 Hz grid `i = 0 .. ceil(dur·30)` (plus the exact `dur`): build `Qb` per tracked bone per
   frame (§1.4) and store `Float32Array(frames·4)` per bone in **anatomical space** (shared by all six players;
   PRE/POST applied at output). Pelvis offsets `Float32Array(frames·3)`, root `Float32Array(frames·3)` (x, z,
   yaw), finger preset weights `Float32Array(frames·2)` with the preset id as a step track, expression weights
   per used name, ball mode as a step track `Uint8Array(frames)`, ball path `Float32Array(frames·3)` (Catmull-Rom
   through `Bp` keys), foot targets as step+lerp tracks (`Float32Array(frames·4)` per foot + `Uint8Array` on/off).
4. Events sorted, coded to `EV` ints: `GATHER 1, PLANT_L 2, PLANT_R 3, TAKEOFF 4, SET 5, RELEASE 6, APEX 7,
   CONTACT 8, SLAM 9, RIM_GRAB 10, RIM_RELEASE 11, LAND 12, CATCH 13, BOUNCE 14, HAND_ON 15, PICKUP 16, SWIPE 17,
   READY 18, END 19, HANDOFF 20, STEP 21, SLOWMO_IN 22, SLOWMO_OUT 23, FX 24` (FX carries a param id, e.g. chalk burst).
5. Mirror: `mirror(def)` builds the `_L` variant before compiling (swap R*/L* keys and `_l/_r` foot keys; negate
   `P.dx, P.yaw, P.roll, S/N yaw & roll, R.x, R.yaw, Rft/Lft x & yaw, Bp.x`; `hand` R↔L).
6. Lazy option: compile on first use, but the loader pre-compiles every clip referenced by the six players'
   selection tables (§10) before the first CHECK (measured target < 40 ms on a mid phone for ≈ 170 clip-seconds).

Memory: ≈ 170 clip-seconds × 30 Hz × ≈ 28 tracked bones × 16 B ≈ 2.3 MB of Float32Array, shared.

#### 2.2.4 Sampling (`sampleClip`)

`f = t·30; i = floor(f); u = f − i` (t clamped to `[0, dur]`, or wrapped when looping). Per tracked bone:
`q = nlerp(q[i], q[i+1], u)` with hemisphere check (negate `q[i+1]` when `dot < 0`), normalise. Pelvis, root,
ball path: linear. Step tracks: value at `i`. No search, no allocation: O(tracked bones).

#### 2.2.5 Variants and per-player parameters

- **Generators** (`makeJumper`, `makeLayup`, `makeDunk`, §5) build clip definitions from per-player `FORMS`
  numbers; they run once at load per player that uses them (6 forms × ≈ 9 shot variants).
- **Overrides**: a clip may list `per: { yao: {tempo: 1.12, keys: {...partial keys by time...}} }`; the
  compiler merges partial keys into a per-player compiled copy (used sparingly: defence stances, idles).
- **Mirroring** gives every right-handed clip a left-handed twin (`id + '_L'`); selection picks by the side
  logic in §10.

#### 2.2.6 Mirroring rule (exact)

Swap every pair `X_l ↔ X_r` (tracks, `RA↔LA`, `RL↔LL`, `RC↔LC`, `RF↔LF`, `Rft↔Lft`); negate `P.dx`, `P.yaw`,
`P.roll`, all axial `yaw` and `roll`, `R.x`, `R.yaw`, foot-target `x` and `yaw`, `Bp.x`. Limb channels are not
negated (they are anatomical per side). Event names with sides swap (`plantL↔plantR`).

### 2.3 Animator (one per player)

```js
class Animator {
  constructor(rig, skinnedObj, bones /* THREE.Bone[] */, opts)
  // ---- fixed-step API (called by Player.step / Game.step, deterministic) ----
  play(clipIdx, opts)       // opts: {mirror, rate, warp:{evCode:time}, target:{x,z,yaw}, layer:'action'|'upper'|'add', blendIn}
  releaseNow()              // shot input released (§5.1)
  setJump(h, airT)          // gameplay ballistic parameters for the current clip's air segment
  stopAction(blendOut)      // back to locomotion
  step(dt)                  // advance clip clocks, fire events into this.events (ring), update gait/dribble state
  querySocket(sockIdx, out) // world position of a socket at the CURRENT step time (FK of the needed chain only)
  // ---- render API ----
  evaluate(alpha, frameDt)  // full pose at the interpolated time, writes bone matrices, IK, look, expressions
  // ---- state ----
  action, actionTime, actionClip, layerWeights, ballMode, ballHand, phase, events (ring of 32 {code, t, param})
}
```

#### 2.3.1 Layer stack (evaluated in this order every render frame)

| # | layer | content | blend |
|---|---|---|---|
| 0 | **base** | locomotion pose from `Gait` (procedural) or a stance/idle clip | write |
| 1 | **action** | the full-body or lower-body action clip (shot, dunk, move, block, celebration…) | override, per-bone mask weight × layer weight |
| 2 | **upper** | upper-body clip over locomotion (dribble arm, pass on the move, catch, protect, steal swipe on the move, celebration while jogging) | override with the `upper` mask |
| 3 | **additive** | lean (accel/turn), breathing, aim twist, swat/flinch impulses, nods | `q = qAdd · q` in anatomical space |
| 4 | **procedural** | look-at (neck/head + iris), foot locks (leg IK), hand IK (ball, rim, catch, contact) | world-space solve |
| 5 | **face** | expression morph weights + blink | morph influences |

Fingers: each layer carries its finger presets; finger bones blend like other bones. An action clip with `RF`
overrides the base hand only where keyed.

#### 2.3.2 Crossfades

Weight curves (u = elapsed / duration):
- **entry into actions**: ease-out `w = 1 − (1 − u)³` — 70 % of the target pose after 1/3 of the fade, which
  keeps input-to-visible-motion short (D-ANIM-8).
- **exit to locomotion** and locomotion-to-locomotion: smoothstep `w = u²(3 − 2u)`.
- Interrupted fades start from the *current* blended pose (snapshot copy into a reserved `Pose`), never from
  the old clip's pose (no pops).

| transition | duration (s) |
|---|---|
| locomotion → shot / pull-up / fade | 0.06 |
| locomotion → layup / dunk gather | 0.08 / 0.10 |
| locomotion → block / contest / rebound jump | 0.05 |
| locomotion → dribble move (cross, btl, btb, hesi, spin, step-back) | 0.06 |
| locomotion → pass (upper layer) | 0.06 |
| locomotion → steal swipe | 0.04 |
| any → catch | 0.06 |
| chained action → action (jab → shot, cross → step-back, gather → layup) | 0.06 (0.04 when the next clip's first key equals the current pose, flag `chain: true`) |
| action → locomotion (default `blendOut`) | 0.20 (0.12 after dribble moves, 0.30 after celebrations) |
| gameplay interruption (stun, steal success, loose ball, whistle) | 0.10 |
| reset / teleport (CHECK formation, rematch) | 0.20 crossfade from the current pose to the state's base pose; foot locks released and re-planted with settle steps ([REV#36]: no `dt = 0` snap) |
| stance ↔ upright when switching offence/defence | 0.25 |

#### 2.3.3 Masks (per-bone weights)

| mask | pelvis | spine_01 | spine_02 | spine_03 | neck/head | clavicles, arms, hands, fingers | legs | root/pelvis offsets |
|---|---|---|---|---|---|---|---|---|
| full | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| upper | 0 | 0.35 | 0.75 | 1 | 1 (look-at still runs on top) | 1 | 0 | 0 |
| arms | 0 | 0 | 0 | 0.25 | 0 | 1 | 0 | 0 |
| armR / armL | 0 | 0 | 0 | 0.15 | 0 | that side only: 1 | 0 | 0 |
| legs | 1 | 0.25 | 0 | 0 | 0 | 0 | 1 | 1 |
| face | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 (expressions only) |

Only bones that a clip actually tracks are overridden (untracked bones keep the lower layer), so a `full` clip
that does not key the fingers keeps the base finger pose.

### 2.4 Timing: clock, warp, events, root motion

#### 2.4.1 Clock

`Animator.step(dt)` runs inside `Player.step` (60 Hz fixed step [V1 §10]). For each active clip:
`clipTime += dt · rate(t)` where `rate` comes from the warp map. Events whose clip time is crossed in this step
are appended to `events` with the exact game time of crossing (`tStep + (tEv − tOld)/rate`) and consumed by
`game.js` in the same step. The render pass evaluates at `clipTimeRender = prevClipTime + alpha·(clipTime −
prevClipTime)` (same alpha as positions [V1 §10]).

#### 2.4.2 Segment time-warp (`play(..., {warp})`)

A warp is a monotone piecewise-linear map from game time since `play` to clip time, defined by anchor pairs
`(gameTime_k, clipEventTime_k)` with `(0, 0)` first; after the last anchor the clip runs at `rate = tempo⁻¹`.
Gameplay supplies anchors for any subset of the clip's events. Rules:
- anchor rates are clamped to `[0.4, 2.5]` (beyond that the selector must choose a different clip);
- anchors can be updated while playing (e.g. `land` once the physics knows it); the map is rebuilt from the
  current `(gameTime, clipTime)` point so the clip never jumps backwards;
- `hold(evCode)` freezes clip time at that event until `releaseNow()` or a timeout (used by the shot set
  point, §5.1).

#### 2.4.3 Root motion (`root: 'motion'`)

The clip's `R(t) = (x, z, yaw)` curve is relative to the clip-start frame (start position `p0`, start yaw `ψ0`).
Each fixed step the Player does **not** teleport; it sets its velocity and yaw rate from the clip derivative so
collisions, separation and court clamps still apply [V1 §5.10]:

```
dR   = R(clipTime_new) − R(clipTime_old)                      // in clip-start frame, metres × sLeg
vDes = rotateY(ψ0, (dR.x, dR.z)) / dt                         // world
entry 'replace': vel = vDes
entry 'carry'  : vel = vDes + vIn · exp(−(t − t0)/0.25)       // vIn = velocity at play()
entry 'stop'   : vel = vDes + vIn · max(0, 1 − entryDecel·(t − t0)/|vIn|)   until 'takeoff', then constant (no air control)
yaw  += (dR.yaw) ; position integrates vel as in v1
```

Airborne segments never change velocity except through `R` authored drift (fades). Rotations of the root
(`R.yaw`) are applied to the gameplay `yaw` directly (spins, turnarounds) and the v1 automatic yaw-toward-velocity
rule is suspended while a root-motion clip is active.

#### 2.4.4 Target matching (`target` + `play(..., {target:{x, z, yaw}})`)

For approach clips (layups, dunks, euro step, floater, post moves) gameplay passes where the character must be at
the clip's `target` event (takeoff spot, catch spot). Before the target event the root curve is warped:
`R'(t) = R(t) + (Δ) · smoothstep(t / tTarget)` with `Δ = target − R(tTarget)` expressed in the clip-start frame;
`yaw` likewise. Allowed warp: |Δ| ≤ 35 % of the clip's own displacement to `tTarget` (min 0.25 m) and |Δyaw| ≤ 25°;
otherwise `select.js` must choose another clip (one-step instead of two-step, jump-stop, etc.). Foot targets
before `tTarget` are warped with the same `Δ` weighted by their key time.

#### 2.4.5 Jumps (vertical authority)

Gameplay owns `jumpY(t)` (blocks, rebounds, catches and shot release heights depend on it). The animation
contract:
- every jumping clip has `takeoff` and `land` events and a nominal `jump.h`;
- gameplay starts the ballistic jump **at the `takeoff` event** with height `h` (from §5/§6 tables × rating rules
  of the gameplay section) and airtime `T = 2·sqrt(2h/g)`, `jumpY(τ) = vy·τ − ½gτ²`, `vy = sqrt(2gh)`
  (D-ANIM-7; replaces v1's fixed `h·sin(πt/0.55)`);
- the animator warps the clip's `[takeoff, land]` segment to `T` (`setJump(h, T)`), ignores authored pelvis `dy`
  keys strictly inside the segment (uses linear `dy` between the takeoff and landing values) and adds `jumpY`;
- dunks use a three-part profile (rise to the rim, hang, drop; §5.6) supplied the same way.

#### 2.4.6 Socket queries in the fixed step

`querySocket` evaluates the action layer (and base if needed) at the current step time **only for the bone chain
of that socket** (pelvis → spine_01..03 → clavicle → upperarm → lowerarm → hand: 8 bones, plus `jumpY` and root
transform) and applies the two-hand IK closure analytically when the ball mode is `both` (average of both
`ball1` sockets). Used for: ball position while held (`ball.js`), shot/pass/dunk launch position, block/contest
hand position, rebound/catch hand position, steal swipe hand position. Cost ≈ 2 µs per query.

### 2.5 Ball attachment and release

| mode | ball centre (sim and render) | hands |
|---|---|---|
| `R` / `L` | `ball1_s` socket of that hand | the other hand free (FK) |
| `both` | `c = ½(ball1_R + ball1_L)`; each hand IK-corrected so its `ball1` equals `c` when the error < 0.15 m (weight fades to 0 between 0.15 and 0.25 m) | both on the ball |
| `drib` | procedural dribble path (§4.1) | dribble hand IK to the ball top during contact |
| `path` | authored `Bp` path (Catmull-Rom), with the `HAND_ON` events snapping the hand IK to the ball | IK during contact windows |
| `free` | physics (`ball.js`) | — |
| `keep` | no change from the previous mode | — |

Release: at a `release` event (passes, dunks `slam`, layups, hooks, floaters) or at `releaseNow()+0.05 s` (jump
shots, §5.1) the animator emits `RELEASE` with the socket world position at that exact step; `game.js` calls
`ball.launch(v, state, info)` from that position (velocity from the arc solver / pass solver, unchanged in
principle from [V1 §4.5/§5.9]). The rendered ball switches to physics interpolation from the next frame; because
the socket and the launch point are the same point, there is no pop. Catch: when `ball.js` attaches the ball to a
player (`catch` rule of the gameplay section) the animator receives `onCatch(mode)` and plays the catch clip; the
ball is drawn at the socket (sim position = socket) from that step on.

Render-time detail: while attached, the **rendered** ball position is the socket of the **rendered** skeleton
(computed after IK in `evaluate`), not the interpolated sim position; the sim position is the step query. They
differ by at most one step of motion (invisible).

### 2.6 Procedural layers

#### 2.6.1 Lean (additive, every player, every frame)

```
aF = dot(accelWorld, forward)       aC = speed · yawRate (centripetal, signed: + = turning left)
leanPitch = clamp(1.6°·aF, −8°, +12°)  + gait trunk lean (§3.2)
leanRoll  = clamp(1.3°·aC, −14°, +14°)  (+ = lean toward own left, into a left turn)
smoothed with a critically-damped spring, ω = 8 rad/s; distribution: pelvis 40 %, spine 60 % (split per §1.3)
```
`accelWorld` is the finite difference of the interpolated velocity over the last 3 fixed steps (noise-free).
Disabled (weight 0, 0.1 s fade) during airborne clips and celebrations.

#### 2.6.2 Breathing (additive)

`b = sin(2π·f·t)`, `f = 0.25 + 0.30·(1 − stamina)` Hz, amplitude multiplier `m = 1 + 1.5·(1 − stamina)`:
`spine_03 pitch −1.2°·m·b` (chest rises = extension), `clavicle elev +1.0°·m·b` both sides, `neck pitch +0.6°·m·b`.
Weight 1 at idle, 0.4 while moving, 0 during actions. Kobe/Yao/LeBron "deep breath" habit (§8.3) multiplies `m`
by 2.5 for one 3 s cycle.

#### 2.6.3 Look-at (neck/head + iris)

- Origin `eyeC`; target from the current `look` key or the state default (§10.2). Direction expressed in the
  `spine_03` frame → `yaw = atan2(dx, dz)`, `pitch = −atan2(dy, hypot(dx, dz))`.
- Limits: yaw ±80° (beyond 70° the excess is given to spine_03 yaw up to 12° when the base layer is
  locomotion/idle), pitch −40° (up) .. +30° (down).
- Split: neck 40 %, head 60 %. Applied as an additive rotation on top of the layer result, scaled by
  `lookWeight` (default 1 in locomotion, 0.5 during shots — the clip already aims the head, 0 when a clip keys
  `look:'none'`).
- Smoothing: critically-damped spring per angle, ω = 12 rad/s (settles ≈ 0.25 s), max angular speed 400°/s.
- Iris: the eye group's UV is a front disc with the pupil at (0.5, 0.5) [RIG]; the eye material gets a
  per-player uniform `eyeOffset` (vec2) added to the UV before sampling the iris/pupil layers (rendering section
  implements the shader chunk). `eyeOffset.x = clamp(remYaw/35°, −1, 1)·0.10`,
  `eyeOffset.y = clamp(remPitch/30°, −1, 1)·0.07`, where `remYaw/remPitch` are the residual angles the head did
  not cover (target minus head direction). Eye spring ω = 30 rad/s; saccade: every 0.6–2.2 s (cosmetic RNG) a
  random jitter of ±0.02 UV for 0.15 s when idle.

#### 2.6.4 Two-bone IK (analytic, `ik.js`)

Chain A (root joint) → B (mid joint) → C (end effector), world positions from the current matrices, target `T`,
pole hint `Ph`, weight `w`. Zero-allocation, module-level temporaries:

```
lab = |B−A|, lcb = |C−B|, lat = clamp(|T−A|, 0.01, 0.999·(lab+lcb))
ac_ab_0 = acos(clamp(dot(n(C−A), n(B−A))))      ba_bc_0 = acos(clamp(dot(n(A−B), n(C−B))))
ac_at_0 = acos(clamp(dot(n(C−A), n(T−A))))
ac_ab_1 = acos(clamp((lcb² − lab² − lat²) / (−2·lab·lat)))
ba_bc_1 = acos(clamp((lat² − lab² − lcb²) / (−2·lab·lcb)))
axis0   = n(cross(C−A, Ph−A))  (fallback n(cross(C−A, B−A)) when degenerate)
axis1   = n(cross(C−A, T−A))
qA_world⁻¹ and qB_world⁻¹ convert axes to local:
rA = axisAngle(qA_world⁻¹·axis0, ac_ab_1 − ac_ab_0) · axisAngle(qA_world⁻¹·axis1, ac_at_0)   (apply r0 then r2)
rB = axisAngle(qB_world⁻¹·axis0, ba_bc_1 − ba_bc_0)
localA = slerp(localA, localA·rA, w); localB = slerp(localB, localB·rB, w); update the A subtree world matrices
```

Pole hints (character frame, scaled by sLeg): knee = hip + R(yaw_foot)·(0, −0.5, +0.6) (knees track the toes);
elbow = shoulder + (±0.25 lateral, −0.35, −0.30) (elbow down-back-out) by default, `(±0.35, −0.10, +0.05)` for
overhead/dunk reaches (elbow out), `(±0.10, −0.45, +0.25)` for the dribble hand. Errors: reachable targets end
within 1 mm (unit test); unreachable targets straighten the chain toward the target.

Uses:
| use | chain | end effector | target | weight curve |
|---|---|---|---|---|
| foot lock (flat) | thigh → calf → foot | `ankle_s` | lock point (world) + `(0, ankleY, 0)` | 1 while locked; 0.08 s ease in/out at plant/lift |
| foot lock (toe) | thigh → calf → foot, then foot pitch from the clip | `ballJ_s` | lock point at y = 0.012 | same |
| hand on ball (`both`) | upperarm → lowerarm → hand | `ball1_s` | ball centre | §2.5 |
| dribble contact | idem | `palm_s` | ball top + (0, 0.012, 0) | 1 during the contact window, 0.05 s ramps |
| catch | idem (both) | `ball1_s` | predicted ball position at the catch time | 0 → 1 over 0.15 s before the catch |
| dunk slam / rim grab | idem (dunk hand(s)) | `ball1_s` then `rimHook_s` | slam point (§5.6), rim front point | 0 → 1 over the last 0.15 s before `slam`, 1 during the hang |
| block / contest contact | idem | `palm_s` | ball position (only when gameplay registers a block) | 0 → 1 over 0.06 s |
| tip / putback | idem | `palm_s` | ball | as block |

After IK the foot's world rotation is set to `yaw_lock` (flat mode) or the clip's foot pitch about the lock
point (toe mode), so soles stay flat on the floor; hand world rotation stays as solved (the clip's wrist angles).

#### 2.6.5 Foot locking (anti-slide)

- A foot is **locked** when the active source (gait §3.3 or a clip's `Rft/Lft`) marks it planted. Lock point
  = world position of `ankle_s`/`ballJ_s` at the plant moment (gait) or the clip target transformed by the
  clip-start frame (clip).
- While locked, the point is fixed in world space even if the body moves (root motion, separation pushes).
- Release when the source lifts the foot, or **auto-release** if the required leg length exceeds 0.995·(thigh +
  calf) by more than 0.10 m or the hip-to-lock horizontal distance exceeds 0.75·legLen; an auto-released foot
  re-plants after a 0.18 s swing to the source's target ("catch-up step"), arc height 0.06·sLeg.
- Pivot: a toe-locked foot whose clip `yaw` changes rotates in place about the lock point (spins, turnarounds).

### 2.7 Finger presets (`presets.js` → `FINGERS`)

Values: curl for `_01/_02/_03` (deg) for index, middle, ring, pinky; spread on `_01` (deg, magnitude; signs per
§1.4); thumb `[tFlex, tAbd, tRot]` on thumb_01 and curl on thumb_02/03. All relative to the bind hand (the bind
fingers are already ≈ 15–20° curled [HDR]).

| preset | index | middle | ring | pinky | spread i/m/r/p | thumb_01 [flex, abd, rot] | thumb_02/03 | use |
|---|---|---|---|---|---|---|---|---|
| `relax` | 8/10/6 | 10/12/8 | 12/14/8 | 14/16/10 | 0/0/0/0 | [5, 5, 0] | 5/5 | default |
| `grip` | 0/8/5 | 0/8/5 | 2/8/5 | 4/10/6 | 12/0/8/16 | [0, 40, 20] | 5/5 | ball in one or two hands |
| `shoot` | −5/5/3 | −5/5/3 | −3/6/4 | 0/8/5 | 10/0/7/14 | [0, 50, 25] | 0/0 | shooting hand at set |
| `snap` | 30/40/25 | 35/45/25 | 35/45/25 | 30/40/25 | 0/0/0/0 | [15, 20, 10] | 15/10 | follow-through "goose neck" |
| `spread` | −8/0/0 | −8/0/0 | −8/0/0 | −8/0/0 | 18/0/12/25 | [0, 60, 20] | −5/−5 | block, contest, verticality, target hand |
| `palmUp` | 0/4/2 | 0/4/2 | 0/4/2 | 0/4/2 | 10/0/8/14 | [0, 40, 10] | 0/0 | calling for the ball |
| `fist` | 85/95/70 | 85/95/70 | 85/95/70 | 85/95/70 | 0/0/0/0 | [40, 20, 30] | 40/30 | celebrations, flex |
| `point` | 0/0/0 | 85/95/70 | 85/95/70 | 85/95/70 | 6/0/0/0 | [35, 15, 25] | 35/25 | Kobe finger up, Jordan point |
| `claw` | 55/60/40 | 55/60/40 | 55/60/40 | 55/60/40 | 6/0/4/8 | [30, 10, 20] | 30/20 | rim grab |
| `shh` | 0/0/0 | 85/95/70 | 85/95/70 | 85/95/70 | 0/0/0/0 | [40, 10, 25] | 40/30 | Kyrie finger to lips |
| `flat` | 0/0/0 | 0/0/0 | 0/0/0 | 0/0/0 | 4/0/3/6 | [0, 25, 0] | 0/0 | chest slap, palms on floor, hands on hips |
| `curlTape` | (Kobe idle) animated: curl 0→60→0 at 0.8 Hz on index/middle/ring/pinky with 0.05 s staggers | | | | | | | Kobe idle finger flex |

Automatic grip: whenever a hand's `ball1` socket is within 0.18 m of the ball centre and the ball is attached to
this player, that hand blends to `grip` (or keeps `shoot` if keyed) over 0.06 s.

### 2.8 Expressions (face layer)

Required morph targets (baked by the asset/face section from the [CFG] descriptors plus new descriptors; shared
deltas restricted to head vertices, applied to the body and propagated to the beard/eyebrow shells by the same
`(a, b, t)` blend that places shell vertices):

| name | players | description at weight 1 | default attack / release (s) |
|---|---|---|---|
| `jawOpen` | all | jaw drop 18° equivalent, lips parted 2 cm | 0.08 / 0.15 |
| `tongueOut` | jordan | `jawOpen` 0.6 + tongue 3 cm out, 1 cm down, 0.5 cm to his left ([CFG] uses `chin-jaw-drop 0.6`; the tongue delta is our own) | 0.10 / 0.12 |
| `jawJut` | kobe | lower jaw forward 1–1.5 cm, lower lip over the upper ([CFG]) | 0.15 / 0.30 |
| `roar` | lebron, giannis, yao | jaw fully open, teeth bared, brows down ([CFG]) | 0.10 / 0.25 |
| `grin` | yao, giannis | wide toothy smile, cheeks up ([CFG] yao) | 0.20 / 0.30 |
| `smirk` | kyrie, jordan | closed-lip half smile, asymmetric ([CFG] kyrie) | 0.20 / 0.40 |
| `scowl` | all | brows lowered 2–3 mm and drawn in, eyes narrowed (Kobe "Mamba stare" default 0.35) | 0.15 / 0.30 |
| `puff` | yao, lebron | cheeks puffed (exhale) | 0.10 / 0.20 |
| `blink` | all | upper lids closed | 0.05 / 0.07 |

If a target is not baked the channel is a no-op (the code checks `morphTargetDictionary`). Weights are smoothed
with the attack/release times above. Blink: every `2.5 + 3.0·rng` s (cosmetic RNG), 0.12 s total; suppressed
while `roar`/`grin` > 0.5. Idle expression baselines: kobe `scowl 0.35`, jordan `jawOpen` chewing
`0.06 + 0.06·max(0, sin(2π·1.5t))` (gum, [PROF:jordan]), lebron 0, giannis 0, yao 0, kyrie 0 (mouthguard is the
asset section's concern).

### 2.9 Zero-allocation rules

- All `Pose` objects (6 per animator: base, action, upper, scratch ×2, fadeSnapshot), gait/dribble state,
  event ring (32 records `{code, t, param}` preallocated) and IK temporaries are created in the constructor or at
  module scope.
- Clip ids and event names are resolved to integers at load (`CLIP.sigKobeTurnFade`, `EV.RELEASE`); no string
  comparisons in `step`/`evaluate`.
- Bones: `matrixAutoUpdate = false`; `evaluate` writes `bone.matrix.compose(pos, quat, ONE)` with module-level
  `Vector3`/`Quaternion` scratch objects (a standalone `Quaternion` has a no-op change callback, so no Euler sync
  cost). Then one `group.updateMatrixWorld(true)`; IK updates only the touched sub-trees
  (`bone.updateMatrixWorld(true)` on the chain root).
- Events are delivered by `game.js` reading `animator.events` (`head/tail` indices), never callbacks with
  closures.
- The unit test runs 600 steps + 600 evaluates of six animators through every clip family under
  `node --expose-gc` and asserts heap growth < 64 KB after warm-up (same method as the v1 alloc probes).

---

## 3. Locomotion (procedural, `locomotion.js`)

D-ANIM-2: a gait generator with IK legs replaces looping cycles. It adapts automatically to Yao's 1.17 m legs and
Kyrie's 0.94 m legs, never slides feet, and handles any speed/direction the gameplay produces (including tweens
and pushes). Inputs per fixed step: interpolation-free sim velocity `v` (world xz), `speed`, gameplay `yaw` ψ,
acceleration `a` (3-step finite difference), yaw rate, `onDefence`, `hasBall`, `stamina`, player `STYLE`.

### 3.1 Gait selection

| gait | speed range (m/s) | notes |
|---|---|---|
| idle | < 0.25 | stance by context (§3.8) + settle steps + idle habits (§8.3) |
| walk | 0.25 – 2.0 | inverted-pendulum bob (highest at mid-stance), heel strike |
| walk→run blend | 2.0 – 2.4 | duty factor and bob sign cross-fade over this band |
| jog | 2.4 – 4.0 | |
| run | 4.0 – 5.8 | forefoot strike |
| sprint | > 5.8 | (v1 sprint = 5.2 × 1.35 = 7.02 m/s; chase-down peak 8.5–9.0 [PROF:lebron]) |

Direction relative to the facing: `θ = angle(v) − ψ` wrapped to ±180°. Forward band |θ| ≤ 50°, side band
50–130°, back band ≥ 130°, with 20° cross-fade bands (parameters below are blended by angle, not switched).

### 3.2 Gait parameters (anchor speeds; linear interpolation between anchors; lengths × sLeg except where noted)

| parameter | v = 0.25 | 1.4 | 2.0 | 3.2 | 5.2 | 7.0 | 9.0 |
|---|---|---|---|---|---|---|---|
| duty factor β (stance fraction per foot) | 0.66 | 0.62 | 0.58 | 0.42 | 0.36 | 0.30 | 0.27 |
| swing height (m) | 0.04 | 0.08 | 0.10 | 0.16 | 0.24 | 0.30 | 0.32 |
| pelvis base drop (m) | 0.00 | 0.01 | 0.02 | 0.04 | 0.06 | 0.07 | 0.08 |
| bob amplitude (m; walk: highest at mid-stance, run: lowest) | 0.010 | 0.025 | 0.025 | 0.045 | 0.050 | 0.045 | 0.040 |
| pelvis yaw amplitude (deg) | 2 | 5 | 6 | 7 | 8 | 9 | 9 |
| pelvis roll amplitude (deg) | 2 | 4 | 4 | 3 | 3 | 2 | 2 |
| pelvis lateral sway (m) | 0.010 | 0.020 | 0.018 | 0.012 | 0.010 | 0.008 | 0.006 |
| trunk lean forward (deg) = 2 + 2.3·v, cap 20 | 2.6 | 5.2 | 6.6 | 9.4 | 14.0 | 18.1 | 20 |
| arm swing amplitude (shoulder flex ±deg) | 6 | 18 | 22 | 35 | 50 | 60 | 62 |
| arm swing bias (flex deg) | 0 | 0 | 2 | 5 | 8 | 10 | 10 |
| elbow base / amplitude (deg) | 12/4 | 15/10 | 25/12 | 75/12 | 85/15 | 90/15 | 92/15 |
| arm abduction (deg) | 10 | 10 | 11 | 12 | 12 | 10 | 10 |
| foot pitch at strike (ank, deg) | −8 | −12 | −10 | −5 | +5 | +12 | +15 |
| toe-off plantar flexion (deg) | 10 | 20 | 22 | 25 | 30 | 35 | 38 |
| lock mode in stance | flat | flat → toe at 60 % stance | flat → toe at 60 % | flat → toe at 45 % | toe | toe | toe |

**Stride** (two steps): `λ = 2.3 · hipH · (v² / (g · hipH))^0.3 · STYLE.stride` (Alexander's dimensionless
relation; hipH from §1.5). Cycle rate `= v / λ` (cycles/s), cadence `= 2v/λ` (steps/s), step length `= λ/2`.
First two steps after a start from idle: step length × 0.6, cadence × 1.15.

### 3.3 Foot placement and swing (per foot; left foot phase φ, right foot φ + 0.5)

```
φ += dt · v / λ                                             // cycle phase, wraps at 1
stance when (φ_f mod 1) < β ; swing otherwise, u = (φ_f − β)/(1 − β)
at plant:  lockPoint = predictedRoot(t + 0.5·β·λ/v) + R(ψ_move)·(±w/2, 0)
           w = step width: 0.16 (walk) → 0.10 (run) → 0.08 (sprint) × sLeg;  ψ_move = heading of v
           foot yaw at plant = ψ_move + 7° toe-out (each foot outward), blended 30 % toward ψ when |θ| > 50°
swing path (cubic Bézier in world, parameter s = smootherstep(u)):
           B0 = lift-off point, B1 = B0 + up·1.2·swingH − fwd·0.10·sLeg (heel recovery),
           B2 = nextPlant + up·0.6·swingH + fwd·0.10·sLeg (reach), B3 = nextPlant
           nextPlant is re-predicted every step during the first 70 % of the swing, then frozen
foot pitch: stance per lock mode; swing: ank goes from toe-off plantar → −10° at u = 0.5 → strike pitch at u = 1
pelvis:    y = rest − baseDrop − bob(φ) + leanDrop;  bob(φ) = A·(½ ∓ ½·cos(4π(φ − β/2)))  (− walk / + run)
           yaw = −A_yaw·cos(2πφ) ; roll = −A_roll·cos(2π(φ − β/2)) ; dx = +sway·cos(2π(φ − β/2))
spine:     spine_02/03 yaw = −0.8·pelvisYaw (shoulders counter-rotate), spine roll = STYLE.sway·sin(2πφ)
arms:      R shoulder flex = bias + amp·cos(2πφ) ; L = bias − amp·cos(2πφ) (right arm forward when the left foot strikes)
           elbow = base + amp_el·cos(...) on the same side ; pron 15 (palms in, slightly down); fingers 'relax'
head:      pitch stabilises the eyes: N.pitch = −0.85·(pelvis pitch + spine pitch) + STYLE.headCarry; yaw by look-at
legs:      two-bone IK from the hip to the ankle/ball-joint target with the knee pole of §2.6.4
```

### 3.4 Resulting stride and cadence (STYLE.stride applied)

| player | hipH (m) | walk 1.4: step m / steps·s⁻¹ | jog 3.2 | run 5.2 | sprint 7.0 |
|---|---|---|---|---|---|
| kobe | 1.077 | 0.75 / 1.87 | 1.23 / 2.61 | 1.64 / 3.17 | 1.96 / 3.57 |
| jordan | 1.074 | 0.75 / 1.87 | 1.22 / 2.61 | 1.64 / 3.17 | 1.96 / 3.57 |
| lebron | 1.109 | 0.76 / 1.84 | 1.25 / 2.56 | 1.68 / 3.10 | 2.00 / 3.49 |
| giannis | 1.190 | 0.85 / 1.65 | 1.39 / 2.29 | 1.87 / 2.79 | 2.23 / 3.14 |
| yao | 1.256 | 0.77 / 1.83 | 1.26 / 2.55 | 1.68 / 3.09 | 2.01 / 3.48 |
| kyrie | 1.013 | 0.69 / 2.04 | 1.13 / 2.84 | 1.51 / 3.44 | 1.80 / 3.88 |

(Yao: stride × 0.92 for his "short, heavy" strides [PROF:yao]; Giannis × 1.06 for his long-legged gait
[PROF:giannis]; Kyrie × 0.96, quick feet [PROF:kyrie].)

### 3.5 Directional gaits and facing

**Facing rules** (requirement on `Player.yaw`, which gameplay owns; v1 always turned toward velocity [V1 §5.10]):

| situation | yaw target | rate |
|---|---|---|
| offence, ball handler, speed > 1.5 | velocity heading | STYLE.turnRate |
| offence, ball handler, speed ≤ 1.5 | rim if within 9 m, else velocity | idem |
| offence, off-ball, speed > 2.5 | velocity | idem |
| offence, off-ball, slower | ball | idem |
| defence, on-ball, man within 3.5 m and speed < 4.2 | the man (delayed position used by AI) | idem |
| defence, off-ball, speed < 3.0 | ball | idem |
| defence otherwise | velocity | idem |
| root-motion clip active | the clip (§2.4.3) | — |

**Backpedal** (back band): stride × 0.60, duty + 0.06, swing height × 0.6, trunk lean fixed 4° forward, arms on
defence `[40, 30, 0, 60, 30, 0, 0]` both sides (no swing), offence swing × 0.5. Above 4.5 m/s backward the facing
rule makes the player turn and run.

**Side band, offence** ("open-hip run"): forward gait geometry along the velocity with the pelvis yawed toward the
velocity by `0.8·clamp(θ, −45°, 45°)`, spine counter-yaw so the chest stays toward ψ.

**Defensive slide** (side band, `onDefence`, speed ≤ 4.2):
- rest width `w0 = STANCE.def[p].width · sLeg` (§3.8); per cycle the lead foot (movement side) steps out to
  `w0 + dc`, then the trail foot closes to `w0`; `dc = clamp(0.30 + 0.12·v, 0.30, 0.75) · sLeg · STYLE.slide`;
  cycle rate = `v / dc` (e.g. v = 3.0 → dc 0.66 → 4.5 Hz; v = 1.5 → 0.48 → 3.1 Hz);
- lead foot swing in phase 0–0.25, trail foot swing 0.50–0.75 (double support 50 %), swing height 0.05 · sLeg,
  feet never closer than 0.25 m (no crossing), both feet toe-locked with ank +8 (on the balls of the feet);
- pelvis: defensive stance drop, bob ±0.015, dx follows the feet midpoint, no yaw oscillation;
- upper body: the player's stance arms (§3.8) with the "active hands" additive (±10° shoulder flex at 2 Hz,
  opposite phase per hand);
- over 4.2 m/s, or after 1.2 s of continuous slide above 3.5 m/s, the facing rule turns the hips (open and run).

### 3.6 Per-player style (`STYLE`) [PROF:* mannerisms/running notes]

| parameter | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| tempo (non-air segments of action clips; >1 = slower) | 1.00 | 0.97 | 1.02 | 1.05 | 1.12 | 0.92 |
| stride × | 1.00 | 1.00 | 1.00 | 1.06 | 0.92 | 0.96 |
| trunk lean add (deg) | 0 | +1 | +2 | +1 | −4 (upright) | +1 |
| arm swing amplitude × | 1.00 | 1.05 | 1.10 | 1.05 | 0.65 | 0.95 |
| elbow add (deg) | 0 | 0 | 0 | 0 | +10 (forearms near horizontal) | −5 |
| arm abduction add (deg) | 0 | 0 | +4 | +2 | +8 | 0 |
| bob × | 1.00 | 1.00 | 0.90 | 1.10 | 0.80 | 1.25 (bouncy) |
| shoulder sway (spine roll amp, deg) | 1.5 | 1.5 | 2.0 | 2.0 | 4.0 | 1.5 |
| head carry (neck pitch add, deg) | +5 (forward head carry) | 0 | −3 (chest up) | 0 | 0 | 0 |
| slide dc × | 1.00 | 1.05 | 0.95 | 1.10 | 0.80 | 1.00 |
| turn rate suggestion for gameplay (rad/s; v1 12) | 12 | 12.5 | 11 | 11 | 8 | 14 |
| idle toe-bounce | — | — | — | 2.0 Hz, ank ±4° | — | 1.6 Hz, ank ±3° |
| dribble style (§4.1) yTop × / f × / push × | 1/1/1 | 1/1/1 | 0.95/1/1.15 | 1/0.95/1.3 | 1.15/0.85/0.9 | 0.90/1.10/1 |

### 3.7 Idle, starts, stops, cuts, turns

- **Idle weight shift**: every 2.5–4.0 s (cosmetic RNG) pelvis dx ±0.03 · sLeg over 0.6 s, the unloaded knee
  flexes 8°, the loaded hip roll 3°.
- **Settle steps**: entering idle, any foot > 0.12 · sLeg from its stance target or > 30° from ψ steps there
  (0.22 s, height 0.05 · sLeg), farther foot first, at most 2 steps, 0.06 s apart.
- **Turn in place** (speed < 0.4, ψ changing): pelvis follows ψ, feet stay locked; when a foot needs > 35° hip
  internal/external rotation it steps to its stance target under the new ψ (0.20 s per step; turning left → left
  foot first); spine yaw leads ψ by up to 15° when |ψ̇| > 3 rad/s. A 180° turn = 3 steps in ≈ 0.55 s.
- **Start** from idle with |a| > 6 m/s²: the foot that is farther behind along the new direction lifts first;
  first two steps short and quick (§3.2); lean from §2.6.1 (up to 12°).
- **Hard stop** (speed falls below 1.2 m/s with deceleration > 8 m/s²): the next contact plants flat with
  ank −5°, knee 35°, extra pelvis drop 0.05 · sLeg, trunk −6° (back) for 0.25 s, then settle steps.
- **Cut with plant foot** (heading change Δ > 35° within 0.15 s at speed > 3.0): the next contact is forced to
  the **outside foot** (cutting left → right foot), placed 0.15 · sLeg further outside than predicted; its stance
  lasts `0.10 + 0.06·Δ/90°` s extra; at plant: pelvis drop `0.04 + 0.04·Δ/90°` m, knee `35 + 20·Δ/90°`°, roll into
  the new direction `8 + 8·Δ/90°`° (additive to the centripetal lean), foot yaw halfway between old and new
  heading. Δ ≥ 135° = reversal: plant + toe-locked pivot on the outside foot while ψ turns (12 rad/s → 0.26 s).
- **Teleport** (> 1.5 m in one step, e.g. formation snap): gait phase reset, foot locks released, 0.20 s pose
  crossfade, settle steps (no stretched legs, [REV#36]).

### 3.8 Stances (stationary base poses; feet are IK targets, legs listed as pole/FK hints)

| stance | P | S | N | arms | legs (hint) | feet `[x, z, yaw]` (× sLeg) | use |
|---|---|---|---|---|---|---|---|
| `stand` | [0,−0.01,0, 3,0,0] | [2,0,0] | [0,0,0] | RA/LA [5,10,0,12,0,0,0] | [3,0,0,5,−2,0] | R [−0.17,0.00,−5], L [0.17,0.00,5] | dead balls, walk-ups |
| `tripleThreat` | [0,−0.105,0, 12,0,0] | [18,0,0] | [−22,0,0] | RA [15,18,20,75,40,−25,0] (hand on top/behind the ball at the right hip), LA [40,5,60,85,0,−15,0] (hand on the side), `B:'both'` | [23,6,5,50,−15,0] | R [−0.29,0.04,8], L [0.29,−0.03,8] | holding after a catch / CHECK |
| `postUp` | [0,−0.12,0, 8,0,0] | [10,0,0] | [−15,30,0] | RA/LA [55,45,35,125,15,−25,0] (ball chinned) | [35,8,0,45,−10,0] | R [−0.38,0,0], L [0.37,0,0] | back to basket with ball |
| `postSeal` | [0,−0.12,0, 8,0,0] | [10,0,0] | [−10,−35,0] (over the right shoulder to the passer) | LA [60,20,−20,95,60,0,0] (forearm on the defender's back), RA [150,20,0,30,−60,−30,0] `RF:'palmUp'` (target at ≈ 2.9 m for Yao) | [35,10,0,45,−10,0] | R [−0.42,0,0], L [0.42,0,0] | sealing, calling for the ball [PROF:yao] |
| `boxOut` | [0,−0.16,−0.06, 20,0,0] (hips back) | [12,0,0] | [−25,0,0] | RA/LA [20,90,−30,90,−40,0,0] (arms out, forearms up) `F:'spread'` | [40,12,0,55,−15,0] | R [−0.42,0,0], L [0.42,0,0] | after a shot, §6.7 |
| `def` | per player below | | | | | | |

**Defensive stance per player** (`STANCE.def[p]`) [PROF:* defensive notes]:

| player | width (m) | P | S | N | RA | LA | notes |
|---|---|---|---|---|---|---|---|
| default | 0.75 | [0,−0.17,0, 15,0,0] | [15,0,0] | [−25,0,0] | [45,30,0,30,60,0,0] (ball hand low) | [100,55,0,35,−20,0,0] (pass hand high) | knees ≈ 60° |
| kobe | 0.85 | [0,−0.24,0, 18,0,0] | [14,0,0] | [−28,0,0] | [70,75,0,25,−30,0,0] | [70,75,0,25,−30,0,0] | very low and wide, arms wide; "feet buzz" ank ±5° at 4 Hz when stationary on-ball |
| jordan | 0.80 | [0,−0.25,0, 18,0,0] | [12,0,0] | [−26,0,0] | [40,25,0,30,60,0,0] (right low, mirrors the ball) | [110,50,0,35,−20,0,0] (left high, denies) | back flat ≈ 30° |
| lebron | 0.78 | [0,−0.16,0, 12,0,0] | [10,0,0] | [−18,0,0] | [55,45,0,35,20,0,0] | [55,45,0,35,20,0,0] | chest up, wall-off |
| giannis | 0.90 | [0,−0.22,0, 15,0,0] | [12,0,0] | [−22,0,0] | [85,85,0,15,−40,0,0] `RF:'spread'` | same, `LF:'spread'` | 2.2 m "wall" of arms at shoulder height |
| yao | 0.70 | [0,−0.07,0, 6,0,0] | [6,0,0] | [−8,0,0] | [45,45,0,60,−30,0,0] | same | hands at shoulder height, verticality-ready |
| kyrie | 0.70 | [0,−0.18,0, 15,0,0] | [14,0,0] | [−24,0,0] | [40,35,0,35,60,0,0] | [40,35,0,35,60,0,0] | active low hands ±10° at 2 Hz |

Feet for `def`: R `[−w/2, 0.03, −10]`, L `[w/2, −0.03, 10]` (slightly staggered, toes out 10°), toe-locked with
ank +8 (weight on the balls of the feet). Legs hint `[40,14,0,60,−12,0]` (Yao `[18,8,0,25,−6,0]`).

---

## 4. Ball handling

### 4.1 Dribble (`dribble.js`, procedural, phase-locked)

Cycle phase ψd ∈ [0, 1), period `T = 1/f`:
- `0` = ball leaves the palm moving down; free fall to the floor until `a = 0.294` (0.70 × 0.42);
- floor bounce at `a` (`EV.BOUNCE`, `audio.bounce(0.5)` as in [V1 §5.7]);
- free rise until the hand meets it at `c = 0.70`;
- contact window `[0.70, 1.00)`: the hand cushions the ball up to the top (`0.82`) then pushes it down.

Ball vertical kinematics (exact, per cycle, constants recomputed only when parameters change at a contact):
```
yr = yTop − 0.12 (release), yc = yTop − 0.06 (catch), R = 0.12
td = a·T ; tu = (c − a)·T
down: y(τ) = yr − w·τ − ½gτ²,  w = (yr − R − ½g·td²)/td
up:   y(τ) = R + u·τ − ½gτ²,   u = (yc − R + ½g·tu²)/tu
contact: ball = palm socket − (R + 0.010)·palmNormal (palm faces down); hand target y follows
         yc → yTop (ease-out, 0.70→0.82) → yr (ease-in, 0.82→1.00)
```
Example (still mode, ref body): f 1.9 Hz → w 3.8 m/s down, u 4.65 m/s up (implied restitution 0.87).
Horizontal: during the fall the ball moves linearly from the release point to the bounce point
`B = predictedRoot(t_bounce) + R(ψ)·(side·bx, bz)·sLeg`; during the rise from `B` to the predicted hand position
at the catch time. `side` = +1 for the left hand, −1 for the right (character frame).

| mode | condition | f (Hz) | yTop (m × sLeg) | bounce (bx, bz) | hand rest (hx, hz) | arm FK between contacts |
|---|---|---|---|---|---|---|
| still | speed < 0.5 | 1.9 | 0.95 | (0.32, 0.22) | (0.30, 0.20) | `[25,15,15,65,90,10,0]` |
| protect | speed < 2.5 and a defender within 1.0 m in front | 2.8 | 0.62 | (0.42, 0.02) | (0.38, 0.02) | `[15,25,10,55,90,15,0]`; off arm bar `[60,45,40,90,20,0,0]` |
| walk | 0.5–2.4 | one bounce per step, clamp 1.6–2.2 | 0.92 | (0.30, 0.35 + 0.10·v) | (0.28, 0.25) | idem still |
| jog | 2.4–4.0 | one per step, clamp 2.2–2.8 | 0.88 | (0.28, 0.45 + 0.08·v) | (0.26, 0.30) | `[30,14,15,70,90,10,0]` |
| run | 4.0–5.8 | one per two steps (cadence/2), clamp 1.5–1.8 | 0.95 | (0.24, 0.70 + 0.08·v) | (0.24, 0.40) | `[35,12,15,60,90,15,0]` |
| speed | > 5.8 | one per two steps, clamp 1.7–1.95 | 1.00 | (0.22, 1.25) | (0.22, 0.45) | `[45,10,15,45,90,20,0]` (pushes out ahead) |
| backdown | post state | 1.6 | 0.70 | (0.35, −0.10) | (0.33, −0.05) | `[10,25,10,70,90,10,0]`; off arm on the defender `[45,30,−10,80,40,0,0]` |

Per-player multipliers from `STYLE.dribble` (§3.6). Mode/parameter changes are applied only when the ball is in the
hand (ψd ∈ [0.70, 1.0)) so the path never jumps; values blend over one cycle.

**Step sync** (walk/jog/run/speed): the release (ψd = 0) is locked to the strike of the foot **opposite** to the
dribbling hand (every strike for one-per-step, every other strike for one-per-two-steps). A phase-locked loop
adjusts the rate: `ψd' = f + 2.0·wrap½(ψd_target − ψd)` (converges in ≈ 0.5 s, never jumps).

**Low window** for the steal bonus [V1 §5.11]: `dribble.lowWindow = ballY < 0.45` (the gameplay section may
keep or change the threshold).

**Pickup / gather** (shot, pass, pickup to hold): if ψd ∈ [0.60, 1.0) the ball is caught at the next hand contact
(≤ 0.12 s); if ψd ∈ [0, 0.60) the remaining path is time-compressed × 2 so the ball reaches the hand within
0.12 s; the other hand joins over 0.08 s (`B:'both'`). The body part of the requested action (dip, step) starts
immediately at the input (D-ANIM-8); the pickup only delays the ball.

### 4.2 Dribble moves (clips; `root:'motion'`, `B:'path'`, all authored right→left and mirrored)

Keys use the DSL of §2.2 (offsets × sLeg, degrees, `_` = not keyed). Ball path `Bp` in the clip-start frame.
`imm` = suggested steal-immunity window for gameplay; `exitV` = velocity at the end of the clip (start frame,
m/s), which gameplay keeps as the player's velocity when control returns.

**`move.cross`** — crossover R→L (generic; dur 0.40, entry `replace`, cancel 0.30, imm [0.05, 0.30],
exitV (2.6, 3.0))
```
0.00 P[0,-0.06,0, 10,0,0] S[14,0,0] RA[30,14,15,70,90,10,0] LA[20,12,0,30,15,0,0] Rft[-0.24,0.10,0,'t'] Lft[0.22,-0.30,0,'t'] B'path' Bp[-0.30,0.80,0.28]
0.05 ev plantR
0.08 P[-0.06,-0.14,0, 16,-8,4] S[20,-10,6] RA[25,5,35,80,95,30,0] RC[_,15] Bp[-0.20,0.55,0.30]
0.13 ev bounce  Bp[0.00,0.12,0.36]  Lft[null]  LL[45,20,0,70,15,0]
0.18 P[0.04,-0.15,0.05, 18,10,-6] S[22,12,-8] RA[20,10,20,40,40,0,0] LA[28,15,20,70,90,10,0] Bp[0.18,0.45,0.34]
0.22 Rft[null]  RL[10,5,0,35,35,0]   (push-off complete)
0.24 ev handOnL  Bp[0.30,0.68,0.32]  B'drib'
0.28 ev plantL  Lft[1.00,0.52,10,'t']  RL[40,10,0,80,10,0]
0.40 P[0.02,-0.09,0, 12,4,0] S[16,4,0] Rft[0.80,0.85,0,'t'] ev plantR ev end
R keys: 0.00 [0,0,0]  0.10 [-0.05,0.10,0]  0.20 [0.35,0.25,0]  0.30 [0.78,0.42,0]  0.40 [1.00,0.60,0]
```
(Kyrie's signature `sig.kyrie.hesiCross` is the full-fidelity version, §9.6.)

**`move.btl`** — between the legs R→L (dur 0.36, entry `carry`, imm [0.05, 0.28]; stationary or slow). Feet
wide, LEFT foot forward [PROF:kyrie move 2]:
```
0.00 P[0,-0.12,0, 14,0,0] S[20,0,0] RA[25,18,10,70,90,15,0] Rft[-0.33,-0.15,0,'t'] Lft[0.35,0.25,0,'t'] B'path' Bp[-0.32,0.70,0.30]
0.08 RA[15,10,30,55,95,35,0] Bp[-0.12,0.40,0.18]
0.14 ev bounce  Bp[0.02,0.12,0.02]   (under the pelvis, between the feet)
0.22 LA[10,18,-10,55,90,10,0] Bp[0.22,0.40,-0.10] ev handOnL
0.36 P[0,-0.12,0, 14,0,0] LA[25,18,10,70,90,15,0] RA[25,15,0,40,20,0,0] Bp[0.32,0.70,0.10] B'drib' ev end   R[0.15,0.05,0]
```

**`move.btb`** — behind the back R→L while moving (dur 0.38, entry `carry`, imm [0.06, 0.30]):
```
0.00 RA[30,14,15,70,90,10,0] B'path' Bp[-0.30,0.80,0.30]
0.10 RA[-30,35,-55,75,90,25,0] S[16,0,-6] Bp[-0.28,0.55,-0.20]   (wraps behind the lumbar)
0.17 ev bounce Bp[0.00,0.12,-0.30]   (behind the heels)
0.26 LA[10,20,0,60,90,10,0] Bp[0.30,0.55,0.05] ev handOnL
0.38 B'drib' ev end ; R follows entry velocity ('carry') + lateral 0.35 toward the left
```

**`move.hesi`** — hesitation (dur 0.45, entry `carry` with speed scaled 0.40 over 0.05–0.22 then 1.25× from
0.26): pelvis rises `dy +0.06` at 0.12, `S` straightens to 5°, `N[−10,0,0]` look `rim`, soft high dribble
(`yTop × 1.12`), LA floats out `[20,30,0,30,0,0,0]` at 0.12; 0.22–0.30 drop `dy −0.10`, `S[25,0,0]`, explode
`R` forward; events `plantR 0.20`, `end 0.45`.

**`move.spin`** — reverse spin dribble (dribbling right hand, defender cutting off; dur 0.50, entry `replace`,
imm [0.08, 0.40], exitV (0.6, 4.2)):
```
0.00 P[0,-0.10,0, 14,0,0] S[18,0,0] Lft[0.25,0.45,30,'t'] Rft[-0.25,-0.05,0,'t'] B'path' Bp[-0.30,0.80,0.40]
0.06 ev plantL   RA[25,20,30,85,120,-10,0] (palm on top, ball pulled to the right hip) Bp[-0.28,0.70,0.10]
0.10 N[-5,60,0] (head turns first over the left shoulder) R[0,0.15,20]
0.20 R[0.15,0.30,140] P[_,-0.14,_, _,25,_] Rft[null] RL[30,30,0,70,10,0]
0.30 ev handOff   (ball switches to the left hand at ≈ 200° of rotation) B'L'
0.34 Rft[0.70,0.55,290,'t'] ev plantR R[0.45,0.60,270]
0.42 B'drib' R[0.62,0.90,330] Lft[0.25,0.45,330,'t']   (left forefoot pivot: yaw keyed 30 → 330 between 0.06 and 0.42)
0.46 Lft[null]
0.50 R[0.75,1.20,360] P[0,-0.09,0, 12,0,0] ev end
```
Root yaw totals +360° (ends facing the original direction, past the defender's hip on the left).

**`move.stepback`** (no shot; dur 0.45, entry `replace`, imm [0.08, 0.36], exitV (0, 0)): left foot plants forward
(0.08, `Lft[0.18,0.35,5,'t']`), push back: `R` z 0 → −0.75 over 0.10–0.30 (airborne hop 0.12 m), land L then R
(0.30/0.34) square, knees 55, ball to `both` at the chest at 0.22, back to `drib` at 0.36 unless a shot input is
held (then chain to `shot.stepbackJ`, §5.4).

**`move.jab`** (holding, triple threat; dur 0.35, root `none`): right foot jabs 0.35 forward (`Rft[−0.29,0.39,0,'t']`
at 0.12, back to `[−0.29,0.04]` at 0.30), `RL[30,_,_,40,_,_]`, ball sways 0.20 right (`RA abd +15`), `S` +10,
head dips (`P.dy −0.05`).

**`move.pumpFake`** (holding; dur 0.40): ball to the set point (`RA[115,6,18,95,85,−72,0]`, `LA` guide) at 0.18,
heels up (`ank +8`, pelvis `dy +0.03`), knees stay 30°, `N[−15,0,0]` look `rim`, shoulders shrug (`RC/LC elev 8`),
back to triple threat at 0.36. Event `fake 0.12` (AI defenders may bite).

**`move.rip`** (rip-through; dur 0.30): ball sweeps low across the knees from the right hip (`Bp[−0.30,0.75,0.15]`)
to the left hip (`[0.30,0.55,0.20]`) and up through the chest (`[0,1.15,0.30]`), elbows high, `S[25,_,_]`.

**`move.protect`** (upper layer; holds while the protect condition lasts): off arm bar `LA[60,45,40,90,20,0,0]`,
`S[_,−10,_]` turning the shielding shoulder toward the defender, dribble mode `protect`.

**`move.backdown`** (post): `postUp` legs, dribble mode `backdown`, root pushes back 0.25 m per dribble in two
0.18 s shoves with `EV.CONTACT` at each shove (gameplay displaces the defender per its strength rule); `LA` forearm
bar on the defender.

**`move.gather`** (upper): ball to both hands at the chest, 0.10 s, `B:'both'`, used before passes and holds.

**Kyrie idle combos** [PROF:kyrie]: when Kyrie holds a live dribble with speed < 0.5 for > 0.8 s and no move input,
he loops cosmetic `move.btl → move.cross → move.btl_L → move.cross_L` with root displacement scaled to 0 (in place),
1.6 s per loop; gameplay reads `animator.ballHand` to keep `handSign` consistent. Cancelled instantly (0.06 s) by
any input.

### 4.3 Move selection (`selectMove`, called on the tertiary tap on offence)

Stick relative to the facing: `lat = dot(move, left)`, `fwd = dot(move, forward)`; dribble hand `h` (R/L).

| condition (first match) | move |
|---|---|
| holding (not dribbling) & stick back (`fwd < −0.5`) | `move.pumpFake` |
| holding | `move.jab` (Kobe → `sig.kobe.jabSeries`, Jordan → `sig.jordan.jabPullup` up to the jab branch) |
| player is Yao | post: `sig.yao.dropStep`; else `move.pumpFake` (no dribble moves [PROF:yao]) |
| `fwd < −0.5` | `move.stepback` (Kyrie with `lat` toward the off hand → `sig.kyrie.doubleBtlStepback`) |
| `|lat| > 0.45` toward the off hand & speed > 3.5 | Kyrie `sig.kyrie.hesiCross`; Kobe `sig.kobe.hesiCrossStepback` (cross part); others `move.cross` |
| `|lat| > 0.45` toward the off hand & speed ≤ 3.5 | weights by player: Kyrie cross 0.35 / btl 0.30 / btb 0.20 / hesiCross 0.15; Kobe & Jordan cross 0.6 / btl 0.25 / btb 0.15; LeBron cross 0.7 / btl 0.3; Giannis cross 1.0 |
| `|lat| > 0.45` toward the dribble hand & defender within 1.2 m in front | `move.spin` (Kyrie, Kobe, Jordan, LeBron, Giannis) |
| speed > 2.5 | `move.hesi` |
| otherwise | `move.btl` (Kyrie, Kobe, Jordan), `move.cross` (others) |

Suggested gameplay multipliers carried in `params` (the gameplay section decides): freeze-chance × cross 1.0,
hesiCross 1.2, btl 0.8, btb 0.9, spin 1.0, stepback 0.7 (it creates space instead); ankle-break eligibility
(§6.9) only for cross, hesiCross and doubleBtlStepback.

---

## 5. Shooting and finishing

### 5.1 How the shot meter maps onto clip time (D-ANIM-5)

Definitions (all times from the shot input `press`, game seconds):
- `T½(h) = sqrt(2h/g)` (half airtime), g = 9.81.
- `takeoffT` — when the feet leave the floor (form table §5.2; includes the player's tempo).
- `tIdeal` — the input time that is a perfect release. **Ball launch = release input + 0.050 s** (the push from
  the set point to the release key always takes 3 fixed steps), so a perfect input launches the ball at
  `apex + rva` (rva = the player's release-vs-apex offset). Hence
  `tIdeal = takeoffT + T½(h) + rva − 0.050`.
- `METER_T = tIdeal / F_IDEAL` with `F_IDEAL = 0.80` [V1 §4.2], so the green band stays at 80 % of the bar for
  everyone while the bar fills at each player's own speed (Kyrie fastest, Giannis slowest). If the gameplay
  section instead keeps a single global `METER_T`, the animator back-solves
  `takeoffT = 0.80·METER_T − T½(h) − rva + 0.050` (clamped ≥ 0.10 s) and everything below still holds.

Clip behaviour:
1. **Press** → the shot clip starts (0.06 s ease-out entry). The dip is visible in the first rendered frame.
2. The clip is warped so `takeoff` lands at `takeoffT` and `set` at `tSet = tIdeal − setLead` (setLead
   0.07–0.14 s, §5.2). Gameplay starts the ballistic jump at `takeoff` (D-ANIM-7).
3. Reaching `set` before the input: the animator `hold`s at `set` and plays a 2 Hz micro-motion (elbow ±2°,
   wrist ±3°) so the shooter is "loaded", not frozen; the body keeps following `jumpY`.
4. **Release input at time `tu`** (any time after press): the clip jumps into the push segment: from the current
   clip time to the `release` key is time-warped into exactly 0.050 s (if the input comes *before* `set`, the
   remaining gather is compressed into the same 0.050 s — a visibly rushed push, which reads correctly as
   "early"). At `tu + 0.050` the `RELEASE` event fires with the hand socket position; the guide hand has left
   the ball at `tu` (`B` switches `both → R` at the input). Follow-through, landing and recovery play at normal
   rate after that.
5. **Late input** (after `tIdeal`): the hold continues while the body descends; the ball is launched from the
   lower, descending position. Auto-release at `f = 1.25` [V1] = `1.25·METER_T` behaves as an input then.
6. **Rules timing**: the shot is "released" for rules (shot clock, buzzer) at the input `tu` (the DOM
   `releaseTs`), exactly as v1; only the physical launch is 0.050 s later.
7. **Points** are decided by the root position at the `takeoff` event (the last floor contact, NBA rule) —
   fixes [REV#13] (a sprinting shooter whose momentum carries him inside the arc after leaving the floor still
   shot from where he took off; a shooter who dribbles inside before takeoff gets 2).
8. **CPU shooters** use the same path: the AI "releases" at `(0.80 + e)·METER_T` [V1 §7.1].
9. **Speed at release** (v1 move penalty): the jumper clip's entry policy is `stop` with 18 m/s² until takeoff,
   so a 5.2 m/s runner takes off at ≈ 2.1 m/s; gameplay evaluates the move penalty on the root speed at takeoff.
10. **Meter window for long signature shots.** Clips whose shot motion starts with a turn, spin or move carry a
   `meterFrom` time (clip seconds, a gather point). The HUD bar stays empty until `meterFrom`, then fills over
   `METER_T = (tIdeal − meterFrom) / 0.80`, so every bar the user sees fills in 0.44–0.62 s with the green band at
   80 %; `e = (tu − meterFrom)/METER_T − 0.80` (a release before `meterFrom` gives `e < −0.80`, i.e. a bad early
   release). Plain jumpers have `meterFrom = 0`. Values per signature clip are in its §9 header.

### 5.2 Per-player shooting forms (`FORMS`) [PROF:* shootingForm]

Arm arrays are `[flex, abd, int, elbow, pron, wFlex, wDev]` (right arm `RA`, guide `LA`). Heights in metres.

| field | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| takeoffT mid (s) | 0.17 | 0.15 | 0.26 | 0.36 | 0.32 | 0.17 |
| + three / + pull-up / + fade (s) | +0.04 / +0.05 / +0.04 | +0.04 / +0.04 / +0.04 | +0.04 / +0.05 / +0.04 | +0.06 / +0.04 / — | +0.04 / +0.06 / +0.04 | +0.03 / +0.04 / +0.04 |
| dip depth (m × sLeg) / knee at dip (deg) | 0.10 / 50 | 0.11 / 52 | 0.12 / 50 | 0.09 / 40 | 0.05 / 30 | 0.08 / 48 |
| ball at dip | waist | waist | hip | belt (deep) | chest (no dip) | belly (short) |
| h mid / three / pull-up / fade (m) | 0.50 / 0.42 / 0.52 / 0.50 | 0.55 / 0.40 / 0.55 / 0.60 | 0.30 / 0.20 / 0.38 / 0.40 | 0.25 / 0.12 / 0.25 / — | 0.18 / 0.12 / 0.20 / 0.28 | 0.35 / 0.30 / 0.40 / 0.40 |
| rva: launch vs apex (s) | −0.01 | 0.00 | −0.04 | −0.07 (on the way up) | −0.02 | −0.01 |
| setLead (s) | 0.08 | 0.08 | 0.08 | 0.14 (visible hitch) | 0.10 | 0.07 |
| set `RA` | [115,6,18,95,85,−72,0] | [118,7,18,92,85,−70,0] | [110,13,14,90,80,−70,0] | [100,18,10,98,80,−65,0] (low set) | [118,8,16,95,85,−77,0] | [120,4,22,98,85,−72,0] (tucked) |
| guide `LA` at set | [100,12,45,100,15,−20,0] thumb vertical | [102,14,40,98,10,−15,0] fingers up | [98,16,40,96,25,−15,0] thumb back | [92,18,35,100,10,−20,0] thumb up | [104,10,45,100,15,−20,0] fingers up | [104,10,45,100,15,−20,0] thumb up |
| release flex (shoulder, deg) | 162 | 160 | 152 | 145 | 168 | 160 |
| follow-through wrist (wFlex) | +70 | +88 (goose neck) | +60 | +60 | +75 | +70 |
| follow-through hold after launch (s) | 0.45 | 0.45 (1.0 "last shot" clutch make) | 0.30 | 0.40 | 0.60 (until the rim) | 0.40 (kept up walking back after a make) |
| guide after release | peels 10 cm, thumb up | opens 15 cm sideways | comes off clean | pops to the side | stays up as a mirror | stays up 10 cm away |
| fade drift (m) / lean back (deg) on fades | 0.45 / 18 | 0.55 / 15 | 0.45 / 15 | +0.15 forward drift on all jumpers / 0 | 0.35 / 12 | 0.10 / 8 (step-backs) |
| air legs on fades `RL` / `LL` (hip, knee) | 25,40 / 10,25 (slight split) | 42,65 / 5,10 (scissor kick) | 30,30 / 10,15 (right knee forward) | 15,20 / 15,20 | 15,15 / 15,15 | 10,20 / 10,20 (apart, toes forward) |
| head at set `N` | [−8,0,0] chin jut | [−4,0,0] | [−3,0,0] | [0,0,0] | [−2,0,0] | [−3,0,0] |
| face during the shot | `scowl` 0.4 | — (tongue in on jumpers) | — | — | — | — |
| expected ball-centre height at launch, mid-range (test ±0.08) | 2.87 | 2.89 | 2.66 | 2.65 | 2.88 | 2.59 |

Expected heights use the rig, not the profiles' fingertip estimates (profiles give 3.0 / 3.0 / 2.8–2.9 / 2.90 /
3.40–3.55 / 2.55 standing): the rig reach is 22–26 cm below listed reach [XCHK]; the scapular rhythm (§1.4)
recovers ≈ 7 cm. Gameplay always launches from the real socket, so no gameplay constant depends on these numbers.

**Derived timing** (`tIdeal` s / `METER_T` s = tIdeal / 0.80):

| shot | kobe | jordan | lebron | giannis | yao | kyrie |
|---|---|---|---|---|---|---|
| mid-range jumper | 0.429 / 0.536 | 0.435 / 0.544 | 0.417 / 0.521 | 0.466 / 0.583 | 0.442 / 0.553 | 0.377 / 0.471 |
| three | 0.443 / 0.554 | 0.426 / 0.533 | 0.412 / 0.515 | 0.456 / 0.570 | 0.446 / 0.558 | 0.387 / 0.484 |
| pull-up off the dribble | 0.486 / 0.607 | 0.475 / 0.594 | 0.498 / 0.623 | 0.506 / 0.633 | 0.502 / 0.628 | 0.436 / 0.545 |
| face-up fadeaway | 0.469 / 0.586 | 0.490 / 0.613 | 0.496 / 0.620 | — | 0.529 / 0.661 | 0.436 / 0.545 |

Signature shots (§9) carry their own `takeoffT` (e.g. the post turnarounds include the spin) and therefore
longer `tIdeal`; the same formula and the same 80 % green position apply.

### 5.3 `makeJumper(form, variant)` — generated keys (right-handed; `_L` by mirroring)

`variant ∈ {mid, three, pullHop, pull12, fade}`. Let `TO = takeoffT(variant)`, `h = h(variant)`,
`tI = TO + T½(h) + rva − 0.05`, `tSet = max(TO − 0.05, tI − setLead)`, `tRel = tI + 0.05`,
`tLand = TO + 2·T½(h)`, `tEnd = max(tLand + 0.25, tRel + followHold + 0.15)`; `D` = dip arms by `ball at dip`:
waist `RA[20,12,25,95,40,−25,0] LA[25,15,35,100,10,−15,0]`, hip `RA[15,15,25,85,40,−25,0] LA[20,15,40,95,10,−15,0]`,
belt `RA[10,12,25,85,40,−20,0] LA[15,15,35,90,10,−15,0]`, chest/belly = the 0.00 arms.

```
0.00   P[0,-0.03,0, 4,0,0] S[8,0,0] N[-6,0,0] RA[35,15,30,105,20,-30,0] LA[35,15,30,105,20,-30,0]
       RL[8,4,2,12,-4,0] LL[8,4,2,12,-4,0] Rft[-0.20,0.05,10,'f'] Lft[0.20,-0.02,10,'f'] RF'grip' LF'grip' B'both' look'rim'
0.6·TO P[0,-dip,0, 10,0,0] S[10,0,0] N[-12,0,0] RA,LA = D ; RL/LL[30,6,4,kneeDip,-(kneeDip-30),0]
TO     P[0,-0.02,0, 2,0,0] S[3,0,0] N[-4,0,0] RA[80,8,20,115,80,-55,0] LA[75,15,40,110,0,-20,0]
       RL[6,4,0,8,35,0] LL[6,4,0,8,35,0] Rft[null] Lft[null]                                  ev takeoff
tSet   RA form.set  LA form.guide  RF'shoot'  N form.head  P[0,0,0, -lean/2,0,0] S[-lean/2,0,0]
       RL[airR.hip,4,0,airR.knee,30,0] LL[airL.hip,4,0,airL.knee,30,0]  (mid/three: hip 10, knee 15 both) ev set
tRel   RA[relFlex,4,15,5,90,-15,0]  LA[guide.flex+5, guide.abd+15, guide.int-15, guide.elbow-20, guide.pron-20, 0, 0]
       B'free'                                                                                   ev release
tRel+0.10 RA[relFlex-3,4,15,0,95,followWrist,0] RF'snap'
tLand  P[0,-0.10,0, 8,0,0] S[6,0,0] RL[25,6,4,40,-12,0] LL[25,6,4,40,-12,0]
       Rft[-0.20,-drift,10,'f'] Lft[0.20,-drift-0.03,10,'f']                                    ev land
tRel+followHold  RA[relFlex-5,4,15,0,95,followWrist,0]                    (hold ends; ≥ tLand)
tEnd   P[0,-0.03,0, 4,0,0] S[4,0,0] N[0,0,0] RA[10,12,5,25,30,0,0] LA[10,12,5,25,30,0,0] RF'relax' LF'relax' ev end
R      [0,0,0] at 0 … TO ; [0, -drift, 0] at tLand   (drift = fade distance for 'fade', 0.15·(−1) forward for Giannis, else 0)
cancel = tLand + 0.10 ; mask full ; root 'motion' ; entry 'stop' (decel 18 m/s²)
```

Pull-up entries replace the first 0.12–0.14 s:
- `pull12` (1-2 stop, Kobe/Jordan/LeBron default; speed > 1.5): `Lft[0.20,0.35,10,'f']` plants at 0.06 (`ev plantL`),
  `Rft[−0.20,0.45,10,'f']` at 0.14 (`ev plantR`), entry `stop` decel 20 m/s², ball picked up per §4.1 by 0.12.
- `pullHop` (Kyrie, Giannis default; or speed > 4): both feet leave at 0.00, land together at 0.12 at
  `[±0.20, 0.30]` (`ev plantL`, `ev plantR`), entry `stop` decel 24 m/s².
Then dip → jumper as above with `+pull-up` takeoff offset. Face-up `fade`: drift and lean from the form table,
air legs from the form table, `takeoffT + fade offset`.

### 5.4 Other shot types (generic; signature versions in §9 override per player)

| clip | trigger (select.js) | structure | tIdeal rule |
|---|---|---|---|
| `shot.stepbackJ` | stick back + shoot while dribbling, or chained from `move.stepback` | plant forward foot 0.06, push back 0.70 m × sLeg (Kyrie 0.80, LeBron 0.50 [PROF]) over 0.10–0.28 with a 0.12 m hop, land L 0.28 / R 0.32 square 0.40 apart, load knees 55–70, takeoff at `0.42 · tempo`, fade 0.10–0.15 back, jumper set/release from the form | `0.42·tempo + T½(h_pull) + rva − 0.05` (kyrie 0.627 → METER 0.78) |
| `shot.turnFade` (generic post) | back to the basket within 5.5 m, players without a signature turnaround (Giannis, Kyrie) | Jordan-style left-foot pivot 180° over 0.33–0.60, load 0.60–0.70, fade per form | takeoff 0.70·tempo |
| `shot.hook` | Yao (signature §9.5), Giannis (rare, mirrors Yao's at 1.05 tempo) | | |
| `shot.floater` | Kyrie (§9.6); others use `shot.floaterGeneric` = Kyrie's keys at tempo 1.08 and h × 0.9 | | |
| `shot.scoop` | Kyrie wide-angle drives (§9.6 variant) | | |

### 5.5 Layups (`makeLayup`, right hand off the left foot; mirrored for the left hand)

Hand choice: approach on the shooter's right of the rim line (character frame at press) by > 0.4 m → right
hand; on the left → left hand; otherwise the hand away from the nearest defender (Kyrie, LeBron, Giannis) or the
right hand (Kobe, Jordan, Yao).

**Steps**: `lay.std2` (two-step gather; rim distance at press 2.5–4.0 m, speed ≥ 2.0) or `lay.std1` (one-step;
1.0–2.5 m or slower). Target matching (§2.4.4): the takeoff spot is placed `dTO` from the rim centre on the
approach line, `dTO = clamp(vAir·2·T½(h)·0.75, 1.0, 2.0)` with `vAir = 2.6 m/s` (Yao 1.8); the airborne root
moves toward a point 0.45 m in front of the rim centre and never past the backboard plane − 0.5 m.

`lay.std2` keys (lay.std1 = the same from the `0.26` key, re-timed so its first key is at 0.00 with the gather):
```
0.00 P[0,-0.08,0, 12,0,0] S[15,0,0] N[-10,0,0] RA[30,20,25,90,40,-25,0] LA[35,15,40,95,0,-15,0] B'both' RF'grip' LF'grip'
     Rft[-0.12,0.00,0,'f'] Lft[null] LL[40,5,0,70,10,0]                    ev gather, plantR
0.10 Rft[null]                                                            (right foot leaves)
0.26 P[0,-0.14,0, 5,0,0] S[5,0,0] Lft[0.10,1.20,0,'f'] RL[50,5,0,90,20,0]  ev plantL   (long penultimate step × sLeg)
0.36 P[0,-0.04,0, 0,0,0] S[2,0,0] N[-15,0,0] RL[95,5,0,100,30,0] LL[-10,3,0,10,40,0] Lft[null]
     RA[100,10,20,80,60,-40,0] LA[90,15,40,90,10,-20,0]                    ev takeoff
TO+0.10           B'R'  LA[60,30,30,60,0,0,0] (guard arm)  RA[140,8,15,40,60,-35,0]
TO+T½−0.03        RA[165,8,10,10,60,-20,0] B'free' E{jawOpen:0.3}          ev release (layups launch from the clip, input only scores timing)
TO+T½+0.07        RA[160,8,10,5,60,+25,0] RF'snap'
TO+2T½            RL[25,8,0,45,-10,0] LL[25,8,0,45,-10,0] Rft/Lft re-lock 0.35 apart          ev land
TO+2T½+0.30       arms down, ev end ; cancel at land + 0.10
```
Layup meter: the gameplay meter still applies to layups ([V1 §4.2] `METER_T_LAYUP` with a wider green); with this
clip `tIdeal = (TO + T½ − 0.03) − 0.05` and the launch happens at the clip's `release` key **unless** the input is
more than 0.10 s early/late, in which case the launch follows the input + 0.05 rule of §5.1 (a botched layup is
visibly rushed or flicked late).

| player | h layup (m) | TO std2 / std1 (s) | tIdeal std2 / std1 | METER_T std2 / std1 |
|---|---|---|---|---|
| kobe | 0.60 | 0.36 / 0.12 | 0.630 / 0.390 | 0.79 / 0.49 |
| jordan | 0.70 | 0.35 / 0.12 | 0.648 / 0.414 | 0.81 / 0.52 |
| lebron | 0.60 | 0.37 / 0.12 | 0.640 / 0.392 | 0.80 / 0.49 |
| giannis | 0.65 | 0.38 / 0.13 | 0.664 / 0.410 | 0.83 / 0.51 |
| yao | 0.30 | 0.40 / 0.13 | 0.567 / 0.301 | 0.71 / 0.38 |
| kyrie | 0.55 | 0.33 / 0.11 | 0.585 / 0.365 | 0.73 / 0.46 |

Layup family (select.js picks; defender = nearest opponent within 2.5 m of the rim):

| clip | when | difference from `lay.std` |
|---|---|---|
| `lay.fingerRoll` | open lane, Kyrie/Jordan/Giannis 40 %, others 15 % | `RA` at release `[160,8,10,10,−70,15,0]` (palm up), release at apex + 0.02, fingers `relax`, underspin flag for the ball |
| `lay.reverse` | baseline drive passing under the rim (approach angle to the baseline < 35°) | Kyrie signature keys §9.6 (generic users at their tempo) |
| `lay.euro` | defender in the lane in front within 1.5 m; Giannis 35 % of drives ([PROF:giannis]), others 15 % | Giannis §9.4 move 1 keys with steps × 0.75 (others) |
| `lay.power` | LeBron/Giannis/Yao when contact is expected (defender within 1.0 m) | two-foot jump stop at 1.2–1.8 m (pelvis −0.20 · sLeg), two-foot takeoff, off arm extended toward the defender `LA[90,60,0,20,−30,0,0]` (shield, not a push) |
| `lay.switch` | Jordan only, defender's arm in front at the rim | §9.2 "The Move" |
| `lay.spin` | Kyrie (and Giannis' spin gather) | §9.6 / §9.4 |
| `lay.upUnder` | Yao after a pump fake in the post | §9.5 move 6 |

### 5.6 Dunks

**Reach and jump height.** Ball-centre height needed at the slam: `ySlam = RIM.y + 0.18 = 3.228 m`, ball centre
`0.10 m` in front of the rim centre on the approach line. Reach while dunking: `reachDunk = reachAug + 0.08`
(shoulder elevation 30°, spine side-bend 15° toward the dunking arm), ball-centre reach one-hand
`= reachDunk + 0.04`, two-hand `= reachDunk − 0.02`. Required jump `h = clamp(ySlam − ballReach + 0.05, 0.40, 1.05)`:

| player | reachDunk | h one-hand | h two-hand | slam at (s after takeoff, ascending) one / two |
|---|---|---|---|---|
| kobe | 2.51 | 0.73 | 0.79 | 0.36 / 0.37 |
| jordan | 2.50 | 0.74 | 0.80 | 0.36 / 0.37 |
| lebron | 2.57 | 0.67 | 0.73 | 0.34 / 0.36 |
| giannis | 2.66 | 0.58 | 0.64 | 0.31 / 0.33 |
| yao | 2.82 | 0.42 | 0.48 | 0.26 / 0.28 |
| kyrie | 2.37 | 0.87 | 0.93 | 0.39 / 0.41 (open breaks only) |

**Vertical profile** supplied to gameplay (replaces v1's 0.55 s tween and teleport, [REV#32]):
rise ballistic to the apex (`T½(h)`); the slam happens at `apex − 0.03` (ascending) unless the clip says
descending (FT-line, long gather); **hang**: from `slam + 0.03` for `hangT` (0.10–0.25 s, per clip) `jumpY`
eases from `h` to `h − 0.05` (elbows bend 30° on the rim); **drop**: free fall from `h − 0.05` (or from the slam
height for no-hang dunks), landing at `sqrt(2·(h − 0.05)/g)` after the hang.

**Horizontal**: takeoff distance windows (rim centre to the takeoff root): one-foot 1.2–2.0 m, two-foot power
0.9–1.4 m, cradle 1.2–1.6 m, long gather 2.6–3.2 m, FT-line 4.2–4.6 m. Air velocity = `(dTO − 0.35)/tSlam`
toward the rim (the root is 0.35 m in front of the rim centre at the slam with the arm reaching forward).

**Slam & rim**: over the last 0.15 s before `slam` the dunk hand(s) are IK-driven so the ball centre reaches the
slam point exactly; at `slam` the ball is released with `v = (0, −4.5, 0) + 0.3·(rim − ball)xz/|…|` and state
`scored` (gameplay awards points as in v1); at `rimGrab` the `rimHook` socket is IK-locked to the rim front point
`RIM + n·RIM.r` (n = unit xz from the rim centre toward the dunker), y = RIM.y + 0.01, fingers `claw`, until
`rimRelease`. Bodies: during the hang the dunker's capsule is fixed; gameplay separation should push others
≥ 0.95 m away from a hanging dunker ([REV#42]; gameplay constant, value suggested here).

Generic dunk clips (right hand; mirrored):

**`dunk.power2`** (two-hand power off two feet; any player; LeBron's drive finish (a), Yao's drop step)
```
0.00 P[0,-0.10,0, 15,0,0] S[18,0,0] RA[40,25,30,110,30,-30,0] LA[40,25,30,110,30,-30,0] B'both'   ev gather
0.12 P[0,-0.18,0, 18,0,0] Rft[-0.25,0.60,5,'f'] Lft[0.25,0.60,-5,'f'] RL/LL[50,8,0,85,-25,0]        ev plantL, plantR (jump stop)
0.26 P[0,-0.02,0, 0,0,0] S[-5,0,0] RA[150,15,10,40,40,-30,0] LA[150,15,10,40,40,-30,0] Rft/Lft[null]
     RL/LL[10,6,0,15,40,0] E{roar:0.4}                                                              ev takeoff
TO+T½−0.10  RA/LA[178,18,0,95,30,-20,0] (ball behind the head) S[-12,0,0] N[-15,0,0] RL/LL[70,10,0,110,30,0]
TO+T½−0.03  RA/LA[150,15,0,10,90,60,0] S[15,0,0] B'free' E{roar:0.9}                              ev slam
+0.03       rimGrab (both hands) RF/LF'claw' ; hang 0.20 s with elbows 30 ; legs swing forward RL/LL[60,15,0,80,20,0] ev rimGrab
+0.23       ev rimRelease ; arms follow the body down
land        RL/LL[40,10,0,60,-15,0] Rft/Lft re-lock 0.5 apart ; P[0,-0.15,0, 15,0,0]                ev land
land+0.35   ev end → celebration selector (§8)
```

**`dunk.tomahawk1`** (one-hand, off the left foot, 2-step approach; Kobe/LeBron/Giannis/Jordan; signature
versions in §9 take precedence)
```
0.00 B'R' (ball cupped in the right hand against the forearm) RA[40,20,10,110,-40,-30,0] Rft[-0.12,0,0,'f'] ev gather, plantR
0.24 Lft[0.10,1.10,0,'f'] P[0,-0.14,0, -8,0,0] S[-4,0,0] (lean back to convert speed) ev plantL
0.32 takeoff off the left foot: LL[-10,3,0,10,40,0] RL[100,5,0,100,30,0] (right knee drive) LA[120,20,20,20,0,0,0] ev takeoff
TO+0.20 RA[175,25,-40,110,0,-40,0] (ball cocked behind the right ear) S[-15,0,0] N[-15,0,0] E{jawOpen:0.5}
TO+T½−0.03 RA[120,10,0,5,90,70,0] S[20,0,0] B'free' ev slam
+0.03 rimGrab right hand 0.10–0.20 s (per player) ; land two feet knees 50 ; ev land ; end land + 0.30
```

**`dunk.simple1`** (one-hand off two feet for open-break dunks by Kyrie and Yao's putback dunk): as `power2` but
the left hand leaves at `TO + 0.10` and the right arm goes `[170,15,0,30,40,−20,0]` → slam `[140,10,0,5,90,60,0]`.

### 5.7 Tip-ins and putbacks

| clip | trigger | keys |
|---|---|---|
| `put.tip` | an offensive player jumps for a free ball within 1.2 m of the rim and his hand socket can reach the ball (gameplay catch/tip rule) | load 0.10 (`P.dy −0.14`), two-foot takeoff, tipping arm `[175,10,0,5,0,−10,0]` `RF:'spread'`, other arm `[120,25,0,30,0,0,0]`; at gameplay `CONTACT` the hand IK snaps to the ball and the wrist flicks `wFlex −10 → +40` in 0.06 s; h = 0.45 (yao 0.25, giannis 0.40, lebron 0.42, jordan 0.45, kobe 0.42, kyrie 0.40) |
| `put.dunk` | LeBron, Giannis, Yao when the rebound is caught at the apex within 1.0 m of the rim and `ballReach2 + jumpY ≥ 3.15` | catch both hands at apex (`CATCH`), immediate `RA/LA[150,15,0,10,90,60,0]` slam 0.10 s later (`SLAM`), no hang, land; `E{roar:0.8}` |

---

## 6. Defence

Jump heights used by defensive clips (nominal; gameplay may scale, the animator warps to whatever `h` it gets):
`h_block = 0.80·vertical/100`, `h_contest = 0.65·vertical/100`, `h_rebound = 0.75·vertical/100` with the profile
ratings [PROF:* ratings]: kobe (88) 0.70 / 0.57 / 0.66, jordan (94) 0.75 / 0.61 / 0.71, lebron (88) 0.70 / 0.57 /
0.66, giannis (95) 0.76 / 0.62 / 0.71, yao (42) 0.34 / 0.27 / 0.32, kyrie (80) 0.64 / 0.52 / 0.60.
(Yao's profile values 0.30 block / 0.20 rebound [PROF:yao] are within the warp range.)

### 6.1 Stance and slides
§3.8 (per-player stance) and §3.5 (slide gait). "Active hands" additive while on-ball. Kobe's floor slap and
Jordan's palms-on-floor are idle habits (§8.3).

### 6.2 Closeout — `def.closeout` (lower+upper, root `carry` with deceleration)
Trigger (gameplay/AI): a defender moving at > 3 m/s toward his man, the man has the ball or is the pass target,
distance < 3.0 m. Keys:
```
0.00 gait sprint/run (base) ; upper: contest hand toward the shooter's shooting hand side (shooter right-handed → defender's LEFT hand):
     LA[150,20,0,20,-40,0,0] LF'spread' RA[45,35,0,40,30,0,0]
0.00–exit chop steps: gait override cadence 5.0 steps/s, step 0.25·sLeg, pelvis drop 0.10, trunk 10°, toe-locked
     root deceleration 10 m/s² (breaks down; never reverses direction → no backward hop, [REV#28])
exit when distance < 1.2 m or after 0.60 s → def stance (0.15 s blend), contest arm kept up while the man holds the ball within 1.6 m
```

### 6.3 Contest — `def.contest1` (one hand up, jump) and `def.handUp` (no jump, upper)
```
def.contest1 (dur = 0.08 + 2·T½(h) + 0.20 ; entry 'stop' decel 30 m/s² → the defender stops, he does not drift back [REV#28])
0.00 P[0,-0.04,0, 8,0,0]
0.08 P[0,-0.10,0, 10,0,0] RL/LL[35,10,0,45,-15,0]        (load)              ev takeoff (at 0.08)
0.08+T½ (apex) contest arm (shooter's side) [172,10,0,5,-30,0,0] 'spread' ; other arm [50,40,0,45,20,0,0] ;
     RL/LL[15,6,0,25,35,0] ; S[-4,_,_] ; look 'ball'
land  RL/LL[30,10,0,45,-12,0] P[0,-0.12,0, 10,0,0]        ev land ; end land+0.20 ; cancel land+0.05
def.handUp: upper layer, contest arm [165,12,0,10,-30,0,0] 'spread' raised in 0.10 s, held while the shooter is in
     windup, lowered 0.20 s after the release (Kyrie at the rim [PROF:kyrie]; any defender who is not jumping)
```

### 6.4 Verticality — `def.vertical`
Both arms `[175,5,0,0,−90,0,0]` (palms forward) `spread`, body straight (S 0, P pitch 0), legs straight in the air
`[5,4,0,8,30,0]`; load 0.10 s; `h_contest`. Yao's version §9.5 move 5; Giannis uses this generic.

### 6.5 Block — `def.block1`
```
0.00 load P[0,-0.12,0, 12,0,0] RL/LL[40,10,0,55,-18,0] arms down-back [-15,15,0,20,0,0,0]
0.08 (yao 0.13) takeoff ; blocking arm swings up
apex  blocking arm [165,10,0,5,-20,-10,0] 'spread' (15° forward of vertical), spine pitch +8 toward the ball,
      S yaw ±10 toward the ball side ; other arm [120,30,0,30,0,0,0] ; legs [20,8,0,35,35,0]
CONTACT (gameplay-detected, any time in the air): hand IK to the ball over 0.06 s, then the swat additive:
      wFlex −10 → +50 and pron +30 over 0.06 s ('pin' variant for chase-downs: wFlex −40 → +20, no pron)
land  as contest ; end land + 0.25
```
**Block contact rule (gameplay; animation provides the socket)** — replaces the 0.40 m sphere around a computed
hand point [V1 §4.7, REV#27/#38]: a block is possible only when the blocker is airborne, the `palm` socket of
his blocking hand is within `0.14 + BALL.R = 0.26 m` of the ball centre, the palm is above `ball.y − 0.05`, and
the ball's `releaseAge` is inside the gameplay window. The block *probability* stays a gameplay rule.

### 6.6 Chase-down blocks
LeBron (§9.3 move 1) and Giannis (§9.4 move 4) signature clips; any other player uses `def.block1` with
`entry: 'carry'` (keeps 85 % of the run-in speed) when the shooter is ahead of him.

### 6.7 Steal — `def.steal` (+ `def.stealMiss`)
```
dur 0.42 ; root 'motion' entry 'replace' ; mask full
0.00 def stance
0.04 lead foot (ball side) steps: Rft[-0.30,0.30,0,'t'] (lunge 0.30·sLeg) ; S[15,±20,_] (yaw toward the ball) ; P[0,-0.16,0.08, 18,_,_]
0.04–0.16 reaching arm (ball side) swipes upward: [20,25,10,25,60,-30,0] → [70,25,10,20,60,30,0] (knee → waist height)
0.12 ev swipe   (gameplay resolves the steal here: hand socket within 0.30 m of the ball centre → eligible)
0.20 follow-through ; 0.42 back to stance ; ev end
def.stealMiss (gameplay sends a miss at 'swipe'): overreach S[25,_,_], arm continues to [90,20,10,10,60,40,0], feet locked,
     0.35 s (= v1 STUN_STEAL_FAIL), then 0.15 s blend to stance
```
Per player: Jordan swipes with the right hand from knee to waist and immediately runs out (`exitV` 4 m/s toward
the ball) [PROF:jordan move 7]; Kyrie `swipe` at 0.10 (quick hands); Yao and LeBron at 0.14.

### 6.8 Box-out and rebounds
- `def.boxout`: stance `boxOut` (§3.8) with slide gait; triggered by gameplay for the player nearest an opponent
  between himself and the rim when a shot is released. Contact pushes are gameplay.
- `reb.jump2` (two-hand rebound; mask full, entry `stop` 20 m/s²):
```
0.00 P[0,-0.04,0, 8,0,0]
0.12 P[0,-0.15,0, 14,0,0] RL/LL[45,10,0,65,-20,0] RA/LA[-20,15,0,20,0,0,0] (arms swing down-back)   ev takeoff (0.12; yao 0.10)
apex RA/LA[170,15,0,15,-60,-10,0] 'spread' (palms forward/up) RL/LL[30,8,0,45,35,0] look 'ball'
CATCH (gameplay) hands IK onto the ball (B'both')
land P[0,-0.12,0, 10,0,0] RL/LL[35,12,0,50,-15,0]                                                      ev land
land→+0.45 'chin it': RA/LA[55,80,35,125,15,-25,0] (elbows flared 80° [PROF:yao]) S yaw +10 → −10 → 0 (clearing space)   ev end
```
- One-hand tip-out is `put.tip` mirrored for defenders (no score).

### 6.9 Crossed: stumble and ankle-break fall
`def.stumble` (freeze 0.40 s [V1 CROSS_FREEZE_T]; root `replace`): the defender's weight goes the wrong way
(toward the handler's fake direction `f`):
```
0.00 P[0.15·f,-0.12,0, 12,0,15·f] S[10,0,12·f] RA/LA[60,60,0,30,0,0,0] (flail) ; the far foot slides: Lft/Rft target +0.25·f, mode 't'
0.25 N[_,-30·f,_] (head turns late toward the new direction)
0.40 recover to stance (0.15 blend) ; root moves 0.20·f in 0.00–0.25 then stops
```
`def.ankleFall` (only when gameplay rolls an ankle-break; suggested: Kyrie `sig.kyrie.hesiCross`,
`doubleBtlStepback` and `move.cross` 0.10 of successful freezes on normal, 0.15 on hard; other handlers 0.03;
the defender is frozen 1.10 s):
```
0.00–0.20 as stumble but bigger: P dx 0.25·f, plant leg int 30, trail leg crosses behind (hip abd −10, int −20)
0.45 sit down: P[0.30·f, -(hipH-0.16)/sLeg, -0.15, -10,0,0] (pelvis 0.16 m above the floor), knees up RL/LL[85,15,0,105,0,0],
     feet [±0.20, 0.45], hands post behind on the floor RA/LA[-45,25,0,10,-80,-70,0] 'flat' ; E{jawOpen:0.4} ; look 'ball'   ev fx (crowd "ooh")
0.70 hold ends ; roll to the right knee RL[90,10,0,120,0,0], push with both hands
1.10 stand in stance ; root total 0.30·f in 0.00–0.45
```
`def.bumped` (hit reaction when LeBron's or Giannis' drives/backdowns send a `CONTACT` displacement):
additive 0.30 s: pelvis dx 0.12 away from the contact, trunk roll 10°, arms out 30°.

---

## 7. Passing

### 7.1 Timing (input → `release` event; the ball launches from the hand socket at `release`)

| clip | used for | release after input (s) | from dribble add |
|---|---|---|---|
| `pass.chest` | default two-hand pass when holding | 0.10 | +pickup (≤ 0.12) |
| `pass.push1` | one-hand push pass straight off the dribble (moving) | 0.08 if the ball is in the hand, else at the next contact (≤ 0.20) | — |
| `pass.bounce` | a defender's hands are in the lane at 1.0–2.0 m height (if the gameplay section adds bounce passes) | 0.12 | +pickup |
| `pass.lob` | lob (`secondary.heldTime ≥ 0.30` [V1 §5.9]) | 0.16 | +pickup |
| `pass.overhead` | generic overhead (any player in the post) | 0.18 | — |
| `sig.yao.overheadPass` | Yao double-team pass | 0.25 (0.20 if already chinned) | — |
| `sig.lebron.skipPass` | LeBron cross-court one-hand skip / no-look from a drive | 0.16 | 0 (from the dribble) |
| `pass.turn` | target more than 60° off the facing | + root yaw turn at 15 rad/s capped 0.12 s | — |

The gameplay section must move the pass launch from the input to the `RELEASE` event (D-ANIM-7). Pass
interception tests use the actual launch time and position.

### 7.2 Keys (right-handed versions; two-hand passes are symmetric)
```
pass.chest (dur 0.45, mask 'upper' when moving else 'full'):
0.00 RA/LA[35,15,30,105,20,-30,0] B'both'                    (ball at the chest)
0.05 RA/LA[30,20,35,115,10,-40,0] S[-4,_,_] Lft[+0.25 forward step,'f'] (when standing)   (wind-up: ball to the sternum)
0.10 RA/LA[75,10,10,15,80,40,0] S[8,_,_] B'free'              ev release   (elbows extend, thumbs turn down: pron +60 relative)
0.22 RA/LA[80,10,5,5,95,50,0] (follow-through toward the target) ; 0.45 back to hold/relax ; ev end
pass.bounce: as chest with shoulder flex at release 45 and S[18,_,_] (aims at a floor point 2/3 of the way)
pass.lob: 0.00 both ; 0.08 RA/LA[60,15,20,60,0,-20,0] (dip) ; 0.16 RA/LA[125,12,10,20,40,10,0] B'free' ev release ; 0.40 end
pass.overhead: 0.00 RA/LA[165,15,0,70,30,-30,0] (ball behind the head) ; 0.18 RA/LA[120,10,0,0,90,30,0] B'free' ev release ; 0.45 end
pass.push1 (from the dribble, upper): 0.00 contact/pickup in the dribble hand ; 0.04 RA[40,15,10,100,90,-30,0] ;
     0.08 RA[80,10,0,10,90,40,0] B'free' ev release ; 0.30 end
```

### 7.3 Aim
Target azimuth `α` relative to the facing (+ = left). Additive spine yaw `clamp(α, −60°, 60°)` split
0.20/0.35/0.45 (spine_01/02/03), arms follow (the release velocity is gameplay's). `|α| > 60°` → `pass.turn`
(root yaw turns toward `α ∓ 45°` during the wind-up). Look-at target = receiver, **except LeBron's no-look**
(`sig.lebron.skipPass` and 40 % of his passes: look stays on the rim/defender).

### 7.4 Catching (`catch.*`, upper unless standing)
- `catch.ready` (pass in flight to me): hands up as a target `RA/LA[60,20,0,50,−60,0,0]` `spread`, palms toward
  the passer, look `ball`; 0.12 s in.
- `catch.chest` / `catch.high` (ball above 1.6 m: `RA/LA[140,15,0,30,−60,0,0]`) / `catch.low` (below 0.8 m: knees
  60, `RA/LA[20,15,20,40,−40,0,0]`) / `catch.run` (upper while moving): hand IK to the predicted ball position
  over the last 0.15 s before arrival (§2.6.4); `CATCH` at the gameplay catch; absorb 0.15 s (elbows 30 → 80, ball
  pulled to the chest), then triple threat (or dribble if the player keeps moving > 2 m/s).
- `READY` event 0.30 s after `CATCH`: the gameplay section gates CPU shots on it (minimum 0.30 s catch-to-shot,
  [REV#24/#39]); the human may shoot earlier (the shot clip blends from the absorbing pose).

---

## 8. Mannerisms, expressions, celebrations, idle habits

### 8.1 Face timelines tied to play (all from [PROF:*] mannerisms, [CFG] expressions)

| player | trigger | expression timeline |
|---|---|---|
| jordan | drive (ball handler, dribbling toward the rim, speed > 4.5 m/s, rim distance < 7 m) | `tongueOut` 0 → 1 over 0.10 s, held; retracts 0.12 s when the drive ends |
| jordan | any layup/dunk clip | `tongueOut` 1 from `gather` to `land` (+0.10) — also in dunk replays |
| jordan | jump shots | none (tongue in on jumpers [PROF:jordan]) ; idle gum chew (§2.8) |
| kobe | always (default) | `scowl` 0.35 ("Mamba stare") |
| kobe | own make (big: dunk, clutch, tough) | `jawJut` 1.0, hold 1.2 s (cel.kobe.jawJut) |
| lebron | dunk/power finish | `roar` 0.4 at takeoff → 1.0 at the slam/land → celebration |
| giannis | dunk | `roar` 0.4 at the cock → 1.0 at the slam; dead balls `grin` 0.7 (menu card too) |
| yao | dunk/block | `roar` 0.9 for 1.0 s; teammate's big play `grin` 0.8 for 1.2 s; long possession `puff` 0.8 for 0.5 s |
| kyrie | own make (three/tough) | `smirk` 0.8 for 1.5 s; never wild screaming [PROF:kyrie] |
| all | effort (sprint at stamina < 0.4, rebounds, blocks) | `jawOpen` 0.25–0.5 |

### 8.2 Celebrations (in game)

Window: DEAD(MADE) lasts 1.5 s [V1 §8], then CHECK tweens players for 0.8 s; full-body celebrations must end
(or be cut, 0.30 s blend) by 1.4 s; upper-body + face celebrations continue over the walk/jog of the CHECK tween.
Only the scorer celebrates (teammates within 4 m may play `cel.highFive`); blockers may celebrate a block
(no dead ball: upper-body only, ≤ 0.9 s, cancelled by any gameplay need).

Event classes: `dunk`, `clutch` (last 30 s with margin ≤ 3, go-ahead or buzzer-beater), `three`, `tough`
(contest factor C < 0.7 at release), `normal`. Probability that the scorer celebrates: dunk 0.85, clutch 1.0,
three 0.6, tough 0.5, normal 0.2 (cosmetic RNG).

| player | dunk | clutch | three | tough | normal |
|---|---|---|---|---|---|
| kobe | `cel.kobe.jawJut` | `cel.kobe.fingerUp` 0.6 / `cel.kobe.fistClench` 0.4 | `cel.kobe.shrug` 0.5 / jawJut 0.5 | `cel.kobe.shrug` | jawJut face only (0.6) |
| jordan | `cel.jordan.fistJog` | game-winning jumper → `cel.jordan.lastShot`; else `cel.jordan.leapPump` | after 3 straight makes by him `cel.jordan.shrug`, else `cel.jordan.pointSmirk` | `cel.jordan.pointSmirk` | `smirk` face 0.5 |
| lebron | `cel.lebron.roar` | roar + chest pound | assisted → `cel.lebron.point` (at the passer), else `cel.lebron.flexLite` | `cel.lebron.flexLite` | quick fist pump (upper, 0.5 s) |
| giannis | `cel.giannis.flexRoar` | flexRoar + `cel.giannis.chestThump` | `cel.giannis.airplane` | `cel.giannis.chestThump` | index finger up while backpedalling (upper 1.0 s) |
| yao | `cel.yao.fistPump` | `cel.yao.fistPump` | nod jog (rare, he does not shoot threes) | nod jog | nod jog (N pitch +12 twice) |
| kyrie | `smirk` + jog | `cel.kyrie.holdFollow` 0.5 / `cel.kyrie.skyPoint` 0.3 / `cel.kyrie.shh` 0.2 | `cel.kyrie.holdFollow` 0.6 / `cel.kyrie.skyPoint` 0.4 | `cel.kyrie.walkAway` | `smirk` face |
| block (blocker) | Yao no taunt: turns and jogs, points to a teammate [PROF:yao]; LeBron/Giannis after a chase-down: stare back + `roar` face 0.8 (upper fist clench); others none |

Kyrie never uses the three-finger "goggles" gesture (it belongs to another player); his three celebration is
the held follow-through + smirk, a skyward finger or a chest tap. After Kyrie scores three straight times:
`cel.kyrie.bow` (nod 20° held 0.3 s).

Celebration clip keys (durations in game ≤ 1.5 s; `upper` = over locomotion):

| clip | mask | dur | keys (time: channels) |
|---|---|---|---|
| `cel.kobe.jawJut` | upper+face | 1.50 | E jawJut 0→1 (0–0.15), hold to 1.20, release 1.50; N[−10,0,0] chin up at 0.20; nods: N pitch −10 → +12 → −10 at 0.60–0.80 and 1.00–1.20; look 'crowd' |
| `cel.kobe.fingerUp` | upper | 1.40 | RA[150,10,0,20,−30,0,0] RF'point' 0.15–1.20; E scowl 0.5; look 'none' (emotionless) |
| `cel.kobe.fistClench` | upper | 1.00 | RA[90,20,0,100,0,0,0] fist at 0.15 → pumped down to [20,20,0,110,0,0,0] at 0.40; E roar 0.6 (teeth bared) |
| `cel.kobe.shrug` | upper | 1.00 | RC/LC elev 15 at 0.30; RA/LA[20,30,−20,70,−60,−10,0] palms up and out; N yaw ±12 at 3 Hz 0.40–0.90 (dismissive headshake) |
| `cel.jordan.shrug` | full | 1.20 | RC/LC elev 18 (≈ 8 cm) at 0.35; RA/LA[30,35,−30,80,−80,−20,0] palms up at waist; N roll 10; E smirk 0.7; look 'crowd' (turns toward the sideline: root yaw 30 over 0.30) [PROF:jordan] |
| `cel.jordan.leapPump` | full | 1.40 | hop h 0.30 at 0.15; RA uppercuts flex 60 → 150 at 0.25, 0.45, 0.65 (RF'fist'); E roar 0.8 |
| `cel.jordan.fistJog` | upper | 1.00 | RA[70,20,0,120,0,0,0] fist, pumped down once at 0.40; E smirk 0.6 |
| `cel.jordan.pointSmirk` | upper | 1.20 | RA[90,30,0,10,60,0,0] RF'point' toward the scorer's table (camera side) 0.20–0.90; E smirk 0.8 from 0.40 |
| `cel.jordan.lastShot` | full | 1.40 | hold the follow-through key of the shot for 1.0 s after landing, feet together, lean back 5°; then fist |
| `cel.lebron.roar` | full | 1.30 | feet 1.0 apart, knees 25; S[−10,0,0] chest out; RA/LA[20,40,0,100,−20,0,0] fists down and out (Hulk flex); N[−20,0,0]; E roar 0.1 → 1.0, held to 1.1; chest-pound variant: RA fist to the left pec at 0.70 and 0.90 |
| `cel.lebron.flexLite` | upper | 1.00 | RA[0,90,−85,130,−60,0,0] biceps up (RF'fist'), LA[50,20,40,90,90,0,0] slaps the right biceps at 0.45 |
| `cel.lebron.point` | upper | 0.90 | RA[95,20,0,10,60,0,0] RF'point' at the passer; look 'passer' |
| `cel.giannis.flexRoar` | full | 1.40 | feet 1.0 apart, knees 20; RA/LA[0,90,−85,110,−60,0,0] fists (double biceps); S[15,0,0]; E roar 0.15 → 1.0; two downward fist pumps at 1.05 and 1.25 (elbow 110 → 80 → 110) |
| `cel.giannis.airplane` | upper | 1.20 | RA/LA[0,85,0,10,−30,0,0] arms out, spine roll ±10° at 1 Hz; E grin 0.7 |
| `cel.giannis.chestThump` | upper | 0.90 | RA fist to the left pec at 0.25 and 0.45, then point at a teammate |
| `cel.yao.fistPump` | full | 1.20 | legs wide; S[20,0,0]; RA/LA fists pumped down to hip height [30,25,0,100] → [40,25,0,90] at 0.30 and 0.60; E roar 0.9 0.10–1.10; then nod jog |
| `cel.kyrie.holdFollow` | upper | 1.50 | keeps RA[160,4,15,0,95,70,0] RF'snap' while backpedalling; E smirk 0.8; look 'man' |
| `cel.kyrie.skyPoint` | upper | 1.20 | RA[175,10,0,10,−20,0,0] RF'point' 0.10–0.70; LA flat palm taps the chest (heart) at 0.80 |
| `cel.kyrie.shh` | upper | 1.20 | RA[40,10,30,140,−60,−10,0] RF'shh' index at the lips 0.20–0.90; look 'crowd' |
| `cel.kyrie.walkAway` | full | 1.30 | root yaw +150 over 0.40, walk 1.2 m/s; RC/LC elev −5 (relaxed); E smirk |
| `cel.highFive` | upper | 0.80 | jog toward the scorer; RA[150,20,0,15,−60,0,0] palm meets at 0.40; Yao bends S[25,0,0] and lowers his hand ([100,60,…]) |

### 8.3 Idle habits (DEAD, CHECK, QUARTER_END, timeouts; stationary ≥ 0.6 s; cosmetic RNG; 6 s cooldown per player)

A habit only starts if it can finish before the next state change (CHECK habits need ≥ 1.0 s left; the handler's
ball habits must end with the ball back in both hands before LIVE).

| player | habit (weight) | dur (s) | description |
|---|---|---|---|
| kobe | `idle.kobe.neckRoll` (0.30) | 2.0 | N roll ±15°, yaw ±20° circle; shoulders roll |
| | `idle.kobe.fingerFlex` (0.30) | 1.6 | RF `curlTape` (taped right fingers open/close) |
| | `idle.kobe.handsKnees` (0.25) | 2.4 | bent 40°, hands tugging the shorts hem at the knees, head up |
| | `idle.kobe.collarBite` (0.15) | 2.0 | RA[60,10,40,140,−40,20,0] hand lifts the neckline to the mouth, N pitch +15 |
| | `idle.kobe.floorSlap` (on-ball defender at CHECK) | 0.9 | deep crouch, right palm slaps the floor once (F'flat') |
| jordan | `idle.jordan.shortsGrip` (0.40) | 2.4 | bent 45°, hands grip the shorts above the knees, head down, breathing × 2.5 |
| | `idle.jordan.soleWipe` (0.25) | 2.4 | right foot lifted behind (RL[−20,5,0,100,20,0]), right palm swipes the sole; then the left |
| | `idle.jordan.clap` (0.35, when switching to defence) | 0.6 | one hard clap at 0.30 |
| | `idle.jordan.palmsFloor` (on-ball defender at CHECK, 0.3) | 0.9 | both palms slap the floor |
| lebron | `idle.lebron.headband` (0.30) | 0.6 | both hands at the forehead, index/middle fingers push the headband |
| | `idle.lebron.handsHips` (0.30) | 2.0 | chest out, elbows wide (noRhythm) |
| | `idle.lebron.handsKnees` (0.25) | 2.4 | hands on knees, slight sway |
| | `idle.lebron.shimmy` (0.15) | 0.8 | RC/LC elev ±8° alternating at 3 Hz + `puff` exhale |
| giannis | `idle.giannis.handsHips` (0.35) | 2.0 | long fingers spread over the hip bones (F'flat'), head nods |
| | `idle.giannis.bounceRoll` (0.35) | 2.0 | toe bounce 2 Hz + shoulder rolls |
| | `idle.giannis.faceWipe` (0.15) | 0.8 | back of the right hand wipes the beard/face |
| | `idle.giannis.grin` (0.15) | 1.5 | face only |
| yao | `idle.yao.handsKnees` (0.35) | 2.4 | straight arms on the knees, spine flex 40° |
| | `idle.yao.waistband` (0.30) | 0.8 | both hands tug the shorts waistband |
| | `idle.yao.handsHips` (0.20) | 2.0 | upright |
| | `idle.yao.puff` (0.15) | 0.6 | `puff` exhale |
| kyrie | with the ball: `idle.kyrie.ballWrap` (0.50) | 1.6 | B'path' circle around the waist r 0.30 at 1.2 Hz, hand-to-hand behind the back |
| | with the ball: `idle.kyrie.fingerSpin` (0.30) | 1.4 | ball spins on the right index tip (B'path' fixed 0.14 above `tip_R`, spin flag for the ball renderer) |
| | without: `idle.kyrie.handsHips` (0.30), `idle.kyrie.bounceWalk` (0.30), `idle.kyrie.chestTap` (0.20), `idle.kyrie.mouthguard` (0.20, face/asset) | 1.0–2.0 | |

### 8.4 Presentation screens
- **Lineup / team select**: each player loops his showcase every 6–8 s: Kobe stare + finger flex + neck roll;
  Jordan shrug + smirk; LeBron `cel.lebron.chalk` (below) every 8 s; Giannis grin + flexRoar every 8 s; Yao grin
  + fist pump; Kyrie finger spin with a prop ball + smirk.
- **`cel.lebron.chalk`** (intro / lineup only, 3.2 s, full): 0.0–0.8 two walking steps; 0.8–1.8 palms rub
  (RA/LA[40,10,40,110,0,0,0], forearm oscillation ±8° at 3.3 Hz, 5 strokes); 1.8–2.1 turn to the camera; 2.1–2.5
  both arms sweep from waist to overhead (flex 30 → 170, elbows ≈ 10); `FX chalkBurst` at 2.45 (rendering
  section: ≈ 120 white sprite particles, burst diameter 1.5 m, drifting up/out over 1.5 s, alpha 0.6 → 0); N[−20]
  head back, chest out to 3.2.
- **Game over**: winners play one celebration each (full versions, ≤ 3 s), losers `handsHips`/`handsKnees` with
  N pitch +20 (looking down).

---

## 9. Signature moves — keyframe tables (every signature move in the six profiles)

Notation: DSL of §2.2 (times in seconds = profile frame / 30, re-timed where the profile's numbers are
physically inconsistent — each such change is noted). All offsets in metres for the reference body (× sLeg at
runtime), angles in degrees, `_` = not keyed, `ft` = foot target `[x, z, yaw, mode]` in the clip-start frame
(+x = character's left at the start, +z = his forward at the start). Root `R[x, z, yaw]` cumulative, yaw
positive = counter-clockwise from above (turning to his own left). Arm arrays
`[flex, abd, int, elbow, pron, wFlex, wDev]`, leg arrays `[hip, abd, int, knee, ank, toe]`. Unlisted channels hold
from the previous key. Each header lists: trigger (select.js), root policy, jump `h` (nominal; gameplay may
change it and the air segment warps), `meterFrom` / `tIdeal` / `METER_T` for meter shots (§5.1), target windows,
and `params` used by gameplay. Every clip has a mirrored `_L` twin; the header names the default side.

`S1/S2/S3[a/b/c, …]` is shorthand for three per-segment keys (spine_01 = a, spine_02 = b, spine_03 = c) of the
same channel. Shared arm shorthands: `HIP_R` = RA[20,15,25,80,30,−20,0] + LA[35,15,45,95,10,−10,0] (ball at the right hip, both
hands); `CHEST` = RA/LA[35,15,30,105,20,−30,0]; `CHIN` = RA[70,8,25,125,60,−40,0] + LA[65,20,35,120,−10,−20,0];
`SET(p)` / `GUIDE(p)` / `REL(p)` / `FOLLOW(p)` = the player's form arrays of §5.2 (`REL` = `[relFlex,4,15,5,90,−15,0]`,
`FOLLOW` = `[relFlex−3,4,15,0,95,followWrist,0]`); `DOWN` = RA/LA[10,12,5,25,30,0,0].

### 9.1 Kobe Bryant [PROF:kobe signatureMoves 1–6]

**K1 `sig.kobe.turnFade`** — turnaround fadeaway from the right block, back to the basket, spinning over the
LEFT shoulder toward the baseline (left-foot pivot); `_L` = left block over the right shoulder (right-foot pivot).
Trigger: shoot while posting up within 1.0–5.0 m of the rim on the right side (60 % of Kobe's post shots; 100 %
when the defender is within 1.0 m and the shot clock < 6). Root `motion`, entry `stop` 20 m/s², `h 0.50`,
takeoff 0.70, fade 0.45 m + 0.10 toward the baseline, target: root yaw at 0.70 faces the rim (±25° warp).
`meterFrom 0.50`, `tIdeal 0.959`, `METER_T 0.574`. dur 1.60.
```
0.00 P[0,-0.10,0, 12,0,0] S[20,0,0] N[-22,35,0] HIP_R RL/LL[35,8,0,45,-10,0] Rft[-0.38,0,0,'f'] Lft[0.37,0,0,'t'] RF/LF'grip' B'both' look'none'
0.20 P[-0.08,-0.11,0, 12,-10,0] S[20,-20,-12] N[-20,15,0] RA[30,0,40,95,20,-15,0] LA[15,20,10,75,40,-20,0]      (shoulder fake: ball to the left hip, 70 % weight right)
0.30 = 0.20 (hold; the defender bites)                                                                      ev fake
0.32 Rft[null] RL[30,25,0,60,10,0]
0.40 R[0.30,0.03,80] P[0,-0.12,0, 8,15,0] S[15,-20,0] N[-10,10,0]                                           (pelvis leads 15°, spine lags 20°)
0.50 R[0.63,0.10,160] P[0,-0.13,0, 8,0,0] S[12,0,0] N[-10,0,0] Lft[0.37,0,160,'t'] Rft[0.89,0.19,160,'f'] CHEST look'rim'   ev plantR, gather
0.63 P[0,-0.16,0, 10,0,0] S[5,0,0] N[-8,0,0] CHIN RL/LL[45,6,0,65,-20,0] Lft[0.37,0,165,'f']               (load, knees 65)
0.70 P[0,-0.04,0, 0,0,0] S[0,0,0] RA[100,8,20,110,80,-55,0] RL/LL[6,4,0,8,35,0] Rft[null] Lft[null] R[0.63,0.10,165]   ev takeoff
0.83 P[0,0,0, -9,0,0] S[-9,0,0] N[-8,0,0] RA SET(kobe) LA GUIDE(kobe) RF'shoot' RL[25,5,0,40,30,0] LL[10,5,0,25,30,0] E{scowl:0.4}   ev set
0.959+0.05 RA REL(kobe) LA[105,27,30,80,-5,0,0] B'free'                                                      ev release
1.11 RA FOLLOW(kobe) RF'snap'
1.34 P[0,-0.10,0, 8,0,0] S[4,0,0] RL/LL[25,6,4,40,-12,0] Rft[0.61,0.56,165,'f'] Lft[0.23,0.46,165,'f'] R[0.42,0.51,165]   ev land
1.46 RA[157,4,15,0,95,70,0] (hold ends) ; optional 0.10 stumble step back: Rft[0.63,0.66,165,'f'] at 1.50
1.60 P[0,-0.03,0, 4,0,0] S[4,0,0] N[0,0,0] DOWN RF/LF'relax'                                                ev end
```

**K2 `sig.kobe.jabSeries`** (move) + **`sig.kobe.ripPullup`** (shot) + **`sig.kobe.jabGo`** (drive) — triple
threat at the right wing/elbow, LEFT foot pivot. The profile's single 1.6 s sequence is split at its decision
points so the user/AI chooses: jab series on tertiary while holding; shoot during/after it → `ripPullup`;
drive input after jab 2 → `jabGo`.
```
sig.kobe.jabSeries (dur 0.53, root none, cancel 0.17/0.47 = branch points)
0.00 P[0,-0.11,0, 12,0,0] S[25,0,0] N[-25,0,0] RA[15,25,20,75,40,-25,0] LA[40,20,60,85,0,-15,0] Rft[-0.30,0.05,8,'f'] Lft[0.30,-0.05,8,'t'] B'both' look'man'
0.05 Rft[null]
0.12 Rft[-0.30,0.40,8,'t'] RL[30,6,0,35,5,0] P[-0.06,-0.15,0.05, 15,0,0] S[35,0,0]                  ev plantR, fake   (jab 1: 0.35 m at the defender)
0.17 RA[20,40,20,75,40,-25,0] (ball sways 0.20 right) P[_,-0.16,_]                                    head dips 5 cm
0.22 Rft[null] ; 0.30 Rft[-0.30,0.05,8,'f'] P[0,-0.11,0, 12,0,0] S[25,0,0] RA[15,25,20,75,40,-25,0]   (recover)
0.35 Rft[null] ; 0.40 Rft[-0.30,0.25,8,'t'] N[-35,0,0] RC/LC[8,0] P[0,-0.08,0.03, 10,0,0]             ev fake   (jab 2: 0.20 m + head fake up, shoulders +3 cm)
0.47 Rft[-0.30,0.05,8,'f'] N[-25,0,0] RC/LC[0,0]   ; 0.47–0.53 rocker hold                               ev end
sig.kobe.ripPullup (shot; dur 1.05, h 0.55 straight up, no fade; takeoff 0.19; meterFrom 0, tIdeal 0.465, METER_T 0.58)
0.00 (from the triple threat or the jab pose) B'both'
0.06 RA[-5,20,40,40,60,-10,0] LA[20,10,50,40,20,-10,0] S[35,-15,0]                                    (ball low across the knees)
0.10 RA[10,15,50,60,40,-10,0] LA[15,30,20,60,30,-10,0] S[30,10,0]                                     (left hip)
0.14 RA[60,15,30,120,40,-40,0] LA[60,20,35,115,-5,-20,0] P[0,-0.15,0, 10,0,0] RL/LL[45,6,0,62,-18,0]   (up through the chest, elbows high, load)
0.19 takeoff → jumper keys of makeJumper(kobe, mid) from 'TO' on, with h 0.55 (set 0.385, release 0.515, land 0.86, end 1.05)
sig.kobe.jabGo (dur 0.40, root motion entry replace, exitV (0, 4.5)):
0.00 from the jab-2 pose ; 0.08 Rft[null] RL[45,-5,10,70,10,0] ; 0.20 Rft[-0.10,0.90,0,'t'] (crosses past the defender's hip)
0.18 RA push-out dribble [45,10,15,45,90,20,0] B'drib' (ball out before the pivot foot lifts) ; 0.24 Lft[null] ; 0.40 ev end R[0.10,1.30,0]
```

**K3 `sig.kobe.pump`** (move) + **`sig.kobe.sideStepPullup`** (shot, one-dribble pull-up) — elbow or baseline.
Pump on tertiary-back while holding; shoot with the stick to a side within 0.6 s of the pump (or AI) → the
pull-up. Dribble direction from the stick (right default; `_L` left).
```
sig.kobe.pump (dur 0.30): 0.00 CHEST ; 0.18 RA[140,6,18,95,85,-60,0] LA GUIDE(kobe) (right upper arm 0 → 140) heels up: RL/LL[10,4,0,30,8,0] P[0,-0.06,0, 6,0,0] (pelvis +0.04 only, knees stay 30) RC/LC[8,0] N[-15,0,0] look'rim' ev fake
     0.30 CHEST P[0,-0.10,0, 10,0,0]                                                                     ev end
sig.kobe.sideStepPullup (shot; dur 1.05; root motion entry replace; h 0.50; takeoff 0.33; meterFrom 0.12; tIdeal 0.589; METER_T 0.586)
0.00 B'path' RA[45,25,15,60,90,15,0] Bp[-0.35,0.60,0.30] P[0,-0.20,0, 20,-10,0] S[20,0,10] (lean 20° into the travel) RL/LL[40,10,0,60,-15,0]
0.08 ev bounce Bp[-0.75,0.12,0.40]   (one hard dribble pushed 0.9 m right and forward) Rft[null]
0.12 Rft[-0.85,0.45,0,'f'] (right foot leads) ev plantR ; B'both' (pickup) Bp→ hand ; Lft[null] (left drags)
0.17 Lft[-0.40,0.55,0,'f'] (hop: plant 0.15 ahead to stop) ev plantL ; P[-0.65,-0.18,0.45, 12,0,0] S[8,0,0]
0.25 P[-0.65,-0.13,0.45, 8,0,0] S[4,0,0] (spine_01 back to upright) RA/LA from CHEST to CHIN
0.33 takeoff → makeJumper(kobe, mid) keys from 'TO' with drift +0.10 forward (set 0.509, release 0.639, land 0.97)
R: 0.00 [0,0,0] ; 0.12 [-0.55,0.35,0] ; 0.17 [-0.63,0.50,0] ; 0.33 [-0.63,0.50,0] ; 0.97 [-0.63,0.60,0]
```

**K4 `sig.kobe.baselineSpinLay`** and **`sig.kobe.baselineSpinFade`** — from the right baseline facing the rim,
right-hand dribble toward the baseline. Trigger: shoot (lay) or shoot with stick away from the rim (fade) while
dribbling along the right baseline within 4.5 m. Root `motion` entry `replace`.
```
common 0.00–0.47 (dur of the spin part):
0.00 P[0,-0.10,0, 14,0,0] S[25,0,0] (torso 25° forward, left shoulder leading) B'drib' RA dribble
0.13 Lft[0.20,0.45,45,'t'] (left foot plants hard at 45°: the pivot) ev plantL ; P[0,-0.15,0, 12,0,0]
0.20 B'both' HIP_R (gather at the right hip) ev gather
0.27 R[0.10,0.30,-30] Rft[null] RL[30,25,0,65,10,0] RA/LA[50,45,30,120,20,-25,0] (ball high and tight at the chest, elbows wide)
0.40 R[0.35,0.42,-140] P[_,_,_, _,-15,_] (pelvis leads)
0.47 R[0.45,0.45,-180] Lft[0.20,0.45,-135,'t'] Rft[0.70,0.45,-180,'f'] ev plantR
--- Lay (dur 1.30, h 0.55, layup: takeoff 0.60 off the LEFT foot after the right plant; release 0.905; meterFrom 0.47; tIdeal 0.855; METER_T 0.48)
0.55 Lft[null] LL[60,5,0,90,10,0] ; 0.60 ev takeoff (left foot steps to [0.45,0.10,-180] then leaves) RL[95,5,0,100,30,0]
0.80 RA[170,25,0,15,30,-30,0] (right arm up and back for the reverse finish) N[-30,0,0] (head tilted back to see the rim) S[-8,0,0] B'R'
0.905 RA[175,28,0,10,30,40,0] (wrist flick, spin off the glass) B'free' ev release ; LA[60,40,20,60,0,0,0] (guard)
1.27 land two feet ; 1.30 ev end
--- Fade (from 0.47 = sig.kobe.turnFade keys from its 0.63 key on, re-timed −0.08: load 0.47–0.55, takeoff 0.62, set 0.80, release ≈ 0.93, land 1.26; meterFrom 0.40, tIdeal 0.879, METER_T 0.60)
```

**K5 `sig.kobe.tomahawk`** (transition, right hand) and **`sig.kobe.reverse2`** (two-hand reverse baseline dunk).
Retimed: the profile's 0.2 s for two running steps is shorter than his stride allows; steps here follow §3.4.
```
sig.kobe.tomahawk (dur 1.50; root motion entry replace, target takeoff 1.4–1.9 m from the rim; h 0.73 (one-hand, §5.6); dunk, no meter)
0.00 B'R' RA[40,20,10,110,-40,-30,0] (ball cupped against the forearm) Rft[-0.12,0,0,'f'] P[0,-0.08,0, 10,0,0] ev gather, plantR
0.28 Lft[0.10,1.20,0,'f'] P[0,-0.14,0, -6,0,0] S[-6,0,0] ev plantL
0.36 Lft[null] LL[-10,3,0,10,40,0] RL[100,5,0,100,30,0] (right knee drives to 100° hip flexion) LA[120,20,20,20,0,0,0] (left arm swings up) ev takeoff
0.56 RA[178,25,-40,110,0,-40,0] (ball behind the right ear) S[-15,0,0] N[-15,0,0] E{jawJut:0.6}
0.716 RA[120,10,0,5,90,70,0] S[18,0,0] B'free' ev slam ; 0.746 ev rimGrab (right hand, 'claw', hang 0.10) ; 0.846 ev rimRelease
1.22 RL/LL[45,8,0,50,-15,0] ev land ; 1.50 ev end → cel.kobe.jawJut
sig.kobe.reverse2 (dur 1.60; baseline run, two-foot takeoff under the rim facing away; h 0.85 (cap 1.05); target takeoff 0.3–0.7 m behind the rim plane)
0.00 B'both' CHEST ; 0.14 Rft[-0.22,0.70,0,'f'] Lft[0.22,0.70,0,'f'] (jump stop facing the baseline) P[0,-0.18,0, 15,0,0] ev plantL, plantR
0.28 ev takeoff RA/LA[180,15,0,20,30,-20,0] (ball over the head) ; 0.55 S[-25,0,0] N[-30,0,0] (spine extends back, head back to see the rim) RA/LA[180,20,0,100,30,-30,0]
0.72 RA/LA[150,15,0,10,90,50,0] (arms extend behind the head, slamming backwards) B'free' ev slam ; 0.75–0.90 both hands rimGrab
1.32 ev land ; 1.60 ev end
```

**K6 `sig.kobe.hesiCrossStepback`** — top or wing; hesitation, low crossover R→L, second dribble left, step-back,
then a jumper (shot branch) or exit to the dribble. Between-the-legs variant `…_btl`: the 0.13 bounce goes
between the feet with the right foot forward. Root `motion` entry `carry`; branch (`cancel`) at 0.27.
```
0.00 P[0,-0.06,0, 10,0,0] S[15,0,0] B'path' Bp[-0.30,0.85,0.30] (upright walk dribble)
0.07 P[0,-0.01,0, 2,0,0] S[5,0,0] (torso rises 5 cm, slight lean back: sells a stop) N[-10,0,0] look'rim'
0.13 P[0,-0.13,0, 18,0,0] S[22,0,0] (pelvis drops 12 cm) RA[20,5,35,75,95,30,0] Bp[0.0,0.12,0.30] ev bounce   (low crossover, bounce 0.30 in front)
0.16 Rft[null] (right foot pushes off) ; 0.20 Bp[0.30,0.55,0.30] ev handOnL B'drib'(left)
0.27 second dribble left ; Lft[0.25,0.55,0,'f'] (left foot plants forward) ev plantL     ── branch: no shot input → exit to dribble (cancel)
0.27–0.40 step-back: R z +0.0 → −0.70 (push back), both feet land square 0.40 apart at 0.40 (Lft[0.20,-0.15], Rft[-0.20,-0.15]) knees 55 B'both' CHEST ev land
0.47 takeoff → makeJumper(kobe, three-or-mid by position) from 'TO' (slight backward drift 0.10); from a shot press at 0.27: tIdeal 0.459 → METER_T 0.574 (meterFrom = press)
```

### 9.2 Michael Jordan [PROF:jordan signatureMoves 1–7]

**J1 `sig.jordan.turnFade`** — turnaround fadeaway from the left mid-post or baseline (the 1998 "Last Shot"
family): back to the basket, left-foot pivot ≈ 180° over the right shoulder (root yaw −180, clockwise). Trigger:
shoot while posting within 1.0–5.0 m (60 % of his post shots [PROF:jordan tendencies]). Root `motion` entry
`stop` 20, `h 0.62` (55–70 cm), fade 0.55, scissor kick. Takeoff 0.68; `meterFrom 0.45`, `tIdeal 0.986`,
`METER_T 0.67`. dur 1.75 (2.40 with the Last Shot hold).
```
0.00 P[0,-0.12,0, 12,0,0] S[20,0,0] N[-20,-30,0] (head 30° over the right shoulder) RA/LA[50,45,30,120,20,-25,0] (chinned, elbows out) RL/LL[35,8,0,45,-10,0] Rft[-0.28,0,0,'f'] Lft[0.27,0,0,'t'] B'both' look'none'
0.20 = 0.00
0.27 P[_,_,_, _,15,_] S[_,15,_] N[-20,-30,0] (shoulder fake 15° to the middle, head stays toward the baseline) RA/LA ball 10 cm left
0.33 P[_,_,_, _,0,_] S[_,0,_] (snap back) ; Rft[null] RL[30,25,0,60,10,0]
0.45 R[0.40,0.02,-90] P[0,-0.15,0, 10,-15,0] (pelvis leads clockwise) CHIN (ball rising hip → chin) look'rim'
0.60 R[0.52,0,-180] Lft[0.27,0,-180,'t'] Rft[0.77,0,-180,'f'] P[0,-0.17,0, 10,0,0] (5 cm more load) S[8,0,0] ev plantR, gather
0.68 P[0,-0.04,0, 0,0,0] RL/LL[6,4,0,8,35,0] Rft/Lft[null] RA[100,8,20,110,80,-55,0]               ev takeoff
0.80 RA SET(jordan) LA GUIDE(jordan) RF'shoot' P[0,0,0, -8,0,0] S[-7,0,0] N[-4,0,0]               ev set
0.88 RL[42,5,0,65,40,0] (right knee kicks up) LL[5,5,0,10,30,0] (left leg hangs straighter: the scissor split, toes down)
1.036 (apex = tIdeal + 0.05) RA REL(jordan) (forearm 60–70° above horizontal) LA[107,29,25,78,-10,0,0] (guide opens 15 cm sideways) B'free'   ev release
1.14 RA FOLLOW(jordan) (goose neck, wrist +88) LA[90,20,0,20,0,0,0] (left arm drops to shoulder height)
1.39 RL/LL[30,6,4,30,-10,0] Rft[0.70,0.55,-180,'f'] Lft[0.34,0.55,-180,'f'] R[0.52,0.55,-180] P[0,-0.08,0, 6,0,0]   ev land  (0.55 behind the takeoff, knees absorb 30)
1.49 RA[155,4,15,0,95,88,0] (hold ends) ; 1.75 DOWN ev end
Last Shot variant (clutch make → cel.jordan.lastShot): hold the 1.49 arm pose with feet together (Rft/Lft 0.18 apart) and lean back 5° to 2.40.
```

**J2 `sig.jordan.ftDunk`** — the 1988 free-throw-line dunk (rare special). Trigger (select.js): Jordan, live ball,
dribbling at speed ≥ 6 m/s toward the rim, no defender within 3 m ahead of him or within 1.5 m of the line to the
rim, takeoff spot reachable within 4.2–4.6 m of the rim centre (the free-throw line is 4.215 m from the rim
centre: `|z − LINES.FT_Z| ≤ 0.40`, `|x| ≤ 1.2`), and either the margin ≥ 10, the crowd meter high, or a 0.25
roll; at most once per game. Root `motion` entry `replace`, target: takeoff at the line. `h 1.00`, slam
descending at takeoff + 0.704 (jumpY 0.69), no rim hang, total air 1.08 s. Optional presentation slow-motion
between `slowmoIn`/`slowmoOut` (camera/replay section decides; default only in the replay at 0.35×).
```
0.00 B'both' HIP_R (gather 2–3 m before the line: long stride, ball pulled into both hands at the right hip) Lft[null] ev gather
0.14 Rft[-0.12,1.00,0,'f'] (penultimate RIGHT step, long) P[0,-0.15,0, -10,0,0] S[-5,0,0] (lean back 10° to convert speed)  ev plantR
0.42 Lft[0.12,2.95,0,'f'] (plant at the free-throw line, retimed from the profile's 0.20 s per step to his sprint cadence) LL[20,4,0,60,-10,0] RL[90,5,0,80,20,0] (right thigh to horizontal) RA/LA ball to the chest   ev plantL
0.48 ev takeoff (left knee extends 120 → 175) E{tongueOut:1.0} ; ev slowmoIn at 0.60
0.65 LL[-25,5,0,10,45,0] (take-off leg trails, nearly straight, toe pointed) RL[90,5,0,90,30,0] (knee at hip height): the scissor silhouette
0.77 RA/LA[30,20,20,90,40,-20,0] (double clutch: ball down to the waist, both hands)
0.90 RA[-20,25,10,60,30,-10,0] (right hand alone sweeps it back) LA[100,20,0,20,0,0,0]
1.07 RA[170,25,-30,90,0,-40,0] (cocked behind the right ear) LA[130,20,0,20,-20,0,0] (left arm toward the rim) S[-15,0,0] N[-15,0,0] RL[70,5,0,30,30,0] (right leg extends forward)
1.184 RA[130,10,0,5,90,70,0] (tomahawk: shoulder 170 → 130, elbow extends, wrist snaps) B'free' ev slam, slowmoOut ; legs come together RL/LL[20,4,0,30,30,0]
1.56 RL/LL[50,10,0,60,-15,0] (land under the rim, knees 60) ev land ; E{tongueOut:0} at 1.65
2.00 ev end → one-step jog out + cel.jordan.fistJog
Ball path: hip → chest → waist (clutch) → behind the head → rim; peak hand height ≈ 3.3 m on our rig (profile 3.5 m).
```

**J3 `sig.jordan.theMove`** — 1991 Finals mid-air hand switch to a left-hand reverse-side layup off the glass.
Trigger: Jordan layup from the right wing toward the middle with a defender (big) within 1.2 m of the rim on his
path. Root `motion` entry `replace`, takeoff ≈ 2.0 m from the rim, `h 0.95` (hang; profile frames F8–F28 need
≈ 0.9 s of air: the jump is raised from his layup 0.70 to 0.95), release descending at takeoff + 0.72 (jumpY 0.57).
`meterFrom 0.30`, `tIdeal 0.79`, `METER_T 0.61`. dur 1.25.
```
0.00 B'R' RA[45,20,10,110,-40,-30,0] (gather into the right hand only, cupped) Lft[0.08,0.50,0,'f'] ev gather, plantL
0.12 ev takeoff (two-foot or left) RA[160,15,0,40,-20,-30,0] (as if to dunk) E{tongueOut:1.0} RL/LL[40,8,0,60,30,0]
0.39 (F8) RA starts down ; 0.59 (F14) RA[30,10,40,110,60,-10,0] (ball to the belly) S[20,0,0] (piked 20°) RL/LL[70,10,0,70,30,0] (knees tucked)
0.66 (F16) LA[40,10,40,100,-60,0,0] B'L' (hand switch in front of the belly) ; RA[90,60,0,90,0,0,0] (right arm up/out to shield, elbow 90)
0.79 (F20) LA[130,110,0,20,-40,0,0] (left arm out and up, shoulder abducted 110) S[_,_,15] (side-bend 15° left) N[-25,30,0] (head up-left)
0.84 (F22) LA[140,110,0,10,-40,35,10] (wrist flick with English) B'free' ev release   (ball kissed high off the RIGHT side of the board: gameplay bank target)
0.92 RL/LL[30,8,0,40,30,0] ; 1.00 land both feet beyond the rim, right side ev land ; 1.25 keep running out (exitV 3 m/s) ev end
```

**J4 `sig.jordan.cradle`** — rock-the-cradle breakaway dunk. Trigger: Jordan dunk on a breakaway (no defender
within 4 m), 40 % (tomahawk 40 %, FT-line rare). Takeoff two feet or left foot at 1.2–1.6 m; `h 1.00`
(the pendulum needs the airtime; profile frames compressed so the slam lands at apex − 0.03), rim hang 4 frames.
```
0.00 B'both' then B'R' at 0.06 (cupped against the inside of the right forearm) RA[40,20,10,115,-50,-30,0] Lft[0.10,0.40,0,'f'] ev gather, plantL
0.13 ev takeoff E{tongueOut:1.0} LA[60,70,0,20,0,0,0] (left arm out to the side for balance, held)
0.27 RA[-30,15,10,20,-40,-30,0] (swing DOWN and BACK: ball beside the right hip) S[10,0,0]
0.40 RA[90,15,0,30,-30,-30,0] ; RL/LL[70,10,0,90,30,0] (knees tuck)
0.50 RA[175,20,-20,40,0,-40,0] (pendulum up)
0.55 RA[140,10,0,5,90,80,0] (throws it down, wrist flexes 80) B'free' ev slam ; 0.58–0.71 rimGrab right hand ('claw')
1.15 ev land (drop from 0.95) ; 1.40 ev end
```

**J5 `sig.jordan.jab`** (move) + **`sig.jordan.jabShot`** (shot) + **`sig.jordan.ripDrive`** (drive) — triple
threat at either elbow, weight 60 % on the left (pivot) foot. 40 % of the time a head-and-ball pump fake precedes
the jab (`sig.jordan.jab` plays `move.pumpFake` keys first, 0.40 s).
```
sig.jordan.jab (dur 0.47): 0.00 P[0.04,-0.12,0, 12,0,0] (knees 50, weight left) S[22,0,0] HIP_R Rft[-0.29,0.04,8,'f'] Lft[0.29,-0.03,8,'t'] B'both'
0.27 Rft[null] ; 0.40 Rft[-0.45,0.36,20,'t'] (hard short jab 0.35 toward the defender's left hip) P[_,-0.22,_, 16,_,_] (head and shoulders dip 10 cm) RA[-5,20,40,40,60,-10,0] (ball low across to the left knee) ev plantR, fake
0.47 ev end (branch: shoot → jabShot ; drive → ripDrive ; nothing → back to triple threat 0.20)
sig.jordan.jabShot (dur 0.95; h 0.50; takeoff 0.13; meterFrom 0; tIdeal 0.40; METER_T 0.50)
0.00 Rft[null] ; 0.10 Rft[-0.29,0.04,8,'f'] (right foot returns beside the left) CHIN ; 0.13 takeoff → makeJumper(jordan, mid) from 'TO' (straight up)
sig.jordan.ripDrive (dur 0.45; root motion entry replace; exitV (−0.5, 4.8)): 0.00 RA[-5,20,40,40,60,-10,0] (ball at the left knee)
0.10 RA[10,25,10,60,40,-10,0] (rip low to the right hip) ; 0.18 B'drib' RA push dribble [45,10,15,45,90,20,0] Rft[-0.55,0.80,0,'t'] ev plantR ; 0.45 ev end
```

**J6 `sig.jordan.pullup`** — pull-up jumper off the dribble (left elbow, going right). `makeJumper(jordan, pull12)`
with: two hard right-hand dribbles before (dribble state), 1-2 stop (left then right; or `pullHop` 30 %), pickup
at the right hip, rise straight (drift 0.15 back), `h 0.55`, release at the apex, **no leg split**: air legs
`RL/LL[10,2,0,15,40,0]` (knees together, toes pointed down), follow-through held 0.45 s. `tIdeal 0.475`,
`METER_T 0.594` (§5.2).

**J7 `sig.jordan.defStance`** + **`sig.jordan.steal`** — on-ball defence: `STANCE.def.jordan` (§3.8: width 0.80,
knees 70, pelvis −0.25, back flat 30°, right hand low mirroring the ball, left hand high), shuffle slides without
crossing (§3.5). Steal: `def.steal` with the right hand swiping upward from the knee (`[20,25,10,25,60,−30,0]`) to
the waist (`[70,25,10,20,60,30,0]`) on the dribble's way up (`swipe` at 0.12, resolved only while the ball is
rising, ψd ∈ [0.30, 0.70]), then `exitV` 4 m/s toward the ball (run-out). Optional idle `idle.jordan.palmsFloor`.

### 9.3 LeBron James [PROF:lebron signatureMoves 1–6]

**L1 `sig.lebron.chasedown`** — chase-down block (2016 Finals G7). Trigger (gameplay/AI): opponent breakaway
layup or dunk, LeBron within 4 m behind the shooter on the trailing side, stamina for sprint. The 0.60 s sprint
(F0–18) is locomotion at sprint × 1.25 (8.5–9.0 m/s, stride 2.4 m, torso 20–25°, arms ±60°); the clip starts at the
penultimate step (F18). Root `motion` entry `carry` (keeps ≈ 6 m/s through the air: he flies past the shooter's
back), `h 0.85` (signature; formula 0.70), contact at the apex (palm ≈ 3.34 m on our rig; profile 3.3–3.4).
```
0.00 P[0,-0.12,0, 5,0,0] S[5,0,0] (penultimate: torso straightens to 5°) Rft[-0.10,0,0,'f'] look'ball' ev plantR
0.13 Lft[0.10,1.20,0,'f'] → takeoff off the LEFT foot ; RL[100,5,0,90,30,0] (knee drive) ; LA[-30,20,0,20,0,0,0] (left arm down and back) ev plantL, takeoff
0.30 RA[150,15,0,20,-30,-30,0] (right arm swings from the hip up past the ear) RC[15,0] S[-10,0,0] N[-20,0,0] RF'spread'
0.546 RA[172,15,0,12,-40,-40,0] (apex: arm 170, elbow 10–15, wrist extended 40, fingers spread)                                           ev apex
CONTACT (gameplay, ≈ apex): RA wFlex −40 → +20 over 0.06 s, forearm pronates (pron +30): the 'pin' against the glass; hand IK to the ball 2 frames
0.70 RA[165,15,0,15,-10,10,0] (arm stays high, fingers spread, then drops) S[_,25,_] (torso turns 25° to look back at the court) RL/LL[20,8,0,30,30,0] (legs reach for the landing)
0.96 ev land (staggered: left 0.96, right 1.00) P[0,-0.15,0, 12,0,0] RL/LL[40,8,0,45,-15,0] (knees 45, pelvis −0.15)
0.96–1.30 two decelerating steps (gait) ; optional stare back (look 'ball' at the shooter) + E{roar:0.6} ; 1.30 ev end
```

**L2 `sig.lebron.tomahawk`** — right-hand tomahawk from a full sprint (transition). The approach F0–10 is the
speed dribble (locomotion); the clip starts at the pickup. Root `motion` entry `replace`, takeoff 1.5–2.0 m,
`h 0.80` (cocking behind the head costs ≈ 0.10 of reach), slam at 0.574, rim grab 0.15 s; variant
`sig.lebron.jumpStopDunk` = `dunk.power2` keys with the pelvis −0.18 jump stop.
```
0.00 B'both' HIP_R (pickup into the right hip pocket) Rft[-0.12,0,0,'f'] P[0,-0.08,0, 8,0,0] ev gather, plantR   (step 1: long)
0.12 Lft[0.10,1.40,0,'f'] (step 2: quick plant) P[0,-0.15,0, -10,0,0] S[-6,0,0] (torso leans back 10° to convert speed)   ev plantL
0.20 ev takeoff LL[-10,3,0,10,40,0] RL[90,5,0,95,30,0] (right thigh 90, knee leading) B'R'
0.40 RA[160,30,-50,115,0,-40,0] (ball cocked behind the head, 25 cm behind the occiput, wrist extended 40) LA[120,15,0,20,-20,0,0] (reaching toward the rim)
     S[-18,0,0] (arch 15–20) N[-15,0,0] (chin up) E{roar:0.4}
0.574 RA[125,10,0,5,90,40,0] (hammer: elbow extends, wrist −40 → +40) S[25,0,0] (crunch) B'free' ev slam
0.60–0.75 rimGrab right hand 'claw' (3–6 frames → 0.15) ; body swings forward under the rim, knees tucked RL/LL[60,10,0,90,20,0]
1.14 ev land (wide, knees 50) → chain cel.lebron.roar (1.14 = celebration start)
```

**L3 `sig.lebron.powerDrive`** — "bulldozer" attack from the top or wing; ends in a two-foot jump stop holding the
ball high under the chin 1.2–1.8 m from the rim; the finish is the next input (shoot → `dunk.power2` if eligible,
else `lay.power` with the off arm extended; pass → `sig.lebron.skipPass` / `pass.chest` kick-out). Root `motion`
entry `replace`, target: jump-stop root 1.2–1.8 m from the rim (dribble segment warps ≤ 35 %).
```
0.00 P[0,-0.08,0, 10,0,0] S[15,0,0] B'drib' ; 0.10 S[_,-10,_] N[_,10,_] (jab/hesitation: shoulders feint 10° the other way) Rft[-0.30,0.30,0,'t'] ev fake
0.20 first step (outside foot) Lft[0.15,2.10,0,'t'] (long, low: 2.0 m+) P[0,-0.15,0, 15,0,0] S[18,0,0] (torso 30–35° total, straight spine) ev plantL
0.20–0.47 ball pounded low (bounce at knee height, B'path' bounce at (±0.35, 0.12, 0.6)) on the outside hip
0.47–0.80 shoulder bump: inside clavicle RC[-5,20] (protracted), inside arm 'chicken wing' RA[40,45,0,90,60,0,0] (abd 45, elbow 90) ev contact at 0.60
     (gameplay displaces the defender 0.3–0.6 m; LeBron's path deflects < 10°)
0.80 gather: big two-hand gather into the chest on a long step Rft[...,'f'] B'both' CHEST ev gather
1.00 two-foot jump stop Rft/Lft[±0.25, R_end.z + 0.0,'f'] P[0,-0.20,0, 18,0,0] RA/LA[55,45,35,125,15,-25,0] (ball high, protected under the chin) ev plantL, plantR, end
R: 0.20 [0.10,0.80,0] ; 0.47 [0.15,2.30,0] ; 0.80 [0.15,4.40,0] ; 1.00 [0.15,5.20,0]  (nominal from ≈ 7 m; warped)
```

**L4 `sig.lebron.skipPass`** — cross-court one-hand skip / no-look from a drive (40 % of LeBron's kick-outs; 100 %
when the target is the far corner). Upper layer over the drive (legs: plant of the inside foot). Release 0.16 s
after input; head does NOT turn (look stays 'rim'); ball on a flat line 1.8–2.4 m high, 0.5–0.7 s across (pass
speed is gameplay's). Variant `sig.lebron.skipOverhead` (from the post): both arms straight overhead (flex 175,
elbows 15) and a two-wrist snap, release 0.18.
```
0.00 inside foot plants (gait) ; RA dribble contact → B'R'
0.08 RA[95,20,-10,100,90,-50,0] (ball pulled straight up to shoulder height, wrist cocked back) S[_,-8,_]
0.16 RA[85,-40,0,10,100,40,0] (whips ACROSS the body: horizontal adduction −40, forearm extends, wrist snaps, fingers toward the corner) S[_,15,_] (torso 15–20° only) B'free' ev release
0.32 RA[70,-45,0,5,100,50,0] (follow-through toward the target) ; 0.55 ev end ; look'rim' throughout (no-look)
```

**L5 `sig.lebron.leftBlockFade`** — post on the left block, 1–2 power dribbles (`move.backdown`, left forearm
bar), reverse pivot on the left foot ≈ 150° over the right shoulder (root yaw −150), fadeaway (up and 0.45 back,
lean 15–20, right knee kicks forward 30). Trigger: shoot in the post; also the face-up `jab → shoot` variant uses
`makeJumper(lebron, fade)`. Root `motion` entry `stop`, `h 0.40`, takeoff 0.42, `meterFrom 0.15`,
`tIdeal 0.616`, `METER_T 0.58`. dur 1.30.
```
0.00 P[0,-0.15,0, 10,0,0] S[12,0,0] N[-15,-30,0] RA/LA[55,45,35,125,15,-25,0] Rft[-0.40,0,0,'f'] Lft[0.40,0,0,'t'] B'both'   (wide 0.80 base)
0.08 Rft[null] RL[30,25,0,60,10,0] ; 0.22 R[0.40,-0.05,-90]
0.30 R[0.64,-0.14,-150] Lft[0.40,0,-150,'t'] Rft[0.88,-0.27,-150,'f'] P[0,-0.18,0, 10,0,0] CHIN look'rim' ev plantR, gather
0.42 takeoff (makeJumper(lebron, fade) from 'TO': set 0.55, release 0.666, land 0.99 at R[0.86,0.25,-150], feet Rft[1.03,0.15], Lft[0.69,0.35])
0.62 RL[30,5,0,30,30,0] (right knee kicks forward 30) LL[10,5,0,15,30,0] ; P[0,0,0, -9,0,0] S[-9,0,0]
1.30 ev end
```

**L6 `sig.lebron.stepback3`** — after a left-to-right crossover at the top (`move.cross_L`), one hard dribble
right, quick step-back off the right foot, two-foot balanced landing 0.50 m behind, one-motion shot, slight fade,
follow-through held 10 frames. Clip from the shot input: `h 0.25`, takeoff 0.36, `tIdeal 0.496`, `METER_T 0.62`.
```
0.00 B'drib'→'both' (pickup ≤ 0.12) ; 0.05 Rft[-0.20,0.25,0,'f'] (right foot plants) ev plantR
0.08–0.25 push back: R z 0 → −0.50, hop 0.08 m ; 0.25 Lft[0.20,-0.25,10,'f'] ev plantL ; 0.29 Rft[-0.20,-0.25,10,'f'] ev plantR
0.29 P[0,-0.12,0, 10,0,0] RL/LL[30,6,4,50,-20,0] CHEST→dip ; 0.36 takeoff → makeJumper(lebron, three) from 'TO' with drift 0.10 back, followHold 0.33
```

### 9.4 Giannis Antetokounmpo [PROF:giannis signatureMoves 1–5]

**G1 `sig.giannis.euroDunk`** (and **`sig.giannis.euroLay`**) — Eurostep from the 3-pt line, right-handed,
attacking from the right wing or top. Profile frame times kept; distances kept (step 1 lands ≈ 5.2 m from the
rim, step 2 ≈ 3.5 m); the jump is changed so the flight is physical: `h 0.72`, slam **descending** at apex + 0.10
(takeoff 0.83 → apex 1.21 → slam 1.31), rim hook 0.20 s, land 1.91. Trigger: Giannis drive with a defender in the
lane (35 % of his drives) and dunk-eligible; `euroLay` (same keys, release `REL` layup at the apex 1.20 instead of
the slam, `meterFrom 0.60`, `tIdeal 1.15`, `METER_T 0.69`) when not. Root `motion` entry `replace`, target:
takeoff root 2.6–3.2 m from the rim.
```
0.00 P[0,-0.13,0, 8,0,0] S1/S2/S3[8/8/6,0,0] N[-20,0,0] (eyes level) B'drib' RA at the right hip  (7.2 m out)
0.00–0.20 one long push dribble: RA[40,10,15,15,90,20,0] (upper arm forward 40, elbow 15) Bp bounce ≈ 1.3 m ahead at 0.6 m height ; strides 1.7 m, arms counter-swing
0.23 B'both' (gather at right-hip height) LA crosses the body ; RF/LF'grip' (fingers spread 10, thumb abducted 40: one-palm-ish gather) ev gather
0.33 Rft[-0.55,2.00,-25,'f'] (STEP 1: 2.0 m, angled 25° to his right: the fake direction; heel strike) ev plantR
     P[-0.10,-0.16,0, 6,-15,0] (pelvis yaws 15 right, drops) S2[_,_,-10] (side-bend right 10) N[_,-20,_] (head and eyes right 20: sell the fake) RA/LA[40,35,30,110,20,-25,0] (elbows out 35: protect)
0.37–0.57 float: RL[30,10,0,40,10,0] LL[40,5,0,30,10,0] (left thigh swinging forward) Lft[null]
0.60 Lft[0.65,3.70,20,'f'] (STEP 2: 1.7 m forward and 1.2 m to his LEFT, past the defender's hip; foot 20° toward the rim) ev plantL
     LL[55,8,0,65,-12,0] P[0.10,-0.24,0, 8,0,0] (yaws back to face the rim) S1/S2/S3[_,_,6/6/4] (side-bend left) look'rim'
0.60–0.95 ball swings hip → sternum → left shoulder: RA[100,10,40,120,40,-30,0] LA[120,35,0,100,20,-30,0] at 0.80
0.60–0.83 load: LL knee 65 → 75 ; RL[90,5,0,100,20,0] (right knee drive) ; RA/LA flex 150 (ball over the left shoulder toward the head)
0.83 ev takeoff (left foot; foot/ball plantar 40) S[0,0,0]
1.00 B'R' RA[170,20,-30,70,0,-40,0] (ball cocked above and behind the head) LA[150,30,0,30,-30,0,0] (guard arm stays up)
1.21 ev apex ; 1.31 RA[130,10,0,5,90,60,0] (wrist snap-down, hand flexes 60) B'free' ev slam (hand ≈ 0.25 above the rim)
1.34–1.54 rimGrab right hand ('claw', hook 4–8 frames → 0.20 s) RL/LL[60,10,0,70,20,0] (legs swing forward, knees 70) ; 1.54 ev rimRelease
1.91 ev land (two-footed, knees 50) → cel.giannis.flexRoar (if the class allows)
Variant (defender does not shift): step 2 straight (Lft[0.15,3.70,0]) into a two-foot jump stop and dunk.power2 keys from its 0.12 key.
```

**G2 `sig.giannis.longGather`** — long-gather two-hand power dunk in transition (coast to coast). Profile frames
kept; `h 0.66` two-hand, slam descending at apex + 0.10 = 1.067 (F32) ✓, hang 0.30 s, land 1.75 (F52) ✓. Root
`motion` entry `replace`, target: gather at 5.0–5.4 m, takeoff root 2.6–3.2 m. Trigger: Giannis, sprinting,
one dribble from ≥ 7 m, no defender within 1.5 m of his path.
```
0.00 last dribble right hand at full sprint (stride 2.1) P[0,-0.10,0, 12,0,0] S[15,0,0]
0.27 B'both' HIP_R then up the midline to the chest (CHEST at 0.40) Rft[-0.12,0,0,'f'] ev gather, plantR
0.27–0.53 long right step 2.1 m into the LEFT plant: Lft[0.12,2.10,0,'f'] at 0.53 ev plantL ; P[0,-0.27,0, 6,0,0] S[10,0,0]
     (variant: two-foot jump stop after a 1.5 m hop → Rft/Lft[±0.25,1.50] at 0.53)
0.60 ev takeoff (hips and knees extend) RA/LA[160,15,0,30,30,-20,0] (ball swung up the midline overhead)
0.80 RA/LA[175,18,0,100,30,-20,0] (ball behind the head at neck_01 level) S2/S3[-12,0,0]/[-12,0,0] N[-10,0,0] RL/LL[70,10,0,110,30,0] (knees tuck) E{roar:0.4}
0.967 ev apex
1.03 S1/S2/S3[10/12/10,0,0] (crunch) RA/LA[150,15,0,10,90,60,0]
1.067 B'free' ev slam (both hands ≈ 0.30 above the rim) ; 1.10–1.40 rimGrab both hands 'claw', elbows bend 30 (slight pull-up)
1.20 RL/LL[60,15,0,80,20,0] (legs swing forward, knees lift and apart: thigh 60, abd 15) ; 1.40 ev rimRelease
1.75 ev land (two feet under the rim) → cel.giannis.flexRoar (chained, no blend gap)
```

**G3 `sig.giannis.spinGather`** — reverse spin gather into the lane from the right elbow/wing when cut off on a
right-hand drive. Retimed from the profile's 300° in 0.4 s (kept) with the jump `h 0.50` (left-hand finger roll
at 3.0–3.1 m on our rig; profile 3.25). Root `motion` entry `replace`, root yaw +300 CCW (target-matched so he
faces the rim at 0.63, ±25°). `meterFrom 0.63`, `tIdeal 1.07`, `METER_T 0.55`. dur 1.70.
```
0.00 driving right, right-hand dribble P[0,-0.12,0, 12,0,0] B'drib'
0.23 Lft[0.25,0.40,30,'t'] (hard plant, toes 30° right of travel) P[0,-0.18,0, 10,0,0] B'both' HIP_R ev plantL, gather
0.33 N[_,80,_] (head whips round first to spot the rim) R[0.05,0.30,90]
0.23–0.63 spin on the left forefoot: R yaw 0 → +300 ; RL[30,30,0,70,10,0] (right leg swings round, thigh abducted 30, knee 70) RA/LA[40,40,30,110,20,-25,0] (ball tight at the right hip, elbows flared 40, right shoulder sealing)
0.63 Rft[-0.87,0.87,300,'f'] (right foot lands ≈ 1.4 m past the defender's hip toward the rim) R[-0.31,0.64,300] ev plantR
0.63–0.80 load on the right foot, left knee drives up LL[90,5,0,100,20,0]
0.83 ev takeoff (RIGHT foot) ; LA[150,15,0,30,-60,-20,0] B'L' (ball rises up the left side, lowerarm_l extending)
1.12 LA[170,10,0,5,-70,15,0] (finger roll) B'free' ev release ; RA[80,40,0,60,0,0,0] (shield)
1.47 ev land ; 1.70 ev end
Two-foot variant: jump stop at 0.63 (both feet) → dunk.power2 / lay.power from their gather keys.
```

**G4 `sig.giannis.helpBlock`** — chase-down/help block (2021 Finals G4). The weak-side sprint (2.2 m strides,
arms pumping) is locomotion; the clip starts at the stutter-penultimate. Inside arm = the arm nearer the ball
(either side; `_L` mirrored). `h 0.785` (peak at takeoff + 0.40 = F12 ✓), pin with a 40° wrist flex.
```
0.00 stutter: Rft[-0.12,0,0,'f'] P[0,-0.22,0, 8,0,0] ev plantR ; 0.08 Lft[0.12,0.75,0,'f'] (left-foot penultimate) ev plantL
0.15 ev takeoff (LEFT foot) ; RA[175,10,0,0,-90,-15,0] (inside arm straight up, palm toward the ball, fingers spread and slightly hyperextended) RF'spread'
     LA[-20,40,0,20,0,0,0] (other arm down and back: extension 20, abd 40) S2/S3[_,_,±15 toward the ball] N[-25,0,0] look'ball'
0.55 ev apex (high hand ≈ 3.37 m on our rig; profile 3.6) ; CONTACT (gameplay) → RA wFlex −15 → +25 (pin, down-forward) over 0.06
0.70 RL[80,10,0,60,30,0] LL[-10,5,0,15,40,0] (legs split as the body drifts past the rim)
0.95 Lft lands ev land ; 1.02 Rft lands ; 1.30 ev end → E{roar:1.0} + fists (upper) 0.8 s
```

**G5 `sig.giannis.elbowDrive`** — face-up at the right elbow (≈ 4.5 m), jab, one left-hand crossover with a 1.9 m
stride past the defender's left hip, gather on the left foot, one 1.8 m right-foot step, finish (two-foot or
right-foot takeoff; left-hand or two-hand). Default AI drive when cut off at the elbow [PROF:giannis]. The move
part ends at the gather; the finish is `lay.std1_L` (right-foot takeoff, left hand) or `dunk.power2`.
```
0.00 tripleThreat (Giannis) ; 0.10 Rft[-0.29,0.44,0,'t'] (jab 0.4) P[_,-0.05,_] N[_,-10,_] (head fake right) ev fake
0.20 Rft[-0.29,0.04,8,'f'] ; 0.23 B'path' crossover dribble hand_r → hand_l at knee height (bounce at (0, 0.12, 0.5) at 0.30)
0.23–0.50 Lft[0.40,1.95,0,'t'] (left foot strides 1.9 m past the defender's left hip) ev plantL at 0.50 ; B'both' at 0.53 ev gather
0.53–0.83 Rft[0.20,3.75,0,'f'] (one more 1.8 m right-foot step) ev plantR at 0.83 → finish clip (target-matched)
```

### 9.5 Yao Ming [PROF:yao signatureMoves conventions + 1–8]

Yao's jumps are small (0.15–0.35 m [PROF:yao]); his post moves start from `STANCE.postUp` scaled by his sLeg
1.171. The profile's release heights (3.45–3.55 m, fingertips) are ≈ 0.5 m above what our rig reaches with these
jumps (ball centre 2.85–3.0 m); the clips keep the profile's joint angles and jump heights.

**Y1 `sig.yao.hook`** — right-hand jump hook to the middle from the left block (primary move, 30 % of his post
touches). Root `motion` entry `stop`, `h 0.22` (rise 0.22), takeoff 0.60, apex 0.812, release at apex − 0.02 =
0.79, launch 55° (gameplay arc), `meterFrom 0.30`, `tIdeal 0.74`, `METER_T 0.55`. dur 1.50.
```
0.00 P[0,-0.12,0, 6,0,0] S1/S2/S3[5/5/5,0,0] N[-8,30,0] (head yawed 30 left) RA/LA[40,60,30,110,15,-25,0] (chinned: abd 60, elbows out, lowerarm 110)
     RL/LL[35,8,0,45,-10,0] (thigh 35, calf 45) Rft[-0.38,0,0,'f'] Lft[0.37,0,0,'f'] B'both' look'none'
0.00–0.20 one hard right-hand dribble: B'path' chest → floor 0.30 outside the right foot (Bp[-0.68,0.12,0.0] at 0.10, ev bounce) → back to both hands at 0.20
     S2[-8,_,_] (leans back 8 into the defender: shoulder bump) P[_,_,-0.05] ev contact at 0.10
0.20 Lft[null] ; 0.40 Lft[0.92,-0.15,70,'f'] (left foot steps 0.55 toward the lane middle and 0.15 toward the rim) R[0.30,-0.08,70] (pelvis/root yaw CCW 70: left shoulder points at the rim) HIP_R rising ev plantL
0.40 Rft[null] ; 0.55 Rft[0.73,0.25,70,'f'] (right foot closes to 0.40 from the left: two-foot jump-hook gather) RL/LL[40,8,0,50,-12,0]
     RA[110,60,-20,130,60,-40,0] (ball at the right ear, right hand under-behind) LA[90,40,30,110,0,-20,0] ev gather
0.60 ev takeoff (both feet) ; LA[50,75,0,95,0,0,0] (left arm becomes the bent shield: abd 75, elbow 95, forearm horizontal at chest height)
0.60–0.79 RA sweeps up in the coronal plane: [30,95,0,90,60,-40,0] → [10,170,0,10,60,-10,0] (abd 95 → 170, elbow 90 → 10); ball arcs from the right ear outward over the head
     N[-20,_,10] (head yawed fully to the rim, neck tilted 10° left)
0.79 RA[10,170,0,10,60,30,0] (wrist flex 0 → 60 over 0.73–0.86) B'free' ev release ; 0.86 RA wFlex +60 RF'snap'
0.86–1.20 follow-through: right arm vertical, wrist dropped ('hand in the cookie jar'); LA[20,45,0,30,0,0,0] (lowers to 45° abduction)
1.02 ev land (same spot, no fade, knees absorb 30) ; 1.27–1.50 S[_,20,_] (torso turns 20° toward the rim to watch) ; 1.50 ev end
```

**Y2 `sig.yao.turnFade`** — turnaround fadeaway from the right block over the right shoulder (15 %). Left-foot
pivot, root yaw −160 (clockwise), `h 0.28`, fade 0.35, lean back 12 (spine_02 8, spine_03 4), legs trail forward
15°. Takeoff 0.53, apex 0.769, release ≈ 0.75 (launch 50°), `meterFrom 0.27`, `tIdeal 0.699`, `METER_T 0.54`.
```
0.00 postUp (right block) P[0,-0.12,0, 6,0,0] S[15,0,0] N[-8,-30,0] RA/LA[40,60,30,110,15,-25,0] Rft[-0.38,0,0,'f'] Lft[0.37,0,0,'t'] B'both'
0.00–0.27 head fake: N[_,25,_] S3[_,25,_] (yaw 25 left: fake middle) ; ball dips 0.10 (RA/LA elbow 120)
0.27 Rft[null] RL[30,25,0,55,10,0] ; 0.40 R[0.35,-0.03,-80]
0.53 R[0.60,-0.09,-160] Lft[0.37,0,-160,'f'] Rft[0.84,-0.17,-160,'f'] (square to the rim) RL/LL[45,6,0,55,-15,0] (thigh 45 load)
     RA/LA ball up the midline chin → forehead ev plantR, gather ; then ev takeoff at 0.53 (Rft/Lft[null])
0.67 RA[118,8,16,95,85,-77,0] LA[104,10,45,100,15,-20,0] (set 0.15 above and 0.10 in front of the forehead, elbow 10° out) S2/S3[-8,0,0]/[-4,0,0] RL/LL[15,6,0,20,30,0] ev set
0.75 RA[168,4,15,5,90,-15,0] (lowerarm extends to 5) B'free' ev release ; 0.75–0.88 wrist flex 70 over 4 frames RF'snap' ; LA stays (no thumb flick), opens sideways at 0.85
1.01 ev land (0.35 behind: R[0.72,0.24,-160], Rft[0.93,0.16], Lft[0.51,0.32]) knees absorb 35, torso straightens ; 1.20 ev end (follow-through held to 1.10)
```

**Y3 `sig.yao.jabJumper`** — high-post face-up jumper / pick-and-pop (55 % at the high post). `makeJumper(yao,
mid)` with an optional 0.30 m right-foot jab (0.00–0.33, head/shoulder dip 10°) before the gather (0.33–0.53), then
a 0.15 m rise, no fade, release at the apex, hold the follow-through, drop the arms and backpedal. With the jab:
takeoff 0.53, `h 0.15`, `meterFrom 0.20`, `tIdeal 0.635`, `METER_T 0.54`; without: the form values (§5.2).

**Y4 `sig.yao.dropStep`** — drop-step two-hand power dunk from the left block (defender on the high side). Right
foot reverse-pivots 0.6 m back toward the baseline and rim, root yaw −120 (clockwise), optional one dribble
between the feet at 0.13, two-foot power gather, `h 0.48` (two-hand need on our rig; profile rise 0.33), slam at
0.75, optional right-hand rim grab 3 frames, heavy landing, roar.
```
0.00 postUp (left block) Rft[-0.38,0,0,'f'] Lft[0.37,0,0,'t'] RA/LA[40,60,30,110,15,-25,0] B'both'
0.05 Rft[null] RL[25,25,-20,50,10,0] ; 0.13 optional dribble (B'path' bounce between the feet) ev bounce
0.27 R[0.49,-0.21,-120] Rft[0.62,-0.43,-120,'f'] (drop step: 0.6 m back toward the baseline and rim) S2[-6,_,_] (seals with a 6° lean back) ev plantR
0.27–0.47 two-foot power gather: Lft[0.25,-0.05,-120,'f'] (feet 0.5 apart facing the rim) RL/LL[60,8,0,70,-15,0] (thigh 60, calf 70) P[0,-0.20,0, 15,0,0] CHEST elbows out ev gather
0.47 ev takeoff ; 0.65 RA/LA[170,15,0,20,30,-20,0] → [170,15,0,0,40,-10,0] (ball overhead)
0.75 RA/LA[150,12,0,0,90,60,0] (both hands drive it down, wrists flex 60) B'free' ev slam E{roar:0.8}
0.78–0.88 optional right-hand rimGrab (3 frames), body swings 5° ; 1.18 ev land (thigh 50: heavy) ; 1.18–1.65 → cel.yao.fistPump
Not dunk-eligible → `sig.yao.dropStepLay`: same to 0.65, two-hand power layup release at the apex (0.78) off the glass.
```

**Y5 `sig.yao.vertical`** and **`sig.yao.block`** — rim protection in drop coverage. Stance: feet 0.70, knees
25, arms half-raised `[45,45,0,60,−30,0,0]` (hands at shoulder height). The 0.4 m shuffle toward the shooter's
line (F0–6) is the slide gait; the clips start at the load (F6). `h 0.30` nominal (formula 0.34/0.27).
```
sig.yao.vertical: 0.00 RL/LL[35,8,0,40,-12,0] P[0,-0.10,0, 6,0,0] (load) ; 0.13 ev takeoff RA/LA[175,5,0,0,-90,0,0] (straight up, palms forward) RF/LF'spread' S[0,0,0] P pitch 0 (body straight)
     0.38 ev apex (fingertips ≈ 3.10 m on our rig; profile 3.25) ; 0.63 ev land ; 0.63–1.03 arms down to abd 90, head tracks the ball, turn and jog
sig.yao.block: as vertical but the blocking arm (default LEFT vs a right-handed shooter, else the nearer arm) [160,15,0,5,-90,-10,0] (15° forward of vertical), other arm vertical
     CONTACT (gameplay, 0.33–0.38): swat wFlex −10 → +50 over 0.06 (ball out sideways-down 6–8 m/s, gameplay) or soft tip-to-self wFlex −10 → +20 (ball up and back)
```

**Y6 `sig.yao.pumpHook`** (move) + **`sig.yao.upUnder`** (shot) — counter to the hook (5 %): from the hook
gather (Y1 0.55 pose), pump fake ear → forehead → back in 0.20 s (heels +0.04, head and eyes up), then step through
and lay it in. Shoot within 0.6 s after the pump (or AI when the defender left the floor). `upUnder`: takeoff 0.40,
`h 0.15`, release 0.57 (finger roll, underspin), land 0.75; `meterFrom 0.10`, `tIdeal 0.52`, `METER_T 0.525`.
```
sig.yao.pumpHook (dur 0.20): 0.00 RA[110,60,-20,130,60,-40,0] (ear) ; 0.10 RA[140,30,0,100,80,-60,0] (forehead) RL/LL[_,_,_,_,8,0] (heels +0.04) N[-25,_,_] look'rim' ev fake ; 0.20 back to the ear
sig.yao.upUnder: 0.00 Rft[null] ; 0.20 Rft[+0.0, +0.60 toward the rim past the defender's hip,'f'] (step-through, left foot pivots) S2[20,_,_] (ducks under) ev plantR
     0.40 ev takeoff (off the left or both) ; 0.57 RA[160,10,0,10,-70,15,0] (upper arm 160, forearm extends, ball off the fingertips with underspin) B'free' ev release ; 0.75 ev land ; 1.00 ev end
```

**Y7 `sig.yao.overheadPass`** — double-team overhead pass (always when doubled within 0.8 s [PROF:yao]). Release
at F8 = 0.25 s after the input (0.20 when already chinned), flat 4–6° line at 10–12 m/s (gameplay speed).
```
0.00 catch/hold ; 0.20 RA/LA[165,15,0,70,30,-30,0] (ball overhead, both hands at the back of the ball, elbows 70: ball behind the head) N[_,toward the target,_] look'target'
0.25 RA/LA[120,10,0,0,90,30,0] (arms snap: upper arm 165 → 120, lowerarm 70 → 0, thumbs rotate down: pron +60) B'free' ev release ; Lft step 0.20 toward the target
0.27–0.60 follow-through pointing at the target, then relax ; 0.60 ev end
```

**Y8 `sig.yao.rebound`** — box-out (`STANCE.boxOut`: hips back, thigh 40, arms out abd 90 forearms up) then
two-foot jump of only 0.20, both arms fully extended overhead (grab ≈ 2.95 m on our rig; profile 3.30), secure
with both hands, pull to the chin with elbows flared 80, swivel ±10.
```
0.00 boxOut ; 0.10 ev takeoff (load 0.00–0.10: P dy −0.14) RA/LA[178,10,0,5,-80,-10,0] RF/LF'spread' look'ball'
0.30 ev apex ; CATCH (gameplay) → B'both' hands IK ; 0.50 ev land ; 0.50–0.70 RA/LA[55,80,35,125,15,-25,0] (chin it)
0.70–1.10 S[_,10,_] → S[_,-10,_] → S[_,0,_] (clear space) ; 1.20 ev end
```

### 9.6 Kyrie Irving [PROF:kyrie signatureMoves 1–6]

**Ky1 `sig.kyrie.hesiCross`** — hesitation crossover right to left (20 frames, 0.67 s). Ankle-break eligible
(§6.9). Root `motion` entry `carry` → speed × 0.4 during 0.00–0.17, then the explosion (`exitV` (2.0, 5.0)).
Suggested immunity [0.10, 0.45].
```
0.00 P[0,-0.07,0, 8,0,0] S[15,0,0] (lean 15) B'path' Bp[-0.32,0.55,0.25] (ball at hip height outside the right foot) look'man'
0.10 Rft[-0.18,0.35,0,'f'] (right foot plants slightly ahead) P[0,-0.01,0, 2,0,0] (pelvis RISES 6 cm) S[5,0,0] N[-15,0,0] look'rim' (as if to shoot)
     LA[20,30,0,30,0,0,0] (left arm floats out 30) Bp[-0.30,0.85,0.30] (soft high dribble, top 0.85)                                        ev plantR, fake
0.17 P[0,-0.17,0, 15,0,0] (drops 10 cm) RL/LL[45,8,0,60,-15,0] (knees 60) S[25,0,0] (snaps to 25 lean) RA[20,5,35,75,95,35,0] (pushes the ball low and hard across)
0.22 Bp[0.00,0.12,0.40] ev bounce (one bounce below the knee, midway between the feet)
0.27 Bp[0.32,0.40,0.38] B'L' (caught by the left hand outside the left knee) ev handOnL ; RC[-8,15] (right shoulder dips and rotates toward the defender)
0.33 Lft[null] (left foot pushes off) ; RL[50,10,15,60,10,0] (right thigh drives across and forward) P[_,_,_, _,30,_] (pelvis yaws 30 left) N[0,0,0] look'rim' (head level)
0.47 Rft[0.55,1.10,30,'t'] (long first step) ev plantR ; B'drib' (left-hand dribble ahead of the left foot)
0.67 S[20,0,0] (20° drive lean) ev end
R: 0.00 [0,0,0] ; 0.17 [0,0.25,0] ; 0.33 [0.25,0.45,10] ; 0.50 [0.70,0.95,25] ; 0.67 [1.10,1.60,30]
```

**Ky2 `sig.kyrie.doubleBtlStepback`** — double between-the-legs into the step-back three (2016 Finals G7),
right wing. The dribble part is a move (tertiary); a shot input during 0.43–0.57 branches into the step-back
jumper. Jump retimed: `h 0.35` needs T½ 0.267, so takeoff moves from F27 to F25 (0.83) to keep the release at the
top (1.09) — release `tIdeal` from a press at 0.57 = 0.47, `METER_T 0.59` (`meterFrom` = press).
```
0.00 Lft[0.35,0.25,0,'t'] Rft[-0.35,-0.10,0,'t'] (wide 0.70, LEFT foot forward) P[0,-0.12,0, 12,0,0] S[20,0,0] N[-20,0,0] B'path'
0.00–0.20 right hand bounces it between the legs front → back to the left hand: Bp[-0.30,0.55,0.25] → bounce Bp[0.02,0.12,0.05] at 0.10 (ev bounce) → Bp[0.30,0.40,-0.15] at 0.20 ev handOnL
0.23–0.40 left hand sends it back between the legs to the right hand while the feet scissor: Lft[null]/Rft[null] alternate, end Rft[-0.35,0.25,0,'t'] Lft[0.35,-0.10,0,'t'] (right foot forward)
     bounce at 0.30 ev bounce ; 0.40 ev handOnR ; P dy ±0.03 bob at 5 Hz
0.43 Rft[-0.35,0.50,0,'t'] (jab 25 cm toward the defender) S[28,0,0] (shoulders dip) Bp[-0.32,0.35,0.20] (ball low right) ev plantR, fake
0.53 ev end of the move (cancel) ── shot branch:
0.57 Rft push-off ; R z 0 → −0.80 over 0.57–0.70 (hop back 0.7–0.9) B'both' HIP_R (gathered during the hop)
0.70 Lft[0.20,-0.55,5,'f'] ev plantL ; 0.73 Rft[-0.20,-0.55,5,'f'] ev plantR (0.40 apart)
0.73–0.83 load: RL/LL[40,6,4,70,-25,0] (knees 70) ; ball up along the chest to the set point (SET(kyrie) at 0.98)
0.83 ev takeoff (h 0.35, fade 5–10° back) ; 1.09 REL(kyrie) B'free' ev release ; 1.19 FOLLOW(kyrie)
1.36 ev land (0.15 behind the takeoff) ; 1.55 ev end (follow-through held → cel.kyrie.holdFollow on a make)
```

**Ky3 `sig.kyrie.spinFinish`** — reverse-pivot spin into a left-hand finish off the glass (24 frames + jump).
Trigger: Kyrie layup with the stick toward the dribble hand and a defender in front within 1.2 m. Root `motion`
entry `replace`, root yaw +270 CCW, `h 0.50`, takeoff 0.53 (right foot), release 0.82, land 1.17; `meterFrom
0.33`, `tIdeal 0.77`, `METER_T 0.55`.
```
0.00 driving right, right-hand dribble P[0,-0.08,0, 12,0,0] B'drib'
0.10 Lft[0.20,0.40,30,'t'] (hard plant ahead and across, knee 70: braking) LL[40,10,0,70,-20,0] ev plantL
0.13–0.20 RA[25,20,30,85,120,-10,0] B'R' (ball pulled to the right hip, palm on top, close to the body) N[_,80,_] (head turns over the left shoulder first)
0.23–0.40 spin: R yaw 0 → +270 around the left forefoot ; RL[30,35,0,60,10,0] (right leg swings round wide and low) RC/LC level ; elbows within 15 cm (RA/LA abd ≤ 20)
0.33 B'L' (switch to the left hand at ≈ 200°) ev handOff
0.43 Rft[-0.80,0.28,270,'f'] (right foot lands toward the rim) B'both' (gather, long step) P[_,-0.16,_] ev plantR, gather
0.53 ev takeoff (right foot) ; LA[150,15,0,25,-80,-30,0] (left arm up, wrist under the ball) RA[90,60,0,60,0,0,0] (right arm shields at shoulder height)
0.82 LA[170,12,0,5,-80,20,0] (fingers roll it up off the glass) B'free' ev release
1.17 ev land ; 1.40 ev end
R: 0.23 [0.05,0.42,30] ; 0.33 [-0.05,0.40,180] ; 0.43 [-0.30,0.34,270] ; 0.53 [-0.40,0.34,270]
```

**Ky4 `sig.kyrie.reverseLay`** — reverse layup with English off the glass along the right baseline (30 frames).
Trigger: layup approach along the baseline passing under the rim (angle to the baseline < 35°), always for Kyrie
vs a rim protector [PROF:kyrie tendencies]. Root `motion` entry `replace`, target: plant under the front of the
rim. `h 0.55`, takeoff 0.37, release apex − 0.03 = 0.675, `meterFrom 0.20`, `tIdeal 0.625`, `METER_T 0.53`.
```
0.00 drive along the baseline, last right-hand dribble ; P[0,-0.10,0, 10,0,-12] (body leaning 20° toward the baseline: roll + S)
0.20 B'both' Lft[0.10,0.60,0,'f'] (left foot down) ev gather, plantL
0.33 Rft[-0.10,1.40,0,'f'] (right foot plants under the front of the rim) RL/LL[45,8,0,60,-15,0] (knees 60) N[-30,_,_] look'rim' (eyes up and back over the LEFT shoulder) ev plantR
0.37 ev takeoff ; 0.50 S[-10,40,0] (leans back 10, twists 40 toward the rim) N[-35,40,0] (head up and back at the board)
     RA[175,10,0,15,-60,-40,0] (right arm straight overhead, slightly behind the head; hand under the ball, palm facing the glass) B'R'
0.675 RA[178,12,0,10,-20,20,-20] (wrist and fingers flick left-to-right: heavy sidespin; gameplay bank target 0.30 left of the rim centre line and 0.40 above the rim) B'free' ev release
0.60–0.73 LA[80,60,0,30,0,0,0] (left arm out to shield) ; 1.04 ev land (two feet, opposite side, facing the far corner) ; 1.25 ev end
```

**Ky5 `sig.kyrie.floater`** and **`sig.kyrie.scoop`** — high floater/teardrop from 3–4.5 m (10 % of his shots;
always vs a big within 2 m of the rim [PROF:kyrie]) and the underhand scoop from wide angles. Floater: one-foot
(left) takeoff at 0.17, `h 0.40`, release on the way up at 0.40 (rva −0.05), arc ≈ 70°, peak ≈ 1.8 m above the
rim (gameplay arc), land 0.74 often on one foot. `meterFrom 0`, `tIdeal 0.35`, `METER_T 0.44`.
```
sig.kyrie.floater (dur 0.95)
0.00 B'both' (early one-two gather off the LEFT foot at ≈ 4.5 m) Lft[0.10,0.20,0,'f'] P[0,-0.10,0, 8,0,0] ev gather, plantL
0.10 RL/LL[30,6,0,35,-10,0] (knees only 35: no full dip) ; 0.17 ev takeoff (left foot, or a quick two-foot hop) ; drift 0.25 forward
0.25 RA[110,10,15,80,60,-40,0] B'R' ; 0.33 RA[150,8,10,30,70,-30,0] (arm extends up and forward ≈ 60° above horizontal, ball in the fingertips)
0.40 RA[155,8,10,10,70,15,0] (soft fingertip flip, backspin) B'free' ev release ; LA[60,45,0,30,0,0,0] (free arm angles out for balance)
0.47–0.60 RA wFlex +25 relaxed, arm stays up ; 0.74 ev land (one foot: Lft only, then Rft at 0.80) ; 0.95 ev end
sig.kyrie.scoop: same approach, takeoff 0.17 with h 0.30 ; 0.25 RA[0,15,0,20,-80,10,0] (ball pulled down to the hip, palm up)
     0.25–0.38 RA sweeps forward and up [0 → 110, …, pron −80] (underhand from below the waist) ; 0.38 B'free' ev release (spinning flick off the glass) ; land 0.66
```

**Ky6 `sig.kyrie.btbPullup`** — going right: hard two-foot stop (feet 0.60 wide), behind-the-back wrap to the left
hand while the body still moves right, defender overruns, gather off the left-hand bounce in 2 frames, pull-up off
a two-foot hop, same form. Trigger: shoot within 0.25 s after `move.btb`, or shoot with the stick away from the
travel direction at speed > 3 (AI: 25 % of his pull-ups). Root `motion` entry `stop` 24 m/s², `h 0.40`, takeoff
0.45, release 0.726, land 1.02; `meterFrom 0.24`, `tIdeal 0.676`, `METER_T 0.54`.
```
0.00 Rft[-0.30,0.15,0,'f'] Lft[0.30,0.10,0,'f'] (hard stop, both feet 0.60 wide) P[0,-0.15,0, 10,0,0] ev plantL, plantR
0.04–0.16 RA[-30,35,-55,75,90,25,0] (wraps behind the lumbar at pelvis height) B'path' Bp[-0.25,0.55,-0.20] → bounce Bp[0.05,0.12,-0.28] at 0.14 (behind the heels) ev bounce
0.22 LA[10,20,0,60,90,10,0] Bp[0.30,0.45,0.05] ev handOnL ; 0.24 B'both' (gathered off the left-hand bounce in 2 frames) ev gather
0.30–0.38 small two-foot re-hop (P dy +0.04, feet re-lock in place) ; 0.38 dip → makeJumper(kyrie, pullHop) keys from the dip ; 0.45 ev takeoff
0.726 REL(kyrie) ev release ; 1.02 ev land ; 1.25 ev end
```

---

## 10. Gameplay integration

### 10.1 State → animation map

| gameplay situation (v1 state / v2 event) | animator call | clip(s) | authority and sync |
|---|---|---|---|
| MENU / lineup / team draft | showcase loops | §8.4 | animation only |
| CHECK (formation tween 0.8 s) | base gait from the tween velocity; handler `tripleThreat`; defenders `def`; habits | §3, §8.3 | positions: gameplay; reset = 0.20 s crossfade, never a snap ([REV#36]) |
| LIVE, off-ball, idle/move | gait + look-at | §3 | velocity/yaw: gameplay (facing rules §3.5) |
| LIVE, dribbling | gait + dribble upper layer, ball `drib` | §4.1 | ball position from `dribble.js` in the step |
| catch / hold (v1 `HOLD_AFTER_CATCH`) | `catch.*` → `tripleThreat` | §7.4 | `CATCH` from `ball.js`; `READY` 0.30 s later gates CPU shots |
| tertiary on offence (v1 `cross`) | `selectMove` | §4.2–4.3, §9 | root motion; `params.imm` immunity window |
| shot press (v1 `windup`) | `selectShot` → `play(clip, {warp:{takeoff, set}})` | §5, §9 | jump physics starts at `TAKEOFF`; meter `meterFrom`/`METER_T` from the animator |
| shot release input (v1 `release`) | `releaseNow()` | — | ball launch at input + 0.05 s from the socket; rules time = input |
| layup / dunk press | `selectLayup` / `selectDunk` | §5.5–5.6, §9 | target matching; `RELEASE` / `SLAM` / `RIM_GRAB` events |
| pass tap / hold | `selectPass` | §7 | ball launch at `RELEASE` |
| pass in flight to me | `catch.ready` | §7.4 | — |
| steal tap (v1 `steal`) | `def.steal` | §6.7 | steal resolved at `SWIPE` (0.10–0.14 s) |
| block / contest / rebound press (v1 `jump`) | `selectDefJump` | §6, §9 | jump at `TAKEOFF` (0.08–0.15 s after press); contact by socket |
| stunned after a failed steal | `def.stealMiss` | §6.7 | 0.35 s |
| stunned by a crossover | `def.stumble` / `def.ankleFall` | §6.9 | 0.40 / 1.10 s |
| loose ball on the floor within 0.6 m of a chaser | `loose.scoop` (upper+legs 0.30 s: S[60,0,0], knees 70, hand IK to the ball, `CATCH`) | — | catch rule: gameplay |
| power drive / backdown contact | `CONTACT` from the attacker's clip → defender `def.bumped` | §6.9 | displacement: gameplay |
| DEAD(MADE) | `selectCelebration` | §8.2 | full-body ≤ 1.4 s |
| DEAD(other), QUARTER_END, HALFTIME | idle habits, walk | §8.3 | — |
| GAME_OVER | winners/losers | §8.4 | — |
| paused | animator clock frozen (no `step`), render keeps the last pose | — | resume continues seamlessly |

### 10.2 Look-at defaults (when the active clip does not key `look`)

| role | target |
|---|---|
| ball handler | the on-ball defender within 3 m, else the rim (eyes up the floor) |
| off-ball offence | the ball (blend 30 % toward his defender when within 1.5 m) |
| on-ball defender | the handler's chest (`spine_03` socket of the man), eyes to the ball |
| off-ball defender | the ball (70 %) / his man (30 %) alternating every 1.2–2.0 s (cosmetic) |
| shooter, any shot clip | the rim |
| passer | the receiver (LeBron no-look exceptions §7.3) |
| ball in flight (shot) | everyone looks at the ball, weight 0.8 |
| dead ball | the scorer for 0.8 s, then idle targets (crowd, teammates) |

### 10.3 Selection rules (`select.js`; gameplay RNG in the step because they change timing/positions)

`selectShot(p, ctx)` — `ctx = {kind, d, isThree, dribbling, speed, stick{fwd, lat}, backToBasket (facing vs rim
direction > 100°), defFront (nearest opponent in front within 1.5 m, distance), lastMove (id, age), shotClock,
clutch}`; first match:
1. `kind === 'dunk'` → `selectDunk`; `kind === 'layup'` → `selectLayup` (Kyrie with `d ∈ [2.5, 4.5]` and a rim
   protector (Yao, Giannis or any defender with block ≥ 80) within 2.0 m of the rim → `sig.kyrie.floater` 0.8 /
   `scoop` 0.2 when the approach angle to the baseline < 30°).
2. Yao, `d ≤ 4.0`, back to the basket → `sig.yao.hook` 0.65, `sig.yao.turnFade` 0.25 (right block) / 0.10 (left),
   `sig.yao.upUnder` if `lastMove = pumpHook` within 0.6 s.
3. Back to the basket and `d ≤ 5.5` → Kobe `sig.kobe.turnFade` (side by court x: on the right block the
   left-shoulder version), Jordan `sig.jordan.turnFade`, LeBron `sig.lebron.leftBlockFade` (left block; generic
   `shot.turnFade` on the right), Giannis/Kyrie `shot.turnFade`.
4. `lastMove` ∈ {stepback-capable moves} within 0.30 s or stick back (`fwd < −0.5`) while dribbling → Kyrie
   `doubleBtlStepback` branch (if `lastMove` is it) else `shot.stepbackJ`; LeBron `sig.lebron.stepback3`; Kobe
   `sig.kobe.hesiCrossStepback` branch (if `lastMove` is it) else `shot.stepbackJ`.
5. Dribbling and `speed > 1.5` → Kyrie `sig.kyrie.btbPullup` if `lastMove = move.btb` within 0.25 s; Kobe
   `sig.kobe.sideStepPullup` after `sig.kobe.pump`; Jordan `sig.jordan.pullup`; else `makeJumper(p, pull12 |
   pullHop)` (Kyrie, Giannis or speed > 4 → hop).
6. Holding after `sig.kobe.jabSeries` → `sig.kobe.ripPullup`; after `sig.jordan.jab` → `sig.jordan.jabShot`;
   Yao at the high post after a jab → `sig.yao.jabJumper`.
7. `defFront < 1.2` and the player has a fade → fade with probability Kobe 0.55 (+0.20 when `shotClock < 6` or
   clutch), Jordan 0.45, LeBron 0.25, Yao 0.30, Kyrie 0.20, Giannis 0 → `makeJumper(p, fade)`.
8. Otherwise `makeJumper(p, isThree ? three : mid)`.

`selectDunk(p, ctx)` (takeoff windows §5.6; if the gather distance does not fit any window the fallback is
`dunk.power2` when `d ≤ 2.2`, else the layup family):
| player | rule |
|---|---|
| jordan | `sig.jordan.ftDunk` (conditions §9.2 J2) ; breakaway (no defender within 4 m) → `cradle` 0.4 / `dunk.tomahawk1` 0.4 / `power2` 0.2 ; otherwise tomahawk 0.5 / power2 0.5 |
| kobe | transition (speed > 5) → `sig.kobe.tomahawk` 0.7 / power2 0.3 ; baseline approach (heading within 30° of the baseline, |x| > 1.5) → `sig.kobe.reverse2` 0.4 |
| lebron | transition → `sig.lebron.tomahawk` 0.6 / jump-stop power2 0.4 ; after `sig.lebron.powerDrive` → power2 |
| giannis | sprinting from ≥ 4.5 m → `sig.giannis.longGather` ; defender in the lane → `sig.giannis.euroDunk` ; else power2 0.5 / tomahawk 0.5 |
| yao | from the post → `sig.yao.dropStep` ; else `dunk.simple1` / power2 |
| kyrie | `dunk.simple1` (open breaks only) |

Gameplay note (dunk eligibility): v1 allows dunks only at `d ≤ 2.2` at the press [V1 §4.1]; the gathers above
start at 2.0–4.0 m (generic), 5.0–5.4 m (Giannis long gather) and 6.0–7.5 m (Jordan FT-line). The gameplay section
should classify a dunk at the press using the selected clip's `params.gatherWindow` (exported by `clipTiming`).

`selectPass`, `selectDefJump` (`def.block1`/`def.contest1`/`def.handUp`/`def.vertical`/signature blocks per
§6), `selectCelebration` (§8.2), `selectIdleHabit` (§8.3) follow the tables in those sections.

### 10.4 Gameplay hooks changed or added by this section (D-ANIM-7; the gameplay section owns final values)

| item | v1 | v2 (animation requirement) |
|---|---|---|
| jump start | at the press, `h·sin(πt/0.55)`, 0.55 s | at the clip's `TAKEOFF`; ballistic `jumpY = vy·τ − ½gτ²`, airtime `2·sqrt(2h/g)`; dunks: rise–hang–drop (§5.6) |
| shot launch position | `feet + (fwd·0.25, 2.05 + jumpY)` | the hand socket at `RELEASE` (= input + 0.05 s) |
| meter duration | 0.55 s (0.40 layup) | per player/shot from the clip (`tIdeal/0.80`, `meterFrom`), §5.2 / §9; or a global value with back-solved takeoff |
| 2 or 3 points | classification at the press | root (feet) at `TAKEOFF` ([REV#13]) |
| pass launch | at the tap | at `RELEASE` 0.08–0.25 s later (§7.1) |
| steal resolution | at the tap | at `SWIPE` 0.10–0.14 s later, using the swiping hand socket |
| block test | 0.40 m sphere around `feet + fwd·0.35 + (0, 2.55 + jumpY)` | palm socket within 0.26 m of the ball, palm above `ball.y − 0.05` ([REV#27/#38]) |
| CPU shot after a catch | next 0.1 s tick | not before `READY` (0.30 s after `CATCH`) ([REV#24/#39]) |
| defender during an opponent's windup | steers back to `defGap` | contest clips use entry `stop` (no backward drift); AI should not steer away while the man is in windup ([REV#28]) |
| dunk ball | teleports into the rim at 0.42 s | released at `SLAM` from the hand above the rim ([REV#32]) |
| separation | 0.80 m always | ≥ 0.95 m from a hanging dunker or an airborne rebounder (suggested, [REV#42]) |
| facing / yaw | toward velocity at 12 rad/s | facing rules §3.5; per-player turn rates suggested (§3.6) |
| crossover | 0.35 s burst at 7.5 m/s | per-move root motion and exit velocity (§4.2), immunity windows in `params` |
| freeze after a crossover | 0.40 s | 0.40 s stumble, or 1.10 s ankle-break fall with the suggested probabilities (§6.9) |
| player reset | snaps the pose to idle | pose crossfade, gait re-plant (§3.7) |

### 10.5 Root motion vs game-driven positions (summary)

- Locomotion: positions are 100 % gameplay; the gait adapts the feet (never the other way round).
- Action clips with `root: 'motion'`: the clip proposes velocity and yaw (§2.4.3); gameplay integrates them with
  collisions, separation and court clamps, so the sim stays authoritative and deterministic.
- Target-matched approaches (§2.4.4) bend the authored path to land the takeoff where gameplay needs it.
- Air: no control except authored drift; vertical is gameplay's `jumpY`.
- Foot locks absorb small mismatches (pushes up to 0.10 m); larger ones trigger catch-up steps.

### 10.6 Ball protocol (one possession)

1. `ball.js` catch rule fires → `ball.attachTo(p, 'held')` → `p.animator.onCatch()` → mode `both`; sim position =
   `querySocket('ballBoth')` every step; `CATCH`, then `READY` at +0.30 s.
2. Move input → `move.*` or gait + `dribble.start(hand)`: mode `drib`/`path`; sim position from `dribble.js`.
3. Shot press → pickup (≤ 0.12 s) → `both` → at the release input `R` → `RELEASE` at +0.05 s with the socket
   position → `game.shoot()` → `ball.launch(v, 'flight', shotInfo)` (arc solver from that position).
4. Pass → `RELEASE` → `ball.launch(v, 'pass', passInfo)`. Dunk → `SLAM` → `ball.launch((0, −4.5, 0)…, 'scored')`.
5. The rendered ball while attached = the rendered socket (§2.5).

### 10.7 Landing and contact synchronisation
- `LAND` fires when gameplay's `jumpY` returns to 0 (the clip's land key is warped there); landing knee absorb
  follows the vertical speed: knee add = `clamp(8°·|vy_land|, 20°, 60°)`.
- `CONTACT` for blocks/tips is detected by gameplay (socket test) and sent to the animator, which IK-snaps the hand
  for 2 frames and plays the swat/pin additive; `CONTACT` from attacker clips (bumps) is sent by the animator to
  gameplay at the authored time.
- `RIM_GRAB`/`RIM_RELEASE` drive the hand-to-rim IK; audio plays `rim(2)` at `RIM_GRAB` (audio section).
- Footsteps: `PLANT_L/R` events (clips) and gait strikes feed the audio squeak (suggested: hard stops and cuts
  with Δ > 60° at speed > 4 m/s).

### 10.8 Responsiveness budget (D-ANIM-8)

| stage | time |
|---|---|
| DOM event → latch | same handler |
| latch → consumed by the fixed step | ≤ 16.7 ms |
| `play()` → first rendered frame with the new clip | ≤ 16.7 ms (next rAF) |
| visible motion in that frame | guaranteed: ease-out entry (§2.3.2) + every action clip moves the hand ≥ 2 cm or a major joint ≥ 3° within its first 33 ms (unit-tested) |
| compositor/display | 16–33 ms (browser) |
| **total to visible motion** | **≤ 33 ms + display ≈ 50–66 ms (< 80 ms)** |

Designed gameplay delays after the visible start (not latency): shot launch +0.05 s after the release input,
takeoff 0.10–0.36 s after a shot press (the dip is visible at once), pass launch 0.08–0.25 s, steal resolution
0.10–0.14 s, defensive takeoff 0.08–0.15 s.

### 10.9 Review findings addressed here
[REV#13] points at takeoff (§5.1-7); [REV#24/#39] `READY` gate (§7.4); [REV#27/#38] socket-based block contact and
jump load times (§6.5, §10.4); [REV#28] `stop` entry on contests/closeouts (§6.2–6.3); [REV#32] dunk slam from
the hand with rim IK (§5.6); [REV#36] reset crossfade (§2.3.2, §3.7); [REV#42] hanging-dunker separation value
(§5.6, suggestion to gameplay). Findings outside animation (camera, HUD, rules, audio, AI utility) are not
covered here.

---

## 11. Debug viewer and tests

### 11.1 Viewer (`index.html?anim=<clipId>&player=<id>`; `src/anim/viewer.js`)

`main.js` checks `URLSearchParams` for `anim`; if present it boots the viewer instead of the game (same page, same
assets, so it also works inside the artifact iframe; no extra HTML file). Parameters:

| param | values (default) | meaning |
|---|---|---|
| `anim` | clip id, `list`, or `loco` | `list` shows every clip id as links grouped by namespace |
| `player` | kobe, jordan, lebron, giannis, yao, kyrie (kobe) | |
| `mirror` | 0/1 (0) | play the `_L` twin |
| `speed` | 0.05–4 (1) | playback rate |
| `t` | seconds | freeze at this clip time |
| `loop` | 0/1 (1) | |
| `cam` | `tq` (three-quarter), `side`, `front`, `top`, `orbit` (`tq`) | |
| `lod` | 0–3 (1) | body LOD |
| `kit` | classic/allstar (classic) | |
| `bones` | 0/1 (0) | `THREE.SkeletonHelper` |
| `ball` | 0/1 (1) | |
| `grid` | 0/1 (1) | 0.5 m floor grid; the hoop drawn at its real place when the clip has a target |
| `ghost` | n (0) | onion-skin poses at the first n events |
| `loco`, `dir`, `def` | speed m/s, heading deg, 0/1 | procedural gait preview: the root circles a 12 m loop |
| `dribble` | still/protect/walk/jog/run/speed/backdown | dribble preview |
| `h` | m | jump height override (air warp) |
| `warp` | e.g. `release:0.60,land:1.1` | test warps |
| `ui` | 0/1 (1) | hide panels for screenshots |

Panels: scrubber with event ticks, play/pause/step, player/clip pickers, mirror/IK/look toggles; readout: clip
time, current events, ball mode, ball/palm/foot socket heights, root position, foot-lock states and slide, `jumpY`,
anim CPU ms. Viewer labels are i18n keys `anim.*` (zh/en) like every other string.

`window.__anim` (Playwright API):
```
{ ready: Promise, clips: string[], players: string[],
  load(clipId, playerId, opts) → Promise, seek(t), play(), pause(), step(dt),
  sample(boneName) → [x,y,z] (world), socket(name) → [x,y,z], ballPos() → [x,y,z],
  events() → [{t, name}], footLocks() → [{side, locked, slide}], stats() → {cpuMs, bonesUpdated} }
```

### 11.2 Unit tests (`test/unit-anim.mjs`, Node, imports `src/anim/*.js` and `vendor/three.module.js`)
1. Rig frames orthonormal; the sign checks of §1.4; mirror symmetry: for every clip key, `mirror(sample(clip))`
   equals `sample(mirror(clip))` (world positions reflected in x) within 1e−4.
2. Every clip compiles; first/last keys complete; events sorted within `[0, dur]`; no NaN; joint limits respected;
   shots/passes have `RELEASE`; jumping clips have `TAKEOFF < LAND`; locked feet never translate (yaw-only pivots).
3. IK: 10,000 random reachable targets end within 1 mm; unreachable targets straighten; knee pole forward.
4. Gait: speeds 0–9 m/s × six players × 10 s: locked-foot slide < 5 mm; cadence within 3 % of §3.4; slides never
   cross the feet; at most 2 settle steps after a stop.
5. Meter: for every player and jumper variant, a perfect input launches at `apex + rva` ± 1 step and the launch
   ball height is within ±0.08 m of §5.2.
6. Dunks: every dunk clip × player (that can use it): ball centre at `SLAM` ≥ 3.20 m and within 0.15 m (xz) of the
   slam point; `rimHook` within 0.03 m of the rim during the hang.
7. First-33-ms motion: every action clip moves some hand ≥ 2 cm or a major joint ≥ 3° in its first 2 steps.
8. Zero allocation (§2.9) and a timing probe: six animators × 600 evaluates (reported, budget asserted only on
   desktop CI: < 0.5 ms per frame for six).

### 11.3 Acceptance additions (Playwright, `acceptance.cjs`)
- **A-ANIM-1** `?anim=list` and every clip × six players render 10 frames with no console/page errors.
- **A-ANIM-2** `?anim=loco&loco=5.2&player=yao` and `kyrie`: max foot slide < 0.01 m.
- **A-ANIM-3** in-game perfect jumper for each player (debug hook releases at `tIdeal`): `e` within ±0.02 and the
  launch height within tolerance.
- **A-ANIM-4** debug dunk: ball y ≥ 3.15 m at `SLAM`, ball step displacement ≤ 0.30 m (no teleport).
- **A-ANIM-5** latency: Space keydown → first rendered frame where the shooter's right palm moved ≥ 2 cm: ≤ 2 sim
  steps (measured through `window.__game`).
- **A-ANIM-6** CHECK → LIVE: no bone rotates more than 25° between consecutive frames ([REV#36]).
- **A-ANIM-7** blocks only occur with palm–ball distance < 0.26 m (instrumented).
- **A-ANIM-8** no full-body celebration is active when the CHECK tween starts.
- **A-ANIM-9** pass launch position equals the hand socket within 0.02 m.
- Screenshot set for the phase-D human review: `test/shots/anim/<clip>_<player>_<event>.png` at each event.

---

## 12. Performance

### 12.1 Work per player per rendered frame
Sample ≤ 3 clips (≈ 30 tracked bones each, one nlerp per bone) + gait (≈ 300 scalar ops) + dribble (≈ 60) +
53 PRE·Q·POST products (skipped where PRE = POST = I: 27 bones) + 53 `matrix.compose` + one `updateMatrixWorld`
(53 world matrices) + IK (≤ 4 two-bone chains, ≈ 120 ops each, plus sub-tree updates of ≤ 18 bones) + look-at
(2 bones + 1 uniform) + ≤ 9 morph influences + sockets. `skeleton.update()` (53 matrix products + bone texture
upload) is done by three.js once per frame per skeleton. Bones whose local pose did not change (frozen fingers)
skip `compose`; all 53 world matrices are always updated (fingers must follow the hand).

Reference: the PoC posed six skeletons with `updateMatrixWorld` + `skeleton.update` in 0.5–0.85 ms per frame on a
desktop CPU under SwiftShader [PERF]; the layered system adds ≈ 2× the posing math.

### 12.2 Budgets and tiers (quality tiers are auto-detected by the rendering section; animation follows them)

| tier | anim CPU budget, six players | full-rate players | reduced players | fingers | foot IK | hand IK | look / eyes | breathing | expressions |
|---|---|---|---|---|---|---|---|---|---|
| high | ≤ 0.9 ms (iPhone 11 class) | all | — | all | all | all | head + eyes | all | all |
| medium | ≤ 1.2 ms | ball owner, his defender, anyone in an action clip, camera-near players | others at 30 Hz (alternating frames; the skipped frame keeps last matrices but the root still moves) | owner + players taller than 160 px on screen | all | all | head all, eyes close-ups only | owner + defenders | celebrations + close-ups |
| low | ≤ 2.0 ms (2021 low-end Android) | ball owner + action players | others at 30 Hz | presets on the owner only | during actions only; reduced gait solves legs analytically every other frame | owner | head only | off | celebrations only |

Dynamic guard: rolling 2 s average of the measured anim time; above 1.3 × the tier budget for 2 s → demote one more
off-ball player to 30 Hz (sticky 10 s). Off-screen players (bounding sphere centred on the pelvis, r = 0.6 ×
height, outside the frustum): 15 Hz, no IK, no look; their gameplay sockets still come from step queries, so play
is unaffected.

### 12.3 Memory
Compiled clips ≈ 2.3 MB (shared Float32Arrays), rig frames 6 × 2 × 53 × 16 B, per animator ≈ 12 KB (poses, gait,
dribble, event ring) → < 2.5 MB total. No per-frame garbage (§2.9).

---

## 13. Dependencies on other sections and open items

- **Gameplay/rules/AI**: adopt §10.4 (jump at takeoff, ballistic airtime, launch at `RELEASE`, steal at `SWIPE`,
  socket block test, points at takeoff, `READY` gate, dunk gather windows, per-player `METER_T` or a global value,
  facing rules and turn rates, move immunity windows, ankle-break probability, hanging-dunker separation). AI shot
  timing uses `clipTiming()` (takeoff/release offsets) to time contests and blocks.
- **Assets / face**: bake the 9 expression morphs of §2.8 (shared head-region deltas, `keepMouth` for the tongue),
  propagate morph deltas to the beard/eyebrow shells through their `(a, b, t)` mapping, and keep `legends.json`
  bone order = §1.1.
- **Rendering**: eye material uniform `eyeOffset` (§2.6.3), ball spin flag (Kyrie finger spin, backspin on
  shots), `chalkBurst` particles (§8.4), per-player bounding spheres for culling, quality-tier signal.
- **Camera / replay**: optional `SLOWMO_IN/OUT` events (Jordan FT-line dunk) and celebration framing.
- **Audio**: `BOUNCE` (dribble), `PLANT_*` squeaks on cuts/stops, `RIM_GRAB` rim rattle, `SLAM` dunk, `LAND`
  thud for big men, `FX` crowd "ooh" on ankle-break falls.
- **HUD**: meter reads `meterFrom`, `METER_T` and the green band from the animator at the press.
- **i18n**: viewer labels as `anim.*` keys.
- Open items for phase D (likeness/feel iteration, not blockers): tune finger and thumb preset angles and the
  guide-hand IK closure in the viewer against reference stills; verify the shooting-arm candy-wrapper margin at
  `pron 85–90` with the jersey sleeve shell; check cloth slits for the airborne tucks above 95° hip flexion
  (Jordan FT-line scissor, Giannis rim hang) and lower them by up to 10° if slits show.
