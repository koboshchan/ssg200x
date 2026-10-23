import {NextResponse} from "next/server";
import {endpoint} from "@/lib/api";
import {fixtureMode,fixtureCandles} from "@/lib/qa-chart-fixture";
export const dynamic="force-dynamic";
export const GET=(request:Request)=>{
 if(!fixtureMode())return NextResponse.json({error:"Not found"},{status:404,headers:{"Cache-Control":"no-store"}});
 return endpoint(request,async()=>{
  const p=new URL(request.url).searchParams;
  return {fixtureDemoOnly:true,liveDisabled:true,candles:fixtureCandles(p.get("symbol")??"BTC",p.get("granularity")??"1h")};
 });
};
