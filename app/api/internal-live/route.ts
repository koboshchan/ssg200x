import {NextResponse} from "next/server";
import {internalLiveAuthorized,socketIdentity} from "@/lib/internal-live";
import {siteMaintenance} from "@/lib/site-maintenance";
import {backfillProgress} from "@/lib/candles";
import {visit} from "@/lib/store";
import {publicRoom} from "@/lib/public";
import {liveStatusCache} from "@/lib/live-status-cache";
import {chartSelection,chartSnapshot} from "@/lib/chart-snapshot";
const maintenanceStatus=liveStatusCache(()=>siteMaintenance(false));
const historyStatus=liveStatusCache(async()=>(await backfillProgress()).history);
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:Request){
 const headers={"Cache-Control":"no-store"};
 if(!internalLiveAuthorized(request))return NextResponse.json({error:"Unauthorized"},{status:401,headers});
 try{
  const who=socketIdentity.parse(await request.json());
  const cached=await maintenanceStatus();
  const maintenance={...cached,admin:who.admin,blocked:!who.admin&&cached.active};
  const history=who.admin?await historyStatus():null;
  // visit keeps connected seats alive (15s write throttle) and registers WS-only users.
  const room=maintenance.blocked?null:await visit(who);
  const selection=chartSelection(request.headers.get("x-chart-symbol"),request.headers.get("x-chart-granularity"));
  const candles=selection&&!maintenance.blocked?{...selection,candles:await chartSnapshot(selection).catch(()=>null)}:null;
  return NextResponse.json({maintenance,history,candles,room:room?.members.some(m=>m.id===who.id)?publicRoom(room,who):null},{headers});
 }catch{return NextResponse.json({error:"Live state unavailable"},{status:503,headers});}
}
