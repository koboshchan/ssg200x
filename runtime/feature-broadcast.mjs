// One process-wide fanout, never restricted to admin or route subscriptions.
// Receiving this state does not reload clients or delay runtime enforcement.
export function broadcastFeatureState(io,settings){
 const payload=settings.snapshot();
 for(const socket of io.sockets.sockets.values()){
  if(!socket.connected)continue;
  socket.emit('features:state',payload);
  socket.data.forceFull=true;socket.data.statusAt=0;
 }
}
