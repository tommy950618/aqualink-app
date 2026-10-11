/**
 * @module legends
 * The six legends: identity, listed stats, ratings, release heights, abilities, traits, AI tendencies, off-ball
 * spots, runtime look and kits (spec §2.1–§2.7, §2.9), plus the teams, the default lineup, the team UI colours and the
 * display composites (§2.4). With `src/i18n.js` this is the only `src` file allowed CJK text (player and team names).
 *
 * All data is frozen (deeply) at module evaluation. `LEGEND_IDS` is the header order of the baked assets; a unit test
 * (`test/unit-lineup.mjs`) checks names, numbers and stats against the baked header `players[i].meta`.
 *
 * Kit data (§2.7): `kit.classic` names the side ('home' | 'away') of the player's classic kit and `kit[kit.classic]`
 * holds that kit's paint description; the opposite side is `null` (v2 paints only `classic`, `allstarA`, `allstarB`;
 * the All-Star repaints are `ALLSTAR_KITS`). Band lists are `{color, mm}` from the edge inward.
 * `kit.shoes.home` / `kit.shoes.away` are the shoe colourways `[c0 upper, c1 accents, c2 side panel/outsole]`
 * (Jordan: objects with the overrides of §2.7, identifiers `jordanHome` / `jordanAway`); the classic kit uses
 * `kit.shoes.classic`, All-Star A the `home` and All-Star B the `away` colourway.
 */

export const LEGEND_IDS = Object.freeze(['kobe', 'jordan', 'lebron', 'giannis', 'yao', 'kyrie']);

/** Rating keys in table order (§2.3); `overall` first. Card chips use this order for ties. */
export const RATING_KEYS = Object.freeze(['overall', 'speed', 'strength', 'vertical', 'ballHandle', 'closeShot', 'midRange',
  'three', 'dunk', 'layup', 'passing', 'perimeterD', 'interiorD', 'block', 'steal', 'rebound']);

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    for (const k of Object.keys(o)) deepFreeze(o[k]);
    Object.freeze(o);
  }
  return o;
}

const band = (color, mm) => ({ color, mm });
const SOCK_SHELL_M = { low: 0.09, crew: 0.13, mid: 0.19, high: 0.27 };   // base metres above the ankle landmark (§8.3)

const RAW = {
  kobe: {
    id: 'kobe', name: { zh: '科比·布莱恩特', en: 'Kobe Bryant' }, short: { zh: '科比', en: 'Kobe' },
    number: '24', era: '2008-10', hand: 'R',
    stats: { heightM: 1.98, barefootM: 1.96, weightKg: 96, wingspanM: 2.11, reachM: 2.64 },
    shoulderJoints: 0.455,
    ratings: { overall: 97, speed: 85, strength: 72, vertical: 88, ballHandle: 91, closeShot: 92, midRange: 98, three: 84,
      dunk: 88, layup: 95, passing: 82, perimeterD: 93, interiorD: 55, block: 50, steal: 86, rebound: 60 },
    release: { jumper: 3.00, fade: 2.95, hook: null },
    abilities: ['kobe.postFade', 'kobe.jab', 'kobe.tough', 'clutch'],
    traits: { chaseBlock: 1, canDunkTraffic: true, noDribbleMoves: false, threeGate: null, maxDribbles: null },
    tend: {
      mix: { rim: 0.25, close: 0, mid: 0.45, three: 0.15, post: 0.15 },
      shotRim: 1.00, shotClose: 0.80, shotMid: 1.32, shotThree: 0.84, post: 0.84, iso: 1.10, isoMoves: [1, 2],
      patience: 2.5, pass: 0.80, kickWhenDoubled: 0.60, driveRight: 0.60, jab: 0.70, pumpFake: 0.25, fade: 0.55,
      stepback: 0.25, checkShare: 0.40, crash: 0.20, boxOut: 0.40, stealGamble: 1.20, help: 0.60,
      contestJump: [0.70, 0.70], closeout: 1.0, guardBest: 1, riskTol: 0.15,
    },
    spots: { rightElbow: 0.30, rightWing: 0.30, rightBlock: 0.15, leftWing: 0.15, rightBaseline: 0.10 },
    look: {
      skin: '#8B5A3C', lips: '#6a4030', palms: '#b48466', skinRoughness: 0.52, warmK: 0.10, cavityK: 0.45, hlK: 0.10,
      tattooK: 0, stubbleHair: 1, hair: '#1a1311', beard: '#151010', scalpDarken: 0.65, scalpRoughness: 0.72,
      beardSkinDarken: 0.70, beardSkinMaskK: 1, browDarken: 0.60, glossBase: 0, clearcoatRoughness: 0.30,
      sheenColor: '#5e5650', skinSheen: { color: '#6a5c56', k: 0.10 }, iris: '#2A1A12',
      idleFace: { channel: 'scowl', base: 0.35, chewAmp: 0, chewHz: 0 },
    },
    kit: {
      classic: 'home',
      home: {
        label: 'gold', base: '#FDB927', number: '#552583', outline: '#FFFFFF', keyline: null, glyph: 'rounded', serifOne: false,
        bands: [band('#552583', 9), band('#FFFFFF', 3)],
        shortsStripe: [band('#FFFFFF', 6), band('#552583', 30), band('#FFFFFF', 6)],
        waistband: [band('#552583', 40)], hem: [band('#552583', 12)],
      },
      away: null,
      socks: { shell: 'high', heightM: SOCK_SHELL_M.high, color: '#FFFFFF', braceBulge: true },
      backName: 'BRYANT', shortsFit: 'baggy-2000s',
      shoes: { cut: 'low', home: ['#FFFFFF', '#FDB927', '#552583'], away: ['#552583', '#111111', '#FDB927'], classic: 'home' },
      accessories: [
        { id: 'sleeve', shell: 'sleeve_r', side: 'R', region: '13 cm below the shoulder joint to the wrist', offsetMm: 3,
          cuffBandCm: 2.5, roughness: 0.35, colors: { classic: '#111111', allstarA: '#111111', allstarB: '#111111' } },
        { id: 'fingerTape', shell: 'tape_r_im', side: 'R', region: 'weight(index_01/02_r, middle_01/02_r) > 0.55', offsetMm: 0.8,
          colors: { classic: '#f4f4f4', allstarA: '#f4f4f4', allstarB: '#111111' } },
      ],
      extras: { undershort: null, shortsNumber: null },
    },
  },

  jordan: {
    id: 'jordan', name: { zh: '迈克尔·乔丹', en: 'Michael Jordan' }, short: { zh: '乔丹', en: 'Jordan' },
    number: '23', era: '1991-98', hand: 'R',
    stats: { heightM: 1.98, barefootM: 1.96, weightKg: 98, wingspanM: 2.11, reachM: 2.65 },
    shoulderJoints: 0.460,
    ratings: { overall: 98, speed: 91, strength: 72, vertical: 94, ballHandle: 88, closeShot: 95, midRange: 99, three: 76,
      dunk: 96, layup: 98, passing: 82, perimeterD: 97, interiorD: 58, block: 63, steal: 96, rebound: 66 },
    release: { jumper: 3.00, fade: 3.00, hook: null },
    abilities: ['jordan.fade', 'jordan.air', 'jordan.ftDunk', 'jordan.hawk', 'clutch'],
    traits: { chaseBlock: 1, canDunkTraffic: true, noDribbleMoves: false, threeGate: null, maxDribbles: null },
    tend: {
      mix: { rim: 0.38, close: 0, mid: 0.45, three: 0.10, post: 0.07 },
      shotRim: 1.21, shotClose: 0.80, shotMid: 1.32, shotThree: 0.76, post: 0.72, iso: 1.00, isoMoves: [1, 2],
      patience: 2.5, pass: 0.90, kickWhenDoubled: 0.70, driveRight: 0.60, jab: 0.40, pumpFake: 0.25, fade: 0.60,
      stepback: 0.10, checkShare: 0.55, crash: 0.30, boxOut: 0.50, stealGamble: 1.30, help: 0.90,
      contestJump: [0.80, 0.80], closeout: 1.0, guardBest: 1, riskTol: 0.12,
    },
    spots: { leftElbow: 0.25, rightElbow: 0.25, rightWing: 0.25, leftBlock: 0.125, rightBlock: 0.125 },
    look: {
      skin: '#4E3122', lips: '#3A221B', palms: '#A9785E', skinRoughness: 0.62, warmK: 0.0, cavityK: 0.55, hlK: 0.05,
      tattooK: 0, stubbleHair: 0, hair: '#0E0A09', beard: '#0E0A09', scalpDarken: 0, scalpRoughness: 0.25,
      beardSkinDarken: 0.80, beardSkinMaskK: 1, browDarken: 0.75, glossBase: 0.55, clearcoatRoughness: 0.22,
      sheenColor: '#6a5a50', skinSheen: { color: '#5c5656', k: 0.12 }, iris: '#2A1A12',
      // gum chew: jawOpen = 0.06 + 0.06·max(0, sin(2π·1.5t)) (§2.6, ANIM §2.8)
      idleFace: { channel: 'jawOpen', base: 0.06, chewAmp: 0.06, chewHz: 1.5 },
    },
    kit: {
      classic: 'away',
      home: null,
      away: {
        label: 'red', base: '#CE1141', number: '#FFFFFF', outline: '#000000', keyline: null, glyph: 'block', serifOne: false,
        bands: [band('#000000', 5), band('#FFFFFF', 3), band('#000000', 5)],
        shortsStripe: [band('#000000', 12), band('#FFFFFF', 6)],
        waistband: [band('#000000', 8), band('#FFFFFF', 4), band('#000000', 8)], hem: [band('#000000', 6)],
      },
      socks: { shell: 'low', heightM: SOCK_SHELL_M.low, color: '#000000', braceBulge: false },
      backName: 'JORDAN', shortsFit: 'baggy-1990s-knee',
      shoes: {
        cut: 'mid-high', classic: 'away',
        home: { id: 'jordanHome', upper: '#FFFFFF', mudguard: { color: '#0a0a0a', roughness: 0.10 }, sidePanel: false,
          outsole: { color: '#a8d8f0', roughness: 0.30 }, midsole: '#F2F2F0' },
        away: { id: 'jordanAway', upper: { color: '#0a0a0a', roughness: 0.80 }, mudguard: { color: '#0a0a0a', roughness: 0.05 },
          heelTab: '#CE1141', midsole: '#FFFFFF', outsole: { color: '#CE1141', roughness: 0.85 } },
      },
      accessories: [
        { id: 'wristband', shell: 'wristband_l', side: 'L', region: 'lowerarm_l weight > 0.5, 3.4–11.0 cm (base) below the elbow joint',
          widthCm: 9, offsetMm: 4, colors: { classic: '#CE1141', allstarA: '#FFFFFF', allstarB: '#111111' } },
      ],
      extras: {
        undershort: { color: '#9bc4e2', widthM: 0.015 },                    // inner 1.5 cm of both shorts hems
        shortsNumber: null,   // likeness round 3: the left-leg number still rendered garbled (UV metric); off until fixed
      },
    },
  },

  lebron: {
    id: 'lebron', name: { zh: '勒布朗·詹姆斯', en: 'LeBron James' }, short: { zh: '詹姆斯', en: 'LeBron' },
    number: '23', era: '2016-18', hand: 'R',
    stats: { heightM: 2.06, barefootM: 2.03, weightKg: 113.4, wingspanM: 2.14, reachM: 2.69 },
    shoulderJoints: 0.505,
    ratings: { overall: 98, speed: 87, strength: 98, vertical: 88, ballHandle: 88, closeShot: 93, midRange: 82, three: 77,
      dunk: 96, layup: 96, passing: 97, perimeterD: 88, interiorD: 82, block: 74, steal: 78, rebound: 87 },
    release: { jumper: 2.85, fade: 2.85, hook: null },
    abilities: ['lebron.powerDrive', 'lebron.chaseDown', 'lebron.skipPass', 'lebron.bully'],
    traits: { chaseBlock: 2, canDunkTraffic: true, noDribbleMoves: false, threeGate: null, maxDribbles: null },
    tend: {
      mix: { rim: 0.45, close: 0, mid: 0.15, three: 0.20, post: 0.10 },
      shotRim: 1.32, shotClose: 0.80, shotMid: 0.84, shotThree: 0.92, post: 0.76, iso: 0.80, isoMoves: [0, 1],
      patience: 3.0, pass: 1.35, kickWhenDoubled: 0.90, driveRight: 0.50, jab: 0.15, pumpFake: 0.10, fade: 0.25,
      stepback: 0.30, checkShare: 0.50, crash: 0.35, boxOut: 0.70, stealGamble: 1.00, help: 1.00,
      contestJump: [0.80, 0.90], closeout: 1.0, guardBest: 0, riskTol: 0.10,
    },
    spots: { top: 0.35, leftWing: 0.30, rightWing: 0.20, leftBlock: 0.15 },
    look: {
      skin: '#6A4530', lips: '#4a2e22', palms: '#A47A5E', skinRoughness: 0.55, warmK: 0.0, cavityK: 0.7, hlK: 0.06,
      tattooK: 1.0, stubbleHair: 0.5, hair: '#141010', beard: '#18120e', scalpDarken: 0.70, scalpRoughness: 0.70,
      beardSkinDarken: 0.75, beardSkinMaskK: 1, browDarken: 0.65, glossBase: 0, clearcoatRoughness: 0.50,
      sheenColor: '#6a5a50', skinSheen: { color: '#4e4644', k: 0.06 }, iris: '#2A1A12',
      idleFace: { channel: null, base: 0, chewAmp: 0, chewHz: 0 },
    },
    kit: {
      classic: 'away',
      home: null,
      away: {
        label: 'wine', base: '#6F263D', number: '#FFB81C', outline: '#041E42', keyline: null, glyph: 'block', serifOne: false,
        bands: [band('#FFB81C', 3), band('#041E42', 3)],
        shortsStripe: [band('#041E42', 10), band('#FFB81C', 20), band('#041E42', 10)],
        waistband: [band('#FFB81C', 6)], hem: [band('#041E42', 6)],
      },
      socks: { shell: 'crew', heightM: SOCK_SHELL_M.crew, color: '#111111', braceBulge: false },
      backName: 'JAMES', shortsFit: '2010s-knee',
      shoes: { cut: 'high', home: ['#FFFFFF', '#FFB81C', '#6F263D'], away: ['#6F263D', '#FFB81C', '#111111'], classic: 'away' },
      accessories: [
        { id: 'headbandHigh', shell: 'headband_high', side: null,
          region: 'Gy + 0.034 … + 0.076 base metres at the front, dropping 4.5 cm toward the back (dips under the occiput)', offsetMm: 5,
          colors: { classic: '#111111', allstarA: '#FFFFFF', allstarB: '#111111' } },
        { id: 'tattoos', shell: null, side: null, region: 'skin extra.R: 26 × 5 cm upper-back arch (likeness round 4: the arm noise blobs read as dirt / bruises and are off until line art ships)',
          darken: 0.22, desaturate: 0.50, colors: null },
      ],
      extras: { undershort: null, shortsNumber: null },
    },
  },

  giannis: {
    id: 'giannis', name: { zh: '扬尼斯·阿德托昆博', en: 'Giannis Antetokounmpo' }, short: { zh: '字母哥', en: 'Giannis' },
    number: '34', era: '2019-21', hand: 'R',
    stats: { heightM: 2.11, barefootM: 2.09, weightKg: 110, wingspanM: 2.21, reachM: 2.81 },
    shoulderJoints: 0.485,
    ratings: { overall: 96, speed: 88, strength: 92, vertical: 95, ballHandle: 76, closeShot: 93, midRange: 66, three: 58,
      dunk: 99, layup: 95, passing: 79, perimeterD: 87, interiorD: 91, block: 88, steal: 74, rebound: 94 },
    release: { jumper: 2.90, fade: 2.90, hook: 3.05 },
    abilities: ['giannis.euro', 'giannis.longDunk', 'giannis.helpBlock'],
    traits: { chaseBlock: 1, canDunkTraffic: true, noDribbleMoves: false, threeGate: 2.5, maxDribbles: null },
    tend: {
      mix: { rim: 0.60, close: 0.15, mid: 0.10, three: 0.15, post: 0 },
      shotRim: 1.56, shotClose: 0.84, shotMid: 0.76, shotThree: 0.84, post: 0.60, iso: 0.60, isoMoves: [0, 1],
      patience: 1.5, pass: 1.00, kickWhenDoubled: 0.75, driveRight: 0.65, jab: 0.10, pumpFake: 0.05, fade: 0.05,
      stepback: 0.00, checkShare: 0.10, crash: 0.55, boxOut: 0.60, stealGamble: 0.80, help: 1.50,
      contestJump: [0.80, 0.95], closeout: 1.0, guardBest: 0, riskTol: 0.18,
    },
    spots: { top: 0.25, rightWing: 0.20, leftDunker: 0.25, rightDunker: 0.30 },
    look: {
      skin: '#50352b', lips: '#3e261c', palms: '#9c705a', skinRoughness: 0.62, warmK: 0.0, cavityK: 0.7, hlK: 0.03,
      tattooK: 0, stubbleHair: 0, hair: '#1a1512', beard: '#141110', scalpDarken: 1.0, scalpRoughness: 0.75,
      beardSkinDarken: 0.80, beardSkinMaskK: 1, browDarken: 0.60, glossBase: 0, clearcoatRoughness: 0.45,
      sheenColor: '#5e5650', skinSheen: { color: '#5a4e48', k: 0.04 }, iris: '#2A1A12',
      idleFace: { channel: null, base: 0, chewAmp: 0, chewHz: 0 },
    },
    kit: {
      classic: 'away',
      home: null,
      away: {
        label: 'green', base: '#00471B', number: '#EEE1C6', outline: '#FFFFFF', keyline: null, glyph: 'block', serifOne: false,
        bands: [band('#EEE1C6', 3)],
        shortsStripe: [band('#0077C0', 2), band('#EEE1C6', 40), band('#0077C0', 2)],
        waistband: [band('#EEE1C6', 6)], hem: [band('#EEE1C6', 6)],
      },
      socks: { shell: 'mid', heightM: SOCK_SHELL_M.mid, color: '#FFFFFF', braceBulge: false },
      backName: 'ANTETOKOUNMPO', shortsFit: '2020s-knee',
      shoes: { cut: 'low-mid', home: ['#FFFFFF', '#00471B', '#EEE1C6'], away: ['#111111', '#00471B', '#EEE1C6'], classic: 'home' },
      accessories: [],
      extras: { undershort: null, shortsNumber: null },
    },
  },

  yao: {
    id: 'yao', name: { zh: '姚明', en: 'Yao Ming' }, short: { zh: '姚明', en: 'Yao' },
    number: '11', era: '2004-09', hand: 'R',
    stats: { heightM: 2.29, barefootM: 2.27, weightKg: 141, wingspanM: 2.26, reachM: 2.95 },
    shoulderJoints: 0.490,
    ratings: { overall: 89, speed: 38, strength: 86, vertical: 42, ballHandle: 42, closeShot: 95, midRange: 80, three: 30,
      dunk: 72, layup: 74, passing: 66, perimeterD: 50, interiorD: 97, block: 96, steal: 42, rebound: 90 },
    release: { jumper: 3.45, fade: 3.40, hook: 3.55 },
    abilities: ['yao.hook', 'yao.highRelease', 'yao.anchor', 'yao.post'],
    // threeGate Infinity: never a three, except with the shot clock < 1.5 s (AI)
    traits: { chaseBlock: 0, canDunkTraffic: false, noDribbleMoves: true, threeGate: Infinity, maxDribbles: 2 },
    tend: {
      mix: { rim: 0.05, close: 0.30, mid: 0.35, three: 0.00, post: 0.60 },
      shotRim: 0.68, shotClose: 1.08, shotMid: 1.16, shotThree: 0, post: 1.56, iso: 0, isoMoves: [0, 0],
      patience: 2.0, pass: 1.00, kickWhenDoubled: 0.95, driveRight: 0.50, jab: 0.00, pumpFake: 0.30, fade: 0.15,
      stepback: 0.00, checkShare: 0.05, crash: 0.60, boxOut: 1.00, stealGamble: 0.20, help: 1.20,
      contestJump: [0.40, 1.00], closeout: 0.85, guardBest: 0, riskTol: 0.15,
    },
    spots: { leftBlock: 0.40, rightBlock: 0.25, leftElbow: 0.15, rightElbow: 0.20 },
    look: {
      skin: '#D8A985', lips: '#a87462', palms: '#e4bea0', skinRoughness: 0.52, warmK: 0.15, cavityK: 0.20, hlK: 0.05,
      tattooK: 0, stubbleHair: 0, hair: '#121010', beard: '#2a2420', scalpDarken: 0.90, scalpRoughness: 0.70,
      beardSkinDarken: 1.0, beardSkinMaskK: 0.07, browDarken: 0.60, glossBase: 0, clearcoatRoughness: 0.30,
      sheenColor: '#8090a0', skinSheen: { color: '#7a6e68', k: 0.06 }, iris: '#2A1A12',
      idleFace: { channel: null, base: 0, chewAmp: 0, chewHz: 0 },
    },
    kit: {
      classic: 'away',
      home: null,
      away: {
        label: 'red', base: '#CE1141', number: '#FFFFFF', outline: '#C4CED4', keyline: '#000000', glyph: 'block', serifOne: true,
        bands: [band('#FFFFFF', 3), band('#C4CED4', 2)],
        shortsStripe: [band('#FFFFFF', 12), band('#C4CED4', 8), band('#000000', 4)],
        waistband: [band('#FFFFFF', 6)], hem: [band('#C4CED4', 6)],
      },
      // + 3 mm ankle-brace bulge ±4 cm around the ankle (sock offsetScale)
      socks: { shell: 'crew', heightM: SOCK_SHELL_M.crew, color: '#FFFFFF', braceBulge: true },
      backName: 'YAO', shortsFit: 'baggy-2000s',
      shoes: { cut: 'high', home: ['#FFFFFF', '#CE1141', '#FFFFFF'], away: ['#CE1141', '#FFFFFF', '#111111'], classic: 'away' },
      accessories: [],
      extras: { undershort: null, shortsNumber: null },
    },
  },

  kyrie: {
    id: 'kyrie', name: { zh: '凯里·欧文', en: 'Kyrie Irving' }, short: { zh: '欧文', en: 'Kyrie' },
    number: '2', era: '2014-17', hand: 'R',
    stats: { heightM: 1.88, barefootM: 1.87, weightKg: 88, wingspanM: 1.93, reachM: 2.515 },
    shoulderJoints: 0.425,
    ratings: { overall: 93, speed: 91, strength: 55, vertical: 80, ballHandle: 99, closeShot: 90, midRange: 93, three: 90,
      dunk: 55, layup: 99, passing: 84, perimeterD: 70, interiorD: 36, block: 35, steal: 72, rebound: 45 },
    release: { jumper: 2.80, fade: 2.80, hook: null },
    abilities: ['kyrie.combo', 'kyrie.finisher', 'kyrie.stepback', 'clutch'],
    traits: { chaseBlock: 0, canDunkTraffic: false, noDribbleMoves: false, threeGate: null, maxDribbles: null },
    tend: {
      mix: { rim: 0.40, close: 0.10, mid: 0.25, three: 0.25, post: 0 },
      shotRim: 1.24, shotClose: 0.76, shotMid: 1.00, shotThree: 1.00, post: 0, iso: 1.40, isoMoves: [2, 4],
      patience: 3.5, pass: 0.85, kickWhenDoubled: 0.70, driveRight: 0.60, jab: 0.10, pumpFake: 0.10, fade: 0.20,
      stepback: 0.55, checkShare: 0.40, crash: 0.05, boxOut: 0.30, stealGamble: 1.20, help: 0.50,
      contestJump: [0.50, 0.30], closeout: 1.0, guardBest: 0, riskTol: 0.15,
    },
    spots: { top: 0.30, rightWing: 0.30, leftCorner: 0.15, rightCorner: 0.15, leftWing: 0.10 },
    look: {
      skin: '#8A5A3B', lips: '#5a3628', palms: '#b88a6c', skinRoughness: 0.56, warmK: 0.0, cavityK: 0.70, hlK: 0.06,
      tattooK: 1.0, stubbleHair: 0, hair: '#1c1714', beard: '#1a1411', scalpDarken: 1.0, scalpRoughness: 0.75,
      beardSkinDarken: 0.65, beardSkinMaskK: 1, browDarken: 0.80, glossBase: 0, clearcoatRoughness: 0.45,
      sheenColor: '#5e5650', skinSheen: { color: '#6a5c56', k: 0.10 }, iris: '#2A1A12',
      idleFace: { channel: null, base: 0, chewAmp: 0, chewHz: 0 },
    },
    kit: {
      classic: 'away',
      home: null,
      away: {
        label: 'wine alternate', base: '#6F263D', number: '#FFB81C', outline: '#FFFFFF', keyline: null, glyph: 'block', serifOne: false,
        bands: [band('#FFB81C', 5), band('#FFFFFF', 2)],
        shortsStripe: [band('#FFFFFF', 6), band('#FFB81C', 24), band('#FFFFFF', 6)],
        waistband: [band('#FFB81C', 6)], hem: [band('#FFB81C', 6)],
      },
      socks: { shell: 'crew', heightM: SOCK_SHELL_M.crew, color: '#FFFFFF', braceBulge: false },
      backName: 'IRVING', shortsFit: '2010s-knee',
      shoes: { cut: 'low', home: ['#FFFFFF', '#6F263D', '#FFB81C'], away: ['#111111', '#FFB81C', '#111111'], classic: 'away' },
      accessories: [
        { id: 'headbandLow', worn: false, shell: 'headband_low', side: null, region: 'Gy + 0.012 … + 0.048', offsetMm: 5,
          colors: { classic: '#111111', allstarA: '#111111', allstarB: '#111111' } },
        { id: 'tattoos', shell: null, side: null, region: 'skin extra.R: 10 × 3 cm dotted bracket, mid left forearm; 3D noise blobs 2–6 cm thresholded at 0.45',
          darken: 0.30, desaturate: 0.50, colors: null },
        { id: 'mouthguard', shell: null, side: null, highTierOnly: true, sizeCm: [1.8, 1.45, 0.30], tris: 12,
          region: 'rigid Mesh child of the head bone sharing the wet material; visible while smirk > 0.1 or idle with jawOpen ≥ 0.15',
          colors: { classic: '#f2f2f2', allstarA: '#f2f2f2', allstarB: '#f2f2f2' } },
      ],
      extras: { undershort: null, shortsNumber: null },
    },
  },
};

// Every accessory without an explicit `worn` flag is worn.
for (const id of LEGEND_IDS) for (const a of RAW[id].kit.accessories) if (a.worn === undefined) a.worn = true;

/** The six legends by id (deeply frozen). */
export const LEGENDS = deepFreeze(RAW);

/** All-Star repaints of every player's kit (§2.7); each player keeps his number and name. */
export const ALLSTAR_KITS = deepFreeze({
  allstarA: {
    label: 'white', base: '#F4F4F1', number: '#C9A227', outline: '#111111', outlineU: 0.30, keyline: null,
    bands: [band('#C9A227', 8), band('#111111', 2)], shortsStripe: [band('#C9A227', 30)],
    waistband: null, hem: null,   // not specified by §2.7: plain base colour
    socks: '#FFFFFF', accessory: '#FFFFFF', shoes: 'home',
  },
  allstarB: {
    label: 'black', base: '#121212', number: '#D22630', outline: '#FFFFFF', outlineU: null, keyline: null,
    bands: [band('#D22630', 8), band('#FFFFFF', 2)], shortsStripe: [band('#D22630', 30)],
    waistband: null, hem: null,   // not specified by §2.7: plain base colour
    socks: '#111111', accessory: '#111111', shoes: 'away',
  },
});

/** Teams (§2.9, C16). `roster` only for the two classic teams (default lineup sides). */
export const TEAMS_V2 = deepFreeze({
  dark: { id: 'dark', name: { zh: '暗夜队', en: 'Team Dark' }, abbr: { zh: '暗夜', en: 'DRK' }, nameKey: 'team.dark', roster: ['lebron', 'kyrie', 'giannis'] },
  bright: { id: 'bright', name: { zh: '烈阳队', en: 'Team Bright' }, abbr: { zh: '烈阳', en: 'BRT' }, nameKey: 'team.bright', roster: ['jordan', 'kobe', 'yao'] },
  allstarA: { id: 'allstarA', name: { zh: '白队', en: 'Team White' }, abbr: { zh: '白队', en: 'WHT' }, nameKey: 'team.white', roster: null },
  allstarB: { id: 'allstarB', name: { zh: '黑队', en: 'Team Black' }, abbr: { zh: '黑队', en: 'BLK' }, nameKey: 'team.black', roster: null },
});

/** Default lineup (§2.9): team A = DARK (LeBron ★), team B = BRIGHT (Jordan ★), user team A, kits auto. */
export const DEFAULT_LINEUP = deepFreeze({ a: ['lebron', 'kyrie', 'giannis'], b: ['jordan', 'kobe', 'yao'], user: 'a', kits: 'auto' });

/** UI chip colours per team (score bug, ring, LED, crowd shirts): background / text / accent (§2.9). */
export const TEAM_UI = deepFreeze({
  dark: { bg: '#6F263D', text: '#FFB81C', accent: '#FFB81C' },
  bright: { bg: '#CE1141', text: '#FFFFFF', accent: '#000000' },
  allstarA: { bg: '#F4F4F1', text: '#1A1A1A', accent: '#D9A520' },
  allstarB: { bg: '#121212', text: '#FFFFFF', accent: '#CE1141' },
});

/** The legend record for an id, or null for an unknown id. */
export function legend(id) {
  return Object.prototype.hasOwnProperty.call(LEGENDS, id) ? LEGENDS[id] : null;
}

/** True for one of the six ids. */
export function isLegendId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(LEGENDS, id);
}

/** Composite formulas of the lineup detail card (§2.4): weights over rating keys; key = i18n `comp.<key>`. */
export const COMPOSITES = deepFreeze({
  sht: { label: 'SHT', weights: { closeShot: 0.25, midRange: 0.40, three: 0.35 } },
  drv: { label: 'DRV', weights: { layup: 0.30, dunk: 0.25, speed: 0.25, ballHandle: 0.20 } },
  ins: { label: 'INS', weights: { closeShot: 0.40, strength: 0.30, rebound: 0.30 } },
  def: { label: 'DEF', weights: { perimeterD: 0.30, interiorD: 0.30, block: 0.20, steal: 0.20 } },
});

/**
 * Display composites (§2.4), rounded to integers: `{sht, drv, ins, def}` (labels i18n `comp.sht` … `comp.def`).
 * Writes into `out` when given (UI re-render without allocation); returns null for an unknown id.
 */
export function composites(id, out) {
  const L = legend(id);
  if (!L) return null;
  const o = out || {};
  for (const key of Object.keys(COMPOSITES)) {
    const w = COMPOSITES[key].weights;
    let s = 0;
    for (const r of Object.keys(w)) s += w[r] * L.ratings[r];
    // + 1e-9 keeps exact .5 sums (binary noise below them) rounding up like the spec table.
    o[key] = Math.round(s + 1e-9);
  }
  return o;
}

/**
 * Card stat chips (§2.4): the player's `count` (default 3) highest ratings excluding `overall`, ties broken by the
 * table order of §2.3. Returns `[{key, value}]` (i18n label `stat.<key>`), or null for an unknown id.
 */
export function topStats(id, count = 3) {
  const L = legend(id);
  if (!L) return null;
  const keys = RATING_KEYS.slice(1);
  keys.sort((a, b) => (L.ratings[b] - L.ratings[a]) || (RATING_KEYS.indexOf(a) - RATING_KEYS.indexOf(b)));
  return keys.slice(0, count).map((key) => ({ key, value: L.ratings[key] }));
}

/** Surname shown on the jersey back (§2.7). */
export function backName(id) {
  const L = legend(id);
  return L ? L.kit.backName : null;
}
