"use client";
import {advancementCount,ADVANCEMENTS,type AdvancementState} from "../lib/advancements-shared";
const styles={"award": "adv-award", "badge": "adv-badge", "copy": "adv-copy", "heading": "adv-heading", "icon": "adv-icon", "list": "adv-list", "main": "adv-main", "progress": "adv-progress", "rules": "adv-rules", "tier": "adv-tier", "toast": "adv-toast", "total": "adv-total", "track": "adv-track"};
const drawings:Record<string,React.ReactNode>={
 crack:<><path d="M12 3 8 11h7l-4 10M6 4H3v5m15 11h3v-5"/><path d="m4 15 3 2m10-10 3 2"/></>,
 ball:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M10 10c0-2 4-2 4 0s-4 2-4 4 4 2 4 0-4-2-4-4"/></>,
 cloud:<><path d="M6 15a4 4 0 0 1-1-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 2 9M8 18l-1 3m6-3-1 3m6-3-1 3"/><path d="m13 10-3 4h4l-3 4"/></>,
 target:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m4 20 16-16m-5 0h5v5M10 12h4"/></>,
 dice:<><rect x="3" y="3" width="14" height="14" rx="3"/><path d="M8 21h10a3 3 0 0 0 3-3V8M7 7h.01M13 13h.01M7 13h.01M13 7h.01M10 10h.01"/></>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 5v7l4 3M3 12h2m14 0h2M12 19v2M8 2l-3 2m11-2 3 2"/></>,
 clover:<><path d="M12 11C3 12 2 5 6 4c3-1 5 2 6 4 1-2 3-5 6-4 4 1 3 8-6 7-9 1-8 8-4 8 2 0 3-2 4-4 1 2 2 4 4 4 4 0 5-7-4-8Zm0 4v7"/><path d="m3 2 18 20"/></>,
 crown:<><path d="m3 7 4 4 5-7 5 7 4-4-2 12H5L3 7ZM6 22h12M9 15h6"/><circle cx="12" cy="3" r="1"/></>,
};
export function AdvancementIcon({icon}:{icon:string}){return <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawings[icon]}</svg>;}
export function AdvancementToast({tiers,onDismiss}:{tiers:number[];onDismiss:()=>void}){
 const awards=ADVANCEMENTS.filter(a=>tiers.includes(a.tier));if(!awards.length)return null;
 return <aside className={styles.toast} role="status" aria-live="polite"><AdvancementIcon icon={awards.at(-1)!.icon}/><div><small>Advancement unlocked</small>{awards.map(a=><strong key={a.tier}>{a.name}</strong>)}</div><button onClick={onDismiss} aria-label="Dismiss advancement notification">×</button></aside>;
}
export default function AdvancementsView({state}:{state:AdvancementState}){
 const count=ADVANCEMENTS.filter(a=>state.unlocked[a.tier]!==undefined).length;
 return <main className={styles.main}><header className={styles.heading}><div><p className="eyebrow">Roulette · Advancements</p><h1>A streak to remember.</h1><p>Not every milestone is a winning one.</p></div><div className={styles.total}><strong>{count}<span> / 8</span></strong><span>unlocked</span></div></header>
 <section className={styles.progress} aria-label="Current losing streak"><div><span>Current losing streak</span><strong>{state.streak} <small>{state.streak===1?"round":"rounds"}</small></strong></div><div className={styles.track} role="progressbar" aria-label="Progress to final advancement" aria-valuemin={0} aria-valuemax={14} aria-valuenow={Math.min(state.streak,14)}><span style={{width:Math.min(state.streak/14,1)*100+"%"}}/></div><p>Even-money bets only. A qualifying win breaks the streak.</p></section>
 <section className={styles.list} aria-label="Advancements">{ADVANCEMENTS.map(a=>{const at=state.unlocked[a.tier],unlocked=at!==undefined;return <article className={styles.award} data-unlocked={unlocked} key={a.tier}><div className={styles.icon}><AdvancementIcon icon={a.icon}/></div><div className={styles.copy}><span className={styles.tier}>Tier {a.tier-6} · {a.tier} rounds</span><h2>{a.name}</h2><p>Lose {a.tier} qualifying roulette rounds in a row.</p>{unlocked?<time dateTime={new Date(at).toISOString()}>Unlocked {new Date(at).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</time>:null}</div><span className={styles.badge}>{unlocked?"×"+advancementCount(state,a.tier):"Locked"}</span></article>;})}</section>
 <details className={styles.rules}><summary>What counts toward a streak?</summary><p>Place at least one real chip on red / black, odd / even, or 1–18 / 19–36. A round counts as a loss only when all your qualifying bets lose. Any qualifying win resets your streak, even if you lost money overall. Zero loses on all six selections.</p><p>Rounds without qualifying bets pause your streak. Straight, dozen and column bets do not affect it. Fake or nonstandard chips never count. Progress updates after the result animation ends. Each new streak can earn these again. Counts stay yours after a win. Cash rewards are granted only on your first unlock; amounts are not set yet.</p></details></main>;
}
