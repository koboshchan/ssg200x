export const DEFAULT_THROW_PRICE:number;
export function throwPrice(room:any,kind:string):number;
export function chargePokerThrow(options:{collection:any;auditCollection?:any;user:string;payload:any;authorize:()=>Promise<void>;now?:()=>number}):Promise<{replayed:boolean;cost:number;source?:number;sourceId?:string;target?:number;targetId?:string}>;
