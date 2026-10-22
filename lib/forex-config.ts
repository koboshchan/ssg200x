import {readFileSync} from "node:fs";
/** Credentials are server configuration, never trusted from persisted room data. */
export function forexLiveConfigured(env:Readonly<Record<string,string|undefined>>=process.env){return !!env.OANDA_API_TOKEN?.trim()&&!!env.OANDA_ACCOUNT_ID?.trim();}
export const forexMonotonic=()=>Number(process.hrtime.bigint()/1000000n);

export const forexClockDomain=readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim();
