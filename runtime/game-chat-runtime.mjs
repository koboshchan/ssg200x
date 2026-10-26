import {gameChatRoom} from './game-chat-context.mjs';
import {fail} from './chat-protocol.mjs';
// Presence is server-owned. Socket routes and client-provided rosters are never credentials.
export function createGameChatRuntime(db,{now=Date.now,poolContext}={}){
 const presence=new Map(),creators=db.collection('game_chat_contexts');
 function roomOf(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['kind','id'].includes(k)))fail();return gameChatRoom(input.kind,input.id);}
 const approved=(room,user)=>room?.members?.some(m=>m.id===user&&m.approved===true&&!m.accessRevoked);
 async function context(roomId,user){
  const room=await db.collection('rooms').findOne({_id:'main'});if(!approved(room,user))fail('forbidden');
  const viewers=[...presence.values()].filter(p=>p.roomId===roomId&&p.socket.connected!==false).map(p=>p.user);
  if(!viewers.includes(user))fail('context_required');
  const match=/^game-(poker|blackjack|roulette|ddz|pool)-(.+)$/.exec(roomId);if(!match)fail();
  const [,kind,id]=match;let creatorId,members=viewers;
  if(kind==='ddz'){
   const game=room.doudizhu?.find(g=>g.code===id);if(!game)fail('room_closed');
   creatorId=game.ownerId??game.players?.[0]?.userId;
   const eligible=new Set([...(game.players||[]).map(p=>p.userId),...(game.spectators||[]).filter(s=>now()-s.seenAt<45000).map(s=>s.userId)]);
   members=viewers.filter(id=>eligible.has(id));if(!members.includes(user))fail('forbidden');
  }else if(kind==='pool'){
   // Pool owner supplies an authoritative, transaction-bound adapter. No fixture fallback.
   if(!poolContext)fail('room_closed');
   const pool=await poolContext(id,room,db);if(!pool||pool.closed)fail('room_closed');
   creatorId=pool.creatorId;members=viewers.filter(id=>pool.members.includes(id));if(!members.includes(user))fail('forbidden');
  }else{
   await creators.updateOne({_id:roomId},{$setOnInsert:{creatorId:user}},{upsert:true});
   creatorId=(await creators.findOne({_id:roomId})).creatorId;
  }
  members=[...new Set(members)].filter(id=>approved(room,id)).sort();
  // Game/economic revisions are NOT part of the crypto directory fingerprint.
  // Only actual chat membership changes should rotate epochs.
  return {creatorId,members,version:JSON.stringify(members),roomVersion:room.version};
 }
 async function fence(roomId,user,version){
  const current=await context(roomId,user);if(current.version!==version)return false;
  return (await db.collection('rooms').updateOne({_id:'main',version:current.roomVersion},{$inc:{version:1}})).matchedCount===1;
 }
 async function subscribe(socket,input){
  const roomId=roomOf(input),user=socket.data.identity.id;
  const minute=Math.floor(now()/60000),rates=db.collection('chat_rates'),rateId=user+':'+minute;
  await rates.updateOne({_id:rateId},{$setOnInsert:{count:0,expiresAt:new Date(now()+180000)}},{upsert:true});
  if(!(await rates.updateOne({_id:rateId,count:{$lt:120}},{$inc:{count:1}})).matchedCount)fail('rate_limited');
  const previous=presence.get(socket.id);presence.set(socket.id,{roomId,user,socket});
  try{await context(roomId,user);}catch(error){if(previous)presence.set(socket.id,previous);else presence.delete(socket.id);throw error;}
  return {chatRoom:roomId};
 }
 function leave(socket){presence.delete(socket.id);}
 function check(socket,roomId){const active=presence.get(socket.id);if(!active||active.user!==socket.data.identity.id||active.roomId!==roomId)fail('context_required');}
 return {resolveContext:context,fenceContext:fence,subscribe,leave,check};
}
