// Version tracking belongs to each authenticated connection, never a global version.
export function emitRoomState(socket,data,force=false){
 if(data.maintenance.blocked){socket.data.version=undefined;return;}
 if(data.room&&(force||socket.data.version!==data.room.version)){
  socket.emit("room:state",data.room);
  socket.data.version=data.room.version;
 }
}
