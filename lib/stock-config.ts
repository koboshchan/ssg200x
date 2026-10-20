/** Server-only prerequisites, never import provider credentials into client code. */
export const STOCK_INSTRUMENT = {
  symbol: "AAPL", assetClass: "us_equity", currency: "USD",
  feed: "alpaca-iex", coverage: "IEX single venue, not consolidated NBBO",
  recency: "real-time", websocketAvailable: true,
  timeZone: "America/New_York",
} as const;
export const ALPACA_IEX_URL = "wss://stream.data.alpaca.markets/v2/iex";
export type StockEnvironment = Readonly<Record<string, string | undefined>>;
export function stockPrerequisites(env: StockEnvironment) {
  const blockers: string[] = [];
  if (!env.ALPACA_KEY_ID?.trim() || !env.ALPACA_SECRET?.trim()) blockers.push("missing_credentials");
  if (!env.AAPL_REDISTRIBUTION_APPROVAL_REFERENCE?.trim()) blockers.push("missing_redistribution_permission");
  // Adapter fixtures are implemented, but shared execution/calendar hooks are not.
  blockers.push("stock_runtime_not_integrated");
  return {enabled: false as const, symbol: STOCK_INSTRUMENT.symbol, blockers};
}
