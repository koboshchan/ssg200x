import {appendFileSync} from "node:fs";
function diag(x:Record<string,unknown>){if(process.env.OANDA_OBSERVATION_FILE)appendFileSync("/home/kit/forex-evidence/pipeline.ndjson",JSON.stringify({wall:Date.now(),mono:Number(process.hrtime.bigint()/1000000n),...x})+"\n",{mode:0o600});}
/** One owned HTTP/NDJSON connection. No REST price endpoint exists here. */
export type OandaTick={symbol:string;price:number;at:number;received:number;mono:number};
export type StreamState="unconfigured"|"connecting"|"live"|"disconnected";
export type OandaOptions={symbols:()=>string[];token:string;account:string;leader:()=>boolean;now:()=>number;mono:()=>number;request:typeof fetch;publish:(ticks:OandaTick[],state:StreamState,valid?:()=>boolean)=>Promise<void>;observe?:(tick:OandaTick)=>void};
export function parseOandaPrice(v:unknown,now:number,mono:number):OandaTick|null{
 const p=v as Record<string,unknown>|null;
 if(!p||p.type!=="PRICE"||typeof p.instrument!=="string"||!/^([A-Z]{3})_([A-Z]{3})$/.test(p.instrument)||typeof p.time!=="string"||p.tradeable!==true||p.status!==undefined&&p.status!=="tradeable")return null;
 const at=Date.parse(p.time);if(!Number.isSafeInteger(at)||at>now||now-at>10000)return null;
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
 private controller:AbortController|null=null;private task:Promise<void>|null=null;private generation=0;private signature="";private next=0;private failures=0;private stopped=false;private lastByte=0;
 private quarantine=new OandaQuarantine();private releaseTimer:ReturnType<typeof setTimeout>|undefined;
 private clearPending(){this.quarantine.clear();if(this.releaseTimer)clearTimeout(this.releaseTimer);this.releaseTimer=undefined;}
 readonly ticks=new Map<string,OandaTick>();
 state:StreamState="disconnected";
 constructor(private o:OandaOptions){}
 private async invalidate(){this.clearPending();this.ticks.clear();this.state="disconnected";const g=this.generation;await this.o.publish([],"disconnected",()=>g===this.generation);}
 revoke(){this.clearPending();this.generation++;this.controller?.abort();this.ticks.clear();this.state="disconnected";const g=this.generation;void this.o.publish([],"disconnected",()=>g===this.generation).catch(()=>{});}
 stop(){this.stopped=true;this.revoke();}
 async step(){
  if(this.stopped)return;
  if(!this.o.leader()){this.revoke();return;}
  const pairs=this.o.symbols(),signature=pairs.join(",");
  if(signature!==this.signature){this.signature=signature;this.revoke();this.next=0;}
  if(this.task){if(this.o.mono()-this.lastByte>15000)this.revoke();return;}
  if(this.o.now()<this.next)return;
  if(!this.o.token||!this.o.account){this.state="unconfigured";await this.o.publish([],"unconfigured");this.next=this.o.now()+30000;return;}
  if(!pairs.length)return;
  if(pairs.length>8||new Set(pairs).size!==pairs.length){await this.invalidate();return;}
  const generation=++this.generation,controller=new AbortController();this.controller=controller;this.lastByte=this.o.mono();
  const active=()=>!this.stopped&&generation===this.generation&&this.o.leader()&&!controller.signal.aborted&&this.o.symbols().join(",")===signature;
  const scheduleRelease=()=>{if(this.releaseTimer||!this.quarantine.pending.size)return;
   this.releaseTimer=setTimeout(()=>{this.releaseTimer=undefined;void(async()=>{
    if(!active()){this.clearPending();return;}
    const released=this.quarantine.release(this.o.now(),this.o.mono());
    for(const t of released)if(t.at>(this.ticks.get(t.symbol)?.at??-1)){this.quarantine.pending.delete(t.symbol);this.ticks.set(t.symbol,t);this.state="live";this.failures=0;this.o.observe?.(t);diag({event:"quarantine_release",symbol:t.symbol,originalMono:t.mono,providerAt:t.at});}
    if(released.length&&active())await this.o.publish(this.fresh(),"live",active);
    if(active())scheduleRelease();
   })().catch(()=>{this.revoke();});},this.quarantine.delay(this.o.now(),this.o.mono()));
  };
  this.task=(async()=>{
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
   try{
    this.state="connecting";await this.o.publish([],"connecting",active);
    const url=new URL("https://stream-fxpractice.oanda.com/v3/accounts/"+encodeURIComponent(this.o.account)+"/pricing/stream");
    url.searchParams.set("instruments",pairs.map(s=>s.replace("/","_")).join(","));url.searchParams.set("snapshot","true");
    const response=await this.o.request(url,{headers:{Authorization:"Bearer "+this.o.token},signal:controller.signal,redirect:"error",cache:"no-store"});
    if(!response.ok||!response.body)throw new Error("stream_unavailable");
    reader=response.body.getReader();let buffer="";const decoder=new TextDecoder();
    while(active()){
     const chunk=await reader.read();if(chunk.done)break;if(!active())break;
     this.lastByte=this.o.mono();buffer+=decoder.decode(chunk.value,{stream:true});
     if(buffer.length>1048576)throw new Error("stream_frame_limit");
     let end;
     while((end=buffer.indexOf("\n"))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
      let raw;try{raw=JSON.parse(line);}catch{throw new Error("stream_invalid_frame");}
      diag({event:"consumer_frame",type:raw.type,symbol:typeof raw.instrument==="string"?raw.instrument:undefined,providerAt:typeof raw.time==="string"?Date.parse(raw.time):undefined});if(raw.type==="HEARTBEAT")continue;
      const received=this.o.now(),receiptMono=this.o.mono();const t=parseOandaPrice(raw,received,receiptMono);
      const symbol=typeof raw.instrument==="string"?raw.instrument.replace("_","/"):"";
      if(!pairs.includes(symbol))continue;
      if(!t&&this.quarantine.offer(raw,received,receiptMono,pairs)){diag({event:"quarantine_hold",symbol});scheduleRelease();continue;}
      if(!t){diag({event:"rejected",symbol});this.ticks.delete(symbol);await this.o.publish(this.fresh(),"live",active);continue;}
      if(t.at<=(this.ticks.get(t.symbol)?.at??-1))continue;
      this.quarantine.pending.delete(t.symbol);this.ticks.set(t.symbol,t);this.state="live";this.failures=0;this.o.observe?.(t);
      if(active()){const begin=this.o.mono();diag({event:"publish_begin",symbol:t.symbol});try{await this.o.publish(this.fresh(),"live",active);diag({event:"publish_end",elapsed:this.o.mono()-begin});}catch(error){diag({event:"publish_error",elapsed:this.o.mono()-begin,kind:error instanceof Error?error.name:"unknown"});throw error;}}
     }
    }
   }catch{/* Only sanitized state is published, never provider errors or authenticated URLs. */}
   finally{
    controller.abort();try{await reader?.cancel();}catch{}reader?.releaseLock();
    if(generation===this.generation){await this.invalidate().catch(()=>{});}
    this.next=this.o.now()+Math.min(30000,1000*2**Math.min(this.failures++,5));
    this.task=null;this.controller=null;
   }
  })();
 }
 fresh(){const now=this.o.now(),mono=this.o.mono();return [...this.ticks.values()].filter(t=>now>=t.at&&now-t.at<=10000&&mono>=t.mono&&mono-t.mono<=10000);}
}
