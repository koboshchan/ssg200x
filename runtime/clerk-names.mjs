import {clerkReads} from "./clerk-reads.mjs";
// Only server-fetched Clerk profiles enter this resolver. Never pass handshake/client data.
const clean=value=>typeof value==="string"?value.replace(/[\u0000-\u001f\u007f]/g,"").trim():"";
const label=value=>{const name=clean(value);return name&&!name.includes("@")?name.slice(0,80):"";};
export function clerkDisplayName(user){
 if(!user)return "Player";
 const first=clean(user.firstName),last=clean(user.lastName);
 // Backend User has no fullName getter in some SDK versions. A last name alone
 // is not a full name and must not outrank username.
 const full=label(user.fullName)||label(first?[first,last].filter(Boolean).join(" "):"");
 // Never derive a public label from any part of a private email address.
 return full||label(first)||label(user.username)||"Player";
}
export async function loadClerkProfiles(clerk,ids){
 const unique=[...new Set(ids.filter(id=>typeof id==="string"&&id))],profiles=new Map();
 // Five-second presentation cache and cross-caller in-flight batches. Failures
 // use neutral labels rather than breaking an already authenticated snapshot.
 const data=await clerkReads(clerk).profiles(clerk,unique).catch(()=>[]);
 for(const user of data)if(user&&unique.includes(user.id)){
  let avatar=null;
  try{const url=new URL(user.imageUrl);if(url.protocol==="https:"&&url.hostname==="img.clerk.com")avatar=url.href;}catch{}
  profiles.set(user.id,{name:clerkDisplayName(user),avatar});
 }
 return profiles;
}
export const profileName=(profiles,id)=>profiles.get(id)?.name||"Player";
export function roomWithClerkNames(room,profiles){
 // A presentation-only copy. Never write fetched profile labels into financial state.
 const r=structuredClone(room);
 r.members=r.members.map(m=>({...m,name:profileName(profiles,m.id)}));
 const byPublicId=new Map(r.members.map(m=>[m.publicId,m.name]));
 const historyText=text=>{
  if(text.includes("[[player:"))return text.replace(/\[\[player:([a-f0-9]{16})\]\]/g,(_,id)=>byPublicId.get(id)||"Player");
  // Old rows did not store actor IDs. Matching a legacy label is ambiguous and
  // cannot prove identity, even when it happens to equal a current member name.
  return text.replace(/^.+?( (?:wins \$|returned \$|takes seat |removed;|folds\b|checks\b|calls\b|raises to\b))/,"Player$1")
   .replace(/^Host adjusted .+?'s cash by /,"Host adjusted Player's cash by ")
   .replace(/^(Sent \$[\d,.]+ to |Received \$[\d,.]+ from ).+$/,"$1Player");
 };
 r.log=(r.log||[]).map(historyText);
 for(const m of r.members)m.activity=(m.activity||[]).map(historyText);
 if(r.roulette)for(const h of r.roulette.history||[])for(const w of h.winners||[])w.name=byPublicId.get(w.publicId)||"Player";
 return r;
}

export const playerReference=member=>member?"[[player:"+member.publicId+"]]":"Player";
