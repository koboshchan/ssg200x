import type {MarketSymbols} from "@/app/market-symbol-picker";
type Flags=Partial<Record<"stocks"|"forex"|"cryptoSpot"|"cryptoPerps",boolean>>;
/** Hides listings whose feature is disabled. Held positions stay in the portfolio, not the picker. */
export function visibleMarketSymbols(ms:MarketSymbols,f:Flags):MarketSymbols{
 const crypto=f.cryptoSpot===false&&f.cryptoPerps===false;
 return {...ms,crypto:crypto?[]:ms.crypto,stocks:f.stocks===false?[]:ms.stocks,forex:f.forex===false?[]:(ms.forex??[])};
}
