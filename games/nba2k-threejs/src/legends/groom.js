/**
 * @module legends/groom
 * Groom (hair, beard, brows, lashes) support (spec v2 §3.7, [CHR §4.1–§4.3, §6]): the shared strand texture and the
 * per-vertex groom attributes. The groom material itself is `materials.createGroomMaterial`.
 *
 * Exports
 *   STRAND_SEED                         20260101 (mulberry32)
 *   paintStrandTexture(size, makeCanvas) → Uint8Array RGBA (size²): R straight, G coil, B stipple strand RANK, A shade
 *   strandTexture(data, size)           → THREE.DataTexture (RepeatWrapping, mipmaps, NoColorSpace)
 *   groomAttributes(shell)              → {groom: Float32Array(n·3) family weights, groomDF: Float32Array(n·2)}
 *   GROOM_ORDER                         draw order of the groom shells (inner layers first)
 *
 * Strand texture (§3.7; counts per tile, pixel dimensions × size/512 so a 5 cm tile looks the same on every tier):
 *   R straight 2,400 strands 18–30 px long, 1.3–1.9 px wide, along +v ± 10°, quadratic bend ± 3 px;
 *   G coil 2,800 arcs radius 2.5–4.5 px, sweep 280–340°, width 1.4–2.0 px, 10 % two-turn spirals;
 *   B stipple 7,000 dots r 0.8–1.4 px + 3,000 strokes 3–5 px;  A shade = 2-octave value noise (cell 32 px) → 0.35–1.0.
 * Ranks are uniform in (0.02, 1] per strand (grey level), drawn white-on-black with `lighten` so overlaps keep the
 * highest rank; every primitive near a border is redrawn at ±size offsets (tileable).
 */
import * as THREE from '../../vendor/three.module.js';

export const STRAND_SEED = 20260101;

/** Groom shell draw order (§3.4): inner layers, then outer layers, then lashes; LOD3 draws the inner block only. */
export const GROOM_ORDER = Object.freeze({ inner: Object.freeze(['hair_inner', 'beard_inner', 'brows']), outer: Object.freeze(['hair_outer', 'beard_outer']), lashes: 'lashes' });

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paints the strand channels on canvases and interleaves them.
 * @param {number} size  256 (low) / 512 (medium) / 1024 (high)
 * @param {function(number, number): HTMLCanvasElement|OffscreenCanvas} makeCanvas
 */
export function paintStrandTexture(size, makeCanvas) {
  const N = size, k = size / 512, rnd = mulberry(STRAND_SEED);
  const rank = () => { const v = Math.max(5, Math.round((0.02 + 0.98 * rnd()) * 255)); return `rgb(${v},${v},${v})`; };
  // draws f at the 9 tile offsets that can touch the tile (primitive bounds within `pad` px of a border)
  const tiled = (g, x, y, pad, f) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ox = x + dx * N, oy = y + dy * N;
        if (ox < -pad || ox > N + pad || oy < -pad || oy > N + pad) continue;
        f(ox, oy);
      }
    }
  };
  const canvas = makeCanvas(N, N);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const channel = (draw) => {
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'lighten';
    g.lineCap = 'round';
    draw();
    return g.getImageData(0, 0, N, N).data.slice();
  };
  const R = channel(() => {
    for (let i = 0; i < 2400; i++) {
      const x = rnd() * N, y = rnd() * N, L = (18 + 12 * rnd()) * k, a = (rnd() - 0.5) * 2 * (10 * Math.PI / 180);
      const w = (1.3 + 0.6 * rnd()) * k, bend = (rnd() - 0.5) * 6 * k, c = rank();
      const ex = Math.sin(a) * L, ey = Math.cos(a) * L;
      tiled(g, x, y, L + 4, (ox, oy) => {
        g.strokeStyle = c; g.lineWidth = w;
        g.beginPath(); g.moveTo(ox, oy);
        g.quadraticCurveTo(ox + ex / 2 + Math.cos(a) * bend, oy + ey / 2 - Math.sin(a) * bend, ox + ex, oy + ey);
        g.stroke();
      });
    }
  });
  const G = channel(() => {
    for (let i = 0; i < 2800; i++) {
      const x = rnd() * N, y = rnd() * N, r = (2.5 + 2 * rnd()) * k, s0 = rnd() * Math.PI * 2;
      const sweep = (280 + 60 * rnd()) * Math.PI / 180, w = (1.4 + 0.6 * rnd()) * k, c = rank(), spiral = rnd() < 0.1;
      tiled(g, x, y, 2 * r + 4, (ox, oy) => {
        g.strokeStyle = c; g.lineWidth = w;
        g.beginPath();
        if (spiral) {
          // two turns with the radius shrinking to 55 %: polyline through 48 points
          for (let j = 0; j <= 48; j++) {
            const t = j / 48, ang = s0 + t * (sweep + Math.PI * 2), rr = r * (1 - 0.45 * t);
            const px = ox + Math.cos(ang) * rr, py = oy + Math.sin(ang) * rr;
            if (j === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
        } else g.arc(ox, oy, r, s0, s0 + sweep);
        g.stroke();
      });
    }
  });
  const B = channel(() => {
    for (let i = 0; i < 7000; i++) {
      const x = rnd() * N, y = rnd() * N, r = (0.8 + 0.6 * rnd()) * k, c = rank();
      tiled(g, x, y, r + 2, (ox, oy) => { g.fillStyle = c; g.beginPath(); g.arc(ox, oy, r, 0, Math.PI * 2); g.fill(); });
    }
    for (let i = 0; i < 3000; i++) {
      const x = rnd() * N, y = rnd() * N, L = (3 + 2 * rnd()) * k, a = rnd() * Math.PI * 2, c = rank();
      tiled(g, x, y, L + 2, (ox, oy) => {
        g.strokeStyle = c; g.lineWidth = k;
        g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + Math.cos(a) * L, oy + Math.sin(a) * L); g.stroke();
      });
    }
  });
  // A: 2-octave value noise (cells 32 px and 16 px, × k), smoothstep-interpolated, wrapped → 0.35–1.0
  const cell = Math.max(2, Math.round(32 * k));
  const lattice = (c) => { const n = Math.max(1, Math.round(N / c)), v = new Float32Array(n * n); for (let i = 0; i < v.length; i++) v[i] = rnd(); return { n, v }; };
  const L1 = lattice(cell), L2 = lattice(cell / 2);
  const sample = (L, x, y) => {
    const fx = x / N * L.n, fy = y / N * L.n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = L.v[(y0 % L.n) * L.n + (x0 % L.n)], b = L.v[(y0 % L.n) * L.n + ((x0 + 1) % L.n)];
    const c = L.v[((y0 + 1) % L.n) * L.n + (x0 % L.n)], d = L.v[((y0 + 1) % L.n) * L.n + ((x0 + 1) % L.n)];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  const out = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x, o = i * 4;
      const v = (2 * sample(L1, x, y) + sample(L2, x, y)) / 3;
      out[o] = R[o]; out[o + 1] = G[o]; out[o + 2] = B[o];
      out[o + 3] = Math.round((0.35 + 0.65 * v) * 255);
    }
  }
  canvas.width = canvas.height = 1;
  return out;
}

/** Strand DataTexture (RepeatWrapping, mipmaps, linear data). */
export function strandTexture(data, size) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 2;
  t.name = 'legends.strand';
  t.needsUpdate = true;
  return t;
}

/**
 * Per-vertex groom attributes of one groom shell: `groom` = the shell's family weights (straight, coil, stipple),
 * `groomDF` = (density, fade) from the baked sections (fade already includes the edge ramp; lashes: density 0.9).
 */
export function groomAttributes(shell) {
  const n = shell.n, gi = shell.info.groom;
  const groom = new Float32Array(n * 3), groomDF = new Float32Array(n * 2);
  const f0 = gi.family[0], f1 = gi.family[1], f2 = gi.family[2];
  for (let i = 0; i < n; i++) {
    groom[i * 3] = f0; groom[i * 3 + 1] = f1; groom[i * 3 + 2] = f2;
    groomDF[i * 2] = shell.density ? shell.density[i] : 1;
    groomDF[i * 2 + 1] = shell.fade ? shell.fade[i] : 1;
  }
  return { groom, groomDF };
}
