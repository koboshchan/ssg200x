import {STOCK_SYMBOLS,isStockSymbol,type StockSymbol} from "./stock-config";
import {MARKET_CONFIG} from "./market-config";
export const SYMBOLS=MARKET_CONFIG.symbols;
// Persisted asset claims outlive the active market allowlist.
export const DELISTED_SYMBOLS=["ZEC","HYPE","DOGE","LINK","ADA","NEAR","XLM","BCH","UNI","AVAX","SUI","HBAR","TAO","SHIB"] as const;
export const TRADING_SYMBOLS=[...SYMBOLS,...STOCK_SYMBOLS] as const;
export type Symbol=typeof SYMBOLS[number]|typeof DELISTED_SYMBOLS[number]|StockSymbol;
export function isActiveSymbol(symbol:string){return (SYMBOLS as readonly string[]).includes(symbol)||isStockSymbol(symbol);}
export function isDelistedSymbol(symbol:string){return (DELISTED_SYMBOLS as readonly string[]).includes(symbol);}
export const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export type Bet={kind:"straight"|"red"|"black"|"odd"|"even"|"low"|"high"|"dozen"|"column";pick?:number;amount:number};
