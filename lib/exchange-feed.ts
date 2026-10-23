import {randomUUID} from "node:crypto";
import {CRYPTO_HEALTH_MS,type CryptoStatus} from "./crypto-policy";
import {SYMBOLS} from "./market-shared";
export type Tick={symbol:string;micro:number;at:number;sequence:number;cryptoGeneration?:string};
type Socket=Pick<WebSocket,"send"|"close"|"readyState"|"onopen"|"onmessage"|"onerror"|"onclose">;
import {STALE_MS} from "./price-policy";
export {STALE_MS} from "./price-policy";
export const FUTURE_SKEW_MS=1000;
export class ExchangeFeed {
 private socket?:Socket;
 private subscribed:string[]=[];
 private symbols(){return this.deps.symbols?.()??SYMBOLS;}
 private sync(){
  const symbols=[...this.symbols()],ws=this.socket;
  if(!ws||ws.readyState!==1)return;
  const removed=this.subscribed.filter(s=>!symbols.includes(s)),added=symbols.filter(s=>!this.subscribed.includes(s));
  if(removed.length)ws.send(JSON.stringify({type:"unsubscribe",product_ids:removed.map(s=>s+"-USD"),channels:["ticker","heartbeat"]}));
  if(added.length)ws.send(JSON.stringify({type:"subscribe",product_ids:added.map(s=>s+"-USD"),channels:["ticker","heartbeat"]}));
  this.subscribed=symbols;
 }
 private queue:Tick[]=[];
 private draining=false;
 private stopped=false;
 private retryAt=0;
 private attempts=0;
 private lastMessage=0;
 private lastHeartbeat=0;
 private heartbeatSubscribed=false;
 private generation=randomUUID();
 health(leaseUntil:number):CryptoStatus{return {connected:this.connected&&!this.stopped,heartbeatSubscribed:this.heartbeatSubscribed,generation:this.generation,lastMessage:this.lastHeartbeat,leaseUntil};}
 private unknown=new Set<string>();
 private seen=new Map<string,{sequence:number;at:number}>();
 private startedAt:number;
 readonly latest=new Map<string,number>();
 constructor(private deps:{socket:()=>Socket;apply:(ticks:Tick[])=>Promise<void>;now?:()=>number;symbols?:()=>readonly string[];log?:(message:string)=>void},private capacity=4096){this.startedAt=this.now();}
 private now(){return this.deps.now?.()??Date.now();}
 private log(s:string){this.deps.log?.(s);}
 staleSymbols(){const now=this.now();return this.symbols().filter(s=>now-(this.latest.get(s)??this.startedAt)>STALE_MS);}
 get connected(){return this.socket?.readyState===1;}
 get pending(){return this.queue.length;}
 step(){
  if(this.stopped)return;
  this.sync();
  if(this.socket && this.now()-(this.lastHeartbeat||this.lastMessage)>CRYPTO_HEALTH_MS){this.disconnect("stalled");}
  if(!this.socket&&this.now()>=this.retryAt)this.connect();
 }
 private disconnect(reason:string){
  const ws=this.socket;this.socket=undefined;this.heartbeatSubscribed=false;
  if(ws){ws.onopen=ws.onmessage=ws.onclose=ws.onerror=null;ws.close();}
  this.retryAt=this.now()+Math.min(30_000,500*2**Math.min(6,this.attempts++));
  this.log("Coinbase feed "+reason);
 }
 private connect(){
  this.lastMessage=this.now();this.generation=randomUUID();this.lastHeartbeat=0;this.heartbeatSubscribed=false;this.seen.clear();
  try{
   const ws=this.deps.socket();this.socket=ws;
   ws.onopen=()=>{if(this.socket!==ws)return;this.subscribed=[];this.sync();};
   ws.onmessage=e=>{if(this.socket===ws)this.receive(String(e.data));};
   ws.onclose=()=>{if(this.socket===ws)this.disconnect("closed");};
   ws.onerror=()=>{if(this.socket===ws)this.disconnect("error");};
  }catch{this.disconnect("connect failed");}
 }
 receive(raw:string){
  if(this.stopped)return;
  if(raw.length>65536){this.disconnect("oversize message");return;}
  let m:Record<string,unknown>;try{m=JSON.parse(raw);if(!m||typeof m!=="object")return;}catch{return;}
  if(m.type==="error"){this.log("Coinbase subscription rejected: "+String(m.message).slice(0,200));return;}
  if(m.type==="subscriptions"){
   const channels=Array.isArray(m.channels)?m.channels:[];const ticker=channels.find(c=>c?.name==="ticker");
   const heartbeat=channels.find(c=>c?.name==="heartbeat");
   this.heartbeatSubscribed=Array.isArray(heartbeat?.product_ids)&&this.symbols().some(s=>heartbeat.product_ids.includes(s+"-USD"));
   const accepted=new Set(Array.isArray(ticker?.product_ids)?ticker.product_ids:[]);
   const missing=this.symbols().filter(s=>!accepted.has(s+"-USD"));
   if(missing.length)this.log("Coinbase missing ticker products: "+missing.join(","));
   return;
  }
  if(m.type!=="ticker"&&m.type!=="heartbeat")return;
  const symbol=typeof m.product_id==="string"?m.product_id.replace(/-USD$/,""):"";
  if(!this.symbols().includes(symbol)||m.product_id!==symbol+"-USD"){
   if(this.unknown.size<32&&!this.unknown.has(String(m.product_id))){this.unknown.add(String(m.product_id));this.log("Coinbase ignored unknown product: "+String(m.product_id).slice(0,80));}
   return;
  }
  const at=typeof m.time==="string"?Date.parse(m.time):NaN;
  if(!Number.isSafeInteger(at)||at>this.now()+FUTURE_SKEW_MS||this.now()-at>STALE_MS)return;
  if(m.type==="heartbeat"){this.lastHeartbeat=this.now();this.lastMessage=this.now();return;} // Heartbeats keep quiet-symbol prices executable, without rewriting quote timestamps.
  const sequence=m.sequence,price=typeof m.price==="string"&&m.price.trim()?Number(m.price):NaN,micro=Math.round(price*1e6);
  if(!Number.isSafeInteger(sequence)||Number(sequence)<0||!Number.isFinite(price)||price<=0||!Number.isSafeInteger(micro)||micro<=0||micro>1e13)return;
  const previous=this.seen.get(symbol);
  if(previous&&(Number(sequence)<=previous.sequence||at<previous.at))return;
  if(this.queue.length>=this.capacity){this.disconnect("queue overflow; reconnecting verified feed");return;}
  this.lastMessage=this.now();
  this.seen.set(symbol,{sequence:Number(sequence),at});
  this.queue.push({symbol,micro,at:Math.min(at,this.now()),sequence:Number(sequence),cryptoGeneration:this.generation});
  void this.drain();
 }
 private async drain(){
  if(this.draining)return;this.draining=true;
  try{while(this.queue.length&&!this.stopped){
   const batch=this.queue.slice(0,64);
   try{await this.deps.apply(batch);}catch{this.disconnect("persistence failed");return;}
   this.queue.splice(0,batch.length);
   for(const t of batch)this.latest.set(t.symbol,t.at);
   this.attempts=0;
  }}finally{this.draining=false;}
 }
 retryPending(){void this.drain();}
 stop(){this.stopped=true;this.disconnect("stopped");this.queue=[];}
}
