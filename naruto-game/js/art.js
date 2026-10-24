/* 忍界传说 · art.js — procedural anime-style SVG art → NG.art (CONTRACT.md §3)
 *
 * Pure string building (no DOM) so it also runs in node. Deterministic and memoized.
 * Every character is drawn in one canonical "bust space" (560×640): skull centred at
 * (281,196) r≈80, face turned slightly toward the viewer's left, light from the top-left.
 * Avatars are a tight viewBox crop of the same drawing rendered with heavier line weights.
 *
 * Layering for humans (back → front):
 *   aura · back accessory · back hair · arms · neck · torso/outfit · collar · draped hair ·
 *   ear · face · eyes/brows/nose/mouth · marks · mask · glasses · top hair + fringe ·
 *   headband · hat · front accessory
 */
(function (root) {
  'use strict';
  var NG = root.NG = root.NG || {};
  var ART = NG.ART || {};
  var A = NG.art = NG.art || {};

  /* ======================================================================
   * 1. utilities
   * ==================================================================== */
  function r1(v) { return Math.round(v * 10) / 10; }
  function P(x, y) { return r1(x) + ',' + r1(y); }
  function PP(p) { return r1(p[0]) + ',' + r1(p[1]); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hash(s) {
    s = String(s); var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var HEXRE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
  function isHex(c) { return typeof c === 'string' && HEXRE.test(c); }
  function rgb(c) {
    var m = HEXRE.exec(String(c || ''));
    if (!m) return [128, 128, 128];
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hex(r, g, b) {
    return '#' + ((1 << 24) + (clamp(Math.round(r), 0, 255) << 16) + (clamp(Math.round(g), 0, 255) << 8) + clamp(Math.round(b), 0, 255)).toString(16).slice(1);
  }
  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }
  function dk(c, t) { return mix(c, '#0d0916', t); }
  function lt(c, t) { return mix(c, '#ffffff', t); }
  function lum(c) { var x = rgb(c); return (0.299 * x[0] + 0.587 * x[1] + 0.114 * x[2]) / 255; }
  function col(c, d) { return isHex(c) ? (c.charAt(0) === '#' ? c : '#' + c) : d; }
  function inkOf(c) { return mix(c, '#140b14', lum(c) > 0.75 ? 0.7 : 0.8); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pol(cx, cy, r, deg) { var a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
  function has(arr, v) { return !!arr && typeof arr.indexOf === 'function' && arr.indexOf(v) >= 0; }
  var HOP = Object.prototype.hasOwnProperty;
  function own(obj, k) { return obj && k != null && HOP.call(obj, k) ? obj[k] : undefined; } // prototype-safe map lookup
  function dim(v, d) { v = +v; return isFinite(v) && v > 0 ? Math.min(Math.round(v), 4096) : d; }
  function merge(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  function inVocab(v, list) { return !!list && list.indexOf(v) >= 0; }
  function pick(v, list, d) { return inVocab(v, list) ? v : d; }

  var FONT = "'Noto Sans SC','PingFang SC','Microsoft YaHei','Hiragino Sans GB','Source Han Sans SC','WenQuanYi Zen Hei',sans-serif";
  var BRUSH = "'Ma Shan Zheng','ZCOOL XiaoWei','Noto Serif SC','STKaiti','KaiTi','WenQuanYi Zen Hei',serif";

  /* ======================================================================
   * 2. render context (unique ids, gradients, clips)
   * ==================================================================== */
  function Ctx(pfx, lw) { this.p = pfx; this.n = 0; this.defs = []; this.lw = lw || 3; this.m = {}; }
  Ctx.prototype.uid = function () { return this.p + (this.n++).toString(36); };
  function stopsStr(stops) {
    var s = '';
    for (var i = 0; i < stops.length; i++) {
      var t = stops[i];
      s += '<stop offset="' + t[0] + '" stop-color="' + t[1] + '"' + (t[2] != null && t[2] !== 1 ? ' stop-opacity="' + t[2] + '"' : '') + '/>';
    }
    return s;
  }
  // linear gradient (objectBoundingBox unless u=true)
  Ctx.prototype.lin = function (stops, x1, y1, x2, y2, u) {
    var key = 'l' + JSON.stringify(stops) + [x1, y1, x2, y2, u].join();
    if (this.m[key]) return this.m[key];
    var id = this.uid();
    this.defs.push('<linearGradient id="' + id + '" x1="' + (x1 == null ? 0 : x1) + '" y1="' + (y1 == null ? 0 : y1) + '" x2="' + (x2 == null ? 0 : x2) + '" y2="' + (y2 == null ? 1 : y2) + '"' + (u ? ' gradientUnits="userSpaceOnUse"' : '') + '>' + stopsStr(stops) + '</linearGradient>');
    return (this.m[key] = 'url(#' + id + ')');
  };
  Ctx.prototype.rad = function (stops, cx, cy, r, fx, fy, u) {
    var key = 'r' + JSON.stringify(stops) + [cx, cy, r, fx, fy, u].join();
    if (this.m[key]) return this.m[key];
    var id = this.uid();
    this.defs.push('<radialGradient id="' + id + '" cx="' + (cx == null ? 0.5 : cx) + '" cy="' + (cy == null ? 0.5 : cy) + '" r="' + (r == null ? 0.5 : r) + '"' +
      (fx != null ? ' fx="' + fx + '" fy="' + fy + '"' : '') + (u ? ' gradientUnits="userSpaceOnUse"' : '') + '>' + stopsStr(stops) + '</radialGradient>');
    return (this.m[key] = 'url(#' + id + ')');
  };
  Ctx.prototype.clip = function (inner) {
    var key = 'c' + inner;
    if (this.m[key]) return this.m[key];
    var id = this.uid();
    this.defs.push('<clipPath id="' + id + '">' + inner + '</clipPath>');
    return (this.m[key] = 'url(#' + id + ')');
  };
  Ctx.prototype.clipPaths = function (list) {
    var s = '';
    for (var i = 0; i < list.length; i++) s += '<path d="' + list[i] + '"/>';
    return this.clip(s);
  };
  Ctx.prototype.filter = function (key, inner, pad) {
    if (this.m['f' + key]) return this.m['f' + key];
    var id = this.uid(); pad = pad || 40;
    this.defs.push('<filter id="' + id + '" x="-' + pad + '%" y="-' + pad + '%" width="' + (100 + 2 * pad) + '%" height="' + (100 + 2 * pad) + '%">' + inner + '</filter>');
    return (this.m['f' + key] = 'url(#' + id + ')');
  };
  Ctx.prototype.blur = function (sd) { return this.filter('b' + sd, '<feGaussianBlur stdDeviation="' + sd + '"/>'); };

  /* ---------- paint helpers ---------- */
  function path(d, fill, extra) { return '<path d="' + d + '" fill="' + fill + '"' + (extra ? ' ' + extra : '') + '/>'; }
  function line(d, stroke, w, extra) {
    return '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + r1(w) + '" stroke-linecap="round" stroke-linejoin="round"' + (extra ? ' ' + extra : '') + '/>';
  }
  function circ(x, y, r, fill, extra) { return '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(r) + '" fill="' + fill + '"' + (extra ? ' ' + extra : '') + '/>'; }
  function ell(x, y, rx, ry, fill, extra) { return '<ellipse cx="' + r1(x) + '" cy="' + r1(y) + '" rx="' + r1(rx) + '" ry="' + r1(ry) + '" fill="' + fill + '"' + (extra ? ' ' + extra : '') + '/>'; }
  // union outline of several closed paths (stroke drawn behind the fills)
  function outlineOf(list, ink, w) {
    if (!list.length) return '';
    return '<path d="' + list.join('') + '" fill="' + ink + '" stroke="' + ink + '" stroke-width="' + r1(w) + '" stroke-linejoin="round"/>';
  }
  // cel shading: base colour with a shadow band on the bottom-right edges (light from top-left)
  function cel(X, d, base, shadow, sx, sy) {
    var c = X.clip('<path d="' + d + '"/>');
    return path(d, shadow) + '<g clip-path="' + c + '"><path d="' + d + '" fill="' + base + '" transform="translate(' + r1(-sx) + ',' + r1(-sy) + ')"/></g>';
  }
  // paint a group of shapes: outline union + cel fills
  function paintGroup(X, list, base, o) {
    if (!list || !list.length) return '';
    o = o || {};
    var ink = o.ink || inkOf(base), sh = o.shadow || dk(base, 0.3);
    var s = outlineOf(list, ink, X.lw * (o.lwm || 2));
    for (var i = 0; i < list.length; i++) s += cel(X, list[i], base, sh, o.sx == null ? 5 : o.sx, o.sy == null ? 7 : o.sy);
    return s;
  }
  function tr(x, y, inner, extra) { return '<g transform="translate(' + r1(x) + ',' + r1(y) + ')' + (extra || '') + '">' + inner + '</g>'; }

  /* ======================================================================
   * 3. character classification helpers
   * Data may set art.gender ('f'|'m') / art.female, art.young, art.mood, art.build; the id
   * lists below are only a fallback for characters whose art block omits those fields.
   * ==================================================================== */
  var FEMALE = toSet('sakura sakura_byakugou ino hinata tenten kurenai hanabi tsume hana tsunade kushina mito shizune koharu anko yugao konan kaguya mikoto izumi rin tayuya kin karin temari chiyo matsuri pakura mei ameyuri samui karui mabui yugito kurotsuchi fu moegi');
  var YOUNG = toSet('naruto sasuke sakura konohamaru moegi udon obito_kid rin nawaki hanabi gaara izumi');
  var GRIN = toSet('naruto naruto_sage naruto_sixpaths rock_lee guy duy killer_b kiba konohamaru jiraiya hidan suigetsu kisame tsume deidara obito_kid nawaki choji_butterfly');
  var SMIRK = toSet('orochimaru kabuto kabuto_sage madara madara_edo sasori kakuzu zetsu black_zetsu kinkaku ginkaku tayuya sakon kidomaru zabuza hanzo mu');
  var SMILE = toSet('sai hashirama minato iruka shizune rin mikoto izumi hinata mito kushina dan yamato kakashi');
  var INUZUKA = toSet('kiba tsume hana');
  function toSet(s) { var o = {}; s.split(' ').forEach(function (k) { if (k) o[k] = 1; }); return o; }
  function isFemale(c, a) { if (a.female != null) return !!a.female; if (a.gender) return a.gender === 'f'; return !!FEMALE[c.id]; }
  function isYoung(c, a) { if (a.young != null) return !!a.young; return !!YOUNG[c.id] || c.form === '少年篇' || c.form === '少年'; }
  function moodOf(c, a, fem) {
    if (a.mood) return a.mood;
    if (GRIN[c.id]) return 'grin';
    if (SMIRK[c.id]) return 'smirk';
    if (SMILE[c.id]) return 'smile';
    return fem ? 'soft' : 'serious';
  }
  function buildOf(c, a, fem) {
    var st = c.stats || {}, hp = +st.hp || 1, w = 1;
    if (hp >= 1.12) w += (hp - 1.1) * 1.3;
    if (c.role === 'tank') w += 0.06;
    if (fem) w -= 0.1;
    if (a.build) w = +a.build || w;
    return clamp(w, 0.84, 1.24);
  }

  /* ======================================================================
   * 4. eyes — iris patterns are drawn in a unit circle, then scaled
   * ==================================================================== */
  var K = '#14060a';
  var DOJ = toSet('sharingan sharingan_2tomoe ms_sasuke ms_itachi ms_obito ms_madara ms_shisui ms_eternal ms_izuna ms_indra rinnegan rinne_sharingan tomoe_rinnegan byakugan');
  var RIPPLE = toSet('rinnegan tomoe_rinnegan');

  function tomoe(x, y, s, rot, fill) {
    return '<path d="M-1,0A1,1 0 1,0 1,0C1.15,-1.25 0.35,-2.05 -1.05,-2.5C-0.3,-1.85 -0.6,-0.9 -1,0Z" fill="' + fill + '" transform="translate(' + r1(x * 100) / 100 + ',' + r1(y * 100) / 100 + ') rotate(' + r1(rot) + ') scale(' + s + ')"/>';
  }
  function ringTomoe(n, R, s, start, fill) {
    var o = '';
    for (var i = 0; i < n; i++) {
      var th = start + i * 360 / n, p = pol(0, 0, R, th);
      o += tomoe(p[0], p[1], s, th + 180, fill);
    }
    return o;
  }
  function rotN(d, n, fill, base) {
    var o = '';
    for (var i = 0; i < n; i++) o += '<path d="' + d + '" fill="' + fill + '" transform="rotate(' + r1(base + i * 360 / n) + ')"/>';
    return o;
  }
  function redBase(X) { return '<circle r="1" fill="' + X.rad([[0, '#ff5a4a'], [0.55, '#e3121c'], [1, '#7c0008']]) + '"/>'; }
  var RIM = '<circle r="0.97" fill="none" stroke="#1a0508" stroke-width="0.08"/>';

  // unit iris (radius 1). color = eyeColor for normal-type eyes.
  function irisUnit(X, kind, color) {
    return '<g clip-path="' + X.clip('<circle r="1"/>') + '">' + irisRaw(X, kind, color) + '</g>';
  }
  function irisRaw(X, kind, color) {
    var c = col(color, '#3a2a1e');
    switch (kind) {
      case 'sharingan':
        return redBase(X) + '<circle r="0.6" fill="none" stroke="' + K + '" stroke-width="0.06" opacity="0.9"/>' + ringTomoe(3, 0.6, 0.19, -90, K) + '<circle r="0.24" fill="' + K + '"/>' + RIM;
      case 'sharingan_2tomoe': // freshly awakened (young Obito / early Sasuke)
        return redBase(X) + '<circle r="0.6" fill="none" stroke="' + K + '" stroke-width="0.06" opacity="0.9"/>' + ringTomoe(2, 0.6, 0.2, -135, K) + '<circle r="0.24" fill="' + K + '"/>' + RIM;
      case 'ms_indra': // three thin sickle blades sweeping from a ringed pupil
        return redBase(X) + rotN('M0.1,-0.27C0.52,-0.56 0.86,-0.36 0.97,0.1C0.74,-0.14 0.5,-0.2 0.24,-0.08Z', 3, K, 0) +
          '<circle r="0.34" fill="' + K + '"/><circle r="0.24" fill="#e3121c"/>' + rotN('M0,-0.24L0.07,-0.12L-0.07,-0.12Z', 3, K, 60) + '<circle r="0.1" fill="' + K + '"/>' + RIM;
      case 'ms_sasuke':
        return redBase(X) + rotN('M0.16,-0.14C0.4,-0.62 0.78,-0.74 0.98,-0.42C0.78,-0.28 0.62,0.02 0.48,0.32C0.38,0.12 0.26,-0.02 0.16,-0.14Z', 3, K, -30) +
          '<circle r="0.33" fill="' + K + '"/><circle r="0.21" fill="#e3121c"/><circle r="0.11" fill="' + K + '"/>' + RIM;
      case 'ms_itachi':
        return redBase(X) + '<circle r="0.84" fill="none" stroke="' + K + '" stroke-width="0.13"/>' +
          rotN('M0.08,-0.26C0.38,-0.52 0.72,-0.5 0.86,-0.2C0.86,-0.06 0.8,0.04 0.76,0.08C0.56,-0.12 0.36,-0.04 0.2,0.22Z', 3, K, -90) + '<circle r="0.3" fill="' + K + '"/>' + RIM;
      case 'ms_obito':
        return redBase(X) + rotN('M-0.06,0C0.06,-0.5 0.5,-0.86 0.99,-0.56C0.62,-0.5 0.36,-0.22 0.3,0.2C0.18,0.12 0.04,0.08 -0.06,0Z', 3, K, -60) + '<circle r="0.26" fill="' + K + '"/>' + RIM;
      case 'ms_madara':
        return redBase(X) + rotN('M0.3,-0.26Q0.76,-0.2 0.99,0Q0.76,0.2 0.3,0.26Z', 3, K, -90) +
          '<circle r="0.52" fill="' + K + '"/><circle r="0.34" fill="#e3121c"/><circle r="0.14" fill="' + K + '"/>' + RIM;
      case 'ms_shisui':
        return redBase(X) + rotN('M-0.04,0C0.02,-0.46 0.44,-0.84 0.98,-0.5C0.6,-0.44 0.36,-0.2 0.3,0.22C0.2,0.12 0.06,0.06 -0.04,0Z', 4, K, -45) + '<circle r="0.24" fill="' + K + '"/>' + RIM;
      case 'ms_eternal':
        return redBase(X) + rotN('M-0.97,0Q0,-0.34 0.97,0Q0,0.34 -0.97,0Z', 3, K, -90) +
          '<circle r="0.46" fill="' + K + '"/><circle r="0.34" fill="#e3121c"/>' + rotN('M0.06,-0.08C0.2,-0.3 0.32,-0.3 0.34,-0.1C0.24,-0.06 0.16,0 0.1,0.1Z', 3, K, -90) + '<circle r="0.12" fill="' + K + '"/>' + RIM;
      case 'ms_izuna':
        return redBase(X) + rotN('M0.24,-0.2C0.52,-0.3 0.8,-0.5 0.98,-0.74C0.92,-0.36 0.72,-0.04 0.3,0.16Z', 3, K, -90) +
          '<circle r="0.4" fill="none" stroke="' + K + '" stroke-width="0.12"/><circle r="0.16" fill="' + K + '"/>' + RIM;
      case 'rinnegan':
      case 'tomoe_rinnegan':
        var rings = '';
        [0.17, 0.34, 0.51, 0.68, 0.85].forEach(function (r) { rings += '<circle r="' + r + '" fill="none" stroke="#3e2e74" stroke-width="0.045"/>'; });
        var tm = kind === 'tomoe_rinnegan' ? ringTomoe(3, 0.34, 0.075, -90, '#1a1030') + ringTomoe(3, 0.51, 0.075, -30, '#1a1030') : '';
        return '<circle r="1" fill="' + X.rad([[0, '#eee6ff'], [0.6, '#b9a2ea'], [1, '#7a62bf']]) + '"/>' + rings + tm + '<circle r="0.08" fill="#2a1d55"/>';
      case 'rinne_sharingan':
        var rr = '';
        [0.3, 0.55, 0.8].forEach(function (r) { rr += '<circle r="' + r + '" fill="none" stroke="#3a0006" stroke-width="0.05"/>'; });
        return redBase(X) + rr + ringTomoe(3, 0.3, 0.07, -90, K) + ringTomoe(3, 0.55, 0.08, -30, K) + ringTomoe(3, 0.8, 0.085, -90, K) + '<circle r="0.12" fill="' + K + '"/>' + RIM;
      case 'byakugan':
        return '<circle r="1" fill="' + X.rad([[0, '#ffffff'], [0.7, '#ebe6f7'], [1, '#c9bfe3']]) + '"/><circle r="0.9" fill="none" stroke="#b7abd6" stroke-width="0.06"/><circle r="0.5" fill="none" stroke="#d9d1ee" stroke-width="0.05"/>';
      case 'sage':
        return '<circle r="1" fill="' + X.rad([[0, '#fff3a6'], [0.6, '#ffc927'], [1, '#d68a00']]) + '"/><rect x="-0.62" y="-0.15" width="1.24" height="0.3" rx="0.15" fill="' + K + '"/>' + '<circle r="0.97" fill="none" stroke="#7a4300" stroke-width="0.08"/>';
      case 'kurama':
        return '<circle r="1" fill="' + X.rad([[0, '#ffe07a'], [0.55, '#ff8a1c'], [1, '#c43a00']]) + '"/><path d="M0,-0.86Q0.2,0 0,0.86Q-0.2,0 0,-0.86Z" fill="' + K + '"/>' + '<circle r="0.97" fill="none" stroke="#6b1d00" stroke-width="0.08"/>';
      case 'six_paths':
        return '<circle r="1" fill="' + X.rad([[0, '#fff6c2'], [0.55, '#ffcf3a'], [1, '#d98a00']]) + '"/><circle r="0.62" fill="none" stroke="#9a5a00" stroke-width="0.05"/>' +
          '<path d="M-0.12,-0.62H0.12V-0.12H0.62V0.12H0.12V0.62H-0.12V0.12H-0.62V-0.12H-0.12Z" fill="' + K + '"/>' + '<circle r="0.97" fill="none" stroke="#7a4300" stroke-width="0.08"/>';
      case 'snake':
        return '<circle r="1" fill="' + X.rad([[0, '#fff7a0'], [0.6, '#e7cf2a'], [1, '#a88a00']]) + '"/><path d="M0,-0.9Q0.22,0 0,0.9Q-0.22,0 0,-0.9Z" fill="' + K + '"/>' + '<circle r="0.97" fill="none" stroke="#5a4a00" stroke-width="0.08"/>';
      case 'beast':
        var bc = col(color, '#ffcf3a');
        return '<circle r="1" fill="' + X.rad([[0, lt(bc, 0.5)], [0.6, bc], [1, dk(bc, 0.4)]]) + '"/><path d="M0,-0.92Q0.24,0 0,0.92Q-0.24,0 0,-0.92Z" fill="' + K + '"/>';
      case 'puppet':
        return '<circle r="1" fill="' + X.rad([[0, '#7a6a66'], [0.7, '#3a2c2a'], [1, '#1a1212']]) + '"/><circle r="0.62" fill="none" stroke="#a89890" stroke-width="0.08"/><circle r="0.3" fill="#0c0808"/>';
      case 'dark':
        return '<circle r="1" fill="' + X.rad([[0, lt(c, 0.25)], [0.7, c], [1, dk(c, 0.5)]]) + '"/><circle r="0.42" fill="' + K + '"/>';
      default: // normal
        return '<circle r="1" fill="' + X.lin([[0, dk(c, 0.55)], [0.55, c], [1, lt(c, 0.35)]]) + '"/>' +
          '<circle r="0.46" fill="' + dk(c, 0.82) + '"/>' +
          '<path d="M-0.78,0.32A0.82,0.82 0 0,0 0.78,0.32A1,1 0 0,1 -0.78,0.32Z" fill="' + lt(c, 0.45) + '" opacity="0.55"/>' +
          '<circle r="0.96" fill="none" stroke="' + dk(c, 0.7) + '" stroke-width="0.09"/>';
    }
  }

  /* One eye. (cx,cy) centre, w width, h height, s = -1 viewer-left (far) / +1 viewer-right (near). */
  function drawEye(X, cx, cy, w, h, s, kind, color, F) {
    var L = X.lw, ink = '#1a0d12';
    if (kind === 'closed') {
      return line('M' + P(cx - s * w * 0.5, cy + h * 0.05) + 'Q' + P(cx, cy + h * 0.45) + ' ' + P(cx + s * w * 0.55, cy - h * 0.05), ink, L * 1.3) +
        line('M' + P(cx + s * w * 0.48, cy) + 'l' + P(s * w * 0.14, -h * 0.12), ink, L * 0.8);
    }
    var big = F.fem || F.young;
    var tilt = F.fierce ? 0.12 : 0;
    // sclera / eye opening
    var I = [cx - s * w * 0.5, cy + h * 0.2], O = [cx + s * w * 0.5, cy - h * (0.12 + tilt)];
    var scl = 'M' + PP(I) + 'Q' + P(cx - s * w * 0.22, cy - h * (big ? 0.86 : 0.74)) + ' ' + P(cx + s * w * 0.1, cy - h * (big ? 0.66 : 0.58)) +
      'Q' + P(cx + s * w * 0.42, cy - h * (0.5 + tilt)) + ' ' + PP(O) +
      'Q' + P(cx + s * w * 0.32, cy + h * 0.6) + ' ' + P(cx - s * w * 0.04, cy + h * 0.54) +
      'Q' + P(cx - s * w * 0.34, cy + h * 0.48) + ' ' + PP(I) + 'Z';
    var dark = kind === 'dark';
    var sclFill = dark ? '#241a24' : (F.edo ? '#2e262c' : (RIPPLE[kind] ? '#cfc2f0' : (kind === 'beast' ? lt(col(color, '#ffcf3a'), 0.3) : '#fbf8f4')));
    var o = path(scl, sclFill);
    // soft shadow of the upper lid on the eyeball
    var cp = X.clip('<path d="' + scl + '"/>');
    var rx = w * (big ? 0.33 : 0.29), ry = rx * 1.14;
    if (RIPPLE[kind]) { rx = w * 0.46; ry = rx; }
    if (kind === 'byakugan') { rx = w * 0.3; ry = rx * 1.1; }
    var icx = cx + s * w * 0.02, icy = cy + h * 0.06;
    var g = '';
    if (kind !== 'blank') {
      g += '<g transform="translate(' + r1(icx) + ',' + r1(icy) + ') scale(' + r1(rx * 100) / 100 + ',' + r1(ry * 100) / 100 + ')">' + irisUnit(X, kind, color) + '</g>';
    }
    g += path('M' + P(cx - w, cy - h * 1.2) + 'L' + P(cx + w, cy - h * 1.2) + 'L' + P(cx + w, cy - h * 0.25) + 'Q' + P(cx, cy - h * 0.05) + ' ' + P(cx - w, cy - h * 0.25) + 'Z', dark ? '#000' : '#5a3a4a', 'opacity="' + (dark ? 0.3 : 0.18) + '"');
    if (kind !== 'blank' && kind !== 'byakugan') {
      // highlights (light from top-left, same for both eyes)
      g += circ(icx - rx * 0.36, icy - ry * 0.4, rx * (DOJ[kind] ? 0.2 : 0.3), '#fff', 'opacity="0.95"');
      g += circ(icx + rx * 0.34, icy + ry * 0.38, rx * 0.12, '#fff', 'opacity="0.85"');
    } else if (kind === 'byakugan') {
      g += circ(icx - rx * 0.3, icy - ry * 0.35, rx * 0.18, '#fff');
    }
    o += '<g clip-path="' + cp + '">' + g + '</g>';
    // upper lid: thick tapered lash line with a flick at the outer corner
    var lid = 'M' + P(cx - s * w * 0.54, cy + h * 0.24) +
      'Q' + P(cx - s * w * 0.24, cy - h * (big ? 1.0 : 0.88)) + ' ' + P(cx + s * w * 0.12, cy - h * (big ? 0.78 : 0.7)) +
      'Q' + P(cx + s * w * 0.5, cy - h * (0.64 + tilt)) + ' ' + P(cx + s * w * (big ? 0.7 : 0.64), cy - h * (big ? 0.12 : 0.02 + tilt)) +
      'Q' + P(cx + s * w * 0.42, cy - h * (0.4 + tilt)) + ' ' + P(cx + s * w * 0.1, cy - h * (big ? 0.6 : 0.5)) +
      'Q' + P(cx - s * w * 0.22, cy - h * (big ? 0.72 : 0.6)) + ' ' + P(cx - s * w * 0.54, cy + h * 0.24) + 'Z';
    o += path(lid, ink);
    if (big) { // lashes
      o += line('M' + P(cx + s * w * 0.6, cy - h * 0.3) + 'l' + P(s * w * 0.16, -h * 0.22), ink, L * 0.9);
      o += line('M' + P(cx + s * w * 0.42, cy - h * 0.55) + 'l' + P(s * w * 0.12, -h * 0.3), ink, L * 0.8);
    }
    // lower lid
    o += line('M' + P(cx + s * w * 0.46, cy + h * 0.06) + 'Q' + P(cx + s * w * 0.24, cy + h * 0.62) + ' ' + P(cx - s * w * 0.12, cy + h * 0.52), ink, L * 0.55, 'opacity="0.8"');
    // double-lid crease
    o += line('M' + P(cx - s * w * 0.2, cy - h * (big ? 1.08 : 0.98)) + 'Q' + P(cx + s * w * 0.2, cy - h * (big ? 1.08 : 0.95)) + ' ' + P(cx + s * w * 0.46, cy - h * 0.72), ink, L * 0.45, 'opacity="0.5"');
    return o;
  }

  function drawBrow(X, cx, cy, w, h, s, color, F) {
    var by = cy - h * (F.fem ? 1.55 : 1.25);
    var th = F.thick ? 2.1 : (F.fem ? 0.55 : 1);
    var d;
    if (F.thick) { // Guy / Lee / Duy: huge bushy brows, blunt inner end, drawn over the fringe
      by = cy - h * 1.5;
      d = 'M' + P(cx - s * w * 0.66, by + h * 0.6) + 'C' + P(cx - s * w * 0.24, by - h * 0.2) + ' ' + P(cx + s * w * 0.42, by - h * 0.56) + ' ' + P(cx + s * w * 0.9, by - h * 0.16) +
        'L' + P(cx + s * w * 0.82, by + h * 0.42) + 'C' + P(cx + s * w * 0.42, by + h * 0.18) + ' ' + P(cx - s * w * 0.12, by + h * 0.5) + ' ' + P(cx - s * w * 0.62, by + h * 1.3) + 'Z';
      return path(d, color, 'stroke="' + dk(color, 0.4) + '" stroke-width="' + r1(X.lw * 0.6) + '" stroke-linejoin="round"') +
        line('M' + P(cx - s * w * 0.3, by + h * 0.5) + 'q' + r1(s * w * 0.3) + ',' + r1(-h * 0.4) + ' ' + r1(s * w * 0.7) + ',' + r1(-h * 0.5), lt(color, 0.35), X.lw * 0.5, 'opacity="0.55"');
    }
    if (F.fem) {
      d = 'M' + P(cx - s * w * 0.46, by + h * 0.28) + 'Q' + P(cx + s * w * 0.05, by - h * 0.32) + ' ' + P(cx + s * w * 0.62, by + h * 0.16) +
        'Q' + P(cx + s * w * 0.06, by - h * (0.32 + 0.2 * th)) + ' ' + P(cx - s * w * 0.48, by + h * 0.08) + 'Z';
    } else {
      var ang = F.calm ? 0.06 : (F.fierce ? 0.34 : 0.22);
      d = 'M' + P(cx - s * w * 0.5, by + h * (0.36 + ang)) + 'Q' + P(cx + s * w * 0.08, by + h * 0.06) + ' ' + P(cx + s * w * 0.66, by - h * 0.12) +
        'Q' + P(cx + s * w * 0.1, by - h * (0.12 + 0.34 * th)) + ' ' + P(cx - s * w * 0.54, by + h * (0.36 + ang - 0.42 * th)) + 'Z';
    }
    return path(d, color);
  }

  /* ======================================================================
   * 5. face geometry
   * ==================================================================== */
  var FACES = {
    m: { d: 'M202,196C201,236 206,262 220,284C234,304 252,317 268,321C286,318 306,307 322,292C340,272 350,250 355,222L359,196A79,80 0 0,0 202,196Z',
      sh: 'M359,196L355,222C350,250 340,272 322,292C306,307 286,318 268,321C292,308 318,284 332,258C342,236 344,214 338,196Z',
      eL: [242, 238, 36, 20], eR: [312, 238, 42, 22], nose: [266, 270], mouth: [271, 295, 24], chin: 321 },
    f: { d: 'M205,196C204,236 208,258 222,280C236,298 252,310 268,313C284,310 302,300 318,286C336,268 347,248 352,222L356,196A76,80 0 0,0 205,196Z',
      sh: 'M356,196L352,222C347,248 336,268 318,286C302,300 284,310 268,313C292,300 314,280 328,256C338,236 340,214 335,196Z',
      eL: [242, 240, 36, 25], eR: [311, 240, 42, 28], nose: [267, 270], mouth: [271, 291, 18], chin: 313 },
    y: { d: 'M201,196C199,240 206,266 224,288C240,303 256,311 270,312C288,310 306,302 322,288C342,270 352,248 357,222L360,196A80,80 0 0,0 201,196Z',
      sh: 'M360,196L357,222C352,248 342,270 322,288C306,302 288,310 270,312C294,300 318,280 332,256C342,236 344,214 338,196Z',
      eL: [242, 242, 36, 25], eR: [311, 242, 42, 28], nose: [267, 272], mouth: [271, 293, 18], chin: 312 },
    b: { d: 'M199,196C197,240 204,272 222,294C238,312 254,321 270,323C290,321 312,312 330,296C348,276 358,250 362,222L363,196A82,82 0 0,0 199,196Z',
      sh: 'M363,196L362,222C358,250 348,276 330,296C312,312 290,321 270,323C296,310 322,288 338,260C348,238 350,214 344,196Z',
      eL: [242, 238, 35, 19], eR: [313, 238, 41, 21], nose: [266, 271], mouth: [272, 298, 26], chin: 323 }
  };
  var NECK = 'M252,282L248,354Q278,366 309,352L305,280Z';
  // the head is drawn in its own space and placed on the neck with a slight scale + tilt
  var HEAD_S = 0.9, HEAD_R = 2.5, HEAD_PX = 278, HEAD_PY = 332;
  var HT = 'translate(' + HEAD_PX + ',' + HEAD_PY + ') rotate(' + HEAD_R + ') scale(' + HEAD_S + ') translate(' + (-HEAD_PX) + ',' + (-HEAD_PY) + ')';
  function headPt(x, y) {
    var dx = (x - HEAD_PX) * HEAD_S, dy = (y - HEAD_PY) * HEAD_S, a = HEAD_R * Math.PI / 180;
    return [HEAD_PX + dx * Math.cos(a) - dy * Math.sin(a), HEAD_PY + dx * Math.sin(a) + dy * Math.cos(a)];
  }
  function inHead(s) { return s ? '<g transform="' + HT + '">' + s + '</g>' : ''; }

  /* ======================================================================
   * 6. hair
   * ==================================================================== */
  var CAP = 'M196,252C184,190 206,118 281,110C356,118 378,190 366,252L357,254C358,214 346,184 322,170Q281,156 238,170C214,184 204,214 205,254Z';
  var CAP_HI = 'M198,236C188,184 210,118 281,108C352,118 374,184 364,236L356,238C354,200 340,166 316,150Q281,140 246,150C222,166 210,200 208,238Z';
  var BACK_ROUND = 'M204,252C188,196 206,112 286,106C372,112 390,196 374,260C368,286 350,294 338,278L230,278C216,284 206,272 204,252Z';

  function strand(x0, x1, y0, tx, ty, b) {
    var my = (y0 + ty) / 2;
    return 'M' + P(x0, y0) + 'Q' + P(x0 + b, my) + ' ' + P(tx, ty) + 'Q' + P(x1 + b, my) + ' ' + P(x1, y0) + 'Z';
  }
  // band of spikes outside base radius rb. items: [angle, tipRadius, halfWidth, curl]
  var SPIKE_LOG = null; // when set, spikes() records its parameters (used for highlight streaks)
  function spikes(cx, cy, rb, items) {
    if (SPIKE_LOG) SPIKE_LOG.push({ cx: cx, cy: cy, rb: rb, items: items });
    var d = '', first = null, aN = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i], a = it[0], rt = it[1], w = it[2], cu = it[3] || 0;
      var p0 = pol(cx, cy, rb, a - w), p1 = pol(cx, cy, rb, a + w), tp = pol(cx, cy, rt, a + cu);
      var rm = rb + (rt - rb) * 0.5;
      var c0 = pol(cx, cy, rm, a - w * 0.55 + cu * 0.7), c1 = pol(cx, cy, rm * 0.98, a + w * 0.5 + cu * 0.55);
      if (!first) first = p0;
      d += (i === 0 ? 'M' : 'L') + PP(p0) + 'Q' + PP(c0) + ' ' + PP(tp) + 'Q' + PP(c1) + ' ' + PP(p1);
      aN = a + w;
    }
    var span = aN - (items[0][0] - items[0][2]);
    return d + 'A' + rb + ',' + rb + ' 0 ' + (span > 180 ? 1 : 0) + ',0 ' + PP(first) + 'Z';
  }
  // jagged long mane between y0 and y1
  function mane(x0, x1, yTop, yBot, n, depth, seed) {
    var R = rng(seed), d = 'M' + P(x0 + 6, yTop), i, y, x;
    for (i = 1; i <= n; i++) { // left edge going down
      y = yTop + (yBot - yTop) * i / n; x = x0 - (i / n) * 20;
      d += 'L' + P(x - depth * (0.6 + R() * 0.6), y - (yBot - yTop) / n * 0.5) + 'L' + P(x + depth * 0.2, y);
    }
    var m = n + 2;
    for (i = 0; i <= m; i++) { // bottom spikes
      x = (x0 - 20) + (x1 + 20 - (x0 - 20)) * i / m;
      d += 'L' + P(x, yBot + depth * (0.5 + R() * 0.9)) + 'L' + P(x + (x1 - x0 + 40) / m * 0.5, yBot - depth * 0.2);
    }
    for (i = n; i >= 1; i--) { // right edge going up
      y = yTop + (yBot - yTop) * i / n; x = x1 + (i / n) * 20;
      d += 'L' + P(x + depth * (0.6 + R() * 0.6), y - (yBot - yTop) / n * 0.5) + 'L' + P(x - depth * 0.2, y - (yBot - yTop) / n);
    }
    return d + 'L' + P(x1 - 6, yTop) + 'Z';
  }
  function circleD(x, y, r) { return 'M' + P(x - r, y) + 'A' + r1(r) + ',' + r1(r) + ' 0 1,0 ' + P(x + r, y) + 'A' + r1(r) + ',' + r1(r) + ' 0 1,0 ' + P(x - r, y) + 'Z'; }
  function ellD(x, y, rx, ry) { return 'M' + P(x - rx, y) + 'A' + r1(rx) + ',' + r1(ry) + ' 0 1,0 ' + P(x + rx, y) + 'A' + r1(rx) + ',' + r1(ry) + ' 0 1,0 ' + P(x - rx, y) + 'Z'; }

  var TOP_SPIKES_NARUTO = [[-178, 104, 10, -16], [-160, 120, 10, -12], [-141, 128, 10, -7], [-121, 133, 10, -3], [-100, 135, 10, 0], [-79, 134, 10, 3], [-58, 130, 10, 7], [-37, 124, 10, 11], [-16, 110, 10, 15], [2, 98, 9, 18]];

  /* returns { back:[], mid:[], top:[], front:[], lines:[], ties:[], noTop } */
  function hairDef(st, F, hb, hat) {
    var H = { back: [], mid: [], top: [], front: [], lines: [], ties: [], shine: 'band', spk: [] };
    SPIKE_LOG = [];
    var cover = hat && hat !== 'none' && hat !== 'horns';
    switch (st) {
      case 'spiky':
        H.back.push(BACK_ROUND, spikes(283, 192, 76, [[-196, 110, 11, -20], [-176, 122, 11, -14], [-156, 132, 11, -8], [-136, 140, 11, -4], [-115, 144, 11, -1], [-94, 144, 11, 1], [-73, 144, 11, 4], [-52, 140, 11, 7], [-31, 134, 11, 11], [-10, 124, 11, 15], [10, 112, 11, 20], [28, 100, 10, 24]]));
        H.top.push(CAP, spikes(281, 196, 72, TOP_SPIKES_NARUTO));
        H.front.push(strand(214, 242, 164, 212, 222, -6), strand(238, 268, 162, 244, 230, -4), strand(262, 294, 160, 276, 232, 0), strand(288, 318, 160, 308, 228, 4), strand(312, 342, 164, 338, 220, 7),
          strand(197, 213, 196, 194, 262, -5), strand(350, 366, 196, 370, 260, 5));
        H.shine = 'spikes';
        break;
      case 'spiky_up':
        H.back.push(BACK_ROUND, spikes(284, 192, 76, [[-192, 108, 12, 6], [-172, 124, 12, 10], [-152, 142, 12, 14], [-131, 160, 13, 18], [-109, 172, 13, 22], [-87, 176, 13, 26], [-65, 170, 13, 28], [-43, 156, 12, 30], [-21, 138, 12, 30], [1, 118, 11, 30], [20, 102, 10, 28]]));
        H.top.push(CAP, spikes(281, 196, 72, [[-172, 100, 10, 6], [-152, 118, 11, 10], [-131, 138, 12, 14], [-109, 152, 12, 18], [-87, 158, 12, 22], [-65, 152, 12, 24], [-43, 140, 11, 26], [-21, 122, 11, 26], [-2, 104, 10, 24]]));
        H.front.push(strand(222, 252, 164, 224, 214, -6), strand(248, 280, 162, 258, 226, -2), strand(276, 306, 162, 294, 220, 4), strand(198, 214, 196, 197, 252, -3), strand(350, 366, 196, 368, 248, 4));
        H.shine = 'spikes';
        break;
      case 'duck':
      case 'duck_long':
        var lg = st === 'duck_long';
        H.back.push(BACK_ROUND, spikes(296, 184, 72, [[-112, 118, 12, 12], [-90, 134, 13, 18], [-68, 148, 13, 22], [-46, 156, 14, 26], [-24, 154, 13, 30], [-2, 146, 12, 34], [20, 132, 11, 36], [40, 114, 10, 36], [58, 100, 9, 34]]));
        H.top.push(CAP, spikes(281, 196, 74, [[-176, 96, 12, -8], [-152, 104, 12, -6], [-128, 106, 12, -2], [-104, 104, 12, 4]]));
        H.front.push(
          strand(198, 232, 168, lg ? 204 : 208, lg ? 318 : 296, -8),
          strand(330, 364, 168, lg ? 356 : 352, lg ? 312 : 290, 6),
          strand(236, 268, 160, 244, lg ? 238 : 226, -4),
          strand(258, 292, 158, 270, lg ? 262 : 240, 0),
          strand(286, 318, 160, 304, lg ? 236 : 226, 4),
          strand(312, 342, 164, 334, 220, 6));
        break;
      case 'fringe_spiky':
        H.back.push(BACK_ROUND, spikes(283, 192, 76, [[-190, 108, 12, -16], [-166, 122, 12, -10], [-142, 130, 12, -5], [-118, 134, 12, -1], [-94, 134, 12, 2], [-70, 132, 12, 6], [-46, 126, 12, 10], [-22, 118, 12, 14], [2, 106, 11, 20]]));
        H.top.push(CAP, spikes(281, 196, 72, [[-170, 100, 11, -12], [-146, 112, 11, -6], [-122, 118, 11, -2], [-98, 120, 11, 2], [-74, 118, 11, 6], [-50, 112, 11, 10], [-26, 102, 11, 14]]));
        H.front.push(strand(204, 232, 166, 206, 230, -6), strand(226, 256, 162, 232, 234, -4), strand(250, 280, 160, 258, 236, -2), strand(274, 304, 160, 284, 236, 2), strand(298, 328, 162, 312, 232, 4), strand(322, 352, 166, 344, 226, 6), strand(346, 366, 190, 366, 240, 4));
        H.shine = 'spikes';
        break;
      case 'long_straight':
        H.back.push('M200,190C186,300 178,440 168,580L394,580C386,440 378,300 364,190Z', BACK_ROUND);
        H.top.push(CAP);
        H.front.push('M281,158C248,158 220,178 208,214C202,240 202,282 200,322L222,318C220,278 222,242 230,216C240,190 258,174 281,166Z',
          'M281,158C314,158 342,178 354,214C360,240 360,282 362,322L340,318C342,278 340,242 332,216C322,190 304,174 281,166Z');
        H.lines.push('M281,114Q279,140 281,164');
        break;
      case 'hime':
        H.back.push('M198,190C184,300 178,450 170,600L392,600C384,450 378,300 364,190Z', BACK_ROUND);
        H.top.push(CAP);
        H.front.push('M206,216C210,180 240,160 281,158C322,160 352,180 356,216L346,220L336,206L324,218L312,204L298,218L284,204L270,218L256,204L242,218L230,206L218,222Z',
          'M198,196L226,200L228,314L200,316Z', 'M336,200L364,196L362,314L334,316Z');
        break;
      case 'low_ponytail':
        H.back.push(BACK_ROUND);
        H.top.push(CAP);
        H.mid.push('M328,262C348,302 362,352 364,420C360,436 352,440 346,432C344,372 330,322 314,280Z');
        H.ties.push([334, 272, 18, 10, 30]);
        H.front.push('M281,158C248,158 222,178 210,214C204,240 204,272 206,306L222,302C220,272 222,242 230,216C240,190 258,174 281,166Z',
          'M281,158C314,158 340,178 352,214C358,240 358,272 356,306L340,302C342,272 340,242 332,216C322,190 304,174 281,166Z');
        H.lines.push('M281,114Q279,140 281,164');
        break;
      case 'high_ponytail':
        H.back.push(BACK_ROUND, 'M314,116C376,92 424,150 418,250C414,330 426,400 442,452C404,424 388,350 386,288C382,210 362,160 326,146Z');
        H.top.push(CAP);
        H.ties.push([324, 124, 16, 12, -30]);
        H.front.push(strand(212, 246, 166, 212, 226, -6), strand(242, 278, 160, 254, 222, -2), strand(274, 308, 160, 296, 220, 4), strand(198, 216, 196, 200, 276, -4), strand(346, 366, 196, 362, 268, 4));
        break;
      case 'long_bang':
        H.back.push(BACK_ROUND, 'M314,116C376,92 424,150 418,250C414,330 426,400 442,452C404,424 388,350 386,288C382,210 362,160 326,146Z');
        H.top.push(CAP);
        H.ties.push([324, 124, 16, 12, -30]);
        H.front.push('M296,160C252,158 214,182 204,226C198,262 204,300 212,326C222,300 236,276 254,262C266,244 274,214 300,170Z',
          strand(292, 322, 162, 316, 214, 4), strand(318, 348, 166, 342, 210, 6), strand(346, 366, 196, 364, 262, 4));
        break;
      case 'pineapple':
        H.back.push(spikes(300, 122, 20, [[-162, 66, 16, -16], [-136, 76, 16, -8], [-110, 82, 16, 0], [-84, 80, 16, 8], [-58, 74, 16, 14], [-32, 64, 16, 20], [-8, 52, 14, 24]]), BACK_ROUND);
        H.top.push(CAP_HI);
        H.ties.push([300, 128, 20, 10, 0]);
        H.front.push(strand(198, 214, 190, 199, 252, -3), strand(350, 366, 190, 366, 250, 3));
        H.lines.push('M240,152Q270,130 296,128', 'M260,150Q284,134 304,134', 'M320,148Q312,136 304,130');
        break;
      case 'bowl':
        H.top.push('M194,256C184,180 206,108 281,104C356,108 380,180 368,256L358,256L358,204Q281,192 204,204L204,256Z');
        H.lines.push('M232,200L234,170', 'M258,196L259,160', 'M284,194L284,156', 'M310,196L309,160', 'M336,200L334,170');
        H.shine = 'gloss';
        break;
      case 'buns':
        H.back.push(circleD(226, 128, 30), circleD(338, 124, 30), BACK_ROUND);
        H.top.push(CAP);
        H.front.push(strand(214, 246, 166, 214, 218, -6), strand(242, 278, 160, 254, 216, -2), strand(284, 318, 160, 306, 214, 4), strand(198, 216, 196, 200, 262, -4), strand(346, 366, 196, 362, 260, 4));
        H.lines.push('M281,114Q279,140 281,160', 'M210,124Q226,112 242,124', 'M322,120Q338,108 354,120');
        break;
      case 'bob':
        H.back.push('M192,196C176,252 184,304 206,326L356,326C380,304 386,252 370,196C360,130 320,104 281,104C242,104 202,130 192,196Z');
        H.top.push(CAP);
        H.front.push(strand(212, 250, 166, 214, 216, -6), strand(244, 286, 160, 258, 218, -2), strand(280, 320, 160, 306, 214, 4), strand(314, 350, 166, 344, 210, 6),
          strand(196, 224, 186, 208, 322, -2), strand(338, 366, 186, 354, 322, 2));
        break;
      case 'wavy_long':
        H.back.push('M196,196C168,260 198,320 172,380C150,440 190,500 166,566L398,566C374,500 414,440 392,380C366,320 396,260 366,196Z', BACK_ROUND);
        H.top.push(CAP);
        H.front.push('M290,158C246,160 216,184 206,222C196,262 214,290 198,336C222,316 232,284 226,252C224,222 244,190 296,166Z',
          'M290,158C330,162 352,186 358,222C366,262 350,290 362,330C342,312 334,284 338,252C340,222 324,192 284,168Z');
        break;
      case 'short':
        H.back.push(BACK_ROUND);
        H.top.push(CAP, spikes(281, 196, 78, [[-156, 92, 15, -10], [-124, 96, 16, -4], [-92, 97, 16, 3], [-60, 94, 15, 9], [-30, 89, 13, 14]]));
        H.front.push(strand(214, 246, 166, 216, 208, -6), strand(242, 276, 160, 252, 212, -2), strand(272, 308, 160, 294, 210, 4), strand(304, 336, 164, 328, 204, 6), strand(198, 214, 196, 199, 244, -3), strand(350, 366, 196, 366, 242, 3));
        break;
      case 'messy':
        H.back.push(BACK_ROUND, spikes(283, 194, 76, [[-200, 104, 12, -24], [-178, 118, 12, -12], [-156, 124, 12, 6], [-134, 128, 12, -8], [-112, 130, 12, 6], [-90, 130, 12, -4], [-68, 128, 12, 8], [-46, 124, 12, -2], [-24, 118, 12, 12], [-2, 110, 12, 20], [20, 100, 11, 26]]));
        H.top.push(CAP, spikes(281, 196, 72, [[-174, 98, 11, -18], [-152, 112, 11, 4], [-130, 118, 11, -10], [-108, 120, 11, 6], [-86, 120, 11, -4], [-64, 118, 11, 10], [-42, 112, 11, 2], [-20, 104, 11, 16]]));
        H.front.push(strand(212, 240, 166, 208, 214, -8), strand(236, 266, 162, 242, 224, -2), strand(258, 290, 160, 280, 218, 6), strand(198, 214, 196, 197, 250, -4), strand(350, 366, 200, 368, 244, 4));
        H.shine = 'spikes';
        break;
      case 'slick_back':
        H.back.push(BACK_ROUND, spikes(300, 178, 70, [[-70, 102, 14, 28], [-45, 110, 14, 32], [-20, 108, 13, 36], [4, 100, 12, 38], [26, 90, 11, 38]]));
        H.top.push(CAP_HI);
        H.lines.push('M232,150Q270,124 320,124', 'M246,148Q286,130 334,136', 'M262,146Q300,136 344,150', 'M216,170Q236,140 266,128');
        break;
      case 'buzz':
        H.top.push('M200,236C194,170 226,118 281,116C336,118 368,170 362,236L354,234C352,198 340,176 318,168Q281,158 244,168C222,176 210,198 208,234Z');
        H.shine = 'none';
        break;
      case 'bald': case 'none':
        H.shine = 'none';
        break;
      case 'hood':
        H.hood = true; H.shine = 'none';
        break;
      case 'wild_long':
        H.back.push(mane(196, 366, 180, 560, 7, 22, 7), BACK_ROUND);
        H.top.push(CAP, spikes(281, 196, 74, [[-176, 100, 11, -14], [-154, 112, 11, -10], [-132, 118, 11, -6], [-110, 120, 11, -2], [-88, 120, 11, 2], [-66, 118, 11, 6], [-44, 112, 11, 10], [-22, 104, 11, 14]]));
        H.front.push(strand(196, 230, 170, 200, 330, -6), strand(334, 366, 170, 360, 326, 6), strand(232, 266, 160, 240, 236, -4), strand(262, 296, 158, 278, 240, 2), strand(292, 326, 162, 318, 228, 6));
        H.shine = 'spikes';
        break;
      case 'very_long':
        H.back.push('M200,186C176,300 172,460 152,650L410,650C392,460 388,300 362,186Z', BACK_ROUND);
        H.top.push(CAP);
        H.front.push('M244,166C214,180 202,214 202,262C202,324 194,388 184,452L212,446C220,388 224,324 224,262C224,224 232,196 254,176Z',
          'M318,166C348,180 360,214 360,262C360,324 368,388 378,452L350,446C342,388 338,324 338,262C338,224 330,196 308,176Z',
          strand(240, 276, 160, 252, 218, -3), strand(276, 316, 160, 302, 216, 4));
        H.lines.push('M281,114Q279,140 281,160');
        break;
      case 'twin_tails':
        H.back.push(BACK_ROUND);
        H.top.push(CAP);
        H.mid.push('M222,268C200,310 184,380 186,470C192,486 204,488 212,476C206,400 218,330 236,282Z', 'M340,268C362,310 378,380 376,470C370,486 358,488 350,476C356,400 344,330 326,282Z');
        H.ties.push([228, 276, 18, 10, -20], [334, 276, 18, 10, 20]);
        H.front.push('M290,158C250,160 220,182 210,218C204,246 206,276 210,300C220,276 228,252 238,230C252,200 270,180 296,168Z', strand(292, 324, 162, 318, 222, 4), strand(320, 350, 166, 344, 216, 6), strand(348, 366, 196, 364, 280, 4));
        break;
      case 'quad':
        H.back.push(spikes(206, 156, 14, [[-200, 58, 16, -10], [-170, 64, 16, -6], [-140, 56, 16, 0]]), spikes(200, 238, 14, [[150, 54, 16, 10], [180, 62, 16, 4], [210, 54, 16, -4]]),
          spikes(356, 152, 14, [[-40, 56, 16, 0], [-10, 64, 16, 6], [20, 58, 16, 10]]), spikes(362, 234, 14, [[-30, 54, 16, 4], [0, 62, 16, 0], [30, 54, 16, -4]]), BACK_ROUND);
        H.top.push(CAP);
        H.front.push(strand(226, 276, 162, 236, 220, -6), strand(286, 336, 162, 326, 218, 6), strand(198, 216, 196, 200, 252, -3), strand(346, 366, 196, 364, 250, 3));
        H.lines.push('M281,114Q279,140 281,162');
        break;
      case 'flower':
        H.back.push(circleD(330, 124, 30), 'M194,196C184,250 190,280 206,296L356,296C372,280 380,250 368,196C358,132 320,106 281,106C242,106 204,132 194,196Z');
        H.top.push(CAP);
        H.front.push('M268,160C232,164 210,186 204,222C200,256 202,286 208,312L226,306C222,280 222,252 228,226C236,196 250,176 272,168Z', strand(268, 306, 160, 286, 214, 2), strand(300, 334, 162, 326, 212, 6), strand(344, 366, 196, 362, 262, 4));
        H.flower = [330, 118];
        break;
      case 'shaggy':
        H.back.push(BACK_ROUND, spikes(283, 210, 74, [[170, 108, 12, -14], [150, 114, 12, -10], [130, 112, 12, -6], [50, 112, 12, 6], [30, 114, 12, 10], [10, 108, 12, 14]]),
          spikes(283, 194, 76, [[-186, 108, 12, -16], [-160, 118, 12, -10], [-134, 124, 12, -4], [-108, 126, 12, 0], [-82, 126, 12, 4], [-56, 122, 12, 10], [-30, 116, 12, 14], [-4, 108, 12, 18]]));
        H.top.push(CAP, spikes(281, 196, 74, [[-168, 98, 11, -14], [-142, 108, 11, -8], [-116, 112, 11, -2], [-90, 112, 11, 2], [-64, 108, 11, 8], [-38, 102, 11, 12]]));
        H.front.push(strand(206, 238, 166, 204, 226, -8), strand(232, 266, 162, 238, 230, -4), strand(260, 294, 160, 274, 228, 2), strand(290, 322, 160, 310, 226, 6), strand(318, 348, 166, 344, 218, 8), strand(196, 214, 196, 192, 270, -6), strand(350, 368, 196, 372, 268, 6));
        H.shine = 'spikes';
        break;
      case 'straight_bangs':
        H.back.push('M194,196C188,260 186,320 190,372L372,372C376,320 374,260 368,196Z', BACK_ROUND);
        H.top.push(CAP);
        H.front.push('M206,214C210,180 240,160 281,158C322,160 352,180 356,214L344,216L332,208L320,216L306,208L292,216L278,208L264,216L250,208L236,216L222,208L214,218Z',
          'M196,196L222,200L222,330L198,334Z', 'M340,200L366,196L364,334L340,330Z');
        break;
      case 'helmet':
        H.top.push('M196,240C190,166 222,108 281,106C340,108 372,166 366,240L356,240C354,198 342,176 320,168Q281,156 242,168C220,176 208,198 206,240Z');
        H.lines.push('M212,214Q281,176 350,214');
        H.shine = 'gloss';
        break;
      default:
        H.back.push(BACK_ROUND);
        H.top.push(CAP);
        H.front.push(strand(214, 246, 166, 216, 210, -6), strand(242, 276, 160, 252, 214, -2), strand(272, 308, 160, 294, 212, 4));
    }
    if (cover) { // hats: keep long back hair, flatten the top
      H.top = H.top.length ? [H.top[0]] : [];
      H.back = H.back.filter(function (d) { return d.indexOf('A') < 0 || d === BACK_ROUND; });
      if (hat === 'hood_up' || hat === 'samurai_helm') { H.back = []; H.top = []; H.mid = []; H.ties = []; }
      H.shine = H.shine === 'spikes' ? 'band' : H.shine;
    }
    if (hb === 'bandana') { H.top = []; H.back = H.back.filter(function (d) { return d !== BACK_ROUND; }); }
    // spike sets of the top layer (cy 196) get glints
    H.spk = cover ? [] : SPIKE_LOG.filter(function (z) { return z.cy === 196; });
    SPIKE_LOG = null;
    return H;
  }

  // the anime "angel ring" highlight / spike glints, clipped to the hair top
  function hairShine(X, H, base) {
    var lb = lum(base), hl = lb < 0.22 ? mix(base, '#9fb4ff', 0.42) : lt(base, lb > 0.7 ? 0.6 : 0.42), s = '';
    if (H.shine === 'none' || !H.top.length) return '';
    var clip = X.clipPaths(H.top.concat(H.front));
    if (H.shine === 'gloss') {
      s += path('M214,180C222,132 252,118 280,116C250,128 236,150 232,190Z', hl, 'opacity="0.8"');
      s += path('M248,140Q281,124 318,136L314,146Q281,134 252,150Z', '#fff', 'opacity="0.55"');
    } else if (H.shine === 'spikes' && H.spk && H.spk.length) {
      var st = '';
      H.spk.forEach(function (z) {
        z.items.forEach(function (it) {
          if (it[0] > -20 || it[0] < -175) return;
          var cu = it[3] || 0, a0 = it[0] - it[2] * 0.25, len = (it[1] - z.rb);
          var p0 = pol(z.cx, z.cy, z.rb - 6, a0), p1 = pol(z.cx, z.cy, z.rb + len * 0.62, it[0] + cu * 0.55 - it[2] * 0.2), pm = pol(z.cx, z.cy, z.rb + len * 0.3, a0 + cu * 0.2), q = pol(z.cx, z.cy, z.rb + len * 0.3, a0 + it[2] * 0.35);
          st += 'M' + PP(p0) + 'Q' + PP(pm) + ' ' + PP(p1) + 'Q' + PP(q) + ' ' + PP(p0) + 'Z';
        });
      });
      s += path(st, hl, 'opacity="0.75"');
      s += path('M220,182C230,150 254,134 281,132C256,142 240,158 234,186Z', hl, 'opacity="0.5"');
    } else if (H.shine === 'spikes') {
      s += path('M220,182C230,150 254,134 281,132C256,142 240,158 234,186Z', hl, 'opacity="0.6"');
    } else {
      s += path('M214,176C226,140 250,126 281,124C312,126 336,140 348,176L340,180L332,164L322,178L312,160L300,176L290,158L280,174L270,158L260,176L250,160L240,178L230,164L222,180Z', hl, 'opacity="0.65"');
    }
    return '<g clip-path="' + clip + '">' + s + '</g>';
  }

  function paintHair(X, list, base, deep) {
    return paintGroup(X, list, deep ? dk(base, 0.38) : base, { shadow: dk(base, deep ? 0.55 : 0.3), ink: inkOf(base) });
  }

  /* ======================================================================
   * 7. village symbols (headband plates, emblems)
   * unit space: roughly -1..1, stroke-based, drawn in `c`
   * ==================================================================== */
  function spiralD(turns, r0, r1_, a0) {
    var d = '', n = Math.round(turns * 28);
    for (var i = 0; i <= n; i++) {
      var t = i / n, a = a0 + t * turns * 360, r = r0 + (r1_ - r0) * t, p = pol(0, 0, r, a);
      d += (i ? 'L' : 'M') + r1(p[0] * 100) / 100 + ',' + r1(p[1] * 100) / 100;
    }
    return d;
  }
  var SYM_KONOHA = spiralD(1.15, 0.06, 0.62, 140);
  function symbol(key, c, sw) {
    sw = sw || 0.16;
    var st = ' fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"';
    switch (key) {
      case 'konoha':
        return '<path d="' + SYM_KONOHA + 'L0.86,-0.72L0.5,-0.3"' + st + '/><path d="M-0.5,0.5L-0.85,0.86"' + st + '/>';
      case 'suna':
        return '<path d="M-0.55,-0.72H0.55L0.12,0L0.55,0.72H-0.55L-0.12,0Z"' + st + '/><path d="M-0.75,-0.72H0.75M-0.75,0.72H0.75"' + st + '/>';
      case 'kiri':
        return '<path d="M-0.72,0.7Q-0.66,-0.1 -0.4,-0.72M-0.32,0.7Q-0.26,-0.1 0,-0.72M0.08,0.7Q0.14,-0.1 0.4,-0.72M0.48,0.7Q0.54,-0.1 0.8,-0.72"' + st + '/>';
      case 'kumo':
        return '<path d="M-0.85,0.55H0.85M-0.7,0.55Q-0.7,0.05 -0.25,0.1Q-0.2,-0.5 0.28,-0.42Q0.72,-0.38 0.66,0.12Q0.9,0.2 0.8,0.55"' + st + '/><path d="M-0.25,0.1Q0.05,0.15 0.1,0.4"' + st + '/>';
      case 'iwa':
        return '<path d="M-0.8,0.7V-0.1L-0.42,-0.62L-0.04,-0.1V0.7M0.04,0.7V-0.3L0.42,-0.78L0.8,-0.3V0.7M-0.9,0.7H0.9"' + st + '/>';
      case 'oto':
        return '<ellipse cx="-0.3" cy="0.5" rx="0.3" ry="0.22" transform="rotate(-25 -0.3 0.5)" fill="' + c + '"/><path d="M-0.02,0.45V-0.75Q0.35,-0.55 0.6,-0.2Q0.4,-0.38 0.1,-0.42"' + st + '/>';
      case 'ame':
        return '<path d="M-0.6,-0.7V0.7M-0.2,-0.7V0.7M0.2,-0.7V0.7M0.6,-0.7V0.7"' + st + '/>';
      case 'taki':
        return '<path d="M0,-0.8C0.5,-0.2 0.6,0.1 0.6,0.3A0.6,0.6 0 0,1 -0.6,0.3C-0.6,0.1 -0.5,-0.2 0,-0.8Z"' + st + '/><path d="M0,-0.2V0.6"' + st + '/>';
      case 'allied':
        return '<text x="0" y="0.36" font-size="1.05" font-weight="900" text-anchor="middle" fill="' + c + '" font-family="' + FONT + '">忍</text>';
      case 'yu': // 汤隐: hot-spring basin with three rising wisps of steam
        return '<path d="M-0.66,0.12Q-0.72,0.74 0,0.74Q0.72,0.74 0.66,0.12"' + st + '/><path d="M-0.34,0.32Q-0.52,0.02 -0.32,-0.28Q-0.12,-0.58 -0.32,-0.86M0.02,0.32Q-0.16,0.02 0.04,-0.28Q0.24,-0.58 0.04,-0.86M0.38,0.32Q0.2,0.02 0.4,-0.28Q0.6,-0.58 0.4,-0.86"' + st + '/>';
      default:
        return '<path d="M0,-0.8L0.22,-0.22L0.8,0L0.22,0.22L0,0.8L-0.22,0.22L-0.8,0L-0.22,-0.22Z" fill="' + c + '"/>';
    }
  }

  /* ======================================================================
   * 8. body / outfits
   * ==================================================================== */
  function bodyGeom(bw, thin) {
    var C = 276, b = bw, t = thin || 1;
    function x(v) { return r1(C + v * b); }
    function xi(outer, inner) { return x(outer + (inner - outer) * t); }
    var G = { C: C, b: b, x: x };
    G.armF = 'M' + x(-112) + ',382C' + x(-146) + ',376 ' + x(-172) + ',394 ' + x(-177) + ',436C' + x(-184) + ',500 ' + x(-196) + ',580 ' + x(-206) + ',650L' + xi(-206, -136) + ',650C' + xi(-196, -128) + ',580 ' + xi(-184, -116) + ',520 ' + x(-104) + ',470Z';
    G.armN = 'M' + x(122) + ',384C' + x(158) + ',380 ' + x(186) + ',398 ' + x(191) + ',442C' + x(199) + ',505 ' + x(210) + ',585 ' + x(220) + ',650L' + xi(220, 148) + ',650C' + xi(210, 138) + ',585 ' + xi(199, 128) + ',525 ' + x(118) + ',476Z';
    G.top = 'M' + x(-118) + ',380C' + x(-148) + ',394 ' + x(-130) + ',440 ' + x(-110) + ',474C' + x(-112) + ',540 ' + x(-104) + ',600 ' + x(-98) + ',650L' + x(108) + ',650C' + x(114) + ',600 ' + x(122) + ',540 ' + x(122) + ',478C' + x(140) + ',444 ' + x(160) + ',396 ' + x(128) + ',382';
    // torso with a given neckline (from near neck base (306,334) to far neck base (250,334))
    G.torso = function (neck) {
      return G.top + 'C' + x(94) + ',362 318,350 306,334' + neck + 'C238,350 ' + x(-84) + ',360 ' + x(-118) + ',380Z';
    };
    G.sleeveless = function (neck) { // narrower shoulders, arms show
      return 'M' + x(-96) + ',372C' + x(-104) + ',410 ' + x(-104) + ',440 ' + x(-102) + ',474C' + x(-108) + ',540 ' + x(-102) + ',600 ' + x(-98) + ',650L' + x(108) + ',650C' + x(112) + ',600 ' + x(118) + ',540 ' + x(114) + ',478C' + x(114) + ',440 ' + x(112) + ',410 ' + x(104) + ',374' +
        'C' + x(80) + ',360 318,350 306,334' + neck + 'C238,350 ' + x(-70) + ',358 ' + x(-96) + ',372Z';
    };
    return G;
  }
  var NL = { crew: 'Q278,360 250,334', high: 'L307,312Q278,324 249,312L250,334', v: 'L266,440L250,334', vdeep: 'L264,520L250,334', round: 'Q278,376 250,334' };

  function konohaSwirl(x, y, r, c) {
    return '<g transform="translate(' + r1(x) + ',' + r1(y) + ') scale(' + r + ')"><path d="' + spiralD(1.6, 0.05, 1, 0) + '" fill="none" stroke="' + c + '" stroke-width="0.28" stroke-linecap="round"/></g>';
  }
  function cloudD(x, y, s) { // akatsuki cloud
    return 'M' + P(x - 1.0 * s, y + 0.32 * s) + 'C' + P(x - 1.3 * s, y + 0.3 * s) + ' ' + P(x - 1.25 * s, y - 0.22 * s) + ' ' + P(x - 0.88 * s, y - 0.16 * s) +
      'C' + P(x - 0.86 * s, y - 0.58 * s) + ' ' + P(x - 0.32 * s, y - 0.62 * s) + ' ' + P(x - 0.22 * s, y - 0.32 * s) +
      'C' + P(x - 0.08 * s, y - 0.76 * s) + ' ' + P(x + 0.5 * s, y - 0.72 * s) + ' ' + P(x + 0.46 * s, y - 0.28 * s) +
      'C' + P(x + 0.72 * s, y - 0.52 * s) + ' ' + P(x + 1.18 * s, y - 0.3 * s) + ' ' + P(x + 1.0 * s, y + 0.02 * s) +
      'C' + P(x + 1.32 * s, y + 0.08 * s) + ' ' + P(x + 1.28 * s, y + 0.42 * s) + ' ' + P(x + 0.98 * s, y + 0.38 * s) + 'Z';
  }
  function flameRow(x0, x1, yb, h, n, seed) { // flames rising from yb (bottom) upward
    var R = rng(seed), d = 'M' + P(x0, yb + 40), w = (x1 - x0) / n;
    for (var i = 0; i < n; i++) {
      var xa = x0 + i * w, hh = h * (0.6 + R() * 0.6);
      d += 'L' + P(xa, yb) + 'Q' + P(xa + w * 0.15, yb - hh * 0.5) + ' ' + P(xa + w * 0.55, yb - hh) + 'Q' + P(xa + w * 0.45, yb - hh * 0.45) + ' ' + P(xa + w, yb);
    }
    return d + 'L' + P(x1, yb + 40) + 'Z';
  }

  /* outfit → { arms, torso, collar, neckCover } strings; G geometry; Cc colours */
  function drawOutfit(X, a, G, Cc, ctxc) {
    var o = pick(a.outfit, ART.outfit, 'shirt');
    var main = Cc.main, acc = Cc.acc, skin = Cc.skin, L = X.lw;
    var x = G.x, out = { arms: '', torso: '', collar: '', chest: false, armsSkin: false };
    var torsoD, neck = 'crew', sleeves = main, armSkin = false, torsoFill = main;
    var details = '', collar = '';
    var clipT;
    switch (o) {
      case 'jacket': neck = 'high'; break;
      case 'flak': neck = 'high'; sleeves = acc; break;
      case 'highcollar': neck = 'high'; break;
      case 'robe': neck = 'vdeep'; out.chest = true; break;
      case 'akatsuki': neck = 'high'; break;
      case 'kage': neck = 'v'; out.chest = true; break;
      case 'haori_flame': neck = 'high'; break;
      case 'armor': neck = 'high'; sleeves = dk(acc, 0.1); break;
      case 'kimono': neck = 'v'; out.chest = true; break;
      case 'anbu': neck = 'high'; armSkin = true; break;
      case 'bodysuit': neck = 'high'; break;
      case 'sleeveless': neck = 'high'; armSkin = true; break;
      case 'qipao': neck = 'high'; armSkin = true; break;
      case 'coat': neck = 'v'; out.chest = true; break;
      case 'six_paths': neck = 'high'; break;
      case 'otsutsuki': neck = 'high'; break;
      case 'samurai': neck = 'v'; out.chest = true; break;
      case 'mesh': neck = 'crew'; torsoFill = skin; out.chest = true; break;
      case 'bandage': neck = 'crew'; torsoFill = skin; out.chest = true; armSkin = true; break;
      case 'cloak': neck = 'high'; break;
      case 'chakra_cloak': neck = 'high'; break;
      default: neck = 'crew';
    }
    var narrow = armSkin && o !== 'bandage';
    torsoD = narrow ? G.sleeveless(NL[neck]) : G.torso(NL[neck]);
    out.torsoD = torsoD;
    // arms
    var armCol = armSkin ? skin : sleeves;
    var armSh = armSkin ? Cc.skinSh : dk(armCol, 0.28);
    out.armCol = armCol; out.armSkin = armSkin;
    out.arms = paintGroup(X, [G.armF, G.armN], armCol, { shadow: armSh, sx: 16, sy: 4, ink: armSkin ? Cc.skinInk : inkOf(armCol) });
    var fk = armSkin ? Cc.skinInk : inkOf(armCol);
    if (!armSkin) out.arms += line('M' + x(-178) + ',548Q' + x(-160) + ',556 ' + x(-146) + ',546M' + x(-182) + ',586Q' + x(-162) + ',592 ' + x(-150) + ',580M' + x(-128) + ',470Q' + x(-140) + ',500 ' + x(-134) + ',530' +
      'M' + x(192) + ',552Q' + x(176) + ',562 ' + x(160) + ',550M' + x(198) + ',592Q' + x(180) + ',598 ' + x(166) + ',586M' + x(140) + ',476Q' + x(152) + ',506 ' + x(146) + ',536', fk, L * 0.6, 'opacity="0.45"');
    else out.arms += line('M' + x(-150) + ',560Q' + x(-140) + ',566 ' + x(-132) + ',560M' + x(164) + ',566Q' + x(154) + ',572 ' + x(146) + ',566', fk, L * 0.5, 'opacity="0.4"');
    if (armSkin && (o === 'anbu')) { // arm guards
      var gd = [G.armF, G.armN];
      out.arms += '<g clip-path="' + X.clipPaths(gd) + '">' + path('M0,560H560V660H0Z', '#d4d7dc') + line('M0,566H560', '#6b6f78', L * 0.8) + '</g>';
    }
    if (o === 'anbu' || (o === 'flak' && (ctxc.konoha))) {
      out.arms += konohaSwirl(G.C + 156 * G.b, 430, 12, '#c8102e');
    }
    if (o === 'akatsuki') {
      out.arms += '<g clip-path="' + X.clipPaths([G.armF, G.armN]) + '">' + path(cloudD(x(-150), 520, 26), '#ffffff') + path(cloudD(x(-150), 520, 22), acc) + path(cloudD(x(166), 560, 26), '#ffffff') + path(cloudD(x(166), 560, 22), acc) + '</g>';
    }
    if (o === 'chakra_cloak') { // 九喇嘛模式: glowing chakra shroud with black seal lines
      var seal = '#1a1206', flick = '';
      [[-150, 392, -14], [-118, 376, -6], [134, 380, 8], [166, 396, 16], [-176, 440, -22], [190, 446, 24]].forEach(function (f, i) { flick += tongue(x(f[0]), f[1] + 6, 46 + (i % 3) * 12, 26, f[2]); });
      out.arms = path(flick, lt(main, 0.45), 'opacity="0.85"') + out.arms;
      out.arms += '<g clip-path="' + X.clipPaths([G.armF, G.armN]) + '">' + path('M0,380H560V660H0Z', X.lin([[0, lt(main, 0.5), 0.55], [0.6, main, 0], [1, dk(main, 0.2), 0.3]], 0, 0, 1, 0)) +
        line('M' + x(-150) + ',430Q' + x(-170) + ',520 ' + x(-176) + ',650M' + x(170) + ',436Q' + x(186) + ',520 ' + x(196) + ',650', seal, L * 1.4) +
        line('M' + x(-196) + ',560Q' + x(-160) + ',570 ' + x(-124) + ',556M' + x(210) + ',566Q' + x(176) + ',576 ' + x(140) + ',562', seal, L * 2.2) + '</g>';
    }
    // torso
    var tsh = torsoFill === skin ? Cc.skinSh : dk(torsoFill, 0.28);
    var t = outlineOf([torsoD], torsoFill === skin ? Cc.skinInk : inkOf(torsoFill), L * 2) + cel(X, torsoD, torsoFill, tsh, 26, 6);
    clipT = X.clipPaths([torsoD]);
    var fold = inkOf(main);
    switch (o) {
      case 'jacket':
        details += path('M0,300H560V418Q' + x(70) + ',380 ' + x(0) + ',394Q' + x(-70) + ',380 0,418Z', acc);
        details += line('M' + x(-4) + ',350L' + x(-2) + ',650', dk(main, 0.5), L * 0.9) + path('M' + x(-12) + ',400h14v26h-14Z', '#d8d8d8', 'stroke="' + dk(main, 0.6) + '" stroke-width="' + r1(L * 0.5) + '"');
        details += line('M' + x(-80) + ',520Q' + x(-60) + ',560 ' + x(-70) + ',600', fold, L * 0.6, 'opacity="0.5"') + line('M' + x(70) + ',520Q' + x(90) + ',570 ' + x(80) + ',610', fold, L * 0.6, 'opacity="0.5"');
        collar = path('M236,346L240,300Q278,316 316,298L320,346Q279,362 236,346Z', lum(main) > 0.6 ? dk(main, 0.15) : acc, 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L) + '"') +
          line('M278,316V358', inkOf(acc), L * 0.6);
        out.sleeveYoke = acc;
        break;
      case 'flak':
        var vest = main;
        if (ctxc.kumo) { // 云隐 flak: one-shoulder vest over a dark undershirt, quilted horizontal ribs, no pouches
          details += path('M' + x(-130) + ',382L250,334L' + x(-36) + ',420L' + x(-60) + ',470L' + x(-118) + ',486Z', acc, 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L) + '"');
          details += path('M' + x(-36) + ',420L' + x(-60) + ',470L' + x(-118) + ',486', 'none', 'stroke="' + inkOf(vest) + '" stroke-width="' + r1(L * 1.4) + '"');
          details += path('M300,336L' + x(122) + ',382L' + x(124) + ',430L' + x(70) + ',410L292,360Z', dk(vest, 0.1), 'stroke="' + inkOf(vest) + '" stroke-width="' + r1(L) + '"');
          details += line('M' + x(-70) + ',520Q' + x(20) + ',512 ' + x(118) + ',522M' + x(-104) + ',570Q' + x(10) + ',562 ' + x(118) + ',572M' + x(-104) + ',620Q' + x(10) + ',612 ' + x(118) + ',622', dk(vest, 0.3), L * 0.9, 'opacity="0.7"');
          details += line('M' + x(8) + ',400V650', dk(vest, 0.45), L * 0.8);
          collar = path('M240,346L243,306Q278,320 314,304L317,346Q279,360 240,346Z', acc, 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L) + '"');
          break;
        }
        details += line('M' + x(-4) + ',360V650', dk(vest, 0.5), L * 0.8);
        [[-92, 452], [-52, 452], [24, 456], [64, 456]].forEach(function (p) {
          var pw = r1(34 * G.b);
          details += '<rect x="' + x(p[0]) + '" y="' + p[1] + '" width="' + pw + '" height="54" rx="5" fill="' + lt(vest, 0.1) + '" stroke="' + inkOf(vest) + '" stroke-width="' + r1(L * 0.8) + '"/>' +
            '<rect x="' + x(p[0]) + '" y="' + p[1] + '" width="' + pw + '" height="16" rx="5" fill="' + dk(vest, 0.18) + '" stroke="' + inkOf(vest) + '" stroke-width="' + r1(L * 0.8) + '"/>' +
            path('M' + r1(x(p[0]) + pw - 8) + ',' + (p[1] + 18) + 'h6v34h-6Z', dk(vest, 0.15), 'opacity="0.7"');
        });
        details += line('M' + x(-104) + ',420Q' + x(-60) + ',404 ' + x(-30) + ',380', inkOf(vest), L * 0.7, 'opacity="0.6"') + line('M' + x(118) + ',424Q' + x(70) + ',404 ' + x(40) + ',380', inkOf(vest), L * 0.7, 'opacity="0.6"');
        collar = path('M232,350L236,300Q278,318 320,300L324,350Q279,370 232,350Z', vest, 'stroke="' + inkOf(vest) + '" stroke-width="' + r1(L) + '"') +
          path('M236,300Q278,318 320,300L318,312Q278,330 238,312Z', dk(vest, 0.25));
        out.neckCover = acc;
        break;
      case 'highcollar':
        collar = path('M226,352L222,282Q240,300 262,312L278,330L296,312Q318,300 336,280L332,352Q279,372 226,352Z', main, 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"') +
          path('M262,312L278,330L296,312L292,338Q278,350 266,338Z', dk(main, 0.35));
        details += line('M' + x(-60) + ',500Q' + x(-40) + ',560 ' + x(-50) + ',620', fold, L * 0.6, 'opacity="0.45"');
        break;
      case 'robe':
        details += path('M318,336Q' + x(30) + ',420 ' + x(-4) + ',650L' + x(30) + ',650Q' + x(46) + ',430 330,342Z', dk(main, 0.12));
        details += path('M318,336Q' + x(30) + ',420 ' + x(-4) + ',650L' + x(10) + ',650Q' + x(36) + ',430 324,340Z', dk(main, 0.3), 'opacity="0.6"');
        details += line('M' + x(-100) + ',420Q' + x(-70) + ',470 ' + x(-80) + ',540M' + x(-70) + ',410Q' + x(-40) + ',500 ' + x(-50) + ',580M' + x(100) + ',430Q' + x(80) + ',480 ' + x(96) + ',540M' + x(60) + ',470Q' + x(40) + ',520 ' + x(56) + ',576', fold, L * 0.65, 'opacity="0.4"');
        details += path('M' + x(60) + ',380Q' + x(110) + ',470 ' + x(100) + ',586L' + x(126) + ',586Q' + x(130) + ',470 ' + x(120) + ',400Z', dk(main, 0.1), 'opacity="0.8"');
        details += line('M' + x(-90) + ',470Q' + x(-50) + ',520 ' + x(-60) + ',600', fold, L * 0.7, 'opacity="0.5"') + line('M' + x(90) + ',470Q' + x(60) + ',540 ' + x(80) + ',610', fold, L * 0.7, 'opacity="0.5"');
        // rope belt
        details += path('M0,586H560V640H0Z', acc) + line('M0,600Q280,594 560,604M0,620Q280,614 560,624', dk(acc, 0.4), L * 0.8);
        for (var ri = 0; ri < 16; ri++) details += line('M' + r1(x(-130) + ri * 18 * G.b) + ',588l10,48', lt(acc, 0.25), L * 0.6, 'opacity="0.6"');
        break;
      case 'akatsuki':
        details += path(cloudD(x(-56), 500, 30), '#ffffff') + path(cloudD(x(-56), 500, 26), acc) + path(cloudD(x(70), 600, 30), '#ffffff') + path(cloudD(x(70), 600, 26), acc);
        details += line('M' + x(2) + ',360V650', '#000', L * 0.8, 'opacity="0.6"');
        collar = path('M220,358L214,270Q236,288 258,318L276,352L294,318Q318,286 342,266L338,358Q279,380 220,358Z', main, 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L * 1.2) + '"') +
          path('M228,300Q246,312 258,318L276,352L294,318Q312,308 330,294L328,316Q306,326 292,340L276,370L260,340Q244,324 230,318Z', acc) +
          line('M214,270Q236,288 258,318M342,266Q318,286 294,318', '#fff', L * 0.5, 'opacity="0.35"');
        break;
      case 'kage':
        details += path('M318,336L' + x(-6) + ',470L' + x(-6) + ',650L' + x(28) + ',650L' + x(28) + ',480L336,342Z', acc) +
          path('M250,334L' + x(-10) + ',464L' + x(-14) + ',474L236,340Z', acc);
        details += path('M0,596H560V650H0Z', dk(acc, 0.15));
        details += line('M' + x(-90) + ',470Q' + x(-50) + ',520 ' + x(-60) + ',590', fold, L * 0.7, 'opacity="0.45"');
        break;
      case 'haori_flame':
        // inner flak vest in the centre, haori over the shoulders
        details += path('M' + x(-60) + ',360L' + x(-40) + ',650H' + x(60) + 'L' + x(70) + ',360Z', '#56713c') + line('M' + x(6) + ',370V650', '#2f3f20', L * 0.8);
        [[-38, 450], [14, 452]].forEach(function (p) { details += path('M' + x(p[0]) + ',' + p[1] + 'h30v48h-30Z', '#62803f', 'stroke="#26331a" stroke-width="' + r1(L * 0.7) + '"'); });
        details += line('M' + x(-60) + ',360L' + x(-40) + ',650M' + x(70) + ',360L' + x(60) + ',650', inkOf(main), L * 1.1);
        details += path(flameRow(x(-140), x(-40), 640, 56, 4, 11), acc) + path(flameRow(x(60), x(150), 640, 56, 4, 12), acc);
        collar = path('M236,348L240,302Q278,318 316,300L320,348Q279,364 236,348Z', '#2a3550', 'stroke="#141a2a" stroke-width="' + r1(L) + '"');
        out.flames = true;
        break;
      case 'armor':
        for (var ai = 0; ai < 6; ai++) {
          var yy = 440 + ai * 34;
          details += path('M0,' + yy + 'H560V' + (yy + 30) + 'H0Z', ai % 2 ? dk(main, 0.08) : main) + line('M0,' + (yy + 30) + 'H560', inkOf(main), L * 0.8);
          for (var lj = -3; lj <= 3; lj++) details += circ(x(lj * 32), yy + 15, 2.4, acc);
        }
        details += path('M' + x(-90) + ',380Q' + x(0) + ',404 ' + x(100) + ',380L' + x(110) + ',440Q' + x(0) + ',470 ' + x(-100) + ',440Z', dk(main, 0.12), 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"');
        collar = path('M236,348L240,304Q278,318 316,302L320,348Q279,364 236,348Z', dk(acc, 0.2), 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L) + '"');
        out.pauldrons = true;
        break;
      case 'kimono':
        details += path('M320,336L' + x(-4) + ',476L' + x(-4) + ',500L334,348Z', lt(acc, 0.2)) + path('M248,334L' + x(-4) + ',478L' + x(-18) + ',470L234,344Z', lt(acc, 0.2));
        details += line('M320,336L' + x(-4) + ',476M248,334L' + x(-4) + ',478', inkOf(main), L);
        details += path('M0,560H560V650H0Z', acc) + line('M0,560H560M0,580H560', dk(acc, 0.4), L * 0.7) + path('M' + x(20) + ',566h40v70h-40Z', dk(acc, 0.25));
        break;
      case 'anbu':
        details += path('M' + x(-104) + ',400Q' + x(0) + ',380 ' + x(116) + ',404L' + x(118) + ',560Q' + x(0) + ',580 ' + x(-106) + ',560Z', '#d6d9de', 'stroke="#5a5e68" stroke-width="' + r1(L) + '"');
        details += line('M' + x(-104) + ',450Q' + x(0) + ',436 ' + x(116) + ',452M' + x(-104) + ',500Q' + x(0) + ',486 ' + x(116) + ',502', '#7a7e88', L * 0.8);
        details += line('M' + x(4) + ',390V570', '#7a7e88', L * 0.8);
        collar = path('M236,350L240,302Q278,318 316,300L320,350Q279,366 236,350Z', acc, 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L) + '"');
        break;
      case 'bodysuit':
        details += line('M' + x(-70) + ',430Q' + x(-20) + ',460 ' + x(4) + ',440Q' + x(30) + ',462 ' + x(80) + ',432', fold, L * 0.8, 'opacity="0.55"');
        details += line('M' + x(4) + ',450V560', fold, L * 0.7, 'opacity="0.45"') + line('M' + x(-30) + ',520Q' + x(4) + ',530 ' + x(40) + ',520M' + x(-30) + ',570Q' + x(4) + ',580 ' + x(40) + ',570', fold, L * 0.6, 'opacity="0.35"');
        collar = path('M240,346L243,306Q278,320 314,304L317,346Q279,360 240,346Z', dk(main, 0.12), 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"');
        break;
      case 'sleeveless':
        details += line('M' + x(-4) + ',360V650', dk(main, 0.45), L * 0.8) + circ(x(-4), 380, 5, '#ddd', 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L * 0.5) + '"');
        collar = path('M240,346L243,306Q278,320 314,304L317,346Q279,360 240,346Z', main, 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"');
        break;
      case 'qipao':
        details += path('M262,350Q' + x(60) + ',380 ' + x(108) + ',430', 'none', 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"');
        [[30, 384], [70, 404]].forEach(function (p) { details += line('M' + x(p[0] - 8) + ',' + p[1] + 'h16', acc, L * 1.6); });
        details += path('M' + x(-110) + ',380Q' + x(-130) + ',420 ' + x(-112) + ',450L' + x(-98) + ',440Z', main) + path('M' + x(120) + ',384Q' + x(140) + ',420 ' + x(120) + ',454L' + x(108) + ',444Z', main);
        collar = path('M242,346L245,310Q278,322 312,308L315,346Q279,358 242,346Z', main, 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"') + line('M245,316Q278,330 312,314', acc, L * 0.8);
        break;
      case 'coat':
        details += path('M320,336L' + x(10) + ',500L' + x(70) + ',420L' + x(100) + ',380Z', dk(main, 0.18), 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"');
        details += path('M248,334L' + x(-2) + ',500L' + x(-60) + ',420L' + x(-90) + ',380Z', lt(main, 0.06), 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"');
        details += path('M266,350L' + x(-2) + ',496L' + x(10) + ',496L310,350Z', acc);
        [520, 570, 620].forEach(function (yy) { details += circ(x(-30), yy, 4.5, dk(main, 0.5)) + circ(x(40), yy, 4.5, dk(main, 0.5)); });
        break;
      case 'six_paths':
        details += path('M' + x(-4) + ',360L' + x(-30) + ',650H' + x(30) + 'Z', dk(main, 0.12));
        details += path(flameRow(x(-130), x(140), 650, 70, 8, 5), acc, 'opacity="0.9"');
        details += line('M' + x(-70) + ',420Q' + x(-80) + ',480 ' + x(-60) + ',540', acc, L * 1.6, 'opacity="0.7"') + line('M' + x(80) + ',430Q' + x(90) + ',490 ' + x(70) + ',550', acc, L * 1.6, 'opacity="0.7"');
        collar = path('M222,352L220,300Q278,330 336,298L334,352Q279,376 222,352Z', main, 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"');
        for (var mi = 0; mi < 9; mi++) { var mx = 230 + mi * 12.5, my = 330 + Math.abs(mi - 4) * -3 + 4; collar += tomoe(mx, my, 3.4, 200, acc); }
        out.glow = true;
        break;
      case 'otsutsuki':
        details += path('M' + x(-4) + ',360L' + x(-30) + ',650H' + x(30) + 'Z', dk(main, 0.1));
        details += line('M' + x(-80) + ',470Q' + x(-50) + ',540 ' + x(-60) + ',620', fold, L * 0.6, 'opacity="0.35"');
        collar = path('M214,356L206,276Q236,300 260,314L278,344L296,314Q320,300 350,274L342,356Q279,380 214,356Z', main, 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"') +
          path('M214,300Q240,312 260,320L262,330Q238,322 214,312Z', acc, 'opacity="0.6"');
        for (var oi = 0; oi < 6; oi++) { collar += tomoe(244 + oi * 14, 354 + (oi === 0 || oi === 5 ? -4 : 0), 3.4, 200, acc); }
        break;
      case 'samurai':
        details += path('M320,336L' + x(-4) + ',470L' + x(-4) + ',490L334,348Z', lt(main, 0.3)) + path('M248,334L' + x(-4) + ',474L' + x(-18) + ',466L234,344Z', lt(main, 0.3));
        details += path('M' + x(-100) + ',480Q' + x(0) + ',466 ' + x(110) + ',482L' + x(114) + ',650H' + x(-104) + 'Z', acc, 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L) + '"');
        for (var si = 0; si < 5; si++) details += line('M' + x(-100) + ',' + (510 + si * 28) + 'Q' + x(0) + ',' + (498 + si * 28) + ' ' + x(112) + ',' + (512 + si * 28), lt(acc, 0.3), L * 0.8);
        out.pauldrons = true;
        break;
      case 'mesh':
        var mesh = '';
        for (var mz = -12; mz <= 12; mz++) mesh += 'M' + (280 + mz * 22) + ',330l-180,320M' + (280 + mz * 22) + ',330l180,320';
        details += line(mesh, main, L * 0.45, 'opacity="0.85"');
        if (isHex(a.accentColor)) {
          details += path('M' + x(-118) + ',380L' + x(-60) + ',380L' + x(-30) + ',650H' + x(-130) + 'Z', acc, 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L) + '"') +
            path('M' + x(128) + ',382L' + x(60) + ',380L' + x(40) + ',650H' + x(140) + 'Z', acc, 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L) + '"');
          out.armsOver = acc;
        }
        break;
      case 'bandage':
        for (var bi = 0; bi < 6; bi++) {
          var by0 = 430 + bi * 36;
          details += path('M0,' + by0 + 'L560,' + (by0 - 24) + 'L560,' + (by0 - 4) + 'L0,' + (by0 + 20) + 'Z', main, 'stroke="' + dk(main, 0.35) + '" stroke-width="' + r1(L * 0.6) + '"');
        }
        details += path('M' + x(110) + ',380L' + x(130) + ',400L' + x(-80) + ',650L' + x(-110) + ',640Z', acc, 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L * 0.8) + '"');
        out.chestLines = true;
        break;
      case 'chakra_cloak':
        var sl = '#1a1206';
        details += ell(x(4), 470, 120, 150, X.rad([[0, lt(main, 0.7), 0.85], [0.6, lt(main, 0.3), 0.35], [1, main, 0]]));
        details += line('M262,352C' + x(-30) + ',420 ' + x(-46) + ',520 ' + x(-50) + ',660M296,352C' + x(40) + ',420 ' + x(56) + ',520 ' + x(60) + ',660', sl, L * 1.7);
        details += line('M' + x(-118) + ',402Q' + x(-86) + ',430 ' + x(-74) + ',470M' + x(128) + ',404Q' + x(96) + ',432 ' + x(84) + ',472', sl, L * 1.2, 'opacity="0.9"');
        details += konohaSwirl(x(6), 560, 30, sl) + circ(x(6), 560, 40, 'none', 'stroke="' + sl + '" stroke-width="' + r1(L * 1.1) + '"');
        if (a.cloakFlames) details += path(flameRow(x(-150), x(160), 656, 92, 8, 31), sl, 'opacity="0.9"'); // Minato's haori-shaped shroud
        collar = path('M226,352L223,300Q278,326 333,298L332,352Q279,374 226,352Z', lt(main, 0.25), 'stroke="' + sl + '" stroke-width="' + r1(L * 1.1) + '"');
        for (var ci = 0; ci < 8; ci++) collar += tomoe(234 + ci * 13, 336 + Math.abs(ci - 3.5) * -1.6 + 4, 3.3, 200, sl);
        out.glow = true;
        break;
      case 'cloak':
        details += line('M' + x(4) + ',360V650', inkOf(main), L, 'opacity="0.7"');
        details += line('M' + x(-90) + ',440Q' + x(-70) + ',540 ' + x(-90) + ',640M' + x(90) + ',440Q' + x(80) + ',540 ' + x(100) + ',640', fold, L * 0.7, 'opacity="0.45"');
        collar = path('M228,352L226,298Q278,322 330,296L330,352Q279,372 228,352Z', main, 'stroke="' + inkOf(main) + '" stroke-width="' + r1(L) + '"') + circ(278, 354, 9, acc, 'stroke="' + inkOf(acc) + '" stroke-width="' + r1(L * 0.7) + '"');
        break;
      default: // shirt
        details += line('M' + x(-60) + ',500Q' + x(-40) + ',560 ' + x(-50) + ',620', fold, L * 0.6, 'opacity="0.4"') + line('M' + x(70) + ',500Q' + x(80) + ',560 ' + x(70) + ',620', fold, L * 0.6, 'opacity="0.4"');
        details += path('M252,336Q278,356 304,334L310,340Q278,368 246,340Z', acc);
    }
    out.torso = t + '<g clip-path="' + clipT + '">' + details + '</g>';
    if (out.pauldrons) { // layered shoulder plates over the arms
      var pc = o === 'samurai' ? acc : main;
      var pl = function (sx) {
        var s2 = '', sgn = sx < 0 ? -1 : 1;
        for (var k = 0; k < 3; k++) {
          var yk = 392 + k * 30;
          s2 += path('M' + x(sx - sgn * 40) + ',' + yk + 'Q' + x(sx + sgn * 16) + ',' + (yk - 18) + ' ' + x(sx + sgn * 52) + ',' + (yk + 14) + 'L' + x(sx + sgn * 56) + ',' + (yk + 44) + 'Q' + x(sx + sgn * 10) + ',' + (yk + 26) + ' ' + x(sx - sgn * 40) + ',' + (yk + 34) + 'Z',
            k % 2 ? dk(pc, 0.1) : pc, 'stroke="' + inkOf(pc) + '" stroke-width="' + r1(L * 1.1) + '"');
        }
        return s2;
      };
      out.torso += pl(-130) + pl(140);
    }
    if (o === 'haori_flame') {
      out.arms += '<g clip-path="' + X.clipPaths([G.armF, G.armN]) + '">' + path(flameRow(0, 560, 650, 60, 12, 3), acc) + '</g>';
    }
    out.collar = collar;
    out.kind = o;
    return out;
  }

  /* ======================================================================
   * 9. headband, hats, masks, marks, accessories
   * ==================================================================== */
  function metalPlate(X, cx, cy, w, h, sym, slash, L, rot) {
    var g = X.lin([[0, '#f4f7fb'], [0.45, '#b9c2cf'], [0.55, '#9aa4b3'], [1, '#d9dfe7']]);
    var s = '<g transform="translate(' + r1(cx) + ',' + r1(cy) + ')' + (rot ? ' rotate(' + rot + ')' : '') + '">';
    s += '<rect x="' + r1(-w / 2) + '" y="' + r1(-h / 2) + '" width="' + r1(w) + '" height="' + r1(h) + '" rx="' + r1(h * 0.18) + '" fill="' + g + '" stroke="#3a4250" stroke-width="' + r1(L) + '"/>';
    s += '<rect x="' + r1(-w / 2 + 3) + '" y="' + r1(-h / 2 + 3) + '" width="' + r1(w - 6) + '" height="' + r1(h * 0.28) + '" rx="' + r1(h * 0.12) + '" fill="#fff" opacity="0.45"/>';
    [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sy) { s += circ(sx * (w / 2 - 6), sy * (h / 2 - 6), 1.8, '#5a6372'); }); });
    s += '<g transform="scale(' + r1(h * 0.36) + ')">' + symbol(sym, '#2a303a', 0.17) + '</g>';
    if (slash) s += line('M' + P(-w * 0.42, h * 0.1) + 'L' + P(w * 0.42, -h * 0.12), '#1a1d24', L * 1.2) + line('M' + P(-w * 0.42, h * 0.1 + 2) + 'L' + P(w * 0.42, -h * 0.12 + 2), '#ffffff', L * 0.4, 'opacity="0.6"');
    return s + '</g>';
  }

  function drawHeadband(X, a, G, pos, L) {
    var hb = a.headband;
    if (!hb || hb === 'none' || !inVocab(hb, ART.headband)) return { head: '', body: '' };
    var cloth = col(a.headbandColor, hb === 'allied' ? '#2b2f3a' : '#1f2b4d');
    if (a.hair === 'bowl') cloth = col(a.headbandColor, '#c8102e'); // Lee / Guy / Duy wear red cloth
    var slash = !!a.headbandSlash, ink = inkOf(cloth), r = { head: '', body: '' };
    var bandD;
    switch (pos) {
      case 'neck':
        bandD = 'M238,312Q278,330 318,310L322,334Q278,356 236,336Z';
        r.body = path(bandD, cloth, 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') + metalPlate(X, 278, 330, 58, 26, hb, slash, L * 0.8);
        break;
      case 'arm':
        var ax = G.C + 156 * G.b;
        r.body = path('M' + r1(ax - 34) + ',452L' + r1(ax + 34) + ',446L' + r1(ax + 36) + ',476L' + r1(ax - 32) + ',484Z', cloth, 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') + metalPlate(X, ax, 464, 40, 22, hb, slash, L * 0.7, -6);
        break;
      case 'belt':
        r.body = '<g clip-path="' + X.clipPaths([G.torsoD]) + '">' + path('M0,600L560,592L560,630L0,638Z', cloth, 'stroke="' + ink + '" stroke-width="' + r1(L * 1.4) + '"') + line('M0,606L560,598', lt(cloth, 0.3), L * 0.7, 'opacity="0.6"') + '</g>' + metalPlate(X, G.C - 4, 615, 66, 28, hb, slash, L * 0.8);
        break;
      case 'hair':
        bandD = 'M206,170Q281,118 356,170L352,188Q281,140 210,190Z';
        r.head = path(bandD, cloth, 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') + metalPlate(X, 281, 150, 64, 26, hb, slash, L * 0.8, 0);
        break;
      case 'bandana':
        r.head = path('M194,206C186,140 222,100 281,98C340,100 378,140 368,206Q281,176 194,206Z', cloth, 'stroke="' + ink + '" stroke-width="' + r1(L * 1.2) + '"') +
          line('M214,150Q250,124 290,122M224,176Q262,160 300,160', lt(cloth, 0.2), L * 0.8, 'opacity="0.6"') +
          path('M360,170Q390,180 404,214Q384,206 368,196Z', cloth, 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') + metalPlate(X, 278, 182, 74, 30, hb, slash, L * 0.8);
        break;
      default: // forehead
        bandD = 'M200,178Q281,150 362,178L362,206Q281,180 201,206Z';
        r.head = path('M352,186Q396,192 420,230L408,236Q388,210 352,204Z', cloth, 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') +
          path('M352,192Q386,206 398,250L386,252Q376,218 350,206Z', dk(cloth, 0.15), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') +
          path(bandD, cloth, 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') + metalPlate(X, 278, 180, 76, 31, hb, slash, L * 0.85);
    }
    return r;
  }

  var KAGE_HATS = { hokage: ['#c8102e', '火'], kazekage: ['#2e8b57', '风'], mizukage: ['#2a6fdb', '水'], raikage: ['#e0b020', '雷'], tsuchikage: ['#8b5a2b', '土'] };
  function drawHat(X, a, Cc, L) {
    var h = a.hat;
    if (!h || h === 'none' || !inVocab(h, ART.hat)) return '';
    var s = '';
    if (own(KAGE_HATS, h)) {
      var kc = KAGE_HATS[h][0];
      var brim = 'M140,178Q281,120 422,178Q281,214 140,178Z', cone = 'M176,170L281,64L386,170Q281,196 176,170Z';
      s += outlineOf([brim, cone], '#2a2a34', L * 2.2);
      s += cel(X, brim, '#f6f4ee', '#c9c4b6', 0, -8) + cel(X, cone, '#fbfaf6', '#d4cfc0', 14, 0);
      s += path('M222,150L281,72L340,150Q281,166 222,150Z', kc) + path('M281,72L340,150Q310,158 281,160Z', dk(kc, 0.2));
      s += '<text x="281" y="150" font-size="58" font-weight="900" text-anchor="middle" fill="#fff" stroke="' + dk(kc, 0.55) + '" stroke-width="5" paint-order="stroke" font-family="' + FONT + '">' + KAGE_HATS[h][1] + '</text>';
      s += line('M150,180Q281,206 412,180', '#d6d0c0', L * 0.8);
      s += path('M206,186Q200,250 214,300L224,298Q214,250 220,190Z', '#eeeae0', 'stroke="#8a8676" stroke-width="' + r1(L * 0.6) + '" opacity="0.9"');
      s += path('M356,186Q362,250 348,300L338,298Q348,250 342,190Z', '#eeeae0', 'stroke="#8a8676" stroke-width="' + r1(L * 0.6) + '" opacity="0.9"');
      return s;
    }
    switch (h) {
      case 'straw':
        var sb = 'M128,190Q281,108 434,190Q281,220 128,190Z', sc = 'M180,176L281,82L382,176Q281,196 180,176Z';
        s += outlineOf([sb, sc], '#3a2a10', L * 2.2) + cel(X, sb, '#d9b25e', '#a8823c', 0, -8) + cel(X, sc, '#e6c06a', '#b08840', 14, 0);
        for (var i = 0; i < 14; i++) { var p = pol(281, 86, 200, 20 + i * 10); s += line('M281,86L' + PP([p[0], Math.min(p[1], 200)]), '#9a7434', L * 0.5, 'opacity="0.6"'); }
        for (var j = 0; j < 7; j++) { var xx = 168 + j * 38; if (xx > 236 && xx < 330) continue; s += path('M' + xx + ',198l12,0l-2,' + (90 + (j % 2) * 30) + 'l-8,0Z', '#f4f1e6', 'stroke="#9a9480" stroke-width="' + r1(L * 0.5) + '"'); }
        s += circ(281, 82, 6, '#c8a040', 'stroke="#5a4010" stroke-width="' + r1(L * 0.6) + '"');
        break;
      case 'samurai_helm':
        var hd = 'M188,232C180,150 220,100 281,98C342,100 382,150 374,232L360,226C356,186 340,170 281,166C222,170 206,186 202,226Z';
        s += outlineOf([hd], '#1a1d24', L * 2) + cel(X, hd, '#5a6272', '#373c48', 10, 6);
        s += path('M176,226L206,212L208,290L172,300Z', '#4a5160', 'stroke="#1a1d24" stroke-width="' + r1(L) + '"') + path('M386,226L356,212L354,290L390,300Z', '#4a5160', 'stroke="#1a1d24" stroke-width="' + r1(L) + '"');
        s += path('M281,150L238,64Q262,120 270,150ZM281,150L324,64Q300,120 292,150Z', '#e8c14a', 'stroke="#6a5010" stroke-width="' + r1(L * 0.8) + '"');
        s += circ(281, 152, 10, '#e8c14a', 'stroke="#6a5010" stroke-width="' + r1(L * 0.8) + '"');
        break;
      case 'horns':
        var hc = col(a.hornColor, '#f1ead8');
        s += path('M226,150C210,120 206,90 216,62C226,96 242,120 250,140Z', hc, 'stroke="' + inkOf(hc) + '" stroke-width="' + r1(L) + '"');
        s += path('M336,150C352,120 356,90 346,62C336,96 320,120 312,140Z', hc, 'stroke="' + inkOf(hc) + '" stroke-width="' + r1(L) + '"');
        break;
      case 'hood_up':
        if (a.hoodEars || a._id === 'kankuro') {
          var ec = Cc.main;
          s += path('M206,140L190,64L250,112Z', ec, 'stroke="' + inkOf(ec) + '" stroke-width="' + r1(L * 1.4) + '"') + path('M356,140L372,64L312,112Z', ec, 'stroke="' + inkOf(ec) + '" stroke-width="' + r1(L * 1.4) + '"');
        }
        var hdd = 'M184,270C168,180 200,92 281,88C362,92 394,180 378,272C372,300 360,320 350,330L356,250C356,212 340,176 281,170C222,176 206,212 206,250L212,330C202,318 190,298 184,270Z';
        var hcol = Cc.main;
        s += outlineOf([hdd], inkOf(hcol), L * 2) + cel(X, hdd, hcol, dk(hcol, 0.3), 12, 8);
        s += line('M212,250C210,200 236,178 281,174C326,178 352,200 350,250', dk(hcol, 0.4), L * 1.2, 'opacity="0.7"');
        break;
      case 'bandana_cap':
        var bc = col(a.capColor, Cc.acc);
        s += path('M196,208C188,140 224,100 281,98C338,100 374,140 366,208Q281,178 196,208Z', bc, 'stroke="' + inkOf(bc) + '" stroke-width="' + r1(L * 1.2) + '"') +
          path('M362,172Q394,176 410,206Q390,204 368,196Z', bc, 'stroke="' + inkOf(bc) + '" stroke-width="' + r1(L) + '"') + line('M214,150Q250,126 290,124', lt(bc, 0.25), L, 'opacity="0.7"');
        break;
    }
    return s;
  }

  function drawMask(X, a, F, Cc, L, eyes) {
    var m = a.mask;
    if (!m || m === 'none' || !inVocab(m, ART.mask)) return '';
    var fd = F.g.d, s = '';
    switch (m) {
      case 'lower':
      case 'cloth':
        var mc = m === 'lower' ? col(a.maskColor, '#26304a') : col(a.maskColor, Cc.acc);
        var md = 'M200,250C203,262 207,272 220,286C234,304 252,317 268,323C288,320 308,309 324,294C340,276 350,256 356,244L360,250L358,360L198,360Z';
        md = 'M201,252L232,248Q262,244 268,256Q276,246 300,246L357,250C352,262 342,278 324,296C306,312 286,322 268,325C250,320 234,306 220,288C210,276 204,264 201,252Z';
        s += '<path d="' + md + '" fill="' + mc + '" stroke="' + inkOf(mc) + '" stroke-width="' + r1(L * 1.3) + '"/>';
        s += path('M268,256Q262,272 256,280Q266,284 276,280Z', dk(mc, 0.25)) + line('M232,300Q258,312 300,296', dk(mc, 0.35), L * 0.6, 'opacity="0.6"');
        s += path('M304,256L357,250C352,262 342,278 324,296C318,302 310,306 304,309Z', dk(mc, 0.18), 'opacity="0.8"');
        break;
      case 'spiral':
        var sd = 'M200,206C198,150 232,118 281,116C330,118 364,150 362,206C360,262 340,312 281,326C222,312 202,262 200,206Z';
        s += outlineOf([sd], '#5a2a00', L * 2) + cel(X, sd, '#ff8a1c', '#d9620a', 8, 8);
        s += '<g transform="translate(250,230) scale(78)"><path d="' + spiralD(3.2, 0.05, 1.02, 0) + '" fill="none" stroke="#a84400" stroke-width="0.045"/></g>';
        s += circ(250, 234, 13, '#14060a') + '<g transform="translate(250,234) scale(10)">' + irisUnit(X, a.eyeL || a.eyes || 'sharingan', a.eyeColor) + '</g>';
        break;
      case 'war_mask':
        var wd = 'M200,206C198,150 232,118 281,116C330,118 364,150 362,206C360,262 340,312 281,326C222,312 202,262 200,206Z';
        s += outlineOf([wd], '#3a3a44', L * 2) + cel(X, wd, '#f2f0ea', '#c4c0b6', 8, 8);
        var rp = ''; [16, 32, 48, 64, 80].forEach(function (r) { rp += '<circle cx="281" cy="230" r="' + r + '" fill="none" stroke="#a8a49a" stroke-width="2"/>'; });
        s += '<g clip-path="' + X.clip('<path d="' + wd + '"/>') + '">' + rp + '</g>';
        [[242, 238, a.eyeL || 'rinnegan'], [318, 238, a.eyeR || 'sharingan']].forEach(function (e) {
          s += circ(e[0], e[1], 13, '#14060a') + '<g transform="translate(' + e[0] + ',' + e[1] + ') scale(10)">' + irisUnit(X, e[2], a.eyeColor) + '</g>';
        });
        s += line('M300,130L290,160L304,186', '#6a665e', L * 0.8);
        break;
      case 'anbu':
        // pushed to the side of the head
        var ad = 'M0,-40C24,-40 34,-16 32,8C30,30 16,44 0,46C-16,44 -30,30 -32,8C-34,-16 -24,-40 0,-40Z';
        s += '<g transform="translate(206,150) rotate(-24)">' + outlineOf([ad], '#3a3a44', L * 2) + path(ad, '#f4f2ec') +
          path('M-20,-6Q-10,-14 -4,-4Q-12,0 -20,-6ZM20,-6Q10,-14 4,-4Q12,0 20,-6Z', '#1a1a1a') +
          line('M-14,-26Q-6,-18 -10,-10M14,-26Q6,-18 10,-10M-6,20Q0,26 6,20', '#c8102e', L * 0.9) +
          path('M-28,-28L-36,-52L-14,-38ZM28,-28L36,-52L14,-38Z', '#f4f2ec', 'stroke="#3a3a44" stroke-width="' + r1(L) + '"') + '</g>';
        break;
      case 'zetsu': // Venus-flytrap lobes closing round the head, bristles along the rims
        var lc = col(a.maskColor, '#4c8a3a'), lin = lt(lc, 0.35);
        var leafL = 'M236,318C150,304 112,196 150,104C166,62 204,30 246,26C218,70 204,140 210,206C214,250 226,284 250,302Z';
        var leafR = 'M326,318C412,304 450,196 412,104C396,62 358,30 316,26C344,70 358,140 352,206C348,250 336,284 312,302Z';
        var inL = 'M246,26C218,70 204,140 210,206C214,250 226,284 250,302C230,292 196,250 190,196C184,130 206,64 246,26Z';
        var inR = 'M316,26C344,70 358,140 352,206C348,250 336,284 312,302C332,292 366,250 372,196C378,130 356,64 316,26Z';
        s += outlineOf([leafL, leafR], inkOf(lc), L * 2) + cel(X, leafL, lc, dk(lc, 0.3), -8, 6) + cel(X, leafR, lc, dk(lc, 0.3), 8, 6);
        s += path(inL, lin, 'opacity="0.9"') + path(inR, lin, 'opacity="0.9"');
        s += line('M160,120Q150,200 196,280M402,120Q412,200 366,280', dk(lc, 0.35), L * 0.8, 'opacity="0.6"');
        var sp = '';
        for (var t = 0; t < 9; t++) {
          var u = t / 8, yy = 34 + u * 250, xl = 246 - Math.sin(u * 3.0) * 38 - u * 4, xr = 316 + Math.sin(u * 3.0) * 38 + u * 4;
          sp += 'M' + P(xl, yy) + 'l' + r1(14 - u * 4) + ',' + r1(-4) + 'l' + r1(-12 + u * 4) + ',' + r1(9) + 'Z';
          sp += 'M' + P(xr, yy) + 'l' + r1(-14 + u * 4) + ',' + r1(-4) + 'l' + r1(12 - u * 4) + ',' + r1(9) + 'Z';
        }
        s += path(sp, '#f4f0dc', 'stroke="' + inkOf(lc) + '" stroke-width="' + r1(L * 0.5) + '" stroke-linejoin="round"');
        break;
      case 'puppet_mouth':
        s += line('M256,296L254,320M290,294L292,316', '#3a2a24', L * 0.9) + line('M238,250Q240,270 252,282M322,250Q320,270 308,282', '#3a2a24', L * 0.5, 'opacity="0.5"');
        break;
    }
    return s;
  }

  /* ======================================================================
   * 10. human composition
   * ==================================================================== */
  var GENERIC = { type: 'human', skin: '#e9c9a8', hair: 'short', hairColor: '#22252e', eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'cloak', outfitColor: '#2b3242', accentColor: '#4b5568', headband: 'none', marks: [], mask: 'cloth', hat: 'hood_up', accessory: 'none' };

  function humanParts(c, a, X, mode) {
    var L = X.lw;
    var fem = isFemale(c, a), young = isYoung(c, a);
    var ft = fem ? 'f' : (young ? 'y' : (buildOf(c, a, fem) > 1.08 ? 'b' : 'm'));
    var g = FACES[ft];
    var skin = col(a.skin, '#f1d0b0');
    var skinSh = mix(skin, '#b0506a', 0.26), skinInk = mix(skin, '#3a1010', 0.82);
    var hairC = col(a.hairColor, '#2a2a2a');
    var main = col(a.outfitColor, '#3a4560'), acc = col(a.accentColor, dk(main, 0.35));
    if (a.outfit === 'akatsuki') { main = col(a.outfitColor, '#1a1622'); acc = col(a.accentColor, '#c8102e'); }
    var Cc = { skin: skin, skinSh: skinSh, skinInk: skinInk, main: main, acc: acc, hair: hairC };
    Cc.beard = col(a.beardColor, (a.hair === 'bald' || a.hair === 'none') ? '#e4e2de' : hairC);
    var marks = Array.isArray(a.marks) ? a.marks : [];
    var eyes = pick(a.eyes, ART.eyes, 'normal');
    var eyeL = pick(a.eyeL, ART.eyes, eyes), eyeR = pick(a.eyeR, ART.eyes, eyes);
    var hairSt = pick(a.hair, ART.hair, 'short');
    var hat = pick(a.hat, ART.hat, 'none');
    var hbPos = pick(a.headbandPos, ART.headbandPos, 'forehead');
    var hasHB = a.headband && a.headband !== 'none' && inVocab(a.headband, ART.headband);
    var acc_ = pick(a.accessory, ART.accessory, 'none');
    var acc2 = pick(a.accessory2, ART.accessory, 'none'); // optional second item (e.g. chakra blades + cigarette)
    if (acc2 === acc_) acc2 = 'none';
    if (isRaise(acc_, a) && isRaise(acc2, a)) acc2 = 'none'; // only one raised hand
    var mood = moodOf(c, a, fem);
    var F = { fem: fem, young: young, g: g, ft: ft, thick: has(marks, 'thick_brows') || (hairSt === 'bowl' && a.thickBrows !== false), edo: has(marks, 'edo_cracks'),
      fierce: !fem && (DOJ[eyes] && eyes !== 'byakugan' || mood === 'smirk') && !young, calm: mood === 'smile' || mood === 'soft' };
    var G = bodyGeom(buildOf(c, a, fem), fem ? 0.78 : (young ? 0.88 : 1));
    var H = hairDef(hairSt, F, hasHB ? hbPos : 'none', hat);
    var faction = c.faction || '';
    var ctxc = { konoha: a.headband === 'konoha' || faction === 'konoha', kumo: a.flakStyle ? a.flakStyle === 'kumo' : (a.headband === 'kumo' || faction === 'kumo') };

    var P_ = { back: '', body: '', head: '', front: '', sil: [] };

    // ---- back hair + back accessory
    var back = '';
    back += accessoryBack(X, acc_, G, Cc, L, c);
    if (acc2 !== 'none') back += accessoryBack(X, acc2, G, Cc, L, c);
    back += inHead(paintHair(X, H.back, hairC, true));
    P_.back = back;

    // ---- body
    var body = '';
    var OF = drawOutfit(X, a, G, Cc, ctxc);
    Cc.armSkin = OF.armSkin; Cc.armCol = OF.armCol;
    if (a.sixArms || c.id === 'kidomaru') {
      var ex = G.x, extra = [];
      [[-1, 0], [1, 0], [-1, 1], [1, 1]].forEach(function (q) {
        var sg = q[0], k = q[1], y0 = 450 + k * 70, x0 = ex(sg * 96), x1 = ex(sg * 360), y1 = k ? 600 : 300;
        extra.push(forearm(x0, y0, x1, y1, 54, 44));
      });
      body += outlineOf(extra, inkOf(OF.armCol), L * 2);
      extra.forEach(function (d) { body += cel(X, d, OF.armCol, dk(OF.armCol, 0.3), 0, 8); });
    }
    body += OF.arms;
    // neck
    body += outlineOf([NECK], skinInk, L * 2) + cel(X, NECK, skin, skinSh, -10, 0);
    body += '<g clip-path="' + X.clip('<path d="' + NECK + '"/>') + '">' + path(g.d, skinSh, 'transform="' + HT + ' translate(4,16)"') + '</g>';
    if (OF.chest) {
      var chest = 'M232,330L324,330L340,650L216,650Z';
      body += cel(X, chest, skin, skinSh, -12, 0) + line('M238,372Q256,380 270,376M290,376Q306,382 322,372', skinInk, L * 0.6, 'opacity="0.5"');
      if (OF.kind === 'robe' || OF.kind === 'bandage' || OF.kind === 'mesh') body += line('M276,420Q270,470 276,520M246,470Q262,480 274,470M282,470Q296,480 310,470', skinInk, L * 0.55, 'opacity="0.35"');
    }
    if (OF.neckCover) body += path('M250,300L306,300L308,352Q278,364 248,352Z', OF.neckCover);
    body += OF.torso;
    if (OF.armsOver) body += '';
    var pose = a.pose || (isRaise(acc_, a) || isRaise(acc2, a) || OF.kind === 'cloak' || acc_ === 'bow' ? 'stand' : (c.role === 'tank' || c.role === 'ctrl') ? 'cross' : (c.role === 'sup' || c.role === 'heal') ? 'seal' : 'stand');
    if (mode === 'bust') body += volume(X, [G.armF, G.armN, OF.torsoD, NECK], auraColor(c, a));
    if (pose === 'cross') body += crossedArms(X, G, Cc, L, OF.armCol, OF.armSkin);
    else if (pose === 'seal') body += handSeal(X, G, Cc, L, OF.armCol, OF.armSkin, auraColor(c, a));
    body += OF.collar;
    G.torsoD = OF.torsoD;
    var hbParts = hasHB ? drawHeadband(X, a, G, hbPos, L) : { head: '', body: '' };
    body += hbParts.body;
    if (has(marks, 'curse_mark')) body += '<g transform="translate(298,318)">' + ringTomoe(3, 8.5, 3.2, -90, '#140608') + '</g>' + line('M290,330q-10,8 -16,20M306,330q8,10 18,14', '#140608', L * 0.6, 'opacity="0.7"');
    if (F.edo) body += line('M262,300l6,14l-4,10l8,12M300,306l-4,12l6,8', mix(skin, '#2a1a1a', 0.6), L * 0.6, 'opacity="0.6"'); // cracks run down the neck
    body += accessoryMid(X, acc_, G, Cc, L, c);
    if (acc2 !== 'none') body += accessoryMid(X, acc2, G, Cc, L, c);
    if (acc_ === 'scarf' || acc2 === 'scarf') body += scarf(X, a, G, Cc, L);
    var mid = paintHair(X, H.mid, hairC);
    H.ties.forEach(function (t) { mid += '<g transform="translate(' + t[0] + ',' + t[1] + ') rotate(' + t[4] + ')"><rect x="' + (-t[2] / 2) + '" y="' + (-t[3] / 2) + '" width="' + t[2] + '" height="' + t[3] + '" rx="3" fill="' + col(a.tieColor, '#3a3f55') + '" stroke="#111" stroke-width="' + r1(L * 0.7) + '"/></g>'; });
    body += inHead(mid);
    P_.body = body;

    // ---- head
    var head = '';
    // near ear
    var ear = 'M352,226C366,214 380,222 376,240C374,256 366,268 352,266Z';
    head += outlineOf([ear], skinInk, L * 2) + cel(X, ear, skin, skinSh, 3, 3) + line('M358,232Q368,232 366,246Q364,254 358,256', skinInk, L * 0.6, 'opacity="0.6"');
    if (has(marks, 'piercings')) head += circ(366, 230, 2.6, '#c9ced6', 'stroke="#333" stroke-width="0.8"') + circ(370, 240, 2.6, '#c9ced6', 'stroke="#333" stroke-width="0.8"') + circ(368, 252, 2.6, '#c9ced6', 'stroke="#333" stroke-width="0.8"');
    // face
    head += outlineOf([g.d], skinInk, L * 2.1);
    var faceClip = X.clip('<path d="' + g.d + '"/>');
    head += path(g.d, skin);
    var fs = '';
    fs += path(g.sh, skinSh, 'opacity="0.9"');
    if (a.mask === 'zetsu' && a.zetsuHalf !== false) { // Zetsu: black half (his right = viewer's left) split down a ragged centre line
      var zb = col(a.halfColor, '#17171d');
      fs += path('M120,90L276,90Q268,150 274,196Q266,226 272,252Q266,284 274,312L272,360L120,360Z', zb) + line('M276,90Q268,150 274,196Q266,226 272,252Q266,284 274,312L272,360', '#000', L * 0.8, 'opacity="0.5"');
    }
    // hair cast shadow on forehead
    var castList = H.top.concat(H.front);
    if (H.hood || hat === 'hood_up') castList = castList.concat(['M184,270C168,180 200,92 281,88C362,92 394,180 378,272L356,250C356,212 340,176 281,170C222,176 206,212 206,250Z']);
    if (castList.length) fs += '<g transform="translate(5,10)" fill="' + skinSh + '">' + castList.map(function (d) { return '<path d="' + d + '"/>'; }).join('') + '</g>';
    if (hasHB && (hbPos === 'forehead' || hbPos === 'bandana')) fs += path('M200,196Q281,170 362,196L362,216Q281,190 201,216Z', skinSh, 'opacity="0.8"');
    if (F.fem) fs += ell(g.eL[0] - 4, g.eL[1] + 26, 15, 7, '#ff7a8a', 'opacity="0.28"') + ell(g.eR[0] + 2, g.eR[1] + 26, 17, 8, '#ff7a8a', 'opacity="0.28"');
    if (hairSt === 'bald' || hairSt === 'none' || hairSt === 'buzz') fs += path('M222,150C236,124 262,116 284,118C262,126 244,140 234,164Z', lt(skin, 0.5), 'opacity="0.7"');
    head += '<g clip-path="' + faceClip + '">' + fs + '</g>';

    // under-eye marks & face marks (below eyes)
    head += marksUnder(X, marks, g, F, Cc, L, c, a);
    // eyes
    var eLk = eyeL, eRk = eyeR;
    var coverL = hairSt === 'long_bang';
    if (eyes === 'sage' || eLk === 'sage' || has(marks, 'sage_marks')) {
      head += path('M' + P(g.eL[0] - 26, g.eL[1] + 2) + 'Q' + P(g.eL[0] - 4, g.eL[1] - 30) + ' ' + P(g.eL[0] + 22, g.eL[1] - 6) + 'Q' + P(g.eL[0], g.eL[1] - 8) + ' ' + P(g.eL[0] - 26, g.eL[1] + 2) + 'Z', '#e8541c', 'opacity="0.85"');
      head += path('M' + P(g.eR[0] + 28, g.eR[1] + 2) + 'Q' + P(g.eR[0] + 4, g.eR[1] - 32) + ' ' + P(g.eR[0] - 24, g.eR[1] - 6) + 'Q' + P(g.eR[0], g.eR[1] - 8) + ' ' + P(g.eR[0] + 28, g.eR[1] + 2) + 'Z', '#e8541c', 'opacity="0.85"');
    }
    if (has(marks, 'purple_eyeliner')) {
      head += path('M' + P(g.eL[0] - 24, g.eL[1] + 4) + 'Q' + P(g.eL[0], g.eL[1] - 26) + ' ' + P(g.eL[0] + 22, g.eL[1] - 4) + 'Q' + P(g.eL[0], g.eL[1] + 2) + ' ' + P(g.eL[0] - 24, g.eL[1] + 4) + 'Z', '#7b3fa0', 'opacity="0.8"');
      head += path('M' + P(g.eR[0] + 26, g.eR[1] + 4) + 'Q' + P(g.eR[0], g.eR[1] - 28) + ' ' + P(g.eR[0] - 24, g.eR[1] - 4) + 'Q' + P(g.eR[0], g.eR[1] + 2) + ' ' + P(g.eR[0] + 26, g.eR[1] + 4) + 'Z', '#7b3fa0', 'opacity="0.8"');
    }
    var browC = hairSt === 'bald' || hairSt === 'none' ? dk(skin, 0.5) : dk(hairC, lum(hairC) > 0.7 ? 0.35 : 0.2);
    if (!has(marks, 'eye_bandage') || true) {
      head += drawEye(X, g.eL[0], g.eL[1], g.eL[2], g.eL[3], -1, eLk, a.eyeColor, F);
    }
    head += drawEye(X, g.eR[0], g.eR[1], g.eR[2], g.eR[3], 1, eRk, a.eyeColor, F);
    if (eLk === 'byakugan' || eRk === 'byakugan') head += byakuganVeins(g, skinInk, L, eLk === 'byakugan', eRk === 'byakugan');
    // Gaara: insomniac dark rings, no eyebrows. Data mark 'eye_rings' (legacy: implied by ai_tattoo unless eyeRings === false)
    var gaaraRings = has(marks, 'eye_rings') || a.eyeRings === true || (has(marks, 'ai_tattoo') && a.eyeRings !== false);
    var browsLate = '';
    if (gaaraRings) {
      [[g.eL, -1], [g.eR, 1]].forEach(function (e) {
        var E_ = e[0], sg = e[1];
        head += path('M' + P(E_[0] - sg * E_[2] * 0.62, E_[1] + E_[3] * 0.3) + 'Q' + P(E_[0] - sg * E_[2] * 0.2, E_[1] - E_[3] * 1.35) + ' ' + P(E_[0] + sg * E_[2] * 0.72, E_[1] - E_[3] * 0.25) +
          'Q' + P(E_[0] + sg * E_[2] * 0.3, E_[1] + E_[3] * 1.1) + ' ' + P(E_[0] - sg * E_[2] * 0.62, E_[1] + E_[3] * 0.3) + 'Z', '#2a1418', 'opacity="0.9"');
      });
      head += drawEye(X, g.eL[0], g.eL[1], g.eL[2], g.eL[3], -1, eLk, a.eyeColor, F) + drawEye(X, g.eR[0], g.eR[1], g.eR[2], g.eR[3], 1, eRk, a.eyeColor, F);
    } else if (F.thick) browsLate = drawBrow(X, g.eL[0], g.eL[1], g.eL[2], g.eL[3], -1, browC, F) + drawBrow(X, g.eR[0], g.eR[1], g.eR[2], g.eR[3], 1, browC, F);
    else head += drawBrow(X, g.eL[0], g.eL[1], g.eL[2], g.eL[3], -1, browC, F) + drawBrow(X, g.eR[0], g.eR[1], g.eR[2], g.eR[3], 1, browC, F);
    if (F.fierce && !has(marks, 'eye_bandage')) head += line('M272,' + (g.eL[1] - 20) + 'q2,6 0,10M281,' + (g.eL[1] - 21) + 'q-1,6 1,10', skinInk, L * 0.45, 'opacity="0.45"');
    // nose
    var nx = g.nose[0], ny = g.nose[1];
    head += line('M' + P(nx + 2, ny - 22) + 'Q' + P(nx - 4, ny - 8) + ' ' + P(nx - 6, ny), skinInk, L * 0.55, 'opacity="0.55"') +
      path('M' + P(nx - 8, ny + 1) + 'Q' + P(nx - 1, ny + 5) + ' ' + P(nx + 5, ny - 1) + 'Q' + P(nx, ny + 1) + ' ' + P(nx - 8, ny + 1) + 'Z', skinInk, 'opacity="0.75"');
    // mouth
    head += drawMouth(g, mood, F, Cc, L, marks, c);
    head += marksOver(X, marks, g, F, Cc, L, c, a, eLk, eRk);
    var mouthFree = !inVocab(a.mask, ['lower', 'cloth', 'spiral', 'war_mask']) && !(has(marks, 'bandage_face') && (a.bandageFull || c.id === 'zabuza' || c.id === 'mu'));
    if (mouthFree) head += mouthItem(X, acc_, a, g, L) + (acc2 !== 'none' ? mouthItem(X, acc2, a, g, L) : '');
    head += drawMask(X, a, F, Cc, L);
    head += glasses(X, marks, g, L);

    // hair top + front
    if (H.hood && hat !== 'hood_up') head += drawHat(X, merge(a, { hat: 'hood_up', _id: c.id }), Cc, L);
    var topList = H.top.concat(H.front);
    if (topList.length) {
      head += outlineOf(topList, inkOf(hairC), L * 2);
      for (var i = 0; i < H.top.length; i++) head += cel(X, H.top[i], hairC, dk(hairC, 0.3), 5, 8);
      for (var j = 0; j < H.front.length; j++) head += cel(X, H.front[j], hairC, dk(hairC, 0.28), 4, 6);
      head += hairShine(X, H, hairC);
      if (H.lines.length) head += line(H.lines.join(''), inkOf(hairC), L * 0.6, 'opacity="0.6"');
      if (coverL) { /* bang covers far eye */ }
    }
    head += browsLate;
    if (H.flower) head += paperFlower(H.flower[0], H.flower[1], col(a.flowerColor, '#f2eefc'), L);
    if (acc_ === 'goggles' || acc2 === 'goggles') head += goggles(X, a, g, L);
    head += hbParts.head;
    head += drawHat(X, a._id ? a : merge(a, { _id: c.id }), Cc, L);
    if (has(marks, 'third_eye')) head += thirdEye(X, a, L);
    head += foreheadMarks(marks, L, hasHB && (hbPos === 'forehead' || hbPos === 'bandana'), hat !== 'none' && hat !== 'horns');
    if (acc_ === 'kiseru') head += kiseru(L);
    P_.head = inHead(head);
    if (a.twinHead || c.id === 'sakon') {
      P_.body += '<g transform="translate(262,200) scale(0.6) rotate(12 281 214)"><g transform="' + HT + '">' + paintHair(X, H.back, hairC, true) + head + '</g></g>';
    }

    // ---- front accessory
    P_.front = accessoryFront(X, acc_, G, Cc, L, c, a) + (acc2 !== 'none' ? accessoryFront(X, acc2, G, Cc, L, c, a) : '');
    P_.G = G; P_.H = H; P_.OF = OF; P_.Cc = Cc;
    P_.sil = [G.armF, G.armN, OF.torsoD, NECK];
    P_.silHead = [g.d].concat(H.back, H.top, H.front, H.mid);
    P_.silHeadV = H.top.slice();
    var hc = headPt(282, 214), half = 128;
    P_.avatarVB = r1(hc[0] - half) + ' ' + r1(hc[1] - half + 6) + ' ' + (half * 2) + ' ' + (half * 2);
    return P_;
  }

  function drawMouth(g, mood, F, Cc, L, marks, c) {
    var mx = g.mouth[0], my = g.mouth[1], w = g.mouth[2], ink = Cc.skinInk, s = '';
    var fang = has(marks, 'fangs') && !INUZUKA[c.id] && !(c.art && c.art.accessory === 'dog');
    var sharp = has(marks, 'sharp_teeth') || c.id === 'kisame' || c.id === 'suigetsu';
    function saw(x0, x1, yA, yB, n) { // row of triangular teeth from baseline yA pointing to yB
      var d = 'M' + P(x0, yA), wd = (x1 - x0) / n;
      for (var k = 0; k < n; k++) d += 'L' + P(x0 + wd * (k + 0.5), yB) + 'L' + P(x0 + wd * (k + 1), yA);
      return d + 'Z';
    }
    if (sharp && mood !== 'grin') { // shark grin (Kisame, Suigetsu, Hōzuki clan, Kiri swordsmen)
      var td = 'M' + P(mx - w * 0.62, my - 3) + 'Q' + P(mx, my + 1) + ' ' + P(mx + w * 0.72, my - 6) + 'Q' + P(mx + w * 0.42, my + 10) + ' ' + P(mx, my + 10) + 'Q' + P(mx - w * 0.42, my + 9) + ' ' + P(mx - w * 0.62, my - 3) + 'Z';
      s += path(td, '#5a1420', 'stroke="' + ink + '" stroke-width="' + r1(L * 0.8) + '" stroke-linejoin="round"');
      s += path(saw(mx - w * 0.56, mx + w * 0.64, my - 3.5, my + 4, 6), '#fbfaf6', 'stroke="' + ink + '" stroke-width="0.7"') + path(saw(mx - w * 0.38, mx + w * 0.42, my + 9, my + 3, 5), '#ecebe6', 'stroke="' + ink + '" stroke-width="0.7"');
      if (has(marks, 'red_lips')) s += line(td.replace(/Z$/, ''), '#c8102e', L * 0.5, 'opacity="0.7"');
      return s;
    }
    switch (mood) {
      case 'grin':
        var gd = 'M' + P(mx - w * 0.75, my - 5) + 'Q' + P(mx, my + 2) + ' ' + P(mx + w * 0.8, my - 7) + 'Q' + P(mx + w * 0.5, my + 15) + ' ' + P(mx, my + 16) + 'Q' + P(mx - w * 0.5, my + 14) + ' ' + P(mx - w * 0.75, my - 5) + 'Z';
        s += path(gd, '#7a1e2a', 'stroke="' + ink + '" stroke-width="' + r1(L * 0.9) + '" stroke-linejoin="round"');
        if (sharp) {
          s += path(saw(mx - w * 0.68, mx + w * 0.74, my - 4, my + 5, 7), '#fbfaf6', 'stroke="' + ink + '" stroke-width="0.7"') + path(saw(mx - w * 0.46, mx + w * 0.5, my + 14, my + 7, 6), '#ecebe6', 'stroke="' + ink + '" stroke-width="0.7"');
          break;
        }
        s += path('M' + P(mx - w * 0.68, my - 3) + 'Q' + P(mx, my + 3) + ' ' + P(mx + w * 0.72, my - 5) + 'L' + P(mx + w * 0.62, my + 2) + 'Q' + P(mx, my + 8) + ' ' + P(mx - w * 0.6, my + 3) + 'Z', '#fff');
        if (fang) for (var i = -2; i <= 2; i++) s += path('M' + P(mx + i * 7 - 3, my + 2) + 'l3,7l3,-7Z', '#fff');
        s += ell(mx + 2, my + 11, 7, 3, '#e86a7a', 'opacity="0.8"');
        break;
      case 'smirk':
        s += line('M' + P(mx - w * 0.5, my + 1) + 'Q' + P(mx + w * 0.1, my + 4) + ' ' + P(mx + w * 0.62, my - 5), ink, L * 0.85);
        s += line('M' + P(mx + w * 0.55, my - 6) + 'l4,-2', ink, L * 0.6);
        break;
      case 'smile':
        s += line('M' + P(mx - w * 0.55, my - 2) + 'Q' + P(mx, my + 7) + ' ' + P(mx + w * 0.6, my - 3), ink, L * 0.85);
        break;
      case 'soft':
        s += line('M' + P(mx - w * 0.45, my) + 'Q' + P(mx, my + 4) + ' ' + P(mx + w * 0.5, my - 1), ink, L * 0.8);
        break;
      default:
        s += line('M' + P(mx - w * 0.5, my) + 'Q' + P(mx, my - 1) + ' ' + P(mx + w * 0.55, my + 1), ink, L * 0.85);
        s += line('M' + P(mx - 6, my + 9) + 'Q' + P(mx, my + 10) + ' ' + P(mx + 7, my + 9), ink, L * 0.5, 'opacity="0.4"');
    }
    if (has(marks, 'red_lips')) s += path('M' + P(mx - w * 0.5, my) + 'Q' + P(mx - 4, my - 5) + ' ' + P(mx, my - 2) + 'Q' + P(mx + 4, my - 5) + ' ' + P(mx + w * 0.55, my) + 'Q' + P(mx, my + 9) + ' ' + P(mx - w * 0.5, my) + 'Z', '#c8102e', 'opacity="0.85"');
    if (fang && mood !== 'grin') s += path('M' + P(mx + w * 0.2, my) + 'l3,7l3,-7Z', '#fff', 'stroke="' + ink + '" stroke-width="0.8"');
    return s;
  }

  function byakuganVeins(g, ink, L, l, r) {
    var s = '', c = mix(ink, '#b07a90', 0.5);
    if (l) s += line('M' + P(g.eL[0] - 20, g.eL[1] - 8) + 'q-6,-4 -8,-12M' + P(g.eL[0] - 21, g.eL[1] - 4) + 'q-8,0 -11,-5M' + P(g.eL[0] + 16, g.eL[1] - 13) + 'q4,-5 3,-11', c, L * 0.5, 'opacity="0.75"');
    if (r) s += line('M' + P(g.eR[0] + 22, g.eR[1] - 8) + 'q6,-4 8,-12M' + P(g.eR[0] + 23, g.eR[1] - 4) + 'q8,0 11,-5M' + P(g.eR[0] - 18, g.eR[1] - 13) + 'q-4,-5 -3,-11', c, L * 0.5, 'opacity="0.75"');
    return s;
  }
  function marksUnder(X, marks, g, F, Cc, L, c, a) {
    var s = '', ink = Cc.skinInk;
    marks.forEach(function (m) {
      switch (m) {
        case 'whiskers':
          for (var i = 0; i < 3; i++) {
            s += line('M' + P(214, 262 + i * 9) + 'L' + P(238, 266 + i * 7), ink, L * 0.75, 'opacity="0.85"');
            s += line('M' + P(320, 268 + i * 7) + 'L' + P(348, 262 + i * 9), ink, L * 0.75, 'opacity="0.85"');
          }
          break;
        case 'kurama_marks':
          for (var k = 0; k < 3; k++) {
            s += path('M' + P(212, 258 + k * 10) + 'L' + P(242, 266 + k * 7) + 'L' + P(212, 264 + k * 10) + 'Z', '#2a0e06');
            s += path('M' + P(350, 258 + k * 10) + 'L' + P(318, 266 + k * 7) + 'L' + P(350, 264 + k * 10) + 'Z', '#2a0e06');
          }
          s += path('M' + P(g.eL[0] - 22, g.eL[1] + 6) + 'Q' + P(g.eL[0], g.eL[1] - 26) + ' ' + P(g.eL[0] + 22, g.eL[1] - 6) + 'Q' + P(g.eL[0], g.eL[1] - 4) + ' ' + P(g.eL[0] - 22, g.eL[1] + 6) + 'Z', '#3a1206', 'opacity="0.6"');
          s += path('M' + P(g.eR[0] + 24, g.eR[1] + 6) + 'Q' + P(g.eR[0], g.eR[1] - 28) + ' ' + P(g.eR[0] - 24, g.eR[1] - 6) + 'Q' + P(g.eR[0], g.eR[1] - 4) + ' ' + P(g.eR[0] + 24, g.eR[1] + 6) + 'Z', '#3a1206', 'opacity="0.6"');
          break;
        case 'fangs':
          if (INUZUKA[c.id] || a.accessory === 'dog') {
            s += path('M220,256L240,258L226,284Z', '#c8102e') + path('M342,256L322,258L336,284Z', '#c8102e');
          }
          break;
        case 'tear_lines':
          s += line('M' + P(g.eL[0] - 10, g.eL[1] + 12) + 'Q' + P(g.eL[0] - 8, g.eL[1] + 24) + ' ' + P(g.eL[0] - 4, g.eL[1] + 34), ink, L * 0.7, 'opacity="0.7"');
          s += line('M' + P(g.eR[0] - 8, g.eR[1] + 13) + 'Q' + P(g.eR[0] - 6, g.eR[1] + 25) + ' ' + P(g.eR[0] - 2, g.eR[1] + 35), ink, L * 0.7, 'opacity="0.7"');
          break;
        case 'face_paint':
          var pc = col(a.paintColor, '#7b2fa0');
          if (F.fem) { // Rin-style cheek rectangles
            s += path('M' + P(g.eL[0] - 12, g.eL[1] + 18) + 'l14,-2l2,20l-14,2Z', pc) + path('M' + P(g.eR[0] - 2, g.eR[1] + 16) + 'l16,2l-2,20l-16,-2Z', pc);
            break;
          }
          s += path('M' + P(g.eL[0] - 4, g.eL[1] + 10) + 'L' + P(g.eL[0] + 2, g.eL[1] + 10) + 'L' + P(g.eL[0] + 2, 300) + 'L' + P(g.eL[0] - 4, 296) + 'Z', pc);
          s += path('M' + P(g.eR[0] - 2, g.eR[1] + 10) + 'L' + P(g.eR[0] + 4, g.eR[1] + 10) + 'L' + P(g.eR[0] + 4, 290) + 'L' + P(g.eR[0] - 2, 294) + 'Z', pc);
          s += path('M240,196L320,196L314,206L246,206Z', pc) + path('M262,206L270,206L268,256L262,256Z', pc) + path('M248,306Q270,316 296,304L294,312Q270,322 250,312Z', pc);
          break;
        case 'nose_scar':
          s += line('M226,256Q262,248 306,254', mix(Cc.skin, '#7a3030', 0.5), L * 1.3, 'opacity="0.85"');
          break;
        case 'eye_scar':
          var sx = (a.eyeL && a.eyeL !== a.eyes && a.eyeL !== 'normal') ? g.eL[0] : g.eR[0];
          s += line('M' + P(sx + 4, g.eR[1] - 30) + 'L' + P(sx + 1, g.eR[1] + 26), mix(Cc.skin, '#7a3030', 0.55), L * 1.1);
          break;
        case 'chin_x':
          s += line('M262,304L282,318M282,304L262,318', mix(Cc.skin, '#7a3030', 0.5), L);
          break;
        case 'cheek_scar':
          s += line('M222,262L240,284M226,258L246,280', mix(Cc.skin, '#7a3030', 0.5), L * 0.8);
          break;
        case 'stitches':
          s += line('M252,296Q232,290 218,276M292,296Q316,290 334,272', '#3a2020', L * 0.8);
          for (var t = 0; t < 4; t++) s += line('M' + P(250 - t * 9, 291 - t * 4) + 'l-1,8M' + P(296 + t * 10, 291 - t * 5) + 'l1,8', '#3a2020', L * 0.6);
          break;
        case 'gills':
          for (var gi = 0; gi < 3; gi++) {
            s += line('M' + P(224 + gi * 7, 264) + 'q-4,10 0,18', dk(Cc.skin, 0.5), L * 0.7);
            s += line('M' + P(326 + gi * 7, 264) + 'q4,10 0,18', dk(Cc.skin, 0.5), L * 0.7);
          }
          break;
        case 'blue_skin_marks':
          s += line('M' + P(g.eL[0] - 10, g.eL[1] + 14) + 'q8,6 16,0M' + P(g.eR[0] - 8, g.eR[1] + 15) + 'q8,6 16,0', dk(Cc.skin, 0.45), L * 0.7);
          break;
        case 'swirl_cheeks':
          s += '<g transform="translate(226,276) scale(11)"><path d="' + spiralD(1.4, 0.05, 1, 0) + '" fill="none" stroke="#c8102e" stroke-width="0.22" stroke-linecap="round"/></g>';
          s += '<g transform="translate(336,276) scale(12)"><path d="' + spiralD(1.4, 0.05, 1, 180) + '" fill="none" stroke="#c8102e" stroke-width="0.22" stroke-linecap="round"/></g>';
          break;
        case 'b_tattoo':
          s += path('M330,262Q348,250 352,236Q344,262 334,272Z', '#1a1010') + path('M336,276Q350,270 356,256Q350,278 340,284Z', '#1a1010');
          break;
        case 'face_lines':
          var lc = c.id === 'tobirama' ? '#c8102e' : (a.eyes === 'blank' ? '#5a1010' : '#c8102e');
          s += path('M' + P(g.eL[0] - 4, g.eL[1] + 12) + 'l6,0l-1,30l-4,0Z', lc) + path('M' + P(g.eR[0] - 2, g.eR[1] + 12) + 'l6,0l-1,30l-4,0Z', lc) + path('M268,306l6,0l-1,12l-4,0Z', lc);
          break;
        case 'wrinkles':
          s += line('M' + P(g.eL[0] - 22, g.eL[1] + 6) + 'l-8,4M' + P(g.eR[0] + 24, g.eR[1] + 6) + 'l8,4M240,282Q244,294 252,300M310,282Q306,294 296,300', ink, L * 0.55, 'opacity="0.55"');
          s += line('M246,184Q281,176 316,184M252,194Q281,188 310,194', ink, L * 0.5, 'opacity="0.45"');
          break;
        case 'beard':
          var bcol = Cc.beard;
          s += path('M206,236C208,270 222,296 244,312C252,300 262,296 271,298C282,296 292,300 300,312C324,296 344,270 352,236C356,276 346,306 326,326L318,322L312,334L302,330L294,342L284,336L272,346L262,336L250,342L244,330L232,334L228,322C212,304 204,272 206,236Z', bcol, 'stroke="' + inkOf(bcol) + '" stroke-width="' + r1(L * 0.9) + '"');
          s += path('M250,290Q271,280 292,290Q284,296 271,294Q258,296 250,290Z', bcol);
          break;
        case 'goatee':
          s += path('M250,308Q270,318 292,308L288,326Q282,338 270,340Q258,338 254,326Z', Cc.beard, 'stroke="' + inkOf(Cc.beard) + '" stroke-width="' + r1(L * 0.8) + '"');
          break;
        case 'mustache':
          s += path('M240,290Q256,276 271,284Q286,276 304,290Q290,296 271,291Q252,296 240,290Z', Cc.beard, 'stroke="' + inkOf(Cc.beard) + '" stroke-width="' + r1(L * 0.7) + '"');
          break;
        case 'edo_cracks': // 秽土转生: papery skin split by dark cracks radiating from the eyes
          var L_ = g.eL, R_ = g.eR, cr = mix(Cc.skin, '#24141a', 0.62), cd = '';
          cd += 'M' + P(L_[0] - 12, L_[1] + 14) + 'l-5,11l6,8l-7,13l3,9M' + P(L_[0] - 16, L_[1] + 25) + 'l-12,3M' + P(L_[0] - 11, L_[1] + 46) + 'l-9,7';
          cd += 'M' + P(L_[0] + 12, L_[1] + 15) + 'l3,10l-4,7';
          cd += 'M' + P(R_[0] + 10, R_[1] + 15) + 'l6,10l-5,9l8,12l-2,10M' + P(R_[0] + 16, R_[1] + 25) + 'l13,-2M' + P(R_[0] + 17, R_[1] + 46) + 'l10,5';
          cd += 'M' + P(R_[0] - 14, R_[1] + 16) + 'l-3,9l5,6';
          cd += 'M' + P(g.mouth[0] + 22, g.chin - 20) + 'l8,-6l4,-10';
          s += '<g clip-path="' + X.clip('<path d="' + g.d + '"/>') + '">' + line(cd, '#ffffff', L * 0.75, 'opacity="0.35" transform="translate(1.2,1.4)"') + line(cd, cr, L * 0.72, 'opacity="0.9"') + '</g>';
          break;
        case 'cheek_rects': // Rin: one purple rectangle on each cheek
          var rc = col(a.paintColor, '#7b2fa0');
          s += path('M' + P(g.eL[0] - 9, g.eL[1] + 17) + 'l13,-1l1,20l-13,1Z', rc) + path('M' + P(g.eR[0] - 1, g.eR[1] + 16) + 'l15,1l-1,21l-15,-1Z', rc);
          break;
        case 'burn_scar': // Raidō: scarred patch over the nose bridge spreading across the near cheek
          var bsc = mix(Cc.skin, '#a83a3a', 0.3), bsk = mix(Cc.skin, '#5a1a1a', 0.55), nx_ = g.nose[0], ny_ = g.nose[1], ex_ = g.eR[0], ey_ = g.eR[1];
          var bd = 'M' + P(nx_ - 12, ny_ - 30) + 'L' + P(nx_ + 4, ny_ - 24) + 'L' + P(ex_ - 18, ey_ + 14) + 'L' + P(ex_ - 2, ey_ + 18) + 'L' + P(ex_ + 14, ey_ + 14) + 'L' + P(ex_ + 30, ey_ + 20) + 'L' + P(ex_ + 44, ey_ + 16) +
            'L' + P(ex_ + 46, ey_ + 40) + 'L' + P(ex_ + 34, ey_ + 52) + 'L' + P(ex_ + 20, ey_ + 48) + 'L' + P(ex_ + 8, ey_ + 60) + 'L' + P(ex_ - 8, ey_ + 50) + 'L' + P(nx_ + 10, ny_ - 2) + 'L' + P(nx_ - 2, ny_ - 12) + 'L' + P(nx_ - 16, ny_ - 18) + 'Z';
          var bcl = X.clip('<path d="' + g.d + '"/>');
          s += '<g clip-path="' + bcl + '">' + path(bd, bsc, 'stroke="' + bsk + '" stroke-width="' + r1(L * 0.7) + '" stroke-linejoin="round"') +
            line('M' + P(nx_ - 6, ny_ - 24) + 'l14,6M' + P(ex_ - 10, ey_ + 24) + 'l18,4l12,-3M' + P(ex_ + 2, ey_ + 36) + 'l16,2l14,-6M' + P(ex_ + 8, ey_ + 48) + 'l12,-4', bsk, L * 0.55, 'opacity="0.75"') +
            line('M' + P(ex_ - 4, ey_ + 28) + 'l14,2M' + P(ex_ + 14, ey_ + 42) + 'l12,-2', lt(bsc, 0.35), L * 0.5, 'opacity="0.7"') +
            circ(ex_ + 26, ey_ + 30, 4, bsk, 'opacity="0.5"') + circ(ex_ - 8, ey_ + 38, 3, bsk, 'opacity="0.45"') + circ(nx_ + 2, ny_ - 18, 2.6, bsk, 'opacity="0.5"') + '</g>';
          break;
      }
    });
    return s;
  }

  function marksOver(X, marks, g, F, Cc, L, c, a, eLk, eRk) {
    var s = '';
    marks.forEach(function (m) {
      switch (m) {
        case 'piercings':
          if (c.faction === 'akatsuki' || c.faction === 'ame' || /pain|nagato|yahiko/.test(c.id || '')) {
            [[252, 248], [290, 248], [258, 262], [282, 262]].forEach(function (p) { s += circ(p[0], p[1], 2.8, '#c9ced6', 'stroke="#2a2a2a" stroke-width="0.9"'); });
            s += circ(262, 306, 2.6, '#c9ced6', 'stroke="#2a2a2a" stroke-width="0.9"') + circ(280, 306, 2.6, '#c9ced6', 'stroke="#2a2a2a" stroke-width="0.9"');
          }
          break;
        case 'bandage_face': // wrapped from the nose down (Zabuza / Mu); a single nose strip otherwise (Kotetsu)
          var bclip = X.clip('<path d="' + g.d + '"/>');
          if (!(a.bandageFull || c.id === 'zabuza' || c.id === 'mu')) {
            s += '<g clip-path="' + bclip + '">' + path('M196,254L366,242L366,266L196,278Z', '#efe9dc', 'stroke="#9a9484" stroke-width="' + r1(L * 0.7) + '"') + line('M232,252L234,274M300,248L302,270', '#c8c2b0', L * 0.6) + '</g>';
            break;
          }
          s += '<g clip-path="' + bclip + '">' + path('M190,258L370,246L372,340L188,340Z', '#efe9dc') +
            line('M190,262L370,250M190,282L370,270M190,302L370,290M190,322L370,310', '#a8a290', L * 0.8) + line('M230,262L236,340M300,256L306,340', '#c8c2b0', L * 0.6, 'opacity="0.7"') + '</g>' +
            path('M200,258L360,247', 'none', 'stroke="#8a8474" stroke-width="' + r1(L) + '"');
          break;
        case 'lip_piercing':
          s += circ(276, 304, 3, '#c9ced6', 'stroke="#2a2a2a" stroke-width="0.8"');
          break;
        case 'eye_bandage':
          s += path('M206,214L284,206L286,262L206,270Z', '#efe9dc', 'stroke="#8a8474" stroke-width="' + r1(L * 0.9) + '"') + line('M210,228L282,222M210,246L284,240', '#b9b2a0', L * 0.7);
          break;
      }
    });
    return s;
  }
  // forehead marks are drawn above the fringe so they stay readable (canon: hair parts around them)
  function foreheadMarks(marks, L, band, hatOn) {
    var s = '', y = band ? 214 : 0;
    if (has(marks, 'caged_bird_seal') && !band && !hatOn) { // 籠中鳥: green cross between two bars, only when the forehead is bare
      var cx = 281, cy = 196, gc = '#2f9a4a';
      var cg = 'M' + (cx - 9) + ',' + (cy - 7) + 'L' + (cx + 9) + ',' + (cy + 7) + 'M' + (cx + 9) + ',' + (cy - 7) + 'L' + (cx - 9) + ',' + (cy + 7) +
        'M' + (cx - 17) + ',' + (cy - 8) + 'Q' + (cx - 21) + ',' + cy + ' ' + (cx - 17) + ',' + (cy + 8) + 'M' + (cx + 17) + ',' + (cy - 8) + 'Q' + (cx + 21) + ',' + cy + ' ' + (cx + 17) + ',' + (cy + 8) +
        'M' + (cx - 17) + ',' + cy + 'H' + (cx - 11) + 'M' + (cx + 11) + ',' + cy + 'H' + (cx + 17);
      s += line(cg, '#0e3a1a', L * 1.5, 'opacity="0.55"') + line(cg, gc, L * 0.95);
    }
    if (has(marks, 'ai_tattoo')) {
      var ty = band ? 222 : 196;
      s += '<text x="324" y="' + ty + '" font-size="30" font-weight="900" text-anchor="middle" fill="#d0162e" stroke="#4a0610" stroke-width="2.2" paint-order="stroke" font-family="' + FONT + '" transform="rotate(8 324 ' + ty + ')">愛</text>';
    }
    if (has(marks, 'diamond')) { var dy = band ? 212 : 196; s += path('M279,' + (dy - 12) + 'L288,' + dy + 'L279,' + (dy + 12) + 'L270,' + dy + 'Z', '#9a3fd0', 'stroke="#3a0a5a" stroke-width="' + r1(L * 0.7) + '"') + path('M279,' + (dy - 7) + 'L283,' + dy + 'L279,' + (dy - 1) + 'Z', '#e8c8ff', 'opacity="0.8"'); }
    if (has(marks, 'forehead_dots')) s += circ(260, 206, 5, '#d0162e', 'stroke="#4a0610" stroke-width="1"') + circ(298, 206, 5, '#d0162e', 'stroke="#4a0610" stroke-width="1"');
    return s;
  }
  function glasses(X, marks, g, L) {
    var s = '';
    if (has(marks, 'glasses')) {
      s += '<rect x="' + (g.eL[0] - 22) + '" y="' + (g.eL[1] - 15) + '" width="44" height="30" rx="8" fill="#e6f2ff" fill-opacity="0.25" stroke="#2a2a34" stroke-width="' + r1(L * 0.9) + '"/>';
      s += '<rect x="' + (g.eR[0] - 24) + '" y="' + (g.eR[1] - 15) + '" width="48" height="30" rx="8" fill="#e6f2ff" fill-opacity="0.25" stroke="#2a2a34" stroke-width="' + r1(L * 0.9) + '"/>';
      s += line('M' + (g.eL[0] + 22) + ',' + g.eL[1] + 'Q276,' + (g.eL[1] - 6) + ' ' + (g.eR[0] - 24) + ',' + g.eR[1] + 'M' + (g.eR[0] + 24) + ',' + (g.eR[1] - 4) + 'L362,' + (g.eR[1] - 8), '#2a2a34', L * 0.8);
      s += line('M' + (g.eL[0] - 14) + ',' + (g.eL[1] - 8) + 'l10,-4M' + (g.eR[0] - 14) + ',' + (g.eR[1] - 8) + 'l10,-4', '#fff', L * 0.8, 'opacity="0.8"');
    }
    if (has(marks, 'sunglasses')) {
      var d = 'M' + (g.eL[0] - 26) + ',' + (g.eL[1] - 12) + 'L' + (g.eR[0] + 28) + ',' + (g.eR[1] - 14) + 'Q' + (g.eR[0] + 28) + ',' + (g.eR[1] + 14) + ' ' + (g.eR[0] + 4) + ',' + (g.eR[1] + 14) + 'Q' + (g.eR[0] - 22) + ',' + (g.eR[1] + 14) + ' ' + (g.eR[0] - 26) + ',' + (g.eR[1] - 2) +
        'L276,' + (g.eL[1] - 4) + 'L' + (g.eL[0] + 22) + ',' + (g.eL[1] - 2) + 'Q' + (g.eL[0] + 18) + ',' + (g.eL[1] + 14) + ' ' + (g.eL[0] - 2) + ',' + (g.eL[1] + 14) + 'Q' + (g.eL[0] - 26) + ',' + (g.eL[1] + 12) + ' ' + (g.eL[0] - 26) + ',' + (g.eL[1] - 12) + 'Z';
      s += path(d, X.lin([[0, '#3a4250'], [1, '#0a0c12']]), 'stroke="#05060a" stroke-width="' + r1(L) + '"') + line('M' + (g.eL[0] - 16) + ',' + (g.eL[1] - 6) + 'l14,-2M' + (g.eR[0] - 16) + ',' + (g.eR[1] - 6) + 'l16,-2', '#9fb6d8', L * 0.9, 'opacity="0.8"');
      s += line('M' + (g.eR[0] + 28) + ',' + (g.eR[1] - 12) + 'L364,' + (g.eR[1] - 14), '#05060a', L);
    }
    return s;
  }
  function thirdEye(X, a, L) {
    var d = 'M262,178Q281,150 300,178Q281,206 262,178Z';
    return path(d, '#fbf8f4', 'stroke="#1a0d12" stroke-width="' + r1(L * 0.9) + '"') + '<g clip-path="' + X.clip('<path d="' + d + '"/>') + '"><g transform="translate(281,178) scale(11)">' + irisUnit(X, 'rinne_sharingan') + '</g></g>';
  }
  function paperFlower(x, y, c, L) {
    var s = '', ink = inkOf(c);
    for (var i = 0; i < 6; i++) {
      var a = i * 60 - 90, p = pol(x, y, 14, a);
      s += '<ellipse cx="' + r1(p[0]) + '" cy="' + r1(p[1]) + '" rx="13" ry="8" transform="rotate(' + (a) + ' ' + r1(p[0]) + ' ' + r1(p[1]) + ')" fill="' + c + '" stroke="' + ink + '" stroke-width="' + r1(L * 0.6) + '"/>';
    }
    return s + circ(x, y, 7, dk(c, 0.12), 'stroke="' + ink + '" stroke-width="' + r1(L * 0.5) + '"');
  }

  /* ---------- accessories ---------- */
  function swordD(x0, y0, x1, y1, w) { // straight blade quad between two points
    var dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy), nx = -dy / l * w / 2, ny = dx / l * w / 2;
    return 'M' + P(x0 + nx, y0 + ny) + 'L' + P(x1 + nx * 0.4, y1 + ny * 0.4) + 'L' + P(x1 + dx / l * w, y1 + dy / l * w) + 'L' + P(x1 - nx, y1 - ny) + 'L' + P(x0 - nx, y0 - ny) + 'Z';
  }
  function seg(x0, y0, x1, y1, w, fill, ink, L, extra) {
    return line('M' + P(x0, y0) + 'L' + P(x1, y1), ink, w + L * 2) + line('M' + P(x0, y0) + 'L' + P(x1, y1), fill, w, extra);
  }
  function accessoryBack(X, k, G, Cc, L, c) {
    var s = '', x = G.x;
    switch (k) {
      case 'gourd':
        var g1 = circleD(x(150), 392, 92), g2 = circleD(x(128), 262, 52), g3 = 'M' + x(112) + ',300L' + x(150) + ',300L' + x(150) + ',340L' + x(112) + ',340Z';
        s += outlineOf([g1, g2, g3], '#4a2a10', L * 2.2) + cel(X, g1, '#d8a868', '#a87638', 22, 14) + cel(X, g3, '#c8985a', '#9a6a30', 8, 0) + cel(X, g2, '#dcae70', '#ad7c3e', 12, 10);
        s += path('M' + x(118) + ',216L' + x(142) + ',214L' + x(140) + ',232L' + x(120) + ',232Z', '#9a6a3a', 'stroke="#3a2010" stroke-width="' + r1(L) + '"');
        s += line('M' + x(96) + ',300Q' + x(130) + ',314 ' + x(166) + ',298', '#6a2a2a', L * 2);
        break;
      case 'sword': case 'tanto':
        var nsw = c && (c.art && +c.art.swords) || (c && c.id === 'killer_b' ? 7 : 1);
        if (nsw > 1 && k === 'sword') {
          for (var si = 0; si < nsw; si++) {
            var ang = -150 + si * 120 / (nsw - 1), p0 = pol(280, 470, 120, ang), p1 = pol(280, 470, 330, ang);
            s += seg(p0[0], p0[1], p1[0], p1[1], 12, '#2a2a3a', '#0a0a12', L) + line('M' + PP(pol(280, 470, 230, ang)) + 'L' + PP(p1), '#c9a640', 4, 'stroke-dasharray="5 5"') +
              circ(pol(280, 470, 222, ang)[0], pol(280, 470, 222, ang)[1], 10, '#c9a640', 'stroke="#3a2a10" stroke-width="' + r1(L * 0.8) + '"');
          }
          break;
        }
        var sh = k === 'tanto' ? 0.7 : 1;
        var hx = x(-120), hy = 230 + (1 - sh) * 60;
        s += seg(hx + 40 * sh, hy + 64 * sh, hx - 4, hy - 6, 14, '#2a2440', '#0a0a12', L) + line('M' + P(hx + 36 * sh, hy + 58 * sh) + 'L' + P(hx, hy), '#6a5a9a', 4, 'stroke-dasharray="5 6"');
        s += path('M' + P(hx + 30 * sh, hy + 70 * sh) + 'l24,-14l6,10l-24,14Z', '#c9a640', 'stroke="#4a3a10" stroke-width="' + r1(L * 0.8) + '"');
        s += line('M' + P(hx + 48 * sh, hy + 76 * sh) + 'L' + P(x(150), 640), '#1a1626', 18 + L * 2) + line('M' + P(hx + 48 * sh, hy + 76 * sh) + 'L' + P(x(150), 640), '#3a3456', 16);
        break;
      case 'big_sword':
        var bs = 'M' + x(40) + ',300L' + x(210) + ',60L' + x(300) + ',120L' + x(130) + ',360Z';
        s += outlineOf([bs], '#1a1d24', L * 2.2) + cel(X, bs, '#c9d1da', '#8e98a6', 8, 10);
        s += circ(x(230), 116, 26, '#0a0a10', 'opacity="0"') + path(circleD(x(232), 112, 22), 'rgba(0,0,0,0)', 'stroke="#1a1d24" stroke-width="' + r1(L * 1.5) + '"');
        s += path('M' + x(262) + ',94A30,30 0 0,1 ' + x(296) + ',118L' + x(300) + ',120L' + x(266) + ',96Z', '#1a1d24');
        s += line('M' + x(70) + ',300L' + x(228) + ',80', '#f4f8fc', L, 'opacity="0.6"');
        s += seg(x(60), 340, x(20), 400, 16, '#3a2a20', '#0a0a0a', L);
        break;
      case 'samehada':
        var sm = 'M' + x(-60) + ',360L' + x(-230) + ',90Q' + x(-250) + ',60 ' + x(-200) + ',50L' + x(-160) + ',70L' + x(-10) + ',330Z';
        s += outlineOf([sm], '#0e1420', L * 2.2) + cel(X, sm, '#3e5f8a', '#263c5a', 10, 8);
        var sc = '';
        for (var i = 0; i < 9; i++) { var px = x(-200) + i * 17 * G.b, py = 92 + i * 28; sc += path('M' + P(px, py) + 'l10,-10l10,10l-10,8Z', '#6a8ab4'); }
        s += '<g clip-path="' + X.clip('<path d="' + sm + '"/>') + '">' + sc + path('M0,180L560,180L560,260L0,260Z', '#e8e0cc', 'opacity="0.9"') + line('M0,196H560M0,214H560M0,232H560', '#b8ae96', L * 0.7) + '</g>';
        s += seg(x(-200), 54, x(-230), 10, 14, '#3a2a40', '#0a0a10', L);
        break;
      case 'fan':
        var fd = 'M' + x(-150) + ',560L' + x(-330) + ',120A440,440 0 0,1 ' + x(-40) + ',70Z';
        s += outlineOf([fd], '#3a2a14', L * 2) + cel(X, fd, '#f2e6c8', '#cbb88e', 10, 6);
        for (var f = 0; f < 8; f++) { var q = pol(x(-150), 560, 470, -112 + f * 7.5); s += line('M' + x(-150) + ',560L' + PP(q), '#8a7448', L * 0.6, 'opacity="0.7"'); }
        [[-250, 150], [-170, 116], [-100, 150]].forEach(function (p) { s += circ(x(p[0]), p[1], 22, '#6a3aa0', 'stroke="#2a1440" stroke-width="' + r1(L) + '"'); });
        break;
      case 'scroll':
        var sr = 'M' + x(-230) + ',500L' + x(240) + ',492L' + x(240) + ',560L' + x(-230) + ',568Z';
        s += outlineOf([sr], '#3a2a14', L * 2) + cel(X, sr, '#f0e4c4', '#c6b48a', 0, 10);
        s += path('M' + x(-246) + ',494L' + x(-226) + ',494L' + x(-226) + ',574L' + x(-246) + ',574Z', '#b02a2a', 'stroke="#3a0a0a" stroke-width="' + r1(L) + '"') + path('M' + x(234) + ',486L' + x(256) + ',486L' + x(256) + ',566L' + x(234) + ',566Z', '#b02a2a', 'stroke="#3a0a0a" stroke-width="' + r1(L) + '"');
        s += line('M' + x(-200) + ',530L' + x(220) + ',522', '#b02a2a', L * 1.4);
        break;
      case 'puppet':
        var ph = 'M' + x(150) + ',230C' + x(200) + ',226 ' + x(232) + ',260 ' + x(228) + ',310C' + x(224) + ',360 ' + x(196) + ',380 ' + x(160) + ',376C' + x(124) + ',372 ' + x(110) + ',330 ' + x(116) + ',290C' + x(120) + ',254 ' + x(130) + ',232 ' + x(150) + ',230Z';
        s += spikesPuppet(x(170), 250, L);
        s += outlineOf([ph], '#1a1008', L * 2) + cel(X, ph, '#5a4636', '#3a2a20', 8, 8);
        s += circ(x(150), 292, 9, '#f4f0e0', 'stroke="#111" stroke-width="' + r1(L * 0.6) + '"') + circ(x(196), 292, 9, '#f4f0e0', 'stroke="#111" stroke-width="' + r1(L * 0.6) + '"') + circ(x(173), 268, 7, '#f4f0e0', 'stroke="#111" stroke-width="' + r1(L * 0.6) + '"');
        s += circ(x(150), 292, 3.5, '#111') + circ(x(196), 292, 3.5, '#111') + circ(x(173), 268, 3, '#111');
        s += line('M' + x(134) + ',330L' + x(212) + ',330M' + x(140) + ',350L' + x(206) + ',350', '#1a1008', L) + path('M' + x(138) + ',330L' + x(208) + ',330L' + x(202) + ',348L' + x(144) + ',348Z', '#2a0a0a');
        s += line('M' + x(150) + ',0L' + x(150) + ',240M' + x(196) + ',0L' + x(196) + ',250', '#8fdcff', 1.6, 'opacity="0.7"');
        break;
      case 'scythe':
        var px0 = x(-30), py0 = 650, px1 = x(-122), py1 = 92;
        s += seg(px0, py0, px1, py1, 13, '#7a2a2a', '#1a0808', L);
        [[0, 0.82], [0.1, 0.7], [0.2, 0.58]].forEach(function (b) {
          var ax = px1 + (px0 - px1) * b[0], ay = py1 + (py0 - py1) * b[0], k = b[1];
          var bd = 'M' + P(ax + 6, ay - 4) + 'C' + P(ax - 40 * k, ay - 70 * k) + ' ' + P(ax - 150 * k, ay - 40 * k) + ' ' + P(ax - 176 * k, ay + 46 * k) +
            'C' + P(ax - 130 * k, ay + 2 * k) + ' ' + P(ax - 60 * k, ay - 14 * k) + ' ' + P(ax + 4, ay + 16) + 'Z';
          s += outlineOf([bd], '#2a0408', L * 2) + cel(X, bd, '#d01a2a', '#8a0a16', 0, 8) + line('M' + P(ax - 20 * k, ay - 30 * k) + 'Q' + P(ax - 100 * k, ay - 44 * k) + ' ' + P(ax - 160 * k, ay + 30 * k), '#ff8a8a', L * 0.8, 'opacity="0.6"');
        });
        s += circ(px1, py1, 8, '#c9a640', 'stroke="#3a2a10" stroke-width="' + r1(L) + '"');
        break;
      case 'staff':
        s += seg(x(220), 60, x(60), 640, 14, '#1e1e26', '#000', L);
        s += seg(x(222), 54, x(200), 128, 18, '#d8b040', '#4a3a10', L) + seg(x(90), 520, x(76), 570, 18, '#d8b040', '#4a3a10', L);
        break;
      case 'umbrella':
        var ud = 'M' + x(-60) + ',150Q' + x(-210) + ',40 ' + x(-380) + ',130Q' + x(-220) + ',100 ' + x(-60) + ',150Z';
        ud = 'M' + x(-370) + ',190Q' + x(-250) + ',30 ' + x(-60) + ',70Q' + x(-180) + ',120 ' + x(-370) + ',190Z';
        s += seg(x(-210), 110, x(-110), 560, 7, '#5a3a20', '#1a0a00', L);
        s += outlineOf([ud], '#3a1010', L * 2) + cel(X, ud, '#c8403a', '#962a26', 0, 8);
        for (var u = 0; u < 6; u++) s += line('M' + x(-214) + ',98L' + P(x(-370) + u * 62 * G.b, 190 - u * 24), '#6a1a16', L * 0.6, 'opacity="0.6"');
        break;
      case 'gunbai':
        var gx = Math.min(x(166), 452), gb = circleD(gx, 214, 86);
        s += seg(gx - 16, 296, gx - 70, 520, 14, '#3a2a1a', '#0a0805', L);
        s += outlineOf([gb], '#2a1a0a', L * 2.2) + cel(X, gb, '#efe4c8', '#c7b78e', 12, 12);
        s += path(circleD(gx, 214, 72), 'none', 'stroke="#c8102e" stroke-width="7"') + '<g transform="translate(' + r1(gx) + ',214)">' + ringTomoe(3, 30, 11, -90, '#1a0a0a') + '</g>';
        break;
      case 'truth_orbs':
        for (var o = 0; o < 9; o++) {
          var ang = 200 + o * 17.5, p = pol(280, 280, 238, ang);
          if (o > 0 && o < 8) s += truthOrb(X, p[0], p[1], 20, L);
        }
        break;
      case 'bow': // Kidomaru's golden spider-silk bow, standing upright beside the body
        var bx0 = Math.min(x(222), 492), bow = 'M' + P(bx0, 54) + 'C' + P(bx0 + 70, 150) + ' ' + P(bx0 + 70, 470) + ' ' + P(bx0, 600) + 'L' + P(bx0 - 8, 592) + 'C' + P(bx0 + 50, 470) + ' ' + P(bx0 + 50, 160) + ' ' + P(bx0 - 8, 62) + 'Z';
        s += line('M' + P(bx0 - 4, 58) + 'L' + P(bx0 - 4, 596), '#fff6c8', 2, 'opacity="0.9"');
        s += outlineOf([bow], '#4a3208', L * 2) + cel(X, bow, '#f2c440', '#c08a1a', 6, 0);
        s += line('M' + P(bx0 + 36, 200) + 'q10,30 0,60M' + P(bx0 + 40, 330) + 'q8,30 0,60', '#fff2b0', L * 0.8, 'opacity="0.7"');
        s += path('M' + P(bx0 - 4, 54) + 'l-10,-18l18,8Z', '#f2c440', 'stroke="#4a3208" stroke-width="' + r1(L * 0.8) + '"');
        break;
      case 'fuma_shuriken': // Mizuki's giant windmill shuriken slung behind the far shoulder
        var fx = x(-150), fy = 236, fm = '';
        for (var fb = 0; fb < 4; fb++) {
          var fa = 20 + fb * 90, t1 = pol(fx, fy, 128, fa), c1 = pol(fx, fy, 70, fa - 34), b1 = pol(fx, fy, 26, fa - 60), b2 = pol(fx, fy, 26, fa + 30);
          fm += 'M' + PP(b2) + 'L' + PP(t1) + 'Q' + PP(c1) + ' ' + PP(b1) + 'Z';
        }
        s += path(fm, X.lin([[0, '#eef2f6'], [0.5, '#a8b2be'], [1, '#5a6472']], 0, 0, 1, 1), 'stroke="#1a1d24" stroke-width="' + r1(L * 1.6) + '" stroke-linejoin="round"');
        s += circ(fx, fy, 30, '#7a8492', 'stroke="#1a1d24" stroke-width="' + r1(L * 1.6) + '"') + circ(fx, fy, 12, '#2a2e36') + line('M' + P(fx - 20, fy - 14) + 'q16,-10 34,-2', '#fff', L * 0.8, 'opacity="0.6"');
        break;
      case 'kiseru':
      case 'none':
        break;
    }
    return s;
  }
  function spikesPuppet(x, y, L) {
    return path('M' + (x - 50) + ',' + (y + 10) + 'L' + (x - 30) + ',' + (y - 40) + 'L' + (x - 14) + ',' + (y - 6) + 'L' + (x + 4) + ',' + (y - 48) + 'L' + (x + 18) + ',' + (y - 6) + 'L' + (x + 40) + ',' + (y - 36) + 'L' + (x + 50) + ',' + (y + 14) + 'Z', '#1e1a20', 'stroke="#000" stroke-width="' + r1(L) + '"');
  }
  function truthOrb(X, x, y, r, L) {
    return circ(x, y, r + 6, '#000', 'opacity="0.25"') + circ(x, y, r, X.rad([[0, '#5a5a66'], [0.5, '#1a1a22'], [1, '#000']], 0.35, 0.3, 0.75), 'stroke="#000" stroke-width="' + r1(L) + '"') + circ(x - r * 0.35, y - r * 0.4, r * 0.22, '#fff', 'opacity="0.7"');
  }
  function accessoryMid(X, k, G, Cc, L, c) {
    var x = G.x, s = '';
    if (k === 'gourd') s += path('M' + x(110) + ',384L' + x(134) + ',396L' + x(-80) + ',650L' + x(-110) + ',650Z', '#8a5a3a', 'stroke="#2a1408" stroke-width="' + r1(L) + '"');
    if (k === 'sword' || k === 'tanto') s += '';
    if (k === 'samehada' || k === 'big_sword') s += path('M' + x(-104) + ',390L' + x(-80) + ',382L' + x(120) + ',650L' + x(90) + ',650Z', '#5a4a3a', 'stroke="#1a1008" stroke-width="' + r1(L) + '"');
    if (k === 'clay') s += path('M' + x(-120) + ',600Q' + x(-120) + ',570 ' + x(-90) + ',570L' + x(-50) + ',570Q' + x(-30) + ',570 ' + x(-30) + ',600L' + x(-30) + ',650L' + x(-120) + ',650Z', '#8a7a5a', 'stroke="#2a2010" stroke-width="' + r1(L) + '"');
    return s;
  }
  function forearm(x0, y0, x1, y1, w0, w1) {
    var dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy), nx = -dy / l, ny = dx / l;
    return 'M' + P(x0 + nx * w0 / 2, y0 + ny * w0 / 2) + 'Q' + P((x0 + x1) / 2 + nx * w0 * 0.62, (y0 + y1) / 2 + ny * w0 * 0.62) + ' ' + P(x1 + nx * w1 / 2, y1 + ny * w1 / 2) +
      'A' + r1(w1 / 2) + ',' + r1(w1 / 2) + ' 0 0,1 ' + P(x1 - nx * w1 / 2, y1 - ny * w1 / 2) + 'L' + P(x0 - nx * w0 / 2, y0 - ny * w0 / 2) + 'Z';
  }
  // arms folded across the chest (pose for tanks/controllers without a held item)
  function crossedArms(X, G, Cc, L, col_, skinArms) {
    var x = G.x, ink = skinArms ? Cc.skinInk : inkOf(col_), sh = skinArms ? Cc.skinSh : dk(col_, 0.28), s = '';
    var f1 = forearm(x(-186), 610, x(112), 560, 66 * G.b, 54 * G.b), f2 = forearm(x(200), 618, x(-108), 572, 68 * G.b, 56 * G.b);
    var dark = lum(col_) < 0.18, hl = dark ? lt(col_, 0.35) : null;
    s += outlineOf([f1], ink, L * 2) + cel(X, f1, col_, sh, 0, 10) + (dark ? line('M' + x(-176) + ',584Q' + x(-30) + ',548 ' + x(100) + ',536', hl, L * 0.9, 'opacity="0.8"') : '');
    s += '<g transform="translate(' + x(126) + ',552) scale(1.5) translate(' + (-x(126)) + ',-552)">' + hand(X, x(126), 552, 70, Cc.skin, Cc.skinInk, L / 1.5) + '</g>';
    s += outlineOf([f2], ink, L * 2) + cel(X, f2, col_, sh, 0, 10) + (dark ? line('M' + x(192) + ',590Q' + x(40) + ',556 ' + x(-96) + ',546', hl, L * 0.9, 'opacity="0.8"') : '');
    s += '<g transform="translate(' + x(-122) + ',566) scale(1.5) translate(' + (-x(-122)) + ',-566)">' + hand(X, x(-122), 566, -110, Cc.skin, Cc.skinInk, L / 1.5) + '</g>';
    s += line('M' + x(150) + ',592Q' + x(120) + ',600 ' + x(100) + ',590M' + x(-150) + ',600Q' + x(-120) + ',606 ' + x(-100) + ',598', ink, L * 0.6, 'opacity="0.45"');
    return s;
  }
  // both hands joined in a Tiger seal in front of the chest (pose for supports / healers)
  function handSeal(X, G, Cc, L, col_, skinArms, ac) {
    var x = G.x, ink = skinArms ? Cc.skinInk : inkOf(col_), sh = skinArms ? Cc.skinSh : dk(col_, 0.28), s = '';
    var hx = x(2), hy = 486;
    s += circ(hx, hy - 20, 70, X.rad([[0, lt(ac, 0.6), 0.75], [0.5, ac, 0.3], [1, ac, 0]]));
    var f1 = forearm(x(-186), 640, hx - 26, hy + 18, 66 * G.b, 46), f2 = forearm(x(200), 646, hx + 26, hy + 22, 68 * G.b, 46);
    s += outlineOf([f1, f2], ink, L * 2) + cel(X, f1, col_, sh, 0, 10) + cel(X, f2, col_, sh, 0, 10);
    var sk = Cc.skin, sk2 = Cc.skinSh, sink = Cc.skinInk;
    var fists = 'M' + P(hx - 34, hy + 4) + 'C' + P(hx - 36, hy - 18) + ' ' + P(hx - 14, hy - 26) + ' ' + P(hx, hy - 20) + 'C' + P(hx + 14, hy - 26) + ' ' + P(hx + 36, hy - 18) + ' ' + P(hx + 34, hy + 4) + 'C' + P(hx + 32, hy + 28) + ' ' + P(hx - 32, hy + 28) + ' ' + P(hx - 34, hy + 4) + 'Z';
    // Ram seal: index + middle fingers of both hands raised together (4 short fingertips)
    var fingers = 'M' + P(hx - 20, hy - 18) + 'L' + P(hx - 19, hy - 44) + 'Q' + P(hx - 15, hy - 52) + ' ' + P(hx - 10, hy - 46) + 'Q' + P(hx - 5, hy - 54) + ' ' + P(hx, hy - 48) +
      'Q' + P(hx + 5, hy - 54) + ' ' + P(hx + 10, hy - 46) + 'Q' + P(hx + 15, hy - 52) + ' ' + P(hx + 19, hy - 44) + 'L' + P(hx + 20, hy - 18) + 'Z';
    s += outlineOf([fists, fingers], sink, L * 2) + cel(X, fingers, sk, sk2, 3, 4) + cel(X, fists, sk, sk2, 4, 6);
    s += line('M' + P(hx - 10, hy - 45) + 'V' + r1(hy - 20) + 'M' + P(hx, hy - 47) + 'V' + r1(hy - 20) + 'M' + P(hx + 10, hy - 45) + 'V' + r1(hy - 20), sink, L * 0.8, 'opacity="0.85"');
    s += line('M' + P(hx - 26, hy - 6) + 'q8,6 18,4M' + P(hx + 26, hy - 6) + 'q-8,6 -18,4M' + P(hx - 22, hy + 8) + 'q8,6 16,2M' + P(hx + 22, hy + 8) + 'q-8,6 -16,2M' + P(hx, hy - 18) + 'V' + r1(hy + 20), sink, L * 0.6, 'opacity="0.7"');
    return s;
  }
  function hand(X, x, y, rot, skin, ink, L, sleeve) {
    var palm = 'M-22,-16C-10,-27 14,-25 23,-13C29,-2 28,14 17,22C5,29 -15,27 -24,15C-31,5 -30,-8 -22,-16Z';
    var thumb = 'M-24,-6C-30,-18 -20,-27 -8,-24C2,-21 6,-14 2,-8C-6,-10 -14,-8 -18,-2Z';
    var sh = mix(skin, '#b0506a', 0.28);
    return '<g transform="translate(' + r1(x) + ',' + r1(y) + ') rotate(' + rot + ')">' + outlineOf([palm, thumb], ink, L * 2) + cel(X, palm, skin, sh, 4, 6) +
      line('M8,-16Q16,-12 20,-4M6,-6Q15,-1 21,6M4,4Q13,10 17,16M-6,12Q2,18 8,22', ink, L * 0.7, 'opacity="0.75"') +
      cel(X, thumb, lt(skin, 0.06), sh, 2, 4) + line('M-20,-6Q-12,-12 -2,-10', ink, L * 0.5, 'opacity="0.6"') + '</g>';
  }
  function accessoryFront(X, k, G, Cc, L, c, a) {
    var x = G.x, s = '';
    if (isRaise(k, a)) {
      // forearm raised across the chest, fist at (hx,hy)
      var hx = x(70), hy = 478;
      var sleeveCol = Cc.armCol || (Cc.armSkin ? Cc.skin : Cc.main);
      var fa = 'M' + x(134) + ',660C' + x(140) + ',600 ' + P(hx + 10, hy + 70) + ' ' + P(hx - 14, hy + 8) + 'L' + P(hx + 34, hy - 6) + 'C' + P(hx + 50, hy + 50) + ' ' + x(200) + ',580 ' + x(212) + ',660Z';
      s += outlineOf([fa], inkOf(sleeveCol), L * 2) + cel(X, fa, sleeveCol, dk(sleeveCol, 0.25), 6, 0);
      var item = '';
      if (k === 'kunai') item = path('M' + P(hx - 8, hy - 8) + 'L' + P(hx - 40, hy - 70) + 'L' + P(hx - 78, hy - 150) + 'L' + P(hx - 20, hy - 82) + 'L' + P(hx + 4, hy - 20) + 'Z', X.lin([[0, '#f4f8fc'], [1, '#98a4b2']]), 'stroke="#20252e" stroke-width="' + r1(L * 1.1) + '"') +
        line('M' + P(hx - 12, hy - 22) + 'L' + P(hx - 70, hy - 136), '#ffffff', L * 0.8, 'opacity="0.8"') + seg(hx + 2, hy + 4, hx + 26, hy + 48, 10, '#3a3a44', '#111', L) + circ(hx + 32, hy + 60, 10, 'none', 'stroke="#222" stroke-width="' + r1(L * 1.6) + '"');
      if (k === 'chakra_blades') item = path('M' + P(hx - 14, hy - 14) + 'L' + P(hx - 110, hy - 120) + 'L' + P(hx - 34, hy - 18) + 'Z', '#6fe0b8', 'opacity="0.45"') + path('M' + P(hx - 10, hy - 10) + 'L' + P(hx - 86, hy - 100) + 'L' + P(hx - 24, hy - 14) + 'Z', X.lin([[0, '#ffffff'], [1, '#9ab8d0']]), 'stroke="#1a2f48" stroke-width="' + r1(L) + '"') + circ(hx + 4, hy + 2, 18, 'none', 'stroke="#3a3a44" stroke-width="' + r1(L * 2) + '"');
      if (k === 'flute') item = seg(hx - 110, hy - 110, hx + 40, hy + 30, 12, '#b8323a', '#3a0a0a', L) + circ(hx - 74, hy - 76, 2.8, '#2a0a0a') + circ(hx - 58, hy - 61, 2.8, '#2a0a0a') + circ(hx - 42, hy - 46, 2.8, '#2a0a0a') + line('M' + P(hx - 104, hy - 104) + 'l10,10', '#f0c040', 10);
      if (k === 'paintbrush') item = seg(hx - 90, hy - 130, hx + 16, hy + 20, 8, '#c8a060', '#3a2a10', L) + path('M' + P(hx - 88, hy - 128) + 'Q' + P(hx - 110, hy - 150) + ' ' + P(hx - 104, hy - 172) + 'Q' + P(hx - 86, hy - 150) + ' ' + P(hx - 80, hy - 134) + 'Z', '#111', 'stroke="#111" stroke-width="' + r1(L) + '"') + path('M' + P(hx - 120, hy - 60) + 'q-6,10 0,14q6,-4 0,-14Z', '#111');
      if (k === 'clay') item = clayBird(hx - 50, hy - 92, L * 1.2);
      if (k === 'chakra_rods') { // Pain's black chakra receiver, ridged grip, held point-up
        var rtx = hx - 172, rty = hy - 132; // tip passes below the chin, clear of the face
        item = seg(hx + 18, hy + 24, rtx, rty, 10, '#22202a', '#05040a', L) + path('M' + P(rtx + 2, rty - 8) + 'L' + P(rtx - 22, rty - 14) + 'L' + P(rtx - 2, rty + 8) + 'Z', '#2a2832', 'stroke="#05040a" stroke-width="' + r1(L) + '"');
        for (var ri = 0; ri < 5; ri++) { var rt = 0.12 + ri * 0.05, rx = hx + 18 + (rtx - hx - 18) * rt, ry = hy + 24 + (rty - hy - 24) * rt; item += line('M' + P(rx - 2, ry - 6) + 'l5,11', '#6a6878', L * 0.7); }
        item += line('M' + P(hx - 40, hy - 34) + 'L' + P(rtx + 14, rty + 6), '#8a88a0', L * 0.5, 'opacity="0.7"');
      }
      if (k === 'senbon') { // fan of needles between the fingers (Haku)
        [-34, -22, -10].forEach(function (an) { var e = pol(hx - 4, hy - 6, 120, an - 90); item += line('M' + P(hx - 4, hy - 6) + 'L' + PP(e), '#3a3f4a', 4.2) + line('M' + P(hx - 4, hy - 6) + 'L' + PP(e), '#e6edf5', 2.2); });
      }
      s += item + '<g transform="translate(' + r1(hx) + ',' + r1(hy) + ') scale(1.55) translate(' + r1(-hx) + ',' + r1(-hy) + ')">' + hand(X, hx, hy, -40, Cc.skin, Cc.skinInk, L / 1.55) + '</g>';
    }
    if (k === 'dog') {
      s += '<g transform="translate(' + x(150) + ',372) scale(1.55) translate(' + (-x(150)) + ',-372)">';
      var dx = x(150), dy = 372, d0 = 'M' + (dx - 34) + ',' + dy + 'C' + (dx - 36) + ',' + (dy - 40) + ' ' + (dx + 36) + ',' + (dy - 40) + ' ' + (dx + 34) + ',' + dy + 'C' + (dx + 30) + ',' + (dy + 30) + ' ' + (dx - 30) + ',' + (dy + 30) + ' ' + (dx - 34) + ',' + dy + 'Z';
      var e1 = 'M' + (dx - 30) + ',' + (dy - 18) + 'C' + (dx - 50) + ',' + (dy - 20) + ' ' + (dx - 50) + ',' + (dy + 10) + ' ' + (dx - 36) + ',' + (dy + 12) + 'Z', e2 = 'M' + (dx + 30) + ',' + (dy - 18) + 'C' + (dx + 50) + ',' + (dy - 20) + ' ' + (dx + 50) + ',' + (dy + 10) + ' ' + (dx + 36) + ',' + (dy + 12) + 'Z';
      s += outlineOf([d0, e1, e2], '#3a3a44', L * 2) + cel(X, e1, '#e8e4dc', '#b8b0a4', 2, 4) + cel(X, e2, '#e8e4dc', '#b8b0a4', 2, 4) + cel(X, d0, '#fbfaf6', '#d6d0c6', 6, 6);
      s += circ(dx - 12, dy - 4, 4, '#1a1a1a') + circ(dx + 12, dy - 4, 4, '#1a1a1a') + ell(dx, dy + 8, 6, 4.5, '#1a1a1a') + path('M' + (dx - 20) + ',' + (dy - 18) + 'l8,6l-10,0Z', '#c8102e') + path('M' + (dx + 20) + ',' + (dy - 18) + 'l-8,6l10,0Z', '#c8102e');
      s += '</g>';
    }
    if (k === 'truth_orbs') {
      s += truthOrb(X, x(-150), 600, 22, L) + truthOrb(X, x(170), 610, 22, L);
    }
    return s;
  }
  var RAISE_SET = { kunai: 1, chakra_blades: 1, flute: 1, paintbrush: 1, clay: 1, chakra_rods: 1 };
  function isRaise(k, a) { return !!own(RAISE_SET, k) || (k === 'senbon' && !!a && a.senbonPos === 'hand'); }
  // small items held in the mouth, drawn in head space at the near mouth corner
  function mouthItem(X, k, a, g, L) {
    var mx = g.mouth[0], my = g.mouth[1], w = g.mouth[2], x0, y0, s = '';
    switch (k) {
      case 'cigarette': // Asuma
        x0 = mx + w * 0.32; y0 = my + 1;
        s += seg(x0, y0, x0 + 40, y0 + 11, 5.5, '#f6f2ea', '#3a2a24', L * 0.6) + seg(x0, y0, x0 + 11, y0 + 3, 5.5, '#d88a3a', '#3a2a24', L * 0.6);
        s += circ(x0 + 41, y0 + 11.3, 3.4, '#ff5a1a', 'stroke="#7a1a00" stroke-width="1"') + circ(x0 + 41, y0 + 11.3, 1.6, '#ffd27a');
        s += line('M' + P(x0 + 43, y0 + 6) + 'q-8,-12 2,-22q10,-10 0,-24q-6,-8 2,-18', '#eceff4', L * 0.9, 'opacity="0.55"');
        return s;
      case 'senbon':
        if (a && a.senbonPos === 'hand') return '';
        x0 = mx + w * 0.28; y0 = my + 1; // Genma: needle held like a toothpick
        return line('M' + P(x0 - 6, y0 + 1) + 'L' + P(x0 + 62, y0 + 9), '#2a2e38', 4) + line('M' + P(x0 - 6, y0 + 1) + 'L' + P(x0 + 62, y0 + 9), '#e8eef6', 1.8) + circ(x0 + 62, y0 + 9, 1.6, '#e8eef6');
      case 'lollipop': // Omoi: round candy at the lips, stick poking out
        x0 = mx + w * 0.55; y0 = my + 3;
        s += seg(x0 + 4, y0 + 2, x0 + 30, y0 + 22, 3.6, '#f8f6f0', '#5a4a40', L * 0.5);
        s += circ(x0, y0, 8.5, '#ff6aa0', 'stroke="#5a1a30" stroke-width="' + r1(L * 0.7) + '"') + '<g transform="translate(' + r1(x0) + ',' + r1(y0) + ') scale(7)"><path d="' + spiralD(1.5, 0.08, 1, 30) + '" fill="none" stroke="#fff3f8" stroke-width="0.2"/></g>';
        return s;
    }
    return '';
  }
  // Obito's goggles worn over the eyes: dark frames, orange tinted glass, strap round the head
  function goggles(X, a, g, L) {
    var fc = col(a.gogglesColor, '#ff8f00'), s = '';
    var E1 = g.eL, E2 = g.eR;
    s += line('M' + P(E1[0] - E1[2] * 0.8, E1[1] - 2) + 'L' + P(198, E1[1] - 8) + 'M' + P(E2[0] + E2[2] * 0.8, E2[1] - 2) + 'L' + P(364, E2[1] - 10), '#2a2a32', L * 2.6);
    [[E1, -1], [E2, 1]].forEach(function (e) {
      var E_ = e[0], rx = E_[2] * 0.78, ry = E_[3] * 1.15 + 4, d = ellD(E_[0], E_[1] + 1, rx, ry);
      s += path(d, fc, 'fill-opacity="0.34" stroke="#22222a" stroke-width="' + r1(L * 2.2) + '"') + path(d, 'none', 'stroke="' + lt(fc, 0.35) + '" stroke-width="' + r1(L * 0.8) + '"');
      s += path('M' + P(E_[0] - rx * 0.6, E_[1] - ry * 0.2) + 'q' + r1(rx * 0.3) + ',' + r1(-ry * 0.6) + ' ' + r1(rx * 0.8) + ',' + r1(-ry * 0.62), 'none', 'stroke="#fff" stroke-width="' + r1(L * 0.9) + '" opacity="0.75" stroke-linecap="round"');
    });
    s += line('M' + P(E1[0] + E1[2] * 0.78, E1[1] - 2) + 'Q' + P((E1[0] + E2[0]) / 2, E1[1] - 9) + ' ' + P(E2[0] - E2[2] * 0.78, E2[1] - 2), '#22222a', L * 1.6);
    return s;
  }
  // Konohamaru's long scarf: wrap under the chin, one tail down the chest, one streaming back
  function scarf(X, a, G, Cc, L) {
    var sc = col(a.scarfColor, Cc.acc), ink = inkOf(sc), sh = dk(sc, 0.3);
    var wrap = 'M226,322Q278,350 330,316L336,352Q280,388 222,356Z';
    var tail = 'M296,350C312,410 300,470 316,560L282,566C270,478 280,410 270,354Z';
    var fly = 'M240,340C196,322 140,350 92,324C112,358 150,382 200,372C220,368 236,362 246,356Z';
    var s = outlineOf([fly, tail, wrap], ink, L * 2) + cel(X, fly, sc, sh, 0, 8) + cel(X, tail, sc, sh, 8, 0) + cel(X, wrap, sc, sh, 0, 10);
    s += line('M230,338Q278,362 330,334M300,400Q296,450 304,500M120,346Q160,366 210,360', ink, L * 0.6, 'opacity="0.45"');
    s += line('M284,566l2,14M292,565l1,14M300,564l2,14M308,563l1,14', sc, L * 1.2);
    return s;
  }
  function kiseru(L) {
    return seg(286, 300, 352, 318, 4, '#5a3a1a', '#1a0a00', L) + path('M346,308l14,-2l4,16l-14,4Z', '#8a6a3a', 'stroke="#1a0a00" stroke-width="' + r1(L * 0.8) + '"') +
      path('M356,300C350,280 366,268 360,248C372,262 366,282 372,296Z', '#e8e8f0', 'opacity="0.5"');
  }
  function clayBird(x, y, L) {
    var b = 'M' + x + ',' + y + 'L' + (x - 60) + ',' + (y - 34) + 'L' + (x - 14) + ',' + (y - 6) + 'L' + (x - 26) + ',' + (y + 28) + 'L' + (x + 12) + ',' + (y + 8) + 'L' + (x + 46) + ',' + (y + 14) + 'Z';
    return path(b, '#f2eee4', 'stroke="#5a5448" stroke-width="' + r1(L) + '"') + circ(x - 4, y - 2, 2, '#333');
  }

  /* ======================================================================
   * 10b. beasts (bijuu, toads, snakes)
   * ==================================================================== */
  var BEAST_TAILS = { tanuki: 1, cat: 2, turtle: 3, monkey: 4, horse: 5, slug: 6, beetle: 7, ox: 8, fox: 9, juubi: 10, toad: 0, snake: 0, dog: 0 };
  var BEAST_EYE = { tanuki: '#f2c230', cat: '#ffd23a', turtle: '#ff3a2a', monkey: '#7ad04a', horse: '#ff6a5a', slug: '#3a3a2a', beetle: '#ff9a2a', ox: '#ffd54f', fox: '#ff2a1a', juubi: '#e3121c', toad: '#ffd23a', snake: '#ffe03a', dog: '#2a1a10' };
  function mirrorD(d) { return d.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, function (m, x, y) { return r1(560 - x) + ',' + y; }); } // absolute-coordinate paths only
  function smooth(pts, closed) {
    var n = pts.length, d = 'M' + PP(pts[0]);
    for (var i = 1; i < n - 1; i++) d += 'Q' + PP(pts[i]) + ' ' + P((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    d += 'L' + PP(pts[n - 1]);
    return d + (closed ? 'Z' : '');
  }
  function tailPath(bx, by, ang, len, w0, bend, kind) {
    var p0 = [bx, by], p2 = pol(bx, by, len, ang), mx = (p0[0] + p2[0]) / 2, my = (p0[1] + p2[1]) / 2;
    var pa = (ang + 90) * Math.PI / 180, p1 = [mx + Math.cos(pa) * bend * len, my + Math.sin(pa) * bend * len];
    var N = 16, L = [], R = [];
    for (var i = 0; i <= N; i++) {
      var t = i / N, u = 1 - t;
      var x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
      var tx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), ty = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]), tl = Math.sqrt(tx * tx + ty * ty) || 1;
      var nx = -ty / tl, ny = tx / tl, w;
      if (kind === 'fluffy') w = w0 * (0.55 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * (t > 0.85 ? (1 - t) / 0.15 : 1);
      else if (kind === 'fin') w = w0 * (1 - t * 0.75) * (t > 0.82 ? 1 + (t - 0.82) * 9 : 1);
      else if (kind === 'flame') w = w0 * (0.6 + 0.7 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * (t > 0.8 ? (1 - t) / 0.2 : 1) * (1 + 0.16 * Math.sin(i * 2.3));
      else w = w0 * (1 - t * 0.88);
      var wob = (kind === 'fluffy' && i > 1 && i < N - 1) ? (i % 2 ? 1.12 : 0.92) : 1;
      L.push([x + nx * w / 2 * wob, y + ny * w / 2 * wob]); R.push([x - nx * w / 2 / wob, y - ny * w / 2 / wob]);
    }
    if (kind === 'fin') { // fluke tip
      var e = L[N], f = R[N];
      L[N] = [e[0] + (e[0] - f[0]) * 0.3, e[1] + (e[1] - f[1]) * 0.3];
    }
    var pts = L.concat(R.reverse());
    return smooth(pts, true);
  }
  function beastTails(X, b, n, bc, ac, L) {
    if (!n) return '';
    var kind = { fox: 'fluffy', monkey: 'fluffy', tanuki: 'fluffy', cat: 'flame', horse: 'fin', slug: 'tentacle', ox: 'tentacle', juubi: 'tentacle', turtle: 'tentacle', beetle: 'tentacle' }[b] || 'fluffy';
    var w0 = { fox: 92, monkey: 66, tanuki: 130, cat: 76, horse: 58, slug: 54, ox: 50, juubi: 64, turtle: 64, beetle: 40 }[b] || 60;
    var list = [], i;
    for (i = 0; i < n; i++) {
      var spread = Math.min(150, 40 + n * 14), a = n === 1 ? -55 : -90 - spread / 2 + i * spread / (n - 1);
      var len = (b === 'fox' ? 470 : 410) + (i % 2) * 36 + (n === 1 ? 20 : 0) - Math.abs(a + 90) * 0.5;
      var bend = (a < -90 ? 1 : -1) * (0.12 + Math.abs(a + 90) / 600);
      var p2 = pol(280, 540, len, a), pa = (a + 90) * Math.PI / 180, mx = (280 + p2[0]) / 2 + Math.cos(pa) * bend * len, my = (540 + p2[1]) / 2 + Math.sin(pa) * bend * len;
      var cl = function (t, off) { var u = 1 - t, x = u * u * 280 + 2 * u * t * mx + t * t * p2[0], y = u * u * 540 + 2 * u * t * my + t * t * p2[1]; return [x + Math.cos(pa) * off, y + Math.sin(pa) * off]; };
      list.push({ a: a, d: tailPath(280, 540, a, len, w0 * 1.1, bend, kind), c1: 'M' + PP(cl(0.35, w0 * 0.18)) + 'Q' + PP(cl(0.6, w0 * 0.22)) + ' ' + PP(cl(0.85, w0 * 0.08)), c2: 'M' + PP(cl(0.45, -w0 * 0.16)) + 'Q' + PP(cl(0.68, -w0 * 0.18)) + ' ' + PP(cl(0.9, -w0 * 0.05)) });
    }
    list.sort(function (p, q) { return Math.abs(q.a + 90) - Math.abs(p.a + 90); });
    var s = '', tcol = b === 'cat' ? lt(bc, 0.1) : bc;
    for (i = 0; i < list.length; i++) {
      s += outlineOf([list[i].d], inkOf(bc), L * 2) + cel(X, list[i].d, tcol, dk(tcol, 0.3), 10, 10);
      s += line(list[i].c1, kind === 'fluffy' ? lt(tcol, 0.35) : dk(tcol, 0.25), L * 0.9, 'opacity="0.7"') + line(list[i].c2, dk(tcol, 0.3), L * 0.8, 'opacity="0.6"');
      if (b === 'ox') { // suckers
        var pp = pol(280, 540, 300, list[i].a);
        s += ell(pp[0], pp[1], 9, 7, lt(bc, 0.35), 'stroke="' + inkOf(bc) + '" stroke-width="' + r1(L * 0.6) + '"');
      }
      if (b === 'tanuki') s += '<g clip-path="' + X.clip('<path d="' + list[i].d + '"/>') + '">' + line('M180,380Q260,300 300,180M230,420Q320,320 360,200', ac, 10, 'opacity="0.9"') + '</g>';
    }
    if (b === 'beetle') { // six wings
      for (var w = 0; w < 6; w++) {
        var wa = w < 3 ? -160 + w * 22 : -64 + (w - 3) * 22, tip = pol(280, 400, 300, wa), c1 = pol(280, 400, 200, wa - 14), c2 = pol(280, 400, 200, wa + 14);
        var wd = 'M280,400Q' + PP(c1) + ' ' + PP(tip) + 'Q' + PP(c2) + ' 280,400Z';
        s += path(wd, X.lin([[0, lt(ac, 0.6), 0.9], [1, '#e8fff8', 0.45]]), 'stroke="' + dk(ac, 0.3) + '" stroke-width="' + r1(L) + '"') + line('M280,400L' + PP(tip), dk(ac, 0.3), L * 0.6, 'opacity="0.6"');
      }
    }
    return s;
  }
  function beastEye(X, cx, cy, w, h, s, kind, color, sclera) {
    var o = '', d = 'M' + P(cx - s * w / 2, cy + h * 0.25) + 'Q' + P(cx - s * w * 0.1, cy - h * 0.9) + ' ' + P(cx + s * w / 2, cy - h * 0.45) + 'Q' + P(cx + s * w * 0.1, cy + h * 0.75) + ' ' + P(cx - s * w / 2, cy + h * 0.25) + 'Z';
    o += path(d, sclera || '#fff4d0', 'stroke="#140608" stroke-width="' + r1(X.lw * 1.4) + '"');
    var r = Math.min(w, h * 1.6) * 0.42;
    o += '<g clip-path="' + X.clip('<path d="' + d + '"/>') + '"><g transform="translate(' + r1(cx) + ',' + r1(cy) + ') scale(' + r1(r) + ')">' + irisUnit(X, kind, color) + '</g>' + circ(cx - r * 0.35, cy - r * 0.45, r * 0.22, '#fff', 'opacity="0.9"') + '</g>';
    return o;
  }
  function claws(x, y, s, L) {
    var o = '';
    for (var i = 0; i < 3; i++) o += path('M' + P(x + (i - 1) * 26 * s, y) + 'l' + r1(10 * s) + ',' + r1(34 * s) + 'l' + r1(10 * s) + ',' + r1(-34 * s) + 'Z', '#f4eee0', 'stroke="#2a1a10" stroke-width="' + r1(L) + '"');
    return o;
  }
  function beastHead(X, b, bc, ac, a, L) {
    var ink = inkOf(bc), s = '', eye = pick(a.eyes, ART.eyes, 'beast'), ec = col(a.eyeColor, BEAST_EYE[b] || '#ffcf3a');
    var hd, list, sh = dk(bc, 0.28), lt1 = lt(bc, 0.25);
    function body(listD, sx, sy) { var o = outlineOf(listD, ink, L * 2.2); listD.forEach(function (d) { o += cel(X, d, bc, sh, sx || 10, sy || 10); }); return o; }
    var mouthTeeth = function (x0, x1, y, n, dn) {
      var o = 'M' + P(x0, y), w = (x1 - x0) / n;
      for (var i = 0; i < n; i++) o += 'L' + P(x0 + w * (i + 0.5), y + (dn || 12)) + 'L' + P(x0 + w * (i + 1), y);
      return path(o + 'Z', '#fffaf0', 'stroke="#2a0a0a" stroke-width="' + r1(L * 0.6) + '"');
    };
    switch (b) {
      case 'fox':
        s += body(['M182,252L132,264L176,282L138,308L192,308Z', 'M378,252L428,264L384,282L422,308L368,308Z']);
        s += body(['M198,216L160,64L250,172Z', 'M362,216L400,64L310,172Z']);
        s += path('M204,200L176,96L236,172Z', ac) + path('M356,200L384,96L324,172Z', ac);
        hd = 'M188,226C186,176 226,150 280,150C334,150 374,176 372,226C398,248 404,284 384,304C376,330 348,352 330,362C312,382 296,394 280,396C264,394 248,382 230,362C212,352 184,330 176,304C156,284 162,248 188,226Z';
        s += body([hd]);
        s += path('M236,300C246,280 314,280 324,300C330,330 306,362 280,364C254,362 230,330 236,300Z', lt(bc, 0.12), 'opacity="0.8"');
        s += path('M200,236Q232,198 268,232Q238,226 210,258Z', ac) + path('M360,236Q328,198 292,232Q322,226 350,258Z', ac);
        s += path('M226,222L206,168L244,214Z', ac) + path('M334,222L354,168L316,214Z', ac);
        s += beastEye(X, 240, 248, 48, 24, -1, eye, ec) + beastEye(X, 320, 248, 48, 24, 1, eye, ec);
        s += path('M236,214Q252,208 266,222M324,214Q308,208 294,222', 'none', 'stroke="' + ac + '" stroke-width="' + r1(L * 2) + '"');
        s += ell(280, 326, 17, 11, '#1a0a0a') + circ(274, 322, 4, '#fff', 'opacity="0.6"');
        s += path('M222,344Q280,372 338,344Q314,390 280,392Q246,390 222,344Z', '#5a0a10', 'stroke="#1a0606" stroke-width="' + r1(L) + '"') + mouthTeeth(228, 332, 348, 10, 12);
        break;
      case 'tanuki':
        s += body(['M196,204C172,150 196,112 232,150Z', 'M364,204C388,150 364,112 328,150Z']);
        hd = 'M178,244C172,170 226,138 280,138C334,138 388,170 382,244C394,304 360,374 280,384C200,374 166,304 178,244Z';
        s += body([hd]);
        s += line('M200,196Q232,170 256,196Q244,214 226,206M360,196Q328,170 304,196Q316,214 334,206M280,150Q270,176 280,196Q292,176 280,150M196,288Q214,306 236,300M364,288Q346,306 324,300M206,330Q240,350 250,336M354,330Q320,350 310,336', ac, L * 2.4);
        s += beastEye(X, 236, 252, 54, 36, -1, 'beast', ec, '#141018') + beastEye(X, 324, 252, 54, 36, 1, 'beast', ec, '#141018');
        s += path('M214,312Q280,334 346,312Q330,366 280,370Q230,366 214,312Z', '#4a0a10', 'stroke="#1a0606" stroke-width="' + r1(L) + '"') + mouthTeeth(222, 338, 316, 9, 13);
        break;
      case 'cat':
        s += path(flameRow(150, 410, 210, 120, 7, 21), lt(bc, 0.35), 'opacity="0.8"');
        s += body(['M200,214L180,86L254,168Z', 'M360,214L380,86L306,168Z']);
        s += path('M206,198L190,110L238,170Z', ac) + path('M354,198L370,110L322,170Z', ac);
        hd = 'M190,232C188,182 228,158 280,158C332,158 372,182 370,232C380,284 350,334 280,344C210,334 180,284 190,232Z';
        s += body([hd]);
        s += path('M230,296C240,276 320,276 330,296C334,322 310,338 280,338C250,338 226,322 230,296Z', lt(bc, 0.25), 'opacity="0.8"');
        s += beastEye(X, 238, 248, 46, 26, -1, 'beast', '#ffd23a') + beastEye(X, 322, 248, 46, 26, 1, 'beast', '#7ae05a');
        s += path('M270,296L290,296L280,308Z', '#1a0a20') + line('M280,308Q270,322 256,318M280,308Q290,322 304,318', '#1a0a20', L) + path('M262,318l4,10l4,-9ZM290,319l4,9l4,-10Z', '#fff');
        s += line('M206,290L160,280M206,302L162,306M354,290L400,280M354,302L398,306', lt(bc, 0.6), L * 0.8);
        break;
      case 'turtle': // Isobu: armoured head, far eye sealed under a carapace plate, one great red eye, crab-like jaws
        hd = 'M200,262C196,206 236,174 282,174C328,174 366,206 364,262C364,316 332,354 282,362C232,354 200,316 200,262Z';
        s += body(['M236,184L224,132L256,176Z', 'M282,176L282,120L300,174Z', 'M328,184L346,134L310,176Z']);
        s += body([hd]);
        var plate = 'M192,212L280,192L276,292L188,282Z';
        s += path(plate, lt(bc, 0.25), 'stroke="' + ink + '" stroke-width="' + r1(L * 1.4) + '" stroke-linejoin="round"') + line('M200,236L274,224M198,260L272,252', dk(bc, 0.2), L, 'opacity="0.7"') + path('M196,214L180,186L218,208ZM236,204L230,174L256,200Z', lt(bc, 0.45), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"');
        s += beastEye(X, 324, 244, 54, 34, 1, eye, ec) + path('M294,222Q326,204 360,222', 'none', 'stroke="' + dk(bc, 0.45) + '" stroke-width="' + r1(L * 2.4) + '" stroke-linecap="round"');
        s += path('M222,306Q282,336 346,302L338,334Q282,360 230,334Z', '#3a0a10', 'stroke="#1a0606" stroke-width="' + r1(L) + '"') + mouthTeeth(228, 340, 310, 8, 9);
        s += path('M206,300L190,330L220,322ZM358,296L376,326L346,318Z', lt(bc, 0.35), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"');
        break;
      case 'monkey': // Son Goku: gorilla face — heavy brow ridge, flat nostrils on a muzzle, flared cheek fur, fangs
        s += body(['M232,182C224,130 236,96 254,76C252,118 256,150 264,174Z', 'M328,182C336,130 324,96 306,76C308,118 304,150 296,174Z']);
        // gorilla skull: low sagittal crest, wide jaw, shaggy cheek fur
        hd = 'M196,226C188,178 230,148 280,146C330,148 372,178 364,226C392,262 396,318 360,350C336,374 312,380 280,380C248,380 224,374 200,350C164,318 168,262 196,226Z';
        var tufts = 'M192,250L148,236L176,268L136,280L178,296L146,318L190,320L172,346L214,338ZM368,250L412,236L384,268L424,280L382,296L414,318L370,320L388,346L346,338Z';
        s += body([tufts, hd, 'M252,152L262,118L276,148L286,112L296,148L312,120L314,156Z']);
        if (isHex(a.maneColor)) { // e.g. Enma: white mane / beard framing the face
          var mc = col(a.maneColor), beardM = 'M206,300C210,350 240,388 280,394C320,388 350,350 354,300L340,330L326,316L314,350L296,330L280,366L264,330L246,350L234,316L220,330Z';
          s += outlineOf([tufts, beardM], inkOf(mc), L * 1.6) + cel(X, tufts, mc, dk(mc, 0.18), 0, 6) + cel(X, beardM, mc, dk(mc, 0.18), 0, 6);
        }
        var face = 'M216,228C228,204 332,204 344,228C352,262 346,286 336,300L224,300C214,286 208,262 216,228Z';
        s += path(face, dk(bc, 0.42), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"');
        s += beastEye(X, 248, 252, 30, 16, -1, 'beast', ec, '#1a0a08') + beastEye(X, 312, 252, 30, 16, 1, 'beast', ec, '#1a0a08');
        s += path('M200,236Q242,204 280,226Q318,204 360,236L356,252Q318,226 280,246Q242,226 204,252Z', dk(bc, 0.62), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"');
        var muz = 'M220,300C222,268 338,268 340,300C350,344 322,372 280,374C238,372 210,344 220,300Z';
        s += path(muz, mix(bc, '#d89870', 0.5), 'stroke="' + ink + '" stroke-width="' + r1(L * 1.2) + '"');
        s += path('M252,284Q280,270 308,284Q304,298 280,300Q256,298 252,284Z', dk(bc, 0.3)) + ell(268, 290, 7, 4.5, '#1a0606') + ell(292, 290, 7, 4.5, '#1a0606');
        s += path('M232,316Q280,336 328,316Q320,362 280,364Q240,362 232,316Z', '#3a0a10', 'stroke="#1a0606" stroke-width="' + r1(L) + '"');
        s += path('M240,320l7,20l7,-17ZM306,320l7,17l7,-20Z', '#fff', 'stroke="#2a0a0a" stroke-width="1"') + path('M252,362l5,-14l5,12ZM298,362l5,-12l5,14Z', '#f4ece0', 'stroke="#2a0a0a" stroke-width="1"');
        break;
      case 'horse': // Kokuo: white horse body with a dolphin's head — rounded melon brow, bottlenose snout, swept-back horns
        s += path('M250,160C220,190 210,260 230,330L250,330C236,270 240,200 262,166Z', ac, 'stroke="' + inkOf(ac) + '" stroke-width="' + r1(L) + '"');
        s += body(['M238,172C196,132 184,90 196,44C212,94 236,126 258,152Z', 'M322,172C364,132 376,90 364,44C348,94 324,126 302,152Z', 'M244,182C214,174 196,154 190,128C212,148 234,160 254,168Z', 'M316,182C346,174 364,154 370,128C348,148 326,160 306,168Z']);
        hd = 'M210,214C200,156 360,156 350,214C362,256 350,296 330,318L230,318C210,296 198,256 210,214Z';
        s += body([hd]);
        s += path('M224,206C232,174 328,174 336,206C312,188 248,188 224,206Z', lt(bc, 0.6), 'opacity="0.85"');
        s += line('M222,262Q280,284 338,262', dk(bc, 0.3), L * 1.4, 'opacity="0.7"');
        var snout = 'M242,300C240,278 320,278 318,300C322,340 306,366 280,368C254,366 238,340 242,300Z';
        s += outlineOf([snout], inkOf(bc), L * 2) + cel(X, snout, lt(bc, 0.3), dk(bc, 0.12), 5, 6);
        s += line('M226,318Q252,346 280,344Q308,346 334,318', inkOf(bc), L * 1.4) + path('M268,300Q280,292 292,300Q286,306 280,306Q274,306 268,300Z', dk(bc, 0.45));
        s += path('M252,290Q262,280 278,282', 'none', 'stroke="#fff" stroke-width="' + r1(L * 1.2) + '" stroke-linecap="round" opacity="0.8"');
        s += path('M214,236Q240,220 262,242Q238,252 214,236ZM346,236Q320,220 298,242Q322,252 346,236Z', ac);
        s += beastEye(X, 240, 240, 30, 18, -1, 'beast', ec) + beastEye(X, 320, 240, 30, 18, 1, 'beast', ec);
        break;
      case 'slug': // Saiken: glossy slime-white sea-slug — no neck, eye stalks, droopy eyes, tiny round mouth, dripping mucus
        hd = 'M188,292C180,206 228,162 280,162C332,162 380,206 372,292C368,342 334,380 280,384C226,380 192,342 188,292Z';
        s += line('M248,186Q236,150 226,122M312,186Q324,150 334,122', ink, L * 2.6) + line('M248,186Q236,150 226,122M312,186Q324,150 334,122', lt(bc, 0.2), L * 1.2);
        s += circ(226, 120, 12, lt(bc, 0.35), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') + circ(334, 120, 12, lt(bc, 0.35), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') + circ(222, 116, 4, '#fff') + circ(330, 116, 4, '#fff');
        s += body([hd]);
        s += path('M200,300C206,330 236,360 280,364C324,360 354,330 360,300C350,346 318,374 280,376C242,374 210,346 200,300Z', ac, 'opacity="0.35"');
        if (a.stripes) s += '<g clip-path="' + X.clip('<path d="' + hd + '"/>') + '">' + line('M206,236Q190,290 206,346M354,236Q370,290 354,346', ac, 9, 'opacity="0.8"') + '</g>'; // Katsuyu's blue flank stripes
        s += beastEye(X, 244, 262, 38, 26, -1, 'beast', '#2a3a40', '#f4fbfa') + beastEye(X, 316, 262, 38, 26, 1, 'beast', '#2a3a40', '#f4fbfa');
        // heavy, sleepy lids + a mantle ridge and freckles make it read as a soft mollusc rather than an alien
        s += path('M224,258Q244,232 264,258Q244,250 224,258ZM296,258Q316,232 336,258Q316,250 296,258Z', bc, 'stroke="' + ink + '" stroke-width="' + r1(L) + '"');
        s += path('M262,170Q280,150 298,170Q290,200 280,206Q270,200 262,170Z', dk(bc, 0.12), 'stroke="' + ink + '" stroke-width="' + r1(L * 0.8) + '" opacity="0.9"');
        [[214, 300, 5], [226, 318, 3.5], [346, 300, 5], [334, 318, 3.5], [300, 196, 4], [252, 204, 3]].forEach(function (q) { s += circ(q[0], q[1], q[2], dk(bc, 0.22), 'opacity="0.7"'); });
        s += ell(280, 326, 13, 9, '#6a2a3a', 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') + ell(280, 329, 7, 4, '#c86a7a');
        s += path('M206,330Q204,352 210,364Q216,352 214,334ZM350,336Q352,356 346,368Q340,356 342,338ZM262,376Q262,396 268,404Q274,394 272,378Z', lt(bc, 0.3), 'stroke="' + ink + '" stroke-width="' + r1(L * 0.6) + '" opacity="0.9"');
        s += path('M214,236C222,204 244,186 268,180C248,194 234,212 228,240Z', '#fff', 'opacity="0.7"') + circ(330, 200, 6, '#fff', 'opacity="0.6"') + circ(344, 214, 3, '#fff', 'opacity="0.6"');
        for (var bb = 0; bb < 6; bb++) s += circ(200 + bb * 34, 410 + (bb % 2) * 30, 7 + (bb % 3) * 3, '#e8fff8', 'opacity="0.55" stroke="' + ink + '" stroke-width="1"');
        break;
      case 'dog': { // ninken: Pakkun-style pug (default for darker coats) or a fluffy white Akamaru
        var pug = a.dogStyle ? a.dogStyle !== 'fluffy' : lum(bc) < 0.75;
        var earC = col(a.earColor, pug ? dk(bc, 0.45) : mix(bc, '#c08a5a', 0.55));
        var ear = pug ? 'M210,198C172,186 150,228 160,278C166,302 186,306 198,288C204,262 208,238 226,214Z' : 'M216,190C190,150 158,166 156,212C154,256 170,290 192,300C202,270 210,238 230,208Z';
        s += outlineOf([ear, mirrorD(ear)], inkOf(earC), L * 2.2) + cel(X, ear, earC, dk(earC, 0.3), -6, 6) + cel(X, mirrorD(ear), earC, dk(earC, 0.3), 6, 6);
        hd = 'M198,240C194,182 236,152 280,152C324,152 366,182 362,240C368,300 336,348 280,354C224,348 192,300 198,240Z';
        s += body([hd]);
        if (!pug) s += line('M206,290L188,300M210,306L192,320M354,290L372,300M350,306L368,320', bc, L * 2.4) + line('M206,290L188,300M210,306L192,320M354,290L372,300M350,306L368,320', ink, L * 0.6, 'opacity="0.5"');
        var mz = 'M230,288C228,260 254,250 280,250C306,250 332,260 330,288C332,326 308,344 280,344C252,344 228,326 230,288Z';
        s += path(mz, pug ? dk(bc, 0.5) : lt(bc, 0.4), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"');
        if (pug) s += line('M244,208Q262,198 280,206Q298,198 316,208M250,224Q266,218 280,222Q294,218 310,224M262,258Q280,250 298,258', dk(bc, 0.4), L * 1.1, 'opacity="0.8"');
        [[246, -1], [314, 1]].forEach(function (e) {
          var r = pug ? 13 : 9;
          s += circ(e[0], 244, r, '#1e140c', 'stroke="' + ink + '" stroke-width="' + r1(L * 0.8) + '"') + circ(e[0] - r * 0.35, 244 - r * 0.4, r * 0.32, '#fff');
          if (pug) s += path('M' + (e[0] - 15) + ',' + 236 + 'Q' + e[0] + ',' + 222 + ' ' + (e[0] + 15) + ',' + 236 + 'L' + (e[0] + 15) + ',' + 241 + 'Q' + e[0] + ',' + 232 + ' ' + (e[0] - 15) + ',' + 241 + 'Z', dk(bc, 0.1), 'stroke="' + ink + '" stroke-width="' + r1(L * 0.7) + '"');
          s += path('M' + (e[0] - 14 * e[1]) + ',' + 224 + 'Q' + (e[0]) + ',' + 214 + ' ' + (e[0] + 12 * e[1]) + ',' + 220, 'none', 'stroke="' + dk(bc, 0.5) + '" stroke-width="' + r1(L * 1.6) + '" stroke-linecap="round"');
        });
        s += path('M264,270Q280,260 296,270Q294,286 280,288Q266,286 264,270Z', '#141010', 'stroke="#000" stroke-width="' + r1(L * 0.6) + '"') + ell(274, 268, 4, 2.5, '#fff', 'opacity="0.6"');
        s += line('M280,288V300M262,306Q272,312 280,302Q288,312 298,306', '#1a0a0a', L * 1.1);
        if (!pug) s += path('M272,310Q280,330 288,310Z', '#e86a7a', 'stroke="#5a1a20" stroke-width="' + r1(L * 0.6) + '"');
        if (a.headband && a.headband !== 'none' && inVocab(a.headband, ART.headband)) {
          var hcl = col(a.headbandColor, '#1f2b4d');
          s += path('M200,192Q280,166 360,192L362,212Q280,186 198,212Z', hcl, 'stroke="' + inkOf(hcl) + '" stroke-width="' + r1(L) + '"') + metalPlate(X, 280, 192, 64, 26, a.headband, !!a.headbandSlash, L * 0.8);
        }
        break;
      }
      case 'beetle':
        s += body(['M262,176C256,124 266,84 290,60C290,104 300,140 298,176Z']);
        hd = 'M204,240C204,192 240,170 280,170C320,170 356,192 356,240C356,292 324,332 280,338C236,332 204,292 204,240Z';
        s += body([hd]);
        [[230, 236, -1], [330, 236, 1]].forEach(function (e) {
          var ed = ellD(e[0], e[1], 28, 32);
          s += path(ed, X.rad([[0, '#ffe08a'], [0.7, '#ff9a2a'], [1, '#b85a00']]), 'stroke="#1a0a00" stroke-width="' + r1(L * 1.2) + '"');
          var hx = ''; for (var hi = -2; hi <= 2; hi++) hx += 'M' + (e[0] - 28) + ',' + (e[1] + hi * 12) + 'h56M' + (e[0] + hi * 12) + ',' + (e[1] - 32) + 'v64';
          s += '<g clip-path="' + X.clip('<path d="' + ed + '"/>') + '">' + line(hx, '#b85a00', 1.2, 'opacity="0.5"') + '</g>' + circ(e[0] - 8, e[1] - 12, 6, '#fff', 'opacity="0.7"');
        });
        s += path('M250,320C240,350 250,372 270,380C262,360 262,344 268,330Z', dk(bc, 0.3), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"') + path('M310,320C320,350 310,372 290,380C298,360 298,344 292,330Z', dk(bc, 0.3), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"');
        break;
      case 'ox':
        var horn = col(a.hornColor, '#efe3c4');
        var h1 = 'M212,204C160,194 118,152 112,90C146,132 188,152 232,172Z', h2 = 'M348,204C400,194 442,152 448,90C414,132 372,152 328,172Z';
        s += outlineOf([h1, h2], '#3a2a10', L * 2.2) + cel(X, h1, horn, dk(horn, 0.25), 0, 8) + cel(X, h2, horn, dk(horn, 0.25), 0, 8);
        s += line('M150,150l12,-8M170,166l10,-10M410,150l-12,-8M390,166l-10,-10', dk(horn, 0.4), L);
        hd = 'M196,220C194,180 232,160 280,160C328,160 366,180 364,220C372,270 350,330 320,350C306,370 254,370 240,350C210,330 188,270 196,220Z';
        s += body([hd]);
        s += path('M236,300C246,284 314,284 324,300C330,330 306,352 280,352C254,352 230,330 236,300Z', lt(bc, 0.18));
        s += path('M206,222Q240,206 270,226L268,236Q238,222 208,234ZM354,222Q320,206 290,226L292,236Q322,222 352,234Z', dk(bc, 0.5));
        s += beastEye(X, 242, 244, 38, 20, -1, 'beast', ec) + beastEye(X, 318, 244, 38, 20, 1, 'beast', ec);
        s += ell(264, 318, 6, 5, '#1a0a0a') + ell(296, 318, 6, 5, '#1a0a0a') + path('M244,338l8,18l8,-16ZM300,340l8,16l8,-18Z', '#fff', 'stroke="#2a0a0a" stroke-width="1"');
        break;
      case 'juubi':
        for (var j = 0; j < 7; j++) { var jp = pol(280, 250, 180, -160 + j * 23.3), jb = pol(280, 250, 100, -166 + j * 23.3), jc = pol(280, 250, 100, -154 + j * 23.3); s += path('M' + PP(jb) + 'L' + PP(jp) + 'L' + PP(jc) + 'Z', dk(bc, 0.15), 'stroke="' + ink + '" stroke-width="' + r1(L * 1.2) + '"'); }
        hd = 'M180,250C170,170 226,130 280,130C334,130 390,170 380,250C384,320 350,370 280,380C210,370 176,320 180,250Z';
        s += body([hd]);
        s += line('M200,200Q230,240 220,290M360,200Q330,240 340,290M250,150Q260,180 250,200M310,150Q300,180 310,200', mix(bc, '#7a4aa0', 0.5), L * 1.5, 'opacity="0.8"');
        var je = 'M222,226Q280,170 338,226Q280,282 222,226Z';
        s += path(je, '#fbe8e0', 'stroke="#140608" stroke-width="' + r1(L * 1.6) + '"') + '<g clip-path="' + X.clip('<path d="' + je + '"/>') + '"><g transform="translate(280,226) scale(34)">' + irisUnit(X, eye === 'beast' ? 'rinne_sharingan' : eye, ec) + '</g></g>';
        s += path('M206,300Q280,330 354,300Q344,366 280,372Q216,366 206,300Z', '#3a0610', 'stroke="#140404" stroke-width="' + r1(L) + '"') + mouthTeeth(214, 346, 306, 12, 14);
        s += path('M226,356L236,340L246,356L256,342L266,358L276,342L286,358L296,342L306,358L316,340L326,356L334,346Q280,376 226,356Z', '#fffaf0', 'stroke="#2a0a0a" stroke-width="' + r1(L * 0.6) + '"');
        break;
      case 'toad':
        hd = 'M150,264C150,204 200,184 230,194C250,164 310,164 330,194C360,184 410,204 410,264C414,334 360,374 280,376C200,374 146,334 150,264Z';
        s += body([hd, circleD(226, 206, 36), circleD(334, 206, 36)]);
        s += path('M180,300C200,340 240,356 280,356C320,356 360,340 380,300C370,350 330,372 280,374C230,372 190,350 180,300Z', lt(bc, 0.3), 'opacity="0.85"');
        [[226, 206], [334, 206]].forEach(function (e) {
          var ek = eye === 'beast' ? 'sage' : eye;
          s += circ(e[0], e[1], 26, '#fff6d8', 'stroke="#140608" stroke-width="' + r1(L * 1.4) + '"') + '<g transform="translate(' + e[0] + ',' + e[1] + ') scale(21)">' + irisUnit(X, ek, ec) + '</g>' + circ(e[0] - 7, e[1] - 8, 5, '#fff', 'opacity="0.9"') +
            path('M' + (e[0] - 30) + ',' + (e[1] - 6) + 'Q' + e[0] + ',' + (e[1] - 40) + ' ' + (e[0] + 30) + ',' + (e[1] - 6) + 'Q' + e[0] + ',' + (e[1] - 26) + ' ' + (e[0] - 30) + ',' + (e[1] - 6) + 'Z', dk(bc, 0.2), 'stroke="#140608" stroke-width="' + r1(L) + '"');
        });
        s += line('M168,296Q280,340 392,296', '#2a0a06', L * 1.6);
        s += path('M188,166Q206,150 226,160L222,170Q206,164 192,176ZM372,166Q354,150 334,160L338,170Q354,164 368,176Z', ac, 'stroke="' + inkOf(ac) + '" stroke-width="' + r1(L * 0.6) + '"');
        s += path('M196,250Q210,270 236,262M364,250Q350,270 324,262', 'none', 'stroke="' + ac + '" stroke-width="' + r1(L * 2.2) + '"');
        if (lum(ac) > 0.7) s += path('M240,330Q260,350 280,344Q300,350 320,330Q300,372 280,368Q260,372 240,330Z', ac, 'stroke="' + inkOf(ac) + '" stroke-width="' + r1(L * 0.6) + '"');
        s += ell(266, 270, 4, 3, '#1a0a0a') + ell(294, 270, 4, 3, '#1a0a0a');
        if (a.wrinkles) s += line('M190,236Q200,250 196,266M370,236Q360,250 364,266M244,286Q262,296 280,292Q298,296 316,286M214,316Q232,330 252,330M346,316Q328,330 308,330', dk(bc, 0.45), L * 0.9, 'opacity="0.7"');
        if (isHex(a.brows)) { // old sage: bushy white brows sweeping out over the eye bumps
          var bw = col(a.brows), tuft = 'M196,180C202,154 230,148 252,160C266,168 270,180 266,186C254,176 238,174 224,178L206,196L210,182L186,198Z';
          s += outlineOf([tuft, mirrorD(tuft)], inkOf(bw), L * 1.6) + cel(X, tuft, bw, dk(bw, 0.18), 3, 4) + cel(X, mirrorD(tuft), bw, dk(bw, 0.18), -3, 4);
          s += line('M206,170Q228,160 250,168M354,170Q332,160 310,168', dk(bw, 0.25), L * 0.6, 'opacity="0.7"');
        }
        if (a.accessory === 'kiseru') s += seg(330, 318, 430, 290, 7, '#5a3a1a', '#1a0a00', L) + path('M422,276l18,-4l6,24l-18,6Z', '#8a6a3a', 'stroke="#1a0a00" stroke-width="' + r1(L) + '"');
        break;
      case 'snake':
        var coil = 'M110,650C90,560 150,500 230,510C330,524 420,480 440,420C460,520 420,600 330,600C250,600 200,600 190,650Z';
        s += body([coil], 0, 10);
        var sc2 = ''; for (var q = 0; q < 8; q++) sc2 += 'M' + (150 + q * 36) + ',560q14,-16 28,0';
        s += '<g clip-path="' + X.clip('<path d="' + coil + '"/>') + '">' + line(sc2, dk(bc, 0.4), L, 'opacity="0.6"') + path('M120,650C120,600 160,570 230,572C300,580 380,560 420,520C410,580 360,620 300,630L200,650Z', lt(bc, 0.35), 'opacity="0.6"') + '</g>';
        s += body(['M236,330C246,400 270,460 300,520L340,500C330,440 320,380 320,330Z'], 6, 0);
        hd = 'M196,246C192,192 236,158 286,162C338,166 376,196 372,250C368,302 330,330 304,352L258,352C228,330 200,298 196,246Z';
        s += body([hd]);
        s += path('M206,214Q240,186 272,212L268,224Q240,204 212,228ZM364,216Q330,188 298,212L302,224Q330,204 358,230Z', dk(bc, 0.45));
        s += path('M226,170L206,120L248,162ZM346,172L366,122L326,164Z', lt(bc, 0.2), 'stroke="' + ink + '" stroke-width="' + r1(L) + '"');
        s += beastEye(X, 240, 236, 44, 22, -1, 'snake', ec) + beastEye(X, 330, 238, 44, 22, 1, 'snake', ec);
        s += path('M236,300Q284,316 334,298Q320,340 284,344Q252,340 236,300Z', '#4a0a20', 'stroke="#14040a" stroke-width="' + r1(L) + '"') + path('M246,302l6,22l6,-20ZM314,302l6,20l6,-22Z', '#fff', 'stroke="#2a0a0a" stroke-width="1"');
        s += line('M284,330L284,372M284,372l-10,12M284,372l10,12', '#c8102e', L * 1.6);
        s += ell(270, 280, 4, 3, '#1a0a0a') + ell(298, 280, 4, 3, '#1a0a0a');
        break;
    }
    return { s: s, hd: hd };
  }
  var drawBeast = function (X, c, a, mode) {
    var L = X.lw, b = pick(a.beast, ART.beast, 'fox'), bc = col(a.bodyColor, '#ff7a1a'), ac = col(a.accentColor, dk(bc, 0.6));
    var n = a.tails != null && isFinite(+a.tails) ? clamp(Math.round(+a.tails), 0, 10) : BEAST_TAILS[b];
    var P_ = { back: '', body: '', head: '', front: '', beast: true };
    P_.back = beastTails(X, b, n, bc, ac, L);
    if (b !== 'snake') {
      var bd = 'M80,660C70,540 150,440 280,430C410,440 490,540 480,660Z';
      var arms = ['M84,660C70,560 110,480 170,470L214,660Z', 'M476,660C490,560 450,480 390,470L346,660Z'];
      if (b === 'toad') { bd = 'M60,660C50,520 150,410 280,400C410,410 510,520 500,660Z'; arms = []; }
      if (b === 'slug') { bd = 'M70,660C60,560 120,470 280,450C440,470 500,560 490,660Z'; arms = []; }
      if (b === 'beetle') {
        bd = 'M150,660C140,560 190,470 280,460C370,470 420,560 410,660Z';
        arms = ['M170,520L80,560L60,640L84,644L100,580L180,560Z', 'M390,520L480,560L500,640L476,644L460,580L380,560Z'];
      }
      if (b === 'turtle') { // domed shell ringed with coral spikes, flippers in front
        bd = 'M24,660C24,470 140,346 280,336C420,346 536,470 536,660Z';
        arms = ['M58,660C42,598 84,544 146,546C186,562 200,612 188,660Z', mirrorD('M58,660C42,598 84,544 146,546C186,562 200,612 188,660Z')];
        var cor = col(a.coralColor, '#efe2cc'), sp = '';
        for (var ti = 0; ti < 11; ti++) {
          var ta = -168 + ti * 15.6, rb = [280 + 250 * Math.cos(ta * Math.PI / 180), 660 + 318 * Math.sin(ta * Math.PI / 180)], ln = 66 + (ti % 3) * 22;
          var tip = pol(rb[0], rb[1], ln, ta), b0 = pol(rb[0], rb[1], 18, ta - 90), b1 = pol(rb[0], rb[1], 18, ta + 90), br = pol(rb[0], rb[1], ln * 0.55, ta), bt = pol(br[0], br[1], ln * 0.5, ta + (ti % 2 ? 40 : -40));
          sp += 'M' + PP(b0) + 'L' + PP(tip) + 'L' + PP(b1) + 'Z' + 'M' + PP(pol(br[0], br[1], 7, ta - 90)) + 'L' + PP(bt) + 'L' + PP(pol(br[0], br[1], 7, ta + 90)) + 'Z';
        }
        P_.back += path(sp, cor, 'stroke="' + inkOf(bc) + '" stroke-width="' + r1(L * 1.4) + '" stroke-linejoin="round"');
      }
      var neck = { slug: 1, toad: 1 }[b] ? null : 'M228,330C224,384 206,432 170,486L390,486C354,432 336,384 332,330Z';
      P_.body = outlineOf([bd].concat(arms, neck ? [neck] : []), inkOf(bc), L * 2.2) + (neck ? cel(X, neck, bc, dk(bc, 0.3), 16, 0) : '') + cel(X, bd, bc, dk(bc, 0.3), 30, 10);
      if (b === 'fox' || b === 'monkey' || b === 'tanuki' || b === 'ox') {
        var fur = '';
        for (var fi = 0; fi < 6; fi++) { fur += 'M' + P(110 + fi * 18, 520 - fi * 14) + 'l' + r1(-30 + fi * 3) + ',' + r1(-18 - fi * 2) + 'l' + r1(34 - fi * 2) + ',' + r1(6) + 'Z'; fur += 'M' + P(450 - fi * 18, 520 - fi * 14) + 'l' + r1(30 - fi * 3) + ',' + r1(-18 - fi * 2) + 'l' + r1(-34 + fi * 2) + ',' + r1(6) + 'Z'; }
        P_.body += path(fur, bc, 'stroke="' + inkOf(bc) + '" stroke-width="' + r1(L) + '" stroke-linejoin="round"');
      }
      if (b === 'turtle') { // hexagonal scutes on the shell
        var sc3 = '';
        [[150, 470], [280, 420], [410, 470], [90, 590], [470, 590]].forEach(function (q) { var hx_ = ''; for (var hk = 0; hk < 6; hk++) hx_ += (hk ? 'L' : 'M') + PP(pol(q[0], q[1], 44, hk * 60 + 30)); sc3 += hx_ + 'Z'; });
        P_.body += '<g clip-path="' + X.clipPaths([bd]) + '">' + path(sc3, lt(bc, 0.12), 'stroke="' + inkOf(bc) + '" stroke-width="' + r1(L * 1.1) + '" opacity="0.9"') + '</g>';
      }
      arms.forEach(function (d) { P_.body += cel(X, d, bc, dk(bc, 0.3), 14, 6); });
      if (b === 'beetle') P_.body += line('M170,540Q280,510 390,540M160,590Q280,560 400,590M280,470V660', dk(bc, 0.4), L * 1.2);
      else if (b === 'slug') {
        P_.body += path('M140,600C170,540 230,520 280,520C330,520 390,540 420,600', 'none', 'stroke="' + lt(bc, 0.5) + '" stroke-width="10" opacity="0.6" stroke-linecap="round"');
        if (a.stripes) P_.body += '<g clip-path="' + X.clipPaths([bd]) + '">' + line('M176,486Q120,560 108,660M384,486Q440,560 452,660', ac, 18, 'opacity="0.8"') + '</g>';
      }
      else P_.body += path('M200,660C200,560 236,500 280,496C324,500 360,560 360,660Z', lt(bc, b === 'fox' || b === 'monkey' ? 0.2 : 0.12), 'opacity="0.7"');
      if (b === 'monkey') { // bony white spurs on the shoulders
        var spur = 'M118,528L104,452L140,504L150,446L166,512Z';
        P_.body += path(spur + mirrorD(spur), '#f2ead8', 'stroke="#3a1a10" stroke-width="' + r1(L * 1.2) + '" stroke-linejoin="round"');
      }
      if (b === 'dog' && isHex(a.vestColor)) { // ninken vest
        var vc = col(a.vestColor), vd = 'M96,660C92,566 150,482 222,470L280,552L338,470C410,482 468,566 464,660Z';
        P_.body += outlineOf([vd], inkOf(vc), L * 2) + cel(X, vd, vc, dk(vc, 0.3), 16, 8) + line('M222,470L280,552L338,470', lt(vc, 0.35), L * 1.2, 'opacity="0.8"');
      }
      if (b === 'toad' && isHex(a.cape)) { // elder sage's cape tied at the throat
        var cc = col(a.cape), cd = 'M30,660C34,540 130,446 236,420L274,458C236,520 222,600 226,660Z', cd2 = mirrorD(cd);
        P_.body += outlineOf([cd, cd2], inkOf(cc), L * 2) + cel(X, cd, cc, dk(cc, 0.32), 20, 8) + cel(X, cd2, cc, dk(cc, 0.32), 20, 8) + line('M120,560Q160,600 150,660M440,560Q400,600 410,660', dk(cc, 0.4), L, 'opacity="0.6"');
        P_.body += path('M226,416L280,462L334,416L324,406L280,440L236,406Z', lt(cc, 0.3), 'stroke="' + inkOf(cc) + '" stroke-width="' + r1(L) + '"') + line('M262,470Q280,486 298,470', '#d8b040', L * 1.6) + circ(280, 462, 9, '#d8b040', 'stroke="#4a3a10" stroke-width="' + r1(L * 0.8) + '"');
      }
      if ({ fox: 1, monkey: 1, tanuki: 1, ox: 1, juubi: 1, cat: 1, dog: 1 }[b]) {
        [[150, 1], [410, -1]].forEach(function (pw) {
          var px = pw[0], sg = pw[1];
          var pd = 'M' + (px - 64) + ',660C' + (px - 70) + ',596 ' + (px - 30) + ',560 ' + px + ',562C' + (px + 34) + ',564 ' + (px + 70) + ',598 ' + (px + 64) + ',660Z';
          P_.body += outlineOf([pd], inkOf(bc), L * 2) + cel(X, pd, bc, dk(bc, 0.3), 10 * sg, 8);
          for (var ci = 0; ci < 4; ci++) {
            var cx_ = px - 42 + ci * 28, cy_ = 572 + Math.abs(ci - 1.5) * 8;
            P_.body += path('M' + (cx_ - 8) + ',' + (cy_ + 6) + 'Q' + (cx_ - 4) + ',' + (cy_ - 22) + ' ' + (cx_ + 4 * sg) + ',' + (cy_ - 30) + 'Q' + (cx_ + 4) + ',' + (cy_ - 12) + ' ' + (cx_ + 8) + ',' + (cy_ + 6) + 'Z', '#f4ece0', 'stroke="#2a1a10" stroke-width="' + r1(L * 0.9) + '"');
          }
          P_.body += line('M' + (px - 30) + ',600Q' + (px - 26) + ',620 ' + (px - 30) + ',640M' + px + ',598Q' + (px + 4) + ',620 ' + px + ',640M' + (px + 30) + ',600Q' + (px + 32) + ',620 ' + (px + 28) + ',640', inkOf(bc), L * 0.7, 'opacity="0.6"');
        });
      }
      if (b === 'cat') P_.back += path(flameRow(70, 490, 470, 120, 9, 9), lt(bc, 0.35), 'opacity="0.8"') + path(flameRow(110, 450, 470, 80, 7, 19), lt(bc, 0.6), 'opacity="0.6"');
      P_.sil = [bd].concat(arms);
    } else P_.sil = [];
    var H = beastHead(X, b, bc, ac, a, L);
    P_.head = H.s;
    P_.silHead = [];
    if (H.hd) P_.sil.push(H.hd);
    P_.avatarVB = { toad: '130 120 300 300', snake: '140 110 290 290', horse: '146 90 270 270', juubi: '130 100 300 300', turtle: '140 120 280 280', beetle: '146 96 270 270' }[b] || '140 110 280 280';
    return P_;
  };

  /* ======================================================================
   * 11. aura (bust only)
   * ==================================================================== */
  function auraColor(c, a) {
    if (a && isHex(a.aura)) return col(a.aura);
    var el = own(NG.ELEMENTS, c.element);
    if (el) return el.color;
    var f = own(NG.FACTIONS, c.faction);
    return f ? f.color : '#7fb2ff';
  }
  function tongue(bx, by, h, w, lean) {
    return 'M' + P(bx - w / 2, by) + 'C' + P(bx - w * 0.75, by - h * 0.35) + ' ' + P(bx + lean * 0.2 - w * 0.55, by - h * 0.62) + ' ' + P(bx + lean, by - h) +
      'C' + P(bx + lean * 0.35 + w * 0.2, by - h * 0.62) + ' ' + P(bx + w * 0.75, by - h * 0.4) + ' ' + P(bx + w / 2, by) + 'Z';
  }
  function renderAura(X, c, a, sil, silHead) {
    var ac = auraColor(c, a), R = rng(hash(c.id || 'x') ^ 0x9e37), s = '', i;
    s += ell(280, 320, 300, 340, X.rad([[0, lt(ac, 0.25), 0.7], [0.45, ac, 0.3], [1, ac, 0]]));
    // light rays
    var rays = '';
    for (i = 0; i < 16; i++) {
      var an = -180 + i * 12 + R() * 8, sp = 1.6 + R() * 2.2, q0 = pol(280, 300, 640, an - sp), q1 = pol(280, 300, 640, an + sp);
      rays += 'M280,300L' + PP(q0) + 'L' + PP(q1) + 'Z';
    }
    s += path(rays, X.rad([[0, lt(ac, 0.7), 0.38], [1, ac, 0]], 280, 300, 420, null, null, true));
    // chakra flame tongues hugging the silhouette
    var fl = '', core = '';
    var spots = [[96, 470, 250, -40], [150, 420, 300, -26], [204, 360, 280, -12], [356, 360, 290, 14], [410, 420, 310, 28], [466, 470, 250, 42], [280, 300, 260, 0]];
    for (i = 0; i < spots.length; i++) {
      var sp_ = spots[i], hh = sp_[2] * (0.8 + R() * 0.35), ww = 74 + R() * 30;
      fl += tongue(sp_[0], sp_[1] + 120, hh + 120, ww, sp_[3] * 1.4);
      core += tongue(sp_[0], sp_[1] + 110, (hh + 110) * 0.7, ww * 0.42, sp_[3]);
    }
    s += path(fl, X.lin([[0, ac, 0], [0.35, ac, 0.55], [1, ac, 0.75]]), 'opacity="0.75"');
    s += path(core, X.lin([[0, lt(ac, 0.6), 0], [0.4, lt(ac, 0.55), 0.5], [1, lt(ac, 0.4), 0.6]]), 'opacity="0.7"');
    // speed lines
    var sl = '';
    for (i = 0; i < 18; i++) {
      var a2 = R() * 360, r0 = 250 + R() * 50, r2 = r0 + 60 + R() * 110, p0 = pol(280, 300, r0, a2), p1 = pol(280, 300, r2, a2);
      sl += 'M' + PP(p0) + 'L' + PP(p1);
    }
    s += line(sl, lt(ac, 0.7), 2, 'opacity="0.35"');
    // glowing silhouette rim
    if (sil && sil.length) {
      var st = '" fill="' + ac + '" stroke="' + lt(ac, 0.35) + '" stroke-width="24" stroke-linejoin="round"/>';
      s += '<g filter="' + X.blur(8) + '" opacity="0.85"><path d="' + sil.join('') + st + (silHead && silHead.length ? '<path transform="' + HT + '" d="' + silHead.join('') + st : '') + '</g>';
    }
    s += elementParticles(X, c, ac, R);
    if (a && (a.wings || c.id === 'choji_butterfly')) s += chakraWings(X, ac);
    // rarity flourish (gacha convention): UR halo + gold sparkles, SSR sparkles
    var RR = own(NG.RARITIES, c.rarity), ro = (RR && RR.order) || 0;
    if (ro >= 4) s += circ(282, 214, 150, 'none', 'stroke="' + lt(ac, 0.7) + '" stroke-width="4" opacity="0.75"') + circ(282, 214, 158, 'none', 'stroke="#fff3c0" stroke-width="1.5" opacity="0.6"') + circ(282, 214, 170, 'none', 'stroke="#ffe08a" stroke-width="2" stroke-dasharray="2 9" opacity="0.9"');
    if (ro >= 3) {
      var sp = '';
      for (var k = 0; k < (ro >= 4 ? 22 : 10); k++) {
        var sx = 30 + R() * 500, sy = 40 + R() * 560, sz = 2.5 + R() * (ro >= 4 ? 6 : 4);
        sp += 'M' + P(sx, sy - sz * 2) + 'L' + P(sx + sz * 0.45, sy - sz * 0.45) + 'L' + P(sx + sz * 2, sy) + 'L' + P(sx + sz * 0.45, sy + sz * 0.45) + 'L' + P(sx, sy + sz * 2) + 'L' + P(sx - sz * 0.45, sy + sz * 0.45) + 'L' + P(sx - sz * 2, sy) + 'L' + P(sx - sz * 0.45, sy - sz * 0.45) + 'Z';
      }
      s += path(sp, ro >= 4 ? '#fff0b0' : '#ffffff', 'opacity="0.85"');
    }
    return s;
  }
  function chakraWings(X, ac) {
    var g = X.lin([[0, lt(ac, 0.7), 0.85], [1, ac, 0.35]], 0, 0, 1, 1), o = '';
    var up = 'M270,380C200,220 60,120 20,200C0,260 60,330 150,360C200,376 240,384 270,392Z', lo = 'M270,400C200,420 110,470 100,540C96,590 160,600 210,540C240,500 260,450 270,410Z';
    [up, lo].forEach(function (d) {
      o += path(d, g, 'stroke="' + lt(ac, 0.8) + '" stroke-width="3"') + path(d, g, 'stroke="' + lt(ac, 0.8) + '" stroke-width="3" transform="translate(560,0) scale(-1,1)"');
    });
    o += line('M270,384Q150,250 60,210M270,388Q160,330 80,300M270,404Q190,460 140,540', lt(ac, 0.85), 2, 'opacity="0.8"');
    o += '<g transform="translate(560,0) scale(-1,1)">' + line('M270,384Q150,250 60,210M270,388Q160,330 80,300M270,404Q190,460 140,540', lt(ac, 0.85), 2, 'opacity="0.8"') + '</g>';
    return '<g opacity="0.9">' + o + '</g>';
  }
  // light from the top-left: soft volume gradient + aura-coloured rim light on the lit outer edges (mask = union minus shifted union)
  Ctx.prototype.mask = function (inner) {
    var id = this.uid();
    this.defs.push('<mask id="' + id + '" maskUnits="userSpaceOnUse" x="-100" y="-100" width="800" height="900">' + inner + '</mask>');
    return 'url(#' + id + ')';
  };
  function volume(X, list, ac, xf, soft) {
    if (!list || !list.length) return '';
    var d = list.join(''), o = '';
    var cp = X.clipPaths(list);
    o += '<g clip-path="' + cp + '">' + path(d, X.lin([[0, '#ffffff', soft ? 0.05 : 0.1], [0.45, '#ffffff', 0], [1, '#000018', soft ? 0.12 : 0.26]], 0, 0, 1, 1)) + '</g>';
    if (ac) {
      var m = X.mask('<path d="' + d + '" fill="#fff"/><path d="' + d + '" fill="#000" transform="translate(7,4)"/>');
      o += '<g mask="' + m + '"><rect x="0" y="0" width="560" height="660" fill="' + lt(ac, 0.6) + '" opacity="0.7"/></g>';
    }
    return xf ? '<g transform="' + HT + '">' + o + '</g>' : o;
  }
  function elementParticles(X, c, ac, R) {
    var el = c.element, s = '', i, x, y;
    if (el === 'lightning') {
      for (i = 0; i < 4; i++) {
        x = 60 + R() * 440; y = 80 + R() * 420; var d = 'M' + P(x, y);
        for (var k = 0; k < 5; k++) { x += (R() - 0.5) * 50; y += 18 + R() * 22; d += 'L' + P(x, y); }
        s += line(d, '#ffffff', 3, 'opacity="0.85"') + line(d, ac, 7, 'opacity="0.35"');
      }
    } else if (el === 'fire') {
      for (i = 0; i < 14; i++) { x = 40 + R() * 480; y = 60 + R() * 520; s += circ(x, y, 2 + R() * 4, i % 2 ? '#ffd54f' : '#ff7b00', 'opacity="' + r1(0.5 + R() * 0.5) + '"'); }
    } else if (el === 'wind') {
      for (i = 0; i < 5; i++) { x = 40 + R() * 460; y = 80 + R() * 440; s += line('M' + P(x, y) + 'q40,-30 90,-6', '#e6fff6', 3, 'opacity="0.6"'); }
    } else if (el === 'water') {
      for (i = 0; i < 12; i++) { x = 40 + R() * 480; y = 60 + R() * 520; s += path('M' + P(x, y - 8) + 'q6,8 0,12q-6,-4 0,-12Z', '#b3e5fc', 'opacity="0.7"'); }
    } else if (el === 'earth') {
      for (i = 0; i < 8; i++) { x = 40 + R() * 480; y = 300 + R() * 300; s += path('M' + P(x, y) + 'l10,-8l10,6l-4,10l-12,2Z', '#8d6e63', 'opacity="0.8"'); }
    } else if (el === 'yin') {
      for (i = 0; i < 6; i++) { x = 40 + R() * 480; y = 100 + R() * 460; s += circ(x, y, 10 + R() * 18, '#2a1a40', 'opacity="0.35"'); }
    } else if (el === 'yang') {
      for (i = 0; i < 12; i++) { x = 40 + R() * 480; y = 60 + R() * 520; s += path('M' + P(x, y - 7) + 'L' + P(x + 2, y - 2) + 'L' + P(x + 7, y) + 'L' + P(x + 2, y + 2) + 'L' + P(x, y + 7) + 'L' + P(x - 2, y + 2) + 'L' + P(x - 7, y) + 'L' + P(x - 2, y - 2) + 'Z', '#fff8d0', 'opacity="0.85"'); }
    }
    return s;
  }

  /* ======================================================================
   * 12. composition + public API
   * ==================================================================== */
  var cache = Object.create(null);
  function memo(key, fn) {
    var v = cache[key];
    if (v === undefined) { v = fn(); cache[key] = v; }
    return v;
  }
  function resolve(c) {
    if (typeof c === 'string') return own(NG.CHAR_MAP, c) || { id: c };
    return c && typeof c === 'object' ? c : { id: '_none' };
  }
  function cid(c) { return c.id || ('h' + hash(JSON.stringify(c.art || {}))); }
  function artOf(c) {
    var a = c && c.art;
    if (!a || typeof a !== 'object') return GENERIC;
    return a;
  }
  function svgOpen(vb, w, h, extra) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" width="' + w + '" height="' + h + '"' + (extra || '') + '>';
  }
  function finish(X, vb, w, h, body, extra) {
    return svgOpen(vb, w, h, extra) + (X.defs.length ? '<defs>' + X.defs.join('') + '</defs>' : '') + body + '</svg>';
  }
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { if (root.console) console.warn('[NG.art]', e && e.message); return fallback(); }
  }
  function drawCharacter(c, X, mode) {
    var a = artOf(c);
    if (a.type === 'beast' && drawBeast) return drawBeast(X, c, a, mode);
    var p = humanParts(c, a, X, mode);
    return p;
  }

  function bustSVG(c, w, h) {
    var X = new Ctx('b' + (hash(cid(c)) % 46656).toString(36) + '_', 3);
    var p = drawCharacter(c, X, 'bust');
    var ac = auraColor(c, artOf(c));
    var body = renderAura(X, c, artOf(c), p.sil, p.silHead) + p.back + p.body + p.head + (p.beast ? '' : volume(X, p.silHeadV || [], ac, true, true)) + p.front;
    return finish(X, '0 0 560 640', w, h, body, ' preserveAspectRatio="xMidYMax meet"');
  }
  function avatarSVG(c, size) {
    var s = size / 280;
    var X = new Ctx('a' + (hash(cid(c)) % 46656).toString(36) + '_', clamp(1.2 / s, 3, 6.5));
    var p = drawCharacter(c, X, 'avatar');
    var vb = p.avatarVB || '141 82 280 280';
    var body = p.back + p.body + p.head + p.front;
    return finish(X, vb, size, size, body);
  }

  function toURL(svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }
  function urlMemo(key, fn) { return memo('U' + key, function () { return toURL(fn()); }); }

  A.avatar = function (c, size) {
    c = resolve(c); size = dim(size, 128);
    return memo('av|' + cid(c) + '|' + size, function () { return safe(function () { return avatarSVG(c, size); }, function () { return avatarSVG({ id: '_generic' }, size); }); });
  };
  A.avatarURL = function (c, size) { c = resolve(c); size = dim(size, 128); return urlMemo('av|' + cid(c) + '|' + size, function () { return A.avatar(c, size); }); };
  A.bust = function (c, w, h) {
    c = resolve(c); w = dim(w, 560); h = dim(h, 640);
    return memo('bu|' + cid(c) + '|' + w + 'x' + h, function () { return safe(function () { return bustSVG(c, w, h); }, function () { return bustSVG({ id: '_generic' }, w, h); }); });
  };
  A.bustURL = function (c, w, h) { c = resolve(c); w = dim(w, 560); h = dim(h, 640); return urlMemo('bu|' + cid(c) + '|' + w + 'x' + h, function () { return A.bust(c, w, h); }); };
  /* ======================================================================
   * 13. skill icons (100×100 design space)
   * ==================================================================== */
  var EK = '#160c1c';
  function E(d, fill, extra) {
    var st = 'stroke="' + EK + '" ', sw = 'stroke-width="3" ';
    if (extra && /(^|\s)stroke="/.test(extra)) st = '';
    if (extra && /stroke-width="/.test(extra)) sw = '';
    return '<path d="' + d + '" fill="' + fill + '" ' + st + sw + 'stroke-linejoin="round" stroke-linecap="round"' + (extra ? ' ' + extra : '') + '/>';
  }
  function EL(d, stroke, w, extra) { return '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + w + '" stroke-linejoin="round" stroke-linecap="round"' + (extra ? ' ' + extra : '') + '/>'; }
  function eyeKindOf(c) {
    var a = artOf(c), k = [a.eyeL, a.eyeR, a.eyes];
    for (var i = 0; i < k.length; i++) if (k[i] && (DOJ[k[i]] || k[i] === 'sage' || k[i] === 'six_paths' || k[i] === 'kurama' || k[i] === 'rinne_sharingan')) return k[i];
    if (a.type === 'beast') return a.beast === 'juubi' ? 'rinne_sharingan' : 'beast';
    return null;
  }
  function bigEye(X, kind, color) {
    var d = 'M8,52Q50,8 92,52Q50,92 8,52Z';
    return E(d, '#fbf6f0') + '<g clip-path="' + X.clip('<path d="' + d + '"/>') + '"><g transform="translate(50,52) scale(27)">' + irisUnit(X, kind, color) + '</g>' + circ(40, 42, 5, '#fff', 'opacity="0.85"') + '</g>' + EL(d, EK, 3.5);
  }
  function fxEmblem(X, fx, c, F) {
    var c1 = F.c1, c2 = F.c2, W = '#ffffff', o = '';
    var ek = eyeKindOf(c);
    switch (fx) {
      case 'fire': return E('M50,10C60,30 78,40 76,62C74,82 62,92 50,92C36,92 24,82 24,64C24,50 32,44 34,30C40,42 44,48 50,50C54,38 48,24 50,10Z', X.lin([[0, '#fff3a0'], [0.5, '#ffb000'], [1, '#ff4a00']])) + path('M50,46C56,58 64,62 62,74C60,84 54,88 50,88C42,88 38,82 38,74C38,66 44,64 46,56C48,62 50,62 50,46Z', '#fff7c8');
      case 'wind': return E('M14,62C24,30 60,18 86,34C62,30 40,40 30,66Z', '#eafff6') + E('M24,80C40,56 70,52 90,64C70,62 52,70 40,86Z', '#bff5df') + E('M30,40C40,22 62,14 78,18C60,22 46,30 38,46Z', '#ffffff');
      case 'lightning': return E('M60,6L24,56H46L36,94L78,40H56Z', X.lin([[0, '#ffffff'], [1, '#bfe4ff']]));
      case 'water': return E('M8,72C18,40 50,28 72,38C88,46 88,70 72,72C62,73 56,62 64,56C52,52 40,60 34,76C30,88 14,88 8,72Z', X.lin([[0, '#e8f8ff'], [1, '#7cc8ff']])) + E('M72,14C78,24 82,28 82,34A10,10 0 0,1 62,34C62,28 66,24 72,14Z', '#e8f8ff');
      case 'earth': return E('M10,86L22,50L44,38L60,48L74,40L90,86Z', X.lin([[0, '#e8d6c6'], [1, '#9a7a60']])) + EL('M44,38L48,60L38,74M74,40L70,62L80,74M22,50L32,66', EK, 2.5) + E('M30,30L40,20L50,28L44,36Z', '#d8c4b0') + E('M66,22L74,14L82,24L74,30Z', '#d8c4b0');
      case 'wood': return E('M20,92L28,40L18,18L34,30L40,10L46,34L40,92Z', '#9a6a3a') + E('M52,92L58,30L52,8L66,26L74,12L72,38L66,92Z', '#b07a44') + E('M70,92L78,52L92,44L82,62L84,92Z', '#8a5a2a') + E('M30,40Q14,40 10,30Q24,26 30,34ZM72,38Q88,30 92,20Q78,22 70,32Z', '#7cc86a');
      case 'sand': return E('M6,80C22,50 46,70 62,46C70,34 86,30 94,38C84,40 76,50 70,62C56,86 28,72 6,88Z', X.lin([[0, '#fff0c8'], [1, '#d4a85a']])) + circ(30, 40, 4, '#fff0c8', 'stroke="' + EK + '" stroke-width="2"') + circ(44, 28, 3, '#fff0c8', 'stroke="' + EK + '" stroke-width="2"') + circ(22, 58, 3, '#fff0c8', 'stroke="' + EK + '" stroke-width="2"');
      case 'ice': for (var i = 0; i < 6; i++) o += E('M50,50L46,18L50,6L54,18Z', i % 2 ? '#e8f8ff' : '#bfe8ff', 'transform="rotate(' + i * 60 + ' 50 50)"'); return o + circ(50, 50, 8, '#fff', 'stroke="' + EK + '" stroke-width="2.5"');
      case 'lava': return E('M14,46C14,24 34,14 50,16C70,16 86,28 86,46C86,58 80,62 78,72C76,82 70,82 70,72C70,64 64,64 62,74C60,90 52,92 50,80C48,68 42,70 40,78C38,86 30,86 30,76C30,66 14,64 14,46Z', X.lin([[0, '#ffd27a'], [0.5, '#ff6a1a'], [1, '#c8200a']])) + path('M30,40C34,30 44,26 52,28', 'none', 'stroke="#fff4c0" stroke-width="5" stroke-linecap="round"');
      case 'boil': return circ(36, 62, 18, '#ffe0d6', 'stroke="' + EK + '" stroke-width="3"') + circ(64, 52, 14, '#fff', 'stroke="' + EK + '" stroke-width="3"') + circ(56, 78, 9, '#ffd0c0', 'stroke="' + EK + '" stroke-width="3"') + EL('M30,30C24,22 34,16 28,8M50,28C44,20 54,14 48,6M70,32C64,24 74,18 68,10', '#fff', 4);
      case 'scorch': return [[50, 26], [28, 66], [72, 66]].map(function (p) { return circ(p[0], p[1], 16, X.rad([[0, '#fffbe0'], [0.6, '#ffb000'], [1, '#ff6a00']]), 'stroke="' + EK + '" stroke-width="3"'); }).join('') + EL('M50,42L34,56M50,42L66,56M42,66H58', '#fff3e0', 3);
      case 'storm': return EL('M8,34Q30,24 50,34T92,34M8,52Q30,42 50,52T92,52M8,70Q30,60 50,70T92,70', EK, 9) + EL('M8,34Q30,24 50,34T92,34M8,52Q30,42 50,52T92,52M8,70Q30,60 50,70T92,70', '#e1f5fe', 5) + E('M54,14L40,46H52L46,86L66,40H54Z', '#fff');
      case 'dust': return E('M50,10L86,30V70L50,90L14,70V30Z', '#ffffff', 'opacity="0.95"') + EL('M14,30L50,50L86,30M50,50V90', EK, 2.5) + E('M50,36L64,44V60L50,68L36,60V44Z', '#cfd8dc') + circ(50, 52, 5, '#fff', 'filter="' + X.blur(2) + '"');
      case 'explosion': for (var e = 0; e < 12; e++) { var r = e % 2 ? 26 : 44, q = pol(50, 52, r, e * 30 - 90); o += (e ? 'L' : 'M') + PP(q); } return E(o + 'Z', X.rad([[0, '#ffffff'], [0.4, '#ffe066'], [1, '#ff6a3a']])) + circ(50, 52, 12, '#fff');
      case 'magnet': return E('M22,20H40V56A10,10 0 0,0 60,56V20H78V56A28,28 0 0,1 22,56Z', '#cfd8dc') + E('M22,20H40V32H22ZM60,20H78V32H60Z', '#e53935') + [18, 32, 68, 82].map(function (x, i) { return circ(x, 86 - (i % 2) * 6, 3, '#37474f'); }).join('');
      case 'yin': return E('M64,12A40,40 0 1,0 64,88A32,32 0 1,1 64,12Z', X.lin([[0, '#d1c4e9'], [1, '#5e35b1']])) + circ(66, 34, 4, '#fff') + circ(76, 56, 3, '#fff') + circ(62, 72, 2.5, '#fff');
      case 'yang': for (var y = 0; y < 12; y++) o += E('M50,6L54,20L46,20Z', '#fff8e1', 'transform="rotate(' + y * 30 + ' 50 50)"'); return o + circ(50, 50, 24, X.rad([[0, '#ffffff'], [0.6, '#fff176'], [1, '#ffb300']]), 'stroke="' + EK + '" stroke-width="3"');
      case 'genjutsu':
        o += '<g transform="translate(50,50) scale(42)">' + '<path d="' + spiralD(3, 0.04, 1, 0) + '" fill="none" stroke="#f3e5f5" stroke-width="0.09" stroke-linecap="round"/></g>';
        return o + (ek && ek !== 'beast' ? '<g transform="translate(50,50) scale(0.5) translate(-50,-52)">' + bigEye(X, ek, artOf(c).eyeColor) + '</g>' : circ(50, 50, 9, '#fff', 'stroke="' + EK + '" stroke-width="3"'));
      case 'eye': return bigEye(X, ek && ek !== 'beast' ? ek : 'sharingan', artOf(c).eyeColor);
      case 'amaterasu': return E('M50,8C58,26 80,34 78,60C76,82 62,94 50,94C34,94 20,82 20,62C20,46 30,40 32,24C38,38 42,44 50,48C54,34 48,22 50,8Z', '#0a0a0a', 'stroke="#ce93d8" stroke-width="3.5"') + path('M50,44C56,58 64,64 62,76C60,86 54,90 50,90C42,90 38,84 38,76C38,68 44,66 46,58C48,64 50,62 50,44Z', '#2a0a3a') + '<g transform="translate(50,30) scale(0.32) translate(-50,-52)">' + bigEye(X, ek && /^ms_/.test(ek) ? ek : 'ms_itachi', artOf(c).eyeColor) + '</g>';
      case 'kamui':
        for (var k = 0; k < 3; k++) o += '<path d="M50,50C50,30 70,18 90,26C72,24 60,34 58,50Z" fill="#d1c4e9" stroke="' + EK + '" stroke-width="2.5" transform="rotate(' + k * 120 + ' 50 50)"/>';
        return circ(50, 50, 40, '#140a26', 'opacity="0.6"') + o + circ(50, 50, 10, '#140a26', 'stroke="#d1c4e9" stroke-width="3"');
      case 'susanoo':
        var sg = X.lin([[0, '#efe6ff'], [1, '#8a5cff']]);
        o += E('M50,4L60,18L74,10L70,28C80,34 84,44 82,54L72,58L70,46L60,44L58,56L42,56L40,44L30,46L28,58L18,54C16,44 20,34 30,28L26,10L40,18Z', sg); // horned helm
        o += E('M34,40Q42,34 48,42Q40,46 34,40ZM66,40Q58,34 52,42Q60,46 66,40Z', '#ffe9a0', 'stroke="#3a1a7a"');
        for (var rb = 0; rb < 4; rb++) o += EL('M' + (50 - 10 - rb * 6) + ',' + (64 + rb * 8) + 'Q50,' + (58 + rb * 8) + ' ' + (50 + 10 + rb * 6) + ',' + (64 + rb * 8), EK, 6) + EL('M' + (50 - 10 - rb * 6) + ',' + (64 + rb * 8) + 'Q50,' + (58 + rb * 8) + ' ' + (50 + 10 + rb * 6) + ',' + (64 + rb * 8), '#d9c8ff', 3.5);
        return circ(50, 54, 46, '#b388ff', 'opacity="0.25"') + EL('M50,60V96', EK, 5) + EL('M50,60V96', '#d9c8ff', 2.5) + o;
      case 'rasengan': return circ(50, 50, 40, X.rad([[0, '#ffffff'], [0.45, '#b3ecff'], [0.8, '#40c4ff'], [1, '#0288d1']]), 'stroke="' + EK + '" stroke-width="3"') + '<g transform="translate(50,50) scale(34)"><path d="' + spiralD(2.2, 0.05, 1, 0) + '" fill="none" stroke="#fff" stroke-width="0.08"/><path d="' + spiralD(2.2, 0.05, 1, 180) + '" fill="none" stroke="#e1f5fe" stroke-width="0.06" opacity="0.8"/></g>' + circ(36, 34, 7, '#fff', 'opacity="0.8"');
      case 'chidori': o += circ(50, 54, 22, X.rad([[0, '#ffffff'], [0.6, '#bbdefb'], [1, '#448aff']]), 'stroke="' + EK + '" stroke-width="3"');
        return o + EL('M50,32L44,16L52,10M68,44L84,36L90,44M66,68L82,78L80,90M34,70L18,80L12,72M30,44L14,36L10,24', '#fff', 4) + EL('M50,32L44,16L52,10M68,44L84,36L90,44M66,68L82,78L80,90M34,70L18,80L12,72M30,44L14,36L10,24', '#82b1ff', 1.5);
      case 'sage': return E('M10,52Q50,14 90,52Q50,90 10,52Z', '#fff3c4') + circ(50, 52, 22, X.rad([[0, '#fff59d'], [0.6, '#ffca28'], [1, '#e65100']]), 'stroke="' + EK + '" stroke-width="2.5"') + '<rect x="34" y="47" width="32" height="10" rx="5" fill="' + EK + '"/>' + EL('M10,52Q50,14 90,52', '#e8541c', 5);
      case 'bijuu': return circ(50, 52, 40, '#ff3d00', 'opacity="0.35"') + circ(50, 52, 32, X.rad([[0, '#4a0000'], [0.7, '#1a0000'], [1, '#000']]), 'stroke="#ff6e40" stroke-width="4"') + circ(38, 40, 6, '#ff8a65', 'opacity="0.7"') + EL('M20,52A30,30 0 0,1 50,22', '#ff9e80', 3, 'opacity="0.8"');
      case 'truth': return circ(50, 50, 36, X.rad([[0, '#5a5a66'], [0.5, '#1a1a22'], [1, '#000']], 0.35, 0.3, 0.75), 'stroke="#bdbdbd" stroke-width="3"') + circ(38, 36, 7, '#fff', 'opacity="0.65"') + EL('M14,62A38,14 0 0,0 86,62', '#bdbdbd', 2.5, 'opacity="0.8"');
      case 'blade': return E('M18,86L26,78L80,14L86,16L84,22L30,82Z', X.lin([[0, '#ffffff'], [1, '#b0bec5']])) + E('M18,86L12,92L8,88L14,82Z', '#455a64') + E('M22,74L34,86L30,90L18,78Z', '#ffd54f') + EL('M32,70L78,18', '#fff', 1.5);
      case 'fist': return E('M26,40C26,30 34,26 40,28C42,20 52,18 56,24C60,18 70,18 72,26C80,24 86,30 84,40L84,62C84,78 72,88 56,88H44C32,88 24,78 24,66Z', '#ffccbc') + EL('M40,28V46M56,24V46M72,26V46M24,52C34,48 46,50 50,58', EK, 2.5);
      case 'gate': return circ(50, 50, 40, X.rad([[0, '#69f0ae', 0.9], [1, '#ff1744', 0.2]])) + E('M16,26H84L80,34H20Z', '#ff1744') + E('M24,34H32V88H24ZM68,34H76V88H68Z', '#d50000') + E('M20,44H80V50H20Z', '#ff5252') + '<text x="50" y="80" font-size="30" font-weight="900" text-anchor="middle" fill="#fff" stroke="' + EK + '" stroke-width="1.5" font-family="' + FONT + '">八</text>';
      case 'shuriken': for (var sh = 0; sh < 4; sh++) o += 'M50,50L44,40L50,6L56,40Z'.replace(/,/g, ',') ; return '<g transform="rotate(20 50 50)">' + [0, 90, 180, 270].map(function (r) { return E('M50,50L42,40L50,6L58,40Z', '#eceff1', 'transform="rotate(' + r + ' 50 50)"'); }).join('') + '</g>' + circ(50, 50, 9, '#90a4ae', 'stroke="' + EK + '" stroke-width="3"') + circ(50, 50, 3.5, EK);
      case 'insect': for (var b = 0; b < 9; b++) { var bx = 20 + (b * 37) % 62, by = 18 + (b * 23) % 64; o += '<g transform="translate(' + bx + ',' + by + ') rotate(' + (b * 40) + ')">' + ell(0, 0, 5, 8, '#3e2723', 'stroke="#d7ccc8" stroke-width="1.5"') + ell(-6, -3, 5, 3, '#efebe9', 'opacity="0.8"') + ell(6, -3, 5, 3, '#efebe9', 'opacity="0.8"') + '</g>'; } return o;
      case 'puppet': return EL('M30,4V30M50,4V22M70,4V30', '#8fdcff', 2) + E('M50,22C68,22 76,36 74,52C72,72 62,84 50,84C38,84 28,72 26,52C24,36 32,22 50,22Z', '#8d6e63') + circ(40, 50, 6, '#fff', 'stroke="' + EK + '" stroke-width="2"') + circ(60, 50, 6, '#fff', 'stroke="' + EK + '" stroke-width="2"') + circ(50, 38, 5, '#fff', 'stroke="' + EK + '" stroke-width="2"') + E('M36,66H64L60,74H40Z', '#3e2723') + EL('M40,66V74M50,66V74M60,66V74', '#d7ccc8', 1.5);
      case 'poison': return E('M50,8C62,30 76,42 76,60A26,26 0 0,1 24,60C24,42 38,30 50,8Z', X.lin([[0, '#dcedc8'], [1, '#689f38']])) + circ(42, 58, 6, EK) + circ(58, 58, 6, EK) + E('M44,72H56L50,78Z', EK) + circ(78, 20, 6, '#dcedc8', 'stroke="' + EK + '" stroke-width="2"') + circ(86, 34, 4, '#dcedc8', 'stroke="' + EK + '" stroke-width="2"');
      case 'paper': return E('M50,50L14,20L30,56Z', '#ffffff') + E('M50,50L86,20L70,56Z', '#f5f5f5') + E('M50,50L22,84L40,58Z', '#eeeeee') + E('M50,50L78,84L60,58Z', '#e0e0e0') + E('M46,30H54V72H46Z', '#bdbdbd');
      case 'ink': return E('M12,58C30,40 44,40 54,48C62,30 80,22 92,26C82,30 76,40 74,50C84,52 88,58 86,62C74,58 66,62 60,70C50,82 30,82 18,74C28,70 32,66 34,62C26,62 18,62 12,58Z', '#212121', 'stroke="#9e9e9e"') + circ(70, 36, 2.5, '#fff') + EL('M20,88Q40,84 60,90', '#424242', 4) + circ(80, 84, 4, '#212121');
      case 'shadow': for (var t = 0; t < 5; t++) { var tx = 14 + t * 18; o += E('M' + (tx - 7) + ',96C' + (tx - 8) + ',70 ' + (tx + 8) + ',56 ' + tx + ',' + (24 + (t % 2) * 14) + 'C' + (tx + 14) + ',50 ' + (tx + 6) + ',70 ' + (tx + 7) + ',96Z', '#263238', 'stroke="#90a4ae"'); } return o;
      case 'mind': return circ(50, 50, 38, 'none', 'stroke="#fff9c4" stroke-width="4"') + circ(50, 50, 24, 'none', 'stroke="#fff9c4" stroke-width="3"') + EL('M50,6V26M50,74V94M6,50H26M74,50H94', '#fff9c4', 4) + circ(50, 50, 9, '#ffeb3b', 'stroke="' + EK + '" stroke-width="3"');
      case 'heal': return circ(50, 50, 38, '#e8f5e9', 'opacity="0.35"') + E('M40,14H60V40H86V60H60V86H40V60H14V40H40Z', X.lin([[0, '#ffffff'], [1, '#69f0ae']]));
      case 'seal': return E('M30,8H70V92H30Z', '#fff8e1') + EL('M30,8H70V92H30Z', '#c62828', 2) + '<text x="50" y="62" font-size="34" font-weight="900" text-anchor="middle" fill="#c62828" font-family="' + FONT + '">封</text>' + EL('M36,76Q50,86 64,76', '#c62828', 3);
      case 'summon': return E('M14,70C6,58 16,44 28,50C28,34 48,30 54,42C62,30 82,36 80,52C92,52 94,70 82,74Z', '#ffffff') + EL('M8,86H92M20,94H80', '#fff3e0', 4) + '<text x="50" y="68" font-size="24" font-weight="900" text-anchor="middle" fill="#ff9800" font-family="' + FONT + '">口寄</text>';
      case 'bone': return E('M20,92L30,48L24,20L36,40L40,8L48,40L52,92Z', '#fafafa') + E('M54,92L62,52L58,26L70,44L78,16L80,50L82,92Z', '#eeeeee') + EL('M30,62H48M62,66H80', '#bdbdbd', 2);
      case 'beast': return EL('M24,14Q18,50 30,86M46,10Q40,50 52,90M68,14Q62,50 74,86', EK, 12) + EL('M24,14Q18,50 30,86M46,10Q40,50 52,90M68,14Q62,50 74,86', '#efebe9', 7) + EL('M24,14Q18,50 30,86M46,10Q40,50 52,90M68,14Q62,50 74,86', '#a1887f', 2);
      case 'chakra': return E('M50,8C62,28 82,40 78,64C74,84 62,92 50,92C36,92 22,82 22,64C22,48 34,40 36,26C40,38 46,44 50,46C54,32 48,22 50,8Z', X.lin([[0, '#e1f5fe'], [1, '#00b0ff']])) + path('M50,44C56,58 64,62 62,74C60,84 54,88 50,88C42,88 38,82 38,74C38,66 44,64 46,56Z', '#ffffff', 'opacity="0.85"');
      case 'gravity': return [40, 30, 20].map(function (r, i) { return circ(50, 50, r, 'none', 'stroke="' + (i ? '#d1c4e9' : '#9575cd') + '" stroke-width="' + (6 - i * 1.5) + '"'); }).join('') + circ(50, 50, 9, '#fff', 'stroke="' + EK + '" stroke-width="3"') + EL('M50,4V14M50,86V96M4,50H14M86,50H96M18,18L25,25M82,82L75,75M82,18L75,25M18,82L25,75', '#ede7f6', 3);
      case 'sound': return E('M22,40H36L56,22V78L36,60H22Z', '#e8eaf6') + EL('M64,36Q72,50 64,64M72,28Q86,50 72,72M80,20Q100,50 80,80', '#e8eaf6', 4);
      case 'clone': return [[24, '#ffe0b2'], [50, '#ffcc80'], [76, '#fff3e0']].map(function (q, i) { return '<g opacity="' + (i === 1 ? 1 : 0.8) + '">' + E('M' + (q[0] - 16) + ',92C' + (q[0] - 16) + ',70 ' + (q[0] - 8) + ',62 ' + q[0] + ',62C' + (q[0] + 8) + ',62 ' + (q[0] + 16) + ',70 ' + (q[0] + 16) + ',92Z', q[1]) + circ(q[0], 46, 13, q[1], 'stroke="' + EK + '" stroke-width="3"') + '</g>'; }).join('');
      case 'space': return circ(50, 50, 38, X.rad([[0, '#fff59d', 0.9], [1, '#ffe14d', 0]])) + E('M50,8L58,40L50,56L42,40Z', '#eceff1') + E('M42,40L22,30L34,50ZM58,40L78,30L66,50Z', '#cfd8dc') + E('M46,56H54V84H46Z', '#37474f') + circ(50, 90, 6, 'none', 'stroke="' + EK + '" stroke-width="3"') + EL('M10,20L24,28M90,20L76,28M10,78L26,70M90,78L74,70', '#ffe14d', 3);
      case 'web': var wl = ''; for (var wi = 0; wi < 8; wi++) { var wp = pol(50, 50, 44, wi * 45); wl += 'M50,50L' + PP(wp); } [14, 26, 38].forEach(function (r) { var ring = ''; for (var wj = 0; wj <= 8; wj++) { var rp = pol(50, 50, r, wj * 45); ring += (wj ? 'L' : 'M') + PP(rp); } wl += ring; }); return EL(wl, EK, 5) + EL(wl, '#fafafa', 2.5) + circ(50, 50, 5, '#ffd54f', 'stroke="' + EK + '" stroke-width="2"');
      case 'snake': return E('M20,88C10,70 30,60 50,66C70,72 86,60 80,44C76,34 64,30 56,36C64,24 84,22 90,36C98,56 84,78 60,80C42,82 30,74 30,88Z', X.lin([[0, '#d1c4e9'], [1, '#7e57c2']])) + circ(78, 36, 3, '#ffeb3b', 'stroke="' + EK + '" stroke-width="1.5"') + EL('M90,40L98,42M98,42L100,38M98,42L100,46', '#e53935', 2);
      case 'shield': return E('M50,8L84,20V48C84,70 68,84 50,92C32,84 16,70 16,48V20Z', X.lin([[0, '#fffde7'], [1, '#ffca28']])) + E('M50,22L70,30V48C70,62 62,72 50,78C38,72 30,62 30,48V30Z', '#ffe082');
      default: return E('M50,50L42,40L50,6L58,40Z', '#fff') + E('M50,50L60,42L94,50L60,58Z', '#fff') + E('M50,50L58,60L50,94L42,60Z', '#fff') + E('M50,50L40,58L6,50L40,42Z', '#fff');
    }
  }
  var ROLE_FX = { atk: 'chakra', tank: 'shield', sup: 'yang', ctrl: 'seal', heal: 'heal' };
  var EL_FX = { fire: 'fire', wind: 'wind', lightning: 'lightning', earth: 'earth', water: 'water', yin: 'yin', yang: 'yang', none: 'fist' };
  function iconFx(c, key) {
    var sk = c.skills && typeof c.skills === 'object' ? own(c.skills, key) : null;
    if (sk && sk.fx && own(NG.FX, sk.fx)) return sk.fx;
    var a = artOf(c);
    if (key === 'passive' || key === 'awaken') {
      var ek = eyeKindOf(c);
      if (ek && ek !== 'beast' && key === 'passive') return 'eye';
      if (a.type === 'beast') return 'bijuu';
      if (key === 'passive') return own(ROLE_FX, c.role) || 'chakra'; // passives: role emblem (avoids repeating the s1 element icon)
    }
    var u = c.skills && typeof c.skills === 'object' && c.skills.ult && c.skills.ult.fx;
    if (key === 'awaken' && u && own(NG.FX, u)) return u;
    return own(EL_FX, c.element) || 'shuriken';
  }
  function skillIconSVG(c, key, size) {
    var fx = iconFx(c, key), F = own(NG.FX, fx) || { c1: '#607d8b', c2: '#cfd8dc', k: '忍' };
    var X = new Ctx('i' + (hash(cid(c) + key) % 46656).toString(36) + '_', 3);
    var c1 = F.c1, c2 = F.c2, dark = lum(c1) < 0.2;
    var bgA = dark ? mix(c1, c2, 0.35) : lt(c1, 0.15), bgB = dk(c1, 0.6);
    var rr = 'M16,2H84A14,14 0 0,1 98,16V84A14,14 0 0,1 84,98H16A14,14 0 0,1 2,84V16A14,14 0 0,1 16,2Z';
    var cp = X.clip('<path d="' + rr + '"/>');
    var b = path(rr, X.lin([[0, bgA], [0.55, c1], [1, bgB]], 0, 0, 1, 1));
    var inner = '';
    inner += circ(50, 46, 46, X.rad([[0, lt(c2, 0.2), 0.75], [1, c2, 0]]));
    for (var i = 0; i < 10; i++) { var q0 = pol(50, 50, 80, i * 36 + 8), q1 = pol(50, 50, 80, i * 36 + 20); inner += path('M50,50L' + PP(q0) + 'L' + PP(q1) + 'Z', '#ffffff', 'opacity="0.08"'); }
    if (key === 'awaken') {
      var A2 = new Ctx(X.p + 'p', 4.2), pp = drawCharacter(c, A2, 'avatar'); X.defs = X.defs.concat(A2.defs);
      var vb = (pp.avatarVB || '141 82 280 280').split(' ').map(Number), z = 0.82;
      var vb2 = r1(vb[0] + vb[2] * (1 - z) / 2) + ' ' + r1(vb[1] + vb[3] * 0.02) + ' ' + r1(vb[2] * z) + ' ' + r1(vb[3] * z);
      inner += '<svg x="0" y="0" width="100" height="100" viewBox="' + vb2 + '" preserveAspectRatio="xMidYMid slice">' + pp.back + pp.body + pp.head + pp.front + '</svg>';
      inner += path('M0,64H100V100H0Z', X.lin([[0, c1, 0], [1, dk(c1, 0.3), 0.95]]));
    } else {
      inner += '<g transform="translate(50,50) scale(0.8) translate(-50,-50)">' + fxEmblem(X, fx, c, F) + '</g>';
    }
    var glyph = '<text x="90" y="92" font-size="22" font-weight="900" text-anchor="end" fill="#fff" stroke="' + dk(c1, 0.7) + '" stroke-width="3" paint-order="stroke" opacity="0.92" font-family="' + FONT + '">' + esc(F.k || '') + '</text>';
    var frame = path(rr, 'none', 'stroke="' + lt(c2, 0.3) + '" stroke-width="3" opacity="0.85"') + path('M16,6H84A10,10 0 0,1 94,16', 'none', 'stroke="#fff" stroke-width="2" opacity="0.45" stroke-linecap="round"') + path(rr, 'none', 'stroke="#0a0f24" stroke-width="2.5"');
    var body = b + '<g clip-path="' + cp + '">' + inner + path('M2,2H98V40Q50,30 2,46Z', '#ffffff', 'opacity="0.10"') + '</g>' + glyph + frame;
    return finish(X, '0 0 100 100', size, size, body);
  }
  A.skillIcon = function (c, key, size) {
    c = resolve(c); size = dim(size, 96); key = String(key || 's1');
    return memo('ic|' + cid(c) + '|' + key + '|' + size, function () { return safe(function () { return skillIconSVG(c, key, size); }, function () { return skillIconSVG({ id: '_generic' }, 's1', size); }); });
  };
  A.skillIconURL = function (c, key, size) { c = resolve(c); size = dim(size, 96); key = String(key || 's1'); return urlMemo('ic|' + cid(c) + '|' + key + '|' + size, function () { return A.skillIcon(c, key, size); }); };

  /* ======================================================================
   * 14. emblems, element badges, frames
   * ==================================================================== */
  var EMB_SYM = { konoha: 'konoha', suna: 'suna', kiri: 'kiri', kumo: 'kumo', iwa: 'iwa', oto: 'oto', ame: 'ame', taki: 'taki', allied: 'allied' };
  function emblemSVG(k, size) {
    var X = new Ctx('e' + (hash(String(k)) % 46656).toString(36) + '_', 3);
    var FA = own(NG.FACTIONS, k), fc = (FA && FA.color) || '#9aa3ad';
    var s = '';
    var ring = X.lin([[0, lt(fc, 0.6)], [0.5, fc], [1, dk(fc, 0.55)]], 0, 0, 1, 1);
    s += circ(50, 50, 48, '#0a0f24') + circ(50, 50, 45, ring) + circ(50, 50, 37, '#0a0f24', 'opacity="0.6"');
    var plate = X.lin([[0, '#ffffff'], [0.45, '#c3ccd8'], [0.55, '#9ea8b8'], [1, '#e4e9f0']], 0, 0, 1, 1);
    var sym = '';
    if (k === 'akatsuki') {
      s += circ(50, 50, 35, '#111018');
      sym = path(cloudD(50, 54, 26), '#ffffff') + path(cloudD(50, 54, 22), '#d32f2f');
    } else if (k === 'bijuu') {
      s += circ(50, 50, 35, X.rad([[0, '#ffb07a'], [1, '#c4400a']]));
      for (var i = 0; i < 9; i++) sym += '<path d="M50,50C52,40 60,30 72,26C64,34 60,42 58,52Z" fill="#2a0a00" transform="rotate(' + i * 40 + ' 50 50)"/>';
      sym += circ(50, 50, 7, '#2a0a00');
    } else if (k === 'otsutsuki') {
      s += circ(50, 50, 35, X.rad([[0, '#ffffff'], [1, '#c9c0e6']]));
      sym = '<g transform="translate(50,50) scale(24)">' + irisUnit(X, 'rinne_sharingan') + '</g>';
    } else if (k === 'legend' || k === 'uchiha') {
      s += circ(50, 50, 35, plate);
      sym = path('M50,18A22,22 0 0,1 50,62A22,22 0 0,1 50,18Z', '#d32f2f', 'stroke="' + EK + '" stroke-width="2.5"') + path('M30,46A20,20 0 0,0 70,46Q50,56 30,46Z', '#ffffff', 'stroke="' + EK + '" stroke-width="2.5"') + path('M47,62H53V84H47Z', '#5a3a2a', 'stroke="' + EK + '" stroke-width="2"');
      sym = '<g transform="translate(0,-4)">' + sym + '</g>';
    } else if (k === 'senju') {
      s += circ(50, 50, 35, plate);
      sym = '<path d="M30,30L50,22L70,30L70,50L50,78L30,50Z" fill="none" stroke="#2a303a" stroke-width="5" stroke-linejoin="round"/><path d="M50,30V66M38,44H62" stroke="#2a303a" stroke-width="4"/>';
    } else if (k === 'uzumaki') {
      s += circ(50, 50, 35, '#c62828');
      sym = '<g transform="translate(50,50) scale(26)"><path d="' + spiralD(2, 0.04, 1, 0) + '" fill="none" stroke="#fff" stroke-width="0.14" stroke-linecap="round"/></g>';
    } else if (k === 'taka') {
      s += circ(50, 50, 35, X.rad([[0, '#8ea0c8'], [1, '#2a3450']]));
      sym = path('M14,44C30,40 42,30 50,22C58,30 70,40 86,44C72,46 62,52 58,62L66,80L50,70L34,80L42,62C38,52 28,46 14,44Z', '#f2f2f2', 'stroke="' + EK + '" stroke-width="2.5"') + circ(50, 34, 3, EK);
    } else if (k === 'samurai') {
      s += circ(50, 50, 35, plate);
      sym = '<path d="M24,78L76,22M76,78L24,22" stroke="#2a303a" stroke-width="6" stroke-linecap="round"/><circle cx="50" cy="50" r="10" fill="#2a303a"/><path d="M30,66L36,72M70,66L64,72" stroke="#2a303a" stroke-width="10"/>';
    } else if (own(EMB_SYM, k)) {
      s += circ(50, 50, 35, plate);
      sym = '<g transform="translate(50,50) scale(22)">' + symbol(EMB_SYM[k], '#2a303a', 0.17) + '</g>';
    } else {
      s += circ(50, 50, 35, plate);
      var kj = (FA && FA.kanji) || '忍';
      sym = '<g transform="rotate(15 50 50)" opacity="0.28">' + [0, 90, 180, 270].map(function (r) { return '<path d="M50,50L42,40L50,14L58,40Z" fill="#2a303a" transform="rotate(' + r + ' 50 50)"/>'; }).join('') + '</g>' +
        '<text x="50" y="63" font-size="36" font-weight="900" text-anchor="middle" fill="#2a303a" font-family="' + FONT + '">' + esc(kj) + '</text>';
    }
    s += sym;
    s += path('M20,34A34,34 0 0,1 66,18', 'none', 'stroke="#fff" stroke-width="3" opacity="0.5" stroke-linecap="round"');
    s += circ(50, 50, 35, 'none', 'stroke="' + EK + '" stroke-width="2"');
    return finish(X, '0 0 100 100', size, size, s);
  }
  A.emblem = function (k, size) { k = k == null ? 'other' : String(k); size = dim(size, 64); return memo('em|' + k + '|' + size, function () { return safe(function () { return emblemSVG(k, size); }, function () { return emblemSVG('other', size); }); }); };
  A.emblemURL = function (k, size) { k = k == null ? 'other' : String(k); size = dim(size, 64); return urlMemo('em|' + k + '|' + size, function () { return A.emblem(k, size); }); };

  function elementSVG(k, size) {
    var X = new Ctx('l' + (hash(String(k)) % 1296).toString(36) + '_', 3);
    var E_ = own(NG.ELEMENTS, k) || { name: '?', color: '#9e9e9e' };
    var c = E_.color, s = '';
    s += circ(50, 50, 48, '#0a0f24') + circ(50, 50, 44, X.lin([[0, lt(c, 0.45)], [0.5, c], [1, dk(c, 0.5)]], 0, 0, 1, 1));
    s += circ(50, 50, 38, 'none', 'stroke="#fff" stroke-width="2.5" opacity="0.55"');
    s += path('M18,40A34,34 0 0,1 60,14', 'none', 'stroke="#fff" stroke-width="4" opacity="0.5" stroke-linecap="round"');
    s += '<text x="50" y="66" font-size="46" font-weight="900" text-anchor="middle" fill="#fff" stroke="' + dk(c, 0.7) + '" stroke-width="6" paint-order="stroke" font-family="' + FONT + '">' + esc(E_.name) + '</text>';
    return finish(X, '0 0 100 100', size, size, s);
  }
  A.element = function (k, size) { k = String(k); size = dim(size, 32); return memo('el|' + k + '|' + size, function () { return safe(function () { return elementSVG(k, size); }, function () { return elementSVG('none', size); }); }); };
  A.elementURL = function (k, size) { k = String(k); size = dim(size, 32); return urlMemo('el|' + k + '|' + size, function () { return A.element(k, size); }); };

  function frameSVG(r, size) {
    var R = own(NG.RARITIES, r) || { color: '#7fb2ff', color2: '#d8e8ff', order: 0 };
    var X = new Ctx('f' + (hash(String(r)) % 1296).toString(36) + '_', 3);
    var gold = X.lin([[0, '#fff6c8'], [0.3, '#ffd25a'], [0.6, '#b8860b'], [1, '#ffe9a0']], 0, 0, 1, 1);
    var rc = X.lin([[0, R.color2], [0.5, R.color], [1, dk(R.color, 0.45)]], 0, 0, 1, 1);
    var s = '';
    var hi = R.order >= 3;
    s += circ(64, 64, 57, 'none', 'stroke="#0a0f24" stroke-width="9"');
    s += circ(64, 64, 57, 'none', 'stroke="' + (hi ? gold : rc) + '" stroke-width="6"');
    s += circ(64, 64, 52, 'none', 'stroke="' + rc + '" stroke-width="2.5"');
    s += circ(64, 64, 61, 'none', 'stroke="' + (hi ? '#fff3c0' : R.color2) + '" stroke-width="1.2" opacity="0.7"');
    // ornaments: top gem, side wings
    var gem = 'M64,0L72,8L64,16L56,8Z';
    s += path(gem, X.lin([[0, '#ffffff'], [1, R.color]]), 'stroke="#0a0f24" stroke-width="1.5"');
    var wingL = 'M30,112C18,108 10,98 8,86C16,94 24,98 34,100C26,96 20,88 18,80C26,88 34,94 42,96Z';
    s += path(wingL, hi ? gold : rc, 'stroke="#0a0f24" stroke-width="1.5"') + path(wingL, hi ? gold : rc, 'stroke="#0a0f24" stroke-width="1.5" transform="translate(128,0) scale(-1,1)"');
    if (R.order >= 4) {
      for (var i = 0; i < 8; i++) { var p0 = pol(64, 64, 61, i * 45 + 22.5), p1 = pol(64, 64, 67, i * 45 + 22.5); s += line('M' + PP(p0) + 'L' + PP(p1), '#ff8a65', 3); }
      s += circ(64, 64, 57, 'none', 'stroke="#ff4d4d" stroke-width="1.5" stroke-dasharray="3 5" opacity="0.9"');
    }
    s += path('M22,40A46,46 0 0,1 60,12', 'none', 'stroke="#fff" stroke-width="2" opacity="0.7" stroke-linecap="round"');
    return finish(X, '0 0 128 128', size, size, s);
  }
  A.frame = function (r, size) { r = String(r); size = dim(size, 128); return memo('fr|' + r + '|' + size, function () { return safe(function () { return frameSVG(r, size); }, function () { return frameSVG('R', size); }); }); };
  A.frameURL = function (r, size) { r = String(r); size = dim(size, 128); return urlMemo('fr|' + r + '|' + size, function () { return A.frame(r, size); }); };

  /* ======================================================================
   * 15. backgrounds (1280×720 design space)
   * ==================================================================== */
  function rect(x, y, w, h, fill, extra) { return '<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(w) + '" height="' + r1(h) + '" fill="' + fill + '"' + (extra ? ' ' + extra : '') + '/>'; }
  function ridge(R, y0, amp, n, x0, x1, yb, jag) { // mountain/hill silhouette
    var d = 'M' + P(x0, yb) + 'L' + P(x0, y0), step = (x1 - x0) / n;
    for (var i = 1; i <= n; i++) {
      var x = x0 + i * step, y = y0 - (R() * amp) * (jag ? 1 : 0.6);
      d += jag ? 'L' + P(x - step / 2, y0 - amp * (0.4 + R() * 0.6)) + 'L' + P(x, y0 - R() * amp * 0.3) : 'Q' + P(x - step / 2, y - amp * 0.5) + ' ' + P(x, y0 - R() * amp * 0.25);
    }
    return d + 'L' + P(x1, yb) + 'Z';
  }
  function cloudShape(x, y, w, h) {
    return 'M' + P(x, y) + 'C' + P(x - w * 0.05, y - h * 0.6) + ' ' + P(x + w * 0.18, y - h * 0.9) + ' ' + P(x + w * 0.3, y - h * 0.55) +
      'C' + P(x + w * 0.36, y - h * 1.2) + ' ' + P(x + w * 0.62, y - h * 1.2) + ' ' + P(x + w * 0.66, y - h * 0.6) +
      'C' + P(x + w * 0.78, y - h * 0.95) + ' ' + P(x + w * 1.02, y - h * 0.7) + ' ' + P(x + w, y) + 'Z';
  }
  function stars(R, n, y1, c) { var o = ''; for (var i = 0; i < n; i++) o += circ(R() * 1280, R() * y1, 0.6 + R() * 1.6, c || '#fff', 'opacity="' + r1(0.3 + R() * 0.7) + '"'); return o; }
  function pine(x, y, h, c) {
    var w = h * 0.34, d = 'M' + P(x, y - h);
    for (var i = 1; i <= 4; i++) d += 'L' + P(x + w * i / 4, y - h + h * i / 4.4) + 'L' + P(x + w * i / 8, y - h + h * i / 4.4);
    d += 'L' + P(x + w * 0.1, y) + 'L' + P(x - w * 0.1, y);
    for (var j = 4; j >= 1; j--) d += 'L' + P(x - w * j / 8, y - h + h * j / 4.4) + 'L' + P(x - w * j / 4, y - h + h * j / 4.4);
    return path(d + 'Z', c);
  }
  function roundTree(x, y, r, c, c2) { return rect(x - r * 0.12, y - r * 0.4, r * 0.24, r * 1.2, dk(c, 0.5)) + circ(x, y - r * 0.8, r, c) + circ(x - r * 0.45, y - r * 0.5, r * 0.7, c) + circ(x + r * 0.5, y - r * 0.55, r * 0.72, c2 || dk(c, 0.15)); }
  function rain(R, n, c, op) { var d = ''; for (var i = 0; i < n; i++) { var x = R() * 1400 - 60, y = R() * 720, l = 20 + R() * 40; d += 'M' + P(x, y) + 'l' + r1(-l * 0.3) + ',' + r1(l); } return line(d, c, 1.4, 'opacity="' + op + '"'); }
  function windowsPattern(X, id, lit, dim, w, h) {
    var key = 'pat' + id;
    if (!X.m[key]) {
      var pid = X.uid();
      X.defs.push('<pattern id="' + pid + '" width="' + w + '" height="' + h + '" patternUnits="userSpaceOnUse">' + rect(w * 0.2, h * 0.25, w * 0.5, h * 0.45, dim) + '</pattern>');
      X.m[key] = 'url(#' + pid + ')';
    }
    return X.m[key];
  }
  function building(X, R, x, w, top, base, col_, win, litC, lit) {
    var o = rect(x, top, w, base - top, col_);
    o += rect(x + 3, top + 8, w - 6, base - top - 8, windowsPattern(X, col_ + win, null, win, 14, 18));
    for (var i = 0; i < lit; i++) { var cx = x + 6 + Math.floor(R() * ((w - 12) / 14)) * 14, cy = top + 12 + Math.floor(R() * ((base - top - 20) / 18)) * 18; o += rect(cx, cy, 7, 8, litC, 'opacity="' + r1(0.55 + R() * 0.45) + '"'); }
    o += rect(x, top, w, 4, lt(col_, 0.18));
    if (R() < 0.4) o += rect(x + w * 0.6, top - 30 - R() * 40, 3, 70, col_) + circ(x + w * 0.6 + 1.5, top - 34 - R() * 30, 2.5, '#ff4a4a', 'opacity="0.9"');
    if (R() < 0.35) o += rect(x + w * 0.15, top - 18, w * 0.25, 18, col_) + path('M' + P(x + w * 0.12, top - 18) + 'h' + r1(w * 0.31) + 'l-' + r1(w * 0.155) + ',-10Z', col_);
    return o;
  }
  function bgCity(X, R) {
    var o = rect(0, 0, 1280, 720, X.lin([[0, '#1a2244'], [0.45, '#3a4474'], [0.75, '#5a6290'], [1, '#232a4a']]));
    o += circ(1010, 140, 70, X.rad([[0, '#f4f2ff', 0.9], [0.4, '#c9cdf5', 0.35], [1, '#8a90d0', 0]]), '') + circ(1010, 140, 42, '#e8e8fa', 'opacity="0.85"');
    o += stars(R, 60, 300);
    o += path(cloudShape(120, 230, 380, 60), '#3a4068', 'opacity="0.55"') + path(cloudShape(760, 190, 460, 70), '#3a4068', 'opacity="0.5"');
    // far skyline
    var x = -10;
    while (x < 1290) { var w = 40 + R() * 70, hgt = 140 + R() * 220; o += building(X, R, x, w, 560 - hgt, 720, '#3a4472', '#4a5482', '#bfd0ff', 2); x += w + 2; }
    o += rect(0, 400, 1280, 240, X.lin([[0, '#7a82b8', 0], [0.6, '#8a90c0', 0.5], [1, '#3a4472', 0]]));
    // mid skyline
    x = -20;
    while (x < 1300) { var w2 = 70 + R() * 90, h2 = 220 + R() * 300; o += building(X, R, x, w2, 640 - h2, 720, '#252c58', '#323a6a', '#ffd27a', 7) + rect(x, 640 - h2, 3, h2, '#8a9ad8', 'opacity="0.35"'); x += w2 + 6 + R() * 20; }
    o += rect(0, 520, 1280, 200, X.lin([[0, '#6a72a8', 0], [0.5, '#6a72a8', 0.35], [1, '#1a1e3a', 0]]));
    // near frame towers
    o += path('M0,0H150L170,40V720H0Z', '#0e1124') + path('M1280,0H1120L1100,60V720H1280Z', '#0e1124');
    o += line('M170,40V720M1100,60V720', '#3a4270', 3) + rect(20, 120, 120, 600, windowsPattern(X, 'near', null, '#1a1f3a', 20, 26));
    o += line('M150,250Q640,330 1120,230M150,270Q640,360 1120,250', '#05060e', 2, 'opacity="0.7"');
    o += rect(0, 600, 1280, 120, X.lin([[0, '#0a0d1c', 0], [1, '#05060e', 0.95]]));
    for (var i = 0; i < 6; i++) { var lx = 220 + i * 170; o += circ(lx, 640, 40, X.rad([[0, '#ffd27a', 0.5], [1, '#ffd27a', 0]])) + rect(lx - 2, 640, 4, 80, '#0a0d1c'); }
    o += rect(0, 0, 1280, 720, X.rad([[0, '#000', 0], [0.7, '#000', 0.08], [1, '#000', 0.45]]));
    return o;
  }
  function hokageFace(x, y, s, hairKind) {
    var o = path('M' + P(x - 40 * s, y - 30 * s) + 'C' + P(x - 44 * s, y + 30 * s) + ' ' + P(x - 20 * s, y + 60 * s) + ' ' + P(x, y + 62 * s) + 'C' + P(x + 20 * s, y + 60 * s) + ' ' + P(x + 44 * s, y + 30 * s) + ' ' + P(x + 40 * s, y - 30 * s) + 'Z', '#b98f6a');
    o += path('M' + P(x - 46 * s, y - 20 * s) + 'C' + P(x - 50 * s, y - 70 * s) + ' ' + P(x + 50 * s, y - 70 * s) + ' ' + P(x + 46 * s, y - 20 * s) + (hairKind ? 'L' + P(x + 30 * s, y - 34 * s) + 'L' + P(x + 14 * s, y - 20 * s) + 'L' + P(x, y - 36 * s) + 'L' + P(x - 16 * s, y - 20 * s) + 'L' + P(x - 30 * s, y - 34 * s) : 'Q' + P(x, y - 30 * s) + ' ' + P(x - 46 * s, y - 20 * s)) + 'Z', '#a07a58');
    o += line('M' + P(x - 26 * s, y) + 'h' + r1(16 * s) + 'M' + P(x + 10 * s, y) + 'h' + r1(16 * s) + 'M' + P(x - 3 * s, y + 10 * s) + 'l' + r1(-4 * s) + ',' + r1(18 * s) + 'M' + P(x - 12 * s, y + 38 * s) + 'h' + r1(24 * s), '#6a4a34', 3 * s);
    o += line('M' + P(x - 28 * s, y - 10 * s) + 'l' + r1(18 * s) + ',' + r1(4 * s) + 'M' + P(x + 28 * s, y - 10 * s) + 'l' + r1(-18 * s) + ',' + r1(4 * s), '#5a3a24', 4 * s);
    return o;
  }
  function bgVillage(X, R) {
    var o = rect(0, 0, 1280, 720, X.lin([[0, '#5aa8f0'], [0.6, '#a8d8ff'], [1, '#e8f6ff']]));
    o += path(cloudShape(80, 140, 300, 60), '#fff', 'opacity="0.9"') + path(cloudShape(860, 110, 360, 70), '#fff', 'opacity="0.85"') + path(cloudShape(520, 200, 220, 40), '#fff', 'opacity="0.7"');
    // Hokage rock
    var cliff = 'M-20,460L-20,250C80,236 160,210 260,206C480,196 800,196 1020,206C1120,212 1200,232 1300,250L1300,460Z';
    o += path(cliff, X.lin([[0, '#d6ac80'], [1, '#a57a54']])) + path('M-20,250C80,236 160,210 260,206C480,196 800,196 1020,206C1120,212 1200,232 1300,250L1300,236C1200,216 1120,196 1020,190C800,180 480,180 260,190C160,194 80,220 -20,236Z', '#5f9a3a');
    var stri = ''; for (var st = 0; st < 40; st++) { var sx = st * 33 + R() * 10; stri += 'M' + r1(sx) + ',' + r1(230 + R() * 30) + 'l' + r1(-4 + R() * 8) + ',' + r1(120 + R() * 120); }
    o += line(stri, '#8a6440', 2, 'opacity="0.45"');
    [[300, 300, 1], [470, 292, 0], [640, 288, 1], [810, 292, 0], [980, 300, 1]].forEach(function (f, i) { o += hokageFace(f[0], f[1], 1.25, f[2]); });
    o += path(ridge(R, 470, 50, 16, 0, 1280, 720), '#4f8f3a') + path(ridge(R, 520, 40, 20, 0, 1280, 720), '#3d7a2e');
    // trees behind houses
    for (var t = 0; t < 26; t++) o += roundTree(t * 52 + R() * 20, 500 + R() * 20, 24 + R() * 10, '#3f8a34', '#2f6e28');
    // houses
    var hx = -20;
    while (hx < 1300) {
      var w = 70 + R() * 70, h = 60 + R() * 90, top = 600 - h, rc = ['#c8553a', '#d9a03a', '#b84a3a', '#e0c49a', '#6a8ab8'][Math.floor(R() * 5)];
      o += rect(hx, top, w, h + 120, ['#efe2c8', '#e4d2b0', '#f4ead8'][Math.floor(R() * 3)], 'stroke="#8a7458" stroke-width="2"');
      o += path('M' + P(hx - 8, top) + 'Q' + P(hx + w / 2, top - 26 - R() * 10) + ' ' + P(hx + w + 8, top) + 'Z', rc, 'stroke="' + dk(rc, 0.4) + '" stroke-width="2"');
      for (var wi = 0; wi < 2; wi++) o += rect(hx + 12 + wi * (w - 36), top + 22, 14, 16, '#5a7aa8', 'stroke="#3a4a68" stroke-width="1.5"');
      if (R() < 0.3) o += rect(hx + w * 0.6, top - 50, 22, 40, '#8a9ab0', 'stroke="#4a5a70" stroke-width="2"') + ell(hx + w * 0.6 + 11, top - 50, 13, 6, '#6a7a90');
      hx += w + 4;
    }
    // Hokage residence: red cylindrical tower with 火
    o += path('M560,640V470Q640,452 720,470V640Z', '#d8553a', 'stroke="#6a2010" stroke-width="3"') + path('M680,640V466Q700,470 720,470V640Z', '#b8402a');
    o += path('M548,476Q640,420 732,476Q640,456 548,476Z', '#c8402a', 'stroke="#6a2010" stroke-width="3"') + path('M572,456Q640,410 708,456L700,440Q640,404 580,440Z', '#e8b04a', 'stroke="#6a2010" stroke-width="2.5"');
    o += circ(640, 520, 30, '#fff4e0', 'stroke="#6a2010" stroke-width="3"') + '<text x="640" y="535" font-size="40" font-weight="900" text-anchor="middle" fill="#c8102e" font-family="' + FONT + '">火</text>';
    o += rect(586, 570, 22, 26, '#5a7aa8', 'stroke="#3a4a68" stroke-width="2"') + rect(672, 570, 22, 26, '#5a7aa8', 'stroke="#3a4a68" stroke-width="2"') + rect(626, 600, 28, 40, '#6a3a20');
    o += rect(0, 660, 1280, 60, '#c8b08a') + line('M0,662H1280', '#8a7458', 3);
    o += rect(0, 0, 1280, 720, X.lin([[0, '#fff', 0.08], [1, '#ffeec8', 0.12]]));
    return o;
  }
  function bgForest(X, R) {
    var o = rect(0, 0, 1280, 720, X.lin([[0, '#1e4a2a'], [0.5, '#3a7a3e'], [1, '#14301a']]));
    for (var l = 0; l < 3; l++) {
      var col_ = ['#4a5a3a', '#4a3a28', '#2e2016'][l], n = [14, 9, 6][l], tw = [40, 70, 120][l];
      for (var i = 0; i < n; i++) {
        var x = (i + R() * 0.6) * 1280 / n, w = tw * (0.7 + R() * 0.6);
        o += path('M' + P(x - w / 2, 720) + 'C' + P(x - w * 0.4, 400) + ' ' + P(x - w * 0.3, 200) + ' ' + P(x - w * 0.36, -10) + 'H' + P(x + w * 0.36, -10).replace(/,.*/, '') + 'C' + P(x + w * 0.3, 200) + ' ' + P(x + w * 0.4, 400) + ' ' + P(x + w / 2, 720) + 'Z', col_);
        o += path('M' + P(x + w * 0.1, 720) + 'C' + P(x + w * 0.2, 400) + ' ' + P(x + w * 0.15, 200) + ' ' + P(x + w * 0.2, -10) + 'L' + P(x + w * 0.36, -10) + 'C' + P(x + w * 0.3, 200) + ' ' + P(x + w * 0.4, 400) + ' ' + P(x + w / 2, 720) + 'Z', dk(col_, 0.3));
      }
      o += rect(0, 0, 1280, 720, '#7ac07a', 'opacity="' + (0.16 - l * 0.05) + '"');
    }
    var leaves = ''; for (var lv = 0; lv < 40; lv++) leaves += circleD(R() * 1280, R() * 170, 40 + R() * 50);
    o += path(leaves, '#2c6a2a', 'opacity="0.9"');
    leaves = ''; for (var lv2 = 0; lv2 < 26; lv2++) leaves += circleD(R() * 1280, R() * 120, 30 + R() * 40);
    o += path(leaves, '#3f8a34', 'opacity="0.8"');
    o += path('M0,0H1280V60C1000,100 820,30 600,70C400,110 200,40 0,80Z', '#1a4a1e');
    var rays = ''; for (var r = 0; r < 6; r++) { var rx = 200 + r * 180 + R() * 60; rays += 'M' + rx + ',0L' + (rx + 60) + ',0L' + (rx + 260) + ',720L' + (rx + 120) + ',720Z'; }
    o += path(rays, X.lin([[0, '#fffbd0', 0.35], [1, '#fffbd0', 0]]));
    o += path(ridge(R, 640, 40, 30, 0, 1280, 720), '#1e4a22') + path(ridge(R, 680, 30, 40, 0, 1280, 720, true), '#143418');
    o += rect(0, 520, 1280, 200, X.lin([[0, '#cfe8c8', 0], [0.6, '#cfe8c8', 0.18], [1, '#cfe8c8', 0]]));
    for (var f = 0; f < 30; f++) o += circ(R() * 1280, 200 + R() * 500, 1.5 + R() * 2.5, '#eaffb0', 'opacity="' + r1(0.3 + R() * 0.6) + '"');
    return o;
  }
  function statue(x, base, s, dir, c, hairSpiky) {
    var o = '', k = s;
    var bd = 'M' + P(x - 70 * k, base) + 'L' + P(x - 60 * k, base - 260 * k) + 'C' + P(x - 58 * k, base - 330 * k) + ' ' + P(x + 58 * k, base - 330 * k) + ' ' + P(x + 60 * k, base - 260 * k) + 'L' + P(x + 70 * k, base) + 'Z';
    o += path(bd, c) + path('M' + P(x + dir * 10 * k, base) + 'L' + P(x + dir * 12 * k, base - 300 * k) + 'C' + P(x + dir * 40 * k, base - 320 * k) + ' ' + P(x + dir * 58 * k, base - 290 * k) + ' ' + P(x + dir * 62 * k, base - 260 * k) + 'L' + P(x + dir * 70 * k, base) + 'Z', dk(c, 0.25));
    o += circ(x, base - 352 * k, 34 * k, c) + path('M' + P(x - 40 * k, base - 350 * k) + (hairSpiky ? 'L' + P(x - 60 * k, base - 300 * k) + 'L' + P(x - 30 * k, base - 330 * k) + 'L' + P(x - 50 * k, base - 260 * k) + 'L' + P(x - 20 * k, base - 320 * k) : 'Q' + P(x - 46 * k, base - 300 * k) + ' ' + P(x - 30 * k, base - 290 * k)) + 'L' + P(x, base - 392 * k) + 'L' + P(x + 40 * k, base - 350 * k) + 'Z', dk(c, 0.15));
    // arms: hand seal raised (two fingers)
    o += path('M' + P(x - dir * 40 * k, base - 280 * k) + 'L' + P(x + dir * 30 * k, base - 230 * k) + 'L' + P(x + dir * 40 * k, base - 290 * k) + 'L' + P(x + dir * 30 * k, base - 300 * k) + 'L' + P(x + dir * 20 * k, base - 250 * k) + 'L' + P(x - dir * 30 * k, base - 296 * k) + 'Z', dk(c, 0.1));
    return o;
  }
  function bgValley(X, R) {
    var o = rect(0, 0, 1280, 720, X.lin([[0, '#2a3a6a'], [0.5, '#ff9a6a'], [0.8, '#ffd0a0'], [1, '#7a5a4a']]));
    o += circ(640, 330, 90, X.rad([[0, '#fff6d0', 1], [0.5, '#ffd08a', 0.5], [1, '#ff9a6a', 0]]));
    o += path(cloudShape(100, 150, 380, 50), '#ffb08a', 'opacity="0.5"') + path(cloudShape(820, 120, 420, 50), '#ffb08a', 'opacity="0.45"');
    // cliffs
    o += path('M0,720V260L120,230L230,280L330,250L420,330L470,720Z', '#5a4a5a') + path('M1280,720V250L1160,220L1050,270L950,240L860,320L810,720Z', '#5a4a5a');
    o += path('M0,720V330L140,300L260,360L380,330L440,420L470,720Z', '#463a4a') + path('M1280,720V320L1140,290L1020,350L900,330L840,420L810,720Z', '#463a4a');
    // statues
    o += statue(300, 330, 0.82, 1, '#6a6070', false) + statue(980, 320, 0.82, -1, '#6a6070', true);
    // waterfall
    o += path('M470,420H810L840,720H440Z', X.lin([[0, '#bfe6ff'], [1, '#6aa8e0']]));
    var wf = ''; for (var i = 0; i < 18; i++) { var wx = 480 + i * 19; wf += 'M' + wx + ',420L' + (wx - 6 + R() * 12) + ',720'; }
    o += line(wf, '#ffffff', 3, 'opacity="0.5"');
    o += path('M470,420Q640,400 810,420L810,436Q640,416 470,436Z', '#e8f6ff');
    o += rect(0, 660, 1280, 60, X.lin([[0, '#6aa8e0'], [1, '#2a5a8a']])) + path('M400,660Q640,630 880,660', 'none', 'stroke="#fff" stroke-width="10" opacity="0.6"');
    o += rect(0, 0, 1280, 720, X.rad([[0, '#000', 0], [0.75, '#000', 0.1], [1, '#000', 0.5]]));
    return o;
  }
  function bgDesert(X, R) {
    var o = rect(0, 0, 1280, 720, X.lin([[0, '#f0a050'], [0.5, '#ffd08a'], [1, '#ffe8b8']]));
    o += circ(1000, 170, 110, X.rad([[0, '#fffbe0', 1], [0.5, '#fff0b0', 0.6], [1, '#ffd08a', 0]])) + circ(1000, 170, 56, '#fff8d8');
    o += path(ridge(R, 440, 60, 6, 0, 1280, 720), '#e8b070') + path('M0,520C200,470 380,480 560,510C760,540 980,470 1280,500V720H0Z', '#d89a58');
    // Suna buildings
    var bx = 40;
    while (bx < 1240) {
      var w = 80 + R() * 110, h = 90 + R() * 130, top = 580 - h, c = ['#d8a868', '#c8985a', '#e0b478'][Math.floor(R() * 3)];
      o += path('M' + P(bx, 600) + 'V' + r1(top + 30) + 'Q' + P(bx + w / 2, top - 18) + ' ' + P(bx + w, top + 30) + 'V600Z', c, 'stroke="' + dk(c, 0.35) + '" stroke-width="2.5"');
      o += path('M' + P(bx + w * 0.7, 600) + 'V' + r1(top + 30) + 'Q' + P(bx + w * 0.85, top + 6) + ' ' + P(bx + w, top + 30) + 'V600Z', dk(c, 0.15));
      var nw = w > 140 ? 3 : 2;
      for (var wi = 0; wi < nw; wi++) o += path('M' + P(bx + w * (0.2 + wi * 0.6 / (nw - 1 || 1)) - 8, top + 64) + 'v-8a8,8 0 0,1 16,0v8Z', '#5a3a1a', 'stroke="' + dk(c, 0.4) + '" stroke-width="2"');
      o += path('M' + P(bx + w * 0.42, 600) + 'v-34a' + r1(w * 0.08) + ',' + r1(w * 0.08) + ' 0 0,1 ' + r1(w * 0.16) + ',0v34Z', dk(c, 0.45));
      bx += w + 20 + R() * 40;
    }
    o += path('M0,600C240,580 420,620 640,610C860,600 1040,580 1280,600V720H0Z', '#c8884a') + path('M0,660C300,630 600,680 900,650C1050,636 1180,650 1280,660V720H0Z', '#b0763c');
    var dust = ''; for (var d = 0; d < 6; d++) dust += 'M' + (R() * 1280) + ',' + (500 + R() * 200) + 'q120,-20 260,0';
    o += line(dust, '#fff0c8', 6, 'opacity="0.35"');
    return o;
  }
  function bgMist(X, R) {
    var o = rect(0, 0, 1280, 720, X.lin([[0, '#5a7a9a'], [0.5, '#a8c0d4'], [1, '#6a8aa4']]));
    o += circ(640, 220, 160, X.rad([[0, '#ffffff', 0.6], [1, '#ffffff', 0]]));
    [[180, 170, 60], [330, 230, 46], [880, 200, 54], [1060, 150, 66], [1180, 240, 40]].forEach(function (t) { // Kiri towers in the fog
      var tx = t[0], th = t[1], tw = t[2];
      o += path('M' + (tx - tw / 2) + ',420V' + (420 - th) + 'Q' + tx + ',' + (420 - th - tw * 0.7) + ' ' + (tx + tw / 2) + ',' + (420 - th) + 'V420Z', '#9ab2c6', 'opacity="0.75"');
      o += rect(tx - tw * 0.6, 420 - th * 0.55, tw * 1.2, 8, '#8aa4ba', 'opacity="0.75"') + rect(tx - 4, 420 - th - tw * 0.7 - 16, 8, 18, '#9ab2c6', 'opacity="0.75"');
      for (var wi = 0; wi < 3; wi++) o += rect(tx - tw * 0.25 + wi * tw * 0.2, 420 - th * 0.85, 5, 9, '#d8e4ee', 'opacity="0.6"');
    });
    for (var l = 0; l < 3; l++) {
      var y = 380 + l * 50, c = ['#8aa4bc', '#6a88a4', '#4a6884'][l];
      for (var i = 0; i < 22; i++) o += pine(i * 62 + R() * 30, y + R() * 20, 90 + R() * 70 + l * 20, c);
      o += rect(0, y - 60, 1280, 120, X.lin([[0, '#dce8f2', 0], [0.5, '#dce8f2', 0.5], [1, '#dce8f2', 0]]));
    }
    o += rect(0, 540, 1280, 180, X.lin([[0, '#8ab0cc'], [1, '#3a5a7a']]));
    var ripples = ''; for (var r = 0; r < 14; r++) ripples += 'M' + (R() * 1280) + ',' + (560 + R() * 150) + 'h' + (60 + R() * 120);
    o += line(ripples, '#e8f4ff', 2, 'opacity="0.5"');
    o += path('M200,560L240,520H1040L1080,560Z', '#3a4a5a', 'opacity="0.6"') + line('M260,520V560M400,520V560M540,520V560M680,520V560M820,520V560M960,520V560', '#2a3a4a', 4, 'opacity="0.6"');
    o += rect(0, 0, 1280, 720, X.lin([[0, '#eef4fa', 0.2], [0.6, '#eef4fa', 0.35], [1, '#eef4fa', 0.1]]));
    return o;
  }
  function bgRain(X, R) {
    var o = rect(0, 0, 1280, 720, X.lin([[0, '#2a2f3e'], [0.6, '#4a5266'], [1, '#22262e']]));
    o += path(cloudShape(-40, 160, 600, 120), '#3a4050') + path(cloudShape(600, 140, 760, 140), '#363c4c');
    var x = -20;
    while (x < 1300) {
      var w = 60 + R() * 80, h = 260 + R() * 360, top = 720 - h, c = ['#3a4252', '#343b4a', '#2e3442'][Math.floor(R() * 3)];
      o += rect(x, top, w, h, c) + rect(x + w * 0.15, top - 30, w * 0.12, 30, c) + rect(x + w * 0.55, top - 50, w * 0.1, 50, c);
      for (var p = 0; p < 3; p++) o += line('M' + r1(x + w * (0.2 + p * 0.25)) + ',' + r1(top) + 'V720', dk(c, 0.3), 5);
      for (var li = 0; li < 5; li++) o += rect(x + 8 + R() * (w - 16), top + 30 + R() * (h - 60), 6, 5, '#ffcf6a', 'opacity="' + r1(0.3 + R() * 0.6) + '"');
      x += w + 10 + R() * 30;
    }
    o += path('M0,520C300,500 500,560 760,540C980,524 1140,500 1280,520', 'none', 'stroke="#1e222c" stroke-width="16"');
    o += rect(0, 0, 1280, 720, '#7a8aa8', 'opacity="0.12"') + rain(R, 260, '#cfe0ff', 0.45) + rain(R, 120, '#ffffff', 0.25);
    o += rect(0, 640, 1280, 80, X.lin([[0, '#5a6680', 0.2], [1, '#1a1e28', 0.9]]));
    return o;
  }
  function bgBattle(X, R) {
    var o = rect(0, 0, 1280, 720, X.lin([[0, '#2a1218'], [0.45, '#8a3020'], [0.7, '#e0702a'], [1, '#3a2018']]));
    var smoke = ''; for (var sm = 0; sm < 10; sm++) smoke += circ(R() * 1280, 180 + R() * 260, 70 + R() * 110, '#1a0a0a', 'opacity="' + r1(0.25 + R() * 0.25) + '"');
    o += '<g filter="' + X.blur(26) + '">' + smoke + '</g>';
    o += circ(900, 330, 60, X.rad([[0, '#fff0b0', 0.9], [1, '#ff6a1a', 0]])) + circ(300, 360, 40, X.rad([[0, '#fff0b0', 0.7], [1, '#ff6a1a', 0]]));
    o += path(ridge(R, 470, 90, 9, 0, 1280, 720, true), '#2a1612') + path(ridge(R, 540, 50, 14, 0, 1280, 720, true), '#1e100e');
    for (var r = 0; r < 18; r++) { var rx = R() * 1280, ry = 580 + R() * 120, rs = 14 + R() * 30; o += path('M' + P(rx - rs, ry) + 'L' + P(rx - rs * 0.4, ry - rs * 0.9) + 'L' + P(rx + rs * 0.6, ry - rs * 0.7) + 'L' + P(rx + rs, ry) + 'Z', '#2e1a14', 'stroke="#140a08" stroke-width="2"'); }
    for (var w = 0; w < 9; w++) { var wx = 80 + R() * 1120, wy = 600 + R() * 80, an = -20 + R() * 40; o += '<g transform="translate(' + r1(wx) + ',' + r1(wy) + ') rotate(' + r1(an) + ')">' + rect(-2, -70, 4, 70, '#9aa4b0') + rect(-8, -6, 16, 4, '#3a2a20') + '</g>'; }
    o += path('M0,640L300,600L520,650L760,610L1000,660L1280,620V720H0Z', '#140a08');
    o += line('M200,660L320,690L420,670M760,640L840,700M980,680L1100,650', '#ff7a2a', 2.5, 'opacity="0.7"');
    for (var e = 0; e < 40; e++) o += circ(R() * 1280, R() * 650, 1 + R() * 2.5, '#ffb04a', 'opacity="' + r1(0.3 + R() * 0.7) + '"');
    o += rect(0, 0, 1280, 720, X.rad([[0, '#000', 0], [0.7, '#000', 0.15], [1, '#000', 0.6]]));
    return o;
  }
  function bgSummon(X, R) {
    var o = rect(0, 0, 1280, 720, X.rad([[0, '#3a2a7a'], [0.5, '#1a1440'], [1, '#07061a']], 0.5, 0.55, 0.7));
    o += stars(R, 120, 720, '#d8d0ff');
    o += rect(560, 0, 160, 720, X.lin([[0, '#ffe9a0', 0], [0.5, '#ffe9a0', 0.35], [1, '#ffe9a0', 0]], 0, 0, 1, 0)) + rect(600, 0, 80, 720, X.lin([[0, '#fff', 0], [0.5, '#fff', 0.35], [1, '#fff', 0]], 0, 0, 1, 0));
    // magic circle in perspective
    var mc = '<g transform="translate(640,560) scale(1,0.32)">';
    var gold = '#ffd25a';
    mc += circ(0, 0, 520, X.rad([[0, '#ffe9a0', 0.55], [0.6, '#b07aff', 0.25], [1, '#b07aff', 0]]));
    [500, 470, 360, 330, 200].forEach(function (r, i) { mc += circ(0, 0, r, 'none', 'stroke="' + gold + '" stroke-width="' + (i % 2 ? 4 : 9) + '" opacity="0.9"'); });
    var tick = ''; for (var t = 0; t < 72; t++) { var a = t * 5, p0 = pol(0, 0, 470, a), p1 = pol(0, 0, t % 6 ? 490 : 500, a); tick += 'M' + PP(p0) + 'L' + PP(p1); }
    mc += line(tick, gold, 3);
    var star = ''; for (var k = 0; k < 6; k++) { var q = pol(0, 0, 330, k * 60 - 90), q2 = pol(0, 0, 330, k * 60 + 30); star += 'M' + PP(q) + 'L' + PP(pol(0, 0, 330, k * 60 + 30)); }
    var tri1 = '', tri2 = ''; for (var k2 = 0; k2 < 3; k2++) { tri1 += (k2 ? 'L' : 'M') + PP(pol(0, 0, 330, k2 * 120 - 90)); tri2 += (k2 ? 'L' : 'M') + PP(pol(0, 0, 330, k2 * 120 + 90)); }
    mc += path(tri1 + 'Z' + tri2 + 'Z', 'none', 'stroke="' + gold + '" stroke-width="6"');
    var runes = '火水风雷土阴阳封印口寄灵', rr = '';
    for (var g = 0; g < 12; g++) { var gp = pol(0, 0, 415, g * 30 - 90); rr += '<text x="' + r1(gp[0]) + '" y="' + r1(gp[1] + 18) + '" font-size="52" font-weight="900" text-anchor="middle" fill="' + gold + '" font-family="' + FONT + '">' + runes.charAt(g) + '</text>'; }
    mc += rr + '<g transform="scale(160)"><path d="' + spiralD(2.5, 0.05, 1, 0) + '" fill="none" stroke="' + gold + '" stroke-width="0.04"/></g>';
    mc += '</g>';
    o += mc;
    o += path('M480,720L600,120H680L800,720Z', X.lin([[0, '#fff6d0', 0], [0.6, '#fff6d0', 0.18], [1, '#fff6d0', 0.4]]));
    for (var sp = 0; sp < 40; sp++) { var sx = 640 + (R() - 0.5) * 700, sy = 200 + R() * 480, sz = 2 + R() * 5; o += path('M' + P(sx, sy - sz * 2) + 'L' + P(sx + sz * 0.5, sy - sz * 0.5) + 'L' + P(sx + sz * 2, sy) + 'L' + P(sx + sz * 0.5, sy + sz * 0.5) + 'L' + P(sx, sy + sz * 2) + 'L' + P(sx - sz * 0.5, sy + sz * 0.5) + 'L' + P(sx - sz * 2, sy) + 'L' + P(sx - sz * 0.5, sy - sz * 0.5) + 'Z', '#fff4c0', 'opacity="' + r1(0.4 + R() * 0.6) + '"'); }
    return o;
  }
  function bgMoon(X, R) {
    var o = rect(0, 0, 1280, 720, X.lin([[0, '#050818'], [0.6, '#121a40'], [1, '#2a2050']]));
    o += stars(R, 220, 560);
    o += circ(640, 300, 330, X.rad([[0, '#ffefe0', 0.35], [0.6, '#ff6a6a', 0.08], [1, '#ff6a6a', 0]]));
    o += circ(640, 290, 200, X.rad([[0, '#fff8f0'], [0.7, '#f4e6e0'], [1, '#d8c4c4']], 0.42, 0.4, 0.62));
    [[580, 240, 30], [700, 330, 22], [610, 360, 16], [720, 220, 12], [540, 320, 10]].forEach(function (c) { o += circ(c[0], c[1], c[2], '#d6c2c0', 'opacity="0.7"'); });
    o += '<g opacity="0.22"><g transform="translate(640,290) scale(170)">' + irisUnit(X, 'rinne_sharingan') + '</g></g>';
    o += path(ridge(R, 590, 70, 10, 0, 1280, 720, true), '#0a0c1e') + path(ridge(R, 640, 40, 16, 0, 1280, 720, true), '#06070f');
    o += path('M980,640C990,560 1000,470 1040,420C1060,400 1100,390 1120,360C1100,400 1080,430 1080,470C1100,440 1140,430 1170,410C1140,450 1100,480 1090,520C1080,560 1080,600 1090,640Z', '#06070f');
    return o;
  }
  var BGS = { city_night: bgCity, village: bgVillage, forest: bgForest, valley: bgValley, desert: bgDesert, mist: bgMist, rain: bgRain, battlefield: bgBattle, summon: bgSummon, moon: bgMoon };
  function backgroundSVG(k, w, h) {
    var fn = own(BGS, k) || bgCity;
    var X = new Ctx('g' + (hash(String(k)) % 1296).toString(36) + '_', 3);
    var body = fn(X, rng(hash('bg:' + k)));
    return finish(X, '0 0 1280 720', w, h, body, ' preserveAspectRatio="xMidYMid slice"');
  }
  A.background = function (k, w, h) { k = String(k); w = dim(w, 1280); h = dim(h, 720); return memo('bg|' + k + '|' + w + 'x' + h, function () { return safe(function () { return backgroundSVG(k, w, h); }, function () { return backgroundSVG('city_night', w, h); }); }); };
  A.backgroundURL = function (k, w, h) { k = String(k); w = dim(w, 1280); h = dim(h, 720); return urlMemo('bg|' + k + '|' + w + 'x' + h, function () { return A.background(k, w, h); }); };
  A.BACKGROUNDS = Object.keys(BGS);

  A.clearCache = function () { cache = Object.create(null); };
  A._cacheSize = function () { return Object.keys(cache).length; };

  // dev helper used by art-gallery.html (iris close-ups)
  A._irisSVG = function (kind, color, size) { var X = new Ctx('z' + kind + '_', 3); return finish(X, '-1.05 -1.05 2.1 2.1', size || 160, size || 160, irisUnit(X, kind, color)); };
})(typeof window !== 'undefined' ? window : globalThis);
