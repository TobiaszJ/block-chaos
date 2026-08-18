// test/perf.mjs – Performance-Benchmark (v0.3.0):
// Vergleicht das JS-Budget des Instanz-/AO-Updates in einer RUHIGEN Szene
// (alle Blöcke schlafen, nichts ändert sich → das Dirty-Tracking soll den
// 60k-Grid-Scan und die Buffer-Uploads überspringen) mit einer CHAOS-Szene
// (80 Steine werden von zwei Schwarzen Löchern gefressen, Regner läuft,
// Belegung + Grid ändern sich ständig → AO wird fast jeden Frame berechnet).
// Das Dirty-Tracking muss das Ruhe-Budget messbar verkleinern.
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e.message || e).slice(0, 120)));
page.on('console', m => { if (m.type() === 'error') errors.push('CON: ' + m.text().slice(0, 120)); });
for (let _a = 1; _a <= 5; _a++) {
  try { await page.goto('http://127.0.0.1:5173/', { waitUntil: 'commit', timeout: 30000 }); break; }
  catch (_e) { if (_a === 5) throw _e; await new Promise(_r => setTimeout(_r, 2000 * _a)); }
}
await page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 500 });

// Phase 1: Einschwingphase – der Intro-Stein trifft den TNT-Turm, Trümmer
// fliegen, dann schläft die Szene ein (alle Blöcke at rest).
await page.waitForTimeout(20000);

const read = (phase, secs) => page.evaluate(([ph, s]) => {
  const p = window.__game.perf;
  const out = {
    phase: ph,
    frames: p.frames,
    fps: +(p.frames / s).toFixed(1),
    phys: +(p.physMs / s).toFixed(1),  // ms Physik pro Sekunde
    inst: +(p.instMs / s).toFixed(1),   // ms Instanz-/AO-Update pro Sekunde
    ao: +(p.aoFull / s).toFixed(1),     // voll AO-Rekomputationen pro Sekunde
  };
  p.frames = p.physMs = p.instMs = p.aoFull = 0;
  return out;
}, [phase, secs]);

await page.evaluate(() => { const p = window.__game.perf; p.frames = p.physMs = p.instMs = p.aoFull = 0; });
await page.waitForTimeout(8000);
const quiet = await read('quiet', 8);

// Phase 2: Chaos – frische Insel (neuer TNT-Turm + fliegender Stein),
// zwei Schwarze Löcher, um jede Grube ein Feld aus Steinen als endlose
// Beute, dazu Regen. Belegung + Grid ändern sich fast jeden Frame.
await page.evaluate(() => {
  const g = window.__game;
  g.newIsland();
  const h = g.world.heightAt;
  g.spawnBlock(9, 16, h(16, 16), 16);
  g.spawnBlock(9, 34, h(34, 34), 34);
  for (let n = 0; n < 80; n++) {
    const a = Math.random() * Math.PI * 2;
    const rad = 4 + Math.random() * 4;
    const base = n < 40 ? [16, 16] : [34, 34];
    const i = Math.round(base[0] + Math.cos(a) * rad);
    const k = Math.round(base[1] + Math.sin(a) * rad);
    if (i >= 1 && i < 47 && k >= 1 && k < 47)
      g.spawnBlock(3, i, h(i, k) + 2, k);
  }
  g.startRain();
});
await page.waitForTimeout(10000);
const chaos = await read('chaos', 10);

// Phase 3: Adaptives Budget – erst den Ist-Zustand nach dem Chaos lesen
// (langsame Systeme müssen einen Automaten-Cut zeigen, schnelle nicht),
// dann den Mechanismus deterministisch prüfen: Budget erzwingen →
// Objekte/Wasser müssen wirklich geschnitten werden.
const b = await page.evaluate(() => {
  const g = window.__game;
  return {
    body: g.budget.body, water: g.budget.water,
    bodyMax: g.budget.bodyMax, waterMax: g.budget.waterMax,
    bodiesFits: g.world.bodies.size <= g.budget.body,
    waterFits: g.water.totalAmount() <= g.budget.water + 1,
    notOverHardCap: g.budget.body <= g.budget.bodyMax && g.budget.water <= g.budget.waterMax,
  };
});
console.log('BUDGET nach Chaos:', JSON.stringify({ body: b.body + '/' + b.bodyMax, water: b.water + '/' + b.waterMax }));

const mech = await page.evaluate(() => {
  const g = window.__game;
  const bodiesBefore = g.world.bodies.size;
  const waterBefore = g.water.totalAmount();
  let cut = 0, bodiesAfter = bodiesBefore;
  if (bodiesBefore > 5) {
    // 1) Objekt-Budget erzwingen → cutElements muss die Szene daran bringen
    g.budget.body = Math.min(20, bodiesBefore - 1);
    cut = g.cutElements();
    bodiesAfter = g.world.bodies.size;
    g.budget.body = g.budget.bodyMax; // wieder freigeben
  }
  // 2) Wasser-Budget erzwingen → älteste Zellen müssen verdunsten
  if (waterBefore > 20) {
    g.budget.water = Math.floor(waterBefore / 2);
    g.water.trimTo(g.budget.water);
    g.budget.water = g.budget.waterMax;
  }
  return { bodiesBefore, cut, bodiesAfter, waterBefore, waterAfter: g.water.totalAmount() };
});

console.log('QUIET  (alles schlafend):', JSON.stringify(quiet));
console.log('CHAOS  (Löcher + 80 Steine + Regen):', JSON.stringify(chaos));
console.log('CUT-MECHANIK:', JSON.stringify(mech));

// popErrorScope/createBuffer = bekannte SwiftShader-Artefakte (keine Spiel-Bugs)
const real = errors.filter(e => !e.includes('popErrorScope') && !e.includes('createBuffer'));
console.log('RUNTIME-ERRORS:', real.length ? JSON.stringify(real, null, 1) : 'keine');

let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
  if (!cond) fails++;
};

ok(quiet.frames > 0 && chaos.frames > 0, 'Perf-Zähler laufen in beiden Phasen');
ok(quiet.fps >= 15, `Ruhende Szene bleibt responsiv (fps ${quiet.fps} ≥ 15)`);
ok(quiet.inst < chaos.inst,
  `Dirty-Tracking: Ruhe-Budget (${quiet.inst} ms/s) < Chaos-Budget (${chaos.inst} ms/s)`);
ok(quiet.inst < chaos.inst * 0.6,
  `Ruhe-Budget deutlich kleiner (×${quiet.inst / Math.max(chaos.inst, 0.01)} < ×0.6)`);
ok(quiet.ao < chaos.ao,
  `AO-Rekomputationen: Ruhe (${quiet.ao}/s) < Chaos (${chaos.ao}/s)`);
// Adaptives Budget (Crash-Schutz v0.4): Auf einem langsamen System
// (fps < 25) muss das Budget automatisch unter die harte Grenze fallen.
// Auf einem schnellen System ist dieser Check ein No-Op – der Cut-Mechanismus
// wird unten ohnehin deterministisch geprüft.
ok(chaos.fps >= 25 || (b.body < b.bodyMax || b.water < b.waterMax),
  `Adaptives Budget: langsames System (${chaos.fps} fps) → Budget gesenkt (${b.body}/${b.bodyMax} Objekte, ${b.water}/${b.waterMax} Wasser)`);
ok(b.bodiesFits, 'Invariante: Objektzahl ≤ Budget');
ok(b.waterFits, 'Invariante: Wasser-Bestand ≤ Budget');
ok(b.notOverHardCap, 'Invariante: Budget ≤ harte Obergrenze');
ok(mech.bodiesBefore <= 5 || (mech.bodiesAfter <= 20 && mech.cut > 0),
  `Cut-Mechanik: Objekte auf Budget geschnitten (${mech.bodiesBefore} → ${mech.bodiesAfter}, ${mech.cut} entfernt)`);
if (mech.waterBefore > 20) {
  ok(mech.waterAfter < mech.waterBefore && mech.waterAfter <= mech.waterBefore / 2 + 10,
    `Cut-Mechanik: Wasser auf Budget geschnitten (${mech.waterBefore} → ${mech.waterAfter})`);
}
ok(real.length === 0, 'keine Runtime-Fehler (Crash-Schutz funktioniert)');
await browser.close();
if (fails > 0) { console.error(`\nPERF: ${fails} fehlgeschlagen`); process.exit(1); }
console.log('PERF: alle Checks bestanden ✓');
