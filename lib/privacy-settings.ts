import {ensure} from "./errors";
import {register} from "./poker";
import {triggerInputMode} from "./trading-settings";
import type {Room,Identity} from "./types";
export {hideFromLeaderboard} from "../runtime/leaderboard-privacy.mjs";
export function setLeaderboardPrivacy(room:Room,who:Identity,hidden:boolean){
 ensure(typeof hidden==="boolean","Invalid leaderboard privacy setting.");
 const member=register(room,who);
 member.settings={triggerInputMode:triggerInputMode(member),...member.settings,hideFromLeaderboard:hidden};
}
