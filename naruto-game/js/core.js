/* 忍界传说 · core.js
 * Shared namespace, constants and the character registry.
 * Loaded FIRST. Every other file reads from window.NG.
 * Do not put game logic here — see CONTRACT.md for who owns what.
 */
(function (root) {
  'use strict';
  var NG = root.NG = root.NG || {};

  NG.VERSION = '1.0.0';
  NG.SAVE_KEY = 'ng_save_v1';

  /* ---------------- Factions (阵营) ---------------- */
  NG.FACTIONS = {
    konoha:    { name: '木叶隐村', short: '木叶', color: '#3fa34d', kanji: '木' },
    suna:      { name: '砂隐村',   short: '砂隐', color: '#d1a548', kanji: '砂' },
    kiri:      { name: '雾隐村',   short: '雾隐', color: '#4a8fd6', kanji: '雾' },
    kumo:      { name: '云隐村',   short: '云隐', color: '#e8c547', kanji: '云' },
    iwa:       { name: '岩隐村',   short: '岩隐', color: '#9a7b66', kanji: '岩' },
    oto:       { name: '音隐村',   short: '音隐', color: '#8a63d2', kanji: '音' },
    taka:      { name: '鹰小队',   short: '鹰',   color: '#5d6b8a', kanji: '鹰' },
    akatsuki:  { name: '晓',       short: '晓',   color: '#d33a3a', kanji: '晓' },
    ame:       { name: '雨隐村',   short: '雨隐', color: '#6a78c9', kanji: '雨' },
    samurai:   { name: '铁之国',   short: '铁',   color: '#8ea1ad', kanji: '铁' },
    otsutsuki: { name: '大筒木一族', short: '大筒木', color: '#e6e1f5', kanji: '月' },
    bijuu:     { name: '尾兽',     short: '尾兽', color: '#ff7a45', kanji: '兽' },
    legend:    { name: '战国传说', short: '战国', color: '#c0392b', kanji: '战' },
    summon:    { name: '通灵兽',   short: '通灵', color: '#e09a3e', kanji: '灵' },
    other:     { name: '忍界散人', short: '散人', color: '#9aa3ad', kanji: '忍' }
  };

  /* ---------------- Rarity (稀有度) ---------------- */
  // rate = gacha probability. dupShards = shards granted by a duplicate pull.
  NG.RARITIES = {
    UR:  { name: 'UR',  order: 4, color: '#ff4d4d', color2: '#ffb199', rate: 0.015, dupShards: 40 },
    SSR: { name: 'SSR', order: 3, color: '#ffb300', color2: '#fff1a8', rate: 0.085, dupShards: 30 },
    SR:  { name: 'SR',  order: 2, color: '#b061ff', color2: '#e3c4ff', rate: 0.30,  dupShards: 20 },
    R:   { name: 'R',   order: 1, color: '#3d9bff', color2: '#b5dcff', rate: 0.60,  dupShards: 20 }
  };
  NG.RARITY_ORDER = ['UR', 'SSR', 'SR', 'R'];

  // Base level-1, 1-star stats per rarity. Engine multiplies by ROLE_MULT and char.stats.
  NG.RARITY_BASE = {
    UR:  { hp: 5800, atk: 570, def: 285 },
    SSR: { hp: 4700, atk: 460, def: 230 },
    SR:  { hp: 3800, atk: 370, def: 185 },
    R:   { hp: 3000, atk: 300, def: 150 }
  };

  /* ---------------- Roles (定位) ---------------- */
  NG.ROLES = {
    atk:  { name: '输出', color: '#e5484d', hp: 0.90, atk: 1.15, def: 0.90 },
    tank: { name: '防御', color: '#4a90e2', hp: 1.30, atk: 0.85, def: 1.30 },
    sup:  { name: '辅助', color: '#46b37a', hp: 1.00, atk: 0.95, def: 1.00 },
    ctrl: { name: '控制', color: '#9b59d0', hp: 1.00, atk: 1.00, def: 1.00 },
    heal: { name: '治疗', color: '#3fc1a5', hp: 1.05, atk: 0.90, def: 1.05 }
  };

  /* ---------------- Elements (查克拉性质) ---------------- */
  // beats: this element deals +25% damage to the listed one (五行相克: 火>风>雷>土>水>火; 阴<->阳 mutual).
  NG.ELEMENTS = {
    fire:      { name: '火', color: '#ff6a2b', beats: 'wind' },
    wind:      { name: '风', color: '#5fd6a6', beats: 'lightning' },
    lightning: { name: '雷', color: '#7fb8ff', beats: 'earth' },
    earth:     { name: '土', color: '#b08a5a', beats: 'water' },
    water:     { name: '水', color: '#3a8dff', beats: 'fire' },
    yin:       { name: '阴', color: '#8e6ad8', beats: 'yang' },
    yang:      { name: '阳', color: '#ffd24a', beats: 'yin' },
    none:      { name: '体', color: '#c9c9c9', beats: null }
  };
  NG.ELEMENT_BONUS = 0.25;

  /* ---------------- Skill slots ---------------- */
  NG.SKILL_KEYS = ['passive', 's1', 's2', 'ult', 'awaken'];
  NG.SKILL_LABELS = { passive: '被动', s1: '技能1', s2: '技能2', ult: '必杀技', awaken: '突破' };
  NG.AWAKEN_STAR = 4;       // 突破 skill unlocks at this star
  NG.MAX_STAR = 6;
  NG.MAX_SKILL_LV = 10;
  NG.STAR_LEVEL_CAP = [0, 100, 160, 220, 280, 340, 400]; // index = star
  NG.STAR_SHARD_COST = [0, 20, 40, 60, 80, 100];          // shards to go from star i -> i+1

  /* ---------------- Skill tags (技能标签) shown as chips ---------------- */
  NG.TAGS = {
    '输出': '#e5484d', '爆发': '#f08c2e', '增益': '#3fb950', '消耗': '#3aa0d8',
    '护盾': '#e0a31a', '斩杀': '#a347d1', '控制': '#19b5c9', '治疗': '#44c28a',
    '减益': '#8a6d5a', '群攻': '#d6336c', '持续': '#a0673a', '吸血': '#c0392b',
    '复活': '#e8c547', '嘲讽': '#7f8c9a', '闪避': '#38c6d9', '封印': '#6741d9',
    '反击': '#e8590c', '净化': '#4dabf7', '穿透': '#ff6b6b', '召唤': '#20a39e',
    '单体': '#d9534f', '回能': '#228be6'
  };

  /* ---------------- Skill visual FX ----------------
   * n: Chinese name, c1/c2: primary/secondary colors, fam: battle animation family, k: glyph.
   * fam ∈ slash | burst | beam | projectile | aoe | genjutsu | buff | heal | summon | shield
   */
  NG.FX = {
    fire:      { n: '火遁', c1: '#ff7b00', c2: '#ffd54f', fam: 'burst',      k: '火' },
    wind:      { n: '风遁', c1: '#6fe0b8', c2: '#e6fff6', fam: 'slash',      k: '风' },
    lightning: { n: '雷遁', c1: '#6ec6ff', c2: '#ffffff', fam: 'beam',       k: '雷' },
    water:     { n: '水遁', c1: '#2196f3', c2: '#b3e5fc', fam: 'aoe',        k: '水' },
    earth:     { n: '土遁', c1: '#8d6e63', c2: '#e0cfc4', fam: 'aoe',        k: '土' },
    wood:      { n: '木遁', c1: '#5cae4f', c2: '#c5e1a5', fam: 'aoe',        k: '木' },
    sand:      { n: '沙遁', c1: '#d4a85a', c2: '#f3e0b5', fam: 'aoe',        k: '沙' },
    ice:       { n: '冰遁', c1: '#9fdcff', c2: '#ffffff', fam: 'projectile', k: '冰' },
    lava:      { n: '熔遁', c1: '#ff5722', c2: '#ffab40', fam: 'aoe',        k: '熔' },
    boil:      { n: '沸遁', c1: '#ffab91', c2: '#ffffff', fam: 'aoe',        k: '沸' },
    scorch:    { n: '灼遁', c1: '#ff9100', c2: '#fff3e0', fam: 'burst',      k: '灼' },
    storm:     { n: '岚遁', c1: '#4fc3f7', c2: '#e1f5fe', fam: 'beam',       k: '岚' },
    dust:      { n: '尘遁', c1: '#e8e8e8', c2: '#ffffff', fam: 'beam',       k: '尘' },
    explosion: { n: '爆遁', c1: '#ffca28', c2: '#ff7043', fam: 'burst',      k: '爆' },
    magnet:    { n: '磁遁', c1: '#546e7a', c2: '#b0bec5', fam: 'aoe',        k: '磁' },
    yin:       { n: '阴遁', c1: '#7e57c2', c2: '#d1c4e9', fam: 'genjutsu',   k: '阴' },
    yang:      { n: '阳遁', c1: '#ffd54f', c2: '#fff8e1', fam: 'buff',       k: '阳' },
    genjutsu:  { n: '幻术', c1: '#ab47bc', c2: '#f3e5f5', fam: 'genjutsu',   k: '幻' },
    eye:       { n: '瞳术', c1: '#e53935', c2: '#2b0d0d', fam: 'genjutsu',   k: '瞳' },
    amaterasu: { n: '天照', c1: '#1a1a1a', c2: '#9c27b0', fam: 'burst',      k: '照' },
    kamui:     { n: '神威', c1: '#5e35b1', c2: '#140a26', fam: 'genjutsu',   k: '威' },
    susanoo:   { n: '须佐能乎', c1: '#7c4dff', c2: '#c9b3ff', fam: 'slash',  k: '须' },
    rasengan:  { n: '螺旋丸', c1: '#40c4ff', c2: '#e1f5fe', fam: 'burst',    k: '螺' },
    chidori:   { n: '千鸟', c1: '#82b1ff', c2: '#ffffff', fam: 'beam',       k: '鸟' },
    sage:      { n: '仙术', c1: '#ff9800', c2: '#fff176', fam: 'buff',       k: '仙' },
    bijuu:     { n: '尾兽玉', c1: '#ff3d00', c2: '#2b0000', fam: 'beam',     k: '兽' },
    truth:     { n: '求道玉', c1: '#1c1c1c', c2: '#bdbdbd', fam: 'projectile', k: '道' },
    blade:     { n: '剑术', c1: '#cfd8dc', c2: '#ffffff', fam: 'slash',      k: '剑' },
    fist:      { n: '体术', c1: '#ff7043', c2: '#ffccbc', fam: 'slash',      k: '体' },
    gate:      { n: '八门遁甲', c1: '#ff1744', c2: '#69f0ae', fam: 'buff',   k: '门' },
    shuriken:  { n: '手里剑', c1: '#90a4ae', c2: '#eceff1', fam: 'projectile', k: '镖' },
    insect:    { n: '寄坏虫', c1: '#5d4037', c2: '#a1887f', fam: 'aoe',      k: '虫' },
    puppet:    { n: '傀儡术', c1: '#8d6e63', c2: '#d7ccc8', fam: 'projectile', k: '傀' },
    poison:    { n: '毒', c1: '#7cb342', c2: '#dcedc8', fam: 'aoe',          k: '毒' },
    paper:     { n: '纸遁', c1: '#e0e0e0', c2: '#ffffff', fam: 'projectile', k: '纸' },
    ink:       { n: '超兽伪画', c1: '#212121', c2: '#757575', fam: 'projectile', k: '墨' },
    shadow:    { n: '影术', c1: '#263238', c2: '#607d8b', fam: 'genjutsu',   k: '影' },
    mind:      { n: '心转身', c1: '#ffeb3b', c2: '#fff9c4', fam: 'genjutsu',  k: '心' },
    heal:      { n: '医疗忍术', c1: '#69f0ae', c2: '#e8f5e9', fam: 'heal',   k: '医' },
    seal:      { n: '封印术', c1: '#ffd740', c2: '#fff8e1', fam: 'genjutsu', k: '封' },
    summon:    { n: '通灵术', c1: '#ffb74d', c2: '#ffffff', fam: 'summon',   k: '灵' },
    bone:      { n: '尸骨脉', c1: '#f5f5f5', c2: '#bdbdbd', fam: 'slash',    k: '骨' },
    beast:     { n: '牙', c1: '#a1887f', c2: '#efebe9', fam: 'slash',        k: '牙' },
    chakra:    { n: '查克拉', c1: '#40c4ff', c2: '#80d8ff', fam: 'beam',     k: '气' },
    gravity:   { n: '神罗天征', c1: '#9575cd', c2: '#1a1033', fam: 'aoe',    k: '引' },
    sound:     { n: '音忍术', c1: '#7986cb', c2: '#e8eaf6', fam: 'aoe',      k: '音' },
    clone:     { n: '影分身', c1: '#ffcc80', c2: '#fff3e0', fam: 'summon',   k: '分' },
    space:     { n: '时空间', c1: '#ffe14d', c2: '#2a2a2a', fam: 'projectile', k: '空' },
    web:       { n: '蜘蛛丝', c1: '#fafafa', c2: '#ffd54f', fam: 'projectile', k: '丝' },
    snake:     { n: '蛇', c1: '#7e57c2', c2: '#b39ddb', fam: 'projectile',   k: '蛇' },
    shield:    { n: '防御', c1: '#ffd54f', c2: '#fff8e1', fam: 'shield',     k: '盾' }
  };

  /* ---------------- Battle data vocabularies (validated by tools/validate.js) ---------------- */
  NG.TARGETS = ['single', 'all', 'random', 'lowest', 'highest_atk', 'back',
                'self', 'ally_lowest', 'ally_all', 'ally_random'];
  NG.EFFECT_TYPES = ['dmg', 'true_dmg', 'heal', 'shield', 'buff', 'debuff', 'status', 'execute',
                     'chakra', 'drain', 'lifesteal', 'cleanse', 'dispel', 'revive', 'taunt',
                     'counter', 'immune'];
  NG.EFFECT_TO = ['target', 'self', 'ally_all', 'ally_lowest', 'ally_random', 'ally_dead',
                  'enemy_all', 'enemy_random', 'attacker'];
  NG.BUFF_STATS = ['atk', 'def', 'spd', 'crit', 'critDmg', 'dmg', 'dr', 'dodge'];
  NG.STATUSES = {
    stun:    { name: '眩晕', kind: 'control', color: '#ffd54f' },
    freeze:  { name: '冰冻', kind: 'control', color: '#9fdcff' },
    sleep:   { name: '睡眠', kind: 'control', color: '#b39ddb' },  // breaks when damaged
    bind:    { name: '束缚', kind: 'control', color: '#8d6e63' },
    silence: { name: '封印', kind: 'silence', color: '#7e57c2' },  // can only use s1
    burn:    { name: '灼烧', kind: 'dot',     color: '#ff6a2b' },
    poison:  { name: '中毒', kind: 'dot',     color: '#7cb342' },
    bleed:   { name: '流血', kind: 'dot',     color: '#d32f2f' }
  };
  NG.PASSIVE_STATS = ['hp', 'atk', 'def', 'spd', 'crit', 'critDmg', 'dodge', 'dr', 'dmg', 'lifesteal'];
  NG.TRIGGERS = ['battle_start', 'turn_start', 'on_attack', 'on_hit', 'on_kill', 'low_hp',
                 'on_ult', 'on_death', 'on_ally_death'];

  /* ---------------- Art vocabularies (implemented by js/art.js) ---------------- */
  NG.ART = {
    hair: ['spiky', 'spiky_up', 'duck', 'duck_long', 'fringe_spiky', 'long_straight', 'hime',
           'low_ponytail', 'high_ponytail', 'long_bang', 'pineapple', 'bowl', 'buns', 'bob',
           'wavy_long', 'short', 'messy', 'slick_back', 'buzz', 'bald', 'hood', 'wild_long',
           'very_long', 'twin_tails', 'quad', 'flower', 'shaggy', 'straight_bangs', 'helmet', 'none'],
    eyes: ['normal', 'sharingan', 'ms_sasuke', 'ms_itachi', 'ms_obito', 'ms_madara', 'ms_shisui',
           'ms_eternal', 'ms_izuna', 'rinnegan', 'rinne_sharingan', 'byakugan', 'sage', 'kurama',
           'six_paths', 'snake', 'closed', 'blank', 'dark', 'beast', 'puppet', 'tomoe_rinnegan',
           'sharingan_2tomoe', 'ms_indra'],
    outfit: ['jacket', 'flak', 'highcollar', 'robe', 'akatsuki', 'kage', 'haori_flame', 'armor',
             'kimono', 'anbu', 'bodysuit', 'sleeveless', 'qipao', 'coat', 'six_paths', 'otsutsuki',
             'samurai', 'mesh', 'bandage', 'cloak', 'shirt', 'chakra_cloak'],
    headband: ['konoha', 'suna', 'kiri', 'kumo', 'iwa', 'oto', 'ame', 'taki', 'allied', 'none', 'yu'],
    headbandPos: ['forehead', 'neck', 'arm', 'hair', 'belt', 'bandana'],
    marks: ['whiskers', 'fangs', 'tear_lines', 'ai_tattoo', 'diamond', 'face_paint', 'nose_scar',
            'eye_scar', 'chin_x', 'glasses', 'sunglasses', 'piercings', 'stitches', 'bandage_face',
            'beard', 'goatee', 'mustache', 'sage_marks', 'curse_mark', 'gills', 'purple_eyeliner',
            'forehead_dots', 'lip_piercing', 'eye_bandage', 'swirl_cheeks', 'b_tattoo', 'third_eye',
            'red_lips', 'wrinkles', 'face_lines', 'kurama_marks', 'cheek_scar', 'blue_skin_marks',
            'edo_cracks', 'thick_brows', 'eye_rings', 'cheek_rects', 'caged_bird_seal', 'sharp_teeth',
            'burn_scar'],
    mask: ['none', 'lower', 'spiral', 'war_mask', 'anbu', 'cloth', 'zetsu', 'puppet_mouth'],
    hat: ['none', 'hokage', 'kazekage', 'mizukage', 'raikage', 'tsuchikage', 'straw',
          'samurai_helm', 'horns', 'hood_up', 'bandana_cap'],
    accessory: ['none', 'gourd', 'sword', 'big_sword', 'samehada', 'fan', 'scroll', 'puppet',
                'scythe', 'staff', 'kunai', 'umbrella', 'gunbai', 'truth_orbs', 'dog', 'clay',
                'chakra_blades', 'tanto', 'kiseru', 'flute', 'paintbrush',
                'goggles', 'scarf', 'cigarette', 'senbon', 'lollipop', 'bow', 'fuma_shuriken', 'chakra_rods'],
    beast: ['tanuki', 'cat', 'turtle', 'monkey', 'horse', 'slug', 'beetle', 'ox', 'fox', 'juubi',
            'toad', 'snake', 'dog'],
    type: ['human', 'beast']
  };

  /* ---------------- Character registry ---------------- */
  NG.CHARS = NG.CHARS || [];
  NG.CHAR_MAP = NG.CHAR_MAP || {};
  NG.DATA_FILES = NG.DATA_FILES || [];

  NG.defineChars = function (fileId, list) {
    if (Array.isArray(fileId)) { list = fileId; fileId = 'unknown'; }
    NG.DATA_FILES.push(fileId);
    (list || []).forEach(function (c) {
      if (!c || !c.id) { console.warn('[NG] char without id in', fileId); return; }
      if (NG.CHAR_MAP[c.id]) { console.warn('[NG] duplicate char id', c.id, 'in', fileId); return; }
      c._file = fileId;
      NG.CHARS.push(c);
      NG.CHAR_MAP[c.id] = c;
    });
  };

  NG.getChar = function (id) { return NG.CHAR_MAP[id] || null; };

  /* Display name helper: "宇智波佐助·须佐能乎" */
  NG.fullName = function (c) { return c ? (c.form ? c.name + '·' + c.form : c.name) : ''; };

  /* Number formatting in Chinese units: 9999 / 1000.3万 / 42.0亿 */
  NG.fmt = function (n) {
    n = Math.floor(Number(n) || 0);
    var neg = n < 0; if (neg) n = -n;
    var s;
    if (n >= 1e12) s = (n / 1e12).toFixed(1) + '万亿';
    else if (n >= 1e8) s = (n / 1e8).toFixed(1) + '亿';
    else if (n >= 1e4) s = (n / 1e4).toFixed(1) + '万';
    else s = String(n);
    return (neg ? '-' : '') + s;
  };

  /* Tiny event bus shared by engine and UI. */
  var listeners = {};
  NG.on = function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
  NG.off = function (ev, fn) { listeners[ev] = (listeners[ev] || []).filter(function (f) { return f !== fn; }); };
  NG.emit = function (ev, data) { (listeners[ev] || []).slice().forEach(function (f) { try { f(data); } catch (e) { console.error(e); } }); };
})(typeof window !== 'undefined' ? window : globalThis);
