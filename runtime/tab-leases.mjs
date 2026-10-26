// Authenticated user-scoped document leases. Reconnects replace only their own proof.
export const TAB_LEASE_MS=16000;
// Keep the lease on the real pathname. Only shipped mini-game routes share games.
const miniGameRoutes=new Set(["/games","/games/plinko","/games/hilo","/games/mines","/games/dice","/games/chicken"]);
const credential=v=>typeof v==="string"&&/^(?:[a-f0-9]{48}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(v);
export function createTabLeases({now=Date.now,diagnostics,singleTabEnabled=()=>true}={}){
 const users=new Map();let sequence=0;
 const trace=(event,tab,extra={})=>{if(!diagnostics)return;try{diagnostics({event,at:now(),...(tab?{lease:tab.sequence,ageMs:now()-tab.at}:{}),...extra});}catch{}};
 const publish=tabs=>{const state={blocked:singleTabEnabled()&&tabs.size>1,tabs:tabs.size};for(const t of tabs.values())t.socket.emit("tab:state",state);};
 function sweep(user){const tabs=users.get(user);if(!tabs)return new Set();const expired=new Set();let changed=false;for(const [id,t] of tabs)if(now()-t.at>=TAB_LEASE_MS){expired.add(id);trace("expired",t,{reason:"expired"});tabs.delete(id);changed=true;t.socket.disconnect(true);}if(changed)publish(tabs);if(!tabs.size)users.delete(user);return expired;}
 function attach(user,socket,{tabId,tabProof,route}={}){
  if(!credential(tabId)||!credential(tabProof)||!validRoute(route))throw new Error("Reload this page to establish a tab lease.");
  sweep(user);let tabs=users.get(user);if(!tabs)users.set(user,tabs=new Map());
  const old=tabs.get(tabId);
  if(old&&old.proof!==tabProof)throw new Error("Tab ownership mismatch.");
  if(!old&&tabs.size>=32)throw new Error("Too many tabs. Close the other tabs.");
  const tab={proof:tabProof,route,at:now(),socket,sequence:++sequence};tabs.set(tabId,tab);
  if(old&&old.socket!==socket)old.socket.disconnect(true);
  trace(old?"replaced":"attached",tab,{tabs:tabs.size});
  publish(tabs);
  const owns=()=>users.get(user)?.get(tabId)===tab;
  socket.on("tab:report",(report,ack)=>{
   const reply=value=>{if(typeof ack==="function")ack(value);};
   // A late report must not resurrect an expired/disconnected/replaced lease.
   if(!owns()||!socket.connected||now()-tab.at>=TAB_LEASE_MS){
    sweep(user);reply({ok:false,reason:"stale"});return;
   }
   if(!report||!validRoute(report.route)){reply({ok:false,reason:"invalid_report"});return;}
   trace("report",tab);tab.route=report.route;tab.at=now();publish(tabs);
   // Optional for legacy clients. This confirms freshness, NOT action permission.
   reply({ok:true,leaseTtlMs:TAB_LEASE_MS});
  });
  socket.on("disconnect",reason=>{const reasons={"transport close":"transport_close","transport error":"transport_error","ping timeout":"ping_timeout","server namespace disconnect":"server_disconnect","client namespace disconnect":"client_disconnect"};trace("disconnected",tab,{reason:reasons[reason]||"other"});if(!owns())return;tabs.delete(tabId);publish(tabs);if(!tabs.size)users.delete(user);});
 }
 function check(user,tabId,proof,game){
  const expired=sweep(user);const tabs=users.get(user),tab=tabs?.get(tabId);
  const reject=(reason,message)=>{trace("rejected",tab,{reason,tabs:tabs?.size||0});return message;};
  if(singleTabEnabled()&&tabs&&tabs.size>1)return reject("multiple","Only one tab is allowed. Close the other tabs.");
  if(!tab||tab.proof!==proof||!tab.socket.connected)return reject(!tab?(expired.has(tabId)?"expired":"missing"):tab.proof!==proof?"proof":"socket","Reconnect this tab before taking actions.");
  if(game&&!(game==="games"?miniGameRoutes.has(tab.route):tab.route==="/"+game))return reject("route","Switch to the "+game+" tab to bet");
  return null;
 }
 return {attach,check,publishAll(){for(const tabs of users.values())publish(tabs);},sweepAll(){for(const user of users.keys())sweep(user);}};
}
function validRoute(route){return typeof route==="string"&&route.startsWith("/")&&route.length<=200&&!/[?#]/.test(route);}
