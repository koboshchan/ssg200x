import {POKER_SEAT_COUNT} from "./poker-seats";
import {CASINO_LIMIT_MAX_CENTS} from "./casino-limits";
import {wholeCasinoCents} from "./casino-schemas";
import {z} from "zod";
const base={requestId:z.string().uuid(),requestAt:z.number().int(),handNumber:z.number().int().min(0),turnDeadline:z.number().int().nullable()};
export const actionSchema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("join"),seat:z.number().int().min(0).max(POKER_SEAT_COUNT-1),buyIn:wholeCasinoCents.min(10_000).max(CASINO_LIMIT_MAX_CENTS)}).strict(),
 z.object({...base,type:z.literal("leave")}).strict(),
 z.object({...base,type:z.literal("resume")}).strict(),
 z.object({...base,type:z.literal("ready")}).strict(),
 z.object({...base,type:z.literal("unready")}).strict(),
 z.object({...base,type:z.literal("fold")}).strict(),
 z.object({...base,type:z.literal("check")}).strict(),
 z.object({...base,type:z.literal("call")}).strict(),
 z.object({...base,type:z.literal("raise"),to:wholeCasinoCents.min(1).max(10_000_000)}).strict(),
]);
