import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MongoClient} from 'mongodb';
import {createIdentity,newEpochKey,makeWrap,sealMessage,openMessage,signText,registerData} from '../../lib/chat-crypto';
// @ts-expect-error runtime
import {createPokerChatService} from '../../runtime/poker-chat-service.mjs';
// @ts-expect-error runtime
import {gameChatTransactions} from '../../runtime/game-chat-transaction.mjs';
// @ts-expect-error runtime
import {createGameChatRuntime} from '../../runtime/game-chat-runtime.mjs';
// @ts-expect-error runtime
import {gameChatRoom} from '../../runtime/game-chat-context.mjs';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_game_runtime');
after(async()=>{await db.dropDatabase();await client.close();});
const socket=(id:string,user:string):any=>({id,connected:true,data:{identity:{id:user}}});
test('real Mongo runtime authorizes fixed viewers, actual DDZ roster and spectators, no route-only access or closed-room archive',async()=>{
 await db.collection('rooms').insertOne({_id:'main' as never,version:1,members:['alice','bob','carol','revoked'].map(id=>({id,approved:true,accessRevoked:id==='revoked'})),doudizhu:[{code:'a0b1-1234',ownerId:'alice',players:[{userId:'alice'}],spectators:[{userId:'bob',seenAt:Date.now()}]}]});
 const service=createPokerChatService(db);await service.ready;
 const a=socket('a','alice'),b=socket('b','bob'),c=socket('c','carol'),r=socket('r','revoked');
 await assert.rejects(service.handle('alice','state',{v:1,chatRoom:'game-poker-01'},a),/context_required/);
 await assert.rejects(service.subscribe(r,{kind:'poker',id:'01'}),/forbidden/);
 assert.deepEqual(await service.subscribe(a,{kind:'poker',id:'01'}),{chatRoom:'game-poker-01'});
 await service.subscribe(b,{kind:'poker',id:'01'});
 let state=await service.handle('alice','state',{v:1,chatRoom:'game-poker-01'},a);
 assert.deepEqual(state.members.map((m:any)=>m.userId),['alice','bob']);
 assert.equal((await db.collection('game_chat_contexts').findOne({_id:'game-poker-01' as never}))?.creatorId,'alice');
 await service.subscribe(b,{kind:'blackjack',id:'02'});
 await assert.rejects(service.handle('bob','state',{v:1,chatRoom:'game-poker-01'},b),/context_required/);
 state=await service.handle('alice','state',{v:1,chatRoom:'game-poker-01'},a);assert.deepEqual(state.members.map((m:any)=>m.userId),['alice']);
 await service.subscribe(a,{kind:'ddz',id:'a0b1-1234'});await service.subscribe(b,{kind:'ddz',id:'a0b1-1234'});
 await assert.rejects(service.subscribe(c,{kind:'ddz',id:'a0b1-1234'}),/forbidden/);
 const ddz='game-ddz-a0b1-1234';
 assert.equal(gameChatRoom('ddz','a0b1-1234'),ddz);
 state=await service.handle('alice','state',{v:1,chatRoom:ddz},a);assert.deepEqual(state.members.map((m:any)=>m.userId),['alice','bob']);
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{'doudizhu.0.spectators.0.seenAt':Date.now()-46000},$inc:{version:1}});
 await assert.rejects(service.handle('bob','state',{v:1,chatRoom:ddz},b),/forbidden/);
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{doudizhu:[]},$inc:{version:1}});
 await assert.rejects(service.handle('alice','state',{v:1,chatRoom:ddz},a),/room_closed/);
 await assert.rejects(service.subscribe(a,{kind:'pool',id:crypto.randomUUID()}),/room_closed/);
 assert.equal((await service.handle('alice','state',{v:1})).room,'main');
 await service.subscribe(a,{kind:'roulette',id:'01'});await service.leave(a);
 await assert.rejects(service.handle('alice','state',{v:1,chatRoom:'game-roulette-01'},a),/context_required/);
});
test('real dispatcher keeps ciphertext and creator-owned bootstrap across namespaces, global reset gate serializes every game operation',async()=>{
 const service=createPokerChatService(db);await service.ready;
 const a=socket('crypto-a','alice'),b=socket('crypto-b','bob');
 const ai=(await createIdentity('alice',0)).identity,bi=(await createIdentity('bob',0)).identity;
 for(const [user,identity]of [['alice',ai],['bob',bi]]as const)await service.handle(user,'register',{v:1,deviceId:identity.deviceId,dhPublic:identity.dhPublic,signPublic:identity.signPublic,signature:await signText(identity.signPrivate,registerData(user,identity))});
 await service.subscribe(a,{kind:'blackjack',id:'03'});await service.subscribe(b,{kind:'blackjack',id:'03'});
 const chatRoom='game-blackjack-03';
 let state=await service.handle('alice','state',{v:1,chatRoom},a);
 await assert.rejects(service.handle('bob','claim',{v:1,chatRoom,revision:state.revision,epoch:state.epoch,deviceId:bi.deviceId},b),/waiting/);
 state=await service.handle('alice','claim',{v:1,chatRoom,revision:state.revision,epoch:state.epoch,deviceId:ai.deviceId},a);
 const key=await newEpochKey(),header={room:chatRoom,revision:state.revision,epoch:state.epoch};
 await service.handle('alice','wrap',{chatRoom,...await makeWrap(ai,'alice',{...header,toUserId:'alice',toDeviceId:ai.deviceId},ai.dhPublic,key)},a);
 await service.handle('alice','wrap',{chatRoom,...await makeWrap(ai,'alice',{...header,toUserId:'bob',toDeviceId:bi.deviceId},bi.dhPublic,key)},a);
 const secret='ACTUAL_DISPATCHER_CIPHERTEXT_ONLY';
 await service.handle('alice','send',{chatRoom,...await sealMessage(ai,'alice',{...header,id:crypto.randomUUID(),ts:Date.now()},secret,key)},a);
 const history=await service.handle('bob','history',{v:1,chatRoom,epoch:state.epoch,deviceId:bi.deviceId},b);
 assert.equal(history.messages.length,1);const decoded=await openMessage(history.messages[0],key);assert.equal(decoded.ok,true);if(decoded.ok)assert.equal(decoded.text,secret);
 assert.equal(JSON.stringify(await db.collection('chat_messages').find({}).toArray()).includes(secret),false);
 // The same dispatch queue owns the reset call and game handlers, including all dynamic services.
 // An invalid reset must not poison the queue or expose game operations around it.
 const reset=service.adminReset('alice',{v:1});
 const following=service.handle('bob','state',{v:1,chatRoom},b);
 await assert.rejects(reset,/malformed/);assert.equal((await following).room,chatRoom);
 await service.leave(b);b.connected=false;
 await assert.rejects(service.handle('bob','history',{v:1,chatRoom,epoch:state.epoch,deviceId:bi.deviceId},b),/context_required/);
 const remaining=await service.handle('alice','state',{v:1,chatRoom},a);assert.notEqual(remaining.epoch,state.epoch);
});
test('admin reset blocks all dynamic game handlers until global key revocation completes',async()=>{
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{'members.1.publicId':'bbbbbbbbbbbbbbbb'},$inc:{version:1}});
 let release!:()=>void,entered!:()=>void;
 const paused=new Promise<void>(r=>entered=r),barrier=new Promise<void>(r=>release=r);
 const clerk={users:{getUser:async(id:string)=>{if(id==='bob'){entered();await barrier;}return {privateMetadata:{admin:id==='alice'},publicMetadata:{}};},updateUserMetadata:async()=>({})}};
 const service=createPokerChatService(db,{clerk});await service.ready;
 const a=socket('reset-a','alice'),b=socket('reset-b','bob');
 await service.subscribe(a,{kind:'poker',id:'02'});await service.subscribe(b,{kind:'poker',id:'02'});
 const reset=service.adminReset('alice',{v:1,publicId:'bbbbbbbbbbbbbbbb',requestId:crypto.randomUUID(),requestAt:Date.now(),confirm:true});
 await paused;
 let completed=false;
 const following=service.handle('alice','state',{v:1,chatRoom:'game-poker-02'},a).then((s:any)=>{completed=true;return s;});
 await new Promise(r=>setImmediate(r));assert.equal(completed,false);
 release();assert.deepEqual(await reset,{reset:true});await following;
 assert.equal((await db.collection('chat_identity_versions').findOne({_id:'bob' as never}))?.status,'setup_required');
 assert.equal(await db.collection('chat_devices').countDocuments({userId:'bob'}),0);
 assert.equal(await db.collection('chat_wraps').countDocuments({toUserId:'bob'}),0);
});
test('fixed-table eligible owner election avoids dead bootstrap after creator leaves; stale leave cannot clear a newer context',async()=>{
 const service=createPokerChatService(db);await service.ready;
 const a=socket('owner-a','alice'),b=socket('owner-b','carol');
 await service.subscribe(a,{kind:'blackjack',id:'01'});await service.subscribe(b,{kind:'blackjack',id:'01'});
 assert.equal((await db.collection('game_chat_contexts').findOne({_id:'game-blackjack-01' as never}))?.creatorId,'alice');
 await service.leave(a);
 await service.handle('carol','state',{v:1,chatRoom:'game-blackjack-01'},b);
 assert.equal((await db.collection('game_chat_contexts').findOne({_id:'game-blackjack-01' as never}))?.creatorId,'carol');
 await service.subscribe(b,{kind:'poker',id:'03'});
 await service.leave(b,{kind:'blackjack',id:'01'});
 assert.equal(b.data.gameChatRoom,'game-poker-03');
 assert.equal((await service.handle('carol','state',{v:1,chatRoom:'game-poker-03'},b)).room,'game-poker-03');
});
test('transaction fences independent production-style room CAS writers, aborting stale chat effects',async()=>{
 const tx=gameChatTransactions(db),runtime=createGameChatRuntime(tx.db),a=socket('txn','alice');
 await tx.run(()=>runtime.subscribe(a,{kind:'poker',id:'03'}));
 let release!:()=>void,observed!:()=>void;
 const barrier=new Promise<void>(r=>release=r),started=new Promise<void>(r=>observed=r);
 const operation=tx.run(async()=>{
  const ctx=await runtime.resolveContext('game-poker-03','alice');
  await tx.db.collection('chat_test_receipts').insertOne({_id:'must-abort'});
  observed();await barrier;
  assert.equal(await runtime.fenceContext('game-poker-03','alice',ctx.version),true);
 });
 await started;
 const room=await db.collection('rooms').findOne({_id:'main' as never});
 assert.equal((await db.collection('rooms').updateOne({_id:'main' as never,version:room!.version},{$set:{'members.0.accessRevoked':true},$inc:{version:1}})).matchedCount,1);
 release();await assert.rejects(operation,/stale_revision/);
 assert.equal(await db.collection('chat_test_receipts').countDocuments({}),0);
 await assert.rejects(tx.run(()=>runtime.resolveContext('game-poker-03','alice')),/forbidden/);
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{'members.0.accessRevoked':false},$inc:{version:1}});
});
test('transactions reject standalone Mongo instead of using a local queue as production guarantee',async()=>{
 const uri=process.env.GAME_CHAT_STANDALONE_URI;if(!uri)return;
 const standalone=new MongoClient(uri),standaloneDb=standalone.db(process.env.MONGODB_DB+'_standalone');
 try{
  const tx=gameChatTransactions(standaloneDb);
  await assert.rejects(tx.run(()=>tx.db.collection('probe').insertOne({_id:'no'})),/context_transactions_required/);
  assert.equal(await standaloneDb.collection('probe').countDocuments({}),0);
 }finally{await standaloneDb.dropDatabase();await standalone.close();}
});
test('transaction aborts DDZ ciphertext effects if independent writer closes the real room',async()=>{
 const tx=gameChatTransactions(db),runtime=createGameChatRuntime(tx.db),a=socket('close-race','alice');
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{doudizhu:[{code:'close-race',ownerId:'alice',players:[{userId:'alice'}]}]},$inc:{version:1}});
 await tx.run(()=>runtime.subscribe(a,{kind:'ddz',id:'close-race'}));
 let release!:()=>void,entered!:()=>void;
 const barrier=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const operation=tx.run(async()=>{
  const ctx=await runtime.resolveContext('game-ddz-close-race','alice');
  await tx.db.collection('chat_test_receipts').insertOne({_id:'closed-must-abort'});
  entered();await barrier;await runtime.fenceContext('game-ddz-close-race','alice',ctx.version);
 });
 await started;await db.collection('rooms').updateOne({_id:'main' as never},{$set:{doudizhu:[]},$inc:{version:1}});
 release();await assert.rejects(operation,/stale_revision/);
 assert.equal(await db.collection('chat_test_receipts').countDocuments({_id:'closed-must-abort' as never}),0);
 await assert.rejects(tx.run(()=>runtime.resolveContext('game-ddz-close-race','alice')),/room_closed/);
});
test('disconnected presence and cross-scope signed envelopes fail closed; authoritative pool adapter can close',async()=>{
 const service=createPokerChatService(db);await service.ready;
 const a=socket('scope-a','alice');await service.subscribe(a,{kind:'poker',id:'01'});
 await assert.rejects(service.handle('alice','state',{v:1,chatRoom:'game-poker-01',room:'game-blackjack-01'},a),/malformed/);
 a.connected=false;await assert.rejects(service.handle('alice','state',{v:1,chatRoom:'game-poker-01'},a),/context_required/);
 const tx=gameChatTransactions(db);
 const runtime=createGameChatRuntime(tx.db,{poolContext:async(id:string,_room:any,sessionDb:any)=>{
  const pool=await sessionDb.collection('test_authoritative_pool').findOneAndUpdate({_id:id},{$inc:{chatFence:1}},{returnDocument:'after'});
  return pool?{creatorId:pool.creatorId,members:pool.members,closed:pool.closed}:null;
 }});
 const id=crypto.randomUUID(),b=socket('pool-adapter','alice');
 await db.collection('test_authoritative_pool').insertOne({_id:id as never,creatorId:'alice',members:['alice'],closed:false});
 await tx.run(()=>runtime.subscribe(b,{kind:'pool',id}));
 assert.equal((await tx.run(()=>runtime.resolveContext('game-pool-'+id,'alice'))).creatorId,'alice');
 await db.collection('test_authoritative_pool').updateOne({_id:id as never},{$set:{closed:true}});
 await assert.rejects(tx.run(()=>runtime.resolveContext('game-pool-'+id,'alice')),/room_closed/);
});

test('remaining approved viewer can claim fresh fixed-table epoch after former creator leaves or is revoked',async()=>{
 const service=createPokerChatService(db);await service.ready;
 const a=socket('fresh-owner-a','alice'),c=socket('fresh-owner-c','carol');
 const ai=(await createIdentity('alice',0)).identity,ci=(await createIdentity('carol',0)).identity;
 for(const [user,identity]of [['alice',ai],['carol',ci]]as const)await service.handle(user,'register',{v:1,deviceId:identity.deviceId,dhPublic:identity.dhPublic,signPublic:identity.signPublic,signature:await signText(identity.signPrivate,registerData(user,identity))});
 await service.subscribe(a,{kind:'roulette',id:'01'});await service.subscribe(c,{kind:'roulette',id:'01'});
 let state=await service.handle('alice','state',{v:1,chatRoom:'game-roulette-01'},a);
 state=await service.handle('alice','claim',{v:1,chatRoom:'game-roulette-01',revision:state.revision,epoch:state.epoch,deviceId:ai.deviceId},a);
 const oldEpoch=state.epoch,key=await newEpochKey();
 await service.handle('alice','wrap',{chatRoom:'game-roulette-01',...await makeWrap(ai,'alice',{room:'game-roulette-01',revision:state.revision,epoch:state.epoch,toUserId:'alice',toDeviceId:ai.deviceId},ai.dhPublic,key)},a);
 await service.leave(a);
 state=await service.handle('carol','state',{v:1,chatRoom:'game-roulette-01'},c);assert.notEqual(state.epoch,oldEpoch);
 assert.equal((await service.handle('carol','claim',{v:1,chatRoom:'game-roulette-01',revision:state.revision,epoch:state.epoch,deviceId:ci.deviceId},c)).owner.userId,'carol');
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{'members.0.accessRevoked':true},$inc:{version:1}});
 await assert.rejects(service.subscribe(a,{kind:'roulette',id:'01'}),/forbidden/);
 await db.collection('rooms').updateOne({_id:'main' as never},{$set:{'members.0.accessRevoked':false},$inc:{version:1}});
});
test('foreign live chat owner fails closed rather than using a divergent process-local roster',async()=>{
 const leases=db.collection('game_chat_runtime_owner'),saved=await leases.findOne({_id:'single-owner' as never});
 await leases.updateOne({_id:'single-owner' as never},{$set:{owner:'foreign-live-process',until:Date.now()+30000}},{upsert:true});
 const tx=gameChatTransactions(db,{enforceOwner:true});
 try{await assert.rejects(tx.run(()=>tx.db.collection('chat_test_receipts').insertOne({_id:'foreign-owner-must-not-write'})),/chat_owner_conflict/);assert.equal(await db.collection('chat_test_receipts').countDocuments({_id:'foreign-owner-must-not-write' as never}),0);}
 finally{await leases.replaceOne({_id:'single-owner' as never},saved!);}
});

test('queued subscribe B followed by old A error cleanup preserves B inside dispatcher queue',async()=>{
 const service=createPokerChatService(db);await service.ready;
 const a=socket('cleanup-race','alice');await service.subscribe(a,{kind:'poker',id:'01'});
 const next=service.subscribe(a,{kind:'blackjack',id:'02'});
 // Simulates old A catch scheduling cleanup before queued subscribe B finishes.
 const cleanup=service.leave(a,{kind:'poker',id:'01'});
 await next;assert.equal(await cleanup,undefined);
 assert.equal(a.data.gameChatRoom,'game-blackjack-02');
 assert.equal((await service.handle('alice','state',{v:1,chatRoom:'game-blackjack-02'},a)).room,'game-blackjack-02');
 assert.equal(a.connected,true);
});

test('actual server closed-context cleanup call preserves queued newer subscription',async()=>{
 const source=readFileSync(new URL('../../server.mjs',import.meta.url),'utf8');
 const start=source.indexOf('     const match=/^game-');
 const end=source.indexOf('\n    }\n    if((error.chatCode',start);
 assert.ok(start>=0&&end>start,'server contextual cleanup source is present');
 const cleanupSource=source.slice(start,end);
 assert.equal(cleanupSource.includes('socket.data.gameChatRoom==='),false);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 // Execute the actual server catch body, not a reconstructed runtime.leave call.
 const cleanup=new AsyncFunction('socket','chat','payload','hintChatChanged',cleanupSource);
 const service=createPokerChatService(db);await service.ready;
 const a=socket('actual-cleanup-race','alice'),events:any[]=[],hints:any[]=[];
 a.emit=(event:string,payload:any)=>events.push({event,payload});
 await service.subscribe(a,{kind:'poker',id:'02'});
 const newer=service.subscribe(a,{kind:'blackjack',id:'03'});
 const oldCleanup=cleanup(a,service,{chatRoom:'game-poker-02'},(room:any)=>hints.push(room));
 await Promise.all([newer,oldCleanup]);
 assert.equal(a.data.gameChatRoom,'game-blackjack-03');
 assert.equal((await service.handle('alice','state',{v:1,chatRoom:'game-blackjack-03'},a)).room,'game-blackjack-03');
 assert.deepEqual(events,[{event:'game-chat:closed',payload:{chatRoom:'game-poker-02',kind:'poker',id:'02'}}]);
 assert.equal(a.connected,true);
});
