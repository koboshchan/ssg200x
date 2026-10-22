import {z} from "zod";
import {audit} from "./audit";
import {ensure} from "./errors";
import type {Room,Identity} from "./types";
export const DEFAULT_DOUDIZHU_MAX_RATE=1000;
export const DOUDIZHU_MAX_RATE=1_000_000;
const rate=z.number().int().min(1).max(DOUDIZHU_MAX_RATE);
export const doudizhuRateSchema=z.object({maxRate:rate,expectedMaxRate:rate}).strict();
export type DoudizhuRateChange=z.infer<typeof doudizhuRateSchema>;
type RateRoom=Room&{doudizhuMaxRate?:number};
/** Dollars per point. CREATE checks this; existing games retain their base. */
export function doudizhuMaxRate(room:Room):number{
 return (room as RateRoom).doudizhuMaxRate??DEFAULT_DOUDIZHU_MAX_RATE;
}
function legacyAdminDoudizhuSnapshot(room:Room,who:Identity){
 ensure(who.admin===true,"Administrator access required.",403);
 return {maxRate:doudizhuMaxRate(room)};
}
export function changeDoudizhuMaxRate(room:Room,who:Identity,input:DoudizhuRateChange){
 ensure(who.admin===true,"Administrator access required.",403);
 const {maxRate,expectedMaxRate}=doudizhuRateSchema.parse(input);
 const old=doudizhuMaxRate(room);
 // A retry that already reached its requested result is harmless.
 if(old===maxRate)return;
 ensure(old===expectedMaxRate,"Dou Dizhu maximum changed. Reload and try again.",409);
 audit(room,who,"doudizhu-max-rate","global",old,maxRate);
 (room as RateRoom).doudizhuMaxRate=maxRate;
}

export const DEFAULT_DOUDIZHU_MAX_BEANS_PER_DOLLAR=1_000_000;
export const DOUDIZHU_MAX_BEANS_PER_DOLLAR=1_000_000_000;
const beansRate=z.number().int().min(1).max(DOUDIZHU_MAX_BEANS_PER_DOLLAR);
export const doudizhuBeansSchema=z.object({maxBeansPerDollar:beansRate,expectedMaxBeansPerDollar:beansRate}).strict();
export type DoudizhuBeansChange=z.infer<typeof doudizhuBeansSchema>;
type BeansRoom=Room&{doudizhuMaxBeansPerDollar?:number};
/** Beans per dollar. Existing rooms retain their stored scoring mode. */
export function doudizhuMaxBeansPerDollar(room:Room):number{
 return (room as BeansRoom).doudizhuMaxBeansPerDollar??DEFAULT_DOUDIZHU_MAX_BEANS_PER_DOLLAR;
}
export function adminDoudizhuSnapshot(room:Room,who:Identity){
 ensure(who.admin===true,"Administrator access required.",403);
 return {maxBeansPerDollar:doudizhuMaxBeansPerDollar(room)};
}
export function changeDoudizhuMaxBeansPerDollar(room:Room,who:Identity,input:DoudizhuBeansChange){
 ensure(who.admin===true,"Administrator access required.",403);
 const {maxBeansPerDollar,expectedMaxBeansPerDollar}=doudizhuBeansSchema.parse(input);
 const old=doudizhuMaxBeansPerDollar(room);
 // A retry that already reached its requested result is harmless.
 if(old===maxBeansPerDollar)return;
 ensure(old===expectedMaxBeansPerDollar,"Dou Dizhu maximum changed. Reload and try again.",409);
 audit(room,who,"doudizhu-max-beans-per-dollar","global",old,maxBeansPerDollar);
 (room as BeansRoom).doudizhuMaxBeansPerDollar=maxBeansPerDollar;
}
