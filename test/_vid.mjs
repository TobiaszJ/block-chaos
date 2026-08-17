import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, recordVideo: { dir: '/tmp/vidtest', size: { width: 960, height: 540 } } });
const page = await ctx.newPage();
for(let a=1;a<=5;a++){try{await page.goto('http://127.0.0.1:5173/',{waitUntil:'commit',timeout:30000});break;}catch(e){if(a===5)throw e;await new Promise(r=>setTimeout(r,2000*a));}}
await page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 500 });
await page.evaluate(() => document.getElementById('start-btn').click());
await page.evaluate(() => window.__game.setCamera(14, 12, 14));
await page.evaluate(() => window.__game.setLook(0.6, -0.35));
await page.waitForTimeout(4000);
const v = page.video();
await page.close(); await ctx.close();
const path = await v.path();
await browser.close();
console.log('VIDEO:', path);
