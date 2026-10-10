// unit-present.mjs - spec v2 section 9.4 (WP8): MVP formula and tie-breaks (6.5.9), display composites and card stat
// chips (2.4, through legends.js), team styles (2.9), kit chip colours (2.7), MatchView names and duplicate-number
// indicator labels (6.4.3), box-score row flattening, and the settings model: schema defaults (6.5.10), validation,
// try/catch persistence with a throwing storage (H11), v1 keys for sound, URL session overrides, kits adapter (C17).
// Run: node test/unit-present.mjs
import { mvpScore, pickMvp, kitColours, TEAM_STYLE, normTeamKey, MatchView, fmtHeight } from '../src/ui/present.js';
import { boxRow } from '../src/ui/screens.js';
import { SETTINGS_SCHEMA, SETTINGS_KEY, CROWD_GAIN, defaultSettings, loadSettings, saveSettings, parseUrlOverrides, Settings } from '../src/ui/settings.js';
import { LEGENDS, composites, topStats } from '../src/legends.js';
import { setLang, getLang } from '../src/i18n.js';

let failures = 0, passes = 0;
function check(name, ok, extra) {
  if (ok) passes++;
  else { failures++; console.log('FAIL - ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}

// ---- MVP (6.5.9) ----
const row = (id, team, index, s) => Object.assign({ id, team, index, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fga: 0, fgm: 0 }, s);
check('mvpScore formula', Math.abs(mvpScore({ pts: 28, reb: 9, ast: 4, stl: 2, blk: 1, fga: 20, fgm: 11 }) - (28 + 10.8 + 6 + 6 + 3 - 7.2)) < 1e-9);
check('mvpScore missing fields = 0', mvpScore({ pts: 10 }) === 10);
{
  const rows = [
    row('lebron', 0, 0, { pts: 20, reb: 8, ast: 6, fga: 15, fgm: 8 }),      // 20 + 9.6 + 9 - 5.6 = 33.0
    row('kyrie', 0, 1, { pts: 26, reb: 2, ast: 3, fga: 18, fgm: 10 }),       // 26 + 2.4 + 4.5 - 6.4 = 26.5
    row('giannis', 0, 2, { pts: 14, reb: 12, blk: 2, fga: 10, fgm: 6 }),     // 14 + 14.4 + 6 - 3.2 = 31.2
    row('jordan', 1, 0, { pts: 40, reb: 9, ast: 9, stl: 4, fga: 20, fgm: 18 }),
    row('kobe', 1, 1, { pts: 10 }), row('yao', 1, 2, { pts: 8 }),
  ];
  check('MVP comes from the winning team only', pickMvp(rows, 0).id === 'lebron');
  check('MVP of team B', pickMvp(rows, 1).id === 'jordan');
}
{
  // equal score -> more PTS wins
  const rows = [row('kyrie', 0, 1, { pts: 20, reb: 0 }), row('giannis', 0, 2, { pts: 14, reb: 5 })];   // 20 vs 14 + 6 = 20
  check('tie -> more PTS', Math.abs(mvpScore(rows[0]) - mvpScore(rows[1])) < 1e-9 && pickMvp(rows, 0).id === 'kyrie');
  // equal score and PTS -> lower roster index
  const rows2 = [row('giannis', 0, 2, { pts: 10, reb: 5 }), row('lebron', 0, 0, { pts: 10, stl: 2 })];   // 16 vs 16
  check('tie -> lower roster index', pickMvp(rows2, 0).id === 'lebron');
  check('no winner -> best of all rows', pickMvp([row('kobe', 1, 1, { pts: 3 }), row('yao', 0, 2, { pts: 9 })], null).id === 'yao');
  check('empty rows -> null', pickMvp([], 0) === null);
}

// ---- composites and stat chips (2.4) through legends.js ----
const TABLE = {
  kobe: [92, 90, 76, 72], jordan: [90, 94, 79, 78], lebron: [83, 92, 93, 81],
  giannis: [70, 90, 93, 86], yao: [66, 58, 91, 72], kyrie: [91, 86, 66, 53],
};
for (const id of Object.keys(TABLE)) {
  const c = composites(id);
  const got = [c.sht, c.drv, c.ins, c.def];
  check('composites ' + id, got.join() === TABLE[id].join(), got);
}
check('every legend has a composite >= 90', Object.keys(TABLE).every((id) => Math.max(...TABLE[id]) >= 90));
const kobeTop = topStats('kobe', 3);
check('Kobe chips: midRange 98 / layup 95 / perimeterD 93 (GP 12.2)', kobeTop.map((s) => s.key + s.value).join() === 'midRange98,layup95,perimeterD93', kobeTop);
const yaoTop = topStats('yao', 3);
check('Yao chips include interiorD 97 and block 96', yaoTop[0].key === 'interiorD' && yaoTop[1].key === 'block', yaoTop);
check('fmtHeight', fmtHeight(1.98) === '1.98' && fmtHeight(2.27) === '2.27' && fmtHeight(undefined) === '');

// ---- team styles and kits ----
check('TEAM_STYLE colours (2.9)', TEAM_STYLE.dark.bg === '#6F263D' && TEAM_STYLE.dark.text === '#FFB81C' && TEAM_STYLE.bright.bg === '#CE1141'
  && TEAM_STYLE.allstarA.bg === '#F4F4F1' && TEAM_STYLE.allstarA.text === '#1A1A1A' && TEAM_STYLE.allstarB.bg === '#121212' && TEAM_STYLE.allstarB.accent === '#CE1141');
check('TEAM_STYLE i18n keys', TEAM_STYLE.allstarA.nameKey === 'team.white' && TEAM_STYLE.allstarB.abbrKey === 'abbr.black');
check('normTeamKey', normTeamKey('dark') === 'dark' && normTeamKey('white') === 'allstarA' && normTeamKey({ id: 'allstarB' }) === 'allstarB'
  && normTeamKey('Team Bright') === 'bright' && normTeamKey(null, 'bright') === 'bright');
const kc = (id, m) => { const c = kitColours(LEGENDS[id], m); return c.bg + '/' + c.fg; };
check('classic kit chips (2.7)', kc('lebron', 'classic') === '#6F263D/#FFB81C' && kc('kobe', 'classic') === '#FDB927/#552583'
  && kc('giannis', 'classic') === '#00471B/#EEE1C6' && kc('jordan', 'classic') === '#CE1141/#FFFFFF');
check('All-Star chips (2.7)', kc('kobe', 'allstarA') === '#F4F4F1/#C9A227' && kc('yao', 'allstarB') === '#121212/#D22630');

// ---- MatchView ----
{
  setLang('zh');
  const m = new MatchView(LEGENDS);
  m.set({ lineup: { a: ['lebron', 'kyrie', 'giannis'], b: ['jordan', 'kobe', 'yao'], user: 'a', kits: 'auto' }, teams: { a: 'dark', b: 'bright' }, kits: { a: 'classic', b: 'classic' } });
  check('MatchView team names / abbr zh', m.teamName(0) === '暗夜队' && m.teamAbbr(1) === '烈阳' && m.teamOf('kobe') === 1 && m.rosterIndex('kobe') === 1);
  check('MatchView names zh', m.short('giannis') === '字母哥' && m.full('yao') === '姚明' && m.other('kobe') === 'Kobe Bryant' && m.number('kyrie') === '2');
  check('indicator label = number without duplicates', m.indicatorLabel('lebron') === '23' && m.indicatorLabel('jordan') === '23');
  setLang('en');
  check('MatchView en', m.teamName(0) === 'Team Dark' && m.teamAbbr(1) === 'BRT' && m.short('giannis') === 'Giannis' && m.other('kobe') === '科比·布莱恩特');
  const v0 = m.version;
  m.set({ lineup: { a: ['lebron', 'jordan', 'giannis'], b: ['kyrie', 'kobe', 'yao'], user: 'b', kits: 'auto' }, teams: { a: 'allstarA', b: 'allstarB' }, kits: { a: 'allstarA', b: 'allstarB' } });
  check('version bumps on set', m.version > v0);
  check('duplicate #23 on one team -> LE / JO (en)', m.indicatorLabel('lebron') === 'LE' && m.indicatorLabel('jordan') === 'JO', [m.indicatorLabel('lebron'), m.indicatorLabel('jordan')]);
  setLang('zh');
  check('duplicate #23 on one team -> first CJK char (zh)', m.indicatorLabel('lebron') === '詹' && m.indicatorLabel('jordan') === '乔', [m.indicatorLabel('lebron'), m.indicatorLabel('jordan')]);
  check('user team from lineup.user', m.userTeam === 1);
  check('All-Star chip colours via MatchView', m.kitColours('kobe').bg === '#121212' && m.kitMode('giannis') === 'allstarA');
  check('team names white / black', m.teamName(0) === '白队' && m.teamName(1) === '黑队');
  m.dispose();
}

// ---- box-score rows ----
{
  const r = boxRow({ id: 'kobe', team: 1, stats: { pts: 12, fgm: 5, fga: 9, tpm: 2, tpa: 4, reb: 3, ast: 1, stl: 0, blk: 0 } }, 4);
  check('boxRow flattens .stats', r.id === 'kobe' && r.team === 1 && r.pts === 12 && r.tpa === 4 && r.fga === 9 && r.order === 4);
  const r2 = boxRow({ playerId: 'yao', teamIdx: 0, pts: 4, fgm: 2, fga: 3 }, 0);
  check('boxRow flat + aliases, tpa unknown stays undefined', r2.id === 'yao' && r2.team === 0 && r2.tpa === undefined && r2.reb === 0);
}

// ---- settings (6.5.10) ----
const DEFAULTS = { quality: 'auto', lang: 'zh', sound: true, crowd: 'mid', camera: 'standard', difficulty: 'normal', quarter: 120,
  replays: 'dunks', intro: 'full', kits: 'auto', clear: false, autoSwitch: true };
check('schema rows in sheet order', SETTINGS_SCHEMA.map((r) => r.key).join() === 'quality,lang,sound,crowd,camera,difficulty,quarter,replays,intro,kits,clear,autoSwitch');
check('schema defaults (6.5.10)', SETTINGS_SCHEMA.every((r) => r.def === DEFAULTS[r.key]), SETTINGS_SCHEMA.map((r) => [r.key, r.def]));
check('quality options', SETTINGS_SCHEMA[0].options.join() === 'auto,low,medium,high');
check('quarter options 1/2/3/5 min', SETTINGS_SCHEMA.find((r) => r.key === 'quarter').options.join() === '60,120,180,300');
check('pause exposure (C28): difficulty/clear/autoSwitch read-only, quarter/intro/kits title only',
  ['difficulty', 'clear', 'autoSwitch'].every((k) => SETTINGS_SCHEMA.find((r) => r.key === k).pause === 'ro')
  && ['quarter', 'intro', 'kits'].every((k) => SETTINGS_SCHEMA.find((r) => r.key === k).pause === 'hide')
  && ['quality', 'lang', 'sound', 'crowd', 'camera', 'replays'].every((k) => SETTINGS_SCHEMA.find((r) => r.key === k).pause === 'edit'));
check('crowd gains', CROWD_GAIN.low === 0.4 && CROWD_GAIN.mid === 0.7 && CROWD_GAIN.high === 1.0);
check('storage key', SETTINGS_KEY === 'legends3v3.settings.v2');

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };

check('defaultSettings', JSON.stringify(defaultSettings()) === JSON.stringify({ quality: 'auto', crowd: 'mid', camera: 'standard', difficulty: 'normal', quarter: 120, replays: 'dunks', intro: 'full', clear: false, autoSwitch: true }));
check('loadSettings with throwing storage -> defaults', JSON.stringify(loadSettings(throwing)) === JSON.stringify(defaultSettings()));
check('loadSettings with null storage -> defaults', loadSettings(null).quality === 'auto');
check('saveSettings with throwing storage -> false, no throw', saveSettings(defaultSettings(), throwing) === false);
{
  const st = memStorage();
  st.setItem(SETTINGS_KEY, '{not json');
  check('corrupt JSON -> defaults', loadSettings(st).camera === 'standard');
  st.setItem(SETTINGS_KEY, JSON.stringify({ camera: 'close', quarter: 77, crowd: 'loud', difficulty: 'hard' }));
  const v = loadSettings(st);
  check('invalid fields fall back individually', v.camera === 'close' && v.quarter === 120 && v.crowd === 'mid' && v.difficulty === 'hard');
}
{
  const st = memStorage();
  const s = new Settings({ storage: st });
  let heard = [];
  s.onChange((k, v) => heard.push(k + '=' + v));
  check('Settings defaults', s.get('quality') === 'auto' && s.get('sound') === true && s.get('kits') === 'auto' && s.get('lang') === getLang());
  check('set valid value', s.set('camera', 'high') === true && s.get('camera') === 'high' && JSON.parse(st.getItem(SETTINGS_KEY)).camera === 'high');
  check('set invalid value ignored', s.set('camera', 'drone') === false && s.get('camera') === 'high');
  check('crowdGain', s.set('crowd', 'low') && s.crowdGain() === 0.4);
  s.set('sound', false);
  check('sound uses the v1 audio key hoop.muted', st.getItem('hoop.muted') === '1' && s.get('sound') === false);
  check('settings JSON never holds lang/sound/kits', !('sound' in JSON.parse(st.getItem(SETTINGS_KEY))) && !('lang' in JSON.parse(st.getItem(SETTINGS_KEY))));
  check('listeners notified', heard.includes('camera=high') && heard.includes('sound=false'), heard);
  // kits adapter (C17: one stored value, lineup.kits)
  let lineupKits = 'auto';
  s.bindExternal('kits', { get: () => lineupKits, set: (v) => { lineupKits = v; } });
  s.set('kits', 'allstar');
  check('kits delegated to the lineup adapter', lineupKits === 'allstar' && s.get('kits') === 'allstar');
  lineupKits = 'classic';
  check('kits read back from the adapter', s.get('kits') === 'classic');
  // language through i18n
  s.set('lang', 'en');
  check('lang through i18n', getLang() === 'en' && heard.includes('lang=en'));
  s.set('lang', 'zh');
  // persisted values survive a new instance
  const s2 = new Settings({ storage: st });
  check('reload keeps values', s2.get('camera') === 'high' && s2.get('crowd') === 'low' && s2.get('sound') === false);
  s.dispose(); s2.dispose();
}
{
  const s = new Settings({ storage: throwing });
  let threw = false;
  try { s.set('difficulty', 'hard'); s.set('sound', false); s.set('replays', 'all'); } catch (e) { threw = true; }
  check('throwing storage: works in memory, no throw', !threw && s.get('difficulty') === 'hard' && s.get('sound') === false && s.get('replays') === 'all' && s.persisted === false);
  s.dispose();
}
{
  const o = parseUrlOverrides('?intro=0&replay=0&quality=medium&diff=hard&q=0.1&clear=1&autoswitch=0&kits=classic');
  check('URL overrides parsed', o.intro === 'off' && o.replays === 'off' && o.quality === 'medium' && o.difficulty === 'hard'
    && Math.abs(o.quarter - 6) < 1e-9 && o.clear === true && o.autoSwitch === false && o.kits === 'classic', o);
  check('URL override intro=short', parseUrlOverrides('?intro=short').intro === 'short');
  const st = memStorage();
  const s = new Settings({ storage: st, search: '?intro=0&replay=0' });
  check('override applies for the session', s.get('intro') === 'off' && s.get('replays') === 'off' && s.isOverridden('intro'));
  check('override never persisted', st.getItem(SETTINGS_KEY) === null);
  s.set('replays', 'all');
  check('user choice drops the override and persists', s.get('replays') === 'all' && !s.isOverridden('replays') && JSON.parse(st.getItem(SETTINGS_KEY)).replays === 'all');
  check('other override untouched', s.get('intro') === 'off' && JSON.parse(st.getItem(SETTINGS_KEY)).intro === 'full');
  s.dispose();
}

setLang('zh');
console.log(failures === 0 ? 'unit-present: ALL OK (' + passes + ' checks)' : 'unit-present: ' + failures + ' FAILURES, ' + passes + ' passed');
process.exit(failures === 0 ? 0 : 1);
