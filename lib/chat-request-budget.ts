// One account budget survives ChatClient/route remounts. No message or key material is retained.
export const MAX_FAILURES=4;
type Budget={failures:number;until:number;stopped:boolean;flight?:Promise<any>};
const budgets=new Map<string,Budget>();
export function retryDelay(value:unknown,unit:unknown):number{
 // Explicit units only. Legacy retryAfter numeric values are seconds (HTTP convention).
 const n=Number(value);if(!Number.isFinite(n)||n<0)return 0;
 return n*(unit==="ms"?1:1000);
}
export function createRequestBudget(now=Date.now,random=Math.random){
 const states=now===Date.now?budgets:new Map<string,Budget>();
 const state=(user:string)=>{let b=states.get(user);if(!b){b={failures:0,until:0,stopped:false};states.set(user,b);}return b;};
 const error=(b:Budget)=>Object.assign(new Error("rate_limited"),{retryAfterMs:Math.max(0,b.until-now()),exhausted:b.stopped});
 return {
  status:(u:string)=>state(u),
  reset(u:string){const b=state(u);b.failures=0;b.stopped=false;}, // Never bypass a server cooldown.
  success(u:string){const b=state(u);b.failures=0;b.stopped=false;},
  async request(u:string,event:string,payload:unknown,transport:(e:string,p:unknown)=>Promise<any>){
   const b=state(u);
   if(b.stopped||b.until>now())throw error(b);
   // A remounted owner must not issue a second request while the old request is pending.
   if(b.flight)throw Object.assign(new Error("busy"),{retryAfterMs:1000});
   const flight=(async()=>{
    try{
     const result=await transport(event,payload);
     if(result?.ok===false)throw Object.assign(new Error(result.error||"unavailable"),{retryAfter:result.retryAfter,retryAfterUnit:result.retryAfterUnit,retryAfterMs:result.retryAfterMs});
     return result;
    }catch(e){
     if((e as Error)?.message==="rate_limited"){
      b.failures++;
      const x=e as {retryAfter?:unknown;retryAfterUnit?:unknown;retryAfterMs?:number};
      const explicit=x.retryAfterMs!==undefined||x.retryAfter!==undefined;
      // All operations share a fixed one-minute server bucket. Older ACKs omit retryAfter.
      // Wait to its next boundary rather than spending all four attempts inside the same bucket.
      const mandated=explicit?(x.retryAfterMs===undefined?retryDelay(x.retryAfter,x.retryAfterUnit):retryDelay(x.retryAfterMs,"ms")):60000-(now()%60000)+250;
      const base=Math.min(30000,1000*2**(b.failures-1));
      b.until=now()+Math.max(mandated,base+Math.floor(random()*base*.25));
      b.stopped=b.failures>=MAX_FAILURES;
      throw error(b);
     }throw e;
    }
   })();
   b.flight=flight;try{return await flight;}finally{if(b.flight===flight)b.flight=undefined;}
  }
 };
}
export const chatRequestBudget=createRequestBudget();
