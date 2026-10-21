import {AlpacaIexFeed, type StockSocket} from "./stock-feed";
import {STOCK_SYMBOLS, type StockEnvironment, type StockSymbol} from "./stock-config";
import {parseStockCalendar, parseStockClock, type StockClock, type StockSession} from "./stock-session";
import type {StockExecutionState, StockTick} from "./stock-policy";
export type StockRuntimeOptions = {
  symbols?:()=>readonly string[];
  env: StockEnvironment;
  /** Supplied by the EXISTING price worker lease. This module acquires no lock. */
  isLeader: () => boolean;
  leaseUntil?: () => number;
  socket: (url: string) => StockSocket;
  fetch: typeof fetch;
  now: () => number;
  /** Persist state/tick under the caller's existing lease and room CAS fence. */
  publish: (states: Record<StockSymbol, StockExecutionState>, tick?: StockTick) => Promise<void>;
  random?: () => number;
};
/** Lease-owned single upstream. No networking at import or construction.
 * Caller drives step() from its existing timer and calls stop() on lease loss.
 */
export class StockRuntime {
  private connected=false;
  private clock: StockClock|null=null;
  private sessions: StockSession[]=[];
  private ticks=new Map<StockSymbol,StockTick>();
  private nextMetadata=0;
  private nextConnect=0;
  private busy=false;
  private stopped=false;
  private revision=0;
  private writes:Promise<void>=Promise.resolve();
  private readonly feed:AlpacaIexFeed;
  constructor(private readonly o:StockRuntimeOptions) {
    this.feed=new AlpacaIexFeed({
      symbols:o.symbols,env:o.env,isLeader:()=>!this.stopped&&o.isLeader(),permitted:()=>true,
      socket:o.socket,now:o.now,
      onState:state=>{
        this.connected=state==="subscribed";
        if(!this.connected)this.ticks.clear();
        if(state==="disconnected")this.nextConnect=o.now()+this.feed.retryDelay()*(0.8+0.4*(o.random??Math.random)());
        this.enqueue();
      },
      onTick:tick=>{this.ticks.set(tick.symbol,tick);this.enqueue(tick);},
    });
  }
  snapshot():Record<StockSymbol,StockExecutionState> {
    const authorized=!!this.o.env.ALPACA_KEY_ID?.trim()&&!!this.o.env.ALPACA_SECRET?.trim();
    const result={} as Record<StockSymbol,StockExecutionState>;
    for(const symbol of this.o.symbols?.()??STOCK_SYMBOLS)result[symbol]={
      symbol,leaseUntil:this.o.leaseUntil?.()??this.o.now(),connected:this.connected,leader:!this.stopped&&this.o.isLeader(),authorized,
      tick:this.ticks.get(symbol)??null,
      clock:this.clock,sessions:this.sessions,
    };
    return result;
  }
  private enqueue(tick?:StockTick) {
    const revision=this.revision,states=this.snapshot();
    this.writes=this.writes.then(async()=>{
      if(revision!==this.revision||this.stopped||!this.o.isLeader())return;
      await this.o.publish(states,tick);
    }).catch(()=>{
      if(revision!==this.revision||this.stopped)return;
      // A failed persistence must not leave a locally executable cached mark.
      this.connected=false;this.ticks.clear();
    });
  }
  async step() {
    if(this.stopped)return;
    if(!this.o.isLeader()){this.revoke();return;}
    if(this.busy)return;this.busy=true;
    const revision=this.revision;
    try{
      this.feed.sync();
      const now=this.o.now();
      if(now>=this.nextMetadata){
        this.nextMetadata=now+30_000;
        const key=this.o.env.ALPACA_KEY_ID?.trim(),secret=this.o.env.ALPACA_SECRET?.trim();
        if(!key||!secret)return;
        const headers={"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret};
        const date=new Date(now).toISOString().slice(0,10);
        const end=new Date(now+7*86_400_000).toISOString().slice(0,10);
        const [cr,dr]=await Promise.all([
          this.o.fetch("https://paper-api.alpaca.markets/v2/clock",{headers,signal:AbortSignal.timeout(5000)}),
          this.o.fetch("https://paper-api.alpaca.markets/v2/calendar?start="+date+"&end="+end,{headers,signal:AbortSignal.timeout(5000)}),
        ]);
        if(!cr.ok||!dr.ok)throw new Error("stock_metadata_unavailable");
        const [c,d]=await Promise.all([cr.json(),dr.json()]);
        if(this.stopped||revision!==this.revision||!this.o.isLeader())return;
        this.clock=parseStockClock(c,this.o.now());this.sessions=parseStockCalendar(d);this.enqueue();
      }
      if(this.o.isLeader()&&this.o.now()>=this.nextConnect)this.feed.start();
    }catch{
      if(this.stopped||revision!==this.revision)return;
      this.clock=null;this.sessions=[];this.ticks.clear();this.feed.stop();this.enqueue();
    }finally{this.busy=false;}
  }
  /** Revocation fences in-flight callbacks/metadata but permits later reacquisition. */
  revoke(){this.revision++;this.connected=false;this.clock=null;this.sessions=[];this.ticks.clear();this.feed.stop();this.nextMetadata=0;}
  stop(){this.stopped=true;this.revoke();}
  async drained(){await this.writes;}
}
