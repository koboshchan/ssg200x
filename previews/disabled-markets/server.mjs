import {createServer} from "node:http";import {readFileSync} from "node:fs";import {randomBytes} from "node:crypto";
import {FEATURE_DEFAULTS} from "../../runtime/feature-catalog.mjs";
const sessions=new Map();const f=n=>readFileSync(new URL(n,import.meta.url));
const page='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Disabled markets demo</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/client.css"><div id="root"></div><script src="/client.js"></script>';
createServer(async(req,res)=>{res.setHeader("Cache-Control","no-store");
 const shared=process.env.SHARED_FLAGS==="1";const m=shared?null:/(?:^|; )dm=([a-f0-9]{32})/.exec(req.headers.cookie||"");let sid=shared?"shared":m?.[1];
 if(!sid&&!shared){sid=randomBytes(16).toString("hex");res.setHeader("Set-Cookie","dm="+sid+"; Path=/; SameSite=Lax");}
 if(!sessions.has(sid)){if(sessions.size>200)sessions.delete(sessions.keys().next().value);sessions.set(sid,{...FEATURE_DEFAULTS});}
 const flags=sessions.get(sid);const u=req.url.split("?")[0];
 if(u==="/api/features"){if(process.env.FEATURES_DELAY_MS)await new Promise(r=>setTimeout(r,Number(process.env.FEATURES_DELAY_MS)));res.setHeader("Content-Type","application/json");return res.end(JSON.stringify({features:flags,revision:0}));}
 if(u==="/flags"&&req.method==="POST"){let b="";for await(const c of req){b+=c;if(b.length>512){res.statusCode=413;return res.end();}}const j=JSON.parse(b);for(const k of Object.keys(FEATURE_DEFAULTS))if(typeof j[k]==="boolean")flags[k]=j[k];res.setHeader("Content-Type","application/json");return res.end(JSON.stringify(flags));}
 if(u==="/client.js"){res.setHeader("Content-Type","text/javascript");return res.end(f("client.js"));}
 if(u==="/client.css"){res.setHeader("Content-Type","text/css");return res.end(f("client.css"));}
 if(u==="/style.css"){res.setHeader("Content-Type","text/css");return res.end(f("../../app/globals.css"));}
 if(u==="/commit"){return res.end(process.env.DEMO_COMMIT||"working-tree");}
 res.setHeader("Content-Type","text/html");res.end(page);
}).listen(Number(process.env.PORT),"0.0.0.0");
