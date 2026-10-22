import type {PublicDoudizhu} from "./doudizhu";
type Transport={read:()=>Promise<PublicDoudizhu>;move:(body:object)=>Promise<PublicDoudizhu>};
/** Choices share a room version, so both other seats can invalidate a refresh. */
export async function moveWithDoubleRetry(transport:Transport,body:{type:string;[key:string]:unknown},original:PublicDoudizhu["room"]){
 let request=body;
 for(let attempt=0;;attempt++){
  try{return await transport.move(request);}catch(e){
   // Only an explicit rejection is safe to retry, never an ambiguous response.
   if(attempt>=3||body.type!=="double"||!(e instanceof Error)||e.message!=="The turn changed. Refresh first.")throw e;
   const latest=await transport.read(),room=latest.room,own=room?.players.find(p=>p.self);
   if(!room||!original||room.code!==original.code||room.handId!==original.handId||room.phase!=="doubling"||!own||own.doubleChosen)throw e;
   request={...body,version:room.version,requestId:crypto.randomUUID(),requestAt:Date.now()};
  }
 }
}
