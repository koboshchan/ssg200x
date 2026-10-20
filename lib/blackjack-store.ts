import {mutate} from "./store";
import {register} from "./poker";
import {blackjackTablesAction,type BlackjackTablesAction} from "./blackjack";
import {ensure} from "./errors";
import type {Identity} from "./types";
export type BlackjackRequest=BlackjackTablesAction&{requestId:string;requestAt:number;round?:number;deadline?:number|null};
export async function blackjackMove(who:Identity,input:BlackjackRequest){
 return (await mutate(r=>{
  register(r,who);
  const now=Date.now();
  ensure(now-input.requestAt>=-10000&&now-input.requestAt<=120000,"Request expired.",409);
  const repeated=r.receipts.find(x=>x.id===input.requestId);
  if(repeated){ensure(repeated.userId===who.id,"Invalid request.",409);return;}
  const b=r.blackjackTables?.tables[input.tableId];
  if(["hit","stand","double","split"].includes(input.type))ensure(input.round===b?.round&&input.deadline===b?.deadline,"The blackjack turn changed. Refresh first.",409);
  // Deadline rejection and action share the room version CAS with tickRoom.
  // Every retry rechecks the persisted turn and the current server time.
  blackjackTablesAction(r,who,input,now);
  r.receipts=[{id:input.requestId,userId:who.id,at:now},...r.receipts.filter(x=>x.at&&now-x.at<300000)];
 })).room;
}
