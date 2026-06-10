'use strict';
/* ============ Guardado en localStorage ============
   Solo se guardan los chunks modificados: el resto del mundo
   se regenera idéntico a partir de la semilla. */

const Save = {
  exists() {
    try { return !!localStorage.getItem(CFG.SAVE_KEY); }
    catch (e) { return false; }
  },

  write() {
    if (!G.running) return;
    const data = {
      v: 1,
      seed: world.seed,
      time: G.time,
      day: G.day,
      spawn: G.spawn,
      player: { x: player.x, y: player.y, hp: player.hp },
      inv: Inv.slots,
      sel: Inv.sel,
      chunks: world.modifiedChunks(),
    };
    try {
      localStorage.setItem(CFG.SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('No se pudo guardar la partida:', e);
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
};
