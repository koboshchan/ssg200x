import {test} from "node:test";
import assert from "node:assert/strict";
import {diffState,applyPatch,emitState,createStateReceiver,STATE_STREAMS,resetStream} from "../runtime/state-stream.mjs";
test("nested changed fields, explicit deletions, arrays truncate and expand without replacing unchanged fields",()=>{
 const a={quotes:{BTC:1,ETH:2},positions:[{id:"p",pnl:1,sl:3},{id:"q",pnl:2}],empty:null};
 const b={quotes:{BTC:2},positions:[{id:"p",pnl:5}],extra:false};
 const patch=diffState(a,b);
 assert.deepEqual(applyPatch(a,patch),b);assert.deepEqual(a.positions[0],{id:"p",pnl:1,sl:3});
 assert.equal(JSON.stringify(patch).includes('"id"'),false);
 assert.deepEqual(applyPatch([],diffState([],[null,{x:1}])),[null,{x:1}]);
 assert.equal(diffState(b,structuredClone(b)),null);
});
test("patches reject prototype pollution, invalid array indices and gaps",()=>{
 for(const patch of [
 {op:"object",remove:[],entries:[["__proto__",{op:"replace",value:{polluted:1}}]]},
 {op:"replace",value:JSON.parse('{"constructor":{"prototype":{"polluted":1}}}')},
 ])assert.throws(()=>applyPatch({},patch));
 for(const patch of [{op:"array",length:2,entries:[]},{op:"array",length:1,entries:[[-1,{op:"replace",value:1}]]}])assert.throws(()=>applyPatch([],patch));
 assert.equal(({} as any).polluted,undefined);
});
test("each stream sends full then diffs, skips empty diffs and sends full every eight seconds",()=>{
 for(const event of STATE_STREAMS){
  const messages:any[]=[],socket={emit:(e:string,m:unknown)=>messages.push([e,m])};
  emitState(socket,event,{balance:10},false,0);emitState(socket,event,{balance:10},false,1);
  emitState(socket,event,{balance:9},false,2);emitState(socket,event,{balance:9},false,8000);
  assert.equal(messages.length,3);
  assert.deepEqual(messages.map(([,m])=>[m.type,m.seq,m.snapshotVersion]),[["full",1,1],["diff",2,1],["full",3,2]]);
  const receiver=createStateReceiver(()=>assert.fail("unexpected resync"));
  for(const [,m] of messages)assert.equal(receiver.receive(event,m).ok,true);
 }
});
test("gaps and mismatched baselines discard diffs, bound requests, and recover on periodic full or reconnect",()=>{
 let now=0,calls=0;const r=createStateReceiver(()=>calls++,()=>now),event="room:state";
 const full={type:"full",seq:1,snapshotVersion:1,data:{x:1}};
 assert.equal(r.receive(event,full).ok,true);
 const bad={type:"diff",seq:3,snapshotVersion:1,patch:{op:"replace",value:{x:3}}};
 assert.equal(r.receive(event,bad).ok,false);assert.equal(calls,1);
 assert.equal(r.receive(event,{...bad,seq:2}).ok,false);assert.equal(calls,1);
 now=1000;r.receive(event,bad);assert.equal(calls,2);
 assert.equal(r.receive(event,{...full,seq:4,snapshotVersion:2}).ok,true);
 r.clear();assert.equal(r.receive(event,{...bad,seq:5,snapshotVersion:2}).ok,false);
 assert.equal(r.receive(event,full).ok,true);
});
test("connection-local baselines cannot expose another user's private fields; resubscribe forces full",()=>{
 const a:any[]=[],b:any[]=[];
 const sa={emit:(e:string,m:any)=>a.push(m)},sb={emit:(e:string,m:any)=>b.push(m)};
 emitState(sa,"room:state",{wallet:100,hole:["As","Ah"],opponent:["?","?"]});
 emitState(sb,"room:state",{wallet:200,hole:["Ks","Kh"],opponent:["?","?"]});
 emitState(sa,"room:state",{wallet:99,hole:["As","Ah"],opponent:["?","?"]});
 assert.equal(JSON.stringify(a).includes("Ks"),false);assert.equal(JSON.stringify(b).includes("As"),false);
 resetStream(sa,"room:state");emitState(sa,"room:state",{wallet:99});
 assert.equal(a.at(-1).type,"full");
});
test("all dynamic room domains reconstruct through field diffs without unchanged payloads",()=>{
 const before={quotes:{BTC:{micro:100,at:1}},wallet:100,positions:[{id:"p",pnl:0,equity:10}],roulette:{phase:"betting",bets:[{amount:2}]},seats:[{stack:10,hole:["?","?"]}],transferHistoryKeys:{mine:"same"}};
 const after={...before,quotes:{BTC:{micro:110,at:2}},wallet:95,positions:[{id:"p",pnl:1,equity:11}],roulette:{phase:"locked",bets:[]},seats:[{stack:15,hole:["?","?"]}]};
 const patch=diffState(before,after);assert.deepEqual(applyPatch(before,patch),after);
 assert.equal(JSON.stringify(patch).includes("transferHistoryKeys"),false);
 assert.equal(JSON.stringify(patch).includes("hole"),false);
});
