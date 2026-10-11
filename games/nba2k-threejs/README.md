# 传奇对决 3v3 · LEGENDS 3v3

非商业粉丝作品；球员姓名与肖像归其本人所有。
Non-commercial fan project; names and likenesses belong to the players.

A broadcast-style 3v3 half-court basketball game with six legends — Kobe Bryant 科比·布莱恩特, Michael Jordan
迈克尔·乔丹, LeBron James 勒布朗·詹姆斯, Giannis Antetokounmpo 扬尼斯·阿德托昆博, Yao Ming 姚明 and Kyrie Irving
凯里·欧文 — written in plain JavaScript on three.js r186 (vendored, core only). It is a static page: no build step, no
install, no external requests. The players are baked, skinned MakeHuman (CC0) bodies with painted skin, grooming,
kits and sneakers, animated by a layered skeletal animator with foot IK, procedural dribbling and a clip library that
includes every legend's signature moves.

一款电视转播视角的 3 对 3 半场篮球游戏，六位传奇球员：科比、乔丹、詹姆斯、字母哥、姚明、欧文。纯 JavaScript +
three.js r186（随仓库提供，只用核心库）。纯静态页面：无需构建、无需安装、不访问任何外部地址。球员是预烘焙的
MakeHuman（CC0）蒙皮模型，带绘制皮肤、发型胡须、球衣球鞋，由分层骨骼动画系统驱动（脚部 IK、程序化运球、包含每位
传奇招牌动作的动画库）。

## Play on a phone · 在手机上游玩

1. **Hosted page**: open it in Safari or Chrome, wait for the loading bar (about 2.5 MB of player data), then tap
   **开始游戏 / Play** (choose lineups) or **快速比赛 / Quick Game**. The first tap also unlocks audio. Landscape plays
   best; portrait works too.
2. **From this folder over Wi-Fi**: on a computer run

   ```sh
   cd games/nba2k-threejs
   python3 -m http.server 8080        # or: npm start, or any static file server
   ```

   then open `http://<computer-ip>:8080/` on the phone (same Wi-Fi). `.bin` files must be served as
   `application/octet-stream` (every common static server does this).

- **托管页面**：用 Safari 或 Chrome 打开，等待加载条（约 2.5 MB 球员数据），点击 **开始游戏**（选择阵容）或
  **快速比赛**。第一次点击同时解锁声音。横屏体验最佳，竖屏也可以。
- **局域网自建**：在电脑上进入本目录运行 `python3 -m http.server 8080`，手机连接同一 Wi-Fi 后打开
  `http://<电脑IP>:8080/`。

Flow · 流程: loading → title → lineup (tap two cards to swap players; 我方 A/B picks your team; 球衣 自动/经典/全明星
picks the kits; ★ marks your ball handler) → player introductions (tap to skip one, 跳过 to skip all) → four quarters
with a halftime → box score and MVP → 再来一局 / 更换阵容 / 主菜单. Dunks and game-winners get an instant replay
(any tap skips it).

## Controls · 操作

| Touch · 触控 | Keyboard · 键盘 | Offence · 进攻 | Defence · 防守 |
|---|---|---|---|
| left half: floating joystick · 左半屏虚拟摇杆 | W A S D / arrows | move · 移动 | move · 移动 |
| `»` (hold) · 长按 | Shift (hold) | sprint · 冲刺 | sprint · 冲刺 |
| `●` hold, release in the green band · 长按，绿区松手 | Space / J | shoot · 投篮 | block / contest jump · 盖帽 |
| `●` quick tap (< 0.12 s) · 轻点 | Space tap | pump fake · 投篮假动作 | — |
| `➜` tap (hold ≥ 0.3 s = lob) · 点按（长按吊传） | K | pass · 传球 | switch defender · 换人 |
| `⇄` tap · 点按 | L | crossover / dribble move · 变向 | steal · 抢断 |
| `⇄` double tap · 连点两下 | L L | combo (two moves) · 连招 | — |
| `❚❚` top right · 右上角 | P / Esc | pause · 暂停 | pause · 暂停 |
| — | M / T | mute / language · 静音 / 语言 | |

Shooting: the press starts the gather and the meter; release when the fill reaches the green band (each legend has his
own timing). The 3 / 2 chip above the meter shows the value by your feet at the release. Layups and floaters use the
same meter; dunks happen when you SHOOT in the dunk window after a sprint with a clear lane.

投篮：按下开始起跳和蓄力条，在绿色区域松手（每位球员节奏不同）。蓄力条上方的 3 / 2 标记显示出手时脚下的分值。
上篮、抛投使用同一蓄力条；冲刺后在扣篮距离内且路线无人时按投篮即扣篮。

Stick + button combinations · 摇杆组合:

- stick away from the rim + SHOOT: fadeaway (holding) or step-back (dribbling) · 摇杆背离篮筐 + 投篮：后仰 / 后撤步
- walk into your defender near the paint (≈ 0.35 s): post-up; SHOOT in the post = turnaround / hook, stick to the rim =
  drop step, CROSS = spin · 慢慢顶向防守人：背身单打；背身中投篮 = 转身后仰 / 勾手，摇杆指向篮筐 = 沉步，变向 = 转身
- drive toward the rim with SPRINT and SHOOT: layup, dunk, euro step or floater depending on distance, speed and
  defenders · 冲刺突破中投篮：根据距离、速度和防守人自动选择上篮、扣篮、欧洲步或抛投
- PASS sends the ball to the teammate in the stick direction, otherwise to the best option (the chevron shows him)
  · 传球优先给摇杆方向的队友，否则给最佳选择（头顶箭头指示）

Signature moves · 招牌技能 (triggered with the same buttons):

| legend | moves |
|---|---|
| Kobe 科比 | post fadeaway (post + SHOOT), jab-step pull-up (holding + CROSS, then SHOOT within 0.8 s), jab rip-through (after two jabs: SPRINT + stick to the rim), baseline spin layup, tough-shot and clutch bonuses |
| Jordan 乔丹 | signature fadeaway, mid-air switch on contested layups, free-throw-line dunk (full sprint, SHOOT at 6.0–7.6 m with a clear lane, twice per game), ball hawk |
| LeBron 詹姆斯 | power drive (bumps defenders off), chase-down block (SHOOT/BLOCK while trailing a layup or dunk), cross-court skip pass (≥ 8 m), bully post-ups |
| Giannis 字母哥 | euro step (drive and SHOOT at 5.4–7.6 m), long-stride dunk from 6.4–7.8 m, help-side blocks |
| Yao 姚明 | jump hook (post + SHOOT), high release, rim anchor on defence, drop step (CROSS in the post), pump-hook and up-and-under |
| Kyrie 欧文 | handle combos (double-tap CROSS), step-back three (dribbling + stick away + SHOOT), acrobatic finishes (auto reverse / floater) |

Defence · 防守: stay between your man and the rim; your hands go up automatically next to a shooter; time BLOCK to
his release; STEAL pokes at the ball or jumps a passing lane (a failed poke stuns you briefly); auto-switch moves you
to the defender of the player who caught the ball (settings: 防守自动换人).

## Rules · 规则

- 3v3, one hoop; 4 quarters (1 / 2 / 3 / 5 min, default 2), 14 s shot clock, 2 inside / 3 beyond the arc (decided by
  your feet when you release), 1:00 overtimes until there is a winner, 3 s halftime.
- After every dead ball (make, defensive rebound, steal, out of bounds, shot-clock violation) play restarts with a
  check from the top of the key. The shot clock resets only when a shot touched the rim, the board or a blocker.
  A shot released before the buzzer counts, also when it rattles in just after it. No fouls, free throws,
  travelling, 3-second or goaltending calls. Optional FIBA-style clear-the-ball rule (settings: 清球规则).
- Shot outcomes are probabilities at the release (distance, timing, contest by the nearest defender's distance,
  height and stance, fatigue, movement, the shooter's ratings and abilities); the flight then becomes a make or a real
  rim / board miss.
- 3 对 3 单篮筐；4 节（1/2/3/5 分钟，默认 2 分钟），14 秒进攻时限，出手时脚在三分线外得 3 分，平局 1 分钟加时直到分出
  胜负。所有死球后从弧顶发球重新开始。只有碰筐、碰板或被盖帽后进攻时间才重置。没有犯规、罚球、走步、三秒和干扰球。

## Settings and quality · 设置与画质

Title → 设置 (some rows also in the pause menu): quality 画质 (自动 / 低 / 中 / 高), language, sound, crowd volume,
camera 镜头 (标准 / 近景 / 高位), difficulty, quarter length, replays (关 / 扣篮与绝杀 / 全部精彩), intro (完整 / 简短 /
关闭), kits, clear-the-ball, auto-switch.

| tier | for | what changes |
|---|---|---|
| 低 low | older / low-end phones (and headless SwiftShader) | LOD 3 bodies, 512² skin, no expression morphs, blob shadows, no environment map, 700 crowd |
| 中 medium | iPhone 11 class phones, integrated GPUs | LOD 1–2, 1024² skin, expressions, shadow maps (1024), environment lighting, 1,600 crowd |
| 高 high | recent phones, desktops | LOD 0–1, 2048² skin on desktop, physical skin / sheen, 2048 shadow maps, planar floor reflection, 2,600 crowd, camera flashes |

Auto mode picks a start tier from the GPU and steps the pixel ratio / tier up or down from measured frame times
(never during menus, intros or replays); a 30 Hz display or Low Power Mode is detected and not treated as a slow GPU.
Texture sizes are decided once at load: a manual tier change applies its texture sizes at the next launch.

画质自动模式会按显卡选择起始档位，并根据实测帧时间调整分辨率和档位（菜单、开场、回放期间不判定）；贴图尺寸只在
加载时决定，手动切换档位后贴图尺寸在下次启动生效。

URL flags (session only, never stored): `?quality=low|medium|high`, `?lang=zh|en`, `?seed=<int>`, `?q=<minutes>`
(fractions allowed), `?diff=easy|normal|hard`, `?intro=0|short|full`, `?replay=0|dunks|all`, `?quick=1` (quick game
without intro), `?lineup=lebron,kyrie,giannis~jordan,kobe,yao&user=a|b&kits=auto|classic|allstar`, `?clear=0|1`,
`?autoswitch=0|1`, `?auto=1` (CPU plays both teams), `?bot=avg|good|drive|pullup|idle` (test bot), `?aa=0`,
`?debug=1`, `?showcase=1&view=lineup|heads|expr|kits|turn|lod` (likeness page), `?anim=list|loco|<clip id>&player=<id>`
(animation viewer).

If the player data cannot be loaded, an error panel offers 重试 / Retry and 简化模式 / Simple mode (primitive players).
three.js r186 needs WebGL2; without it the page shows a "WebGL not supported" notice.

## Tests · 测试

From `games/nba2k-threejs/` (Node 20+; Playwright from `NODE_PATH` or `/opt/node22/lib/node_modules/playwright`,
headless Chromium with SwiftShader — frame rates are never asserted headless):

```sh
npm run test:unit          # every test/unit-*.mjs (Node)
npm run test:balance       # headless balance bands A–C and scenarios S1–S11 (--quick: npm run test:balance:quick)
npm run test:static        # static acceptance items (imports, denylist, line budget, bytes, README notes)
npm run test:accept        # acceptance checklist B1–B61 (long on SwiftShader); node test/acceptance.cjs B5 B30-B33 for a subset
```

`window.__game` exposes the test hooks of spec §5.15 (`state`, `world`, `player(id)`, `place`, `debugShoot`,
`fastForward`, `setClock`, `turnover`, `forceAbility`, `metrics()`, `quality`, `perf`, `replay`, `director`, `ui`,
`events`, …). See `test/README.md`.

## Rebuilding the player assets · 重新烘焙球员资源

The committed files in `assets/legends/` are generated by `tools/legends/` from CC0 MakeHuman / MPFB2 data (the
runtime never needs `tools/`). The bake is deterministic:

```sh
cd tools/legends && npm install                          # optional: meshoptimizer 0.22.0 (LOD indices)
node fetch.mjs legends.config.json                       # CC0 MakeHuman base/targets + MPFB rig/weights, pinned, cached in .cache/
node calibrate.mjs legends.config.json --write           # only after head/face/length modifier edits
node bake.mjs legends.config.json                        # → ../../assets/legends/ (header v2, 7 bins, 15 PNGs)
node measure.mjs ../../assets/legends/legends.json --likeness
cd ../.. && node test/unit-legends-bake.mjs && node test/unit-legends-format.mjs
node test/likeness/shoot.cjs                             # likeness screenshots → test/likeness/out/ (gitignored)
```

## Credits and licences · 致谢与许可

- Player bodies, targets, rig and skin weights: MakeHuman hm08 base mesh and MPFB2 data, **CC0 1.0** (public domain);
  everything else (calibration, grooming, masks, eyes, expressions, kits, sneakers) is generated by this repository's
  own tools. See `assets/legends/README.md`.
- three.js r186, **MIT** licence (`vendor/LICENSE.three.txt`).
- All audio is synthesized at runtime; no samples, fonts or images from other sources.
- No league, team, sponsor or brand names, logos or marks are used; kits are original designs.

非商业粉丝作品；球员姓名与肖像归其本人所有。本项目不使用任何联盟、球队、赞助商或品牌的名称与标志，球衣为原创设计。
