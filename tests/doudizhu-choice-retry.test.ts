import {test} from "node:test";
import assert from "node:assert/strict";
import {moveWithDoubleRetry} from "../lib/doudizhu-choice-retry";
import type {PublicDoudizhu} from "../lib/doudizhu";
const stale=()=>Error("The turn changed. Refresh first.");
const view=(changes:object={})=>({room:{code:"same room",handId:"same hand",phase:"doubling",version:8,players:[{self:true,doubleChosen:false}],...changes}} as PublicDoudizhu);
const body={type:"double",version:1,requestId:"initial",doubleMultiplier:4};
test("two competing commits can each invalidate a refreshed choice before it succeeds",async()=>{
 const requests:object[]=[];let reads=0;
 const result=await moveWithDoubleRetry({read:async()=>{reads++;return view({version:reads+1});},move:async request=>{requests.push(request);if(requests.length<3)throw stale();return view();}},body,view().room);
 assert.equal(result.room!.version,8);assert.equal(reads,2);assert.equal(requests.length,3);
 assert.equal(new Set(requests.map(r=>(r as typeof body).requestId)).size,3);
 assert(requests.every(r=>(r as typeof body).doubleMultiplier===4));
});
test("ambiguous network errors and other move types are never retried",async()=>{
 for(const [type,error] of [["double",Error("Failed to fetch")],["play",stale()]] as const){
  let reads=0,calls=0;await assert.rejects(()=>moveWithDoubleRetry({read:async()=>{reads++;return view();},move:async()=>{calls++;throw error;}},{...body,type},view().room));
  assert.equal(calls,1);assert.equal(reads,0);
 }
});
test("new hand, new room, locked choice, absent player and completed phase all stop retry",async()=>{
 for(const changes of [{code:"another"},{handId:"another"},{players:[{self:true,doubleChosen:true}]},{players:[]},{phase:"playing"}]){
  let calls=0;await assert.rejects(()=>moveWithDoubleRetry({read:async()=>view(changes),move:async()=>{calls++;throw stale();}},body,view().room));
  assert.equal(calls,1);
 }
});
test("persistent version conflict is bounded to four attempts",async()=>{
 let calls=0;await assert.rejects(()=>moveWithDoubleRetry({read:async()=>view(),move:async()=>{calls++;throw stale();}},body,view().room));assert.equal(calls,4);
});
