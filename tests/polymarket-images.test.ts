import {test} from "node:test";
import assert from "node:assert/strict";
import {allowedPolyImage,polyImagePath,fetchPolyImage} from "../lib/polymarket-images";
test("image proxy rejects SSRF, credentials, non-image hosts and query passthrough",()=>{
 for(const x of ["http://images.polymarket.com/x","https://127.0.0.1/x","https://images.polymarket.com.evil.test/x","https://images.polymarket.com:444/x","https://u@images.polymarket.com/x","https://images.polymarket.com/x?url=http://localhost","https://gamma-api.polymarket.com/events"])assert.equal(allowedPolyImage(x),null,x);
 assert(polyImagePath("https://polymarket-upload.s3.us-east-2.amazonaws.com/x.png")?.startsWith("/api/polymarket/image?url="));
});
test("image proxy validates MIME, byte signature, size and caches bounded bytes",async()=>{
 const old=global.fetch;let calls=0;
 try{
 global.fetch=async()=>{calls++;return new Response(Uint8Array.from([137,80,78,71,13,10,26,10]),{headers:{"content-type":"image/png"}});};
 const url="https://images.polymarket.com/test.png";
 assert.equal((await fetchPolyImage(url)).type,"image/png");
 await fetchPolyImage(url);assert.equal(calls,1);
 global.fetch=async()=>new Response("<svg/>",{headers:{"content-type":"image/svg+xml"}});
 await assert.rejects(fetchPolyImage("https://images.polymarket.com/a.svg"));
 global.fetch=async()=>new Response("<html/>",{headers:{"content-type":"image/png"}});
 await assert.rejects(fetchPolyImage("https://images.polymarket.com/b.png"));
 global.fetch=async()=>new Response("x",{headers:{"content-type":"image/png","content-length":"2097153"}});
 await assert.rejects(fetchPolyImage("https://images.polymarket.com/c.png"));
 }finally{global.fetch=old;}
});
import {liveCardMarkets} from "../lib/polymarket-card";
test("card previews exclude final markets and rank live yes probability",()=>{
 const make=(id:string,price:number,closed=false,resolved=false)=>({id,closed,resolved,outcomes:[{label:"No",price:1-price},{label:"Yes",price}]});
 const rows=[make("old",1,true),make("low",0.1),make("final",1,false,true),make("high",0.7)];
 assert.deepEqual(liveCardMarkets(rows).map(m=>m.id),["high","low"]);
 assert.equal(rows.length,4);
});
