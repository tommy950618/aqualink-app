// MakeHuman-style macro weighting and detail-target resolution (own implementation, data-driven by
// MPFB's CC0 targets/macrodetails/macro.json and targets/target.json).
//
// Macro maths (same behaviour as MakeHuman 1.x / MPFB2):
//   Each macro slider value v in [0,1] is split into (name, weight) components using the "parts" table
//   of macro.json: for every part with lowest < v < highest, t = (v - lowest) / (highest - lowest),
//   component low gets 1 - t and component high gets t (an empty name means "no target").
//   gender:      female .. male                         (one part, -0.01..1.01)
//   age:         baby..child (<0.1875), child..young (<0.5), young..old (>=0.5)
//   muscle:      minmuscle..averagemuscle (<0.5), averagemuscle..maxmuscle (>=0.5)
//   weight:      minweight..averageweight (<0.5), averageweight..maxweight (>=0.5)
//   height:      minheight..'' (<0.49), dead zone 0.49..0.51, ''..maxheight (>0.51)
//   proportions: uncommonproportions..'' (<0.5), ''..idealproportions (>=0.5)
//   The race weights (african, asian, caucasian) are normalised to sum 1.
//   Target files and their weights (products of component weights; kept when weight > cutoff 0.01):
//     macrodetails/<race>-<gender>-<age>                                   w_race * w_g * w_a
//     macrodetails/universal-<gender>-<age>-<muscle>-<weight>              w_g * w_a * w_m * w_w
//     macrodetails/height/<gender>-<age>-<muscle>-<weight>-<height>         ... * w_h
//     macrodetails/proportions/<gender>-<age>-<muscle>-<weight>-<prop>      ... * w_p   (no baby files)
//   (Breast cup/firmness targets only exist for female components and are not used for these players.)
import fs from 'node:fs';
import zlib from 'node:zlib';

export const MACRO_CUTOFF = 0.01;

// MakeHuman age slider: 0 -> 1 year, 0.1875 -> 11, 0.5 -> 25, 1 -> 90 years.
export function ageYearsToSlider(years) {
  if (years < 11) return Math.max(0, (years - 1) / 10 * 0.1875);
  if (years < 25) return 0.1875 + (years - 11) / 14 * (0.5 - 0.1875);
  return Math.min(1, 0.5 + (years - 25) / 65 * 0.5);
}

export function interpolateMacro(macroTable, name, value) {
  const def = macroTable.macrotargets[name];
  if (!def) throw new Error(`unknown macro ${name}`);
  const out = [];
  for (const p of def.parts) {
    if (value > p.lowest && value < p.highest) {
      const t = (value - p.lowest) / (p.highest - p.lowest);
      if (p.low) out.push([p.low, 1 - t]);
      if (p.high) out.push([p.high, t]);
    }
  }
  return out;
}

export function normaliseMacro(m = {}) {
  const race = { african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3, ...(m.race || {}) };
  const sum = race.african + race.asian + race.caucasian;
  if (!(sum > 0)) throw new Error('race weights must sum > 0');
  const age = m.ageYears != null ? ageYearsToSlider(m.ageYears) : (m.age ?? 0.5);
  return {
    gender: m.gender ?? 1, age, muscle: m.muscle ?? 0.5, weight: m.weight ?? 0.5,
    height: m.height ?? 0.5, proportions: m.proportions ?? 0.5,
    race: { african: race.african / sum, asian: race.asian / sum, caucasian: race.caucasian / sum },
  };
}

// Returns [[relativePathUnderData, weight], ...] for the macro state.
export function macroTargetList(macroTable, macroIn, cutoff = MACRO_CUTOFF) {
  const m = normaliseMacro(macroIn);
  const c = {};
  for (const k of ['gender', 'age', 'muscle', 'weight', 'height', 'proportions']) c[k] = interpolateMacro(macroTable, k, m[k]);
  const out = [];
  const push = (file, w) => { if (w > cutoff) out.push([`targets/macrodetails/${file}.target.gz`, w]); };
  for (const race of ['african', 'asian', 'caucasian']) {
    const wr = m.race[race];
    if (wr <= 1e-4) continue;
    for (const [g, wg] of c.gender) for (const [a, wa] of c.age) push(`${race}-${g}-${a}`, wr * wg * wa);
  }
  for (const [g, wg] of c.gender) for (const [a, wa] of c.age) for (const [mu, wm] of c.muscle) for (const [we, ww] of c.weight) {
    const base = wg * wa * wm * ww;
    push(`universal-${g}-${a}-${mu}-${we}`, base);
    for (const [h, wh] of c.height) push(`height/${g}-${a}-${mu}-${we}-${h}`, base * wh);
    if (a !== 'baby') for (const [p, wp] of c.proportions) push(`proportions/${g}-${a}-${mu}-${we}-${p}`, base * wp);
  }
  return out;
}

// Detail modifiers. Config keys are "<group>/<modifier>" from target.json (e.g. "nose/nose-flaring-decr-incr")
// with a signed value in [-1, 1]; positive picks the "incr"/"up"/... target, negative the opposite one with
// |value|. Left/right modifiers apply to both sides; pass {"l": x, "r": y} to set sides separately.
// A key may also name a raw target file "<group>/<target>" (e.g. "nose/nose-flaring-incr") with a weight.
export function detailTargetList(targetIndex, details = {}) {
  const out = [];
  for (const [key, val] of Object.entries(details)) {
    const [group, name] = key.split('/');
    const g = targetIndex[group];
    if (!g || !name) throw new Error(`bad detail target key ${key}`);
    const cat = g.categories.find((c) => c.name === name);
    if (!cat) {
      const raw = g.categories.some((c) => c.targets.includes(name));
      if (!raw) throw new Error(`unknown detail modifier/target ${key}`);
      if (typeof val !== 'number') throw new Error(`raw target ${key} needs a number`);
      if (val !== 0) out.push([`targets/${group}/${name}.target.gz`, val]);
      continue;
    }
    const o = cat.opposites;
    if (!o) {
      // single-target modifier (head-square, head-oval, chin-triangle, ...): weight in [0, 1]
      if (typeof val !== 'number' || val < 0) throw new Error(`${key} is a one-sided modifier: use a weight >= 0`);
      if (val > 0) out.push([`targets/${group}/${cat.targets[0]}.target.gz`, val]);
      continue;
    }
    const sides = cat.has_left_and_right
      ? (typeof val === 'object' ? [['left', val.l ?? 0], ['right', val.r ?? 0]] : [['left', val], ['right', val]])
      : [['unsided', val]];
    for (const [side, v] of sides) {
      if (typeof v !== 'number' || v === 0) continue;
      const t = v > 0 ? o[`positive-${side}`] : o[`negative-${side}`];
      if (!t) throw new Error(`modifier ${key} has no ${v > 0 ? 'positive' : 'negative'}-${side} target`);
      out.push([`targets/${group}/${t}.target.gz`, Math.abs(v)]);
    }
  }
  return out;
}

// Parses a gzip'd MakeHuman target ("index dx dy dz" per line, '#' comments) as data.
export function readTarget(file) {
  const txt = zlib.gunzipSync(fs.readFileSync(file)).toString('latin1');
  const idx = [], d = [];
  for (const line of txt.split('\n')) {
    const s = line.trim();
    if (!s || s[0] === '#') continue;
    const p = s.split(/\s+/);
    if (p.length < 4) continue;
    const i = parseInt(p[0], 10);
    const x = +p[1], y = +p[2], z = +p[3];
    if (!Number.isFinite(i) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    idx.push(i); d.push(x, y, z);
  }
  return { idx: Int32Array.from(idx), d: Float64Array.from(d) };
}

export function applyTarget(pos, target, w) {
  const { idx, d } = target;
  const n = pos.length / 3;
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    if (i < 0 || i >= n) continue;
    pos[i * 3] += w * d[k * 3];
    pos[i * 3 + 1] += w * d[k * 3 + 1];
    pos[i * 3 + 2] += w * d[k * 3 + 2];
  }
}
