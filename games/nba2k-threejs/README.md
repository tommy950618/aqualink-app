# HOOP ARENA 3x3 · 街头篮球场 3x3

A broadcast-style 3v3 half-court basketball game written in plain JavaScript on three.js (r186). It is a
static page: no build step, no install, no external assets. Open it in a phone browser and play with
the on-screen joystick and buttons, or on a desktop with the keyboard.

一款用 three.js（r186）编写的电视转播视角 3 对 3 半场篮球游戏。纯静态页面：无需构建、无需安装、
不依赖任何外部资源。手机浏览器直接打开即可用虚拟摇杆和按键游玩，电脑上可用键盘。

## Play on a phone · 在手机上游玩

1. **Hosted URL**: open the page in Safari or Chrome, tap **开始比赛 / Start Game** (this also unlocks
   audio), and rotate to landscape for the best layout. Portrait works too.
2. **From this folder over Wi-Fi**: on the computer, run one of

   ```sh
   cd games/nba2k-threejs
   python3 -m http.server 8080        # or:  npx serve -l 8080 .
   ```

   then on the phone (same Wi-Fi) open `http://<computer-ip>:8080/` (find the IP with `ipconfig` /
   `ifconfig` / `ip addr`). Any static file server works; the page needs no server-side logic.

- **托管地址**：用 Safari 或 Chrome 打开页面，点击 **开始比赛**（同时解锁音频），横屏体验更佳，竖屏也可以。
- **局域网自建**：在电脑上进入本目录运行 `python3 -m http.server 8080`（或 `npx serve -l 8080 .`），
  手机连同一 Wi-Fi，浏览器打开 `http://<电脑IP>:8080/`。

## Controls · 操作

| Touch · 触控 | Keyboard · 键盘 | Offence · 进攻 | Defence · 防守 |
|---|---|---|---|
| Left half: floating joystick · 左半屏虚拟摇杆 | W A S D / arrows · 方向键 | Move · 移动 | Move · 移动 |
| `»` pad (hold) · 长按 | Shift (hold) | Sprint · 冲刺 | Sprint · 冲刺 |
| `●` (hold, release on the green band) · 长按，绿区松手 | Space / J | Shoot · 投篮 | Block / rebound jump · 盖帽 |
| `➜` (tap; hold ≥ 0.3 s for a lob) · 点按，长按吊传 | K | Pass · 传球 | Switch defender · 换人 |
| `⇄` (tap) · 点按 | L | Crossover · 变向 | Steal · 抢断 |
| `❚❚` (top right) · 右上角 | P / Esc | Pause · 暂停 | Pause · 暂停 |
| — | M | Mute · 静音 | Mute · 静音 |
| — | T | Language · 语言 | Language · 语言 |

Shooting: press starts the jump and the meter; release when the fill reaches the green band
(perfect at 80 %). Dunks trigger automatically near the rim after a sprint with a clear lane.
Passing goes to the teammate in the joystick direction, otherwise to the most open one.

投篮：按下起跳并开始蓄力条，蓄力到绿色区域松开（80% 处完美）。冲刺后在篮下且路线无人时自动灌篮。
传球优先传给摇杆方向的队友，否则传给最空位的队友。

## Rules and simplifications · 规则与简化

- 3v3, one hoop, both teams attack the same basket; 4 quarters (1/2/3/5 min), 14 s shot clock,
  2 inside / 3 beyond the arc, overtime periods of 1:00 until a winner.
- Possession: coin flip for Q1, alternating by period; after every dead ball (make, defensive
  rebound, steal, out of bounds, shot-clock violation, resting ball) the game resets to a check-ball
  formation after 1.2 s. No inbound passes, jump balls, fouls, free throws, travelling, 3-second or
  goaltending calls. Shot outcome is a probability roll at release (distance, timing, contest,
  fatigue, movement, rating); the flight is then steered to a make or a physical rim/board miss.
- 3 对 3、单篮筐、双方进攻同一个篮；4 节（1/2/3/5 分钟），14 秒进攻时限，内线 2 分、三分线外 3 分，
  平局加时 1 分钟直到分出胜负。第一节球权掷硬币决定，之后逐节交替；所有死球后 1.2 秒回到发球站位。
  没有界外发球、跳球、犯规、罚球、走步、三秒和干扰球。投篮结果在出手瞬间按概率判定（距离、时机、
  干扰、体力、移动、能力值），随后球的飞行会被引导为命中或真实的碰筐/碰板不中。

Teams and players are fictional (海城潮汐 Harbor Tide, 赤岩火狐 Redrock Foxes).

## URL flags · 地址参数

| flag | effect |
|---|---|
| `?seed=<int>` | seed for all gameplay randomness (default `Date.now()`) |
| `?q=<minutes>` | quarter length, fractions allowed (`?q=0.1` = 6 s) |
| `?auto=1` | the user's player is driven by the AI too (soak tests) |
| `?lang=zh` / `?lang=en` | start language (the choice is remembered in `localStorage`) |
| `?debug=1` | logs the seed and quarter length to the console |

## Debug hooks · 调试接口

`window.__game` exposes `{ game, state, world, controlled, ball, perf, audio, renderer, camera, rng,
input, hud, debug }` plus the shortcuts `teleport(playerIndex, x, z)`, `debugShoot({p, e})` (force the
make probability / timing error of the controlled player's next shot), `setClock({game, shot})`,
`turnover()`, `fastForward(seconds)` (runs fixed steps synchronously, then renders one frame) and
`debug.invariantsBroken` (finite coordinates, ball above the floor, shot clock within 0–14; checked
every step). `perf` holds `{fps, avgFrameMs, stepMs, drawCalls, triangles, dpr}` updated once per
second. `game.on(event, cb)` subscribes to `score`, `release`, `make`, `miss`, `pass`, `catch`,
`steal`, `block`, `rebound`, `oob`, `rest`, `turnover`, `possession`, `dead`, `state`, `airball`.

## Tests · 测试

```sh
cd games/nba2k-threejs
node test/unit-core.mjs && node test/unit-physics.mjs && node test/unit-audio.mjs
node test/unit-court.mjs && node test/unit-humanoid.mjs && node test/unit-ball.mjs
node test/acceptance.cjs            # Playwright acceptance checklist A1–A27 (headless Chromium)
node test/acceptance.cjs A5 A11     # a subset
node test/layout-check.cjs          # HUD/controls layout across viewports
```

The Playwright suite needs `playwright` resolvable from `NODE_PATH` (or the global install the
harness falls back to). Everything else is plain Node 20+.

## Licence notice · 许可

three.js r186 is vendored unmodified at `vendor/three.module.js` under the MIT licence; the licence
text is beside it in `vendor/LICENSE.three.txt`. The game code in `src/` is MIT as well (see
`package.json`). No third-party assets are used: textures, models and sounds are generated at runtime.
