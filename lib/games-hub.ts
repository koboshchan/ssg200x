import type {FeatureKey} from "./feature-catalog";
export const HUB_GAMES=[
 {key:"poker",title:"Poker",detail:"Texas hold’em",href:"/poker",art:"cards"},
 {key:"blackjack",title:"Blackjack",detail:"Beat the dealer",href:"/blackjack",art:"blackjack"},
 {key:"doudizhu",title:"Dou Dizhu",detail:"Three players. One landlord.",href:"/doudizhu",art:"doudizhu"},
 {key:"roulette",title:"Roulette",detail:"Let it spin",href:"/roulette",art:"roulette"},
 {key:"plinko",title:"Plinko",detail:"Find your multiplier",href:"/games?game=plinko",art:"plinko"},
 {key:"hilo",title:"Hi-Lo",detail:"Higher or lower?",href:"/games?game=hilo",art:"hilo"},
 {key:"mines",title:"Mines",detail:"A little luck. A little nerve.",href:"/games?game=mines",art:"mines"},
 {key:"dice",title:"Dice",detail:"Pick your number",href:"/games?game=dice",art:"dice"},
 {key:"chicken",title:"Chicken Road",detail:"One more crossing",href:"/games?game=chicken",art:"chicken"}
] as const;
export function visibleHubGames(flags:Partial<Record<FeatureKey,boolean>>){
 return HUB_GAMES.filter(g=>flags[g.key]!==false&&(!g.href.startsWith("/games?")||flags.games!==false));
}
export function isGamePath(path:string){return ["/games","/poker","/blackjack","/doudizhu","/roulette"].some(p=>path===p||path.startsWith(p+"/"));}
