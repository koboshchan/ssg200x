import {createClerkReads} from "./clerk-reads.mjs";
export function sessionGuard(clerk,{now=Date.now,maxAge=10000,reads=createClerkReads({now,ttl:Math.min(maxAge,5000)})}={}){
 return async socket=>{
  const data=socket.data;if(!socket.connected||data.expires<=now()||typeof data.sessionId!=='string')throw Error('session');
  const session=await reads.session(clerk,data.sessionId);
  if(session.status!=='active'||session.userId!==data.identity.id)throw Error('session');
  // Refresh administrator status together with the live session.
  const user=await reads.user(clerk,data.identity.id);
  const {verifiedSocketIdentity}=await import('./socket-identity.mjs');
  const identity=verifiedSocketIdentity(user,data.identity.id);
  if(!identity)throw Error('session');
  data.identity=identity;
  data.sessionCheckedAt=now();
 };
}
