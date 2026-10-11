/**
 * ui/settings.js - the settings model of LEGENDS 3v3 (spec v2 section 6.5.10, C17, C28, section 7.4 exposure).
 *
 * Exports
 *   SETTINGS_KEY        'legends3v3.settings.v2' (one JSON object in localStorage)
 *   SETTINGS_SCHEMA     frozen row descriptors in sheet order: {key, label, options, def, optLabel(v), pause}
 *                       pause: 'edit' (editable in the pause menu), 'ro' (read-only there), 'hide' (title sheet only)
 *   CROWD_GAIN          crowd bus gain per crowd option (0.4 / 0.7 / 1.0)
 *   defaultSettings()   plain object of every stored key's default
 *   loadSettings(storage?)  read + validate the stored JSON (invalid / throwing storage -> defaults)
 *   saveSettings(obj, storage?) -> boolean (false when storage throws; the caller keeps the in-memory copy)
 *   parseUrlOverrides(search) session-only overrides from ?intro= ?replay= ?quality= ?diff= ?q= ?clear= ?autoswitch= ?kits=
 *   class Settings      get(key) / set(key, value) / onChange(cb) / all() / crowdGain() / bindExternal(key, adapter)
 *   createSettings({storage, search})
 *
 * Storage rules (H11): every localStorage access is inside try/catch with an in-memory fallback. Language keeps the v1
 * i18n key (`hoop.lang`, through i18n.setLang) and sound keeps the v1 audio key (`hoop.muted`, '1' = muted), as the
 * spec requires; `kits` is the lineup's `kits` field (one stored value, C17) and is delegated to an adapter that the
 * integrator binds to `lineup.js` (`bindExternal('kits', {get, set})`); until bound it lives in memory.
 * URL overrides apply to the session only and are never persisted; a user change of that key drops the override.
 */
import { getLang, setLang, onLangChange } from '../i18n.js';

export const SETTINGS_KEY = 'legends3v3.settings.v2';
const MUTE_KEY = 'hoop.muted';

export const CROWD_GAIN = Object.freeze({ low: 0.4, mid: 0.7, high: 1.0 });

const QUARTER_SECONDS = [60, 120, 180, 300];

/** Row descriptors in the order of the settings sheet (6.5.10). */
export const SETTINGS_SCHEMA = Object.freeze([
  row('quality', 'settings.quality', ['auto', 'low', 'medium', 'high'], 'auto', 'edit', (v) => 'settings.quality.' + v),
  row('lang', 'settings.lang', ['zh', 'en'], 'zh', 'edit', (v) => 'menu.lang.' + v),
  row('sound', 'settings.sound', [true, false], true, 'edit', (v) => (v ? 'common.on' : 'common.off')),
  row('crowd', 'settings.crowd', ['low', 'mid', 'high'], 'mid', 'edit', (v) => 'settings.crowd.' + v),
  row('camera', 'settings.camera', ['standard', 'close', 'high'], 'standard', 'edit', (v) => 'settings.camera.' + v),
  row('difficulty', 'settings.difficulty', ['easy', 'normal', 'hard'], 'normal', 'ro', (v) => 'diff.' + v),
  row('quarter', 'settings.quarter', QUARTER_SECONDS, 120, 'hide', () => 'settings.quarter.n'),
  row('replays', 'settings.replays', ['off', 'dunks', 'all'], 'dunks', 'edit', (v) => 'settings.replays.' + v),
  row('intro', 'settings.intro', ['full', 'short', 'off'], 'full', 'hide', (v) => 'settings.intro.' + v),
  row('kits', 'settings.kits', ['auto', 'classic', 'allstar'], 'auto', 'hide', (v) => 'lineup.kits.' + v),
  row('clear', 'settings.clear', [false, true], false, 'ro', (v) => (v ? 'common.on' : 'common.off')),
  row('autoSwitch', 'settings.autoSwitch', [true, false], true, 'ro', (v) => (v ? 'common.on' : 'common.off')),
]);

function row(key, label, options, def, pause, optLabel) {
  return Object.freeze({ key, label, options: Object.freeze(options.slice()), def, pause, optLabel });
}

const BY_KEY = Object.create(null);
for (let i = 0; i < SETTINGS_SCHEMA.length; i++) BY_KEY[SETTINGS_SCHEMA[i].key] = SETTINGS_SCHEMA[i];

/** Keys persisted inside the settings JSON (lang, sound and kits have their own homes). */
const STORED_KEYS = SETTINGS_SCHEMA.map((r) => r.key).filter((k) => k !== 'lang' && k !== 'sound' && k !== 'kits');

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (err) {
    return null;   // reading the localStorage property itself throws in some sandboxed iframes
  }
}

function valid(key, v) {
  const r = BY_KEY[key];
  return !!r && r.options.indexOf(v) >= 0;
}

export function defaultSettings() {
  const out = {};
  for (let i = 0; i < STORED_KEYS.length; i++) out[STORED_KEYS[i]] = BY_KEY[STORED_KEYS[i]].def;
  return out;
}

/** Read the stored JSON; every invalid field falls back to its default; a throwing storage yields the defaults. */
export function loadSettings(storage) {
  const out = defaultSettings();
  const st = storage === undefined ? defaultStorage() : storage;
  if (!st) return out;
  let raw = null;
  try {
    raw = st.getItem(SETTINGS_KEY);
  } catch (err) {
    return out;
  }
  if (!raw) return out;
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    return out;
  }
  if (!obj || typeof obj !== 'object') return out;
  for (let i = 0; i < STORED_KEYS.length; i++) {
    const k = STORED_KEYS[i];
    if (valid(k, obj[k])) out[k] = obj[k];
  }
  return out;
}

/** Persist the stored keys of `obj`; returns false (and keeps nothing) when the storage throws. */
export function saveSettings(obj, storage) {
  const st = storage === undefined ? defaultStorage() : storage;
  if (!st) return false;
  const clean = {};
  for (let i = 0; i < STORED_KEYS.length; i++) {
    const k = STORED_KEYS[i];
    clean[k] = valid(k, obj[k]) ? obj[k] : BY_KEY[k].def;
  }
  try {
    st.setItem(SETTINGS_KEY, JSON.stringify(clean));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Session-only overrides from the URL (spec 5.12.6, 6.5.1): intro=0|short|full, replay=0, quality=low|medium|high,
 * diff=easy|normal|hard, q=<minutes, may be fractional> (quarter seconds = q * 60, any positive value), clear=0|1,
 * autoswitch=0|1, kits=auto|classic|allstar.
 */
export function parseUrlOverrides(search) {
  const out = {};
  let sp = null;
  try {
    sp = new URLSearchParams(typeof search === 'string' ? search : '');
  } catch (err) {
    return out;
  }
  const intro = sp.get('intro');
  if (intro === '0' || intro === 'off') out.intro = 'off';
  else if (intro === 'short' || intro === 'full') out.intro = intro;
  const replay = sp.get('replay');
  if (replay === '0' || replay === 'off') out.replays = 'off';
  else if (replay === 'dunks' || replay === 'all') out.replays = replay;
  const quality = sp.get('quality');
  if (quality === 'low' || quality === 'medium' || quality === 'high') out.quality = quality;
  const diff = sp.get('diff');
  if (diff === 'easy' || diff === 'normal' || diff === 'hard') out.difficulty = diff;
  const q = parseFloat(sp.get('q'));
  if (Number.isFinite(q) && q > 0) out.quarter = q * 60;
  const clear = sp.get('clear');
  if (clear === '0' || clear === '1') out.clear = clear === '1';
  const auto = sp.get('autoswitch');
  if (auto === '0' || auto === '1') out.autoSwitch = auto === '1';
  const kits = sp.get('kits');
  if (kits === 'auto' || kits === 'classic' || kits === 'allstar') out.kits = kits;
  return out;
}

export class Settings {
  /**
   * @param {{storage?: Storage|null, search?: string, overrides?: object}} [opts]
   *   storage: injected for tests (defaults to window.localStorage when reachable); search: location.search
   */
  constructor(opts) {
    const o = opts || {};
    this._storage = o.storage === undefined ? defaultStorage() : o.storage;
    this._values = loadSettings(this._storage);
    this._overrides = Object.assign(parseUrlOverrides(o.search || ''), o.overrides || null);
    this._listeners = [];
    this._external = Object.create(null);
    this._kitsMemory = BY_KEY.kits.def;
    this._soundMemory = this._readSound();
    this._persisted = true;
    // Language may change from elsewhere (T key, title chip): forward it as a settings change.
    this._unsubLang = onLangChange((l) => this._emit('lang', l));
  }

  _readSound() {
    try {
      if (this._storage) return this._storage.getItem(MUTE_KEY) !== '1';
    } catch (err) {
      // fall through to the default
    }
    return true;
  }

  /** Current value of a schema key (URL override first, then the stored / delegated value). */
  get(key) {
    if (key === 'lang') return getLang();
    if (Object.prototype.hasOwnProperty.call(this._overrides, key)) return this._overrides[key];
    if (key === 'sound') return this._soundMemory;
    if (key === 'kits') {
      const ext = this._external.kits;
      if (ext && typeof ext.get === 'function') {
        const v = ext.get();
        if (valid('kits', v)) return v;
      }
      return this._kitsMemory;
    }
    if (Object.prototype.hasOwnProperty.call(this._values, key)) return this._values[key];
    return undefined;
  }

  /** True when the current value of `key` comes from a URL override (session only). */
  isOverridden(key) {
    return Object.prototype.hasOwnProperty.call(this._overrides, key);
  }

  /** Change a setting; invalid values are ignored. Returns true when the value changed. */
  set(key, value) {
    if (!valid(key, value)) return false;
    const before = this.get(key);
    if (key === 'lang') {
      setLang(value);   // persists under the v1 key and emits through onLangChange
      return before !== value;
    }
    delete this._overrides[key];
    if (key === 'sound') {
      this._soundMemory = !!value;
      try {
        if (this._storage) this._storage.setItem(MUTE_KEY, value ? '0' : '1');
      } catch (err) {
        // in-memory only
      }
    } else if (key === 'kits') {
      const ext = this._external.kits;
      if (ext && typeof ext.set === 'function') ext.set(value);
      this._kitsMemory = value;
    } else {
      this._values[key] = value;
      this._persisted = saveSettings(this._values, this._storage);
    }
    if (before !== value) this._emit(key, value);
    return before !== value;
  }

  /** Delegate a key's storage to an adapter {get(), set(v)} (used for `kits` -> lineup.kits). */
  bindExternal(key, adapter) {
    if (key !== 'kits' || !adapter) return;
    this._external.kits = adapter;
  }

  /** Subscribe (key, value) => void; returns an unsubscribe function. */
  onChange(cb) {
    if (typeof cb !== 'function') return () => {};
    this._listeners.push(cb);
    return () => {
      const i = this._listeners.indexOf(cb);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  /** Notify listeners that `key` changed elsewhere (e.g. the M key toggled the mute in audio.js). */
  notifyExternal(key, value) {
    if (key === 'sound') this._soundMemory = !!value;
    this._emit(key, this.get(key));
  }

  _emit(key, value) {
    for (let i = 0; i < this._listeners.length; i++) {
      try {
        this._listeners[i](key, value);
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[settings] listener failed', err);
      }
    }
  }

  /** Snapshot of every schema key's current value. */
  all() {
    const out = {};
    for (let i = 0; i < SETTINGS_SCHEMA.length; i++) out[SETTINGS_SCHEMA[i].key] = this.get(SETTINGS_SCHEMA[i].key);
    return out;
  }

  /** Crowd bus gain of the current crowd option. */
  crowdGain() {
    return CROWD_GAIN[this.get('crowd')] || CROWD_GAIN.mid;
  }

  /** False after a write failed (storage throwing); values still work in memory. */
  get persisted() {
    return this._persisted;
  }

  dispose() {
    if (this._unsubLang) this._unsubLang();
    this._unsubLang = null;
    this._listeners.length = 0;
  }
}

export function createSettings(opts) {
  return new Settings(opts);
}

/** Schema row for a key (or undefined). */
export function schemaRow(key) {
  return BY_KEY[key];
}
