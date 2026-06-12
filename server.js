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
const BOSS = { hp: 80, hpPerExtra: 50, hopTime: 0.55, hopSpeed: 4.2, minionEvery: 11, enrageAt: 0.3 };

/* ================= estado persistente ================= */

function rndHex(n) { return crypto.randomBytes(n).toString('hex'); }

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
    if (s && typeof s.seed === 'number' && s.worldId) return s;
  } catch (e) { /* primera ejecución */ }
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

function saveState() {
  refreshAllStocks();
  try {
    fs.writeFileSync(WORLD_FILE, JSON.stringify(state));
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

function handleMessage(conn, m) {
  const p = conn.player;

  if (m.t === 'hello') {
    const pid = sanitizeText(m.pid, 32) || rndHex(8);
    if (players.has(pid)) {
      wsSendObj(conn, { t: 'denied', m: 'Ya hay una sesión abierta con esta identidad' });
      closeConn(conn);
      return;
    }
    const player = {
      conn, id: pid,
      name: sanitizeText(m.name, 14) || 'Anónima',
      color: /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#2e8f83',
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
      if (typeof m.dir === 'string') p.dir = m.dir;
      p.f = m.f | 0;
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
      const key = (m.x | 0) + ',' + (m.y | 0);
      state.edits[key] = { o: m.o | 0, owner: { id: p.id, name: p.name } };
      dirty = true;
      broadcast({ t: 'edit', x: m.x | 0, y: m.y | 0, o: m.o | 0, owner: { id: p.id, name: p.name } }, p.id);
      break;
    }

    case 'break': {
      const key = (m.x | 0) + ',' + (m.y | 0);
      const e = state.edits[key];
      if (e && e.owner && e.owner.id !== p.id) {
        wsSendObj(conn, { t: 'denied', m: 'Esto lo construyó ' + e.owner.name });
        // re-sincroniza al cliente optimista
        wsSendObj(conn, { t: 'edit', x: m.x | 0, y: m.y | 0, o: e.o, owner: e.owner });
        return;
      }
      state.edits[key] = { o: O_NONE, owner: 0 };
      dirty = true;
      broadcast({ t: 'edit', x: m.x | 0, y: m.y | 0, o: O_NONE, owner: 0 }, p.id);
      break;
    }

    case 'bplace': {
      if (!BUILDING_IDS.includes(m.o | 0)) return;
      const key = (m.x | 0) + ',' + (m.y | 0);
      const owner = { id: p.id, name: p.name };
      state.edits[key] = { o: m.o | 0, owner };
      state.buildings[key] = { id: m.o | 0, stock: 0, lastT: Date.now(), owner };
      dirty = true;
      broadcast({ t: 'bedit', action: 'add', x: m.x | 0, y: m.y | 0, o: m.o | 0, owner }, p.id);
      break;
    }

    case 'bbreak': {
      const key = (m.x | 0) + ',' + (m.y | 0);
      const b = state.buildings[key];
      if (b && b.owner && b.owner.id !== p.id) {
        wsSendObj(conn, { t: 'denied', m: 'Esto lo construyó ' + b.owner.name });
        wsSendObj(conn, { t: 'bedit', action: 'add', x: m.x | 0, y: m.y | 0, o: b.id, owner: b.owner });
        return;
      }
      delete state.buildings[key];
      state.edits[key] = { o: O_NONE, owner: 0 };
      dirty = true;
      broadcast({ t: 'bedit', action: 'remove', x: m.x | 0, y: m.y | 0 }, p.id);
      break;
    }

    case 'collect': {
      const key = (m.x | 0) + ',' + (m.y | 0);
      const b = state.buildings[key];
      if (!b || !PROD[b.id]) return;
      refreshStock(b);
      const n = Math.floor(b.stock);
      if (n < 1) return;
      b.stock -= n;
      dirty = true;
      wsSendObj(conn, { t: 'collected', x: m.x | 0, y: m.y | 0, n, item: PROD[b.id].item });
      broadcast({ t: 'bstocks', s: { [key]: +b.stock.toFixed(2) } });
      break;
    }

    case 'summon': {
      const key = (m.x | 0) + ',' + (m.y | 0);
      const e = state.edits[key];
      if (!e || e.o !== O_ALTAR) return;
      if (boss) { wsSendObj(conn, { t: 'denied', m: 'El Coloso ya camina sobre el mundo' }); return; }
      spawnBoss((m.x | 0) + 1, (m.y | 0) + 5);
      broadcast({ t: 'chat', id: 0, name: '✦', m: p.name + ' ha despertado al Coloso. ¡Todos a una!' });
      break;
    }

    case 'bhit': {
      if (!boss) return;
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
