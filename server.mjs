import {assertIsolatedQa} from "./runtime/isolated-qa.mjs";
assertIsolatedQa();
import {broadcastFeatureState} from "./runtime/feature-broadcast.mjs";
import {getFeatureSettings} from "./runtime/feature-settings.mjs";
import {attachFeatureSocket} from "./runtime/feature-sockets.mjs";
import {normalizeCommit,serveCommit} from "./runtime/git-commit.mjs";
import {createPolymarketPublic} from "./runtime/polymarket-public.mjs";
const polyPublic=createPolymarketPublic();
import {createPolymarketHistory,authorizePolymarketHistory,polymarketFinancialPins} from "./runtime/polymarket-history.mjs";
import {createPolymarketStream,attachPolymarketPresence} from "./runtime/polymarket-stream.mjs";
import {createPokerTaunts} from "./runtime/poker-taunts.mjs";
import {serveRelease,attachReleaseHandshake} from "./runtime/release.mjs";
import {attachMarketFeatureSubscriptions} from "./runtime/market-feature-subscriptions.mjs";
import {attachSocketAuth} from "./runtime/socket-auth.mjs";
import {createTabLeases} from "./runtime/tab-leases.mjs";
import {clerkReads} from "./runtime/clerk-reads.mjs";
import {loadClerkProfiles,profileName} from "./runtime/clerk-names.mjs";
import {timingSafeEqual} from "node:crypto";
import {createAirdropBroadcaster} from "./runtime/airdrop-events.mjs";
import {emitState,STATE_STREAMS} from "./runtime/state-stream.mjs";
import {sessionGuard} from "./runtime/chat-session.mjs";
import {createDmService} from "./runtime/dm-service.mjs";
import {createChatDmGate} from "./runtime/chat-dm-gate.mjs";
import {createPokerChatService} from "./runtime/poker-chat-service.mjs";
import {CHAT_MAX_PAYLOAD} from "./runtime/chat-protocol.mjs";
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import next from "next";
import {Server} from "socket.io";
import {createClerkClient,verifyToken} from "@clerk/backend";
import {MongoClient} from "mongodb";
import {randomBytes} from "node:crypto";
import {emitChartState} from "./runtime/chart-stream.mjs";
import {emitRoomState} from "./runtime/room-state.mjs";
import {verifiedSocketIdentity} from "./runtime/socket-identity.mjs";
// Assigned before Next prepares its route workers. Never accept an externally set secret.
process.env.INTERNAL_LIVE_SECRET=randomBytes(32).toString("hex");
const port=Number(process.env.PORT||3000),hostname=process.env.HOSTNAME||"0.0.0.0";
const dev=process.argv.includes("--dev");
const release=dev?"development":readFileSync(new URL("./.next/BUILD_ID",import.meta.url),"utf8").trim();
const config=dev?undefined:JSON.parse(readFileSync(new URL("./.next/required-server-files.json",import.meta.url))).config;
// Read the baked artifact, never mutable runtime environment or a git checkout.
let serverCommit="unknown";
try{serverCommit=normalizeCommit(readFileSync(new URL("./.next/GIT_COMMIT",import.meta.url),"utf8"));}catch{}
const client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});await client.connect();
const collection=client.db(process.env.MONGODB_DB||"pokerroom").collection("rooms");
const featureSettings=getFeatureSettings(client.db(process.env.MONGODB_DB||"pokerroom").collection("featureFlags"),{onError:()=>console.warn("Feature settings refresh deferred")});
await featureSettings.ready;
const tabLeases=createTabLeases({singleTabEnabled:()=>featureSettings.enabled("singleTab")});
featureSettings.subscribe(()=>tabLeases.publishAll());
const tabSweep=setInterval(()=>tabLeases.sweepAll(),500);tabSweep.unref();
const app=next({dev,hostname,port,conf:config,webpack:true});
await app.prepare();
const nextHandler=app.getRequestHandler();
const server=createServer(async(request,response)=>{
 if(serveCommit(request,response,serverCommit))return;
 if(serveRelease(request,response,release))return;
 if(!["/internal-airdrop","/internal-tab-check","/internal-chat-reset","/internal-polymarket"].includes(request.url)){nextHandler(request,response);return;}
 response.setHeader("Cache-Control","no-store");
 const supplied=request.headers["x-internal-live-secret"],secret=process.env.INTERNAL_LIVE_SECRET;
 const a=Buffer.from(typeof supplied==="string"?supplied:""),b=Buffer.from(secret);
 if(request.method!=="POST"||a.length!==b.length||!timingSafeEqual(a,b)){response.writeHead(401).end();return;}
 let body="";
 try{
  for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>8192||request.url!=="/internal-polymarket"&&Buffer.byteLength(body)>1024){response.writeHead(413).end();return;}}
  if(request.url==="/internal-polymarket"){
   if(process.env.SSG_ISOLATED_QA==="1"){response.writeHead(503,{"Content-Type":"application/json"}).end('{"error":"External prediction feeds disabled in isolated QA."}');return;}
   const {tokenId,sync,history,publicData}=JSON.parse(body);
   if(publicData){
    // Resolution polling must remain available for settlement of existing positions.
    if(!featureSettings.enabled("polymarket")&&!/^https:\/\/gamma-api\.polymarket\.com\/markets\/\d{1,24}$/.test(publicData.path)){response.writeHead(503,{"Content-Type":"application/json"}).end('{"error":"feature_disabled"}');return;}
    try{const result=await polyPublic.get(publicData.path,publicData.ttl,publicData.fresh===true);response.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify(result));}
    catch{response.writeHead(503,{"Content-Type":"application/json"}).end('{"error":"Prediction data unavailable."}');}return;
   }
   if(history){
    if(!featureSettings.enabled("polymarket")){response.writeHead(503,{"Content-Type":"application/json"}).end('{"error":"feature_disabled"}');return;}
    try{const result=await polyHistory.read(history.marketId,history.range,history);response.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify(result));}
    catch(error){response.writeHead(error.status||503,{"Content-Type":"application/json"}).end(JSON.stringify({error:error.status===403?error.message:'Price history unavailable.'}));}return;
   }
   if(sync===true){await syncPolyPositions();response.writeHead(200,{"Content-Type":"application/json"}).end('{"ok":true}');return;}
   if(typeof tokenId!=="string"||!/^\d{1,80}$/.test(tokenId)){response.writeHead(400).end();return;}
   const book=polyStream.read(tokenId);
   response.writeHead(book?200:409,{"Content-Type":"application/json"}).end(JSON.stringify(book??{error:"Waiting for fresh live stream price."}));return;
  }
  if(request.url==="/internal-chat-reset"){
   const {actor,payload}=JSON.parse(body);
   try{const result=await chatDmGate.adminReset(actor,payload);hintChatChanged();response.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify(result));}
   catch(e){response.writeHead(e.chatCode==='forbidden'?403:e.chatCode==='rate_limited'?429:409,{"Content-Type":"application/json"}).end(JSON.stringify({error:e.chatCode||'unavailable'}));}
   return;
  }
  if(request.url==="/internal-tab-check"){
   const {userId,tabId,tabProof,game}=JSON.parse(body);
   const error=typeof userId!=="string"?"Invalid user":tabLeases.check(userId,tabId,tabProof,game);
   response.writeHead(error?409:200,{"Content-Type":"application/json"}).end(JSON.stringify({error}));return;
  }
  const {id}=JSON.parse(body);
  if(typeof id!=="string"||!/^[a-f0-9]{64}$/.test(id)){response.writeHead(400).end();return;}
  await announceAirdrop(id);response.writeHead(204).end();
 }catch{response.writeHead(503).end();}
});
const io=new Server(server,{cors:{origin:process.env.APP_ORIGIN,credentials:true},maxHttpBufferSize:CHAT_MAX_PAYLOAD,transports:["websocket"],pingInterval:25000,pingTimeout:20000});
attachReleaseHandshake(io,release);
// Runtime-only Clerk keys; the legacy NEXT_PUBLIC name is accepted from the container environment only.
const clerkPublishableKey=(process.env.CLERK_PUBLISHABLE_KEY||process.env["NEXT_PUBLIC_"+"CLERK_PUBLISHABLE_KEY"]||"").trim()||undefined;
const clerkSecretKey=(process.env.CLERK_SECRET_KEY||"").trim()||undefined;
// Same process singleton as the Next API/proxy modules, including read cooldowns.
const clerk=globalThis.__ssgClerkBackend??=createClerkClient({secretKey:clerkSecretKey,publishableKey:clerkPublishableKey});
io.use(async(socket,next)=>{
 try{
 if(socket.handshake.headers.origin!==process.env.APP_ORIGIN)throw new Error();
 const token=socket.handshake.auth?.token;if(typeof token!=="string"||token.length>10000)throw new Error();
 const claims=await verifyToken(token,{secretKey:clerkSecretKey,authorizedParties:[process.env.APP_ORIGIN]});
 const user=await clerkReads(clerk).user(clerk,claims.sub);
 const identity=verifiedSocketIdentity(user,claims.sub);if(!identity||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())throw new Error();
 socket.data.sessionId=claims.sid;socket.data.identity=identity;socket.data.expires=claims.exp*1000;next();
 }catch{next(new Error("Sign in with Google."));}
});

// Demand and durable-position pins belong to this process, never route workers or browsers.
const polyDirty=new Set();
const polyStream=createPolymarketStream({enabled:()=>process.env.SSG_ISOLATED_QA!=="1"&&featureSettings.enabled("polymarket"),onChange:id=>polyDirty.add(id)});
featureSettings.subscribe(()=>{polyStream.syncEnabled();broadcastFeatureState(io,featureSettings);});
const polyMetadata=new Map();
async function resolvePolyMarket(id){
 if(process.env.SSG_ISOLATED_QA==="1")throw new Error("External prediction feeds disabled in isolated QA.");
 let old=polyMetadata.get(id);if(old?.until>Date.now())return old.value;if(old?.pending)return old.pending;
 if([...polyMetadata.values()].filter(x=>x.pending).length>=32)throw new Error('Busy');
 if(polyMetadata.size>=512)for(const [key,value]of polyMetadata)if(!value.pending){polyMetadata.delete(key);break;}
 const slot={until:0};polyMetadata.set(id,slot);
 slot.pending=(async()=>{
  const market=await polyPublic.get('https://gamma-api.polymarket.com/markets/'+id,3000);if(String(market.id)!==id)throw new Error('Identity mismatch');
  const value={tokens:typeof (market.version==='v2'?market.positionIds:market.clobTokenIds)==='string'?JSON.parse(market.version==='v2'?market.positionIds:market.clobTokenIds):(market.version==='v2'?market.positionIds:market.clobTokenIds)};
  const labels=typeof market.outcomes==='string'?JSON.parse(market.outcomes):market.outcomes;
  const yes=Array.isArray(labels)?labels.findIndex(label=>/^yes$/i.test(label)):-1;
  value.historyToken=value.tokens?.[yes<0?0:yes];
  slot.value=value;slot.until=Date.now()+60000;return value;
 })();try{return await slot.pending;}finally{slot.pending=null;}
}
let polyOwners=new Map(),polySyncBusy=false;
async function syncPolyPositions(){
 if(process.env.SSG_ISOLATED_QA==="1")return;
 const r=await collection.findOne({_id:'main'},{projection:{'polymarket.positions':1,'polymarket.orders':1}}),positions=polymarketFinancialPins(r?.polymarket);
 polyStream.syncPositions(positions);polyOwners=new Map();for(const p of positions){let ids=polyOwners.get(p.marketId);if(!ids){ids=new Set();polyOwners.set(p.marketId,ids);}ids.add(p.userId);}
}
await syncPolyPositions();
const polyHistory=createPolymarketHistory({
 collection:client.db(process.env.MONGODB_DB||"pokerroom").collection('polymarket_history'),
 authorize:(marketId,demand)=>authorizePolymarketHistory({marketId,demand,collection,sockets:()=>io.sockets.sockets.values(),checkTab:tabLeases.check,checkSession:socket=>checkChatSession(socket)}),
 canPersist:async id=>{
  // Recheck durable state immediately before each realtime write. Cached owners may lag a close.
  if(!polyOwners.has(id))return false;
  const r=await collection.findOne({_id:'main'},{projection:{'polymarket.positions':1,'polymarket.orders':1}});
  return polymarketFinancialPins(r?.polymarket).some(p=>p.marketId===id);
 },
 resolveToken:async id=>(await resolvePolyMarket(id)).historyToken,
 fetchHistory:async tokenId=>(await polyPublic.get('https://clob.polymarket.com/prices-history?'+new URLSearchParams({market:tokenId,interval:'max',fidelity:'720'}),60000)).history
});
const polySyncTimer=setInterval(async()=>{if(polySyncBusy)return;polySyncBusy=true;try{await syncPolyPositions();}catch{console.warn('Prediction pins refresh deferred');}finally{polySyncBusy=false;}},2000);polySyncTimer.unref();
const polyStreamTimer=setInterval(()=>{
 polyStream.sweep();
 for(const id of polyDirty){
  if(polyOwners.has(id))for(const book of polyStream.status(id).books)void polyHistory.append(id,book.asset_id,book).catch(()=>console.warn('Prediction tick persistence deferred'));
  const update=polyStream.status(id);update.books=update.books.map(book=>({...book,bids:book.bids.slice(0,12),asks:book.asks.slice(0,12)}));for(const socket of io.sockets.sockets.values()){
  if(!socket.connected||socket.data.expires<=Date.now())continue;
  if(featureSettings.enabled("polymarket")&&socket.data.polyMarketId===id)socket.emit('polymarket:price',update);
  if(featureSettings.enabled("polymarket")&&polyOwners.get(id)?.has(socket.data.identity.id))socket.emit('polymarket:positions',{marketId:id});
 }}polyDirty.clear();
},500);polyStreamTimer.unref();
const chat=createPokerChatService(client.db(process.env.MONGODB_DB||"pokerroom"),{clerk,canSend:()=>featureSettings.enabled("chat")&&featureSettings.enabled("tableTalk")});
const dm=createDmService(client.db(process.env.MONGODB_DB||"pokerroom"),{clerk,canSend:()=>featureSettings.enabled("chat")&&featureSettings.enabled("dms")});
await Promise.all([chat.ready,dm.ready]);
const chatDmGate=createChatDmGate(chat,dm);
const announceAirdrop=createAirdropBroadcaster(io,client.db(process.env.MONGODB_DB||"pokerroom").collection("airdrop_receipts"));
const checkChatSession=sessionGuard(clerk,{reads:clerkReads(clerk)});
const attachPokerTaunts=createPokerTaunts({enabled:()=>featureSettings.enabled("poker")&&featureSettings.enabled("tableTalk"),collection,auditCollection:client.db(process.env.MONGODB_DB||"pokerroom").collection("audit"),io,checkSession:checkChatSession,checkTab:tabLeases.check});
let hintTimer;
function hintChatChanged(){if(hintTimer)return;hintTimer=setTimeout(()=>{hintTimer=null;io.emit("chat:changed",{v:1});},100);hintTimer.unref();}
async function pushState(socket,force=false,profiles){
 if(!socket.connected||socket.data.busy)return;
 if(socket.data.expires<=Date.now()){socket.disconnect(true);return;}
 socket.data.busy=true;
 try{
  await checkChatSession(socket);
  if(!profiles){
   const room=await collection.findOne({_id:"main"},{projection:{"members.id":1}});
   profiles=await loadClerkProfiles(clerk,[socket.data.identity.id,...(room?.members||[]).map(m=>m.id),...(socket.data.chatNameIds||[])]);
  }
  socket.data.identity.name=profileName(profiles,socket.data.identity.id);
  const snapshotAdmin=socket.data.identity.admin,snapshotTable=socket.data.pokerTableId||"01";
  const response=await fetch(`http://127.0.0.1:${port}/api/internal-live`,{
   method:"POST",headers:{"content-type":"application/json","x-internal-live-secret":process.env.INTERNAL_LIVE_SECRET,...(socket.data.chart?{"x-chart-symbol":socket.data.chart.symbol,"x-chart-granularity":socket.data.chart.granularity}:{})},
   body:JSON.stringify({pokerTableId:socket.data.pokerTableId||"01",identity:socket.data.identity,profiles:[...profiles].map(([id,p])=>[id,{name:p.name,avatar:p.avatar??null}])}),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw new Error("Live snapshot unavailable");
  const data=await response.json();
  await checkChatSession(socket);
  if(snapshotAdmin!==socket.data.identity.admin||snapshotTable!==(socket.data.pokerTableId||"01"))return;
  if(!socket.connected||socket.data.expires<=Date.now())return;
  if(data.room?.marketSymbols)socket.data.marketSubscriptions?.updateSymbols(data.room.marketSymbols);
  socket.data.marketSubscriptions?.sync();
  if(data.room)data.room=socket.data.marketSubscriptions.project(data.room);
  force=force||socket.data.forceFull===true;socket.data.forceFull=false;
  for(const [key,event] of [["maintenance","maintenance:state"]]){
   emitState(socket,event,data[key],force);
  }
  emitRoomState(socket,data,force);
  emitChartState(socket,data,force);
  socket.data.initialized=true;
 }catch(error){if(error.message==="session"){socket.disconnect(true);return;}socket.emit("live:error",{error:"Live state unavailable. Retrying."});}
 finally{socket.data.busy=false;}
}
io.on("connection",socket=>{
 try{tabLeases.attach(socket.data.identity.id,socket,socket.handshake.auth);}catch(error){socket.emit("live:error",{error:error.message});socket.disconnect(true);return;}
 attachFeatureSocket(socket,featureSettings);
 socket.emit("features:state",featureSettings.snapshot());
 attachPokerTaunts(socket);
 socket.data.marketRoute=socket.handshake.auth?.route;
 socket.data.marketSubscriptions=attachMarketFeatureSubscriptions(socket,{settings:featureSettings});
 attachPolymarketPresence(socket,{settings:featureSettings,stream:{...polyStream,setViewer(viewer,id,tokens){polyStream.setViewer(viewer,id,tokens);socket.data.polyMarketId=id;}},resolveMarket:resolvePolyMarket,checkSession:checkChatSession});
 socket.on("state:resync",event=>{
  if(!STATE_STREAMS.includes(event)||Date.now()<(socket.data.resyncAt||0))return;
  socket.data.resyncAt=Date.now()+1000;socket.data.forceFull=true;socket.data.statusAt=0;
 });
 socket.data.pokerTableId=["01","02","03"].includes(socket.handshake.auth?.pokerTableId)?socket.handshake.auth.pokerTableId:"01";
 socket.on("poker:subscribe",id=>{
  if(!["01","02","03"].includes(id))return;
  socket.data.pokerTableId=id;socket.data.forceFull=true;socket.data.initialized=false;socket.data.statusAt=0;
 });
 socket.data.marketRoute=socket.handshake.auth?.route;
 for(const event of ["register","state","claim","wrap","send","history","keys:get","keys:put"]){
  socket.on("chat:"+event,async(payload,ack)=>{
   if(typeof ack!=="function")return;
   if((socket.data.chatPending||0)>=4){ack({ok:false,error:"busy"});return;}
   socket.data.chatPending=(socket.data.chatPending||0)+1;
   try{
    await checkChatSession(socket);
    if(!socket.connected||socket.data.expires<=Date.now()){socket.disconnect(true);return;}
    if(event==="send"&&(!featureSettings.enabled("chat")||!featureSettings.enabled("tableTalk"))){ack({ok:false,error:"feature_disabled",feature:"chat"});return;}
    const result=await chat.handle(socket.data.identity.id,event,payload);
    if(socket.data.expires<=Date.now()){socket.disconnect(true);return;}
    // Include current names for historical senders as well as seated members.
    // Bounded per socket and refreshed by the next live snapshot, not cached names.
    const senders=[...(result.messages||[]).map(m=>m.senderUserId),...(result.message?[result.message.senderUserId]:[])];
    if(senders.length)socket.data.chatNameIds=[...new Set([...(socket.data.chatNameIds||[]),...senders])].slice(-500);
    ack({ok:true,...result});
    if((["register","keys:put","claim","wrap","send"].includes(event)||result.directoryChanged===true)){
     // Generic coalesced hints contain no membership, ciphertext or wrapped keys.
     hintChatChanged();
    }
   }catch(error){ack({ok:false,error:error.chatCode||"unavailable"});if(error.chatCode==="forbidden"||error.message==="session")socket.disconnect(true);}finally{socket.data.chatPending--;}
  });
 }
 // DM hints are emitted only to participant sockets, never to the global namespace.
 for(const event of ["profile","lookup","threads","history","send","block","unread","read"]){
  socket.on("dm:"+event,async(payload,ack)=>{
   if(typeof ack!=="function")return;
   if((socket.data.dmPending||0)>=4){ack({ok:false,error:"busy"});return;}
   socket.data.dmPending=(socket.data.dmPending||0)+1;
   try{
    await checkChatSession(socket);
    if(!socket.connected||socket.data.expires<=Date.now()){socket.disconnect(true);return;}
    const user=socket.data.identity.id;
    if(event==="send"&&(!featureSettings.enabled("chat")||!featureSettings.enabled("dms"))){ack({ok:false,error:"feature_disabled",feature:"dms"});return;}
    const result=await chatDmGate.handle(user,event,payload);
    await checkChatSession(socket);
    if(!socket.connected||socket.data.expires<=Date.now())return;
    ack({ok:true,...result});
    if(event==="read"||event==="block"||(event==="send"&&!result.duplicate)){
     const peer=event==="send"?result.message.toUserId:payload.userId;
     for(const target of io.sockets.sockets.values()){
      if(target.connected&&target.data.expires>Date.now()&&(event==="read"?[user]:[user,peer]).includes(target.data.identity.id))target.emit("dm:changed");
     }
    }
   }catch(error){
    ack({ok:false,error:error.chatCode||"unavailable"});
    if(error.chatCode==="forbidden"||error.message==="session")socket.disconnect(true);
   }finally{socket.data.dmPending--;}
  });
 }
 attachSocketAuth(socket,{verify:token=>verifyToken(token,{secretKey:clerkSecretKey,authorizedParties:[process.env.APP_ORIGIN]}),checkSession:checkChatSession});
 void pushState(socket,true);
});
let running=false;
const timer=setInterval(async()=>{
 if(running||!io.engine.clientsCount)return;running=true;
 try{
  const r=await collection.findOne({_id:"main"},{projection:{version:1,"members.id":1}});
  const sockets=[...io.sockets.sockets.values()];
  const due=sockets.filter(socket=>!socket.data.initialized||socket.data.version!==r?.version||Date.now()-(socket.data.statusAt||0)>=1000);
  // Cross-cycle five-second cache, in-flight dedup and bounded SDK batches.
  // This cycle receives only its requested presentation fields.
  const memberIds=(r?.members||[]).map(m=>m.id);
  const profiles=due.length?await loadClerkProfiles(clerk,[...memberIds,...due.map(s=>s.data.identity.id),...due.flatMap(s=>s.data.chatNameIds||[])]):new Map();
  const now=Date.now();
  await Promise.all(due.map(socket=>{
   // Manual maintenance can change without the room version changing.
   if(!socket.data.initialized||socket.data.version!==r?.version||now-(socket.data.statusAt||0)>=1000){
    socket.data.statusAt=now;const allowed=new Set([socket.data.identity.id,...memberIds,...(socket.data.chatNameIds||[])]);
    return pushState(socket,!socket.data.initialized,new Map([...profiles].filter(([id])=>allowed.has(id))));
   }
  }));
 }catch{}finally{running=false;}
},200);timer.unref();
server.listen(port,hostname);
async function stop(){featureSettings.stop();clearInterval(polySyncTimer);clearInterval(polyStreamTimer);polyStream.stop();clearInterval(tabSweep);clearInterval(timer);await io.close();await client.close();server.close();process.exit(0);}
process.once("SIGTERM",stop);process.once("SIGINT",stop);
