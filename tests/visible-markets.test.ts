import test from "node:test";import assert from "node:assert/strict";
import {visibleMarketSymbols as v} from "../lib/visible-markets";
const ms={crypto:["BTC","ETH"],stocks:["AAPL"],forex:["EUR/USD"],delisted:["OLD"],revision:1};
test("all on keeps everything",()=>assert.deepEqual(v(ms,{stocks:true,forex:true,cryptoSpot:true,cryptoPerps:true}),ms));
test("stocks/forex off hide them",()=>{const r=v(ms,{stocks:false,forex:false});assert.deepEqual([r.stocks,r.forex,r.crypto],[[],[],["BTC","ETH"]]);});
test("crypto hidden only when spot and perps both off",()=>{assert.equal(v(ms,{cryptoSpot:false,cryptoPerps:true}).crypto.length,2);assert.equal(v(ms,{cryptoSpot:false,cryptoPerps:false}).crypto.length,0);});
test("everything off gives empty active list, delisted retained",()=>{const r=v(ms,{stocks:false,forex:false,cryptoSpot:false,cryptoPerps:false});assert.deepEqual([...r.crypto,...r.stocks,...r.forex!],[]);assert.deepEqual(r.delisted,["OLD"]);});
test("missing forex list ok",()=>assert.deepEqual(v({...ms,forex:undefined},{}).forex,[]));
