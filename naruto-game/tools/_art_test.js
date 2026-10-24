// dev-only: node smoke test for js/art.js — loads core + all data + art, renders everything.
var fs = require('fs'), vm = require('vm'), path = require('path');
var ROOT = path.join(__dirname, '..');
// evaluate in the real global context (strict-mode errors behave like in browsers)
global.window = global; var ctx = global; var realConsole = console;
function load(f) { (0, eval)(fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n//# sourceURL=' + f); }
load('js/core.js');
var FILES = ['konoha_main', 'konoha_rookies', 'konoha_elders', 'uchiha_oto', 'akatsuki', 'suna_kiri', 'kumo_iwa', 'bijuu', 'summons'], loaded = [];
FILES.forEach(function (f) { if (fs.existsSync(path.join(ROOT, 'js/data/' + f + '.js'))) { try { load('js/data/' + f + '.js'); loaded.push(f); } catch (e) { console.log('DATA ERR', f, e.message); } } });
var warns = []; var _w = console.warn, _e = console.error; console.warn = function () { warns.push([].join.call(arguments, ' ')); }; console.error = function () { warns.push('E ' + [].join.call(arguments, ' ')); };
load('js/art.js');
var NG = ctx.NG, A = NG.art, bad = 0, t;
console.log('data files:', loaded.join(','), '| chars:', NG.CHARS.length);
// minimal XML well-formedness: balanced tags, attribute grammar, no duplicate attributes
function xmlErr(s) {
  var re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g, m, stack = [], last = 0;
  while ((m = re.exec(s))) {
    var between = s.slice(last, m.index); last = re.lastIndex;
    if (between.indexOf('<') >= 0) return 'stray < near ' + between.slice(0, 40);
    if (m[1]) { var top = stack.pop(); if (top !== m[2]) return 'mismatched </' + m[2] + '> vs ' + top; continue; }
    var attrs = m[3], seen = {}, am, are = /\s+([a-zA-Z][\w:-]*)="([^"<]*)"/g, consumed = '';
    while ((am = are.exec(attrs))) { if (seen[am[1]]) return 'duplicate attr ' + am[1] + ' in <' + m[2] + '>'; seen[am[1]] = 1; consumed += am[0]; }
    if (consumed.replace(/\s/g, '') !== attrs.replace(/\s/g, '')) return 'bad attrs in <' + m[2] + attrs.slice(0, 80) + '>';
    if (!m[4]) stack.push(m[2]);
  }
  return stack.length ? 'unclosed ' + stack.join(',') : null;
}
// reference integrity: every url(#id) / href="#id" must resolve to an element of the same picture, ids unique;
// and no SVG filters at all (they dominate paint cost on phones)
function refErr(s) {
  var ids = {}, m, re = / id="([^"]+)"/g;
  while ((m = re.exec(s))) { if (ids[m[1]]) return 'duplicate id ' + m[1]; ids[m[1]] = 1; }
  var rr = /url\(#([^)]+)\)|href="#([^"]+)"/g;
  while ((m = rr.exec(s))) { var id = m[1] || m[2]; if (!ids[id]) return 'dangling reference #' + id; }
  if (/<filter|filter="/.test(s)) return 'uses an SVG filter';
  if (/<mask/.test(s)) return 'uses an SVG mask';
  if (/<clipPath[^>]*>(?:<[^>]+\/>){2,}<\/clipPath>/.test(s)) return 'multi-child clipPath (slow mask-based clip)';
  return null;
}
function chk(label, s) {
  var xe = typeof s === 'string' ? (xmlErr(s) || refErr(s)) : 'not string';
  if (xe) { bad++; console.log('XML', label, xe); return; } if (typeof s !== 'string' || s.length < 200 || s.indexOf('<svg') !== 0 || /NaN|undefined/.test(s)) { bad++; console.log('BAD', label, typeof s === 'string' ? s.slice(0, 160) : s, (s && s.match && (s.match(/.{40}(NaN|undefined).{40}/) || [])[0])); } }
t = Date.now();
NG.CHARS.forEach(function (c) {
  chk(c.id + ' avatar64', A.avatar(c, 64)); chk(c.id + ' avatar128', A.avatar(c, 128)); chk(c.id + ' bust', A.bust(c));
  if (A.skillIcon) NG.SKILL_KEYS.forEach(function (k) { chk(c.id + ' icon ' + k, A.skillIcon(c, k, 96)); });
  if (A.avatarURL) { var u = A.avatarURL(c, 64); if (u.indexOf('data:image/svg+xml') !== 0) { bad++; console.log('BAD url', c.id); } }
});
var tAll = Date.now() - t;
// art fields the schema validator does not know about (validate.js ignores unknown keys): keep them sane
var HEXF = ['scarfColor', 'paintColor', 'headbandColor', 'maskColor', 'capColor', 'hornColor', 'beardColor', 'tieColor', 'flowerColor', 'gogglesColor', 'halfColor', 'vestColor', 'earColor', 'coralColor', 'brows', 'cape', 'maneColor'];
NG.CHARS.forEach(function (c) {
  var a = c.art || {};
  if (a.accessory2 !== undefined && NG.ART.accessory.indexOf(a.accessory2) < 0) { bad++; console.log('BAD accessory2', c.id, a.accessory2); }
  if (a.gender !== undefined && a.gender !== 'f' && a.gender !== 'm') { bad++; console.log('BAD gender', c.id, a.gender); }
  if (a.senbonPos !== undefined && a.senbonPos !== 'hand' && a.senbonPos !== 'mouth') { bad++; console.log('BAD senbonPos', c.id, a.senbonPos); }
  if (a.dogStyle !== undefined && a.dogStyle !== 'pug' && a.dogStyle !== 'fluffy') { bad++; console.log('BAD dogStyle', c.id, a.dogStyle); }
  if (a.build !== undefined && !(+a.build >= 0.8 && +a.build <= 1.3)) { bad++; console.log('BAD build', c.id, a.build); }
  HEXF.forEach(function (k) { if (a[k] !== undefined && !/^#[0-9a-f]{6}$/i.test(a[k])) { bad++; console.log('BAD ' + k, c.id, a[k]); } });
});
// vocabulary sweep
var base = { type: 'human', skin: '#f3d2b4', hair: 'spiky', hairColor: '#3a3f8a', eyes: 'normal', eyeColor: '#3b6fd6', outfit: 'shirt', outfitColor: '#3d5a99', accentColor: '#d14b3c', headband: 'konoha', headbandPos: 'forehead', marks: [], mask: 'none', hat: 'none', accessory: 'none' };
var n = 0;
Object.keys(NG.ART).forEach(function (k) {
  NG.ART[k].concat(['__bogus__']).forEach(function (v) {
    var a = JSON.parse(JSON.stringify(base));
    if (k === 'marks') a.marks = [v]; else if (k === 'beast') { a = { type: 'beast', beast: v, tails: 9, bodyColor: '#ff7a1a' }; } else if (k === 'type') a.type = v; else a[k] = v;
    if (k === 'eyes') { a.eyeL = v; }
    var c = { id: '_v_' + k + '_' + v, art: a, skills: { s1: { fx: 'fire' } } };
    chk(c.id, A.avatar(c, 64)); chk(c.id, A.bust(c)); n++;
  });
});
// weird inputs
[null, undefined, 'naruto', 'nope', {}, { id: 'x' }, { id: 'y', art: 5 }, { id: 'z', art: { type: 'beast' } }, { id: 'w', art: { hair: 'spiky', marks: 'whiskers' } }].forEach(function (c, i) {
  chk('weird' + i + ' av', A.avatar(c)); chk('weird' + i + ' bust', A.bust(c));
  if (A.skillIcon) { chk('weird' + i + ' icon', A.skillIcon(c, 'ult')); chk('weird' + i + ' icon2', A.skillIcon(c, 'bogus')); }
});
if (A.emblem) Object.keys(NG.FACTIONS).concat(['taki', 'allied', 'bogus', null]).forEach(function (f) { chk('emblem ' + f, A.emblem(f)); chk('emblemURL ' + f, A.emblem(f, 32)); });
if (A.element) Object.keys(NG.ELEMENTS).concat(['bogus']).forEach(function (e) { chk('element ' + e, A.element(e)); });
if (A.frame) NG.RARITY_ORDER.concat(['bogus']).forEach(function (r) { chk('frame ' + r, A.frame(r, 128)); });
if (A.background) ['city_night', 'village', 'forest', 'valley', 'desert', 'mist', 'rain', 'battlefield', 'summon', 'moon', 'bogus'].forEach(function (b) { chk('bg ' + b, A.background(b)); });
if (A.skillIcon) Object.keys(NG.FX).forEach(function (k) { chk('fx ' + k, A.skillIcon({ id: '_fx' + k, skills: { s2: { fx: k } } }, 's2')); });
// hostile inputs: odd sizes, prototype keys, malformed art
(function () {
  var c = NG.CHARS[0] || { id: 'x' };
  [0, -5, NaN, '64', 'abc', 1e5, null, undefined, {}].forEach(function (z) {
    chk('size ' + z + ' av', A.avatar(c, z)); chk('size bust', A.bust(c, z, z)); chk('size icon', A.skillIcon(c, 's1', z));
    chk('size em', A.emblem('konoha', z)); chk('size el', A.element('fire', z)); chk('size fr', A.frame('UR', z)); chk('size bg', A.background('village', z, z));
  });
  ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', null].forEach(function (k) {
    chk('key em ' + k, A.emblem(k)); chk('key el ' + k, A.element(k)); chk('key fr ' + k, A.frame(k)); chk('key bg ' + k, A.background(k)); chk('key bust ' + k, A.bust(k));
    chk('key char ' + k, A.bust({ id: 'k' + k, element: k, faction: k, rarity: k, art: { hat: k, beast: k, hair: k }, skills: { s1: { fx: k } } }));
  });
  [{ art: { type: 'human', marks: null } }, { art: { type: 'human', marks: [null, 5, {}] } }, { art: { type: 'beast', tails: 'x' } }, { art: { type: 'beast', tails: 99, beast: 'fox' } }, { art: { skin: '#zzz', hairColor: '#12345' } }, { skills: null }, { skills: { s1: null } }].forEach(function (o, i) {
    o.id = '_m' + i; chk('malformed ' + i, A.bust(o)); chk('malformed av ' + i, A.avatar(o, 64)); NG.SKILL_KEYS.forEach(function (k) { chk('malformed ic ' + i + k, A.skillIcon(o, k)); });
  });
})();
// determinism + perf (fresh cache)
var c0 = NG.CHARS[0];
if (c0) {
  var s1 = A.bust(c0); A.clearCache(); var s2 = A.bust(c0);
  if (s1 !== s2) { bad++; console.log('NONDETERMINISTIC bust'); }
  A.clearCache();
  for (var w = 0; w < 30; w++) { A.clearCache(); A.bust(NG.CHARS[w % NG.CHARS.length]); }
  A.clearCache(); t = process.hrtime.bigint(); NG.CHARS.forEach(function (c) { A.bust(c); }); var per = Number(process.hrtime.bigint() - t) / 1e6 / NG.CHARS.length;
  A.clearCache(); t = process.hrtime.bigint(); NG.CHARS.forEach(function (c) { A.avatar(c, 64); }); var pera = Number(process.hrtime.bigint() - t) / 1e6 / NG.CHARS.length;
  var sz = NG.CHARS.map(function (c) { return A.bust(c).length; }), avg = sz.reduce(function (x, y) { return x + y; }, 0) / sz.length;
  t = process.hrtime.bigint(); for (var r = 0; r < 1000; r++) A.bust(c0); var hit = Number(process.hrtime.bigint() - t) / 1e6 / 1000;
  console.log('perf: bust ' + per.toFixed(2) + ' ms/char (cold, warmed JIT), avatar64 ' + pera.toFixed(2) + ' ms, cached hit ' + (hit * 1000).toFixed(2) + ' µs, avg bust size ' + Math.round(avg / 1024) + ' KB, max ' + Math.round(Math.max.apply(null, sz) / 1024) + ' KB');
}
// size budgets (phones decode these as <img> data URLs): avatars ≤ 8 KB & ≤ 100 elements, busts ≤ 18 KB on average
(function () {
  var els = function (s) { return (s.match(/<[a-zA-Z]/g) || []).length; }, N = NG.CHARS.length || 1;
  var av = NG.CHARS.map(function (c) { return A.avatar(c, 128); }), bu = NG.CHARS.map(function (c) { return A.bust(c); });
  var avKB = av.reduce(function (t, s) { return t + s.length; }, 0) / N / 1024, avEl = av.reduce(function (t, s) { return t + els(s); }, 0) / N;
  var buKB = bu.reduce(function (t, s) { return t + s.length; }, 0) / N / 1024, buEl = bu.reduce(function (t, s) { return t + els(s); }, 0) / N;
  console.log('budget: avatar avg ' + avKB.toFixed(2) + ' KB / ' + avEl.toFixed(0) + ' elements, bust avg ' + buKB.toFixed(2) + ' KB / ' + buEl.toFixed(0) + ' elements');
  if (avKB > 8 || avEl > 100) { bad++; console.log('BUDGET avatar over 8 KB / 100 elements'); }
  if (buKB > 18) { bad++; console.log('BUDGET bust over 18 KB'); }
})();
console.log('vocab cases', n, '| first full pass', tAll, 'ms | problems:', bad, '| warnings:', warns.length);
if (warns.length) console.log(warns.slice(0, 10).join('\n'));
process.exit(bad ? 1 : 0);
