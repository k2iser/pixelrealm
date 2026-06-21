'use strict';
/* ============ Bucle principal, ciclo día/noche e interacciones ============ */

let world = null;

const G = {
  running: false,
  mode: 'iso',      // 'iso' (isométrico) | 'side' (2D lateral tipo Terraria)
  online: false,    // espejo de Net.online para módulos que cargan antes
  zoom: 2,          // 1 lejos · 2 cerca (Stardew) · 3 muy cerca
  renderScale: 2,   // escala lógico→dispositivo (zoom·dpr); el render dibuja en px lógicos
  viewW: 0, viewH: 0, // dimensiones lógicas de render (= innerW/zoom); las usan cámara/cursor
  creative: false,  // modo creativo: recursos infinitos, sin daño, romper al instante
  look: DEFAULT_LOOK,
  time: 0.08,       // fracción del día [0,1)
  day: 1,
  elapsed: 0,
  darkness: 0,
  warm: 0,
  grade: [0, 0, 0, 0],
  veil: [10, 14, 40],
  shake: 0,
  boss: null,
  bossWarned: false,
  bossNightDone: false,   // ya vino esta noche: que no reaparezca en bucle al matarlo
  saveFailWarned: false,
  spawn: { x: 0.5, y: 0.5 },
  spawnTimer: 0,
  wildTimer: 0,
  saveTimer: 0,
  minimapTimer: 0,
  beaconT: 0,
  nearestVillage: null,   // { x, y, d } para la brújula
  quest: null,            // recado activo { role, item, need, reward, rewardItem? }
  // --- clima (local a cada cliente; cosmético + acelera cultivos) ---
  weather: 'clear',       // clear | rain | storm | snow
  weatherT: 0,            // tiempo restante del estado activo
  weatherI: 0,            // intensidad [0,1] con fundido
  weatherCD: 30,          // cuenta atrás hasta la próxima tirada de clima
  windBoost: 0,           // viento extra que mece la vegetación (lo lee el renderer)
  flash: 0,               // destello de relámpago [0,1]
  thunderT: -1,           // retardo luz→trueno (-1 = sin trueno pendiente)
};

const _towerCd = new Map();   // "tx,ty" -> cooldown restante

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resize() {
  // Render HD: el backing-store va a resolución nativa (más píxeles + suavizado),
  // y el zoom se aplica como escala de mundo vía ctx.setTransform en render().
  // Las dimensiones LÓGICAS (viewW/viewH = innerW/zoom) son idénticas al pipeline
  // anterior, así que el rango de casillas visible, la cámara y el culling no cambian.
  const oldVW = G.viewW || 0, oldVH = G.viewH || 0;
  const iw = window.innerWidth || document.documentElement.clientWidth || 1280;
  const ih = window.innerHeight || document.documentElement.clientHeight || 720;
  // GFX modula la densidad de píxel: 0 = barato (dpr 1, sin suavizado de mundo),
  // 1 = medio (≤1.5), 2 = nativo. Además un presupuesto absoluto acota el
  // fill-rate en pantallas grandes/HiDPI (bajando el dpr sin tocar la vista).
  const cap = CFG.GFX >= 2 ? CFG.MAX_DPR : (CFG.GFX === 1 ? Math.min(CFG.MAX_DPR, 1.5) : 1);
  let dpr = Math.min(window.devicePixelRatio || 1, cap);
  if (iw * ih * dpr * dpr > CFG.MAX_PIXELS) dpr = Math.max(1, Math.sqrt(CFG.MAX_PIXELS / (iw * ih)));
  G.renderScale = G.zoom * dpr;
  canvas.width = Math.max(1, Math.round(iw * dpr));
  canvas.height = Math.max(1, Math.round(ih * dpr));
  G.viewW = canvas.width / G.renderScale;
  G.viewH = canvas.height / G.renderScale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // reescala el cursor al nuevo espacio lógico (cubre resize de ventana y zoom)
  if (oldVW && oldVH) { Input.mx *= G.viewW / oldVW; Input.my *= G.viewH / oldVH; }
}
window.addEventListener('resize', resize);

function setZoom(z) {
  G.zoom = clamp(z | 0, 1, 3);
  try { localStorage.setItem('pixelrealm.zoom', G.zoom); } catch (e) { /* da igual */ }
  resize();   // resize() ya reescala Input.mx/my al nuevo espacio lógico
  UI.toast('Zoom: ' + ['lejos', 'cerca', 'muy cerca'][G.zoom - 1]);
}

/* ---------- arranque de partidas ---------- */

function newGame(seedText, creative, mode) {
  Save.clear();
  let seed;
  if (seedText && seedText.trim()) {
    const t = seedText.trim();
    seed = /^-?\d+$/.test(t) ? (parseInt(t, 10) | 0) : (hashStr(t) | 0);
  } else {
    seed = (Math.random() * 0x7fffffff) | 0;
  }
  G.creative = !!creative;
  G.mode = mode || 'iso';
  startWorld(seed, null);
}

function continueGame() {
  const data = Save.read();
  if (!data) { newGame(''); return; }
  G.creative = !!data.creative;
  G.mode = data.mode || 'iso';   // restaurar el modo antes de instanciar el mundo
  startWorld(data.seed, data);
}

// salir de la partida al título (guardando), con Escape
function exitToTitle() {
  if (!G.running) return;
  if (!(typeof Net !== 'undefined' && Net.online)) Save.write();
  G.running = false;
  if (UI.closeAll) UI.closeAll();
  const cont = document.getElementById('btn-continue');
  if (cont && Save.exists()) cont.classList.remove('hidden');
  UI.showTitleAgain('Partida guardada · pulsa Continuar para volver');
}

function startWorld(seed, data) {
  world = (G.mode === 'side') ? new World2D(seed) : new World(seed);
  if (data && G.mode === 'side') {
    // carga de mundo 2D (terreno editado + árboles talados)
    world.applyModified(data.chunks || {});
    if (world.applyTrees) world.applyTrees(data.chopped);
    G.time = data.time; G.day = data.day || 1;
    G.spawn = data.spawn || world.findSurfaceSpawn(0);
    player.x = data.player.x; player.y = data.player.y;
    player.hp = clamp(data.player.hp | 0, 1, player.maxHp);
    player.vx2 = 0; player.vy2 = 0; player.grounded = false; player.dir = 'right';
    Inv.slots = (data.inv || []).map(s => (s && ITEMS[s.id]) ? { id: s.id, n: s.n } : null);
    while (Inv.slots.length < 36) Inv.slots.push(null);
    Inv.slots.length = 36; Inv.sel = data.sel || 0; drops.length = 0;
    G.quest = null; cam.init = false;
    world.center = { x: player.x, y: player.y };
    finishStart('Mundo 2D cargado');
    return;
  }
  if (data) {
    world.applyModified(data.chunks || {});
    world.applyBuildings(data.buildings || {});
    world.applyCrops(data.crops || {});
    G.time = data.time;
    G.day = data.day;
    G.spawn = data.spawn || world.findSpawn();
    player.x = data.player.x;
    player.y = data.player.y;
    // guardados antiguos pueden traer hp<=0 (muerte + autosave): sanea
    player.hp = clamp(data.player.hp | 0, 1, player.maxHp);
    if ((data.player.hp | 0) <= 0) { player.x = G.spawn.x; player.y = G.spawn.y; player.hp = player.maxHp; }
    const sp = safeSpawn(player.x, player.y); // por si la posición guardada quedó dentro de un sólido
    player.x = sp.x; player.y = sp.y;
    Inv.slots = (data.inv || []).map(s => (s && ITEMS[s.id]) ? { id: s.id, n: s.n } : null);
    while (Inv.slots.length < 36) Inv.slots.push(null);
    Inv.slots.length = 36;
    Inv.sel = data.sel || 0;
    drops.length = 0;
    for (const d of (data.drops || [])) {
      if (ITEMS[d.id]) drops.push({ x: d.x, y: d.y, id: d.id, n: d.n, vx: 0, vy: 0, z: 0, vz: 0, age: 1, ttl: 0 });
    }
  } else if (G.mode === 'side') {
    G.time = 0.15; G.day = 1;
    G.spawn = world.findSurfaceSpawn(0);
    player.x = G.spawn.x; player.y = G.spawn.y; player.hp = player.maxHp;
    player.vx2 = 0; player.vy2 = 0; player.grounded = false; player.dir = 'right';
    Inv.slots = new Array(36).fill(null); Inv.sel = 0;
    Inv.add('pick', 1); Inv.add('axe', 1); Inv.add('dirt', 40); Inv.add('stone', 20); Inv.add('torch', 12);
    drops.length = 0;
  } else {
    G.time = 0.08;
    G.day = 1;
    G.spawn = world.findSpawn();
    player.x = G.spawn.x;
    player.y = G.spawn.y;
    player.hp = player.maxHp;
    Inv.slots = new Array(36).fill(null);
    Inv.sel = 0;
    Inv.add('berry', 3);
    Inv.add('coin', 12);   // unas monedas para estrenar el comercio
    drops.length = 0;
  }
  G.quest = (G.mode !== 'side' && data && data.quest && NPC_ROLES[data.quest.role | 0] && ITEMS[data.quest.item] &&
    (!data.quest.rewardItem || ITEMS[data.quest.rewardItem])) ? data.quest : null;
  world.center = { x: player.x, y: player.y };
  cam.init = false;
  finishStart(G.mode === 'side'
    ? 'Mundo 2D: A/D para moverte, Espacio para saltar, clic para picar/colocar'
    : (data ? 'Partida cargada' : (G.creative ? 'Modo creativo: clic para moverte, recursos infinitos' : 'Clic izquierdo para moverte y recolectar · busca una aldea')));
}

// Entrada en el mundo compartido: la semilla, el reloj y las ediciones vienen del servidor
function startOnlineWorld(w) {
  world = new World(w.seed);
  G.time = w.time;
  G.day = w.day;
  for (const e of w.edits) {
    if (OBJ[e.o] && OBJ[e.o].size === 2) world.placeBuilding(e.x, e.y, e.o, e.owner);
    else if (e.o !== O.PART) world.setObject(e.x, e.y, e.o);
    if (e.owner) world.owners.set(e.x + ',' + e.y, e.owner);
  }
  for (const k in (w.buildings || {})) {
    const b = w.buildings[k];
    world.buildings.set(k, { stock: b.stock || 0, owner: b.owner || 0 });
  }
  // posición e inventario locales por mundo de servidor
  const data = Save.readMp(w.worldId);
  G.spawn = (data && data.spawn) || world.findSpawn();
  if (data) {
    player.x = data.player.x; player.y = data.player.y;
    player.hp = clamp(data.player.hp | 0, 1, player.maxHp);
    Inv.slots = (data.inv || []).map(s => (s && ITEMS[s.id]) ? { id: s.id, n: s.n } : null);
    while (Inv.slots.length < 36) Inv.slots.push(null);
    Inv.slots.length = 36;
    Inv.sel = data.sel || 0;
  } else {
    player.x = G.spawn.x; player.y = G.spawn.y;
    player.hp = player.maxHp;
    Inv.slots = new Array(36).fill(null);
    Inv.sel = 0;
    Inv.add('berry', 3);
    Inv.add('coin', 12);
  }
  drops.length = 0;
  world.center = { x: player.x, y: player.y };
  const osp = safeSpawn(player.x, player.y); // pudieron construir sobre tu posición mientras no estabas
  player.x = osp.x; player.y = osp.y;
  G.online = true;
  G.creative = false;   // el mundo compartido es de supervivencia
  G.quest = null;       // los recados son por mundo local de momento
  if (w.boss) Net.applyBossState(w.boss);
  finishStart('Bienvenido al mundo compartido — sé amable, construid juntos');
}

function finishStart(msg) {
  // clima en reposo al (re)entrar al mundo
  G.weather = 'clear'; G.weatherI = 0; G.weatherT = 0; G.weatherCD = randRange(25, 55);
  G.windBoost = 0; G.flash = 0; G.thunderT = -1;
  Sfx.stopRain();
  player.dead = false;
  player.breaking = null;
  player.velX = 0;
  player.velY = 0;
  player.path = null;
  player.cmd = null;
  player.drag = false;
  Input.mdownT = 0;
  Input.mdown = false;
  mobs.length = 0;
  if (typeof mobs2d !== 'undefined') mobs2d.length = 0;   // criaturas del modo 2D
  particles.length = 0;
  floaters.length = 0;
  projectiles.length = 0;
  npcs.length = 0;
  NPC._spawned.clear();
  NPC.active = null;
  if (typeof UI.closeNpc === 'function') UI.closeNpc();
  _towerCd.clear();
  G.boss = null;
  G.bossWarned = false;
  G.bossNightDone = false;
  cam.init = false;
  G.saveTimer = 0;
  G.running = true;
  UI.hideTitle();
  UI.refreshAll();
  UI.renderMinimap();
  UI.updateQuestHud();
  UI.toast(msg);
  if (!G.online) UI.maybeShowHint();
}

/* ---------- ciclo día/noche ---------- */

// Paleta del cielo por momento del día: [hora, grade rgba (tinte de pantalla), veil rgb (color de la noche)]
const SKY_KEYS = [
  { t: 0.00, grade: [38, 52, 120, 0.10], veil: [10, 14, 40] },   // noche cerrada
  { t: 0.05, grade: [150, 92, 96, 0.16], veil: [42, 30, 60] },   // pre-amanecer (violáceo)
  { t: 0.10, grade: [255, 196, 120, 0.13], veil: [34, 30, 58] }, // hora dorada
  { t: 0.20, grade: [255, 240, 205, 0.05], veil: [22, 30, 58] }, // mañana
  { t: 0.42, grade: [255, 250, 235, 0.02], veil: [20, 28, 56] }, // mediodía (casi sin tinte)
  { t: 0.50, grade: [255, 120, 40, 0.22], veil: [54, 28, 48] },  // atardecer ámbar
  { t: 0.56, grade: [60, 60, 130, 0.14], veil: [20, 18, 48] },   // anochecer
  { t: 0.90, grade: [40, 52, 120, 0.12], veil: [10, 14, 40] },   // noche
  { t: 1.00, grade: [38, 52, 120, 0.10], veil: [10, 14, 40] },
];

function sampleSky(t) {
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (t >= SKY_KEYS[i].t && t <= SKY_KEYS[i + 1].t) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  const mix = (i, n) => a[n][i] + (b[n][i] - a[n][i]) * f;
  return {
    grade: [mix(0, 'grade'), mix(1, 'grade'), mix(2, 'grade'), mix(3, 'grade')],
    veil: [mix(0, 'veil'), mix(1, 'veil'), mix(2, 'veil')],
  };
}

function computeLight() {
  const t = G.time;
  let dark = 0, warm = 0;
  if (t < 0.45) { dark = 0; }
  else if (t < 0.55) { const p = (t - 0.45) / 0.1; dark = p; warm = Math.sin(p * Math.PI); }
  else if (t < 0.90) { dark = 1; }
  else { const p = (t - 0.90) / 0.1; dark = 1 - p; warm = Math.sin(p * Math.PI); }
  G.darkness = dark;
  G.warm = warm;
  const s = sampleSky(t);
  G.grade = s.grade;
  G.veil = s.veil;
}

/* ---------- interacciones (click-to-move estilo LoL) ---------- */

function effReach() { return G.creative ? CFG.CREATIVE_REACH : CFG.REACH; }
const _online = () => typeof Net !== 'undefined' && Net.online;

function setFacingWorld(dx, dy) {
  const sdx = dx - dy, sdy = dx + dy;
  player.dir = Math.abs(sdx) > Math.abs(sdy) ? (sdx > 0 ? 'right' : 'left') : (sdy > 0 ? 'down' : 'up');
}

// ¿Puede este jugador romper lo que hay en (tx,ty)? (propiedad en multijugador)
function canBreak(tx, ty) {
  if (!_online()) return true;
  const anchor = world.buildingAnchor(tx, ty);
  const key = anchor ? (anchor.tx + ',' + anchor.ty) : (tx + ',' + ty);
  const owner = world.owners.get(key);
  if (!owner || owner.id === Net.id) return true;
  UI.toast('Esto lo construyó ' + owner.name + ' — puedes usarlo, no romperlo');
  return false;
}

// Golpe a un objeto fijo. Devuelve true si el objeto sigue en pie.
function swingTile(tx, ty) {
  player.hitT = CFG.HIT_COOLDOWN;
  player.swingT = 0.18;
  setFacingWorld(tx + 0.5 - player.x, ty + 0.5 - player.y);
  let ob = world.object(tx, ty);
  if (ob === O.PART) { const a = world.buildingAnchor(tx, ty); if (a) { tx = a.tx; ty = a.ty; ob = a.id; } }
  if (ob === O.NONE) { player.breaking = null; return false; }
  if (!canBreak(tx, ty)) { player.breaking = null; return false; }
  const odef = OBJ[ob];
  const sel = Inv.selected(), def = sel ? ITEMS[sel.id] : null;
  // herramienta correcta = más daño (el hierro pica/tala más rápido); puño = 1
  const dmg = G.creative ? odef.hp : ((def && def.tool && def.tool === odef.tool) ? (def.dmg + 1) : 1);
  if (!player.breaking || player.breaking.tx !== tx || player.breaking.ty !== ty || player.breaking.id !== ob) {
    player.breaking = { tx, ty, id: ob, dmg: 0 };
  }
  player.breaking.dmg += dmg;
  const stony = ob === O.ROCK || ob === O.WALLS || ob === O.QUARRY || ob === O.BRAZIER || ob === O.ALTAR ||
    ob === O.WELL || ob === O.ROCK_COAL || ob === O.ROCK_IRON || ob === O.FURNACE;
  if (stony) Sfx.mine(); else Sfx.chop();
  spawnParticles(tx + 0.5, ty + 0.5, PART_COLOR[ob] || '#caa178', 5);
  if (player.breaking.dmg >= odef.hp) {
    if (odef.size) { world.removeBuilding(tx, ty); if (_online()) Net.sendBreakBuilding(tx, ty); }
    else { world.setObject(tx, ty, O.NONE); if (_online()) Net.sendBreak(tx, ty); }
    player.breaking = null;
    Sfx.poof();
    spawnParticles(tx + 0.5, ty + 0.5, PART_COLOR[ob] || '#caa178', 9);
    if (!G.creative) for (const dr of odef.drops) {
      if (Math.random() < dr[2]) spawnDrop(tx + 0.5, ty + 0.5, dr[0], dr[1]);
    }
    return false;
  }
  return true;
}

function swingMob(m) {
  player.hitT = CFG.HIT_COOLDOWN;
  player.swingT = 0.18;
  setFacingWorld(m.x - player.x, m.y - player.y);
  const sel = Inv.selected(), def = sel ? ITEMS[sel.id] : null;
  const dmg = def && def.tool === 'sword' ? def.dmg : (def && def.tool ? 2 : 1);
  damageMob(m, dmg);
}

// Traduce un clic del ratón en un objetivo del mundo a una orden
function issueClickCommand(h) {
  player.drag = false;
  player.breaking = null;
  // 1) comerciante
  const npc = NPC.at(h.wx, h.wy, 0.95);
  if (npc) {
    player.cmd = { type: 'talk', npc };
    player.path = Path.findAdjacent(player.x, player.y, Math.floor(npc.x), Math.floor(npc.y), 1) || [];
    return;
  }
  // 2) enemigo
  let best = null, bd = 1.3;
  for (const m of mobs) { const d = dist2(m.x, m.y, h.wx, h.wy); if (d < bd) { bd = d; best = m; } }
  if (best) {
    player.cmd = { type: 'attack', mob: best };
    player.path = Path.findTo(player.x, player.y, best.x, best.y);
    return;
  }
  // 3) objeto del mundo
  const ob = world.object(h.tx, h.ty);
  if (ob !== O.NONE) {
    let atx = h.tx, aty = h.ty, size = 1;
    const anchor = world.buildingAnchor(h.tx, h.ty);
    if (anchor) {
      atx = anchor.tx; aty = anchor.ty; size = OBJ[anchor.id].size || 1;
      if (OBJ[anchor.id].prod) {
        player.cmd = { type: 'collect', tx: atx, ty: aty };
        player.path = Path.findAdjacent(player.x, player.y, atx, aty, size) || [];
        return;
      }
      if (OBJ[anchor.id].furnace) {
        player.cmd = { type: 'smelt', tx: atx, ty: aty };
        player.path = Path.findAdjacent(player.x, player.y, atx, aty, size) || [];
        return;
      }
    }
    player.cmd = { type: 'harvest', tx: atx, ty: aty };
    player.path = Path.findAdjacent(player.x, player.y, atx, aty, size) || [];
    return;
  }
  // 4) caminar hasta el suelo
  player.cmd = { type: 'move' };
  const p = Path.findTo(player.x, player.y, h.tx, h.ty);
  player.path = p && p.length ? p : null;
}

// Clic derecho: usar/colocar lo que llevas en la mano
function tryUseItem() {
  if (!G.running || player.dead || UI.panelOpen || UI.chatOpen || UI.dialogOpen) return;
  const sel = Inv.selected();
  const def = sel ? ITEMS[sel.id] : null;
  if (def && def.food) { eatSelected(); return; }
  const h = hoveredTile();
  const usable = def && (def.place != null || def.tool === 'hoe' || def.plant);
  if (!usable) {
    // sin nada usable: recoge la producción del edificio bajo el cursor si está cerca
    const a = world.buildingAnchor(h.tx, h.ty);
    if (a && OBJ[a.id].prod && dist2(player.x, player.y, h.wx, h.wy) <= effReach() * effReach()) collectBuilding(a);
    return;
  }
  if (dist2(player.x, player.y, h.wx, h.wy) <= effReach() * effReach()) {
    useHeldAt(h.tx, h.ty);
  } else {
    player.cmd = { type: 'use', tx: h.tx, ty: h.ty };
    const size = def.place != null ? (OBJ[def.place].size || 1) : 1;
    player.path = Path.findAdjacent(player.x, player.y, h.tx, h.ty, size) || [];
  }
}

// Aplica el objeto en mano a una casilla: colocar / arar / plantar
function useHeldAt(tx, ty) {
  const sel = Inv.selected();
  if (!sel) return;
  const def = ITEMS[sel.id];
  if (def.tool === 'hoe') return tillAt(tx, ty);
  if (def.plant) return plantAt(tx, ty);
  if (def.place != null) return placeAt(tx, ty);
}

function tillAt(tx, ty) {
  if (_online()) { UI.toast('La granja llega pronto al mundo compartido'); return; }
  const gr = world.ground(tx, ty);
  if ((gr === T.GRASS || gr === T.DIRT || gr === T.SAND) && world.object(tx, ty) === O.NONE) {
    world.setGround(tx, ty, T.TILLED);
    setFacingWorld(tx + 0.5 - player.x, ty + 0.5 - player.y);
    player.swingT = 0.18;
    Sfx.mine();
    spawnParticles(tx + 0.5, ty + 0.5, '#7a4841', 5);
  } else {
    UI.toast('Solo se ara hierba o tierra despejada');
  }
}

function plantAt(tx, ty) {
  if (_online()) { UI.toast('La granja llega pronto al mundo compartido'); return; }
  const gr = world.ground(tx, ty);
  if ((gr === T.TILLED || gr === T.DIRT) && world.object(tx, ty) === O.NONE) {
    world.setObject(tx, ty, O.CROP0);
    world.crops.set(tx + ',' + ty, { t: 0 });
    if (!G.creative) Inv.consumeSelected(1);
    Sfx.place();
    UI.refreshHotbar();
  } else {
    UI.toast('Planta en tierra arada');
  }
}

function eatSelected() {
  const sel = Inv.selected();
  if (!sel) return;
  const def = ITEMS[sel.id];
  if (!def.food) return;
  if (player.hp >= player.maxHp) { UI.toast('Vida al máximo'); return; }
  player.hp = Math.min(player.maxHp, player.hp + def.food);
  if (!G.creative) Inv.consumeSelected(1);
  Sfx.eat();
  addFloater(player.x, player.y - 0.5, '+' + def.food, '#7be37b');
  UI.refreshHearts();
  UI.refreshHotbar();
}

function placeAt(tx, ty) {
  const sel = Inv.selected();
  if (!sel) return;
  const def = ITEMS[sel.id];
  if (def.place == null) return;
  const odef = OBJ[def.place];
  const size = odef.size || 1;
  if (!world.canPlaceBuilding(tx, ty, size)) {
    const gr = world.ground(tx, ty);
    if (gr === T.DEEP || gr === T.WATER) UI.toast('No puedes construir en el agua');
    return;
  }
  if (odef.solid) {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (overlapsTile(player, 0.3, tx + dx, ty + dy)) return;
        for (const m of mobs) if (overlapsTile(m, 0.3, tx + dx, ty + dy)) return;
        if (_online()) {
          for (const [, rp] of Net.players) {
            if (overlapsTile(rp, 0.45, tx + dx, ty + dy) || overlapsTile({ x: rp.px, y: rp.py }, 0.45, tx + dx, ty + dy)) {
              UI.toast('Hay alguien ahí'); return;
            }
          }
        }
      }
    }
  }
  if (odef.size) {
    world.placeBuilding(tx, ty, def.place, _online() ? Net.id : 0);
    if (_online()) Net.sendPlaceBuilding(tx, ty, def.place);
    if (odef.home) { G.spawn = { x: tx + size / 2, y: ty + size + 0.5 }; UI.toast('Hogar dulce hogar: reaparecerás aquí'); }
  } else {
    world.setObject(tx, ty, def.place);
    if (_online()) Net.sendPlace(tx, ty, def.place);
  }
  if (!G.creative) Inv.consumeSelected(1);
  Sfx.place();
  UI.refreshHotbar();
}

// Controlador de movimiento: teclado (override) o click-to-move. Devuelve la
// velocidad objetivo [vx,vy] en casillas/seg y fija player.moving / player.dir.
function desiredVelocity(dt) {
  player.moving = false;
  let ix = 0, iy = 0;
  if (!UI.chatOpen && !UI.dialogOpen && !UI.panelOpen) {
    if (Input.keys['w'] || Input.keys['arrowup']) iy--;
    if (Input.keys['s'] || Input.keys['arrowdown']) iy++;
    if (Input.keys['a'] || Input.keys['arrowleft']) ix--;
    if (Input.keys['d'] || Input.keys['arrowright']) ix++;
  }
  if (ix || iy) {
    player.path = null; player.cmd = null; player.drag = false; player.breaking = null;
    const wx = ix + 2 * iy, wy = 2 * iy - ix, len = Math.hypot(wx, wy);
    player.dir = Math.abs(ix) > Math.abs(iy) ? (ix > 0 ? 'right' : 'left') : (iy > 0 ? 'down' : 'up');
    player.moving = true;
    const sp = playerSpeed();
    return [wx / len * sp, wy / len * sp];
  }
  if (player.drag && Input.mdown) { const h = hoveredTile(); return steerWorld(h.wx, h.wy, 0.06); }
  if (player.path && player.path.length) {
    let wp = player.path[0];
    while (player.path.length && dist2(player.x, player.y, wp.x, wp.y) < CFG.ARRIVE_DIST * CFG.ARRIVE_DIST) {
      player.path.shift(); wp = player.path[0];
    }
    if (player.path.length) return steerWorld(wp.x, wp.y, 0);
  }
  return runCmd(dt);
}

function playerSpeed() { return CFG.PLAYER_SPEED * (player.grounded ? world.speedAt(Math.floor(player.x), Math.floor(player.y)) : 1); }

function steerWorld(gx, gy, stop) {
  const dx = gx - player.x, dy = gy - player.y, len = Math.hypot(dx, dy);
  if (len <= (stop || 0.04)) { player.moving = false; return [0, 0]; }
  setFacingWorld(dx, dy);
  player.moving = true;
  const sp = playerSpeed();
  return [dx / len * sp, dy / len * sp];
}

// Ejecuta/continúa la orden cuando ya no hay camino que recorrer
function runCmd(dt) {
  const c = player.cmd;
  if (!c) return [0, 0];
  const rr = effReach();
  if (c.type === 'move') { player.cmd = null; return [0, 0]; }
  if (c.type === 'talk') {
    if (c.npc && npcs.indexOf(c.npc) >= 0 && dist2(player.x, player.y, c.npc.x, c.npc.y) < CFG.NPC_TALK_R * CFG.NPC_TALK_R) {
      setFacingWorld(c.npc.x - player.x, c.npc.y - player.y);
      UI.openNpc(c.npc);
    }
    player.cmd = null; return [0, 0];
  }
  if (c.type === 'use') { player.cmd = null; useHeldAt(c.tx, c.ty); return [0, 0]; }
  if (c.type === 'collect') {
    if (dist2(player.x, player.y, c.tx + 0.5, c.ty + 0.5) <= rr * rr) {
      const a = world.buildingAnchor(c.tx, c.ty);
      if (a && OBJ[a.id].prod) collectBuilding(a);
    }
    player.cmd = null; return [0, 0];
  }
  if (c.type === 'smelt') {
    if (dist2(player.x, player.y, c.tx + 0.5, c.ty + 0.5) <= rr * rr) smeltAt();
    player.cmd = null; return [0, 0];
  }
  if (c.type === 'harvest') {
    if (world.object(c.tx, c.ty) === O.NONE) { player.cmd = null; return [0, 0]; }
    if (dist2(player.x, player.y, c.tx + 0.5, c.ty + 0.5) <= rr * rr) {
      setFacingWorld(c.tx + 0.5 - player.x, c.ty + 0.5 - player.y);
      if (player.hitT <= 0 && !swingTile(c.tx, c.ty)) player.cmd = null;
      return [0, 0];
    }
    const p = Path.findAdjacent(player.x, player.y, c.tx, c.ty, 1);
    if (p && p.length) { player.path = p; return steerWorld(p[0].x, p[0].y, 0); }
    player.cmd = null; return [0, 0];
  }
  if (c.type === 'attack') {
    const m = c.mob;
    if (!m || m.dead || mobs.indexOf(m) < 0) { player.cmd = null; return [0, 0]; }
    if (dist2(player.x, player.y, m.x, m.y) <= rr * rr) {
      setFacingWorld(m.x - player.x, m.y - player.y);
      if (player.hitT <= 0) swingMob(m);
      return [0, 0];
    }
    // Guardia anti-persecución infinita: si el héroe no logra acercarse al mob
    // (volador que esquiva, o enemigo tras un muro sin salida), abandonar en vez
    // de repathear A* completo cada 0.3 s indefinidamente.
    const d2m = dist2(player.x, player.y, m.x, m.y);
    if (c.best === undefined || d2m < c.best - 0.04) { c.best = d2m; c.stall = 0; }
    else { c.stall = (c.stall || 0) + dt; }
    // mob fuera del radio que A* puede explorar, o estancado >3 s sin acercarse
    if (Math.abs(m.x - player.x) > Path.RADIUS || Math.abs(m.y - player.y) > Path.RADIUS || c.stall > 3) {
      player.cmd = null; player.path = null; return [0, 0];
    }
    // los voladores ignoran obstáculos: perseguir en línea recta, sin A*
    if (m.kind && MOBS[m.kind] && MOBS[m.kind].ai === 'fly') {
      player.path = null;
      return steerWorld(m.x, m.y, rr * 0.6);
    }
    c.rep = (c.rep || 0) - dt;
    if (c.rep <= 0 || !player.path || !player.path.length) {
      c.rep = 0.3;
      const p = Path.findTo(player.x, player.y, m.x, m.y);
      player.path = p && p.length ? p : null;
    }
    if (player.path && player.path.length) return steerWorld(player.path[0].x, player.path[0].y, 0);
    return steerWorld(m.x, m.y, rr * 0.6);
  }
  return [0, 0];
}

// Horno: funde mineral de hierro y cocina carne, usando carbón como combustible
function smeltAt() {
  let coal = Inv.count('coal');
  const iron = Math.min(Inv.count('iron_ore'), coal); coal -= iron;
  const cook = Math.min(Inv.count('meat'), coal); coal -= cook;
  const used = iron + cook;
  if (used <= 0) {
    UI.toast(Inv.count('coal') <= 0 ? 'El horno necesita carbón' : 'No tienes mineral ni carne');
    return;
  }
  if (iron) { Inv.remove('iron_ore', iron); Inv.add('iron', iron); }
  if (cook) { Inv.remove('meat', cook); Inv.add('cooked_meat', cook); }
  Inv.remove('coal', used);
  Sfx.craft();
  spawnParticles(player.x, player.y, '#ff8c2e', 8);
  const parts = [];
  if (iron) parts.push(iron + ' lingote' + (iron > 1 ? 's' : ''));
  if (cook) parts.push(cook + ' carne' + (cook > 1 ? 's' : '') + ' asada' + (cook > 1 ? 's' : ''));
  UI.toast('Horno: ' + parts.join(' y '));
  UI.refreshHotbar();
}

function collectBuilding(anchor) {
  const key = anchor.tx + ',' + anchor.ty;
  const b = world.buildings.get(key);
  if (!b || b.stock < 1) return false;
  if (typeof Net !== 'undefined' && Net.online) {
    Net.requestCollect(anchor.tx, anchor.ty);   // el servidor adjudica (evita recogidas dobles)
    return true;
  }
  const n = Math.floor(b.stock);
  b.stock -= n;
  const item = OBJ[anchor.id].prod.item;
  const size = OBJ[anchor.id].size || 1;
  for (let i = 0; i < n; i++) {
    spawnDrop(anchor.tx + size / 2 + randRange(-0.4, 0.4), anchor.ty + size + 0.2, item, 1);
  }
  Sfx.pickup();
  return true;
}

/* ---------- salto (eje z de altura) ---------- */

// Pulsar saltar: salta si está en suelo (o en margen "coyote"); si no, bufferea.
function tryJump() {
  if (!G.running) return;
  if (player.grounded || player.coyoteT > 0) {
    player.vz = CFG.JUMP_V0;
    player.grounded = false;
    player.coyoteT = 0;
    Sfx.jump();
  } else {
    player.jumpBufferT = CFG.JUMP_BUFFER;   // recuerda la pulsación si aterriza pronto
  }
}

function onLand() {
  const impact = Math.min(1, Math.abs(player.vz) / CFG.JUMP_V0);
  player.z = 0; player.vz = 0; player.grounded = true;
  // ancla de seguridad: si cayó en agua profunda o sobre un sólido, a tierra firme
  if (blockedAt(player.x, player.y, 0.3)) { const s = safeSpawn(player.x, player.y); player.x = s.x; player.y = s.y; }
  player.landT = 0.14 * impact;             // aplaste de aterrizaje (lo lee computeLivePose)
  G.shake = Math.max(G.shake, 0.18 * impact);
  Sfx.land();
  // polvo en círculo al posarse (reusa el patrón de partículas del andar)
  const onWater = world.ground(Math.floor(player.x), Math.floor(player.y)) === T.WATER;
  const n = 6 + Math.round(impact * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + randRange(-0.2, 0.2), s = randRange(1.2, 2.6) * (0.5 + impact);
    particles.push({
      x: player.x + Math.cos(a) * 0.15, y: player.y + Math.sin(a) * 0.15,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 0.04, vz: randRange(0.6, 1.6),
      life: 0.4, maxLife: 0.4,
      color: onWater ? 'rgba(214,234,255,0.7)' : 'rgba(196,182,150,0.75)',
    });
  }
}

function updatePlayerJump(dt) {
  player.coyoteT = Math.max(0, player.coyoteT - dt);
  player.jumpBufferT = Math.max(0, player.jumpBufferT - dt);
  player.landT = Math.max(0, player.landT - dt);
  if (player.grounded) {
    player.coyoteT = CFG.COYOTE;             // ventana de coyote mientras está en suelo
    return;
  }
  player.vz -= CFG.GRAV * dt;
  player.z += player.vz * dt;
  if (player.z <= 0) {
    onLand();
    if (player.jumpBufferT > 0) { player.jumpBufferT = 0; tryJump(); }  // salto bufferado
  }
}

/* ---------- actualización por frame ---------- */

function update(dt) {
  G.elapsed += dt;
  G.shake = Math.max(0, G.shake - dt * 1.6);
  // el reloj avanza siempre en local (online el mensaje 'time' del servidor
  // lo corrige cada 10 s; sin esto la luz saltaría a escalones)
  G.time += dt / CFG.DAY_LENGTH;
  if (G.time >= 1) {
    G.time -= 1;
    if (typeof Net === 'undefined' || !Net.online) {
      G.day++;
      UI.toast('Día ' + G.day);
    }
  }
  computeLight();
  Sfx.ambient(dt, G.darkness);
  world.center.x = player.x;
  world.center.y = player.y;

  if (!player.dead) {
    player.hitT -= dt;
    // mantener pulsado el ratón un instante = arrastrar para moverse (estilo MOBA)
    if (Input.mdown) Input.mdownT += dt;
    if (Input.mdown && Input.mdownT > 0.16 && !UI.panelOpen && !UI.dialogOpen && !UI.chatOpen &&
        (!player.cmd || player.cmd.type === 'move')) {
      player.drag = true;
      player.cmd = { type: 'move' };
      player.path = null;
    }

    // --- movimiento: teclado (override) o click-to-move con pathfinding ---
    const [twx, twy] = desiredVelocity(dt);
    const accK = 1 - Math.pow(0.000001, dt);
    player.velX += (twx - player.velX) * accK;
    player.velY += (twy - player.velY) * accK;
    if (Math.abs(player.velX) > 0.02 || Math.abs(player.velY) > 0.02) {
      const airborne = !player.grounded && player.z > CFG.JUMP_REACH_Z;   // sobrevuela agua/huecos
      moveEntity(player, player.velX * dt, player.velY * dt, 0.3, airborne);
      player.dustT -= dt;
      if (player.moving && player.dustT <= 0 && world.ground(Math.floor(player.x), Math.floor(player.y)) !== T.WATER) {
        player.dustT = 0.22;
        particles.push({
          x: player.x + randRange(-0.1, 0.1), y: player.y + randRange(-0.1, 0.1),
          vx: -player.velX * 0.18, vy: -player.velY * 0.18, z: 0.05, vz: randRange(0.4, 1),
          life: 0.35, maxLife: 0.35, color: 'rgba(190,175,140,0.7)',
        });
      }
    }
    updatePlayerJump(dt);
    if (player.moving) player.animT += dt; else player.animT = 0;

    // pose del héroe: 6 en el aire, 5 ataque, 1-4 andar, 0 quieto
    if (!player.grounded) player.frameI = 6;
    else if (player.swingT > 0) player.frameI = 5;
    else if (player.moving) player.frameI = 1 + Math.floor(player.animT * 9) % 4;
    else player.frameI = 0;

    // estela (afterimages) en salto, ataque o carrera rápida — solo presentación
    const spd2 = player.velX * player.velX + player.velY * player.velY;
    if (!player.grounded || player.swingT > 0 || spd2 > 9) {
      player._trailT = (player._trailT || 0) - dt;
      if (player._trailT <= 0) {
        player._trailT = 0.045;
        player._trail.push({ x: player.x, y: player.y, z: player.z, dir: player.dir, frameI: player.frameI });
        if (player._trail.length > 5) player._trail.shift();
      }
    } else if (player._trail.length) {
      player._trail.shift();   // se drena suave al volver a idle/andar
    }

    // respingo de ancho al cambiar de dirección (secondary action, solo presentación)
    if (player.dir !== player._lastDir) { player._dirFlash = 0.12; player._lastDir = player.dir; }
    player._dirFlash = Math.max(0, (player._dirFlash || 0) - dt);
    player.pickT = Math.max(0, (player.pickT || 0) - dt);  // saltito de recoger (lo arma updateDrops)

    player.invuln = Math.max(0, player.invuln - dt);
    player.hurtT = Math.max(0, player.hurtT - dt);
    player.swingT = Math.max(0, player.swingT - dt);
    player.noDmgT += dt;

    // regeneración (más rápida al calor de una hoguera compartida)
    if (player.hp < player.maxHp && player.noDmgT > 10) {
      const k = (typeof Net !== 'undefined' && Net.online && Net.warmBonus()) ? 2 : 1;
      player.regenT += dt * k;
      if (player.regenT >= 5) {
        player.regenT = 0;
        player.hp++;
        UI.refreshHearts();
      }
    } else {
      player.regenT = 0;
    }
  }

  updateMobs(dt);
  updateBoss(dt);
  updateDrops(dt);
  updateParticles(dt);
  updateFloaters(dt);
  updateProjectiles(dt);
  updateBuildings(dt);
  updateCrops(dt);
  updateWeather(dt);
  NPC.update(dt);
  if (typeof Net !== 'undefined') Net.update(dt);

  // --- aparición de enemigos por la noche (siempre fuera de la pantalla; no en creativo) ---
  G.spawnTimer -= dt;
  if (!G.creative && G.darkness > 0.5 && mobs.length < CFG.MOB_CAP && G.spawnTimer <= 0 && !player.dead) {
    G.spawnTimer = 2.5;
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      // distancia mínima para nacer fuera de pantalla EN ESTA dirección:
      // con zoom alejado la pantalla abarca más casillas que el anillo 9-22
      const exPx = Math.abs(Math.cos(ang) - Math.sin(ang)) * CFG.HW;
      const eyPx = Math.abs(Math.cos(ang) + Math.sin(ang)) * CFG.HH;
      const dEdge = Math.min(
        exPx > 1e-6 ? (G.viewW / 2 + 64) / exPx : Infinity,
        eyPx > 1e-6 ? (G.viewH / 2 + 96) / eyPx : Infinity,
      );
      const d = Math.max(randRange(9, 22), dEdge + randRange(1, 5));
      const x = player.x + Math.cos(ang) * d;
      const y = player.y + Math.sin(ang) * d;
      const ssx = w2sx(x, y) + cam.ox, ssy = w2sy(x, y) + cam.oy;
      if (ssx > -64 && ssx < G.viewW + 64 && ssy > -96 && ssy < G.viewH + 64) continue;
      const tx = Math.floor(x), ty = Math.floor(y);
      const gr = world.ground(tx, ty);
      if (gr !== T.DEEP && gr !== T.WATER && !world.isSolid(tx, ty)) {
        spawnMob(pickMobKind(), x, y);
        break;
      }
    }
  }

  // --- fauna diurna (conejos y ciervos en pradera) ---
  G.wildTimer -= dt;
  if (!G.creative && G.darkness < 0.3 && G.wildTimer <= 0 && !player.dead) {
    G.wildTimer = 4;
    let passive = 0;
    for (const m of mobs) if (MOBS[m.kind].passive) passive++;
    if (passive < 6) {
      const ang = Math.random() * Math.PI * 2, d = randRange(8, 16);
      const x = player.x + Math.cos(ang) * d, y = player.y + Math.sin(ang) * d;
      const ssx = w2sx(x, y) + cam.ox, ssy = w2sy(x, y) + cam.oy;
      const onScreen = ssx > -64 && ssx < G.viewW + 64 && ssy > -96 && ssy < G.viewH + 64;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (!onScreen && world.ground(tx, ty) === T.GRASS && !world.isSolid(tx, ty)) {
        spawnMob(Math.random() < 0.7 ? 'rabbit' : 'deer', x, y);
      }
    }
  }

  // --- la Noche del Coloso (retirada por ahora: CFG.BOSS_ENABLED=false) ---
  if (CFG.BOSS_ENABLED && (typeof Net === 'undefined' || !Net.online) && !G.boss) {
    if (G.day >= CFG.BOSS_NIGHT_EVERY && G.day % CFG.BOSS_NIGHT_EVERY === 0) {
      if (G.darkness > 0.4 && !G.bossWarned) {
        G.bossWarned = true;
        UI.toast('La tierra tiembla… esta es la Noche del Coloso');
        Sfx.bossRoar();
      }
      if (G.darkness >= 1 && G.bossWarned && !G.bossNightDone && !player.dead) {
        G.bossNightDone = true;
        const ang = Math.random() * Math.PI * 2;
        spawnBoss(player.x + Math.cos(ang) * 14, player.y + Math.sin(ang) * 14, BOSS_CFG.hp);
      }
    }
  }
  if (G.darkness < 0.3) { G.bossWarned = false; G.bossNightDone = false; }

  G.minimapTimer -= dt;
  if (G.minimapTimer <= 0) {
    G.minimapTimer = 0.5;
    UI.renderMinimap();
    UI.updateQuestHud();   // el progreso del recado cambia al recolectar
  }

  // brújula a la aldea conocida más cercana (escaneo periódico, es caro)
  G.beaconT -= dt;
  if (G.beaconT <= 0) {
    G.beaconT = 1.2;
    G.nearestVillage = world.nearestVillage(player.x, player.y, 10);
  }

  UI.setTime();
}

// Crecimiento de cultivos (las casillas con cultivo están en chunks modificados,
// así que nunca se purgan y conservan su id de fase)
function updateCrops(dt) {
  // la lluvia riega: los cultivos crecen ~60% más rápido (la nieve no)
  const rain = (G.weather === 'rain' || G.weather === 'storm') ? 0.6 * G.weatherI : 0;
  const grow = dt * (1 + rain);
  for (const [key, c] of world.crops) {
    const i = key.indexOf(',');
    const tx = +key.slice(0, i), ty = +key.slice(i + 1);
    const ob = world.object(tx, ty);
    if (ob < O.CROP0 || ob > O.CROP3) { world.crops.delete(key); continue; }  // cosechado o destruido
    c.t += grow;
    const want = O.CROP0 + Math.min(3, Math.floor(c.t / CROP_SECS));
    if (ob !== want) world.setObject(tx, ty, want);
  }
}

// Clima: programa estados (despejado/lluvia/tormenta/nieve), gestiona intensidad
// con fundido, relámpagos+truenos en tormenta y el audio de lluvia en bucle.
function updateWeather(dt) {
  // destello de relámpago se apaga rápido; el trueno llega tras el retardo de la luz
  if (G.flash > 0) G.flash = Math.max(0, G.flash - dt * 3.2);
  if (G.thunderT >= 0) {
    G.thunderT -= dt;
    if (G.thunderT < 0) Sfx.thunder();
  }

  if (G.weather === 'clear') {
    G.weatherI = Math.max(0, G.weatherI - dt * 0.5);
    if (G.weatherI <= 0) Sfx.stopRain();
    G.windBoost = G.weatherI * 0.3;
    G.weatherCD -= dt;
    if (G.weatherCD <= 0 && G.running && !player.dead) {
      // empieza un episodio de clima
      const snowy = world.snowyAt(Math.floor(player.x), Math.floor(player.y));
      if (snowy) G.weather = 'snow';
      else G.weather = Math.random() < 0.35 ? 'storm' : 'rain';
      G.weatherT = randRange(38, 78);
      UI.toast(G.weather === 'snow' ? '❄ Comienza a nevar'
             : G.weather === 'storm' ? '⛈ Se desata una tormenta'
             : '🌧 Empieza a llover');
    }
    return;
  }

  // clima activo
  G.weatherT -= dt;
  // reconcilia el tipo con el bioma actual si el jugador cruzó de zona durante el episodio
  const snowyNow = world.snowyAt(Math.floor(player.x), Math.floor(player.y));
  if (snowyNow && G.weather !== 'snow') G.weather = 'snow';
  else if (!snowyNow && G.weather === 'snow') G.weather = Math.random() < 0.35 ? 'storm' : 'rain';
  const peak = G.weather === 'storm' ? 1 : G.weather === 'snow' ? 0.85 : 0.9;
  // fundido de salida en los últimos 6 s
  const target = G.weatherT < 6 ? 0 : peak;
  G.weatherI += (target - G.weatherI) * (1 - Math.pow(0.05, dt));
  G.windBoost = (G.weather === 'storm' ? 1.0 : G.weather === 'snow' ? 0.25 : 0.5) * G.weatherI;

  // audio en bucle (idempotente: arranca cuando exista el AudioContext)
  Sfx.startRain(G.weather === 'snow');
  Sfx.setRainLevel(G.weatherI);

  // relámpagos durante la tormenta (no mientras el jugador está muerto)
  if (!player.dead && G.weather === 'storm' && G.weatherI > 0.5 && G.flash <= 0 && Math.random() < dt * 0.35) {
    G.flash = 1.35;   // el exceso sobre 1 se consume como rampa de subida (pico visible 0.42)
    G.shake = Math.max(G.shake, 0.25);
    G.thunderT = randRange(0.3, 1.8);   // la luz viaja más rápido que el sonido
  }

  if (G.weatherT <= 0) {
    G.weather = 'clear';
    G.weatherCD = randRange(55, 130);
  }
}

// Producción pasiva y torres
function updateBuildings(dt) {
  const online = typeof Net !== 'undefined' && Net.online;
  for (const [key, b] of world.buildings) {
    const p = key.split(',');
    const tx = +p[0], ty = +p[1];
    const id = world.object(tx, ty);
    const def = OBJ[id];
    if (!def || !def.size) continue;

    // el stock lo lleva el servidor cuando estamos online
    if (def.prod && !online) {
      b.stock = Math.min(def.prod.cap, b.stock + dt / def.prod.per);
    }

    if (def.tower && dist2(tx, ty, player.x, player.y) < CFG.TOWER_ACTIVE_R * CFG.TOWER_ACTIVE_R) {
      let cd = _towerCd.get(key) || 0;
      cd -= dt;
      if (cd <= 0) {
        // dispara al enemigo más cercano dentro del alcance
        let best = null, bd = def.tower.range * def.tower.range;
        for (const m of mobs) {
          if (m.dead) continue;
          const d = dist2(tx + 0.5, ty + 0.5, m.x, m.y);
          if (d < bd) { bd = d; best = { x: m.x, y: m.y }; }
        }
        if (!best && G.boss) {
          const d = dist2(tx + 0.5, ty + 0.5, G.boss.x, G.boss.y);
          if (d < bd) best = { x: G.boss.x, y: G.boss.y };
        }
        if (best) {
          // en multijugador, el cliente con menor id cercano a la torre es quien
          // informa del daño al jefe (los demás solo ven el impacto)
          let auth = true;
          if (online) {
            for (const [rid, rp] of Net.players) {
              if (rid < Net.id && dist2(tx, ty, rp.px, rp.py) < CFG.TOWER_ACTIVE_R * CFG.TOWER_ACTIVE_R) {
                auth = false;
                break;
              }
            }
          }
          spawnArrow(tx + 0.5, ty + 0.5, best.x, best.y, def.tower.dmg, auth);
          cd = def.tower.rate;
        } else {
          cd = 0.2;
        }
      }
      _towerCd.set(key, cd);
    }
  }
}

/* ---------- bucle ---------- */

let _last = performance.now();
// despacho de modo: el iso usa update/updateCamera/render; el 2D sus variantes (side.js)
const MODES = {
  iso: { update: update, camera: updateCamera, render: render },
  side: { update: update2d, camera: updateCamera2d, render: render2d },
};
// autoguardado periódico, compartido por ambos modos (antes vivía dentro de update() iso)
// Save.write() ya enruta a writeMp() cuando se juega online.
function autosave(dt) {
  G.saveTimer += dt;
  if (G.saveTimer > CFG.AUTOSAVE) {
    G.saveTimer = 0;
    const ok = Save.write();
    if (ok) {
      G.saveFailWarned = false;
      UI.toast('Partida guardada');
    } else if (!G.saveFailWarned) {
      G.saveFailWarned = true;
      UI.toast('⚠ No se pudo guardar (almacenamiento lleno o bloqueado)');
    }
  }
}
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - _last) / 1000;
  _last = now;
  if (dt > 0.05) dt = 0.05;
  if (!G.running || !world) return;
  const M = MODES[G.mode] || MODES.iso;
  M.update(dt);
  M.camera(dt, G.viewW, G.viewH);
  M.render(ctx, G.viewW, G.viewH);
  autosave(dt);
}

/* ---------- inicio ---------- */

function boot() {
  buildAssets();
  if (typeof Assets2D !== 'undefined') {                  // assets CC0 del modo 2D (async)
    Assets2D.load(() => { if (typeof invalidate2dTiles === 'function') invalidate2dTiles(); });
  }
  // preferencias guardadas: zoom y apariencia del héroe
  try {
    G.zoom = clamp(parseInt(localStorage.getItem('pixelrealm.zoom'), 10) || 2, 1, 3);
    G.look = clampLook(JSON.parse(localStorage.getItem('pixelrealm.hero') || 'null') || DEFAULT_LOOK);
  } catch (e) { /* valores por defecto */ }
  Assets.player = getHeroLookSet(G.look);
  resize();
  setupInput(canvas);
  UI.init();

  const fav = document.createElement('link');
  fav.rel = 'icon';
  fav.href = Assets.tiles[T.GRASS][0].toDataURL();
  document.head.appendChild(fav);

  const hasSave = Save.exists();
  if (hasSave) document.getElementById('btn-continue').classList.remove('hidden');
  document.getElementById('btn-continue').addEventListener('click', () => {
    Sfx.init(); Sfx.resume();
    continueGame();
  });
  document.getElementById('btn-new').addEventListener('click', () => {
    Sfx.init(); Sfx.resume();
    if (Save.exists() && !confirm('Se borrará la partida guardada local. ¿Continuar?')) return;
    newGame(document.getElementById('seed-input').value, false);
  });
  document.getElementById('btn-creative').addEventListener('click', () => {
    Sfx.init(); Sfx.resume();
    if (Save.exists() && !confirm('Se borrará la partida guardada local. ¿Continuar?')) return;
    newGame(document.getElementById('seed-input').value, true);
  });
  const b2d = document.getElementById('btn-new-2d');
  if (b2d) b2d.addEventListener('click', () => {
    Sfx.init(); Sfx.resume();
    if (Save.exists() && !confirm('Se borrará la partida guardada local. ¿Continuar?')) return;
    newGame(document.getElementById('seed-input').value, false, 'side');
  });
  const b2dc = document.getElementById('btn-new-2d-creative');
  if (b2dc) b2dc.addEventListener('click', () => {
    Sfx.init(); Sfx.resume();
    if (Save.exists() && !confirm('Se borrará la partida guardada local. ¿Continuar?')) return;
    newGame(document.getElementById('seed-input').value, true, 'side');
  });
  document.getElementById('btn-online').addEventListener('click', () => {
    Sfx.init(); Sfx.resume();
    Net.join(document.getElementById('name-input').value);
  });
  document.getElementById('btn-respawn').addEventListener('click', () => respawn());

  window.addEventListener('beforeunload', () => Save.write());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Save.write();
  });

  // sondea si hay servidor multijugador (en GitHub Pages no lo hay: se oculta el botón)
  if (typeof Net !== 'undefined') Net.probe();

  // pack de texturas opcional (textures/pack.json); si no existe, arte procedural
  loadTexturePack();

  requestAnimationFrame(loop);
}

boot();
