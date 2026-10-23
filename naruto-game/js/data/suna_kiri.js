/* js/data/suna_kiri.js — 砂隐村与雾隐村（含忍刀七人众）
 * 砂隐：我爱罗两形态、勘九郎、手鞠、马基、千代、海老藏、罗砂、三代目风影、夜叉丸、松里、叶仓。
 * 雾隐：再不斩、白、照美冥、长十郎、青、枸橘矢仓、鬼灯幻月、鬼灯满月、忍刀七人众、空（六尾人柱力）、鬼兄弟。
 * 仅收录《火影忍者》与《火影忍者疾风传》时期的角色、形态与忍术（不含任何博人传内容）。
 */
(function () {
  'use strict';

  var SUNA_FLAK = '#a8916b';   // 砂隐马甲
  var SUNA_DARK = '#6d5a3e';
  var KAZE_GREEN = '#3f8f6a';  // 风影袍饰色
  var KIRI_BLUE = '#2f6fb3';   // 水影袍饰色

  NG.defineChars('suna_kiri', [

    /* ============================ 砂隐村 ============================ */
    {
      id: 'gaara', name: '我爱罗', form: '少年篇', en: 'Gaara', title: '砂瀑之我爱罗',
      faction: 'suna', rarity: 'SR', role: 'tank', element: 'earth', tags: ['护盾', '斩杀', '控制'],
      stats: { hp: 0.95, atk: 1.15, def: 0.95, spd: 92 },
      bio: '砂隐村的人柱力，体内封印着一尾守鹤，自幼被村人畏惧，以“只爱自己的修罗”自居。葫芦中的砂会自动守护他，木叶崩溃一战中败给鸣人后才开始改变。',
      quote: '我只为自己而战，只爱我自己。',
      art: {
        type: 'human', skin: '#f2dcc6', hair: 'messy', hairColor: '#b3241f',
        eyes: 'normal', eyeColor: '#4ab3a4', outfit: 'coat', outfitColor: '#5a2420', accentColor: '#cdb68c',
        headband: 'suna', headbandSlash: false, headbandPos: 'belt',
        marks: ['ai_tattoo'], mask: 'none', hat: 'none', accessory: 'gourd', aura: '#d4a85a'
      },
      skills: {
        passive: {
          name: '绝对防御', tags: ['护盾', '增益'],
          desc: '葫芦中的砂会自动化作砂之盾守护主人：受到的伤害-12%；战斗开始时获得20%最大生命值的护盾，持续2回合。',
          stats: { dr: 0.12 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.2, turns: 2 }] }]
        },
        s1: {
          name: '砂缚柩', tags: ['控制', '消耗'], fx: 'sand', target: 'single', cd: 0,
          desc: '以砂包裹敌人的全身，造成110%攻击力伤害，并有30%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.3 }
          ]
        },
        s2: {
          name: '砂瀑送葬', tags: ['爆发', '斩杀'], fx: 'sand', target: 'single', cd: 3,
          desc: '猛然收紧裹住敌人的砂将其碾碎，造成190%攻击力伤害；生命值低于30%的目标额外受到120%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'execute', threshold: 0.3, mult: 1.2 }
          ]
        },
        ult: {
          name: '狸寝入之术', tags: ['群攻', '控制', '召唤'], fx: 'sand', target: 'all',
          desc: '强行陷入沉睡，让一尾守鹤完全显现并施放风遁·练空弹：对全体敌人造成2段共170%攻击力伤害，并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.85, hits: 2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '守鹤化', tags: ['增益', '护盾'],
          desc: '攻击力+12%；生命值首次低于30%时，身体逐渐化为守鹤：获得30%最大生命值的护盾（持续2回合），并使攻击力提升30%，持续3回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'shield', pct: 0.3, turns: 2 },
            { type: 'buff', stat: 'atk', value: 0.3, turns: 3 }
          ] }]
        }
      }
    },

    {
      id: 'gaara_kazekage', name: '我爱罗', form: '五代目风影', en: 'Gaara', title: '联军总大将',
      faction: 'suna', rarity: 'SSR', role: 'ctrl', element: 'earth', tags: ['控制', '护盾', '群攻'],
      stats: { hp: 1.05, atk: 1.0, def: 1.0, spd: 100 },
      bio: '成为第五代风影的我爱罗，被晓组织抽走守鹤后，经千代的己生转生复活。第四次忍界大战中担任忍者联军总大将，以砂守护了各国的忍者。',
      quote: '我是风影，要守护这个村子。',
      art: {
        type: 'human', skin: '#f2dcc6', hair: 'short', hairColor: '#b3241f',
        eyes: 'normal', eyeColor: '#4ab3a4', outfit: 'kage', outfitColor: '#f1ede4', accentColor: KAZE_GREEN,
        headband: 'none', marks: ['ai_tattoo'], mask: 'none', hat: 'none', accessory: 'gourd', aura: '#f0c060'
      },
      skills: {
        passive: {
          name: '砂之盾', tags: ['护盾'],
          desc: '以砂之盾守护身边的同伴：受到的伤害-8%；战斗开始时为全体友方附加12%最大生命值的护盾，持续2回合。',
          stats: { dr: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.12, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '砂手里剑', tags: ['消耗', '减益'], fx: 'sand', target: 'single', cd: 0,
          desc: '将砂凝成手里剑连续射出，造成3段共114%攻击力伤害，并降低目标15%速度，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.38, hits: 3 },
            { type: 'debuff', stat: 'spd', value: 0.15, turns: 2 }
          ]
        },
        s2: {
          name: '流砂瀑流', tags: ['群攻', '控制', '减益'], fx: 'sand', target: 'all', cd: 3,
          desc: '从地底涌出如瀑布般的大量流砂吞没敌阵，对全体敌人造成95%攻击力伤害，降低其20%速度（持续2回合），并有25%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.95 },
            { type: 'debuff', stat: 'spd', value: 0.2, turns: 2 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.25 }
          ]
        },
        ult: {
          name: '砂瀑大葬', tags: ['群攻', '控制', '爆发'], fx: 'sand', target: 'all',
          desc: '以海啸般的砂浪包裹并压碎整片区域，对全体敌人造成2段共190%攻击力伤害，并有60%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.95, hits: 2 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.6 }
          ]
        },
        awaken: {
          name: '砂缚柩', tags: ['控制', '增益'],
          desc: '攻击力+12%，防御力+8%；攻击命中后有20%概率以砂缚柩困住目标，使其束缚1回合。',
          stats: { atk: 0.12, def: 0.08 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'status', status: 'bind', turns: 1 }] }]
        }
      }
    },

    {
      id: 'kankuro', name: '勘九郎', form: '', en: 'Kankuro', title: '傀儡师',
      faction: 'suna', rarity: 'SR', role: 'ctrl', element: 'none', tags: ['控制', '持续', '减益'],
      stats: { hp: 1.0, atk: 1.05, def: 0.95, spd: 104 },
      bio: '我爱罗的哥哥，砂隐的傀儡师，操纵乌鸦、黑蚁、山椒鱼三具傀儡作战。第四次忍界大战中，他驱使以蝎的身体制成的傀儡“蝎”，与秽土转生的蝎正面对决并将其封印。',
      quote: '傀儡师的战斗，可是要动脑子的。',
      art: {
        type: 'human', skin: '#efd3b5', hair: 'hood', hairColor: '#4a3a2e',
        eyes: 'normal', eyeColor: '#4a3426', outfit: 'bodysuit', outfitColor: '#1d1d26', accentColor: '#6b2d8a',
        headband: 'suna', headbandSlash: false, headbandPos: 'forehead',
        marks: ['face_paint'], paintColor: '#7b2fa0', mask: 'none', hat: 'none', accessory: 'puppet', aura: '#9b59d0'
      },
      skills: {
        passive: {
          name: '山椒鱼', tags: ['护盾', '闪避'],
          desc: '以防御型傀儡山椒鱼掩护队伍：自身闪避率+8%；战斗开始时为全体友方附加8%最大生命值的护盾，持续2回合。',
          stats: { dodge: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.08, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '傀儡术·乌鸦', tags: ['消耗', '持续'], fx: 'puppet', target: 'single', cd: 0,
          desc: '操纵傀儡乌鸦射出淬毒的暗器，造成105%攻击力伤害，并有30%概率使目标中毒2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'status', status: 'poison', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '黑秘技·危机一发', tags: ['控制', '爆发'], fx: 'puppet', target: 'single', cd: 3,
          desc: '以黑蚁将敌人关入体内，再让乌鸦的刀刃从缝隙中贯穿：造成4段共180%攻击力伤害，并有50%概率使目标束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.45, hits: 4 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.5 }
          ]
        },
        ult: {
          name: '赤秘技·机关演舞', tags: ['群攻', '持续'], fx: 'puppet', target: 'all',
          desc: '操纵傀儡“蝎”喷射毒雾与机关暗器，对全体敌人造成3段共165%攻击力伤害，并使其中毒2回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.55, hits: 3 },
            { type: 'status', status: 'poison', turns: 2, value: 0.35 }
          ]
        },
        awaken: {
          name: '傀儡师之魂', tags: ['增益', '持续'],
          desc: '攻击力+12%，速度+5%；攻击命中后有25%概率使目标中毒2回合（每回合30%攻击力）。',
          stats: { atk: 0.12, spd: 0.05 },
          triggers: [{ on: 'on_attack', chance: 0.25, effects: [{ type: 'status', status: 'poison', turns: 2, value: 0.3 }] }]
        }
      }
    },

    {
      id: 'temari', name: '手鞠', form: '', en: 'Temari', title: '砂隐的使者',
      faction: 'suna', rarity: 'SR', role: 'atk', element: 'wind', tags: ['群攻', '输出', '持续'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 115 },
      bio: '我爱罗与勘九郎的姐姐，挥舞巨大铁扇的风遁高手。中忍考试后担任砂隐与木叶的联络人，曾在佐助夺还战中出手救下奈良鹿丸。',
      quote: '风会把一切都吹散！',
      art: {
        type: 'human', skin: '#f4dcc0', hair: 'quad', hairColor: '#e3c06a',
        eyes: 'normal', eyeColor: '#2f8f84', outfit: 'kimono', outfitColor: '#2a2a36', accentColor: '#c0392b',
        headband: 'suna', headbandSlash: false, headbandPos: 'neck',
        marks: [], mask: 'none', hat: 'none', accessory: 'fan', aura: '#6fe0b8'
      },
      skills: {
        passive: {
          name: '巨大铁扇', tags: ['增益', '回能'],
          desc: '挥舞巨大的铁扇卷起狂风：暴击率+10%，速度+6%；战斗开始时获得20点查克拉。',
          stats: { crit: 0.10, spd: 0.06 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '风遁·镰鼬之术', tags: ['输出', '持续'], fx: 'wind', target: 'single', cd: 0,
          desc: '挥扇掀起夹带真空刃的旋风，造成110%攻击力伤害，并有30%概率使目标流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'status', status: 'bleed', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '风遁·大镰鼬之术', tags: ['群攻', '减益'], fx: 'wind', target: 'all', cd: 3,
          desc: '全力挥扇卷起巨型镰鼬，对全体敌人造成3段共96%攻击力伤害，并降低其15%速度，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.32, hits: 3 },
            { type: 'debuff', stat: 'spd', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '口寄·斩斩舞', tags: ['群攻', '爆发', '持续'], fx: 'summon', target: 'all',
          desc: '通灵出手持镰刀的鼬，随狂风斩断一切：对全体敌人造成2段共180%攻击力伤害，并使其流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.9, hits: 2 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.3 }
          ]
        },
        awaken: {
          name: '铁扇全开', tags: ['增益'],
          desc: '攻击力+12%；施放必杀技后顺势掀起顺风，使全体友方速度提升15%，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'buff', stat: 'spd', value: 0.15, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'baki', name: '马基', form: '', en: 'Baki', title: '砂隐上忍',
      faction: 'suna', rarity: 'R', role: 'atk', element: 'wind', tags: ['输出', '斩杀'],
      stats: { hp: 1.0, atk: 1.1, def: 0.92, spd: 108 },
      bio: '砂隐的上忍，砂之三姐弟的带队老师。木叶崩溃计划中率领砂隐忍者行动，并以“风之刃”斩杀了月光疾风。',
      quote: '任务就是一切，不需要多余的感情。',
      art: {
        type: 'human', skin: '#d9b48f', hair: 'short', hairColor: '#3a2a20',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'flak', outfitColor: SUNA_FLAK, accentColor: SUNA_DARK,
        headband: 'suna', headbandSlash: false, headbandPos: 'forehead',
        marks: ['eye_bandage'], mask: 'none', hat: 'bandana_cap', capColor: '#e9e2d0', accessory: 'none', aura: '#5fd6a6'
      },
      skills: {
        passive: {
          name: '砂隐上忍', tags: ['增益', '回能'],
          desc: '身经百战的砂隐上忍：暴击率+10%，攻击力+5%；战斗开始时获得15点查克拉。',
          stats: { crit: 0.10, atk: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 15 }] }]
        },
        s1: {
          name: '瞬身之术', tags: ['输出', '闪避'], fx: 'blade', target: 'single', cd: 0,
          desc: '以瞬身之术高速逼近斩击，造成110%攻击力伤害，并使自身闪避率提升10%，持续1回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'buff', stat: 'dodge', value: 0.1, turns: 1, to: 'self' }
          ]
        },
        s2: {
          name: '风之刃', tags: ['爆发', '穿透', '持续'], fx: 'wind', target: 'single', cd: 3,
          desc: '将风遁查克拉凝成无形之刃斩向敌人，造成180%攻击力伤害（无视30%防御），并使其流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.8, pierce: 0.3 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.3 }
          ]
        },
        ult: {
          name: '木叶崩溃计划', tags: ['群攻', '增益'], fx: 'wind', target: 'all',
          desc: '指挥砂隐部队发动木叶崩溃作战：对全体敌人造成2段共140%攻击力伤害，并使全体友方攻击力提升20%，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.7, hits: 2 },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2, to: 'ally_all' }
          ]
        },
        awaken: {
          name: '暗杀', tags: ['斩杀'],
          desc: '攻击力+10%；攻击命中后，若目标生命值低于25%，有40%概率追加80%攻击力的斩杀伤害。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_attack', chance: 0.4, effects: [{ type: 'execute', threshold: 0.25, mult: 0.8 }] }]
        }
      }
    },

    {
      id: 'chiyo', name: '千代', form: '', en: 'Chiyo', title: '傀儡部队之祖',
      faction: 'suna', rarity: 'SSR', role: 'heal', element: 'none', tags: ['复活', '治疗', '控制'],
      stats: { hp: 0.95, atk: 1.05, def: 1.0, spd: 112 },
      bio: '砂隐的顾问长老，傀儡术与毒术的大师，也是蝎的祖母。与春野樱联手击败了蝎，最后以己生转生之术献出生命，复活了我爱罗。',
      quote: '这个世界的未来，就交给你们了。',
      art: {
        type: 'human', skin: '#e9cfb2', hair: 'buns', hairColor: '#b9b9be',
        eyes: 'normal', eyeColor: '#3b3b3b', outfit: 'robe', outfitColor: '#6d6a7e', accentColor: '#8c2f39',
        headband: 'none', marks: ['wrinkles'], mask: 'none', hat: 'none', accessory: 'puppet', aura: '#d9d9e8'
      },
      skills: {
        passive: {
          name: '查克拉丝', tags: ['闪避', '增益'],
          desc: '以查克拉丝操纵同伴的身体闪避攻击：自身速度+6%；战斗开始时使全体友方闪避率提升10%，持续2回合。',
          stats: { spd: 0.06 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'dodge', value: 0.1, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '傀儡术·父母', tags: ['消耗', '治疗'], fx: 'puppet', target: 'single', cd: 0,
          desc: '操纵蝎亲手制作的“父”“母”傀儡夹击敌人，造成100%攻击力伤害，并为生命值最低的友方恢复相当于15%攻击力的生命值。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'heal', mult: 0.15, to: 'ally_lowest' }
          ]
        },
        s2: {
          name: '白秘技·十机近松之集', tags: ['群攻', '控制'], fx: 'puppet', target: 'all', cd: 3,
          desc: '以十指同时操纵传说中的十具傀儡“近松十人众”围攻敌阵，对全体敌人造成4段共100%攻击力伤害，并有20%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.25, hits: 4 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.2 }
          ]
        },
        ult: {
          name: '己生转生', tags: ['复活', '治疗', '净化'], fx: 'heal', target: 'ally_all',
          desc: '倾注毕生心血的转生忍术：复活一名阵亡的友方并恢复其50%最大生命值（每场战斗限1次），随后为全体友方恢复20%最大生命值，并解除其减益与异常状态。',
          effects: [
            { type: 'revive', pct: 0.5 },
            { type: 'heal', pct: 0.2, to: 'ally_all' },
            { type: 'cleanse', to: 'ally_all' }
          ]
        },
        awaken: {
          name: '解毒剂', tags: ['净化', '治疗'],
          desc: '生命值+10%，攻击力+10%；每次自身回合开始时，有30%概率以特制解毒剂为全体友方解除减益与异常状态，并恢复其5%最大生命值。',
          stats: { hp: 0.10, atk: 0.10 },
          triggers: [{ on: 'turn_start', chance: 0.3, effects: [
            { type: 'cleanse', to: 'ally_all' },
            { type: 'heal', pct: 0.05, to: 'ally_all' }
          ] }]
        }
      }
    },

    {
      id: 'ebizo', name: '海老藏', form: '', en: 'Ebizo', title: '砂隐长老',
      faction: 'suna', rarity: 'R', role: 'sup', element: 'none', tags: ['增益', '回能'],
      stats: { hp: 1.05, atk: 0.95, def: 1.0, spd: 96 },
      bio: '千代的弟弟，与姐姐一同担任砂隐村的顾问长老。性格比姐姐温和稳重，见证了我爱罗作为风影一步步得到村民的认可。',
      quote: '年轻人的成长，真让老夫欣慰啊。',
      art: {
        type: 'human', skin: '#e6c9a6', hair: 'bald', hairColor: '#d8d4cc',
        eyes: 'closed', eyeColor: '#3b3b3b', outfit: 'robe', outfitColor: '#a99b7e', accentColor: '#5e5442',
        headband: 'none', marks: ['wrinkles', 'mustache'], beardColor: '#d8d4cc', mask: 'none', hat: 'none', accessory: 'none', aura: '#e8c547'
      },
      skills: {
        passive: {
          name: '砂隐相谈役', tags: ['增益'],
          desc: '以长老的经验指引同伴：自身防御力+8%；战斗开始时使全体友方防御力提升12%，持续2回合。',
          stats: { def: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'def', value: 0.12, turns: 2, to: 'ally_all' }] }]
        },
        s1: {
          name: '手里剑之术', tags: ['消耗', '减益'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '投出手里剑牵制敌人，造成100%攻击力伤害，并降低目标10%攻击力，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'atk', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '长老的指点', tags: ['增益', '回能'], fx: 'yang', target: 'ally_all', cd: 3,
          desc: '向年轻人传授战斗的要诀：使全体友方攻击力提升20%，持续2回合，并使全体友方获得10点查克拉。',
          effects: [
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2 },
            { type: 'chakra', value: 10, to: 'ally_all' }
          ]
        },
        ult: {
          name: '托付未来', tags: ['增益', '治疗'], fx: 'yang', target: 'ally_all',
          desc: '将砂隐的未来托付给年轻一代：为全体友方恢复12%最大生命值，并使其攻击力提升25%、受到的伤害降低12%，持续2回合。',
          effects: [
            { type: 'heal', pct: 0.12 },
            { type: 'buff', stat: 'atk', value: 0.25, turns: 2 },
            { type: 'buff', stat: 'dr', value: 0.12, turns: 2 }
          ]
        },
        awaken: {
          name: '姐弟同心', tags: ['增益', '治疗'],
          desc: '攻击力+10%，防御力+10%；友方阵亡时，为全体友方恢复8%最大生命值，并使其攻击力提升15%，持续2回合。',
          stats: { atk: 0.10, def: 0.10 },
          triggers: [{ on: 'on_ally_death', effects: [
            { type: 'heal', pct: 0.08, to: 'ally_all' },
            { type: 'buff', stat: 'atk', value: 0.15, turns: 2, to: 'ally_all' }
          ] }]
        }
      }
    },

    {
      id: 'rasa', name: '罗砂', form: '四代目风影', en: 'Rasa', title: '砂金风影',
      faction: 'suna', rarity: 'SSR', role: 'ctrl', element: 'earth', tags: ['控制', '减益', '群攻'],
      stats: { hp: 1.0, atk: 1.05, def: 1.0, spd: 98 },
      bio: '第四代风影，我爱罗、勘九郎与手鞠的父亲，能以磁遁操纵比砂更沉重的砂金。为让村子拥有最强的兵器而将守鹤封入我爱罗体内，后遭大蛇丸暗杀；大战中以秽土之身与儿子重逢，终于承认了自己的错误。',
      quote: '你的母亲……一直深爱着你。',
      art: {
        type: 'human', skin: '#e8c9a8', hair: 'short', hairColor: '#8b3a1e',
        eyes: 'normal', eyeColor: '#33475b', outfit: 'kage', outfitColor: '#f0ece2', accentColor: KAZE_GREEN,
        headband: 'none', marks: [], mask: 'none', hat: 'kazekage', accessory: 'none', aura: '#e6c14a'
      },
      skills: {
        passive: {
          name: '四代目风影', tags: ['减益', '增益'],
          desc: '砂金比砂沉重得多，能压制敌人的行动：自身防御力+8%；战斗开始时降低全体敌人12%速度，持续2回合。',
          stats: { def: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'debuff', stat: 'spd', value: 0.12, turns: 2, to: 'enemy_all' }] }]
        },
        s1: {
          name: '磁遁·砂金', tags: ['消耗', '减益'], fx: 'magnet', target: 'single', cd: 0,
          desc: '操纵沉重的砂金砸向敌人，造成110%攻击力伤害，并降低其15%速度，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.1 },
            { type: 'debuff', stat: 'spd', value: 0.15, turns: 2 }
          ]
        },
        s2: {
          name: '砂金·重压', tags: ['控制', '爆发'], fx: 'magnet', target: 'single', cd: 3,
          desc: '以大量砂金包裹并压制目标，造成170%攻击力伤害，并有60%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.7 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.6 }
          ]
        },
        ult: {
          name: '砂金大波', tags: ['群攻', '控制', '减益'], fx: 'magnet', target: 'all',
          desc: '掀起海啸般的砂金巨浪吞没敌阵，对全体敌人造成2段共170%攻击力伤害，降低其25%速度（持续2回合），并有40%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.85, hits: 2 },
            { type: 'debuff', stat: 'spd', value: 0.25, turns: 2 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 }
          ]
        },
        awaken: {
          name: '父之悔悟', tags: ['护盾', '增益'],
          desc: '攻击力+12%；施放必杀技后，以砂金为全体友方筑起屏障，附加10%最大生命值的护盾，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'shield', pct: 0.1, turns: 2, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'kazekage_3', name: '三代目风影', form: '', en: 'Sandaime Kazekage', title: '史上最强风影',
      faction: 'suna', rarity: 'SSR', role: 'atk', element: 'earth', tags: ['输出', '群攻', '持续'],
      stats: { hp: 0.95, atk: 1.15, def: 0.92, spd: 106 },
      bio: '被誉为砂隐史上最强的风影，以磁遁操纵砂铁作战。被蝎暗杀后制成了人傀儡，第四次忍界大战中又被秽土转生召唤，与我爱罗交手。',
      quote: '砂铁的锋芒，无人能挡。',
      art: {
        type: 'human', skin: '#e3c4a2', hair: 'shaggy', hairColor: '#1d1d22',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'kage', outfitColor: '#3b3f4a', accentColor: KAZE_GREEN,
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#546e7a'
      },
      skills: {
        passive: {
          name: '磁遁·砂铁', tags: ['增益'],
          desc: '以磁遁随心操纵砂铁：攻击力+10%，暴击率+8%。',
          stats: { atk: 0.10, crit: 0.08 }
        },
        s1: {
          name: '砂铁时雨', tags: ['输出', '持续'], fx: 'magnet', target: 'single', cd: 0,
          desc: '将砂铁化作无数细小颗粒如骤雨般射出，造成3段共120%攻击力伤害，并有30%概率使目标流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.4, hits: 3 },
            { type: 'status', status: 'bleed', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '砂铁结集', tags: ['爆发', '穿透'], fx: 'magnet', target: 'single', cd: 3,
          desc: '将砂铁凝聚成巨大的尖刺锤猛击敌人，造成210%攻击力伤害（无视30%防御）。',
          effects: [{ type: 'dmg', mult: 2.1, pierce: 0.3 }]
        },
        ult: {
          name: '砂铁界法', tags: ['群攻', '爆发', '持续'], fx: 'magnet', target: 'all',
          desc: '令砂铁以自身为中心向四面八方伸出无数尖刺，对全体敌人造成3段共195%攻击力伤害，并使其流血2回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.65, hits: 3 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.35 }
          ]
        },
        awaken: {
          name: '秽土转生', tags: ['治疗', '增益'],
          desc: '攻击力+12%；生命值首次低于30%时，尘土重组身躯，恢复30%最大生命值，并使攻击力提升20%，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.3 },
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2 }
          ] }]
        }
      }
    },

    {
      id: 'yashamaru', name: '夜叉丸', form: '', en: 'Yashamaru', title: '温柔的舅舅',
      faction: 'suna', rarity: 'R', role: 'heal', element: 'none', tags: ['治疗', '净化'],
      stats: { hp: 1.0, atk: 1.0, def: 1.0, spd: 104 },
      bio: '我爱罗母亲的弟弟，砂隐的医疗忍者，曾代替姐姐照顾年幼的我爱罗。奉风影之命刺杀我爱罗失败后，以缠满全身的起爆符自爆，令我爱罗彻底封闭了内心。',
      quote: '心灵的伤口，只有爱才能治愈。',
      art: {
        type: 'human', skin: '#f1d8c0', hair: 'bob', hairColor: '#c7a36a',
        eyes: 'normal', eyeColor: '#5a6b4a', outfit: 'flak', outfitColor: SUNA_FLAK, accentColor: SUNA_DARK,
        headband: 'suna', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#69f0ae'
      },
      skills: {
        passive: {
          name: '医疗忍者', tags: ['治疗'],
          desc: '精通医疗忍术：自身防御力+5%；每次自身回合开始时，为生命值最低的友方恢复5%最大生命值。',
          stats: { def: 0.05 },
          triggers: [{ on: 'turn_start', effects: [{ type: 'heal', pct: 0.05, to: 'ally_lowest' }] }]
        },
        s1: {
          name: '苦无投掷', tags: ['消耗', '治疗'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '在夜色中投出苦无，造成100%攻击力伤害，并为生命值最低的友方恢复相当于15%攻击力的生命值。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'heal', mult: 0.15, to: 'ally_lowest' }
          ]
        },
        s2: {
          name: '医疗忍术', tags: ['治疗'], fx: 'heal', target: 'ally_all', cd: 3,
          desc: '以医疗忍术治疗同伴，为全体友方恢复相当于110%攻击力的生命值。',
          effects: [{ type: 'heal', mult: 1.1 }]
        },
        ult: {
          name: '心之伤药', tags: ['治疗', '净化'], fx: 'heal', target: 'ally_all',
          desc: '以温柔的伤药抚平同伴的伤痛：为全体友方恢复相当于150%攻击力的生命值，并解除其减益与异常状态。',
          effects: [
            { type: 'heal', mult: 1.5 },
            { type: 'cleanse', to: 'ally_all' }
          ]
        },
        awaken: {
          name: '起爆符·自爆', tags: ['群攻', '爆发'],
          desc: '攻击力+10%；阵亡时引爆缠满全身的起爆符，对全体敌人造成150%攻击力伤害，并使其灼烧2回合（每回合30%攻击力）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_death', effects: [
            { type: 'dmg', mult: 1.5, to: 'enemy_all' },
            { type: 'status', status: 'burn', turns: 2, value: 0.3, to: 'enemy_all' }
          ] }]
        }
      }
    },

    {
      id: 'matsuri', name: '松里', form: '', en: 'Matsuri', title: '我爱罗的弟子',
      faction: 'suna', rarity: 'R', role: 'ctrl', element: 'none', tags: ['控制', '减益'],
      stats: { hp: 0.95, atk: 1.05, def: 1.0, spd: 112 },
      bio: '砂隐的下忍，我爱罗的第一位弟子。因害怕刀刃而使用我爱罗为她挑选的绳镖，对老师怀有深深的敬慕。',
      quote: '我爱罗老师，我一定会变强的！',
      art: {
        type: 'human', skin: '#f1d3b5', hair: 'short', hairColor: '#4a3328',
        eyes: 'normal', eyeColor: '#3a2a22', outfit: 'shirt', outfitColor: '#efe7d6', accentColor: '#5f86b0',
        headband: 'suna', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'kunai', aura: '#19b5c9'
      },
      skills: {
        passive: {
          name: '敬慕之心', tags: ['增益', '回能'],
          desc: '一心追随我爱罗老师：速度+8%，闪避率+6%；战斗开始时获得15点查克拉。',
          stats: { spd: 0.08, dodge: 0.06 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 15 }] }]
        },
        s1: {
          name: '绳镖', tags: ['控制', '消耗'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '甩出绳镖击打敌人，造成105%攻击力伤害，并有30%概率缠住目标使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.3 }
          ]
        },
        s2: {
          name: '绳镖·回旋', tags: ['群攻', '减益'], fx: 'shuriken', target: 'random', count: 2, cd: 3,
          desc: '舞动绳镖横扫，对随机2名敌人各造成80%攻击力伤害，并降低其20%速度，持续2回合。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'debuff', stat: 'spd', value: 0.2, turns: 2 }
          ]
        },
        ult: {
          name: '守护之绳', tags: ['控制', '单体'], fx: 'shuriken', target: 'single',
          desc: '为了守护重要的人，鼓起勇气全力掷出绳镖：造成260%攻击力伤害，并使目标束缚1回合。',
          effects: [
            { type: 'dmg', mult: 2.6 },
            { type: 'status', status: 'bind', turns: 1 }
          ]
        },
        awaken: {
          name: '克服恐惧', tags: ['控制', '反击'],
          desc: '攻击力+10%，速度+5%；受到攻击时有30%概率以绳镖缠住攻击者，使其束缚1回合。',
          stats: { atk: 0.10, spd: 0.05 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'status', status: 'bind', turns: 1, to: 'attacker' }] }]
        }
      }
    },

    {
      id: 'pakura', name: '叶仓', form: '灼遁', en: 'Pakura', title: '砂隐的英雄',
      faction: 'suna', rarity: 'SR', role: 'atk', element: 'fire', tags: ['输出', '斩杀', '持续'],
      stats: { hp: 0.92, atk: 1.18, def: 0.92, spd: 114 },
      bio: '掌握血继限界“灼遁”的砂隐女忍者，被誉为“砂隐的英雄”。因村子高层的出卖遭雾隐忍者伏击身亡，第四次忍界大战中被秽土转生，与昔日的弟子重逢。',
      quote: '我的灼遁，会蒸干一切。',
      art: {
        type: 'human', skin: '#efd2b4', hair: 'long_straight', hairColor: '#2f5a55',
        eyes: 'normal', eyeColor: '#7a5a2a', outfit: 'robe', outfitColor: '#f0e8da', accentColor: '#c0392b',
        headband: 'suna', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff9100'
      },
      skills: {
        passive: {
          name: '灼遁', tags: ['增益', '回能'],
          desc: '风与火两种性质合成的血继限界：攻击力+8%，暴击率+8%；战斗开始时获得20点查克拉。',
          stats: { atk: 0.08, crit: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '灼热球', tags: ['输出', '持续'], fx: 'scorch', target: 'single', cd: 0,
          desc: '放出灼热的光球撞向敌人，造成2段共115%攻击力伤害，并有30%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.575, hits: 2 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '灼热球阵', tags: ['群攻', '持续'], fx: 'scorch', target: 'all', cd: 3,
          desc: '让数颗灼热球环绕敌阵释放高温，对全体敌人造成90%攻击力伤害，并有50%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.5, value: 0.3 }
          ]
        },
        ult: {
          name: '灼遁·过蒸杀', tags: ['爆发', '斩杀', '单体'], fx: 'scorch', target: 'single',
          desc: '以灼热球贴近敌人，瞬间蒸发其体内的水分：造成320%攻击力伤害；生命值低于35%的目标额外受到140%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 3.2 },
            { type: 'execute', threshold: 0.35, mult: 1.4 }
          ]
        },
        awaken: {
          name: '英雄之魂', tags: ['回能', '增益'],
          desc: '攻击力+12%；击败敌人后获得40点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'chakra', value: 40 }] }]
        }
      }
    },

    /* ============================ 雾隐村 ============================ */
    {
      id: 'zabuza', name: '桃地再不斩', form: '雾隐鬼人', en: 'Momochi Zabuza', title: '忍刀七人众',
      faction: 'kiri', rarity: 'SR', role: 'atk', element: 'water', tags: ['输出', '斩杀', '闪避'],
      stats: { hp: 1.0, atk: 1.15, def: 0.9, spd: 118 },
      bio: '雾隐村的叛忍，忍刀七人众之一，手持斩首大刀，人称“雾隐的鬼人”。在波之国与卡卡西激战，最终为白的死流下眼泪，拼尽最后的力量斩杀了卡多。',
      quote: '白……我也想去你所在的地方。',
      art: {
        type: 'human', skin: '#e2c2a2', hair: 'spiky', hairColor: '#26262b',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'sleeveless', outfitColor: '#6e7c79', accentColor: '#4f5d55',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: ['bandage_face'], mask: 'none', hat: 'none', accessory: 'big_sword', aura: '#a8c8d8'
      },
      skills: {
        passive: {
          name: '雾隐之术', tags: ['闪避', '增益'],
          desc: '在浓雾中隐匿身形：闪避率+15%；战斗开始时使自身暴击率提升15%，持续2回合。',
          stats: { dodge: 0.15 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'crit', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '斩首大刀', tags: ['输出', '持续'], fx: 'blade', target: 'single', cd: 0,
          desc: '挥舞巨大的斩首大刀劈砍，造成120%攻击力伤害，并有30%概率使目标流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'bleed', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '水遁·水龙弹之术', tags: ['爆发', '减益'], fx: 'water', target: 'single', cd: 3,
          desc: '结出大量手印召出水龙冲击敌人，造成190%攻击力伤害，并降低其15%防御，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.9 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '无声杀人术', tags: ['斩杀', '爆发', '单体'], fx: 'blade', target: 'lowest',
          desc: '借浓雾掩护无声无息地逼近，直取生命值比例最低的敌人：造成300%攻击力伤害（无视25%防御）；若其生命值低于35%，额外受到150%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 3.0, pierce: 0.25 },
            { type: 'execute', threshold: 0.35, mult: 1.5 }
          ]
        },
        awaken: {
          name: '鬼人之魂', tags: ['增益', '爆发'],
          desc: '攻击力+12%；生命值首次低于30%时，化身口衔苦无冲锋的鬼人：攻击力提升35%并免疫控制，持续3回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'buff', stat: 'atk', value: 0.35, turns: 3 },
            { type: 'immune', turns: 3 }
          ] }]
        }
      }
    },

    {
      id: 'haku', name: '白', form: '', en: 'Haku', title: '雪一族遗孤',
      faction: 'kiri', rarity: 'SR', role: 'ctrl', element: 'water', tags: ['控制', '输出', '复活'],
      stats: { hp: 0.9, atk: 1.1, def: 1.0, spd: 135 },
      bio: '雪一族的遗孤，继承了血继限界冰遁，甘愿作为再不斩的“工具”追随左右。在波之国以魔镜冰晶困住佐助与鸣人，最终以身体替再不斩挡下了卡卡西的雷切。',
      quote: '有想守护的人，才能真正变强。',
      art: {
        type: 'human', skin: '#f6e3d3', hair: 'long_straight', hairColor: '#1a1b24',
        eyes: 'normal', eyeColor: '#4a3426', outfit: 'kimono', outfitColor: '#3d5c54', accentColor: '#c8b48c',
        headband: 'none', marks: [], mask: 'anbu', hat: 'none', accessory: 'none', aura: '#9fdcff'
      },
      skills: {
        passive: {
          name: '冰遁', tags: ['增益', '闪避'],
          desc: '雪一族的血继限界：速度+8%，闪避率+10%；战斗开始时获得20点查克拉。',
          stats: { spd: 0.08, dodge: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 20 }] }]
        },
        s1: {
          name: '千本', tags: ['消耗', '控制'], fx: 'shuriken', target: 'single', cd: 0,
          desc: '精准地向敌人的穴位射出千本，造成3段共111%攻击力伤害，并有20%概率使目标眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.37, hits: 3 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.2 }
          ]
        },
        s2: {
          name: '秘术·千杀水翔', tags: ['群攻', '持续'], fx: 'ice', target: 'all', cd: 3,
          desc: '将周围的水化作无数冰针从四面八方刺向敌人，对全体敌人造成95%攻击力伤害，并有40%概率使其流血2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.95 },
            { type: 'status', status: 'bleed', turns: 2, chance: 0.4, value: 0.25 }
          ]
        },
        ult: {
          name: '秘术·魔镜冰晶', tags: ['控制', '爆发', '单体'], fx: 'ice', target: 'single',
          desc: '以冰镜将敌人团团围住，在镜间高速穿梭射出千本：造成6段共300%攻击力伤害，并使目标冰冻1回合。',
          effects: [
            { type: 'dmg', mult: 0.5, hits: 6 },
            { type: 'status', status: 'freeze', turns: 1 }
          ]
        },
        awaken: {
          name: '千本·假死', tags: ['复活'],
          desc: '攻击力+10%；友方阵亡时，以千本封住其穴位使其陷入假死，随即令其以25%最大生命值复活（每场战斗限1次）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_ally_death', effects: [{ type: 'revive', pct: 0.25 }] }]
        }
      }
    },

    {
      id: 'mei', name: '照美冥', form: '五代目水影', en: 'Terumi Mei', title: '血雾的终结者',
      faction: 'kiri', rarity: 'SSR', role: 'atk', element: 'water', tags: ['群攻', '减益', '持续'],
      stats: { hp: 1.0, atk: 1.12, def: 0.95, spd: 110 },
      bio: '第五代水影，同时拥有熔遁与沸遁两种血继限界，终结了雾隐“血雾之里”的黑暗时代。五影会谈中与佐助交手，第四次忍界大战中与其他四影并肩对抗宇智波斑。',
      quote: '敢挡我的路，就让你化为熔浆。',
      art: {
        type: 'human', skin: '#f6e0cc', hair: 'long_bang', hairColor: '#b4502a',
        eyes: 'normal', eyeColor: '#3b8a5c', outfit: 'qipao', outfitColor: '#1f3a7a', accentColor: '#6b7fa3',
        headband: 'none', marks: ['red_lips'], mask: 'none', hat: 'none', accessory: 'none', aura: '#ff6a2b'
      },
      skills: {
        passive: {
          name: '双血继限界', tags: ['增益', '回能'],
          desc: '同时继承熔遁与沸遁两种血继限界：攻击力+10%，暴击率+8%；战斗开始时获得15点查克拉。',
          stats: { atk: 0.10, crit: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 15 }] }]
        },
        s1: {
          name: '水遁·水龙弹之术', tags: ['输出'], fx: 'water', target: 'single', cd: 0,
          desc: '召出水龙冲击敌人，造成120%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.2 }]
        },
        s2: {
          name: '沸遁·巧雾之术', tags: ['群攻', '减益', '持续'], fx: 'boil', target: 'all', cd: 3,
          desc: '吐出高浓度的酸性雾气笼罩敌阵，对全体敌人造成80%攻击力伤害，降低其20%防御（持续2回合），并使其中毒2回合（每回合25%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'debuff', stat: 'def', value: 0.2, turns: 2 },
            { type: 'status', status: 'poison', turns: 2, value: 0.25 }
          ]
        },
        ult: {
          name: '熔遁·熔怪之术', tags: ['群攻', '爆发', '持续'], fx: 'lava', target: 'all',
          desc: '从口中喷出大量熔岩吞没敌阵，对全体敌人造成2段共200%攻击力伤害，并使其灼烧2回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.0, hits: 2 },
            { type: 'status', status: 'burn', turns: 2, value: 0.4 }
          ]
        },
        awaken: {
          name: '熔遁·石灰凝之术', tags: ['控制'],
          desc: '攻击力+12%；攻击命中后有20%概率喷出迅速凝固的石灰，使目标束缚1回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'status', status: 'bind', turns: 1 }] }]
        }
      }
    },

    {
      id: 'chojuro', name: '长十郎', form: '', en: 'Chojuro', title: '水影护卫',
      faction: 'kiri', rarity: 'SR', role: 'atk', element: 'water', tags: ['输出', '穿透', '护盾'],
      stats: { hp: 1.0, atk: 1.1, def: 0.95, spd: 108 },
      bio: '雾隐年轻一代的忍刀七人众，手持双刀·鲆鲽。性格腼腆、缺乏自信，作为水影照美冥的护卫出席五影会谈，并随水影一同迎战宇智波佐助。',
      quote: '我、我会尽力的……',
      art: {
        type: 'human', skin: '#f1ddca', hair: 'shaggy', hairColor: '#7fb0de',
        eyes: 'normal', eyeColor: '#3a3550', outfit: 'highcollar', outfitColor: '#aab9cf', accentColor: '#2f4f7f',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: ['glasses', 'fangs'], mask: 'none', hat: 'none', accessory: 'big_sword', aura: '#3a8dff'
      },
      skills: {
        passive: {
          name: '查克拉蓄积', tags: ['回能', '增益'],
          desc: '鲆鲽能储存使用者的查克拉：防御力+8%；受到攻击时获得8点查克拉。',
          stats: { def: 0.08 },
          triggers: [{ on: 'on_hit', effects: [{ type: 'chakra', value: 8 }] }]
        },
        s1: {
          name: '双刀·鲆鲽', tags: ['输出', '护盾'], fx: 'blade', target: 'single', cd: 0,
          desc: '挥动双刀·鲆鲽斩击，造成115%攻击力伤害，并获得相当于10%攻击力的护盾。',
          effects: [
            { type: 'dmg', mult: 1.15 },
            { type: 'shield', mult: 0.1, to: 'self' }
          ]
        },
        s2: {
          name: '鲆鲽·解放', tags: ['爆发', '穿透', '控制'], fx: 'blade', target: 'single', cd: 3,
          desc: '释放鲆鲽中储存的查克拉，化作巨锤砸向敌人：造成190%攻击力伤害（无视35%防御），并有40%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 1.9, pierce: 0.35 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '鲆鲽·全力解放', tags: ['爆发', '穿透', '单体'], fx: 'blade', target: 'single',
          desc: '将查克拉完全灌入鲆鲽化作巨刃，斩开一切防御：先清除目标的所有增益与护盾，再造成320%攻击力伤害（无视40%防御）。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 3.2, pierce: 0.4 }
          ]
        },
        awaken: {
          name: '忍刀的觉悟', tags: ['增益', '护盾'],
          desc: '攻击力+12%，暴击率+8%；施放必杀技后获得15%最大生命值的护盾，持续2回合。',
          stats: { atk: 0.12, crit: 0.08 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'shield', pct: 0.15, turns: 2 }] }]
        }
      }
    },

    {
      id: 'ao', name: '青', form: '', en: 'Ao', title: '雾隐感知忍者',
      faction: 'kiri', rarity: 'SR', role: 'sup', element: 'water', tags: ['增益', '减益', '净化'],
      stats: { hp: 1.05, atk: 1.0, def: 1.0, spd: 100 },
      bio: '雾隐的资深感知忍者，右眼是在战斗中从日向一族夺来的白眼，平时以眼罩遮盖。作为水影护卫出席五影会谈，识破了团藏对三船施加的瞳术。',
      quote: '我这只白眼，可什么都看得见。',
      art: {
        type: 'human', skin: '#e3c6a6', hair: 'slick_back', hairColor: '#33507d',
        eyes: 'normal', eyeColor: '#2b2b2b', eyeL: 'byakugan', outfit: 'coat', outfitColor: '#2f4f6f', accentColor: '#b8c6d4',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: ['eye_bandage'], mask: 'none', hat: 'none', accessory: 'none', aura: '#b9a2ea'
      },
      skills: {
        passive: {
          name: '白眼', tags: ['减益', '增益'],
          desc: '以夺来的白眼看穿一切：自身暴击率+10%；战斗开始时降低全体敌人10%闪避率，持续3回合。',
          stats: { crit: 0.10 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'debuff', stat: 'dodge', value: 0.1, turns: 3, to: 'enemy_all' }] }]
        },
        s1: {
          name: '洞察经络', tags: ['消耗', '减益'], fx: 'eye', target: 'single', cd: 0,
          desc: '以白眼看穿敌人的查克拉经络后精准出击，造成100%攻击力伤害，并降低目标10%防御，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'debuff', stat: 'def', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '水遁·水阵壁', tags: ['护盾'], fx: 'shield', target: 'ally_all', cd: 3,
          desc: '吐出大量的水形成水墙守护同伴，为全体友方附加15%最大生命值的护盾，持续2回合。',
          effects: [{ type: 'shield', pct: 0.15, turns: 2 }]
        },
        ult: {
          name: '白眼·看破', tags: ['净化', '减益', '群攻'], fx: 'eye', target: 'all',
          desc: '白眼看穿敌人的一切伎俩：清除全体敌人的增益与护盾，造成80%攻击力伤害并降低其20%防御（持续2回合），同时为全体友方解除减益与异常状态。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 0.8 },
            { type: 'debuff', stat: 'def', value: 0.2, turns: 2 },
            { type: 'cleanse', to: 'ally_all' }
          ]
        },
        awaken: {
          name: '感知忍术', tags: ['回能', '增益'],
          desc: '攻击力+10%，速度+5%；战斗开始时使全体友方获得15点查克拉。',
          stats: { atk: 0.10, spd: 0.05 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'chakra', value: 15, to: 'ally_all' }] }]
        }
      }
    },

    {
      id: 'yagura', name: '枸橘矢仓', form: '四代目水影', en: 'Karatachi Yagura', title: '被操控的水影',
      faction: 'kiri', rarity: 'SSR', role: 'tank', element: 'water', tags: ['反击', '护盾', '控制'],
      stats: { hp: 1.05, atk: 1.05, def: 0.95, spd: 96 },
      bio: '第四代水影，完全掌控了三尾矶抚的人柱力。被宇智波带土以写轮眼的幻术操控，雾隐由此陷入“血雾之里”的黑暗时代。',
      quote: '在水镜中，与你自己战斗吧。',
      art: {
        type: 'human', skin: '#f2dcc8', hair: 'messy', hairColor: '#9aa6b4',
        eyes: 'normal', eyeColor: '#d07aa8', outfit: 'kage', outfitColor: '#3a6f95', accentColor: '#e6eef4',
        headband: 'none', marks: ['eye_scar'], mask: 'none', hat: 'none', accessory: 'staff', aura: '#8bd3dd'
      },
      skills: {
        passive: {
          name: '三尾人柱力', tags: ['护盾', '增益'],
          desc: '完全掌控三尾矶抚的力量：生命值+10%，受到的伤害-8%；战斗开始时获得18%最大生命值的护盾，持续2回合。',
          stats: { hp: 0.10, dr: 0.08 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'shield', pct: 0.18, turns: 2 }] }]
        },
        s1: {
          name: '钩棍', tags: ['消耗', '减益'], fx: 'blade', target: 'single', cd: 0,
          desc: '挥动带钩的长棍打击敌人，造成105%攻击力伤害，并降低目标10%攻击力，持续2回合。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'debuff', stat: 'atk', value: 0.1, turns: 2 }
          ]
        },
        s2: {
          name: '水遁·水镜之术', tags: ['反击', '嘲讽'], fx: 'water', target: 'self', cd: 3,
          desc: '以水镜映出敌人的倒影，让其攻击反噬自身：嘲讽全体敌人2回合，并在2回合内受到攻击时反击，造成100%攻击力伤害。',
          effects: [
            { type: 'taunt', turns: 2 },
            { type: 'counter', mult: 1.0, turns: 2 }
          ]
        },
        ult: {
          name: '珊瑚掌', tags: ['群攻', '控制'], fx: 'water', target: 'all',
          desc: '掌中生出急速生长的珊瑚将敌人包覆，对全体敌人造成170%攻击力伤害，并有70%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.7 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.7 }
          ]
        },
        awaken: {
          name: '尾兽化·矶抚', tags: ['护盾', '增益'],
          desc: '防御力+12%，攻击力+8%；生命值首次低于30%时化身三尾矶抚，获得30%最大生命值的护盾并免疫控制，持续2回合。',
          stats: { def: 0.12, atk: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'shield', pct: 0.3, turns: 2 },
            { type: 'immune', turns: 2 }
          ] }]
        }
      }
    },

    {
      id: 'gengetsu', name: '鬼灯幻月', form: '二代目水影', en: 'Hozuki Gengetsu', title: '幻影之水影',
      faction: 'kiri', rarity: 'SSR', role: 'ctrl', element: 'water', tags: ['控制', '闪避', '群攻'],
      stats: { hp: 1.0, atk: 1.08, def: 0.95, spd: 108 },
      bio: '第二代水影，出身鬼灯一族，能以水化之术让身体化为液态，并擅长借大蛤蜊“蜃”吐出的雾气施展幻术。生前与二代目土影无同归于尽，第四次忍界大战中被秽土转生。',
      quote: '战斗也要优雅地享受才行。',
      art: {
        type: 'human', skin: '#efdccb', hair: 'spiky_up', hairColor: '#d6e0e6',
        eyes: 'normal', eyeColor: '#2f3a4a', outfit: 'kage', outfitColor: '#e8eef2', accentColor: KIRI_BLUE,
        headband: 'none', marks: ['fangs'], mask: 'none', hat: 'none', accessory: 'none', aura: '#4fc3f7'
      },
      skills: {
        passive: {
          name: '水化之术', tags: ['闪避', '增益'],
          desc: '鬼灯一族的秘术，能将身体化为液态让攻击穿身而过：闪避率+12%，受到的伤害-8%。',
          stats: { dodge: 0.12, dr: 0.08 }
        },
        s1: {
          name: '水铁炮之术', tags: ['输出', '穿透'], fx: 'water', target: 'single', cd: 0,
          desc: '以手指为枪口射出高压水弹，造成115%攻击力伤害（无视20%防御）。',
          effects: [{ type: 'dmg', mult: 1.15, pierce: 0.2 }]
        },
        s2: {
          name: '蜃气楼', tags: ['控制', '群攻'], fx: 'genjutsu', target: 'all', cd: 3,
          desc: '大蛤蜊“蜃”吐出幻雾制造海市蜃楼，对全体敌人造成80%攻击力伤害，并有40%概率使其陷入睡眠1回合。',
          effects: [
            { type: 'dmg', mult: 0.8 },
            { type: 'status', status: 'sleep', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '自爆分身之术', tags: ['群攻', '爆发', '控制'], fx: 'explosion', target: 'all',
          desc: '让分身冲入敌阵后自爆，对全体敌人造成2段共190%攻击力伤害，并有50%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.95, hits: 2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.5 }
          ]
        },
        awaken: {
          name: '口寄·蒸危暴威', tags: ['召唤', '持续'],
          desc: '攻击力+12%；施放必杀技后，通灵出体内充满高温蒸汽的巨人“蒸危暴威”扑向一名敌人，造成120%攻击力伤害，并使其灼烧2回合（每回合35%攻击力）。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [
            { type: 'dmg', mult: 1.2 },
            { type: 'status', status: 'burn', turns: 2, value: 0.35 }
          ] }]
        }
      }
    },

    {
      id: 'mangetsu', name: '鬼灯满月', form: '', en: 'Hozuki Mangetsu', title: '天才剑士',
      faction: 'kiri', rarity: 'SR', role: 'atk', element: 'water', tags: ['输出', '穿透', '闪避'],
      stats: { hp: 0.95, atk: 1.15, def: 0.92, spd: 120 },
      bio: '鬼灯水月的哥哥，被誉为“鬼人再来”的天才。据说他能自如运用忍刀七人众的全部七把忍刀，是弟弟水月一直追赶的目标。',
      quote: '七把忍刀，我全都用得来。',
      art: {
        type: 'human', skin: '#f0dfd0', hair: 'shaggy', hairColor: '#e6eef2',
        eyes: 'normal', eyeColor: '#6b4aa0', outfit: 'sleeveless', outfitColor: '#34465a', accentColor: '#8fa3b5',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: ['fangs'], mask: 'none', hat: 'none', accessory: 'big_sword', aura: '#4fc3f7'
      },
      skills: {
        passive: {
          name: '水化之术', tags: ['闪避', '治疗'],
          desc: '鬼灯一族的秘术：闪避率+10%；受到攻击时有25%概率将身体液化后重组，恢复6%最大生命值。',
          stats: { dodge: 0.10 },
          triggers: [{ on: 'on_hit', chance: 0.25, effects: [{ type: 'heal', pct: 0.06 }] }]
        },
        s1: {
          name: '斩首大刀', tags: ['输出', '吸血'], fx: 'blade', target: 'single', cd: 0,
          desc: '挥动斩首大刀劈砍，造成115%攻击力伤害，并恢复相当于造成伤害10%的生命值。',
          effects: [
            { type: 'dmg', mult: 1.15 },
            { type: 'lifesteal', value: 0.1 }
          ]
        },
        s2: {
          name: '爆刀·飞沫', tags: ['群攻', '持续'], fx: 'explosion', target: 'all', cd: 3,
          desc: '换上爆刀·飞沫横扫敌阵引发爆炸，对全体敌人造成90%攻击力伤害，并有30%概率使其灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.9 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        ult: {
          name: '七忍刀', tags: ['群攻', '爆发', '穿透'], fx: 'blade', target: 'all',
          desc: '轮番挥舞忍刀七人众的全部七把忍刀，对全体敌人造成7段共182%攻击力伤害（无视30%防御）。',
          effects: [{ type: 'dmg', mult: 0.26, hits: 7, pierce: 0.3 }]
        },
        awaken: {
          name: '鬼人再来', tags: ['增益', '回能'],
          desc: '攻击力+12%，暴击率+8%；击败敌人后获得30点查克拉。',
          stats: { atk: 0.12, crit: 0.08 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'chakra', value: 30 }] }]
        }
      }
    },

    {
      id: 'kushimaru', name: '栗霰串丸', form: '', en: 'Kuriarare Kushimaru', title: '无声暗杀者',
      faction: 'kiri', rarity: 'SR', role: 'ctrl', element: 'water', tags: ['控制', '穿透', '群攻'],
      stats: { hp: 0.92, atk: 1.12, def: 0.95, spd: 122 },
      bio: '忍刀七人众之一，长刀·缝针的持有者，擅长在雾中施展无声杀人术。缝针能拖着钢丝贯穿多名敌人，将他们像布料一样缝在一起，大战中被秽土转生召唤。',
      quote: '一针，就能把你们全都缝起来。',
      art: {
        type: 'human', skin: '#e6d6c6', hair: 'long_straight', hairColor: '#2a2a33',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'robe', outfitColor: '#4a4f5a', accentColor: '#9aa3ad',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'cloth', maskColor: '#d8d8d8', hat: 'none', accessory: 'sword', aura: '#cfd8dc'
      },
      skills: {
        passive: {
          name: '无声杀人术', tags: ['增益', '闪避'],
          desc: '精通雾中的无声杀人术：暴击率+10%，暴击伤害+20%；战斗开始时闪避率提升15%，持续2回合。',
          stats: { crit: 0.10, critDmg: 0.20 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'buff', stat: 'dodge', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '长刀·缝针', tags: ['消耗', '穿透'], fx: 'blade', target: 'single', cd: 0,
          desc: '以细长的缝针刺穿敌人，造成110%攻击力伤害（无视30%防御）。',
          effects: [{ type: 'dmg', mult: 1.1, pierce: 0.3 }]
        },
        s2: {
          name: '缝针·穿缝', tags: ['控制', '群攻'], fx: 'blade', target: 'random', count: 3, cd: 3,
          desc: '缝针拖着钢丝连续贯穿随机3名敌人并将其缝在一起，各造成60%攻击力伤害，并有40%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.6 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.4 }
          ]
        },
        ult: {
          name: '缝针·大缝合', tags: ['群攻', '控制', '穿透'], fx: 'blade', target: 'all',
          desc: '让缝针在敌阵中来回穿梭缝合，对全体敌人造成2段共160%攻击力伤害（无视30%防御），并有60%概率使其束缚1回合。',
          effects: [
            { type: 'dmg', mult: 0.8, hits: 2, pierce: 0.3 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.6 }
          ]
        },
        awaken: {
          name: '暗杀之道', tags: ['增益', '回能'],
          desc: '攻击力+12%；击败敌人后攻击力提升20%（持续2回合），并获得20点查克拉。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_kill', effects: [
            { type: 'buff', stat: 'atk', value: 0.2, turns: 2 },
            { type: 'chakra', value: 20 }
          ] }]
        }
      }
    },

    {
      id: 'jinin', name: '通草野饵人', form: '', en: 'Akebino Jinin', title: '破甲之鬼',
      faction: 'kiri', rarity: 'SR', role: 'atk', element: 'none', tags: ['穿透', '减益', '爆发'],
      stats: { hp: 1.05, atk: 1.1, def: 0.9, spd: 100 },
      bio: '忍刀七人众之一，钝刀·兜割的持有者。兜割由斧刃与铁锤组成，号称能击碎任何防御，大战中被秽土转生召唤，与忍者联军交战。',
      quote: '没有我砸不碎的防御！',
      art: {
        type: 'human', skin: '#d8b896', hair: 'short', hairColor: '#3a2e28',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'sleeveless', outfitColor: '#5a4a3c', accentColor: '#8d6e63',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'big_sword', aura: '#8d6e63'
      },
      skills: {
        passive: {
          name: '无坚不摧', tags: ['穿透', '减益'],
          desc: '兜割号称能击碎任何防御：攻击力+6%；攻击命中后有30%概率降低目标15%防御，持续2回合。',
          stats: { atk: 0.06 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'debuff', stat: 'def', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '钝刀·兜割', tags: ['穿透', '消耗'], fx: 'blade', target: 'single', cd: 0,
          desc: '以兜割的斧刃劈砍敌人，造成115%攻击力伤害（无视25%防御）。',
          effects: [{ type: 'dmg', mult: 1.15, pierce: 0.25 }]
        },
        s2: {
          name: '兜割·破盾', tags: ['爆发', '减益'], fx: 'blade', target: 'single', cd: 3,
          desc: '先以斧刃劈开防御，再用铁锤猛砸：清除目标的所有增益与护盾，并造成180%攻击力伤害。',
          effects: [
            { type: 'dispel' },
            { type: 'dmg', mult: 1.8 }
          ]
        },
        ult: {
          name: '兜割·粉碎一击', tags: ['爆发', '穿透', '单体'], fx: 'earth', target: 'single',
          desc: '将全身力量灌入钝刀全力砸下，造成320%攻击力伤害（无视50%防御），并降低目标25%防御，持续2回合。',
          effects: [
            { type: 'dmg', mult: 3.2, pierce: 0.5 },
            { type: 'debuff', stat: 'def', value: 0.25, turns: 2 }
          ]
        },
        awaken: {
          name: '粉碎之力', tags: ['减益', '增益'],
          desc: '攻击力+12%；施放必杀技后，砸击的震荡波使全体敌人防御降低15%，持续2回合。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_ult', effects: [{ type: 'debuff', stat: 'def', value: 0.15, turns: 2, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'jinpachi', name: '无梨甚八', form: '', en: 'Munashi Jinpachi', title: '爆刀狂人',
      faction: 'kiri', rarity: 'SR', role: 'atk', element: 'fire', tags: ['群攻', '爆发', '持续'],
      stats: { hp: 0.95, atk: 1.15, def: 0.92, spd: 106 },
      bio: '忍刀七人众之一，爆刀·飞沫的持有者。飞沫的刀身贴满起爆符，每次斩击都会引发爆炸，大战中被秽土转生召唤。',
      quote: '一刀下去，全都给我炸飞！',
      art: {
        type: 'human', skin: '#e0c2a2', hair: 'wild_long', hairColor: '#2f2a28',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'robe', outfitColor: '#6b3a2a', accentColor: '#e0a030',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'big_sword', aura: '#ffca28'
      },
      skills: {
        passive: {
          name: '起爆符', tags: ['持续', '爆发'],
          desc: '刀身贴满了起爆符：暴击伤害+20%；攻击命中后有25%概率使目标灼烧2回合（每回合30%攻击力）。',
          stats: { critDmg: 0.20 },
          triggers: [{ on: 'on_attack', chance: 0.25, effects: [{ type: 'status', status: 'burn', turns: 2, value: 0.3 }] }]
        },
        s1: {
          name: '爆刀·飞沫', tags: ['输出', '爆发'], fx: 'explosion', target: 'single', cd: 0,
          desc: '挥下爆刀·飞沫引爆刀身的起爆符，造成120%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 1.2 }]
        },
        s2: {
          name: '飞沫·连爆', tags: ['群攻'], fx: 'explosion', target: 'all', cd: 3,
          desc: '连续挥刀引发一连串爆炸，对全体敌人造成2段共100%攻击力伤害。',
          effects: [{ type: 'dmg', mult: 0.5, hits: 2 }]
        },
        ult: {
          name: '飞沫·大爆破', tags: ['群攻', '爆发', '持续'], fx: 'explosion', target: 'all',
          desc: '一口气引爆刀身全部的起爆符，对全体敌人造成2段共190%攻击力伤害，并使其灼烧2回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.95, hits: 2 },
            { type: 'status', status: 'burn', turns: 2, value: 0.35 }
          ]
        },
        awaken: {
          name: '连锁爆炸', tags: ['群攻', '爆发'],
          desc: '攻击力+12%，暴击率+6%；击败敌人时引发连锁爆炸，对全体敌人造成60%攻击力伤害。',
          stats: { atk: 0.12, crit: 0.06 },
          triggers: [{ on: 'on_kill', effects: [{ type: 'dmg', mult: 0.6, to: 'enemy_all' }] }]
        }
      }
    },

    {
      id: 'ameyuri', name: '林檎雨由利', form: '', en: 'Ringo Ameyuri', title: '雷之双牙',
      faction: 'kiri', rarity: 'SR', role: 'atk', element: 'lightning', tags: ['输出', '控制', '穿透'],
      stats: { hp: 0.92, atk: 1.15, def: 0.95, spd: 126 },
      bio: '忍刀七人众中的女剑士，雷刀·牙的持有者。牙是一对能导引雷遁查克拉的双刀，被誉为忍刀中最锋利的刀，大战中被秽土转生召唤。',
      quote: '我的雷刀，可是会咬人的哦。',
      art: {
        type: 'human', skin: '#f2d8c2', hair: 'messy', hairColor: '#c8502a',
        eyes: 'normal', eyeColor: '#3b5a3b', outfit: 'sleeveless', outfitColor: '#363b52', accentColor: '#7fb8ff',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: ['fangs'], mask: 'none', hat: 'none', accessory: 'sword', aura: '#6ec6ff'
      },
      skills: {
        passive: {
          name: '冠绝之锋', tags: ['增益'],
          desc: '牙是锋利程度冠绝忍刀的双刀：暴击率+12%，速度+6%。',
          stats: { crit: 0.12, spd: 0.06 }
        },
        s1: {
          name: '雷刀·牙', tags: ['输出', '控制'], fx: 'lightning', target: 'single', cd: 0,
          desc: '双刀交错斩击，造成2段共120%攻击力伤害，并有20%概率使目标麻痹而眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.6, hits: 2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.2 }
          ]
        },
        s2: {
          name: '雷刀·双牙突', tags: ['爆发', '穿透'], fx: 'lightning', target: 'single', cd: 3,
          desc: '将雷遁查克拉导入双刀刺穿敌人，造成200%攻击力伤害（无视30%防御）。',
          effects: [{ type: 'dmg', mult: 2.0, pierce: 0.3 }]
        },
        ult: {
          name: '雷刀·落雷', tags: ['群攻', '控制', '爆发'], fx: 'lightning', target: 'all',
          desc: '高举双刀引来落雷轰击敌阵，对全体敌人造成2段共170%攻击力伤害，并有40%概率使其眩晕1回合。',
          effects: [
            { type: 'dmg', mult: 0.85, hits: 2 },
            { type: 'status', status: 'stun', turns: 1, chance: 0.4 }
          ]
        },
        awaken: {
          name: '雷光双刃', tags: ['输出'],
          desc: '攻击力+12%；攻击命中后有30%概率追加一道雷击，造成40%攻击力伤害。',
          stats: { atk: 0.12 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'dmg', mult: 0.4 }] }]
        }
      }
    },

    {
      id: 'fuguki', name: '西瓜山河豚鬼', form: '', en: 'Suikazan Fuguki', title: '鲛肌的前主人',
      faction: 'kiri', rarity: 'SR', role: 'tank', element: 'water', tags: ['吸血', '嘲讽', '护盾'],
      stats: { hp: 1.15, atk: 1.0, def: 0.9, spd: 88 },
      bio: '忍刀七人众之一，大刀·鲛肌的前任持有者。因暗中向敌国泄露雾隐的情报，被奉命监视他的干柿鬼鲛杀害，鲛肌也就此易主。',
      quote: '鲛肌会把你的查克拉吃得一干二净。',
      art: {
        type: 'human', skin: '#c9b4a2', hair: 'wild_long', hairColor: '#3d3f46',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'robe', outfitColor: '#4c5a6a', accentColor: '#8aa1b5',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'none', hat: 'none', accessory: 'samehada', aura: '#3a8dff'
      },
      skills: {
        passive: {
          name: '查克拉吞噬', tags: ['吸血', '回能'],
          desc: '与鲛肌心意相通：吸血+12%；受到攻击时有30%概率吸取攻击者10点查克拉。',
          stats: { lifesteal: 0.12 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'drain', value: 10, to: 'attacker' }] }]
        },
        s1: {
          name: '大刀·鲛肌', tags: ['消耗', '吸血'], fx: 'blade', target: 'single', cd: 0,
          desc: '以鲛肌削开敌人的皮肉，造成105%攻击力伤害，并吸取目标10点查克拉。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'drain', value: 10 }
          ]
        },
        s2: {
          name: '鲛肌之壁', tags: ['嘲讽', '护盾'], fx: 'shield', target: 'self', cd: 3,
          desc: '竖起鲛肌挡在队伍前方：嘲讽全体敌人2回合，并获得15%最大生命值的护盾，持续2回合。',
          effects: [
            { type: 'taunt', turns: 2 },
            { type: 'shield', pct: 0.15, turns: 2 }
          ]
        },
        ult: {
          name: '鲛肌·大吞噬', tags: ['群攻', '吸血', '回能'], fx: 'blade', target: 'all',
          desc: '鲛肌张开利齿扫过敌阵，对全体敌人造成150%攻击力伤害并吸取每人20点查克拉，自身恢复相当于造成伤害40%的生命值。',
          effects: [
            { type: 'dmg', mult: 1.5 },
            { type: 'drain', value: 20 },
            { type: 'lifesteal', value: 0.4 }
          ]
        },
        awaken: {
          name: '鲛肌之主', tags: ['治疗', '回能'],
          desc: '生命值+10%，攻击力+8%；生命值首次低于30%时，鲛肌吞噬查克拉为主人疗伤：恢复25%最大生命值，并吸取全体敌人15点查克拉。',
          stats: { hp: 0.10, atk: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.25 },
            { type: 'drain', value: 15, to: 'enemy_all' }
          ] }]
        }
      }
    },

    {
      id: 'utakata', name: '空', form: '六尾人柱力', en: 'Utakata', title: '泡遁使者',
      faction: 'kiri', rarity: 'SR', role: 'ctrl', element: 'water', tags: ['控制', '持续', '减益'],
      stats: { hp: 1.0, atk: 1.05, def: 0.98, spd: 106 },
      bio: '雾隐的叛忍，六尾犀犬的人柱力，以烟管吹出的泡泡施展泡遁。因怀疑师父想抽出自己体内的尾兽而离开雾隐，最终被晓组织的佩恩捕获。',
      quote: '泡沫转瞬即逝，人生也是一样。',
      art: {
        type: 'human', skin: '#f1dac8', hair: 'long_bang', hairColor: '#22303e',
        eyes: 'normal', eyeColor: '#6b5a3a', outfit: 'kimono', outfitColor: '#d4d8da', accentColor: '#3a4a6a',
        headband: 'none', marks: [], mask: 'none', hat: 'none', accessory: 'kiseru', aura: '#b3e5fc'
      },
      skills: {
        passive: {
          name: '六尾人柱力', tags: ['持续', '增益'],
          desc: '体内的犀犬能分泌腐蚀一切的溶解液：生命值+8%；受到攻击时有30%概率使攻击者中毒2回合（每回合25%攻击力）。',
          stats: { hp: 0.08 },
          triggers: [{ on: 'on_hit', chance: 0.3, effects: [{ type: 'status', status: 'poison', turns: 2, value: 0.25, to: 'attacker' }] }]
        },
        s1: {
          name: '泡遁·爆裂泡', tags: ['消耗', '持续'], fx: 'water', target: 'single', cd: 0,
          desc: '以烟管吹出会爆炸的泡泡，造成2段共110%攻击力伤害，并有30%概率使目标灼烧2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.55, hits: 2 },
            { type: 'status', status: 'burn', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '泡遁·睡泡', tags: ['控制', '群攻'], fx: 'water', target: 'all', cd: 3,
          desc: '吹出大量飘浮的泡泡笼罩敌阵，对全体敌人造成70%攻击力伤害，并有45%概率使其陷入睡眠1回合。',
          effects: [
            { type: 'dmg', mult: 0.7 },
            { type: 'status', status: 'sleep', turns: 1, chance: 0.45 }
          ]
        },
        ult: {
          name: '犀犬·溶解液', tags: ['群攻', '持续', '减益'], fx: 'poison', target: 'all',
          desc: '借犀犬之力喷出强碱溶解液，对全体敌人造成2段共170%攻击力伤害，降低其15%防御（持续2回合），并使其中毒2回合（每回合40%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.85, hits: 2 },
            { type: 'debuff', stat: 'def', value: 0.15, turns: 2 },
            { type: 'status', status: 'poison', turns: 2, value: 0.4 }
          ]
        },
        awaken: {
          name: '尾兽化·犀犬', tags: ['治疗', '持续'],
          desc: '攻击力+10%，防御力+8%；生命值首次低于30%时化身六尾犀犬：恢复25%最大生命值、解除自身的减益与异常状态，并使全体敌人中毒2回合（每回合30%攻击力）。',
          stats: { atk: 0.10, def: 0.08 },
          triggers: [{ on: 'low_hp', effects: [
            { type: 'heal', pct: 0.25 },
            { type: 'cleanse' },
            { type: 'status', status: 'poison', turns: 2, value: 0.3, to: 'enemy_all' }
          ] }]
        }
      }
    },

    {
      id: 'gozu', name: '合头', form: '鬼兄弟', en: 'Gozu', title: '锁链杀手',
      faction: 'kiri', rarity: 'R', role: 'ctrl', element: 'water', tags: ['控制', '持续'],
      stats: { hp: 1.0, atk: 1.05, def: 0.95, spd: 110 },
      bio: '雾隐的叛忍，再不斩的部下，与冥头合称“鬼兄弟”。两人以一条带刃的锁链相连，曾伪装成路边的水洼伏击第七班，却被卡卡西轻松制服。',
      quote: '下一个就轮到你了！',
      art: {
        type: 'human', skin: '#d9c2a8', hair: 'short', hairColor: '#2a2a2a',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'cloak', outfitColor: '#4a5045', accentColor: '#8a8f80',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'lower', maskColor: '#3a3f48', hat: 'horns', hornColor: '#e8e8e8', accessory: 'none', aura: '#90a4ae'
      },
      skills: {
        passive: {
          name: '锁链连携', tags: ['减益'],
          desc: '与冥头以锁链默契配合：防御力+6%；攻击命中后有20%概率降低目标15%速度，持续2回合。',
          stats: { def: 0.06 },
          triggers: [{ on: 'on_attack', chance: 0.2, effects: [{ type: 'debuff', stat: 'spd', value: 0.15, turns: 2 }] }]
        },
        s1: {
          name: '锁链爪', tags: ['控制', '消耗'], fx: 'blade', target: 'single', cd: 0,
          desc: '甩出连接兄弟二人的带刃锁链撕扯敌人，造成100%攻击力伤害，并有30%概率使目标束缚1回合。',
          effects: [
            { type: 'dmg', mult: 1.0 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.3 }
          ]
        },
        s2: {
          name: '锁链·绞杀', tags: ['爆发', '持续'], fx: 'blade', target: 'single', cd: 3,
          desc: '以锁链缠住目标并猛然绞紧，造成170%攻击力伤害，并使其流血2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.7 },
            { type: 'status', status: 'bleed', turns: 2, value: 0.3 }
          ]
        },
        ult: {
          name: '鬼兄弟·合击', tags: ['控制', '单体'], fx: 'blade', target: 'single',
          desc: '与冥头一左一右以锁链夹击，造成270%攻击力伤害，并有70%概率使目标束缚1回合。',
          effects: [
            { type: 'dmg', mult: 2.7 },
            { type: 'status', status: 'bind', turns: 1, chance: 0.7 }
          ]
        },
        awaken: {
          name: '鬼兄弟之绊', tags: ['增益'],
          desc: '攻击力+10%；友方阵亡时怒火中烧，攻击力提升30%，持续3回合。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_ally_death', effects: [{ type: 'buff', stat: 'atk', value: 0.3, turns: 3 }] }]
        }
      }
    },

    {
      id: 'meizu', name: '冥头', form: '鬼兄弟', en: 'Meizu', title: '毒爪杀手',
      faction: 'kiri', rarity: 'R', role: 'atk', element: 'water', tags: ['持续', '输出'],
      stats: { hp: 0.95, atk: 1.1, def: 0.95, spd: 112 },
      bio: '雾隐的叛忍，再不斩的部下，与合头合称“鬼兄弟”。兄弟俩手甲上的利爪淬有剧毒，鸣人被划伤后不得不用苦无刺破手背放出毒血。',
      quote: '被我的毒爪划到，你就完了。',
      art: {
        type: 'human', skin: '#d9c2a8', hair: 'short', hairColor: '#2a2a2a',
        eyes: 'normal', eyeColor: '#2b2b2b', outfit: 'cloak', outfitColor: '#3f454e', accentColor: '#7cb342',
        headband: 'kiri', headbandSlash: false, headbandPos: 'forehead',
        marks: [], mask: 'lower', maskColor: '#3a3f48', hat: 'horns', hornColor: '#e8e8e8', accessory: 'none', aura: '#7cb342'
      },
      skills: {
        passive: {
          name: '水洼伏击', tags: ['爆发', '增益'],
          desc: '伪装成路边的水洼伺机偷袭：速度+6%；战斗开始时突袭随机一名敌人，造成60%攻击力伤害。',
          stats: { spd: 0.06 },
          triggers: [{ on: 'battle_start', effects: [{ type: 'dmg', mult: 0.6 }] }]
        },
        s1: {
          name: '毒爪', tags: ['持续', '消耗'], fx: 'beast', target: 'single', cd: 0,
          desc: '以淬毒的手甲利爪划伤敌人，造成105%攻击力伤害，并有30%概率使其中毒2回合（每回合30%攻击力）。',
          effects: [
            { type: 'dmg', mult: 1.05 },
            { type: 'status', status: 'poison', turns: 2, chance: 0.3, value: 0.3 }
          ]
        },
        s2: {
          name: '毒爪·连击', tags: ['持续', '爆发'], fx: 'poison', target: 'single', cd: 3,
          desc: '双爪连续撕裂目标，造成3段共165%攻击力伤害，并使其中毒2回合（每回合35%攻击力）。',
          effects: [
            { type: 'dmg', mult: 0.55, hits: 3 },
            { type: 'status', status: 'poison', turns: 2, value: 0.35 }
          ]
        },
        ult: {
          name: '剧毒之爪', tags: ['斩杀', '持续', '单体'], fx: 'poison', target: 'lowest',
          desc: '扑向生命值比例最低的敌人：造成260%攻击力伤害并使其中毒3回合（每回合40%攻击力）；若其生命值低于30%，额外受到80%攻击力的斩杀伤害。',
          effects: [
            { type: 'dmg', mult: 2.6 },
            { type: 'status', status: 'poison', turns: 3, value: 0.4 },
            { type: 'execute', threshold: 0.3, mult: 0.8 }
          ]
        },
        awaken: {
          name: '猛毒手甲', tags: ['持续', '增益'],
          desc: '攻击力+10%；攻击命中后有30%概率使目标中毒2回合（每回合35%攻击力）。',
          stats: { atk: 0.10 },
          triggers: [{ on: 'on_attack', chance: 0.3, effects: [{ type: 'status', status: 'poison', turns: 2, value: 0.35 }] }]
        }
      }
    }
  ]);
})();
