import {appendFileSync,openSync,closeSync} from "node:fs";
import type {OandaTick} from "./oanda-stream";
/** Explicit opt-in private diagnostics. Never credentials or provider response bodies. */
export function forexObserver(){
 const path=process.env.OANDA_OBSERVATION_FILE;
 if(!path)return undefined;
 if(!path.startsWith("/home/kit/forex-evidence/")||path.includes(".."))throw new Error("Unsafe observation path");
 closeSync(openSync(path,"a",0o600));
 return (tick:OandaTick)=>appendFileSync(path,JSON.stringify({symbol:tick.symbol,at:tick.at,received:tick.received,mono:tick.mono})+"\n",{mode:0o600});
}
