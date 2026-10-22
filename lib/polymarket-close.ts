export type CloseMode="all"|"profitable"|"losing";
export function matchingPositions<T extends {status:string;pnlCents:number;marketClosed?:boolean}>(rows:T[],mode:CloseMode):T[]{
 return rows.filter(p=>p.status==="open"&&!p.marketClosed&&(mode==="all"||(mode==="profitable"?p.pnlCents>0:p.pnlCents<0)));
}
/** Run independently: a rejected or unavailable position never prevents the next sell. */
export async function closeIndependently<T>(rows:T[],sell:(row:T)=>Promise<number>){
 const results:{row:T;cents?:number;error?:string}[]=[];
 for(const row of rows){
  try{results.push({row,cents:await sell(row)});}
  catch(e){results.push({row,error:e instanceof Error?e.message:"Close failed."});}
 }
 return results;
}
