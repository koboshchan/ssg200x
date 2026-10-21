type TabIdentity=Readonly<{tabId:string;tabProof:string}>;
let identity:TabIdentity|undefined;

function randomId(){
 const source=globalThis.crypto;
 if(typeof source?.randomUUID==="function")return source.randomUUID();
 if(typeof source?.getRandomValues!=="function")throw new Error("Secure tab identity is unavailable.");
 // randomUUID may be missing outside secure contexts; retain cryptographic entropy.
 const bytes=source.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]&15)|64;
 bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,n=>n.toString(16).padStart(2,"0")).join("");
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}

/** One identity per document, retained across SPA navigation and socket reconnects.
 * Never store this in browser storage: duplicating a tab must create a new identity.
 */
export function getTabIdentity():TabIdentity{
 if(typeof window==="undefined")throw new Error("Tab identity is browser-only.");
 return identity??=Object.freeze({tabId:randomId(),tabProof:randomId()});
}

export function getTabHeaders():Record<string,string>{
 // SSR and non-browser fixtures must not create a shared identity or crash.
 // No insecure fallback: guarded APIs reject missing headers/leases server-side.
 if(typeof window==="undefined")return {};
 if(!identity&&typeof globalThis.crypto?.randomUUID!=="function"&&typeof globalThis.crypto?.getRandomValues!=="function")return {};
 const {tabId,tabProof}=getTabIdentity();
 return {"X-Tab-Id":tabId,"X-Tab-Proof":tabProof};
}
