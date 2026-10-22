import {FEATURE_DEFAULTS} from './feature-catalog.mjs';
// CAS revision lives in the same document as flags and the append-only audit.
// A stale confirmation never overwrites a concurrent admin's newer choices.
export async function confirmFeatureChange(collection,{features,expectedRevision,actor,at,id}){
 const current=await collection.findOne({_id:'global'});
 if((current?.revision??0)!==expectedRevision)return false;
 // Compare configured flags, not deployment force-off overrides. A no-op has
 // a read linearization point and creates neither revision nor audit entry.
 const changed=Object.fromEntries(Object.entries(features).filter(([key,value])=>typeof value==='boolean'&&value!==(current?.features?.[key]??FEATURE_DEFAULTS[key])));
 if(!Object.keys(changed).length)return true;
 const filter={_id:'global',...(expectedRevision===0?{$or:[{revision:0},{revision:{$exists:false}}]}:{revision:expectedRevision})};
 const fields=Object.fromEntries(Object.entries(changed).map(([key,value])=>['features.'+key,value]));
 try{
  const result=await collection.updateOne(filter,{$set:fields,$inc:{revision:1},$push:{audit:{id,who:actor,at,patch:changed}}},{upsert:expectedRevision===0});
  return !!(result.matchedCount||result.upsertedCount);
 }catch(error){if(error?.code===11000)return false;throw error;}
}
