import {rooms} from "./db";
import {leaderboardSnapshot} from "./leaderboard";
import {currentNamedRoom} from "./server-names";
// Anonymous read only, with fresh Clerk labels on every request. No saved
// leaderboard/name TTL; no readRoom/visit or finance/game state mutations.
export async function getLeaderboard(){
 const room=await(await rooms()).findOne({_id:"main"},{projection:{
  _id:0,members:1,seats:1,street:1,quotes:1,blackjackTables:1,roulette:1,
 }});
 return leaderboardSnapshot(room?await currentNamedRoom(room):null);
}
