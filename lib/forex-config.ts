/** Server configuration is authoritative, never a persisted room status. */
export function forexLiveConfigured(env:Readonly<Record<string,string|undefined>>=process.env){
 return !!env.TWELVEDATA_API_KEY?.trim()&&!(env.NODE_ENV!=="production"&&env.FOREX_DEMO_MOCK==="1");
}
