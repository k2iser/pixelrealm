'use strict';
/* ============ Modo 2D lateral (tipo Terraria) ============
   Física de plataformas (gravedad + colisión AABB por tiles), cámara lateral,
   render de tiles cuadrados, picar/colocar, y el héroe con el rig de PERFIL.
   Reutiliza inventario, items, audio, el rig (drawHero) y la capa de luz. */

const SIDE = { HW: 0.34, BODY: 1.72 };   // medio ancho y alto de la caja del jugador (pies en player.y)

/* ---------- arte: tiles (atlas externo CC0 + fallback procedural) ---------- */
const _tile2dCache = {};
// iconos de hotbar para items del modo 2D que no tienen icono iso (se usa como fallback de iconURL)
const ICON2D_MAT = { dirt: T.DIRT, stone: T.STONE, walls: T.BRICK, wallw: T.WOOD, plank: T.WOOD, wood: T.WOOD, torch: T.TORCH, gate: T.GATE, crystal: T.CRYSTAL, coal: T.COAL_ORE, iron_ore: T.IRON_ORE };
function icon2dURL(id) {
  const TS = CFG.TS;
  const mat = ICON2D_MAT[id];
  if (mat != null && typeof tile2d === 'function') {
    const [c, g] = cv(32, 32); g.imageSmoothingEnabled = false;
    g.drawImage(tile2d(mat, 0), 0, 0, TS, TS, 2, 2, 28, 28);
    return c.toDataURL();
  }
  const blob = (col, hi) => { const [c, g] = cv(32, 32); g.fillStyle = col; g.beginPath(); g.ellipse(16, 18, 11, 9, 0, 0, 7); g.fill(); g.fillStyle = hi; g.fillRect(11, 12, 5, 3); return c.toDataURL(); };
  if (id === 'meat') return blob('#b8473a', '#e89a7a');
  if (id === 'leather') return blob('#8a5a32', '#b07d4a');
  if (id === 'bone') { const [c, g] = cv(32, 32); g.fillStyle = '#ece4cc'; g.fillRect(9, 14, 14, 4); g.beginPath(); g.arc(9, 13, 3, 0, 7); g.arc(9, 19, 3, 0, 7); g.arc(23, 13, 3, 0, 7); g.arc(23, 19, 3, 0, 7); g.fill(); return c.toDataURL(); }
  return '';
}
// se llama cuando terminan de cargar los assets externos: descarta los tiles
// procedurales cacheados para regenerarlos desde el atlas CC0.
function invalidate2dTiles() { for (const k in _tile2dCache) delete _tile2dCache[k]; }
// vetas de mineral superpuestas sobre la piedra base
function oreSpecks(g, col, hi, salt) {
  const TS = CFG.TS;
  for (let i = 0; i < 9; i++) {
    const x = 2 + (hash2(i, 1, salt) * (TS - 5) | 0), y = 2 + (hash2(i, 2, salt) * (TS - 5) | 0);
    g.fillStyle = col; g.fillRect(x, y, 2, 2);
    g.fillStyle = hi; g.fillRect(x, y, 1, 1);
  }
}
// piedra rocosa procedural y SEAMLESS (sin bandas), con variantes para romper la repetición
function rockyStone(g, TS, v) {
  const s = v * 131 + 7;
  g.fillStyle = '#6f6f7a'; g.fillRect(0, 0, TS, TS);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const h = hash2(x + (s & 15), y + ((s >> 2) & 15), s);
    if (h < 0.13) { g.fillStyle = '#565662'; g.fillRect(x, y, 1, 1); }
    else if (h > 0.9) { g.fillStyle = '#84848f'; g.fillRect(x, y, 1, 1); }
  }
  for (let i = 0; i < 4; i++) {                              // bloques de roca oscuros dispersos
    const x = (hash2(i, 1, s) * (TS - 2)) | 0, y = (hash2(i, 2, s) * (TS - 2)) | 0;
    g.fillStyle = '#4c4c57'; g.fillRect(x, y, 2, 2);
  }
  // grieta corta de cantera, orientada según variante (rompe cualquier línea continua)
  g.strokeStyle = 'rgba(40,40,48,0.7)'; g.lineWidth = 1;
  g.beginPath();
  const a = (v % 4) * 0.9 + 0.4, cx = TS / 2, cy = TS / 2, L = TS * 0.5;
  g.moveTo(cx - Math.cos(a) * L, cy - Math.sin(a) * L);
  g.lineTo(cx + Math.cos(a) * L * 0.6, cy + Math.sin(a) * L * 0.6);
  g.stroke();
}
function tile2d(mat, variant) {
  variant = variant || 0;
  const key = mat + ':' + variant;
  if (_tile2dCache[key]) return _tile2dCache[key];
  const TS = CFG.TS;
  const [c, g] = cv(TS, TS);
  if (mat === T.TORCH) {
    // antorcha sobre fondo transparente: palo + cabeza de llama
    const cx = TS >> 1;
    g.fillStyle = '#6b4a2a'; g.fillRect(cx - 1, TS - 9, 2, 8);              // palo
    g.fillStyle = '#3a2715'; g.fillRect(cx - 1, TS - 9, 1, 8);
    g.fillStyle = '#ff7a1a'; g.fillRect(cx - 2, TS - 14, 4, 6);            // llama exterior
    g.fillStyle = '#ffc23a'; g.fillRect(cx - 1, TS - 13, 2, 4);            // llama media
    g.fillStyle = '#fff0b0'; g.fillRect(cx - 1, TS - 12, 1, 2);            // núcleo
    _tile2dCache[key] = c;
    return c;
  }
  if (mat === T.GATE) {
    // Puerta Abisal: marco rúnico de piedra con umbral violáceo (fondo transparente)
    g.fillStyle = '#3a3450'; g.fillRect(1, 1, TS - 2, TS - 1);
    g.fillStyle = '#221d33'; g.fillRect(3, 3, TS - 6, TS - 3);
    g.fillStyle = '#110d1c'; g.fillRect(4, 5, TS - 8, TS - 5);
    g.fillStyle = 'rgba(150,110,255,0.40)'; g.fillRect(5, 6, TS - 10, TS - 7);   // umbral brillante
    g.fillStyle = '#c9a3ff';                                                     // runas
    g.fillRect((TS / 2 | 0) - 1, 4, 2, 2); g.fillRect(3, (TS / 2 | 0), 2, 2); g.fillRect(TS - 5, (TS / 2 | 0), 2, 2);
    g.fillRect((TS / 2 | 0), TS - 4, 1, 2);
    _tile2dCache[key] = c;
    return c;
  }
  if (mat === T.WOOD || mat === T.PLATFORM) {
    // tablones de madera (estructuras y construcciones)
    const step = Math.max(4, (TS / 4) | 0);
    g.fillStyle = '#7a5230'; g.fillRect(0, 0, TS, TS);
    g.fillStyle = '#5e3f24'; for (let y = 0; y < TS; y += step) g.fillRect(0, y, TS, 1);
    g.fillStyle = '#8a6238'; for (let y = 1; y < TS; y += step) g.fillRect(0, y, TS, 1);
    g.fillStyle = '#4e3320'; for (let i = 0; i < 6; i++) { const x = hash2(i, 1, variant * 5 + 2) * TS | 0, y = hash2(i, 2, variant * 5 + 2) * TS | 0; g.fillRect(x, y, 1, 1); }
    _tile2dCache[key] = c; return c;
  }
  if (mat === T.CHEST || mat === T.CHEST_OPEN) {
    // cofre (placeholder procedural; sustituible por sprite de PixelLab)
    const open = mat === T.CHEST_OPEN;
    g.fillStyle = '#7a5230'; g.fillRect(2, TS - 12, TS - 4, 11);
    g.fillStyle = '#5e3f24'; g.fillRect(2, TS - 12, TS - 4, 1); g.fillRect(2, TS - 2, TS - 4, 1);
    if (open) { g.fillStyle = '#241a10'; g.fillRect(4, TS - 11, TS - 8, 5); g.fillStyle = '#5e3f24'; g.fillRect(2, TS - 17, TS - 4, 4); }
    else { g.fillStyle = '#8a6238'; g.fillRect(2, TS - 13, TS - 4, 4); }
    g.fillStyle = '#caa15a'; g.fillRect((TS / 2 | 0) - 1, TS - 13, 2, 12);
    g.fillStyle = '#e8c878'; g.fillRect((TS / 2 | 0) - 1, TS - 9, 2, 2);
    _tile2dCache[key] = c; return c;
  }
  if (mat === T.BRICK) {
    // ladrillo de piedra (dwarf-holds / viviendas de cueva)
    const bh = Math.max(3, (TS / 4) | 0);
    g.fillStyle = '#585463'; g.fillRect(0, 0, TS, TS);
    g.strokeStyle = '#3a3744'; g.lineWidth = 1;
    for (let y = 0; y < TS; y += bh) {
      g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(TS, y + 0.5); g.stroke();
      const off = ((y / bh) & 1) ? (TS / 2) : 0;
      for (let x = off; x <= TS; x += TS / 2) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + bh); g.stroke(); }
    }
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 0, TS, 1);
    _tile2dCache[key] = c; return c;
  }
  // piedra y vetas: rocosa procedural con variantes (evita el bandeado del atlas)
  if (mat === T.STONE || mat === T.COAL_ORE || mat === T.IRON_ORE || mat === T.CRYSTAL) {
    rockyStone(g, TS, variant);
    if (mat === T.COAL_ORE) oreSpecks(g, '#1e1e26', '#3a3a46', 41 + variant);
    else if (mat === T.IRON_ORE) oreSpecks(g, '#c08a5a', '#e6c79a', 53 + variant);
    else if (mat === T.CRYSTAL) {
      for (let i = 0; i < 5; i++) {
        const x = 3 + (hash2(i, 1, 71 + variant) * (TS - 6) | 0), y = 3 + (hash2(i, 2, 71 + variant) * (TS - 6) | 0);
        g.fillStyle = '#7a3fd0'; g.fillRect(x, y, 3, 3);
        g.fillStyle = '#c9a3ff'; g.fillRect(x + 1, y, 1, 2);
        g.fillStyle = '#ffffff'; g.fillRect(x + 1, y + 1, 1, 1);
      }
    }
    _tile2dCache[key] = c;
    return c;
  }
  // --- resto (hierba/tierra/arena) desde el atlas externo CC0 (si está cargado) ---
  if (typeof Assets2D !== 'undefined' && Assets2D.ready) {
    const src = TILE_SRC[mat], atlas = Assets2D.img.terrain;
    if (src && atlas && atlas.naturalWidth) {
      g.imageSmoothingEnabled = false;
      if (variant & 1) { g.translate(TS, 0); g.scale(-1, 1); }   // volteo horizontal para variar
      g.drawImage(atlas, src.c * 16, src.r * 16, 16, 16, 0, 0, TS, TS);
      g.setTransform(1, 0, 0, 1, 0, 0);
      _tile2dCache[key] = c;
      return c;
    }
  }
  const speck = (base, dk, lt, salt) => {
    g.fillStyle = base; g.fillRect(0, 0, TS, TS);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const h = hash2(x, y, salt);
      if (h < 0.14) { g.fillStyle = dk; g.fillRect(x, y, 1, 1); }
      else if (h > 0.9) { g.fillStyle = lt; g.fillRect(x, y, 1, 1); }
    }
  };
  if (mat === T.GRASS) {
    speck('#785030', '#5f3f25', '#8a6038', 41);
    g.fillStyle = '#4d8a2f'; g.fillRect(0, 0, TS, 6);
    g.fillStyle = '#62b23e'; g.fillRect(0, 0, TS, 4);
    for (let x = 0; x < TS; x++) if (hash2(x, 7, 9) < 0.5) { g.fillStyle = '#76c64c'; g.fillRect(x, 0, 1, 2 + (hash2(x, 8, 9) * 2 | 0)); }
    g.fillStyle = '#3c6f26'; for (let x = 0; x < TS; x++) if (hash2(x, 5, 3) < 0.25) g.fillRect(x, 5, 1, 1);
  } else if (mat === T.DIRT) {
    speck('#785030', '#5f3f25', '#8a6038', 17);
  } else if (mat === T.STONE) {
    speck('#6a6a74', '#54545e', '#7d7d88', 23);
  } else if (mat === T.SAND) {
    speck('#d8c486', '#c2ad6e', '#e6d49a', 29);
  } else if (mat === T.COAL_ORE) {
    speck('#6a6a74', '#54545e', '#7d7d88', 23);
    g.fillStyle = '#23232a'; for (let i = 0; i < 7; i++) { const x = 3 + (hash2(i, 1, 5) * (TS - 7) | 0), y = 3 + (hash2(i, 2, 5) * (TS - 7) | 0); g.fillRect(x, y, 2, 2); }
  } else if (mat === T.IRON_ORE) {
    speck('#6a6a74', '#54545e', '#7d7d88', 23);
    g.fillStyle = '#c79466'; for (let i = 0; i < 7; i++) { const x = 3 + (hash2(i, 3, 6) * (TS - 7) | 0), y = 3 + (hash2(i, 4, 6) * (TS - 7) | 0); g.fillRect(x, y, 2, 2); }
    g.fillStyle = '#e0b486'; for (let i = 0; i < 4; i++) { const x = 4 + (hash2(i, 5, 6) * (TS - 8) | 0), y = 4 + (hash2(i, 6, 6) * (TS - 8) | 0); g.fillRect(x, y, 1, 1); }
  } else if (mat === T.BEDROCK) {
    speck('#34343c', '#26262c', '#42424a', 13);
  } else {
    g.fillStyle = '#444'; g.fillRect(0, 0, TS, TS);
  }
  // bisel sutil: luz arriba-izq, sombra abajo-der (lee como cubo)
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 0, TS, 1); g.fillRect(0, 0, 1, TS);
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, TS - 1, TS, 1); g.fillRect(TS - 1, 0, 1, TS);
  _tile2dCache[key] = c;
  return c;
}

/* ---------- física lateral ---------- */
function boxBlocked2d(cx, fy) {
  const x0 = Math.floor(cx - SIDE.HW), x1 = Math.floor(cx + SIDE.HW - 1e-4);
  const y0 = Math.floor(fy - SIDE.BODY), y1 = Math.floor(fy - 1e-4);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (world.isSolid(tx, ty)) return true;
  return false;
}
function move2d(e, dx, dy) {
  if (dx) {
    if (!boxBlocked2d(e.x + dx, e.y)) e.x += dx;
    else { const st = Math.sign(dx) * 0.04, lim = Math.abs(dx); let m = 0; while (m < lim && !boxBlocked2d(e.x + st, e.y)) { e.x += st; m += 0.04; } e.vx2 = 0; }
  }
  if (dy) {
    if (!boxBlocked2d(e.x, e.y + dy)) e.y += dy;
    else { const st = Math.sign(dy) * 0.04, lim = Math.abs(dy); let m = 0; while (m < lim && !boxBlocked2d(e.x, e.y + st)) { e.y += st; m += 0.04; } if (dy > 0) e.grounded = true; e.vy2 = 0; }
  }
}
function approach(v, t, d) { return v < t ? Math.min(t, v + d) : Math.max(t, v - d); }

function onLand2d() {
  const impact = Math.min(1, Math.abs(player.vy2 || 0) / CFG.G2D_JUMP);
  player.landT = 0.14 * impact;
  if (impact > 0.4) { G.shake = Math.max(G.shake, 0.14 * impact); Sfx.land(); }
  for (let i = 0; i < 4 + (impact * 4 | 0); i++) {
    particles.push({ x: player.x + randRange(-0.3, 0.3), y: player.y - 0.05, vx: randRange(-1.5, 1.5), vy: randRange(-1.2, -0.2), z: 0, vz: 0, life: 0.35, maxLife: 0.35, color: 'rgba(150,130,95,0.7)', flat2d: true });
  }
}

/* ---------- cursor / picar / colocar ---------- */
function hoveredTile2d() {
  const TS = CFG.TS;
  const wx = cam.ox + Input.mx / TS, wy = cam.oy + Input.my / TS;
  return { tx: Math.floor(wx), ty: Math.floor(wy), wx, wy };
}
function heldTool2d() { const s = Inv.selected(); return (s && ITEMS[s.id] && ITEMS[s.id].tool) ? s.id : null; }
// celdas que ocupa el cuerpo del jugador (columna y filas)
function playerCells2d() {
  return {
    col: Math.floor(player.x),
    rTop: Math.floor(player.y - SIDE.BODY),
    rBot: Math.floor(player.y - 1e-4),
  };
}
// ¿el tile está justo delante (o encima/debajo) del personaje, a su alcance?
function canMine2d(h) {
  const p = playerCells2d(), fd = player.dir === 'left' ? -1 : 1;
  const colOk = (h.tx === p.col) || (h.tx === p.col + fd);     // misma columna (arriba/abajo) o la de delante
  return colOk && h.ty >= p.rTop - 1 && h.ty <= p.rBot + 1;
}
// ¿celda adyacente al cuerpo (anillo de 1), para colocar?
function canPlace2d(h) {
  const p = playerCells2d();
  return Math.abs(h.tx - p.col) <= 1 && h.ty >= p.rTop - 1 && h.ty <= p.rBot + 1;
}
// soporte: una celda nueva necesita un sólido contiguo (nada flotando en el vacío).
// Solo cuentan sólidos reales: una antorcha no sostiene a otra.
function hasSupport2d(tx, ty) {
  return world.isSolid(tx - 1, ty) || world.isSolid(tx + 1, ty) ||
         world.isSolid(tx, ty - 1) || world.isSolid(tx, ty + 1);
}
function updateBreaking2d(dt) {
  if (!Input.mdown || UI.panelOpen || UI.chatOpen || UI.dialogOpen) { player.breaking = null; return; }
  const h = hoveredTile2d();
  // mira hacia el cursor ANTES de comprobar el alcance, para poder picar de pie a cualquier lado
  if (Math.abs(h.wx - player.x) > 0.15) player.dir = h.wx >= player.x ? 'right' : 'left';
  // --- talar árbol (segundo plano, no sólido): si el cursor cae sobre un árbol contiguo ---
  const th = world.treeHeightAt(h.tx);
  if (th > 0) {
    const surf = world.surfaceY(h.tx), top = surf - th, baseRow = surf - 1;
    if (world.ground(h.tx, h.ty) === T.AIR && h.ty >= top && h.ty <= baseRow && Math.abs(h.tx - Math.floor(player.x)) <= 1) {
      const key = 'tree:' + h.tx;
      if (!player.breaking || player.breaking.key !== key) player.breaking = { key, tx: h.tx, ty: baseRow, id: 'tree', dmg: 0, hp: 5 };
      const isAxe = Inv.selected() && ITEMS[Inv.selected().id] && ITEMS[Inv.selected().id].tool === 'axe';
      player.breaking.dmg += dt * (G.creative ? 99 : (isAxe ? 2.6 : 1.1));
      player.swingT = 0.18;
      if (player.breaking.dmg >= player.breaking.hp) {
        world.chopTree(h.tx);
        if (!G.creative) Inv.add('wood', 3 + (hash2(h.tx, 2, 9) * 3 | 0));
        Sfx.mine();
        for (let i = 0; i < 10; i++) particles.push({ x: h.tx + 0.5 + randRange(-0.4, 0.4), y: top + randRange(0, th), vx: randRange(-1.5, 1.5), vy: randRange(-1, 1), z: 0, vz: 0, life: 0.5, maxLife: 0.5, color: 'rgba(70,140,70,0.85)', flat2d: true });
        player.breaking = null; if (UI.refreshHotbar) UI.refreshHotbar();
      }
      return;
    }
  }
  if (!canMine2d(h)) { player.breaking = null; return; }
  const mat = world.ground(h.tx, h.ty), def = TDEF[mat];
  // se pueden picar materiales con dureza finita (incluida la antorcha, que no es sólida)
  if (!def || mat === T.AIR || def.hp == null || def.hp === Infinity) { player.breaking = null; return; }
  if (!player.breaking || player.breaking.tx !== h.tx || player.breaking.ty !== h.ty) player.breaking = { tx: h.tx, ty: h.ty, id: mat, dmg: 0 };
  const tool = (Inv.selected() && ITEMS[Inv.selected().id]) ? ITEMS[Inv.selected().id].tool : null;
  player.breaking.dmg += dt * (G.creative ? 99 : (def.tool && tool === def.tool ? 2.4 : 1.3));
  player.swingT = 0.18;
  if (player.breaking.dmg >= def.hp) {
    world.setGround(h.tx, h.ty, T.AIR);
    if (!G.creative) for (const d of (def.drops || [])) if (Math.random() < d[2]) Inv.add(d[0], d[1]);
    Sfx.mine();
    for (let i = 0; i < 7; i++) particles.push({ x: h.tx + 0.5 + randRange(-0.3, 0.3), y: h.ty + 0.5 + randRange(-0.3, 0.3), vx: randRange(-2, 2), vy: randRange(-2.5, 0.5), z: 0, vz: 0, life: 0.4, maxLife: 0.4, color: 'rgba(150,130,95,0.8)', flat2d: true });
    player.breaking = null;
    if (UI.refreshHotbar) UI.refreshHotbar();
    if (UI.panelOpen && UI.refreshInv) UI.refreshInv();
  }
}
function placeAt2d() {
  if (UI.panelOpen || UI.chatOpen || UI.dialogOpen || player.dead) return;
  // clic derecho sobre una Puerta Abisal contigua => INVOCAR descenso
  const hg = hoveredTile2d();
  if (world.ground(hg.tx, hg.ty) === T.GATE && canPlace2d(hg)) { descend2d(); return; }
  // clic derecho sobre un cofre contiguo => abrirlo (botín)
  if (world.ground(hg.tx, hg.ty) === T.CHEST && canPlace2d(hg)) { openChest2d(hg.tx, hg.ty); return; }
  const sel = Inv.selected(); if (!sel) return;
  const mat = PLACE2D[sel.id];
  if (mat == null) {                                   // no colocable en 2D: avisa en vez de ignorar
    if (ITEMS[sel.id] && ITEMS[sel.id].place) UI.toast('Eso no se puede construir en el modo 2D');
    return;
  }
  const h = hoveredTile2d();
  if (!canPlace2d(h)) return;
  if (world.ground(h.tx, h.ty) !== T.AIR) return;
  // física: nada flotando — el bloque necesita un sólido contiguo (en creativo se permite libre)
  if (!G.creative && !hasSupport2d(h.tx, h.ty)) { UI.toast('Necesita un bloque al lado'); return; }
  // no colocar un bloque SÓLIDO dentro del propio cuerpo (la antorcha sí, no estorba)
  if (TDEF[mat] && TDEF[mat].solid &&
      h.tx >= Math.floor(player.x - SIDE.HW) && h.tx <= Math.floor(player.x + SIDE.HW - 1e-4) &&
      h.ty >= Math.floor(player.y - SIDE.BODY) && h.ty <= Math.floor(player.y - 1e-4)) return;
  world.setGround(h.tx, h.ty, mat);
  if (!G.creative) Inv.consumeSelected(1);
  Sfx.place();
  if (UI.refreshHotbar) UI.refreshHotbar();
}

// botín de cofre, escalado por profundidad
function rollChestLoot2d(depth) {
  const out = [], R = Math.random;
  out.push(['torch', 2 + (R() * 4 | 0)]);
  if (R() < 0.7) out.push(['wood', 3 + (R() * 5 | 0)]);
  if (R() < 0.6) out.push([depth > 22 ? 'iron_ore' : 'coal', 1 + (R() * 3 | 0)]);
  if (R() < 0.5) out.push(['stone', 4 + (R() * 6 | 0)]);
  if (depth > 100 && R() < 0.65) out.push(['crystal', 1 + (R() * 3 | 0)]);
  if (R() < 0.4) out.push(['bone', 1 + (R() * 2 | 0)]);
  if (R() < 0.22) out.push(['gate', 1]);
  return out;
}
function openChest2d(tx, ty) {
  const depth = ty - world.surfaceY(tx);
  const loot = rollChestLoot2d(depth);
  for (const [id, n] of loot) Inv.add(id, n);
  world.setGround(tx, ty, T.CHEST_OPEN);
  if (Sfx.place) Sfx.place();
  for (let i = 0; i < 12; i++) particles.push({ x: tx + 0.5 + randRange(-0.3, 0.3), y: ty + 0.3, vx: randRange(-1.5, 1.5), vy: randRange(-2.8, -0.5), z: 0, vz: 0, life: 0.6, maxLife: 0.6, color: 'rgba(255,220,120,0.9)', flat2d: true });
  const names = loot.map(l => (l[1] > 1 ? l[1] + '× ' : '') + (ITEMS[l[0]] ? ITEMS[l[0]].name : l[0])).join(', ');
  if (UI.toast) UI.toast('🪙 Cofre: ' + (names || 'vacío'));
  if (UI.refreshHotbar) UI.refreshHotbar();
}
// nombre del estrato según la profundidad alcanzada (lore)
function strataName2d(depth) {
  if (depth < 45) return 'Las Cavernas — el primer estrato bajo la Corteza';
  if (depth < 95) return 'Las Raíces del Mundo te tragan';
  if (depth < 150) return 'La Jungla Sepultada — aquí duermen los lagartos antiguos';
  if (depth < 215) return 'El Abismo. La luz aquí es solo un recuerdo';
  return 'El Corazón de Vethrún late muy cerca…';
}
// invocar la Puerta Abisal: labra una cámara más abajo y desciende un estrato
function descend2d() {
  const px = Math.floor(player.x);
  const targetY = Math.min(world.BOTTOM - 6, Math.floor(player.y) + 55);
  for (let yy = targetY - 4; yy <= targetY; yy++) for (let xx = px - 2; xx <= px + 2; xx++) world.setGround(xx, yy, T.AIR);
  for (let xx = px - 2; xx <= px + 2; xx++) world.setGround(xx, targetY + 1, T.STONE);   // suelo de aterrizaje
  world.setGround(px - 2, targetY, T.TORCH); world.setGround(px + 2, targetY, T.TORCH);  // antorchas
  world.setGround(px, targetY, T.GATE);                                                  // puerta para seguir bajando
  player.x = px + 0.5; player.y = targetY + 1; player.vx2 = 0; player.vy2 = 0; player.grounded = false;
  player._iframe = 1.3; cam.init = false; mobs2d.length = 0;
  G.shake = Math.max(G.shake, 0.4);
  for (let i = 0; i < 26; i++) particles.push({ x: px + 0.5 + randRange(-1.2, 1.2), y: targetY - randRange(0, 3), vx: randRange(-3, 3), vy: randRange(-3, 1), z: 0, vz: 0, life: 0.7, maxLife: 0.7, color: 'rgba(150,90,230,0.85)', flat2d: true });
  if (Sfx.thunder) Sfx.thunder();
  if (UI.toast) UI.toast('⇊ ' + strataName2d(targetY - world.surfaceY(px)));
}

/* ---------- update ---------- */
function update2d(dt) {
  G.elapsed += dt;
  G.shake = Math.max(0, G.shake - dt * 1.6);
  G.time += dt / CFG.DAY_LENGTH; if (G.time >= 1) { G.time -= 1; G.day++; }
  computeLight();
  if (!player.dead) {
    // entrada horizontal
    let ax = 0;
    if (Input.keys['a'] || Input.keys['arrowleft']) ax -= 1;
    if (Input.keys['d'] || Input.keys['arrowright']) ax += 1;
    if (ax !== 0) { player.vx2 = approach(player.vx2 || 0, ax * CFG.PLAYER_SPEED, CFG.G2D_ACCEL * dt); player.dir = ax > 0 ? 'right' : 'left'; }
    else player.vx2 = approach(player.vx2 || 0, 0, CFG.G2D_FRIC * dt);
    // salto (espacio / W / arriba) con coyote + buffer + altura variable
    const jump = !!(Input.keys[' '] || Input.keys['w'] || Input.keys['arrowup']);
    player.coyoteT = player.grounded ? CFG.COYOTE : Math.max(0, (player.coyoteT || 0) - dt);
    if (jump && !player._jHeld) player.jumpBufferT = CFG.JUMP_BUFFER; else player.jumpBufferT = Math.max(0, (player.jumpBufferT || 0) - dt);
    if (player.jumpBufferT > 0 && player.coyoteT > 0) { player.vy2 = -CFG.G2D_JUMP; player.grounded = false; player.coyoteT = 0; player.jumpBufferT = 0; Sfx.jump(); }
    if (!jump && player._jHeld && (player.vy2 || 0) < 0) player.vy2 *= 0.45;   // soltar = salto más corto
    player._jHeld = jump;
    // gravedad + integración con colisión AABB (X y luego Y, en una pasada)
    player.vy2 = Math.min(CFG.G2D_MAXFALL, (player.vy2 || 0) + CFG.G2D_GRAV * dt);
    const wasGrounded = player.grounded, fallV = player.vy2 || 0;
    player.grounded = false;
    move2d(player, (player.vx2 || 0) * dt, (player.vy2 || 0) * dt);
    if (player.grounded && !wasGrounded && fallV >= 0) onLand2d();
    player.moving = Math.abs(player.vx2 || 0) > 0.25 && player.grounded;
    if (player.moving) player.animT += dt;
    // estado de animación del sprite + reloj de animación
    player.anim2d = !player.grounded ? ((player.vy2 || 0) < 0 ? 'jump' : 'fall') : (player.moving ? 'run' : 'idle');
    player.atkAnim = Math.max(0, (player.atkAnim || 0) - dt);
    player._iframe = Math.max(0, (player._iframe || 0) - dt);
    if (player.atkAnim > 0) player.anim2d = 'hit';
    player._aclk = (player._aclk || 0) + dt;
    player.swingT = Math.max(0, player.swingT - dt);
    player.landT = Math.max(0, (player.landT || 0) - dt);
    player.hurtT = Math.max(0, player.hurtT - dt);
    world.center.x = player.x; world.center.y = player.y;
    // criaturas + combate: si atacas a un dino de delante, no picas a la vez
    if (typeof updateMobs2d === 'function') updateMobs2d(dt);
    if (typeof updateNpc2d === 'function') updateNpc2d(dt);
    const attacked = (typeof attackMobs2d === 'function') && attackMobs2d(dt);
    if (attacked) player.breaking = null; else updateBreaking2d(dt);
  }
  updateParticles(dt);
}

/* ---------- cámara ---------- */
function updateCamera2d(dt, W, H) {
  const TS = CFG.TS;
  const look = clamp((Input.mx - W / 2) / (W / 2), -1, 1) * 3;
  const tx = player.x - (W / TS) / 2 + look;
  const ty = (player.y - 0.85) - (H / TS) / 2;
  if (!cam.init) { cam.ox = tx; cam.oy = ty; cam.init = true; return; }
  const f = 1 - Math.pow(0.0015, dt);
  cam.ox += (tx - cam.ox) * f;
  cam.oy += (ty - cam.oy) * f;
}

/* ---------- fondo con profundidad (parallax por bioma + cueva) ---------- */
const BIOME2D = {
  plains:   { sky: [[126, 192, 255], [206, 234, 255]], far: [157, 180, 210], mid: [134, 173, 110], near: [88, 136, 64], decor: 'bush' },
  forest:   { sky: [[131, 192, 238], [205, 233, 230]], far: [147, 172, 196], mid: [92, 146, 84], near: [50, 100, 52], decor: 'pine' },
  desert:   { sky: [[159, 210, 242], [255, 232, 188]], far: [226, 202, 150], mid: [210, 184, 120], near: [180, 142, 78], decor: 'cactus' },
  snow:     { sky: [[190, 217, 243], [238, 246, 255]], far: [203, 216, 231], mid: [176, 190, 205], near: [142, 160, 180], decor: 'snowpine' },
  jungle:   { sky: [[120, 196, 210], [197, 230, 200]], far: [120, 165, 150], mid: [56, 130, 70], near: [30, 86, 46], decor: 'pine' },
  mountain: { sky: [[150, 188, 224], [214, 230, 244]], far: [150, 156, 178], mid: [120, 132, 140], near: [96, 104, 112], decor: 'pine' },
};
function mixNight2d(rgb) {
  const d = clamp(G.darkness, 0, 1) * 0.82, n = [10, 12, 30];
  return 'rgb(' + Math.round(rgb[0] + (n[0] - rgb[0]) * d) + ',' + Math.round(rgb[1] + (n[1] - rgb[1]) * d) + ',' + Math.round(rgb[2] + (n[2] - rgb[2]) * d) + ')';
}
function lerpRGB(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function silhouette2d(g, W, H, baseY, shift, amp, period, color) {
  g.fillStyle = color; g.beginPath(); g.moveTo(-2, H);
  for (let x = -2; x <= W + 2; x += 6) {
    const wx = shift + x;
    const y = baseY - amp - (Math.sin(wx / period) * 0.6 + Math.sin(wx / (period * 0.41) + 1.7) * 0.4) * amp;
    g.lineTo(x, y);
  }
  g.lineTo(W + 2, H); g.closePath(); g.fill();
}
function drawDecor2d(g, W, baseY, ox, decor, col) {
  const TS = CFG.TS, shift = ox * TS * 0.5, step = Math.round(2.6 * TS), b = { decor };
  const s0 = Math.floor(shift / step) * step;
  g.fillStyle = col;
  for (let wx = s0 - step; wx < shift + W + step; wx += step) {
    const k = Math.round(wx / step), x = Math.round(wx - shift + (hash2(k, 3, 9) - 0.5) * step * 0.5);
    const s = 0.8 + hash2(k, 4, 9) * 0.6, gy = baseY - 1;
    if (b.decor === 'cactus') {
      const h = (3 + hash2(k, 5, 9) * 2) * TS * s / 2;
      g.fillRect(x, gy - h, Math.max(2, TS * 0.18), h);
      g.fillRect(x - TS * 0.3, gy - h * 0.7, TS * 0.3, Math.max(2, TS * 0.12));
      g.fillRect(x + TS * 0.18, gy - h * 0.85, TS * 0.3, Math.max(2, TS * 0.12));
    } else { // pino / arbusto / pino nevado: triángulos
      const h = (b.decor === 'bush' ? 1.0 : 2.4) * TS * s, w = (b.decor === 'bush' ? 1.4 : 1.0) * TS * s;
      g.beginPath(); g.moveTo(x, gy - h); g.lineTo(x - w / 2, gy); g.lineTo(x + w / 2, gy); g.closePath(); g.fill();
      if (b.decor === 'snowpine') { g.fillStyle = mixNight2d([235, 242, 252]); g.beginPath(); g.moveTo(x, gy - h); g.lineTo(x - w * 0.18, gy - h * 0.6); g.lineTo(x + w * 0.18, gy - h * 0.6); g.closePath(); g.fill(); g.fillStyle = col; }
    }
  }
}
function caveBackdrop2d(g, W, H, ox, cy0) {
  const TS = CFG.TS, shift = ox * TS * 0.25, step = Math.round(5 * TS);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  const s0 = Math.floor(shift / step) * step;
  for (let wx = s0 - step; wx < shift + W + step; wx += step) {
    const k = Math.round(wx / step), x = Math.round(wx - shift + (hash2(k, 5, 2) - 0.5) * step * 0.6);
    const w = Math.round((2 + hash2(k, 6, 2) * 3) * TS);
    g.fillRect(x, cy0, w, H - cy0);                 // columnas de roca lejana
  }
  g.fillStyle = 'rgba(0,0,0,0.22)';                 // estalactitas tenues del techo
  const step2 = Math.round(1.7 * TS), t0 = Math.floor(shift / step2) * step2;
  for (let wx = t0; wx < shift + W; wx += step2) {
    const k = Math.round(wx / step2); if (hash2(k, 8, 4) > 0.5) continue;
    const x = Math.round(wx - shift), h = Math.round((0.6 + hash2(k, 9, 4) * 1.6) * TS);
    g.beginPath(); g.moveTo(x, cy0); g.lineTo(x + TS * 0.5, cy0 + h); g.lineTo(x + TS, cy0); g.closePath(); g.fill();
  }
}
// decoración del cielo: sol/luna, estrellas de noche y nubes (parallax lento)
function cloud2d(g, x, y, r) {
  const u = Math.max(2, r / 3);
  g.fillRect(x - 2 * u, y, 4 * u, 2 * u);
  g.fillRect(x - u, y - u, 3 * u, u);
  g.fillRect(x + 0.2 * u, y - 1.8 * u, 1.6 * u, u);
}
function skyDecor2d(g, W, H, ox, skyBottom) {
  const day = clamp(1 - G.darkness, 0, 1), t = G.time || 0;
  // estrellas (de noche)
  if (G.darkness > 0.25) {
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
      const sx = (hash2(i, 1, 3) * W) | 0, sy = (hash2(i, 2, 3) * Math.min(H * 0.7, skyBottom)) | 0;
      if (sy >= skyBottom - 2) continue;
      g.globalAlpha = clamp((G.darkness - 0.25) / 0.5, 0, 1) * (0.4 + 0.6 * Math.abs(Math.sin(G.elapsed * 1.5 + i)));
      g.fillRect(sx, sy, 1, 1);
    }
    g.globalAlpha = 1;
  }
  // sol de día / luna de noche, recorriendo el cielo según la hora
  const cxs = ((t + 0.25) % 1) * (W + 80) - 40, cyy = 36 + Math.sin(((t + 0.25) % 1) * Math.PI) * -18;
  const isDay = G.darkness < 0.5;
  if (cyy < skyBottom) {
    if (isDay) {
      g.fillStyle = 'rgba(255,240,180,0.16)'; g.beginPath(); g.arc(cxs, cyy, 30, 0, 7); g.fill();
      g.fillStyle = '#ffe9a6'; g.beginPath(); g.arc(cxs, cyy, 15, 0, 7); g.fill();
    } else {
      g.fillStyle = '#e2e8ff'; g.beginPath(); g.arc(cxs, cyy, 12, 0, 7); g.fill();
      g.fillStyle = 'rgba(20,24,46,0.9)'; g.beginPath(); g.arc(cxs + 5, cyy - 3, 11, 0, 7); g.fill();   // fase lunar
    }
  }
  // nubes (parallax muy lento + deriva), se desvanecen de noche
  if (day > 0.05) {
    g.globalAlpha = 0.75 * day; g.fillStyle = '#ffffff';
    const shift = ox * CFG.TS * 0.06 + G.elapsed * 5, step = 230;
    const s0 = Math.floor(shift / step) * step;
    for (let wx = s0 - step; wx < shift + W + step; wx += step) {
      const k = Math.round(wx / step), x = wx - shift, y = 22 + hash2(k, 4, 8) * Math.min(120, skyBottom * 0.55);
      if (y < skyBottom - 12) cloud2d(g, x, y, 22 + hash2(k, 5, 8) * 20);
    }
    g.globalAlpha = 1;
  }
}
// árbol de superficie (segundo plano, pixel, no colisiona): tronco + copa por bloques
function drawTree2d(g, sx, baseY, h, biome) {
  const TS = CFG.TS;
  const trunkW = Math.max(3, Math.round(TS * 0.22)), trunkH = Math.round(h * TS * 0.5);
  const tx = Math.round(sx - trunkW / 2), ty = Math.round(baseY - trunkH);
  g.fillStyle = '#6b4a2a'; g.fillRect(tx, ty, trunkW, trunkH);
  g.fillStyle = '#523823'; g.fillRect(tx, ty, Math.max(1, (trunkW * 0.38) | 0), trunkH);
  const cy = ty, R = Math.round(h * TS * 0.4);
  const dark = biome === 'forest' ? '#2f6b34' : biome === 'jungle' ? '#27773a' : '#3c8540';
  const lite = biome === 'forest' ? '#43914a' : biome === 'jungle' ? '#3aa052' : '#5aa850';
  const cw = R * 1.8, ch = R * 1.5;
  g.fillStyle = dark;
  g.fillRect(Math.round(sx - cw / 2), Math.round(cy - ch), Math.round(cw), Math.round(ch));
  g.fillRect(Math.round(sx - cw * 0.34), Math.round(cy - ch * 1.35), Math.round(cw * 0.68), Math.round(ch * 0.55));
  g.fillStyle = lite;
  g.fillRect(Math.round(sx - cw * 0.32), Math.round(cy - ch * 0.95), Math.round(cw * 0.36), Math.round(ch * 0.4));
  g.fillRect(Math.round(sx + cw * 0.05), Math.round(cy - ch * 1.15), Math.round(cw * 0.22), Math.round(ch * 0.3));
}
function bg2d(g, W, H, ox, oy) {
  const TS = CFG.TS;
  // muestreo continuo del centro: crossfade de bioma y horizonte entre columnas vecinas (sin saltos)
  const cc = ox + (W / TS) / 2, c0 = Math.floor(cc), fr = cc - c0;
  const ba = BIOME2D[world.biomeAt ? world.biomeAt(c0) : 'plains'] || BIOME2D.plains;
  const bb = BIOME2D[world.biomeAt ? world.biomeAt(c0 + 1) : 'plains'] || BIOME2D.plains;
  const sky0 = lerpRGB(ba.sky[0], bb.sky[0], fr), sky1 = lerpRGB(ba.sky[1], bb.sky[1], fr);
  const far = lerpRGB(ba.far, bb.far, fr), mid = lerpRGB(ba.mid, bb.mid, fr), near = lerpRGB(ba.near, bb.near, fr);
  const decor = fr < 0.5 ? ba.decor : bb.decor;
  const horizonY = ((world.surfaceY(c0) * (1 - fr) + world.surfaceY(c0 + 1) * fr) - oy) * TS;
  // cielo (gradiente bioma mezclado + noche)
  const sg = g.createLinearGradient(0, 0, 0, H);
  sg.addColorStop(0, mixNight2d(sky0)); sg.addColorStop(1, mixNight2d(sky1));
  g.fillStyle = sg; g.fillRect(0, 0, W, H);
  // capas parallax (solo si el horizonte está dentro/encima de la vista)
  if (horizonY > 0) {
    const hb = Math.min(horizonY, H);
    skyDecor2d(g, W, H, ox, hb);          // sol/luna + estrellas + nubes (sobre el cielo)
    silhouette2d(g, W, H, hb, ox * TS * 0.15, 2.4 * TS, 9 * TS, mixNight2d(far));
    silhouette2d(g, W, H, hb, ox * TS * 0.30, 1.5 * TS, 5.5 * TS, mixNight2d(mid));
    silhouette2d(g, W, H, hb, ox * TS * 0.50, 0.9 * TS, 3.6 * TS, mixNight2d(near));
    drawDecor2d(g, W, hb, ox, decor, mixNight2d(near));
  }
  // fondo de cueva por debajo del horizonte (base OPACA para que el cielo no se cuele)
  const cy0 = Math.max(0, horizonY);
  if (cy0 < H) {
    g.fillStyle = mixNight2d([16, 13, 20]); g.fillRect(0, cy0, W, H - cy0);
    const cg = g.createLinearGradient(0, cy0, 0, H);
    cg.addColorStop(0, 'rgba(34,29,40,0.85)'); cg.addColorStop(1, 'rgba(10,9,15,1)');
    g.fillStyle = cg; g.fillRect(0, cy0, W, H - cy0);
    caveBackdrop2d(g, W, H, ox, cy0);
  }
}
// grietas progresivas sobre el bloque que se rompe (estilo Minecraft)
function drawCracks2d(g, bx, by, TS, prog) {
  if (prog <= 0.02) return;
  g.fillStyle = 'rgba(0,0,0,' + (0.08 + prog * 0.28).toFixed(3) + ')';   // se oscurece al romperse
  g.fillRect(bx, by, TS, TS);
  const stages = Math.min(6, 1 + Math.floor(prog * 6));                  // 1..6 grietas
  g.strokeStyle = 'rgba(12,9,7,0.9)'; g.lineWidth = 1;
  const cx = bx + TS / 2, cy = by + TS / 2;
  for (let i = 0; i < stages; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.7;
    const len = TS * (0.28 + prog * 0.24);
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * len * 0.5 + Math.cos(a + 1.4) * 2, cy + Math.sin(a) * len * 0.5 + Math.sin(a + 1.4) * 2);
    g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    g.stroke();
  }
}
// dibuja el personaje 2D (enano minero CC0) con sus frames; pies en sx,sy
function drawPlayer2d(g, sx, sy, dir) {
  const cfg = CHAR_ANIM[player.anim2d] || CHAR_ANIM.idle;
  const sc = CFG.TS / 16 * 2.15;                 // escala (≈2.1 tiles de alto)
  const dw = CHAR_FW * sc, dh = CHAR_FH * sc;
  // sombra de contacto
  g.fillStyle = 'rgba(0,0,0,0.30)';
  g.beginPath(); g.ellipse(sx, sy, CFG.TS * 0.40, CFG.TS * 0.15, 0, 0, Math.PI * 2); g.fill();
  const fr = Math.floor((player._aclk || 0) * cfg.fps) % cfg.keys.length;
  const im = Assets2D.img[cfg.keys[fr]];
  if (!im || !im.naturalWidth) {                 // aún sin cargar: marcador simple
    g.fillStyle = '#cda'; g.fillRect(Math.round(sx - 6), Math.round(sy - 30), 12, 28); return;
  }
  const dx = Math.round(sx - dw / 2), dy = Math.round(sy - dh + 2 * sc);  // pies cerca del borde inferior
  g.imageSmoothingEnabled = false;
  if (dir === 'left') {
    g.save(); g.translate(dx + dw, 0); g.scale(-1, 1);
    g.drawImage(im, 0, 0, CHAR_FW, CHAR_FH, 0, dy, dw, dh);
    g.restore();
  } else {
    g.drawImage(im, 0, 0, CHAR_FW, CHAR_FH, dx, dy, dw, dh);
  }
}
function render2d(g, W, H) {
  g.setTransform(G.renderScale, 0, 0, G.renderScale, 0, 0);
  g.imageSmoothingEnabled = false;
  const TS = CFG.TS;
  let ox = cam.ox, oy = cam.oy;
  if (G.shake > 0) { ox += (Math.random() - 0.5) * G.shake * 0.5; oy += (Math.random() - 0.5) * G.shake * 0.5; }
  // fondo con profundidad: parallax por bioma en superficie + cueva bajo tierra
  bg2d(g, W, H, ox, oy);
  // tiles visibles (y recoge focos de luz: antorchas, cristales, puertas)
  const lights = [];   // [sx, sy, intensidad, warm?]
  const col0 = Math.floor(ox) - 1, col1 = Math.ceil(ox + W / TS) + 1;
  const row0 = Math.floor(oy) - 1, row1 = Math.ceil(oy + H / TS) + 1;
  for (let ty = row0; ty <= row1; ty++) {
    for (let tx = col0; tx <= col1; tx++) {
      const m = world.ground(tx, ty);
      if (m === T.AIR) continue;
      // variante por posición: 4 para piedra/vetas; volteo (0/1) para tierra/arena
      const variant = (m === T.STONE || m === T.COAL_ORE || m === T.IRON_ORE || m === T.CRYSTAL) ? (hash2(tx, ty, 5) * 4 | 0)
        : (m === T.DIRT || m === T.SAND) ? (hash2(tx, ty, 5) & 1) : 0;
      g.drawImage(tile2d(m, variant), Math.round((tx - ox) * TS), Math.round((ty - oy) * TS));
      const ld = TDEF[m] && TDEF[m].light;
      if (ld) lights.push([(tx + 0.5 - ox) * TS, (ty + 0.4 - oy) * TS, ld, m === T.TORCH]);
    }
  }
  // árboles de superficie (segundo plano: detrás del jugador, no colisionan)
  for (let tx = col0; tx <= col1; tx++) {
    const th = world.treeHeightAt(tx);
    if (th > 0) drawTree2d(g, (tx + 0.5 - ox) * TS, (world.surfaceY(tx) - oy) * TS, th, world.biomeAt(tx));
  }
  // criaturas (dinosaurios) y supervivientes detrás del jugador
  if (typeof drawMobs2d === 'function') drawMobs2d(g, ox, oy);
  if (typeof drawNpcs2d === 'function') drawNpcs2d(g, ox, oy);
  // partículas (polvo)
  for (const p of particles) {
    if (!p.flat2d) continue;
    g.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    g.fillStyle = p.color;
    g.fillRect(Math.round((p.x - ox) * TS), Math.round((p.y - oy) * TS), 2, 2);
  }
  g.globalAlpha = 1;
  // personaje (sprite CC0 animado, siempre de perfil)
  const psx = (player.x - ox) * TS, psy = (player.y - oy) * TS;
  if (!player.dead) {
    const dir = (player.dir === 'left' || player.dir === 'right') ? player.dir : 'right';
    drawPlayer2d(g, psx, psy, dir);
  }
  // cursor de selección de tile (verde si es acción válida sobre esa celda)
  if (!UI.panelOpen && !UI.chatOpen && !player.dead) {
    const h = hoveredTile2d();
    const isAir = world.ground(h.tx, h.ty) === T.AIR;
    const sel = Inv.selected(), placeMat = sel ? PLACE2D[sel.id] : null;
    const ok = isAir
      ? (placeMat != null && canPlace2d(h) && hasSupport2d(h.tx, h.ty))   // colocar
      : canMine2d(h);                                                     // picar
    g.strokeStyle = ok ? 'rgba(120,255,140,0.7)' : 'rgba(255,90,90,0.45)';
    g.lineWidth = 1;
    g.strokeRect(Math.round((h.tx - ox) * TS) + 0.5, Math.round((h.ty - oy) * TS) + 0.5, TS - 1, TS - 1);
    // grietas progresivas + barra de progreso sobre el bloque/árbol que se pica
    if (player.breaking) {
      const b = player.breaking, def = TDEF[b.id];
      const hp = def ? def.hp : (b.hp || 1);
      const bx = Math.round((b.tx - ox) * TS), by = Math.round((b.ty - oy) * TS);
      const prog = clamp(b.dmg / hp, 0, 1);
      if (def) drawCracks2d(g, bx, by, TS, prog);   // grietas solo en bloques (no en árboles)
      g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(bx + 1, by - 6, TS - 2, 4);
      g.fillStyle = '#ffd34d'; g.fillRect(bx + 2, by - 5, Math.round((TS - 4) * prog), 2);
    }
  }
  // oscuridad subterránea con halo de visión del jugador (reusa la capa de luz)
  const surf = world.surfaceY(Math.floor(player.x));
  const caveDark = clamp((player.y - surf - 2) / 16, 0, 1) * 0.92;
  const dark = Math.max(G.darkness * 0.6, caveDark);
  if (dark > 0.04) {
    const lg = lightLayer(Math.max(2, Math.ceil(W)), Math.max(2, Math.ceil(H)));
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, W, H);
    lg.fillStyle = 'rgba(6,8,18,' + (0.92 * dark).toFixed(3) + ')';
    lg.fillRect(0, 0, W, H);
    lg.globalCompositeOperation = 'destination-out';
    const lr = 6 * TS, lcx = psx, lcy = psy - 0.85 * TS;
    lg.drawImage(veilGlow(), lcx - lr, lcy - lr, lr * 2, lr * 2);
    // halos de los focos de luz (antorchas/cristales/puertas) con parpadeo suave
    for (const t of lights) {
      const flick = (0.9 + 0.1 * Math.sin(G.elapsed * 9 + t[0] * 0.3)) * t[2] * TS;
      lg.drawImage(veilGlow(), t[0] - flick, t[1] - flick, flick * 2, flick * 2);
    }
    lg.globalCompositeOperation = 'source-over';
    g.drawImage(_lightCv, 0, 0);
    // resplandor aditivo de color sobre cada foco (cálido antorchas, violáceo cristal/puerta)
    g.globalCompositeOperation = 'lighter';
    for (const t of lights) {
      const r = (t[2] * 0.42) * TS * (0.9 + 0.1 * Math.sin(G.elapsed * 11 + t[1] * 0.2));
      const rg = g.createRadialGradient(t[0], t[1], 0, t[0], t[1], r);
      if (t[3]) { rg.addColorStop(0, 'rgba(255,170,70,0.5)'); rg.addColorStop(1, 'rgba(255,150,60,0)'); }
      else { rg.addColorStop(0, 'rgba(150,110,255,0.45)'); rg.addColorStop(1, 'rgba(120,90,230,0)'); }
      g.fillStyle = rg; g.fillRect(t[0] - r, t[1] - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }
}
