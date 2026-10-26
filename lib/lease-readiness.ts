/* Client view of the server tab lease. Only an accepted-report ack ({ok:true,leaseTtlMs?}) makes a
   connection action-ready. Time is monotonic and measured from when the report was SENT, so server
   wall time never matters and network delay only shortens freshness. Acks from older connections are ignored. */
export const LEASE_SERVER_TTL_MS=16000,LEASE_SAFETY_MARGIN_MS=3000,LEASE_FIRST_ACK_GRACE_MS=8000,LEASE_BACKOFF_MS=[1000,2000,4000,8000,16000];
export type ReportToken={generation:number;sentAt:number};
export type LeaseReadinessOptions={now:()=>number;recover:()=>void};
export function createLeaseReadiness({now,recover}:LeaseReadinessOptions){
 let generation=0,open=false,openedAt=0,validUntil=-Infinity,failures=0,nextRecoverAt=0;
 const fresh=()=>open&&now()<validUntil;
 return{
  /** New transport connection: previous acks no longer count. */
  opened(){generation++;open=true;openedAt=now();validUntil=-Infinity;return generation;},
  closed(){generation++;open=false;validUntil=-Infinity;},
  /** Call immediately before emitting tab:report. */
  sending():ReportToken|null{return open?{generation,sentAt:now()}:null;},
  ack(token:ReportToken|null,res:unknown){
   if(!token||token.generation!==generation||!open)return false;
   const r=res as {ok?:unknown;leaseTtlMs?:unknown}|null|undefined;
   if(!r||r.ok!==true)return false;
   // Contract: leaseTtlMs is always a finite positive number. Missing or malformed means the ack is not trusted.
   if(typeof r.leaseTtlMs!=="number"||!Number.isFinite(r.leaseTtlMs)||r.leaseTtlMs<=0)return false;
   const until=token.sentAt+Math.max(0,Math.min(r.leaseTtlMs,LEASE_SERVER_TTL_MS)-LEASE_SAFETY_MARGIN_MS);
   // An ack that is already expired on arrival proves nothing: no freshness, no backoff reset.
   if(until<=now())return false;
   if(until>validUntil)validUntil=until;
   failures=0;
   return true;
  },
  fresh,
  /** Ask for one targeted reconnect when a connected socket has no fresh lease. Bounded by backoff; never resubmits actions. */
  check(){
   if(!open||fresh())return false;
   const t=now();
   if(validUntil===-Infinity&&t-openedAt<LEASE_FIRST_ACK_GRACE_MS)return false;
   if(t<nextRecoverAt)return false;
   nextRecoverAt=t+LEASE_BACKOFF_MS[Math.min(failures,LEASE_BACKOFF_MS.length-1)];failures++;
   recover();return true;
  }
 };
}
