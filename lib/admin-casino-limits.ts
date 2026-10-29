import {POKER_STAKES} from "./poker-stakes";
import {audit} from "./audit";
import {ensure} from "./errors";
import {casinoLimits,assertCasinoLimit} from "./casino-limits";
import type {Room,Identity} from "./types";
export type CasinoLimitChange={rouletteMaxTotal:number;blackjackMaxHand:number;pokerMaxBuyIn?:number;gamesMaxBet?:number;pokerEggPrice?:number;pokerTomatoPrice?:number;expectedVersion:number};
export function adminCasinoSnapshot(room:Room,who:Identity){
 ensure(who.admin===true,"Administrator access required.",403);
 return {casinoLimits:casinoLimits(room),pokerBuyInPolicy:"table-stakes" as const,pokerTableLimits:Object.fromEntries(Object.entries(POKER_STAKES).map(([id,{minBuyIn,maxBuyIn}])=>[id,{minBuyIn,maxBuyIn}]))};
}
export function changeCasinoLimits(room:Room,who:Identity,input:CasinoLimitChange){
 ensure(who.admin===true,"Administrator access required.",403);
 assertCasinoLimit(input.rouletteMaxTotal);assertCasinoLimit(input.blackjackMaxHand);
 const old=casinoLimits(room);
 ensure(Number.isSafeInteger(input.expectedVersion)&&input.expectedVersion===old.revision,"Casino limits changed. Reload and try again.",409);
 // Deprecated global poker cap is compatibility data, never a join policy.
 // Older clients may echo its unchanged value while saving unrelated limits.
 const pokerMaxBuyIn=input.pokerMaxBuyIn===undefined?old.pokerMaxBuyIn:input.pokerMaxBuyIn;
 assertCasinoLimit(pokerMaxBuyIn);ensure(pokerMaxBuyIn===old.pokerMaxBuyIn,"Poker buy-ins are fixed per table at 20–100 big blinds; the global poker cap is no longer editable.");
 const pokerEggPrice=input.pokerEggPrice??old.pokerEggPrice,pokerTomatoPrice=input.pokerTomatoPrice??old.pokerTomatoPrice;assertCasinoLimit(pokerEggPrice);assertCasinoLimit(pokerTomatoPrice);
 const gamesMaxBet=input.gamesMaxBet===undefined?old.gamesMaxBet:input.gamesMaxBet;assertCasinoLimit(gamesMaxBet);
 const next={gamesMaxBet,pokerEggPrice,pokerTomatoPrice,pokerMaxBuyIn,rouletteMaxTotal:input.rouletteMaxTotal,blackjackMaxHand:input.blackjackMaxHand,revision:old.revision+1};
 audit(room,who,"casino-limits","main",old,next);
 room.casinoLimits=next;
}
