import {chatRoomIds} from './chat-room-policy.mjs';
import {createChatService} from './chat-service.mjs';
import {fail} from './chat-protocol.mjs';
// One dispatcher owns all table queues. Account identity/reset stays global.
// chatRoom is routing metadata; room inside signed envelopes is authenticated.
export function createPokerChatService(db,options={}){
 const services=new Map(chatRoomIds(options.env).map(roomId=>[roomId,createChatService(db,{...options,roomId})]));
 let queue=Promise.resolve(),pending=0;
 const serial=fn=>{if(pending>=128)return Promise.reject(Object.assign(new Error('busy'),{chatCode:'busy'}));pending++;const result=queue.then(fn).finally(()=>pending--);queue=result.catch(()=>{});return result;};
 return {
  ready:Promise.all([...services.values()].map(s=>s.ready)),
  authorized:user=>serial(()=>services.get('main').authorized(user)),
  adminReset:(user,payload)=>serial(()=>services.get('main').adminReset(user,payload)),
  handle:(user,event,payload)=>serial(()=>{
   if(!payload||typeof payload!=='object'||Array.isArray(payload))fail();
   const {chatRoom='main',...body}=payload;
   const service=services.get(chatRoom);if(!service)fail();
   if(body.room!==undefined&&body.room!==chatRoom)fail();
   return service.handle(user,event,body);
  })
 };
}
