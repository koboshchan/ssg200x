import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyMarket,polyBook,polyChart} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
import {outcomeFor} from '@/lib/polymarket-view';
export const GET=(request:Request,ctx:{params:Promise<{id:string}>})=>endpoint(request,async who=>{
 const {id}=await ctx.params;polyPortfolio(await visit(who),who);
 const b=await polyBook(outcomeFor(await polyMarket(id),'yes').tokenId);
 return{bids:b.bids.slice(0,12).map(l=>({price:l.price,size:l.size})),asks:b.asks.slice(0,12).map(l=>({price:l.price,size:l.size})),asOf:b.asOf,serverNow:Date.now()};
});
