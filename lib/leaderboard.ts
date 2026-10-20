import {assetsMarket} from "./finance";
import {blackjackMemberAssets} from "./blackjack";
import {rouletteAssets} from "./roulette";
import {active} from "./poker";
import type {Room} from "./types";

export type LeaderboardRow={rank:number;name:string;avatar:string;netWorth:number};
export type LeaderboardSnapshot={updatedAt:number;rows:LeaderboardRow[]};
// Display names are public, but never fall back to an email address or user ID.
export function displayName(name:string){
 const clean=name.replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,80);
 return !clean||clean.includes("@")||/\buser_[a-z0-9]+\b/i.test(clean)?"Player":clean;
}
export function leaderboardSnapshot(room:Room|null,now=Date.now()):LeaderboardSnapshot{
 const rows=(room?.members||[]).map(member=>{
  const name=displayName(member.name);
  const seat=room!.seats.find(s=>s?.userId===member.id);
  const netWorth=member.wallet+assetsMarket(room!,member)+blackjackMemberAssets(room!,member.id)+rouletteAssets(room!,member.id)+(seat?seat.stack+(active(room!)?seat.committed:0):0);
  // Initials avatars have no external URL, tracking request or embedded account identifier.
  const avatar=Array.from(name.split(/\s+/).map(word=>Array.from(word)[0]).join("")).slice(0,2).join("").toUpperCase();
  return {name,avatar,netWorth};
 }).sort((a,b)=>b.netWorth-a.netWorth||a.name.localeCompare(b.name));
 return {updatedAt:now,rows:rows.map((row,index)=>({rank:index+1,...row}))};
}
export function cachedLeaderboard(load:()=>Promise<Room|null>,now=Date.now,ttl=15_000){
 let cached:LeaderboardSnapshot|undefined,expires=0,pending:Promise<LeaderboardSnapshot>|undefined;
 return async function getSnapshot(){
  if(cached&&now()<expires)return cached;
  if(pending)return pending;
  pending=load().then(room=>{
   cached=leaderboardSnapshot(room,now());expires=now()+ttl;return cached;
  }).finally(()=>{pending=undefined;});
  return pending;
 };
}
