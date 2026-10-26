import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {createIdentity,newEpochKey,makeWrap,openWrap,sealMessage,openMessage,signText,registerData} from '../../lib/chat-crypto';
// @ts-expect-error runtime
import {createChatService} from '../../runtime/chat-service.mjs';
// @ts-expect-error runtime
import {validChatRoom,gameChatRoom} from '../../runtime/game-chat-context.mjs';
if(!process.env.MONGODB_DB?.startsWith('fakebucks_test_'))throw Error('Isolated database required');
const client=new MongoClient(process.env.MONGODB_URI!),db=client.db(process.env.MONGODB_DB+'_game_scope');
after(async()=>{await db.dropDatabase();await client.close();});
test('strict contextual names never authorize arbitrary contexts',()=>{
 for(const kind of ['poker','blackjack'])for(const id of ['01','02','03'])assert.equal(validChatRoom(gameChatRoom(kind,id)),true);
 for(const room of ['game-poker-04','game-blackjack-1','game-dice-01','game-pool-../private','game-ddz-','other','game-roulette-02'])assert.equal(validChatRoom(room),false);
 assert.throws(()=>createChatService(db,{roomId:'game-poker-01'}),/Invalid chat room/);
});
test('per-game ciphertext namespaces use existing signed key shares, creator bootstrap, authorization and closure',async()=>{
 await db.collection('rooms').insertOne({_id:'main' as never,version:1,members:['alice','bob','outsider'].map(id=>({id,approved:true}))});
 const a=(await createIdentity('alice',0)).identity,b=(await createIdentity('bob',0)).identity;
 const contexts=new Map<string,any>();
 const resolveContext=async(room:string)=>contexts.get(room);
 const fenceContext=async(room:string,user:string,version:number)=>{const c=contexts.get(room);if(!c||c.closed)throw Error('room_closed');if(!c.members.includes(user))throw Error('forbidden');return c.version===version;};
 const main=createChatService(db);await main.ready;
 for(const [user,id] of [['alice',a],['bob',b]] as const)await main.handle(user,'register',{v:1,deviceId:id.deviceId,dhPublic:id.dhPublic,signPublic:id.signPublic,signature:await signText(id.signPrivate,registerData(user,id))});
 const rooms=['main','poker-02','poker-03',...['01','02','03'].flatMap(id=>['game-poker-'+id,'game-blackjack-'+id]),'game-roulette-01','game-ddz-demo1','game-ddz-demo2','game-pool-demo1','game-pool-demo2'];
 const records=new Map<string,any>();
 for(const room of rooms){
  const contextual=room.startsWith('game-');
  contexts.set(room,{creatorId:'alice',members:['alice','bob'],version:1});
  const service=createChatService(db,{roomId:room,...(contextual?{resolveContext,fenceContext}:{})});await service.ready;
  if(contextual)await assert.rejects(service.handle('outsider','state',{v:1}),/forbidden/);
  const economicBefore=await db.collection('rooms').findOne({_id:'main' as never});
  let state=await service.handle('alice','state',{v:1});
  if(contextual)await assert.rejects(service.handle('bob','claim',{v:1,revision:state.revision,epoch:state.epoch,deviceId:b.deviceId}),/waiting/);
  state=await service.handle('alice','claim',{v:1,revision:state.revision,epoch:state.epoch,deviceId:a.deviceId});
  const key=await newEpochKey();
  const header={room,revision:state.revision,epoch:state.epoch};
  await service.handle('alice','wrap',await makeWrap(a,'alice',{...header,toUserId:'alice',toDeviceId:a.deviceId},a.dhPublic,key));
  // Unwrapped joiners cannot send or read until an online holder shares an authenticated wrap.
  await assert.rejects(service.handle('bob','history',{v:1,epoch:state.epoch,deviceId:b.deviceId}),/waiting/);
  const grant=(await service.handle('alice','wrap',await makeWrap(a,'alice',{...header,toUserId:'bob',toDeviceId:b.deviceId},b.dhPublic,key))).wrap;
  const peerKey=await openWrap(b,'bob',grant,a,room);
  const secret='PRIVATE_GAME_CANARY_'+room;
  const envelope=await sealMessage(a,'alice',{...header,id:crypto.randomUUID(),ts:Date.now()},secret,key);
  const sent=await service.handle('alice','send',envelope);
  const history=await service.handle('bob','history',{v:1,epoch:state.epoch,deviceId:b.deviceId});
  assert.equal(history.messages.length,1);assert.equal(history.messages[0].room,room);
  const decoded=await openMessage(history.messages[0],peerKey);
  assert.equal(decoded.ok,true);if(decoded.ok)assert.equal(decoded.text,secret);
  records.set(room,{state,envelope,service,secret});
  if(contextual){const economicAfter=await db.collection('rooms').findOne({_id:'main' as never});assert.deepEqual(economicAfter,economicBefore);}
  assert.equal(sent.message.ciphertext.includes(secret),false);
 }
 for(const [room,r] of records){
  const foreign=records.get(room==='main'?'game-poker-01':'main');
  await assert.rejects(r.service.handle('alice','send',{...foreign.envelope,room,epoch:r.state.epoch,revision:r.state.revision}),/invalid_signature/);
  await assert.rejects(r.service.handle('bob','history',{v:1,epoch:foreign.state.epoch,deviceId:b.deviceId}),/waiting/);
 }
 // A missing creator fails closed; noncreators cannot take an expired bootstrap lease.
 const invalidContext='game-pool-invalid';contexts.set(invalidContext,{members:['alice','bob'],version:1});
 const invalid=createChatService(db,{roomId:invalidContext,resolveContext,fenceContext});await invalid.ready;
 await assert.rejects(invalid.handle('bob','state',{v:1}),/forbidden/);
 const leaseRecord=records.get('game-blackjack-03');
 await db.collection('chat_states').updateOne({_id:'game-blackjack-03' as never},{$set:{status:'claimed',leaseUntil:Date.now()-1,owner:{userId:'alice',deviceId:a.deviceId}}});
 await assert.rejects(leaseRecord.service.handle('bob','claim',{v:1,revision:leaseRecord.state.revision,epoch:leaseRecord.state.epoch,deviceId:b.deviceId}),/waiting/);
 // A departed member is denied all contextual server access. Previously shared keys cannot be retracted.
 const departed=records.get('game-poker-03');contexts.get('game-poker-03').members=['alice'];contexts.get('game-poker-03').version++;
 for(const [event,p] of [['state',{v:1}],['history',{v:1,epoch:departed.state.epoch,deviceId:b.deviceId}],['send',departed.envelope]] as const)await assert.rejects(departed.service.handle('bob',event,p),/forbidden/);
 // Closure immediately denies state, keys, history, send and unwrap routing without touching global/legacy.
 for(const room of ['game-ddz-demo1','game-pool-demo1']){
  const r=records.get(room);contexts.get(room).closed=true;
  for(const [event,p] of [['state',{v:1}],['history',{v:1,epoch:r.state.epoch,deviceId:b.deviceId}],['send',r.envelope],['keys:get',{v:1}]] as const)
   await assert.rejects(r.service.handle('alice',event,p),/room_closed/);
 }
 for(const room of ['main','poker-02','poker-03']){
  const r=records.get(room),history=await r.service.handle('alice','history',{v:1,epoch:r.state.epoch,deviceId:a.deviceId});
  assert.equal(history.messages.length,1);
 }
 // A failed or stale context fence cannot silently fall back to economic-room writes.
 contexts.set('game-pool-fence',{creatorId:'alice',members:['alice'],version:7});
 for(const result of [false,undefined]){
  const strict=createChatService(db,{roomId:'game-pool-fence',resolveContext,fenceContext:async()=>result});await strict.ready;
  const before=await db.collection('rooms').findOne({_id:'main' as never});
  await assert.rejects(strict.handle('alice','state',{v:1}),/stale_revision/);
  assert.deepEqual(await db.collection('rooms').findOne({_id:'main' as never}),before);
 }
 assert.equal(await fenceContext('game-pool-fence','alice',6),false);
 // An economically approved user still gets no contextual membership or directory through missing resolver data.
 const absent=createChatService(db,{roomId:'game-pool-missing',resolveContext,fenceContext});await absent.ready;
 await assert.rejects(absent.handle('alice','state',{v:1}),/room_closed/);
 for(const name of ['chat_states','chat_wraps','chat_messages','chat_devices']){
  const dump=JSON.stringify(await db.collection(name).find({}).toArray());
  for(const r of records.values())assert.equal(dump.includes(r.secret),false);
 }
});
