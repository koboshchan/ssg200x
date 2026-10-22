import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyPortfolio} from '@/lib/polymarket';
import {viewPortfolio,viewSettings} from '@/lib/polymarket-view';
export const GET=(request:Request)=>endpoint(request,async who=>{
 const r=await visit(who),p=polyPortfolio(r,who);
 return{...viewSettings(r),...await viewPortfolio(r,who.id,p.wallet,p.history,p.positions as never)};
});
