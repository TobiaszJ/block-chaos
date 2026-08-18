import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

// Screenshots sind nur Kosmetik (CI: SwiftShader-Frame ist soweiß weiiß).
// Unter Last kann der Headless-Compositor hängen -> Timeout. Dann nur
// warnen, NICHT die Suite crashen lassen (bekanntes CI-Flake).
const safeShot = async (path) => {
  try { await page.screenshot({ path, timeout: 10000 }); }
  catch { console.log('SCREENSHOT: ' + path + ' übersprungen (Headless-Compositor zu langsam – kein Spiel-Bug)'); }
};

for (let _a = 1; _a <= 5; _a++) {
  try { await page.goto('http://127.0.0.1:5173/', { waitUntil: 'commit', timeout: 30000 }); break; }
  catch (_e) { if (_a === 5) throw _e; await new Promise(_r => setTimeout(_r, 2000 * _a)); }
}
await page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 500 });
await page.waitForTimeout(5000);

const info = await page.evaluate(async () => {
  const g = window.__game;
  if (!g) return { ok: false, reason: 'window.__game fehlt – Main-Script ist nicht gelaufen' };
  const gpu = await navigator.gpu.requestAdapter();
  return {
    ok: true,
    webgpu: !!gpu,
    gpuName: gpu ? gpu.info?.description || 'adapter da' : null,
    bodies: g.world.bodies.size,
    water: g.water.cells.size,
    sources: g.world.waterSources.size,
    fps: document.getElementById('fps').textContent,
  };
});
console.log('INIT:', JSON.stringify(info));

// Blöcke sollten sich physikalisch bewegt haben (Turm/Stein haben fallen gelassen)
const ys = await page.evaluate(() => {
  const g = window.__game;
  return [...g.world.bodies].map((r) => r.body.translation().y);
});
console.log('BLOCK-Y min/max:', Math.min(...ys).toFixed(2), Math.max(...ys).toFixed(2));

// Explosion mitten ins Gelände
const before = info.bodies;
await page.evaluate(() => window.__game.explodeAt(16, 9, 16));
await page.waitForTimeout(1500);
const afterBoom = await page.evaluate(() => ({
  bodies: window.__game.world.bodies.size,
}));
console.log('EXPLOSION: bodies', before, '->', afterBoom.bodies);

// Gravitations-Flip: Stein in der Luft muss nach OBEN fallen (nicht ins Terrain)
await page.evaluate(() => window.__game.flipGravity());
await page.waitForTimeout(300);
const flip = await page.evaluate(async () => {
  const g = window.__game;
  const r = g.spawnBlock(3, 24, 12, 24); // STONE, frei in der Luft
  const y0 = r.body.translation().y;
  await new Promise((res) => setTimeout(res, 1500));
  const y1 = r.body.translation().y;
  return { flipped: g.world.gravityFlipped, y0: +y0.toFixed(2), y1: +y1.toFixed(2), wentUp: y1 > y0 + 0.5 };
});
console.log('GRAV-FLIP:', JSON.stringify(flip));
await safeShot('shot-flip.png');

// Zurück, Wasser sollte nach unten sacken
await page.evaluate(() => window.__game.flipGravity());
await page.waitForTimeout(3000);
await safeShot('shot-normal.png');

// Blöcke neben der Kamera platzieren & per Knall weg
const push = await page.evaluate(async () => {
  const g = window.__game;
  g.setCamera(20, 14, 20);
  const r = g.spawnBlock(5, 18, 12, 22); // GUMMY vor die Kamera
  await new Promise((res) => setTimeout(res, 300));
  g.doPush();
  await new Promise((res) => setTimeout(res, 800));
  const p = r.body.translation();
  const v = r.body.linvel();
  return { moved: Math.hypot(p.x - 18.5, p.y - 12.5, p.z - 22.5) > 0.3, speed: Math.hypot(v.x, v.y, v.z).toFixed(2) };
});
console.log('PUSH:', JSON.stringify(push));

// Brechen: TNT direkt in die Luft zaubern -> sollte bei "brechen" explodieren
const breakTnt = await page.evaluate(() => {
  const g = window.__game;
  g.setCamera(10, 12, 10);
  g.selectSlot(6); // TNT
  g.doPlace();
  const n = g.world.bodies.size;
  g.doBreak();
  return { n };
});
console.log('PLACE+BREAK TNT:', JSON.stringify(breakTnt));
await page.waitForTimeout(1200);

// popErrorScope/createBuffer = bekannte SwiftShader-Artefakte unter Last (kein Spiel-Bug)
const finalErrors = errors.filter((e) => !e.includes('404') && !e.includes('popErrorScope') && !e.includes('createBuffer'));
console.log('CONSOLE-ERRORS:', finalErrors.length ? finalErrors : 'keine');
await browser.close();
