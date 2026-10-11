/**
 * calibrate.mjs — solves the calibration knobs per player against meta.calibration (unchanged knob set, v2 reads
 * the edited targets of SPEC-v2 §10.3: Giannis headH 0.232 / craniumFace 1.10, Kobe craniumFace 0.95).
 * Each iteration re-bakes with `bake(…, {fast: true})` (no shells, morphs, masks or LODs) and re-measures.
 */
// Solves a few "calibration knobs" per player so the baked body hits measured anthropometrics, keeping every
// likeness modifier of the config untouched. Targets live in players[].meta.calibration:
//   { headH, shoulderJoints, wingspan, handLen, footLen, massKg }   (metres / kg, see measure.mjs)
// Knobs (and their approximate gains at fixed height, measured on a 1.96 m male):
//   craniumFace    forehead/forehead-scale-vert-decr-incr      crown->eye / eye->chin ratio, about +0.3 per +1
//   headH          head/head-scale-vert-decr-incr              +3.6 cm head height per +1
//   shoulderJoints torso/measure-shoulder-dist-decr-incr        +5.0 cm (and +5 cm span) per +1
//   handLen        hands/hand-scale-decr-incr                   +5.5 cm (and +12 cm span) per +1
//   footLen        feet/foot-scale-decr-incr                    +7.1 cm per +1
//   wingspan       arms/measure-upper|lowerarm-length (both)    +27 cm per +1 on both
//   massKg         macro.weight                                 about +45 kg (estimated mass) per +1
// Gauss-Seidel with re-measurement after each bake; values are clamped to [-1, 1] (weight to [0.2, 0.8]).
//
//   node tools/legends/calibrate.mjs <config.json> [--iters 4] [--write]
// Without --write it only prints the proposed knob values and the residuals.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { bake, loadConfig } from './bake.mjs';
import { measureHeader } from './measure.mjs';
import { formatJson } from './lib/json.mjs';

const KNOBS = [
  { metric: 'craniumFace', keys: ['forehead/forehead-scale-vert-decr-incr'], gain: 0.22 },
  { metric: 'headH', keys: ['head/head-scale-vert-decr-incr'], gain: 0.036 },
  { metric: 'shoulderJoints', keys: ['torso/measure-shoulder-dist-decr-incr'], gain: 0.05, span: 0.05 },
  { metric: 'handLen', keys: ['hands/hand-scale-decr-incr'], gain: 0.055, span: 0.12 },
  { metric: 'footLen', keys: ['feet/foot-scale-decr-incr'], gain: 0.071 },
  { metric: 'massKg', macro: 'weight', gain: 45, lo: 0.2, hi: 0.8 },
  { metric: 'wingspan', keys: ['arms/measure-upperarm-length-decr-incr', 'arms/measure-lowerarm-length-decr-incr'], gain: 0.27 },
];
const TOL = { craniumFace: 0.02, headH: 0.002, shoulderJoints: 0.002, handLen: 0.002, footLen: 0.002, massKg: 1.5, wingspan: 0.006 };

const args = process.argv.slice(2);
const cfgFile = path.resolve(args.find((a) => a.endsWith('.json')) || '');
if (!fs.existsSync(cfgFile)) { console.error('usage: node calibrate.mjs <config.json> [--iters n] [--write]'); process.exit(2); }
const iters = +(args[args.indexOf('--iters') + 1] || 4) || 4;
const cfg = loadConfig(cfgFile);
const work = { ...cfg, lods: [], players: cfg.players.map((p) => ({ ...p, targets: { ...p.targets }, macro: { ...p.macro } })) };
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legends-cal-'));
const clamp = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;


async function measureAll() {
  const log = console.log; console.log = () => {};
  try { await bake(work, { outDir, name: 'cal', fast: true }); } finally { console.log = log; }
  return Object.fromEntries(measureHeader(path.join(outDir, 'cal.json')).map((m) => [m.id, m]));
}

let m = await measureAll();
for (let it = 0; it < iters; it++) {
  let worst = 0;
  for (const p of work.players) {
    const cal = p.meta?.calibration; if (!cal) continue;
    const got = m[p.id];
    let spanShift = 0;
    for (const k of KNOBS) {
      if (cal[k.metric] == null) continue;
      let err = cal[k.metric] - got[k.metric];
      if (k.metric === 'wingspan') err -= spanShift;          // predicted change from shoulders / hands this round
      worst = Math.max(worst, Math.abs(err) / TOL[k.metric]);
      if (Math.abs(err) < TOL[k.metric] * 0.5) continue;
      const step = err / k.gain;
      if (k.macro) { p.macro[k.macro] = r2(clamp((p.macro[k.macro] ?? 0.5) + step, k.lo, k.hi)); continue; }
      for (const key of k.keys) p.targets[key] = r2(clamp((p.targets[key] ?? 0) + step));
      if (k.span) spanShift += step * k.span;
    }
  }
  m = await measureAll();
  console.log(`iteration ${it + 1}: worst residual before step ${worst.toFixed(1)} x tolerance`);
}

for (const p of work.players) {
  const cal = p.meta?.calibration; if (!cal) continue;
  const got = m[p.id];
  const knobs = Object.fromEntries(KNOBS.flatMap((k) => (k.macro ? [[`macro.${k.macro}`, p.macro[k.macro]]] : k.keys.map((key) => [key, p.targets[key]]))));
  console.log(`\n${p.id}`);
  for (const k of KNOBS) if (cal[k.metric] != null) console.log(`  ${k.metric.padEnd(15)} target ${cal[k.metric]}  got ${got[k.metric]}`);
  console.log('  knobs', JSON.stringify(knobs));
}

if (args.includes('--write')) {
  const raw = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  for (const p of raw.players) {
    const w = work.players.find((x) => x.id === p.id);
    if (!w.meta?.calibration) continue;
    for (const k of KNOBS) {
      if (k.macro) p.macro[k.macro] = w.macro[k.macro];
      else for (const key of k.keys) if (w.targets[key] != null) p.targets[key] = w.targets[key];
    }
  }
  fs.writeFileSync(cfgFile, formatJson(raw) + '\n');
  console.log(`\nwrote knob values into ${cfgFile}`);
}
fs.rmSync(outDir, { recursive: true, force: true });
