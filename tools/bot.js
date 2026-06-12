'use strict';
/* Bot de pruebas del multijugador: entra al mundo, saluda por el chat,
   se acerca al primer jugador que vea y coloca un muro de su propiedad.
   Uso: node tools/bot.js [url] [nombre]  (requiere Node >= 22) */

const URL = process.argv[2] || 'ws://localhost:5173/ws';
const NAME = process.argv[3] || 'RobotaBeta';

const ws = new WebSocket(URL);
let me = { x: 0, y: 0 };
let placedAt = null;

ws.onopen = () => {
  console.log('[bot] conectada a', URL);
  ws.send(JSON.stringify({
    t: 'hello', pid: 'bot-' + NAME.toLowerCase(), name: NAME,
    look: { skin: 1, hair: 3, style: 1, shirt: 1, pants: 2 },
  }));
};

ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.t === 'welcome') {
    console.log('[bot] dentro del mundo', m.worldId, '· semilla', m.seed, '· jugadores:', m.players.length);
    const other = m.players.find(p => p.id !== m.id);
    me.x = other ? other.x + 2 : 2;
    me.y = other ? other.y + 1 : 2;
    sendState();
    setTimeout(() => {
      ws.send(JSON.stringify({ t: 'chat', m: '¡Hola! Soy una bot de pruebas. Vengo en son de paz 🤖' }));
    }, 1200);
    setTimeout(() => {
      placedAt = { x: Math.round(me.x) + 1, y: Math.round(me.y) };
      ws.send(JSON.stringify({ t: 'place', x: placedAt.x, y: placedAt.y, o: 8 }));
      console.log('[bot] muro colocado en', placedAt.x + ',' + placedAt.y);
    }, 2500);
    // pasea un poco
    let t = 0;
    setInterval(() => {
      t += 0.4;
      me.x += Math.cos(t) * 0.3;
      me.y += Math.sin(t * 0.7) * 0.3;
      sendState();
    }, 130);
  }
  if (m.t === 'chat') console.log('[bot] chat <' + m.name + '>:', m.m);
  if (m.t === 'denied') console.log('[bot] denegado:', m.m);
  if (m.t === 'edit') console.log('[bot] edición remota:', JSON.stringify(m));
};

function sendState() {
  ws.send(JSON.stringify({ t: 'st', x: +me.x.toFixed(2), y: +me.y.toFixed(2), dir: 'down', f: 1, hp: 10 }));
}

let closing = false;
ws.onclose = () => { console.log('[bot] desconectada'); process.exit(0); };
ws.onerror = err => {
  if (closing) return;
  console.log('[bot] error', err.message || '');
  process.exit(1);
};

setTimeout(() => { console.log('[bot] fin de la prueba'); closing = true; ws.close(); }, 45000);
