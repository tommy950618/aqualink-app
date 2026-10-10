/**
 * measure.mjs — anthropometric and likeness check of a baked legends file (reads only the baked header + bins).
 *
 *   node measure.mjs <header.json> [--json] [--likeness]
 *
 * `--likeness` adds the SPEC-v2 §10.2 face metrics (faceLW, chinProj, earOut, fissH, lipsH, noseIcd; definitions
 * and bands in lib/landmarks.mjs, vertex sets stored by the bake in `header.measureSets`) plus headH against
 * meta.calibration.headH, prints a table and exits 1 on any band or ordering miss.
 */
// Per player: barefoot height, head height and the height/head ratio ("heads tall"), shoulder-joint
// breadth, chest/waist/hip breadth and depth, wingspan and overhead reach (CPU linear-blend skinning of the
// real mesh with the arms straightened sideways / straight up, no shoulder shrug), hand and foot length,
// leg length (crotch height) and a mass estimate from the closed body volume (density 1.0 kg/L).
// When the player has meta.stats (listed wingspan / reach / weight) the deltas are printed next to them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { faceMetrics, checkLikeness, LIKENESS_BANDS } from './lib/landmarks.mjs';

// Mesh volume (1 kg/L) reads about 11% under the listed mass of the macro-only bodies (open mouth/eye
// regions, no internal density model), so mass estimates are volume x VOLUME_TO_MASS.
export const VOLUME_TO_MASS = 1.12;

export function measureHeader(file) {
  const H = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(file);
  const sharedBuf = fs.readFileSync(path.join(dir, H.shared.file));
  const sec = (buf, s, Ctor) => new Ctor(buf.buffer.slice(buf.byteOffset + s.offset, buf.byteOffset + s.offset + s.bytes));
  const S = H.shared.sections;
  const renderToKept = sec(sharedBuf, S.renderToKept, Uint16Array);
  const index = sec(sharedBuf, S.index, Uint16Array);
  const skinIdx = sec(sharedBuf, S.skinIndex, Uint8Array);
  const skinW = sec(sharedBuf, S.skinWeight, Uint8Array);
  const keptToObj = sec(sharedBuf, S.keptToObj, Uint16Array);
  const nKept = keptToObj.length;
  const boneNames = H.bones.map((b) => b.name);
  const B = Object.fromEntries(boneNames.map((n, i) => [n, i]));
  const bodyGroup = H.shared.groups.find((g) => g.name === 'body');
  // eyeball index range: v2 `wetParts.eyes`, v1 the `eyes` group
  const eyeRange = H.version >= 2 ? { start: H.shared.wetParts.eyes[0], count: H.shared.wetParts.eyes[1] } : H.shared.groups.find((g) => g.name === 'eyes');

  // kept-space triangles for the closed volume (body + eyeballs plug the eye sockets)
  const tris = [];
  for (const g of [bodyGroup, eyeRange]) for (let i = g.start; i < g.start + g.count; i++) tris.push(renderToKept[index[i]]);

  const wsum = (k, names) => { let s = 0; for (let j = 0; j < 4; j++) if (names.includes(boneNames[skinIdx[k * 4 + j]])) s += skinW[k * 4 + j] / 255; return s; };
  const TORSO = ['pelvis', 'spine_01', 'spine_02', 'spine_03'];
  const ARMS = ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r',
    ...H.bones.map((b) => b.name).filter((n) => /^(thumb|index|middle|ring|pinky)_/.test(n))];
  const isBody = (k) => keptToObj[k] <= 13379;

  // --- tiny 3x3 rotation helpers -------------------------------------------------------------------------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
  const mulMV = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const mulMM = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; };
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function fromTo(a, b) {               // rotation taking unit a onto unit b (Rodrigues)
    a = norm(a); b = norm(b);
    const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (c < -0.9999) return [-1, 0, 0, 0, -1, 0, 0, 0, 1];
    const k = 1 / (1 + c);
    return [v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
      v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
      v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c];
  }

  // Pose: each arm's upperarm, lowerarm and hand segments are rotated (world space) onto `dir(side)`;
  // everything below the hand follows the hand. Returns per-bone {R, head'} for linear blend skinning.
  function armPose(bones, dir) {
    const R = boneNames.map(() => I3), head = bones.map((b) => b.head);
    const posedHead = head.slice();
    const parent = H.bones.map((b) => b.parent);
    const target = {};
    for (const s of ['l', 'r']) {
      const chain = [[`upperarm_${s}`, `lowerarm_${s}`], [`lowerarm_${s}`, `hand_${s}`], [`hand_${s}`, `middle_01_${s}`]];
      let Rw = I3;
      for (const [b, c] of chain) {
        const d = mulMV(Rw, sub(head[B[c]], head[B[b]]));
        Rw = mulMM(fromTo(d, dir(s)), Rw);
        target[b] = Rw;
      }
    }
    for (let i = 0; i < boneNames.length; i++) {
      const p = parent[i];
      if (target[boneNames[i]]) R[i] = target[boneNames[i]];
      else if (p >= 0) R[i] = R[p];
      if (p >= 0) posedHead[i] = add(posedHead[p], mulMV(R[p], sub(head[i], head[p])));
    }
    return { R, head, posedHead };
  }

  function skin(P, pose, k) {
    let out = [0, 0, 0];
    const v = [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]];
    for (let j = 0; j < 4; j++) {
      const w = skinW[k * 4 + j] / 255; if (!w) continue;
      const b = skinIdx[k * 4 + j];
      const q = add(mulMV(pose.R[b], sub(v, pose.head[b])), pose.posedHead[b]);
      out = [out[0] + w * q[0], out[1] + w * q[1], out[2] + w * q[2]];
    }
    return out;
  }

  const results = [];
  for (const p of H.players) {
    const buf = fs.readFileSync(path.join(dir, p.file));
    const q = sec(buf, p.sections.position, Uint16Array);
    const P = new Float64Array(nKept * 3);
    for (let k = 0; k < nKept; k++) for (let a = 0; a < 3; a++) P[k * 3 + a] = p.posMin[a] + q[k * 3 + a] * p.posStep[a];
    const bones = p.bones;
    const J = (n) => bones[B[n]];
    let top = -Infinity; for (let k = 0; k < nKept; k++) if (isBody(k)) top = Math.max(top, P[k * 3 + 1]);
    // menton: the frozen ME landmark (base.obj 5296, lowest midline point of the chin) of a v2 header. The PoC
    // heuristic below (front-most midline point under the mouth joint, then the lowest point within 12 mm of its
    // depth) is kept only for v1 headers: it latches onto the lips or the nose tip whenever they protrude past the
    // chin, so lip/nose edits moved its "menton" by up to 5 cm and drove calibrate.mjs into the knob limits.
    let menton;
    if (p.face && p.face.ME) menton = p.face.ME[1];
    else {
      const mouthY = p.landmarks.mouth[1];
      let pog = -1;
      for (let k = 0; k < nKept; k++) {
        if (!isBody(k) || Math.abs(P[k * 3]) > 0.004) continue;
        const y = P[k * 3 + 1];
        if (y > mouthY - 0.02 || y < mouthY - 0.09) continue;
        if (wsum(k, ['head']) < 0.5) continue;
        if (pog < 0 || P[k * 3 + 2] > P[pog * 3 + 2]) pog = k;
      }
      menton = P[pog * 3 + 1];
      for (let k = 0; k < nKept; k++) {
        if (!isBody(k) || Math.abs(P[k * 3]) > 0.004) continue;
        if (wsum(k, ['head']) < 0.3 || P[k * 3 + 1] < P[pog * 3 + 1] - 0.05) continue;
        if (P[k * 3 + 2] > P[pog * 3 + 2] - 0.012 && P[k * 3 + 1] < menton) menton = P[k * 3 + 1];
      }
    }
    const headH = top - menton;
    // head breadth (max |x| of head-weighted vertices above the ears' bottom, ears excluded roughly by z-band)
    // breadth/depth of torso slices
    const slice = (y0, y1, filt) => {
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (let k = 0; k < nKept; k++) {
        if (!isBody(k)) continue;
        const y = P[k * 3 + 1];
        if (y < y0 || y > y1 || !filt(k)) continue;
        mnx = Math.min(mnx, P[k * 3]); mxx = Math.max(mxx, P[k * 3]); mnz = Math.min(mnz, P[k * 3 + 2]); mxz = Math.max(mxz, P[k * 3 + 2]);
      }
      return { w: mxx - mnx, d: mxz - mnz };
    };
    const torsoOnly = (k) => wsum(k, ARMS) < 0.02 && wsum(k, ['thigh_l', 'thigh_r']) < 0.5;
    const shoulderY = (J('upperarm_l').head[1] + J('upperarm_r').head[1]) / 2;
    const pelvisY = J('pelvis').head[1];
    const chest = slice(shoulderY - 0.17, shoulderY - 0.13, torsoOnly);
    const waist = slice(pelvisY + 0.09, pelvisY + 0.12, torsoOnly);
    const hips = slice(pelvisY - 0.10, pelvisY - 0.04, (k) => wsum(k, ARMS) < 0.02);
    // deltoid breadth: widest point of the shoulder/upper-arm cap in A-pose (upperarm + clavicle weighted, near shoulder height)
    const delt = slice(shoulderY - 0.10, shoulderY + 0.04, (k) => wsum(k, ARMS.filter((n) => !/^upperarm/.test(n))) < 0.02);
    const neck = slice(J('neck_01').head[1] + 0.02, J('neck_01').head[1] + 0.05, (k) => wsum(k, ['neck_01', 'head', 'spine_03']) > 0.5);
    const thigh = slice(pelvisY - 0.22, pelvisY - 0.18, (k) => wsum(k, ['thigh_l']) > 0.5 && P[k * 3] > 0);
    const calf = slice(J('calf_l').head[1] - 0.16, J('calf_l').head[1] - 0.10, (k) => wsum(k, ['calf_l']) > 0.5);
    // wingspan (arms straight sideways) and reach (arms straight up)
    const handV = []; for (let k = 0; k < nKept; k++) if (isBody(k) && wsum(k, ['hand_l', 'hand_r', ...boneNames.filter((n) => /_0[123]_/.test(n))]) > 0.3) handV.push(k);
    const tp = armPose(bones, (s) => [s === 'l' ? 1 : -1, 0, 0]);
    let mnx = Infinity, mxx = -Infinity;
    for (const k of handV) { const v = skin(P, tp, k); mnx = Math.min(mnx, v[0]); mxx = Math.max(mxx, v[0]); }
    const up = armPose(bones, () => [0, 1, 0]);
    let reach = -Infinity; for (const k of handV) reach = Math.max(reach, skin(P, up, k)[1]);
    // hand length (wrist joint to middle fingertip), foot length (heel to toe along z)
    let tipZ = -Infinity, heelZ = Infinity, tipDist = 0;
    const wrist = J('hand_l').head;
    for (let k = 0; k < nKept; k++) {
      if (!isBody(k)) continue;
      if (wsum(k, ['foot_l', 'ball_l']) > 0.5) { tipZ = Math.max(tipZ, P[k * 3 + 2]); heelZ = Math.min(heelZ, P[k * 3 + 2]); }
      if (wsum(k, ['middle_03_l']) > 0.5) tipDist = Math.max(tipDist, Math.hypot(...sub([P[k * 3], P[k * 3 + 1], P[k * 3 + 2]], wrist)));
    }
    // crotch height: lowest torso point between the thighs
    let crotch = Infinity;
    for (let k = 0; k < nKept; k++) if (isBody(k) && Math.abs(P[k * 3]) < 0.01 && P[k * 3 + 1] < pelvisY && wsum(k, ['pelvis']) > 0.3) crotch = Math.min(crotch, P[k * 3 + 1]);
    // closed volume -> mass
    let vol = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
      vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
    }
    // face proportions: crown->eye vs eye->menton (about 1.0 on an average adult; > 1.1 reads as a domed cranium)
    const eyeY = (p.landmarks['l-eye'][1] + p.landmarks['r-eye'][1]) / 2;
    const st = p.meta?.stats || {};
    const r = {
      id: p.id, height: +top.toFixed(3), headH: +headH.toFixed(3), headsTall: +(top / headH).toFixed(2),
      shoulderJoints: +Math.hypot(...sub(J('upperarm_l').head, J('upperarm_r').head)).toFixed(3),
      deltoidW: +delt.w.toFixed(3), chestW: +chest.w.toFixed(3), chestD: +chest.d.toFixed(3), waistW: +waist.w.toFixed(3), waistD: +waist.d.toFixed(3),
      hipW: +hips.w.toFixed(3), neckW: +neck.w.toFixed(3), thighW: +thigh.w.toFixed(3), calfW: +calf.w.toFixed(3),
      wingspan: +(mxx - mnx).toFixed(3), apeIndex: +((mxx - mnx) / top).toFixed(3), reachNoShrug: +reach.toFixed(3),
      handLen: +tipDist.toFixed(3), footLen: +(tipZ - heelZ).toFixed(3), crotch: +crotch.toFixed(3), legRatio: +(crotch / top).toFixed(3),
      crownEye: +(top - eyeY).toFixed(3), eyeMenton: +(eyeY - menton).toFixed(3), craniumFace: +((top - eyeY) / (eyeY - menton)).toFixed(2),
      volumeL: +Math.abs(vol * 1000).toFixed(1), massKg: +(Math.abs(vol * 1000) * VOLUME_TO_MASS).toFixed(1),
      target: { wingspan: st.wingspanM, reach: st.reachM ?? st.standingReachM, weightKg: st.weightKg },
    };
    if (H.measureSets) {
      const lmKept = Object.fromEntries(Object.entries(H.landmarks).map(([n, e]) => [n, e.kept]));
      const sets = Object.fromEntries(Object.entries(H.measureSets).map(([k, nm]) => [k, Array.from(sec(sharedBuf, S[nm], Uint16Array))]));
      const fm = faceMetrics((k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]], sets, lmKept);
      r.likeness = Object.fromEntries(Object.entries(fm).map(([k, v]) => [k, +v.toFixed(3)]));
      r.likeness.headH = r.headH;
      if (p.meta?.calibration?.headH != null) r.likeness.headHTarget = p.meta.calibration.headH;
    }
    results.push(r);
  }

  return results;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const file = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || '');
  if (!fs.existsSync(file)) { console.error('usage: node measure.mjs <header.json> [--json] [--likeness]'); process.exit(2); }
  const results = measureHeader(file);
  const likeness = process.argv.includes('--likeness');
  let misses = [];
  if (likeness) {
    if (!results.every((r) => r.likeness)) { console.error('header has no measureSets (bake with format v2)'); process.exit(2); }
    misses = checkLikeness(Object.fromEntries(results.map((r) => [r.id, r.likeness])));
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(likeness ? { results, likenessMisses: misses } : results, null, 1));
  else {
    const cols = ['id', 'height', 'headH', 'headsTall', 'shoulderJoints', 'deltoidW', 'chestW', 'chestD', 'waistW', 'waistD', 'hipW', 'neckW', 'thighW', 'calfW', 'wingspan', 'apeIndex', 'reachNoShrug', 'handLen', 'footLen', 'legRatio', 'craniumFace', 'massKg'];
    console.log(cols.join('\t'));
    for (const r of results) console.log(cols.map((c) => r[c]).join('\t'));
    console.log('\ntargets (listed): wingspan / standing reach / weight, and model deltas');
    for (const r of results) {
      const t = r.target;
      if (!t.wingspan) continue;
      console.log(`${r.id.padEnd(8)} span ${t.wingspan} (model ${r.wingspan}, ${((r.wingspan - t.wingspan) * 100).toFixed(1)} cm)  reach ${t.reach} (model no-shrug ${r.reachNoShrug}, ${((r.reachNoShrug - t.reach) * 100).toFixed(1)} cm)  weight ${t.weightKg} (est. ${r.massKg} kg, ${(r.massKg - t.weightKg).toFixed(1)})`);
    }
    if (likeness) {
      const keys = ['faceLW', 'chinProj', 'earOut', 'fissH', 'lipsH', 'noseIcd'];
      console.log('\nlikeness (SPEC-v2 §10.2): value [band]');
      console.log(['id', ...keys, 'headH'].join('\t'));
      for (const r of results) {
        const L = r.likeness;
        const cell = (k) => { const b = LIKENESS_BANDS[k] && LIKENESS_BANDS[k][r.id]; return `${L[k].toFixed(k === 'faceLW' || k === 'noseIcd' ? 3 : 1)}${b ? ` [${b[0]}, ${b[1]}]` : ''}`; };
        console.log([r.id, ...keys.map(cell), `${(L.headH * 100).toFixed(1)} (${L.headHTarget != null ? (L.headHTarget * 100).toFixed(1) : '-'})`].join('\t'));
      }
    }
  }
  if (likeness) {
    if (misses.length) { console.log(`\nlikeness: ${misses.length} miss(es)`); for (const m of misses) console.log('  ' + m); process.exit(1); }
    console.log('\nlikeness: all bands and orderings met');
  }
}
