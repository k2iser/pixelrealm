'use strict';
/* ============ Guardado en localStorage ============
   Solo se guardan los chunks modificados: el resto del mundo se regenera
   idéntico a partir de la semilla. En multijugador el mundo vive en el
   servidor y aquí solo persiste el estado del jugador. */

const Save = {
  exists() {
    try { return !!localStorage.getItem(CFG.SAVE_KEY); }
    catch (e) { return false; }
  },

  // Estado del jugador: si está muerto se guarda ya reaparecido,
  // para no cargar nunca un cadáver con 0 corazones.
  _playerData() {
    return player.dead
      ? { x: G.spawn.x, y: G.spawn.y, hp: player.maxHp }
      : { x: +player.x.toFixed(2), y: +player.y.toFixed(2), hp: player.hp };
  },

  write() {
    if (!G.running || !world) return false;
    if (typeof Net !== 'undefined' && Net.online) return this.writeMp();
    const data = {
      v: 1,
      seed: world.seed,
      creative: G.creative,
      time: G.time,
      day: G.day,
      spawn: G.spawn,
      player: this._playerData(),
      inv: Inv.slots,
      sel: Inv.sel,
      chunks: world.modifiedChunks(),
      buildings: world.buildingsData(),
      drops: drops.slice(0, 80).map(d => ({ x: +d.x.toFixed(2), y: +d.y.toFixed(2), id: d.id, n: d.n })),
    };
    try {
      localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('No se pudo guardar la partida:', e);
      return false;
    }
  },

  read() {
    try {
      const raw = localStorage.getItem(CFG.SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1 || typeof data.seed !== 'number') return null;
      return data;
    } catch (e) {
      return null;
    }
  },

  clear() {
    try { localStorage.removeItem(CFG.SAVE_KEY); }
    catch (e) { /* sin almacenamiento disponible */ }
  },

  /* --- multijugador: solo jugador e inventario, por mundo de servidor --- */

  writeMp() {
    const data = {
      v: 1,
      spawn: G.spawn,
      player: this._playerData(),
      inv: Inv.slots,
      sel: Inv.sel,
    };
    try {
      localStorage.setItem('pixelrealm.mp.' + Net.worldId, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  },

  readMp(worldId) {
    try {
      const raw = localStorage.getItem('pixelrealm.mp.' + worldId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
};
