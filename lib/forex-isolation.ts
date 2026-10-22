/** Explicit opt-in only. NODE_ENV and credential presence never enable streams. */
export function forexStreamOptions(env:Readonly<Record<string,string|undefined>>=process.env){
 const environment=env.FX_STREAM_ENV?.trim()??"";
 const enabled=env.FX_STREAM_ENABLED?.trim().toLowerCase()==="true"&&/^[a-zA-Z0-9_-]{1,64}$/.test(environment);
 return {enabled,environment,leaseId:`oanda-feed:${environment||"disabled"}`};
}
/** A provider connection has its own environment-scoped lease, independent of crypto. */
export class ForexIsolation {
 private held=false;private until=0;
 constructor(private o:{options:()=>ReturnType<typeof forexStreamOptions>;now:()=>number;claim:(id:string)=>Promise<boolean>;release:(id:string)=>Promise<void>;step:()=>Promise<void>;revoke:()=>void|Promise<void>}){}
 private id="";private epoch=0;private queue:Promise<void>=Promise.resolve();
 private enqueue(operation:()=>Promise<void>){const task=this.queue.then(operation);this.queue=task.catch(()=>{});return task;}
 stop(){
  this.epoch++;this.held=false;
  const cleanup=this.o.revoke();
  return this.enqueue(()=>this.stopOnce(cleanup));
 }
 step(){const epoch=this.epoch;return this.enqueue(()=>this.stepOnce(epoch));}
 leader(){return this.held&&this.o.options().enabled&&this.id===this.o.options().leaseId&&this.o.now()<this.until-1000;}
 leaseUntil(){return this.until-1000;}
 leaseId(){return this.id||this.o.options().leaseId;}
 private async stopOnce(cleanup?:void|Promise<void>){
  const id=this.id;this.held=false;this.until=0;this.id="";
  // Release ownership only after transport/reader cleanup, not merely abort().
  await (cleanup??this.o.revoke());if(id)await this.o.release(id);
 }
 private async stepOnce(epoch:number){
  if(epoch!==this.epoch)return;
  const config=this.o.options();
  if(!config.enabled||this.id&&this.id!==config.leaseId){await this.stopOnce();if(!config.enabled)return;}
  if(epoch!==this.epoch||!this.o.options().enabled||this.o.options().leaseId!==config.leaseId)return;
  if(!this.held||this.until-this.o.now()<5000){
   const id=config.leaseId,begin=this.o.now();this.id=id;
   let claimed=false;try{claimed=await this.o.claim(id);}catch{}
   if(epoch!==this.epoch||!claimed||!this.o.options().enabled||this.o.options().leaseId!==id||this.o.now()>=begin+14000){await this.stopOnce();return;}
   this.held=true;this.until=begin+15000;
  }
  if(epoch===this.epoch)await this.o.step();
 }
}
