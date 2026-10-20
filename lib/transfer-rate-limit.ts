import {createHash} from "node:crypto";
import {isIP} from "node:net";
import {rateLimit} from "./store";
/** Only trust an explicitly configured edge-overwritten header. By default all
 * sources share a database budget, which cannot be bypassed by forged XFF. */
export function transferSource(request:Request){
 const header=process.env.TRANSFER_TRUSTED_IP_HEADER;
 const candidate=header?request.headers.get(header)?.trim():"";
 return candidate&&isIP(candidate)?createHash("sha256").update("ssg200x.transfer-source.v1\0"+candidate).digest("hex"):"shared-untrusted-edge";
}
export async function limitTransferGuess(request:Request,userId:string){
 await rateLimit("transfer-guess:user:"+userId,10);
 await rateLimit("transfer-guess:source:"+transferSource(request),30);
 // Aggregate cap also bounds distributed account/IP guessing.
 await rateLimit("transfer-guess:global",120);
}
