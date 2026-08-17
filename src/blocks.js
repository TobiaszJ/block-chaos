// Block-Typen: Werte 1..6 stehen im Voxel-Grid, 7 = Wasserquelle.
export const AIR = 0;
export const GROUND = 1;
export const WOOD = 2;
export const STONE = 3;
export const ICE = 4;
export const GUMMY = 5;
export const TNT = 6;
export const WATER_SRC = 7;
export const CANNON = 8;
export const BLACKHOLE = 9;
export const BALLOON = 10;
export const CHAIN = 11;

// Eigentliche Physik-Parameter (mass = Dichte des 1m³-Blocks)
export const BLOCKS = {
  [WOOD]:  { name: 'Holz',  mass: 1.6, friction: 0.65,  restitution: 0.18, color: 0xd7a05e, roughness: 0.65 },
  [STONE]: { name: 'Stein', mass: 6.0, friction: 0.95,  restitution: 0.08, color: 0x9aa7cf, roughness: 0.4 },
  [ICE]:   { name: 'Eis',   mass: 3.0, friction: 0.015, restitution: 0.2,  color: 0xbfe8ff, roughness: 0.08 },
  [GUMMY]: { name: 'Gummi', mass: 1.0, friction: 0.4,   restitution: 0.96, color: 0xff5a8a, roughness: 0.2 },
  [TNT]:   { name: 'TNT',   mass: 2.0, friction: 0.7,   restitution: 0.1,  color: 0xff4433, roughness: 0.25 },
  [CANNON]:    { name: 'Kanone',   mass: 9.0, friction: 0.9, restitution: 0.05, color: 0x39415a, roughness: 0.35 },
  [BLACKHOLE]: { name: 'S. Loch',  mass: 5.0, friction: 0.8, restitution: 0.1,  color: 0x150a26, roughness: 0.15 },
  [BALLOON]:   { name: 'Ballon',   mass: 0.06, friction: 0.08, restitution: 0.3, color: 0xff5d8f, roughness: 0.12 },
  [CHAIN]:     { name: 'Kette',    mass: 4.0, friction: 0.3,  restitution: 0.05, color: 0x8f9bb3, roughness: 0.35 },
};

// Reihenfolge der Leiste 1..8
// Reihenfolge der Leiste 1..9,0
export const PLACEABLE = [WOOD, STONE, ICE, GUMMY, TNT, WATER_SRC, CANNON, BLACKHOLE, BALLOON, CHAIN];
export const SLOT_NAMES = { [WATER_SRC]: 'Wasser', [BLACKHOLE]: 'S. Loch', [CHAIN]: 'Kette' };

// TNT explodiert, wenn die Relativgeschwindigkeit beim Kontakt darüber liegt (m/s)
export const TNT_EXPLODE_SPEED = 5.0;

export function slotName(id) {
  return SLOT_NAMES[id] || BLOCKS[id].name;
}
