export type AirdropEvent={id:string;amount:number;at:number};
export const AIRDROP_EVENT:"airdrop:completed";
export function validAirdrop(event:unknown):event is AirdropEvent;
export function createAirdropReceiver(deliver:(event:AirdropEvent)=>void):(event:unknown)=>boolean;
export function createAirdropBroadcaster(io:any,receipts:any):(id:string)=>Promise<boolean>;
