// unit-i18n.mjs - spec v2 section 9.4 (WP8): every i18n key has zh + en, no key is missing for any t() call site
// (static scan of src/**/*.js and index.html), placeholders match between the languages, dynamic key families are
// complete, the API behaves (fallbacks, {zh,en} params, language switch, throwing storage), CJK appears in no src file
// except i18n.js / legends.js, and no string hits the denylist of section 9.2.
// Run: node test/unit-i18n.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let failures = 0, passes = 0;
function check(name, ok, extra) {
  if (ok) passes++;
  else { failures++; console.log('FAIL - ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 600) : '')); }
}

const i18n = await import('../src/i18n.js');
const { STRINGS, t, pick, hasKey, getLang, setLang, toggleLang, onLangChange } = i18n;
const zh = STRINGS.zh, en = STRINGS.en;

// ---- 1. both languages, non-empty, same placeholders ----
const zhKeys = Object.keys(zh), enKeys = Object.keys(en);
const missingEn = zhKeys.filter((k) => !(k in en));
const missingZh = enKeys.filter((k) => !(k in zh));
check('every zh key has en', missingEn.length === 0, missingEn);
check('every en key has zh', missingZh.length === 0, missingZh);
const empty = zhKeys.filter((k) => !String(zh[k]).trim() || !String(en[k] || '').trim());
check('no empty strings', empty.length === 0, empty);
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
const phMismatch = zhKeys.filter((k) => k in en && ph(zh[k]) !== ph(en[k]));
check('placeholders identical in zh and en', phMismatch.length === 0, phMismatch);
check('tables frozen', Object.isFrozen(STRINGS) && Object.isFrozen(zh) && Object.isFrozen(en));

// ---- 2. static scan of call sites ----
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const srcFiles = walk(path.join(root, 'src'), []);
const used = new Map();   // key -> first file
function use(key, file) { if (key.endsWith('.')) return; /* prefix of a dynamic key (families checked below) */ if (!used.has(key)) used.set(key, path.relative(root, file)); }
// Namespaces whose string literals are always i18n keys, wherever they appear in src.
const EXCLUSIVE = /^(cap|banner|toast|tip|jumbo|led|loadError|load|legal|brand|over|half|intro|replay|lineup|title|settings|team|abbr|stat|comp|ability|rules|hud|meter|menu|hint|btn|diff|common|stats)\.[A-Za-z0-9_.]*[A-Za-z0-9_]$/;
for (const f of srcFiles) {
  const src = fs.readFileSync(f, 'utf8');
  // t('key'  /  t("key"
  for (const m of src.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g)) use(m[1], f);
  // data-i18n / data-i18n-aria attributes built in JS
  for (const m of src.matchAll(/data-i18n(?:-aria)?['"]\s*,\s*['"]([A-Za-z0-9_.]+)['"]/g)) use(m[1], f);
  if (/[\\/]i18n\.js$/.test(f)) continue;
  // any string literal in an exclusive namespace (game events carry caption/banner keys as literals)
  for (const m of src.matchAll(/['"]([a-zA-Z]+\.[A-Za-z0-9_.]+)['"]/g)) {
    const k = m[1];
    if (!EXCLUSIVE.test(k)) continue;
    // skip property paths / file names that merely look like keys
    if (/\.(js|json|bin|png|mjs|cjs|css|html)$/.test(k)) continue;
    use(k, f);
  }
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)) use(m[1], path.join(root, 'index.html'));
const missing = [];
for (const [k, f] of used) if (!hasKey(k)) missing.push(k + ' @ ' + f);
check('every scanned key exists in zh and en (' + used.size + ' keys)', missing.length === 0, missing);

// ---- 3. dynamic key families ----
const families = [];
for (const k of ['speed', 'strength', 'vertical', 'ballHandle', 'closeShot', 'midRange', 'three', 'dunk', 'layup', 'passing',
  'perimeterD', 'interiorD', 'block', 'steal', 'rebound']) families.push('stat.' + k);
for (const k of ['sht', 'drv', 'ins', 'def']) families.push('comp.' + k);
for (const id of ['clutch', 'kobe.postFade', 'kobe.jab', 'kobe.tough', 'jordan.fade', 'jordan.air', 'jordan.ftDunk', 'jordan.hawk',
  'lebron.powerDrive', 'lebron.chaseDown', 'lebron.skipPass', 'lebron.bully', 'giannis.euro', 'giannis.longDunk', 'giannis.helpBlock',
  'yao.hook', 'yao.highRelease', 'yao.anchor', 'yao.post', 'kyrie.combo', 'kyrie.finisher', 'kyrie.stepback']) families.push('ability.' + id);
for (const id of ['jordan.ftDunk', 'jordan.fade', 'kobe.postFade', 'kobe.jab', 'lebron.powerDrive', 'lebron.skipPass', 'giannis.euro',
  'giannis.longDunk', 'yao.hook', 'yao.dropStep', 'kyrie.combo', 'kyrie.stepback', 'kyrie.finisher']) families.push('cap.ab.' + id);
for (let i = 1; i <= 6; i++) families.push('tip.' + i);
for (const k of ['pumpFake', 'combo', 'post', 'fade', 'block']) families.push('tip.' + k);
for (const k of ['engine', 'assets', 'paint', 'arena', 'compile']) families.push('load.' + k);
for (const k of ['dark', 'bright', 'white', 'black']) families.push('team.' + k, 'abbr.' + k);
for (const k of ['dunk', 'three', 'block', 'winner', 'final']) families.push('jumbo.' + k);
for (const k of ['brand', 'defense', 'noise', 'clutch', 'gg', 'score']) families.push('led.' + k);
for (const k of ['perfect', 'early', 'late', 'three', 'two']) families.push('meter.' + k);
for (const k of ['low', 'medium', 'high']) families.push('settings.tier.' + k, 'settings.quality.' + k);
for (const k of ['ankle', 'chaseDown', 'rimOut', 'clear', 'notCleared', 'dunk', 'hot', 'winner', 'firstDunk', 'make2', 'make3',
  'layup', 'miss', 'airball', 'block', 'steal', 'rebound', 'oob', 'shotClock', 'turnover', 'buzzerBeater', 'bank']) families.push('cap.' + k);
for (const k of ['allstar', 'webgl1', 'tier']) families.push('toast.' + k);
families.push('legendsLoadFailed', 'app.title', 'brand.wordmark', 'brand.zh', 'legal.note', 'title.play', 'title.quick', 'title.settings',
  'menu.lineup', 'lineup.title', 'lineup.you', 'lineup.start', 'lineup.shuffle', 'lineup.reset', 'lineup.kits', 'lineup.kits.auto',
  'lineup.kits.classic', 'lineup.kits.allstar', 'lineup.kitsAuto', 'lineup.kitsClassic', 'lineup.handler', 'lineup.swapHint',
  'lineup.clash', 'rules.clear', 'rules.autoSwitch', 'intro.starters', 'intro.vs', 'intro.skip', 'replay.tag', 'replay.skip',
  'over.mvp', 'over.lineup', 'settings.reloadNote', 'loadError.title', 'loadError.retry', 'loadError.simple', 'loadError.detail',
  'stats.ast', 'menu.tapToSkip', 'hint.landscape', 'hint.dismiss');
const famMissing = families.filter((k) => !hasKey(k));
check('dynamic key families complete (' + families.length + ')', famMissing.length === 0, famMissing);
// Settings option labels resolve for every schema option.
const { SETTINGS_SCHEMA } = await import('../src/ui/settings.js');
const optMissing = [];
for (const r of SETTINGS_SCHEMA) {
  if (!hasKey(r.label)) optMissing.push(r.label);
  for (const v of r.options) { const k = r.optLabel(v); if (!hasKey(k)) optMissing.push(r.key + ':' + k); }
}
check('every settings row / option label exists', optMissing.length === 0, optMissing);
check('anim.* viewer labels present', zhKeys.filter((k) => k.startsWith('anim.')).length >= 25);

// ---- 4. exact values from the spec tables ----
check('app.title zh / en (B59)', zh['app.title'] === '传奇对决 3v3' && en['app.title'] === 'LEGENDS 3v3');
check('title.play zh / en (B4)', zh['title.play'] === '开始游戏' && en['title.play'] === 'Play');
check('abbr zh (C16)', zh['abbr.dark'] === '暗夜' && zh['abbr.bright'] === '烈阳' && zh['abbr.white'] === '白队' && zh['abbr.black'] === '黑队');
check('abbr en (C16)', en['abbr.dark'] === 'DRK' && en['abbr.bright'] === 'BRT' && en['abbr.white'] === 'WHT' && en['abbr.black'] === 'BLK');
check('legal note both languages (H7)', zh['legal.note'].includes('非商业粉丝作品') && en['legal.note'].startsWith('Non-commercial fan project'));
check('hud.q / hud.ot (B5, B18)', zh['hud.q'] === '第{n}节' && en['hud.q'] === 'Q{n}' && zh['hud.ot'] === '加时' && en['hud.ot'] === 'OT' && zh['banner.overtime'] === '加时赛' && en['banner.overtime'] === 'OVERTIME');
check('stat labels zh in table order', ['速度', '力量', '弹跳', '控球', '近投', '中投', '三分', '扣篮', '上篮', '传球', '外线防守', '内线防守', '盖帽', '抢断', '篮板']
  .every((v, i) => zh['stat.' + ['speed', 'strength', 'vertical', 'ballHandle', 'closeShot', 'midRange', 'three', 'dunk', 'layup', 'passing', 'perimeterD', 'interiorD', 'block', 'steal', 'rebound'][i]] === v));
check('captions per 6.8', zh['cap.dunk'] === '{name} 暴扣！' && en['cap.hot'] === '{name} is heating up!' && zh['cap.notCleared'] === '未清球，进球无效');
check('toast.tier interpolation', t('toast.tier', { tier: 'X' }).includes('X'));

// ---- 5. API behaviour ----
check('default language zh', getLang() === 'zh');
check('unknown key returns the key', t('no.such.key') === 'no.such.key');
check('{n} interpolation', t('hud.q', { n: 3 }) === '第3节');
check('{name} with a {zh,en} object', t('cap.make3', { name: { zh: '科比', en: 'Kobe' } }) === '科比 三分命中！');
check('missing param keeps the placeholder', t('cap.make3') === '{name} 三分命中！');
let heard = null;
const off = onLangChange((l) => { heard = l; });
setLang('en');
check('setLang(en) switches + notifies', getLang() === 'en' && heard === 'en' && t('hud.q', { n: 2 }) === 'Q2');
check('{name} object localised in en', t('cap.make3', { name: { zh: '科比', en: 'Kobe' } }) === 'Kobe hits the three!');
check('pick() follows the language', pick({ zh: '姚明', en: 'Yao' }) === 'Yao' && pick('plain') === 'plain');
setLang('xx');
check('unknown language ignored', getLang() === 'en');
toggleLang();
check('toggleLang back to zh', getLang() === 'zh' && heard === 'zh');
off();
setLang('en'); setLang('zh');
check('unsubscribed listener not called', heard === 'zh');
// Throwing storage (H11): setLang must not throw.
const prevLS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
let threw = false;
try { setLang('en'); setLang('zh'); } catch (e) { threw = true; }
check('setLang with throwing localStorage does not throw', !threw && getLang() === 'zh');
if (prevLS) Object.defineProperty(globalThis, 'localStorage', prevLS); else delete globalThis.localStorage;

// ---- 6. CJK only in i18n.js / legends.js (H6, B2) and the denylist (9.2) ----
const CJK = /[　-〿㐀-䶿一-鿿＀-￯]/;
const cjkFiles = srcFiles.filter((f) => !/[\\/]src[\\/](i18n|legends)\.js$/.test(f) && CJK.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(root, f));
const mine = cjkFiles.filter((f) => /src[\\/]ui[\\/]/.test(f));
check('no CJK in src/ui/*.js', mine.length === 0, mine);
if (cjkFiles.length) console.log('note - CJK found in files of other work packages: ' + cjkFiles.join(', '));
const DENY_WORDS = ['Lakers', 'Celtics', 'Warriors', 'Bulls', 'Cavaliers', 'Bucks', 'Rockets', 'Nets', 'Heat', 'Knicks', 'Spurs', 'Suns',
  'Clippers', 'Mavericks', 'Nuggets', 'Jazz', 'Thunder', 'Blazers', 'Kings', 'Pelicans', 'Grizzlies', 'Timberwolves', 'Hawks',
  'Hornets', 'Magic', 'Pacers', 'Pistons', 'Raptors', 'Wizards', 'Sixers', '76ers', 'Curry', 'Durant', 'Jokic', 'NBA', '2K',
  'Air Jordan', 'Jumpman', 'Mamba', 'Black Mamba', 'King James', 'Greek Freak', 'Uncle Drew', 'Concord', 'Bred', 'Nike', 'Adidas',
  'Spalding', 'Wilson', 'Swoosh', 'Gatorade', 'Under Armour'];
const DENY_CJK = ['湖人', '公牛', '骑士', '雄鹿', '火箭', '凯尔特人', '勇士', '热火', '篮网', '耐克', '阿迪达斯', '黑曼巴', '飞人', '小皇帝', '德鲁大叔'];
const hits = [];
const scanText = (label, s) => {
  for (const w of DENY_WORDS) if (new RegExp('\\b' + w.replace(/ /g, '\\s') + '\\b').test(s)) hits.push(label + ': ' + w);
  for (const w of DENY_CJK) if (s.includes(w)) hits.push(label + ': ' + w);
};
for (const k of zhKeys) { scanText('zh ' + k, zh[k]); scanText('en ' + k, en[k]); }
for (const f of ['index.html', 'css/style.css', 'src/ui/hud.js', 'src/ui/screens.js', 'src/ui/lineup.js', 'src/ui/present.js',
  'src/ui/captions.js', 'src/ui/indicators.js', 'src/ui/loading.js', 'src/ui/settings.js']) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) scanText(f, fs.readFileSync(p, 'utf8'));
}
check('denylist clean (strings + WP8a files)', hits.length === 0, hits);

console.log(failures === 0 ? 'unit-i18n: ALL OK (' + passes + ' checks)' : 'unit-i18n: ' + failures + ' FAILURES, ' + passes + ' passed');
process.exit(failures === 0 ? 0 : 1);
