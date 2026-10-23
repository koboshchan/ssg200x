import {cryptoExecutable,type CryptoStatus} from './crypto-policy';
import {quoteFresh} from './price-policy';
import type {LiveQuote} from './live-candle';
export type ChartDisplayContext=
 |{kind:'forex'}
 |{kind:'stock';stockExecution?:{executable:boolean;validUntil:number}}
 |{kind:'crypto';cryptoStatus?:CryptoStatus|null};
export type ChartDisplayQuote=LiveQuote&{source?:string;cryptoGeneration?:string};
/** Display only. Never manufacture a current timestamp from a retained print.
 * FX last-native prices remain viewable while execution is unavailable; stock
 * and crypto use their existing server status/transport policy, not a 10s print age.
 * Stock provenance comes from the server-verified stockExecution/quote pairing.
 */
export function chartDisplayQuote(quote:ChartDisplayQuote,context:ChartDisplayContext,now:number):ChartDisplayQuote|undefined{
 if(!Number.isFinite(now)||!Number.isSafeInteger(quote.micro)||quote.micro<=0||!Number.isSafeInteger(quote.at)||quote.at<0||quote.at>now)return;
 if(context.kind==='forex')return quote.source==='oanda'?quote:undefined;
 if(context.kind==='stock'){
  const state=context.stockExecution;
  return (quote.source===undefined||quote.source==='alpaca-iex')&&state?.executable&&Number.isFinite(state.validUntil)&&now<state.validUntil&&quoteFresh(quote.at,now,true)?quote:undefined;
 }
 return (quote.source===undefined||quote.source==='coinbase')&&cryptoExecutable(context.cryptoStatus??undefined,quote,now)?quote:undefined;
}
