// Two concurrent browser contexts with OPPOSITE flags; each must only ever see its own flags.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/hako/lib/node_modules/playwright');
const assert=require('node:assert/strict');
const base=process.env.DEMO_URL||'http://127.0.0.1:43951';
const MODE=process.env.ISO_MODE||'check'; // 'check' normal; server must be session-isolated
(async()=>{
 const hard=setTimeout(()=>{console.error('HARD TIMEOUT');process.exit(2);},120000);
 const browser=await chromium.launch({executablePath:'/opt/hako/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try{
  const mk=async(name,flags)=>{const ctx=await browser.newContext({viewport:{width:1280,height:900}});const page=await ctx.newPage();
   const r=await ctx.request.post(base+'/flags',{data:flags});assert.ok(r.ok());
   // exact /api/features response the page applies
   const resp=page.waitForResponse(x=>x.url().endsWith('/api/features')&&x.ok());
   await page.goto(base);const j=await (await resp).json();
   for(const k of Object.keys(flags))assert.equal(j.features[k],flags[k],name+' server flag '+k);
   return {name,ctx,page,flags};};
  const A=await mk('A',{stocks:true,forex:true,cryptoSpot:true,cryptoPerps:true});
  const B=await mk('B',{stocks:false,forex:false,cryptoSpot:true,cryptoPerps:true});
  const listText=async p=>{await p.locator('[data-market-picker]').click();const t=await p.getByRole('dialog').innerText();await p.keyboard.press('Escape');return t;};
  const seesAAPL=t=>/AAPL|Apple/.test(t),seesFx=t=>/EUR\/USD/.test(t);
  // hammer both contexts concurrently, many rounds; waits on rendered enabled state, never a fixed sleep
  for(let i=0;i<25;i++){
   const [ta,tb]=await Promise.all([
    (async()=>{await A.page.reload();await A.page.waitForFunction(()=>!document.querySelector('.feature-notice'),null,{timeout:15000});return listText(A.page);})(),
    (async()=>{await B.page.reload();await B.page.waitForFunction(()=>/Stocks/.test(document.querySelector('.feature-notice')?.textContent||''),null,{timeout:15000});return listText(B.page);})()]);
   assert.ok(seesAAPL(ta)&&seesFx(ta),'A (stocks+fx on) lost listings round '+i+': '+ta);
   assert.ok(!seesAAPL(tb)&&!seesFx(tb),'B (stocks+fx off) saw listings round '+i+': '+tb);
  }
  console.log('ISOLATION PASS 25 rounds, opposite flags concurrent');
 }finally{await browser.close().catch(()=>{});clearTimeout(hard);}
})().catch(e=>{console.error(e);process.exit(1);});
