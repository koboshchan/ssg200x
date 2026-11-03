// Settings are independent of the device wall clock. Read fresh server time for
// every click, including after a long-open tab or sleep; never weaken POST expiry.
export async function saveSettings(patch:object,headers:Record<string,string>,fetcher:typeof fetch=fetch){
 const clock=await fetcher("/api/settings",{cache:"no-store"});
 const snapshot=await clock.json();
 if(!clock.ok)throw new Error(snapshot.error||"Could not load settings.");
 if(!Number.isSafeInteger(snapshot.serverNow))throw new Error("Could not read server time. Try again.");
 const response=await fetcher("/api/settings",{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify({...patch,requestId:crypto.randomUUID(),requestAt:snapshot.serverNow})});
 if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||"Could not save.");
}
