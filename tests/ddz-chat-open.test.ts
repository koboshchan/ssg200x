import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"/home/kit/out/cal-browser-evidence/node_modules/playwright");
test("ddz room visibility toggle stays clickable with TableTalk open on mobile and desktop",async()=>{
 const browser=await chromium.launch({headless:true,channel:"chromium"});
 try{for(const vp of [{width:390,height:700},{width:1280,height:800}]){
  const page=await browser.newPage({viewport:vp});
  await page.route("https://ddz.test/**",(r:any)=>r.fulfill({contentType:"text/html",body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><main class="game-main dd-main"><div style="height:1100px">lobby</div><label class="dd-check"><input type="checkbox" id="pub"/><span>Public recruiting</span></label></main><aside class="chat-dock"><header>TableTalk</header></aside>'}));
  await page.goto("https://ddz.test");
  await page.addStyleTag({content:readFileSync("app/globals.css","utf8")});
  await page.evaluate(()=>document.documentElement.classList.add("chat-open"));
  await page.locator("#pub").scrollIntoViewIfNeeded();
  await page.locator("#pub").check({timeout:3000});
  assert.equal(await page.locator("#pub").isChecked(),true);
  assert.equal(await page.locator(".chat-dock").isVisible(),true,"chat stays open");
  await page.close();
 }}finally{await browser.close();}
});
