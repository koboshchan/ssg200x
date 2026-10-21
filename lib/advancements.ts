import type {Member} from "./types";
import type {RouletteWager} from "./roulette";
import {ROULETTE_CHIPS} from "./roulette-chips";
import {payout} from "./finance";
import {CASINO_LIMIT_MAX_CENTS} from "./casino-limits";
import {ADVANCEMENTS,type AdvancementState} from "./advancements-shared";
export {ADVANCEMENTS,type AdvancementState} from "./advancements-shared";
const kinds=new Set(["red","black","odd","even","low","high"]);
const chips=new Set<number>(ROULETTE_CHIPS.map(c=>c.value*100));
export function advancementView(member?:Pick<Member,"advancements">):AdvancementState{
 const state=member?.advancements;
 return state?{...state,unlocked:{...state.unlocked}}:{streak:0,lastRound:0,unlocked:{}};
}
/** Only settled, real-chip even-money wagers qualify. Any qualifying win resets,
 * even if the overall round lost money. Zero loses. Skipped/nonqualifying rounds
 * leave the streak unchanged. Other wager kinds never affect this streak.
 * Called at animation end inside the existing room Mongo CAS, never speculatively
 * broadcast at spin start. Round guard makes retries/replayed ticks idempotent. */
export function settleAdvancements(member:Member,wagers:readonly RouletteWager[],number:number,round:number,at:number){
 const qualifying=wagers.filter(w=>w.userId===member.id&&w.dead!==true&&chips.has(w.bet.amount)&&kinds.has(w.bet.kind));
 if(!qualifying.length||round<=(member.advancements?.lastRound??0))return;
 const state=advancementView(member);
 state.lastRound=round;
 state.streak=qualifying.some(w=>payout(w.bet,number,CASINO_LIMIT_MAX_CENTS)>0)?0:state.streak+1;
 for(const {tier} of ADVANCEMENTS)if(state.streak>=tier&&state.unlocked[tier]===undefined)state.unlocked[tier]=at;
 member.advancements=state;
}
