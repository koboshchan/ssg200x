import {chatRoomIds} from './chat-room-policy.mjs';
import {createChatService} from './chat-service.mjs';
import {fail} from './chat-protocol.mjs';
import {validChatRoom} from './game-chat-context.mjs';
import {gameChatTransactions} from './game-chat-transaction.mjs';
import {createGameChatRuntime} from './game-chat-runtime.mjs';
// A single process queue also serializes reset and all server-owned presence changes.
// Mongo transactions, not this queue, fence independent economic/revocation writers.
export function createPokerChatService(database,options={}){
 const transactions=gameChatTransactions(database),db=transactions.db;
 const runtime=createGameChatRuntime(db,{poolContext:options.poolContext});
 const services=new Map(chatRoomIds(options.env).map(roomId=>[roomId,createChatService(db,{...options,roomId})]));
 let queue=Promise.resolve(),pending=0;
 const serial=fn=>{if(pending>=128)return Promise.reject(Object.assign(new Error('busy'),{chatCode:'busy'}));pending++;const result=queue.then(fn).finally(()=>pending--);queue=result.catch(()=>{});return result;};
 async function service(roomId){
  if(!services.has(roomId)){
   if(!validChatRoom(roomId)||!roomId.startsWith('game-'))fail();
   // Bound runtime cache; closed rooms cannot cause unbounded service growth.
   if(services.size>=512){const victim=[...services.keys()].find(k=>k.startsWith('game-'));if(victim)services.delete(victim);}
   services.set(roomId,createChatService(db,{...options,...runtime,roomId}));
  }
  const result=services.get(roomId);await result.ready;return result;
 }
 return {
  ready:Promise.all([...services.values()].map(s=>s.ready)),
  authorized:user=>serial(()=>services.get('main').authorized(user)),
  adminReset:(user,payload)=>serial(()=>services.get('main').adminReset(user,payload)),
  subscribe:(socket,input)=>serial(async()=>{try{const committed=await transactions.run(async()=>{const result=await runtime.subscribe(socket,input);const ctx=await runtime.resolveContext(result.chatRoom,socket.data.identity.id);if(!await runtime.fenceContext(result.chatRoom,socket.data.identity.id,ctx.version))fail('stale_revision');return result;});socket.data.gameChatRoom=committed.chatRoom;return committed;}catch(error){runtime.leave(socket);delete socket.data.gameChatRoom;throw error;}}),
  leave:(socket,input)=>serial(()=>{const left=runtime.leave(socket,input);if(left)delete socket.data.gameChatRoom;return left;}),
  handle:(user,event,payload,socket)=>serial(async()=>{
   if(!payload||typeof payload!=='object'||Array.isArray(payload))fail();
   const {chatRoom='main',...body}=payload;
   if(body.room!==undefined&&body.room!==chatRoom)fail();
   const selected=await service(chatRoom);
   if(!chatRoom.startsWith('game-'))return selected.handle(user,event,body);
   if(!socket||socket.data.identity.id!==user)fail('context_required');runtime.check(socket,chatRoom);
   // Identity provisioning/recovery remains account-global, outside transactions.
   if(['register','keys:get','keys:put'].includes(event)){
    await transactions.run(async()=>{const ctx=await runtime.resolveContext(chatRoom,user);if(!await runtime.fenceContext(chatRoom,user,ctx.version))fail('stale_revision');});
    return services.get('main').handle(user,event,body);
   }
   return transactions.run(()=>selected.handle(user,event,body));
  })
 };
}
