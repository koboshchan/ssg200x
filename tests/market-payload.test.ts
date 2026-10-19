import {test} from "node:test";
import assert from "node:assert/strict";
import {freshRoom,register} from "../lib/poker";
import {spot,openPosition} from "../lib/finance";
import {publicRoom} from "../lib/public";
// JS module is also consumed directly by the custom server without a TS loader.
// @ts-expect-error runtime JavaScript has no generated declarations
import {marketPayload} from "../runtime/market-payload.mjs";
test("socket payload uses verified identity only and matches private market calculations",()=>{
 const r=freshRoom(),now=Date.now(),who={id:"alice-private",name:"Alice",email:"alice-secret@test",admin:true};register(r,who);register(r,{id:"bob-private",name:"Bob",email:"bob-secret@test",admin:false});
 r.quotes={BTC:{micro:100_000_000_000,at:now}};spot(r,who,"BTC","buy",10000,now);openPosition(r,who,"BTC","long",1000,200,"alice-position",now);r.quotes.BTC!.micro+=100_000_000;
 const payload=marketPayload(r,who.id,now),full=publicRoom(r,who);
 assert.deepEqual(payload.holdings,full.holdings);assert.equal(payload.positions[0].pnl,full.positions[0].pnl);assert.equal(payload.positions[0].equity,full.positions[0].equity);assert.equal(payload.positions[0].liquidation,full.positions[0].liquidation);assert.equal(payload.wallet,full.me.wallet);
 assert.equal(marketPayload(r,"unknown"),null);const bob=marketPayload(r,"bob-private",now);assert.deepEqual(bob.positions,[]);assert.deepEqual(bob.holdings,[]);
 const serialized=JSON.stringify(payload);for(const secret of ["alice-private","bob-private","alice-secret@test","bob-secret@test","receipts","adminUsers"])assert.equal(serialized.includes(secret),false);
 assert.equal(marketPayload(r,"bob-private",now).wallet,100000);
});
