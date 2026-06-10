'use strict';
/* ============ HUD e interfaz (DOM): corazones, barra, paneles, minimapa ============ */

const UI = {
  panelOpen: false,
  helpOpen: false,
  _swapFrom: -1,     // casilla origen del intercambio en el inventario
  _toastTimer: null,
  _lastClockStep: -1,

  el(id) { return document.getElementById(id); },

  init() {
    // barra rápida: 9 casillas
    const hotbar = this.el('hotbar');
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.i = i;
      s.innerHTML = '<span class="key">' + (i + 1) + '</span><img alt=""><span class="count"></span>';
      s.addEventListener('click', () => {
        Inv.sel = i;
        this.refreshHotbar();
      });
      hotbar.appendChild(s);
    }

    // rejilla del inventario: 36 casillas (las 9 primeras espejan la barra)
    const grid = this.el('invgrid');
    for (let i = 0; i < 36; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.i = i;
      s.innerHTML = '<img alt=""><span class="count"></span>';
      s.addEventListener('click', () => this.slotClick(i));
      grid.appendChild(s);
    }

    // recetas
    const list = this.el('craftlist');
    for (const r of RECIPES) {
      const row = document.createElement('div');
      row.className = 'recipe';
      const costTxt = Object.entries(r.cost)
        .map(([id, n]) => n + '× ' + ITEMS[id].name).join(', ');
      row.innerHTML =
        '<img src="' + iconURL(r.out) + '" alt="">' +
        '<div class="rname">' + ITEMS[r.out].name + (r.n > 1 ? ' ×' + r.n : '') +
        '<span class="rcost">' + costTxt + '</span></div>' +
        '<button>Crear</button>';
      row.querySelector('button').addEventListener('click', () => {
        if (Inv.craft(r)) {
          Sfx.craft();
          this.refreshAll();
        }
      });
      list.appendChild(row);
    }

    this.el('btn-close-panel').addEventListener('click', () => this.togglePanel());

    // corazones
    const hearts = this.el('hearts');
    for (let i = 0; i < 5; i++) {
      const img = document.createElement('img');
      img.alt = '';
      hearts.appendChild(img);
    }
  },

  /* ---------- casillas ---------- */

  fillSlot(el, slot) {
    const img = el.querySelector('img');
    const count = el.querySelector('.count');
    if (slot) {
      img.src = iconURL(slot.id);
      img.style.display = '';
      el.title = ITEMS[slot.id].name;
      count.textContent = slot.n > 1 ? slot.n : '';
    } else {
      img.style.display = 'none';
      img.removeAttribute('src');
      el.title = '';
      count.textContent = '';
    }
  },

  refreshHotbar() {
    const slots = this.el('hotbar').children;
    for (let i = 0; i < 9; i++) {
      this.fillSlot(slots[i], Inv.slots[i]);
      slots[i].classList.toggle('selected', i === Inv.sel);
    }
  },

  refreshInv() {
    const slots = this.el('invgrid').children;
    for (let i = 0; i < 36; i++) {
      this.fillSlot(slots[i], Inv.slots[i]);
      slots[i].classList.toggle('swap-src', i === this._swapFrom);
      slots[i].classList.toggle('selected', i === Inv.sel);
    }
  },

  refreshCraft() {
    const rows = this.el('craftlist').children;
    for (let i = 0; i < RECIPES.length; i++) {
      const ok = Inv.canCraft(RECIPES[i]);
      rows[i].querySelector('button').disabled = !ok;
      rows[i].querySelector('.rcost').classList.toggle('missing', !ok);
    }
  },

  refreshHearts() {
    const imgs = this.el('hearts').children;
    for (let i = 0; i < 5; i++) {
      const v = player.hp - i * 2;
      imgs[i].src = (v >= 2 ? Assets.heart : v === 1 ? Assets.heartHalf : Assets.heartEmpty).toDataURL();
    }
  },

  refreshAll() {
    this.refreshHotbar();
    this.refreshInv();
    this.refreshCraft();
    this.refreshHearts();
  },

  slotClick(i) {
    if (this._swapFrom === -1) {
      if (!Inv.slots[i]) return;
      this._swapFrom = i;
    } else {
      const a = this._swapFrom;
      this._swapFrom = -1;
      const tmp = Inv.slots[a];
      Inv.slots[a] = Inv.slots[i];
      Inv.slots[i] = tmp;
      this.refreshHotbar();
    }
    this.refreshInv();
  },

  /* ---------- paneles ---------- */

  togglePanel() {
    this.panelOpen = !this.panelOpen;
    this.el('panel').classList.toggle('hidden', !this.panelOpen);
    if (this.panelOpen) {
      this.el('help').classList.add('hidden');
      this.helpOpen = false;
      this._swapFrom = -1;
      this.refreshInv();
      this.refreshCraft();
      Input.mdown = false;
    }
  },

  toggleHelp() {
    this.helpOpen = !this.helpOpen;
    this.el('help').classList.toggle('hidden', !this.helpOpen);
    if (this.helpOpen) {
      this.el('panel').classList.add('hidden');
      this.panelOpen = false;
    }
  },

  closeAll() {
    this.panelOpen = false;
    this.helpOpen = false;
    this.el('panel').classList.add('hidden');
    this.el('help').classList.add('hidden');
  },

  /* ---------- reloj y minimapa ---------- */

  setTime() {
    const step = Math.floor(G.time * 96);
    if (step === this._lastClockStep) return;
    this._lastClockStep = step;
    this.el('daylabel').textContent = 'Día ' + G.day;
    const c = this.el('clock');
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 14, 14);
    g.drawImage(G.darkness > 0.5 ? Assets.moon : Assets.sun, 0, 1);
  },

  renderMinimap() {
    if (!G.running) return;
    const c = this.el('minimap');
    const g = c.getContext('2d');
    const size = 132, px = 2, span = size / px; // 66x66 casillas
    const x0 = Math.floor(player.x - span / 2), y0 = Math.floor(player.y - span / 2);
    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        g.fillStyle = MINIMAP_COLORS[world.ground(x0 + x, y0 + y)] || '#000';
        g.fillRect(x * px, y * px, px, px);
      }
    }
    // jugador en el centro
    g.fillStyle = '#fff';
    g.fillRect(size / 2 - 2, size / 2 - 2, 4, 4);
    g.fillStyle = '#d83434';
    g.fillRect(size / 2 - 1, size / 2 - 1, 2, 2);
  },

  /* ---------- mensajes y overlays ---------- */

  toast(msg) {
    const t = this.el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  },

  showHUD() {
    this.el('topleft').classList.remove('hidden');
    this.el('minimap').classList.remove('hidden');
    this.el('hotbar').classList.remove('hidden');
  },

  hideTitle() {
    this.el('title-overlay').classList.add('hidden');
    this.showHUD();
  },

  showDeath() { this.el('death-overlay').classList.remove('hidden'); },
  hideDeath() { this.el('death-overlay').classList.add('hidden'); },
};
