/** Shared Coinbase transport health, never a per-symbol trade cadence limit. */
export const CRYPTO_HEALTH_MS=10_000;
export type CryptoStatus={connected:boolean;heartbeatSubscribed:boolean;generation:string;lastMessage:number;leaseUntil:number};
export function cryptoExecutable(status:CryptoStatus|undefined,quote:{at:number;cryptoGeneration?:string}|undefined,now:number){
 return !!status&&status.connected&&status.heartbeatSubscribed&&status.leaseUntil>now&&Number.isSafeInteger(status.lastMessage)&&status.lastMessage<=now&&now-status.lastMessage<=CRYPTO_HEALTH_MS&&!!quote&&Number.isSafeInteger(quote.at)&&quote.at>=0&&quote.at<=now&&quote.cryptoGeneration===status.generation;
}
