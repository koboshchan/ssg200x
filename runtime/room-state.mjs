import {isolatedQaChatRoomEnabled,ISOLATED_QA_CHAT_ROOM} from './chat-room-policy.mjs';
import {scopeMarketRoom} from "./market-subscription.mjs";
import {emitState,resetStream} from "./state-stream.mjs";
// Only already-redacted per-user snapshots enter this connection-local baseline.
export function emitRoomState(socket,data,force=false,env=process.env){
 if(data.maintenance.blocked){socket.data.version=undefined;resetStream(socket,"room:state");return;}
 if(data.room){
  const room=scopeMarketRoom(data.room,socket.data.marketSymbol);
  delete room.qaChatRoom;
  if(isolatedQaChatRoomEnabled(env))room.qaChatRoom=ISOLATED_QA_CHAT_ROOM;
  emitState(socket,"room:state",room,force);
  socket.data.version=data.room.version;
 }
}
