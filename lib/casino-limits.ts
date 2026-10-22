import {ensure} from "./errors";
import type {Room} from "./types";
/** All values are integer cents. Settings accept positive whole dollars only. */
export type CasinoLimits={rouletteMaxTotal:number;blackjackMaxHand:number;pokerMaxBuyIn:number;pokerEggPrice:number;pokerTomatoPrice:number;gamesMaxBet:number;revision:number};
export const CASINO_LIMIT_MAX_CENTS=100_000_000;
export const DEFAULT_CASINO_LIMITS:Readonly<CasinoLimits>=Object.freeze({rouletteMaxTotal:100_000,blackjackMaxHand:100_000,pokerMaxBuyIn:100_000,pokerEggPrice:5000,pokerTomatoPrice:5000,gamesMaxBet:100_000,revision:0});
export function validCasinoLimit(value:unknown):value is number{
 return typeof value==="number"&&Number.isSafeInteger(value)&&value>=100&&value<=CASINO_LIMIT_MAX_CENTS&&value%100===0;
}
export function casinoLimits(room:Room):CasinoLimits{
 const saved=room.casinoLimits;
 return {gamesMaxBet:validCasinoLimit(saved?.gamesMaxBet)?saved.gamesMaxBet:DEFAULT_CASINO_LIMITS.gamesMaxBet,pokerEggPrice:validCasinoLimit(saved?.pokerEggPrice)?saved!.pokerEggPrice:5000,pokerTomatoPrice:validCasinoLimit(saved?.pokerTomatoPrice)?saved!.pokerTomatoPrice:5000,rouletteMaxTotal:validCasinoLimit(saved?.rouletteMaxTotal)?saved.rouletteMaxTotal:DEFAULT_CASINO_LIMITS.rouletteMaxTotal,blackjackMaxHand:validCasinoLimit(saved?.blackjackMaxHand)?saved.blackjackMaxHand:DEFAULT_CASINO_LIMITS.blackjackMaxHand,pokerMaxBuyIn:validCasinoLimit(saved?.pokerMaxBuyIn)&&saved!.pokerMaxBuyIn>=10_000?saved!.pokerMaxBuyIn:DEFAULT_CASINO_LIMITS.pokerMaxBuyIn,revision:Number.isSafeInteger(saved?.revision)&&saved!.revision>=0?saved!.revision:0};
}
export function assertCasinoLimit(value:unknown):asserts value is number{
 ensure(validCasinoLimit(value),"Limits must be whole dollars between $1 and $1,000,000.");
}
