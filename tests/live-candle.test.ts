import {test} from "node:test";
import assert from "node:assert/strict";
import {tickCandle} from "../lib/live-candle";
test("quote ticks update close, preserve open and widen OHLC then roll at interval",()=>{
 let row=tickCandle(undefined,{micro:100_000_000,at:60001},60000)!;
 row=tickCandle(row,{micro:110_000_000,at:60201},60000)!;
 row=tickCandle(row,{micro:90_000_000,at:60401},60000)!;
 assert.deepEqual(row,{time:60000,open:100,high:110,low:90,close:90});
 assert.equal(tickCandle(row,{micro:1,at:59999},60000),row);
 assert.deepEqual(tickCandle(row,{micro:105_000_000,at:120001},60000),{time:120000,open:105,high:105,low:105,close:105});
 assert.equal(tickCandle(row,{micro:NaN,at:120001},60000),row);
});
