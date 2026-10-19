/** Browser-safe trigger conversion. Prices are micro-dollars; P/L and margin are cents. */
export type TriggerInputMode="price"|"pnl";
export type TriggerBasis={entry:number;margin:number;leverage:number;side:"long"|"short"};
export function pnlTriggerPrice(p:TriggerBasis,amountCents:number,kind:"takeProfit"|"stopLoss"):number{
 if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error("P/L amount must be positive whole cents.");
 if(!Number.isSafeInteger(p.entry)||p.entry<=0||!Number.isSafeInteger(p.margin)||p.margin<=0||!Number.isInteger(p.leverage)||p.leverage<1||p.leverage>200)throw new Error("Invalid position basis.");
 // Exact rational rounding avoids intermediate floating point overflow and cancellation.
 const notional=BigInt(p.margin)*BigInt(p.leverage),direction=(p.side==="long"?1n:-1n)*(kind==="takeProfit"?1n:-1n);
 const numerator=BigInt(p.entry)*(notional+direction*BigInt(amountCents));
 if(numerator<=0n)throw new Error("Trigger price must be positive.");
 const rounded=(numerator+notional/2n)/notional;
 const result=Number(rounded);
 if(!Number.isSafeInteger(result)||result<=0)throw new Error("Trigger price exceeds supported precision.");
 return result;
}
