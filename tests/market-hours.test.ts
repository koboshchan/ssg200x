import {test} from "node:test";
import assert from "node:assert/strict";
import {stockMarketHours,forexMarketHours,marketClosedState} from "../lib/market-hours";
import {stockPauseReason} from "../lib/stock-status";
import {parseStockCalendar,type StockClock} from "../lib/stock-session";
import {freshRoom,register} from "./helpers/crypto-room";
import {publicRoom} from "../lib/public";
// @ts-expect-error Native JS server module.
import {marketPayload,stockCalendarHours} from "../runtime/market-payload.mjs";
const epoch=Date.parse;
function provider(now:number,isOpen:boolean,nextOpen:number,nextClose:number,sessions:ReturnType<typeof parseStockCalendar>){
 const clock:StockClock={timestamp:now,receivedAt:now,isOpen,nextOpen,nextClose};
 return {clock,sessions};
}
// Supplied provider fixtures, not a holiday table or weekday calculation.
const holidayCalendar=parseStockCalendar([
 {date:"2026-11-25",open:"09:30",close:"16:00"},
 {date:"2026-11-27",open:"09:30",close:"13:00"},
 {date:"2026-11-30",open:"09:30",close:"16:00"},
]);
test("provider holiday omission and early close are authoritative",()=>{
 const now=epoch("2026-11-26T16:00:00Z"),next=epoch("2026-11-27T14:30:00Z"),close=epoch("2026-11-27T18:00:00Z");
 const state=provider(now,false,next,close,holidayCalendar);
 const h=stockMarketHours(state,now);
 assert.equal(h.closed,true);assert.equal(h.nextOpen,next);assert.equal(h.calendarAvailable,true);
 assert.deepEqual(h,stockCalendarHours(state,now));
 assert.match(marketClosedState("stocks",h,now).label,/Market closed, opens Fri, Nov 27.*9:30 AM ET/);
 const active=stockMarketHours(provider(close-1,true,holidayCalendar[2].open,close,holidayCalendar),close-1);
 assert.equal(active.closed,false);assert.equal(active.sessionClose,close);
 const closed=stockMarketHours(provider(close,false,holidayCalendar[2].open,holidayCalendar[2].close,holidayCalendar),close);
 assert.equal(closed.closed,true);assert.equal(closed.nextOpen,holidayCalendar[2].open);
});
test("stock calendar crosses weekend and DST using provider epochs",()=>{
 const sessions=parseStockCalendar([{date:"2026-10-30",open:"09:30",close:"16:00"},{date:"2026-11-02",open:"09:30",close:"16:00"}]);
 assert.equal(sessions[0].open,epoch("2026-10-30T13:30:00Z"));
 assert.equal(sessions[1].open,epoch("2026-11-02T14:30:00Z"));
 const now=epoch("2026-10-31T15:00:00Z");
 assert.equal(stockMarketHours(provider(now,false,sessions[1].open,sessions[1].close,sessions),now).nextOpen,sessions[1].open);
});
test("unknown, stale, or contradictory stock metadata never guesses open or closed",()=>{
 const now=epoch("2026-11-26T16:00:00Z");
 for(const state of [undefined,{clock:null,sessions:[]},provider(now,false,now+1000,now+2000,[]),provider(now,true,holidayCalendar[1].open,holidayCalendar[1].close,holidayCalendar),provider(now-60001,false,holidayCalendar[1].open,holidayCalendar[1].close,holidayCalendar)]){
  const h=stockMarketHours(state,now);
  assert.equal(h.calendarAvailable,false);assert.equal(h.closed,null);
  assert.equal(marketClosedState("stocks",h,now).label,"Market calendar unavailable");
 }
 const h=stockMarketHours(provider(now,false,holidayCalendar[1].open,holidayCalendar[1].close,holidayCalendar),now);
 assert.equal(marketClosedState("stocks",h,now+60001).closed,null);
 assert.equal(marketClosedState("stocks",undefined,now).closed,null);
});
test("closed market takes precedence over expired tick or lease without authorizing execution",()=>{
 const now=epoch("2026-11-26T16:00:00Z"),state=provider(now,false,holidayCalendar[1].open,holidayCalendar[1].close,holidayCalendar);
 const marketHours=stockMarketHours(state,now);
 assert.match(stockPauseReason({executable:false,reason:"stale_or_invalid_tick",validUntil:0,marketHours},now),/^Market closed, opens .* ET$/);
 assert.equal(stockPauseReason({executable:false,reason:"stale_or_invalid_tick",validUntil:0},now),"Stock execution status expired");
 assert.equal(stockPauseReason({executable:false,reason:"closed_or_calendar_unverified",validUntil:0},now),"Stock market closed or calendar unverified");
 const opens=holidayCalendar[1].open;
 assert.equal(stockPauseReason({executable:false,reason:"market_closed",validUntil:0,marketHours},opens),"Market calendar unavailable");
});
test("FX Friday close and Sunday open are exact across both DST transitions",()=>{
 for(const [friday,sunday] of [
  ["2026-03-06T22:00:00Z","2026-03-08T21:00:00Z"],
  ["2026-10-30T21:00:00Z","2026-11-01T22:00:00Z"],
  ["2026-07-10T21:00:00Z","2026-07-12T21:00:00Z"],
  ["2026-12-04T22:00:00Z","2026-12-06T22:00:00Z"],
 ]){
  const close=epoch(friday),open=epoch(sunday);
  assert.equal(forexMarketHours(close-1).closed,false);
  assert.equal(forexMarketHours(close-1).sessionClose,close);
  for(const now of [close,close+86400000,open-1]){
   const h=forexMarketHours(now);
   assert.equal(h.closed,true);assert.equal(h.nextOpen,open);
   assert.match(marketClosedState("forex",undefined,now).label,/Market closed, opens Sun, .*5:00 PM ET/);
  }
  assert.equal(forexMarketHours(open).closed,false);
  assert.equal(marketClosedState("forex",undefined,open).label,"");
 }
 assert.equal(forexMarketHours(NaN).closed,null);
});
test("full public and socket stock metadata agree and preserve last close quotes",t=>{
 const now=epoch("2026-11-26T16:00:00Z"),who={id:"hours-user",name:"Hours",email:"private@test",admin:false};
 t.mock.method(Date,"now",()=>now);
 const room=freshRoom();register(room,who);
 room.stockExecution={AAPL:{symbol:"AAPL",connected:false,leader:false,authorized:true,leaseUntil:0,tick:null,...provider(now,false,holidayCalendar[1].open,holidayCalendar[1].close,holidayCalendar)}};
 const lastClose={micro:200000000,at:holidayCalendar[0].close};room.quotes={AAPL:lastClose};
 const full=publicRoom(room,who),socket=marketPayload(room,who.id,now);
 assert.deepEqual(full.stockExecution.AAPL.marketHours,socket.stockExecution.AAPL.marketHours);
 assert.equal(full.stockExecution.AAPL.reason,"market_closed");assert.equal(socket.stockExecution.AAPL.reason,"market_closed");
 assert.equal(full.stockExecution.AAPL.executable,false);assert.equal(socket.stockExecution.AAPL.executable,false);
 assert.deepEqual(full.quotes.AAPL,lastClose);assert.deepEqual(socket.quotes.AAPL,lastClose);
 assert.equal(full.stockExecution.TSLA.marketHours.closed,null);assert.equal(socket.stockExecution.TSLA.reason,"calendar_unavailable");
 assert.equal(JSON.stringify(socket.stockExecution.AAPL).includes("sessions"),false);
});
