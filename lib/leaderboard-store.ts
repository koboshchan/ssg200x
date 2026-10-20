import {rooms} from "./db";
import {cachedLeaderboard} from "./leaderboard";
// Do not use readRoom/visit: those can initialize state or register a visitor.
// This path has no writes, game ticks, price fetches or Clerk calls.
export const getLeaderboard=cachedLeaderboard(async()=>{
 return (await rooms()).findOne({_id:"main"},{projection:{
  _id:0,members:1,seats:1,street:1,quotes:1,blackjackTables:1,roulette:1,
 }});
});
