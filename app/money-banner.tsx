"use client";
import "./airdrop-announcement.css";
export type MoneyNotice={id:string;amount:number;sender:string;kind:"payment"};
export function MoneyBanner({notice}:{notice:MoneyNotice}){
 const amount=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(notice.amount/100);
 return <div className="airdrop-status" role="status" aria-live="polite" aria-atomic="true"><div className="airdrop-announcement play payment-announcement"><svg className="airdrop-icon" viewBox="0 0 44 48" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true"><g className="payment-coins"><circle cx="17" cy="15" r="5" fill="var(--airdrop-soft)"/><circle cx="29" cy="10" r="4" fill="var(--airdrop-soft)"/><path d="M17 12v6m12-10v4"/></g><path d="M6 27h32v15H6zM6 27l5-9h22l5 9M14 27v15m16-15v15" fill="var(--airdrop-soft)"/><path d="M19 25h6v9h-6z" fill="var(--airdrop-panel)"/></svg><span className="airdrop-message">Money received · {amount} from {notice.sender}</span></div></div>;
}
