/* Isolated developer verification. Compile stock modules to compiled/ first.
 * Supply runtime credentials as JSON on stdin, never command arguments/files
 * in source/build context. Output is strictly allowlisted, no raw errors/frames.
 */
const {AlpacaIexFeed} = require("../compiled/stock-feed.js");
const {STOCK_SYMBOLS} = require("../compiled/stock-config.js");
async function main() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 16_384) throw new Error("invalid_input");
  }
  const supplied = JSON.parse(input);
  for (const name of ["ALPACA_KEY_ID", "ALPACA_SECRET"]) {
    if (typeof supplied[name] !== "string" || !supplied[name].trim()) throw new Error("missing_credentials");
    process.env[name] = supplied[name].trim();
  }
  input = ""; supplied.ALPACA_KEY_ID = supplied.ALPACA_SECRET = "";
  const report = {
    symbols: [...STOCK_SYMBOLS], connections: 0, authenticatedAndSubscribed: false,
    clockVerified: false, marketOpen: null, providerTimestamp: null,
    nextOpen: null, nextClose: null,
    acceptedTrades: Object.fromEntries(STOCK_SYMBOLS.map(s => [s, 0])),
    observedQuotes: Object.fromEntries(STOCK_SYMBOLS.map(s => [s, 0])),
    liveRegularSessionTicksVerified: false,
  };
  const response = await fetch("https://paper-api.alpaca.markets/v2/clock", {
    headers: {"APCA-API-KEY-ID":process.env.ALPACA_KEY_ID,"APCA-API-SECRET-KEY":process.env.ALPACA_SECRET},
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("clock_request_failed");
  const clock = await response.json();
  if (typeof clock.is_open !== "boolean" ||
    [clock.timestamp,clock.next_open,clock.next_close].some(t => typeof t !== "string" || !Number.isFinite(Date.parse(t)))) throw new Error("invalid_clock");
  report.clockVerified = true; report.marketOpen = clock.is_open;
  report.providerTimestamp = clock.timestamp; report.nextOpen = clock.next_open; report.nextClose = clock.next_close;
  const feed = new AlpacaIexFeed({
    env:process.env, permitted:()=>true, isLeader:()=>true, now:()=>Date.now(),
    socket:url=>{
      report.connections++;
      const socket = new WebSocket(url);
      socket.addEventListener("message", event=>{
        // Diagnostic only, never prices or executable data. Count fresh quotes
        // only after complete subscription acknowledgement.
        try {
          const batch=JSON.parse(event.data);
          if (report.authenticatedAndSubscribed && Array.isArray(batch)) for(const m of batch) {
            if(m.T==="q" && STOCK_SYMBOLS.includes(m.S) && Number.isFinite(m.bp) && m.bp>0 &&
              Number.isFinite(m.ap) && m.ap>=m.bp && Number.isFinite(Date.parse(m.t)) &&
              Date.now()-Date.parse(m.t)>=0 && Date.now()-Date.parse(m.t)<=15_000) report.observedQuotes[m.S]++;
          }
        } catch {}
      });
      return socket;
    },
    onTick:tick=>report.acceptedTrades[tick.symbol]++,
    onState:state=>{if(state==="subscribed")report.authenticatedAndSubscribed=true;},
  });
  if (!feed.start()) throw new Error("feed_not_started");
  await new Promise(resolve=>setTimeout(resolve,12_000));
  feed.stop();
  report.liveRegularSessionTicksVerified = report.marketOpen === true && STOCK_SYMBOLS.every(s=>report.acceptedTrades[s]>0);
  console.log(JSON.stringify(report));
  if (!report.authenticatedAndSubscribed || report.connections!==1) process.exitCode=1;
}
main().catch(()=>{console.log(JSON.stringify({ok:false,error:"isolated_stock_check_failed"}));process.exitCode=1;});
