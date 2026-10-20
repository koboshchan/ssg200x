/** Both games enforce the full duration; the public warning only shows at 30%. */
export const ACTION_TURN_MS=100_000;
export function turnCountdown(deadline:number|null,now:number,totalMs=ACTION_TURN_MS):number|null{
 if(deadline===null)return null;
 const remaining=Math.max(0,deadline-now);
 return remaining<=totalMs*0.3?Math.ceil(remaining/1000):null;
}
/** Elapsed time is measured from receipt, never from the viewer's wall clock. */
export function serverClock(serverNow:number,receivedAt:number,now:number){
 return serverNow+Math.max(0,now-receivedAt);
}
