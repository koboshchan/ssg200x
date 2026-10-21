export const LEVERAGE_SLIDER_STEPS=1000;
export function leverageStops(max:number){
 return Array.from({length:max},(_,i)=>i+1);
}
/** Thumb distance represents the ratio of leverage, not its absolute difference. */
export function leveragePosition(leverage:number,max:number){
 return max<=1?0:Math.log(Math.max(1,Math.min(max,leverage)))/Math.log(max)*LEVERAGE_SLIDER_STEPS;
}
export function leverageAtPosition(position:number,max:number){
 const raw=Math.max(0,Math.min(LEVERAGE_SLIDER_STEPS,position))/LEVERAGE_SLIDER_STEPS*Math.log(max);
 return Math.max(1,Math.min(max,Math.round(Math.exp(raw))));
}
export function stepLeverage(leverage:number,max:number,direction:1|-1){
 return Math.max(1,Math.min(max,leverage+direction));
}
