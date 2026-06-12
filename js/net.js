'use strict';
/* ============ Cliente multijugador ============
   Si la página se sirve desde un servidor con WebSocket (node server.js),
   aparece el botón de jugar online: mundo compartido, chat y jefe cooperativo.
   En GitHub Pages o file:// no hay servidor y el juego queda en un jugador.

   Filosofía cooperativa: no hay PvP. Lo que construye otra persona se puede
   USAR (recoger su huerto, refugiarse tras sus muros, calentarse en su fogata)
   pero solo su dueño puede destruirlo. El Coloso es el enemigo de todos. */

const Net = {
  available: false,   // hay servidor al otro lado
  online: false,      // estamos jugando en el mundo compartido
  ws: null,
  id: null,
  worldId: null,
  myName: '',
  myColor: HERO_COLORS[0],
  players: new Map(), // id -> { name, color, x, y, px, py, dir, frameI, hp, bubble, bubbleT }
  lobbyCount: 0,
  _sendT: 0,
  _warm: false,
  _warmT: 0,
  _joining: false,
  _retryMs: 0,
  _everUp: false,

  pid() {
    try {
      let p = localStorage.getItem('pixelrealm.pid');
      if (!p) {
        p = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('pixelrealm.pid', p);
      }
      return p;
    } catch (e) {
      return 'anon' + ((Math.random() * 1e9) | 0);
    }
  },

  // Al arrancar: intenta conectar. Si hay servidor, se habilita el botón online.
  probe() {
    if (!location.host || !location.protocol.startsWith('http')) return;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return; }
    this.ws = ws;
    ws.onopen = () => { this.available = true; this._everUp = true; this._retryMs = 0; };
    ws.onmessage = e => this.onMessage(e);
    ws.onclose = () => this.onClose();
    ws.onerror = () => { /* sin servidor WS: modo un jugador */ };
  },

  join(name) {
    if (!this.available || !this.ws || this.ws.readyState !== 1) return;
    this.myName = (name || '').trim().slice(0, 14) || 'Aventurera' + ((Math.random() * 99) | 0);
    try { localStorage.setItem('pixelrealm.name', this.myName); } catch (e) { /* da igual */ }
    this.myColor = HERO_COLORS[clampLook(G.look).shirt];
    this._joining = true;
    this.send({ t: 'hello', pid: this.pid(), name: this.myName, look: clampLook(G.look) });
  },

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  },

  onMessage(e) {
    let m;
    try { m = JSON.parse(e.data); } catch (err) { return; }

    switch (m.t) {
      case 'info':
        this.lobbyCount = m.n;
        UI.updateOnlineButton(true, m.n);
        break;

      case 'welcome': {
        this.id = m.id;
        this.worldId = m.worldId;
        this.online = true;
        this._joining = false;
        this.players.clear();
        for (const p of m.players) {
          if (p.id !== this.id) this.addPlayer(p);
        }
        Assets.player = getHeroLookSet(G.look);
        startOnlineWorld(m);
        UI.showChat();
        UI.addChatLine('✦', m.players.length === 1 ? 'Estás inaugurando el mundo. ¡Construye algo bonito!' :
          'Hay ' + (m.players.length - 1) + ' persona(s) más en el mundo. Di hola con T');
        break;
      }

      case 'join':
        if (m.p.id !== this.id) {
          this.addPlayer(m.p);
          UI.addChatLine('✦', m.p.name + ' ha llegado al mundo');
          Sfx.chatPing();
        }
        break;

      case 'leave': {
        const p = this.players.get(m.id);
        if (p) UI.addChatLine('✦', p.name + ' se ha marchado');
        this.players.delete(m.id);
        break;
      }

      case 'st':
        for (const s of m.s) {
          if (s[0] === this.id) continue;
          const p = this.players.get(s[0]);
          if (!p) continue;
          p.x = s[1]; p.y = s[2];
          p.dir = s[3]; p.frameI = s[4]; p.hp = s[5];
        }
        break;

      case 'chat': {
        UI.addChatLine(m.name, m.m);
        Sfx.chatPing();
        const p = this.players.get(m.id);
        if (p) { p.bubble = m.m.slice(0, 28); p.bubbleT = 4.5; }
        break;
      }

      case 'edit':
        if (m.o === O.NONE) {
          world.setObject(m.x, m.y, O.NONE);
          world.owners.delete(m.x + ',' + m.y);
        } else {
          world.setObject(m.x, m.y, m.o);
          if (m.owner) world.owners.set(m.x + ',' + m.y, m.owner);
        }
        break;

      case 'bedit':
        if (m.action === 'add') {
          world.placeBuilding(m.x, m.y, m.o, m.owner ? m.owner.id : 0);
          if (m.owner) world.owners.set(m.x + ',' + m.y, m.owner);
        } else {
          world.removeBuilding(m.x, m.y);
          world.owners.delete(m.x + ',' + m.y);
        }
        break;

      case 'collected': {
        // el servidor nos adjudica la recogida
        const def = OBJ[world.object(m.x, m.y)];
        const size = (def && def.size) || 1;
        for (let i = 0; i < m.n; i++) {
          spawnDrop(m.x + size / 2 + randRange(-0.4, 0.4), m.y + size + 0.2, m.item, 1);
        }
        Sfx.pickup();
        break;
      }

      case 'bstocks':
        for (const k in m.s) {
          const b = world.buildings.get(k);
          if (b) b.stock = m.s[k];
        }
        break;

      case 'time':
        G.time = m.time;
        G.day = m.day;
        break;

      case 'boss':
        this.applyBossState(m.b);
        break;

      case 'bossSlam':
        bossLand({ x: m.x, y: m.y });
        break;

      case 'bossMinions':
        if (G.boss && dist2(player.x, player.y, m.x, m.y) < 30 * 30) {
          for (let i = 0; i < 2; i++) {
            spawnMob('slime', m.x + randRange(-1.5, 1.5), m.y + randRange(-1.5, 1.5));
          }
        }
        break;

      case 'bossDead':
        killBoss();
        UI.addChatLine('✦', '¡' + BOSS_CFG.name + ' ha caído gracias a todos! Llueve botín.');
        break;

      case 'denied':
        UI.toast(m.m);
        break;
    }
  },

  applyBossState(b) {
    if (!b || !b.active) {
      if (G.boss) { G.boss = null; UI.hideBossBar(); }
      return;
    }
    if (!G.boss) {
      spawnBoss(b.x, b.y, b.maxHp);
      G.boss.remote = true;
    }
    const boss = G.boss;
    boss.remote = true;
    boss.rx = b.x; boss.ry = b.y;
    boss.hp = b.hp; boss.maxHp = b.maxHp;
    boss.enraged = b.enraged;
    if (b.hop) boss.hopping = 0.3;
    UI.updateBossBar();
  },

  addPlayer(p) {
    const look = clampLook(p.look); // saneado: acota la caché de sets del héroe
    this.players.set(p.id, {
      name: p.name, look, color: HERO_COLORS[look.shirt],
      x: p.x || 0, y: p.y || 0, px: p.x || 0, py: p.y || 0,
      dir: p.dir || 'down', frameI: p.frameI || 0, hp: p.hp || 10,
      bubble: '', bubbleT: 0,
    });
  },

  update(dt) {
    if (!this.online) return;
    // interpola a los jugadores remotos hacia su último estado
    for (const [, p] of this.players) {
      const k = Math.min(1, dt * 10);
      p.px += (p.x - p.px) * k;
      p.py += (p.y - p.py) * k;
      p.bubbleT = Math.max(0, p.bubbleT - dt);
    }
    // envía nuestro estado ~8 veces/s
    this._sendT -= dt;
    if (this._sendT <= 0) {
      this._sendT = 0.12;
      this.send({
        t: 'st',
        x: +player.x.toFixed(2), y: +player.y.toFixed(2),
        dir: player.dir, f: player.frameI, hp: player.hp,
      });
    }
    // bonus "calor de hogar": hoguera + compañía cerca
    this._warmT -= dt;
    if (this._warmT <= 0) {
      this._warmT = 1;
      this._warm = this.computeWarm();
    }
  },

  computeWarm() {
    let company = false;
    for (const [, p] of this.players) {
      if (dist2(p.px, p.py, player.x, player.y) < 25) { company = true; break; }
    }
    if (!company) return false;
    const ptx = Math.floor(player.x), pty = Math.floor(player.y);
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const ob = world.object(ptx + dx, pty + dy);
        if (ob === O.FIRE || ob === O.BRAZIER) return true;
      }
    }
    return false;
  },

  warmBonus() { return this._warm; },

  sendChat(text) {
    const m = text.trim().slice(0, 120);
    if (!m) return;
    this.send({ t: 'chat', m });
    UI.addChatLine(this.myName + ' (tú)', m);
  },

  sendPlace(x, y, o) { this.send({ t: 'place', x, y, o }); },
  sendBreak(x, y) { this.send({ t: 'break', x, y }); },
  sendPlaceBuilding(x, y, o) { this.send({ t: 'bplace', x, y, o }); },
  sendBreakBuilding(x, y) { this.send({ t: 'bbreak', x, y }); },
  requestCollect(x, y) { this.send({ t: 'collect', x, y }); },
  requestSummon(x, y) { this.send({ t: 'summon', x, y }); },
  sendBossHit(d) { this.send({ t: 'bhit', d }); },

  onClose() {
    const wasOnline = this.online;
    this.available = false;
    this.online = false;
    G.online = false;
    this.players.clear();
    UI.updateOnlineButton(false, 0);
    if (wasOnline) {
      // writeMp directamente: Save.write() ya enruta por Net.online (false aquí)
      // y machacaría la partida local de un jugador con el mundo del servidor
      Save.writeMp();
      G.running = false;
      UI.hideChat();
      UI.showTitleAgain('Se perdió la conexión con el mundo compartido');
    }
    this.scheduleReprobe();
  },

  // Reintenta encontrar el servidor con espera creciente: tras una caída
  // se puede volver a entrar sin recargar la página.
  scheduleReprobe() {
    if (!location.host || !location.protocol.startsWith('http')) return;
    if (!this._everUp && this._retryMs >= 8000) return; // sin servidor (p.ej. GitHub Pages): deja de insistir
    this._retryMs = Math.min(this._retryMs ? this._retryMs * 2 : 2000, 30000);
    setTimeout(() => { if (!this.available) this.probe(); }, this._retryMs);
  },
};
