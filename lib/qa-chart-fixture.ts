import {assertIsolatedQa} from "../runtime/isolated-qa.mjs";
export function fixtureMode(env:Readonly<Record<string,string|undefined>>=process.env){
 assertIsolatedQa(env);
 return env.QA_CHART_FIXTURES==="1";
}
const widths:Record<string,number>={"1m":60000,"5m":300000,"15m":900000,"1h":3600000,"6h":21600000,"1d":86400000};
/** Pure visual observations, never published as quotes or written to Mongo. */
export function fixtureCandles(symbol:string,granularity:string){
 const width=widths[granularity];
 if(!width||!(/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)||/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol)))throw new Error("Invalid fixture selection");
 const seed=[...symbol].reduce((n,c)=>n+c.charCodeAt(0),0);
 const base:Record<string,number>={BTC:68000,ETH:2400,DOGE:0.00003741,XRP:0.00231,"EUR/USD":1.083,"USD/JPY":151.3,AAPL:225};
 const anchor=base[symbol]??(symbol.includes("/")?1.25:30+seed);
 const end=Date.UTC(2026,9,23);
 return Array.from({length:360},(_,i)=>{
  const open=anchor*(1+0.035*Math.sin((i+seed)/17)+0.018*Math.cos(i/7)+i*0.00008);
  const close=open*(1+0.007*Math.sin((i+seed)/3));
  return {time:end-(359-i)*width,open,close,high:Math.max(open,close)*1.004,low:Math.min(open,close)*0.996,volume:100+(i*7919+seed)%20000};
 });
}
