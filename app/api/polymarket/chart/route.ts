import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyChart} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
export const GET=(request:Request)=>endpoint(request,async who=>{
 polyPortfolio(await visit(who),who);const p=new URL(request.url).searchParams;return polyChart(p.get('marketId')??'',p.get('range')??'1w',{userId:who.id,tabId:request.headers.get('x-tab-id'),tabProof:request.headers.get('x-tab-proof')});
});
