'use strict';
/* ============ Configuración y datos del juego ============ */

const CFG = {
  TW: 64, TH: 32,          // tamaño del rombo isométrico (px internos) — doble resolución v3
  HW: 32, HH: 16,          // medio rombo
  SPR: 4,                  // factor de escalado de los sprites de rejilla del mundo
  CHUNK: 32,               // lado del chunk en casillas
  DAY_LENGTH: 300,         // segundos por día completo
  REACH: 3.4,              // alcance de interacción (casillas)
  PLAYER_SPEED: 4.4,       // casillas/segundo
  WATER_SPEED: 0.45,       // factor de velocidad en agua
  PLAYER_MAXHP: 10,
  HIT_COOLDOWN: 0.32,      // segundos entre golpes
  MOB_CAP: 10,             // enemigos simultáneos máximos
  CUBE_H: 24,              // altura visual de los muros (px)
  SAVE_KEY: 'pixelrealm.save.v1',  // los guardados antiguos siguen cargando: los campos nuevos son opcionales
  AUTOSAVE: 30,            // segundos entre autoguardados
  BOSS_NIGHT_EVERY: 3,     // cada cuántas noches viene el Coloso
  BOSS_ENABLED: false,     // el Coloso está retirado por ahora (código dormido)
  TOWER_ACTIVE_R: 26,      // radio en que las torres están activas alrededor de un jugador
  DROP_TTL: 180,           // segundos de vida de un objeto en el suelo
  CREATIVE_REACH: 8,       // alcance ampliado en modo creativo
  ARRIVE_DIST: 0.22,       // distancia para considerar alcanzado un punto del camino
  NPC_TALK_R: 2.2,         // radio para hablar con un comerciante
  MAX_DPR: 2,              // tope de densidad de píxel del render HD (limita el fill-rate)
  MAX_PIXELS: 3500000,     // presupuesto de píxeles del backing-store (acota fill-rate en 4K/HiDPI)
  GFX: 2,                  // calidad gráfica: 0 básico · 1 medio · 2 alto (bloom, tilt-shift, agua avanzada)
  TILT: true,              // tilt-shift de maqueta (requiere GFX>=2; false = bloom sin maqueta)
  // --- salto (eje z de altura, estilo action-platformer) ---
  JUMP_V0: 10.5,           // velocidad inicial del salto (unidades/s en el eje z)
  GRAV: 34,                // gravedad del eje z (unidades/s²) → vuelo ~0.6 s, ápice ~1.6 ud
  ZK: 20,                  // px de pantalla por unidad de altura z (igual que los drops)
  COYOTE: 0.08,            // margen para saltar justo tras dejar el suelo
  JUMP_BUFFER: 0.10,       // margen para bufferar el salto pulsado antes de aterrizar
  JUMP_REACH_Z: 0.35,      // altura mínima para sobrevolar agua/huecos (traversal)
  // --- modo 2D lateral (tipo Terraria) ---
  TS: 22,                  // tamaño de tile en px de pantalla (modo 2D)
  G2D_GRAV: 46,            // gravedad lateral (tiles/s²)
  G2D_JUMP: 15.5,          // impulso de salto lateral (tiles/s)
  G2D_MAXFALL: 26,         // velocidad de caída máxima
  G2D_ACCEL: 60, G2D_FRIC: 50,  // aceleración / frenado horizontal (tiles/s²)
};

// --- Suelos --- (AIR/COAL_ORE/IRON_ORE/BEDROCK son del modo 2D)
const T = { DEEP: 0, WATER: 1, SAND: 2, GRASS: 3, DIRT: 4, STONE: 5, SNOW: 6, FLOOR: 7, TILLED: 8, AIR: 9, COAL_ORE: 10, IRON_ORE: 11, BEDROCK: 12, TORCH: 13, GATE: 14, CRYSTAL: 15, WOOD: 16, BRICK: 17, PLATFORM: 18, CHEST: 19, CHEST_OPEN: 20 };

// Materiales del modo 2D: sólido, dureza, herramienta y drops (reusa ITEMS)
const TDEF = {
  [T.AIR]:      { solid: false },
  [T.GRASS]:    { solid: true, hp: 3, tool: null, drops: [['dirt', 1, 1]] },
  [T.DIRT]:     { solid: true, hp: 3, tool: null, drops: [['dirt', 1, 1]] },
  [T.STONE]:    { solid: true, hp: 7, tool: 'pick', drops: [['stone', 1, 1]] },
  [T.COAL_ORE]: { solid: true, hp: 8, tool: 'pick', drops: [['coal', 1, 1], ['stone', 1, 0.3]] },
  [T.IRON_ORE]: { solid: true, hp: 10, tool: 'pick', drops: [['iron_ore', 1, 1], ['stone', 1, 0.3]] },
  [T.SAND]:     { solid: true, hp: 2, tool: null, drops: [['dirt', 1, 1]] },
  [T.BEDROCK]:  { solid: true, hp: Infinity, tool: 'pick', drops: [] },
  // antorcha: no sólida, emite luz; se quita al instante y se recupera
  [T.TORCH]:    { solid: false, light: 6.5, hp: 0.12, tool: null, drops: [['torch', 1, 1]] },
  // Puerta Abisal: estructura no sólida que se INVOCA (clic derecho) para descender un estrato
  [T.GATE]:     { solid: false, light: 5.5, hp: 0.4, tool: null, drops: [['gate', 1, 1]] },
  // Cristal abisal: mineral profundo, valioso y luminoso
  [T.CRYSTAL]:  { solid: true, light: 4.5, hp: 12, tool: 'pick', drops: [['crystal', 1, 1], ['stone', 1, 0.4]] },
  // materiales de construcción (estructuras y colocables del jugador)
  [T.WOOD]:     { solid: true, hp: 4, tool: 'axe', drops: [['wood', 1, 1]] },
  [T.BRICK]:    { solid: true, hp: 9, tool: 'pick', drops: [['stone', 1, 1]] },
  [T.PLATFORM]: { solid: true, hp: 3, tool: 'axe', drops: [['wood', 1, 1]] },
  // cofre: no sólido, no se pica (se abre con clic derecho); su versión abierta es decorativa
  [T.CHEST]:      { solid: false },
  [T.CHEST_OPEN]: { solid: false },
};
// item -> material que coloca (para construir en 2D con el clic derecho)
const PLACE2D = { dirt: T.DIRT, stone: T.STONE, walls: T.BRICK, wallw: T.WOOD, plank: T.WOOD, wood: T.WOOD, torch: T.TORCH, gate: T.GATE };

// --- Objetos del mundo ---
const O = {
  NONE: 0, TREE: 1, PINE: 2, CACTUS: 3, ROCK: 4, FLOWER: 5, TALLGRASS: 6, BUSH: 7,
  WALLW: 8, WALLS: 9, TORCH: 10, FIRE: 11,
  // construcciones prefab (las de size 2 ocupan 2x2 casillas con O.PART)
  HUT: 12, TOWER: 13, SAWMILL: 14, QUARRY: 15, FARM: 16, BRAZIER: 17, ALTAR: 18,
  PART: 19, // casilla secundaria de un edificio 2x2 (invisible, sólida)
  WELL: 20, // pozo de aldea (decorativo, sólido)
  CROP0: 21, CROP1: 22, CROP2: 23, CROP3: 24, // cultivo: 4 fases de crecimiento
  FURNACE: 25, ROCK_COAL: 26, ROCK_IRON: 27,  // horno y rocas con mineral (montaña)
};
const CROP_SECS = 28;   // segundos por fase de crecimiento (madura en ~84 s)

// drops: [item, cantidad, probabilidad]
const OBJ = {
  [O.TREE]:      { name: 'Árbol', hp: 5, solid: true, tool: 'axe', drops: [['wood', 3, 1], ['stick', 1, 0.5]] },
  [O.PINE]:      { name: 'Pino', hp: 5, solid: true, tool: 'axe', drops: [['wood', 2, 1], ['stick', 2, 0.6]] },
  [O.CACTUS]:    { name: 'Cactus', hp: 3, solid: true, tool: 'sword', drops: [['fiber', 2, 1]] },
  [O.ROCK]:      { name: 'Roca', hp: 8, solid: true, tool: 'pick', drops: [['stone', 3, 1]] },
  [O.FLOWER]:    { name: 'Flor', hp: 1, solid: false, tool: null, drops: [['fiber', 1, 0.6]] },
  [O.TALLGRASS]: { name: 'Hierba alta', hp: 1, solid: false, tool: null, drops: [['fiber', 1, 0.9], ['seeds', 1, 0.4]] },
  [O.BUSH]:      { name: 'Arbusto de bayas', hp: 2, solid: false, tool: null, drops: [['berry', 2, 1], ['fiber', 1, 0.7], ['seeds', 1, 0.5]] },
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
  [O.WELL]:    { name: 'Pozo', hp: 30, solid: true, tool: 'pick', size: 1, light: 2.5,
                 drops: [['stone', 4, 1]] },
  [O.CROP0]:   { name: 'Brote', hp: 1, solid: false, tool: null, crop: 0, drops: [['seeds', 1, 1]] },
  [O.CROP1]:   { name: 'Plantón', hp: 1, solid: false, tool: null, crop: 1, drops: [['seeds', 1, 1]] },
  [O.CROP2]:   { name: 'Cultivo', hp: 1, solid: false, tool: null, crop: 2, drops: [['seeds', 1, 1]] },
  [O.CROP3]:   { name: 'Cultivo maduro', hp: 1, solid: false, tool: null, crop: 3,
                 drops: [['berry', 3, 1], ['seeds', 1, 0.8]] },
  [O.ROCK_COAL]: { name: 'Veta de carbón', hp: 9, solid: true, tool: 'pick',
                   drops: [['stone', 2, 1], ['coal', 2, 1], ['coal', 1, 0.5]] },
  [O.ROCK_IRON]: { name: 'Veta de hierro', hp: 11, solid: true, tool: 'pick',
                   drops: [['stone', 2, 1], ['iron_ore', 2, 1], ['iron_ore', 1, 0.4]] },
  [O.FURNACE]: { name: 'Horno', hp: 16, solid: true, tool: 'pick', size: 1, furnace: true, light: 3.5,
                 lightColor: '#ff8c2e', drops: [['stone', 6, 1]] },
};

// --- Objetos de inventario ---
const ITEMS = {
  wood:     { name: 'Madera', stack: 99 },
  dirt:     { name: 'Tierra', stack: 99 },
  stone:    { name: 'Piedra', stack: 99 },
  meat:     { name: 'Carne', stack: 99 },
  leather:  { name: 'Cuero', stack: 99 },
  bone:     { name: 'Hueso', stack: 99 },
  crystal:  { name: 'Cristal abisal', stack: 99 },
  core:     { name: 'Núcleo de Vethrún', stack: 10 },
  gate:     { name: 'Puerta Abisal', stack: 10, place: true },
  coal:     { name: 'Carbón', stack: 99 },
  iron_ore: { name: 'Mineral de hierro', stack: 99 },
  iron:     { name: 'Lingote de hierro', stack: 99 },
  fiber:    { name: 'Fibra', stack: 99 },
  berry:    { name: 'Bayas', stack: 99, food: 2 },
  meat:     { name: 'Carne', stack: 99, food: 2 },
  cooked_meat: { name: 'Carne asada', stack: 99, food: 5 },
  seeds:    { name: 'Semillas', stack: 99, plant: true },
  hoe:      { name: 'Azada', stack: 1, tool: 'hoe', dmg: 1 },
  slime:    { name: 'Baba', stack: 99 },
  essence:  { name: 'Esencia oscura', stack: 99 },
  crown:    { name: 'Corona del Coloso', stack: 9 },
  coin:     { name: 'Moneda', stack: 999 },
  plank:    { name: 'Tablón', stack: 99 },
  stick:    { name: 'Palo', stack: 99 },
  axe:      { name: 'Hacha', stack: 1, tool: 'axe', dmg: 2 },
  pick:     { name: 'Pico', stack: 1, tool: 'pick', dmg: 2 },
  sword:    { name: 'Espada', stack: 1, tool: 'sword', dmg: 3 },
  iron_axe:   { name: 'Hacha de hierro', stack: 1, tool: 'axe', dmg: 4 },
  iron_pick:  { name: 'Pico de hierro', stack: 1, tool: 'pick', dmg: 4 },
  iron_sword: { name: 'Espada de hierro', stack: 1, tool: 'sword', dmg: 5 },
  furnace:  { name: 'Horno', stack: 9, place: O.FURNACE },
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
  { out: 'hoe', n: 1, cost: { plank: 2, stick: 2 }, cat: 'item', desc: 'Ara la tierra para plantar semillas' },
  { out: 'torch', n: 2, cost: { stick: 1, fiber: 1 }, cat: 'item' },
  { out: 'gate', n: 1, cost: { stone: 8, wood: 4, iron_ore: 2 }, cat: 'item', desc: 'Puerta Abisal: colócala y haz clic derecho sobre ella para descender un estrato' },
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
  { out: 'furnace', n: 1, cost: { stone: 8 }, cat: 'build',
    desc: 'Funde mineral de hierro (necesita carbón). Clic para fundir' },

  { out: 'iron_axe', n: 1, cost: { iron: 3, stick: 2 }, cat: 'item', desc: 'Tala más rápido' },
  { out: 'iron_pick', n: 1, cost: { iron: 3, stick: 2 }, cat: 'item', desc: 'Pica más rápido' },
  { out: 'iron_sword', n: 1, cost: { iron: 2, stick: 1 }, cat: 'item', desc: 'Más daño en combate' },
];

// --- Enemigos ---
const MOBS = {
  slime:  { name: 'Baba', hp: 4, dmg: 1, ai: 'hop', speed: 3.4, weight: 0.55,
            drops: [['slime', 1, 1], ['slime', 1, 0.4]] },
  shadow: { name: 'Sombra', hp: 6, dmg: 2, ai: 'walk', speed: 2.1, weight: 0.27,
            drops: [['essence', 1, 1], ['fiber', 1, 0.4]] },
  bat:    { name: 'Murciélago', hp: 2, dmg: 1, ai: 'fly', speed: 3.8, weight: 0.18,
            drops: [['fiber', 1, 0.5]] },
  // fauna pasiva diurna (weight 0 = nunca aparece como enemigo nocturno)
  rabbit: { name: 'Conejo', hp: 3, dmg: 0, ai: 'graze', speed: 3.8, weight: 0, passive: true, diurnal: true, fleeR: 6,
            drops: [['meat', 1, 1]] },
  deer:   { name: 'Ciervo', hp: 6, dmg: 0, ai: 'graze', speed: 3.2, weight: 0, passive: true, diurnal: true, fleeR: 8,
            drops: [['meat', 2, 1], ['fiber', 1, 0.4]] },
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

// --- Comerciantes (NPCs) y aldeas ---
const VILLAGE_RARITY = 0.022;   // ~1 de cada ~45 chunks candidatos esconde una aldea
const NPC_NAMES = ['Mira', 'Tobías', 'Elara', 'Bran', 'Nadia', 'Olmo', 'Sela', 'Garr',
                   'Ivy', 'Kael', 'Rosa', 'Doran', 'Yara', 'Finn', 'Lena', 'Hugo'];

// goods: pares [item, precio en monedas]. sells = la NPC te vende; buys = te compra.
const NPC_ROLES = [
  { key: 'herbalist', title: 'Herborista', shirt: 5, hair: 2, wants: ['fiber', 'berry'],
    persona: 'una herborista amable y dicharachera que adora las plantas, las bayas y los remedios naturales',
    sells: [['berry', 3], ['fiber', 2]], buys: [['fiber', 1], ['berry', 2]],
    lines: ['Las bayas frescas curan el cuerpo y el ánimo.',
            'Si plantas fibra cerca del agua, crece el doble de rápido.',
            'El bosque siempre da, si sabes pedirlo con respeto.'] },
  { key: 'mason', title: 'Cantero', shirt: 4, hair: 4, wants: ['stone'],
    persona: 'un cantero rudo pero honesto, de pocas palabras, orgulloso de su piedra y sus muros',
    sells: [['stone', 4], ['walls', 7], ['pick', 38]], buys: [['stone', 2]],
    lines: ['La piedra bien puesta dura mil años.',
            'Un muro de piedra aguanta lo que tres de madera.',
            '¿Vas a las montañas? Llévate un buen pico.'] },
  { key: 'carpenter', title: 'Carpintero', shirt: 2, hair: 0, wants: ['wood', 'plank'],
    persona: 'un carpintero meticuloso y tranquilo que habla de la madera con cariño de artesano',
    sells: [['plank', 2], ['wood', 3], ['axe', 38], ['campfire', 9]], buys: [['wood', 1], ['plank', 2]],
    lines: ['Cada tabla tiene su veta; hay que respetarla.',
            'Con cuatro tablones y dos palos te haces un hacha decente.',
            'Una fogata bien hecha espanta el frío y a las babas.'] },
  { key: 'trader', title: 'Mercader', shirt: 0, hair: 3, wants: ['slime', 'essence', 'berry'],
    persona: 'un mercader viajero astuto y simpático que ha recorrido mundo y siempre tiene una historia o un trato a mano',
    sells: [['torch', 3], ['sword', 52], ['campfire', 9]], buys: [['slime', 2], ['essence', 9], ['crown', 250], ['berry', 1]],
    lines: ['Vengo de tierras lejanas, amigo. ¿Buscas algo especial?',
            'Te compro esas babas a buen precio, no preguntes para qué.',
            'Dicen que en las ruinas del este aún arde una antorcha sola…'] },
];

// Colores del minimapa por tipo de suelo
const MINIMAP_COLORS = {
  [T.DEEP]: '#253a5e', [T.WATER]: '#4f8fba', [T.SAND]: '#e8c170', [T.GRASS]: '#468232',
  [T.DIRT]: '#ad7757', [T.STONE]: '#577277', [T.SNOW]: '#ebede9', [T.FLOOR]: '#c09473',
  [T.TILLED]: '#7a4841',
};

// --- Apariencia del héroe (editor de personaje) — rampas Apollo ---
const HERO_COLORS = ['#4f8fba', '#a53030', '#7a367b', '#3c5e8b', '#de9e41', '#75a743', '#a23e8c', '#73bed3'];
const HERO_SKINS = ['#d7b594', '#c09473', '#ad7757', '#884b2b'];
const HERO_HAIRC = ['#4d2b32', '#10141f', '#be772b', '#cf573c', '#577277', '#de9e41'];
const HERO_PANTS = ['#202e37', '#602c2c', '#253a5e', '#411d31'];
const HERO_STYLES = ['Corto', 'Melena', 'Rapado'];
const DEFAULT_LOOK = { skin: 0, hair: 0, style: 0, shirt: 0, pants: 0 };

// Sanea un look recibido (del editor, de localStorage o de la red)
function clampLook(l) {
  const v = (n, max) => Math.min(max, Math.max(0, n | 0));
  l = l || {};
  return {
    skin: v(l.skin, HERO_SKINS.length - 1),
    hair: v(l.hair, HERO_HAIRC.length - 1),
    style: v(l.style, HERO_STYLES.length - 1),
    shirt: v(l.shirt, 7),
    pants: v(l.pants, HERO_PANTS.length - 1),
  };
}

// Color de las partículas al golpear cada objeto
const PART_COLOR = {
  [O.TREE]: '#4e9a3d', [O.PINE]: '#2f6b3e', [O.CACTUS]: '#3f9e4f', [O.ROCK]: '#9a9aa4',
  [O.FLOWER]: '#e886a8', [O.TALLGRASS]: '#5fb84d', [O.BUSH]: '#c4344c',
  [O.WALLW]: '#8a5a33', [O.WALLS]: '#8c8c94', [O.TORCH]: '#ffb347', [O.FIRE]: '#ff8c2e',
  [O.HUT]: '#a87b4f', [O.TOWER]: '#9a9aa4', [O.SAWMILL]: '#a87b4f', [O.QUARRY]: '#8c8c94',
  [O.FARM]: '#5fb84d', [O.BRAZIER]: '#ffb347', [O.ALTAR]: '#a070ff', [O.WELL]: '#819796',
  [O.CROP0]: '#75a743', [O.CROP1]: '#75a743', [O.CROP2]: '#468232', [O.CROP3]: '#a53030',
  [O.ROCK_COAL]: '#394a50', [O.ROCK_IRON]: '#c08552', [O.FURNACE]: '#ff8c2e',
};
