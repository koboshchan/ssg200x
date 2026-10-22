import {test} from "node:test";
import assert from "node:assert/strict";
import {HUB_GAMES,visibleHubGames,isGamePath} from "../lib/games-hub";
test("hub contains every implemented game, with unique stable deep links",()=>{
 assert.equal(HUB_GAMES.length,9);
 assert.equal(new Set(HUB_GAMES.map(g=>g.href)).size,9);
 assert.deepEqual(HUB_GAMES.slice(0,4).map(g=>g.href),["/poker","/blackjack","/doudizhu","/roulette"]);
});
test("disabled individual games and the minigame master switch hide banners",()=>{
 assert.ok(!visibleHubGames({poker:false}).some(g=>g.key==="poker"));
 assert.equal(visibleHubGames({games:false}).length,0);
 assert.equal(visibleHubGames(Object.fromEntries(HUB_GAMES.map(g=>[g.key,false]))).length,0);
});
test("all game deep links select Games, unrelated sections never do",()=>{
 for(const path of ["/poker","/poker/table","/blackjack","/doudizhu","/roulette","/games"])assert.equal(isGamePath(path),true);
 for(const path of ["/markets","/wallet","/polymarket","/gamesmanship","/"])assert.equal(isGamePath(path),false);
});
test("minigames have dedicated pages, legacy queries use Next redirects, and single pages hide tabs",async()=>{
 const {readFileSync}=await import("node:fs");
 for(const game of HUB_GAMES.slice(4))assert.equal(game.href,"/games/"+game.key);
 const page=readFileSync("app/(room)/games/[game]/page.tsx","utf8");
 assert.match(page,/<GamesClient initialKind={kind} singleGame/);
 assert.match(readFileSync("app/(room)/games/page.tsx","utf8"),/redirect\("\/games\/"/);
 assert.match(readFileSync("app/games-client.tsx","utf8"),/!singleGame\?<div className={styles.tabs}/);
});
test("cards are inline SVG only, hover is pointer gated and reduced motion neutralizes transforms",async()=>{
 const {readFileSync}=await import("node:fs");
 const hub=readFileSync("app/games-hub.tsx","utf8"),css=readFileSync("app/games-hub.module.css","utf8");
 assert.match(hub,/<svg /);assert.doesNotMatch(hub,/<img|<image|url\(|data:image/);
 assert.match(css,/@media\(hover:hover\) and \(pointer:fine\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
