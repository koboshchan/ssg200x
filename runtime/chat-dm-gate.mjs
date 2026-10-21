// The supported runtime has one server process. Hold this gate outside both
// service queues so reset cannot revoke keys between a DM fence and its insert.
// Never acquire it from inside either service's serialized operation.
export function createChatDmGate(chat,dm){
 let queue=Promise.resolve(),pending=0;
 const serial=fn=>{
  if(pending>=128)return Promise.reject(Object.assign(new Error('busy'),{chatCode:'busy'}));
  pending++;
  const result=queue.then(fn).finally(()=>pending--);
  queue=result.catch(()=>{});
  return result;
 };
 return {
  adminReset:(actor,payload)=>serial(()=>chat.adminReset(actor,payload)),
  handle:(user,event,payload)=>serial(()=>dm.handle(user,event,payload))
 };
}
