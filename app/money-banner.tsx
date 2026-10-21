"use client";
export type MoneyNotice={id:string;amount:number;sender:string;kind:"payment"};
export function MoneyBanner({notice}:{notice:MoneyNotice}){
 const amount=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(notice.amount/100);
 return <div className="money-treasure" role="status" aria-live="polite"><svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><g className="money-coins"><circle cx="19" cy="14" r="5"/><circle cx="31" cy="9" r="4"/><path d="M19 11v6m12-10v4"/></g><path d="M7 27h34v15H7zM7 27l5-10h24l5 10M15 27v15m18-15v15" fill="var(--surface)"/><path d="M21 25h6v9h-6z" fill="var(--surface)"/></svg><div><small>Money received</small><strong>+{amount}</strong><span>{"From "+notice.sender}</span></div></div>;
}
