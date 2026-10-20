/**
 * Server-side prerequisite inspection only. Not a feed or an execution adapter.
 * Do not add AAPL to the crypto allowlist or expose these inputs to a client.
 * Licensing references and the remaining gates are in docs/aapl-data-gates.md.
 */
export const STOCK_INSTRUMENT = {
  symbol: "AAPL",
  assetClass: "us_equity",
  currency: "USD",
  feed: "alpaca-iex",
  coverage: "IEX single venue, not consolidated NBBO",
  timeZone: "America/New_York",
} as const;

export type StockEnvironment = Readonly<Record<string, string | undefined>>;

export function stockPrerequisites(env: StockEnvironment) {
  const blockers: string[] = [];
  if (!env.APCA_API_KEY_ID?.trim() || !env.APCA_API_SECRET_KEY?.trim()) {
    blockers.push("missing_credentials");
  }
  // This reference must identify actual written permission, not a boolean opt-in.
  if (!env.AAPL_REDISTRIBUTION_APPROVAL_REFERENCE?.trim()) {
    blockers.push("missing_redistribution_permission");
  }
  // Even configured credentials/permission cannot accidentally enable unfinished code.
  blockers.push("stock_execution_adapter_not_implemented");
  return { enabled: false as const, symbol: STOCK_INSTRUMENT.symbol, blockers };
}
