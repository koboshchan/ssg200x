// Called only for the transaction result which created a receipt, after commit.
// Failure must not turn a committed payment into an HTTP error or reissue money.
export async function notifyCommittedAirdrop(id:string){
 const secret=process.env.INTERNAL_LIVE_SECRET;
 if(!secret)return;
 try{
  const response=await fetch(`http://127.0.0.1:${Number(process.env.PORT||3000)}/internal-airdrop`,{
   method:"POST",headers:{"x-internal-live-secret":secret,"content-type":"application/json"},
   body:JSON.stringify({id}),signal:AbortSignal.timeout(3000)
  });
  if(!response.ok)console.error("Committed airdrop announcement unavailable");
 }catch{console.error("Committed airdrop announcement unavailable");}
}
