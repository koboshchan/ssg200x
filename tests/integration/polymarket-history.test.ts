import {test} from 'node:test';import assert from 'node:assert/strict';import {MongoClient} from 'mongodb';
// @ts-expect-error server runtime module
import {createPolymarketHistory,authorizePolymarketHistory} from '../../runtime/polymarket-history.mjs';
test('real Mongo history singleflight, restart reuse, held authorization and bounded append survive reconnection',async()=>{
 const name=process.env.MONGODB_DB||'';assert.match(name,/^fakebucks_test_/);const uri=process.env.MONGODB_URI;assert.ok(uri);let client=await MongoClient.connect(uri);let database=client.db(name),collection=database.collection<any>('polymarket_history');await collection.deleteOne({_id:'987654321'});let fetches=0;
 let time=1700000000000;const options={collection,authorize:async()=>true,resolveToken:async()=> '111',fetchHistory:async()=>{fetches++;return[{t:1699999990,p:.5}];},now:()=>time,maxPoints:3};
 try{
  const first=createPolymarketHistory(options);await Promise.all(Array.from({length:25},()=>first.read('987654321','all',{userId:'u'})));assert.equal(fetches,1);await client.close();
  client=await MongoClient.connect(uri);database=client.db(name);collection=database.collection<any>('polymarket_history');const second=createPolymarketHistory({...options,collection});assert.equal((await second.read('987654321','all',{userId:'u'})).points.length,1);assert.equal(fetches,1);
  for(let i=0;i<6;i++){time+=61000;await second.append('987654321','111',{source:'stream',bids:[{price:'.5'}],asks:[{price:'.6'}]});}assert.equal((await collection.findOne({_id:'987654321'}))?.points.length,3);
  const rooms=database.collection<any>('rooms');await rooms.updateOne({_id:'poly-history-auth'},{$set:{polymarket:{positions:[{userId:'owner',marketId:'987654321',shareMicros:10}]}}},{upsert:true});
  const auth={marketId:'987654321',demand:{userId:'owner'},collection:{findOne:(query:any,opts:any)=>rooms.findOne({...query,_id:'poly-history-auth'},opts)},sockets:()=>[],checkTab:()=> 'missing tab',checkSession:async()=>{}};
  assert.equal(await authorizePolymarketHistory(auth),true);assert.equal(await authorizePolymarketHistory({...auth,demand:{userId:'stranger'}}),false);await rooms.deleteOne({_id:'poly-history-auth'});
 }finally{await client.db(name).collection<any>('polymarket_history').deleteOne({_id:'987654321'});await client.close();}
});
