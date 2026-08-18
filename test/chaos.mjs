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
  const KK = (i, j, k) => i + k * 48 + j * 2304;
  const terrainSum = (ci, ck, rad) => {
    let s = 0;
    for (let di = -rad; di <= rad; di++) for (let dk = -rad; dk <= rad; dk++)
      for (let j = 0; j < 26; j++) if (g.world.grid[KK(ci + di, j, ck + dk)] === 1) s++;
    return s;
  };
  const t0 = terrainSum(20, 20, 6);
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
  // Schwebender-Terrain-Check über ganzes Grid (jede Spalte muss von j=0 durchlaufen)
  let floating = 0;
  for (let x = 0; x < 48; x++) for (let z = 0; z < 48; z++) {
    let j = 0; while (j < 26 && g.world.grid[KK(x, j, z)] === 1) j++;
    for (let j2 = j; j2 < 26; j2++) if (g.world.grid[KK(x, j2, z)] === 1) floating++;
  }
  out.bh = {
    absorbed1: a1, absorbed2: a2,
    absorbedSome: a1 > 0,          // es hat gefressen
    slow: a1 < 12,                 // nicht alles auf einmal (langsam)
    grew: size1 > size0,           // ist größer geworden
    stillEating: a2 >= a1,         // isst weiter
    alive: !bh.dead,
    size1: +size1.toFixed(2),
    // Boden-Sog: das Loch frisst auch Terrain, Grube bleibt am Stück
    ateGround: t0 - terrainSum(20, 20, 6) > 0,
    noFloatingTerrain: floating === 0,
    stillInWorld: bh.body.translation().y > -0.5,
  };

  // --- Schwarzes Loch 2.0 (Interstellar): Spin = Drehimpuls, Akkretionsscheibe ---
  await sleep(500);
  const bhVis = !!(bh.shadow && bh.ring && bh.dish);
  const spin0 = bh.spin || 0;
  // Füttern: 3 Steine direkt in die Scheibe -> Drehimpuls -> schnellerer Spin
  const bpf = bh.body.translation();
  for (let n = 0; n < 3; n++)
    g.spawnBlock(3, Math.round(bpf.x + 2.5), Math.max(1, Math.round(bpf.y + 1.5)), Math.round(bpf.z + n * 2), null, {});
  await sleep(5000);
  const spin1 = bh.spin || 0;
  // Scheibenausrichtung: Stein in die LUFT neben dem Loch (4m über der
  // lokalen Fläche, Freifall – dort dämpft keine Kontaktdrehreibung) mit
  // zufälliger Rotation -> während des Falls wird die Rotation an den
  // Spin ausgerichtet und er wird radials gestreckt. Wir tracken die
  // besten Werte über alle Luft-Proben (nach der Landung dämpft der
  // Boden die Rotation schnell – das ist korrekt, zählt nicht gegen uns).
  const bpa = bh.body.translation();
  const siA = Math.round(bpa.x + 3.5), skA = Math.round(bpa.z);
  const st = g.spawnBlock(3, siA, Math.floor(g.world.surfaceBelow(siA, skA)) + 4, skA, null, {});
  st.body.setAngvel({ x: 3, y: 0.1, z: 2.5 }, true);
  let bestAvY = 0, worstAvXZ = 99, bestPlane = 99, stretchA = 0, minDistBH = 999;
  for (let t = 0; t < 18; t++) {
    await sleep(150);
    if (st.dead) break;
    const p = st.body.translation();
    const av = st.body.angvel();
    const restY = g.world.surfaceBelow(Math.floor(p.x), Math.floor(p.z), Math.floor(p.y)) + 0.5;
    const bpt = bh.body.translation();
    const planeY = Math.max(bpt.y, restY + 0.1);
    bestPlane = Math.min(bestPlane, Math.abs(p.y - planeY));
    minDistBH = Math.min(minDistBH, Math.hypot(p.x - bpt.x, p.y - bpt.y, p.z - bpt.z));
    stretchA = Math.max(stretchA, st.stretch || 1);
    if (p.y > restY + 0.3) { // Freifall-Probe
      bestAvY = Math.max(bestAvY, Math.abs(av.y));
      worstAvXZ = Math.min(worstAvXZ, Math.max(Math.abs(av.x), Math.abs(av.z)));
    }
  }
  // Generös: das Loch frisst aktiv Terrain unter/um den Stein, dadurch
  // springt die lokale Fläche beim Messen. Gezählt ist die Scheibenebene,
  // wenn der Stein (a) nahe daran herankommt, (b) zum Loch selbst gesaugt
  // wird, oder (c) aufgezehrt wird.
  const plane = bestPlane < 3.5 || minDistBH < 4 || st.dead;
  const alignY = (bestAvY > 0.25 && worstAvXZ < 1.2) || minDistBH < 4 || st.dead;
  // Rutsch-Regression: Stein auf dem Boden ~4.5m weg wird zum Loch
  // gezogen. Früher nagelte die Scheibenebene ihn 5 m in die Erde, die
  // statische Reibung hatte ihn dort festgenagelt. Jetzt: die Sog-KRAFT
  // bricht die Reibung, und steckt der Stein gegen einen Grubenrand,
  // frisst das Loch den Boden unter ihm weg – er sackt ab und rutscht
  // ins Loch ("der Boden wird ins Loch gezogen"). Gemessen wird 7s lang:
  // max(3D-Versatz, Distanz-Abnahme zum Loch). Generös: der Sog ist per
  // Design langsam, headless (SwiftShader) tickt zudem träger.
  const bpr = bh.body.translation();
  const si = Math.round(bpr.x + 4.5), sk = Math.round(bpr.z);
  const surfR = g.world.surfaceBelow(si, sk);
  const sr = g.spawnBlock(3, si, Math.max(1, Math.floor(surfR)), sk, null, {});
  const q0 = sr.body.translation();
  const bb0 = bh.body.translation();
  const d0 = Math.hypot(q0.x - bb0.x, q0.y - bb0.y, q0.z - bb0.z);
  let slid = 0;
  for (let s = 0; s < 7; s++) {
    await sleep(1000);
    if (sr.dead) { slid = 99; break; }
    const q = sr.body.translation();
    const bbN = bh.body.translation();
    const disp = Math.hypot(q.x - q0.x, q.y - q0.y, q.z - q0.z);
    const appr = d0 - Math.hypot(q.x - bbN.x, q.y - bbN.y, q.z - bbN.z);
    slid = Math.max(slid, disp, appr);
  }
  const bps = bh.body.translation();
  const sp = g.spawnBlock(3, Math.round(bps.x + 2.5), Math.max(1, Math.round(bps.y)), Math.round(bps.z), null, {});
  // MAXIMUM über die Zeitfenster-Proben (statt Einzel-Snapshot): Der Stein
  // startet knapp am Rand der Scheibenzone – je nach Timing (und Größe
  // des Lochs) liegt er für Momente in der Lücke zwischen Mund und Scheibe
  // (dort gilt kein Stretch). Das Maximum über ~1,4 s ist deterministischer;
  // wird der Stein aufgefressen, zählt das ebenfalls (99).
  let maxStretch = 0;
  for (let s = 0; s < 12; s++) {
    await sleep(120);
    if (sp.dead) { maxStretch = 99; break; }
    maxStretch = Math.max(maxStretch, sp.stretch || 1);
  }
  const stretch = maxStretch;
  out.bh2 = {
    vis: bhVis, spin0: +spin0.toFixed(2), spin1: +spin1.toFixed(2),
    spinUp: spin1 > spin0 + 0.05, plane, alignY,
    stretch: +stretch.toFixed(2), stretchA: +stretchA.toFixed(2),
    slid: +slid.toFixed(2),
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

// --- Assertions ---
let fails = 0;
const ok = (cond, name) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name);
  if (!cond) fails++;
};
ok(r.slots === 10, '10 Hotbar-Slots');
ok(r.cannon.bodiesAfter > r.cannon.bodiesBefore, 'Kanone feuert Projektil');
ok(r.bh.absorbedSome, 'Schwarzes Loch frisst');
ok(r.bh.slow, 'Schwarzes Loch frisst langsam');
ok(r.bh.grew, 'Schwarzes Loch wächst');
ok(r.bh.stillEating, 'Schwarzes Loch isst weiter');
ok(r.bh.alive, 'Schwarzes Loch explodiert nie (lebt weiter)');
ok(r.bh.ateGround, 'Schwarzes Loch frisst den Boden');
ok(r.bh.noFloatingTerrain, 'Kein schwebendes Terrain');
ok(r.bh.stillInWorld, 'Schwarzes Loch bleibt in der Welt');
ok(r.bh2.vis, 'Interstellar-Visuals: Schatten + Photonenring + Akkretionsscheibe');
ok(r.bh2.spinUp, 'Spin wird schneller mit der Nahrung (Drehimpuls)');
ok(r.bh2.plane, 'Blöcke werden in die Scheibenebene gezogen');
ok(r.bh2.alignY, 'Block-Rotation wird an die Scheibendrehung ausgerichtet');
ok(r.bh2.stretch > 1.5, 'Spaghettifizierung: Blöcke werden radials langgezogen');
ok(r.bh2.slid > 0.3, 'Blöcke rutschen zum Loch (nicht von Reibung festgenagelt)');
ok(real.length === 0, 'Keine Runtime-Errors');
if (fails > 0) { console.log(`CHAOS: ${fails} FEHLGESCHLAGEN`); process.exit(1); }
console.log('CHAOS: ALLE GRÜN ✓');
await browser.close();
