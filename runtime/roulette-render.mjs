import {POCKETS,STEP,TAU,DEFL,ZS,mod,clamp} from './roulette-physics.mjs';
const RED=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const lab=i=>POCKETS[mod(i,37)];
const P=(cx,cy,R,r,a)=>[cx+R*r*Math.sin(a),cy-R*r*Math.cos(a)];
function sector(ctx,cx,cy,R,r0,r1,a0,a1){ctx.beginPath();ctx.arc(cx,cy,R*r1,a0-Math.PI/2,a1-Math.PI/2);ctx.arc(cx,cy,R*r0,a1-Math.PI/2,a0-Math.PI/2,true);ctx.closePath();}
function disc(ctx,cx,cy,r,fill){ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.fillStyle=fill;ctx.fill();}
function radial(ctx,cx,cy,r0,r1,stops){const g=ctx.createRadialGradient(cx,cy,r0,cx,cy,r1);stops.forEach(([o,c])=>g.addColorStop(o,c));return g;}
function pocketColors(pal,n){return n===0?pal.green:RED.has(n)?pal.red:pal.black;}
function drawPockets(ctx,cx,cy,R,W,pal,o={}){
  const r0=o.r0??0.5,r1=o.r1??0.68,nr0=o.nr0??0.4;
  for(let i=0;i<37;i++){const n=lab(i),a=W+i*STEP;
    sector(ctx,cx,cy,R,nr0,r1,a-STEP/2,a+STEP/2);ctx.fillStyle=pocketColors(pal,n);ctx.fill();
    ctx.lineWidth=Math.max(1,R*pal.divider);ctx.strokeStyle=pal.frets;ctx.stroke();
    ctx.save();ctx.translate(...P(cx,cy,R,(nr0+r0)/2+0.005,a));ctx.rotate(a);ctx.fillStyle=pal.num;ctx.font='700 '+Math.round(R*(o.font??0.052))+'px '+(pal.font||'Georgia,serif');ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(n,0,0);ctx.restore();
  }
  if(pal.pocketFloor){for(let i=0;i<37;i++){const a=W+i*STEP;sector(ctx,cx,cy,R,r0+0.02,r1-0.02,a-STEP/2+0.004,a+STEP/2-0.004);ctx.fillStyle='rgba(0,0,0,'+pal.pocketFloor+')';ctx.fill();}}
  if(pal.fretsGlow){ctx.save();ctx.strokeStyle=pal.frets;ctx.lineWidth=Math.max(1.5,R*0.007);ctx.lineCap='round';for(let i=0;i<37;i++){const a=W+(i+.5)*STEP;ctx.beginPath();ctx.moveTo(...P(cx,cy,R,nr0,a));ctx.lineTo(...P(cx,cy,R,r1,a));ctx.stroke();}ctx.restore();}
}
function drawDeflectors(ctx,cx,cy,R,pal){for(const a of DEFL){ctx.save();ctx.translate(...P(cx,cy,R,0.85,a));ctx.rotate(a+Math.PI/4);const s=R*0.026;ctx.beginPath();ctx.moveTo(0,-s*1.5);ctx.quadraticCurveTo(s*.65,-s*.95,s,0);ctx.quadraticCurveTo(s*.65,s*.95,0,s*1.5);ctx.quadraticCurveTo(-s*.65,s*.95,-s,0);ctx.quadraticCurveTo(-s*.65,-s*.95,0,-s*1.5);ctx.closePath();ctx.fillStyle=pal.deflector;ctx.fill();ctx.strokeStyle='rgba(0,0,0,.45)';ctx.lineWidth=1;ctx.stroke();ctx.restore();}}
function drawCone(ctx,cx,cy,R,W,pal){
  disc(ctx,cx,cy,R*0.4,radial(ctx,cx-R*.08,cy-R*.1,R*0.02,R*0.4,pal.cone));
  if(ctx.createConicGradient){const cg=ctx.createConicGradient(W,cx,cy);[[0,'rgba(255,255,255,.55)'],[.12,'rgba(255,255,255,0)'],[.3,'rgba(0,0,0,.35)'],[.5,'rgba(255,255,255,.4)'],[.62,'rgba(255,255,255,0)'],[.8,'rgba(0,0,0,.4)'],[1,'rgba(255,255,255,.55)']].forEach(([o,c])=>cg.addColorStop(o,c));ctx.beginPath();ctx.arc(cx,cy,R*0.4,0,TAU);ctx.arc(cx,cy,R*0.1,0,TAU,true);ctx.fillStyle=cg;ctx.fill('evenodd');}
  ctx.save();ctx.translate(cx,cy);ctx.rotate(W);ctx.strokeStyle=pal.spoke;ctx.lineWidth=R*0.028;ctx.lineCap='round';
  for(let k=0;k<4;k++){ctx.rotate(Math.PI/2);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-R*0.3);ctx.stroke();disc(ctx,0,-R*0.3,R*0.026,pal.spoke);}
  ctx.restore();
  disc(ctx,cx,cy,R*0.09,radial(ctx,cx-R*.02,cy-R*.03,0,R*0.09,[[0,'#fff6d0'],[.5,pal.hub],[1,'#5a3f0f']]));
}
function drawBall(ctx,x,y,rad,pose,pal,alpha=1){
  ctx.save();ctx.globalAlpha=alpha;
  const lift=pose.z*rad*1.2;
  disc(ctx,x+rad*.3,y+rad*.4+lift*.2,rad*1.05,'rgba(0,0,0,'+(.35/(1+pose.z))+')');
  disc(ctx,x,y-lift,rad,radial(ctx,x-rad*.35,y-lift-rad*.4,rad*.1,rad*1.1,[[0,'#ffffff'],[.45,pal.ball||'#ece6d6'],[1,'#8c8574']]));
  ctx.restore();
}
const PAL={
  wood:{red:'#b3182a',black:'#14110f',green:'#14803a',frets:'#d9b25f',divider:0.004,num:'#f7ecd0',deflector:'#e6c26a',cone:[[0,'#f8dd8c'],[.6,'#b98a2c'],[1,'#6a4a12']],spoke:'#e3bf63',hub:'#e8c25f',pocketFloor:.18,fretsGlow:false},
  tilt:{red:'#c0182c',black:'#1b1816',green:'#17893f',frets:'#e9cf86',divider:0.003,num:'#fff4d6',deflector:'#f0d278',cone:[[0,'#fff3bd'],[.5,'#c9a043'],[1,'#6b4c13']],spoke:'#f0d278',hub:'#f4d777',pocketFloor:.22},
  cinema:{red:'#a1121f',black:'#0c0b0b',green:'#0f6f32',frets:'#f1d58b',divider:0.006,num:'#ffeec2',deflector:'#f5dc92',cone:[[0,'#fff0b0'],[.5,'#b48826'],[1,'#3d2a08']],spoke:'#f1d58b',hub:'#f3d877',pocketFloor:.3,fretsGlow:true}
};
function woodGrain(ctx,cx,cy,R,seed,light){ // rings of fake mahogany grain
  const g=radial(ctx,cx,cy,R*.7,R,[[0,light?'#7a3f1b':'#6a3416'],[.5,'#4d230e'],[1,'#2b1206']]);disc(ctx,cx,cy,R,g);
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,R,0,TAU);ctx.arc(cx,cy,R*.74,0,TAU,true);ctx.clip();
  for(let i=0;i<150;i++){const a=(Math.sin(i*12.9898+seed)*43758.5453)%1,b=(Math.sin(i*78.233+seed)*12345.678)%1;const rr=R*(.74+Math.abs(a)*.26);ctx.beginPath();ctx.arc(cx,cy,rr,Math.abs(b)*TAU,Math.abs(b)*TAU+.5+Math.abs(a)*2);ctx.strokeStyle='rgba('+(a>0?'255,190,120,.06':'0,0,0,.18')+')';ctx.lineWidth=R*.004+Math.abs(b)*R*.006;ctx.stroke();}
  ctx.restore();
}
function drawBowl(ctx,cx,cy,R,pal,woody){
  if(woody)woodGrain(ctx,cx,cy,R,3.3,true);
  // gold outer rim
  ctx.lineWidth=R*0.022;ctx.strokeStyle=radial(ctx,cx,cy,R*.95,R*1.0,[[0,'#7b5614'],[.5,'#f3d684'],[1,'#8b6218']]);ctx.beginPath();ctx.arc(cx,cy,R*0.995,0,TAU);ctx.stroke();
  // ball track slope: dark lacquer, lit
  disc(ctx,cx,cy,R*0.9,radial(ctx,cx,cy,R*0.7,R*0.9,[[0,'#2a1408'],[.45,'#4a2410'],[.8,'#6a3818'],[1,'#25110a']]));
  ctx.beginPath();ctx.arc(cx,cy,R*0.9,0,TAU);ctx.strokeStyle='rgba(255,220,150,.35)';ctx.lineWidth=R*.005;ctx.stroke();
  // sheen
  const sh=ctx.createLinearGradient(cx-R,cy-R,cx+R,cy+R);sh.addColorStop(0,'rgba(255,255,255,.18)');sh.addColorStop(.35,'rgba(255,255,255,0)');sh.addColorStop(1,'rgba(0,0,0,.2)');
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,R*.9,0,TAU);ctx.arc(cx,cy,R*.72,0,TAU,true);ctx.clip();ctx.fillStyle=sh;ctx.fillRect(cx-R,cy-R,R*2,R*2);ctx.restore();
  disc(ctx,cx,cy,R*0.72,'#d9b25f');disc(ctx,cx,cy,R*0.705,'#1a0e07');
}
function ballRadius(R){return R*0.022;}

/* each design draws one frame */
export function drawWood(ctx,w,h,pose){
  const R=Math.min(w,h)*0.47,cx=w/2,cy=h/2,pal=PAL.wood;
  ctx.fillStyle=radial(ctx,cx,cy,R*.5,R*1.9,[[0,'#2f6a45'],[1,'#0e2418']]);ctx.fillRect(0,0,w,h); // felt
  disc(ctx,cx+R*.04,cy+R*.06,R*1.02,'rgba(0,0,0,.4)');
  drawBowl(ctx,cx,cy,R,pal,true);drawDeflectors(ctx,cx,cy,R,pal);
  drawPockets(ctx,cx,cy,R,pose.W,pal);drawCone(ctx,cx,cy,R,pose.W,pal);
  if(pose.vis){const [x,y]=P(cx,cy,R,pose.r,pose.a);drawBall(ctx,x,y,ballRadius(R),pose,pal,pose.vis);}
 }
