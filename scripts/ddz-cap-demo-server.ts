import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {doudizhuRead,doudizhuMove} from "../lib/doudizhu-store";
import {mutate} from "../lib/store";
import {applyDoudizhu,tickDoudizhu,doudizhuNeedsTick} from "../lib/doudizhu";
import {readRoom} from "../lib/db";
import {z} from "zod";
import {freshRoom,register,assertRoom} from "../lib/poker";
import {rooms} from "../lib/db";
import {randomUUID} from "node:crypto";
if(process.env.MONGODB_DB!=="fakebucks_demo_ddz_cap_7e3711bf"||process.env.MONGODB_URI!=="mongodb://127.0.0.1:42173")throw Error("Isolated demo DB required");
const users=["Sora","Mochi","Dango","Spectator"].map((name,i)=>({id:"demo-dd-"+i,name,email:"demo"+i+"@invalid.test",admin:i===0}));
const stamp={requestId:z.string().uuid(),requestAt:z.number().int(),code:z.string().max(100).optional(),version:z.number().int().nonnegative().optional()};
const schema=z.discriminatedUnion("type",[
 z.object({...stamp,type:z.literal("spectate")}).strict(),
 z.object({...stamp,type:z.literal("watch"),watchSeat:z.number().int().min(0).max(2)}).strict(),
 z.object({...stamp,type:z.literal("double"),doubleMultiplier:z.union([z.literal(1),z.literal(2),z.literal(4)])}).strict(),
 z.object({...stamp,type:z.literal("reaction"),kind:z.enum(["emote","throw"]),value:z.string().max(20),target:z.number().int().min(0).max(2).optional(),targetId:z.string().regex(/^[a-f0-9]{16}$/).optional(),expectedPrice:z.number().int().nonnegative().optional()}).strict(),
 z.object({...stamp,type:z.literal("visibility"),isPublic:z.boolean(),version:z.number().int().nonnegative()}).strict(),
z.object({...stamp,type:z.literal("create"),isPublic:z.boolean().optional(),beansPerDollar:z.number().int().min(1).max(1e9).optional(),maxLoss:z.number().int().min(100).max(1e8).optional()}).strict(),
...(["join","ready","pass","leave"] as const).map(type=>z.object({...stamp,type:z.literal(type)}).strict()),
z.object({...stamp,type:z.literal("bid"),bid:z.number().int().min(0).max(3)}).strict(),
z.object({...stamp,type:z.literal("play"),cards:z.array(z.string().max(2)).min(1).max(20)}).strict()
]);
const root=resolve("ddz-cap-demo-public");
const servedSha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
async function fixture(scenario:string){
 const r=freshRoom();users.forEach(u=>register(r,u));const now=Date.now();
 const move=(seat:number,p:Record<string,unknown>)=>applyDoudizhu(r,users[seat],{type:"ready",requestId:randomUUID(),requestAt:now,version:r.doudizhu?.[0]?.version,...p} as any,now);
 if(scenario!=="reset"){
  move(0,{type:"create",maxLoss:10000,beansPerDollar:1000});const code=r.doudizhu![0].code;
  move(1,{type:"join",code});move(2,{type:"join",code});for(let i=0;i<3;i++)move(i,{type:"ready"});move(0,{type:"bid",bid:3});
  if(scenario==="poor"){const m=r.members[0];r.house=(r.house??0)+m.wallet;m.wallet=0;}
  if(scenario==="playing")for(let i=0;i<3;i++)move(i,{type:"double",doubleMultiplier:1});
 }
 assertRoom(r);await(await rooms()).replaceOne({_id:"main"},r,{upsert:true});
}
async function main(){
if(!(await readRoom()).members.length)await fixture("doubling");
const server=createServer(async(req,res)=>{res.setHeader("Cache-Control","no-store");res.setHeader("X-Demo-Commit",servedSha);res.setHeader("X-Content-Type-Options","nosniff");try{
 if(req.url==="/__fixture"&&req.method==="POST"){
  let text="";for await(const chunk of req){text+=chunk;if(text.length>512)throw Error("Too large");}
  const data=z.object({scenario:z.enum(["doubling","poor","playing","reset"])}).strict().parse(JSON.parse(text));await fixture(data.scenario);res.setHeader("Content-Type","application/json");res.end(JSON.stringify({ok:true}));return;
 }
 if(req.url==="/__version"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({sha:servedSha,database:"isolated-demo",engine:"production-doudizhu"}));return;}
 if(req.url?.startsWith("/api/doudizhu")){
  res.setHeader("Content-Type","application/json");
  const i=Number(req.headers["x-demo-seat"]||0),who=users[i];if(!who)throw Error("Unknown demo player");
  if(req.method==="GET"){res.end(JSON.stringify(await doudizhuRead(who,new URL(req.url,"http://localhost").searchParams.get("code")||undefined)));return;}
  if(req.method!=="POST"){res.writeHead(405).end();return;}
  let text="";for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>4096)throw Error("Request too large");}
  res.end(JSON.stringify(await doudizhuMove(who,schema.parse(JSON.parse(text)))));return;
 }
 const path=req.url==="/demo.js"?"demo.js":req.url==="/demo.css"?"demo.css":req.url==="/"?"index.html":null;
 if(!path){res.writeHead(404).end();return;}res.setHeader("Content-Type",path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":"text/html");res.end(readFileSync(resolve(root,path)));
}catch(e){res.writeHead((e as any).status||400,{"Content-Type":"application/json"});res.end(JSON.stringify({error:e instanceof Error?e.message:"Error"}));}
}).listen(Number(process.env.PORT||43879),"0.0.0.0");
server.on("error",error=>{console.error(error);process.exit(1);});
setInterval(async()=>{try{const r=await readRoom();if(doudizhuNeedsTick(r,Date.now()))await mutate(r=>tickDoudizhu(r,Date.now()));}catch{}},1000);

}
void main().catch(error=>{console.error(error);process.exit(1);});
