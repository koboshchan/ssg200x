// Socket.IO middleware runs before dispatching any registered event listeners.
// Read/key recovery and release messages remain usable when posting is disabled.
export function socketFeature(event,payload){
 if(event==='poker:taunt')return ['poker','tableTalk'];
 if(['chat:send','chat:claim','chat:wrap'].includes(event))return ['chat','tableTalk'];
 if(['chat:register','chat:keys:put'].includes(event))return ['chat'];
 if(event==='dm:send')return ['chat','dms'];
 if(event==='polymarket:watch'&&payload!==null)return ['polymarket'];
 return [];
}
export function attachFeatureSocket(socket,settings){
 socket.use(([event,...args],next)=>{
  const disabled=socketFeature(event,args[0]).find(key=>!settings.enabled(key));
  if(disabled){const ack=args.at(-1);if(typeof ack==='function')ack({ok:false,error:'feature_disabled',feature:disabled});return;}
  next();
 });
}
