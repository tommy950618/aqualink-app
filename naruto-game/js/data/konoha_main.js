/* js/data/konoha_main.js — 木叶·第七班与木叶丸小队等
 * 第七班各时期形态（少年篇 / 仙人模式 / 九喇嘛模式 / 六道仙人模式 …）、
 * 卡卡西三形态、佐井、大和、伊鲁卡、木叶丸军团、惠比寿、水木、深作仙人。
 * 仅收录《火影忍者》与《火影忍者疾风传》时期的角色、形态与忍术。
 */
(function () {
  'use strict';
  NG.defineChars('konoha_main', [

    /* ============================ 漩涡鸣人 ============================ */
    {
      id: 'naruto', name: '漩涡鸣人', form: '少年篇', en: 'Uzumaki Naruto', title: '意外性第一',
      faction: 'konoha', rarity: 'SR', role: 'atk', element: 'wind', tags: ['输出', '召唤'],
      stats: { hp: 1.05, atk: 1.0, def: 0.95, spd: 112 },
      bio: '木叶村的吊车尾，体内封印着九尾妖狐，从小被村民疏远。他梦想成为火影、得到大家的认同，凭借永不放弃的根性和自来也传授的螺旋丸不断成长。',
      quote: '说到做到，这就是我的忍道！',
      art: {
        type: 'human', skin: '#f5cfa8', hair: 'spiky', hairColor: '#f7c600',
        eyes: 'normal', eyeColor: '#2f7fe0',
        outfit: 'jacket', outfitColor: '#ff7a1a', accentColor: '#1f3a7a',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['whiskers'], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff8c1a'
      },
      skills: {
        passive: {
          name: '九尾查克拉外泄', tags: ['治疗', '增益'],
          desc: '生命值+8%；生命首次低于30%时九尾的查克拉外泄，立即恢复25%最大生命值，并使攻击力提升30%，持续3回合。',
          stats: { hp: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.25 },
            { type: 'buff', stat: 'atk', value: 0.3, turns: 3 }
          ] }]
        },
        s1: {
          name: '多重影分身之术', tags: ['输出', '消耗'], fx: 'clone', target: 'single', cd: 0,
          desc: '召唤大量影分身一拥而上围殴敌人，造成4段共108%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.27, hits: 4 }]
        },
        s2: {
          name: '螺旋丸', tags: ['爆发', '控制'], fx: 'rasengan', target: 'single', cd: 3,
          desc: '由影分身辅助压缩查克拉，将螺旋丸砸向敌人，造成185%攻击力伤害，并有30%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.85 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        ult: {
          name: '通灵之术·蛤蟆文太', tags: ['召唤', '群攻', '控制'], fx: 'summon', target: 'all',
          desc: '召唤蛤蟆老大文太从天而降，对全体敌人造成160%攻击力伤害，并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.6 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '九尾化·一尾', tags: ['增益', '治疗'],
          desc: '攻击力+12%；九尾的查克拉化为外衣包裹全身，每回合开始时恢复5%最大生命值。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.05 }] }]
        }
      }
    },

    {
      id: 'naruto_sage', name: '漩涡鸣人', form: '仙人模式', en: 'Uzumaki Naruto', title: '木叶的英雄',
      faction: 'konoha', rarity: 'SSR', role: 'atk', element: 'wind', tags: ['输出', '群攻'],
      stats: { hp: 1.0, atk: 1.12, def: 0.92, spd: 112 },
      bio: '在妙木山随深作仙人修行，掌握了吸收自然能量的仙人模式，并完成了可以投掷的螺旋手里剑。佩恩袭击木叶时他挺身而出击败六道佩恩，被全村视为英雄。',
      quote: '我来斩断这仇恨的连锁！',
      art: {
        type: 'human', skin: '#f5cfa8', hair: 'spiky', hairColor: '#f7c600',
        eyes: 'sage', eyeColor: '#f2b100',
        outfit: 'haori_flame', outfitColor: '#c8102e', accentColor: '#141414',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['whiskers', 'sage_marks'], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff9800'
      },
      skills: {
        passive: {
          name: '仙术查克拉', tags: ['增益', '回能'],
          desc: '吸收自然能量强化肉体：攻击力+10%，防御力+10%；每回合开始时获得10点查克拉。',
          stats: { atk: 0.1, def: 0.1 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'chakra', value: 10 }] }]
        },
        s1: {
          name: '蛙组手', tags: ['输出', '穿透'], fx: 'fist', target: 'single', cd: 0,
          desc: '以仙术查克拉延伸攻击范围的妙木山体术，造成115%攻击力伤害，无视目标20%防御。',
          effects: [{ type: 'dmg', mult: 1.15, pierce: 0.2 }]
        },
        s2: {
          name: '仙法·大玉螺旋丸', tags: ['爆发', '控制'], fx: 'rasengan', target: 'single', cd: 3,
          desc: '以仙术查克拉凝聚出巨大的螺旋丸，造成210%攻击力伤害，并有40%概率使目标眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 2.1 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '仙法·风遁·螺旋手里剑', tags: ['群攻', '爆发', '减益'], fx: 'wind', target: 'all',
          desc: '投出不会消散的风遁·螺旋手里剑，无数风刃切碎全体敌人的经络，造成200%攻击力伤害，并使其防御力降低25%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 2.0 },
            { type: 'debuff', stat: 'def', value: 0.25, turns: 2 }
          ]
        },
        awaken: {
          name: '仙法·超大玉螺旋丸', tags: ['增益', '爆发'],
          desc: '攻击力+12%；释放必杀技后，由影分身追加一记仙法·超大玉螺旋丸，对随机一名敌人造成120%攻击力伤害。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'dmg', mult: 1.2, to: 'enemy_random' }] }]
        }
      }
    },

    {
      id: 'naruto_kurama', name: '漩涡鸣人', form: '九喇嘛模式', en: 'Uzumaki Naruto', title: '九喇嘛的搭档',
      faction: 'konoha', rarity: 'SSR', role: 'atk', element: 'yang', tags: ['输出', '群攻', '护盾'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 132 },
      bio: '在第四次忍界大战的战场上与九喇嘛敞开心扉、结为搭档，进入九喇嘛模式后速度足以媲美四代目火影。他把九喇嘛的查克拉分给忍者联军，守护了无数同伴。',
      quote: '九喇嘛，我们上吧！',
      art: {
        type: 'human', skin: '#f5cfa8', hair: 'spiky', hairColor: '#ffcf1a',
        eyes: 'kurama', eyeColor: '#ff8a00',
        outfit: 'cloak', outfitColor: '#ffb300', accentColor: '#1b1b1b',
        headband: 'allied', headbandSlash: false, headbandPos: 'forehead',
        marks: ['kurama_marks'], mask: 'none', hat: 'none', accessory: 'none', aura: '#ffcc00'
      },
      skills: {
        passive: {
          name: '九喇嘛查克拉外衣', tags: ['护盾', '增益'],
          desc: '速度+10%；战斗开始时把九喇嘛的查克拉分给全体友方，使其获得相当于鸣人攻击力60%的护盾，持续2回合。',
          stats: { spd: 0.1 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', mult: 0.6, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '惑星螺旋丸', tags: ['输出', '消耗'], fx: 'rasengan', target: 'single', cd: 0,
          desc: '以查克拉之手凝聚环绕旋转的多颗螺旋丸撞向敌人，造成3段共117%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.39, hits: 3 }]
        },
        s2: {
          name: '尾兽玉', tags: ['群攻', '爆发'], fx: 'bijuu', target: 'all', cd: 3,
          desc: '将尾兽查克拉压缩成尾兽玉轰向敌阵，对全体敌人造成100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.0 }]
        },
        ult: {
          name: '尾兽化·九喇嘛', tags: ['群攻', '增益', '爆发'], fx: 'summon', target: 'all',
          desc: '化身巨大的九喇嘛横扫战场，对全体敌人造成190%攻击力伤害，并使全体友方攻击力提升20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '尾兽螺旋手里剑', tags: ['增益', '群攻'],
          desc: '攻击力+12%；释放必杀技后，九喇嘛追加一记尾兽螺旋手里剑，对全体敌人造成50%攻击力伤害。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'dmg', mult: 0.5, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'naruto_sixpaths', name: '漩涡鸣人', form: '六道仙人模式', en: 'Uzumaki Naruto', title: '阿修罗转世',
      faction: 'konoha', rarity: 'UR', role: 'atk', element: 'yang', tags: ['输出', '群攻', '复活'],
      stats: { hp: 1.0, atk: 1.12, def: 0.95, spd: 128 },
      bio: '濒死之际在精神世界见到六道仙人，获赐阳之力，开启六道仙人模式，背后浮现出求道玉。他与佐助联手封印了大筒木辉夜，终结了第四次忍界大战。',
      quote: '我不会再让任何同伴死去！',
      art: {
        type: 'human', skin: '#f5cfa8', hair: 'spiky', hairColor: '#ffd21f',
        eyes: 'six_paths', eyeColor: '#ffb000',
        outfit: 'six_paths', outfitColor: '#f5d76e', accentColor: '#1a1a1a',
        headband: 'allied', headbandSlash: false, headbandPos: 'forehead',
        marks: ['kurama_marks'], mask: 'none', hat: 'none', accessory: 'truth_orbs', aura: '#ffe066'
      },
      skills: {
        passive: {
          name: '六道仙术', tags: ['增益', '反击'],
          desc: '攻击力+10%，伤害减免+10%；战斗开始时免疫控制2回合；受到攻击时有25%概率以求道玉反击，对攻击者造成50%攻击力伤害。',
          stats: { atk: 0.1, dr: 0.1 },
          triggers: [
            { on: 'battle_start', effects: [{ type: 'immune', turns: 2 }] },
            { on: 'on_hit', chance: 0.25, effects: [{ type: 'dmg', mult: 0.5 }] }
          ]
        },
        s1: {
          name: '求道玉', tags: ['输出', '穿透'], fx: 'truth', target: 'single', cd: 0,
          desc: '射出能够消除忍术的求道玉，造成125%攻击力伤害，无视目标30%防御。',
          effects: [{ type: 'dmg', mult: 1.25, pierce: 0.3 }]
        },
        s2: {
          name: '仙法·熔遁螺旋手里剑', tags: ['群攻', '持续'], fx: 'lava', target: 'all', cd: 3,
          desc: '借孙悟空的熔遁查克拉投出熔遁螺旋手里剑，对全体敌人造成110%攻击力伤害，并使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'burn', turns: 2, value: 0.3 }
          ]
        },
        ult: {
          name: '六道·超大玉螺旋多连手里剑', tags: ['群攻', '爆发'], fx: 'rasengan', target: 'all',
          desc: '以六道之力同时凝聚多颗超大玉螺旋手里剑轰击敌阵：先驱散全体敌人的所有增益与护盾，再造成4段共224%攻击力伤害。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 0.56, hits: 4 }
          ]
        },
        awaken: {
          name: '阳之力', tags: ['复活', '治疗'],
          desc: '攻击力+12%；有友方阵亡时，以阳之力重塑其肉体，使其以40%生命值复活（每场战斗限1次）；每回合开始时为生命最低的友方恢复相当于鸣人攻击力30%的生命。',
          stats: { atk: 0.12 },
          triggers: [
            { on: 'on_ally_death', effects: [{ type: 'revive', pct: 0.4 }] },
            { on: 'turn_start', effects: [{ type: 'heal', mult: 0.3, to: 'ally_lowest' }] }
          ]
        }
      }
    },

    /* ============================ 宇智波佐助 ============================ */
    {
      id: 'sasuke', name: '宇智波佐助', form: '少年篇', en: 'Uchiha Sasuke', title: '宇智波的遗孤',
      faction: 'konoha', rarity: 'SR', role: 'atk', element: 'lightning', tags: ['输出', '爆发'],
      stats: { hp: 0.92, atk: 1.15, def: 0.9, spd: 122 },
      bio: '宇智波一族灭族之夜唯一的幸存者，立志向哥哥宇智波鼬复仇。作为第七班的一员开启了写轮眼，并跟随卡卡西学会了千鸟。',
      quote: '我要复兴一族，并杀掉某个男人。',
      art: {
        type: 'human', skin: '#f3d9c4', hair: 'duck', hairColor: '#1d2340',
        eyes: 'sharingan', eyeColor: '#c62828',
        outfit: 'highcollar', outfitColor: '#1f3b73', accentColor: '#e8e8e8',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#4fa3ff'
      },
      skills: {
        passive: {
          name: '写轮眼', tags: ['增益', '闪避'],
          desc: '三勾玉写轮眼看穿对手的动作：暴击率+10%，闪避率+8%。',
          stats: { crit: 0.1, dodge: 0.08 }
        },
        s1: {
          name: '火遁·豪火球之术', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 0,
          desc: '喷出巨大的火球，造成105%攻击力伤害，并有30%概率使目标灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '狮子连弹', tags: ['输出', '控制'], fx: 'fist', target: 'single', cd: 3,
          desc: '以影舞叶贴近敌人，将其踢上半空后连续重击，造成4段共180%攻击力伤害，并有25%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.45, hits: 4 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.25 }
          ]
        },
        ult: {
          name: '千鸟', tags: ['爆发', '穿透', '控制'], fx: 'chidori', target: 'single',
          desc: '将雷遁查克拉集中于掌心高速突刺，造成300%攻击力伤害，无视目标30%防御，并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 3.0, pierce: 0.3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '天之咒印', tags: ['增益', '爆发'],
          desc: '攻击力+12%；生命首次低于30%时咒印扩散至状态二，攻击力提升35%、暴击率提升15%，持续3回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'buff', stat: 'atk', value: 0.35, turns: 3 },
            { type: 'buff', stat: 'crit', value: 0.15, turns: 3 }
          ] }]
        }
      }
    },

    {
      id: 'sasuke_ms', name: '宇智波佐助', form: '须佐能乎', en: 'Uchiha Sasuke', title: '复仇者',
      faction: 'taka', rarity: 'SSR', role: 'atk', element: 'fire', tags: ['输出', '爆发'],
      stats: { hp: 0.95, atk: 1.15, def: 0.9, spd: 118 },
      bio: '击败大蛇丸后组建小队追寻鼬，得知灭族真相后开启万花筒写轮眼，并将小队改名为“鹰”。他能操控天照的黑炎与须佐能乎。',
      quote: '我的道路，由我自己来决定。',
      art: {
        type: 'human', skin: '#f3d9c4', hair: 'duck_long', hairColor: '#1b1f3a',
        eyes: 'ms_sasuke', eyeColor: '#c62828',
        outfit: 'robe', outfitColor: '#f2f2f2', accentColor: '#4b3a8c',
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
          desc: '将千鸟化为利刃刺穿敌人，造成110%攻击力伤害，并获得相当于自身攻击力15%的护盾，持续2回合。',
          effects: [{ type: 'dmg', mult: 1.1 }, { type: 'shield', mult: 0.15, turns: 2, to: 'self' }]
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
    },

    {
      id: 'sasuke_rinnegan', name: '宇智波佐助', form: '轮回眼', en: 'Uchiha Sasuke', title: '因陀罗转世',
      faction: 'konoha', rarity: 'UR', role: 'atk', element: 'yin', tags: ['输出', '爆发', '斩杀'],
      stats: { hp: 0.95, atk: 1.18, def: 0.9, spd: 126 },
      bio: '获得六道仙人赐予的阴之力，左眼开启轮回眼，能以天手力瞬间交换物体的位置。大战后他在终结之谷与鸣人决战，失去左臂后终于放下仇恨，踏上赎罪之旅。',
      quote: '鸣人……你是我唯一的朋友。',
      art: {
        type: 'human', skin: '#f3d9c4', hair: 'duck_long', hairColor: '#1b1f3a',
        eyes: 'ms_eternal', eyeColor: '#c62828', eyeL: 'tomoe_rinnegan', eyeR: 'ms_eternal',
        outfit: 'highcollar', outfitColor: '#3a3f55', accentColor: '#6c4bb5',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'sword', aura: '#6a3fd1'
      },
      skills: {
        passive: {
          name: '轮回眼·天手力', tags: ['闪避', '反击'],
          desc: '暴击率+12%，闪避率+12%；受到攻击时有25%概率发动天手力与攻击者瞬间换位并反击，造成80%攻击力伤害。',
          stats: { crit: 0.12, dodge: 0.12 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'dmg', mult: 0.8 }] }]
        },
        s1: {
          name: '千鸟锐枪', tags: ['输出', '穿透'], fx: 'chidori', target: 'single', cd: 0,
          desc: '将千鸟形态变化为长枪远距离贯穿敌人，造成125%攻击力伤害，无视目标25%防御。',
          effects: [{ type: 'dmg', mult: 1.25, pierce: 0.25 }]
        },
        s2: {
          name: '完成体须佐能乎', tags: ['群攻', '护盾'], fx: 'susanoo', target: 'all', cd: 3,
          desc: '召唤完成体须佐能乎挥刀斩向敌阵，对全体敌人造成110%攻击力伤害，并获得相当于自身攻击力80%的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'shield', mult: 0.8, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '因陀罗之矢', tags: ['爆发', '斩杀', '穿透'], fx: 'lightning', target: 'single',
          desc: '汇聚九只尾兽的查克拉，以须佐能乎之弓射出因陀罗之矢，造成380%攻击力伤害并无视目标30%防御；生命低于35%的目标额外受到120%攻击力斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 3.8, pierce: 0.3 },
            { type: 'execute', threshold: 0.35, mult: 1.2 }
          ]
        },
        awaken: {
          name: '阴之力', tags: ['增益', '控制'],
          desc: '攻击力+13%；释放必杀技后，以轮回眼的幻术压制随机一名敌人，使其眩晕1回合。',
          stats: { atk: 0.13 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'stun', turns: 1, to: 'enemy_random' }] }]
        }
      }
    },

    /* ============================ 春野樱 ============================ */
    {
      id: 'sakura', name: '春野樱', form: '少年篇', en: 'Haruno Sakura', title: '第七班之花',
      faction: 'konoha', rarity: 'R', role: 'sup', element: 'yin', tags: ['净化', '护盾'],
      stats: { hp: 1.0, atk: 0.92, def: 1.0, spd: 102 },
      bio: '第七班的成员，忍校理论成绩优秀，擅长精密的查克拉控制，一心喜欢着佐助。中忍考试的死亡森林里，她剪断长发独自守护昏迷的同伴，第一部结尾拜纲手为师。',
      quote: '这次换我来保护你们！',
      art: {
        type: 'human', skin: '#f8dcc4', hair: 'long_straight', hairColor: '#f7a8c8',
        eyes: 'normal', eyeColor: '#5fbf6a',
        outfit: 'qipao', outfitColor: '#d9334a', accentColor: '#f5e6d3',
        headband: 'konoha', headbandSlash: false, headbandPos: 'hair',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff8fb8'
      },
      skills: {
        passive: {
          name: '内在樱', tags: ['增益'],
          desc: '防御力+8%；内心的另一个自己守护心神：战斗开始时免疫控制1回合；生命首次低于30%时怒吼“可恶！”，攻击力提升30%，持续2回合。',
          stats: { def: 0.08 },
          triggers: [
            { on: 'battle_start', effects: [{ type: 'immune', turns: 1 }] },
            { on: 'low_hp', effects: [{ type: 'buff', stat: 'atk', value: 0.3, turns: 2 }] }
          ]
        },
        s1: {
          name: '手里剑之术', tags: ['消耗'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投掷手里剑攻击敌人，造成95%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.95 }]
        },
        s2: {
          name: '幻术·解', tags: ['净化', '护盾'], fx: 'genjutsu', target: 'ally_all', cd: 3,
          desc: '看穿并解除幻术：净化全体友方的减益与异常状态，并为其提供相当于春野樱攻击力50%的护盾，持续2回合。',
          effects: [
            { type: 'cleanse', to: 'ally_all' },
            { type: 'shield', mult: 0.5, turns: 2 }
          ]
        },
        ult: {
          name: '替身术', tags: ['爆发', '闪避'], fx: 'blade', target: 'single',
          desc: '以替身术躲开攻击后绕到敌人身后用苦无突刺，造成260%攻击力伤害，并使自身闪避率提升25%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 2.6 },
            { type: 'buff', stat: 'dodge', value: 0.25, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '医疗忍术', tags: ['治疗'],
          desc: '生命值+10%；拜纲手为师学习医疗忍术：每回合开始时为生命最低的友方恢复相当于春野樱攻击力35%的生命。',
          stats: { hp: 0.1 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', mult: 0.35, to: 'ally_lowest' }] }]
        }
      }
    },

    {
      id: 'sakura_byakugou', name: '春野樱', form: '百豪之术', en: 'Haruno Sakura', title: '纲手的弟子',
      faction: 'konoha', rarity: 'SSR', role: 'heal', element: 'earth', tags: ['治疗', '复活'],
      stats: { hp: 1.08, atk: 1.05, def: 0.95, spd: 108 },
      bio: '师从五代目火影纲手，成为顶尖的医疗忍者，拥有一拳碎地的怪力。第四次忍界大战中她解放了额头积蓄三年查克拉的百豪之印，在战场上救治同伴，并与鸣人、佐助并肩作战。',
      quote: '我不会再被你们甩在身后了！',
      art: {
        type: 'human', skin: '#f8dcc4', hair: 'bob', hairColor: '#f49ac1',
        eyes: 'normal', eyeColor: '#4fb36a',
        outfit: 'sleeveless', outfitColor: '#c8233c', accentColor: '#f3d3e0',
        headband: 'allied', headbandSlash: false, headbandPos: 'hair',
        marks: ['diamond'], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff6fae'
      },
      skills: {
        passive: {
          name: '怪力', tags: ['增益', '减益'],
          desc: '攻击力+10%；攻击命中后有20%概率震碎目标的防御，使其防御力降低15%，持续2回合。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'debuff', stat: 'def', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '樱花冲', tags: ['输出', '控制'], fx: 'fist', target: 'single', cd: 0,
          desc: '将查克拉集中于拳头并在命中瞬间爆发，造成115%攻击力伤害，并有25%概率使目标眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.15 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.25 }
          ]
        },
        s2: {
          name: '掌仙术', tags: ['治疗', '净化'], fx: 'heal', target: 'ally_lowest', cd: 2,
          desc: '以医疗忍术治疗生命最低的友方，恢复相当于春野樱攻击力180%的生命，并净化其减益与异常状态。',
          effects: [
            { type: 'heal', mult: 1.8 },
            { type: 'cleanse', to: 'target' }
          ]
        },
        ult: {
          name: '通灵之术·蛞蝓', tags: ['治疗', '复活', '召唤'], fx: 'summon', target: 'ally_all',
          desc: '通灵出蛞蝓并分裂附着于全体友方，恢复相当于春野樱攻击力150%的生命，并使一名阵亡友方以30%生命值复活（每场战斗限1次）。',
          effects: [
            { type: 'heal', mult: 1.5 },
            { type: 'revive', pct: 0.3 }
          ]
        },
        awaken: {
          name: '百豪之术·创造再生', tags: ['治疗', '增益'],
          desc: '攻击力+12%，生命值+8%；生命首次低于30%时解放百豪之印，立即恢复40%最大生命值，并免疫控制2回合。',
          stats: { atk: 0.12, hp: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.4 },
            { type: 'immune', turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 旗木卡卡西 ============================ */
    {
      id: 'kakashi', name: '旗木卡卡西', form: '写轮眼', en: 'Hatake Kakashi', title: '拷贝忍者',
      faction: 'konoha', rarity: 'SR', role: 'atk', element: 'lightning', tags: ['输出', '斩杀'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 120 },
      bio: '第七班的带队上忍，左眼移植了挚友宇智波带土的写轮眼，复制过一千种以上的忍术，人称“拷贝忍者卡卡西”。他自创的千鸟因曾劈开雷电而被称为雷切。',
      quote: '不珍惜同伴的人，连废物都不如。',
      art: {
        type: 'human', skin: '#f1d3b8', hair: 'spiky_up', hairColor: '#d8dde3',
        eyes: 'normal', eyeColor: '#2b2b2b', eyeL: 'sharingan',
        outfit: 'flak', outfitColor: '#6b8e3d', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['eye_scar'], mask: 'lower', hat: 'none', accessory: 'none', aura: '#7fc4ff'
      },
      skills: {
        passive: {
          name: '写轮眼', tags: ['反击', '闪避'],
          desc: '暴击率+8%，闪避率+10%；受到攻击时有20%概率复制对手的招式反击，对攻击者造成70%攻击力伤害。',
          stats: { crit: 0.08, dodge: 0.1 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'dmg', mult: 0.7 }] }]
        },
        s1: {
          name: '水遁·水龙弹之术', tags: ['输出', '减益'], fx: 'water', target: 'single', cd: 0,
          desc: '以写轮眼复制来的水遁冲击敌人，造成105%攻击力伤害，并使其速度降低10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'debuff', stat: 'spd', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '通灵·土遁·追牙之术', tags: ['召唤', '控制'], fx: 'beast', target: 'single', cd: 3,
          desc: '通灵出忍犬从地底追踪并咬住敌人，造成120%攻击力伤害，并使目标束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'bind', turns: 1 }
          ]
        },
        ult: {
          name: '雷切', tags: ['爆发', '斩杀'], fx: 'chidori', target: 'single',
          desc: '将雷遁查克拉凝聚于掌心，以足以劈开雷电的速度贯穿敌人，造成300%攻击力伤害；生命低于30%的目标额外受到100%攻击力斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 3.0 },
            { type: 'execute', threshold: 0.3, mult: 1.0 }
          ]
        },
        awaken: {
          name: '雷遁·影分身之术', tags: ['控制', '增益'],
          desc: '攻击力+12%；受到攻击时有20%概率由雷遁影分身代为承受并放电，使攻击者眩晕1回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'status', status: 'stun', turns: 1 }] }]
        }
      }
    },

    {
      id: 'kakashi_ms', name: '旗木卡卡西', form: '万花筒·神威', en: 'Hatake Kakashi', title: '写轮眼卡卡西',
      faction: 'konoha', rarity: 'SSR', role: 'atk', element: 'lightning', tags: ['输出', '穿透', '爆发'],
      stats: { hp: 0.92, atk: 1.15, def: 0.92, spd: 120 },
      bio: '追击迪达拉时首次展露万花筒写轮眼，能以瞳术“神威”扭曲空间，将目标吸入异空间。第四次忍界大战中他担任第三部队队长，与昔日挚友带土展开宿命之战。',
      quote: '这一次，我一定会守护到底。',
      art: {
        type: 'human', skin: '#f1d3b8', hair: 'spiky_up', hairColor: '#d8dde3',
        eyes: 'normal', eyeColor: '#2b2b2b', eyeL: 'ms_obito',
        outfit: 'flak', outfitColor: '#6b8e3d', accentColor: '#2a3550',
        headband: 'allied', headbandSlash: false, headbandPos: 'forehead',
        marks: ['eye_scar'], mask: 'lower', hat: 'none', accessory: 'none', aura: '#6a4ab5'
      },
      skills: {
        passive: {
          name: '拷贝忍者', tags: ['增益', '回能'],
          desc: '掌握一千种以上的忍术：暴击率+10%，攻击力+8%；攻击命中后有20%概率回复10点查克拉。',
          stats: { crit: 0.1, atk: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'chakra', value: 10 }] }]
        },
        s1: {
          name: '雷切', tags: ['输出', '穿透'], fx: 'chidori', target: 'single', cd: 0,
          desc: '以雷切贯穿敌人，造成120%攻击力伤害，无视目标20%防御。',
          effects: [{ type: 'dmg', mult: 1.2, pierce: 0.2 }]
        },
        s2: {
          name: '雷兽追牙', tags: ['输出', '控制'], fx: 'lightning', target: 'back', cd: 3,
          desc: '将雷切形态变化为雷电猎犬，追袭最后排的敌人，造成190%攻击力伤害，并有30%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        ult: {
          name: '神威', tags: ['爆发', '穿透'], fx: 'kamui', target: 'single',
          desc: '以万花筒写轮眼扭曲目标周围的空间：先驱散其所有增益与护盾，再造成280%攻击力伤害（无视50%防御），并额外造成目标最大生命值12%的真实伤害。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 2.8, pierce: 0.5 },
            { type: 'true_dmg', pct: 0.12 }
          ]
        },
        awaken: {
          name: '万花筒写轮眼', tags: ['增益', '穿透'],
          desc: '攻击力+12%；攻击命中后有15%概率以神威扭曲目标所在的空间，额外造成其最大生命值6%的真实伤害。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_attack', chance: 0.15, effects: [{ type: 'true_dmg', pct: 0.06 }] }]
        }
      }
    },

    {
      id: 'kakashi_susanoo', name: '旗木卡卡西', form: '完成体须佐能乎', en: 'Hatake Kakashi', title: '六代目火影',
      faction: 'konoha', rarity: 'UR', role: 'atk', element: 'lightning', tags: ['输出', '群攻', '护盾'],
      stats: { hp: 1.0, atk: 1.12, def: 0.95, spd: 128 },
      bio: '与大筒木辉夜决战时，已逝的带土以灵魂之姿将双眼万花筒写轮眼的瞳力借给卡卡西。短暂拥有双万花筒的卡卡西开启了完成体须佐能乎，以神威手里剑守护第七班。',
      quote: '带土，借你的力量一用！',
      art: {
        type: 'human', skin: '#f1d3b8', hair: 'spiky_up', hairColor: '#d8dde3',
        eyes: 'ms_obito', eyeColor: '#c62828',
        outfit: 'flak', outfitColor: '#6b8e3d', accentColor: '#2a3550',
        headband: 'allied', headbandSlash: false, headbandPos: 'forehead',
        marks: ['eye_scar'], mask: 'lower', hat: 'none', accessory: 'none', aura: '#3fb6ff'
      },
      skills: {
        passive: {
          name: '带土的瞳力', tags: ['闪避', '回能'],
          desc: '带土的灵魂借出双眼瞳力：闪避率+12%，暴击率+12%；战斗开始时获得30点查克拉。',
          stats: { dodge: 0.12, crit: 0.12 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 30 }] }]
        },
        s1: {
          name: '神威雷切', tags: ['输出', '穿透'], fx: 'chidori', target: 'single', cd: 0,
          desc: '结合神威的雷切，从异空间瞬间刺出，造成125%攻击力伤害，无视目标30%防御。',
          effects: [{ type: 'dmg', mult: 1.25, pierce: 0.3 }]
        },
        s2: {
          name: '神威手里剑', tags: ['群攻', '穿透'], fx: 'kamui', target: 'random', count: 3, cd: 3,
          desc: '须佐能乎掷出附带神威之力的手里剑，随机攻击3名敌人，各造成85%攻击力伤害并无视其40%防御。',
          effects: [{ type: 'dmg', mult: 0.85, pierce: 0.4 }]
        },
        ult: {
          name: '完成体须佐能乎', tags: ['群攻', '护盾', '爆发'], fx: 'susanoo', target: 'all',
          desc: '以双万花筒写轮眼开启完成体须佐能乎，挥刃斩向全体敌人，造成3段共225%攻击力伤害，并使全体友方受到的伤害降低20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.75, hits: 3 },
            { type: 'buff', stat: 'dr', value: 0.2, turns: 2, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '双·神威', tags: ['增益', '闪避'],
          desc: '攻击力+13%；生命首次低于30%时以带土右眼的神威虚化身体，闪避率提升50%并免疫控制，持续2回合。',
          stats: { atk: 0.13 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'buff', stat: 'dodge', value: 0.5, turns: 2 },
            { type: 'immune', turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 佐井 / 大和 ============================ */
    {
      id: 'sai', name: '佐井', form: '', en: 'Sai', title: '根部忍者',
      faction: 'konoha', rarity: 'SR', role: 'ctrl', element: 'yin', tags: ['控制', '封印'],
      stats: { hp: 0.95, atk: 1.05, def: 0.95, spd: 124 },
      bio: '团藏麾下“根”部出身的忍者，被派入第七班顶替佐助的位置。他用墨水作画并赋予其生命，原本被训练得毫无情感，在与鸣人等人相处中逐渐理解了羁绊。',
      quote: '我想弄明白，羁绊究竟是什么。',
      art: {
        type: 'human', skin: '#f7ede6', hair: 'short', hairColor: '#141414',
        eyes: 'dark', eyeColor: '#111111',
        outfit: 'shirt', outfitColor: '#1d1d1d', accentColor: '#b31b1b',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'paintbrush', aura: '#4a4a4a'
      },
      skills: {
        passive: {
          name: '墨之鸟', tags: ['增益', '闪避'],
          desc: '闪避率+6%；战斗开始时放出墨鸟侦察敌情，使全体友方速度提升12%，持续2回合。',
          stats: { dodge: 0.06 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'spd', value: 0.12, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '忍法·超兽伪画', tags: ['输出', '消耗'], fx: 'ink', target: 'single', cd: 0,
          desc: '在卷轴上画出墨狮扑向敌人，造成2段共106%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.53, hits: 2 }]
        },
        s2: {
          name: '超兽伪画·墨蛇', tags: ['控制', '输出'], fx: 'ink', target: 'single', cd: 3,
          desc: '画出的墨蛇缠绕敌人，造成110%攻击力伤害，并使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'bind', turns: 1 }
          ]
        },
        ult: {
          name: '封印术·虎视眈眈', tags: ['封印', '控制', '减益'], fx: 'seal', target: 'highest_atk',
          desc: '展开绘有封印术式的卷轴，以墨迹缠住攻击力最高的敌人，造成240%攻击力伤害，使其陷入封印状态2回合（只能使用技能1），并削减其40点查克拉。',
          effects: [
            { type: 'dmg', mult: 2.4 },
            { type: 'status', status: 'silence', turns: 2 },
            { type: 'drain', value: 40 }
          ]
        },
        awaken: {
          name: '舌祸根绝之印·解', tags: ['增益', '爆发'],
          desc: '攻击力+12%；团藏死后封印解除，开始懂得为同伴而战：有友方阵亡时，自身攻击力提升30%，持续3回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ally_death', effects: [{ type: 'buff', stat: 'atk', value: 0.3, turns: 3 }] }]
        }
      }
    },

    {
      id: 'yamato', name: '大和', form: '', en: 'Yamato', title: '暗部·天藏',
      faction: 'konoha', rarity: 'SR', role: 'tank', element: 'earth', tags: ['护盾', '嘲讽', '控制'],
      stats: { hp: 1.1, atk: 0.92, def: 1.05, spd: 98 },
      bio: '原暗部忍者，代号“天藏”，幼年被大蛇丸植入初代火影的细胞，成为唯一存活并能使用木遁的实验体。卡卡西负伤期间他代理第七班队长，负责压制鸣人体内的九尾之力。',
      quote: '可别逼我用恐怖统治哦。',
      art: {
        type: 'human', skin: '#f1d3b8', hair: 'helmet', hairColor: '#5a3d2a',
        eyes: 'normal', eyeColor: '#2a1a10',
        outfit: 'flak', outfitColor: '#6b8e3d', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#5cae4f'
      },
      skills: {
        passive: {
          name: '柱间细胞', tags: ['治疗', '增益'],
          desc: '生命值+10%，防御力+10%；初代火影细胞带来的生命力使其每回合开始时恢复3%最大生命值。',
          stats: { hp: 0.1, def: 0.1 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.03 }] }]
        },
        s1: {
          name: '木遁·插木之术', tags: ['消耗', '减益'], fx: 'wood', target: 'single', cd: 0,
          desc: '从手臂伸出木桩刺向敌人，造成100%攻击力伤害，并压制其查克拉，削减10点查克拉。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'drain', value: 10 }
          ]
        },
        s2: {
          name: '木遁·木锭壁', tags: ['护盾', '嘲讽'], fx: 'wood', target: 'ally_all', cd: 3,
          desc: '筑起半球形木壁护住全体友方，提供相当于大和攻击力80%的护盾，持续2回合，并嘲讽敌人2回合。',
          effects: [
            { type: 'shield', mult: 0.8, turns: 2 },
            { type: 'taunt', turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '木遁·四柱牢之术', tags: ['控制', '单体', '减益'], fx: 'wood', target: 'highest_atk',
          desc: '以四根木柱围成牢笼困住攻击力最高的敌人，造成260%攻击力伤害，使其束缚1回合，并削减其50点查克拉。',
          effects: [
            { type: 'dmg', mult: 2.6 },
            { type: 'status', status: 'bind', turns: 1 },
            { type: 'drain', value: 50 }
          ]
        },
        awaken: {
          name: '木遁·四柱家之术', tags: ['治疗', '增益'],
          desc: '防御力+12%；生命首次低于30%时以四柱家之术建起房屋让同伴休整，为全体友方恢复相当于大和攻击力60%的生命。',
          stats: { def: 0.12 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'heal', mult: 0.6, to: 'ally_all' }] }]
        }
      }
    },

    /* ============================ 伊鲁卡 / 木叶丸军团 / 惠比寿 / 水木 ============================ */
    {
      id: 'iruka', name: '海野伊鲁卡', form: '', en: 'Umino Iruka', title: '忍校老师',
      faction: 'konoha', rarity: 'R', role: 'sup', element: 'none', tags: ['护盾', '嘲讽', '治疗'],
      stats: { hp: 1.05, atk: 0.9, def: 1.05, spd: 100 },
      bio: '木叶忍者学校的老师，鼻梁上有一道横向的伤疤。他是第一个认同鸣人的人，曾为保护鸣人用后背挡下水木的风魔手里剑。',
      quote: '鸣人是我最骄傲的学生！',
      art: {
        type: 'human', skin: '#d9a87e', hair: 'high_ponytail', hairColor: '#3a2618',
        eyes: 'normal', eyeColor: '#2a1a10',
        outfit: 'flak', outfitColor: '#6b8e3d', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['nose_scar'], mask: 'none', hat: 'none', accessory: 'none', aura: '#9fd3ff'
      },
      skills: {
        passive: {
          name: '老师的鼓励', tags: ['增益'],
          desc: '防御力+8%，生命值+5%；战斗开始时鼓励全体友方，使其防御力提升10%，持续2回合。',
          stats: { def: 0.08, hp: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'def', value: 0.1, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '手里剑之术', tags: ['消耗', '护盾'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投出标准的手里剑，造成92%攻击力伤害，并为生命最低的友方提供相当于自身攻击力15%的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.92 },
            { type: 'shield', mult: 0.15, turns: 2, to: 'ally_lowest' }
          ]
        },
        s2: {
          name: '舍身守护', tags: ['嘲讽', '护盾'], fx: 'shield', target: 'self', cd: 3,
          desc: '挺身挡在学生身前：嘲讽敌人2回合，并获得相当于自身攻击力80%的护盾，持续2回合。',
          effects: [
            { type: 'taunt', turns: 2 },
            { type: 'shield', mult: 0.8, turns: 2 }
          ]
        },
        ult: {
          name: '一乐拉面', tags: ['治疗', '增益'], fx: 'heal', target: 'ally_all',
          desc: '请大家去一乐吃拉面！为全体友方恢复相当于伊鲁卡攻击力130%的生命，并使其攻击力提升15%，持续2回合。',
          effects: [
            { type: 'heal', mult: 1.3 },
            { type: 'buff', stat: 'atk', value: 0.15, turns: 2 }
          ]
        },
        awaken: {
          name: '火之意志', tags: ['护盾', '增益'],
          desc: '攻击力+10%，防御力+5%；每回合开始时为生命最低的友方提供相当于伊鲁卡攻击力30%的护盾，持续1回合。',
          stats: { atk: 0.1, def: 0.05 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'shield', mult: 0.3, turns: 1, to: 'ally_lowest' }] }]
        }
      }
    },

    {
      id: 'konohamaru', name: '猿飞木叶丸', form: '', en: 'Sarutobi Konohamaru', title: '三代目之孙',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'fire', tags: ['输出', '控制'],
      stats: { hp: 0.95, atk: 1.05, def: 0.95, spd: 116 },
      bio: '三代目火影猿飞日斩的孙子，崇拜鸣人并称他为“老大”。佩恩袭击木叶时，他用鸣人传授的螺旋丸击败了佩恩的地狱道。',
      quote: '总有一天，我要成为火影！',
      art: {
        type: 'human', skin: '#f5cfa8', hair: 'spiky', hairColor: '#4a3020',
        eyes: 'normal', eyeColor: '#3a2a1a',
        outfit: 'shirt', outfitColor: '#e3c34d', accentColor: '#2f5fb3',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff9a3c'
      },
      skills: {
        passive: {
          name: '木叶丸军团', tags: ['增益', '回能'],
          desc: '攻击力+5%，闪避率+5%；战斗开始时获得20点查克拉。',
          stats: { atk: 0.05, dodge: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '影分身之术', tags: ['输出'], fx: 'clone', target: 'single', cd: 0,
          desc: '和影分身一起扑向敌人，造成2段共100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.5, hits: 2 }]
        },
        s2: {
          name: '色诱术', tags: ['控制', '减益'], fx: 'genjutsu', target: 'single', cd: 3,
          desc: '变身成性感美女让敌人看呆：有60%概率使目标眩晕1回合，并使其防御力降低20%，持续2回合。',
          effects: [
            { type: 'status', status: 'stun', turns: 1, chance: 0.6 },
            { type: 'debuff', stat: 'def', value: 0.2, turns: 2 }
          ]
        },
        ult: {
          name: '螺旋丸', tags: ['爆发', '控制'], fx: 'rasengan', target: 'single',
          desc: '用鸣人老大亲传的螺旋丸全力一击，造成270%攻击力伤害，并有50%概率使目标眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 2.7 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '火影之梦', tags: ['增益', '回能'],
          desc: '攻击力+12%；有友方阵亡时燃起斗志，自身攻击力提升30%，持续3回合，并获得20点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ally_death', effects: [
            { type: 'buff', stat: 'atk', value: 0.3, turns: 3 },
            { type: 'chakra', value: 20 }
          ] }]
        }
      }
    },

    {
      id: 'moegi', name: '萌黄', form: '', en: 'Moegi', title: '木叶丸军团',
      faction: 'konoha', rarity: 'R', role: 'sup', element: 'none', tags: ['增益', '闪避', '净化'],
      stats: { hp: 1.0, atk: 0.95, def: 1.0, spd: 110 },
      bio: '木叶丸军团中唯一的女孩，扎着两个冲天辫，性格活泼要强。她和木叶丸、乌冬一起追随鸣人的脚步努力修行，梦想成为出色的女忍者。',
      quote: '我可不会输给男孩子！',
      art: {
        type: 'human', skin: '#f8dcc4', hair: 'twin_tails', hairColor: '#e86a2b',
        eyes: 'normal', eyeColor: '#3a2a1a',
        outfit: 'shirt', outfitColor: '#e45a6a', accentColor: '#f2e2c2',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#ffb27a'
      },
      skills: {
        passive: {
          name: '木叶丸军团', tags: ['增益', '闪避'],
          desc: '闪避率+5%；战斗开始时为全体友方鼓劲，使其闪避率提升8%，持续2回合。',
          stats: { dodge: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'dodge', value: 0.08, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '分身术', tags: ['消耗', '减益'], fx: 'clone', target: 'single', cd: 0,
          desc: '用分身术扰乱敌人后发起攻击，造成92%攻击力伤害，并有30%概率使其攻击力降低10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.92 },
            { type: 'debuff', stat: 'atk', value: 0.1, turns: 2, chance: 0.3 }
          ]
        },
        s2: {
          name: '起爆符', tags: ['输出', '持续'], fx: 'explosion', target: 'single', cd: 3,
          desc: '将贴着起爆符的苦无掷向敌人，造成155%攻击力伤害，并有30%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.55 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        ult: {
          name: '烟玉', tags: ['闪避', '净化', '护盾'], fx: 'shield', target: 'ally_all',
          desc: '掷出烟玉掩护全队：净化全体友方的减益与异常状态，使其闪避率提升20%，并获得相当于萌黄攻击力60%的护盾，均持续2回合。',
          effects: [
            { type: 'cleanse', to: 'ally_all' },
            { type: 'buff', stat: 'dodge', value: 0.2, turns: 2 },
            { type: 'shield', mult: 0.6, turns: 2 }
          ]
        },
        awaken: {
          name: '成长的决心', tags: ['治疗', '增益'],
          desc: '攻击力+10%，生命值+5%；释放必杀技后为全体友方恢复相当于萌黄攻击力40%的生命。',
          stats: { atk: 0.1, hp: 0.05 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'heal', mult: 0.4, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'udon', name: '乌冬', form: '', en: 'Udon', title: '军团参谋',
      faction: 'konoha', rarity: 'R', role: 'ctrl', element: 'none', tags: ['控制', '减益'],
      stats: { hp: 1.0, atk: 0.95, def: 1.05, spd: 92 },
      bio: '木叶丸军团的成员，戴着圆眼镜、总是挂着鼻涕的少年，性格沉稳、擅长计算。他和木叶丸、萌黄一起修行，梦想成为独当一面的忍者。',
      quote: '我、我也会努力的……',
      art: {
        type: 'human', skin: '#f1d3b8', hair: 'short', hairColor: '#5b4a3a',
        eyes: 'normal', eyeColor: '#3a2a1a',
        outfit: 'shirt', outfitColor: '#7aa3c8', accentColor: '#5d6b8a',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['glasses'], mask: 'none', hat: 'none', accessory: 'none', aura: '#8fd0ff'
      },
      skills: {
        passive: {
          name: '冷静的分析', tags: ['减益'],
          desc: '防御力+8%；受到攻击时有20%概率看穿攻击者的招式，使其攻击力降低15%，持续2回合。',
          stats: { def: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'debuff', stat: 'atk', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '手里剑之术', tags: ['消耗'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '认真计算角度后投出手里剑，造成92%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.92 }]
        },
        s2: {
          name: '鼻涕黏缠', tags: ['控制'], fx: 'water', target: 'single', cd: 3,
          desc: '用黏糊糊的鼻涕缠住敌人，造成60%攻击力伤害，并有60%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.6 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.6 }
          ]
        },
        ult: {
          name: '撒菱之术', tags: ['群攻', '减益'], fx: 'shuriken', target: 'all',
          desc: '在敌阵中撒满撒菱，对全体敌人造成130%攻击力伤害，并使其速度降低30%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'debuff', stat: 'spd', value: 0.3, turns: 2 }
          ]
        },
        awaken: {
          name: '下忍的觉悟', tags: ['护盾', '增益'],
          desc: '攻击力+10%，防御力+5%；战斗开始时为全体友方提供相当于乌冬攻击力30%的护盾，持续2回合。',
          stats: { atk: 0.1, def: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', mult: 0.3, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'ebisu', name: '惠比寿', form: '', en: 'Ebisu', title: '精英家教',
      faction: 'konoha', rarity: 'R', role: 'sup', element: 'none', tags: ['增益', '减益', '回能'],
      stats: { hp: 1.0, atk: 0.95, def: 1.05, spd: 105 },
      bio: '自称“精英家庭教师”的木叶忍者，负责辅导三代目之孙木叶丸，戴着墨镜、一本正经。他曾被鸣人的后宫之术一招击倒，后来又短暂指导过鸣人练习在水面上行走。',
      quote: '跟着我学，就是成为火影的捷径！',
      art: {
        type: 'human', skin: '#f1d3b8', hair: 'short', hairColor: '#1b1b1b',
        eyes: 'normal', eyeColor: '#2a2a2a',
        outfit: 'flak', outfitColor: '#6b8e3d', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'bandana',
        marks: ['sunglasses'], mask: 'none', hat: 'none', accessory: 'none', aura: '#9fd3ff'
      },
      skills: {
        passive: {
          name: '精英家庭教师', tags: ['增益'],
          desc: '暴击率+5%，防御力+5%；战斗开始时指点全体友方，使其暴击率提升8%，持续2回合。',
          stats: { crit: 0.05, def: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'crit', value: 0.08, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '木叶流体术', tags: ['消耗', '减益'], fx: 'fist', target: 'single', cd: 0,
          desc: '标准而精准的木叶流体术，造成95%攻击力伤害，并有30%概率使目标防御力降低10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.95 },
            { type: 'debuff', stat: 'def', value: 0.1, turns: 2, chance: 0.3 }
          ]
        },
        s2: {
          name: '精英式特训', tags: ['增益'], fx: 'yang', target: 'ally_all', cd: 3,
          desc: '以精英教学法指导同伴，使全体友方攻击力提升20%，持续2回合。',
          effects: [{ type: 'buff', stat: 'atk', value: 0.2, turns: 2 }]
        },
        ult: {
          name: '杀手锏', tags: ['爆发', '减益'], fx: 'blade', target: 'single',
          desc: '精英家庭教师压箱底的杀手锏，对目标造成260%攻击力伤害，并使其防御力降低25%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 2.6 },
            { type: 'debuff', stat: 'def', value: 0.25, turns: 2 }
          ]
        },
        awaken: {
          name: '查克拉控制指导', tags: ['回能', '增益'],
          desc: '攻击力+10%；战斗开始时指导全体友方精确控制查克拉，使其各获得15点查克拉。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 15, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'mizuki', name: '水木', form: '', en: 'Mizuki', title: '背叛者',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'none', tags: ['输出', '持续', '吸血'],
      stats: { hp: 0.95, atk: 1.12, def: 0.9, spd: 115 },
      bio: '忍者学校的老师，表面和善，暗中却唆使鸣人偷出封印之书，企图带着禁术投靠大蛇丸。阴谋被伊鲁卡与鸣人挫败后，他被关进了监狱。',
      quote: '九尾小鬼，没有人会认同你！',
      art: {
        type: 'human', skin: '#f1d3b8', hair: 'long_straight', hairColor: '#b8c7d9',
        eyes: 'normal', eyeColor: '#4a4a4a',
        outfit: 'flak', outfitColor: '#6b8e3d', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#7e57c2'
      },
      skills: {
        passive: {
          name: '背叛', tags: ['持续', '增益'],
          desc: '暴击率+10%；笑里藏刀，攻击命中后有20%概率使目标流血2回合（每回合30%攻击力）。',
          stats: { crit: 0.1 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'status', status: 'bleed', turns: 2, value: 0.3 }] }]
        },
        s1: {
          name: '苦无之术', tags: ['输出'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '冷不防掷出苦无，造成100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.0 }]
        },
        s2: {
          name: '风魔手里剑', tags: ['斩杀', '持续'], fx: 'shuriken', target: 'lowest', cd: 3,
          desc: '将巨大的风魔手里剑掷向生命比例最低的敌人，造成175%攻击力伤害，并使其流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.75 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.3 }
          ]
        },
        ult: {
          name: '虎化·猛袭', tags: ['爆发', '吸血', '增益'], fx: 'beast', target: 'single',
          desc: '服下大蛇丸的秘药化身猛虎：自身攻击力提升25%，持续2回合，随即扑杀目标，造成270%攻击力伤害，并回复相当于伤害25%的生命。',
          effects: [
            { type: 'buff', stat: 'atk', value: 0.25, turns: 2, to: 'self' },
            { type: 'dmg', mult: 2.7 },
            { type: 'lifesteal', value: 0.25 }
          ]
        },
        awaken: {
          name: '大蛇丸的秘药', tags: ['治疗', '增益'],
          desc: '攻击力+12%，生命值+5%；生命首次低于30%时药效发作，立即恢复25%最大生命值，并使攻击力提升30%，持续3回合。',
          stats: { atk: 0.12, hp: 0.05 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.25 },
            { type: 'buff', stat: 'atk', value: 0.3, turns: 3 }
          ] }]
        }
      }
    },

    /* ============================ 深作仙人 ============================ */
    {
      id: 'fukasaku', name: '深作仙人', form: '妙木山', en: 'Fukasaku', title: '二大仙蛤蟆',
      faction: 'other', rarity: 'SR', role: 'sup', element: 'water', tags: ['增益', '控制', '回能'],
      stats: { hp: 0.9, atk: 1.1, def: 0.95, spd: 110 },
      bio: '妙木山的二大仙蛤蟆之一，与妻子志麻一同传授仙术，是自来也和鸣人的仙术老师。佩恩袭击木叶时，他为揭开佩恩的秘密挺身而出，最终死于佩恩天道之手。',
      quote: '仙术修行，可容不得偷懒哦。',
      art: {
        type: 'beast', beast: 'toad', tails: 0,
        bodyColor: '#8a9d6b', accentColor: '#f2ead6', eyes: 'sage', aura: '#ff9800'
      },
      skills: {
        passive: {
          name: '仙术传授', tags: ['回能', '增益'],
          desc: '攻击力+8%；每回合开始时为随机一名友方注入10点仙术查克拉。',
          stats: { atk: 0.08 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'chakra', value: 10, to: 'ally_random' }] }]
        },
        s1: {
          name: '蛙组手', tags: ['输出', '穿透'], fx: 'fist', target: 'single', cd: 0,
          desc: '妙木山的独门体术，以自然能量延伸攻击范围，造成105%攻击力伤害，无视目标20%防御。',
          effects: [{ type: 'dmg', mult: 1.05, pierce: 0.2 }]
        },
        s2: {
          name: '仙法·五右卫门', tags: ['群攻', '持续'], fx: 'fire', target: 'all', cd: 3,
          desc: '与志麻配合吐出风与油，引燃成灼热的洪流席卷敌阵，对全体敌人造成90%攻击力伤害，并使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'status', status: 'burn', turns: 2, value: 0.3 }
          ]
        },
        ult: {
          name: '仙法·魔幻·蛤蟆临唱', tags: ['控制', '群攻'], fx: 'genjutsu', target: 'all',
          desc: '与志麻合唱施展仙术幻术，将全体敌人拖入幻境，造成120%攻击力伤害，并有60%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.6 }
          ]
        },
        awaken: {
          name: '融合·仙人模式', tags: ['增益'],
          desc: '攻击力+10%，生命值+8%；释放必杀技后以仙术查克拉灌注全体友方，使其攻击力提升15%，持续2回合。',
          stats: { atk: 0.1, hp: 0.08 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'buff', stat: 'atk', value: 0.15, turns: 2, to: 'ally_all' }] }]
        }
      }
    }

  ]);
})();
