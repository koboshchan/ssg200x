import {resetStream} from "./state-stream.mjs";
// Fail closed: one selection, never an implicit all-symbol subscription.
export function subscribeMarket(socket,symbol){
 if(symbol!==null&&(typeof symbol!=="string"||!(/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)||/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol))))return;
 socket.data.marketSymbol=symbol??undefined;
 resetStream(socket,"room:state");socket.data.statusAt=0;
}
export function scopeMarketRoom(room,symbol){
 const pick=record=>symbol&&Object.hasOwn(record||{},symbol)?{[symbol]:record[symbol]}:{};
 // Portfolio valuations and trigger execution are computed using the complete
 // server-side quote book before this transport-only projection.
 return {...room,...(room.marketSummary?{marketSummary:symbol?room.marketSummary:{}}:{}),...(room.quotes?{quotes:pick(room.quotes)}:{}),...(room.marketChanges?{marketChanges:pick(room.marketChanges)}:{}),...(room.forexQuotes?{forexQuotes:pick(room.forexQuotes)}:{}),...(room.forexExecution?{forexExecution:pick(room.forexExecution)}:{}),...(room.stockExecution?{stockExecution:pick(room.stockExecution)}:{})};
}
