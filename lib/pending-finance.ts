export type PendingFinance={requestId:string;requestAt:number;[key:string]:unknown};
type Storage=Pick<globalThis.Storage,"getItem"|"setItem"|"removeItem">;
type Options={storage:Storage;key:string;fetch:typeof fetch;headers:()=>Record<string,string>;room:(room:any)=>void;change:()=>void};
export class PendingFinanceController {
 pending:PendingFinance|null=null;ready=false;working=false;connected=false;message="";error="";
 private epoch=0;private loaded=false;private rejection="";
 constructor(private options:Options){}
 private notify(){this.options.change();}
 private save(value:PendingFinance|null){
  if(value)this.options.storage.setItem(this.options.key,JSON.stringify(value));
  else this.options.storage.removeItem(this.options.key);
  this.pending=value;
 }
 private load(){
  if(this.loaded)return;
  const raw=this.options.storage.getItem(this.options.key);
  if(raw){const value=JSON.parse(raw);if(!value||typeof value.requestId!=="string"||!Number.isSafeInteger(value.requestAt)||typeof value.type!=="string")throw new Error("Saved order could not be read. Keep this tab open and contact the host.");this.pending=value;}
  this.loaded=true;
 }
 private async request(path:string,body?:object){
  const response=await this.options.fetch(path,{cache:"no-store",signal:AbortSignal.timeout(15000),...(body?{method:"POST",headers:{"Content-Type":"application/json",...this.options.headers()},body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||"Could not check order."),{status:response.status});
  return data;
 }
 connection(connected:boolean){
  this.connected=connected;this.ready=false;this.epoch++;this.notify();
  if(connected)void this.sync();
 }
 async sync(){
  if(!this.connected||this.working)return;
  this.working=true;this.ready=false;this.error="";const epoch=this.epoch;this.notify();
  try{
   this.load();
   const pending=this.pending;
   const data=await this.request(pending?"/api/finance/status":"/api/room",pending??undefined);
   if(epoch!==this.epoch)return;
   this.options.room(pending?data.room:data);
   if(pending){
    if(!["committed","cancelled","expired"].includes(data.outcome))throw new Error("Order status unavailable.");
    this.save(null);
    this.message=data.outcome==="committed"?"Your previous order completed. Balances refreshed.":data.outcome==="expired"?"Previous order status expired. Review holdings and history before placing another order.":"Your previous order was not placed. "+(this.rejection?this.rejection+" ":"")+"Review the current price before placing a new order.";
    this.rejection="";
   }
   this.ready=true;
  }catch(e){this.error=e instanceof Error?e.message:"Could not check order.";}
  finally{this.working=false;this.notify();if(epoch!==this.epoch&&this.connected)void this.sync();}
 }
 async submit(body:object,serverNow:number){
  if(!this.connected||!this.ready||this.working||this.pending)return;
  this.working=true;this.ready=false;this.message="";this.error="";this.rejection="";const epoch=this.epoch;
  try{
   // Ignore caller-generated metadata. This exact payload is durably written BEFORE fetch.
   const pending={...body,requestId:crypto.randomUUID(),requestAt:serverNow};
   this.save(pending);this.notify();
   const data=await this.request("/api/finance",pending);
   this.options.room(data);
   this.save(null);this.ready=this.connected&&epoch===this.epoch;
  }catch(e){
   const status=(e as {status?:number})?.status;
   if(status&&status>=400&&status<500)this.rejection=e instanceof Error?e.message:"Order rejected.";
   if(!this.pending)this.ready=this.connected&&epoch===this.epoch;
   this.error=this.pending?(this.rejection?this.rejection+" ":"")+"Order outcome not confirmed. Checking before another order can be placed.":e instanceof Error?e.message:"Could not save order. No order sent.";
  }finally{
   this.working=false;this.notify();
   // Reconcile or fence only. Never automatically submit an unconfirmed trade.
   if(!this.ready&&this.connected)void this.sync();
  }
 }
}
