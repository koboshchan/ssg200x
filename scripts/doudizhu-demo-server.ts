import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {doudizhuRead,doudizhuMove} from "../lib/doudizhu-store";
import {mutate} from "../lib/store";
import {tickDoudizhu,doudizhuNeedsTick} from "../lib/doudizhu";
import {readRoom} from "../lib/db";
import {z} from "zod";
if(process.env.MONGODB_DB!=="fakebucks_demo_doudizhu")throw Error("Isolated demo DB required");
const users=["You","Mochi","Dango"].map((name,i)=>({id:"demo-dd-"+i,name,email:"demo"+i+"@invalid.test",admin:i===0}));
const stamp={requestId:z.string().uuid(),requestAt:z.number().int(),code:z.string().max(100).optional(),version:z.number().int().nonnegative().optional()};
const schema=z.discriminatedUnion("type",[
 z.object({...stamp,type:z.literal("double"),doubleMultiplier:z.union([z.literal(1),z.literal(2),z.literal(4)])}).strict(),
 z.object({...stamp,type:z.literal("reaction"),kind:z.enum(["emote","throw"]),value:z.string().max(20),target:z.number().int().min(0).max(2).optional(),targetId:z.string().regex(/^[a-f0-9]{16}$/).optional(),expectedPrice:z.number().int().nonnegative().optional()}).strict(),
 z.object({...stamp,type:z.literal("visibility"),isPublic:z.boolean(),version:z.number().int().nonnegative()}).strict(),
z.object({...stamp,type:z.literal("create"),isPublic:z.boolean().optional(),beansPerDollar:z.number().int().min(1).max(1e9).optional(),maxLoss:z.number().int().min(100).max(1e8).optional()}).strict(),
...(["join","ready","pass","leave"] as const).map(type=>z.object({...stamp,type:z.literal(type)}).strict()),
z.object({...stamp,type:z.literal("bid"),bid:z.number().int().min(0).max(3)}).strict(),
z.object({...stamp,type:z.literal("play"),cards:z.array(z.string().max(2)).min(1).max(20)}).strict()
]);
const root=resolve("demo-public");
createServer(async(req,res)=>{res.setHeader("Cache-Control","no-store");try{
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
}).listen(39761,"0.0.0.0");
setInterval(async()=>{try{const r=await readRoom();if(doudizhuNeedsTick(r,Date.now()))await mutate(r=>tickDoudizhu(r,Date.now()));}catch{}},1000);
