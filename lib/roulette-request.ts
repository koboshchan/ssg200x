import {rouletteBetSchema as bet} from "./casino-schemas";
import {z} from "zod";
// Shared room transport includes the selected poker table. Roulette remains global;
// accept only known table context, never arbitrary extra fields.
const base={tableId:z.enum(["01","02","03"]).optional(),requestId:z.string().uuid(),requestAt:z.number().int(),round:z.number().int().min(1)};
export const rouletteRequestSchema=z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('rebet')}).strict(),
 z.object({...base,type:z.literal('bet'),bet}).strict(),
 z.object({...base,type:z.literal('change'),betId:z.string().uuid(),bet}).strict(),
 z.object({...base,type:z.literal('cancel'),betId:z.string().uuid()}).strict(),
]);
