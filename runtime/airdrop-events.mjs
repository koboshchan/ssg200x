// Transient events never enter state snapshots, socket recovery, or room history.
export const AIRDROP_EVENT="airdrop:completed";
export function validAirdrop(event){
 return !!event&&/^[a-f0-9]{64}$/.test(event.id)&&Number.isSafeInteger(event.amount)&&event.amount>0&&Number.isSafeInteger(event.at)&&event.at>0;
}
export function createAirdropReceiver(deliver){
 // Deliberately lives across socket reconnects, not in the state/cache receiver.
 const seen=new Set();
 return event=>{
  if(!validAirdrop(event)||seen.has(event.id))return false;
  seen.add(event.id);deliver({id:event.id,amount:event.amount,at:event.at});return true;
 };
}
export function createAirdropBroadcaster(io,receipts){
 const seen=new Set(),pending=new Map();
 return id=>{
  if(!/^[a-f0-9]{64}$/.test(id))return Promise.resolve(false);
  if(seen.has(id))return Promise.resolve(false);
  if(pending.has(id))return pending.get(id);
  const work=(async()=>{
   // The majority read is a second fence against precommit/aborted notifications.
   const receipt=await receipts.findOne({_id:id},{readConcern:{level:"majority"}});
   if(!receipt)return false;
   const event={id:receipt._id,amount:receipt.amount,at:receipt.at};
   if(!validAirdrop(event))return false;
   seen.add(id);
   // Only the sockets present now receive it. No recovery/history/reconnect replay.
   for(const socket of io.sockets.sockets.values()){
    if(socket.connected&&socket.data.expires>Date.now())socket.emit(AIRDROP_EVENT,event);
   }
   return true;
  })().finally(()=>pending.delete(id));
  pending.set(id,work);return work;
 };
}
