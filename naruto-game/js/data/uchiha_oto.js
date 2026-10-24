/* js/data/uchiha_oto.js — 宇智波一族、战国传说、音隐与鹰小队
 * 宇智波一族（止水、富岳、美琴、泉、镜、少年带土、野原琳）、战国传说（宇智波斑三形态、泉奈）、
 * 音隐村（大蛇丸、药师兜两形态、君麻吕、音忍四人众、音忍三人组）以及鹰小队（香燐、重吾、水月）。
 * 仅收录《火影忍者》与《火影忍者疾风传》时期的角色、形态与忍术（不含任何博人传内容）。
 */
(function () {
  'use strict';

  var SOUND_ROBE = '#e6dcc6';   // 音忍四人众的米色上衣
  var SOUND_ROPE = '#6a3fa0';   // 紫色绳结腰带
  var UCHIHA_RED = '#c62828';   // 宇智波团扇纹的红色

  NG.defineChars('uchiha_oto', [

    /* ============================ 宇智波止水 ============================ */
    {
      id: 'shisui', name: '宇智波止水', form: '瞬身之止水', en: 'Uchiha Shisui', title: '木叶的守护者',
      faction: 'konoha', rarity: 'SSR', role: 'ctrl', element: 'fire', tags: ['控制', '闪避', '群攻'],
      stats: { hp: 0.95, atk: 1.08, def: 0.95, spd: 142 },
      bio: '宇智波一族的天才忍者，以出神入化的瞬身术闻名忍界，人称“瞬身止水”。他的万花筒写轮眼拥有最强幻术“别天神”，为阻止一族政变，他将左眼托付给挚友鼬后投河自尽。',
      quote: '守护好村子，还有宇智波之名。',
      art: {
        type: 'human', skin: '#f1d6bf', hair: 'shaggy', hairColor: '#16171f',
        eyes: 'ms_shisui', outfit: 'highcollar', outfitColor: '#23283a', accentColor: UCHIHA_RED,
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'tanto', aura: '#3fbf7f'
      },
      skills: {
        passive: {
          name: '万花筒写轮眼', tags: ['闪避', '增益'],
          desc: '洞悉敌人一举一动的瞳力：闪避率+15%，暴击率+8%；战斗开始时获得20点查克拉。',
          stats: { dodge: 0.15, crit: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '瞬身术', tags: ['输出', '闪避'], fx: 'blade', target: 'single', cd: 0,
          desc: '以肉眼难以捕捉的瞬身术绕到敌人身后连续斩击，造成3段共114%攻击力伤害，并使自身闪避率+10%，持续1回合。',
          effects: [
            { type: 'dmg', mult: 0.38, hits: 3 },
            { type: 'buff', stat: 'dodge', value: 0.10, turns: 1 }
          ]
        },
        s2: {
          name: '火遁·豪火球之术', tags: ['群攻', '持续'], fx: 'fire', target: 'all', cd: 3,
          desc: '喷出巨大的火球席卷敌阵，对全体敌人造成100%攻击力伤害，并有40%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.4, value: 0.3 }
          ]
        },
        ult: {
          name: '别天神', tags: ['控制', '群攻', '减益'], fx: 'eye', target: 'all',
          desc: '以万花筒写轮眼的最强幻术在不知不觉间改写敌人的意志：对全体敌人造成130%攻击力伤害，有45%概率使其束缚1回合，并削减其10点查克拉。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.45 },
            { type: 'drain', value: 10 }
          ]
        },
        awaken: {
          name: '须佐能乎', tags: ['护盾', '增益'],
          desc: '攻击力+12%；释放必杀技后，以翠绿色的须佐能乎庇护全体友方，使其获得12%最大生命值的护盾，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'shield', pct: 0.12, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    /* ============================ 宇智波富岳 ============================ */
    {
      id: 'fugaku', name: '宇智波富岳', form: '', en: 'Uchiha Fugaku', title: '警务部队长',
      faction: 'konoha', rarity: 'SR', role: 'tank', element: 'fire', tags: ['嘲讽', '反击', '控制'],
      stats: { hp: 1.1, atk: 0.95, def: 1.0, spd: 98 },
      bio: '宇智波一族的族长、木叶警务部队的队长，宇智波鼬与佐助的父亲。因村子对一族的猜忌而策划政变，灭族之夜他平静地接受了鼬的刀，并嘱托鼬照顾好佐助。',
      quote: '鼬，你永远是我的骄傲。',
      art: {
        type: 'human', skin: '#efd2b8', hair: 'short', hairColor: '#1b1b22',
        eyes: 'sharingan', outfit: 'kimono', outfitColor: '#3a3f55', accentColor: UCHIHA_RED,
        headband: 'none', marks: ['wrinkles'], mask: 'none', hat: 'none', accessory: 'none', aura: '#e53935'
      },
      skills: {
        passive: {
          name: '木叶警务部队', tags: ['嘲讽', '增益'],
          desc: '身为警务部队长坐镇一方：防御+12%，受到的伤害-6%；战斗开始时嘲讽敌方1回合。',
          stats: { def: 0.12, dr: 0.06 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'taunt', turns: 1 }] }]
        },
        s1: {
          name: '火遁·豪火球之术', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 0,
          desc: '喷出巨大的火球，造成100%攻击力伤害，并有30%概率使目标灼烧2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.25 }
          ]
        },
        s2: {
          name: '写轮眼·金缚之术', tags: ['控制', '嘲讽'], fx: 'eye', target: 'single', cd: 3,
          desc: '以写轮眼的瞳术令目标身体僵直：造成120%攻击力伤害，有60%概率使其束缚1回合，并嘲讽敌方2回合。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.6 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '万花筒写轮眼', tags: ['群攻', '护盾', '反击'], fx: 'eye', target: 'all',
          desc: '开启深藏多年的万花筒写轮眼震慑全场：对全体敌人造成130%攻击力伤害，自身获得20%最大生命值的护盾（持续2回合），并在2回合内受到攻击时反击，造成80%攻击力伤害。',
          effects: [
            { type: 'dmg', mult: 1.3 },
            { type: 'shield', pct: 0.2, turns: 2, to: 'self' },
            { type: 'counter', mult: 0.8, turns: 2 }
          ]
        },
        awaken: {
          name: '以你为荣', tags: ['增益'],
          desc: '生命值+10%，攻击力+10%；阵亡时将一族的未来托付给后辈，使全体友方攻击力+20%，持续3回合。',
          stats: { hp: 0.10, atk: 0.10 },
          triggers: [{ on: 'on_death', effects: [{ type: 'buff', stat: 'atk', value: 0.2, turns: 3, to: 'ally_all' }] }]
        }
      }
    },

    /* ============================ 宇智波美琴 ============================ */
    {
      id: 'mikoto', name: '宇智波美琴', form: '', en: 'Uchiha Mikoto', title: '温柔的母亲',
      faction: 'konoha', rarity: 'R', role: 'sup', element: 'fire', tags: ['增益', '护盾', '治疗'],
      stats: { hp: 1.0, atk: 0.95, def: 1.05, spd: 105 },
      bio: '宇智波富岳之妻，鼬与佐助的母亲，也是漩涡玖辛奈的挚友。她温柔而坚强，灭族之夜与丈夫一同平静地迎接了自己的命运。',
      quote: '无论如何，我们都爱着你。',
      art: {
        type: 'human', gender: 'f', skin: '#f5dcc8', hair: 'long_straight', hairColor: '#1a1c2a',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'shirt', outfitColor: '#4a4560', accentColor: '#e8e2d6',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff8a80'
      },
      skills: {
        passive: {
          name: '贤妻良母', tags: ['护盾', '增益'],
          desc: '贤惠坚强的宇智波主母：防御+8%；战斗开始时为全体友方提供10%最大生命值的护盾，持续2回合。',
          stats: { def: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.10, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '手里剑术', tags: ['消耗'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '精准地投出手里剑，造成95%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.95 }]
        },
        s2: {
          name: '写轮眼', tags: ['增益', '闪避'], fx: 'eye', target: 'ally_all', cd: 3,
          desc: '以写轮眼看穿敌人的动作并提醒同伴：全体友方暴击率+12%、闪避率+10%，持续2回合。',
          effects: [
            { type: 'buff', stat: 'crit', value: 0.12, turns: 2 },
            { type: 'buff', stat: 'dodge', value: 0.10, turns: 2 }
          ]
        },
        ult: {
          name: '火遁·凤仙火之术', tags: ['群攻', '治疗'], fx: 'fire', target: 'all',
          desc: '与家人并肩作战，喷出漫天的凤仙火：对全体敌人造成120%攻击力伤害，并为全体友方恢复60%攻击力的生命值。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'heal', mult: 0.6, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '母亲的心愿', tags: ['治疗', '净化'],
          desc: '攻击力+10%，生命值+5%；阵亡时将最后的温柔留给同伴，为全体友方恢复20%最大生命值，并清除其减益与异常状态。',
          stats: { atk: 0.10, hp: 0.05 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'heal', pct: 0.2, to: 'ally_all' },
            { type: 'cleanse', to: 'ally_all' }
          ] }]
        }
      }
    },

    /* ============================ 宇智波泉 ============================ */
    {
      id: 'izumi', name: '宇智波泉', form: '', en: 'Uchiha Izumi', title: '鼬的青梅竹马',
      faction: 'konoha', rarity: 'R', role: 'ctrl', element: 'fire', tags: ['控制', '群攻'],
      stats: { hp: 0.95, atk: 1.02, def: 1.0, spd: 112 },
      bio: '宇智波鼬的青梅竹马，一直默默地喜欢着鼬，立志成为配得上他的出色忍者。灭族之夜，鼬以月读让她在幻术中度过了与他共度的幸福一生，随后安详离世。',
      quote: '能遇见你，我很幸福。',
      art: {
        type: 'human', gender: 'f', skin: '#f6dcc6', hair: 'long_straight', hairColor: '#3a2a24',
        eyes: 'sharingan', outfit: 'highcollar', outfitColor: '#8e6fa8', accentColor: '#2c2c3c',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#f48fb1'
      },
      skills: {
        passive: {
          name: '写轮眼', tags: ['控制', '闪避'],
          desc: '以写轮眼辅助施展幻术：闪避率+10%；攻击命中后有15%概率使目标陷入睡眠1回合（受到伤害时苏醒）。',
          stats: { dodge: 0.10 },
          triggers: [{ on: 'on_attack', chance: 0.15, effects: [{ type: 'status', status: 'sleep', turns: 1 }] }]
        },
        s1: {
          name: '影手里剑之术', tags: ['消耗'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '在手里剑的影子里藏下第二枚手里剑，造成2段共100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.5, hits: 2 }]
        },
        s2: {
          name: '火遁·豪火球之术', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 3,
          desc: '喷出巨大的火球，造成150%攻击力伤害，并使目标灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'burn', turns: 2, value: 0.3 }
          ]
        },
        ult: {
          name: '写轮眼·幻术', tags: ['控制', '群攻'], fx: 'genjutsu', target: 'all',
          desc: '以写轮眼将全体敌人拖入幻术：造成120%攻击力伤害，并有60%概率使其陷入睡眠2回合（受到伤害时苏醒）。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'sleep', turns: 2, chance: 0.6 }
          ]
        },
        awaken: {
          name: '幸福的幻梦', tags: ['控制'],
          desc: '攻击力+10%，闪避率+5%；阵亡时在幸福的梦境中安然离去，使全体敌人陷入睡眠1回合（受到伤害时苏醒）。',
          stats: { atk: 0.10, dodge: 0.05 },
          triggers: [{ on: 'on_death', effects: [{ type: 'status', status: 'sleep', turns: 1, to: 'enemy_all' }] }]
        }
      }
    },

    /* ============================ 宇智波镜 ============================ */
    {
      id: 'kagami', name: '宇智波镜', form: '', en: 'Uchiha Kagami', title: '扉间的弟子',
      faction: 'konoha', rarity: 'SR', role: 'sup', element: 'fire', tags: ['增益', '护盾', '减益'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 116 },
      bio: '宇智波一族中少有的继承了“火之意志”的忍者，与猿飞日斩、志村团藏等人同为二代目火影千手扉间的弟子。他深受扉间信任，也是宇智波止水的先祖。',
      quote: '我也愿以火之意志守护村子。',
      art: {
        type: 'human', skin: '#f1d6bf', hair: 'messy', hairColor: '#17181f',
        eyes: 'sharingan', outfit: 'flak', outfitColor: '#3c4a3a', accentColor: '#1d2230',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#ff7043'
      },
      skills: {
        passive: {
          name: '写轮眼', tags: ['增益'],
          desc: '与同伴配合无间的宇智波精英：暴击率+8%，闪避率+8%；战斗开始时使全体友方攻击力+10%，持续2回合。',
          stats: { crit: 0.08, dodge: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'atk', value: 0.10, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '火遁·龙火之术', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 0,
          desc: '喷吐出龙形的火焰，造成110%攻击力伤害，并有20%概率使目标灼烧2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.2, value: 0.25 }
          ]
        },
        s2: {
          name: '写轮眼·瞳术', tags: ['减益', '群攻'], fx: 'eye', target: 'all', cd: 3,
          desc: '以写轮眼的瞳术扰乱敌阵：对全体敌人造成60%攻击力伤害，并降低其攻击力15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.6 },
            { type: 'debuff', stat: 'atk', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '火之意志', tags: ['增益', '护盾', '回能'], fx: 'shield', target: 'ally_all',
          desc: '秉承二代目火影传下的火之意志鼓舞同伴：全体友方攻击力+25%、获得15%最大生命值的护盾（均持续2回合），并获得15点查克拉。',
          effects: [
            { type: 'buff', stat: 'atk', value: 0.25, turns: 2 },
            { type: 'shield', pct: 0.15, turns: 2 },
            { type: 'chakra', value: 15, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '二代目的教诲', tags: ['治疗', '增益'],
          desc: '攻击力+10%，防御+5%；友方阵亡时将同伴的意志传承下去，为全体友方恢复8%最大生命值，并使其攻击力+10%，持续2回合。',
          stats: { atk: 0.10, def: 0.05 },
          triggers: [{ on: 'on_ally_death', effects: [
            { type: 'heal', pct: 0.08, to: 'ally_all' },
            { type: 'buff', stat: 'atk', value: 0.1, turns: 2, to: 'ally_all' }
          ] }]
        }
      }
    },

    /* ============================ 宇智波带土（少年） ============================ */
    {
      id: 'obito_kid', name: '宇智波带土', form: '少年', en: 'Uchiha Obito', title: '未来的火影',
      faction: 'konoha', rarity: 'SR', role: 'tank', element: 'fire', tags: ['嘲讽', '护盾', '增益'],
      stats: { hp: 1.05, atk: 1.0, def: 0.95, spd: 110 },
      bio: '宇智波一族的少年忍者，与旗木卡卡西、野原琳同属波风水门班，梦想成为火影。神无毗桥之战中，他在营救琳的途中开启了写轮眼，又为保护卡卡西被巨石压住，临终前将左眼托付给了卡卡西。',
      quote: '我可是要成为火影的男人！',
      art: {
        type: 'human', skin: '#f3d9c4', hair: 'spiky', hairColor: '#1b1b1f',
        eyes: 'sharingan_2tomoe', outfit: 'jacket', outfitColor: '#1f3b73', accentColor: '#ff8f00',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'goggles', accessory2: 'kunai', aura: '#ff7043'
      },
      skills: {
        passive: {
          name: '写轮眼·开眼', tags: ['护盾', '增益'],
          desc: '在守护同伴的危急关头开启写轮眼：防御+8%，闪避率+8%；生命首次低于30%时，获得20%最大生命值的护盾（持续2回合），并使自身攻击力+25%，持续2回合。',
          stats: { def: 0.08, dodge: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'shield', pct: 0.2, turns: 2 },
            { type: 'buff', stat: 'atk', value: 0.25, turns: 2 }
          ] }]
        },
        s1: {
          name: '手里剑术', tags: ['消耗', '护盾'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投出手里剑攻击敌人，造成100%攻击力伤害，并获得10%攻击力的护盾。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'shield', mult: 0.1, to: 'self' }
          ]
        },
        s2: {
          name: '火遁·豪火球之术', tags: ['嘲讽', '持续'], fx: 'fire', target: 'single', cd: 3,
          desc: '鼓足勇气喷出巨大的火球，造成150%攻击力伤害，有50%概率使目标灼烧2回合（每回合30%攻击力），并嘲讽敌方2回合。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.5, value: 0.3 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '神无毗桥的誓言', tags: ['嘲讽', '护盾', '群攻'], fx: 'shield', target: 'all',
          desc: '在神无毗桥挺身而出守护同伴：对全体敌人造成100%攻击力伤害，嘲讽敌方2回合，并为全体友方提供15%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'taunt', turns: 2 },
            { type: 'shield', pct: 0.15, turns: 2, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '托付的左眼', tags: ['护盾', '回能'],
          desc: '生命值+10%，攻击力+10%；阵亡时将写轮眼托付给同伴，使全体友方获得15%最大生命值的护盾（持续2回合），并获得20点查克拉。',
          stats: { hp: 0.10, atk: 0.10 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'shield', pct: 0.15, turns: 2, to: 'ally_all' },
            { type: 'chakra', value: 20, to: 'ally_all' }
          ] }]
        }
      }
    },

    /* ============================ 野原琳 ============================ */
    {
      id: 'rin', name: '野原琳', form: '', en: 'Nohara Rin', title: '温柔的医忍',
      faction: 'konoha', rarity: 'R', role: 'heal', element: 'water', tags: ['治疗', '净化'],
      stats: { hp: 1.0, atk: 0.95, def: 1.05, spd: 108 },
      bio: '波风水门班的医疗忍者，与卡卡西、带土是队友。她被雾隐村强行封入三尾成为人柱力，为了不让尾兽在木叶暴走，主动撞上卡卡西的千鸟而死。',
      quote: '带土，我会一直看着你的。',
      art: {
        type: 'human', gender: 'f', skin: '#f6dcc6', hair: 'bob', hairColor: '#6b4a36',
        eyes: 'normal', eyeColor: '#5a3b2a', outfit: 'shirt', outfitColor: '#4e4a8e', accentColor: '#e8e8f0',
        headband: 'konoha', headbandSlash: false, headbandPos: 'forehead',
        marks: ['cheek_rects'], paintColor: '#7b2fa0', mask: 'none', hat: 'none', accessory: 'none', aura: '#69f0ae'
      },
      skills: {
        passive: {
          name: '医疗忍者', tags: ['治疗'],
          desc: '水门班的医疗担当：生命值+8%；每回合开始时为生命比例最低的友方恢复20%攻击力的生命值。',
          stats: { hp: 0.08 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', mult: 0.2, to: 'ally_lowest' }] }]
        },
        s1: {
          name: '苦无投掷', tags: ['消耗', '治疗'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投掷苦无牵制敌人，造成90%攻击力伤害，并为生命比例最低的友方恢复25%攻击力的生命值。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'heal', mult: 0.25, to: 'ally_lowest' }
          ]
        },
        s2: {
          name: '掌仙术', tags: ['治疗', '净化'], fx: 'heal', target: 'ally_lowest', cd: 3,
          desc: '以掌仙术治愈伤口：为生命比例最低的友方恢复160%攻击力的生命值，并清除其减益与异常状态。',
          effects: [
            { type: 'heal', mult: 1.6 },
            { type: 'cleanse', to: 'target' }
          ]
        },
        ult: {
          name: '医疗忍术', tags: ['治疗', '护盾'], fx: 'heal', target: 'ally_all',
          desc: '倾尽查克拉施展医疗忍术：为全体友方恢复120%攻击力的生命值，并提供8%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'heal', mult: 1.2 },
            { type: 'shield', pct: 0.08, turns: 2 }
          ]
        },
        awaken: {
          name: '三尾人柱力', tags: ['治疗', '增益'],
          desc: '被雾隐封入三尾成为人柱力：生命值+10%，防御+10%；生命首次低于30%时三尾的查克拉溢出，恢复25%最大生命值并免疫控制2回合。',
          stats: { hp: 0.10, def: 0.10 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.25 },
            { type: 'immune', turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 宇智波斑（战国） ============================ */
    {
      id: 'madara', name: '宇智波斑', form: '战国', en: 'Uchiha Madara', title: '忍界修罗',
      faction: 'legend', rarity: 'SSR', role: 'atk', element: 'fire', tags: ['群攻', '爆发', '反击'],
      stats: { hp: 1.0, atk: 1.12, def: 0.92, spd: 125 },
      bio: '战国时代宇智波一族的族长，与千手柱间齐名的最强忍者。弟弟泉奈死后他接过其双眼获得永恒万花筒写轮眼，与柱间结盟创立了木叶，却因理念不合叛离村子，在终末之谷与柱间展开决战。',
      quote: '柱间，让我们一决胜负吧！',
      art: {
        type: 'human', skin: '#f1d6bf', hair: 'wild_long', hairColor: '#141420',
        eyes: 'ms_eternal', outfit: 'armor', outfitColor: '#b3262a', accentColor: '#2a2a3a',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'gunbai', aura: '#3f51b5'
      },
      skills: {
        passive: {
          name: '永恒万花筒写轮眼', tags: ['增益', '回能'],
          desc: '继承弟弟双眼所得的永不失明之瞳：攻击力+8%，暴击率+12%；战斗开始时获得20点查克拉。',
          stats: { atk: 0.08, crit: 0.12 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '团扇·镰', tags: ['输出', '反击'], fx: 'blade', target: 'single', cd: 0,
          desc: '以军配团扇格挡、锁镰追斩，造成2段共110%攻击力伤害，并在1回合内受到攻击时以团扇反击，造成50%攻击力伤害。',
          effects: [
            { type: 'dmg', mult: 0.55, hits: 2 },
            { type: 'counter', mult: 0.5, turns: 1 }
          ]
        },
        s2: {
          name: '火遁·豪火灭却', tags: ['群攻', '持续'], fx: 'fire', target: 'all', cd: 3,
          desc: '喷出覆盖整片战场的烈焰，对全体敌人造成105%攻击力伤害，并有50%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.5, value: 0.3 }
          ]
        },
        ult: {
          name: '须佐能乎', tags: ['群攻', '爆发', '控制'], fx: 'susanoo', target: 'all',
          desc: '召唤须佐能乎挥刀横扫，对全体敌人造成3段共186%攻击力伤害，并有40%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.62, hits: 3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 }
          ]
        },
        awaken: {
          name: '火遁·豪火灭失', tags: ['持续', '群攻'],
          desc: '攻击力+12%；释放必杀技后紧接着喷出铺天盖地的豪火灭失，使全体敌人灼烧2回合（每回合35%攻击力）。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'burn', turns: 2, value: 0.35, to: 'enemy_all' }] }]
        }
      }
    },

    /* ============================ 宇智波斑（秽土转生） ============================ */
    {
      id: 'madara_edo', name: '宇智波斑', form: '秽土转生', en: 'Uchiha Madara', title: '轮回眼之主',
      faction: 'legend', rarity: 'UR', role: 'atk', element: 'fire', tags: ['群攻', '控制', '爆发'],
      stats: { hp: 1.02, atk: 1.1, def: 0.95, spd: 120 },
      bio: '被药师兜以秽土转生召唤至第四次忍界大战战场的宇智波斑。凭借移植柱间细胞开启的轮回眼，他以陨石、木遁与完成体须佐能乎独战五影，之后借带土之手发动的轮回天生之术复活。',
      quote: '让我好好陪你们跳一支舞吧。',
      art: {
        type: 'human', skin: '#d9cfc4', hair: 'wild_long', hairColor: '#141420',
        eyes: 'rinnegan', outfit: 'armor', outfitColor: '#7a1a20', accentColor: '#1c1c26',
        headband: 'none', marks: ['edo_cracks'], mask: 'none', hat: 'none', accessory: 'gunbai', aura: '#9c27b0'
      },
      skills: {
        passive: {
          name: '秽土转生', tags: ['回能', '治疗'],
          desc: '以秽土之躯重临战场，拥有无限的查克拉：受到的伤害-10%；每回合开始时获得10点查克拉；生命首次低于30%时尘土重组躯体，恢复30%最大生命值。',
          stats: { dr: 0.10 },
          triggers: [
            { on: 'turn_start', effects: [{ type: 'chakra', value: 10 }] },
            { on: 'low_hp', effects: [{ type: 'heal', pct: 0.3 }] }
          ]
        },
        s1: {
          name: '饿鬼道·封术吸印', tags: ['输出', '护盾'], fx: 'chakra', target: 'single', cd: 0,
          desc: '以轮回眼的饿鬼道吸收敌人的忍术并反击，造成120%攻击力伤害，并获得20%攻击力的护盾。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'shield', mult: 0.2, to: 'self' }
          ]
        },
        s2: {
          name: '木遁·木龙之术', tags: ['控制', '单体', '减益'], fx: 'wood', target: 'single', cd: 3,
          desc: '召唤能吸收查克拉的木龙缠绕目标，造成200%攻击力伤害，使其束缚1回合，并削减其25点查克拉。',
          effects: [
            { type: 'dmg', mult: 2.0 },
            { type: 'status', status: 'bind', turns: 1 },
            { type: 'drain', value: 25 }
          ]
        },
        ult: {
          name: '天碍震星', tags: ['群攻', '爆发', '控制'], fx: 'earth', target: 'all',
          desc: '从天外召唤巨大的陨石砸落，第二颗紧随而至：对全体敌人造成2段共220%攻击力伤害，并有60%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.1, hits: 2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.6 }
          ]
        },
        awaken: {
          name: '完成体须佐能乎', tags: ['护盾', '回能'],
          desc: '攻击力+12%，防御+8%；战斗开始时以完成体须佐能乎包裹全身，获得20%最大生命值的护盾，持续3回合；每击败一名敌人获得40点查克拉。',
          stats: { atk: 0.12, def: 0.08 },
          triggers: [
            { on: 'battle_start', effects: [{ type: 'shield', pct: 0.2, turns: 3 }] },
            { on: 'on_kill', effects: [{ type: 'chakra', value: 40 }] }
          ]
        }
      }
    },

    /* ============================ 宇智波斑（六道模式） ============================ */
    {
      id: 'madara_sixpaths', name: '宇智波斑', form: '六道模式', en: 'Uchiha Madara', title: '幻梦的救世主',
      faction: 'legend', rarity: 'UR', role: 'ctrl', element: 'yin', tags: ['控制', '群攻', '穿透'],
      stats: { hp: 1.0, atk: 1.15, def: 0.92, spd: 128 },
      bio: '复活后成为十尾人柱力的宇智波斑，获得了六道之力与能消除一切忍术的求道玉。他吸收神树开启轮回写轮眼发动无限月读，将整个忍界拖入梦境，却遭黑绝背叛，成为大筒木辉夜复活的媒介。',
      quote: '看清现实吧，这世界只有地狱。',
      art: {
        type: 'human', skin: '#efe7dd', hair: 'wild_long', hairColor: '#e8e8e8',
        eyes: 'rinnegan', outfit: 'six_paths', outfitColor: '#f2f2f2', accentColor: '#1c1c1c',
        headband: 'none', marks: ['third_eye'], mask: 'none', hat: 'horns', accessory: 'truth_orbs', aura: '#e0e0e0'
      },
      skills: {
        passive: {
          name: '六道之力', tags: ['增益'],
          desc: '十尾人柱力的六道之力：生命值+10%，受到的伤害-10%；战斗开始时免疫控制2回合。',
          stats: { hp: 0.10, dr: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'immune', turns: 2 }] }]
        },
        s1: {
          name: '求道玉', tags: ['输出', '穿透'], fx: 'truth', target: 'single', cd: 0,
          desc: '操纵能消除一切忍术的求道玉轰击敌人，造成2段共120%攻击力伤害（无视30%防御）。',
          effects: [{ type: 'dmg', mult: 0.6, hits: 2, pierce: 0.3 }]
        },
        s2: {
          name: '轮墓·边狱', tags: ['群攻', '穿透', '控制'], fx: 'shadow', target: 'random', count: 4, cd: 3,
          desc: '从轮墓世界放出常人无法看见的四道影子，攻击随机4名敌人，各造成3段共90%攻击力伤害（无视50%防御），并有30%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.3, hits: 3, pierce: 0.5 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        ult: {
          name: '无限月读', tags: ['控制', '群攻', '减益'], fx: 'eye', target: 'all',
          desc: '以轮回写轮眼映照月亮发动无限月读：对全体敌人造成160%攻击力伤害，使其陷入睡眠2回合（受到伤害时苏醒），并削减其30点查克拉。',
          effects: [
            { type: 'dmg', mult: 1.6 },
            { type: 'status', status: 'sleep', turns: 2 },
            { type: 'drain', value: 30 }
          ]
        },
        awaken: {
          name: '神·树界降诞', tags: ['控制', '增益'],
          desc: '攻击力+12%，暴击率+8%；释放必杀技后，神树的根须缠绕梦中的敌人，对每名敌人有40%概率使其束缚1回合。',
          stats: { atk: 0.12, crit: 0.08 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'status', status: 'bind', turns: 1, chance: 0.4, to: 'enemy_all' }] }]
        }
      }
    },

    /* ============================ 宇智波泉奈 ============================ */
    {
      id: 'izuna', name: '宇智波泉奈', form: '', en: 'Uchiha Izuna', title: '斑之胞弟',
      faction: 'legend', rarity: 'SR', role: 'atk', element: 'fire', tags: ['输出', '爆发', '闪避'],
      stats: { hp: 0.92, atk: 1.15, def: 0.92, spd: 136 },
      bio: '宇智波斑的弟弟，与哥哥一样开启了万花筒写轮眼，是战国时代宇智波一族的顶尖战力。他在与千手扉间的交战中身受致命伤，临终前将双眼托付给斑，使其获得了永恒万花筒写轮眼。',
      quote: '哥哥，用我的眼睛守护一族吧。',
      art: {
        type: 'human', skin: '#f1d6bf', hair: 'low_ponytail', hairColor: '#17181f',
        eyes: 'ms_izuna', outfit: 'armor', outfitColor: '#3a4a6e', accentColor: '#1a1a24',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'sword', aura: '#9575cd'
      },
      skills: {
        passive: {
          name: '万花筒写轮眼', tags: ['增益', '闪避'],
          desc: '与兄长并称的宇智波双璧之瞳：暴击率+12%，闪避率+10%。',
          stats: { crit: 0.12, dodge: 0.10 }
        },
        s1: {
          name: '忍刀·连斩', tags: ['输出'], fx: 'blade', target: 'single', cd: 0,
          desc: '以迅捷无比的刀法连续斩击，造成2段共112%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.56, hits: 2 }]
        },
        s2: {
          name: '火遁·凤仙火之术', tags: ['输出', '持续'], fx: 'fire', target: 'single', cd: 3,
          desc: '连续喷出数枚凤仙火，对目标造成4段共180%攻击力伤害，并有50%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.45, hits: 4 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.5, value: 0.3 }
          ]
        },
        ult: {
          name: '万花筒写轮眼·幻术', tags: ['爆发', '控制', '单体'], fx: 'eye', target: 'single',
          desc: '以万花筒写轮眼的幻术困住目标后一刀斩落，造成300%攻击力伤害，并有70%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 3.0 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.7 }
          ]
        },
        awaken: {
          name: '托付之眼', tags: ['增益', '回能'],
          desc: '攻击力+12%；阵亡时将双眼的瞳力托付给同伴，使全体友方暴击率+20%（持续3回合），并获得20点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'buff', stat: 'crit', value: 0.2, turns: 3, to: 'ally_all' },
            { type: 'chakra', value: 20, to: 'ally_all' }
          ] }]
        }
      }
    },

    /* ============================ 大蛇丸 ============================ */
    {
      id: 'orochimaru', name: '大蛇丸', form: '传说三忍', en: 'Orochimaru', title: '音隐之主',
      faction: 'oto', rarity: 'SSR', role: 'ctrl', element: 'wind', tags: ['控制', '持续', '复活'],
      stats: { hp: 1.05, atk: 1.08, def: 0.95, spd: 118 },
      bio: '木叶“传说中的三忍”之一，师从三代目火影猿飞日斩，为探究一切忍术的真理而进行禁忌的人体实验，叛逃后创立了音隐村。他以不尸转生之术不断更换躯体以追求永生，并发动“木叶崩溃计划”，令三代目火影战死。',
      quote: '我想知道这世上所有的忍术。',
      art: {
        type: 'human', skin: '#f2efe8', hair: 'very_long', hairColor: '#151518',
        eyes: 'snake', outfit: 'robe', outfitColor: '#dcd8cc', accentColor: SOUND_ROPE,
        headband: 'none', marks: ['purple_eyeliner'], mask: 'none', hat: 'none', accessory: 'sword', aura: '#7e57c2'
      },
      skills: {
        passive: {
          name: '不尸转生', tags: ['复活', '闪避'],
          desc: '以不尸转生之术蜕去旧躯：闪避率+6%；首次阵亡时立即以30%最大生命值复活（每场战斗限一次）。',
          stats: { dodge: 0.06 },
          triggers: [{ on: 'on_death', effects: [{ type: 'revive', pct: 0.3, to: 'self' }] }]
        },
        s1: {
          name: '草薙剑', tags: ['输出', '穿透'], fx: 'blade', target: 'single', cd: 0,
          desc: '从口中吐出能斩断一切的草薙剑突刺敌人，造成115%攻击力伤害（无视20%防御）。',
          effects: [{ type: 'dmg', mult: 1.15, pierce: 0.2 }]
        },
        s2: {
          name: '潜影多蛇手', tags: ['控制', '群攻'], fx: 'snake', target: 'all', cd: 3,
          desc: '自袖中放出无数毒蛇缠绕敌阵，对全体敌人造成90%攻击力伤害，并有40%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '八岐之术', tags: ['群攻', '持续', '爆发'], fx: 'snake', target: 'all',
          desc: '化身八首巨蛇八岐大蛇撕咬敌阵，对全体敌人造成8段共200%攻击力伤害，并使其中毒2回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.25, hits: 8 },
            { type: 'status', status: 'poison', turns: 2, value: 0.35 }
          ]
        },
        awaken: {
          name: '通灵·万蛇', tags: ['召唤', '持续'],
          desc: '攻击力+12%；每回合开始时有30%概率令巨蛇万蛇袭击随机一名敌人，造成80%攻击力伤害并使其中毒2回合（每回合30%攻击力）。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'turn_start', chance: 0.3, effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'status', status: 'poison', turns: 2, value: 0.3 }
          ] }]
        }
      }
    },

    /* ============================ 药师兜 ============================ */
    {
      id: 'kabuto', name: '药师兜', form: '', en: 'Yakushi Kabuto', title: '大蛇丸的心腹',
      faction: 'oto', rarity: 'SR', role: 'heal', element: 'yang', tags: ['治疗', '减益', '控制'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 115 },
      bio: '大蛇丸的心腹，身兼间谍与医疗忍者，曾潜伏在木叶参加中忍考试以收集情报。他擅长以查克拉手术刀切断敌人的肌肉与经络，并能用医疗忍术在战斗中迅速治愈自身。',
      quote: '你觉得，我究竟是谁呢？',
      art: {
        type: 'human', skin: '#f3dcc8', hair: 'low_ponytail', hairColor: '#c9ccd4',
        eyes: 'normal', eyeColor: '#2b2b3a', outfit: 'highcollar', outfitColor: '#4b3a66', accentColor: '#e8e8e8',
        headband: 'oto', headbandSlash: false, headbandPos: 'forehead',
        marks: ['glasses'], mask: 'none', hat: 'none', accessory: 'none', aura: '#69f0ae'
      },
      skills: {
        passive: {
          name: '医疗忍术', tags: ['治疗'],
          desc: '战斗中以医疗忍术迅速治愈自身：生命值+8%；生命首次低于30%时，立即恢复30%最大生命值。',
          stats: { hp: 0.08 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'heal', pct: 0.3 }] }]
        },
        s1: {
          name: '查克拉手术刀', tags: ['消耗', '减益'], fx: 'heal', target: 'single', cd: 0,
          desc: '以查克拉凝成的手术刀切断敌人的肌肉，造成100%攻击力伤害，并降低其攻击力15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'atk', value: 0.15, turns: 2 }
          ]
        },
        s2: {
          name: '掌仙术', tags: ['治疗', '护盾'], fx: 'heal', target: 'ally_lowest', cd: 3,
          desc: '以掌仙术迅速治愈伤口：为生命比例最低的友方恢复160%攻击力的生命值，并提供30%攻击力的护盾，持续2回合。',
          effects: [
            { type: 'heal', mult: 1.6 },
            { type: 'shield', mult: 0.3, turns: 2 }
          ]
        },
        ult: {
          name: '涅槃精舍之术', tags: ['控制', '治疗', '群攻'], fx: 'genjutsu', target: 'all',
          desc: '施展令羽毛漫天飘落的大范围幻术：有80%概率使全体敌人陷入睡眠2回合（受到伤害时苏醒），削减其20点查克拉，并为全体友方恢复60%攻击力的生命值。',
          effects: [
            { type: 'status', status: 'sleep', turns: 2, chance: 0.8 },
            { type: 'drain', value: 20 },
            { type: 'heal', mult: 0.6, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '大蛇丸的细胞', tags: ['治疗', '增益'],
          desc: '移植大蛇丸的细胞获得强大的再生能力：攻击力+10%，生命值+8%；受到攻击时有20%概率恢复6%最大生命值。',
          stats: { atk: 0.10, hp: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'heal', pct: 0.06 }] }]
        }
      }
    },

    /* ============================ 药师兜（仙人模式） ============================ */
    {
      id: 'kabuto_sage', name: '药师兜', form: '仙人模式', en: 'Yakushi Kabuto', title: '龙地洞仙人',
      faction: 'oto', rarity: 'SSR', role: 'ctrl', element: 'earth', tags: ['控制', '召唤', '复活'],
      stats: { hp: 1.02, atk: 1.08, def: 0.98, spd: 118 },
      bio: '移植大蛇丸细胞后在龙地洞修得仙术的药师兜，以秽土转生召唤历代强者，成为第四次忍界大战的幕后推手之一。他最终被宇智波鼬的伊邪那美困住，认清自我后解除了秽土转生。',
      quote: '我已经超越了大蛇丸大人。',
      art: {
        type: 'human', skin: '#e8e2d8', hair: 'hood', hairColor: '#bfc4cc',
        eyes: 'snake', outfit: 'cloak', outfitColor: '#4a3f6b', accentColor: '#d9d4c8',
        headband: 'none', marks: ['purple_eyeliner'], mask: 'none', hat: 'horns', hornColor: '#e9e4d6',
        accessory: 'none', aura: '#ffb300'
      },
      skills: {
        passive: {
          name: '龙地洞仙术', tags: ['增益', '治疗'],
          desc: '以龙地洞的仙术吸收自然能量，并拥有白蛇般的再生力：攻击力+10%，防御+8%；每回合开始时恢复3%最大生命值。',
          stats: { atk: 0.10, def: 0.08 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.03 }] }]
        },
        s1: {
          name: '仙法·无机转生', tags: ['输出', '控制'], fx: 'earth', target: 'single', cd: 0,
          desc: '以仙术赋予岩石生命，令石笋自地面刺出，造成115%攻击力伤害，并有25%概率使目标束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.15 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.25 }
          ]
        },
        s2: {
          name: '仙法·白激之术', tags: ['控制', '群攻'], fx: 'sound', target: 'all', cd: 3,
          desc: '自体内放出白龙，发出令人麻痹的高频音波与气浪，对全体敌人造成90%攻击力伤害，并有30%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        ult: {
          name: '秽土转生', tags: ['复活', '召唤', '群攻'], fx: 'summon', target: 'all',
          desc: '以禁术秽土转生召唤历代强者：复活一名阵亡友方（40%最大生命值，每场战斗限一次），并令亡者大军对全体敌人造成2段共190%攻击力伤害。',
          effects: [
            { type: 'revive', pct: 0.4 },
            { type: 'dmg', mult: 0.95, hits: 2 }
          ]
        },
        awaken: {
          name: '白蛇之躯', tags: ['治疗', '净化'],
          desc: '攻击力+12%，闪避率+8%；生命首次低于30%时如白蛇蜕皮般再生，恢复30%最大生命值并清除自身的减益与异常状态。',
          stats: { atk: 0.12, dodge: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.3 },
            { type: 'cleanse' }
          ] }]
        }
      }
    },

    /* ============================ 辉夜君麻吕 ============================ */
    {
      id: 'kimimaro', name: '辉夜君麻吕', form: '', en: 'Kaguya Kimimaro', title: '辉夜之末裔',
      faction: 'oto', rarity: 'SR', role: 'atk', element: 'none', tags: ['输出', '持续', '反击'],
      stats: { hp: 0.95, atk: 1.12, def: 1.0, spd: 120 },
      bio: '辉夜一族最后的幸存者，拥有能自由操控全身骨骼的血继限界“尸骨脉”，是大蛇丸最忠诚的部下。他身患绝症仍为接回佐助而战，在与我爱罗、李的激战中，于即将刺中我爱罗的瞬间病发身亡。',
      quote: '我只为大蛇丸大人而活。',
      art: {
        type: 'human', skin: '#f2e6dc', hair: 'long_straight', hairColor: '#ececec',
        eyes: 'normal', eyeColor: '#3f8f5a', outfit: 'robe', outfitColor: '#e6e1d6', accentColor: SOUND_ROPE,
        headband: 'none', marks: ['forehead_dots', 'curse_mark'], mask: 'none', hat: 'none', accessory: 'none', aura: '#f5f5f5'
      },
      skills: {
        passive: {
          name: '尸骨脉', tags: ['反击', '增益'],
          desc: '操控全身骨骼的血继限界，骨骼坚硬胜钢：防御+10%；受到攻击时有30%概率从体表刺出骨刺反击，造成50%攻击力伤害。',
          stats: { def: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'dmg', mult: 0.5, to: 'attacker' }] }]
        },
        s1: {
          name: '十指穿弹', tags: ['输出', '消耗'], fx: 'bone', target: 'single', cd: 0,
          desc: '从十根指尖射出骨弹，造成5段共110%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.22, hits: 5 }]
        },
        s2: {
          name: '椿之舞', tags: ['输出', '持续'], fx: 'bone', target: 'single', cd: 3,
          desc: '抽出臂骨化作骨剑如山茶花般连续突刺，造成4段共180%攻击力伤害，并使目标流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.45, hits: 4 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.3 }
          ]
        },
        ult: {
          name: '早蕨之舞', tags: ['群攻', '控制', '爆发'], fx: 'bone', target: 'all',
          desc: '令大地化为骨之森林，无数骨刺破土而出：对全体敌人造成2段共170%攻击力伤害，并有50%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.85, hits: 2 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '咒印·第二状态', tags: ['增益', '爆发'],
          desc: '攻击力+12%，生命值+5%；生命首次低于30%时燃尽残存的生命力，攻击力+30%（持续3回合），并免疫控制2回合。',
          stats: { atk: 0.12, hp: 0.05 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'buff', stat: 'atk', value: 0.3, turns: 3 },
            { type: 'immune', turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 多由也 ============================ */
    {
      id: 'tayuya', name: '多由也', form: '', en: 'Tayuya', title: '北门之多由也',
      faction: 'oto', rarity: 'R', role: 'ctrl', element: 'yin', tags: ['控制', '召唤', '群攻'],
      stats: { hp: 0.95, atk: 1.05, def: 0.95, spd: 112 },
      bio: '大蛇丸麾下“音忍四人众”之一，以魔笛的音色操控通灵出的三只怒鬼，并能施展听觉幻术。在佐助夺还战中与奈良鹿丸交手，最终败给了前来支援的砂隐手鞠。',
      quote: '吵死了，你们这些垃圾！',
      art: {
        type: 'human', gender: 'f', skin: '#f6dcc6', hair: 'long_straight', hairColor: '#c2185b',
        eyes: 'normal', eyeColor: '#6b4a36', outfit: 'robe', outfitColor: SOUND_ROBE, accentColor: SOUND_ROPE,
        headband: 'oto', headbandSlash: false, headbandPos: 'forehead',
        marks: ['curse_mark'], mask: 'none', hat: 'bandana_cap', capColor: '#1e1e24', accessory: 'flute', aura: '#ab47bc'
      },
      skills: {
        passive: {
          name: '咒印', tags: ['增益'],
          desc: '大蛇丸赐予的咒印：攻击力+6%，速度+6%；生命首次低于30%时咒印扩散，攻击力+25%，持续2回合。',
          stats: { atk: 0.06, spd: 0.06 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'buff', stat: 'atk', value: 0.25, turns: 2 }] }]
        },
        s1: {
          name: '魔笛', tags: ['消耗', '减益'], fx: 'sound', target: 'single', cd: 0,
          desc: '吹奏魔笛以刺耳的音波扰乱敌人，造成100%攻击力伤害，并降低其速度15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'spd', value: 0.15, turns: 2 }
          ]
        },
        s2: {
          name: '通灵·怒鬼', tags: ['召唤', '群攻'], fx: 'summon', target: 'random', count: 3, cd: 3,
          desc: '通灵出三只怒鬼随笛声扑向敌阵，攻击随机3名敌人，各造成2段共80%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.4, hits: 2 }]
        },
        ult: {
          name: '魔笛·梦幻音锁', tags: ['控制', '群攻'], fx: 'genjutsu', target: 'all',
          desc: '以魔笛奏出幻术之音锁住敌人的五感：对全体敌人造成120%攻击力伤害，并有60%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.6 }
          ]
        },
        awaken: {
          name: '咒印·第二状态', tags: ['减益', '召唤'],
          desc: '攻击力+12%；释放必杀技后，怒鬼口中放出啃食查克拉的怨灵，削减全体敌人15点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'drain', value: 15, to: 'enemy_all' }] }]
        }
      }
    },

    /* ============================ 左近&右近 ============================ */
    {
      id: 'sakon', name: '左近&右近', form: '', en: 'Sakon & Ukon', title: '西门之左近',
      faction: 'oto', rarity: 'SR', role: 'atk', element: 'none', tags: ['输出', '持续', '穿透'],
      stats: { hp: 1.0, atk: 1.1, def: 0.92, spd: 118 },
      bio: '“音忍四人众”的首领，与双胞胎兄弟右近共用一个身体，能以血继限界分离或融合彼此的身体。在佐助夺还战中与犬冢牙、赤丸交手，最终被赶来的勘九郎以傀儡“黑蚁”困住击败。',
      quote: '我们兄弟两人可是一体的。',
      art: {
        type: 'human', skin: '#efe0d0', hair: 'long_bang', hairColor: '#9aa0aa',
        eyes: 'normal', eyeColor: '#4a4a52', outfit: 'robe', outfitColor: SOUND_ROBE, accentColor: SOUND_ROPE,
        headband: 'oto', headbandSlash: false, headbandPos: 'forehead',
        marks: ['curse_mark'], mask: 'none', hat: 'none', accessory: 'none', aura: '#8a63d2'
      },
      skills: {
        passive: {
          name: '双魔之攻', tags: ['输出', '增益', '回能'],
          desc: '左近与右近同时出手，并由一人替另一人分担伤害：暴击率+8%，伤害减免+10%；战斗开始时获得20点查克拉；攻击后有30%概率由右近追加一击，造成45%攻击力伤害。',
          stats: { crit: 0.08, dr: 0.1 },
          triggers: [
            { on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] },
            { on: 'on_attack', chance: 0.3, effects: [{ type: 'dmg', mult: 0.45 }] }
          ]
        },
        s1: {
          name: '多连拳', tags: ['输出'], fx: 'fist', target: 'single', cd: 0,
          desc: '左近与右近同时挥拳，造成2段共110%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.55, hits: 2 }]
        },
        s2: {
          name: '多连脚', tags: ['输出', '减益'], fx: 'fist', target: 'random', count: 2, cd: 3,
          desc: '兄弟二人分头连环踢击，对随机2名敌人各造成3段共165%攻击力伤害，并降低其防御15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.55, hits: 3 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '寄生鬼坏之术', tags: ['爆发', '持续', '控制'], fx: 'poison', target: 'single',
          desc: '右近钻入敌人体内，从细胞层面破坏其身体：造成300%攻击力伤害（无视50%防御），使其流血3回合（每回合40%攻击力），并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 3.0, pierce: 0.5 },
            { type: 'status', status: 'bleed', turns: 3, value: 0.4 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '咒印·第二状态', tags: ['护盾', '增益'],
          desc: '攻击力+12%；生命首次低于30%时右近分离出身体替兄长承受攻击，获得25%最大生命值的护盾，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'shield', pct: 0.25, turns: 2 }] }]
        }
      }
    },

    /* ============================ 次郎坊 ============================ */
    {
      id: 'jirobo', name: '次郎坊', form: '', en: 'Jirobo', title: '南门之次郎坊',
      faction: 'oto', rarity: 'R', role: 'tank', element: 'earth', tags: ['嘲讽', '吸血', '消耗'],
      stats: { hp: 1.2, atk: 0.9, def: 0.95, spd: 85 },
      bio: '“音忍四人众”之一，体格魁梧、力大无穷，擅长土遁与吸取他人查克拉的忍术。在佐助夺还战中以土遁困住鸣人一行，最终败给了服下红色药丸、展开查克拉蝶翼的秋道丁次。',
      quote: '你们的查克拉，真是美味啊。',
      art: {
        type: 'human', skin: '#e8c39e', hair: 'buzz', hairColor: '#e07a2e',
        eyes: 'normal', eyeColor: '#3b2a20', outfit: 'robe', outfitColor: SOUND_ROBE, accentColor: SOUND_ROPE,
        headband: 'oto', headbandSlash: false, headbandPos: 'forehead',
        marks: ['curse_mark'], mask: 'none', hat: 'none', accessory: 'none', aura: '#b08a5a'
      },
      skills: {
        passive: {
          name: '咒印', tags: ['消耗', '增益'],
          desc: '咒印强化的强韧体魄：生命值+10%，防御+6%；受到攻击时有30%概率削减攻击者10点查克拉。',
          stats: { hp: 0.10, def: 0.06 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'drain', value: 10, to: 'attacker' }] }]
        },
        s1: {
          name: '土遁·土陆返', tags: ['消耗', '护盾'], fx: 'earth', target: 'single', cd: 0,
          desc: '掀起大块地面砸向敌人，造成95%攻击力伤害，并以岩壁护身，获得20%攻击力的护盾。',
          effects: [
            { type: 'dmg', mult: 0.95 },
            { type: 'shield', mult: 0.2, to: 'self' }
          ]
        },
        s2: {
          name: '罗汉拳', tags: ['嘲讽', '控制'], fx: 'fist', target: 'single', cd: 3,
          desc: '以刚猛的罗汉拳重击目标，造成140%攻击力伤害，有35%概率使其眩晕1回合，并嘲讽敌方2回合。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.35 },
            { type: 'taunt', turns: 2 }
          ]
        },
        ult: {
          name: '土遁·土牢堂无', tags: ['吸血', '消耗', '群攻'], fx: 'earth', target: 'all',
          desc: '以岩石穹顶困住敌人并吸取其查克拉：对全体敌人造成110%攻击力伤害，削减其25点查克拉，并恢复相当于本次伤害50%的生命值。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'drain', value: 25 },
            { type: 'lifesteal', value: 0.5 }
          ]
        },
        awaken: {
          name: '咒印·第二状态', tags: ['嘲讽', '护盾'],
          desc: '攻击力+10%，防御+10%；战斗开始时嘲讽敌方2回合，并获得15%最大生命值的护盾，持续2回合。',
          stats: { atk: 0.10, def: 0.10 },
          triggers: [{ on: 'battle_start', effects: [
            { type: 'taunt', turns: 2 },
            { type: 'shield', pct: 0.15, turns: 2 }
          ] }]
        }
      }
    },

    /* ============================ 鬼童丸 ============================ */
    {
      id: 'kidomaru', name: '鬼童丸', form: '', en: 'Kidomaru', title: '东门之鬼童丸',
      faction: 'oto', rarity: 'R', role: 'atk', element: 'none', tags: ['输出', '控制', '穿透'],
      stats: { hp: 0.92, atk: 1.12, def: 0.95, spd: 115 },
      bio: '“音忍四人众”之一，长有六条手臂，能从口中吐出坚韧的蜘蛛丝与金属般的蜘蛛粘金，总把战斗当作游戏。在佐助夺还战中与日向宁次激战，最终被身负重伤的宁次以柔拳击败。',
      quote: '这场游戏，可真有意思啊。',
      art: {
        type: 'human', skin: '#d9b08a', hair: 'high_ponytail', hairColor: '#3a2a22',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'robe', outfitColor: SOUND_ROBE, accentColor: SOUND_ROPE,
        headband: 'oto', headbandSlash: false, headbandPos: 'forehead',
        marks: ['curse_mark'], mask: 'none', hat: 'none', accessory: 'bow', aura: '#ffd54f'
      },
      skills: {
        passive: {
          name: '蜘蛛粘金', tags: ['增益'],
          desc: '以金属般坚硬的蜘蛛粘金制成武器：攻击力+6%，暴击率+10%。',
          stats: { atk: 0.06, crit: 0.10 }
        },
        s1: {
          name: '蜘蛛缚', tags: ['消耗', '控制'], fx: 'web', target: 'single', cd: 0,
          desc: '吐出黏稠的蜘蛛丝缠住敌人，造成95%攻击力伤害，并有25%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.95 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.25 }
          ]
        },
        s2: {
          name: '蜘蛛巢网', tags: ['群攻', '减益'], fx: 'web', target: 'all', cd: 3,
          desc: '在战场上张开巨大的蜘蛛网，对全体敌人造成75%攻击力伤害，并降低其速度20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.75 },
            { type: 'debuff', stat: 'spd', value: 0.2, turns: 2 }
          ]
        },
        ult: {
          name: '蜘蛛战弓·凄裂', tags: ['爆发', '穿透', '单体'], fx: 'web', target: 'back',
          desc: '以蜘蛛粘金制成巨弓，射出带着丝线的利箭狙击最后排的敌人，造成280%攻击力伤害（无视40%防御）。',
          effects: [{ type: 'dmg', mult: 2.8, pierce: 0.4 }]
        },
        awaken: {
          name: '咒印·第二状态', tags: ['增益', '回能'],
          desc: '攻击力+10%，暴击率+8%；开启第三只眼精准锁定猎物，每击败一名敌人获得50点查克拉。',
          stats: { atk: 0.10, crit: 0.08 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'chakra', value: 50 }] }]
        }
      }
    },

    /* ============================ 砧多斯 ============================ */
    {
      id: 'dosu', name: '砧多斯', form: '', en: 'Kinuta Dosu', title: '绷带音忍',
      faction: 'oto', rarity: 'R', role: 'ctrl', element: 'none', tags: ['控制', '减益'],
      stats: { hp: 1.0, atk: 1.02, def: 0.98, spd: 104 },
      bio: '音隐村的下忍，全身缠满绷带，以装在右臂上的“响鸣穿”放大声波，扰乱敌人的平衡感。中忍考试中他察觉到大蛇丸的真正意图，企图刺杀佐助，却死于我爱罗之手。',
      quote: '声音是躲不开的。',
      art: {
        type: 'human', skin: '#e8d2bc', hair: 'shaggy', hairColor: '#6b6b70',
        eyes: 'normal', eyeColor: '#3a3a3a', outfit: 'cloak', outfitColor: '#8a8578', accentColor: '#e6dcc6',
        headband: 'oto', headbandSlash: false, headbandPos: 'forehead',
        marks: ['bandage_face'], mask: 'none', hat: 'none', accessory: 'none', aura: '#7986cb'
      },
      skills: {
        passive: {
          name: '音波共振', tags: ['控制', '增益'],
          desc: '声波直击敌人的半规管：攻击力+5%；攻击命中后有15%概率使目标眩晕1回合。',
          stats: { atk: 0.05 },
          triggers: [{ on: 'on_attack', chance: 0.15, effects: [{ type: 'status', status: 'stun', turns: 1 }] }]
        },
        s1: {
          name: '响鸣穿', tags: ['消耗', '减益'], fx: 'sound', target: 'single', cd: 0,
          desc: '以右臂的响鸣穿放大声波袭击敌人，造成100%攻击力伤害，并降低其闪避率10%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'dodge', value: 0.10, turns: 2 }
          ]
        },
        s2: {
          name: '响鸣穿·超音波', tags: ['控制', '单体'], fx: 'sound', target: 'single', cd: 3,
          desc: '将声波集中于一点震荡目标的内耳，造成140%攻击力伤害，并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        ult: {
          name: '响鸣穿·共鸣', tags: ['群攻', '控制', '减益'], fx: 'sound', target: 'all',
          desc: '将响鸣穿的音波扩散至整片战场，对全体敌人造成120%攻击力伤害，降低其速度20%（持续2回合），并有35%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'debuff', stat: 'spd', value: 0.2, turns: 2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.35 }
          ]
        },
        awaken: {
          name: '响鸣穿·回响', tags: ['减益', '增益'],
          desc: '攻击力+10%；受到攻击时有25%概率以回响的声波干扰攻击者，使其攻击力降低15%，持续2回合。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'debuff', stat: 'atk', value: 0.15, turns: 2, to: 'attacker' }] }]
        }
      }
    },

    /* ============================ 扎库 ============================ */
    {
      id: 'zaku', name: '扎库', form: '', en: 'Abumi Zaku', title: '傲慢的音忍',
      faction: 'oto', rarity: 'R', role: 'atk', element: 'wind', tags: ['输出', '群攻'],
      stats: { hp: 0.92, atk: 1.12, def: 0.95, spd: 116 },
      bio: '音隐村的下忍，双手掌心植入了能放出超音波与高压空气的气孔，以“斩空波”攻击敌人。在死亡森林中被佐助折断双臂，中忍考试预选赛败给油女志乃后，被大蛇丸当作秽土转生的祭品。',
      quote: '看我把你们全都轰飞！',
      art: {
        type: 'human', skin: '#efd2b8', hair: 'spiky_up', hairColor: '#1b1b1f',
        eyes: 'normal', eyeColor: '#3a2a20', outfit: 'shirt', outfitColor: '#3a3f46', accentColor: '#7a8a60',
        headband: 'oto', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#5fd6a6'
      },
      skills: {
        passive: {
          name: '气压孔', tags: ['增益'],
          desc: '掌心植入的气孔能放出高压空气：攻击力+8%，暴击率+6%。',
          stats: { atk: 0.08, crit: 0.06 }
        },
        s1: {
          name: '斩空波', tags: ['输出'], fx: 'wind', target: 'single', cd: 0,
          desc: '从掌心放出超音波与高压空气，造成110%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.1 }]
        },
        s2: {
          name: '斩空波·连射', tags: ['群攻', '消耗'], fx: 'wind', target: 'random', count: 3, cd: 3,
          desc: '双掌交替连射斩空波，攻击随机3名敌人，各造成90%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.9 }]
        },
        ult: {
          name: '斩空极波', tags: ['群攻', '减益', '爆发'], fx: 'wind', target: 'all',
          desc: '双掌全力放出极限的斩空波，对全体敌人造成140%攻击力伤害，并降低其防御15%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.4 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2 }
          ]
        },
        awaken: {
          name: '音隐的精英', tags: ['增益', '回能'],
          desc: '攻击力+12%；每击败一名敌人获得30点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'chakra', value: 30 }] }]
        }
      }
    },

    /* ============================ 金 ============================ */
    {
      id: 'kin', name: '金', form: '', en: 'Tsuchi Kin', title: '铃音幻术师',
      faction: 'oto', rarity: 'R', role: 'ctrl', element: 'yin', tags: ['控制', '封印', '减益'],
      stats: { hp: 0.95, atk: 1.02, def: 0.98, spd: 114 },
      bio: '音隐村的下忍，擅长以系着铃铛的千本与丝线施展幻术，用铃声扰乱敌人的感知。中忍考试预选赛中败给了奈良鹿丸，之后被大蛇丸当作秽土转生的祭品。',
      quote: '听见铃声了吗？',
      art: {
        type: 'human', gender: 'f', skin: '#f5dcc8', hair: 'very_long', hairColor: '#1a1a22',
        eyes: 'normal', eyeColor: '#4a3a2a', outfit: 'shirt', outfitColor: '#4f6b4a', accentColor: '#c9b28a',
        headband: 'oto', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#ffd54f'
      },
      skills: {
        passive: {
          name: '铃声', tags: ['封印', '闪避'],
          desc: '铃铛的声响扰乱敌人结印：闪避率+8%；攻击命中后有20%概率封印目标1回合（只能使用技能1）。',
          stats: { dodge: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'status', status: 'silence', turns: 1 }] }]
        },
        s1: {
          name: '铃铛千本', tags: ['消耗'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '掷出系着铃铛的千本，造成2段共100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.5, hits: 2 }]
        },
        s2: {
          name: '幻术·铃音', tags: ['控制', '单体'], fx: 'genjutsu', target: 'single', cd: 3,
          desc: '以摇曳的铃声施展幻术，造成110%攻击力伤害，并有70%概率使目标陷入睡眠2回合（受到伤害时苏醒）。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'sleep', turns: 2, chance: 0.7 }
          ]
        },
        ult: {
          name: '幻术·铃音分身', tags: ['封印', '群攻'], fx: 'genjutsu', target: 'all',
          desc: '铃声中浮现出无数幻影，对全体敌人造成120%攻击力伤害，并有60%概率封印其2回合（只能使用技能1）。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'silence', turns: 2, chance: 0.6 }
          ]
        },
        awaken: {
          name: '无声之铃', tags: ['输出'],
          desc: '攻击力+10%；暗藏不系铃铛的千本，攻击命中后有25%概率追加一击，造成40%攻击力伤害。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_attack', chance: 0.25, effects: [{ type: 'dmg', mult: 0.4 }] }]
        }
      }
    },

    /* ============================ 香燐 ============================ */
    {
      id: 'karin', name: '香燐', form: '', en: 'Karin', title: '感知型忍者',
      faction: 'taka', rarity: 'SR', role: 'heal', element: 'yang', tags: ['治疗', '回能', '控制'],
      stats: { hp: 1.05, atk: 0.92, def: 1.0, spd: 108 },
      bio: '拥有漩涡一族血统的感知型忍者，曾负责看守大蛇丸的据点，后加入佐助的鹰小队。她能以“神乐心眼”感知远处的查克拉，让同伴咬伤自己便能为其恢复体力与查克拉。',
      quote: '才、才不是为了佐助呢！',
      art: {
        type: 'human', gender: 'f', skin: '#f6dcc6', hair: 'long_straight', hairColor: '#d9283a',
        eyes: 'normal', eyeColor: '#c62828', outfit: 'highcollar', outfitColor: '#a58fc7', accentColor: '#2a2a3a',
        headband: 'none', marks: ['glasses'], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff5252'
      },
      skills: {
        passive: {
          name: '神乐心眼', tags: ['增益', '闪避'],
          desc: '以神乐心眼感知敌人的查克拉动向：闪避率+8%；战斗开始时使全体友方暴击率+10%，持续3回合。',
          stats: { dodge: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'crit', value: 0.10, turns: 3, to: 'ally_all' }] }]
        },
        s1: {
          name: '重拳制裁', tags: ['消耗'], fx: 'fist', target: 'single', cd: 0,
          desc: '对着烦人的家伙狠狠来上一拳，造成95%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.95 }]
        },
        s2: {
          name: '治疗咬痕', tags: ['治疗', '回能'], fx: 'heal', target: 'ally_lowest', cd: 3,
          desc: '让同伴咬住手臂吸取自己的查克拉：为生命比例最低的友方恢复170%攻击力的生命值，并使其获得20点查克拉。',
          effects: [
            { type: 'heal', mult: 1.7 },
            { type: 'chakra', value: 20, to: 'target' }
          ]
        },
        ult: {
          name: '金刚封锁', tags: ['控制', '群攻', '治疗'], fx: 'seal', target: 'all',
          desc: '觉醒漩涡一族的金刚封锁，放出查克拉锁链缚住敌阵：对全体敌人造成100%攻击力伤害，有60%概率使其束缚1回合，并为全体友方恢复50%攻击力的生命值。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.6 },
            { type: 'heal', mult: 0.5, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '漩涡一族之血', tags: ['治疗', '增益'],
          desc: '生命值+10%，攻击力+10%；漩涡一族旺盛的生命力，每回合开始时为生命比例最低的友方恢复4%最大生命值。',
          stats: { hp: 0.10, atk: 0.10 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.04, to: 'ally_lowest' }] }]
        }
      }
    },

    /* ============================ 重吾 ============================ */
    {
      id: 'jugo', name: '重吾', form: '', en: 'Jugo', title: '咒印的源头',
      faction: 'taka', rarity: 'SR', role: 'atk', element: 'earth', tags: ['输出', '爆发', '吸血'],
      stats: { hp: 1.12, atk: 1.08, def: 0.88, spd: 100 },
      bio: '天生能从自然界吸收能量的特殊体质，正是大蛇丸咒印的源头，却因无法控制的杀戮冲动而自愿被关押。受君麻吕所托追随佐助，加入了鹰小队。',
      quote: '君麻吕托付的人，由我来守护。',
      art: {
        type: 'human', skin: '#efd2b8', hair: 'spiky', hairColor: '#ff8c1a',
        eyes: 'normal', eyeColor: '#e07a2e', outfit: 'robe', outfitColor: '#46406a', accentColor: '#2a2440',
        headband: 'none', marks: ['curse_mark'], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff8c1a'
      },
      skills: {
        passive: {
          name: '咒印体质', tags: ['增益', '爆发'],
          desc: '能从自然界吸收能量的特殊体质：生命值+10%；生命首次低于30%时杀戮冲动爆发，攻击力+35%，持续3回合。',
          stats: { hp: 0.10 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'buff', stat: 'atk', value: 0.35, turns: 3 }] }]
        },
        s1: {
          name: '仙人化·臂锤', tags: ['输出'], fx: 'fist', target: 'single', cd: 0,
          desc: '将手臂仙人化为巨锤砸向敌人，造成115%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.15 }]
        },
        s2: {
          name: '天动', tags: ['爆发', '控制'], fx: 'sage', target: 'single', cd: 3,
          desc: '将手臂化为喷射查克拉的推进器发动冲拳，造成190%攻击力伤害，并有30%概率使目标眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.3 }
          ]
        },
        ult: {
          name: '仙人化之术', tags: ['群攻', '吸血', '增益'], fx: 'sage', target: 'all',
          desc: '全身仙人化陷入狂暴：自身攻击力+30%（持续2回合），随后对全体敌人造成2段共170%攻击力伤害，并恢复相当于本次伤害25%的生命值。',
          effects: [
            { type: 'buff', stat: 'atk', value: 0.3, turns: 2, to: 'self' },
            { type: 'dmg', mult: 0.85, hits: 2 },
            { type: 'lifesteal', value: 0.25 }
          ]
        },
        awaken: {
          name: '细胞的馈赠', tags: ['治疗', '增益'],
          desc: '攻击力+12%；释放必杀技后将自身细胞分给同伴，为生命比例最低的友方恢复20%最大生命值。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'heal', pct: 0.2, to: 'ally_lowest' }] }]
        }
      }
    },

    /* ============================ 鬼灯水月 ============================ */
    {
      id: 'suigetsu', name: '鬼灯水月', form: '', en: 'Hozuki Suigetsu', title: '忍刀收集者',
      faction: 'taka', rarity: 'SR', role: 'atk', element: 'water', tags: ['输出', '闪避', '斩杀'],
      stats: { hp: 1.0, atk: 1.1, def: 0.9, spd: 120 },
      bio: '雾隐村鬼灯一族的忍者，能以“水化之术”将身体化为液体，几乎不惧物理攻击。他梦想集齐忍刀七人众的七把忍刀，加入鹰小队后取回了桃地再不斩的斩首大刀。',
      quote: '我的目标是集齐七把忍刀！',
      art: {
        type: 'human', skin: '#f2e6dc', hair: 'shaggy', hairColor: '#d8e6ee',
        eyes: 'normal', eyeColor: '#8a5fbf', outfit: 'sleeveless', outfitColor: '#7a5aa8', accentColor: '#3a3a4a',
        headband: 'none', marks: ['sharp_teeth'], mask: 'none', hat: 'none', accessory: 'big_sword', aura: '#3a8dff'
      },
      skills: {
        passive: {
          name: '水化之术', tags: ['闪避', '治疗'],
          desc: '将身体化为液体闪避攻击：闪避率+15%；生命首次低于30%时补充水分重组身体，恢复25%最大生命值。',
          stats: { dodge: 0.15 },
          triggers: [{ on: 'low_hp', effects: [{ type: 'heal', pct: 0.25 }] }]
        },
        s1: {
          name: '水铁炮之术', tags: ['输出', '穿透'], fx: 'water', target: 'single', cd: 0,
          desc: '从指尖射出高压水弹，造成110%攻击力伤害（无视20%防御）。',
          effects: [{ type: 'dmg', mult: 1.1, pierce: 0.2 }]
        },
        s2: {
          name: '斩首大刀', tags: ['输出', '吸血'], fx: 'blade', target: 'single', cd: 3,
          desc: '挥舞能吸收血液中的铁质自我修复的斩首大刀，造成190%攻击力伤害，并恢复相当于本次伤害25%的生命值。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'lifesteal', value: 0.25 }
          ]
        },
        ult: {
          name: '豪水腕之术', tags: ['爆发', '斩杀', '单体'], fx: 'water', target: 'single',
          desc: '以水化之术令手臂肌肉急剧膨胀，抡起斩首大刀全力劈下：造成320%攻击力伤害，生命低于30%的目标额外受到100%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 3.2 },
            { type: 'execute', threshold: 0.3, mult: 1.0 }
          ]
        },
        awaken: {
          name: '鬼灯之血', tags: ['反击', '增益'],
          desc: '攻击力+12%；受到攻击时有20%概率水化躲开要害并反击，造成60%攻击力伤害。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_hit', chance: 0.2, effects: [{ type: 'dmg', mult: 0.6, to: 'attacker' }] }]
        }
      }
    }

  ]);
})();
