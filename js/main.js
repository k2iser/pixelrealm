'use strict';
/* ============ Bucle principal, ciclo día/noche e interacciones ============ */

let world = null;

const G = {
  running: false,
  time: 0.08,       // fracción del día [0,1)
  day: 1,
  elapsed: 0,       // segundos desde el arranque (para animaciones)
  darkness: 0,      // 0 = día, 1 = noche cerrada
  warm: 0,          // intensidad del tinte de amanecer/atardecer
  spawn: { x: 0.5, y: 0.5 },
  spawnTimer: 0,
  saveTimer: 0,
  minimapTimer: 0,
};

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

function resize() {
  // resolución interna baja -> CSS la escala con nitidez de píxel
  const scale = Math.max(2, Math.round(window.innerWidth / 640));
  canvas.width = Math.ceil(window.innerWidth / scale);
  canvas.height = Math.ceil(window.innerHeight / scale);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);

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
    G.time = data.time;
    G.day = data.day;
    G.spawn = data.spawn || world.findSpawn();
    player.x = data.player.x;
    player.y = data.player.y;
    player.hp = data.player.hp;
    Inv.slots = (data.inv || []).map(s => (s && ITEMS[s.id]) ? { id: s.id, n: s.n } : null);
    while (Inv.slots.length < 36) Inv.slots.push(null);
    Inv.slots.length = 36;
    Inv.sel = data.sel || 0;
  } else {
    G.time = 0.08;
    G.day = 1;
    G.spawn = world.findSpawn();
    player.x = G.spawn.x;
    player.y = G.spawn.y;
    player.hp = player.maxHp;
    Inv.slots = new Array(36).fill(null);
    Inv.sel = 0;
    Inv.add('berry', 3); // un pequeño tentempié de bienvenida
  }
  world.center = { x: player.x, y: player.y };
  player.dead = false;
  player.breaking = null;
  mobs.length = 0;
  drops.length = 0;
  particles.length = 0;
  floaters.length = 0;
  cam.init = false;
  G.saveTimer = 0;
  G.running = true;
  UI.hideTitle();
  UI.refreshAll();
  UI.renderMinimap();
  UI.toast(data ? 'Partida cargada' : 'Golpea un árbol para conseguir madera (clic izq.)');
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

function doSwing() {
  player.hitT = CFG.HIT_COOLDOWN;
  const h = hoveredTile();

  // mirar hacia el cursor
  const pdx = Input.mx - (w2sx(player.x, player.y) + cam.ox);
  const pdy = Input.my - (w2sy(player.x, player.y) + cam.oy);
  player.dir = Math.abs(pdx) > Math.abs(pdy) ? (pdx > 0 ? 'right' : 'left') : (pdy > 0 ? 'down' : 'up');

  if (dist2(player.x, player.y, h.wx, h.wy) > CFG.REACH * CFG.REACH) {
    player.breaking = null;
    return;
  }

  const sel = Inv.selected();
  const def = sel ? ITEMS[sel.id] : null;

  // 1) ¿hay una baba cerca del cursor?
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

  // 2) ¿hay un objeto en la casilla apuntada?
  const ob = world.object(h.tx, h.ty);
  if (ob === O.NONE) {
    player.breaking = null;
    Sfx.swing();
    return;
  }

  const odef = OBJ[ob];
  const dmg = (def && def.tool && def.tool === odef.tool) ? 3 : 1;
  if (!player.breaking || player.breaking.tx !== h.tx || player.breaking.ty !== h.ty || player.breaking.id !== ob) {
    player.breaking = { tx: h.tx, ty: h.ty, id: ob, dmg: 0 };
  }
  player.breaking.dmg += dmg;

  const stony = ob === O.ROCK || ob === O.WALLS;
  if (stony) Sfx.mine(); else Sfx.chop();
  spawnParticles(h.tx + 0.5, h.ty + 0.5, PART_COLOR[ob] || '#caa178', 5);

  if (player.breaking.dmg >= odef.hp) {
    world.setObject(h.tx, h.ty, O.NONE);
    player.breaking = null;
    Sfx.poof();
    spawnParticles(h.tx + 0.5, h.ty + 0.5, PART_COLOR[ob] || '#caa178', 9);
    for (const dr of odef.drops) {
      if (Math.random() < dr[2]) spawnDrop(h.tx + 0.5, h.ty + 0.5, dr[0], dr[1]);
    }
  }
}

function tryUseItem() {
  if (!G.running || player.dead || UI.panelOpen) return;
  const sel = Inv.selected();
  if (!sel) return;
  const def = ITEMS[sel.id];

  // comer
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

  // construir
  if (def.place != null) {
    const h = hoveredTile();
    if (dist2(player.x, player.y, h.wx, h.wy) > CFG.REACH * CFG.REACH) return;
    const gr = world.ground(h.tx, h.ty);
    if (gr === T.DEEP || gr === T.WATER) { UI.toast('No puedes construir en el agua'); return; }
    if (world.object(h.tx, h.ty) !== O.NONE) return;
    if (OBJ[def.place].solid) {
      if (Math.floor(player.x) === h.tx && Math.floor(player.y) === h.ty) return;
      for (const m of mobs) {
        if (Math.floor(m.x) === h.tx && Math.floor(m.y) === h.ty) return;
      }
    }
    world.setObject(h.tx, h.ty, def.place);
    Inv.consumeSelected(1);
    Sfx.place();
    UI.refreshHotbar();
  }
}

/* ---------- actualización por frame ---------- */

function update(dt) {
  G.elapsed += dt;
  G.time += dt / CFG.DAY_LENGTH;
  if (G.time >= 1) {
    G.time -= 1;
    G.day++;
    UI.toast('Día ' + G.day);
  }
  computeLight();
  world.center.x = player.x;
  world.center.y = player.y;

  if (!player.dead) {
    // --- movimiento: WASD en ejes de PANTALLA, convertido a ejes de mundo ---
    let ix = 0, iy = 0;
    if (Input.keys['w'] || Input.keys['arrowup']) iy -= 1;
    if (Input.keys['s'] || Input.keys['arrowdown']) iy += 1;
    if (Input.keys['a'] || Input.keys['arrowleft']) ix -= 1;
    if (Input.keys['d'] || Input.keys['arrowright']) ix += 1;
    player.moving = ix !== 0 || iy !== 0;
    if (player.moving) {
      let wx = ix + 2 * iy, wy = 2 * iy - ix;
      const len = Math.hypot(wx, wy);
      wx /= len; wy /= len;
      const sp = CFG.PLAYER_SPEED * world.speedAt(Math.floor(player.x), Math.floor(player.y));
      moveEntity(player, wx * sp * dt, wy * sp * dt, 0.3);
      if (ix !== 0 || iy !== 0) {
        if (Math.abs(ix) > Math.abs(iy)) player.dir = ix > 0 ? 'right' : 'left';
        else player.dir = iy > 0 ? 'down' : 'up';
      }
      player.animT += dt;
      player.frame = Math.floor(player.animT * 7) % 2 === 0 ? 1 : 2;
    } else {
      player.animT = 0;
      player.frame = 0;
    }

    // --- golpear manteniendo el botón ---
    player.hitT -= dt;
    if (Input.mdown && !UI.panelOpen && player.hitT <= 0) doSwing();

    // --- temporizadores ---
    player.invuln = Math.max(0, player.invuln - dt);
    player.hurtT = Math.max(0, player.hurtT - dt);
    player.swingT = Math.max(0, player.swingT - dt);
    player.noDmgT += dt;

    // regeneración lenta si llevas un rato sin recibir daño
    if (player.hp < player.maxHp && player.noDmgT > 10) {
      player.regenT += dt;
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
  updateDrops(dt);
  updateParticles(dt);
  updateFloaters(dt);

  // --- aparición de babas por la noche ---
  G.spawnTimer -= dt;
  if (G.darkness > 0.5 && mobs.length < CFG.MOB_CAP && G.spawnTimer <= 0 && !player.dead) {
    G.spawnTimer = 2.5;
    for (let i = 0; i < 6; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = randRange(9, 15);
      const x = player.x + Math.cos(ang) * d;
      const y = player.y + Math.sin(ang) * d;
      const tx = Math.floor(x), ty = Math.floor(y);
      const gr = world.ground(tx, ty);
      if (gr !== T.DEEP && gr !== T.WATER && !world.isSolid(tx, ty)) {
        spawnSlime(x, y);
        break;
      }
    }
  }

  // --- autoguardado ---
  G.saveTimer += dt;
  if (G.saveTimer > CFG.AUTOSAVE) {
    G.saveTimer = 0;
    Save.write();
    UI.toast('Partida guardada');
  }

  // --- minimapa cada medio segundo ---
  G.minimapTimer -= dt;
  if (G.minimapTimer <= 0) {
    G.minimapTimer = 0.5;
    UI.renderMinimap();
  }

  UI.setTime();
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
  resize();
  setupInput(canvas);
  UI.init();

  // favicon: una casilla de hierba generada al vuelo
  const fav = document.createElement('link');
  fav.rel = 'icon';
  fav.href = Assets.tiles[T.GRASS][0].toDataURL();
  document.head.appendChild(fav);

  // pantalla de título
  const hasSave = Save.exists();
  if (hasSave) document.getElementById('btn-continue').classList.remove('hidden');
  document.getElementById('btn-continue').addEventListener('click', () => {
    Sfx.init(); Sfx.resume();
    continueGame();
  });
  document.getElementById('btn-new').addEventListener('click', () => {
    Sfx.init(); Sfx.resume();
    if (Save.exists() && !confirm('Se borrará la partida guardada. ¿Continuar?')) return;
    newGame(document.getElementById('seed-input').value);
  });
  document.getElementById('btn-respawn').addEventListener('click', () => respawn());

  // guardar al salir o al ocultar la pestaña
  window.addEventListener('beforeunload', () => Save.write());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Save.write();
  });

  requestAnimationFrame(loop);
}

boot();
