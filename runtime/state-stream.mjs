// JSON-only structural patches. No executable paths, inherited keys, or merge setters.
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const forbidden=k=>["__proto__","prototype","constructor"].includes(k);
function safe(value,depth=0){
 if(depth>100)throw Error("state too deep");
 if(value===null||typeof value==="string"||typeof value==="boolean"||typeof value==="number"&&Number.isFinite(value))return;
 if(!value||typeof value!=="object")throw Error("not JSON");
 for(const k of Object.keys(value)){if(forbidden(k))throw Error("unsafe key");safe(value[k],depth+1);}
}
const copy=v=>JSON.parse(JSON.stringify(v));
const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
export function diffState(before,after){
 if(Object.is(before,after))return null;
 if(Array.isArray(before)&&Array.isArray(after)){
  const entries=[];
  for(let i=0;i<after.length;i++){const p=i<before.length?diffState(before[i],after[i]):{op:"replace",value:after[i]};if(p)entries.push([i,p]);}
  return entries.length||before.length!==after.length?{op:"array",length:after.length,entries}:null;
 }
 if(object(before)&&object(after)){
  const remove=Object.keys(before).filter(k=>!own(after,k)),entries=[];
  for(const k of Object.keys(after)){if(forbidden(k))throw Error("unsafe key");const p=own(before,k)?diffState(before[k],after[k]):{op:"replace",value:after[k]};if(p)entries.push([k,p]);}
  return remove.length||entries.length?{op:"object",remove,entries}:null;
 }
 return {op:"replace",value:after};
}
export function applyPatch(before,patch,depth=0){
 if(!patch||depth>100)throw Error("bad patch");
 if(patch.op==="replace"){safe(patch.value);return copy(patch.value);}
 if(!Array.isArray(patch.entries))throw Error("bad entries");
 if(patch.op==="array"){
  if(!Array.isArray(before)||!Number.isSafeInteger(patch.length)||patch.length<0||patch.length>100000)throw Error("bad array");
  const result=before.slice(0,patch.length),seen=new Set();result.length=patch.length;
  for(const [i,p] of patch.entries){if(!Number.isSafeInteger(i)||i<0||i>=patch.length||seen.has(i))throw Error("bad index");seen.add(i);result[i]=applyPatch(before[i],p,depth+1);}
  for(let i=0;i<result.length;i++)if(!own(result,i))throw Error("sparse array");
  return result;
 }
 if(patch.op==="object"&&object(before)&&Array.isArray(patch.remove)){
  const result={...before},seen=new Set();
  for(const k of patch.remove){if(typeof k!=="string"||forbidden(k)||seen.has(k))throw Error("bad deletion");seen.add(k);delete result[k];}
  for(const [k,p] of patch.entries){if(typeof k!=="string"||forbidden(k)||seen.has(k))throw Error("bad key");seen.add(k);result[k]=applyPatch(own(before,k)?before[k]:undefined,p,depth+1);}
  return result;
 }
 throw Error("bad patch");
}
export const STATE_STREAMS=["maintenance:state","room:state","market:update","candles:state"];
const senders=new WeakMap();
export function resetStream(socket,event){senders.get(socket)?.delete(event);}
export function emitState(socket,event,value,force=false,now=Date.now()){
 if(!STATE_STREAMS.includes(event))throw Error("unknown stream");
 let streams=senders.get(socket);if(!streams){streams=new Map();senders.set(socket,streams);}
 // JSON normalization also isolates the baseline from subsequent producer mutation.
 const next=copy(value);safe(next);
 const previous=streams.get(event);
 const full=force||!previous||now-previous.fullAt>=8000;
 const patch=full?null:diffState(previous.value,next);
 if(!full&&!patch)return false;
 const version=full?(previous?.version||0)+1:previous.version,seq=(previous?.seq||0)+1;
 socket.emit(event,full?{type:"full",seq,snapshotVersion:version,data:next}:{type:"diff",seq,snapshotVersion:version,patch});
 streams.set(event,{value:next,version,seq,fullAt:full?now:previous.fullAt});
 return true;
}
// A rejected diff invalidates the entire baseline; later diffs cannot mask a gap.
export function createStateReceiver(requestFull,now=Date.now){
 const states=new Map(),requested=new Map();
 return {
  clear(){states.clear();requested.clear();},
  receive(event,message){
   if(!STATE_STREAMS.includes(event))return {ok:false};
   try{
    if(!message||!Number.isSafeInteger(message.seq)||message.seq<1||!Number.isSafeInteger(message.snapshotVersion)||message.snapshotVersion<1)throw Error("bad sequence");
    const previous=states.get(event);
    let value;
    if(message.type==="full"){safe(message.data);value=copy(message.data);}
    else if(message.type==="diff"&&previous&&message.snapshotVersion===previous.version&&message.seq===previous.seq+1)value=applyPatch(previous.value,message.patch);
    else throw Error("missing baseline");
    states.set(event,{value,seq:message.seq,version:message.snapshotVersion});requested.delete(event);
    return {ok:true,value};
   }catch{
    states.delete(event);
    if(now()-(requested.get(event)??-Infinity)>=1000){requested.set(event,now());requestFull(event);}
    return {ok:false};
   }
  }
 };
}
