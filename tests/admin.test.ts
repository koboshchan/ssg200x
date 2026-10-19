import {test} from "node:test";
import assert from "node:assert/strict";
import {adjustBalance} from "../lib/admin";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {publicRoom} from "../lib/public";
const host={id:"host",name:"Host",email:"host@example.test",admin:true},player={id:"player",name:"Player",email:"player@example.test",admin:false};
test("metadata-derived admin identity gates balance changes; email alone grants nothing",()=>{const r=freshRoom(),m=register(r,player);assert.throws(()=>adjustBalance(r,{...host,admin:false},m.publicId,100));assert.equal(m.wallet,100_000);});
test("signed adjustments preserve ledger and don't count as trading profits",()=>{const r=freshRoom();register(r,host);const m=register(r,player);m.approved=true;adjustBalance(r,host,m.publicId,12345);assert.equal(m.wallet,112345);assertRoom(r);assert.equal(publicRoom(r,player).leaderboard.find(x=>x.publicId===m.publicId)!.pnl,0);adjustBalance(r,host,m.publicId,-2345);assert.equal(m.wallet,110000);assertRoom(r);assert.equal(r.audit?.length,2);assert.equal(r.audit?.[0].admin,host.id);});
test("adjustments cannot overdraw, overflow, use fractional cents or target unknown user",()=>{const r=freshRoom(),m=register(r,player);for(const n of [-100001,0,.5,100_000_001,NaN])assert.throws(()=>adjustBalance(r,host,m.publicId,n));assert.throws(()=>adjustBalance(r,host,"missing",100));assert.equal(m.wallet,100000);assertRoom(r);});
