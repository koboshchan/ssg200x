export function normalizeCommit(value){
 return typeof value==="string"&&/^[a-f0-9]{40}$/.test(value.trim())?value.trim():"unknown";
}
export function commitStatus(client,server){
 const a=normalizeCommit(client),b=normalizeCommit(server);
 return a==="unknown"||b==="unknown"?"Version unavailable":a===b?"Commits match":"Commit mismatch";
}
export function serveCommit(request,response,commit){
 if(request.url?.split("?")[0]!=="/api/version")return false;
 response.setHeader("Cache-Control","no-store, max-age=0");
 response.setHeader("Content-Type","application/json; charset=utf-8");
 if(request.method!=="GET"&&request.method!=="HEAD"){response.writeHead(405,{"Allow":"GET, HEAD"}).end();return true;}
 response.writeHead(200).end(request.method==="HEAD"?undefined:JSON.stringify({commit:normalizeCommit(commit)}));
 return true;
}
