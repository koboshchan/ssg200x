import {test,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {MongoClient} from "mongodb";
import {freshRoom,assertRoom} from "../../lib/poker";
import {applications,credentials,grants,transactions,appIndexes} from "../../lib/app-model";
import {moveAppMoney} from "../../lib/app-money";
import {DEFAULT_LIMITS,DEFAULT_LIMITS as L,SCOPES,digest} from "../../lib/app-policy";
import type {Room} from "../../lib/types";
import type {AppClient} from "../../lib/app-auth";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_app_"))throw new Error("Refusing non-test database");
test("standalone Mongo rejects finance atomically without fallback",{skip:!process.env.APP_TEST_STANDALONE_URI},async()=>{
 const client=await new MongoClient(process.env.APP_TEST_STANDALONE_URI!).connect(),d=client.db(process.env.MONGODB_DB+"_standalone");
 try{
 assert.equal((await d.admin().command({hello:1})).setName,undefined);await d.dropDatabase();await appIndexes(d);
 const now=new Date(),app={_id:randomUUID(),clientId:"test-client",ownerUserId:"owner",name:"Standalone",description:"Test",website:"https://test.invalid",status:"approved" as const,approvedScopes:[...SCOPES],creditMode:"refunds" as const,limits:L,mintLimits:{per_operation_cents:0,daily_cents:0,lifetime_cents:0},appDailyCents:1000000,policyVersion:1,fence:0,createdAt:now,updatedAt:now},credential={_id:"ac_"+randomUUID(),appId:app._id,secretHash:digest("credential","fake"),prefix:"ac_test",scopes:[...SCOPES],createdAt:now,expiresAt:new Date(Date.now()+600000),revokedAt:null,fence:0},g={_id:randomUUID(),appId:app._id,userId:"a",appUserId:randomUUID(),externalSubject:"test",scopes:[...SCOPES],limits:L,policyVersion:1,authorizationVersion:randomUUID(),fence:0,createdAt:now,expiresAt:new Date(Date.now()+600000),revokedAt:null};
 const room=freshRoom();room.members=[{id:"a",publicId:"a-public",name:"A",email:"a@example.test",approved:true,wallet:100000,joined:Date.now()}];assertRoom(room);
 await applications(d).insertOne(app);await credentials(d).insertOne(credential);await grants(d).insertOne(g);await d.collection<Room>("rooms").insertOne(room);
 await assert.rejects(()=>moveAppMoney(d,{app,credential} as AppClient,g.appUserId,"debit",randomUUID(),{amount_cents:70000,description:"item",external_reference:"item-42"}));
 assert.equal((await d.collection("rooms").findOne({_id:"main" as never}))!.members[0].wallet,100000);assert.equal(await transactions(d).countDocuments({}),0);assert.equal(await d.collection("app_audit").countDocuments({}),0);
 }finally{await d.dropDatabase();await client.close();}
});
