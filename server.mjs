import {createServer} from "node:http";
import {readFileSync} from "node:fs";
import next from "next";
import {Server} from "socket.io";
import {createClerkClient,verifyToken} from "@clerk/backend";
import {MongoClient} from "mongodb";
const port=Number(process.env.PORT||3000),hostname=process.env.HOSTNAME||"0.0.0.0";
const dev=process.argv.includes("--dev");
const config=dev?undefined:JSON.parse(readFileSync(new URL("./.next/required-server-files.json",import.meta.url))).config;
const app=next({dev,hostname,port,conf:config,webpack:true});
await app.prepare();
const server=createServer(app.getRequestHandler());
const io=new Server(server,{cors:{origin:process.env.APP_ORIGIN,credentials:true},maxHttpBufferSize:2048,connectionStateRecovery:{maxDisconnectionDuration:20000,skipMiddlewares:false}});
const clerk=createClerkClient({secretKey:process.env.CLERK_SECRET_KEY});
io.use(async(socket,next)=>{
 try{
 if(socket.handshake.headers.origin!==process.env.APP_ORIGIN)throw new Error();
 const token=socket.handshake.auth?.token;if(typeof token!=="string"||token.length>10000)throw new Error();
 const claims=await verifyToken(token,{secretKey:process.env.CLERK_SECRET_KEY,authorizedParties:[process.env.APP_ORIGIN]});
 const user=await clerk.users.getUser(claims.sub);
 if(user.passwordEnabled||!user.externalAccounts.some(a=>a.provider==="oauth_google"||a.provider==="google"))throw new Error();
 if(user.publicMetadata.role!=="admin"&&await maintenanceBlocked())throw new Error();
 socket.data.admin=user.publicMetadata.role==="admin";socket.data.expires=claims.exp*1000;next();
 }catch{next(new Error("Sign in with Google."));}
});
io.on("connection",socket=>{const timer=setTimeout(()=>socket.disconnect(true),Math.max(0,socket.data.expires-Date.now()));socket.on("disconnect",()=>clearTimeout(timer));});
const client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});await client.connect();
const database=client.db(process.env.MONGODB_DB||"pokerroom");
async function maintenanceBlocked(){
 const r=await database.collection("rooms").findOne({_id:"main"},{projection:{siteMaintenance:1}});
 if(r?.siteMaintenance)return true;
 const state=await database.collection("candle_history_state").findOne({_id:"archive-12-month-v1"});
 if(!state?.seeded||state.version!==2||!Number.isInteger(state.total)||state.total<=0||!Array.isArray(state.jobIds)||state.jobIds.length!==state.total)return true;
 const finished=await database.collection("candle_backfill").countDocuments({_id:{$in:state.jobIds||[]},status:{$in:["done","missing"]}});
 return finished<state.total;
}
const collection=client.db(process.env.MONGODB_DB||"pokerroom").collection("rooms");let version=-1,running=false;
const timer=setInterval(async()=>{if(running||!io.engine.clientsCount)return;running=true;try{const r=await collection.findOne({_id:"main"},{projection:{version:1}});const blocked=await maintenanceBlocked();for(const s of io.sockets.sockets.values())if(!s.data.admin&&blocked)s.disconnect(true);
 if(r&&r.version!==version){version=r.version;io.emit("room:update",version);}}catch{}finally{running=false;}},200);timer.unref();
server.listen(port,hostname);
async function stop(){clearInterval(timer);await io.close();await client.close();server.close();process.exit(0);}
process.once("SIGTERM",stop);process.once("SIGINT",stop);
