import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyChart} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
export const GET=(request:Request,ctx:{params:Promise<{id:string}>})=>endpoint(request,async who=>{
 const {id}=await ctx.params;polyPortfolio(await visit(who),who);
 return polyChart(id,new URL(request.url).searchParams.get('range')??'1w',{userId:who.id,tabId:request.headers.get('x-tab-id'),tabProof:request.headers.get('x-tab-proof')});
});
