import {browserAppRoute} from "@/lib/app-http";
export const runtime="nodejs";
const route=(request:Request)=>browserAppRoute(request,"developer");
export const GET=route;
export const POST=route;
export const PATCH=route;
export const DELETE=route;
