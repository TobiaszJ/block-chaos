import { key, decode, inBounds } from './world.js';
import { AIR, WATER_SRC } from './blocks.js';

export const MAX_WATER = 1400;   // Gesamtbudget an Wassermenge
const CELL_CAP = 8;              // maximale Menge pro Zelle

// Voxel-Wasser mit Mengenmodell:
//  - jede Zelle hält 1..8 "Einheiten" Wasser
//  - Zellen fallen in Gravitationsrichtung (ganze Menge),
//    gießen in teilweise gefüllte Zellen darunter,
//    oder verteilen sich seitlich auf bis zu zwei Nachbarn.
//  - Stehendes Wasser verdunstet langsam → Pfützen bleiben endlich,
//    statt die Welt zu fluten. (Haushalt bleibt immer begrenzt: MAX_WATER.)
export class Water {
  constructor(world) {
    this.world = world;
    this.cells = new Map(); // gridKey -> amount (1..CELL_CAP)
  }

  totalAmount() {
    let t = 0;
    for (const a of this.cells.values()) t += a;
    return t;
  }

  trySet(i, j, k, amount = 1) {
    if (!inBounds(i, j, k)) return false;
    const kk = key(i, j, k);
    if (this.world.grid[kk] !== AIR) return false;
    const existing = this.cells.get(kk) || 0;
    if (existing + amount > CELL_CAP) return false;
    if (this.totalAmount() + amount > MAX_WATER) return false;
    this.cells.set(kk, existing + amount);
    return true;
  }

  // Zelle enthält (fließendes) Wasser oder ist eine Quelle?
  waterAt(i, j, k) {
    if (!inBounds(i, j, k)) return false;
    return this.world.grid[key(i, j, k)] === WATER_SRC || this.cells.has(key(i, j, k));
  }

  tick() {
    const w = this.world;
    const gdir = w.gdir;

    for (const kk of Array.from(this.cells.keys())) {
      let a = this.cells.get(kk);
      if (a === undefined) continue; // wurde in diesem Tick schon bewegt
      const [i, j, k] = decode(kk);

      // 1) Runter in Gravitationsrichtung
      const j2 = j + gdir;
      if (inBounds(i, j2, k)) {
        const dk = key(i, j2, k);
        if (w.grid[dk] === AIR) {
          const below = this.cells.get(dk) || 0;
          if (below === 0) {
            // ganzes Volumen fällt
            this.cells.delete(kk);
            this.cells.set(dk, a);
          } else if (below < CELL_CAP) {
            const pour = Math.min(a, CELL_CAP - below);
            this.cells.set(kk, a - pour);
            this.cells.set(dk, below + pour);
            if (a - pour === 0) this.cells.delete(kk);
          }
          continue;
        }
      }

      // 2) Unten blockiert/voll → seitlich verteilen
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const open = [];
      for (const d of dirs) {
        const ni = i + d[0], nk = k + d[1];
        if (!inBounds(ni, j, nk)) continue;
        const nk2 = key(ni, j, nk);
        if (w.grid[nk2] !== AIR) continue;
        const amt = this.cells.get(nk2);
        if (amt === undefined || amt < CELL_CAP) open.push(nk2);
      }
      if (open.length === 0) {
        // 3) Steht still → kleine Chance zu verdunsten
        if (Math.random() < 0.006) {
          a -= 1;
          if (a <= 0) this.cells.delete(kk);
          else this.cells.set(kk, a);
        }
        continue;
      }
      // bis zu 2 Nachbarn zufällig wählen
      if (open.length > 2) {
        open.splice((Math.random() * open.length) | 0, 1);
        open.splice((Math.random() * open.length) | 0, 1);
      }
      const share = Math.floor(a / open.length);
      let rest = a - share * open.length;
      for (const nk of open) {
        let give = share + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
        const cap = CELL_CAP - (this.cells.get(nk) || 0);
        give = Math.min(give, cap);
        if (give > 0) {
          this.cells.set(nk, (this.cells.get(nk) || 0) + give);
          a -= give;
        }
      }
      if (a <= 0) this.cells.delete(kk);
      else this.cells.set(kk, a);
    }

    // 4) Quellen specken neues Wasser aus
    for (const skk of w.waterSources) {
      if (this.totalAmount() >= MAX_WATER) break;
      const [si, sj, sk] = decode(skk);
      const down = { i: si, j: sj + gdir, k: sk };
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]][(Math.random() * 4) | 0];
      const t = Math.random() < 0.6 ? down : { i: si + side[0], j: sj, k: sk + side[1] };
      this.trySet(t.i, t.j, t.k, 1);
    }
  }

  // Auftrieb + Widerstand für alle dynamischen Blöcke (pro Physik-Step).
  applyBuoyancy() {
    const w = this.world;
    const gdir = w.gdir;
    for (const rec of w.bodies) {
      if (rec.dead) continue;
      const p = rec.body.translation();
      const ci = Math.round(p.x - 0.5), cj = Math.round(p.y - 0.5), ck = Math.round(p.z - 0.5);
      // Nur Wasserschichten unterhalb und auf Höhe der Blockmitte zählen
      // (sonst würden auch Blöcke neben der Pfütze abspringen).
      let n = 0;
      for (let b = -1; b <= 0; b++)
        for (let a = -1; a <= 1; a++)
          for (let c = -1; c <= 1; c++)
            if (this.waterAt(ci + a, cj + b, ck + c)) n++;
      if (n === 0) continue;
      const m = rec.body.mass();
      // Auftrieb: ~2.5 Gewichtseinheiten pro Wasserzelle →
      // Stein (6) sinkt, Eis/Gummi/Holz/TNT (1–3) schwimmen.
      rec.body.addForce({ x: 0, y: -gdir * 2.5 * n * m, z: 0 }, true);
      const v = rec.body.linvel();
      const drag = 6 * n;
      rec.body.addForce({ x: -v.x * drag, y: -v.y * drag * 0.5, z: -v.z * drag }, true);
    }
  }

  clearSphere(cx, cy, cz, r) {
    const r2 = r * r;
    for (const kk of Array.from(this.cells.keys())) {
      const [i, j, k] = decode(kk);
      const dx = i + 0.5 - cx, dy = j + 0.5 - cy, dz = k + 0.5 - cz;
      if (dx * dx + dy * dy + dz * dz < r2) this.cells.delete(kk);
    }
  }
}
