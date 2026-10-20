const handlers=new Map<string,(p?:unknown)=>void>();
export function io(){
 const socket={connected:true,active:true,on(event:string,fn:(p?:any)=>void){handlers.set(event,fn);return socket;},io:{on(){}},disconnect(){},connect(){},emit(){},timeout(){return socket;}};
 Object.assign(window,{walletSocket:(event:string,p:unknown)=>handlers.get(event)?.(p)});
 queueMicrotask(()=>handlers.get("connect")?.());
 return socket;
}
