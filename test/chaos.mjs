import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 120)));
page.on('console', m => { if (m.type() === 'error') errors.push('CON: ' + m.text().slice(0, 120)); });
for (let _a = 1; _a <= 5; _a++) {
  try { await page.goto('http://127.0.0.1:5173/', { waitUntil: 'commit', timeout: 30000 }); break; }
  catch (_e) { if (_a === 5) throw _e; await new Promise(_r => setTimeout(_r, 2000 * _a)); }
}
await page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 500 });
await page.waitForTimeout(3000);

const r = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  const out = {};

  // Hotbar-Slots
  out.slots = document.querySelectorAll('#hotbar .slot').length;

  // --- Kanone platzieren + feuern ---
  const h = g.world.heightAt(30, 10);
  g.selectSlot(8); // CANNON
  g.doPlace(); // zielt auf... Kamera schaut auf Turm(36,36). Stattdessen direkt spawnen:
  const canon = g.spawnBlock(8, 30, h, 10, null, { aimDir: { x: 0, y: 0.35, z: 1 } });
  await sleep(300);
  const bodiesBefore = g.world.bodies.size;
  const cpos0 = canon.body.translation();
  g.fireCannon(canon);
  await sleep(100);
  const cpos1 = canon.body.translation();
  out.cannon = {
    bodiesBefore, bodiesAfter: g.world.bodies.size,
    recoil: Math.hypot(cpos1.x - cpos0.x, cpos1.y - cpos0.y, cpos1.z - cpos0.z),
  };

  // C = alle feuern (via fireAllCannons)
  g.fireAllCannons();
  await sleep(100);
  out.allShots = g.world.bodies.size;

  // --- Schwarzes Loch: saugt langsam an + wächst mit jeder Beute ---
  g.selectSlot(9);
  const bh = g.spawnBlock(9, 20, g.world.heightAt(20, 20), 20);
  await sleep(200);
  const sizeOf = a => Math.min(3.2, 1 + a * 0.15);
  const size0 = sizeOf(bh.absorbed);
  // 12 Blöcke in der Nähe streuen
  for (let i = 0; i < 12; i++) g.spawnBlock(3, 20, g.world.heightAt(20, 20) + 1 + Math.floor(i / 4) * 2, 20 + 2 + (i % 4));
  await sleep(4000);
  const a1 = bh.absorbed, size1 = sizeOf(a1);
  await sleep(3000);
  const a2 = bh.absorbed;
  out.bh = {
    absorbed1: a1, absorbed2: a2,
    absorbedSome: a1 > 0,          // es hat gefressen
    slow: a1 < 12,                 // nicht alles auf einmal (langsam)
    grew: size1 > size0,           // ist größer geworden
    stillEating: a2 >= a1,         // isst weiter
    alive: !bh.dead,
    size1: +size1.toFixed(2),
  };

  // --- Zeitlupe ---
  g.spawnBlock(3, 40, 20, 30); // Stein fallen lassen
  await sleep(200);
  g.setSlowMo(true);
  const s0 = []; for (const b of g.world.bodies) if (b.type === 3) s0.push(b.body.translation().y);
  await sleep(1000);
  const s1 = []; for (const b of g.world.bodies) if (b.type === 3) s1.push(b.body.translation().y);
  g.setSlowMo(false);
  // Normallage-Vergleich
  g.spawnBlock(3, 40, 20, 32);
  await sleep(200);
  const n0 = []; for (const b of g.world.bodies) if (b.type === 3) n0.push(b.body.translation().y);
  await sleep(1000);
  const n1 = []; for (const b of g.world.bodies) if (b.type === 3) n1.push(b.body.translation().y);
  const drop = (a, b) => Math.min(...b) - Math.min(...a);
  out.slowmo = { dropSlow: drop(s0, s1).toFixed(2), dropNormal: drop(n0, n1).toFixed(2) };

  return out;
});
console.log(JSON.stringify(r, null, 1));
// Runtime-Fehler (ohne Shutdown): Seite erst mal 5s offen lassen...
await page.waitForTimeout(3000);
const real = errors.filter(e => !e.includes('popErrorScope') && !e.includes('createBuffer'));
console.log('RUNTIME-ERRORS:', real.length ? JSON.stringify(real, null, 1) : 'keine');
await browser.close();
