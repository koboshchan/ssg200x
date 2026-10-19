import type {BlackjackTablesState} from "./blackjack";
import type {Holding,Position,ClosedPosition,Spin,Symbol,Quote} from "./finance";
export type Member = { id: string; publicId: string; name: string; email: string; approved: boolean; wallet: number; joined: number; holdings?:Holding[]; positions?:Position[]; closedPositions?:ClosedPosition[]; spins?:Spin[]; activity?:string[]; adjustments?:number };
export type Seat = { userId: string; stack: number; hole: string[]; bet: number; committed: number; folded: boolean; inHand: boolean; actedAt: number | null; sitOut: boolean; leaveAfter: boolean; seen: number; ready?: boolean };
export type Street = "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown";
export type Payout = { seat: number; amount: number; description: string };
export type Room = { _id: string; version: number; blackjackTables?:BlackjackTablesState; house?:number; issuance?:number; limits?:{maxTrade:number;maxLeverage:number}; maintenance?:number;siteMaintenance?:boolean; auditPending?:AuditEvent[]; quotes?:Partial<Record<Symbol,Quote>>; members: Member[]; seats: (Seat | null)[]; button: number; street: Street; handNumber: number; board: string[]; deck: string[]; currentBet: number; minRaise: number; pending: number[]; turn: number | null; deadline: number | null; nextDeal: number | null; readyDeadline?: number | null; payouts: Payout[]; log: string[]; receipts: { id: string; userId: string; at?:number }[]; };
export type AuditEvent={_id:string;who:string;what:string;target:string;old:unknown;new:unknown;at:number};
export type Identity = { id: string; name: string; email: string; admin: boolean };
export type Action =
 | { type: "join"; seat: number; buyIn: number }
 | { type: "leave" }
 | { type: "resume" } | { type: "ready" }
 | { type: "fold" } | { type: "check" } | { type: "call" }
 | { type: "raise"; to: number };
