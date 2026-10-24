/* js/data/summons.js — 通灵兽
 * 妙木山的蛤蟆文太与志麻仙人、龙地洞的万蛇、湿骨林的蛞蝓、猴王猿魔，以及卡卡西的忍犬帕克。
 * 仅收录《火影忍者》与《火影忍者疾风传》时期的设定与能力（不含任何博人传内容）。
 */
(function () {
  'use strict';

  NG.defineChars('summons', [

    /* ============================ 蛤蟆文太 ============================ */
    {
      id: 'gamabunta', name: '蛤蟆文太', form: '妙木山', en: 'Gamabunta', title: '蛤蟆老大',
      faction: 'summon', rarity: 'SSR', role: 'tank', element: 'water', tags: ['嘲讽', '护盾', '反击'],
      stats: { hp: 1.2, atk: 0.92, def: 0.95, spd: 92 },
      bio: '妙木山的蛤蟆首领，身躯如山，腰佩蛤蟆刀、叼着烟斗，脾气火爆却极重情义。他原是自来也的通灵兽，后来认可了鸣人，在木叶崩溃之战中与鸣人合力对抗守鹤。',
      quote: '小鬼，就让你见识老子的厉害！',
      art: {
        type: 'beast', beast: 'toad', tails: 0, bodyColor: '#8b3a2a', accentColor: '#24306a',
        eyes: 'beast', eyeColor: '#f2c230', accessory: 'kiseru', aura: '#3a8dff'
      },
      skills: {
        passive: {
          name: '妙木山首领', tags: ['嘲讽', '增益'],
          desc: '统领妙木山众蛤蟆的巨躯：生命值+12%，防御力+8%，受到的伤害-6%；战斗开始时以威压震慑敌阵，嘲讽敌方2回合（敌方的单体技能只能以文太为目标）。',
          stats: { hp: 0.12, def: 0.08, dr: 0.06 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'taunt', turns: 2 }] }]
        },
        s1: {
          name: '蛤蟆刀', tags: ['消耗', '护盾'], fx: 'blade', target: 'single', cd: 0,
          desc: '拔出腰间的蛤蟆刀横斩敌人，造成110%攻击力伤害，并以刀身护体，获得20%攻击力的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'shield', mult: 0.2, turns: 2, to: 'self' }
          ]
        },
        s2: {
          name: '水遁·铁炮玉', tags: ['单体', '嘲讽', '减益'], fx: 'water', target: 'single', cd: 3,
          desc: '鼓起腮帮喷出炮弹般的高压水弹轰击敌人，造成180%攻击力伤害，并降低其15%攻击力（持续2回合）；同时怒喝挑衅，嘲讽敌方2回合（敌方的单体技能只能以文太为目标）。',
          effects: [
            { type: 'dmg', mult: 1.8 },
            { type: 'debuff', stat: 'atk', value: 0.15, turns: 2 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '火遁·蛤蟆油炎弹', tags: ['群攻', '持续', '护盾'], fx: 'fire', target: 'all',
          desc: '喷出大量蛤蟆油，与通灵者的火遁合而为一化作滔天烈焰席卷敌阵，对全体敌人造成150%攻击力伤害，并使其灼烧2回合（每回合40%攻击力）；随后获得20%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'burn', turns: 2, value: 0.4 },
            { type: 'shield', pct: 0.2, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '合体变化之术', tags: ['反击', '治疗'],
          desc: '攻击力+10%，生命值+8%；生命值首次低于30%时与通灵者合体变化，恢复20%最大生命值，并进入反击状态2回合（受到攻击时反击80%攻击力的伤害）。',
          stats: { atk: 0.10, hp: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.2 },
            { type: 'counter', mult: 0.8, turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 志麻仙人 ============================ */
    {
      id: 'shima', name: '志麻仙人', form: '妙木山', en: 'Shima', title: '妙木山仙婆',
      faction: 'summon', rarity: 'SR', role: 'ctrl', element: 'water', tags: ['控制', '群攻', '回能'],
      stats: { hp: 0.95, atk: 1.05, def: 0.98, spd: 112 },
      bio: '妙木山的二大仙蛤蟆之一，深作仙人的妻子，性情泼辣又慈爱，总爱用虫子料理招待客人。自来也迎战佩恩时，她与深作一同融合于自来也双肩，以仙法·五右卫门与蛤蟆临唱压制敌人。',
      quote: '多吃点虫子，才有力气修行！',
      art: {
        type: 'beast', gender: 'f', beast: 'toad', tails: 0, bodyColor: '#8c9a88', accentColor: '#9c6f9a',
        eyes: 'sage', eyeColor: '#f2c230', aura: '#ff9800', brows: '#f4f2ea', wrinkles: true
      },
      skills: {
        passive: {
          name: '融合·仙术', tags: ['回能', '闪避'],
          desc: '能附在同伴肩头代为吸收自然能量：闪避率+8%；战斗开始时为全体友方注入10点仙术查克拉。',
          stats: { dodge: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 10, to: 'ally_all' }] }]
        },
        s1: {
          name: '长舌缠击', tags: ['消耗', '控制'], fx: 'beast', target: 'single', cd: 0,
          desc: '伸出长舌抽打并缠住敌人，造成105%攻击力伤害，并有25%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.25 }
          ]
        },
        s2: {
          name: '仙法·五右卫门', tags: ['群攻', '持续', '减益'], fx: 'fire', target: 'all', cd: 3,
          desc: '吐出大量蛤蟆油，与深作的风和通灵者的火遁合成灼热的油火洪流席卷敌阵，对全体敌人造成80%攻击力伤害，使其灼烧2回合（每回合30%攻击力），并降低其10%速度，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'status', status: 'burn', turns: 2, value: 0.3 },
            { type: 'debuff', stat: 'spd', value: 0.1, turns: 2 }
          ]
        },
        ult: {
          name: '仙法·魔幻·蛤蟆临唱', tags: ['控制', '群攻'], fx: 'genjutsu', target: 'all',
          desc: '与深作仙人齐声合唱施展仙术幻术，对全体敌人造成100%攻击力伤害，并有50%概率使其陷入睡眠2回合（受到伤害时醒来）。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'sleep', turns: 2, chance: 0.5 }
          ]
        },
        awaken: {
          name: '二大仙蛤蟆', tags: ['控制', '增益'],
          desc: '攻击力+10%，生命值+8%；每回合开始时有30%概率与深作对唱幻术之歌，使随机一名敌人陷入睡眠1回合（受到伤害时醒来）。',
          stats: { atk: 0.10, hp: 0.08 },
          triggers: [{ on: 'turn_start', chance: 0.3, effects: [{ type: 'status', status: 'sleep', turns: 1 }] }]
        }
      }
    },

    /* ============================ 万蛇 ============================ */
    {
      id: 'manda', name: '万蛇', form: '龙地洞', en: 'Manda', title: '龙地洞蛇王',
      faction: 'summon', rarity: 'SSR', role: 'atk', element: 'none', tags: ['输出', '持续', '闪避'],
      stats: { hp: 1.15, atk: 1.05, def: 0.88, spd: 96 },
      bio: '龙地洞的巨蛇首领、大蛇丸的通灵兽，残暴傲慢，每次应召都要索取活人献祭。三忍对决时曾与蛤蟆文太、蛞蝓大战；后被佐助以写轮眼操控，替他挡下迪达拉的自爆而死。',
      quote: '下次召唤我，准备一百个活祭品！',
      art: {
        type: 'beast', beast: 'snake', tails: 0, bodyColor: '#6a3d9a', accentColor: '#2b1440',
        eyes: 'beast', eyeColor: '#f5e04a', aura: '#9b59d0'
      },
      skills: {
        passive: {
          name: '活人祭品', tags: ['吸血', '治疗', '回能'],
          desc: '贪婪凶残的蛇王：生命值+10%，暴击率+10%，吸血+8%；击败敌人时将其吞下，恢复15%最大生命值并获得20点查克拉。',
          stats: { hp: 0.10, crit: 0.10, lifesteal: 0.08 },
          triggers: [{ on: 'on_kill', effects: [
            { type: 'heal', pct: 0.15 },
            { type: 'chakra', value: 20 }
          ] }]
        },
        s1: {
          name: '毒牙', tags: ['输出', '持续'], fx: 'snake', target: 'single', cd: 0,
          desc: '张开巨口以毒牙连咬敌人，造成2段共120%攻击力伤害，并有35%概率使其中毒2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.6, hits: 2 },
            { type: 'status', status: 'poison', turns: 2, chance: 0.35, value: 0.3 }
          ]
        },
        s2: {
          name: '巨蛇绞杀', tags: ['爆发', '控制', '吸血'], fx: 'snake', target: 'single', cd: 3,
          desc: '以巨大的蛇躯死死缠住敌人绞杀，造成190%攻击力伤害，有50%概率使其束缚1回合，并回复造成伤害20%的生命值。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.5 },
            { type: 'lifesteal', value: 0.2 }
          ]
        },
        ult: {
          name: '蛇王狂噬', tags: ['群攻', '爆发', '持续'], fx: 'snake', target: 'all',
          desc: '翻腾巨躯横扫敌阵并疯狂撕咬，对全体敌人造成2段共200%攻击力伤害，并使其中毒2回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.0, hits: 2 },
            { type: 'status', status: 'poison', turns: 2, value: 0.4 }
          ]
        },
        awaken: {
          name: '蜕皮', tags: ['闪避', '净化', '治疗'],
          desc: '攻击力+12%；生命值首次低于30%时蜕去旧皮遁入地下，解除自身的减益与异常状态，恢复20%最大生命值，并使闪避率提升40%，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'cleanse' },
            { type: 'heal', pct: 0.2 },
            { type: 'buff', stat: 'dodge', value: 0.4, turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 蛞蝓 ============================ */
    {
      id: 'katsuyu', name: '蛞蝓', form: '湿骨林', en: 'Katsuyu', title: '湿骨林之主',
      faction: 'summon', rarity: 'SSR', role: 'heal', element: 'water', tags: ['治疗', '护盾', '复活'],
      stats: { hp: 1.15, atk: 0.95, def: 1.0, spd: 96 },
      bio: '湿骨林的巨型蛞蝓、纲手的通灵兽，说话温和有礼。她能分裂成无数小蛞蝓附在同伴身上，传递纲手的查克拉为其疗伤；佩恩袭击木叶时，她分散到全村各处保护了许多村民。',
      quote: '纲手大人，请交给我吧。',
      art: {
        type: 'beast', gender: 'f', beast: 'slug', tails: 0, bodyColor: '#e8f1ff', accentColor: '#4a7fd6',
        eyes: 'beast', aura: '#69f0ae', stripes: true
      },
      skills: {
        passive: {
          name: '蛞蝓分裂体', tags: ['治疗'],
          desc: '能分裂成无数小蛞蝓附着在同伴身上：生命值+10%；每回合开始时为全体友方恢复2%最大生命值。',
          stats: { hp: 0.10 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.02, to: 'ally_all' }] }]
        },
        s1: {
          name: '舌齿粘酸', tags: ['消耗', '减益'], fx: 'poison', target: 'single', cd: 0,
          desc: '喷出能腐蚀一切的强酸，造成90%攻击力伤害，并额外造成目标3%最大生命值的真实伤害，同时降低其10%防御力，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'true_dmg', pct: 0.03 },
            { type: 'debuff', stat: 'def', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '分裂体疗伤', tags: ['治疗', '净化'], fx: 'heal', target: 'ally_all', cd: 4,
          desc: '分出小蛞蝓附着在每位同伴身上传递查克拉，为全体友方恢复相当于自身100%攻击力的生命值，并清除其所有减益与异常状态。',
          effects: [
            { type: 'heal', mult: 1.0 },
            { type: 'cleanse', to: 'ally_all' }
          ]
        },
        ult: {
          name: '蛞蝓大分裂', tags: ['治疗', '护盾'], fx: 'heal', target: 'ally_all',
          desc: '巨躯分裂成成千上万的小蛞蝓覆盖整个战场，为全体友方恢复相当于自身130%攻击力的生命值，并提供10%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'heal', mult: 1.3 },
            { type: 'shield', pct: 0.1, turns: 2 }
          ]
        },
        awaken: {
          name: '百豪传导', tags: ['复活', '增益'],
          desc: '攻击力+10%，生命值+8%；友方阵亡时，以纲手的百豪查克拉将其复活，恢复30%最大生命值（每场战斗1次）。',
          stats: { atk: 0.10, hp: 0.08 },
          triggers: [{ on: 'on_ally_death', effects: [{ type: 'revive', pct: 0.3 }] }]
        }
      }
    },

    /* ============================ 猿魔 ============================ */
    {
      id: 'enma', name: '猿魔', form: '猴王', en: 'Enma', title: '三代目的搭档',
      faction: 'summon', rarity: 'SR', role: 'tank', element: 'earth', tags: ['爆发', '护盾', '嘲讽'],
      stats: { hp: 1.05, atk: 1.1, def: 0.95, spd: 108 },
      bio: '统领猿猴一族的猴王，三代目火影猿飞日斩的通灵兽，能变化为坚不可摧的金刚如意棒。木叶崩溃之战中，他随日斩迎战大蛇丸与秽土转生的初代、二代火影。',
      quote: '猿飞，你也老了啊。',
      art: {
        type: 'beast', beast: 'monkey', tails: 0, bodyColor: '#2b2b2b', accentColor: '#f2f2f2',
        eyes: 'beast', eyeColor: '#f2c230', aura: '#e8c547', maneColor: '#eeeeea'
      },
      skills: {
        passive: {
          name: '猴王之躯', tags: ['反击', '增益'],
          desc: '身经百战的猴王：防御力+15%，暴击率+8%，受到的伤害-6%；受到攻击时有30%概率挥棒还击，对攻击者造成60%攻击力伤害。',
          stats: { def: 0.15, crit: 0.08, dr: 0.06 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'dmg', mult: 0.6 }] }]
        },
        s1: {
          name: '如意棒击', tags: ['输出', '控制'], fx: 'fist', target: 'single', cd: 0,
          desc: '挥舞伸缩自如的金刚如意棒猛击敌人，造成125%攻击力伤害，并有25%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.25 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.25 }
          ]
        },
        s2: {
          name: '金刚牢壁', tags: ['护盾', '嘲讽'], fx: 'shield', target: 'ally_all', cd: 3,
          desc: '化作坚不可摧的金刚牢壁挡在阵前，使全体友方获得50%攻击力的护盾（持续2回合），并嘲讽敌方2回合（敌方的单体技能只能以猿魔为目标）。',
          effects: [
            { type: 'shield', mult: 0.5, turns: 2 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '变化·金刚如意', tags: ['爆发', '穿透', '控制'], fx: 'fist', target: 'single',
          desc: '化身金刚如意棒暴涨至数十丈，狠狠砸向敌人，造成320%攻击力伤害（无视30%防御），并有60%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 3.2, pierce: 0.3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.6 }
          ]
        },
        awaken: {
          name: '金刚不坏', tags: ['护盾', '增益'],
          desc: '攻击力+10%，防御力+8%；生命值首次低于30%时化身金刚之躯，获得25%最大生命值的护盾，并免疫控制2回合。',
          stats: { atk: 0.10, def: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'shield', pct: 0.25, turns: 2 },
            { type: 'immune', turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 帕克 ============================ */
    {
      id: 'pakkun', name: '帕克', form: '忍犬', en: 'Pakkun', title: '八忍犬之首',
      faction: 'summon', rarity: 'R', role: 'sup', element: 'none', tags: ['减益', '闪避', '控制'],
      stats: { hp: 0.92, atk: 1.02, def: 1.0, spd: 125 },
      bio: '卡卡西通灵契约下八只忍犬的首领，是一只头戴木叶护额、身穿蓝色马甲的小巴哥犬。他说话老成、爱发牢骚，却拥有极其灵敏的嗅觉，营救我爱罗与追踪佐助时都靠他找到了目标。',
      quote: '要摸摸我的肉球吗？很软的哦。',
      art: {
        type: 'beast', beast: 'dog', tails: 0, bodyColor: '#c9a46e', accentColor: '#4a3322',
        eyes: 'beast', eyeColor: '#2a1a10', aura: '#d9b77a',
        dogStyle: 'pug', headband: 'konoha', vestColor: '#2f4f8f'
      },
      skills: {
        passive: {
          name: '灵敏嗅觉', tags: ['闪避', '增益'],
          desc: '能嗅出敌人的杀气与动向：闪避率+12%；战斗开始时提醒同伴戒备，使全体友方闪避率提升10%，持续2回合。',
          stats: { dodge: 0.12 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'dodge', value: 0.1, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '追踪撕咬', tags: ['消耗', '减益'], fx: 'beast', target: 'single', cd: 0,
          desc: '循着气味扑上去咬住敌人不放，造成95%攻击力伤害，并留下追踪标记，使其受到的伤害提高10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.95 },
            { type: 'debuff', stat: 'dr', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '土遁·追牙之术', tags: ['控制', '减益', '召唤'], fx: 'earth', target: 'single', cd: 3,
          desc: '循着气味召集忍犬同伴从地底窜出咬住敌人，造成130%攻击力伤害，有60%概率使其束缚1回合，并降低其15%闪避率，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.6 },
            { type: 'debuff', stat: 'dodge', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '通灵之术·八忍犬', tags: ['群攻', '减益', '召唤'], fx: 'summon', target: 'all',
          desc: '召集其余七只忍犬一拥而上围攻敌阵，对全体敌人造成4段共130%攻击力伤害，并使其防御力降低20%、受到的伤害提高10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.325, hits: 4 },
            { type: 'debuff', stat: 'def', value: 0.2, turns: 2 },
            { type: 'debuff', stat: 'dr', value: 0.1, turns: 2 }
          ]
        },
        awaken: {
          name: '追踪专家', tags: ['减益', '增益'],
          desc: '攻击力+10%，速度+5%；每回合开始时有50%概率嗅出随机一名敌人的破绽，使其受到的伤害提高12%，持续2回合。',
          stats: { atk: 0.10, spd: 0.05 },
          triggers: [{ on: 'turn_start', chance: 0.5, effects: [{ type: 'debuff', stat: 'dr', value: 0.12, turns: 2 }] }]
        }
      }
    }

  ]);
})();
