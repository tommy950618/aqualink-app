/* DEV ONLY — drives index.html through every screen with Playwright.
 * Missing js/engine.js / js/art.js / js/data/*.js are replaced by shims (tools/_ui_shim_engine.js,
 * empty art, roster-generated chars) so the UI can be exercised before the other agents finish.
 * Usage: NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/_ui_test.js [desktop|mobile|all] [outDir]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8123/index.html';
const MODE = process.argv[2] || 'all';
const OUT = process.argv[3] || '/tmp/claude-0/-home-user-aqualink-app/7b37f5eb-8962-565a-b27d-4cf648e4c413/scratchpad/ui_shots';
fs.mkdirSync(OUT, { recursive: true });
// drop stale numbered shots of the modes we are about to run (numbering shifts between runs)
fs.readdirSync(OUT).filter((f) => /^\d\d_/.test(f) && (MODE === 'all' || (MODE === 'mobile') === /^\d\d_m_/.test(f))).forEach((f) => fs.unlinkSync(path.join(OUT, f)));
const ROSTER = require('./roster.js');
const used = { engine: 'real', art: 'real', data: [] };

function fakeChars(file) {
  const FX = ['fire', 'wind', 'lightning', 'water', 'rasengan', 'chidori', 'blade', 'shuriken', 'genjutsu', 'summon', 'heal', 'susanoo', 'sand', 'wood'];
  const roles = ['atk', 'tank', 'sup', 'ctrl', 'heal'];
  const list = ROSTER.filter(r => r.file === file).map((r, i) => ({
    id: r.id, name: r.name, form: r.form, en: 'Shim ' + r.id, title: '测试称号', faction: r.faction, rarity: r.rarity,
    role: roles[i % 5], element: 'fire', tags: ['输出', '爆发'], stats: { hp: 1, atk: 1, def: 1, spd: 90 + (i * 7) % 50 },
    bio: '（占位数据）' + r.name + '的介绍。', quote: '这就是我的忍道！',
    skills: {
      passive: { name: '被动·' + r.name.slice(0, 2), desc: '攻击力+10%。', tags: ['增益'], stats: { atk: 0.1 } },
      s1: { name: '普攻', desc: '造成100%攻击力伤害。', tags: ['输出'], fx: FX[i % FX.length], target: 'single', cd: 0, effects: [{ type: 'dmg', mult: 1 }] },
      s2: { name: '奥术' + i, desc: '造成180%攻击力伤害。', tags: ['输出', '控制'], fx: FX[(i + 3) % FX.length], target: i % 3 ? 'single' : 'all', cd: 3, effects: [{ type: 'dmg', mult: 1.8 }] },
      ult: { name: ['螺旋手里剑', '须佐能乎', '天照', '尾兽玉', '千鸟', '八门遁甲·死门'][i % 6], desc: '对全体敌人造成200%攻击力伤害。', tags: ['群攻', '爆发', '斩杀'], fx: FX[(i + 5) % FX.length], target: 'all', effects: [{ type: 'dmg', mult: 2 }] },
      awaken: { name: '突破·觉醒', desc: '攻击力+12%。', tags: ['增益'], stats: { atk: 0.12 } }
    }
  }));
  return 'NG.defineChars(' + JSON.stringify(file) + ',' + JSON.stringify(list) + ');';
}

async function setupRoutes(page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
      if (process.env.FONTS === 'net') return route.continue();
      return route.fulfill({ status: 200, contentType: url.hostname.includes('googleapis') ? 'text/css' : 'font/woff2', body: '' });
    }
    if (url.hostname !== 'localhost') return route.continue();
    const rel = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (process.env.NOART && rel === 'js/art.js') { used.art = 'disabled'; return route.fulfill({ contentType: 'application/javascript', body: '/* art disabled for test */' }); }
    if (process.env.BROKEN && rel === 'js/data/konoha_main.js') {
      const body = fs.readFileSync(path.join(ROOT, rel), 'utf8') + "\nNG.defineChars('broken', [{ id: 'broken1', name: '残缺忍者', rarity: 'UR', faction: 'nope', role: 'zzz' }, { id: 'broken2', name: '无技能', rarity: 'R', faction: 'konoha', role: 'atk', skills: { s1: { name: '怪招', fx: 'nope', target: 'weird', effects: [{ type: 'bogus' }] } }, art: { type: 'alien', hair: 'nope' } }]);";
      return route.fulfill({ contentType: 'application/javascript', body });
    }
    const file = path.join(ROOT, rel);
    if (fs.existsSync(file)) return route.continue();
    if (rel === 'js/engine.js') { used.engine = 'shim'; return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, '_ui_shim_engine.js'), 'utf8') }); }
    if (rel === 'js/art.js') { used.art = 'none'; return route.fulfill({ contentType: 'application/javascript', body: '/* no art yet */' }); }
    const m = rel.match(/^js\/data\/(\w+)\.js$/);
    if (m) { used.data.push(m[1]); return route.fulfill({ contentType: 'application/javascript', body: fakeChars(m[1]) }); }
    return route.continue();
  });
}

function collect(page, tag, errors) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`); if (m.type() === 'warning' && process.env.VERBOSE) console.log(`[${tag}] warn: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}\n${e.stack || ''}`));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let shotN = 0;
async function shot(page, name) { const f = path.join(OUT, String(++shotN).padStart(2, '0') + '_' + name + '.png'); await page.screenshot({ path: f }); console.log('  shot', f); return f; }
async function clickBtn(page, sel, opts) {
  const loc = page.locator(sel).filter({ visible: true }).first();
  await loc.waitFor({ state: 'visible', timeout: (opts && opts.timeout) || 8000 });
  if (opts && opts.tap) await loc.tap(); else await loc.click();
  await sleep((opts && opts.wait) || 450);
}
async function skipReveal(page, tap) {
  const s1 = page.locator('.ur-show .rv-skip');
  if (await s1.count()) { await (tap ? s1.first().tap({ timeout: 2000 }) : s1.first().click({ timeout: 2000 })).catch(() => {}); await sleep(500); }
  const s2 = page.locator('.rv > .rv-skip:not(.hidden)');
  if (await s2.count()) await (tap ? s2.first().tap({ timeout: 2000 }) : s2.first().click({ timeout: 2000 })).catch(() => {});
  await sleep(900);
}
async function go(page, name, params) { await page.evaluate(([n, p]) => NG.ui.go(n, p || {}), [name, params]); await sleep(500); }

async function desktop(browser, errors) {
  console.log('== desktop 1280x720');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); collect(page, 'desk', errors); await setupRoutes(page);
  await page.goto(BASE); await page.waitForSelector('#boot', { state: 'detached', timeout: 10000 }); await sleep(600);
  await shot(page, 'welcome');
  await clickBtn(page, '.welcome .btn'); await sleep(300);
  await shot(page, 'summon');
  // 100 pull
  await clickBtn(page, '.sm-btn[data-n="100"]', { wait: 1700 });
  await shot(page, 'pull100_show');
  await skipReveal(page);
  await page.waitForSelector('.rv-sum', { timeout: 8000 }); await sleep(1600);
  await shot(page, 'pull100_summary');
  await clickBtn(page, '.rv-bar [data-a="ok"]', { wait: 500 });
  // 10 pull (watch flips)
  await clickBtn(page, '.sm-btn[data-n="10"]', { wait: 1300 });
  await shot(page, 'pull10_flipping');
  for (let i = 0; i < 40; i++) { if (await page.locator('.rv-bar:not(.hidden)').count()) break; if (await page.locator('.ur-show').count()) { await shot(page, 'pull10_showcase'); await page.locator('.ur-show').click(); } await sleep(400); }
  await page.waitForSelector('.rv-bar:not(.hidden)', { timeout: 20000 }); await sleep(700);
  await shot(page, 'pull10_done');
  await clickBtn(page, '.rv-bar [data-a="ok"]');
  await clickBtn(page, '.sm-btn[data-n="1"]', { wait: 2000 });
  for (let i = 0; i < 20; i++) { if (await page.locator('.rv-bar:not(.hidden)').count()) break; if (await page.locator('.ur-show').count()) await page.locator('.ur-show').click(); await sleep(400); }
  await shot(page, 'pull1');
  await clickBtn(page, '.rv-bar [data-a="ok"]');
  await clickBtn(page, '.tb-back'); await sleep(300);
  await shot(page, 'home');
  // AFK
  await clickBtn(page, '.home-afk'); await shot(page, 'afk'); await clickBtn(page, '.mask .modal-btns .btn');
  // rename
  await clickBtn(page, '.hp-name .n'); await page.fill('.nm-input', '漩涡测试'); await clickBtn(page, '.mask .modal-btns .btn:not(.dark)');
  const nm = await page.evaluate(() => NG.game.state.player.name); console.log('  renamed to', nm); if (nm !== '漩涡测试') errors.push('[desk] rename failed');
  // training
  await clickBtn(page, '.hm-btn[data-go="train"]', { wait: 900 });
  await shot(page, 'train_skill');
  await clickBtn(page, '.sk[data-k="ult"]'); await shot(page, 'train_skill_popup');
  const up = page.locator('.skd [data-a="up"]'); if (await up.count()) { await up.click(); await sleep(400); }
  await clickBtn(page, '.modal-x');
  await clickBtn(page, '.sk[data-k="awaken"]'); await clickBtn(page, '.modal-x');
  await clickBtn(page, '.tr-tabbar [data-tab="attr"]'); await shot(page, 'train_attr');
  await clickBtn(page, '.at-btns [data-n="10"]', { wait: 300 }).catch(() => {});
  await clickBtn(page, '.at-btns [data-n="max"]', { wait: 600 });
  await shot(page, 'train_attr_max');
  await clickBtn(page, '.tr-tabbar [data-tab="star"]'); await shot(page, 'train_star');
  const sid = await page.evaluate(() => { const l = NG.game.ownedList(); const x = l.find(o => NG.game.starCost(o.id) != null && o.e.shards >= NG.game.starCost(o.id)); return x && x.id; });
  if (sid) { await go(page, 'train', { id: sid, tab: 'star' }); await clickBtn(page, '.st-btn .btn', { wait: 500 }); await shot(page, 'train_star_up'); }
  await clickBtn(page, '.tr-arrow.next', { wait: 500 }); await clickBtn(page, '.tr-tabbar [data-tab="skill"]', { wait: 700 });
  await shot(page, 'train_next');
  // team
  await go(page, 'team'); await clickBtn(page, '[data-a="auto"]', { wait: 600 }); await shot(page, 'team');
  // campaign + battle
  await go(page, 'campaign'); await shot(page, 'campaign');
  await page.evaluate(() => NG.ui.setSetting('speed', 1));
  await clickBtn(page, '.cp-info [data-a="fight"]', { wait: 1700 });
  await shot(page, 'battle_start');
  let gotCut = false, gotHit = false;
  for (let i = 0; i < 160; i++) {
    if (!gotCut && await page.locator('.cutin').count()) { await sleep(500); await shot(page, 'battle_cutin'); gotCut = true; }
    if (!gotHit && await page.locator('.bt-fx .dmg').count() >= 2) { await shot(page, 'battle_hit'); gotHit = true; await page.click('[data-a="speed"]'); await page.click('[data-a="speed"]'); /* x4 */ }
    if (await page.locator('.res').count()) break;
    await sleep(250);
  }
  await page.waitForSelector('.res', { timeout: 120000 }); await sleep(1300);
  await shot(page, 'battle_result');
  const nxt = page.locator('.res .modal-btns .btn.red');
  if (await nxt.count()) { await nxt.click(); await sleep(1500); await shot(page, 'battle2'); await clickBtn(page, '[data-a="skip"]'); await page.waitForSelector('.res', { timeout: 15000 }); await sleep(1200); await shot(page, 'battle2_result'); }
  await clickBtn(page, '.res .modal-btns .btn.dark', { wait: 700 });
  await shot(page, 'campaign_after');
  // lose case: battle a far stage
  const far = await page.evaluate(() => { const ch = NG.game.chapters(); const s = ch[ch.length - 1].stages.slice(-1)[0]; return s.id; });
  await page.evaluate((id) => { const st = NG.game.stageState; NG.game._ss = st; NG.game.stageState = (x) => x === id ? { unlocked: true, stars: 0 } : st(x); }, far);
  await page.evaluate((id) => NG.ui.startBattle(id), far); await sleep(1200);
  await clickBtn(page, '[data-a="skip"]'); await page.waitForSelector('.res', { timeout: 15000 }); await sleep(1000);
  await shot(page, 'battle_lose');
  await page.evaluate(() => { NG.game.stageState = NG.game._ss; });
  await clickBtn(page, '.res .modal-btns .btn.dark', { wait: 600 });
  // codex
  await go(page, 'codex'); await sleep(600); await shot(page, 'codex');
  await clickBtn(page, '.cx-row [data-f="rar"] [data-v="UR"]', { wait: 500 }); await shot(page, 'codex_ur');
  await clickBtn(page, '.cx-row [data-f="own"] [data-v="not"]', { wait: 400 });
  await clickBtn(page, '.cx-row [data-f="own"] [data-v="all"]', { wait: 400 });
  await clickBtn(page, '.cx-row [data-f="rar"] [data-v="all"]', { wait: 400 });
  await clickBtn(page, '.cx-row [data-f="role"] [data-v="heal"]', { wait: 400 });
  await clickBtn(page, '.cx-row [data-f="role"] [data-v="all"]', { wait: 400 });
  await clickBtn(page, '.pills.fac [data-v="akatsuki"]', { wait: 400 });
  await clickBtn(page, '.cx-card', { wait: 600 }); await shot(page, 'codex_detail');
  await clickBtn(page, '.modal-x');
  await clickBtn(page, '.pills.fac [data-v="all"]', { wait: 400 });
  // scroll grid fully (lazy load)
  await page.evaluate(() => { const g = document.querySelector('.cx-grid'); g.scrollTop = g.scrollHeight; }); await sleep(600); await shot(page, 'codex_bottom');
  // quick nav + settings + reset
  await clickBtn(page, '.tb-menu'); await shot(page, 'quicknav'); await clickBtn(page, '.qnav [data-go="settings"]', { wait: 600 });
  await shot(page, 'settings');
  await clickBtn(page, '[data-set="speed"] [data-v="2"]');
  await clickBtn(page, '[data-act="reset"]'); await shot(page, 'reset_confirm');
  await clickBtn(page, '.confirm .btn.red', { wait: 1200 });
  await shot(page, 'after_reset');
  const st = await page.evaluate(() => ({ t: NG.game.state.tickets, n: Object.keys(NG.game.state.roster).length, sp: NG.game.state.settings.speed }));
  console.log('  after reset state', st);
  await ctx.close();
}

async function mobile(browser, errors) {
  console.log('== mobile 390x844 portrait (rotated stage)');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); collect(page, 'mob', errors); await setupRoutes(page);
  await page.goto(BASE); await page.waitForSelector('#boot', { state: 'detached', timeout: 10000 }); await sleep(600);
  await shot(page, 'm_welcome');
  await clickBtn(page, '.welcome .btn', { tap: true });
  await shot(page, 'm_summon');
  await clickBtn(page, '.sm-btn[data-n="10"]', { tap: true, wait: 800 });
  await skipReveal(page, true);
  await page.waitForSelector('.rv-bar:not(.hidden)', { timeout: 10000 }); await sleep(600);
  await shot(page, 'm_pull10');
  await clickBtn(page, '.rv-bar [data-a="ok"]', { tap: true });
  await clickBtn(page, '.tb-back', { tap: true });
  await shot(page, 'm_home');
  await clickBtn(page, '.hm-btn[data-go="train"]', { tap: true, wait: 900 });
  await shot(page, 'm_train');
  await clickBtn(page, '.sk[data-k="s2"]', { tap: true }); await shot(page, 'm_skill'); await clickBtn(page, '.modal-x', { tap: true });
  // drag-scroll the avatar list in rotated mode (screen-y drag = stage-x… list is vertical in stage = screen horizontal)
  const before = await page.evaluate(() => document.querySelector('.tr-list').scrollTop);
  const box = await page.locator('.tr-list').boundingBox();
  // stage y axis maps to screen -x when rotated: drag finger from left to right to scroll the list down.
  const cx = box.x + box.width * 0.3, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); for (let i = 1; i <= 10; i++) { await page.mouse.move(cx + i * 25, cy); await sleep(16); } await page.mouse.up(); await sleep(500);
  const after = await page.evaluate(() => document.querySelector('.tr-list').scrollTop);
  console.log('  rotated drag-scroll list scrollTop', before, '->', after);
  if (!(after > before)) errors.push('[mob] rotated drag scroll did not scroll the list');
  await go(page, 'campaign'); await shot(page, 'm_campaign');
  await clickBtn(page, '.cp-info [data-a="fight"]', { tap: true, wait: 2500 });
  await shot(page, 'm_battle');
  await clickBtn(page, '[data-a="skip"]', { tap: true }); await page.waitForSelector('.res', { timeout: 15000 }); await sleep(1200);
  await shot(page, 'm_result');
  await clickBtn(page, '.res .modal-btns .btn.dark', { tap: true });
  await go(page, 'codex'); await sleep(500); await shot(page, 'm_codex');
  await clickBtn(page, '.cx-row [data-f="rar"] [data-v="SSR"]', { tap: true, wait: 600 });
  await clickBtn(page, '.cx-card', { tap: true, wait: 700 }); await shot(page, 'm_codex_detail');
  await clickBtn(page, '.modal-x', { tap: true });
  const nCards = await page.locator('.cx-grid .cx-card').count(); console.log('  SSR cards', nCards);
  // team screen tap add/remove
  await go(page, 'team'); await clickBtn(page, '.tm-slot.filled', { tap: true, wait: 400 }); await clickBtn(page, '.tm-it:not(.in)', { tap: true, wait: 400 }); await shot(page, 'm_team');
  await go(page, 'settings'); await clickBtn(page, '[data-set="rotate"] [data-v="off"]', { tap: true }); await shot(page, 'm_rotate_off');
  await page.evaluate(() => NG.ui.setSetting('rotate', 'auto'));
  await ctx.close();
}

(async () => {
  const px = process.env.FONTS === 'net' && (process.env.HTTPS_PROXY || process.env.https_proxy);
  const browser = await chromium.launch({ args: ['--disable-gpu'], proxy: px ? { server: px, bypass: 'localhost,127.0.0.1' } : undefined });
  const errors = [];
  try {
    if (MODE === 'desktop' || MODE === 'all') await desktop(browser, errors);
    if (MODE === 'mobile' || MODE === 'all') await mobile(browser, errors);
  } catch (e) { errors.push('TEST FAILURE: ' + (e.stack || e.message)); }
  await browser.close();
  console.log('sources used:', JSON.stringify(used));
  console.log(errors.length ? 'ERRORS (' + errors.length + '):\n' + errors.join('\n') : 'NO ERRORS');
  process.exit(errors.length ? 1 : 0);
})();
