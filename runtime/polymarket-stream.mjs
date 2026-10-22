// One server-owned CLOB socket. Discovery never creates demand. No REST book fallback.
const URL='wss://ws-subscriptions-clob.polymarket.com/ws/market';
const idOK=x=>typeof x==='string'&&/^\d{1,24}$/.test(x);
const tokenOK=x=>typeof x==='string'&&/^\d{1,80}$/.test(x);
export function createPolymarketStream({connect=url=>new WebSocket(url),now=Date.now,graceMs=5000,freshMs=10000,healthMs=25000,onChange=()=>{}}={}){
 const liveStates=new Map();
 const markets=new Map(),viewers=new Map(),books=new Map(),subscribed=new Set();
 let socket=null,connectingAt=0,heartbeatAt=0,pingAt=0,retryAt=0,attempt=0,opens=0,stopped=false;
 const desired=()=>new Set([...markets.values()].flatMap(m=>[...m.tokens]));
 const changed=marketId=>onChange(marketId);
 function entry(id,tokens){
  if(!idOK(id)||!Array.isArray(tokens)||tokens.length>2||!tokens.length||!tokens.every(tokenOK))throw new Error('Invalid prediction market');
  let m=markets.get(id);if(!m){if(markets.size>=7000)throw new Error('Prediction stream is busy');m={tokens:new Set(),viewers:new Set(),pins:new Set(),until:null};markets.set(id,m);}
  for(const t of tokens)m.tokens.add(t);return m;
 }
 function release(m){if(!m.viewers.size&&!m.pins.size&&m.until===null)m.until=now()+graceMs;}
 function setViewer(viewer,id,tokens=[]){
  const previous=viewers.get(viewer);if(previous===id||previous===undefined&&id===null)return;
  const next=id===null?null:entry(id,tokens);
  if(previous){const m=markets.get(previous);m?.viewers.delete(viewer);if(m)release(m);viewers.delete(viewer);}
  if(next){next.viewers.add(viewer);next.until=null;viewers.set(viewer,id);}reconcile();
 }
 function syncPositions(positions){
  // Called with durable open shares, not client claims. Future resting orders can use this same pin set.
  const grouped=new Map();
  for(const p of positions){if(!idOK(p.marketId)||!tokenOK(p.tokenId)||!(p.shareMicros>0))continue;let ts=grouped.get(p.marketId);if(!ts){ts=new Set();grouped.set(p.marketId,ts);}ts.add(p.tokenId);}
  for(const m of markets.values())m.pins.clear();
  for(const [id,ts]of grouped){const m=entry(id,[...ts]);m.pins=new Set(ts);m.until=null;}
  for(const m of markets.values())release(m);reconcile();
 }
 function send(data){socket.send(JSON.stringify(data));}
 function invalidate(){books.clear();subscribed.clear();for(const id of markets.keys())changed(id);}
 function lose(ws){if(socket!==ws)return;socket=null;invalidate();retryAt=now()+Math.min(30000,500*2**Math.min(attempt++,6));try{ws.close();}catch{}}
 function reconcile(){
  if(stopped)return;
  const tokens=desired();
  if(!tokens.size){if(socket){const old=socket;socket=null;try{old.close();}catch{}}invalidate();return;}
  if(!socket&&now()>=retryAt){
   let ws;try{ws=connect(URL);}catch{retryAt=now()+1000;return;}socket=ws;connectingAt=now();
   ws.addEventListener('open',()=>{if(socket!==ws)return;opens++;attempt=0;heartbeatAt=pingAt=now();subscribed.clear();books.clear();const ids=[...desired()];send({assets_ids:ids,type:'market',custom_feature_enabled:true});ids.forEach(t=>subscribed.add(t));for(const id of markets.keys())changed(id);});
   ws.addEventListener('message',event=>{if(socket!==ws)return;const text=String(event.data);if(text==='PONG'){heartbeatAt=now();return;}if(text.length>4_000_000){lose(ws);return;}try{const data=JSON.parse(text);for(const item of Array.isArray(data)?data:[data])message(item);}catch{/* Invalid upstream frames never become tradable. */}});
   ws.addEventListener('close',()=>lose(ws));ws.addEventListener('error',()=>lose(ws));return;
  }
  if(socket?.readyState!==1)return;
  const add=[...tokens].filter(t=>!subscribed.has(t)),remove=[...subscribed].filter(t=>!tokens.has(t));
  if(add.length){send({assets_ids:add,operation:'subscribe',custom_feature_enabled:true});add.forEach(t=>subscribed.add(t));}
  if(remove.length){send({assets_ids:remove,operation:'unsubscribe'});for(const t of remove){subscribed.delete(t);books.delete(t);}}
 }
 function notifyToken(token){for(const [id,m]of markets)if(m.tokens.has(token))changed(id);}
 function price(x){const n=Number(x);return Number.isFinite(n)&&n>0&&n<1?n:null;}
 function levels(rows){if(!Array.isArray(rows)||rows.length>2000)throw new Error('Bad book');const out=new Map();for(const row of rows){const p=price(row.price),s=Number(row.size);if(p===null||!Number.isFinite(s)||s<0)throw new Error('Bad level');if(s>0)out.set(String(row.price),String(row.size));}return out;}
 function message(x){
  if(!x||typeof x!=='object')return;
  if(x.event_type==='book'&&subscribed.has(x.asset_id)){
   // A malformed replacement invalidates previous depth rather than preserving a tradable partial book.
   let bids,asks;try{bids=levels(x.bids);asks=levels(x.asks);}catch{books.delete(x.asset_id);notifyToken(x.asset_id);return;}if(typeof x.market!=='string')return;
   books.set(x.asset_id,{tokenId:x.asset_id,conditionId:x.market,bids,asks,asOf:now(),sourceAt:Number(x.timestamp)||null,hash:String(x.hash||'')});heartbeatAt=now();notifyToken(x.asset_id);
  }else if(x.event_type==='price_change'&&Array.isArray(x.price_changes)&&x.price_changes.length<=4000){
   for(const c of x.price_changes){const b=books.get(c.asset_id);if(!subscribed.has(c.asset_id)||!b||b.conditionId!==x.market)continue;
    const p=price(c.price),s=Number(c.size);if(p===null||!Number.isFinite(s)||s<0||!['BUY','SELL'].includes(c.side)){books.delete(c.asset_id);notifyToken(c.asset_id);continue;}
    const rows=c.side==='BUY'?b.bids:b.asks;
    // Canonical numeric keys prevent differently formatted decimal prices duplicating a level.
    for(const key of rows.keys())if(Number(key)===p)rows.delete(key);
    if(s>0)rows.set(String(c.price),String(c.size));if(rows.size>5000){books.delete(c.asset_id);notifyToken(c.asset_id);continue;}b.asOf=now();b.sourceAt=Number(x.timestamp)||null;b.hash=String(c.hash||'');heartbeatAt=now();notifyToken(c.asset_id);
   }
  }else if(x.event_type==='market_resolved'){for(const t of x.assets_ids||[]){books.delete(t);notifyToken(t);}}
 }
 function read(token){
  const b=books.get(token);if(socket?.readyState!==1||now()-heartbeatAt>healthMs||!subscribed.has(token)||!b||now()-b.asOf>freshMs)return null;
  const rows=(m,desc)=>[...m].map(([price,size])=>({price,size})).sort((a,b)=>desc?Number(b.price)-Number(a.price):Number(a.price)-Number(b.price));
  return{asset_id:token,market:b.conditionId,bids:rows(b.bids,true),asks:rows(b.asks,false),timestamp:b.asOf,hash:b.hash,source:'stream',sourceAt:b.sourceAt,streamAt:b.asOf};
 }
 function sweep(){
  for(const [id,m]of markets)if(m.until!==null&&now()>=m.until){markets.delete(id);changed(id);}
  if(socket?.readyState===0&&now()-connectingAt>10000)lose(socket);
  if(socket?.readyState===1){if(now()-heartbeatAt>healthMs)lose(socket);else if(now()-pingAt>=10000){try{socket.send('PING');pingAt=now();}catch{lose(socket);}}}
  reconcile();
  for(const id of markets.keys()){const live=status(id).live;if(liveStates.get(id)!==live){liveStates.set(id,live);changed(id);}}
  for(const id of liveStates.keys())if(!markets.has(id))liveStates.delete(id);
 }
 function status(id){const m=markets.get(id);return{marketId:id,live:!!m&&[...m.tokens].every(t=>!!read(t)),books:m?[...m.tokens].map(read).filter(Boolean):[],serverNow:now()};}
 function diagnostics(){return{connections:socket?1:0,opens,connected:socket?.readyState===1,markets:[...markets].map(([id,m])=>({id,viewers:m.viewers.size,positions:m.pins.size,tokens:[...m.tokens],graceUntil:m.until})),subscribed:[...subscribed],cached:books.size};}
 function stop(){stopped=true;const old=socket;socket=null;old?.close();books.clear();subscribed.clear();markets.clear();viewers.clear();}
 return{setViewer,syncPositions,read,sweep,status,diagnostics,stop};
}

// Presence uses server-authenticated socket identity only. One selected market per socket.
export function attachPolymarketPresence(socket,{stream,resolveMarket,checkSession,now=Date.now}){
 let version=0,last=0,count=0,pending=false;
 const clear=()=>{version++;stream.setViewer(socket.id,null);};
 socket.on('polymarket:watch',async(id,ack)=>{
  const reply=value=>{if(typeof ack==='function')ack(value);};
  if(id===null){clear();reply({ok:true});return;}
  if(!idOK(id)||socket.data.marketRoute!=='/polymarket'){reply({ok:false,error:'Invalid market presence'});return;}
  const at=now();if(at-last>=10000){last=at;count=0;}if(++count>20||pending){reply({ok:false,error:'Presence rate limit'});return;}
  const serial=++version;pending=true;
  try{
   await checkSession(socket);
   if(!socket.connected||socket.data.expires<=now())throw new Error('Sign in again');
   const market=await resolveMarket(id);
   if(serial!==version||!socket.connected||socket.data.marketRoute!=='/polymarket')return;
   if(!Array.isArray(market.tokens)||market.tokens.length!==2||!market.tokens.every(tokenOK))throw new Error('Unsupported market');
   stream.setViewer(socket.id,id,market.tokens);reply({ok:true,...stream.status(id)});
  }catch{if(serial===version){clear();reply({ok:false,error:'Live market unavailable'});}}
  finally{pending=false;}
 });
 socket.on('tab:report',report=>{if(report?.route!=='/polymarket')clear();});
 socket.on('disconnect',clear);
}
