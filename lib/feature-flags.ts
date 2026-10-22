import {randomUUID} from 'node:crypto';
import {db,readRoom} from './db';
import {ensure} from './errors';
import {FEATURE_DEFAULTS,resolveFeatures,featureForPath,type FeatureKey} from './feature-catalog';
import {stockSymbol,forexSymbol} from './symbol-registry';
import type {Identity} from './types';
type FlagDocument={_id:string;features?:Partial<Record<FeatureKey,boolean>>;revision?:number;audit?:unknown[]};
export async function featureSnapshot(){
 const collection=(await db()).collection<FlagDocument>('featureFlags');
 const doc=await collection.findOne({_id:'global'});
 return {features:resolveFeatures(doc?.features),configured:{...FEATURE_DEFAULTS,...doc?.features},revision:doc?.revision??0,forcedOff:(process.env.SSG_FEATURES_FORCE_OFF??'').split(',').map(x=>x.trim()).filter(x=>x in FEATURE_DEFAULTS)};
}
export async function changeFeatures(who:Identity,patch:Partial<Record<FeatureKey,boolean>>){
 ensure(who.admin,'Administrator access required.',403);
 const c=(await db()).collection<FlagDocument>('featureFlags');
 const fields=Object.fromEntries(Object.entries(patch).map(([k,v])=>['features.'+k,v]));
 // The flag change and its append-only audit entry share one Mongo atomic write.
 await c.updateOne({_id:'global'},{$set:fields,$inc:{revision:1},$push:{audit:{id:randomUUID(),who:who.id,at:Date.now(),patch}}},{upsert:true});
 return featureSnapshot();
}
export async function requireFeature(key:FeatureKey){ensure((await featureSnapshot()).features[key],'Temporarily disabled.',503);}
/** Entry is blocked, not exits. Existing hands and claims can finish without a new buy-in. */
export async function enforceFeatureRequest(path:string,method:string,input:Record<string,unknown>={},userId?:string,dependencies={snapshot:featureSnapshot,room:readRoom}){
 if(path.startsWith('/api/admin/')||path==='/api/features')return;
 const {features:f}=await dependencies.snapshot();
 const need=(key:FeatureKey)=>ensure(f[key],'Temporarily disabled.',503);
 const type=input.type??input.action;
 if(path==='/api/finance'){
  if(type!=='open'&&type!=='increase'&&!(type==='spot'&&input.side==='buy'))return;
  const room=await dependencies.room();let symbol=String(input.symbol??'');
  if(type==='increase')symbol=room.members.find(m=>m.id===userId)?.positions?.find(p=>p.id===input.positionId)?.symbol??'';
  need(forexSymbol(symbol,room)?'forex':stockSymbol(symbol,room)?'stocks':type==='spot'?'cryptoSpot':'cryptoPerps');return;
 }
 if(path==='/api/games'){
  if(method==='GET'||type!=='start')return;
  need('games');if(typeof input.game==='string'&&input.game in FEATURE_DEFAULTS)need(input.game as FeatureKey);return;
 }
 if(path==='/api/action'){if(type==='join'||type==='ready'||type==='resume')need('poker');return;}
 if(path==='/api/blackjack'){if(type==='join'||type==='bet')need('blackjack');return;}
 if(path==='/api/doudizhu'){if(type==='join'||type==='create'||type==='ready')need('doudizhu');return;}
 if(path==='/api/roulette'){if(type!=='cancel')need('roulette');return;}
 if(path==='/api/transfers'){
  if(method==='GET'||type==='cancel')return;
  need('transfers');if(type==='send')need('payments');return;
 }
 if(path.startsWith('/api/polymarket')){
  // Keep portfolio/settlement and selling available. Public market reads also support exiting.
  if(method==='GET'||type==='sell')return;
  need('polymarket');return;
 }
 const key=featureForPath(path);if(key)need(key);
}
