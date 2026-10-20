import {isStockSymbol, type StockSymbol} from "./stock-config";
import {regularStockSession, type StockClock, type StockSession} from "./stock-session";
export type StockTick = {symbol: StockSymbol; price: number; timestamp: number; receivedAt: number; feed: "alpaca-iex"};
export type StockExecutionState = {
  symbol: StockSymbol;
  /** Persisted ownership expiry is required at execution time across workers. */
  leaseUntil?: number;
  connected: boolean; leader: boolean; authorized: boolean;
  /** Unknown halt/corporate-action state must never be treated as clear. */
  halt: "clear" | "halted" | "unknown"; corporateActionsReconciled: boolean;
  tick: StockTick | null; clock: StockClock | null; sessions: readonly StockSession[];
};
export function stockExecutionPolicy(state: StockExecutionState, now: number) {
  const deny = (reason: string) => ({executable: false as const, reason});
  if (!isStockSymbol(state.symbol)) return deny("unsupported_stock");
  if (!Number.isFinite(now)) return deny("invalid_time");
  if (!state.authorized) return deny("unauthorized_feed");
  if (state.leaseUntil!==undefined&&(!Number.isFinite(state.leaseUntil)||now>=state.leaseUntil)) return deny("lease_expired");
  if (!state.connected || !state.leader) return deny("disconnected");
  if (state.halt !== "clear") return deny("halt_unknown_or_active");
  if (!state.corporateActionsReconciled) return deny("corporate_action_unreconciled");
  const session = regularStockSession(state.sessions, state.clock, now);
  if (!session) return deny("closed_or_calendar_unverified");
  const t = state.tick;
  if (!t || t.symbol !== state.symbol || t.feed !== "alpaca-iex" || !Number.isFinite(t.price) || t.price <= 0 ||
    !Number.isFinite(t.timestamp) || !Number.isFinite(t.receivedAt) ||
    t.timestamp > now || t.receivedAt > now || t.timestamp < session.open ||
    now - t.timestamp > 15_000 || now - t.receivedAt > 15_000) return deny("stale_or_invalid_tick");
  return {executable: true as const, reason: "fresh_regular_session", price: t.price};
}
// All actions (open/manual close/TP/SL/liquidation) must call the same guard.
// This pure function never releases margin, closes positions or removes triggers.
