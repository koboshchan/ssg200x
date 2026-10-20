// One request at a time, one trailing refresh, and a finite 429 recovery budget.
export function createTransferHistoryRefresh(load:(signal:AbortSignal)=>Promise<void>,onError:(error:Error)=>void){
 let closed=false,dirty=false,running=false,retries=0,notBefore=0;
 let timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
 const schedule=(delay:number)=>{if(closed||timer!==undefined)return;timer=setTimeout(()=>{timer=undefined;void flush();},Math.min(delay,2147483647));};
 async function flush(){
  if(closed||running||!dirty)return;
  if(Date.now()<notBefore){schedule(notBefore-Date.now());return;}
  dirty=false;running=true;controller=new AbortController();
  try{await load(controller.signal);retries=0;}
  catch(error){
   if(closed)return;
   const e=error as Error&{status?:number;retryAfter?:number};
   onError(e);
   if(e.status===429){
    notBefore=Date.now()+Math.max(1000,e.retryAfter??60000);
    // At most two automatic retries, even when new events arrive during cooldown.
    dirty=retries++<2;
   }
  }finally{running=false;if(!closed&&dirty)schedule(Math.max(150,notBefore-Date.now()));}
 }
 return {refresh(){if(closed)return;dirty=true;schedule(Math.max(150,notBefore-Date.now()));},
 close(){closed=true;dirty=false;clearTimeout(timer);controller?.abort();}};
}
export function retryAfterMs(value:string|null,now=Date.now()){
 if(!value)return 60000;
 const seconds=Number(value),ms=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now;
 return Number.isFinite(ms)?Math.max(1000,ms):60000;
}
