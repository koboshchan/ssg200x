// Run against the actual final image, not an import-only intermediate layer.
// Requires Docker, a locally available mongo:7.0 image, and the public Clerk key.
import {execFileSync} from "node:child_process";
import {randomBytes} from "node:crypto";
const image=process.argv[2];
if(!image||!process.env.CLERK_PUBLISHABLE_KEY)throw new Error("Pass the final image and CLERK_PUBLISHABLE_KEY");
const prefix="ssg-package-"+randomBytes(6).toString("hex");
const db=prefix+"-mongo",app=prefix+"-app";
const docker=(...args)=>execFileSync("docker",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 docker("network","create",prefix);
 docker("run","-d","--name",db,"--network",prefix,"--tmpfs","/data/db:rw,size=512m","mongo:7.0","--bind_ip_all");
 for(let n=0;;n++){try{docker("exec",db,"mongosh","--quiet","--eval","db.adminCommand({ping:1})");break;}catch(error){if(n>=60)throw error;await delay(500);}}
 docker("run","-d","--name",app,"--network",prefix,
  "-e","MONGODB_URI=mongodb://"+db+":27017","-e","MONGODB_DB=packaging_smoke",
  "-e","APP_ORIGIN=http://localhost:3000",
  "-e","CLERK_PUBLISHABLE_KEY="+process.env.CLERK_PUBLISHABLE_KEY,
  "-e","CLERK_SECRET_KEY=sk_test_cGFja2FnaW5nLXNtb2tl",image);
 const probe=`const paths=["/","/games","/polymarket","/doudizhu","/api/version","/socket.io/socket.io.js"];for(const path of paths){const r=await fetch("http://127.0.0.1:3000"+path);if(r.status!==200)throw Error(path+" HTTP "+r.status);await r.text();console.log(path+" HTTP "+r.status)}`;
 let http;
 for(let n=0;;n++){try{http=docker("exec",app,"node","--input-type=module","-e",probe);break;}catch(error){if(n>=90)throw error;await delay(500);}}
 const websocket=docker("exec",app,"node","--input-type=module","-e",`
  import net from "node:net";
  const s=net.connect(3000,"127.0.0.1");
  s.setTimeout(5000,()=>{throw Error("WebSocket timeout")});
  s.on("connect",()=>s.write("GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\\r\\nHost: localhost:3000\\r\\nOrigin: http://localhost:3000\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Version: 13\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\n\\r\\n"));
  s.once("data",data=>{const status=data.toString().split("\\r\\n")[0];if(!status.includes(" 101 "))throw Error(status);console.log(status);s.destroy()});
 `);
 const engineHandshake=docker("exec",app,"node","--input-type=module","-e",`
  const ws=new WebSocket("ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket");
  const timeout=setTimeout(()=>{console.error("Engine handshake timed out");process.exit(1)},10000);
  ws.onmessage=event=>{const text=String(event.data);if(text.startsWith("0")){const open=JSON.parse(text.slice(1));if(!open.sid||open.pingInterval!==25000)throw Error("Invalid Engine.IO open");console.log("Engine.IO open PASS");clearTimeout(timeout);ws.close()}};
  ws.onerror=()=>{console.error("Engine handshake failed");process.exit(1)};
 `);
 const dependencies=docker("exec",app,"node","--input-type=module","-e",`
  for(const name of ["next","socket.io","@scure/bip39/wordlists/english.js","@clerk/backend","mongodb","sharp"]){await import(name);console.log("resolved "+name)}
  const sharp=(await import("sharp")).default; await sharp({create:{width:1,height:1,channels:3,background:"red"}}).png().toBuffer();
  console.log(JSON.stringify({node:process.version,modules:process.versions.modules,napi:process.versions.napi,arch:process.arch,platform:process.platform,glibc:process.report.getReport().header.glibcVersionRuntime,sharp:sharp.versions}));
 `);
 const logs=docker("logs",app);
 if(/Cannot find module|Failed to load external|instrumentation hook/.test(logs))throw Error("Instrumentation boot failure");
 console.log(JSON.stringify({image,id:docker("image","inspect",image,"--format","{{.Id}}"),http,websocket,engineHandshake,dependencies,container:app,result:"PASS"}));
}catch(error){
 try{console.error(docker("logs",app));}catch{}
 throw error;
}finally{
 for(const name of [app,db])try{docker("rm","-fv",name);}catch{}
 try{docker("network","rm",prefix);}catch{}
}
