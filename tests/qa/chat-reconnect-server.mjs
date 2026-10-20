import http from 'node:http';
import fs from 'node:fs';
import {MongoClient} from 'mongodb';
import {Server} from 'socket.io';
import {createChatService} from '../../runtime/chat-service.mjs';
const mongo=new MongoClient('mongodb://127.0.0.1:39762');await mongo.connect();
const db=mongo.db('fakebucks_test_chat_durable_20261020');
await db.collection('rooms').insertOne({_id:'main',version:1,members:['a','b'].map(id=>({id,approved:true}))});
const clerk={users:{getUser:async u=>(await db.collection('qa_metadata').findOne({_id:u}))||{publicMetadata:{},privateMetadata:{}},updateUserMetadata:async(u,p)=>{const update={};for(const field of ['publicMetadata','privateMetadata'])for(const [slot,value]of Object.entries(p[field]?.tabletalk||{}))update[field+'.tabletalk.'+slot]=value;await db.collection('qa_metadata').updateOne({_id:u},{$set:update},{upsert:true});return clerk.users.getUser(u)}}};
const chat=createChatService(db,{clerk});await chat.ready;
const events=[];let mode='normal',limit=0;
const server=http.createServer(async(req,res)=>{
 if(req.url==='/evidence'){const docs=await db.collection('chat_messages').find().toArray();res.end(JSON.stringify({events,docs}));return;}
 res.setHeader('content-type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?fs.readFileSync(new URL('./reconnect-e2e-bundle.js',import.meta.url)):'<meta charset="utf-8"><script src="/bundle.js"></script>');
});
const io=new Server(server);
io.on('connection',s=>{
 const user=s.handshake.auth.user;if(!['a','b'].includes(user)){s.disconnect(true);return;}
 s.on('qa:mode',(p,ack)=>{mode=p;limit=0;ack({ok:true});});
 s.onAny(async(event,p,ack)=>{
  if(!event.startsWith('chat:'))return;
  const e=event.slice(5);events.push({user,event:e,p,at:Date.now()});
  try{
   if(e==='keys:get'&&mode==='limit'){limit++;ack({ok:false,error:'rate_limited'});return;}
   if(e==='send'&&mode==='disconnect-before'){mode='normal';s.disconnect(true);return;}
   const result=await chat.handle(user,e,p);
   if(e==='send'&&mode==='disconnect-after'){mode='normal';s.disconnect(true);return;}
   ack({ok:true,...result});
  }catch(e){ack({ok:false,error:e.chatCode||e.message});}
 });
});
server.listen(39763,'127.0.0.1',()=>console.log('READY'));
async function clean(){await db.dropDatabase();await mongo.close();io.close();server.close();process.exit();}
process.on('SIGTERM',clean);
