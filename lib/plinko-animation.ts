/** Presentation only. Recorded server bits condition peg impulses, never settlement.
 * Analytic gravity flights avoid unbounded inverse-physics searches for edge slots.
 * Every flight joins the next at the same contact, with no final-slot teleport.
 */
export type PlinkoPoint={x:number;y:number};
export type PlinkoFlight={start:PlinkoPoint;end:PlinkoPoint;at:number;duration:number;vy:number;gravity:number};
export type PlinkoAnimation={flights:PlinkoFlight[];duration:number;slot:number};
export type PlinkoGeometry={width:number;height:number;landingY?:number;landingX?:number};
function random(seed:string){let h=2166136261;for(const c of seed)h=Math.imul(h^c.charCodeAt(0),16777619);return()=>{h^=h<<13;h^=h>>>17;h^=h<<5;return(h>>>0)/4294967296;};}
export function createPlinkoAnimation(path:readonly number[],slot:number,geometry:PlinkoGeometry,seed=''):PlinkoAnimation{
 if(path.length!==8||path.some(b=>b!==0&&b!==1)||!Number.isInteger(slot)||slot!==path.reduce((a,b)=>a+b,0))throw new Error('Invalid recorded Plinko path');
 const {width,height}=geometry;if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Invalid Plinko board');
 const rng=random(seed),gravity=height*3.8,flights:PlinkoFlight[]=[];
 let start={x:width/2,y:-12},at=0,rights=0;
 const add=(end:PlinkoPoint,vy:number)=>{
  const dy=end.y-start.y,duration=(-vy+Math.sqrt(vy*vy+2*gravity*dy))/gravity;
  flights.push({start,end,at,duration,vy,gravity});at+=duration;start=end;
 };
 for(let row=0;row<8;row++){
  const flank=(path[row]?1:-1)*(2.5+rng()*1.5);
  const pegX=width/2+(rights-row/2)*width/9;
  const pegY=((row+1)*.11-.04)*height;
  add({x:pegX+flank,y:pegY-Math.sqrt(121-flank*flank)},row===0?0:-height*(.19+rng()*.07));
  rights+=path[row];
 }
 add({x:geometry.landingX??(slot+.5)*width/9,y:geometry.landingY??height-38},-height*(.15+rng()*.035));
 return{flights,duration:at,slot};
}
export function samplePlinkoAnimation(animation:PlinkoAnimation,seconds:number):PlinkoPoint{
 const fs=animation.flights;
 if(seconds<=0)return fs[0].start;
 if(seconds>=animation.duration)return fs[fs.length-1].end;
 const f=fs.find(f=>seconds<f.at+f.duration)??fs[fs.length-1];
 const t=Math.max(0,Math.min(f.duration,seconds-f.at));
 return{x:f.start.x+(f.end.x-f.start.x)*t/f.duration,y:f.start.y+f.vy*t+.5*f.gravity*t*t};
}
