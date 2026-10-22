import {NextResponse} from 'next/server';
import {featureSnapshot} from '@/lib/feature-flags';
export const dynamic='force-dynamic';
export async function GET(){try{return NextResponse.json(await featureSnapshot(),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'Feature settings unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});}}
