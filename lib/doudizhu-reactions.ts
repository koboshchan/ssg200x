import {ensure} from "./errors";
import {audit} from "./audit";
import {casinoLimits} from "./casino-limits";
import type {DoudizhuRoom,DoudizhuInput} from "./doudizhu";
import type {Room,Identity} from "./types";
export type DoudizhuReaction={id:string;kind:"emote"|"throw";value:string;source:number;sourceId:string;target?:number;targetId?:string;at:number};
const EMOTES=new Set(["laugh","cry","wow","think","nice","oops"]);
/** Called only inside the room CAS mutation, alongside the replay receipt and audit outbox. */
export function applyDoudizhuReaction(r:Room,g:DoudizhuRoom,who:Identity,input:DoudizhuInput,now:number){
 const source=g.players.findIndex(p=>p.userId===who.id),m=r.members.find(m=>m.id===who.id);
 ensure(source>=0&&m&&m.approved&&!m.accessRevoked&&!r.siteMaintenance,"Join this room first.",403);
 const emote=input.kind==="emote"&&EMOTES.has(input.value!);
 const throwable=input.kind==="throw"&&["egg","tomato"].includes(input.value!);
 ensure(emote||throwable,"Invalid reaction.");
 if(emote)ensure(input.target===undefined&&input.targetId===undefined&&input.expectedPrice===undefined,"Invalid emote.");
 let cost=0;
 if(throwable){
  ensure(Number.isInteger(input.target)&&input.target!>=0&&input.target!<g.players.length&&input.target!==source,"Invalid target.",409);
  const target=r.members.find(m=>m.id===g.players[input.target!].userId);
  ensure(target&&target.publicId===input.targetId,"That player left. Pick another seat.",409);
  const limits=casinoLimits(r);cost=input.value==="egg"?limits.pokerEggPrice:limits.pokerTomatoPrice;
  ensure(input.expectedPrice===cost,"Price changed. Review the new price and try again.",409);
  ensure(Number.isSafeInteger(m.wallet)&&m.wallet>=cost,"Not enough money in your wallet.");
  ensure(Number.isSafeInteger((r.house??0)+cost),"Invalid house balance.",500);
 }
 const budgets=r.doudizhuReactionCooldowns??{};
 ensure(budgets[who.id]===undefined||now-budgets[who.id]>=4000,"One reaction every 4 seconds.",429);
 // Bound account-wide cooldown storage; reserve only after every validation passes.
 r.doudizhuReactionCooldowns=Object.fromEntries(Object.entries(budgets).filter(([,at])=>now-at<4000));
 r.doudizhuReactionCooldowns[who.id]=now;
 if(cost){const before=m.wallet;m.wallet-=cost;r.house=(r.house??0)+cost;audit(r,who,"doudizhu.throw",input.requestId,{wallet:before},{wallet:m.wallet,amount:cost,destination:"house",value:input.value,targetId:input.targetId,code:g.code});}
 const event:DoudizhuReaction={id:input.requestId,kind:input.kind!,value:input.value!,source,sourceId:m.publicId,at:now,...(throwable?{target:input.target,targetId:input.targetId}:{})};
 g.reactions=[...(g.reactions??[]).filter(e=>now-e.at<4000).slice(-15),event];
}
