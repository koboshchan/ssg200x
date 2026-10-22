import {closingFeeCents,closingFeeReserve} from "./perp-fee-policy.mjs";
import {hideFromLeaderboard} from "./leaderboard-privacy.mjs";
import {roomFeeRates,positionFeeRates} from "./perp-fee-policy.mjs";
// Socket identities are supplied only by verified Clerk claims, never client messages.
export function marketPayload(room,userId,now=Date.now()) {
 const member=room.members.find(m=>m.id===userId);if(!member)return null;
 const quotes=Object.fromEntries(Object.entries(room.quotes||{}).filter(([,q])=>q&&Number.isSafeInteger(q.micro)&&q.micro>0&&Number.isSafeInteger(q.at)).map(([s,q])=>[s,{micro:q.micro,at:q.at}]));
 const holdings=(member.holdings||[]).map(h=>({symbol:h.symbol,units:h.units,cost:h.cost,value:quotes[h.symbol]?Number(BigInt(h.units)*BigInt(quotes[h.symbol].micro)/1_000_000_000_000n):h.cost}));
 const positions=(member.positions||[]).map(p=>{
  const pnl=quotes[p.symbol]?Math.floor(p.margin*p.leverage*(quotes[p.symbol].micro-p.entry)/p.entry*(p.side==="long"?1:-1)):0;
  const m=(p.maintenance||0)+closingFeeReserve(p),liquidation=p.liquidationOverride??(p.side==="long"?p.entry*(1-(p.collateral??p.margin)/(p.margin*p.leverage))/(1-m):p.entry*(1+(p.collateral??p.margin)/(p.margin*p.leverage))/(1+m));
  return {revision:p.revision??0,id:p.id,symbol:p.symbol,side:p.side,margin:p.margin,...(p.postedMargin!==undefined?{postedMargin:p.postedMargin}:{}),...(p.collateral!==undefined?{collateral:p.collateral}:{}),leverage:p.leverage,entry:p.entry,opened:p.opened,feePpm:p.feePpm||0,...positionFeeRates(p),...(p.closingFeeMode!==undefined?{closingFeeMode:p.closingFeeMode}:{}),openingFee:p.openingFee||0,...(p.takeProfit!==undefined?{takeProfit:p.takeProfit}:{}),...(p.stopLoss!==undefined?{stopLoss:p.stopLoss}:{}),liquidation,pnl:((p.side==="long"?(quotes[p.symbol]?.micro??p.entry)<=liquidation:(quotes[p.symbol]?.micro??p.entry)>=liquidation)?0:Math.max(0,(p.collateral??p.margin)+pnl-closingFeeCents(p,quotes[p.symbol]?.micro??p.entry,pnl)))-(p.postedMargin??p.margin)-(p.collateral===undefined?(p.openingFee||0):0),equity:Math.max(0,(p.collateral??p.margin)+pnl)};
 });
 const netWorthFor=m=>{
  const spot=(m.holdings||[]).reduce((n,h)=>n+(quotes[h.symbol]?Number(BigInt(h.units)*BigInt(quotes[h.symbol].micro)/1_000_000_000_000n):h.cost),0);
  const perps=(m.positions||[]).reduce((n,p)=>n+Math.max(0,(p.collateral??p.margin)+(quotes[p.symbol]?Math.floor(p.margin*p.leverage*(quotes[p.symbol].micro-p.entry)/p.entry*(p.side==="long"?1:-1)):0)),0);
  const seat=(room.seats||[]).find(s=>s?.userId===m.id),active=room.street!=="waiting"&&room.street!=="showdown";
  const blackjack=["lounge","salon","terrace"].reduce((sum,id)=>{const b=room.blackjackTables?.tables?.[id];if(!b||b.phase==="settled")return sum;return sum+b.seats.reduce((n,s)=>n+(!s||s.userId!==m.id?0:b.phase==="betting"?s.bet:s.hands.reduce((v,h)=>v+h.bet,0)),0);},0);
  const roulette=(room.roulette?.bets||[]).reduce((n,w)=>n+(w.userId===m.id?w.bet.amount:0),0);
  const doudizhu=(room.doudizhu||[]).reduce((n,g)=>n+g.players.reduce((s,p)=>s+(p.userId===m.id?p.escrow:0),0),0);
  return m.wallet+spot+perps+blackjack+roulette+doudizhu+(seat?seat.stack+(active?seat.committed:0):0);
 };
 const leaderboard=room.members.filter(m=>!hideFromLeaderboard(m)).map(m=>{const netWorth=netWorthFor(m);return {publicId:m.publicId,name:m.name,netWorth,pnl:netWorth-100000-(m.adjustments||0)};}).sort((a,b)=>b.netWorth-a.netWorth||a.name.localeCompare(b.name));
 const stockExecution=Object.fromEntries((room.marketSymbols?.stocks??["AAPL","TSLA","NVDA","MSFT","AMD","SPCX","SPY"]).map(symbol=>{
  const state=room.stockExecution?.[symbol],q=quotes[symbol],tick=state?.tick,clock=state?.clock;
  const session=state?.sessions?.find(s=>now>=s.open&&now<s.close);
  const validUntil=Math.min(state?.leaseUntil||0,(tick?.timestamp||0)+60000,(tick?.receivedAt||0)+60000,(clock?.receivedAt||0)+60000,session?.close||0);
  const executable=!!(state?.symbol===symbol&&state.authorized&&state.connected&&state.leader&&session&&clock?.isOpen&&clock.nextClose===session.close&&Math.abs(now-clock.timestamp)<=60000&&now>=clock.receivedAt&&now<validUntil&&tick?.symbol===symbol&&tick.feed==="alpaca-iex"&&now>=tick.timestamp&&now>=tick.receivedAt&&now-tick.receivedAt<60000&&tick.timestamp>=session.open&&q?.micro===Math.round(tick.price*1e6)&&q?.at===tick.timestamp);
  return [symbol,{executable,reason:executable?"fresh_regular_session":!session||!clock?.isOpen?"closed_or_calendar_unverified":"stale_or_invalid_tick",checkedAt:now,validUntil}];
 }));

 return {perpFeePpm:roomFeeRates(room).openingFeePpm,perpOpeningFeePpm:roomFeeRates(room).openingFeePpm,perpClosingFeePpm:roomFeeRates(room).closingFeePpm,perpClosingFeeMode:room.perpClosingFeeMode??"notional",stockExecution,netWorth:netWorthFor(member),leaderboard,version:room.version,serverNow:now,quotes,holdings,positions,closedPositions:(member.closedPositions||[]).map(p=>({id:p.id,symbol:p.symbol,side:p.side,leverage:p.leverage,entry:p.entry,exit:p.exit,...(p.postedMargin!==undefined?{postedMargin:p.postedMargin}:{}),...(p.collateral!==undefined?{collateral:p.collateral}:{}),realizedPnl:p.realizedPnl,...(p.openingFee!==undefined?{...(p.openingFeePpm!==undefined?{openingFeePpm:p.openingFeePpm}:{}),...(p.closingFeePpm!==undefined?{closingFeePpm:p.closingFeePpm}:{}),...(p.closingFeeMode!==undefined?{closingFeeMode:p.closingFeeMode}:{}),openingFee:p.openingFee,closingFee:p.closingFee,assessedClosingFee:p.assessedClosingFee,waivedClosingFee:p.waivedClosingFee}:{}),reason:p.reason,closedAt:p.closedAt})),wallet:member.wallet,activity:(member.activity||[]).slice(0,40)};
}
