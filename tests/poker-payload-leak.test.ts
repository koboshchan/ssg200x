import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {freshRoom,register,startHand,showdown} from "../lib/poker";
import {freshPublicRoom} from "../lib/public";
// @ts-expect-error existing runtime module has no declaration
import {emitRoomState} from "../runtime/room-state.mjs";
import {createStateReceiver} from "../runtime/state-stream.mjs";
test("all room API producers share the redaction boundary",()=>{
 for(const name of ["room","action","admin","finance","settings","roulette","blackjack","internal-live"]){
  const source=readFileSync("app/api/"+name+"/route.ts","utf8");
  assert.match(source,/freshPublicRoom as publicRoom/);assert.match(source,/publicRoom\(/);
  assert.doesNotMatch(source,/NextResponse\.json\(room\b/);
 }
});
test("inspect every API snapshot and socket full/diff payload across live streets, folds and reveal",async()=>{
 const r=freshRoom(),now=Date.now();
 const users=Array.from({length:4},(_,i)=>({id:"u"+i,name:"Player "+i,email:i+"@test.invalid",admin:i===3}));
 for(const u of users)register(r,u);
 for(let i=0;i<3;i++){r.members[i].wallet-=20000;r.seats[i]={userId:users[i].id,stack:20000,hole:[],bet:0,committed:0,folded:false,inHand:true,actedAt:null,sitOut:false,leaveAfter:false,seen:now,ready:true};}
 startHand(r,now);
 const profiles=new Map(users.map(u=>[u.id,{name:u.name,avatar:null}]));
 const sockets=users.map(()=>({data:{},emit:(_event:string,_payload:unknown)=>{}}));
 const received=users.map(()=>createStateReceiver(()=>assert.fail("unexpected missing baseline")));
 const events:{event:string;payload:any}[][]=users.map(()=>[]);
 sockets.forEach((s,i)=>s.emit=(event,payload)=>events[i].push({event,payload:JSON.parse(JSON.stringify(payload))}));
 let count=0;
 for(const [step,street] of (["preflop","flop","turn","river"] as const).entries()){
  r.street=street;r.version++;r.board=r.deck.slice(0,[0,3,4,5][step]);
  if(step>=1)r.seats[0]!.folded=true;
  for(let i=0;i<users.length;i++){
   const api=JSON.parse(JSON.stringify(await freshPublicRoom(r,users[i],profiles)));
   for(let j=0;j<3;j++)assert.deepEqual(api.seats[j].hole,j===i?r.seats[j]!.hole:["?","?"]);
   assert.equal(api.deck,undefined);
   const privateCards=r.seats.flatMap((s,j)=>s&&j!==i?s.hole:[]);
   const inspect=(value:unknown):void=>{if(typeof value==="string")assert.ok(!privateCards.includes(value),"private card in payload: "+value);else if(value&&typeof value==="object")Object.values(value).forEach(inspect);};
   inspect(api);
   // Same producer used by /api/internal-live, then actual room full/diff emitter.
   emitRoomState(sockets[i],{maintenance:{blocked:false},room:api},step===0);
   for(const entry of events[i].splice(0)){
    inspect(entry.payload);const decoded=received[i].receive(entry.event,entry.payload);assert.equal(decoded.ok,true);
    for(let j=0;j<3;j++)assert.deepEqual(decoded.value.seats[j].hole,j===i?r.seats[j]!.hole:["?","?"]);
    count++;
   }
  }
 }
 assert.equal(count,16);
 r.seats[1]!.folded=true;showdown(r,now);
 for(let i=0;i<users.length;i++){
  const api=await freshPublicRoom(r,users[i],profiles);
  for(let j=0;j<3;j++)assert.deepEqual(api.seats[j]!.hole,r.seats[j]!.hole);
  emitRoomState(sockets[i],{maintenance:{blocked:false},room:api});
  const entry=events[i].pop()!;const decoded=received[i].receive(entry.event,entry.payload);
  assert.equal(decoded.ok,true);for(let j=0;j<3;j++)assert.deepEqual(decoded.value.seats[j].hole,r.seats[j]!.hole);
 }
});
