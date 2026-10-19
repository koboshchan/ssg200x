export async function register() {
 if(process.env.NEXT_RUNTIME==="nodejs"&&process.env.NEXT_PHASE!=="phase-production-build") {
  await import("socket.io"); // Include standalone custom-server runtime dependencies in tracing.
  const {tickRoom}=await import("./lib/store");
  const {historyBackfillStep}=await import("./lib/candles");
  const {refreshPrices}=await import("./lib/prices");
  const g=globalThis as typeof globalThis & {pokerTimer?:ReturnType<typeof setInterval>};
  if(!g.pokerTimer) {
   let running=false;
   g.pokerTimer=setInterval(async()=>{if(running)return;running=true;try{await tickRoom();}catch{console.error("Poker room timer unavailable");}finally{running=false;}},1000);
   g.pokerTimer.unref();
   const history=setInterval(()=>{void historyBackfillStep().catch(()=>{});},350);history.unref();
   await refreshPrices(); // Rehydrate persisted positions and check current marks immediately on boot, even with zero clients.
   const prices=setInterval(()=>{void refreshPrices();},100);prices.unref();
  }
 }
}
