// Authenticated user-scoped document leases. Reconnects replace only their own proof.
export const TAB_LEASE_MS=16000;
// Keep the lease on the real pathname. Only shipped mini-game routes share games.
const miniGameRoutes=new Set(["/games","/games/plinko","/games/hilo","/games/mines","/games/dice","/games/chicken"]);
const credential=v=>typeof v==="string"&&/^(?:[a-f0-9]{48}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(v);
export function createTabLeases({now=Date.now}={}){
 const users=new Map();
 const publish=tabs=>{const state={blocked:tabs.size>1,tabs:tabs.size};for(const t of tabs.values())t.socket.emit("tab:state",state);};
 function sweep(user){const tabs=users.get(user);if(!tabs)return;let changed=false;for(const [id,t] of tabs)if(now()-t.at>=TAB_LEASE_MS){tabs.delete(id);changed=true;t.socket.disconnect(true);}if(changed)publish(tabs);if(!tabs.size)users.delete(user);}
 function attach(user,socket,{tabId,tabProof,route}={}){
  if(!credential(tabId)||!credential(tabProof)||!validRoute(route))throw new Error("Reload this page to establish a tab lease.");
  sweep(user);let tabs=users.get(user);if(!tabs)users.set(user,tabs=new Map());
  const old=tabs.get(tabId);
  if(old&&old.proof!==tabProof)throw new Error("Tab ownership mismatch.");
  if(!old&&tabs.size>=32)throw new Error("Too many tabs. Close the other tabs.");
  const tab={proof:tabProof,route,at:now(),socket};tabs.set(tabId,tab);
  if(old&&old.socket!==socket)old.socket.disconnect(true);
  publish(tabs);
  const owns=()=>users.get(user)?.get(tabId)===tab;
  socket.on("tab:report",report=>{if(!owns()||!report||!validRoute(report.route))return;tab.route=report.route;tab.at=now();publish(tabs);});
  socket.on("disconnect",()=>{if(!owns())return;tabs.delete(tabId);publish(tabs);if(!tabs.size)users.delete(user);});
 }
 function check(user,tabId,proof,game){
  sweep(user);const tabs=users.get(user),tab=tabs?.get(tabId);
  if(tabs&&tabs.size>1)return "Only one tab is allowed. Close the other tabs.";
  if(!tab||tab.proof!==proof||!tab.socket.connected)return "Reconnect this tab before taking actions.";
  if(game&&!(game==="games"?miniGameRoutes.has(tab.route):tab.route==="/"+game))return "Switch to the "+game+" tab to bet";
  return null;
 }
 return {attach,check,sweepAll(){for(const user of users.keys())sweep(user);}};
}
function validRoute(route){return typeof route==="string"&&route.startsWith("/")&&route.length<=200&&!/[?#]/.test(route);}
