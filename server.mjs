import {sessionGuard} from "./runtime/chat-session.mjs";
import {createChatService} from "./runtime/chat-service.mjs";
import {CHAT_MAX_PAYLOAD} from "./runtime/chat-protocol.mjs";
import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import next from "next";
import {Server} from "socket.io";
import {createClerkClient,verifyToken} from "@clerk/backend";
import {MongoClient} from "mongodb";
import {randomBytes} from "node:crypto";
import {subscribeChart,emitChartState} from "./runtime/chart-stream.mjs";
import {emitRoomState} from "./runtime/room-state.mjs";
import {verifiedSocketIdentity} from "./runtime/socket-identity.mjs";
// Assigned before Next prepares its route workers. Never accept an externally set secret.
process.env.INTERNAL_LIVE_SECRET=randomBytes(32).toString("hex");
const port=Number(process.env.PORT||3000),hostname=process.env.HOSTNAME||"0.0.0.0";
const dev=process.argv.includes("--dev");
const config=dev?undefined:JSON.parse(readFileSync(new URL("./.next/required-server-files.json",import.meta.url))).config;
const app=next({dev,hostname,port,conf:config,webpack:true});
await app.prepare();
const server=createServer(app.getRequestHandler());
const io=new Server(server,{cors:{origin:process.env.APP_ORIGIN,credentials:true},maxHttpBufferSize:CHAT_MAX_PAYLOAD,transports:["websocket"]});
const clerk=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
io.use(async(socket,next)=>{
 try{
 if(socket.handshake.headers.origin!==process.env.APP_ORIGIN)throw new Error();
 const token=socket.handshake.auth?.token;if(typeof token!=="string"||token.length>10000)throw new Error();
 const claims=await verifyToken(token,{secretKey:process.env.CLERK_SECRET_KEY,authorizedParties:[process.env.APP_ORIGIN]});
 const user=await clerk.users.getUser(claims.sub);
 const identity=verifiedSocketIdentity(user,claims.sub);if(!identity||!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())throw new Error();
 socket.data.sessionId=claims.sid;socket.data.identity=identity;socket.data.expires=claims.exp*1000;next();
 }catch{next(new Error("Sign in with Google."));}
});
const client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});await client.connect();
const collection=client.db(process.env.MONGODB_DB||"pokerroom").collection("rooms");
const chat=createChatService(client.db(process.env.MONGODB_DB||"pokerroom"),{clerk});
await chat.ready;
const checkChatSession=sessionGuard(clerk);
let hintTimer;
function hintChatChanged(){if(hintTimer)return;hintTimer=setTimeout(()=>{hintTimer=null;io.emit("chat:changed",{v:1});},100);hintTimer.unref();}
async function pushState(socket,force=false){
 if(!socket.connected||socket.data.busy)return;
 if(socket.data.expires<=Date.now()){socket.disconnect(true);return;}
 socket.data.busy=true;
 try{
  const response=await fetch(`http://127.0.0.1:${port}/api/internal-live`,{
   method:"POST",headers:{"content-type":"application/json","x-internal-live-secret":process.env.INTERNAL_LIVE_SECRET,...(socket.data.chart?{"x-chart-symbol":socket.data.chart.symbol,"x-chart-granularity":socket.data.chart.granularity}:{})},
   body:JSON.stringify(socket.data.identity),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw new Error("Live snapshot unavailable");
  const data=await response.json();
  if(!socket.connected||socket.data.expires<=Date.now())return;
  for(const [key,event] of [["maintenance","maintenance:state"],["history","history:state"]]){
   if(key==="history"&&!socket.data.identity.admin)continue;
   const fingerprint=JSON.stringify(data[key]);
   if(force||socket.data[key]!==fingerprint){socket.emit(event,data[key]);socket.data[key]=fingerprint;}
  }
  emitRoomState(socket,data,force);
  emitChartState(socket,data);
  socket.data.initialized=true;
 }catch{socket.emit("live:error",{error:"Live state unavailable. Retrying."});}
 finally{socket.data.busy=false;}
}
io.on("connection",socket=>{
 socket.on("candles:subscribe",selection=>subscribeChart(socket,selection));
 for(const event of ["register","state","claim","wrap","send","history","keys:get","keys:put"]){
  socket.on("chat:"+event,async(payload,ack)=>{
   if(typeof ack!=="function")return;
   if((socket.data.chatPending||0)>=4){ack({ok:false,error:"busy"});return;}
   socket.data.chatPending=(socket.data.chatPending||0)+1;
   try{
    await checkChatSession(socket);
    if(!socket.connected||socket.data.expires<=Date.now()){socket.disconnect(true);return;}
    const result=await chat.handle(socket.data.identity.id,event,payload);
    if(socket.data.expires<=Date.now()){socket.disconnect(true);return;}
    ack({ok:true,...result});
    if(["register","claim","wrap","send"].includes(event)){
     // Generic coalesced hints contain no membership, ciphertext or wrapped keys.
     hintChatChanged();
    }
   }catch(error){ack({ok:false,error:error.chatCode||"unavailable"});if(error.chatCode==="forbidden"||error.message==="session")socket.disconnect(true);}finally{socket.data.chatPending--;}
  });
 }
 const expiry=setTimeout(()=>socket.disconnect(true),Math.max(0,socket.data.expires-Date.now()));
 socket.on("disconnect",()=>clearTimeout(expiry));
 void pushState(socket,true);
});
let running=false;
const timer=setInterval(async()=>{
 if(running||!io.engine.clientsCount)return;running=true;
 try{
  const r=await collection.findOne({_id:"main"},{projection:{version:1}});
  const now=Date.now();
  await Promise.all([...io.sockets.sockets.values()].map(socket=>{
   // Maintenance/backfill can change without the room version changing.
   if(!socket.data.initialized||socket.data.version!==r?.version||now-(socket.data.statusAt||0)>=1000){
    socket.data.statusAt=now;return pushState(socket,!socket.data.initialized);
   }
  }));
 }catch{}finally{running=false;}
},200);timer.unref();
server.listen(port,hostname);
async function stop(){clearInterval(timer);await io.close();await client.close();server.close();process.exit(0);}
process.once("SIGTERM",stop);process.once("SIGINT",stop);
