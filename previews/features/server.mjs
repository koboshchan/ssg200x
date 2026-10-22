import {createServer} from "node:http";import {readFileSync} from "node:fs";
import {FEATURE_DEFAULTS} from "../../runtime/feature-catalog.mjs";
const fresh=()=>({features:{...FEATURE_DEFAULTS},fx:{pairs:["EUR/USD","USD/JPY"],version:1},crypto:["BTC","ETH"],stocks:["AAPL","MSFT"],cv:1,rev:1,puts:0});
let S=fresh();
const snap=()=>({marketSymbols:{crypto:S.crypto,stocks:S.stocks,forex:S.fx.pairs,delisted:[]},affected:Object.fromEntries([...S.crypto,...S.stocks,...S.fx.pairs].map(s=>[s,{holdings:2,positions:1,accounts:2}])),version:S.fx.version+S.cv});
const json=(r,c,b)=>{r.statusCode=c;r.setHeader("Content-Type","application/json");r.end(JSON.stringify(b));};
const body=async q=>{let b="";for await(const c of q){b+=c;if(b.length>8192)throw Error("Too large");}return JSON.parse(b||"{}");};
createServer(async(q,r)=>{r.setHeader("Cache-Control","no-store");const u=q.url.split("?")[0];
 try{
 if(u==="/client.js"){r.setHeader("Content-Type","text/javascript");return r.end(readFileSync(new URL("./client.js",import.meta.url)));}
 if(u==="/style.css"){r.setHeader("Content-Type","text/css");return r.end(readFileSync(new URL("../../app/globals.css",import.meta.url)));}
 if(u==="/reset"){S=fresh();return json(r,200,{ok:true});}
 if(u==="/api/release")return json(r,200,{release:"development"});
 if(u==="/external"){S.features.polymarket=!S.features.polymarket;S.rev++;return json(r,200,{revision:S.rev});}
 if(u==="/fprobe")return json(r,200,{features:S.features,revision:S.rev,puts:S.puts});
 if(u==="/api/features"&&q.method==="GET")return json(r,200,{features:S.features,revision:S.rev});
 if(u==="/api/admin/features"&&q.method==="PUT"){const i=await body(q);for(const [k,v] of Object.entries(i.features||{}))if(!(k in FEATURE_DEFAULTS)||typeof v!=="boolean")throw Error("Bad feature");if(i.expectedRevision!==S.rev)return json(r,409,{error:"Features were changed by someone else. Review your edits and apply again.",features:S.features,revision:S.rev});S.puts++;Object.assign(S.features,i.features);S.rev++;return json(r,200,{features:S.features,revision:S.rev});}
 if(u==="/api/admin/symbols"&&q.method==="GET")return json(r,200,snap());
 if(u==="/api/admin/symbols"&&q.method==="POST"){const i=await body(q);if(i.kind==="forex")throw Error("Forex is edited as one list");const L=S[i.kind];if(!L)throw Error("Bad kind");if(i.action==="add"){if(!L.includes(i.symbol))L.push(i.symbol);}else S[i.kind]=L.filter(x=>x!==i.symbol);S.cv++;return json(r,200,snap());}
 if(u==="/api/admin/forex"&&q.method==="GET")return json(r,200,{mode:"mock",marketOpen:true,message:"Mock feed.",stream:"streaming"});
 if(u==="/api/admin/forex"&&q.method==="PUT"){const i=await body(q);S.fxPuts=(S.fxPuts||0)+1;if(i.confirmed!==true)throw Error("Confirmation required");if(i.expectedVersion!==S.fx.version+S.cv)return json(r,409,{error:"Symbols changed elsewhere."});if(!Array.isArray(i.pairs)||i.pairs.length>8||i.pairs.some(p=>!/^[A-Z]{3}\/[A-Z]{3}$/.test(p)))throw Error("Invalid pairs");S.fx.pairs=i.pairs;S.fx.version++;return json(r,200,snap());}
 if(u==="/puts")return json(r,200,{puts:S.fxPuts||0});
 if(u!=="/"){r.statusCode=404;return r.end();}
 r.setHeader("Content-Type","text/html");r.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated feature demo</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/client.js"></script></body></html>');
 }catch(e){json(r,400,{error:String(e.message||e)});}
}).listen(Number(process.env.PORT||0),"0.0.0.0",function(){console.log("PORT",this.address().port);});
