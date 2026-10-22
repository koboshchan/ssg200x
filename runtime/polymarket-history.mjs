// Only this server-owned service can cold-fetch history. No discovery/settlement sweep calls it.
const idOK=x=>typeof x==='string'&&/^\d{1,24}$/.test(x);
const ranges={'1d':86400,'1w':604800,'1m':2592000,all:Infinity};
export function createPolymarketHistory({collection,authorize,resolveToken,fetchHistory,canPersist=async()=>false,now=Date.now,maxPoints=5000,appendEveryMs=60000}){
 const pending=new Map(),appending=new Map(),lastAppend=new Map();
 const normalize=rows=>{
  if(!Array.isArray(rows))throw new Error('Invalid price history');
  const byTime=new Map();for(const row of rows){if(!row||!Number.isSafeInteger(row.t)||row.t<=0||row.t>now()/1000+60||!Number.isFinite(row.p)||row.p<0||row.p>1)continue;byTime.set(row.t,{t:row.t,p:row.p});}
  return [...byTime.values()].sort((a,b)=>a.t-b.t).slice(-maxPoints);
 };
 async function load(id,demand){
  if(!idOK(id)||!await authorize(id,demand))throw Object.assign(new Error('View or hold this market to load history.'),{status:403});
  const existing=await collection.findOne({_id:id});if(existing?.initialized)return existing;
  if(pending.has(id))return pending.get(id);
  if(pending.size>=32)throw Object.assign(new Error('History is busy. Try again.'),{status:503});
  const work=(async()=>{
   // Re-read after acquiring process singleflight. A restart always consults durable state first.
   const stored=await collection.findOne({_id:id});if(stored?.initialized)return stored;
   const tokenId=await resolveToken(id);
   // Presence may have disappeared during metadata lookup. Never use a stale demand claim.
   if(!await authorize(id,demand))throw Object.assign(new Error('Market demand ended.'),{status:403});
   const points=normalize(await fetchHistory(tokenId));
   const doc={_id:id,tokenId,initialized:true,points,backfilledAt:now(),updatedAt:now()};
   await collection.updateOne({_id:id},{$setOnInsert:doc},{upsert:true});
   return await collection.findOne({_id:id});
  })();pending.set(id,work);try{return await work;}finally{pending.delete(id);}
 }
 async function read(id,range,demand){
  if(!Object.hasOwn(ranges,range))throw Object.assign(new Error('Invalid history range'),{status:400});
  const doc=await load(id,demand),cutoff=now()/1000-ranges[range];
  return{points:doc.points.filter(p=>p.t>=cutoff).map(p=>({t:p.t*1000,p:p.p})),stored:true,asOf:doc.updatedAt};
 }
 function append(id,tokenId,book){
  // Historical REST backfill above remains durable for viewers. Realtime writes require durable financial demand, never just viewers.
  if(!idOK(id)||pending.has(id)||appending.has(id)||now()-(lastAppend.get(id)??-Infinity)<appendEveryMs)return Promise.resolve();
  const bid=Number(book?.bids?.[0]?.price),ask=Number(book?.asks?.[0]?.price);
  if(book?.source!=='stream'||!Number.isFinite(bid)||!Number.isFinite(ask)||bid<=0||ask>=1||bid>ask)return Promise.resolve();
  const work=(async()=>{
   // Don't let an incidental tick create a partial record that suppresses the first full backfill.
   if(!await canPersist(id))return;
   const stored=await collection.findOne({_id:id},{projection:{tokenId:1,initialized:1}});
   if(!stored?.initialized||stored.tokenId!==tokenId||!await canPersist(id))return;
   await collection.updateOne({_id:id,tokenId,initialized:true},{$push:{points:{$each:[{t:Math.floor(now()/1000),p:(bid+ask)/2}],$slice:-maxPoints}},$set:{updatedAt:now()}});
   lastAppend.delete(id);lastAppend.set(id,now());if(lastAppend.size>7000)lastAppend.delete(lastAppend.keys().next().value);
  })();appending.set(id,work);return work.finally(()=>appending.delete(id));
 }
 return{read,append};
}
// Caller identity comes from an authenticated API endpoint, never a browser-provided user ID.
export async function authorizePolymarketHistory({marketId,demand,collection,sockets,checkTab,checkSession,now=Date.now}){
 if(!idOK(marketId)||typeof demand?.userId!=='string')return false;
 const held=await collection.findOne({_id:'main','polymarket.positions':{$elemMatch:{userId:demand.userId,marketId,shareMicros:{$gt:0}}}},{projection:{_id:1}});
 if(held)return true;
 if(checkTab(demand.userId,demand.tabId,demand.tabProof,'polymarket'))return false;
 for(const socket of sockets()){
  if(!socket.connected||socket.data.expires<=now()||socket.data.identity.id!==demand.userId||socket.handshake.auth?.tabId!==demand.tabId||socket.handshake.auth?.tabProof!==demand.tabProof||socket.data.marketRoute!=='/polymarket'||socket.data.polyMarketId!==marketId)continue;
  try{await checkSession(socket);}catch{return false;}return socket.connected&&socket.data.expires>now()&&socket.data.polyMarketId===marketId&&socket.data.marketRoute==='/polymarket';
 }
 return false;
}

// Normalize trusted durable financial demand only. Discovery/viewers never enter this list.
// Current trades execute immediately; optional resting orders must explicitly be open/partially-filled.
export function polymarketFinancialPins(state){
 const positions=(state?.positions??[]).filter(p=>idOK(p.marketId)&&typeof p.tokenId==='string'&&/^\d{1,80}$/.test(p.tokenId)&&p.shareMicros>0);
 const orders=(state?.orders??[]).filter(o=>idOK(o.marketId)&&typeof o.tokenId==='string'&&/^\d{1,80}$/.test(o.tokenId)&&['open','partially_filled'].includes(o.status)&&Number.isSafeInteger(o.remainingShareMicros)&&o.remainingShareMicros>0).map(o=>({...o,shareMicros:o.remainingShareMicros}));
 return [...positions,...orders];
}
