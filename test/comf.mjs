import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => { const s=String(e); if(!s.includes('popErrorScope')&&!s.includes('createBuffer')) errs.push(s.slice(0,160)); });
for (let _a = 1; _a <= 5; _a++) {
  try { await page.goto('http://127.0.0.1:5173/', { waitUntil: 'commit', timeout: 30000 }); break; }
  catch (_e) { if (_a === 5) throw _e; await new Promise(_r => setTimeout(_r, 2000 * _a)); }
}
await page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 500 });
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  const out = {};
  const sameGrid = (a, b) => { if (a.length !== b.length) return false; for (let i=0;i<a.length;i++) if (a[i]!==b[i]) return false; return true; };

  const before = g.snapshotWorld();
  out.before = { bodies: before.bodies.length, gridLen: before.grid.length, water: before.water.size };

  // --- UNDO: Explosion ändernt Welt, dann zurück ---
  const undoBefore = g.undoCount;
  g.explodeAt(24, 10, 24);      // gräbt Krater + zerstört Blöcke (pushUndo)
  await sleep(200);
  const afterBoom = g.snapshotWorld();
  out.undo = {
    undoPushed: g.undoCount === undoBefore + 1,
    worldChanged: !sameGrid(before.grid, afterBoom.grid) || afterBoom.bodies.length !== before.bodies.length,
  };
  g.doUndo();
  await sleep(200);
  const afterUndo = g.snapshotWorld();
  out.undo.restored = sameGrid(before.grid, afterUndo.grid) && afterUndo.bodies.length === before.bodies.length;
  out.undo.countAfter = g.undoCount;

  // --- SAVE / LOAD ---
  const saveOk = g.saveGame();
  const raw = localStorage.getItem('blok-chaos-save-v1');
  out.save = { ok: saveOk, stored: !!raw, size: raw ? raw.length : 0 };
  const savedSnap = g.snapshotWorld();
  // Veränderung nach dem Speichern
  g.explodeAt(20, 12, 20);
  await sleep(150);
  g.spawnBlock(3, 30, 20, 30);   // extra Stein
  await sleep(150);
  const loadOk = g.loadGame();
  await sleep(250);
  const afterLoad = g.snapshotWorld();
  out.load = {
    ok: loadOk,
    gridRestored: sameGrid(savedSnap.grid, afterLoad.grid),
    bodiesRestored: savedSnap.bodies.length === afterLoad.bodies.length,
  };

  // --- NEUE INSEL ---
  g.newIsland();
  await sleep(400);
  const fresh = g.snapshotWorld();
  let groundCells = 0; for (let i=0;i<fresh.grid.length;i++) if (fresh.grid[i]===1) groundCells++;
  out.newIsland = {
    undoCleared: g.undoCount === 0,
    bodies: fresh.bodies.length,
    groundCells,
    dayPhase: +g.dayPhase.toFixed(2),
    hasPondWater: fresh.water.size > 0,
  };
  return out;
});
console.log(JSON.stringify(r, null, 1));
console.log('RUNTIME-ERRORS:', errs.length ? errs.join(' | ') : 'keine');
await browser.close();
