// Fixture-only server. No production env, Clerk API, game wallets or existing data.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MongoClient} from 'mongodb';
import {Server} from 'socket.io';
import {createChatService} from '../../runtime/chat-service.mjs';
import {gameChatRoom} from '../../runtime/game-chat-context.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url)),PORT=43891;
const mongo=new MongoClient('mongodb://127.0.0.1:43892');
await mongo.connect();
const db=mongo.db('fakebucks_test_game_chats_a06ab046');
await db.collection('rooms').updateOne({_id:'main'},{$setOnInsert:{version:1,members:['alice','bob'].map(id=>({id,approved:true}))}},{upsert:true});
const clerk={users:{
 getUser:async u=>(await db.collection('fixture_accounts').findOne({_id:u}))||{publicMetadata:{},privateMetadata:{}},
 updateUserMetadata:async(u,p)=>{const update={};for(const field of ['publicMetadata','privateMetadata'])for(const [slot,value] of Object.entries(p[field]?.tabletalk||{}))update[field+'.tabletalk.'+slot]=value;
 await db.collection('fixture_accounts').updateOne({_id:u},{$set:update},{upsert:true});return clerk.users.getUser(u);}
}};
const contexts=new Map(),services=new Map(),events=[];
let chain=Promise.resolve();
const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
const resolveContext=async(room,user)=>{const c=contexts.get(room);if(!c||c.closed)return null;if(!c.members.has(user))return {members:[],version:c.version,creatorId:c.creatorId};return {...c,members:[...c.members]};};
const fenceContext=async(room,user,version)=>{const c=contexts.get(room);if(!c||c.closed)throw Error('room_closed');if(!c.members.has(user))throw Error('forbidden');if(c.version!==version)throw Error('stale_revision');return true;};
const main=createChatService(db,{clerk});services.set('main',main);await main.ready;
const server=http.createServer(async(req,res)=>{
 const p=new URL(req.url,'http://fixture').pathname;
 if(p==='/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({fixture:true,sockets:io.engine.clientsCount,rooms:[...contexts].filter(([,c])=>!c.closed).map(([room])=>room)}));return;}
 if(p==='/evidence'){
  const docs=await db.collection('chat_messages').find({}).toArray();
  // Ciphertext evidence only. No Clerk backup, private key, plaintext or identity words.
  res.setHeader('content-type','application/json');res.end(JSON.stringify({events,docs,states:await db.collection('chat_states').find({},{projection:{room:1,epoch:1,status:1,owner:1}}).toArray()}));return;
 }
 const file=p==='/'?'index.html':p==='/bundle.js'?'bundle.js':null;
 if(!file){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
 res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
 res.end(fs.readFileSync(path.join(ROOT,'public',file)));
});
const io=new Server(server,{maxHttpBufferSize:16384});
io.use((s,next)=>['alice','bob'].includes(s.handshake.query.user)?next():next(Error('Fixture account required')));
io.on('connection',s=>{
 const user=s.handshake.query.user;
 const handle=(event,fn)=>s.on(event,(p,ack)=>{if(typeof ack!=='function')return;serial(async()=>{try{ack({ok:true,...await fn(p)});}catch(e){ack({ok:false,error:e.chatCode||e.message});}});});
 const leave=()=>{const previous=s.data.currentRoom;s.data.currentRoom=null;if(!previous)return;const c=contexts.get(previous);if(!c||c.closed)return;const elsewhere=[...io.sockets.sockets.values()].some(peer=>peer!==s&&peer.handshake.query.user===user&&peer.data.currentRoom===previous);if(!elsewhere&&c.members.delete(user)){c.version++;io.emit('chat:changed',{room:previous});}};
 s.on('disconnect',()=>{void serial(leave);});
 handle('contexts:closed',async()=>({rooms:(await db.collection('fixture_contexts').find({closed:true},{projection:{_id:1}}).toArray()).map(c=>c._id.replace(/^game-/, '').replace('-', '|'))}));
 handle('context:leave',async()=>{leave();return {left:true};});
 handle('context:enter',async p=>{
  const room=gameChatRoom(p?.kind,p?.id);
  if(['ddz','pool'].includes(p.kind)&&!['demo1','demo2'].includes(p.id))throw Error('Unknown fixture room');
  let c=contexts.get(room);
  if(c?.closed)throw Error('room_closed');
  if(!c){
   const saved=await db.collection('fixture_contexts').findOneAndUpdate({_id:room},{$setOnInsert:{creatorId:user,closed:false}},{upsert:true,returnDocument:'after'});
   if(saved.closed)throw Error('room_closed');
   c={creatorId:saved.creatorId,members:new Set(),version:0,closed:false};contexts.set(room,c);
  }
  if(!c.members.has(user)){c.members.add(user);c.version++;}
  if(s.data.currentRoom!==room)leave();
  s.data.currentRoom=room;
  if(!services.has(room)){const service=createChatService(db,{clerk,roomId:room,resolveContext,fenceContext});services.set(room,service);await service.ready;}
  io.emit('chat:changed',{room});
  return {room,label:p.kind+' '+p.id,spectating:p.role==='spectator'};
 });
 handle('game:close',async p=>{
  const room=gameChatRoom(p?.kind,p?.id),c=contexts.get(room);
  if(!['ddz','pool'].includes(p.kind)||!c||c.creatorId!==user)throw Error('forbidden');
  c.closed=true;c.version++;
  await db.collection('fixture_contexts').updateOne({_id:room},{$set:{closed:true}});
  // No archive UI/API. Existing unrelated rooms and grants remain untouched.
  io.emit('game:closed',{kind:p.kind,id:p.id,room});
  return {closed:true};
 });
 for(const event of ['register','state','claim','wrap','send','history','keys:get','keys:put']){
  handle('chat:'+event,async p=>{
   if(!p||typeof p!=='object'||Array.isArray(p))throw Error('malformed');
   const {chatRoom='main',...body}=p;
   if(body.room!==undefined&&body.room!==chatRoom)throw Error('malformed');
   const service=services.get(chatRoom);if(!service)throw Error('forbidden');
   const result=await service.handle(user,event,body);
   events.push({user,event,room:chatRoom,at:Date.now()});
   if(events.length>2000)events.shift();
   if(['register','keys:put','claim','wrap','send'].includes(event)||result.directoryChanged)io.emit('chat:changed',{room:chatRoom});
   return result;
  });
 }
});
server.listen(PORT,'0.0.0.0',()=>console.log('fixture demo ready '+PORT));
