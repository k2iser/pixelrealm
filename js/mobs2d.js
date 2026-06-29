'use strict';
/* ============ Criaturas del modo 2D: dinosaurios ============
   Herbívoros pacíficos (vagan/pastan, huyen al ser golpeados) y carnívoros
   hostiles (persiguen y atacan al jugador). Físicas propias (gravedad + AABB).
   Arte 100% procedural por especie (silueta + patas animadas). */

const mobs2d = [];
let _mobSpawnT = 1.5;

// especies: w=medio ancho, bh=alto (tiles); color/belly/dark; rasgos por flags
const DINO = {
  raptor: { name: 'Raptor', hostile: true, hp: 14, w: 0.55, bh: 1.0, speed: 4.4, dmg: 6, sense: 10,
    color: '#a06a38', belly: '#d2a86a', dark: '#6e4724', drop: [['meat', 1]] },
  rex: { name: 'T-Rex', hostile: true, hp: 40, w: 0.95, bh: 1.95, speed: 3.0, dmg: 15, sense: 12,
    color: '#5f7444', belly: '#a6bd80', dark: '#3c4a2a', drop: [['meat', 2], ['bone', 1]] },
  bronto: { name: 'Brontosaurio', hostile: false, hp: 46, w: 1.5, bh: 2.4, speed: 1.5, dmg: 0,
    color: '#5790b2', belly: '#a3c8db', dark: '#3a647e', neck: true, drop: [['meat', 2], ['leather', 1]] },
  stego: { name: 'Estegosaurio', hostile: false, hp: 28, w: 1.15, bh: 1.4, speed: 1.8, dmg: 0,
    color: '#6aa15e', belly: '#bcd6a6', dark: '#467038', plates: true, drop: [['meat', 1], ['leather', 1]] },
  trike: { name: 'Triceratops', hostile: false, hp: 32, w: 1.1, bh: 1.35, speed: 2.1, dmg: 0,
    color: '#9c7b5a', belly: '#cdb38a', dark: '#6b5238', horns: true, drop: [['meat', 1], ['leather', 1]] },
  guardian: { name: 'Guardián del Corazón', hostile: true, boss: true, hp: 240, w: 1.6, bh: 2.8, speed: 2.5, dmg: 20, sense: 80,
    color: '#3a2d52', belly: '#6a4f9a', dark: '#241a36', horns: true, drop: [['crystal', 8], ['bone', 4], ['core', 1]] },
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
  G.shake = Math.max(G.shake, 0.22); if (Sfx.hurt) Sfx.hurt(); else if (Sfx.thunder) {}
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

/* ---------- render (pixel-art horneado a baja resolución y ampliado nearest-neighbor) ---------- */
const _dinoCache = {};
const ART = 12;   // px de arte por tile; al ampliar a TS quedan píxeles chunky como el prota
function _dinoSprite(d, frame, hurt) {
  const key = d.name + ':' + frame + ':' + (hurt ? 1 : 0);
  if (_dinoCache[key]) return _dinoCache[key];
  const Wd = d.w * 2 * ART, Hd = d.bh * ART, pad = 3;
  const fw = Math.ceil(Wd) + pad * 2, fh = Math.ceil(Hd) + pad * 2;
  const [c, g] = cv(fw, fh);
  g.translate(Math.round(fw / 2), fh - pad);                 // origen: pies, centrado
  const col = hurt ? '#ff8a8a' : d.color, belly = hurt ? '#ffc0c0' : d.belly, dark = d.dark, line = 'rgba(0,0,0,0.45)';
  const bw = Wd * 0.62, bh = Hd * 0.4, by = -Hd * 0.5;
  const R = (x, y, w, h, c2) => { g.fillStyle = c2; g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); };
  // óvalo pixelado fila a fila (cuerpo/cabeza redondeados pero en píxeles)
  const oval = (cx, cy, rx, ry, top, bot) => {
    for (let yy = -Math.round(ry); yy <= Math.round(ry); yy++) {
      const t = yy / ry, w = rx * Math.sqrt(Math.max(0, 1 - t * t));
      if (w < 0.5) continue;
      g.fillStyle = (bot && yy > ry * 0.15) ? bot : top;
      g.fillRect(Math.round(cx - w), Math.round(cy + yy), Math.max(1, Math.round(w * 2)), 1);
    }
  };
  const legH = Hd * 0.34, lw = Math.max(2, ART * 0.18);
  const lp = [0, 1.6, 0, -1.6][frame & 3];                   // patas (4 frames)
  R(-bw * 0.30, -legH, lw, legH + lp, dark);
  R(bw * 0.12, -legH, lw, legH - lp, dark);
  // cola (escalones)
  R(-bw * 1.02, by - bh * 0.05, bw * 0.4, Math.max(2, bh * 0.5), col);
  R(-bw * 0.72, by - bh * 0.2, bw * 0.38, Math.max(2, bh * 0.8), col);
  // cuerpo
  oval(0, by, bw * 0.52, bh, col, belly);
  // placas dorsales (stego)
  if (d.plates) for (let i = -2; i <= 2; i++) { const px = i * bw * 0.16; R(px - bw * 0.05, by - bh * 1.05, bw * 0.1, bh * 0.6, dark); R(px - bw * 0.02, by - bh * 1.25, bw * 0.04, bh * 0.3, dark); }
  // cuello + cabeza
  let hx, hy;
  if (d.neck) {
    R(bw * 0.30, by - Hd * 0.6, Math.max(2, ART * 0.18), Hd * 0.6, col);
    hx = bw * 0.42; hy = by - Hd * 0.64; oval(hx, hy, ART * 0.26, ART * 0.2, col);
  } else {
    hx = bw * 0.52; hy = by - bh * 0.5; oval(hx, hy, bw * 0.32, bh * 0.78, col, belly);
    if (d.hostile) { R(bw * 0.5, by - bh * 0.15, bw * 0.34, Math.max(1, ART * 0.12), col); for (let k = 0; k < 3; k++) R(bw * 0.55 + k * bw * 0.09, by - bh * 0.05, 1, 1, '#fff'); }  // mandíbula + dientes
  }
  // cuernos + gola (trike)
  if (d.horns) { R(hx + bw * 0.12, hy - bh * 0.1, bw * 0.3, 1, '#eee'); R(hx, hy - bh * 0.55, 1, bh * 0.5, '#eee'); R(hx - bw * 0.25, hy - bh * 0.4, bw * 0.1, bh * 0.5, dark); }
  // ojo
  R(hx + 1, hy - 2, 2, 2, '#fff'); R(hx + 2, hy - 1, 1, 1, d.hostile ? '#e23' : '#111');
  _dinoCache[key] = c; return c;
}
function _dino(g, m, ox, oy) {
  const TS = CFG.TS, d = m.def;
  const sx = Math.round((m.x - ox) * TS), sy = Math.round((m.y - oy) * TS);
  const Hd = d.bh * TS;
  if (d.boss) {                                              // aura emisiva del jefe
    const r = Hd * (1.0 + 0.06 * Math.sin(G.elapsed * 4));
    g.globalCompositeOperation = 'lighter';
    const rg = g.createRadialGradient(sx, sy - Hd * 0.45, 0, sx, sy - Hd * 0.45, r);
    rg.addColorStop(0, 'rgba(150,90,230,0.4)'); rg.addColorStop(1, 'rgba(120,70,210,0)');
    g.fillStyle = rg; g.fillRect(sx - r, sy - Hd * 0.45 - r, r * 2, r * 2);
    g.globalCompositeOperation = 'source-over';
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(sx, sy, d.w * 0.72 * TS, TS * 0.14, 0, 0, 7); g.fill();
  const frame = (Math.abs(m.vx || 0) > 0.2) ? (Math.floor(m.walk * 3) & 3) : 0;
  const spr = _dinoSprite(d, frame, m.hurtT > 0);
  const scale = TS / ART, dw = spr.width * scale, dh = spr.height * scale;
  const dx = Math.round(sx - dw / 2), dy = Math.round(sy - dh + 3 * scale);
  g.imageSmoothingEnabled = false;
  if (m.dir < 0) { g.save(); g.translate(dx + dw, 0); g.scale(-1, 1); g.drawImage(spr, 0, dy, dw, dh); g.restore(); }
  else g.drawImage(spr, dx, dy, dw, dh);
  if (m.hp < m.maxHp) {                                      // barra de vida
    const barW = d.w * 2 * TS * 0.6; g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(Math.round(sx - barW / 2), Math.round(sy - Hd - 6), Math.round(barW), 3);
    g.fillStyle = d.hostile ? '#ff5a5a' : '#7CFC5A'; g.fillRect(Math.round(sx - barW / 2), Math.round(sy - Hd - 6), Math.round(barW * clamp(m.hp / m.maxHp, 0, 1)), 3);
  }
}
function drawMobs2d(g, ox, oy) { for (const m of mobs2d) _dino(g, m, ox, oy); }

/* ============ NPCs supervivientes (pueblos de superficie) ============ */
const npc2d = [];
let _npcScanT = 0;
const SURVIVOR_NAMES = ['Bryn', 'Tova', 'Kell', 'Mira', 'Doran', 'Saela', 'Orin', 'Hede'];
const SURVIVOR_ROBES = ['#5a6b8a', '#7a5a6b', '#5a7a5e', '#8a7a4a', '#6a5a8a', '#7a6a4a'];
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
      robe: SURVIVOR_ROBES[(hash2(hx, 6, 7) * SURVIVOR_ROBES.length) | 0],
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
  const h = TS * 1.7, w = TS * 0.72;
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.beginPath(); g.ellipse(sx, sy, TS * 0.32, TS * 0.12, 0, 0, 7); g.fill();
  g.fillStyle = n.robe;                                   // túnica
  g.beginPath(); g.moveTo(sx - w / 2, sy); g.lineTo(sx + w / 2, sy); g.lineTo(sx + w * 0.32, sy - h * 0.62 + bob); g.lineTo(sx - w * 0.32, sy - h * 0.62 + bob); g.closePath(); g.fill();
  g.fillStyle = '#e8c9a0'; g.beginPath(); g.arc(sx, sy - h * 0.72 + bob, w * 0.27, 0, 7); g.fill();   // cara
  g.fillStyle = n.robe; g.beginPath(); g.arc(sx, sy - h * 0.78 + bob, w * 0.32, Math.PI, 0); g.fill(); // capucha
  g.fillStyle = '#222'; g.fillRect(Math.round(sx - 3), Math.round(sy - h * 0.72 + bob), 1, 1); g.fillRect(Math.round(sx + 2), Math.round(sy - h * 0.72 + bob), 1, 1);
  // bocadillo de lore al acercarte
  if (n.near) {
    g.font = '7px monospace'; const tw = Math.min(220, g.measureText(n.line).width), bx = sx - tw / 2 - 5, by = sy - h - 20;
    g.fillStyle = 'rgba(20,18,28,0.92)'; g.fillRect(bx, by, tw + 10, 16);
    g.fillStyle = 'rgba(20,18,28,0.92)'; g.beginPath(); g.moveTo(sx - 4, by + 16); g.lineTo(sx + 4, by + 16); g.lineTo(sx, by + 21); g.closePath(); g.fill();
    g.fillStyle = '#ffe9a6'; g.fillText(n.name, bx + 5, by + 7);
    g.fillStyle = '#e8e2d2'; g.fillText(n.line, bx + 5, by + 14);
  }
}
function drawNpcs2d(g, ox, oy) { for (const n of npc2d) drawNpc2d(g, n, ox, oy); }
