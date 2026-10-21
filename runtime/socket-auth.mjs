// Renew credentials without replacing the transport, tab lease, or state streams.
// A failed/absent refresh never extends the previously verified deadline.
export function attachSocketAuth(socket,{verify,checkSession,now=Date.now,refreshLead=20000,retryMs=5000}){
 let expiry,refresh,busy=false,disposed=false;
 const arm=()=>{
  clearTimeout(expiry);clearTimeout(refresh);
  const remaining=socket.data.expires-now();
  if(remaining<=0){socket.disconnect(true);return;}
  expiry=setTimeout(()=>socket.disconnect(true),remaining);expiry.unref?.();
  const request=()=>{
   if(disposed||!socket.connected)return;
   socket.emit("auth:refresh",{expiresAt:socket.data.expires});
   refresh=setTimeout(request,retryMs);refresh.unref?.();
  };
  refresh=setTimeout(request,Math.max(0,remaining-refreshLead));refresh.unref?.();
 };
 socket.on("auth:renew",async(payload,ack)=>{
  if(typeof ack!=="function")return;
  if(busy||now()<(socket.data.authRenewAt||0)){ack({ok:false,error:"busy"});return;}
  socket.data.authRenewAt=now()+1000;
  busy=true;
  try{
   if(disposed||!socket.connected||socket.data.expires<=now())throw Error("session");
   const token=payload?.token;
   if(typeof token!=="string"||token.length>10000)throw Error("token");
   const claims=await verify(token);
   if(claims.sub!==socket.data.identity.id||claims.sid!==socket.data.sessionId||
      typeof claims.sid!=="string"||!Number.isFinite(claims.exp)||claims.exp*1000<=now())throw Error("token");
   // Check revocation/Google identity/admin status against the live session,
   // still under the OLD deadline. Never authenticate by a decoded JWT alone.
   await checkSession(socket);
   if(disposed||!socket.connected||socket.data.expires<=now())throw Error("session");
   if(claims.exp*1000<=socket.data.expires)throw Error("stale");
   socket.data.expires=claims.exp*1000;
   arm();ack({ok:true,expiresAt:socket.data.expires});
  }catch{ack({ok:false,error:"unauthorized"});}
  finally{busy=false;}
 });
 socket.once("disconnect",()=>{disposed=true;clearTimeout(expiry);clearTimeout(refresh);});
 arm();
}
export function attachSocketAuthClient(socket,getToken){
 let busy=false,disposed=false;
 const refresh=async()=>{
  if(disposed||busy||!socket.connected)return;
  busy=true;
  try{
   const token=await getToken();
   if(!disposed&&socket.connected&&token)socket.timeout(10000).emit("auth:renew",{token},()=>{});
  }catch{}finally{busy=false;}
 };
 socket.on("auth:refresh",refresh);
 return()=>{disposed=true;socket.off("auth:refresh",refresh);};
}
