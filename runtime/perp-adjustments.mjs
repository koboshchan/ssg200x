/** Cents are indivisible. The actual selected margin (rounded down) determines
 * every allocation, not the requested percentage. Remainder retains all dust.
 * For modern positions posted = collateral + openingFee on BOTH portions.
 * Partial closing fees round up once so splitting cannot erase sub-cent fees.
 */
export function positionSlice(p,percentBps){
 if(!Number.isInteger(percentBps)||percentBps<1||percentBps>10000)throw Error("Choose more than 0% and at most 100%.");
 const margin=Number(BigInt(p.margin)*BigInt(percentBps)/10000n);
 if(margin<1)throw Error("Selected portion is below one cent of margin. Increase the percentage.");
 const allocate=n=>Number(BigInt(n)*BigInt(margin)/BigInt(p.margin));
 const slice={...p,margin};
 for(const key of ["postedMargin","collateral","openingFee"])if(p[key]!==undefined)slice[key]=allocate(p[key]);
 if(p.collateral!==undefined&&p.postedMargin!==undefined){slice.collateral=margin;slice.openingFee=slice.postedMargin-margin;}
 if(percentBps<10000)slice.closingFeeRoundUp=true;
 const remainder={...p,margin:p.margin-margin,revision:(p.revision??0)+1};
 for(const key of ["postedMargin","collateral","openingFee"])if(p[key]!==undefined)remainder[key]=p[key]-slice[key];
 return {slice,remainder};
}
/** Same-leverage notional-weighted harmonic entry. Round by <1 micro-dollar
 * AGAINST the trader, not nearest: repeated increases cannot mint rounding P/L,
 * including on cheap assets. BigInt intermediates never overflow Number. */
export function increasedEntry(p,addedMargin,mark){
 const n=BigInt(p.margin+addedMargin)*BigInt(p.entry)*BigInt(mark);
 const d=BigInt(p.margin)*BigInt(mark)+BigInt(addedMargin)*BigInt(p.entry);
 return Number((n+(p.side==="long"?d-1n:0n))/d);
}
