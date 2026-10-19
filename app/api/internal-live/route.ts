import {NextResponse} from "next/server";
import {internalLiveAuthorized,socketIdentity} from "@/lib/internal-live";
import {siteMaintenance} from "@/lib/site-maintenance";
import {backfillProgress} from "@/lib/candles";
import {readRoom} from "@/lib/db";
import {publicRoom} from "@/lib/public";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:Request){
 const headers={"Cache-Control":"no-store"};
 if(!internalLiveAuthorized(request))return NextResponse.json({error:"Unauthorized"},{status:401,headers});
 try{
  const who=socketIdentity.parse(await request.json());
  const maintenance=await siteMaintenance(who.admin);
  const history=who.admin?(await backfillProgress()).history:null;
  const room=maintenance.blocked?null:await readRoom();
  return NextResponse.json({maintenance,history,room:room?.members.some(m=>m.id===who.id)?publicRoom(room,who):null},{headers});
 }catch{return NextResponse.json({error:"Live state unavailable"},{status:503,headers});}
}
