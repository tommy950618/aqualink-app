/* js/data/konoha_elders.js — 木叶·历代火影、传说三忍与木叶精英
 * 初代～四代目火影（含秽土转生·九喇嘛模式水门）、纲手与自来也、漩涡一族的玖辛奈与水户、
 * 木叶白牙、加藤断、千手绳树、静音、“根”的团藏/风/取根/信、两位顾问，以及特别上忍与中忍们。
 * 仅收录《火影忍者》与《火影忍者疾风传》时期的角色、形态与忍术。
 */
(function () {
  'use strict';
  NG.defineChars('konoha_elders', [

    /* ============================ 历代火影 ============================ */
    {
      id: 'hashirama', name: '千手柱间', form: '初代火影', en: 'Senju Hashirama', title: '忍者之神',
      faction: 'konoha', rarity: 'UR', role: 'ctrl', element: 'earth', tags: ['控制', '群攻', '治疗'],
      stats: { hp: 1.12, atk: 1.0, def: 0.95, spd: 112 },
      bio: '千手一族族长、木叶隐村的创立者与初代火影，被誉为“忍者之神”。他天生拥有木遁血继限界，查克拉量惊人，无需结印便能高速自愈。曾在终末之谷与挚友宇智波斑展开传说中的决战。',
      quote: '我要建立孩子们不必战死的村子！',
      art: {
        type: 'human', skin: '#e9c39c', hair: 'very_long', hairColor: '#1c1410',
        eyes: 'normal', eyeColor: '#3b2a1f',
        outfit: 'armor', outfitColor: '#a8282c', accentColor: '#2b2b2b',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['sage_marks'], mask: 'none', hat: 'none', accessory: 'none', aura: '#6fcf5a'
      },
      skills: {
        passive: {
          name: '仙人模式', tags: ['治疗', '增益'],
          desc: '吸收自然能量进入仙人模式，配合与生俱来的超强自愈力：生命值+10%，攻击力+8%；每回合开始时恢复6%最大生命值。',
          stats: { hp: 0.1, atk: 0.08 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.06 }] }]
        },
        s1: {
          name: '木遁·木龙之术', tags: ['输出', '减益'], fx: 'wood', target: 'single', cd: 0,
          desc: '唤出能吸取查克拉的木龙缠绕敌人，造成120%攻击力伤害，并使目标减少15点查克拉。',
          effects: [{ type: 'dmg', mult: 1.2 }, { type: 'drain', value: 15 }]
        },
        s2: {
          name: '木遁·树界降诞', tags: ['群攻', '控制'], fx: 'wood', target: 'all', cd: 3,
          desc: '大地瞬间长出参天巨木化为森林，对全体敌人造成110%攻击力伤害，并有40%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '仙法·木遁·真数千手', tags: ['群攻', '爆发', '控制'], fx: 'wood', target: 'all',
          desc: '召唤背负千手的巨型木佛，千掌齐落轰击战场，对全体敌人造成4段共220%攻击力伤害，并有60%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.55, hits: 4 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.6 }
          ]
        },
        awaken: {
          name: '顶上化佛', tags: ['增益', '治疗'],
          desc: '攻击力+12%；释放必杀技后化出真数千手·顶上化佛，并以无需结印的治愈之力为全体友方恢复10%最大生命值。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'heal', pct: 0.1, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'tobirama', name: '千手扉间', form: '二代目火影', en: 'Senju Tobirama', title: '忍术开发者',
      faction: 'konoha', rarity: 'SSR', role: 'atk', element: 'water', tags: ['输出', '爆发', '召唤'],
      stats: { hp: 0.95, atk: 1.12, def: 0.92, spd: 135 },
      bio: '初代火影千手柱间之弟、木叶第二代火影，建立了忍者学校与暗部等村子制度。他是天才的忍术开发者，影分身之术、飞雷神之术与秽土转生皆出自其手，也是顶尖的感知忍者与水遁高手。',
      quote: '猿飞，从今以后你就是火影了。',
      art: {
        type: 'human', skin: '#f1dcc8', hair: 'spiky', hairColor: '#e8e8e8',
        eyes: 'normal', eyeColor: '#c62828',
        outfit: 'armor', outfitColor: '#2a4f8a', accentColor: '#f2f2f2',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['face_lines'], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#3a8dff'
      },
      skills: {
        passive: {
          name: '感知忍术', tags: ['闪避', '回能'],
          desc: '以顶尖的感知能力预判敌人行动：闪避率+12%，暴击率+10%；战斗开始时获得25点查克拉。',
          stats: { dodge: 0.12, crit: 0.1 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 25 }] }]
        },
        s1: {
          name: '飞雷神斩', tags: ['输出', '穿透'], fx: 'space', target: 'single', cd: 0,
          desc: '以飞雷神之术瞬移至敌人身侧挥刀斩击，造成115%攻击力伤害，无视目标25%防御。',
          effects: [{ type: 'dmg', mult: 1.15, pierce: 0.25 }]
        },
        s2: {
          name: '水遁·水龙弹之术', tags: ['爆发', '控制'], fx: 'water', target: 'single', cd: 3,
          desc: '无需水源也能凝聚出巨大的水龙冲击敌人，造成210%攻击力伤害，并有30%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 2.1 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        ult: {
          name: '秽土转生之术', tags: ['召唤', '群攻', '增益'], fx: 'summon', target: 'all',
          desc: '发动亲手开发的禁术，唤出已故忍者的秽土之躯冲入敌阵，对全体敌人造成190%攻击力伤害，并使全体友方攻击力提升20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '影分身之术', tags: ['输出', '爆发'],
          desc: '攻击力+12%；作为影分身之术的创造者，每次攻击命中后有25%概率由影分身追加一次60%攻击力的伤害。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_attack', chance: 0.25, effects: [{ type: 'dmg', mult: 0.6, to: 'target' }] }]
        }
      }
    },

    {
      id: 'hiruzen', name: '猿飞日斩', form: '三代目火影', en: 'Sarutobi Hiruzen', title: '忍术教授',
      faction: 'konoha', rarity: 'SSR', role: 'ctrl', element: 'fire', tags: ['控制', '封印', '群攻'],
      stats: { hp: 1.0, atk: 1.05, def: 1.0, spd: 105 },
      bio: '木叶第三代火影，千手扉间的弟子，通晓木叶的所有忍术并精通全部五种查克拉性质，被称为“教授”。他培养出了传说三忍，木叶崩溃时以尸鬼封尽封印了大蛇丸的双臂，为守护村子献出了生命。',
      quote: '木叶飞舞之处，火亦生生不息。',
      art: {
        type: 'human', skin: '#e6c09a', hair: 'short', hairColor: '#a0a0a0',
        eyes: 'normal', eyeColor: '#3b2f2a',
        outfit: 'kage', outfitColor: '#f4f4f4', accentColor: '#c62828',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: ['goatee', 'wrinkles'], mask: 'none', hat: 'hokage', accessory: 'staff', aura: '#ff7b00'
      },
      skills: {
        passive: {
          name: '五遁精通', tags: ['增益'],
          desc: '精通全部五种查克拉性质变化：攻击力+8%，暴击率+10%；战斗开始时激励全军，使全体友方攻击力提升10%，持续2回合。',
          stats: { atk: 0.08, crit: 0.1 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'atk', value: 0.1, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '手里剑影分身之术', tags: ['群攻', '消耗'], fx: 'shuriken', target: 'random', count: 3, cd: 0,
          desc: '掷出的一枚手里剑化为大量影分身，对随机3名敌人各造成42%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.42 }]
        },
        s2: {
          name: '火遁·火龙炎弹', tags: ['群攻', '持续'], fx: 'fire', target: 'all', cd: 3,
          desc: '口中喷出火龙形状的烈焰席卷敌阵，对全体敌人造成95%攻击力伤害，并使其灼烧2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.95 },
            { type: 'status', status: 'burn', turns: 2, value: 0.25 }
          ]
        },
        ult: {
          name: '尸鬼封尽', tags: ['封印', '控制', '爆发'], fx: 'seal', target: 'highest_atk',
          desc: '召唤死神抽出攻击力最高的敌人的灵魂加以封印，造成300%攻击力伤害，使其封印2回合（只能使用技能1），并减少其50点查克拉。',
          effects: [
            { type: 'dmg', mult: 3.0 },
            { type: 'status', status: 'silence', turns: 2 },
            { type: 'drain', value: 50 }
          ]
        },
        awaken: {
          name: '猿魔·金刚如意', tags: ['控制', '增益'],
          desc: '攻击力+12%，防御力+5%；通灵猿猴王·猿魔化身金刚如意并肩作战，每次攻击命中后有20%概率使目标束缚1回合。',
          stats: { atk: 0.12, def: 0.05 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'status', status: 'bind', turns: 1, to: 'target' }] }]
        }
      }
    },

    {
      id: 'minato', name: '波风水门', form: '四代目火影', en: 'Namikaze Minato', title: '金色闪光',
      faction: 'konoha', rarity: 'SSR', role: 'atk', element: 'wind', tags: ['输出', '斩杀', '闪避'],
      stats: { hp: 0.92, atk: 1.15, def: 0.9, spd: 145 },
      bio: '木叶第四代火影，自来也的弟子、漩涡鸣人的父亲。他凭借飞雷神之术称霸战场，被誉为“木叶的金色闪光”，并开发了螺旋丸。九尾袭击之夜，他与妻子玖辛奈牺牲自己，将九尾封印在刚出生的鸣人体内。',
      quote: '我的儿子，一定会成为英雄。',
      art: {
        type: 'human', skin: '#f5d3b3', hair: 'fringe_spiky', hairColor: '#f9d71c',
        eyes: 'normal', eyeColor: '#2f6fd6',
        outfit: 'haori_flame', outfitColor: '#f5f5f5', accentColor: '#e53935',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#ffe14d'
      },
      skills: {
        passive: {
          name: '飞雷神术式', tags: ['闪避', '反击'],
          desc: '战场各处都刻有飞雷神术式：闪避率+15%，暴击率+10%；受到攻击时有30%概率瞬移至攻击者身后反击，造成60%攻击力伤害。',
          stats: { dodge: 0.15, crit: 0.1 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'dmg', mult: 0.6, to: 'attacker' }] }]
        },
        s1: {
          name: '飞雷神苦无', tags: ['输出', '闪避'], fx: 'space', target: 'single', cd: 0,
          desc: '掷出刻有术式的三叉苦无并瞬移斩击，造成2段共120%攻击力伤害，并使自身闪避率提升10%，持续1回合。',
          effects: [
            { type: 'dmg', mult: 0.6, hits: 2 },
            { type: 'buff', stat: 'dodge', value: 0.1, turns: 1, to: 'self' }
          ]
        },
        s2: {
          name: '螺旋丸', tags: ['爆发', '控制'], fx: 'rasengan', target: 'single', cd: 2,
          desc: '以亲手开发的螺旋丸直击敌人，造成200%攻击力伤害，并有30%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 2.0 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        ult: {
          name: '飞雷神二段', tags: ['斩杀', '爆发', '单体'], fx: 'rasengan', target: 'lowest',
          desc: '在苦无与敌人身上的术式之间连续瞬移，以螺旋丸对生命比例最低的敌人造成3段共330%攻击力伤害，生命低于30%的目标额外受到120%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 1.1, hits: 3 },
            { type: 'execute', threshold: 0.3, mult: 1.2 }
          ]
        },
        awaken: {
          name: '时空间结界', tags: ['护盾', '回能'],
          desc: '攻击力+12%；生命首次低于30%时展开时空间结界转移攻击，为全体友方提供15%最大生命值的护盾，持续2回合；每击败一名敌人获得30点查克拉。',
          stats: { atk: 0.12 },
          triggers: [
            { on: 'low_hp', effects: [{ type: 'shield', pct: 0.15, turns: 2, to: 'ally_all' }] },
            { on: 'on_kill', effects: [{ type: 'chakra', value: 30 }] }
          ]
        }
      }
    },

    {
      id: 'minato_edo', name: '波风水门', form: '秽土转生·九喇嘛模式', en: 'Namikaze Minato', title: '归来的火影',
      faction: 'konoha', rarity: 'UR', role: 'atk', element: 'yang', tags: ['输出', '群攻', '护盾'],
      stats: { hp: 0.95, atk: 1.15, def: 0.92, spd: 148 },
      bio: '第四次忍界大战中被大蛇丸以秽土转生唤回，与历代火影一同奔赴战场。他借助体内封印的阴之九喇嘛进入九喇嘛模式，以飞雷神之术把忍者联军从十尾的攻击中转移出来，并与鸣人父子并肩作战。',
      quote: '鸣人，让我们父子并肩战斗吧！',
      art: {
        type: 'human', skin: '#f5d3b3', hair: 'fringe_spiky', hairColor: '#ffcf1a',
        eyes: 'kurama', eyeColor: '#ff8a00',
        outfit: 'cloak', outfitColor: '#ffb300', accentColor: '#1b1b1b',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['kurama_marks'], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#ffcc00'
      },
      skills: {
        passive: {
          name: '秽土转生之躯', tags: ['治疗', '闪避'],
          desc: '秽土转生的躯体可以不断再生：闪避率+15%，伤害减免+10%；战斗开始时获得25点查克拉，每回合开始时恢复5%最大生命值。',
          stats: { dodge: 0.15, dr: 0.1 },
          triggers: [
            { on: 'battle_start', effects: [{ type: 'chakra', value: 25 }] },
            { on: 'turn_start', effects: [{ type: 'heal', pct: 0.05 }] }
          ]
        },
        s1: {
          name: '飞雷神之术', tags: ['输出', '穿透'], fx: 'space', target: 'single', cd: 0,
          desc: '凭借九喇嘛查克拉与飞雷神之术在敌阵中连续闪现，造成3段共126%攻击力伤害，无视目标20%防御。',
          effects: [{ type: 'dmg', mult: 0.42, hits: 3, pierce: 0.2 }]
        },
        s2: {
          name: '飞雷神·导雷', tags: ['护盾', '增益'], fx: 'shield', target: 'ally_all', cd: 3,
          desc: '在全体友方身上刻下飞雷神术式，随时将其转移出险境：为全体友方提供18%最大生命值的护盾，并使其速度提升15%，持续2回合。',
          effects: [
            { type: 'shield', pct: 0.18, turns: 2 },
            { type: 'buff', stat: 'spd', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '九喇嘛模式·尾兽玉', tags: ['群攻', '爆发', '控制'], fx: 'bijuu', target: 'all',
          desc: '借阴之九喇嘛的力量凝聚尾兽玉，并以飞雷神之术精准投送至敌阵中央，对全体敌人造成230%攻击力伤害，并有40%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 2.3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 }
          ]
        },
        awaken: {
          name: '四赤阳阵', tags: ['控制', '增益'],
          desc: '攻击力+12%，防御力+5%；释放必杀技后与历代火影结成四赤阳阵封锁战场，使全体敌人有30%概率被束缚1回合。',
          stats: { atk: 0.12, def: 0.05 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'bind', turns: 1, chance: 0.3, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'tsunade', name: '纲手', form: '五代目火影', en: 'Tsunade', title: '蛞蝓姬',
      faction: 'konoha', rarity: 'SSR', role: 'heal', element: 'yang', tags: ['治疗', '净化', '增益'],
      stats: { hp: 1.1, atk: 1.0, def: 0.95, spd: 106 },
      bio: '传说三忍之一、初代火影的孙女，忍界首屈一指的医疗忍者，拥有一击碎地的怪力与百豪之术。她在自来也与鸣人的劝说下重返木叶，继任第五代火影。',
      quote: '只要我还在，就不会让同伴死去！',
      art: {
        type: 'human', skin: '#f6d7bd', hair: 'twin_tails', hairColor: '#f2d16b',
        eyes: 'normal', eyeColor: '#b07a3a',
        outfit: 'robe', outfitColor: '#6b8e4e', accentColor: '#8a8a8a',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: ['diamond'], mask: 'none', hat: 'none', accessory: 'none', aura: '#69f0ae'
      },
      skills: {
        passive: {
          name: '医疗忍术', tags: ['治疗'],
          desc: '忍界顶尖的医疗忍者：生命值+10%；每回合开始时为生命比例最低的友方恢复5%最大生命值。',
          stats: { hp: 0.1 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.05, to: 'ally_lowest' }] }]
        },
        s1: {
          name: '怪力·痛天脚', tags: ['输出', '控制'], fx: 'fist', target: 'single', cd: 0,
          desc: '将查克拉凝聚于脚跟从天而降劈下，造成110%攻击力伤害，并有25%概率使目标眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.25 }
          ]
        },
        s2: {
          name: '掌仙术', tags: ['治疗', '净化'], fx: 'heal', target: 'ally_lowest', cd: 2,
          desc: '以掌仙术为生命比例最低的友方疗伤，恢复相当于自身200%攻击力的生命值，并清除其所有减益与异常状态。',
          effects: [
            { type: 'heal', mult: 2.0 },
            { type: 'cleanse', to: 'target' }
          ]
        },
        ult: {
          name: '通灵之术·蛞蝓', tags: ['治疗', '净化', '召唤'], fx: 'heal', target: 'ally_all',
          desc: '通灵出巨大的蛞蝓，分裂成无数小蛞蝓附着在每位同伴身上，为全体友方恢复相当于自身150%攻击力的生命值，清除所有减益与异常状态，并使其伤害减免提升15%，持续2回合。',
          effects: [
            { type: 'heal', mult: 1.5 },
            { type: 'cleanse', to: 'ally_all' },
            { type: 'buff', stat: 'dr', value: 0.15, turns: 2 }
          ]
        },
        awaken: {
          name: '百豪之术·创造再生', tags: ['治疗', '增益'],
          desc: '攻击力+12%，生命值+5%；生命首次低于30%时解放额头的百豪之印发动创造再生，立即恢复50%最大生命值并清除自身减益与异常状态，2回合内免疫控制。',
          stats: { atk: 0.12, hp: 0.05 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.5 },
            { type: 'cleanse' },
            { type: 'immune', turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 传说三忍·漩涡一族 ============================ */
    {
      id: 'jiraiya', name: '自来也', form: '蛤蟆仙人', en: 'Jiraiya', title: '好色仙人',
      faction: 'konoha', rarity: 'SSR', role: 'atk', element: 'fire', tags: ['群攻', '控制', '持续'],
      stats: { hp: 1.05, atk: 1.08, def: 0.92, spd: 110 },
      bio: '传说三忍之一，妙木山的蛤蟆仙人，也是被鸣人称为“好色仙人”的畅销小说作家。他先后培养了波风水门与漩涡鸣人，独自潜入雨隐村调查晓组织，与弟子长门操纵的佩恩六道战斗至最后一刻。',
      quote: '所谓忍者，就是能够忍耐之人。',
      art: {
        type: 'human', skin: '#f0cfaa', hair: 'wild_long', hairColor: '#f2f2f2',
        eyes: 'normal', eyeColor: '#3a2a1e',
        outfit: 'kimono', outfitColor: '#4f7a3a', accentColor: '#c0392b',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: ['tear_lines'], mask: 'none', hat: 'horns', accessory: 'scroll', aura: '#ff9800'
      },
      skills: {
        passive: {
          name: '忍法·针地藏', tags: ['反击', '增益'],
          desc: '长发硬化成针刺包裹全身：防御力+10%，生命值+5%；受到攻击时有30%概率以针地藏反刺攻击者，造成50%攻击力伤害。',
          stats: { def: 0.1, hp: 0.05 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'dmg', mult: 0.5, to: 'attacker' }] }]
        },
        s1: {
          name: '火遁·蛤蟆油炎弹', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 0,
          desc: '将火遁与蛤蟆油混合喷出炽热的炎弹，造成110%攻击力伤害，并有30%概率使目标灼烧2回合（每回合20%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'burn', turns: 2, value: 0.2, chance: 0.3 }
          ]
        },
        s2: {
          name: '通灵·蛤蟆口束缚', tags: ['群攻', '控制'], fx: 'summon', target: 'all', cd: 4,
          desc: '通灵出妙木山巨蛤蟆的食道吞没敌人，对全体敌人造成85%攻击力伤害，并有40%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.85 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '超大玉螺旋丸', tags: ['爆发', '控制', '单体'], fx: 'rasengan', target: 'single',
          desc: '凝聚出远超常规尺寸的螺旋丸砸向敌人，造成350%攻击力伤害，并有70%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 3.5 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.7 }
          ]
        },
        awaken: {
          name: '仙人模式', tags: ['增益', '持续'],
          desc: '在深作、志麻两大仙人的协助下进入仙人模式：攻击力+12%，防御力+5%；释放必杀技后两大仙人合力施展仙法·五右卫门，使全体敌人灼烧2回合（每回合30%攻击力）。',
          stats: { atk: 0.12, def: 0.05 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'burn', turns: 2, value: 0.3, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'kushina', name: '漩涡玖辛奈', form: '', en: 'Uzumaki Kushina', title: '血红辣椒',
      faction: 'konoha', rarity: 'SSR', role: 'ctrl', element: 'water', tags: ['控制', '封印', '减益'],
      stats: { hp: 1.05, atk: 1.0, def: 0.98, spd: 116 },
      bio: '出身漩涡一族的第二代九尾人柱力，波风水门之妻、漩涡鸣人之母。因一头红发与火爆脾气被称为“血红辣椒”，拥有能压制九尾的特殊查克拉锁链。九尾之夜，她与水门用生命守护了刚出生的鸣人。',
      quote: '鸣人……不要挑食，要好好吃饭哦。',
      art: {
        type: 'human', skin: '#f7d9c0', hair: 'very_long', hairColor: '#c8102e',
        eyes: 'normal', eyeColor: '#5a6b8c',
        outfit: 'robe', outfitColor: '#5b8a3c', accentColor: '#f2efe6',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#ffd740'
      },
      skills: {
        passive: {
          name: '漩涡一族', tags: ['治疗', '增益'],
          desc: '漩涡一族拥有强韧的生命力：生命值+12%，伤害减免+5%；生命首次低于30%时恢复25%最大生命值。',
          stats: { hp: 0.12, dr: 0.05 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'heal', pct: 0.25 }] }]
        },
        s1: {
          name: '体术·连打', tags: ['消耗', '减益'], fx: 'fist', target: 'single', cd: 0,
          desc: '火爆的连续拳击，造成3段共105%攻击力伤害，并使目标速度降低10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.35, hits: 3 },
            { type: 'debuff', stat: 'spd', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '查克拉锁链', tags: ['群攻', '控制'], fx: 'chakra', target: 'all', cd: 3,
          desc: '从体内射出无数查克拉锁链贯穿敌阵，对全体敌人造成85%攻击力伤害，并有40%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.85 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '金刚封锁', tags: ['封印', '控制', '减益'], fx: 'seal', target: 'highest_atk',
          desc: '射出曾压制九尾的金刚封锁，锁住攻击力最高的敌人，造成280%攻击力伤害，使其束缚1回合、封印2回合（只能使用技能1），并减少其30点查克拉。',
          effects: [
            { type: 'dmg', mult: 2.8 },
            { type: 'status', status: 'bind', turns: 1 },
            { type: 'status', status: 'silence', turns: 2 },
            { type: 'drain', value: 30 }
          ]
        },
        awaken: {
          name: '九尾人柱力', tags: ['控制', '回能'],
          desc: '攻击力+12%，生命值+5%；作为九尾人柱力，战斗开始时获得25点查克拉；受到攻击时有20%概率以锁链反缚攻击者1回合。',
          stats: { atk: 0.12, hp: 0.05 },
          triggers: [
            { on: 'battle_start', effects: [{ type: 'chakra', value: 25 }] },
            { on: 'on_hit', chance: 0.2, effects: [{ type: 'status', status: 'bind', turns: 1, to: 'attacker' }] }
          ]
        }
      }
    },

    {
      id: 'mito', name: '漩涡水户', form: '', en: 'Uzumaki Mito', title: '初代火影夫人',
      faction: 'konoha', rarity: 'SSR', role: 'sup', element: 'yin', tags: ['封印', '护盾', '治疗'],
      stats: { hp: 1.08, atk: 0.95, def: 1.02, spd: 100 },
      bio: '出身漩涡一族，初代火影千手柱间之妻、纲手的祖母。柱间与宇智波斑决战后，她将九尾封入自己体内，成为第一代九尾人柱力，晚年又把九尾托付给了漩涡玖辛奈。',
      quote: '只要心中充满爱，就能压制九尾。',
      art: {
        type: 'human', skin: '#f6dcc6', hair: 'buns', hairColor: '#c8102e',
        eyes: 'normal', eyeColor: '#3b2f4a',
        outfit: 'kimono', outfitColor: '#e9e4f2', accentColor: '#6741d9',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: ['diamond'], mask: 'none', hat: 'none', accessory: 'none', aura: '#ffd740'
      },
      skills: {
        passive: {
          name: '初代人柱力', tags: ['增益', '回能'],
          desc: '数十年镇压九尾的坚韧意志：生命值+12%，伤害减免+8%；战斗开始时获得20点查克拉。',
          stats: { hp: 0.12, dr: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '封印术', tags: ['消耗', '减益'], fx: 'chakra', target: 'single', cd: 0,
          desc: '以封印术式打击敌人的经络，造成100%攻击力伤害，并减少目标10点查克拉。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'drain', value: 10 }]
        },
        s2: {
          name: '封印术·四象封印', tags: ['封印', '减益'], fx: 'seal', target: 'highest_atk', cd: 3,
          desc: '在攻击力最高的敌人身上刻下四象封印，造成80%攻击力伤害，使其攻击力降低25%，持续2回合，并有60%概率使其封印1回合（只能使用技能1）。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'debuff', stat: 'atk', value: 0.25, turns: 2 },
            { type: 'status', status: 'silence', turns: 1, chance: 0.6 }
          ]
        },
        ult: {
          name: '九尾封印', tags: ['封印', '群攻', '护盾'], fx: 'seal', target: 'all',
          desc: '施展将九尾封入己身的大封印术，对全体敌人造成140%攻击力伤害并减少其30点查克拉，同时为全体友方提供相当于自身攻击力60%的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'drain', value: 30 },
            { type: 'shield', mult: 0.6, turns: 2, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '百豪之术', tags: ['治疗', '增益'],
          desc: '攻击力+10%，生命值+5%；以额头百豪之印中积蓄的查克拉滋养同伴，每回合开始时为全体友方恢复3%最大生命值。',
          stats: { atk: 0.1, hp: 0.05 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.03, to: 'ally_all' }] }]
        }
      }
    },

    /* ============================ 三忍的时代 ============================ */
    {
      id: 'sakumo', name: '旗木朔茂', form: '木叶白牙', en: 'Hatake Sakumo', title: '卡卡西之父',
      faction: 'konoha', rarity: 'SSR', role: 'atk', element: 'lightning', tags: ['输出', '爆发', '穿透'],
      stats: { hp: 0.92, atk: 1.18, def: 0.9, spd: 128 },
      bio: '旗木卡卡西的父亲，凭借白光查克拉刀威震忍界，被称为“木叶白牙”，名声甚至在传说三忍之上。他曾为拯救同伴而放弃任务，却因此遭到村民与同伴的指责，最终含恨自尽。',
      quote: '比起任务，我选择守护同伴。',
      art: {
        type: 'human', skin: '#f2d6be', hair: 'low_ponytail', hairColor: '#e0e0e0',
        eyes: 'normal', eyeColor: '#2b2b2b',
        outfit: 'flak', outfitColor: '#4f6b3a', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'tanto', aura: '#e8f6ff'
      },
      skills: {
        passive: {
          name: '木叶白牙', tags: ['增益', '爆发'],
          desc: '名震忍界的天才剑士：暴击率+15%，暴击伤害+25%。',
          stats: { crit: 0.15, critDmg: 0.25 }
        },
        s1: {
          name: '白光查克拉刀', tags: ['输出', '穿透'], fx: 'blade', target: 'single', cd: 0,
          desc: '挥动散发白光的查克拉短刀斩击，造成120%攻击力伤害，无视目标20%防御。',
          effects: [{ type: 'dmg', mult: 1.2, pierce: 0.2 }]
        },
        s2: {
          name: '白牙·连斩', tags: ['爆发', '持续'], fx: 'blade', target: 'single', cd: 3,
          desc: '以白光查克拉刀连续劈砍，造成3段共210%攻击力伤害，并使目标流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.7, hits: 3 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.3 }
          ]
        },
        ult: {
          name: '白牙·白光一闪', tags: ['单体', '爆发', '穿透'], fx: 'blade', target: 'single',
          desc: '白光查克拉刀化作一道白色闪光贯穿敌人，造成370%攻击力伤害，无视目标40%防御，并使自身暴击率提升20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 3.7, pierce: 0.4 },
            { type: 'buff', stat: 'crit', value: 0.2, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '同伴之义', tags: ['护盾', '增益'],
          desc: '攻击力+12%；把同伴的性命看得比任务更重，每回合开始时为生命比例最低的友方提供相当于自身攻击力40%的护盾，持续1回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'shield', mult: 0.4, turns: 1, to: 'ally_lowest' }] }]
        }
      }
    },

    {
      id: 'dan', name: '加藤断', form: '', en: 'Kato Dan', title: '纲手的恋人',
      faction: 'konoha', rarity: 'SR', role: 'ctrl', element: 'yin', tags: ['控制', '封印', '穿透'],
      stats: { hp: 1.0, atk: 1.02, def: 0.98, spd: 112 },
      bio: '纲手的恋人、静音的叔叔，梦想成为火影守护所爱之人。他能使用让灵魂离体行动的灵化之术，却在战争中身受重伤死在纲手面前，纲手也因此患上了恐血症。',
      quote: '我想成为火影，守护所爱的人。',
      art: {
        type: 'human', skin: '#eecfb2', hair: 'long_straight', hairColor: '#b9d3e6',
        eyes: 'normal', eyeColor: '#3b4a5a',
        outfit: 'flak', outfitColor: '#5d7a3e', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#9575cd'
      },
      skills: {
        passive: {
          name: '灵化之术', tags: ['闪避', '减益'],
          desc: '灵魂可以离开肉体自由行动：闪避率+15%；受到攻击时有25%概率以灵体扼住攻击者，使其减少15点查克拉。',
          stats: { dodge: 0.15 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'drain', value: 15, to: 'attacker' }] }]
        },
        s1: {
          name: '苦无术', tags: ['输出'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投掷苦无攻击敌人，造成105%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.05 }]
        },
        s2: {
          name: '灵体扼杀', tags: ['穿透', '控制'], fx: 'yin', target: 'single', cd: 3,
          desc: '灵魂离体穿过敌人的防御直接扼住其要害，造成相当于目标12%最大生命值的真实伤害，并有50%概率使其束缚1回合。',
          effects: [
            { type: 'true_dmg', pct: 0.12 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.5 }
          ]
        },
        ult: {
          name: '灵化之术·灵魂绞杀', tags: ['群攻', '封印', '控制'], fx: 'yin', target: 'all',
          desc: '灵体同时缠上所有敌人，对全体敌人造成150%攻击力伤害、减少其20点查克拉，并有50%概率使其封印2回合（只能使用技能1）。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'drain', value: 20 },
            { type: 'status', status: 'silence', turns: 2, chance: 0.5 }
          ]
        },
        awaken: {
          name: '断的遗志', tags: ['治疗', '增益'],
          desc: '攻击力+10%；阵亡时把守护同伴的梦想托付给大家，为全体友方恢复15%最大生命值，并使其攻击力提升15%，持续2回合。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'heal', pct: 0.15, to: 'ally_all' },
            { type: 'buff', stat: 'atk', value: 0.15, turns: 2, to: 'ally_all' }
          ] }]
        }
      }
    },

    {
      id: 'nawaki', name: '千手绳树', form: '', en: 'Senju Nawaki', title: '纲手之弟',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'earth', tags: ['输出', '爆发'],
      stats: { hp: 1.0, atk: 1.05, def: 0.95, spd: 118 },
      bio: '纲手的弟弟、初代火影千手柱间的孙子，一心梦想成为火影。纲手在他生日时把祖父的项链送给了他，可就在第二天，年仅十二岁的他便在战场上阵亡。',
      quote: '我将来一定要成为火影！',
      art: {
        type: 'human', skin: '#f2cfae', hair: 'spiky', hairColor: '#8a7360',
        eyes: 'normal', eyeColor: '#4a3a2a',
        outfit: 'jacket', outfitColor: '#4b6a3a', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#b08a5a'
      },
      skills: {
        passive: {
          name: '初代火影的项链', tags: ['增益'],
          desc: '佩戴着祖父留下的项链：生命值+8%，暴击率+8%；生命首次低于30%时燃起斗志，攻击力提升30%，持续2回合。',
          stats: { hp: 0.08, crit: 0.08 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'buff', stat: 'atk', value: 0.3, turns: 2 }] }]
        },
        s1: {
          name: '手里剑之术', tags: ['输出'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投掷手里剑攻击敌人，造成100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.0 }]
        },
        s2: {
          name: '苦无连击', tags: ['爆发', '持续'], fx: 'blade', target: 'single', cd: 3,
          desc: '握紧苦无冲上前连续突刺，造成3段共165%攻击力伤害，并有50%概率使目标流血2回合（每回合20%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.55, hits: 3 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.2, chance: 0.5 }
          ]
        },
        ult: {
          name: '全力冲锋', tags: ['单体', '爆发', '控制'], fx: 'fist', target: 'single',
          desc: '为了成为火影的梦想不顾一切地冲向敌人，造成270%攻击力伤害，并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 2.7 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '千手的血脉', tags: ['治疗', '回能'],
          desc: '攻击力+10%；体内流淌着千手一族的血，每击败一名敌人恢复15%最大生命值并获得20点查克拉。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'heal', pct: 0.15 }, { type: 'chakra', value: 20 }] }]
        }
      }
    },

    {
      id: 'shizune', name: '静音', form: '', en: 'Shizune', title: '纲手的助手',
      faction: 'konoha', rarity: 'SR', role: 'heal', element: 'water', tags: ['治疗', '持续', '减益'],
      stats: { hp: 1.0, atk: 1.02, def: 0.98, spd: 110 },
      bio: '加藤断的侄女、纲手的弟子兼助手，多年来陪伴纲手四处漂泊，总是抱着小猪豚豚。她是优秀的医疗忍者，同时擅长毒术与暗器，纲手就任火影后成为她的左右手。',
      quote: '纲手大人，请您振作起来！',
      art: {
        type: 'human', skin: '#f3d6bf', hair: 'bob', hairColor: '#1c1c24',
        eyes: 'normal', eyeColor: '#2a2a2a',
        outfit: 'kimono', outfitColor: '#2b2b38', accentColor: '#e6e6e6',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#7cb342'
      },
      skills: {
        passive: {
          name: '毒术精通', tags: ['持续', '增益'],
          desc: '精通各类毒药与解药：攻击力+5%，生命值+5%；攻击命中后有30%概率使目标中毒2回合（每回合20%攻击力）。',
          stats: { atk: 0.05, hp: 0.05 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'status', status: 'poison', turns: 2, value: 0.2, to: 'target' }] }]
        },
        s1: {
          name: '暗器·毒针', tags: ['消耗'], fx: 'poison', target: 'single', cd: 0,
          desc: '从袖中机关射出淬毒的千本，造成2段共100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.5, hits: 2 }]
        },
        s2: {
          name: '毒雾之术', tags: ['群攻', '持续', '减益'], fx: 'poison', target: 'all', cd: 3,
          desc: '口中喷出大范围毒雾笼罩敌阵，对全体敌人造成70%攻击力伤害，使其中毒2回合（每回合25%攻击力），并使其攻击力降低10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.7 },
            { type: 'status', status: 'poison', turns: 2, value: 0.25 },
            { type: 'debuff', stat: 'atk', value: 0.1, turns: 2 }
          ]
        },
        ult: {
          name: '医疗忍术', tags: ['治疗', '净化'], fx: 'heal', target: 'ally_all',
          desc: '施展精湛的医疗忍术为全体友方疗伤，恢复相当于自身140%攻击力的生命值，并清除所有减益与异常状态。',
          effects: [
            { type: 'heal', mult: 1.4 },
            { type: 'cleanse', to: 'ally_all' }
          ]
        },
        awaken: {
          name: '纲手的真传', tags: ['治疗', '增益'],
          desc: '攻击力+10%，生命值+5%；继承了纲手的医术，每回合开始时为生命比例最低的友方恢复4%最大生命值。',
          stats: { atk: 0.1, hp: 0.05 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.04, to: 'ally_lowest' }] }]
        }
      }
    },

    /* ============================ “根”与顾问团 ============================ */
    {
      id: 'danzo', name: '志村团藏', form: '', en: 'Shimura Danzo', title: '忍之暗',
      faction: 'konoha', rarity: 'SSR', role: 'atk', element: 'wind', tags: ['输出', '控制', '封印'],
      stats: { hp: 1.02, atk: 1.1, def: 0.92, spd: 108 },
      bio: '暗部培训部门“根”的首领，自诩在黑暗中守护村子的“忍之暗”。他在右臂移植了柱间细胞与十只写轮眼，被绷带遮住的右眼则是宇智波止水的万花筒写轮眼。五影会谈期间他与佐助死斗，最终发动里四象封印自尽。',
      quote: '为了木叶，我甘愿背负黑暗。',
      art: {
        type: 'human', skin: '#e6c7a8', hair: 'short', hairColor: '#2b2b2b',
        eyes: 'normal', eyeColor: '#2b2b2b',
        outfit: 'robe', outfitColor: '#d9d6cc', accentColor: '#2b2b2b',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: ['eye_bandage', 'chin_x', 'wrinkles'], mask: 'none', hat: 'none', accessory: 'staff', aura: '#3b3b5a'
      },
      skills: {
        passive: {
          name: '伊邪那岐', tags: ['治疗', '净化'],
          desc: '以右臂的写轮眼发动伊邪那岐，把致命伤化为幻象：攻击力+8%，暴击率+8%；生命首次低于30%时立即恢复40%最大生命值，并清除自身所有减益与异常状态。',
          stats: { atk: 0.08, crit: 0.08 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'heal', pct: 0.4 }, { type: 'cleanse' }] }]
        },
        s1: {
          name: '风遁·真空玉', tags: ['输出', '消耗'], fx: 'wind', target: 'single', cd: 0,
          desc: '从口中连续吐出压缩的真空弹，造成3段共114%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.38, hits: 3 }]
        },
        s2: {
          name: '风遁·真空大玉', tags: ['群攻', '减益'], fx: 'wind', target: 'all', cd: 3,
          desc: '吐出巨大的真空风弹横扫敌阵，对全体敌人造成100%攻击力伤害，并使其防御力降低15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '别天神', tags: ['控制', '单体', '减益'], fx: 'eye', target: 'highest_atk',
          desc: '以止水的万花筒写轮眼发动别天神，操纵攻击力最高的敌人的意志，造成300%攻击力伤害，使其眩晕1回合，并使其攻击力降低20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 3.0 },
            { type: 'status', status: 'stun', turns: 1 },
            { type: 'debuff', stat: 'atk', value: 0.2, turns: 2 }
          ]
        },
        awaken: {
          name: '里四象封印', tags: ['封印', '群攻'],
          desc: '攻击力+12%；阵亡时发动刻在身上的里四象封印，把敌人一同卷入封印，对全体敌人造成160%攻击力伤害，并有50%概率使其束缚1回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'dmg', mult: 1.6, to: 'enemy_all' },
            { type: 'status', status: 'bind', turns: 1, chance: 0.5, to: 'enemy_all' }
          ] }]
        }
      }
    },

    {
      id: 'homura', name: '水户门炎', form: '', en: 'Mitokado Homura', title: '木叶顾问',
      faction: 'konoha', rarity: 'R', role: 'sup', element: 'fire', tags: ['增益', '护盾'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 96 },
      bio: '木叶的高层顾问，与转寝小春、猿飞日斩同为二代目火影千手扉间的弟子。他戴着眼镜、作风保守，常与小春一起对火影的决策提出意见。',
      quote: '为了村子，必须做出取舍。',
      art: {
        type: 'human', skin: '#e8c8a8', hair: 'slick_back', hairColor: '#bdbdbd',
        eyes: 'normal', eyeColor: '#3a3a3a',
        outfit: 'robe', outfitColor: '#3c4a5c', accentColor: '#d9d9d9',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: ['glasses', 'wrinkles'], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff7b00'
      },
      skills: {
        passive: {
          name: '木叶顾问', tags: ['增益'],
          desc: '以多年的经验辅佐历代火影：生命值+8%，防御力+8%；战斗开始时使全体友方防御力提升12%，持续2回合。',
          stats: { hp: 0.08, def: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'def', value: 0.12, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '火遁·炎弹', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 0,
          desc: '口中喷出炎弹，造成100%攻击力伤害，并有30%概率使目标灼烧2回合（每回合20%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'burn', turns: 2, value: 0.2, chance: 0.3 }
          ]
        },
        s2: {
          name: '顾问的进言', tags: ['增益'], fx: 'yang', target: 'ally_all', cd: 3,
          desc: '冷静地为同伴分析战局，使全体友方攻击力提升20%，持续2回合。',
          effects: [{ type: 'buff', stat: 'atk', value: 0.2, turns: 2 }]
        },
        ult: {
          name: '火遁·豪火球之术', tags: ['群攻', '持续'], fx: 'fire', target: 'all',
          desc: '喷出巨大的火球吞没敌阵，对全体敌人造成130%攻击力伤害，并使其灼烧2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'status', status: 'burn', turns: 2, value: 0.25 }
          ]
        },
        awaken: {
          name: '扉间的教诲', tags: ['护盾', '增益'],
          desc: '攻击力+10%；牢记二代目火影的教诲，释放必杀技后为全体友方提供相当于自身攻击力50%的护盾，持续2回合。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'shield', mult: 0.5, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'koharu', name: '转寝小春', form: '', en: 'Utatane Koharu', title: '木叶长老',
      faction: 'konoha', rarity: 'R', role: 'ctrl', element: 'earth', tags: ['控制', '护盾'],
      stats: { hp: 1.02, atk: 0.98, def: 1.0, spd: 94 },
      bio: '木叶的高层顾问，与水户门炎、猿飞日斩同为千手扉间的弟子。她把灰白的头发盘成发髻，在村子的重大事务上与门炎一同向火影进言。',
      quote: '火影的决断，关乎全村的存亡。',
      art: {
        type: 'human', skin: '#e9cbb0', hair: 'buns', hairColor: '#bdbdbd',
        eyes: 'closed', eyeColor: '#3a3a3a',
        outfit: 'kimono', outfitColor: '#5a6b5a', accentColor: '#c9b28a',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: ['wrinkles'], mask: 'none', hat: 'none', accessory: 'none', aura: '#b08a5a'
      },
      skills: {
        passive: {
          name: '长老的威严', tags: ['减益', '增益'],
          desc: '生命值+8%，伤害减免+5%；战斗开始时以威严震慑敌阵，使全体敌人攻击力降低10%，持续2回合。',
          stats: { hp: 0.08, dr: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'debuff', stat: 'atk', value: 0.1, turns: 2, to: 'enemy_all' }] }]
        },
        s1: {
          name: '土遁·心中斩首之术', tags: ['消耗', '控制'], fx: 'earth', target: 'single', cd: 0,
          desc: '从地下抓住敌人的脚将其拖入土中，造成100%攻击力伤害，并有25%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.25 }
          ]
        },
        s2: {
          name: '土遁·土流壁', tags: ['护盾'], fx: 'shield', target: 'ally_all', cd: 3,
          desc: '拔地而起的土墙挡在友方身前，为全体友方提供相当于自身攻击力70%的护盾，持续2回合。',
          effects: [{ type: 'shield', mult: 0.7, turns: 2 }]
        },
        ult: {
          name: '土遁·土龙弹之术', tags: ['群攻', '控制'], fx: 'earth', target: 'all',
          desc: '以泥土塑成土龙喷出泥弹轰击敌阵，对全体敌人造成130%攻击力伤害，并有40%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 }
          ]
        },
        awaken: {
          name: '顾问的决断', tags: ['减益', '增益'],
          desc: '攻击力+10%，防御力+5%；释放必杀技后挫败敌人的气势，使全体敌人减少15点查克拉。',
          stats: { atk: 0.1, def: 0.05 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'drain', value: 15, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'fu_yamanaka', name: '山中风', form: '', en: 'Yamanaka Fu', title: '根之忍者',
      faction: 'konoha', rarity: 'R', role: 'ctrl', element: 'yin', tags: ['控制', '减益'],
      stats: { hp: 0.98, atk: 1.02, def: 1.0, spd: 112 },
      bio: '“根”的成员、团藏的贴身护卫之一，出身山中一族，擅长侵入他人精神的秘术。五影会谈期间他随团藏前往铁之国，后来在与宇智波带土的交战中丧命。',
      quote: '一切都是为了团藏大人。',
      art: {
        type: 'human', skin: '#f1d4bb', hair: 'long_bang', hairColor: '#7a2e2a',
        eyes: 'normal', eyeColor: '#9aa8b2',
        outfit: 'anbu', outfitColor: '#2b2f3a', accentColor: '#7f8c9a',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'tanto', aura: '#ffeb3b'
      },
      skills: {
        passive: {
          name: '根之暗部', tags: ['闪避', '增益'],
          desc: '“根”训练出的冷酷忍者：闪避率+8%，暴击率+8%；战斗开始时速度提升15%，持续2回合。',
          stats: { dodge: 0.08, crit: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'spd', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '短刀术', tags: ['输出', '减益'], fx: 'blade', target: 'single', cd: 0,
          desc: '以短刀刺击敌人，造成100%攻击力伤害，并使目标防御力降低10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'def', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '心转身之术', tags: ['控制', '减益'], fx: 'mind', target: 'single', cd: 3,
          desc: '把精神潜入敌人体内夺取其行动，造成60%攻击力伤害，有50%概率使其眩晕1回合，并使其攻击力降低15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.6 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 },
            { type: 'debuff', stat: 'atk', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '心乱身之术', tags: ['群攻', '控制'], fx: 'mind', target: 'all',
          desc: '同时侵入多名敌人的精神使其自相残杀，对全体敌人造成130%攻击力伤害，并有35%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.35 }
          ]
        },
        awaken: {
          name: '山中秘传', tags: ['减益', '增益'],
          desc: '攻击力+10%；攻击命中后有20%概率扰乱目标的精神，使其减少10点查克拉。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'drain', value: 10, to: 'target' }] }]
        }
      }
    },

    {
      id: 'torune', name: '油女取根', form: '', en: 'Aburame Torune', title: '根之虫使',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'none', tags: ['持续', '输出'],
      stats: { hp: 1.0, atk: 1.05, def: 0.95, spd: 104 },
      bio: '“根”的成员、团藏的贴身护卫，出身油女一族。他体内寄宿着肉眼难以看见的纳米级毒虫，被他触碰的人细胞会遭到侵蚀，因此平时全身包裹在防护服中。',
      quote: '被我碰到的人，没有活路。',
      art: {
        type: 'human', skin: '#d9c2ae', hair: 'hood', hairColor: '#3a3a3a',
        eyes: 'dark', eyeColor: '#2b2b2b',
        outfit: 'bodysuit', outfitColor: '#3b3f4a', accentColor: '#7f8c9a',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: ['sunglasses'], mask: 'lower', hat: 'none', accessory: 'none', aura: '#7cb342'
      },
      skills: {
        passive: {
          name: '毒虫之体', tags: ['持续', '反击'],
          desc: '毒虫寄宿于全身：生命值+8%；受到攻击时有40%概率使攻击者中毒2回合（每回合25%攻击力）。',
          stats: { hp: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.4, effects: [{ type: 'status', status: 'poison', turns: 2, value: 0.25, to: 'attacker' }] }]
        },
        s1: {
          name: '秘术·毒虫', tags: ['输出', '持续'], fx: 'insect', target: 'single', cd: 0,
          desc: '放出纳米级毒虫侵入敌人体内，造成100%攻击力伤害，并有30%概率使其中毒2回合（每回合20%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'poison', turns: 2, value: 0.2, chance: 0.3 }
          ]
        },
        s2: {
          name: '毒虫·散布', tags: ['群攻', '持续'], fx: 'insect', target: 'all', cd: 3,
          desc: '将毒虫散布至整个战场，对全体敌人造成70%攻击力伤害，并使其中毒2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.7 },
            { type: 'status', status: 'poison', turns: 2, value: 0.25 }
          ]
        },
        ult: {
          name: '毒虫之手', tags: ['单体', '持续', '减益'], fx: 'poison', target: 'single',
          desc: '摘下手套直接触碰敌人，让毒虫侵蚀其全身细胞，造成260%攻击力伤害，使其中毒3回合（每回合40%攻击力），并使其防御力降低20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 2.6 },
            { type: 'status', status: 'poison', turns: 3, value: 0.4 },
            { type: 'debuff', stat: 'def', value: 0.2, turns: 2 }
          ]
        },
        awaken: {
          name: '纳米毒虫', tags: ['减益', '增益'],
          desc: '攻击力+10%；攻击命中后有25%概率令毒虫侵蚀目标细胞，使其防御力降低15%，持续2回合。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_attack', chance: 0.25, effects: [{ type: 'debuff', stat: 'def', value: 0.15, turns: 2, to: 'target' }] }]
        }
      }
    },

    {
      id: 'shin', name: '信', form: '', en: 'Shin', title: '佐井之兄',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'yin', tags: ['群攻', '输出'],
      stats: { hp: 1.0, atk: 1.0, def: 0.98, spd: 108 },
      bio: '“根”的成员，与佐井以兄弟相称，因病早逝。第四次忍界大战中他被药师兜以秽土转生唤醒，在战场上与已经结交了新同伴的佐井重逢。',
      quote: '佐井，你终于有了真正的同伴。',
      art: {
        type: 'human', skin: '#f0dccb', hair: 'short', hairColor: '#d9d9d9',
        eyes: 'normal', eyeColor: '#3a3a3a',
        outfit: 'shirt', outfitColor: '#2b2b33', accentColor: '#9e9e9e',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: ['stitches'], mask: 'none', hat: 'none', accessory: 'scroll', aura: '#757575'
      },
      skills: {
        passive: {
          name: '兄弟之绊', tags: ['增益'],
          desc: '生命值+8%；战斗开始时激励随机一名友方，使其攻击力提升15%，持续2回合。',
          stats: { hp: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'atk', value: 0.15, turns: 2, to: 'ally_random' }] }]
        },
        s1: {
          name: '暗杀术', tags: ['输出', '穿透'], fx: 'blade', target: 'single', cd: 0,
          desc: '“根”所传授的暗杀技巧，造成100%攻击力伤害，无视目标15%防御。',
          effects: [{ type: 'dmg', mult: 1.0, pierce: 0.15 }]
        },
        s2: {
          name: '起爆符', tags: ['群攻', '消耗'], fx: 'explosion', target: 'random', count: 3, cd: 3,
          desc: '向敌阵撒出数张起爆符，对随机3名敌人各造成55%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.55 }]
        },
        ult: {
          name: '起爆符·连环爆破', tags: ['群攻', '持续'], fx: 'explosion', target: 'all',
          desc: '引爆布满战场的起爆符，对全体敌人造成135%攻击力伤害，并使其灼烧2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.35 },
            { type: 'status', status: 'burn', turns: 2, value: 0.25 }
          ]
        },
        awaken: {
          name: '画中的笑容', tags: ['治疗', '净化'],
          desc: '攻击力+10%；阵亡时留下画中兄弟二人的笑容，为全体友方恢复12%最大生命值，并清除其所有减益与异常状态。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'heal', pct: 0.12, to: 'ally_all' },
            { type: 'cleanse', to: 'ally_all' }
          ] }]
        }
      }
    },

    /* ============================ 特别上忍·中忍 ============================ */
    {
      id: 'anko', name: '御手洗红豆', form: '', en: 'Mitarashi Anko', title: '咒印之蛇',
      faction: 'konoha', rarity: 'SR', role: 'atk', element: 'fire', tags: ['控制', '持续', '爆发'],
      stats: { hp: 0.98, atk: 1.1, def: 0.92, spd: 120 },
      bio: '木叶的特别上忍，曾是大蛇丸的弟子，脖子上留有大蛇丸种下的天之咒印。她担任中忍考试第二场“死亡森林”的考官，擅长蛇系忍术与禁术。',
      quote: '在死亡森林里，可别丢了小命哦。',
      art: {
        type: 'human', skin: '#f3d3b5', hair: 'high_ponytail', hairColor: '#3b2a4a',
        eyes: 'normal', eyeColor: '#a07850',
        outfit: 'coat', outfitColor: '#c9a26b', accentColor: '#2b2b2b',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['curse_mark'], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#8a63d2'
      },
      skills: {
        passive: {
          name: '天之咒印', tags: ['增益', '爆发'],
          desc: '攻击力+8%；生命首次低于30%时咒印之力涌出，恢复15%最大生命值，并使攻击力提升30%，持续3回合。',
          stats: { atk: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.15 },
            { type: 'buff', stat: 'atk', value: 0.3, turns: 3 }
          ] }]
        },
        s1: {
          name: '潜影蛇手', tags: ['输出', '控制'], fx: 'snake', target: 'single', cd: 0,
          desc: '从袖中射出数条毒蛇缠咬敌人，造成105%攻击力伤害，并有25%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.25 }
          ]
        },
        s2: {
          name: '潜影多蛇手', tags: ['群攻', '持续'], fx: 'snake', target: 'all', cd: 3,
          desc: '双臂射出大量毒蛇扑向敌阵，对全体敌人造成80%攻击力伤害，并使其中毒2回合（每回合20%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'status', status: 'poison', turns: 2, value: 0.2 }
          ]
        },
        ult: {
          name: '双蛇相杀之术', tags: ['单体', '爆发', '持续'], fx: 'snake', target: 'highest_atk',
          desc: '结印发动禁术，让毒蛇死死咬住攻击力最高的敌人，造成300%攻击力伤害，并使其中毒3回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 3.0 },
            { type: 'status', status: 'poison', turns: 3, value: 0.4 }
          ]
        },
        awaken: {
          name: '通灵之术·巨蛇', tags: ['群攻', '持续'],
          desc: '攻击力+12%；释放必杀技后通灵出巨蛇向敌阵喷吐毒液，使全体敌人中毒2回合（每回合25%攻击力）。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'poison', turns: 2, value: 0.25, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'ibiki', name: '森乃伊比喜', form: '', en: 'Morino Ibiki', title: '拷问部队长',
      faction: 'konoha', rarity: 'R', role: 'ctrl', element: 'yin', tags: ['控制', '减益'],
      stats: { hp: 1.08, atk: 0.95, def: 1.0, spd: 96 },
      bio: '木叶暗部拷问与审讯部队的队长，头上布满了刑讯留下的伤疤。他担任中忍考试第一场笔试的考官，擅长从心理上击溃对手。',
      quote: '你的心理防线，撑得了多久？',
      art: {
        type: 'human', skin: '#e3c09c', hair: 'bald', hairColor: '#2b2b2b',
        eyes: 'normal', eyeColor: '#2b2b2b',
        outfit: 'coat', outfitColor: '#1f1f24', accentColor: '#3a3f4a',
        headband: 'konoha', headbandSlash: false, headbandPos: 'bandana',
        marks: ['cheek_scar', 'stitches'], mask: 'none', hat: 'bandana_cap', accessory: 'none', aura: '#7e57c2'
      },
      skills: {
        passive: {
          name: '拷问专家', tags: ['减益', '反击'],
          desc: '生命值+8%，防御力+5%；受到攻击时有30%概率以压迫感震慑攻击者，使其攻击力降低15%，持续2回合。',
          stats: { hp: 0.08, def: 0.05 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'debuff', stat: 'atk', value: 0.15, turns: 2, to: 'attacker' }] }]
        },
        s1: {
          name: '体术·擒拿', tags: ['输出', '减益'], fx: 'fist', target: 'single', cd: 0,
          desc: '擒住敌人施以重击，造成100%攻击力伤害，并使目标防御力降低10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'def', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '拷问·幻术', tags: ['控制', '减益'], fx: 'genjutsu', target: 'single', cd: 3,
          desc: '让敌人在幻术中体验被拷问的恐惧，造成50%攻击力伤害，有50%概率使其眩晕1回合，并使其攻击力降低25%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.5 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 },
            { type: 'debuff', stat: 'atk', value: 0.25, turns: 2 }
          ]
        },
        ult: {
          name: '幻术·恐怖拷问', tags: ['群攻', '控制', '减益'], fx: 'genjutsu', target: 'all',
          desc: '以极致的恐怖笼罩敌阵，对全体敌人造成120%攻击力伤害，使其攻击力降低20%，持续2回合，并有30%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'debuff', stat: 'atk', value: 0.2, turns: 2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        awaken: {
          name: '第十题', tags: ['减益', '控制'],
          desc: '攻击力+10%；战斗开始时抛出令人动摇的“第十题”，使全体敌人速度降低15%，持续2回合。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'debuff', stat: 'spd', value: 0.15, turns: 2, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'genma', name: '不知火玄间', form: '', en: 'Shiranui Genma', title: '千本使',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'none', tags: ['输出', '穿透'],
      stats: { hp: 0.95, atk: 1.08, def: 0.95, spd: 122 },
      bio: '木叶的特别上忍，嘴里总是叼着一根千本，性格随性而冷静。他担任了中忍考试正式比赛的裁判，木叶崩溃时与入侵的砂隐、音隐忍者展开激战。',
      quote: '比赛规则由我说了算。',
      art: {
        type: 'human', skin: '#efcfb2', hair: 'shaggy', hairColor: '#5a4030',
        eyes: 'normal', eyeColor: '#3a2a1e',
        outfit: 'flak', outfitColor: '#5d7a3e', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'bandana',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#90a4ae'
      },
      skills: {
        passive: {
          name: '冷静的裁判', tags: ['增益', '闪避'],
          desc: '处变不惊的老练上忍：暴击率+10%，闪避率+8%。',
          stats: { crit: 0.1, dodge: 0.08 }
        },
        s1: {
          name: '千本', tags: ['输出', '持续'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '连续吐出口中的千本射向敌人，造成3段共105%攻击力伤害，并有30%概率使目标流血2回合（每回合20%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.35, hits: 3 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.2, chance: 0.3 }
          ]
        },
        s2: {
          name: '千本连射', tags: ['群攻', '消耗'], fx: 'shuriken', target: 'random', count: 3, cd: 3,
          desc: '甩手射出大量千本，对随机3名敌人各造成60%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.6 }]
        },
        ult: {
          name: '千本·暴雨', tags: ['群攻', '穿透', '持续'], fx: 'shuriken', target: 'random', count: 4,
          desc: '千本如暴雨般倾泻而下，对随机4名敌人各造成65%攻击力伤害，无视目标30%防御，并使其流血2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.65, pierce: 0.3 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.25 }
          ]
        },
        awaken: {
          name: '特别上忍', tags: ['增益', '回能'],
          desc: '攻击力+10%；每击败一名敌人获得30点查克拉。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'chakra', value: 30 }] }]
        }
      }
    },

    {
      id: 'raido', name: '并足雷同', form: '', en: 'Namiashi Raido', title: '沉稳的剑士',
      faction: 'konoha', rarity: 'R', role: 'tank', element: 'none', tags: ['嘲讽', '反击', '护盾'],
      stats: { hp: 1.08, atk: 0.95, def: 1.0, spd: 98 },
      bio: '木叶的特别上忍，左脸上有一大片伤疤，是一位沉稳可靠的老练忍者。他擅长剑术，常与不知火玄间等同伴一起执行任务。',
      quote: '有我在，休想越过这里。',
      art: {
        type: 'human', skin: '#eac8a6', hair: 'short', hairColor: '#3a2a20',
        eyes: 'normal', eyeColor: '#2b2b2b',
        outfit: 'flak', outfitColor: '#5d7a3e', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['cheek_scar'], mask: 'none', hat: 'none', accessory: 'tanto', aura: '#455a64'
      },
      skills: {
        passive: {
          name: '沉稳可靠', tags: ['护盾', '增益'],
          desc: '生命值+10%，防御力+8%；生命首次低于30%时获得25%最大生命值的护盾，持续2回合。',
          stats: { hp: 0.1, def: 0.08 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'shield', pct: 0.25, turns: 2 }] }]
        },
        s1: {
          name: '短刀术', tags: ['输出', '护盾'], fx: 'blade', target: 'single', cd: 0,
          desc: '以短刀斩击敌人，造成100%攻击力伤害，并获得相当于自身攻击力15%的护盾。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'shield', mult: 0.15, to: 'self' }
          ]
        },
        s2: {
          name: '护卫之刃', tags: ['嘲讽', '反击'], fx: 'shield', target: 'self', cd: 3,
          desc: '横刀挡在同伴身前，嘲讽敌人2回合（敌方单体技能将指向自己），并在2回合内受击时反击，造成60%攻击力伤害。',
          effects: [
            { type: 'taunt', turns: 2, to: 'self' },
            { type: 'counter', mult: 0.6, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '黑刀·暗', tags: ['单体', '持续', '护盾'], fx: 'blade', target: 'single',
          desc: '拔出漆黑的刀刃斩向敌人，造成260%攻击力伤害，使其流血2回合（每回合30%攻击力），并获得相当于自身攻击力60%的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 2.6 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.3 },
            { type: 'shield', mult: 0.6, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '护卫的觉悟', tags: ['护盾', '增益'],
          desc: '攻击力+8%，防御力+10%；每回合开始时获得相当于自身攻击力25%的护盾，持续1回合。',
          stats: { atk: 0.08, def: 0.1 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'shield', mult: 0.25, turns: 1 }] }]
        }
      }
    },

    {
      id: 'aoba', name: '山城青叶', form: '', en: 'Yamashiro Aoba', title: '乌鸦使',
      faction: 'konoha', rarity: 'R', role: 'ctrl', element: 'yin', tags: ['控制', '减益', '回能'],
      stats: { hp: 0.98, atk: 1.02, def: 1.0, spd: 110 },
      bio: '木叶的特别上忍，总戴着一副墨镜，擅长以乌鸦为媒介的秘术。第四次忍界大战中干柿鬼鲛被凯击败俘虏后，他曾以秘术潜入鬼鲛的意识读取情报。',
      quote: '你的情报，我就收下了。',
      art: {
        type: 'human', skin: '#efcfb2', hair: 'spiky_up', hairColor: '#2b2b2b',
        eyes: 'normal', eyeColor: '#2b2b2b',
        outfit: 'flak', outfitColor: '#5d7a3e', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['sunglasses'], mask: 'none', hat: 'none', accessory: 'none', aura: '#424242'
      },
      skills: {
        passive: {
          name: '情报专家', tags: ['回能', '减益'],
          desc: '战斗开始时获得20点查克拉，并看穿随机一名敌人的破绽，使其防御力降低15%，持续2回合。',
          triggers: [{ on: 'battle_start', effects: [
            { type: 'chakra', value: 20 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2, to: 'enemy_random' }
          ] }]
        },
        s1: {
          name: '苦无术', tags: ['输出'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投掷苦无攻击敌人，造成105%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.05 }]
        },
        s2: {
          name: '乌鸦分身之术', tags: ['群攻', '减益'], fx: 'clone', target: 'all', cd: 3,
          desc: '身体化为成群的乌鸦扑向敌阵，对全体敌人造成70%攻击力伤害，并使其速度降低20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.7 },
            { type: 'debuff', stat: 'spd', value: 0.2, turns: 2 }
          ]
        },
        ult: {
          name: '秘术·心转身', tags: ['单体', '控制', '减益'], fx: 'mind', target: 'highest_atk',
          desc: '潜入攻击力最高的敌人的意识读取情报，造成260%攻击力伤害，减少其40点查克拉，并驱散其所有增益与护盾。',
          effects: [
            { type: 'dmg', mult: 2.6 },
            { type: 'drain', value: 40 },
            { type: 'dispel' }
          ]
        },
        awaken: {
          name: '乌鸦情报网', tags: ['回能', '增益'],
          desc: '攻击力+10%；释放必杀技后把读取到的情报共享给同伴，使全体友方获得15点查克拉。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'chakra', value: 15, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'hayate', name: '月光疾风', form: '', en: 'Gekko Hayate', title: '病弱剑士',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'none', tags: ['输出', '爆发', '斩杀'],
      stats: { hp: 0.92, atk: 1.12, def: 0.95, spd: 120 },
      bio: '木叶的特别上忍、剑术高手，体弱多病而时常咳嗽。他担任中忍考试预选赛的考官，后因察觉砂隐与音隐的阴谋，被砂隐上忍马基杀害。',
      quote: '咳咳……比赛，现在开始。',
      art: {
        type: 'human', skin: '#efd6c0', hair: 'short', hairColor: '#3b2f2a',
        eyes: 'normal', eyeColor: '#2b2b2b',
        outfit: 'flak', outfitColor: '#5d7a3e', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'bandana',
        marks: [], mask: 'none', hat: 'none', accessory: 'sword', aura: '#cfd8dc'
      },
      skills: {
        passive: {
          name: '病弱之身', tags: ['爆发'],
          desc: '虽然体弱多病，剑术却出神入化：暴击率+15%，暴击伤害+20%，生命值-5%。',
          stats: { crit: 0.15, critDmg: 0.2, hp: -0.05 }
        },
        s1: {
          name: '木叶流剑术', tags: ['输出', '持续'], fx: 'blade', target: 'single', cd: 0,
          desc: '以木叶流剑术斩击敌人，造成105%攻击力伤害，并有30%概率使目标流血2回合（每回合20%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.2, chance: 0.3 }
          ]
        },
        s2: {
          name: '影分身之术', tags: ['增益', '闪避'], fx: 'clone', target: 'self', cd: 3,
          desc: '分出影分身扰乱敌人视线，使自身攻击力提升25%、闪避率提升15%，持续2回合。',
          effects: [
            { type: 'buff', stat: 'atk', value: 0.25, turns: 2 },
            { type: 'buff', stat: 'dodge', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '木叶流·三日月之舞', tags: ['单体', '爆发', '斩杀'], fx: 'blade', target: 'single',
          desc: '与两个影分身从三个方向同时斩击，造成3段共285%攻击力伤害，生命低于30%的目标额外受到100%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 0.95, hits: 3 },
            { type: 'execute', threshold: 0.3, mult: 1.0 }
          ]
        },
        awaken: {
          name: '剑士的执念', tags: ['回能', '增益'],
          desc: '攻击力+10%；每击败一名敌人获得40点查克拉。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'chakra', value: 40 }] }]
        }
      }
    },

    {
      id: 'yugao', name: '卯月夕颜', form: '', en: 'Uzuki Yugao', title: '暗部剑士',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'none', tags: ['输出', '穿透', '闪避'],
      stats: { hp: 0.95, atk: 1.08, def: 0.97, spd: 122 },
      bio: '木叶暗部的剑术高手，月光疾风的恋人。疾风在木叶崩溃前夕遇害后，她在疾风的墓前立誓要守护他所守护的村子。',
      quote: '疾风，我会替你守护这个村子。',
      art: {
        type: 'human', skin: '#f3dcc8', hair: 'long_straight', hairColor: '#9b7fc4',
        eyes: 'normal', eyeColor: '#5a3a6a',
        outfit: 'anbu', outfitColor: '#d6d6d6', accentColor: '#2b2b2b',
        headband: 'none', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'anbu', hat: 'none', accessory: 'sword', aura: '#b39ddb'
      },
      skills: {
        passive: {
          name: '暗部的身手', tags: ['闪避', '增益'],
          desc: '经过暗部严格训练的身手：闪避率+12%，暴击率+8%。',
          stats: { dodge: 0.12, crit: 0.08 }
        },
        s1: {
          name: '暗部剑术', tags: ['输出', '穿透'], fx: 'blade', target: 'single', cd: 0,
          desc: '以暗部的剑术快速斩击，造成105%攻击力伤害，无视目标15%防御。',
          effects: [{ type: 'dmg', mult: 1.05, pierce: 0.15 }]
        },
        s2: {
          name: '月之舞', tags: ['爆发', '持续'], fx: 'blade', target: 'single', cd: 3,
          desc: '在月光下翩然起舞般连斩两刀，造成2段共170%攻击力伤害，并使目标流血2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.85, hits: 2 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.25 }
          ]
        },
        ult: {
          name: '暗部·暗杀剑', tags: ['单体', '穿透', '闪避'], fx: 'shadow', target: 'back',
          desc: '潜入敌阵后方刺杀最后排的敌人，造成270%攻击力伤害，无视目标30%防御，并使自身闪避率提升30%，持续1回合。',
          effects: [
            { type: 'dmg', mult: 2.7, pierce: 0.3 },
            { type: 'buff', stat: 'dodge', value: 0.3, turns: 1, to: 'self' }
          ]
        },
        awaken: {
          name: '疾风的遗志', tags: ['增益', '爆发'],
          desc: '攻击力+10%；每当有友方阵亡时，攻击力提升30%、暴击率提升20%，持续2回合。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_ally_death', effects: [
            { type: 'buff', stat: 'atk', value: 0.3, turns: 2 },
            { type: 'buff', stat: 'crit', value: 0.2, turns: 2 }
          ] }]
        }
      }
    },

    {
      id: 'kotetsu', name: '钢子铁', form: '', en: 'Hagane Kotetsu', title: '木叶守门人',
      faction: 'konoha', rarity: 'R', role: 'tank', element: 'earth', tags: ['嘲讽', '控制', '护盾'],
      stats: { hp: 1.08, atk: 0.95, def: 1.0, spd: 96 },
      bio: '木叶的中忍，与神月出云形影不离，平时负责看守村子的大门。中忍考试时两人曾用幻术伪装成考生在考场外把关，疾风传中他挥舞着一柄大锤战斗。',
      quote: '想过这道门，先问问我的大锤！',
      art: {
        type: 'human', skin: '#eecba9', hair: 'spiky', hairColor: '#2b2b2b',
        eyes: 'normal', eyeColor: '#2b2b2b',
        outfit: 'flak', outfitColor: '#5d7a3e', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'bandana',
        marks: ['bandage_face'], mask: 'none', hat: 'none', accessory: 'staff', aura: '#b08a5a'
      },
      skills: {
        passive: {
          name: '守门人的坚守', tags: ['反击', '增益'],
          desc: '生命值+12%，防御力+8%；受到攻击时有25%概率挥锤反击，造成50%攻击力伤害。',
          stats: { hp: 0.12, def: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'dmg', mult: 0.5, to: 'attacker' }] }]
        },
        s1: {
          name: '大锤重击', tags: ['输出', '控制'], fx: 'fist', target: 'single', cd: 0,
          desc: '抡起大锤砸向敌人，造成100%攻击力伤害，并有20%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.2 }
          ]
        },
        s2: {
          name: '大锤横扫', tags: ['群攻', '嘲讽'], fx: 'earth', target: 'all', cd: 3,
          desc: '大锤横扫一圈，对全体敌人造成70%攻击力伤害，并嘲讽敌人2回合（敌方单体技能将指向自己）。',
          effects: [
            { type: 'dmg', mult: 0.7 },
            { type: 'taunt', turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '大锤·全力粉碎', tags: ['单体', '控制', '护盾'], fx: 'fist', target: 'single',
          desc: '用尽全力砸下大锤，造成260%攻击力伤害，有50%概率使目标眩晕1回合，并获得相当于自身攻击力60%的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 2.6 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 },
            { type: 'shield', mult: 0.6, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '守门二人组', tags: ['护盾', '增益'],
          desc: '生命值+8%，攻击力+8%；生命首次低于30%时与出云默契配合，获得30%最大生命值的护盾，持续2回合。',
          stats: { hp: 0.08, atk: 0.08 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'shield', pct: 0.3, turns: 2 }] }]
        }
      }
    },

    {
      id: 'izumo', name: '神月出云', form: '', en: 'Kamizuki Izumo', title: '大门守卫',
      faction: 'konoha', rarity: 'R', role: 'ctrl', element: 'water', tags: ['控制', '减益'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 108 },
      bio: '木叶的中忍，钢子铁多年的搭档，常与他一起看守木叶的大门。他的刘海遮住了半边脸，曾以水遁·水饴拿原等忍术拖住晓的成员角都与飞段。',
      quote: '有我们守着，谁也别想闯进木叶。',
      art: {
        type: 'human', skin: '#eecba9', hair: 'long_bang', hairColor: '#3b2a1f',
        eyes: 'normal', eyeColor: '#2b2b2b',
        outfit: 'flak', outfitColor: '#5d7a3e', accentColor: '#2a3550',
        headband: 'konoha', headbandSlash: false, headbandPos: 'bandana',
        marks: [], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#3a8dff'
      },
      skills: {
        passive: {
          name: '冷静的搭档', tags: ['闪避', '减益'],
          desc: '闪避率+10%，生命值+5%；战斗开始时使随机一名敌人速度降低15%，持续2回合。',
          stats: { dodge: 0.1, hp: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'debuff', stat: 'spd', value: 0.15, turns: 2, to: 'enemy_random' }] }]
        },
        s1: {
          name: '苦无术', tags: ['输出', '减益'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投掷苦无攻击敌人，造成100%攻击力伤害，并使目标速度降低10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'spd', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '水遁·水饴拿原', tags: ['群攻', '控制', '减益'], fx: 'water', target: 'all', cd: 3,
          desc: '吐出黏稠的水饴铺满地面粘住敌人，对全体敌人造成60%攻击力伤害，使其速度降低25%，持续2回合，并有30%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.6 },
            { type: 'debuff', stat: 'spd', value: 0.25, turns: 2 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.3 }
          ]
        },
        ult: {
          name: '幻术·迷途之门', tags: ['群攻', '控制', '减益'], fx: 'genjutsu', target: 'all',
          desc: '施展曾在中忍考试中用来把关的幻术迷惑敌阵，对全体敌人造成120%攻击力伤害，使其攻击力降低15%，持续2回合，并有40%概率使其睡眠1回合。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'debuff', stat: 'atk', value: 0.15, turns: 2 },
            { type: 'status', status: 'sleep', turns: 1, chance: 0.4 }
          ]
        },
        awaken: {
          name: '多年的搭档', tags: ['减益', '增益'],
          desc: '攻击力+10%；攻击命中后有20%概率使目标速度降低15%，持续2回合。',
          stats: { atk: 0.1 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'debuff', stat: 'spd', value: 0.15, turns: 2, to: 'target' }] }]
        }
      }
    }

  ]);
})();
