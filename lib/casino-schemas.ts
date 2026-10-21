import {CASINO_LIMIT_MAX_CENTS} from "./casino-limits";
import {z} from "zod";
// Casino entry only. Fractional wallet/settlement amounts remain valid elsewhere.
export const wholeCasinoCents=z.number().int().multipleOf(100);
export const rouletteBetSchema=z.object({
 kind:z.enum(["straight","red","black","odd","even","low","high","dozen","column"]),
 pick:z.number().int().min(0).max(36).optional(),
 amount:wholeCasinoCents.min(100).max(CASINO_LIMIT_MAX_CENTS),
}).strict();
