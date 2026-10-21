"use client";
import {useEffect,useState} from "react";
import type {FingerprintPlayer} from "@/lib/device-fingerprints";
function Seen({at}:{at:string|null}){
 return at?<time dateTime={at}>{new Date(at).toLocaleString()}</time>:<>Not reported</>;
}
export default function PossibleAlts(){
 const [players,setPlayers]=useState<FingerprintPlayer[]>([]),[error,setError]=useState(""),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  setLoading(true);
  fetch("/api/admin/possible-alts",{cache:"no-store",signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error("Device reports unavailable.");
   const data=await response.json();
   setPlayers(data.players);setError("");
  }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return ()=>controller.abort();
 },[refresh]);
 return <section aria-labelledby="possible-alts-title">
  <h3 id="possible-alts-title">Possible alts</h3>
  <p>Shared browser fingerprints are a clue, not proof. Shared devices, collisions and spoofed reports are possible. These reports never block accounts or change gameplay.</p>
  <button disabled={loading} onClick={()=>setRefresh(n=>n+1)}>Refresh device reports</button>
  {error?<p role="status">{error}</p>:loading?<p role="status">Loading device reports…</p>:<table>
   <thead><tr><th scope="col">Player</th><th scope="col">First seen</th><th scope="col">Last seen</th><th scope="col">Possible alts</th></tr></thead>
   <tbody>{players.map(player=><tr key={player.publicId}>
    <th scope="row">{player.name}</th><td><Seen at={player.firstSeen}/></td><td><Seen at={player.lastSeen}/></td>
    <td>{player.possibleAlts.length?player.possibleAlts.map(alt=><p key={alt.publicId}><strong>{alt.name}</strong><br/>First seen <Seen at={alt.firstSeen}/><br/>Last seen <Seen at={alt.lastSeen}/></p>):"No matches reported"}</td>
   </tr>)}</tbody>
  </table>}
 </section>;
}
