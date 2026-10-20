import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {clerkDisplayName,loadClerkProfiles,roomWithClerkNames,playerReference} from "../runtime/clerk-names.mjs";
import {freshRoom,register,applyAction} from "../lib/poker";
import {freshPublicRoom} from "../lib/public";
import {leaderboardSnapshot} from "../lib/leaderboard";
import {namedTransfer} from "../lib/server-names";
import {blackjackTablesAction} from "../lib/blackjack";
import {rouletteAction,rouletteState} from "../lib/roulette";
// @ts-expect-error existing JavaScript runtime module
import {verifiedSocketIdentity} from "../runtime/socket-identity.mjs";
import {emitState,createStateReceiver} from "../runtime/state-stream.mjs";
import {internalLiveAuthorized,liveSnapshotInput} from "../lib/internal-live";
import type {Transfer} from "../lib/transfers";

test("canonical Clerk fallback handles full name, backend first+last, blanks, username and only email local-part",()=>{
 const email={primaryEmailAddressId:"primary",emailAddresses:[{id:"other",emailAddress:"wrong@domain.test"},{id:"primary",emailAddress:"local.part@private.test"}]};
 const cases:[any,string][]=[
  [{...email,fullName:"  Full Person  ",firstName:"First",lastName:"Last",username:"handle"},"Full Person"],
  [{...email,firstName:" First ",lastName:" Last "},"First Last"],
  [{...email,firstName:" First ",lastName:null},"First"],
  [{...email,fullName:" \t ",firstName:null,lastName:"Last",username:" handle "},"handle"],
  [{...email,firstName:"\u0000",username:" \n "},"local.part"],
  [{emailAddresses:[{id:"one",emailAddress:"fallback@hidden.test"}]},"fallback"],
  [{primaryEmailAddress:{emailAddress:"primary@hidden.test"}},"primary"],
  [{username:"bad@hidden.test",...email},"local.part"],
  [null,"Player"],[{},"Player"],[{firstName:null,lastName:"Last"},"Player"],
 ];
 for(const [profile,expected] of cases)assert.equal(clerkDisplayName(profile),expected);
 assert.equal(clerkDisplayName({fullName:"a".repeat(100)}).length,80);
});
test("official SDK list batching dedupes 250 IDs into 100/100/50, filters extraneous results and never caches between operations",async()=>{
 let generation="One";const batches:string[][]=[];
 const clerk={users:{getUserList:async({userId,limit}:{userId:string[];limit:number})=>{
  assert.equal(limit,100);batches.push(userId);
  return {data:[...userId.map(id=>({id,firstName:generation,imageUrl:"https://img.clerk.com/avatar"})),{id:"unrequested",firstName:"Injected"}]};
 }}};
 const ids=Array.from({length:250},(_,i)=>"user"+i);
 const first=await loadClerkProfiles(clerk,[...ids,...ids]);
 assert.deepEqual(batches.map(b=>b.length),[100,100,50]);assert.equal(first.size,250);
 assert.equal(first.has("unrequested"),false);assert.equal(first.get("user0")?.name,"One");
 generation="Two";const second=await loadClerkProfiles(clerk,["user0"]);
 assert.equal(second.get("user0")?.name,"Two");assert.equal(batches.length,4);
 await assert.rejects(loadClerkProfiles({users:{getUserList:async()=>{throw Error("429");}}},["user0"]));
});
const alice={id:"user_alice",name:"SPOOFED MONGO ALICE",email:"alice@private.test",admin:false};
const bob={id:"user_bob",name:"SPOOFED MONGO BOB",email:"bob@private.test",admin:false};
function room(){
 const r=freshRoom();register(r,alice);register(r,bob);
 applyAction(r,alice,{type:"join",seat:0,buyIn:10000},1000);
 applyAction(r,bob,{type:"join",seat:1,buyIn:10000},1000);
 blackjackTablesAction(r,alice,{tableId:"lounge",type:"join",seat:0},1000);
 blackjackTablesAction(r,bob,{tableId:"lounge",type:"join",seat:1},1000);
 rouletteState(r,1000);rouletteAction(r,bob,{type:"bet",bet:{kind:"red",amount:100}},1,"wager",1000);
 (r as any).roulette.history=[{round:0,number:1,at:0,winners:[{publicId:r.members[1].publicId,name:"STALE WINNER",stake:100,returned:200}]}];
 r.members[0].activity=["Sent $1.00 to "+playerReference(r.members[1]),"Sent $1.00 to Old Bob"];
 r.log.push("Old Bob calls $20.00","Host adjusted Old Bob's cash by 1.00");
 return r;
}
test("unchanged Mongo room/version renders fresh poker, all blackjack tables, roulette bets/winners, chat directory, admin and leaderboard after Clerk rename",async()=>{
 const r=room(),before=structuredClone(r),calls:any[]=[];
 let generation="Current";
 const clerk={users:{getUserList:async({userId}:any)=>{calls.push(userId);return {data:userId.map((id:string)=>({id,firstName:generation,lastName:id===alice.id?"Alice":"Bob"}))};}}};
 const render=async(admin=false)=>{
  const profiles=await loadClerkProfiles(clerk,r.members.map(m=>m.id));
  return freshPublicRoom(r,{...alice,name:"CLIENT SPOOF",admin},profiles);
 };
 const first=await render(true);assert.equal(first.seats[1]?.name,"Current Bob");
 assert.equal(first.blackjack.tables.find(t=>t.id==="lounge")!.seats[1]?.name,"Current Bob");
 assert.equal(first.roulette?.bets[0].name,"Current Bob");
 assert.equal(first.roulette?.history[0].winners?.[0].name,"Current Bob");
 assert.ok(first.chatNames.some(m=>m.name==="Current Bob"));
 assert.ok(first.adminUsers.some(m=>m.name==="Current Bob"));assert.ok(first.members.some(m=>m.name==="Current Bob"));
 assert.match(first.log[0],/^Current Bob takes seat/);assert.equal(first.activity[0],"Sent $1.00 to Current Bob");
 assert.equal(first.activity[1],"Sent $1.00 to Player");
 assert.ok(first.log.includes("Player calls $20.00"));
 generation="Renamed";
 const second=await render();assert.equal(second.version,first.version);assert.equal(second.seats[1]?.name,"Renamed Bob");
 assert.equal(second.blackjack.tables.find(t=>t.id==="lounge")!.seats[1]?.name,"Renamed Bob");assert.equal(second.roulette?.bets[0].name,"Renamed Bob");
 assert.equal(second.roulette?.history[0].winners?.[0].name,"Renamed Bob");
 assert.ok(second.chatNames.some(m=>m.name==="Renamed Bob"));
 assert.equal(second.adminUsers.length,0);assert.equal(second.activity[0],"Sent $1.00 to Renamed Bob");
 const profiles=await loadClerkProfiles(clerk,r.members.map(m=>m.id));
 assert.equal(leaderboardSnapshot(roomWithClerkNames(r,profiles)).rows.find(m=>m.name.endsWith("Bob"))?.name,"Renamed Bob");
 const json=JSON.stringify(second);
 for(const secret of ["SPOOFED","CLIENT SPOOF","STALE WINNER","Current Bob","@private.test","Old Bob","[[player:"])assert.equal(json.includes(secret),false,secret);
 assert.deepEqual(r,before);assert.equal(calls.length,3);
 // Real websocket full/diff reconstruction must carry a name-only change with the
 // exact same financial version, without reconnect or a page reload.
 const frames:any[]=[],socket={emit:(event:string,data:any)=>frames.push({event,data})};
 emitState(socket,"room:state",first,true,1);emitState(socket,"room:state",second,false,2);
 assert.equal(frames[1].data.type,"diff");
 const receiver=createStateReceiver(()=>{});let received:any;
 for(const f of frames)received=receiver.receive(f.event,f.data);
 assert.equal(received.ok,true);assert.equal(received.value.seats[1].name,"Renamed Bob");
});
test("transfer and airdrop immutable audit labels are replaced at presentation, with no private ID or full email leak",async()=>{
 const t:Transfer={_id:"record",sender:alice.id,recipient:bob.id,senderName:"Old Alice",recipientName:"Old Bob",amount:100,note:"hi",at:1,fingerprint:"hidden",senderBefore:200,senderAfter:100,recipientBefore:0,recipientAfter:100};
 const profiles=new Map([[alice.id,{name:"Current Alice",avatar:null}],[bob.id,{name:"Current Bob",avatar:null}]]);
 for(const kind of [undefined,"airdrop"] as const){
  const first=namedTransfer({...t,kind},alice,profiles);assert.equal(first.from,"Current Alice");assert.equal(first.to,"Current Bob");
  profiles.set(bob.id,{name:"Renamed Bob",avatar:null});
  const second=namedTransfer({...t,kind},alice,profiles);assert.equal(second.to,"Renamed Bob");
  for(const secret of ["Old Alice","Old Bob",alice.id,bob.id,"@","hidden","senderBefore"])assert.equal(JSON.stringify(second).includes(secret),false);
  profiles.set(bob.id,{name:"Current Bob",avatar:null});
 }
 assert.equal(namedTransfer(t,alice,new Map()).to,"Player");
 assert.throws(()=>namedTransfer(t,{...alice,id:"outsider"},profiles));
});
test("socket identity ignores stored/client labels and uses canonical server Clerk name",()=>{
 const user={firstName:"Full",lastName:"Person",username:"handle",emailAddresses:[{id:"primary",emailAddress:"alice@private.test",verification:{status:"verified"}}],primaryEmailAddressId:"primary",passwordEnabled:false,externalAccounts:[{provider:"google",emailAddress:"alice@private.test"}],privateMetadata:{}};
 assert.equal(verifiedSocketIdentity(user,alice.id)?.name,"Full Person");
 assert.equal(verifiedSocketIdentity({...user,firstName:null,lastName:null,username:null},alice.id)?.name,"alice");
 assert.equal(verifiedSocketIdentity({...user,passwordEnabled:true},alice.id),null);
});
test("trusted live batch cannot enter without internal secret and public action schemas never accept names",()=>{
 const body={identity:alice,profiles:[[alice.id,{name:"Current Alice",avatar:null}]]};
 assert.equal(liveSnapshotInput.safeParse(body).success,true);
 assert.equal(internalLiveAuthorized(new Request("http://localhost/api/internal-live"),"private"),false);
 assert.equal(internalLiveAuthorized(new Request("http://localhost/api/internal-live",{headers:{"x-internal-live-secret":"wrong"}}),"private"),false);
 for(const route of ["action","admin","blackjack","finance","room","roulette","settings"]){
  const source=readFileSync("app/api/"+route+"/route.ts","utf8");
  assert.match(source,/freshPublicRoom as publicRoom/);
 }
 const source=readFileSync("app/api/transfers/route.ts","utf8");
 assert.match(source,/currentTransferHistory/);assert.match(source,/currentTransferResult/);assert.match(source,/profileName\(profiles,recipient.id\)/);
 assert.match(readFileSync("server.mjs","utf8"),/const profiles=due.length\?await loadClerkProfiles/);
 assert.match(readFileSync("app/chat-dock.tsx","utf8"),/room\?\.chatNames\?\?room\?\.leaderboard/);
});
