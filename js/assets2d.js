'use strict';
/* ============ Assets externos del modo 2D (CC0) ============
   Carga imágenes (personaje + tilesets) para el modo lateral.
   Créditos en CREDITS.md (0x72 · Pixel Frog · Senmou, todos CC0). */

const Assets2D = {
  ready: false,
  img: {},
  manifest: {
    // personaje: enano minero (0x72 DungeonTileset II, frames 16x28)
    dIdle0: 'assets/char/dwarf/idle_anim_f0.png', dIdle1: 'assets/char/dwarf/idle_anim_f1.png',
    dIdle2: 'assets/char/dwarf/idle_anim_f2.png', dIdle3: 'assets/char/dwarf/idle_anim_f3.png',
    dRun0: 'assets/char/dwarf/run_anim_f0.png', dRun1: 'assets/char/dwarf/run_anim_f1.png',
    dRun2: 'assets/char/dwarf/run_anim_f2.png', dRun3: 'assets/char/dwarf/run_anim_f3.png',
    dHit0: 'assets/char/dwarf/hit_anim_f0.png',
    // tilesets
    terrain: 'assets/tiles/terrain.png',                                            // atlas 22x11 (16px) Pixel Frog
    oreRocks: 'assets/tiles/ore/Stone_ore_gems/Stones_ores_gems_without_grass.png', // 7x9 (16px) Senmou
    // props y NPCs coherentes (PixelLab)
    tree_oak: 'assets/pl/tree_oak.png', tree_pine: 'assets/pl/tree_pine.png', tree_jungle: 'assets/pl/tree_jungle.png',
    bush: 'assets/pl/bush.png', rock: 'assets/pl/rock.png',
    npc1: 'assets/pl/npc_villager.png', npc2: 'assets/pl/npc_elder.png',
    dino_raptor: 'assets/pl/dino_raptor.png', dino_rex: 'assets/pl/dino_rex.png', dino_bronto: 'assets/pl/dino_bronto.png',
    dino_stego: 'assets/pl/dino_stego.png', dino_trike: 'assets/pl/dino_trike.png', dino_guardian: 'assets/pl/dino_guardian.png',
    hero_idle: 'assets/pl/hero_idle.png', hero_run1: 'assets/pl/hero_run1.png', hero_run2: 'assets/pl/hero_run2.png', hero_jump: 'assets/pl/hero_jump.png',
    bg_mountains: 'assets/pl/bg_mountains.png', bg_hills: 'assets/pl/bg_hills.png',
  },
  load(cb) {
    const keys = Object.keys(this.manifest);
    let n = keys.length, done = 0;
    const fin = () => { if (++done >= n) { this.ready = true; cb && cb(); } };
    for (const k of keys) {
      const im = new Image();
      im.onload = fin;
      im.onerror = () => { console.warn('Assets2D: no se pudo cargar', this.manifest[k]); fin(); };
      im.src = this.manifest[k];
      this.img[k] = im;
    }
  },
};

// animaciones del personaje (frames individuales 16x28)
const CHAR_ANIM = {
  idle: { keys: ['dIdle0', 'dIdle1', 'dIdle2', 'dIdle3'], fps: 7 },
  run:  { keys: ['dRun0', 'dRun1', 'dRun2', 'dRun3'], fps: 12 },
  jump: { keys: ['dRun1'], fps: 1 },   // el enano no trae salto: reusamos una pose de carrera
  fall: { keys: ['dRun3'], fps: 1 },
  hit:  { keys: ['dHit0'], fps: 1 },
};
const CHAR_FW = 16, CHAR_FH = 28;   // tamaño de frame fuente (dwarf CC0)
// héroe PixelLab (frames individuales): se usa si están cargados, si no cae al dwarf CC0
const CHAR_ANIM_PL = {
  idle: { keys: ['hero_idle'], fps: 2 },
  run:  { keys: ['hero_run1', 'hero_run2'], fps: 8 },
  jump: { keys: ['hero_jump'], fps: 1 },
  fall: { keys: ['hero_jump'], fps: 1 },
  hit:  { keys: ['hero_idle'], fps: 1 },
};

// material -> celda (col,row) del atlas de terreno (tiles base sólidos)
const TILE_SRC = {
  [T.GRASS]: { c: 7, r: 0 },   // hierba sobre tierra
  [T.DIRT]:  { c: 7, r: 1 },   // tierra sólida
  [T.STONE]: { c: 13, r: 4 },  // piedra
  [T.SAND]:  { c: 7, r: 4 },   // tierra otoñal (arena)
};
