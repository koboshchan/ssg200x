/** Explicit allowlist. Change here to update trading, charts and live collection together.
 * Do not silently replace unavailable USD markets or add stablecoins.
 */
export const MARKET_CONFIG={
 quoteCurrency:"USD",
 symbols:["BTC","ETH","BNB","XRP","SOL","LTC"],
} as const;
export type MarketSymbol=typeof MARKET_CONFIG.symbols[number];
export function coinbaseProduct(symbol:MarketSymbol){return `${symbol}-${MARKET_CONFIG.quoteCurrency}` as const;}

/** Separate equity metadata. Never used to expand Coinbase subscriptions. */
export {STOCK_SYMBOLS as EQUITY_SYMBOLS,STOCK_INSTRUMENT as EQUITY_METADATA} from "./stock-config";
