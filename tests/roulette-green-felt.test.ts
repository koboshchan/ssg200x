import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const read=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('wheel area uses the continuous green felt with no canvas box',()=>{
 const css=read('app/roulette.module.css'),tsx=read('app/roulette-wheel.tsx'),render=read('runtime/roulette-render.mjs');
 assert.match(css,/\.felt\{[^}]*radial-gradient\([^}]*#2f6a45/);
 assert.ok(!css.includes('rgb(33,91,120);border-radius:8px'));
 assert.doesNotMatch(css,/\.wheel\{[^}]*filter/);
 assert.doesNotMatch(tsx,/borderRadius/);
 assert.doesNotMatch(render,/ctx\.fillRect\(0,0,w,h\)/);
});

test('wood renderer fills only clipped rectangles and leaves the canvas backdrop transparent',async()=>{
 const {drawWood}=await import('../runtime/roulette-render.mjs');
 let clipped=false;const stack:boolean[]=[];let fills=0;
 const gradient={addColorStop(){}};
 const ctx=new Proxy({} as Record<string,any>,{
  get(_target,key){
   if(key==='save')return()=>stack.push(clipped);
   if(key==='restore')return()=>{clipped=stack.pop()??false;};
   if(key==='clip')return()=>{clipped=true;};
   if(key==='fillRect')return(x:number,y:number,w:number,h:number)=>{fills++;assert.ok(clipped,'rectangular sheen must be clipped');assert.notDeepEqual([x,y,w,h],[0,0,460,460]);};
   if(String(key).startsWith('create'))return()=>gradient;
   return()=>{};
  },set(){return true;}
 });
 for(const W of [0,1.7])drawWood(ctx as unknown as CanvasRenderingContext2D,460,460,{W,a:W+.2,r:.8,z:0,vis:1,phi:.2,e:0,phase:"idle"});
 assert.equal(fills,2,'preserves clipped bowl sheen each frame');
 assert.equal(stack.length,0);
});

test('animation clears main and fade canvases before repainting every frame',()=>{
 const source=read('app/roulette-wheel.tsx');
 const frame=source.slice(source.indexOf('const draw=()=>{'),source.indexOf('draw();return()=>cancelAnimationFrame'));
 assert.match(frame,/ctx\.clearRect\(0,0,size\.width,size\.height\);/);
 assert.match(frame,/old\.clearRect\(0,0,size\.width,size\.height\);\s*drawWood\(old/);
 assert.ok(frame.indexOf('ctx.clearRect(')<frame.indexOf('drawWood(ctx'));
 assert.ok(frame.indexOf('ctx.clearRect(')<frame.indexOf('requestAnimationFrame(draw)'));
});
