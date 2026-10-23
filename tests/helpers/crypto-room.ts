import {freshRoom as baseRoom} from "../../lib/poker";
export * from "../../lib/poker";
/** Accounting fixtures model a healthy Coinbase connection whose latest frame
 * accompanies the most recent fixture print. Outage tests override this status.
 * Production freshRoom deliberately has NO health until a worker publishes it. */
export function freshRoom(){
 const room=baseRoom();
 const at=()=>Math.max(0,...Object.values(room.quotes??{}).map(q=>q?.at??0));
 room.cryptoStatus={connected:true,heartbeatSubscribed:true,generation:"fixture",get lastMessage(){return at();},get leaseUntil(){return at()+10001;}};
 return room;
}
