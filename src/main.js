import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { World, W, H, D, key, decode, inBounds, CG } from './world.js';
import { Water, MAX_WATER } from './water.js';
import { Particles } from './particles.js';
import {
  AIR, GROUND, WOOD, STONE, ICE, GUMMY, TNT, WATER_SRC, CANNON, BLACKHOLE,
  BALLOON, CHAIN, BLOCKS, PLACEABLE, slotName, TNT_EXPLODE_SPEED,
} from './blocks.js';
import { Sound } from './sound.js';
const noWebgpu = document.getElementById('no-webgpu');
const startOverlay = document.getElementById('start-overlay');
const hud = document.getElementById('hud');

if (!('gpu' in navigator)) {
  noWebgpu.classList.remove('hidden');
  startOverlay.classList.add('hidden');
} else {
  main().catch((err) => {
    console.error(err);
    noWebgpu.querySelector('p').textContent =
      'Beim Starten ist was schiefgelaufen: ' + (err?.message || err);
    noWebgpu.classList.remove('hidden');
    startOverlay.classList.add('hidden');
  });
}

async function main() {
  // ---------- Init ----------
  await RAPIER.init();
  const renderer = new WebGPURenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  await renderer.init();
  document.body.appendChild(renderer.domElement);
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffd9a8, 70, 180);

  let yaw = 0, pitch = 0;
  let cloudDrift = () => {}; // wird unten mit den Wolken gesetzt

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(18, 16, 18);

  // ---------- Himmel & Licht (Tag/Nacht-Fähig) ----------
  const SKY_R = 450;
  const skyGeo = new THREE.SphereGeometry(SKY_R, 48, 32);
  const skyPosAttr = skyGeo.attributes.position;
  const skyDay = new Float32Array(skyPosAttr.count * 3);
  const skyNight = new Float32Array(skyPosAttr.count * 3);
  const skyCur = new Float32Array(skyPosAttr.count * 3);
  function fillSky(arr, topHex, midHex, botHex) {
    const top = new THREE.Color(topHex), mid = new THREE.Color(midHex),
          bot = new THREE.Color(botHex), c = new THREE.Color();
    for (let i = 0; i < skyPosAttr.count; i++) {
      const h = skyPosAttr.getY(i) / SKY_R;
      if (h > 0.12) c.lerpColors(mid, top, THREE.MathUtils.smoothstep(h, 0.12, 0.7));
      else c.lerpColors(bot, mid, THREE.MathUtils.smoothstep(h, -0.08, 0.12));
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
  }
  fillSky(skyDay, 0x2f7fe0, 0x9fd4ff, 0xffd9a8);   // Candy-Tag
  fillSky(skyNight, 0x04081a, 0x0c1a3a, 0x2a3560); // Nacht
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCur, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  scene.add(sky);

  // Glow-Sprite (Sonne / Mond)
  function makeGlow(c0, c1, c2, size) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g2 = cv.getContext('2d');
    const grad = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, c0); grad.addColorStop(0.25, c1); grad.addColorStop(1, c2);
    g2.fillStyle = grad; g2.fillRect(0, 0, 128, 128);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    s.scale.setScalar(size);
    return s;
  }
  const sunSprite = makeGlow('rgba(255,244,220,1)', 'rgba(255,225,170,0.9)', 'rgba(255,210,140,0)', 150);
  scene.add(sunSprite);
  const moonSprite = makeGlow('rgba(240,246,255,1)', 'rgba(200,214,255,0.85)', 'rgba(120,150,255,0)', 70);
  moonSprite.material.blending = THREE.NormalBlending;
  scene.add(moonSprite);

  // Sterne (nachts sichtbar)
  const stars = (() => {
    const N = 700, pos = new Float32Array(N * 3), v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      v.set(Math.random() - 0.5, Math.random() * 0.55 + 0.05, Math.random() - 0.5)
        .normalize().multiplyScalar(SKY_R * 0.96);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(gg, new THREE.PointsMaterial({
      color: 0xdfe8ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0,
      depthWrite: false, fog: false,
    }));
    scene.add(p);
    return p;
  })();

  // Weiche Wolken
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92,
  });
  const clouds = new THREE.Group();
  for (let c = 0; c < 9; c++) {
    const g = new THREE.Group();
    const puffs = 3 + ((Math.random() * 3) | 0);
    for (let p = 0; p < puffs; p++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(2.5 + Math.random() * 2.5, 12, 10), cloudMat);
      s.position.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 4);
      s.scale.y = 0.55;
      g.add(s);
    }
    g.position.set((Math.random() - 0.5) * 170, 30 + Math.random() * 20, (Math.random() - 0.5) * 170);
    clouds.add(g);
  }
  scene.add(clouds);
  // Wolken treiben langsam um die Insel (t kommt in ms – also in Sekunden umrechnen,
  // sonst dreht sich die Wolken-Schicht 6× pro 10 Sekunden)
  cloudDrift = (t) => { clouds.rotation.y = (t / 1000) * 0.02; }; // Umdrehung ~5 min

  // Sockel: die Insel sitzt auf einem runden Podest (Diorama-Feeling)
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(40, 47, 9, 48),
    new THREE.MeshStandardMaterial({ color: 0x2e3a5c, roughness: 0.85 })
  );
  base.position.y = -4.4;
  base.receiveShadow = true;
  scene.add(base);

  const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x6a8a5a, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d9, 2.4);
  sun.position.set(50, 55, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36; sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36; sun.shadow.camera.bottom = -36;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  sun.target.position.set(24, 0, 24);
  scene.add(sun.target);

  // Tag/Nacht: phase 0 = Tag, 1 = Nacht. Alle Licht-/Himmel-Parameter werden glerpt.
  const DN = {
    sunPosDay: new THREE.Vector3(50, 55, 30), sunPosNight: new THREE.Vector3(-45, 42, -28),
    sunColDay: new THREE.Color(0xfff2d9), sunColNight: new THREE.Color(0x9db4ff),
    sunIntDay: 2.4, sunIntNight: 0.5,
    hemiSkyDay: new THREE.Color(0xbcd8ff), hemiSkyNight: new THREE.Color(0x16224a),
    hemiGndDay: new THREE.Color(0x6a8a5a), hemiGndNight: new THREE.Color(0x0a0f1e),
    hemiIntDay: 1.0, hemiIntNight: 0.4,
    fogDay: new THREE.Color(0xffd9a8), fogNight: new THREE.Color(0x0a1030),
    cloudDay: new THREE.Color(0xffffff), cloudNight: new THREE.Color(0x33406b),
  };
  const _dnDir = new THREE.Vector3();
  function updateDayNight(p) {
    sun.position.copy(DN.sunPosDay).lerp(DN.sunPosNight, p);
    sun.color.copy(DN.sunColDay).lerp(DN.sunColNight, p);
    sun.intensity = THREE.MathUtils.lerp(DN.sunIntDay, DN.sunIntNight, p);
    hemi.color.copy(DN.hemiSkyDay).lerp(DN.hemiSkyNight, p);
    hemi.groundColor.copy(DN.hemiGndDay).lerp(DN.hemiGndNight, p);
    hemi.intensity = THREE.MathUtils.lerp(DN.hemiIntDay, DN.hemiIntNight, p);
    scene.fog.color.copy(DN.fogDay).lerp(DN.fogNight, p);
    for (let i = 0; i < skyCur.length; i++) skyCur[i] = skyDay[i] + (skyNight[i] - skyDay[i]) * p;
    skyGeo.attributes.color.needsUpdate = true;
    _dnDir.copy(DN.sunPosDay).lerp(DN.sunPosNight, p).normalize().multiplyScalar(SKY_R * 0.94);
    sunSprite.position.copy(_dnDir);
    sunSprite.material.opacity = Math.max(0, 1 - p * 1.4);
    moonSprite.position.copy(DN.sunPosNight).normalize().multiplyScalar(SKY_R * 0.94);
    moonSprite.material.opacity = Math.max(0, p * 1.4 - 0.4);
    stars.material.opacity = Math.min(1, Math.max(0, p - 0.35) * 1.6);
    cloudMat.color.copy(DN.cloudDay).lerp(DN.cloudNight, p);
  }
  let dayPhase = 0, dayTarget = 0;
  function toggleDayNight() {
    dayTarget = dayTarget === 0 ? 1 : 0;
    const badge = document.getElementById('dn-badge');
    if (badge) { badge.textContent = dayTarget ? '🌙 Nacht' : '☀️ Tag'; badge.classList.toggle('on', dayTarget === 1); }
    toast(dayTarget ? '🌙 Es wird Nacht… (N = zurück zum Tag)' : '☀️ Moin! Wieder Tag. (N = Nacht)');
  }
  updateDayNight(0);

  // ---------- Welt ----------
  const world = new World(RAPIER);
  world.generateTerrain();
  {
    // Kamera schaut auf den Turm
    const ht = world.heightAt(36, 36);
    const t = new THREE.Vector3(36.5, ht + 2, 36.5);
    const dir = t.clone().sub(camera.position).normalize();
    yaw = Math.atan2(-dir.x, -dir.z);
    pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
  }
  const water = new Water(world);
  const particles = new Particles(scene);

  // ---------- Rendering: InstancedMesh pro Block-Typ ----------
  // Abgerundete Blöcke → Spielzeug- statt Minecraft-Optik
  const boxGeo = new RoundedBoxGeometry(1, 1, 1, 3, 0.12);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const mats = {
    [GROUND]: phys({ color: 0x59c98a, roughness: 0.55, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    [WOOD]:  phys({ color: BLOCKS[WOOD].color, roughness: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
    [STONE]: phys({ color: BLOCKS[STONE].color, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    [ICE]:   phys({ color: BLOCKS[ICE].color, roughness: 0.06, transmission: 0.7, thickness: 0.9, ior: 1.3 }),
    [GUMMY]: phys({ color: BLOCKS[GUMMY].color, roughness: 0.18, clearcoat: 1.0, clearcoatRoughness: 0.12, emissive: 0x4a0f24 }),
    [TNT]:   phys({ color: BLOCKS[TNT].color, roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.2, emissive: 0x3d0f0a }),
    [CANNON]:    phys({ color: BLOCKS[CANNON].color, metalness: 0.75, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    [BLACKHOLE]: phys({ color: BLOCKS[BLACKHOLE].color, roughness: 0.12, clearcoat: 1.0, emissive: 0x5522aa, emissiveIntensity: 0.9 }),
    [BALLOON]:   phys({ color: BLOCKS[BALLOON].color, roughness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.1, emissive: 0x3d0f1e }),
    [CHAIN]:     phys({ color: BLOCKS[CHAIN].color, metalness: 1.0, roughness: 0.4 }),
  };
  const CAP_GROUND = W * D * (H - 7) + 10;
  const CAP_BODY = 600;
  const CAP_WATER = 1800;
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x38a1ff, roughness: 0.06, transparent: true, opacity: 0.58,
    clearcoat: 1.0, clearcoatRoughness: 0.08, depthWrite: false,
  });
  const meshes = { [GROUND]: null };
  function makeMesh(mat, cap, shadows) {
    const m = new THREE.InstancedMesh(boxGeo, mat, cap);
    m.count = 0;
    m.castShadow = shadows;
    m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }
  const BODY_TYPES = [WOOD, STONE, ICE, GUMMY, TNT, CANNON, BLACKHOLE, BALLOON, CHAIN];
  meshes[GROUND] = makeMesh(mats[GROUND], CAP_GROUND, true);
  for (const t of BODY_TYPES) meshes[t] = makeMesh(mats[t], CAP_BODY, true);

  // Kanonenrohre (eigene Instanz-Mesh, Richtung = Zielrichtung)
  const barrelMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.16, 0.24, 0.9, 10),
    new THREE.MeshStandardMaterial({ color: 0x2c3348, metalness: 0.8, roughness: 0.3 }),
    64
  );
  barrelMesh.count = 0;
  barrelMesh.castShadow = true;
  scene.add(barrelMesh);

  // Schwarzes-Loch-Glow (freigeteilte Textur, eigener Sprite pro Loch)
  const bhGlowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(210,150,255,0.9)');
    grad.addColorStop(0.45, 'rgba(120,40,220,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const waterMesh = makeMesh(waterMat, CAP_WATER, false);
  waterMesh.renderOrder = 10;

  // ---------- Schwarzes-Loch-Visuals (Interstellar-Stil) ----------
  // Ereignishorizont: pure schwarze Kugel – nichts kommt raus.
  const bhShadowGeom = new THREE.SphereGeometry(1, 48, 32);
  const bhShadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
  // Photonenring: dünnes blendend-heller Ring am Horizont (Licht, das um
  // das Loch herumgekrümmt wird) – immer zur Kamera hin.
  const photonRingTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0.00, 'rgba(0,0,0,0)');
    grad.addColorStop(0.42, 'rgba(0,0,0,0)');
    grad.addColorStop(0.50, 'rgba(255,240,220,0.95)');
    grad.addColorStop(0.56, 'rgba(255,170,90,0.45)');
    grad.addColorStop(0.72, 'rgba(255,120,50,0.12)');
    grad.addColorStop(1.00, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  // Akkretionsscheibe: flache Ring-Geometrie in der XZ-Ebene (Lokaleinheiten:
  // innerer Radius 1.25, äußerer 2.9).
  const bhDiskGeom = new THREE.RingGeometry(1.25, 2.9, 96, 1);
  bhDiskGeom.rotateX(-Math.PI / 2);
  // Scheiben-TEXTUR (Canvas): rotierendes Gas-Muster + Doppler-Beaming, ge-
  // baked in die Textur (helle Seite = "heiße" Seite, dreht mit der Scheibe
  // um das Loch – sieht aus wie der klassische Interstellar-Hotspot).
  // (TSL/NodeMaterial kam nicht in Frage: three r185.1 hat einen Bug in
  // NodeMaterial.setupDiffuseColor – diffuseColor.assign() außerhalb eines
  // Fn() → "No stack defined for assign operation" 60×/s bei jedem Build.
  //  Canvas + MeshBasicMaterial ist deterministisch und robust.)
  const bhDiskTex = (() => {
    const S = 512, C = S / 2, R_IN = 1.25, R_OUT = 2.9;
    const PX = C / R_OUT; // Pixel pro Lokaleinheit
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const sstep = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
    const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const cInner = [1.0, 0.96, 0.88], cMid = [1.0, 0.52, 0.16], cOuter = [0.45, 0.12, 0.05];
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = (px - C + 0.5) / PX;      // Ring-Lokalkoordinaten (Ring +x = Canvas +x)
        const y = (C - py + 0.5) / PX;      // Canvas +y zeigt WELT -z (nach rotateX)
        const r = Math.hypot(x, y);
        const i = (py * S + px) * 4;
        if (r < R_IN || r > R_OUT) { img.data[i + 3] = 255; continue; }
        const th = Math.atan2(y, x);
        const tRad = (r - R_IN) / (R_OUT - R_IN);
        const s1 = Math.sin(th * 5 + r * 4), s2 = Math.sin(th * 9 - r * 7);
        const streak = sstep(-0.3, 0.9, (s1 + s2) / 2);
        let col = mix3(mix3(cInner, cMid, tRad), cOuter, tRad * tRad * tRad);
        const beam = Math.cos(th); // +1 = helle Seite (Canvas +x), -1 = dunkle
        col = mix3(col, [1.0, 0.99, 0.95], Math.max(beam, 0) * 0.45);
        col = mix3(col, [0.55, 0.16, 0.08], Math.max(-beam, 0) * 0.4);
        const fade = sstep(R_IN, R_IN + 0.25, r) * (1 - sstep(2.45, R_OUT, r));
        const bright = (Math.pow(1 - tRad, 2) + 0.12) * (streak * 0.55 + 0.6) * (1 + beam * 0.85) * fade;
        img.data[i]     = Math.min(255, col[0] * bright * 255);
        img.data[i + 1] = Math.min(255, col[1] * bright * 255);
        img.data[i + 2] = Math.min(255, col[2] * bright * 255);
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const bhDiskMat = new THREE.MeshBasicMaterial({
    map: bhDiskTex, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  // Größerer Linsen-Effekt: zwei SENKRECHTE Photonen-Halos (XY- und
  // ZY-Ebene, also senkrecht zur Akkretionsscheibe), die sich kreuzen –
  // der gekrümmte Lichtkranz um den Horizont, aus jeder Kamerarichtung
  // sichtbar (wie bei Gargantua). Geteilte Geometrie/Textur, pro Loch
  // nur die Meshes.
  const bhHaloGeom = new THREE.RingGeometry(1.02, 1.6, 96, 1);
  const photonHaloTex = (() => {
    const S = 256, C = S / 2, R_OUT = 1.6;
    const PX = C / R_OUT; // Pixel pro Lokaleinheit (UVs planar über R_OUT)
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const sstep = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = (px - C + 0.5) / PX;
        const y = (C - py + 0.5) / PX;
        const r = Math.hypot(x, y);
        const i = (py * S + px) * 4;
        if (r < 0.9 || r > R_OUT) { img.data[i + 3] = 0; continue; }
        const t = (r - 0.9) / (R_OUT - 0.9);
        const bright = (1 - t) * (1 - t) * 0.9; // heißer innerer Rand, auslaufend
        img.data[i]     = 255 * bright;
        img.data[i + 1] = 235 * bright;
        img.data[i + 2] = 205 * bright;
        img.data[i + 3] = 255 * bright;
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const bhHaloMat = new THREE.MeshBasicMaterial({
    map: photonHaloTex, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });

  // ---------- Dynamische Blöcke ----------
  const MAX_BODIES = 400;
  const bodyOrder = []; // FIFO für Aufräumen, wenn's voll ist
  // ---------- Adaptives Element-Budget (Crash-Schutz) ----------
  // Das System misst seine eigene FPS (0,5s-Fenster) und senkt bei
  // Atemnot (<25 fps) das Objekt-/Wasser-Budget: Die ältesten Blöcke
  // "puffen" weg, altes Wasser verdunstet (🐢 im HUD). Hat es wieder
  // Luft (≥55 fps für ~2s), wächst das Budget bis zur harten Grenze
  // zurück (MAX_BODIES/MAX_WATER = was die GPU-Buffer fassen). So
  // übersteht auch ein schwaches Gerät das Chaos, statt einzufrieren.
  const BUDGET = {
    bodyMax: MAX_BODIES, bodyMin: 30, body: MAX_BODIES,
    waterMax: MAX_WATER, waterMin: 150, water: MAX_WATER,
    goodStreak: 0, lastCut: 0, lastToast: 0,
  };
  const bootT = performance.now();
  function cutElements() {
    let cut = 0;
    // Älteste zuerst (FIFO) – genau das macht auch die harte Obergrenze,
    // das adaptive Budget zieht es nur früher und in kleinen Schritten an.
    while (world.bodies.size > BUDGET.body) {
      const rec = bodyOrder[0];
      if (!rec) break; // bodyOrder leer → kein (Endlos-)Loop, Inkonsistenz ignorieren
      if (rec.dead) { bodyOrder.shift(); continue; }
      const p = rec.body.translation();
      // kleiner "Puff", damit der Spieler sieht, warum der Block weg ist
      particles.spawn(p.x, p.y, p.z, 0, 0.6, 0, 0.6, 0.6, 0.7, 0.5);
      removeBody(rec);
      cut++;
    }
    water.budget = BUDGET.water;
    const rw = water.trimTo(BUDGET.water);
    if ((cut > 0 || rw > 0) && performance.now() - BUDGET.lastToast > 4000) {
      BUDGET.lastToast = performance.now();
      const what = [];
      if (cut > 0) what.push(cut + (cut === 1 ? ' Objekt' : ' Objekte'));
      if (rw > 0) what.push(rw + (rw === 1 ? ' Wasserkzelle' : ' Wasserkzellen'));
      toast('🐢 System hat die Luft raus – ' + what.join(' + ') + ' entfernt (Budget ' + BUDGET.body + ' Objekte).');
    }
    return cut;
  }
  function adaptBudget(fps) {
    // Shader-Warmup am Start ist kein Leistungssignal → nicht darauf reagieren
    if (performance.now() - bootT < 5000) return;
    if (fps > 0 && fps < 25) {
      BUDGET.goodStreak = 0;
      // nicht panisch: max. ein Cut pro 1,5s (der 250ms-Notbrems-Check
      // im Loop reagiert auf echte Einfrieren ohnehin sofort)
      if (performance.now() - BUDGET.lastCut < 1500) return;
      BUDGET.lastCut = performance.now();
      if (BUDGET.body > BUDGET.bodyMin || BUDGET.water > BUDGET.waterMin) {
        BUDGET.body = Math.max(BUDGET.bodyMin, Math.round(BUDGET.body * 0.7));
        BUDGET.water = Math.max(BUDGET.waterMin, Math.round(BUDGET.water * 0.7));
        cutElements();
      }
    } else if (fps >= 55) {
      BUDGET.goodStreak++;
      if (BUDGET.goodStreak >= 4) { // ~2s stabile Luft → langsam hochbauen
        BUDGET.goodStreak = 0;
        if (BUDGET.body < BUDGET.bodyMax) BUDGET.body = Math.min(BUDGET.bodyMax, Math.round(BUDGET.body * 1.25));
        if (BUDGET.water < BUDGET.waterMax) BUDGET.water = Math.min(BUDGET.waterMax, Math.round(BUDGET.water * 1.25));
      }
    } else {
      BUDGET.goodStreak = 0; // Zwischenzone (25–55): nichts tun (Hysterese)
    }
  }
  function spawnBlock(typeId, i, j, k, vel = null, opts = {}) {
    const def = BLOCKS[typeId];
    const body = world.physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(i + 0.5, j + 0.5, k + 0.5)
        .setLinearDamping(typeId === BALLOON ? 0.9 : 0.05)
        .setAngularDamping(0.3)
        .setCanSleep(true)
    );
    const col = world.physicsWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
        .setDensity(def.mass)
        .setFriction(def.friction)
        .setRestitution(def.restitution)
        .setCollisionGroups(typeId === BLACKHOLE ? CG.bh : CG.block),
      body
    );
    col.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const rec = { body, type: typeId, dead: false, absorbed: 0, seed: Math.random() * 10 };
    if (opts.aimDir) rec.aimDir = opts.aimDir;
    if (typeId === BLACKHOLE) {
      // Interstellar-Visuals: schwarzer Ereignishorizont, Photonenring,
      // rotierende Akkretionsscheibe + lila Atmosphären-Glow.
      // Spin = Drehimpuls: hängt davon ab, wie viel es gefressen hat.
      rec.size = 1;
      rec.spin = 0.35;
      rec.phase = Math.random() * 100;
      rec._prevT = performance.now() / 1000;
      rec.shadow = new THREE.Mesh(bhShadowGeom, bhShadowMat);
      scene.add(rec.shadow);
      rec.ring = new THREE.Sprite(new THREE.SpriteMaterial({
        map: photonRingTex, transparent: true, depthWrite: false, fog: false,
        blending: THREE.AdditiveBlending,
      }));
      scene.add(rec.ring);
      rec.dish = new THREE.Mesh(bhDiskGeom, bhDiskMat);
      scene.add(rec.dish);
      rec.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: bhGlowTex, transparent: true, depthWrite: false, fog: false,
        blending: THREE.AdditiveBlending,
      }));
      scene.add(rec.sprite);
      // Senkrechte Photonen-Halos (Linsen-Effekt): zwei kreuzende Ringe
      rec.halo1 = new THREE.Mesh(bhHaloGeom, bhHaloMat);
      rec.halo2 = new THREE.Mesh(bhHaloGeom, bhHaloMat);
      rec.halo2.rotation.y = Math.PI / 2; // senkrecht zu halo1
      scene.add(rec.halo1, rec.halo2);
    }
    if (opts.absorbed) rec.absorbed = opts.absorbed; // Restore aus Save
    world.bodies.add(rec);
    world.bodyByHandle.set(body.handle, rec);
    bodyOrder.push(rec);
    if (vel) body.setLinvel(vel, true);
    return rec;
  }
  // Während eines Physik-Steps ist das Löschen von Bodies NICHT sicher
  // (Rapier-WASM-Error: „unsafe aliasing“). Deshalb: Schlange, Flush danach.
  let inStep = false;
  const pendingRemove = new Set();
  const activeJoints = []; // { joint, a, b } – Kette-Gelenke
  const pendingJointRemove = new Set();
  function removeJointsOf(rec) {
    for (let n = activeJoints.length - 1; n >= 0; n--) {
      const ej = activeJoints[n];
      if (ej.a !== rec && ej.b !== rec) continue;
      activeJoints.splice(n, 1);
      if (inStep) pendingJointRemove.add(ej);
      else world.physicsWorld.removeImpulseJoint(ej.joint, true);
    }
  }
  function removeBody(rec) {
    if (!rec || rec.dead) return;
    rec.dead = true;
    world.bodies.delete(rec);
    world.bodyByHandle.delete(rec.body.handle);
    const idx = bodyOrder.indexOf(rec);
    if (idx >= 0) bodyOrder.splice(idx, 1);
    if (rec.sprite) { scene.remove(rec.sprite); rec.sprite.material.dispose(); rec.sprite = null; }
    if (rec.shadow) { scene.remove(rec.shadow); rec.shadow = null; }
    if (rec.ring) { scene.remove(rec.ring); rec.ring.material.dispose(); rec.ring = null; }
    if (rec.dish) { scene.remove(rec.dish); rec.dish.material.dispose(); rec.dish = null; }
    if (rec.halo1) { scene.remove(rec.halo1); rec.halo1 = null; } // geteiltes Material
    if (rec.halo2) { scene.remove(rec.halo2); rec.halo2 = null; }
    removeJointsOf(rec);
    if (inStep) pendingRemove.add(rec);
    else world.physicsWorld.removeRigidBody(rec.body);
  }
  function flushPendingRemove() {
    for (const ej of pendingJointRemove) world.physicsWorld.removeImpulseJoint(ej.joint, true);
    pendingJointRemove.clear();
    for (const rec of pendingRemove) world.physicsWorld.removeRigidBody(rec.body);
    pendingRemove.clear();
  }

  // ---------- Explosions ----------
  let shake = 0;
  const flash = document.createElement('div');
  flash.id = 'flash';
  document.body.appendChild(flash);
  let flashA = 0;

  function explodeAt(cx, cy, cz, R = 3.5, RT = 4.5) {
    // R: Blöcke + Impuls, RT: Terrain (Standard: tiefes Loch)
    pushUndo();
    const chains = [];
    const dirtyCols = new Set();

    // Blöcke im Radius
    for (const rec of Array.from(world.bodies)) {
      if (rec.dead) continue;
      const p = rec.body.translation();
      const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
      if (d < R) {
        if (rec.type === TNT && rec.dead === false) chains.push({ x: p.x, y: p.y, z: p.z });
        removeBody(rec);
      }
    }

    // Boden + Quellen im (größer!) Radius
    const i0 = Math.max(0, Math.floor(cx - RT)), i1 = Math.min(W - 1, Math.floor(cx + RT));
    const j0 = Math.max(0, Math.floor(cy - RT)), j1 = Math.min(H - 1, Math.floor(cy + RT));
    const k0 = Math.max(0, Math.floor(cz - RT)), k1 = Math.min(D - 1, Math.floor(cz + RT));
    for (let i = i0; i <= i1; i++)
      for (let k = k0; k <= k1; k++)
        for (let j = j0; j <= j1; j++) {
          const dx = i + 0.5 - cx, dy = j + 0.5 - cy, dz = k + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz >= RT * RT) continue;
          const kk = key(i, j, k);
          const t = world.grid[kk];
          if (t === GROUND) { world.clearGround(i, j, k); dirtyCols.add(i + k * W); }
          else if (t === WATER_SRC) { world.grid[kk] = AIR; world.waterSources.delete(kk); }
        }
    // Spalten neu aufbauen UND schwebende Überhänge entfernen – sonst bleiben
    // von der Explosion „abgebissene" Boden-Blöcke in der Luft hängen.
    for (const ci of dirtyCols) world.collapseColumn(ci % W, (ci / W) | 0);
    water.clearSphere(cx, cy, cz, RT);

    // Impulse an Überlebende (abklingend mit der Distanz)
    for (const rec of world.bodies) {
      if (rec.dead) continue;
      const p = rec.body.translation();
      const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
      const d = Math.hypot(dx, dy, dz);
      if (d >= R || d < 0.001) continue;
      const s = rec.body.mass() * (1 - d / R) * 13;
      let nx = dx / d, ny = dy / d + 0.4, nz = dz / d;
      const nl = Math.hypot(nx, ny, nz);
      rec.body.applyImpulse({ x: nx / nl * s, y: ny / nl * s, z: nz / nl * s }, true);
      rec.body.applyTorqueImpulse(
        { x: (Math.random() - 0.5) * s, y: (Math.random() - 0.5) * s, z: (Math.random() - 0.5) * s }, true
      );
    }

    particles.spawnExplosion(cx, cy, cz);
    shake = Math.min(0.7, shake + 0.45);
    flashA = Math.min(0.8, flashA + 0.55);
    Sound.boom();
    toast('💥 BOOM!', 'boom');

    for (const c of chains) explodeAt(c.x, c.y, c.z); // Kettenreaktion
  }

  // ---------- Physik-Loop ----------
  const eq = new RAPIER.EventQueue(true);
  window.__physErrors = [];
  window.addEventListener('unhandledrejection', (e) => {
    window.__physErrors.push('REJECTION: ' + JSON.stringify(Object.getOwnPropertyNames(e.reason || {})) + ' :: ' + String(e.reason));
  });
  function stepPhysics() {
    inStep = true;
    // Rapier 0.20: addForce AKKUMULIERT Kräfte über mehrere Steps –
    // ohne Reset würden Blöcke nach Sekunden raketenartig davonfliegen.
    // Nebenbei: Positionscache (rec._tp) pro Step – so rufen die
    // Schwarzen-Loch-Loops unten translation() nur noch EINMAL pro
    // Körper ab, statt O(Anzahl Löcher × Anzahl Blöcke) mal.
    for (const rec of world.bodies) {
      rec.body.resetForces(false);
      rec._tp = rec.body.translation();
    }

    // Reihenfolge ist kritisch (Rapier 0.20): Kräfte zurücksetzen → neue
    // Kräfte anwenden → step(). Läuft step() vorher, würde resetForces die
    // Kräfte des Vortags löschen, bevor sie integriert werden –
    // Bug: Ballons stiegen nicht, Wasserauftrieb wirkte nicht.

    // Stretch-Reset: Spaghettifizierung gilt nur, solange ein Loch wirkt
    for (const rb of world.bodies) rb.stretch = 1;

    // Schwarze Löcher: saugen LANGSAM an und WACHSEN mit jeder Beute –
    // endlos. Je größer das Loch, desto weiter greift es, desto schneller
    // saugt es und desto größer wird sein „Mund". Sie explodieren NIE.
    const bodiesSnap = Array.from(world.bodies); // 1× pro Step, nicht pro Loch
    for (const rec of world.bodies) {
      if (rec.type !== BLACKHOLE || rec.dead) continue;
      const bp = rec._tp || rec.body.translation();
      const size  = Math.min(3.2, 1 + rec.absorbed * 0.15); // Größe (visuell + physikalisch)
      const range = 6 + size * 3;                            // Griffweite wächst (9 -> 16 m)
      const mouth = 0.5 + size * 0.45;                       // Schlund ~ Mitte des (gewachsenen) Lochs
      const speed = 0.9 + (size - 1) * 1.2;                  // Saug-Tempo wächst moderat (0.9 -> 3.5 m/s) – bleibt langsam
      const diskPrey = [];                                   // alle Beuten im Scheibenband (für den Tunnel)
      for (const other of bodiesSnap) {
        if (other === rec || other.dead || other.type === BLACKHOLE) continue;
        const p = other._tp || other.body.translation();
        const dx = bp.x - p.x, dy = bp.y - p.y, dz = bp.z - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > range * range) continue;
        const d = Math.sqrt(d2) || 0.001;
        if (d < mouth) {
          rec.absorbed++;
          removeBody(other);
          particles.spawnSmall(p.x, p.y, p.z, 0xb26bff, 14);
          Sound.suck();
          continue;
        }
        // Akkretionsscheiben-Band (auch wichtig für das Sog-Zielpunkt):
        // Die Scheibe ist eine HORIZONTALE Ebene – Mitgliedschaft läuft
        // über den horizontalen Abstand, nicht den 3D-Abstand.
        const diskOuter = range * 0.85;
        const dRad = Math.hypot(dx, dz) || 0.001;
        const inDisk = dRad > mouth + 0.5 && dRad < diskOuter;

        // Langsames Ansaugen: sanftes Geschwindigkeitsfeld zum Loch hin.
        // Die Scheibenebene liegt auf der Höhe des Lochs – aber NUR dort,
        // wo das Terrain es zulässt (in der Grube). Oberhalb von festem
        // Boden wird die Ebene auf die ECHTE aktuelle Terrainoberfläche
        // (surfaceBelow, liest das Grid – Gruben eingeschlossen) angehoben:
        // Materie kann nicht durch Felsen orbitieren, sie rutscht den
        // Hang hinunter und fällt in die Grube. Ohne diesen Clamp drückt
        // die Scheibe Blöcke auf hohem Boden 5 m in die Erde und die
        // Reibung nagelt sie dort fest (Bug: Stein „frost" 8 m vom Loch).
        const ci = Math.floor(p.x), ck = Math.floor(p.z);
        const surfReal = world.surfaceBelow(ci, ck, Math.floor(p.y));
        const planeY = Math.max(bp.y, surfReal + 0.6);
        const ty = inDisk ? planeY : Math.max(bp.y, surfReal + 0.8);
        const tx = bp.x - p.x, tyy = ty - p.y, tz = bp.z - p.z;
        const td = Math.hypot(tx, tyy, tz) || 0.001;
        const nx = tx / td, ny = tyy / td, nz = tz / td;
        const v = other.body.linvel();
        const near = 1 - d / range;                          // näher = etwas schneller
        const target = speed * (0.55 + 0.45 * near);
        const blend = 0.15;                                  // sanft -> langsamer Sog
        // HARTE Geschwindigkeitsdeckelung: ohne sie würde die Sog-Kraft
        // unten die Equilibriums-Geschwindigkeit auf target+3 m/s treiben
        // (zu schnell, Slingshot-Gefahr). Mit dem Cap kriechen Blöcke im
        // gemächlichen `target`-Tempo zum Loch – langsam, wie es sein soll.
        let vx2 = v.x + (nx * target - v.x) * blend;
        let vz2 = v.z + (nz * target - v.z) * blend;
        const capH = target + 0.4;
        const vh = Math.hypot(vx2, vz2);
        if (vh > capH) { vx2 *= capH / vh; vz2 *= capH / vh; }
        other.body.setLinvel({
          x: vx2,
          y: v.y + (ny * target - v.y) * blend,
          z: vz2,
        }, true);
        // Reibungs-Brecher: setLinvel allein besiegt die statische Reibung
        // NICHT (Rapier löscht die tangentiale Geschwindigkeit im
        // Vektor-Solver VOR der Positionsintegration – ein Block auf
        // flachem Grund rührt sich dann nie). Deshalb drückt zusätzlich
        // eine KRAFT horizontal Richtung Loch – klar über der Reibungs-
        // Schwelle (μ·g ≈ 17 m/s²), damit auch BODENBlöcke losrutschen
        // ("der Boden wird ins Loch gezogen"). Das Tempo bestimmt trotzdem
        // der Deckel oben (langsamer Kriechgang, kein Slingshot).
        const hdx = bp.x - p.x, hdz = bp.z - p.z;
        const hd = Math.hypot(hdx, hdz) || 0.001;
        const nearH = 1 - hd / range;
        const pullA = 20 + 8 * nearH;
        const m2 = other.body.mass();
        other.body.addForce({ x: (hdx / hd) * pullA * m2, y: 0, z: (hdz / hd) * pullA * m2 }, true);
        // leichter Wirbel, wird mit dem Loch stärker
        other.body.addForce({ x: -nz * 1.5 * size, y: 0, z: nx * 1.5 * size }, true);

        // Akkretionsscheibe: Körper im Band werden in die Scheibenebene
        // (horizontale Ebene durch das Loch) gezogen, mit der Scheibe
        // mitgedreht, ihre Rotation wird an die Scheibendrehung ausgerichtet
        // (der Spin = der Drehimpuls aus dem, was es frisst), und sie werden
        // radial LANGEZOHEN – Spaghettifizierung.
        if (inDisk) {
          const infl = 1 - dRad / diskOuter;
          const m = other.body.mass();
          // "slow": Block steht (fast) still – steht er auf dem Boden, ist er
          // gegen einen Grubenrand festgekeilt. Die bekommt Vorrang beim
          // Fressen (Boden unter ihr weg, siehe Tunnel-Sektion unten).
          diskPrey.push({ p, d2: dRad * dRad, slow: Math.hypot(v.x, v.y, v.z) < 0.35 });
          // 1) In die (terrain-korrigierte) Scheibenebene ziehen
          const fy = -8.5 * (p.y - planeY) * infl;
          // 2) Tangential: mit der Scheibe mitdrehen
          const tgx = -dz / dRad, tgz = dx / dRad;
          const ft = 3.4 * infl;
          other.body.addForce({ x: tgx * ft * m, y: fy * m, z: tgz * ft * m }, true);
          // 3) Rotation ausrichten: Y-Achse = Scheibendrehung (rec.spin)
          const av = other.body.angvel();
          other.body.setAngvel({
            x: av.x * 0.8,
            y: av.y + (rec.spin - av.y) * 0.2 * infl,
            z: av.z * 0.8,
          }, true);
          // 4) Visuell: radiales Strecken (Spaghettifizierung)
          other.stretch = 1 + 2.4 * infl * infl;
          other.stretchAxis = { x: dx / dRad, z: dz / dRad };
        }
      }

      // Boden-Sog: Das Loch frisst auch das Terrain in Mund-Reichweite –
      // das ist, wie es sein soll, ein Loch. Ratenlimitiert, damit die
      // Insel nicht in 2 Sekunden weg ist. Jede gefressene Zelle zählt
      // ein Stück zum Wachstum. collapseColumn räumt Schwebendes weg
      // (keine schwebenden Felsen), und das Loch fällt in seine eigene
      // Grube – wie es sich gehört.
      rec.terrainEatAcc = (rec.terrainEatAcc || 0) + STEP;
      const eatEvery = 0.15 / (0.6 + 0.4 * Math.min(size, 3)); // ~7–11 Zellen/s
      while (rec.terrainEatAcc >= eatEvery) {
        rec.terrainEatAcc -= eatEvery;
        const cx = Math.floor(bp.x), cy = Math.floor(bp.y), cz = Math.floor(bp.z);
        const r = Math.ceil(mouth + 1);
        const eatR2 = (mouth + 0.5) * (mouth + 0.5);
        let best = null, bestD2 = eatR2;
        for (let di = -r; di <= r; di++)
          for (let dj = -r; dj <= r; dj++)
            for (let dk = -r; dk <= r; dk++) {
              const i = cx + di, j = cy + dj, k = cz + dk;
              // Die unterste Reihe bleibt als Boden der Grube – sonst fällt
              // das Loch durch die Insel ins Nirwana und ist weg.
              if (j === 0) continue;
              if (!inBounds(i, j, k) || world.grid[key(i, j, k)] !== GROUND) continue;
              const dx = i + 0.5 - bp.x, dy = j + 0.5 - bp.y, dz = k + 0.5 - bp.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < bestD2) { bestD2 = d2; best = { i, j, k }; }
            }
        if (best) {
          world.clearGround(best.i, best.j, best.k);
          world.collapseColumn(best.i, best.k);
          rec.absorbed += 0.05;
          particles.spawnSmall(best.i + 0.5, best.j + 0.5, best.k + 0.5, 0xb26bff, 3);
          if (Math.random() < 0.15) Sound.suck();
        }
        // Boden-Sog an Beuten (Round-Robin): Das Loch frisst Terrain weg,
        // damit befestigte Blöcke frei werden – "der Boden wird ins Loch
        // gezogen". Zwei Strategien:
        //  A) FESTGEKEILTE Beute (steht still, z.B. an einem Grubenrand):
        //     Vorrang! Der Boden UNTER ihr wird gefressen (1 Zelle/Runde) –
        //     sie sackt ab, der Hang steilt sich, und der Sog zieht sie
        //     hinunter. Funktioniert in jeder Terrainlage, kein Tunnelbau.
        //  B) Alle anderen Beuten: Tunnel – bis zu 2 Zellen auf der Linie
        //     Loch→Beute, rotierend durch die nächsten 6. Erodert jeden
        //     Damm, der einer Beute den Weg versperrt.
        if (diskPrey.length) {
          diskPrey.sort((a, b2) => a.d2 - b2.d2);
          const blocked = diskPrey.filter(pr => pr.slow);
          let prey = null, under = false;
          rec.tunnelIdx = (rec.tunnelIdx || 0) + 1;
          if (blocked.length) {
            prey = blocked[rec.tunnelIdx % blocked.length].p;
            under = true;
          } else {
            prey = diskPrey[rec.tunnelIdx % Math.min(diskPrey.length, 6)].p;
          }
          const cands = [];
          if (under) {
            // 3×3-Fläche rund um die Beute, 2 Zellen unter ihrer Mitte
            const pi = Math.floor(prey.x), pj = Math.floor(prey.y), pk = Math.floor(prey.z);
            for (let di = -1; di <= 1; di++)
              for (let dj = -2; dj <= 0; dj++)
                for (let dk = -1; dk <= 1; dk++) {
                  const i = pi + di, j = pj + dj, k = pk + dk;
                  if (!inBounds(i, j, k) || j === 0) continue;
                  if (world.grid[key(i, j, k)] !== GROUND) continue;
                  cands.push({ i, j, k, es: Math.abs(j - (pj - 1)) });
                }
          } else {
            for (let t = 0.08; t < 0.98; t += 0.06) {
              const sx = bp.x + (prey.x - bp.x) * t;
              const sy = bp.y + (prey.y - bp.y) * t;
              const sz = bp.z + (prey.z - bp.z) * t;
              const si = Math.floor(sx), sj = Math.floor(sy), sk = Math.floor(sz);
              if (!inBounds(si, sj, sk) || sj === 0) continue;
              if (world.grid[key(si, sj, sk)] !== GROUND) continue;
              const ex = si + 0.5 - sx, ey = sj + 0.5 - sy, ez = sk + 0.5 - sz;
              const es = ex * ex + ey * ey + ez * ez;
              if (es < 1.5 * 1.5) cands.push({ i: si, j: sj, k: sk, es });
            }
          }
          if (cands.length) {
            cands.sort((a, b2) => a.es - b2.es);
            const cut = cands.slice(0, under ? 1 : 2);
            for (const c of cut) {
              world.clearGround(c.i, c.j, c.k);
              rec.absorbed += 0.02;
            }
            for (const c of cut) world.collapseColumn(c.i, c.k);
            particles.spawnSmall(cut[0].i + 0.5, cut[0].j + 0.5, cut[0].k + 0.5, 0xb26bff, 2);
          }
        }
      }

      // Schwarze Löcher finden einander: Sie ziehen sich gegenseitig an
      // (langsamer Kriechgang, wie die Beute) und VERSCHMELZEN, wenn sich
      // ihre Horizonte überlappen – das größere frisst das kleinere und
      // wächst (Schockwelle, Flash, Screen-Shake). Jedes Paar wird genau
      // ein Mal pro Step verarbeitet (Handle-Vergleich).
      // (Handle-Vergleich, jedes Paar genau ein Mal pro Step)
      for (const b of bodiesSnap) {
        if (b === rec || b.dead || b.type !== BLACKHOLE) continue;
        if (b.body.handle <= rec.body.handle) continue;
        const pb = b._tp || b.body.translation();
        const dx = pb.x - bp.x, dy = pb.y - bp.y, dz = pb.z - bp.z;
        const dRad = Math.hypot(dx, dz);
        const sizeB = Math.min(3.2, 1 + b.absorbed * 0.15);
        const mouthB = 0.5 + sizeB * 0.45;
        // Verschmelzen: Horizonten überlappen (horizontale Distanz – die
        // Grubentiefe kann je nach Terrain um bis zu ~3 Zellen abweichen,
        // deshalb nur eine vertikale Toleranz statt harter 3D-Abstands).
        if (dRad < mouth + mouthB && Math.abs(dy) < 3) {
          const [sur, vic] = rec.absorbed >= b.absorbed ? [rec, b] : [b, rec];
          const sp = sur.body.translation();
          sur.absorbed += vic.absorbed + 2; // Wachstum + extra Wumms
          sur.size = Math.min(3.2, 1 + sur.absorbed * 0.15);
          sur.spin = 0.35 + sur.absorbed * 0.12;
          particles.spawnBurst(sp.x, sp.y, sp.z, 90,
            [{ r: 1.0, g: 0.85, b: 1.0 }, { r: 0.69, g: 0.35, b: 1.0 }, { r: 1.0, g: 0.6, b: 0.9 }], 7, 1.2);
          shake = Math.min(0.9, shake + 0.55);
          flashA = Math.min(0.9, flashA + 0.7);
          Sound.merge();
          toast('🌌 Verschmelzung! Zwei Schwarze Löcher wurden zu einem größeren.');
          removeBody(vic);
          if (rec.dead) break; // wir sind die Beute – Rest des Loops überspringen
          continue;
        }
        // Gegenseitiger Sog: beide kriechen aufeinander zu. Wie bei der
        // Beute: setLinvel allein verliert gegen die statische Reibung
        // (Löcher im eigenen Kraterboden), deshalb zusätzlich eine Kraft
        // Richtung Partner klar über der Reibungsschwelle (μ·g·m ≈ 39 N).
        const rMax = Math.max(range, 6 + sizeB * 3);
        if (dRad > rMax) continue;
        const near = 1 - dRad / rMax;
        const target = 0.4 + 0.5 * near + (size - 1) * 0.35; // Kriechgang
        const d3 = Math.hypot(dx, dy, dz) || 0.001;
        const nx = dx / d3, ny = dy / d3, nz = dz / d3; // rec -> b
        const blend = 0.12;
        const pullA = 45 + 20 * near;
        rec.body.addForce({ x: nx * pullA * rec.body.mass(), y: 0, z: nz * pullA * rec.body.mass() }, true);
        b.body.addForce({ x: -nx * pullA * b.body.mass(), y: 0, z: -nz * pullA * b.body.mass() }, true);
        const nudge = (self, s) => {
          const v = self.body.linvel();
          let vx2 = v.x + (nx * s * target - v.x) * blend;
          let vy2 = v.y + (ny * s * target - v.y) * blend;
          let vz2 = v.z + (nz * s * target - v.z) * blend;
          const vh = Math.hypot(vx2, vy2, vz2);
          const cap = target + 0.4;
          if (vh > cap) { const f = cap / vh; vx2 *= f; vy2 *= f; vz2 *= f; }
          self.body.setLinvel({ x: vx2, y: vy2, z: vz2 }, true);
        };
        nudge(rec, 1);
        nudge(b, -1);
      }
    }

    // Ballons: Auftrieb + sanftes Schwenken – oben platzen sie
    const bnow = performance.now() / 1000;
    for (const rec of world.bodies) {
      if (rec.type !== BALLOON || rec.dead) continue;
      const m = rec.body.mass();
      const sway = Math.sin(bnow * 1.8 + rec.seed) * 0.5;
      rec.body.addForce({ x: sway, y: -world.gdir * 1.6 * 9.81 * m, z: 0 }, true);
      const p = rec._tp || rec.body.translation();
      if ((world.gdir === -1 && p.y > 48) || (world.gdir === 1 && p.y < -42)) {
        particles.spawnSmall(p.x, p.y, p.z, 0xff8fb3, 22);
        Sound.pop(0.12);
        removeBody(rec);
      }
    }

    // Regen: tropft von oben, solange das Wasser-Budget hält
    if (performance.now() < raining && water.totalAmount() < 1200) {
      const xi = 4 + Math.floor(Math.random() * (W - 8));
      const zk = 4 + Math.floor(Math.random() * (D - 8));
      water.trySet(xi, H - 3, zk, 2);
      if (Math.random() < 0.35) particles.spawnSmall(xi + 0.5, H - 3, zk + 0.5, 0x7ec8ff, 1);
    }

    water.applyBuoyancy();

    // Jetzt integrieren: step() nimmt die oben gesetzten Kräfte mit.
    try {
      world.physicsWorld.step(eq);
    } catch (err) {
      window.__physErrors.push('STEP: ' + String(err));
      inStep = false;
      return;
    }
    eq.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const b1 = world.physicsWorld.getCollider(h1).parent();
      const b2 = world.physicsWorld.getCollider(h2).parent();
      if (!b1 || !b2) return;
      const r1 = world.bodyByHandle.get(b1.handle);
      const r2 = world.bodyByHandle.get(b2.handle);
      // TNT explodiert bei heftigem Aufprall – auch gegen den Boden
      const hitSpeed = (rec, other) => {
        if (!rec) return 0;
        const v1 = rec.body.linvel();
        const v2 = other ? other.body.linvel() : { x: 0, y: 0, z: 0 };
        return Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
      };
      if (r1 && r1.type === TNT && !r1.dead && hitSpeed(r1, r2) > TNT_EXPLODE_SPEED) {
        const p = r1.body.translation();
        explodeAt(p.x, p.y, p.z);
      }
      if (r2 && r2.type === TNT && !r2.dead && hitSpeed(r2, r1) > TNT_EXPLODE_SPEED) {
        const p = r2.body.translation();
        explodeAt(p.x, p.y, p.z);
      }
      // Aufprall-Geräusch (nur bei ordentlichem Bums)
      const spd = Math.max(hitSpeed(r1, r2), hitSpeed(r2, r1));
      if (spd > 2.5) Sound.thud(spd);
    });
    inStep = false;
    flushPendingRemove();
  }

  // ---------- Zieldurchsuchung (Raycast: Grid + Physik) ----------
  const tmpDir = new THREE.Vector3();
  function aim(maxDist = 9) {
    const o = camera.position;
    camera.getWorldDirection(tmpDir);
    const d = tmpDir;

    const ghit = world.raycastGrid(o.x, o.y, o.z, d.x, d.y, d.z, maxDist);

    let bhit = null;
    const ray = new RAPIER.Ray(
      { x: o.x, y: o.y, z: o.z },
      { x: d.x, y: d.y, z: d.z }
    );
    world.physicsWorld.intersectionsWithRay(ray, maxDist, true, (res) => {
      const body = res.collider.parent();
      const rec = body ? world.bodyByHandle.get(body.handle) : null;
      if (rec && !rec.dead && (!bhit || res.timeOfImpact < bhit.dist)) {
        const t = res.timeOfImpact;
        bhit = {
          rec, dist: t,
          nx: res.normal.x, ny: res.normal.y, nz: res.normal.z,
          px: o.x + d.x * t, py: o.y + d.y * t, pz: o.z + d.z * t,
        };
      }
      return true;
    });

    const g = ghit ? { kind: 'grid', ...ghit } : null;
    const b = bhit ? { kind: 'body', ...bhit } : null;
    if (g && (!b || g.dist <= b.dist)) return g;
    return b;
  }

  // ---------- Aktionen ----------
  let selected = PLACEABLE[0];

  function doBreak(shift = false) {
    const hit = aim(9);
    if (!hit) return;
    if (hit.kind === 'grid') {
      const kk = key(hit.i, hit.j, hit.k);
      const t = world.grid[kk];
      if (t === GROUND) {
        pushUndo();
        world.breakGround(hit.i, hit.j, hit.k);
        particles.spawnSmall(hit.i + 0.5, hit.j + 0.5, hit.k + 0.5, 0x59c98a);
        Sound.pop();
      } else if (t === WATER_SRC) {
        pushUndo();
        world.grid[kk] = AIR;
        world.waterSources.delete(kk);
        world.markGrid(kk);
        water.dirty = true;
        particles.spawnSmall(hit.i + 0.5, hit.j + 0.5, hit.k + 0.5, 0x38a1ff);
        Sound.pop();
        toast('Quelle entfernt. Das Wasser bleibt leider. 💧');
      }
    } else {
      const rec = hit.rec;
      const p = rec.body.translation();
      if (rec.type === CANNON && !shift) { fireCannon(rec); return; } // Klick = feuern!
      if (rec.type === TNT) {
        explodeAt(p.x, p.y, p.z);
      } else {
        pushUndo();
        removeBody(rec);
        particles.spawnSmall(p.x, p.y, p.z, BLOCKS[rec.type].color, 22);
        Sound.pop();
      }
    }
  }

  // ---------- Kette (Gelenk) ----------
  // Weltkoordinat → lokales Körpersystem (mit dem konjugierten Quaternion)
  function rotateLocal(body, wx, wy, wz) {
    const p = body.translation();
    const q = body.rotation();
    const x = wx - p.x, y = wy - p.y, z = wz - p.z;
    const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
    const cx = qy * z - qz * y, cy = qz * x - qx * z, cz = qx * y - qy * x;
    return {
      x: x + 2 * (cx * qw + qy * cz - qz * cy),
      y: y + 2 * (cy * qw + qz * cx - qx * cz),
      z: z + 2 * (cz * qw + qx * cy - qy * cx),
    };
  }
  function attachChainJoint(childRec, parentRec, wp) {
    try {
      const b1 = childRec.body, b2 = parentRec.body;
      const l1 = rotateLocal(b1, wp.x, wp.y, wp.z);
      const l2 = rotateLocal(b2, wp.x, wp.y, wp.z);
      // Achse: horizontal, senkrecht zur Verbindung → schwingt wie ein Pendel
      const a = b1.translation(), b = b2.translation();
      let ax = a.z - b.z, az = -(a.x - b.x);
      const al = Math.hypot(ax, az);
      if (al < 0.05) { ax = 1; az = 0; } else { ax /= al; az /= al; }
      // Achtung: anchor1 gehört zum ERSTEN Körper-Argument (b2 = Parent)!
      const params = RAPIER.JointData.revolute(l2, l1, { x: ax, y: 0, z: az });
      const joint = world.physicsWorld.createImpulseJoint(params, b2, b1, true);
      joint.setLimits(-0.9, 0.9); // aktiviert Limits in Rapier 0.20
      activeJoints.push({ joint, a: childRec, b: parentRec });
      childRec.joint = joint;
      return true;
    } catch (e) {
      console.warn('Gelenk fehlgeschlagen:', e);
      return false;
    }
  }

  function doPlace() {
    const hit = aim(9);
    if (!hit) return;
    let i, j, k;
    if (hit.kind === 'grid') {
      i = hit.i + hit.nx; j = hit.j + hit.ny; k = hit.k + hit.nz;
    } else {
      const e = 1e-4;
      i = Math.floor(hit.px - hit.nx * 0.5 + hit.nx * e);
      j = Math.floor(hit.py - hit.ny * 0.5 + hit.ny * e);
      k = Math.floor(hit.pz - hit.nz * 0.5 + hit.nz * e);
    }
    if (!inBounds(i, j, k)) return;
    const kk = key(i, j, k);
    if (world.grid[kk] !== AIR) return;
    pushUndo();

    if (selected === WATER_SRC) {
      world.grid[kk] = WATER_SRC;
      world.waterSources.add(kk);
      world.markGrid(kk);
      water.dirty = true;
      Sound.water();
      toast('Wasserquelle aktiv – jetzt wird’s nass 💧');
      return;
    }
    if (world.bodies.size >= BUDGET.body) {
      // Altem Block den Garaus, damit's nie „voll" wird (adaptives Budget)
      removeBody(bodyOrder[0]);
    }
    if (selected === CHAIN) {
      const rec = spawnBlock(CHAIN, i, j, k, null);
      let parent = null;
      if (hit.kind === 'body') parent = hit.rec;
      else if (world.grid[key(hit.i, hit.j, hit.k)] === GROUND) {
        const runs = world.colRuns[hit.i + hit.k * W] || [];
        const run = runs.find((r) => hit.j >= r.j0 && hit.j <= r.j1);
        if (run) parent = { body: run.body, dead: false };
      }
      if (parent && !parent.dead) {
        const a = rec.body.translation(), b = parent.body.translation();
        const ok = attachChainJoint(
          rec, parent,
          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
        );
        toast(ok ? '⛓️ Kette verkettet – jetzt schwingen!' : '⛓️ Gelenk klemmt – die Kette liegt lose da.');
      } else {
        toast('⛓️ An einen Block oder den Boden stellen, dann kettet sie sich fest!');
      }
      Sound.place();
      return;
    }
    if (selected === CANNON) {
      camera.getWorldDirection(tmpDir);
      const d = tmpDir;
      spawnBlock(CANNON, i, j, k, null, { aimDir: { x: d.x, y: d.y, z: d.z } });
      toast('Kanone montiert – Linksklick feuert, C feuert alle. 🧨');
      return;
    }
    if (selected === BLACKHOLE) {
      spawnBlock(BLACKHOLE, i, j, k, null);
      toast('🌌 Schwarzes Loch entlassen. Es frisst hungrig – und findet jedes andere Loch in der Nähe.');
      return;
    }
    spawnBlock(selected, i, j, k);
    if (selected === BALLOON) Sound.balloon();
    else Sound.place();
  }

  function doPush() {
    const hit = aim(5);
    if (!hit || hit.kind !== 'body') return;
    const rec = hit.rec;
    camera.getWorldDirection(tmpDir);
    const m = rec.body.mass();
    rec.body.applyImpulse(
      { x: tmpDir.x * m * 7, y: tmpDir.y * m * 7 + m * 1.5, z: tmpDir.z * m * 7 }, true
    );
    const p = rec.body.translation();
    particles.spawnSmall(p.x, p.y, p.z, 0xffffff, 8);
  }

  // ---------- Wind & Regen ----------
  let raining = 0; // Zeitstempel, bis wann es regnet (ms)
  function gustWind() {
    camera.getWorldDirection(tmpDir);
    let dx = tmpDir.x, dz = tmpDir.z;
    if (dx * dx + dz * dz < 0.0001) { dx = 0; dz = 1; }
    const dl = Math.hypot(dx, dz);
    dx /= dl; dz /= dl;
    let n = 0;
    for (const rec of world.bodies) {
      if (rec.dead) continue;
      const m = rec.body.mass();
      if (!m) continue;
      rec.body.applyImpulse(
        { x: dx * m * (5 + Math.random() * 4), y: m * (1 + Math.random() * 2), z: dz * m * (5 + Math.random() * 4) },
        true
      );
      n++;
    }
    const cp = camera.position;
    for (let i = 0; i < 16; i++) {
      const t2 = 6 + i * 1.6 + Math.random() * 1.5;
      particles.spawnSmall(cp.x + dx * t2, cp.y + 0.4, cp.z + dz * t2, 0xffffff, 3);
    }
    Sound.wind();
    toast(`💨 WIND! ${n} Blöcke davon geblasen!`);
  }
  function startRain() {
    if (performance.now() < raining) { toast('🌧️ Es regnet schon!'); return; }
    raining = performance.now() + 8000;
    Sound.water();
    toast('🌧️ Regen! (Budget-limitiert – keine Flut, versprochen)');
  }

  // ---------- Laser (L halten oder mittlere Maustaste) ----------
  const laserGroup = new THREE.Group();
  {
    const mk = (rad, col, op) => new THREE.Mesh(
      new THREE.CylinderGeometry(rad, rad, 1, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
    );
    laserGroup.add(mk(0.09, 0xff2244, 0.8), mk(0.035, 0xffd9e3, 0.95));
  }
  laserGroup.visible = false;
  scene.add(laserGroup);
  let laserHeld = false, laserNextFire = 0, laserBeamUntil = 0;
  const _beamDir = new THREE.Vector3(), _upY = new THREE.Vector3(0, 1, 0),
        _dirTmp = new THREE.Vector3();

  function showBeam(from, to) {
    _beamDir.subVectors(to, from);
    const len = Math.max(0.1, _beamDir.length());
    laserGroup.position.copy(from).addScaledVector(_beamDir, 0.5);
    laserGroup.quaternion.setFromUnitVectors(_upY, _beamDir.clone().normalize());
    laserGroup.scale.set(1, len, 1);
    laserGroup.visible = true;
    laserBeamUntil = performance.now() + 100;
  }

  let lastLaserUndo = 0;
  function pushLaserUndo() {
    const now = performance.now();
    if (now - lastLaserUndo > 700) { pushUndo(); lastLaserUndo = now; }
  }
  function fireLaser() {
    const hit = aim(45);
    camera.getWorldDirection(tmpDir);
    const end = camera.position.clone().addScaledVector(tmpDir,
      hit ? Math.max(0.6, hit.dist + (hit.kind === 'grid' ? 0.45 : 0.5)) : 45);
    if (hit) {
      if (hit.kind === 'grid') {
        const kk = key(hit.i, hit.j, hit.k);
        const t = world.grid[kk];
        if (t === GROUND) {
          pushLaserUndo();
          world.breakGround(hit.i, hit.j, hit.k);
          particles.spawnSmall(hit.i + 0.5, hit.j + 0.5, hit.k + 0.5, 0x8a5f3a, 16);
        } else if (t === WATER_SRC) {
          pushLaserUndo();
          world.grid[kk] = AIR;
          world.waterSources.delete(kk);
          particles.spawnSmall(hit.i + 0.5, hit.j + 0.5, hit.k + 0.5, 0x38a1ff, 16);
        }
      } else {
        const rec = hit.rec;
        if (rec.type === TNT) {
          explodeAt(hit.px, hit.py, hit.pz);
        } else {
          pushLaserUndo();
          removeBody(rec);
          particles.spawnSmall(hit.px, hit.py, hit.pz, BLOCKS[rec.type].color, 20);
        }
      }
      shake = Math.min(0.25, shake + 0.04);
    }
    showBeam(camera.position, end);
    flashA = Math.max(flashA, 0.05);
    Sound.laser();
  }

  // ---------- Kanone (Slot 7) ----------
  function cannonAmmoType() {
    return (selected !== CANNON && selected !== BLACKHOLE && selected !== WATER_SRC)
      ? selected : STONE;
  }
  function fireCannon(rec) {
    if (rec.dead) return;
    pushUndo();
    const p = rec.body.translation();
    const dir = rec.aimDir || { x: 0, y: 1, z: 0 };
    const ammo = cannonAmmoType();
    if (world.bodies.size >= BUDGET.body) removeBody(bodyOrder[0]);
    const v = 26;
    spawnBlock(ammo,
      Math.min(W - 1, Math.max(0, Math.floor(p.x + dir.x * 1.3))),
      Math.max(0, Math.floor(p.y + dir.y * 1.3)),
      Math.min(D - 1, Math.max(0, Math.floor(p.z + dir.z * 1.3))),
      { x: dir.x * v, y: dir.y * v + 1.5, z: dir.z * v });
    // Rückstoß: die Kanone gibt’s auch ab
    const m = rec.body.mass();
    rec.body.applyImpulse({ x: -dir.x * m * 3, y: -dir.y * m * 1.2, z: -dir.z * m * 3 }, true);
    particles.spawnSmall(p.x + dir.x * 1.4, p.y + dir.y * 1.4, p.z + dir.z * 1.4, 0xffb347, 16);
    shake = Math.min(0.3, shake + 0.05);
    Sound.cannon();
  }
  function fireAllCannons() {
    let n = 0;
    for (const rec of Array.from(world.bodies))
      if (rec.type === CANNON && !rec.dead) { fireCannon(rec); n++; }
    if (!n) toast('Keine Kanone in der Gegend – baue erst eine (Slot 7).');
    else toast(`🧨 ${n} Kanone${n > 1 ? 'n' : ''} feuern!`);
  }

  // ---------- Steuerung ----------
  const camPos = camera.position.clone();
  const _camEuler = new THREE.Euler(0, 0, 0, 'YXZ'); // wiederverwendbar (kein Alloc pro Frame)
  const keys = new Set();
  let locked = false;
  let started = false; // wurde das Spiel schon einmal gestartet?
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  const joyVec = { x: 0, y: 0 }; // virtueller Joystick (-1..1)
  const pauseHint = document.getElementById('pause-hint');

  const startBtn = document.getElementById('start-btn');
  function tryLock() {
    Sound.unlock(); // Audio-Context darf erst nach User-Geste starten
    started = true;
    if (isTouch) {
      // Touch: kein Pointer-Lock, die HUD bleibt immer sichtbar
      locked = true;
      startOverlay.classList.add('hidden');
      hud.classList.remove('hidden');
      pauseHint.classList.add('hidden');
      return;
    }
    const p = renderer.domElement.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }
  startBtn.addEventListener('click', tryLock);
  renderer.domElement.addEventListener('click', () => { if (!locked) tryLock(); });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    if (locked) {
      started = true;
      startOverlay.classList.add('hidden');
      hud.classList.remove('hidden');
      pauseHint.classList.add('hidden');
    } else if (started) {
      // Pause (Esc): HUD + Buttons bleiben bedienbar, kein volles Overlay mehr
      startOverlay.classList.add('hidden');
      hud.classList.remove('hidden');
      pauseHint.classList.remove('hidden');
      startBtn.textContent = '▶ Weitermachen';
    } else {
      startOverlay.classList.remove('hidden');
      hud.classList.add('hidden');
      startBtn.textContent = '▶ Weitermachen';
    }
  });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    yaw -= e.movementX * 0.0022;
    pitch -= e.movementY * 0.0022;
    pitch = THREE.MathUtils.clamp(pitch, -1.55, 1.55);
  });
  document.addEventListener('mousedown', (e) => {
    if (!locked) return;
    if (e.button === 0) doBreak(e.shiftKey);
    else if (e.button === 1) { e.preventDefault(); laserHeld = true; }
    else if (e.button === 2) doPlace();
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 1) laserHeld = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  const muteBadge = document.getElementById('mute-badge');
  let timeScale = 1;
  function setSlowMo(on) {
    timeScale = on ? 0.25 : 1;
    document.getElementById('slowmo').classList.toggle('on', on);
  }
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'KeyM') {
      const m = Sound.toggle();
      muteBadge.classList.toggle('hidden', !m);
      toast(m ? '🔇 Ton aus' : '🔊 Ton an');
      return;
    }
    // Strg-Shortcuts funktionieren auch ohne Pointer-Lock
    if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); doUndo(); return; }
    if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); saveGame(); return; }
    if (e.ctrlKey && e.code === 'KeyL') { e.preventDefault(); loadGame(); return; }
    if (!locked) return;
    const di = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8']
      .indexOf(e.code);
    if (di >= 0) selectSlot(PLACEABLE[di]);
    if (e.code === 'KeyX') flipGravity();
    if (e.code === 'KeyE') doPush();
    if (e.code === 'KeyL') laserHeld = true;
    if (e.code === 'KeyB') setSlowMo(true);
    if (e.code === 'KeyC') fireAllCannons();
    if (e.code === 'KeyT') gustWind();
    if (e.code === 'KeyG') startRain();
    if (e.code === 'KeyN') toggleDayNight();
    if (e.code === 'KeyP') takeScreenshot();
    if (e.code === 'KeyR') location.reload();
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyL') laserHeld = false;
    if (e.code === 'KeyB') setSlowMo(false);
  });

  // ---------- Touch-Controls (nur auf Touch-Geräten) ----------
  if (isTouch) {
    document.body.classList.add('touch');
    startBtn.textContent = '▶ Tippen zum Chaos';
    document.querySelector('#start-overlay ul').innerHTML = [
      '<li><b>Wischen (rechte Seite)</b> – Kamera drehen</li>',
      '<li><b>Linke Seite antippen &amp; halten</b> – Joystick, zum Fliegen</li>',
      '<li><b>Tippen</b> – am Fadenkreuz bauen (oder: Modus auf ⛏️ umstellen &amp; brechen)</li>',
      '<li><b>▲ / ▼</b> – hoch / runter</li>',
      '<li><b>🙃 🌙 💨 🌧️ 🧨 ☢️</b> – Chaos-Buttons (☢️ halten = Laser)</li>',
    ].join('');
    document.getElementById('bottom-left').textContent =
      'Wischen: Kamera · Links: Joystick · Tippen: Bauen/Brechen';

    const joyBase = document.getElementById('joy-base');
    const joyKnob = document.getElementById('joy-knob');
    const joy = { active: false, id: null, bx: 0, by: 0 };
    const camT = { active: false, id: null, lx: 0, ly: 0, sx: 0, sy: 0, t0: 0, moved: 0 };
    let touchMode = 'place';
    const modeBtn = document.getElementById('mode-toggle');
    function updateModeBtn() {
      modeBtn.textContent = touchMode === 'place' ? '🧱 Bauen' : '⛏️ Brechen';
      modeBtn.classList.toggle('break', touchMode === 'break');
    }
    modeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      touchMode = touchMode === 'place' ? 'break' : 'place';
      updateModeBtn();
    });

    renderer.domElement.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const isLeft = t.clientX < window.innerWidth * 0.45;
        if (isLeft && !joy.active) {
          // schwebender Joystick an der Berührungsstelle
          joy.active = true; joy.id = t.identifier;
          joy.bx = t.clientX; joy.by = t.clientY;
          joyBase.style.display = 'block';
          joyBase.style.left = (t.clientX - 60) + 'px';
          joyBase.style.top = (t.clientY - 60) + 'px';
          joyKnob.style.transform = 'translate(0px, 0px)';
          joyVec.x = 0; joyVec.y = 0;
          e.preventDefault();
        } else if (!isLeft && !camT.active) {
          camT.active = true; camT.id = t.identifier;
          camT.lx = camT.sx = t.clientX;
          camT.ly = camT.sy = t.clientY;
          camT.t0 = performance.now(); camT.moved = 0;
        }
      }
    }, { passive: false });

    renderer.domElement.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (joy.active && t.identifier === joy.id) {
          let dx = t.clientX - joy.bx, dy = t.clientY - joy.by;
          const len = Math.hypot(dx, dy), max = 48;
          if (len > max) { dx = dx / len * max; dy = dy / len * max; }
          joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
          joyVec.x = dx / max; joyVec.y = dy / max;
          e.preventDefault();
        } else if (camT.active && t.identifier === camT.id) {
          const dxm = t.clientX - camT.lx, dym = t.clientY - camT.ly;
          camT.moved = Math.max(camT.moved, Math.hypot(t.clientX - camT.sx, t.clientY - camT.sy));
          yaw -= dxm * 0.005;
          pitch -= dym * 0.005;
          pitch = THREE.MathUtils.clamp(pitch, -1.55, 1.55);
          camT.lx = t.clientX; camT.ly = t.clientY;
          e.preventDefault();
        }
      }
    }, { passive: false });

    function endTouch(e) {
      for (const t of e.changedTouches) {
        if (joy.active && t.identifier === joy.id) {
          joy.active = false; joy.id = null;
          joyVec.x = 0; joyVec.y = 0;
          joyBase.style.display = 'none';
        } else if (camT.active && t.identifier === camT.id) {
          const quick = performance.now() - camT.t0 < 300 && camT.moved < 12;
          camT.active = false; camT.id = null;
          if (quick) { if (touchMode === 'place') doPlace(); else doBreak(); }
        }
      }
    }
    renderer.domElement.addEventListener('touchend', endTouch);
    renderer.domElement.addEventListener('touchcancel', endTouch);

    // ▲/▼: virtuelle Tasten (Space/Shift), direkt ins keys-Set
    const bindHold = (id, code) => {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); keys.add(code); });
      el.addEventListener('pointerup', () => keys.delete(code));
      el.addEventListener('pointerleave', () => keys.delete(code));
    };
    bindHold('btn-up', 'Space');
    bindHold('btn-down', 'ShiftLeft');

    // Chaos-Buttons
    const tap = (id, fn) => document.getElementById(id).addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    tap('tool-x', flipGravity);
    tap('tool-n', toggleDayNight);
    tap('tool-t', gustWind);
    tap('tool-g', startRain);
    tap('tool-c', fireAllCannons);
    const toolL = document.getElementById('tool-l');
    toolL.addEventListener('pointerdown', (e) => { e.preventDefault(); laserHeld = true; });
    toolL.addEventListener('pointerup', () => laserHeld = false);
    toolL.addEventListener('pointerleave', () => laserHeld = false);

    window.__touch = { isTouch: true, joyVec, get mode() { return touchMode; } };
  }

  // HUD-Buttons: Speichern / Laden / Neue Insel
  const btnSave = document.getElementById('btn-save');
  const btnLoad = document.getElementById('btn-load');
  const btnNew = document.getElementById('btn-new');
  if (btnSave) btnSave.addEventListener('click', () => saveGame());
  if (btnLoad) btnLoad.addEventListener('click', () => loadGame());
  if (btnNew) btnNew.addEventListener('click', () => {
    if (confirm('Neue Insel starten? Das aktuelle Chaos geht verloren. (💾 Speichern, falls du’s behalten willst.)')) newIsland();
  });

  function flipGravity() {
    world.setGravityFlipped(!world.gravityFlipped);
    const fl = world.gravityFlipped;
    const badge = document.getElementById('grav-badge');
    badge.textContent = fl ? '🙃 Gravitation: HOCH!' : '🌍 Gravitation: runter';
    badge.classList.toggle('flipped', fl);
    flashA = Math.max(flashA, 0.35);
    Sound.flip();
    toast(fl ? 'GRAVITATION UMGEDREHT – jetzt fällt ALLES nach oben 🙃'
             : 'Gravitation wieder normal. Phew. 🌍');
  }

  // ---------- HUD ----------
  const hotbar = document.getElementById('hotbar');
  const slots = [];
  PLACEABLE.forEach((id, n) => {
    const el = document.createElement('div');
    el.className = 'slot';
    const chipColor = id === WATER_SRC ? '#2f7fff'
      : '#' + new THREE.Color(BLOCKS[id].color).getHexString();
    el.innerHTML = `<div class="chip" style="background:${chipColor}"></div>
                    <span class="key">${n + 1}</span> ${slotName(id)}`;
    hotbar.appendChild(el);
    slots.push(el);
  });
  function selectSlot(id) {
    selected = id;
    slots.forEach((el, n) => el.classList.toggle('active', PLACEABLE[n] === id));
  }
  selectSlot(selected);

  let toastTimer = 0;
  function toast(text, cls = '') {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.className = 'show ' + cls;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = cls; }, 2200);
  }

  // ---------- Start-Szenario (ein bisschen Chaos von Anfang an) ----------
  function setupInitialScene() {
    // Teich: 8x8-Grube + Wasserquelle in der Mitte
    const dirty = new Set();
    for (let i = 8; i <= 15; i++)
      for (let k = 8; k <= 15; k++) {
        const h = world.heightAt(i, k);
        world.clearGround(i, h - 1, k);
        world.clearGround(i, h - 2, k);
        dirty.add(i + k * W);
      }
    world.rebuildColumns(dirty);
    const hp = world.heightAt(11, 11);
    world.grid[key(11, hp - 2, 11)] = WATER_SRC;
    world.waterSources.add(key(11, hp - 2, 11));
    world.markGrid(key(11, hp - 2, 11));

    // Turm aus Stein mit TNT-Gipfel
    const ht = world.heightAt(36, 36);
    spawnBlock(STONE, 36, ht, 36);
    spawnBlock(STONE, 36, ht + 1, 36);
    spawnBlock(STONE, 36, ht + 2, 36);
    spawnBlock(TNT, 36, ht + 3, 36);

    // Gummiböden
    const hg = world.heightAt(20, 14);
    spawnBlock(GUMMY, 20, hg, 14);
    spawnBlock(GUMMY, 21, hg, 14);
    spawnBlock(WOOD, 20, hg + 1, 14);
    const hg2 = world.heightAt(24, 18);
    spawnBlock(WOOD, 24, hg2, 18);
    spawnBlock(GUMMY, 24, hg2 + 1, 18);

    // Eisbahn
    const hi = world.heightAt(14, 34);
    spawnBlock(ICE, 14, hi, 34);
    spawnBlock(ICE, 15, hi, 34);
    spawnBlock(ICE, 16, hi, 34);

    // TNT-Reihe (ruht friedlich – bis jemand was drauf wirft)
    for (let k = 26; k <= 28; k++) {
      const h = world.heightAt(6, k);
      spawnBlock(TNT, 6, h, k);
    }

    // Und sofort ein Stein, der direkt auf den Turm fliegt:
    const ht2 = world.heightAt(36, 36);
    spawnBlock(STONE, 12, ht2 + 7, 26, { x: 11, y: 2, z: 6 });
  }
  setupInitialScene();

  // ---------- Undo / Save / Load / Neue Insel ----------
  const UNDO_MAX = 40;
  const undoStack = [];
  function snapshotWorld() {
    return {
      grid: world.grid.slice(),
      water: new Map(water.cells),
      sources: new Set(world.waterSources),
      bodies: [...world.bodies].filter(r => !r.dead).map(r => {
        const p = r.body.translation(), v = r.body.linvel();
        return { type: r.type, x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z,
                 absorbed: r.absorbed || 0,
                 aimDir: r.aimDir ? { x: r.aimDir.x, y: r.aimDir.y, z: r.aimDir.z } : null };
      }),
    };
  }
  function updateUndoHUD() {
    const el = document.getElementById('undocount');
    if (el) el.textContent = undoStack.length;
  }
  function pushUndo() {
    undoStack.push(snapshotWorld());
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    updateUndoHUD();
  }
  function restoreWorld(snap) {
    for (const r of [...world.bodies]) removeBody(r);
    flushPendingRemove();
    world.grid.set(snap.grid);
    world.gridDirty = true;
    water.cells = new Map(snap.water);
    water.refreshTotal();
    water.dirty = true;
    world.waterSources = new Set(snap.sources);
    for (let i = 0; i < W; i++) for (let k = 0; k < D; k++) world.rebuildColumn(i, k);
    for (const b of snap.bodies)
      spawnBlock(b.type, Math.round(b.x - 0.5), Math.round(b.y - 0.5), Math.round(b.z - 0.5),
        { x: b.vx, y: b.vy, z: b.vz }, { aimDir: b.aimDir, absorbed: b.absorbed || 0 });
  }
  function doUndo() {
    const snap = undoStack.pop();
    if (!snap) { toast('Nichts zum Rückgängigmachen. (Strg+Z)'); return false; }
    restoreWorld(snap);
    updateUndoHUD();
    toast('↩️ Rückgängig');
    Sound.pop();
    return true;
  }

  const SAVE_KEY = 'blok-chaos-save-v1';
  function saveGame() {
    try {
      const data = {
        v: 1,
        grid: Array.from(world.grid),
        water: [...water.cells.entries()],
        sources: [...world.waterSources],
        bodies: snapshotWorld().bodies,
        dayPhase, gravFlipped: world.gravityFlipped,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      toast('💾 Gespeichert! (überlebt sogar den Reload)');
      return true;
    } catch (e) { toast('Speichern fehlgeschlagen 😅'); return false; }
  }
  function loadGame() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) { toast('Kein Save gefunden. (Zuerst 💾 Speichern)'); return false; }
      const data = JSON.parse(raw);
      const snap = {
        grid: Uint8Array.from(data.grid),
        water: new Map(data.water),
        sources: new Set(data.sources),
        bodies: data.bodies,
      };
      restoreWorld(snap);
      const dn = data.dayPhase ? 1 : 0;
      dayTarget = dn; dayPhase = dn; updateDayNight(dn);
      world.setGravityFlipped(!!data.gravFlipped);
      toast('📂 Spiel geladen!');
      return true;
    } catch (e) { toast('Laden fehlgeschlagen 😅'); return false; }
  }
  function newIsland() {
    for (const r of [...world.bodies]) removeBody(r);
    flushPendingRemove();
    world.grid.fill(AIR);
    world.waterSources.clear();
    water.clear();
    water.dirty = true;
    world.setGravityFlipped(false);
    world.generateTerrain();
    undoStack.length = 0;
    updateUndoHUD();
    dayTarget = 0; dayPhase = 0; updateDayNight(0);
    setupInitialScene();
    toast('🏝️ Frische Insel! Das alte Chaos ist vergessen.');
    return true;
  }
  updateUndoHUD();

  // ---------- Instanz-Updates ----------
  // Gebackenes AO: pro Instanz ein Grauton, der die Basisfarbe multipliziert.
  const _aoGray = new THREE.Color();
  const terrainAO = new Float32Array(world.grid.length).fill(1);
  const colH = new Int16Array(W * D).fill(-1);
  // AO für eine Terrain-Spalte (nur die oberste Zelle ist sichtbar):
  // benachbarte Blöcke und höhere Nachbarspalten verdunkeln sie.
  function aoCol(ci, hasBlock) {
    const i = ci % W, k = (ci / W) | 0;
    const j = colH[ci];
    if (j < 0) return;
    let o = 0;
    if (hasBlock(i, j + 1, k)) o += 1.0;
    if (hasBlock(i + 1, j + 1, k) || hasBlock(i - 1, j + 1, k) ||
        hasBlock(i, j + 1, k + 1) || hasBlock(i, j + 1, k - 1)) o += 0.5;
    const hn = (a, b) => inBounds(a, 0, b) ? colH[a + b * W] : -1;
    if (hn(i + 1, k) > j) o += 0.35;
    if (hn(i - 1, k) > j) o += 0.35;
    if (hn(i, k + 1) > j) o += 0.35;
    if (hn(i, k - 1) > j) o += 0.35;
    terrainAO[key(i, j, k)] = Math.max(0.55, 1 - o * 0.18);
  }

  // WIRD NUR GEFUDDERT, WENN SICH WAS GEÄNDERT HAT (Grid oder Belegung –
  // wird von updateInstances geprüft). Der alte Full-Scan kostete JEDEN
  // Frame 48·48·26 ≈ 60k Grid-Reads + ein frisches Map + 26 Lookups pro
  // Block. Jetzt: colH nur für die veränderten Spalten neu scannen.
  function recomputeAO(occ) {
    // 1) Spaltenhöhen: nur die in diesem Frame veränderten Spalten
    if (world.gridDirty) {
      for (const ci of world.dirtyCols) {
        const i = ci % W, k = (ci / W) | 0;
        let top = -1;
        for (let j = H - 1; j >= 0; j--)
          if (world.grid[key(i, j, k)] === GROUND) { top = j; break; }
        colH[i + k * W] = top;
      }
    }
    // 2) occ kommt von updateInstances (dort als Set gebaut + Change-Detect)
    const solidCell = (i, j, k) => inBounds(i, j, k) && world.grid[key(i, j, k)] === GROUND;
    const hasBlock = (i, j, k) => occ.has(key(i, j, k));
    // 3) Blöcke: alle festen Nachbarn (Terrain + Blöcke) verdunkeln
    // (Positionen aus dem Frame-Cache – keine extra translation()-Aufrufe)
    const BF = 0.085, BC = 0.026, BMIN = 0.5;
    for (const rec of world.bodies) {
      if (rec.dead) continue;
      const ci = Math.round(rec._rx - 0.5), cj = Math.round(rec._ry - 0.5), ck = Math.round(rec._rz - 0.5);
      let face = 0, corner = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue;
        if (solidCell(ci+dx, cj+dy, ck+dz) || hasBlock(ci+dx, cj+dy, ck+dz))
          (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1 ? face++ : corner++);
      }
      rec.ao = Math.max(BMIN, 1 - face * BF - corner * BC);
    }
    // 4) Terrain: verschmutzte Spalten + 4 Nachbarn (Grid-Change) bzw.
    // alle sichtbaren Spalten, wenn nur die Block-Belegung sich geändert hat
    // (ein Block ist in eine Zelle über dem Boden umgezogen / weggefallen)
    if (world.gridDirty) {
      const cols = [...world.dirtyCols];
      for (const ci of world.dirtyCols) {
        const i = ci % W, k = (ci / W) | 0;
        if (i + 1 < W) cols.push(i + 1 + k * W);
        if (i - 1 >= 0) cols.push(i - 1 + k * W);
        if (k + 1 < D) cols.push(i + (k + 1) * W);
        if (k - 1 >= 0) cols.push(i + (k - 1) * W);
      }
      for (const ci of cols) aoCol(ci, hasBlock);
    } else {
      for (let ci = 0; ci < W * D; ci++) aoCol(ci, hasBlock);
    }
  }

  const dummy = new THREE.Object3D();
  const _stV = new THREE.Vector3();
  const _AXIS_X = new THREE.Vector3(1, 0, 0);
  // --- Dirty-Tracking: AO, Terrain- und Block-Buffer werden nur neu
  // berechnet/hochgeladen, wenn sich das Grid oder die Block-Belegung
  // geändert haben. In einer ruhigen Szene (alles schlafend) fliegt damit
  // der 60k-Grid-Scan UND die meisten Buffer-Uploads raus.
  let lastOcc = new Set();
  let terrainBuilt = false;
  const terrainList = []; // gridKeys der GROUND-Zellen (nur bei Grid-Change neu)

  // Terrain-Instanzen neu aufbauen (NUR bei Grid-Änderung): die
  // 60k-Zellen-Suche + Matrizen-Upload laufen jetzt nur noch in
  // "schmutzigen" Frames, nicht mehr jeden Frame.
  function rebuildTerrain() {
    terrainList.length = 0;
    const grid = world.grid;
    for (let kk = 0; kk < grid.length; kk++)
      if (grid[kk] === GROUND) terrainList.push(kk);
    dummy.quaternion.identity();
    dummy.scale.set(1, 1, 1);
    let n = 0;
    for (const kk of terrainList) {
      if (n >= CAP_GROUND) break;
      const [i, j, k] = decode(kk);
      dummy.position.set(i + 0.5, j + 0.5, k + 0.5);
      dummy.updateMatrix();
      meshes[GROUND].setMatrixAt(n++, dummy.matrix);
    }
    meshes[GROUND].count = n;
    meshes[GROUND].instanceMatrix.needsUpdate = true;
    terrainBuilt = true;
  }

  // Terrain-Grautöne (gebackenes AO) – nur bei AO-Änderung nötig
  function uploadTerrainAO() {
    let n = 0;
    for (const kk of terrainList) {
      if (n >= CAP_GROUND) break;
      _aoGray.setScalar(terrainAO[kk] || 1);
      meshes[GROUND].setColorAt(n++, _aoGray);
    }
    if (meshes[GROUND].instanceColor) meshes[GROUND].instanceColor.needsUpdate = true;
  }

  function updateInstances() {
    // Belegung + Positions-Cache für den Frame: 1 translation() pro
    // Block, danach für AO und Matrizen wiederverwendet (vorher 3×)
    const occ = new Set();
    for (const rec of world.bodies) {
      if (rec.dead) continue;
      const p = rec.body.translation();
      rec._rx = p.x; rec._ry = p.y; rec._rz = p.z;
      occ.add(key(Math.round(p.x - 0.5), Math.round(p.y - 0.5), Math.round(p.z - 0.5)));
    }
    // Hat sich was getan? (Grid geändert ODER Belegung eine Zelle gewechselt)
    let occChanged = occ.size !== lastOcc.size;
    if (!occChanged) for (const kk of occ) if (!lastOcc.has(kk)) { occChanged = true; break; }
    const gDirty = world.gridDirty;
    const aoDirty = gDirty || occChanged;
    // Alles schlafend + nichts geändert → die GPU-Buffer sind aktuell
    let allSleeping = true;
    for (const rec of world.bodies)
      if (!rec.dead && !rec.body.isSleeping()) { allSleeping = false; break; }
    lastOcc = occ;

    // AO nur bei tatsächlicher Änderung, danach Dirty-Flags klären
    if (aoDirty) recomputeAO(occ);
    if (gDirty) world.resetGridDirty();

    // Terrain: Matrizen nur bei Grid-Change, AO-Farben bei AO-Änderung
    if (!terrainBuilt) { rebuildTerrain(); uploadTerrainAO(); }
    else if (gDirty) { rebuildTerrain(); uploadTerrainAO(); }
    else if (occChanged) uploadTerrainAO();

    // Blöcke + Kanonenrohre: hochladen, wenn sich was bewegt hat
    // (alles schlafend + Grid sauber → Buffer auf dem GPU sind aktuell)
    const uploadBlocks = aoDirty || !allSleeping;

    // Dynamische Blöcke – bei komplett schlafender Welt (und unverändertem
    // Grid) sind die Instanz-Buffer auf dem GPU noch aktuell → überspringen
    for (const t of BODY_TYPES) {
      if (!uploadBlocks) continue;
      if (t === BLACKHOLE) { meshes[t].count = 0; continue; } // eigenes Visual (Ereignishorizont)
      let m = 0;
      for (const rec of world.bodies) {
        if (rec.type !== t || rec.dead) continue;
        const r = rec.body.rotation();
        dummy.position.set(rec._rx, rec._ry, rec._rz);
        const s = rec.stretch || 1;
        if (s > 1.03 && rec.stretchAxis) {
          // Spaghettifizierung: lokale X-Achse radial ins Loch zeigen, strecken
          _stV.set(rec.stretchAxis.x, 0, rec.stretchAxis.z);
          if (_stV.lengthSq() > 1e-6) {
            _stV.normalize();
            dummy.quaternion.setFromUnitVectors(_AXIS_X, _stV);
            const inv = 1 / Math.sqrt(s);
            dummy.scale.set(s, inv, inv);
          } else {
            dummy.quaternion.set(r.x, r.y, r.z, r.w);
            dummy.scale.set(1, 1, 1);
          }
        } else {
          dummy.quaternion.set(r.x, r.y, r.z, r.w);
          dummy.scale.set(1, 1, 1);
        }
        dummy.updateMatrix();
        if (m < CAP_BODY) {
          meshes[t].setMatrixAt(m, dummy.matrix);
          _aoGray.setScalar(rec.ao || 1);
          meshes[t].setColorAt(m, _aoGray);
          m++;
        }
      }
      meshes[t].count = m;
      meshes[t].instanceMatrix.needsUpdate = true;
      if (meshes[t].instanceColor) meshes[t].instanceColor.needsUpdate = true;
    }

    // Kanonenrohre (ebenso erst, wenn sich was bewegt hat)
    let bn = 0;
    if (uploadBlocks) {
      for (const rec of world.bodies) {
        if (rec.type !== CANNON || rec.dead) continue;
        const dir = rec.aimDir || { x: 0, y: 1, z: 0 };
        dummy.position.set(rec._rx + dir.x * 0.55, rec._ry + dir.y * 0.55, rec._rz + dir.z * 0.55);
        dummy.quaternion.setFromUnitVectors(_upY, _dirTmp.set(dir.x, dir.y, dir.z).normalize());
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        if (bn < 64) barrelMesh.setMatrixAt(bn++, dummy.matrix);
      }
      barrelMesh.count = bn;
      barrelMesh.instanceMatrix.needsUpdate = true;
    }

    // Schwarze Löcher (Interstellar-Stil): schwarzer Ereignishorizont,
    // Photonenring am Horizont, rotierende Akkretionsscheibe. Der Spin ist
    // der Drehimpuls aus dem, was es gefressen hat – je mehr, desto
    // schneller dreht sich die Scheibe (und richtet die Blöcke aus).
    const bt = performance.now() * 0.003;
    for (const rec of world.bodies) {
      if (rec.type !== BLACKHOLE || rec.dead || !rec.shadow) continue;
      const p = rec.body.translation();
      rec.size = Math.min(3.2, 1 + rec.absorbed * 0.15);
      rec.spin = 0.35 + rec.absorbed * 0.12;
      const tNow = performance.now() / 1000;
      rec.phase += rec.spin * Math.min(0.1, tNow - (rec._prevT || tNow));
      rec._prevT = tNow;
      // Ereignishorizont: schwarze Kugel
      rec.shadow.position.set(p.x, p.y, p.z);
      rec.shadow.scale.setScalar(0.6 * rec.size);
      // Photonenring: direkt am Horizont, leicht pulsierend
      rec.ring.position.set(p.x, p.y, p.z);
      const rr = 1.08 * rec.size * (1 + 0.04 * Math.sin(bt * 2.0 + rec.phase));
      rec.ring.scale.set(rr, rr, 1);
      // Akkretionsscheibe: dreht mit dem Spin (Muster + Beaming-Hotspot
      // orbitieren mit – wie beim Gaskreislauf um das Loch)
      rec.dish.position.set(p.x, p.y, p.z);
      rec.dish.scale.setScalar(rec.size);
      rec.dish.rotation.y = rec.phase;
      // Lila Atmosphären-Glow
      const gs = (1.5 + rec.absorbed * 0.3) * (1 + 0.12 * Math.sin(bt + p.x));
      rec.sprite.position.set(p.x, p.y, p.z);
      rec.sprite.scale.set(gs, gs, 1);
      // Senkrechte Photonen-Halos: mit dem Loch, leicht pulsierend
      if (rec.halo1 && rec.halo2) {
        const hs = rec.size * (1 + 0.03 * Math.sin(bt * 2.3 + rec.phase * 2));
        rec.halo1.position.set(p.x, p.y, p.z);
        rec.halo2.position.set(p.x, p.y, p.z);
        rec.halo1.scale.setScalar(hs);
        rec.halo2.scale.setScalar(hs);
      }
    }

    // Wasser (Quellen + fließend) – nur hochladen, wenn Zellen sich
    // geändert haben (stehendes Wasser braucht keinen neuen Upload)
    if (water.dirty) {
      let wn = 0;
      dummy.quaternion.identity();
      dummy.scale.set(1, 1, 1);
      for (const skk of world.waterSources) {
        const [i, j, k] = decode(skk);
        dummy.position.set(i + 0.5, j + 0.5, k + 0.5);
        dummy.updateMatrix();
        if (wn < CAP_WATER) waterMesh.setMatrixAt(wn++, dummy.matrix);
      }
      for (const kk of water.cells.keys()) {
        const [i, j, k] = decode(kk);
        dummy.position.set(i + 0.5, j + 0.5, k + 0.5);
        dummy.updateMatrix();
        if (wn < CAP_WATER) waterMesh.setMatrixAt(wn++, dummy.matrix);
      }
      waterMesh.count = wn;
      waterMesh.instanceMatrix.needsUpdate = true;
      water.dirty = false;
    }
    return aoDirty;
  }

  // ---------- Haupt-Loop ----------
  const STEP = 1 / 60;
  let last = performance.now();
  // Performance-Zähler (test/perf.mjs): JS-Zeit pro Frame in Physik vs. Instanz-Update
  const perf = { frames: 0, physMs: 0, instMs: 0, aoFull: 0 };
  // ---------- Ziel-Highlight (Block/Zelle, auf den man zielt) ----------
  const highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 1.1, 1.1)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: true })
  );
  highlight.visible = false;
  highlight.renderOrder = 20;
  scene.add(highlight);

  // ---------- Screenshot (P) ----------
  function takeScreenshot() {
    renderer.render(scene, camera); // frische Frame sichern
    const cv = renderer.domElement;
    const done = (blob) => {
      if (!blob || blob.size < 100) { toast('Screenshot fehlgeschlagen 😅'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chaos-diorama-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('📸 Screenshot gespeichert!');
    };
    if (cv.toBlob) cv.toBlob(done, 'image/png');
    else { // Fallback für WebGPU ohne toBlob
      try { const u = cv.toDataURL('image/png');
        const a = document.createElement('a'); a.href = u;
        a.download = 'chaos-diorama.png'; a.click(); toast('📸 Screenshot gespeichert!');
      } catch (e) { toast('Screenshot fehlgeschlagen 😅'); }
    }
  }

  let acc = 0;
  let waterAcc = 0; // Wasser-CA in Welt-Zeit (~20 Hz)
  let fpsFrames = 0, fpsTime = 0;
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(),
        move = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    // Tag/Nacht: sanfte Überblendung zum Zielzustand
    if (Math.abs(dayTarget - dayPhase) > 0.0004) {
      dayPhase += (dayTarget - dayPhase) * Math.min(1, dt * 2.2);
      if (Math.abs(dayTarget - dayPhase) < 0.0004) dayPhase = dayTarget;
      updateDayNight(dayPhase);
    }

    // Kamera (Euler wird wiederverwendet – kein Objekt-Alloc pro Frame)
    _camEuler.set(pitch, yaw, 0);
    camera.quaternion.setFromEuler(_camEuler);
    if (locked) {
      camera.getWorldDirection(fwd);
      right.crossVectors(fwd, UP).normalize();
      move.set(0, 0, 0);
      if (keys.has('KeyW')) move.add(fwd);
      if (keys.has('KeyS')) move.sub(fwd);
      if (keys.has('KeyD')) move.add(right);
      if (keys.has('KeyA')) move.sub(right);
      if (keys.has('Space')) move.y += 1;
      if (keys.has('ShiftLeft') || keys.has('ShiftRight')) move.y -= 1;
      if (isTouch && (joyVec.x !== 0 || joyVec.y !== 0)) {
        move.addScaledVector(fwd, -joyVec.y); // Joystick hoch = vor
        move.addScaledVector(right, joyVec.x); // Joystick rechts = rechts
      }
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(11 * dt);
        camPos.add(move);
      }
      camPos.x = THREE.MathUtils.clamp(camPos.x, -12, W + 12);
      camPos.z = THREE.MathUtils.clamp(camPos.z, -12, D + 12);
      camPos.y = THREE.MathUtils.clamp(camPos.y, -4, 70);
    }

    // Physik (festes Zeitraster, in Zeitlupe 4× langsamer)
    water.budget = BUDGET.water; // dynamisches Wasser-Budget (Regen/Quellen lesen es)
    const t0 = performance.now();
    acc += dt * timeScale;
    let n = 0;
    while (acc >= STEP && n < 5) { stepPhysics(); acc -= STEP; n++; }
    // "Spiral of death"-Gürtel: Auf sehr langsamen Geräten würde der
    // Akkumulator sonst unbeschränkt wachsen und jeder Frame 5× Physik
    // brauchen. Lieber fällt die Sim dann ein Ticken hinterher.
    if (n >= 5) acc = 0;
    const t1 = performance.now();
    // Crash-Gürtel: EIN Physik-Frame kostet schon mehr als ein Viertel-
    // Sekunde → Budget sofort halbieren (reagiert schneller als das
    // 0,5s-FPS-Metern). acc=0: dieser Frame hat genug geleistet.
    if (t1 - t0 > 250 && (BUDGET.body > BUDGET.bodyMin || BUDGET.water > BUDGET.waterMin)) {
      BUDGET.lastCut = performance.now();
      BUDGET.goodStreak = 0;
      BUDGET.body = Math.max(BUDGET.bodyMin, Math.round(BUDGET.body * 0.5));
      BUDGET.water = Math.max(BUDGET.waterMin, Math.round(BUDGET.water * 0.5));
      cutElements();
      acc = 0;
    }
    // Dauereinhaltung: Das Budget darf nie übertroffen werden (mehrere
    // Kanonen können in einem Frame feuern; der Spawn-Cut deckt nur eine)
    if (world.bodies.size > BUDGET.body) cutElements();
    // Wasser-CA: ~20 Hz in Welt-Zeit (folgt der Zeitlupe)
    waterAcc += dt * timeScale;
    if (waterAcc >= 1 / 20) { waterAcc %= 1 / 20; water.tick(); }
    // Laser: Halten = Dauerfeuer
    if (laserHeld && locked && performance.now() >= laserNextFire) {
      laserNextFire = performance.now() + 130;
      fireLaser();
    }
    if (laserGroup.visible && performance.now() > laserBeamUntil) laserGroup.visible = false;
    cloudDrift(now);
    particles.update(dt * timeScale, world.gdir);
    if (updateInstances()) perf.aoFull++;
    perf.physMs += t1 - t0;
    perf.instMs += performance.now() - t1;
    perf.frames++;

    // Screen-Shake + Flash
    if (shake > 0.001) {
      camera.position.set(
        camPos.x + (Math.random() - 0.5) * shake,
        camPos.y + (Math.random() - 0.5) * shake,
        camPos.z + (Math.random() - 0.5) * shake
      );
      shake *= Math.exp(-5 * dt);
    } else {
      camera.position.copy(camPos);
      shake = 0;
    }
    if (flashA > 0.003) {
      flash.style.opacity = flashA.toFixed(3);
      flashA *= Math.exp(-8 * dt);
    } else {
      flash.style.opacity = '0';
      flashA = 0;
    }

    // Ziel-Highlight: Box um den Block/die Zelle, auf die man zielt
    if (locked) {
      const hit = aim(9);
      if (hit) {
        if (hit.kind === 'grid') highlight.position.set(hit.i + 0.5, hit.j + 0.5, hit.k + 0.5);
        else { const p = hit.rec.body.translation(); highlight.position.set(p.x, p.y, p.z); }
        highlight.material.opacity = 0.55 + 0.35 * Math.sin(now * 0.006);
        highlight.visible = true;
      } else highlight.visible = false;
    } else highlight.visible = false;

    // HUD
    fpsFrames++; fpsTime += dt;
    if (fpsTime >= 0.5) {
      const fps = fpsFrames / fpsTime;
      document.getElementById('fps').textContent = Math.round(fps);
      // 🐢 = adaptives Budget arbeitet (System ist am Limit)
      const limited = BUDGET.body < BUDGET.bodyMax || BUDGET.water < BUDGET.waterMax;
      document.getElementById('blocks').textContent = world.bodies.size + (limited ? ' 🐢' : '');
      document.getElementById('watercount').textContent = water.cells.size + (limited ? ' 🐢' : '');
      fpsFrames = 0; fpsTime = 0;
      adaptBudget(fps); // adaptives Element-Budget (Crash-Schutz)
    }

    renderer.render(scene, camera);
  });

  toast('Willkommen im Chaos! Tipp: L halten = LASER ☢');

  // Konsolen-Spielzeug (und Smoke-Tests): von dort aus kann man alles antesten
  window.__game = {
    world, water, particles, renderer, scene, camera, meshes, THREE, perf,
    budget: BUDGET, cutElements, adaptBudget,
    spawnBlock, removeBody, explodeAt, flipGravity,
    doBreak, doPlace, doPush, selectSlot, aim, fireLaser, laserGroup,
    fireCannon, fireAllCannons, setSlowMo, sound: Sound, gustWind, startRain, attachChainJoint,
    takeScreenshot, highlight, toggleDayNight, sun, stars: stars, clouds,
    doUndo, saveGame, loadGame, newIsland, pushUndo, snapshotWorld,
    get undoCount() { return undoStack.length; },
    get dayPhase() { return dayPhase; }, get dayTarget() { return dayTarget; },
    setCamera: (x, y, z) => { camPos.set(x, y, z); },
    setLook: (y, p) => { yaw = y; pitch = THREE.MathUtils.clamp(p, -1.55, 1.55); },
  };
}
