import {z} from "zod";
import {endpoint,parse} from "@/lib/api";
import {mutate,rateLimit} from "@/lib/store";
import {publicRoom} from "@/lib/public";
import {register} from "@/lib/poker";
import {blackjackTablesAction,BLACKJACK_TABLE_IDS} from "@/lib/blackjack";
import {ensure} from "@/lib/errors";
const base={tableId:z.enum(BLACKJACK_TABLE_IDS),requestId:z.string().uuid(),requestAt:z.number().int(),round:z.number().int().optional(),deadline:z.number().int().nullable().optional()};
const schema=z.discriminatedUnion("type",[
 z.object({...base,type:z.literal("join"),seat:z.number().int().min(0).max(5)}).strict(),
 z.object({...base,type:z.literal("leave")}).strict(),
 z.object({...base,type:z.literal("bet"),amount:z.number().int().min(100).max(100000).refine(n=>n%2===0)}).strict(),
 ...(["hit","stand","double","split"] as const).map(type=>z.object({...base,type:z.literal(type)}).strict()),
]);
export const POST=(request:Request)=>endpoint(request,async who=>{
 await rateLimit("blackjack:"+who.id,60);const input=await parse(request,schema);
 const {room}=await mutate(r=>{
 register(r,who);ensure(Date.now()-input.requestAt>=-10000&&Date.now()-input.requestAt<=120000,"Request expired.",409);
 const repeated=r.receipts.find(x=>x.id===input.requestId);if(repeated){ensure(repeated.userId===who.id,"Invalid request.",409);return;}
 const b=r.blackjackTables?.tables[input.tableId];
 if(["hit","stand","double","split"].includes(input.type))ensure(input.round===b?.round&&input.deadline===b?.deadline,"The blackjack turn changed. Refresh first.",409);
 blackjackTablesAction(r,who,input,Date.now());
 r.receipts=[{id:input.requestId,userId:who.id,at:Date.now()},...r.receipts.filter(x=>x.at&&Date.now()-x.at<300000)];
 });return publicRoom(room,who);
});
