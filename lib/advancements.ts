import {roomFeatureEnabled} from "./feature-context";
import type {Member} from "./types";
import type {RouletteWager} from "./roulette";
import {ROULETTE_CHIPS} from "./roulette-chips";
import {payout} from "./finance";
import {CASINO_LIMIT_MAX_CENTS} from "./casino-limits";
import {ADVANCEMENT_REWARDS_CENTS,advancementCount,ADVANCEMENTS,type AdvancementState} from "./advancements-shared";
export {ADVANCEMENTS,type AdvancementState} from "./advancements-shared";
const kinds=new Set(["red","black","odd","even","low","high"]);
const chips=new Set<number>(ROULETTE_CHIPS.map(c=>c.value*100));
export function advancementView(member?:Pick<Member,"advancements">):AdvancementState{
 const state=member?.advancements;
 return state?{...state,unlocked:{...state.unlocked},counts:{...state.counts},rewarded:{...state.rewarded}}:{streak:0,lastRound:0,unlocked:{}};
}
/** Only settled, real-chip even-money wagers qualify. Any qualifying win resets,
 * even if the overall round lost money. Zero loses. Skipped/nonqualifying rounds
 * leave the streak unchanged. Other wager kinds never affect this streak.
 * Called at animation end inside the existing room Mongo CAS, never speculatively
 * broadcast at spin start. Round guard makes retries/replayed ticks idempotent. */
export function settleAdvancements(member:Member,wagers:readonly RouletteWager[],number:number,round:number,at:number,room?:import("./types").Room,rewards:Record<number,number>=ADVANCEMENT_REWARDS_CENTS){
 if(!roomFeatureEnabled(room,"advancements"))return;
 const qualifying=wagers.filter(w=>w.userId===member.id&&w.dead!==true&&chips.has(w.bet.amount)&&kinds.has(w.bet.kind));
 if(!qualifying.length||round<=(member.advancements?.lastRound??0))return;
 const state=advancementView(member);
 state.lastRound=round;
 state.streak=qualifying.some(w=>payout(w.bet,number,CASINO_LIMIT_MAX_CENTS)>0)?0:state.streak+1;
 for(const {tier} of ADVANCEMENTS)if(state.streak===tier){
  const first=state.unlocked[tier]===undefined;
  state.counts??={};state.counts[tier]=advancementCount(state,tier)+1;
  if(first){
   const reward=rewards[tier]??0;
   if(!Number.isSafeInteger(reward)||reward<0)throw new Error("Invalid advancement reward");
   state.unlocked[tier]=at;state.rewarded??={};state.rewarded[tier]=reward;
   member.wallet+=reward;
   // Issuance and player adjustment keep balance conservation and trading P/L honest.
   if(room){room.issuance=(room.issuance??0)+reward;member.adjustments=(member.adjustments??0)+reward;
    room.auditPending??=[];room.auditPending.push({_id:"advancement:"+member.id+":"+tier,who:member.id,what:"advancement-first-reward",target:member.id,old:null,new:{tier,reward,round,at},at});
   }
  }
 }
 member.advancements=state;
}
