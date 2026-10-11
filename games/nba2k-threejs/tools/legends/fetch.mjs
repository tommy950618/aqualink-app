/**
 * fetch.mjs — downloads the CC0 MakeHuman / MPFB2 data the legends bake needs into tools/legends/.cache/.
 *
 * Every URL is pinned to one mpfb2 commit (`mpfbRef` in the config, default MPFB_REF below), so the bake input
 * cannot drift with upstream `master`. Every cached file is recorded in the committed lock file
 * `tools/legends/assets.lock.json` (relative path -> byte size + SHA-256, plus the ref and the fetch date); an
 * existing cache file whose hash differs from the lock is an error (the bake exits 1), so drift between
 * machines or a corrupted cache is detected instead of silently changing the baked players.
 *
 * Downloaded files are data only: they are written to the cache and later parsed (OBJ text, JSON, gzip'd target
 * text). Nothing from the cache is executed or imported.
 *
 * CLI:
 *   node fetch.mjs                          core files only (mesh, rigs, weights, indexes)
 *   node fetch.mjs legends.config.json      core + every macro/detail/expression target the config needs
 *   node fetch.mjs --verify                 re-hash every locked file in the cache (exit 1 on any mismatch)
 *
 * Library:
 *   import { ensureAsset, ensureCore, useRef, saveLock, CACHE_DIR } from './fetch.mjs';
 *   useRef(cfg.mpfbRef); await ensureAsset('targets/nose/nose-flaring-incr.target.gz'); saveLock();
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(HERE, '.cache');
export const LOCK_FILE = path.join(HERE, 'assets.lock.json');
/** mpfb2 `master` on 2026-10-10 (git ls-remote); raw.githubusercontent.com serves it by SHA. */
export const MPFB_REF = 'd0a32e57a7f915cb2f2b95410e2117648c7bbb7e';
const REPO_RAW = 'https://raw.githubusercontent.com/makehumancommunity/mpfb2/';

let ref = MPFB_REF;
/** Selects the pinned commit used by every later download (config `mpfbRef`). */
export function useRef(r) {
  if (r == null) return;
  if (!/^[0-9a-f]{40}$/.test(r)) throw new Error(`mpfbRef must be a 40-hex commit SHA, got ${r}`);
  ref = r;
}
export const baseUrl = () => `${REPO_RAW}${ref}/src/mpfb/data/`;

/** Core files (paths relative to the data folder, cached under the same relative path). */
export const CORE = [
  '3dobjs/base.obj',
  'rigs/standard/rig.game_engine.json',
  'rigs/standard/weights.game_engine.json',
  'rigs/standard/rig.default.json',
  'rigs/standard/weights.default.json',
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

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- lock file --------------------------------------------------------------------------------------------
let lock = null;
let lockDirty = false;
const verified = new Set();

function loadLock() {
  if (lock) return lock;
  try { lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); }
  catch { lock = { source: REPO_RAW, mpfbRef: ref, fetchedAt: new Date().toISOString().slice(0, 10), files: {} }; lockDirty = true; }
  if (!lock.files) lock.files = {};
  return lock;
}

/** Writes the lock file (sorted keys, stable diffs) when something was added. */
export function saveLock() {
  if (!lock || !lockDirty) return;
  const files = {};
  for (const k of Object.keys(lock.files).sort()) files[k] = lock.files[k];
  const out = { note: 'SHA-256 of every cached MPFB2 file (CC0) used by the legends bake; fetch.mjs and bake.mjs verify the cache against it.', source: lock.source, mpfbRef: lock.mpfbRef, fetchedAt: lock.fetchedAt, files };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(out, null, 1) + '\n');
  lockDirty = false;
}

function checkLocked(rel, buf) {
  const L = loadLock();
  if (L.mpfbRef !== ref) throw new Error(`assets.lock.json was made for mpfbRef ${L.mpfbRef}, config asks for ${ref}: delete .cache and the lock to re-pin`);
  const e = L.files[rel];
  const h = sha256(buf);
  if (!e) { L.files[rel] = { bytes: buf.length, sha256: h }; lockDirty = true; return; }
  if (e.missing) throw new Error(`${rel} is locked as missing upstream but exists in the cache`);
  if (e.bytes !== buf.length || e.sha256 !== h) throw new Error(`cache drift: ${rel} has sha256 ${h} (${buf.length} B), lock says ${e.sha256} (${e.bytes} B)`);
}

/**
 * Ensures one data file is cached (idempotent) and matches the lock. Returns the absolute path, or null when
 * the server answers 404 (some optional macro combinations do not exist; recorded as `missing` in the lock).
 */
export async function ensureAsset(rel, { retries = 4, quiet = false } = {}) {
  ensureGitignore();
  const dest = cachePath(rel);
  const L = loadLock();
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    if (!verified.has(rel)) { checkLocked(rel, fs.readFileSync(dest)); verified.add(rel); }
    return dest;
  }
  const missMarker = dest + '.404';
  if (fs.existsSync(missMarker) || (L.files[rel] && L.files[rel].missing)) {
    if (!L.files[rel]) { L.files[rel] = { missing: true }; lockDirty = true; }
    return null;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(baseUrl() + rel, { redirect: 'follow' });
      if (res.status === 404) {
        fs.writeFileSync(missMarker, '');
        L.files[rel] = { missing: true }; lockDirty = true;
        if (!quiet) console.warn(`  404 ${rel}`);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error(`bad size ${buf.length}`);
      checkLocked(rel, buf);
      verified.add(rel);
      const tmp = dest + '.part';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      if (!quiet) console.log(`  got ${rel} (${(buf.length / 1024).toFixed(0)} KB)`);
      return dest;
    } catch (e) {
      if (/cache drift|lock/.test(e.message)) throw e;
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

/** Re-hashes every locked file present in the cache; returns the list of problems (empty = clean). */
export function verifyCache() {
  const L = loadLock();
  const bad = [];
  for (const [rel, e] of Object.entries(L.files)) {
    if (e.missing) continue;
    const f = cachePath(rel);
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    if (buf.length !== e.bytes || sha256(buf) !== e.sha256) bad.push(rel);
  }
  return bad;
}

/** Runs `fn` over items with a small concurrency limit. */
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
    if (process.argv.includes('--verify')) {
      const bad = verifyCache();
      if (bad.length) { console.error('cache drift:', bad.join(', ')); process.exit(1); }
      console.log(`cache verified against ${path.basename(LOCK_FILE)} (${Object.keys(loadLock().files).length} entries)`);
      return;
    }
    const cfgArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
    let cfg = null;
    if (cfgArg) {
      const { loadConfig } = await import('./bake.mjs');
      cfg = loadConfig(path.resolve(cfgArg));
      useRef(cfg.mpfbRef);
    }
    console.log(`Fetching MPFB2 data @ ${ref} -> ${CACHE_DIR}`);
    await ensureCore();
    if (cfg) {
      const { requiredTargetFiles } = await import('./bake.mjs');
      const files = await requiredTargetFiles(cfg);
      console.log(`Config needs ${files.length} target files`);
      await pool(files, 6, (f) => ensureAsset(f, { quiet: true }));
    }
    saveLock();
    console.log('done');
  })().catch((e) => { console.error(e.message || e); process.exit(1); });
}
