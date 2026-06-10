'use strict';
/* ============ Configuración y datos del juego ============ */

const CFG = {
  TW: 32, TH: 16,          // tamaño del rombo isométrico (px internos)
  HW: 16, HH: 8,           // medio rombo
  CHUNK: 32,               // lado del chunk en casillas
  DAY_LENGTH: 300,         // segundos por día completo
  REACH: 3.4,              // alcance de interacción (casillas)
  PLAYER_SPEED: 4.4,       // casillas/segundo
  WATER_SPEED: 0.45,       // factor de velocidad en agua
  PLAYER_MAXHP: 10,
  HIT_COOLDOWN: 0.32,      // segundos entre golpes
  MOB_CAP: 9,              // babas simultáneas máximas
  CUBE_H: 12,              // altura visual de los muros (px)
  SAVE_KEY: 'pixelrealm.save.v1',
  AUTOSAVE: 30,            // segundos entre autoguardados
};

// --- Suelos ---
const T = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, DIRT: 4, STONE: 5, SNOW: 6, FLOOR: 7 };

// --- Objetos del mundo ---
const O = {
  NONE: 0, TREE: 1, PINE: 2, CACTUS: 3, ROCK: 4, FLOWER: 5, TALLGRASS: 6, BUSH: 7,
  WALLW: 8, WALLS: 9, TORCH: 10, FIRE: 11,
};

// drops: [item, cantidad, probabilidad]
const OBJ = {
  [O.TREE]:      { name: 'Árbol', hp: 5, solid: true, tool: 'axe', drops: [['wood', 3, 1], ['stick', 1, 0.5]] },
  [O.PINE]:      { name: 'Pino', hp: 5, solid: true, tool: 'axe', drops: [['wood', 2, 1], ['stick', 2, 0.6]] },
  [O.CACTUS]:    { name: 'Cactus', hp: 3, solid: true, tool: 'sword', drops: [['fiber', 2, 1]] },
  [O.ROCK]:      { name: 'Roca', hp: 8, solid: true, tool: 'pick', drops: [['stone', 3, 1]] },
  [O.FLOWER]:    { name: 'Flor', hp: 1, solid: false, tool: null, drops: [['fiber', 1, 0.6]] },
  [O.TALLGRASS]: { name: 'Hierba alta', hp: 1, solid: false, tool: null, drops: [['fiber', 1, 0.9]] },
  [O.BUSH]:      { name: 'Arbusto de bayas', hp: 2, solid: false, tool: null, drops: [['berry', 2, 1], ['fiber', 1, 0.7]] },
  [O.WALLW]:     { name: 'Muro de madera', hp: 6, solid: true, tool: 'axe', drops: [['wallw', 1, 1]] },
  [O.WALLS]:     { name: 'Muro de piedra', hp: 10, solid: true, tool: 'pick', drops: [['walls', 1, 1]] },
  [O.TORCH]:     { name: 'Antorcha', hp: 1, solid: false, tool: null, drops: [['torch', 1, 1]], light: 4.5 },
  [O.FIRE]:      { name: 'Fogata', hp: 3, solid: true, tool: null, drops: [['campfire', 1, 1]], light: 6.5 },
};

// --- Objetos de inventario ---
const ITEMS = {
  wood:     { name: 'Madera', stack: 99 },
  stone:    { name: 'Piedra', stack: 99 },
  fiber:    { name: 'Fibra', stack: 99 },
  berry:    { name: 'Bayas', stack: 99, food: 2 },
  slime:    { name: 'Baba', stack: 99 },
  plank:    { name: 'Tablón', stack: 99 },
  stick:    { name: 'Palo', stack: 99 },
  axe:      { name: 'Hacha', stack: 1, tool: 'axe', dmg: 2 },
  pick:     { name: 'Pico', stack: 1, tool: 'pick', dmg: 2 },
  sword:    { name: 'Espada', stack: 1, tool: 'sword', dmg: 3 },
  torch:    { name: 'Antorcha', stack: 99, place: O.TORCH },
  campfire: { name: 'Fogata', stack: 99, place: O.FIRE },
  wallw:    { name: 'Muro de madera', stack: 99, place: O.WALLW },
  walls:    { name: 'Muro de piedra', stack: 99, place: O.WALLS },
};

const RECIPES = [
  { out: 'plank', n: 4, cost: { wood: 1 } },
  { out: 'stick', n: 4, cost: { plank: 2 } },
  { out: 'axe', n: 1, cost: { plank: 3, stick: 2 } },
  { out: 'pick', n: 1, cost: { plank: 3, stick: 2 } },
  { out: 'sword', n: 1, cost: { plank: 2, stick: 1 } },
  { out: 'torch', n: 2, cost: { stick: 1, fiber: 1 } },
  { out: 'campfire', n: 1, cost: { wood: 3, stone: 2 } },
  { out: 'wallw', n: 2, cost: { plank: 4 } },
  { out: 'walls', n: 2, cost: { stone: 4 } },
];

// Colores del minimapa por tipo de suelo
const MINIMAP_COLORS = {
  [T.DEEP]: '#1d3a78', [T.WATER]: '#2f5fb0', [T.SAND]: '#e3cd8b', [T.GRASS]: '#4f9c3e',
  [T.DIRT]: '#8a6242', [T.STONE]: '#8c8c94', [T.SNOW]: '#e9f1f4', [T.FLOOR]: '#a87b4f',
};

// Color de las partículas al golpear cada objeto
const PART_COLOR = {
  [O.TREE]: '#4e9a3d', [O.PINE]: '#2f6b3e', [O.CACTUS]: '#3f9e4f', [O.ROCK]: '#9a9aa4',
  [O.FLOWER]: '#e886a8', [O.TALLGRASS]: '#5fb84d', [O.BUSH]: '#c4344c',
  [O.WALLW]: '#8a5a33', [O.WALLS]: '#8c8c94', [O.TORCH]: '#ffb347', [O.FIRE]: '#ff8c2e',
};
