
import {pokerStakes,type POKER_STAKES} from "./poker-stakes";
export type PokerBuyInTable=keyof typeof POKER_STAKES;
export function pokerBuyInRange(id:PokerBuyInTable){const s=pokerStakes(id);return {min:s.minBuyIn,max:s.maxBuyIn};}
export function defaultPokerBuyInDollars(id:PokerBuyInTable){return String(pokerBuyInRange(id).max/100);}
export function pokerBuyInStatus(id:PokerBuyInTable,cents:number|null,wallet:number){
 const {min,max}=pokerBuyInRange(id);
 if(wallet<min)return {ok:false,hint:"You need at least $"+min/100+" in your wallet to join this table."};
 if(cents===null)return {ok:false,hint:"Enter a whole-dollar buy-in."};
 if(cents<min||cents>max)return {ok:false,hint:"Buy-in must be $"+min/100+"–$"+max/100+"."};
 if(cents>wallet)return {ok:false,hint:"Your wallet has $"+Math.floor(wallet/100)+". Lower the buy-in."};
 return {ok:true,hint:""};
}
