const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/hako/lib/node_modules/playwright');
const assert=require('node:assert/strict');
const base=process.env.DEMO_URL||'http://127.0.0.1:43951';
(async()=>{
 const hard=setTimeout(()=>{console.error('HARD TIMEOUT');process.exit(2);},170000);
 const browser=await chromium.launch({executablePath:'/opt/hako/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const out=[];try{
 for(const width of [1280,390,360]){
  const ctx=await browser.newContext({viewport:{width,height:900}});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>m.type()==='error'&&errors.push(m.text()));
  const KEYS=['cryptoPerps','cryptoSpot','stocks','forex'];
  // Wait until the real component has applied the server flags (it renders the disabled-notice from them), not a fixed sleep.
  const setF=async o=>{const r=await ctx.request.post(base+'/flags',{data:o});const fl=await r.json();const fr=page.waitForResponse(x=>x.url().endsWith('/api/features')&&x.ok());await page.goto(base);const fj=await (await fr).json();for(const k of Object.keys(fl))if(typeof fl[k]==='boolean')assert.equal(fj.features[k],fl[k],'features response '+k);await page.locator('#controls').waitFor();
   const L=(await import('/home/kit/ssg-flags/runtime/feature-catalog.mjs')).FEATURE_LABELS;
   const want=KEYS.filter(k=>fl[k]===false).map(k=>L[k]).sort().join('|');
   await page.waitForFunction(w=>{const n=document.querySelector('.feature-notice');const got=n?n.textContent.replace(/^.*disabled:\s*/,'').split('. New orders')[0].split(', ').sort().join('|'):'';return got===w;},want,{timeout:30000});};
  const list=async()=>{await page.locator('[data-market-picker]').click();const t=await page.getByRole('dialog').innerText();await page.keyboard.press('Escape');return t;};
  const emits=()=>page.evaluate(()=>(window.__emits||[]).map(e=>e[1]));
  // default: stocks+forex off
  await setF({stocks:false,forex:false,cryptoSpot:true,cryptoPerps:true});
  let t=await list();assert.ok(/BTC/.test(t)&&/ETH/.test(t),t);assert.ok(!/Apple|AAPL|Tesla|TSLA|EUR\/USD|USD\/JPY|STOCKS|FOREX/i.test(t),'hidden:'+t);
  await page.locator('[data-market-picker]').click();for(const term of ['AAPL','apple','EUR','JPY','tesla']){await page.getByRole('searchbox').fill(term);const s=await page.getByRole('dialog').innerText();assert.ok(/No matches/.test(s)&&!/AAPL|EUR\/USD|USD\/JPY|TSLA/.test(s.replace('Search symbols','')),'search leaks '+term+': '+s);}await page.keyboard.press('Escape');
  // held classes remain
  let body=await page.locator('.markets').innerText();
  for(const s of ['BTC','ETH','AAPL','EUR/USD'])assert.ok(body.includes(s),'held '+s+' retained');
  // held stock keeps closed-market guard; held crypto timeouts not misapplied
  // AAPL not selected: size rules only; select via enabling stocks to check reason, then disable again
  await setF({stocks:true});
  await page.locator('[data-market-picker]').click();await page.getByRole('dialog').getByRole('button',{name:/AAPL|Apple/}).click();
  await page.locator('select').first().selectOption('sell');
  body=await page.locator('.markets').innerText();assert.ok(/Stock market closed or calendar unverified/.test(body),'stock guard text with stocks on');
  assert.ok(/Chart AAPL/.test(await page.getByTestId('chart').innerText()),'chart shows selected AAPL');
  const closeStock=page.locator('tr',{hasText:'AAPL long'}).getByRole('button',{name:/Close/});
  assert.ok(await closeStock.first().isDisabled(),'stock position close paused while closed');
  // disable stocks while AAPL selected: fallback to permitted symbol, guard still on held stock
  await ctx.request.post(base+'/flags',{data:{stocks:false}});await page.waitForTimeout(100);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!/Apple|AAPL \//.test(document.querySelector('[data-market-picker]').innerText),null,{timeout:20000});
  assert.ok(/Chart BTC/.test(await page.getByTestId('chart').innerText()),'chart fell back to BTC');
  assert.equal(await page.getByTestId('chart').count(),1);
  const sub=(await emits()).filter(x=>x!==undefined).slice(-1)[0];assert.equal(sub,'BTC','subscription follows fallback');
  const trig=await page.locator('[data-market-picker]').innerText();assert.ok(/BTC|Bitcoin/i.test(trig),trig);
  const closeStock2=page.locator('tr',{hasText:'AAPL long'}).getByRole('button',{name:/Close/});
  assert.ok(await closeStock2.first().isDisabled(),'held disabled stock close still guarded');
  assert.ok(!(await emits()).slice(-1).includes('AAPL'),'last subscription not AAPL');
  // crypto timeout classification: ETH stale but BTC fine; ETH close must be disabled by 10s rule, BTC close enabled
  const btnClose=s=>page.locator('tr',{hasText:s+' long'}).getByRole('button',{name:/Close/}).first();
  assert.ok(await btnClose('ETH').isEnabled(),'ETH position close not stock-guarded');
  assert.ok(await btnClose('EUR/USD').isEnabled(),'held hidden forex close follows forex rule not stock rule');
  await page.locator('[data-market-picker]').click();await page.getByRole('dialog').getByRole('button',{name:/ETH/}).click();
  await page.locator('select').first().selectOption('sell');
  body=await page.locator('.markets').innerText();assert.ok(/Live price unavailable/.test(body),'ETH 10s crypto rule applies');
  assert.ok(await btnClose('BTC').isEnabled(),'BTC close enabled, stock rule not applied');
  // forex off hides, stock open toggle: stock close enabled
  await page.locator('input[name=stockOpen]').check();await page.waitForTimeout(200);
  assert.ok(await btnClose('AAPL').isEnabled(),'AAPL close enabled when stock market open even though listing hidden');
  // crypto both off hides crypto
  await setF({cryptoSpot:false,cryptoPerps:false,stocks:true,forex:true});
  t=await list();assert.ok(!/BTC|ETH/.test(t),'crypto hidden:'+t);assert.ok(/AAPL|Apple/.test(t)&&/EUR\/USD/.test(t));
  // only spot off keeps crypto
  await setF({cryptoSpot:false,cryptoPerps:true,stocks:false,forex:false});
  t=await list();assert.ok(/BTC/.test(t));
  // everything off
  await setF({cryptoSpot:false,cryptoPerps:false,stocks:false,forex:false});
  body=await page.locator('.markets').innerText();assert.ok(/No markets are active/.test(body));assert.equal(await page.locator('[data-market-picker]').count(),0);
  for(const s of ['BTC long','ETH long','AAPL long','EUR/USD long'])assert.ok(body.includes(s),'position retained '+s);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/dm-'+width+'.png'});
  out.push(width+' PASS');await ctx.close();
 }
 console.log(out.join('\n'));}finally{await browser.close().catch(()=>{});clearTimeout(hard);}
})().catch(e=>{console.error(e);process.exit(1);});
