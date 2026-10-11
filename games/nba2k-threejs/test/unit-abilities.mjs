// Unit checks for src/abilities.js (spec §5.8): the 22 descriptors, every multiplier applied exactly once at its hook
// for its owner and never for the other legends, trigger boundaries (FT-line dunk d 5.99 → no / 6.00 → yes, speed
// 5.99 → no; euro d 5.39 → no / 5.40 → yes; …), rule helpers (block modifiers, bumps, passes, post gains, combos,
// shakes, euro dodge) and the ability log ring.
// Run: node test/unit-abilities.mjs
import assert from 'node:assert/strict';
import {
  ABILITIES, ABILITY_IDS, AbilityLog, mul, add, trigger, eligible, has, params, makeAbilityCtx, resetAbilityCtx,
  contestRange, blockModifiers, bumpRule, passRule, postGain, postEntryD, chainLength, comboMul, ankleBase, euroDodgeP,
  fixedMake, stepbackDrift, helpRadius, clutchWindow, coneClear, pathClear, legendOf,
} from '../src/abilities.js';
import { LEGENDS, LEGEND_IDS } from '../src/legends.js';
import { derive } from '../src/ratings.js';
import { RIM, SHAKE, BLOCK } from '../src/constants.js';
import { Rng } from '../src/math.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

function mk(id, team, x, z, o = {}) {
  return { id, team, pos: { x, z }, vel: { x: 0, z: 0 }, jumpY: 0, isJumping: false, state: 'idle', stamina: 1, defAssign: null, ...o };
}
const at = (d) => RIM.z + d;
// A player at distance d straight in front of the rim, running toward it at `speed`, rotated by `deg` off the line.
function runner(id, d, speed, deg = 0, o = {}) {
  const a = deg * Math.PI / 180;
  return mk(id, 0, 0, at(d), { vel: { x: speed * Math.sin(a), z: -speed * Math.cos(a) }, ...o });
}

check('22 frozen descriptors; owners match legends.js; hooks, params and captions', () => {
  assert.equal(ABILITY_IDS.length, 22);
  assert.equal(new Set(ABILITY_IDS).size, 22);
  for (const id of ABILITY_IDS) {
    const d = ABILITIES[id];
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d.params) && Object.isFrozen(d.hooks));
    assert.equal(d.id, id);
    assert.ok(d.kind === 'passive' || d.kind === 'trigger');
    assert.ok(d.hooks.length >= 1, id + ' hooks');
    for (const owner of d.owners) assert.ok(LEGENDS[owner].abilities.includes(id), id + ' owner ' + owner);
    for (const lid of LEGEND_IDS) if (!d.owners.includes(lid)) assert.ok(!LEGENDS[lid].abilities.includes(id), id + ' not ' + lid);
  }
  for (const lid of LEGEND_IDS) for (const id of LEGENDS[lid].abilities) assert.ok(ABILITIES[id], id);
  assert.deepEqual([...ABILITIES.clutch.owners], ['kobe', 'jordan', 'kyrie']);
  assert.equal(ABILITIES['jordan.ftDunk'].kind, 'trigger');
  assert.equal(ABILITIES['jordan.ftDunk'].caption, 'cap.ab.jordan.ftDunk');
  assert.equal(ABILITIES['lebron.chaseDown'].caption, 'cap.chaseDown');
  assert.equal(params('jordan.ftDunk').MAX_PER_GAME, 2);
  assert.equal(params('nope'), null);
  assert.ok(has(mk('yao', 0, 0, 0), 'yao.anchor'));
  assert.ok(!has(mk('kobe', 0, 0, 0), 'yao.anchor'));
});

// [id, hook, ctx fields, owner value, extra player fields for the owner / the ctx]
const MUL_FIXTURES = [
  ['clutch', 'clutch', { quarter: 4, gameClock: 20, scoreDiff: -3 }, 1.05],
  ['clutch', 'contestA', { quarter: 5, gameClock: 0.5, scoreDiff: 0, kind: 'jumper', zone: 'three' }, 0.90],
  ['jordan.fade', 'pg', { kind: 'fade', generic: 0.94 }, 1 / 0.94],
  ['jordan.fade', 'contestA', { kind: 'turnFade', zone: 'three', generic: 0.80 }, 0.65 / 0.80],
  ['jordan.air', 'airtime', { kind: 'layup', variant: 'std' }, 0.80],
  ['jordan.air', 'airtime', { kind: 'dunk', variant: 'tomahawk1' }, 0.80],
  ['jordan.air', 'contestA', { kind: 'layup', variant: 'switch', zone: 'layup' }, 0.70],
  ['jordan.air', 'blockShooter', { kind: 'layup', variant: 'switch' }, 0.40],
  ['jordan.hawk', 'steal', { what: 'stealF' }, 1.15],
  ['kobe.postFade', 'pg', { kind: 'turnFade', variant: 'postFade', generic: 0.95 }, 1 / 0.95],
  ['kobe.postFade', 'contestA', { kind: 'turnFade', variant: 'postFade', zone: 'three', generic: 0.80 }, 0.55 / 0.80],
  ['kobe.jab', 'move', { what: 'bite' }, 1.3],
  ['kobe.jab', 'contestA', { kind: 'jumper', variant: 'jabPullup', zone: 'three' }, 0.70],
  ['kobe.tough', 'contestA', { kind: 'jumper', zone: 'mid' }, 0.70],
  ['lebron.powerDrive', 'contestA', { kind: 'dunk', zone: 'dunk', sinceBumpWon: 0.8 }, 0.60],
  ['lebron.powerDrive', 'drive', { what: 'push', speed: 4.0 }, 1.5],
  ['lebron.skipPass', 'pass', { what: 'sigma', dist: 8.0 }, 0.6],
  ['lebron.bully', 'post', { what: 'gain', defender: 'kyrie' }, 1.3],
  ['giannis.longDunk', 'pg', { kind: 'dunk', variant: 'longGather', pg: 0.95 }, 0.99 / 0.95],
  ['giannis.longDunk', 'contestA', { kind: 'dunk', variant: 'longGather', zone: 'dunk' }, 0.50],
  ['giannis.longDunk', 'blockShooter', { kind: 'dunk', variant: 'longGather' }, 0.60],
  ['giannis.helpBlock', 'blockDefender', { helpDefender: true, kind: 'jumper' }, 1.25],
  ['yao.hook', 'pg', { kind: 'hook', generic: 0.90 }, 1 / 0.90],
  ['yao.hook', 'contestA', { kind: 'hook', zone: 'close', generic: 0.85 }, 0.45 / 0.85],
  ['yao.highRelease', 'blockShooter', { kind: 'jumper', defender: 'kobe' }, 0.60],
  ['yao.anchor', 'blockDefender', { kind: 'layup' }, 1.20, { pos: { x: 0, z: at(1.5) } }],
  ['yao.post', 'pg', { kind: 'layup', variant: 'upUnder', generic: 0.95 }, 1 / 0.95],
  ['kyrie.finisher', 'pg', { kind: 'floater', generic: 0.92 }, 1 / 0.92],
  ['kyrie.finisher', 'contestA', { kind: 'floater', zone: 'close', generic: 0.75 }, 0.60 / 0.75],
  ['kyrie.finisher', 'blockShooter', { kind: 'layup', variant: 'std' }, 0.55],
  ['kyrie.stepback', 'pg', { kind: 'stepback', generic: 0.95 }, 1 / 0.95],
  ['kyrie.stepback', 'contestA', { kind: 'stepback', zone: 'three', generic: 0.80 }, 0.60 / 0.80],
];

check('each multiplier is applied exactly once at its hook for its owner and absent for the other legends', () => {
  for (const [id, hook, fields, value, ownerFields] of MUL_FIXTURES) {
    for (const lid of LEGEND_IDS) {
      const log = new AbilityLog(256);
      const ctx = makeAbilityCtx();
      Object.assign(ctx, fields);
      ctx.log = log; ctx.t = 7;
      if (typeof fields.defender === 'string') ctx.defender = mk(fields.defender, 1, 0, at(3));
      const p = mk(lid, 0, 0, at(5), ABILITIES[id].owners.includes(lid) ? ownerFields || {} : {});
      const m = mul(p, hook, ctx);
      if (ABILITIES[id].owners.includes(lid)) {
        near(m, value, 1e-12, `${id} @${hook} for ${lid}`);
        assert.equal(log.count(id), 1, `${id} logged once for ${lid}`);
        assert.equal(log.total, 1, `${id}: only this ability applies in its fixture (${lid})`);
      } else {
        assert.equal(log.count(id), 0, `${id} must not apply to ${lid}`);
        // whatever else applies to him comes from his own abilities (e.g. Kyrie's finisher on a layup fixture)
        if (log.total === 0) assert.equal(m, 1, `${id} fixture leaves ${lid} at 1`);
        else for (let k = 0; k < log.size; k++) assert.ok(LEGENDS[lid].abilities.includes(log.at(k).id));
      }
    }
  }
});

check('multipliers stay 1 outside their conditions', () => {
  const ctx = makeAbilityCtx();
  const J = mk('jordan', 0, 0, at(5)), K = mk('kobe', 0, 0, at(5)), L = mk('lebron', 0, 0, at(5));
  const Y = mk('yao', 0, 0, at(3)), G = mk('giannis', 0, 0, at(5)), Q = mk('kyrie', 0, 0, at(5));
  Object.assign(ctx, { quarter: 4, gameClock: 24.01, scoreDiff: 0 });
  assert.equal(mul(K, 'clutch', ctx), 1);
  Object.assign(ctx, { quarter: 3, gameClock: 10 });
  assert.equal(mul(Q, 'clutch', ctx), 1);
  Object.assign(ctx, { quarter: 4, gameClock: 10, scoreDiff: 4 });
  assert.equal(mul(J, 'clutch', ctx), 1);
  resetAbilityCtx(ctx);
  Object.assign(ctx, { kind: 'jumper', zone: 'three' });
  assert.equal(mul(K, 'contestA', ctx), 1);                        // tough: mid/close only
  Object.assign(ctx, { kind: 'floater', zone: 'close', generic: 0.75 });
  assert.equal(mul(K, 'contestA', ctx), 1);                        // tough: jump shots only
  Object.assign(ctx, { kind: 'layup', variant: 'switch' });
  assert.equal(mul(J, 'airtime', ctx), 1);                         // signature clips keep normal gravity (C12)
  ctx.variant = 'ftDunk'; ctx.kind = 'dunk';
  assert.equal(mul(J, 'airtime', ctx), 1);
  Object.assign(ctx, { kind: 'layup', sinceBumpWon: 0.81 });
  assert.equal(mul(L, 'contestA', ctx), 1);
  Object.assign(ctx, { what: 'push', speed: 3.99 });
  assert.equal(mul(L, 'drive', ctx), 1);
  Object.assign(ctx, { what: 'sigma', dist: 7.99, kickOut: false });
  assert.equal(mul(L, 'pass', ctx), 1);
  ctx.kickOut = true;
  assert.equal(mul(L, 'pass', ctx), 0.6);
  resetAbilityCtx(ctx);
  Object.assign(ctx, { what: 'gain', defender: mk('giannis', 1, 0, 0) });  // taller and only 6 weaker
  assert.equal(mul(L, 'post', ctx), 1);
  ctx.defender = mk('kobe', 1, 0, 0);                              // 0.08 m shorter
  assert.equal(mul(L, 'post', ctx), 1.3);
  ctx.defender = mk('giannis', 1, 0, 0);
  ctx.kind = 'jumper';
  assert.equal(mul(Y, 'blockShooter', ctx), 1);                    // highRelease only vs H < 2.05
  ctx.helpDefender = false;
  assert.equal(mul(G, 'blockDefender', ctx), 1);
  const farYao = mk('yao', 1, 0, at(2.01));
  assert.equal(mul(farYao, 'blockDefender', ctx), 1);
  resetAbilityCtx(ctx);
  Object.assign(ctx, { kind: 'layup', variant: 'reverse' });
  assert.equal(mul(Q, 'pg', ctx), 1);
  ctx.what = 'range';
  assert.equal(add(mk('jordan', 1, 0, 0), 'steal', ctx), 0.15);
  ctx.what = 'intR';
  assert.equal(add(mk('jordan', 1, 0, 0), 'steal', ctx), 0.20);
  assert.equal(add(mk('kobe', 1, 0, 0), 'steal', ctx), 0);
  ctx.what = 'stealF';
  assert.equal(add(mk('jordan', 1, 0, 0), 'steal', ctx), 0);
});

check('clutch window boundaries (quarter ≥ 4, clock ≤ 24 s, |diff| ≤ 3)', () => {
  assert.equal(clutchWindow(4, 24, 3), true);
  assert.equal(clutchWindow(4, 24, -3), true);
  assert.equal(clutchWindow(5, 0, 0), true);
  assert.equal(clutchWindow(3, 10, 0), false);
  assert.equal(clutchWindow(4, 24.01, 0), false);
  assert.equal(clutchWindow(4, 10, 4), false);
});

check('FT-line dunk trigger boundaries (C10): d 5.99 → no, 6.00 → yes, 7.60 yes, 7.61 no; speed 5.99 → no; heading 25°', () => {
  const ctx = makeAbilityCtx();
  const log = new AbilityLog();
  ctx.log = log;
  const world = { players: [] };
  ctx.world = world;
  const T = (p) => { ctx.t += 1; world.players = [p]; return trigger(p, 'shotKind', ctx); };   // new t: the log books repeats of one step once
  assert.equal(T(runner('jordan', 6.00, 6.5)), 'jordan.ftDunk');
  assert.equal(T(runner('jordan', 5.99, 6.5)), null);
  assert.equal(T(runner('jordan', 7.60, 6.5)), 'jordan.ftDunk');
  assert.equal(T(runner('jordan', 7.61, 6.5)), null);
  assert.equal(T(runner('jordan', 6.5, 6.0)), 'jordan.ftDunk');
  assert.equal(T(runner('jordan', 6.5, 5.99)), null);
  assert.equal(T(runner('jordan', 6.5, 7, 24)), 'jordan.ftDunk');
  assert.equal(T(runner('jordan', 6.5, 7, 26)), null);
  assert.equal(T(runner('jordan', 6.5, 7, 0, { stamina: 0.29 })), null);
  assert.equal(T(runner('jordan', 6.5, 7, 0, { stamina: 0.30 })), 'jordan.ftDunk');
  ctx.ftDunksUsed = 2;
  assert.equal(T(runner('jordan', 6.5, 7)), null);
  ctx.ftDunksUsed = 1;
  assert.equal(T(runner('jordan', 6.5, 7)), 'jordan.ftDunk');
  assert.equal(T(runner('kobe', 6.5, 7)), null);                 // not his ability
  // an opponent within 2.5 m of the segment to the rim blocks it; one behind does not; a teammate does not
  const j = runner('jordan', 6.5, 7);
  world.players = [j, mk('kyrie', 1, 2.4, at(3.0))];
  assert.equal(trigger(j, 'shotKind', ctx), null);
  world.players = [j, mk('kyrie', 1, 2.6, at(8.0))];
  assert.equal(trigger(j, 'shotKind', ctx), 'jordan.ftDunk');
  world.players = [j, mk('kobe', 0, 0.5, at(3.0))];
  assert.equal(trigger(j, 'shotKind', ctx), 'jordan.ftDunk');
  // an opponent closer to the rim inside the 60° cone (beyond 2.5 m of the line) blocks it
  const cone = mk('kyrie', 1, 2.7, at(1.5));
  world.players = [j, cone];
  assert.equal(pathClear(j, world, 2.5), true);
  assert.equal(coneClear(j, world, 60), false);
  assert.equal(trigger(j, 'shotKind', ctx), null);
  assert.ok(log.count('jordan.ftDunk') >= 6);
});

check('euro trigger (C11): d 5.39 → no, 5.40 → yes, ≤ 7.6, speed ≥ 3.5, heading within 45°, with the ball', () => {
  const ctx = makeAbilityCtx();
  ctx.world = { players: [] };
  ctx.dribbling = true;
  const T = (p) => { ctx.world.players = [p]; return trigger(p, 'shotKind', ctx); };
  assert.equal(T(runner('giannis', 5.40, 4.0)), 'giannis.euro');
  assert.equal(T(runner('giannis', 5.39, 4.0)), null);
  assert.equal(T(runner('giannis', 6.0, 3.49)), null);
  assert.equal(T(runner('giannis', 6.0, 3.5)), 'giannis.euro');
  assert.equal(T(runner('giannis', 6.0, 4.0, 44)), 'giannis.euro');
  assert.equal(T(runner('giannis', 6.0, 4.0, 46)), null);
  assert.equal(T(runner('giannis', 7.6, 4.0)), 'giannis.euro');
  assert.equal(T(runner('giannis', 7.61, 4.0)), null);
  assert.equal(T(runner('lebron', 6.0, 4.0)), null);
  ctx.dribbling = false;
  assert.equal(T(runner('giannis', 6.0, 4.0)), null);
});

check('long gather (C11) wins over the euro inside both windows; a defender on the path stops it', () => {
  const ctx = makeAbilityCtx();
  ctx.dribbling = true;
  const g = runner('giannis', 6.5, 5.5);
  ctx.world = { players: [g] };
  assert.equal(trigger(g, 'shotKind', ctx), 'giannis.longDunk');
  ctx.world.players = [g, mk('jordan', 1, 1.4, at(4.0))];
  assert.equal(trigger(g, 'shotKind', ctx), 'giannis.euro');
  const g2 = runner('giannis', 6.39, 5.5);
  ctx.world.players = [g2];
  assert.equal(trigger(g2, 'shotKind', ctx), 'giannis.euro');
  const g3 = runner('giannis', 7.8, 5.0);
  ctx.world.players = [g3];
  assert.equal(trigger(g3, 'shotKind', ctx), 'giannis.longDunk');
  const g4 = runner('giannis', 7.0, 4.99);
  ctx.world.players = [g4];
  assert.equal(trigger(g4, 'shotKind', ctx), 'giannis.euro');
});

check('post fade, Yao hook, Kyrie stepback, Kobe jab, Kyrie combo triggers', () => {
  const ctx = makeAbilityCtx();
  const K = mk('kobe', 0, 0, at(3)), Y = mk('yao', 0, 0, at(3)), Q = mk('kyrie', 0, 0, at(6)), L = mk('lebron', 0, 0, at(3));
  ctx.inPost = true;
  assert.equal(trigger(K, 'shotKind', ctx), 'kobe.postFade');                 // stick neutral
  Object.assign(ctx, { stickMag: 0.8, stickRim: -0.9 });
  assert.equal(trigger(K, 'shotKind', ctx), 'kobe.postFade');                 // stick away
  Object.assign(ctx, { stickMag: 0.8, stickRim: 0.9 });
  assert.equal(trigger(K, 'shotKind', ctx), null);                            // toward the rim = drop step row
  assert.equal(trigger(Y, 'shotKind', ctx), null);
  Object.assign(ctx, { stickMag: 0.8, stickRim: 0.1, stickLat: 0.9 });
  assert.equal(trigger(Y, 'shotKind', ctx), 'yao.hook');
  assert.equal(trigger(L, 'shotKind', ctx), null);
  resetAbilityCtx(ctx);
  ctx.backToRim = true;
  assert.equal(trigger(mk('yao', 0, 0, at(4.5)), 'shotKind', ctx), 'yao.hook');
  assert.equal(trigger(mk('yao', 0, 0, at(4.51)), 'shotKind', ctx), null);
  resetAbilityCtx(ctx);
  Object.assign(ctx, { dribbling: true, stickMag: 0.6, stickRim: -0.6 });
  assert.equal(trigger(Q, 'shotKind', ctx), 'kyrie.stepback');
  ctx.stickMag = 0.49;
  assert.equal(trigger(Q, 'shotKind', ctx), null);
  Object.assign(ctx, { stickMag: 0.6, stickRim: -0.49 });
  assert.equal(trigger(Q, 'shotKind', ctx), null);
  Object.assign(ctx, { stickMag: 0, inMove: 'move.stepback' });
  assert.equal(trigger(Q, 'shotKind', ctx), 'kyrie.stepback');
  resetAbilityCtx(ctx);
  ctx.holding = true;
  assert.equal(trigger(K, 'move', ctx), 'kobe.jab');
  Object.assign(ctx, { stickMag: 0.9, stickDef: 0.8 });
  assert.equal(trigger(K, 'move', ctx), 'kobe.jab');
  Object.assign(ctx, { stickMag: 0.9, stickDef: 0.2 });
  assert.equal(trigger(K, 'move', ctx), null);
  Object.assign(ctx, { stickMag: 0, jabsThisHold: 2 });
  assert.equal(trigger(K, 'move', ctx), null);
  resetAbilityCtx(ctx);
  Object.assign(ctx, { comboIndex: 2, sinceTap: 0.35 });
  assert.equal(trigger(Q, 'move', ctx), 'kyrie.combo');
  ctx.comboIndex = 3;
  assert.equal(trigger(Q, 'move', ctx), 'kyrie.combo');
  ctx.comboIndex = 4;
  assert.equal(trigger(Q, 'move', ctx), null);
  Object.assign(ctx, { comboIndex: 2, sinceTap: 0.36 });
  assert.equal(trigger(Q, 'move', ctx), null);
  ctx.inMove = 'move.cross';
  assert.equal(trigger(Q, 'move', ctx), 'kyrie.combo');
  ctx.comboIndex = 1;
  assert.equal(trigger(Q, 'move', ctx), null);
});

check('chase-down trigger: layup/dunk, LeBron behind (dot < −0.2) within 4.0 m', () => {
  const ctx = makeAbilityCtx();
  const sh = mk('kobe', 1, 0, at(1.8));
  ctx.shooter = sh; ctx.kind = 'layup';
  assert.equal(trigger(mk('lebron', 0, 0, at(4.3)), 'blockDefender', ctx), 'lebron.chaseDown');
  assert.equal(trigger(mk('lebron', 0, 0, at(5.8)), 'blockDefender', ctx), 'lebron.chaseDown');
  assert.equal(trigger(mk('lebron', 0, 0, at(5.81)), 'blockDefender', ctx), null);
  assert.equal(trigger(mk('lebron', 0, 0, at(1.0)), 'blockDefender', ctx), null);  // in front
  assert.equal(trigger(mk('lebron', 0, 3.0, at(1.8)), 'blockDefender', ctx), null); // beside (dot 0)
  ctx.kind = 'dunk';
  assert.equal(trigger(mk('lebron', 0, 0, at(4.3)), 'blockDefender', ctx), 'lebron.chaseDown');
  ctx.kind = 'jumper';
  assert.equal(trigger(mk('lebron', 0, 0, at(4.3)), 'blockDefender', ctx), null);
  ctx.kind = 'layup';
  assert.equal(trigger(mk('giannis', 0, 0, at(4.3)), 'blockDefender', ctx), null);
});

check('Jordan mid-air switch: hand ≤ 0.70 m during a layup, p 0.75 per layup; eligible() never rolls', () => {
  const ctx = makeAbilityCtx();
  const J = mk('jordan', 0, 0, at(2));
  ctx.kind = 'layup'; ctx.variant = 'std'; ctx.rng = new Rng(17);
  ctx.handDist = 0.70;
  let hits = 0;
  for (let i = 0; i < 4000; i++) if (trigger(J, 'blockShooter', ctx) === 'jordan.air') hits++;
  near(hits / 4000, 0.75, 0.025, 'switch rate');
  ctx.handDist = 0.71;
  for (let i = 0; i < 100; i++) assert.equal(trigger(J, 'blockShooter', ctx), null);
  ctx.handDist = 0.5;
  const state = ctx.rng.state;
  assert.equal(eligible(J, 'jordan.air', ctx), true);
  assert.equal(ctx.rng.state, state);
  ctx.kind = 'jumper';
  assert.equal(eligible(J, 'jordan.air', ctx), false);
  assert.equal(eligible(mk('kobe', 0, 0, 0), 'jordan.air', ctx), false);
});

check('eligible() mirrors trigger conditions without logging', () => {
  const ctx = makeAbilityCtx();
  const log = new AbilityLog();
  ctx.log = log;
  const j = runner('jordan', 6.2, 6.4);
  ctx.world = { players: [j] };
  assert.equal(eligible(j, 'jordan.ftDunk', ctx), true);
  assert.equal(eligible(j, 'clutch', ctx), false);       // passives have no trigger test
  assert.equal(log.total, 0);
});

check('block modifiers: finisher 0.55, Yao hook only vs H ≥ 2.05 at B0 × 0.5, chase-down 0.36 / 0.50 / 0.55 / 0.40 s, anchor and help', () => {
  const ctx = makeAbilityCtx();
  const out = {};
  ctx.kind = 'layup'; ctx.variant = 'std';
  blockModifiers(mk('kyrie', 0, 0, at(1.5)), mk('kobe', 1, 0, at(1.0)), ctx, false, out);
  near(out.abilityMul, 0.55, 1e-12);
  assert.equal(out.rHand, 0.30); assert.equal(out.B0, 0.40); assert.equal(out.cap, 0.45); assert.equal(out.window, 0.30);
  assert.equal(out.behindOK, true);                                  // Kobe chaseBlock 1 vs a layup
  blockModifiers(mk('kobe', 0, 0, at(1.5)), mk('kyrie', 1, 0, at(1.0)), ctx, false, out);
  assert.equal(out.behindOK, false);                                 // Kyrie chaseBlock 0
  ctx.kind = 'hook'; ctx.variant = null;
  blockModifiers(mk('yao', 0, 0, at(3)), mk('kyrie', 1, 0, at(2)), ctx, false, out);
  assert.equal(out.eligible, false);
  blockModifiers(mk('yao', 0, 0, at(3)), mk('giannis', 1, 0, at(2)), ctx, false, out);
  assert.equal(out.eligible, true); assert.equal(out.B0Mul, 0.5); assert.equal(out.B0, 0.35); assert.equal(out.cap, 0.40);
  assert.equal(out.window, 0.26);
  ctx.kind = 'layup';
  blockModifiers(mk('kobe', 1, 0, at(1.8)), mk('lebron', 0, 0, at(4.3)), ctx, true, out);
  assert.ok(out.chase && out.pin && out.behindOK);
  assert.equal(out.rHand, 0.36); assert.equal(out.B0, 0.50); assert.equal(out.cap, 0.55); assert.equal(out.window, 0.40);
  // S10 expectation: min(0.55, 0.50 × blkF × hAdv) for LeBron on Kobe
  const blkF = 0.35 + 0.85 * ((74 - 25) / 74), hAdv = Math.min(1.35, 1 + 0.625 * (2.06 - 1.98));
  near(Math.min(out.cap, out.B0 * blkF * hAdv * out.abilityMul), 0.50 * blkF * hAdv, 1e-12);
  ctx.kind = 'jumper';
  blockModifiers(mk('kobe', 1, 0, at(5)), mk('lebron', 0, 0, at(4.3)), ctx, true, out);
  assert.equal(out.chase, false); assert.equal(out.B0, 0.30); assert.equal(out.window, 0.22);
  ctx.kind = 'layup';
  blockModifiers(mk('kobe', 0, 0, at(2)), mk('yao', 1, 0, at(1.5)), ctx, false, out);
  assert.equal(out.rHand, 0.34); near(out.abilityMul, 1.20, 1e-12);
  ctx.helpDefender = true;
  blockModifiers(mk('kobe', 0, 0, at(2)), mk('giannis', 1, 0, at(1.5)), ctx, false, out);
  assert.equal(out.rHand, 0.34); near(out.abilityMul, 1.25, 1e-12);
  ctx.helpDefender = false;
  ctx.kind = 'jumper';
  blockModifiers(mk('yao', 0, 0, at(5)), mk('kyrie', 1, 0, at(4)), ctx, false, out);
  near(out.abilityMul, 0.60, 1e-12);                                 // highRelease vs H < 2.05
  ctx.kind = 'dunk'; ctx.variant = 'longGather';
  blockModifiers(mk('giannis', 0, 0, at(1)), mk('yao', 1, 0, at(3)), ctx, false, out);
  near(out.abilityMul, 0.60, 1e-12);                                 // anchor off: Yao 3 m from the rim
});

check('contest range helper (Yao anchor / Giannis help)', () => {
  const ctx = makeAbilityCtx();
  const out = {};
  const sh = mk('kobe', 0, 0, at(2.5));
  contestRange(mk('yao', 1, 0, at(1.0)), sh, 'layup', ctx, out);
  assert.equal(out.Rc, 3.0); assert.equal(out.deter, 0.15); assert.equal(out.id, 'yao.anchor');
  contestRange(mk('yao', 1, 0, at(2.6)), sh, 'layup', ctx, out);
  assert.equal(out.Rc, 2.2); assert.equal(out.id, null);
  contestRange(mk('yao', 1, 0, at(1.0)), sh, 'mid', ctx, out);
  assert.equal(out.Rc, 2.2);
  contestRange(mk('yao', 1, 0, at(1.0)), mk('kobe', 0, 3.5, at(1.0)), 'close', ctx, out);
  assert.equal(out.Rc, 2.2);                                        // shooter 3.5 m from Yao
  contestRange(mk('giannis', 1, 0, at(1.0), { defAssign: mk('jordan', 0, 3, at(5)) }), sh, 'mid', ctx, out);
  assert.equal(out.Rc, 2.6); assert.equal(out.id, 'giannis.helpBlock');
  contestRange(mk('giannis', 1, 0, at(1.0), { defAssign: sh }), sh, 'mid', ctx, out);
  assert.equal(out.Rc, 2.2);
});

check('bump / pass / post rules: power drive, skip pass, backdown gains (GP §6.2 examples), entry radius', () => {
  const ctx = makeAbilityCtx();
  const o = {};
  bumpRule(mk('lebron', 0, 0, 0), 4.0, ctx, o);
  assert.deepEqual([o.stunDiff, o.pushMul, o.keepMin, o.id], [10, 1.5, 0.80, 'lebron.powerDrive']);
  bumpRule(mk('lebron', 0, 0, 0), 3.9, ctx, o);
  assert.deepEqual([o.stunDiff, o.pushMul, o.keepMin, o.id], [20, 1, 0.25, null]);
  bumpRule(mk('giannis', 0, 0, 0), 5, ctx, o);
  assert.equal(o.stunDiff, 20);
  const lbA = derive(LEGENDS.lebron), kyA = derive(LEGENDS.kyrie);
  passRule(mk('lebron', 0, 0, 0), lbA, 9, false, o);
  assert.deepEqual([o.range, o.speed, o.release, o.sigmaMul, o.jumpPenalty], [14, 15, 0.10, 0.6, 1]);
  passRule(mk('lebron', 0, 0, 0), lbA, 5, false, o);
  assert.deepEqual([o.range, o.speed, o.release, o.sigmaMul], [14, lbA.passSpeed, lbA.passRelease, 1]);
  passRule(mk('kyrie', 0, 0, 0), kyA, 9, true, o);
  assert.deepEqual([o.range, o.speed, o.release, o.sigmaMul, o.jumpPenalty], [9.5, kyA.passSpeed, kyA.passRelease, 1, 1.5]);
  const P = (a, b) => postGain(mk(a, 0, 0, 0), mk(b, 1, 0, 0), ctx);
  near(P('yao', 'kyrie'), 0.35, 1e-12);
  near(P('lebron', 'kyrie'), 0.35, 1e-12);
  near(P('kobe', 'jordan'), 0.117, 0.001);
  near(P('yao', 'lebron'), 0.08, 0.005);
  near(P('kyrie', 'yao'), 0.02, 1e-12);
  // bully × 1.3 inside the cap: LeBron vs Jordan
  const raw = 0.12 + 0.006 * 26 + 0.15 * (113.4 / 98 - 1);
  near(P('lebron', 'jordan'), Math.min(0.35, raw * 1.3), 1e-12);
  assert.equal(postEntryD(mk('yao', 0, 0, 0)), 5.5);
  assert.equal(postEntryD(mk('kobe', 0, 0, 0)), 5.0);
});

check('combos, ankle base, shake / ankle-break examples (GP §7.2), euro dodge (Jordan 0.57, Yao 0.72)', () => {
  const Q = mk('kyrie', 0, 0, 0), K = mk('kobe', 0, 0, 0), Y = mk('yao', 0, 0, 0);
  assert.equal(chainLength(Q), 3); assert.equal(chainLength(K), 2); assert.equal(chainLength(Y), 0);
  assert.deepEqual([1, 2, 3].map((i) => comboMul(Q, i)), [1, 2.0, 3.0]);
  assert.deepEqual([1, 2].map((i) => comboMul(K, i)), [1, 1.5]);
  assert.equal(ankleBase(Q), 0.06); assert.equal(ankleBase(K), 0.03);
  const R = (id) => LEGENDS[id].ratings;
  const handleAdv = (h, d) => Math.min(SHAKE.HANDLE_MAX, Math.max(SHAKE.HANDLE_MIN, 1 + (R(h).ballHandle - R(d).perimeterD) / SHAKE.HANDLE_DIV));
  const pShake = (h, d) => Math.min(SHAKE.P_MAX, Math.max(SHAKE.P_MIN, SHAKE.P_BASE * 1.0 * handleAdv(h, d)));
  const pAnkle = (h, d) => Math.min(SHAKE.ANKLE_MAX, ankleBase(mk(h, 0, 0, 0)) * handleAdv(h, d) * SHAKE.COMMIT * comboMul(mk(h, 0, 0, 0), 2));
  const ex = [['kyrie', 'yao', 0.35, 0.29], ['kyrie', 'jordan', 0.23, 0.19], ['kobe', 'yao', 0.35, 0.11],
    ['jordan', 'kobe', 0.20, 0.06], ['giannis', 'jordan', 0.13, 0.04]];
  for (const [h, d, s, a] of ex) {
    near(pShake(h, d), s, 0.005, `${h} vs ${d} shake`);
    near(pAnkle(h, d), a, 0.005, `${h} vs ${d} ankle`);
  }
  near(euroDodgeP(mk('giannis', 0, 0, 0), mk('jordan', 1, 0, 0)), 0.57, 0.005);
  near(euroDodgeP(mk('giannis', 0, 0, 0), mk('yao', 1, 0, 0)), 0.72, 0.005);
  near(euroDodgeP(mk('kobe', 0, 0, 0), mk('yao', 1, 0, 0)), 0.72 * 0.6, 0.005);
  assert.equal(stepbackDrift(Q), 0.80); assert.equal(stepbackDrift(mk('lebron', 0, 0, 0)), 0.50); assert.equal(stepbackDrift(K), 0.70);
  assert.equal(helpRadius(mk('giannis', 1, 0, 0)), 4.0); assert.equal(helpRadius(K), 3.2);
});

check('fixed make only for Jordan FT-line dunks', () => {
  const ctx = makeAbilityCtx();
  ctx.kind = 'dunk'; ctx.variant = 'ftDunk';
  assert.equal(fixedMake(mk('jordan', 0, 0, 0), ctx), 0.97);
  assert.equal(fixedMake(mk('kobe', 0, 0, 0), ctx), -1);
  ctx.variant = 'tomahawk1';
  assert.equal(fixedMake(mk('jordan', 0, 0, 0), ctx), -1);
});

check('a fixture legend record without abilities gets no ability effects (legendOf / per-record hook lists)', () => {
  const p = { id: 'kobe', legend: { ...LEGENDS.kobe, abilities: [] }, team: 0, pos: { x: 0, z: at(5) } };
  assert.equal(legendOf(p).abilities.length, 0);
  const ctx = makeAbilityCtx();
  Object.assign(ctx, { kind: 'jumper', zone: 'mid', quarter: 4, gameClock: 1, scoreDiff: 0 });
  assert.equal(mul(p, 'contestA', ctx), 1);
  assert.equal(mul(p, 'clutch', ctx), 1);
  assert.equal(has(p, 'kobe.tough'), false);
});

check('AbilityLog: ring of 256, oldest first, duplicate (t, id, player) booked once, counts, onPush, clear', () => {
  const seen = [];
  const log = new AbilityLog(256, (e, d) => seen.push(e.id + ':' + (d ? d.kind : '?')));
  log.push(1, 'kobe.tough', 'kobe', 'contestA', 'jumper');
  assert.equal(log.push(1, 'kobe.tough', 'kobe', 'pg', 'jumper'), null);   // same shot, second hook
  log.push(1, 'clutch', 'kobe', 'clutch', 'jumper');
  log.push(2, 'kobe.tough', 'kobe', 'contestA', 'jumper');
  assert.equal(log.size, 3); assert.equal(log.count('kobe.tough'), 2); assert.equal(log.count('clutch'), 1);
  assert.deepEqual(seen, ['kobe.tough:passive', 'clutch:passive', 'kobe.tough:passive']);
  assert.deepEqual(log.at(0), { t: 1, id: 'kobe.tough', player: 'kobe', ctx: 'contestA', kind: 'jumper' });
  for (let i = 0; i < 300; i++) log.push(10 + i, 'yao.anchor', 'yao', 'blockDefender', 'layup');
  assert.equal(log.size, 256);
  assert.equal(log.total, 303);
  assert.equal(log.at(0).t, 10 + 300 - 256);
  assert.equal(log.at(255).t, 309);
  const arr = log.toArray();
  assert.equal(arr.length, 256); assert.equal(arr[255].id, 'yao.anchor');
  log.clear();
  assert.equal(log.size, 0); assert.equal(log.count('yao.anchor'), 0);
  for (const id of ABILITY_IDS) assert.equal(log.count(id), 0);
});

check('rule tables used by the helpers match the spec numbers', () => {
  assert.equal(BLOCK.R_HAND, 0.30); assert.equal(BLOCK.R_HAND_CHASE, 0.36); assert.equal(BLOCK.R_HAND_BIG, 0.34);
  assert.equal(SHAKE.CHAIN_KYRIE, 3); assert.equal(SHAKE.COMBO_WINDOW, 0.35);
  assert.equal(params('jordan.hawk').stealRange, 0.15);
  assert.equal(params('lebron.chaseDown').RUN_MUL, 1.08);
  assert.equal(params('giannis.helpBlock').helpRadius, 4.0);
  assert.equal(params('yao.anchor').AI_HAND_BALL, 0.40);
  assert.equal(params('lebron.chaseDown').AI_HAND_BALL, 0.50);
});

console.log(passed + ' checks passed');
