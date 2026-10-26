// Mounts the REAL app/api route handlers (only lib/api, server-names and next/server are fixtures).
import * as room from "../../app/api/room/route";
import * as action from "../../app/api/action/route";
import * as blackjack from "../../app/api/blackjack/route";
import * as roulette from "../../app/api/roulette/route";
import * as doudizhu from "../../app/api/doudizhu/route";
import {tickRoom} from "@/lib/store";
import {readRoom} from "@/lib/db";
import {freshPublicRoom} from "@/lib/public";
import {FEATURE_DEFAULTS} from "@/lib/feature-catalog";
import {endpoint} from "@/lib/api";
import {FIXTURE_USERS} from "./fixture-api";
const table:Record<string,any>={"/api/room":room,"/api/action":action,"/api/blackjack":blackjack,"/api/roulette":roulette,"/api/doudizhu":doudizhu};
export async function dispatch(request:Request,path:string):Promise<Response|null>{
 if(path==="/api/features")return Response.json({features:FEATURE_DEFAULTS},{headers:{"Cache-Control":"no-store"}});
 if(path==="/api/maintenance")return endpoint(request,async()=>({blocked:false,active:false,manual:false}));
 if(path==="/api/device-fingerprint")return Response.json({ok:true});
 const mod=table[path];const fn=mod?.[request.method];
 return typeof fn==="function"?fn(request):null;
}
export async function tick(){await tickRoom();}
export async function snapshot(user:string,tableId:any){const who=(FIXTURE_USERS as any)[user];if(!who)return null;const r=await readRoom();if(!r.members.some((m:any)=>m.id===user))return {version:r.version};return freshPublicRoom(r,who,undefined,tableId);}
