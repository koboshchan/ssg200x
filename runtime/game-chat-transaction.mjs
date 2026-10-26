import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {fail} from './chat-protocol.mjs';
const processOwner=randomUUID();
// All collections used by game chat, including resolver reads, share one snapshot.
// The authoritative main-room write conflicts with EVERY existing version-CAS writer.
export function gameChatTransactions(database,{enforceOwner=false}={}){
 const owner=processOwner;
 const storage=new AsyncLocalStorage();
 let capability;
 const positions={find:1,findOne:1,countDocuments:1,insertOne:1,insertMany:1,updateOne:2,updateMany:2,deleteOne:1,deleteMany:1,findOneAndUpdate:2};
 const db=new Proxy(database,{get(target,key){
  if(key==='collection')return name=>new Proxy(target.collection(name),{get(collection,method){
   const value=collection[method];if(typeof value!=='function')return value;
   if(!(method in positions))return value.bind(collection);
   return (...args)=>{const session=storage.getStore();if(session){const at=positions[method];args[at]={...args[at],session};}return value.apply(collection,args);};
  }});
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
 async function run(fn){
  capability??=database.admin().command({hello:1}).then(hello=>!!hello.setName||hello.msg==='isdbgrid').catch(error=>{capability=undefined;throw error;});
  if(!await capability)fail('context_transactions_required');
  const session=database.client.startSession();
  try{
   // No automatic callback replay of signed mutations or external identity writes.
   session.startTransaction({readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
   const result=await storage.run(session,async()=>{
    if(enforceOwner){
     // One chat runtime owns process-local presence. A second server must not
     // rewrite shared crypto state from a different local roster.
     const leases=db.collection('game_chat_runtime_owner'),now=Date.now();
     try{await leases.updateOne({_id:'single-owner',$or:[{owner},{until:{$lte:now}}]},{$set:{owner,until:now+30000}},{upsert:true});}
     catch(error){if(error.code===11000)fail('chat_owner_conflict');throw error;}
    }
    return fn();
   });await session.commitTransaction();return result;
  }catch(error){
   if(session.inTransaction())await session.abortTransaction().catch(()=>{});
   if(error.code===20||error.codeName==='IllegalOperation')fail('context_transactions_required');
   if(error.hasErrorLabel?.('TransientTransactionError'))fail('stale_revision');
   throw error;
  }finally{await session.endSession();}
 }
 return {db,run};
}
