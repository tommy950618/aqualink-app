/**
 * i18n.js - every user-visible string of LEGENDS 3v3 (spec v2 section 6.8, GP section 16, PR section 5.11).
 *
 * zh-CN is the default language, English the toggle. Together with src/legends.js this is the only src file that may
 * contain CJK text (H6); player names are NOT keys here, they come from legends.js (`name`, `short`).
 *
 * API (v1-compatible, extended):
 *   STRINGS             { zh: {key: text}, en: {key: text} } - frozen tables
 *   t(key, params)      look up in the current language, then English, then return the key itself;
 *                       `{name}` style placeholders are filled from params; a param value that is a
 *                       `{zh, en}` object (e.g. a legend's short name) is localised first
 *   pick(v)             localise a `{zh, en}` object (or pass a plain value through)
 *   hasKey(key)         true when both languages define the key
 *   getLang() / setLang(l) / toggleLang()   current language; setLang persists under the v1 key `hoop.lang`
 *   applyDom(root)      sets textContent of every [data-i18n] (JSON params in data-i18n-params) and the
 *                       aria-label of every [data-i18n-aria]; also the document title through <title data-i18n>
 *   onLangChange(cb)    subscribe (lang) => void; returns an unsubscribe function
 *
 * Safe to import in Node: every document / localStorage access is guarded (localStorage may throw, H11).
 */

const STORAGE_KEY = 'hoop.lang';         // v1 key kept (spec 6.5.10: "Language keeps the v1 i18n storage key")
const DEFAULT_LANG = 'zh';

const ZH = {
  // ---- v1 keys (kept) ----
  'app.title': '传奇对决 3v3',
  'menu.start': '开始比赛',
  'menu.resume': '继续',
  'menu.quit': '返回主菜单',
  'menu.rematch': '再来一局',
  'menu.settings': '设置',
  'menu.team': '选择球队',
  'menu.difficulty': '难度',
  'diff.easy': '简单',
  'diff.normal': '普通',
  'diff.hard': '困难',
  'menu.quarter': '每节时长',
  'menu.min': '{n} 分钟',
  'menu.language': '语言',
  'menu.lang.zh': '简体中文',
  'menu.lang.en': 'English',
  'menu.sound': '音效',
  'common.on': '开',
  'common.off': '关',
  'menu.pause': '暂停',
  'menu.tapToSkip': '点击跳过',
  'hint.landscape': '横屏体验更佳',
  'hint.dismiss': '知道了',
  'hint.nowebgl': '您的浏览器不支持 WebGL',
  'hint.ctxLost': '图形上下文丢失，点击重新加载',
  'btn.shoot': '投篮',
  'btn.block': '盖帽',
  'btn.pass': '传球',
  'btn.switch': '换人',
  'btn.cross': '变向',
  'btn.steal': '抢断',
  'btn.sprint': '冲刺',
  'btn.pause': '暂停',
  'btn.back': '返回',
  'btn.help': '帮助',
  'hud.q': '第{n}节',
  'hud.ot': '加时',
  'hud.ot2': '加时{n}',
  'hud.shotClock': '进攻时间',
  'meter.perfect': '完美',
  'meter.early': '稍早',
  'meter.late': '稍晚',
  'meter.three': '3',
  'meter.two': '2',
  'banner.check': '发球',
  'banner.quarterEnd': '第{n}节结束',
  'banner.halftime': '半场',
  'banner.overtime': '加时赛',
  'banner.final': '全场结束',
  'banner.plus': '+{n}',
  'banner.resume': '{n}',
  'cap.make2': '{name} 两分命中',
  'cap.make3': '{name} 三分命中！',
  'cap.layup': '{name} 上篮得分',
  'cap.dunk': '{name} 暴扣！',
  'cap.miss': '{name} 投篮不中',
  'cap.airball': '{name} 三不沾',
  'cap.block': '{name} 盖帽！',
  'cap.steal': '{name} 抢断！',
  'cap.rebound': '{name} 抢下篮板',
  'cap.oob': '出界',
  'cap.shotClock': '进攻超时',
  'cap.turnover': '失误',
  'cap.buzzerBeater': '{name} 压哨命中！',
  'cap.bank': '{name} 打板命中',
  'over.winner': '{team} 获胜',
  'over.tie': '平局',
  'stats.name': '球员',
  'stats.pts': '得分',
  'stats.fg': '投篮',
  'stats.tp': '三分',
  'stats.reb': '篮板',
  'stats.ast': '助攻',
  'stats.stl': '抢断',
  'stats.blk': '盖帽',

  // ---- brand, title, legal ----
  'brand.wordmark': 'LEGENDS',
  'brand.zh': '传奇对决',
  'brand.sub': 'LEGENDS 3V3',
  'legal.note': '非商业粉丝作品 · 球员姓名与形象归其本人所有',
  'title.play': '开始游戏',
  'title.quick': '快速比赛',
  'title.settings': '设置',
  'title.lang': '中 / EN',
  'menu.lineup': '阵容',

  // ---- lineup ----
  'lineup.title': '选择阵容',
  'lineup.you': '我方',
  'lineup.start': '开始',
  'lineup.shuffle': '随机',
  'lineup.reset': '重置',
  'lineup.kits': '球衣',
  'lineup.kits.auto': '自动',
  'lineup.kits.classic': '经典',
  'lineup.kits.allstar': '全明星',
  'lineup.kitsAuto': '自动',
  'lineup.kitsClassic': '经典',
  'lineup.handler': '持球核心',
  'lineup.makeHandler': '设为持球核心',
  'lineup.swapHint': '依次点两名球员即可交换',
  'lineup.clash': '经典球衣可能撞色',
  'lineup.help': '点击球员查看能力；点击另一名球员与其交换；点击号码设为持球核心（★）。',
  'lineup.ovr': 'OVR',
  'lineup.height': '{h} m',
  'lineup.teamA': 'A',
  'lineup.teamB': 'B',

  // ---- teams ----
  'team.dark': '暗夜队',
  'team.bright': '烈阳队',
  'team.white': '白队',
  'team.black': '黑队',
  'abbr.dark': '暗夜',
  'abbr.bright': '烈阳',
  'abbr.white': '白队',
  'abbr.black': '黑队',

  // ---- rules ----
  'rules.clear': '清球规则（3x3）',
  'rules.autoSwitch': '防守自动换人',

  // ---- ratings (stat.<ratings key>) and composites ----
  'stat.speed': '速度',
  'stat.strength': '力量',
  'stat.vertical': '弹跳',
  'stat.ballHandle': '控球',
  'stat.closeShot': '近投',
  'stat.midRange': '中投',
  'stat.three': '三分',
  'stat.dunk': '扣篮',
  'stat.layup': '上篮',
  'stat.passing': '传球',
  'stat.perimeterD': '外线防守',
  'stat.interiorD': '内线防守',
  'stat.block': '盖帽',
  'stat.steal': '抢断',
  'stat.rebound': '篮板',
  // card chip abbreviations of the ratings (statShort.<ratings key>)
  'statShort.speed': '速度',
  'statShort.strength': '力量',
  'statShort.vertical': '弹跳',
  'statShort.ballHandle': '控球',
  'statShort.closeShot': '近投',
  'statShort.midRange': '中投',
  'statShort.three': '三分',
  'statShort.dunk': '扣篮',
  'statShort.layup': '上篮',
  'statShort.passing': '传球',
  'statShort.perimeterD': '外防',
  'statShort.interiorD': '内防',
  'statShort.block': '盖帽',
  'statShort.steal': '抢断',
  'statShort.rebound': '篮板',
  'comp.sht': '投篮',
  'comp.drv': '突破',
  'comp.ins': '内线',
  'comp.def': '防守',

  // ---- abilities ----
  'ability.clutch': '关键先生',
  'ability.kobe.postFade': '背身后仰',
  'ability.kobe.jab': '试探步急停',
  'ability.kobe.tough': '高难度投篮',
  'ability.jordan.fade': '招牌后仰',
  'ability.jordan.air': '空中换手',
  'ability.jordan.ftDunk': '罚球线起跳扣篮',
  'ability.jordan.hawk': '抢断嗅觉',
  'ability.lebron.powerDrive': '强力突破',
  'ability.lebron.chaseDown': '追身大帽',
  'ability.lebron.skipPass': '跨场传球',
  'ability.lebron.bully': '背身碾压',
  'ability.giannis.euro': '欧洲步',
  'ability.giannis.longDunk': '长途奔袭扣篮',
  'ability.giannis.helpBlock': '协防封盖',
  'ability.yao.hook': '勾手',
  'ability.yao.highRelease': '高点出手',
  'ability.yao.anchor': '护框',
  'ability.yao.post': '背身单打',
  'ability.kyrie.combo': '连续变向',
  'ability.kyrie.finisher': '终结大师',
  'ability.kyrie.stepback': '后撤步三分',

  // ---- captions v2 ----
  'cap.ankle': '{name} 晃倒了对手！',
  'cap.chaseDown': '{name} 追身大帽！',
  'cap.rimOut': '{name} 扣篮砸框弹出',
  'cap.clear': '清球！',
  'cap.notCleared': '未清球，进球无效',
  'cap.hot': '{name} 手感火热！',
  'cap.winner': '{name} 绝杀！',
  'cap.firstDunk': '{name} 送上本场首扣！',
  'cap.check': '{name} 发球',
  'cap.ab.jordan.ftDunk': '{name} 罚球线起跳扣篮！',
  'cap.ab.jordan.fade': '{name} 后仰跳投',
  'cap.ab.kobe.postFade': '{name} 转身后仰',
  'cap.ab.kobe.jab': '{name} 试探步急停跳投',
  'cap.ab.lebron.powerDrive': '{name} 强起撞开防守',
  'cap.ab.lebron.skipPass': '{name} 单手跨场传球',
  'cap.ab.giannis.euro': '{name} 欧洲步',
  'cap.ab.giannis.longDunk': '{name} 长距离起跳扣篮',
  'cap.ab.yao.hook': '{name} 勾手',
  'cap.ab.yao.dropStep': '{name} 沉步转身',
  'cap.ab.kyrie.combo': '{name} 连续变向',
  'cap.ab.kyrie.stepback': '{name} 后撤步',
  'cap.ab.kyrie.finisher': '{name} 拉杆上篮',

  // ---- first-time tips (in game) and loading tips ----
  'tip.pumpFake': '轻点投篮 = 假动作',
  'tip.combo': '连点两下变向 = 连招',
  'tip.post': '慢慢顶向防守人 = 背身单打',
  'tip.fade': '摇杆背离篮筐再投篮 = 后仰',
  'tip.block': '盖帽要在对手出手时起跳',
  'tip.1': '摇杆移动，投篮键按住松开出手',
  'tip.2': '绿色区域松手最准',
  'tip.3': '轻点投篮可做假动作',
  'tip.4': '连点变向键打出连招',
  'tip.5': '横屏体验更好',
  'tip.6': '卡顿时可在设置中调低画质',

  // ---- intro and replay ----
  'intro.starters': '{team} · 首发',
  'intro.vs': 'VS',
  'intro.skip': '跳过',
  'intro.line': 'OVR {ovr} · {h} m · {era}',
  'replay.tag': '回放',
  'replay.tagFull': '回放 REPLAY',
  'replay.skip': '跳过',

  // ---- jumbotron / LED (bilingual by design) ----
  'jumbo.dunk': '暴扣!',
  'jumbo.three': '三分!',
  'jumbo.block': '盖帽!',
  'jumbo.winner': '绝杀!',
  'jumbo.final': '终场',
  'jumbo.leader': '{name} {pts} 分',
  'led.brand': '传奇对决 · LEGENDS 3V3',
  'led.defense': 'DEFENSE · 防守!',
  'led.noise': 'MAKE SOME NOISE · 呐喊吧',
  'led.clutch': 'CLUTCH TIME · 关键时刻',
  'led.gg': 'GOOD GAME · 精彩比赛',
  'led.score': '{a} {sa} – {sb} {b}',

  // ---- halftime / game over ----
  'half.leader': '{name} {pts} 分 {reb} 板',
  'over.mvp': 'MVP',
  'over.lineup': '更换阵容',
  'over.menu': '主菜单',
  'over.mvpLine': '{pts} 分 · {reb} 板 · {ast} 助',

  // ---- settings (rows and options of 6.5.10) ----
  'settings.title': '设置',
  'settings.close': '返回',
  'settings.quality': '画质',
  'settings.lang': '语言',
  'settings.sound': '音效',
  'settings.crowd': '观众音量',
  'settings.camera': '镜头',
  'settings.difficulty': '难度',
  'settings.quarter': '每节时长',
  'settings.replays': '回放',
  'settings.intro': '开场介绍',
  'settings.kits': '球衣',
  'settings.clear': '清球规则',
  'settings.autoSwitch': '防守自动换人',
  'settings.quality.auto': '自动',
  'settings.quality.autoTier': '自动 · {tier}',
  'settings.quality.low': '低',
  'settings.quality.medium': '中',
  'settings.quality.high': '高',
  'settings.tier.low': '低',
  'settings.tier.medium': '中',
  'settings.tier.high': '高',
  'settings.crowd.low': '低',
  'settings.crowd.mid': '中',
  'settings.crowd.high': '高',
  'settings.camera.standard': '标准',
  'settings.camera.close': '近景',
  'settings.camera.high': '高位',
  'settings.quarter.n': '{n} 分钟',
  'settings.replays.off': '关',
  'settings.replays.dunks': '扣篮与绝杀',
  'settings.replays.all': '全部精彩',
  'settings.intro.full': '完整',
  'settings.intro.short': '简短',
  'settings.intro.off': '关闭',
  'settings.reloadNote': '贴图尺寸将在下次启动时生效',
  'settings.readOnly': '比赛中不可更改',

  // ---- loading ----
  'load.engine': '正在启动引擎',
  'load.assets': '正在下载球员模型',
  'load.paint': '正在绘制球员',
  'load.arena': '正在布置球馆',
  'load.compile': '正在准备着色器',
  'load.status': '{label}… {pct} %',
  'load.bytes': '{a} / {b} MB',
  'loadError.title': '加载失败',
  'loadError.retry': '重试',
  'loadError.simple': '简化模式',
  'loadError.detail': '{file}（{reason}）',

  // ---- toasts ----
  'toast.allstar': '非默认阵容：已换上全明星球衣',
  'toast.webgl1': '设备不支持高清球员，已切换简化模式',
  'toast.tier': '画质已调整为{tier}',
  'legendsLoadFailed': '球员模型加载失败，已切换简化模式',

  // ---- animation viewer labels (anim.*, ?anim= page of WP3) ----
  'anim.title': '动作查看器',
  'anim.list': '动作列表',
  'anim.clip': '动作',
  'anim.player': '球员',
  'anim.play': '播放',
  'anim.pause': '暂停',
  'anim.step': '单步',
  'anim.speed': '速度',
  'anim.loop': '循环',
  'anim.mirror': '镜像',
  'anim.ik': '反向动力学',
  'anim.look': '视线',
  'anim.camera': '镜头',
  'anim.lod': '细节层级',
  'anim.kit': '球衣',
  'anim.bones': '骨骼',
  'anim.ball': '篮球',
  'anim.grid': '网格',
  'anim.ghost': '残影',
  'anim.time': '时间',
  'anim.events': '事件',
  'anim.ballMode': '持球方式',
  'anim.sockets': '挂点高度',
  'anim.root': '根位置',
  'anim.footLocks': '脚步锁定',
  'anim.slide': '滑步',
  'anim.jumpY': '起跳高度',
  'anim.cpu': '动画耗时',
  'anim.loco': '步态预览',
  'anim.dribble': '运球预览',
};

const EN = {
  // ---- v1 keys (kept) ----
  'app.title': 'LEGENDS 3v3',
  'menu.start': 'Start Game',
  'menu.resume': 'Resume',
  'menu.quit': 'Main Menu',
  'menu.rematch': 'Rematch',
  'menu.settings': 'Settings',
  'menu.team': 'Your Team',
  'menu.difficulty': 'Difficulty',
  'diff.easy': 'Easy',
  'diff.normal': 'Normal',
  'diff.hard': 'Hard',
  'menu.quarter': 'Quarter Length',
  'menu.min': '{n} min',
  'menu.language': 'Language',
  'menu.lang.zh': '简体中文',
  'menu.lang.en': 'English',
  'menu.sound': 'Sound',
  'common.on': 'On',
  'common.off': 'Off',
  'menu.pause': 'Paused',
  'menu.tapToSkip': 'Tap to skip',
  'hint.landscape': 'Landscape recommended',
  'hint.dismiss': 'Got it',
  'hint.nowebgl': 'Your browser does not support WebGL',
  'hint.ctxLost': 'Graphics context lost, tap to reload',
  'btn.shoot': 'SHOOT',
  'btn.block': 'BLOCK',
  'btn.pass': 'PASS',
  'btn.switch': 'SWITCH',
  'btn.cross': 'CROSS',
  'btn.steal': 'STEAL',
  'btn.sprint': 'SPRINT',
  'btn.pause': 'PAUSE',
  'btn.back': 'Back',
  'btn.help': 'Help',
  'hud.q': 'Q{n}',
  'hud.ot': 'OT',
  'hud.ot2': 'OT{n}',
  'hud.shotClock': 'Shot',
  'meter.perfect': 'PERFECT',
  'meter.early': 'EARLY',
  'meter.late': 'LATE',
  'meter.three': '3',
  'meter.two': '2',
  'banner.check': 'CHECK BALL',
  'banner.quarterEnd': 'END OF Q{n}',
  'banner.halftime': 'HALFTIME',
  'banner.overtime': 'OVERTIME',
  'banner.final': 'FINAL',
  'banner.plus': '+{n}',
  'banner.resume': '{n}',
  'cap.make2': '{name} scores',
  'cap.make3': '{name} hits the three!',
  'cap.layup': '{name} lays it in',
  'cap.dunk': '{name} throws it down!',
  'cap.miss': '{name} misses',
  'cap.airball': '{name} air ball',
  'cap.block': '{name} blocks it!',
  'cap.steal': '{name} steals it!',
  'cap.rebound': '{name} rebounds',
  'cap.oob': 'Out of bounds',
  'cap.shotClock': 'Shot clock violation',
  'cap.turnover': 'Turnover',
  'cap.buzzerBeater': '{name} beats the buzzer!',
  'cap.bank': '{name} banks it in',
  'over.winner': '{team} win',
  'over.tie': 'Tie',
  'stats.name': 'Player',
  'stats.pts': 'PTS',
  'stats.fg': 'FG',
  'stats.tp': '3PT',
  'stats.reb': 'REB',
  'stats.ast': 'AST',
  'stats.stl': 'STL',
  'stats.blk': 'BLK',

  // ---- brand, title, legal ----
  'brand.wordmark': 'LEGENDS',
  'brand.zh': '传奇对决',
  'brand.sub': 'LEGENDS 3V3',
  'legal.note': 'Non-commercial fan project · names and likenesses belong to the players',
  'title.play': 'Play',
  'title.quick': 'Quick Game',
  'title.settings': 'Settings',
  'title.lang': '中 / EN',
  'menu.lineup': 'Lineup',

  // ---- lineup ----
  'lineup.title': 'Choose Lineups',
  'lineup.you': 'YOU',
  'lineup.start': 'Start',
  'lineup.shuffle': 'Shuffle',
  'lineup.reset': 'Reset',
  'lineup.kits': 'Kits',
  'lineup.kits.auto': 'Auto',
  'lineup.kits.classic': 'Classic',
  'lineup.kits.allstar': 'All-Star',
  'lineup.kitsAuto': 'Auto',
  'lineup.kitsClassic': 'Classic',
  'lineup.handler': 'Ball handler',
  'lineup.makeHandler': 'Make ball handler',
  'lineup.swapHint': 'Tap two players to swap them',
  'lineup.clash': 'Classic kits may clash',
  'lineup.help': 'Tap a player for his ratings; tap another player to swap them; tap a number to make him the ball handler (★).',
  'lineup.ovr': 'OVR',
  'lineup.height': '{h} m',
  'lineup.teamA': 'A',
  'lineup.teamB': 'B',

  // ---- teams ----
  'team.dark': 'Team Dark',
  'team.bright': 'Team Bright',
  'team.white': 'Team White',
  'team.black': 'Team Black',
  'abbr.dark': 'DRK',
  'abbr.bright': 'BRT',
  'abbr.white': 'WHT',
  'abbr.black': 'BLK',

  // ---- rules ----
  'rules.clear': 'Clear-the-ball (3x3)',
  'rules.autoSwitch': 'Auto-switch on defence',

  // ---- ratings and composites ----
  'stat.speed': 'Speed',
  'stat.strength': 'Strength',
  'stat.vertical': 'Vertical',
  'stat.ballHandle': 'Handles',
  'stat.closeShot': 'Close',
  'stat.midRange': 'Mid-range',
  'stat.three': 'Three',
  'stat.dunk': 'Dunk',
  'stat.layup': 'Layup',
  'stat.passing': 'Passing',
  'stat.perimeterD': 'Perimeter D',
  'stat.interiorD': 'Interior D',
  'stat.block': 'Block',
  'stat.steal': 'Steal',
  'stat.rebound': 'Rebound',
  // card chip abbreviations of the ratings
  'statShort.speed': 'SPD',
  'statShort.strength': 'STR',
  'statShort.vertical': 'VRT',
  'statShort.ballHandle': 'HND',
  'statShort.closeShot': 'CLS',
  'statShort.midRange': 'MID',
  'statShort.three': '3PT',
  'statShort.dunk': 'DNK',
  'statShort.layup': 'LAY',
  'statShort.passing': 'PAS',
  'statShort.perimeterD': 'PRD',
  'statShort.interiorD': 'IND',
  'statShort.block': 'BLK',
  'statShort.steal': 'STL',
  'statShort.rebound': 'REB',
  'comp.sht': 'SHT',
  'comp.drv': 'DRV',
  'comp.ins': 'INS',
  'comp.def': 'DEF',

  // ---- abilities ----
  'ability.clutch': 'Clutch',
  'ability.kobe.postFade': 'Post Fadeaway',
  'ability.kobe.jab': 'Jab-Step Pull-Up',
  'ability.kobe.tough': 'Tough Shots',
  'ability.jordan.fade': 'Signature Fadeaway',
  'ability.jordan.air': 'Mid-Air Switch',
  'ability.jordan.ftDunk': 'Free-Throw-Line Dunk',
  'ability.jordan.hawk': 'Ball Hawk',
  'ability.lebron.powerDrive': 'Power Drive',
  'ability.lebron.chaseDown': 'Chase-Down Block',
  'ability.lebron.skipPass': 'Cross-Court Pass',
  'ability.lebron.bully': 'Bully Ball',
  'ability.giannis.euro': 'Eurostep',
  'ability.giannis.longDunk': 'Long-Stride Dunk',
  'ability.giannis.helpBlock': 'Help-Side Block',
  'ability.yao.hook': 'Jump Hook',
  'ability.yao.highRelease': 'High Release',
  'ability.yao.anchor': 'Rim Anchor',
  'ability.yao.post': 'Post Scorer',
  'ability.kyrie.combo': 'Handle Combo',
  'ability.kyrie.finisher': 'Acrobatic Finisher',
  'ability.kyrie.stepback': 'Step-Back Three',

  // ---- captions v2 ----
  'cap.ankle': '{name} broke his ankles!',
  'cap.chaseDown': '{name} chase-down block!',
  'cap.rimOut': "{name}'s dunk rims out",
  'cap.clear': 'Clear it!',
  'cap.notCleared': 'Not cleared — no basket',
  'cap.hot': '{name} is heating up!',
  'cap.winner': '{name} wins it!',
  'cap.firstDunk': '{name} with the first dunk of the game!',
  'cap.check': '{name} checks it',
  'cap.ab.jordan.ftDunk': '{name} from the free-throw line!',
  'cap.ab.jordan.fade': '{name} fadeaway',
  'cap.ab.kobe.postFade': '{name} turnaround fade',
  'cap.ab.kobe.jab': '{name} jab-step jumper',
  'cap.ab.lebron.powerDrive': '{name} powers through',
  'cap.ab.lebron.skipPass': '{name} skip pass',
  'cap.ab.giannis.euro': '{name} euro step',
  'cap.ab.giannis.longDunk': '{name} long-stride slam',
  'cap.ab.yao.hook': '{name} jump hook',
  'cap.ab.yao.dropStep': '{name} drop step',
  'cap.ab.kyrie.combo': '{name} crossover combo',
  'cap.ab.kyrie.stepback': '{name} step-back',
  'cap.ab.kyrie.finisher': '{name} acrobatic finish',

  // ---- tips ----
  'tip.pumpFake': 'Tap SHOOT quickly to pump fake',
  'tip.combo': 'Double-tap CROSS for a combo',
  'tip.post': 'Walk into your defender to post up',
  'tip.fade': 'Stick away from the hoop + SHOOT = fadeaway',
  'tip.block': 'Jump as he releases to block',
  'tip.1': 'Move with the stick; hold and release SHOOT',
  'tip.2': 'Release in the green zone',
  'tip.3': 'Tap SHOOT quickly to pump fake',
  'tip.4': 'Double-tap CROSS for combos',
  'tip.5': 'Landscape plays best',
  'tip.6': 'Lower the quality in Settings if it stutters',

  // ---- intro and replay ----
  'intro.starters': '{team} · Starters',
  'intro.vs': 'VS',
  'intro.skip': 'Skip',
  'intro.line': 'OVR {ovr} · {h} m · {era}',
  'replay.tag': 'REPLAY',
  'replay.tagFull': 'REPLAY',
  'replay.skip': 'Skip',

  // ---- jumbotron / LED ----
  'jumbo.dunk': 'DUNK!',
  'jumbo.three': 'THREE!',
  'jumbo.block': 'BLOCKED!',
  'jumbo.winner': 'GAME WINNER!',
  'jumbo.final': 'FINAL',
  'jumbo.leader': '{name} {pts} PTS',
  'led.brand': '传奇对决 · LEGENDS 3V3',
  'led.defense': 'DEFENSE · 防守!',
  'led.noise': 'MAKE SOME NOISE · 呐喊吧',
  'led.clutch': 'CLUTCH TIME · 关键时刻',
  'led.gg': 'GOOD GAME · 精彩比赛',
  'led.score': '{a} {sa} – {sb} {b}',

  // ---- halftime / game over ----
  'half.leader': '{name} {pts} PTS {reb} REB',
  'over.mvp': 'MVP',
  'over.lineup': 'Change Lineup',
  'over.menu': 'Main Menu',
  'over.mvpLine': '{pts} PTS · {reb} REB · {ast} AST',

  // ---- settings ----
  'settings.title': 'Settings',
  'settings.close': 'Back',
  'settings.quality': 'Quality',
  'settings.lang': 'Language',
  'settings.sound': 'Sound',
  'settings.crowd': 'Crowd',
  'settings.camera': 'Camera',
  'settings.difficulty': 'Difficulty',
  'settings.quarter': 'Quarter',
  'settings.replays': 'Replays',
  'settings.intro': 'Intro',
  'settings.kits': 'Kits',
  'settings.clear': 'Clear-the-ball',
  'settings.autoSwitch': 'Auto-switch',
  'settings.quality.auto': 'Auto',
  'settings.quality.autoTier': 'Auto · {tier}',
  'settings.quality.low': 'Low',
  'settings.quality.medium': 'Med',
  'settings.quality.high': 'High',
  'settings.tier.low': 'Low',
  'settings.tier.medium': 'Med',
  'settings.tier.high': 'High',
  'settings.crowd.low': 'Low',
  'settings.crowd.mid': 'Mid',
  'settings.crowd.high': 'High',
  'settings.camera.standard': 'Standard',
  'settings.camera.close': 'Close',
  'settings.camera.high': 'High',
  'settings.quarter.n': '{n} min',
  'settings.replays.off': 'Off',
  'settings.replays.dunks': 'Dunks & winners',
  'settings.replays.all': 'All big plays',
  'settings.intro.full': 'Full',
  'settings.intro.short': 'Short',
  'settings.intro.off': 'Off',
  'settings.reloadNote': 'Texture sizes change on the next launch',
  'settings.readOnly': 'Locked during a game',

  // ---- loading ----
  'load.engine': 'Starting engine',
  'load.assets': 'Downloading players',
  'load.paint': 'Painting players',
  'load.arena': 'Building the arena',
  'load.compile': 'Preparing shaders',
  'load.status': '{label}… {pct} %',
  'load.bytes': '{a} / {b} MB',
  'loadError.title': 'Loading failed',
  'loadError.retry': 'Retry',
  'loadError.simple': 'Simple mode',
  'loadError.detail': '{file} ({reason})',

  // ---- toasts ----
  'toast.allstar': 'Custom lineup: All-Star kits',
  'toast.webgl1': 'High-detail players need WebGL2: simple mode',
  'toast.tier': 'Quality set to {tier}',
  'legendsLoadFailed': 'Player models failed to load: simple mode',

  // ---- animation viewer labels ----
  'anim.title': 'Animation viewer',
  'anim.list': 'Clip list',
  'anim.clip': 'Clip',
  'anim.player': 'Player',
  'anim.play': 'Play',
  'anim.pause': 'Pause',
  'anim.step': 'Step',
  'anim.speed': 'Speed',
  'anim.loop': 'Loop',
  'anim.mirror': 'Mirror',
  'anim.ik': 'IK',
  'anim.look': 'Look-at',
  'anim.camera': 'Camera',
  'anim.lod': 'LOD',
  'anim.kit': 'Kit',
  'anim.bones': 'Bones',
  'anim.ball': 'Ball',
  'anim.grid': 'Grid',
  'anim.ghost': 'Ghosts',
  'anim.time': 'Time',
  'anim.events': 'Events',
  'anim.ballMode': 'Ball mode',
  'anim.sockets': 'Socket heights',
  'anim.root': 'Root',
  'anim.footLocks': 'Foot locks',
  'anim.slide': 'Slide',
  'anim.jumpY': 'Jump height',
  'anim.cpu': 'Anim CPU',
  'anim.loco': 'Gait preview',
  'anim.dribble': 'Dribble preview',
};

export const STRINGS = Object.freeze({ zh: Object.freeze(ZH), en: Object.freeze(EN) });

const listeners = [];
let lang = readStored() || DEFAULT_LANG;

function hasDom() {
  return typeof document !== 'undefined' && document !== null && typeof document.querySelectorAll === 'function';
}

function readStored() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    const v = localStorage.getItem(STORAGE_KEY);
    return v && STRINGS[v] ? v : null;
  } catch (err) {
    return null;
  }
}

function writeStored(l) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage !== null) localStorage.setItem(STORAGE_KEY, l);
  } catch (err) {
    // Private mode, sandboxed iframe or blocked storage: the choice lives in memory for this session (H11).
  }
}

/** Localise a `{zh, en}` object for the current language; other values pass through unchanged. */
export function pick(v) {
  if (v !== null && typeof v === 'object' && (v.zh !== undefined || v.en !== undefined)) {
    const s = v[lang];
    return s !== undefined ? s : (v.en !== undefined ? v.en : v.zh);
  }
  return v;
}

function interpolate(text, params) {
  if (!params || text.indexOf('{') < 0) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => {
    const v = params[k];
    if (v === undefined || v === null) return m;
    return String(pick(v));
  });
}

/** Translate `key` (current language, English fallback, else the key itself) and fill `{placeholders}`. */
export function t(key, params) {
  const table = STRINGS[lang];
  let text = table ? table[key] : undefined;
  if (text === undefined) text = STRINGS.en[key];
  if (text === undefined) return String(key);
  return interpolate(text, params);
}

/** True when both languages define `key`. */
export function hasKey(key) {
  return Object.prototype.hasOwnProperty.call(ZH, key) && Object.prototype.hasOwnProperty.call(EN, key);
}

export function getLang() {
  return lang;
}

/** Switch language (unknown codes are ignored), persist it, re-label the DOM and notify listeners. */
export function setLang(l) {
  if (!STRINGS[l]) return lang;
  const changed = l !== lang;
  lang = l;
  writeStored(l);
  if (hasDom()) {
    if (document.documentElement) document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
    applyDom(document);
  }
  if (changed) {
    for (let i = 0; i < listeners.length; i++) {
      try { listeners[i](lang); } catch (err) { if (typeof console !== 'undefined') console.warn('[i18n] listener failed', err); }
    }
  }
  return lang;
}

export function toggleLang() {
  return setLang(lang === 'zh' ? 'en' : 'zh');
}

function paramsOf(el) {
  const raw = el.getAttribute('data-i18n-params');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return undefined;
  }
}

function applyTo(el) {
  const key = el.getAttribute('data-i18n');
  if (key) {
    const text = t(key, paramsOf(el));
    if (el.textContent !== text) el.textContent = text;
  }
  const aria = el.getAttribute('data-i18n-aria');
  if (aria) {
    const label = t(aria);
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
  }
}

/**
 * Set textContent of every [data-i18n] element under root (and root itself), and aria-label of every
 * [data-i18n-aria] element. data-i18n-params holds a JSON object for the placeholders.
 */
export function applyDom(root) {
  if (!hasDom()) return;
  const r = root || document;
  if (r !== document && typeof r.hasAttribute === 'function' && (r.hasAttribute('data-i18n') || r.hasAttribute('data-i18n-aria'))) applyTo(r);
  const nodes = r.querySelectorAll('[data-i18n], [data-i18n-aria]');
  for (let i = 0; i < nodes.length; i++) applyTo(nodes[i]);
}

/** Register a callback (lang) => void; returns an unsubscribe function. */
export function onLangChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}
