// Fixture-only harness server. Real app/api route handlers + real runtime chat services over an isolated replica-set Mongo.
// No production env, Clerk API, wallet or data. Fixture accounts alice and bob only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Server} from 'socket.io';
import {MongoClient} from 'mongodb';
const PORT=Number(process.env.PORT||47522),MONGO=process.env.MONGODB_URI||'mongodb://127.0.0.1:47521/?replicaSet=gcprs&directConnection=true',DBNAME='fakebucks_test_game_chat_pages';
if(!/127\.0\.0\.1/.test(MONGO)||!DBNAME.startsWith('fakebucks_test_'))throw Error('Isolated fixture DB required');
process.env.MONGODB_URI=MONGO;process.env.MONGODB_DB=DBNAME;
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const {dispatch,tick,snapshot}=await import('./dist/routes.mjs');
const {createPokerChatService}=await import('../../runtime/poker-chat-service.mjs');
const {createDmService}=await import('../../runtime/dm-service.mjs');
const {createChatDmGate}=await import('../../runtime/chat-dm-gate.mjs');
const {poolContext,poolRoutes}=await import('./pool-fixture.mjs');
const mongo=new MongoClient(MONGO);await mongo.connect();const db=mongo.db(DBNAME);
const clerk={users:{
 getUser:async u=>(await db.collection('fixture_accounts').findOne({_id:u}))||{publicMetadata:{},privateMetadata:{}},
 updateUserMetadata:async(u,p)=>{const update={};for(const field of ['publicMetadata','privateMetadata'])for(const [slot,value] of Object.entries(p[field]?.tabletalk||{}))update[field+'.tabletalk.'+slot]=value;
  await db.collection('fixture_accounts').updateOne({_id:u},{$set:update},{upsert:true});return clerk.users.getUser(u);}
}};
const chat=createPokerChatService(db,{clerk,canSend:()=>true,poolContext});
const dm=createDmService(db,{clerk,canSend:()=>true});
await Promise.all([chat.ready,dm.ready]);
const gate=createChatDmGate(chat,dm);
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const USER=/(?:^|; )gc_user=(alice|bob)(?:;|$)/;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://fixture'),p=url.pathname;
 res.setHeader('x-content-type-options','nosniff');res.setHeader('cache-control','no-store');
 try{
  if(p==='/health'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({fixture:true,sockets:io.engine.clientsCount}));}
  if(p.startsWith('/api/pool/')){return await poolRoutes(req,res,p,USER.exec(req.headers.cookie||'')?.[1]);}
  if(p.startsWith('/api/')){
   const body=req.method==='GET'||req.method==='HEAD'?undefined:await new Promise((ok,no)=>{const c=[];let n=0;req.on('data',d=>{n+=d.length;if(n>65536){no(Error('large'));req.destroy();}else c.push(d);});req.on('end',()=>ok(Buffer.concat(c)));req.on('error',no);});
   const r=await dispatch(new Request(url,{method:req.method,headers:req.headers,body}),p);
   if(!r){res.writeHead(404,{'content-type':'application/json'});return res.end('{"error":"Not found"}');}
   res.writeHead(r.status,Object.fromEntries(r.headers));return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const who=url.searchParams.get('user');
  if(who==='alice'||who==='bob')res.setHeader('set-cookie','gc_user='+who+'; Path=/; SameSite=Lax');
  const files={'/bundle.js':'bundle.js','/bundle.css':'bundle.css'};
  const file=files[p]||(p==='/'||/^\/(poker|blackjack|roulette|doudizhu|pool)\/?$/.test(p)?'index.html':null);
  if(!file){res.writeHead(404);return res.end();}
  res.setHeader('content-type',TYPES[path.extname(file)]);return res.end(fs.readFileSync(path.join(ROOT,'public',file)));
 }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:String(e.message||e)}));}
});
const io=new Server(server,{maxHttpBufferSize:16384});
io.use((s,next)=>{const u=USER.exec(s.request.headers.cookie||'')?.[1];if(!u)return next(Error('Fixture account required'));s.data.identity={id:u,admin:false};s.data.expires=Date.now()+86400000;next();});
const hintTimers=new Map();
function hintChatChanged(room){
 if(!room||hintTimers.has(room))return;
 const timer=setTimeout(()=>{hintTimers.delete(room);for(const socket of io.sockets.sockets.values()){if(!room.startsWith('game-')||socket.data.gameChatRoom===room)socket.emit('chat:changed',{v:1,room});}},100);timer.unref();hintTimers.set(room,timer);
}
function hintAllChatChanged(){for(const room of new Set(['main',...[...io.sockets.sockets.values()].map(s=>s.data.gameChatRoom).filter(Boolean)]))hintChatChanged(room);}
io.on('connection',socket=>{
 socket.data.pokerTableId='01';
 socket.on('poker:subscribe',id=>{if(['01','02','03'].includes(id))socket.data.pokerTableId=id;socket.data.pushed=null;});
 socket.on('game-chat:subscribe',async(payload,ack)=>{if(typeof ack!=='function')return;try{const previous=socket.data.gameChatRoom;const r=await chat.subscribe(socket,payload);ack({ok:true,...r});hintChatChanged(r.chatRoom);hintChatChanged(previous);}catch(e){ack({ok:false,error:e.chatCode||'unavailable'});}});
 socket.on('game-chat:leave',async(payload,ack)=>{try{const left=await chat.leave(socket,payload);if(typeof ack==='function')ack({ok:true});hintChatChanged(left);}catch(e){if(typeof ack==='function')ack({ok:false,error:e.chatCode||'unavailable'});}});
 socket.on('disconnect',()=>{void chat.leave(socket).then(left=>hintChatChanged(left)).catch(()=>{});});
 for(const event of ['register','state','claim','wrap','send','history','keys:get','keys:put']){
  socket.on('chat:'+event,async(payload,ack)=>{
   if(typeof ack!=='function')return;
   try{
    const result=await chat.handle(socket.data.identity.id,event,payload,socket);
    ack({ok:true,...result});
    if(['register','keys:put'].includes(event)||result.directoryChanged===true)hintAllChatChanged();else if(['claim','wrap','send'].includes(event))hintChatChanged(payload?.chatRoom||'main');
   }catch(e){ack({ok:false,error:e.chatCode||'unavailable'});
    const m=typeof payload?.chatRoom==='string'&&/^game-(poker|blackjack|roulette|ddz|pool)-(.+)$/.exec(payload.chatRoom);
    if(m&&['room_closed','forbidden','context_required'].includes(e.chatCode)){socket.emit('game-chat:closed',{chatRoom:payload.chatRoom,kind:m[1],id:m[2]});try{hintChatChanged(await chat.leave(socket,{kind:m[1],id:m[2]}));}catch{}}}
  });
 }
 for(const event of ['profile','lookup','threads','history','send','block','unread','read']){
  socket.on('dm:'+event,async(payload,ack)=>{
   if(typeof ack!=='function')return;
   try{
    const user=socket.data.identity.id,result=await gate.handle(user,event,payload);
    ack({ok:true,...result});
    if(event==='read'||event==='block'||(event==='send'&&!result.duplicate)){
     const peer=event==='send'?result.message.toUserId:payload.userId;
     for(const t of io.sockets.sockets.values())if([user,peer].includes(t.data.identity.id)&&(event!=='read'||t.data.identity.id===user))t.emit('dm:changed');
    }
   }catch(e){ack({ok:false,error:e.chatCode||'unavailable'});}
  });
 }
});
// Room snapshots (poker/market/chat names) pushed per socket when the room version changes.
let busy=false;
const timer=setInterval(async()=>{
 if(busy||!io.engine.clientsCount)return;busy=true;
 try{
  await tick();
  for(const s of io.sockets.sockets.values()){
   const snap=await snapshot(s.data.identity.id,s.data.pokerTableId||'01');if(!snap)continue;
   const key=(snap.version??'')+':'+s.data.pokerTableId;if(s.data.pushed===key)continue;s.data.pushed=key;
   s.emit('room:state',snap);
  }
 }catch(e){console.warn('tick',e.message);}finally{busy=false;}
},500);timer.unref();
server.listen(PORT,'0.0.0.0',()=>console.log('game-chat-pages harness ready '+PORT));
process.on('SIGTERM',()=>{clearInterval(timer);io.close();server.close();mongo.close();process.exit(0);});
