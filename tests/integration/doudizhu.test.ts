import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db,readRoom,closeDatabase} from "../../lib/db";
import {mutate} from "../../lib/store";
import {doudizhuMove,doudizhuRead} from "../../lib/doudizhu-store";
import {tickDoudizhu,type DoudizhuInput} from "../../lib/doudizhu";
import {assertRoom,totalChips} from "../../lib/poker";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Requires isolated test DB");
process.env.MONGODB_DB+="_doudizhu";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
const users=Array.from({length:4},(_,i)=>({id:"ddz-user-"+i,name:"Player "+i,email:"private-"+i+"@test.invalid",admin:false}));
const request=(data:Partial<DoudizhuInput>)=>({type:"ready",requestId:randomUUID(),requestAt:Date.now(),...data} as DoudizhuInput);
test("fresh Mongo CAS makes duplicate debit and concurrent last seat safe; persistence and settlement replay conserve wallet",async()=>{
 const create=request({type:"create",rate:1,maxLoss:12800});
 await Promise.all([doudizhuMove(users[0],create),doudizhuMove(users[0],create)]);
 let r=await readRoom();assert.equal(r.members[0].wallet,87200);assert.equal(r.doudizhu!.length,1);const code=r.doudizhu![0].code;
 await doudizhuMove(users[1],request({type:"join",code}));
 const joins=await Promise.allSettled([doudizhuMove(users[2],request({type:"join",code})),doudizhuMove(users[3],request({type:"join",code}))]);
 assert.equal(joins.filter(x=>x.status==="fulfilled").length,1);
 r=await readRoom();assertRoom(r);assert.equal(r.doudizhu![0].players.length,3);
 const active=r.doudizhu![0].players.map(p=>users.find(u=>u.id===p.userId)!);
 for(const u of active){const view=await doudizhuRead(u);await doudizhuMove(u,request({type:"ready",version:view.room!.version}));}
 await closeDatabase();r=await readRoom();assert.equal(r.doudizhu![0].phase,"bidding");assertRoom(r);
 await doudizhuMove(active[0],request({type:"bid",bid:3,version:r.doudizhu![0].version}));
 const view=await doudizhuRead(active[0]);const card=view.room!.players[0].hand![0],version=view.room!.version;
 const moves=await Promise.allSettled([doudizhuMove(active[0],request({type:"play",cards:[card],version})),doudizhuMove(active[0],request({type:"play",cards:[card],version}))]);
 assert.equal(moves.filter(x=>x.status==="fulfilled").length,1);
 for(const u of active)await doudizhuMove(u,request({type:"leave"}));
 for(let i=0;i<300;i++){const {room}=await mutate(r=>tickDoudizhu(r,Date.now()+100000));assertRoom(room);if(room.doudizhu![0].settled)break;}
 r=await readRoom();assert(r.doudizhu![0].settled);assertRoom(r);const balances=r.members.map(m=>m.wallet),assets=totalChips(r);
 await Promise.all([mutate(r=>tickDoudizhu(r,Date.now()+999999)),mutate(r=>tickDoudizhu(r,Date.now()+999999))]);
 await closeDatabase();r=await readRoom();assert.deepEqual(r.members.map(m=>m.wallet),balances);assert.equal(totalChips(r),assets);
 assert.equal(await(await db()).collection("audit").countDocuments({what:"doudizhu.settlement"}),1);
 assert.equal(r.doudizhu![0].players.reduce((n,p)=>n+p.escrow,0),0);
 const stranger=users.find(u=>!active.some(a=>a.id===u.id))!;assert.equal((await doudizhuRead(stranger,code)).room,null);
});
