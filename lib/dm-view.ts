// Pure DM view logic: which keys belong to the peer, pin checks before decrypt, and message merging.
import {pinState,type DmHistoryMessage,type DmPin,type PinState} from "./dm-crypto";

export type DmLookupPeer={userId:string;username:string;deviceId:string;keyVersion:number;dhPublic:string;signPublic:string};
export type DmRow={id:string;mine:boolean;ts:number;cursor?:string;status:"ok"|"pending"|"failed"|"changed"|"unreadable"|"invalid";text?:string};

/** Keys the other party used on this message, taken from the snapshot the server attached. */
export function peerSnapshot(m:DmHistoryMessage,myUserId:string):DmPin&{userId:string}{
 return m.senderUserId===myUserId
  ?{userId:m.toUserId,deviceId:m.recipientDeviceId,keyVersion:m.recipientKeyVersion,dhPublic:m.recipientDhPublic,signPublic:m.recipientSignPublic}
  :{userId:m.senderUserId,deviceId:m.senderDeviceId,keyVersion:m.senderKeyVersion,dhPublic:m.senderDhPublic,signPublic:m.senderSignPublic};
}
/** A message belongs to this conversation only if it is between me and the peer. */
export function inConversation(m:DmHistoryMessage,myUserId:string,peerUserId:string){
 return (m.senderUserId===myUserId&&m.toUserId===peerUserId)||(m.senderUserId===peerUserId&&m.toUserId===myUserId);
}
/** Compare the peer keys on a historical message with the pin. Never trusts history to set a pin. */
export function historyPinState(pin:DmPin|undefined,m:DmHistoryMessage,myUserId:string):PinState{
 return pinState(pin,peerSnapshot(m,myUserId));
}
/** Server uniqueness is (senderUserId,id), so a row is keyed by direction plus id. */
export const rowKey=(r:Pick<DmRow,"mine"|"id">)=>JSON.stringify([r.mine,r.id]);
export function mergeRows(a:DmRow[],b:DmRow[]):DmRow[]{
 const map=new Map<string,DmRow>();
 for(const r of a)map.set(rowKey(r),r);
 for(const r of b){const old=map.get(rowKey(r));if(!old||old.status==="pending"||old.status==="failed"||r.status!=="pending")map.set(rowKey(r),r);}
 return [...map.values()].sort((x,y)=>x.ts-y.ts||(x.cursor||"").localeCompare(y.cursor||"")||x.id.localeCompare(y.id));
}
export const dmError=(code:string)=>({disconnected:"Not connected. Try again in a moment.",timeout:"The server didn't answer in time.",rate_limited:"Slow down a little.",blocked:"You can't message this person.",forbidden:"Messages are only open to approved members.",bad_text:"Message is empty or too long."} as Record<string,string>)[code]||"Messages are unavailable right now.";

/** Monotonic scope token. Async work captures value and checks valid() after each await. */
export function scope(){let n=0;return {get value(){return n;},next(){return ++n;},valid(t:number){return t===n;}};}
export const pendingPrefix=(me:string,peer:string)=>JSON.stringify([me,peer]).slice(0,-1)+",";
export const pendingKey=(me:string,peer:string,id:string)=>JSON.stringify([me,peer,id]);
