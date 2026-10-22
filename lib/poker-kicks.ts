import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {active,kickPokerSeat} from './poker';
import {pokerTableRoom,savePokerTable,type PokerTableId} from './poker-tables';
import {ensure} from './errors';
import {audit} from './audit';
import type {Room,Identity} from './types';
export const POKER_KICK_VOTE_MS=30_000,POKER_KICK_COOLDOWN_MS=60_000;
export type PokerKickVote={id:string;targetUserId:string;initiatorUserId:string;eligibleUserIds:string[];yesUserIds:string[];noUserIds?:string[];membership:string[];handNumber:number;startedAt:number;expiresAt:number;status:'active'|'passed'|'failed'|'cancelled'|'expired'};
const base={tableId:z.enum(['01','02','03']).default('01'),requestId:z.string().uuid(),requestAt:z.number().int()};
export const pokerKickSchema=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('start'),targetPublicId:z.string().min(1).max(64)}).strict(),
 z.object({...base,action:z.literal('admin-kick'),targetPublicId:z.string().min(1).max(64)}).strict(),
 z.object({...base,action:z.literal('vote'),voteId:z.string().uuid(),yes:z.boolean()}).strict(),
]);
export type PokerKickRequest=z.infer<typeof pokerKickSchema>;
const membership=(r:Room)=>r.seats.flatMap(s=>s?[s.userId]:[]).sort();
const same=(a:string[],b:string[])=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export function reconcilePokerKickVotes(r:Room,now:number){
 for(const [id,v] of Object.entries(r.pokerKickVotes??{})){
  if(!v||v.status!=='active')continue;
  const t=pokerTableRoom(r,id as PokerTableId);
  const status=active(t)||t.handNumber!==v.handNumber||!same(membership(t),v.membership)?'cancelled':now>=v.expiresAt?'expired':null;
  if(status){v.status=status;audit(r,{id:'system',name:'System',email:'',admin:true},'poker.vote.'+status,v.targetUserId,null,{tableId:id,voteId:v.id});}
 }
}
export function pokerKickNeedsTick(r:Room,now:number){return Object.values(r.pokerKickVotes??{}).some(v=>v?.status==='active'&&now>=v.expiresAt);}
function remove(r:Room,id:PokerTableId,target:string,who:Identity,now:number){
 const t=pokerTableRoom(r,id),i=t.seats.findIndex(s=>s?.userId===target);
 ensure(i>=0,'Player is no longer seated.',409);
 const old={tableId:id,stack:t.seats[i]!.stack,committed:t.seats[i]!.committed};
 kickPokerSeat(t,i,now);savePokerTable(r,id,t);
 audit(r,who,'poker.kick',target,old,{tableId:id,refund:old.stack});
}
export function applyPokerKick(r:Room,who:Identity,request:PokerKickRequest,now:number){
 ensure(now-request.requestAt>=-10_000&&now-request.requestAt<=120_000,'Request expired. Try again.',409);
 const fingerprint=JSON.stringify(request);
 const prior=r.pokerKickReceipts?.find(x=>x.id===request.requestId);
 if(prior){ensure(prior.userId===who.id&&prior.fingerprint===fingerprint,'Invalid request replay.',409);return;}
 reconcilePokerKickVotes(r,now);
 const id=request.tableId,t=pokerTableRoom(r,id);
 if(request.action==='admin-kick'){
  ensure(who.admin,'Administrator required.',403);
  const target=r.members.find(m=>m.publicId===request.targetPublicId);
  ensure(target,'Player not found.',404);
  remove(r,id,target.id,who,now);
  reconcilePokerKickVotes(r,now);
 }else{
  ensure(t.seats.some(s=>s?.userId===who.id),'Only seated players can vote.',403);
  ensure(!active(t),'Vote kicks are only available between hands.',409);
  const existing=r.pokerKickVotes?.[id];
  if(request.action==='start'){
   ensure(t.street==='waiting'&&t.seats.some(s=>s&&!s.ready&&!s.sitOut),'Start vote kicks only while waiting for players to be ready.',409);
   ensure(!existing||existing.status!=='active','A vote is already active at this table.',409);
   ensure(now>=(r.pokerKickCooldowns?.[who.id]??0),'Wait sixty seconds before starting another vote.',429);
   const target=r.members.find(m=>m.publicId===request.targetPublicId);
   ensure(target&&t.seats.some(s=>s?.userId===target.id),'Player is no longer seated.',409);
   ensure(target.id!==who.id,'You cannot vote to kick yourself.',400);
   const voters=membership(t);
   ensure(voters.length>=3,'At least two other seated players are required.',409);
   const v:PokerKickVote={id:randomUUID(),targetUserId:target.id,initiatorUserId:who.id,eligibleUserIds:voters,yesUserIds:[who.id],noUserIds:[target.id],membership:membership(t),handNumber:t.handNumber,startedAt:now,expiresAt:now+POKER_KICK_VOTE_MS,status:'active'};
   (r.pokerKickVotes??={})[id]=v;
   // Global, persisted across all tables and reconnects. Expired entries may
   // be removed only after their full throttle window has elapsed.
   r.pokerKickCooldowns=Object.fromEntries(Object.entries(r.pokerKickCooldowns??{}).filter(([,until])=>until>now));
   r.pokerKickCooldowns[who.id]=now+POKER_KICK_COOLDOWN_MS;
   audit(r,who,'poker.vote.start',target.id,null,{tableId:id,voteId:v.id,eligible:voters});
  }else{
   ensure(existing&&existing.id===request.voteId&&existing.status==='active','This vote has ended.',409);
   ensure(existing.eligibleUserIds.includes(who.id),'You are not eligible to vote.',403);
   const no=existing.noUserIds??=[existing.targetUserId];
   ensure(!existing.yesUserIds.includes(who.id)&&!no.includes(who.id),'You already voted.',409);
   if(request.yes)existing.yesUserIds.push(who.id);
   else no.push(who.id);
   if(pokerKickPassed(existing.yesUserIds.length,existing.eligibleUserIds.length)){
    existing.status='passed';remove(r,id,existing.targetUserId,who,now);
   }else if(!pokerKickPassed(existing.eligibleUserIds.length-no.length,existing.eligibleUserIds.length))existing.status='failed';
   audit(r,who,'poker.vote.'+(request.yes?'yes':'no'),existing.targetUserId,null,{tableId:id,voteId:existing.id,status:existing.status});
  }
 }
 r.pokerKickReceipts=[{id:request.requestId,userId:who.id,fingerprint,at:now},...(r.pokerKickReceipts??[]).filter(x=>now-x.at<300_000)].slice(0,2048);
}
export function publicPokerKickVote(r:Room,id:PokerTableId){
 const v=r.pokerKickVotes?.[id];if(!v)return null;
 const publicId=(user:string)=>r.members.find(m=>m.id===user)?.publicId??'';
 return {id:v.id,targetPublicId:publicId(v.targetUserId),initiatorPublicId:publicId(v.initiatorUserId),eligiblePublicIds:v.eligibleUserIds.map(publicId),yesPublicIds:v.yesUserIds.map(publicId),noPublicIds:(v.noUserIds??[v.targetUserId]).map(publicId),startedAt:v.startedAt,expiresAt:v.expiresAt,status:v.status};
}

// Strictly greater than 51%, without floating-point rounding.
export function pokerKickPassed(yes:number,eligible:number){return eligible>0&&yes*100>51*eligible;}
