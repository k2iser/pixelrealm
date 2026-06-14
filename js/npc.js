'use strict';
/* ============ Comerciantes (NPCs) y aldeas ============
   Las aldeas se generan deterministas a partir de la semilla (world.villageInfo).
   Cuando el jugador se acerca, sus comerciantes aparecen como entidades;
   se desvanecen al alejarse y reaparecen idénticos al volver.

   El diálogo intenta primero el endpoint /npc-chat del servidor (un LLM como
   Gemma); si no hay servidor o falla, usa respuestas procedurales ricas. */

const npcs = [];

const NPC = {
  _scanT: 0,
  _spawned: new Set(),     // claves de aldea ya pobladas
  _endpointOk: null,       // null=desconocido, false=no hay LLM, true=disponible
  _failStreak: 0,          // fallos 5xx/timeout consecutivos del LLM
  _coolUntil: 0,           // no reintentar el LLM hasta este instante (ms)
  active: null,            // NPC con el que hablas ahora
  history: [],             // turnos de la conversación actual

  /* ---------- ciclo de vida ---------- */

  update(dt) {
    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = 0.6; this.ensureVillages(); }
    for (const n of npcs) this.step(n, dt);
  },

  ensureVillages() {
    if (!world) return;
    const N = CFG.CHUNK;
    const pcx = Math.floor(player.x / N), pcy = Math.floor(player.y / N);
    for (let cy = pcy - 2; cy <= pcy + 2; cy++) {
      for (let cx = pcx - 2; cx <= pcx + 2; cx++) {
        const v = world.villageInfo(cx, cy);
        if (!v) continue;
        const vk = cx + ',' + cy;
        if (this._spawned.has(vk)) continue;
        this._spawned.add(vk);
        for (let i = 0; i < v.npcs.length; i++) {
          const p = v.npcs[i];
          this.spawn(vk + '#' + i, vk, p.role, p.x, p.y);
        }
      }
    }
    // desvanece aldeas lejanas (reaparecen deterministas al volver)
    // Histéresis: el spawn cubre chunks ±2 (centro a ≤~127 casillas en diagonal),
    // así que el despawn debe ocurrir MÁS allá de ese alcance para no parpadear.
    for (let i = npcs.length - 1; i >= 0; i--) {
      if (dist2(npcs[i].hx, npcs[i].hy, player.x, player.y) > 135 * 135) {
        if (this.active === npcs[i]) UI.closeNpc();
        this._spawned.delete(npcs[i].vk);
        npcs.splice(i, 1);
      }
    }
  },

  spawn(id, vk, roleIdx, x, y) {
    const role = NPC_ROLES[roleIdx];
    const seed = hashStr(id);
    npcs.push({
      id, vk, role: roleIdx, name: NPC_NAMES[seed % NPC_NAMES.length],
      x, y, hx: x, hy: y,
      look: clampLook({
        skin: Math.floor(hash2(seed, 1, 7) * HERO_SKINS.length),
        hair: role.hair,
        style: Math.floor(hash2(seed, 2, 7) * HERO_STYLES.length),
        shirt: role.shirt,
        pants: Math.floor(hash2(seed, 3, 7) * HERO_PANTS.length),
      }),
      dir: 'down', frameI: 0, animT: 0,
      wanderT: randRange(0.5, 2.5), wAng: 0, moving: false, t: Math.random() * 10,
    });
  },

  // deambula con calma alrededor de su puesto en la plaza
  step(n, dt) {
    n.t += dt;
    // mirar al jugador si está cerca
    if (dist2(n.x, n.y, player.x, player.y) < 9) {
      const dx = player.x - n.x, dy = player.y - n.y;
      const sdx = dx - dy, sdy = dx + dy;
      n.dir = Math.abs(sdx) > Math.abs(sdy) ? (sdx > 0 ? 'right' : 'left') : (sdy > 0 ? 'down' : 'up');
      n.moving = false; n.frameI = 0;
      return;
    }
    n.wanderT -= dt;
    if (n.wanderT <= 0) {
      n.wanderT = randRange(1.5, 4);
      n.moving = Math.random() < 0.6;
      n.wAng = randRange(0, Math.PI * 2);
    }
    if (n.moving) {
      const sp = 1.3;
      let nx = n.x + Math.cos(n.wAng) * sp * dt;
      let ny = n.y + Math.sin(n.wAng) * sp * dt;
      // no se aleja del puesto ni pisa sólidos
      if (dist2(nx, ny, n.hx, n.hy) < 9 && !world.isSolid(Math.floor(nx), Math.floor(ny))) {
        n.x = nx; n.y = ny;
        const sdx = Math.cos(n.wAng) - Math.sin(n.wAng), sdy = Math.cos(n.wAng) + Math.sin(n.wAng);
        n.dir = Math.abs(sdx) > Math.abs(sdy) ? (sdx > 0 ? 'right' : 'left') : (sdy > 0 ? 'down' : 'up');
        n.animT += dt;
        n.frameI = 1 + Math.floor(n.animT * 8) % 4;
      } else { n.moving = false; n.wanderT = 0.3; }
    } else {
      n.frameI = 0;
    }
  },

  at(wx, wy, r) {
    let best = null, bd = r * r;
    for (const n of npcs) {
      const d = dist2(n.x, n.y, wx, wy);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  },

  /* ---------- diálogo ---------- */

  // Devuelve una promesa con la respuesta del NPC (LLM si hay, si no procedural)
  async reply(npc, text) {
    this.history.push({ role: 'user', text });
    let out = null;
    // salta el LLM si está descartado (404/501/405) o en enfriamiento por fallos seguidos
    if (this._endpointOk !== false && Date.now() >= this._coolUntil) out = await this.remote(npc, text);
    if (out == null) out = this.procedural(npc, text);
    this.history.push({ role: 'npc', text: out });
    if (this.history.length > 12) this.history.splice(0, this.history.length - 12);
    return out;
  },

  async remote(npc, text) {
    let to = null;
    try {
      const ctrl = new AbortController();
      to = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch('npc-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // solo el ÍNDICE de rol: la persona la fija el servidor (anti inyección)
          role: npc.role,
          message: text,
          history: this.history.slice(-8),
          world: { day: G.day, night: G.darkness > 0.5 },
        }),
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (res.status === 404 || res.status === 501 || res.status === 405) { this._endpointOk = false; return null; }
      if (!res.ok) { this._noteFail(); return null; }   // 5xx (modelo caído): backoff, no bloquear cada turno
      const j = await res.json();
      if (j && typeof j.reply === 'string' && j.reply.trim()) {
        this._endpointOk = true; this._failStreak = 0; this._coolUntil = 0;
        return j.reply.trim().slice(0, 240);
      }
      this._noteFail();
      return null;
    } catch (e) {
      clearTimeout(to);
      this._noteFail(); // sin servidor / timeout (cuelgue del LLM) → backoff y procedural
      return null;
    }
  },

  // Tras varios fallos 5xx/timeout seguidos, deja de reintentar el LLM un rato
  // (no es permanente: si el modelo se recupera, vuelve a probarse pasado el enfriamiento)
  _noteFail() {
    this._failStreak++;
    if (this._failStreak >= 3) this._coolUntil = Date.now() + 60000; // 60 s de pausa
  },

  // Respuestas procedurales por palabras clave + personalidad del rol
  procedural(npc, text) {
    const role = NPC_ROLES[npc.role];
    const t = (text || '').toLowerCase();
    const pick = (arr, salt) => arr[Math.floor(hash2(hashStr(t), salt, npc.role) * arr.length) % arr.length];
    const has = (...ws) => ws.some(w => t.includes(w));

    if (!t.trim()) return pick(role.lines, 1);
    if (has('hola', 'buenas', 'saludos', 'qué tal', 'que tal', 'hey'))
      return pick([
        '¡Hola, viajera! ¿En qué puedo ayudarte?',
        'Buenas. Bienvenida a nuestra aldea.',
        '¡Anda, una cara nueva! Pasa, pasa.',
      ], 2);
    if (has('nombre', 'llamas', 'quién eres', 'quien eres', 'eres'))
      return 'Soy ' + npc.name + ', ' + role.title.toLowerCase() + ' de esta aldea. ' + pick(role.lines, 3);
    if (has('comprar', 'vender', 'precio', 'tienda', 'comercio', 'trato', 'venta', 'oro', 'moneda'))
      return pick([
        'Pulsa «Comerciar» y te enseño mi género.',
        'Tengo cosas buenas a buen precio. Mira en «Comerciar».',
        'El oro habla mejor que yo: abre el comercio y miramos.',
      ], 4);
    if (has('dónde', 'donde', 'camino', 'pueblo', 'ciudad', 'mapa', 'lejos'))
      return pick([
        'Hay otras aldeas repartidas por el mundo, si buscas bien.',
        'Sigue el río y encontrarás más gente como yo.',
        'El mundo es enorme; yo de aquí no me muevo, pero tú sí puedes.',
      ], 5);
    if (has('baba', 'monstruo', 'peligro', 'noche', 'sombra', 'murciélago', 'murcielago'))
      return pick([
        'De noche salen las babas. Una fogata o una antorcha las mantienen a raya.',
        'Las sombras arden con el sol; aguanta hasta el alba y estarás bien.',
        'Construye muros y una torre si quieres dormir tranquila.',
      ], 6);
    if (has('ayuda', 'consejo', 'cómo', 'como', 'empezar', 'hago'))
      return pick([
        'Tala árboles para madera, pica rocas para piedra, y con eso ya construyes.',
        'Un hacha y un pico te cambian la vida. Pásate por el carpintero o el cantero.',
        'Come bayas para curarte y no te alejes de la luz al anochecer.',
      ], 7);
    if (has('adiós', 'adios', 'gracias', 'hasta', 'chao', 'luego'))
      return pick([
        '¡Que la suerte te acompañe!',
        'Vuelve cuando quieras, aquí estaré.',
        'Cuídate ahí fuera, viajera.',
      ], 8);
    // por defecto: una frase de personalidad
    return pick(role.lines, 9);
  },

  /* ---------- comercio ---------- */

  buy(npc, item, price) {
    if (G.creative) { Inv.add(item, 1); Sfx.pickup(); return true; }
    if (Inv.count('coin') < price) { UI.toast('No tienes monedas suficientes'); return false; }
    Inv.remove('coin', price);
    const left = Inv.add(item, 1);
    if (left > 0) spawnDrop(player.x, player.y, item, left); // inventario lleno: al suelo
    Sfx.craft();
    return true;
  },

  sell(npc, item, price) {
    if (Inv.count(item) < 1) return false;
    Inv.remove(item, 1);
    Inv.add('coin', price);
    Sfx.pickup();
    return true;
  },
};
