import {endpoint,parse} from "@/lib/api";
import {fingerprintReport,recordFingerprint} from "@/lib/device-fingerprints";
export async function POST(request:Request){
 return endpoint(request,async who=>{
  const {hash}=await parse(request,fingerprintReport,128);
  await recordFingerprint(who,hash);
  return {ok:true};
 });
}
