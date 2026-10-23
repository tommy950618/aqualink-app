# 忍界传说 — 火影忍者同人手游 · Build Contract

A fan-made, non-commercial, browser-based gacha/RPG "手游" featuring (nearly) every character of
**Naruto (火影忍者) + Naruto Shippuden (疾风传)**. **No Boruto (博人传) content at all** — no Boruto-era
characters (Boruto, Sarada, Mitsuki, Kawaki, Momoshiki, Kinshiki, Toneri, Himawari, Code, Eida…), no
Boruto-era forms (e.g. 七代目火影鸣人, 重粒子模式, Karma 印), no Boruto-only jutsu.

The UI must closely follow the reference screenshot (`/root/.claude/uploads/7b37f5eb-8962-565a-b27d-4cf648e4c413/4de464eb-image.png`,
view it with the Read tool): a landscape game screen. The **培养 (training)** screen in that screenshot is
the template: team avatars with gold ring frames + "Lv.340" down the left edge; big character art in the
center with a name plate (village emblem circle, big Chinese name "佐助", romaji "Uchiha Sasuke", a row of
gold ★ stars, a sub-title plate "须佐能乎", role chips 输出/爆发); on the right a **技能** panel with an ornate
winged title and 5 stacked skill cards (icon, small label 被动/技能1/技能2/必杀技/突破, skill name, colored tag
chips, an "已解锁" badge, an ⓘ info icon); top-right currency pills (coin 42.0亿 ⊕, gem 1000.3万 ⊕).
Dark night-city background, deep navy/indigo translucent panels, light-blue card borders, gold accents,
white bold text with dark outline.

Hook from the ad: **"开局送1000连抽，抽到满意再开局！"** — a new save starts with 1000 summon tickets, and the
player may **reset their save at any time** ("重新开局") until they like their pulls.

Pure static web app: no build step, no frameworks required, no network except optional Google Fonts.
Everything lives in `/home/user/aqualink-app/naruto-game/`. All user-facing text is Simplified Chinese.

---------------------------------------------------------------------------------------------------

## 1. Files & ownership

| path | owner | notes |
|---|---|---|
| `js/core.js` | **orchestrator (done)** | `window.NG` namespace, all constants & vocabularies, `NG.defineChars`, `NG.fmt`, event bus. Read it fully. Do not edit (ask via your final report if you need a change). |
| `tools/roster.js` | orchestrator (done) | master roster: id, name, form, faction, rarity, owning file. |
| `tools/validate.js` | orchestrator (done) | `node tools/validate.js [file…]` — schema + roster validator. |
| `js/data/<file>.js` | data agents | one file per roster `file` column. |
| `js/art.js` | art agent | procedural SVG portraits, icons, emblems, backgrounds → `NG.art`. |
| `js/engine.js` | engine agent | save/state, progression, gacha, campaign, battle simulator → `NG.game`, `NG.battle`. |
| `tools/test-engine.js` | engine agent | node test harness for engine. |
| `index.html`, `css/style.css`, `js/ui.js` | UI agent | all screens, animations, battle playback. |
| `art-gallery.html` | art agent | dev page rendering every character's avatar + bust + skill icons. |

Script load order in `index.html` (classic scripts, no modules, so it also works from `file://`):
```
js/core.js → js/data/*.js (konoha_main, konoha_rookies, konoha_elders, uchiha_oto, akatsuki, suna_kiri, kumo_iwa, bijuu) → js/art.js → js/engine.js → js/ui.js
```
Each file is an IIFE that reads/writes `window.NG` only. No globals besides `NG` (and `NG_ROSTER` in tools).

---------------------------------------------------------------------------------------------------

## 2. Character data schema (data agents)

Each data file:
```js
/* js/data/konoha_main.js — 木叶·第七班 etc. */
NG.defineChars('konoha_main', [ { ...char }, { ...char } ]);
```
The first argument MUST equal the file's basename (roster `file` column).

### 2.1 Character object
```js
{
  id: 'sasuke_ms',              // exactly as in tools/roster.js
  name: '宇智波佐助',            // exactly as roster (official Simplified Chinese name)
  form: '须佐能乎',              // exactly as roster ('' or omitted if none)
  en: 'Uchiha Sasuke',          // romaji (family name first), shown under the Chinese name
  title: '复仇者',               // short 称号 epithet (2–6 chars)
  faction: 'taka',              // = roster
  rarity: 'SSR',                // = roster
  role: 'atk',                  // atk 输出 | tank 防御 | sup 辅助 | ctrl 控制 | heal 治疗
  element: 'fire',              // fire wind lightning earth water yin yang none — their signature chakra nature
  tags: ['输出','爆发'],          // 1–3 keys of NG.TAGS, shown as chips under the name
  stats: { hp: 0.95, atk: 1.15, def: 0.9, spd: 118 },  // hp/atk/def multipliers 0.8–1.25; spd absolute 70–150
  bio: '…',                     // 1–3 Chinese sentences, canon-accurate
  quote: '…',                   // short in-character line (shown on ult cut-in), paraphrase, ≤ 24 chars
  art: { … },                   // §2.4
  skills: { passive, s1, s2, ult, awaken }   // §2.2 / §2.3
}
```
Final stats are computed by the engine: `NG.RARITY_BASE[rarity] × NG.ROLES[role] × char.stats` (then level/star).
Use `stats` to express personality: Minato/Raikage/Lee spd 135–145; Kisame/Jirobo/Choji high hp; glass
cannons atk 1.2 def 0.85; slow giants (bijuu) spd 80–95. Keep hp·atk·def product near 1.0 (±0.1) so
rarity — not stats — decides strength.

### 2.2 Active skills (`s1`, `s2`, `ult`)
```js
s1: {
  name: '千鸟刃',                // canonical Chinese jutsu name
  desc: '以雷遁查克拉化为利刃刺穿敌人，造成110%攻击力伤害，并获得15%攻击力的护盾。',  // MUST match effects numerically
  tags: ['消耗','护盾'],          // 1–3 NG.TAGS keys
  fx: 'chidori',                 // key of NG.FX — drives icon + battle animation
  target: 'single',              // NG.TARGETS — who the skill hits
  count: 3,                      // only when target === 'random'
  cd: 0,                         // s1 must be 0 (basic attack). s2: 2–4. ult: omit (uses chakra 100)
  effects: [ {type:'dmg', mult:1.1}, {type:'shield', mult:0.15, to:'self'} ]
}
```
**Targets** (`NG.TARGETS`): `single` (current focus enemy; taunt overrides), `all`, `random`(+`count`),
`lowest` (lowest HP% enemy), `highest_atk`, `back` (rear-most enemy), `self`, `ally_lowest`, `ally_all`, `ally_random`.

**Effects** (`NG.EFFECT_TYPES`). Every effect applies to the skill's targets unless `to` overrides
(`NG.EFFECT_TO`: target, self, ally_all, ally_lowest, ally_random, ally_dead, enemy_all, enemy_random, attacker).

| type | params | meaning |
|---|---|---|
| `dmg` | `mult`, `hits`=1, `pierce`=0 | each hit deals `mult × ATK` (vs DEF). `pierce` 0–1 ignores that fraction of DEF. Total = mult×hits. |
| `true_dmg` | `pct` ≤ 0.5 | % of target max HP, ignores DEF (bosses take 30% of it). |
| `heal` | `mult` or `pct` | heal `mult × caster ATK` or `pct × target maxHP`. |
| `shield` | `mult` or `pct`, `turns`=2 | absorb shield. |
| `buff` | `stat`, `value`, `turns`=2 | stat ∈ NG.BUFF_STATS (atk def spd crit critDmg dmg dr dodge); value is a fraction (+30% = 0.3; crit/dodge/dr are absolute rate adds). |
| `debuff` | `stat`, `value`, `turns`=2, `chance`=1 | negative counterpart. `dr` debuff = target takes `value` more damage. |
| `status` | `status`, `turns`=1, `chance`=1, `value` | status ∈ stun freeze sleep bind (lose turn; sleep breaks on damage), silence (s1 only), burn poison bleed (DoT of `value`(default 0.3) × caster ATK per turn). |
| `execute` | `threshold`=0.3, `mult` | after the damage, targets below threshold HP% take extra `mult × ATK`. |
| `chakra` | `value` | grant chakra (default `to:'self'`). Ult needs 100. |
| `drain` | `value` | remove chakra from targets. |
| `lifesteal` | `value` | caster heals `value × damage dealt by this skill`. |
| `cleanse` | — | remove debuffs & statuses (default `to:'self'`; use `to:'ally_all'`). |
| `dispel` | — | remove buffs & shields from targets. |
| `revive` | `pct` | revive one dead ally at `pct` max HP (`to:'ally_dead'` implied; once per battle per caster). |
| `taunt` | `turns` | caster forces enemy single-target skills onto themself. |
| `counter` | `mult`, `turns` | caster counterattacks for `mult × ATK` when hit. |
| `immune` | `turns` | caster immune to control statuses. |

Balance guidelines (per-hit mult × hits = total). Scale lightly with rarity (R lowest, UR highest):
- `s1` (basic): single 0.9–1.3 total, optional small rider (5–20% shield/heal/debuff, 30% chance status).
- `s2` (cd 2–4): single 1.5–2.4 **or** AoE 0.7–1.2, or utility (heal 1.0–1.6×ATK all, shields, buffs 20–35%).
- `ult`: single 2.6–4.2 **or** AoE 1.3–2.4, plus a strong rider (stun 1 turn 50–100%, execute, team buff…).
- Healers/supports trade damage for utility. Tanks get taunt/shields/counter. Controllers get stun/sleep/bind/silence/drain.
- `desc` must state the actual numbers (e.g. "造成3段共210%攻击力伤害"). Never claim an effect you didn't encode.

### 2.3 Passive skills (`passive`, `awaken`)
```js
passive: {
  name: '万花筒写轮眼', desc: '暴击率+15%，闪避率+10%；战斗开始时获得20点查克拉。', tags: ['增益'],
  stats: { crit: 0.15, dodge: 0.10 },                       // NG.PASSIVE_STATS: hp atk def spd crit critDmg dodge dr dmg lifesteal (fractions, -0.5..1)
  triggers: [ { on: 'battle_start', effects: [ {type:'chakra', value:20} ] } ]
}
```
`triggers[].on` ∈ NG.TRIGGERS: `battle_start`, `turn_start` (each of own turns), `on_attack` (after any own
skill hits; effects default to the hit target), `on_hit` (when damaged; default target = attacker), `on_kill`,
`low_hp` (once, when HP < 30%), `on_ult`, `on_death` (once), `on_ally_death`. Optional `chance` (0–1).
Default `to` inside triggers: damaging/debuff/status effects → the relevant enemy (random enemy for
battle_start/turn_start); everything else → self.
`awaken` (突破) has the same shape, unlocks at ★4 (`NG.AWAKEN_STAR`), and should be a meaningful upgrade
(e.g. +10–15% atk plus a trigger). Name it after the character's late-canon power-up when possible.

### 2.4 Art spec (`art`) — consumed by `js/art.js`
All color fields are hex. All enum values must come from `NG.ART` in core.js (validator enforces).
```js
// human (default)
art: {
  type: 'human',
  skin: '#f6d2b0',
  hair: 'duck_long', hairColor: '#1b1f3a',       // NG.ART.hair
  eyes: 'ms_sasuke', eyeColor: '#2b2b2b',         // NG.ART.eyes; eyeColor = iris color for 'normal'
  eyeL: 'rinnegan', eyeR: 'ms_eternal',           // optional per-eye override (viewer's left/right)
  outfit: 'robe', outfitColor: '#f2f2f2', accentColor: '#4b3a8c',   // NG.ART.outfit
  headband: 'konoha', headbandSlash: false, headbandPos: 'forehead', // NG.ART.headband / headbandPos
  marks: ['whiskers'],                             // NG.ART.marks
  mask: 'none', hat: 'none', accessory: 'sword',   // NG.ART.mask / hat / accessory
  aura: '#7c4dff'                                  // chakra glow color in bust art (optional)
}
// beast (bijuu, toads…)
art: { type: 'beast', beast: 'fox', tails: 9, bodyColor: '#ff7a1a', accentColor: '#3b1200', eyes: 'beast', aura: '#ff5a00' }
```
Pick values so each character is *recognisable from silhouette + palette*: e.g. Naruto `spiky` `#f7c600`
hair, blue eyes, orange `jacket`, `whiskers`; Kakashi `spiky_up` silver, `eyeL:'sharingan'`, `mask:'lower'`,
`eye_scar`, `flak` green vest; Gaara `messy` red, `ai_tattoo`, `gourd`; Itachi `low_ponytail`, `tear_lines`,
`akatsuki`, slashed konoha headband; Guy/Lee `bowl` + `bodysuit` green; Kisame `blue_skin_marks` + `gills` + `samehada`.

---------------------------------------------------------------------------------------------------

## 3. Art API (`js/art.js` → `NG.art`)

All functions return **SVG markup strings** (no DOM needed — must also run in node), deterministic, memoized.
`*URL` variants return `data:image/svg+xml;charset=utf-8,…` strings (cached) for `<img src>` /
CSS backgrounds — the UI should prefer these for performance.
```js
NG.art.avatar(char, size=128)          // square head-and-shoulders portrait, transparent bg (UI clips it to a circle & adds frames)
NG.art.avatarURL(char, size)
NG.art.bust(char, w=560, h=640)         // half-body hero art (the big center image in the reference), transparent bg, chakra aura behind
NG.art.bustURL(char, w, h)
NG.art.skillIcon(char, skillKey, size=96)  // rounded-square skill icon: fx-colored gradient + emblem/glyph (dojutsu for eye skills, etc.)
NG.art.skillIconURL(char, skillKey, size)
NG.art.emblem(factionKey, size=64)      // village/faction symbol in a circle (konoha leaf, suna hourglass, kiri 4 lines, kumo cloud, iwa, oto note, akatsuki red cloud, ame 4 lines, …)
NG.art.emblemURL(factionKey, size)
NG.art.element(elementKey, size=32)     // small element badge
NG.art.background(kind, w=1280, h=720)  // scene: 'city_night' (training, like reference), 'village' (home), 'forest', 'valley' (终末之谷), 'desert', 'mist', 'rain', 'battlefield', 'summon', 'moon'
NG.art.backgroundURL(kind, w, h)
NG.art.frame(rarity, size)              // optional decorative avatar ring per rarity (gold ring like reference)
```
Unknown vocabulary values must degrade gracefully (fallback, never throw). Characters missing `art` get a
generic ninja silhouette. Style: anime cel-shading — bold dark outlines, 2–3 tone shading, big expressive
anime eyes, distinct hair silhouettes; bust art with dynamic pose hints (shoulders turned, weapon/accessory
visible, aura). Must look good at 64px (avatar) and 640px (bust).

---------------------------------------------------------------------------------------------------

## 4. Engine API (`js/engine.js` → `NG.game`, `NG.battle`)

### 4.1 Save state (`NG.game.state`, persisted to `localStorage[NG.SAVE_KEY]`, wrap storage in try/catch)
```js
{
  v: 1, created: <ms>, lastIdle: <ms>,
  player: { name: '无名忍者', lv: 1, exp: 0 },
  coins: 100000000, gems: 20000, tickets: 1000, scrolls: 200,     // start: 1亿铜币, 2万勾玉, 1000招募券, 200忍术卷轴
  roster: { [charId]: { lv: 1, star: 1, shards: 0, skills: { passive:1, s1:1, s2:1, ult:1, awaken:1 }, obtained: <ms> } },
  team: [id, id, id, id, id],                 // up to 5 owned ids, position 0 = front
  progress: { [stageId]: 0|1|2|3 },           // best stars
  pity: { ssr: 0, ur: 0 }, totalPulls: 0,
  flags: { welcomed: false },
  settings: { speed: 1, auto: true, rotate: 'auto', sound: false }
}
```
Currencies: 铜币 coins (level-up), 勾玉 gems (premium, 150 per pull when no tickets), 招募券 tickets
(1 per pull), 忍术卷轴 scrolls (skill upgrades).

### 4.2 API (all methods synchronous; mutate state, auto-save, `NG.emit('change', {what})`)
```js
NG.game.init()                    // load or create save; idempotent. New save → grants welcome pack (1000 tickets)
NG.game.state
NG.game.save(); NG.game.reset()   // reset = "重新开局": wipe and create a fresh save (1000 tickets again)
NG.game.chars()                   // all NG.CHARS
NG.game.char(id)                  // NG.CHAR_MAP[id]
NG.game.owned(id)                 // roster entry or null
NG.game.ownedList()               // [{id, c, e}] sorted by power desc (c = char data, e = roster entry)
NG.game.stats(id, entry?)         // {hp, atk, def, spd, crit, critDmg, dodge, dr, dmg, lifesteal, power}; entry defaults to owned/lv1★1
NG.game.power(id); NG.game.teamPower()
NG.game.maxLevel(id)              // NG.STAR_LEVEL_CAP[star]
NG.game.levelCost(id, n)          // coins for next n levels (clamped to cap)
NG.game.levelUp(id, n)            // -> {ok, gained, cost, reason}
NG.game.starCost(id)              // shards for next star or null if max
NG.game.starUp(id)                // -> {ok, reason}
NG.game.skillUnlocked(id, key)    // awaken requires star >= NG.AWAKEN_STAR
NG.game.skillCost(id, key)        // {coins, scrolls} or null (max lv NG.MAX_SKILL_LV)
NG.game.skillUp(id, key)          // -> {ok, reason}
NG.game.skillValue(id, key)       // multiplier for that skill's level, e.g. 1 + 0.08*(lv-1)
NG.game.rates()                   // {UR, SSR, SR, R}
NG.game.summon(n)                 // n ∈ {1,10,100}; spends tickets then gems; 10-pull guarantees ≥SR... see 4.3 -> {ok, reason, results:[{id, rarity, isNew, shards}]}
NG.game.pityInfo()                // {ssr, ur, urPity: 90}
NG.game.setTeam(ids); NG.game.autoTeam()
NG.game.chapters()                // [{id, name, desc, bg, stages:[{id, name, enemies:[{id, lv, star, boss}], power, rewards:{coins, gems, scrolls, exp, tickets}, firstRewards:{…}}]}]
NG.game.stage(stageId)
NG.game.stageState(stageId)       // {unlocked, stars}
NG.game.battleStage(stageId, seed?) // -> battle record (§4.4) for current team vs stage enemies. Does NOT grant rewards.
NG.game.finishStage(stageId, record) // -> {win, stars, rewards, firstClear}; grants rewards on win
NG.game.idle()                    // {coins, exp, scrolls, seconds} pending AFK rewards (cap 12h; rate scales with progress)
NG.game.claimIdle()
```

### 4.3 Gacha
Rates from `NG.RARITIES[*].rate` (UR 1.5%, SSR 8.5%, SR 30%, R 60%). Every 10-pull guarantees at least one
SSR+ ; hard UR pity at 90 pulls since last UR. New character → added at ★1 Lv1; duplicate → `dupShards`
shards. Star costs `NG.STAR_SHARD_COST`. 100-pull runs ten 10-pulls (for the 1000-ticket opening).

### 4.4 Battle simulator
```js
NG.battle.simulate(teamA, teamB, {seed, maxRounds: 30}) -> record
// team entries: {id, lv, star, skills:{passive,s1,s2,ult,awaken}, boss?:true, hpMult?:number}
record = {
  winner: 'A'|'B',              // draw/timeout counts as B
  rounds, stars,                // stars for A on win: 3 = no deaths, 2 = ≤2 deaths, 1 otherwise
  seed,
  units: [{uid:'A0', side:'A', pos:0, id, name, form, rarity, lv, star, maxHp, hp, chakra, boss}],  // initial snapshot
  events: [ … ]                 // ordered timeline for the UI to replay
}
```
Events (`t` field):
```
{t:'round', n}
{t:'act', uid, skill:'s1'|'s2'|'ult', name, fx, targets:[uid…]}          // start of an action; following events belong to it
{t:'dmg', src, uid, amount, crit, kind:'hit'|'dot'|'counter'|'execute'|'true', el?:'fire'…, adv?:true, hp, shield}
{t:'miss', src, uid}                                                       // dodged
{t:'heal', src, uid, amount, hp}
{t:'shield', uid, amount, shield}
{t:'status', uid, status, turns}       // status = NG.STATUSES key, or 'buff:atk' / 'debuff:def' / 'taunt' / 'counter' / 'immune'
{t:'status_end', uid, status}
{t:'chakra', uid, chakra}              // new value after change
{t:'skip', uid, status}                // lost turn to control
{t:'passive', uid, name}               // a passive/awaken trigger fired (UI shows floating text)
{t:'death', uid}
{t:'revive', uid, hp}
{t:'end', winner}
```
Turn order: ATB by speed (each tick add spd to gauge; act at ≥1000). On action: control → skip; chakra ≥100
and ult unlocked and not silenced → ult (chakra → 0); else s2 if off cooldown & not silenced; else s1.
Chakra +25 per action, +10 when hit. DMG = ATK×mult×(skillValue)×(1+dmg buffs) × 1000/(1000+DEF×(1−pierce)×k)… tune so
a level-matched fight lasts 6–12 rounds. Crit base 5%, critDmg 150%. Element advantage +25%. Seeded PRNG
(mulberry32) → deterministic replays. Must run in node (no DOM).

### 4.5 Campaign (推图)
~14 chapters following canon arcs, 8–10 stages each, last stage of each chapter is a boss (hpMult 2–3):
1 波之国 · 2 中忍考试 · 3 木叶崩溃 · 4 寻找纲手 · 5 佐助奪还 · 6 风影奪还 · 7 天地桥 · 8 飞段与角都 ·
9 宇智波兄弟 · 10 佩恩袭击 · 11 五影会谈 · 12 第四次忍界大战·上 · 13 第四次忍界大战·下 · 14 大筒木辉夜 / 终末之谷.
Enemies are roster ids fitting the arc; levels/stars ramp so chapter 1 is trivially easy and the end needs
Lv 300+ ★5 URs. Rewards scale. Unknown ids must be filtered out (never crash).

---------------------------------------------------------------------------------------------------

## 5. UI (index.html, css/style.css, js/ui.js)

Design canvas **1280×720 landscape**, scaled to fit the viewport (contain, centered, letterboxed on a dark
bg). If the viewport is portrait (phone held upright) and `settings.rotate === 'auto'`, rotate the stage 90°
so it fills the screen (standard H5-game trick) — user turns the phone sideways. Touch-first: tap targets
≥ 44px, no hover-only UI, `touch-action: manipulation`, no text selection, no pinch zoom issues.

Persistent top bar: back button + screen title (left, e.g. "培养 ☰"), currency pills on the right
(铜币, 勾玉, 招募券) styled like the reference (`42.0亿 ⊕`), using `NG.fmt`.

Screens:
1. **主城 Home** — `village` bg, team leader bust art, player name/Lv/战力, big menu buttons (冒险推图, 召唤, 忍者培养,
   编队, 图鉴, 设置), AFK chest (挂机收益) claim. First launch: welcome modal "开局送1000连抽！" → goes to 召唤.
2. **召唤 Summon** — banner art (rotating UR busts), rates info, buttons 单抽 / 十连 / 百连 (and a remaining
   tickets counter). Result reveal: cards flip with rarity glow (UR red-gold burst, SSR gold, SR purple, R blue),
   "NEW" badge, skip button; 100-pull shows a summary grid sorted by rarity. "重新开局" (reset save) entry with confirm.
3. **培养 Training** — the reference screenshot layout (see top of this doc). Left: team / owned list (scrollable
   avatars with gold ring frames, Lv label, rarity tint). Center: bust art + name plate + stars + form plate +
   tags + 战力. Right: tabs **技能 / 属性 / 升星**: 技能 = 5 skill cards (locked cards greyed "★4解锁"), tap a card →
   detail popup with full desc, level, upgrade button (coins + scrolls). 属性 = stat list + level-up buttons
   (升1级 / 升10级 / 一键满级) with cost. 升星 = shards progress bar + 升星 button. Swipe/arrows to switch character.
4. **忍者 / 图鉴 Codex** — grid of all ~180 characters (owned in color, unowned dimmed silhouette), filters:
   faction, rarity, role; owned count "已收集 x/180". Tap → detail (bust, bio, quote, skills).
5. **编队 Team** — 5 slots + owned list; tap to add/remove; 一键上阵 (auto); shows team power.
6. **冒险 Campaign** — chapter carousel (chapter bg + name), stage path/list with stars, enemy preview (avatars,
   recommended 战力), 挑战 button.
7. **战斗 Battle** — chapter background; player team left, enemies right (2–3 column formation), each unit =
   avatar art + name + HP bar (with shield overlay) + chakra bar + status icons. Replay `record.events`:
   actor lunges/projectiles by `NG.FX[fx].fam`, colored particles, floating damage numbers (crit bigger, gold),
   heals green, statuses text; **ult cut-in**: full-width diagonal band with the bust art sliding in, the skill
   name in huge brush-style text, the `quote`, fx-colored flash. Controls: ×1/×2/×4 speed, 跳过 skip. Result
   modal: 胜利/失败, stars, rewards, buttons (下一关 / 重试 / 返回).
8. **设置 Settings** — rotate mode, battle speed, 重新开局 (reset with confirm), credits: "同人作品，仅供学习交流，与官方无关".

Visual language: deep navy (#0f1838 → #23357a) gradient panels with 1px light-blue (#7fb2ff) borders and
inner glow, gold (#ffd25a → #b8860b) ornaments for titles & rarity, chunky white text with dark stroke
(text-shadow), rarity colors from `NG.RARITIES`, tag colors from `NG.TAGS`. Fonts: Google Fonts
"Noto Sans SC" (500/700/900) + a brush font such as "ZCOOL XiaoWei"/"Ma Shan Zheng" for big titles; fall back to system CJK fonts.
Animations via CSS transitions/keyframes + requestAnimationFrame; 60fps on phones (prefer transforms/opacity,
`<img>` of cached data-URL SVGs over inline giant SVG DOM). Nothing may throw if a character lacks some data.

---------------------------------------------------------------------------------------------------

## 6. Quality bar
- `node tools/validate.js` passes with 0 errors for all data.
- `node tools/test-engine.js` passes (summon distribution, level/star/skill costs, battle determinism, every
  character can act in battle without throwing, every campaign stage references valid ids).
- In Chromium (Playwright, `/opt/pw-browsers`, `NODE_PATH=/opt/node22/lib/node_modules`), index.html loads
  with zero console errors at 1280×720 and 390×844 (rotated), and every screen works end-to-end.
- No Boruto content. Canon-accurate Chinese names for characters and jutsu.
