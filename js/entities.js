'use strict';
/* ============ Entidades: jugador, babas, drops, partículas ============ */

const player = {
  x: 0, y: 0,
  dir: 'down', frame: 0, animT: 0, moving: false,
  hp: CFG.PLAYER_MAXHP, maxHp: CFG.PLAYER_MAXHP,
  hitT: 0,        // tiempo hasta el próximo golpe
  swingT: 0,      // animación de golpe
  invuln: 0,      // invulnerabilidad tras recibir daño
  hurtT: 0,       // flash rojo en pantalla
  noDmgT: 99,     // tiempo sin recibir daño (para regenerar)
  regenT: 0,
  dead: false,
  breaking: null, // { tx, ty, id, dmg } objeto que se está rompiendo
};

const mobs = [];
const drops = [];
const particles = [];
const floaters = [];

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

// Mueve por ejes separados: permite deslizarse a lo largo de los muros
function moveEntity(e, dx, dy, r) {
  if (dx !== 0 && !blockedAt(e.x + dx, e.y, r)) e.x += dx;
  if (dy !== 0 && !blockedAt(e.x, e.y + dy, r)) e.y += dy;
}

/* ---------- efectos ---------- */

function spawnDrop(x, y, id, n) {
  drops.push({
    x, y, id, n,
    vx: randRange(-1.4, 1.4), vy: randRange(-1.4, 1.4),
    z: 0.5, vz: randRange(2, 4), age: 0,
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

/* ---------- babas (enemigos nocturnos) ---------- */

function spawnSlime(x, y) {
  mobs.push({
    kind: 'slime', x, y, hp: 4, maxHp: 4,
    vx: 0, vy: 0,
    hopT: randRange(0.5, 1.5),  // tiempo hasta el próximo salto
    hopping: 0,                 // tiempo restante del salto en curso
    hurtT: 0, frame: 0, dead: false,
  });
}

function damageMob(m, dmg) {
  m.hp -= dmg;
  m.hurtT = 0.25;
  Sfx.mobHurt();
  addFloater(m.x, m.y - 0.4, '-' + dmg, '#ffd34d');
  spawnParticles(m.x, m.y, '#6cd44a', 5);
  // retroceso
  const ang = Math.atan2(m.y - player.y, m.x - player.x);
  m.vx = Math.cos(ang) * 5; m.vy = Math.sin(ang) * 5;
  m.hopping = 0.12;
  if (m.hp <= 0) {
    m.dead = true;
    Sfx.poof();
    spawnParticles(m.x, m.y, '#6cd44a', 12);
    spawnDrop(m.x, m.y, 'slime', Math.random() < 0.4 ? 2 : 1);
  }
}

function updateMobs(dt) {
  for (let i = mobs.length - 1; i >= 0; i--) {
    const m = mobs[i];
    if (m.dead) { mobs.splice(i, 1); continue; }
    m.hurtT = Math.max(0, m.hurtT - dt);

    if (m.hopping > 0) {
      m.hopping -= dt;
      moveEntity(m, m.vx * dt, m.vy * dt, 0.3);
      m.frame = 2;
    } else {
      m.frame = m.hopT < 0.18 ? 1 : 0; // se aplasta justo antes de saltar
      m.hopT -= dt;
      if (m.hopT <= 0) {
        const d2p = dist2(m.x, m.y, player.x, player.y);
        let ang;
        if (d2p < 64 && !player.dead) {
          ang = Math.atan2(player.y - m.y, player.x - m.x) + randRange(-0.3, 0.3);
        } else {
          ang = randRange(0, Math.PI * 2);
        }
        const sp = d2p < 64 ? 3.4 : 2.2;
        m.vx = Math.cos(ang) * sp; m.vy = Math.sin(ang) * sp;
        m.hopping = 0.34;
        m.hopT = randRange(0.7, 1.6);
        if (d2p < 220) Sfx.slimeJump();
      }
    }

    // daño por contacto
    if (!player.dead && player.invuln <= 0 && dist2(m.x, m.y, player.x, player.y) < 0.55) {
      damagePlayer(1, m);
    }

    // de día se evaporan poco a poco
    if (G.darkness < 0.3 && Math.random() < dt * 0.12) {
      spawnParticles(m.x, m.y, '#8be07a', 8);
      Sfx.poof();
      mobs.splice(i, 1);
    }
  }
}

/* ---------- jugador ---------- */

function damagePlayer(n, src) {
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
    Sfx.die();
    UI.showDeath();
  }
}

function respawn() {
  player.hp = player.maxHp;
  player.dead = false;
  player.invuln = 2;
  player.noDmgT = 99;
  player.x = G.spawn.x;
  player.y = G.spawn.y;
  mobs.length = 0;
  UI.refreshHearts();
  UI.hideDeath();
  UI.toast('De vuelta al campamento…');
}

/* ---------- drops y partículas ---------- */

function updateDrops(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.age += dt;
    // física vertical con rebote
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
    if (pd < 2.6) { // imán hacia el jugador
      const ang = Math.atan2(player.y - d.y, player.x - d.x);
      d.x += Math.cos(ang) * 6 * dt;
      d.y += Math.sin(ang) * 6 * dt;
    }
    if (pd < 0.2) {
      const left = Inv.add(d.id, d.n);
      const got = d.n - left;
      if (got > 0) {
        Sfx.pickup();
        addFloater(player.x, player.y - 0.7, '+' + got + ' ' + ITEMS[d.id].name, '#ffffff');
        UI.refreshHotbar();
        if (UI.panelOpen) { UI.refreshInv(); UI.refreshCraft(); }
      }
      if (left === 0) drops.splice(i, 1);
      else { d.n = left; d.age = -3; } // inventario lleno: reintenta más tarde
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
