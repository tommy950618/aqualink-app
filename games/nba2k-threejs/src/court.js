// Court floor (painted 1024x1024 canvas) and the hoop assembly: pole, arm, backboard, rim and a
// wobbling LineSegments net (spec section 2 canvas mapping, section 10, section 14 row 11).
// Everything is drawn in world metres through a canvas transform, so the anisotropic plane
// (19.24 x 17.325 m onto a square canvas) needs no per-shape scaling.
import * as THREE from '../vendor/three.module.js';
import { COURT, RIM, BOARD, LINES, COLORS } from './constants.js';
import { TAU, lerp } from './math.js';
import { makeCanvasTexture } from './scene.js';

const PLANE_MAX_Z = COURT.PLANE_MIN_Z + COURT.PLANE_D;   // +1.0: backcourt strip on the plane
const NET_STRANDS = 8;
const NET_RINGS = 4;              // ring levels below the rim (level 0 is the rim itself)
const NET_LEN = 0.40;
const NET_R_BOTTOM = 0.12;
const NET_T = 0.6;                // wobble duration after a score
const BOARD_TEX = 256;

function cssHex(n) {
  return '#' + n.toString(16).padStart(6, '0');
}

// World (x, z) on the floor -> canvas pixel (px, py). Canvas row 0 is the far (hoop) side.
export function worldToPx(x, z, out) {
  const o = out || { px: 0, py: 0 };
  o.px = (x - COURT.PLANE_MIN_X) / COURT.PLANE_W * COURT.CANVAS_SIZE;
  o.py = (z - COURT.PLANE_MIN_Z) / COURT.PLANE_D * COURT.CANVAS_SIZE;
  return o;
}

// Paint the whole court onto a size x size 2D context: apron, wood planks, key, every line.
export function drawCourtCanvas(ctx, size) {
  const sx = size / COURT.PLANE_W, sz = size / COURT.PLANE_D;
  const W = COURT.HALF_W, BZ = COURT.BASELINE_Z, LW = LINES.LINE_W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = cssHex(COLORS.apron);
  ctx.fillRect(0, 0, size, size);

  // From here on 1 unit = 1 metre, origin at the world origin, +y = +z (toward the camera).
  ctx.setTransform(sx, 0, 0, sz, -COURT.PLANE_MIN_X * sx, -COURT.PLANE_MIN_Z * sz);
  ctx.fillStyle = cssHex(COLORS.courtWood);
  ctx.fillRect(-W, BZ, 2 * W, PLANE_MAX_Z - BZ);
  // Plank stripes along z, alternating shade with a slow deterministic variation.
  const plank = 0.25;
  for (let i = 0, x = -W; x < W; i++, x += plank) {
    const shade = ((i % 2) ? 0.05 : -0.03) + (((i * 7) % 5) - 2) * 0.012;
    ctx.fillStyle = shade >= 0 ? 'rgba(255,255,255,' + shade.toFixed(3) + ')' : 'rgba(0,0,0,' + (-shade).toFixed(3) + ')';
    ctx.fillRect(x, BZ, Math.min(plank, W - x), PLANE_MAX_Z - BZ);
  }
  // Painted key (lane) and the centre-circle logo disc.
  ctx.fillStyle = cssHex(COLORS.keyPaint);
  ctx.fillRect(-LINES.KEY_HALF_W, BZ, 2 * LINES.KEY_HALF_W, LINES.FT_Z - BZ);
  ctx.beginPath();
  ctx.arc(0, 0, LINES.CENTER_R, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = cssHex(COLORS.lines);
  ctx.lineWidth = LW;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  // Boundary: sidelines, baseline and the half-court line (z = 0).
  ctx.strokeRect(-W, BZ, 2 * W, -BZ);
  // Centre circle (its far half sits on the backcourt strip and is clipped by the plane edge).
  ctx.beginPath();
  ctx.arc(0, 0, LINES.CENTER_R, 0, TAU);
  ctx.stroke();
  // Key outline and free-throw line.
  ctx.strokeRect(-LINES.KEY_HALF_W, BZ, 2 * LINES.KEY_HALF_W, LINES.FT_Z - BZ);
  // Lane hash marks (3 per side, purely decorative).
  ctx.beginPath();
  for (let k = 1; k <= 3; k++) {
    const z = BZ + 0.9 + k * 0.9;
    ctx.moveTo(-LINES.KEY_HALF_W - 0.25, z); ctx.lineTo(-LINES.KEY_HALF_W, z);
    ctx.moveTo(LINES.KEY_HALF_W, z); ctx.lineTo(LINES.KEY_HALF_W + 0.25, z);
  }
  ctx.stroke();
  // Free-throw circle: solid half toward the camera, dashed half inside the key.
  ctx.beginPath();
  ctx.arc(0, LINES.FT_Z, LINES.FT_CIRCLE_R, 0, Math.PI);
  ctx.stroke();
  ctx.setLineDash([0.35, 0.25]);
  ctx.beginPath();
  ctx.arc(0, LINES.FT_Z, LINES.FT_CIRCLE_R, Math.PI, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  // Restricted arc under the rim, with short straights down to the baseline.
  ctx.beginPath();
  ctx.moveTo(-LINES.RESTRICTED_R, BZ);
  ctx.lineTo(-LINES.RESTRICTED_R, RIM.z);
  ctx.arc(RIM.x, RIM.z, LINES.RESTRICTED_R, Math.PI, 0, true);
  ctx.lineTo(LINES.RESTRICTED_R, BZ);
  ctx.stroke();
  // Three-point line: corner straights joined by the arc (angles measured from +x toward +z).
  const aJoin = Math.atan2(LINES.CORNER_Z_END - RIM.z, LINES.CORNER_X - RIM.x);
  ctx.beginPath();
  ctx.moveTo(-LINES.CORNER_X, BZ);
  ctx.lineTo(-LINES.CORNER_X, LINES.CORNER_Z_END);
  ctx.arc(RIM.x, RIM.z, LINES.THREE_R, Math.PI - aJoin, aJoin, true);
  ctx.lineTo(LINES.CORNER_X, BZ);
  ctx.stroke();
  // Backboard footprint and a rim marker on the floor help read depth from the elevated camera.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(BOARD.min.x, BOARD.max.z);
  ctx.lineTo(BOARD.max.x, BOARD.max.z);
  ctx.stroke();

  // Centre logo text, drawn in pixel space so the glyphs are not stretched by the plane ratio.
  const c = worldToPx(0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold ' + Math.round(size * 0.05) + 'px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('3x3', c.px, c.py);
}

// Backboard face: translucent white with the painted target square whose bottom edge sits at rim height.
function drawBoard(ctx, w, h) {
  const bw = BOARD.max.x - BOARD.min.x, bh = BOARD.max.y - BOARD.min.y;
  const px = w / bw, py = h / bh;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = cssHex(COLORS.rim);
  ctx.lineWidth = 0.05 * px;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  // Target square 0.59 x 0.45 m, centred on x, bottom edge at RIM.y (canvas row 0 = board top).
  const sqW = 0.59 * px, sqH = 0.45 * py;
  const bottom = (BOARD.max.y - RIM.y) * py;
  ctx.strokeRect(w / 2 - sqW / 2, bottom - sqH, sqW, sqH);
}

// Net vertices: strand j at level k (k = 0 rim ... NET_RINGS bottom). Returns xyz for (j, k).
function netPoint(j, k, out) {
  const a = (j / NET_STRANDS) * TAU;
  const r = lerp(RIM.r, NET_R_BOTTOM, k / NET_RINGS);
  out[0] = RIM.x + Math.cos(a) * r;
  out[1] = RIM.y - NET_LEN * (k / NET_RINGS);
  out[2] = RIM.z + Math.sin(a) * r;
  return out;
}

function buildNet() {
  const segs = NET_STRANDS * NET_RINGS * 2;         // vertical strand pieces + ring pieces
  const base = new Float32Array(segs * 2 * 3);
  const weight = new Float32Array(segs * 2);       // per-vertex wobble weight (1 - k/4 from the rim)
  const p = [0, 0, 0];
  let v = 0;
  const put = (j, k) => {
    netPoint(j, k, p);
    base[v * 3] = p[0]; base[v * 3 + 1] = p[1]; base[v * 3 + 2] = p[2];
    weight[v] = k / NET_RINGS;                     // 0 at the rim, 1 at the bottom
    v++;
  };
  for (let j = 0; j < NET_STRANDS; j++) {
    for (let k = 0; k < NET_RINGS; k++) { put(j, k); put(j, k + 1); }
  }
  for (let k = 1; k <= NET_RINGS; k++) {
    for (let j = 0; j < NET_STRANDS; j++) { put(j, k); put((j + 1) % NET_STRANDS, k); }
  }
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(base), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos);
  const net = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: COLORS.net, transparent: true, opacity: 0.9,
  }));
  net.frustumCulled = false;
  return { net, netBase: base, weight };
}

// Builds the floor plane and the hoop. opts.maxAnisotropy (renderer.capabilities.getMaxAnisotropy())
// and opts.createCanvas (canvas factory for headless use) are optional.
export function buildCourt(scene, opts) {
  const o = opts || {};
  const size = COURT.CANVAS_SIZE;
  const courtTex = makeCanvasTexture(size, size, (ctx) => drawCourtCanvas(ctx, size), o.createCanvas);
  courtTex.anisotropy = Math.min(4, o.maxAnisotropy || 4);
  courtTex.generateMipmaps = true;
  courtTex.minFilter = THREE.LinearMipmapLinearFilter;
  courtTex.magFilter = THREE.LinearFilter;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(COURT.PLANE_W, COURT.PLANE_D),
    new THREE.MeshLambertMaterial({ map: courtTex })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, COURT.PLANE_CENTER_Z);
  scene.add(floor);

  const group = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({ color: COLORS.pole });
  const poleZ = -15.3, poleH = 3.9, armY = 3.4;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, poleH, 12), poleMat);
  pole.position.set(RIM.x, poleH / 2, poleZ);
  const armLen = 2.2;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, armLen), poleMat);
  arm.position.set(RIM.x, armY, (poleZ + BOARD.min.z) / 2);

  const boardTex = makeCanvasTexture(BOARD_TEX, BOARD_TEX, drawBoard, o.createCanvas);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD.max.x - BOARD.min.x, BOARD.max.y - BOARD.min.y, BOARD.max.z - BOARD.min.z),
    new THREE.MeshLambertMaterial({
      color: COLORS.board, map: boardTex, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  board.position.set(
    (BOARD.min.x + BOARD.max.x) / 2, (BOARD.min.y + BOARD.max.y) / 2, (BOARD.min.z + BOARD.max.z) / 2
  );

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(RIM.r, RIM.tube, 8, 24),
    new THREE.MeshLambertMaterial({ color: COLORS.rim })
  );
  rim.rotation.x = Math.PI / 2;               // torus lies in XY by default; lay it flat
  rim.position.set(RIM.x, RIM.y, RIM.z);

  const { net, netBase, weight } = buildNet();
  group.add(pole, arm, board, rim, net);
  scene.add(group);

  const posAttr = net.geometry.getAttribute('position');
  const arr = posAttr.array;
  const n = weight.length;
  let restored = true;
  // Net wobble (spec section 10): for t in [0, 0.6) after a score, vertex y -= 0.08*sin(pi t/0.6)*w
  // and the radius about the rim axis scales by 1 + 0.15*sin(2 pi t/0.6)*w, where w = 1 at the
  // bottom ring and 0 at the rim so the net stays attached. Outside the window the base is restored.
  function animateNet(t) {
    if (!(t >= 0) || t >= NET_T) {
      if (!restored) {
        arr.set(netBase);
        posAttr.needsUpdate = true;
        restored = true;
      }
      return;
    }
    const dy = 0.08 * Math.sin(Math.PI * t / NET_T);
    const ds = 0.15 * Math.sin(TAU * t / NET_T);
    for (let i = 0; i < n; i++) {
      const w = weight[i];
      const s = 1 + ds * w;
      arr[i * 3] = RIM.x + (netBase[i * 3] - RIM.x) * s;
      arr[i * 3 + 1] = netBase[i * 3 + 1] - dy * w;
      arr[i * 3 + 2] = RIM.z + (netBase[i * 3 + 2] - RIM.z) * s;
    }
    posAttr.needsUpdate = true;
    restored = false;
  }

  return {
    floor,
    hoop: { group, pole, arm, rim, board, net, netBase, RIM, BOARD },
    animateNet,
  };
}
