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
export type AdvancementState={streak:number;lastRound:number;unlocked:Record<string,number>};
