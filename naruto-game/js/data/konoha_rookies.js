/* js/data/konoha_rookies.js — 木叶·同期与家族忍者
 * 第十班（猪鹿蝶）、第八班、凯班，以及奈良 / 山中 / 秋道 / 犬冢 / 油女 / 日向各族的长辈。
 * Schema: CONTRACT.md §2. Vocabularies: js/core.js.
 */
(function (root) {
  'use strict';
  var NG = root.NG;

  // Art defaults shared by every Konoha ninja in this file (plain objects are produced).
  function art(o) {
    var a = {
      type: 'human', skin: '#f3d3b3', eyes: 'normal',
      headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
      marks: [], mask: 'none', hat: 'none', accessory: 'none'
    };
    for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) a[k] = o[k];
    return a;
  }

  NG.defineChars('konoha_rookies', [

    /* ===================== 第十班 · 猪鹿蝶 ===================== */
    {
      id: 'shikamaru', name: '奈良鹿丸', form: '', en: 'Nara Shikamaru', title: '懒散天才',
      faction: 'konoha', rarity: 'SR', role: 'ctrl', element: 'yin', tags: ['控制', '减益'],
      stats: { hp: 1.0, atk: 1.0, def: 0.95, spd: 112 },
      bio: '奈良一族的天才少年，智商超过200，却总把“真麻烦”挂在嘴边，是同期中第一个晋升中忍的人。恩师阿斯玛牺牲后，他亲手设下陷阱击败飞段，继承了老师所说的“玉”之意志。',
      quote: '真是麻烦啊……不过，我不会逃的。',
      art: art({
        skin: '#f3d3b3', hair: 'pineapple', hairColor: '#2b2a30', eyeColor: '#3a3530',
        outfit: 'flak', outfitColor: '#5b6e3a', accentColor: '#3a3f4a',
        headbandPos: 'arm', marks: ['piercings'], aura: '#3d4f66'
      }),
      skills: {
        passive: {
          name: '智商200', tags: ['控制', '增益'],
          desc: '开战前便已算尽一切：速度+8%；战斗开始时有50%概率以影子缠住随机一名敌人，使其束缚1回合。',
          stats: { spd: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'status', status: 'bind', turns: 1, chance: 0.5 }] }]
        },
        s1: {
          name: '影子模仿手里剑之术', tags: ['消耗', '减益'], fx: 'shadow', target: 'single', cd: 0,
          desc: '掷出手里剑，影子沿着其投影延伸缠住敌人，造成105%攻击力伤害，并降低其速度15%（2回合）。',
          effects: [{ type: 'dmg', mult: 1.05 }, { type: 'debuff', stat: 'spd', value: 0.15, turns: 2 }]
        },
        s2: {
          name: '影子模仿术', tags: ['控制', '减益'], fx: 'shadow', target: 'highest_atk', cd: 3,
          desc: '伸长影子捕捉攻击力最高的敌人，使其束缚1回合，并降低其攻击力20%（2回合）。',
          effects: [{ type: 'status', status: 'bind', turns: 1 }, { type: 'debuff', stat: 'atk', value: 0.2, turns: 2 }]
        },
        ult: {
          name: '影子绞首术', tags: ['控制', '爆发', '穿透'], fx: 'shadow', target: 'single',
          desc: '影子化作手掌沿着敌人的身体攀上咽喉将其扼紧，造成300%攻击力伤害（无视30%防御），并使其束缚1回合。',
          effects: [{ type: 'dmg', mult: 3.0, pierce: 0.3 }, { type: 'status', status: 'bind', turns: 1 }]
        },
        awaken: {
          name: '玉之意志', tags: ['增益', '回能'],
          desc: '继承阿斯玛守护“玉”的意志：攻击力+10%；每当有友方阵亡时，获得30点查克拉，并使自身攻击力提升20%（2回合）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_ally_death', effects: [
            { type: 'chakra', value: 30, to: 'self' },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'self' }
          ] }]
        }
      }
    },

    {
      id: 'ino', name: '山中井野', form: '', en: 'Yamanaka Ino', title: '山中之花',
      faction: 'konoha', rarity: 'R', role: 'sup', element: 'yin', tags: ['控制', '治疗'],
      stats: { hp: 0.95, atk: 1.0, def: 1.0, spd: 108 },
      bio: '山中一族的少女，家里经营着山中花店，与春野樱既是挚友又是对手。擅长山中一族秘传的心转身之术，之后又学习了医疗忍术，是第十班不可或缺的支援。',
      quote: '我可不会输给大额头！',
      art: art({
        skin: '#f8dcc2', hair: 'high_ponytail', hairColor: '#f3dc7a', eyeColor: '#6fb3d9',
        outfit: 'sleeveless', outfitColor: '#7d4fa6', accentColor: '#e9e2f2',
        headbandPos: 'belt', aura: '#ffe066'
      }),
      skills: {
        passive: {
          name: '感知忍术', tags: ['闪避', '回能'],
          desc: '敏锐感知敌人的查克拉动向：闪避率+10%；战斗开始时获得20点查克拉。',
          stats: { dodge: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20, to: 'self' }] }]
        },
        s1: {
          name: '心乱身之术', tags: ['消耗', '减益'], fx: 'mind', target: 'single', cd: 0,
          desc: '扰乱敌人的神经使其对自己出手，造成90%攻击力伤害，并降低其攻击力12%（2回合）。',
          effects: [{ type: 'dmg', mult: 0.9 }, { type: 'debuff', stat: 'atk', value: 0.12, turns: 2 }]
        },
        s2: {
          name: '掌仙术', tags: ['治疗'], fx: 'heal', target: 'ally_lowest', cd: 3,
          desc: '以医疗查克拉治疗生命最低的友方，恢复其160%攻击力的生命值。',
          effects: [{ type: 'heal', mult: 1.6 }]
        },
        ult: {
          name: '心转身之术', tags: ['控制', '减益'], fx: 'mind', target: 'highest_atk',
          desc: '将精神潜入攻击力最高的敌人体内夺取其身体，令其自伤造成150%攻击力伤害、眩晕1回合，并削减其40点查克拉。',
          effects: [{ type: 'dmg', mult: 1.5 }, { type: 'status', status: 'stun', turns: 1 }, { type: 'drain', value: 40 }]
        },
        awaken: {
          name: '新·猪鹿蝶', tags: ['增益', '回能'],
          desc: '攻击力+10%；战斗开始时以心传身之术连接同伴意识，使全体友方获得15点查克拉。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 15, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'choji', name: '秋道丁次', form: '', en: 'Akimichi Choji', title: '温柔的大力士',
      faction: 'konoha', rarity: 'R', role: 'tank', element: 'yang', tags: ['嘲讽', '护盾'],
      stats: { hp: 1.2, atk: 0.95, def: 0.95, spd: 85 },
      bio: '秋道一族的少年，最爱吃薯片和烤肉，最讨厌被人叫作胖子。为人温柔善良，为了保护同伴，敢于吞下秋道一族的秘药与强敌拼命。',
      quote: '我才不胖！只是骨架大而已！',
      art: art({
        skin: '#f3cfa8', hair: 'spiky', hairColor: '#9c5a2b', eyeColor: '#3a2a1a',
        outfit: 'armor', outfitColor: '#b33a2e', accentColor: '#e3c25a',
        marks: ['swirl_cheeks'], aura: '#ffb74d'
      }),
      skills: {
        passive: {
          name: '倍化之术', tags: ['护盾'],
          desc: '生命+10%；受到攻击时有30%概率膨胀身体，获得8%最大生命的护盾（2回合）。',
          stats: { hp: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'shield', pct: 0.08, turns: 2, to: 'self' }] }]
        },
        s1: {
          name: '部分倍化之术', tags: ['消耗', '控制'], fx: 'fist', target: 'single', cd: 0,
          desc: '将手臂局部倍化后重重砸下，造成95%攻击力伤害，并有20%概率使其眩晕1回合。',
          effects: [{ type: 'dmg', mult: 0.95 }, { type: 'status', status: 'stun', turns: 1, chance: 0.2 }]
        },
        s2: {
          name: '肉弹战车', tags: ['群攻', '嘲讽'], fx: 'fist', target: 'all', cd: 3,
          desc: '倍化身体缩成巨大肉球高速翻滚冲撞，对全体敌人造成75%攻击力伤害，并嘲讽敌人2回合。',
          effects: [{ type: 'dmg', mult: 0.75 }, { type: 'taunt', turns: 2, to: 'self' }]
        },
        ult: {
          name: '肉弹针战车', tags: ['群攻', '持续', '护盾'], fx: 'fist', target: 'all',
          desc: '让头发化作无数尖刺包裹全身，化身带刺肉球碾压全体敌人，造成4段共140%攻击力伤害，有50%概率使其流血2回合（每回合20%攻击力），并获得10%最大生命的护盾（2回合）。',
          effects: [
            { type: 'dmg', mult: 0.35, hits: 4 },
            { type: 'status', status: 'bleed', turns: 2, chance: 0.5, value: 0.2 },
            { type: 'shield', pct: 0.10, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '咖喱丸', tags: ['治疗', '增益'],
          desc: '防御+10%；生命低于30%时吞下秋道秘药咖喱丸，恢复25%最大生命，并使攻击力提升40%（3回合）。',
          stats: { def: 0.10 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.25, to: 'self' },
            { type: 'buff', stat: 'atk', value: 0.4, turns: 3, to: 'self' }
          ] }]
        }
      }
    },

    {
      id: 'choji_butterfly', name: '秋道丁次', form: '蝶化之术', en: 'Akimichi Choji', title: '蝶之觉醒',
      faction: 'konoha', rarity: 'SR', role: 'atk', element: 'yang', tags: ['爆发', '单体'],
      stats: { hp: 1.0, atk: 1.2, def: 0.85, spd: 120 },
      bio: '吞下秋道秘药中的最后一颗辣椒丸后，丁次将全身脂肪尽数转化为查克拉，背后展开查克拉蝶翼，力量足以压倒开启咒印第二状态的次郎坊。但药效过后，身体将付出极其沉重的代价。',
      quote: '听好了，我是秋道一族的丁次！',
      art: art({
        skin: '#f3cfa8', hair: 'wild_long', hairColor: '#a0522d', eyeColor: '#3a2a1a',
        outfit: 'armor', outfitColor: '#8e2b22', accentColor: '#ffd54f',
        marks: ['swirl_cheeks'], aura: '#ff5fa2'
      }),
      skills: {
        passive: {
          name: '辣椒丸', tags: ['增益', '回能'],
          desc: '服下秋道秘药辣椒丸，将脂肪全部转化为查克拉：攻击力+15%，暴击率+10%；战斗开始时获得30点查克拉。',
          stats: { atk: 0.15, crit: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 30, to: 'self' }] }]
        },
        s1: {
          name: '蝶化之术', tags: ['消耗', '回能'], fx: 'chakra', target: 'single', cd: 0,
          desc: '振动查克拉蝶翼高速突进撞击敌人，造成110%攻击力伤害，并获得10点查克拉。',
          effects: [{ type: 'dmg', mult: 1.1 }, { type: 'chakra', value: 10, to: 'self' }]
        },
        s2: {
          name: '蝶弹爆击', tags: ['输出', '穿透'], fx: 'fist', target: 'single', cd: 3,
          desc: '将蝶翼的查克拉凝聚于拳头全力轰出，造成190%攻击力伤害（无视20%防御）。',
          effects: [{ type: 'dmg', mult: 1.9, pierce: 0.2 }]
        },
        ult: {
          name: '超蝶弹爆击', tags: ['爆发', '穿透', '斩杀'], fx: 'chakra', target: 'single',
          desc: '蝶翼喷发出全部查克拉凝成巨拳砸下，造成340%攻击力伤害（无视30%防御）；生命低于30%的目标额外受到100%攻击力的斩杀伤害。',
          effects: [{ type: 'dmg', mult: 3.4, pierce: 0.3 }, { type: 'execute', threshold: 0.3, mult: 1.0 }]
        },
        awaken: {
          name: '查克拉蝶翼', tags: ['增益', '护盾'],
          desc: '攻击力+12%；生命低于30%时燃尽最后的查克拉，伤害提升30%（3回合），并获得20%最大生命的护盾（2回合）。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'buff', stat: 'dmg', value: 0.3, turns: 3, to: 'self' },
            { type: 'shield', pct: 0.2, turns: 2, to: 'self' }
          ] }]
        }
      }
    },

    {
      id: 'asuma', name: '猿飞阿斯玛', form: '', en: 'Sarutobi Asuma', title: '守护忍十二士',
      faction: 'konoha', rarity: 'SR', role: 'atk', element: 'wind', tags: ['输出', '穿透'],
      stats: { hp: 1.0, atk: 1.1, def: 0.95, spd: 112 },
      bio: '三代目火影猿飞日斩之子，第十班的上忍老师，曾是守护火之国大名的守护忍十二士之一。擅长将风遁查克拉灌注于查克拉刀中作战，在与晓的飞段、角都交战时牺牲。',
      quote: '所谓的“玉”，就是未来的孩子们。',
      art: art({
        skin: '#e9c4a0', hair: 'short', hairColor: '#252525', eyeColor: '#2b2b2b',
        outfit: 'flak', outfitColor: '#5b6e3a', accentColor: '#2c3e50',
        marks: ['beard'], accessory: 'chakra_blades', aura: '#6fe0b8'
      }),
      skills: {
        passive: {
          name: '风之性质变化', tags: ['增益', '减益'],
          desc: '暴击率+8%；技能命中后有25%概率以风刃削开目标防御，使其防御降低15%（2回合）。',
          stats: { crit: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.25, effects: [{ type: 'debuff', stat: 'def', value: 0.15, turns: 2, to: 'target' }] }]
        },
        s1: {
          name: '查克拉刀', tags: ['消耗', '穿透'], fx: 'wind', target: 'single', cd: 0,
          desc: '挥动灌注了风遁查克拉的查克拉刀斩击，造成105%攻击力伤害（无视15%防御）。',
          effects: [{ type: 'dmg', mult: 1.05, pierce: 0.15 }]
        },
        s2: {
          name: '火遁·灰积烧', tags: ['群攻', '持续'], fx: 'fire', target: 'all', cd: 3,
          desc: '吐出混有查克拉的灰尘笼罩敌阵，再以齿间火花将其引燃，对全体敌人造成85%攻击力伤害，并有60%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [{ type: 'dmg', mult: 0.85 }, { type: 'status', status: 'burn', turns: 2, chance: 0.6, value: 0.3 }]
        },
        ult: {
          name: '风遁·飞燕', tags: ['爆发', '穿透', '斩杀'], fx: 'wind', target: 'single',
          desc: '将风遁查克拉延伸为锋利无比的刀刃斩向要害，造成300%攻击力伤害（无视35%防御）；生命低于30%的目标额外受到120%攻击力的斩杀伤害。',
          effects: [{ type: 'dmg', mult: 3.0, pierce: 0.35 }, { type: 'execute', threshold: 0.3, mult: 1.2 }]
        },
        awaken: {
          name: '火之意志', tags: ['增益'],
          desc: '攻击力+12%；阵亡时将火之意志托付给学生们，使全体友方攻击力提升20%（2回合）。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_death', effects: [{ type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    /* ===================== 第八班 ===================== */
    {
      id: 'kiba', name: '犬冢牙', form: '', en: 'Inuzuka Kiba', title: '野性之牙',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'none', tags: ['输出', '爆发'],
      stats: { hp: 0.95, atk: 1.1, def: 0.9, spd: 132 },
      bio: '犬冢一族的少年，与忍犬赤丸形影不离，嗅觉远超常人。擅长与赤丸配合施展犬冢流体术，一心想要超越鸣人成为火影。',
      quote: '上了，赤丸！牙通牙！',
      art: art({
        skin: '#e8bb92', hair: 'shaggy', hairColor: '#5a3a22', eyeColor: '#4a2a12',
        outfit: 'jacket', outfitColor: '#5f5f66', accentColor: '#d8c3a0',
        marks: ['fangs'], accessory: 'dog', aura: '#c8a27a'
      }),
      skills: {
        passive: {
          name: '四脚之术', tags: ['增益'],
          desc: '模仿野兽四肢着地高速奔袭：速度+10%，暴击率+8%。',
          stats: { spd: 0.10, crit: 0.08 }
        },
        s1: {
          name: '通牙', tags: ['消耗'], fx: 'beast', target: 'single', cd: 0,
          desc: '身体高速旋转化作钻头冲撞敌人，造成2段共100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.5, hits: 2 }]
        },
        s2: {
          name: '牙通牙', tags: ['输出', '减益'], fx: 'beast', target: 'random', count: 2, cd: 3,
          desc: '与赤丸一同旋转突进，对随机2名敌人各造成2段共110%攻击力伤害，并借赤丸的动态标记锁定目标，使其受到的伤害增加15%（2回合）。',
          effects: [{ type: 'dmg', mult: 0.55, hits: 2 }, { type: 'debuff', stat: 'dr', value: 0.15, turns: 2 }]
        },
        ult: {
          name: '牙狼牙', tags: ['群攻', '爆发', '持续'], fx: 'beast', target: 'all',
          desc: '与赤丸以人兽混合变身化作双头狼，卷起巨型旋转利牙撕裂全体敌人，造成3段共135%攻击力伤害，并有50%概率使其流血2回合（每回合25%攻击力）。',
          effects: [{ type: 'dmg', mult: 0.45, hits: 3 }, { type: 'status', status: 'bleed', turns: 2, chance: 0.5, value: 0.25 }]
        },
        awaken: {
          name: '人兽混合变身', tags: ['输出', '增益'],
          desc: '攻击力+10%；技能命中后有30%概率由赤丸扑上追加撕咬，造成40%攻击力伤害。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'dmg', mult: 0.4, to: 'target' }] }]
        }
      }
    },

    {
      id: 'hinata', name: '日向雏田', form: '', en: 'Hyuga Hinata', title: '宗家长女',
      faction: 'konoha', rarity: 'SR', role: 'ctrl', element: 'none', tags: ['控制', '护盾'],
      stats: { hp: 0.95, atk: 1.05, def: 1.0, spd: 115 },
      bio: '日向宗家的长女，性格内向温柔，一直默默追逐着鸣人的背影。佩恩袭击木叶时，她挺身而出保护鸣人，并向他吐露了心意。',
      quote: '说到做到，这就是我的忍道。',
      art: art({
        skin: '#f8e0cc', hair: 'hime', hairColor: '#2c2f5c', eyes: 'byakugan', eyeColor: '#e6e3f5',
        outfit: 'jacket', outfitColor: '#cfc8e6', accentColor: '#3b3561',
        headbandPos: 'neck', aura: '#b9c8ff'
      }),
      skills: {
        passive: {
          name: '白眼', tags: ['闪避', '减益'],
          desc: '白眼看穿经络：闪避率+10%；技能命中后有30%概率封住目标经络，削减其10点查克拉。',
          stats: { dodge: 0.10 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'drain', value: 10, to: 'target' }] }]
        },
        s1: {
          name: '柔拳', tags: ['消耗', '减益'], fx: 'fist', target: 'single', cd: 0,
          desc: '以柔拳直击敌人经络，造成105%攻击力伤害，并降低其攻击力12%（2回合）。',
          effects: [{ type: 'dmg', mult: 1.05 }, { type: 'debuff', stat: 'atk', value: 0.12, turns: 2 }]
        },
        s2: {
          name: '护身八卦六十四掌', tags: ['护盾', '反击'], fx: 'shield', target: 'ally_all', cd: 4,
          desc: '双手查克拉织成无数掌刃守护同伴，为全体友方提供50%攻击力的护盾（2回合），并使自身获得反击状态2回合（反击50%攻击力）。',
          effects: [{ type: 'shield', mult: 0.5, turns: 2 }, { type: 'counter', mult: 0.5, turns: 2, to: 'self' }]
        },
        ult: {
          name: '柔步双狮拳', tags: ['爆发', '控制', '减益'], fx: 'chakra', target: 'single',
          desc: '双手凝聚成狮首形状的查克拉连续猛击，造成3段共300%攻击力伤害，吸散目标50点查克拉，并降低其攻击力20%（2回合）。',
          effects: [
            { type: 'dmg', mult: 1.0, hits: 3 },
            { type: 'drain', value: 50 },
            { type: 'debuff', stat: 'atk', value: 0.2, turns: 2 }
          ]
        },
        awaken: {
          name: '我的忍道', tags: ['护盾', '增益'],
          desc: '攻击力+10%；生命低于30%时依然站起，获得25%最大生命的护盾（2回合），并使攻击力提升25%（3回合）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'shield', pct: 0.25, turns: 2, to: 'self' },
            { type: 'buff', stat: 'atk', value: 0.25, turns: 3, to: 'self' }
          ] }]
        }
      }
    },

    {
      id: 'shino', name: '油女志乃', form: '', en: 'Aburame Shino', title: '寄坏虫使',
      faction: 'konoha', rarity: 'R', role: 'ctrl', element: 'none', tags: ['减益', '持续'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 100 },
      bio: '油女一族的少年，自出生起体内便寄宿着以查克拉为食的寄坏虫。沉默寡言、思维缜密，却常因存在感太低而被同伴遗忘。',
      quote: '为什么？因为我是油女一族。',
      art: art({
        skin: '#f1d3b5', hair: 'short', hairColor: '#3b2a20', eyes: 'dark',
        outfit: 'highcollar', outfitColor: '#6a7356', accentColor: '#3b3b3b',
        marks: ['sunglasses'], hat: 'hood_up', aura: '#8d7a4a'
      }),
      skills: {
        passive: {
          name: '寄坏虫之体', tags: ['持续', '反击'],
          desc: '防御+5%；受到攻击时有30%概率令寄坏虫反噬攻击者，使其中毒2回合（每回合25%攻击力）。',
          stats: { def: 0.05 },
          triggers: [{ on: 'on_hit', effects: [{ type: 'status', status: 'poison', turns: 2, chance: 0.3, value: 0.25, to: 'attacker' }] }]
        },
        s1: {
          name: '寄坏虫之术', tags: ['消耗', '减益'], fx: 'insect', target: 'single', cd: 0,
          desc: '放出寄坏虫啃噬敌人，造成95%攻击力伤害，并吸食其10点查克拉。',
          effects: [{ type: 'dmg', mult: 0.95 }, { type: 'drain', value: 10 }]
        },
        s2: {
          name: '虫分身之术', tags: ['闪避', '反击'], fx: 'insect', target: 'self', cd: 3,
          desc: '以寄坏虫聚成分身替代本体，自身闪避率提升20%（2回合），并获得反击状态2回合（反击60%攻击力）。',
          effects: [{ type: 'buff', stat: 'dodge', value: 0.2, turns: 2 }, { type: 'counter', mult: 0.6, turns: 2, to: 'self' }]
        },
        ult: {
          name: '秘术·虫玉', tags: ['群攻', '减益', '持续'], fx: 'insect', target: 'all',
          desc: '驱使大群寄坏虫结成虫球包裹全体敌人，造成130%攻击力伤害，吸食其25点查克拉，并有50%概率使其中毒2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'drain', value: 25 },
            { type: 'status', status: 'poison', turns: 2, chance: 0.5, value: 0.25 }
          ]
        },
        awaken: {
          name: '寄坏虫·雌虫', tags: ['增益', '减益'],
          desc: '攻击力+10%；技能命中后有30%概率在目标身上留下雌虫追踪，使其受到的伤害增加10%（2回合）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'debuff', stat: 'dr', value: 0.1, turns: 2, to: 'target' }] }]
        }
      }
    },

    {
      id: 'kurenai', name: '夕日红', form: '', en: 'Yuhi Kurenai', title: '幻术高手',
      faction: 'konoha', rarity: 'SR', role: 'ctrl', element: 'yin', tags: ['控制', '减益'],
      stats: { hp: 0.95, atk: 1.05, def: 0.95, spd: 108 },
      bio: '第八班的上忍老师，木叶首屈一指的幻术使。与猿飞阿斯玛相恋，阿斯玛牺牲时她已怀有他的孩子。',
      quote: '你已经落入我的幻术之中了。',
      art: art({
        skin: '#f6dccb', hair: 'wild_long', hairColor: '#1d1a26', eyeColor: '#c62828',
        outfit: 'bandage', outfitColor: '#ece6da', accentColor: '#b71c1c',
        marks: ['red_lips'], aura: '#d81b60'
      }),
      skills: {
        passive: {
          name: '幻术之网', tags: ['控制', '闪避'],
          desc: '闪避率+8%；受到攻击时有25%概率使攻击者陷入幻术，睡眠1回合（受到伤害时醒来）。',
          stats: { dodge: 0.08 },
          triggers: [{ on: 'on_hit', effects: [{ type: 'status', status: 'sleep', turns: 1, chance: 0.25, to: 'attacker' }] }]
        },
        s1: {
          name: '手里剑之术', tags: ['消耗', '减益'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '以幻术掩护投出手里剑，造成105%攻击力伤害，并降低其速度10%（2回合）。',
          effects: [{ type: 'dmg', mult: 1.05 }, { type: 'debuff', stat: 'spd', value: 0.1, turns: 2 }]
        },
        s2: {
          name: '幻术解除', tags: ['净化', '闪避'], fx: 'genjutsu', target: 'ally_all', cd: 4,
          desc: '以痛觉打断查克拉的扰乱，解除全体友方的减益与控制状态，并使其闪避率提升15%（2回合）。',
          effects: [{ type: 'cleanse', to: 'ally_all' }, { type: 'buff', stat: 'dodge', value: 0.15, turns: 2 }]
        },
        ult: {
          name: '魔幻·树缚杀', tags: ['控制', '爆发', '减益'], fx: 'genjutsu', target: 'single',
          desc: '令敌人陷入被大树缠缚的幻境，随即从树干中现身持苦无刺击，造成300%攻击力伤害，使其束缚1回合，并降低其攻击力20%（2回合）。',
          effects: [
            { type: 'dmg', mult: 3.0 },
            { type: 'status', status: 'bind', turns: 1 },
            { type: 'debuff', stat: 'atk', value: 0.2, turns: 2 }
          ]
        },
        awaken: {
          name: '魔幻领域', tags: ['控制', '增益'],
          desc: '攻击力+10%；释放必杀技后，有35%概率使全体敌人陷入睡眠1回合（受到伤害时醒来）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'sleep', turns: 1, chance: 0.35, to: 'enemy_all' }] }]
        }
      }
    },

    /* ===================== 凯班 ===================== */
    {
      id: 'neji', name: '日向宁次', form: '', en: 'Hyuga Neji', title: '日向天才',
      faction: 'konoha', rarity: 'SR', role: 'atk', element: 'none', tags: ['输出', '反击'],
      stats: { hp: 0.95, atk: 1.1, def: 1.0, spd: 122 },
      bio: '日向分家的天才，曾坚信命运无法改变，在中忍考试中败给鸣人后重新找回了自我。第四次忍界大战中，他为保护鸣人与雏田挺身而出，壮烈牺牲。',
      quote: '你已经进入我八卦的领域了。',
      art: art({
        skin: '#f6dcc6', hair: 'long_straight', hairColor: '#3b2c2a', eyes: 'byakugan', eyeColor: '#e6e3f5',
        outfit: 'robe', outfitColor: '#efe9dc', accentColor: '#5b4a3a', aura: '#cfe8ff'
      }),
      skills: {
        passive: {
          name: '白眼', tags: ['增益', '闪避'],
          desc: '白眼几乎没有死角：暴击率+10%，闪避率+8%。',
          stats: { crit: 0.10, dodge: 0.08 }
        },
        s1: {
          name: '八卦空掌', tags: ['消耗', '穿透'], fx: 'chakra', target: 'back', cd: 0,
          desc: '隔空推出凝聚的查克拉掌压，攻击最后排的敌人，造成105%攻击力伤害（无视20%防御）。',
          effects: [{ type: 'dmg', mult: 1.05, pierce: 0.2 }]
        },
        s2: {
          name: '八卦掌回天', tags: ['护盾', '反击'], fx: 'shield', target: 'self', cd: 3,
          desc: '全身释放查克拉高速旋转形成绝对防御，获得20%最大生命的护盾（2回合），免疫控制2回合，并获得反击状态2回合（反击80%攻击力）。',
          effects: [
            { type: 'shield', pct: 0.2, turns: 2 },
            { type: 'immune', turns: 2 },
            { type: 'counter', mult: 0.8, turns: 2 }
          ]
        },
        ult: {
          name: '八卦六十四掌', tags: ['爆发', '封印'], fx: 'fist', target: 'single',
          desc: '踏入八卦领域连续封闭敌人全身经络，造成8段共320%攻击力伤害，封印目标2回合（只能使用技能1），并削减其20点查克拉。',
          effects: [
            { type: 'dmg', mult: 0.4, hits: 8 },
            { type: 'status', status: 'silence', turns: 2 },
            { type: 'drain', value: 20 }
          ]
        },
        awaken: {
          name: '八卦百二十八掌', tags: ['输出', '护盾'],
          desc: '攻击力+12%；释放必杀技后以八卦百二十八掌追击随机一名敌人，造成80%攻击力伤害；阵亡时为全体友方提供15%最大生命的护盾（2回合）。',
          stats: { atk: 0.12 },
          triggers: [
            { on: 'on_ult', effects: [{ type: 'dmg', mult: 0.8, to: 'enemy_random' }] },
            { on: 'on_death', effects: [{ type: 'shield', pct: 0.15, turns: 2, to: 'ally_all' }] }
          ]
        }
      }
    },

    {
      id: 'rock_lee', name: '李洛克', form: '', en: 'Rock Lee', title: '苍蓝野兽',
      faction: 'konoha', rarity: 'SR', role: 'atk', element: 'none', tags: ['输出', '闪避'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 140 },
      bio: '无法使用忍术与幻术的少年，凭借拼命的努力专精体术，立志证明“只靠体术也能成为出色的忍者”。师从迈特凯，能够打开八门遁甲。',
      quote: '就算不会忍术，我也要证明给你看！',
      art: art({
        skin: '#f3d3b3', hair: 'bowl', hairColor: '#111111', eyeColor: '#111111',
        outfit: 'bodysuit', outfitColor: '#3e9b3a', accentColor: '#f08c2e',
        headbandPos: 'belt', aura: '#46d36b'
      }),
      skills: {
        passive: {
          name: '卸下负重', tags: ['增益', '闪避'],
          desc: '速度+8%，闪避率+10%；战斗开始时卸下腿上的负重，速度额外提升30%（2回合）。',
          stats: { spd: 0.08, dodge: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'spd', value: 0.3, turns: 2, to: 'self' }] }]
        },
        s1: {
          name: '木叶旋风', tags: ['消耗'], fx: 'fist', target: 'single', cd: 0,
          desc: '高速回旋踢击敌人，造成2段共110%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.55, hits: 2 }]
        },
        s2: {
          name: '表莲华', tags: ['输出', '控制'], fx: 'fist', target: 'single', cd: 3,
          desc: '打开开门，将敌人踢上高空后以绷带缠住其身体头朝下砸向地面，造成180%攻击力伤害，并有50%概率使其眩晕1回合。',
          effects: [{ type: 'dmg', mult: 1.8 }, { type: 'status', status: 'stun', turns: 1, chance: 0.5 }]
        },
        ult: {
          name: '里莲华', tags: ['爆发', '控制'], fx: 'gate', target: 'single',
          desc: '打开八门遁甲直至第五门杜门，以超越极限的速度连续重击，造成5段共325%攻击力伤害，并有60%概率使其眩晕1回合。',
          effects: [{ type: 'dmg', mult: 0.65, hits: 5 }, { type: 'status', status: 'stun', turns: 1, chance: 0.6 }]
        },
        awaken: {
          name: '醉拳', tags: ['反击', '闪避'],
          desc: '攻击力+10%，闪避率+5%；受到攻击时有30%概率以变幻莫测的醉拳回击攻击者，造成60%攻击力伤害。',
          stats: { atk: 0.10, dodge: 0.05 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'dmg', mult: 0.6, to: 'attacker' }] }]
        }
      }
    },

    {
      id: 'tenten', name: '天天', form: '', en: 'Tenten', title: '暗器专家',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'none', tags: ['群攻', '输出'],
      stats: { hp: 0.9, atk: 1.15, def: 0.9, spd: 118 },
      bio: '凯班的少女，擅长操纵各式忍具与暗器，以传说三忍中的纲手为憧憬目标。能够从卷轴中通灵出大量武器，对敌人展开铺天盖地的攻击。',
      quote: '什么样的忍具，我都能运用自如！',
      art: art({
        skin: '#f6d8c0', hair: 'buns', hairColor: '#4a2c1d', eyeColor: '#4a2c1d',
        outfit: 'qipao', outfitColor: '#f2a5c0', accentColor: '#c2185b',
        accessory: 'scroll', aura: '#cfd8dc'
      }),
      skills: {
        passive: {
          name: '忍具精通', tags: ['增益', '持续'],
          desc: '暴击率+10%；技能命中后有20%概率使目标流血2回合（每回合20%攻击力）。',
          stats: { crit: 0.10 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'status', status: 'bleed', turns: 2, value: 0.2, to: 'target' }] }]
        },
        s1: {
          name: '暗器连投', tags: ['消耗'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '指间夹着苦无与手里剑连续投掷，造成3段共96%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.32, hits: 3 }]
        },
        s2: {
          name: '忍具口寄', tags: ['输出', '召唤'], fx: 'summon', target: 'random', count: 3, cd: 3,
          desc: '展开卷轴通灵出大量忍具投向随机3名敌人，各造成2段共100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.5, hits: 2 }]
        },
        ult: {
          name: '双升龙', tags: ['群攻', '爆发', '持续'], fx: 'shuriken', target: 'all',
          desc: '两卷卷轴如双龙盘旋升空，数以百计的忍具从天而降，对全体敌人造成5段共140%攻击力伤害，并有50%概率使其流血2回合（每回合25%攻击力）。',
          effects: [{ type: 'dmg', mult: 0.28, hits: 5 }, { type: 'status', status: 'bleed', turns: 2, chance: 0.5, value: 0.25 }]
        },
        awaken: {
          name: '暗器大师', tags: ['增益', '减益'],
          desc: '攻击力+10%，暴击率+5%；释放必杀技后，降低全体敌人防御15%（2回合）。',
          stats: { atk: 0.10, crit: 0.05 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'debuff', stat: 'def', value: 0.15, turns: 2, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'guy', name: '迈特凯', form: '', en: 'Might Guy', title: '苍蓝猛兽',
      faction: 'konoha', rarity: 'SSR', role: 'atk', element: 'none', tags: ['输出', '爆发'],
      stats: { hp: 1.05, atk: 1.1, def: 0.9, spd: 138 },
      bio: '木叶的体术高手，自称旗木卡卡西“永远的对手”，将热血与青春奉为信条。能够打开八门遁甲中的第七门惊门，施展朝孔雀与昼虎等奥义。',
      quote: '青春就是要燃烧到最后一刻！',
      art: art({
        skin: '#f1d0ae', hair: 'bowl', hairColor: '#151515', eyeColor: '#151515',
        outfit: 'flak', outfitColor: '#4e7a36', accentColor: '#3e9b3a',
        headbandPos: 'belt', aura: '#46d36b'
      }),
      skills: {
        passive: {
          name: '热血青春', tags: ['增益', '爆发'],
          desc: '速度+5%，暴击率+8%；生命低于30%时燃烧青春，攻击力提升35%、速度提升20%（3回合）。',
          stats: { spd: 0.05, crit: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'buff', stat: 'atk', value: 0.35, turns: 3, to: 'self' },
            { type: 'buff', stat: 'spd', value: 0.2, turns: 3, to: 'self' }
          ] }]
        },
        s1: {
          name: '木叶大旋风', tags: ['消耗'], fx: 'fist', target: 'single', cd: 0,
          desc: '以强劲的回旋踢连续踢击敌人，造成2段共120%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.6, hits: 2 }]
        },
        s2: {
          name: '朝孔雀', tags: ['群攻', '持续'], fx: 'fist', target: 'all', cd: 3,
          desc: '打开第六门景门，以超高速连拳摩擦空气燃起火焰，如孔雀开屏般覆盖全体敌人，造成4段共100%攻击力伤害，并有50%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [{ type: 'dmg', mult: 0.25, hits: 4 }, { type: 'status', status: 'burn', turns: 2, chance: 0.5, value: 0.3 }]
        },
        ult: {
          name: '昼虎', tags: ['爆发', '穿透', '控制'], fx: 'gate', target: 'single',
          desc: '打开第七门惊门，将压缩至一点的空气化作猛虎一拳轰出，造成360%攻击力伤害（无视30%防御），并有60%概率使其眩晕1回合。',
          effects: [{ type: 'dmg', mult: 3.6, pierce: 0.3 }, { type: 'status', status: 'stun', turns: 1, chance: 0.6 }]
        },
        awaken: {
          name: '八门遁甲·惊门', tags: ['增益', '回能'],
          desc: '攻击力+12%；释放必杀技后，速度提升25%（2回合），并获得20点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [
            { type: 'buff', stat: 'spd', value: 0.25, turns: 2, to: 'self' },
            { type: 'chakra', value: 20, to: 'self' }
          ] }]
        }
      }
    },

    {
      id: 'guy_eight', name: '迈特凯', form: '八门遁甲·死门', en: 'Might Guy', title: '体术最强者',
      faction: 'konoha', rarity: 'UR', role: 'atk', element: 'none', tags: ['爆发', '单体'],
      stats: { hp: 0.95, atk: 1.25, def: 0.85, spd: 150 },
      bio: '第四次忍界大战中，凯为对抗获得六道之力的宇智波斑，打开了第八门死门，全身迸发出血红色的蒸汽。他以夕象与夜凯将斑逼入绝境，被斑亲口称赞为“体术上最强的对手”。',
      quote: '这是我青春最后的绽放！',
      art: art({
        skin: '#e0533f', hair: 'spiky_up', hairColor: '#151515', eyes: 'blank',
        outfit: 'bodysuit', outfitColor: '#3e9b3a', accentColor: '#f08c2e',
        headbandPos: 'belt', marks: ['face_lines'], aura: '#ff1744'
      }),
      skills: {
        passive: {
          name: '八门遁甲·死门', tags: ['增益'],
          desc: '打开第八门死门，燃烧生命换取力量：攻击力+15%，速度+10%；战斗开始时免疫控制3回合。',
          stats: { atk: 0.15, spd: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'immune', turns: 3, to: 'self' }] }]
        },
        s1: {
          name: '夕象·一步', tags: ['消耗', '穿透'], fx: 'fist', target: 'single', cd: 0,
          desc: '踏出夕象的第一步，以压缩空气形成的象足重击敌人，造成125%攻击力伤害（无视20%防御）。',
          effects: [{ type: 'dmg', mult: 1.25, pierce: 0.2 }]
        },
        s2: {
          name: '夕象', tags: ['输出', '穿透'], fx: 'fist', target: 'single', cd: 3,
          desc: '接连踏出夕象的二至五步，空气炮一击重过一击，造成4段共240%攻击力伤害（无视20%防御）。',
          effects: [{ type: 'dmg', mult: 0.6, hits: 4, pierce: 0.2 }]
        },
        ult: {
          name: '夜凯', tags: ['爆发', '穿透', '斩杀'], fx: 'gate', target: 'single',
          desc: '化作赤红的龙形血雾扭曲空间冲向敌人，造成420%攻击力伤害（无视50%防御）；生命低于35%的目标额外受到150%攻击力的斩杀伤害。',
          effects: [{ type: 'dmg', mult: 4.2, pierce: 0.5 }, { type: 'execute', threshold: 0.35, mult: 1.5 }]
        },
        awaken: {
          name: '燃尽的青春', tags: ['爆发', '回能', '增益'],
          desc: '攻击力+12%；生命低于30%时伤害提升40%（3回合），并立即获得50点查克拉；阵亡时以最后的青春激励同伴，使全体友方攻击力提升25%（2回合）。',
          stats: { atk: 0.12 },
          triggers: [
            { on: 'low_hp', effects: [
              { type: 'buff', stat: 'dmg', value: 0.4, turns: 3, to: 'self' },
              { type: 'chakra', value: 50, to: 'self' }
            ] },
            { on: 'on_death', effects: [{ type: 'buff', stat: 'atk', value: 0.25, turns: 2, to: 'ally_all' }] }
          ]
        }
      }
    },

    {
      id: 'duy', name: '迈特戴', form: '', en: 'Might Duy', title: '万年下忍',
      faction: 'konoha', rarity: 'SR', role: 'atk', element: 'none', tags: ['群攻', '爆发'],
      stats: { hp: 1.0, atk: 1.1, def: 0.9, spd: 135 },
      bio: '迈特凯的父亲，一生都被人嘲笑为“万年下忍”，却始终以热血与努力教导儿子。为保护凯，他打开八门遁甲第八门死门，独自对抗雾隐的忍刀七人众，以生命守护了儿子。',
      quote: '自己定下的规矩，要用一生去遵守！',
      art: art({
        skin: '#efcba8', hair: 'bowl', hairColor: '#1a1a1a', eyeColor: '#1a1a1a',
        outfit: 'bodysuit', outfitColor: '#4caf50', accentColor: '#f08c2e',
        aura: '#ff5252'
      }),
      skills: {
        passive: {
          name: '自己的规矩', tags: ['护盾'],
          desc: '无论被如何嘲笑都绝不放弃：生命+8%，防御+5%；受到攻击时有20%概率获得10%最大生命的护盾（2回合）。',
          stats: { hp: 0.08, def: 0.05 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'shield', pct: 0.10, turns: 2, to: 'self' }] }]
        },
        s1: {
          name: '木叶烈风', tags: ['消耗'], fx: 'fist', target: 'single', cd: 0,
          desc: '以低扫踢横扫敌人下盘，造成110%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.1 }]
        },
        s2: {
          name: '八门遁甲', tags: ['增益'], fx: 'gate', target: 'self', cd: 4,
          desc: '依次冲开八门遁甲，攻击力提升30%、速度提升20%（2回合），并免疫控制2回合。',
          effects: [
            { type: 'buff', stat: 'atk', value: 0.3, turns: 2 },
            { type: 'buff', stat: 'spd', value: 0.2, turns: 2 },
            { type: 'immune', turns: 2 }
          ]
        },
        ult: {
          name: '夕象', tags: ['群攻', '爆发', '控制'], fx: 'gate', target: 'all',
          desc: '打开第八门死门，以夕象的空气重拳横扫如忍刀七人众般的强敌，对全体敌人造成4段共180%攻击力伤害，并有40%概率使其眩晕1回合。',
          effects: [{ type: 'dmg', mult: 0.45, hits: 4 }, { type: 'status', status: 'stun', turns: 1, chance: 0.4 }]
        },
        awaken: {
          name: '死门·守护', tags: ['爆发', '增益'],
          desc: '攻击力+12%；生命低于30%时伤害提升40%（2回合）；阵亡时将守护的意志托付给同伴，使全体友方攻击力提升25%（2回合）。',
          stats: { atk: 0.12 },
          triggers: [
            { on: 'low_hp', effects: [{ type: 'buff', stat: 'dmg', value: 0.4, turns: 2, to: 'self' }] },
            { on: 'on_death', effects: [{ type: 'buff', stat: 'atk', value: 0.25, turns: 2, to: 'ally_all' }] }
          ]
        }
      }
    },

    /* ===================== 日向一族 ===================== */
    {
      id: 'hiashi', name: '日向日足', form: '', en: 'Hyuga Hiashi', title: '日向族长',
      faction: 'konoha', rarity: 'SR', role: 'tank', element: 'none', tags: ['嘲讽', '反击'],
      stats: { hp: 1.0, atk: 1.0, def: 1.05, spd: 105 },
      bio: '日向一族宗家族长，雏田与花火的父亲，日向日差的双胞胎哥哥。对女儿们要求严厉，精通宗家代代相传的柔拳与八卦掌回天。',
      quote: '日向，乃木叶最强之一族。',
      art: art({
        skin: '#f3d6be', hair: 'long_straight', hairColor: '#2b2422', eyes: 'byakugan', eyeColor: '#e6e3f5',
        outfit: 'kimono', outfitColor: '#d6cdb6', accentColor: '#5b4636',
        headband: 'none', aura: '#cfe8ff'
      }),
      skills: {
        passive: {
          name: '宗家秘传', tags: ['减益', '增益'],
          desc: '防御+10%，伤害减免+5%；受到攻击时有20%概率以柔拳封住攻击者经络，削减其10点查克拉。',
          stats: { def: 0.10, dr: 0.05 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'drain', value: 10, to: 'attacker' }] }]
        },
        s1: {
          name: '柔拳', tags: ['消耗', '护盾'], fx: 'fist', target: 'single', cd: 0,
          desc: '以柔拳击打敌人经络，造成100%攻击力伤害，并获得20%攻击力的护盾（2回合）。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'shield', mult: 0.2, turns: 2, to: 'self' }]
        },
        s2: {
          name: '八卦掌回天', tags: ['群攻', '嘲讽', '增益'], fx: 'shield', target: 'all', cd: 3,
          desc: '高速旋转释放查克拉弹开周围的一切，对全体敌人造成60%攻击力伤害，嘲讽敌人2回合，并使自身防御提升25%（2回合）。',
          effects: [
            { type: 'dmg', mult: 0.6 },
            { type: 'taunt', turns: 2, to: 'self' },
            { type: 'buff', stat: 'def', value: 0.25, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '八卦空壁掌', tags: ['群攻', '控制', '护盾'], fx: 'chakra', target: 'all',
          desc: '将查克拉化作巨大的真空壁障推向敌阵，对全体敌人造成150%攻击力伤害，有40%概率使其眩晕1回合，并获得15%最大生命的护盾（2回合）。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 },
            { type: 'shield', pct: 0.15, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '日向的骄傲', tags: ['护盾', '增益'],
          desc: '防御+10%；战斗开始时为全体友方提供10%最大生命的护盾（2回合）。',
          stats: { def: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.10, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'hanabi', name: '日向花火', form: '', en: 'Hyuga Hanabi', title: '宗家次女',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'none', tags: ['输出', '封印'],
      stats: { hp: 0.9, atk: 1.15, def: 0.95, spd: 125 },
      bio: '日向日足的次女，雏田的妹妹。自幼展现出过人的柔拳天赋，被父亲视为宗家继承人严格培养。',
      quote: '姐姐，我可不会手下留情。',
      art: art({
        skin: '#f8e0cc', hair: 'hime', hairColor: '#5a3e34', eyes: 'byakugan', eyeColor: '#e6e3f5',
        outfit: 'kimono', outfitColor: '#efe3cf', accentColor: '#a0707e',
        headband: 'none', aura: '#cfe8ff'
      }),
      skills: {
        passive: {
          name: '白眼', tags: ['增益'],
          desc: '以白眼锁定破绽：暴击率+12%，速度+5%。',
          stats: { crit: 0.12, spd: 0.05 }
        },
        s1: {
          name: '柔拳', tags: ['消耗', '减益'], fx: 'fist', target: 'single', cd: 0,
          desc: '以柔拳击打敌人经络，造成95%攻击力伤害，并削减其10点查克拉。',
          effects: [{ type: 'dmg', mult: 0.95 }, { type: 'drain', value: 10 }]
        },
        s2: {
          name: '八卦空掌', tags: ['输出', '穿透'], fx: 'chakra', target: 'back', cd: 3,
          desc: '隔空推出掌压直击最后排的敌人，造成160%攻击力伤害（无视25%防御）。',
          effects: [{ type: 'dmg', mult: 1.6, pierce: 0.25 }]
        },
        ult: {
          name: '八卦六十四掌', tags: ['爆发', '封印'], fx: 'fist', target: 'single',
          desc: '踏入八卦领域连续封闭敌人经络，造成8段共272%攻击力伤害，并封印目标1回合（只能使用技能1）。',
          effects: [{ type: 'dmg', mult: 0.34, hits: 8 }, { type: 'status', status: 'silence', turns: 1 }]
        },
        awaken: {
          name: '宗家继承者', tags: ['增益', '回能'],
          desc: '攻击力+10%；击败敌人时获得30点查克拉。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'chakra', value: 30, to: 'self' }] }]
        }
      }
    },

    {
      id: 'hizashi', name: '日向日差', form: '', en: 'Hyuga Hizashi', title: '日向分家',
      faction: 'konoha', rarity: 'SR', role: 'sup', element: 'none', tags: ['护盾', '增益'],
      stats: { hp: 1.05, atk: 1.0, def: 1.0, spd: 110 },
      bio: '日向日足的双胞胎弟弟，宁次的父亲，因生为分家而被刻上笼中鸟咒印。在日向事件中，他以自己的意志代替哥哥赴死，守护了宗家与村子的和平。',
      quote: '这是我自己选择的道路。',
      art: art({
        skin: '#f3d6be', hair: 'long_straight', hairColor: '#2b2422', eyes: 'byakugan', eyeColor: '#e6e3f5',
        outfit: 'robe', outfitColor: '#bfb59e', accentColor: '#3e3226', aura: '#cfe8ff'
      }),
      skills: {
        passive: {
          name: '笼中鸟', tags: ['增益'],
          desc: '背负分家的咒印仍坚守日向之道：生命+8%，防御+8%；每当有友方阵亡时，攻击力提升20%（2回合）。',
          stats: { hp: 0.08, def: 0.08 },
          triggers: [{ on: 'on_ally_death', effects: [{ type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'self' }] }]
        },
        s1: {
          name: '柔拳', tags: ['消耗', '减益'], fx: 'fist', target: 'single', cd: 0,
          desc: '以柔拳打击敌人经络，造成100%攻击力伤害，并降低其防御12%（2回合）。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'debuff', stat: 'def', value: 0.12, turns: 2 }]
        },
        s2: {
          name: '八卦六十四掌', tags: ['输出', '封印'], fx: 'fist', target: 'single', cd: 3,
          desc: '连续点穴封闭敌人经络，造成8段共176%攻击力伤害，并封印目标1回合（只能使用技能1）。',
          effects: [{ type: 'dmg', mult: 0.22, hits: 8 }, { type: 'status', status: 'silence', turns: 1 }]
        },
        ult: {
          name: '八卦掌回天', tags: ['群攻', '护盾'], fx: 'shield', target: 'all',
          desc: '全力旋转释放查克拉守护身后的家人，对全体敌人造成150%攻击力伤害，并为全体友方提供50%攻击力的护盾（2回合）。',
          effects: [{ type: 'dmg', mult: 1.5 }, { type: 'shield', mult: 0.5, turns: 2, to: 'ally_all' }]
        },
        awaken: {
          name: '自由之鸟', tags: ['治疗', '增益'],
          desc: '攻击力+10%；阵亡时以自己选择的意志守护同伴，为全体友方恢复20%最大生命，并使其攻击力提升20%（2回合）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'heal', pct: 0.2, to: 'ally_all' },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'ally_all' }
          ] }]
        }
      }
    },

    /* ===================== 猪鹿蝶 · 上一代 ===================== */
    {
      id: 'shikaku', name: '奈良鹿久', form: '', en: 'Nara Shikaku', title: '上忍班长',
      faction: 'konoha', rarity: 'SR', role: 'sup', element: 'yin', tags: ['增益', '控制'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 108 },
      bio: '奈良一族族长，鹿丸的父亲，木叶的上忍班长，智谋更胜儿子一筹。第四次忍界大战中担任忍界联军总部的参谋，最终与山中亥一一同在十尾的攻击中牺牲。',
      quote: '接下来的棋局，就交给你们了。',
      art: art({
        skin: '#efcba8', hair: 'pineapple', hairColor: '#2b2a30', eyeColor: '#3a3530',
        outfit: 'flak', outfitColor: '#5b6e3a', accentColor: '#3a3f4a',
        marks: ['beard', 'cheek_scar'], aura: '#3d4f66'
      }),
      skills: {
        passive: {
          name: '战术部署', tags: ['增益'],
          desc: '攻击力+5%；战斗开始时为全体友方提升10%攻击力与10%速度（2回合）。',
          stats: { atk: 0.05 },
          triggers: [{ on: 'battle_start', effects: [
            { type: 'buff', stat: 'atk', value: 0.1, turns: 2, to: 'ally_all' },
            { type: 'buff', stat: 'spd', value: 0.1, turns: 2, to: 'ally_all' }
          ] }]
        },
        s1: {
          name: '影子缝合术', tags: ['消耗', '控制'], fx: 'shadow', target: 'single', cd: 0,
          desc: '影子化作细针贯穿敌人，造成100%攻击力伤害，并有30%概率使其束缚1回合。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'status', status: 'bind', turns: 1, chance: 0.3 }]
        },
        s2: {
          name: '战术指挥', tags: ['增益'], fx: 'shadow', target: 'ally_all', cd: 3,
          desc: '洞察战局后下达指令，使全体友方攻击力提升25%、暴击率提升10%（2回合）。',
          effects: [{ type: 'buff', stat: 'atk', value: 0.25, turns: 2 }, { type: 'buff', stat: 'crit', value: 0.1, turns: 2 }]
        },
        ult: {
          name: '影子模仿术', tags: ['群攻', '控制', '减益'], fx: 'shadow', target: 'all',
          desc: '将影子同时延伸至整个战场扼住敌人，对全体敌人造成80%攻击力伤害，有50%概率使其束缚1回合，并降低其防御20%（2回合）。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.5 },
            { type: 'debuff', stat: 'def', value: 0.2, turns: 2 }
          ]
        },
        awaken: {
          name: '最后的战术', tags: ['增益'],
          desc: '攻击力+10%；阵亡时将最后的战术传达给全军，使全体友方暴击率提升15%、伤害提升15%（2回合）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'buff', stat: 'crit', value: 0.15, turns: 2, to: 'ally_all' },
            { type: 'buff', stat: 'dmg', value: 0.15, turns: 2, to: 'ally_all' }
          ] }]
        }
      }
    },

    {
      id: 'inoichi', name: '山中亥一', form: '', en: 'Yamanaka Inoichi', title: '山中族长',
      faction: 'konoha', rarity: 'SR', role: 'sup', element: 'yin', tags: ['回能', '控制'],
      stats: { hp: 1.0, atk: 0.95, def: 1.05, spd: 104 },
      bio: '山中一族族长，井野的父亲，上一代猪鹿蝶之一，在木叶情报部负责审讯与情报分析。第四次忍界大战中以心传身之术连接整个忍界联军，最终与奈良鹿久一同牺牲。',
      quote: '井野，你是爸爸的骄傲。',
      art: art({
        skin: '#f3d3b3', hair: 'low_ponytail', hairColor: '#e8cd6e', eyeColor: '#4f8fa8',
        outfit: 'flak', outfitColor: '#5b6e3a', accentColor: '#7a2a2a', aura: '#ffe066'
      }),
      skills: {
        passive: {
          name: '情报分析', tags: ['回能'],
          desc: '每回合开始时，为随机一名友方增加10点查克拉。',
          triggers: [{ on: 'turn_start', effects: [{ type: 'chakra', value: 10, to: 'ally_random' }] }]
        },
        s1: {
          name: '心乱身之术', tags: ['消耗', '减益'], fx: 'mind', target: 'single', cd: 0,
          desc: '侵入敌人神经扰乱其行动，令其自伤造成100%攻击力伤害，并降低其防御12%（2回合）。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'debuff', stat: 'def', value: 0.12, turns: 2 }]
        },
        s2: {
          name: '心转身之术', tags: ['控制', '减益'], fx: 'mind', target: 'highest_atk', cd: 4,
          desc: '将精神转移到攻击力最高的敌人体内，造成80%攻击力伤害，有70%概率使其眩晕1回合，并削减其20点查克拉。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.7 },
            { type: 'drain', value: 20 }
          ]
        },
        ult: {
          name: '心传身之术', tags: ['回能', '增益', '净化'], fx: 'mind', target: 'ally_all',
          desc: '以心传身之术连接全体友方的意识，使全体友方获得25点查克拉、攻击力提升25%（2回合），并解除其减益与控制状态。',
          effects: [
            { type: 'chakra', value: 25, to: 'ally_all' },
            { type: 'buff', stat: 'atk', value: 0.25, turns: 2 },
            { type: 'cleanse', to: 'ally_all' }
          ]
        },
        awaken: {
          name: '最后的通讯', tags: ['回能', '净化'],
          desc: '防御+10%；阵亡时将意识传遍全军，使全体友方获得25点查克拉，并解除其减益与控制状态。',
          stats: { def: 0.10 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'chakra', value: 25, to: 'ally_all' },
            { type: 'cleanse', to: 'ally_all' }
          ] }]
        }
      }
    },

    {
      id: 'choza', name: '秋道丁座', form: '', en: 'Akimichi Choza', title: '秋道族长',
      faction: 'konoha', rarity: 'SR', role: 'tank', element: 'yang', tags: ['嘲讽', '护盾'],
      stats: { hp: 1.2, atk: 0.9, def: 1.0, spd: 85 },
      bio: '秋道一族族长，丁次的父亲，上一代猪鹿蝶之一。为人豪爽温厚，总是鼓励缺乏自信的儿子，佩恩袭击木叶时与丁次一同挺身迎战。',
      quote: '丁次，你是秋道一族的骄傲！',
      art: art({
        skin: '#efc49a', hair: 'wild_long', hairColor: '#b8322a', eyeColor: '#3a2a1a',
        outfit: 'armor', outfitColor: '#9e2b25', accentColor: '#e0c060',
        marks: ['swirl_cheeks'], aura: '#ffb74d'
      }),
      skills: {
        passive: {
          name: '秋道族长', tags: ['护盾'],
          desc: '生命+10%；每回合开始时获得5%最大生命的护盾（2回合）。',
          stats: { hp: 0.10 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'shield', pct: 0.05, turns: 2, to: 'self' }] }]
        },
        s1: {
          name: '部分倍化之术', tags: ['消耗', '护盾'], fx: 'fist', target: 'single', cd: 0,
          desc: '将手臂倍化为巨掌拍向敌人，造成100%攻击力伤害，并获得20%攻击力的护盾（2回合）。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'shield', mult: 0.2, turns: 2, to: 'self' }]
        },
        s2: {
          name: '倍化之术', tags: ['嘲讽', '护盾'], fx: 'shield', target: 'ally_all', cd: 4,
          desc: '身体膨胀为巨人挡在同伴身前，嘲讽敌人2回合，为全体友方提供10%最大生命的护盾（2回合），并使自身防御提升20%（2回合）。',
          effects: [
            { type: 'taunt', turns: 2, to: 'self' },
            { type: 'shield', pct: 0.10, turns: 2 },
            { type: 'buff', stat: 'def', value: 0.2, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '秘传·超倍化之术', tags: ['群攻', '控制', '护盾'], fx: 'fist', target: 'all',
          desc: '全身膨胀至山岳般巨大，以巨拳轰击全体敌人，造成150%攻击力伤害，有40%概率使其眩晕1回合，并获得20%最大生命的护盾（2回合）。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 },
            { type: 'shield', pct: 0.2, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '秋道之魂', tags: ['治疗', '增益'],
          desc: '生命+10%，防御+5%；生命低于30%时恢复30%最大生命，并免疫控制2回合。',
          stats: { hp: 0.10, def: 0.05 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.3, to: 'self' },
            { type: 'immune', turns: 2, to: 'self' }
          ] }]
        }
      }
    },

    /* ===================== 犬冢一族 ===================== */
    {
      id: 'tsume', name: '犬冢爪', form: '', en: 'Inuzuka Tsume', title: '犬冢族长',
      faction: 'konoha', rarity: 'R', role: 'atk', element: 'none', tags: ['输出', '持续'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 128 },
      bio: '犬冢一族族长，牙与花的母亲，性格豪爽泼辣、作风强悍。与独眼的巨型忍犬黑丸搭档，配合之默契更胜儿子与赤丸。',
      quote: '黑丸，让他们见识犬冢的獠牙！',
      art: art({
        skin: '#e8bb92', hair: 'wild_long', hairColor: '#3d2516', eyeColor: '#4a2a12',
        outfit: 'flak', outfitColor: '#5b6e3a', accentColor: '#5a3a22',
        marks: ['fangs'], accessory: 'dog', aura: '#a1887f'
      }),
      skills: {
        passive: {
          name: '忍犬·黑丸', tags: ['持续', '增益'],
          desc: '速度+5%；技能命中后有30%概率由黑丸撕咬目标，使其流血2回合（每回合25%攻击力）。',
          stats: { spd: 0.05 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'status', status: 'bleed', turns: 2, value: 0.25, to: 'target' }] }]
        },
        s1: {
          name: '通牙', tags: ['消耗', '斩杀'], fx: 'beast', target: 'lowest', cd: 0,
          desc: '嗅出最虚弱的猎物，高速旋转冲撞生命比例最低的敌人，造成2段共100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.5, hits: 2 }]
        },
        s2: {
          name: '兽人分身', tags: ['增益'], fx: 'clone', target: 'self', cd: 3,
          desc: '黑丸化作与自己一模一样的分身并肩作战，自身攻击力提升25%、暴击率提升15%（2回合）。',
          effects: [{ type: 'buff', stat: 'atk', value: 0.25, turns: 2 }, { type: 'buff', stat: 'crit', value: 0.15, turns: 2 }]
        },
        ult: {
          name: '牙通牙', tags: ['输出', '爆发', '持续'], fx: 'beast', target: 'random', count: 3,
          desc: '与黑丸化作两道旋转利牙反复冲撞，对随机3名敌人各造成2段共150%攻击力伤害，并有60%概率使其流血2回合（每回合25%攻击力）。',
          effects: [{ type: 'dmg', mult: 0.75, hits: 2 }, { type: 'status', status: 'bleed', turns: 2, chance: 0.6, value: 0.25 }]
        },
        awaken: {
          name: '犬冢之牙', tags: ['回能', '增益'],
          desc: '攻击力+10%；击败敌人时获得30点查克拉，并使攻击力提升15%（2回合）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_kill', effects: [
            { type: 'chakra', value: 30, to: 'self' },
            { type: 'buff', stat: 'atk', value: 0.15, turns: 2, to: 'self' }
          ] }]
        }
      }
    },

    {
      id: 'hana', name: '犬冢花', form: '', en: 'Inuzuka Hana', title: '忍犬兽医',
      faction: 'konoha', rarity: 'R', role: 'heal', element: 'none', tags: ['治疗', '召唤'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 112 },
      bio: '犬冢爪的长女，牙的姐姐，是木叶的兽医忍者。与灰丸三兄弟搭档作战，擅长为忍犬与同伴治疗伤势。',
      quote: '受伤了就交给我，乖乖别乱动。',
      art: art({
        skin: '#efc49e', hair: 'low_ponytail', hairColor: '#4a2e1c', eyeColor: '#4a2a12',
        outfit: 'flak', outfitColor: '#5b6e3a', accentColor: '#4a2e1c',
        marks: ['fangs'], accessory: 'dog', aura: '#69f0ae'
      }),
      skills: {
        passive: {
          name: '兽医忍术', tags: ['治疗'],
          desc: '每回合开始时，为生命最低的友方恢复30%攻击力的生命值。',
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', mult: 0.3, to: 'ally_lowest' }] }]
        },
        s1: {
          name: '灰丸三兄弟', tags: ['消耗', '召唤'], fx: 'beast', target: 'single', cd: 0,
          desc: '指挥灰丸三兄弟轮番扑咬敌人，造成3段共90%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.3, hits: 3 }]
        },
        s2: {
          name: '掌仙术', tags: ['治疗'], fx: 'heal', target: 'ally_all', cd: 3,
          desc: '以医疗查克拉为全体友方疗伤，恢复其100%攻击力的生命值。',
          effects: [{ type: 'heal', mult: 1.0 }]
        },
        ult: {
          name: '牙通牙', tags: ['群攻', '治疗'], fx: 'beast', target: 'all',
          desc: '与灰丸三兄弟化作四道旋转利牙冲击全体敌人，造成100%攻击力伤害，随后为全体友方恢复60%攻击力的生命值。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'heal', mult: 0.6, to: 'ally_all' }]
        },
        awaken: {
          name: '兽医的仁心', tags: ['治疗', '净化'],
          desc: '攻击力+10%；生命低于30%时为全体友方恢复15%最大生命，并解除其减益与控制状态。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.15, to: 'ally_all' },
            { type: 'cleanse', to: 'ally_all' }
          ] }]
        }
      }
    },

    /* ===================== 油女一族 ===================== */
    {
      id: 'shibi', name: '油女志微', form: '', en: 'Aburame Shibi', title: '油女族长',
      faction: 'konoha', rarity: 'R', role: 'tank', element: 'none', tags: ['嘲讽', '减益'],
      stats: { hp: 1.1, atk: 0.95, def: 1.0, spd: 90 },
      bio: '油女一族族长，志乃的父亲。与儿子一样沉默寡言、做事一丝不苟，体内寄宿的寄坏虫数量远超常人，能以虫群筑起坚固的屏障。',
      quote: '虫子，是不会说谎的。',
      art: art({
        skin: '#f1d3b5', hair: 'spiky', hairColor: '#2b231c', eyes: 'dark',
        outfit: 'highcollar', outfitColor: '#5e6150', accentColor: '#2f2f2f',
        marks: ['sunglasses', 'mustache'], aura: '#8d7a4a'
      }),
      skills: {
        passive: {
          name: '油女秘传', tags: ['减益', '增益'],
          desc: '防御+10%；受到攻击时有30%概率令寄坏虫吸食攻击者10点查克拉。',
          stats: { def: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'drain', value: 10, to: 'attacker' }] }]
        },
        s1: {
          name: '寄坏虫之术', tags: ['消耗', '护盾'], fx: 'insect', target: 'single', cd: 0,
          desc: '放出寄坏虫啃噬敌人，造成90%攻击力伤害，并获得15%攻击力的护盾（2回合）。',
          effects: [{ type: 'dmg', mult: 0.9 }, { type: 'shield', mult: 0.15, turns: 2, to: 'self' }]
        },
        s2: {
          name: '秘术·虫玉', tags: ['群攻', '减益'], fx: 'insect', target: 'all', cd: 4,
          desc: '放出虫群结成虫球包围敌阵，对全体敌人造成70%攻击力伤害，并吸食其15点查克拉。',
          effects: [{ type: 'dmg', mult: 0.7 }, { type: 'drain', value: 15 }]
        },
        ult: {
          name: '虫壁之术', tags: ['嘲讽', '护盾', '反击'], fx: 'insect', target: 'ally_all',
          desc: '令寄坏虫聚成厚实的虫墙守护全队，为全体友方提供15%最大生命的护盾（2回合），嘲讽敌人2回合，并获得反击状态2回合（反击60%攻击力）。',
          effects: [
            { type: 'shield', pct: 0.15, turns: 2 },
            { type: 'taunt', turns: 2, to: 'self' },
            { type: 'counter', mult: 0.6, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '千虫之铠', tags: ['护盾', '嘲讽'],
          desc: '防御+10%；生命低于30%时获得30%最大生命的护盾（2回合），并嘲讽敌人2回合。',
          stats: { def: 0.10 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'shield', pct: 0.3, turns: 2, to: 'self' },
            { type: 'taunt', turns: 2, to: 'self' }
          ] }]
        }
      }
    }

  ]);
})(typeof window !== 'undefined' ? window : globalThis);
