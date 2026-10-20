import {test} from "node:test";
import assert from "node:assert/strict";
import {parseStockCalendar, parseStockClock, regularStockSession} from "../lib/stock-session";
test("provider calendar handles DST, missing holidays and early closes", () => {
  const rows = parseStockCalendar([
    {date:"2026-03-06",open:"09:30",close:"16:00"},
    {date:"2026-03-09",open:"09:30",close:"16:00"},
    {date:"2026-11-27",open:"09:30",close:"13:00"},
  ]);
  assert.equal(new Date(rows[0].open).toISOString(),"2026-03-06T14:30:00.000Z");
  assert.equal(new Date(rows[1].open).toISOString(),"2026-03-09T13:30:00.000Z");
  assert.equal(new Date(rows[2].close).toISOString(),"2026-11-27T18:00:00.000Z");
  const now = Date.parse("2026-11-27T17:59:59Z");
  const clock = parseStockClock({timestamp:new Date(now).toISOString(),is_open:true,next_open:"2026-11-30T09:30:00-05:00",next_close:"2026-11-27T13:00:00-05:00"},now);
  assert.equal(regularStockSession(rows,clock,now)?.date,"2026-11-27");
  assert.equal(regularStockSession(rows,clock,rows[2].close),null);
  assert.equal(regularStockSession(rows,clock,now+61_000),null);
  assert.equal(regularStockSession(rows,{...clock,isOpen:false},now),null);
  assert.equal(regularStockSession([],clock,now),null);
});
test("malformed/duplicate calendar and invalid clocks fail closed", () => {
  for (const value of [null,[{date:"2026-02-30",open:"09:30",close:"16:00"}],[{date:"2026-10-19",open:"25:30",close:"16:00"}]]) assert.throws(()=>parseStockCalendar(value));
  const row={date:"2026-10-19",open:"09:30",close:"16:00"};
  assert.throws(()=>parseStockCalendar([row,row]));
  assert.throws(()=>parseStockClock({is_open:true},0));
});

test("holiday/weekend absence never opens via weekday inference; fall DST shifts UTC",()=>{
  const rows=parseStockCalendar([
    {date:"2026-10-30",open:"09:30",close:"16:00"},
    {date:"2026-11-02",open:"09:30",close:"16:00"},
    {date:"2026-11-27",open:"09:30",close:"13:00"},
  ]);
  assert.equal(new Date(rows[0].open).toISOString(),"2026-10-30T13:30:00.000Z");
  assert.equal(new Date(rows[1].open).toISOString(),"2026-11-02T14:30:00.000Z");
  for(const date of ["2026-11-26","2026-11-28"]){
    const now=Date.parse(date+"T16:00:00Z");
    const clock={isOpen:true,timestamp:now,receivedAt:now,nextOpen:now+1000,nextClose:now+3_600_000};
    assert.equal(regularStockSession(rows,clock,now),null);
  }
});
