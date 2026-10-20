/** Shared server-anchored presentation contract. No client chooses a result. */
export const ROULETTE_OPEN_MS=55_000;
export const ROULETTE_MS=60_000; // Spin may begin only after the five-second lock.
export const ROULETTE_SPIN_MS=12_000;
export const ROULETTE_RESULT_MS=5_000;
export const WHEEL_POCKETS=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26] as const;
export type RouletteSpin={round:number;number:number;startedAt:number;resultAt:number;nextAt:number};
export type RoulettePhase='betting'|'locked'|'spinning'|'result';
export type RouletteClock={locksAt:number;spinsAt:number;spin:RouletteSpin|null};
export function roulettePhase(clock:RouletteClock,now:number):RoulettePhase{
 if(clock.spin)return now<clock.spin.resultAt?'spinning':'result';
 return now<clock.locksAt?'betting':'locked';
}
export function phaseDeadline(clock:RouletteClock,now:number):number{
 const phase=roulettePhase(clock,now);
 return phase==='betting'?clock.locksAt:phase==='locked'?clock.spinsAt:phase==='spinning'?clock.spin!.resultAt:clock.spin!.nextAt;
}
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
/** Absolute poses make late joins, remounts and duplicate state frames seek, not replay.
 * Counter-rotating ball loses speed into its pocket while the rotor coasts to rest. */
export function wheelPose(spin:RouletteSpin,now:number,reducedMotion=false){
 const progress=clamp((now-spin.startedAt)/(spin.resultAt-spin.startedAt));
 const pocket=WHEEL_POCKETS.indexOf(spin.number as typeof WHEEL_POCKETS[number])*360/37;
 const ease=1-Math.pow(1-progress,3);
 const rotorEnd=720+(spin.round%7)*23;
 const ballEnd=rotorEnd+pocket-360*7;
 const drop=clamp((progress-.70)/.27);
 const radius=146-27*(drop*drop*(3-2*drop));
 if(reducedMotion)return {progress,rotor:rotorEnd,ball:ballEnd,radius:119};
 return {progress,rotor:rotorEnd*ease,ball:ballEnd*(1-Math.pow(1-progress,2.6)),radius};
}
