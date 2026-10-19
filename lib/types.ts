export type Member = { id: string; publicId: string; name: string; email: string; approved: boolean; wallet: number; joined: number };
export type Seat = { userId: string; stack: number; hole: string[]; bet: number; committed: number; folded: boolean; inHand: boolean; actedAt: number | null; sitOut: boolean; leaveAfter: boolean; seen: number };
export type Street = "waiting" | "preflop" | "flop" | "turn" | "river" | "showdown";
export type Payout = { seat: number; amount: number; description: string };
export type Room = { _id: string; version: number; members: Member[]; seats: (Seat | null)[]; button: number; street: Street; handNumber: number; board: string[]; deck: string[]; currentBet: number; minRaise: number; pending: number[]; turn: number | null; deadline: number | null; nextDeal: number | null; payouts: Payout[]; log: string[]; receipts: { id: string; userId: string }[]; };
export type Identity = { id: string; name: string; email: string; admin: boolean };
export type Action =
 | { type: "join"; seat: number; buyIn: number }
 | { type: "leave" }
 | { type: "resume" }
 | { type: "fold" } | { type: "check" } | { type: "call" }
 | { type: "raise"; to: number };
