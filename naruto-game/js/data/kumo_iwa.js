/* js/data/kumo_iwa.js — 云隐村、岩隐村、泷隐与铁之国
 * 云隐：四代目/三代目/二代目雷影、奇拉比、达鲁伊、希、萨姆依小队、阿兹伊、二位由木人、玛布伊、金银兄弟、多代
 * 岩隐：三代目土影大野木、二代目土影无、黑土、赤土、黄土、老紫、汉
 * 泷隐：七尾人柱力（芙）；铁之国：三船
 * 仅收录《火影忍者》与《火影忍者疾风传》时期的角色、形态与忍术（不含任何博人传内容）。
 */
(function () {
  'use strict';

  var KUMO_VEST = '#e8e5dc';   // 云隐马甲（白/米色）
  var KUMO_DARK = '#2f3440';
  var IWA_RED = '#8e2f2a';     // 岩隐忍者的红色服装
  var IWA_TRIM = '#6e5b45';
  var DARK_SKIN = '#7a4a2e';
  var LIGHT_SKIN = '#f4dcc6';

  NG.defineChars('kumo_iwa', [

    /* ============================ 云隐村 · 雷影 ============================ */
    {
      id: 'raikage_a', name: '艾', form: '四代目雷影', en: 'A', title: '最速雷影',
      faction: 'kumo', rarity: 'SSR', role: 'atk', element: 'lightning', tags: ['输出', '爆发', '控制'],
      stats: { hp: 1.02, atk: 1.12, def: 0.88, spd: 142 },
      bio: '雷之国的四代目雷影，三代目雷影之子、奇拉比的义兄。以雷遁查克拉模式强化肉体，速度之快在忍界首屈一指；五影会谈时为重创佐助不惜失去左臂，后担任忍者联军总司令。',
      quote: '我的拳头，就是雷之国的意志！',
      art: {
        type: 'human', skin: '#8a5634', hair: 'slick_back', hairColor: '#f1e7c9',
        eyes: 'normal', eyeColor: '#3b2a1a', outfit: 'kage', outfitColor: '#f4f4f2', accentColor: '#e0b12b',
        headband: 'none', marks: ['mustache', 'goatee'], beardColor: '#f1e7c9',
        mask: 'none', hat: 'none', accessory: 'none', aura: '#7fd4ff'
      },
      skills: {
        passive: {
          name: '雷遁查克拉模式', tags: ['增益'],
          desc: '以雷遁查克拉包覆全身、刺激神经反应：速度+8%，暴击率+10%；战斗开始时攻击力+20%，持续2回合。',
          stats: { spd: 0.08, crit: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'atk', value: 0.2, turns: 2 }] }]
        },
        s1: {
          name: '雷虐水平千代舞', tags: ['输出', '穿透'], fx: 'lightning', target: 'single', cd: 0,
          desc: '以雷遁强化的手刀水平横劈，造成120%攻击力伤害，无视目标20%防御。',
          effects: [{ type: 'dmg', mult: 1.2, pierce: 0.2 }]
        },
        s2: {
          name: '断头台落', tags: ['爆发', '控制'], fx: 'fist', target: 'single', cd: 3,
          desc: '高高跃起后以脚跟劈落敌人后颈，造成210%攻击力伤害，并有35%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 2.1 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.35 }
          ]
        },
        ult: {
          name: '雷我爆弹', tags: ['爆发', '控制', '单体'], fx: 'lightning', target: 'single',
          desc: '瞬身至敌人面前将其擒住，倒栽葱般狠狠砸入地面，造成360%攻击力伤害，并有70%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 3.6 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.7 }
          ]
        },
        awaken: {
          name: '雷犁热刀', tags: ['爆发', '回能'],
          desc: '攻击力+12%；释放必杀技后追加一记雷犁热刀，对该目标再造成80%攻击力伤害；击败敌人时获得30点查克拉。',
          stats: { atk: 0.12 },
          triggers: [
            { on: 'on_ult', effects: [{ type: 'dmg', mult: 0.8 }] },
            { on: 'on_kill', effects: [{ type: 'chakra', value: 30 }] }
          ]
        }
      }
    },

    {
      id: 'killer_b', name: '奇拉比', form: '八尾人柱力', en: 'Killer B', title: '八尾说唱王',
      faction: 'kumo', rarity: 'SSR', role: 'atk', element: 'lightning', tags: ['输出', '群攻'],
      stats: { hp: 1.08, atk: 1.05, def: 0.9, spd: 120 },
      bio: '雷影艾的义弟、八尾牛鬼的人柱力，是能与尾兽完全合作的“完美人柱力”。热爱说唱，惯用多刀并持的八刀流；四战前在岛龟上引导鸣人掌控九尾之力。',
      quote: 'Yo！八尾登场，笨蛋混蛋！',
      art: {
        type: 'human', skin: DARK_SKIN, hair: 'buzz', hairColor: '#ece4c4',
        eyes: 'normal', eyeColor: '#3a2a1a', outfit: 'flak', outfitColor: '#efece2', accentColor: '#3a3442',
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: ['sunglasses', 'b_tattoo', 'goatee'], beardColor: '#ece4c4',
        mask: 'none', hat: 'none', accessory: 'sword', aura: '#a23fd0'
      },
      skills: {
        passive: {
          name: '完美人柱力', tags: ['增益', '回能'],
          desc: '与八尾牛鬼心意相通、配合默契：生命值+10%，受到的伤害-8%；战斗开始时获得25点查克拉。',
          stats: { hp: 0.10, dr: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 25 }] }]
        },
        s1: {
          name: '八刀流', tags: ['输出', '持续'], fx: 'blade', target: 'single', cd: 0,
          desc: '以全身各处夹持的多把刀同时乱舞斩击，造成3段共120%攻击力伤害，并有25%概率使目标流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.4, hits: 3 },
            { type: 'status', status: 'bleed', turns: 2, chance: 0.25, value: 0.3 }
          ]
        },
        s2: {
          name: '雷犁热刀', tags: ['爆发', '穿透'], fx: 'lightning', target: 'single', cd: 3,
          desc: '以雷遁与尾兽查克拉强化的手臂全力横扫，造成190%攻击力伤害，无视目标30%防御。',
          effects: [{ type: 'dmg', mult: 1.9, pierce: 0.3 }]
        },
        ult: {
          name: '尾兽玉', tags: ['群攻', '爆发', '控制'], fx: 'bijuu', target: 'all',
          desc: '化身八尾，将黑白查克拉压缩成尾兽玉轰向敌阵，对全体敌人造成200%攻击力伤害，并有35%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 2.0 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.35 }
          ]
        },
        awaken: {
          name: '完全尾兽化', tags: ['增益', '治疗'],
          desc: '攻击力+12%；生命首次低于30%时，留下章鱼足替身脱离险境并完全尾兽化，立即恢复30%最大生命值，且2回合内免疫控制。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'heal', pct: 0.3 }, { type: 'immune', turns: 2 }] }]
        }
      }
    },

    {
      id: 'raikage_3', name: '艾', form: '三代目雷影', en: 'A', title: '最强的矛与盾',
      faction: 'kumo', rarity: 'SSR', role: 'tank', element: 'lightning', tags: ['嘲讽', '反击', '穿透'],
      stats: { hp: 1.15, atk: 0.9, def: 1.0, spd: 112 },
      bio: '四代目雷影艾的父亲，拥有号称“最强之盾”的强韧肉体与“最强之矛”地狱突刺，身上唯一的伤疤是被自己的贯手所留。曾独自与一万名敌人激战三天三夜、掩护同伴撤退后战死；四战中被秽土转生召唤。',
      quote: '你们先撤，这里由我一人挡住！',
      art: {
        type: 'human', skin: '#76472c', hair: 'wild_long', hairColor: '#f3f0e6',
        eyes: 'dark', eyeColor: '#3a2a1a', outfit: 'kage', outfitColor: '#f2f2f0', accentColor: '#d9a82a',
        headband: 'none', marks: ['beard', 'mustache'], beardColor: '#f3f0e6',
        mask: 'none', hat: 'none', accessory: 'none', aura: '#5b4ed6'
      },
      skills: {
        passive: {
          name: '最强之盾', tags: ['嘲讽', '增益'],
          desc: '号称“最强之盾”的强韧肉体：防御+15%，受到的伤害-10%；战斗开始时挺身而出，嘲讽敌人2回合。',
          stats: { def: 0.15, dr: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'taunt', turns: 2 }] }]
        },
        s1: {
          name: '地狱突刺·一本贯手', tags: ['输出', '穿透'], fx: 'lightning', target: 'single', cd: 0,
          desc: '将雷遁查克拉集中于一根手指刺出，造成115%攻击力伤害，无视目标40%防御。',
          effects: [{ type: 'dmg', mult: 1.15, pierce: 0.4 }]
        },
        s2: {
          name: '雷遁查克拉模式', tags: ['护盾', '嘲讽', '反击'], fx: 'shield', target: 'self', cd: 4,
          desc: '以雷遁查克拉包覆全身：获得20%最大生命值的护盾，持续2回合；嘲讽敌人2回合，并在2回合内受到攻击时反击，造成80%攻击力伤害。',
          effects: [
            { type: 'shield', pct: 0.2, turns: 2 },
            { type: 'taunt', turns: 2 },
            { type: 'counter', mult: 0.8, turns: 2 }
          ]
        },
        ult: {
          name: '地狱突刺·四本贯手', tags: ['穿透', '斩杀', '爆发'], fx: 'lightning', target: 'single',
          desc: '以四指并拢的“最强之矛”贯穿敌人，造成340%攻击力伤害，无视目标50%防御；目标生命值低于30%时额外受到120%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 3.4, pierce: 0.5 },
            { type: 'execute', threshold: 0.3, mult: 1.2 }
          ]
        },
        awaken: {
          name: '黑雷', tags: ['控制', '增益'],
          desc: '攻击力+12%，生命值+5%；黑色雷遁缠绕全身，受到攻击时有20%概率使攻击者麻痹，眩晕1回合。',
          stats: { atk: 0.12, hp: 0.05 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'status', status: 'stun', turns: 1 }] }]
        }
      }
    },

    {
      id: 'raikage_2', name: '二代目雷影', form: '', en: 'Nidaime Raikage', title: '缔盟雷影',
      faction: 'kumo', rarity: 'SR', role: 'tank', element: 'lightning', tags: ['护盾', '嘲讽'],
      stats: { hp: 1.12, atk: 0.92, def: 0.98, spd: 100 },
      bio: '雷之国的二代目雷影。在位时曾与二代目火影千手扉间会谈、商议缔结同盟，却在会谈中遭金银兄弟率领的金角部队发动政变袭击，同盟因此破裂。',
      quote: '雷之国的威严，由我来守护。',
      art: {
        type: 'human', skin: '#7f4f32', hair: 'slick_back', hairColor: '#e8e2d0',
        eyes: 'normal', eyeColor: '#3a2a1a', outfit: 'kage', outfitColor: '#f2f2f2', accentColor: '#3f7fd0',
        headband: 'none', marks: ['mustache', 'beard'], beardColor: '#e8e2d0',
        mask: 'none', hat: 'raikage', accessory: 'none', aura: '#8fd0ff'
      },
      skills: {
        passive: {
          name: '雷影之躯', tags: ['护盾', '增益'],
          desc: '历代雷影引以为傲的强健体魄：生命值+10%，防御+10%；生命首次低于30%时获得25%最大生命值的护盾。',
          stats: { hp: 0.10, def: 0.10 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'shield', pct: 0.25 }] }]
        },
        s1: {
          name: '雷遁·雷击掌', tags: ['输出', '护盾'], fx: 'lightning', target: 'single', cd: 0,
          desc: '以雷遁包覆的手掌猛击敌人，造成100%攻击力伤害，并获得15%攻击力的护盾。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'shield', mult: 0.15, to: 'self' }]
        },
        s2: {
          name: '雷遁·雷障壁', tags: ['护盾', '嘲讽'], fx: 'shield', target: 'ally_all', cd: 3,
          desc: '展开雷光屏障护住全队，为全体友方提供45%攻击力的护盾，持续2回合，并嘲讽敌人2回合。',
          effects: [
            { type: 'shield', mult: 0.45, turns: 2 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '雷遁·落雷之术', tags: ['群攻', '控制'], fx: 'lightning', target: 'all',
          desc: '引落雷轰击敌阵，对全体敌人造成140%攻击力伤害，并有35%概率使其眩晕1回合；同时自身受到的伤害-20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.35 },
            { type: 'buff', stat: 'dr', value: 0.2, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '雷影的威严', tags: ['护盾', '增益'],
          desc: '攻击力+10%，防御+5%；战斗开始时以雷影的威严稳定军心，为全体友方提供10%最大生命值的护盾。',
          stats: { atk: 0.10, def: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.1, to: 'ally_all' }] }]
        }
      }
    },

    /* ============================ 云隐村 · 精英 ============================ */
    {
      id: 'darui', name: '达鲁伊', form: '', en: 'Darui', title: '雷影的右臂',
      faction: 'kumo', rarity: 'SR', role: 'atk', element: 'lightning', tags: ['输出', '群攻', '控制'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 116 },
      bio: '四代目雷影的心腹上忍，性格懒散却实力出众。能与三代目雷影一样使用黑雷，还掌握岚遁；四战中担任忍者联军第一部队队长，以六道宝具封印了金银兄弟。',
      quote: '真累啊……不过，就到此为止吧。',
      art: {
        type: 'human', skin: '#6a4430', hair: 'messy', hairColor: '#f0f0f0',
        eyes: 'normal', eyeColor: '#2a2a2a', outfit: 'flak', outfitColor: '#e2ded4', accentColor: KUMO_DARK,
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'big_sword', aura: '#6a5acd'
      },
      skills: {
        passive: {
          name: '黑雷', tags: ['增益', '控制'],
          desc: '能与三代目雷影一样使用黑色雷遁：攻击力+8%；每次攻击命中后有15%概率使目标麻痹，眩晕1回合。',
          stats: { atk: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.15, effects: [{ type: 'status', status: 'stun', turns: 1 }] }]
        },
        s1: {
          name: '大刀斩', tags: ['输出', '单体'], fx: 'blade', target: 'single', cd: 0,
          desc: '挥舞宽刃大刀正面劈砍，造成115%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.15 }]
        },
        s2: {
          name: '雷遁·黑斑差', tags: ['爆发', '控制'], fx: 'lightning', target: 'single', cd: 3,
          desc: '从掌中放出形如黑豹的黑色雷电扑向敌人，造成190%攻击力伤害，并有40%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '岚遁·励挫锁苛素', tags: ['群攻', '穿透', '减益'], fx: 'storm', target: 'all',
          desc: '射出无数道能自由弯折的光束贯穿敌阵，对全体敌人造成3段共180%攻击力伤害，无视其25%防御，并使其受到的伤害+10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.6, hits: 3, pierce: 0.25 },
            { type: 'debuff', stat: 'dr', value: 0.1, turns: 2 }
          ]
        },
        awaken: {
          name: '六道宝具·幌金绳', tags: ['封印', '增益'],
          desc: '攻击力+12%；释放必杀技后，以从金银兄弟手中夺得的幌金绳夺取随机一名敌人的言灵，使其封印2回合（只能使用技能1）。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'silence', turns: 2, to: 'enemy_random' }] }]
        }
      }
    },

    {
      id: 'c', name: '希', form: '', en: 'Shī', title: '感知忍者',
      faction: 'kumo', rarity: 'R', role: 'ctrl', element: 'lightning', tags: ['控制', '治疗'],
      stats: { hp: 1.0, atk: 0.97, def: 1.03, spd: 110 },
      bio: '云隐村的感知型忍者，四代目雷影的护卫之一。擅长感知与幻术，兼修医疗忍术，曾与达鲁伊联手对抗闯入五影会谈的佐助。',
      quote: '感知到了……敌人就在那里！',
      art: {
        type: 'human', skin: LIGHT_SKIN, hair: 'short', hairColor: '#f0d88a',
        eyes: 'normal', eyeColor: '#4a3a2a', outfit: 'flak', outfitColor: KUMO_VEST, accentColor: '#4a5566',
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#ffe066'
      },
      skills: {
        passive: {
          name: '感知忍术', tags: ['增益', '闪避'],
          desc: '能感知敌人的查克拉与方位：闪避率+8%；战斗开始时为全队指明敌踪，使全体友方暴击率+10%，持续2回合。',
          stats: { dodge: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'crit', value: 0.1, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '手里剑之术', tags: ['输出', '单体'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '凭感知锁定敌人位置后投出手里剑，造成100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.0 }]
        },
        s2: {
          name: '雷遁·闪光柱', tags: ['控制', '单体'], fx: 'lightning', target: 'single', cd: 3,
          desc: '放出耀眼的雷光柱令敌人目眩，造成120%攻击力伤害，并有70%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.7 }
          ]
        },
        ult: {
          name: '幻术·雷光剑化', tags: ['控制', '群攻'], fx: 'genjutsu', target: 'all',
          desc: '令全体敌人陷入被无数雷光之剑贯穿的幻觉，造成130%攻击力伤害，并有40%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 }
          ]
        },
        awaken: {
          name: '医疗忍术', tags: ['治疗', '增益'],
          desc: '攻击力+10%；释放必杀技后为全体友方施展医疗忍术，恢复其8%最大生命值。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'heal', pct: 0.08, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'mabui', name: '玛布伊', form: '', en: 'Mabui', title: '雷影秘书',
      faction: 'kumo', rarity: 'R', role: 'sup', element: 'lightning', tags: ['回能', '增益'],
      stats: { hp: 1.0, atk: 0.95, def: 1.05, spd: 122 },
      bio: '四代目雷影的秘书，掌握能以光速传送物体的天送之术。四战中不幸遇害，又被药师兜以秽土转生召唤，被迫与昔日同伴为敌。',
      quote: '雷影大人，我立刻送过去。',
      art: {
        type: 'human', skin: '#7a4a30', hair: 'long_straight', hairColor: '#ececf2',
        eyes: 'normal', eyeColor: '#2a6a8a', outfit: 'flak', outfitColor: KUMO_VEST, accentColor: '#4a5a6a',
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: ['red_lips'], mask: 'none', hat: 'none', accessory: 'scroll', aura: '#ffe8a0'
      },
      skills: {
        passive: {
          name: '雷影秘书', tags: ['回能'],
          desc: '干练的雷影秘书，办事雷厉风行：速度+8%；战斗开始时为全体友方送去补给，使其各获得10点查克拉。',
          stats: { spd: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 10, to: 'ally_all' }] }]
        },
        s1: {
          name: '手里剑之术', tags: ['输出', '回能'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投掷手里剑，造成95%攻击力伤害，并使随机一名友方获得10点查克拉。',
          effects: [{ type: 'dmg', mult: 0.95 }, { type: 'chakra', value: 10, to: 'ally_random' }]
        },
        s2: {
          name: '天送之术', tags: ['回能', '增益'], fx: 'yang', target: 'ally_all', cd: 3,
          desc: '以天送之术将查克拉与物资以光速送达全队：全体友方获得15点查克拉，速度+15%，持续2回合。',
          effects: [
            { type: 'chakra', value: 15, to: 'ally_all' },
            { type: 'buff', stat: 'spd', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '天送之术·光速奇袭', tags: ['群攻', '减益'], fx: 'space', target: 'all',
          desc: '以天送之术将大量苦无与岩石以光速送入敌阵，对全体敌人造成130%攻击力伤害，并削减其15点查克拉。',
          effects: [{ type: 'dmg', mult: 1.3 }, { type: 'drain', value: 15 }]
        },
        awaken: {
          name: '光速传送', tags: ['增益'],
          desc: '攻击力+10%；释放必杀技后以天送之术为全队补给武器，使全体友方攻击力+15%，持续2回合。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'buff', stat: 'atk', value: 0.15, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'dodai', name: '多代', form: '', en: 'Dodai', title: '雷影的心腹',
      faction: 'kumo', rarity: 'R', role: 'tank', element: 'earth', tags: ['护盾', '嘲讽'],
      stats: { hp: 1.05, atk: 0.92, def: 1.05, spd: 96 },
      bio: '云隐村的资深上忍、四代目雷影的心腹，性格沉稳可靠。掌握罕见的护谟遁，能制造富有弹性的橡胶墙壁与橡胶球进行攻防。',
      quote: '雷影大人，请先冷静下来。',
      art: {
        type: 'human', skin: '#7a5034', hair: 'slick_back', hairColor: '#f0f0f0',
        eyes: 'normal', eyeColor: '#2a2a2a', outfit: 'flak', outfitColor: KUMO_VEST, accentColor: '#5a4a3a',
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: ['goatee'], beardColor: '#f0f0f0', mask: 'none', hat: 'none', accessory: 'none', aura: '#c8a2ff'
      },
      skills: {
        passive: {
          name: '雷影的辅佐', tags: ['护盾'],
          desc: '沉稳可靠的雷影心腹：防御+10%，生命值+5%；战斗开始时为全体友方提供8%最大生命值的护盾。',
          stats: { def: 0.10, hp: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.08, to: 'ally_all' }] }]
        },
        s1: {
          name: '体术·重拳', tags: ['输出', '护盾'], fx: 'fist', target: 'single', cd: 0,
          desc: '以厚重的拳头击打敌人，造成100%攻击力伤害，并获得15%攻击力的护盾。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'shield', mult: 0.15, to: 'self' }]
        },
        s2: {
          name: '护谟遁·护谟壁', tags: ['护盾', '嘲讽'], fx: 'shield', target: 'ally_all', cd: 3,
          desc: '筑起富有弹性的橡胶墙壁挡在全队身前，为全体友方提供40%攻击力的护盾，持续2回合，并嘲讽敌人2回合。',
          effects: [
            { type: 'shield', mult: 0.4, turns: 2 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '护谟遁·护谟球', tags: ['群攻', '控制'], fx: 'earth', target: 'all',
          desc: '放出大量弹性十足的橡胶球在敌阵中来回弹射，对全体敌人造成130%攻击力伤害，并有30%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        awaken: {
          name: '护谟之躯', tags: ['反击', '增益'],
          desc: '防御+10%，攻击力+8%；以橡胶般的弹性卸力反弹，受到攻击时有25%概率对攻击者造成40%攻击力伤害。',
          stats: { def: 0.10, atk: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'dmg', mult: 0.4 }] }]
        }
      }
    },

    /* ============================ 云隐村 · 萨姆依小队 ============================ */
    {
      id: 'samui', name: '萨姆依', form: '', en: 'Samui', title: '冷静队长',
      faction: 'kumo', rarity: 'R', role: 'sup', element: 'lightning', tags: ['增益', '封印'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 112 },
      bio: '云隐村的上忍，萨姆依小队的队长，阿兹伊的姐姐。无论何时都保持冷静、讲求效率；四战中与弟弟及达鲁伊等人一同对抗秽土转生的金银兄弟。',
      quote: '冷静点，先分析情况。',
      art: {
        type: 'human', skin: LIGHT_SKIN, hair: 'bob', hairColor: '#f3d77a',
        eyes: 'normal', eyeColor: '#4a7fb0', outfit: 'flak', outfitColor: '#f0ede6', accentColor: '#6a7a8a',
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'tanto', aura: '#bfe3ff'
      },
      skills: {
        passive: {
          name: '冷静分析', tags: ['增益'],
          desc: '无论何时都保持冷静、指挥小队：暴击率+8%；战斗开始时使全体友方防御+15%，持续2回合。',
          stats: { crit: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'def', value: 0.15, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '短刀术', tags: ['输出', '减益'], fx: 'blade', target: 'single', cd: 0,
          desc: '冷静看穿破绽后以短刀斩击，造成100%攻击力伤害，并降低目标10%防御，持续2回合。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'debuff', stat: 'def', value: 0.1, turns: 2 }]
        },
        s2: {
          name: '萨姆依小队·联携', tags: ['增益', '回能'], fx: 'yang', target: 'ally_all', cd: 3,
          desc: '冷静下达指令令全队联携作战：全体友方攻击力+20%，持续2回合，并各获得10点查克拉。',
          effects: [
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2 },
            { type: 'chakra', value: 10, to: 'ally_all' }
          ]
        },
        ult: {
          name: '琥珀净瓶', tags: ['封印', '减益', '单体'], fx: 'seal', target: 'single',
          desc: '打开六道宝具琥珀净瓶，以言灵将敌人吸入：先驱散目标的增益与护盾，再造成220%攻击力伤害，并使其封印2回合（只能使用技能1）。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 2.2 },
            { type: 'status', status: 'silence', turns: 2 }
          ]
        },
        awaken: {
          name: '临危不乱', tags: ['净化', '护盾'],
          desc: '攻击力+10%，防御+5%；生命首次低于30%时依旧冷静应对，净化全体友方的减益与异常状态，并为其提供10%最大生命值的护盾。',
          stats: { atk: 0.10, def: 0.05 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'cleanse', to: 'ally_all' }, { type: 'shield', pct: 0.1, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'atsui', name: '阿兹伊', form: '', en: 'Atsui', title: '热血男儿',
      faction: 'kumo', rarity: 'R', role: 'atk', element: 'fire', tags: ['输出', '持续'],
      stats: { hp: 0.96, atk: 1.12, def: 0.93, spd: 118 },
      bio: '萨姆依的弟弟，性格冲动热血，口头禅是“好热！”。擅长火遁与剑术，四战中隶属达鲁伊率领的第一部队。',
      quote: '好热！好热啊！燃起来了！',
      art: {
        type: 'human', skin: '#f0d2b6', hair: 'spiky_up', hairColor: '#f2c94c',
        eyes: 'normal', eyeColor: '#5a3a2a', outfit: 'flak', outfitColor: KUMO_VEST, accentColor: '#c0462a',
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'sword', aura: '#ff7a2b'
      },
      skills: {
        passive: {
          name: '热血', tags: ['增益'],
          desc: '“好热！”越打越起劲：攻击力+8%；受到攻击时有30%概率热血沸腾，攻击力+10%，持续2回合。',
          stats: { atk: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'buff', stat: 'atk', value: 0.1, turns: 2 }] }]
        },
        s1: {
          name: '炎刃斩', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 0,
          desc: '挥出缠绕火焰的刀刃，造成110%攻击力伤害，并有30%概率使目标灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '火遁·火龙炎弹', tags: ['群攻', '持续'], fx: 'fire', target: 'all', cd: 3,
          desc: '喷出火龙般的烈焰席卷敌阵，对全体敌人造成80%攻击力伤害，并有40%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.4, value: 0.3 }
          ]
        },
        ult: {
          name: '火遁·炎刀爆斩', tags: ['爆发', '持续', '单体'], fx: 'fire', target: 'single',
          desc: '将火遁查克拉全部灌注于刀身猛力斩下，造成280%攻击力伤害，并使目标灼烧3回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 2.8 },
            { type: 'status', status: 'burn', turns: 3, value: 0.35 }
          ]
        },
        awaken: {
          name: '热血沸腾', tags: ['增益', '爆发'],
          desc: '攻击力+10%，暴击率+5%；生命首次低于30%时彻底燃起斗志，攻击力+30%、速度+20%，持续2回合。',
          stats: { atk: 0.10, crit: 0.05 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'buff', stat: 'atk', value: 0.3, turns: 2 },
            { type: 'buff', stat: 'spd', value: 0.2, turns: 2 }
          ] }]
        }
      }
    },

    {
      id: 'karui', name: '卡鲁伊', form: '', en: 'Karui', title: '火爆剑士',
      faction: 'kumo', rarity: 'R', role: 'atk', element: 'lightning', tags: ['输出', '爆发', '反击'],
      stats: { hp: 0.95, atk: 1.15, def: 0.9, spd: 122 },
      bio: '云隐村的女忍者，萨姆依小队成员，红发褐肤，脾气火爆、好胜心强。擅长剑术与体术，曾因佐助袭击奇拉比一事迁怒于鸣人，而鸣人始终没有还手。',
      quote: '少啰嗦！吃我一刀！',
      art: {
        type: 'human', skin: '#7a4a30', hair: 'short', hairColor: '#c0302b',
        eyes: 'normal', eyeColor: '#e0a030', outfit: 'flak', outfitColor: KUMO_VEST, accentColor: '#3b2c2c',
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'sword', aura: '#ff7055'
      },
      skills: {
        passive: {
          name: '火爆脾气', tags: ['反击'],
          desc: '一点就着的火爆性子：暴击率+10%；受到攻击时有20%概率立即还手，对攻击者造成50%攻击力伤害。',
          stats: { crit: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'dmg', mult: 0.5 }] }]
        },
        s1: {
          name: '云隐流剑术', tags: ['输出', '单体'], fx: 'blade', target: 'single', cd: 0,
          desc: '以凌厉的剑术连斩两刀，造成2段共110%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.55, hits: 2 }]
        },
        s2: {
          name: '怒拳连打', tags: ['爆发', '减益'], fx: 'fist', target: 'single', cd: 3,
          desc: '怒火中烧地挥拳痛殴，造成3段共180%攻击力伤害，并降低目标15%防御，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.6, hits: 3 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '剑术·怒涛连斩', tags: ['爆发', '斩杀', '单体'], fx: 'blade', target: 'single',
          desc: '怒涛般连续挥刀，造成4段共280%攻击力伤害；生命值低于30%的目标额外受到80%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 0.7, hits: 4 },
            { type: 'execute', threshold: 0.3, mult: 0.8 }
          ]
        },
        awaken: {
          name: '不服输', tags: ['增益', '回能'],
          desc: '攻击力+10%；击败敌人后气势更盛，获得30点查克拉，攻击力+15%，持续2回合。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_kill', effects: [
            { type: 'chakra', value: 30 },
            { type: 'buff', stat: 'atk', value: 0.15, turns: 2 }
          ] }]
        }
      }
    },

    {
      id: 'omoi', name: '奥摩伊', form: '', en: 'Omoi', title: '多虑剑士',
      faction: 'kumo', rarity: 'R', role: 'atk', element: 'lightning', tags: ['输出', '闪避', '反击'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 126 },
      bio: '云隐村的忍者，萨姆依小队成员，嘴里总叼着棒棒糖，凡事都会往最坏的方向想。擅长雷遁与剑术，出手前总会预想各种可能。',
      quote: '万一……要是变成那样可怎么办？',
      art: {
        type: 'human', skin: '#5e3a26', hair: 'short', hairColor: '#efefef',
        eyes: 'normal', eyeColor: '#2a2a2a', outfit: 'flak', outfitColor: '#dcd8cf', accentColor: KUMO_DARK,
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'sword', aura: '#9fd2ff'
      },
      skills: {
        passive: {
          name: '杞人忧天', tags: ['闪避', '增益'],
          desc: '凡事都先往最坏处想，因而时刻有所防备：闪避率+10%；受到攻击时有25%概率提高警惕，防御+15%，持续2回合。',
          stats: { dodge: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'buff', stat: 'def', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '剑术·突刺', tags: ['输出', '穿透'], fx: 'blade', target: 'single', cd: 0,
          desc: '看准破绽以长刀突刺，造成115%攻击力伤害，无视目标15%防御。',
          effects: [{ type: 'dmg', mult: 1.15, pierce: 0.15 }]
        },
        s2: {
          name: '剑术·后发制人', tags: ['闪避', '反击'], fx: 'shield', target: 'self', cd: 3,
          desc: '预想好所有最坏情况后摆出架势：闪避率+20%，持续2回合；2回合内受到攻击时反击，造成70%攻击力伤害。',
          effects: [
            { type: 'buff', stat: 'dodge', value: 0.2, turns: 2 },
            { type: 'counter', mult: 0.7, turns: 2 }
          ]
        },
        ult: {
          name: '雷遁·雷光一闪', tags: ['爆发', '穿透', '单体'], fx: 'lightning', target: 'single',
          desc: '将雷遁查克拉灌注于刀身，以雷光般的速度一闪而过，造成290%攻击力伤害，无视目标25%防御，并降低其速度20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 2.9, pierce: 0.25 },
            { type: 'debuff', stat: 'spd', value: 0.2, turns: 2 }
          ]
        },
        awaken: {
          name: '深思熟虑', tags: ['增益'],
          desc: '攻击力+10%，暴击率+5%；战斗开始前就已想好对策，速度+20%，持续2回合。',
          stats: { atk: 0.10, crit: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'spd', value: 0.2, turns: 2 }] }]
        }
      }
    },

    /* ============================ 云隐村 · 人柱力与金银兄弟 ============================ */
    {
      id: 'yugito', name: '二位由木人', form: '二尾人柱力', en: 'Nii Yugito', title: '蓝焰猫又',
      faction: 'kumo', rarity: 'SR', role: 'atk', element: 'fire', tags: ['输出', '群攻', '持续'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 122 },
      bio: '云隐村的上忍，二尾又旅的人柱力，能熟练地控制尾兽之力。在与晓组织的飞段、角都交战时落败被捕，二尾被抽离后身亡；四战中被秽土转生召回战场。',
      quote: '我体内的二尾，可不是好惹的。',
      art: {
        type: 'human', skin: LIGHT_SKIN, hair: 'low_ponytail', hairColor: '#f1d36b',
        eyes: 'normal', eyeColor: '#3a2a3a', outfit: 'highcollar', outfitColor: '#3c2a4d', accentColor: '#5ab0ff',
        headband: 'kumo', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#3b8bff'
      },
      skills: {
        passive: {
          name: '二尾的查克拉', tags: ['持续', '闪避'],
          desc: '能熟练驾驭二尾又旅之力，身手如猫般敏捷：速度+6%，闪避率+8%；攻击命中后有20%概率以蓝色鬼火使目标灼烧2回合（每回合30%攻击力）。',
          stats: { spd: 0.06, dodge: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'status', status: 'burn', turns: 2, value: 0.3 }] }]
        },
        s1: {
          name: '猫又之爪', tags: ['输出', '持续'], fx: 'beast', target: 'single', cd: 0,
          desc: '以化为猫爪的利爪连续撕扯，造成3段共120%攻击力伤害，并有20%概率使目标流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.4, hits: 3 },
            { type: 'status', status: 'bleed', turns: 2, chance: 0.2, value: 0.3 }
          ]
        },
        s2: {
          name: '鬼火', tags: ['群攻', '持续'], fx: 'fire', target: 'all', cd: 3,
          desc: '喷吐出幽蓝的鬼火席卷敌阵，对全体敌人造成75%攻击力伤害，并有50%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.75 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.5, value: 0.3 }
          ]
        },
        ult: {
          name: '尾兽化·又旅', tags: ['群攻', '爆发', '持续'], fx: 'bijuu', target: 'all',
          desc: '化身为浑身燃烧蓝焰的二尾又旅扑向敌阵，对全体敌人造成160%攻击力伤害，并有50%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.6 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.5, value: 0.3 }
          ]
        },
        awaken: {
          name: '猫又化', tags: ['护盾', '增益'],
          desc: '攻击力+12%；生命首次低于30%时化身猫又、以蓝焰包覆全身，获得25%最大生命值的护盾，攻击力+25%，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'shield', pct: 0.25, turns: 2 },
            { type: 'buff', stat: 'atk', value: 0.25, turns: 2 }
          ] }]
        }
      }
    },

    {
      id: 'kinkaku', name: '金角', form: '', en: 'Kinkaku', title: '金角部队首领',
      faction: 'kumo', rarity: 'SR', role: 'atk', element: 'wind', tags: ['群攻', '吸血'],
      stats: { hp: 1.05, atk: 1.08, def: 0.9, spd: 112 },
      bio: '云隐村的叛忍，与弟弟银角并称“金银兄弟”，持有六道仙人的宝具，曾率金角部队袭击二代目火影与二代目雷影。兄弟二人曾被九尾吞入腹中，靠吃下九尾的血肉存活，从而获得九尾的查克拉；四战中被秽土转生召唤。',
      quote: '我们兄弟可是连九尾都吃过的！',
      art: {
        type: 'human', skin: '#9a6a44', hair: 'wild_long', hairColor: '#f1d77a',
        eyes: 'dark', eyeColor: '#ffc400', outfit: 'robe', outfitColor: '#6b5a45', accentColor: '#e8c547',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'fan', aura: '#ff7a1a'
      },
      skills: {
        passive: {
          name: '金银兄弟', tags: ['增益', '回能'],
          desc: '与弟弟银角形影不离：攻击力+8%，暴击率+8%；有友方倒下时暴怒，攻击力+25%，持续2回合，并获得20点查克拉。',
          stats: { atk: 0.08, crit: 0.08 },
          triggers: [{ on: 'on_ally_death', effects: [
            { type: 'buff', stat: 'atk', value: 0.25, turns: 2 },
            { type: 'chakra', value: 20 }
          ] }]
        },
        s1: {
          name: '芭蕉扇·风', tags: ['输出', '单体'], fx: 'wind', target: 'single', cd: 0,
          desc: '挥动六道宝具芭蕉扇掀起狂风，造成115%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.15 }]
        },
        s2: {
          name: '芭蕉扇·火', tags: ['群攻', '持续'], fx: 'fire', target: 'all', cd: 3,
          desc: '以芭蕉扇扇出烈焰席卷敌阵，对全体敌人造成85%攻击力伤害，并有40%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.85 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.4, value: 0.3 }
          ]
        },
        ult: {
          name: '九尾查克拉外衣', tags: ['群攻', '吸血', '增益'], fx: 'bijuu', target: 'all',
          desc: '释放体内九尾的查克拉化为巨大的狐形外衣横扫敌阵，对全体敌人造成160%攻击力伤害，并将造成伤害的20%转化为自身生命；自身攻击力+20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.6 },
            { type: 'lifesteal', value: 0.2 },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '九尾的血肉', tags: ['吸血', '治疗'],
          desc: '靠吃下九尾的血肉获得了惊人的生命力：攻击力+12%，吸血+6%；每回合开始时恢复3%最大生命值。',
          stats: { atk: 0.12, lifesteal: 0.06 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.03 }] }]
        }
      }
    },

    {
      id: 'ginkaku', name: '银角', form: '', en: 'Ginkaku', title: '言灵封印者',
      faction: 'kumo', rarity: 'SR', role: 'ctrl', element: 'yin', tags: ['封印', '控制'],
      stats: { hp: 1.0, atk: 1.08, def: 0.93, spd: 116 },
      bio: '金角的弟弟，同样因吃下九尾的血肉而拥有九尾的查克拉。善用六道宝具七星剑与幌金绳夺取对手的“言灵”，再以红葫芦将其封印；四战中被秽土转生召唤，最终被达鲁伊以宝具反过来封印。',
      quote: '只要你开口，就逃不掉了。',
      art: {
        type: 'human', skin: '#9a6a44', hair: 'shaggy', hairColor: '#d8dde2',
        eyes: 'dark', eyeColor: '#b0bec5', outfit: 'robe', outfitColor: '#4a4e58', accentColor: '#c0c6cf',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'sword', aura: '#ff7a1a'
      },
      skills: {
        passive: {
          name: '言灵', tags: ['封印'],
          desc: '能借六道宝具夺取对手的“言灵”：暴击率+8%；攻击命中后有25%概率使目标封印1回合（只能使用技能1）。',
          stats: { crit: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.25, effects: [{ type: 'status', status: 'silence', turns: 1 }] }]
        },
        s1: {
          name: '七星剑', tags: ['输出', '减益'], fx: 'blade', target: 'single', cd: 0,
          desc: '挥动六道宝具七星剑斩击，造成110%攻击力伤害，并削减目标10点查克拉。',
          effects: [{ type: 'dmg', mult: 1.1 }, { type: 'drain', value: 10 }]
        },
        s2: {
          name: '幌金绳', tags: ['控制', '单体'], fx: 'seal', target: 'single', cd: 3,
          desc: '甩出六道宝具幌金绳缠住敌人，造成150%攻击力伤害，并有85%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.85 }
          ]
        },
        ult: {
          name: '六道宝具·红葫芦', tags: ['封印', '减益', '单体'], fx: 'seal', target: 'single',
          desc: '以红葫芦吸入被夺去言灵的敌人：先驱散目标的增益与护盾，再造成290%攻击力伤害，使其封印2回合（只能使用技能1），并削减其30点查克拉。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 2.9 },
            { type: 'status', status: 'silence', turns: 2 },
            { type: 'drain', value: 30 }
          ]
        },
        awaken: {
          name: '九尾的查克拉', tags: ['护盾', '增益'],
          desc: '攻击力+12%，生命值+6%；生命首次低于30%时爆发九尾的查克拉，获得25%最大生命值的护盾，并免疫控制2回合。',
          stats: { atk: 0.12, hp: 0.06 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'shield', pct: 0.25, turns: 2 }, { type: 'immune', turns: 2 }] }]
        }
      }
    },

    /* ============================ 岩隐村 ============================ */
    {
      id: 'onoki', name: '大野木', form: '三代目土影', en: 'Ōnoki', title: '两天秤',
      faction: 'iwa', rarity: 'SSR', role: 'atk', element: 'earth', tags: ['输出', '穿透', '控制'],
      stats: { hp: 0.92, atk: 1.12, def: 0.96, spd: 120 },
      bio: '岩隐村的三代目土影，因善于在各方势力间权衡周旋而被称为“两天秤的大野木”。继承了老师二代目土影无的尘遁，能以原界剥离之术将目标分解至原子层面；四战中与五影一同迎战宇智波斑。',
      quote: '尘遁·原界剥离之术，消失吧！',
      art: {
        type: 'human', skin: '#f0d0b0', hair: 'bald', hairColor: '#ececec',
        eyes: 'normal', eyeColor: '#2a2a2a', outfit: 'kage', outfitColor: '#5c6b3a', accentColor: '#d9c27a',
        headband: 'none', marks: ['beard', 'mustache', 'wrinkles'], beardColor: '#f2f2f2',
        mask: 'none', hat: 'tsuchikage', accessory: 'none', aura: '#f2f2f2'
      },
      skills: {
        passive: {
          name: '两天秤', tags: ['闪避', '增益'],
          desc: '老练的土影，还能浮空飞行：闪避率+10%，暴击率+10%，但年事已高、腰不太好，生命值-5%；战斗开始时获得20点查克拉。',
          stats: { dodge: 0.10, crit: 0.10, hp: -0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '土遁·加重岩之术', tags: ['输出', '减益'], fx: 'earth', target: 'single', cd: 0,
          desc: '触碰敌人使其身体变得沉重无比，造成115%攻击力伤害，并降低其速度20%，持续2回合。',
          effects: [{ type: 'dmg', mult: 1.15 }, { type: 'debuff', stat: 'spd', value: 0.2, turns: 2 }]
        },
        s2: {
          name: '土遁·地动核', tags: ['群攻', '控制'], fx: 'earth', target: 'all', cd: 3,
          desc: '令地面猛然升降、将敌人困在岩层之间，对全体敌人造成90%攻击力伤害，并有35%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.35 }
          ]
        },
        ult: {
          name: '尘遁·原界剥离之术', tags: ['爆发', '穿透', '单体'], fx: 'dust', target: 'single',
          desc: '以尘遁的立方体结界将目标分解至原子层面：先驱散目标的增益与护盾，再造成320%攻击力伤害，并追加相当于目标15%最大生命值的真实伤害（无视防御）。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 3.2 },
            { type: 'true_dmg', pct: 0.15 }
          ]
        },
        awaken: {
          name: '土遁·超轻重岩之术', tags: ['增益'],
          desc: '攻击力+12%；释放必杀技后，以超轻重岩之术减轻全队的重量，使全体友方速度+15%、受到的伤害-10%，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [
            { type: 'buff', stat: 'spd', value: 0.15, turns: 2, to: 'ally_all' },
            { type: 'buff', stat: 'dr', value: 0.1, turns: 2, to: 'ally_all' }
          ] }]
        }
      }
    },

    {
      id: 'mu', name: '无', form: '二代目土影', en: 'Mū', title: '无形的土影',
      faction: 'iwa', rarity: 'SSR', role: 'atk', element: 'earth', tags: ['闪避', '穿透', '群攻'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 126 },
      bio: '岩隐村的二代目土影、大野木的老师，与二代目水影鬼灯幻月交战时同归于尽。能以无尘迷彩之术隐去身形与气息，并使用尘遁与分裂之术；四战中被秽土转生召唤。',
      quote: '你连我的存在都察觉不到。',
      art: {
        type: 'human', skin: '#e8e0cc', hair: 'none', hairColor: '#d9cfb8',
        eyes: 'dark', eyeColor: '#9e9e9e', outfit: 'cloak', outfitColor: '#6b5a44', accentColor: '#cfc4ad',
        headband: 'none', marks: ['bandage_face'], mask: 'cloth', maskColor: '#d9cfb8',
        hat: 'none', accessory: 'none', aura: '#e8e8e8'
      },
      skills: {
        passive: {
          name: '无尘迷彩之术', tags: ['闪避'],
          desc: '能完全隐去身形与气息，连感知忍者也无从察觉：闪避率+15%；战斗开始时隐身，闪避率再+15%，持续2回合。',
          stats: { dodge: 0.15 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'dodge', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '无尘迷彩·奇袭', tags: ['输出', '穿透'], fx: 'dust', target: 'single', cd: 0,
          desc: '于隐身状态下突然现身偷袭，造成115%攻击力伤害，无视目标25%防御。',
          effects: [{ type: 'dmg', mult: 1.15, pierce: 0.25 }]
        },
        s2: {
          name: '分裂之术', tags: ['输出', '闪避'], fx: 'clone', target: 'random', count: 2, cd: 3,
          desc: '将身体一分为二，两个分身分别袭击随机2名敌人，各造成90%攻击力伤害；同时自身闪避率+15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'buff', stat: 'dodge', value: 0.15, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '尘遁·原界剥离之术', tags: ['群攻', '穿透'], fx: 'dust', target: 'all',
          desc: '展开巨大的尘遁立方体结界笼罩敌阵：先驱散全体敌人的增益与护盾，再对其造成160%攻击力伤害，并追加相当于目标8%最大生命值的真实伤害（无视防御）。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 1.6 },
            { type: 'true_dmg', pct: 0.08 }
          ]
        },
        awaken: {
          name: '秽土转生', tags: ['治疗', '增益'],
          desc: '以秽土之躯重临战场：攻击力+12%；生命首次低于30%时尘土重组躯体，立即恢复30%最大生命值。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'heal', pct: 0.3 }] }]
        }
      }
    },

    {
      id: 'kurotsuchi', name: '黑土', form: '', en: 'Kurotsuchi', title: '土影之孙',
      faction: 'iwa', rarity: 'SR', role: 'ctrl', element: 'earth', tags: ['控制', '减益'],
      stats: { hp: 1.0, atk: 1.05, def: 0.95, spd: 118 },
      bio: '三代目土影大野木的孙女、黄土的女儿，与赤土一同担任土影的护卫。性格直爽好强，擅长以熔遁·石灰凝之术喷出迅速凝固的石灰封锁敌人行动。',
      quote: '爷爷，你就在后面看着吧！',
      art: {
        type: 'human', skin: '#f2d6bc', hair: 'bob', hairColor: '#1c1c22',
        eyes: 'normal', eyeColor: '#5a3a4a', outfit: 'sleeveless', outfitColor: IWA_RED, accentColor: '#6b6b6b',
        headband: 'iwa', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#ff9a3a'
      },
      skills: {
        passive: {
          name: '土影之孙', tags: ['减益'],
          desc: '继承了爷爷的好强性格：暴击率+8%；攻击命中后有20%概率让目标沾上石灰，速度-15%，持续2回合。',
          stats: { crit: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'debuff', stat: 'spd', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '苦无之术', tags: ['输出', '单体'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '迅速掷出苦无，造成110%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.1 }]
        },
        s2: {
          name: '熔遁·石灰凝之术', tags: ['控制', '减益'], fx: 'lava', target: 'single', cd: 3,
          desc: '从口中喷出迅速凝固的石灰浆包裹敌人，造成150%攻击力伤害，有80%概率使其束缚1回合，并降低其15%防御，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.8 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '熔遁·石灰凝缚', tags: ['群攻', '控制', '减益'], fx: 'lava', target: 'all',
          desc: '大范围喷出石灰浆覆盖敌阵，对全体敌人造成150%攻击力伤害，有50%概率使其束缚1回合，并降低其速度20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.5 },
            { type: 'debuff', stat: 'spd', value: 0.2, turns: 2 }
          ]
        },
        awaken: {
          name: '土遁·土流壁', tags: ['护盾', '增益'],
          desc: '攻击力+10%，防御+5%；生命首次低于30%时立刻筑起土墙，获得25%最大生命值的护盾，持续2回合。',
          stats: { atk: 0.10, def: 0.05 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'shield', pct: 0.25, turns: 2 }] }]
        }
      }
    },

    {
      id: 'akatsuchi', name: '赤土', form: '', en: 'Akatsuchi', title: '土影的护卫',
      faction: 'iwa', rarity: 'R', role: 'tank', element: 'earth', tags: ['嘲讽', '护盾'],
      stats: { hp: 1.15, atk: 0.9, def: 0.98, spd: 86 },
      bio: '岩隐村的上忍，体型魁梧、性格憨厚，与黑土一同担任三代目土影大野木的护卫，土影闪了腰时便由他背着赶路。擅长土遁，能制造岩石魔像作战。',
      quote: '土影大人，交给我吧！',
      art: {
        type: 'human', skin: '#f0caa6', hair: 'buzz', hairColor: '#2a2420',
        eyes: 'normal', eyeColor: '#2a2a2a', outfit: 'flak', outfitColor: IWA_RED, accentColor: IWA_TRIM,
        headband: 'iwa', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#c49a6c'
      },
      skills: {
        passive: {
          name: '憨厚的巨汉', tags: ['护盾'],
          desc: '体型魁梧的岩隐上忍：生命值+10%，防御+8%；战斗开始时获得10%最大生命值的护盾。',
          stats: { hp: 0.10, def: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.1 }] }]
        },
        s1: {
          name: '体术·冲撞', tags: ['输出', '护盾'], fx: 'fist', target: 'single', cd: 0,
          desc: '以魁梧的身躯猛撞敌人，造成100%攻击力伤害，并获得15%攻击力的护盾。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'shield', mult: 0.15, to: 'self' }]
        },
        s2: {
          name: '土遁·土流壁', tags: ['护盾', '嘲讽'], fx: 'shield', target: 'ally_all', cd: 3,
          desc: '结印拉起一道厚实的土墙，为全体友方提供10%最大生命值的护盾，持续2回合，并嘲讽敌人2回合。',
          effects: [
            { type: 'shield', pct: 0.1, turns: 2 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '土遁·魔像之术', tags: ['群攻', '嘲讽', '控制'], fx: 'earth', target: 'all',
          desc: '召唤岩石魔像抡起巨拳砸向敌阵，对全体敌人造成130%攻击力伤害，并有30%概率使其眩晕1回合；同时嘲讽敌人2回合。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 },
            { type: 'taunt', turns: 2 }
          ]
        },
        awaken: {
          name: '土影的护卫', tags: ['护盾', '嘲讽'],
          desc: '防御+10%，攻击力+8%；有友方倒下时挺身护在众人身前，为全体友方提供12%最大生命值的护盾，并嘲讽敌人2回合。',
          stats: { def: 0.10, atk: 0.08 },
          triggers: [{ on: 'on_ally_death', effects: [{ type: 'shield', pct: 0.12, to: 'ally_all' }, { type: 'taunt', turns: 2 }] }]
        }
      }
    },

    {
      id: 'kitsuchi', name: '黄土', form: '', en: 'Kitsuchi', title: '土影之子',
      faction: 'iwa', rarity: 'SR', role: 'tank', element: 'earth', tags: ['护盾', '嘲讽', '控制'],
      stats: { hp: 1.12, atk: 0.95, def: 0.95, spd: 98 },
      bio: '三代目土影大野木之子、黑土之父，岩隐村的精英上忍。擅长以土遁操纵巨大的岩体攻防一体，第四次忍界大战中担任忍者联军第二部队队长。',
      quote: '岩隐的坚韧，足以挡下一切。',
      art: {
        type: 'human', skin: '#eec7a2', hair: 'short', hairColor: '#3a2e24',
        eyes: 'normal', eyeColor: '#2a2a2a', outfit: 'flak', outfitColor: '#7d3a2c', accentColor: IWA_TRIM,
        headband: 'iwa', headbandSlash: false, headbandPos: 'forehead',
        marks: ['beard'], beardColor: '#3a2e24', mask: 'none', hat: 'none', accessory: 'none', aura: '#b08a5a'
      },
      skills: {
        passive: {
          name: '岩隐的坚韧', tags: ['减益'],
          desc: '如岩石般坚韧不拔：防御+12%，生命值+6%；受到攻击时有25%概率震伤攻击者，使其攻击力-10%，持续2回合。',
          stats: { def: 0.12, hp: 0.06 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'debuff', stat: 'atk', value: 0.1, turns: 2 }] }]
        },
        s1: {
          name: '土遁·岩拳', tags: ['输出', '护盾'], fx: 'earth', target: 'single', cd: 0,
          desc: '以岩石包覆拳头重击敌人，造成100%攻击力伤害，并获得20%攻击力的护盾。',
          effects: [{ type: 'dmg', mult: 1.0 }, { type: 'shield', mult: 0.2, to: 'self' }]
        },
        s2: {
          name: '土遁·山土之术', tags: ['控制', '单体'], fx: 'earth', target: 'single', cd: 3,
          desc: '从目标两侧隆起两座岩山将其夹住碾压，造成180%攻击力伤害，并有65%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.8 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.65 }
          ]
        },
        ult: {
          name: '土遁·岩之掌', tags: ['群攻', '护盾', '嘲讽'], fx: 'earth', target: 'all',
          desc: '从地面召出巨大的岩石手掌拍向敌阵，对全体敌人造成140%攻击力伤害；同时为全体友方提供15%最大生命值的护盾，持续2回合，并嘲讽敌人2回合。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'shield', pct: 0.15, turns: 2, to: 'ally_all' },
            { type: 'taunt', turns: 2 }
          ]
        },
        awaken: {
          name: '第二部队队长', tags: ['增益'],
          desc: '攻击力+10%，防御+10%；作为联军第二部队队长坐镇前线，战斗开始时使全体友方受到的伤害-10%，持续2回合。',
          stats: { atk: 0.10, def: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'dr', value: 0.1, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'roshi', name: '老紫', form: '四尾人柱力', en: 'Rōshi', title: '熔岩老将',
      faction: 'iwa', rarity: 'SR', role: 'atk', element: 'fire', tags: ['群攻', '持续', '减益'],
      stats: { hp: 1.05, atk: 1.08, def: 0.9, spd: 104 },
      bio: '岩隐村的四尾孙悟空的人柱力，蓄着一头红发与红胡子，能熟练运用四尾的熔遁之力。被晓组织捕获并抽离尾兽，四战中又以秽土转生之身被操纵参战。',
      quote: '熔岩会把一切都熔化殆尽。',
      art: {
        type: 'human', skin: '#eac4a0', hair: 'wild_long', hairColor: '#b5341f',
        eyes: 'normal', eyeColor: '#2a2a2a', outfit: 'armor', outfitColor: '#7a3a22', accentColor: '#e07a2a',
        headband: 'iwa', headbandSlash: false, headbandPos: 'forehead',
        marks: ['beard', 'mustache'], beardColor: '#b5341f', mask: 'none', hat: 'none', accessory: 'none', aura: '#ff5a1f'
      },
      skills: {
        passive: {
          name: '熔遁查克拉模式', tags: ['持续', '反击'],
          desc: '以熔岩般的查克拉包覆全身：攻击力+6%，防御+6%；受到攻击时有30%概率使攻击者被熔岩灼烧2回合（每回合30%攻击力）。',
          stats: { atk: 0.06, def: 0.06 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'status', status: 'burn', turns: 2, value: 0.3 }] }]
        },
        s1: {
          name: '熔遁·熔岩拳', tags: ['输出', '持续'], fx: 'lava', target: 'single', cd: 0,
          desc: '以包覆熔岩的拳头重击，造成110%攻击力伤害，并有30%概率使目标灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '熔遁·灼河流岩之术', tags: ['群攻', '持续'], fx: 'lava', target: 'all', cd: 3,
          desc: '喷吐出大量熔岩如河流般淹没敌阵，对全体敌人造成85%攻击力伤害，并有60%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.85 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.6, value: 0.3 }
          ]
        },
        ult: {
          name: '尾兽化·孙悟空', tags: ['群攻', '减益', '持续'], fx: 'bijuu', target: 'all',
          desc: '化身四尾孙悟空喷涌熔岩吞没敌阵，对全体敌人造成170%攻击力伤害，降低其20%防御，持续2回合；并有50%概率使其灼烧2回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.7 },
            { type: 'debuff', stat: 'def', value: 0.2, turns: 2 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.5, value: 0.35 }
          ]
        },
        awaken: {
          name: '孙悟空之力', tags: ['治疗', '增益'],
          desc: '攻击力+12%；生命首次低于30%时借四尾孙悟空之力重振，恢复20%最大生命值，攻击力+20%，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.2 },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2 }
          ] }]
        }
      }
    },

    {
      id: 'han', name: '汉', form: '五尾人柱力', en: 'Han', title: '蒸汽铠武者',
      faction: 'iwa', rarity: 'SR', role: 'tank', element: 'water', tags: ['嘲讽', '护盾'],
      stats: { hp: 1.12, atk: 0.95, def: 0.95, spd: 94 },
      bio: '岩隐村的五尾穆王的人柱力，身披红色铠甲、头戴斗笠，能以沸遁操纵高温蒸汽强化肉体。被晓组织捕获并抽离尾兽，四战中以秽土转生之身被操纵参战。',
      quote: '蒸汽的力量，你挡得住吗？',
      art: {
        type: 'human', skin: '#e8c3a0', hair: 'short', hairColor: '#4a3a2a',
        eyes: 'normal', eyeColor: '#2a2a2a', outfit: 'armor', outfitColor: '#a8342a', accentColor: '#e8e0d0',
        headband: 'none', marks: [], mask: 'cloth', maskColor: '#8a2a22',
        hat: 'straw', accessory: 'none', aura: '#ffcbb8'
      },
      skills: {
        passive: {
          name: '蒸汽铠甲', tags: ['护盾'],
          desc: '红色铠甲内充满高温蒸汽：生命值+10%，受到的伤害-8%；战斗开始时获得15%最大生命值的护盾。',
          stats: { hp: 0.10, dr: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.15 }] }]
        },
        s1: {
          name: '沸遁·蒸汽冲拳', tags: ['输出', '持续'], fx: 'boil', target: 'single', cd: 0,
          desc: '以喷射蒸汽推进的拳头重击，造成100%攻击力伤害，并有30%概率使目标被蒸汽烫伤，灼烧2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.25 }
          ]
        },
        s2: {
          name: '沸遁·蒸危暴威', tags: ['爆发', '嘲讽'], fx: 'boil', target: 'single', cd: 3,
          desc: '以全身蒸汽驱动的强力一击猛撞敌人，造成170%攻击力伤害；同时嘲讽敌人2回合，自身受到的伤害-15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.7 },
            { type: 'taunt', turns: 2 },
            { type: 'buff', stat: 'dr', value: 0.15, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '尾兽化·穆王', tags: ['群攻', '控制', '护盾'], fx: 'bijuu', target: 'all',
          desc: '化身五尾穆王以犄角冲撞敌阵，对全体敌人造成140%攻击力伤害，并有35%概率使其眩晕1回合；自身获得20%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.35 },
            { type: 'shield', pct: 0.2, turns: 2, to: 'self' }
          ]
        },
        awaken: {
          name: '沸遁之躯', tags: ['减益', '增益'],
          desc: '防御+10%，攻击力+8%；受到攻击时有30%概率以高温蒸汽烫伤攻击者，使其攻击力-15%，持续2回合。',
          stats: { def: 0.10, atk: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'debuff', stat: 'atk', value: 0.15, turns: 2 }] }]
        }
      }
    },

    /* ============================ 泷隐村 ============================ */
    {
      id: 'fu', name: '芙', form: '七尾人柱力', en: 'Fū', title: '泷隐少女',
      faction: 'other', rarity: 'SR', role: 'ctrl', element: 'wind', tags: ['控制', '闪避'],
      stats: { hp: 0.98, atk: 1.02, def: 1.0, spd: 128 },
      bio: '泷隐村的七尾重明的人柱力，性格开朗、渴望交到朋友。能借七尾之力展翅飞行，并以秘术·鳞粉隐之术散布发光的鳞粉；被晓组织捕获后身亡，四战中以秽土转生之身被操纵参战。',
      quote: '我们来交朋友吧！先打一场再说！',
      art: {
        type: 'human', skin: '#c98f5e', hair: 'short', hairColor: '#7ad7a2',
        eyes: 'normal', eyeColor: '#ff9a1a', outfit: 'sleeveless', outfitColor: '#f0f0f0', accentColor: '#d84a3a',
        headband: 'taki', headbandSlash: false, headbandPos: 'arm',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#c6ff5a'
      },
      skills: {
        passive: {
          name: '七尾·重明', tags: ['闪避', '回能'],
          desc: '借七尾重明之力展翅飞行：闪避率+10%，速度+5%；战斗开始时获得20点查克拉。',
          stats: { dodge: 0.10, spd: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '虫翅突击', tags: ['输出', '减益'], fx: 'wind', target: 'single', cd: 0,
          desc: '振翅高速俯冲撞向敌人，造成105%攻击力伤害，并以飞散的鳞粉迷住其双眼，攻击力-10%，持续2回合。',
          effects: [{ type: 'dmg', mult: 1.05 }, { type: 'debuff', stat: 'atk', value: 0.1, turns: 2 }]
        },
        s2: {
          name: '秘术·鳞粉隐之术', tags: ['群攻', '控制', '闪避'], fx: 'insect', target: 'all', cd: 3,
          desc: '撒出闪耀的鳞粉令敌人目眩，对全体敌人造成70%攻击力伤害，并有25%概率使其眩晕1回合；同时借鳞粉隐去身形，自身闪避率+15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.7 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.25 },
            { type: 'buff', stat: 'dodge', value: 0.15, turns: 2, to: 'self' }
          ]
        },
        ult: {
          name: '尾兽化·重明', tags: ['群攻', '控制'], fx: 'bijuu', target: 'all',
          desc: '化身七尾重明振动六翅，掀起漫天鳞粉，对全体敌人造成150%攻击力伤害，并有40%概率使其陷入睡眠2回合（受到伤害时醒来）。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'sleep', turns: 2, chance: 0.4 }
          ]
        },
        awaken: {
          name: '重明之翅', tags: ['控制', '闪避'],
          desc: '攻击力+10%，闪避率+8%；受到攻击时有25%概率扇起鳞粉，使攻击者陷入睡眠1回合（受到伤害时醒来）。',
          stats: { atk: 0.10, dodge: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'status', status: 'sleep', turns: 1 }] }]
        }
      }
    },

    /* ============================ 铁之国 ============================ */
    {
      id: 'mifune', name: '三船', form: '', en: 'Mifune', title: '公正的武士',
      faction: 'samurai', rarity: 'SSR', role: 'atk', element: 'none', tags: ['反击', '斩杀', '单体'],
      stats: { hp: 1.05, atk: 1.08, def: 0.93, spd: 132 },
      bio: '铁之国武士的大将，以中立立场主持了五影会谈。居合斩的技艺登峰造极，四战中担任忍者联军第五部队队长，并在一对一的对决中击败了秽土转生的山椒鱼半藏。',
      quote: '武士之道，就在这一刀之间。',
      art: {
        type: 'human', skin: '#efd2b6', hair: 'low_ponytail', hairColor: '#b8bcc2',
        eyes: 'normal', eyeColor: '#3a3a3a', outfit: 'samurai', outfitColor: '#e8e6e0', accentColor: '#3a4f6b',
        headband: 'none', marks: ['mustache', 'goatee', 'wrinkles'], beardColor: '#c8ccd2',
        mask: 'none', hat: 'none', accessory: 'sword', aura: '#c9d6e3'
      },
      skills: {
        passive: {
          name: '武士道', tags: ['反击', '增益'],
          desc: '恪守公正的武士之道：暴击率+15%，暴击伤害+30%，防御+5%；战斗开始时摆出居合之构，2回合内受到攻击时反击，造成60%攻击力伤害。',
          stats: { crit: 0.15, critDmg: 0.3, def: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'counter', mult: 0.6, turns: 2 }] }]
        },
        s1: {
          name: '居合斩', tags: ['输出', '单体'], fx: 'blade', target: 'single', cd: 0,
          desc: '将查克拉灌注于刀身，于拔刀的瞬间斩击敌人，造成130%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.3 }]
        },
        s2: {
          name: '居合之构', tags: ['爆发', '反击'], fx: 'blade', target: 'single', cd: 3,
          desc: '摆出居合之构后瞬间拔刀斩击，造成180%攻击力伤害；随后保持架势，受到的伤害-15%，持续2回合，且2回合内受到攻击时反击，造成100%攻击力伤害。',
          effects: [
            { type: 'dmg', mult: 1.8 },
            { type: 'buff', stat: 'dr', value: 0.15, turns: 2, to: 'self' },
            { type: 'counter', mult: 1.0, turns: 2 }
          ]
        },
        ult: {
          name: '居合斩·一闪', tags: ['爆发', '斩杀', '单体'], fx: 'blade', target: 'single',
          desc: '于刹那间拔刀，一刀斩断敌人，造成340%攻击力伤害；目标生命值低于35%时额外受到150%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 3.4 },
            { type: 'execute', threshold: 0.35, mult: 1.5 }
          ]
        },
        awaken: {
          name: '铁之国大将', tags: ['反击', '增益'],
          desc: '攻击力+12%；生命首次低于30%时更显大将风骨，3回合内受到攻击时反击，造成120%攻击力伤害，并免疫控制2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'counter', mult: 1.2, turns: 3 }, { type: 'immune', turns: 2 }] }]
        }
      }
    }

  ]);
})();
