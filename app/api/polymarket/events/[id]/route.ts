import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyEvent} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
import {viewEvent,viewSettings} from '@/lib/polymarket-view';
export const GET=(request:Request,ctx:{params:Promise<{id:string}>})=>endpoint(request,async who=>{
 const {id}=await ctx.params,r=await visit(who);polyPortfolio(r,who);
 const e=await polyEvent(id);
 return viewEvent(e,{...viewSettings(r),resolutionSource:undefined});
});
