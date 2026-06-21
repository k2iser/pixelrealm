'use strict';
/* ============ Modo 2D lateral (tipo Terraria) ============
   Física de plataformas (gravedad + colisión AABB por tiles), cámara lateral,
   render de tiles cuadrados, picar/colocar, y el héroe con el rig de PERFIL.
   Reutiliza inventario, items, audio, el rig (drawHero) y la capa de luz. */

const SIDE = { HW: 0.34, BODY: 1.72 };   // medio ancho y alto de la caja del jugador (pies en player.y)

/* ---------- arte: tiles (atlas externo CC0 + fallback procedural) ---------- */
const _tile2dCache = {};
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
  // piedra y vetas: rocosa procedural con variantes (evita el bandeado del atlas)
  if (mat === T.STONE || mat === T.COAL_ORE || mat === T.IRON_ORE) {
    rockyStone(g, TS, variant);
    if (mat === T.COAL_ORE) oreSpecks(g, '#1e1e26', '#3a3a46', 41 + variant);
    else if (mat === T.IRON_ORE) oreSpecks(g, '#c08a5a', '#e6c79a', 53 + variant);
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
    player._aclk = (player._aclk || 0) + dt;
    player.swingT = Math.max(0, player.swingT - dt);
    player.landT = Math.max(0, (player.landT || 0) - dt);
    player.hurtT = Math.max(0, player.hurtT - dt);
    world.center.x = player.x; world.center.y = player.y;
    updateBreaking2d(dt);
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
  plains: { sky: [[126, 192, 255], [206, 234, 255]], far: [157, 180, 210], mid: [134, 173, 110], near: [88, 136, 64], decor: 'bush' },
  forest: { sky: [[131, 192, 238], [205, 233, 230]], far: [147, 172, 196], mid: [92, 146, 84], near: [50, 100, 52], decor: 'pine' },
  desert: { sky: [[159, 210, 242], [255, 232, 188]], far: [226, 202, 150], mid: [210, 184, 120], near: [180, 142, 78], decor: 'cactus' },
  snow:   { sky: [[190, 217, 243], [238, 246, 255]], far: [203, 216, 231], mid: [176, 190, 205], near: [142, 160, 180], decor: 'snowpine' },
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
  // tiles visibles (y recoge antorchas para iluminar después)
  const torches = [];
  const col0 = Math.floor(ox) - 1, col1 = Math.ceil(ox + W / TS) + 1;
  const row0 = Math.floor(oy) - 1, row1 = Math.ceil(oy + H / TS) + 1;
  for (let ty = row0; ty <= row1; ty++) {
    for (let tx = col0; tx <= col1; tx++) {
      const m = world.ground(tx, ty);
      if (m === T.AIR) continue;
      // variante por posición: 4 para piedra/vetas; volteo (0/1) para tierra/arena
      const variant = (m === T.STONE || m === T.COAL_ORE || m === T.IRON_ORE) ? (hash2(tx, ty, 5) * 4 | 0)
        : (m === T.DIRT || m === T.SAND) ? (hash2(tx, ty, 5) & 1) : 0;
      g.drawImage(tile2d(m, variant), Math.round((tx - ox) * TS), Math.round((ty - oy) * TS));
      if (m === T.TORCH) torches.push([(tx + 0.5 - ox) * TS, (ty + 0.4 - oy) * TS]);
    }
  }
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
    // grietas progresivas + barra de progreso sobre el bloque que se pica
    if (player.breaking) {
      const b = player.breaking, def = TDEF[b.id];
      const bx = Math.round((b.tx - ox) * TS), by = Math.round((b.ty - oy) * TS);
      const prog = clamp(b.dmg / def.hp, 0, 1);
      drawCracks2d(g, bx, by, TS, prog);
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
    // halos de las antorchas colocadas (con parpadeo suave)
    for (const t of torches) {
      const flick = (0.9 + 0.1 * Math.sin(G.elapsed * 9 + t[0] * 0.3)) * (TDEF[T.TORCH].light || 6) * TS;
      lg.drawImage(veilGlow(), t[0] - flick, t[1] - flick, flick * 2, flick * 2);
    }
    lg.globalCompositeOperation = 'source-over';
    g.drawImage(_lightCv, 0, 0);
    // resplandor cálido aditivo sobre las antorchas (sobre la escena ya revelada)
    g.globalCompositeOperation = 'lighter';
    for (const t of torches) {
      const r = 2.6 * TS * (0.92 + 0.08 * Math.sin(G.elapsed * 11 + t[1] * 0.2));
      const rg = g.createRadialGradient(t[0], t[1], 0, t[0], t[1], r);
      rg.addColorStop(0, 'rgba(255,170,70,0.5)'); rg.addColorStop(1, 'rgba(255,150,60,0)');
      g.fillStyle = rg; g.fillRect(t[0] - r, t[1] - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }
}
