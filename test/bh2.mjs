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
  const out = {};
  const bhCount = () => { let n = 0; for (const b of g.world.bodies) if (b.type === 9 && !b.dead) n++; return n; };

  // Zwei Löcher 6 m auseinander auf GLEICHER Terrainhöhe (8,24)/(14,24) –
  // die Grubentiefe hängt von der Ursprungshöhe ab, gleiche Höhe heißt
  // gleiche Grube. Plus ein weit entferntes drittes Loch (42,42), das in
  // Ruhe bleiben soll (>24 m von beiden Startpositionen).
  const h = g.world.heightAt;
  const a = g.spawnBlock(9, 8, h(8, 24), 24);
  const b = g.spawnBlock(9, 14, h(14, 24), 24);
  const far = g.spawnBlock(9, 42, h(42, 42), 42);

  // Warten, bis a+b verschmolzen sind (drei -> zwei Löcher)
  const t0 = Date.now();
  let merged = false, tMerge = 0;
  while (Date.now() - t0 < 20000) {
    await sleep(250);
    if (bhCount() === 2) { merged = true; tMerge = Date.now() - t0; break; }
  }
  const survivor = !a.dead ? a : (!b.dead ? b : null);
  const sizeOf = x => Math.min(3.2, 1 + x * 0.15);

  // Schwebendes-Terrain-Check (Gruben dürfen keine Felsen zurücklassen)
  const KK = (i, j, k) => i + k * 48 + j * 2304;
  let floating = 0;
  for (let x = 0; x < 48; x++) for (let z = 0; z < 48; z++) {
    let j = 0; while (j < 26 && g.world.grid[KK(x, j, z)] === 1) j++;
    for (let j2 = j; j2 < 26; j2++) if (g.world.grid[KK(x, j2, z)] === 1) floating++;
  }
  out.merged = merged;
  out.tMerge = +(merged ? tMerge / 1000 : 999).toFixed(1);
  out.count = bhCount();
  out.farAlive = !far.dead;
  out.grew = survivor ? survivor.absorbed >= 2 : false;
  out.size = survivor ? +sizeOf(survivor.absorbed).toFixed(2) : 0;
  out.halo = survivor ? !!(survivor.halo1 && survivor.halo2) : false;
  out.noFloating = floating === 0;
  out.stillInWorld = survivor ? survivor.body.translation().y > -0.5 : false;
  // popErrorScope/createBuffer = bekannte SwiftShader-Artefakte (keine Spiel-Bugs)
  out.physErrors = (window.__physErrors || []).filter(e => !e.includes('popErrorScope') && !e.includes('createBuffer')).length;

  // Das verschmolzene Loch frisst weiter: Stein in ~5 m Entfernung
  // muss in die neue Griffweite fallen und aufgegessen werden.
  out.atePrey = false;
  if (survivor && !survivor.dead) {
    const sp = survivor.body.translation();
    const st = g.spawnBlock(3, Math.round(sp.x + 5), Math.max(1, Math.round(sp.y)), Math.round(sp.z));
    await sleep(4000);
    out.atePrey = st.dead;
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
// Runtime-Fehler (ohne Shutdown): Seite erst mal offen lassen...
await page.waitForTimeout(3000);
const real = errors.filter(e => !e.includes('popErrorScope') && !e.includes('createBuffer'));
console.log('RUNTIME-ERRORS:', real.length ? JSON.stringify(real, null, 1) : 'keine');

// --- Assertions ---
let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
  if (!cond) fails++;
};
ok(r.merged, 'Zwei Schwarze Löcher ziehen sich an und verschmelzen');
ok(r.count === 2, 'Danach: genau 2 Löcher (Überlebendes + fernes)');
ok(r.tMerge < 20, 'Verschmelzung innerhalb des Fensters (t=' + r.tMerge + 's)');
ok(r.farAlive, 'Entferntes drittes Loch bleibt unversehrt');
ok(r.grew, 'Überlebendes Loch hat die Beute absorbiert');
ok(r.size > 1, 'Überlebendes Loch ist gewachsen (size=' + r.size + ')');
ok(r.halo, 'Linsen-Visual: zwei senkrechte Photonen-Halos am Überlebenden');
ok(r.noFloating, 'Kein schwebendes Terrain');
ok(r.stillInWorld, 'Überlebendes Loch bleibt in der Welt');
ok(r.atePrey, 'Verschmolzenes Loch frisst weiter (Stein aufgefressen)');
ok(r.physErrors === 0, 'Keine Physik-Errors');
ok(real.length === 0, 'Keine Runtime-Errors');
if (fails > 0) { console.log(`BH2: ${fails} FEHLGESCHLAGEN`); process.exit(1); }
console.log('BH2: ALLE GRÜN ✓');
await browser.close();
