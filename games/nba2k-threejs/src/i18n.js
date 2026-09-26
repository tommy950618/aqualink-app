// All user-visible strings (spec section 13). Simplified Chinese is the default; English is the fallback.
// Safe to import in Node: every document/localStorage access is guarded.

const STORAGE_KEY = 'hoop.lang';
const DEFAULT_LANG = 'zh';

export const STRINGS = {
  zh: {
    'app.title': '街头篮球场 3x3',
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
    'hud.q': '第{n}节',
    'hud.ot': '加时',
    'hud.ot2': '加时{n}',
    'hud.shotClock': '进攻时间',
    'meter.perfect': '完美',
    'meter.early': '稍早',
    'meter.late': '稍晚',
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
    'cap.dunk': '{name} 灌篮！',
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
    'stats.stl': '抢断',
    'stats.blk': '盖帽',
  },
  en: {
    'app.title': 'HOOP ARENA 3x3',
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
    'hud.q': 'Q{n}',
    'hud.ot': 'OT',
    'hud.ot2': 'OT{n}',
    'hud.shotClock': 'Shot',
    'meter.perfect': 'PERFECT',
    'meter.early': 'EARLY',
    'meter.late': 'LATE',
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
    'cap.dunk': '{name} DUNKS!',
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
    'stats.tp': '3PM',
    'stats.reb': 'REB',
    'stats.stl': 'STL',
    'stats.blk': 'BLK',
  },
};

const listeners = [];
let lang = readStored() || DEFAULT_LANG;

function hasDom() {
  return typeof document !== 'undefined' && document && typeof document.querySelectorAll === 'function';
}

function readStored() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(STORAGE_KEY);
    return v && STRINGS[v] ? v : null;
  } catch (e) {
    return null;
  }
}

function writeStored(l) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, l);
  } catch (e) {
    // Private mode or blocked storage: the choice simply does not persist.
  }
}

function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined && params[k] !== null ? String(params[k]) : m));
}

// Look up key in the current language, then English, then return the key itself.
export function t(key, params) {
  const table = STRINGS[lang];
  let text = table && table[key];
  if (text === undefined) text = STRINGS.en[key];
  if (text === undefined) return key;
  return interpolate(text, params);
}

export function getLang() {
  return lang;
}

// Switch language (ignored for unknown codes), persist it, re-label the DOM and notify listeners.
export function setLang(l) {
  if (!STRINGS[l]) return lang;
  const changed = l !== lang;
  lang = l;
  writeStored(l);
  if (hasDom()) {
    if (document.documentElement) document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
    applyDom(document);
  }
  if (changed) for (let i = 0; i < listeners.length; i++) listeners[i](lang);
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
  } catch (e) {
    return undefined;
  }
}

function applyTo(el) {
  const key = el.getAttribute('data-i18n');
  if (!key) return;
  const text = t(key, paramsOf(el));
  if (el.textContent !== text) el.textContent = text;
}

// Set textContent of every [data-i18n] element under root (and root itself if it carries the attribute).
// Optional data-i18n-params holds a JSON object for {placeholders}.
export function applyDom(root) {
  if (!hasDom()) return;
  const r = root || document;
  if (r !== document && typeof r.getAttribute === 'function' && r.hasAttribute('data-i18n')) applyTo(r);
  const nodes = r.querySelectorAll('[data-i18n]');
  for (let i = 0; i < nodes.length; i++) applyTo(nodes[i]);
}

// Register a callback (lang) => void; returns an unsubscribe function.
export function onLangChange(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}
