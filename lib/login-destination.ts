import {HUB_GAMES} from "./games-hub";
// Only known local game pages are valid login destinations. Never accept URLs.
const paths=new Set<string>(["/games",...HUB_GAMES.map(g=>g.href)]);
export function safeGameDestination(value:string|null|undefined):string|null{
 if(!value||value.startsWith("//")||/[\\\x00-\x20]/.test(value))return null;
 try{
  const url=new URL(value,"https://local.invalid");
  if(url.origin!=="https://local.invalid"||!value.startsWith("/")||!paths.has(url.pathname))return null;
  if(url.pathname==="/games"&&url.searchParams.has("game")){
   const kind=url.searchParams.get("game");
   if(paths.has("/games/"+kind))return "/games/"+kind;
  }
  return url.pathname;
 }catch{return null;}
}
