import type {Socket} from "socket.io-client";
export function attachSocketAuth(socket:any,options:{verify:(token:string)=>Promise<any>;checkSession:(socket:any)=>Promise<void>;now?:()=>number;refreshLead?:number;retryMs?:number}):void;
export function attachSocketAuthClient(socket:Socket,getToken:()=>Promise<string|null>):()=>void;
