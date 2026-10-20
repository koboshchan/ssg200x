/** Shared server-anchored presentation contract. No client chooses a result. */
export const ROULETTE_OPEN_MS=55_000;
export const ROULETTE_MS=60_000; // Spin may begin only after the five-second lock.
export const ROULETTE_SPIN_MS=12_000;
export const ROULETTE_RESULT_MS=5_000;
export const WHEEL_POCKETS=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26] as const;
export type RouletteSpin={round:number;number:number;startedAt:number;resultAt:number;nextAt:number;fromRotation?:number};
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
/** Public round clock only: ambient rotation cannot encode an unchosen result. */
export function ambientWheelRotation(started:number,now:number,previous?:{number:number}){
 const pocket=previous?WHEEL_POCKETS.indexOf(previous.number as typeof WHEEL_POCKETS[number])*360/37:0;
 return -pocket+Math.max(0,now-started)*.1;
}
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
/** Reference sampling found a continuously clockwise ring and a roughly twelve-
 * second post-close coast/stop. This analytic stop is independently designed. */
export function wheelPose(spin:RouletteSpin,now:number,reducedMotion=false){
 const progress=clamp((now-spin.startedAt)/(spin.resultAt-spin.startedAt));
 const pocket=WHEEL_POCKETS.indexOf(spin.number as typeof WHEEL_POCKETS[number])*360/37;
 const from=spin.fromRotation??0;
 const end=from+720+((360-pocket-(from%360)+360)%360);
 const seconds=progress*12;
 // Preserve the ambient 100 deg/s velocity for five seconds, then monotonically
 // decay to zero over seven. Choose the exponent to land at the server pocket.
 const remaining=end-from-500;
 const power=700/remaining;
 const rotor=seconds<5?from+100*seconds:from+500+remaining*(1-Math.pow(1-(seconds-5)/7,power));
 return {progress,rotor:reducedMotion?end:rotor};
}
