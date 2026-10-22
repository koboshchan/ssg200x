import {subscribeMarket} from './market-subscription.mjs';
import {subscribeChart} from './chart-stream.mjs';
const symbolOK=s=>typeof s==='string'&&(/^[A-Z][A-Z0-9.\-]{0,14}$/.test(s)||/^[A-Z]{3}\/[A-Z]{3}$/.test(s));
const chartOK=s=>s&&typeof s==='object'&&!Array.isArray(s)&&Object.keys(s).length===2&&symbolOK(s.symbol)&&['1m','5m','15m','1h','6h','1d'].includes(s.granularity);
// Wishes are connection-local, not active subscriptions. A disable suspends them;
// null, navigation, expiry and disconnect revoke them. No client-side cooperation
// is required. The current trusted snapshot universe is the only symbol allowlist.
export function attachMarketFeatureSubscriptions(socket,{settings,now=Date.now}){
 let symbols=null,market=null,chart=null,stopped=false;
 const valid=()=>!stopped&&socket.connected&&socket.data.expires>now()&&socket.data.marketRoute==='/markets';
 function allowed(symbol){
  if(symbols?.forex?.includes(symbol))return settings.enabled('forex');
  if(symbols?.stocks?.includes(symbol))return settings.enabled('stocks');
  if(symbols?.crypto?.includes(symbol))return settings.enabled('cryptoSpot')||settings.enabled('cryptoPerps');
  return false;
 }
 function sync(){
  if(!valid()){market=chart=null;}
  if(symbols){if(market&&!['crypto','stocks','forex'].some(k=>symbols[k]?.includes(market)))market=null;
   if(chart&&!['crypto','stocks','forex'].some(k=>symbols[k]?.includes(chart.symbol)))chart=null;}
  const next=valid()&&allowed(market)?market:null;
  if((socket.data.marketSymbol??null)!==next)subscribeMarket(socket,next);
  const nextChart=valid()&&chart&&allowed(chart.symbol)?chart:null,active=socket.data.chart;
  if((active?.symbol??null)!==(nextChart?.symbol??null)||(active?.granularity??null)!==(nextChart?.granularity??null)){
   subscribeChart(socket,null);
   if(nextChart)subscribeChart(socket,nextChart,now());
  }
 }
 function reply(ack,symbol){if(typeof ack==='function')ack(symbol&&!allowed(symbol)?{ok:false,error:'feature_disabled'}:{ok:true});}
 socket.on('market:subscribe',(symbol,ack)=>{
  if(symbol!==null&&!symbolOK(symbol))return;
  if(symbol!==null&&!valid())return;
  // Unknown universe can arrive before the first snapshot. Keep the wish but do
  // not activate it until that trusted snapshot arrives.
  market=symbol;if(symbols&&symbol&&!allowed(symbol))market=null;sync();reply(ack,symbol);
 });
 socket.on('candles:subscribe',(selection,ack)=>{
  if(selection!==null&&!chartOK(selection))return;
  if(selection!==null&&!valid())return;
  chart=selection?{...selection}:null;if(symbols&&chart&&!allowed(chart.symbol))chart=null;sync();reply(ack,selection?.symbol);
 });
 socket.on('tab:report',report=>{if(typeof report?.route!=='string')return;socket.data.marketRoute=report.route;sync();});
 const unsubscribe=settings.subscribe(sync);
 socket.on('disconnect',()=>{stopped=true;sync();unsubscribe();});
 return {sync,project(room){return {...room,marketSummary:Object.fromEntries(Object.entries(room.marketSummary??{}).filter(([symbol])=>allowed(symbol)))};},updateSymbols(value){symbols=value;sync();}};
}
