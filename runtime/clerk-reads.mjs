// Per-process, per SDK client. No persistent identities or stale authorization.
// Timestamp at request START, never on hits/failure, so slow reads cannot extend grants.
export function createClerkReads({now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),ttl=5000,capacity=2048}={}){
 ttl=Math.min(ttl,5000);
 const cache=new Map(),inflight=new Map(),queue=[];
 let active=0,cooldown=0;
 const trim=()=>{
  for(const [k,v] of cache)if(v.until<=now())cache.delete(k);
  while(cache.size>capacity)cache.delete(cache.keys().next().value);
 };
 const pump=()=>{while(active<2&&queue.length){active++;const job=queue.shift();job().finally(()=>{active--;pump();});}};
 const execute=fn=>new Promise((resolve,reject)=>{
  if(queue.length>=256){reject(Error('Clerk read queue full'));return;}
  queue.push(async()=>{
   try{
    for(let attempt=0;;attempt++){
     const wait=cooldown-now();
     // One short recovery, never unbounded sleeping/retries on a normal request.
     if(wait>2000)throw Error('Clerk read cooldown');
     if(wait>0)await sleep(wait);
     // Another active read may have extended the shared cooldown while sleeping.
     if(cooldown>now())throw Error('Clerk read cooldown');
     try{resolve(await fn());return;}
     catch(e){
      if(e?.status!==429)throw e;
      const seconds=Number(e.retryAfter);
      cooldown=Math.max(cooldown,now()+(Number.isFinite(seconds)&&seconds>0?seconds*1000:1000));
      if(attempt>=1)throw e;
     }
    }
   }catch(e){reject(e);}
  });pump();
 });
 const read=(key,fn)=>{
  trim();
  const hit=cache.get(key);if(hit)return Promise.resolve(hit.value);
  if(inflight.has(key))return inflight.get(key);
  if(inflight.size>=capacity)return Promise.reject(Error('Clerk read capacity'));
  const pending=execute(async()=>{
   const started=now(),value=await fn();
   if(started+ttl<=now())throw Error('Clerk read expired');
   cache.set(key,{value,until:started+ttl});trim();
   return value;
  }).finally(()=>inflight.delete(key));
  inflight.set(key,pending);return pending;
 };
 // Batch profiles are presentation-only, never usable as an administrator/session grant.
 const profiles=(clerk,ids)=>Promise.all([...new Set(ids)].map(id=>profile(clerk,id)));
 const pendingProfiles=new Map();let scheduled=false;
 const profile=(clerk,id)=>{
  trim();const key='profile:'+id,hit=cache.get(key);
  if(hit)return Promise.resolve(hit.value);
  if(inflight.has(key))return inflight.get(key);
  if(inflight.size>=capacity)return Promise.reject(Error('Clerk read capacity'));
  const promise=new Promise((resolve,reject)=>{
   pendingProfiles.set(id,{resolve,reject});
   if(scheduled)return;scheduled=true;
   queueMicrotask(()=>{
    scheduled=false;
    const entries=[...pendingProfiles];pendingProfiles.clear();
    for(let i=0;i<entries.length;i+=100){
     const batch=entries.slice(i,i+100);
     execute(async()=>{
      const started=now();
      const {data}=await clerk.users.getUserList({userId:batch.map(([id])=>id),limit:100});
      const byId=new Map(data.map(user=>[user.id,user]));
      for(const [id,job] of batch){
       const value=byId.get(id)||null;
       if(started+ttl>now())cache.set('profile:'+id,{value,until:started+ttl});
       job.resolve(value);
      }
      trim();
     }).catch(e=>{for(const [,job] of batch)job.reject(e);});
    }
   });
  }).finally(()=>inflight.delete(key));
  inflight.set(key,promise);return promise;
 };
 return {user:(clerk,id)=>read('user:'+id,()=>clerk.users.getUser(id)),
  session:(clerk,id)=>read('session:'+id,()=>clerk.sessions.getSession(id)),profiles};
}
// Share across Next route bundles as well as ordinary ESM imports. The WeakMap
// keys are SDK clients, keeping instances/credentials isolated without string key leaks.
const shared=Symbol.for("ssg200x.clerkReads");
const clients=globalThis[shared]??=new WeakMap();
export function clerkReads(clerk){
 let reads=clients.get(clerk);if(!reads){reads=createClerkReads();clients.set(clerk,reads);}return reads;
}
