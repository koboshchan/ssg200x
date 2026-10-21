import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Wheel from '../app/roulette-wheel';
import type {IdleAnchor} from '../lib/roulette-physics';
import type {RouletteSpin} from '../lib/roulette-clock';
import './roulette-demo.css';

type State={serverNow:number;idleAnchor:IdleAnchor;spin:RouletteSpin|null;busy:boolean};
function Demo(){
 const [state,setState]=useState<State|null>(null),[now,setNow]=useState(0),[error,setError]=useState('');
 useEffect(()=>{
  let alive=true;const refresh=async()=>{try{const r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error('State unavailable');const v=await r.json();if(alive){setState(v);setNow(v.serverNow);}}catch(e){if(alive)setError(String(e));}};
  void refresh();const poll=setInterval(refresh,500),tick=setInterval(()=>setNow(t=>t+50),50);
  return()=>{alive=false;clearInterval(poll);clearInterval(tick);};
 },[]);
 async function spin(){setError('');try{const r=await fetch('/api/round',{method:'POST'}),v=await r.json();if(!r.ok)throw Error(v.error);setState(v);setNow(v.serverNow);}catch(e){setError(String(e));}}
 const active=!!state?.spin&&now<state.spin.nextAt;
 return <main><header><p className="eyebrow">SSG / integrated roulette branch</p><h1>Roulette physics lab</h1><p>Real app wheel, shared server physics. Test rounds only, no accounts or money.</p></header>
 <div className="wheel">{state?<Wheel spin={state.spin} now={now} idleAnchor={state.idleAnchor}/>:<p>Synchronizing wheel…</p>}</div>
 <footer><button onClick={spin} disabled={!state||state.busy||active}>{active?'Round in progress':'Lock and spin'}</button><span role="status">{error||(!state?'Loading':state.busy?'Locked · solving':active?'Round '+state.spin!.round:state.spin?'Idle · last result '+state.spin.number:'Idle · wheel and ball drifting')}</span></footer>
 <p className="build">Commit <code>{BUILD_SHA}</code><br/>Source SHA-256 <code>{SOURCE_HASH}</code><br/>16 ms physics · production RouletteWheel component</p></main>;
}
declare const BUILD_SHA:string,SOURCE_HASH:string;
createRoot(document.getElementById('root')!).render(<Demo/>);
