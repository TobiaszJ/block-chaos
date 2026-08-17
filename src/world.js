import { AIR, GROUND, WATER_SRC } from './blocks.js';

export const W = 48; // x
export const H = 26; // y
export const D = 48; // z
const SIZE = W * D;

export const key = (i, j, k) => i + k * W + j * SIZE;

// Kollisionsgruppen (Rapier InteractionGroups: (filter << 16) | mask).
// Das Schwarze Loch kollidiert NUR mit dem Terrain (damit es darauf ruht),
// aber NICHT mit dynamischen Blöcken – so werden Blöcke hindurchgesogen und
// verschluckt, statt am Loch abzuspringen. Blöcke prallen weiter voneinander
// und vom Boden ab.
//   filter: 1 = Terrain, 2 = Blöcke, 4 = Schwarzes Loch
export const CG = {
  ground: (1 << 16) | 7, // Terrain:  mit allem (Terrain|Blöcke|Loch)
  block:  (2 << 16) | 3, // Blöcke:   mit Terrain + Blöcke (NICHT Loch)
  bh:     (4 << 16) | 1, // S. Loch:  nur mit Terrain
};
export const inBounds = (i, j, k) => i >= 0 && i < W && j >= 0 && j < H && k >= 0 && k < D;
// key -> (i, j, k)
export function decode(kk) {
  const j = (kk / SIZE) | 0;
  const rem = kk - j * SIZE;
  const k = rem % W;
  const i = (rem - k) / W;
  return [i, j, k];
}

export class World {
  constructor(rapier) {
    this.R = rapier;
    this.physicsWorld = new rapier.World({ x: 0, y: -9.81, z: 0 });
    this.grid = new Uint8Array(W * H * D);
    this.colRuns = new Array(SIZE).fill(null); // pro Spalte: [{j0, j1, body}]
    this.bodies = new Set();                   // dynamische Block-Records
    this.bodyByHandle = new Map();             // rigidBody.handle -> Record
    this.waterSources = new Set();             // Set<gridKey>
    this.gravityFlipped = false;
  }

  setGravityFlipped(flipped) {
    this.gravityFlipped = flipped;
    const g = flipped ? 9.81 : -9.81;
    this.physicsWorld.gravity = { x: 0, y: g, z: 0 };
    // Schläfende Blöcke aufwecken, damit sie den Flip mitbekommen
    for (const rec of this.bodies) rec.body.wakeUp();
  }

  // y-Richtung, in die Wasser fällt: -1 normal, +1 bei geflippter Gravitation
  get gdir() { return this.gravityFlipped ? 1 : -1; }

  // ---------- Terrain ----------

  heightAt(i, k) {
    const x = i * 0.16, z = k * 0.16;
    const h = 7
      + 2.2 * Math.sin(x * 1.1 + 2.0) * Math.cos(z * 0.95)
      + 1.6 * Math.sin(x * 2.2 + z * 1.7)
      + 1.1 * Math.sin((x + z) * 0.45 + 1.2);
    return Math.max(3, Math.min(H - 10, Math.round(h)));
  }

  // ECHTE aktuelle Terrainoberfläche in Spalte (i,k) – liest das Grid
  // (also Gruben/Explosionskrater mit ein), optional nur bis jStart nach
  // unten. heightAt() dagegen ist die prozedurale Ursprungs-Höhe.
  surfaceBelow(i, k, jStart) {
    if (!inBounds(i, 0, k)) return 0.5;
    let j = Math.min(jStart === undefined ? H - 1 : jStart, H - 1);
    for (; j >= 0; j--)
      if (this.grid[key(i, j, k)] === GROUND) return j + 1;
    return 0.5;
  }

  generateTerrain() {
    for (let i = 0; i < W; i++)
      for (let k = 0; k < D; k++) {
        const h = this.heightAt(i, k);
        for (let j = 0; j < h; j++) this.grid[key(i, j, k)] = GROUND;
        this.rebuildColumn(i, k);
      }
  }

  // Eine Spalte ist eine Folge von GROUND-Zellen. Jede maximale vertikale
  // Läufe-Länge (Run) bekommt einen einzigen statischen Cuboid-Collider.
  // Beim Zerschlagen wird die Spalte neu in Runs aufgeteilt.
  rebuildColumn(i, k) {
    const ci = i + k * W;
    for (const r of this.colRuns[ci] || []) this.physicsWorld.removeRigidBody(r.body);
    const runs = [];
    let j = 0;
    while (j < H) {
      if (this.grid[key(i, j, k)] === GROUND) {
        const j0 = j;
        while (j < H && this.grid[key(i, j, k)] === GROUND) j++;
        const j1 = j - 1;
        const body = this.physicsWorld.createRigidBody(this.R.RigidBodyDesc.fixed());
        const col = this.physicsWorld.createCollider(
          this.R.ColliderDesc.cuboid(0.5, (j1 - j0 + 1) / 2, 0.5)
            .setTranslation(i + 0.5, (j0 + j1 + 1) / 2, k + 0.5)
            .setCollisionGroups(CG.ground),
          body
        );
        col.setFriction(0.9);
        // wichtig: TNT muss auch bei Boden-Aufprall explodieren!
        col.setActiveEvents(this.R.ActiveEvents.COLLISION_EVENTS);
        runs.push({ j0, j1, body });
      } else j++;
    }
    this.colRuns[ci] = runs;
  }

  breakGround(i, j, k) {
    this.grid[key(i, j, k)] = AIR;
    this.rebuildColumn(i, k);
  }

  clearGround(i, j, k) {
    // wie breakGround, aber Spalten-Rebuild wird vom Aufrufer gebündelt
    this.grid[key(i, j, k)] = AIR;
  }

  // Entfernt alle GROUND-Zellen in einer Spalte, die nicht bis in den Boden
  // (j=0) verbunden sind – also von einer Explosion „abgebissene" Überhänge,
  // die sonst schwebend in der Luft hängen würden. Spalte wird neu aufgebaut.
  collapseColumn(i, k) {
    let j = 0;
    while (j < H && this.grid[key(i, j, k)] === GROUND) j++;
    for (let j2 = j; j2 < H; j2++)
      if (this.grid[key(i, j2, k)] === GROUND) this.grid[key(i, j2, k)] = AIR;
    this.rebuildColumn(i, k);
  }

  rebuildColumns(set) {
    for (const ci of set) this.rebuildColumn(ci % W, (ci / W) | 0);
  }

  // ---------- Raycast durchs Voxel-Grid (Amanatides & Woo) ----------
  // Liefert { i, j, k, nx, ny, nz, dist } oder null.
  raycastGrid(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tx = dx !== 0 ? (sx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
    let ty = dy !== 0 ? (sy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
    let tz = dz !== 0 ? (sz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let n = 0; n < 512; n++) {
      if (!inBounds(x, y, z)) return null;
      if (this.grid[key(x, y, z)] !== AIR) {
        if (t > maxDist) return null;
        return { i: x, j: y, k: z, nx, ny, nz, dist: t };
      }
      if (tx <= ty && tx <= tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty <= tz)        { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else                      { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
      if (t > maxDist) return null;
    }
    return null;
  }
}
