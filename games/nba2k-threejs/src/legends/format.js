/**
 * @module legends/format
 * Pure decoder of the baked legends format **version 2** (`tools/legends/FORMAT.md`, spec v2 §3.1–§3.2).
 * No three.js, no DOM: runs in Node (unit tests) and in the browser (library.js).
 *
 * Exports
 *   FORMAT_NAME, FORMAT_VERSION, CUT_KEYS
 *   parseHeader(json, opts?)            → header (validated; throws on a wrong format / version / devOnly bake)
 *   sectionInfo(table, name)            → the section record (throws when missing)
 *   view(buf, sec) | view(buf, table, name) → typed-array view over an ArrayBuffer (no copy)
 *   sectionScale(type, header?)         → multiplier that turns a stored integer into its value
 *   octDecode(oct8, out)                → unit normals (Float32Array, 3 per item)
 *   decodeShell(buf, table, info)       → decoded shell (a/b/t blend data, final UVs, offsets, edges, indices, …)
 *   decodeShared(buf, header)           → shared topology (renderToKept, uv, colour, LOD indices, skin, shells)
 *   decodePlayer(buf, info, shared)     → {id, kept, keptN, morphs, shells, covers}
 *   morphKeptDelta(target, nKept, out?) → Float32Array(nKept·3) kept-space deltas of one sparse target (metres)
 *   keptToRender(src, renderToKept, itemSize, out?) → render-vertex expansion of a kept-space array
 *
 * Section references in the header are NAMES into the section table of the file they live in (FORMAT.md); a
 * section record is `{offset, count, type, itemSize, bytes}` and its typed-array length is `count · itemSize`.
 */

export const FORMAT_NAME = 'legends-mesh';
export const FORMAT_VERSION = 2;

/** Shoe cut (legends.js `kit.shoes.cut`) → key of `players[i].covers` (`shoeCover_<key>`). */
export const CUT_KEYS = Object.freeze({ low: 'low', 'low-mid': 'lowmid', lowmid: 'lowmid', 'mid-high': 'midhigh', midhigh: 'midhigh', high: 'high' });

const CTOR = { u8: Uint8Array, u16: Uint16Array, i16: Int16Array, i8: Int8Array };

/**
 * Storage class and value scale of a section type. Plain integer types scale by 1; normalised types `u8n`/`u16n`
 * by 1/255, 1/65535, with the generalised `u8n*k` / `u16n*k` (optionally suffixed `m` = metres) multiplying by k;
 * `u16q` (positions) and `i16q` (morph deltas) are dequantised by header values (posMin/posStep, morphs.step).
 */
function typeInfo(type) {
  switch (type) {
    case 'u8': return { ctor: Uint8Array, scale: 1 };
    case 'u16': return { ctor: Uint16Array, scale: 1 };
    case 'u8n': return { ctor: Uint8Array, scale: 1 / 255 };
    case 'u16n': return { ctor: Uint16Array, scale: 1 / 65535 };
    case 'u16q': return { ctor: Uint16Array, scale: NaN };
    case 'i16q': return { ctor: Int16Array, scale: NaN };
    case 'oct8': return { ctor: Int8Array, scale: 1 / 127 };
    default: {
      const m = /^(u8|u16)n\*([0-9]*\.?[0-9]+)m?$/.exec(type);
      if (!m) throw new Error(`legends: unknown section type ${type}`);
      return { ctor: CTOR[m[1]], scale: Number(m[2]) / (m[1] === 'u8' ? 255 : 65535) };
    }
  }
}

/** Multiplier from a stored integer to its value for `type` (NaN for the header-dequantised u16q / i16q). */
export function sectionScale(type) {
  return typeInfo(type).scale;
}

/** The section record `name` of `table`; throws a descriptive error when absent. */
export function sectionInfo(table, name) {
  const s = table && table[name];
  if (!s) throw new Error(`legends: missing section ${name}`);
  return s;
}

/**
 * Typed-array view of a section (no copy). Call as `view(buf, sec)` or `view(buf, table, name)`.
 * Validates alignment and bounds so a truncated download fails here with the section name.
 */
export function view(buf, a, b) {
  const sec = b === undefined ? a : sectionInfo(a, b);
  const { ctor } = typeInfo(sec.type);
  const len = sec.count * sec.itemSize;
  const bytes = len * ctor.BYTES_PER_ELEMENT;
  if (sec.offset % ctor.BYTES_PER_ELEMENT !== 0) throw new Error(`legends: misaligned section ${b || sec.type}`);
  if (sec.offset + bytes > buf.byteLength) throw new Error(`legends: section ${b || sec.type} exceeds the file (${sec.offset + bytes} > ${buf.byteLength})`);
  return new ctor(buf, sec.offset, len);
}

/**
 * Validates a header object (or JSON string) and returns it.
 * @param {object|string} json
 * @param {{allowDev?: boolean}} [opts]  `allowDev` accepts a `devOnly` bake (`?debug=1` only, FORMAT.md)
 */
export function parseHeader(json, opts) {
  const h = typeof json === 'string' ? JSON.parse(json) : json;
  if (!h || typeof h !== 'object') throw new Error('legends: header is not an object');
  if (h.format !== FORMAT_NAME || h.version !== FORMAT_VERSION) {
    throw new Error(`legends: unsupported format ${h.format} v${h.version} (need ${FORMAT_NAME} v${FORMAT_VERSION})`);
  }
  if (h.devOnly && !(opts && opts.allowDev)) throw new Error('legends: devOnly bake refused');
  const c = h.counts;
  if (!c || !(c.renderVertices > 0) || !(c.keptVertices > 0) || c.renderVertices > 65535 || c.keptVertices > 65535) {
    throw new Error('legends: bad counts');
  }
  if (!h.shared || !h.shared.sections || !Array.isArray(h.shared.groups) || h.shared.groups.length !== 2) {
    throw new Error('legends: bad shared table');
  }
  if (!Array.isArray(h.bones) || h.bones.length !== c.bones) throw new Error('legends: bone table mismatch');
  if (!Array.isArray(h.players) || h.players.length === 0) throw new Error('legends: no players');
  if (!Array.isArray(h.morphNames) || h.morphNames.length !== 9) throw new Error('legends: morphNames must list 9 channels');
  if (!Array.isArray(h.lods) || h.lods.length !== 3) throw new Error('legends: expected 3 body LODs');
  const S = h.shared.sections;
  for (const n of ['renderToKept', 'uv', 'color', 'index', 'skinIndex', 'skinWeight', 'keptToObj']) sectionInfo(S, n);
  for (const l of h.lods) sectionInfo(S, l.section);
  for (const sh of h.shells || []) for (const k of Object.keys(sh.sections)) sectionInfo(S, sh.sections[k]);
  for (const p of h.players) {
    if (!p.id || !p.file || !(p.bytes > 0) || !p.sections) throw new Error('legends: bad player entry');
    for (const n of ['position', 'normal']) sectionInfo(p.sections, n);
    if (!Array.isArray(p.bones) || p.bones.length !== c.bones) throw new Error(`legends: ${p.id} bones mismatch`);
    for (const sh of p.shells || []) for (const k of Object.keys(sh.sections)) sectionInfo(p.sections, sh.sections[k]);
    for (const k of Object.keys(p.covers || {})) sectionInfo(p.sections, p.covers[k]);
  }
  return h;
}

/**
 * Octahedral normal decode (FORMAT.md `oct8`): two signed bytes / 127 → unit vector.
 * The octahedron's lower half (z < 0) is folded over the diagonals, hence the unfold step.
 * @param {Int8Array} o  2 bytes per normal
 * @param {Float32Array} out  3 floats per normal
 */
export function octDecode(o, out) {
  const n = o.length >> 1;
  for (let i = 0; i < n; i++) {
    let x = o[i * 2] / 127, y = o[i * 2 + 1] / 127;
    const z = 1 - Math.abs(x) - Math.abs(y);
    if (z < 0) {
      const ox = x;
      x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
      y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
    }
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
  }
  return out;
}

function scaled(src, scale) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] * scale;
  return out;
}

/**
 * Decodes one shell (shared or per-player) into plain arrays.
 * UVs: `uv = uvRange[0..1] + stored · uvScale` with `stored` the u16n*2 value in 0..2 (FORMAT.md § Shells).
 * @returns {{name, info, n, a: Uint16Array, b: Uint16Array, t: Float32Array, uv: Float32Array, offsetScale: Float32Array,
 *   edge: Float32Array, index: Uint16Array, lod1: Uint16Array|null, cover: Uint16Array|null, density: Float32Array|null,
 *   fade: Float32Array|null, players: string[]|null}}
 */
export function decodeShell(buf, table, info) {
  const s = info.sections;
  const a = view(buf, table, s.a), b = view(buf, table, s.b);
  const n = a.length;
  if (b.length !== n) throw new Error(`legends: shell ${info.name} a/b length mismatch`);
  const tRaw = view(buf, table, s.t);
  const t = scaled(tRaw, sectionScale(sectionInfo(table, s.t).type));
  const uvRaw = view(buf, table, s.uv);
  const uvSc = sectionScale(sectionInfo(table, s.uv).type);
  const uv = new Float32Array(n * 2);
  const r0 = info.uvRange[0], r1 = info.uvRange[1], k0 = info.uvScale[0], k1 = info.uvScale[1];
  for (let i = 0; i < n; i++) {
    uv[i * 2] = r0 + uvRaw[i * 2] * uvSc * k0;
    uv[i * 2 + 1] = r1 + uvRaw[i * 2 + 1] * uvSc * k1;
  }
  const offsetScale = scaled(view(buf, table, s.offsetScale), sectionScale(sectionInfo(table, s.offsetScale).type));
  const edge = scaled(view(buf, table, s.edge), sectionScale(sectionInfo(table, s.edge).type));
  const index = view(buf, table, s.index);
  const lodSec = info.lods && info.lods[0] ? info.lods[0].section : null;
  const lod1 = lodSec ? view(buf, table, lodSec) : null;
  const cover = s.cover ? view(buf, table, s.cover) : null;
  let density = null, fade = null;
  if (info.groom) {
    density = scaled(view(buf, table, info.groom.density), sectionScale(sectionInfo(table, info.groom.density).type));
    fade = scaled(view(buf, table, info.groom.fade), sectionScale(sectionInfo(table, info.groom.fade).type));
  }
  return {
    name: info.name, info, n, a, b, t, uv, offsetScale, edge, index, lod1, cover, density, fade,
    players: Array.isArray(info.players) ? info.players : null,
  };
}

/**
 * Decodes the shared binary.
 * @param {ArrayBuffer} buf  legends.shared.bin
 * @param {object} header    parsed header
 */
export function decodeShared(buf, header) {
  if (buf.byteLength !== header.shared.bytes) throw new Error(`legends: shared bin size ${buf.byteLength} ≠ ${header.shared.bytes}`);
  const S = header.shared.sections;
  const renderToKept = view(buf, S, 'renderToKept');
  const nRender = renderToKept.length, nKept = header.counts.keptVertices;
  if (nRender !== header.counts.renderVertices) throw new Error('legends: renderToKept length mismatch');
  const uvRaw = view(buf, S, 'uv');
  const uv = scaled(uvRaw, sectionScale(S.uv.type));
  const lod0Groups = header.shared.groups.map((g) => ({ start: g.start, count: g.count }));
  const lodIndex = [view(buf, S, 'index')];
  const lodGroups = [lod0Groups];
  for (const l of header.lods) {
    lodIndex.push(view(buf, S, l.section));
    lodGroups.push(l.groups.map((g) => ({ start: g.start, count: g.count })));
  }
  const shells = {};
  for (const info of header.shells || []) shells[info.name] = decodeShell(buf, S, info);
  return {
    header, nRender, nKept, renderToKept, uv,
    color: view(buf, S, 'color'),
    lodIndex, lodGroups,
    eyeLowIndex: S['eyeLow.index'] ? view(buf, S, 'eyeLow.index') : null,
    skinIndex: view(buf, S, 'skinIndex'),
    skinWeight: view(buf, S, 'skinWeight'),
    keptToObj: view(buf, S, 'keptToObj'),
    shells,
  };
}

/**
 * Decodes one player's binary (pure).
 * @param {ArrayBuffer} buf   legends.<id>.bin
 * @param {object} info       header.players[i]
 * @param {{nKept: number}} shared  decodeShared() result (only nKept is read)
 * @returns {{id, kept: Float32Array, keptN: Float32Array, morphs: Array<{name, channel, count, index: Uint16Array,
 *   delta: Float32Array}>, shells: Object, covers: Object}}
 */
export function decodePlayer(buf, info, shared) {
  if (buf.byteLength !== info.bytes) throw new Error(`legends: ${info.id} bin size ${buf.byteLength} ≠ ${info.bytes}`);
  const T = info.sections;
  const nKept = shared.nKept;
  const q = view(buf, T, 'position');
  if (q.length !== nKept * 3) throw new Error(`legends: ${info.id} position count mismatch`);
  const kept = new Float32Array(nKept * 3);
  const m0 = info.posMin[0], m1 = info.posMin[1], m2 = info.posMin[2];
  const s0 = info.posStep[0], s1 = info.posStep[1], s2 = info.posStep[2];
  for (let k = 0; k < nKept; k++) {
    kept[k * 3] = m0 + q[k * 3] * s0;
    kept[k * 3 + 1] = m1 + q[k * 3 + 1] * s1;
    kept[k * 3 + 2] = m2 + q[k * 3 + 2] * s2;
  }
  const keptN = octDecode(view(buf, T, 'normal'), new Float32Array(nKept * 3));
  const morphs = [];
  if (info.morphs && info.morphs.targets && info.morphs.targets.length) {
    const ix = view(buf, T, info.morphs.sections.index);
    const dl = view(buf, T, info.morphs.sections.delta);
    const step = info.morphs.step;
    for (const tg of info.morphs.targets) {
      const index = ix.subarray(tg.offset, tg.offset + tg.count);
      const delta = new Float32Array(tg.count * 3);
      for (let i = 0; i < tg.count * 3; i++) delta[i] = dl[tg.offset * 3 + i] * step;
      for (let i = 0; i < index.length; i++) if (index[i] >= nKept) throw new Error(`legends: ${info.id} morph index out of range`);
      morphs.push({ name: tg.name, channel: tg.channel, count: tg.count, index, delta });
    }
  }
  const shells = {};
  for (const sh of info.shells || []) shells[sh.name] = decodeShell(buf, T, sh);
  const covers = {};
  for (const k of Object.keys(info.covers || {})) covers[k.replace(/^shoeCover_/, '')] = view(buf, T, info.covers[k]);
  return { id: info.id, kept, keptN, morphs, shells, covers };
}

/** Kept-space delta array (metres, 3 per kept vertex, zeros elsewhere) of one sparse morph target. */
export function morphKeptDelta(target, nKept, out) {
  const d = out || new Float32Array(nKept * 3);
  if (out) d.fill(0);
  const ix = target.index, dl = target.delta;
  for (let i = 0; i < ix.length; i++) {
    const k = ix[i] * 3;
    d[k] = dl[i * 3]; d[k + 1] = dl[i * 3 + 1]; d[k + 2] = dl[i * 3 + 2];
  }
  return d;
}

/** Expands a kept-space array (itemSize floats per kept vertex) to render vertices through `renderToKept`. */
export function keptToRender(src, renderToKept, itemSize, out) {
  const n = renderToKept.length;
  const o = out || new src.constructor(n * itemSize);
  for (let r = 0; r < n; r++) {
    const k = renderToKept[r] * itemSize, j = r * itemSize;
    for (let a = 0; a < itemSize; a++) o[j + a] = src[k + a];
  }
  return o;
}
