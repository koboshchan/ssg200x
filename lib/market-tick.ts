import {isActiveSymbol} from "./market-shared";
import type {Room} from "./types";
import type {Quote} from "./finance";
import {settleTriggers} from "./position-triggers";
/** Run inside room CAS mutation so quote publication and settlements commit together. */
export function applyMarketTick(room:Room,quotes:Partial<Record<string,Quote>>,now=Date.now()){
 room.quotes??={};
 for(const [symbol,q] of Object.entries(quotes)){
  if(!isActiveSymbol(symbol)||!q||!Number.isSafeInteger(q.micro)||q.micro<=0||!Number.isSafeInteger(q.at)||q.at>now||now-q.at>10000)continue;
  const key=symbol as keyof typeof room.quotes,previous=room.quotes[key];
  if(!previous||q.at>previous.at)room.quotes[key]=q;
 }
 settleTriggers(room,now);
}
