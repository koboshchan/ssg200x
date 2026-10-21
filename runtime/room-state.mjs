import {scopeMarketRoom} from "./market-subscription.mjs";
import {emitState,resetStream} from "./state-stream.mjs";
// Only already-redacted per-user snapshots enter this connection-local baseline.
export function emitRoomState(socket,data,force=false){
 if(data.maintenance.blocked){socket.data.version=undefined;resetStream(socket,"room:state");return;}
 if(data.room){
  emitState(socket,"room:state",scopeMarketRoom(data.room,socket.data.marketSymbol),force);
  socket.data.version=data.room.version;
 }
}
