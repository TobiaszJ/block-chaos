// v0.5.0: Terrain-Instability-Checks + Magnet-Ausrichtung
//  1. Inselboden: Explosionen dürfen nie durch die Insel bohren (Repro:
//     vorher fraß eine Explosion an der tiefsten Stelle ~40 Bodenzellen weg
//     und ein Schwarzes Loch fiel nach 2 s aus der Welt)
//  2. Schwarzes Loch über dem Krater: bleibt 6 s in der Welt und kommt nie
//     mit dem Mittelpunkt ins Terrain
//  3. Voxeldiktatur (Block): Terrain, das „in" einen Block wächst, muss den
//     Block an die nächste freie Fläche schleudern
//  4. Voxeldiktatur (Schwarzes Loch): eingewachsenes Loch wird befreit
//  5. Magnet Block↔Block: verschobener Stein rastet auf den Stapel zurück
//  6. Magnet Grid: Stein auf dem Boden richtet sich zur Zell-Mitte aus
//  7. Invarianten: kein Körper im Terrain, keine Physik-/Runtime-Errors
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
await page.waitForTimeout(2000);

const r = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  const KK = (i, j, k) => i + k * 48 + j * 2304;
  const inB = (i, j, k) => i >= 0 && i < 48 && k >= 0 && k < 48 && j >= 0 && j < 26;
  const out = {};

  // ---------- 1. Inselboden: Explosion an der tiefsten Stelle ----------
  let fi = 0, fk = 0, fh = 999;
  for (let i = 0; i < 48; i++) for (let k = 0; k < 48; k++) {
    const h = g.world.heightAt(i, k);
    if (h < fh) { fh = h; fi = i; fk = k; }
  }
  const floorCount = () => { let n = 0; for (let i = 0; i < 48; i++) for (let k = 0; k < 48; k++) if (g.world.grid[KK(i, 0, k)] === 1) n++; return n; };
  out.lowCol = [fi, fk, fh];
  out.floorBefore = floorCount();
  g.explodeAt(fi, fh - 1, fk); // tiefster Punkt: Radius reicht bis in die Bodenzeile
  await sleep(700);
  out.floorAfter = floorCount();
  out.craterBottom = g.world.grid[KK(fi, 0, fk)];

  // ---------- 2. Schwarzes Loch über dem Krater ----------
  const bh = g.spawnBlock(9, fi, fh, fk);
  out.bhStartY = +bh.body.translation().y.toFixed(2);
  let bhInside = 0, bhSamples = 0, bhMinY = 1e9;
  const tBh = Date.now();
  while (Date.now() - tBh < 6000) {
    await sleep(500);
    if (bh.dead) break;
    bhSamples++;
    const t = bh.body.translation();
    bhMinY = Math.min(bhMinY, t.y);
    if (inB(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z)) &&
        g.world.grid[KK(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))] === 1) bhInside++;
  }
  out.bhDead = bh.dead;
  out.bhSamples = bhSamples;
  out.bhInside = bhInside;
  out.bhMinY = +bhMinY.toFixed(2);
  out.bhInWorld = !bh.dead && bh.body.translation().y > -0.5 && bh.body.translation().y < 60;

  // ---------- 3. Voxeldiktatur: Stein, in den Terrain wächst ----------
  const i3 = 8, k3 = 20;
  const h3 = g.world.heightAt(i3, k3);
  const stone3 = g.spawnBlock(3, i3, h3, k3);
  await sleep(2000); // zur Ruhe kommen
  const p3 = stone3.body.translation();
  const c3i = Math.floor(p3.x), c3j = Math.floor(p3.y), c3k = Math.floor(p3.z);
  out.s3BeforeY = +p3.y.toFixed(2);
  // Terrain „wächst" in die Zelle des Steins (simuliert: Block sitzt im
  // frisch rebuilteten Collider fest)
  g.world.grid[KK(c3i, c3j, c3k)] = 1;
  g.world.rebuildColumns([c3i + c3k * 48]);
  await sleep(1500);
  const p3b = stone3.body.translation();
  out.s3AfterY = +p3b.y.toFixed(2);
  out.s3Lifted = p3b.y > p3.y + 0.5;
  out.s3StillInside = inB(Math.floor(p3b.x), Math.floor(p3b.y), Math.floor(p3b.z)) &&
    g.world.grid[KK(Math.floor(p3b.x), Math.floor(p3b.y), Math.floor(p3b.z))] === 1;

  // ---------- 4. Voxeldiktatur: Schwarzes Loch, in das Terrain wächst ----------
  const i4 = 30, k4 = 12;
  const h4 = g.world.heightAt(i4, k4);
  const bh4 = g.spawnBlock(9, i4, h4, k4);
  await sleep(3000); // Grube graben
  const p4 = bh4.body.translation();
  out.bh4BeforeY = +p4.y.toFixed(2);
  const c4i = Math.floor(p4.x), c4j = Math.floor(p4.y), c4k = Math.floor(p4.z);
  g.world.grid[KK(c4i, c4j, c4k)] = 1;
  g.world.rebuildColumns([c4i + c4k * 48]);
  await sleep(1500);
  const p4b = bh4.body.translation();
  out.bh4AfterY = +p4b.y.toFixed(2);
  out.bh4Freed = bh4.dead ? false : (inB(Math.floor(p4b.x), Math.floor(p4b.y), Math.floor(p4b.z)) === false ||
    g.world.grid[KK(Math.floor(p4b.x), Math.floor(p4b.y), Math.floor(p4b.z))] !== 1);
  out.bh4InWorld = !bh4.dead && p4b.y > -0.5 && p4b.y < 60;

  // ---------- 5. Magnet Block↔Block ----------
  const i5 = 18, k5 = 30;
  const h5 = g.world.heightAt(i5, k5);
  g.spawnBlock(3, i5, h5, k5);               // Anker: Stein auf dem Boden
  const mover5 = g.spawnBlock(3, i5, h5 + 1, k5); // Mover: direkt darauf
  await sleep(2500); // Stapel settles
  const p5 = mover5.body.translation();
  // 0,3 m seitlich/diagonal versetzt (bleibt in der eigenen Zelle, COM bleibt
  // innerhalb des Auflage-Fußabdrucks → rutscht nicht vom Anker)
  mover5.body.setTranslation({ x: p5.x - 0.3, y: p5.y, z: p5.z + 0.3 }, true);
  mover5.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  await sleep(4000);
  const p5b = mover5.body.translation();
  out.s5Dist = +Math.hypot(p5b.x - (i5 + 0.5), p5b.y - (h5 + 1.5), p5b.z - (k5 + 0.5)).toFixed(3);
  out.s5Snaps = g.perf.snaps;
  out.s5Dead = mover5.dead;

  // ---------- 6. Magnet Grid-Ausrichtung ----------
  const i6 = 22, k6 = 36;
  const h6 = g.world.heightAt(i6, k6);
  const stone6 = g.spawnBlock(3, i6, h6, k6);
  await sleep(1500);
  const p6 = stone6.body.translation();
  stone6.body.setTranslation({ x: p6.x + 0.3, y: p6.y, z: p6.z + 0.3 }, true);
  stone6.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  await sleep(4000);
  const p6b = stone6.body.translation();
  out.s6Dist = +Math.hypot(p6b.x - (i6 + 0.5), p6b.y - (h6 + 0.5), p6b.z - (k6 + 0.5)).toFixed(3);

  // ---------- 7. Invarianten ----------
  let stuck = 0;
  for (const rec of g.world.bodies) {
    if (rec.dead) continue;
    const t = rec.body.translation();
    if (inB(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z)) &&
        g.world.grid[KK(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))] === 1) stuck++;
  }
  out.stuck = stuck;
  out.physErrors = (window.__physErrors || []).filter(e => !e.includes('popErrorScope') && !e.includes('createBuffer')).length;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await page.waitForTimeout(3000);
const real = errors.filter(e => !e.includes('popErrorScope') && !e.includes('createBuffer'));
console.log('RUNTIME-ERRORS:', real.length ? JSON.stringify(real, null, 1) : 'keine');

// --- Assertions ---
let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
  if (!cond) fails++;
};
ok(r.floorAfter === r.floorBefore, `Inselboden unzerstörbar (Explosion tiefste Stelle ${r.lowCol}: ${r.floorBefore} → ${r.floorAfter} Boden-Zellen)`);
ok(r.craterBottom === 1, 'Krater-Bodenzeile intakt (vorher: 40 Zellen weg)');
ok(!r.bhDead && r.bhInWorld, `Schwarzes Loch über Krater bleibt in der Welt (tiefster Punkt y=${r.bhMinY})`);
ok(r.bhInside === 0, `Schwarzes Loch nie im Terrain (${r.bhInside} von ${r.bhSamples} Samples)`);
ok(r.s3Lifted, `Voxeldiktatur: Stein im Terrain wird befreit (y ${r.s3BeforeY} → ${r.s3AfterY})`);
ok(!r.s3StillInside, 'Stein danach in keiner GROUND-Zelle');
ok(r.bh4Freed, `Voxeldiktatur: eingewachsenes Schwarzes Loch befreit (y ${r.bh4BeforeY} → ${r.bh4AfterY})`);
ok(r.bh4InWorld, 'Schwarzes Loch nach Rettung lebendig & in der Welt');
ok(!r.s5Dead && r.s5Dist < 0.05, `Magnet Block↔Block: verschobener Stein rastet auf den Stapel (Rest ${r.s5Dist} m)`);
ok(r.s5Snaps >= 1, `Hart-Snap registriert (perf.snaps=${r.s5Snaps})`);
ok(r.s6Dist < 0.05, `Magnet Grid: Stein zur Zell-Mitte ausgerichtet (Rest ${r.s6Dist} m)`);
ok(r.stuck === 0, `Kein Körper im Terrain steckengeblieben (${r.stuck})`);
ok(r.physErrors === 0, `Keine Physik-Errors (${r.physErrors})`);
ok(real.length === 0, 'Keine Runtime-Errors');
if (fails > 0) { console.log(`TERRAIN: ${fails} FEHLGESCHLAGEN`); process.exit(1); }
console.log('TERRAIN: ALLE GRÜN ✓');
await browser.close();
