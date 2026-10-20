export const STATE_STREAMS:string[];
export function diffState(before:unknown,after:unknown):any;
export function applyPatch(before:unknown,patch:unknown):any;
export function resetStream(socket:object,event:string):void;
export function emitState(socket:{emit:(event:string,payload:any)=>unknown},event:string,value:unknown,force?:boolean,now?:number):boolean;
export function createStateReceiver(requestFull:(event:string)=>void,now?:()=>number):{clear:()=>void;receive:(event:string,message:unknown)=>{ok:boolean;value?:any}};
