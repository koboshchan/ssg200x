import {audit} from "./audit";
import {ensure} from "./errors";
import {casinoLimits,assertCasinoLimit} from "./casino-limits";
import type {Room,Identity} from "./types";
export type CasinoLimitChange={rouletteMaxTotal:number;blackjackMaxHand:number;expectedVersion:number};
export function adminCasinoSnapshot(room:Room,who:Identity){
 ensure(who.admin===true,"Administrator access required.",403);
 return {casinoLimits:casinoLimits(room)};
}
export function changeCasinoLimits(room:Room,who:Identity,input:CasinoLimitChange){
 ensure(who.admin===true,"Administrator access required.",403);
 assertCasinoLimit(input.rouletteMaxTotal);assertCasinoLimit(input.blackjackMaxHand);
 const old=casinoLimits(room);
 ensure(Number.isSafeInteger(input.expectedVersion)&&input.expectedVersion===old.revision,"Casino limits changed. Reload and try again.",409);
 const next={rouletteMaxTotal:input.rouletteMaxTotal,blackjackMaxHand:input.blackjackMaxHand,revision:old.revision+1};
 audit(room,who,"casino-limits","main",old,next);
 room.casinoLimits=next;
}
