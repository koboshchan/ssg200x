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
export class OandaStream{
 private controller:AbortController|null=null;private task:Promise<void>|null=null;private generation=0;private signature="";private next=0;private failures=0;private stopped=false;private lastByte=0;
 readonly ticks=new Map<string,OandaTick>();
 state:StreamState="disconnected";
 constructor(private o:OandaOptions){}
 private async invalidate(){this.ticks.clear();this.state="disconnected";const g=this.generation;await this.o.publish([],"disconnected",()=>g===this.generation);}
 revoke(){this.generation++;this.controller?.abort();this.ticks.clear();this.state="disconnected";const g=this.generation;void this.o.publish([],"disconnected",()=>g===this.generation).catch(()=>{});}
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
  const active=()=>!this.stopped&&generation===this.generation&&this.o.leader()&&!controller.signal.aborted;
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
      if(raw.type==="HEARTBEAT")continue;
      const t=parseOandaPrice(raw,this.o.now(),this.o.mono());
      const symbol=typeof raw.instrument==="string"?raw.instrument.replace("_","/"):"";
      if(!pairs.includes(symbol))continue;
      if(!t){this.ticks.delete(symbol);await this.o.publish(this.fresh(),"live",active);continue;}
      if(t.at<=(this.ticks.get(t.symbol)?.at??-1))continue;
      this.ticks.set(t.symbol,t);this.state="live";this.failures=0;this.o.observe?.(t);
      if(active())await this.o.publish(this.fresh(),"live",active);
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
