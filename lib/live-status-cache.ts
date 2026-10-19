// Share in-flight refreshes across every socket's private snapshot request.
export function liveStatusCache<T>(load:()=>Promise<T>,ttl=1000){
 let value:T,validUntil=0,pending:Promise<T>|undefined;
 return async()=>{
  if(Date.now()<validUntil)return value;
  if(!pending)pending=load().then(result=>{value=result;validUntil=Date.now()+ttl;return result;}).finally(()=>{pending=undefined;});
  return pending;
 };
}
