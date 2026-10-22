import {randomUUID} from "node:crypto";
import {appendFileSync} from "node:fs";
function diag(x:Record<string,unknown>){if(process.env.OANDA_OBSERVATION_FILE)appendFileSync("/home/kit/forex-evidence/pipeline.ndjson",JSON.stringify({wall:Date.now(),mono:Number(process.hrtime.bigint()/1000000n),...x})+"\n",{mode:0o600});}
/** One owned HTTP/NDJSON connection. No REST price endpoint exists here. */
export type OandaTick={symbol:string;price:number;at:number;received:number;mono:number;generation?:string};
export type OandaHealth={generation:string;lastFrameWall:number;lastFrameMono:number};
export type StreamState="unconfigured"|"connecting"|"live"|"disconnected";
export type OandaOptions={symbols:()=>string[];token:string;account:string;leader:()=>boolean;now:()=>number;mono:()=>number;request:typeof fetch;publish:(ticks:OandaTick[],state:StreamState,valid?:()=>boolean,health?:OandaHealth)=>Promise<void>;observe?:(tick:OandaTick)=>void;debounceMs?:number;minReconnectMs?:number;random?:()=>number;log?:(event:Record<string,unknown>)=>void};
export function parseOandaPrice(v:unknown,now:number,mono:number):OandaTick|null{
 const p=v as Record<string,unknown>|null;
 if(!p||p.type!=="PRICE"||typeof p.instrument!=="string"||!/^([A-Z]{3})_([A-Z]{3})$/.test(p.instrument)||typeof p.time!=="string"||p.tradeable!==true||p.status!==undefined&&p.status!=="tradeable")return null;
 const at=Date.parse(p.time);if(!Number.isSafeInteger(at)||at>now)return null;
 const side=(a:unknown)=>Array.isArray(a)?a.filter(x=>x&&Number.isFinite(Number(x.price))&&Number(x.price)>0&&Number.isFinite(x.liquidity)&&x.liquidity>0).map(x=>Number(x.price)):[];
 const bids=side(p.bids),asks=side(p.asks);if(!bids.length||!asks.length)return null;
 const bid=Math.max(...bids),ask=Math.min(...asks);if(bid>ask)return null;
 // Midpoint of best liquid bid and ask, same policy for marks and candles.
 return {symbol:p.instrument.replace("_","/"),price:(bid+ask)/2,at,received:now,mono};
}
/** Bounded future-frame holding area. Original receipt clocks never change. */
export class OandaQuarantine {
 readonly pending=new Map<string,{raw:unknown;received:number;mono:number;at:number;deadline:number}>();
 offer(raw:unknown,received:number,mono:number,symbols:string[]){
  const r=raw as {instrument?:string;time?:string};const symbol=r?.instrument?.replace("_","/")??"",at=Date.parse(r?.time??"");
  if(!symbols.includes(symbol)||symbols.length>8||!Number.isFinite(at)||at<=received||at-received>2000||!parseOandaPrice(raw,at,mono))return false;
  const old=this.pending.get(symbol);if(old&&old.at>=at)return true;
  if(!old&&this.pending.size>=8)return false;
  this.pending.set(symbol,{raw,received,mono,at,deadline:mono+2000});return true;
 }
 release(now:number,mono:number){const out:OandaTick[]=[];for(const [s,p]of this.pending){
  if(mono<p.mono||mono>p.deadline||mono-p.mono>=10000||now-p.at>10000||mono===p.deadline&&now<p.at){this.pending.delete(s);continue;}
  if(now<p.at)continue;
  this.pending.delete(s);const t=parseOandaPrice(p.raw,now,mono);if(t)out.push({...t,received:p.received,mono:p.mono});
 }return out;}
 delay(now:number,mono:number){return Math.max(10,Math.min(1000,...[...this.pending.values()].map(p=>Math.min(Math.max(10,p.at-now),p.deadline-mono))));}
 clear(){this.pending.clear();}
}
export class OandaStream{
 private controller:AbortController|null=null;private task:Promise<void>|null=null;private generation=0;private signature="";private next=0;private failures=0;private stopped=false;private lastByte=0;private requestStarted=0;
 private revoked=false;private desiredSince=0;private initialized=false;private lastAttempt=Number.NEGATIVE_INFINITY;private reader:ReadableStreamDefaultReader<Uint8Array>|undefined;private retiring:Promise<void>|null=null;
 private identity=randomUUID();private lastFrameWall=0;private lastFrameMono=-1;private lastPublish=0;private refreshing=false;
 private health():OandaHealth{return {generation:this.identity+":"+this.generation,lastFrameWall:this.lastFrameWall,lastFrameMono:this.lastFrameMono};}
 private publish(ticks:OandaTick[],state:StreamState,valid?:()=>boolean){return this.o.publish(ticks,state,valid,this.health());}
 private quarantine=new OandaQuarantine();private releaseTimer:ReturnType<typeof setTimeout>|undefined;
 private clearPending(){this.quarantine.clear();if(this.releaseTimer)clearTimeout(this.releaseTimer);this.releaseTimer=undefined;}
 readonly ticks=new Map<string,OandaTick>();
 state:StreamState="disconnected";
 constructor(private o:OandaOptions){}
 private pairs(){return [...this.o.symbols()].sort();}
 private log(event:string,fields:Record<string,unknown>={}){
  // Only fixed event/reason codes and numeric HTTP status are emitted. Never URLs,
  // credentials, response bodies, or arbitrary Error messages (including causes).
  const entry={provider:"oanda",event,generation:this.health().generation,...fields};
  if(this.o.log)this.o.log(entry);else console.info(JSON.stringify(entry));
 }
 private errorFields(error:unknown){
  const kind=error instanceof Error&&["TypeError","AbortError","TimeoutError","SyntaxError"].includes(error.name)?error.name:"Error";
  const e=error as {code?:unknown;cause?:{code?:unknown}}|null;
  const code=e?.code??e?.cause?.code;
  return {kind,...(typeof code==="string"&&["ECONNRESET","ETIMEDOUT","ECONNREFUSED","ENOTFOUND","EAI_AGAIN","ABORT_ERR","UND_ERR_SOCKET","UND_ERR_CONNECT_TIMEOUT"].includes(code)?{code}:{})};
 }
 private minReconnect(){return this.o.minReconnectMs??1000;}
 private retryDelay(){const base=Math.min(24000,1000*2**Math.min(this.failures++,5));return Math.max(this.minReconnect(),Math.min(30000,base+Math.floor(base*.25*(this.o.random??Math.random)())));}

 private async invalidate(){this.clearPending();this.ticks.clear();this.state="disconnected";const g=this.generation;await this.publish([],"disconnected",()=>g===this.generation);}
 revoke(reason="revoked"):Promise<void>{
  if(this.retiring)return this.retiring;
  if(this.revoked&&!this.task&&!this.ticks.size)return Promise.resolve();
  this.revoked=true;
  this.clearPending();this.generation++;this.ticks.clear();this.state="disconnected";
  this.log("abort",{reason:["revoked","stopped","lease_lost","reconfigure","watchdog","handshake_timeout","release_failure"].includes(reason)?reason:"revoked"});
  const g=this.generation,task=this.task,reader=this.reader;
  this.controller?.abort(reason);
  // Abort does not guarantee a custom/slow reader has finished canceling. The
  // connection task owns releaseLock and must finish before step can reconnect.
  const cancel=reader?.cancel().catch(()=>{});
  const pending=Promise.all([task,cancel,this.publish([],"disconnected",()=>g===this.generation).catch(()=>{})]).then(()=>{});
  this.retiring=pending;
  void pending.finally(()=>{if(this.retiring===pending)this.retiring=null;});
  return pending;
 }
 stop(){this.stopped=true;return this.revoke("stopped");}
 async step(){
  if(this.stopped)return;
  if(!this.o.leader()){if(this.task||this.ticks.size)void this.revoke("lease_lost");return;}
  const pairs=this.pairs(),signature=pairs.join(",");
  if(!this.initialized){this.initialized=true;this.signature=signature;this.desiredSince=this.o.mono()-(this.o.debounceMs??5000);}
  else if(signature!==this.signature){
   this.signature=signature;this.desiredSince=this.o.mono();this.failures=0;this.next=0;
   void this.revoke("reconfigure");
  }
  if(this.retiring)return;
  if(this.task){
   const established=this.lastFrameMono>=0;const idleMs=this.o.mono()-(established?this.lastByte:this.requestStarted);const limit=established?15000:60000;
   if(idleMs>limit){diag({event:established?"watchdog_revoke":"handshake_timeout",idleMs});void this.revoke(established?"watchdog":"handshake_timeout");return;}
   if(this.state==="live"&&!this.refreshing&&this.o.mono()-this.lastPublish>=1000){
    this.refreshing=true;this.lastPublish=this.o.mono();const g=this.generation;
    try{await this.publish(this.fresh(),"live",()=>g===this.generation&&this.o.leader()&&!this.controller?.signal.aborted);}catch(error){this.log("failure",{reason:"publication",...this.errorFields(error)});void this.revoke("release_failure");}finally{this.refreshing=false;}
   }return;
  }
  if(this.o.mono()<this.next||this.o.mono()-this.lastAttempt<this.minReconnect()||this.o.mono()-this.desiredSince<(this.o.debounceMs??5000))return;
  if(!this.o.token||!this.o.account){this.state="unconfigured";await this.publish([],"unconfigured");this.next=this.o.mono()+30000;return;}
  if(!pairs.length)return;
  if(pairs.length>8||new Set(pairs).size!==pairs.length){await this.invalidate();return;}
  this.revoked=false;this.lastAttempt=this.o.mono();
  const generation=++this.generation,controller=new AbortController();this.controller=controller;this.requestStarted=this.o.mono();this.lastByte=this.requestStarted;this.lastFrameMono=-1;this.lastFrameWall=0;
  const active=()=>!this.stopped&&generation===this.generation&&this.o.leader()&&!controller.signal.aborted&&this.pairs().join(",")===signature;
  const scheduleRelease=()=>{if(this.releaseTimer||!this.quarantine.pending.size)return;
   this.releaseTimer=setTimeout(()=>{this.releaseTimer=undefined;void(async()=>{
    if(!active()){this.clearPending();return;}
    const released=this.quarantine.release(this.o.now(),this.o.mono());
    for(const t of released)if(t.at>(this.ticks.get(t.symbol)?.at??-1)){this.quarantine.pending.delete(t.symbol);this.ticks.set(t.symbol,{...t,generation:this.health().generation});this.state="live";this.failures=0;this.o.observe?.(t);diag({event:"quarantine_release",symbol:t.symbol,originalMono:t.mono,providerAt:t.at});}
    if(released.length&&active())await this.publish(this.fresh(),"live",active);
    if(active())scheduleRelease();
   })().catch(error=>{this.log("failure",{reason:"publication",...this.errorFields(error)});void this.revoke("release_failure");});},this.quarantine.delay(this.o.now(),this.o.mono()));
  };
  this.task=(async()=>{
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;let failure="eof",httpStatus:number|undefined;
   const log=(event:string,fields:Record<string,unknown>={})=>this.log(event,{...fields,generation:this.identity+":"+generation});
   const publish:typeof this.publish=async(...args)=>{try{await this.publish(...args);}catch(error){failure="publication";throw error;}};
   try{
    log("connect");this.state="connecting";await publish([],"connecting",active);
    if(!active())return;
    const url=new URL("https://stream-fxpractice.oanda.com/v3/accounts/"+encodeURIComponent(this.o.account)+"/pricing/stream");
    url.searchParams.set("instruments",pairs.map(s=>s.replace("/","_")).join(","));url.searchParams.set("snapshot","true");
    const response=await this.o.request(url,{headers:{Authorization:"Bearer "+this.o.token},signal:controller.signal,redirect:"error",cache:"no-store"});
    httpStatus=response.status;
    if(!active()){await response.body?.cancel();return;}
    if(!response.ok||!response.body){failure=response.ok?"missing_body":"http";await response.body?.cancel();throw new Error("stream_unavailable");}
    log("response",{status:httpStatus});
    reader=response.body.getReader();this.reader=reader;let buffer="";const decoder=new TextDecoder();
    while(active()){
     const chunk=await reader.read();if(chunk.done)break;if(!active())break;
     buffer+=decoder.decode(chunk.value,{stream:true});
     if(buffer.length>1048576){failure="frame_limit";throw new Error("stream_frame_limit");}
     let end;
     while((end=buffer.indexOf("\n"))>=0){
      if(!active())break;
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
      let raw;try{raw=JSON.parse(line);}catch{failure="invalid_frame";throw new Error("stream_invalid_frame");}
      diag({event:"consumer_frame",type:raw.type,symbol:typeof raw.instrument==="string"?raw.instrument:undefined,providerAt:typeof raw.time==="string"?Date.parse(raw.time):undefined});if(raw.type==="HEARTBEAT"||raw.type==="PRICE"){this.lastByte=this.o.mono();this.lastFrameMono=this.lastByte;this.lastFrameWall=this.o.now();}
      if(raw.type==="HEARTBEAT"){if(this.state==="live"&&active())await publish(this.fresh(),"live",active);continue;}
      const received=this.o.now(),receiptMono=this.o.mono();const t=parseOandaPrice(raw,received,receiptMono);
      const symbol=typeof raw.instrument==="string"?raw.instrument.replace("_","/"):"";
      if(!pairs.includes(symbol))continue;
      if(!t&&this.quarantine.offer(raw,received,receiptMono,pairs)){diag({event:"quarantine_hold",symbol});scheduleRelease();continue;}
      if(!t){diag({event:"rejected",symbol});this.quarantine.pending.delete(symbol);this.ticks.delete(symbol);await publish(this.fresh(),"live",active);continue;}
      if(t.at<=(this.ticks.get(t.symbol)?.at??-1))continue;
      this.quarantine.pending.delete(t.symbol);this.ticks.set(t.symbol,{...t,generation:this.health().generation});this.state="live";this.failures=0;this.o.observe?.(t);
      if(active()){const begin=this.o.mono();diag({event:"publish_begin",symbol:t.symbol});try{await publish(this.fresh(),"live",active);diag({event:"publish_end",elapsed:this.o.mono()-begin});}catch(error){failure="publication";diag({event:"publish_error",elapsed:this.o.mono()-begin,kind:error instanceof Error?error.name:"unknown"});throw error;}}
     }
    }
   }catch(error){
    if(failure==="eof")failure="transport";
    // Error names are allowlisted. Error.message/cause may contain the auth URL.
    if(!controller.signal.aborted)log("failure",{reason:failure,...this.errorFields(error),...(httpStatus===undefined?{}:{status:httpStatus})});
   }
   finally{
    const intentional=controller.signal.aborted;
    const reason=controller.signal.reason;
    if(!intentional&&failure==="eof")log("eof",{status:httpStatus});
    controller.abort();
    try{await reader?.cancel();}catch{}finally{try{reader?.releaseLock();}catch{}if(this.reader===reader)this.reader=undefined;}
    if(generation===this.generation)await this.invalidate().catch(()=>{});
    // Reconfiguration/lease loss are not provider failures and cannot overwrite
    // the new desired configuration's reconnect schedule.
    if(signature===this.signature&&(!intentional||reason==="watchdog"||reason==="handshake_timeout"||reason==="release_failure"))this.next=this.o.mono()+this.retryDelay();
    if(this.controller===controller){this.task=null;this.controller=null;}
    log("cleanup",{intentional,reason:intentional&&typeof reason==="string"&&["revoked","stopped","lease_lost","reconfigure","watchdog","handshake_timeout","release_failure"].includes(reason)?reason:failure});
   }
  })();
 }
 fresh(){if(this.stopped||!this.o.leader()||this.controller?.signal.aborted||this.pairs().join(",")!==this.signature)return [];const now=this.o.now(),mono=this.o.mono();if(this.lastFrameMono<0||mono<this.lastFrameMono||mono-this.lastFrameMono>15000)return [];return [...this.ticks.values()].filter(t=>t.generation===this.health().generation&&now>=t.at&&now>=t.received&&mono>=t.mono);}
}
