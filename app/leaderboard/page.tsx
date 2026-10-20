import type {Metadata} from "next";
import {auth,currentUser} from "@clerk/nextjs/server";
import {UserButton} from "@clerk/nextjs";
import {getLeaderboard} from "@/lib/leaderboard-store";
import {configured} from "@/lib/api";
import {verifiedGoogleEmail} from "@/lib/google-identity";
import {Shell} from "../room-client";
export const metadata:Metadata={title:"Leaderboard · ssg200x"};
export const dynamic="force-dynamic";
const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
// Only two booleans leave the server: whether an eligible signed-in user is looking, and admin. Anonymous
// visitors, an unconfigured Clerk or any Clerk failure all render the logged-out page.
async function viewer():Promise<{admin:boolean}|null>{
 if(!configured())return null;
 try{
  const {userId}=await auth();
  if(!userId)return null;
  const user=await currentUser();
  if(!user||!verifiedGoogleEmail(user))return null;
  return {admin:user.privateMetadata?.admin===true};
 }catch{return null;}
}
export default async function LeaderboardPage(){
 const [snapshot,who]=await Promise.all([getLeaderboard().catch(()=>null),viewer()]);
 const main=<main className="game-main public-leaderboard"><section className="standings"><p className="eyebrow">BRAGGING RIGHTS</p><h1>Leaderboard</h1><p>Play-money net worth. Wallet, poker chips, unsettled game stakes, spot holdings and perpetual equity at the latest available prices.</p>
 {snapshot?<><p className="fine">Snapshot from <time dateTime={new Date(snapshot.updatedAt).toISOString()}>{new Date(snapshot.updatedAt).toLocaleString("en-US",{timeZone:"UTC",timeZoneName:"short"})}</time>. Cached for 15 seconds; reload to refresh.</p>
 {snapshot.rows.length?<table><caption className="sr-only">Players ranked by net worth</caption><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Net worth</th></tr></thead><tbody>{snapshot.rows.map(row=><tr key={row.rank}><td>{row.rank}</td><th scope="row"><span className="leaderboard-player"><span className="avatar" aria-hidden="true">{row.avatar}</span><span>{row.name}</span></span></th><td className="leaderboard-worth">{money(row.netWorth)}</td></tr>)}</tbody></table>:<p className="empty">No players yet.</p>}</>:<p className="empty" role="status">The leaderboard is temporarily unavailable. Please try again shortly.</p>}
 </section></main>;
 if(who)return <Shell signedIn admin={who.admin} account={<UserButton/>}>{main}</Shell>;
 return <><header className="mast"><a className="wordmark" href="/">ssg200x</a><nav className="nav-links" aria-label="Sections"><a href="/leaderboard" aria-current="page">Leaderboard</a><a href="/">Sign in</a></nav></header>
 {main}<footer><span>ssg200x · Play money only</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span></footer></>;
}
