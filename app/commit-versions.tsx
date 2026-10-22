"use client";
import {useEffect,useState} from "react";
import {commitStatus,normalizeCommit} from "../runtime/git-commit.mjs";
const CLIENT_COMMIT=normalizeCommit(process.env.NEXT_PUBLIC_SSG_GIT_COMMIT);
export default function CommitVersions(){
 const [server,setServer]=useState("unknown");
 useEffect(()=>{
  let active=true;
  const check=()=>{void fetch("/api/version",{cache:"no-store",credentials:"same-origin",signal:AbortSignal.timeout(8000)}).then(async r=>{
   const commit=r.ok?normalizeCommit((await r.json()).commit):"unknown";
   if(active)setServer(commit);
  }).catch(()=>{if(active)setServer("unknown");});};
  check();window.addEventListener("focus",check);
  const timer=setInterval(check,60000);
  return()=>{active=false;clearInterval(timer);window.removeEventListener("focus",check);};
 },[]);
 return <div className="commit-versions">
  <p>Client commit <code title={CLIENT_COMMIT}>{CLIENT_COMMIT.slice(0,7)}</code></p>
  <p>Server commit <code title={server}>{server.slice(0,7)}</code></p>
  <p role="status">{commitStatus(CLIENT_COMMIT,server)}</p>
 </div>;
}
