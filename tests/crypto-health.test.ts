import {test} from "node:test";
import assert from "node:assert/strict";
import {ExchangeFeed} from "../lib/exchange-feed";
import {cryptoExecutable,CRYPTO_HEALTH_MS} from "../lib/crypto-policy";
import {freshRoom,register} from "../lib/poker";
import {spot,openPosition,closePosition,requireQuote,liquidate} from "../lib/finance";
import {settleTriggers} from "../lib/position-triggers";
const who={id:"quiet",name:"Quiet",email:"quiet@test",admin:false};
function roomAt(at=100000){const r=freshRoom();register(r,who);r.cryptoStatus={connected:true,heartbeatSubscribed:true,generation:"g",lastMessage:at,leaseUntil:at+15000};r.quotes={BTC:{micro:100e6,at,cryptoGeneration:"g"}};return r;}
test("quiet-symbol prices remain executable for buys, sells and perp closes while shared heartbeat healthy",()=>{
 const r=roomAt(),at=100000;spot(r,who,"BTC","buy",10000,at);openPosition(r,who,"BTC","long",10000,2,"p",at);
 const now=at+3600000;r.cryptoStatus!.lastMessage=now;r.cryptoStatus!.leaseUntil=now+15000;
 assert.equal(requireQuote(r,"BTC",now),100e6);
 assert.doesNotThrow(()=>spot(r,who,"BTC","sell",1000,now));assert.doesNotThrow(()=>closePosition(r,who,"p",now));
});
test("unhealthy stream, subscription, expired lease and old generation deny execution without financial mutation",()=>{
 for(const breakHealth of [(r:ReturnType<typeof roomAt>)=>{r.cryptoStatus!.connected=false;},(r:ReturnType<typeof roomAt>)=>{r.cryptoStatus!.heartbeatSubscribed=false;},(r:ReturnType<typeof roomAt>)=>{r.cryptoStatus!.lastMessage-=15001;},(r:ReturnType<typeof roomAt>)=>{r.cryptoStatus!.leaseUntil=100000;},(r:ReturnType<typeof roomAt>)=>{r.cryptoStatus!.generation="new";}]){
  const r=roomAt();openPosition(r,who,"BTC","long",10000,2,"p",100000);breakHealth(r);const before=structuredClone(r);
  assert.throws(()=>closePosition(r,who,"p",100000));liquidate(r,100000);settleTriggers(r,100000);assert.deepEqual(r,before);
 }
});
test("health boundary remains strict even when worker stops publishing",()=>{
 const r=roomAt();r.cryptoStatus!.leaseUntil+=60000;
 assert(cryptoExecutable(r.cryptoStatus,r.quotes!.BTC,115000));assert(!cryptoExecutable(r.cryptoStatus,r.quotes!.BTC,115001));assert(!cryptoExecutable(undefined,r.quotes!.BTC,100000));
});
test("Coinbase subscriptions plus heartbeats preserve quiet quotes, disconnect and reconnect revoke them",async()=>{
 let now=100000;const sockets:any[]=[],ticks:any[]=[];
 const feed=new ExchangeFeed({symbols:()=>["BTC","NEAR"],now:()=>now,socket:()=>{const w:any={readyState:1,send(){},close(){w.readyState=3;}};sockets.push(w);return w;},apply:async t=>{ticks.push(...t);}});
 feed.step();sockets[0].onopen();const subscription=()=>feed.receive(JSON.stringify({type:"subscriptions",channels:[{name:"ticker",product_ids:["BTC-USD","NEAR-USD"]},{name:"heartbeat",product_ids:["BTC-USD","NEAR-USD"]}]}));subscription();
 const frame=(type:string)=>feed.receive(JSON.stringify({type,product_id:"NEAR-USD",sequence:1,price:"2",time:new Date(now).toISOString()}));frame("ticker");await new Promise(r=>setImmediate(r));
 for(let i=0;i<20;i++){now+=10000;frame("heartbeat");feed.step();}
 assert(cryptoExecutable(feed.health(now+15000),ticks[0],now));sockets[0].onclose();assert(!cryptoExecutable(feed.health(now+15000),ticks[0],now));
 now+=500;feed.step();sockets[1].onopen();subscription();frame("heartbeat");assert(!cryptoExecutable(feed.health(now+15000),ticks[0],now));
 now+=CRYPTO_HEALTH_MS+1;feed.step();assert.equal(sockets[1].readyState,3);feed.stop();
});
