const {chromium}=require('/opt/hako/lib/node_modules/playwright');
const assert=require('node:assert/strict');
const base=process.env.CLOSE_DEMO_URL||'http://127.0.0.1:43917';
(async()=>{
 const browser=await chromium.launch({executablePath:'/opt/hako/bin/google-chrome',headless:true,args:['--no-sandbox']});
 try{for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  const api=async(path,data)=>{const res=await context.request.post(base+path,{data});assert.ok(res.ok(),await res.text());return res.json();};
  const state=async()=> (await context.request.get(base+'/room')).json();
  const reset=async()=>{await api('/demo-reset',{});await page.goto(base);await page.locator('.open-perps tbody tr').first().waitFor();};
  const row=symbol=>page.locator('.open-perps tbody tr').filter({hasText:symbol});
  const dialog=()=>page.getByRole('dialog');
  const changePercent=async value=>{await dialog().locator('input[type=range]').evaluate((input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);await dialog().getByText(new RegExp('Portion to close · '+value/100+'%')).waitFor();};
  const bounds=async()=>{const b=await dialog().boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+1);assert.ok(b.y>=0&&b.height<=900);};
  await reset();await row('BTC').getByRole('button',{name:'Add margin',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');await page.keyboard.press('Enter');assert.equal((await state()).positions[0].revision??0,0);
  await row('BTC').getByRole('button',{name:'Add margin',exact:true}).click();await dialog().getByLabel('Additional margin for BTC',{exact:true}).fill('50');await bounds();
  await dialog().getByText(/Added notional/).waitFor();await page.screenshot({path:'/tmp/perps-adjust-'+width+'-increase.png',fullPage:true});
  const before=await state(),old=before.positions.find(p=>p.symbol==='BTC');
  // Fresh price at confirmation, not opening the modal, determines the fill.
  await api('/demo-mark',{micro:86_000_000_000});
  let posts=0;page.on('request',r=>{if(r.url().endsWith('/api/finance'))posts++});
  await page.route('**/api/finance',async route=>{await new Promise(resolve=>setTimeout(resolve,150));await route.continue();});
  await dialog().getByRole('button',{name:'Confirm',exact:true}).evaluate(button=>{button.click();button.click();});
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('dialog')).some(d=>d.open));
  let room=await state(),p=room.positions.find(p=>p.symbol==='BTC');
  const fee=7,added=5000-fee,n=BigInt(old.margin+added)*BigInt(old.entry)*86000000000n,d=BigInt(old.margin)*86000000000n+BigInt(added)*BigInt(old.entry);
  assert.equal(p.entry,Number((n+d-1n)/d));assert.equal(p.margin,old.margin+added);assert.equal(p.openingFee,old.openingFee+fee);assert.equal(room.me.wallet,before.me.wallet-5000);assert.equal(p.revision,1);assert.equal(posts,1);
  // Set TP/SL through the real UI before partial closing, then preserve them.
  await row('BTC').getByRole('button',{name:'Edit TP/SL',exact:true}).click();
  await row('BTC').getByLabel('Take-profit for BTC',{exact:true}).fill('95000');await row('BTC').getByLabel('Stop-loss for BTC',{exact:true}).fill('75000');await row('BTC').getByRole('button',{name:'Save',exact:true}).click();
  await row('BTC').getByRole('button',{name:'Edit TP/SL',exact:true}).waitFor();
  for(const bps of [1000,5000]){
   const pre=await state(),original=pre.positions.find(p=>p.symbol==='BTC');
   await row('BTC').getByRole('button',{name:'Partial close',exact:true}).click();await changePercent(bps);await bounds();
   await dialog().getByText(/Net realized P\/L/).waitFor();
   if(bps===1000){await page.screenshot({path:'/tmp/perps-adjust-'+width+'-partial.png',fullPage:true});}
   const oldPosts=posts;await dialog().getByRole('button',{name:'Confirm',exact:true}).evaluate(button=>{button.click();button.click();});
   await page.waitForFunction(()=>!Array.from(document.querySelectorAll('dialog')).some(d=>d.open));
   room=await state();const rem=room.positions.find(p=>p.symbol==='BTC'),closed=room.closedPositions[0];
   assert.equal(rem.margin,original.margin-Math.floor(original.margin*bps/10000));assert.equal(rem.entry,original.entry);assert.equal(rem.leverage,5);assert.equal(rem.takeProfit,95000000000);assert.equal(rem.stopLoss,75000000000);assert.equal(posts,oldPosts+1);
   assert.equal(rem.openingFee+closed.openingFee,original.openingFee);assert.equal(rem.postedMargin+closed.postedMargin,original.postedMargin);
  }
  // Range zero cannot submit. Exact 100% leaves no remainder. Short partial too.
  await row('BTC').getByRole('button',{name:'Partial close',exact:true}).click();await changePercent(0);assert.equal(await dialog().getByRole('button',{name:'Confirm',exact:true}).isDisabled(),true);await changePercent(10000);await dialog().getByRole('button',{name:'Confirm',exact:true}).click();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('dialog')).some(d=>d.open));
  assert.equal((await state()).positions.some(p=>p.symbol==='BTC'),false);
  await row('ETH').getByRole('button',{name:'Partial close',exact:true}).click();await changePercent(1000);await dialog().getByRole('button',{name:'Confirm',exact:true}).click();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('dialog')).some(d=>d.open));assert.equal((await state()).positions[0].side,'short');
  // Quote unavailable rejects add and close without touching live margin/wallet.
  await api('/demo-stale',{});const staleBefore=await state();
  for(const button of ['Add margin','Partial close']){
   await row('ETH').getByRole('button',{name:button,exact:true}).click();await dialog().getByRole('button',{name:'Confirm',exact:true}).click();await dialog().getByRole('alert').waitFor();assert.match(await dialog().getByRole('alert').innerText(),/price unavailable/i);const after=await state();assert.equal(after.me.wallet,staleBefore.me.wallet);assert.deepEqual(after.positions,staleBefore.positions);await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
  }
  assert.deepEqual(errors,[]);console.log('PASS real browser '+width+' add repricing/single-flight/TP-SL/10%-50%-100%/short/dust/stale/cancel/bounds');
  await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
