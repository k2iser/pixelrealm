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
  MOB_CAP: 10,             // enemigos simultáneos máximos
  CUBE_H: 12,              // altura visual de los muros (px)
  SAVE_KEY: 'pixelrealm.save.v1',  // los guardados antiguos siguen cargando: los campos nuevos son opcionales
  AUTOSAVE: 30,            // segundos entre autoguardados
  BOSS_NIGHT_EVERY: 3,     // cada cuántas noches viene el Coloso
  TOWER_ACTIVE_R: 26,      // radio en que las torres están activas alrededor de un jugador
  DROP_TTL: 180,           // segundos de vida de un objeto en el suelo
};

// --- Suelos ---
const T = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, DIRT: 4, STONE: 5, SNOW: 6, FLOOR: 7 };

// --- Objetos del mundo ---
const O = {
  NONE: 0, TREE: 1, PINE: 2, CACTUS: 3, ROCK: 4, FLOWER: 5, TALLGRASS: 6, BUSH: 7,
  WALLW: 8, WALLS: 9, TORCH: 10, FIRE: 11,
  // construcciones prefab (las de size 2 ocupan 2x2 casillas con O.PART)
  HUT: 12, TOWER: 13, SAWMILL: 14, QUARRY: 15, FARM: 16, BRAZIER: 17, ALTAR: 18,
  PART: 19, // casilla secundaria de un edificio 2x2 (invisible, sólida)
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

  // --- construcciones ---
  [O.HUT]:     { name: 'Cabaña', hp: 14, solid: true, tool: 'axe', size: 2, home: true,
                 drops: [['plank', 4, 1], ['stone', 1, 1]] },
  [O.TOWER]:   { name: 'Torre arquera', hp: 12, solid: true, tool: 'axe', size: 1,
                 tower: { range: 6.5, rate: 1.15, dmg: 2 },
                 drops: [['plank', 3, 1], ['stone', 2, 1]] },
  [O.SAWMILL]: { name: 'Aserradero', hp: 12, solid: true, tool: 'axe', size: 2,
                 prod: { item: 'wood', per: 40, cap: 6 },
                 drops: [['plank', 3, 1], ['stone', 1, 1]] },
  [O.QUARRY]:  { name: 'Cantera', hp: 14, solid: true, tool: 'pick', size: 2,
                 prod: { item: 'stone', per: 55, cap: 5 },
                 drops: [['plank', 2, 1], ['stone', 3, 1]] },
  [O.FARM]:    { name: 'Huerto de bayas', hp: 8, solid: true, tool: 'axe', size: 2,
                 prod: { item: 'berry', per: 45, cap: 8 },
                 drops: [['plank', 2, 1], ['fiber', 3, 1]] },
  [O.BRAZIER]: { name: 'Brasero', hp: 8, solid: true, tool: 'pick', size: 1, light: 8,
                 drops: [['stone', 2, 1], ['wood', 1, 1]] },
  [O.ALTAR]:   { name: 'Altar antiguo', hp: 20, solid: true, tool: 'pick', size: 2,
                 altar: true, light: 3.5, lightColor: '#a070ff',
                 drops: [['stone', 6, 1], ['essence', 1, 1]] },
  [O.PART]:    { name: '', hp: 1, solid: true, tool: null, drops: [], part: true },
};

// --- Objetos de inventario ---
const ITEMS = {
  wood:     { name: 'Madera', stack: 99 },
  stone:    { name: 'Piedra', stack: 99 },
  fiber:    { name: 'Fibra', stack: 99 },
  berry:    { name: 'Bayas', stack: 99, food: 2 },
  slime:    { name: 'Baba', stack: 99 },
  essence:  { name: 'Esencia oscura', stack: 99 },
  crown:    { name: 'Corona del Coloso', stack: 9 },
  plank:    { name: 'Tablón', stack: 99 },
  stick:    { name: 'Palo', stack: 99 },
  axe:      { name: 'Hacha', stack: 1, tool: 'axe', dmg: 2 },
  pick:     { name: 'Pico', stack: 1, tool: 'pick', dmg: 2 },
  sword:    { name: 'Espada', stack: 1, tool: 'sword', dmg: 3 },
  torch:    { name: 'Antorcha', stack: 99, place: O.TORCH },
  campfire: { name: 'Fogata', stack: 99, place: O.FIRE },
  wallw:    { name: 'Muro de madera', stack: 99, place: O.WALLW },
  walls:    { name: 'Muro de piedra', stack: 99, place: O.WALLS },
  hut:      { name: 'Cabaña', stack: 9, place: O.HUT },
  tower:    { name: 'Torre arquera', stack: 9, place: O.TOWER },
  sawmill:  { name: 'Aserradero', stack: 9, place: O.SAWMILL },
  quarry:   { name: 'Cantera', stack: 9, place: O.QUARRY },
  farm:     { name: 'Huerto de bayas', stack: 9, place: O.FARM },
  brazier:  { name: 'Brasero', stack: 9, place: O.BRAZIER },
  altar:    { name: 'Altar antiguo', stack: 9, place: O.ALTAR },
};

// cat: 'item' aparece en Fabricación, 'build' en Construcciones
const RECIPES = [
  { out: 'plank', n: 4, cost: { wood: 1 }, cat: 'item' },
  { out: 'stick', n: 4, cost: { plank: 2 }, cat: 'item' },
  { out: 'axe', n: 1, cost: { plank: 3, stick: 2 }, cat: 'item' },
  { out: 'pick', n: 1, cost: { plank: 3, stick: 2 }, cat: 'item' },
  { out: 'sword', n: 1, cost: { plank: 2, stick: 1 }, cat: 'item' },
  { out: 'torch', n: 2, cost: { stick: 1, fiber: 1 }, cat: 'item' },
  { out: 'campfire', n: 1, cost: { wood: 3, stone: 2 }, cat: 'item' },
  { out: 'wallw', n: 2, cost: { plank: 4 }, cat: 'item' },
  { out: 'walls', n: 2, cost: { stone: 4 }, cat: 'item' },

  { out: 'hut', n: 1, cost: { plank: 8, stone: 2 }, cat: 'build',
    desc: 'Fija tu punto de reaparición' },
  { out: 'tower', n: 1, cost: { plank: 6, stone: 4 }, cat: 'build',
    desc: 'Dispara flechas a los monstruos cercanos' },
  { out: 'sawmill', n: 1, cost: { plank: 6, stone: 2 }, cat: 'build',
    desc: 'Produce madera con el tiempo (clic der. para recoger)' },
  { out: 'quarry', n: 1, cost: { plank: 4, stone: 6 }, cat: 'build',
    desc: 'Produce piedra con el tiempo' },
  { out: 'farm', n: 1, cost: { plank: 4, fiber: 8, berry: 2 }, cat: 'build',
    desc: 'Cultiva bayas con el tiempo' },
  { out: 'brazier', n: 1, cost: { stone: 4, wood: 2, fiber: 2 }, cat: 'build',
    desc: 'Gran círculo de luz nocturna' },
  { out: 'altar', n: 1, cost: { stone: 12, essence: 3, slime: 5 }, cat: 'build',
    desc: 'Invoca al Coloso de Baba (clic der.)' },
];

// --- Enemigos ---
const MOBS = {
  slime:  { name: 'Baba', hp: 4, dmg: 1, ai: 'hop', speed: 3.4, weight: 0.55,
            drops: [['slime', 1, 1], ['slime', 1, 0.4]] },
  shadow: { name: 'Sombra', hp: 6, dmg: 2, ai: 'walk', speed: 2.1, weight: 0.27,
            drops: [['essence', 1, 1], ['fiber', 1, 0.4]] },
  bat:    { name: 'Murciélago', hp: 2, dmg: 1, ai: 'fly', speed: 3.8, weight: 0.18,
            drops: [['fiber', 1, 0.5]] },
};

const BOSS_CFG = {
  name: 'El Coloso de Baba',
  hp: 80,            // base; en multijugador el servidor escala por jugadores
  dmg: 2,            // daño de la onda al aterrizar
  slamRadius: 2.0,   // radio de la onda expansiva (casillas)
  hopTime: 0.55,     // duración del salto
  hopSpeed: 4.2,
  minionEvery: 11,   // segundos entre oleadas de esbirros
  enrageAt: 0.3,     // fracción de vida para enfurecerse
  hitbox: 1.6,       // radio para golpearlo con el cursor
  loot: [['slime', 12, 1], ['berry', 6, 1], ['essence', 4, 1], ['crown', 1, 1]],
};

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
  [O.HUT]: '#a87b4f', [O.TOWER]: '#9a9aa4', [O.SAWMILL]: '#a87b4f', [O.QUARRY]: '#8c8c94',
  [O.FARM]: '#5fb84d', [O.BRAZIER]: '#ffb347', [O.ALTAR]: '#a070ff',
};
