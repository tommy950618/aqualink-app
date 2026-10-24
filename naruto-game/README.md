# 忍界传说 · 火影忍者同人手游

A fan-made, non-commercial Naruto + Naruto Shippuden gacha RPG that runs in the browser. It has no Boruto content.
同人作品，仅供学习交流，与官方无关.

- **187 characters**: every major figure from Naruto and Shippuden, plus the Nine Tails beasts, the Ten Tails and six summoning beasts. Key characters come in several forms, for example 鸣人 少年篇 / 仙人模式 / 九喇嘛模式 / 六道仙人模式.
- **Character art is drawn in code**: portraits, skill icons, village emblems and scene backgrounds are generated as SVG in `js/art.js`. There are no image assets.
- **"开局送1000连抽"**: a new save starts with 1000 summon tickets, and 重新开局 (in Settings or on the 召唤 screen) wipes the save so you can pull again.
- **Screens**:
  - 主城 (home), with an idle-reward chest
  - 召唤 (single, 10 and 100 pulls, with card reveals)
  - 培养 (level up, star up and skill upgrades; laid out like the classic 手游 training screen)
  - 图鉴 (codex)
  - 编队 (team)
  - 冒险 (130 stages across 14 story arcs, from 波之国 to 辉夜 and 终末之谷)
  - Animated auto-battle with ultimate-attack cut-ins
  - 设置 (settings)

## Run

The game is static, with no build step:

```
npx http-server . -p 8080      # then open http://localhost:8080
```

It also runs from `file://`. Landscape is best. On a phone held upright the stage rotates automatically; you can turn this off in 设置.

## Layout

| path | what |
|---|---|
| `js/core.js` | `NG` namespace: factions, rarities, roles, elements, tags, FX, vocabularies, character registry |
| `js/data/*.js` | character data: stats, five skills each (被动 / 技能1 / 技能2 / 必杀技 / 突破), and an art spec |
| `js/art.js` | procedural SVG art (`NG.art`) |
| `js/engine.js` | save/state, progression, gacha, campaign, deterministic battle simulator (`NG.game`, `NG.battle`) |
| `index.html`, `css/style.css`, `js/ui*.js` | UI |
| `CONTRACT.md` | data schema and module APIs |
| `tools/roster.js` | master roster |

## Checks

```
node tools/validate.js      # data schema + roster
node tools/test-engine.js   # engine tests, balance fuzzing
node tools/_art_test.js     # every character renders
node tools/build-artifact.js  # builds dist/index.html for publishing as a claude.ai Artifact
```
