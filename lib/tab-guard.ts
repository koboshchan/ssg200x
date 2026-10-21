import {ensure} from "./errors";
const games:Record<string,string>={"/api/action":"poker","/api/roulette":"roulette","/api/blackjack":"blackjack","/api/games":"games"};
const guarded=new Set([...Object.keys(games),"/api/finance","/api/transfers"]);
export async function checkActionTab(request:Request,userId:string){
 const path=new URL(request.url).pathname;
 if(request.method==="GET"||!guarded.has(path))return;
 let response:Response;
 try{response=await fetch(`http://127.0.0.1:${Number(process.env.PORT||3000)}/internal-tab-check`,{
  method:"POST",headers:{"content-type":"application/json","x-internal-live-secret":process.env.INTERNAL_LIVE_SECRET||""},
  body:JSON.stringify({userId,tabId:request.headers.get("x-tab-id"),tabProof:request.headers.get("x-tab-proof"),game:games[path]}),
  signal:AbortSignal.timeout(3000)
 });}catch{ensure(false,"Live tab verification unavailable. Try again.",503);}
 const data=await response.json();
 ensure(response.ok,typeof data.error==="string"?data.error:"Live tab verification unavailable.",response.status===409?409:503);
}
