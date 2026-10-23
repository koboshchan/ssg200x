// Diagnostic transport regression, NOT real Clerk DEV signed-in acceptance.
// Execute current production handler bodies in a dependency-injected VM. No
// copied guard, production source edits, real database, or upstream connection.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createContext,runInContext} from "node:vm";
import {createServer} from "node:http";
import {randomBytes,timingSafeEqual} from "node:crypto";
import {once} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import ts from "typescript";
import {Server} from "socket.io";
import {io as connect} from "socket.io-client";
import {attachPolymarketPresence,createPolymarketStream} from "../runtime/polymarket-stream.mjs";

const source=readFileSync(new URL("../server.mjs",import.meta.url),"utf8");
const ast=ts.createSourceFile("server.mjs",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function findOne(predicate:(n:ts.Node)=>boolean){
 const found:ts.Node[]=[];
 function visit(n:ts.Node){if(predicate(n))found.push(n);ts.forEachChild(n,visit);}visit(ast);
 assert.equal(found.length,1,"production AST anchor must be unique");return found[0];
}
const resolverSource=findOne(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="resolvePolyMarket").getText(ast);
const serverCall=findOne(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==="server") as ts.VariableDeclaration;
assert.ok(serverCall.initializer&&ts.isCallExpression(serverCall.initializer));
const httpSource=serverCall.initializer.arguments[0].getText(ast);
const presenceSource=findOne(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==="attachPolymarketPresence").getText(ast);
async function until(predicate:()=>boolean){for(let i=0;i<200;i++){if(predicate())return;await delay(5);}assert.fail("fixture condition timed out");}

for(const isolated of [true,false])test(`actual Socket.IO transport and production guards, isolated=${isolated} (fixture auth only)`,{timeout:12000},async t=>{
 const metadata:string[]=[],upstreamSockets:string[]=[];let checks=0,blocked=false,release:()=>void=()=>{};
 let gate=Promise.resolve();const callbacks=new Set<()=>void>();let enabled=true;
 const settings={enabled:()=>enabled,subscribe:(cb:()=>void)=>{callbacks.add(cb);return()=>callbacks.delete(cb);}};
 const refresh=(value:boolean)=>{enabled=value;for(const cb of callbacks)cb();};
 const fixtureToken=randomBytes(32).toString("hex"),internalSecret=randomBytes(32).toString("hex");
 const checkSession=async(socket:any)=>{
  checks++;if(blocked)await gate;
  assert.equal(socket.data.identity.id,"fixture_verified_user");
  assert.ok(socket.connected&&socket.data.expires>Date.now());
 };
 const stream=createPolymarketStream({
  enabled:()=>!isolated&&settings.enabled(),
  connect:(url:string)=>{upstreamSockets.push(url);throw Error("diagnostic upstream connection intercepted");}
 });
 const context=createContext({
  process:{env:{...(isolated?{SSG_ISOLATED_QA:"1"}:{}),INTERNAL_LIVE_SECRET:internalSecret}},
  Buffer,Date,JSON,Map,Error,timingSafeEqual,
  serveCommit:()=>false,serveRelease:()=>false,serverCommit:"fixture",release:"fixture",
  nextHandler:(_req:any,res:any)=>res.writeHead(404).end(),
  featureSettings:settings,polyStream:stream,attachPolymarketPresence,checkChatSession:checkSession,
  polyMetadata:new Map(),
  polyPublic:{get:async(url:string)=>{metadata.push(url);return {id:"123",clobTokenIds:["11","12"],outcomes:["Yes","No"]};}}
 });
 runInContext(resolverSource,context,{filename:"production-resolvePolyMarket"});
 runInContext("const productionResolver=resolvePolyMarket;var resolverAttempts=0;resolvePolyMarket=async id=>{resolverAttempts++;return productionResolver(id);};",context);
 const handler=runInContext("("+httpSource+")",context,{filename:"production-http-handler"});
 const http=createServer(handler),io=new Server(http,{serveClient:false});
 const clients:ReturnType<typeof connect>[]=[];
 t.after(async()=>{blocked=false;release();for(const c of clients)c.disconnect();stream.stop();await new Promise<void>(r=>io.close(()=>r()));});
 io.use((socket,next)=>{
  const supplied=Buffer.from(String(socket.handshake.auth?.token??"")),expected=Buffer.from(fixtureToken);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return next(Error("fixture unauthorized"));
  socket.data.identity={id:"fixture_verified_user"};socket.data.expires=Date.now()+60000;
  socket.data.marketRoute=socket.handshake.auth.route;next();
 });
 io.on("connection",socket=>{
  context.socket=socket;
  runInContext(presenceSource,context,{filename:"production-presence-wiring"});
 });
 http.listen(0,"127.0.0.1");await once(http,"listening");
 const address=http.address();assert.ok(address&&typeof address!=="string");
 const origin="http://127.0.0.1:"+address.port;
 const makeClient=(token:string)=>{const c=connect(origin,{transports:["websocket"],reconnection:false,auth:{token,route:"/polymarket"}});clients.push(c);return c;};
 const denied=makeClient("invalid");const [deniedError]=await once(denied,"connect_error");assert.match(deniedError.message,/unauthorized/);
 assert.equal(metadata.length,0);assert.equal(upstreamSockets.length,0);
 const client=makeClient(fixtureToken);await once(client,"connect");
 if(isolated){
  // Hold the first real watch in session validation while a flags refresh retries
  // the saved wish. Both select paths must still reach the production QA guard.
  blocked=true;gate=new Promise<void>(r=>{release=r;});
  client.emit("polymarket:watch","123");
  await until(()=>checks===1);refresh(false);refresh(true);await until(()=>checks===2);
  blocked=false;release();await until(()=>Number(context.resolverAttempts)===1);
  const answer:any=await client.timeout(1500).emitWithAck("polymarket:watch","123");
  assert.equal(answer.ok,false);assert.match(answer.error,/unavailable/);
  assert.ok(checks>=3,"session validation ran for refresh retry and explicit retry");
  assert.equal(context.resolverAttempts,2,"refresh selection and explicit retry executed the actual guarded resolver");
  refresh(false);refresh(true);await delay(20);
  assert.equal(metadata.length,0,"no Gamma metadata fetch on watch or feature refresh");
  assert.equal(upstreamSockets.length,0,"no upstream prediction WebSocket");
  for(const payload of [
   {publicData:{path:"https://gamma-api.polymarket.com/markets/123"}},
   {sync:true},{tokenId:"11"},
   {history:{marketId:"123",range:"all",userId:"fixture_verified_user"}}
  ]){
   const response=await fetch(origin+"/internal-polymarket",{method:"POST",headers:{"x-internal-live-secret":internalSecret,"content-type":"application/json"},body:JSON.stringify(payload)});
   assert.equal(response.status,503);assert.match((await response.json()).error,/disabled in isolated QA/);
  }
  const unauthorized=await fetch(origin+"/internal-polymarket",{method:"POST",body:"{}"});assert.equal(unauthorized.status,401);
  assert.equal(metadata.length,0);assert.equal(upstreamSockets.length,0);
 }else{
  const answer:any=await client.timeout(1500).emitWithAck("polymarket:watch","123");
  assert.equal(answer.ok,true);
  assert.deepEqual(metadata,["https://gamma-api.polymarket.com/markets/123"]);
  assert.equal(upstreamSockets.length,1,"production stream attempts its upstream socket");
  await client.timeout(1500).emitWithAck("polymarket:watch",null);
  const response=await fetch(origin+"/internal-polymarket",{method:"POST",headers:{"x-internal-live-secret":internalSecret,"content-type":"application/json"},body:JSON.stringify({publicData:{path:"https://gamma-api.polymarket.com/markets/123"}})});
  assert.equal(response.status,200);await response.json();assert.equal(metadata.length,2);
 }
 t.diagnostic(JSON.stringify({fixtureAuth:true,realClerkAcceptance:false,isolated,sessionChecks:checks,metadataCalls:metadata.length,upstreamSocketAttempts:upstreamSockets.length}));
});
