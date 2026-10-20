import type {Metadata} from "next";
import {getLeaderboard} from "@/lib/leaderboard-store";
export const metadata:Metadata={title:"Leaderboard · ssg200x"};
export const dynamic="force-dynamic";
const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
export default async function LeaderboardPage(){
 const snapshot=await getLeaderboard().catch(()=>null);
 const main=<main className="game-main public-leaderboard"><section className="standings"><p className="eyebrow">BRAGGING RIGHTS</p><h1>Leaderboard</h1><p>Play-money net worth. Wallet, poker chips, unsettled game stakes, spot holdings and perpetual equity at the latest available prices.</p>
 {snapshot?<><p className="fine">Snapshot from <time dateTime={new Date(snapshot.updatedAt).toISOString()}>{new Date(snapshot.updatedAt).toLocaleString("en-US",{timeZone:"UTC",timeZoneName:"short"})}</time>. Cached for 15 seconds; reload to refresh.</p>
 {snapshot.rows.length?<table><caption className="sr-only">Players ranked by net worth</caption><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Net worth</th></tr></thead><tbody>{snapshot.rows.map(row=><tr key={row.rank}><td>{row.rank}</td><th scope="row"><span className="leaderboard-player"><span className="avatar" aria-hidden="true">{row.avatar}</span><span>{row.name}</span></span></th><td className="leaderboard-worth">{money(row.netWorth)}</td></tr>)}</tbody></table>:<p className="empty">No players yet.</p>}</>:<p className="empty" role="status">The leaderboard is temporarily unavailable. Please try again shortly.</p>}
 </section></main>;
 return main;
}
