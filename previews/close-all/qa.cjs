const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/opt/hako/lib/node_modules/playwright');
const assert=require('node:assert/strict');
const base=process.env.CLOSE_DEMO_URL||'http://127.0.0.1:43917';
(async()=>{
 const browser=await chromium.launch({executablePath:'/opt/hako/bin/google-chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
  const ctx=await browser.newContext({viewport:{width,height:900}});
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const api=async(path,data)=>{const r=await ctx.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json();};
  await api('/demo-reset',{});await api('/api/settings',{skipCloseConfirmation:false});
  await page.goto(base);await page.locator("input[name=skipCloseConfirmation]").waitFor();
  const toggle=page.locator("input[name=skipCloseConfirmation]");
  assert.equal(await toggle.isChecked(),false);
  const menu=page.getByLabel('Close positions',{exact:true});
  const choose=async(label)=>{await menu.click();await page.getByRole('button',{name:label,exact:true}).click();};
  const state=async()=> (await ctx.request.get(base+'/room')).json();
  // Default confirmation is cancel-focused and Enter cannot settle.
  await choose('Close all');
  let dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
  await page.keyboard.press('Enter');assert.equal((await state()).positions.length,2);
  // Price moves after the snapshot, server decides who profits, not original UI.
  await choose('Close all profiting');await api('/demo-mark',{micro:86_000_000_000});
  await dialog.getByRole('button',{name:'Close all profiting',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  let room=await state();assert.equal(room.positions.length,1);assert.equal(room.positions[0].symbol,'ETH');
  assert.ok(room.closedPositions[0].closingFee>0);assert.ok(room.closedPositions[0].realizedPnl>0);
  await page.screenshot({path:'/tmp/close-modes-'+width+'-profit.png',fullPage:true});
  // Flat-at-entry with opening fees is losing, never profiting.
  await api('/demo-reset',{});await page.reload();await menu.waitFor();
  await choose('Close all losing');await dialog.getByRole('button',{name:'Close all losing',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  room=await state();assert.equal(room.positions.length,0);assert.equal(room.closedPositions.length,2);
  // All still closes both, stale ETH remains open and is explicitly reported.
  await api('/demo-reset',{});await api('/demo-stale',{});await page.reload();
  await choose('Close all');await dialog.getByRole('button',{name:'Close all',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  room=await state();assert.equal(room.positions.length,1);assert.equal(room.positions[0].symbol,'ETH');
  assert.equal(room.perpsCloseAll.failed.length,1);assert.match(room.perpsCloseAll.failed[0].error,/price unavailable/i);
  await page.getByText(/could not close and remain open/).waitFor();
  // Real checkbox saves, survives reload and a position reset, bypasses modal.
  await toggle.check();await page.waitForTimeout(650);await page.reload();await toggle.waitFor();
  assert.equal(await toggle.isChecked(),true);
  await api('/demo-reset',{});await page.reload();
  let posts=0;page.on('request',r=>{if(r.url().endsWith('/api/finance'))posts++});
  await page.route('**/api/finance',async route=>{await new Promise(r=>setTimeout(r,350));await route.continue();});
  await menu.click();
  await page.getByRole('button',{name:'Close all',exact:true}).evaluate(button=>{button.click();button.click();});
  assert.equal(await dialog.isVisible(),false);
  await page.waitForFunction(()=>document.querySelector('.perps-close-control [role=status]')?.textContent.includes('2 closed'));
  assert.equal(posts,1);room=await state();assert.equal(room.positions.length,0);
  assert.equal(room.closedPositions.length,2);
  await page.screenshot({path:'/tmp/close-modes-'+width+'-immediate.png',fullPage:true});
  // Bypass applies to both sign modes too, with no popup.
  for(const label of ['Close all profiting','Close all losing']){
   await api('/demo-reset',{});await api('/demo-mark',{micro:86_000_000_000});await page.reload();
   const previousPosts=posts;await choose(label);
   await page.waitForFunction(()=>document.querySelector('.perps-close-control [role=status]')?.textContent.includes('1 closed'));
   assert.equal(await dialog.isVisible(),false);assert.equal(posts,previousPosts+1);
   room=await state();assert.equal(room.positions.length,1);
   assert.equal(room.positions[0].symbol,label.endsWith('profiting')?'ETH':'BTC');
  }
  // Restore confirmation and check menu/dialog fit.
  await toggle.uncheck();await page.waitForTimeout(650);await api('/demo-reset',{});await page.reload();
  await menu.click();await page.screenshot({path:'/tmp/close-modes-'+width+'-menu.png',fullPage:true});
  const bounds=await page.locator('.perps-close-options').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
  await page.getByRole('button',{name:'Close all losing',exact:true}).click();
  const db=await dialog.boundingBox();assert.ok(db.x>=0&&db.x+db.width<=width);
  await page.screenshot({path:'/tmp/close-modes-'+width+'-dialog.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log(width+' PASS modes, fees, fresh sign, stale partial, default/persist/bypass, one request, layout, no JS errors');
  await ctx.close();
 }
 console.log('served commit '+await (await browser.newContext()).request.get(base+'/commit').then(r=>r.text()));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
