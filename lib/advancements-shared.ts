export const ADVANCEMENTS=[
 {tier:7,name:"Seven Degrees of Misfortune",icon:"crack"},
 {tier:8,name:"Behind the Eight Ball",icon:"ball"},
 {tier:9,name:"Cloud Nine, No Silver Lining",icon:"cloud"},
 {tier:10,name:"A Perfect Ten of Bad Luck",icon:"target"},
 {tier:11,name:"Against All Odds",icon:"dice"},
 {tier:12,name:"Midnight at the Wheel",icon:"clock"},
 {tier:13,name:"Lucky Number Who?",icon:"clover"},
 {tier:14,name:"I'm super unlucky",icon:"crown"},
] as const;
export type AdvancementState={streak:number;lastRound:number;unlocked:Record<string,number>;counts?:Record<string,number>;rewarded?:Record<string,number>};

export const ADVANCEMENT_REWARDS_CENTS:Record<number,number>={7:10000,8:10000,9:20000,10:20000,11:25000,12:25000,13:50000,14:50000}; // Play-money cents, first unlock only.
export function advancementCount(state:AdvancementState,tier:number){return state.counts?.[tier]??(state.unlocked[tier]===undefined?0:1);}
