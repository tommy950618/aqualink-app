// layout-check.cjs - WP8 acceptance on its own (spec v2 section 1.6): the v2 DOM screens with a stub game on the
// 8 viewports of B36 (+ 851x337 for the lineup), in zh and en.
//
// Checks (B20, B22, B30, B36, R#7, R#8, R#9, R#10, R#11, R#12): no page scroll, canvas = viewport, touch-action none;
// every visible button / .opt / .card >= 44 x 44 px and (outside scroll containers) inside the viewport; button labels
// not clipped; zh .lbl on one line; scene-specific overlap checks (title buttons / language chip / legal note, lineup
// cards / detail card / bars, score bug vs pause / primary / cluster, caption vs score bug, game-over buttons inside
// #menuOver and the panel clear of the MVP card, lower-third vs skip, loading lines); joystick pointerdown at (4, 300)
// and (150, H - 4) without move -> intent.move.mag === 0; #stickRing never covers the #cluster buttons.
// Screenshots of every screen at 390x844, 844x390, 360x640 and 1280x720 (zh; en for a subset) go to
// test/scratch/wp8a/shots/ (gitignored scratch).
//
// The page is index.html with src/main.js replaced by an empty module; a bootstrap module builds the WP8 UI
// (Loader, Screens, LineupScreen, HUD, Presenter, Settings, MatchView, Input) around a stub world.
// Run: node test/layout-check.cjs [--only phonePortrait,...] [--no-shots]
const path = require('path');
const fs = require('fs');
const { startServer } = require('./harness.cjs');
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/opt/node22/lib/node_modules/playwright'); } })();

const dir = path.resolve(__dirname, '..');
const shotDir = path.join(__dirname, 'scratch', 'wp8a', 'shots');
const argv = process.argv.slice(2);
const only = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1].split(',') : null; })();
const noShots = argv.includes('--no-shots');
const allShots = argv.includes('--all-shots');   // screenshots on every viewport (visual review of short landscapes)

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const touch = (w, h, dpr, ua) => ({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, userAgent: ua });
const VIEWPORTS = [
  { name: 'desktop', ctx: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, shots: true },
  { name: 'phonePortrait', ctx: touch(390, 844, 2, IPHONE_UA), shots: true },
  { name: 'phoneLandscape', ctx: touch(844, 390, 2, IPHONE_UA), shots: true },
  { name: 'androidPortrait', ctx: touch(393, 851, 2.75, ANDROID_UA) },
  { name: 'androidSmall', ctx: touch(360, 640, 3, ANDROID_UA), shots: true },
  { name: 'landscapeShort', ctx: touch(740, 304, 2, ANDROID_UA) },
  { name: 'seLandscape', ctx: touch(568, 320, 2, IPHONE_UA) },
  { name: 'tabletLandscape', ctx: touch(1024, 768, 2, IPHONE_UA) },
  { name: 'pixelLandscape', ctx: touch(851, 337, 2.75, ANDROID_UA), scenes: ['lineup', 'lineupSel', 'gameover'] },
];
const SCENES = ['loading', 'loadError', 'title', 'settings', 'lineup', 'lineupSel', 'intro', 'introTeam', 'matchup', 'game',
  'gameMeter', 'pause', 'halftime', 'gameover', 'replay'];
const EN_SHOTS = ['title', 'settings', 'lineup', 'lineupSel', 'game', 'pause', 'gameover'];

// ---------------------------------------------------------------------------------------------------------------
// In-page bootstrap: builds the UI around a stub world and exposes window.__t.setScene(name).
// ---------------------------------------------------------------------------------------------------------------
const BOOT = `
import * as THREE from './vendor/three.module.js';
import { applyDom, setLang, getLang } from './src/i18n.js';
import { Settings } from './src/ui/settings.js';
import { MatchView, Presenter } from './src/ui/present.js';
import { HUD } from './src/ui/hud.js';
import { Screens } from './src/ui/screens.js';
import { LineupScreen } from './src/ui/lineup.js';
import { Loader, stageProgress } from './src/ui/loading.js';
import { LEGENDS } from './src/legends.js';
import { resolveKitModes, teamNames, resetLineup } from './src/lineup.js';
import { Input } from './src/input.js';

applyDom(document);
const calls = [];
const settings = new Settings({ storage: null });
const match = new MatchView(LEGENDS);
const loader = new Loader(document.getElementById('loading'));
const input = new Input(document, {});
const screens = new Screens(document, { settings, match,
  onPlay: () => calls.push('play'), onQuick: () => calls.push('quick'), onResume: () => calls.push('resume'),
  onQuit: () => calls.push('quit'), onRematch: () => calls.push('rematch'), onLineup: () => calls.push('lineup'),
  onHalftimeSkip: () => calls.push('halfSkip') });
screens.bind({ input });
const present = new Presenter(document, { match, onSkipLegend: () => calls.push('skipLegend'), onSkipIntro: () => calls.push('skipIntro'), onSkipReplay: () => calls.push('skipReplay') });
const lineupScreen = new LineupScreen(document.getElementById('screenLineup'), { lineup: resetLineup(), legends: LEGENDS, match, seed: 7, persist: false,
  onSwap: (a, b) => calls.push(['swap', a, b]), onSelect: (id) => calls.push(['select', id]), onStart: () => calls.push('start'),
  onBack: () => calls.push('back'), onDrag: (dx) => calls.push(['drag', dx]), onRelease: (vx) => calls.push(['release', Math.round(vx)]) });
const hud = new HUD(document, { match });

// ---- stub world ----
const V = (x, z) => new THREE.Vector3(x, 0, z);
const players = [
  { id: 'lebron', team: 0, pos: V(0.3, -6.4), jumpY: 0, stamina: 0.62, hasBall: true },
  { id: 'kyrie', team: 0, pos: V(-5.0, -8.2), jumpY: 0, stamina: 0.9 },
  { id: 'giannis', team: 0, pos: V(-11.5, 1.5), jumpY: 0, stamina: 1 },
  { id: 'jordan', team: 1, pos: V(0.2, -7.4), jumpY: 0, stamina: 1 },
  { id: 'kobe', team: 1, pos: V(-4.4, -8.9), jumpY: 0, stamina: 1 },
  { id: 'yao', team: 1, pos: V(2.0, -11.6), jumpY: 0, stamina: 1 },
];
const world = { players, score: [12, 9], offense: 0, user: 0, controlled: players[0], quarter: 2, gameClock: 83.2, shotClock: 4.2,
  state: 'LIVE', time: 0 };
const meter = { active: false, shooterId: 'lebron', fill: 0, greenLo: 0.74, greenHi: 0.86, points: 3, flash: null, flashT: 0 };
const game = { meter, world, passPreview: () => 'kyrie' };
hud.bind({ game });
const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 160);
function setCamera() {
  const w = innerWidth, h = innerHeight, portrait = h > w;
  camera.aspect = w / h;
  if (portrait) {
    camera.fov = 72; camera.position.set(0.1, 9, 12); camera.lookAt(0, 1, -7);
    camera.setViewOffset(w, h, 0, 0.25 * h / 2, w, h);
  } else {
    camera.fov = Math.max(42, 2 * Math.atan(Math.tan(21 * Math.PI / 180) * (16 / 9) / Math.max(1, w / h)) * 180 / Math.PI);
    camera.clearViewOffset(); camera.position.set(0.1, 6.5, 4.8); camera.lookAt(0.1, 1.0, -8.0);
  }
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  hud.resize();
}
const director = { camera };

// ---- painted stand-in for the 3D court so overlays can be judged for legibility ----
function paintCanvas() {
  const c = document.getElementById('gl');
  const w = innerWidth, h = innerHeight;
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#07080c'); grd.addColorStop(0.32, '#1a1d28'); grd.addColorStop(0.36, '#8a5a32'); grd.addColorStop(1, '#c08a52');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
  const P = new THREE.Vector3();
  const line = (pts) => { g.beginPath(); pts.forEach((p, i) => { P.set(p[0], 0, p[1]).project(camera); const x = (P.x * 0.5 + 0.5) * w, y = (0.5 - P.y * 0.5) * h; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); };
  const arc = []; for (let a = -1.38; a <= 1.38; a += 0.05) arc.push([6.75 * Math.sin(a), -12.75 + 6.75 * Math.cos(a)]);
  line(arc); line([[-7.62, 0], [7.62, 0]]); line([[-2.44, -14.3], [-2.44, -8.5], [2.44, -8.5], [2.44, -14.3]]);
  for (const p of players) {
    P.set(p.pos.x, 1.0, p.pos.z).project(camera);
    const x = (P.x * 0.5 + 0.5) * w, y = (0.5 - P.y * 0.5) * h;
    P.set(p.pos.x, 2.0, p.pos.z).project(camera);
    const y2 = (0.5 - P.y * 0.5) * h, hh = Math.abs(y - y2) * 2;
    g.fillStyle = p.team === 0 ? '#6F263D' : '#CE1141';
    g.fillRect(x - hh * 0.12, y - hh * 0.5, hh * 0.24, hh);
  }
}

const BOX = [
  { id: 'lebron', team: 0, index: 0, pts: 14, fgm: 6, fga: 11, tpm: 1, tpa: 3, reb: 6, ast: 5, stl: 1, blk: 1 },
  { id: 'kyrie', team: 0, index: 1, pts: 9, fgm: 4, fga: 9, tpm: 1, tpa: 4, reb: 1, ast: 2, stl: 0, blk: 0 },
  { id: 'giannis', team: 0, index: 2, pts: 8, fgm: 4, fga: 6, tpm: 0, tpa: 0, reb: 7, ast: 1, stl: 0, blk: 2 },
  { id: 'jordan', team: 1, index: 0, pts: 12, fgm: 5, fga: 12, tpm: 0, tpa: 1, reb: 3, ast: 2, stl: 2, blk: 0 },
  { id: 'kobe', team: 1, index: 1, pts: 10, fgm: 4, fga: 10, tpm: 2, tpa: 5, reb: 2, ast: 1, stl: 1, blk: 0 },
  { id: 'yao', team: 1, index: 2, pts: 6, fgm: 3, fga: 5, tpm: 0, tpa: 0, reb: 8, ast: 0, stl: 0, blk: 3 },
];

function frame(n) { for (let i = 0; i < (n || 1); i++) { world.time += 1 / 60; hud.update(1 / 60, world, director); } }
function resetUi() {
  document.getElementById('loading').classList.add('hidden');
  loader.hideError();
  screens.pause(false); screens.halftime(null); present.intro(false); present.replay('none'); present.hideMatchup();
  meter.active = false; meter.flash = null; meter.flashT = 0;
  hud.banner(null); hud.captions.clear(); present.hideTip();
}

async function setScene(name) {
  setCamera();
  paintCanvas();
  resetUi();
  if (name !== 'lineup' && name !== 'lineupSel') lineupScreen.setLineup(resetLineup());
  match.set({ lineup: lineupScreen.lineup, teams: teamNames(lineupScreen.lineup), kits: resolveKitModes(lineupScreen.lineup) });
  switch (name) {
    case 'loading':
      document.getElementById('loading').classList.remove('hidden');
      loader.phase('load.assets'); loader.progress(stageProgress('assets', 0.68)); loader.bytes(1363148, 3565158);
      screens.show('loading'); break;
    case 'loadError':
      document.getElementById('loading').classList.remove('hidden');
      loader.error({ file: 'assets/legends/legends.kobe.bin', reason: 'timeout' }, () => calls.push('retry'), () => calls.push('simple'));
      screens.show('loadError'); break;
    case 'title': screens.show('title'); break;
    case 'settings': screens.setTier('medium'); screens.openSettings(); break;
    case 'lineup':
      lineupScreen.setLineup(resetLineup()); screens.show('lineup'); break;
    case 'lineupSel': {
      lineupScreen.setLineup({ a: ['lebron', 'jordan', 'giannis'], b: ['kyrie', 'kobe', 'yao'], user: 'a', kits: 'auto' });
      screens.show('lineup');
      document.querySelector('#screenLineup .card[data-slot="4"]').click();
      break;
    }
    case 'intro': screens.show('intro'); present.intro(true); present.lowerThird('lebron', true); break;
    case 'introTeam': screens.show('intro'); present.intro(true); present.teamCard(1); break;
    case 'matchup': screens.show('intro'); present.intro(true); present.matchup(); break;
    case 'game':
      screens.show('game');
      hud.captions.push('cap.make3', { name: LEGENDS.giannis.short }, 3);
      present.tip('tip.pumpFake');
      frame(2); break;
    case 'gameMeter':
      screens.show('game');
      meter.active = true; meter.fill = 0.62; meter.points = 3;
      hud.banner('banner.plus', { n: 3, name: LEGENDS.giannis.short }, 5000);
      hud.captions.push('cap.ab.kyrie.combo', { name: LEGENDS.kyrie.short }, 2);
      frame(2); break;
    case 'pause': screens.show('game'); frame(1); screens.pause(true); break;
    case 'halftime': screens.show('game'); frame(1); screens.halftime({ score: [33, 28], box: BOX }); break;
    case 'gameover': screens.gameOver({ winner: 0, score: [31, 28], box: BOX }); break;
    case 'replay': screens.show('replay'); present.replay('on'); break;
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 320));    // CSS transitions (0.25-0.3 s) settle before measuring
}

window.__t = { setScene, setLang, getLang, calls, input, hud, screens, present, lineupScreen, loader, settings, match, world, meter, frame };
`;

// ---------------------------------------------------------------------------------------------------------------
// In-page measurements
// ---------------------------------------------------------------------------------------------------------------
function measure() {
  const W = innerWidth, H = innerHeight;
  const rect = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const visible = (e) => {
    if (!e) return false;
    const b = e.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return false;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden') return false;
    for (let p = e; p && p !== document.body; p = p.parentElement) if (parseFloat(getComputedStyle(p).opacity) < 0.05) return false;
    return true;
  };
  const inScroll = (e) => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true; } return false; };
  const label = (e) => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '') + ' "' + (e.textContent || '').trim().slice(0, 18) + '"';
  const textRect = (e) => { const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const lines = (e) => { const r = document.createRange(); r.selectNodeContents(e); const tops = new Set(); for (const q of r.getClientRects()) if (q.width > 0.5) tops.add(Math.round(q.top)); return tops.size; };
  const tapp = [];
  for (const e of document.querySelectorAll('button, .opt, .card')) {
    if (!visible(e)) continue;
    const b = rect(e);
    const clipped = !e.classList.contains('card') && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1);
    tapp.push({ l: label(e), w: b.w, h: b.h, inside: b.x >= -0.5 && b.y >= -0.5 && b.r <= W + 0.5 && b.b <= H + 0.5, scroll: inScroll(e), clipped });
  }
  const lbls = [];
  for (const e of document.querySelectorAll('.lbl')) if (visible(e)) lbls.push({ l: e.textContent, lines: lines(e), over: e.scrollWidth > e.clientWidth + 1 });
  const se = document.scrollingElement;
  const app = document.getElementById('app');
  const named = {};
  const ids = ['scoreBug', 'shotClock', 'btnPause', 'btnPrimary', 'cluster', 'caption', 'banner', 'meter', 'meterPts', 'nameTagText', 'offA', 'offB',
    'offC', 'passTarget', 'menuOver', 'mvpCard', 'btnRematch', 'btnLineup', 'btnQuitOver', 'menuPause', 'btnResume', 'btnQuit', 'menuSettings',
    'btnStart', 'btnQuick', 'btnSettings', 'btnLang', 'rotateHint', 'lowerThird', 'skipBtn', 'matchup', 'halftime', 'loadBar', 'loadStatus', 'loadTip',
    'loadError', 'btnRetry', 'btnSimple', 'lbTop', 'replayTag', 'toast', 'tip', 'finalScore', 'boxRows'];
  for (const id of ids) { const e = document.getElementById(id); if (e && visible(e)) named[id] = rect(e); }
  const q = (sel) => [...document.querySelectorAll(sel)].filter(visible).map(rect);
  const legalEl = [...document.querySelectorAll('.legal')].find(visible);
  return {
    W, H, screen: app.getAttribute('data-screen'), overlay: app.getAttribute('data-overlay'),
    scroll: { w: se.scrollWidth, h: se.scrollHeight }, canvas: { w: document.getElementById('gl').clientWidth, h: document.getElementById('gl').clientHeight },
    ta: [getComputedStyle(document.body).touchAction, getComputedStyle(document.getElementById('gl')).touchAction],
    tapp, lbls, named,
    legal: legalEl ? textRect(legalEl) : null, legalLines: legalEl ? lines(legalEl) : 0,
    logo: (() => { const e = document.querySelector('#screenTitle .logo'); return e && visible(e) ? rect(e) : null; })(),
    cards: q('#screenLineup .card'), luTop: q('#screenLineup .luTop'), luBottom: q('#screenLineup .luBottom'), luDetail: q('#screenLineup .luDetail'),
    luCtrl: q('#screenLineup .luCtrl'), luTitle: (() => { const e = document.querySelector('#screenLineup .luTitle'); return e && visible(e) ? rect(e) : null; })(),
    luSegs: q('#screenLineup .luSeg'), luIcons: q('#screenLineup .iconBtn'),
    boxRows: document.querySelectorAll('#boxRows tr').length,
    overOverflow: (() => { const e = document.getElementById('menuOver'); return e && visible(e) ? e.scrollHeight > e.clientHeight + 1 : false; })(),
    captionText: document.getElementById('caption').textContent, meterPts: document.getElementById('meterPts').textContent,
    abbrA: document.getElementById('abbrA').textContent, period: document.getElementById('period').textContent,
    status: [document.getElementById('loadStatus'), document.getElementById('loadTip')].filter(visible).map(textRect),
    emptyI18n: [...document.querySelectorAll('[data-i18n]')].filter((e) => !e.textContent.trim()).length,
    title: document.title,
  };
}

// ---------------------------------------------------------------------------------------------------------------
let failures = 0, passes = 0;
const failList = [];
function check(tag, name, ok, extra) {
  if (ok) { passes++; return; }
  failures++;
  const s = 'FAIL - ' + tag + ' ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 700) : '');
  failList.push(s);
  console.log(s);
}
const ov = (a, b) => !!a && !!b && a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
const inside = (a, b) => !!a && !!b && a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.r <= b.r + 0.5 && a.b <= b.b + 0.5;

function sceneChecks(tag, scene, m, lang) {
  check(tag, 'no page scroll', m.scroll.w <= m.W && m.scroll.h <= m.H, [m.scroll, m.W, m.H]);
  check(tag, 'canvas = viewport', m.canvas.w === m.W && m.canvas.h === m.H, m.canvas);
  check(tag, 'touch-action none on body/canvas', m.ta[0] === 'none' && m.ta[1] === 'none', m.ta);
  check(tag, 'no empty [data-i18n]', m.emptyI18n === 0, m.emptyI18n);
  const small = m.tapp.filter((t) => t.w < 44 - 0.01 || t.h < 44 - 0.01);
  check(tag, 'every visible button/.opt/.card >= 44 px', small.length === 0, small);
  const out = m.tapp.filter((t) => !t.inside && !t.scroll);
  check(tag, 'tappables inside the viewport', out.length === 0, out);
  const clipped = m.tapp.filter((t) => t.clipped);
  check(tag, 'button labels not clipped', clipped.length === 0, clipped);
  if (lang === 'zh') {
    const multi = m.lbls.filter((l) => l.lines !== 1 || l.over);
    check(tag, 'zh .lbl single line', multi.length === 0, multi);
  }
  const n = m.named;
  const viewport = { x: 0, y: 0, r: m.W, b: m.H };
  switch (scene) {
    case 'loading':
      check(tag, 'loading bar/status/tip visible', !!n.loadBar && m.status.length === 2);
      check(tag, 'status and tip lines do not overlap', !ov(m.status[0], m.status[1]), m.status);
      check(tag, 'legal note clear of the tip', !m.legal || !ov(m.legal, m.status[1]), [m.legal, m.status[1]]);
      check(tag, 'loading elements inside the viewport', inside(n.loadBar, viewport) && m.status.every((s) => inside(s, viewport)) && (!m.legal || inside(m.legal, viewport)));
      break;
    case 'loadError':
      check(tag, 'error buttons visible', !!n.btnRetry && !!n.btnSimple && !ov(n.btnRetry, n.btnSimple));
      break;
    case 'title': {
      const b = [n.btnStart, n.btnQuick, n.btnSettings, n.btnLang];
      check(tag, 'title buttons + language chip visible', b.every(Boolean));
      let pair = null;
      for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) if (ov(b[i], b[j])) pair = [i, j];
      check(tag, 'title buttons and language chip do not overlap', !pair, pair);
      check(tag, 'legal note clear of the buttons and chip', !!m.legal && b.every((r) => !ov(m.legal, r)), m.legal);
      check(tag, 'legal note on at most two lines (one in zh)', m.legalLines <= (lang === 'zh' ? 1 : 2), m.legalLines);
      check(tag, 'logo clear of the buttons', !!m.logo && b.every((r) => !ov(m.logo, r)), m.logo);
      if (n.rotateHint) check(tag, 'rotate hint clear of logo and buttons', !ov(n.rotateHint, m.logo) && b.every((r) => !ov(n.rotateHint, r)), [n.rotateHint, m.logo]);
      check(tag, 'document title (B59)', m.title === (lang === 'zh' ? '传奇对决 3v3' : 'LEGENDS 3v3'), m.title);
      break;
    }
    case 'settings':
      check(tag, 'settings sheet inside the viewport', inside(n.menuSettings, viewport), n.menuSettings);
      break;
    case 'lineup': case 'lineupSel': {
      check(tag, 'six cards visible', m.cards.length === 6, m.cards.length);
      check(tag, 'cards inside the viewport (B36 lineup fully visible)', m.cards.every((c) => inside(c, viewport)));
      let pair = null;
      for (let i = 0; i < m.cards.length; i++) for (let j = i + 1; j < m.cards.length; j++) if (ov(m.cards[i], m.cards[j])) pair = [i, j];
      check(tag, 'cards do not overlap', !pair, pair);
      const bars = m.luTop.concat(m.luBottom);
      check(tag, 'cards clear of the top/bottom bars', m.cards.every((c) => bars.every((b) => !ov(c, b))));
      if (m.luDetail.length) {
        const d = m.luDetail[0];
        check(tag, 'detail card clear of the cards and bars', m.cards.every((c) => !ov(c, d)) && bars.every((b) => !ov(b, d)), d);
        check(tag, 'detail card inside the viewport', inside(d, viewport), d);
      }
      if (scene === 'lineupSel' && m.H < m.W) check(tag, 'landscape detail card shown on selection', m.luDetail.length === 1);
      const tops = m.luSegs.concat(m.luIcons, m.luTitle ? [m.luTitle] : []);
      let tp = null;
      for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) if (ov(tops[i], tops[j])) tp = [tops[i], tops[j]];
      check(tag, 'top bar controls do not overlap', !tp, tp);
      if (n.rotateHint) check(tag, 'rotate hint clear of the lineup controls and cards', m.luSegs.concat(m.luIcons, m.cards).every((r) => !ov(n.rotateHint, r)), n.rotateHint);
      break;
    }
    case 'intro': case 'introTeam':
      check(tag, 'lower-third + skip visible and inside', !!n.lowerThird && !!n.skipBtn && inside(n.lowerThird, viewport), [n.lowerThird, n.skipBtn]);
      check(tag, 'lower-third clear of skip', !ov(n.lowerThird, n.skipBtn));
      break;
    case 'matchup':
      check(tag, 'matchup inside the viewport', !!n.matchup && inside(n.matchup, viewport), n.matchup);
      break;
    case 'game': case 'gameMeter':
      check(tag, 'score bug visible, abbreviation', !!n.scoreBug && m.abbrA === (lang === 'zh' ? '暗夜' : 'DRK'), m.abbrA);
      check(tag, 'period label', m.period === (lang === 'zh' ? '第2节' : 'Q2'), m.period);
      check(tag, '#scoreBug clear of #btnPrimary/#btnPause/#cluster (B20)', !ov(n.scoreBug, n.btnPrimary) && !ov(n.scoreBug, n.btnPause) && !ov(n.scoreBug, n.cluster), [n.scoreBug, n.btnPause]);
      check(tag, 'shot clock clear of #btnPause', !ov(n.shotClock, n.btnPause), [n.shotClock, n.btnPause]);
      check(tag, 'score bug inside the viewport', inside(n.scoreBug, viewport) && inside(n.shotClock, viewport));
      check(tag, 'caption visible, clear of the score bug and pause', !!n.caption && !ov(n.caption, n.scoreBug) && !ov(n.caption, n.btnPause) && !ov(n.caption, n.shotClock), n.caption);
      if (scene === 'game') {
        check(tag, 'name tag visible', !!n.nameTagText);
        check(tag, 'off-screen indicator for the far teammate', !!(n.offA || n.offB), Object.keys(n));
        const ind = n.offA || n.offB;
        if (ind) check(tag, 'indicator inside the viewport', inside(ind, viewport), ind);
        check(tag, 'tip clear of the caption', !n.tip || !ov(n.tip, n.caption), [n.tip, n.caption]);
      } else {
        check(tag, 'meter visible with the 3 chip', !!n.meter && m.meterPts === '3', m.meterPts);
        check(tag, 'name tag hidden while the meter shows', !n.nameTagText);
      }
      break;
    case 'pause':
      check(tag, 'pause menu inside the viewport', inside(n.menuPause, viewport), n.menuPause);
      check(tag, 'resume / quit inside the panel', inside(n.btnResume, n.menuPause) && inside(n.btnQuit, n.menuPause));
      break;
    case 'halftime':
      check(tag, 'halftime visible', !!n.halftime);
      break;
    case 'gameover':
      check(tag, 'game-over buttons inside #menuOver (B36)', ['btnRematch', 'btnLineup', 'btnQuitOver'].every((k) => inside(n[k], n.menuOver)), [n.menuOver, n.btnRematch]);
      check(tag, '#menuOver inside the viewport', inside(n.menuOver, viewport), n.menuOver);
      check(tag, 'six box-score rows', m.boxRows === 6, m.boxRows);
      check(tag, 'MVP card visible and clear of the panel', !!n.mvpCard && !ov(n.mvpCard, n.menuOver) && inside(n.mvpCard, viewport), [n.mvpCard, n.menuOver]);
      check(tag, 'box score fits without inner scrolling', !m.overOverflow);
      break;
    case 'replay':
      check(tag, 'replay letterbox + tag + skip', !!n.lbTop && !!n.replayTag && !!n.skipBtn);
      check(tag, 'skip clear of the tag', !ov(n.skipBtn, n.replayTag));
      break;
  }
}

async function joystickChecks(tag, page, vp) {
  // B36 / R#9: a press that never moves leaves the stick at zero.
  const H = vp.ctx.viewport.height;
  const pts = [{ x: 4, y: 300 }, { x: 150, y: H - 4 }];
  const sample = () => page.evaluate(() => { const it = window.__t.input.sample(performance.now()); return { mag: it.move.mag, x: it.move.x, z: it.move.z }; });
  if (vp.ctx.hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    for (const p of pts) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      await page.waitForTimeout(30);
      const it = await sample();
      check(tag, 'joystick press at (' + p.x + ',' + p.y + ') without move -> mag 0 (R#9)', it.mag === 0, it);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sample();
    }
    // R#10: drag from the stick zone toward the cluster; the ring must never cover a cluster button.
    const geo = await page.evaluate(() => { const z = document.getElementById('stickZone').getBoundingClientRect(); const c = document.getElementById('btnPrimary').getBoundingClientRect(); return { zx: z.right - 12, zy: Math.min(z.bottom - 12, innerHeight - 80), cx: c.left + c.width / 2, cy: c.top + c.height / 2 }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: geo.zx, y: geo.zy, id: 2 }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: geo.zx + (geo.cx - geo.zx) * i / 8, y: geo.zy + (geo.cy - geo.zy) * i / 8, id: 2 }] });
      await page.waitForTimeout(10);
    }
    const cover = await page.evaluate(() => {
      const ring = document.getElementById('stickRing');
      const r = ring.getBoundingClientRect();
      const bad = [];
      for (const id of ['btnPrimary', 'btnSecondary', 'btnTertiary', 'btnSprint']) {
        const b = document.getElementById(id).getBoundingClientRect();
        const ovl = r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom;
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (ovl && !(top && top.closest && top.closest('#' + id))) bad.push(id);
      }
      return { active: ring.classList.contains('active'), bad };
    });
    check(tag, '#stickRing never covers #cluster buttons (R#10)', cover.bad.length === 0, cover);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    for (const p of pts) {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.waitForTimeout(30);
      const it = await sample();
      check(tag, 'joystick mouse press at (' + p.x + ',' + p.y + ') without move -> mag 0', it.mag === 0, it);
      await page.mouse.up();
      await sample();
    }
  }
}

async function interactionChecks(page, tag) {
  // Language chip -> English title (B4), then back.
  const r = await page.evaluate(async () => {
    await window.__t.setScene('title');
    document.querySelector('[data-action=lang]').click();
    const en = { play: document.getElementById('btnStart').textContent, lang: window.__t.getLang(), body: document.body.innerText.includes('开始游戏') };
    document.querySelector('[data-action=lang]').click();
    return { en, zh: document.getElementById('btnStart').textContent };
  });
  check(tag, 'lang chip -> Play / back to 开始游戏 (B4)', r.en.play === 'Play' && r.en.lang === 'en' && !r.en.body && r.zh === '开始游戏', r);
  // Lineup: tap Kobe then LeBron -> swapped, All-Star kits, white/black team names (B30).
  const s = await page.evaluate(async () => {
    await window.__t.setScene('lineup');
    const t = window.__t;
    const card = (id) => document.querySelector('#screenLineup .card[data-id="' + id + '"]');
    card('kobe').click(); card('lebron').click();
    const l = t.lineupScreen.lineup;
    return { a: l.a.join(), b: l.b.join(), modeA: t.match.kitMode('kobe'), name: t.match.teamName(0), toast: document.querySelector('.luToast').classList.contains('show'),
      calls: JSON.stringify(t.calls.filter((c) => Array.isArray(c) && c[0] === 'swap')) };
  });
  check(tag, 'swap Kobe <-> LeBron (B30)', s.a === 'kobe,kyrie,giannis' && s.b === 'jordan,lebron,yao' && s.modeA === 'allstarA' && s.name === '白队' && s.toast, s);
  // Star handler + user B + kits classic -> clash warning (B31).
  const h = await page.evaluate(async () => {
    const t = window.__t;
    const st = document.querySelector('#screenLineup .card[data-id="giannis"] .cStar');
    st.click();
    const afterStar = t.lineupScreen.lineup.a.join();
    document.querySelector('#screenLineup [data-user="b"]').click();
    document.querySelector('#screenLineup [data-kits="classic"]').click();
    const hint = document.querySelector('#screenLineup .luHint');
    const res = { afterStar, user: t.lineupScreen.lineup.user, kits: t.lineupScreen.lineup.kits, clash: hint.classList.contains('warn'), hint: hint.textContent,
      handlerB: document.querySelector('#screenLineup .card[data-slot="3"]').classList.contains('handler') };
    document.querySelector('#screenLineup .luActs .secondary:nth-child(2)').click();   // reset
    res.reset = t.lineupScreen.lineup.a.join() + '|' + t.lineupScreen.lineup.kits + '|' + t.match.teamName(0);
    return res;
  });
  check(tag, 'star makes Giannis the handler; user B; classic clash; reset (B31)', h.afterStar === 'giannis,kyrie,kobe' && h.user === 'b' && h.kits === 'classic' && h.clash && h.handlerB
    && h.reset === 'lebron,kyrie,giannis|auto|暗夜队', h);
  // Settings click persists in the model and toggles selection.
  const st = await page.evaluate(async () => {
    await window.__t.setScene('settings');
    document.querySelector('#settingsRows .opt[data-key="camera"][data-idx="1"]').click();
    const sel = document.querySelector('#settingsRows .opt[data-key="camera"][data-idx="1"]').classList.contains('selected');
    const auto = document.querySelector('#settingsRows .opt[data-key="quality"][data-idx="0"]').textContent;
    return { cam: window.__t.settings.get('camera'), sel, auto };
  });
  check(tag, 'settings option click -> settings.set + selected; Auto label shows the tier', st.cam === 'close' && st.sel && st.auto === '自动 · 中', st);
  // Halftime: reserved keys never skip, other keys and taps do (R#21).
  const ht = await page.evaluate(async () => {
    await window.__t.setScene('halftime');
    const t = window.__t; t.calls.length = 0;
    for (const code of ['KeyP', 'Escape', 'KeyM', 'KeyT']) document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code }));
    const reserved = t.calls.filter((c) => c === 'halfSkip').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a' }));
    document.getElementById('halftime').click();
    return { reserved, after: t.calls.filter((c) => c === 'halfSkip').length };
  });
  check(tag, 'halftime: P/Esc/M/T do not skip, other key + tap do (R#21)', ht.reserved === 0 && ht.after === 2, ht);
  // Banner and caption re-render on a language toggle (R#20); bannerState survives (R#22).
  const bn = await page.evaluate(async () => {
    await window.__t.setScene('game');
    const t = window.__t;
    t.hud.banner('banner.plus', { n: 3, name: t.match.legend('giannis').short }, 5000);
    t.frame(1);
    const tagHidden = !document.getElementById('nameTag').classList.contains('on');
    t.setLang('en');
    const en = { banner: document.getElementById('bannerName').textContent, caption: document.getElementById('caption').textContent };
    const stash = t.hud.bannerState();
    t.hud.banner(null);
    t.hud.banner(stash.key, stash.params, stash.ms);
    const again = document.getElementById('banner').classList.contains('show') && document.getElementById('bannerVal').textContent === '+3';
    t.setLang('zh');
    return { en, again, stash: !!stash, tagHidden };
  });
  check(tag, 'banner + caption re-render in English; bannerState re-issues (R#20, R#22)', bn.en.banner === 'Giannis' && bn.en.caption === 'Giannis hits the three!' && bn.again && bn.stash && bn.tagHidden, bn);
  // H10: hud.update allocates nothing per frame (players moving, meter filling, clocks running).
  const alloc = await page.evaluate(async () => {
    await window.__t.setScene('gameMeter');
    const t = window.__t, w = t.world, m = t.meter;
    for (let i = 0; i < 600; i++) t.frame(1);          // warm-up (JIT, string tables, first DOM writes)
    if (typeof gc === 'function') gc();
    const before = performance.memory ? performance.memory.usedJSHeapSize : 0;
    for (let i = 0; i < 3000; i++) { const p = w.players[0]; p.pos.x = 0.3 + Math.sin(i * 0.05) * 0.5; m.fill = (i % 90) / 72; w.gameClock = 100 - i * 0.016; t.frame(1); }
    if (typeof gc === 'function') gc();
    const after = performance.memory ? performance.memory.usedJSHeapSize : 0;
    return { hasGc: typeof gc === 'function', grow: after - before };
  });
  console.log('info - ' + tag + ' hud.update heap growth over 3000 frames: ' + JSON.stringify(alloc));
  check(tag, 'hud.update steady state: heap growth < 256 KB over 3000 frames (H10)', !alloc.hasGc || alloc.grow < 262144, alloc);
  // Stage drag reports onDrag / onRelease.
  const dr = await page.evaluate(async () => {
    await window.__t.setScene('lineup');
    const st = document.querySelector('#screenLineup .luStage');
    const b = st.getBoundingClientRect();
    const y = b.top + 20, x0 = b.left + b.width / 2;
    const ev = (type, x, ts) => st.dispatchEvent(new PointerEvent(type, { pointerId: 9, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
    window.__t.calls.length = 0;
    ev('pointerdown', x0); ev('pointermove', x0 + 20); ev('pointermove', x0 + 45); ev('pointerup', x0 + 45);
    const c = window.__t.calls;
    return { drags: c.filter((q) => q[0] === 'drag').map((q) => q[1]), rel: c.filter((q) => q[0] === 'release').length };
  });
  check(tag, 'turntable drag -> onDrag(dx) + onRelease', dr.drags.join() === '20,25' && dr.rel === 1, dr);
}

(async () => {
  fs.mkdirSync(shotDir, { recursive: true });
  const { server, url } = await startServer(dir);
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
  const errors = [];
  try {
    for (const vp of VIEWPORTS) {
      if (only && !only.includes(vp.name)) continue;
      const ctx = await browser.newContext(vp.ctx);
      const page = await ctx.newPage();
      await page.route('**/src/main.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export {};' }));
      page.on('pageerror', (e) => errors.push(vp.name + ': ' + String(e && e.stack || e)));
      page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(vp.name + ' console: ' + msg.text()); });
      await page.goto(url + 'index.html', { waitUntil: 'load' });
      const W = vp.ctx.viewport.width, Hh = vp.ctx.viewport.height;
      if (vp.name === 'phonePortrait' && !noShots) await page.screenshot({ path: path.join(shotDir, 'static-loading-' + W + 'x' + Hh + '.png') });
      await page.addScriptTag({ type: 'module', content: BOOT });
      await page.waitForFunction(() => !!window.__t, null, { timeout: 15000 });
      const scenes = vp.scenes || SCENES;
      for (const lang of ['zh', 'en']) {
        await page.evaluate((l) => window.__t.setLang(l), lang);
        for (const scene of scenes) {
          await page.evaluate((s) => window.__t.setScene(s), scene);
          const m = await page.evaluate(measure);
          sceneChecks(vp.name + ' ' + W + 'x' + Hh + ' ' + lang + ' ' + scene, scene, m, lang);
          if ((vp.shots || allShots) && !noShots && (lang === 'zh' || EN_SHOTS.includes(scene))) {
            await page.screenshot({ path: path.join(shotDir, scene + '-' + W + 'x' + Hh + (lang === 'en' ? '-en' : '') + '.png') });
          }
        }
      }
      await page.evaluate((l) => window.__t.setLang(l), 'zh');
      if (!vp.scenes) {
        await page.evaluate(() => window.__t.setScene('game'));
        await joystickChecks(vp.name, page, vp);
      }
      if (vp.name === 'phoneLandscape' || vp.name === 'phonePortrait') await interactionChecks(page, vp.name);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  check('all', 'no page errors / console errors', errors.length === 0, errors);
  console.log(failures === 0 ? 'layout-check: ALL OK (' + passes + ' checks)' : 'layout-check: ' + failures + ' FAILURES, ' + passes + ' passed');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
