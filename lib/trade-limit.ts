/** Dollar caps must stay positive and exactly representable by the cents ledger. */
export function validTradeLimit(dollars:number){
 const cents=dollars*100,rounded=Math.round(cents);
 return Number.isFinite(dollars)&&dollars>0&&Number.isSafeInteger(rounded)&&rounded>0&&Math.abs(cents-rounded)<1e-7;
}
