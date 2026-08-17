import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
for (let _a = 1; _a <= 5; _a++) {
  try { await page.goto('http://127.0.0.1:5173/', { waitUntil: 'commit', timeout: 30000 }); break; }
  catch (_e) { if (_a === 5) throw _e; await new Promise(_r => setTimeout(_r, 2000 * _a)); }
}
await page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 500 });
await page.waitForTimeout(1500);
const result = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};

  // --- Ballon: muss steigen und platzen
  const h = g.world.heightAt(28, 30);
  const bal = g.spawnBlock(10, 28, h + 1, 30);
  const y0 = bal.body.translation().y;
  await sleep(1200);
  const y1 = bal.dead ? -999 : bal.body.translation().y;
  await sleep(9000);
  out.balloon = { y0, y1, popped: bal.dead, rose: y1 > y0 + 2 };

  // --- Kette: Stein oben, Kette daneben, Gelenk, Stupser → muss schwingen + halten
  const h2 = g.world.heightAt(10, 10);
  const parent = g.spawnBlock(3, 10, h2 + 4, 10); // Stein schwebt 4 über Boden
  await sleep(300);
  const chain = g.spawnBlock(11, 11, h2 + 4, 10);
  const pa = parent.body.translation(), ca = chain.body.translation();
  const okJoint = g.attachChainJoint(chain, parent, { x:(pa.x+ca.x)/2, y:(pa.y+ca.y)/2, z:(pa.z+ca.z)/2 });
  // Kette wegstupsen → Pendel
  chain.body.applyImpulse({ x: 0, y: 0, z: 6 }, true);
  await sleep(400);
  const p1 = chain.body.translation(), pa1 = parent.body.translation();
  const d1 = Math.hypot(p1.x-pa1.x, p1.y-pa1.y, p1.z-pa1.z);
  await sleep(1600);
  const p2 = chain.body.translation(), pa2 = parent.body.translation();
  const d2 = Math.hypot(p2.x-pa2.x, p2.y-pa2.y, p2.z-pa2.z);
  out.chain = { okJoint, d1: +d1.toFixed(2), d2: +d2.toFixed(2), held: d1 < 1.6 && d2 < 1.6, moved: Math.hypot(p2.x-p1.x,p2.y-p1.y,p2.z-p1.z) > 0.05 };

  // --- Wind (Stein hoch in der Luft, horizontale Speed sofort gemessen)
  const st = g.spawnBlock(2, 20, 18, 22);
  st.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  const hv = () => { const v = st.body.linvel(); return Math.hypot(v.x, v.z); };
  const v0 = hv();
  g.gustWind();
  const v1 = hv(); // applyImpulse wirkt synchron
  out.wind = { v0: +v0.toFixed(2), v1: +v1.toFixed(2), pushed: v1 > v0 + 3 };

  // --- Regen
  const w0 = g.water.totalAmount();
  g.startRain();
  await sleep(2500);
  const w1 = g.water.totalAmount();
  out.rain = { w0, w1, grew: w1 > w0 + 5 };

  return out;
});
console.log(JSON.stringify(result, null, 1));
console.log('RUNTIME-ERRORS:', errs.length ? errs.join(' | ') : 'keine');
await browser.close();
