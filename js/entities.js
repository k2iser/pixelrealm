'use strict';
/* ============ Entidades: jugador, enemigos, jefe, drops, partículas ============ */

const player = {
  x: 0, y: 0,
  dir: 'down', frameI: 0, animT: 0, moving: false,
  _lastDir: 'down', _dirFlash: 0, pickT: 0,  // animación procedural (respingo de giro / saltito)
  hp: CFG.PLAYER_MAXHP, maxHp: CFG.PLAYER_MAXHP,
  hitT: 0,        // tiempo hasta el próximo golpe
  swingT: 0,      // animación de golpe
  invuln: 0,      // invulnerabilidad tras recibir daño
  hurtT: 0,       // flash rojo en pantalla
  noDmgT: 99,     // tiempo sin recibir daño (para regenerar)
  regenT: 0,
  dustT: 0,       // polvillo al caminar
  velX: 0, velY: 0,
  dead: false,
  breaking: null, // { tx, ty, id, dmg } objeto que se está rompiendo
  path: null,     // waypoints del click-to-move
  cmd: null,      // { type, tx, ty, mob, npc } orden tras llegar
  drag: false,    // arrastrando con el ratón mantenido
};

const mobs = [];
const drops = [];
const particles = [];
const floaters = [];
const projectiles = [];

/* ---------- colisión ---------- */

function blockedAt(x, y, r) {
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (world.isSolid(tx, ty)) return true;
    }
  }
  return false;
}

// ¿El cuerpo de la entidad (radio r) solapa la casilla (tx,ty)?
// Usa la misma cobertura floor(x±r) que blockedAt: si esto da false,
// colocar un sólido ahí nunca puede emparedar a la entidad.
function overlapsTile(e, r, tx, ty) {
  return tx >= Math.floor(e.x - r) && tx <= Math.floor(e.x + r) &&
         ty >= Math.floor(e.y - r) && ty <= Math.floor(e.y + r);
}

// Mueve por ejes separados: permite deslizarse a lo largo de los muros
function moveEntity(e, dx, dy, r) {
  if (dx !== 0 && !blockedAt(e.x + dx, e.y, r)) e.x += dx;
  if (dy !== 0 && !blockedAt(e.x, e.y + dy, r)) e.y += dy;
}

// Punto de aparición garantizado: si el destino quedó bloqueado (un muro,
// el edificio de otro jugador…), busca en espiral la casilla libre más cercana.
function safeSpawn(sx, sy) {
  if (!blockedAt(sx, sy, 0.3)) return { x: sx, y: sy };
  for (let rad = 1; rad < 48; rad++) {
    const steps = rad * 8;
    for (let a = 0; a < steps; a++) {
      const ang = a / steps * Math.PI * 2;
      const x = Math.floor(sx + Math.cos(ang) * rad) + 0.5;
      const y = Math.floor(sy + Math.sin(ang) * rad) + 0.5;
      if (!blockedAt(x, y, 0.3)) return { x, y };
    }
  }
  return world.findSpawn();
}

/* ---------- efectos ---------- */

function spawnDrop(x, y, id, n) {
  drops.push({
    x, y, id, n,
    vx: randRange(-1.4, 1.4), vy: randRange(-1.4, 1.4),
    z: 0.5, vz: randRange(2, 4), age: 0, ttl: 0,
  });
}

function spawnParticles(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    particles.push({
      x: x + randRange(-0.2, 0.2), y: y + randRange(-0.2, 0.2),
      vx: randRange(-2, 2), vy: randRange(-2, 2),
      z: 0.4, vz: randRange(1.5, 4),
      life: randRange(0.3, 0.65), maxLife: 0.65,
      color,
    });
  }
}

function addFloater(x, y, text, color) {
  floaters.push({ x, y, text, color, life: 1.1 });
}

/* ---------- enemigos ---------- */

function spawnMob(kind, x, y) {
  const def = MOBS[kind];
  if (!def) return;
  mobs.push({
    kind, x, y, hp: def.hp, maxHp: def.hp,
    vx: 0, vy: 0,
    hopT: randRange(0.5, 1.5), hopping: 0,
    wanderT: 0, wAng: randRange(0, Math.PI * 2), grazeMove: false, flip: false,
    t: Math.random() * 10,
    hurtT: 0, frame: 0, dead: false,
  });
}

// Elige un tipo de enemigo según los pesos de MOBS
function pickMobKind() {
  let r = Math.random(), acc = 0;
  for (const k in MOBS) {
    acc += MOBS[k].weight;
    if (r <= acc) return k;
  }
  return 'slime';
}

function damageMob(m, dmg) {
  m.hp -= dmg;
  m.hurtT = 0.25;
  Sfx.mobHurt();
  addFloater(m.x, m.y - 0.4, '-' + dmg, '#ffd34d');
  const pc = MOBS[m.kind].passive ? '#cf573c' : (m.kind === 'shadow' ? '#6a5f96' : (m.kind === 'bat' ? '#56487a' : '#6cd44a'));
  spawnParticles(m.x, m.y, pc, 5);
  const ang = Math.atan2(m.y - player.y, m.x - player.x);
  m.vx = Math.cos(ang) * 5; m.vy = Math.sin(ang) * 5;
  m.hopping = 0.12;
  if (m.hp <= 0) {
    m.dead = true;
    Sfx.poof();
    spawnParticles(m.x, m.y, pc, 12);
    for (const dr of MOBS[m.kind].drops) {
      if (Math.random() < dr[2]) spawnDrop(m.x, m.y, dr[0], dr[1]);
    }
  }
}

function mobContact(m, def) {
  if (!player.dead && player.invuln <= 0 && dist2(m.x, m.y, player.x, player.y) < 0.55) {
    damagePlayer(def.dmg, m);
  }
}

function updateMobs(dt) {
  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i];
    if (m.dead) { mobs.splice(i, 1); continue; }
    const def = MOBS[m.kind];
    m.hurtT = Math.max(0, m.hurtT - dt);
    m.t += dt;

    if (def.ai === 'hop') {
      // --- baba: salta hacia el jugador ---
      if (m.hopping > 0) {
        m.hopping -= dt;
        moveEntity(m, m.vx * dt, m.vy * dt, 0.3);
        m.frame = 2;
      } else {
        m.frame = m.hopT < 0.18 ? 1 : 0;
        m.hopT -= dt;
        if (m.hopT <= 0) {
          const d2p = dist2(m.x, m.y, player.x, player.y);
          let ang;
          if (d2p < 64 && !player.dead) {
            ang = Math.atan2(player.y - m.y, player.x - m.x) + randRange(-0.3, 0.3);
          } else {
            ang = randRange(0, Math.PI * 2);
          }
          const sp = d2p < 64 ? def.speed : def.speed * 0.65;
          m.vx = Math.cos(ang) * sp; m.vy = Math.sin(ang) * sp;
          m.hopping = 0.34;
          m.hopT = randRange(0.7, 1.6);
          if (d2p < 220) Sfx.slimeJump();
        }
      }
    } else if (def.ai === 'walk') {
      // --- sombra: camina sin pausa, con un vaivén inquietante ---
      const d2p = dist2(m.x, m.y, player.x, player.y);
      let ang;
      if (d2p < 110 && !player.dead) {
        ang = Math.atan2(player.y - m.y, player.x - m.x) + Math.sin(m.t * 2.2) * 0.35;
      } else {
        m.wanderT -= dt;
        if (m.wanderT <= 0) { m.wanderT = randRange(1.5, 3); m.wAng = randRange(0, Math.PI * 2); }
        ang = m.wAng;
      }
      moveEntity(m, Math.cos(ang) * def.speed * dt, Math.sin(ang) * def.speed * dt, 0.3);
      m.frame = Math.floor(m.t * 4) % 2;
      // arde de día
      if (G.darkness < 0.3 && Math.random() < dt * 0.5) {
        spawnParticles(m.x, m.y, '#6a5f96', 10);
        Sfx.poof();
        mobs.splice(i, 1);
        continue;
      }
    } else if (def.ai === 'fly') {
      // --- murciélago: vuela en oleadas, ignora los obstáculos ---
      const d2p = dist2(m.x, m.y, player.x, player.y);
      if (d2p < 140 && !player.dead) {
        const ang = Math.atan2(player.y - m.y, player.x - m.x);
        const weave = Math.sin(m.t * 5) * 1.6;
        m.x += (Math.cos(ang) * def.speed + Math.cos(ang + Math.PI / 2) * weave) * dt;
        m.y += (Math.sin(ang) * def.speed + Math.sin(ang + Math.PI / 2) * weave) * dt;
      } else {
        m.x += Math.cos(m.t * 1.3) * def.speed * 0.5 * dt;
        m.y += Math.sin(m.t * 0.9) * def.speed * 0.5 * dt;
      }
      m.frame = Math.floor(m.t * 9) % 2;
    } else if (def.ai === 'graze') {
      // --- fauna: pasta tranquila y huye del jugador ---
      const d2p = dist2(m.x, m.y, player.x, player.y);
      const fleeR = def.fleeR || 6;
      let mvx = 0, mvy = 0;
      if (d2p < fleeR * fleeR && !player.dead) {
        const ang = Math.atan2(m.y - player.y, m.x - player.x);   // huir en línea recta
        mvx = Math.cos(ang) * def.speed; mvy = Math.sin(ang) * def.speed;
        m.frame = Math.floor(m.t * 10) % 2;
      } else {
        m.wanderT -= dt;
        if (m.wanderT <= 0) { m.wanderT = randRange(2, 5); m.grazeMove = Math.random() < 0.5; m.wAng = randRange(0, Math.PI * 2); }
        if (m.grazeMove) { mvx = Math.cos(m.wAng) * def.speed * 0.4; mvy = Math.sin(m.wAng) * def.speed * 0.4; m.frame = Math.floor(m.t * 5) % 2; }
        else m.frame = 0;
      }
      if (mvx || mvy) {
        moveEntity(m, mvx * dt, mvy * dt, 0.3);
        const sdx = mvx - mvy;                                     // mira según el eje X de pantalla
        if (Math.abs(sdx) > 0.05) m.flip = sdx < 0;
      }
    }

    if (def.dmg > 0) mobContact(m, def);

    if (def.passive) {
      // la fauna duerme de noche: se retira al oscurecer o si está lejísimos
      if ((G.darkness > 0.5 && Math.random() < dt * 0.2) || dist2(m.x, m.y, player.x, player.y) > 60 * 60) {
        mobs.splice(i, 1);
      }
    } else if (def.ai !== 'walk' && G.darkness < 0.3 && Math.random() < dt * 0.12) {
      // los nocturnos hostiles se evaporan de día (las sombras ya arden antes)
      spawnParticles(m.x, m.y, '#8be07a', 8);
      Sfx.poof();
      mobs.splice(i, 1);
    }
  }
}

/* ---------- El Coloso de Baba ---------- */

function spawnBoss(x, y, maxHp) {
  G.boss = {
    x, y,
    hp: maxHp || BOSS_CFG.hp, maxHp: maxHp || BOSS_CFG.hp,
    vx: 0, vy: 0,
    hopT: 1.2, hopping: 0,
    minionT: BOSS_CFG.minionEvery,
    hurtT: 0, frame: 0, enraged: false,
    remote: false,   // en multijugador lo simula el servidor
    rx: x, ry: y,    // posición objetivo para interpolar en MP
  };
  G.shake = 0.5;
  Sfx.bossRoar();
  UI.toast('¡' + BOSS_CFG.name + ' ha despertado!');
  UI.showBossBar();
}

function bossLand(b) {
  G.shake = Math.max(G.shake, 0.35);
  Sfx.bossSlam();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    particles.push({
      x: b.x + Math.cos(a) * 0.8, y: b.y + Math.sin(a) * 0.8,
      vx: Math.cos(a) * 4, vy: Math.sin(a) * 4,
      z: 0.1, vz: randRange(0.5, 1.5),
      life: 0.5, maxLife: 0.5, color: '#bdb39a',
    });
  }
  if (!player.dead && dist2(b.x, b.y, player.x, player.y) < BOSS_CFG.slamRadius * BOSS_CFG.slamRadius) {
    damagePlayer(BOSS_CFG.dmg, b);
  }
}

function updateBoss(dt) {
  const b = G.boss;
  if (!b) return;
  b.hurtT = Math.max(0, b.hurtT - dt);

  if (b.remote) {
    // multijugador: interpola hacia el estado del servidor
    b.x += (b.rx - b.x) * Math.min(1, dt * 8);
    b.y += (b.ry - b.y) * Math.min(1, dt * 8);
    b.frame = b.hopping > 0 ? 2 : 0;
    b.hopping = Math.max(0, b.hopping - dt);
    // el contacto con su cuerpo duele igual que offline
    if (!player.dead && player.invuln <= 0 && dist2(b.x, b.y, player.x, player.y) < 1.2) {
      damagePlayer(1, b);
    }
    return;
  }

  b.enraged = b.hp < b.maxHp * BOSS_CFG.enrageAt;
  const speedK = b.enraged ? 1.5 : 1;

  if (b.hopping > 0) {
    b.hopping -= dt;
    b.x += b.vx * dt; b.y += b.vy * dt;   // el Coloso no respeta los muros: es un coloso
    b.frame = 2;
    if (b.hopping <= 0) bossLand(b);
  } else {
    b.frame = b.hopT < 0.25 ? 1 : 0;
    b.hopT -= dt * speedK;
    if (b.hopT <= 0) {
      const ang = Math.atan2(player.y - b.y, player.x - b.x) + randRange(-0.15, 0.15);
      b.vx = Math.cos(ang) * BOSS_CFG.hopSpeed * speedK;
      b.vy = Math.sin(ang) * BOSS_CFG.hopSpeed * speedK;
      b.hopping = BOSS_CFG.hopTime;
    }
  }

  // oleadas de esbirros
  b.minionT -= dt;
  if (b.minionT <= 0) {
    b.minionT = BOSS_CFG.minionEvery;
    for (let i = 0; i < 2; i++) {
      if (mobs.length < CFG.MOB_CAP + 4) {
        spawnMob('slime', b.x + randRange(-1.5, 1.5), b.y + randRange(-1.5, 1.5));
      }
    }
    spawnParticles(b.x, b.y, '#6cd44a', 10);
  }

  // contacto directo con el cuerpo
  if (!player.dead && player.invuln <= 0 && dist2(b.x, b.y, player.x, player.y) < 1.2) {
    damagePlayer(1, b);
  }
}

function damageBoss(dmg) {
  const b = G.boss;
  if (!b) return;
  if (typeof Net !== 'undefined' && Net.online) {
    Net.sendBossHit(dmg);                 // el servidor lleva la cuenta
    b.hurtT = 0.2;
    addFloater(b.x, b.y - 1.2, '-' + dmg, '#ffd34d');
    spawnParticles(b.x, b.y, '#6cd44a', 6);
    Sfx.mobHurt();
    return;
  }
  b.hp -= dmg;
  b.hurtT = 0.2;
  addFloater(b.x, b.y - 1.2, '-' + dmg, '#ffd34d');
  spawnParticles(b.x, b.y, '#6cd44a', 6);
  Sfx.mobHurt();
  UI.updateBossBar();
  if (b.hp <= 0) killBoss();
}

function killBoss() {
  const b = G.boss;
  if (!b) return;
  for (const [id, n, p] of BOSS_CFG.loot) {
    if (Math.random() < p) {
      for (let i = 0; i < n; i++) {
        spawnDrop(b.x + randRange(-1.5, 1.5), b.y + randRange(-1.5, 1.5), id, 1);
      }
    }
  }
  spawnParticles(b.x, b.y, '#6cd44a', 40);
  spawnParticles(b.x, b.y, '#e8c14d', 20);
  G.shake = 0.6;
  Sfx.bossDie();
  G.boss = null;
  UI.hideBossBar();
  UI.toast('¡' + BOSS_CFG.name + ' ha caído! La noche respira aliviada.');
}

/* ---------- torres: proyectiles ---------- */

// auth: en multijugador solo un cliente por torre informa del daño al jefe
// (cada cliente simula sus propias flechas; sin esto el daño se multiplicaría)
function spawnArrow(x, y, txx, tyy, dmg, auth) {
  const ang = Math.atan2(tyy - y, txx - x);
  projectiles.push({
    x, y, ang,
    vx: Math.cos(ang) * 10, vy: Math.sin(ang) * 10,
    life: 1.2, dmg, auth: auth !== false,
  });
  Sfx.arrow();
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    let hit = p.life <= 0;
    if (!hit) {
      for (const m of mobs) {
        if (!m.dead && dist2(m.x, m.y, p.x, p.y) < 0.22) {
          damageMob(m, p.dmg);
          hit = true;
          break;
        }
      }
      if (!hit && G.boss && dist2(G.boss.x, G.boss.y, p.x, p.y) < 1.2) {
        if (p.auth) damageBoss(p.dmg);
        else { spawnParticles(p.x, p.y, '#6cd44a', 4); } // impacto visual; el daño lo informa otro cliente
        hit = true;
      }
    }
    if (hit) projectiles.splice(i, 1);
  }
}

/* ---------- jugador ---------- */

function damagePlayer(n, src) {
  if (G.creative) return;                 // en creativo no recibes daño
  if (player.invuln > 0 || player.dead) return;
  player.hp -= n;
  player.invuln = 0.8;
  player.hurtT = 0.35;
  player.noDmgT = 0;
  Sfx.hurt();
  spawnParticles(player.x, player.y, '#d83434', 6);
  if (src) {
    const ang = Math.atan2(player.y - src.y, player.x - src.x);
    moveEntity(player, Math.cos(ang) * 0.5, Math.sin(ang) * 0.5, 0.3);
  }
  UI.refreshHearts();
  if (player.hp <= 0) {
    player.hp = 0;
    player.dead = true;
    UI.closeNpc();   // si moriste hablando, cierra el diálogo: si no, dialogOpen bloquearía el movimiento al reaparecer
    Sfx.die();
    UI.showDeath();
  }
}

function respawn() {
  player.hp = player.maxHp;
  player.dead = false;
  player.invuln = 2;
  player.noDmgT = 99;
  const sp = safeSpawn(G.spawn.x, G.spawn.y); // sin tocar G.spawn: si liberan el sitio, vuelves a tu cabaña
  player.x = sp.x;
  player.y = sp.y;
  player.velX = 0; // sin deslizamiento fantasma de la inercia previa
  player.velY = 0;
  mobs.length = 0;
  UI.closeNpc();   // defensa: nunca reaparecer con el diálogo abierto (bloquearía teclado/clic)
  UI.refreshHearts();
  UI.hideDeath();
  UI.toast('De vuelta al campamento…');
}

/* ---------- drops y partículas ---------- */

function updateDrops(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.age += dt;
    d.ttl += dt;
    if (d.ttl > CFG.DROP_TTL || dist2(d.x, d.y, player.x, player.y) > 48 * 48) {
      drops.splice(i, 1);
      continue;
    }
    d.vz -= 12 * dt;
    d.z += d.vz * dt;
    if (d.z <= 0) {
      d.z = 0;
      d.vz = Math.abs(d.vz) > 0.5 ? -d.vz * 0.4 : 0;
      d.vx *= 0.8; d.vy *= 0.8;
    }
    d.x += d.vx * dt; d.y += d.vy * dt;

    if (player.dead || d.age < 0.4) continue;
    const pd = dist2(d.x, d.y, player.x, player.y);
    if (pd < 2.6) {
      const ang = Math.atan2(player.y - d.y, player.x - d.x);
      d.x += Math.cos(ang) * 6 * dt;
      d.y += Math.sin(ang) * 6 * dt;
    }
    if (pd < 0.2) {
      const left = Inv.add(d.id, d.n);
      const got = d.n - left;
      if (got > 0) {
        Sfx.pickup();
        player.pickT = 0.25;   // saltito de alegría (lo anima computeLivePose)
        addFloater(player.x, player.y - 0.7, '+' + got + ' ' + ITEMS[d.id].name, '#ffffff');
        UI.refreshHotbar();
        if (UI.panelOpen) { UI.refreshInv(); UI.refreshCraft(); }
      }
      if (left === 0) drops.splice(i, 1);
      else { d.n = left; d.age = -3; }
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.vz -= 10 * dt;
    p.z += p.vz * dt;
    if (p.z < 0) { p.z = 0; p.vz = 0; }
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
}

function updateFloaters(dt) {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    f.y -= dt * 0.8;
    if (f.life <= 0) floaters.splice(i, 1);
  }
}
