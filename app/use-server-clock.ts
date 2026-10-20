"use client";
import {useEffect,useState} from "react";
import {serverClock} from "@/lib/turn-timer";
export function useServerClock(serverNow:number){
 const [clock,setClock]=useState(serverNow);
 useEffect(()=>{
  const received=performance.now();
  const tick=()=>setClock(serverClock(serverNow,received,performance.now()));
  tick();const timer=setInterval(tick,100);
  return()=>clearInterval(timer);
 },[serverNow]);
 return clock;
}
