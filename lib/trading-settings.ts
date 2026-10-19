import {ensure} from "./errors";
import {register} from "./poker";
import {pnlTriggerPrice,type TriggerBasis,type TriggerInputMode} from "./trigger-input";
import type {Room,Identity,Member} from "./types";
import type {TriggerPatch} from "./position-triggers";
export const triggerInputMode=(m:Member):TriggerInputMode=>m.settings?.triggerInputMode==="pnl"?"pnl":"price";
export function setTradingSettings(r:Room,who:Identity,mode:TriggerInputMode){
 ensure(mode==="price"||mode==="pnl","Invalid trigger input mode.");
 const member=register(r,who);member.settings={...member.settings,triggerInputMode:mode};
}
export type TriggerInput={triggerInputMode?:TriggerInputMode;takeProfit?:number|null;stopLoss?:number|null;takeProfitPnl?:number|null;stopLossPnl?:number|null};
export function resolveTriggerInput(m:Member,basis:TriggerBasis,input:TriggerInput):TriggerPatch{
 const mode=triggerInputMode(m);
 ensure(input.triggerInputMode===undefined||input.triggerInputMode===mode,"Trigger input mode changed. Reload your settings.",409);
 const wrong=mode==="price"?["takeProfitPnl","stopLossPnl"] as const:["takeProfit","stopLoss"] as const;
 ensure(wrong.every(key=>input[key]===undefined),"Trigger fields do not match your saved input mode.");
 const result:TriggerPatch={};
 for(const kind of ["takeProfit","stopLoss"] as const){
  const amount=input[mode==="price"?kind:kind==="takeProfit"?"takeProfitPnl":"stopLossPnl"];
  if(amount===undefined)continue;
  if(amount===null){result[kind]=null;continue;}
  ensure(Number.isSafeInteger(amount)&&amount>0,"Trigger must be a positive whole number.");
  try{result[kind]=mode==="price"?amount:pnlTriggerPrice(basis,amount,kind);}
  catch{ensure(false,"P/L amount produces an invalid trigger price.");}
 }
 return result;
}
