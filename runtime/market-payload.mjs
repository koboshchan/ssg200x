// Socket identities are supplied only by verified Clerk claims, never client messages.
export function marketPayload(room,userId,now=Date.now()) {
 const member=room.members.find(m=>m.id===userId);if(!member)return null;
 const quotes=Object.fromEntries(Object.entries(room.quotes||{}).filter(([,q])=>q&&Number.isSafeInteger(q.micro)&&q.micro>0&&Number.isSafeInteger(q.at)).map(([s,q])=>[s,{micro:q.micro,at:q.at}]));
 const holdings=(member.holdings||[]).map(h=>({symbol:h.symbol,units:h.units,cost:h.cost,value:quotes[h.symbol]?Number(BigInt(h.units)*BigInt(quotes[h.symbol].micro)/1_000_000_000_000n):h.cost}));
 const positions=(member.positions||[]).map(p=>{
  const pnl=quotes[p.symbol]?Math.floor(p.margin*p.leverage*(quotes[p.symbol].micro-p.entry)/p.entry*(p.side==="long"?1:-1)):0;
  const m=p.maintenance||0,liquidation=p.liquidationOverride??(p.side==="long"?p.entry*(1-1/p.leverage)/(1-m):p.entry*(1+1/p.leverage)/(1+m));
  return {id:p.id,symbol:p.symbol,side:p.side,margin:p.margin,leverage:p.leverage,entry:p.entry,opened:p.opened,liquidation,pnl,equity:Math.max(0,p.margin+pnl)};
 });
 return {version:room.version,serverNow:now,quotes,holdings,positions,wallet:member.wallet,activity:(member.activity||[]).slice(0,40)};
}
