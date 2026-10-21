export const RELEASE_EVENT="release:version";
export function releaseId(payload){
 const id=payload?.release;
 return typeof id==="string"&&(/^[a-f0-9]{64}$/.test(id)||id==="development")?id:null;
}
// Once stale, remain stale until an explicit reload. Never adopt the server as
// the client's baseline: that would hide an already-cached outdated JS bundle.
export function createReleaseObserver(clientRelease,onMismatch){
 let stale=false;
 return payload=>{
  const serverRelease=releaseId(payload);
  if(!stale&&serverRelease&&serverRelease!==clientRelease){
   stale=true;onMismatch(serverRelease);
  }
 };
}
export function serveRelease(request,response,release){
 if(request.url?.split("?")[0]!=="/api/release")return false;
 response.setHeader("Cache-Control","no-store, max-age=0");
 response.setHeader("Content-Type","application/json; charset=utf-8");
 if(request.method!=="GET"&&request.method!=="HEAD"){
  response.writeHead(405,{"Allow":"GET, HEAD"}).end();return true;
 }
 response.writeHead(200).end(request.method==="HEAD"?undefined:JSON.stringify({release}));
 return true;
}
export function attachReleaseHandshake(io,release){
 io.on("connection",socket=>socket.emit(RELEASE_EVENT,{release}));
}
