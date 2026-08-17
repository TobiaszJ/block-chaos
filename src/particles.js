import * as THREE from 'three';

const HIDDEN_Y = 9999;

export class Particles {
  constructor(scene, n = 1200) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.cursor = 0;
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = HIDDEN_Y;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.3, vertexColors: true, map: softSprite(),
      transparent: true, alphaTest: 0.02, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, life) {
    const i = this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.base[i * 3] = r; this.base[i * 3 + 1] = g; this.base[i * 3 + 2] = b;
    this.life[i] = this.maxLife[i] = life;
  }

  spawnBurst(x, y, z, count, colors, speed, life, dirBias = null) {
    for (let s = 0; s < count; s++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = (0.3 + Math.random() * 0.7) * speed;
      let vx = Math.sin(ph) * Math.cos(th) * sp;
      let vy = Math.cos(ph) * sp;
      let vz = Math.sin(ph) * Math.sin(th) * sp;
      if (dirBias) { vx += dirBias.x; vy += dirBias.y; vz += dirBias.z; }
      const c = colors[(Math.random() * colors.length) | 0];
      this.spawn(x, y, z, vx, vy, vz, c.r, c.g, c.b, life * (0.5 + Math.random() * 0.5));
    }
  }

  spawnSmall(x, y, z, colorHex, count = 14) {
    const c = new THREE.Color(colorHex);
    this.spawnBurst(x, y, z, count, [{ r: c.r, g: c.g, b: c.b }], 3.2, 0.7);
  }

  spawnExplosion(x, y, z) {
    const colors = [
      { r: 1.0, g: 0.35, b: 0.1 }, { r: 1.0, g: 0.6, b: 0.15 },
      { r: 1.0, g: 0.85, b: 0.3 }, { r: 0.25, g: 0.25, b: 0.25 },
      { r: 0.6, g: 0.6, b: 0.6 },
      // Erde, die in die Luft fliegt
      { r: 0.55, g: 0.4, b: 0.26 }, { r: 0.35, g: 0.55, b: 0.35 },
    ];
    this.spawnBurst(x, y, z, 130, colors, 10, 1.4);
  }

  update(dt, gravityDir) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = HIDDEN_Y; this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.vel[i * 3 + 1] += 9.81 * gravityDir * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    if (any) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
  }
}

// Weicher runder Sprite (radialer Verlauf) statt eckiger Punkte
function softSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
