import {POKER_SEAT_COUNT} from "./poker-seats";
import {pokerStakes} from "./poker-stakes";
import {wholeCasinoCents} from "./casino-schemas";
import {z} from "zod";
const base={tableId:z.enum(["01","02","03"]).default("01"),requestId:z.string().uuid(),requestAt:z.number().int(),handNumber:z.number().int().min(0),turnDeadline:z.number().int().nullable()};
export const actionSchema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("join"),seat:z.number().int().min(0).max(POKER_SEAT_COUNT-1),buyIn:wholeCasinoCents.min(pokerStakes("01").minBuyIn).max(pokerStakes("03").maxBuyIn)}).strict(),
 z.object({...base,type:z.literal("leave")}).strict(),
 z.object({...base,type:z.literal("resume")}).strict(),
 z.object({...base,type:z.literal("ready")}).strict(),
 z.object({...base,type:z.literal("unready")}).strict(),
 z.object({...base,type:z.literal("fold")}).strict(),
 z.object({...base,type:z.literal("check")}).strict(),
 z.object({...base,type:z.literal("call")}).strict(),
 z.object({...base,type:z.literal("raise"),to:wholeCasinoCents.min(1).max(10_000_000)}).strict(),
]).superRefine((action,ctx)=>{
 if(action.type!=="join")return;
 const {minBuyIn,maxBuyIn}=pokerStakes(action.tableId);
 if(action.buyIn<minBuyIn||action.buyIn>maxBuyIn)ctx.addIssue({code:"custom",path:["buyIn"],message:"Buy-in must be between $"+minBuyIn/100+" and $"+maxBuyIn/100+" for this table."});
});
