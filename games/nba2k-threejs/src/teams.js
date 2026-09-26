// Fictional teams and rosters (spec section 13). This is the only src file besides i18n.js allowed CJK text.
// Ratings: speed multiplies max speeds, shooting is the make-probability rating, defense multiplies steal
// chance and shrinks contest distance, dunk >= 0.6 enables dunks, height multiplies the rebound catch radius.
export const TEAMS = [
  { id:'HBT', name:{zh:'海城潮汐', en:'Harbor Tide'},   jersey:0x1e6fd9, shorts:0x0f3a75,
    players:[ {name:{zh:'林海',en:'Lin Hai'},   num:7,  speed:1.08, shooting:1.08, defense:0.95, dunk:0.4, height:0.95},
              {name:{zh:'周潮',en:'Zhou Chao'}, num:11, speed:1.02, shooting:0.98, defense:1.00, dunk:0.7, height:1.00},
              {name:{zh:'石岳',en:'Shi Yue'},   num:23, speed:0.92, shooting:0.92, defense:1.08, dunk:0.9, height:1.10} ] },
  { id:'RRF', name:{zh:'赤岩火狐', en:'Redrock Foxes'}, jersey:0xd9341e, shorts:0x7a1a0e,
    players:[ {name:{zh:'赵炎',en:'Zhao Yan'},  num:3,  speed:1.10, shooting:1.04, defense:0.94, dunk:0.5, height:0.94},
              {name:{zh:'胡烈',en:'Hu Lie'},    num:9,  speed:1.00, shooting:1.00, defense:1.02, dunk:0.8, height:1.02},
              {name:{zh:'岩铮',en:'Yan Zheng'}, num:31, speed:0.90, shooting:0.90, defense:1.10, dunk:0.9, height:1.12} ] },
];
