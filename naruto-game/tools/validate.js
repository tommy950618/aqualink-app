#!/usr/bin/env node
/* Data validator.
 *   node tools/validate.js                    -> validate every js/data/*.js against schema + master roster
 *   node tools/validate.js js/data/foo.js     -> validate one file (roster check limited to that file's ids)
 * Exit code 1 if any ERROR. Warnings never fail.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var ROSTER = require('./roster.js');

var args = process.argv.slice(2);
var files = args.length ? args.map(function (f) { return path.resolve(process.cwd(), f); })
  : fs.readdirSync(path.join(ROOT, 'js/data')).filter(function (f) { return /\.js$/.test(f) && f[0] !== '_'; })
      .map(function (f) { return path.join(ROOT, 'js/data', f); });

var ctx = { console: console };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/core.js'), 'utf8'), ctx, { filename: 'core.js' });
var NG = ctx.NG;

var errors = [], warnings = [];
function err(id, msg) { errors.push('[' + id + '] ' + msg); }
function warn(id, msg) { warnings.push('[' + id + '] ' + msg); }

files.forEach(function (f) {
  try {
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: path.basename(f) });
  } catch (e) {
    errors.push('[FILE ' + path.basename(f) + '] failed to execute: ' + e.message);
  }
});

var CJK = /[一-鿿]/;
function isNum(x) { return typeof x === 'number' && isFinite(x); }
function inEnum(v, list) { return list.indexOf(v) !== -1; }
function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c); }

function checkTags(id, where, tags) {
  if (!Array.isArray(tags) || tags.length < 1 || tags.length > 3) err(id, where + '.tags must be an array of 1-3 tags');
  else tags.forEach(function (t) { if (!NG.TAGS[t]) err(id, where + '.tags: unknown tag "' + t + '" (allowed: ' + Object.keys(NG.TAGS).join(' ') + ')'); });
}

function checkEffect(id, where, e) {
  if (!e || typeof e !== 'object') { err(id, where + ' effect is not an object'); return; }
  if (!inEnum(e.type, NG.EFFECT_TYPES)) { err(id, where + ' unknown effect type "' + e.type + '"'); return; }
  if (e.to !== undefined && !inEnum(e.to, NG.EFFECT_TO)) err(id, where + ' bad "to": ' + e.to);
  if (e.chance !== undefined && !(isNum(e.chance) && e.chance > 0 && e.chance <= 1)) err(id, where + ' chance must be (0,1]');
  if (e.turns !== undefined && !(isNum(e.turns) && e.turns >= 1 && e.turns <= 5)) err(id, where + ' turns must be 1-5');
  switch (e.type) {
    case 'dmg':
      if (!isNum(e.mult) || e.mult <= 0 || e.mult > 6) err(id, where + ' dmg.mult must be in (0,6]');
      if (e.hits !== undefined && !(isNum(e.hits) && e.hits >= 1 && e.hits <= 10)) err(id, where + ' dmg.hits must be 1-10');
      if (e.pierce !== undefined && !(isNum(e.pierce) && e.pierce >= 0 && e.pierce <= 1)) err(id, where + ' dmg.pierce must be 0-1');
      if (isNum(e.mult) && (e.mult * (e.hits || 1)) > 6) warn(id, where + ' total dmg mult > 6 looks unbalanced');
      break;
    case 'true_dmg':
      if (!isNum(e.pct) || e.pct <= 0 || e.pct > 0.5) err(id, where + ' true_dmg.pct must be in (0,0.5]');
      break;
    case 'heal': case 'shield':
      if (!isNum(e.mult) && !isNum(e.pct)) err(id, where + ' ' + e.type + ' needs mult or pct');
      if (isNum(e.mult) && (e.mult <= 0 || e.mult > 5)) err(id, where + ' ' + e.type + '.mult must be (0,5]');
      if (isNum(e.pct) && (e.pct <= 0 || e.pct > 1)) err(id, where + ' ' + e.type + '.pct must be (0,1]');
      break;
    case 'buff': case 'debuff':
      if (!inEnum(e.stat, NG.BUFF_STATS)) err(id, where + ' ' + e.type + '.stat must be one of ' + NG.BUFF_STATS.join(','));
      if (!isNum(e.value) || e.value <= 0 || e.value > 1.5) err(id, where + ' ' + e.type + '.value must be (0,1.5]');
      break;
    case 'status':
      if (!NG.STATUSES[e.status]) err(id, where + ' status.status must be one of ' + Object.keys(NG.STATUSES).join(','));
      if (e.value !== undefined && !(isNum(e.value) && e.value > 0 && e.value <= 2)) err(id, where + ' status.value must be (0,2]');
      break;
    case 'execute':
      if (e.threshold !== undefined && !(isNum(e.threshold) && e.threshold > 0 && e.threshold < 1)) err(id, where + ' execute.threshold must be (0,1)');
      if (!isNum(e.mult) || e.mult <= 0 || e.mult > 5) err(id, where + ' execute.mult must be (0,5]');
      break;
    case 'chakra': case 'drain':
      if (!isNum(e.value) || e.value <= 0 || e.value > 100) err(id, where + ' ' + e.type + '.value must be (0,100]');
      break;
    case 'lifesteal':
      if (!isNum(e.value) || e.value <= 0 || e.value > 1) err(id, where + ' lifesteal.value must be (0,1]');
      break;
    case 'revive':
      if (!isNum(e.pct) || e.pct <= 0 || e.pct > 1) err(id, where + ' revive.pct must be (0,1]');
      break;
    case 'counter':
      if (!isNum(e.mult) || e.mult <= 0 || e.mult > 3) err(id, where + ' counter.mult must be (0,3]');
      break;
  }
}

function checkPassive(id, key, s) {
  if (s.stats !== undefined) {
    if (typeof s.stats !== 'object') err(id, key + '.stats must be object');
    else Object.keys(s.stats).forEach(function (k) {
      if (!inEnum(k, NG.PASSIVE_STATS)) err(id, key + '.stats unknown stat "' + k + '"');
      else if (!isNum(s.stats[k]) || s.stats[k] < -0.5 || s.stats[k] > 1) err(id, key + '.stats.' + k + ' must be a fraction in [-0.5,1]');
    });
  }
  if (s.triggers !== undefined) {
    if (!Array.isArray(s.triggers)) err(id, key + '.triggers must be array');
    else s.triggers.forEach(function (t, i) {
      if (!inEnum(t.on, NG.TRIGGERS)) err(id, key + '.triggers[' + i + '].on unknown "' + t.on + '"');
      if (t.chance !== undefined && !(isNum(t.chance) && t.chance > 0 && t.chance <= 1)) err(id, key + '.triggers[' + i + '].chance must be (0,1]');
      if (!Array.isArray(t.effects) || !t.effects.length) err(id, key + '.triggers[' + i + '].effects must be non-empty array');
      else t.effects.forEach(function (e, j) { checkEffect(id, key + '.triggers[' + i + '].effects[' + j + ']', e); });
    });
  }
  if (!s.stats && !s.triggers) err(id, key + ' needs stats and/or triggers');
}

function checkActive(id, key, s) {
  if (!NG.FX[s.fx]) err(id, key + '.fx unknown "' + s.fx + '" (allowed: ' + Object.keys(NG.FX).join(' ') + ')');
  if (!inEnum(s.target, NG.TARGETS)) err(id, key + '.target unknown "' + s.target + '"');
  if (s.target === 'random' && !(isNum(s.count) && s.count >= 1 && s.count <= 5)) err(id, key + ' target "random" needs count 1-5');
  if (key === 's1' && s.cd) err(id, 's1.cd must be 0');
  if (key === 's2' && !(isNum(s.cd) && s.cd >= 1 && s.cd <= 5)) err(id, 's2.cd must be 1-5');
  if (!Array.isArray(s.effects) || !s.effects.length) err(id, key + '.effects must be non-empty');
  else s.effects.forEach(function (e, j) { checkEffect(id, key + '.effects[' + j + ']', e); });
}

function checkArt(id, a, c) {
  if (!a || typeof a !== 'object') { err(id, 'art missing'); return; }
  var A = NG.ART;
  var type = a.type || 'human';
  if (!inEnum(type, A.type)) err(id, 'art.type bad');
  if (type === 'beast') {
    if (!inEnum(a.beast, A.beast)) err(id, 'art.beast must be one of ' + A.beast.join(','));
    if (!isHex(a.bodyColor)) err(id, 'art.bodyColor must be hex');
    if (a.tails !== undefined && !(isNum(a.tails) && a.tails >= 0 && a.tails <= 10)) err(id, 'art.tails 0-10');
    return;
  }
  ['skin', 'hairColor', 'outfitColor'].forEach(function (k) { if (!isHex(a[k])) err(id, 'art.' + k + ' must be hex color'); });
  ['eyeColor', 'accentColor', 'aura'].forEach(function (k) { if (a[k] !== undefined && !isHex(a[k])) err(id, 'art.' + k + ' must be hex color'); });
  if (!inEnum(a.hair, A.hair)) err(id, 'art.hair unknown "' + a.hair + '"');
  if (!inEnum(a.eyes, A.eyes)) err(id, 'art.eyes unknown "' + a.eyes + '"');
  ['eyeL', 'eyeR'].forEach(function (k) { if (a[k] !== undefined && !inEnum(a[k], A.eyes)) err(id, 'art.' + k + ' unknown "' + a[k] + '"'); });
  if (!inEnum(a.outfit, A.outfit)) err(id, 'art.outfit unknown "' + a.outfit + '"');
  if (a.headband !== undefined && !inEnum(a.headband, A.headband)) err(id, 'art.headband unknown "' + a.headband + '"');
  if (a.headbandPos !== undefined && !inEnum(a.headbandPos, A.headbandPos)) err(id, 'art.headbandPos unknown "' + a.headbandPos + '"');
  if (a.mask !== undefined && !inEnum(a.mask, A.mask)) err(id, 'art.mask unknown "' + a.mask + '"');
  if (a.hat !== undefined && !inEnum(a.hat, A.hat)) err(id, 'art.hat unknown "' + a.hat + '"');
  if (a.accessory !== undefined && !inEnum(a.accessory, A.accessory)) err(id, 'art.accessory unknown "' + a.accessory + '"');
  if (a.marks !== undefined) {
    if (!Array.isArray(a.marks)) err(id, 'art.marks must be array');
    else a.marks.forEach(function (m) { if (!inEnum(m, A.marks)) err(id, 'art.marks unknown "' + m + '"'); });
  }
}

var seenNames = {};
NG.CHARS.forEach(function (c) {
  var id = c.id;
  if (!/^[a-z][a-z0-9_]*$/.test(id)) err(id, 'id must be snake_case ascii');
  if (typeof c.name !== 'string' || !CJK.test(c.name)) err(id, 'name must be Chinese');
  if (c.form !== undefined && typeof c.form !== 'string') err(id, 'form must be string');
  if (typeof c.en !== 'string' || !c.en) err(id, 'en (romaji) required');
  if (typeof c.title !== 'string' || !c.title) warn(id, 'title (称号) missing');
  if (!NG.FACTIONS[c.faction]) err(id, 'faction unknown "' + c.faction + '"');
  if (!NG.RARITIES[c.rarity]) err(id, 'rarity unknown "' + c.rarity + '"');
  if (!NG.ROLES[c.role]) err(id, 'role unknown "' + c.role + '"');
  if (!NG.ELEMENTS[c.element]) err(id, 'element unknown "' + c.element + '"');
  checkTags(id, 'char', c.tags);
  if (!c.stats) err(id, 'stats missing');
  else {
    ['hp', 'atk', 'def'].forEach(function (k) { if (!isNum(c.stats[k]) || c.stats[k] < 0.8 || c.stats[k] > 1.25) err(id, 'stats.' + k + ' must be a multiplier in [0.8,1.25]'); });
    if (!isNum(c.stats.spd) || c.stats.spd < 70 || c.stats.spd > 150) err(id, 'stats.spd must be 70-150');
  }
  if (typeof c.bio !== 'string' || c.bio.length < 12) err(id, 'bio (Chinese, 1-3 sentences) required');
  if (typeof c.quote !== 'string' || !c.quote) warn(id, 'quote missing');
  checkArt(id, c.art, c);
  if (!c.skills) { err(id, 'skills missing'); return; }
  NG.SKILL_KEYS.forEach(function (k) {
    var s = c.skills[k];
    if (!s) { err(id, 'skills.' + k + ' missing'); return; }
    if (typeof s.name !== 'string' || !CJK.test(s.name)) err(id, k + '.name must be Chinese');
    if (typeof s.desc !== 'string' || s.desc.length < 8) err(id, k + '.desc required (Chinese)');
    checkTags(id, k, s.tags);
    if (k === 'passive' || k === 'awaken') checkPassive(id, k, s);
    else checkActive(id, k, s);
  });
  var full = c.name + '|' + (c.form || '');
  if (seenNames[full]) warn(id, 'same name+form as ' + seenNames[full]);
  seenNames[full] = id;
});

// Roster cross-check
var fileIds = files.map(function (f) { return path.basename(f, '.js'); });
var expected = ROSTER.filter(function (r) { return fileIds.indexOf(r.file) !== -1; });
expected.forEach(function (r) {
  var c = NG.CHAR_MAP[r.id];
  if (!c) { err(r.id, 'MISSING: roster assigns it to ' + r.file + '.js but it is not defined'); return; }
  if (c.rarity !== r.rarity) err(r.id, 'rarity ' + c.rarity + ' != roster ' + r.rarity);
  if (c.faction !== r.faction) err(r.id, 'faction ' + c.faction + ' != roster ' + r.faction);
  if (c._file !== r.file) warn(r.id, 'defined in ' + c._file + ' but roster file is ' + r.file);
});
var rosterIds = {}; ROSTER.forEach(function (r) { rosterIds[r.id] = r; });
NG.CHARS.forEach(function (c) { if (!rosterIds[c.id]) warn(c.id, 'not in master roster (extra character)'); });

warnings.forEach(function (w) { console.log('WARN  ' + w); });
errors.forEach(function (e) { console.log('ERROR ' + e); });
console.log('\nChecked ' + NG.CHARS.length + ' characters in ' + files.length + ' file(s); roster expects ' + expected.length +
  '. ' + errors.length + ' error(s), ' + warnings.length + ' warning(s).');
process.exit(errors.length ? 1 : 0);
