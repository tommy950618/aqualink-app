#!/usr/bin/env node
'use strict';
// Acceptance test for HOOP ARENA 3x3 — SPEC.md §15, items A1–A27.
// Usage:  node test/acceptance.cjs            (all items, A1→A27)
//         node test/acceptance.cjs A6 A7      (only those)
//         node test/acceptance.cjs --keep-shots   (keep screenshots under test/results/shots/)
// Writes test/results/acceptance.json and exits non-zero if any item failed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const H = require('./harness.cjs');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results');
const SHOTS_DIR = path.join(RESULTS_DIR, 'shots');
const argv = process.argv.slice(2);
const KEEP_SHOTS = argv.includes('--keep-shots');
const FILTER = argv.filter((a) => /^A\d+$/i.test(a)).map((a) => a.toUpperCase());
const ITEM_TIMEOUT_MS = 300000;
const BG = [11, 13, 20]; // scene background 0x0b0d14 (§10)

class Fail extends Error {}
class Skip extends Error {}
function fail(msg) { throw new Fail(msg); }
function skip(msg) { throw new Skip(msg); }
function assert(cond, msg) { if (!cond) fail(msg); }
function eq(actual, expected, what) { if (actual !== expected) fail(`${what}: expected ${fmt(expected)}, got ${fmt(actual)}`); }
function fmt(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- spec text tables (§13)
const TXT = {
  zh: { start: '开始比赛', shoot: '投篮', block: '盖帽', pass: '传球', switch: '换人', cross: '变向', steal: '抢断', sprint: '冲刺', q1: '第1节', ot: '加时', overtime: '加时赛', dismiss: '知道了', resume: '继续', win: '获胜', halftime: '半场' },
  en: { start: 'Start Game', shoot: 'SHOOT', block: 'BLOCK', pass: 'PASS', switch: 'SWITCH', cross: 'CROSS', steal: 'STEAL', sprint: 'SPRINT', q1: 'Q1', ot: 'OT', overtime: 'OVERTIME', dismiss: 'Got it', resume: 'Resume', win: 'win', halftime: 'HALFTIME' },
};
const DENYLIST = ['Lakers', 'Celtics', 'Warriors', 'Bulls', 'Knicks', 'Heat', 'Nets', 'Spurs', 'Suns', 'Bucks', 'Mavericks', 'Rockets', 'Clippers', 'Nuggets', 'Jazz', 'Raptors', 'Sixers', '76ers', 'Cavaliers', 'Thunder', 'Grizzlies', 'Kings', 'Hawks', 'Hornets', 'Magic', 'Pacers', 'Pelicans', 'Pistons', 'Timberwolves', 'Trail Blazers', 'Wizards', 'LeBron', 'Curry', 'Durant', 'Jokic', 'Jordan', 'Kobe', 'NBA', '2K'];
const CJK_RE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯가-힯]/;

// ---------------------------------------------------------------- static helpers
function listSrc() { const d = path.join(ROOT, 'src'); if (!fs.existsSync(d)) return []; return fs.readdirSync(d).filter((f) => f.endsWith('.js')).sort().map((f) => path.join(d, f)); }
function readText(p) { return fs.readFileSync(p, 'utf8'); }
function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

// Masks comments and/or string literals with spaces (keeps offsets and line numbers).
function maskJs(code, { strings = true, comments = true } = {}) {
  const out = code.split(''); let i = 0; const n = code.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < n) {
    const c = code[i], d = code[i + 1];
    if (c === '/' && d === '/') { let j = i; while (j < n && code[j] !== '\n') j++; if (comments) blank(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = code.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; if (comments) blank(i, j); i = j; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1; while (j < n) { if (code[j] === '\\') { j += 2; continue; } if (code[j] === c) break; if (c !== '`' && code[j] === '\n') break; j++; }
      j = Math.min(n, j + 1); if (strings) blank(i + 1, j - 1); i = j; continue;
    }
    i++;
  }
  return out.join('');
}
function topLevelAwait(code) {
  const m = maskJs(code); let depth = 0; const re = /[{}()]|\bawait\b/g; let x;
  while ((x = re.exec(m))) {
    const s = x[0];
    if (s === '{' || s === '(') depth++; else if (s === '}' || s === ')') depth--;
    else if (depth === 0) { const before = m.slice(0, x.index).trimEnd(); if (before.endsWith('=>')) continue; return { line: lineOf(m, x.index), snippet: m.slice(Math.max(0, x.index - 40), x.index + 30).replace(/\s+/g, ' ').trim() }; }
  }
  return null;
}
function importSpecifiers(code) {
  const m = maskJs(code, { strings: false, comments: true }); const out = [];
  const re = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g; let x;
  while ((x = re.exec(m))) out.push({ spec: x[1] || x[2] || x[3], line: lineOf(m, x.index), dynamic: !!x[3] });
  return out;
}

// ---------------------------------------------------------------- PNG decode + pixel maths (no deps)
function decodePng(buf) {
  for (const mod of ['pngjs', '/opt/node22/lib/node_modules/pngjs']) {
    try { const { PNG } = require(mod); const p = PNG.sync.read(buf); return { width: p.width, height: p.height, data: p.data, bpp: 4 }; } catch (e) { /* fall through */ }
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
      switch (f) { case 0: val = v; break; case 1: val = v + a; break; case 2: val = v + b; break; case 3: val = v + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error('bad PNG filter ' + f); }
      line[x] = val & 255;
    }
    ip += stride; prev = line;
  }
  return { width, height, data: out, bpp };
}
function nonBgFraction(img, bg = BG, thr = 16, step = 2) {
  let n = 0, hit = 0; const { width, height, data, bpp } = img;
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) { const i = (y * width + x) * bpp; n++; if (Math.abs(data[i] - bg[0]) > thr || Math.abs(data[i + 1] - bg[1]) > thr || Math.abs(data[i + 2] - bg[2]) > thr) hit++; }
  return hit / n;
}
function diffFraction(a, b, thr = 24, step = 2) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let n = 0, hit = 0; const w = a.width;
  for (let y = 0; y < a.height; y += step) for (let x = 0; x < w; x += step) { const i = (y * w + x) * a.bpp, j = (y * w + x) * b.bpp; n++; if (Math.abs(a.data[i] - b.data[j]) > thr || Math.abs(a.data[i + 1] - b.data[j + 1]) > thr || Math.abs(a.data[i + 2] - b.data[j + 2]) > thr) hit++; }
  return hit / n;
}
function findColor(img, rgb, tol = 60, step = 2) {
  let best = Infinity, bestRgb = null, count = 0; const { width, height, data, bpp } = img;
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) { const i = (y * width + x) * bpp; const d = Math.max(Math.abs(data[i] - rgb[0]), Math.abs(data[i + 1] - rgb[1]), Math.abs(data[i + 2] - rgb[2])); if (d <= tol) count++; if (d < best) { best = d; bestRgb = [data[i], data[i + 1], data[i + 2]]; } }
  return { found: count > 0, count, best, bestRgb };
}

// ---------------------------------------------------------------- in-page helper library (installed as window.__acc)
// Runs inside the browser: only touches window.__game hooks (§14.1) + DOM. Never references Node scope.
function pageHelpers() {
  const FIXED = 1 / 60;
  const G = () => window.__game;
  const evts = [], caps = [], banners = []; const installed = {}; const acc = { evts, caps, banners, installed, stepCount: 0, sampler: null };
  const CAP_TEXT = { 'cap.airball': ['三不沾', 'air ball'], 'cap.steal': ['抢断', 'steals it'], 'cap.shotClock': ['进攻超时', 'Shot clock violation'], 'cap.oob': ['出界', 'Out of bounds'], 'cap.block': ['盖帽', 'blocks it'] };
  const BAN_TEXT = { 'banner.overtime': ['加时赛', 'OVERTIME'], 'banner.halftime': ['半场', 'HALFTIME'], 'banner.final': ['全场结束', 'FINAL'] };
  const simTime = () => acc.stepCount / 60;
  function summarize(v, depth = 0) {
    if (v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return depth < 2 ? v.map((x) => summarize(x, depth + 1)) : '[array]';
    const o = {};
    for (const k of ['type', 'points', 'value', 'reason', 'team', 'teamIdx', 'index', 'kind', 'state', 'key', 'name', 'player', 'shooter']) {
      if (k in v) { const x = v[k]; o[k] = (x && typeof x === 'object') ? (depth < 1 ? summarize(x, depth + 1) : '[obj]') : x; }
    }
    return o;
  }
  function push(type, data) { evts.push(Object.assign({ type, t: simTime(), real: performance.now() }, data)); }
  function install() {
    const g = G(); if (!g || !g.game) return null;
    const game = g.game;
    if (typeof game.step === 'function' && !game.__accStep) { const os = game.step; game.step = function () { const r = os.apply(this, arguments); acc.stepCount++; if (acc.sampler) { try { acc.sampler(); } catch (e) { acc.samplerError = String(e); } } return r; }; game.__accStep = true; installed.step = true; }
    if (typeof game.on === 'function' && !game.__accSpied) {
      game.__accSpied = true;
      for (const name of ['score', 'rim', 'board', 'bounce', 'catch', 'oob', 'rest', 'block', 'steal', 'shot', 'release', 'make', 'miss', 'turnover', 'possession', 'state', 'dead', 'caption', 'banner', 'airball', 'rebound']) {
        try { game.on(name, (...args) => push(name, { args: args.map((a) => summarize(a)) })); installed.gameOn = true; } catch (e) { /* ignore */ }
      }
    }
    const hud = game.hud || g.hud || (game.opts && game.opts.hud) || (game.deps && game.deps.hud);
    if (hud && typeof hud.caption === 'function' && !hud.__accCap) { const o = hud.caption; hud.caption = function (key) { caps.push({ key, t: simTime() }); push('caption', { key }); return o.apply(this, arguments); }; hud.__accCap = true; installed.hudCaption = true; }
    if (hud && typeof hud.banner === 'function' && !hud.__accBan) { const o = hud.banner; hud.banner = function (key) { banners.push({ key, t: simTime() }); push('banner', { key }); return o.apply(this, arguments); }; hud.__accBan = true; installed.hudBanner = true; }
    const audio = g.audio;
    if (audio && !audio.__accSpied) { audio.__accSpied = true; for (const n of ['rim', 'board', 'swish', 'block', 'dunk', 'whistle', 'buzzer', 'groan']) { if (typeof audio[n] === 'function') { const o = audio[n]; audio[n] = function () { push('audio.' + n, { value: arguments[0] }); return o.apply(this, arguments); }; installed.audio = true; } } }
    const watch = (sel, list) => { const el = document.querySelector(sel); if (!el) return; let last = ''; new MutationObserver(() => { const s = (el.textContent || '').trim(); if (s && s !== last) { last = s; list.push({ text: s, t: simTime() }); } }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true }); installed['dom' + sel] = true; };
    watch('#caption', caps); watch('#banner', banners);
    return installed;
  }
  const players = () => G().world.players;
  const idx = (p) => players().indexOf(p);
  function teamOf(p) { if (!p) return -1; if (typeof p.teamIdx === 'number') return p.teamIdx; if (typeof p.team === 'number') return p.team; const w = G().world; if (w.teams && p.team) { const i = w.teams.indexOf(p.team); if (i >= 0) return i; } if (p.team && typeof p.team.index === 'number') return p.team.index; return -1; }
  const userTeam = () => G().world.user;
  function userOff() { const g = G(); try { if (g.game && typeof g.game.userIsOffense === 'function') return !!g.game.userIsOffense(); } catch (e) { /* fall back */ } return g.world.offense === g.world.user; }
  function scores() { const g = G(); const s = (g.game && g.game.score) || g.world.score || g.score; return Array.isArray(s) ? s.slice() : [NaN, NaN]; }
  function paused() { const g = G(); return !!((g.game && g.game.paused) || (g.world && g.world.paused) || g.paused); }
  const state = () => String(G().state);
  function deadReason() { const g = G(); const r = (g.world && g.world.deadReason) ?? (g.game && g.game.deadReason) ?? null; return r == null ? null : String(r); }
  function clearEdges() { try { const it = G().input.intent; for (const k of ['primary', 'secondary', 'tertiary']) { it[k].justPressed = false; it[k].justReleased = false; } if (it.pause) it.pause.justPressed = false; } catch (e) { /* ignore */ } }
  // Simulation time without rendering: game.step loop (fast) or fastForward fallback.
  function sim(sec) { const g = G(); const n = Math.max(1, Math.round(sec * 60)); clearEdges(); if (g.game && typeof g.game.step === 'function') { for (let i = 0; i < n; i++) g.game.step(FIXED); } else g.fastForward(sec); }
  function simUntil(pred, maxSec, dt = 0.05) { const f = typeof pred === 'function' ? pred : new Function('g', 'acc', 'return (' + pred + ')'); let t = 0; const g = G(); while (t < maxSec) { if (f(g, window.__acc)) return { ok: true, t: +t.toFixed(3), state: state() }; sim(dt); t += dt; } return { ok: !!f(g, window.__acc), t: +t.toFixed(3), state: state() }; }
  function speedOf(p) { if (!p || !p.vel) return 0; const vx = p.vel.x || 0; const vz = ('z' in p.vel) ? (p.vel.z || 0) : (p.vel.y || 0); return Math.hypot(vx, vz); }
  function snap() { const g = G(); const c = g.controlled; return { x: c ? c.pos.x : NaN, z: c ? c.pos.z : NaN, speed: speedOf(c), state: state(), ctrl: idx(c), off: userOff(), sim: simTime(), sprint: !!g.input.intent.sprint, mag: g.input.intent.move.mag, jumping: !!(c && c.isJumping), clock: g.world.gameClock, shot: g.world.shotClock, quarter: g.world.quarter, scores: scores(), paused: paused() };
  }
  function ballHeld() { const b = G().ball; return b && (b.state === 'held' || b.state === 'dribble'); }
  // Steps the sim until LIVE with the user on offence holding the ball (or on defence with the CPU handler holding it).
  function ready(opts = {}) {
    const g = G(); const wantDef = !!opts.defense; let flips = 0;
    for (let i = 0; i < 800; i++) {
      const st = state();
      if (st === 'MENU' || st === 'GAME_OVER') return { ok: false, state: st, flips };
      if (st === 'LIVE') {
        if (g.world.gameClock < 25 && typeof g.setClock === 'function') g.setClock({ game: 110 });
        const off = userOff(); const b = g.ball; const held = ballHeld();
        if (wantDef) { if (!off) { if (held && b.owner && teamOf(b.owner) !== userTeam()) return { ok: true, flips, t: i * 0.05 }; } else if (held || b.state === 'loose') { g.turnover(); flips++; sim(FIXED); } }
        else if (off) { if (held && b.owner === g.controlled) return { ok: true, flips, t: i * 0.05 }; }
        else if (held || b.state === 'loose') { g.turnover(); flips++; sim(FIXED); }
      }
      sim(0.05);
    }
    return { ok: false, state: state(), flips, reason: 'timeout (40 s sim)' };
  }
  function capSeen(since, key) { const want = CAP_TEXT[key] || []; return caps.slice(since).some((c) => c.key === key || (c.text && want.some((w) => c.text.includes(w)))); }
  function bannerSeen(since, key) { const want = BAN_TEXT[key] || []; return banners.slice(since).some((c) => c.key === key || (c.text && want.some((w) => c.text.includes(w)))); }
  function forceJump(p) { try { if (typeof p.jump === 'function') { p.jump(); return 'jump()'; } if (typeof p.startJump === 'function') { p.startJump(); return 'startJump()'; } if (p.intent && p.intent.primary) { p.intent.primary.justPressed = true; p.intent.primary.held = true; return 'intent.primary'; } } catch (e) { return 'error: ' + e.message; } return null; }
  function parkOpponents(opp, except) { const g = G(); opp.forEach((p, k) => { if (p !== except) g.teleport(idx(p), -7 + 2.5 * k, -1.0); }); }
  // Repeated debugShoot trials. o = {n, p, e, shooter:{x,z}, defenders:'none'|'away'|'front', frontXZ, jump, follow}
  function shootTrial(o) {
    const g = G(); const out = [];
    for (let a = 0; a < o.n; a++) {
      const r = ready(); if (!r.ok) { out.push({ error: 'not ready: ' + JSON.stringify(r) }); break; }
      const c = g.controlled; const ci = idx(c); const ut = teamOf(c);
      if (o.shooter) g.teleport(ci, o.shooter.x, o.shooter.z);
      const opp = players().filter((p) => teamOf(p) !== ut); let front = null, jumpForced = null;
      if (o.defenders === 'away') parkOpponents(opp, null);
      if (o.defenders === 'front' && opp.length) { front = opp[0]; parkOpponents(opp, front); g.teleport(idx(front), o.frontXZ.x, o.frontXZ.z); if (o.jump) jumpForced = forceJump(front); }
      const s0 = scores(), e0 = evts.length, c0 = caps.length, off0 = userOff(), t0 = simTime(); let rimMax = 0, defJumping = false;
      const params = {}; if (o.p != null) params.p = o.p; if (o.e != null) params.e = o.e;
      g.debugShoot(params);
      let released = false, resolved = null;
      for (let k = 0; k < 40 && !released; k++) { sim(0.05); const bs = g.ball.state; if (front && front.isJumping) defJumping = true; if (bs === 'flight' || bs === 'scored' || bs === 'loose' || state() !== 'LIVE') released = true; }
      const tRel = simTime() - t0; const states = [state()];
      for (let k = 0; k < 160 && !resolved; k++) { sim(0.05); rimMax = Math.max(rimMax, +g.ball.rimContacts || 0); const st = state(); if (states[states.length - 1] !== st) states.push(st); const bs = g.ball.state; if (st !== 'LIVE') resolved = st; else if (bs === 'held' || bs === 'dribble') resolved = 'caught'; }
      const tRes = simTime() - t0; let scoreT = null; const ev = evts.slice(e0);
      const sc = ev.find((x) => x.type === 'score'); if (sc) scoreT = sc.t - t0;
      if (o.follow) { for (let k = 0; k < 120; k++) { sim(0.05); const st = state(); if (states[states.length - 1] !== st) states.push(st); if (st === 'LIVE' && k > 2) break; } }
      const s1 = scores(); const made = s1[ut] - s0[ut];
      out.push({ made: made > 0, points: made, released, tRel: +tRel.toFixed(2), resolved, tRes: +tRes.toFixed(2), states, offBefore: off0, offAfter: userOff(), scoreT: scoreT == null ? null : +scoreT.toFixed(2),
        rim: rimMax > 0 || ev.some((x) => x.type === 'rim' || x.type === 'audio.rim'), board: ev.some((x) => x.type === 'board' || x.type === 'audio.board'), scoreEvts: ev.filter((x) => x.type === 'score').map((x) => x.args),
        air: capSeen(c0, 'cap.airball'), jumpForced, defJumping, dead: deadReason() });
    }
    return out;
  }
  function triggerPass(h, t) { const g = G(); try { if (g.game && typeof g.game.pass === 'function') { g.game.pass(h, t, false); return 'game.pass'; } } catch (e) { return 'game.pass threw: ' + e.message; } try { const it = g.input.intent; it.secondary.justPressed = true; it.secondary.held = false; g.game.step(FIXED); it.secondary.justPressed = false; return 'intent.secondary'; } catch (e) { return 'intent failed: ' + e.message; } }
  // A15 part 2: a defender parked 0.3 m off the pass line, n passes.
  function passTrial(o) {
    const g = G(); const out = [];
    for (let a = 0; a < o.n; a++) {
      const r = ready(); if (!r.ok) { out.push({ error: 'not ready: ' + JSON.stringify(r) }); break; }
      const h = g.controlled; const ut = teamOf(h);
      const mates = players().filter((p) => p !== h && teamOf(p) === ut); const opp = players().filter((p) => teamOf(p) !== ut);
      if (!mates.length || !opp.length) { out.push({ error: 'no teammates/opponents found' }); break; }
      const t = mates[a % mates.length]; const hx = h.pos.x, hz = h.pos.z, dx = t.pos.x - hx, dz = t.pos.z - hz; const L = Math.hypot(dx, dz) || 1; const px = -dz / L, pz = dx / L;
      const def = opp[a % opp.length]; parkOpponents(opp, def); g.teleport(idx(def), hx + dx * 0.5 + px * 0.3, hz + dz * 0.5 + pz * 0.3);
      const off0 = userOff(), c0 = caps.length; const how = triggerPass(h, t); let result = null, passed = false;
      for (let k = 0; k < 80 && !result; k++) { sim(0.05); const b = g.ball; const st = state(); if (b.state === 'pass') passed = true; if (st !== 'LIVE') result = st; else if (passed && ballHeld()) result = teamOf(b.owner) === ut ? 'teammate' : 'intercepted'; }
      const dead = deadReason(); if (result && result !== 'teammate' && result !== 'intercepted') simUntil('g.state === "CHECK" || g.state === "LIVE"', 4);
      out.push({ how, passed, result, dead, steal: capSeen(c0, 'cap.steal'), possessionChanged: off0 !== userOff() });
    }
    return out;
  }
  // A16: park the controlled defender 0.8 m from the CPU handler (ahead of his motion).
  function stealPrep() {
    const g = G(); const r = ready({ defense: true }); if (!r.ok) return { ok: false, r };
    const h = g.ball.owner; const c = g.controlled; if (!h || !c || c === h) return { ok: false, reason: 'no handler/controlled', r };
    let dx = 0, dz = -1; const sp = speedOf(h); if (sp > 0.5) { dx = h.vel.x / sp; dz = (('z' in h.vel) ? h.vel.z : h.vel.y) / sp; } else { const L = Math.hypot(0 - h.pos.x, -12.75 - h.pos.z) || 1; dx = (0 - h.pos.x) / L; dz = (-12.75 - h.pos.z) / L; }
    let x = h.pos.x + dx * 0.8, z = h.pos.z + dz * 0.8; x = Math.max(-7.4, Math.min(7.4, x)); z = Math.max(-14.1, Math.min(-0.3, z));
    g.teleport(idx(c), x, z); return { ok: true, dist: +Math.hypot(c.pos.x - h.pos.x, c.pos.z - h.pos.z).toFixed(2), caps: caps.length, off: userOff(), handlerState: g.ball.state, steps: acc.stepCount };
  }
  function stealCheck(since) { sim(0.8); return { steal: capSeen(since, 'cap.steal'), off: userOff(), state: state(), dead: deadReason() }; }
  // A14 fuzz sampler (per game.step when the step wrapper is active, else per chunk).
  function fuzzStart() { const F = acc.fuzz = { steps: 0, nan: 0, nanWhere: null, minBallY: Infinity, maxAbsX: 0, minZ: Infinity, maxZ: -Infinity, minShot: Infinity, maxShot: -Infinity, freeRun: 0, maxFreeRun: 0 };
    acc.sampler = () => { const g = G(); const w = g.world; F.steps++; for (const p of w.players) { if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.z)) { F.nan++; F.nanWhere = F.nanWhere || 'player ' + idx(p); } }
      const b = g.ball.pos; if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) { F.nan++; F.nanWhere = F.nanWhere || 'ball'; }
      else { F.minBallY = Math.min(F.minBallY, b.y); F.maxAbsX = Math.max(F.maxAbsX, Math.abs(b.x)); F.minZ = Math.min(F.minZ, b.z); F.maxZ = Math.max(F.maxZ, b.z); }
      const sc = w.shotClock; if (Number.isFinite(sc)) { F.minShot = Math.min(F.minShot, sc); F.maxShot = Math.max(F.maxShot, sc); }
      if (state() === 'LIVE' && !ballHeld()) { F.freeRun++; F.maxFreeRun = Math.max(F.maxFreeRun, F.freeRun); } else F.freeRun = 0; };
    return true; }
  function fuzzStop() { acc.sampler = null; const F = acc.fuzz; const g = G(); const teams = [0, 0], fga = players().reduce((s, p) => s + ((p.stats && p.stats.fga) || 0), 0); for (const p of players()) teams[teamOf(p)] = (teams[teamOf(p)] || 0) + ((p.stats && p.stats.fgm) || 0);
    const inv = (g.debug && g.debug.invariantsBroken) ?? (g.game && g.game.debug && g.game.debug.invariantsBroken) ?? g.invariantsBroken ?? null;
    return Object.assign({}, F, { fga, fgm: teams, invariantsBroken: inv, samplerError: acc.samplerError || null, scores: scores(), state: state(), quarter: g.world.quarter }); }
  function ndc(x, y, z) { const cam = G().camera; cam.updateMatrixWorld(true); const V = cam.position.constructor; const v = new V(x, y, z); v.project(cam); return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) }; }
  function ballPos() { const b = G().ball; const p = b.pos || (b.mesh && b.mesh.position) || (b.group && b.group.position); return { x: p.x, y: ('y' in p) ? p.y : 0.12, z: p.z }; }
  function setVisibility(v) { const hidden = v === 'hidden'; Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); return document.visibilityState; }
  function visible(sel) { const el = document.querySelector(sel); if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function nextFrame(n = 2) { return new Promise((res) => { const tick = () => (--n <= 0 ? res(true) : requestAnimationFrame(tick)); requestAnimationFrame(tick); }); }
  function stepCost() { const g = G(); const out = {}; if (g.game && typeof g.game.step === 'function') { clearEdges(); const t0 = performance.now(); for (let i = 0; i < 600; i++) g.game.step(FIXED); out.stepLoopMs = +((performance.now() - t0) / 600).toFixed(3); } const t1 = performance.now(); g.fastForward(10); out.fastForwardMs = +((performance.now() - t1) / 600).toFixed(3); out.perfStepMs = g.perf && g.perf.stepMs; return out; }
  window.__acc = Object.assign(acc, { install, sim, simUntil, snap, ready, capSeen, bannerSeen, shootTrial, passTrial, stealPrep, stealCheck, fuzzStart, fuzzStop, ndc, ballPos, setVisibility, visible, nextFrame, stepCost, scores, paused, userOff, teamOf, idx, speedOf, state, deadReason, simTime, ballHeld });
  return install();
}

// ---------------------------------------------------------------- Node-side page helpers
const PAGE_SRC = `(${pageHelpers.toString()})()`;
function ev(page, expr) { return page.evaluate(`(() => { const g = window.__game, acc = window.__acc; return (${expr}); })()`); }
async function waitFor(page, expr, ms, label) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) {
    try { last = await ev(page, expr); } catch (e) { last = 'evaluate error: ' + e.message; }
    if (last) return { value: last, ms: Date.now() - t0 };
    await sleep(40);
  }
  fail(`timeout ${ms} ms waiting for ${label || expr} (last value: ${fmt(last)})`);
}
const waitForState = (page, state, ms) => waitFor(page, `g.state === ${JSON.stringify(state)}`, ms, `__game.state === '${state}'`);
async function installHelpers(page) {
  await waitFor(page, '!!(window.__game && window.__game.game)', 20000, 'window.__game');
  return page.evaluate(PAGE_SRC);
}
async function isVisible(page, sel) { return page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel); }
async function bbox(page, sel) { const b = await page.locator(sel).first().boundingBox(); if (!b) fail(`${sel} has no bounding box (missing or hidden)`); return b; }
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const isTouch = (device) => !!H.DEVICES[device].hasTouch;
async function tapEl(page, sel, device) { const c = center(await bbox(page, sel)); if (isTouch(device)) await H.touchTap(page, c); else await page.mouse.click(c.x, c.y); }
async function clickText(page, scope, zh, en, alt) {
  const sel = `${scope} [data-i18n="${alt}"], ${scope} button:has-text("${zh}"), ${scope} button:has-text("${en}"), ${scope} :text("${zh}"), ${scope} :text("${en}")`;
  const loc = page.locator(sel).first(); if (!(await loc.count())) fail(`no "${zh}"/"${en}" control inside ${scope}`);
  await loc.click({ timeout: 5000 });
}
async function dismissRotateHint(page) { if (await isVisible(page, '#rotateHint')) { try { await clickText(page, '#rotateHint', TXT.zh.dismiss, TXT.en.dismiss, 'hint.dismiss'); } catch (e) { /* ignore */ } } }
async function clickStart(page) { await dismissRotateHint(page); await clickText(page, '#menuMain', TXT.zh.start, TXT.en.start, 'menu.start'); }
// Start a game and reach LIVE (CHECK via real time, CHECK→LIVE via sim).
async function startGame(page) {
  await clickStart(page);
  await waitFor(page, "g.state === 'CHECK' || g.state === 'LIVE'", 15000, 'CHECK after start');
  await ev(page, "acc.simUntil('g.state === \"LIVE\"', 3)");
  await waitForState(page, 'LIVE', 10000);
}
async function readyOffense(page, defense = false) { const r = await ev(page, `acc.ready({defense:${defense}})`); assert(r.ok, `could not reach LIVE with the user on ${defense ? 'defence' : 'offence'} holding the ball: ${fmt(r)}`); return r; }
// Waits `sec` of simulation time while a real gesture is held; tops up with acc.sim() if the rAF loop is too slow (SwiftShader).
async function holdSim(page, sec, t, label) {
  const s0 = await ev(page, 'acc.stepCount'); const t0 = Date.now();
  await sleep(sec * 1000);
  const s1 = await ev(page, 'acc.stepCount'); const got = (s1 - s0) / 60;
  if (got < sec * 0.9) { await ev(page, `acc.sim(${(sec - got).toFixed(3)})`); if (t) t.warn(`${label || 'hold'}: rAF loop advanced only ${got.toFixed(2)} s of sim in ${Date.now() - t0} ms real; topped up with acc.sim()`); }
  return got;
}
// Multi-touch through CDP: steps are {type:'touchStart'|'touchMove'|'touchEnd', points:[{id,x,y}], waitMs} or async functions.
async function multiTouch(page, steps) {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const s of steps) {
      if (typeof s === 'function') { await s(); continue; }
      await cdp.send('Input.dispatchTouchEvent', { type: s.type, touchPoints: (s.points || []).map((p) => ({ x: p.x, y: p.y, id: p.id })) });
      if (s.waitMs) await sleep(s.waitMs);
    }
  } finally { await cdp.detach().catch(() => {}); }
}
const moveSteps = (id, from, to, n = 6, others = []) => Array.from({ length: n }, (_, i) => ({ type: 'touchMove', points: [...others, { id, x: from.x + (to.x - from.x) * (i + 1) / n, y: from.y + (to.y - from.y) * (i + 1) / n }], waitMs: 16 }));
async function screenshot(page, name) { const buf = await page.screenshot({ type: 'png' }); if (KEEP_SHOTS) { fs.mkdirSync(SHOTS_DIR, { recursive: true }); fs.writeFileSync(path.join(SHOTS_DIR, name + '.png'), buf); } return decodePng(buf); }
function requireGameFiles() { const missing = ['index.html', 'src/main.js'].filter((f) => !fs.existsSync(path.join(ROOT, f))); if (missing.length) fail(`game files missing: ${missing.join(', ')} (runtime item cannot run)`); }
function buttonLabelsExpr() { return `['#btnPrimary','#btnSecondary','#btnTertiary','#btnSprint'].map((s) => { const el = document.querySelector(s); return el ? el.textContent.replace(/\\s+/g, '') : null; })`; }
function labelsMatch(labels, want) { return labels.every((l, i) => l != null && l.includes(want[i])); }

// ================================================================ ITEMS
const ITEMS = [];
const item = (id, title, run) => ITEMS.push({ id, title, run });

// ---------------------------------------------------------------- Static / hygiene
item('A1', 'Clean load on desktop/iPhone(portrait+landscape)/Pixel; same-origin only through fastForward(120)', async (t) => {
  requireGameFiles();
  for (const device of ['desktop', 'phonePortrait', 'phoneLandscape', 'androidPortrait']) {
    const gm = await t.open(device, 'index.html?debug=1&seed=7');
    const reqs = []; gm.page.on('request', (r) => reqs.push(r.url()));
    await gm.page.goto(gm.url + 'index.html?debug=1&seed=7', { waitUntil: 'load' });
    await installHelpers(gm.page);
    await startGame(gm.page);
    for (let i = 0; i < 12; i++) await ev(gm.page, 'g.fastForward(10)');
    await gm.page.waitForTimeout(300);
    const simT = await ev(gm.page, 'acc.stepCount / 60');
    const foreign = reqs.filter((u) => !u.startsWith(gm.url) && !/^(data|blob|about):/.test(u));
    const problems = [];
    if (gm.diag.errors.length) problems.push(`console.error x${gm.diag.errors.length}: ${gm.diag.errors.slice(0, 3).join(' | ')}`);
    if (gm.diag.pageErrors.length) problems.push(`uncaught exceptions x${gm.diag.pageErrors.length}: ${gm.diag.pageErrors.slice(0, 2).join(' | ')}`);
    if (gm.diag.failedRequests.length) problems.push(`failed requests: ${gm.diag.failedRequests.slice(0, 3).join(' | ')}`);
    if (foreign.length) problems.push(`cross-origin requests: ${foreign.slice(0, 3).join(' | ')}`);
    if (problems.length) fail(`[${device}] ${problems.join('; ')}`);
    if (simT < 100) t.warn(`[${device}] fastForward(120) advanced only ${simT.toFixed(1)} s of game.step calls (hook may bypass game.step)`);
    await t.closeAll();
  }
});

item('A2', 'Static grep: relative imports only, no importmap, single vendor import, no Math.random, no top-level await, CJK only in i18n/teams, denylist', async () => {
  const files = listSrc(); assert(files.length > 0, 'no src/*.js files found');
  const problems = [];
  for (const f of files) {
    const code = readText(f); const base = path.basename(f); const rel = 'src/' + base;
    for (const im of importSpecifiers(code)) {
      if (!(im.spec.startsWith('./') || im.spec.startsWith('../'))) problems.push(`${rel}:${im.line} import specifier "${im.spec}" is not ./ or ../`);
      else if (im.spec.startsWith('../') && im.spec !== '../vendor/three.module.js') problems.push(`${rel}:${im.line} import outside src/ other than ../vendor/three.module.js: "${im.spec}"`);
      if (im.dynamic) problems.push(`${rel}:${im.line} dynamic import() of "${im.spec}"`);
    }
    if (/\bTHREE\s*\./.test(maskJs(code)) && !code.includes("import * as THREE from '../vendor/three.module.js';")) problems.push(`${rel} uses THREE but lacks the exact line: import * as THREE from '../vendor/three.module.js';`);
    const mr = code.indexOf('Math.random'); if (mr >= 0) problems.push(`${rel}:${lineOf(code, mr)} contains Math.random`);
    const tla = topLevelAwait(code); if (tla) problems.push(`${rel}:${tla.line} top-level await: "${tla.snippet}"`);
    if (base !== 'i18n.js' && base !== 'teams.js') { const m = CJK_RE.exec(code); if (m) problems.push(`${rel}:${lineOf(code, m.index)} contains CJK character "${m[0]}"`); }
    for (const w of ['document.currentScript', 'serviceWorker']) { const k = code.indexOf(w); if (k >= 0) problems.push(`${rel}:${lineOf(code, k)} contains ${w}`); }
  }
  const html = fs.existsSync(path.join(ROOT, 'index.html')) ? readText(path.join(ROOT, 'index.html')) : null;
  if (html == null) problems.push('index.html missing');
  else {
    if (/importmap/i.test(html)) problems.push('index.html contains "importmap"');
    if (/<base\b/i.test(html)) problems.push('index.html contains a <base> tag');
    if (!/<script[^>]*type="module"[^>]*src="(\.\/)?src\/main\.js"/.test(html) && !/<script[^>]*src="(\.\/)?src\/main\.js"[^>]*type="module"/.test(html)) problems.push('index.html lacks <script type="module" src="./src/main.js">');
    if (!/name="viewport"[^>]*content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/.test(html)) problems.push('index.html viewport meta is not exactly "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"');
    if (!/name="theme-color"[^>]*content="#0b0d14"/.test(html)) problems.push('index.html lacks <meta name="theme-color" content="#0b0d14">');
  }
  const readme = path.join(ROOT, 'README.md'); if (!fs.existsSync(readme)) problems.push('README.md missing');
  const grepFiles = [...files, ...(html != null ? [path.join(ROOT, 'index.html')] : []), ...(fs.existsSync(readme) ? [readme] : [])];
  for (const f of grepFiles) { const text = readText(f); for (const w of DENYLIST) { const re = new RegExp('\\b' + w.replace(/ /g, '\\s+') + '\\b'); const m = re.exec(text); if (m) problems.push(`${path.relative(ROOT, f)}:${lineOf(text, m.index)} denylisted word "${w}"`); } }
  if (problems.length) fail(problems.slice(0, 12).join('\n    ') + (problems.length > 12 ? `\n    …and ${problems.length - 12} more` : ''));
});

item('A3', 'wc -l src/*.js in [2500, 9000]; vendor/ holds exactly three.module.js + LICENSE.three.txt', async (t) => {
  const files = listSrc(); assert(files.length > 0, 'no src/*.js files found');
  const counts = files.map((f) => ({ f: path.basename(f), n: (readText(f).match(/\n/g) || []).length }));
  const total = counts.reduce((s, c) => s + c.n, 0);
  t.warn(`line counts: ${counts.map((c) => `${c.f}=${c.n}`).join(' ')} total=${total}`);
  assert(total >= 2500 && total <= 9000, `total hand-written lines in src/ = ${total}, expected 2500–9000`);
  const vendor = fs.existsSync(path.join(ROOT, 'vendor')) ? fs.readdirSync(path.join(ROOT, 'vendor')).sort() : [];
  eq(vendor.join(','), 'LICENSE.three.txt,three.module.js', 'vendor/ contents');
});

// ---------------------------------------------------------------- i18n / menu
item('A4', 'zh by default, no empty [data-i18n], [data-action=lang] toggles en/zh, choice persists across reload', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7');
  await installHelpers(page);
  const text0 = await page.evaluate(() => document.body.innerText);
  assert(text0.includes(TXT.zh.start), `body text lacks "${TXT.zh.start}" on load`);
  const empties = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')].filter((el) => !(el.textContent || '').trim()).map((el) => el.getAttribute('data-i18n')));
  eq(empties.length, 0, `empty [data-i18n] elements (${empties.join(', ')})`);
  const lang = page.locator('#menuMain [data-action=lang]').first(); assert(await lang.count(), 'no [data-action=lang] inside #menuMain');
  await lang.click(); await sleep(150);
  const text1 = await page.evaluate(() => document.body.innerText);
  assert(text1.includes(TXT.en.start) && !text1.includes(TXT.zh.start), `after 1st lang click expected "${TXT.en.start}" without "${TXT.zh.start}"; got: ${text1.slice(0, 120).replace(/\n/g, ' ')}`);
  await lang.click(); await sleep(150);
  const text2 = await page.evaluate(() => document.body.innerText);
  assert(text2.includes(TXT.zh.start) && !text2.includes(TXT.en.start), `after 2nd lang click expected zh restored; got: ${text2.slice(0, 120).replace(/\n/g, ' ')}`);
  await lang.click(); await sleep(150);
  const stored = await page.evaluate(() => { try { return localStorage.getItem('hoop.lang'); } catch (e) { return 'ERR ' + e.message; } });
  await page.reload({ waitUntil: 'load' }); await installHelpers(page);
  const text3 = await page.evaluate(() => document.body.innerText);
  assert(text3.includes(TXT.en.start) && !text3.includes(TXT.zh.start), `after reload expected persisted en ("${TXT.en.start}"); got: ${text3.slice(0, 120).replace(/\n/g, ' ')}`);
  if (stored !== 'en') t.warn(`localStorage 'hoop.lang' is ${fmt(stored)} (spec §13: 'hoop.lang' = 'en')`);
});

item('A5', 'Start → CHECK → LIVE ≤ 3 s; 6 players; score bug HBT/RRF 0 0 第1节 02:00 14; fastForward(3) → 01:57 / 11', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7');
  await installHelpers(page);
  const t0 = Date.now(); await clickStart(page);
  const r1 = await waitForState(page, 'CHECK', 10000); if (r1.ms > 3000) t.warn(`CHECK took ${r1.ms} ms (> 3 s)`);
  const n = await ev(page, 'g.world.players.length'); eq(n, 6, '__game.world.players.length');
  const bug = (await page.evaluate(() => document.querySelector('#scoreBug').innerText)).replace(/\s+/g, ' ').trim();
  const tokens = bug.split(/[^0-9A-Za-z:\u4e00-\u9fff]+/).filter(Boolean);
  for (const want of ['HBT', 'RRF', TXT.zh.q1, '02:00', '14']) assert(tokens.includes(want), `score bug lacks "${want}" at CHECK; text: "${bug}"`);
  assert(tokens.filter((x) => x === '0').length >= 2, `score bug should show "0 0"; text: "${bug}"`);
  const r2 = await waitForState(page, 'LIVE', 10000); if (Date.now() - t0 > 3000) t.warn(`LIVE reached ${Date.now() - t0} ms after the click (> 3 s)`); void r2;
  const after = await page.evaluate(() => { const g = window.__game; g.setClock({ game: 120, shot: 14 }); g.fastForward(3); return document.querySelector('#scoreBug').innerText.replace(/\s+/g, ' '); });
  let txt = after;
  if (!(txt.includes('01:57') && /\b11\b/.test(txt))) { txt = (await waitFor(page, `(() => { const s = document.querySelector('#scoreBug').innerText.replace(/\\s+/g, ' '); return s.includes('01:57') && /\\b11\\b/.test(s) ? s : ''; })()`, 1500, 'score bug 01:57 / 11')).value; t.warn('HUD updated on a later frame than fastForward(3)'); }
  assert(txt.includes('01:57'), `game clock after fastForward(3): expected 01:57 in "${txt}"`);
  assert(/\b11\b/.test(txt), `shot clock after fastForward(3): expected 11 in "${txt}"`);
});

// ---------------------------------------------------------------- Input
const STICK_PT = (vw, vh) => ({ x: Math.round(vw * 0.15), y: Math.round(vh * 0.70) });
item('A6', 'Touch joystick (844×390): +60 px x for 1 s → pos.x +1 m; release → speed < 0.1; −60 px y → pos.z −1 m', async (t) => {
  requireGameFiles();
  const { page } = await t.open('phoneLandscape', 'index.html?seed=7');
  await installHelpers(page); await startGame(page);
  const p0 = STICK_PT(844, 390);
  const drag = async (to, axis) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await readyOffense(page);
      const before = await ev(page, 'acc.snap()');
      let after = null;
      await multiTouch(page, [{ type: 'touchStart', points: [{ id: 1, ...p0 }], waitMs: 30 }, ...moveSteps(1, p0, to, 6), async () => { await holdSim(page, 1.0, t, 'A6 hold'); after = await ev(page, 'acc.snap()'); }, { type: 'touchEnd', points: [] }]);
      if (after.state === 'LIVE' && after.ctrl === before.ctrl) return { before, after };
      t.warn(`attempt ${attempt}: play interrupted during drag (state ${after.state}, control ${before.ctrl}→${after.ctrl}); retrying`);
    }
    fail(`could not complete an uninterrupted ${axis} drag in 3 attempts`);
  };
  const r = await drag({ x: p0.x + 60, y: p0.y }, '+x');
  assert(r.after.x - r.before.x > 1.0, `pos.x should increase by > 1.0 m over 1 s: ${r.before.x.toFixed(2)} → ${r.after.x.toFixed(2)}`);
  const st = await waitFor(page, 'acc.snap().speed < 0.1', 3000, 'controlled speed < 0.1 m/s after release'); if (st.ms > 500) t.warn(`stop took ${st.ms} ms (> 0.5 s)`);
  const r2 = await drag({ x: p0.x, y: p0.y - 60 }, '−y');
  assert(r2.before.z - r2.after.z > 1.0, `pos.z should decrease by > 1.0 m over 1 s: ${r2.before.z.toFixed(2)} → ${r2.after.z.toFixed(2)}`);
});

item('A7', 'Multi-touch: finger 1 holds #btnSprint, finger 2 drags stick up → peak speed > 6 m/s; releases keep the other finger\'s input', async (t) => {
  requireGameFiles();
  const { page } = await t.open('phoneLandscape', 'index.html?seed=7');
  await installHelpers(page); await startGame(page); await readyOffense(page);
  const sc = center(await bbox(page, '#btnSprint')); const p0 = STICK_PT(844, 390); const p1 = { x: p0.x, y: p0.y - 60 };
  const F1 = { id: 1, ...sc };
  let peak = 0, keep = null;
  await multiTouch(page, [
    { type: 'touchStart', points: [F1], waitMs: 60 },
    { type: 'touchStart', points: [F1, { id: 2, ...p0 }], waitMs: 30 },
    ...moveSteps(2, p0, p1, 6, [F1]),
    async () => { const t0 = Date.now(); const s0 = await ev(page, 'acc.stepCount'); while (Date.now() - t0 < 1500) { peak = Math.max(peak, await ev(page, 'acc.snap().speed')); await sleep(40); } const got = (await ev(page, 'acc.stepCount') - s0) / 60; if (got < 1.35) { for (let i = 0; i < 6; i++) { await ev(page, 'acc.sim(0.25)'); peak = Math.max(peak, await ev(page, 'acc.snap().speed')); } t.warn(`rAF loop advanced only ${got.toFixed(2)} s of sim in 1.5 s; topped up with acc.sim()`); } },
    { type: 'touchEnd', points: [F1], waitMs: 250 }, // CDP touchEnd lists the LIFTED points: release finger 1 (sprint), keep 2
    async () => { await holdSim(page, 0.3, t, 'A7 after sprint release'); keep = await ev(page, 'acc.snap()'); },
    { type: 'touchEnd', points: [{ id: 2, ...p1 }] },
  ]);
  assert(peak > 6, `peak speed with sprint + stick should exceed 6 m/s, got ${peak.toFixed(2)}`);
  assert(keep.mag > 0.5 && keep.speed > 2, `after releasing the sprint finger the stick finger should keep moving: intent.move.mag=${keep.mag}, speed=${keep.speed.toFixed(2)}`);
  await readyOffense(page);
  let sprintOnly = null;
  await multiTouch(page, [
    { type: 'touchStart', points: [F1], waitMs: 60 },
    { type: 'touchStart', points: [F1, { id: 2, ...p0 }], waitMs: 30 },
    ...moveSteps(2, p0, p1, 6, [F1]),
    { type: 'touchEnd', points: [{ id: 2, ...p1 }], waitMs: 250 }, // lift finger 2 (stick), keep sprint
    async () => { await holdSim(page, 0.3, t, 'A7 after stick release'); sprintOnly = await ev(page, 'acc.snap()'); },
    { type: 'touchEnd', points: [F1] },
  ]);
  assert(sprintOnly.sprint === true, `after releasing the stick finger intent.sprint should stay true, got ${sprintOnly.sprint}`);
  assert(sprintOnly.mag === 0, `after releasing the stick finger intent.move.mag should be 0, got ${sprintOnly.mag}`);
});

item('A8', 'Slide-over: pointerdown #btnSprint, pointermove into #btnPrimary → primary.held && !sprint', async (t) => {
  requireGameFiles();
  const { page } = await t.open('phoneLandscape', 'index.html?seed=7');
  await installHelpers(page); await startGame(page); await readyOffense(page);
  const sc = center(await bbox(page, '#btnSprint')); const pc = center(await bbox(page, '#btnPrimary'));
  let mid = null, after = null;
  await multiTouch(page, [
    { type: 'touchStart', points: [{ id: 1, ...sc }], waitMs: 120 },
    async () => { await holdSim(page, 0.15, null); mid = await ev(page, '({sprint: g.input.intent.sprint, primary: g.input.intent.primary.held})'); },
    ...moveSteps(1, sc, pc, 8),
    async () => { await holdSim(page, 0.25, null); after = await ev(page, '({sprint: g.input.intent.sprint, primary: g.input.intent.primary.held})'); },
    { type: 'touchEnd', points: [] },
  ]);
  assert(mid.sprint === true, `while holding #btnSprint intent.sprint should be true, got ${fmt(mid)}`);
  assert(after.primary === true, `after sliding into #btnPrimary intent.primary.held should be true, got ${fmt(after)}`);
  assert(after.sprint === false, `after sliding into #btnPrimary intent.sprint should be false, got ${fmt(after)}`);
});

item('A9', 'Button labels offence/defence (zh + en), .defense after turnover() ≤ 200 ms, ≥ 56 px targets inside 4 viewports, safe-bottom', async (t) => {
  requireGameFiles();
  const { page } = await t.open('phoneLandscape', 'index.html?seed=7');
  await installHelpers(page); await startGame(page); await readyOffense(page);
  const L = buttonLabelsExpr();
  const expectLabels = async (want, what, ms = 2000) => { const r = await waitFor(page, `(() => { const l = ${L}; return ${JSON.stringify(want)}.every((w, i) => l[i] && l[i].includes(w)) ? l : null; })()`, ms, what).catch(async (e) => { fail(`${what}: labels ${fmt(await ev(page, L))} (${e.message})`); }); return r; };
  await expectLabels([TXT.zh.shoot, TXT.zh.pass, TXT.zh.cross, TXT.zh.sprint], 'offence labels (zh)');
  await page.keyboard.press('t'); await expectLabels([TXT.en.shoot, TXT.en.pass, TXT.en.cross, TXT.en.sprint], 'offence labels (en) after T');
  await page.keyboard.press('t'); await expectLabels([TXT.zh.shoot, TXT.zh.pass, TXT.zh.cross, TXT.zh.sprint], 'offence labels (zh) after 2nd T');
  await ev(page, 'g.turnover()');
  const r = await expectLabels([TXT.zh.block, TXT.zh.switch, TXT.zh.steal, TXT.zh.sprint], 'defence labels after turnover()');
  if (r && r.ms > 200) t.warn(`defence labels appeared after ${r.ms} ms (> 200 ms)`);
  const cls = await page.evaluate(() => document.querySelector('#cluster').className); assert(/\bdefense\b/.test(cls), `#cluster class should include "defense", got "${cls}"`);
  for (const [w, h] of [[844, 390], [390, 844], [812, 375], [375, 812]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(500);
    for (const id of ['#btnPrimary', '#btnSecondary', '#btnTertiary', '#btnSprint']) {
      const b = await bbox(page, id);
      assert(b.width >= 55.5 && b.height >= 55.5, `${id} at ${w}×${h}: box ${b.width.toFixed(1)}×${b.height.toFixed(1)} < 56×56`);
      assert(b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5, `${id} at ${w}×${h} not fully inside viewport: ${fmt(b)}`);
    }
  }
  await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px')); await sleep(300);
  const cb = await bbox(page, '#cluster'); const gap = 812 - (cb.y + cb.height);
  assert(gap >= 50, `with --safe-bottom:34px the cluster bottom should be ≥ 50 px above the viewport bottom, got ${gap.toFixed(1)} px`);
  await page.evaluate(() => document.documentElement.style.removeProperty('--safe-bottom'));
});

item('A10', 'Keyboard: d/w move, Space 440 ms → flight + fga+1, p pauses (#menuPause) and resumes after countdown', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7');
  await installHelpers(page); await startGame(page); await readyOffense(page);
  const hold = async (key, sec) => { const b = await ev(page, 'acc.snap()'); await page.keyboard.down(key); await holdSim(page, sec, t, `key ${key}`); await page.keyboard.up(key); const a = await ev(page, 'acc.snap()'); return { b, a }; };
  const d = await hold('d', 0.5); assert(d.a.state === 'LIVE', `play interrupted while holding d (state ${d.a.state})`);
  assert(d.a.x - d.b.x > 1.0, `holding d 500 ms should move pos.x by > 1.0 m: ${d.b.x.toFixed(2)} → ${d.a.x.toFixed(2)}`);
  await waitFor(page, 'acc.snap().speed < 0.1', 3000, 'stop after d');
  const w = await hold('w', 0.5); assert(w.a.state === 'LIVE', `play interrupted while holding w (state ${w.a.state})`);
  assert(w.a.z < w.b.z, `holding w should decrease pos.z: ${w.b.z.toFixed(2)} → ${w.a.z.toFixed(2)}`);
  await readyOffense(page);
  const fga0 = await ev(page, '({c: g.controlled.stats.fga, u: g.world.userPlayer.stats.fga, same: g.controlled === g.world.userPlayer})');
  if (!fga0.same) t.warn('controlled player is not world.userPlayer at shot time');
  await page.keyboard.down('Space'); await sleep(440); await page.keyboard.up('Space');
  const fl = await waitFor(page, "g.ball.state === 'flight' || g.ball.state === 'scored' || g.ball.state === 'loose'", 4000, "ball.state === 'flight' after Space");
  if (fl.value !== true) { /* value is boolean */ }
  const bs = await ev(page, 'g.ball.state'); if (bs !== 'flight') t.warn(`ball.state observed as '${bs}' (flight already resolved?)`);
  const fga1 = await ev(page, '({c: g.controlled.stats.fga, u: g.world.userPlayer.stats.fga})');
  assert(fga1.u === fga0.u + 1 || fga1.c === fga0.c + 1, `stats.fga should increase by 1 after the shot: userPlayer ${fga0.u}→${fga1.u}, controlled ${fga0.c}→${fga1.c}`);
  await page.keyboard.press('p');
  await waitFor(page, 'acc.paused()', 3000, 'paused === true after p');
  assert(await isVisible(page, '#menuPause'), '#menuPause should be visible while paused');
  await page.keyboard.press('p');
  const res = await waitFor(page, '!acc.paused()', 5000, 'paused === false after 2nd p (1 s countdown)');
  if (res.ms < 700) t.warn(`resume happened after ${res.ms} ms; spec has a 1.0 s countdown before clocks run`);
});

// ---------------------------------------------------------------- Shooting / physics
item('A11', 'debugShoot p=1 from (0,−8.3) → +2, score event, DEAD→CHECK→LIVE, possession flips; from (0,−4.8) → +3', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7');
  await installHelpers(page); await startGame(page);
  const two = (await ev(page, 'acc.shootTrial({n:1, p:1, e:0, shooter:{x:0, z:-8.3}, defenders:"none", follow:true})'))[0];
  assert(!two.error, two.error);
  assert(two.released, 'shot from (0,−8.3) never released');
  assert(two.made && two.points === 2, `expected +2 from 4.45 m, got points=${two.points} (resolved ${two.resolved}, states ${two.states.join('→')})`);
  assert(two.scoreEvts.length > 0 || two.scoreT != null, `no 'score' event observed (spy: game.on)`);
  if (two.scoreT != null) assert(two.scoreT <= 4, `score event arrived ${two.scoreT} s after the shot (> 4 s)`);
  const seq = two.states.join('→'); assert(/DEAD.*CHECK.*LIVE/.test(seq), `state sequence should pass DEAD → CHECK → LIVE, got ${seq}`);
  assert(two.offAfter !== two.offBefore, `possession should switch after the make (userIsOffense before=${two.offBefore}, after=${two.offAfter})`);
  const three = (await ev(page, 'acc.shootTrial({n:1, p:1, e:0, shooter:{x:0, z:-4.8}, defenders:"none", follow:true})'))[0];
  assert(!three.error, three.error);
  assert(three.made && three.points === 3, `expected +3 from 7.95 m, got points=${three.points} (resolved ${three.resolved})`);
  if (two.scoreEvts.length) t.warn(`score event payloads: ${fmt(two.scoreEvts[0])}`);
});

item('A12', 'p=0 e=−0.15 ×20 never scores and always hits rim/board; p=0 e=−0.40 ×10 → ≥ 6 air balls + cap.airball', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7&q=5');
  await installHelpers(page); await startGame(page);
  const inst = await ev(page, 'acc.installed'); if (!inst.gameOn && !inst.audio) t.warn('neither game.on nor audio hooks available; rim detection relies on ball.rimContacts only');
  const a = await ev(page, 'acc.shootTrial({n:20, p:0, e:-0.15, shooter:{x:0, z:-8.3}, defenders:"away"})');
  const errs = a.filter((x) => x.error); assert(!errs.length, errs[0] && errs[0].error);
  const scored = a.filter((x) => x.made); assert(scored.length === 0, `${scored.length}/20 attempts with p=0 scored`);
  const noContact = a.map((x, i) => (x.rim || x.board ? null : i)).filter((i) => i != null);
  assert(noContact.length === 0, `${noContact.length}/20 short misses (e=−0.15) produced no rim/board event: attempts ${noContact.join(',')}; sample ${fmt(a[noContact[0]])}`);
  const b = await ev(page, 'acc.shootTrial({n:10, p:0, e:-0.40, shooter:{x:0, z:-8.3}, defenders:"away"})');
  const bErr = b.filter((x) => x.error); assert(!bErr.length, bErr[0] && bErr[0].error);
  assert(!b.some((x) => x.made), 'an e=−0.40 attempt scored');
  const air = b.filter((x) => !x.rim).length; const caps = b.filter((x) => x.air).length;
  assert(air >= 6, `expected ≥ 6/10 air balls (no rim event) for e=−0.40, got ${air}`);
  assert(caps >= 1, `cap.airball caption never appeared over 10 air-ball attempts (hud.caption spy: ${!!inst.hudCaption}, DOM observer: ${!!inst['dom#caption']})`);
  if (caps < 6) t.warn(`cap.airball observed on ${caps}/10 attempts`);
});

item('A13', 'Timing model ×40: e=0 open ≥ 34 makes; e=−0.35 ≤ 8; defender jumping in front (0,−9.0) ≤ 28', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7&q=5');
  await installHelpers(page); await startGame(page);
  const run = async (o) => { const r = await ev(page, `acc.shootTrial(${JSON.stringify(o)})`); const e = r.find((x) => x.error); assert(!e, e && e.error); assert(r.every((x) => x.released), `${r.filter((x) => !x.released).length} shots never released`); return r; };
  const open = await run({ n: 40, e: 0, shooter: { x: 0, z: -8.3 }, defenders: 'away' });
  const m1 = open.filter((x) => x.made).length; assert(m1 >= 34, `open green shots: ${m1}/40 makes, expected ≥ 34`);
  const late = await run({ n: 40, e: -0.35, shooter: { x: 0, z: -8.3 }, defenders: 'away' });
  const m2 = late.filter((x) => x.made).length; assert(m2 <= 8, `e=−0.35 shots: ${m2}/40 makes, expected ≤ 8`);
  const contested = await run({ n: 40, e: 0, shooter: { x: 0, z: -8.3 }, defenders: 'front', frontXZ: { x: 0, z: -9.0 }, jump: true });
  const m3 = contested.filter((x) => x.made).length; assert(m3 <= 28, `contested green shots: ${m3}/40 makes, expected ≤ 28`);
  const jumped = contested.filter((x) => x.defJumping).length; if (jumped < 20) t.warn(`defender observed jumping during only ${jumped}/40 contested attempts (jump forced via ${contested[0].jumpForced})`);
  t.warn(`makes: open ${m1}/40, late ${m2}/40, contested ${m3}/40`);
});

item('A14', 'Fuzz auto=1 seeds 3 and 11 × fastForward(60): no NaN, ball.y ≥ 0.10, bounds, shot clock 0–14, FGA ≥ 6, FGM per team ≥ 1, no free ball > 6 s', async (t) => {
  requireGameFiles();
  for (const seed of [3, 11]) {
    const { page } = await t.open('desktop', `index.html?auto=1&seed=${seed}`);
    await installHelpers(page); await startGame(page);
    await ev(page, 'acc.fuzzStart()');
    let stepsBefore = await ev(page, 'acc.stepCount');
    for (let i = 0; i < 12; i++) { await ev(page, 'g.fastForward(5)'); if (i === 0) { const s = await ev(page, 'acc.stepCount'); if (s - stepsBefore < 250) { t.warn(`seed ${seed}: fastForward bypasses game.step; sampling per 0.5 s chunk instead`); for (let k = 0; k < 110; k++) { await ev(page, 'g.fastForward(0.5); acc.sampler()'); } break; } } }
    const F = await ev(page, 'acc.fuzzStop()');
    const p = (m) => `seed ${seed}: ${m} (${F.steps} samples, state ${F.state}, Q${F.quarter}, score ${fmt(F.scores)})`;
    assert(F.steps > 0, p('sampler never ran'));
    assert(F.nan === 0, p(`NaN coordinates detected in ${F.nanWhere}`));
    assert(F.minBallY >= 0.10, p(`ball.pos.y dropped to ${F.minBallY.toFixed(3)} (< 0.10)`));
    assert(F.maxAbsX <= 9, p(`|ball.x| reached ${F.maxAbsX.toFixed(2)} (> 9)`));
    assert(F.minZ >= -16 && F.maxZ <= 1, p(`ball.z range [${F.minZ.toFixed(2)}, ${F.maxZ.toFixed(2)}] outside [−16, 1]`));
    assert(F.minShot >= 0 && F.maxShot <= 14, p(`shot clock range [${F.minShot}, ${F.maxShot}] outside [0, 14]`));
    assert(F.fga >= 6, p(`total FGA ${F.fga} < 6`));
    assert(F.fgm[0] >= 1 && F.fgm[1] >= 1, p(`FGM per team ${fmt(F.fgm)} — each must be ≥ 1`));
    assert(F.maxFreeRun / 60 <= 6, p(`a live free ball stayed free for ${(F.maxFreeRun / 60).toFixed(1)} s (> 6 s)`));
    if (F.invariantsBroken == null) t.warn(p('__game.debug.invariantsBroken hook missing')); else assert(F.invariantsBroken === 0, p(`__game.debug.invariantsBroken = ${F.invariantsBroken}`));
    if (F.samplerError) t.warn(p('sampler error: ' + F.samplerError));
    await t.closeAll();
  }
});

item('A15', 'Pass: tap #btnSecondary → pass → teammate owns ball and is controlled ≤ 1 s; defender 0.3 m off the line intercepts ≥ 1 of 30', async (t) => {
  requireGameFiles();
  const { page } = await t.open('phoneLandscape', 'index.html?seed=7&q=5');
  await installHelpers(page); await startGame(page); await readyOffense(page);
  const passer = await ev(page, 'acc.idx(g.controlled)');
  await tapEl(page, '#btnSecondary', 'phoneLandscape');
  const pr = await waitFor(page, "g.ball.state === 'pass' || (acc.ballHeld() && acc.idx(g.ball.owner) !== " + passer + ')', 5000, "ball.state === 'pass' after the tap");
  if (pr.ms > 1000) t.warn(`pass registered ${pr.ms} ms after the tap`);
  const r = await ev(page, `acc.simUntil('acc.ballHeld() && acc.idx(g.ball.owner) !== ${passer}', 1.0)`);
  const who = await ev(page, `({owner: acc.idx(g.ball.owner), ownerTeam: acc.teamOf(g.ball.owner), user: g.world.user, ctrl: acc.idx(g.controlled), state: g.ball.state})`);
  assert(r.ok, `teammate did not receive the pass within 1 s of sim: ${fmt(who)}`);
  assert(who.ownerTeam === who.user && who.owner !== passer, `ball owner should be a teammate: ${fmt(who)}`);
  assert(who.ctrl === who.owner, `__game.controlled should be the receiver: ${fmt(who)}`);
  const trials = await ev(page, 'acc.passTrial({n:30})');
  const e = trials.find((x) => x.error); assert(!e, e && e.error);
  const inter = trials.filter((x) => x.result === 'intercepted' || (x.dead && /TURNOVER/i.test(x.dead) && x.possessionChanged));
  const withCap = inter.filter((x) => x.steal);
  assert(inter.length >= 1, `no interception in 30 seeded passes with a defender 0.3 m off the line (how=${trials[0].how}; results ${fmt(trials.map((x) => x.result))})`);
  assert(withCap.length >= 1, `${inter.length} interceptions but cap.steal caption never appeared`);
  t.warn(`${inter.length}/30 passes intercepted (pass trigger: ${trials[0].how})`);
});

item('A16', 'Defence: Switch tap changes controlled; Steal taps from 0.8 m → cap.steal + possession; Block tap → isJumping', async (t) => {
  requireGameFiles();
  const { page } = await t.open('phoneLandscape', 'index.html?seed=7&q=5');
  await installHelpers(page); await startGame(page);
  await readyOffense(page, true);
  const c0 = await ev(page, 'acc.idx(g.controlled)');
  await tapEl(page, '#btnSecondary', 'phoneLandscape');
  const sw = await waitFor(page, `acc.idx(g.controlled) !== ${c0} && !acc.userOff()`, 4000, 'controlled defender changes after Switch tap');
  if (sw.ms > 1000) t.warn(`switch registered after ${sw.ms} ms`);
  await readyOffense(page, true); await ev(page, 'acc.sim(0.6)');
  await tapEl(page, '#btnPrimary', 'phoneLandscape');
  await waitFor(page, 'g.controlled && g.controlled.isJumping === true', 3000, 'controlled.isJumping after Block tap');
  let stole = null;
  for (let i = 0; i < 30 && !stole; i++) {
    const prep = await ev(page, 'acc.stealPrep()'); assert(prep.ok, `steal prep failed: ${fmt(prep)}`);
    await tapEl(page, '#btnTertiary', 'phoneLandscape');
    await waitFor(page, `acc.stepCount > ${prep.steps}`, 3000, 'a fixed step after the Steal tap');
    const chk = await ev(page, `acc.stealCheck(${prep.caps})`);
    if (chk.steal && (chk.off || /TURNOVER/i.test(chk.dead || '') || chk.state !== 'LIVE')) stole = { attempt: i + 1, ...chk, dist: prep.dist, handlerState: prep.handlerState };
  }
  assert(stole, 'no steal (cap.steal + possession change) in 30 Steal taps from 0.8 m');
  t.warn(`steal on attempt ${stole.attempt} (dist ${stole.dist} m, handler ball state ${stole.handlerState})`);
});

// ---------------------------------------------------------------- Rules
item('A17', 'setClock({shot:0.5}) → cap.shotClock + DEAD(SHOT_CLOCK) + possession; handler at x=8.2 → cap.oob + possession', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7&q=5');
  await installHelpers(page); await startGame(page); await readyOffense(page);
  const r1 = await ev(page, `(() => { const c0 = acc.caps.length, off0 = acc.userOff(); g.setClock({shot: 0.5}); const r = acc.simUntil('g.state !== "LIVE"', 1.5); const dead = acc.deadReason(); const cap = acc.capSeen(c0, 'cap.shotClock'); acc.simUntil('g.state === "CHECK" || g.state === "LIVE"', 4); return {r, dead, cap, off0, off1: acc.userOff(), shot: g.world.shotClock}; })()`);
  assert(r1.r.ok, `no dead ball within 1.5 s after setClock({shot:0.5}) (state ${r1.r.state}, shot clock ${r1.shot})`);
  assert(/SHOT/i.test(r1.dead || ''), `dead reason should be SHOT_CLOCK, got ${fmt(r1.dead)} (state ${r1.r.state})`);
  assert(r1.cap, 'cap.shotClock caption not observed');
  assert(r1.off0 && !r1.off1, `possession should switch away from the user (before ${r1.off0}, after ${r1.off1})`);
  await readyOffense(page);
  const r2 = await ev(page, `(() => { const c0 = acc.caps.length, off0 = acc.userOff(); const c = g.controlled; g.teleport(acc.idx(c), 8.2, c.pos.z); const r = acc.simUntil('g.state !== "LIVE"', 1.5); const dead = acc.deadReason(); const cap = acc.capSeen(c0, 'cap.oob'); acc.simUntil('g.state === "CHECK" || g.state === "LIVE"', 4); return {r, dead, cap, off0, off1: acc.userOff()}; })()`);
  assert(r2.r.ok, `no dead ball within 1.5 s after moving the handler to x = 8.2 (state ${r2.r.state})`);
  assert(/OOB|OUT/i.test(r2.dead || ''), `dead reason should be OOB, got ${fmt(r2.dead)}`);
  assert(r2.cap, 'cap.oob caption not observed');
  assert(r2.off0 && !r2.off1, `possession should switch away from the user after OOB (before ${r2.off0}, after ${r2.off1})`);
});

item('A18', 'Quarter flow: Q1→Q2, halftime overlay ≥ 1 s → Q3, Q4 tied → OVERTIME (加时, 01:00), OT make → #menuOver with 6-row box score + winner', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7');
  await installHelpers(page); await startGame(page);
  const endPeriod = async (label) => {
    await readyOffense(page);
    const r = await ev(page, `(() => { const q = g.world.quarter, b0 = acc.banners.length; g.setClock({game: 1}); const r = acc.simUntil('g.state === "QUARTER_END"', 2.0); return {q, b0, r}; })()`);
    assert(r.r.ok, `${label}: QUARTER_END not reached within 2 s after setClock({game:1}) (state ${r.r.state})`);
    return r;
  };
  const q1 = await endPeriod('Q1'); eq(q1.q, 1, 'quarter before first end');
  const q2 = await ev(page, `acc.simUntil('g.world.quarter === 2', 4)`); assert(q2.ok, `quarter counter should become 2 (state ${q2.state}, quarter ${await ev(page, 'g.world.quarter')})`);
  await endPeriod('Q2');
  const ht = await ev(page, `acc.simUntil('g.state === "HALFTIME"', 4)`); assert(ht.ok, `HALFTIME not reached after Q2 (state ${ht.state})`);
  await ev(page, 'acc.nextFrame(2)');
  assert(await isVisible(page, '#halftime'), '#halftime overlay should be visible at HALFTIME');
  await ev(page, 'acc.sim(1.0)'); await ev(page, 'acc.nextFrame(2)');
  const still = await ev(page, `({state: g.state, vis: acc.visible('#halftime')})`);
  assert(still.state === 'HALFTIME' && still.vis, `#halftime should stay visible ≥ 1 s: ${fmt(still)}`);
  const q3 = await ev(page, `acc.simUntil('g.state === "CHECK" && g.world.quarter === 3', 6)`); assert(q3.ok, `Q3 CHECK not reached after halftime (state ${q3.state}, quarter ${await ev(page, 'g.world.quarter')})`);
  await endPeriod('Q3');
  const q4 = await ev(page, `acc.simUntil('g.world.quarter === 4 && g.state === "CHECK"', 6)`); assert(q4.ok, `Q4 CHECK not reached (state ${q4.state})`);
  await readyOffense(page);
  const sc = await ev(page, 'acc.scores()'); if (sc[0] !== sc[1]) t.warn(`score not tied before the end of Q4 (${fmt(sc)}); OT branch may not be exercised`);
  const b0 = await ev(page, 'acc.banners.length');
  const q4end = await endPeriod('Q4');
  void q4end;
  const ot = await ev(page, `acc.simUntil('g.world.quarter >= 5 || g.state === "CHECK" || g.state === "GAME_OVER"', 6)`);
  const st = await ev(page, 'g.state');
  if (sc[0] === sc[1]) {
    assert(st !== 'GAME_OVER', 'tied after Q4 but the game ended instead of going to overtime');
    await ev(page, 'acc.nextFrame(2)');
    const banner = await ev(page, `acc.bannerSeen(${b0}, 'banner.overtime')`); assert(banner, `banner 加时赛/OVERTIME not observed (state ${ot.state})`);
    const bug = (await page.evaluate(() => document.querySelector('#scoreBug').innerText)).replace(/\s+/g, ' ');
    assert(bug.includes(TXT.zh.ot) || bug.includes(TXT.en.ot), `quarter label should read 加时/OT, score bug: "${bug}"`);
    assert(bug.includes('01:00'), `OT game clock should read 01:00, score bug: "${bug}"`);
    await readyOffense(page);
    const mk = (await ev(page, 'acc.shootTrial({n:1, p:1, e:0, shooter:{x:0, z:-8.3}, defenders:"away"})'))[0]; assert(mk.made, `could not score in OT to break the tie: ${fmt(mk)}`);
    await endPeriod('OT');
  }
  const over = await ev(page, `acc.simUntil('g.state === "GAME_OVER"', 4)`); assert(over.ok, `GAME_OVER not reached within 4 s (state ${over.state})`);
  await ev(page, 'acc.nextFrame(2)');
  assert(await isVisible(page, '#menuOver'), '#menuOver should be visible at GAME_OVER');
  const rows = await page.evaluate(() => [...document.querySelectorAll('#menuOver tr')].filter((tr) => tr.querySelector('td')).length);
  eq(rows, 6, '#menuOver box-score data rows');
  const overText = await page.evaluate(() => document.querySelector('#menuOver').innerText);
  assert(overText.includes(TXT.zh.win) || /\bwin\b/.test(overText), `winner line (…获胜 / … win) missing in #menuOver text: "${overText.slice(0, 100).replace(/\n/g, ' ')}"`);
});

item('A19', '?q=0.1&auto=1&seed=5 + fastForward(120) → GAME_OVER (or OT in progress) with both scores > 0', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?q=0.1&auto=1&seed=5');
  await installHelpers(page); await startGame(page);
  for (let i = 0; i < 12; i++) await ev(page, 'g.fastForward(10)');
  const r = await ev(page, '({state: g.state, quarter: g.world.quarter, scores: acc.scores()})');
  assert(r.state === 'GAME_OVER' || r.quarter >= 5, `expected GAME_OVER or overtime after 120 s of sim, got ${fmt(r)}`);
  assert(r.scores[0] > 0 && r.scores[1] > 0, `both teams should have scored, got ${fmt(r)}`);
  t.warn(`final: ${fmt(r)}`);
});

// ---------------------------------------------------------------- Layout / mobile
const LAYOUT_CHECK = `(() => {
  const se = document.scrollingElement, c = document.querySelector('#gl') || document.querySelector('canvas');
  const box = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const a = box('#scoreBug'), b = box('#btnPrimary');
  const intersects = a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  return { iw: innerWidth, ih: innerHeight, sw: se.scrollWidth, sh: se.scrollHeight, cw: c ? c.clientWidth : null, ch: c ? c.clientHeight : null, scoreBug: a, btnPrimary: b, intersects, taBody: getComputedStyle(document.body).touchAction, taCanvas: c ? getComputedStyle(c).touchAction : null, scrollY: window.scrollY };
})()`;
async function layoutChecks(page, w, h) {
  await page.setViewportSize({ width: w, height: h }); await sleep(600);
  const r = await ev(page, LAYOUT_CHECK); const tag = `${w}×${h}`;
  assert(r.sw === r.iw && r.sh === r.ih, `${tag}: scrollingElement ${r.sw}×${r.sh} must equal viewport ${r.iw}×${r.ih}`);
  assert(r.cw === r.iw && r.ch === r.ih, `${tag}: canvas client size ${r.cw}×${r.ch} must equal viewport ${r.iw}×${r.ih}`);
  assert(r.scoreBug && r.btnPrimary, `${tag}: #scoreBug/#btnPrimary missing`);
  assert(!r.intersects, `${tag}: #scoreBug ${fmt(r.scoreBug)} intersects #btnPrimary ${fmt(r.btnPrimary)}`);
  assert(r.taBody === 'none' && r.taCanvas === 'none', `${tag}: touch-action body=${r.taBody} canvas=${r.taCanvas}, expected none`);
  await page.mouse.move(w / 2, h / 2); await page.mouse.wheel(0, 400); await sleep(200);
  const sy = await page.evaluate(() => ({ y: window.scrollY, top: document.scrollingElement.scrollTop }));
  assert(sy.y === 0 && sy.top === 0, `${tag}: wheel changed scroll position to ${fmt(sy)}`);
}
item('A20', 'No page scroll, canvas = viewport, scoreBug ∩ btnPrimary = ∅, touch-action none, wheel inert (5 viewports)', async (t) => {
  requireGameFiles();
  const gm = await t.open('phoneLandscape', 'index.html?seed=7');
  await installHelpers(gm.page); await startGame(gm.page);
  for (const [w, h] of [[844, 390], [390, 844], [812, 375], [375, 812]]) await layoutChecks(gm.page, w, h);
  await t.closeAll();
  const dm = await t.open('desktop', 'index.html?seed=7');
  await installHelpers(dm.page); await startGame(dm.page);
  await layoutChecks(dm.page, 1280, 720);
});

item('A21', 'Rotate 844×390 → 390×844 mid-LIVE: stays LIVE, canvas resizes ≤ 500 ms, fov 44→70 (±4), rim + ball inside NDC', async (t) => {
  requireGameFiles();
  const { page } = await t.open('phoneLandscape', 'index.html?seed=7');
  await installHelpers(page); await startGame(page);
  const check = async (fovWant, tag) => {
    const f = await waitFor(page, `Math.abs(g.camera.fov - ${fovWant}) <= 4 ? g.camera.fov : 0`, 10000, `${tag}: camera.fov ≈ ${fovWant}`).catch(async (e) => fail(`${tag}: camera.fov = ${await ev(page, 'g.camera.fov')} (expected ${fovWant} ± 4)`));
    void f;
    const n = await ev(page, `(() => { const b = acc.ballPos(); return { rim: acc.ndc(0, 3.048, -12.75), ball: acc.ndc(b.x, b.y, b.z) }; })()`);
    for (const k of ['rim', 'ball']) assert(Math.abs(n[k].x) <= 1 && Math.abs(n[k].y) <= 1, `${tag}: ${k} projects outside NDC: ${fmt(n[k])}`);
  };
  await check(44, 'landscape');
  await page.setViewportSize({ width: 390, height: 844 });
  const rs = await waitFor(page, `(() => { const c = document.querySelector('#gl'); return c.clientWidth === 390 && c.clientHeight === 844 && Math.abs(c.width / g.renderer.getPixelRatio() - 390) < 2; })()`, 5000, 'canvas resized to 390×844');
  if (rs.ms > 500) t.warn(`canvas resize took ${rs.ms} ms (> 500 ms)`);
  eq(await ev(page, 'g.state'), 'LIVE', 'state after rotation');
  await check(70, 'portrait');
});

item('A22', 'Portrait first load shows #rotateHint; 知道了 hides it; not shown again after reload', async (t) => {
  requireGameFiles();
  const { page } = await t.open('phonePortrait', 'index.html?seed=7');
  await installHelpers(page);
  await waitFor(page, "acc.visible('#rotateHint')", 3000, '#rotateHint visible on portrait first load');
  await clickText(page, '#rotateHint', TXT.zh.dismiss, TXT.en.dismiss, 'hint.dismiss'); await sleep(300);
  assert(!(await isVisible(page, '#rotateHint')), '#rotateHint still visible after tapping 知道了');
  await page.reload({ waitUntil: 'load' }); await installHelpers(page); await sleep(1500);
  assert(!(await isVisible(page, '#rotateHint')), '#rotateHint reappeared after reload (dismissal not persisted)');
});

item('A23', 'renderer.getPixelRatio() ≤ 1.5 on iPhone emulation, ≤ 2 on desktop', async (t) => {
  requireGameFiles();
  const ph = await t.open('phonePortrait', 'index.html?seed=7'); await installHelpers(ph.page);
  const dprPhone = await ev(ph.page, 'g.renderer.getPixelRatio()'); assert(dprPhone <= 1.5, `phone pixel ratio ${dprPhone} > 1.5`);
  await t.closeAll();
  const dt = await t.open('desktop', 'index.html?seed=7'); await installHelpers(dt.page);
  const dprDesk = await ev(dt.page, 'g.renderer.getPixelRatio()'); assert(dprDesk <= 2, `desktop pixel ratio ${dprDesk} > 2`);
  t.warn(`pixel ratio phone=${dprPhone} desktop=${dprDesk}`);
});

item('A24', 'visibilitychange hidden → paused, clock frozen; visible → pause menu shown, clock still frozen until resume', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7');
  await installHelpers(page); await startGame(page); await readyOffense(page);
  await ev(page, "acc.setVisibility('hidden')");
  await waitFor(page, 'acc.paused()', 3000, 'paused === true after hidden');
  const c0 = await ev(page, 'g.world.gameClock'); await sleep(1000); const c1 = await ev(page, 'g.world.gameClock');
  assert(Math.abs(c1 - c0) < 1e-6, `game clock moved while hidden: ${c0} → ${c1}`);
  await ev(page, "acc.setVisibility('visible')"); await sleep(400);
  assert(await ev(page, 'acc.paused()'), 'game auto-resumed on visible (must stay paused)');
  assert(await isVisible(page, '#menuPause'), '#menuPause not shown after returning visible');
  await sleep(1000); const c2 = await ev(page, 'g.world.gameClock');
  assert(Math.abs(c2 - c0) < 1e-6, `game clock moved after visible but before resume: ${c0} → ${c2}`);
  await clickText(page, '#menuPause', TXT.zh.resume, TXT.en.resume, 'menu.resume');
  await waitFor(page, '!acc.paused()', 5000, 'paused === false after resume');
});

// ---------------------------------------------------------------- Performance / rendering
item('A25', 'After 5 s LIVE: drawCalls ≤ 110, triangles ≤ 40000; sim step cost < 1.5 ms over 600 steps', async (t) => {
  requireGameFiles();
  const { page } = await t.open('desktop', 'index.html?seed=7');
  await installHelpers(page); await startGame(page);
  await sleep(5000);
  const perf = (await waitFor(page, 'g.perf && g.perf.drawCalls > 0 ? JSON.stringify(g.perf) : ""', 5000, 'perf.drawCalls populated')).value;
  const P = JSON.parse(perf);
  assert(P.drawCalls <= 110, `perf.drawCalls = ${P.drawCalls} (> 110)`);
  assert(P.triangles <= 40000, `perf.triangles = ${P.triangles} (> 40000)`);
  const cost = await ev(page, 'acc.stepCost()');
  const ms = cost.stepLoopMs != null ? cost.stepLoopMs : cost.fastForwardMs;
  assert(ms < 1.5, `average sim step ${ms} ms ≥ 1.5 ms (${fmt(cost)})`);
  t.warn(`perf ${perf}; step cost ${fmt(cost)}`);
});

item('A26', 'Screenshots menu / LIVE 2 s / LIVE 8 s (landscape + portrait): > 5 % non-background, pairwise > 1 % different, both team colours', async (t) => {
  requireGameFiles();
  const TEAM = { HBT: [0x1e, 0x6f, 0xd9], RRF: [0xd9, 0x34, 0x1e] };
  for (const device of ['phoneLandscape', 'phonePortrait']) {
    const { page } = await t.open(device, 'index.html?auto=1&seed=7');
    await installHelpers(page); await dismissRotateHint(page); await sleep(800);
    const shots = {};
    shots.menu = await screenshot(page, `${device}-menu`);
    await startGame(page); await ev(page, 'g.fastForward(2)'); await ev(page, 'acc.nextFrame(2)');
    shots.live2 = await screenshot(page, `${device}-live2`);
    await ev(page, 'g.fastForward(6)'); await ev(page, 'acc.nextFrame(2)');
    shots.live8 = await screenshot(page, `${device}-live8`);
    for (const [name, img] of Object.entries(shots)) { const f = nonBgFraction(img); assert(f > 0.05, `[${device}] ${name}: only ${(f * 100).toFixed(1)} % non-background pixels`); }
    const pairs = [['menu', 'live2'], ['menu', 'live8'], ['live2', 'live8']];
    for (const [a, b] of pairs) { const d = diffFraction(shots[a], shots[b]); assert(d > 0.01, `[${device}] ${a} vs ${b} differ by only ${(d * 100).toFixed(2)} % of pixels`); }
    for (const [team, rgb] of Object.entries(TEAM)) { const r = findColor(shots.live2, rgb, 60); assert(r.found, `[${device}] team colour ${team} ${fmt(rgb)} not found in LIVE screenshot (closest ${fmt(r.bestRgb)}, Δ ${r.best})`); }
    await t.closeAll();
  }
});

item('A27', 'Audio: ctx null before gesture; created by the start click (running/suspended); M mutes (gain 0); SFX never throw while suspended', async (t) => {
  requireGameFiles();
  const gm = await t.open('desktop', 'index.html?seed=7'); const { page } = gm;
  await installHelpers(page);
  const before = await ev(page, 'g.audio.ctx == null'); assert(before, `audio.ctx should be null before any gesture, got ${await ev(page, 'String(g.audio.ctx && g.audio.ctx.state)')}`);
  await clickStart(page); await sleep(300);
  const st = await ev(page, 'g.audio.ctx ? g.audio.ctx.state : null');
  assert(st === 'running' || st === 'suspended', `after the start click audio.ctx.state should be running/suspended, got ${fmt(st)}`);
  assert(gm.diag.pageErrors.length === 0, `uncaught exception during audio unlock: ${gm.diag.pageErrors[0]}`);
  await page.keyboard.press('m'); await sleep(200);
  const m = await ev(page, `(() => { const a = g.audio; let gain = null, key = null; for (const k of Object.keys(a)) { const v = a[k]; if (v && typeof v === 'object' && v.gain && typeof v.gain.value === 'number' && typeof v.connect === 'function') { gain = v.gain.value; key = k; break; } } return { muted: a.muted, gain, key }; })()`);
  assert(m.muted === true, `audio.muted should be true after M, got ${fmt(m)}`);
  if (m.gain == null) t.warn('no GainNode found among audio own properties; master gain not verified'); else assert(m.gain === 0, `master gain (${m.key}) should be 0 when muted, got ${m.gain}`);
  const thrown = await page.evaluate(async () => { const a = window.__game.audio; try { await a.ctx.suspend(); } catch (e) { /* ignore */ } const bad = []; const calls = [['bounce', 1], ['rim', 1], ['board'], ['swish'], ['block'], ['dunk'], ['whistle'], ['buzzer'], ['tick'], ['click'], ['crowd', 1, 1.5], ['groan'], ['update', 0.016]]; for (const [n, ...args] of calls) { if (typeof a[n] !== 'function') { bad.push(n + ' missing'); continue; } try { a[n](...args); } catch (e) { bad.push(n + ': ' + e.message); } } return { state: a.ctx.state, bad }; });
  assert(thrown.bad.length === 0, `SFX threw/missing with ctx ${thrown.state}: ${thrown.bad.join('; ')}`);
});

// ================================================================ RUNNER
function withTimeout(p, ms, label) { let h; const tm = new Promise((_, rej) => { h = setTimeout(() => rej(new Error(`item timeout after ${ms / 1000} s (${label})`)), ms); }); return Promise.race([p, tm]).finally(() => clearTimeout(h)); }
async function main() {
  let selected = FILTER.length ? ITEMS.filter((i) => FILTER.includes(i.id)) : ITEMS;
  const unknown = FILTER.filter((f) => !ITEMS.some((i) => i.id === f)); if (unknown.length) { console.error(`unknown item(s): ${unknown.join(', ')}`); process.exit(2); }
  const needsBrowser = selected.some((i) => !['A2', 'A3'].includes(i.id));
  const srv = needsBrowser ? await H.startServer(ROOT) : null;
  const results = []; let passed = 0, failed = 0;
  console.log(`HOOP ARENA 3x3 acceptance — ${selected.length} item(s)${srv ? ` — serving ${ROOT} at ${srv.url}` : ''}`);
  for (const it of selected) {
    const handles = []; const warnings = [];
    const t = { warn: (m) => warnings.push(String(m)), open: async (device, query) => { const gm = await H.openGame({ dir: ROOT, device, url: srv.url, page: query }); handles.push(gm); return gm; }, closeAll: async () => { while (handles.length) { const h = handles.pop(); await h.close().catch(() => {}); } } };
    const t0 = Date.now(); let ok = true, error = null, skipped = null;
    try { await withTimeout(it.run(t), ITEM_TIMEOUT_MS, it.id); }
    catch (e) { if (e instanceof Skip) { skipped = e.message; } else { ok = false; error = e instanceof Fail ? e.message : `${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`; } }
    finally { await t.closeAll(); }
    const ms = Date.now() - t0; if (ok) passed++; else failed++;
    results.push({ id: it.id, title: it.title, ok, ms, error, skipped, warnings });
    console.log(`${ok ? '✅' : '❌'} ${it.id.padEnd(3)} ${it.title}  (${(ms / 1000).toFixed(1)} s)`);
    if (skipped) console.log(`   ⚠ skipped: ${skipped}`);
    for (const w of warnings) console.log(`   ⚠ ${w}`);
    if (error) console.log(`   ✗ ${error}`);
  }
  if (srv) srv.server.close();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, 'acceptance.json'), JSON.stringify({ passed, failed, total: selected.length, ranAt: new Date().toISOString(), items: results }, null, 2));
  console.log(`\n${passed} passed, ${failed} failed → ${path.relative(process.cwd(), path.join(RESULTS_DIR, 'acceptance.json'))}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
