import {doudizhuAssets} from "./doudizhu";
import {miniAssets} from "./minigames";
import {pokerStates} from "./poker-tables";
import {POKER_SEAT_COUNT,POKER_SEAT_ORDER} from "./poker-seats";
import {casinoLimits} from "./casino-limits";
import {isWholeCasinoAmount} from "./casino-amount";
import {playerReference} from "../runtime/clerk-names.mjs";
import {POKER_TURN_MS} from "./turn-timer";
import { randomInt, createHash } from "node:crypto";
import {rouletteAssets} from "./roulette";
import {blackjackTablesAssets} from "./blackjack";
import {showdownWinners} from "./poker-hand";
import {assetsBook} from "./finance";
import { ensure } from "./errors";
import type { Room, Seat, Identity, Member, Action, Payout } from "./types";
export const SMALL = 100, BIG = 200, STRADDLE = 500;
export const TURN_MS = POKER_TURN_MS, BREAK_MS = 5_000, IDLE_MS = 90_000;
export const READY_MS = 120_000;
const MAX_MEMBERS = 100;
export function freshRoom(): Room {
 return { _id: "main", version: 0, members: [], seats: Array(POKER_SEAT_COUNT).fill(null), button: -1, street: "waiting", handNumber: 0, board: [], deck: [], currentBet: 0, minRaise: BIG, pending: [], turn: null, deadline: null, nextDeal: null, readyDeadline: null, payouts: [], log: [], receipts: [] };
}
export function addLog(r: Room, text: string) { r.log = [text, ...r.log].slice(0,60); }
export function register(r: Room, who: Identity, now = Date.now()): Member {
 let m = r.members.find(m => m.id === who.id);
 if (!m) {
  ensure(r.members.length < MAX_MEMBERS, "This private room is full.", 409);
  m = { id: who.id, publicId: createHash("sha256").update(who.id).digest("hex").slice(0,16), name: who.name.slice(0,32) || "Player", email: who.email, approved: true, wallet: 100_000, joined: now };
  r.members.push(m);
 } else { ensure(!m.accessRevoked,"Room access revoked.",403); m.approved = true; }
 return m;
}
export function seatOf(r: Room, id: string) { return r.seats.findIndex(s => s?.userId === id); }
export function active(r: Room) { return r.street !== "waiting" && r.street !== "showdown"; }
function ordered(r: Room, after: number, test: (s: Seat) => boolean) {
 const out: number[] = [];
 const order = POKER_SEAT_ORDER.filter(i => i < r.seats.length);
 const start = order.indexOf(after as typeof order[number]);
 for (let n = 1; n <= order.length; n++) { const i = order[(start + n) % order.length]; const s = r.seats[i]; if (s && test(s)) out.push(i); }
 return out;
}
function next(r: Room, after: number, test: (s: Seat) => boolean) { return ordered(r, after, test)[0]; }
const contenders = (s: Seat) => s.inHand && !s.folded;
const canAct = (s: Seat) => contenders(s) && s.stack > 0;
export function pot(r: Room) { return r.seats.reduce((n,s) => n + (s?.committed ?? 0), (r.pokerBonus??0)+(r.pokerDead??[]).reduce((n,v)=>n+v,0)); }
function put(s: Seat, amount: number) { const n = Math.min(amount, s.stack); s.stack -= n; s.bet += n; s.committed += n; }
function setTurn(r: Room, i: number | null, now: number) { r.turn = i; r.deadline = i === null ? null : now + TURN_MS; }
export function shuffled(rng: (max: number) => number = randomInt) {
 const deck = [..."shcd"].flatMap(s => [..."23456789TJQKA"].map(rank => rank + s));
 for (let i = deck.length - 1; i > 0; i--) { const j = rng(i+1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
 return deck;
}
function draw(r: Room) { ensure(r.deck.length, "Deck exhausted.", 500); return r.deck.pop()!; }
function revealStreet(r: Room) {
 draw(r);
 if (r.street === "preflop") { r.board.push(draw(r),draw(r),draw(r)); r.street = "flop"; }
 else if (r.street === "flop") { r.board.push(draw(r)); r.street = "turn"; }
 else { r.board.push(draw(r)); r.street = "river"; }
}
export function cashOut(r: Room, i: number) {
 const s = r.seats[i]; if (!s) return;
 ensure(!(active(r) && s.inHand), "You can only leave while out of a hand.", 409);
 const m = r.members.find(m => m.id === s.userId)!;
 m.wallet += s.stack; r.seats[i] = null;
}
/** Administrative removal is a cashout, NOT the idle-seat forfeiture policy.
 * Detached committed chips preserve their original side-pot contribution levels. */
export function kickPokerSeat(r:Room,i:number,now:number) {
 const s=r.seats[i];ensure(s,"Player is no longer seated.",409);
 const wasActive=active(r),wasTurn=r.turn===i;
 r.members.find(m=>m.id===s.userId)!.wallet+=s.stack;
 if(wasActive&&s.committed)(r.pokerDead??=[]).push(s.committed);
 // Showdown contributions have already been paid. Never refund them again.
 r.seats[i]=null;r.pending=r.pending.filter(j=>j!==i);
 if(wasActive) {
  const alive=r.seats.filter(s=>s&&s.inHand&&!s.folded);
  ensure(alive.length>0,"Cannot remove the last contender in an active hand.",409);
  if(alive.length===1)showdown(r,now);
  else if(wasTurn||!r.pending.length)advance(r,i,now);
 }
}
/** Detached contributions keep their original side-pot levels. The remaining
 * stack is dead main-pot money, never a refundable/eligible contribution. */
export function forfeitSeat(r:Room,i:number) {
 const s=r.seats[i]; if(!s)return;
 if(active(r)) {
  r.pokerBonus=(r.pokerBonus??0)+s.stack;
  if(s.committed)(r.pokerDead??=[]).push(s.committed);
 } else r.pokerCarry=(r.pokerCarry??0)+s.stack+s.committed;
 r.seats[i]=null;r.pending=r.pending.filter(j=>j!==i);
 addLog(r,playerReference(r.members.find(m=>m.id===s.userId))+" removed; table chips forfeited");
}
function countCompletedHand(r:Room) {
 if((r.idleCountedHand??-1)===r.handNumber)return;
 r.idleCountedHand=r.handNumber;
 for(let i=0;i<r.seats.length;i++){
  const s=r.seats[i];if(!s)continue;
  s.idleHands=s.inHand?0:(s.idleHands??0)+1;
  if(s.idleHands>=5)forfeitSeat(r,i);
 }
}
function end(r: Room, payouts: Payout[], now: number) {
 for (const p of payouts) r.seats[p.seat]!.stack += p.amount;
 r.payouts = payouts;
 for (const p of payouts) {
  const m = r.members.find(m => m.id === r.seats[p.seat]!.userId)!;
  addLog(r, playerReference(m) + " " + (p.description === "Uncalled bet returned" ? "returned $" : "wins $") + (p.amount / 100).toFixed(2) + " · " + p.description);
 }
 r.street = "showdown"; r.pending = []; setTurn(r, null, now); r.nextDeal = now + BREAK_MS;
 // Contributions are already in awarded stacks. Clearing prevents double counting.
 r.readyDeadline = null;
 r.pokerBonus=0;r.pokerDead=[];
 for (const s of r.seats) if (s) { s.committed = 0; s.bet = 0; s.ready = false; }
}
export function showdown(r: Room, now: number) {
 if(!active(r))return;
 countCompletedHand(r);
 const alive = r.seats.flatMap((s,i) => s && contenders(s) ? [i] : []);
 if (alive.length === 1) { end(r, [{ seat: alive[0], amount: pot(r), description: "Everyone else folded" }], now); return; }
 while (r.board.length < 5) revealStreet(r);
 const levels = [...new Set([...r.seats.filter(s => s && s.committed > 0).map(s => s!.committed),...(r.pokerDead??[])])].sort((a,b) => a-b);
 const payouts: Payout[] = [];
 let previous = 0;
 for (const level of levels) {
  const contributors = r.seats.flatMap((s,i) => s && s.committed >= level ? [i] : []);
  const dead=(r.pokerDead??[]).filter(v=>v>=level).length;
  const amount = (level - previous) * (contributors.length+dead); previous = level;
  if (contributors.length === 1 && !dead) { payouts.push({ seat: contributors[0], amount, description: "Uncalled bet returned" }); continue; }
  let eligible = contributors.filter(i => contenders(r.seats[i]!));
  // A departed sole upper-layer contributor can never receive an uncalled refund.
  if(!eligible.length&&dead)eligible=alive;
  ensure(eligible.length, "Pot has no eligible player.", 500);
  award(r,eligible,amount,payouts);
 }
 if(r.pokerBonus)award(r,alive,r.pokerBonus,payouts);
 end(r, payouts, now);
}
function award(r:Room,eligible:number[],amount:number,payouts:Payout[]) {
 const winners=showdownWinners(eligible.map(i=>r.seats[i]!.hole),r.board);
 const winningSeats=eligible.filter((_,j)=>winners.some(w=>w.index===j));
 const clockwise=ordered(r,r.button,()=>true).filter(i=>winningSeats.includes(i));
 const share=Math.floor(amount/clockwise.length),remainder=amount%clockwise.length;
 clockwise.forEach((i,j)=>payouts.push({seat:i,amount:share+(j<remainder?1:0),description:winners.find(w=>w.index===eligible.indexOf(i))!.description}));
}
function advance(r: Room, after: number, now: number) {
 const alive = r.seats.filter(s => s && contenders(s));
 if (alive.length === 1) { showdown(r, now); return; }
 r.pending = r.pending.filter(i => r.seats[i] && canAct(r.seats[i]!));
 // A lone player with chips can only act if they still owe a call.
 if (alive.filter(s => s!.stack > 0).length === 1) {
  const lone = r.seats.findIndex(s => s && canAct(s));
  if (r.seats[lone]!.bet >= r.currentBet) r.pending = [];
 }
 if (r.pending.length) {
  const i = ordered(r, after, canAct).find(i => r.pending.includes(i))!;
  setTurn(r, i, now); return;
 }
 if (r.street === "river" || alive.filter(s => s!.stack > 0).length <= 1) { showdown(r, now); return; }
 revealStreet(r);
 for (const s of r.seats) if (s) { s.bet = 0; s.actedAt = null; }
 r.currentBet = 0; r.minRaise = BIG;
 r.pending = ordered(r, r.button, canAct);
 setTurn(r, r.pending[0] ?? null, now);
}
export function startHand(r: Room, now: number, rng?: (max: number) => number) {
 ensure(!active(r), "Hand already running.", 409);
 const eligible = (s: Seat) => s.ready === true && !s.sitOut && !s.leaveAfter && s.stack > 0;
 if (r.seats.some(s => s && !eligible(s) && !s.sitOut)) return;
 if (r.seats.filter(s => s && eligible(s)).length < 2) { r.street = "waiting"; r.nextDeal = null; return; }
 r.button = next(r, r.button, eligible);
 r.readyDeadline = null;
 r.pokerBonus=(r.pokerBonus??0)+(r.pokerCarry??0);r.pokerCarry=0;r.pokerDead=[];
 r.handNumber++; r.street = "preflop"; r.deck = shuffled(rng); r.board = []; r.payouts = []; r.nextDeal = null;
 for (const s of r.seats) if (s) { s.inHand = eligible(s); if(s.inHand)s.idleHands=0; s.folded = !s.inHand; s.bet = 0; s.committed = 0; s.hole = []; s.actedAt = null; }
 for (let n=0;n<2;n++) for (const i of ordered(r, r.button, s => s.inHand)) r.seats[i]!.hole.push(draw(r));
 const n = r.seats.filter(s => s?.inHand).length;
 const sb = n === 2 ? r.button : next(r,r.button,s=>s.inHand);
 const bb = next(r,sb,s=>s.inHand);
 put(r.seats[sb]!,SMALL); put(r.seats[bb]!,BIG);
 let last = bb;
 if (n >= 3) { last = next(r,bb,s=>s.inHand); put(r.seats[last]!,STRADDLE); }
 r.currentBet = n >= 3 ? STRADDLE : BIG; r.minRaise = r.currentBet;
 r.pending = ordered(r,last,canAct);
 addLog(r, "Hand #" + r.handNumber + " · " + (n >= 3 ? "$1 / $2 / $5 live UTG straddle" : "$1 / $2 heads-up"));
 advance(r,last,now);
}
export function legal(r: Room, i: number) {
 const s = r.seats[i];
 if (!s || r.turn !== i || !active(r)) return null;
 const toCall = Math.max(0, r.currentBet - s.bet);
 const raiseOpen = s.actedAt === null || r.currentBet - s.actedAt >= r.minRaise;
 return { toCall: Math.min(toCall,s.stack), check: toCall === 0, maxTo: s.bet + s.stack, minTo: r.currentBet + r.minRaise, raiseOpen: raiseOpen && s.bet + s.stack > r.currentBet && r.seats.some((other,j) => j !== i && other && canAct(other)) };
}
export function act(r: Room, id: string, action: Extract<Action,{type:"fold"|"check"|"call"}> | Extract<Action,{type:"raise"}>, now: number) {
 const i = seatOf(r,id), s = r.seats[i];
 ensure(s && i === r.turn && active(r), "It is not your turn.", 409);
 ensure(r.deadline!==null&&now<r.deadline,"The turn expired.",409);
 const choices = legal(r,i)!;
 let text: string = action.type;
 if (action.type === "fold") s.folded = true;
 else if (action.type === "check") ensure(choices.check, "You must call or fold.");
 else if (action.type === "call") { ensure(!choices.check, "Nothing to call."); put(s,choices.toCall); }
 else {
  ensure(choices.raiseOpen, "Betting has not reopened for you.");
  ensure(isWholeCasinoAmount(action.to) && action.to > r.currentBet && action.to <= choices.maxTo, "Raise total must be a whole dollar within your available chips.");
  const increment = action.to - r.currentBet;
  ensure(increment >= r.minRaise || action.to === choices.maxTo, "Raise is below the minimum.");
  put(s,action.to - s.bet);
  if (increment >= r.minRaise) {
   r.minRaise = increment;
   r.pending = ordered(r,i,canAct).filter(j=>j!==i);
  } else {
   r.pending = [...new Set([...r.pending, ...ordered(r,i,canAct).filter(j=>r.seats[j]!.bet < action.to)])];
  }
  r.currentBet = action.to; text = "raises to $" + (action.to/100).toFixed(2);
 }
 s.actedAt = r.currentBet;
 r.pending = r.pending.filter(j=>j!==i);
 addLog(r, playerReference(r.members.find(m=>m.id===id)) + " " + text);
 advance(r,i,now);
}
export function applyAction(r: Room, who: Identity, action: Action, now: number) {
 if ((action.type === "ready" || action.type === "resume") && !active(r) && r.readyDeadline != null && now >= r.readyDeadline) tick(r,now);
 const member = r.members.find(m=>m.id===who.id);
 ensure(member, "Account not found.", 404);
 let i = seatOf(r,who.id);
 if (action.type === "join") {
  ensure(i < 0, "You already have a seat.", 409);
  ensure(Number.isInteger(action.seat) && action.seat >= 0 && action.seat < POKER_SEAT_COUNT && !r.seats[action.seat], "That seat is taken.", 409);
  ensure(isWholeCasinoAmount(action.buyIn) && action.buyIn >= 10_000 && action.buyIn <= casinoLimits(r).pokerMaxBuyIn && member.wallet >= action.buyIn, "Buy in with at least $100 from your wallet, within the current poker limit.");
  member.wallet -= action.buyIn;
  r.seats[action.seat] = { userId: who.id, stack: action.buyIn, hole: [], bet: 0, committed: 0, folded: true, inHand: false, actedAt: null, sitOut: false, leaveAfter: false, seen: now, ready: false };
  addLog(r,playerReference(member) + " takes seat " + (action.seat+1));
 } else if (action.type === "leave") {
  ensure(i >= 0, "You are not seated.");
  cashOut(r,i);
  if (!r.seats.some(s=>s?.ready)) r.readyDeadline = null;
  if (r.street === "waiting") startHand(r,now);
 } else if (action.type === "unready") {
  ensure(i >= 0, "Choose a seat first.");
  ensure(!(active(r) && r.seats[i]!.inHand), "The hand has started. Wait for it to finish.", 409);
  r.seats[i]!.ready = false;
  // Keep the existing waiting window; toggling readiness must not extend it.
 } else if (action.type === "ready" || action.type === "resume") {
  ensure(i >= 0, "Choose a seat first.");
  ensure(r.street === "waiting", "Wait for the hand to finish.", 409);
  const s = r.seats[i]!;
  ensure(s.stack > 0 && !s.leaveAfter, "Choose a funded seat first.", 409);
  s.ready = true; s.sitOut = false;
  r.readyDeadline ??= now + READY_MS;
  startHand(r,now);
 } else { act(r,who.id,action,now); }
 i = seatOf(r,who.id); if (i >= 0) r.seats[i]!.seen = now;
}
export function tick(r: Room, now: number) {
 let changed = false;
 if (active(r) && r.deadline !== null && now >= r.deadline && r.turn !== null) {
  const i=r.turn;
  const s=r.seats[i]!;s.folded=true;s.actedAt=r.currentBet;
  addLog(r,playerReference(r.members.find(m=>m.id===s.userId))+" auto-folded (turn timed out)");
  advance(r,i,now);
  changed = true;
 }
 if (!active(r)) {
  // Missing fields are legacy unready state, never an implicit consent to deal.
  if (r.readyDeadline == null && r.seats.some(s=>s?.ready)) {
   r.readyDeadline = now + READY_MS; changed = true;
  }
  if (r.readyDeadline != null && now >= r.readyDeadline) {
   // Ready-window expiry never forfeits chips. Refund unready blockers;
   // startHand below deals only with 2+ ready seats. A lone ready seat resets consent in place.
   // The room CAS commits seat removal and its wallet credit together.
   for (let i=0;i<r.seats.length;i++) if (r.seats[i] && !r.seats[i]!.ready) cashOut(r,i);
   // With fewer than two ready seats there is no hand to start. Retain
   // their stacks in place, clear consent, and do not arm another window.
   if (r.seats.filter(s=>s?.ready).length < 2)
    for (const s of r.seats) if(s?.ready)s.ready=false;
   r.readyDeadline = null; changed = true;
  }
  if (r.street === "showdown" && now >= (r.nextDeal ?? Infinity)) {
   for (const s of r.seats) if (s) { s.hole = []; s.inHand = false; s.ready = false; }
   r.street = "waiting"; r.nextDeal = null; r.readyDeadline = null; changed = true;
  }
  for (let i=0;i<r.seats.length;i++) {
   const s = r.seats[i];
   if (s && !s.ready && (s.leaveAfter || s.stack === 0)) {
    cashOut(r,i); changed = true;
   }
  }
  if (r.street === "waiting") { const before = r.handNumber; startHand(r,now); if (before !== r.handNumber) changed = true; }
 }

 return changed;
}
export function totalChips(r: Room) { return r.members.reduce((n,m)=>n+m.wallet+assetsBook(m),(r.house||0)+pokerStates(r).reduce((n,t)=>n+(t.pokerBonus??0)+(t.pokerCarry??0)+(t.pokerDead??[]).reduce((a,v)=>a+v,0),0)) + doudizhuAssets(r) + miniAssets(r) + blackjackTablesAssets(r) + rouletteAssets(r) + pokerStates(r).reduce((n,t)=>n+t.seats.reduce((a,s)=>a+(s?s.stack+s.committed:0),0),0); }
export function assertRoom(r: Room) {
 const values = [...(r.doudizhu??[]).flatMap(g=>g.players.map(p=>p.escrow)),...r.members.map(m=>m.wallet),...pokerStates(r).flatMap(t=>[t.pokerBonus??0,t.pokerCarry??0,...(t.pokerDead??[]),...t.seats.flatMap(s=>s?[s.stack,s.bet,s.committed]:[])])];
 ensure(values.every(n=>Number.isSafeInteger(n) && n>=0), "Invalid chip ledger.",500);
 ensure(totalChips(r) === r.members.length * 100_000+(r.issuance||0), "Chip conservation failed.",500);
 const users = pokerStates(r).flatMap(t=>t.seats.filter(Boolean).map(s=>s!.userId));
 ensure(new Set(users).size === users.length, "Duplicate seat.",500);
 for(const t of pokerStates(r))if(t.street!=="waiting"&&t.street!=="showdown")ensure(t.turn!==null&&t.pending.includes(t.turn),"Invalid turn.",500);
}
