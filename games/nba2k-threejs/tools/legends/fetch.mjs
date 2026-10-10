// Downloads the CC0 MakeHuman (MPFB2) assets the legends bake needs into tools/legends/.cache/.
// Downloaded files are treated strictly as data: they are written to the cache directory and later
// parsed (OBJ text, JSON, gzip'd target text). Nothing from the cache is ever executed or imported.
//
// CLI:
//   node tools/legends/fetch.mjs                     core files only (mesh, rig, weights, indexes)
//   node tools/legends/fetch.mjs configs/poc.json    core + every macro/detail target the config needs
//
// Library:
//   import { ensureAsset, ensureCore, CACHE_DIR } from './fetch.mjs';
//   await ensureAsset('targets/nose/nose-flaring-incr.target.gz')   -> absolute cache path (or null on 404)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(HERE, '.cache');
export const BASE_URL = 'https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/src/mpfb/data/';

// Core files: path relative to BASE_URL. They are cached under the same relative path.
export const CORE = [
  '3dobjs/base.obj',
  'rigs/standard/rig.game_engine.json',
  'rigs/standard/weights.game_engine.json',
  'targets/target.json',
  'targets/macrodetails/macro.json',
  'mesh_metadata/basemesh_vertex_groups.json',
];

const MAX_BYTES = 16 * 1024 * 1024;   // no MPFB data file we use is anywhere near this
const SAFE_REL = /^[a-z0-9_\-./]+$/i;

function cachePath(rel) {
  if (!SAFE_REL.test(rel) || rel.includes('..') || rel.startsWith('/')) throw new Error(`unsafe asset path: ${rel}`);
  return path.join(CACHE_DIR, rel);
}

function ensureGitignore() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const gi = path.join(CACHE_DIR, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Downloads one file (idempotent: an existing non-empty cache file is reused). Returns the absolute
// path, or null when the server answers 404 (some optional macro combinations do not exist).
export async function ensureAsset(rel, { retries = 4, quiet = false } = {}) {
  ensureGitignore();
  const dest = cachePath(rel);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const missMarker = dest + '.404';
  if (fs.existsSync(missMarker)) return null;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE_URL + rel, { redirect: 'follow' });
      if (res.status === 404) { fs.writeFileSync(missMarker, ''); if (!quiet) console.warn(`  404 ${rel}`); return null; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error(`bad size ${buf.length}`);
      const tmp = dest + '.part';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      if (!quiet) console.log(`  got ${rel} (${(buf.length / 1024).toFixed(0)} KB)`);
      return dest;
    } catch (e) {
      lastErr = e;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(`download failed for ${rel}: ${lastErr && lastErr.message}`);
}

export async function ensureCore(opts) {
  const out = {};
  for (const rel of CORE) out[rel] = await ensureAsset(rel, opts);
  return out;
}

// Runs `fn` over items with a small concurrency limit.
export async function pool(items, n, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); }
  }));
  return res;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    console.log('Fetching core MPFB2 assets ->', CACHE_DIR);
    await ensureCore();
    const cfgArg = process.argv[2];
    if (cfgArg) {
      // Lazy import so the core download works even before bake.mjs exists.
      const { requiredTargetFiles, loadConfig } = await import('./bake.mjs');
      const cfg = loadConfig(path.resolve(cfgArg));
      const files = await requiredTargetFiles(cfg);
      console.log(`Config needs ${files.length} target files`);
      await pool(files, 6, (f) => ensureAsset(f));
    }
    console.log('done');
  })().catch((e) => { console.error(e); process.exit(1); });
}
