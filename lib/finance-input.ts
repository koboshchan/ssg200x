import {validForexPair} from "./forex-policy";
import {z} from "zod";
import {rouletteBetSchema as bet} from "./casino-schemas";
const base={requestId:z.string().uuid(),requestAt:z.number().int()};
const money=z.number().int().min(100).max(Number.MAX_SAFE_INTEGER),symbol=z.string().max(20).refine(s=>/^[A-Z][A-Z0-9.\-]{0,14}$/.test(s)||validForexPair(s));
const triggerPrice=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const triggerMode=z.enum(["price","pnl"]);
const openTriggers={triggerInputMode:triggerMode.optional(),takeProfit:triggerPrice.optional(),stopLoss:triggerPrice.optional(),takeProfitPnl:triggerPrice.optional(),stopLossPnl:triggerPrice.optional()};
const editTriggers={triggerInputMode:triggerMode.optional(),takeProfit:triggerPrice.nullable().optional(),stopLoss:triggerPrice.nullable().optional(),takeProfitPnl:triggerPrice.nullable().optional(),stopLossPnl:triggerPrice.nullable().optional()};
export const financeSchema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("sell-all-spot"),symbol}).strict(),
 z.object({...base,type:z.literal("redeem-legacy"),symbol}).strict(),
 z.object({...base,type:z.literal("spin"),bets:z.array(bet).min(1).max(20)}).strict(),
 z.object({...base,type:z.literal("spot"),symbol,side:z.enum(["buy","sell"]),amount:money}).strict(),
 z.object({...base,type:z.literal("open"),symbol,side:z.enum(["long","short"]),margin:money,leverage:z.number().int().min(1).max(200),expectedOpeningFeePpm:z.number().int().min(0).max(1000).optional(),expectedClosingFeePpm:z.number().int().min(0).max(1000000).optional(),expectedClosingFeeMode:z.enum(["notional","profit"]).optional(),expectedFeePpm:z.number().int().min(0).max(1000).optional(),...openTriggers}).strict(),
 z.object({...base,type:z.literal("triggers"),positionId:z.string().uuid(),...editTriggers}).strict(),
 z.object({...base,type:z.literal("close-all"),mode:z.enum(["all","profiting","losing"]).optional(),positionIds:z.array(z.string().uuid()).min(1).max(1000).refine(ids=>new Set(ids).size===ids.length,"Duplicate position.")}).strict(),
 z.object({...base,type:z.literal("increase"),positionId:z.string().uuid(),margin:money,expectedRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict(),
 z.object({...base,type:z.literal("partial-close"),positionId:z.string().uuid(),percentBps:z.number().int().min(1).max(10000),expectedRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict(),
 z.object({...base,type:z.literal("close"),positionId:z.string().uuid()}).strict(),
]);
