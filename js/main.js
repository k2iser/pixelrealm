'use strict';
/* ============ Bucle principal, ciclo día/noche e interacciones ============ */

let world = null;

const G = {
  running: false,
  online: false,    // espejo de Net.online para módulos que cargan antes
  zoom: 2,          // 1 lejos · 2 cerca (Stardew) · 3 muy cerca
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

function newGame(seedText) {
  Save.clear();
  let seed;
  if (seedText && seedText.trim()) {
    const t = seedText.trim();
    seed = /^-?\d+$/.test(t) ? (parseInt(t, 10) | 0) : (hashStr(t) | 0);
  } else {
    seed = (Math.random() * 0x7fffffff) | 0;
  }
  startWorld(seed, null);
}

function continueGame() {
  const data = Save.read();
  if (!data) { newGame(''); return; }
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
    drops.length = 0;
  }
  world.center = { x: player.x, y: player.y };
  finishStart(data ? 'Partida cargada' : 'Golpea un árbol para conseguir madera (clic izq.)');
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
  }
  drops.length = 0;
  world.center = { x: player.x, y: player.y };
  const osp = safeSpawn(player.x, player.y); // pudieron construir sobre tu posición mientras no estabas
  player.x = osp.x; player.y = osp.y;
  G.online = true;
  if (w.boss) Net.applyBossState(w.boss);
  finishStart('Bienvenido al mundo compartido — sé amable, construid juntos');
}

function finishStart(msg) {
  player.dead = false;
  player.breaking = null;
  player.velX = 0;
  player.velY = 0;
  mobs.length = 0;
  particles.length = 0;
  floaters.length = 0;
  projectiles.length = 0;
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

/* ---------- interacciones ---------- */

// ¿Puede este jugador romper lo que hay en (tx,ty)? (propiedad en multijugador)
function canBreak(tx, ty) {
  if (typeof Net === 'undefined' || !Net.online) return true;
  const anchor = world.buildingAnchor(tx, ty);
  const key = anchor ? (anchor.tx + ',' + anchor.ty) : (tx + ',' + ty);
  const owner = world.owners.get(key);
  if (!owner || owner.id === Net.id) return true;
  UI.toast('Esto lo construyó ' + owner.name + ' — puedes usarlo, no romperlo');
  return false;
}

function doSwing() {
  player.hitT = CFG.HIT_COOLDOWN;
  player.swingT = 0.18;
  const h = hoveredTile();

  const pdx = Input.mx - (w2sx(player.x, player.y) + cam.ox);
  const pdy = Input.my - (w2sy(player.x, player.y) + cam.oy);
  player.dir = Math.abs(pdx) > Math.abs(pdy) ? (pdx > 0 ? 'right' : 'left') : (pdy > 0 ? 'down' : 'up');

  if (dist2(player.x, player.y, h.wx, h.wy) > CFG.REACH * CFG.REACH) {
    player.breaking = null;
    return;
  }

  const sel = Inv.selected();
  const def = sel ? ITEMS[sel.id] : null;

  // 1) ¿el jefe está al alcance del cursor?
  if (G.boss && dist2(G.boss.x, G.boss.y, h.wx, h.wy) < BOSS_CFG.hitbox * BOSS_CFG.hitbox &&
      dist2(player.x, player.y, G.boss.x, G.boss.y) <= (CFG.REACH + 1) * (CFG.REACH + 1)) {
    const dmg = def && def.tool === 'sword' ? def.dmg : (def && def.tool ? 2 : 1);
    damageBoss(dmg);
    player.breaking = null;
    return;
  }

  // 2) ¿hay un enemigo cerca del cursor?
  let best = null, bd = 1.21;
  for (const m of mobs) {
    const d = dist2(m.x, m.y, h.wx, h.wy);
    if (d < bd && dist2(player.x, player.y, m.x, m.y) <= CFG.REACH * CFG.REACH) {
      bd = d; best = m;
    }
  }
  if (best) {
    const dmg = def && def.tool === 'sword' ? def.dmg : (def && def.tool ? 2 : 1);
    damageMob(best, dmg);
    player.breaking = null;
    return;
  }

  // 3) ¿hay un objeto en la casilla apuntada? (los edificios se golpean por cualquier parte)
  let tx = h.tx, ty = h.ty;
  let ob = world.object(tx, ty);
  if (ob === O.PART) {
    const anchor = world.buildingAnchor(tx, ty);
    if (anchor) { tx = anchor.tx; ty = anchor.ty; ob = anchor.id; }
  }
  if (ob === O.NONE) {
    player.breaking = null;
    Sfx.swing();
    return;
  }
  if (!canBreak(tx, ty)) {
    player.breaking = null;
    return;
  }

  const odef = OBJ[ob];
  const dmg = (def && def.tool && def.tool === odef.tool) ? 3 : 1;
  if (!player.breaking || player.breaking.tx !== tx || player.breaking.ty !== ty || player.breaking.id !== ob) {
    player.breaking = { tx, ty, id: ob, dmg: 0 };
  }
  player.breaking.dmg += dmg;

  const stony = ob === O.ROCK || ob === O.WALLS || ob === O.QUARRY || ob === O.BRAZIER || ob === O.ALTAR;
  if (stony) Sfx.mine(); else Sfx.chop();
  spawnParticles(tx + 0.5, ty + 0.5, PART_COLOR[ob] || '#caa178', 5);

  if (player.breaking.dmg >= odef.hp) {
    if (odef.size) {
      world.removeBuilding(tx, ty);
      if (typeof Net !== 'undefined' && Net.online) Net.sendBreakBuilding(tx, ty);
    } else {
      world.setObject(tx, ty, O.NONE);
      if (typeof Net !== 'undefined' && Net.online) Net.sendBreak(tx, ty);
    }
    player.breaking = null;
    Sfx.poof();
    spawnParticles(tx + 0.5, ty + 0.5, PART_COLOR[ob] || '#caa178', 9);
    for (const dr of odef.drops) {
      if (Math.random() < dr[2]) spawnDrop(tx + 0.5, ty + 0.5, dr[0], dr[1]);
    }
  }
}

function tryUseItem() {
  if (!G.running || player.dead || UI.panelOpen || UI.chatOpen) return;
  const h = hoveredTile();
  const inReach = dist2(player.x, player.y, h.wx, h.wy) <= CFG.REACH * CFG.REACH;

  // 1) recoger producción / activar altar (funciona con cualquier cosa en la mano)
  if (inReach) {
    const anchor = world.buildingAnchor(h.tx, h.ty);
    if (anchor) {
      const odef = OBJ[anchor.id];
      if (odef.prod && collectBuilding(anchor)) return;
      if (odef.altar && summonAtAltar(anchor)) return;
    }
  }

  const sel = Inv.selected();
  if (!sel) return;
  const def = ITEMS[sel.id];

  // 2) comer
  if (def.food) {
    if (player.hp >= player.maxHp) { UI.toast('Vida al máximo'); return; }
    player.hp = Math.min(player.maxHp, player.hp + def.food);
    Inv.consumeSelected(1);
    Sfx.eat();
    addFloater(player.x, player.y - 0.5, '+' + def.food, '#7be37b');
    UI.refreshHearts();
    UI.refreshHotbar();
    return;
  }

  // 3) construir
  if (def.place != null) {
    if (!inReach) return;
    const odef = OBJ[def.place];
    const size = odef.size || 1;
    if (!world.canPlaceBuilding(h.tx, h.ty, size)) {
      const gr = world.ground(h.tx, h.ty);
      if (gr === T.DEEP || gr === T.WATER) UI.toast('No puedes construir en el agua');
      return;
    }
    if (odef.solid) {
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          if (overlapsTile(player, 0.3, h.tx + dx, h.ty + dy)) return;
          for (const m of mobs) {
            if (overlapsTile(m, 0.3, h.tx + dx, h.ty + dy)) return;
          }
          // nunca emparedes a otra persona (radio extra por la latencia)
          if (typeof Net !== 'undefined' && Net.online) {
            for (const [, rp] of Net.players) {
              if (overlapsTile(rp, 0.45, h.tx + dx, h.ty + dy) ||
                  overlapsTile({ x: rp.px, y: rp.py }, 0.45, h.tx + dx, h.ty + dy)) {
                UI.toast('Hay alguien ahí');
                return;
              }
            }
          }
        }
      }
    }
    if (odef.size) {
      world.placeBuilding(h.tx, h.ty, def.place, (typeof Net !== 'undefined' && Net.online) ? Net.id : 0);
      if (typeof Net !== 'undefined' && Net.online) Net.sendPlaceBuilding(h.tx, h.ty, def.place);
      if (odef.home) {
        G.spawn = { x: h.tx + size / 2, y: h.ty + size + 0.5 };
        UI.toast('Hogar dulce hogar: reaparecerás aquí');
      }
    } else {
      world.setObject(h.tx, h.ty, def.place);
      if (typeof Net !== 'undefined' && Net.online) Net.sendPlace(h.tx, h.ty, def.place);
    }
    Inv.consumeSelected(1);
    Sfx.place();
    UI.refreshHotbar();
  }
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

function summonAtAltar(anchor) {
  if (G.boss) { UI.toast('El Coloso ya camina sobre el mundo'); return true; }
  if (typeof Net !== 'undefined' && Net.online) {
    Net.requestSummon(anchor.tx, anchor.ty);
    return true;
  }
  const size = OBJ[anchor.id].size || 1;
  spawnBoss(anchor.tx + size / 2, anchor.ty + size + 3, BOSS_CFG.hp);
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
    // --- movimiento: WASD en ejes de PANTALLA, convertido a ejes de mundo ---
    let ix = 0, iy = 0;
    if (!UI.chatOpen) {
      if (Input.keys['w'] || Input.keys['arrowup']) iy -= 1;
      if (Input.keys['s'] || Input.keys['arrowdown']) iy += 1;
      if (Input.keys['a'] || Input.keys['arrowleft']) ix -= 1;
      if (Input.keys['d'] || Input.keys['arrowright']) ix += 1;
    }
    player.moving = ix !== 0 || iy !== 0;
    // aceleración breve: el arranque y la frenada se sienten físicos
    let twx = 0, twy = 0;
    if (player.moving) {
      let wx = ix + 2 * iy, wy = 2 * iy - ix;
      const len = Math.hypot(wx, wy);
      const sp = CFG.PLAYER_SPEED * world.speedAt(Math.floor(player.x), Math.floor(player.y));
      twx = (wx / len) * sp;
      twy = (wy / len) * sp;
      if (Math.abs(ix) > Math.abs(iy)) player.dir = ix > 0 ? 'right' : 'left';
      else if (iy !== 0) player.dir = iy > 0 ? 'down' : 'up';
      player.animT += dt;
    } else {
      player.animT = 0;
    }
    const accK = 1 - Math.pow(0.000001, dt);
    player.velX = (player.velX || 0) + (twx - (player.velX || 0)) * accK;
    player.velY = (player.velY || 0) + (twy - (player.velY || 0)) * accK;
    if (Math.abs(player.velX) > 0.02 || Math.abs(player.velY) > 0.02) {
      moveEntity(player, player.velX * dt, player.velY * dt, 0.3);
      // polvillo en los pies
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

    // pose del héroe: 0 quieto, 1-4 andar, 5 ataque
    if (player.swingT > 0) player.frameI = 5;
    else if (player.moving) player.frameI = 1 + Math.floor(player.animT * 9) % 4;
    else player.frameI = 0;

    player.hitT -= dt;
    if (Input.mdown && !UI.panelOpen && !UI.chatOpen && player.hitT <= 0) doSwing();

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
  if (typeof Net !== 'undefined') Net.update(dt);

  // --- aparición de enemigos por la noche (siempre fuera de la pantalla) ---
  G.spawnTimer -= dt;
  if (G.darkness > 0.5 && mobs.length < CFG.MOB_CAP && G.spawnTimer <= 0 && !player.dead) {
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

  // --- la Noche del Coloso (solo offline; online lo decide el servidor) ---
  if ((typeof Net === 'undefined' || !Net.online) && !G.boss) {
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
    newGame(document.getElementById('seed-input').value);
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
