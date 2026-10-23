/** Price precision for market prices in dollar units. */
export function pricePrecision(price:number):number{
 const a=Math.abs(price);
 if(!Number.isFinite(a)||a>=1||a===0)return 2;
 return Math.min(8,Math.max(4,Math.ceil(-Math.log10(a))+3));
}
export function formatMarketPrice(price:number):string{
 if(!Number.isFinite(price))return "Unavailable";
 const p=pricePrecision(price),a=Math.abs(price);
 if(a>0&&a<1e-8)return (price<0?"-":"")+"<$0.00000001";
 return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:p,maximumFractionDigits:p}).format(price);
}
