/* 忍界传说 · ui.js — UI framework (stage fit/rotate, router, top bar, modals, toasts, art cache,
 * drag scrollers, icons) + 主城 / 设置 / 欢迎. Screen modules live in js/ui-*.js and register via
 * NG.ui.screen(name, def). Boot runs on DOMContentLoaded, after every script has executed. */
(function () {
  'use strict';
  var NG = window.NG = window.NG || {};
  var U = NG.ui = NG.ui || {};
  var W = 1280, H = 720;
  U.W = W; U.H = H;

  /* ============================== helpers ============================== */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ESC[m]; }); };
  U.h = function (html) { var t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstElementChild; };
  U.$ = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  U.fmt = function (n) { try { return NG.fmt(n); } catch (e) { return String(Math.floor(n || 0)); } };
  U.pct = function (v, d) { v = Number(v) || 0; return (v * 100).toFixed(d == null ? 1 : d).replace(/\.0+$/, '') + '%'; };
  U.svgURL = function (svg) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); };
  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.raf = function () { return new Promise(function (r) { requestAnimationFrame(function () { r(); }); }); };
  var warned = {};
  U.warn = function (key, e) { if (warned[key]) return; warned[key] = 1; try { console.warn('[NG.ui]', key, e && e.message ? e.message : e || ''); } catch (x) {} };

  /* ============================== engine access (never throws) ============================== */
  U.G = function () { return NG.game || {}; };
  U.state = function () { var g = NG.game; return (g && g.state) || {}; };
  U.call = function (name) {
    var g = NG.game, args = Array.prototype.slice.call(arguments, 1);
    if (!g || typeof g[name] !== 'function') { U.warn('missing NG.game.' + name); return undefined; }
    try { return g[name].apply(g, args); } catch (e) { U.warn('NG.game.' + name + ' threw', e); return undefined; }
  };
  U.char = function (id) {
    if (id && typeof id === 'object') return id;
    var c = null;
    try { c = (NG.game && NG.game.char && NG.game.char(id)) || null; } catch (e) { c = null; }
    return c || (NG.CHAR_MAP && NG.CHAR_MAP[id]) || null;
  };
  U.owned = function (id) { var st = U.state(); return (st.roster && st.roster[id]) || null; };
  U.chars = function () { var l = U.call('chars'); return Array.isArray(l) ? l : (NG.CHARS || []); };
  U.ownedList = function () {
    var l = U.call('ownedList');
    if (!Array.isArray(l)) {
      var ro = U.state().roster || {};
      l = Object.keys(ro).map(function (id) { return { id: id, c: U.char(id), e: ro[id] }; });
    }
    return l.filter(function (x) { return x && x.c; });
  };
  U.settings = function () {
    var st = U.state(); var s = st.settings || {};
    return { speed: s.speed || 1, auto: s.auto !== false, rotate: s.rotate || 'auto', sound: !!s.sound };
  };
  U.setSetting = function (k, v) {
    var g = NG.game, st = U.state();
    if (g && typeof g.setSetting === 'function') { try { g.setSetting(k, v); } catch (e) { U.warn('setSetting', e); } }
    else { st.settings = st.settings || {}; st.settings[k] = v; U.call('save'); }
    if (k === 'rotate') fit();
  };
  U.rarity = function (c) { var r = c && c.rarity; return NG.RARITIES && NG.RARITIES[r] ? r : 'R'; };
  U.rcolor = function (c) { var r = NG.RARITIES && NG.RARITIES[U.rarity(c)]; return (r && r.color) || '#3d9bff'; };
  U.charName = function (c) { return (c && c.name) || '???'; };
  U.charForm = function (c) { return (c && (c.form || c.title)) || ''; };
  U.skill = function (c, key) { return (c && c.skills && c.skills[key]) || null; };

  /* ============================== art (cached data URLs, with fallbacks) ============================== */
  var artCache = {};
  function toURL(v) {
    if (!v || typeof v !== 'string') return null;
    if (v.indexOf('data:') === 0 || v.indexOf('blob:') === 0 || /^https?:|^\.?\//.test(v)) return v;
    if (v.trim().charAt(0) === '<') return U.svgURL(v);
    return null;
  }
  U.art = function (kind, subj, a, b) {
    var sid = subj && typeof subj === 'object' ? (subj.id || subj.name || 'x') : String(subj);
    var key = kind + '|' + sid + '|' + a + '|' + b;
    if (artCache[key]) return artCache[key];
    var url = null, A = NG.art;
    if (A) {
      try {
        if (typeof A[kind + 'URL'] === 'function') url = toURL(A[kind + 'URL'](subj, a, b));
        if (!url && typeof A[kind] === 'function') url = toURL(A[kind](subj, a, b));
      } catch (e) { U.warn('NG.art.' + kind + ' failed for ' + sid, e); url = null; }
    }
    if (!url) url = fallbackArt(kind, subj, a, b);
    artCache[key] = url;
    return url;
  };
  U.avatarURL = function (c, size) { return U.art('avatar', c, size || 128); };
  U.bustURL = function (c) { return U.art('bust', c, 560, 640); };
  U.skillIconURL = function (c, key) { return U.art('skillIcon', c, key, 96); };
  U.emblemURL = function (f, size) { return U.art('emblem', f || 'other', size || 64); };
  U.elementURL = function (el, size) { return U.art('element', el || 'none', size || 32); };
  U.bgURL = function (kind, w, h) { return U.art('background', kind || 'village', w || W, h || H); };

  function fallbackArt(kind, s, a, b) {
    var c = s && typeof s === 'object' ? s : null;
    var fac = (NG.FACTIONS && c && NG.FACTIONS[c.faction]) || null;
    var col = (c && c.art && (c.art.aura || c.art.hairColor || c.art.bodyColor)) || (fac && fac.color) || '#4a6fd8';
    var nm = U.esc(((c && c.name) || '忍').slice(-2, -1) || '忍');
    if (kind === 'avatar') {
      return U.svgURL('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><radialGradient id="g" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="' + col + '"/></radialGradient></defs>' +
        '<rect width="128" height="128" fill="url(#g)"/><circle cx="64" cy="52" r="26" fill="#0d1640" opacity=".85"/><path d="M18 128c4-30 22-44 46-44s42 14 46 44z" fill="#0d1640" opacity=".85"/>' +
        '<text x="64" y="62" font-size="28" font-weight="900" text-anchor="middle" fill="#fff" font-family="sans-serif">' + nm + '</text></svg>');
    }
    if (kind === 'bust') {
      return U.svgURL('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 640"><defs><radialGradient id="a" cx=".5" cy=".45" r=".5"><stop offset="0" stop-color="' + col + '" stop-opacity=".8"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></radialGradient><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3a78"/><stop offset="1" stop-color="#0b1236"/></linearGradient></defs>' +
        '<ellipse cx="280" cy="330" rx="270" ry="300" fill="url(#a)"/><circle cx="280" cy="210" r="96" fill="url(#b)" stroke="#000" stroke-width="6"/><path d="M70 640c10-190 90-300 210-300s200 110 210 300z" fill="url(#b)" stroke="#000" stroke-width="6"/>' +
        '<text x="280" y="236" font-size="80" font-weight="900" text-anchor="middle" fill="#fff" font-family="sans-serif" opacity=".9">' + nm + '</text></svg>');
    }
    if (kind === 'skillIcon') {
      var sk = c && c.skills && c.skills[a], fx = (NG.FX && sk && NG.FX[sk.fx]) || { c1: '#3a6fd8', c2: '#bfe0ff', k: '忍' };
      if (a === 'passive' || a === 'awaken') fx = { c1: a === 'awaken' ? '#d14b8f' : '#3d8f5a', c2: '#ffe9f4', k: a === 'awaken' ? '破' : '被' };
      return U.svgURL('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + fx.c2 + '"/><stop offset=".55" stop-color="' + fx.c1 + '"/><stop offset="1" stop-color="#0b1236"/></linearGradient></defs>' +
        '<rect width="96" height="96" rx="12" fill="url(#g)"/><text x="48" y="64" font-size="48" font-weight="900" text-anchor="middle" fill="#fff" stroke="#0b1236" stroke-width="3" paint-order="stroke" font-family="sans-serif">' + U.esc(fx.k || '忍') + '</text></svg>');
    }
    if (kind === 'emblem') {
      var f = (NG.FACTIONS && NG.FACTIONS[s]) || { color: '#9aa3ad', kanji: '忍' };
      return U.svgURL('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="#0d1640" stroke="' + f.color + '" stroke-width="4"/><text x="32" y="43" font-size="30" font-weight="900" text-anchor="middle" fill="' + f.color + '" font-family="sans-serif">' + U.esc(f.kanji) + '</text></svg>');
    }
    if (kind === 'element') {
      var e = (NG.ELEMENTS && NG.ELEMENTS[s]) || { color: '#c9c9c9', name: '体' };
      return U.svgURL('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="' + e.color + '" stroke="#fff" stroke-width="2"/><text x="16" y="22" font-size="16" font-weight="900" text-anchor="middle" fill="#fff" font-family="sans-serif">' + U.esc(e.name) + '</text></svg>');
    }
    if (kind === 'background') {
      var pal = { village: ['#1d3b7a', '#e88a4a'], summon: ['#2a1650', '#ff6a3c'], forest: ['#0f3a2a', '#3f8f5a'], valley: ['#1b2a4a', '#6a8fc0'], desert: ['#5a3a1a', '#e0a050'], mist: ['#1f3550', '#9fc0d8'], rain: ['#1a2238', '#5a6f90'], battlefield: ['#2a1a1a', '#c0603a'], moon: ['#0b0f2a', '#c9c3ff'], city_night: ['#141a3a', '#5a5f9a'] }[s] || ['#141a3a', '#5a5f9a'];
      return U.svgURL('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b1c"/><stop offset=".6" stop-color="' + pal[0] + '"/><stop offset="1" stop-color="' + pal[1] + '"/></linearGradient></defs>' +
        '<rect width="1280" height="720" fill="url(#s)"/><circle cx="1010" cy="140" r="60" fill="#fff6d8" opacity=".55"/><path d="M0 560 L120 470 L260 540 L420 430 L560 520 L720 440 L880 530 L1040 450 L1180 520 L1280 480 V720 H0Z" fill="#070b1c" opacity=".7"/></svg>');
    }
    return U.svgURL('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="' + col + '"/></svg>');
  }

  /* ============================== UI icon set (decorative SVG → data URLs) ============================== */
  var ICON_SVG = {
    coin: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="a" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#fffbe0"/><stop offset=".45" stop-color="#ffd23f"/><stop offset="1" stop-color="#b87800"/></radialGradient></defs><circle cx="32" cy="32" r="27" fill="url(#a)" stroke="#6b4300" stroke-width="3"/><circle cx="32" cy="32" r="20" fill="none" stroke="#a86a00" stroke-width="2" opacity=".7"/><path d="M32 17c4 6 9 9 15 10-6 2-11 5-15 12-4-7-9-10-15-12 6-1 11-4 15-10z" fill="#c98a00" opacity=".55"/><rect x="26" y="26" width="12" height="12" rx="1.5" fill="#7a4d00" stroke="#fff2b0" stroke-width="1.5"/><ellipse cx="22" cy="18" rx="8" ry="4" fill="#fff" opacity=".55" transform="rotate(-30 22 18)"/></svg>',
    gem: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd6f6"/><stop offset=".45" stop-color="#d64cc8"/><stop offset="1" stop-color="#5a1a8a"/></linearGradient></defs><path d="M37 6c12 1 21 11 20 23-1 11-10 19-21 19-6 0-10 3-12 10-1 3-4 2-5-1-4-11 0-23 8-30-6-3-8-11-3-16 3-3 8-5 13-5z" fill="url(#a)" stroke="#3a0a52" stroke-width="3" stroke-linejoin="round"/><circle cx="38" cy="25" r="7" fill="#3a0a52"/><circle cx="38" cy="25" r="3.5" fill="#ffd6f6"/><path d="M28 12c5-3 12-3 17 1" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/></svg>',
    ticket: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a7a"/><stop offset=".5" stop-color="#e0342a"/><stop offset="1" stop-color="#8a1010"/></linearGradient><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b8"/><stop offset="1" stop-color="#d49a10"/></linearGradient></defs><g transform="rotate(-14 32 32)"><rect x="6" y="16" width="52" height="32" rx="4" fill="url(#a)" stroke="#4a0606" stroke-width="2.5"/><circle cx="6" cy="32" r="5" fill="#0b1236"/><circle cx="58" cy="32" r="5" fill="#0b1236"/><rect x="12" y="21" width="40" height="22" rx="2" fill="none" stroke="url(#b)" stroke-width="2.5"/><path d="M32 23l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6-4.5-4 6-1z" fill="url(#b)" stroke="#6b3a00" stroke-width="1"/></g></svg>',
    scroll: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8e0"/><stop offset="1" stop-color="#e0c890"/></linearGradient><linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a58c8"/><stop offset=".5" stop-color="#8cc2ff"/><stop offset="1" stop-color="#1d3b9a"/></linearGradient></defs><g transform="rotate(-30 32 32)"><rect x="12" y="20" width="40" height="24" fill="url(#a)" stroke="#5a4020" stroke-width="2"/><path d="M18 27h28M18 32h22M18 37h26" stroke="#8a6a30" stroke-width="2"/><rect x="6" y="16" width="8" height="32" rx="3" fill="url(#b)" stroke="#0b1f5c" stroke-width="2"/><rect x="50" y="16" width="8" height="32" rx="3" fill="url(#b)" stroke="#0b1f5c" stroke-width="2"/><circle cx="32" cy="32" r="5" fill="#d8302a" stroke="#600" stroke-width="1.5"/></g></svg>',
    exp: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="a" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#e0fff0"/><stop offset=".5" stop-color="#3fd38a"/><stop offset="1" stop-color="#0a6a3a"/></radialGradient></defs><circle cx="32" cy="32" r="25" fill="url(#a)" stroke="#063a1f" stroke-width="3"/><text x="32" y="39" font-size="18" font-weight="900" text-anchor="middle" fill="#fff" stroke="#063a1f" stroke-width="3" paint-order="stroke" font-family="Arial,sans-serif">EXP</text></svg>',
    power: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b8"/><stop offset=".5" stop-color="#ff9a1a"/><stop offset="1" stop-color="#c0300a"/></linearGradient></defs><path d="M32 4c4 10 14 14 14 28 0 9-6 16-14 18-8-2-14-9-14-18 0-6 3-10 6-13 0 5 2 8 5 9-1-9 1-17 3-24z" fill="url(#a)" stroke="#5a1500" stroke-width="3" stroke-linejoin="round"/><path d="M32 30c3 4 6 6 6 11 0 4-3 7-6 8-3-1-6-4-6-8 0-5 3-7 6-11z" fill="#fff6c8"/></svg>',
    starOn: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#fff3c4"/><stop offset="1" stop-color="#ffc93a"/></linearGradient></defs><path d="M24 3l6.2 13.3 14.6 1.6-10.9 9.9 3 14.4L24 34.9 11.1 42.2l3-14.4L3.2 17.9l14.6-1.6z" fill="url(#a)" stroke="#173a8a" stroke-width="3" stroke-linejoin="round"/><path d="M24 9l4 9 9 1" fill="none" stroke="#fff" stroke-width="2" opacity=".8"/></svg>',
    starOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M24 3l6.2 13.3 14.6 1.6-10.9 9.9 3 14.4L24 34.9 11.1 42.2l3-14.4L3.2 17.9l14.6-1.6z" fill="#1a2350" fill-opacity=".85" stroke="#5c6fa8" stroke-width="3" stroke-linejoin="round"/></svg>',
    back: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M25 6L11 20l14 14" fill="none" stroke="#0a1233" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M25 6L11 20l14 14" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    menu: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g stroke="#0a1233" stroke-width="7" stroke-linecap="round"><path d="M7 10h1M15 10h18M7 20h1M15 20h18M7 30h1M15 30h18"/></g><g stroke="#fff" stroke-width="3.6" stroke-linecap="round"><path d="M7 10h1M15 10h18M7 20h1M15 20h18M7 30h1M15 30h18"/></g></svg>',
    info: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12.5" fill="none" stroke="#e8f2ff" stroke-width="2.6"/><circle cx="16" cy="16" r="6" fill="none" stroke="#e8f2ff" stroke-width="2.4"/><path d="M20.5 20.5l3.5 3.5" stroke="#e8f2ff" stroke-width="2.6" stroke-linecap="round"/></svg>',
    lock: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="#e8eefc" stroke-width="2.6"/><rect x="4.5" y="10" width="15" height="11" rx="2" fill="#e8eefc" stroke="#1a2350" stroke-width="1"/><rect x="11" y="13.5" width="2" height="4" rx="1" fill="#1a2350"/></svg>',
    chest: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100"><defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c0602a"/><stop offset="1" stop-color="#6a2a0a"/></linearGradient><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b8"/><stop offset=".5" stop-color="#ffc83a"/><stop offset="1" stop-color="#a86a00"/></linearGradient></defs><path d="M14 44h92v46a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4z" fill="url(#w)" stroke="#2a0d00" stroke-width="3"/><path d="M12 44c0-22 14-34 48-34s48 12 48 34z" fill="url(#w)" stroke="#2a0d00" stroke-width="3"/><path d="M12 44h96v10H12z" fill="url(#g)" stroke="#2a0d00" stroke-width="3"/><path d="M30 12v82M90 12v82" stroke="url(#g)" stroke-width="8"/><path d="M30 12v82M90 12v82" stroke="#2a0d00" stroke-width="1" opacity=".5"/><rect x="48" y="40" width="24" height="26" rx="4" fill="url(#g)" stroke="#2a0d00" stroke-width="3"/><circle cx="60" cy="51" r="4" fill="#2a0d00"/><path d="M40 20c8-4 22-5 32-2" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".45" fill="none"/></svg>',
    gear: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M27.5 4l1.2 5.4a15 15 0 0 1 4.2 2.4l5.2-1.8 3.5 6-4.1 3.7a15 15 0 0 1 0 4.8l4.1 3.7-3.5 6-5.2-1.8a15 15 0 0 1-4.2 2.4L27.5 44h-7l-1.2-5.4a15 15 0 0 1-4.2-2.4l-5.2 1.8-3.5-6 4.1-3.7a15 15 0 0 1 0-4.8L6.4 16.1l3.5-6 5.2 1.8a15 15 0 0 1 4.2-2.4L20.5 4z" fill="#dfe9ff" stroke="#0a1233" stroke-width="3" stroke-linejoin="round"/><circle cx="24" cy="24" r="6.5" fill="#2a4fb8" stroke="#0a1233" stroke-width="3"/></svg>',
    book: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M6 10c6-3 12-3 18 1v29c-6-4-12-4-18-1z" fill="#ffe9a6" stroke="#0a1233" stroke-width="3" stroke-linejoin="round"/><path d="M42 10c-6-3-12-3-18 1v29c6-4 12-4 18-1z" fill="#fff6d8" stroke="#0a1233" stroke-width="3" stroke-linejoin="round"/></svg>',
    mail: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect x="6" y="11" width="36" height="26" rx="3" fill="#fff6d8" stroke="#0a1233" stroke-width="3"/><path d="M7 13l17 13 17-13" fill="none" stroke="#0a1233" stroke-width="3"/></svg>',
    arrow: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 64"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9fd0ff"/></linearGradient></defs><path d="M30 6L8 32l22 26" fill="none" stroke="#0a1233" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 6L8 32l22 26" fill="none" stroke="url(#a)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    leaf: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b8"/><stop offset=".5" stop-color="#ffd25a"/><stop offset="1" stop-color="#a86a00"/></linearGradient></defs><circle cx="50" cy="50" r="44" fill="none" stroke="url(#g)" stroke-width="4"/><circle cx="50" cy="50" r="37" fill="none" stroke="url(#g)" stroke-width="1.5" stroke-dasharray="3 4"/><path d="M50 22c16 0 26 12 24 26-2 12-13 20-25 18-9-1-14-9-12-16 2-6 9-9 14-6 4 2 4 8 0 9" fill="none" stroke="url(#g)" stroke-width="6" stroke-linecap="round"/><path d="M50 22L70 6 58 26" fill="url(#g)"/><path d="M28 70l-10 18M72 70l10 18" stroke="url(#g)" stroke-width="4" stroke-linecap="round"/></svg>',
    corner: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 46 46"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffbe0"/><stop offset=".5" stop-color="#ffd25a"/><stop offset="1" stop-color="#9a6206"/></linearGradient></defs><path d="M4 30V10a6 6 0 0 1 6-6h20" fill="none" stroke="#3a2400" stroke-width="7" stroke-linecap="round"/><path d="M4 30V10a6 6 0 0 1 6-6h20" fill="none" stroke="url(#g)" stroke-width="4" stroke-linecap="round"/><path d="M12 12l10 2-8 8z" fill="url(#g)" stroke="#3a2400" stroke-width="1.5"/><circle cx="34" cy="4.5" r="3.5" fill="url(#g)" stroke="#3a2400" stroke-width="1.2"/><circle cx="4.5" cy="34" r="3.5" fill="url(#g)" stroke="#3a2400" stroke-width="1.2"/></svg>',
    refresh: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M38 24a14 14 0 1 1-4.1-9.9" fill="none" stroke="#0a1233" stroke-width="9" stroke-linecap="round"/><path d="M38 24a14 14 0 1 1-4.1-9.9" fill="none" stroke="#ffd25a" stroke-width="5" stroke-linecap="round"/><path d="M28 6l10 8-12 4z" fill="#ffd25a" stroke="#0a1233" stroke-width="2.5" stroke-linejoin="round"/></svg>',
    swords: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><g stroke="#0a1233" stroke-width="7" stroke-linecap="round"><path d="M8 8l26 26M40 8L14 34"/></g><g stroke="#e8f2ff" stroke-width="3.5" stroke-linecap="round"><path d="M8 8l26 26M40 8L14 34"/></g><g stroke="#ffd25a" stroke-width="5" stroke-linecap="round"><path d="M30 38l8-8M18 38l-8-8"/></g></svg>'
  };
  // winged title plate (技能)
  ICON_SVG.wings = (function () {
    function wing(m) {
      var f = '';
      var fe = [[150, 60, 22, 18], [150, 64, 30, 40], [150, 68, 46, 62], [150, 72, 70, 80]];
      fe.forEach(function (p, i) {
        var x0 = p[0] - 44, y0 = p[1], x1 = p[2], y1 = p[3];
        f += '<path d="M' + x0 + ' ' + y0 + ' Q ' + ((x0 + x1) / 2) + ' ' + (y1 - 22 + i * 4) + ' ' + x1 + ' ' + y1 + ' Q ' + ((x0 + x1) / 2 + 8) + ' ' + (y1 + 4) + ' ' + (x0 + 4) + ' ' + (y0 + 10) + ' Z" fill="url(#wf)" stroke="#1d3b8a" stroke-width="2.2" stroke-linejoin="round"/>';
      });
      return '<g' + (m ? ' transform="translate(300 0) scale(-1 1)"' : '') + '>' + f + '</g>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 92"><defs>' +
      '<linearGradient id="wf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#cfe6ff"/><stop offset="1" stop-color="#7fb2ff"/></linearGradient>' +
      '<linearGradient id="pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4fbff"/><stop offset=".5" stop-color="#a9d2ff"/><stop offset="1" stop-color="#5c93ea"/></linearGradient>' +
      '<radialGradient id="md" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#9cc8ff"/><stop offset="1" stop-color="#3d6fd0"/></radialGradient></defs>' +
      wing(false) + wing(true) +
      '<circle cx="150" cy="58" r="30" fill="url(#md)" stroke="#1d3b8a" stroke-width="3"/><circle cx="150" cy="58" r="23" fill="none" stroke="#fff" stroke-width="2" opacity=".8"/>' +
      '<path d="M86 36 L104 24 H196 L214 36 L196 60 H104 Z" fill="url(#pl)" stroke="#1d3b8a" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M100 30 H200" stroke="#fff" stroke-width="2" opacity=".85"/><circle cx="150" cy="86" r="5" fill="url(#md)" stroke="#1d3b8a" stroke-width="2"/></svg>';
  })();
  ICON_SVG.wingBadge = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 24"><defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9aa9c8"/></linearGradient><radialGradient id="c" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#e8dcff"/><stop offset="1" stop-color="#6a5aa8"/></radialGradient></defs>' +
    '<path d="M30 12 Q16 2 4 4 Q12 10 10 12 Q14 16 30 16z" fill="url(#w)" stroke="#2a3050" stroke-width="1.5"/><path d="M50 12 Q64 2 76 4 Q68 10 70 12 Q66 16 50 16z" fill="url(#w)" stroke="#2a3050" stroke-width="1.5"/>' +
    '<circle cx="40" cy="12" r="10" fill="url(#c)" stroke="#f4f0ff" stroke-width="2"/></svg>';

  var iconCache = {};
  U.iconURL = function (k) { return iconCache[k] || (iconCache[k] = ICON_SVG[k] ? U.svgURL(ICON_SVG[k]) : ''); };
  U.icon = function (k, cls) { return '<img class="ic ' + (cls || '') + '" src="' + U.iconURL(k) + '" alt="" draggable="false">'; };
  U.CUR = {
    coins: { name: '铜币', icon: 'coin', tip: '铜币可通过冒险推图、挂机收益获得' },
    gems: { name: '勾玉', icon: 'gem', tip: '勾玉可通过关卡首通获得，招募券不足时150勾玉/抽' },
    tickets: { name: '招募券', icon: 'ticket', tip: '招募券用于召唤忍者，开局赠送1000张' },
    scrolls: { name: '忍术卷轴', icon: 'scroll', tip: '忍术卷轴用于升级技能，可通过冒险与挂机获得' },
    exp: { name: '经验', icon: 'exp', tip: '' }
  };

  /* ============================== shared components ============================== */
  U.rarHTML = function (r, cls) { r = NG.RARITIES && NG.RARITIES[r] ? r : 'R'; return '<span class="rar r-' + r + ' ' + (cls || '') + '">' + r + '</span>'; };
  U.starsHTML = function (n, max, size) {
    n = n | 0; max = max || NG.MAX_STAR || 6; var s = '<span class="stars"' + (size ? ' style="font-size:' + size + 'px"' : '') + '>';
    for (var i = 0; i < max; i++) s += '<img src="' + U.iconURL(i < n ? 'starOn' : 'starOff') + '" alt="">';
    return s + '</span>';
  };
  U.chipHTML = function (t, cls) { var col = (NG.TAGS && NG.TAGS[t]) || '#3aa0d8'; return '<span class="chip ' + (cls || '') + '" style="--c:' + col + '">' + U.esc(t) + '</span>'; };
  U.chipsHTML = function (list, cls) { return (Array.isArray(list) ? list : []).slice(0, 3).map(function (t) { return U.chipHTML(t, cls); }).join(''); };
  U.avatarHTML = function (c, o) {
    o = o || {};
    var r = U.rarity(c), url = o.lazy ? '' : U.avatarURL(c, 128);
    return '<div class="av r-' + r + (o.sel ? ' sel' : '') + (o.off ? ' off' : '') + (o.cls ? ' ' + o.cls : '') + '" style="--s:' + (o.size || 84) + 'px">' +
      '<div class="av-bg"><img ' + (o.lazy ? 'data-av="' + U.esc(c && c.id) + '" data-src="lazy"' : 'src="' + url + '"') + ' alt="" draggable="false"></div>' +
      (o.lv != null ? '<div class="av-lv">Lv.' + o.lv + '</div>' : '') + '</div>';
  };
  U.rewardHTML = function (k, v, first) {
    var m = U.CUR[k] || { icon: 'coin' };
    return '<div class="rw">' + (first ? '<span class="first">首通</span>' : '') + '<img src="' + U.iconURL(m.icon) + '" alt=""><b>' + U.fmt(v) + '</b></div>';
  };
  U.cornersHTML = function () { var u = U.iconURL('corner'); return ['tl', 'tr', 'bl', 'br'].map(function (k) { return '<img class="corner ' + k + '" src="' + u + '" alt="">'; }).join(''); };
  U.roleHTML = function (role) { var r = NG.ROLES && NG.ROLES[role]; if (!r) return ''; return '<span class="role" style="--c:' + r.color + '">' + U.esc(r.name) + '</span>'; };

  /* lazy images inside scrollers */
  var io = null;
  function ioLoad(img) {
    var src = img.getAttribute('data-src'); if (!src) return;
    img.removeAttribute('data-src');
    var av = img.getAttribute('data-av');
    if (av != null) { src = U.avatarURL(U.char(av) || av, Number(img.getAttribute('data-size')) || 128); img.removeAttribute('data-av'); }
    img.onload = function () { img.classList.add('ld'); };
    img.decoding = 'async'; img.src = src;
    if (img.complete) img.classList.add('ld');
  }
  /* SVG <img>s are parsed on the main thread when they load, so visible images are fed in a few per
   * frame instead of all at once — keeps the 181-card grids from janking when a screen opens. */
  var loadQ = [], pumping = false, PER_FRAME = 5;
  function pump() {
    var n = 0;
    while (loadQ.length && n < PER_FRAME) { var im = loadQ.shift(); if (im.isConnected && im.getAttribute('data-src')) { ioLoad(im); n++; } }
    if (loadQ.length) requestAnimationFrame(pump); else pumping = false;
  }
  function enqueue(img) { loadQ.push(img); if (!pumping) { pumping = true; requestAnimationFrame(pump); } }
  U.lazy = function (root) {
    var imgs = U.$$('img[data-src]', root);
    if (!('IntersectionObserver' in window)) { imgs.forEach(enqueue); return; }
    if (!io) io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); enqueue(en.target); } });
    }, { root: null, rootMargin: '240px' });
    imgs.forEach(function (im) { io.observe(im); });
  };
  /* render a long list in chunks (keeps first paint fast) */
  U.chunked = function (container, items, renderFn, opts) {
    opts = opts || {}; var size = opts.size || 30, i = 0, token = {};
    container._chunkToken = token;
    function step() {
      if (container._chunkToken !== token) return;
      var frag = document.createDocumentFragment(), end = Math.min(items.length, i + size);
      for (; i < end; i++) { var el = renderFn(items[i], i); if (el) frag.appendChild(el); }
      container.appendChild(frag); U.lazy(container);
      if (i < items.length) requestAnimationFrame(step); else if (opts.done) opts.done();
    }
    step();
  };

  /* ============================== stage fit / rotation ============================== */
  var stage, app, probe;
  U.view = { s: 1, rot: false, cx: 0, cy: 0 };
  function insets() {
    if (!probe) { probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'; document.body.appendChild(probe); }
    var cs = getComputedStyle(probe);
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }
  function fit() {
    if (!stage) return;
    var vw = window.innerWidth || document.documentElement.clientWidth, vh = window.innerHeight || document.documentElement.clientHeight;
    var ins = insets(), aw = Math.max(100, vw - ins.l - ins.r), ah = Math.max(100, vh - ins.t - ins.b);
    var rot = U.settings().rotate === 'auto' && ah > aw;
    var sw = rot ? ah : aw, sh = rot ? aw : ah;
    var s = Math.min(sw / W, sh / H);
    var cx = ins.l + aw / 2, cy = ins.t + ah / 2;
    stage.style.left = cx + 'px'; stage.style.top = cy + 'px';
    stage.style.transform = 'translate(-50%,-50%)' + (rot ? ' rotate(90deg)' : '') + ' scale(' + s + ')';
    U.view = { s: s, rot: rot, cx: cx, cy: cy };
    document.documentElement.classList.toggle('rotated', rot);
  }
  U.fit = fit;
  /* screen point → stage coordinates (accounts for scale + rotation) */
  U.toStage = function (x, y) {
    var v = U.view, dx = (x - v.cx) / v.s, dy = (y - v.cy) / v.s;
    return v.rot ? { x: W / 2 + dy, y: H / 2 - dx } : { x: W / 2 + dx, y: H / 2 + dy };
  };

  /* ============================== drag scrolling (works rotated, touch & mouse) ============================== */
  var dragSuppressUntil = 0;
  U.wasDrag = function () { return performance.now() < dragSuppressUntil; };
  U.scroller = function (el, axis) {
    axis = axis || 'y';
    el.classList.add('scroller');
    var prop = axis === 'y' ? 'scrollTop' : 'scrollLeft';
    var st = null, vel = 0, raf = 0;
    function pos(e) { var p = U.toStage(e.clientX, e.clientY); return axis === 'y' ? p.y : p.x; }
    el.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      cancelAnimationFrame(raf); vel = 0;
      st = { p0: pos(e), s0: el[prop], moved: false, lp: pos(e), lt: performance.now(), id: e.pointerId };
    });
    function move(e) {
      if (!st || e.pointerId !== st.id) return;
      var p = pos(e), d = p - st.p0;
      if (!st.moved && Math.abs(d) > 8) { st.moved = true; st.p0 = p; d = 0; }
      if (st.moved) {
        el[prop] = st.s0 - d;
        var now = performance.now(), dt = now - st.lt;
        if (dt > 0) vel = vel * 0.6 + ((st.lp - p) / dt) * 0.4;
        st.lp = p; st.lt = now;
        if (e.cancelable) e.preventDefault();
      }
    }
    function up(e) {
      if (!st || e.pointerId !== st.id) return;
      var moved = st.moved; st = null;
      if (moved) {
        dragSuppressUntil = performance.now() + 60;
        var v = vel * 16;
        (function glide() {
          if (Math.abs(v) < 0.4) return;
          el[prop] += v; v *= 0.94; raf = requestAnimationFrame(glide);
        })();
      }
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return el;
  };

  /* ============================== background & particles ============================== */
  var curBg = null;
  U.setBg = function (kind) {
    if (!kind || kind === curBg) return; curBg = kind;
    var imgs = U.$$('#bg .bg-img'), on = imgs.filter(function (i) { return i.classList.contains('on'); })[0] || imgs[0];
    var next = imgs[0] === on ? imgs[1] : imgs[0];
    var url = U.bgURL(kind);
    var ab = U.$('#app-bg'); if (ab) { ab.onload = function () { ab.classList.add('on'); }; ab.src = url; }
    next.onload = function () { next.classList.add('on'); on.classList.remove('on'); };
    next.src = url;
    if (next.complete) { next.classList.add('on'); on.classList.remove('on'); }
  };
  var curPt = null;
  U.setParticles = function (type, n) {
    if (type === curPt) return; curPt = type;
    var box = U.$('#particles'); if (!box) return; box.innerHTML = '';
    if (!type) return;
    n = n || 16; var html = '';
    for (var i = 0; i < n; i++) {
      var x0 = Math.round(Math.random() * W), x1 = x0 + Math.round((Math.random() - .5) * 260);
      var dur = (type === 'petal' ? 12 : 9) + Math.random() * 10, del = -Math.random() * dur, s = (0.5 + Math.random() * 1.2).toFixed(2), o = (0.35 + Math.random() * 0.5).toFixed(2);
      html += '<i class="pt ' + type + '" style="--x0:' + x0 + 'px;--x1:' + x1 + 'px;--s:' + s + ';--o:' + o + ';animation-duration:' + dur.toFixed(1) + 's;animation-delay:' + del.toFixed(1) + 's"></i>';
    }
    box.innerHTML = html;
  };

  /* ============================== toasts ============================== */
  U.toast = function (msg, type) {
    var box = U.$('#toasts'); if (!box || !msg) return;
    var t = U.h('<div class="toast ' + (type || '') + '">' + U.esc(msg) + '</div>');
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 360); }, 1800);
  };
  U.fail = function (res, fallback) { U.toast((res && res.reason) || fallback || '操作失败', 'err'); };

  /* ============================== modals ============================== */
  var modalStack = [];
  U.modal = function (o) {
    o = o || {};
    var mask = U.h('<div class="mask"><div class="modal gframe ' + (o.cls || '') + '">' + U.cornersHTML() +
      (o.title ? '<div class="modal-title">' + U.esc(o.title) + '</div>' : '') +
      (o.close !== false ? '<button class="modal-x" aria-label="关闭"></button>' : '') +
      '<div class="modal-body"></div><div class="modal-btns"></div></div></div>');
    var modal = mask.firstElementChild, body = U.$('.modal-body', modal), btns = U.$('.modal-btns', modal);
    if (o.html != null) body.innerHTML = o.html;
    if (o.el) body.appendChild(o.el);
    var api = { mask: mask, el: modal, body: body, closed: false, closable: o.close !== false };
    api.close = function (why) {
      if (api.closed) return; api.closed = true;
      mask.classList.add('out');
      modalStack = modalStack.filter(function (m) { return m !== api; });
      setTimeout(function () { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 200);
      if (o.onClose) try { o.onClose(why); } catch (e) { U.warn('modal onClose', e); }
    };
    (o.buttons || []).forEach(function (b) {
      var bt = U.h('<button class="btn ' + (b.cls || '') + '">' + b.html + '</button>');
      bt.addEventListener('click', function () { if (U.wasDrag()) return; var r = b.fn ? b.fn(api) : null; if (!b.keep && r !== false) api.close('btn'); });
      btns.appendChild(bt);
    });
    if (!btns.children.length) btns.style.display = 'none';
    var x = U.$('.modal-x', modal); if (x) x.addEventListener('click', function () { api.close('x'); });
    mask.addEventListener('click', function (e) { if (e.target === mask && o.close !== false && o.maskClose !== false) api.close('mask'); });
    U.$('#modals').appendChild(mask);
    modalStack.push(api);
    if (o.onOpen) try { o.onOpen(api); } catch (e) { U.warn('modal onOpen', e); }
    return api;
  };
  U.closeModals = function () { modalStack.slice().forEach(function (m) { m.close('nav'); }); };
  U.confirm = function (o, cb) {
    return U.modal({
      title: o.title || '提示', cls: 'confirm',
      html: '<div class="confirm-text">' + o.text + '</div>' + (o.sub ? '<div class="confirm-sub">' + o.sub + '</div>' : ''),
      buttons: [{ html: o.cancel || '取消', cls: 'dark' }, { html: o.ok || '确定', cls: o.okCls || '', fn: function () { cb && cb(); } }]
    });
  };

  /* ============================== router & top bar ============================== */
  var screens = {}, cur = null, history = [];
  U.screens = screens;
  U.screen = function (name, def) { def.name = name; screens[name] = def; };
  U.current = function () { return cur && cur.name; };
  U.go = function (name, params, opts) {
    opts = opts || {};
    var def = screens[name]; if (!def) { U.warn('no screen ' + name); return; }
    U.closeModals();
    if (cur && !opts.back && !opts.replace && cur.name !== name && !(def.root)) history.push({ name: cur.name, params: cur.params });
    if (def.root) history = [];
    while (history.length && history[history.length - 1].name === name) history.pop();
    if (history.length > 12) history.shift();
    var prev = cur;
    if (prev) {
      var pd = screens[prev.name];
      if (pd.leave) try { pd.leave(); } catch (e) { U.warn('leave ' + prev.name, e); }
      if (prev.name !== name) {
        var pel = pd.el; pel.classList.add('leaving'); pel.classList.remove('on');
        setTimeout(function () { pel.classList.remove('leaving'); }, 340);
      }
    }
    if (!def.el) {
      def.el = U.h('<div class="scr scr-' + name + '"></div>');
      U.$('#screens').appendChild(def.el);
      if (def.build) try { def.build(def.el); } catch (e) { console.error(e); }
    }
    cur = { name: name, params: params || {} };
    if (name !== 'home') armBack();
    stage.setAttribute('data-scr', name);
    U.setBg(typeof def.bg === 'function' ? def.bg(params || {}) : (def.bg || 'village'));
    U.setParticles(def.particles === undefined ? 'spark' : def.particles);
    topbar(def, params || {});
    if (def.show) try { def.show(def.el, params || {}); } catch (e) { console.error(e); }
    requestAnimationFrame(function () { def.el.classList.add('on'); });
  };
  U.back = function () {
    var def = cur && screens[cur.name];
    if (def && def.onBack) { var r; try { r = def.onBack(); } catch (e) { r = null; } if (r === false) return; }
    var h = history.pop();
    if (h) U.go(h.name, h.params, { back: true }); else U.go('home', {}, { back: true });
  };
  U.refresh = function () { if (!cur) return; var def = screens[cur.name]; if (def && def.show) try { def.show(def.el, cur.params); } catch (e) { console.error(e); } };

  var tbEl, curVals = {};
  function buildTopbar() {
    tbEl = U.$('#topbar');
    tbEl.innerHTML = '<div class="tb-title"><button class="tb-back" aria-label="返回"><img src="' + U.iconURL('back') + '" alt=""></button><div class="tb-name"></div>' +
      '<button class="tb-menu" aria-label="菜单"><img src="' + U.iconURL('menu') + '" alt=""></button></div><div class="tb-cur"></div>';
    U.$('.tb-back', tbEl).addEventListener('click', function () { U.back(); });
    U.$('.tb-menu', tbEl).addEventListener('click', quickNav);
  }
  function topbar(def, params) {
    tbEl.classList.toggle('home', def.name === 'home');
    tbEl.style.display = def.noTopbar ? 'none' : '';
    U.$('.tb-name', tbEl).textContent = (typeof def.title === 'function' ? def.title(params) : def.title) || '';
    var list = def.cur || ['coins', 'gems', 'tickets'];
    var box = U.$('.tb-cur', tbEl);
    if (box.getAttribute('data-k') !== list.join(',')) {
      box.setAttribute('data-k', list.join(','));
      box.innerHTML = list.map(function (k) {
        var m = U.CUR[k] || U.CUR.coins;
        return '<div class="cur" data-k="' + k + '"><img class="cur-ic" src="' + U.iconURL(m.icon) + '" alt=""><span class="cur-v num">0</span><button class="cur-add" aria-label="获取' + m.name + '"><i></i></button></div>';
      }).join('');
      U.$$('.cur', box).forEach(function (el) {
        var k = el.getAttribute('data-k');
        U.$('.cur-add', el).addEventListener('click', function () {
          if (k === 'tickets' && U.current() !== 'summon') { U.go('summon'); return; }
          U.toast((U.CUR[k] || {}).tip || '');
        });
      });
      curVals = {};
    }
    updateCur();
  }
  function updateCur() {
    if (!tbEl) return;
    var st = U.state();
    U.$$('.cur', tbEl).forEach(function (el) {
      var k = el.getAttribute('data-k'), v = Number(st[k]) || 0;
      if (curVals[k] !== v) {
        U.$('.cur-v', el).textContent = U.fmt(v);
        if (curVals[k] != null) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
        curVals[k] = v;
      }
    });
  }
  U.updateCur = updateCur;

  function quickNav() {
    var items = [['home', '主', '主城'], ['campaign', '冒', '冒险'], ['summon', '召', '召唤'], ['train', '培', '培养'], ['team', '阵', '编队'], ['codex', '图', '图鉴'], ['settings', '设', '设置']];
    var m = U.modal({ title: '导航', cls: 'qnav-m', html: '<div class="qnav">' + items.map(function (it) { return '<button data-go="' + it[0] + '"><span class="qk">' + it[1] + '</span>' + it[2] + '</button>'; }).join('') + '</div>' });
    U.$$('[data-go]', m.el).forEach(function (b) { b.addEventListener('click', function () { var g = b.getAttribute('data-go'); m.close(); U.go(g); }); });
  }

  /* change events from engine */
  var chPending = false, chWhat = {};
  function onChange(d) {
    if (d && d.what) chWhat[d.what] = 1;
    if (chPending) return; chPending = true;
    requestAnimationFrame(function () {
      chPending = false; var w = chWhat; chWhat = {};
      updateCur();
      var def = cur && screens[cur.name];
      if (def && def.onChange) try { def.onChange(w); } catch (e) { U.warn('onChange ' + cur.name, e); }
    });
  }

  /* ============================== input hardening ============================== */
  function harden() {
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('selectstart', function (e) { if (!(e.target && e.target.closest && e.target.closest('input,textarea'))) e.preventDefault(); });
    document.addEventListener('dragstart', function (e) { e.preventDefault(); });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });
    document.addEventListener('touchstart', function () {}, { passive: true });   // enables :active on iOS
    document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });
    // desktop: subtle mouse parallax on the scene background
    var par = U.$('#bg .bg-par'), parQ = null;
    stage.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse' || !par) return;
      var p = U.toStage(e.clientX, e.clientY);
      if (!parQ) requestAnimationFrame(function () { var q = parQ; parQ = null; par.style.transform = 'translate3d(' + (-(q.x / W - .5) * 18).toFixed(1) + 'px,' + (-(q.y / H - .5) * 10).toFixed(1) + 'px,0)'; });
      parQ = p;
    });
    // desktop: Esc = close popup / back
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var top = modalStack[modalStack.length - 1];
      if (top) { if (top.closable) top.close('esc'); return; }
      if (!U.$('#fx .rv, #fx .ur-show') && U.current() && U.current() !== 'home') U.back();
    });
    // swallow clicks that end a drag-scroll
    stage.addEventListener('click', function (e) { if (U.wasDrag()) { e.stopPropagation(); e.preventDefault(); } }, true);
    // Android back button / browser back → in-game back (on 主城 with nothing open the browser may leave)
    window.addEventListener('popstate', function () {
      backArmed = false;
      if (U.$('#fx .rv, #fx .ur-show')) { armBack(); return; }
      if (U.$('#modals .mask')) { U.closeModals(); armBack(); }
      else if (U.current() && U.current() !== 'home') { U.back(); armBack(); }
    });
    armBack();
  }
  var backArmed = false;
  function armBack() { if (backArmed) return; try { window.history.pushState({ ng: 1 }, ''); backArmed = true; } catch (e) {} }

  /* ============================== 主城 Home ============================== */
  function leaderId() {
    var st = U.state(), t = (st.team || []).filter(function (id) { return U.char(id) && U.owned(id); });
    if (t.length) return t[0];
    var ol = U.ownedList(); if (ol.length) return ol[0].id;
    return null;
  }
  function featuredUR() {
    var pref = ['naruto_sixpaths', 'sasuke_rinnegan', 'madara_sixpaths', 'itachi_edo', 'minato_edo', 'hashirama'];
    for (var i = 0; i < pref.length; i++) if (U.char(pref[i])) return U.char(pref[i]);
    var l = U.chars().filter(function (c) { return c.rarity === 'UR'; });
    return l[0] || U.chars()[0] || null;
  }
  U.featuredUR = featuredUR;
  U.leaderId = leaderId;
  function fmtDur(s) { s = Math.max(0, s | 0); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? h + '时' + m + '分' : m + '分' + (s % 60) + '秒'; }
  U.fmtDur = fmtDur;
  function nextStageLabel() {
    var chs = U.call('chapters'); if (!Array.isArray(chs)) return '';
    for (var i = 0; i < chs.length; i++) {
      var ss = chs[i].stages || [];
      for (var j = 0; j < ss.length; j++) {
        var s = U.call('stageState', ss[j].id) || {};
        if (s.unlocked && !s.stars) return '第' + (i + 1) + '章 ' + (chs[i].name || '') + ' · ' + (ss[j].name || ss[j].id);
      }
    }
    return chs.length ? '全部章节已通关' : '';
  }

  var afkTimer = 0;
  U.screen('home', {
    title: '主城', bg: 'village', particles: 'petal', root: true,
    build: function (el) {
      el.innerHTML =
        '<div class="home-hero tap"><div class="aura"></div><img class="bust" alt=""><div class="bubble"></div><div class="hero-name"><div class="nm"></div><div class="fm"></div></div></div>' +
        '<div class="home-player"><div class="hp-av"></div><div><div class="hp-name"><span class="n"></span><span class="hp-lv"></span></div><div class="hp-exp"><i></i></div><div class="hp-power"><img src="' + U.iconURL('power') + '" alt=""><span class="v"></span></div></div></div>' +
        '<div class="home-ticker"><div class="tk">【公告】<b>开局送1000连抽，抽到满意再开局！</b>　　设置中可随时「重新开局」　　收集火影 · 疾风传全部忍者，挑战大筒木辉夜！　　同人作品，仅供学习交流，与官方无关。</div></div>' +
        '<div class="home-menu">' +
        '<button class="hm-btn big" data-go="campaign"><div class="thumb"><img alt=""></div><div><div class="lbl">冒险</div><div class="sub cp-sub"></div></div><span class="btn go shine">出 发</span></button>' +
        '<button class="hm-btn" data-go="summon"><div class="medal"><b>召</b></div><div><div class="lbl">召唤</div><div class="sub sm-sub"></div></div><span class="badge">1000连</span></button>' +
        '<button class="hm-btn" data-go="train"><div class="medal"><b>培</b></div><div><div class="lbl">培养</div><div class="sub">升级·升星·技能</div></div></button>' +
        '<button class="hm-btn" data-go="team"><div class="medal"><b>阵</b></div><div><div class="lbl">编队</div><div class="sub tm-sub"></div></div></button>' +
        '<button class="hm-btn" data-go="codex"><div class="medal"><b>图</b></div><div><div class="lbl">图鉴</div><div class="sub cx-sub"></div></div></button>' +
        '</div>' +
        '<div class="home-dock"><button class="sbtn" data-act="notice"><img src="' + U.iconURL('mail') + '" alt="">公告</button><button class="sbtn" data-act="reset"><img src="' + U.iconURL('refresh') + '" alt="">重新开局</button><button class="sbtn" data-go="settings"><img src="' + U.iconURL('gear') + '" alt="">设置</button></div>' +
        '<button class="home-afk"><div class="chest"><img src="' + U.iconURL('chest') + '" alt=""></div><div class="lbl">挂机收益</div><div class="amt"></div></button>';
      U.$$('[data-go]', el).forEach(function (b) { b.addEventListener('click', function () { U.go(b.getAttribute('data-go')); }); });
      U.$('[data-act="notice"]', el).addEventListener('click', showNotice);
      U.$('[data-act="reset"]', el).addEventListener('click', function () { U.resetFlow(); });
      U.$('.home-afk', el).addEventListener('click', afkModal);
      U.$('.hp-name .n', el).addEventListener('click', renameModal);
      U.$('.home-hero', el).addEventListener('click', function () { var id = leaderId(); if (id) U.go('train', { id: id }); else U.go('summon'); });
      var thumb = U.$('.hm-btn.big .thumb img', el); thumb.src = U.bgURL('valley', 560, 180);
    },
    show: function (el) {
      var st = U.state(), id = leaderId(), c = id ? U.char(id) : featuredUR();
      var bust = U.$('.home-hero .bust', el);
      if (c) {
        bust.src = U.bustURL(c);
        U.$('.home-hero', el).style.setProperty('--aura', (c.art && c.art.aura) || U.rcolor(c));
        U.$('.home-hero .nm', el).innerHTML = U.rarHTML(U.rarity(c)) + U.esc(U.charName(c));
        U.$('.home-hero .fm', el).textContent = id ? (U.charForm(c) || '队长') : '尚未拥有 · 前往召唤';
        var q = U.$('.home-hero .bubble', el); q.textContent = c.quote || '一起成为最强的忍者吧！'; q.style.display = c.quote || id ? '' : 'none';
      }
      U.$('.hp-av', el).innerHTML = c ? U.avatarHTML(c, { size: 76 }) : '';
      U.$('.hp-name .n', el).textContent = (st.player && st.player.name) || '无名忍者';
      U.$('.hp-lv', el).textContent = 'Lv.' + ((st.player && st.player.lv) || 1);
      var plv = (st.player && st.player.lv) || 1, need = (NG.game && typeof NG.game.expNeed === 'function' ? U.call('expNeed', plv) : 0) || 200 * plv;
      U.$('.hp-exp i', el).style.width = U.clamp(((st.player && st.player.exp) || 0) / (need || 1), 0, 1) * 100 + '%';
      U.$('.hp-power .v', el).textContent = '战力 ' + U.fmt(U.call('teamPower') || 0);
      U.$('.cp-sub', el).textContent = nextStageLabel() || '踏上忍者之路';
      U.$('.sm-sub', el).textContent = '招募券 ×' + U.fmt(st.tickets || 0);
      U.$('.tm-sub', el).textContent = '上阵 ' + ((st.team || []).length) + '/5';
      var tot = U.chars().length, own = U.ownedList().length;
      U.$('.cx-sub', el).textContent = '已收集 ' + own + '/' + tot;
      U.$('.hm-btn[data-go="summon"] .badge', el).style.display = (st.tickets || 0) >= 10 ? '' : 'none';
      updAfk(el);
      clearInterval(afkTimer); afkTimer = setInterval(function () { updAfk(el); }, 2000);
    },
    leave: function () { clearInterval(afkTimer); },
    onChange: function () { this.show(this.el); }
  });
  function updAfk(el) {
    var i = U.call('idle') || {}, ready = (i.coins || 0) > 0 || (i.scrolls || 0) > 0;
    var b = U.$('.home-afk', el); if (!b) return;
    b.classList.toggle('ready', ready);
    U.$('.amt', b).innerHTML = U.icon('coin') + ' +' + U.fmt(i.coins || 0) + ' · ' + fmtDur(i.seconds || 0);
  }
  function afkModal() {
    var i = U.call('idle') || {};
    var rw = ['coins', 'exp', 'scrolls'].filter(function (k) { return i[k] > 0; }).map(function (k) { return U.rewardHTML(k, i[k]); }).join('');
    U.modal({
      title: '挂机收益', cls: 'afk',
      html: '<div class="confirm-text">已挂机 <b style="color:#ffe9a6">' + fmtDur(i.seconds || 0) + '</b>（最多累积12小时）</div>' +
        '<div class="cp-rw" style="justify-content:center;margin-top:18px">' + (rw || '<div class="muted">暂无收益，稍后再来吧</div>') + '</div>' +
        '<div class="confirm-sub">推进冒险关卡可提升挂机收益</div>',
      buttons: [{ html: '领 取', cls: 'shine', fn: function () {
        var r = U.call('claimIdle');
        if (r && r.ok === false) { U.fail(r); return false; }
        var got = r && typeof r === 'object' ? r : i;
        U.toast('领取成功：铜币 +' + U.fmt(got.coins || 0) + (got.scrolls ? '，卷轴 +' + U.fmt(got.scrolls) : ''), 'ok');
      } }]
    });
  }
  function renameModal() {
    var cur = (U.state().player || {}).name || '无名忍者';
    var m = U.modal({ title: '忍者名号', html: '<div style="width:520px;text-align:center"><input class="nm-input" maxlength="16" value="' + U.esc(cur) + '"><div class="confirm-sub">最多16个字符</div></div>',
      buttons: [{ html: '取消', cls: 'dark' }, { html: '确定', fn: function () {
        var v = U.$('.nm-input', m.el).value;
        var r = U.call('setName', v);
        if (r && r.ok === false) { U.fail(r); return false; }
        U.toast('改名成功', 'ok');
      } }] });
  }
  function showNotice() {
    U.modal({ title: '公告', cls: 'notice', html: '<div style="width:620px;font-size:18px;line-height:1.9;color:#e0e9ff">' +
      '<b style="color:#ffe9a6;font-size:22px">【福利】开局送1000连抽！</b><br>新存档赠送1000张招募券，可单抽/十连/百连。<br>抽到不满意？在「召唤」或「设置」中点击<b style="color:#ff9b7a">重新开局</b>，重新领取1000连！<br>' +
      '· 十连必出SSR及以上，90抽必出UR<br>· 收录《火影忍者》《疾风传》全部主要忍者与尾兽<br>· 推进冒险关卡，挑战第四次忍界大战与大筒木辉夜' +
      '<div class="credits" style="margin-top:14px">同人作品，仅供学习交流，与官方无关</div></div>', buttons: [{ html: '知道了', cls: 'blue' }] });
  }

  /* ============================== 欢迎 Welcome ============================== */
  U.welcome = function () {
    var urs = ['naruto_sixpaths', 'sasuke_rinnegan', 'madara_sixpaths', 'itachi_edo', 'kakashi_susanoo'].map(U.char).filter(Boolean);
    if (urs.length < 3) urs = U.chars().filter(function (c) { return c.rarity === 'UR'; }).slice(0, 5);
    var m = U.modal({
      cls: 'welcome', close: false, maskClose: false,
      html: '<div class="wl-rays"></div><div class="wl-busts">' + urs.slice(0, 5).map(function (c) { return '<img src="' + U.bustURL(c) + '" alt="">'; }).join('') + '</div>' +
        '<div class="wl-sub">欢迎来到忍界传说</div>' +
        '<div class="wl-big"><span class="gold-text">开局送</span><em>1000</em><span class="gold-text">连抽！</span></div>' +
        '<div class="wl-sub" style="color:#ffe9a6">抽到满意再开局！</div>' +
        '<div class="wl-ticket"><img src="' + U.iconURL('ticket') + '" alt="">招募券 ×' + U.fmt(U.state().tickets || 1000) + '</div>' +
        '<div class="wl-note">不满意可随时「重新开局」再领1000连 · 同人作品，仅供学习交流</div>',
      buttons: [{ html: '立即召唤', cls: 'lg red shine', fn: function () {
        var st = U.state(); st.flags = st.flags || {}; st.flags.welcomed = true;
        if (NG.game && typeof NG.game.setFlag === 'function') { try { NG.game.setFlag('welcomed', true); } catch (e) {} } else U.call('save');
        U.go('summon');
      } }]
    });
    return m;
  };

  /* reset ("重新开局") flow shared by summon + settings */
  U.resetFlow = function () {
    U.confirm({ title: '重新开局', text: '确定要<b style="color:#ff9b7a">重新开局</b>吗？', sub: '当前存档的全部忍者、资源与进度将被清空，并重新获得1000张招募券。', ok: '重新开局', okCls: 'red' }, function () {
      U.call('reset');
      U.toast('已重新开局，1000招募券已到账！', 'ok');
      history = [];
      U.go('home', {}, { replace: true });
      setTimeout(function () { var st = U.state(); if (!st.flags || !st.flags.welcomed) U.welcome(); }, 350);
    });
  };

  /* ============================== 设置 Settings ============================== */
  U.screen('settings', {
    title: '设置', bg: 'moon', particles: 'spark', cur: ['coins', 'gems', 'tickets'],
    build: function (el) {
      el.innerHTML = '<div class="gframe settings" style="position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);padding:58px 36px 26px">' + U.cornersHTML() + '<div class="modal-title">设 置</div>' +
        '<div class="set-row"><div class="k">横屏旋转</div><div class="v" data-set="rotate"><button class="pill" data-v="auto">自动旋转</button><button class="pill" data-v="off">关闭</button><div class="hint">竖持手机时自动将画面旋转为横屏（H5横屏模式）</div></div></div>' +
        '<div class="set-row"><div class="k">战斗速度</div><div class="v" data-set="speed"><button class="pill" data-v="1">×1</button><button class="pill" data-v="2">×2</button><button class="pill" data-v="4">×4</button></div></div>' +
        '<div class="set-row"><div class="k">存档</div><div class="v"><button class="btn red sm" data-act="reset">重新开局</button><div class="hint">清空当前存档并重新领取1000连抽，抽到满意再开局！</div></div></div>' +
        '<div class="set-row"><div class="k">统计</div><div class="v stat" style="font-size:17px;color:#cfe0ff"></div></div>' +
        '<div class="credits"><b>忍界传说</b><br>同人作品，仅供学习交流，与官方无关<br>角色版权归原作者岸本齐史 / 集英社 / 东京电视台等所有 · 本作所有图像均为程序生成</div></div>';
      U.$$('[data-set]', el).forEach(function (g) {
        var k = g.getAttribute('data-set');
        U.$$('.pill', g).forEach(function (p) {
          p.addEventListener('click', function () {
            var v = p.getAttribute('data-v'); if (k === 'speed') v = Number(v);
            U.setSetting(k, v); U.refresh(); U.toast('设置已保存', 'ok');
          });
        });
      });
      U.$('[data-act="reset"]', el).addEventListener('click', U.resetFlow);
    },
    show: function (el) {
      var s = U.settings(), st = U.state();
      U.$$('[data-set]', el).forEach(function (g) { var k = g.getAttribute('data-set'); U.$$('.pill', g).forEach(function (p) { p.classList.toggle('on', String(s[k]) === p.getAttribute('data-v')); }); });
      var prog = st.progress || {}, cleared = Object.keys(prog).filter(function (k) { return prog[k] > 0; }).length;
      U.$('.stat', el).textContent = '已收集 ' + U.ownedList().length + '/' + U.chars().length + ' 名忍者 · 累计召唤 ' + (st.totalPulls || 0) + ' 次 · 通关 ' + cleared + ' 关';
    }
  });

  /* ============================== boot ============================== */
  function boot() {
    stage = U.$('#stage'); app = U.$('#app');
    if (!stage) return;
    harden();
    fit();
    window.addEventListener('resize', function () { requestAnimationFrame(fit); });
    window.addEventListener('orientationchange', function () { setTimeout(fit, 120); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { requestAnimationFrame(fit); });
    var ok = true;
    if (!NG.game || typeof NG.game.init !== 'function') { ok = false; }
    else { try { NG.game.init(); } catch (e) { ok = false; console.error(e); } }
    fit();
    buildTopbar();
    if (typeof NG.on === 'function') NG.on('change', onChange);
    var bootEl = U.$('#boot');
    if (!ok) { U.$('.boot-tip', bootEl).textContent = '游戏引擎加载失败，请刷新重试'; return; }
    U.go('home');
    stage.classList.remove('booting');
    setTimeout(function () { bootEl.classList.add('gone'); setTimeout(function () { if (bootEl.parentNode) bootEl.parentNode.removeChild(bootEl); }, 600); }, 250);
    var st = U.state();
    if (!st.flags || !st.flags.welcomed) setTimeout(U.welcome, 500);
  }
  U.boot = boot;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
})();
