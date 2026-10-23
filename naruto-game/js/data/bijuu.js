/* js/data/bijuu.js — 九大尾兽与十尾
 * 一尾守鹤、二尾又旅、三尾矶抚、四尾孙悟空、五尾穆王、六尾犀犬、七尾重明、八尾牛鬼、九尾九喇嘛，以及一切尾兽的本体十尾。
 * 仅收录《火影忍者》与《火影忍者疾风传》时期的设定与能力（不含任何博人传内容）。
 */
(function () {
  'use strict';

  NG.defineChars('bijuu', [

    /* ============================ 一尾 · 守鹤 ============================ */
    {
      id: 'shukaku', name: '守鹤', form: '一尾', en: 'Shukaku', title: '砂之化身',
      faction: 'bijuu', rarity: 'SSR', role: 'tank', element: 'wind', tags: ['护盾', '嘲讽', '反击'],
      stats: { hp: 1.2, atk: 0.92, def: 0.95, spd: 82 },
      bio: '一尾狸猫，以砂构成身躯、遍布蓝色纹路的尾兽，能操纵砂与风遁。曾被封印在砂隐村的茶釜之中，后被封入我爱罗体内，宿主一旦入睡便会被它夺去意识。性情狂躁好战，在第四次忍界大战中与其他尾兽一同协助鸣人。',
      quote: '哈哈哈！老子终于出来啦！',
      art: {
        type: 'beast', beast: 'tanuki', tails: 1, bodyColor: '#c9a36b', accentColor: '#3a6bbf',
        eyes: 'beast', eyeColor: '#f2c230', aura: '#d4a85a'
      },
      skills: {
        passive: {
          name: '砂之身躯', tags: ['护盾', '增益'],
          desc: '以砂构成的身躯即便被打散也能立刻重组：生命值+10%，受到的伤害-10%；受到攻击时有30%概率获得6%最大生命值的护盾，持续2回合。',
          stats: { hp: 0.10, dr: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'shield', pct: 0.06, turns: 2 }] }]
        },
        s1: {
          name: '砂手里剑', tags: ['消耗', '护盾'], fx: 'sand', target: 'single', cd: 0,
          desc: '将砂凝成无数手里剑掷向敌人，造成2段共110%攻击力伤害，并获得15%攻击力的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.55, hits: 2 },
            { type: 'shield', mult: 0.15, turns: 2, to: 'self' }
          ]
        },
        s2: {
          name: '风遁·练空弹', tags: ['群攻', '嘲讽'], fx: 'wind', target: 'all', cd: 3,
          desc: '鼓起腹部吐出高压气弹轰击敌阵，对全体敌人造成85%攻击力伤害，并以狂妄的叫嚣嘲讽敌方2回合（敌方的单体技能只能以守鹤为目标）。',
          effects: [
            { type: 'dmg', mult: 0.85 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '一尾·尾兽玉', tags: ['群攻', '控制', '护盾'], fx: 'bijuu', target: 'all',
          desc: '张口将黑白查克拉压缩成尾兽玉轰向敌阵，对全体敌人造成150%攻击力伤害，并有50%概率使其眩晕1回合；随后以砂覆盖全身，获得20%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 },
            { type: 'shield', pct: 0.2, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '完全体守鹤', tags: ['反击', '护盾'],
          desc: '攻击力+12%，防御力+8%；生命值首次低于30%时完全显现：获得30%最大生命值的护盾（持续2回合），并进入反击状态2回合（受到攻击时反击80%攻击力的伤害）。',
          stats: { atk: 0.12, def: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'shield', pct: 0.3, turns: 2 },
            { type: 'counter', mult: 0.8, turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 二尾 · 又旅 ============================ */
    {
      id: 'matatabi', name: '又旅', form: '二尾', en: 'Matatabi', title: '蓝焰猫又',
      faction: 'bijuu', rarity: 'SSR', role: 'atk', element: 'fire', tags: ['输出', '持续', '闪避'],
      stats: { hp: 1.08, atk: 1.05, def: 0.9, spd: 100 },
      bio: '二尾猫又，全身由蓝色火焰构成，双眼一黄一绿。人柱力是云隐村的二位由木人，后被晓的飞段与角都捕获。性格温和有礼，在第四次忍界大战中与其他尾兽一同协助鸣人。',
      quote: '吼——我的名字叫做又旅。',
      art: {
        type: 'beast', beast: 'cat', tails: 2, bodyColor: '#3b7dff', accentColor: '#0d2f80',
        eyes: 'beast', aura: '#4f8dff'
      },
      skills: {
        passive: {
          name: '蓝焰之躯', tags: ['持续', '闪避'],
          desc: '燃着蓝焰的身躯如猫般灵巧：闪避率+10%，暴击率+8%；攻击命中时有30%概率使目标灼烧2回合（每回合30%攻击力）。',
          stats: { dodge: 0.10, crit: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'status', status: 'burn', turns: 2, value: 0.3 }] }]
        },
        s1: {
          name: '蓝焰猫爪', tags: ['输出', '单体'], fx: 'beast', target: 'single', cd: 0,
          desc: '挥出燃着蓝焰的利爪撕裂敌人，造成2段共120%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.6, hits: 2 }]
        },
        s2: {
          name: '鬼火', tags: ['群攻', '持续'], fx: 'fire', target: 'all', cd: 3,
          desc: '召出漫天蓝色鬼火包围敌阵，对全体敌人造成80%攻击力伤害，并使其灼烧2回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'status', status: 'burn', turns: 2, value: 0.35 }
          ]
        },
        ult: {
          name: '二尾·尾兽玉', tags: ['群攻', '爆发', '持续'], fx: 'bijuu', target: 'all',
          desc: '凝聚燃着蓝焰的尾兽玉轰向敌阵，对全体敌人造成2段共190%攻击力伤害，并使其灼烧3回合（每回合50%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.95, hits: 2 },
            { type: 'status', status: 'burn', turns: 3, value: 0.5 }
          ]
        },
        awaken: {
          name: '蓝焰怒放', tags: ['增益', '回能'],
          desc: '攻击力+12%；击败敌人时蓝焰更盛，获得30点查克拉，并使自身攻击力提升20%，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_kill', effects: [
            { type: 'chakra', value: 30 },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 三尾 · 矶抚 ============================ */
    {
      id: 'isobu', name: '矶抚', form: '三尾', en: 'Isobu', title: '雾中巨龟',
      faction: 'bijuu', rarity: 'SSR', role: 'tank', element: 'water', tags: ['护盾', '控制', '嘲讽'],
      stats: { hp: 1.15, atk: 0.82, def: 1.1, spd: 80 },
      bio: '三尾，外形似巨龟、背负尖刺甲壳的尾兽，能操纵水流与珊瑚，并制造带有幻术的浓雾。曾先后被封入野原琳与四代目水影枸橘矢仓体内，矢仓死后游荡于野外，最终被晓的迪达拉与阿飞捕获。',
      quote: '咕噜……谁也别想再封印我！',
      art: {
        type: 'beast', beast: 'turtle', tails: 3, bodyColor: '#7f9a8a', accentColor: '#c4473a',
        eyes: 'beast', eyeColor: '#ff3a2a', aura: '#4a8fd6'
      },
      skills: {
        passive: {
          name: '尖刺甲壳', tags: ['反击', '增益'],
          desc: '背负布满尖刺的坚硬甲壳：防御力+15%，受到的伤害-8%；受到攻击时有25%概率以尖刺反伤，对攻击者造成60%攻击力伤害。',
          stats: { def: 0.15, dr: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'dmg', mult: 0.6 }] }]
        },
        s1: {
          name: '甲壳回旋', tags: ['消耗', '护盾'], fx: 'water', target: 'single', cd: 0,
          desc: '缩入甲壳卷起水流高速回旋撞向敌人，造成100%攻击力伤害，并获得20%攻击力的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'shield', mult: 0.2, turns: 2, to: 'self' }
          ]
        },
        s2: {
          name: '珊瑚掌', tags: ['控制', '嘲讽'], fx: 'earth', target: 'single', cd: 3,
          desc: '以巨掌拍击敌人，使珊瑚在其身上疯狂生长，造成140%攻击力伤害，有70%概率使其束缚1回合，并嘲讽敌方2回合（敌方的单体技能只能以矶抚为目标）。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.7 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '三尾·尾兽玉', tags: ['群攻', '控制', '护盾'], fx: 'bijuu', target: 'all',
          desc: '凝聚尾兽玉轰向敌阵，对全体敌人造成150%攻击力伤害，并有40%概率使其眩晕1回合；同时以甲壳之力守护同伴，使全体友方获得12%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 },
            { type: 'shield', pct: 0.12, turns: 2, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '三尾幻雾', tags: ['控制', '增益'],
          desc: '攻击力+10%，生命值+8%；战斗开始时释放带有幻术的浓雾笼罩敌阵，全体敌人各有35%概率陷入睡眠1回合（受到伤害时醒来）。',
          stats: { atk: 0.10, hp: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'status', status: 'sleep', turns: 1, chance: 0.35, to: 'enemy_all' }] }]
        }
      }
    },

    /* ============================ 四尾 · 孙悟空 ============================ */
    {
      id: 'son_goku', name: '孙悟空', form: '四尾', en: 'Son Goku', title: '齐天大圣',
      faction: 'bijuu', rarity: 'SSR', role: 'atk', element: 'fire', tags: ['输出', '穿透', '持续'],
      stats: { hp: 1.12, atk: 1.05, def: 0.88, spd: 90 },
      bio: '四尾，红毛巨猿模样的尾兽，口中能喷吐熔岩，自称“水帘洞的齐天大圣、仙猿之王·美猴王孙悟空”。人柱力是岩隐村的老紫，后被晓的干柿鬼鲛捕获。性情高傲暴躁，极其厌恶被人类当作工具。',
      quote: '我乃齐天大圣·美猴王孙悟空！',
      art: {
        type: 'beast', beast: 'monkey', tails: 4, bodyColor: '#c62828', accentColor: '#5a1a00',
        eyes: 'beast', aura: '#ff5722'
      },
      skills: {
        passive: {
          name: '美猴王', tags: ['增益'],
          desc: '越战越勇的猴王：攻击力+10%；受到攻击时有30%概率怒气上涌，使自身攻击力提升15%，持续2回合。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'buff', stat: 'atk', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '熔岩之拳', tags: ['输出', '持续'], fx: 'fist', target: 'single', cd: 0,
          desc: '挥出裹着熔岩的重拳，造成115%攻击力伤害，并有30%概率使目标灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.15 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '熔遁·灼河流岩之术', tags: ['群攻', '穿透', '减益'], fx: 'lava', target: 'all', cd: 3,
          desc: '喷吐出如河流般奔涌的熔岩吞没敌阵，对全体敌人造成90%攻击力伤害（无视30%防御），并降低其20%防御力，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.9, pierce: 0.3 },
            { type: 'debuff', stat: 'def', value: 0.2, turns: 2 }
          ]
        },
        ult: {
          name: '四尾·尾兽玉', tags: ['群攻', '爆发', '穿透'], fx: 'bijuu', target: 'all',
          desc: '凝聚炽热如熔岩的尾兽玉轰向敌阵，对全体敌人造成2段共200%攻击力伤害（无视30%防御），并使其灼烧2回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.0, hits: 2, pierce: 0.3 },
            { type: 'status', status: 'burn', turns: 2, value: 0.4 }
          ]
        },
        awaken: {
          name: '仙猿之王', tags: ['增益', '回能'],
          desc: '攻击力+12%；生命值首次低于30%时暴怒，攻击力提升30%、暴击率提升20%，持续3回合，并获得30点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'buff', stat: 'atk', value: 0.3, turns: 3 },
            { type: 'buff', stat: 'crit', value: 0.2, turns: 3 },
            { type: 'chakra', value: 30 }
          ] }]
        }
      }
    },

    /* ============================ 五尾 · 穆王 ============================ */
    {
      id: 'kokuo', name: '穆王', form: '五尾', en: 'Kokuo', title: '蒸汽烈马',
      faction: 'bijuu', rarity: 'SSR', role: 'atk', element: 'water', tags: ['输出', '爆发', '增益'],
      stats: { hp: 1.05, atk: 1.05, def: 0.9, spd: 120 },
      bio: '五尾，海豚头、马身并生有长角的尾兽，能喷出高温蒸汽，以惊人的速度冲撞敌人。人柱力是岩隐村的汉，借其力量施展沸遁，后被晓捕获。',
      quote: '吾名穆王，不容任何人驱使。',
      art: {
        type: 'beast', beast: 'horse', tails: 5, bodyColor: '#f2efe6', accentColor: '#b0bec5',
        eyes: 'beast', aura: '#ffab91'
      },
      skills: {
        passive: {
          name: '高温蒸汽', tags: ['持续', '增益'],
          desc: '全身喷涌着高温蒸汽：受到的伤害-10%；受到攻击时有30%概率以蒸汽烫伤攻击者，使其灼烧2回合（每回合25%攻击力）。',
          stats: { dr: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'status', status: 'burn', turns: 2, value: 0.25 }] }]
        },
        s1: {
          name: '长角冲撞', tags: ['输出', '穿透'], fx: 'beast', target: 'single', cd: 0,
          desc: '以头顶的长角猛然冲撞敌人，造成120%攻击力伤害（无视20%防御）。',
          effects: [{ type: 'dmg', mult: 1.2, pierce: 0.2 }]
        },
        s2: {
          name: '沸遁·怪力无双', tags: ['爆发', '增益', '单体'], fx: 'boil', target: 'single', cd: 3,
          desc: '以沸腾的蒸汽驱动全身爆发出怪力冲撞，造成200%攻击力伤害，并使自身速度提升25%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 2.0 },
            { type: 'buff', stat: 'spd', value: 0.25, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '五尾·尾兽玉', tags: ['群攻', '爆发', '增益'], fx: 'bijuu', target: 'all',
          desc: '在高速奔袭中凝聚尾兽玉轰出，对全体敌人造成180%攻击力伤害，并使全体友方速度提升20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.8 },
            { type: 'buff', stat: 'spd', value: 0.2, turns: 2, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '蒸汽铠甲', tags: ['护盾', '增益'],
          desc: '攻击力+12%，受到的伤害-5%；战斗开始时以蒸汽包裹全身，获得15%最大生命值的护盾，并使自身速度提升30%，均持续2回合。',
          stats: { atk: 0.12, dr: 0.05 },
          triggers: [{ on: 'battle_start', effects: [
            { type: 'shield', pct: 0.15, turns: 2 },
            { type: 'buff', stat: 'spd', value: 0.3, turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 六尾 · 犀犬 ============================ */
    {
      id: 'saiken', name: '犀犬', form: '六尾', en: 'Saiken', title: '溶解液之主',
      faction: 'bijuu', rarity: 'SSR', role: 'sup', element: 'water', tags: ['减益', '持续', '净化'],
      stats: { hp: 1.15, atk: 0.9, def: 1.0, spd: 84 },
      bio: '六尾，形似巨大蛞蝓的白色尾兽，全身能分泌腐蚀一切的溶解液。人柱力是雾隐村的叛忍空，后被晓的佩恩捕获。在第四次忍界大战中与其他尾兽一同协助鸣人。',
      quote: '嘿嘿，沾上溶解液可就麻烦啦！',
      art: {
        type: 'beast', beast: 'slug', tails: 6, bodyColor: '#cfe8e6', accentColor: '#7aa7a3',
        eyes: 'beast', aura: '#b3e5fc'
      },
      skills: {
        passive: {
          name: '腐蚀黏液', tags: ['持续', '减益'],
          desc: '全身覆盖着腐蚀性的黏液：受到的伤害-10%；受到攻击时有35%概率使攻击者中毒2回合（每回合30%攻击力）。',
          stats: { dr: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.35, effects: [{ type: 'status', status: 'poison', turns: 2, value: 0.3 }] }]
        },
        s1: {
          name: '溶解液', tags: ['消耗', '减益'], fx: 'poison', target: 'single', cd: 0,
          desc: '喷出强腐蚀的溶解液，造成100%攻击力伤害，并降低目标10%防御力，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'def', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '溶解泡', tags: ['群攻', '持续', '减益'], fx: 'water', target: 'all', cd: 3,
          desc: '吐出大量裹着溶解液的泡泡飘向敌阵，对全体敌人造成70%攻击力伤害，使其中毒2回合（每回合35%攻击力），并降低其15%防御力，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.7 },
            { type: 'status', status: 'poison', turns: 2, value: 0.35 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '六尾·尾兽玉', tags: ['群攻', '减益', '持续'], fx: 'bijuu', target: 'all',
          desc: '凝聚尾兽玉轰向敌阵，对全体敌人造成150%攻击力伤害，使其受到的伤害提高15%（持续2回合），并中毒2回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'debuff', stat: 'dr', value: 0.15, turns: 2 },
            { type: 'status', status: 'poison', turns: 2, value: 0.4 }
          ]
        },
        awaken: {
          name: '黏液护体', tags: ['净化', '治疗'],
          desc: '生命值+10%，受到的伤害-5%；每回合开始时有50%概率以黏液包裹全体友方，解除其减益与异常状态，并恢复其4%最大生命值。',
          stats: { hp: 0.10, dr: 0.05 },
          triggers: [{ on: 'turn_start', chance: 0.5, effects: [
            { type: 'cleanse', to: 'ally_all' },
            { type: 'heal', pct: 0.04, to: 'ally_all' }
          ] }]
        }
      }
    },

    /* ============================ 七尾 · 重明 ============================ */
    {
      id: 'chomei', name: '重明', form: '七尾', en: 'Chomei', title: '六翼独角仙',
      faction: 'bijuu', rarity: 'SSR', role: 'ctrl', element: 'wind', tags: ['控制', '闪避', '减益'],
      stats: { hp: 1.0, atk: 1.02, def: 0.98, spd: 132 },
      bio: '七尾，长着六片翅膀与一条翅状尾巴的独角仙形尾兽，能在空中高速飞行，撒下的鳞粉可使人目眩。人柱力是泷隐村的芙，后被晓捕获。性格乐观，自称“幸运之七”。',
      quote: '幸运之七·重明，参上！',
      art: {
        type: 'beast', beast: 'beetle', tails: 7, bodyColor: '#3fb59a', accentColor: '#9ef0d8',
        eyes: 'beast', aura: '#5fd6a6'
      },
      skills: {
        passive: {
          name: '六翼飞行', tags: ['闪避', '回能'],
          desc: '展开六片薄翼在空中高速飞行：闪避率+15%；战斗开始时获得20点查克拉。',
          stats: { dodge: 0.15 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '独角突刺', tags: ['控制', '消耗'], fx: 'beast', target: 'single', cd: 0,
          desc: '从空中俯冲，以独角突刺敌人，造成110%攻击力伤害，并有30%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        s2: {
          name: '秘术·鳞粉隐之术', tags: ['群攻', '减益', '闪避'], fx: 'wind', target: 'all', cd: 3,
          desc: '振翅撒下闪光的鳞粉笼罩敌阵，对全体敌人造成70%攻击力伤害，使其造成的伤害降低15%（持续2回合）；并借鳞粉隐去身形，使自身闪避率提升20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.7 },
            { type: 'debuff', stat: 'dmg', value: 0.15, turns: 2 },
            { type: 'buff', stat: 'dodge', value: 0.2, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '七尾·尾兽玉', tags: ['群攻', '控制', '爆发'], fx: 'bijuu', target: 'all',
          desc: '于高空凝聚尾兽玉俯射而下，对全体敌人造成160%攻击力伤害，并有60%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.6 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.6 }
          ]
        },
        awaken: {
          name: '幸运之七', tags: ['增益', '回能'],
          desc: '攻击力+10%，暴击率+7%；每回合开始时有70%概率获得15点查克拉。',
          stats: { atk: 0.10, crit: 0.07 },
          triggers: [{ on: 'turn_start', chance: 0.7, effects: [{ type: 'chakra', value: 15 }] }]
        }
      }
    },

    /* ============================ 八尾 · 牛鬼 ============================ */
    {
      id: 'gyuki', name: '牛鬼', form: '八尾', en: 'Gyuki', title: '奇拉比的搭档',
      faction: 'bijuu', rarity: 'SSR', role: 'ctrl', element: 'water', tags: ['控制', '复活', '减益'],
      stats: { hp: 1.2, atk: 0.95, def: 0.92, spd: 92 },
      bio: '八尾，牛头、章鱼足的尾兽，能喷吐墨汁，以八条章鱼脚攻防一体。人柱力是云隐村的奇拉比，两者心意相通，是罕见的完美人柱力。被鹰小队擒获时，曾以一条章鱼脚作替身瞒过了晓。',
      quote: '想抓八尾？先过这八条腿！',
      art: {
        type: 'beast', beast: 'ox', tails: 8, bodyColor: '#6d5a7a', accentColor: '#3a2a44',
        hornColor: '#efe3c4', eyes: 'beast', eyeColor: '#ffd54f', aura: '#8e6ad8'
      },
      skills: {
        passive: {
          name: '八条章鱼脚', tags: ['控制', '增益'],
          desc: '以八条粗壮的章鱼脚攻防一体：生命值+12%，受到的伤害-8%；受到攻击时有20%概率以章鱼脚缠住攻击者，使其束缚1回合。',
          stats: { hp: 0.12, dr: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'status', status: 'bind', turns: 1 }] }]
        },
        s1: {
          name: '章鱼脚鞭打', tags: ['控制', '消耗'], fx: 'beast', target: 'single', cd: 0,
          desc: '甩动粗壮的章鱼脚连续抽打敌人，造成2段共110%攻击力伤害，并有30%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.55, hits: 2 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.3 }
          ]
        },
        s2: {
          name: '墨汁喷射', tags: ['群攻', '控制', '减益'], fx: 'ink', target: 'all', cd: 3,
          desc: '喷出大片漆黑的墨汁遮蔽敌人视线，对全体敌人造成75%攻击力伤害，有50%概率使其封印1回合（只能使用技能1），并降低其15%攻击力，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.75 },
            { type: 'status', status: 'silence', turns: 1, chance: 0.5 },
            { type: 'debuff', stat: 'atk', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '八尾·尾兽玉', tags: ['群攻', '爆发', '控制'], fx: 'bijuu', target: 'all',
          desc: '接连吐出四发尾兽玉轰炸敌阵，对全体敌人造成4段共180%攻击力伤害，并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.45, hits: 4 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '章鱼脚替身术', tags: ['复活', '增益'],
          desc: '攻击力+10%；首次阵亡时，留下一条章鱼脚作为替身，以30%最大生命值原地复活（每场战斗1次）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_death', effects: [{ type: 'revive', pct: 0.3, to: 'self' }] }]
        }
      }
    },

    /* ============================ 九尾 · 九喇嘛 ============================ */
    {
      id: 'kurama', name: '九喇嘛', form: '九尾', en: 'Kurama', title: '九尾妖狐',
      faction: 'bijuu', rarity: 'UR', role: 'atk', element: 'yang', tags: ['输出', '爆发', '斩杀'],
      stats: { hp: 1.15, atk: 1.1, def: 0.85, spd: 100 },
      bio: '九尾妖狐，尾兽中最强的存在，能感知他人的恶意。先后被封入漩涡水户、漩涡玖辛奈与漩涡鸣人体内，长年憎恨人类；最终被鸣人打动，在第四次忍界大战中与他并肩作战。',
      quote: '我的名字……叫九喇嘛！',
      art: {
        type: 'beast', beast: 'fox', tails: 9, bodyColor: '#ff7a1a', accentColor: '#3b1200',
        eyes: 'beast', eyeColor: '#ff2a1a', aura: '#ff5a00'
      },
      skills: {
        passive: {
          name: '恶意感知', tags: ['增益', '回能'],
          desc: '能敏锐感知他人的负面情绪与恶意：暴击率+15%，闪避率+8%；战斗开始时获得30点查克拉。',
          stats: { crit: 0.15, dodge: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 30 }] }]
        },
        s1: {
          name: '查克拉之爪', tags: ['输出', '吸血'], fx: 'beast', target: 'single', cd: 0,
          desc: '挥出缠绕着九尾查克拉的巨爪撕裂敌人，造成2段共130%攻击力伤害，并回复造成伤害15%的生命值。',
          effects: [
            { type: 'dmg', mult: 0.65, hits: 2 },
            { type: 'lifesteal', value: 0.15 }
          ]
        },
        s2: {
          name: '九尾查克拉', tags: ['增益', '护盾', '回能'], fx: 'chakra', target: 'ally_all', cd: 4,
          desc: '将九尾查克拉分给全体友方，使其攻击力提升25%，并获得30%攻击力的护盾（均持续2回合），同时为其补充15点查克拉。',
          effects: [
            { type: 'buff', stat: 'atk', value: 0.25, turns: 2 },
            { type: 'shield', mult: 0.3, turns: 2 },
            { type: 'chakra', value: 15, to: 'ally_all' }
          ]
        },
        ult: {
          name: '九尾·尾兽玉', tags: ['群攻', '爆发', '斩杀'], fx: 'bijuu', target: 'all',
          desc: '凝聚压倒性的查克拉射出巨大的尾兽玉，对全体敌人造成3段共225%攻击力伤害；生命值低于30%的敌人额外受到150%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 0.75, hits: 3 },
            { type: 'execute', threshold: 0.3, mult: 1.5 }
          ]
        },
        awaken: {
          name: '阴阳合一', tags: ['治疗', '净化', '回能'],
          desc: '攻击力+15%；被一分为二的阴阳两半九喇嘛重归一体：生命值首次低于30%时恢复30%最大生命值，并解除自身的减益与异常状态；每次释放必杀技后获得25点查克拉。',
          stats: { atk: 0.15 },
          triggers: [
            { on: 'low_hp', effects: [{ type: 'heal', pct: 0.3 }, { type: 'cleanse' }] },
            { on: 'on_ult', effects: [{ type: 'chakra', value: 25 }] }
          ]
        }
      }
    },

    /* ============================ 十尾 ============================ */
    {
      id: 'juubi', name: '十尾', form: '', en: 'Juubi', title: '尾兽之祖',
      faction: 'bijuu', rarity: 'UR', role: 'ctrl', element: 'yin', tags: ['控制', '吸血', '群攻'],
      stats: { hp: 1.25, atk: 1.0, def: 0.85, spd: 85 },
      bio: '由大筒木辉夜与神树融合而成的巨兽，是一切尾兽的本体，脸上唯一的巨眼为轮回写轮眼。六道仙人将其查克拉一分为九造就了九只尾兽，并把空壳封印于月亮之中。第四次忍界大战中被宇智波带土与宇智波斑复活。',
      quote: '吼……把查克拉……还回来……',
      art: {
        type: 'beast', beast: 'juubi', tails: 10, bodyColor: '#4a4a52', accentColor: '#2a2a30',
        eyes: 'rinne_sharingan', eyeColor: '#e3121c', aura: '#8e6ad8'
      },
      skills: {
        passive: {
          name: '查克拉之祖', tags: ['吸血', '回能'],
          desc: '一切查克拉的源头，拥有近乎无穷的生命力：生命值+15%，吸血+12%；每回合开始时夺取随机一名敌人10点查克拉（自身获得10点查克拉）。',
          stats: { hp: 0.15, lifesteal: 0.12 },
          triggers: [{ on: 'turn_start', effects: [
            { type: 'drain', value: 10 },
            { type: 'chakra', value: 10 }
          ] }]
        },
        s1: {
          name: '十尾分裂体', tags: ['输出', '消耗'], fx: 'beast', target: 'single', cd: 0,
          desc: '从身上分裂出大量十尾分裂体扑向敌人撕咬，造成3段共126%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.42, hits: 3 }]
        },
        s2: {
          name: '神树之根', tags: ['群攻', '控制', '吸血'], fx: 'wood', target: 'all', cd: 3,
          desc: '从地底伸出神树的根须缠绕敌阵、吸取查克拉，对全体敌人造成80%攻击力伤害，有40%概率使其束缚1回合，削减其15点查克拉，并回复造成伤害30%的生命值。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 },
            { type: 'drain', value: 15 },
            { type: 'lifesteal', value: 0.3 }
          ]
        },
        ult: {
          name: '十尾尾兽玉', tags: ['群攻', '爆发', '控制'], fx: 'bijuu', target: 'all',
          desc: '凝聚足以毁天灭地的巨型尾兽玉轰向敌阵，对全体敌人造成230%攻击力伤害，并有60%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 2.3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.6 }
          ]
        },
        awaken: {
          name: '十尾·完全体', tags: ['治疗', '增益'],
          desc: '攻击力+12%，受到的伤害-8%；生命值首次低于30%时进化为完全体，恢复30%最大生命值，并免疫控制2回合。',
          stats: { atk: 0.12, dr: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.3 },
            { type: 'immune', turns: 2 }
          ] }]
        }
      }
    }

  ]);
})();
