import {NextResponse} from "next/server";
import {requireFeature} from "@/lib/feature-flags";
import {getTradingPerformance} from "@/lib/trading-performance-store";
import {auth} from "@clerk/nextjs/server";
import {currentClerkSession} from "@/lib/clerk-reads";
import {AppError} from "@/lib/errors";
export const dynamic="force-dynamic";
export async function GET(_request:Request,context:{params:Promise<{publicId:string}>}){
 const headers={"Cache-Control":"no-store"};
 try{
  const {userId,sessionId}=await auth();
  if(!userId||!sessionId)return NextResponse.json({error:"Sign in with Google."},{status:401,headers});
  try{await currentClerkSession(sessionId,userId);}catch{return NextResponse.json({error:"Sign in with Google."},{status:401,headers});}
  await requireFeature("leaderboard");
  const {publicId}=await context.params;
  return NextResponse.json(await getTradingPerformance(publicId),{headers});
 }catch(error){
  return NextResponse.json({error:error instanceof AppError?error.message:"Performance unavailable."},{status:error instanceof AppError?error.status:503,headers});
 }
}
