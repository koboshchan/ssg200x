import type {StockExecutionState} from "./stock-policy";
import type {StockSymbol} from "./stock-config";
import type {BlackjackTablesState} from "./blackjack";
import type {Holding,Position,ClosedPosition,Spin,Symbol,Quote} from "./finance";
export type Member = { advancements?:import("./advancements").AdvancementState; settings?:{triggerInputMode:"price"|"pnl"}; id: string; publicId: string; name: string; email: string; approved: boolean; accessRevoked?:boolean; wallet: number; joined: number; holdings?:Holding[]; positions?:Position[]; closedPositions?:ClosedPosition[]; spins?:Spin[]; activity?:string[]; adjustments?:number };
export type Seat = { userId: string; stack: number; hole: string[]; bet: number; committed: number; folded: boolean; inHand: boolean; actedAt: number | null; sitOut: boolean; leaveAfter: boolean; seen: number; ready?: boolean; idleHands?:number };
export type Street = "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown";
export type Payout = { seat: number; amount: number; description: string };
export type Room = { casinoLimits?:import("./casino-limits").CasinoLimits; marketDay?:Record<string,{day:string;open:number}>; marketSymbols?:import("./symbol-registry").MarketSymbols; pokerBonus?:number; pokerCarry?:number; pokerDead?:number[]; idleCountedHand?:number; stockExecution?:Partial<Record<StockSymbol,StockExecutionState>>; _id: string; version: number; chatRemovalVersion?:number; blackjackTables?:BlackjackTablesState; house?:number; issuance?:number; limits?:{maxTrade:number;maxLeverage:number}; maintenance?:number;siteMaintenance?:boolean;backfillInBackground?:boolean; auditPending?:AuditEvent[]; quotes?:Partial<Record<Symbol,Quote>>; members: Member[]; seats: (Seat | null)[]; button: number; street: Street; handNumber: number; board: string[]; deck: string[]; currentBet: number; minRaise: number; pending: number[]; turn: number | null; deadline: number | null; nextDeal: number | null; readyDeadline?: number | null; payouts: Payout[]; log: string[]; receipts: { id: string; userId: string; at?:number }[]; };
export type AuditEvent={_id:string;who:string;what:string;target:string;old:unknown;new:unknown;at:number};
export type Identity = { id: string; name: string; email: string; admin: boolean };
export type Action =
 | { type: "join"; seat: number; buyIn: number }
 | { type: "leave" }
 | { type: "resume" } | { type: "ready" } | { type: "unready" }
 | { type: "fold" } | { type: "check" } | { type: "call" }
 | { type: "raise"; to: number };
