import {io} from "socket.io-client";
import {ChatClient} from "../../lib/chat-client";
import {indexedDbStore} from "../../lib/chat-store";
const user=new URLSearchParams(location.search).get("user")!;
const socket=io({auth:{user},reconnection:false});
const request=(e:string,p:unknown)=>new Promise((resolve,reject)=>socket.timeout(1000).emit("chat:"+e,p,(err:unknown,r:any)=>err?reject(Error("timeout")):resolve(r)));
const client=new ChatClient(user,request,indexedDbStore());
Object.assign(window,{client,socket,store:indexedDbStore(),ready:new Promise<void>(r=>socket.on("connect",()=>r()))});
