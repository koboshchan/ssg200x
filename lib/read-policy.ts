export function endpointBudget(method:string,pathname:string,userId:string){return method==="GET"&&pathname==="/api/room"?{key:`room-read:${userId}`,limit:900}:{key:userId,limit:180};}
