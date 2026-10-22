import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyMarket,polyBook,polyChart} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
import {outcomeFor} from '@/lib/polymarket-view';
const INTERVAL:Record<string,string>={'1d':'1d','1w':'1w','1m':'1m',all:'max'};
export const GET=(request:Request,ctx:{params:Promise<{id:string}>})=>endpoint(request,async who=>{
 const {id}=await ctx.params;polyPortfolio(await visit(who),who);
 const range=new URL(request.url).searchParams.get('range')??'1w',m=await polyMarket(id);
 const c=await polyChart(outcomeFor(m,'yes').tokenId,INTERVAL[range]??'1w');
 return{points:c.history.map(h=>({t:h.t*1000,p:h.p}))};
});
