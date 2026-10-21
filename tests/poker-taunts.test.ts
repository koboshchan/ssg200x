import {randomUUID} from "node:crypto";
import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createPokerTaunts,POKER_EMOTES} from "../runtime/poker-taunts.mjs";
const publicId=(s:string)=>createHash("sha256").update(s).digest("hex").slice(0,16);
function fixture(){
 let time=10000,reads=0,session=true,tab=true;
 const room:any={version:0,seats:Array.from({length:8},(_,i)=>({userId:"user"+i})),members:Array.from({length:9},(_,i)=>({id:"user"+i,wallet:100000})),siteMaintenance:false};
 const sockets=new Map<string,any>(),events:any[]=[];
 const attach=createPokerTaunts({collection:{findOne:async()=>{reads++;return room;},updateOne:async(q:any,u:any)=>{if(q.version!==room.version)return {matchedCount:0};Object.assign(room,u.$set);room.version++;return {matchedCount:1};}},io:{sockets:{sockets}},checkSession:async()=>{if(!session)throw Error("session");},checkTab:()=>tab?null:"blocked",now:()=>time});
 function socket(id="user0",route="/poker"){
  let handler:any;
  const s:any={connected:true,data:{identity:{id},expires:999999,marketRoute:route},handshake:{auth:{tabId:"tab",tabProof:"proof"}},on:(_e:string,h:any)=>handler=h,emit:(event:string,payload:any)=>events.push({recipient:id,event,payload}),disconnect(){s.connected=false;}};
  sockets.set(id+":"+sockets.size,s);attach(s);
  return {s,send:(payload:any)=>new Promise<any>(resolve=>handler(payload,resolve))};
 }
 return {room,socket,events,next(){time+=4000;},get reads(){return reads;},revoke(){session=false;},block(){tab=false;}};
}
test("allowlisted six emotes and both throws work from all eight seats, paid throws and free emotes without private IDs",async()=>{
 const f=fixture();
 f.socket("spectator","/markets");
 for(let i=0;i<8;i++){
  const sender=f.socket("user"+i);
  const emote=Object.keys(POKER_EMOTES)[i%6];
  assert.equal((await sender.send({tableId:"01",kind:"emote",value:emote})).ok,true);
  f.next();
  assert.equal((await sender.send({tableId:"01",kind:"throw",value:i%2?"egg":"tomato",requestId:randomUUID(),requestAt:10000,expectedPrice:5000,target:(i+1)%8,targetId:publicId("user"+((i+1)%8))})).ok,true);
 }
 assert.equal(f.room.house,40000);assert.ok(f.room.members.slice(0,8).every((m:any)=>m.wallet===95000));
 assert.ok(f.events.length>0);
 assert.ok(f.events.every(e=>e.recipient!=="spectator"));
 for(const e of f.events){assert.equal(e.event,"poker:taunt");assert.equal(JSON.stringify(e.payload).includes('"user'),false);assert.ok(e.payload.id);}
});
test("one cooldown across sockets, reconnect, invalid requests and concurrent spam",async()=>{
 const f=fixture(),a=f.socket(),b=f.socket();
 const results=await Promise.all(Array.from({length:20},(_,i)=>(i%2?a:b).send({tableId:"01",kind:"emote",value:"laugh"})));
 assert.equal(results.filter(x=>x.ok).length,1);assert.equal(f.reads,1);
 assert.equal((await f.socket().send({tableId:"01",kind:"emote",value:"cry"})).error,"cooldown");
 f.next();assert.equal((await b.send({tableId:"01",kind:"emote",value:"cry"})).ok,true);
 f.next();assert.equal((await a.send({tableId:"01",kind:"emote",value:"<script>"})).error,"invalid");
 assert.equal((await a.send({tableId:"01",kind:"emote",value:"laugh"})).error,"cooldown");
});
test("spectators, blocked tabs, revoked sessions, expired sessions, maintenance and missing members cannot send",async()=>{
 for(const mode of ["spectator","tab","revoked","expired","maintenance","removed"]){
  const f=fixture(),a=f.socket(mode==="spectator"?"user8":"user0");
  if(mode==="tab")f.block();if(mode==="revoked")f.revoke();if(mode==="expired")a.s.data.expires=0;
  if(mode==="maintenance")f.room.siteMaintenance=true;if(mode==="removed")f.room.members[0].accessRevoked=true;
  assert.equal((await a.send({tableId:"01",kind:"emote",value:"laugh"})).ok,false,mode);assert.equal(f.events.length,0,mode);
 }
});
test("strict request shapes, no text, no spoofed source, no empty/self/out-of-bounds/replaced targets",async()=>{
 const f=fixture(),a=f.socket();
 const bad=[null,[],{}, {tableId:"01",kind:"emote",value:"laugh",source:1},{tableId:"01",kind:"emote",value:"laugh",text:"hello"},{tableId:"01",kind:"throw",value:"knife",target:1,targetId:publicId("user1")},{tableId:"01",kind:"throw",value:"egg",target:-1,targetId:publicId("user1")},{tableId:"01",kind:"throw",value:"egg",target:8,targetId:publicId("user1")},{tableId:"01",kind:"throw",value:"egg",target:1.5,targetId:publicId("user1")},{tableId:"01",kind:"throw",value:"egg",target:1},{tableId:"01",kind:"throw",value:"egg",target:0,targetId:publicId("user0")},{tableId:"01",kind:"throw",value:"egg",target:1,targetId:publicId("old-player")}];
 for(const input of bad){const payload=input&&"kind" in input&&input.kind==="throw"?{requestId:randomUUID(),requestAt:10000,expectedPrice:5000,...input}:input;assert.equal((await a.send(payload)).ok,false);f.next();}
 f.room.seats[1]=null;
 assert.equal((await a.send({tableId:"01",kind:"throw",value:"tomato",target:1,targetId:publicId("user1"),requestId:randomUUID(),requestAt:10000,expectedPrice:5000})).error,"target");
 assert.deepEqual(f.events,[]);
});

test("insufficient wallet and changed-price throws never emit an animation or charge; emotes stay free",async()=>{
 for(const mode of ["poor","price"]){
  const f=fixture(),a=f.socket();if(mode==="poor")f.room.members[0].wallet=4999;
  const before=structuredClone(f.room);
  const result=await a.send({tableId:"01",kind:"throw",value:"egg",target:1,targetId:publicId("user1"),requestId:randomUUID(),requestAt:10000,expectedPrice:mode==="price"?7500:5000});
  assert.equal(result.error,mode==="poor"?"insufficient_funds":"price_changed");assert.deepEqual(f.room,before);assert.equal(f.events.length,0);
  f.next();assert.equal((await a.send({tableId:"01",kind:"emote",value:"laugh"})).ok,true);assert.deepEqual(f.room,before);
 }
});

test("twelve-seat nested table events and charges are isolated from legacy and other selected tables",async()=>{
 const f=fixture();
 f.room.pokerTables={"02":{seats:Array(12).fill(null)},"03":{seats:Array(12).fill(null)}};
 f.room.pokerTables["02"].seats[10]={userId:"user0"};
 f.room.pokerTables["02"].seats[11]={userId:"user1"};
 f.room.seats[0]=null;f.room.seats[1]=null;
 const a=f.socket(),same=f.socket("same"),other=f.socket("other"),third=f.socket("third");
 a.s.data.pokerTableId="02";same.s.data.pokerTableId="02";third.s.data.pokerTableId="03";
 assert.equal((await a.send({tableId:"02",kind:"emote",value:"laugh"})).ok,true);
 assert.deepEqual(f.events.map(e=>e.recipient).sort(),["same","user0"]);
 assert.ok(f.events.every(e=>e.payload.tableId==="02"&&e.payload.source===10));
 f.events.length=0;f.next();
 assert.equal((await a.send({tableId:"02",kind:"throw",value:"egg",requestId:randomUUID(),requestAt:14000,expectedPrice:5000,target:11,targetId:publicId("user1")})).ok,true);
 assert.equal(f.room.house,5000);assert.ok(f.events.every(e=>e.payload.target===11&&e.payload.tableId==="02"));
 f.next();assert.equal((await a.send({tableId:"01",kind:"emote",value:"cry"})).error,"tab");
 f.next();a.s.data.pokerTableId="03";
 assert.equal((await a.send({tableId:"03",kind:"emote",value:"cry"})).error,"not_seated");
 f.next();assert.equal((await a.send({tableId:"04",kind:"emote",value:"cry"})).error,"invalid");
});
