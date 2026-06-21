'use strict';
/* ============ Modo 2D lateral (tipo Terraria) ============
   Física de plataformas (gravedad + colisión AABB por tiles), cámara lateral,
   render de tiles cuadrados, picar/colocar, y el héroe con el rig de PERFIL.
   Reutiliza inventario, items, audio, el rig (drawHero) y la capa de luz. */

const SIDE = { HW: 0.34, BODY: 1.72 };   // medio ancho y alto de la caja del jugador (pies en player.y)

/* ---------- arte: tiles cuadrados procedurales ---------- */
const _tile2dCache = {};
function tile2d(mat) {
  if (_tile2dCache[mat]) return _tile2dCache[mat];
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
    _tile2dCache[mat] = c;
    return c;
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
  _tile2dCache[mat] = c;
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
function inReach2d(h) {
  const cx = player.x, cy = player.y - 0.85;   // centro del cuerpo
  return Math.max(Math.abs(h.wx - cx), Math.abs(h.wy - cy)) <= effReach() + 0.4;
}
function updateBreaking2d(dt) {
  if (!Input.mdown || UI.panelOpen || UI.chatOpen || UI.dialogOpen) { player.breaking = null; return; }
  const h = hoveredTile2d();
  if (!inReach2d(h)) { player.breaking = null; return; }
  const mat = world.ground(h.tx, h.ty), def = TDEF[mat];
  // se pueden picar materiales con dureza finita (incluida la antorcha, que no es sólida)
  if (!def || mat === T.AIR || def.hp == null || def.hp === Infinity) { player.breaking = null; return; }
  if (!player.breaking || player.breaking.tx !== h.tx || player.breaking.ty !== h.ty) player.breaking = { tx: h.tx, ty: h.ty, id: mat, dmg: 0 };
  const tool = (Inv.selected() && ITEMS[Inv.selected().id]) ? ITEMS[Inv.selected().id].tool : null;
  player.breaking.dmg += dt * (G.creative ? 99 : (def.tool && tool === def.tool ? 2.4 : 1.3));
  player.swingT = 0.18;
  player.dir = h.wx >= player.x ? 'right' : 'left';
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
  if (!inReach2d(h)) return;
  if (world.ground(h.tx, h.ty) !== T.AIR) return;
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

/* ---------- render ---------- */
function side2dSky(top) {
  // color del cielo por hora (mezcla día -> noche con la oscuridad global)
  const dk = clamp(G.darkness, 0, 1);
  const lerp = (a, b, t) => Math.round(a + (b - a) * t);
  const dayT = [126, 192, 255], dayB = [191, 227, 255], nightT = [8, 12, 30], nightB = [18, 24, 52];
  const a = top ? dayT : dayB, b = top ? nightT : nightB;
  return 'rgb(' + lerp(a[0], b[0], dk) + ',' + lerp(a[1], b[1], dk) + ',' + lerp(a[2], b[2], dk) + ')';
}
function render2d(g, W, H) {
  g.setTransform(G.renderScale, 0, 0, G.renderScale, 0, 0);
  g.imageSmoothingEnabled = false;
  const TS = CFG.TS;
  let ox = cam.ox, oy = cam.oy;
  if (G.shake > 0) { ox += (Math.random() - 0.5) * G.shake * 0.5; oy += (Math.random() - 0.5) * G.shake * 0.5; }
  // cielo
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, side2dSky(true)); grad.addColorStop(1, side2dSky(false));
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // tiles visibles (y recoge antorchas para iluminar después)
  const torches = [];
  const col0 = Math.floor(ox) - 1, col1 = Math.ceil(ox + W / TS) + 1;
  const row0 = Math.floor(oy) - 1, row1 = Math.ceil(oy + H / TS) + 1;
  for (let ty = row0; ty <= row1; ty++) {
    for (let tx = col0; tx <= col1; tx++) {
      const m = world.ground(tx, ty);
      if (m === T.AIR) continue;
      g.drawImage(tile2d(m), Math.round((tx - ox) * TS), Math.round((ty - oy) * TS));
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
  // héroe (rig de perfil)
  const psx = (player.x - ox) * TS, psy = (player.y - oy) * TS;
  const sel = Inv.selected();
  const anim = {
    grounded: player.grounded, moving: player.moving, animT: player.animT,
    vx: player.vx2 || 0, vy: 0, swingT: player.swingT, t: G.elapsed,
    hurtT: player.hurtT, landT: player.landT || 0, z: 0, vz: -(player.vy2 || 0) * 0.4, rigged: true,
  };
  if (!player.dead) {
    const dir = (player.dir === 'left' || player.dir === 'right') ? player.dir : 'right';   // siempre de perfil en 2D
    drawHero(g, Assets.player, dir, player.grounded ? (player.moving ? 1 : 0) : 6, psx, psy,
      player.swingT, sel && ITEMS[sel.id] && ITEMS[sel.id].tool ? sel.id : null, false, anim);
  }
  // cursor de selección de tile
  if (!UI.panelOpen && !UI.chatOpen && !player.dead) {
    const h = hoveredTile2d(), ok = inReach2d(h);
    g.strokeStyle = ok ? 'rgba(255,255,255,0.6)' : 'rgba(255,90,90,0.5)';
    g.lineWidth = 1;
    g.strokeRect(Math.round((h.tx - ox) * TS) + 0.5, Math.round((h.ty - oy) * TS) + 0.5, TS - 1, TS - 1);
    // barra de progreso al picar
    if (player.breaking) {
      const b = player.breaking, def = TDEF[b.id];
      const bx = (b.tx - ox) * TS, by = (b.ty - oy) * TS;
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(Math.round(bx + 1), Math.round(by - 5), TS - 2, 3);
      g.fillStyle = '#ffd34d'; g.fillRect(Math.round(bx + 1), Math.round(by - 5), Math.round((TS - 2) * clamp(b.dmg / def.hp, 0, 1)), 3);
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
