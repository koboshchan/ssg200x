/** Blackjack keeps its existing duration and 30% warning window. */
export const ACTION_TURN_MS=100_000;
export const POKER_TURN_MS=60_000, POKER_WARNING_MS=30_000;
export function turnCountdown(deadline:number|null,now:number,totalMs=ACTION_TURN_MS,warningMs=totalMs*0.3):number|null{
 if(deadline===null)return null;
 const remaining=Math.max(0,deadline-now);
 return remaining<=warningMs?Math.ceil(remaining/1000):null;
}
/** Elapsed time is measured from receipt, never from the viewer's wall clock. */
export function serverClock(serverNow:number,receivedAt:number,now:number){
 return serverNow+Math.max(0,now-receivedAt);
}
