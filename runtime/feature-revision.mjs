// Baseline = first revision seen this page load. Any later higher revision means
// an admin confirmed a change; stay raised until explicit reload.
export function createFeatureRevisionObserver(onChange){
 let base=null,raised=false;
 return payload=>{
  const rev=payload?.revision;if(typeof rev!=="number"||!Number.isFinite(rev))return;
  if(base===null){base=rev;return;}
  if(!raised&&rev>base){raised=true;onChange(rev);}
 };
}
