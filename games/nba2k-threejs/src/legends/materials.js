/**
 * @module legends/materials
 * Character materials per quality tier and their shader patches (spec v2 §3.5.5, §3.6, §3.7, §3.10, §7.4), plus the
 * shared procedural textures they use (eye, pore normal map, kit "dazzle mesh" normal map).
 *
 * Exports
 *   PATCH                                    patch ids (customProgramCacheKey → one program per patch for all six)
 *   createSkinMaterial(tier, {map, pore, clearcoatMap, look})
 *   createWetMaterial(tier, {eyeTex, eyeOffset})
 *   createKitMaterial(tier, {map, meshNormal})
 *   createGroomMaterial(tier, {strand, color, sheenColor})
 *   createShadowProxyMaterial()              main-pass-invisible material for WP6 shadow proxies (colorWrite off)
 *   setSkinSweat(material, tier, look, s)    §3.5.5 sweat response
 *   paintEyeTexture(size, tier, makeCanvas)  → THREE.CanvasTexture (sRGB, clamp)
 *   makePoreNormalMap(size?)                 → THREE.DataTexture (256², repeat 60)
 *   makeMeshNormalMap(size?)                 → THREE.DataTexture (128², repeat 90)
 *
 * Patches (onBeforeCompile; exact r186 chunk names; every material of a kind returns the same cache key):
 *   rough  (skin, kit; medium/high)  after <map_fragment>: `float mapRough = sampledDiffuseColor.a; diffuseColor.a = opacity;`
 *                                    <roughnessmap_fragment> → `float roughnessFactor = roughness * mapRough;`
 *   kit    (all tiers)               after <map_fragment>: `if (!gl_FrontFacing) diffuseColor.rgb *= 0.55;` (cloth
 *                                    interior); the dazzle-mesh normal only acts on the jersey/shorts rects
 *                                    (atlas v ≥ 0.26): `mapN.xy *= step(0.26, vMapUv.y);`
 *   groom                            vertex attributes groom (vec3) / groomDF (vec2) → varyings; <map_fragment> →
 *                                    strand-rank coverage (§3.7) with the family mix normalised by its largest weight
 *                                    (so mixed families such as Kobe's stipple 0.7 + straight 0.3 keep the coverage
 *                                    the density asks for; single-family shells are unchanged); uniform groomColor
 *   wet                              <map_fragment> → iris lookup at vMapUv + clamp(eyeOffset, ±(0.12, 0.09)) for
 *                                    eye vertices (u < 1), constant texel (0.03, 0.03) for teeth / tongue (u = 2)
 */
import * as THREE from '../../vendor/three.module.js';

export const PATCH = Object.freeze({ skin: 'legends.skin.v2', kit: 'legends.kit.v2', groom: 'legends.groom.v2', wet: 'legends.wet.v2' });

const ROUGH_AFTER_MAP = '#include <map_fragment>\n\tfloat mapRough = sampledDiffuseColor.a;\n\tdiffuseColor.a = opacity;';
const ROUGH_FACTOR = 'float roughnessFactor = roughness * mapRough;';

function patchRough(shader) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_fragment>', ROUGH_AFTER_MAP)
    .replace('#include <roughnessmap_fragment>', ROUGH_FACTOR);
}

/**
 * Chroma-keeping toe for NeutralToneMapping (likeness round 4). three's Khronos PBR Neutral subtracts
 * offset = x − 6.25·x² (x = min(r, g, b) < 0.08) from ALL channels, so in shadows the smallest channel goes to ≈ 0:
 * every brown skin's shadow side rendered rust orange (Kobe's neck #673711 back-solves exactly to albedo #8B5A3C)
 * and the wine kits went crimson. Legend materials replace `<tonemapping_fragment>` with the same curve but the toe
 * offset = 0.04·(2t − t²), t = min(x / 0.20, 1): the same 0.04 above x = 0.20 (lit tones and highlights unchanged,
 * C¹ at the knee), ≈ 0.4·x near black, so a shadow keeps ≈ 60 % of its smallest channel. Only applied when the
 * renderer uses NeutralToneMapping (other tone mappings keep their chunk).
 */
const LEGENDS_TONEMAP = [
  'vec3 legendsNeutralToneMapping( vec3 color ) {',
  '\tconst float StartCompression = 0.8 - 0.04;',
  '\tconst float Desaturation = 0.15;',
  '\tcolor *= toneMappingExposure;',
  '\tfloat x = min( color.r, min( color.g, color.b ) );',
  '\tfloat t = min( x / 0.20, 1.0 );',
  '\tcolor -= 0.04 * ( 2.0 * t - t * t );',
  '\tfloat peak = max( color.r, max( color.g, color.b ) );',
  '\tif ( peak < StartCompression ) return color;',
  '\tfloat d = 1. - StartCompression;',
  '\tfloat newPeak = 1. - d * d / ( peak + d - StartCompression );',
  '\tcolor *= newPeak / peak;',
  '\tfloat g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );',
  '\treturn mix( color, vec3( newPeak ), g );',
  '}',
].join('\n');

/** Swaps the tone-mapping chunk of a legend material for the chroma-keeping toe (NeutralToneMapping only). */
function patchToe(shader, renderer) {
  if (!renderer || renderer.toneMapping !== THREE.NeutralToneMapping) return;
  if (!shader.fragmentShader.includes('#include <tonemapping_fragment>')) return;
  shader.fragmentShader = shader.fragmentShader.replace('void main() {', LEGENDS_TONEMAP + '\nvoid main() {')
    .replace('#include <tonemapping_fragment>', '#if defined( TONE_MAPPING )\n\tgl_FragColor.rgb = legendsNeutralToneMapping( gl_FragColor.rgb );\n#endif');
}

/**
 * Skin material (§3.5.5): low Standard(map, constant roughness); medium Standard + roughness-from-alpha + pore
 * normal (0.15); high Physical + sheen look.skinSheen (default 0.15 #8a6050, r 0.8) + clearcoat map (gloss | sweat), clearcoat
 * max(glossBase, 0.30·sweat), clearcoatRoughness per look.
 */
export function createSkinMaterial(tier, { map, pore, clearcoatMap, look }) {
  let m;
  if (tier === 'low') {
    m = new THREE.MeshStandardMaterial({ map, roughness: look.skinRoughness, metalness: 0 });
  } else {
    const params = { map, roughness: 1, metalness: 0, normalMap: pore, normalScale: new THREE.Vector2(0.15, 0.15) };
    if (tier === 'high') {
      m = new THREE.MeshPhysicalMaterial(Object.assign(params, {
        // likeness round 2: sheen 0.25 #b0503c pushed the shadow side and silhouettes of every dark skin to rust orange;
        // round 3: per-look neutral sheen (look.skinSheen {color, k}, e.g. #6a5c56 @ 0.10) instead of the warm #8a6050
        sheen: look.skinSheen ? look.skinSheen.k : 0.15, sheenColor: new THREE.Color(look.skinSheen ? look.skinSheen.color : '#8a6050'), sheenRoughness: 0.8,
        clearcoat: Math.max(look.glossBase, 0), clearcoatRoughness: look.clearcoatRoughness, clearcoatMap: clearcoatMap || null,
      }));
    } else m = new THREE.MeshStandardMaterial(params);
    m.onBeforeCompile = (shader, renderer) => { patchRough(shader); patchToe(shader, renderer); };
    m.customProgramCacheKey = () => PATCH.skin;
  }
  if (tier === 'low') {
    m.onBeforeCompile = patchToe;
    m.customProgramCacheKey = () => PATCH.skin + '.low';
  }
  m.name = 'legends.skin';
  return m;
}

/** Sweat s ∈ [0, 1] (§3.5.5): medium/high roughness multiplier 1 − 0.15 s; low skinRoughness·(1 − 0.15 s); high clearcoat. */
export function setSkinSweat(m, tier, look, s) {
  const k = 1 - 0.15 * s;
  if (tier === 'low') m.roughness = look.skinRoughness * k;
  else {
    m.roughness = k;
    if (tier === 'high') m.clearcoat = Math.max(look.glossBase, 0.30 * s);
  }
}

/** Wet material (eyeballs, teeth, tongue; §3.6): low Lambert, medium Standard r 0.06, high Physical clearcoat 1. */
export function createWetMaterial(tier, { eyeTex, eyeOffset }) {
  let m;
  if (tier === 'low') m = new THREE.MeshLambertMaterial({ map: eyeTex, vertexColors: true });
  else if (tier === 'high') m = new THREE.MeshPhysicalMaterial({ map: eyeTex, vertexColors: true, roughness: 0.06, metalness: 0, clearcoat: 1.0, clearcoatRoughness: 0.03 });
  else m = new THREE.MeshStandardMaterial({ map: eyeTex, vertexColors: true, roughness: 0.06, metalness: 0 });
  const uni = { value: eyeOffset };
  const lowTier = tier === 'low';
  m.onBeforeCompile = (shader, renderer) => {
    shader.uniforms.eyeOffset = uni;
    shader.fragmentShader = 'uniform vec2 eyeOffset;\n' + shader.fragmentShader.replace('#include <map_fragment>',
      'vec2 euv = vMapUv.x < 1.0 ? vMapUv + clamp(eyeOffset, vec2(-0.12, -0.09), vec2(0.12, 0.09)) : vec2(0.03);\n' +
      '\tvec4 sampledDiffuseColor = texture2D(map, euv);\n\tdiffuseColor *= sampledDiffuseColor;');
    if (!lowTier) {
      // teeth / tongue (u = 2, likeness round 4): matte (roughness 0.45, no clearcoat) instead of the eyes' wet 0.06 +
      // clearcoat 1, which reflected the studio environment as one glossy grey slab ("mouthguard") in every open mouth
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\tif (vMapUv.x > 1.5) roughnessFactor = 0.45;')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n\tif (vMapUv.x > 1.5) material.clearcoat = 0.0;\n#endif');
    }
    patchToe(shader, renderer);
  };
  m.customProgramCacheKey = () => PATCH.wet;
  m.name = 'legends.wet';
  return m;
}

/** Kit material (§3.8 / §3.10): low Lambert; medium/high Standard + roughness-from-alpha + dazzle mesh normal; DoubleSide. */
export function createKitMaterial(tier, { map, meshNormal }) {
  let m;
  if (tier === 'low') m = new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide });
  else m = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0, side: THREE.DoubleSide, normalMap: meshNormal, normalScale: new THREE.Vector2(0.35, 0.35) });
  const lowTier = tier === 'low';
  m.onBeforeCompile = (shader, renderer) => {
    if (lowTier) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n\tdiffuseColor.a = opacity;\n\tif (!gl_FrontFacing) diffuseColor.rgb *= 0.55;');
    } else {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', ROUGH_AFTER_MAP + '\n\tif (!gl_FrontFacing) diffuseColor.rgb *= 0.55;')
        .replace('#include <roughnessmap_fragment>', ROUGH_FACTOR)
        .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale;\n\tmapN.xy *= step(0.26, vMapUv.y);');
    }
    patchToe(shader, renderer);
  };
  m.customProgramCacheKey = () => PATCH.kit;
  m.name = 'legends.kit';
  return m;
}

/**
 * Groom material (§3.7): low Standard alphaTest 0.5; medium Standard alphaHash; high Physical sheen 0.3 + alphaHash.
 * DoubleSide, roughness 0.72, metalness 0, uniform groomColor.
 */
export function createGroomMaterial(tier, { strand, color, sheenColor }) {
  // roughness 0.72 / sheen 0.2 (likeness round 2: 0.55 / 0.3 gave brows and beards a blue-grey strand sparkle)
  const params = { map: strand, roughness: 0.72, metalness: 0, side: THREE.DoubleSide };
  if (tier === 'low') params.alphaTest = 0.5; else params.alphaHash = true;
  const m = tier === 'high'
    ? new THREE.MeshPhysicalMaterial(Object.assign(params, { sheen: 0.2, sheenColor: new THREE.Color(sheenColor), sheenRoughness: 0.5 }))
    : new THREE.MeshStandardMaterial(params);
  const uni = { value: new THREE.Color(color) };
  m.userData.groomColor = uni;
  m.onBeforeCompile = (shader, renderer) => {
    shader.uniforms.groomColor = uni;
    shader.vertexShader = 'attribute vec3 groom;\nattribute vec2 groomDF;\nvarying vec3 vGroom;\nvarying vec2 vGroomDF;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGroom = groom;\n\tvGroomDF = groomDF;');
    shader.fragmentShader = 'uniform vec3 groomColor;\nvarying vec3 vGroom;\nvarying vec2 vGroomDF;\n' +
      shader.fragmentShader.replace('#include <map_fragment>', [
        'vec4 tx = texture2D(map, vMapUv);',
        'float rk = dot(tx.rgb, vGroom) / max(max(vGroom.r, vGroom.g), max(vGroom.b, 1e-3));',
        'float ga = smoothstep(1.0 - vGroomDF.x - 0.04, 1.0 - vGroomDF.x + 0.04, rk) * vGroomDF.y;',
        'diffuseColor = vec4(groomColor * (0.70 + 0.60 * tx.a), ga);',
      ].join('\n\t'));
    patchToe(shader, renderer);
  };
  m.customProgramCacheKey = () => PATCH.groom;
  m.name = 'legends.groom';
  return m;
}

/** Shadow-proxy material: draws nothing in the main pass (colorWrite and depthWrite off); casts in the shadow pass. */
export function createShadowProxyMaterial() {
  const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  m.name = 'legends.shadowProxy';
  return m;
}

// -------------------------------------------------------------------------------------------- shared textures

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
 * Eye texture (§3.6): sclera radial #e9e2d8 (r 0) → #d9c9bc (0.38) → #b99086 (0.5); 14 vessels (high only) #b04a40
 * α 0.25 from the rim 30 % inward; iris #2A1A12, radius 0.225 UV, 120 radial fibres #5a3a26 / #120a06 α 0.18,
 * limbal ring = last 12 % of the iris radius #0b0705; pupil 0.40 × iris #050302; catchlight (low only) r 0.025 at
 * (0.44, 0.58) white α 0.85; texels with u, v < 0.06 pure #e8e2d6 (teeth / tongue sample there).
 * Canvas y = (1 − v)·S (CanvasTexture flipY).
 */
export function paintEyeTexture(size, tier, makeCanvas) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const S = size, cx = S / 2, cy = S / 2;
  const scl = g.createRadialGradient(cx, cy, 0, cx, cy, 0.5 * S);
  // likeness round 4: #e9e2d8 → #ddd5c9 centre (bright white corner crescents gave the dark-skinned faces a startled look)
  scl.addColorStop(0, '#ddd5c9'); scl.addColorStop(0.76, '#cfc0b2'); scl.addColorStop(1, '#b08a80');
  g.fillStyle = scl; g.fillRect(0, 0, S, S);
  const rnd = mulberry(0xE7E);
  if (tier === 'high') {
    g.strokeStyle = 'rgba(176,74,64,0.25)';
    g.lineWidth = 0.8 * S / 256;
    for (let i = 0; i < 14; i++) {
      let a = rnd() * Math.PI * 2, r = 0.5 * S;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      for (let k = 1; k <= 6; k++) {
        r = (0.5 - 0.15 * k / 6) * S; a += (rnd() - 0.5) * 0.12;
        g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
      g.stroke();
    }
  }
  const ri = 0.225 * S;
  g.fillStyle = '#2A1A12'; g.beginPath(); g.arc(cx, cy, ri, 0, Math.PI * 2); g.fill();
  g.lineWidth = Math.max(1, 2 * Math.PI * ri / 120 * 0.6);
  for (let i = 0; i < 120; i++) {
    const a = i / 120 * Math.PI * 2;
    g.strokeStyle = i % 2 ? 'rgba(18,10,6,0.18)' : 'rgba(90,58,38,0.18)';
    g.beginPath(); g.moveTo(cx + Math.cos(a) * ri * 0.4, cy + Math.sin(a) * ri * 0.4); g.lineTo(cx + Math.cos(a) * ri * 0.88, cy + Math.sin(a) * ri * 0.88); g.stroke();
  }
  g.strokeStyle = '#0b0705'; g.lineWidth = ri * 0.12;
  g.beginPath(); g.arc(cx, cy, ri * 0.94, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#050302'; g.beginPath(); g.arc(cx, cy, ri * 0.40, 0, Math.PI * 2); g.fill();
  if (tier === 'low') {
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(0.44 * S, (1 - 0.58) * S, 0.025 * S, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#e8e2d6'; g.fillRect(0, 0.94 * S, 0.06 * S, 0.06 * S + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = tier === 'high' ? 4 : tier === 'medium' ? 2 : 1;
  t.name = 'legends.eye';
  return t;
}

/** Tileable height field → tangent-space normal map bytes (central differences, wrap). */
function heightToNormal(h, S, strength) {
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + (x + 1) % S] - h[y * S + (x + S - 1) % S];
      const dy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l; ny /= l; nz /= l;
      const o = (y * S + x) * 4;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255); out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255); out[o + 3] = 255;
    }
  }
  return out;
}

function normalTexture(data, S, repeat, name) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/**
 * Pore normal map (§3.5.5): 256² value-noise dimples (Gaussian σ 1.2 px of white noise) + 900 pores r 0.8–1.6 px depth
 * 0.5, tileable, repeat (60, 60).
 */
export function makePoreNormalMap(size = 256) {
  const S = size, rnd = mulberry(0x9015), n = new Float32Array(S * S), h = new Float32Array(S * S);
  for (let i = 0; i < n.length; i++) n[i] = rnd() - 0.5;
  // separable Gaussian blur σ = 1.2 px (radius 3), wrapped
  const k = [], sig = 1.2;
  let ks = 0;
  for (let i = -3; i <= 3; i++) { const v = Math.exp(-(i * i) / (2 * sig * sig)); k.push(v); ks += v; }
  const tmp = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let a = 0; for (let i = -3; i <= 3; i++) a += n[y * S + (x + i + S) % S] * k[i + 3]; tmp[y * S + x] = a / ks; }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { let a = 0; for (let i = -3; i <= 3; i++) a += tmp[((y + i + S) % S) * S + x] * k[i + 3]; h[y * S + x] = a / ks * 2.5; }
  for (let p = 0; p < 900; p++) {
    const px = rnd() * S, py = rnd() * S, r = 0.8 + 0.8 * rnd();
    for (let y = Math.floor(py - r - 1); y <= Math.ceil(py + r + 1); y++) {
      for (let x = Math.floor(px - r - 1); x <= Math.ceil(px + r + 1); x++) {
        const d = Math.hypot(x - px, y - py);
        if (d < r) h[((y + S) % S) * S + (x + S) % S] -= 0.5 * (1 - (d / r) * (d / r));
      }
    }
  }
  return normalTexture(heightToNormal(h, S, 1.0), S, 60, 'legends.pore');
}

/**
 * Kit "dazzle mesh" normal map (§3.8): 128² tile of hexagonally staggered round holes (≈ 2 mm at repeat 90 on the
 * jersey), depth 0.4 with a soft rim, tileable, repeat (90, 90).
 */
export function makeMeshNormalMap(size = 128) {
  const S = size, h = new Float32Array(S * S), cols = 4, pitch = S / cols, rows = 4, rp = S / rows, r = 0.35 * pitch;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let d = Infinity;
      for (let j = -1; j <= rows; j++) {
        const cy = (j + 0.5) * rp, off = (j & 1) ? pitch / 2 : 0;
        for (let i = -1; i <= cols; i++) {
          const cx = (i + 0.5) * pitch + off;
          d = Math.min(d, Math.hypot(x - cx, y - cy));
        }
      }
      const t = Math.min(1, Math.max(0, (r - d) / (0.25 * r)));
      h[y * S + x] = -0.4 * t * t * (3 - 2 * t);
    }
  }
  return normalTexture(heightToNormal(h, S, 2.0), S, 90, 'legends.dazzle');
}
