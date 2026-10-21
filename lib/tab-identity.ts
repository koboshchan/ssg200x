type TabIdentity=Readonly<{tabId:string;tabProof:string}>;
let identity:TabIdentity|undefined;

/** One identity per document, retained across SPA navigation and socket reconnects.
 * Never store this in browser storage: duplicating a tab must create a new identity.
 */
export function getTabIdentity():TabIdentity{
 if(typeof window==="undefined")throw new Error("Tab identity is browser-only.");
 return identity??=Object.freeze({tabId:crypto.randomUUID(),tabProof:crypto.randomUUID()});
}

export function getTabHeaders(){
 const {tabId,tabProof}=getTabIdentity();
 return {"X-Tab-Id":tabId,"X-Tab-Proof":tabProof};
}
