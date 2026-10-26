// True only when this client is the throw's target and the seat identity still matches the event.
type Seat={publicId:string;isYou?:boolean}|null|undefined;
export function isReceiverThrow(e:{kind:string;source:number;sourceId:string;target?:number;targetId?:string},seats:readonly Seat[]){
 const seat=e.target==null?null:seats[e.target];
 return e.kind==="throw"&&!!e.targetId&&!!seat&&seat.isYou===true&&seat.publicId===e.targetId&&seats[e.source]?.publicId===e.sourceId;
}
