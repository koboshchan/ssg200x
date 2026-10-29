// Play-money cents. The third forced bet is a live UTG straddle, not an ante.
export const POKER_STAKES = {
 '01': {label:'Low',small:100,big:200,straddle:500},
 '02': {label:'Medium',small:1000,big:2000,straddle:5000},
 '03': {label:'High',small:5000,big:10000,straddle:20000},
} as const;
export function pokerStakes(id:keyof typeof POKER_STAKES='01'){return POKER_STAKES[id];}
export function pokerStakesLabel(id:keyof typeof POKER_STAKES){const s=pokerStakes(id);return '$'+s.small/100+' / $'+s.big/100+' / $'+s.straddle/100;}
export function pokerStakesRules(id:keyof typeof POKER_STAKES){const s=pokerStakes(id);return '$'+s.small/100+' small blind, $'+s.big/100+' big blind, $'+s.straddle/100+' live UTG straddle with 3+ players. Heads-up is $'+s.small/100+'/$'+s.big/100+'. No rake.';}
