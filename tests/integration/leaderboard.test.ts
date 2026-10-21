import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,rooms,closeDatabase} from "../../lib/db";
import {freshRoom,register} from "../../lib/poker";
import {advancementView} from "../../lib/advancements";
import {getLeaderboard} from "../../lib/leaderboard-store";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Requires isolated test DB");
process.env.MONGODB_DB+="_leaderboard";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
test("anonymous reads never initialize rooms, and cached maintenance snapshots expose only safe rows",async()=>{
 const collection=await rooms();
 assert.equal(await collection.countDocuments(),0);
 assert.deepEqual((await getLeaderboard()).rows,[]);
 assert.equal(await collection.countDocuments(),0);
 // No Clerk profile is available in this isolated fixture. Saved names must not leak.
 // A new process also independently exercises the anonymous read.
 const room=freshRoom();register(room,{id:"user_private123",name:"Public Tester",email:"hidden@private.test",admin:true});
 room.siteMaintenance=true;await collection.insertOne(room);
 const before=await collection.findOne({_id:"main"});
 const {execFile}=await import("node:child_process");
 const json=await new Promise<string>((resolve,reject)=>{
  execFile(process.execPath,["--import","tsx","-e",`const {getLeaderboard}=require("./lib/leaderboard-store");const {closeDatabase}=require("./lib/db");getLeaderboard().then(s=>{console.log(JSON.stringify(s));return closeDatabase();}).catch(()=>process.exit(1))`],{env:process.env},(error,stdout)=>error?reject(error):resolve(stdout));
 });
 assert.deepEqual(JSON.parse(json).rows,[{rank:1,advancements:advancementView(room.members[0]),name:"Player",avatar:"P",netWorth:100000}]);
 assert.deepEqual(await collection.findOne({_id:"main"}),before);
 assert.equal(await collection.countDocuments(),1);
 for(const secret of ["user_private123","hidden@private.test",room.members[0].publicId])assert.equal(json.includes(secret),false);
});
