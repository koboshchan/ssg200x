export const SYMBOLS=["BTC","ETH","BNB","XRP","SOL","ZEC","HYPE","DOGE","LINK","ADA","NEAR","XLM","BCH","LTC","UNI","AVAX","SUI","HBAR","TAO","SHIB"] as const;
export type Symbol=typeof SYMBOLS[number];
export const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export type Bet={kind:"straight"|"red"|"black"|"odd"|"even"|"low"|"high"|"dozen"|"column";pick?:number;amount:number};
