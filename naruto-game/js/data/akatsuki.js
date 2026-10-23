/* js/data/akatsuki.js — 晓组织、雨隐与大筒木一族
 * 晓的全体成员（鼬两形态、鬼鲛、迪达拉、蝎、飞段、角都、佩恩天道、长门、小南、白绝、黑绝、带土两形态）、
 * 雨隐村（弥彦、山椒鱼半藏）以及大筒木一族（辉夜、羽衣、羽村、因陀罗、阿修罗）。
 * 仅收录《火影忍者》与《火影忍者疾风传》时期的角色、形态与忍术（不含任何博人传内容）。
 */
(function () {
  'use strict';

  var AKA = '#1a1a24';   // 晓袍底色
  var CLOUD = '#c62828'; // 红云

  NG.defineChars('akatsuki', [

    /* ============================ 宇智波鼬 ============================ */
    {
      id: 'itachi', name: '宇智波鼬', form: '', en: 'Uchiha Itachi', title: '暗中守护者',
      faction: 'akatsuki', rarity: 'SSR', role: 'ctrl', element: 'fire', tags: ['控制', '持续', '闪避'],
      stats: { hp: 0.9, atk: 1.12, def: 0.95, spd: 128 },
      bio: '宇智波一族的天才，13岁便成为暗部分队长。为保护木叶奉命亲手灭族，背负叛忍的污名加入晓组织，暗中守护着弟弟佐助，最终在与佐助的决战中病逝。',
      quote: '原谅我，佐助……这是最后一次了。',
      art: {
        type: 'human', skin: '#f1d6bf', hair: 'low_ponytail', hairColor: '#15161d',
        eyes: 'ms_itachi', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'konoha', headbandSlash: true, headbandPos: 'forehead',
        marks: ['tear_lines'], mask: 'none', hat: 'none', accessory: 'none', aura: '#d32f2f'
      },
      skills: {
        passive: {
          name: '万花筒写轮眼', tags: ['增益', '闪避'],
          desc: '洞察敌人的一切动作：闪避率+12%，暴击率+10%；但身患重病，生命值-5%。战斗开始时获得25点查克拉。',
          stats: { dodge: 0.12, crit: 0.10, hp: -0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 25 }] }]
        },
        s1: {
          name: '火遁·豪火球之术', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 0,
          desc: '从口中喷出巨大的火球，造成115%攻击力伤害，并有30%概率使目标灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.15 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '天照', tags: ['持续', '爆发'], fx: 'amaterasu', target: 'single', cd: 3,
          desc: '以万花筒写轮眼凝视目标，燃起不灭的黑炎，造成170%攻击力伤害，并使其灼烧3回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.7 },
            { type: 'status', status: 'burn', turns: 3, value: 0.4 }
          ]
        },
        ult: {
          name: '月读', tags: ['控制', '单体', '减益'], fx: 'eye', target: 'single',
          desc: '将目标拖入月读的精神世界，于一瞬间承受72小时的折磨：造成280%攻击力伤害，使其眩晕2回合，并降低其防御20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 2.8 },
            { type: 'status', status: 'stun', turns: 2 },
            { type: 'debuff', stat: 'def', value: 0.2, turns: 2 }
          ]
        },
        awaken: {
          name: '乌鸦分身之术', tags: ['闪避', '控制'],
          desc: '攻击力+10%，闪避率+8%；受到攻击时有30%概率化作群鸦散开并反施幻术，使攻击者陷入睡眠1回合。',
          stats: { atk: 0.10, dodge: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'status', status: 'sleep', turns: 1, to: 'attacker' }] }]
        }
      }
    },

    {
      id: 'itachi_edo', name: '宇智波鼬', form: '秽土转生', en: 'Uchiha Itachi', title: '永远的兄长',
      faction: 'akatsuki', rarity: 'UR', role: 'atk', element: 'fire', tags: ['输出', '封印', '护盾'],
      stats: { hp: 1.0, atk: 1.1, def: 0.95, spd: 125 },
      bio: '被药师兜以秽土转生召唤，借植入乌鸦中的止水之眼“别天神”摆脱控制，并以须佐能乎的十拳剑封印了长门。随后与佐助联手，以伊邪那美令兜醒悟、解除秽土转生，消散前向弟弟说出了“我会永远爱你”。',
      quote: '无论你今后如何，我都会永远爱你。',
      art: {
        type: 'human', skin: '#e9dccf', hair: 'low_ponytail', hairColor: '#15161d',
        eyes: 'ms_itachi', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'konoha', headbandSlash: true, headbandPos: 'forehead',
        marks: ['tear_lines', 'face_lines'], mask: 'none', hat: 'none', accessory: 'sword', aura: '#ff5a3c'
      },
      skills: {
        passive: {
          name: '秽土转生', tags: ['治疗', '增益'],
          desc: '以秽土之躯重临战场：受到的伤害-10%；生命首次低于30%时，尘土重组躯体，立即恢复35%最大生命值。',
          stats: { dr: 0.10 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'heal', pct: 0.35 }] }]
        },
        s1: {
          name: '火遁·凤仙火之术', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 0,
          desc: '连续喷出数枚小火球，造成3段共123%攻击力伤害，并有20%概率使目标灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.41, hits: 3 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.2, value: 0.3 }
          ]
        },
        s2: {
          name: '须佐能乎·八咫镜', tags: ['护盾', '反击'], fx: 'shield', target: 'self', cd: 4,
          desc: '须佐能乎举起能弹开一切攻击的灵器八咫镜：获得30%最大生命值的护盾，持续2回合；免疫控制2回合，并在2回合内受到攻击时反击，造成80%攻击力伤害。',
          effects: [
            { type: 'shield', pct: 0.3, turns: 2 },
            { type: 'immune', turns: 2 },
            { type: 'counter', mult: 0.8, turns: 2 }
          ]
        },
        ult: {
          name: '须佐能乎·十拳剑', tags: ['封印', '爆发', '单体'], fx: 'susanoo', target: 'single',
          desc: '以须佐能乎挥出封印之剑十拳剑：先驱散目标的增益与护盾，再造成380%攻击力伤害（无视30%防御），并将其封印2回合（只能使用技能1）。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 3.8, pierce: 0.3 },
            { type: 'status', status: 'silence', turns: 2 }
          ]
        },
        awaken: {
          name: '伊邪那美', tags: ['控制', '增益'],
          desc: '攻击力+12%，暴击率+8%；释放必杀技后，以伊邪那美使随机一名敌人陷入无尽的循环，束缚2回合。',
          stats: { atk: 0.12, crit: 0.08 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'bind', turns: 2, to: 'enemy_random' }] }]
        }
      }
    },

    /* ============================ 干柿鬼鲛 ============================ */
    {
      id: 'kisame', name: '干柿鬼鲛', form: '', en: 'Hoshigaki Kisame', title: '无尾的尾兽',
      faction: 'akatsuki', rarity: 'SSR', role: 'tank', element: 'water', tags: ['嘲讽', '吸血', '消耗'],
      stats: { hp: 1.2, atk: 1.0, def: 0.88, spd: 100 },
      bio: '雾隐忍刀七人众之一，背负大刀“鲛肌”，查克拉量之庞大被称为“没有尾巴的尾兽”。加入晓组织后与宇智波鼬搭档，最终为守护情报召唤群鲛吞噬了自己。',
      quote: '看来我也不算太坏的人嘛……',
      art: {
        type: 'human', skin: '#86a9c7', hair: 'spiky_up', hairColor: '#2c4d7a',
        eyes: 'normal', eyeColor: '#dfe8ee', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'kiri', headbandSlash: true, headbandPos: 'forehead',
        marks: ['blue_skin_marks', 'gills'], mask: 'none', hat: 'none', accessory: 'samehada', aura: '#2196f3'
      },
      skills: {
        passive: {
          name: '鲛肌', tags: ['吸血', '消耗'],
          desc: '背后的鲛肌会自动削取查克拉：生命值+10%，吸血+10%；受到攻击时吸取攻击者10点查克拉。',
          stats: { hp: 0.10, lifesteal: 0.10 },
          triggers: [{ on: 'on_hit', effects: [{ type: 'drain', value: 10, to: 'attacker' }] }]
        },
        s1: {
          name: '大刀·鲛肌', tags: ['消耗', '吸血'], fx: 'blade', target: 'single', cd: 0,
          desc: '挥舞鲛肌削去敌人的查克拉，造成110%攻击力伤害，吸取其15点查克拉，并恢复相当于伤害20%的生命值。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'drain', value: 15 },
            { type: 'lifesteal', value: 0.2 }
          ]
        },
        s2: {
          name: '水遁·大鲛弹之术', tags: ['消耗', '嘲讽'], fx: 'water', target: 'single', cd: 3,
          desc: '放出能吸收对手查克拉而不断变大的巨鲛，造成180%攻击力伤害并吸取目标20点查克拉；同时挑衅敌人，嘲讽2回合。',
          effects: [
            { type: 'dmg', mult: 1.8 },
            { type: 'drain', value: 20 },
            { type: 'taunt', turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '水遁·水牢鲛踊之术', tags: ['群攻', '控制', '消耗'], fx: 'water', target: 'all',
          desc: '以巨大的水牢笼罩战场，鲛群在水中撕咬敌人：对全体敌人造成150%攻击力伤害，有60%概率使其束缚1回合，并吸取每人25点查克拉。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.6 },
            { type: 'drain', value: 25 }
          ]
        },
        awaken: {
          name: '鲛肌融合', tags: ['治疗', '增益'],
          desc: '攻击力+10%，防御+10%；生命首次低于30%时与鲛肌融合化身鲛人，恢复30%最大生命值，并使受到的伤害降低20%，持续3回合。',
          stats: { atk: 0.10, def: 0.10 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.3 },
            { type: 'buff', stat: 'dr', value: 0.2, turns: 3 }
          ] }]
        }
      }
    },

    /* ============================ 迪达拉 ============================ */
    {
      id: 'deidara', name: '迪达拉', form: '', en: 'Deidara', title: '爆炸艺术家',
      faction: 'akatsuki', rarity: 'SSR', role: 'atk', element: 'earth', tags: ['群攻', '爆发', '持续'],
      stats: { hp: 0.9, atk: 1.2, def: 0.88, spd: 115 },
      bio: '岩隐村爆破部队出身的叛忍，双手掌心长着嘴，能将查克拉混入黏土制成起爆黏土，信奉“艺术就是爆炸”。被宇智波鼬击败后加入晓组织，最终在与佐助的决战中发动自爆·C0身亡。',
      quote: '艺术……就是爆炸！嗯！',
      art: {
        type: 'human', skin: '#f5d6b5', hair: 'long_bang', hairColor: '#f2d15c',
        eyes: 'normal', eyeColor: '#4a8fd6', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'iwa', headbandSlash: true, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'clay', aura: '#ffca28'
      },
      skills: {
        passive: {
          name: '左眼瞄准镜', tags: ['增益'],
          desc: '经过修炼的左眼配合瞄准镜能锁定目标并抵御写轮眼的幻术：暴击率+12%；战斗开始时免疫控制2回合。',
          stats: { crit: 0.12 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'immune', turns: 2 }] }]
        },
        s1: {
          name: '起爆黏土·C1', tags: ['输出', '消耗'], fx: 'explosion', target: 'single', cd: 0,
          desc: '捏出小型黏土飞鸟与蜘蛛钻向敌人后引爆，造成120%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.2 }]
        },
        s2: {
          name: '起爆黏土·C2龙', tags: ['群攻', '减益'], fx: 'explosion', target: 'all', cd: 3,
          desc: '乘上巨大的C2黏土龙从空中投下黏土炸弹，对全体敌人造成100%攻击力伤害，并降低其防御15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: 'C4·迦楼罗', tags: ['群攻', '持续', '爆发'], fx: 'explosion', target: 'all',
          desc: '化身巨大的黏土像后崩散成无数微型炸弹，随呼吸侵入敌人体内从细胞层面引爆：对全体敌人造成180%攻击力伤害，并使其中毒3回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.8 },
            { type: 'status', status: 'poison', turns: 3, value: 0.4 }
          ]
        },
        awaken: {
          name: '自爆·C0', tags: ['群攻', '爆发'],
          desc: '攻击力+12%；阵亡时将自身化为终极艺术C0引爆，对全体敌人造成220%攻击力伤害。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_death', effects: [{ type: 'dmg', mult: 2.2, to: 'enemy_all' }] }]
        }
      }
    },

    /* ============================ 蝎 ============================ */
    {
      id: 'sasori', name: '蝎', form: '赤砂之蝎', en: 'Sasori', title: '天才傀儡师',
      faction: 'akatsuki', rarity: 'SSR', role: 'atk', element: 'wind', tags: ['持续', '召唤', '群攻'],
      stats: { hp: 0.92, atk: 1.15, def: 0.95, spd: 112 },
      bio: '砂隐村出身的天才傀儡师，人称“赤砂之蝎”。他将自己的身体改造成人傀儡以追求永恒之美，并把三代目风影制成了最强的人傀儡；在与千代、春野樱的战斗中，被父母的傀儡刺穿核心而亡。',
      quote: '我最讨厌等待，也讨厌让人等待。',
      art: {
        type: 'human', skin: '#f3d5c0', hair: 'messy', hairColor: '#b3262e',
        eyes: 'normal', eyeColor: '#8a5a3c', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'suna', headbandSlash: true, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'puppet', aura: '#d4a85a'
      },
      skills: {
        passive: {
          name: '人傀儡', tags: ['持续', '增益'],
          desc: '将自身改造为人傀儡，全身遍布涂毒的机关：受到的伤害-12%；攻击命中时有25%概率使目标中毒2回合（每回合30%攻击力）。',
          stats: { dr: 0.12 },
          triggers: [{ on: 'on_attack', chance: 0.25, effects: [{ type: 'status', status: 'poison', turns: 2, value: 0.3 }] }]
        },
        s1: {
          name: '傀儡术·绯流琥', tags: ['消耗', '持续'], fx: 'puppet', target: 'single', cd: 0,
          desc: '操纵傀儡绯流琥甩出淬毒的蝎尾，造成110%攻击力伤害，并有40%概率使目标中毒2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'poison', turns: 2, chance: 0.4, value: 0.3 }
          ]
        },
        s2: {
          name: '砂铁时雨', tags: ['群攻', '持续'], fx: 'magnet', target: 'all', cd: 3,
          desc: '操纵三代目风影的傀儡，将带毒的砂铁化作细雨洒向全场，对全体敌人造成90%攻击力伤害，并使其中毒2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'status', status: 'poison', turns: 2, value: 0.3 }
          ]
        },
        ult: {
          name: '赤秘技·百机操演', tags: ['群攻', '召唤', '持续'], fx: 'puppet', target: 'all',
          desc: '从胸口放出查克拉丝同时操纵一百具傀儡围攻，对全体敌人造成6段共180%攻击力伤害，并使其中毒3回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.3, hits: 6 },
            { type: 'status', status: 'poison', turns: 3, value: 0.4 }
          ]
        },
        awaken: {
          name: '砂铁界法', tags: ['群攻', '增益'],
          desc: '攻击力+12%；释放必杀技后，以三代目风影的砂铁界法化作无数尖刺向四周扩散，对全体敌人追加60%攻击力伤害。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'dmg', mult: 0.6, to: 'enemy_all' }] }]
        }
      }
    },

    /* ============================ 飞段 ============================ */
    {
      id: 'hidan', name: '飞段', form: '', en: 'Hidan', title: '邪神教信徒',
      faction: 'akatsuki', rarity: 'SR', role: 'tank', element: 'none', tags: ['嘲讽', '反击', '穿透'],
      stats: { hp: 1.15, atk: 1.05, def: 0.85, spd: 105 },
      bio: '汤隐村出身的叛忍，狂热信奉邪神教并拥有不死之身。与角都搭档，以诅咒之术“死司凭血”杀死了猿飞阿斯玛，后被奈良鹿丸炸碎身躯，埋入奈良一族的森林深处。',
      quote: '向邪神大人献上祭品吧！',
      art: {
        type: 'human', skin: '#f0d9c4', hair: 'slick_back', hairColor: '#cfd6dc',
        eyes: 'normal', eyeColor: '#b05ab8', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'scythe', aura: '#d32f2f'
      },
      skills: {
        passive: {
          name: '不死之身', tags: ['治疗', '增益'],
          desc: '邪神教赐予的不死之身：生命值+10%，受到的伤害-8%；生命首次低于30%时恢复35%最大生命值，并使防御提升30%，持续3回合。',
          stats: { hp: 0.10, dr: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.35 },
            { type: 'buff', stat: 'def', value: 0.3, turns: 3 }
          ] }]
        },
        s1: {
          name: '三刃大镰', tags: ['消耗', '持续'], fx: 'blade', target: 'single', cd: 0,
          desc: '甩出以钢索相连的三刃大镰撕裂敌人，造成105%攻击力伤害，并有40%概率使目标流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'status', status: 'bleed', turns: 2, chance: 0.4, value: 0.3 }
          ]
        },
        s2: {
          name: '邪神教·仪式', tags: ['嘲讽', '反击', '护盾'], fx: 'seal', target: 'self', cd: 3,
          desc: '以鲜血在脚下画出邪神教的阵法，身体化为黑白相间的诅咒形态：嘲讽敌人2回合，获得15%最大生命值的护盾（持续2回合），并在2回合内受到攻击时反击，造成70%攻击力伤害。',
          effects: [
            { type: 'taunt', turns: 2 },
            { type: 'shield', pct: 0.15, turns: 2 },
            { type: 'counter', mult: 0.7, turns: 2 }
          ]
        },
        ult: {
          name: '咒术·死司凭血', tags: ['穿透', '持续', '单体'], fx: 'seal', target: 'single',
          desc: '舔舐目标的鲜血完成诅咒，以黑棒刺穿自己的身体将痛苦同步给对方：造成170%攻击力伤害，额外造成目标最大生命值20%的真实伤害，并使其流血3回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.7 },
            { type: 'true_dmg', pct: 0.2 },
            { type: 'status', status: 'bleed', turns: 3, value: 0.4 }
          ]
        },
        awaken: {
          name: '邪神教·祈祷', tags: ['吸血', '治疗'],
          desc: '攻击力+10%，吸血+10%；每击败一名敌人便向邪神大人祈祷，恢复20%最大生命值。',
          stats: { atk: 0.10, lifesteal: 0.10 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'heal', pct: 0.2 }] }]
        }
      }
    },

    /* ============================ 角都 ============================ */
    {
      id: 'kakuzu', name: '角都', form: '', en: 'Kakuzu', title: '赏金猎人',
      faction: 'akatsuki', rarity: 'SSR', role: 'tank', element: 'earth', tags: ['吸血', '群攻', '穿透'],
      stats: { hp: 1.15, atk: 1.05, def: 0.88, spd: 92 },
      bio: '泷隐村出身的老牌忍者，曾与初代火影千手柱间交手。他以禁术“地怨虞”夺取他人心脏延续生命，体内寄存五颗心脏并能使用五种性质变化，嗜钱如命；最终被鸣人的风遁·螺旋手里剑重创，由旗木卡卡西了结。',
      quote: '这世上能信任的只有钱。',
      art: {
        type: 'human', skin: '#b98d6a', hair: 'long_straight', hairColor: '#3a2a1e',
        eyes: 'normal', eyeColor: '#4caf50', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'taki', headbandSlash: true, headbandPos: 'forehead',
        marks: ['stitches'], mask: 'cloth', hat: 'hood_up', accessory: 'none', aura: '#6d4c41'
      },
      skills: {
        passive: {
          name: '地怨虞', tags: ['吸血', '治疗'],
          desc: '以黑色触手缝合身躯、夺取他人心脏：生命值+10%，吸血+8%；每击败一名敌人夺取其心脏，恢复25%最大生命值。',
          stats: { hp: 0.10, lifesteal: 0.08 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'heal', pct: 0.25 }] }]
        },
        s1: {
          name: '土遁·土矛', tags: ['消耗', '增益'], fx: 'earth', target: 'single', cd: 0,
          desc: '将身体硬化如岩石后重拳出击，造成105%攻击力伤害，并使自身防御提升20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'buff', stat: 'def', value: 0.2, turns: 2, to: 'self' }
          ]
        },
        s2: {
          name: '雷遁·伪暗', tags: ['穿透', '单体', '控制'], fx: 'lightning', target: 'single', cd: 3,
          desc: '雷遁面具怪喷出长枪般贯穿一切的雷电，造成190%攻击力伤害（无视30%防御），并有30%概率使目标眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.9, pierce: 0.3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        ult: {
          name: '火遁·头刻苦', tags: ['群攻', '持续'], fx: 'fire', target: 'all',
          desc: '火遁面具怪与风遁·压害的面具怪合力，掀起席卷战场的烈焰风暴：对全体敌人造成2段共160%攻击力伤害，并使其灼烧2回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.8, hits: 2 },
            { type: 'status', status: 'burn', turns: 2, value: 0.35 }
          ]
        },
        awaken: {
          name: '五颗心脏', tags: ['治疗', '增益'],
          desc: '防御+10%，攻击力+8%；生命首次低于30%时消耗一颗备用心脏，恢复40%最大生命值，并使攻击力提升25%，持续3回合。',
          stats: { def: 0.10, atk: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.4 },
            { type: 'buff', stat: 'atk', value: 0.25, turns: 3 }
          ] }]
        }
      }
    },

    /* ============================ 佩恩 · 天道 ============================ */
    {
      id: 'pain', name: '佩恩', form: '天道', en: 'Pain', title: '雨隐之神',
      faction: 'akatsuki', rarity: 'SSR', role: 'ctrl', element: 'yin', tags: ['控制', '群攻', '护盾'],
      stats: { hp: 1.0, atk: 1.1, def: 0.95, spd: 110 },
      bio: '长门以轮回眼操纵的六具躯体之一，天道的躯体原是挚友弥彦。他作为晓的首领自称为“神”，为让世人体会痛苦而袭击木叶，以神罗天征将村子夷为平地，最终被仙人模式的鸣人击败。',
      quote: '感受痛苦吧，思考痛苦吧，接受痛苦吧。',
      art: {
        type: 'human', skin: '#f1d3bc', hair: 'spiky', hairColor: '#e8731e',
        eyes: 'rinnegan', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'ame', headbandSlash: true, headbandPos: 'forehead',
        marks: ['piercings'], mask: 'none', hat: 'none', accessory: 'none', aura: '#9575cd'
      },
      skills: {
        passive: {
          name: '轮回眼', tags: ['增益', '闪避'],
          desc: '六道共享视野，死角无所遁形：闪避率+10%，暴击率+10%；战斗开始时获得20点查克拉。',
          stats: { dodge: 0.10, crit: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '万象天引', tags: ['消耗', '减益'], fx: 'gravity', target: 'single', cd: 0,
          desc: '以引力将敌人强行拉到身前，再以查克拉接收棒刺穿，造成110%攻击力伤害，并降低其速度15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'debuff', stat: 'spd', value: 0.15, turns: 2 }
          ]
        },
        s2: {
          name: '神罗天征', tags: ['群攻', '护盾'], fx: 'gravity', target: 'all', cd: 3,
          desc: '以斥力弹开周围的一切，对全体敌人造成90%攻击力伤害，并为自身提供20%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'shield', pct: 0.2, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '地爆天星', tags: ['群攻', '控制'], fx: 'gravity', target: 'all',
          desc: '向空中射出引力核心，吸附岩石形成巨大的球体困住敌人：对全体敌人造成150%攻击力伤害，并有80%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.8 }
          ]
        },
        awaken: {
          name: '佩恩六道', tags: ['减益', '回能'],
          desc: '攻击力+12%；释放必杀技后，饿鬼道与人间道相继出手，吸取随机一名敌人30点查克拉，并使自身获得15点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [
            { type: 'drain', value: 30, to: 'enemy_random' },
            { type: 'chakra', value: 15 }
          ] }]
        }
      }
    },

    /* ============================ 长门 ============================ */
    {
      id: 'nagato', name: '长门', form: '秽土转生', en: 'Nagato', title: '轮回眼之主',
      faction: 'akatsuki', rarity: 'SSR', role: 'heal', element: 'yin', tags: ['复活', '治疗', '护盾'],
      stats: { hp: 0.95, atk: 1.05, def: 1.0, spd: 96 },
      bio: '漩涡一族的后裔、自来也的弟子，佩恩六道背后真正的操纵者。在木叶被鸣人说服后，他以外道·轮回天生之术复活了木叶的死者并献出生命；第四次忍界大战中被药师兜以秽土转生召回，最终被宇智波鼬以十拳剑封印。',
      quote: '我把一切都托付给你了，鸣人。',
      art: {
        type: 'human', skin: '#e6d9cc', hair: 'long_straight', hairColor: '#b3262e',
        eyes: 'rinnegan', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'none', marks: ['face_lines'], mask: 'none', hat: 'none', accessory: 'none', aura: '#b39ddb'
      },
      skills: {
        passive: {
          name: '地狱道', tags: ['治疗'],
          desc: '召唤地狱道的阎魔王修复伤者：生命值+8%；每回合开始时为生命值最低的友军恢复6%最大生命值。',
          stats: { hp: 0.08 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.06, to: 'ally_lowest' }] }]
        },
        s1: {
          name: '人间道·魂之吸取', tags: ['消耗', '减益'], fx: 'yin', target: 'single', cd: 0,
          desc: '以人间道之力从敌人体内拔取灵魂，造成100%攻击力伤害，并吸取其20点查克拉。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'drain', value: 20 }
          ]
        },
        s2: {
          name: '饿鬼道·封术吸印', tags: ['护盾', '消耗'], fx: 'chakra', target: 'all', cd: 3,
          desc: '以饿鬼道吸收敌方的忍术与查克拉：吸取全体敌人各15点查克拉，并为全体友军提供15%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'drain', value: 15 },
            { type: 'shield', pct: 0.15, turns: 2, to: 'ally_all' }
          ]
        },
        ult: {
          name: '外道·轮回天生之术', tags: ['复活', '治疗', '净化'], fx: 'heal', target: 'ally_all',
          desc: '发动轮回眼的禁术：复活一名阵亡友军并恢复其50%最大生命值（每场战斗限1次），为全体友军恢复120%攻击力的生命值，并清除全体友军的减益。',
          effects: [
            { type: 'revive', pct: 0.5 },
            { type: 'heal', mult: 1.2 },
            { type: 'cleanse', to: 'ally_all' }
          ]
        },
        awaken: {
          name: '畜生道·通灵之术', tags: ['召唤', '群攻'],
          desc: '攻击力+10%，生命值+8%；释放必杀技后，畜生道通灵出的巨型通灵兽冲入敌阵，对全体敌人造成70%攻击力伤害。',
          stats: { atk: 0.10, hp: 0.08 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'dmg', mult: 0.7, to: 'enemy_all' }] }]
        }
      }
    },

    /* ============================ 小南 ============================ */
    {
      id: 'konan', name: '小南', form: '', en: 'Konan', title: '雨隐的天使',
      faction: 'akatsuki', rarity: 'SSR', role: 'ctrl', element: 'wind', tags: ['群攻', '控制', '闪避'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 118 },
      bio: '雨隐村的战争孤儿，与长门、弥彦一同师从自来也，是晓组织的创始成员之一，能将身体化为纸片自如操纵。长门死后她离开晓守护雨隐，为保护鸣人带来的希望，以六千亿张起爆符迎战宇智波带土，最终战败身亡。',
      quote: '愿你成为通往和平的桥梁。',
      art: {
        type: 'human', skin: '#f2dbc8', hair: 'flower', hairColor: '#5b6fd6',
        eyes: 'normal', eyeColor: '#e3a64a', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'none', marks: ['lip_piercing', 'purple_eyeliner'], mask: 'none', hat: 'none',
        accessory: 'none', aura: '#e8e8f5'
      },
      skills: {
        passive: {
          name: '式纸之术', tags: ['闪避', '增益'],
          desc: '身体可随时化为无数纸片散开：闪避率+15%，速度+8%。',
          stats: { dodge: 0.15, spd: 0.08 }
        },
        s1: {
          name: '纸手里剑', tags: ['消耗', '输出'], fx: 'paper', target: 'single', cd: 0,
          desc: '将纸片折成锋利的手里剑连续射出，造成3段共114%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.38, hits: 3 }]
        },
        s2: {
          name: '式纸之舞', tags: ['群攻', '控制'], fx: 'paper', target: 'all', cd: 3,
          desc: '无数纸片如蝶群般飞舞缠绕敌人，对全体敌人造成85%攻击力伤害，并有40%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.85 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '神之使者之术', tags: ['群攻', '爆发', '斩杀'], fx: 'explosion', target: 'all',
          desc: '展开由六千亿张起爆符组成的纸海，连续引爆十分钟：对全体敌人造成4段共200%攻击力伤害，生命低于30%的敌人额外受到100%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 0.5, hits: 4 },
            { type: 'execute', threshold: 0.3, mult: 1.0 }
          ]
        },
        awaken: {
          name: '纸分身之术', tags: ['闪避', '护盾'],
          desc: '攻击力+12%；受到攻击时有30%概率以纸分身替身，获得12%最大生命值的护盾，持续1回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'shield', pct: 0.12, turns: 1, to: 'self' }] }]
        }
      }
    },

    /* ============================ 绝 · 白绝 ============================ */
    {
      id: 'zetsu', name: '绝', form: '白绝', en: 'Zetsu', title: '晓的侦察者',
      faction: 'akatsuki', rarity: 'SR', role: 'ctrl', element: 'earth', tags: ['吸血', '消耗', '闪避'],
      stats: { hp: 1.0, atk: 0.95, def: 1.0, spd: 112 },
      bio: '晓组织成员绝的白色一半，能潜入大地与树木之中侦察，并以孢子之术分裂出寄生分身吸取查克拉。白绝原是被辉夜的无限月读捕获后化成的人类，第四次忍界大战中化作十万白绝大军投入战场。',
      quote: '哎呀呀，被发现了吗？',
      art: {
        type: 'human', skin: '#f4f4f4', hair: 'short', hairColor: '#4caf50',
        eyes: 'normal', eyeColor: '#e8c547', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'none', marks: [], mask: 'zetsu', hat: 'none', accessory: 'none', aura: '#aed581'
      },
      skills: {
        passive: {
          name: '地中潜行', tags: ['闪避'],
          desc: '能与大地、树木融为一体，在地下自由穿行：闪避率+15%，速度+5%。',
          stats: { dodge: 0.15, spd: 0.05 }
        },
        s1: {
          name: '孢子之术', tags: ['消耗', '吸血'], fx: 'wood', target: 'single', cd: 0,
          desc: '将孢子分身附着在敌人身上，造成100%攻击力伤害，吸取其15点查克拉，并恢复相当于伤害20%的生命值。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'drain', value: 15 },
            { type: 'lifesteal', value: 0.2 }
          ]
        },
        s2: {
          name: '木遁·差木之术', tags: ['群攻', '减益'], fx: 'wood', target: 'all', cd: 3,
          desc: '从体内伸出无数尖锐的树枝刺向四周，对全体敌人造成85%攻击力伤害，并降低其速度15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.85 },
            { type: 'debuff', stat: 'spd', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '十万白绝大军', tags: ['群攻', '召唤', '吸血'], fx: 'clone', target: 'all',
          desc: '铺天盖地的白绝分身扑向敌阵并寄生吸取查克拉：对全体敌人造成140%攻击力伤害，吸取每人25点查克拉，并恢复相当于伤害15%的生命值。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'drain', value: 25 },
            { type: 'lifesteal', value: 0.15 }
          ]
        },
        awaken: {
          name: '变身之术', tags: ['减益', '增益'],
          desc: '攻击力+10%，闪避率+5%；战斗开始时化身为敌方忍者、连查克拉都完美模仿以混入敌阵，使随机一名敌人攻击力降低20%，持续2回合。',
          stats: { atk: 0.10, dodge: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'debuff', stat: 'atk', value: 0.2, turns: 2, to: 'enemy_random' }] }]
        }
      }
    },

    /* ============================ 黑绝 ============================ */
    {
      id: 'black_zetsu', name: '黑绝', form: '', en: 'Kuro Zetsu', title: '辉夜的意志',
      faction: 'akatsuki', rarity: 'SR', role: 'ctrl', element: 'yin', tags: ['控制', '封印', '减益'],
      stats: { hp: 0.95, atk: 1.0, def: 1.0, spd: 120 },
      bio: '大筒木辉夜被封印前创造的意志化身，自称“母亲的意志”。千年来他暗中篡改宇智波一族的石碑、操纵因陀罗的转世者，最终寄生于宇智波斑体内令辉夜复活，后与辉夜一同被六道·地爆天星封印。',
      quote: '一切都是为了母亲大人的复活。',
      art: {
        type: 'human', skin: '#1c1c22', hair: 'none', hairColor: '#111114',
        eyes: 'normal', eyeColor: '#ffd54f', outfit: 'bodysuit', outfitColor: '#141418', accentColor: '#3a3a44',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#7e57c2'
      },
      skills: {
        passive: {
          name: '辉夜的意志', tags: ['闪避', '回能'],
          desc: '千年来潜伏暗处、玩弄人心：闪避率+12%，速度+8%；战斗开始时获得30点查克拉。',
          stats: { dodge: 0.12, spd: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 30 }] }]
        },
        s1: {
          name: '寄生之术', tags: ['控制', '消耗'], fx: 'shadow', target: 'single', cd: 0,
          desc: '化作黑色的泥状物缠上敌人，造成100%攻击力伤害，并有30%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.3 }
          ]
        },
        s2: {
          name: '操纵宿主', tags: ['封印', '减益'], fx: 'yin', target: 'single', cd: 3,
          desc: '寄生于敌人体内夺取身体的控制权：造成150%攻击力伤害，吸取其25点查克拉，并将其封印2回合（只能使用技能1）。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'drain', value: 25 },
            { type: 'status', status: 'silence', turns: 2 }
          ]
        },
        ult: {
          name: '千年之谋', tags: ['群攻', '减益', '封印'], fx: 'yin', target: 'all',
          desc: '千年来篡改石碑、挑动忍界纷争的阴谋一齐发动：对全体敌人造成140%攻击力伤害，降低其攻击力20%，持续2回合，并有50%概率将其封印1回合。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'debuff', stat: 'atk', value: 0.2, turns: 2 },
            { type: 'status', status: 'silence', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '寄生·轮回天生', tags: ['复活', '增益'],
          desc: '攻击力+10%；有友军阵亡时，寄生并操纵宿主强行发动轮回天生，使其以30%最大生命值复活（每场战斗限1次）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_ally_death', effects: [{ type: 'revive', pct: 0.3 }] }]
        }
      }
    },

    /* ============================ 宇智波带土 ============================ */
    {
      id: 'obito', name: '宇智波带土', form: '面具男', en: 'Uchiha Obito', title: '晓的幕后黑手',
      faction: 'akatsuki', rarity: 'SSR', role: 'ctrl', element: 'fire', tags: ['闪避', '控制', '召唤'],
      stats: { hp: 1.0, atk: 1.08, def: 0.95, spd: 122 },
      bio: '戴着漩涡面具、自称“宇智波斑”的神秘男子，真实身份是本应死于第三次忍界大战的宇智波带土。他以神威的时空间忍术暗中操纵晓组织，策动九尾袭击木叶，并向五大国宣告了第四次忍界大战。',
      quote: '我谁也不是，也不想成为任何人。',
      art: {
        type: 'human', skin: '#f1d6bf', hair: 'short', hairColor: '#1b1b1f',
        eyes: 'ms_obito', outfit: 'akatsuki', outfitColor: AKA, accentColor: CLOUD,
        headband: 'none', marks: [], mask: 'spiral', hat: 'none', accessory: 'none', aura: '#5e35b1'
      },
      skills: {
        passive: {
          name: '神威·虚化', tags: ['闪避'],
          desc: '将身体转移至神威空间，让攻击穿透而过：闪避率+18%；受到攻击时有25%概率进一步虚化，闪避率提升25%，持续1回合。',
          stats: { dodge: 0.18 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'buff', stat: 'dodge', value: 0.25, turns: 1 }] }]
        },
        s1: {
          name: '神威', tags: ['穿透', '消耗'], fx: 'kamui', target: 'single', cd: 0,
          desc: '以时空间忍术将敌人的身体局部吸入异空间，造成115%攻击力伤害（无视25%防御）。',
          effects: [{ type: 'dmg', mult: 1.15, pierce: 0.25 }]
        },
        s2: {
          name: '木遁·树界降诞', tags: ['群攻', '控制'], fx: 'wood', target: 'all', cd: 3,
          desc: '以移植的柱间细胞催生出巨木森林，对全体敌人造成90%攻击力伤害，并有40%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '通灵之术·外道魔像', tags: ['召唤', '群攻', '控制'], fx: 'summon', target: 'all',
          desc: '通灵出封印着尾兽的外道魔像降临战场，对全体敌人造成160%攻击力伤害，有50%概率使其眩晕1回合，并吸取每人20点查克拉。',
          effects: [
            { type: 'dmg', mult: 1.6 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 },
            { type: 'drain', value: 20 }
          ]
        },
        awaken: {
          name: '火遁·豪火灭却', tags: ['群攻', '持续'],
          desc: '攻击力+12%；释放必杀技后追加喷出铺天盖地的烈焰，使全体敌人灼烧2回合（每回合35%攻击力）。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'burn', turns: 2, value: 0.35, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'obito_juubi', name: '宇智波带土', form: '十尾人柱力', en: 'Uchiha Obito', title: '十尾之主',
      faction: 'akatsuki', rarity: 'UR', role: 'atk', element: 'yin', tags: ['护盾', '穿透', '群攻'],
      stats: { hp: 1.08, atk: 1.08, def: 0.92, spd: 108 },
      bio: '吞下十尾成为人柱力的宇智波带土，获得了六道之力与能消除一切忍术的求道玉。他意图发动无限月读终结这个世界，却在与鸣人的意志碰撞中忆起儿时成为火影的梦想，最终被拔出尾兽而倒下。',
      quote: '这个世界，早已是地狱。',
      art: {
        type: 'human', skin: '#f0e6dc', hair: 'spiky', hairColor: '#e8e8e8',
        eyes: 'rinnegan', eyeL: 'ms_obito', eyeR: 'rinnegan',
        outfit: 'six_paths', outfitColor: '#f2f2f2', accentColor: '#1c1c1c',
        headband: 'none', marks: ['face_lines'], mask: 'none', hat: 'horns', accessory: 'truth_orbs', aura: '#cfd8dc'
      },
      skills: {
        passive: {
          name: '十尾人柱力', tags: ['治疗', '增益'],
          desc: '与十尾融为一体，拥有磅礴的生命力：生命值+12%，受到的伤害-10%；每回合开始时恢复5%最大生命值。',
          stats: { hp: 0.12, dr: 0.10 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.05 }] }]
        },
        s1: {
          name: '求道玉', tags: ['护盾', '输出'], fx: 'truth', target: 'single', cd: 0,
          desc: '操纵漂浮于身后的求道玉化作长棒与盾牌，造成125%攻击力伤害，并获得20%攻击力的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.25 },
            { type: 'shield', mult: 0.2, turns: 2, to: 'self' }
          ]
        },
        s2: {
          name: '求道锡杖', tags: ['穿透', '单体', '减益'], fx: 'truth', target: 'single', cd: 3,
          desc: '以求道玉化成的锡杖贯穿敌人，消除一切忍术：先驱散目标的增益与护盾，再造成220%攻击力伤害（无视40%防御）。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 2.2, pierce: 0.4 }
          ]
        },
        ult: {
          name: '十尾·尾兽玉', tags: ['群攻', '爆发', '控制'], fx: 'bijuu', target: 'all',
          desc: '凝聚十尾的查克拉射出毁天灭地的尾兽玉，对全体敌人造成3段共210%攻击力伤害，并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.7, hits: 3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '六道之力', tags: ['净化', '治疗', '增益'],
          desc: '攻击力+12%；生命首次低于30%时六道之力爆发，恢复30%最大生命值，清除自身减益并免疫控制2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.3 },
            { type: 'cleanse' },
            { type: 'immune', turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 雨隐村 ============================ */
    {
      id: 'yahiko', name: '弥彦', form: '', en: 'Yahiko', title: '晓的创立者',
      faction: 'ame', rarity: 'R', role: 'sup', element: 'water', tags: ['增益', '护盾'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 108 },
      bio: '雨隐村的战争孤儿，与长门、小南一同受教于自来也，创立了以和平为目标的最初的“晓”。遭山椒鱼半藏与志村团藏设计陷害，为救小南撞向长门手中的苦无而死，其遗体后来成为佩恩的天道。',
      quote: '总有一天，我要改变这个国家！',
      art: {
        type: 'human', skin: '#f1d3bc', hair: 'spiky', hairColor: '#e8731e',
        eyes: 'normal', eyeColor: '#8a5a3c', outfit: 'highcollar', outfitColor: '#5e6b55', accentColor: '#3b4a6b',
        headband: 'ame', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#3a8dff'
      },
      skills: {
        passive: {
          name: '和平之梦', tags: ['增益'],
          desc: '怀着不靠战争实现和平的梦想：战斗开始时使全体友军攻击力提升10%，持续2回合。',
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'atk', value: 0.1, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '手里剑术', tags: ['输出'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投出苦无与手里剑牵制敌人，造成100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.0 }]
        },
        s2: {
          name: '水遁·水阵壁', tags: ['护盾'], fx: 'water', target: 'ally_all', cd: 3,
          desc: '吐出大量的水形成守护同伴的水墙，为全体友军提供12%最大生命值的护盾，持续2回合。',
          effects: [{ type: 'shield', pct: 0.12, turns: 2 }]
        },
        ult: {
          name: '水遁·水龙弹之术', tags: ['群攻', '增益'], fx: 'water', target: 'all',
          desc: '操纵巨大的水龙冲击敌阵，对全体敌人造成130%攻击力伤害，并使全体友军攻击力提升15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'buff', stat: 'atk', value: 0.15, turns: 2, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '舍身护友', tags: ['治疗', '增益'],
          desc: '生命值+10%，攻击力+10%；阵亡时以生命守护同伴，为全体友军恢复15%最大生命值，并使其攻击力提升20%，持续2回合。',
          stats: { hp: 0.10, atk: 0.10 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'heal', pct: 0.15, to: 'ally_all' },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'ally_all' }
          ] }]
        }
      }
    },

    {
      id: 'hanzo', name: '山椒鱼半藏', form: '', en: 'Hanzo', title: '半神',
      faction: 'ame', rarity: 'SSR', role: 'ctrl', element: 'water', tags: ['持续', '群攻', '召唤'],
      stats: { hp: 1.05, atk: 1.05, def: 0.98, spd: 104 },
      bio: '雨隐村的首领，第二次忍界大战中击败了木叶的三人并赐予他们“三忍”之名，自己也被尊称为“半神”。他体内植入了通灵兽井守的毒囊，后被长门所杀；第四次忍界大战中以秽土转生复活，与武士三船对决。',
      quote: '就称你们为木叶三忍吧。',
      art: {
        type: 'human', skin: '#e8d2bd', hair: 'wild_long', hairColor: '#4a4a4a',
        eyes: 'normal', eyeColor: '#5a4a3a', outfit: 'armor', outfitColor: '#4a4f5a', accentColor: '#6a78c9',
        headband: 'ame', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'lower', hat: 'none', accessory: 'scythe', aura: '#7cb342'
      },
      skills: {
        passive: {
          name: '井守毒囊', tags: ['持续', '增益'],
          desc: '体内植入了井守的毒囊，连血液都带有剧毒：受到的伤害-10%；受到攻击时有40%概率使攻击者中毒2回合（每回合30%攻击力）。',
          stats: { dr: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.4, effects: [{ type: 'status', status: 'poison', turns: 2, value: 0.3, to: 'attacker' }] }]
        },
        s1: {
          name: '锁镰', tags: ['消耗', '控制'], fx: 'blade', target: 'single', cd: 0,
          desc: '甩出锁镰缠绕并割伤敌人，造成110%攻击力伤害，并有25%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.25 }
          ]
        },
        s2: {
          name: '毒雾', tags: ['群攻', '持续'], fx: 'poison', target: 'all', cd: 3,
          desc: '喷出井守的剧毒雾气笼罩敌阵，对全体敌人造成75%攻击力伤害，并使其中毒3回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.75 },
            { type: 'status', status: 'poison', turns: 3, value: 0.35 }
          ]
        },
        ult: {
          name: '通灵之术·井守', tags: ['召唤', '群攻', '控制'], fx: 'summon', target: 'all',
          desc: '通灵出巨大的山椒鱼井守，以毒雾与巨躯碾压敌人：对全体敌人造成150%攻击力伤害，使其中毒2回合（每回合40%攻击力），并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'poison', turns: 2, value: 0.4 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '半神之威', tags: ['减益', '增益'],
          desc: '攻击力+12%；以半神的威名震慑敌人，战斗开始时使全体敌人攻击力降低15%，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'debuff', stat: 'atk', value: 0.15, turns: 2, to: 'enemy_all' }] }]
        }
      }
    },

    /* ============================ 大筒木一族 ============================ */
    {
      id: 'kaguya', name: '大筒木辉夜', form: '', en: 'Otsutsuki Kaguya', title: '兔女神',
      faction: 'otsutsuki', rarity: 'UR', role: 'ctrl', element: 'yin', tags: ['控制', '穿透', '群攻'],
      stats: { hp: 1.1, atk: 1.05, def: 0.95, spd: 115 },
      bio: '远古时代从天外而来的大筒木一族公主，食下神树的查克拉果实成为最初的查克拉持有者，被称为“兔女神”。她曾以无限月读统治人间，后被两个儿子羽衣与羽村封印；第四次忍界大战中借黑绝之手复活，最终被鸣人与佐助以六道·地爆天星再度封印。',
      quote: '这片大地的查克拉，全都属于我。',
      art: {
        type: 'human', skin: '#f7efef', hair: 'very_long', hairColor: '#f4f1ff',
        eyes: 'byakugan', outfit: 'otsutsuki', outfitColor: '#f5f2fa', accentColor: '#7b5ea7',
        headband: 'none', marks: ['third_eye', 'red_lips'], mask: 'none', hat: 'horns', accessory: 'none', aura: '#d9c8ff'
      },
      skills: {
        passive: {
          name: '查克拉之祖', tags: ['增益', '回能'],
          desc: '一切查克拉的源头：生命值+10%，受到的伤害-12%；战斗开始时获得30点查克拉。',
          stats: { hp: 0.10, dr: 0.12 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 30 }] }]
        },
        s1: {
          name: '八十神空击', tags: ['输出', '穿透'], fx: 'space', target: 'back', cd: 0,
          desc: '打开时空间之门，拳击穿越空间直击最后排的敌人，造成125%攻击力伤害（无视20%防御）。',
          effects: [{ type: 'dmg', mult: 1.25, pierce: 0.2 }]
        },
        s2: {
          name: '共杀灰骨', tags: ['穿透', '斩杀', '单体'], fx: 'bone', target: 'single', cd: 3,
          desc: '从掌心射出能使接触者崩解成灰的骨刺，造成150%攻击力伤害，额外造成目标最大生命值15%的真实伤害；生命低于30%的目标额外受到100%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'true_dmg', pct: 0.15 },
            { type: 'execute', threshold: 0.3, mult: 1.0 }
          ]
        },
        ult: {
          name: '天之御中', tags: ['群攻', '控制', '减益'], fx: 'space', target: 'all',
          desc: '瞬间将战场切换至熔岩、冰原、超重力等异空间，对全体敌人造成3段共195%攻击力伤害，有70%概率使其眩晕1回合，并使其受到的伤害增加15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.65, hits: 3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.7 },
            { type: 'debuff', stat: 'dr', value: 0.15, turns: 2 }
          ]
        },
        awaken: {
          name: '膨胀求道玉', tags: ['减益', '吸血'],
          desc: '攻击力+12%，吸血+8%；释放必杀技后放出吞噬一切的膨胀求道玉，吸取全体敌人各25点查克拉。',
          stats: { atk: 0.12, lifesteal: 0.08 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'drain', value: 25, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'hagoromo', name: '大筒木羽衣', form: '六道仙人', en: 'Otsutsuki Hagoromo', title: '忍宗始祖',
      faction: 'otsutsuki', rarity: 'UR', role: 'heal', element: 'yang', tags: ['复活', '治疗', '控制'],
      stats: { hp: 1.05, atk: 1.0, def: 1.0, spd: 105 },
      bio: '大筒木辉夜的长子，继承了母亲的查克拉并拥有轮回眼，是忍界传说中的“六道仙人”。他与弟弟羽村联手封印了辉夜，以六道·地爆天星造出月球，并创立以查克拉连接人心的忍宗；第四次忍界大战中，他将六道之力分别授予了鸣人与佐助。',
      quote: '忍宗的意义，在于连接人与人的心。',
      art: {
        type: 'human', skin: '#efe3d6', hair: 'spiky', hairColor: '#d9d9d9',
        eyes: 'rinnegan', outfit: 'six_paths', outfitColor: '#f2efe6', accentColor: '#1c1c1c',
        headband: 'none', marks: ['wrinkles'], mask: 'none', hat: 'horns', accessory: 'staff', aura: '#ffd54f'
      },
      skills: {
        passive: {
          name: '忍宗', tags: ['治疗', '回能'],
          desc: '以查克拉连接人心：生命值+10%；每回合开始时为生命值最低的友军恢复6%最大生命值，并使其获得10点查克拉。',
          stats: { hp: 0.10 },
          triggers: [{ on: 'turn_start', effects: [
            { type: 'heal', pct: 0.06, to: 'ally_lowest' },
            { type: 'chakra', value: 10, to: 'ally_lowest' }
          ] }]
        },
        s1: {
          name: '求道玉', tags: ['护盾', '消耗'], fx: 'truth', target: 'single', cd: 0,
          desc: '射出漆黑的求道玉击打敌人，造成105%攻击力伤害，并为生命值最低的友军提供35%攻击力的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'shield', mult: 0.35, turns: 2, to: 'ally_lowest' }
          ]
        },
        s2: {
          name: '阴阳遁·万物创造', tags: ['复活', '治疗'], fx: 'yang', target: 'ally_all', cd: 4,
          desc: '以阴阳遁赋予万物形态与生命：复活一名阵亡友军并恢复其40%最大生命值（每场战斗限1次），并为全体友军恢复110%攻击力的生命值。',
          effects: [
            { type: 'revive', pct: 0.4 },
            { type: 'heal', mult: 1.1 }
          ]
        },
        ult: {
          name: '六道·地爆天星', tags: ['群攻', '控制', '净化'], fx: 'gravity', target: 'all',
          desc: '以六道之力创造巨大的引力核心，将敌人连同大地一并封印：对全体敌人造成170%攻击力伤害，有80%概率使其眩晕1回合，并清除全体友军的减益。',
          effects: [
            { type: 'dmg', mult: 1.7 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.8 },
            { type: 'cleanse', to: 'ally_all' }
          ]
        },
        awaken: {
          name: '阴阳之印', tags: ['增益', '治疗'],
          desc: '攻击力+10%，生命值+8%；释放必杀技后将六道之力分予全体友军，使其攻击力提升20%，持续2回合。',
          stats: { atk: 0.10, hp: 0.08 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'hamura', name: '大筒木羽村', form: '', en: 'Otsutsuki Hamura', title: '月之守护者',
      faction: 'otsutsuki', rarity: 'SSR', role: 'ctrl', element: 'none', tags: ['封印', '消耗', '护盾'],
      stats: { hp: 1.0, atk: 1.0, def: 1.05, spd: 112 },
      bio: '大筒木辉夜的次子、羽衣的弟弟，继承了母亲的白眼。他与兄长并肩作战封印了辉夜，随后率领族人移居月球，守护封印着辉夜躯壳的外道魔像，日向一族正是他的后裔。',
      quote: '兄长，月亮就由我来守护。',
      art: {
        type: 'human', skin: '#f5ece6', hair: 'long_straight', hairColor: '#f2f2f2',
        eyes: 'byakugan', outfit: 'otsutsuki', outfitColor: '#f2f0ea', accentColor: '#5b7fbf',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#bfe0ff'
      },
      skills: {
        passive: {
          name: '白眼', tags: ['增益', '消耗'],
          desc: '近乎360度的视野能看穿查克拉经络：暴击率+10%，闪避率+8%；攻击命中时有30%概率封闭穴位，吸取目标10点查克拉。',
          stats: { crit: 0.10, dodge: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'drain', value: 10 }] }]
        },
        s1: {
          name: '柔拳', tags: ['穿透', '消耗'], fx: 'fist', target: 'single', cd: 0,
          desc: '以查克拉直接冲击敌人的经络系统，造成110%攻击力伤害（无视30%防御），并吸取其10点查克拉。',
          effects: [
            { type: 'dmg', mult: 1.1, pierce: 0.3 },
            { type: 'drain', value: 10 }
          ]
        },
        s2: {
          name: '八卦六十四掌', tags: ['封印', '消耗'], fx: 'fist', target: 'single', cd: 3,
          desc: '连续击打敌人的六十四处穴位，造成8段共192%攻击力伤害，吸取其25点查克拉，并有60%概率将其封印2回合（只能使用技能1）。',
          effects: [
            { type: 'dmg', mult: 0.24, hits: 8 },
            { type: 'drain', value: 25 },
            { type: 'status', status: 'silence', turns: 2, chance: 0.6 }
          ]
        },
        ult: {
          name: '八卦空壁掌', tags: ['群攻', '封印'], fx: 'chakra', target: 'all',
          desc: '双掌推出巨大的查克拉气墙冲击敌阵，对全体敌人造成140%攻击力伤害，吸取每人20点查克拉，并有50%概率将其封印1回合。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'drain', value: 20 },
            { type: 'status', status: 'silence', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '月之守护', tags: ['护盾', '增益'],
          desc: '防御+12%，生命值+8%；战斗开始时以封印之力守护同伴，为全体友军提供12%最大生命值的护盾，持续2回合。',
          stats: { def: 0.12, hp: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.12, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'indra', name: '大筒木因陀罗', form: '', en: 'Otsutsuki Indra', title: '宇智波之祖',
      faction: 'otsutsuki', rarity: 'SSR', role: 'atk', element: 'yin', tags: ['输出', '爆发', '斩杀'],
      stats: { hp: 0.92, atk: 1.18, def: 0.92, spd: 120 },
      bio: '六道仙人羽衣的长子，继承了父亲的“仙人之眼”与强大的精神能量，天资卓绝，开启写轮眼并独自领悟诸多忍术。因弟弟阿修罗被选为忍宗继承人而心生怨恨，兄弟之争延续千年，其查克拉先后转世于宇智波斑与宇智波佐助。',
      quote: '唯有力量，才能带来秩序。',
      art: {
        type: 'human', skin: '#f1dccb', hair: 'long_bang', hairColor: '#141419',
        eyes: 'ms_sasuke', outfit: 'robe', outfitColor: '#2a2a3a', accentColor: '#7c4dff',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#7c4dff'
      },
      skills: {
        passive: {
          name: '仙人之眼', tags: ['增益', '爆发'],
          desc: '继承六道仙人的精神能量与瞳力：暴击率+12%，暴击伤害+20%。',
          stats: { crit: 0.12, critDmg: 0.2 }
        },
        s1: {
          name: '千鸟', tags: ['输出', '控制'], fx: 'chidori', target: 'single', cd: 0,
          desc: '将雷遁查克拉聚于掌心发出千鸟鸣叫般的突刺，造成120%攻击力伤害，并有20%概率使目标眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.2 }
          ]
        },
        s2: {
          name: '火遁·豪火球之术', tags: ['爆发', '持续'], fx: 'fire', target: 'single', cd: 3,
          desc: '喷出灼热的巨大火球，造成190%攻击力伤害，并使目标灼烧2回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'status', status: 'burn', turns: 2, value: 0.35 }
          ]
        },
        ult: {
          name: '须佐能乎', tags: ['群攻', '爆发', '斩杀'], fx: 'susanoo', target: 'all',
          desc: '唤出完全体须佐能乎挥剑横扫战场，对全体敌人造成2段共190%攻击力伤害，生命低于30%的敌人额外受到120%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 0.95, hits: 2 },
            { type: 'execute', threshold: 0.3, mult: 1.2 }
          ]
        },
        awaken: {
          name: '万花筒写轮眼', tags: ['增益', '回能'],
          desc: '攻击力+12%；每击败一名敌人，获得35点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'chakra', value: 35 }] }]
        }
      }
    },

    {
      id: 'asura', name: '大筒木阿修罗', form: '', en: 'Otsutsuki Asura', title: '千手之祖',
      faction: 'otsutsuki', rarity: 'SSR', role: 'tank', element: 'yang', tags: ['嘲讽', '治疗', '护盾'],
      stats: { hp: 1.15, atk: 0.95, def: 1.0, spd: 100 },
      bio: '六道仙人羽衣的次子，继承了父亲的“仙人之体”与强大的生命能量。他资质平凡，却凭借努力与同伴间的羁绊不断成长，被父亲选为忍宗继承人，其查克拉先后转世于千手柱间与漩涡鸣人。',
      quote: '只要和大家同心协力，就没有做不到的事。',
      art: {
        type: 'human', skin: '#efcfae', hair: 'spiky', hairColor: '#5a3a22',
        eyes: 'normal', eyeColor: '#4a3020', outfit: 'robe', outfitColor: '#d9c7a5', accentColor: '#e8731e',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#ffd24a'
      },
      skills: {
        passive: {
          name: '仙人之体', tags: ['治疗', '增益'],
          desc: '继承六道仙人强大的生命能量：生命值+15%；每回合开始时恢复4%最大生命值。',
          stats: { hp: 0.15 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.04 }] }]
        },
        s1: {
          name: '体术·刚拳', tags: ['消耗', '护盾'], fx: 'fist', target: 'single', cd: 0,
          desc: '以强韧的仙人之体挥出重拳，造成100%攻击力伤害，并获得20%攻击力的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'shield', mult: 0.2, turns: 2, to: 'self' }
          ]
        },
        s2: {
          name: '阳遁·生命之力', tags: ['治疗', '嘲讽'], fx: 'yang', target: 'ally_all', cd: 3,
          desc: '以阳遁的生命能量激发同伴的活力，为全体友军恢复100%攻击力的生命值，并挺身而出嘲讽敌人2回合。',
          effects: [
            { type: 'heal', mult: 1.0 },
            { type: 'taunt', turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '阳遁·千手之力', tags: ['群攻', '护盾', '嘲讽'], fx: 'fist', target: 'all',
          desc: '唤出生有无数手臂的巨大查克拉化身，以千手连击轰击敌阵：对全体敌人造成5段共150%攻击力伤害，为自身提供25%最大生命值的护盾（持续2回合），并嘲讽敌人2回合。',
          effects: [
            { type: 'dmg', mult: 0.3, hits: 5 },
            { type: 'shield', pct: 0.25, turns: 2, to: 'self' },
            { type: 'taunt', turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '阳之力', tags: ['治疗', '增益'],
          desc: '防御+10%，攻击力+10%；释放必杀技后以阳遁之力为全体友军恢复10%最大生命值。',
          stats: { def: 0.10, atk: 0.10 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'heal', pct: 0.1, to: 'ally_all' }] }]
        }
      }
    }

  ]);
})();
