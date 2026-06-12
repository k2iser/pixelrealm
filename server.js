'use strict';
/* ============ Servidor de PixelRealm: estáticos + multijugador ============
   node server.js  →  http://localhost:5173

   El WebSocket está implementado a mano sobre net/http (handshake SHA-1 y
   parsing de frames RFC 6455): el proyecto entero sigue sin dependencias.

   El servidor es la autoridad del mundo compartido: semilla, reloj, ediciones
   con dueño, stock de los edificios y el Coloso. Los clientes simulan sus
   propios enemigos menores; el jefe es de todos. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 5173;
const ROOT = __dirname;
const WORLD_FILE = path.join(ROOT, 'world-server.json');

/* ---- constantes espejo de js/config.js (mantener en sincronía) ---- */
const DAY_LENGTH = 300;
const BOSS_NIGHT_EVERY = 3;
const O_NONE = 0, O_ALTAR = 18;
const PROD = {                       // id de objeto -> producción
  14: { item: 'wood', per: 40, cap: 6 },    // aserradero
  15: { item: 'stone', per: 55, cap: 5 },   // cantera
  16: { item: 'berry', per: 45, cap: 8 },   // huerto
};
const BUILDING_IDS = [12, 13, 14, 15, 16, 17, 18];
const PLACE_IDS = [8, 9, 10, 11];              // muros, antorcha, fogata: lo único colocable suelto
const SOLID_PLACE = new Set([8, 9, 11]);       // sólidos que podrían emparedar (la antorcha no)
const SIZE = { 12: 2, 13: 1, 14: 2, 15: 2, 16: 2, 17: 1, 18: 2 };  // huella de cada edificio
const HERO_COLORS = ['#2e8f83', '#c0563a', '#7a5fc0', '#3a7ac0', '#c09a3a', '#58a04a', '#c05a8a', '#36b3c9'];
const BOSS = { hp: 80, hpPerExtra: 50, hopTime: 0.55, hopSpeed: 4.2, minionEvery: 11, enrageAt: 0.3 };

/* ================= estado persistente ================= */

function rndHex(n) { return crypto.randomBytes(n).toString('hex'); }

function loadState() {
  // intenta el fichero principal y después la copia de seguridad
  for (const f of [WORLD_FILE, WORLD_FILE + '.bak']) {
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (s && typeof s.seed === 'number' && s.worldId) return s;
    } catch (e) { /* probar el siguiente */ }
  }
  if (fs.existsSync(WORLD_FILE)) {
    console.error('AVISO: world-server.json corrupto y sin .bak válido; se conserva como .corrupt');
    try { fs.renameSync(WORLD_FILE, WORLD_FILE + '.corrupt'); } catch (e) { /* mala suerte */ }
  }
  return null;
}

let state = loadState() || {
  worldId: rndHex(4),
  seed: crypto.randomBytes(4).readInt32BE() | 0,
  day: 1,
  time: 0.08,
  edits: {},      // "x,y" -> { o, owner: {id,name} | 0 }
  buildings: {},  // "x,y" -> { id, stock, lastT, owner: {id,name} }
};
let dirty = false;
let editCount = Object.keys(state.edits).length;  // tope de memoria/disco para clientes hostiles

function saveState() {
  refreshAllStocks();
  try {
    // escritura atómica: o queda el JSON viejo o el nuevo, nunca uno a medias
    const tmp = WORLD_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    try { fs.copyFileSync(WORLD_FILE, WORLD_FILE + '.bak'); } catch (e) { /* aún no existe */ }
    fs.renameSync(tmp, WORLD_FILE);
    dirty = false;
  } catch (e) {
    console.error('No se pudo guardar el mundo:', e.message);
  }
}
setInterval(() => { if (dirty) saveState(); }, 60000);
process.on('SIGINT', () => { saveState(); console.log('\nMundo guardado. ¡Hasta pronto!'); process.exit(0); });

/* ================= servidor HTTP estático ================= */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/world-server.json') { res.writeHead(403); res.end(); return; }
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Prohibido');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('No encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ================= WebSocket artesanal (RFC 6455) ================= */

const conns = new Set();   // toda conexión WS viva
const players = new Map(); // id (pid) -> { conn, id, name, color, x, y, dir, f, hp, chatT }

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  socket.setNoDelay(true);

  const conn = { socket, buf: Buffer.alloc(0), player: null, alive: Date.now(), closed: false };
  conns.add(conn);
  wsSendObj(conn, { t: 'info', n: players.size });

  socket.on('data', chunk => {
    conn.alive = Date.now();
    conn.buf = Buffer.concat([conn.buf, chunk]);
    if (conn.buf.length > 1 << 20) { closeConn(conn); return; } // 1 MB: algo va mal
    let frame;
    while ((frame = wsReadFrame(conn)) !== null) {
      if (frame.opcode === 8) { closeConn(conn); return; }
      if (frame.opcode === 9) { wsSendRaw(conn, 0x8A, frame.payload); continue; } // ping -> pong
      if (frame.opcode === 1) {
        let msg;
        try { msg = JSON.parse(frame.payload.toString('utf8')); } catch (e) { continue; }
        try { handleMessage(conn, msg); } catch (e) { console.error('Error en mensaje:', e); }
      }
    }
  });
  socket.on('close', () => closeConn(conn));
  socket.on('error', () => closeConn(conn));
});

function wsReadFrame(conn) {
  const b = conn.buf;
  if (b.length < 2) return null;
  const fin = (b[0] & 0x80) !== 0;
  const opcode = b[0] & 0x0f;
  const masked = (b[1] & 0x80) !== 0;
  let len = b[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (b.length < 4) return null;
    len = b.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (b.length < 10) return null;
    const hi = b.readUInt32BE(2);
    if (hi !== 0) { closeConn(conn); return null; } // >4GB: ni hablar
    len = b.readUInt32BE(6);
    off = 10;
  }
  if (len > 1 << 16) { closeConn(conn); return null; }
  const maskLen = masked ? 4 : 0;
  if (b.length < off + maskLen + len) return null;
  let payload = b.slice(off + maskLen, off + maskLen + len);
  if (masked) {
    const mask = b.slice(off, off + 4);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  conn.buf = b.slice(off + maskLen + len);
  if (!fin) return { opcode: 0, payload: Buffer.alloc(0) }; // fragmentación: ignorada (mensajes pequeños)
  return { opcode, payload };
}

function wsSendRaw(conn, firstByte, payload) {
  if (conn.closed) return;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([firstByte, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = firstByte; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = firstByte; header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  try { conn.socket.write(Buffer.concat([header, payload])); }
  catch (e) { closeConn(conn); }
}

function wsSendObj(conn, obj) {
  wsSendRaw(conn, 0x81, Buffer.from(JSON.stringify(obj), 'utf8'));
}

function broadcast(obj, exceptId) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  for (const [id, p] of players) {
    if (id === exceptId) continue;
    wsSendRaw(p.conn, 0x81, payload);
  }
}

function closeConn(conn) {
  if (conn.closed) return;
  conn.closed = true;
  conns.delete(conn);
  if (conn.player) {
    players.delete(conn.player.id);
    broadcast({ t: 'leave', id: conn.player.id });
    console.log('← ' + conn.player.name + ' se fue (' + players.size + ' online)');
  }
  try { conn.socket.destroy(); } catch (e) { /* ya cerrado */ }
}

// conexiones silenciosas fuera
setInterval(() => {
  const now = Date.now();
  for (const conn of conns) {
    if (now - conn.alive > 70000) closeConn(conn);
    else wsSendRaw(conn, 0x89, Buffer.alloc(0)); // ping
  }
}, 25000);

/* ================= lógica del juego ================= */

function sanitizeText(s, max) {
  return String(s || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
}

function refreshStock(b) {
  const prod = PROD[b.id];
  if (!prod) return 0;
  const now = Date.now();
  b.stock = Math.min(prod.cap, (b.stock || 0) + (now - (b.lastT || now)) / 1000 / prod.per);
  b.lastT = now;
  return b.stock;
}

function refreshAllStocks() {
  for (const k in state.buildings) refreshStock(state.buildings[k]);
}

function editsArray() {
  const out = [];
  for (const k in state.edits) {
    const p = k.split(',');
    const e = state.edits[k];
    out.push({ x: +p[0], y: +p[1], o: e.o, owner: e.owner || 0 });
  }
  return out;
}

function buildingsForClient() {
  refreshAllStocks();
  const out = {};
  for (const k in state.buildings) {
    const b = state.buildings[k];
    out[k] = { stock: +b.stock.toFixed(2), owner: (b.owner && b.owner.id) || 0 };
  }
  return out;
}

function bossForClient() {
  if (!boss) return { active: false };
  return {
    active: true,
    x: +boss.x.toFixed(2), y: +boss.y.toFixed(2),
    hp: Math.ceil(boss.hp), maxHp: boss.maxHp,
    enraged: boss.hp < boss.maxHp * BOSS.enrageAt,
    hop: boss.hopping > 0,
  };
}

/* ---- validación y resolución de propiedad ---- */

function buildingRect(k, b) {
  const i = k.indexOf(',');
  return { x: +k.slice(0, i), y: +k.slice(i + 1), s: SIZE[b.id] || 1 };
}

// ¿Qué edificio cubre la casilla (x,y)? Devuelve su clave de ancla o null.
function buildingCovering(x, y) {
  for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const k = (x + dx) + ',' + (y + dy);
    const b = state.buildings[k];
    if (b && (SIZE[b.id] || 1) > Math.max(-dx, -dy)) return k;
  }
  return null;
}

// Dueño de lo que ocupa la casilla: ancla o PART de edificio, o edición con objeto
function occupantOwner(x, y) {
  const bk = buildingCovering(x, y);
  if (bk) return state.buildings[bk].owner || 0;
  const e = state.edits[x + ',' + y];
  return (e && e.o !== O_NONE && e.owner) ? e.owner : 0;
}

// Coordenadas creíbles: dentro del mundo y al alcance del jugador que las envía
function validXY(p, m) {
  const x = m.x | 0, y = m.y | 0;
  if (Math.abs(x) >= 1e6 || Math.abs(y) >= 1e6) return null;
  if (Math.abs(x - p.x) > 16 || Math.abs(y - p.y) > 16) return null;
  return { x, y };
}

// Cubo de fichas: máx. ~8 ediciones/s por conexión (ráfaga inicial de 20)
function takeEdit(p) {
  const now = Date.now();
  p.editTokens = Math.min(20, (p.editTokens == null ? 20 : p.editTokens) + (now - (p.editRefill || now)) / 125);
  p.editRefill = now;
  if (p.editTokens < 1) return false;
  p.editTokens -= 1;
  return true;
}

// ¿La huella (size x size) pisa el cuerpo de algún otro jugador?
function footprintHitsPlayer(tx, ty, size, exceptId) {
  const R = 0.45; // margen por la latencia de las posiciones
  for (const [id, pl] of players) {
    if (id === exceptId) continue;
    if (tx + size - 1 >= Math.floor(pl.x - R) && tx <= Math.floor(pl.x + R) &&
        ty + size - 1 >= Math.floor(pl.y - R) && ty <= Math.floor(pl.y + R)) return true;
  }
  return false;
}

// Reenvía a UN cliente el estado real de un área (tras denegar su edición optimista)
function resyncTiles(conn, x0, y0, sz) {
  for (let dy = 0; dy < sz; dy++) {
    for (let dx = 0; dx < sz; dx++) {
      const x = x0 + dx, y = y0 + dy;
      const e = state.edits[x + ',' + y];
      wsSendObj(conn, { t: 'edit', x, y, o: e ? e.o : O_NONE, owner: (e && e.owner) || 0 });
    }
  }
  for (const k in state.buildings) {
    const b = state.buildings[k];
    const r = buildingRect(k, b);
    if (x0 < r.x + r.s && x0 + sz > r.x && y0 < r.y + r.s && y0 + sz > r.y) {
      wsSendObj(conn, { t: 'bedit', action: 'add', x: r.x, y: r.y, o: b.id, owner: b.owner });
    }
  }
}

function handleMessage(conn, m) {
  const p = conn.player;

  if (m.t === 'hello') {
    if (conn.player) return; // una conexión registra UN jugador; hellos extra se ignoran
    const pid = sanitizeText(m.pid, 32) || rndHex(8);
    if (players.has(pid)) {
      wsSendObj(conn, { t: 'denied', m: 'Ya hay una sesión abierta con esta identidad' });
      closeConn(conn);
      return;
    }
    const player = {
      conn, id: pid,
      name: sanitizeText(m.name, 14) || 'Anónima',
      color: HERO_COLORS.includes((m.color || '').toLowerCase()) ? m.color : HERO_COLORS[0],
      x: 0, y: 0, dir: 'down', f: 0, hp: 10, chatT: 0,
    };
    conn.player = player;
    players.set(pid, player);
    console.log('→ ' + player.name + ' entró (' + players.size + ' online)');
    wsSendObj(conn, {
      t: 'welcome',
      id: pid,
      worldId: state.worldId,
      seed: state.seed,
      day: state.day,
      time: state.time,
      edits: editsArray(),
      buildings: buildingsForClient(),
      players: snapshotPlayers(),
      boss: bossForClient(),
    });
    broadcast({ t: 'join', p: publicPlayer(player) }, pid);
    return;
  }

  if (!p) return; // todo lo demás requiere hello

  switch (m.t) {
    case 'st':
      if (typeof m.x === 'number' && Math.abs(m.x) < 1e6) p.x = m.x;
      if (typeof m.y === 'number' && Math.abs(m.y) < 1e6) p.y = m.y;
      if (m.dir === 'down' || m.dir === 'up' || m.dir === 'left' || m.dir === 'right') p.dir = m.dir;
      p.f = Math.min(5, Math.max(0, m.f | 0));   // valores fuera de rango romperían el render ajeno
      p.hp = m.hp | 0;
      break;

    case 'chat': {
      const now = Date.now();
      if (now - p.chatT < 800) return;
      p.chatT = now;
      const text = sanitizeText(m.m, 120);
      if (!text) return;
      broadcast({ t: 'chat', id: p.id, name: p.name, m: text }, p.id);
      break;
    }

    case 'place': {
      const c = validXY(p, m);
      if (!c || !PLACE_IDS.includes(m.o | 0) || !takeEdit(p)) return;
      const key = c.x + ',' + c.y;
      const own = occupantOwner(c.x, c.y);
      if (own && own.id !== p.id) {
        wsSendObj(conn, { t: 'denied', m: 'Esto lo construyó ' + own.name });
        resyncTiles(conn, c.x, c.y, 1);
        return;
      }
      if (buildingCovering(c.x, c.y)) { resyncTiles(conn, c.x, c.y, 1); return; }
      if (SOLID_PLACE.has(m.o | 0) && footprintHitsPlayer(c.x, c.y, 1, p.id)) {
        wsSendObj(conn, { t: 'denied', m: 'Hay alguien ahí' });
        resyncTiles(conn, c.x, c.y, 1);
        return;
      }
      if (!(key in state.edits)) {
        if (editCount > 200000) return;
        editCount++;
      }
      state.edits[key] = { o: m.o | 0, owner: { id: p.id, name: p.name } };
      dirty = true;
      broadcast({ t: 'edit', x: c.x, y: c.y, o: m.o | 0, owner: { id: p.id, name: p.name } }, p.id);
      break;
    }

    case 'break': {
      const c = validXY(p, m);
      if (!c || !takeEdit(p)) return;
      const key = c.x + ',' + c.y;
      const own = occupantOwner(c.x, c.y);   // cubre también las casillas PART de edificios ajenos
      if (own && own.id !== p.id) {
        wsSendObj(conn, { t: 'denied', m: 'Esto lo construyó ' + own.name });
        resyncTiles(conn, c.x, c.y, 1);
        return;
      }
      if (buildingCovering(c.x, c.y)) return; // los edificios se demuelen con 'bbreak'
      if (!(key in state.edits)) {
        if (editCount > 200000) return;
        editCount++;
      }
      state.edits[key] = { o: O_NONE, owner: 0 };
      dirty = true;
      broadcast({ t: 'edit', x: c.x, y: c.y, o: O_NONE, owner: 0 }, p.id);
      break;
    }

    case 'bplace': {
      const c = validXY(p, m);
      if (!c || !BUILDING_IDS.includes(m.o | 0) || !takeEdit(p)) return;
      const sz = SIZE[m.o | 0] || 1;
      let conflict = footprintHitsPlayer(c.x, c.y, sz, p.id) ? 'Hay alguien ahí' : null;
      for (let dy = 0; dy < sz && !conflict; dy++) {
        for (let dx = 0; dx < sz && !conflict; dx++) {
          const e = state.edits[(c.x + dx) + ',' + (c.y + dy)];
          if ((e && e.o !== O_NONE) || buildingCovering(c.x + dx, c.y + dy)) {
            conflict = 'Ahí ya hay algo construido';
          }
        }
      }
      if (conflict) {
        // revierte la colocación optimista del cliente y restaura lo legítimo
        wsSendObj(conn, { t: 'denied', m: conflict });
        wsSendObj(conn, { t: 'bedit', action: 'remove', x: c.x, y: c.y });
        resyncTiles(conn, c.x, c.y, sz);
        return;
      }
      const key = c.x + ',' + c.y;
      const owner = { id: p.id, name: p.name };
      if (!(key in state.edits)) {
        if (editCount > 200000) return;
        editCount++;
      }
      state.edits[key] = { o: m.o | 0, owner };
      state.buildings[key] = { id: m.o | 0, stock: 0, lastT: Date.now(), owner };
      dirty = true;
      broadcast({ t: 'bedit', action: 'add', x: c.x, y: c.y, o: m.o | 0, owner }, p.id);
      break;
    }

    case 'bbreak': {
      const c = validXY(p, m);
      if (!c || !takeEdit(p)) return;
      const key = c.x + ',' + c.y;
      const b = state.buildings[key];
      if (!b) return; // no es un edificio: nada que demoler (ni que griefear)
      if (b.owner && b.owner.id !== p.id) {
        wsSendObj(conn, { t: 'denied', m: 'Esto lo construyó ' + b.owner.name });
        wsSendObj(conn, { t: 'bedit', action: 'add', x: c.x, y: c.y, o: b.id, owner: b.owner });
        return;
      }
      delete state.buildings[key];
      state.edits[key] = { o: O_NONE, owner: 0 };
      dirty = true;
      broadcast({ t: 'bedit', action: 'remove', x: c.x, y: c.y }, p.id);
      break;
    }

    case 'collect': {
      const c = validXY(p, m);
      if (!c || !takeEdit(p)) return;
      const key = c.x + ',' + c.y;
      const b = state.buildings[key];
      if (!b || !PROD[b.id]) return;
      refreshStock(b);
      const n = Math.floor(b.stock);
      if (n < 1) return;
      b.stock -= n;
      dirty = true;
      wsSendObj(conn, { t: 'collected', x: c.x, y: c.y, n, item: PROD[b.id].item });
      broadcast({ t: 'bstocks', s: { [key]: +b.stock.toFixed(2) } });
      break;
    }

    case 'summon': {
      const c = validXY(p, m);
      if (!c || !takeEdit(p)) return;
      const e = state.edits[c.x + ',' + c.y];
      if (!e || e.o !== O_ALTAR) return;
      if (boss) { wsSendObj(conn, { t: 'denied', m: 'El Coloso ya camina sobre el mundo' }); return; }
      spawnBoss(c.x + 1, c.y + 5);
      broadcast({ t: 'chat', id: 0, name: '✦', m: p.name + ' ha despertado al Coloso. ¡Todos a una!' });
      break;
    }

    case 'bhit': {
      if (!boss) return;
      // solo golpes creíbles: con ritmo de ataque real y a distancia plausible
      // (34 casillas: jugador a 26 de su torre + alcance 6.5 de la torre + margen)
      const now = Date.now();
      if (now - (p.bhitT || 0) < 250) return;
      const dx = p.x - boss.x, dy = p.y - boss.y;
      if (dx * dx + dy * dy > 34 * 34) return;
      p.bhitT = now;
      const d = Math.min(5, Math.max(1, m.d | 0));
      boss.hp -= d;
      if (boss.hp <= 0) {
        boss = null;
        broadcast({ t: 'bossDead' });
        console.log('☠ El Coloso ha caído');
      }
      break;
    }
  }
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, dir: p.dir, frameI: p.f, hp: p.hp };
}

function snapshotPlayers() {
  return [...players.values()].map(publicPlayer);
}

/* ---------- reloj del mundo y el Coloso ---------- */

let boss = null;
let bossNightDone = false;

function darknessAt(t) {
  if (t < 0.45) return 0;
  if (t < 0.55) return (t - 0.45) / 0.1;
  if (t < 0.90) return 1;
  return 1 - (t - 0.90) / 0.1;
}

function spawnBoss(x, y) {
  const maxHp = BOSS.hp + BOSS.hpPerExtra * Math.max(0, players.size - 1);
  boss = { x, y, hp: maxHp, maxHp, hopT: 1.2, hopping: 0, vx: 0, vy: 0, minionT: BOSS.minionEvery };
  console.log('♛ El Coloso despierta con ' + maxHp + ' PV (' + players.size + ' jugadores)');
}

const TICK = 0.2;
setInterval(() => {
  if (players.size === 0) return;   // mundo en pausa sin gente

  // reloj compartido
  state.time += TICK / DAY_LENGTH;
  if (state.time >= 1) {
    state.time -= 1;
    state.day++;
    bossNightDone = false;
    dirty = true;
    broadcast({ t: 'chat', id: 0, name: '✦', m: 'Amanece el día ' + state.day +
      (state.day % BOSS_NIGHT_EVERY === 0 ? ' — esta noche viene el Coloso' : '') });
  }
  const dark = darknessAt(state.time);

  // noche del Coloso
  if (!boss && !bossNightDone && dark >= 1 && state.day % BOSS_NIGHT_EVERY === 0 && state.day >= BOSS_NIGHT_EVERY) {
    const list = [...players.values()];
    const target = list[(Math.random() * list.length) | 0];
    const ang = Math.random() * Math.PI * 2;
    spawnBoss(target.x + Math.cos(ang) * 14, target.y + Math.sin(ang) * 14);
    bossNightDone = true;
  }

  // simulación del Coloso
  let hopped = false;
  if (boss) {
    const enr = boss.hp < boss.maxHp * BOSS.enrageAt ? 1.5 : 1;
    if (boss.hopping > 0) {
      boss.hopping -= TICK;
      boss.x += boss.vx * TICK;
      boss.y += boss.vy * TICK;
      if (boss.hopping <= 0) {
        broadcast({ t: 'bossSlam', x: +boss.x.toFixed(2), y: +boss.y.toFixed(2) });
      }
    } else {
      boss.hopT -= TICK * enr;
      if (boss.hopT <= 0) {
        // hacia el jugador vivo más cercano
        let best = null, bd = Infinity;
        for (const [, pl] of players) {
          if (pl.hp <= 0) continue;
          const d = (pl.x - boss.x) ** 2 + (pl.y - boss.y) ** 2;
          if (d < bd) { bd = d; best = pl; }
        }
        if (best) {
          const ang = Math.atan2(best.y - boss.y, best.x - boss.x) + (Math.random() - 0.5) * 0.3;
          boss.vx = Math.cos(ang) * BOSS.hopSpeed * enr;
          boss.vy = Math.sin(ang) * BOSS.hopSpeed * enr;
          boss.hopping = BOSS.hopTime;
          boss.hopT = 0.9;
          hopped = true;
        } else {
          boss.hopT = 1;
        }
      }
    }
    boss.minionT -= TICK;
    if (boss.minionT <= 0) {
      boss.minionT = BOSS.minionEvery;
      broadcast({ t: 'bossMinions', x: +boss.x.toFixed(2), y: +boss.y.toFixed(2) });
    }
  }

  broadcast({ t: 'boss', b: Object.assign(bossForClient(), { hop: hopped }) });
}, TICK * 1000);

// estados de jugadores a 10 Hz
setInterval(() => {
  if (players.size === 0) return;
  const s = [...players.values()].map(p => [p.id, +p.x.toFixed(2), +p.y.toFixed(2), p.dir, p.f, p.hp]);
  broadcast({ t: 'st', s });
}, 100);

// reloj a los clientes cada 10 s
setInterval(() => {
  if (players.size === 0) return;
  broadcast({ t: 'time', time: +state.time.toFixed(4), day: state.day });
}, 10000);

// stocks de producción cada 5 s
setInterval(() => {
  if (players.size === 0) return;
  const s = {};
  for (const k in state.buildings) {
    if (PROD[state.buildings[k].id]) s[k] = +refreshStock(state.buildings[k]).toFixed(2);
  }
  if (Object.keys(s).length) broadcast({ t: 'bstocks', s });
}, 5000);

server.listen(PORT, () => {
  console.log('PixelRealm corriendo en http://localhost:' + PORT);
  console.log('Mundo compartido "' + state.worldId + '" (semilla ' + state.seed + ', día ' + state.day + ')');
});
