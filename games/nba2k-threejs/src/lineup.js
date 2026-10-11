/**
 * @module lineup
 * Lineup logic (spec §5.12, §1.4 `lineup = { a: [id,id,id], b: [id,id,id], user: 'a'|'b', kits: 'auto'|'classic'|
 * 'allstar' }`): validation, swaps, the ★ handler, seeded shuffle, reset, kit-mode and team-name resolution,
 * persistence (`localStorage['legends3v3.lineup.v1']`, every access in try/catch with an in-memory fallback), URL
 * parsing, and the CPU check-ball receiver pick (§5.12.4).
 *
 * Pure functions: every mutator returns a NEW lineup object (the lineup screen re-renders from the returned value);
 * inputs are never modified. Slot indices are 0–2 = team A (index 0 = ★ handler), 3–5 = team B.
 */
import { LEGENDS, LEGEND_IDS, DEFAULT_LINEUP, isLegendId } from './legends.js';

/** localStorage key of the stored lineup. */
export const LINEUP_STORAGE_KEY = 'legends3v3.lineup.v1';
/** XOR applied to the gameplay seed for the shuffle Rng: `new Rng(seed ^ SHUFFLE_SEED_XOR)`. */
export const SHUFFLE_SEED_XOR = 0x5EED;
/** Allowed `kits` values (C17). */
export const KIT_OPTIONS = Object.freeze(['auto', 'classic', 'allstar']);
/** Max consecutive checks for one CPU player before he is excluded from the re-roll (§5.12.4). */
export const MAX_CONSECUTIVE_CHECKS = 3;

/** A fresh, mutable copy of a lineup. */
export function copyLineup(l) {
  return { a: [l.a[0], l.a[1], l.a[2]], b: [l.b[0], l.b[1], l.b[2]], user: l.user, kits: l.kits };
}

/** The default lineup (§2.9) as a fresh object: DARK vs BRIGHT, user A, kits auto. */
export function resetLineup() {
  return copyLineup(DEFAULT_LINEUP);
}

function validTeams(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 3 || b.length !== 3) return false;
  const seen = {};
  for (let i = 0; i < 6; i++) {
    const id = i < 3 ? a[i] : b[i - 3];
    if (!isLegendId(id) || seen[id]) return false;
    seen[id] = true;
  }
  return true;
}

/** True when `l` is a complete valid lineup: 3 + 3 distinct legend ids, user 'a'|'b', kits one of KIT_OPTIONS. */
export function validateLineup(l) {
  return !!l && typeof l === 'object' && validTeams(l.a, l.b) && (l.user === 'a' || l.user === 'b')
    && KIT_OPTIONS.indexOf(l.kits) >= 0;
}

/**
 * A valid copy of `l`: the teams must be a 3 + 3 split of the six (else null); a missing or invalid `user` / `kits`
 * falls back to the default ('a' / 'auto').
 */
export function normalizeLineup(l) {
  if (!l || typeof l !== 'object' || !validTeams(l.a, l.b)) return null;
  return {
    a: [l.a[0], l.a[1], l.a[2]], b: [l.b[0], l.b[1], l.b[2]],
    user: l.user === 'b' ? 'b' : 'a',
    kits: KIT_OPTIONS.indexOf(l.kits) >= 0 ? l.kits : DEFAULT_LINEUP.kits,
  };
}

function sameSet(team, ids) {
  for (let i = 0; i < 3; i++) if (ids.indexOf(team[i]) < 0) return false;
  return true;
}

/**
 * True when the lineup equals the default as sets (§5.12.3): {LeBron, Kyrie, Giannis} vs {Jordan, Kobe, Yao}, either
 * side, any order. `user` and `kits` are ignored.
 */
export function isDefaultLineup(l) {
  const A = DEFAULT_LINEUP.a, B = DEFAULT_LINEUP.b;
  return (sameSet(l.a, A) && sameSet(l.b, B)) || (sameSet(l.a, B) && sameSet(l.b, A));
}

/** Legend id in slot i (0–2 team A, 3–5 team B). */
export function slotId(l, i) {
  return i < 3 ? l.a[i] : l.b[i - 3];
}

/** Slot index of a legend id in the lineup, or −1. */
export function slotOf(l, id) {
  const i = l.a.indexOf(id);
  if (i >= 0) return i;
  const j = l.b.indexOf(id);
  return j >= 0 ? 3 + j : -1;
}

/**
 * Swap the players of slots i and j (§5.12.2): different teams → the two change teams; the same team → they swap
 * order (which changes the ★ handler when index 0 is involved). Returns a new lineup.
 */
export function swap(l, i, j) {
  const out = copyLineup(l);
  if (i === j || i < 0 || j < 0 || i > 5 || j > 5) return out;
  const ti = i < 3 ? out.a : out.b, tj = j < 3 ? out.a : out.b;
  const ii = i % 3, jj = j % 3;
  const tmp = ti[ii];
  ti[ii] = tj[jj];
  tj[jj] = tmp;
  return out;
}

/** Make the player of slot i the ★ handler of his team (swap with index 0). Returns a new lineup. */
export function setHandler(l, i) {
  if (i < 0 || i > 5) return copyLineup(l);
  return swap(l, i, i < 3 ? 0 : 3);
}

/** The user's side ('a' | 'b'). Returns a new lineup. */
export function setUser(l, side) {
  const out = copyLineup(l);
  if (side === 'a' || side === 'b') out.user = side;
  return out;
}

/** The kits option ('auto' | 'classic' | 'allstar'). Returns a new lineup. */
export function setKits(l, kits) {
  const out = copyLineup(l);
  if (KIT_OPTIONS.indexOf(kits) >= 0) out.kits = kits;
  return out;
}

/**
 * Seeded Fisher–Yates of the six into 3 + 3 (§5.12.2); `user` and `kits` are kept. `rng` is the gameplay `Rng`
 * created with `seed ^ SHUFFLE_SEED_XOR` (anything with `int(n)` → [0, n)). Returns a new lineup.
 */
export function shuffle(l, rng) {
  const six = [l.a[0], l.a[1], l.a[2], l.b[0], l.b[1], l.b[2]];
  for (let i = 5; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = six[i]; six[i] = six[j]; six[j] = t;
  }
  return { a: six.slice(0, 3), b: six.slice(3, 6), user: l.user, kits: l.kits };
}

/**
 * Kit modes of the two teams (§5.12.3, C17): default lineup with kits auto/classic → 'classic' for both; kits
 * 'allstar', or 'auto' with a custom lineup → A 'allstarA', B 'allstarB'; 'classic' with a custom lineup → 'classic'
 * for both (the screen warns `lineup.clash`). Writes `{a, b}` into `out` (fresh object by default).
 */
export function resolveKitModes(l, out = {}) {
  const def = isDefaultLineup(l);
  if (l.kits === 'allstar' || (l.kits !== 'classic' && !def)) {
    out.a = 'allstarA'; out.b = 'allstarB';
  } else {
    out.a = 'classic'; out.b = 'classic';
  }
  return out;
}

/**
 * Team ids (keys of `TEAMS_V2` / `TEAM_UI`) of the two sides (§5.12.3): the default lineup in classic kits names the
 * teams by roster set (DARK = {LeBron, Kyrie, Giannis}, BRIGHT = {Jordan, Kobe, Yao}); every other case is
 * Team White / Team Black (allstarA for side A, allstarB for side B), including a custom lineup forced into classic kits.
 */
export function teamNames(l, out = {}) {
  const modes = resolveKitModes(l, TMP_MODES);
  if (modes.a === 'classic' && isDefaultLineup(l)) {
    const aDark = sameSet(l.a, DEFAULT_LINEUP.a);
    out.a = aDark ? 'dark' : 'bright';
    out.b = aDark ? 'bright' : 'dark';
  } else {
    out.a = 'allstarA'; out.b = 'allstarB';
  }
  return out;
}
const TMP_MODES = { a: null, b: null };

/** True when classic kits are forced on a custom lineup (the `lineup.clash` warning). */
export function kitClash(l) {
  return l.kits === 'classic' && !isDefaultLineup(l);
}

/** True when going from `prev` to `next` switches the kits into All-Star (toast `toast.allstar`, §5.12.2). */
export function entersAllStar(prev, next) {
  return resolveKitModes(prev, TMP_A).a === 'classic' && resolveKitModes(next, TMP_B).a !== 'classic';
}
const TMP_A = { a: null, b: null }, TMP_B = { a: null, b: null };

/** Per-player kit mode of a lineup: `{<id>: 'classic'|'allstarA'|'allstarB'}`. */
export function kitModeById(l, out = {}) {
  const m = resolveKitModes(l, TMP_MODES);
  for (let i = 0; i < 3; i++) { out[l.a[i]] = m.a; out[l.b[i]] = m.b; }
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Persistence (§5.12.6)
// --------------------------------------------------------------------------------------------------------------------

let memoryValue = null;   // in-memory fallback when localStorage is missing or throws (artifact iframe, private mode)

function storageOf(storage) {
  if (storage !== undefined) return storage;
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch (err) {
    return null;
  }
}

/**
 * Stored lineup (`localStorage['legends3v3.lineup.v1']`), or the default when nothing valid is stored. Any storage
 * error falls back to the in-memory copy of the last save. `storage` (optional) replaces `localStorage` (tests).
 */
export function loadLineup(storage) {
  let raw = null;
  const st = storageOf(storage);
  if (st) {
    try {
      raw = st.getItem(LINEUP_STORAGE_KEY);
    } catch (err) {
      raw = null;
    }
  }
  if (raw === null || raw === undefined) raw = memoryValue;
  if (typeof raw !== 'string') return resetLineup();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return resetLineup();
  }
  return validateLineup(parsed) ? normalizeLineup(parsed) : resetLineup();
}

/** Store a lineup `{a, b, user, kits}`; returns true when written to storage (false = memory only / invalid). */
export function saveLineup(l, storage) {
  if (!validateLineup(l)) return false;
  const raw = JSON.stringify({ a: l.a.slice(), b: l.b.slice(), user: l.user, kits: l.kits });
  memoryValue = raw;
  const st = storageOf(storage);
  if (!st) return false;
  try {
    st.setItem(LINEUP_STORAGE_KEY, raw);
    return true;
  } catch (err) {
    return false;
  }
}

/** Forget the in-memory fallback (tests). */
export function clearLineupMemory() {
  memoryValue = null;
}

// --------------------------------------------------------------------------------------------------------------------
// URL (§5.12.6; session only, never persisted)
// --------------------------------------------------------------------------------------------------------------------

/** Parse `lebron,kyrie,giannis~jordan,kobe,yao` into `{a, b}` (case-insensitive ids); null when invalid. */
export function parseLineupParam(str) {
  if (typeof str !== 'string') return null;
  const halves = str.trim().split('~');
  if (halves.length !== 2) return null;
  const a = halves[0].split(',').map((s) => s.trim().toLowerCase());
  const b = halves[1].split(',').map((s) => s.trim().toLowerCase());
  return validTeams(a, b) ? { a, b } : null;
}

/** Inverse of `parseLineupParam`. */
export function formatLineupParam(l) {
  return l.a.join(',') + '~' + l.b.join(',');
}

/**
 * Apply the URL overrides `lineup`, `user`, `kits` (a `URLSearchParams` or a query string) on top of `base`
 * (default: the stored lineup). Invalid values are ignored. Returns a new lineup; nothing is persisted.
 */
export function lineupFromQuery(query, base) {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query;
  let out = base ? normalizeLineup(base) || resetLineup() : loadLineup();
  if (!params) return out;
  const teams = parseLineupParam(params.get('lineup'));
  if (teams) out = { a: teams.a, b: teams.b, user: out.user, kits: out.kits };
  const user = params.get('user');
  if (user === 'a' || user === 'b') out.user = user;
  const kits = params.get('kits');
  if (KIT_OPTIONS.indexOf(kits) >= 0) out.kits = kits;
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Check ball (§5.12.4)
// --------------------------------------------------------------------------------------------------------------------

/**
 * Normalised `tend.checkShare` weights of a roster (three ids) written into `out[0..2]` (default BRIGHT
 * .55 / .40 / .05, DARK .50 / .40 / .10).
 */
export function checkWeights(roster, out = [0, 0, 0]) {
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += LEGENDS[roster[i]].tend.checkShare;
  for (let i = 0; i < 3; i++) out[i] = sum > 0 ? LEGENDS[roster[i]].tend.checkShare / sum : 1 / 3;
  return out;
}

/**
 * Weighted CPU check-ball receiver (§5.12.4, R8): a roll over the normalised `checkShare` of the three; a player who
 * received the last 3 checks is excluded from this roll. `state = {lastId, count}` (one per team, reset per game) is
 * updated in place. Returns the roster index.
 */
export function pickCheckReceiver(roster, rng, state) {
  const excluded = state.count >= MAX_CONSECUTIVE_CHECKS ? state.lastId : null;
  let sum = 0;
  for (let i = 0; i < 3; i++) if (roster[i] !== excluded) sum += LEGENDS[roster[i]].tend.checkShare;
  let r = rng.next() * sum;
  let pick = -1;
  for (let i = 0; i < 3; i++) {
    if (roster[i] === excluded) continue;
    pick = i;
    r -= LEGENDS[roster[i]].tend.checkShare;
    if (r < 0) break;
  }
  const id = roster[pick];
  if (id === state.lastId) state.count++;
  else { state.lastId = id; state.count = 1; }
  return pick;
}

/** A fresh check-receiver state. */
export function makeCheckState() {
  return { lastId: null, count: 0 };
}

/** All six ids in lineup order (A then B). */
export function lineupIds(l) {
  return [l.a[0], l.a[1], l.a[2], l.b[0], l.b[1], l.b[2]];
}

/** True when every one of the six legends appears exactly once (sanity for callers that build lineups). */
export function coversAllLegends(l) {
  const ids = lineupIds(l);
  for (const id of LEGEND_IDS) if (ids.indexOf(id) < 0) return false;
  return true;
}
