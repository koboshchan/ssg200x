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
 assert.deepEqual(visibleHubGames({games:false}).map(g=>g.key),["poker","blackjack","doudizhu","roulette"]);
 assert.equal(visibleHubGames(Object.fromEntries(HUB_GAMES.map(g=>[g.key,false]))).length,0);
});
test("all game deep links select Games, unrelated sections never do",()=>{
 for(const path of ["/poker","/poker/table","/blackjack","/doudizhu","/roulette","/games"])assert.equal(isGamePath(path),true);
 for(const path of ["/markets","/wallet","/polymarket","/gamesmanship","/"])assert.equal(isGamePath(path),false);
});
