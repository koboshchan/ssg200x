import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {mutate} from "../../lib/store";
import {readRoom} from "../../lib/db";
import {register,applyAction,assertRoom} from "../../lib/poker";
import {publicRoom} from "../../lib/public";
import {adminCasinoSnapshot,changeCasinoLimits} from "../../lib/admin-casino-limits";
import {actionSchema} from "../../lib/schemas";
if(!process.env.MONGODB_DB?.startsWith("fakebucks_test_"))throw Error("Isolated DB required");
const who={id:"poker-limit-demo",name:"Demo player",email:"demo@example.test",admin:true};
async function start(){
await mutate(room=>{const exists=room.members.some(m=>m.id===who.id);const member=register(room,who);if(!exists){member.wallet+=900000;room.issuance=(room.issuance??0)+900000;}});
createServer(async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 try{
  const path=req.url;
  const capture=path==="/desktop.png"?"desktop-or-mobile-1440.png":path==="/mobile.png"?"desktop-or-mobile-390.png":null;
  if(capture){res.setHeader("Content-Type","image/png");return res.end(readFileSync("/home/kit/poker-max-evidence/"+capture));}
  if(path==="/client.js"){res.setHeader("Content-Type","text/javascript");return res.end(readFileSync("/home/kit/poker-max-demo/client.js"));}
  if(path==="/style.css"){res.setHeader("Content-Type","text/css");return res.end(readFileSync("app/globals.css"));}
  if(path==="/api/room"||path==="/api/admin/casino-limits"||path==="/api/action"){
   res.setHeader("Content-Type","application/json");
   if(req.method==="POST"){
    let body="";for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error("Too large");}const input=JSON.parse(body);
    await mutate(room=>{if(path==="/api/admin/casino-limits")changeCasinoLimits(room,who,input);else if(path==="/api/action")applyAction(room,who,actionSchema.parse(input),Date.now());else throw Error("Unsupported");assertRoom(room);});
   }
   const room=await readRoom();return res.end(JSON.stringify(path==="/api/admin/casino-limits"?adminCasinoSnapshot(room,who):publicRoom(room,who)));
  }
  if(path!=="/"){res.statusCode=404;return res.end();}
  res.setHeader("Content-Type","text/html");res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Poker max buy-in demo</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/client.js"></script></body></html>');
 }catch(error){res.statusCode=400;res.setHeader("Content-Type","application/json");res.end(JSON.stringify({error:error instanceof Error?error.message:"Failed"}));}
}).listen(45691,"0.0.0.0");

}
void start().catch(e=>{console.error(e);process.exit(1);});
