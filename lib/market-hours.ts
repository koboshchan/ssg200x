import type {StockExecutionState} from "./stock-policy";
// Shared browser-safe implementation also used by the native JS socket server.
// @ts-expect-error Native runtime module intentionally has no generated declaration.
import {stockCalendarHours} from "../runtime/market-payload.mjs";
export type MarketHours={
 calendarAvailable:boolean;closed:boolean|null;nextOpen:number|null;
 sessionOpen:number|null;sessionClose:number|null;validUntil:number;
 timeZone:"America/New_York";
};
export type MarketClosedState={closed:boolean|null;nextOpen:number|null;label:string};
/** Provider sessions and clock only. Never a weekday/holiday approximation. */
export function stockMarketHours(state:Pick<StockExecutionState,"clock"|"sessions">|undefined,now=Date.now()):MarketHours {
 return stockCalendarHours(state,now) as MarketHours;
}
const ny=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
function parts(now:number){return Object.fromEntries(ny.formatToParts(now).map(p=>[p.type,p.value]));}
/** Convert a local ET date/time using the offset at the target date, not today's. */
function easternEpoch(year:number,month:number,day:number,hour:number){
 const target=Date.UTC(year,month-1,day,hour);let epoch=target;
 for(let i=0;i<3;i++){const p=parts(epoch);epoch+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);}
 return epoch;
}
/** Weekly FX session, Friday 17:00 ET through Sunday 17:00 ET closed. */
export function forexMarketHours(now=Date.now()):MarketHours {
 const base={sessionOpen:null,sessionClose:null,timeZone:"America/New_York" as const};
 if(!Number.isFinite(now))return {...base,calendarAvailable:false,closed:null,nextOpen:null,validUntil:0};
 const p=parts(now),weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(p.weekday);
 const closed=weekday===6||(weekday===5&&+p.hour>=17)||(weekday===0&&+p.hour<17);
 const daysToSunday=(7-weekday)%7;
 const sunday=easternEpoch(+p.year,+p.month,+p.day+daysToSunday,17);
 const daysToFriday=(5-weekday+7)%7;
 const friday=easternEpoch(+p.year,+p.month,+p.day+daysToFriday,17);
 return {...base,calendarAvailable:true,closed,nextOpen:closed?sunday:null,sessionClose:closed?null:friday,validUntil:closed?sunday:friday};
}
const opensAt=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
/** Explicit ET avoids interpreting the reopening time in the viewer's timezone. */
export function marketClosedLabel(nextOpen:number|null){
 return nextOpen!==null&&Number.isFinite(nextOpen)?"Market closed, opens "+opensAt.format(nextOpen)+" ET":"Market closed";
}
/** No input mutation, provider I/O, quote replacement, or execution authorization. */
export function marketClosedState(kind:"stocks"|"forex",hours:MarketHours|undefined,now=Date.now()):MarketClosedState {
 const h=kind==="forex"?forexMarketHours(now):hours;
 if(!Number.isFinite(now)||!h?.calendarAvailable||now>=h.validUntil)
  return {closed:null,nextOpen:null,label:"Market calendar unavailable"};
 if(h.closed===null)return {closed:null,nextOpen:null,label:"Market calendar unavailable"};
 return {closed:h.closed,nextOpen:h.nextOpen,label:h.closed?marketClosedLabel(h.nextOpen):""};
}
