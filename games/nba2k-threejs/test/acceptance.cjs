#!/usr/bin/env node
'use strict';
/**
 * @module test/acceptance
 * Acceptance checklist v2 of 传奇对决 3v3 / LEGENDS 3v3 (spec v2 §9: B1–B61; B1–B27 replace v1 A1–A27 one-to-one,
 * B28–B61 are new). Playwright + headless Chromium (SwiftShader through ANGLE, §9.1), one static server for the run,
 * one shared browser, a fresh browser context (page) per item and per device.
 *
 * Usage (from games/nba2k-threejs/):
 *   node test/acceptance.cjs                 all items, B1 → B61, sequential
 *   node test/acceptance.cjs B5 B30-B33      only these items (ids and ranges)
 *   node test/acceptance.cjs --static        only the static checks (B2, B3 and the static halves of B35, B59)
 *   node test/acceptance.cjs --list          print the items, their kind and the __game hooks each one needs
 *   options: --keep-shots (keep screenshots under test/results/shots/), --timeout=<s> (override every item timeout),
 *            --headed, --bail (stop after the first failure)
 * Output: one ✅/❌ line per item, ⚠ observations, ✗ failure text; JSON summary in test/results/acceptance.json
 * (`--static` writes test/results/acceptance-static.json). Exit code 1 when any item failed, 2 on usage errors.
 *
 * Design notes:
 * - Every runtime item fails fast with "game not integrated" while `src/main.js`/`src/flow.js` (WP9a) are missing, and
 *   with "missing __game hook(s)" when a §5.15 hook it needs does not exist (see `needs` on each item / `--list`).
 * - An in-page helper library (`window.__acc`, installed by `installHelpers`) spies on every §1.4.1 game event through
 *   `game.on`, counts fixed steps by wrapping `game.step` (also used to freeze the simulation for still frames), and
 *   offers synchronous simulation (`acc.sim`), trials (`shootTrial`, `passTrial`) and projections with this frame's
 *   camera matrices.
 * - Items that judge frame-by-frame behaviour (B32–B34, B48, B49, B60, B61) install a virtual clock before any page
 *   script runs (`CLOCK_INIT`): in "fixed" mode every rendered frame advances `performance.now()` and the rAF timestamp
 *   by exactly one step (16.67 ms unless set), so timelines, camera easing and the quality monitor see a steady
 *   cadence regardless of how slowly SwiftShader renders. Timings in those items are virtual (in-page) milliseconds.
 * - Expected numbers come from the spec tables (constants below) and, where the spec defines a formula, from the pure
 *   source modules imported in Node (`src/shot.js`, `src/ratings.js`, `src/anim/select.js`, `src/legends.js`,
 *   `src/i18n.js`): B7 (run·sprintMul·handlerMul), B10 (getTiming), B13 (§5.3.4 make probability), B30/B31 (kits).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');
const H = require('./harness.cjs');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results');
const SHOTS_DIR = path.join(RESULTS_DIR, 'shots');
const SHOWCASE_DIR = path.join(RESULTS_DIR, 'showcase');
const argv = process.argv.slice(2);
const KEEP_SHOTS = argv.includes('--keep-shots');
const STATIC_ONLY = argv.includes('--static');
const LIST_ONLY = argv.includes('--list');
const HEADED = argv.includes('--headed');
const BAIL = argv.includes('--bail');
const TIMEOUT_OVERRIDE = (() => { const a = argv.find((x) => x.startsWith('--timeout=')); return a ? Number(a.slice(10)) * 1000 : 0; })();
const DEFAULT_TIMEOUT_MS = 300000;
const QUICK = '?quick=1&intro=0&seed=7';   // §9.1 startGame URL

class Fail extends Error {}
class Skip extends Error {}
function fail(msg) { throw new Fail(msg); }
function skip(msg) { throw new Skip(msg); }
function assert(cond, msg) { if (!cond) fail(typeof msg === 'function' ? msg() : msg); }
function eq(actual, expected, what) { if (actual !== expected) fail(`${what}: expected ${fmt(expected)}, got ${fmt(actual)}`); }
function near(actual, expected, tol, what) { if (!(Math.abs(actual - expected) <= tol)) fail(`${what}: expected ${expected} ± ${tol}, got ${fmt(actual)}`); }
function fmt(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const r3 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);

// ------------------------------------------------------------------------------------------------ spec constants
const IDS = ['kobe', 'jordan', 'lebron', 'giannis', 'yao', 'kyrie'];
const SPEC = {
  /** §3.4 dims.heightBarefoot (m). */
  heights: { kobe: 1.96, jordan: 1.96, lebron: 2.03, giannis: 2.09, yao: 2.27, kyrie: 1.87 },
  /** §4.9.2 expected ball height at launch, mid-range (±0.08 m). */
  launchMid: { kobe: 2.87, jordan: 2.89, lebron: 2.66, giannis: 2.65, yao: 2.88, kyrie: 2.59 },
  /** §3.9 "players baked" column: expression channels per legend. */
  morphs: {
    kobe: ['jawOpen', 'jawJut', 'scowl', 'blink'],
    jordan: ['jawOpen', 'tongueOut', 'smirk', 'scowl', 'blink'],
    lebron: ['jawOpen', 'roar', 'scowl', 'puff', 'blink'],
    giannis: ['jawOpen', 'roar', 'grin', 'scowl', 'blink'],
    yao: ['jawOpen', 'roar', 'grin', 'scowl', 'puff', 'blink'],
    kyrie: ['jawOpen', 'smirk', 'scowl', 'blink'],
  },
  /** §7.5 gameplay-frame budgets. */
  budgets: {
    low: { calls: 48, tris: 70000, texMB: 48 },
    medium: { calls: 75, tris: 190000, texMB: 150 },
    highTouch: { calls: 105, tris: 330000, texMB: 230 },
    highDesktop: { calls: 105, tris: 330000, texMB: 300 },
  },
  crowd: { low: 700, medium: 1600, high: 2600 },          // §7.4
  dprMax: { low: 1.0, medium: 1.5, high: 2.0 },            // §7.1 top rung of each tier
  topRung: { low: 2, medium: 4, high: 6 },
  teamBg: { dark: '#6F263D', bright: '#CE1141', allstarA: '#F4F4F1', allstarB: '#121212' },   // §2.9 TEAM_UI
  kitBase: { dark: '#6F263D', bright: '#CE1141' },          // B26 kit base of each team's ★
  defaultLineup: { a: ['lebron', 'kyrie', 'giannis'], b: ['jordan', 'kobe', 'yao'] },
  rHand: { base: 0.30, chaseDown: 0.36, anchor: 0.34, help: 0.34 },   // C2
  payloadMB: 5.4, assetsMB: 3.5, maxRequests: 110,          // §6.6 / C34
  lines: { THREE_R: 7.24, ARC_TOP_Z: -5.51, FT_Z: -8.535, FT_CIRCLE_R: 1.8 },
  rim: { x: 0, y: 3.048, z: -12.75 },
  replay: { duration: 3.0, durationTol: 0.2, startMax: 1.2, tapEnd: 0.2 },
  intro: { full: 16.5, short: 5.0, skipAll: 0.3 },
};
/** §1.4.1 game events (complete list). */
const EVENTS = ['caption', 'banner', 'state', 'shot', 'pumpFake', 'move', 'jab', 'takeoff', 'release', 'slam', 'land', 'plant', 'ball',
  'score', 'miss', 'block', 'steal', 'intercept', 'deflect', 'ankle', 'bump', 'shake', 'ability', 'pass', 'catch', 'rebound',
  'possession', 'turnover', 'clock', 'buzzer', 'quarter', 'gameover'];
/** UI strings the items look for (spec §6.8, v1 §13). */
const TXT = {
  zh: { play: '开始游戏', quick: '快速比赛', shoot: '投篮', block: '盖帽', pass: '传球', switch: '换人', cross: '变向', steal: '抢断', sprint: '冲刺', q1: '第1节', ot: '加时', overtime: '加时赛', dismiss: '知道了', resume: '继续', dark: '暗夜', bright: '烈阳', white: '白队', black: '黑队', title: '传奇对决 3v3', clash: '经典球衣可能撞色', webgl1: '设备不支持高清球员', halftime: '半场' },
  en: { play: 'Play', quick: 'Quick Game', shoot: 'SHOOT', block: 'BLOCK', pass: 'PASS', switch: 'SWITCH', cross: 'CROSS', steal: 'STEAL', sprint: 'SPRINT', q1: 'Q1', ot: 'OT', overtime: 'OVERTIME', dismiss: 'Got it', resume: 'Resume', dark: 'DRK', bright: 'BRT', white: 'WHT', black: 'BLK', title: 'LEGENDS 3v3', clash: 'Classic kits may clash', webgl1: 'WebGL2', halftime: 'HALFTIME' },
};
/** §9.2 denylist v2 (word-boundary, case-sensitive; CJK entries without \b). */
const DENYLIST = ['Lakers', 'Celtics', 'Warriors', 'Bulls', 'Knicks', 'Heat', 'Nets', 'Spurs', 'Suns', 'Bucks', 'Mavericks', 'Rockets',
  'Clippers', 'Nuggets', 'Jazz', 'Raptors', 'Sixers', '76ers', 'Cavaliers', 'Thunder', 'Grizzlies', 'Kings', 'Hawks', 'Hornets', 'Magic',
  'Pacers', 'Pelicans', 'Pistons', 'Timberwolves', 'Trail Blazers', 'Wizards', 'Curry', 'Durant', 'Jokic', 'NBA', '2K',
  'Air Jordan', 'Jumpman', 'Mamba', 'Black Mamba', 'King James', 'Greek Freak', 'Uncle Drew', 'Concord', 'Bred', 'Nike', 'Adidas',
  'Spalding', 'Wilson', 'Swoosh', 'Gatorade', 'Under Armour',
  '湖人', '公牛', '骑士', '雄鹿', '火箭', '凯尔特人', '勇士', '热火', '篮网', '耐克', '阿迪达斯', '黑曼巴', '飞人', '小皇帝', '德鲁大叔'];
const CJK_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/;
const isCjk = (s) => CJK_RE.test(s);
/** Builds the §9.2 regex of one denylist entry. */
function denyRe(w) {
  const body = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  return isCjk(w) ? new RegExp(body) : new RegExp('\\b' + body + '\\b');
}

// ------------------------------------------------------------------------------------------------ static helpers
function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out); else if (!filter || filter(p)) out.push(p);
  }
  return out;
}
const listSrc = () => walk(path.join(ROOT, 'src'), (p) => p.endsWith('.js'));
const readText = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
function lineOf(text, index) { return text.slice(0, index).split('\n').length; }
function lineCount(text) { return (text.match(/\n/g) || []).length; }   // = wc -l
function dirBytes(p) { if (!fs.existsSync(p)) return 0; const st = fs.statSync(p); if (!st.isDirectory()) return st.size; return walk(p).reduce((s, f) => s + fs.statSync(f).size, 0); }

/** Masks comments and/or string literals with spaces (keeps offsets and line numbers). Template literals: masked whole. */
function maskJs(code, { strings = true, comments = true } = {}) {
  const out = code.split(''); let i = 0; const n = code.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  let prevSig = '';   // previous significant char, for the regex-literal heuristic
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === '/' && d === '/') { let j = i; while (j < n && code[j] !== '\n') j++; if (comments) blank(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = code.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; if (comments) blank(i, j); i = j; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n) { if (code[j] === '\\') { j += 2; continue; } if (code[j] === c) break; if (c !== '`' && code[j] === '\n') break; j++; }
      j = Math.min(n, j + 1); if (strings) blank(i + 1, j - 1); i = j; prevSig = c; continue;
    }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]$|^$/.test(prevSig)) {
      // regex literal: skip to the closing slash (character classes may contain '/')
      let j = i + 1, cls = false;
      while (j < n && code[j] !== '\n') { const ch = code[j]; if (ch === '\\') { j += 2; continue; } if (ch === '[') cls = true; else if (ch === ']') cls = false; else if (ch === '/' && !cls) break; j++; }
      if (strings) blank(i + 1, j); i = j + 1; prevSig = '/'; continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}
/** First `await` at module top level (outside every function/class/block), or null. */
function topLevelAwait(code) {
  const m = maskJs(code); let depth = 0; const re = /[{}()[\]]|\bawait\b|\bfor\s+await\b/g; let x;
  while ((x = re.exec(m))) {
    const s = x[0];
    if (s === '{' || s === '(' || s === '[') depth++;
    else if (s === '}' || s === ')' || s === ']') depth--;
    else if (depth === 0) return { line: lineOf(m, x.index), snippet: m.slice(Math.max(0, x.index - 40), x.index + 30).replace(/\s+/g, ' ').trim() };
  }
  return null;
}
/** Static import/export specifiers + dynamic `import(` calls. */
function importSpecifiers(code) {
  const m = maskJs(code, { strings: false, comments: true }); const out = [];
  const re = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\3/g; let x;
  while ((x = re.exec(m))) out.push({ spec: x[2] || x[4], line: lineOf(m, x.index), dynamic: false });
  const md = maskJs(code, { strings: true, comments: true }); const dre = /\bimport\s*\(/g;
  while ((x = dre.exec(md))) out.push({ spec: '(dynamic)', line: lineOf(md, x.index), dynamic: true });
  return out;
}
/** Depth-correct three.js specifier for a src file (H2): src/x.js → ../vendor/three.module.js, src/a/x.js → ../../… */
function vendorSpecFor(file) { const depth = rel(file).split('/').length - 1; return '../'.repeat(depth) + 'vendor/three.module.js'; }

// ------------------------------------------------------------------------------------------------ PNG decode + pixel maths
function decodePng(buf) {
  for (const mod of ['pngjs', '/opt/node22/lib/node_modules/pngjs']) {
    try { const { PNG } = require(mod); const p = PNG.sync.read(buf); return { width: p.width, height: p.height, data: p.data, bpp: 4 }; } catch (e) { /* built-in decoder below */ }
  }
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0; const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8); const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || !(ctype === 2 || ctype === 6)) throw new Error(`unsupported PNG (depth ${depth}, colour type ${ctype}, interlace ${interlace})`);
  const bpp = ctype === 6 ? 4 : 3, stride = width * bpp; const raw = zlib.inflateSync(Buffer.concat(idat)); const out = Buffer.alloc(width * height * bpp);
  let prev = Buffer.alloc(stride), ip = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[ip++]; const line = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v = raw[ip + x]; let val;
      switch (f) {
        case 0: val = v; break; case 1: val = v + a; break; case 2: val = v + b; break; case 3: val = v + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error('bad PNG filter ' + f);
      }
      line[x] = val & 255;
    }
    ip += stride; prev = line;
  }
  return { width, height, data: out, bpp };
}
const px = (img, x, y) => { const i = (y * img.width + x) * img.bpp; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
/** Rec. 709 luma of gamma-encoded sRGB bytes, 0..1. */
const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
/** Relative luminance (linear) of sRGB bytes, and its sRGB encoding (perceptual lightness on the luma scale). */
const lin8 = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const relY = (r, g, b) => 0.2126 * lin8(r) + 0.7152 * lin8(g) + 0.0722 * lin8(b);
const encodeY = (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
function hexRgb(hex) { const v = parseInt(hex.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
/** HSV of sRGB bytes: h in degrees [0, 360), s and v in 0..1. */
function hsv(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255; const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  let h = 0;
  if (d > 1e-9) { if (mx === R) h = 60 * (((G - B) / d) % 6); else if (mx === G) h = 60 * ((B - R) / d + 2); else h = 60 * ((R - G) / d + 4); }
  if (h < 0) h += 360;
  return { h, s: mx > 0 ? d / mx : 0, v: mx };
}
const wrap180 = (a) => { let x = ((a + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };
const hueDist = (a, b) => Math.abs(wrap180(a - b));
const median = (arr) => { if (!arr.length) return NaN; const s = arr.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length & 1 ? s[m] : 0.5 * (s[m - 1] + s[m]); };
/** Fraction of pixels with luma above thr (sampled every `step` px). */
function lumaFraction(img, thr, step = 2) {
  let n = 0, hit = 0;
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) { const [r, g, b] = px(img, x, y); n++; if (luma(r, g, b) > thr) hit++; }
  return hit / n;
}
/** Fraction of pixels whose max channel difference exceeds thr (optionally inside rect {x,y,w,h} of both images). */
function diffFraction(a, b, thr = 24, step = 1, ra = null, rb = null) {
  const A = ra || { x: 0, y: 0, w: a.width, h: a.height }, B = rb || { x: 0, y: 0, w: b.width, h: b.height };
  if (A.w !== B.w || A.h !== B.h) return 1;
  let n = 0, hit = 0;
  for (let y = 0; y < A.h; y += step) for (let x = 0; x < A.w; x += step) {
    const p = px(a, A.x + x, A.y + y), q = px(b, B.x + x, B.y + y); n++;
    if (Math.abs(p[0] - q[0]) > thr || Math.abs(p[1] - q[1]) > thr || Math.abs(p[2] - q[2]) > thr) hit++;
  }
  return n ? hit / n : 1;
}
/** Clamps a centre box {cx, cy, w, h} (CSS px) to the image; returns integer {x, y, w, h} or null. */
function clampBox(img, b) {
  const x0 = Math.max(0, Math.round(b.cx - b.w / 2)), y0 = Math.max(0, Math.round(b.cy - b.h / 2));
  const x1 = Math.min(img.width, Math.round(b.cx + b.w / 2)), y1 = Math.min(img.height, Math.round(b.cy + b.h / 2));
  return x1 - x0 >= 2 && y1 - y0 >= 2 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
/**
 * B26/B42 kit test inside a torso box: drop pixels with saturation < 0.30 or hue within ±20° of the number colour,
 * then the median hue offset of the rest from the kit base hue (circular, in degrees) and the kept share.
 */
function kitBoxStats(img, box, { baseHex, numberHex, mask = null }) {
  const b = clampBox(img, box); if (!b) return null;
  const base = hsv(...hexRgb(baseHex)).h; const nh = numberHex ? hsv(...hexRgb(numberHex)) : null;
  const numHue = nh && nh.s >= 0.15 ? nh.h : null;
  let n = 0; const offs = []; const lumas = []; const ys = [];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    if (mask && !mask(x, y)) continue;   // only the kit's own visible pixels (ball, hands, floor excluded)
    const [r, g, bl] = px(img, x, y); n++; lumas.push(luma(r, g, bl)); ys.push(relY(r, g, bl));
    const c = hsv(r, g, bl); if (c.s < 0.30) continue; if (numHue != null && hueDist(c.h, numHue) <= 20) continue;
    offs.push(wrap180(c.h - base));
  }
  if (!n) return null;
  const medOff = median(offs);
  return { box: b, n, kept: offs.length, keptFrac: offs.length / n, hueErr: Math.abs(medOff), medHue: (base + medOff + 360) % 360, meanLuma: lumas.reduce((s, v) => s + v, 0) / n, medianLuma: median(lumas), meanLight: encodeY(ys.reduce((s, v) => s + v, 0) / n) };
}
/** Mean luma of a box. */
function boxLuma(img, box) {
  const b = clampBox(img, box); if (!b) return NaN; let s = 0, n = 0;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) { const [r, g, bl] = px(img, x, y); s += luma(r, g, bl); n++; }
  return s / n;
}
/** True when the image contains a pixel within tol (max channel) of rgb; also returns the count. */
function findColor(img, rgb, tol = 40, step = 2) {
  let count = 0, best = Infinity;
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) { const p = px(img, x, y); const d = Math.max(Math.abs(p[0] - rgb[0]), Math.abs(p[1] - rgb[1]), Math.abs(p[2] - rgb[2])); if (d <= tol) count++; if (d < best) best = d; }
  return { found: count > 0, count, best };
}
/** The showcase prints the legends' names as an HTML band at the top of the lineup (top 6 px, 13 px font); figure
 * segmentation starts below it so the names are not taken for figures (the 3D figures never reach that band). */
const SHOWCASE_LABEL_BAND = 28;
/**
 * Splits a showcase screenshot (background #2a2f3a) into figures: runs of columns that contain non-background pixels,
 * merging gaps ≤ `gap` px. Each figure: {x0, x1, top, bottom, h, cx}.
 */
function figures(img, { bg = [0x2a, 0x2f, 0x3a], thr = 24, gap = 3, minW = 6, y0 = SHOWCASE_LABEL_BAND } = {}) {
  const isFg = (x, y) => { const p = px(img, x, y); return Math.abs(p[0] - bg[0]) > thr || Math.abs(p[1] - bg[1]) > thr || Math.abs(p[2] - bg[2]) > thr; };
  const col = new Uint8Array(img.width);
  for (let x = 0; x < img.width; x++) for (let y = y0; y < img.height; y++) if (isFg(x, y)) { col[x] = 1; break; }
  const runs = []; let start = -1, last = -1;
  for (let x = 0; x < img.width; x++) {
    if (!col[x]) continue;
    if (start < 0) { start = x; last = x; } else if (x - last - 1 <= gap) last = x; else { runs.push([start, last]); start = x; last = x; }
  }
  if (start >= 0) runs.push([start, last]);
  return runs.filter(([a, b]) => b - a + 1 >= minW).map(([x0, x1]) => {
    let top = img.height, bottom = -1;
    for (let xx = x0; xx <= x1; xx++) for (let y = y0; y < img.height; y++) if (isFg(xx, y)) { if (y < top) top = y; if (y > bottom) bottom = y; }
    return { x0, x1, top, bottom, h: bottom - top + 1, cx: (x0 + x1) / 2 };
  });
}

// ------------------------------------------------------------------------------------------------ Node-side src modules
let MODS = null;
/** Pure source modules imported in Node (ESM) for expected values. */
async function mods() {
  if (MODS) return MODS;
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const [legends, ratings, shot, select, lineup, i18n] = await Promise.all(['src/legends.js', 'src/ratings.js', 'src/shot.js', 'src/anim/select.js', 'src/lineup.js', 'src/i18n.js'].map(imp));
  MODS = { legends, ratings, shot, select, lineup, i18n };
  return MODS;
}
/** §5.3.4 make probability of a recorded jumper trial (`tr` from acc.shootTrial with `contest: true`). */
function expectedMakeP(M, tr, difficulty = 'normal') {
  const L = M.legends.LEGENDS[tr.id]; const R = L.ratings; const S = M.shot;
  const x = tr.rel ? tr.rel.x : tr.at.x, z = tr.rel ? tr.rel.z : tr.at.z;
  const d = S.shotDistance(x, z); const kind = (tr.rel && tr.rel.kind) || 'jumper'; const variant = (tr.rel && tr.rel.variant) || 'set';
  const zone = (tr.rel && tr.rel.zone) || S.resolveShotZone(kind, d, x, z);
  const pgTyped = S.pg(zone, d, R) * S.typeMul(kind, variant);
  const gS = S.greenHalfWidth(M.ratings.zoneRating(R, zone), S.gDiffFor('human', difficulty), kind);
  const T = S.timingFactor(tr.eT, gS);
  const C = tr.contest && typeof tr.contest.C === 'number' ? tr.contest.C : 1;
  const F = S.fatigueFactor(tr.rel && typeof tr.rel.stamina === 'number' ? tr.rel.stamina : 1);
  return S.makeProbability(kind, pgTyped, T, C, F, 1, 1, S.diffMul('human', difficulty));
}

// ------------------------------------------------------------------------------------------------ virtual clock (init script)
/**
 * Installed with `addInitScript` before any page script. `__accClock.set('fixed', stepMs, k)` makes every rendered
 * frame advance the rAF timestamp and `performance.now()` by exactly `stepMs` (inside a frame `now()` advances by
 * real elapsed × k, so busy times stay tiny and monotonic); `set('real')` returns to real time without a jump back.
 */
const CLOCK_INIT = `(() => {
  if (window.__accClock) return;
  const realRaf = window.requestAnimationFrame.bind(window);
  const P = window.performance; const realNow = P.now.bind(P);
  const C = { mode: 'real', step: 1000 / 60, k: 0.01, frames: 0, offset: 0, frameVirt: 0, frameReal: 0, lastTs: -1 };
  function now() { return C.mode === 'real' ? realNow() + C.offset : C.frameVirt + (realNow() - C.frameReal) * C.k; }
  C.now = now;
  C.set = function (mode, step, k) {
    const cur = now();
    if (step) C.step = step; if (k != null) C.k = k;
    C.mode = mode;
    if (mode === 'real') C.offset = cur - realNow(); else { C.frameVirt = cur; C.frameReal = realNow(); }
    return cur;
  };
  try { Object.defineProperty(P, 'now', { configurable: true, writable: true, value: now }); } catch (e) { try { P.now = now; } catch (e2) { /* ignore */ } }
  window.requestAnimationFrame = function (cb) {
    return realRaf(function (ts) {
      if (ts !== C.lastTs) {
        C.lastTs = ts; C.frames++;
        if (C.mode === 'fixed') { C.frameVirt += C.step; C.frameReal = realNow(); }
      }
      cb(C.mode === 'fixed' ? C.frameVirt : ts + C.offset);
    });
  };
  window.__accClock = C;
})();`;
/** Init script: Storage.prototype.getItem/setItem/removeItem throw (B31, B43). */
const STORAGE_THROWS_INIT = `(() => {
  const boom = function () { throw new DOMException('blocked by test', 'SecurityError'); };
  try { Storage.prototype.getItem = boom; Storage.prototype.setItem = boom; Storage.prototype.removeItem = boom; } catch (e) { /* ignore */ }
})();`;
/** Init script: no WebGL2 (B40 → simplified mode + toast.webgl1). */
const NO_WEBGL2_INIT = `(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) { if (type === 'webgl2') return null; return orig.call(this, type, attrs); };
  if (typeof OffscreenCanvas !== 'undefined') { const o2 = OffscreenCanvas.prototype.getContext; OffscreenCanvas.prototype.getContext = function (type, attrs) { if (type === 'webgl2') return null; return o2.call(this, type, attrs); }; }
})();`;

// ------------------------------------------------------------------------------------------------ in-page helper library
// Runs inside the browser (stringified): only touches window.__game hooks (§5.15), the DOM and src modules imported
// by URL. Never references Node scope. Installed as window.__acc; re-running it re-installs spies on a new game object.
function pageHelpers() {
  if (window.__acc && window.__acc.version === 2) return window.__acc.install();
  const FIXED = 1 / 60;
  const G = () => window.__game;
  const EVENTS = ['caption', 'banner', 'state', 'shot', 'pumpFake', 'move', 'jab', 'takeoff', 'release', 'slam', 'land', 'plant', 'ball',
    'score', 'miss', 'block', 'steal', 'intercept', 'deflect', 'ankle', 'bump', 'shake', 'ability', 'pass', 'catch', 'rebound',
    'possession', 'turnover', 'clock', 'buzzer', 'quarter', 'gameover'];
  const RIM = { x: 0, y: 3.048, z: -12.75 };
  const acc = { version: 2, evts: [], caps: [], banners: [], installed: {}, stepCount: 0, samplers: [], frameHooks: [], listeners: {}, frames: 0, frozen: false, M: {} };
  const simTime = () => acc.stepCount * FIXED;
  const vnow = () => performance.now();

  // ---- event spy
  function copyPayload(type, e) {
    const o = { type, sim: simTime(), real: vnow(), step: acc.stepCount, st: G() ? String(G().state) : '' };
    if (e && typeof e === 'object') {
      for (const k of Object.keys(e)) {
        const v = e[k];
        if (v == null || typeof v !== 'object') o[k] = v;
        else if (Array.isArray(v)) o[k] = v.slice(0, 16).map((x) => (x && typeof x === 'object' ? null : x));
        else if (k === 'params') { const p = {}; for (const pk of Object.keys(v)) { const pv = v[pk]; p[pk] = pv && typeof pv === 'object' ? (pv.zh || pv.en ? { zh: pv.zh, en: pv.en } : null) : pv; } o.params = p; }
        else if (typeof v.id === 'string') o[k] = v.id;
      }
    } else if (e !== undefined) o.value = e;
    return o;
  }
  function onGameEvent(type, e) {
    const o = copyPayload(type, e);
    acc.evts.push(o);
    if (acc.evts.length > 40000) acc.evts.splice(0, 10000);
    if (type === 'caption') acc.caps.push({ key: o.key, sim: o.sim, real: o.real, priority: o.priority });
    else if (type === 'banner') acc.banners.push({ key: o.key, sim: o.sim, real: o.real });
    const ls = acc.listeners[type];
    if (ls) for (const f of ls.slice()) { try { f(o, e); } catch (err) { acc.listenerError = String((err && err.stack) || err); } }
  }
  /** Synchronous listener on a game event (called inside game.emit); returns an unsubscribe function. */
  function onEvent(type, fn) { (acc.listeners[type] = acc.listeners[type] || []).push(fn); return () => { const l = acc.listeners[type]; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; }
  const since = (i, type) => acc.evts.slice(i).filter((x) => !type || x.type === type);

  function install() {
    const g = G(); if (!g) return null;
    const game = g.game;
    if (game && typeof game.step === 'function' && !game.__accStep) {
      const os = game.step;
      game.step = function () {
        if (acc.frozen) return undefined;
        const r = os.apply(this, arguments);
        acc.stepCount++;
        for (const f of acc.samplers.slice()) { try { f(); } catch (err) { acc.samplerError = String((err && err.stack) || err); } }
        return r;
      };
      game.__accStep = true; acc.installed.step = true;
    }
    if (game && typeof game.on === 'function' && !game.__accSpied) {
      game.__accSpied = true;
      for (const n of EVENTS) { try { game.on(n, (e) => onGameEvent(n, e)); acc.installed.events = true; } catch (err) { /* event not supported */ } }
    }
    const watch = (sel, list, key) => {
      const el = document.querySelector(sel); if (!el || acc.installed[key]) return;
      let last = '';
      new MutationObserver(() => { const s = (el.textContent || '').trim(); if (s && s !== last) { last = s; list.push({ text: s, sim: simTime(), real: vnow() }); } })
        .observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
      acc.installed[key] = true;
    };
    watch('#caption', acc.caps, 'domCaption'); watch('#banner', acc.banners, 'domBanner');
    if (!acc.installed.frameLoop) {
      acc.installed.frameLoop = true;
      const loop = (ts) => { acc.frames++; for (const f of acc.frameHooks.slice()) { try { f(ts); } catch (err) { acc.frameError = String((err && err.stack) || err); } } requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    return acc.installed;
  }

  // ---- accessors
  const players = () => (G() && G().world && G().world.players) || [];
  function pid(p) { if (!p) return null; if (typeof p === 'string') return p; if (typeof p.id === 'string') return p.id; if (typeof p.legendId === 'string') return p.legendId; if (p.legend && typeof p.legend.id === 'string') return p.legend.id; return null; }
  function teamOf(p) { if (!p) return -1; if (typeof p === 'string') p = byId(p); if (!p) return -1; if (typeof p.team === 'number') return p.team; if (typeof p.teamIdx === 'number') return p.teamIdx; if (p.team && typeof p.team.index === 'number') return p.team.index; return -1; }
  function byId(id) { return players().find((p) => pid(p) === id) || null; }
  const idx = (p) => players().indexOf(typeof p === 'string' ? byId(p) : p);
  function userTeam() { const w = G().world; if (typeof w.user === 'number') return w.user; if (w.user === 'a' || w.user === 'b') return w.user === 'a' ? 0 : 1; if (typeof w.userTeam === 'number') return w.userTeam; return teamOf(G().controlled); }
  function offenseTeam() { const w = G().world; if (typeof w.offense === 'number') return w.offense; return w.offense === 'a' ? 0 : w.offense === 'b' ? 1 : -1; }
  function userOff() { try { if (G().game && typeof G().game.userIsOffense === 'function') return !!G().game.userIsOffense(); } catch (e) { /* fall back */ } return offenseTeam() === userTeam(); }
  const state = () => String(G().state);
  const ctrl = () => G().controlled;
  const ctrlId = () => pid(G().controlled);
  function posOf(p) { if (typeof p === 'string') p = byId(p); if (!p) return null; const q = p.pos || p; return { x: q.x, z: q.z }; }
  function info(id) { try { return G().player(id); } catch (e) { return null; } }
  function scores() { const g = G(); const s = (g.game && g.game.score) || (g.world && g.world.score) || g.score; return Array.isArray(s) ? s.slice() : (s && typeof s === 'object' ? [s[0], s[1]] : [NaN, NaN]); }
  function paused() { const g = G(); return !!(g.paused || (g.game && g.game.paused) || (g.world && g.world.paused)); }
  function deadReason() { const g = G(); const r = (g.world && g.world.deadReason) ?? (g.game && g.game.deadReason) ?? null; return r == null ? null : String(r); }
  function statsOf(id) { const i = info(id); if (i && i.stats) return i.stats; const p = byId(id); return p && p.stats ? p.stats : null; }
  function ballHeld() { const b = G().ball; return !!b && (b.state === 'held' || b.state === 'dribble'); }
  const owner = () => (G().ball ? G().ball.owner : null);
  function speedOf(p) { if (typeof p === 'string') p = byId(p); if (!p || !p.vel) return 0; const vz = ('z' in p.vel) ? p.vel.z : p.vel.y; return Math.hypot(p.vel.x || 0, vz || 0); }
  function jumpOf(p) { if (typeof p === 'string') p = byId(p); if (!p) return 0; return typeof p.jumpY === 'number' ? p.jumpY : (p.pos && typeof p.pos.y === 'number' ? p.pos.y : 0); }
  function airborne(p) { if (typeof p === 'string') p = byId(p); return !!p && (p.isJumping === true || p.airborne === true || jumpOf(p) > 0.02); }
  const faceRim = (x, z) => Math.atan2(RIM.x - x, RIM.z - z);   // yaw convention: forward = (sin yaw, cos yaw)
  function place(id, x, z, yaw) { const g = G(); const y = yaw == null ? faceRim(x, z) : yaw; if (typeof g.place === 'function') return g.place(id, x, z, y); return g.teleport(idx(id), x, z); }
  function ballPos() { const b = G().ball; const p = b.pos || (b.mesh && b.mesh.position); return { x: p.x, y: ('y' in p) ? p.y : 0.12, z: p.z }; }

  // ---- intents (same semantics as input.js pressButton/releaseButton; unique pressTs so game.js edge dedupe sees them)
  function btn(name) { return G().input.intent[name]; }
  function pressBtn(name) { const b = btn(name); const ts = vnow() + 0.001 * (++acc._tsBump || (acc._tsBump = 1)); b.taps = b.taps > 0 && ts - b.pressTs <= 350 ? b.taps + 1 : 1; b.prevPressTs = b.pressTs; b.pressTs = ts; b.held = true; b.justPressed = true; b.doubleTap = b.taps >= 2; b.heldTime = 0; }
  function releaseBtn(name) { const b = btn(name); if (!b.held) return; const ts = Math.max(vnow(), b.pressTs + 1); b.releaseTs = ts; b.tapDur = Math.max(0, (ts - b.pressTs) / 1000); b.held = false; b.justReleased = true; b.heldTime = b.tapDur; b.quickTap = b.tapDur * 1000 < 120; }
  function clearEdges() { try { const it = G().input.intent; for (const k of ['primary', 'secondary', 'tertiary']) { const b = it[k]; b.justPressed = false; b.justReleased = false; b.doubleTap = false; b.quickTap = false; } if (it.pause) it.pause.justPressed = false; } catch (e) { /* ignore */ } }
  function setStick(x, z, mag) { const m = G().input.intent.move; m.x = x; m.z = z; m.mag = mag; }

  // ---- simulation without rendering
  function sim(sec) { const g = G(); const n = Math.max(1, Math.round(sec * 60)); if (g.game && typeof g.game.step === 'function') { for (let i = 0; i < n; i++) { g.game.step(FIXED); clearEdges(); } } else g.fastForward(sec); }
  /** Like sim() but samples the live DOM input before every step, as main.js's fixed-step loop does (held keys/sticks). */
  function simInput(sec) { const g = G(); const n = Math.max(1, Math.round(sec * 60)); const inp = g.input; for (let i = 0; i < n; i++) { if (inp && typeof inp.sample === 'function' && g.game.input === inp) inp.sample(performance.now()); g.game.step(FIXED); } }
  function simUntil(pred, maxSec, dt = 1 / 60) { const f = typeof pred === 'function' ? pred : new Function('g', 'acc', 'return (' + pred + ')'); let t = 0; const g = G(); while (t < maxSec) { if (f(g, acc)) return { ok: true, t: +t.toFixed(3), state: state() }; sim(dt); t += dt; } return { ok: !!f(g, acc), t: +t.toFixed(3), state: state() }; }
  function bumpScore(team, pts) { const g = G(); for (const s of [g.game && g.game.score, g.world && g.world.score]) if (s && typeof s[team] === 'number') s[team] += pts; }
  function forceTie() { const g = G(); const s = scores(); const m = Math.max(s[0], s[1]); for (const a of [g.game && g.game.score, g.world && g.world.score]) if (a && typeof a[0] === 'number') { a[0] = m; a[1] = m; } return [m, m]; }

  /** Steps until LIVE with the user on offence and the controlled player holding the ball (or on defence vs the CPU handler). */
  function ready(opts = {}) {
    const g = G(); const wantDef = !!opts.defense; let flips = 0;
    for (let i = 0; i < 1200; i++) {
      const st = state();
      if (st === 'MENU' || st === 'GAME_OVER' || st === 'LINEUP') return { ok: false, state: st, flips };
      if (st === 'LIVE' && !paused()) {
        if (g.world.gameClock < 25 && typeof g.setClock === 'function') g.setClock({ game: 110 });
        const off = userOff(); const b = g.ball; const held = ballHeld();
        if (wantDef) { if (!off) { if (held && b.owner && teamOf(b.owner) !== userTeam()) return { ok: true, flips, t: +(i / 20).toFixed(2) }; } else if (held || b.state === 'loose') { g.turnover(); flips++; sim(FIXED); } }
        else if (off) { if (held && b.owner === g.controlled) return { ok: true, flips, t: +(i / 20).toFixed(2) }; }
        else if (held || b.state === 'loose') { g.turnover(); flips++; sim(FIXED); }
      }
      sim(0.05);
    }
    return { ok: false, state: state(), flips, reason: 'timeout (60 s of simulation)' };
  }
  /** Makes `id`'s team the offence in LIVE and gives the ball to `id` when the game allows it (via debugShoot later). */
  function readyFor(id, opts = {}) {
    const g = G(); const t = teamOf(id); let flips = 0;
    for (let i = 0; i < 1200; i++) {
      const st = state();
      if (st === 'LIVE' && !paused()) {
        if (g.world.gameClock < 25) g.setClock({ game: 110 });
        if (g.world.shotClock < 6) g.setClock({ shot: 14 });
        if (offenseTeam() === t && ballHeld()) return { ok: true, flips };
        if (offenseTeam() !== t && (ballHeld() || g.ball.state === 'loose')) { g.turnover(); flips++; }
      } else if (st === 'MENU' || st === 'GAME_OVER') return { ok: false, state: st };
      sim(0.05);
    }
    return { ok: false, state: state(), flips, reason: 'timeout', opts };
  }
  function parkOpponents(team, except) {
    const opp = players().filter((p) => teamOf(p) !== team && p !== except);
    opp.forEach((p, k) => place(pid(p), -6.8 + 3.4 * k, -0.8, Math.PI));
    return opp.map(pid);
  }
  function forceJump(p) {
    if (typeof p === 'string') p = byId(p);
    try {
      for (const m of ['jump', 'startJump', 'defJump', 'tryJump', 'contestJump']) if (typeof p[m] === 'function') { p[m](); return m + '()'; }
      if (p.intent && p.intent.primary) { const b = p.intent.primary; b.pressTs = vnow() + 0.001 * (++acc._tsBump || (acc._tsBump = 1)); b.held = true; b.justPressed = true; return 'intent.primary'; }
    } catch (e) { return 'error: ' + e.message; }
    return null;
  }
  function contestSnap(id, kind) { const g = G(); if (typeof g.debugContest !== 'function') return null; const c = g.debugContest({ shooter: id, kind }); if (!c) return null; return { C: c.C, X: c.X, Xraw: c.Xraw, A: c.A, defender: pid(c.defender) || c.defender || null, parts: c.parts ? { Kd: c.parts.Kd, Kh: c.parts.Kh, Ks: c.parts.Ks } : null }; }

  /**
   * Repeated debugShoot trials by the controlled handler (or o.shooter). o = {n, p, e, eT, kind, variant, at:{x,z},
   * defenders:'none'|'away'|'front', front:{x,z}, jump, follow, contest, shooterParam}
   */
  function shootTrial(o) {
    const g = G(); const out = [];
    for (let a = 0; a < o.n; a++) {
      let id;
      if (o.shooter) { const r = readyFor(o.shooter); if (!r.ok) { out.push({ error: 'not ready: ' + JSON.stringify(r) }); break; } id = o.shooter; }
      else { const r = ready(); if (!r.ok) { out.push({ error: 'not ready: ' + JSON.stringify(r) }); break; } id = ctrlId(); }
      const team = teamOf(id);
      if (o.at) { place(id, o.at.x, o.at.z); sim(FIXED); }
      let front = null; let jumpForced = null;
      if (o.defenders === 'away') parkOpponents(team, null);
      if (o.defenders === 'front') {
        const opp = players().filter((p) => teamOf(p) !== team);
        front = o.frontId ? byId(o.frontId) : opp[0];
        parkOpponents(team, front);
        const sp = posOf(id); place(pid(front), o.front.x, o.front.z, Math.atan2(sp.x - o.front.x, sp.z - o.front.z));
        sim(FIXED);
      }
      const e0 = acc.evts.length, c0 = acc.caps.length, s0 = scores(), off0 = offenseTeam(), t0 = simTime();
      let rel = null, contest = null, slam = null, defAir = false;
      const un1 = onEvent('release', (e) => {
        if (rel || (e.playerId && e.playerId !== id)) return;
        const pp = posOf(id); const inf = info(id) || {}; const bp = ballPos();
        const mt = g.game && g.game.meter; const si = g.ball && g.ball.shotInfo;
        rel = { x: pp.x, z: pp.z, ballY: bp.y, stamina: inf.stamina, zone: e.zone, points: e.points, kind: e.kind, variant: e.variant, e: e.e, eT: e.eT, sim: e.sim,
          meterFill: mt && pid(mt.shooterId) === id ? mt.fill : null, siE: si && typeof si.e === 'number' ? si.e : null, siET: si && typeof si.eT === 'number' ? si.eT : null };
        if (front) defAir = airborne(front);
        if (o.contest) { try { contest = contestSnap(id, e.kind); } catch (err) { contest = { error: String(err) }; } }
      });
      const un2 = onEvent('slam', (e) => { if (!slam) slam = { ballY: ballPos().y, sim: e.sim }; });
      const params = {}; for (const k of ['p', 'e', 'eT', 'kind', 'variant']) if (o[k] != null) params[k] = o[k];
      if (o.shooter || o.shooterParam) params.shooter = id;
      let shotKind = null;
      try { shotKind = g.debugShoot(params); } catch (err) { un1(); un2(); out.push({ error: 'debugShoot threw: ' + err.message }); break; }
      let released = false, resolved = null; const states = [state()];
      for (let k = 0; k < 160 && !released; k++) {
        sim(1 / 60);
        if (front && o.jump && !jumpForced && rel === null && k > 2) jumpForced = forceJump(front);
        if (front && airborne(front)) defAir = true;
        const bs = g.ball.state; if (rel || bs === 'flight' || bs === 'scored' || state() !== 'LIVE') released = true;
      }
      for (let k = 0; k < 400 && !resolved; k++) {
        sim(1 / 60); const st = state(); if (states[states.length - 1] !== st) states.push(st);
        const bs = g.ball.state; if (st !== 'LIVE') resolved = st; else if ((bs === 'held' || bs === 'dribble') && simTime() - t0 > 0.3) resolved = 'caught';
      }
      if (o.follow) { for (let k = 0; k < 360; k++) { sim(1 / 60); const st = state(); if (states[states.length - 1] !== st) states.push(st); if (st === 'LIVE' && states.length > 2) break; } }
      un1(); un2();
      const ev = since(e0); const s1 = scores();
      const ballEvts = ev.filter((x) => x.type === 'ball');
      const sc = ev.find((x) => x.type === 'score');
      out.push({
        id, team, kindAsked: o.kind || null, shotKind, made: s1[team] > s0[team], points: s1[team] - s0[team], released, resolved, states, rel, slam, contest,
        // the debug shot itself went in (its own 'score' event); \`made\` also counts a teammate's tip-in of the miss (§5.6)
        shotMade: ev.some((x) => x.type === 'score' && x.playerId === id && x.kind !== 'tip'),
        eT: o.eT != null ? o.eT : null, at: o.at || null,
        firstContact: ballEvts.length ? ballEvts[0].what : null,
        rim: ballEvts.some((x) => x.what === 'rim' || x.what === 'rimIn'), board: ballEvts.some((x) => x.what === 'board'),
        airCap: acc.caps.slice(c0).some((c) => c.key === 'cap.airball' || (c.text && /三不沾|air ball/i.test(c.text))),
        oob: ev.some((x) => x.type === 'turnover' && /oob/i.test(String(x.reason))) || /OOB|OUT/i.test(deadReason() || ''),
        scoreT: sc ? +(sc.sim - t0).toFixed(2) : null, scoreEvt: sc || null, offBefore: off0, offAfter: offenseTeam(),
        defAir, jumpForced, dead: deadReason(),
      });
    }
    return out;
  }

  // ---- projections (this frame's camera matrices: no updateMatrixWorld here)
  function cam() { const g = G(); return (g.director && g.director.camera) || g.camera; }
  let V3 = null;
  function vec(x, y, z) { if (!V3) V3 = cam().position.constructor; return new V3(x, y, z); }
  function ndc(x, y, z) { const v = vec(x, y, z).project(cam()); return { x: v.x, y: v.y, z: v.z }; }
  function vw() { const c = document.querySelector('#gl') || document.querySelector('canvas'); return { w: c ? c.clientWidth : innerWidth, h: c ? c.clientHeight : innerHeight }; }
  function toPx(n) { const s = vw(); return { x: (n.x + 1) / 2 * s.w, y: (1 - n.y) / 2 * s.h }; }
  function boneWorld(id, name) { const c = G().characters && G().characters[id]; if (!c) return null; const i = c.boneIndex(name); if (i == null || i < 0) return null; const b = (c.boneList && c.boneList[i]) || c.bones[name] || c.bones[i]; if (!b) return null; const v = vec(0, 0, 0); b.getWorldPosition(v); return v; }
  /** B26 torso box in CSS px: centre = projected spine_02, width 0.6 × shoulderJoints at that depth, height = |spine_03 − pelvis| projected. */
  function torsoBox(id) {
    const c = G().characters[id]; const s2 = boneWorld(id, 'spine_02'), s3 = boneWorld(id, 'spine_03'), pel = boneWorld(id, 'pelvis');
    if (!s2 || !s3 || !pel) return null;
    const camera = cam(); const e = camera.matrixWorld.elements; const right = vec(e[0], e[1], e[2]).normalize();
    const half = 0.3 * c.dims.shoulderJoints;
    const pC = toPx(ndc(s2.x, s2.y, s2.z)), pR = toPx(ndc(s2.x + right.x * half, s2.y + right.y * half, s2.z + right.z * half));
    const p3 = toPx(ndc(s3.x, s3.y, s3.z)), pP = toPx(ndc(pel.x, pel.y, pel.z));
    return { cx: pC.x, cy: pC.y, w: 2 * Math.hypot(pR.x - pC.x, pR.y - pC.y), h: Math.abs(p3.y - pP.y), visible: !!c.visible };
  }
  function headWorld(id) { const c = G().characters[id]; const v = vec(0, 0, 0); c.headWorld(v); return v; }
  function morphWeight(id, name) {
    const c = G().characters && G().characters[id]; if (!c) return null;
    const mi = c.morphIndex; let i = -1;
    if (mi && typeof mi === 'object' && !Array.isArray(mi) && name in mi) i = mi[name];
    else if (Array.isArray(mi)) i = mi.indexOf(name);
    if (i >= 0 && c.morph) return c.morph[i];
    const b = c.body;
    if (b && b.morphTargetDictionary && name in b.morphTargetDictionary) return b.morphTargetInfluences[b.morphTargetDictionary[name]];
    return 0;
  }
  function memory() { const g = G(); const m = g.renderer.info.memory; const p = g.perf || {}; let tex = p.texMB; try { if (g.quality && typeof g.quality.texMB === 'function') tex = g.quality.texMB(); } catch (e) { /* perf value */ } return { geometries: m.geometries, textures: m.textures, texMB: Math.round(tex * 1000) / 1000, programs: (g.renderer.info.programs || []).length }; }
  function setVisibility(v) { const hidden = v === 'hidden'; Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); return document.visibilityState; }
  function visible(sel) { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function rect(sel) { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }
  function nextFrame(n = 2) { return new Promise((res) => { let k = n; const tick = () => (--k <= 0 ? res(true) : requestAnimationFrame(tick)); requestAnimationFrame(tick); }); }
  /** Hides the DOM layers over the canvas (for 3D pixel analysis); returns a restore function. */
  function hideDom(ids = ['hud', 'controls', 'screens', 'present', 'menus', 'halftime', 'rotateHint']) { const prev = ids.map((i) => { const el = document.getElementById(i); const v = el ? el.style.visibility : null; if (el) el.style.visibility = 'hidden'; return [el, v]; }); acc._restoreDom = () => prev.forEach(([el, v]) => { if (el) el.style.visibility = v || ''; }); return true; }
  function showDom() { if (acc._restoreDom) acc._restoreDom(); acc._restoreDom = null; return true; }
  function mod(relPath) { return import(new URL(relPath, document.baseURI).href); }
  function stepCost() { const g = G(); const out = {}; if (g.game && typeof g.game.step === 'function') { const t0 = performance.now(); for (let i = 0; i < 600; i++) { g.game.step(FIXED); clearEdges(); } out.stepLoopMs = +((performance.now() - t0) / 600).toFixed(3); } const t1 = performance.now(); g.fastForward(10); out.fastForwardMs = +((performance.now() - t1) / 600).toFixed(3); out.perfStepMs = g.perf && g.perf.stepMs; out.animMs = g.perf && g.perf.animMs; return out; }
  /** Ends the current game: clocks to 0.2 s period after period (ties broken in Q4/OT), until GAME_OVER. */
  function forceGameOver() {
    const g = G();
    for (let k = 0; k < 60 && state() !== 'GAME_OVER'; k++) {
      const st = state();
      if (st === 'LIVE' || st === 'CHECK' || st === 'DEAD') {
        const s = scores(); if (g.world.quarter >= 4 && s[0] === s[1]) bumpScore(0, 2);
        g.setClock({ game: 0.2 });
        simUntil('g.state !== "LIVE" && g.state !== "CHECK" && g.state !== "DEAD"', 4);
      } else sim(0.5);
    }
    return state();
  }
  /** Lineup card ids in slot order (lineup screen DOM). */
  function cardIds() { return [...document.querySelectorAll('#screenLineup .card')].sort((a, b) => +a.dataset.slot - +b.dataset.slot).map((c) => c.getAttribute('data-id')); }
  function hooksMissing(list) {
    const g = G(); if (!g) return list.slice();
    return list.filter((h) => { try { const parts = h.split('.'); let o = g; for (const p of parts) { if (o == null) return true; o = o[p]; } return o === undefined; } catch (e) { return true; } });
  }

  window.__acc = Object.assign(acc, {
    install, onEvent, since, simTime, players, pid, teamOf, byId, idx, userTeam, offenseTeam, userOff, state, ctrl, ctrlId, posOf, info, scores, paused,
    deadReason, statsOf, ballHeld, owner, speedOf, jumpOf, airborne, faceRim, place, ballPos, pressBtn, releaseBtn, clearEdges, setStick, sim, simInput, simUntil,
    bumpScore, forceTie, ready, readyFor, parkOpponents, forceJump, contestSnap, shootTrial, cam, vec, ndc, vw, toPx, boneWorld, torsoBox, headWorld,
    morphWeight, memory, setVisibility, visible, rect, nextFrame, hideDom, showDom, mod, stepCost, forceGameOver, cardIds, hooksMissing,
  });
  return install();
}

// ------------------------------------------------------------------------------------------------ Node-side page helpers
const PAGE_SRC = `(${pageHelpers.toString()})()`;
/** Evaluates an expression with `g` (= __game) and `acc` (= __acc) in scope; promises are awaited. */
function ev(page, expr) { return page.evaluate(`(async () => { const g = window.__game, acc = window.__acc; if (acc) acc.install(); return (${expr}); })()`); }
/** Evaluates a function body (statements; may await) with `g` and `acc` in scope. */
function run(page, body) { return page.evaluate(`(async () => { const g = window.__game, acc = window.__acc; if (acc) acc.install(); ${body} })()`); }
async function waitFor(page, expr, ms, label) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) {
    try { last = await ev(page, expr); } catch (e) { last = 'evaluate error: ' + e.message; }
    if (last && !(typeof last === 'string' && last.startsWith('evaluate error'))) return { value: last, ms: Date.now() - t0 };
    await sleep(40);
  }
  fail(`timeout ${ms} ms waiting for ${label || expr} (last value: ${fmt(last)})`);
}
const waitForState = (page, st, ms) => waitFor(page, `g.state === ${JSON.stringify(st)}`, ms, `__game.state === '${st}'`);
async function installHelpers(page, ms = 60000) {
  await waitFor(page, '!!window.__game', ms, 'window.__game');
  return page.evaluate(PAGE_SRC);
}
async function needHooks(page, list) {
  if (!list || !list.length) return;
  const missing = await ev(page, `acc.hooksMissing(${JSON.stringify(list)})`);
  if (missing.length) fail(`missing __game hook(s) (spec §5.15 / main.js): ${missing.join(', ')}`);
}
async function isVisible(page, sel) { return H.isVisible(page, sel); }
async function bbox(page, sel) { const b = await page.locator(sel).first().boundingBox(); if (!b) fail(`${sel} has no bounding box (missing or hidden)`); return b; }
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const isTouch = (device) => !!H.DEVICES[device].hasTouch;
async function tapEl(page, sel, device) { const c = center(await bbox(page, sel)); if (isTouch(device)) await H.touchTap(page, c); else await page.mouse.click(c.x, c.y); }
/** Screenshot at CSS scale (1 image px = 1 CSS px), decoded; saved under test/results/shots/ with --keep-shots. */
async function shot(page, name) {
  const buf = await page.screenshot({ type: 'png', scale: 'css' });
  if (KEEP_SHOTS && name) { fs.mkdirSync(SHOTS_DIR, { recursive: true }); fs.writeFileSync(path.join(SHOTS_DIR, name + '.png'), buf); }
  const img = decodePng(buf); img.buf = buf; return img;
}
/** Text of the score bug with whitespace collapsed. */
const bugText = (page) => page.evaluate(() => { const el = document.querySelector('#scoreBug'); return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; });
const bodyText = (page) => page.evaluate(() => document.body.innerText);
function requireGame() {
  const missing = ['index.html', 'src/main.js', 'src/flow.js'].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) fail(`game not integrated: ${missing.join(', ')} missing (runtime item cannot run before WP9a)`);
}
/** Problems in a page's diagnostics: console errors, uncaught exceptions, failed requests, cross-origin requests. */
function diagProblems(gm, label, { allowFailed = null, allowErrors = null } = {}) {
  const origin = new URL(gm.url).origin; const out = [];
  const errs = gm.diag.errors.filter((e) => !(allowErrors && allowErrors.test(e)));
  if (errs.length) out.push(`[${label}] console.error ×${errs.length}: ${errs.slice(0, 3).join(' | ')}`);
  if (gm.diag.pageErrors.length) out.push(`[${label}] uncaught exceptions ×${gm.diag.pageErrors.length}: ${gm.diag.pageErrors.slice(0, 2).join(' | ')}`);
  const failed = gm.diag.failedRequests.filter((f) => !(allowFailed && allowFailed.test(f)));
  if (failed.length) out.push(`[${label}] failed requests: ${failed.slice(0, 3).join(' | ')}`);
  const foreign = gm.diag.requests.filter((r) => !r.url.startsWith(origin + '/') && !/^(data|blob|about):/.test(r.url));
  if (foreign.length) out.push(`[${label}] cross-origin requests: ${foreign.slice(0, 3).map((r) => r.url).join(' | ')}`);
  return out;
}
/**
 * Waits `sec` of simulation while a real gesture is held; tops up with acc.simInput() when the rAF loop is slower
 * (it samples the held DOM input before each step like the real loop; plain acc.sim() never saw the held key/stick).
 */
async function holdSim(page, sec, t, label) {
  const s0 = await ev(page, 'acc.stepCount'); const t0 = Date.now();
  await sleep(sec * 1000);
  const s1 = await ev(page, 'acc.stepCount'); const got = (s1 - s0) / 60;
  if (got < sec * 0.9) { await ev(page, `acc.simInput(${(sec - got).toFixed(3)})`); if (t) t.warn(`${label || 'hold'}: rAF loop advanced only ${got.toFixed(2)} s of sim in ${Date.now() - t0} ms; topped up with acc.sim()`); }
  return got;
}
/** A joystick start point inside #stickZone (away from the R#9 edge band). */
async function stickPoint(page) {
  const r = await page.evaluate(() => { const z = document.querySelector('#stickZone'); const b = z ? z.getBoundingClientRect() : null; return { b: b && { x: b.x, y: b.y, w: b.width, h: b.height }, W: innerWidth, H: innerHeight }; });
  if (!r.b || r.b.w < 10) return { x: Math.round(r.W * 0.15), y: Math.round(r.H * 0.70) };
  const x = Math.round(Math.min(Math.max(r.b.x + 100, r.W * 0.15), r.b.x + r.b.w - 70));
  const y = Math.round(Math.min(Math.max(r.b.y + r.b.h * 0.6, r.b.y + 80), r.b.y + r.b.h - 70));
  return { x, y };
}
const BTN_IDS = ['#btnPrimary', '#btnSecondary', '#btnTertiary', '#btnSprint'];
function buttonLabelsExpr() { return `${JSON.stringify(BTN_IDS)}.map((s) => { const el = document.querySelector(s); const l = el && el.querySelector('.label'); return l ? l.textContent.replace(/\\s+/g, '') : (el ? el.textContent.replace(/\\s+/g, '') : null); })`; }
/** Clicks a settings option button (title sheet or pause rows) of `key` with option index `i`. */
async function clickSetting(page, scope, key, i) {
  const sel = `${scope} .opt[data-key="${key}"][data-idx="${i}"]`;
  const loc = page.locator(sel).first(); if (!(await loc.count())) fail(`settings option ${sel} not found`);
  await loc.click({ timeout: 5000 });
}
/** Switches the UI language through src/i18n.js (works on every screen; the T key only works in play). */
async function setLang(page, lang) { await run(page, `const m = await acc.mod('src/i18n.js'); m.setLang(${JSON.stringify(lang)}); return m.getLang();`); await sleep(150); }
/** Virtual clock control (needs CLOCK_INIT). */
const clockSet = (page, mode, stepMs, k) => page.evaluate(([m, s, kk]) => window.__accClock.set(m, s, kk), [mode, stepMs || null, k == null ? null : k]);
const vnowOf = (page) => page.evaluate(() => performance.now());
async function waitFrames(page, n) { const f0 = await page.evaluate(() => window.__acc.frames); await waitFor(page, `acc.frames >= ${f0 + n}`, 120000 + n * 500, `${n} rendered frames`); }

// ================================================================================================ ITEMS
const ITEMS = [];
/**
 * Registers a checklist item. meta: {kind: 'static'|'runtime', needs: [__game hook paths checked after the game
 * starts], timeoutS, clock: true (install CLOCK_INIT in every page of the item), staticPart: async (t) => {}}.
 */
function item(id, title, meta, runFn) {
  ITEMS.push({ id, title, kind: meta.kind || 'runtime', needs: meta.needs || [], timeoutS: meta.timeoutS || DEFAULT_TIMEOUT_MS / 1000, clock: !!meta.clock, staticPart: meta.staticPart || null, run: runFn });
}
/** Common hooks of a started game (§5.15 v1 subset + v2 basics). */
const BASE_HOOKS = ['game', 'world', 'ball', 'input', 'legendsReady', 'player', 'place', 'debugShoot', 'setClock', 'turnover', 'fastForward', 'events', 'ui.screen'];

// ------------------------------------------------------------------------------------------------ static / hygiene
item('B1', 'Clean boot on desktop / iPhone 11 portrait+landscape / Pixel 5; same-origin only; a full fastForward(120) game with intro and replays', { timeoutS: 1500, needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const problems = [];
  for (const device of ['desktop', 'phonePortrait', 'phoneLandscape', 'androidPortrait']) {
    const gm = await t.quick(device);
    await ev(gm.page, 'acc.sim(1)');
    await gm.page.waitForTimeout(1500);
    problems.push(...diagProblems(gm, device));
    await t.closeAll();
  }
  // full game: intro (full) + replays (all) + auto play, quarters of 0.5 min → fastForward(120) covers the game
  const gm = await t.boot('desktop', '?seed=7&q=0.5&auto=1&intro=full&replay=all');
  await H.openLineup(gm.page);
  await gm.page.locator('#screenLineup .luStart').first().click({ timeout: 5000 });
  await waitFor(gm.page, "g.state === 'CHECK' || g.state === 'LIVE'", 90000, 'CHECK after the full intro');
  await installHelpers(gm.page);
  for (let i = 0; i < 12; i++) {
    await ev(gm.page, 'g.fastForward(10)');
    await gm.page.waitForTimeout(600);   // lets triggered replays and screens run on real frames
  }
  await waitFor(gm.page, '!(g.replay && g.replay.active)', 20000, 'replay finished');
  const end = await ev(gm.page, '({state: g.state, q: g.world.quarter, score: acc.scores()})');
  t.warn(`full game after fastForward(120): ${fmt(end)}`);
  problems.push(...diagProblems(gm, 'desktop full game'));
  if (problems.length) fail(problems.join('\n    '));
});

item('B2', 'Static scan: relative imports, depth-correct three.js path, no importmap / dynamic import / top-level await / Math.random; CJK only in i18n.js + legends.js; denylist v2', { kind: 'static' }, async (t) => {
  const files = listSrc(); assert(files.length > 0, 'no src/**/*.js files found');
  const problems = [];
  const vendorAbs = path.join(ROOT, 'vendor', 'three.module.js');
  for (const f of files) {
    const code = readText(f); const r = rel(f);
    for (const im of importSpecifiers(code)) {
      if (im.dynamic) { problems.push(`${r}:${im.line} dynamic import( )`); continue; }
      if (!(im.spec.startsWith('./') || im.spec.startsWith('../'))) { problems.push(`${r}:${im.line} import specifier "${im.spec}" does not start with ./ or ../`); continue; }
      const target = path.resolve(path.dirname(f), im.spec);
      if (target === vendorAbs) { if (im.spec !== vendorSpecFor(f)) problems.push(`${r}:${im.line} three.js import "${im.spec}" is not the depth-correct "${vendorSpecFor(f)}"`); }
      else if (!target.startsWith(path.join(ROOT, 'src') + path.sep)) problems.push(`${r}:${im.line} import outside src/ other than vendor/three.module.js: "${im.spec}"`);
      else if (!fs.existsSync(target)) problems.push(`${r}:${im.line} import target does not exist: "${im.spec}"`);
    }
    const masked = maskJs(code, { strings: false, comments: true });
    const mr = masked.indexOf('Math.random'); if (mr >= 0) problems.push(`${r}:${lineOf(code, mr)} Math.random`);
    const tla = topLevelAwait(code); if (tla) problems.push(`${r}:${tla.line} top-level await: "${tla.snippet}"`);
    for (const w of ['document.currentScript', 'serviceWorker', 'importScripts']) { const k = masked.indexOf(w); if (k >= 0) problems.push(`${r}:${lineOf(code, k)} uses ${w}`); }
    if (r !== 'src/i18n.js' && r !== 'src/legends.js') { const m = CJK_RE.exec(code); if (m) problems.push(`${r}:${lineOf(code, m.index)} CJK character "${m[0]}" outside src/i18n.js / src/legends.js`); }
  }
  const htmlPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(htmlPath)) problems.push('index.html missing');
  else {
    const html = readText(htmlPath);
    if (/importmap/i.test(html)) problems.push('index.html contains "importmap"');
    if (/<base\b/i.test(html)) problems.push('index.html contains a <base> tag');
    if (/serviceWorker/.test(html)) problems.push('index.html registers a service worker');
    if (!/<script[^>]*type="module"[^>]*src="(\.\/)?src\/main\.js"/.test(html) && !/<script[^>]*src="(\.\/)?src\/main\.js"[^>]*type="module"/.test(html)) problems.push('index.html lacks <script type="module" src="./src/main.js">');
    const remote = html.match(/(?:src|href)="(https?:)?\/\/[^"]+"/g); if (remote) problems.push(`index.html references other origins: ${remote.slice(0, 3).join(', ')}`);
  }
  // denylist over the §9.2 scanned files
  const scanned = [...walk(path.join(ROOT, 'src')), htmlPath, path.join(ROOT, 'css', 'style.css'), path.join(ROOT, 'README.md'),
    path.join(ROOT, 'assets', 'legends', 'legends.json'), path.join(ROOT, 'tools', 'legends', 'legends.config.json')];
  const missingScan = [];
  for (const f of scanned) {
    if (!fs.existsSync(f)) { missingScan.push(rel(f)); continue; }
    const text = readText(f);
    for (const w of DENYLIST) { const m = denyRe(w).exec(text); if (m) problems.push(`${rel(f)}:${lineOf(text, m.index)} denylisted "${w}"`); }
  }
  if (missingScan.length) t.warn(`scanned file(s) missing: ${missingScan.join(', ')}`);
  t.note(`${files.length} src modules scanned; denylist (${DENYLIST.length} entries) over ${scanned.length - missingScan.length} files`);
  if (problems.length) fail(problems.slice(0, 20).join('\n    ') + (problems.length > 20 ? `\n    …and ${problems.length - 20} more` : ''));
});

item('B3', 'wc -l src/**/*.js ∈ [16,000, 48,000]; no file > 1,600 lines except src/anim/clips/*.js and src/anim/clip.js; vendor/ = three.module.js + LICENSE.three.txt', { kind: 'static' }, async (t) => {
  const files = listSrc(); assert(files.length > 0, 'no src/**/*.js files found');
  const counts = files.map((f) => ({ f: rel(f), n: lineCount(readText(f)) }));
  const total = counts.reduce((s, c) => s + c.n, 0);
  const big = counts.filter((c) => c.n > 1600 && !/^src\/anim\/clips\/[^/]+\.js$/.test(c.f) && c.f !== 'src/anim/clip.js');
  t.note(`${files.length} files, total ${total} lines; largest: ${counts.slice().sort((a, b) => b.n - a.n).slice(0, 5).map((c) => `${c.f}=${c.n}`).join(' ')}`);
  const vendor = fs.existsSync(path.join(ROOT, 'vendor')) ? fs.readdirSync(path.join(ROOT, 'vendor')).sort() : [];
  const problems = [];
  if (!(total >= 16000 && total <= 48000)) problems.push(`total lines in src/**/*.js = ${total}, expected 16,000–48,000 (H9)`);
  if (big.length) problems.push(`files over 1,600 lines: ${big.map((c) => `${c.f} (${c.n})`).join(', ')}`);
  if (vendor.join(',') !== 'LICENSE.three.txt,three.module.js') problems.push(`vendor/ contents ${fmt(vendor)}, expected ["LICENSE.three.txt","three.module.js"]`);
  if (problems.length) fail(problems.join('\n    '));
});

// ------------------------------------------------------------------------------------------------ i18n / title / HUD
item('B4', 'zh by default (开始游戏); no empty [data-i18n]; [data-action=lang] → Play and the jumbotron text changes language; back restores; reload keeps the choice', { needs: ['arena.jumbo', 'ui.screen'] }, async (t) => {
  requireGame();
  const { page } = await t.boot('desktop', '?seed=7');
  await H.waitTitle(page); await needHooks(page, ['arena.jumbo', 'ui.screen']);
  const text0 = await bodyText(page);
  assert(text0.includes(TXT.zh.play), `body text lacks "${TXT.zh.play}" on the title`);
  const empties = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')].filter((el) => el.tagName !== 'TITLE' && !(el.textContent || '').trim()).map((el) => el.getAttribute('data-i18n')));
  eq(empties.length, 0, `empty [data-i18n] elements (${empties.join(', ')})`);
  const jumbo0 = (await waitFor(page, 'g.arena.jumbo.lastText', 8000, 'jumbotron lastText')).value;
  const lang = page.locator('[data-action=lang]').first(); assert(await lang.count(), 'no [data-action=lang] control');
  await lang.click();
  await waitFor(page, `document.body.innerText.includes('${TXT.en.play}') && !document.body.innerText.includes('${TXT.zh.play}')`, 2000, 'English title text after the language chip');
  const jumbo1 = (await waitFor(page, `g.arena.jumbo.lastText && g.arena.jumbo.lastText !== ${JSON.stringify(jumbo0)} ? g.arena.jumbo.lastText : ''`, 4000, 'jumbotron text changes language')).value;
  await lang.click();
  await waitFor(page, `document.body.innerText.includes('${TXT.zh.play}') && !document.body.innerText.includes('${TXT.en.play}')`, 2000, 'zh restored after the 2nd click');
  await waitFor(page, `g.arena.jumbo.lastText === ${JSON.stringify(jumbo0)}`, 4000, 'jumbotron text restored');
  await lang.click();
  await waitFor(page, `document.body.innerText.includes('${TXT.en.play}')`, 2000, 'English again');
  await page.reload({ waitUntil: 'load' }); await installHelpers(page); await H.waitTitle(page);
  const text3 = await bodyText(page);
  assert(text3.includes(TXT.en.play) && !text3.includes(TXT.zh.play), `after reload the English choice should persist; body: ${text3.slice(0, 120).replace(/\n/g, ' ')}`);
  t.note(`jumbotron "${jumbo0}" → "${jumbo1}"`);
});

item('B5', '快速比赛 → CHECK then LIVE ≤ 3 s after legendsReady; 6 players; score bug 暗夜/烈阳 (DRK/BRT) 0 0 第1节 02:00 14; fastForward(3) → 01:57 / 11', { needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const gm = await t.boot('desktop', QUICK); const { page } = gm;
  await H.waitTitle(page);
  await page.locator('#btnQuick').click();
  await page.evaluate(() => Promise.resolve(window.__game.legendsReady));
  const tReady = Date.now();
  await installHelpers(page); await needHooks(page, BASE_HOOKS);
  const s0 = await ev(page, 'acc.stepCount');
  await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 10000, 'CHECK after 快速比赛');
  const atCheck = await ev(page, '({state: g.state, bug: document.querySelector("#scoreBug").innerText.replace(/\\s+/g, " ").trim()})');
  if (atCheck.state !== 'CHECK') t.warn(`state was already ${atCheck.state} when first observed`);
  const tokens = atCheck.bug.split(/[^0-9A-Za-z:\u4e00-\u9fff]+/).filter(Boolean);
  for (const want of [TXT.zh.dark, TXT.zh.bright, TXT.zh.q1, '02:00', '14']) assert(tokens.includes(want), `score bug at CHECK lacks "${want}": "${atCheck.bug}"`);
  assert(tokens.filter((x) => x === '0').length >= 2, `score bug should show "0 0": "${atCheck.bug}"`);
  await waitForState(page, 'LIVE', 15000);
  const simSec = (await ev(page, 'acc.stepCount') - s0) / 60; const wall = (Date.now() - tReady) / 1000;
  assert(simSec <= 3.0, `LIVE reached ${simSec.toFixed(2)} s of game time after legendsReady (> 3 s)`);
  if (wall > 3) t.warn(`LIVE reached ${wall.toFixed(1)} s wall time after legendsReady (SwiftShader frames; game time ${simSec.toFixed(2)} s)`);
  eq(await ev(page, 'acc.players().length'), 6, '__game.world.players.length');
  await ev(page, 'g.setClock({game: 120, shot: 14})'); await ev(page, 'g.fastForward(3)');
  const after = (await waitFor(page, `(() => { const s = document.querySelector('#scoreBug').innerText.replace(/\\s+/g, ' '); return s.includes('01:57') && /\\b11\\b/.test(s) ? s : ''; })()`, 2000, 'score bug 01:57 / 11')).value;
  void after;
  await page.keyboard.press('t');
  await waitFor(page, `(() => { const s = document.querySelector('#scoreBug').innerText; return s.includes('${TXT.en.dark}') && s.includes('${TXT.en.bright}') && s.includes('${TXT.en.q1}'); })()`, 2000, 'score bug DRK / BRT / Q1 after T');
  await page.keyboard.press('t');
});

// ------------------------------------------------------------------------------------------------ input
item('B6', 'Joystick (844×390): +60 px for 1 s → pos.x +> 1.0 m; release → speed < 0.1 m/s within 0.5 s; −60 px y → pos.z −> 1.0 m', { clock: true, needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('phoneLandscape');
  await waitForState(page, 'LIVE', 15000);
  // the 1 s hold is game time: on the real clock every CDP touchMove waits for a SwiftShader frame, so the handler
  // ran for several seconds with the stick down before the hold even started (out of bounds, DEAD); on the virtual
  // clock each rendered frame is one step and holdSim tops the hold up to exactly 1 s with the stick still held
  await clockSet(page, 'fixed', 1000 / 60);
  const p0 = await stickPoint(page);
  const drag = async (to, axis) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await run(page, 'const r = acc.ready(); if (r.ok) acc.place(acc.ctrlId(), 0, -6.5); return r;');
      const before = await ev(page, '({...acc.posOf(acc.ctrlId()), id: acc.ctrlId(), state: g.state})'); let after = null;
      await H.multiTouch(page, [{ type: 'touchStart', points: [{ id: 1, ...p0 }], waitMs: 30 }, ...H.moveSteps(1, p0, to, 6), async () => { await holdSim(page, 1.0, t, 'B6 hold'); after = await ev(page, '({...acc.posOf(acc.ctrlId()), id: acc.ctrlId(), state: g.state})'); }, { type: 'touchEnd', points: [] }]);
      if (after.state === 'LIVE' && after.id === before.id) return { before, after };
      t.warn(`attempt ${attempt}: play interrupted (state ${after.state}, control ${before.id}→${after.id}); retrying`);
    }
    fail(`could not complete an uninterrupted ${axis} drag in 3 attempts`);
  };
  const r = await drag({ x: p0.x + 60, y: p0.y }, '+x');
  assert(r.after.x - r.before.x > 1.0, `pos.x should increase by > 1.0 m in 1 s: ${r2(r.before.x)} → ${r2(r.after.x)}`);
  const s0 = await ev(page, 'acc.stepCount');
  await waitFor(page, 'acc.speedOf(acc.ctrl()) < 0.1', 3000, 'speed < 0.1 m/s after release');
  const stopSec = (await ev(page, 'acc.stepCount') - s0) / 60; if (stopSec > 0.5) fail(`stopping took ${stopSec.toFixed(2)} s of game time (> 0.5 s)`);
  const r2b = await drag({ x: p0.x, y: p0.y - 60 }, '−y');
  assert(r2b.before.z - r2b.after.z > 1.0, `pos.z should decrease by > 1.0 m in 1 s: ${r2(r2b.before.z)} → ${r2(r2b.after.z)}`);
});

item('B7', 'Multi-touch sprint + joystick: peak speed > 0.9 × run·sprintMul·handlerMul of the controlled legend within 1.5 s (LeBron > 6.1 m/s); release semantics as v1', { needs: BASE_HOOKS }, async (t) => {
  requireGame(); const M = await mods();
  const { page } = await t.quick('phoneLandscape');
  await run(page, 'const r = acc.ready(); if (r.ok) acc.place(acc.ctrlId(), 0, -2.5, Math.PI); return r;');
  const id = await ev(page, 'acc.ctrlId()');
  const at = (await ev(page, `(() => { const i = g.player(${JSON.stringify(id)}); return i && i.attrs ? {run: i.attrs.run, s: i.attrs.sprintMul, h: i.attrs.handlerMul} : null; })()`)) || (() => { const a = M.ratings.derive(M.legends.LEGENDS[id]); return { run: a.run, s: a.sprintMul, h: a.handlerMul }; })();
  const want = 0.9 * at.run * at.s * at.h;
  const sc = center(await bbox(page, '#btnSprint')); const p0 = await stickPoint(page); const p1 = { x: p0.x, y: p0.y - 60 };
  const F1 = { id: 1, ...sc };
  let peak = 0, keep = null;
  await H.multiTouch(page, [
    { type: 'touchStart', points: [F1], waitMs: 60 },
    { type: 'touchStart', points: [F1, { id: 2, ...p0 }], waitMs: 30 },
    ...H.moveSteps(2, p0, p1, 6, [F1]),
    async () => {
      const s0 = await ev(page, 'acc.stepCount'); const t0 = Date.now();
      while (Date.now() - t0 < 1500) { peak = Math.max(peak, await ev(page, 'acc.speedOf(acc.ctrl())')); await sleep(30); }
      const got = (await ev(page, 'acc.stepCount') - s0) / 60;
      if (got < 1.35) { for (let i = 0; i < 6; i++) { await ev(page, 'acc.sim(0.25)'); peak = Math.max(peak, await ev(page, 'acc.speedOf(acc.ctrl())')); } t.warn(`rAF loop advanced only ${got.toFixed(2)} s in 1.5 s; topped up with acc.sim()`); }
    },
    { type: 'touchEnd', points: [F1], waitMs: 250 },
    async () => { await holdSim(page, 0.3, t, 'B7 after sprint release'); keep = await ev(page, '({mag: g.input.intent.move.mag, sprint: g.input.intent.sprint, speed: acc.speedOf(acc.ctrl())})'); },
    { type: 'touchEnd', points: [{ id: 2, ...p1 }] },
  ]);
  assert(peak > want, `${id}: peak speed ${peak.toFixed(2)} m/s ≤ 0.9 × run·sprintMul·handlerMul = ${want.toFixed(2)}`);
  assert(keep.mag > 0.5 && keep.speed > 2 && keep.sprint === false, `after lifting the sprint finger the stick finger keeps moving without sprint: ${fmt(keep)}`);
  await run(page, 'const r = acc.ready(); if (r.ok) acc.place(acc.ctrlId(), 0, -2.5, Math.PI); return r;');
  let sprintOnly = null;
  await H.multiTouch(page, [
    { type: 'touchStart', points: [F1], waitMs: 60 },
    { type: 'touchStart', points: [F1, { id: 2, ...p0 }], waitMs: 30 },
    ...H.moveSteps(2, p0, p1, 6, [F1]),
    { type: 'touchEnd', points: [{ id: 2, ...p1 }], waitMs: 250 },
    async () => { await holdSim(page, 0.3, t, 'B7 after stick release'); sprintOnly = await ev(page, '({sprint: g.input.intent.sprint, mag: g.input.intent.move.mag})'); },
    { type: 'touchEnd', points: [F1] },
  ]);
  assert(sprintOnly.sprint === true && sprintOnly.mag === 0, `after lifting the stick finger: sprint stays true and move.mag 0, got ${fmt(sprintOnly)}`);
  t.note(`${id}: peak ${peak.toFixed(2)} m/s (threshold ${want.toFixed(2)})`);
});

item('B8', 'Slide-over: pointerdown #btnSprint, move into #btnPrimary → primary.held === true && sprint === false', { needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('phoneLandscape');
  await run(page, 'return acc.ready();');
  const sc = center(await bbox(page, '#btnSprint')); const pc = center(await bbox(page, '#btnPrimary'));
  let mid = null, after = null;
  await H.multiTouch(page, [
    { type: 'touchStart', points: [{ id: 1, ...sc }], waitMs: 120 },
    async () => { mid = await ev(page, '({sprint: g.input.intent.sprint, primary: g.input.intent.primary.held})'); },
    ...H.moveSteps(1, sc, pc, 8),
    async () => { await sleep(150); after = await ev(page, '({sprint: g.input.intent.sprint, primary: g.input.intent.primary.held})'); },
    { type: 'touchEnd', points: [] },
  ]);
  assert(mid.sprint === true, `holding #btnSprint: intent.sprint should be true, got ${fmt(mid)}`);
  assert(after.primary === true && after.sprint === false, `after sliding into #btnPrimary: primary.held true and sprint false, got ${fmt(after)}`);
});

item('B9', 'Labels 投篮/传球/变向/冲刺 ↔ 盖帽/换人/抢断/冲刺 ≤ 200 ms, #cluster.defense; buttons ≥ 56 px inside 844×390, 390×844, 812×375, 375×812; safe-bottom 34 px', { needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('phoneLandscape');
  await run(page, 'return acc.ready();');
  const L = buttonLabelsExpr();
  const expectLabels = async (want, what) => waitFor(page, `(() => { const l = ${L}; return ${JSON.stringify(want)}.every((w, i) => l[i] && l[i].includes(w)) ? l : null; })()`, 2000, what).catch(async (e) => fail(`${what}: labels ${fmt(await ev(page, L))} (${e.message})`));
  await expectLabels([TXT.zh.shoot, TXT.zh.pass, TXT.zh.cross, TXT.zh.sprint], 'offence labels (zh)');
  await page.keyboard.press('t'); await expectLabels([TXT.en.shoot, TXT.en.pass, TXT.en.cross, TXT.en.sprint], 'offence labels (en) after T');
  await page.keyboard.press('t'); await expectLabels([TXT.zh.shoot, TXT.zh.pass, TXT.zh.cross, TXT.zh.sprint], 'offence labels (zh) after the 2nd T');
  await ev(page, 'g.turnover()');
  const r = await expectLabels([TXT.zh.block, TXT.zh.switch, TXT.zh.steal, TXT.zh.sprint], 'defence labels after turnover()');
  if (r.ms > 200) fail(`defence labels appeared ${r.ms} ms after the turnover (> 200 ms)`);
  const cls = await page.evaluate(() => document.querySelector('#cluster').className); assert(/\bdefense\b/.test(cls), `#cluster class should include "defense", got "${cls}"`);
  for (const [w, h] of [[844, 390], [390, 844], [812, 375], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(500);
    for (const id of BTN_IDS) {
      const b = await bbox(page, id);
      assert(b.width >= 55.5 && b.height >= 55.5, `${id} at ${w}×${h}: ${b.width.toFixed(1)}×${b.height.toFixed(1)} < 56×56`);
      assert(b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5, `${id} at ${w}×${h} not inside the viewport: ${fmt(b)}`);
    }
  }
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px')); await sleep(300);
  const cb = await bbox(page, '#cluster'); const gap = 812 - (cb.y + cb.height);
  assert(gap >= 50, `with --safe-bottom:34px the cluster bottom should be ≥ 50 px above the viewport bottom, got ${gap.toFixed(1)} px`);
  await page.evaluate(() => document.documentElement.style.removeProperty('--safe-bottom'));
});

item('B10', 'Keyboard: d 500 ms → x +> 1.0; w → z decreases; Space held for getTiming(set).tIdeal → ball flight + fga +1; p pause / resume countdown', { needs: BASE_HOOKS }, async (t) => {
  requireGame(); const M = await mods();
  const { page } = await t.quick('desktop');
  await run(page, 'const r = acc.ready(); if (r.ok) acc.place(acc.ctrlId(), -2, -6); return r;');
  const hold = async (key, sec) => { const b = await ev(page, '({...acc.posOf(acc.ctrlId()), st: g.state})'); await page.keyboard.down(key); await holdSim(page, sec, t, `key ${key}`); await page.keyboard.up(key); const a = await ev(page, '({...acc.posOf(acc.ctrlId()), st: g.state})'); return { b, a }; };
  const d = await hold('d', 0.5); assert(d.a.st === 'LIVE', `play interrupted while holding d (${d.a.st})`);
  assert(d.a.x - d.b.x > 1.0, `holding d 500 ms should move pos.x by > 1.0 m: ${r2(d.b.x)} → ${r2(d.a.x)}`);
  await waitFor(page, 'acc.speedOf(acc.ctrl()) < 0.1', 3000, 'stop after d');
  const w = await hold('w', 0.5); assert(w.a.z < w.b.z, `holding w should decrease pos.z: ${r2(w.b.z)} → ${r2(w.a.z)}`);
  await run(page, 'const r = acc.ready(); if (r.ok) acc.place(acc.ctrlId(), 0, -8.3); acc.sim(0.4); return r;');
  const id = await ev(page, 'acc.ctrlId()');
  const tim = M.select.getTiming(id, 'jumper', 'set'); assert(tim && tim.tIdeal > 0, `getTiming(${id}, jumper, set) missing`);
  const fga0 = await ev(page, `acc.statsOf(${JSON.stringify(id)}).fga`);
  await page.keyboard.down('Space'); await sleep(Math.round(tim.tIdeal * 1000)); await page.keyboard.up('Space');
  await waitFor(page, "g.ball.state === 'flight' || g.ball.state === 'scored'", 5000, "ball.state === 'flight' after Space");
  const fga1 = await ev(page, `acc.statsOf(${JSON.stringify(id)}).fga`);
  eq(fga1, fga0 + 1, `${id} stats.fga after the Space shot`);
  await page.keyboard.press('p');
  await waitFor(page, 'acc.paused()', 3000, 'paused after p');
  assert(await isVisible(page, '#menuPause'), '#menuPause should be visible while paused');
  const c0 = await ev(page, 'g.world.gameClock');
  await page.keyboard.press('p');
  const res = await waitFor(page, '!acc.paused()', 6000, 'unpaused after the 2nd p (1.0 s countdown)');
  if (res.ms < 700) fail(`resume happened ${res.ms} ms after p: the 1.0 s countdown is missing`);
  const c1 = await ev(page, 'g.world.gameClock'); if (c0 - c1 > 0.25) t.warn(`game clock moved ${r2(c0 - c1)} s during the countdown`);
  t.note(`${id}: Space held ${Math.round(tim.tIdeal * 1000)} ms (tIdeal)`);
});

// ------------------------------------------------------------------------------------------------ shooting / rules
item('B11', 'place handler at (0, −8.3), debugShoot({p:1, eT:0}) → +2 within 4 s, DEAD → CHECK → LIVE, possession switched; at (0, −4.8) → +3 (feet at release)', { needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop');
  const two = (await ev(page, 'acc.shootTrial({n:1, p:1, eT:0, at:{x:0, z:-8.3}, defenders:"away", follow:true})'))[0];
  assert(!two.error, two.error);
  assert(two.made && two.points === 2, `expected +2 from (0, −8.3), got ${two.points} (states ${two.states.join('→')}, release ${fmt(two.rel)})`);
  assert(two.scoreT != null && two.scoreT <= 4, `score event ${two.scoreT} s after the shot (> 4 s or missing)`);
  assert(/DEAD.*CHECK.*LIVE/.test(two.states.join('→')), `state sequence should pass DEAD → CHECK → LIVE: ${two.states.join('→')}`);
  assert(two.offAfter !== two.offBefore, `possession should switch after the make (offence ${two.offBefore} → ${two.offAfter})`);
  const three = (await ev(page, 'acc.shootTrial({n:1, p:1, eT:0, at:{x:0, z:-4.8}, defenders:"away", follow:true})'))[0];
  assert(!three.error, three.error);
  assert(three.made && three.points === 3, `expected +3 from (0, −4.8), got ${three.points} (release at ${fmt(three.rel && { x: three.rel.x, z: three.rel.z, points: three.rel.points })})`);
});

item('B12', 'debugShoot({p:0, eT:−0.08}) ×20 never scores and hits rim/board first; eT −0.20 ×10 → ≥ 6 air balls with cap.airball, ≤ 2 end OOB', { needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop', '?quick=1&intro=0&seed=7&q=5');
  const a = await ev(page, 'acc.shootTrial({n:20, p:0, eT:-0.08, at:{x:0, z:-8.3}, defenders:"away"})');
  const errs = a.filter((x) => x.error); assert(!errs.length, errs[0] && errs[0].error);
  // p = 0 is the shot's own make probability: a teammate's putback of the miss is a separate FGA (§5.6 tip), so only the
  // debug shot's own basket counts here (team points are reported)
  assert(!a.some((x) => x.shotMade), `${a.filter((x) => x.shotMade).length}/20 attempts with p = 0 scored`);
  const putbacks = a.filter((x) => x.made && !x.shotMade).length; if (putbacks) t.warn(`${putbacks}/20 short misses were put back by a teammate`);
  const bad = a.map((x, i) => (x.firstContact === 'rim' || x.firstContact === 'board' ? null : `${i}:${x.firstContact}`)).filter(Boolean);
  assert(!bad.length, `${bad.length}/20 short misses (eT −0.08) did not touch rim/board first: ${bad.join(', ')}`);
  const b = await ev(page, 'acc.shootTrial({n:10, p:0, eT:-0.20, at:{x:0, z:-8.3}, defenders:"away"})');
  const bErr = b.filter((x) => x.error); assert(!bErr.length, bErr[0] && bErr[0].error);
  const air = b.filter((x) => !x.rim && !x.board && x.airCap).length; const oob = b.filter((x) => x.oob).length;
  assert(air >= 6, `expected ≥ 6/10 air balls without rim contact + cap.airball, got ${air} (rim ${b.filter((x) => x.rim).length}, captions ${b.filter((x) => x.airCap).length})`);
  assert(oob <= 2, `${oob}/10 air balls ended out of bounds (≤ 2 allowed)`);
  t.note(`air balls ${air}/10, OOB ${oob}/10`);
});

item('B13', 'Timing ×40 at (0, −8.3): eT 0 open ≥ 40p − 2.5σ; eT −0.20 ≤ 40p + 2.5σ; defender at (0, −9.0) with a forced jump ≤ 40p + 2.5σ (p from debugContest + §5.3.4)', { timeoutS: 900, needs: [...BASE_HOOKS, 'debugContest'] }, async (t) => {
  requireGame(); const M = await mods();
  const { page } = await t.quick('desktop', '?quick=1&intro=0&seed=7&q=5');
  const runSet = async (o, label) => {
    const r = await ev(page, `acc.shootTrial(${JSON.stringify(Object.assign({ n: 40, at: { x: 0, z: -8.3 }, contest: true }, o))})`);
    const e = r.find((x) => x.error); assert(!e, e && e.error);
    assert(r.every((x) => x.released && x.rel), `${label}: ${r.filter((x) => !x.rel).length} shots never released`);
    const ps = r.map((x) => expectedMakeP(M, x)); const mu = ps.reduce((s, p) => s + p, 0); const sd = Math.sqrt(ps.reduce((s, p) => s + p * (1 - p), 0));
    // the shot's own make (§5.3.4 p); a teammate's tip-in of the miss (§5.6) is another player's FGA, not this shot's make
    const makes = r.filter((x) => x.shotMade).length;
    const putbacks = r.filter((x) => x.made && !x.shotMade).length; if (putbacks) t.warn(`${label}: ${putbacks}/40 misses put back by a teammate (not counted)`);
    return { r, makes, mu, sd, pMean: mu / r.length };
  };
  const open = await runSet({ eT: 0, defenders: 'away' }, 'open');
  assert(open.makes >= open.mu - 2.5 * open.sd, `open eT 0: ${open.makes}/40 makes < 40p − 2.5σ = ${(open.mu - 2.5 * open.sd).toFixed(1)} (p ${open.pMean.toFixed(3)})`);
  const late = await runSet({ eT: -0.20, defenders: 'away' }, 'early');
  assert(late.makes <= late.mu + 2.5 * late.sd, `eT −0.20: ${late.makes}/40 makes > 40p + 2.5σ = ${(late.mu + 2.5 * late.sd).toFixed(1)}`);
  const con = await runSet({ eT: 0, defenders: 'front', front: { x: 0, z: -9.0 }, jump: true }, 'contested');
  assert(con.makes <= con.mu + 2.5 * con.sd, `contested eT 0: ${con.makes}/40 makes > 40p + 2.5σ = ${(con.mu + 2.5 * con.sd).toFixed(1)} (contested p ${con.pMean.toFixed(3)})`);
  const jumped = con.r.filter((x) => x.defAir).length; if (jumped < 20) t.warn(`defender airborne at release in only ${jumped}/40 contested attempts (jump via ${con.r[0].jumpForced})`);
  t.note(`makes: open ${open.makes}/40 (40p ${open.mu.toFixed(1)}), early ${late.makes}/40 (40p ${late.mu.toFixed(1)}), contested ${con.makes}/40 (40p ${con.mu.toFixed(1)})`);
});

item('B14', 'Fuzz ?auto=1 seeds 3 and 11 × fastForward(60): no NaN (players/ball/characters), invariantsBroken 0, ball bounds, shot clock ∈ [0, 14], FGA ≥ 6, FGM ≥ 1 per team, no free ball > 6 s', { timeoutS: 900, needs: [...BASE_HOOKS, 'debug.invariantsBroken'] }, async (t) => {
  requireGame();
  for (const seed of [3, 11]) {
    const { page } = await t.quick('desktop', `?quick=1&intro=0&auto=1&seed=${seed}`);
    await run(page, `
      const F = acc.fuzz = { steps: 0, nan: 0, nanWhere: null, maxAbsX: 0, minZ: Infinity, maxZ: -Infinity, minShot: Infinity, maxShot: -Infinity, freeRun: 0, maxFreeRun: 0 };
      acc.samplers.push(() => {
        const w = g.world; F.steps++;
        for (const p of w.players) { const q = p.pos || p; if (!Number.isFinite(q.x) || !Number.isFinite(q.z) || (p.vel && !Number.isFinite(p.vel.x))) { F.nan++; F.nanWhere = F.nanWhere || 'player ' + acc.pid(p); } }
        for (const id in (g.characters || {})) { const o = g.characters[id].object.position; if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.z)) { F.nan++; F.nanWhere = F.nanWhere || 'character ' + id; } }
        const b = acc.ballPos();
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) { F.nan++; F.nanWhere = F.nanWhere || 'ball'; }
        else { F.maxAbsX = Math.max(F.maxAbsX, Math.abs(b.x)); F.minZ = Math.min(F.minZ, b.z); F.maxZ = Math.max(F.maxZ, b.z); }
        const sc = w.shotClock; if (Number.isFinite(sc)) { F.minShot = Math.min(F.minShot, sc); F.maxShot = Math.max(F.maxShot, sc); }
        if (g.state === 'LIVE' && !acc.ballHeld()) { F.freeRun++; F.maxFreeRun = Math.max(F.maxFreeRun, F.freeRun); } else F.freeRun = 0;
      });
      return true;`);
    for (let i = 0; i < 6; i++) await ev(page, 'g.fastForward(10)');
    const F = await ev(page, `(() => { const F = acc.fuzz; const fga = acc.players().reduce((s, p) => s + ((acc.statsOf(acc.pid(p)) || {}).fga || 0), 0); const fgm = [0, 1].map((tm) => acc.players().filter((p) => acc.teamOf(p) === tm).reduce((s, p) => s + ((acc.statsOf(acc.pid(p)) || {}).fgm || 0), 0)); return Object.assign({}, F, { fga, fgm, inv: g.debug.invariantsBroken, err: acc.samplerError || null, state: g.state, q: g.world.quarter, score: acc.scores() }); })()`);
    const p = (m) => `seed ${seed}: ${m} (${F.steps} steps, ${F.state} Q${F.q} ${fmt(F.score)})`;
    assert(F.steps >= 3000, p(`only ${F.steps} sampled steps (fastForward must run game.step)`));
    assert(F.nan === 0, p(`NaN in ${F.nanWhere}`));
    assert(F.inv === 0, p(`debug.invariantsBroken = ${F.inv}`));
    assert(F.maxAbsX <= 9, p(`|ball.x| reached ${r2(F.maxAbsX)}`));
    assert(F.minZ >= -16 && F.maxZ <= 1, p(`ball.z range [${r2(F.minZ)}, ${r2(F.maxZ)}] outside [−16, 1]`));
    assert(F.minShot >= 0 && F.maxShot <= 14, p(`shot clock range [${F.minShot}, ${F.maxShot}]`));
    assert(F.fga >= 6, p(`FGA ${F.fga} < 6`));
    assert(F.fgm[0] >= 1 && F.fgm[1] >= 1, p(`FGM per team ${fmt(F.fgm)}`));
    assert(F.maxFreeRun / 60 <= 6, p(`a live free ball stayed free ${(F.maxFreeRun / 60).toFixed(1)} s`));
    if (F.err) t.warn(p('sampler error ' + F.err));
    await t.closeAll();
  }
});

item('B15', 'PASS tap → pass, the teammate owns it and is controlled ≤ 1 s; defender 0.3 m off a 6 m line × 30 seeded trials → ≥ 9 intercepted or deflected', { clock: true, timeoutS: 900, needs: [...BASE_HOOKS, 'passPreview'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('phoneLandscape', '?quick=1&intro=0&seed=7&q=5');
  // the tap → catch time is game time: on the virtual clock one rendered frame = one fixed step, so the CDP touch
  // (held back while SwiftShader renders) cannot let up to 15 catch-up steps per frame run before it is sampled
  await clockSet(page, 'fixed', 1000 / 60);
  await run(page, 'const r = acc.ready(); const id = acc.ctrlId(); const tm = acc.teamOf(id); acc.parkOpponents(tm, null); acc.place(id, -2, -6.5); const mate = acc.players().find((p) => acc.teamOf(p) === tm && acc.pid(p) !== id); acc.place(acc.pid(mate), 3, -7.5); acc.sim(0.1); return r;');
  const passer = await ev(page, 'acc.ctrlId()'); const e0 = await ev(page, 'acc.evts.length');
  const sTap = await ev(page, 'acc.stepCount');
  await tapEl(page, '#btnSecondary', 'phoneLandscape');
  await waitFor(page, `acc.since(${e0}, 'pass').length > 0`, 5000, "'pass' event after the PASS tap");
  const got = await waitFor(page, `(() => { const o = acc.owner(); return o && acc.pid(o) !== ${JSON.stringify(passer)} && acc.teamOf(o) === acc.teamOf(${JSON.stringify(passer)}) && acc.ctrlId() === acc.pid(o) ? acc.pid(o) : ''; })()`, 6000, 'teammate owns the ball and is controlled');
  // game time from the tap to the receiver's catch, read from the event log: polling the page only sees the state
  // after whole rendered frames (up to 15 catch-up steps = 0.25 s each on SwiftShader), which overstates it
  const catchStep = await ev(page, `(() => { const c = acc.since(${e0}, 'catch').find((x) => x.playerId === ${JSON.stringify(got.value)}); return c ? c.step : acc.stepCount; })()`);
  const sec = (catchStep - sTap) / 60; assert(sec <= 1.0, `receiver owned + controlled ${sec.toFixed(2)} s of game time after the PASS tap (> 1 s)`);
  await clockSet(page, 'real');
  const trials = await run(page, `
    const out = [];
    for (let a = 0; a < 30; a++) {
      const r = acc.ready(); if (!r.ok) { out.push({ error: 'not ready ' + JSON.stringify(r) }); break; }
      const h = acc.ctrlId(); const tm = acc.teamOf(h);
      const mates = acc.players().filter((p) => acc.teamOf(p) === tm && acc.pid(p) !== h).map(acc.pid);
      const opp = acc.players().filter((p) => acc.teamOf(p) !== tm).map(acc.pid);
      const recv = mates[0], other = mates[1], def = opp[a % 3];
      const hx = -3, hz = -6.5, tx = 3, tz = -6.5;            // 6 m chest-pass line
      acc.place(h, hx, hz, Math.PI / 2); acc.place(recv, tx, tz, -Math.PI / 2); acc.place(other, -6.8, -1.2, Math.PI);
      const side = a % 2 ? 1 : -1;
      // the defender stays parked 0.3 m off the line (as balance S6 freezes the AI): the CPU defender would otherwise
      // walk back to his man during the release and flight, and the item is about a defender standing on the lane
      const park = () => acc.place(def, 0, hz + 0.3 * side, side > 0 ? Math.PI : 0);
      park();
      opp.filter((o) => o !== def).forEach((o, k) => acc.place(o, k ? 6.8 : -6.8, k ? -0.8 : -13.6, Math.PI));
      acc.sim(1 / 60);
      // aim the pass at the receiver along the 6 m line: with a neutral stick the game picks the most open teammate
      // (§5.5), which the defender on the line makes the parked third man, not the line receiver
      acc.setStick(1, 0, 1);
      const prev = g.passPreview(); const e0 = acc.evts.length;
      acc.pressBtn('secondary'); park(); acc.sim(1 / 60); acc.releaseBtn('secondary'); park(); acc.sim(1 / 60);
      acc.setStick(0, 0, 0);
      let res = null;
      for (let k = 0; k < 150 && !res; k++) {
        if (g.ball.state === 'pass' || g.ball.state === 'held') park();
        acc.sim(1 / 60);
        const ev = acc.since(e0);
        if (ev.some((x) => x.type === 'intercept')) res = 'intercepted';
        else if (ev.some((x) => x.type === 'deflect')) res = 'deflected';
        else if (ev.some((x) => x.type === 'steal')) res = 'stolen';
        else if (ev.some((x) => x.type === 'catch' && x.playerId === recv)) res = 'caught';
        else if (g.state !== 'LIVE') res = 'dead:' + g.state;
      }
      const passed = acc.since(e0, 'pass').length > 0;
      out.push({ res: res || 'none', passed, preview: acc.pid(prev) || prev, recv });
      if (g.state === 'LIVE' && !acc.userOff()) g.turnover();
      acc.simUntil('g.state === "LIVE"', 6);
    }
    return out;`);
  const e = trials.find((x) => x.error); assert(!e, e && e.error);
  const notPassed = trials.filter((x) => !x.passed).length; if (notPassed) t.warn(`${notPassed}/30 PASS presses produced no 'pass' event`);
  const hit = trials.filter((x) => x.res === 'intercepted' || x.res === 'deflected' || x.res === 'stolen').length;
  assert(hit >= 9, `only ${hit}/30 passes intercepted or deflected with a defender 0.3 m off the 6 m line (${fmt(trials.map((x) => x.res))})`);
  t.note(`receiver ${got.value}; ${hit}/30 intercepted/deflected`);
});

item('B16', 'SWITCH changes the controlled defender; STL only when the defence catches the poked ball (R#23), none on an offensive recovery; SHOOT on defence → isJumping', { timeoutS: 900, needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('phoneLandscape', '?quick=1&intro=0&seed=7&q=5');
  await run(page, 'return acc.ready({defense: true});');
  const c0 = await ev(page, 'acc.ctrlId()');
  await tapEl(page, '#btnSecondary', 'phoneLandscape');
  await waitFor(page, `acc.ctrlId() !== ${JSON.stringify(c0)} && !acc.userOff()`, 4000, 'controlled defender changes after SWITCH');
  await run(page, 'acc.ready({defense: true}); acc.sim(0.6); return true;');
  await tapEl(page, '#btnPrimary', 'phoneLandscape');
  await waitFor(page, 'acc.airborne(acc.ctrl())', 3000, 'controlled defender airborne (isJumping) after SHOOT/BLOCK');
  // pokes: alternate natural recoveries and forced offensive recoveries; check STL bookkeeping each time
  const res = await run(page, `
    const out = []; const userT = acc.userTeam();
    const stlOf = (tm) => acc.players().filter((p) => acc.teamOf(p) === tm).reduce((s, p) => s + ((acc.statsOf(acc.pid(p)) || {}).stl || 0), 0);
    for (let a = 0; a < 80 && (out.filter((x) => x.rec === 'def').length < 2 || out.filter((x) => x.rec === 'off').length < 2); a++) {
      const r = acc.ready({ defense: true }); if (!r.ok) { out.push({ error: 'not ready' }); break; }
      // §5.1 eligibility: only a dribbling handler outside a move's immunity window can be poked, and the human poke
      // has a 0.8 s cooldown; wait (≤ 3 s of play) for such a moment instead of wasting the attempt on a held ball.
      const w0 = acc.simUntil(() => { const o = acc.owner(); const cp = acc.ctrl(); return o && g.ball.state === 'dribble' && g.world.time > (o.immuneUntil || -1) + 0.2 && !(cp.stealCd > 0) && acc.teamOf(o) !== userT; }, 3);
      if (!w0.ok || g.state !== 'LIVE') continue;
      const h = acc.owner(); const hid = acc.pid(h); const c = acc.ctrlId(); const hp = acc.posOf(hid);
      acc.place(c, hp.x + 0.0, hp.z - 0.8, 0); acc.sim(1 / 60);
      const stl0 = stlOf(userT); const e0 = acc.evts.length;
      acc.pressBtn('tertiary'); acc.sim(1 / 60); acc.releaseBtn('tertiary');
      let loose = false;
      for (let k = 0; k < 40 && !loose; k++) { acc.sim(1 / 60); if (g.ball.state === 'loose') loose = true; }
      if (!loose) continue;
      const forceOff = (a % 2) === 1;
      if (forceOff) { const b = acc.ballPos(); const mate = acc.players().find((p) => acc.teamOf(p) !== userT && acc.pid(p) !== hid); acc.players().filter((p) => acc.teamOf(p) === userT).forEach((p, k) => acc.place(acc.pid(p), -6.8 + 3 * k, -0.8)); acc.place(acc.pid(mate), b.x, b.z); }
      let rec = null;
      for (let k = 0; k < 240 && !rec; k++) { acc.sim(1 / 60); if (acc.ballHeld()) rec = acc.teamOf(acc.owner()) === userT ? 'def' : 'off'; else if (g.state !== 'LIVE') rec = 'dead'; }
      const stl1 = stlOf(userT); const steals = acc.since(e0, 'steal');
      out.push({ rec, forced: forceOff, dStl: stl1 - stl0, stealEvts: steals.length, catcher: acc.owner() ? acc.pid(acc.owner()) : null, stealBy: steals.length ? steals[0].playerId : null });
    }
    return out;`);
  const err = res.find((x) => x.error); assert(!err, err && err.error);
  const defRec = res.filter((x) => x.rec === 'def'), offRec = res.filter((x) => x.rec === 'off');
  assert(defRec.length >= 1, `no poked ball was recovered by the defence in ${res.length} successful pokes (${fmt(res)})`);
  assert(offRec.length >= 1, `no poked ball was recovered by the offence in ${res.length} successful pokes (${fmt(res)})`);
  for (const x of defRec) assert(x.dStl === 1 && x.stealBy === x.catcher, `defensive recovery must credit exactly one STL to the catcher: ${fmt(x)}`);
  for (const x of offRec) assert(x.dStl === 0 && x.stealEvts === 0, `offensive recovery must credit nothing: ${fmt(x)}`);
  t.note(`pokes: ${defRec.length} defensive / ${offRec.length} offensive recoveries checked`);
});

item('B17', 'Shot clock 0.5 s while holding → cap.shotClock, DEAD(SHOT_CLOCK), possession switch; handler walked to x = 8.2 → cap.oob', { needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop', '?quick=1&intro=0&seed=7&q=5');
  await run(page, 'return acc.ready();');
  const r1 = await ev(page, `(() => { const c0 = acc.caps.length, e0 = acc.evts.length, off0 = acc.offenseTeam(); g.setClock({shot: 0.5}); const r = acc.simUntil('g.state !== "LIVE"', 1.5); const dead = acc.deadReason(); const cap = acc.caps.slice(c0).some((c) => c.key === 'cap.shotClock' || (c.text && /进攻超时|Shot clock/.test(c.text))); const tov = acc.since(e0, 'turnover').map((x) => x.reason); acc.simUntil('g.state === "CHECK" || g.state === "LIVE"', 4); return {r, dead, cap, tov, off0, off1: acc.offenseTeam()}; })()`);
  assert(r1.r.ok, `no dead ball within 1.5 s after setClock({shot: 0.5}) (${r1.r.state})`);
  assert(/SHOT/i.test(r1.dead || '') || r1.tov.includes('shotClock'), `dead reason should be SHOT_CLOCK: ${fmt(r1)}`);
  assert(r1.cap, 'cap.shotClock caption not observed');
  assert(r1.off0 !== r1.off1, `possession should switch: ${fmt(r1)}`);
  await run(page, 'return acc.ready();');
  const r2x = await ev(page, `(() => { const c0 = acc.caps.length, off0 = acc.offenseTeam(); const id = acc.ctrlId(); const p = acc.posOf(id); acc.place(id, 8.2, p.z, Math.PI / 2); const r = acc.simUntil('g.state !== "LIVE"', 1.5); const dead = acc.deadReason(); const cap = acc.caps.slice(c0).some((c) => c.key === 'cap.oob' || (c.text && /出界|Out of bounds/.test(c.text))); acc.simUntil('g.state === "CHECK" || g.state === "LIVE"', 4); return {r, dead, cap, off0, off1: acc.offenseTeam()}; })()`);
  assert(r2x.r.ok, `no dead ball within 1.5 s after moving the handler to x = 8.2 (${r2x.r.state})`);
  assert(r2x.cap, 'cap.oob caption not observed');
  assert(r2x.off0 !== r2x.off1, `possession should switch after OOB: ${fmt(r2x)}`);
});

item('B18', 'Quarter/halftime/OT flow; game over #menuOver with 6 box rows (助攻) and #mvpCard naming a legend; tie → 加时赛 / 加时 01:00; HALFTIME: p/Escape/m/t never end it, another key or a tap does', { timeoutS: 900, needs: BASE_HOOKS }, async (t) => {
  requireGame(); const M = await mods();
  const { page } = await t.quick('desktop');
  const endPeriod = async (label) => {
    await run(page, 'return acc.ready();');
    const r = await ev(page, `(() => { const q = g.world.quarter; g.setClock({game: 1}); const r = acc.simUntil('g.state === "QUARTER_END" || g.state === "HALFTIME" || g.state === "GAME_OVER"', 2.5); return {q, r}; })()`);
    assert(r.r.ok, `${label}: period end not reached within 2.5 s after setClock({game: 1}) (${r.r.state})`);
    return r;
  };
  eq((await endPeriod('Q1')).q, 1, 'quarter before the first end');
  assert((await ev(page, `acc.simUntil('g.world.quarter === 2 && (g.state === "CHECK" || g.state === "LIVE")', 5)`)).ok, 'Q2 did not start');
  await endPeriod('Q2');
  assert((await ev(page, `acc.simUntil('g.state === "HALFTIME"', 4)`)).ok, `HALFTIME not reached after Q2 (${await ev(page, 'g.state')})`);
  await ev(page, 'acc.nextFrame(2)');
  assert(await isVisible(page, '#halftime'), '#halftime overlay should be visible at HALFTIME');
  // reserved keys with the simulation frozen (the 3.0 s halftime timer cannot run out meanwhile)
  await ev(page, 'acc.frozen = true');
  for (const key of ['p', 'Escape', 'm', 't', 't', 'm']) {
    await page.keyboard.press(key); await sleep(150);
    const st = await ev(page, '({state: g.state, paused: acc.paused(), vis: acc.visible("#halftime")})');
    if (st.paused) { await page.keyboard.press(key); await sleep(150); }
    assert(st.state === 'HALFTIME', `reserved key "${key}" ended the halftime (state ${st.state})`);
  }
  await ev(page, 'acc.frozen = false');
  const h0 = await ev(page, 'acc.stepCount'); await ev(page, 'acc.sim(1 / 60)');
  assert(await ev(page, 'g.state === "HALFTIME"'), 'a reserved key press was queued and ended the halftime on the next step');
  await page.keyboard.press('x');
  const left = await waitFor(page, 'g.state !== "HALFTIME"', 5000, 'halftime skipped by the "x" key');
  const steps = await ev(page, 'acc.stepCount') - h0;
  assert(steps / 60 < 2.9, `the halftime ended only after ${(steps / 60).toFixed(2)} s of game time (timer, not the key; ${left.ms} ms wall)`);
  assert((await ev(page, `acc.simUntil('g.state === "CHECK" && g.world.quarter === 3', 6)`)).ok, 'Q3 CHECK not reached after the halftime');
  await endPeriod('Q3');
  assert((await ev(page, `acc.simUntil('g.world.quarter === 4 && g.state === "CHECK"', 6)`)).ok, 'Q4 CHECK not reached');
  await run(page, 'acc.ready(); acc.forceTie(); return true;'); t.warn('scores tied by the test before the end of Q4 (forceTie) to exercise overtime');
  const b0 = await ev(page, 'acc.banners.length');
  await endPeriod('Q4');
  assert((await ev(page, `acc.simUntil('g.world.quarter >= 5 && g.state === "CHECK"', 6)`)).ok, `tied after Q4 but no overtime CHECK (${await ev(page, 'g.state')})`);
  await ev(page, 'acc.nextFrame(3)');
  const ban = await ev(page, `acc.banners.slice(${b0}).some((b) => b.key === 'banner.overtime' || (b.text && (b.text.includes('${TXT.zh.overtime}') || b.text.includes('${TXT.en.overtime}'))))`);
  assert(ban, 'banner 加时赛 / OVERTIME not observed');
  const bug = await bugText(page);
  assert(bug.includes(TXT.zh.ot) || bug.includes(TXT.en.ot), `period should read 加时 / OT: "${bug}"`);
  assert(bug.includes('01:00'), `overtime clock should read 01:00: "${bug}"`);
  const mk = (await ev(page, 'acc.shootTrial({n:1, p:1, eT:0, at:{x:0, z:-8.3}, defenders:"away"})'))[0]; assert(mk.made, `could not score in OT: ${fmt(mk)}`);
  await endPeriod('OT');
  assert((await ev(page, `acc.simUntil('g.state === "GAME_OVER"', 6)`)).ok, `GAME_OVER not reached (${await ev(page, 'g.state')})`);
  await waitFor(page, 'acc.visible("#menuOver")', 15000, '#menuOver visible at GAME_OVER (after any game-winner replay)');
  const over = await page.evaluate(() => ({ rows: [...document.querySelectorAll('#boxRows tr')].filter((tr) => tr.querySelector('td')).length, ast: (document.querySelector('th[data-i18n="stats.ast"]') || {}).textContent, mvpVis: (() => { const el = document.querySelector('#mvpCard'); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; })(), mvp: (document.querySelector('#mvpName') || {}).textContent }));
  eq(over.rows, 6, '#menuOver box-score data rows');
  assert(over.ast && over.ast.includes('助攻'), `box score lacks the 助攻 column: "${over.ast}"`);
  assert(over.mvpVis, '#mvpCard should be visible at game over');
  const names = IDS.flatMap((id) => { const L = M.legends.LEGENDS[id]; return [L.name.zh, L.name.en, L.short.zh, L.short.en]; });
  assert(names.some((n) => over.mvp && over.mvp.includes(n)), `#mvpName "${over.mvp}" is not a legend name`);
  // tap skip of the halftime in a rematch
  await page.locator('#btnRematch').click();
  await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 30000, 'rematch CHECK');
  await installHelpers(page);
  await endPeriod('rematch Q1'); assert((await ev(page, `acc.simUntil('g.world.quarter === 2 && g.state === "CHECK"', 6)`)).ok, 'rematch Q2');
  await endPeriod('rematch Q2'); assert((await ev(page, `acc.simUntil('g.state === "HALFTIME"', 4)`)).ok, 'rematch HALFTIME');
  const h1 = await ev(page, 'acc.stepCount');
  await page.mouse.click(640, 360);
  await waitFor(page, 'g.state !== "HALFTIME"', 5000, 'halftime skipped by a tap');
  assert((await ev(page, 'acc.stepCount') - h1) / 60 < 2.9, 'the halftime was not ended by the tap (timer ran out)');
});

item('B19', '?q=0.1&auto=1&seed=5 + fastForward(120) → GAME_OVER (or OT) with both scores > 0', { needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop', '?quick=1&intro=0&q=0.1&auto=1&seed=5');
  for (let i = 0; i < 12; i++) await ev(page, 'g.fastForward(10)');
  const r = await ev(page, '({state: g.state, quarter: g.world.quarter, scores: acc.scores()})');
  assert(r.state === 'GAME_OVER' || r.quarter >= 5, `expected GAME_OVER or overtime, got ${fmt(r)}`);
  assert(r.scores[0] > 0 && r.scores[1] > 0, `both teams should have scored: ${fmt(r)}`);
  t.note(`final ${fmt(r)}`);
});

// ------------------------------------------------------------------------------------------------ layout / mobile
const LAYOUT_CHECK = `(() => {
  const se = document.scrollingElement, c = document.querySelector('#gl') || document.querySelector('canvas');
  const box = (s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
  const inter = (a, b) => !!(a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
  const bug = box('#scoreBug'); const hits = ['#btnPrimary', '#btnPause', '#cluster'].filter((s) => inter(bug, box(s)));
  return { iw: innerWidth, ih: innerHeight, sw: se.scrollWidth, sh: se.scrollHeight, cw: c ? c.clientWidth : null, ch: c ? c.clientHeight : null, bug, hits,
    taBody: getComputedStyle(document.body).touchAction, taCanvas: c ? getComputedStyle(c).touchAction : null };
})()`;
async function layoutChecks(page, w, h, tag) {
  await page.setViewportSize({ width: w, height: h }); await sleep(600);
  const r = await ev(page, LAYOUT_CHECK);
  const problems = [];
  if (r.sw !== r.iw || r.sh !== r.ih) problems.push(`${tag}: scrolling element ${r.sw}×${r.sh} ≠ viewport ${r.iw}×${r.ih}`);
  if (r.cw !== r.iw || r.ch !== r.ih) problems.push(`${tag}: canvas ${r.cw}×${r.ch} ≠ viewport ${r.iw}×${r.ih}`);
  if (!r.bug) problems.push(`${tag}: #scoreBug not visible in LIVE`);
  if (r.hits.length) problems.push(`${tag}: #scoreBug ${fmt(r.bug)} intersects ${r.hits.join(', ')}`);
  if (r.taBody !== 'none' || r.taCanvas !== 'none') problems.push(`${tag}: touch-action body=${r.taBody} canvas=${r.taCanvas}`);
  await page.mouse.move(w / 2, h / 2); await page.mouse.wheel(0, 400); await sleep(200);
  const sy = await page.evaluate(() => ({ y: window.scrollY, top: document.scrollingElement.scrollTop }));
  if (sy.y !== 0 || sy.top !== 0) problems.push(`${tag}: wheel scrolled the page ${fmt(sy)}`);
  return problems;
}
item('B20', 'All 8 viewports in LIVE: no page scroll, canvas = viewport, #scoreBug ∩ (#btnPrimary, #btnPause, #cluster) = ∅, touch-action none, wheel inert', { timeoutS: 600, needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const problems = [];
  const gm = await t.quick('phoneLandscape');
  for (const d of H.VIEWPORT_DEVICES.filter((x) => x !== 'desktop')) { await run(gm.page, 'g.setClock({shot: 14}); return true;'); const v = H.DEVICES[d].viewport; problems.push(...await layoutChecks(gm.page, v.width, v.height, `${d} ${v.width}×${v.height}`)); }
  await t.closeAll();
  const dm = await t.quick('desktop');
  problems.push(...await layoutChecks(dm.page, 1280, 720, 'desktop 1280×720'));
  if (problems.length) fail(problems.join('\n    '));
});

item('B21', 'Rotate 844×390 ↔ 390×844 mid-LIVE: stays LIVE, canvas resizes ≤ 500 ms, fov 42 / 72 ± 4, baseFov(4/3) = 54.2 ± 0.5, rim + ball inside NDC with the view offset', { needs: [...BASE_HOOKS, 'director.camera'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('phoneLandscape');
  await run(page, 'acc.ready(); g.setClock({shot: 14}); return true;');
  const bf = await run(page, "const m = await acc.mod('src/cam/broadcast.js'); return typeof m.baseFov === 'function' ? m.baseFov(4 / 3) : null;");
  assert(typeof bf === 'number', 'src/cam/broadcast.js baseFov(aspect) not callable');
  near(bf, 54.2, 0.5, 'baseFov(4/3)');
  const check = async (fov, tag) => {
    await waitFor(page, `Math.abs(acc.cam().fov - ${fov}) <= 4`, 10000, `${tag}: camera.fov ≈ ${fov}`).catch(async () => fail(`${tag}: camera.fov ${await ev(page, 'acc.cam().fov')} (expected ${fov} ± 4)`));
    const n = await ev(page, '(() => { const b = acc.ballPos(); return { rim: acc.ndc(0, 3.048, -12.75), ball: acc.ndc(b.x, b.y, b.z), view: !!(acc.cam().view && acc.cam().view.enabled) }; })()');
    for (const k of ['rim', 'ball']) assert(Math.abs(n[k].x) <= 1 && Math.abs(n[k].y) <= 1, `${tag}: ${k} outside NDC ${fmt(n[k])}`);
    return n;
  };
  await check(42, 'landscape');
  // timed in the page from the window resize event to the first moment the canvas has the new size (checked right
  // after every resize listener and on every frame): the Node-side wall clock also counted SwiftShader frames that
  // hold up page.evaluate, which a phone does not have
  await run(page, `
    const fits = () => { const c = document.querySelector('#gl'); const pr = g.renderer.getPixelRatio(); return c.clientWidth === 390 && c.clientHeight === 844 && Math.abs(c.width / pr - 390) < 2 && Math.abs(c.height / pr - 844) < 2; };
    const R = acc._rz = { ev: null, done: null };
    const check = () => { if (R.ev != null && R.done == null && fits()) R.done = performance.now(); };
    addEventListener('resize', () => { if (R.ev == null) R.ev = performance.now(); setTimeout(check, 0); check(); });
    const tick = () => { check(); if (R.done == null) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    return true;`);
  await page.setViewportSize({ width: 390, height: 844 });
  await waitFor(page, 'acc._rz.done != null', 5000, 'canvas resized to 390×844');
  const ms = Math.round(await ev(page, 'acc._rz.done - acc._rz.ev')); assert(ms <= 500, `canvas resize took ${ms} ms (> 500 ms)`);
  eq(await ev(page, 'g.state'), 'LIVE', 'state after rotation');
  const n = await check(72, 'portrait');
  if (!n.view) t.warn('portrait camera has no enabled view offset (lens shift 0.25 expected)');
  await page.setViewportSize({ width: 844, height: 390 });
  await check(42, 'back to landscape');
  eq(await ev(page, 'g.state'), 'LIVE', 'state after rotating back');
});

item('B22', 'First portrait title shows #rotateHint; hidden in LIVE even if not dismissed (R#8); 知道了 persists across reload', { needs: ['ui.screen'] }, async (t) => {
  requireGame();
  const { page } = await t.boot('phonePortrait', QUICK);
  await H.waitTitle(page);
  await waitFor(page, "acc.visible('#rotateHint')", 4000, '#rotateHint visible on the first portrait title');
  await page.locator('#btnQuick').click();
  await page.evaluate(() => Promise.resolve(window.__game.legendsReady));
  await waitFor(page, "g.state === 'LIVE'", 30000, 'LIVE');
  assert(!(await isVisible(page, '#rotateHint')), '#rotateHint still visible in LIVE (R#8)');
  await page.reload({ waitUntil: 'load' }); await installHelpers(page); await H.waitTitle(page);
  await waitFor(page, "acc.visible('#rotateHint')", 4000, '#rotateHint visible again (it was never dismissed)');
  await page.locator('#btnRotateDismiss').click(); await sleep(300);
  assert(!(await isVisible(page, '#rotateHint')), '#rotateHint still visible after 知道了');
  await page.reload({ waitUntil: 'load' }); await installHelpers(page); await H.waitTitle(page); await sleep(1500);
  assert(!(await isVisible(page, '#rotateHint')), '#rotateHint reappeared after reload (知道了 not persisted)');
});

item('B23', '?quality=low/medium/high → getPixelRatio() ≤ 1.0 / 1.5 / 2.0; auto under iPhone 11 emulation → rung 2 (≤ 1.0)', { needs: ['renderer', 'quality.rung'] }, async (t) => {
  requireGame();
  const out = {};
  for (const tier of ['low', 'medium', 'high']) {
    const { page } = await t.boot('phonePortrait', `?seed=7&quality=${tier}`);
    await H.waitTitle(page); await needHooks(page, ['renderer', 'quality.rung']);
    const r = await ev(page, '({dpr: g.renderer.getPixelRatio(), tier: g.quality.tier, rung: g.quality.rung})');
    out[tier] = r;
    assert(r.dpr <= SPEC.dprMax[tier] + 1e-6, `?quality=${tier}: pixel ratio ${r.dpr} > ${SPEC.dprMax[tier]}`);
    eq(r.tier, tier, `?quality=${tier} → quality.tier`);
    await t.closeAll();
  }
  const { page } = await t.boot('phonePortrait', '?seed=7');
  await H.waitTitle(page);
  const a = await ev(page, '({dpr: g.renderer.getPixelRatio(), rung: g.quality.rung, auto: g.quality.auto})');
  eq(a.rung, 2, 'auto rung under iPhone 11 emulation (SwiftShader → software class)');
  assert(a.dpr <= 1.0 + 1e-6, `auto pixel ratio ${a.dpr} > 1.0`);
  t.note(`forced ${fmt(out)}; auto ${fmt(a)}`);
});

item('B24', 'visibilitychange hidden → paused, clock frozen; visible → pause menu, clock frozen until resume', { needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop');
  await run(page, 'return acc.ready();');
  await ev(page, "acc.setVisibility('hidden')");
  await waitFor(page, 'acc.paused()', 3000, 'paused after hidden');
  const c0 = await ev(page, 'g.world.gameClock'); await sleep(1000); const c1 = await ev(page, 'g.world.gameClock');
  assert(Math.abs(c1 - c0) < 1e-6, `game clock moved while hidden: ${c0} → ${c1}`);
  await ev(page, "acc.setVisibility('visible')"); await sleep(400);
  assert(await ev(page, 'acc.paused()'), 'the game auto-resumed on visible (must stay paused)');
  assert(await isVisible(page, '#menuPause'), '#menuPause not shown after returning visible');
  await sleep(1000); const c2 = await ev(page, 'g.world.gameClock');
  assert(Math.abs(c2 - c0) < 1e-6, `game clock moved after visible, before resume: ${c0} → ${c2}`);
  await page.locator('#btnResume').click();
  await waitFor(page, '!acc.paused()', 5000, 'unpaused after 继续');
});

// ------------------------------------------------------------------------------------------------ performance / rendering
item('B25', 'Per forced tier after 5 s LIVE: draw calls, triangles, texMB ≤ §7.5; stepMs mean < 1.5 ms over fastForward(10); animMs reported', { timeoutS: 900, needs: [...BASE_HOOKS, 'perf.drawCalls', 'perf.triangles', 'perf.texMB', 'perf.stepMs', 'perf.animMs'] }, async (t) => {
  requireGame();
  const rows = []; const problems = [];
  for (const tier of ['low', 'medium', 'high']) {
    const { page } = await t.quick('desktop', `${QUICK}&quality=${tier}`);
    await run(page, 'acc.ready(); g.setClock({shot: 14}); return true;');
    await sleep(5000);
    const P = await H.frameStats(page);
    const B = tier === 'high' ? SPEC.budgets.highDesktop : SPEC.budgets[tier];
    const cost = await ev(page, 'acc.stepCost()');
    rows.push({ tier, ...P, stepLoopMs: cost.stepLoopMs, perfStepMs: cost.perfStepMs, animMs: cost.animMs });
    if (!(P.calls > 0 && P.calls <= B.calls)) problems.push(`${tier}: draw calls ${P.calls} (≤ ${B.calls})`);
    if (!(P.tris > 0 && P.tris <= B.tris)) problems.push(`${tier}: triangles ${P.tris} (≤ ${B.tris})`);
    if (!(P.texMB > 0 && P.texMB <= B.texMB)) problems.push(`${tier}: texMB ${P.texMB} (≤ ${B.texMB})`);
    const stepMs = cost.fastForwardMs;
    if (!(stepMs < 1.5)) problems.push(`${tier}: mean step ${stepMs} ms over fastForward(10) (≥ 1.5 ms)`);
    if (typeof cost.animMs !== 'number') problems.push(`${tier}: __game.perf.animMs not reported`);
    await t.closeAll();
  }
  t.note(rows.map((r) => `${r.tier}: ${r.calls} calls, ${r.tris} tris, ${r2(r.texMB)} MB, step ${r.stepLoopMs} ms, anim ${r.animMs} ms`).join(' | '));
  if (problems.length) fail(problems.join('\n    '));
});

/** Kit-box test of B26/B42 for both ★ handlers (lineup a[0], b[0]) on a 3D-only screenshot. */
/**
 * The ★ players' torso boxes measured on the 3D frame. The torso box (0.6 × shoulder width) also covers whatever is
 * in front of or around the chest at that moment (the check ball held at the chest, hands, the floor beside a
 * crouched defender) and the kit's number, none of which is the kit colour: kitCapture renders the same frame three
 * times inside one task (lit, kit coverage, kit albedo) and the statistics use the visible base-colour pixels only.
 */
/**
 * In-page triple render of one frame (no frame in between, so poses and camera are identical) read back per torso box:
 * `normal` = the lit frame; `mask` = only the given players' kit meshes white on black (what of the kit is visible);
 * `albedo` = the same kit meshes unlit with their own kit texture (the painted colour of every visible kit pixel), so
 * callers can keep the kit's base colour and drop the number, trim, ball, hands and floor.
 */
async function kitCapture(page, ids) {
  return run(page, `
    const T = await acc.mod('vendor/three.module.js');
    const r = g.renderer, scene = g.scene, cam = (g.director && g.director.camera) || g.camera, ids = ${JSON.stringify(ids)};
    const boxes = ids.map((id) => acc.torsoBox(id));
    const gl = r.getContext(), cv = r.domElement, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, k = W / (cv.clientWidth || W);
    const grab = (b) => { if (!b) return null; const x0 = Math.max(0, Math.round((b.cx - b.w / 2) * k)), y0 = Math.max(0, Math.round((b.cy - b.h / 2) * k)); const x1 = Math.min(W, Math.round((b.cx + b.w / 2) * k)), y1 = Math.min(H, Math.round((b.cy + b.h / 2) * k)); const w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return null; const buf = new Uint8Array(w * h * 4); gl.readPixels(x0, H - y1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); const out = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((h - 1 - y) * w + x) * 4; out.push(buf[i], buf[i + 1], buf[i + 2]); } return { w, h, px: out }; };
    r.render(scene, cam); const normal = boxes.map(grab);
    const black = new T.MeshBasicMaterial({ color: 0x000000 }), white = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide, toneMapped: false });
    const kitOf = new Map(ids.map((id) => [g.characters[id].kitMesh, g.characters[id]]));
    const flat = new Map(); for (const [m] of kitOf) flat.set(m, new T.MeshBasicMaterial({ map: m.material.map || null, side: T.DoubleSide, toneMapped: false }));
    const saved = [];
    scene.traverse((o) => { if (o.isMesh) saved.push([o, 'material', o.material]); else if ((o.isPoints || o.isLine || o.isSprite) && o.visible) { saved.push([o, 'visible', true]); o.visible = false; } });
    const bg = scene.background; scene.background = new T.Color(0x000000);
    for (const [o, key] of saved) if (key === 'material') o.material = kitOf.has(o) ? white : black;
    r.render(scene, cam); const mask = boxes.map(grab);
    for (const [o, key] of saved) if (key === 'material') o.material = kitOf.has(o) ? flat.get(o) : black;
    r.render(scene, cam); const albedo = boxes.map(grab);
    for (const [o, key, v] of saved) o[key] = v; scene.background = bg; black.dispose(); white.dispose(); for (const m of flat.values()) m.dispose();
    r.render(scene, cam);
    return { boxes, normal, mask, albedo };`);
}
/**
 * Pixel filter of one captured box: visible kit pixels whose painted colour is the kit's base colour (within 40/255 per
 * channel of `baseHex`, or of the most common painted colour when no base is given), i.e. no number, name, trim,
 * piping or anti-aliased number edge. B26 passes the spec base: on a phone a ★ chest is ~8 × 6 px and in some frames
 * the white number is the most common painted colour of the box.
 */
function kitBaseFilter(cap, i, baseHex) {
  const mb = cap.mask[i], ab = cap.albedo[i]; if (!mb || !ab) return null;
  const n = mb.w * mb.h, hist = new Map();
  for (let k = 0; k < n; k++) if (mb.px[k * 3] > 128) { const key = (ab.px[k * 3] >> 4) + ',' + (ab.px[k * 3 + 1] >> 4) + ',' + (ab.px[k * 3 + 2] >> 4); hist.set(key, (hist.get(key) || 0) + 1); }
  if (!hist.size) return () => false;
  const top = baseHex ? hexRgb(baseHex) : [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map((v) => Number(v) * 16 + 8);
  return (x, y) => { const k = y * mb.w + x; if (mb.px[k * 3] <= 128) return false; return Math.abs(ab.px[k * 3] - top[0]) <= 40 && Math.abs(ab.px[k * 3 + 1] - top[1]) <= 40 && Math.abs(ab.px[k * 3 + 2] - top[2]) <= 40; };
}
async function starKitBoxes(page, name, M) {
  const ids = await ev(page, '(() => { const l = g.lineup; return [l.a[0], l.b[0]]; })()');
  await ev(page, 'acc.hideDom()'); await ev(page, 'acc.nextFrame(2)');
  const cap = await kitCapture(page, ids);
  await shot(page, name);
  await ev(page, 'acc.showDom()');
  const out = [];
  for (let i = 0; i < 2; i++) {
    const id = ids[i]; const L = M.legends.LEGENDS[id]; const kit = L.kit[L.kit.classic];
    const nb = cap.normal[i], mb = cap.mask[i]; let s = null, part = null;
    if (nb && mb && nb.w === mb.w && nb.h === mb.h) {
      const img = { width: nb.w, height: nb.h, data: nb.px, bpp: 3 };
      const isKit = kitBaseFilter(cap, i, kit.base);
      s = kitBoxStats(img, { cx: nb.w / 2, cy: nb.h / 2, w: nb.w, h: nb.h }, { baseHex: kit.base, numberHex: kit.number, mask: isKit });
      if (s) s.kitFrac = s.n / (nb.w * nb.h);
      part = { img, isKit };
    }
    out.push({ id, base: kit.base, number: kit.number, box: cap.boxes[i], s, part });
  }
  return out;
}
/**
 * Kit statistics of one ★ pooled over several captures (B26): the captured torso boxes are stacked into one image
 * (rows padded with masked-out pixels) and measured as one box, so a ★ seen at 10–40 px per frame on a phone still
 * yields a sample of ≥ 60 kit pixels.
 */
function pooledKitStats(entries) {
  const parts = entries.map((e) => e.part).filter(Boolean); if (!parts.length) return null;
  const W = Math.max(...parts.map((p) => p.img.width)), H = parts.reduce((a, p) => a + p.img.height, 0);
  const data = new Uint8Array(W * H * 3), keep = new Uint8Array(W * H);
  let y0 = 0;
  for (const p of parts) {
    for (let y = 0; y < p.img.height; y++) for (let x = 0; x < p.img.width; x++) {
      const si = (y * p.img.width + x) * 3, di = ((y0 + y) * W + x) * 3;
      data[di] = p.img.data[si]; data[di + 1] = p.img.data[si + 1]; data[di + 2] = p.img.data[si + 2];
      keep[(y0 + y) * W + x] = p.isKit && p.isKit(x, y) ? 1 : 0;
    }
    y0 += p.img.height;
  }
  const e = entries[0];
  return kitBoxStats({ width: W, height: H, data, bpp: 3 }, { cx: W / 2, cy: H / 2, w: W, h: H }, { baseHex: e.base, numberHex: e.number, mask: (x, y) => keep[y * W + x] === 1 });
}
item('B26', 'Screenshots title / LIVE 2 s / LIVE 8 s (landscape, portrait): luma > 0.12 on > 25 %, pairwise > 1 % different; DOM team chips exact; ★ torso boxes keep the kit hue ±18° (≥ 40 % kept) and differ in mean luma ≥ 0.12', { timeoutS: 900, needs: [...BASE_HOOKS, 'characters', 'lineup', 'director.camera'] }, async (t) => {
  requireGame(); const M = await mods();
  const problems = [];
  for (const device of ['phoneLandscape', 'phonePortrait']) {
    const { page } = await t.boot(device, '?quick=1&intro=0&auto=1&seed=7');
    await H.waitTitle(page); await H.dismissRotateHint(page); await sleep(800);
    const shots = { title: await shot(page, `B26-${device}-title`) };
    await page.locator('#btnQuick').click(); await page.evaluate(() => Promise.resolve(window.__game.legendsReady));
    await waitForState(page, 'LIVE', 30000); await installHelpers(page);
    await ev(page, 'g.fastForward(2)'); await ev(page, 'acc.nextFrame(3)');
    shots.live2 = await shot(page, `B26-${device}-live2`);
    // the ★ torso boxes are measured on the LIVE frames from 2 s to 8 s (every second) and pooled: on a phone a ★
    // covers 2–40 kit pixels per frame (portrait broadcast view: players ≈ 45 px tall), too few for a median hue or a
    // mean lightness from a single frame, and the 2 s frame alone often had one ★ screened by his defender
    const caps = [await starKitBoxes(page, `B26-${device}-kits`, M)];
    for (let k = 3; k < 8; k++) { await ev(page, 'g.fastForward(1)'); await ev(page, 'acc.nextFrame(3)'); caps.push(await starKitBoxes(page, `B26-${device}-kits${k}`, M)); }
    await ev(page, 'g.fastForward(1)'); await ev(page, 'acc.nextFrame(3)');
    shots.live8 = await shot(page, `B26-${device}-live8`);
    caps.push(await starKitBoxes(page, `B26-${device}-kits8`, M));
    const kits = caps[0].map((k, i) => ({ ...k, s: pooledKitStats(caps.map((c) => c[i])) }));
    for (const [n, img] of Object.entries(shots)) { const f = lumaFraction(img, 0.12); if (!(f > 0.25)) problems.push(`[${device}] ${n}: only ${(f * 100).toFixed(1)} % of pixels with luma > 0.12`); }
    for (const [a, b] of [['title', 'live2'], ['title', 'live8'], ['live2', 'live8']]) { const d = diffFraction(shots[a], shots[b], 24, 2); if (!(d > 0.01)) problems.push(`[${device}] ${a} vs ${b} differ by only ${(d * 100).toFixed(2)} %`); }
    const chips = await page.evaluate(() => ['#barA', '#barB', '#chipA', '#chipB'].map((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).backgroundColor : null; }));
    const want = [SPEC.teamBg.dark, SPEC.teamBg.bright].map((h) => `rgb(${hexRgb(h).join(', ')})`);
    if (!(chips[0] === want[0] || chips[2] === want[0])) problems.push(`[${device}] team A chip/bar colour ${chips[0]} / ${chips[2]} ≠ ${want[0]}`);
    if (!(chips[1] === want[1] || chips[3] === want[1])) problems.push(`[${device}] team B chip/bar colour ${chips[1]} / ${chips[3]} ≠ ${want[1]}`);
    for (const k of kits) {
      if (!k.s) { problems.push(`[${device}] ${k.id}: torso box off-screen or degenerate ${fmt(k.box)}`); continue; }
      if (!(k.s.keptFrac >= 0.40)) problems.push(`[${device}] ${k.id}: only ${(k.s.keptFrac * 100).toFixed(0)} % of the torso box kept (≥ 40 %)`);
      if (!(k.s.hueErr <= 18)) problems.push(`[${device}] ${k.id}: median hue ${k.s.medHue.toFixed(0)}° vs kit base ${k.base} (error ${k.s.hueErr.toFixed(1)}° > 18°)`);
    }
    // DARK (#6F263D) vs BRIGHT (#CE1141): their Rec. 709 luma of the gamma-encoded bytes differs by only 0.02 (0.216 vs
    // 0.238), so "differ in mean luma ≥ 0.12" can only mean lightness — the sRGB-encoded mean relative luminance,
    // 0.25 vs 0.40 for the two base colours
    if (kits[0].s && kits[1].s) { const dl = Math.abs(kits[0].s.meanLight - kits[1].s.meanLight); if (!(dl >= 0.12)) problems.push(`[${device}] ★ torso boxes differ in mean lightness by ${dl.toFixed(3)} (< 0.12)`); }
    t.note(`[${device}] ${kits.map((k) => k.s ? `${k.id} hue err ${k.s.hueErr.toFixed(1)}° kept ${(k.s.keptFrac * 100).toFixed(0)} % luma ${k.s.meanLuma.toFixed(2)} lightness ${k.s.meanLight.toFixed(2)} (${k.s.n} px)` : `${k.id} n/a`).join('; ')}`);
    await t.closeAll();
  }
  if (problems.length) fail(problems.join('\n    '));
});

item('B27', 'Audio: null before a gesture, created on the first click; M mutes (master gain 0); every v1 + v2 SFX and the crowd module run without throwing while suspended', { needs: ['audio'] }, async (t) => {
  requireGame();
  const gm = await t.boot('desktop', QUICK); const { page } = gm;
  await H.waitTitle(page); await needHooks(page, ['audio']);
  assert(await ev(page, 'g.audio.ctx == null'), `audio.ctx should be null before any gesture, got ${await ev(page, 'String(g.audio.ctx && g.audio.ctx.state)')}`);
  await page.locator('#btnQuick').click(); await sleep(300);
  const st = await ev(page, 'g.audio.ctx ? g.audio.ctx.state : null');
  assert(st === 'running' || st === 'suspended', `after the first click audio.ctx.state should be running/suspended, got ${fmt(st)}`);
  await page.evaluate(() => Promise.resolve(window.__game.legendsReady)); await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 30000, 'CHECK');
  await page.keyboard.press('m'); await sleep(200);
  const m = await ev(page, '({muted: g.audio.muted, gain: g.audio.master ? g.audio.master.gain.value : null})');
  assert(m.muted === true, `audio.muted should be true after M: ${fmt(m)}`);
  assert(m.gain === 0, `master gain should be 0 when muted: ${fmt(m)}`);
  await page.keyboard.press('m');
  const res = await page.evaluate(async () => {
    const a = window.__game.audio; try { await a.ctx.suspend(); } catch (e) { /* ignore */ }
    const bad = [], missing = [];
    const calls = [['bounce', 1, 0, -5], ['rim', 1, 'tap'], ['rim', 1, 'clank'], ['rim', 1, 'rattle'], ['rim', 1, 'grab'], ['board', 'bank'], ['board', 'thud'],
      ['net', 'swish'], ['net', 'rimIn'], ['net', 'snap'], ['swish'], ['block', 0, -10], ['dunk'], ['squeak', 1, 0, -5, 0], ['thud', 1, 0, -5], ['whistle'], ['horn'],
      ['buzzer'], ['shotHorn'], ['tick'], ['click'], ['select'], ['whoosh'], ['boom'], ['sting'], ['wipe'], ['crowd', 1, 1.5], ['groan'], ['update', 0.016]];
    const required = ['bounce', 'rim', 'board', 'net', 'squeak', 'thud', 'whistle', 'horn', 'shotHorn', 'tick', 'select', 'whoosh', 'boom', 'sting', 'wipe', 'swish', 'block', 'dunk', 'buzzer', 'click', 'crowd', 'groan', 'update'];
    for (const n of required) if (typeof a[n] !== 'function') missing.push('audio.' + n);
    for (const [n, ...args] of calls) { if (typeof a[n] !== 'function') continue; try { a[n](...args); } catch (e) { bad.push(n + ': ' + e.message); } }
    if (typeof a.setSlow === 'function') { try { a.setSlow(true); a.rim(1, 'grab'); a.net('swish'); a.setSlow(false); } catch (e) { bad.push('slow variants: ' + e.message); } }
    const c = a.crowdAudio || window.__game.crowdAudio;
    if (!c) missing.push('crowd module (audio.crowdAudio)');
    else {
      const cc = [['excite', 1, 1], ['burst', 'ooh', 0.6], ['burst', 'aah', 0.6], ['burst', 'aww', 0.6], ['applause', 2], ['chant', true], ['chant', false], ['anticipate'], ['resolveAnticipation', 'make'], ['update', 0.016]];
      for (const n of ['excite', 'burst', 'applause', 'chant']) if (typeof c[n] !== 'function') missing.push('crowdAudio.' + n);
      for (const [n, ...args] of cc) { if (typeof c[n] !== 'function') continue; try { c[n](...args); } catch (e) { bad.push('crowd.' + n + ': ' + e.message); } }
    }
    return { state: a.ctx && a.ctx.state, bad, missing };
  });
  assert(res.missing.length === 0, `missing audio API: ${res.missing.join(', ')}`);
  assert(res.bad.length === 0, `SFX threw with ctx ${res.state}: ${res.bad.join('; ')}`);
  assert(gm.diag.pageErrors.length === 0, `uncaught exception: ${gm.diag.pageErrors[0]}`);
});

// ------------------------------------------------------------------------------------------------ characters
item('B28', 'legendsReady ≤ 30 s; ids = the six; dims.heightBarefoot ±0.02 m of 1.96/1.96/2.03/2.09/2.27/1.87; showcase lineup pixel-height ratio Yao/Kyrie = 2.27/1.87 ± 3 %', { timeoutS: 600, needs: ['legendsReady', 'characters', 'lib'] }, async (t) => {
  requireGame();
  const gm = await t.open('desktop', 'index.html' + QUICK, { navigate: false }); const { page } = gm;
  const t0 = Date.now(); await page.goto(gm.target, { waitUntil: 'commit' });
  await waitFor(page, '!!window.__game && !!window.__game.legendsReady', 30000, '__game.legendsReady');
  await page.evaluate(() => Promise.resolve(window.__game.legendsReady));
  const sec = (Date.now() - t0) / 1000; assert(sec <= 30, `legendsReady resolved ${sec.toFixed(1)} s after navigation (> 30 s)`);
  await installHelpers(page); await needHooks(page, ['characters', 'lib']);
  const ids = await ev(page, 'Object.keys(g.characters).sort()');
  eq(ids.join(','), IDS.slice().sort().join(','), '__game.characters ids');
  const dims = await ev(page, `(${JSON.stringify(IDS)}).map((id) => [id, g.characters[id].dims.heightBarefoot])`);
  for (const [id, hb] of dims) near(hb, SPEC.heights[id], 0.02, `${id} dims.heightBarefoot`);
  await t.closeAll();
  const sc = await t.open('desktop', 'index.html?showcase=1&view=lineup&yaw=0&kit=classic');
  await waitFor(sc.page, 'window.__showcase && window.__showcase.ready === true', 120000, '__showcase.ready');
  const img = await shot(sc.page, 'B28-showcase-lineup');
  const figs = figures(img);
  assert(figs.length === 6, `showcase lineup: found ${figs.length} figures (expected 6): ${fmt(figs.map((f) => [f.x0, f.x1, f.h]))}`);
  const hs = figs.map((f) => f.h).sort((a, b) => a - b);
  const ratio = hs[5] / hs[0]; const want = 2.27 / 1.87;
  assert(Math.abs(ratio / want - 1) <= 0.03, `pixel-height ratio tallest/shortest (Yao/Kyrie) ${ratio.toFixed(4)} vs ${want.toFixed(4)} (± 3 %)`);
  t.note(`legendsReady ${sec.toFixed(1)} s; figure heights ${hs.join('/')} px; ratio ${ratio.toFixed(4)}`);
});

item('B29', 'Pairwise RMS distance of the six players\' kept positions > 0.008 m; showcase head and full-body crops pairwise differ by > 6 % of pixels (Δ > 24)', { timeoutS: 600, needs: ['characters'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop');
  await needHooks(page, ['characters']);
  const rms = await ev(page, `(() => {
    const ids = ${JSON.stringify(IDS)}; const pos = ids.map((id) => g.characters[id].body.geometry.attributes.position.array);
    const out = [];
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      const a = pos[i], b = pos[j]; const n = Math.min(a.length, b.length); let s = 0;
      for (let k = 0; k < n; k++) { const d = a[k] - b[k]; s += d * d; }
      out.push([ids[i], ids[j], Math.sqrt(s / (n / 3)), a.length === b.length]);
    }
    return out; })()`);
  const low = rms.filter((r) => !(r[2] > 0.008)); assert(!low.length, `pairs with RMS ≤ 0.008 m: ${fmt(low)}`);
  const mism = rms.filter((r) => !r[3]); if (mism.length) t.warn(`position arrays differ in length for ${mism.length} pairs (compared the common prefix)`);
  await t.closeAll();
  const crops = {};
  for (const view of ['heads', 'lineup']) {
    const sc = await t.open('desktop', `index.html?showcase=1&view=${view}&yaw=0&kit=classic`);
    await waitFor(sc.page, 'window.__showcase && window.__showcase.ready === true', 120000, `__showcase.ready (${view})`);
    const img = await shot(sc.page, `B29-showcase-${view}`);
    if (view === 'heads') {
      // 6 × 2 scissor grid: cells of the first row (yaw 0)
      const cw = Math.floor(img.width / 6), ch = Math.floor(img.height / 2);
      crops.heads = IDS.map((id, i) => ({ id, r: { x: i * cw, y: 0, w: cw, h: ch } }));
    } else {
      const figs = figures(img); assert(figs.length === 6, `lineup view: ${figs.length} figures`);
      const w = Math.max(...figs.map((f) => f.x1 - f.x0 + 1)), top = Math.min(...figs.map((f) => f.top)), bottom = Math.max(...figs.map((f) => f.bottom));
      crops.lineup = figs.map((f, i) => ({ id: i, r: { x: Math.max(0, Math.min(img.width - w, Math.round(f.cx - w / 2))), y: top, w, h: bottom - top + 1 } }));
    }
    crops[view + 'Img'] = img;
    await t.closeAll();
  }
  const problems = [];
  for (const view of ['heads', 'lineup']) {
    const img = crops[view + 'Img'], list = crops[view];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = diffFraction(img, img, 24, 1, list[i].r, list[j].r);
      if (!(d > 0.06)) problems.push(`${view}: crops ${list[i].id} vs ${list[j].id} differ by ${(d * 100).toFixed(1)} % (≤ 6 %)`);
    }
  }
  if (problems.length) fail(problems.join('\n    '));
  t.note(`min RMS ${Math.min(...rms.map((r) => r[2])).toFixed(4)} m`);
});

// ------------------------------------------------------------------------------------------------ lineup
const LU = '#screenLineup';
async function lineupTap(page, id) { await page.locator(`${LU} .card[data-id="${id}"]`).first().click({ timeout: 5000 }); await sleep(120); }
async function kitModes(page) { return ev(page, `Object.fromEntries(${JSON.stringify(IDS)}.map((id) => [id, g.characters[id].kitMode]))`); }
/** Median luma of each player's torso box on a 3D-only frame (DOM layers hidden). */
/**
 * Median chest luma of each player's kit base colour: the same in-page capture as starKitBoxes, so idle motion between
 * frames, arms, the floor and the number never enter the statistic.
 */
async function torsoLumas(page, ids, name) {
  await ev(page, 'acc.hideDom()'); await ev(page, 'acc.nextFrame(3)');
  const cap = await kitCapture(page, ids);
  await shot(page, name); await ev(page, 'acc.showDom()');
  return ids.map((id, i) => {
    const nb = cap.normal[i], keep = kitBaseFilter(cap, i); if (!nb || !keep) return { id, med: NaN };
    const l = []; for (let y = 0; y < nb.h; y++) for (let x = 0; x < nb.w; x++) if (keep(x, y)) { const k = y * nb.w + x; l.push(luma(nb.px[k * 3], nb.px[k * 3 + 1], nb.px[k * 3 + 2])); }
    return { id, med: l.length >= 6 ? median(l) : NaN, n: l.length };
  });
}
item('B30', 'Title → 开始游戏 → lineup DARK (LeBron ★, Kyrie, Giannis) vs BRIGHT (Jordan ★, Kobe, Yao); tap Kobe then LeBron → swapped, kits allstarA/B (chest luma A > 0.7, B < 0.2); 开始 → 白队/黑队 (WHT/BLK); cards/buttons ≥ 44 px on 390×844, 844×390, 360×640', { timeoutS: 600, needs: ['characters', 'lineup', 'ui.screen'] }, async (t) => {
  requireGame();
  const { page } = await t.boot('phoneLandscape', '?seed=7&intro=0');
  await H.openLineup(page); await needHooks(page, ['characters', 'lineup', 'ui.screen']);
  const ids0 = await ev(page, 'acc.cardIds()');
  eq(ids0.join(','), [...SPEC.defaultLineup.a, ...SPEC.defaultLineup.b].join(','), 'lineup cards in slot order');
  const names = await page.evaluate((s) => [...document.querySelectorAll(s + ' .luTeam .tname')].map((e) => e.textContent.trim()), LU);
  assert(names[0] && names[0].includes('暗夜') && names[1] && names[1].includes('烈阳'), `team headers should be 暗夜队 / 烈阳队: ${fmt(names)}`);
  const sizes = [];
  for (const [w, h] of [[390, 844], [844, 390], [360, 640]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(500);
    const small = await page.evaluate((s) => [...document.querySelectorAll(`${s} button, ${s} .card, ${s} .opt`)].filter((el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 43.5 || r.height < 43.5); }).map((el) => { const r = el.getBoundingClientRect(); return `${el.className || el.tagName}[${el.getAttribute('data-slot') || el.getAttribute('data-kits') || el.getAttribute('data-user') || ''}] ${r.width.toFixed(0)}×${r.height.toFixed(0)}`; }), LU);
    if (small.length) sizes.push(`${w}×${h}: ${small.join(', ')}`);
  }
  assert(!sizes.length, `lineup tappables under 44 px: ${sizes.join(' | ')}`);
  await page.setViewportSize({ width: 844, height: 390 }); await sleep(300);
  await lineupTap(page, 'kobe'); await lineupTap(page, 'lebron');
  const ids1 = await ev(page, 'acc.cardIds()');
  eq(ids1.join(','), ['kobe', 'kyrie', 'giannis', 'jordan', 'lebron', 'yao'].join(','), 'cards after tapping Kobe then LeBron');
  await waitFor(page, `(() => { const m = ${JSON.stringify(IDS)}.map((id) => g.characters[id].kitMode); return ['kobe','kyrie','giannis'].every((id) => g.characters[id].kitMode === 'allstarA') && ['jordan','lebron','yao'].every((id) => g.characters[id].kitMode === 'allstarB') ? m : null; })()`, 5000, 'kitMode allstarA (team A) / allstarB (team B) after the swap');
  await sleep(800);
  const lum = await torsoLumas(page, ['kobe', 'kyrie', 'giannis', 'jordan', 'lebron', 'yao'], 'B30-lineup-allstar');
  for (const l of lum.slice(0, 3)) assert(l.med > 0.7, `${l.id} (All-Star A, white) chest luma ${r3(l.med)} ≤ 0.7`);
  for (const l of lum.slice(3)) assert(l.med < 0.2, `${l.id} (All-Star B, black) chest luma ${r3(l.med)} ≥ 0.2`);
  await page.locator(`${LU} .luStart`).first().click();
  await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 30000, 'CHECK after 开始');
  await installHelpers(page);
  await waitFor(page, `(() => { const s = document.querySelector('#scoreBug').innerText; return s.includes('${TXT.zh.white}') && s.includes('${TXT.zh.black}'); })()`, 3000, 'score bug 白队 / 黑队');
  await page.keyboard.press('t');
  await waitFor(page, `(() => { const s = document.querySelector('#scoreBug').innerText; return s.includes('${TXT.en.white}') && s.includes('${TXT.en.black}'); })()`, 3000, 'score bug WHT / BLK');
  t.note(`chest median luma ${lum.map((l) => `${l.id} ${r2(l.med)}`).join(', ')}`);
});

/** Most frequent RGB (5-bit bins, then the exact mean of the bin) of a character's kit atlas texture. */
const KIT_MODE_EXPR = (id) => `(() => {
  const c = g.characters[${JSON.stringify(id)}]; const tex = c.kitMesh && c.kitMesh.material && c.kitMesh.material.map; if (!tex || !tex.image) return null;
  let data = tex.image.data, w = tex.image.width, h = tex.image.height;
  if (!data) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d'); cx.drawImage(tex.image, 0, 0); data = cx.getImageData(0, 0, w, h).data; }
  const st = Math.max(1, Math.floor(Math.sqrt(w * h / 65536))); const bins = new Map();
  for (let y = 0; y < h; y += st) for (let x = 0; x < w; x += st) { const i = (y * w + x) * 4; const k = (data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3); const b = bins.get(k) || [0, 0, 0, 0]; b[0]++; b[1] += data[i]; b[2] += data[i + 1]; b[3] += data[i + 2]; bins.set(k, b); }
  let best = null; for (const b of bins.values()) if (!best || b[0] > best[0]) best = b;
  return [best[1] / best[0], best[2] / best[0], best[3] / best[0]].map(Math.round);
})()`;
item('B31', '重置 → classic kits (atlas ±6/255) + 暗夜/烈阳; 全明星 with the default → All-Star; 经典 with a custom lineup → classic + lineup.clash; throwing localStorage → default lineup; 我方 B → controlled = lineup.b[0] at the first user CHECK; ★ tap makes the check handler', { timeoutS: 900, needs: ['characters', 'lineup', 'ui.screen'] }, async (t) => {
  requireGame(); const M = await mods();
  const { page } = await t.boot('phoneLandscape', '?seed=7&intro=0');
  await H.openLineup(page);
  await lineupTap(page, 'kobe'); await lineupTap(page, 'lebron');
  await page.locator(`${LU} [data-i18n="lineup.reset"]`).first().click(); await sleep(300);
  eq((await ev(page, 'acc.cardIds()')).join(','), [...SPEC.defaultLineup.a, ...SPEC.defaultLineup.b].join(','), 'cards after 重置');
  await waitFor(page, `${JSON.stringify(IDS)}.every((id) => g.characters[id].kitMode === 'classic')`, 5000, 'classic kits after 重置');
  const problems = [];
  for (const id of IDS) {
    const L = M.legends.LEGENDS[id]; const want = hexRgb(L.kit[L.kit.classic].base);
    const got = await ev(page, KIT_MODE_EXPR(id));
    if (!got || got.some((v, i) => Math.abs(v - want[i]) > 6)) problems.push(`${id}: dominant kit atlas colour ${fmt(got)} vs classic base ${L.kit[L.kit.classic].base} (±6)`);
  }
  const names = await page.evaluate((s) => [...document.querySelectorAll(s + ' .luTeam .tname')].map((e) => e.textContent.trim()), LU);
  if (!(names[0] && names[0].includes('暗夜') && names[1] && names[1].includes('烈阳'))) problems.push(`team names after 重置: ${fmt(names)}`);
  await page.locator(`${LU} [data-kits="allstar"]`).first().click();
  await waitFor(page, `${JSON.stringify(SPEC.defaultLineup.a)}.every((id) => g.characters[id].kitMode === 'allstarA') && ${JSON.stringify(SPEC.defaultLineup.b)}.every((id) => g.characters[id].kitMode === 'allstarB')`, 5000, 'All-Star kits with 全明星 + default lineup');
  await lineupTap(page, 'kobe'); await lineupTap(page, 'lebron');
  await page.locator(`${LU} [data-kits="classic"]`).first().click();
  await waitFor(page, `${JSON.stringify(IDS)}.every((id) => g.characters[id].kitMode === 'classic')`, 5000, 'classic kits with 经典 + custom lineup');
  const hint = await page.evaluate((s) => (document.querySelector(s + ' .luHint') || {}).textContent || '', LU);
  if (!hint.includes(TXT.zh.clash)) problems.push(`lineup.clash warning missing: hint "${hint}"`);
  await page.locator(`${LU} [data-i18n="lineup.reset"]`).first().click(); await sleep(200);
  // ★ of Kyrie (team A slot 1) → he becomes the handler; 我方 stays A
  await page.locator(`${LU} .card[data-id="kyrie"] .cStar`).first().click(); await sleep(200);
  const afterStar = await ev(page, 'acc.cardIds()');
  if (afterStar[0] !== 'kyrie') problems.push(`★ on Kyrie should make him the handler (slot 0): ${fmt(afterStar)}`);
  await page.locator(`${LU} .luStart`).first().click();
  await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 30000, 'CHECK'); await installHelpers(page);
  const firstA = await run(page, "for (let i = 0; i < 400; i++) { if ((g.state === 'CHECK' || g.state === 'LIVE') && acc.userOff()) return acc.ctrlId(); if (g.state === 'CHECK' && !acc.userOff()) { g.turnover(); } acc.sim(0.05); } return null;");
  if (firstA !== 'kyrie') problems.push(`controlled player at the first user CHECK should be the ★ Kyrie, got ${firstA}`);
  await t.closeAll();
  // 我方 B
  const b = await t.boot('phoneLandscape', '?seed=7&intro=0');
  await H.openLineup(b.page);
  await b.page.locator(`${LU} [data-user="b"]`).first().click(); await sleep(200);
  await b.page.locator(`${LU} .luStart`).first().click();
  await waitFor(b.page, "g.state === 'CHECK' || g.state === 'LIVE'", 30000, 'CHECK'); await installHelpers(b.page);
  const lb0 = await ev(b.page, 'g.lineup.b[0]');
  const firstB = await run(b.page, "for (let i = 0; i < 400; i++) { if ((g.state === 'CHECK' || g.state === 'LIVE') && acc.userOff()) return acc.ctrlId(); if (g.state === 'CHECK' && !acc.userOff()) { g.turnover(); } acc.sim(0.05); } return null;");
  if (firstB !== lb0 || lb0 !== 'jordan') problems.push(`我方 B: controlled at the first user CHECK ${firstB}, lineup.b[0] ${lb0} (expected jordan)`);
  await t.closeAll();
  // throwing storage
  const s = await t.boot('phoneLandscape', '?seed=7&intro=0', { init: STORAGE_THROWS_INIT });
  await H.openLineup(s.page);
  const ids = await ev(s.page, 'acc.cardIds()');
  if (ids.join(',') !== [...SPEC.defaultLineup.a, ...SPEC.defaultLineup.b].join(',')) problems.push(`throwing localStorage: lineup ${fmt(ids)} is not the default`);
  problems.push(...diagProblems(s, 'throwing storage'));
  if (problems.length) fail(problems.join('\n    '));
});

// ------------------------------------------------------------------------------------------------ presentation (virtual clock)
/** Records lower-third names, jumbotron modes and the first CHECK time (virtual ms) on the current page. */
const INTRO_RECORDER = `
  acc.lt = []; acc.jumboModes = []; acc.tCheck = null; acc.screens = [];
  const el = document.querySelector('#ltName');
  if (el) new MutationObserver(() => { const s = (el.textContent || '').trim(); if (s && (!acc.lt.length || acc.lt[acc.lt.length - 1].text !== s)) acc.lt.push({ text: s, t: performance.now() }); }).observe(el, { childList: true, characterData: true, subtree: true });
  acc.frameHooks.push(() => {
    const m = g.arena && g.arena.jumbo && g.arena.jumbo.mode; if (m && acc.jumboModes[acc.jumboModes.length - 1] !== m) acc.jumboModes.push(m);
    const sc = g.ui && g.ui.screen; if (sc && acc.screens[acc.screens.length - 1] !== sc) acc.screens.push(sc);
    if (!acc.tCheck && (g.state === 'CHECK' || g.state === 'LIVE')) acc.tCheck = performance.now();
  });
  return true;`;
item('B32', 'Full intro: 6 lower-thirds (current-language names, team order), jumbotron intro, ≤ 16.5 s to CHECK; tap skips one legend; 跳过 skips all ≤ 0.3 s; rematch short intro ≤ 5.0 s', { clock: true, timeoutS: 1500, needs: ['arena.jumbo', 'ui.screen', 'lineup'] }, async (t) => {
  requireGame(); const M = await mods();
  const L = M.legends.LEGENDS; const order = [...SPEC.defaultLineup.a, ...SPEC.defaultLineup.b];
  // run 1: untouched full intro
  let gm = await t.boot('desktop', '?seed=7&intro=full&replay=0');
  await H.openLineup(gm.page); await needHooks(gm.page, ['arena.jumbo', 'ui.screen', 'lineup']);
  await run(gm.page, INTRO_RECORDER);
  await clockSet(gm.page, 'fixed', 1000 / 60);
  let t0 = await vnowOf(gm.page);
  await gm.page.locator(`${LU} .luStart`).first().click();
  await waitFor(gm.page, 'acc.tCheck', 900000, 'CHECK after the full intro');
  const r1 = await ev(gm.page, '({lt: acc.lt, jumbo: acc.jumboModes, tCheck: acc.tCheck})');
  const dur = (r1.tCheck - t0) / 1000;
  const problems = [];
  if (r1.lt.length !== 6) problems.push(`full intro showed ${r1.lt.length} lower-thirds (expected 6): ${fmt(r1.lt.map((x) => x.text))}`);
  r1.lt.slice(0, 6).forEach((x, i) => { const id = order[i]; if (!(x.text.includes(L[id].short.zh) || x.text.includes(L[id].name.zh))) problems.push(`lower-third ${i + 1} "${x.text}" is not ${L[id].name.zh} (team order ${order.join(', ')})`); });
  if (!r1.jumbo.includes('intro')) problems.push(`jumbotron never in mode 'intro' (${fmt(r1.jumbo)})`);
  if (!(dur <= SPEC.intro.full)) problems.push(`full intro took ${dur.toFixed(2)} s to CHECK (> ${SPEC.intro.full} s)`);
  await t.closeAll();
  // run 2: tap skips the current legend, 跳过 skips all, then a rematch uses the short intro
  gm = await t.boot('desktop', '?seed=7&intro=full&replay=0');
  await H.openLineup(gm.page); await run(gm.page, INTRO_RECORDER);
  await clockSet(gm.page, 'fixed', 1000 / 60);
  await gm.page.locator(`${LU} .luStart`).first().click();
  await waitFor(gm.page, 'acc.lt.length >= 2', 600000, 'second lower-third');
  const tTap = await vnowOf(gm.page);
  const tapBox = await gm.page.locator('#presentTap').boundingBox();
  if (tapBox) await gm.page.mouse.click(tapBox.x + tapBox.width / 2, tapBox.y + tapBox.height / 2); else await gm.page.mouse.click(640, 300);
  await waitFor(gm.page, 'acc.lt.length >= 3', 120000, 'third lower-third after the tap');
  const t3 = await ev(gm.page, 'acc.lt[2].t');
  if (!((t3 - tTap) / 1000 <= 0.5)) problems.push(`tap skipped the legend after ${((t3 - tTap) / 1000).toFixed(2)} s (expected well under its 1.6 s)`);
  const tSkip = await vnowOf(gm.page);
  await gm.page.locator('#skipBtn').click();
  await waitFor(gm.page, 'acc.tCheck', 120000, 'CHECK after 跳过');
  const skipS = (await ev(gm.page, 'acc.tCheck') - tSkip) / 1000;
  if (!(skipS <= SPEC.intro.skipAll)) problems.push(`跳过 reached CHECK after ${skipS.toFixed(2)} s (> ${SPEC.intro.skipAll} s)`);
  await installHelpers(gm.page);
  assert(await ev(gm.page, 'acc.forceGameOver()') === 'GAME_OVER', 'could not end the game for the rematch');
  await waitFor(gm.page, 'acc.visible("#menuOver")', 600000, '#menuOver');
  await run(gm.page, 'acc.tCheck = null; acc.screens = []; return true;');
  const tRe = await vnowOf(gm.page);
  await gm.page.locator('#btnRematch').click();
  await waitFor(gm.page, 'acc.tCheck', 600000, 'CHECK after the rematch');
  const re = await ev(gm.page, '({t: acc.tCheck, screens: acc.screens})');
  const reS = (re.t - tRe) / 1000;
  if (!re.screens.includes('intro')) problems.push(`rematch showed no intro screen (${fmt(re.screens)}); a short intro is expected`);
  if (!(reS <= SPEC.intro.short)) problems.push(`rematch intro took ${reS.toFixed(2)} s to CHECK (> ${SPEC.intro.short} s)`);
  t.note(`full intro ${dur.toFixed(2)} s; skip-all ${skipS.toFixed(2)} s; rematch ${reS.toFixed(2)} s`);
  if (problems.length) fail(problems.join('\n    '));
});

/** Replay recorder hooks (virtual ms): score time, replay start/end, director modes, LOD snapshot at mid-playback. */
const REPLAY_RECORDER = `
  acc.rep = { score: null, start: null, end: null, modes: [], lod: null, seenActive: false };
  if (!acc._repHook) {
    acc._repHook = true;
    acc.onEvent('score', () => { if (acc.rep && acc.rep.score == null) acc.rep.score = performance.now(); });
    acc.frameHooks.push(() => {
      const R = acc.rep; if (!R) return; const act = !!(g.replay && g.replay.active); const now = performance.now();
      if (act) {
        R.seenActive = true; if (R.start == null) R.start = now;
        const m = g.director && g.director.mode; if (m && R.modes[R.modes.length - 1] !== m) R.modes.push(m);
        if (!R.lod && now - R.start > 1500) {
          const cp = acc.cam().position; const tier = g.quality && g.quality.tier;
          R.lod = { tier, list: Object.keys(g.characters).map((id) => { const o = g.characters[id].object.position; return { id, d: Math.hypot(o.x - cp.x, o.y - cp.y, o.z - cp.z), lod: g.characters[id].lod }; }).sort((a, b) => a.d - b.d) };
        }
      } else if (R.start != null && R.end == null) R.end = now;
    });
  }
  return true;`;
function lodRuleProblems(L) {
  if (!L) return ['no LOD snapshot during the replay'];
  const out = [];
  L.list.forEach((c, i) => {
    let want;
    if (L.tier === 'high') want = c.d <= 7 ? 0 : 1;
    else if (L.tier === 'medium') want = i < 2 ? 0 : 1;
    else want = i < 2 ? 1 : 3;
    if (c.lod !== want) out.push(`${L.tier}: ${c.id} at ${c.d.toFixed(1)} m (rank ${i + 1}) has LOD ${c.lod}, expected ${want}`);
  });
  return out;
}
item('B33', 'Dunk → replay.active ≤ 1.2 s after the score, director mode replay, 3.0 ± 0.2 s, focus LOD per tier, tap ends it ≤ 0.2 s, back to CHECK; plain jumper → none; setting 关 → none; renderer.info.memory unchanged after 3 replays', { clock: true, timeoutS: 1800, needs: [...BASE_HOOKS, 'replay', 'director.mode', 'characters', 'quality.tier'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop');
  await run(page, REPLAY_RECORDER);
  await clockSet(page, 'fixed', 1000 / 60);
  await ev(page, 'acc.nextFrame(3)');
  const mem0 = await ev(page, 'acc.memory()');
  const problems = []; const notes = [];
  const clocks = [110, 60, 10];   // 45 s replay cooldown (game clock) between the three dunks
  for (let k = 0; k < 3; k++) {
    await run(page, `const r = acc.ready(); g.setClock({game: ${clocks[k]}, shot: 14}); acc.place(acc.ctrlId(), 0.6, -10.6); acc.sim(1 / 60); acc.rep = { score: null, start: null, end: null, modes: [], lod: null, seenActive: false }; return r;`);
    await ev(page, "g.debugShoot({kind: 'dunk', p: 1})");
    await waitFor(page, 'acc.rep.start != null', 240000, `replay ${k + 1} start`);
    if (k === 1) {
      await waitFor(page, 'performance.now() - acc.rep.start > 600', 60000, 'replay running');
      const tTap = await vnowOf(page); await page.mouse.click(640, 360);
      await waitFor(page, 'acc.rep.end != null', 60000, 'replay ended by the tap');
      const endS = (await ev(page, 'acc.rep.end') - tTap) / 1000;
      if (!(endS <= SPEC.replay.tapEnd)) problems.push(`replay 2: tap ended it after ${endS.toFixed(3)} s (> 0.2 s)`);
    } else await waitFor(page, 'acc.rep.end != null', 240000, `replay ${k + 1} end`);
    const R = await ev(page, 'acc.rep');
    const startS = (R.start - R.score) / 1000;
    if (R.score == null) problems.push(`replay ${k + 1}: no score event`);
    else if (!(startS <= SPEC.replay.startMax)) problems.push(`replay ${k + 1}: active ${startS.toFixed(2)} s after the score (> 1.2 s)`);
    if (!R.modes.includes('replay')) problems.push(`replay ${k + 1}: director modes ${fmt(R.modes)} lack 'replay'`);
    if (k !== 1) { const d = (R.end - R.start) / 1000; if (Math.abs(d - SPEC.replay.duration) > SPEC.replay.durationTol) problems.push(`replay ${k + 1}: duration ${d.toFixed(2)} s (3.0 ± 0.2)`); notes.push(`replay ${k + 1} ${d.toFixed(2)} s`); }
    if (k === 0) problems.push(...lodRuleProblems(R.lod).map((s) => 'replay 1 LOD: ' + s));
    await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 240000, `CHECK after replay ${k + 1}`);
  }
  await waitFrames(page, 10);
  const mem1 = await ev(page, 'acc.memory()');
  if (mem1.geometries !== mem0.geometries || mem1.textures !== mem0.textures) problems.push(`renderer.info.memory changed over 3 replays: ${fmt(mem0)} → ${fmt(mem1)}`);
  // a plain made jumper triggers no replay
  await run(page, "acc.ready(); g.setClock({game: 100, shot: 14}); acc.place(acc.ctrlId(), 0, -8.3); acc.sim(1 / 60); acc.rep = { score: null, start: null, end: null, modes: [], lod: null, seenActive: false }; g.debugShoot({p: 1, eT: 0}); return true;");
  await waitFor(page, 'acc.rep.score != null', 240000, 'jumper score');
  await waitFor(page, "performance.now() - acc.rep.score > 5000 && (g.state === 'CHECK' || g.state === 'LIVE')", 600000, '5 s after the jumper');
  if (await ev(page, 'acc.rep.seenActive')) problems.push('a plain made jumper triggered a replay');
  // setting 关 → no replay for a dunk
  await page.keyboard.press('p'); await waitFor(page, 'acc.paused()', 30000, 'paused');
  await clickSetting(page, '#pauseRows', 'replays', 0);
  await page.keyboard.press('p'); await waitFor(page, '!acc.paused()', 60000, 'resumed');
  await run(page, "acc.ready(); g.setClock({game: 40, shot: 14}); acc.place(acc.ctrlId(), 0.6, -10.6); acc.sim(1 / 60); acc.rep = { score: null, start: null, end: null, modes: [], lod: null, seenActive: false }; g.debugShoot({kind: 'dunk', p: 1}); return true;");
  await waitFor(page, 'acc.rep.score != null', 240000, 'dunk score with replays off');
  await waitFor(page, "performance.now() - acc.rep.score > 5000 && (g.state === 'CHECK' || g.state === 'LIVE')", 600000, '5 s after the dunk');
  if (await ev(page, 'acc.rep.seenActive')) problems.push('replay played although the 回放 setting is 关');
  t.note(notes.join(', '));
  if (problems.length) fail(problems.join('\n    '));
});

item('B34', '?quality= → tier, shadows, reflection (high only), crowd 700/1,600/2,600; settings change at the next CHECK; SwiftShader auto → rung 2; menu slow frames and 33 ms cadence never demote; 3 s of 26 ms frames in LIVE demote exactly one rung', { clock: true, timeoutS: 1800, needs: [...BASE_HOOKS, 'quality.tier', 'quality.rung', 'quality.history', 'quality.target', 'renderer', 'scene'] }, async (t) => {
  requireGame();
  const problems = [];
  const reflectionOf = `(() => { const r = (g.render && g.render.reflection) || g.reflection || (g.arena && g.arena.reflection) || null; if (!r) return false; if (typeof r.enabled === 'boolean') return r.enabled; if (typeof r.active === 'boolean') return r.active; return !!(r.target || r.renderTarget); })()`;
  const crowdOf = `(() => { let best = null; (g.scene || g.game.scene).traverse((o) => { if (o.isInstancedMesh && (!best || o.count > best.count)) best = o; }); return best ? best.count : null; })()`;
  for (const tier of ['low', 'medium', 'high']) {
    const { page } = await t.quick('desktop', `${QUICK}&quality=${tier}`);
    const r = await ev(page, `({tier: g.quality.tier, shadows: g.renderer.shadowMap.enabled, reflection: ${reflectionOf}, crowd: ${crowdOf}})`);
    if (r.tier !== tier) problems.push(`?quality=${tier}: tier ${r.tier}`);
    if (r.shadows !== (tier !== 'low')) problems.push(`?quality=${tier}: shadow maps ${r.shadows ? 'on' : 'off'}`);
    if (r.reflection !== (tier === 'high')) problems.push(`?quality=${tier}: planar reflection ${r.reflection ? 'on' : 'off'}`);
    if (r.crowd !== SPEC.crowd[tier]) problems.push(`?quality=${tier}: crowd instances ${r.crowd} (expected ${SPEC.crowd[tier]})`);
    await t.closeAll();
  }
  // auto ladder with the virtual clock
  const { page } = await t.boot('desktop', QUICK);
  await H.waitTitle(page);
  const auto0 = await ev(page, '({rung: g.quality.rung, auto: g.quality.auto, tier: g.quality.tier})');
  if (auto0.rung !== 2) problems.push(`SwiftShader auto start rung ${auto0.rung} (expected 2)`);
  await clockSet(page, 'fixed', 1000 / 60);
  await page.locator('#btnQuick').click(); await page.evaluate(() => Promise.resolve(window.__game.legendsReady));
  await waitFor(page, "g.state === 'LIVE'", 600000, 'LIVE'); await installHelpers(page);
  const demotes = () => ev(page, "g.quality.history.filter((h) => h.reason === 'demote').length");
  const d0 = await demotes();
  // (a) slow frames behind an open menu
  await page.keyboard.press('p'); await waitFor(page, 'acc.paused() && acc.visible("#menuPause")', 60000, 'pause menu');
  await clockSet(page, 'fixed', 40); await waitFrames(page, 150);
  if (await demotes() !== d0) problems.push('slow frames with the pause menu open demoted the quality');
  await clockSet(page, 'fixed', 1000 / 60);
  await page.keyboard.press('p'); await waitFor(page, '!acc.paused()', 60000, 'resumed');
  // (b) 26 ms frames in LIVE at target 16.7 → exactly one demotion
  await run(page, 'acc.ready(); g.setClock({game: 110, shot: 14}); return true;');
  const tgt = await ev(page, 'g.quality.target'); if (Math.abs(tgt - 16.67) > 0.1) problems.push(`target before the 26 ms test is ${tgt} (expected 16.67)`);
  const rungB = await ev(page, 'g.quality.rung');
  await clockSet(page, 'fixed', 26);
  const f0 = await ev(page, 'window.__accClock.frames');
  await waitFor(page, `g.quality.history.filter((h) => h.reason === 'demote').length > ${d0} || window.__accClock.frames > ${f0 + 450}`, 900000, 'demotion under 26 ms frames');
  await clockSet(page, 'fixed', 1000 / 60);
  const hist = await ev(page, 'g.quality.history.slice()');
  const newD = hist.filter((h) => h.reason === 'demote').slice(d0);
  if (newD.length !== 1) problems.push(`26 ms frames: ${newD.length} demotions (expected exactly 1): ${fmt(hist)}`);
  else if (newD[0].to !== newD[0].from - 1 || newD[0].from !== rungB) problems.push(`26 ms demotion ${fmt(newD[0])} is not one rung from ${rungB}`);
  await waitFrames(page, 240);
  if ((await demotes()) - d0 !== 1) problems.push('a further demotion followed after returning to 16.7 ms frames');
  // (c) 33.3 ms vsync-locked cadence (e.g. Low Power Mode switched on behind the pause menu) → re-target, no demotion
  const d1 = await demotes();
  await page.keyboard.press('p'); await waitFor(page, 'acc.paused()', 60000, 'paused');
  await clockSet(page, 'fixed', 1000 / 30);
  await page.keyboard.press('p'); await waitFor(page, '!acc.paused()', 60000, 'resumed');
  await waitFrames(page, 300);
  if (await demotes() !== d1) problems.push('a 33.3 ms cadence demoted the quality (must re-target instead)');
  const cad = await ev(page, "({target: g.quality.target, cadence: g.quality.history.some((h) => h.reason === 'cadence')})");
  if (!cad.cadence) t.warn(`no 'cadence' history entry after 3.5 s of 33.3 ms frames (target ${cad.target})`);
  await clockSet(page, 'fixed', 1000 / 60); await waitFrames(page, 240);
  // (d) settings change applies at the next CHECK
  const tierNow = await ev(page, 'g.quality.tier'); const other = tierNow === 'medium' ? 'high' : 'medium'; const idx = { low: 1, medium: 2, high: 3 }[other];
  await page.keyboard.press('p'); await waitFor(page, 'acc.paused()', 60000, 'paused');
  await clickSetting(page, '#pauseRows', 'quality', idx);
  const eSet = await ev(page, 'acc.evts.length');
  await page.keyboard.press('p'); await waitFor(page, "!acc.paused() && g.state === 'LIVE'", 120000, 'LIVE again');
  await waitFrames(page, 5);
  const midTier = await ev(page, 'g.quality.tier');
  // the possession may legitimately end (and a CHECK start) while the rAF loop runs after the resume: only a tier
  // change without any CHECK since the setting was changed is "mid-LIVE"
  const checksSince = await ev(page, `acc.since(${eSet}, 'state').filter((x) => x.to === 'CHECK').length`);
  if (midTier !== tierNow && !checksSince) problems.push(`quality setting applied mid-LIVE (${tierNow} → ${midTier}); expected at the next CHECK`);
  if (midTier !== tierNow && checksSince) t.warn(`a CHECK happened after the setting change (${checksSince}×); tier ${tierNow} → ${midTier} applied there`);
  await ev(page, 'g.turnover()');
  await waitFor(page, `g.quality.tier === '${other}' && (g.state === 'CHECK' || g.state === 'LIVE')`, 600000, `tier ${other} at the next CHECK`);
  await clockSet(page, 'real');
  t.note(`auto start ${fmt(auto0)}; history ${fmt(await ev(page, 'g.quality.history.map((h) => h.reason + ":" + h.from + "→" + h.to)'))}`);
  if (problems.length) fail(problems.join('\n    '));
});

item('B35', 'Bytes: index.html + css/ + src/ + vendor/ + assets/legends/ ≤ 5.4 MB, assets/legends/ ≤ 3.5 MB; ≤ 110 requests during load; loading screen visible ≤ 1.0 s after navigation', {
  timeoutS: 600,
  staticPart: async (t) => {
    const MB = 1048576;
    const parts = { 'index.html': dirBytes(path.join(ROOT, 'index.html')), 'css/': dirBytes(path.join(ROOT, 'css')), 'src/': dirBytes(path.join(ROOT, 'src')), 'vendor/': dirBytes(path.join(ROOT, 'vendor')), 'assets/legends/': dirBytes(path.join(ROOT, 'assets', 'legends')) };
    const total = Object.values(parts).reduce((s, v) => s + v, 0);
    t.note(Object.entries(parts).map(([k, v]) => `${k} ${(v / MB).toFixed(3)} MB`).join(', ') + `; total ${(total / MB).toFixed(3)} MB`);
    const problems = [];
    if (!(total <= SPEC.payloadMB * MB)) problems.push(`payload ${(total / MB).toFixed(3)} MB > ${SPEC.payloadMB} MB`);
    if (!(parts['assets/legends/'] <= SPEC.assetsMB * MB)) problems.push(`assets/legends/ ${(parts['assets/legends/'] / MB).toFixed(3)} MB > ${SPEC.assetsMB} MB`);
    if (!parts['assets/legends/']) problems.push('assets/legends/ missing');
    if (problems.length) fail(problems.join('\n    '));
  },
}, async (t, self) => {
  await self.staticPart(t);
  requireGame();
  const gm = await t.open('phonePortrait', 'index.html?seed=7', { navigate: false }); const { page } = gm;
  const t0 = Date.now();
  await page.goto(gm.target, { waitUntil: 'commit' });
  let seenAt = null;
  while (Date.now() - t0 < 3000 && seenAt == null) {
    const ok = await page.evaluate(() => { const el = document.querySelector('#loading'); if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0 && r.width > 0 && r.height > 0; }).catch(() => false);
    if (ok) {
      // the screenshot proves the loading screen (gold logo) is on screen; the time it appeared is the page's own
      // first-contentful-paint (the static #loading is the first content): a SwiftShader screenshot of the busy
      // loading page takes 1.4–2.7 s by itself, which the wall clock after the capture wrongly counted
      const img = await shot(page, 'B35-loading'); const gold = findColor(img, hexRgb('#d9a520'), 60, 2);
      if (gold.found) {
        const fcp = await page.evaluate(() => { const e = performance.getEntriesByName('first-contentful-paint')[0]; return e ? e.startTime : null; }).catch(() => null);
        seenAt = fcp != null ? Math.round(fcp) : Date.now() - t0;
        if (fcp == null) t.warn('no first-contentful-paint entry; wall clock after the screenshot used');
      }
    }
    if (seenAt == null) await sleep(30);
  }
  assert(seenAt != null && seenAt <= 1000, `loading screen not visible in a screenshot within 1.0 s of navigation (${seenAt == null ? 'never' : seenAt + ' ms'})`);
  await installHelpers(page); await H.waitTitle(page);
  const reqs = gm.diag.requests.filter((r) => !/^(data|blob|about):/.test(r.url));
  assert(reqs.length <= SPEC.maxRequests, `${reqs.length} requests during load (> ${SPEC.maxRequests})`);
  t.note(`loading visible at ${seenAt} ms; ${reqs.length} requests until the title`);
});

// ------------------------------------------------------------------------------------------------ layout v2 (8 viewports × zh/en)
const TAPPABLE_CHECK = (scope, min) => `(() => {
  const out = []; const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  for (const el of document.querySelectorAll(${JSON.stringify(scope)})) {
    if (!vis(el)) continue; let p = el.parentElement, hidden = false; while (p) { const cs = getComputedStyle(p); if (cs.display === 'none' || cs.visibility === 'hidden') { hidden = true; break; } p = p.parentElement; } if (hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width < ${min} - 0.5 || r.height < ${min} - 0.5) out.push((el.id ? '#' + el.id : el.className || el.tagName) + ' ' + r.width.toFixed(0) + '×' + r.height.toFixed(0));
  }
  return out; })()`;
const LBL_SINGLE_LINE = `(() => [...document.querySelectorAll('#menus .lbl')].filter((el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = el.getBoundingClientRect(); if (!r.width) return false; const range = document.createRange(); range.selectNodeContents(el); const tops = new Set([...range.getClientRects()].map((q) => Math.round(q.top))); return tops.size > 1; }).map((el) => el.textContent.trim()))()`;
item('B36', '8 viewports × zh/en: visible button/.opt/card ≥ 44 px; zh .lbl single line; game-over buttons inside #menuOver; lineup fully visible or touch-scrollable at 740×304 and 851×337; joystick down at (4, 300) / (150, H − 4) → mag 0 (R#9); #stickRing never covers #cluster (R#10)', { timeoutS: 1800, needs: [...BASE_HOOKS, 'ui.screen'] }, async (t) => {
  requireGame();
  const problems = [];
  const touchSizes = H.VIEWPORT_DEVICES.filter((d) => d !== 'desktop').map((d) => [d, H.DEVICES[d].viewport.width, H.DEVICES[d].viewport.height]);
  const runStages = async (page, sizes, touch) => {
    for (const lang of ['zh', 'en']) {
      await setLang(page, lang);
      // title + settings sheet
      for (const [d, w, h] of sizes) {
        await page.setViewportSize({ width: w, height: h }); await sleep(350);
        const small = await ev(page, TAPPABLE_CHECK('#screenTitle button, #screenTitle .opt', 44)); if (small.length) problems.push(`[${lang} ${d}] title: ${small.join(', ')}`);
      }
      await page.locator('#btnSettings').click(); await sleep(300);
      for (const [d, w, h] of sizes) {
        await page.setViewportSize({ width: w, height: h }); await sleep(350);
        const small = await ev(page, TAPPABLE_CHECK('#menuSettings button, #menuSettings .opt', 44)); if (small.length) problems.push(`[${lang} ${d}] settings: ${small.join(', ')}`);
        if (lang === 'zh') { const multi = await ev(page, LBL_SINGLE_LINE); if (multi.length) problems.push(`[zh ${d}] settings .lbl wraps: ${multi.join(', ')}`); }
      }
      await page.locator('#btnSettingsBack').click(); await sleep(200);
    }
    await setLang(page, 'zh');
  };
  // touch devices (one page resized through the 7 touch viewports), then desktop
  for (const [device, sizes, touch] of [['phoneLandscape', touchSizes, true], ['desktop', [['desktop', 1280, 720]], false]]) {
    const { page } = await t.boot(device, '?seed=7&intro=0');
    await H.waitTitle(page); await H.dismissRotateHint(page);
    await runStages(page, sizes, touch);
    // lineup
    await page.locator('#btnStart').click(); await waitFor(page, "g.ui.screen === 'lineup'", 30000, 'lineup');
    for (const lang of ['zh', 'en']) {
      await setLang(page, lang);
      for (const [d, w, h] of sizes.concat(touch ? [['851×337', 851, 337]] : [])) {
        await page.setViewportSize({ width: w, height: h }); await sleep(350);
        const small = await ev(page, TAPPABLE_CHECK(`${LU} button, ${LU} .card, ${LU} .opt`, 44)); if (small.length) problems.push(`[${lang} ${d}] lineup: ${small.join(', ')}`);
        if ((w === 740 && h === 304) || (w === 851 && h === 337)) {
          const fit = await ev(page, `(() => { const cards = [...document.querySelectorAll('${LU} .card')]; const off = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.top < -0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5; }); if (!off.length) return 'visible'; let p = off[0].parentElement; while (p && p !== document.body) { const cs = getComputedStyle(p); if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.scrollHeight > p.clientHeight && cs.touchAction !== 'none') return 'scrollable'; p = p.parentElement; } return 'clipped: ' + off.map((c) => c.getAttribute('data-id')).join(','); })()`);
          if (!(fit === 'visible' || fit === 'scrollable')) problems.push(`[${lang} ${d}] lineup panel ${fit}`);
        }
      }
    }
    await setLang(page, 'zh');
    // game
    await page.setViewportSize({ width: sizes[0][1], height: sizes[0][2] });
    await page.locator(`${LU} .luStart`).first().click();
    await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 60000, 'CHECK'); await installHelpers(page);
    for (const [d, w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h }); await sleep(400);
      await run(page, 'g.setClock({shot: 14}); return true;');
      const small = await ev(page, TAPPABLE_CHECK('#controls button, #btnPause', 44)); if (small.length) problems.push(`[${d}] game: ${small.join(', ')}`);
      if (touch) {
        for (const pt of [{ x: 4, y: 300 }, { x: 150, y: h - 4 }]) {
          let mag = null;
          await H.multiTouch(page, [{ type: 'touchStart', points: [{ id: 1, ...pt }], waitMs: 120 }, async () => { mag = await ev(page, 'g.input.intent.move.mag'); }, { type: 'touchEnd', points: [] }]);
          if (mag !== 0) problems.push(`[${d}] joystick press at (${pt.x}, ${pt.y}) without move gives mag ${mag} (R#9)`);
        }
        const sp = await stickPoint(page); let cover = [];
        await H.multiTouch(page, [{ type: 'touchStart', points: [{ id: 1, ...sp }], waitMs: 30 }, ...H.moveSteps(1, sp, { x: w - 20, y: sp.y }, 12), async () => {
          cover = await page.evaluate(() => { const ring = document.querySelector('#stickRing').getBoundingClientRect(); return [...document.querySelectorAll('#cluster button')].filter((b) => { const r = b.getBoundingClientRect(); return ring.width > 0 && ring.left < r.right && r.left < ring.right && ring.top < r.bottom && r.top < ring.bottom; }).map((b) => b.id); });
        }, { type: 'touchEnd', points: [] }]);
        if (cover.length) problems.push(`[${d}] #stickRing covers ${cover.join(', ')} during a long drag (R#10)`);
      }
    }
    // game over
    assert(await ev(page, 'acc.forceGameOver()') === 'GAME_OVER', 'could not reach GAME_OVER');
    await waitFor(page, 'acc.visible("#menuOver")', 60000, '#menuOver');
    for (const lang of ['zh', 'en']) {
      await setLang(page, lang);
      for (const [d, w, h] of sizes) {
        await page.setViewportSize({ width: w, height: h }); await sleep(350);
        const r = await page.evaluate(() => { const m = document.querySelector('#menuOver').getBoundingClientRect(); return [...document.querySelectorAll('#menuOver .actions button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < m.left - 0.5 || r.right > m.right + 0.5 || r.top < m.top - 0.5 || r.bottom > m.bottom + 0.5 || r.bottom > innerHeight + 0.5; }).map((b) => b.id); });
        if (r.length) problems.push(`[${lang} ${d}] game-over buttons outside #menuOver or the viewport: ${r.join(', ')}`);
        const small = await ev(page, TAPPABLE_CHECK('#menuOver button', 44)); if (small.length) problems.push(`[${lang} ${d}] game over: ${small.join(', ')}`);
      }
    }
    await t.closeAll();
  }
  if (problems.length) fail(problems.slice(0, 30).join('\n    ') + (problems.length > 30 ? `\n    …and ${problems.length - 30} more` : ''));
});

item('B37', 'Landscape + portrait, CHECK / wing / corner / paint / handler at z −1: rim and ball |NDC| ≤ 0.9; controlled feet NDC y ≥ −0.95; half line visible with the handler at z ≥ −2 (landscape); off-screen indicator when a teammate projects outside', { clock: true, timeoutS: 1200, needs: [...BASE_HOOKS, 'director.camera'] }, async (t) => {
  requireGame();
  const problems = [];
  const spots = { wing: [6.4, -9.6], corner: [6.6, -12.4], paint: [0.8, -11.0], top: [0.5, -1.0] };
  for (const device of ['phoneLandscape', 'phonePortrait']) {
    const { page } = await t.quick(device);
    const land = device === 'phoneLandscape';
    await clockSet(page, 'fixed', 1000 / 60);
    // CHECK
    await run(page, 'acc.ready(); g.turnover(); return true;');
    await waitFor(page, "g.state === 'CHECK'", 300000, 'CHECK');
    await waitFrames(page, 2);
    const measure = `(() => { const b = acc.ballPos(); const c = acc.posOf(acc.ctrlId()); return { rim: acc.ndc(0, 3.048, -12.75), ball: acc.ndc(b.x, b.y, b.z), feet: acc.ndc(c.x, 0, c.z), half: acc.ndc(Math.max(-7.6, Math.min(7.6, c.x)), 0, 0), cz: c.z, st: g.state }; })()`;
    const judge = (tag, m) => {
      for (const k of ['rim', 'ball']) if (!(Math.abs(m[k].x) <= 0.9 && Math.abs(m[k].y) <= 0.9)) problems.push(`[${device} ${tag}] ${k} NDC ${fmt({ x: r3(m[k].x), y: r3(m[k].y) })} outside ±0.9`);
      if (!(m.feet.y >= -0.95)) problems.push(`[${device} ${tag}] controlled feet NDC y ${r3(m.feet.y)} < −0.95`);
      if (land && m.cz >= -2 && !(m.half.y >= -1.0)) problems.push(`[${device} ${tag}] half line NDC y ${r3(m.half.y)} < −1.0 with the handler at z ${r2(m.cz)}`);
    };
    judge('CHECK', await ev(page, measure));
    await waitFor(page, "g.state === 'LIVE'", 300000, 'LIVE');
    for (const [name, [x, z]] of Object.entries(spots)) {
      await run(page, `acc.ready(); g.setClock({shot: 14}); acc.place(acc.ctrlId(), ${x}, ${z}); acc.frozen = true; return true;`);
      await waitFrames(page, 90);   // broadcast camera settles (damping rate 5)
      judge(name, await ev(page, measure));
      if (name === 'corner') {
        // teammate placed where neither feet nor head project inside ±0.98 → an indicator must show
        const placed = await run(page, `
          const me = acc.ctrlId(); const tm = acc.teamOf(me); const mate = acc.players().filter((p) => acc.teamOf(p) === tm && acc.pid(p) !== me).map(acc.pid)[0];
          const h = g.characters && g.characters[mate] ? g.characters[mate].dims.heightBarefoot : 2.0;
          const out = (p) => Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.98 || p.z > 1;
          for (const [x, z] of [[-7.3, -0.4], [-7.3, -3.0], [-7.3, -13.8], [7.3, -0.4], [-4, -0.3]]) { if (out(acc.ndc(x, 0, z)) && out(acc.ndc(x, h, z))) { acc.place(mate, x, z); return { mate, x, z }; } }
          return null;`);
        if (!placed) t.warn(`[${device}] no court spot projects fully outside the view at the corner framing; indicator check skipped`);
        else {
          await waitFrames(page, 4);
          const vis = await ev(page, "['#offA', '#offB', '#offC'].filter((s) => acc.visible(s)).length");
          if (!vis) problems.push(`[${device}] teammate ${placed.mate} at (${placed.x}, ${placed.z}) projects off-screen but no off-screen indicator is visible`);
        }
      }
      await ev(page, 'acc.frozen = false');
    }
    await clockSet(page, 'real');
    await t.closeAll();
  }
  if (problems.length) fail(problems.join('\n    '));
});

item('B38', 'Captions use short names; a score caption replaces a stale rebound caption ≤ 0.7 s (R#42); queue empty after rematch and quit (R#19); banner re-renders on a language toggle (R#20) and survives pause (R#22)', { clock: true, timeoutS: 900, needs: [...BASE_HOOKS, 'game.emit'] }, async (t) => {
  requireGame(); const M = await mods();
  const { page } = await t.quick('desktop');
  await clockSet(page, 'fixed', 1000 / 60);
  const problems = [];
  const id = await ev(page, 'acc.ctrlId()'); const L = M.legends.LEGENDS[id];
  const emit = (type, payload) => run(page, `const p = Object.assign({ t: g.world.time || 0, playerId: ${JSON.stringify(id)}, team: acc.teamOf(${JSON.stringify(id)}), x: 0, z: -6 }, ${JSON.stringify(payload)}); g.game.emit(${JSON.stringify(type)}, p); return true;`);
  const capText = () => page.evaluate(() => (document.querySelector('#caption').textContent || '').trim());
  // short names
  await emit('caption', { key: 'cap.dunk', params: { name: L.short }, priority: 3 });
  await waitFrames(page, 3);
  const c1 = await capText();
  if (!c1.includes(L.short.zh) || c1.includes(L.name.zh)) problems.push(`caption "${c1}" should use the short name ${L.short.zh}, not ${L.name.zh}`);
  await waitFrames(page, 150);
  // stale rebound caption replaced by a score caption ≤ 0.7 s
  await emit('caption', { key: 'cap.rebound', params: { name: L.short }, priority: 1 });
  await waitFrames(page, 6);
  const tScore = await vnowOf(page);
  await emit('caption', { key: 'cap.hot', params: { name: L.short }, priority: 3 });
  const want = M.i18n.STRINGS.zh['cap.hot'].replace('{name}', L.short.zh);
  await waitFor(page, `document.querySelector('#caption').textContent.includes(${JSON.stringify(want)})`, 120000, 'score caption shown');
  const dt = (await vnowOf(page) - tScore) / 1000;
  if (!(dt <= 0.7 + 1 / 60)) problems.push(`score caption replaced the rebound caption after ${dt.toFixed(2)} s (> 0.7 s)`);
  // banner: language toggle + pause
  await emit('banner', { key: 'banner.overtime', params: null, ms: 6000 });
  await waitFrames(page, 3);
  const bz = await page.evaluate(() => document.querySelector('#banner').textContent.trim());
  await page.keyboard.press('t'); await waitFrames(page, 3);
  const be = await page.evaluate(() => document.querySelector('#banner').textContent.trim());
  if (!(bz.includes(TXT.zh.overtime) && be.includes(TXT.en.overtime))) problems.push(`banner did not re-render on the language toggle: "${bz}" → "${be}" (R#20)`);
  await page.keyboard.press('t'); await waitFrames(page, 2);
  await page.keyboard.press('p'); await waitFor(page, 'acc.paused()', 60000, 'paused');
  await page.keyboard.press('p'); await waitFor(page, '!acc.paused()', 120000, 'resumed');
  await waitFrames(page, 4);
  const bp = await page.evaluate(() => { const el = document.querySelector('#banner'); const cs = getComputedStyle(el); return { text: el.textContent.trim(), vis: cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0 }; });
  if (!(bp.vis && bp.text.includes(TXT.zh.overtime))) problems.push(`banner lost after pause + countdown: ${fmt(bp)} (R#22)`);
  // queue cleared on quit and on rematch
  const stale = ['cap.ankle', 'cap.firstDunk', 'cap.winner', 'cap.chaseDown'];
  const staleTexts = stale.map((k) => M.i18n.STRINGS.zh[k].replace('{name}', L.short.zh));
  const checkNoStale = async (label) => {
    await run(page, 'acc._capLog = []; const el = document.querySelector("#caption"); acc._capObs = new MutationObserver(() => acc._capLog.push(el.textContent.trim())); acc._capObs.observe(el, {childList: true, characterData: true, subtree: true}); return true;');
    await waitFrames(page, 240);
    const log = await ev(page, 'acc._capLog.concat([document.querySelector("#caption").textContent.trim()])');
    await ev(page, 'acc._capObs.disconnect()');
    const hit = log.filter((s) => staleTexts.some((x) => s.includes(x)));
    if (hit.length) problems.push(`${label}: stale captions from the previous game shown: ${fmt(hit)} (R#19)`);
  };
  for (const k of stale) await emit('caption', { key: k, params: { name: L.short }, priority: 2 });
  await page.keyboard.press('p'); await waitFor(page, 'acc.visible("#menuPause")', 60000, 'pause menu');
  await page.locator('#btnQuit').click(); await waitFor(page, "g.ui.screen === 'title'", 120000, 'title after quit');
  await page.locator('#btnQuick').click(); await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 300000, 'new game'); await installHelpers(page);
  await checkNoStale('after quit + new game');
  assert(await ev(page, 'acc.forceGameOver()') === 'GAME_OVER', 'could not reach GAME_OVER');
  for (const k of stale) await emit('caption', { key: k, params: { name: L.short }, priority: 2 });
  await page.locator('#btnRematch').click(); await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 300000, 'rematch'); await installHelpers(page);
  await checkNoStale('after rematch');
  await clockSet(page, 'real');
  if (problems.length) fail(problems.join('\n    '));
});

item('B39', '?showcase=1 view=lineup and view=heads set __showcase.ready; no console errors; screenshots to test/results/showcase/ (lineup yaw 0 / 0.5 / π/2, heads yaw 0 / 0.6, kits classic / All-Star); two runs differ by < 0.5 % of pixels', { timeoutS: 1800 }, async (t) => {
  requireGame();
  const SET = [['lineup_yaw0', 'view=lineup&yaw=0&kit=classic'], ['lineup_yaw0.5', 'view=lineup&yaw=0.5&kit=classic'], ['lineup_yaw1.5708', 'view=lineup&yaw=1.5708&kit=classic'],
    ['heads_yaw0', 'view=heads&yaw=0&kit=classic'], ['heads_yaw0.6', 'view=heads&yaw=0.6&kit=classic'], ['lineup_allstarA', 'view=lineup&yaw=0&kit=allstarA'], ['lineup_allstarB', 'view=lineup&yaw=0&kit=allstarB']];
  fs.mkdirSync(SHOWCASE_DIR, { recursive: true });
  const runs = [{}, {}]; const problems = [];
  for (let k = 0; k < 2; k++) {
    for (const [name, q] of SET) {
      const gm = await t.open('desktop', `index.html?showcase=1&${q}`);
      try { await waitFor(gm.page, 'window.__showcase && window.__showcase.ready === true', 180000, `__showcase.ready (${name})`); }
      catch (e) { problems.push(`${name}: ${e.message}`); await t.closeAll(); continue; }
      await gm.page.waitForTimeout(300);
      const buf = await gm.page.screenshot({ type: 'png', scale: 'css' });
      fs.writeFileSync(path.join(SHOWCASE_DIR, `${name}_run${k + 1}.png`), buf);
      runs[k][name] = decodePng(buf);
      problems.push(...diagProblems(gm, `${name} run ${k + 1}`));
      await t.closeAll();
    }
  }
  for (const [name] of SET) {
    const a = runs[0][name], b = runs[1][name]; if (!a || !b) continue;
    const d = diffFraction(a, b, 24, 1); if (!(d < 0.005)) problems.push(`${name}: runs differ by ${(d * 100).toFixed(2)} % of pixels (≥ 0.5 %)`);
  }
  t.note(`screenshots in ${rel(SHOWCASE_DIR)}/`);
  if (problems.length) fail(problems.join('\n    '));
});

item('B40', 'route-abort legends.kobe.bin → #loadError naming the file ≤ 25 s; 重试 after unblocking → loads; 简化模式 → 6 primitive players, playable, no console.error; no WebGL2 → simplified mode + toast.webgl1', { timeoutS: 900, needs: ['simplified'] }, async (t) => {
  requireGame();
  const problems = [];
  const failRe = /legends\.kobe\.bin|Failed to load resource|net::ERR_FAILED/;
  // retry path
  let gm = await t.open('desktop', 'index.html?seed=7', { navigate: false });
  let blocked = true;
  await gm.page.route('**/assets/legends/legends.kobe.bin', (route) => (blocked ? route.abort('failed') : route.continue()));
  let t0 = Date.now(); await gm.page.goto(gm.target, { waitUntil: 'commit' });
  await waitFor(gm.page, "(() => { const e = document.querySelector('#loadError'); return e && getComputedStyle(e).display !== 'none' && !e.classList.contains('hidden') && document.querySelector('#loadErrDetail').textContent.includes('legends.kobe.bin'); })()", 25000, '#loadError naming legends.kobe.bin');
  const errS = (Date.now() - t0) / 1000;
  blocked = false;
  await gm.page.locator('#btnRetry').click();
  await installHelpers(gm.page); await H.waitTitle(gm.page, 120000);
  if (await ev(gm.page, 'g.simplified')) problems.push('after 重试 the game is in simplified mode (expected the full legends)');
  const unexpected = gm.diag.errors.filter((e) => !failRe.test(e)); if (unexpected.length) problems.push(`console.error during the failed load / retry: ${unexpected.slice(0, 3).join(' | ')}`);
  await t.closeAll();
  // simplified path
  gm = await t.open('desktop', 'index.html?quick=1&intro=0&seed=7', { navigate: false });
  await gm.page.route('**/assets/legends/legends.kobe.bin', (route) => route.abort('failed'));
  await gm.page.goto(gm.target, { waitUntil: 'commit' });
  await waitFor(gm.page, "(() => { const e = document.querySelector('#loadError'); return e && getComputedStyle(e).display !== 'none' && !e.classList.contains('hidden'); })()", 25000, '#loadError');
  await gm.page.locator('#btnSimple').click();
  await installHelpers(gm.page); await H.startGame(gm.page); await installHelpers(gm.page);
  const s = await ev(gm.page, '({simplified: g.simplified, n: acc.players().length, chars: g.characters})');
  if (s.simplified !== true) problems.push('简化模式 did not set __game.simplified');
  if (s.n !== 6) problems.push(`simplified mode has ${s.n} players`);
  const play = await ev(gm.page, "(() => { const r = acc.ready(); const sh = acc.shootTrial({n: 1, p: 1, eT: 0, at: {x: 0, z: -8.3}, defenders: 'away'})[0]; return { r, made: sh.made, err: sh.error }; })()");
  if (!play.r.ok || !play.made) problems.push(`simplified mode not playable: ${fmt(play)}`);
  const errs = gm.diag.errors.filter((e) => !failRe.test(e)); if (errs.length) problems.push(`console.error in simplified mode: ${errs.slice(0, 3).join(' | ')}`);
  if (gm.diag.pageErrors.length) problems.push(`uncaught exceptions in simplified mode: ${gm.diag.pageErrors[0]}`);
  await t.closeAll();
  // no WebGL2
  gm = await t.open('desktop', 'index.html?seed=7', { init: NO_WEBGL2_INIT });
  await installHelpers(gm.page);
  await waitFor(gm.page, 'g.simplified === true', 60000, 'simplified mode without WebGL2');
  const toast = await waitFor(gm.page, `(() => { const s = (document.querySelector('#toast') || {}).textContent || ''; return s.includes(${JSON.stringify(TXT.zh.webgl1)}) ? s : ''; })()`, 30000, 'toast.webgl1');
  void toast;
  await H.waitTitle(gm.page, 60000);
  if (gm.diag.errors.length || gm.diag.pageErrors.length) problems.push(`errors without WebGL2: ${[...gm.diag.errors, ...gm.diag.pageErrors].slice(0, 3).join(' | ')}`);
  t.note(`#loadError after ${errS.toFixed(1)} s`);
  if (problems.length) fail(problems.join('\n    '));
});

item('B41', 'renderer.info.memory (geometries, textures) and texMB identical after 5 rematches + 5 lineup/kit changes + 3 replays', { clock: true, timeoutS: 2400, needs: [...BASE_HOOKS, 'renderer', 'replay', 'perf.texMB'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop');
  await waitFor(page, "g.state === 'LIVE'", 120000, 'LIVE'); await waitFrames(page, 5);
  const toCheck = async (label) => { await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 600000, label); await installHelpers(page); };
  // Warm-up: the quick game never showed the lineup screen, whose menu-LOD character geometry is uploaded the first
  // time it is drawn (+2 geometries, once; the scene's geometry set is unchanged). A leak grows per cycle, so the
  // baseline is taken after one lineup round trip.
  const memQ = await ev(page, 'acc.memory()');
  assert(await ev(page, 'acc.forceGameOver()') === 'GAME_OVER', 'warm-up: no GAME_OVER');
  await waitFor(page, 'acc.visible("#menuOver")', 600000, '#menuOver');
  await page.locator('#btnLineup').click(); await waitFor(page, "g.ui.screen === 'lineup'", 120000, 'lineup');
  await page.locator(`${LU} .luStart`).first().click(); await toCheck('warm-up lineup');
  await waitFor(page, "g.state === 'LIVE'", 120000, 'LIVE'); await waitFrames(page, 5);
  const mem0 = await ev(page, 'acc.memory()');
  if (mem0.geometries !== memQ.geometries || mem0.textures !== memQ.textures) t.warn(`first lineup visit: ${fmt(memQ)} → ${fmt(mem0)} (one-time uploads)`);
  for (let i = 0; i < 5; i++) {
    assert(await ev(page, 'acc.forceGameOver()') === 'GAME_OVER', `rematch ${i + 1}: no GAME_OVER`);
    await waitFor(page, 'acc.visible("#menuOver")', 600000, '#menuOver'); await page.locator('#btnRematch').click(); await toCheck(`rematch ${i + 1}`);
  }
  for (let i = 0; i < 5; i++) {
    assert(await ev(page, 'acc.forceGameOver()') === 'GAME_OVER', `lineup change ${i + 1}: no GAME_OVER`);
    await waitFor(page, 'acc.visible("#menuOver")', 600000, '#menuOver');
    await page.locator('#btnLineup').click(); await waitFor(page, "g.ui.screen === 'lineup'", 120000, 'lineup');
    const ids = await ev(page, 'acc.cardIds()');
    await lineupTap(page, ids[i % 3]); await lineupTap(page, ids[3 + ((i + 1) % 3)]);
    await page.locator(`${LU} [data-kits="${['classic', 'allstar', 'auto', 'classic', 'auto'][i]}"]`).first().click(); await sleep(200);
    await page.locator(`${LU} .luStart`).first().click(); await toCheck(`lineup change ${i + 1}`);
  }
  await run(page, REPLAY_RECORDER);
  await clockSet(page, 'fixed', 1000 / 60);
  for (const [k, clock] of [[0, 110], [1, 60], [2, 10]]) {
    await run(page, `acc.ready(); g.setClock({game: ${clock}, shot: 14}); acc.place(acc.ctrlId(), 0.6, -10.6); acc.sim(1 / 60); acc.rep = { score: null, start: null, end: null, modes: [], lod: null, seenActive: false }; g.debugShoot({kind: 'dunk', p: 1}); return true;`);
    await waitFor(page, 'acc.rep.end != null', 600000, `replay ${k + 1}`);
    await toCheck(`after replay ${k + 1}`);
  }
  await clockSet(page, 'real');
  await waitFor(page, "g.state === 'LIVE'", 120000, 'LIVE'); await waitFrames(page, 5);
  const mem1 = await ev(page, 'acc.memory()');
  const bad = ['geometries', 'textures', 'texMB'].filter((k) => mem1[k] !== mem0[k]);
  assert(!bad.length, `memory changed: ${fmt(mem0)} → ${fmt(mem1)}`);
  t.note(`memory ${fmt(mem1)}`);
});

item('B42', 'toneMapping NeutralToneMapping, exposure 1; CHECK frame 844×390 medium: wood patch (40 × 20 px between FT line and arc top) mean luma 0.60–0.72; kit chest crops keep hue ±18°', { timeoutS: 600, needs: [...BASE_HOOKS, 'renderer', 'characters', 'lineup'] }, async (t) => {
  requireGame(); const M = await mods();
  const { page } = await t.quick('phoneLandscape', `${QUICK}&quality=medium`);
  const tm = await run(page, "const T = await acc.mod('vendor/three.module.js'); return { tm: g.renderer.toneMapping, want: T.NeutralToneMapping, exp: g.renderer.toneMappingExposure };");
  eq(tm.tm, tm.want, 'renderer.toneMapping (NeutralToneMapping)');
  near(tm.exp, 1, 1e-6, 'renderer.toneMappingExposure');
  await run(page, 'acc.ready(); g.turnover(); return true;');
  await waitFor(page, "g.state === 'CHECK'", 60000, 'CHECK');
  await ev(page, 'acc.frozen = true'); await ev(page, 'acc.nextFrame(3)');
  // wood patch: a point between the FT line and the arc top whose 40 × 20 px box is not covered by any player
  const patch = await run(page, `
    const zMid = (${SPEC.lines.FT_Z} + ${SPEC.lines.ARC_TOP_Z}) / 2; const boxes = [];
    for (const p of acc.players()) { const q = acc.posOf(p); const h = 2.3; const a = acc.toPx(acc.ndc(q.x, 0, q.z)), b = acc.toPx(acc.ndc(q.x, h, q.z)); const half = Math.abs(acc.toPx(acc.ndc(q.x + 0.45, 0.9, q.z)).x - acc.toPx(acc.ndc(q.x, 0.9, q.z)).x) + 4; boxes.push({ x0: Math.min(a.x, b.x) - half, x1: Math.max(a.x, b.x) + half, y0: Math.min(a.y, b.y) - 4, y1: Math.max(a.y, b.y) + 4 }); }
    for (const x of [-1.2, 1.2, -2.0, 2.0, 0, -3.0, 3.0, -3.8, 3.8]) for (const z of [zMid, zMid - 0.5, zMid + 0.5]) {
      const c = acc.toPx(acc.ndc(x, 0, z)); const r = { x0: c.x - 20, x1: c.x + 20, y0: c.y - 10, y1: c.y + 10 };
      if (!boxes.some((b) => r.x0 < b.x1 && b.x0 < r.x1 && r.y0 < b.y1 && b.y0 < r.y1)) return { cx: c.x, cy: c.y, w: 40, h: 20, x, z };
    }
    return null;`);
  await ev(page, 'acc.hideDom()'); await ev(page, 'acc.nextFrame(2)');
  const img = await shot(page, 'B42-check-medium');
  await ev(page, 'acc.showDom()');
  const kits = await starKitBoxes(page, 'B42-kits-medium', M);
  await ev(page, 'acc.frozen = false');
  const problems = [];
  if (!patch) problems.push('no unoccluded 40 × 20 px wood patch between the FT line and the arc top');
  else { const l = boxLuma(img, patch); if (!(l >= 0.60 && l <= 0.72)) problems.push(`wood patch at (${patch.x}, ${r2(patch.z)}) mean luma ${l.toFixed(3)} outside 0.60–0.72`); else t.note(`wood luma ${l.toFixed(3)} at (${patch.x}, ${r2(patch.z)})`); }
  for (const k of kits) {
    if (!k.s) { problems.push(`${k.id}: torso box unavailable`); continue; }
    if (!(k.s.hueErr <= 18)) problems.push(`${k.id}: kit hue error ${k.s.hueErr.toFixed(1)}° > 18° (median ${k.s.medHue.toFixed(0)}°, base ${k.base})`);
  }
  if (problems.length) fail(problems.join('\n    '));
});

item('B43', 'Inside <iframe sandbox="allow-scripts allow-same-origin"> from another directory depth with throwing Storage: title, quick game LIVE, settings in memory, no cross-origin requests', { timeoutS: 600 }, async (t) => {
  requireGame();
  const host = t.server.addPage('/host/deep/er/path/frame.html', `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe id="f" sandbox="allow-scripts allow-same-origin" src="../../../../games/nba2k-threejs/index.html?quick=1&intro=0&seed=7"></iframe></body></html>`);
  const gm = await t.open('desktop', host, { init: STORAGE_THROWS_INIT });
  const frameOf = async () => { for (let i = 0; i < 200; i++) { const f = gm.page.frames().find((x) => /\/games\/nba2k-threejs\/index\.html/.test(x.url())); if (f) return f; await sleep(100); } fail('game iframe not found'); };
  const f = await frameOf();
  await f.waitForFunction(() => window.__game && window.__game.ui && window.__game.ui.screen === 'title', null, { timeout: 120000 });
  await f.evaluate(PAGE_SRC);
  await f.locator('#btnQuick').click();
  await f.evaluate(() => Promise.resolve(window.__game.legendsReady));
  await f.waitForFunction(() => window.__game.state === 'LIVE', null, { timeout: 120000 });
  // settings in memory: toggle sound off, close, reopen → still off (storage throws)
  await f.evaluate(() => window.__acc.install());
  await f.locator('#btnPause').click();
  await f.waitForFunction(() => document.querySelector('#menuPause') && getComputedStyle(document.querySelector('#menuPause')).display !== 'none', null, { timeout: 10000 });
  await f.locator('#pauseRows .opt[data-key="sound"][data-idx="1"]').first().click();
  const muted = await f.evaluate(() => window.__game.audio.muted);
  await f.locator('#btnResume').click(); await sleep(1500);
  await f.locator('#btnPause').click(); await sleep(300);
  const pressed = await f.evaluate(() => (document.querySelector('#pauseRows .opt[data-key="sound"][data-idx="1"]') || {}).getAttribute && document.querySelector('#pauseRows .opt[data-key="sound"][data-idx="1"]').getAttribute('aria-pressed'));
  const problems = [];
  if (muted !== true) problems.push(`音效 关 did not mute (audio.muted ${muted})`);
  if (pressed !== 'true') problems.push(`settings value not kept in memory (aria-pressed ${pressed})`);
  problems.push(...diagProblems(gm, 'iframe'));
  if (problems.length) fail(problems.join('\n    '));
});

// ------------------------------------------------------------------------------------------------ animation (B44–B52)
item('B44', '?anim=list and every clip × six players render 10 frames with no console/page errors', { timeoutS: 3600 }, async (t) => {
  requireGame();
  const gm = await t.open('desktop', 'index.html?anim=list&ui=0');
  await waitFor(gm.page, 'window.__anim && window.__anim.ready', 120000, 'window.__anim');
  await gm.page.evaluate(() => Promise.resolve(window.__anim.ready));
  const meta = await gm.page.evaluate(() => ({ clips: window.__anim.clips.slice(), players: window.__anim.players.slice() }));
  assert(meta.clips.length > 0 && meta.players.length === 6, `__anim lists ${meta.clips.length} clips and ${meta.players.length} players`);
  const failures = []; let rendered = 0, skipped = 0;
  for (const player of meta.players) {
    const r = await gm.page.evaluate(async ([clips, p]) => {
      const out = { ok: 0, skipped: 0, failed: [] };
      for (const c of clips) {
        const m = /^sig\.([a-z]+)\./.exec(c); const foreign = m && m[1] !== p;
        try { await window.__anim.load(c, p, {}); } catch (e) { if (foreign) out.skipped++; else out.failed.push(`${c}×${p}: ${e && e.message}`); continue; }
        for (let i = 0; i < 10; i++) await new Promise((res) => requestAnimationFrame(() => res()));
        out.ok++;
      }
      return out;
    }, [meta.clips, player]);
    rendered += r.ok; skipped += r.skipped; failures.push(...r.failed);
  }
  const problems = [...failures.slice(0, 10), ...diagProblems(gm, '?anim=list')];
  t.note(`${meta.clips.length} clips × ${meta.players.length} players: ${rendered} rendered, ${skipped} signature clips of other players skipped`);
  if (problems.length) fail(problems.join('\n    '));
});

item('B45', '?anim=loco&loco=5.2&player=yao and kyrie: max locked-foot slide < 0.01 m', { timeoutS: 600 }, async (t) => {
  requireGame();
  const out = {};
  for (const p of ['yao', 'kyrie']) {
    const gm = await t.open('desktop', `index.html?anim=loco&loco=5.2&player=${p}&ui=0`);
    await waitFor(gm.page, 'window.__anim && window.__anim.ready', 120000, 'window.__anim');
    await gm.page.evaluate(() => Promise.resolve(window.__anim.ready));
    out[p] = await gm.page.evaluate(() => {
      let max = 0, locked = 0;
      for (let i = 0; i < 360; i++) { window.__anim.step(1 / 60); for (const f of window.__anim.footLocks()) if (f.locked) { locked++; if (f.slide > max) max = f.slide; } }
      return { max, locked };
    });
    const problems = diagProblems(gm, p); if (problems.length) fail(problems.join('\n    '));
    await t.closeAll();
  }
  for (const p of ['yao', 'kyrie']) { assert(out[p].locked > 0, `${p}: no locked foot samples`); assert(out[p].max < 0.01, `${p}: max locked-foot slide ${out[p].max.toFixed(4)} m (≥ 0.01)`); }
  t.note(`slide yao ${out.yao.max.toFixed(4)} m, kyrie ${out.kyrie.max.toFixed(4)} m`);
});

item('B46', 'In game, a perfect jumper per legend (debugShoot eT 0 at tIdeal): e within ±0.02 and launch ball height within ±0.08 m of §4.9.2', { timeoutS: 900, needs: [...BASE_HOOKS, 'characters'] }, async (t) => {
  requireGame(); const M = await mods();
  const { page } = await t.quick('desktop', '?quick=1&intro=0&seed=7&q=5');
  const problems = []; const rows = [];
  for (const id of IDS) {
    const r = (await ev(page, `acc.shootTrial({n: 1, shooter: ${JSON.stringify(id)}, p: 1, eT: 0, at: {x: 0, z: -8.3}, defenders: 'away'})`))[0];
    if (r.error || !r.rel) { problems.push(`${id}: ${r.error || 'no release event'}`); continue; }
    const tim = M.select.getTiming(id, 'jumper', r.rel.variant || 'set');
    let e = typeof r.rel.e === 'number' ? r.rel.e : (typeof r.rel.eT === 'number' ? r.rel.eT / tim.METER_T : (typeof r.rel.siE === 'number' ? r.rel.siE : (typeof r.rel.siET === 'number' ? r.rel.siET / tim.METER_T : (typeof r.rel.meterFill === 'number' ? r.rel.meterFill - 0.80 : null))));
    rows.push(`${id} e ${e == null ? 'n/a' : e.toFixed(3)} y ${r2(r.rel.ballY)}`);
    if (e == null) problems.push(`${id}: no timing error available at release (release payload e/eT, ball.shotInfo or game.meter)`);
    else if (Math.abs(e) > 0.02) problems.push(`${id}: e ${e.toFixed(3)} outside ±0.02`);
    if (Math.abs(r.rel.ballY - SPEC.launchMid[id]) > 0.08) problems.push(`${id}: launch ball height ${r.rel.ballY.toFixed(3)} m vs ${SPEC.launchMid[id]} ± 0.08`);
  }
  t.note(rows.join('; '));
  if (problems.length) fail(problems.join('\n    '));
});

item('B47', 'Debug dunk: ball y ≥ 3.15 m at SLAM; ball displacement ≤ 0.30 m every step (no teleport)', { needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop');
  const r = await run(page, `
    const out = [];
    for (let k = 0; k < 3; k++) {
      acc.ready(); acc.place(acc.ctrlId(), 0.6, -10.6); acc.sim(1 / 60);
      let last = acc.ballPos(), maxD = 0, slamY = null, slamT = null, at = null;
      const un = acc.onEvent('slam', () => { if (slamY == null) { slamY = acc.ballPos().y; slamT = acc.simTime(); } });
      const sampler = () => { const b = acc.ballPos(); const d = Math.hypot(b.x - last.x, b.y - last.y, b.z - last.z); if (d > maxD) { maxD = d; at = { step: acc.stepCount, state: g.state, ball: g.ball.state }; } last = b; };
      acc.samplers.push(sampler);
      g.debugShoot({ kind: 'dunk', p: 1 });
      for (let i = 0; i < 300; i++) { acc.sim(1 / 60); if (slamT != null && acc.simTime() - slamT > 0.5) break; if (g.state !== 'LIVE' && slamT == null && i > 60) break; }
      acc.samplers.splice(acc.samplers.indexOf(sampler), 1); un();
      out.push({ slamY, maxD, at });
      acc.simUntil('g.state === "LIVE"', 8);
    }
    return out;`);
  const problems = [];
  r.forEach((x, i) => {
    if (x.slamY == null) problems.push(`dunk ${i + 1}: no SLAM event`);
    else if (!(x.slamY >= 3.15)) problems.push(`dunk ${i + 1}: ball y ${x.slamY.toFixed(3)} m at SLAM (< 3.15)`);
    if (!(x.maxD <= 0.30)) problems.push(`dunk ${i + 1}: ball moved ${x.maxD.toFixed(3)} m in one step (> 0.30) at ${fmt(x.at)}`);
  });
  t.note(r.map((x) => `slam y ${r2(x.slamY)}, max step ${r3(x.maxD)} m`).join('; '));
  if (problems.length) fail(problems.join('\n    '));
});

item('B48', 'Space keydown → first rendered frame where the shooter\'s right palm moved ≥ 2 cm ≤ 2 sim steps', { clock: true, timeoutS: 600, needs: [...BASE_HOOKS, 'characters'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop');
  await run(page, `acc.M.rig = await acc.mod('src/anim/rig.js'); return true;`);
  const res = [];
  for (let k = 0; k < 3; k++) {
    await run(page, 'acc.ready(); g.setClock({shot: 14}); acc.place(acc.ctrlId(), 0, -8.3); acc.sim(0.6); return true;');
    await clockSet(page, 'fixed', 1000 / 60);
    await waitFrames(page, 20);
    await run(page, `
      const id = acc.ctrlId(); const p = acc.byId(id); const S = acc.M.rig.SOCK; const v = acc.vec(0, 0, 0);
      acc.lat = { frames: [], keyStep: null, keyPalm: null, id };
      acc._latHook = () => { p.animator.renderSocket(S.palm_r, v); acc.lat.frames.push({ step: acc.stepCount, x: v.x, y: v.y, z: v.z }); };
      acc.frameHooks.push(acc._latHook);
      acc._latKey = (e) => { if (e.code === 'Space' && acc.lat.keyStep == null) { acc.lat.keyStep = acc.stepCount; const f = acc.lat.frames[acc.lat.frames.length - 1]; acc.lat.keyPalm = f ? { x: f.x, y: f.y, z: f.z } : null; } };
      window.addEventListener('keydown', acc._latKey, true);
      return true;`);
    await waitFrames(page, 3);
    await page.keyboard.down('Space'); await waitFrames(page, 12); await page.keyboard.up('Space');
    const L = await run(page, "acc.frameHooks.splice(acc.frameHooks.indexOf(acc._latHook), 1); window.removeEventListener('keydown', acc._latKey, true); return acc.lat;");
    await clockSet(page, 'real');
    assert(L.keyStep != null && L.keyPalm, 'keydown or palm sample not recorded');
    const first = L.frames.find((f) => f.step > L.keyStep && Math.hypot(f.x - L.keyPalm.x, f.y - L.keyPalm.y, f.z - L.keyPalm.z) >= 0.02);
    res.push(first ? first.step - L.keyStep : null);
    await run(page, 'acc.simUntil(\'g.state === "LIVE" && acc.ballHeld()\', 10); return true;');
  }
  const bad = res.filter((s) => s == null || s > 2);
  assert(!bad.length, `steps from Space keydown to a rendered palm move ≥ 2 cm: ${fmt(res)} (each must be ≤ 2)`);
  t.note(`latency in steps: ${res.join(', ')}`);
});

item('B49', 'CHECK → LIVE: no bone rotates more than 25° between consecutive frames (R#37)', { clock: true, timeoutS: 900, needs: [...BASE_HOOKS, 'characters'] }, async (t) => {
  // Character (WP2) exposes the rig-ordered three.js bones as `boneList` (`bones` is keyed by bone name, §1.4 leaves the
  // shape open); the 53-bone scan reads boneList.
  requireGame();
  const { page } = await t.quick('desktop');
  const results = [];
  for (let k = 0; k < 2; k++) {
    await run(page, 'acc.ready(); return true;');
    await clockSet(page, 'fixed', 1000 / 60);
    await run(page, `
      const ids = Object.keys(g.characters); acc.rot = { max: 0, where: null, frames: 0, liveAt: null, done: false, prev: null, prevVis: null, started: false };
      acc._rotHook = () => {
        const R = acc.rot; if (R.done) return;
        const st = g.state; if (!R.started) { if (st !== 'CHECK') return; R.started = true; }
        if (st === 'LIVE' && R.liveAt == null) R.liveAt = R.frames;
        const q = new Float32Array(ids.length * 53 * 4); const vis = ids.map((id) => !!g.characters[id].visible);
        ids.forEach((id, ci) => { const c = g.characters[id]; const bs = Array.isArray(c.boneList) ? c.boneList : c.bones; for (let b = 0; b < 53 && b < bs.length; b++) { const o = (ci * 53 + b) * 4, Q = bs[b].quaternion; q[o] = Q.x; q[o + 1] = Q.y; q[o + 2] = Q.z; q[o + 3] = Q.w; } });
        if (R.prev) ids.forEach((id, ci) => { if (!vis[ci] || !R.prevVis[ci]) return; for (let b = 0; b < 53; b++) { const o = (ci * 53 + b) * 4; const d = Math.abs(q[o] * R.prev[o] + q[o + 1] * R.prev[o + 1] + q[o + 2] * R.prev[o + 2] + q[o + 3] * R.prev[o + 3]); const ang = 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI; if (ang > R.max) { R.max = ang; R.where = { id, bone: (g.characters[id].boneList || g.characters[id].bones)[b].name, frame: R.frames, state: st }; } } });
        R.prev = q; R.prevVis = vis; R.frames++;
        if (R.liveAt != null && R.frames - R.liveAt >= 60) R.done = true;
      };
      acc.frameHooks.push(acc._rotHook); g.turnover(); return true;`);
    await waitFor(page, 'acc.rot.done', 900000, 'CHECK → LIVE + 1 s recorded');
    results.push(await run(page, 'acc.frameHooks.splice(acc.frameHooks.indexOf(acc._rotHook), 1); const R = acc.rot; return { max: R.max, where: R.where, frames: R.frames };'));
    await clockSet(page, 'real');
  }
  const worst = results.reduce((a, b) => (b.max > a.max ? b : a));
  assert(worst.max <= 25, `a bone rotated ${worst.max.toFixed(1)}° between consecutive frames: ${fmt(worst.where)}`);
  t.note(`max bone rotation per frame ${results.map((r) => r.max.toFixed(1) + '°').join(', ')}`);
});

item('B50', 'Every recorded block had palm–ball distance < rHand (0.30; 0.36 LeBron chase-down; 0.34 Yao anchor / Giannis help) (C2)', { timeoutS: 1500, needs: BASE_HOOKS }, async (t) => {
  requireGame();
  const blocks = [];
  for (const seed of [3, 11, 21, 33, 47]) {
    const { page } = await t.quick('desktop', `?quick=1&intro=0&auto=1&seed=${seed}&q=0.5&lineup=lebron,yao,giannis~jordan,kobe,kyrie`);
    await run(page, `
      acc.M.rig = await acc.mod('src/anim/rig.js'); const S = acc.M.rig.SOCK; acc.blocks = []; acc._prevBall = acc.ballPos();
      acc.samplers.push(() => { acc._prevBall = acc.ballPos(); });
      acc.onEvent('block', (e) => {
        const id = e.blockerId || e.playerId; const p = acc.byId(id); if (!p || !p.animator) { acc.blocks.push({ id, err: 'no animator' }); return; }
        const cur = acc.ballPos(), prev = acc._prevBall; const v = acc.vec(0, 0, 0); let best = Infinity;
        for (const s of [S.palm_r, S.palm_l]) { p.animator.querySocket(s, v); for (const b of [cur, prev]) best = Math.min(best, Math.hypot(v.x - b.x, v.y - b.y, v.z - b.z)); }
        const rimD = Math.hypot(acc.posOf(id).x, acc.posOf(id).z + 12.75);
        acc.blocks.push({ id, d: best, chaseDown: !!e.chaseDown, rHand: typeof e.rHand === 'number' ? e.rHand : null, rimD });
      });
      return true;`);
    for (let i = 0; i < 12; i++) { await ev(page, 'g.fastForward(10)'); if (await ev(page, 'g.state === "GAME_OVER"')) break; }
    blocks.push(...await ev(page, 'acc.blocks'));
    await t.closeAll();
    if (blocks.length >= 4) break;
  }
  assert(blocks.length >= 1, 'no block was recorded in up to 5 auto games');
  const bad = blocks.filter((b) => {
    if (b.err) return true;
    const r = b.rHand != null ? b.rHand : (b.chaseDown && b.id === 'lebron' ? SPEC.rHand.chaseDown : (b.id === 'yao' && b.rimD <= 2.5) || b.id === 'giannis' ? SPEC.rHand.anchor : SPEC.rHand.base);
    return !(b.d < r);
  });
  assert(!bad.length, `blocks with palm–ball distance ≥ rHand: ${fmt(bad.map((b) => ({ id: b.id, d: r3(b.d), chaseDown: b.chaseDown, rHand: b.rHand, err: b.err })))}`);
  t.note(`${blocks.length} blocks; max palm–ball ${Math.max(...blocks.map((b) => b.d || 0)).toFixed(3)} m`);
});

item('B51', 'No full-body celebration is active when the CHECK tween starts', { timeoutS: 900, needs: [...BASE_HOOKS, 'debug.forceCelebrate'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop');
  const r = await run(page, `
    acc.M.clip = await acc.mod('src/anim/clip.js'); const C = acc.M.clip; g.debug.forceCelebrate = true;
    const at = []; let celSeen = 0;
    const un = acc.onEvent('state', (e) => {
      if (e.to !== 'CHECK') return;
      for (const p of acc.players()) { const a = p.animator; const idx = a ? a.action : -1; if (idx >= 0) { const id = C.clipIdOf(idx); const def = C.getDef(idx, acc.pid(p)); const mask = def ? (def.mask || 'full') : 'full'; at.push({ player: acc.pid(p), clip: id, mask }); } }
    });
    const watch = () => { for (const p of acc.players()) { const a = p.animator; if (a && a.action >= 0 && /^cel\\./.test(C.clipIdOf(a.action) || '')) celSeen++; } };
    acc.samplers.push(watch);
    for (let k = 0; k < 6; k++) {
      acc.ready(); acc.place(acc.ctrlId(), k % 2 ? 0.6 : 0, k % 2 ? -10.6 : -8.3); acc.sim(1 / 60);
      g.debugShoot(k % 2 ? { kind: 'dunk', p: 1 } : { p: 1, eT: 0 });
      acc.simUntil('g.state === "CHECK"', 12); acc.simUntil('g.state === "LIVE"', 6);
    }
    acc.samplers.splice(acc.samplers.indexOf(watch), 1); un();
    return { bad: at.filter((x) => /^cel\\./.test(x.clip || '') && x.mask === 'full'), celSeen, n: at.length };`);
  if (!r.celSeen) t.warn('no celebration clip was observed after 6 forced makes (forceCelebrate); the check is vacuous');
  assert(!r.bad.length, `full-body celebrations active at the CHECK tween: ${fmt(r.bad)}`);
  t.note(`celebration steps seen ${r.celSeen}`);
});

item('B52', 'Pass launch position equals the passer\'s hand socket within 0.02 m', { timeoutS: 900, needs: BASE_HOOKS }, async (t) => {
  requireGame();
  // the item checks where passes leave the hand; how often the CPU passes is balance (AI tendencies), so the window
  // is long enough (60 s quarters, up to 300 s of play) to sample at least 5 passes at the current pass rate
  const { page } = await t.quick('desktop', '?quick=1&intro=0&auto=1&seed=9&q=1');
  await run(page, `
    acc.M.rig = await acc.mod('src/anim/rig.js'); const S = acc.M.rig.SOCK; acc.passes = [];
    acc.onEvent('pass', (e) => {
      const p = acc.byId(e.playerId); if (!p || !p.animator) { acc.passes.push({ id: e.playerId, err: 'no animator' }); return; }
      const b = acc.ballPos(); const v = g.ball.vel || { x: 0, y: 0, z: 0 }; const back = { x: b.x - v.x / 60, y: b.y - v.y / 60, z: b.z - v.z / 60 };
      const s = acc.vec(0, 0, 0); let best = Infinity;
      for (const k of [S.ball1_r, S.ball1_l, S.ball]) { p.animator.querySocket(k, s); for (const q of [b, back]) best = Math.min(best, Math.hypot(s.x - q.x, s.y - q.y, s.z - q.z)); }
      acc.passes.push({ id: e.playerId, d: best, kind: e.kind });
    });
    return true;`);
  let simS = 0;
  for (let i = 0; i < 30; i++) { await ev(page, 'g.fastForward(10)'); simS += 10; if ((await ev(page, 'acc.passes.length')) >= 12 || (await ev(page, "g.state === 'GAME_OVER'"))) break; }
  const passes = await ev(page, 'acc.passes');
  assert(passes.length >= 5, `only ${passes.length} passes recorded in ${simS} s of auto play`);
  const bad = passes.filter((p) => p.err || !(p.d <= 0.02));
  assert(!bad.length, `pass launch ≠ hand socket (≤ 0.02 m): ${fmt(bad.slice(0, 6).map((p) => ({ id: p.id, d: r3(p.d), kind: p.kind, err: p.err })))}`);
  t.note(`${passes.length} passes; max distance ${Math.max(...passes.map((p) => p.d)).toFixed(4)} m`);
});

// ------------------------------------------------------------------------------------------------ gameplay (B53–B55)
item('B53', 'Touch: quick SHOOT tap (< 0.12 s) → pumpFake; CROSS double-tap → 2 moves queued; walking into a defender placed at (2.0, −10.5) for 0.35 s → state post', { clock: true, timeoutS: 600, needs: [...BASE_HOOKS, 'events'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('phoneLandscape', '?quick=1&intro=0&seed=7&q=5');
  const problems = [];
  // Taps are judged in game time: on SwiftShader a frame can block the main thread for longer than the whole tap, and
  // CDP holds the touchEnd until the page has handled the touchStart, so in real time a 50 ms tap reaches the game as
  // a hold of several hundred ms (catch-up steps). The virtual clock gives one fixed step per rendered frame, as on a
  // 60 Hz phone; the post-up walk below runs on the real clock again.
  await clockSet(page, 'fixed', 1000 / 60);
  // CROSS double tap while dribbling
  await run(page, 'acc.ready(); g.setClock({shot: 14}); acc.place(acc.ctrlId(), -1.5, -6.5); return true;');
  const p0 = await stickPoint(page);
  // hold the stick for 0.4 s of game time (virtual clock: few rendered frames, so the hold is topped up with the
  // stick still down) so the handler is dribbling when CROSS is tapped
  await H.multiTouch(page, [{ type: 'touchStart', points: [{ id: 1, ...p0 }], waitMs: 30 }, ...H.moveSteps(1, p0, { x: p0.x + 25, y: p0.y }, 3),
    async () => { await holdSim(page, 0.4, null, 'B53 stick'); }, { type: 'touchEnd', points: [] }]);
  await waitFor(page, "g.ball.state === 'dribble' || acc.ballHeld()", 3000, 'handler with the ball');
  const e0 = await ev(page, 'acc.evts.length');
  const cb = center(await bbox(page, '#btnTertiary'));
  await H.touchTap(page, cb, { holdMs: 40 }); await sleep(120); await H.touchTap(page, cb, { holdMs: 40 });
  await holdSim(page, 1.5, t, 'B53 combo');
  const moves = await ev(page, `acc.since(${e0}, 'move').length`);
  if (moves < 2) problems.push(`CROSS double-tap produced ${moves} 'move' event(s) (expected 2)`);
  // quick SHOOT tap → pump fake
  await run(page, 'acc.ready(); g.setClock({shot: 14}); acc.place(acc.ctrlId(), 0, -8.3); acc.sim(0.4); return true;');
  const e1 = await ev(page, 'acc.evts.length');
  await H.touchTap(page, center(await bbox(page, '#btnPrimary')), { holdMs: 50 });
  await holdSim(page, 0.6, t, 'B53 pump fake');
  const pf = await ev(page, `acc.since(${e1}, 'pumpFake').length`);
  const shots = await ev(page, `acc.since(${e1}, 'shot').length`);
  if (pf < 1) problems.push(`quick SHOOT tap produced no 'pumpFake' event (shot events ${shots})`);
  // post-up: walk into a defender at (2.0, −10.5) — still on the virtual clock: in real time the CDP touchMoves each
  // wait for a SwiftShader frame and the handler had walked past the defender before the hold began
  const post = await run(page, `
    acc.ready(); g.setClock({shot: 14}); const me = acc.ctrlId(); const tm = acc.teamOf(me);
    const opp = acc.players().filter((p) => acc.teamOf(p) !== tm).map(acc.pid);
    const d0 = opp[0]; opp.slice(1).forEach((o, k) => acc.place(o, k ? 6.8 : -6.8, -1.0, Math.PI));
    acc.place(d0, 2.0, -10.5, Math.atan2(2.6 - 2.0, -9.83 + 10.5));
    acc.place(me, 2.6, -9.83); acc.sim(1 / 60);
    return { me, d0 };`);
  const p1 = await stickPoint(page);
  // stick toward the rim: from (2.6, −9.83) the rim lies left and up on screen; magnitude ≈ 0.5 (32 px of 56)
  const dir = { x: -0.66, y: -0.75 }; const to = { x: Math.round(p1.x + 32 * dir.x), y: Math.round(p1.y + 32 * dir.y) };
  // the defender holds his spot (as a parked defender in the balance scenarios): the CPU defender otherwise slides
  // off the handler→rim lane within 0.2 s and the item is about backing into a defender who is there
  await run(page, `acc.seenPost = false; const d = acc.byId(${JSON.stringify(post.d0)}); const dx = d.pos.x, dz = d.pos.z, dy = d.yaw;
    acc._postSampler = () => { if ((acc.info(${JSON.stringify(post.me)}) || {}).state === 'post') acc.seenPost = true; if (!acc.seenPost) acc.place(${JSON.stringify(post.d0)}, dx, dz, dy); };
    acc.samplers.push(acc._postSampler); return true;`);
  await H.multiTouch(page, [{ type: 'touchStart', points: [{ id: 1, ...p1 }], waitMs: 30 }, ...H.moveSteps(1, p1, to, 4), async () => {
    await holdSim(page, 0.8, t, 'B53 post-up hold');
  }, { type: 'touchEnd', points: [] }]);
  const seenPost = await run(page, 'acc.samplers.splice(acc.samplers.indexOf(acc._postSampler), 1); return acc.seenPost;');
  await clockSet(page, 'real');
  if (!seenPost) problems.push(`walking into the defender at (2.0, −10.5) did not enter state 'post' (state ${await ev(page, `(acc.info(${JSON.stringify(post.me)}) || {}).state`)})`);
  if (problems.length) fail(problems.join('\n    '));
});

item('B54', 'forceAbility(id) for all 22 ids: each logs exactly once, no invariant break', { needs: [...BASE_HOOKS, 'forceAbility', 'abilityLog', 'debug.invariantsBroken'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop');
  const ids = (await import(pathToFileURL(path.join(ROOT, 'src/abilities.js')).href)).ABILITY_IDS;
  assert(ids && ids.length === 22, `ABILITY_IDS has ${ids && ids.length} ids (expected 22)`);
  const r = await run(page, `
    const log = g.abilityLog; const count = (id) => typeof log.count === 'function' ? log.count(id) : (log.toArray ? log.toArray() : log).filter((e) => e.id === id).length;
    const inv0 = g.debug.invariantsBroken; const out = [];
    for (const id of ${JSON.stringify(ids)}) {
      acc.ready(); g.setClock({game: 110, shot: 14});
      const c0 = count(id); let ok = null; try { ok = g.forceAbility(id); } catch (e) { out.push({ id, err: e.message }); continue; }
      let n = count(id) - c0; for (let i = 0; i < 60 && n === 0; i++) { acc.sim(1 / 60); n = count(id) - c0; }
      out.push({ id, ok, n });
    }
    return { out, inv: g.debug.invariantsBroken - inv0 };`);
  const bad = r.out.filter((x) => x.err || x.n !== 1);
  assert(!bad.length, `abilities not logged exactly once: ${fmt(bad)}`);
  eq(r.inv, 0, 'invariants broken while forcing abilities');
});

item('B55', '?bot=avg&seed=5&q=0.5 full game reaches GAME_OVER with FG% of both teams in 30–75 %', { timeoutS: 900, needs: [...BASE_HOOKS, 'bot'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop', '?quick=1&intro=0&bot=avg&seed=5&q=0.5');
  for (let i = 0; i < 60; i++) { await ev(page, 'g.fastForward(10)'); if (await ev(page, 'g.state === "GAME_OVER"')) break; }
  const r = await ev(page, `(() => { const fg = [0, 1].map((tm) => { let m = 0, a = 0; for (const p of acc.players()) if (acc.teamOf(p) === tm) { const s = acc.statsOf(acc.pid(p)) || {}; m += s.fgm || 0; a += s.fga || 0; } return { m, a, pct: a ? m / a : 0 }; }); return { state: g.state, score: acc.scores(), fg }; })()`);
  eq(r.state, 'GAME_OVER', 'state after the bot game');
  for (const [i, f] of r.fg.entries()) assert(f.pct >= 0.30 && f.pct <= 0.75, `team ${i} FG% ${(f.pct * 100).toFixed(1)} % (${f.m}/${f.a}) outside 30–75 %`);
  t.note(`score ${fmt(r.score)}; FG ${r.fg.map((f) => `${f.m}/${f.a}`).join(', ')}`);
});

// ------------------------------------------------------------------------------------------------ characters on medium (B56–B58, B60)
item('B56', 'Medium: 4 draw calls per character (toggling), character triangles ≤ 100k at the CHECK camera, program count does not grow 1 → 6 characters, no Kyrie mouthguard, kit DoubleSide, lodOverride 0→1→2→3→null leaves textures/texMB unchanged', { timeoutS: 900, needs: [...BASE_HOOKS, 'characters', 'renderer', 'perf.drawCalls', 'perf.triangles'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop', `${QUICK}&quality=medium`);
  await run(page, 'acc.ready(); g.turnover(); return true;');
  await waitFor(page, "g.state === 'CHECK'", 60000, 'CHECK');
  await ev(page, 'acc.frozen = true');
  const r = await run(page, `
    const ids = Object.keys(g.characters); const T = await acc.mod('vendor/three.module.js');
    const meshes = (id) => { const c = g.characters[id]; return [c.body, c.kitMesh, c.groomMesh].filter(Boolean); };
    const setOn = (list) => { for (const id of ids) for (const m of meshes(id)) m.visible = list.includes(id); };
    const frame = async () => { await acc.nextFrame(3); const p = g.perf; return { calls: p.drawCalls, tris: p.triangles, programs: (g.renderer.info.programs || []).length }; };
    setOn([]); const none = await frame();
    const per = {};
    for (const id of ids) { setOn([id]); const f = await frame(); per[id] = { calls: f.calls - none.calls, visible: !!g.characters[id].visible, programs: f.programs }; }
    setOn(ids); const all = await frame();
    const mouthguard = []; g.characters.kyrie.object.traverse((o) => { if (/mouth ?guard/i.test(o.name || '') && o.visible) mouthguard.push(o.name); });
    const sides = ids.map((id) => [id, g.characters[id].kitMesh.material.side === T.DoubleSide]);
    const mem0 = acc.memory(); const lods = [];
    for (const v of [0, 1, 2, 3, null]) { for (const id of ids) g.characters[id].lodOverride = v; await acc.nextFrame(3); const m = acc.memory(); lods.push({ v, textures: m.textures, texMB: m.texMB, lod: g.characters.kobe.lod }); }
    return { tier: g.quality && g.quality.tier, none, per, all, charTris: all.tris - none.tris, mouthguard, sides, mem0, lods };`);
  await ev(page, 'acc.frozen = false');
  const problems = [];
  if (r.tier !== 'medium') problems.push(`tier ${r.tier} (expected medium)`);
  for (const [id, p] of Object.entries(r.per)) { if (!p.visible) { t.warn(`${id} culled at the CHECK camera; its draw calls not measured`); continue; } if (p.calls !== 4) problems.push(`${id}: ${p.calls} draw calls (expected 4)`); }
  if (!(r.charTris <= 100000)) problems.push(`character triangles ${r.charTris} (> 100k)`);
  const progs = Object.values(r.per).map((p) => p.programs);
  if (Math.min(...progs) !== r.all.programs) problems.push(`WebGL program count grows from one character (${Math.min(...progs)}) to six (${r.all.programs})`);
  if (r.mouthguard.length) problems.push(`Kyrie's mouthguard is visible on medium: ${r.mouthguard.join(', ')}`);
  const single = r.sides.filter(([, ok]) => !ok).map(([id]) => id); if (single.length) problems.push(`kit material not DoubleSide: ${single.join(', ')}`);
  for (const l of r.lods) if (l.textures !== r.mem0.textures || l.texMB !== r.mem0.texMB) problems.push(`lodOverride ${l.v}: textures ${l.textures} / texMB ${l.texMB} vs ${r.mem0.textures} / ${r.mem0.texMB}`);
  t.note(`character tris ${r.charTris}; programs ${r.all.programs}; per-character calls ${fmt(Object.fromEntries(Object.entries(r.per).map(([k, v]) => [k, v.calls])))}`);
  if (problems.length) fail(problems.join('\n    '));
});

item('B57', 'Every legend\'s mid-range jumper: AnimProxy socket height at RELEASE vs the real socket within 0.10 m', { timeoutS: 600, needs: [...BASE_HOOKS, 'characters'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop', '?quick=1&intro=0&seed=7&q=5');
  await run(page, `
    acc.M.rig = await acc.mod('src/anim/rig.js'); acc.M.proxy = await acc.mod('src/anim/proxy.js'); acc.b57 = [];
    acc.onEvent('release', (e) => {
      const id = e.playerId; const p = acc.byId(id); if (!p || !p.animator || acc.b57.some((x) => x.id === id)) return;
      const S = acc.M.rig.SOCK; const v = acc.vec(0, 0, 0), w = acc.vec(0, 0, 0);
      p.animator.querySocket(S.ball, v);
      const P = new acc.M.proxy.AnimProxy(id, acc.M.proxy.PROXY_METRICS[id], { owner: p }); P.play(p.animator.action, {}); P.querySocket(S.ball, w);
      acc.b57.push({ id, real: v.y, proxy: w.y, clip: p.animator.action });
    });
    return true;`);
  for (const id of IDS) await ev(page, `acc.shootTrial({n: 1, shooter: ${JSON.stringify(id)}, p: 1, eT: 0, at: {x: 0, z: -8.3}, defenders: 'away'})`);
  const rows = await ev(page, 'acc.b57');
  const missing = IDS.filter((id) => !rows.some((r) => r.id === id)); assert(!missing.length, `no release recorded for ${missing.join(', ')}`);
  const bad = rows.filter((r) => !(Math.abs(r.real - r.proxy) <= 0.10));
  assert(!bad.length, `proxy vs real ball socket height at RELEASE differs by > 0.10 m: ${fmt(bad.map((r) => ({ id: r.id, real: r3(r.real), proxy: r3(r.proxy) })))}`);
  t.note(rows.map((r) => `${r.id} ${r3(r.real)}/${r3(r.proxy)}`).join(', '));
});

/** Worn shell names of a character (kit + groom) from whichever form the character exposes. */
const SHELLS_EXPR = (id) => `(() => {
  const c = g.characters[${JSON.stringify(id)}]; const names = (a) => (Array.isArray(a) ? a.map((x) => (typeof x === 'string' ? x : x && x.name)).filter(Boolean) : null);
  return names(c.shells) || names(c.info && c.info.shells) || (() => { const k = names(c.kitMesh && c.kitMesh.userData && c.kitMesh.userData.shells) || [], gr = names(c.groomMesh && c.groomMesh.userData && c.groomMesh.userData.shells) || []; return k.length || gr.length ? k.concat(gr) : null; })();
})()`;
item('B58', 'Per legend on medium: morphTargetDictionary has exactly the §3.9 channels (low: none); shells per §2.7–§2.8 (Kobe sleeve + tape, Jordan wristband and no hair shell, LeBron headband, Yao no beard shell, Kyrie no headband)', {
  timeoutS: 900, needs: [...BASE_HOOKS, 'characters'],
  staticPart: async (t) => {
    const M = await mods(); const head = JSON.parse(readText(path.join(ROOT, 'assets', 'legends', 'legends.json'))); const problems = [];
    for (const p of head.players) {
      const got = p.morphs.targets.map((x) => x.name).sort().join(','); const want = SPEC.morphs[p.id].slice().sort().join(',');
      if (got !== want) problems.push(`legends.json ${p.id}: morph channels ${got} ≠ §3.9 ${want}`);
      const sh = p.shells.map((s) => s.name);
      if (p.id === 'jordan' && sh.some((n) => /^hair_/.test(n))) problems.push('legends.json jordan has a hair shell');
      if (p.id === 'yao' && sh.some((n) => /^beard_/.test(n))) problems.push('legends.json yao has a beard shell');
    }
    const acc = (id) => M.legends.LEGENDS[id].kit.accessories.filter((a) => a.worn).map((a) => a.shell);
    if (!(acc('kobe').includes('sleeve_r') && acc('kobe').includes('tape_r_im'))) problems.push(`legends.js kobe worn shells ${fmt(acc('kobe'))}`);
    if (!acc('jordan').includes('wristband_l')) problems.push(`legends.js jordan worn shells ${fmt(acc('jordan'))}`);
    if (!acc('lebron').includes('headband_high')) problems.push(`legends.js lebron worn shells ${fmt(acc('lebron'))}`);
    if (acc('kyrie').some((s) => /^headband/.test(s || ''))) problems.push(`legends.js kyrie wears a headband ${fmt(acc('kyrie'))}`);
    if (problems.length) fail(problems.join('\n    '));
  },
}, async (t, self) => {
  await self.staticPart(t);
  requireGame();
  const problems = [];
  const { page } = await t.quick('desktop', `${QUICK}&quality=medium`);
  for (const id of IDS) {
    const keys = await ev(page, `Object.keys(g.characters[${JSON.stringify(id)}].body.morphTargetDictionary || {}).sort()`);
    if (keys.join(',') !== SPEC.morphs[id].slice().sort().join(',')) problems.push(`medium ${id}: morph channels ${fmt(keys)} ≠ ${fmt(SPEC.morphs[id])}`);
    const sh = await ev(page, SHELLS_EXPR(id));
    if (!sh) { problems.push(`${id}: the character exposes no shell list (c.shells / c.info.shells)`); continue; }
    const has = (re) => sh.some((n) => re.test(n));
    if (id === 'kobe' && !(has(/^sleeve_r$/) && has(/^tape_r_im$/))) problems.push(`kobe shells ${fmt(sh)} lack sleeve_r + tape_r_im`);
    if (id === 'jordan' && (!has(/^wristband_l$/) || has(/^hair_/))) problems.push(`jordan shells ${fmt(sh)}: wristband_l required, no hair shell`);
    if (id === 'lebron' && !has(/^headband_high$/)) problems.push(`lebron shells ${fmt(sh)} lack headband_high`);
    if (id === 'yao' && has(/^beard_/)) problems.push(`yao shells ${fmt(sh)} include a beard shell`);
    if (id === 'kyrie' && has(/^headband/)) problems.push(`kyrie shells ${fmt(sh)} include a headband`);
  }
  await t.closeAll();
  const low = await t.quick('desktop', `${QUICK}&quality=low`);
  const lowKeys = await ev(low.page, `${JSON.stringify(IDS)}.map((id) => [id, Object.keys(g.characters[id].body.morphTargetDictionary || {}).length])`);
  for (const [id, n] of lowKeys) if (n) problems.push(`low ${id}: ${n} morph targets (expected none)`);
  if (problems.length) fail(problems.join('\n    '));
});

item('B59', 'document.title 传奇对决 3v3 / LEGENDS 3v3; title and loading screens show legal.note; README.md both notes + names-and-likenesses sentence; assets/legends/README.md names CC0 MakeHuman/MPFB and the pinned mpfbRef', {
  timeoutS: 300,
  staticPart: async (t) => {
    const problems = [];
    const readme = path.join(ROOT, 'README.md');
    if (!fs.existsSync(readme)) problems.push('README.md missing');
    else {
      const s = readText(readme);
      for (const want of ['非商业粉丝作品', 'Non-commercial fan project', '球员姓名与肖像归其本人所有']) if (!s.includes(want)) problems.push(`README.md lacks "${want}"`);
      if (!/names and likenesses belong to the players/i.test(s)) problems.push('README.md lacks "names and likenesses belong to the players"');
    }
    const ar = path.join(ROOT, 'assets', 'legends', 'README.md');
    if (!fs.existsSync(ar)) problems.push('assets/legends/README.md missing');
    else {
      const s = readText(ar); const head = JSON.parse(readText(path.join(ROOT, 'assets', 'legends', 'legends.json')));
      for (const re of [/CC0/, /MakeHuman/, /MPFB/]) if (!re.test(s)) problems.push(`assets/legends/README.md does not mention ${re.source}`);
      if (!head.mpfbRef || !s.includes(head.mpfbRef)) problems.push(`assets/legends/README.md does not name the pinned mpfbRef ${head.mpfbRef}`);
    }
    if (problems.length) fail(problems.join('\n    '));
  },
}, async (t, self) => {
  await self.staticPart(t);
  requireGame(); const M = await mods();
  const legal = M.i18n.STRINGS.zh['legal.note'], legalEn = M.i18n.STRINGS.en['legal.note'];
  const gm = await t.open('desktop', 'index.html?seed=7', { navigate: false });
  await gm.page.goto(gm.target, { waitUntil: 'domcontentloaded' });
  const loadingLegal = await gm.page.evaluate(() => { const el = document.querySelector('#loading .legal'); if (!el) return null; const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' ? el.textContent.trim() : null; });
  assert(loadingLegal === legal, `loading screen legal note ${fmt(loadingLegal)} ≠ ${fmt(legal)}`);
  await installHelpers(gm.page); await H.waitTitle(gm.page);
  eq(await gm.page.title(), TXT.zh.title, 'document.title (zh)');
  const titleLegal = await gm.page.evaluate(() => { const el = document.querySelector('#screenTitle .legal'); return el && getComputedStyle(el).display !== 'none' ? el.textContent.trim() : null; });
  assert(titleLegal === legal, `title screen legal note ${fmt(titleLegal)} ≠ ${fmt(legal)}`);
  await gm.page.locator('[data-action=lang]').first().click();
  await waitFor(gm.page, `document.title === ${JSON.stringify(TXT.en.title)}`, 3000, 'document.title (en)');
  const titleLegalEn = await gm.page.evaluate(() => document.querySelector('#screenTitle .legal').textContent.trim());
  assert(titleLegalEn === legalEn, `title legal note (en) ${fmt(titleLegalEn)}`);
});

item('B60', 'Medium, signature faces in play: Jordan dunk tongueOut ≥ 0.8 at SLAM (and in its replay); forceCelebrate Kobe dunk jawJut ≥ 0.8 ≤ 0.5 s after the score + idle scowl 0.35 ± 0.05; LeBron dunk roar ≥ 0.8 ≤ 0.15 s after SLAM; Kyrie three smirk ≥ 0.6 ≤ 0.5 s, roar 0; Yao block roar ≥ 0.8', { clock: true, timeoutS: 2400, needs: [...BASE_HOOKS, 'characters', 'debug.forceCelebrate', 'replay'] }, async (t) => {
  requireGame();
  const { page } = await t.quick('desktop', `${QUICK}&quality=medium&lineup=lebron,kyrie,giannis~jordan,kobe,yao`);
  await run(page, `
    g.debug.forceCelebrate = true; acc.face = { log: [], ev: [] };
    acc.onEvent('slam', (e) => acc.face.ev.push({ type: 'slam', id: e.playerId, t: performance.now() }));
    acc.onEvent('score', (e) => acc.face.ev.push({ type: 'score', id: e.playerId, t: performance.now() }));
    acc.onEvent('block', (e) => acc.face.ev.push({ type: 'block', id: e.blockerId || e.playerId, t: performance.now() }));
    const chans = ['tongueOut', 'jawJut', 'roar', 'smirk', 'scowl'];
    acc.frameHooks.push(() => { const now = performance.now(); const rec = { t: now, rep: !!(g.replay && g.replay.active), w: {} }; for (const id of Object.keys(g.characters)) { const o = {}; for (const c of chans) o[c] = acc.morphWeight(id, c) || 0; rec.w[id] = o; } acc.face.log.push(rec); if (acc.face.log.length > 6000) acc.face.log.splice(0, 1000); });
    return true;`);
  await clockSet(page, 'fixed', 1000 / 60);
  const problems = [];
  const maxIn = (log, id, ch, t0, t1, rep) => log.filter((r) => r.t >= t0 && r.t <= t1 && (rep == null || r.rep === rep)).reduce((m, r) => Math.max(m, (r.w[id] || {})[ch] || 0), 0);
  const shootAndWait = async (id, opts, waitMs) => {
    await run(page, `acc.readyFor(${JSON.stringify(id)}); g.setClock({game: 100, shot: 14}); acc.place(${JSON.stringify(id)}, ${opts.x}, ${opts.z}); acc.sim(1 / 60); acc.face.mark = performance.now(); g.debugShoot(Object.assign({ shooter: ${JSON.stringify(id)} }, ${JSON.stringify(opts.shot)})); return true;`);
    // wait `waitMs` after the score (not after the shot): a three's release + flight already takes > 1.5 s, so the
    // face log was read on the scoring frame itself and the 0.5 s after it was never recorded
    await waitFor(page, `acc.face.ev.some((e) => e.type === 'score' && e.t >= acc.face.mark && performance.now() - e.t > ${waitMs})`, 900000, `${id} make + ${waitMs} ms`);
    return ev(page, 'acc.face');
  };
  // Jordan generic dunk → tongueOut at SLAM (+ replay)
  let F = await shootAndWait('jordan', { x: 0.6, z: -10.6, shot: { kind: 'dunk', p: 1 } }, 1000);
  const jSlam = F.ev.filter((e) => e.type === 'slam' && e.id === 'jordan').pop();
  if (!jSlam) problems.push('Jordan dunk: no SLAM event'); else { const w = maxIn(F.log, 'jordan', 'tongueOut', jSlam.t - 17, jSlam.t + 34, false); if (!(w >= 0.8)) problems.push(`Jordan tongueOut ${w.toFixed(2)} at SLAM (≥ 0.8)`); }
  await waitFor(page, '!(g.replay && g.replay.active) && acc.face.log.some((r) => r.rep)', 900000, 'Jordan dunk replay played');
  F = await ev(page, 'acc.face');
  { const w = F.log.filter((r) => r.rep).reduce((m, r) => Math.max(m, r.w.jordan.tongueOut || 0), 0); if (!(w >= 0.8)) problems.push(`Jordan tongueOut in the replay ${w.toFixed(2)} (≥ 0.8)`); }
  await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 900000, 'CHECK after the replay');
  // Kobe idle scowl baseline in LIVE
  await run(page, "acc.readyFor('kobe'); acc.face.mark = performance.now(); return true;");
  await waitFrames(page, 90);
  F = await ev(page, 'acc.face');
  { const s = F.log.filter((r) => r.t >= F.mark).map((r) => r.w.kobe.scowl); const m = median(s); if (!(Math.abs(m - 0.35) <= 0.05)) problems.push(`Kobe idle scowl median ${r3(m)} (0.35 ± 0.05)`); }
  // Kobe dunk → jawJut ≤ 0.5 s after the score
  F = await shootAndWait('kobe', { x: 0.6, z: -10.6, shot: { kind: 'dunk', p: 1 } }, 1500);
  { const sc = F.ev.filter((e) => e.type === 'score' && e.t >= F.mark).shift(); const w = sc ? maxIn(F.log, 'kobe', 'jawJut', sc.t, sc.t + 500) : 0; if (!(w >= 0.8)) problems.push(`Kobe jawJut ${w.toFixed(2)} within 0.5 s of the score (≥ 0.8)`); }
  await waitFor(page, "!(g.replay && g.replay.active) && (g.state === 'CHECK' || g.state === 'LIVE')", 900000, 'after the Kobe dunk');
  // LeBron dunk → roar ≤ 0.15 s after SLAM
  F = await shootAndWait('lebron', { x: 0.6, z: -10.6, shot: { kind: 'dunk', p: 1 } }, 1000);
  { const sl = F.ev.filter((e) => e.type === 'slam' && e.id === 'lebron' && e.t >= F.mark).shift(); const w = sl ? maxIn(F.log, 'lebron', 'roar', sl.t, sl.t + 150, false) : 0; if (!(w >= 0.8)) problems.push(`LeBron roar ${w.toFixed(2)} within 0.15 s after SLAM (≥ 0.8)`); }
  await waitFor(page, "!(g.replay && g.replay.active) && (g.state === 'CHECK' || g.state === 'LIVE')", 900000, 'after the LeBron dunk');
  // Kyrie made three → smirk ≥ 0.6 ≤ 0.5 s, roar stays 0
  F = await shootAndWait('kyrie', { x: 0, z: -4.8, shot: { p: 1, eT: 0 } }, 1500);
  { const sc = F.ev.filter((e) => e.type === 'score' && e.t >= F.mark).shift(); const w = sc ? maxIn(F.log, 'kyrie', 'smirk', sc.t, sc.t + 500) : 0; const roar = maxIn(F.log, 'kyrie', 'roar', F.mark, F.mark + 5000); if (!(w >= 0.6)) problems.push(`Kyrie smirk ${w.toFixed(2)} within 0.5 s of the three (≥ 0.6)`); if (roar !== 0) problems.push(`Kyrie roar ${roar.toFixed(2)} (must stay 0)`); }
  // Yao block → roar ≥ 0.8: attempts are simulated synchronously and stop at Yao's block; rendered frames follow
  const yb = await run(page, `
    for (let k = 0; k < 60; k++) {
      acc.ready(); g.setClock({game: 90, shot: 14}); const me = acc.ctrlId(); const tm = acc.teamOf(me);
      acc.players().filter((p) => acc.teamOf(p) !== tm && acc.pid(p) !== 'yao').forEach((p, i) => acc.place(acc.pid(p), i ? 6.8 : -6.8, -1.0));
      acc.place(me, 0.3, -10.4); acc.place('yao', 0.1, -11.3, 0); acc.sim(1 / 60);
      const e0 = acc.evts.length; g.debugShoot({ eT: 0 });
      for (let i = 0; i < 150; i++) { acc.sim(1 / 60); if (acc.since(e0, 'block').some((e) => (e.blockerId || e.playerId) === 'yao')) return { k, t: performance.now() }; if (g.state !== 'LIVE') break; }
    }
    return null;`);
  if (!yb) problems.push('Yao never blocked in 60 attempts; roar not checked');
  else { await waitFrames(page, 60); F = await ev(page, 'acc.face'); const w = maxIn(F.log, 'yao', 'roar', yb.t - 1, yb.t + 1500); if (!(w >= 0.8)) problems.push(`Yao roar ${w.toFixed(2)} after his block (≥ 0.8)`); }
  await clockSet(page, 'real');
  if (problems.length) fail(problems.join('\n    '));
});

item('B61', 'Windup while the broadcast camera eases (sprint to the wing): #meter centre within 3 px of the projected chest–head midpoint + (40, −40) px; custom lineup LeBron + Jordan on one team: indicators 詹 / 乔 (zh), LE / JO (en)', { clock: true, timeoutS: 900, needs: [...BASE_HOOKS, 'characters', 'director.camera'] }, async (t) => {
  requireGame();
  const problems = [];
  {
    const { page } = await t.quick('desktop');
    await run(page, 'acc.ready(); g.setClock({shot: 14}); acc.place(acc.ctrlId(), -1.0, -5.0); return true;');
    await clockSet(page, 'fixed', 1000 / 60);
    await run(page, `
      acc.mt = { n: 0, max: 0, where: null }; const id = acc.ctrlId();
      acc._mtHook = () => {
        const m = g.game.meter; if (!m || !m.active) return;
        const el = document.querySelector('#meter'); const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = el.getBoundingClientRect(); const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        const chest = acc.boneWorld(id, 'spine_03'); const head = acc.headWorld(id);
        const mid = acc.toPx(acc.ndc((chest.x + head.x) / 2, (chest.y + head.y) / 2, (chest.z + head.z) / 2));
        const W = acc.vw().w; const want = { x: mid.x + (mid.x + 40 > W - 80 ? -52 : 40), y: mid.y - 40 };
        const d = Math.hypot(c.x - want.x, c.y - want.y); acc.mt.n++; if (d > acc.mt.max) { acc.mt.max = d; acc.mt.where = { c, want, frame: acc.frames }; }
      };
      acc.frameHooks.push(acc._mtHook); return true;`);
    await page.keyboard.down('d'); await page.keyboard.down('Shift'); await waitFrames(page, 40);
    await page.keyboard.down('Space'); await waitFrames(page, 16); await page.keyboard.up('Shift'); await page.keyboard.up('d');
    await waitFrames(page, 10); await page.keyboard.up('Space'); await waitFrames(page, 4);
    const r = await run(page, 'acc.frameHooks.splice(acc.frameHooks.indexOf(acc._mtHook), 1); return acc.mt;');
    await clockSet(page, 'real');
    if (r.n < 5) problems.push(`meter visible on only ${r.n} frames of the windup`);
    else if (!(r.max <= 3)) problems.push(`#meter centre up to ${r.max.toFixed(1)} px from the projected anchor (> 3 px): ${fmt(r.where)}`);
    t.note(`meter samples ${r.n}, max error ${r.max.toFixed(2)} px`);
    await t.closeAll();
  }
  const want = { zh: { lebron: '詹', jordan: '乔' }, en: { lebron: 'LE', jordan: 'JO' } };
  for (const [lineup, target] of [['lebron,jordan,giannis~kyrie,kobe,yao', 'jordan'], ['jordan,lebron,giannis~kyrie,kobe,yao', 'lebron']]) {
    const { page } = await t.quick('phonePortrait', `${QUICK}&lineup=${lineup}`);
    await clockSet(page, 'fixed', 1000 / 60);
    for (const lang of ['zh', 'en']) {
      await setLang(page, lang);
      const pl = await run(page, `
        acc.ready(); g.setClock({shot: 14}); const me = acc.ctrlId(); acc.place(me, 0, -9.5);
        const out = (p) => Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.98 || p.z > 1;
        for (const [x, z] of [[-7.3, -0.4], [7.3, -0.4], [-7.3, -13.8], [7.3, -13.8]]) { if (out(acc.ndc(x, 0, z)) && out(acc.ndc(x, 2.1, z))) { acc.place(${JSON.stringify(target)}, x, z); acc.frozen = true; return { me, x, z }; } }
        acc.place(${JSON.stringify(target)}, -7.3, -0.4); acc.frozen = true; return { me, x: -7.3, z: -0.4, inside: true };`);
      if (pl.me === target) { problems.push(`${target} is the controlled player; cannot check his indicator`); continue; }
      await waitFrames(page, 60);
      const labels = await page.evaluate(() => ['#offA', '#offB', '#offC'].map((s) => document.querySelector(s)).filter((el) => el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0).map((el) => el.querySelector('.num').textContent.trim()));
      await ev(page, 'acc.frozen = false');
      if (pl.inside) t.warn(`[${lang}] no court spot projects fully off-screen for ${target}; placed at (${pl.x}, ${pl.z})`);
      if (!labels.includes(want[lang][target])) problems.push(`[${lang}] off-screen indicator for ${target} shows ${fmt(labels)} (expected "${want[lang][target]}", not "23")`);
      if (labels.includes('23')) problems.push(`[${lang}] an indicator shows "23" with LeBron and Jordan on one team`);
    }
    await clockSet(page, 'real');
    await t.closeAll();
  }
  if (problems.length) fail(problems.join('\n    '));
});

// ================================================================================================ RUNNER
function withTimeout(p, ms, label) { let h; const tm = new Promise((_, rej) => { h = setTimeout(() => rej(new Error(`item timeout after ${ms / 1000} s (${label})`)), ms); }); return Promise.race([p, tm]).finally(() => clearTimeout(h)); }
/** Expands CLI ids and ranges (B5, b30-b33) into a list of item ids. */
function parseFilter(args) {
  const out = [];
  for (const a of args) {
    const r = /^B(\d+)-B?(\d+)$/i.exec(a); const s = /^B(\d+)$/i.exec(a);
    if (r) for (let i = +r[1]; i <= +r[2]; i++) out.push('B' + i); else if (s) out.push('B' + +s[1]);
    else if (!a.startsWith('--')) { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  return out;
}
async function main() {
  const FILTER = parseFilter(argv);
  const unknown = FILTER.filter((f) => !ITEMS.some((i) => i.id === f));
  if (unknown.length) { console.error(`unknown item(s): ${unknown.join(', ')}`); process.exit(2); }
  if (LIST_ONLY) {
    for (const it of ITEMS) console.log(`${it.id.padEnd(4)} ${it.kind.padEnd(7)} ${it.clock ? 'clock ' : '      '}${it.title}${it.needs.length ? `\n       hooks: ${it.needs.join(', ')}` : ''}${it.staticPart ? '\n       (has a static part run by --static)' : ''}`);
    return;
  }
  let selected = FILTER.length ? ITEMS.filter((i) => FILTER.includes(i.id)) : ITEMS;
  if (STATIC_ONLY) selected = selected.filter((i) => i.kind === 'static' || i.staticPart);
  const needsBrowser = !STATIC_ONLY && selected.some((i) => i.kind !== 'static');
  const srv = needsBrowser ? await H.startServer(ROOT) : null;
  let browser = null;
  const getBrowser = async () => { if (!browser || !browser.isConnected()) browser = await H.launchBrowser({ headless: !HEADED }); return browser; };
  const results = []; let passed = 0, failed = 0, skippedN = 0;
  console.log(`LEGENDS 3v3 acceptance v2 — ${selected.length} item(s)${STATIC_ONLY ? ' (static checks only)' : ''}${srv ? ` — serving ${ROOT} at ${srv.url}` : ''}`);
  for (const it of selected) {
    const handles = []; const warnings = []; const notes = [];
    const t = {
      server: srv,
      warn: (m) => warnings.push(String(m)),
      note: (m) => notes.push(String(m)),
      /** New context + page for a device; `page` is a path relative to the game folder or an absolute URL. */
      open: async (device, page = 'index.html', opts = {}) => {
        const init = [].concat(it.clock ? [CLOCK_INIT] : [], opts.init ? [].concat(opts.init) : []);
        const gm = await H.openGame({ device, url: srv.url, page, browser: await getBrowser(), init, navigate: opts.navigate !== false, context: opts.context });
        handles.push(gm); return gm;
      },
      /** open + helper library (waits for window.__game). */
      boot: async (device, query = '', opts = {}) => { const gm = await t.open(device, 'index.html' + query, opts); await installHelpers(gm.page); return gm; },
      /** boot + §9.1 startGame (快速比赛 → legendsReady → CHECK/LIVE) + required hooks. */
      quick: async (device, query = QUICK, opts = {}) => {
        const gm = await t.boot(device, query, opts);
        const r = await H.startGame(gm.page);
        await installHelpers(gm.page); await needHooks(gm.page, it.needs);
        gm.start = r; return gm;
      },
      closeAll: async () => { while (handles.length) { const h = handles.pop(); await h.close().catch(() => {}); } },
    };
    const t0 = Date.now(); let ok = true, error = null, skipped = null;
    const runIt = STATIC_ONLY && it.kind !== 'static' ? () => it.staticPart(t) : () => it.run(t, it);
    const ms = TIMEOUT_OVERRIDE || it.timeoutS * 1000;
    try { await withTimeout(runIt(), ms, it.id); }
    catch (e) { if (e instanceof Skip) skipped = e.message; else { ok = false; error = e instanceof Fail ? e.message : `${e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e}`; } }
    finally { await t.closeAll(); }
    const dt = Date.now() - t0;
    if (skipped) skippedN++; else if (ok) passed++; else failed++;
    const label = STATIC_ONLY && it.kind !== 'static' ? `${it.id} (static part)` : it.id;
    results.push({ id: it.id, label, title: it.title, kind: it.kind, ok: ok && !skipped, skipped, ms: dt, error, warnings, notes, hooks: it.needs });
    console.log(`${skipped ? '⏭' : ok ? '✅' : '❌'} ${label.padEnd(STATIC_ONLY ? 18 : 4)} ${it.title}  (${(dt / 1000).toFixed(1)} s)`);
    for (const n of notes) console.log(`   · ${n}`);
    for (const w of warnings) console.log(`   ⚠ ${w}`);
    if (skipped) console.log(`   ⏭ ${skipped}`);
    if (error) console.log(`   ✗ ${error}`);
    if (!ok && BAIL) break;
  }
  if (browser) await browser.close().catch(() => {});
  if (srv) await srv.close();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const out = path.join(RESULTS_DIR, STATIC_ONLY ? 'acceptance-static.json' : 'acceptance.json');
  fs.writeFileSync(out, JSON.stringify({ passed, failed, skipped: skippedN, total: results.length, mode: STATIC_ONLY ? 'static' : 'full', ranAt: new Date().toISOString(), items: results }, null, 2));
  console.log(`\n${passed} passed, ${failed} failed${skippedN ? `, ${skippedN} skipped` : ''} → ${path.relative(process.cwd(), out)}`);
  process.exitCode = failed ? 1 : 0;
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(2); });

module.exports = { ITEMS, SPEC, EVENTS, DENYLIST, denyRe, maskJs, topLevelAwait, importSpecifiers, vendorSpecFor, decodePng, kitBoxStats, figures, diffFraction, lumaFraction, hsv, CLOCK_INIT, PAGE_SRC };
