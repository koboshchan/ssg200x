// Baseline = first revision seen this page load. Any later higher revision means
// an admin confirmed a change; stay raised until explicit reload.
export function createFeatureRevisionObserver(onChange){
 let base=null,raised=false;
 return payload=>{
  const rev=payload?.revision;if(typeof rev!=="number"||!Number.isSafeInteger(rev)||rev<0)return;
  if(base===null){base=rev;return;}
  if(!raised&&rev>base){raised=true;onChange(rev);}
 };
}


// Public polling is independent of authentication and app sockets. A failed
// request must never establish a baseline or clear an already raised notice.
export function createFeatureRevisionCheck(observe,fetcher=fetch){
 let pending;
 return ()=>pending??=Promise.resolve().then(()=>fetcher("/api/features",{
  cache:"no-store",credentials:"same-origin",signal:AbortSignal.timeout(8000),
 })).then(async response=>{if(response.ok)observe(await response.json());})
  .catch(()=>{}).finally(()=>{pending=undefined;});
}
