export function sessionGuard(clerk,{now=Date.now,maxAge=10000}={}){
 return async socket=>{
  const data=socket.data;if(!socket.connected||data.expires<=now()||typeof data.sessionId!=='string')throw Error('session');
  if(data.sessionCheckedAt&&now()-data.sessionCheckedAt<maxAge)return;
  const session=await clerk.sessions.getSession(data.sessionId);
  if(session.status!=='active'||session.userId!==data.identity.id)throw Error('session');
  data.sessionCheckedAt=now();
 };
}
