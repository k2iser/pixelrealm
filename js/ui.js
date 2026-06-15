'use strict';
/* ============ HUD e interfaz (DOM): corazones, barra, paneles, minimapa, chat ============ */

const UI = {
  panelOpen: false,
  helpOpen: false,
  chatOpen: false,    // el campo de chat tiene el foco
  dialogOpen: false,  // hablando con un comerciante
  _tradeOpen: false,
  _swapFrom: -1,
  _toastTimer: null,
  _lastClockStep: -1,
  _chatLines: 0,

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

    // rejilla del inventario
    const grid = this.el('invgrid');
    for (let i = 0; i < 36; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.dataset.i = i;
      s.innerHTML = '<img alt=""><span class="count"></span>';
      s.addEventListener('click', () => this.slotClick(i));
      grid.appendChild(s);
    }

    // recetas en dos listas: objetos y construcciones
    for (const r of RECIPES) {
      const row = document.createElement('div');
      row.className = 'recipe';
      const costTxt = Object.entries(r.cost)
        .map(([id, n]) => n + '× ' + ITEMS[id].name).join(', ');
      row.innerHTML =
        '<img src="' + iconURL(r.out) + '" alt="">' +
        '<div class="rname">' + ITEMS[r.out].name + (r.n > 1 ? ' ×' + r.n : '') +
        (r.desc ? '<span class="rdesc">' + r.desc + '</span>' : '') +
        '<span class="rcost">' + costTxt + '</span></div>' +
        '<button>Crear</button>';
      row.querySelector('button').addEventListener('click', () => {
        if (Inv.craft(r)) {
          Sfx.craft();
          this.refreshAll();
        }
      });
      this.el(r.cat === 'build' ? 'buildlist' : 'craftlist').appendChild(row);
    }

    // pestañas del panel derecho
    this.el('tab-craft').addEventListener('click', () => this.setTab('craft'));
    this.el('tab-build').addEventListener('click', () => this.setTab('build'));
    this.el('tab-creative').addEventListener('click', () => this.setTab('creative'));
    this.el('btn-close-panel').addEventListener('click', () => this.togglePanel());

    // paleta creativa: todos los objetos a un clic
    const clist = this.el('creativelist');
    for (const id of Object.keys(ITEMS)) {
      if (id === 'coin') continue;
      const b = document.createElement('button');
      b.className = 'cre-item';
      b.title = ITEMS[id].name;
      const img = document.createElement('img'); img.src = iconURL(id); img.alt = '';
      const sp = document.createElement('span'); sp.textContent = ITEMS[id].name;
      b.appendChild(img); b.appendChild(sp);
      b.addEventListener('click', () => {
        Inv.add(id, ITEMS[id].stack > 1 ? ITEMS[id].stack : 1);
        Sfx.place();
        this.refreshAll();
      });
      clist.appendChild(b);
    }

    // diálogo de comerciantes
    this.el('npc-send').addEventListener('click', () => this.npcSend());
    this.el('npc-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') { this.npcSend(); e.preventDefault(); }
      if (e.key === 'Escape') this.closeNpc();
    });
    this.el('npc-trade-btn').addEventListener('click', () => this.toggleTrade());
    this.el('npc-close').addEventListener('click', () => this.closeNpc());

    // pista de bienvenida
    this.el('btn-hint-ok').addEventListener('click', () => {
      this.el('firsthint').classList.add('hidden');
      try { localStorage.setItem('pixelrealm.seenHint', '1'); } catch (e) { /* da igual */ }
    });

    // corazones
    const hearts = this.el('hearts');
    for (let i = 0; i < 5; i++) {
      const img = document.createElement('img');
      img.alt = '';
      hearts.appendChild(img);
    }

    // chat
    this.el('chat-send').addEventListener('click', () => this.submitChat());

    // nombre guardado
    try {
      const n = localStorage.getItem('pixelrealm.name');
      if (n) this.el('name-input').value = n;
    } catch (e) { /* sin almacenamiento */ }

    this.initHeroEditor();
  },

  /* ---------- editor de personaje ---------- */

  _edLook: null,
  _edTimer: null,
  _edT: 0,

  initHeroEditor() {
    this.el('btn-hero').addEventListener('click', () => {
      this._edLook = clampLook(G.look);
      this.el('hero-editor').classList.remove('hidden');
      this.refreshEditor();
      clearInterval(this._edTimer);
      this._edTimer = setInterval(() => this.drawHeroPreview(), 150);
    });
    for (const b of document.querySelectorAll('.opt-row button')) {
      b.addEventListener('click', () => {
        const opt = b.dataset.opt, d = +b.dataset.d;
        const lens = { skin: HERO_SKINS.length, hair: HERO_HAIRC.length, style: HERO_STYLES.length, shirt: 8, pants: HERO_PANTS.length };
        this._edLook[opt] = (this._edLook[opt] + d + lens[opt]) % lens[opt];
        Sfx.init(); Sfx.place();
        this.refreshEditor();
      });
    }
    this.el('btn-look-random').addEventListener('click', () => {
      this._edLook = clampLook({
        skin: Math.random() * HERO_SKINS.length, hair: Math.random() * HERO_HAIRC.length,
        style: Math.random() * HERO_STYLES.length, shirt: Math.random() * 8, pants: Math.random() * HERO_PANTS.length,
      });
      Sfx.init(); Sfx.craft();
      this.refreshEditor();
    });
    this.el('btn-look-done').addEventListener('click', () => {
      G.look = this._edLook;
      try { localStorage.setItem('pixelrealm.hero', JSON.stringify(G.look)); } catch (e) { /* da igual */ }
      Assets.player = getHeroLookSet(G.look);
      this.closeHeroEditor();
    });
  },

  closeHeroEditor() {
    clearInterval(this._edTimer);
    this._edTimer = null;
    this.el('hero-editor').classList.add('hidden');
  },

  refreshEditor() {
    const l = this._edLook;
    this.el('sw-skin').style.background = HERO_SKINS[l.skin];
    this.el('sw-hair').style.background = HERO_HAIRC[l.hair];
    this.el('sw-shirt').style.background = HERO_COLORS[l.shirt];
    this.el('sw-pants').style.background = HERO_PANTS[l.pants];
    this.el('sw-style').textContent = HERO_STYLES[l.style];
    this.drawHeroPreview();
  },

  drawHeroPreview() {
    const c = this.el('hero-preview');
    const g = c.getContext('2d');
    const set = getHeroLookSet(this._edLook);
    this._edT++;
    const dirs = ['down', 'right', 'up', 'left'];
    const dir = dirs[Math.floor(this._edT / 9) % 4];
    const frame = 1 + (this._edT % 4);
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(set[dir][frame], 0, 0);
  },

  setTab(which) {
    this.el('craftlist').classList.toggle('hidden', which !== 'craft');
    this.el('buildlist').classList.toggle('hidden', which !== 'build');
    this.el('creativelist').classList.toggle('hidden', which !== 'creative');
    this.el('tab-craft').classList.toggle('active', which === 'craft');
    this.el('tab-build').classList.toggle('active', which === 'build');
    this.el('tab-creative').classList.toggle('active', which === 'creative');
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
    const rows = [...this.el('craftlist').children, ...this.el('buildlist').children];
    const ordered = RECIPES.filter(r => r.cat !== 'build').concat(RECIPES.filter(r => r.cat === 'build'));
    for (let i = 0; i < ordered.length; i++) {
      const ok = Inv.canCraft(ordered[i]);
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
      this.el('tab-creative').classList.toggle('hidden', !G.creative);
      this.setTab(G.creative ? 'creative' : 'craft');
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
    this.closeChatInput();
    this.closeHeroEditor();
    this.closeNpc();
  },

  /* ---------- diálogo con comerciantes ---------- */

  openNpc(npc) {
    NPC.active = npc;
    NPC.history = [];
    this.dialogOpen = true;
    this._tradeOpen = false;
    player.cmd = null; player.path = null; player.drag = false; Input.mdown = false;
    this.el('npc-dialog').classList.remove('hidden');
    this.el('npc-trade').classList.add('hidden');
    this.el('npc-name').textContent = npc.name;
    this.el('npc-role').textContent = NPC_ROLES[npc.role].title;
    this.el('npc-log').innerHTML = '';
    this.drawNpcPortrait(npc);
    this.npcLine('them', '¡Hola! Soy ' + npc.name + ', ' + NPC_ROLES[npc.role].title.toLowerCase() +
      '. ¿Charlamos, comerciamos o tienes un momento para un recado?');
    this.renderNpcQuest(npc);
    setTimeout(() => this.el('npc-input').focus(), 30);
  },

  closeNpc() {
    this.dialogOpen = false;
    NPC.active = null;
    const d = this.el('npc-dialog');
    if (d) d.classList.add('hidden');
    const q = this.el('npc-quest');
    if (q) q.classList.add('hidden');
    const i = this.el('npc-input');
    if (i) i.blur();
  },

  _offer: null,

  renderNpcQuest(npc) {
    const el = this.el('npc-quest');
    // los recados son por mundo local: en el mundo compartido no se ofrecen aún
    if (typeof Net !== 'undefined' && Net.online) { el.classList.add('hidden'); return; }
    el.innerHTML = '';
    const q = G.quest;
    const txt = document.createElement('div');
    txt.className = 'quest-txt';
    const btn = document.createElement('button');
    if (q && q.role === npc.role) {
      const have = Math.min(Inv.count(q.item), q.need);
      const ready = Inv.count(q.item) >= q.need;
      txt.textContent = '⚑ ' + have + '/' + q.need + ' ' + ITEMS[q.item].name + ' → ' + q.reward + '◉' +
        (q.rewardItem ? ' + ' + ITEMS[q.rewardItem].name : '');
      btn.textContent = ready ? 'Entregar' : 'En curso…';
      btn.disabled = !ready;
      btn.addEventListener('click', () => {
        if (NPC.turnIn(npc)) {
          this.npcLine('them', '¡Justo lo que necesitaba, gracias! Aquí tienes lo prometido.');
          this.refreshAll();
          this.renderNpcQuest(npc);
        }
      });
    } else if (!q) {
      if (!this._offer || this._offer.role !== npc.role) this._offer = NPC.makeQuest(npc.role);
      const off = this._offer;
      txt.textContent = '⚑ Recado: ' + off.need + ' ' + ITEMS[off.item].name + ' → ' + off.reward + '◉' +
        (off.rewardItem ? ' + ' + ITEMS[off.rewardItem].name : '');
      btn.textContent = 'Aceptar';
      btn.addEventListener('click', () => {
        NPC.accept(off);
        this._offer = null;
        this.npcLine('them', '¡Trato hecho! Tráemelo cuando puedas.');
        this.renderNpcQuest(npc);
      });
    } else {
      el.classList.add('hidden');   // ya tienes un recado de otro comerciante
      return;
    }
    el.appendChild(txt);
    el.appendChild(btn);
    el.classList.remove('hidden');
  },

  updateQuestHud() {
    const el = this.el('questhud');
    if (!el) return;
    const q = G.quest;
    if (!q) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = '⚑ ' + Math.min(Inv.count(q.item), q.need) + '/' + q.need + ' ' + ITEMS[q.item].name;
  },

  npcLine(who, text) {
    const log = this.el('npc-log');
    const line = document.createElement('div');
    line.className = 'npc-line ' + (who === 'me' ? 'me' : 'them');
    line.textContent = text;
    log.appendChild(line);
    while (log.children.length > 40) log.removeChild(log.firstChild);
    this.scrollNpc();
    return line;
  },

  scrollNpc() { const log = this.el('npc-log'); log.scrollTop = log.scrollHeight; },

  npcSend() {
    const npc = NPC.active;
    if (!npc) return;
    const inp = this.el('npc-input');
    const v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    this.npcLine('me', v);
    const pending = this.npcLine('them', '…');
    NPC.reply(npc, v).then(r => { pending.textContent = r; this.scrollNpc(); });
  },

  toggleTrade() {
    this._tradeOpen = !this._tradeOpen;
    this.el('npc-trade').classList.toggle('hidden', !this._tradeOpen);
    if (this._tradeOpen) this.renderTrade();
  },

  renderTrade() {
    const npc = NPC.active;
    if (!npc) return;
    const role = NPC_ROLES[npc.role];
    const wrap = this.el('npc-trade');
    wrap.innerHTML = '';
    const coins = document.createElement('div');
    coins.className = 'trade-coins';
    coins.textContent = '◉ Tus monedas: ' + Inv.count('coin');
    wrap.appendChild(coins);
    const mkRow = (item, price, kind) => {
      const row = document.createElement('div');
      row.className = 'trade-row';
      const img = document.createElement('img'); img.src = iconURL(item); img.alt = '';
      const name = document.createElement('span'); name.className = 'trade-name';
      name.textContent = ITEMS[item].name + (kind === 'sell' ? ' ×' + Inv.count(item) : '');
      const btn = document.createElement('button');
      btn.textContent = (kind === 'buy' ? 'Comprar' : 'Vender') + ' ' + price + '◉';
      if (kind === 'sell' && Inv.count(item) < 1) btn.disabled = true;
      btn.addEventListener('click', () => {
        const ok = kind === 'buy' ? NPC.buy(npc, item, price) : NPC.sell(npc, item, price);
        if (ok) { this.refreshAll(); this.renderTrade(); }
      });
      row.appendChild(img); row.appendChild(name); row.appendChild(btn);
      wrap.appendChild(row);
    };
    if (role.sells.length) { const h = document.createElement('div'); h.className = 'trade-h'; h.textContent = 'A la venta'; wrap.appendChild(h); }
    for (const [item, price] of role.sells) mkRow(item, price, 'buy');
    if (role.buys.length) { const h = document.createElement('div'); h.className = 'trade-h'; h.textContent = 'Te compra'; wrap.appendChild(h); }
    for (const [item, price] of role.buys) mkRow(item, price, 'sell');
  },

  drawNpcPortrait(npc) {
    const c = this.el('npc-portrait');
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    const img = getHeroLookSet(npc.look).down[0];
    g.drawImage(img, 0, 0, img.width, img.height, 2, 2, c.width - 4, c.height - 4);
  },

  /* ---------- chat (multijugador) ---------- */

  showChat() { this.el('chat').classList.remove('hidden'); },
  hideChat() {
    this.el('chat').classList.add('hidden');
    this.el('chat-log').innerHTML = '';
    this._chatLines = 0;
    this.closeChatInput();
  },

  openChatInput() {
    this.chatOpen = true;
    this.el('chat-inputrow').classList.remove('hidden');
    this.el('chat-input').focus();
    Input.keys = {};
    Input.mdown = false;
  },

  closeChatInput() {
    this.chatOpen = false;
    this.el('chat-inputrow').classList.add('hidden');
    this.el('chat-input').value = '';
    this.el('chat-input').blur();
  },

  submitChat() {
    const v = this.el('chat-input').value;
    if (v.trim() && typeof Net !== 'undefined') Net.sendChat(v);
    this.closeChatInput();
  },

  addChatLine(name, text) {
    const log = this.el('chat-log');
    const line = document.createElement('div');
    line.className = 'chat-line';
    const b = document.createElement('b');
    b.textContent = name + ': ';
    line.appendChild(b);
    line.appendChild(document.createTextNode(text)); // texto de otros: nunca como HTML
    log.appendChild(line);
    this._chatLines++;
    while (this._chatLines > 9) {
      log.removeChild(log.firstChild);
      this._chatLines--;
    }
    line.style.animation = 'chat-in 0.2s';
  },

  /* ---------- barra del jefe ---------- */

  showBossBar() {
    this.el('bossbar').classList.remove('hidden');
    this.el('bossname').textContent = BOSS_CFG.name;
    this.updateBossBar();
  },
  hideBossBar() { this.el('bossbar').classList.add('hidden'); },
  updateBossBar() {
    if (!G.boss) return;
    const f = clamp(G.boss.hp / G.boss.maxHp, 0, 1);
    this.el('bossfill').style.width = (f * 100).toFixed(1) + '%';
    this.el('bossfill').classList.toggle('enraged', !!G.boss.enraged);
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
    if (!G.running || !world) return;
    const c = this.el('minimap');
    const g = c.getContext('2d');
    const size = 132, px = 2, span = size / px;
    const x0 = Math.floor(player.x - span / 2), y0 = Math.floor(player.y - span / 2);
    for (let y = 0; y < span; y++) {
      for (let x = 0; x < span; x++) {
        g.fillStyle = MINIMAP_COLORS[world.ground(x0 + x, y0 + y)] || '#000';
        g.fillRect(x * px, y * px, px, px);
      }
    }
    // aldeas dentro del minimapa (cuadro dorado)
    const N = CFG.CHUNK;
    for (let cy = Math.floor(y0 / N); cy <= Math.floor((y0 + span) / N); cy++) {
      for (let cx = Math.floor(x0 / N); cx <= Math.floor((x0 + span) / N); cx++) {
        const v = world.villageInfo(cx, cy);
        if (!v) continue;
        const mx = (v.vx - x0) * px, my = (v.vy - y0) * px;
        if (mx >= 0 && mx < size && my >= 0 && my < size) {
          g.fillStyle = '#4d2b32'; g.fillRect(mx - 3, my - 3, 6, 6);
          g.fillStyle = '#e8c14d'; g.fillRect(mx - 2, my - 2, 4, 4);
        }
      }
    }
    // comerciantes cargados
    g.fillStyle = '#ffe9a8';
    for (const n of npcs) {
      const mx = (n.x - x0) * px, my = (n.y - y0) * px;
      if (mx >= 0 && mx < size && my >= 0 && my < size) g.fillRect(mx - 1, my - 1, 2, 2);
    }
    // otros jugadores
    if (typeof Net !== 'undefined' && Net.online) {
      g.fillStyle = '#ffd34d';
      for (const [, p] of Net.players) {
        const mx = (p.px - x0) * px, my = (p.py - y0) * px;
        if (mx >= 0 && mx < size && my >= 0 && my < size) g.fillRect(mx - 1, my - 1, 3, 3);
      }
    }
    // el Coloso
    if (G.boss) {
      const bx = (G.boss.x - x0) * px, by = (G.boss.y - y0) * px;
      if (bx >= 0 && bx < size && by >= 0 && by < size) {
        g.fillStyle = '#d83434';
        g.fillRect(bx - 2, by - 2, 5, 5);
      }
    }
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
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  },

  updateOnlineButton(available, count) {
    const btn = this.el('btn-online');
    const row = this.el('name-row');
    btn.classList.toggle('hidden', !available);
    row.classList.toggle('hidden', !available);
    if (available) {
      btn.textContent = count > 0
        ? 'Entrar al mundo compartido (' + count + ' jugando)'
        : 'Entrar al mundo compartido';
    }
  },

  showHUD() {
    this.el('topleft').classList.remove('hidden');
    this.el('minimap').classList.remove('hidden');
    this.el('hotbar').classList.remove('hidden');
  },

  hideTitle() {
    this.el('title-overlay').classList.add('hidden');
    this.closeHeroEditor(); // que nunca arranque la partida con el editor encima
    this.showHUD();
  },

  showTitleAgain(msg) {
    this.el('title-overlay').classList.remove('hidden');
    this.hideBossBar();
    if (typeof Sfx !== 'undefined') Sfx.stopRain();   // corta el bucle de lluvia al volver al título
    if (msg) this.toast(msg);
  },

  showDeath() { this.el('death-overlay').classList.remove('hidden'); },
  hideDeath() { this.el('death-overlay').classList.add('hidden'); },

  maybeShowHint() {
    let seen = false;
    try { seen = !!localStorage.getItem('pixelrealm.seenHint'); } catch (e) { /* sin storage */ }
    if (!seen) this.el('firsthint').classList.remove('hidden');
  },
};
