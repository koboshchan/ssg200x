// Shared coarse-step bowl simulation. No target enters the integrator.
const POCKETS=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const TAU=Math.PI*2,STEP=TAU/37;
const mod=(a,m)=>((a%m)+m)%m,clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const IDLE=3*Math.PI/180/1000; // 3deg/s slow ambient

/* Shared fixed-step bowl physics. The target is checked only after simulation. */
function idleRate(){return IDLE;}
const DEFL=[...Array(8)].map((_,k)=>k*Math.PI/4+Math.PI/8);

const sstep=x=>{x=clamp(x);return x*x*(3-2*x);};

/* ---------- real fixed-step 2D bowl physics (pre-simulated at spin start, cached trajectory) ---------- */
const DEFR=0.85;
const PHY={rWall:0.88,rLip:0.7,rIn:0.6,rb:0.022,gs:0.5,nu:0.7,gp:0.8,cw:2.5,gz:4,ez:0.65,hf:0.012,hd:0.02,hLip:0.04,
  eWall:0.35,eIn:0.2,eD:0.55,eF:0.4,mu:0.25,muW:0.0,fretT:0.003,fretR0:0.5,fretR1:0.68,crest:1.2,kz:0.35,kzf:0.2,stepMs:16,simMs:12000};
/* Low rounded height fields. Contact follows the local height/slope with a
 * gentle downhill acceleration. Falling vertical velocity never becomes a
 * horizontal wall impulse, which is unstable at coarse timesteps. */
const DOME_A=0.046,DOME_B=0.059,DOME_HB=0.0015;
const DOMES=DEFL.map(a=>{const cx=DEFR*Math.sin(a),cy=-DEFR*Math.cos(a),th=a+Math.PI/4;return{cx,cy,c:Math.cos(th),s:Math.sin(th)};});
function domeH(px,py){const r2=Math.hypot(px,py);if(r2<DEFR-0.09||r2>DEFR+0.09)return 0;let h=0;for(const D of DOMES){const dx=px-D.cx,dy=py-D.cy,xl=dx*D.c+dy*D.s,yl=-dx*D.s+dy*D.c,q2=(xl/DOME_A)**2+(yl/DOME_B)**2;if(q2<1){const u=1-q2;h=Math.max(h,DOME_HB*u*u);}}return h;}
function domeGrad(px,py){const r2=Math.hypot(px,py);if(r2<DEFR-0.09||r2>DEFR+0.09)return[0,0];let h=0,g=[0,0];for(const D of DOMES){const dx=px-D.cx,dy=py-D.cy,xl=dx*D.c+dy*D.s,yl=-dx*D.s+dy*D.c,q2=(xl/DOME_A)**2+(yl/DOME_B)**2;if(q2<1){const u=1-q2,hh=DOME_HB*u*u;if(hh>h){h=hh;const k=-2*DOME_HB*u,glx=k*2*xl/(DOME_A*DOME_A),gly=k*2*yl/(DOME_B*DOME_B);g=[glx*D.c-gly*D.s,glx*D.s+gly*D.c];}}}return g;}
const IDLE_TAU=4000;
function idleV(an,t){const v=idleRate();return v+(an.vel-v)*Math.exp(-(t-an.atMs)/IDLE_TAU);}
function idleW(an,t){const v=idleRate(),dt=t-an.atMs;return an.phase+v*dt+(an.vel-v)*IDLE_TAU*(1-Math.exp(-dt/IDLE_TAU));}
function makeWheel(W0,vi,vp,tUp,tauW){return{W0,vi,vp,tUp,tauW,Wup:W0+vi*tUp+(vp-vi)*tUp*0.5};}
function wheelOf(w,e){e=Math.max(0,e);if(e<w.tUp){const x=e/w.tUp;return w.W0+w.vi*e+(w.vp-w.vi)*w.tUp*(x*x*x-x*x*x*x/2);}
  return w.Wup+w.vp*w.tauW*(1-Math.exp(-(e-w.tUp)/w.tauW));}
function wheelVelOf(w,e){e=Math.max(0,e);if(e<w.tUp){const x=e/w.tUp;return w.vi+(w.vp-w.vi)*(3*x*x-2*x*x*x);}return w.vp*Math.exp(-(e-w.tUp)/w.tauW);}
function segClosest(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;let t=l2>0?((px-ax)*dx+(py-ay)*dy)/l2:0;t=t<0?0:t>1?1:t;return [ax+t*dx,ay+t*dy];}
/* ball launched from its idle pocket: kinematic 900ms launch (smooth), then pure physics. Returns trajectory + event log */
function simulate(wp,B0,wbRad,record){
  const P=PHY,rb=P.rb,tUp=wp.tUp,TOL=5e-5,LIM=wp.tUp>1000?20000:P.simMs;
  const n=LIM+2,A=record?new Float64Array(n):null,R=record?new Float64Array(n):null,Z=record?new Float64Array(n):null;
  const ang=e=>{const x=e/tUp;return B0+wp.vi*e-(wbRad+wp.vi)*tUp*(x*x*x-x*x*x*x/2);};
  const r0=wp.r0||0.6;const rad=e=>r0+(P.rWall-r0)*sstep(e/500);
  const ev={dia:[],fret:[],wall:0,maxPen:0,tLip:null,tRest:null,phiRest:null,rRest:null,tois:0,maxStepDeg:0,maxStepAt:null};
  let x,y,vx,vy,z=0,vz=0,ua,pa;
  for(let ms=0;ms<=tUp;ms++){if(record){A[ms]=ang(ms);R[ms]=rad(ms);Z[ms]=domeH(R[ms]*Math.sin(A[ms]),-R[ms]*Math.cos(A[ms]));}}
  {const a=ang(tUp),r=P.rWall;ua=a;pa=a;x=r*Math.sin(a);y=-r*Math.cos(a);const om=-wbRad*1000;vx=r*om*Math.cos(a);vy=r*om*Math.sin(a);z=domeH(x,y);}
  /* contact query: deepest penetration at state (px,py,pz) with wheel at time tm. returns {pen,nx,ny,sx,sy,kind,e,mu,k} */
  const query=(px,py,pz,tm)=>{let best=null;const r2=Math.hypot(px,py),W=wheelOf(wp,tm),om=wheelVelOf(wp,tm)*1000;
    const put2=(pen,nx,ny,sx,sy,kind,e,mu,k)=>{if(pen>0&&(!best||pen>best.pen))best={pen,nx,ny,sx,sy,kind,e,mu,k};};
    put2(r2-P.rWall,-px/r2,-py/r2,0,0,'wall',P.eWall,P.muW);
    if(pz<P.hf&&r2<P.rLip+0.03){const u=mod(Math.atan2(px,-py)-W,TAU)/STEP-0.5,j0=Math.round(u);for(let j=j0-1;j<=j0+1;j++){const af=W+(j+0.5)*STEP,sa=Math.sin(af),ca=Math.cos(af);const c=segClosest(px,py,P.fretR0*sa,-P.fretR0*ca,P.fretR1*sa,-P.fretR1*ca),d=Math.hypot(px-c[0],py-c[1]),lim=rb+P.fretT;if(d>1e-12)put2(lim-d,(px-c[0])/d,(py-c[1])/d,om*(-c[1]),om*c[0],'fret',P.eF,P.mu,j);}}
    return best;};
  /* fret top support: a ball descending onto a fret rests on its top (vertical contact) instead of overlapping it */
  const fretPen=(px,py,tt)=>{const W=wheelOf(wp,tt),u=mod(Math.atan2(px,-py)-W,TAU)/STEP-0.5,j0=Math.round(u);let m=-1,nx=0,ny=0;for(let j=j0-1;j<=j0+1;j++){const af=W+(j+0.5)*STEP,sa=Math.sin(af),ca=Math.cos(af),c=segClosest(px,py,P.fretR0*sa,-P.fretR0*ca,P.fretR1*sa,-P.fretR1*ca),d=Math.hypot(px-c[0],py-c[1]),p=rb+P.fretT-d;if(p>m&&d>1e-12){m=p;nx=(px-c[0])/d;ny=(py-c[1])/d;}}return{m,nx,ny};};
  const free=(s,dt,tm)=>{const r=Math.hypot(s.x,s.y),rx=s.x/r,ry=s.y/r,om=wheelVelOf(wp,tm)*1000;let ax=0,ay=0;
    if(r>P.rLip){ax-=P.gs*rx;ay-=P.gs*ry;}else{const gr=P.gp*Math.max(-1.5,Math.min(1.5,(r-0.655)/0.04));ax-=gr*rx;ay-=gr*ry;if(s.z<=0){ax-=P.cw*(s.vx-om*(-s.y));ay-=P.cw*(s.vy-om*s.x);}}
    if(s.z>=P.hf-1e-9&&s.z<P.hf+0.002&&r<P.rLip+0.03){const fp=fretPen(s.x,s.y,tm);if(fp.m>0){ax+=P.crest*fp.nx;ay+=P.crest*fp.ny;}}
    ax-=P.nu*s.vx;ay-=P.nu*s.vy;const o={vx:s.vx+ax*dt,vy:s.vy+ay*dt,z:s.z,vz:s.vz-P.gz*dt};o.x=s.x+o.vx*dt;o.y=s.y+o.vy*dt;o.z+=o.vz*dt;
    {const hb=domeH(o.x,o.y);if(hb>0&&o.z<hb){
      const [gx,gy]=domeGrad(o.x,o.y),p0=Math.hypot(o.vx,o.vy);
      const ux=o.vx-0.5*gx*dt,uy=o.vy-0.5*gy*dt;
      o.hit={vi:Math.max(0,-o.vz),sp0:p0,sp1:Math.hypot(ux,uy),dot:(o.vx*ux+o.vy*uy)/Math.max(1e-12,p0*Math.hypot(ux,uy)),vz:Math.max(0,gx*ux+gy*uy)};
      o.vx=ux;o.vy=uy;o.vz=o.hit.vz;o.z=hb;
    }}if(r>P.rLip&&Math.hypot(o.x,o.y)<=P.rLip&&o.z<=0){o.z=P.hLip;o.vz=0;}if(o.z<P.hf&&Math.hypot(o.x,o.y)<P.rLip+0.03&&fretPen(o.x,o.y,tm+dt*1000).m>TOL){o.z=P.hf;if(o.vz<0)o.vz=0;}else if(o.z<=0){o.z=0;o.vz=o.vz<-0.05?-P.ez*o.vz:0;}return o;};
  const apply=(c)=>{const rvx=vx-c.sx,rvy=vy-c.sy,vn=rvx*c.nx+rvy*c.ny;if(vn>=0)return;const j=-(1+(-vn<0.03?0:c.e))*vn;vx+=j*c.nx;vy+=j*c.ny;const tx=-c.ny,ty=c.nx,vt=rvx*tx+rvy*ty,dj=Math.min(c.mu*j,Math.abs(vt)),sg=vt>0?-1:1;vx+=sg*dj*tx;vy+=sg*dj*ty;
    const sp0=Math.hypot(rvx,rvy),sp1=Math.hypot(vx-c.sx,vy-c.sy);return{vi:-vn,vo:(vx-c.sx)*c.nx+(vy-c.sy)*c.ny,sp0,sp1};};
  {const c0=query(x,y,0,tUp);if(c0&&c0.kind!=='wall'&&c0.pen>TOL){ev.badLaunch=true;ev.badWhy="rel:"+c0.kind+":"+c0.pen.toFixed(4);}}
  // One fixed 16ms semi-implicit step, one contact projection. No substeps,
  // time-of-impact root finding or 1ms integration. Recording resamples the same
  // coarse trajectory for the existing absolute-time playback contract.
  let i=tUp,restCnt=0,slide=false;
  while(i<LIM){
    const ms=Math.min(P.stepMs,LIM-i),dt=ms/1000,oldA=ua,oldR=Math.hypot(x,y),oldZ=z;
    const m=free({x,y,vx,vy,z,vz},dt,i);
    if(m.hit)logDome(m.hit,i+ms);
    x=m.x;y=m.y;vx=m.vx;vy=m.vy;z=m.z;vz=m.vz;
    const c=query(x,y,z,i+ms);
    if(c){
      const q=apply(c);if(q)log(c,q,i+ms);
      // Contact-only separation, never a target correction. Rounded domes are
      // height fields above, not horizontal walls.
      x+=c.nx*c.pen;y+=c.ny*c.pen;
      ev.maxPen=Math.max(ev.maxPen,c.pen);ev.tois++;
    }
    const a0=Math.atan2(x,-y);let d=a0-pa;d-=TAU*Math.round(d/TAU);ua+=d;pa=a0;
    const rr=Math.hypot(x,y);
    for(let k=1;record&&k<=ms;k++){const u=k/ms;A[i+k]=oldA+(ua-oldA)*u;R[i+k]=oldR+(rr-oldR)*u;Z[i+k]=oldZ+(z-oldZ)*u;}
    i+=ms;
    if(ev.tLip===null&&rr<=P.rLip&&z<=P.hLip+1e-9&&i>tUp+100)ev.tLip=i;
    const om1=wheelVelOf(wp,i)*1000;
    if(rr<P.rLip&&z<=0&&Math.hypot(vx-om1*(-y),vy-om1*x)<0.03&&i>tUp+500){restCnt+=ms;if(restCnt>=64){ev.tRest=i;ev.phiRest=ua-wheelOf(wp,i);ev.rRest=rr;break;}}else restCnt=0;
  }
  ev.last={x,y,vx,vy,z,vz,slide,c:query(x,y,z,i)};
  function logDome(h,tm){ev.dia.push({t:tm,k:0,vi:h.vi,vo:0,sp0:h.sp0,sp1:h.sp1,dot:h.dot,hopVz:h.vz});}
  function log(c,q,tm){if(tm<tUp+HANDOFF_QUIET_MS&&c.kind!=='wall'){ev.badLaunch=true;ev.badWhy=ev.badWhy||('log:'+c.kind+':'+Math.round(tm));}if(c.pen>ev.maxPen)ev.maxPen=c.pen;(ev.penBy=ev.penBy||{})[c.kind]=Math.max((ev.penBy[c.kind]||0),c.pen);
    if(c.kind==='fret'){ev.fret.push({t:tm,vi:q.vi,vo:q.vo,sp0:q.sp0,sp1:q.sp1});if(q.vi>0.03&&z<=0){vz+=Math.min(0.3,P.kzf*q.vi);z=1e-6;}}
    else if(c.kind==='wall'&&q.vi>0.05)ev.wall++;}
  if(record){for(let k=1;k<=Math.min(i,LIM);k++){const dd=Math.abs(A[k]-A[k-1])*57.2958;if(k>tUp+1&&dd>ev.maxStepDeg){ev.maxStepDeg=dd;ev.maxStepAt=k;}}}
  return {A,R,Z,ev,end:i};
}
function pocketAtRest(phi){return mod(Math.round(mod(phi,TAU)/STEP),37);}

function rng32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const HANDOFF_QUIET_MS=12;
const ZS=20,LAUNCH_WINDOW_MS=4000;
const SPIN_TUP=900,SPIN_TAU=2000,SPIN_VP=400*Math.PI/180/1000,SPIN_WB=0.0115;
function simActual(Wl,slot0,dvk,dwb,record,rel0,r0,vi0){const vi=vi0===undefined?idleRate():vi0;const wp=makeWheel(Wl,vi,SPIN_VP*dvk,SPIN_TUP,SPIN_TAU);wp.r0=r0||0.6;const B0=Wl+(rel0===undefined||rel0===null?slot0*STEP:rel0);return{wp,wb:SPIN_WB*dwb,B0,f:simulate(wp,B0,SPIN_WB*dwb,record!==false)};}
export const PHYS_VERSION='237a4fbdd0873491';

export {POCKETS,STEP,TAU,PHY,DEFL,ZS,mod,clamp,idleRate,idleV,idleW,makeWheel,wheelOf,wheelVelOf,simulate,pocketAtRest,rng32,simActual,SPIN_TUP,SPIN_TAU,SPIN_VP,SPIN_WB,LAUNCH_WINDOW_MS};

/** Validate before simulation. No fallback state, target-dependent rotations or search. */
export function validateRound(o){
 const nums=['lockDeadline','resultGeneratedAt','broadcastAt','spinStartAt','serverNow'];
 if(!o||nums.some(k=>!Number.isFinite(o[k])))throw new Error('Missing round timestamps');
 if(o.physicsVersion!==PHYS_VERSION)throw new Error('Physics version mismatch');
 if(typeof o.roundId!=='string'||!o.roundId||!Number.isInteger(o.target)||o.target<0||o.target>36)throw new Error('Invalid round');
 if(o.resultGeneratedAt<o.lockDeadline||o.broadcastAt<o.resultGeneratedAt||o.broadcastAt>o.spinStartAt||o.serverNow<o.resultGeneratedAt||o.spinStartAt<o.resultGeneratedAt)throw new Error('Result before lock or invalid broadcast ordering');
 const a=o.idleAnchor,p=o.launchParams;
 if(!a||['atMs','phase','vel','rel','r','slot'].some(k=>!Number.isFinite(a[k]))||!Number.isInteger(a.slot)||a.slot<0||a.slot>=37||a.r<=0||a.r>PHY.rWall)throw new Error('Missing continuous anchor');
 if(!p||!Number.isInteger(p.d)||p.d<0||p.d>LAUNCH_WINDOW_MS||!Number.isFinite(p.dvk)||p.dvk<.96||p.dvk>1.04||!Number.isFinite(p.dwb)||p.dwb<.85||p.dwb>1.15)throw new Error('Missing or invalid launchParams');
}
export function createTrajectory(o){
 validateRound(o);
 const an=o.idleAnchor,p=o.launchParams,t0=o.spinStartAt+p.d;
 const {wp,f}=simActual(idleW(an,t0),an.slot,p.dvk,p.dwb,true,an.rel,an.r,idleV(an,t0));
 if(f.ev.tRest===null||f.ev.badLaunch||POCKETS[pocketAtRest(f.ev.phiRest)]!==o.target)throw new Error('Launch does not land on the server result');
 const duration=f.ev.tRest+700;
 const endAnchor={atMs:t0+duration,phase:wheelOf(wp,duration),vel:wheelVelOf(wp,duration),slot:pocketAtRest(f.ev.phiRest),rel:f.ev.phiRest,r:f.ev.rRest};
 return {wp,f,t0,duration,endAnchor,round:o};
}
/** Absolute-time sampling, identical for uninterrupted playback and late joins. */
export function poseAt(sp,t,reduced=false){
 const {round:o,wp,f,t0,duration,endAnchor}=sp,an=o.idleAnchor,e=t-t0,ev=f.ev;
 const W=e<0?idleW(an,t):e>=duration?idleW(endAnchor,t):wheelOf(wp,e);
 let a,r,z=0,vis=1;
 if(e<0){a=W+an.rel;r=an.r;}
 else if(e>=ev.tRest){a=W+ev.phiRest;r=ev.rRest;}
 else {const i=Math.min(f.end-1,Math.floor(e)),frac=e-i;a=f.A[i]+(f.A[i+1]-f.A[i])*frac;r=f.R[i]+(f.R[i+1]-f.R[i])*frac;z=(f.Z[i]+(f.Z[i+1]-f.Z[i])*frac)*ZS;}
 // Accessibility changes only presentation. Keep the true wheel/trajectory
 // internal until capture, then dissolve from the uninterrupted idle display.
 if(reduced){
  const Wd=idleW(an,t),idle={W:Wd,a:Wd+an.rel,r:an.r,z:0,phi:an.rel,e:Math.max(0,e),vis:0,phase:'idle'};
  if(e<ev.tRest)return {...idle,vis:e<0?1:1-clamp(e/300)};
  const k=clamp((e-ev.tRest)/400);
  return {W,a,r,z,phi:a-W,e:Math.max(0,e),vis:k,phase:e>=duration?'landed':'riding',fade:k,...(k<1?{fadeFrom:idle}:{})};
 }
 return {W,a,r,z,phi:a-W,e:Math.max(0,e),vis,phase:e<0?'idle':e>=duration?'landed':e>=ev.tRest?'riding':ev.tLip!==null&&e>=ev.tLip?'drop':'track'};
}
