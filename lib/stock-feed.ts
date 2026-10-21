import {ALPACA_IEX_URL, STOCK_SYMBOLS, type StockEnvironment} from "./stock-config";
import type {StockTick} from "./stock-policy";
export interface StockSocket {
  send(data: string): void; close(): void;
  onopen: (() => void) | null; onclose: (() => void) | null;
  onerror: (() => void) | null; onmessage: ((event: {data: unknown}) => void) | null;
}
export type StockFeedOptions = {
  symbols?:()=>readonly string[];
  env: StockEnvironment; permitted: () => boolean; isLeader: () => boolean;
  socket: (url: string) => StockSocket; now: () => number;
  onTick: (tick: StockTick) => void;
  onState: (state: "connecting" | "subscribed" | "disconnected" | "blocked") => void;
};
/** One instance per distributed feed leader. No network at construction/import.
 * Runtime owns reconnect scheduling; retryDelay is bounded exponential backoff.
 * Every new connection requires fresh auth/subscription; old callbacks are fenced.
 */
export class AlpacaIexFeed {
  private current: StockSocket | null = null;
  private selected:string[]=[];
  private updating=false;
  private symbols(){return this.options.symbols?.()??STOCK_SYMBOLS;}
  sync(){
   const symbols=[...this.symbols()],socket=this.current;
   if(!socket||!this.authenticated)return;
   const removed=this.selected.filter(s=>!symbols.includes(s)),added=symbols.filter(s=>!this.selected.includes(s));
   if(removed.length||added.length)this.updating=this.subscribed;
   if(removed.length)socket.send(JSON.stringify({action:"unsubscribe",trades:removed,quotes:removed}));
   if(added.length)socket.send(JSON.stringify({action:"subscribe",trades:added,quotes:added}));
   this.selected=symbols;
  }
  private authenticated = false;
  private subscribed = false;
  private lastTimestamp = new Map<string, number>();
  private terminal = false;
  private attempt = 0;
  private handshake: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly options: StockFeedOptions) {}
  retryDelay() { return Math.min(30_000, 1_000 * 2 ** Math.min(this.attempt++, 5)); }
  stop() {
    if (this.handshake) clearTimeout(this.handshake);
    this.handshake = null;
    const old = this.current;
    this.current = null; this.authenticated = false; this.subscribed = false;
    if (old) { old.onopen = old.onclose = old.onerror = old.onmessage = null; old.close(); }
    this.options.onState("disconnected");
  }
  start(): boolean {
    if (this.current || this.terminal) return false;
    const o = this.options, key = o.env.ALPACA_KEY_ID?.trim(), secret = o.env.ALPACA_SECRET?.trim();
    if (!key || !secret || !o.permitted() || !o.isLeader()) { o.onState("blocked"); return false; }
    o.onState("connecting");
    let socket: StockSocket;
    try { socket = o.socket(ALPACA_IEX_URL); } catch { o.onState("disconnected"); return false; }
    this.current = socket;
    this.handshake = setTimeout(() => { if (this.current === socket) this.stop(); }, 8_000);
    this.handshake.unref?.();
    const active = () => this.current === socket && o.isLeader() && o.permitted();
    const fail = (terminal = false) => { if (this.current !== socket) return; this.terminal ||= terminal; this.stop(); };
    socket.onopen = () => { if (!active()) return fail(); socket.send(JSON.stringify({action: "auth", key, secret})); };
    socket.onclose = socket.onerror = () => fail();
    socket.onmessage = event => {
      if (!active()) return fail();
      let batch: unknown;
      try { if (typeof event.data !== "string" || event.data.length > 1_000_000) return fail(); batch = JSON.parse(event.data); } catch { return fail(); }
      if (!Array.isArray(batch) || batch.length > 10_000) return fail();
      for (const item of batch) {
        if (!active()) return;
        if (!item || typeof item !== "object") return fail();
        const m = item as Record<string, unknown>;
        if (m.T === "error") return fail([400,401,402,404,405,409,410].includes(Number(m.code)));
        if (m.T === "success" && m.msg === "authenticated") {
          if (this.authenticated) return fail();
          this.authenticated = true;
          this.selected=[];this.sync();
        }
        if (m.T === "subscription") {
          if (!this.authenticated || !Array.isArray(m.trades) || !this.symbols().every(symbol => (m.trades as unknown[]).includes(symbol)) ||
            !Array.isArray(m.quotes) || !this.symbols().every(symbol => (m.quotes as unknown[]).includes(symbol))) {if(this.updating)continue;return fail();}
          if (this.handshake) clearTimeout(this.handshake);
          this.handshake = null;
          this.subscribed = true; this.updating=false; this.attempt = 0; o.onState("subscribed");
        }
        if ((m.T === "c" || m.T === "x") && (typeof m.S==="string"&&this.symbols().includes(m.S))) return fail();
        // Quotes and bars are not executable last-trade prices. Only regular
        // sale prints are accepted; unknown conditions fail closed for that tick.
        if (m.T !== "t" || !this.subscribed || !(typeof m.S==="string"&&this.symbols().includes(m.S))) continue;
        const now = o.now(), timestamp = typeof m.t === "string" ? Date.parse(m.t) : NaN;
        if (typeof m.p !== "number" || !Number.isFinite(m.p) || m.p <= 0 ||
          typeof m.s !== "number" || !Number.isFinite(m.s) || m.s <= 0 ||
          !Array.isArray(m.c) || m.c.length === 0 || !m.c.every(c => c === "@" || c === " ") ||
          !Number.isFinite(now) || !Number.isFinite(timestamp) || timestamp <= (this.lastTimestamp.get(m.S) ?? -Infinity) ||
          timestamp > now || now - timestamp >= 60_000) continue;
        this.lastTimestamp.set(m.S, timestamp);
        o.onTick({symbol: m.S, price: m.p, timestamp, receivedAt: now, feed: "alpaca-iex"});
      }
    };
    return true;
  }
}
