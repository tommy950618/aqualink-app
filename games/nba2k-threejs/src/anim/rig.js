/**
 * rig.js — the 53-bone game-engine rig, anatomical channels and per-player rig frames (spec §4.1, [ANIM §1]).
 *
 * Exports
 *   BONE_COUNT, BONE_NAMES, BONE (frozen name → index), BONE_PARENT (Int8Array), MIRROR (Int8Array: opposite-side
 *   bone, self for axial bones), BONE_SIDE (Int8Array: +1 left, −1 right, 0 axial), BONE_KIND (Uint8Array of AQ codes),
 *   AQ (anatomical bone kinds), SOCK / SOCKET_NAMES / SOCKET_COUNT (socket indices shared by Animator and AnimProxy),
 *   assertBoneTable(headerBones), buildRig(player, headerBones?) → Rig, anatQuat(kind, side, ch, out, outOff, chOff),
 *   toLocal(rig, b, qAnat, out, qOff, outOff), the small quaternion helpers (qmul, qident, qcopy, qconj, qnlerp, qrotate,
 *   qFromBasis) used by pose.js / clip.js, LEG_REF (reference leg length that defines sLeg = 1), and the allocating
 *   test/tool helpers fkWorld(rig, qAnat, pel) and socketWorld(rig, fk, sockIdx).
 *
 * Conventions (binding, [ANIM §1.2–§1.4])
 *   Character frame: +x = the character's LEFT, +y up, +z forward; Root stays identity; rest rotations are identity,
 *   so bind world = rest local and every bone's bind world rotation is I.
 *   Quaternions are stored [x, y, z, w] (three.js order). Products are Hamilton products: (a·b) applied to a vector
 *   rotates by b first, then a — the left factor is the outermost / parent-most rotation.
 *   Anatomical quaternion Q of bone b (left side shown; the right side negates every Ry and Rz angle):
 *     axial (pelvis, spine_0x, neck_01, head)  Ry(yaw)·Rx(pitch)·Rz(−roll)
 *     clavicle  Rz(elev)·Ry(−prot)            upperarm  Rx(−flex)·Rz(abd)·Ry(−int)
 *     lowerarm  Rx(−elbow)·Ry(−0.40·pron)     hand      Ry(−0.60·pron)·Rx(−wFlex)·Rz(wDev)
 *     finger_0k Rx(−curl)·Rz(spread·sgn)      thumb_01  Rx(−tFlex)·Rz(tAbd)·Ry(−tRot); thumb_02/03 Rx(−curl)
 *     thigh     Rx(−hip)·Rz(abd)·Ry(−int)     calf Rx(+knee)   foot Rx(+ank)·Rz(−inv)   ball Rx(−toe)
 *   Bone-local quaternion L = PRE·Q·POST with per-player constant frames (identity for axial, clavicle and leg
 *   bones): upperarm PRE I / POST F_ua⁻¹; lowerarm PRE F_ua / POST F_la⁻¹; hand, fingers, thumb PRE F_h / POST F_h⁻¹.
 *   F_ua re-aims the A-pose arm so Q = I hangs it straight down with the elbow hinge on +x; F_la removes the bind
 *   elbow flexion; F_h puts wrist/finger axes in the hand frame (Z_h = bind palm normal, medial).
 *   Why it works: the world rotation of the lower arm becomes Qclav·Qua·Qla·F_la⁻¹ (the F_ua factors cancel), i.e. the
 *   anatomical rotations compose in a clean world-aligned "arm hanging" frame while the bone keeps its bind roll.
 *
 * Mirror rule: a pose mirrors by swapping _l/_r and negating axial yaw/roll — limb channels are per-side anatomical,
 * which is exactly why the right side negates Ry/Rz above (reflection in x keeps x-rotations and flips y/z ones).
 *
 * No three.js dependency (pure math on Float32Arrays) so clips compile headless in Node.
 */

/** Number of bones in the game-engine rig. */
export const BONE_COUNT = 53;

/** Canonical bone table ([ANIM §1.1], header order, parents first). */
export const BONE_NAMES = Object.freeze([
  'Root', 'pelvis', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r',
  'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'upperarm_r', 'lowerarm_r', 'hand_r', 'neck_01', 'head',
  'index_01_l', 'index_01_r', 'index_02_l', 'index_02_r', 'index_03_l', 'index_03_r',
  'middle_01_l', 'middle_01_r', 'middle_02_l', 'middle_02_r', 'middle_03_l', 'middle_03_r',
  'pinky_01_l', 'pinky_01_r', 'pinky_02_l', 'pinky_02_r', 'pinky_03_l', 'pinky_03_r',
  'ring_01_l', 'ring_01_r', 'ring_02_l', 'ring_02_r', 'ring_03_l', 'ring_03_r',
  'thumb_01_l', 'thumb_01_r', 'thumb_02_l', 'thumb_02_r', 'thumb_03_l', 'thumb_03_r',
]);

/** Parent index per bone ([ANIM §1.1]); Root has −1. */
export const BONE_PARENT = Int8Array.from([
  -1, 0, 1, 2, 3, 4, 1, 6, 7, 8,
  1, 10, 11, 12, 12, 13, 15, 16,
  14, 18, 19, 12, 21,
  17, 20, 23, 24, 25, 26,
  17, 20, 29, 30, 31, 32,
  17, 20, 35, 36, 37, 38,
  17, 20, 41, 42, 43, 44,
  17, 20, 47, 48, 49, 50,
]);

/** Frozen name → index map. */
export const BONE = (() => {
  const m = {};
  for (let i = 0; i < BONE_COUNT; i++) m[BONE_NAMES[i]] = i;
  return Object.freeze(m);
})();

/** Anatomical bone kinds (selects the elemental rotation recipe in anatQuat). */
export const AQ = Object.freeze({
  ROOT: 0, AXIAL: 1, CLAV: 2, UPPERARM: 3, LOWERARM: 4, HAND: 5, FINGER: 6, THUMB1: 7, THUMB: 8,
  THIGH: 9, CALF: 10, FOOT: 11, TOE: 12,
});

/** +1 for _l bones, −1 for _r bones, 0 for axial ones. */
export const BONE_SIDE = new Int8Array(BONE_COUNT);
/** Index of the opposite-side bone (self for axial bones). */
export const MIRROR = new Int8Array(BONE_COUNT);
/** AQ kind of every bone. */
export const BONE_KIND = new Uint8Array(BONE_COUNT);

for (let i = 0; i < BONE_COUNT; i++) {
  const n = BONE_NAMES[i];
  const side = n.endsWith('_l') ? 1 : n.endsWith('_r') ? -1 : 0;
  BONE_SIDE[i] = side;
  MIRROR[i] = side === 0 ? i : BONE[n.slice(0, -1) + (side > 0 ? 'r' : 'l')];
  let k = AQ.AXIAL;
  if (n === 'Root') k = AQ.ROOT;
  else if (n.startsWith('clavicle')) k = AQ.CLAV;
  else if (n.startsWith('upperarm')) k = AQ.UPPERARM;
  else if (n.startsWith('lowerarm')) k = AQ.LOWERARM;
  else if (n.startsWith('hand')) k = AQ.HAND;
  else if (n.startsWith('thumb_01')) k = AQ.THUMB1;
  else if (n.startsWith('thumb')) k = AQ.THUMB;
  else if (/^(index|middle|ring|pinky)_/.test(n)) k = AQ.FINGER;
  else if (n.startsWith('thigh')) k = AQ.THIGH;
  else if (n.startsWith('calf')) k = AQ.CALF;
  else if (n.startsWith('foot')) k = AQ.FOOT;
  else if (n.startsWith('ball')) k = AQ.TOE;
  BONE_KIND[i] = k;
}

/**
 * Socket indices ([ANIM §1.6], spec §4.1). `ball` is the virtual "current ball centre" socket (ball mode `both` →
 * midpoint of both ball1 sockets, `R`/`L` → that hand's ball1), the §10.6 `ballBoth` query.
 */
export const SOCK = Object.freeze({
  palm_r: 0, palm_l: 1, ball1_r: 2, ball1_l: 3, tip_r: 4, tip_l: 5, rimHook_r: 6, rimHook_l: 7,
  heel_r: 8, heel_l: 9, toe_r: 10, toe_l: 11, ankle_r: 12, ankle_l: 13, ballJ_r: 14, ballJ_l: 15,
  eyeC: 16, chin: 17, ball: 18,
});
/** Socket names by index. */
export const SOCKET_NAMES = Object.freeze(Object.keys(SOCK).sort((a, b) => SOCK[a] - SOCK[b]));
/** Number of real (bone-attached) sockets; `ball` (18) is virtual. */
export const SOCKET_COUNT = 18;

/** Kobe's measured thigh + calf (m): the reference body, sLeg = legLen / LEG_REF ([ANIM §1.5]). */
export const LEG_REF = 0.9995;

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------------------------
// Quaternion helpers on flat arrays ([x, y, z, w] at an offset). All allocation free.
// ---------------------------------------------------------------------------------------------------------------

/** out[o..o+3] = a[ao..] · b[bo..] (Hamilton). out may alias a or b. */
export function qmul(a, ao, b, bo, out, o) {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Writes the identity quaternion. */
export function qident(out, o) { out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 1; }

/** Copies a quaternion. */
export function qcopy(src, so, out, o) {
  out[o] = src[so]; out[o + 1] = src[so + 1]; out[o + 2] = src[so + 2]; out[o + 3] = src[so + 3];
}

/** Conjugate (= inverse for unit quaternions). */
export function qconj(src, so, out, o) {
  out[o] = -src[so]; out[o + 1] = -src[so + 1]; out[o + 2] = -src[so + 2]; out[o + 3] = src[so + 3];
}

/**
 * Normalised linear interpolation with the hemisphere check (b is negated when dot < 0 so the blend takes the
 * short arc). Accurate enough for 30 Hz track sampling and pose blending (nlerp error < 0.1° for ≤ 30° steps).
 */
export function qnlerp(a, ao, b, bo, u, out, o) {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  if (ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = az + (bz - az) * u, w = aw + (bw - aw) * u;
  const l = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l; out[o + 3] = w / l;
}

/** Rotates the vector v[vo..vo+2] by quaternion q[qo..] into out[o..] (out may alias v). */
export function qrotate(q, qo, v, vo, out, o) {
  const qx = q[qo], qy = q[qo + 1], qz = q[qo + 2], qw = q[qo + 3];
  const vx = v[vo], vy = v[vo + 1], vz = v[vo + 2];
  // t = 2·(q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
  out[o] = vx + qw * tx + (qy * tz - qz * ty);
  out[o + 1] = vy + qw * ty + (qz * tx - qx * tz);
  out[o + 2] = vz + qw * tz + (qx * ty - qy * tx);
}

/** Quaternion from a rotation matrix given by its three columns (unit axes X, Y, Z). */
export function qFromBasis(X, Y, Z, out, o) {
  const m00 = X[0], m10 = X[1], m20 = X[2];
  const m01 = Y[0], m11 = Y[1], m21 = Y[2];
  const m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const l = Math.sqrt(x * x + y * y + z * z + w * w);
  out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l; out[o + 3] = w / l;
}

// Elemental rotation (axis 0 = x, 1 = y, 2 = z) by `deg` degrees, multiplied onto acc (acc = acc · R).
const _e = new Float64Array(4);
function mulElem(acc, axis, deg) {
  if (deg === 0) return;
  const h = deg * DEG * 0.5, s = Math.sin(h), c = Math.cos(h);
  _e[0] = axis === 0 ? s : 0; _e[1] = axis === 1 ? s : 0; _e[2] = axis === 2 ? s : 0; _e[3] = c;
  qmul(acc, 0, _e, 0, acc, 0);
}

const _acc = new Float64Array(4);

/**
 * Anatomical quaternion of a bone of kind `kind` (AQ.*) on `side` (+1 left, −1 right, 0 axial) from its channels
 * (degrees) `ch[chOff..]`. Channel layouts per kind:
 *   AXIAL [pitch, yaw, roll]; CLAV [elev, prot]; UPPERARM [flex, abd, int]; LOWERARM [elbow, pron];
 *   HAND [pron, wFlex, wDev] (full pronation value; the 0.60 share is applied here); FINGER [curl, spreadSigned];
 *   THUMB1 [tFlex, tAbd, tRot]; THUMB [curl]; THIGH [hip, abd, int]; CALF [knee]; FOOT [ank, inv]; TOE [toe].
 * LOWERARM likewise takes the full pronation and applies the 0.40 share. Writes [x, y, z, w] to out[outOff..].
 */
export function anatQuat(kind, side, ch, out, outOff = 0, chOff = 0) {
  // The right side mirrors the left: Rx angles unchanged, Ry and Rz angles negated (s = −1).
  const s = side < 0 ? -1 : 1;
  _acc[0] = 0; _acc[1] = 0; _acc[2] = 0; _acc[3] = 1;
  const a = ch[chOff], b = ch[chOff + 1], c = ch[chOff + 2];
  switch (kind) {
    case AQ.AXIAL: // Ry(yaw)·Rx(pitch)·Rz(−roll)
      mulElem(_acc, 1, b); mulElem(_acc, 0, a); mulElem(_acc, 2, -c); break;
    case AQ.CLAV: // Rz(elev)·Ry(−prot)
      mulElem(_acc, 2, s * a); mulElem(_acc, 1, -s * b); break;
    case AQ.UPPERARM: // Rx(−flex)·Rz(abd)·Ry(−int)
    case AQ.THIGH: // Rx(−hip)·Rz(abd)·Ry(−int)
      mulElem(_acc, 0, -a); mulElem(_acc, 2, s * b); mulElem(_acc, 1, -s * c); break;
    case AQ.LOWERARM: // Rx(−elbow)·Ry(−0.40·pron)
      mulElem(_acc, 0, -a); mulElem(_acc, 1, -s * 0.40 * b); break;
    case AQ.HAND: // Ry(−0.60·pron)·Rx(−wFlex)·Rz(wDev)
      mulElem(_acc, 1, -s * 0.60 * a); mulElem(_acc, 0, -b); mulElem(_acc, 2, s * c); break;
    case AQ.FINGER: // Rx(−curl)·Rz(spread·sgn)
      mulElem(_acc, 0, -a); mulElem(_acc, 2, s * b); break;
    case AQ.THUMB1: // Rx(−tFlex)·Rz(tAbd)·Ry(−tRot)
      mulElem(_acc, 0, -a); mulElem(_acc, 2, s * b); mulElem(_acc, 1, -s * c); break;
    case AQ.THUMB: // Rx(−curl)
    case AQ.TOE: // Rx(−toe)
      mulElem(_acc, 0, -a); break;
    case AQ.CALF: // Rx(+knee)
      mulElem(_acc, 0, a); break;
    case AQ.FOOT: // Rx(+ank)·Rz(−inv)
      mulElem(_acc, 0, a); mulElem(_acc, 2, -s * (b || 0)); break;
    default: break; // ROOT: identity
  }
  out[outOff] = _acc[0]; out[outOff + 1] = _acc[1]; out[outOff + 2] = _acc[2]; out[outOff + 3] = _acc[3];
  return out;
}

/**
 * Bone-local quaternion L = PRE·Q·POST of bone b for this rig, from the anatomical quaternion qAnat[qOff..].
 * `out` is either a flat array (written at outOff) or an object with x/y/z/w fields (e.g. a standalone
 * THREE.Quaternion scratch: its fields are assigned directly, so no change callback fires).
 */
export function toLocal(rig, b, qAnat, out, qOff = 0, outOff = 0) {
  const t = _loc;
  if (rig.hasPrePost[b]) {
    qmul(rig.pre, b * 4, qAnat, qOff, t, 0);
    qmul(t, 0, rig.post, b * 4, t, 0);
  } else {
    t[0] = qAnat[qOff]; t[1] = qAnat[qOff + 1]; t[2] = qAnat[qOff + 2]; t[3] = qAnat[qOff + 3];
  }
  if (out.isQuaternion === true || (out.length === undefined && 'w' in out)) {
    if ('_x' in out) { out._x = t[0]; out._y = t[1]; out._z = t[2]; out._w = t[3]; } else { out.x = t[0]; out.y = t[1]; out.z = t[2]; out.w = t[3]; }
  } else {
    out[outOff] = t[0]; out[outOff + 1] = t[1]; out[outOff + 2] = t[2]; out[outOff + 3] = t[3];
  }
  return out;
}
const _loc = new Float64Array(4);

// ---------------------------------------------------------------------------------------------------------------
// Header validation and rig construction
// ---------------------------------------------------------------------------------------------------------------

/**
 * Asserts that a header bone table ([{name, parent}] in header order) equals the canonical table.
 * Throws an Error naming the first mismatch.
 */
export function assertBoneTable(headerBones) {
  if (!Array.isArray(headerBones) || headerBones.length !== BONE_COUNT) {
    throw new Error(`rig: header has ${headerBones && headerBones.length} bones, expected ${BONE_COUNT}`);
  }
  for (let i = 0; i < BONE_COUNT; i++) {
    const hb = headerBones[i];
    const name = typeof hb === 'string' ? hb : hb.name;
    const parent = typeof hb === 'string' ? BONE_PARENT[i] : hb.parent;
    if (name !== BONE_NAMES[i] || parent !== BONE_PARENT[i]) {
      throw new Error(`rig: bone ${i} is ${name}(${parent}), expected ${BONE_NAMES[i]}(${BONE_PARENT[i]})`);
    }
  }
  return true;
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scl(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(a) { return Math.sqrt(dot(a, a)); }
function nrm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

/** Projects v onto the plane ⟂ y and normalises (Gram–Schmidt step of the frame construction). */
function orthoTo(v, y) { return nrm(sub(v, scl(y, dot(v, y)))); }

/**
 * Builds the per-player rig from a header player object (`header.players[i]`: needs `bones[k].head/tail`,
 * `landmarks` (or v2 `face`), optional `meta.calibration.{handLen, footLen}`, optional `id`, `height`).
 * `headerBones` (the top-level `header.bones`) is asserted against the canonical table when given.
 *
 * Returns a Rig:
 *   { id, pre, post: Float32Array(53·4), hasPrePost: Uint8Array(53), restPos: Float32Array(53·3) (bone-local rest
 *     translation = head − parent head), bindPos: Float32Array(53·3) (bind world heads), frames: {ua_l, la_l, h_l,
 *     ua_r, la_r, h_r: Float32Array(4) quaternions; axes_h_l/_r: {X, Y, Z}}, metrics, sockets: {name: Float32Array(4)
 *     [boneIdx, x, y, z]}, sock: Float32Array(SOCKET_COUNT·4) (same data indexed by SOCK) }.
 */
export function buildRig(player, headerBones) {
  if (headerBones) assertBoneTable(headerBones);
  if (!player || !Array.isArray(player.bones) || player.bones.length !== BONE_COUNT) {
    throw new Error('rig: player bones missing or not 53');
  }
  const head = (i) => player.bones[i].head;
  const tail = (i) => player.bones[i].tail;
  const B = BONE;

  const restPos = new Float32Array(BONE_COUNT * 3);
  const bindPos = new Float32Array(BONE_COUNT * 3);
  for (let i = 0; i < BONE_COUNT; i++) {
    const h = head(i), p = BONE_PARENT[i];
    bindPos[i * 3] = h[0]; bindPos[i * 3 + 1] = h[1]; bindPos[i * 3 + 2] = h[2];
    const ph = p >= 0 ? head(p) : [0, 0, 0];
    restPos[i * 3] = h[0] - ph[0]; restPos[i * 3 + 1] = h[1] - ph[1]; restPos[i * 3 + 2] = h[2] - ph[2];
  }

  const pre = new Float32Array(BONE_COUNT * 4);
  const post = new Float32Array(BONE_COUNT * 4);
  const hasPrePost = new Uint8Array(BONE_COUNT);
  for (let i = 0; i < BONE_COUNT; i++) { qident(pre, i * 4); qident(post, i * 4); }

  const frames = {};
  for (const sd of ['l', 'r']) {
    const left = sd === 'l';
    const S = head(B['upperarm_' + sd]), E = head(B['lowerarm_' + sd]), W = head(B['hand_' + sd]);
    const I = head(B['index_01_' + sd]), K = head(B['pinky_01_' + sd]), M = head(B['middle_01_' + sd]);
    // Elbow hinge: normal of the upper-arm/forearm plane, oriented to +x on both sides ([ANIM §1.4]).
    let hinge = nrm(cross(sub(E, S), sub(W, E)));
    if (hinge[0] < 0) hinge = scl(hinge, -1);
    const Yua = nrm(sub(S, E)), Xua = orthoTo(hinge, Yua), Zua = cross(Xua, Yua);
    const Yla = nrm(sub(E, W)), Xla = orthoTo(hinge, Yla), Zla = cross(Xla, Yla);
    const knk = left ? sub(I, K) : sub(K, I); // toward the thumb on the left, toward the pinky on the right
    const Yh = nrm(sub(W, M)), Xh = orthoTo(knk, Yh), Zh = cross(Xh, Yh); // Zh = bind palm normal
    const qua = new Float32Array(4), qla = new Float32Array(4), qh = new Float32Array(4);
    qFromBasis(Xua, Yua, Zua, qua, 0); qFromBasis(Xla, Yla, Zla, qla, 0); qFromBasis(Xh, Yh, Zh, qh, 0);
    frames['ua_' + sd] = qua; frames['la_' + sd] = qla; frames['h_' + sd] = qh;
    frames['axes_ua_' + sd] = { X: Xua, Y: Yua, Z: Zua };
    frames['axes_la_' + sd] = { X: Xla, Y: Yla, Z: Zla };
    frames['axes_h_' + sd] = { X: Xh, Y: Yh, Z: Zh };
    frames['hinge_' + sd] = hinge;
    // bind elbow flexion (deg) = angle between the upper-arm and forearm directions
    frames['bindElbow_' + sd] = Math.acos(Math.max(-1, Math.min(1, dot(nrm(sub(E, S)), nrm(sub(W, E)))))) / DEG;

    const ua = B['upperarm_' + sd], la = B['lowerarm_' + sd], hd = B['hand_' + sd];
    qconj(qua, 0, post, ua * 4); hasPrePost[ua] = 1;
    qcopy(qua, 0, pre, la * 4); qconj(qla, 0, post, la * 4); hasPrePost[la] = 1;
    for (let i = 0; i < BONE_COUNT; i++) {
      if (i === hd || (BONE_PARENT[i] >= 0 && isUnderHand(i, hd))) {
        qcopy(qh, 0, pre, i * 4); qconj(qh, 0, post, i * 4); hasPrePost[i] = 1;
      }
    }
  }

  // ---- metrics ([ANIM §1.5]) ----
  const d3 = (a, b) => len(sub(a, b));
  const legL = d3(head(B.thigh_l), head(B.calf_l)) + d3(head(B.calf_l), head(B.foot_l));
  const legR = d3(head(B.thigh_r), head(B.calf_r)) + d3(head(B.calf_r), head(B.foot_r));
  const legLen = 0.5 * (legL + legR);
  const thighLen = 0.5 * (d3(head(B.thigh_l), head(B.calf_l)) + d3(head(B.thigh_r), head(B.calf_r)));
  const calfLen = legLen - thighLen;
  const armLen = 0.5 * (d3(head(B.upperarm_l), head(B.lowerarm_l)) + d3(head(B.lowerarm_l), head(B.hand_l))
    + d3(head(B.upperarm_r), head(B.lowerarm_r)) + d3(head(B.lowerarm_r), head(B.hand_r)));
  const cal = (player.meta && player.meta.calibration) || {};
  const handLen = cal.handLen || d3(head(B.hand_l), tail(B.middle_03_l));
  const lm = player.landmarks || player.face || {};
  const eyeL = lm['l-eye'] || (player.eyes && player.eyes.l && player.eyes.l.c);
  const eyeR = lm['r-eye'] || (player.eyes && player.eyes.r && player.eyes.r.c);
  const eyeC = eyeL && eyeR ? lerp3(eyeL, eyeR, 0.5) : add(head(B.head), [0, 0.07, 0.09]);
  const jaw = lm.jaw || add(head(B.head), [0, -0.07, 0.11]);
  const sLeg = legLen / LEG_REF;
  const footHeelZ = 0.5 * (head(B.foot_l)[2] + head(B.foot_r)[2]) - 0.06 * sLeg;
  const footLen = cal.footLen || (0.5 * (tail(B.ball_l)[2] + tail(B.ball_r)[2]) - footHeelZ);
  const shoulderY = 0.5 * (head(B.upperarm_l)[1] + head(B.upperarm_r)[1]);
  const reach0 = shoulderY + armLen + 0.6 * handLen;
  const metrics = Object.freeze({
    height: player.height || 0,
    pelvisY: head(B.pelvis)[1],
    hipH: 0.5 * (head(B.thigh_l)[1] + head(B.thigh_r)[1]),
    thighLen, calfLen, legLen, sLeg,
    shoulderY, armLen, handLen, footLen,
    ankleY: 0.5 * (head(B.foot_l)[1] + head(B.foot_r)[1]),
    ankleX: 0.5 * (head(B.foot_l)[0] - head(B.foot_r)[0]),
    eyeY: eyeC[1],
    reach0,
    reachAug: reach0 + 0.07 + 0.05,
  });

  // ---- sockets ([ANIM §1.6]); offsets relative to the parent bone head (bind rotation I) ----
  const sockets = {};
  const sock = new Float32Array(SOCKET_COUNT * 4);
  const put = (name, bone, world) => {
    const h = head(bone);
    const s = new Float32Array([bone, world[0] - h[0], world[1] - h[1], world[2] - h[2]]);
    sockets[name] = s;
    sock.set(s, SOCK[name] * 4);
  };
  for (const sd of ['l', 'r']) {
    const hd = B['hand_' + sd];
    const W = head(hd), M = head(B['middle_01_' + sd]);
    const { Y: Yh, Z: Zh } = frames['axes_h_' + sd];
    const palm = add(lerp3(W, M, 0.55), scl(Zh, 0.012));
    put('palm_' + sd, hd, palm);
    put('ball1_' + sd, hd, add(add(palm, scl(Zh, 0.12 + 0.010)), scl(Yh, -0.015)));
    put('tip_' + sd, B['middle_03_' + sd], tail(B['middle_03_' + sd]));
    put('rimHook_' + sd, hd, add(lerp3(W, M, 0.80), scl(Zh, 0.025)));
    const ft = B['foot_' + sd], ank = head(ft), bl = B['ball_' + sd];
    put('heel_' + sd, ft, [ank[0], 0, ank[2] - 0.06 * sLeg]);
    const toe = tail(bl);
    put('toe_' + sd, bl, [toe[0], 0.01, toe[2]]);
    put('ankle_' + sd, ft, ank);
    put('ballJ_' + sd, bl, head(bl));
  }
  put('eyeC', B.head, eyeC);
  put('chin', B.head, jaw);

  return {
    id: player.id || null,
    pre, post, hasPrePost, restPos, bindPos, frames, metrics, sockets, sock,
  };
}

function isUnderHand(i, hand) {
  for (let p = BONE_PARENT[i]; p >= 0; p = BONE_PARENT[p]) if (p === hand) return true;
  return false;
}

/**
 * Bind-relative forward kinematics helper for tests and tools (allocates; not for the frame loop):
 * given anatomical quaternions qAnat (Float32Array(53·4)) and pelvis offset pel (m, already × sLeg), returns
 * world bone heads Float64Array(53·3) and world rotations Float64Array(53·4) with Root at the origin, yaw 0.
 */
export function fkWorld(rig, qAnat, pel) {
  const pos = new Float64Array(BONE_COUNT * 3), rot = new Float64Array(BONE_COUNT * 4);
  const loc = new Float64Array(4), v = new Float64Array(3);
  for (let i = 0; i < BONE_COUNT; i++) {
    toLocal(rig, i, qAnat, loc, i * 4, 0);
    const p = BONE_PARENT[i];
    v[0] = rig.restPos[i * 3]; v[1] = rig.restPos[i * 3 + 1]; v[2] = rig.restPos[i * 3 + 2];
    if (i === BONE.pelvis && pel) { v[0] += pel[0]; v[1] += pel[1]; v[2] += pel[2]; }
    if (p < 0) {
      pos[0] = v[0]; pos[1] = v[1]; pos[2] = v[2]; qcopy(loc, 0, rot, 0);
    } else {
      qrotate(rot, p * 4, v, 0, v, 0);
      pos[i * 3] = pos[p * 3] + v[0]; pos[i * 3 + 1] = pos[p * 3 + 1] + v[1]; pos[i * 3 + 2] = pos[p * 3 + 2] + v[2];
      qmul(rot, p * 4, loc, 0, rot, i * 4);
    }
  }
  return { pos, rot };
}

/** World position of socket `sockIdx` from an fkWorld() result (allocates; tests/tools). */
export function socketWorld(rig, fk, sockIdx) {
  const b = rig.sock[sockIdx * 4];
  const v = new Float64Array([rig.sock[sockIdx * 4 + 1], rig.sock[sockIdx * 4 + 2], rig.sock[sockIdx * 4 + 3]]);
  qrotate(fk.rot, b * 4, v, 0, v, 0);
  return [fk.pos[b * 3] + v[0], fk.pos[b * 3 + 1] + v[1], fk.pos[b * 3 + 2] + v[2]];
}
