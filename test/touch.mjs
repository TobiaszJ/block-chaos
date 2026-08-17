import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=swiftshader'] });

// ═══════════ Teil 1: Smartphone (Touch) ═══════════
const ctx = await browser.newContext({ viewport: { width: 420, height: 800 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 120)));
page.on('console', m => { if (m.type() === 'error') errors.push('CON: ' + m.text().slice(0, 120)); });
for (let _a = 1; _a <= 5; _a++) {
  try { await page.goto('http://127.0.0.1:5173/', { waitUntil: 'commit', timeout: 30000 }); break; }
  catch (_e) { if (_a === 5) throw _e; await new Promise(_r => setTimeout(_r, 2000 * _a)); }
}
await page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 500 });
await page.waitForTimeout(2500);

const r1 = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  const out = {};
  const canvas = g.renderer.domElement;
  const W = window.innerWidth, H = window.innerHeight;

  const T = (x, y, id) => new Touch({ identifier: id, target: canvas, clientX: x, clientY: y });
  const tEv = (type, touches) => canvas.dispatchEvent(
    new TouchEvent(type, { touches, targetTouches: touches, changedTouches: touches, bubbles: true, cancelable: true }));

  out.isTouch = !!(window.__touch && window.__touch.isTouch);
  out.bodyTouch = document.body.classList.contains('touch');
  out.touchUiVisible = getComputedStyle(document.getElementById('touch-ui')).display !== 'none';

  // Start per Tap (kein Pointer-Lock auf Touch)
  document.getElementById('start-btn').click();
  await sleep(400);
  out.started = !document.getElementById('hud').classList.contains('hidden');
  out.noPointerLock = document.pointerLockElement === null;

  // Kamera über der Inselmitte, gerade nach unten – aim(9) trifft garantiert Boden
  g.setCamera(24, 12, 24);
  g.setLook(0, -1.4);
  await sleep(200);
  out.aimHit = !!g.aim(9);

  // Tippen = Platzieren (am Fadenkreuz)
  const bodies0 = g.world.bodies.size;
  tEv('touchstart', [T(W * 0.7, H * 0.5, 1)]);
  tEv('touchend', [T(W * 0.7, H * 0.5, 1)]);
  await sleep(300);
  out.place = { before: bodies0, after: g.world.bodies.size, added: g.world.bodies.size - bodies0 === 1 };

  // Modus umschalten → Brechen
  const modeBtn = document.getElementById('mode-toggle');
  modeBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  out.modeAfterToggle = window.__touch.mode;
  out.modeBtnText = modeBtn.textContent;

  // Tippen in Brechen-Modus → der platzierte Block verschwindet wieder
  tEv('touchstart', [T(W * 0.7, H * 0.5, 2)]);
  tEv('touchend', [T(W * 0.7, H * 0.5, 2)]);
  await sleep(300);
  out.break = { after: g.world.bodies.size, removed: g.world.bodies.size === bodies0 };
  // zurück auf Bauen
  modeBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));

  // Kamera-Drag (rechte Seite)
  const d0 = g.camera.getWorldDirection(new g.THREE.Vector3());
  tEv('touchstart', [T(W * 0.75, H * 0.3, 3)]);
  for (let i = 1; i <= 6; i++) tEv('touchmove', [T(W * 0.75 + i * 8, H * 0.3 - i * 4, 3)]);
  tEv('touchend', [T(W * 0.75 + 48, H * 0.3 - 24, 3)]);
  await sleep(100);
  const d1 = g.camera.getWorldDirection(new g.THREE.Vector3());
  out.cameraDrag = { angleDeg: (Math.acos(g.THREE.MathUtils.clamp(d0.dot(d1), -1, 1)) * 180 / Math.PI).toFixed(2), changed: d0.dot(d1) < 0.999 };

  // Joystick (linke Seite): halten + nach oben = vorwärts
  const p0 = g.camera.position.clone();
  tEv('touchstart', [T(W * 0.2, H * 0.7, 4)]);
  tEv('touchmove', [T(W * 0.2, H * 0.7 - 44, 4)]);
  out.joyVec = { x: +window.__touch.joyVec.x.toFixed(2), y: +window.__touch.joyVec.y.toFixed(2) };
  await sleep(900);
  const p1 = g.camera.position.clone();
  tEv('touchmove', [T(W * 0.2, H * 0.7, 4)]);
  tEv('touchend', [T(W * 0.2, H * 0.7, 4)]);
  out.joystick = { moved: p0.distanceTo(p1), dist: +p0.distanceTo(p1).toFixed(2), works: p0.distanceTo(p1) > 1.5 };

  // Chaos-Button: Gravitation
  document.getElementById('tool-x').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  out.gravFlip = g.world.gravityFlipped;

  // HUD-Button per echtem Klick (Pointer-Events-Fix)
  const saveBtn = document.getElementById('btn-save');
  const sr = saveBtn.getBoundingClientRect();
  const hit = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
  saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(200);
  out.hudSave = { hitIsButton: hit === saveBtn, stored: localStorage.getItem('blok-chaos-save-v1') !== null };

  return out;
});
console.log('TOUCH:', JSON.stringify(r1, null, 1));

// Touch-Seite runter, bevor die Desktop-Seite lädt (SwiftShader-Last halbieren)
await ctx.close();

// ═══════════ Teil 2: Desktop – Pause statt Overlay, HUD-Buttons per Maus ═══════════
const dpage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (let _a = 1; _a <= 5; _a++) {
  try { await dpage.goto('http://127.0.0.1:5173/', { waitUntil: 'commit', timeout: 30000 }); break; }
  catch (_e) { if (_a === 5) throw _e; await new Promise(_r => setTimeout(_r, 2000 * _a)); }
}
await dpage.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 500 });
const r2 = await dpage.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  document.getElementById('start-btn').click();
  await sleep(400);
  const locked = document.pointerLockElement !== null;
  if (document.pointerLockElement) document.exitPointerLock(); // Esc simulieren
  await sleep(400);
  return {
    locked,
    pauseHint: !document.getElementById('pause-hint').classList.contains('hidden'),
    hudVisible: !document.getElementById('hud').classList.contains('hidden'),
    overlayHidden: document.getElementById('start-overlay').classList.contains('hidden'),
  };
});
// echter Mausklick auf "Speichern" im Pause-Zustand
const btnBox = await dpage.locator('#btn-save').boundingBox();
await dpage.mouse.click(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
await dpage.waitForTimeout(300);
const saved = await dpage.evaluate(() => localStorage.getItem('blok-chaos-save-v1') !== null);
console.log('DESKTOP-PAUSE:', JSON.stringify({ ...r2, mouseSaveWorks: saved }));

await browser.close();
const real = errors.filter(e => !e.includes('popErrorScope') && !e.includes('createBuffer'));
console.log('TOUCH-ERRORS:', real.length ? JSON.stringify(real, null, 1) : 'keine');
