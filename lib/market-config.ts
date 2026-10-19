/** Explicit allowlist. Change here to update trading, charts and history jobs together.
 * Do not silently replace unavailable USD markets or add stablecoins.
 */
export const MARKET_CONFIG={
 quoteCurrency:"USD",
 symbols:["BTC","ETH","BNB","XRP","SOL","ZEC","HYPE","DOGE","LINK","ADA","NEAR","XLM","BCH","LTC","UNI","AVAX","SUI","HBAR","TAO","SHIB"],
} as const;
export type MarketSymbol=typeof MARKET_CONFIG.symbols[number];
export function coinbaseProduct(symbol:MarketSymbol){return `${symbol}-${MARKET_CONFIG.quoteCurrency}` as const;}
