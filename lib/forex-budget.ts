export type ForexBudget={_id:string;revision:number;day:string;used:number;recent:number[];nextPollAt:number};
export function reserveForexBudget(b:ForexBudget,cost:number,now:number,pollCadenceMs?:number):ForexBudget|null{
 if(!Number.isSafeInteger(cost)||cost<1||cost>8||!Number.isSafeInteger(now)||now<0)return null;
 const day=new Date(now).toISOString().slice(0,10);
 // Backwards clock movement never resets or spends against an earlier day.
 if(day<b.day||b.recent.some(t=>t>now))return null;
 const used=day===b.day?b.used:0,recent=b.recent.filter(t=>now-t<60000);
 if(used+cost>800||recent.length+cost>8||(pollCadenceMs!==undefined&&now<b.nextPollAt))return null;
 return {...b,revision:b.revision+1,day,used:used+cost,recent:[...recent,...Array(cost).fill(now)],nextPollAt:pollCadenceMs!==undefined?now+pollCadenceMs:b.nextPollAt};
}
