import {pokerStakes} from "./poker-stakes";
import {freshRoom,active,seatOf,tick,applyAction} from './poker';
import {ensure} from './errors';
import type {Room,Action,Identity} from './types';
export const POKER_TABLE_IDS=['01','02','03'] as const;
export type PokerTableId=typeof POKER_TABLE_IDS[number];
export const POKER_FIELDS=['seats','button','street','handNumber','board','deck','currentBet','minRaise','pending','turn','deadline','nextDeal','readyDeadline','payouts','log','pokerBonus','pokerCarry','pokerDead','idleCountedHand','pokerHandBigBlind'] as const;
export type PokerTableState=Pick<Room,typeof POKER_FIELDS[number]>;
export function pokerTableId(value:unknown):PokerTableId{ensure(POKER_TABLE_IDS.includes(value as PokerTableId),'Invalid poker table.',400);return value as PokerTableId;}
export function freshPokerTable():PokerTableState{const room=freshRoom();return Object.fromEntries(POKER_FIELDS.map(key=>[key,room[key]])) as PokerTableState;}
// Table 01 deliberately remains the existing top-level state. No relocation or
// migration write can reset its live hand, stacks, deck, receipts or timers.
export function pokerTableRoom(room:Room,id:PokerTableId):Room{
 if(id==='01')return room;
 return {...room,...(room.pokerTables?.[id]??freshPokerTable()),pokerStakeTableId:id};
}
export function savePokerTable(room:Room,id:PokerTableId,scoped:Room){
 if(id==='01')return;
 const fields=Object.fromEntries(POKER_FIELDS.map(key=>[key,scoped[key]])) as PokerTableState;
 (room.pokerTables??={})[id]=fields;
}
export function pokerStates(room:Room){return [room,...(['02','03'] as const).flatMap(id=>room.pokerTables?.[id]?[room.pokerTables[id]!]:[])];}
export function seatedPokerTable(room:Room,user:string):PokerTableId|null{return POKER_TABLE_IDS.find(id=>pokerTableRoom(room,id).seats.some(s=>s?.userId===user))??null;}
export function pokerMemberAssets(room:Room,user:string){return pokerStates(room).reduce((n,t)=>n+t.seats.reduce((sum,s)=>sum+(s?.userId===user?s.stack+s.committed:0),0),0);}
export function pokerTablesView(room:Room){return POKER_TABLE_IDS.map(id=>{const t=pokerTableRoom(room,id);const {minBuyIn,maxBuyIn}=pokerStakes(id);return {id,minBuyIn,maxBuyIn,name:`Table ${id}`,seatsFilled:t.seats.filter(Boolean).length,seatCount:12 as const,street:t.street,handNumber:t.handNumber};});}
export function pokerTableNeedsTick(r:Room,now:number){return (!active(r)&&((r.readyDeadline!=null&&now>=r.readyDeadline)||(r.readyDeadline==null&&r.seats.some(s=>s?.ready))))||(r.deadline!==null&&now>=r.deadline)||(r.nextDeal!==null&&now>=r.nextDeal)||(!active(r)&&r.seats.some(s=>s&&!s.ready&&(s.leaveAfter||s.stack===0)));}
export function tickPokerTables(room:Room,now:number){for(const id of POKER_TABLE_IDS){const scoped=pokerTableRoom(room,id);if(pokerTableNeedsTick(scoped,now)){tick(scoped,now);savePokerTable(room,id,scoped);}}}
export function applyPokerTableAction(room:Room,id:PokerTableId,who:Identity,action:Action,handNumber:number,deadline:number|null,now:number){
 const seated=seatedPokerTable(room,who.id);
 if(action.type==='join')ensure(seated===null,'Leave your current poker table first.',409);
 else ensure(seated===id,'You are not seated at this poker table.',409);
 const scoped=pokerTableRoom(room,id);tick(scoped,now);
 if(['fold','check','call','raise'].includes(action.type))ensure(scoped.handNumber===handNumber&&scoped.deadline===deadline,'The turn has changed. Refresh first.',409);
 if(['ready','resume','unready'].includes(action.type))ensure(scoped.handNumber===handNumber,'The hand has changed. Refresh first.',409);
 applyAction(scoped,who,action,now);savePokerTable(room,id,scoped);
}
export function touchPokerSeat(room:Room,user:string,now:number){const id=seatedPokerTable(room,user);if(id){const scoped=pokerTableRoom(room,id);const i=seatOf(scoped,user);scoped.seats[i]!.seen=now;savePokerTable(room,id,scoped);}}
