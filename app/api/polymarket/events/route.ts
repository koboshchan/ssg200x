import {endpoint} from '@/lib/api';
import {visit} from '@/lib/store';
import {polyDiscover} from '@/lib/polymarket-data';
import {polyPortfolio} from '@/lib/polymarket';
import {viewEvent,viewSettings,rememberTags,categoriesSeen,tagIdFor} from '@/lib/polymarket-view';
export const GET=(request:Request)=>endpoint(request,async who=>{
 const r=await visit(who),pf=polyPortfolio(r,who),p=new URL(request.url).searchParams;
 const category=(p.get('category')??'').slice(0,60),sort=p.get('sort')??'trending',limit=Math.min(50,Math.max(1,Number(p.get('limit'))||24));
 const found=await polyDiscover((p.get('q')??'').slice(0,120),'',category?tagIdFor(category):'');
 rememberTags(found.events);
 let events=found.events.map(e=>viewEvent(e)).filter(e=>e.markets.length>0);
 if(sort==='volume')events=events.sort((a,b)=>b.volume-a.volume);
 else if(sort==='ending')events=events.filter(e=>e.endDate).sort((a,b)=>String(a.endDate).localeCompare(String(b.endDate)));
 return{...viewSettings(r),wallet:pf.wallet,categories:categoriesSeen(),events:events.slice(0,limit),total:events.length};
});
