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

  // --- Tag (Default) ---
  out.day = {
    phase: +g.dayPhase.toFixed(3),
    sunInt: +g.sun.intensity.toFixed(2),
    fogR: +g.scene.fog.color.r.toFixed(2), fogG: +g.scene.fog.color.g.toFixed(2), fogB: +g.scene.fog.color.b.toFixed(2),
    starsOp: +g.stars.material.opacity.toFixed(2),
  };

  // --- Auf Nacht umschalten ---
  g.toggleDayNight();
  await sleep(3000); // Übergang (dt*2.2)
  out.night = {
    phase: +g.dayPhase.toFixed(3),
    sunInt: +g.sun.intensity.toFixed(2),
    fogR: +g.scene.fog.color.r.toFixed(2), fogG: +g.scene.fog.color.g.toFixed(2), fogB: +g.scene.fog.color.b.toFixed(2),
    starsOp: +g.stars.material.opacity.toFixed(2),
    moonOp: +g.scene.children.find(c=>c.isSprite&&c.scale.x<90)?.material.opacity.toFixed(2) ?? 'n/a',
  };
  // Zurück auf Tag
  g.toggleDayNight();
  await sleep(3000);
  out.backToDay = { phase: +g.dayPhase.toFixed(3), sunInt: +g.sun.intensity.toFixed(2) };

  // --- Screenshot (Blob-Größe) ---
  g.renderer.render(g.scene, g.camera);
  const blob = await new Promise(res => g.renderer.domElement.toBlob(res, 'image/png'));
  out.screenshot = { ok: !!blob, size: blob ? blob.size : 0, type: blob ? blob.type : '' };

  // --- Ziel-Highlight: Mesh existiert + aim() findet ein Ziel ---
  out.highlightMesh = !!g.highlight && g.highlight.isLineSegments;
  g.setCamera(24, 14, 24);
  const hit = g.aim(30);
  out.aim = hit ? { kind: hit.kind } : null;

  // --- AO: Block in der Luft (hell) vs. auf dem Boden (dunkler) ---
  const airBlock = g.spawnBlock(g.THREE ? 3 : 3, 24, 22, 24);          // Stein hoch oben
  const groundTop = g.world.heightAt(30, 30);
  const groundBlock = g.spawnBlock(3, 30, groundTop, 30);              // Stein auf dem Boden
  await sleep(300); // AO wird pro Frame neu berechnet
  out.ao = {
    air: +airBlock.ao.toFixed(3),
    ground: +groundBlock.ao.toFixed(3),
    airBrighter: airBlock.ao > groundBlock.ao,
    instanceColorGround: !!g.meshes[1].instanceColor,   // GROUND=1
    instanceColorStone: !!g.meshes[3].instanceColor,    // STONE=3
  };
  return out;
});
console.log(JSON.stringify(r, null, 1));
console.log('RUNTIME-ERRORS:', errs.length ? errs.join(' | ') : 'keine');
await browser.close();
