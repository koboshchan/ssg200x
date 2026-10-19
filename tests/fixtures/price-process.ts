import {startPriceWorker} from "../../lib/prices";
import {closeDatabase} from "../../lib/db";
let sockets=0,rest=0;
class MockSocket{readyState=0;onopen=null;onmessage=null;onerror=null;onclose=null;constructor(){sockets++;}send(){}close(){this.readyState=3;}}
globalThis.WebSocket=MockSocket as unknown as typeof WebSocket;
globalThis.fetch=async()=>{rest++;return new Response(JSON.stringify({data:{currency:"USD",rates:{BTC:"0.00001"}}}));};
const worker=startPriceWorker();
for(let i=0;i<100;i++)if(startPriceWorker()!==worker)throw Error("Duplicate singleton");
void worker.ready.then(()=>process.send?.({sockets,rest,owner:worker.owner}));
process.on("message",async message=>{if(message==="stop"){worker.stop();await closeDatabase();process.exit(0);}});
