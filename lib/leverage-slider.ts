const stops=[1,2,3,4,5,6,7,8,9,10,15,20,25,30,40,50,60,75,100,125,150,175,200];
export const LEVERAGE_SLIDER_STEPS=1000;
export function leverageStops(max:number){
 return [...stops.filter(n=>n<max),max];
}
/** Thumb distance represents the ratio of leverage, not its absolute difference. */
export function leveragePosition(leverage:number,max:number){
 return max<=1?0:Math.log(Math.max(1,Math.min(max,leverage)))/Math.log(max)*LEVERAGE_SLIDER_STEPS;
}
export function leverageAtPosition(position:number,max:number){
 const raw=Math.max(0,Math.min(LEVERAGE_SLIDER_STEPS,position))/LEVERAGE_SLIDER_STEPS*Math.log(max);
 return leverageStops(max).reduce((best,n)=>Math.abs(Math.log(n)-raw)<Math.abs(Math.log(best)-raw)?n:best,1);
}
export function stepLeverage(leverage:number,max:number,direction:1|-1){
 const choices=leverageStops(max);
 return direction===1?choices.find(n=>n>leverage)??max:[...choices].reverse().find(n=>n<leverage)??1;
}
