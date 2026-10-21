import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register,assertRoom} from "../../lib/poker";
import {casinoLimits} from "../../lib/casino-limits";
import {changeCasinoLimits} from "../../lib/admin-casino-limits";
import {rouletteAction,rouletteState,rouletteTick} from "../../lib/roulette";
import {blackjackTablesAction as act,blackjackTablesTick,blackjackTablesPublic} from "../../lib/blackjack";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw new Error("Requires isolated test DB");
process.env.MONGODB_DB+="_casino_limits";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
const admin={id:"admin",name:"Admin",email:"admin@test",admin:true},user={id:"user",name:"User",email:"user@test",admin:false};
test("Mongo CAS persists limits through reconnect; concurrent edits conflict; live roulette and BJ mutation re-read latest limits",async()=>{
 await mutate(r=>{register(r,admin,0);register(r,user,0);});
 const results=await Promise.allSettled([
  mutate(r=>changeCasinoLimits(r,admin,{rouletteMaxTotal:10000,blackjackMaxHand:10000,expectedVersion:0})),
  mutate(r=>changeCasinoLimits(r,admin,{rouletteMaxTotal:20000,blackjackMaxHand:20000,expectedVersion:0}))
 ]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
 await closeDatabase();let room=await readRoom();assert.equal(casinoLimits(room).revision,1);
 await mutate(r=>{
  changeCasinoLimits(r,admin,{rouletteMaxTotal:1000,blackjackMaxHand:1000,expectedVersion:casinoLimits(r).revision});
  rouletteState(r,0);rouletteAction(r,user,{type:"bet",bet:{kind:"red",amount:500}},1,"r1",0);
  act(r,user,{tableId:"lounge",type:"join",seat:0},0);
  act(r,user,{tableId:"lounge",type:"bet",amount:500,chips:[500]},0);
  r.blackjackTables!.tables.lounge!.shoe=[...Array(180).fill("2s"),...["8s","Th","8h","7d","2c","3c"].reverse()];
  blackjackTablesTick(r,10000);
 });
 await mutate(r=>changeCasinoLimits(r,admin,{rouletteMaxTotal:100,blackjackMaxHand:100,expectedVersion:casinoLimits(r).revision}));
 await closeDatabase();room=await readRoom();const before=structuredClone(room);
 await assert.rejects(()=>mutate(r=>rouletteAction(r,user,{type:"bet",bet:{kind:"black",amount:100}},1,"r2",1)),/limit/);
 await assert.rejects(()=>mutate(r=>act(r,user,{tableId:"lounge",type:"double"},10001)),/limit/);
 await assert.rejects(()=>mutate(r=>act(r,user,{tableId:"lounge",type:"split"},10001)),/limit/);
 assert.deepEqual(await readRoom(),before);
 const table=blackjackTablesPublic(room,user).tables[0];assert.equal(table.maxBet,100);assert.equal(table.legal.double,false);assert.equal(table.legal.split,false);
 await mutate(r=>{rouletteTick(r,60000,()=>1);act(r,user,{tableId:"lounge",type:"stand"},10002);});
 await closeDatabase();room=await readRoom();assertRoom(room);
 assert.equal(casinoLimits(room).rouletteMaxTotal,100);assert.equal(room.blackjackTables!.tables.lounge!.phase,"settled");
 assert.equal((await(await db()).collection("audit").countDocuments({what:"casino-limits"})),3);
});
