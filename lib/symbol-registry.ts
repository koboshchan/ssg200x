import {MARKET_CONFIG} from "./market-config";
import {STOCK_SYMBOLS} from "./stock-config";
export type MarketSymbols={crypto:string[];stocks:string[];delisted:string[];revision:number};
export type SymbolContext={marketSymbols?:MarketSymbols};
export const LEGACY_SYMBOLS=["ZEC","HYPE","DOGE","LINK","ADA","NEAR","XLM","BCH","UNI","AVAX","SUI","HBAR","TAO","SHIB"];
export function marketSymbols(context?:SymbolContext|null):MarketSymbols {
 return context?.marketSymbols??{crypto:[...MARKET_CONFIG.symbols],stocks:[...STOCK_SYMBOLS],delisted:[...LEGACY_SYMBOLS],revision:0};
}
export function activeSymbols(context?:SymbolContext|null){const m=marketSymbols(context);return [...m.crypto,...m.stocks];}
export function activeSymbol(symbol:string,context?:SymbolContext|null){return activeSymbols(context).includes(symbol);}
export function delistedSymbol(symbol:string,context?:SymbolContext|null){return marketSymbols(context).delisted.includes(symbol);}
export function stockSymbol(symbol:unknown,context?:SymbolContext|null):symbol is string{return typeof symbol==="string"&&marketSymbols(context).stocks.includes(symbol);}
export const MAX_ACTIVE_STOCKS=30;
export const SYMBOL_PATTERN=/^[A-Z][A-Z0-9.\-]{0,14}$/;
