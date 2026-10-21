import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fingerprintReport,possibleAltPlayers,FINGERPRINT_RETENTION_MS,adminFingerprintPlayers,type DeviceRecord} from "../lib/device-fingerprints";
const now=new Date("2026-10-20T12:00:00Z"),hash="a".repeat(64),other="b".repeat(64);
const members=[{id:"private-a",publicId:"pub-a",name:"Alice"},{id:"private-b",publicId:"pub-b",name:"Bob"},{id:"private-c",publicId:"pub-c",name:"Carol"}];
const record=(id:string,value=hash,lastSeen=now):DeviceRecord=>({_id:id,devices:[{hash:value,firstSeen:new Date(now.getTime()-1000),lastSeen}],expiresAt:new Date(now.getTime()+FINGERPRINT_RETENTION_MS)});
test("only a lowercase SHA-256 hash is accepted; no identity override or raw components",()=>{
 assert.deepEqual(fingerprintReport.parse({hash}),{hash});
 for(const body of [{hash:"raw-id"},{hash:"A".repeat(64)},{hash,userId:"another"},{hash,components:{}},{hash,visitorId:"raw"},{}])assert.equal(fingerprintReport.safeParse(body).success,false);
});
test("shared devices flag both accounts, exclude self, and never expose hashes or internal IDs",()=>{
 const result=possibleAltPlayers(members,[record("private-a"),record("private-b"),record("private-c",other)],now);
 assert.deepEqual(result[0].possibleAlts.map(a=>a.name),["Bob"]);
 assert.deepEqual(result[1].possibleAlts.map(a=>a.name),["Alice"]);
 assert.deepEqual(result[2].possibleAlts,[]);
 const text=JSON.stringify(result);
 assert.equal(text.includes(hash),false);assert.equal(text.includes("private-"),false);
 assert.equal(result[0].possibleAlts[0].lastSeen,now.toISOString());
});
test("multiple shared hashes deduplicate accounts; expired hashes and unknown users are excluded",()=>{
 const a=record("private-a");a.devices.push({...a.devices[0],hash:other});
 const b=record("private-b");b.devices.push({...b.devices[0],hash:other});
 assert.equal(possibleAltPlayers(members,[a,b],now)[0].possibleAlts.length,1);
 const expired=new Date(now.getTime()-FINGERPRINT_RETENTION_MS);
 const result=possibleAltPlayers(members,[record("private-a"),record("private-b",hash,expired),record("outsider")],now);
 assert.deepEqual(result[0].possibleAlts,[]);assert.equal(result[1].lastSeen,null);
});
test("ordinary accounts cannot read reports, even before any Mongo connection",async()=>{
 await assert.rejects(adminFingerprintPlayers({id:"x",name:"X",email:"x@test",admin:false},members),{status:403});
});
test("collection is advisory only, authenticated, origin checked, and never enters public snapshots",()=>{
 const reporter=readFileSync(new URL("../app/api/device-fingerprint/route.ts",import.meta.url),"utf8");
 const admin=readFileSync(new URL("../app/api/admin/possible-alts/route.ts",import.meta.url),"utf8");
 assert.match(reporter,/endpoint\(request/);assert.match(reporter,/recordFingerprint\(who,hash\)/);
 assert.match(admin,/ensure\(who.admin/);
 for(const p of ["../lib/public.ts","../lib/poker.ts","../lib/blackjack.ts","../lib/roulette.ts"])assert.doesNotMatch(readFileSync(new URL(p,import.meta.url),"utf8"),/device-fingerprints|possibleAltPlayers/);
 const client=readFileSync(new URL("../app/device-fingerprint.tsx",import.meta.url),"utf8");
 assert.match(client,/monitoring:false/);assert.match(client,/import\("@fingerprintjs\/fingerprintjs"\)/);
 assert.match(client,/"SHA-256"/);assert.match(client,/JSON.stringify\(\{hash\}\)/);
});
