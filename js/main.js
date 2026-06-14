'use strict';
/* ============ Bucle principal, ciclo día/noche e interacciones ============ */

let world = null;

const G = {
  running: false,
  online: false,    // espejo de Net.online para módulos que cargan antes
  zoom: 2,          // 1 lejos · 2 cerca (Stardew) · 3 muy cerca
  creative: false,  // modo creativo: recursos infinitos, sin daño, romper al instante
  look: DEFAULT_LOOK,
  time: 0.08,       // fracción del día [0,1)
  day: 1,
  elapsed: 0,
  darkness: 0,
  warm: 0,
  shake: 0,
  boss: null,
  bossWarned: false,
  bossNightDone: false,   // ya vino esta noche: que no reaparezca en bucle al matarlo
  saveFailWarned: false,
  spawn: { x: 0.5, y: 0.5 },
  spawnTimer: 0,
  saveTimer: 0,
  minimapTimer: 0,
};

const _towerCd = new Map();   // "tx,ty" -> cooldown restante

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = Math.ceil(window.innerWidth / G.zoom);
  canvas.height = Math.ceil(window.innerHeight / G.zoom);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);

function setZoom(z) {
  G.zoom = clamp(z | 0, 1, 3);
  try { localStorage.setItem('pixelrealm.zoom', G.zoom); } catch (e) { /* da igual */ }
  const oldW = canvas.width, oldH = canvas.height;
  resize();
  // reescala el cursor a la nueva resolución interna (hasta el próximo mousemove)
  Input.mx *= canvas.width / oldW;
  Input.my *= canvas.height / oldH;
  UI.toast('Zoom: ' + ['lejos', 'cerca', 'muy cerca'][G.zoom - 1]);
}

/* ---------- arranque de partidas ---------- */

function newGame(seedText, creative) {
  Save.clear();
  let seed;
  if (seedText && seedText.trim()) {
    const t = seedText.trim();
    seed = /^-?\d+$/.test(t) ? (parseInt(t, 10) | 0) : (hashStr(t) | 0);
  } else {
    seed = (Math.random() * 0x7fffffff) | 0;
  }
  G.creative = !!creative;
  startWorld(seed, null);
}

function continueGame() {
  const data = Save.read();
  if (!data) { newGame(''); return; }
  G.creative = !!data.creative;
  startWorld(data.seed, data);
}

function startWorld(seed, data) {
  world = new World(seed);
  if (data) {
    world.applyModified(data.chunks || {});
    world.applyBuildings(data.buildings || {});
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
  world.center = { x: player.x, y: player.y };
  finishStart(data ? 'Partida cargada' : (G.creative ? 'Modo creativo: clic para moverte, recursos infinitos' : 'Clic izquierdo para moverte y recolectar · busca una aldea'));
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
  if (w.boss) Net.applyBossState(w.boss);
  finishStart('Bienvenido al mundo compartido — sé amable, construid juntos');
}

function finishStart(msg) {
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
  UI.toast(msg);
}

/* ---------- ciclo día/noche ---------- */

function computeLight() {
  const t = G.time;
  let dark = 0, warm = 0;
  if (t < 0.45) { dark = 0; }
  else if (t < 0.55) { const p = (t - 0.45) / 0.1; dark = p; warm = Math.sin(p * Math.PI); }
  else if (t < 0.90) { dark = 1; }
  else { const p = (t - 0.90) / 0.1; dark = 1 - p; warm = Math.sin(p * Math.PI); }
  G.darkness = dark;
  G.warm = warm;
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
  const dmg = G.creative ? odef.hp : ((def && def.tool && def.tool === odef.tool) ? 3 : 1);
  if (!player.breaking || player.breaking.tx !== tx || player.breaking.ty !== ty || player.breaking.id !== ob) {
    player.breaking = { tx, ty, id: ob, dmg: 0 };
  }
  player.breaking.dmg += dmg;
  const stony = ob === O.ROCK || ob === O.WALLS || ob === O.QUARRY || ob === O.BRAZIER || ob === O.ALTAR || ob === O.WELL;
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
  if (!def || def.place == null) {
    // sin nada colocable: recoge la producción del edificio bajo el cursor si está cerca
    const a = world.buildingAnchor(h.tx, h.ty);
    if (a && OBJ[a.id].prod && dist2(player.x, player.y, h.wx, h.wy) <= effReach() * effReach()) collectBuilding(a);
    return;
  }
  if (dist2(player.x, player.y, h.wx, h.wy) <= effReach() * effReach()) {
    placeAt(h.tx, h.ty);
  } else {
    player.cmd = { type: 'use', tx: h.tx, ty: h.ty };
    player.path = Path.findAdjacent(player.x, player.y, h.tx, h.ty, OBJ[def.place].size || 1) || [];
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

function playerSpeed() { return CFG.PLAYER_SPEED * world.speedAt(Math.floor(player.x), Math.floor(player.y)); }

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
  if (c.type === 'use') { player.cmd = null; placeAt(c.tx, c.ty); return [0, 0]; }
  if (c.type === 'collect') {
    if (dist2(player.x, player.y, c.tx + 0.5, c.ty + 0.5) <= rr * rr) {
      const a = world.buildingAnchor(c.tx, c.ty);
      if (a && OBJ[a.id].prod) collectBuilding(a);
    }
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
      moveEntity(player, player.velX * dt, player.velY * dt, 0.3);
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
    if (player.moving) player.animT += dt; else player.animT = 0;

    // pose del héroe: 0 quieto, 1-4 andar, 5 ataque
    if (player.swingT > 0) player.frameI = 5;
    else if (player.moving) player.frameI = 1 + Math.floor(player.animT * 9) % 4;
    else player.frameI = 0;

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
        exPx > 1e-6 ? (canvas.width / 2 + 64) / exPx : Infinity,
        eyPx > 1e-6 ? (canvas.height / 2 + 96) / eyPx : Infinity,
      );
      const d = Math.max(randRange(9, 22), dEdge + randRange(1, 5));
      const x = player.x + Math.cos(ang) * d;
      const y = player.y + Math.sin(ang) * d;
      const ssx = w2sx(x, y) + cam.ox, ssy = w2sy(x, y) + cam.oy;
      if (ssx > -64 && ssx < canvas.width + 64 && ssy > -96 && ssy < canvas.height + 64) continue;
      const tx = Math.floor(x), ty = Math.floor(y);
      const gr = world.ground(tx, ty);
      if (gr !== T.DEEP && gr !== T.WATER && !world.isSolid(tx, ty)) {
        spawnMob(pickMobKind(), x, y);
        break;
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

  // --- autoguardado ---
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

  G.minimapTimer -= dt;
  if (G.minimapTimer <= 0) {
    G.minimapTimer = 0.5;
    UI.renderMinimap();
  }

  UI.setTime();
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
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - _last) / 1000;
  _last = now;
  if (dt > 0.05) dt = 0.05;
  if (!G.running || !world) return;
  update(dt);
  updateCamera(dt, canvas.width, canvas.height);
  render(ctx, canvas.width, canvas.height);
}

/* ---------- inicio ---------- */

function boot() {
  buildAssets();
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
