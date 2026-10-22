// CAS revision lives in the same document as flags and the append-only audit.
// A stale confirmation never overwrites a concurrent admin's newer choices.
export async function confirmFeatureChange(collection,{features,expectedRevision,actor,at,id}){
 const filter={_id:'global',...(expectedRevision===0?{$or:[{revision:0},{revision:{$exists:false}}]}:{revision:expectedRevision})};
 const fields=Object.fromEntries(Object.entries(features).map(([key,value])=>['features.'+key,value]));
 try{
  const result=await collection.updateOne(filter,{$set:fields,$inc:{revision:1},$push:{audit:{id,who:actor,at,patch:features}}},{upsert:expectedRevision===0});
  return !!(result.matchedCount||result.upsertedCount);
 }catch(error){if(error?.code===11000)return false;throw error;}
}
