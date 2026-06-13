'use strict';
/* ============ Inventario (36 casillas, las 9 primeras son la barra) ============ */

const Inv = {
  slots: new Array(36).fill(null),   // { id, n } | null
  sel: 0,                            // casilla activa de la barra (0-8)

  // Añade n unidades; devuelve cuántas NO cupieron
  add(id, n) {
    const def = ITEMS[id];
    if (!def) return n;
    let left = n;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.n < def.stack) {
        const take = Math.min(def.stack - s.n, left);
        s.n += take; left -= take;
      }
    }
    for (let i = 0; i < 36 && left > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(def.stack, left);
        this.slots[i] = { id, n: take };
        left -= take;
      }
    }
    return left;
  },

  count(id) {
    let c = 0;
    for (const s of this.slots) if (s && s.id === id) c += s.n;
    return c;
  },

  remove(id, n) {
    let left = n;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.n, left);
        s.n -= take; left -= take;
        if (s.n <= 0) this.slots[i] = null;
      }
    }
    return left === 0;
  },

  selected() { return this.slots[this.sel]; },

  consumeSelected(n) {
    const s = this.slots[this.sel];
    if (!s) return;
    s.n -= (n || 1);
    if (s.n <= 0) this.slots[this.sel] = null;
  },

  canCraft(r) {
    if (G.creative) return true;                 // en creativo todo es gratis
    for (const id in r.cost) if (this.count(id) < r.cost[id]) return false;
    return true;
  },

  craft(r) {
    if (!this.canCraft(r)) return false;
    if (!G.creative) for (const id in r.cost) this.remove(id, r.cost[id]);
    const left = this.add(r.out, r.n);
    if (left > 0) spawnDrop(player.x, player.y, r.out, left); // inventario lleno: al suelo
    return true;
  },
};
