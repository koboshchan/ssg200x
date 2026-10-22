const HOSTS=new Set(["polymarket-upload.s3.us-east-2.amazonaws.com","polymarket-upload.s3.amazonaws.com","images.polymarket.com"]);
export function allowedPolyImage(raw:unknown):string|null{
 if(typeof raw!=="string"||raw.length>2048)return null;
 try{const u=new URL(raw);return u.protocol==="https:"&&HOSTS.has(u.hostname)&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash?u.href:null;}catch{return null;}
}
export function polyImagePath(raw:unknown){const url=allowedPolyImage(raw);return url?"/api/polymarket/image?url="+encodeURIComponent(url):null;}
const MAX=2*1024*1024,TTL=3600000;
const cache=new Map<string,{body:Uint8Array;type:string;at:number}>();
const pending=new Map<string,Promise<{body:Uint8Array;type:string;at:number}>>();
export async function fetchPolyImage(raw:string){
 const url=allowedPolyImage(raw);if(!url)throw Error("Invalid image source.");
 const old=cache.get(url);if(old&&Date.now()-old.at<TTL)return old;
 if(pending.has(url))return pending.get(url)!;
 if(pending.size>=8)throw Error("Image service busy.");
 const job=(async()=>{
  const r=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(8000),headers:{Accept:"image/avif,image/webp,image/png,image/jpeg,image/gif"},cache:"no-store"});
  if(!r.ok||Number(r.headers.get("content-length"))>MAX)throw Error("Image unavailable.");
  const type=(r.headers.get("content-type")||"").split(";")[0].toLowerCase();
  if(!["image/jpeg","image/png","image/webp","image/gif","image/avif"].includes(type)){await r.body?.cancel();throw Error("Unsupported image.");}
  const reader=r.body?.getReader();if(!reader)throw Error("Empty image.");
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX)throw Error("Image too large.");chunks.push(value);}}catch(e){await reader.cancel();throw e;}
  const body=new Uint8Array(size);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}
  // Reject mislabeled active content instead of trusting the remote MIME alone.
  const signature=type==="image/jpeg"?body[0]===255&&body[1]===216:type==="image/png"?body[0]===137&&body[1]===80&&body[2]===78&&body[3]===71:type==="image/gif"?new TextDecoder().decode(body.slice(0,6)).startsWith("GIF8"):type==="image/webp"?new TextDecoder().decode(body.slice(0,4))==="RIFF"&&new TextDecoder().decode(body.slice(8,12))==="WEBP":new TextDecoder().decode(body.slice(4,12)).includes("ftypavif");
  if(!signature)throw Error("Invalid image bytes.");
  const image={body,type,at:Date.now()};
  if(cache.size>=32)cache.delete(cache.keys().next().value!);
  cache.set(url,image);return image;
 })();pending.set(url,job);try{return await job;}finally{pending.delete(url);}
}
