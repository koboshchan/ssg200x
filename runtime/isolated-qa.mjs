/** Explicit opt-in only. Invalid QA configuration must fail before any worker starts. */
export function assertIsolatedQa(env=process.env){
 if(env.QA_CHART_FIXTURES!==undefined&&env.QA_CHART_FIXTURES!=="0"){
  if(env.QA_CHART_FIXTURES!=="1"||env.SSG_ISOLATED_QA!=="1"||env.QA_PROTECTED_COLLECTIONS!=="candles"||env.FX_STREAM_ENABLED!=="false"||
   !env["NEXT_PUBLIC_"+"CLERK_PUBLISHABLE_KEY"]?.startsWith("pk_test_")||!env.CLERK_SECRET_KEY?.startsWith("sk_test_"))
   throw new Error("Chart fixtures require explicit isolated protected QA, DEV Clerk and disabled FX stream");
 }
 if(env.SSG_ISOLATED_QA===undefined)return;
 if(env.SSG_ISOLATED_QA!=="1"||env.QA_PROTECTED_COLLECTIONS!=="candles")
  throw new Error("Isolated QA requires SSG_ISOLATED_QA=1 and QA_PROTECTED_COLLECTIONS=candles");
}
