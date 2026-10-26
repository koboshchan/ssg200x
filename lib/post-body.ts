// Shared room POST transport. The selected poker table is sent only to routes that read it.
// Positive allowlist: other routes (admin, finance, roulette, ...) keep strict bodies.
const TABLE_SCOPED_ROUTES=new Set(["/api/action"]);
export function isTableScopedRoute(path:string){return TABLE_SCOPED_ROUTES.has(path);}
export function buildPostBody(path:string,body:object,tableId:string,now:number){
 if(path==="/api/blackjack")return {...body,requestAt:now};
 return isTableScopedRoute(path)?{...body,tableId,requestAt:now}:{...body,requestAt:now};
}
