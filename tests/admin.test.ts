import {test} from "node:test";
import assert from "node:assert/strict";
import {adjustBalance} from "../lib/admin";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {publicRoom} from "../lib/public";
const host={id:"host",name:"Host",email:"host@example.test",admin:true},player={id:"player",name:"Player",email:"player@example.test",admin:false};
test("metadata-derived admin identity gates balance changes; email alone grants nothing",()=>{const r=freshRoom(),m=register(r,player);assert.throws(()=>adjustBalance(r,{...host,admin:false},m.publicId,100));assert.equal(m.wallet,100_000);});
test("signed adjustments preserve ledger and don't count as trading profits",()=>{const r=freshRoom();register(r,host);const m=register(r,player);m.approved=true;adjustBalance(r,host,m.publicId,12345);assert.equal(m.wallet,112345);assertRoom(r);assert.equal(publicRoom(r,player).leaderboard.find(x=>x.publicId===m.publicId)!.pnl,0);adjustBalance(r,host,m.publicId,-2345);assert.equal(m.wallet,110000);assertRoom(r);assert.equal(r.auditPending?.length,2);assert.equal(r.auditPending?.[0].who,host.id);});
test("adjustments cannot overdraw, overflow, use fractional cents or target unknown user",()=>{const r=freshRoom(),m=register(r,player);for(const n of [-100001,0,.5,100_000_001,NaN])assert.throws(()=>adjustBalance(r,host,m.publicId,n));assert.throws(()=>adjustBalance(r,host,"missing",100));assert.equal(m.wallet,100000);assertRoom(r);});
test("maintenance and liquidation edits require admin and record exact old/new",async()=>{
 const {setMaintenance,setLiquidation}=await import("../lib/admin");const {openPosition,liqPrice}=await import("../lib/finance");const r=freshRoom();const m=register(r,host);r.quotes={BTC:{micro:100_000_000_000,at:Date.now()}};openPosition(r,host,"BTC","long",1000,10,"p");const p=m.positions![0];
 assert.throws(()=>setMaintenance(r,player,1));setMaintenance(r,host,1);assert.equal(r.maintenance,.01);assert.equal(p.maintenance,.01);assert.equal(r.auditPending![0].what,"maintenance-margin");assert.equal(r.auditPending![0].old,0);assert.equal(r.auditPending![0].new,1);
 assert.throws(()=>setLiquidation(r,player,m.publicId,"p",95000));const old=liqPrice(p)/1e6;setLiquidation(r,host,m.publicId,"p",95000);assert.equal(liqPrice(p),95_000_000_000);assert.equal(r.auditPending!.at(-1)!.old,old);assert.equal(r.auditPending!.at(-1)!.new,95000);assertRoom(r);
 setLiquidation(r,host,m.publicId,"p",110000);assert.equal(m.positions!.length,0);assertRoom(r);
});
