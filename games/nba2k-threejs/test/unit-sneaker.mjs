// Unit checks for src/legends/sneaker.js (spec v2 §3.8, [CHR §7.6, §12]): vertex / triangle counts per LOD (≈ 970 /
// ≈ 320 triangles), skin weights sum to 1 and use only foot / ball / calf, outsole min y = 0 ± 1e-6, no NaN, collar
// height per cut, mirrored sides, outward winding, UV ranges per part, determinism, the shoe encloses the foot.
// Run: node test/unit-sneaker.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSneaker, sneakerProfile, PART, COLLAR_H, SNEAKER_BONES, normCut } from '../src/legends/sneaker.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const header = JSON.parse(readFileSync(path.join(HERE, '..', 'assets', 'legends', 'legends.json'), 'utf8'));
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const CUTS = ['low', 'low-mid', 'mid-high', 'high'];

check('triangle counts: ≈ 970 (high LOD) and ≈ 320 (low LOD) per shoe, every cut, both sides', () => {
  for (const p of header.players) {
    for (const cut of CUTS) {
      for (const side of ['l', 'r']) {
        const hi = buildSneaker(p.feet, cut, side, 'high'), lo = buildSneaker(p.feet, cut, side, 'low');
        assert.ok(hi.triangleCount >= 900 && hi.triangleCount <= 1040, `${p.id} ${cut} high ${hi.triangleCount}`);
        assert.ok(lo.triangleCount >= 280 && lo.triangleCount <= 360, `${p.id} ${cut} low ${lo.triangleCount}`);
        assert.equal(hi.index.length, hi.triangleCount * 3);
        assert.equal(hi.position.length, hi.vertexCount * 3);
        for (const ix of hi.index) assert.ok(ix < hi.vertexCount);
      }
    }
  }
});

check('skin weights sum to 1 and use only foot / ball / calf; calf only on high and mid-high collars', () => {
  for (const p of header.players) {
    for (const cut of CUTS) {
      for (const side of ['l', 'r']) {
        const sn = buildSneaker(p.feet, cut, side, 'high'), B = SNEAKER_BONES[side];
        let calf = 0;
        for (let v = 0; v < sn.vertexCount; v++) {
          let s = 0;
          for (let j = 0; j < 4; j++) {
            const w = sn.skinWeight[v * 4 + j];
            assert.ok(w >= 0, 'non-negative');
            if (w > 0) assert.ok([B.foot, B.ball, B.calf].includes(sn.skinIndex[v * 4 + j]), 'bone set');
            if (sn.skinIndex[v * 4 + j] === B.calf) calf = Math.max(calf, w);
            s += w;
          }
          assert.ok(Math.abs(s - 1) < 1e-6, `weights sum ${s}`);
        }
        const high = cut === 'high' || cut === 'mid-high';
        if (high) assert.ok(calf > 0.2 && calf <= 0.25 + 1e-9, `${cut} calf ${calf}`);
        else assert.equal(calf, 0, `${cut} no calf`);
      }
    }
  }
});

check('outsole on the floor: min y = 0 ± 1e-6, no NaN, collar at the cut height', () => {
  for (const p of header.players) {
    for (const cut of CUTS) {
      const sn = buildSneaker(p.feet, cut, 'l', 'high');
      let ymin = Infinity, ymax = -Infinity;
      for (let i = 0; i < sn.position.length; i++) assert.ok(Number.isFinite(sn.position[i]));
      for (let i = 0; i < sn.normal.length; i++) assert.ok(Number.isFinite(sn.normal[i]));
      for (let v = 0; v < sn.vertexCount; v++) { ymin = Math.min(ymin, sn.position[v * 3 + 1]); ymax = Math.max(ymax, sn.position[v * 3 + 1]); }
      assert.ok(Math.abs(ymin) < 1e-6, `${p.id} ${cut} min y ${ymin}`);
      const Hc = COLLAR_H[normCut(cut)];
      assert.ok(ymax >= Hc - 0.001 && ymax <= Hc + 0.012, `${p.id} ${cut} top ${ymax} vs Hc ${Hc}`);
    }
  }
});

check('left and right shoes mirror each other in x', () => {
  const p = header.players[2];
  const L = buildSneaker(p.feet, 'high', 'l', 'high'), R = buildSneaker(p.feet, 'high', 'r', 'high');
  assert.equal(L.vertexCount, R.vertexCount);
  for (let v = 0; v < L.vertexCount; v += 7) {
    assert.ok(Math.abs(L.position[v * 3] + R.position[v * 3]) < 1e-5);
    assert.ok(Math.abs(L.position[v * 3 + 1] - R.position[v * 3 + 1]) < 1e-6);
    assert.ok(Math.abs(L.position[v * 3 + 2] - R.position[v * 3 + 2]) < 1e-5);
  }
});

check('faces point outward (signed volume of the closed part is positive), bottoms face down', () => {
  for (const side of ['l', 'r']) {
    const sn = buildSneaker(header.players[0].feet, 'low', side, 'high'), p = sn.position;
    let down = 0, bottoms = 0;
    for (let t = 0; t < sn.index.length; t += 3) {
      const a = sn.index[t] * 3, b = sn.index[t + 1] * 3, c = sn.index[t + 2] * 3;
      if (sn.partId[sn.index[t]] !== PART.BOTTOM) continue;
      const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
      const ny = uz * vx - ux * vz;
      bottoms++;
      if (ny < 0) down++;
    }
    assert.ok(bottoms > 0 && down === bottoms, `${side}: ${down}/${bottoms} bottom faces down`);
    let vol = 0;
    for (let t = 0; t < sn.index.length; t += 3) {
      const pid = sn.partId[sn.index[t]];
      if (pid !== PART.UPPER && pid !== PART.BOTTOM && pid !== PART.WALL) continue;
      const a = sn.index[t] * 3, b = sn.index[t + 1] * 3, c = sn.index[t + 2] * 3;
      vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    }
    assert.ok(vol > 0, `${side} outward volume ${vol}`);
  }
});

check('UVs: upper u = s ∈ [0, 1], v ∈ [0, 1]; wall v 0 → 1; all part ids present', () => {
  const sn = buildSneaker(header.players[4].feet, 'high', 'r', 'high');
  const seen = new Set();
  for (let v = 0; v < sn.vertexCount; v++) {
    const u = sn.uv[v * 2], w = sn.uv[v * 2 + 1];
    seen.add(sn.partId[v]);
    assert.ok(u >= -1e-6 && u <= 1 + 1e-6 && w >= -1e-6 && w <= 1 + 1e-6, `uv ${u},${w}`);
  }
  for (const k of Object.values(PART)) assert.ok(seen.has(k), `part ${k}`);
  const lo = buildSneaker(header.players[4].feet, 'high', 'r', 'low');
  assert.ok(!Array.from(lo.partId).includes(PART.LIP), 'no lip on the low LOD');
});

check('deterministic and pure', () => {
  const a = buildSneaker(header.players[1].feet, 'mid-high', 'l', 'high'), b = buildSneaker(header.players[1].feet, 'mid-high', 'l', 'high');
  assert.deepEqual(a.position, b.position);
  assert.deepEqual(a.index, b.index);
});

check('the shoe encloses the foot: heel behind, toe ahead, outline wider than the measured ball width', () => {
  for (const p of header.players) {
    const f = p.feet.l, pr = sneakerProfile(f, 'low', 'l');
    assert.ok(pr.sBall > 0.6 && pr.sBall < 0.8, `${p.id} sBall ${pr.sBall}`);
    assert.ok(pr.L > f.length, `${p.id} shoe ${pr.L} > foot ${f.length}`);
    let wmax = 0;
    for (let s = 0; s <= 1; s += 0.01) wmax = Math.max(wmax, pr.w(s));
    assert.ok(2 * wmax >= f.widthBall, `${p.id} outline ${2 * wmax} ≥ ball ${f.widthBall}`);
  }
});

console.log(`\nunit-sneaker: ${passed} passed`);
