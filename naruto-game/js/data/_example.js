/* Reference example for data agents — NOT loaded by index.html (underscore prefix).
 * The real sasuke_ms lives in konoha_main.js. */
NG.defineChars('_example', [
  {
    id: 'sasuke_ms_example',
    name: '宇智波佐助', form: '须佐能乎', en: 'Uchiha Sasuke', title: '复仇者',
    faction: 'taka', rarity: 'SSR', role: 'atk', element: 'fire', tags: ['输出', '爆发'],
    stats: { hp: 0.95, atk: 1.15, def: 0.9, spd: 118 },
    bio: '宇智波一族的幸存者。击败大蛇丸后组建鹰小队，开启万花筒写轮眼，能操控天照黑炎与须佐能乎。',
    quote: '我的道路，由我自己来决定。',
    art: {
      type: 'human', skin: '#f3d9c4', hair: 'duck_long', hairColor: '#1b1f3a',
      eyes: 'ms_sasuke', outfit: 'robe', outfitColor: '#f2f2f2', accentColor: '#4b3a8c',
      headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'sword', aura: '#7c4dff'
    },
    skills: {
      passive: {
        name: '万花筒写轮眼', tags: ['增益'],
        desc: '洞悉一切动作：暴击率+15%，闪避率+10%；战斗开始时获得20点查克拉。',
        stats: { crit: 0.15, dodge: 0.10 },
        triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
      },
      s1: {
        name: '千鸟刃', tags: ['消耗', '护盾'], fx: 'chidori', target: 'single', cd: 0,
        desc: '将千鸟化为利刃刺穿敌人，造成110%攻击力伤害，并获得15%攻击力的护盾。',
        effects: [{ type: 'dmg', mult: 1.1 }, { type: 'shield', mult: 0.15, to: 'self' }]
      },
      s2: {
        name: '天照', tags: ['输出', '持续'], fx: 'amaterasu', target: 'single', cd: 3,
        desc: '以左眼燃起永不熄灭的黑炎，造成180%攻击力伤害，并使目标灼烧3回合（每回合40%攻击力）。',
        effects: [{ type: 'dmg', mult: 1.8 }, { type: 'status', status: 'burn', turns: 3, value: 0.4 }]
      },
      ult: {
        name: '须佐能乎', tags: ['群攻', '爆发', '斩杀'], fx: 'susanoo', target: 'all',
        desc: '召唤须佐能乎横扫战场，对全体敌人造成3段共210%攻击力伤害，生命低于30%的敌人额外受到120%攻击力斩杀伤害。',
        effects: [{ type: 'dmg', mult: 0.7, hits: 3 }, { type: 'execute', threshold: 0.3, mult: 1.2 }]
      },
      awaken: {
        name: '炎遁·加具土命', tags: ['增益', '持续'],
        desc: '攻击力+12%；释放必杀技后，以黑炎形态变化缠绕随机一名敌人，使其灼烧2回合（每回合50%攻击力）。',
        stats: { atk: 0.12 },
        triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'burn', turns: 2, value: 0.5, to: 'enemy_random' }] }]
      }
    }
  }
]);
