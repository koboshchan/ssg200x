import {ensure} from "./errors";
import {requireSpotQuote,value} from "./finance";
import {activeSymbol} from "./symbol-registry";
import type {Room,Identity} from "./types";

/** Settle the exact owned units, not a rounded dollar order that leaves dust. */
export function sellAllSpot(r:Room,who:Identity,symbol:string,now=Date.now()){
 ensure(activeSymbol(symbol,r),"Asset is delisted. Use legacy redemption.",410);
 const m=r.members.find(m=>m.id===who.id),h=m?.holdings?.find(h=>h.symbol===symbol);
 ensure(m&&h&&Number.isSafeInteger(h.units)&&h.units>0,"No holding to sell.",404);
 const price=requireSpotQuote(r,symbol,now),returned=value(h.units,price);
 ensure(Number.isSafeInteger(returned)&&returned>0,"Holding is worth less than $0.01. Your units are retained.");
 ensure(returned<=100_000_000&&returned<=(r.limits?.maxTrade??1000000)*100,"Holding exceeds the host’s trade limit. Sell a smaller amount using the order ticket.");
 ensure(Number.isSafeInteger(m.wallet+returned),"Wallet exceeds simulation limit.");
 m.wallet+=returned;r.house=(r.house||0)+h.cost-returned;
 m.holdings=m.holdings!.filter(x=>x!==h);
}
