import {test,after} from "node:test";
import assert from "node:assert/strict";
import {db,closeDatabase,readRoom} from "../../lib/db";
import {mutate} from "../../lib/store";
import {register} from "../../lib/poker";
import {marketSymbols} from "../../lib/symbol-registry";
import {changeMarketSymbol} from "../../lib/admin-symbols";
import {persistExchangeTicks} from "../../lib/prices";
import {candleRead} from "../../lib/candles";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Requires isolated test DB");
process.env.MONGODB_DB+="_admin_symbols";
after(async()=>{await(await db()).dropDatabase();await closeDatabase();});
const admin={id:"admin",name:"Admin",email:"admin@test",admin:true};
test("Mongo registry seeds old rooms once, concurrent admin changes conflict, reconnect retains registry and dynamic candles",async()=>{
 const c=(await db()).collection("rooms");
 await readRoom();await c.updateOne({_id:"main"} as never,{$unset:{marketSymbols:""}});
 await readRoom();let room=await readRoom();
 assert.equal(marketSymbols(room).stocks.length,7);
 const version=room.version;await readRoom();assert.equal((await readRoom()).version,version);
 await mutate(r=>{register(r,admin);});
 const results=await Promise.allSettled([
  mutate(r=>changeMarketSymbol(r,admin,{action:"add",kind:"crypto",symbol:"ADA",expectedVersion:0})),
  mutate(r=>changeMarketSymbol(r,admin,{action:"add",kind:"crypto",symbol:"DOGE",expectedVersion:0}))
 ]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 assert.equal(results.filter(r=>r.status==="rejected").length,1);
 await closeDatabase();room=await readRoom();
 const added=marketSymbols(room).crypto.find(s=>["ADA","DOGE"].includes(s))!;
 assert.ok(added);assert.equal(marketSymbols(room).revision,1);
 const now=Date.now();
 await persistExchangeTicks([{symbol:added,micro:1000000,at:now,sequence:1}]);
 await closeDatabase();room=await readRoom();assert.equal(room.quotes?.[added]?.micro,1000000);
 assert.equal((await candleRead(added,"1m",now-60000,now+60000)).length,1);
 await mutate(r=>changeMarketSymbol(r,admin,{action:"remove",kind:"crypto",symbol:added,expectedVersion:1,confirmed:true}));
 await persistExchangeTicks([{symbol:added,micro:2000000,at:now+1,sequence:2}]);
 await closeDatabase();room=await readRoom();
 assert.equal(room.quotes?.[added]?.micro,1000000);assert.ok(marketSymbols(room).delisted.includes(added));
 assert.equal((await candleRead(added,"1m",now-60000,now+60000))[0].close,1);
 assert.equal(await(await db()).collection("audit").countDocuments({what:{$in:["market-symbol-add","market-symbol-remove"]}}),2);
});
