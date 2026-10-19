import {MARKET_CONFIG} from "./market-config";
export const SYMBOLS=MARKET_CONFIG.symbols;
export type Symbol=typeof SYMBOLS[number];
export const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export type Bet={kind:"straight"|"red"|"black"|"odd"|"even"|"low"|"high"|"dozen"|"column";pick?:number;amount:number};
