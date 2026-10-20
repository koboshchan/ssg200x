import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {Server} from "socket.io";
import {io as connect} from "socket.io-client";
const once=(socket:{once:(event:string,fn:(...args:any[])=>void)=>unknown},event:string)=>new Promise<any[]>(resolve=>socket.once(event,(...args)=>resolve(args)));
import {emitState,createStateReceiver,STATE_STREAMS,resetStream} from "../runtime/state-stream.mjs";
test("real authenticated Socket.IO full/diff streams isolate users, recover gaps, reconnect, and dispose",async()=>{
 const http=createServer(),server=new Server(http,{transports:["websocket"]});
 const sockets=new Map<string,any>();
 server.use((s,next)=>["alice","bob"].includes(s.handshake.auth.token)?next():next(Error("unauthorized")));
 server.on("connection",s=>{
  const id=s.handshake.auth.token;sockets.set(id,s);
  s.on("state:resync",(event)=>{if(STATE_STREAMS.includes(event))emitState(s,event,{owner:id,balance:7},true);});
  for(const event of STATE_STREAMS)emitState(s,event,{owner:id,balance:10,positions:[{id:"p",pnl:0}],poker:{hole:[id==="alice"?"As":"Ks"]},roulette:{bets:[]}});
  s.on("disconnect",()=>{if(sockets.get(id)===s)sockets.delete(id);});
 });
 await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));
 const address=http.address() as any,url="http://127.0.0.1:"+address.port;
 const clients:any[]=[];
 try{
  const bad=connect(url,{transports:["websocket"],auth:{token:"victim"},reconnection:false});clients.push(bad);
  await once(bad,"connect_error");assert.equal(bad.connected,false);
  const views=new Map<string,Map<string,any>>(),received=new Map<string,any[]>();
  for(const id of ["alice","bob"]){
   const client=connect(url,{transports:["websocket"],auth:{token:id},autoConnect:false});clients.push(client);
   const values=new Map<string,any>(),messages:any[]=[];views.set(id,values);received.set(id,messages);
   const receiver=createStateReceiver(event=>client.emit("state:resync",event));
   client.on("disconnect",()=>receiver.clear());
   for(const event of STATE_STREAMS)client.on(event,(m:any)=>{messages.push(m);const result=receiver.receive(event,m);if(result.ok)values.set(event,result.value);});
   const ready=once(client,STATE_STREAMS.at(-1)!);client.connect();await ready;
   assert.equal(values.size,STATE_STREAMS.length);
  }
  for(const event of STATE_STREAMS){
   const a=sockets.get("alice"),ready=once(clients[1],event);
   emitState(a,event,{owner:"alice",balance:9,positions:[],poker:{hole:["As"]},roulette:{bets:[{amount:1}]}});
   await ready;
   assert.equal(views.get("alice")!.get(event).balance,9);
   assert.equal(views.get("bob")!.get(event).balance,10);
   const recovery=once(clients[1],event);
   a.emit(event,{type:"diff",seq:99,snapshotVersion:1,patch:{op:"replace",value:{owner:"bob"}}});
   await recovery;
   // Actual resync response arrives after the invalid diff event.
   if(views.get("alice")!.get(event).balance!==7)await once(clients[1],event);
   assert.equal(views.get("alice")!.get(event).balance,7);
   const periodic=once(clients[1],event);emitState(a,event,{owner:"alice",balance:7},false,Date.now()+8001);await periodic;
   assert.equal(received.get("alice")!.at(-1).type,"full");
   resetStream(a,event);
   const subscribed=once(clients[1],event);emitState(a,event,{owner:"alice",balance:7});await subscribed;
   assert.equal(received.get("alice")!.at(-1).type,"full");
  }
  for(const id of ["alice","bob"])assert.equal(JSON.stringify(received.get(id)).includes(id==="alice"?"Ks":"As"),false);
  clients[1].disconnect();const reconnected=once(clients[1],STATE_STREAMS.at(-1)!);clients[1].connect();await reconnected;
  assert.equal(views.get("alice")!.get("room:state").balance,10);
 }finally{
  for(const client of clients)client.disconnect();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  assert.equal(server.sockets.sockets.size,0);assert.equal(server.engine.clientsCount,0);
 }
});
