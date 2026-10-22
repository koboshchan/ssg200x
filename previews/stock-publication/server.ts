import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import {freshRoom,register} from "../../lib/poker";
import {publicRoom} from "../../lib/public";
import {openPosition,closePosition} from "../../lib/finance";
import {adjustPerp} from "../../lib/perps-adjust";
import {financeSchema} from "../../lib/finance-input";
import {applyStockPublication} from "../../lib/stock-publication";
import type {StockExecutionState} from "../../lib/stock-policy";
const who={id:"stock-demo",name:"Stock demo",email:"demo@example.test",admin:true};
let room=freshRoom(),mode="healthy";
function state():StockExecutionState{
 const now=Date.now(),quote=room.quotes!.TSLA!;
 return {symbol:"TSLA",authorized:true,leader:true,connected:mode!=="disconnected",leaseUntil:mode==="lease"?now-1000:now+14000,
 tick:{symbol:"TSLA",price:quote.micro/1e6,timestamp:quote.at,receivedAt:quote.at,feed:"alpaca-iex"},
 clock:{isOpen:true,timestamp:now,receivedAt:now,nextOpen:now+86400000,nextClose:now+3600000},
 sessions:[{date:new Date(now).toISOString().slice(0,10),open:now-3600000,close:now+3600000}]};
}
function sync(){
 const now=Date.now();
 room.quotes!.TSLA!.at=mode==="stale"?now-61000:now;
 const current=state();room.stockExecution={TSLA:current};
 applyStockPublication(room,()=>({TSLA:current}),[],now);
}
function reset(){
 mode="healthy";room=freshRoom();register(room,who);room.quotes={TSLA:{micro:250000000,at:Date.now()}};sync();
 openPosition(room,who,"TSLA","long",10000,5,"demo-stock-position");sync();
}reset();
createServer(async(req,res)=>{
 res.setHeader("Cache-Control","no-store");
 if(req.url==="/commit"){res.setHeader("Content-Type","text/plain");return res.end(process.env.DEMO_COMMIT);}
 if(req.url==="/client.js"||req.url==="/client.css"||req.url==="/style.css"){
  res.setHeader("Content-Type",req.url.endsWith(".js")?"text/javascript":"text/css");
  return res.end(readFileSync(new URL(req.url==="/style.css"?"../../app/globals.css":"."+req.url,import.meta.url)));
 }
 if(req.url==="/room"){sync();res.setHeader("Content-Type","application/json");return res.end(JSON.stringify(publicRoom(room,who)));}
 if(req.method==="POST"){
  res.setHeader("Content-Type","application/json");
  try{
   let raw="";for await(const part of req){raw+=part;if(raw.length>4096)throw Error("Too large");}
   const body=JSON.parse(raw||"{}");
   if(req.url==="/demo-mode"){
    if(!["healthy","disconnected","lease","stale","reset"].includes(body.mode))throw Error("Invalid mode");
    if(body.mode==="reset")reset();else mode=body.mode;
   }else if(req.url==="/api/finance"){
    sync();const input=financeSchema.parse(body),next=structuredClone(room);
    if(input.type==="close")closePosition(next,who,input.positionId);
    else if(input.type==="increase"||input.type==="partial-close")adjustPerp(next,who,input);
    else throw Error("Only fixture position actions supported");room=next;
   }else throw Error("Unknown route");
   sync();return res.end(JSON.stringify(publicRoom(room,who)));
  }catch(e){res.statusCode=400;return res.end(JSON.stringify({error:e instanceof Error?e.message:String(e)}));}
 }
 if(req.url!=="/"){res.statusCode=404;return res.end();}
 res.setHeader("Content-Type","text/html");
 res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/client.css"></head><body><div id="root"></div><script src="/client.js"></script></body></html>');
}).listen(Number(process.env.PORT||47381),"0.0.0.0");
