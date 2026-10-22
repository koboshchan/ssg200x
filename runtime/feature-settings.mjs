import {resolveFeatures} from './feature-catalog.mjs';
const slot=Symbol.for('ssg.featureSettings');
// An initial database read is mandatory before callers start any network worker.
// Polling works on standalone Mongo as well as replica sets, with one read in flight.
export function createFeatureSettings(collection,{env=process.env,pollMs=500,onError=()=>{}}={}){
 let features=Object.freeze(resolveFeatures({},env)),raw={},pending=null,timer=null,stopped=false,revision=0;
 const listeners=new Set();
 function apply(value,nextRevision){
  raw=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const next=Object.freeze(resolveFeatures(raw,env));
  nextRevision=Number.isSafeInteger(nextRevision)&&nextRevision>=0?nextRevision:0;
  if(nextRevision===revision&&Object.keys(next).every(key=>next[key]===features[key]))return;
  revision=nextRevision;
  const previous=features;features=next;
  for(const listener of listeners)try{listener(next,previous);}catch(error){onError(error);}
 }
 async function refresh(){
  if(stopped)return features;
  if(pending)return pending;
  pending=(async()=>{const document=await collection.findOne({_id:'global'});if(!stopped)apply(document?.features,document?.revision);return features;})();
  try{return await pending;}finally{pending=null;}
 }
 const ready=refresh();
 // Last-known-good settings survive transient DB errors; never revert an explicit
 // disable to a permissive default just because Mongo is temporarily unavailable.
 timer=setInterval(()=>{void refresh().catch(onError);},pollMs);timer.unref?.();
 return{ready,refresh,current:()=>features,snapshot:()=>({features,revision}),enabled:key=>features[key]===true,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  stop(){stopped=true;clearInterval(timer);listeners.clear();}};
}
export function getFeatureSettings(collection,options){
 if(!globalThis[slot]){
  if(!collection)throw new Error('Feature settings must be initialized before starting workers');
  globalThis[slot]=createFeatureSettings(collection,options);
 }
 return globalThis[slot];
}
