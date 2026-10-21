"use client";
import type {PublicRoom} from "../lib/public";
import type {PokerMenuModeration} from "./poker-player-menu";
// Gating only. Requests are sent by the poker-kick-request listener in room-client.
export function usePokerModeration(room:PublicRoom|null,connected:boolean,pending:boolean):PokerMenuModeration{
 const disabledReason=!connected?"Reconnect to use player actions.":!room?"Loading table.":room.me.admin?undefined:room.me.seat<0?"Take a seat to start a vote.":room.street!=="waiting"?"Vote kicks are available between hands.":!room.seats.some(s=>s&&!s.ready&&!s.sitOut)?"Vote kicks start only while someone is not ready.":room.seats.filter(Boolean).length<3?"A vote needs at least three seated players.":room.pokerKickVote?.status==="active"?"A vote is already active.":(room.me.pokerKickCooldownUntil??0)>(room.serverNow??Date.now())?"Wait for your vote-kick cooldown.":undefined;
 return {pending,disabledReason};
}
