import {allowedPolyImage,fetchPolyImage} from "@/lib/polymarket-images";
export async function GET(request:Request){
 const raw=new URL(request.url).searchParams.get("url")||"";
 if(!allowedPolyImage(raw))return new Response("Invalid image source.",{status:400});
 try{const image=await fetchPolyImage(raw);return new Response(new Uint8Array(image.body),{headers:{"Content-Type":image.type,"Cache-Control":"public, max-age=3600","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; img-src 'self'; sandbox"}});}
 catch{return new Response("Image unavailable.",{status:502,headers:{"Cache-Control":"no-store"}});}
}
