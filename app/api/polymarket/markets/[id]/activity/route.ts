import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyMarket,polyBook,polyChart} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
import {outcomeFor} from '@/lib/polymarket-view';
import {sideOf} from '@/lib/polymarket-view';
/** Simulated room trades only: other players' fills on this market, newest first. */
export const GET=(request:Request,ctx:{params:Promise<{id:string}>})=>endpoint(request,async who=>{
 const {id}=await ctx.params,r=await visit(who);polyPortfolio(r,who);
 const m=await polyMarket(id),names=new Map(r.members.map(x=>[x.id,x.name]));
 const trades=Object.entries(r.polymarket?.history??{}).flatMap(([uid,list])=>list.filter(h=>h.marketId===id&&(h.action==='buy'||h.action==='sell')).map(h=>({t:h.at,side:h.action,outcome:sideOf(m,h.tokenId),size:h.shareMicros/1e6,price:h.shareMicros>0?h.amount/100/(h.shareMicros/1e6):0,user:names.get(uid)??'Player'})));
 return{trades:trades.sort((a,b)=>b.t-a.t).slice(0,30).map(t=>({...t,side:t.side+' '+t.outcome.toUpperCase()}))};
});
