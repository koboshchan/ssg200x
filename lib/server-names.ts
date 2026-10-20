import {backendClerk} from "./clerk-reads";
import {loadClerkProfiles,roomWithClerkNames,profileName,type DisplayProfiles} from "../runtime/clerk-names.mjs";
import type {Room,Identity} from "./types";
import type {Transfer} from "./transfers";
import {transferView} from "./transfers";
import {db} from "./db";
import {ensure} from "./errors";
// Bounded five-second profile freshness, never saved Mongo labels.
export function currentProfiles(ids:string[]){
 return loadClerkProfiles(backendClerk(),ids);
}
export async function currentNamedRoom(room:Room,profiles?:DisplayProfiles){
 return roomWithClerkNames(room,profiles??await currentProfiles(room.members.map(m=>m.id)));
}
export function namedTransfer(t:Transfer,who:Identity,profiles:DisplayProfiles){
 return {...transferView(t,who),from:profileName(profiles,t.sender),to:profileName(profiles,t.recipient)};
}
export async function currentTransferHistory(who:Identity,all=false){
 ensure(!all||who.admin,"Admin access required.",403);
 const records=await(await db()).collection<Transfer>("transfers").find(all?{}:{$or:[{sender:who.id},{recipient:who.id}]}).sort({at:-1,_id:-1}).limit(100).toArray();
 const profiles=await currentProfiles(records.flatMap(t=>[t.sender,t.recipient]));
 return records.map(t=>namedTransfer(t,who,profiles));
}
export async function currentTransferResult(id:string,who:Identity){
 const record=await(await db()).collection<Transfer>("transfers").findOne({_id:id});
 ensure(record,"Transfer unavailable.",404);
 // Payment already committed. A temporary Clerk outage must not turn a success
 // into a failed payment; show neutral labels, never saved names, then refresh.
 const profiles=await currentProfiles([record.sender,record.recipient]).catch(()=>new Map());
 return namedTransfer(record,who,profiles);
}
