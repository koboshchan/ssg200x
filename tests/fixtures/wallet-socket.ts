import {STATE_STREAMS,emitState} from "../../runtime/state-stream.mjs";
const handlers=new Map<string,(p?:unknown)=>void>();
export function io(){
 const socket={connected:true,active:true,on(event:string,fn:(p?:any)=>void){handlers.set(event,fn);return socket;},io:{on(){}},disconnect(){},connect(){},emit(event:string,_p?:unknown,ack?:(r:unknown)=>void){if(event==="tab:report"&&typeof ack==="function")ack({ok:true,leaseTtlMs:16000});},timeout(){return socket;}};
 const sender={emit:(event:string,p:unknown)=>handlers.get(event)?.(p)};
 Object.assign(window,{walletSocket:(event:string,p:unknown)=>STATE_STREAMS.includes(event)?emitState(sender,event,p):handlers.get(event)?.(p)});
 queueMicrotask(()=>handlers.get("connect")?.());
 return socket;
}
