'use strict';
/* ============ Criaturas del modo 2D: dinosaurios ============
   Herbívoros pacíficos (vagan/pastan, huyen al ser golpeados) y carnívoros
   hostiles (persiguen y atacan al jugador). Físicas propias (gravedad + AABB).
   Arte 100% procedural por especie (silueta + patas animadas). */

const mobs2d = [];
let _mobSpawnT = 1.5;

// criaturas del modo 2D: monstruos del pack 0x72 (mismo estilo que el prota).
// sprite = base del atlas (usa <sprite>_idle/run_anim_f0..3); w=medio ancho, bh=alto (tiles).
// color = tinte de partículas al morir. Se mantienen stats/flags/drops del diseño previo.
const DINO = {
  raptor: { name: 'Goblin', sprite: 'goblin', hostile: true, hp: 14, w: 0.55, bh: 1.15, speed: 4.4, dmg: 6, sense: 10,
    color: '#6e8a3a', drop: [['meat', 1]] },
  rex: { name: 'Ogro', sprite: 'ogre', hostile: true, hp: 40, w: 0.95, bh: 2.1, speed: 3.0, dmg: 15, sense: 12,
    color: '#7a7a86', drop: [['meat', 2], ['bone', 1]] },
  bronto: { name: 'Zombi colosal', sprite: 'big_zombie', hostile: false, hp: 46, w: 1.3, bh: 2.3, speed: 1.5, dmg: 0,
    color: '#6a9a4a', drop: [['meat', 2], ['leather', 1]] },
  stego: { name: 'Orco enmascarado', sprite: 'masked_orc', hostile: false, hp: 28, w: 0.9, bh: 1.5, speed: 1.8, dmg: 0,
    color: '#5f8a6a', drop: [['meat', 1], ['leather', 1]] },
  trike: { name: 'Orco guerrero', sprite: 'orc_warrior', hostile: false, hp: 32, w: 0.9, bh: 1.5, speed: 2.1, dmg: 0,
    color: '#7a9a5a', drop: [['meat', 1], ['leather', 1]] },
  guardian: { name: 'Gran Demonio', sprite: 'big_demon', hostile: true, boss: true, hp: 240, w: 1.5, bh: 2.6, speed: 2.5, dmg: 20, sense: 80,
    color: '#b03a3a', drop: [['crystal', 8], ['bone', 4], ['core', 1]] },
};

/* ---------- física ---------- */
function _solidBox(cx, fy, hw, bh) {
  const x0 = Math.floor(cx - hw), x1 = Math.floor(cx + hw - 1e-4), y0 = Math.floor(fy - bh), y1 = Math.floor(fy - 1e-4);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (world.isSolid(tx, ty)) return true;
  return false;
}
// ¿hay un sólido en la línea entre dos puntos (en tiles)? (para no golpear a través de paredes)
function losBlocked2d(x0, y0, x1, y1) {
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let k = 1; k < n; k++) { const t = k / n; if (world.isSolid(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t))) return true; }
  return false;
}
function _moveMob(m, dx, dy) {
  const hw = m.def.w, bh = m.def.bh;
  if (_solidBox(m.x, m.y, hw, bh)) { for (let s = 0; s < 30 && _solidBox(m.x, m.y, hw, bh); s++) m.y -= 0.12; }   // si nace incrustado, empuja hacia arriba
  if (dx) {
    if (!_solidBox(m.x + dx, m.y, hw, bh)) m.x += dx;
    else { const st = Math.sign(dx) * 0.05, lim = Math.abs(dx); let mv = 0; while (mv < lim && !_solidBox(m.x + st, m.y, hw, bh)) { m.x += st; mv += 0.05; } m.vx = 0; m.bumpX = true; }
  }
  if (dy) {
    if (!_solidBox(m.x, m.y + dy, hw, bh)) m.y += dy;
    else { const st = Math.sign(dy) * 0.05, lim = Math.abs(dy); let mv = 0; while (mv < lim && !_solidBox(m.x, m.y + st, hw, bh)) { m.y += st; mv += 0.05; } if (dy > 0) m.grounded = true; m.vy = 0; }
  }
}

/* ---------- spawn ---------- */
function trySpawnMob2d() {
  if (mobs2d.length >= 8 || !world.surfaceY) return;
  const side = Math.random() < 0.5 ? -1 : 1;
  const tx = Math.floor(player.x) + side * (15 + (Math.random() * 8 | 0));
  const surf = world.surfaceY(tx);
  if (!world.isSolid(tx, surf)) return;          // necesita suelo sólido
  const night = G.darkness > 0.5;
  const pool = night ? ['raptor', 'raptor', 'rex', 'stego'] : ['bronto', 'stego', 'trike', 'raptor'];
  const key = pool[Math.random() * pool.length | 0], d = DINO[key];
  mobs2d.push({ key, def: d, x: tx + 0.5, y: surf, vx: 0, vy: 0, dir: -side, hp: d.hp, maxHp: d.hp,
    grounded: false, think: 0, wander: 0, walk: 0, atkCd: 0, flee: 0, hurtT: 0 });
}

/* ---------- jefe del Corazón ---------- */
let _bossCheckT = 0;
function maybeSpawnBoss2d(dt) {
  _bossCheckT -= dt; if (_bossCheckT > 0) return; _bossCheckT = 2;
  if (G.bossDefeated2d || mobs2d.some(m => m.def.boss)) return;
  const surf = world.surfaceY(Math.floor(player.x));
  if (player.y - surf < 205) return;                       // solo en el estrato del Corazón
  const px = Math.floor(player.x), py = Math.floor(player.y);
  for (let yy = py - 9; yy <= py; yy++) for (let xx = px - 12; xx <= px + 12; xx++) if (world.ground(xx, yy) !== T.BEDROCK) world.setGround(xx, yy, T.AIR);
  for (let xx = px - 12; xx <= px + 12; xx++) world.setGround(xx, py + 1, T.BRICK);     // suelo de la arena
  world.setGround(px - 11, py - 1, T.TORCH); world.setGround(px + 11, py - 1, T.TORCH);
  const d = DINO.guardian;
  mobs2d.push({ key: 'guardian', def: d, x: px + 8, y: py, vx: 0, vy: 0, dir: -1, hp: d.hp, maxHp: d.hp, grounded: false, think: 0, wander: 0, walk: 0, atkCd: 0, flee: 0, hurtT: 0 });
  G.shake = Math.max(G.shake, 0.6); if (Sfx.thunder) Sfx.thunder();
  if (UI.toast) UI.toast('⚠ El Guardián del Corazón despierta…');
}

/* ---------- update ---------- */
function updateMobs2d(dt) {
  maybeSpawnBoss2d(dt);
  _mobSpawnT -= dt;
  if (_mobSpawnT <= 0) { _mobSpawnT = 2.5 + Math.random() * 2; trySpawnMob2d(); }
  for (let i = mobs2d.length - 1; i >= 0; i--) {
    const m = mobs2d[i], d = m.def;
    if (!d.boss && Math.abs(m.x - player.x) > 48) { mobs2d.splice(i, 1); continue; }   // despawn lejano (el jefe nunca)
    m.vy = Math.min(24, (m.vy || 0) + CFG.G2D_GRAV * dt);
    m.grounded = false;
    m.think -= dt;
    let desired = 0;
    if (d.hostile && !player.dead) {
      const dxp = player.x - m.x, adist = Math.abs(dxp);
      if (adist < d.sense) {
        desired = Math.sign(dxp) * d.speed;
        if (adist < d.w + 0.7 && Math.abs((player.y - 0.8) - (m.y - d.bh * 0.5)) < 1.4 &&
            !losBlocked2d(m.x, m.y - d.bh * 0.5, player.x, player.y - 0.8)) {
          m.atkCd -= dt; if (m.atkCd <= 0) { m.atkCd = 1.0; hurtPlayer2d(d.dmg, Math.sign(dxp) || 1); }
        }
      } else { if (m.think <= 0) { m.think = 1 + Math.random() * 2; m.wander = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? -1 : 1); } desired = m.wander * d.speed * 0.5; }
    } else {   // herbívoro
      if (m.flee > 0) { m.flee -= dt; desired = Math.sign(m.x - player.x || 1) * d.speed * 1.4; }
      else { if (m.think <= 0) { m.think = 1.5 + Math.random() * 2.5; m.wander = Math.random() < 0.4 ? 0 : (Math.random() < 0.5 ? -1 : 1); } desired = m.wander * d.speed * 0.6; }
    }
    m.vx = approach(m.vx || 0, desired, 30 * dt);
    if (Math.abs(m.vx) > 0.05) m.dir = m.vx > 0 ? 1 : -1;
    m.bumpX = false;
    _moveMob(m, m.vx * dt, 0);
    _moveMob(m, 0, m.vy * dt);
    if (m.bumpX && m.grounded && Math.abs(desired) > 0.1) m.vy = -CFG.G2D_JUMP * 0.75;   // salta obstáculos
    m.walk = (m.walk || 0) + Math.abs(m.vx) * dt;
    m.hurtT = Math.max(0, m.hurtT - dt);
    if (m.hp <= 0) killMob2d(i);
  }
}
function killMob2d(i) {
  const m = mobs2d[i], boss = m.def.boss;
  for (const dr of (m.def.drop || [])) Inv.add(dr[0], dr[1]);   // el jefe siempre suelta su botín
  const n = boss ? 40 : 9, col = boss ? 'rgba(150,90,230,0.9)' : 'rgba(150,40,40,0.85)';
  for (let k = 0; k < n; k++) particles.push({ x: m.x + randRange(-0.6, 0.6), y: m.y - m.def.bh * 0.5, vx: randRange(-3.5, 3.5), vy: randRange(-3.5, 0.5), z: 0, vz: 0, life: 0.8, maxLife: 0.8, color: col, flat2d: true });
  if (Sfx.thunder && boss) Sfx.thunder(); else if (Sfx.land) Sfx.land();
  mobs2d.splice(i, 1);
  if (boss) {
    G.bossDefeated2d = true; G.shake = Math.max(G.shake, 0.7);
    if (UI.toast) UI.toast('☀ ¡Has vencido al Guardián! El Corazón de Vethrún late libre. Obtienes el Núcleo.');
  }
  if (UI.refreshHotbar) UI.refreshHotbar();
}

/* ---------- combate jugador <-> mob ---------- */
function hurtPlayer2d(dmg, dir) {
  if (G.creative || (player._iframe || 0) > 0) return;
  player.hp -= dmg; player.hurtT = 0.35; player._iframe = 0.7;
  player.vx2 = dir * 6; player.vy2 = -6; player.grounded = false;
  G.shake = Math.max(G.shake, 0.22); if (Sfx.hurt) Sfx.hurt();
  if (player.hp <= 0) { player.hp = 0; respawn2d(); }
}
function respawn2d() {
  const sp = G.spawn || (world.findSurfaceSpawn ? world.findSurfaceSpawn(0) : { x: 0.5, y: 60 });
  player.x = sp.x; player.y = sp.y; player.hp = player.maxHp; player.vx2 = 0; player.vy2 = 0;
  player._iframe = 1.5; mobs2d.length = 0; cam.init = false;
  if (UI.toast) UI.toast('Te derrotaron… reapareces en la superficie');
}
// devuelve true si atacó a un mob (para no picar a la vez)
function attackMobs2d(dt) {
  player._atkCd = Math.max(0, (player._atkCd || 0) - dt);
  if (!Input.mdown || UI.panelOpen || UI.chatOpen || UI.dialogOpen) return false;
  const fd = player.dir === 'left' ? -1 : 1, reach = 1.5;
  let hit = null;
  for (const m of mobs2d) {
    const dx = m.x - player.x;
    if (Math.sign(dx || fd) !== fd) continue;                       // solo lo de delante
    if (Math.abs(dx) < reach + m.def.w && Math.abs((m.y - m.def.bh * 0.5) - (player.y - 0.8)) < 1.5 &&
        !losBlocked2d(player.x, player.y - 0.8, m.x, m.y - m.def.bh * 0.5)) { hit = m; break; }
  }
  if (!hit) return false;
  player.swingT = 0.2; player.atkAnim = 0.25;
  if (player._atkCd <= 0) {
    player._atkCd = 0.42;
    const it = Inv.selected() && ITEMS[Inv.selected().id], tool = it && it.tool;
    const dmg = tool === 'sword' ? 11 : (tool === 'axe' || tool === 'pick') ? 5 : 3;
    hit.hp -= G.creative ? 999 : dmg; hit.hurtT = 0.2; hit.vx = fd * 5; hit.flee = 4;
    if (Sfx.mine) Sfx.mine();
  }
  return true;
}

/* ---------- render (sprites del atlas 0x72 DungeonTileset II, mismo estilo que el prota) ---------- */
function _mob(g, m, ox, oy) {
  const TS = CFG.TS, d = m.def;
  const sx = Math.round((m.x - ox) * TS), sy = Math.round((m.y - oy) * TS);
  const Hd = d.bh * TS;
  if (d.boss) {                                              // aura emisiva del jefe (demonio)
    const r = Hd * (1.0 + 0.06 * Math.sin(G.elapsed * 4));
    g.globalCompositeOperation = 'lighter';
    const rg = g.createRadialGradient(sx, sy - Hd * 0.45, 0, sx, sy - Hd * 0.45, r);
    rg.addColorStop(0, 'rgba(200,70,60,0.4)'); rg.addColorStop(1, 'rgba(160,50,50,0)');
    g.fillStyle = rg; g.fillRect(sx - r, sy - Hd * 0.45 - r, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(sx, sy, d.w * 0.72 * TS, TS * 0.14, 0, 0, 7); g.fill();
  const moving = Math.abs(m.vx || 0) > 0.2;
  const frame = moving ? (Math.floor(m.walk * 8) & 3) : (Math.floor(G.elapsed * 3 + m.x) & 3);   // run (rápido) o idle
  const spr = typeof dsprite === 'function' ? dsprite(d.sprite + '_' + (moving ? 'run' : 'idle') + '_anim_f' + frame) : null;
  if (spr && spr.width) {
    const dh = Hd, dw = spr.width * (dh / spr.height);
    const dx = Math.round(sx - dw / 2), dy = Math.round(sy - dh + 1);
    g.imageSmoothingEnabled = false;
    if (m.hurtT > 0) g.globalAlpha = 0.5;                    // parpadeo al recibir daño
    if (m.dir < 0) { g.save(); g.translate(dx + dw, 0); g.scale(-1, 1); g.drawImage(spr, 0, dy, dw, dh); g.restore(); }
    else g.drawImage(spr, dx, dy, dw, dh);
    g.globalAlpha = 1;
  } else {                                                   // atlas aún sin cargar: silueta simple
    g.fillStyle = d.color || '#556'; g.fillRect(Math.round(sx - d.w * TS), Math.round(sy - Hd), Math.round(d.w * 2 * TS), Math.round(Hd));
  }
  if (m.hp < m.maxHp) {                                      // barra de vida
    const barW = d.w * 2 * TS * 0.7; g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(Math.round(sx - barW / 2), Math.round(sy - Hd - 6), Math.round(barW), 3);
    g.fillStyle = d.hostile ? '#ff5a5a' : '#7CFC5A'; g.fillRect(Math.round(sx - barW / 2), Math.round(sy - Hd - 6), Math.round(barW * clamp(m.hp / m.maxHp, 0, 1)), 3);
  }
}
function drawMobs2d(g, ox, oy) { for (const m of mobs2d) _mob(g, m, ox, oy); }

/* ============ NPCs supervivientes (pueblos de superficie) ============ */
const npc2d = [];
let _npcScanT = 0;
const SURVIVOR_NAMES = ['Bryn', 'Tova', 'Kell', 'Mira', 'Doran', 'Saela', 'Orin', 'Hede'];
// supervivientes = otros héroes del pack 0x72 (mismo estilo que el prota enano)
const SURVIVOR_CHARS = ['elf_f', 'elf_m', 'knight_f', 'knight_m', 'wizzard_f', 'wizzard_m', 'lizard_f', 'lizard_m', 'dwarf_f'];
const SURVIVOR_LINES = [
  'Los Antiguos sellaron lo de abajo por algo… pero alguien debe mirar.',
  'Dicen que cada estrato fue un cielo. Imagínatelo.',
  'Si ves un hold con la luz aún encendida, alguien resistió ahí abajo.',
  'El cristal abisal recuerda la luz del Corazón. Por eso brilla.',
  'En la Jungla Sepultada los grandes pastan; los flacos cazan. Ojo.',
  '¿Otra Puerta, Zahorí? Baja. Nosotros guardamos la Corteza.',
  'Llévate esto. Allá abajo no hay tiendas.',
];

function scanSurvivors2d() {
  if (G.mode !== 'side' || !world.houseAnchor) return;
  const px = Math.floor(player.x);
  for (let hx = px - 30; hx <= px + 30; hx++) {
    if (!world.houseAnchor(hx)) continue;
    const sx = hx + 1.5;                                   // junto a la puerta
    if (npc2d.some(n => Math.abs(n.x - sx) < 1.5)) continue;
    if (npc2d.length >= 6) break;
    const k = hash2(hx, 3, 777);
    npc2d.push({
      x: sx, y: world.surfaceY(hx), vy: 0, grounded: false, def: { w: 0.3, bh: 1.7 },
      name: SURVIVOR_NAMES[(k * SURVIVOR_NAMES.length) | 0],
      char: SURVIVOR_CHARS[(hash2(hx, 6, 7) * SURVIVOR_CHARS.length) | 0],
      line: SURVIVOR_LINES[(hash2(hx, 4, 9) * SURVIVOR_LINES.length) | 0],
      gave: false, near: false, t: hash2(hx, 5, 9) * 6,
    });
  }
}
function updateNpc2d(dt) {
  _npcScanT -= dt;
  if (_npcScanT <= 0) { _npcScanT = 1.5; scanSurvivors2d(); }
  for (let i = npc2d.length - 1; i >= 0; i--) {
    const n = npc2d[i];
    if (Math.abs(n.x - player.x) > 42) { npc2d.splice(i, 1); continue; }
    n.vy = Math.min(20, (n.vy || 0) + CFG.G2D_GRAV * dt); n.grounded = false;
    _moveMob(n, 0, n.vy * dt);
    const d = Math.abs(n.x - player.x);
    n.near = d < 3.2 && Math.abs(n.y - player.y) < 3;
    if (n.near && !n.gave && !player.dead) {            // regalo único al acercarte
      n.gave = true; Inv.add('torch', 3); Inv.add('meat', 1);
      if (UI.toast) UI.toast(n.name + ': «' + n.line + '»  (+3 antorchas, +1 carne)');
      if (UI.refreshHotbar) UI.refreshHotbar();
    }
  }
}
function drawNpc2d(g, n, ox, oy) {
  const TS = CFG.TS, sx = (n.x - ox) * TS, sy = (n.y - oy) * TS;
  const bob = Math.sin((G.elapsed + n.t) * 2) * 1.3;
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(sx, sy, TS * 0.30, TS * 0.12, 0, 0, 7); g.fill();
  const frame = Math.floor(G.elapsed * 3 + n.t) & 3;                          // idle animado (4 frames del atlas)
  const spr = typeof dsprite === 'function' ? dsprite((n.char || 'dwarf_f') + '_idle_anim_f' + frame) : null;
  const dh = TS * 2.05;
  if (spr && spr.width) {
    const dw = spr.width * (dh / spr.height), dx = Math.round(sx - dw / 2), dy = Math.round(sy - dh + bob + 2);
    g.imageSmoothingEnabled = false;
    if (player.x < n.x) { g.save(); g.translate(dx + dw, 0); g.scale(-1, 1); g.drawImage(spr, 0, dy, dw, dh); g.restore(); }
    else g.drawImage(spr, dx, dy, dw, dh);
  }
  // bocadillo de lore al acercarte
  if (n.near) {
    g.font = '7px monospace'; const tw = Math.min(220, g.measureText(n.line).width), bx = sx - tw / 2 - 5, by = sy - dh - 16;
    g.fillStyle = 'rgba(20,18,28,0.92)'; g.fillRect(bx, by, tw + 10, 16);
    g.fillStyle = 'rgba(20,18,28,0.92)'; g.beginPath(); g.moveTo(sx - 4, by + 16); g.lineTo(sx + 4, by + 16); g.lineTo(sx, by + 21); g.closePath(); g.fill();
    g.fillStyle = '#ffe9a6'; g.fillText(n.name, bx + 5, by + 7);
    g.fillStyle = '#e8e2d2'; g.fillText(n.line, bx + 5, by + 14);
  }
}
function drawNpcs2d(g, ox, oy) { for (const n of npc2d) drawNpc2d(g, n, ox, oy); }
