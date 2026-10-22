// Public GETs only. Limits checked against https://docs.polymarket.com/api-reference/rate-limits
// 2026-10-22. Conservative shared budgets also cover metadata, settlement and cold history.
const GAMMA='https://gamma-api.polymarket.com',CLOB='https://clob.polymarket.com',DATA='https://data-api.polymarket.com';
const unavailable=()=>Object.assign(new Error('Prediction data unavailable. Try again.'),{status:503});
export function publicFamily(path){
 const u=new URL(path);if(u.username||u.password||u.hash||u.href.length>4096)throw unavailable();
 if(u.origin===GAMMA){
  if(/^\/markets(?:\/\d{1,24})?$/.test(u.pathname))return 'markets';
  if(/^\/events(?:\/keyset|\/\d{1,24})?$/.test(u.pathname))return 'events';
  if(u.pathname==='/public-search')return 'search';
 }
 if(u.origin===CLOB){
  if(u.pathname==='/prices-history')return 'history';
  if(/^\/markets\/0x[\da-fA-F]{64}$/.test(u.pathname))return 'clobMarkets';
 }
 if(u.origin===DATA&&u.pathname==='/v2/resolutions')return 'resolutions';
 throw unavailable(); // No auth endpoints, private orders, arbitrary hosts or redirect escape.
}
export function retryAfterMs(value,now){
 if(value===null)return 0;
 const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return seconds*1000;
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(0,date-now):0;
}
export function createPolymarketPublic({fetcher=(...args)=>fetch(...args),now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),random=Math.random,windowMs=10000,budgets={all:100,markets:40,events:50,search:50,history:30,clobMarkets:40,resolutions:40},spacingMs=20,maxWaitMs=3000,maxRetries=2,maxSlots=512,maxPending=64}={}){
 const slots=new Map(),windows=new Map(),cooldowns=new Map();let active=0,nextAt=0;
 function reserve(family,origin){
  const at=now();if((cooldowns.get(origin)||0)>at)throw unavailable();
  for(const key of ['all',family]){const recent=(windows.get(key)||[]).filter(t=>t>at-windowMs);windows.set(key,recent);if(recent.length>=budgets[key])throw unavailable();}
  for(const key of ['all',family])windows.get(key).push(at);
 }
 async function attempt(path,family){
  const origin=new URL(path).origin;
  for(let retry=0;;retry++){
   const wait=Math.max(0,nextAt-now(),(cooldowns.get(origin)||0)-now());if(wait>maxWaitMs)throw unavailable();
   // Assign a unique time before awaiting. Distinct pending queries cannot wake as a burst.
   const assigned=now()+wait;nextAt=assigned+spacingMs;
   if(wait)await sleep(wait);
   reserve(family,origin);
   const response=await fetcher(path,{method:'GET',signal:AbortSignal.timeout(6000),cache:'no-store',redirect:'error',credentials:'omit',headers:{Accept:'application/json'}});
   if(response.status===429){
    const delay=Math.max(retryAfterMs(response.headers.get('retry-after'),now()),Math.min(8000,500*2**retry))+Math.floor(random()*250);
    cooldowns.set(origin,Math.max(cooldowns.get(origin)||0,now()+delay));
    await response.body?.cancel();if(retry>=maxRetries)throw unavailable();continue;
   }
   if(!response.ok){await response.body?.cancel();throw unavailable();}
   const reader=response.body?.getReader();if(!reader)throw unavailable();let size=0,body='';const decoder=new TextDecoder();
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>6_000_000)throw unavailable();body+=decoder.decode(part.value,{stream:true});}body+=decoder.decode();}finally{await reader.cancel();}
   return JSON.parse(body);
  }
 }
 async function get(path,ttl=3000,fresh=false){
  const family=publicFamily(path),old=slots.get(path),at=now();
  if(old?.pending)return structuredClone(await old.pending);
  // Error cooldown cannot be bypassed by a fresh trade/settlement read.
  if(old&&old.until>at&&(old.error||!fresh)){if(old.error)throw unavailable();return structuredClone(old.value);}
  if(active>=maxPending)throw unavailable();
  if(slots.size>=maxSlots&&!slots.has(path)){let removed=false;for(const [key,value]of slots)if(!value.pending){slots.delete(key);removed=true;break;}if(!removed)throw unavailable();}
  const slot={until:0};slots.set(path,slot);active++;
  const work=attempt(path,family).then(value=>{slot.value=value;slot.until=now()+Math.min(60000,Math.max(0,ttl));return value;},()=>{slot.error=true;slot.until=now()+2000;throw unavailable();}).finally(()=>{slot.pending=null;active--;});
  slot.pending=work;return structuredClone(await work);
 }
 return{get,diagnostics:()=>({active,slots:slots.size,windows:Object.fromEntries([...windows].map(([k,v])=>[k,v.length])),cooldowns:Object.fromEntries(cooldowns)})};
}
