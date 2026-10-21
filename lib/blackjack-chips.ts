import {ROULETTE_CHIPS} from "./roulette-chips";
/** Only publish real, validated picker chips. Old/unsupported bets keep their cash total. */
export function blackjackChips(amount:number,chips?:unknown):number[]{
 const allowed=new Set<number>(ROULETTE_CHIPS.map(d=>d.value*100));
 if(Array.isArray(chips)&&chips.length>0&&chips.length<=2000&&chips.every(c=>Number.isSafeInteger(c)&&allowed.has(c))&&chips.reduce((n,c)=>n+c,0)===amount)return [...chips];
 return chips===undefined&&allowed.has(amount)?[amount]:[];
}
export function blackjackChipStacks(chips:readonly number[]){
 return ROULETTE_CHIPS.flatMap(d=>{
  const count=chips.filter(c=>c===d.value*100).length;
  return Array.from({length:Math.ceil(count/20)},(_,i)=>({value:d.value,color:d.color,count:Math.min(20,count-i*20)}));
 });
}
