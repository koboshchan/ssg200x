/** Explicit opt-in only. Invalid QA configuration must fail before any worker starts. */
export function assertIsolatedQa(env=process.env){
 if(env.SSG_ISOLATED_QA===undefined)return;
 if(env.SSG_ISOLATED_QA!=="1"||env.QA_PROTECTED_COLLECTIONS!=="candles")
  throw new Error("Isolated QA requires SSG_ISOLATED_QA=1 and QA_PROTECTED_COLLECTIONS=candles");
}
