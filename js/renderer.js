'use strict';
/* ============ Renderizado isométrico con orden de profundidad ============
   Proyección 2:1 clásica: pantalla_x = (wx - wy) * 16, pantalla_y = (wx + wy) * 8.
   Se dibuja a baja resolución y CSS lo escala con image-rendering: pixelated. */

const cam = { ox: 0, oy: 0, init: false };

function w2sx(wx, wy) { return (wx - wy) * CFG.HW; }
function w2sy(wx, wy) { return (wx + wy) * CFG.HH; }
function s2w(sx, sy) {
  return {
    x: sx / (2 * CFG.HW) + sy / (2 * CFG.HH),
    y: sy / (2 * CFG.HH) - sx / (2 * CFG.HW),
  };
}

function hoveredTile() {
  const w = s2w(Input.mx - cam.ox, Input.my - cam.oy);
  return { tx: Math.floor(w.x), ty: Math.floor(w.y), wx: w.x, wy: w.y };
}

function updateCamera(dt, W, H) {
  // la cámara mira ligeramente hacia el cursor (estilo Stardew)
  const lookX = clamp((Input.mx - W / 2) * 0.1, -36, 36);
  const lookY = clamp((Input.my - H / 2) * 0.1, -24, 24);
  const tx = W / 2 - w2sx(player.x, player.y) - lookX;
  const ty = H / 2 - w2sy(player.x, player.y) - lookY;
  if (!cam.init) { cam.ox = tx; cam.oy = ty; cam.init = true; return; }
  const f = 1 - Math.pow(0.001, dt);
  cam.ox += (tx - cam.ox) * f;
  cam.oy += (ty - cam.oy) * f;
}

// Canvas auxiliar para la capa de oscuridad nocturna
let _lightCv = null, _lightG = null;
function lightLayer(W, H) {
  if (!_lightCv || _lightCv.width !== W || _lightCv.height !== H) {
    _lightCv = document.createElement('canvas');
    _lightCv.width = W; _lightCv.height = H;
    _lightG = _lightCv.getContext('2d');
  }
  return _lightG;
}

// Sprite de un objeto del mundo (resuelve variantes y frames de animación)
function objSprite(id, tx, ty) {
  let img = Assets.obj[id];
  if (!img) return null;
  if (Array.isArray(img)) {
    if (id === O.TORCH || id === O.FIRE || id === O.BRAZIER || id === O.ALTAR || id === O.FURNACE) {
      img = img[(Math.floor(G.elapsed * 7) + tx + ty) & 1]; // & 1: seguro con coordenadas negativas
    } else {
      img = img[Math.floor(hash2(tx, ty, 99) * img.length)];
    }
  }
  return img;
}

function render(g, W, H) {
  g.fillStyle = '#0b0e1a';
  g.fillRect(0, 0, W, H);
  let ox = cam.ox, oy = cam.oy;
  if (G.shake > 0) {
    ox += (Math.random() - 0.5) * G.shake * 14;
    oy += (Math.random() - 0.5) * G.shake * 9;
  }

  // --- rango de casillas visibles ---
  const c0 = s2w(-ox, -oy), c1 = s2w(W - ox, -oy), c2 = s2w(-ox, H - oy), c3 = s2w(W - ox, H - oy);
  const txmin = Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x)) - 1;
  const txmax = Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x)) + 1;
  const tymin = Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y)) - 1;
  const tymax = Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y)) + 2;

  const drawables = [];
  const labels = [];
  const waterFrame = Math.floor(G.elapsed * 1.6);

  // --- pasada de suelo + recogida de objetos ---
  for (let ty = tymin; ty <= tymax; ty++) {
    for (let tx = txmin; tx <= txmax; tx++) {
      const sx = w2sx(tx, ty) + ox, sy = w2sy(tx, ty) + oy;
      // margen inferior amplio: los sprites altos (torre 60px) se anclan abajo
      // y se extienden hacia ARRIBA en pantalla
      if (sx < -CFG.TW || sx > W + CFG.TW || sy < -CFG.TH * 2 || sy > H + CFG.TH * 3) continue;
      const gr = world.ground(tx, ty);
      const frames = Assets.tiles[gr];
      let img;
      if (gr === T.WATER || gr === T.DEEP) {
        img = frames[(waterFrame + ((tx + ty * 3) & 1)) % frames.length];
      } else {
        img = frames[Math.floor(hash2(tx, ty, 71) * frames.length)];
      }
      g.drawImage(img, Math.round(sx - CFG.HW), Math.round(sy));

      // transiciones suaves entre biomas: el material dominante derrama
      // su flequillo sobre el borde del rombo vecino
      if (gr !== T.FLOOR) {
        const pr = FRINGE_PRIORITY[gr] || 0;
        for (let e = 0; e < 4; e++) {
          const ng = e === 0 ? world.ground(tx - 1, ty)
                   : e === 1 ? world.ground(tx, ty - 1)
                   : e === 2 ? world.ground(tx + 1, ty)
                   : world.ground(tx, ty + 1);
          if (ng !== gr && (FRINGE_PRIORITY[ng] || 0) > pr && Assets.fringe[ng]) {
            g.drawImage(Assets.fringe[ng][e], Math.round(sx - CFG.HW), Math.round(sy));
          }
        }
      }

      const ob = world.object(tx, ty);
      if (ob !== O.NONE && ob !== O.PART) {
        const size = (OBJ[ob] && OBJ[ob].size) || 1;
        // profundidad anclada al centro real del sprite: evita que el jugador
        // se dibuje delante de objetos que tiene detrás
        drawables.push({ d: tx + ty + size, type: 'obj', id: ob, tx, ty, size });
      }
    }
  }

  // --- luces: pasada aparte con margen amplio para que no hagan "pop" en los bordes ---
  const lights = [];
  if (G.darkness > 0.02) {
    const LP = 9;
    for (let ty = tymin - LP; ty <= tymax + LP; ty++) {
      for (let tx = txmin - LP; tx <= txmax + LP; tx++) {
        const ob = world.object(tx, ty);
        if (ob === O.NONE || ob === O.PART) continue;
        const def = OBJ[ob];
        if (!def || !def.light) continue;
        const size = def.size || 1;
        const lx = w2sx(tx + size / 2, ty + size / 2) + ox;
        const ly = w2sy(tx + size / 2, ty + size / 2) + oy;
        const r = def.light * CFG.HW;
        if (lx < -r * 1.2 || lx > W + r * 1.2 || ly < -r * 1.2 || ly > H + r * 1.2) continue;
        lights.push({ x: lx, y: ly, r, warm: true, color: def.lightColor || null });
      }
    }
  }

  // --- entidades ---
  for (const m of mobs) {
    const sx = w2sx(m.x, m.y) + ox, sy = w2sy(m.x, m.y) + oy;
    if (sx < -80 || sx > W + 80 || sy < -100 || sy > H + 80) continue;
    drawables.push({ d: m.x + m.y, type: 'mob', m });
  }
  for (const dr of drops) {
    const sx = w2sx(dr.x, dr.y) + ox, sy = w2sy(dr.x, dr.y) + oy;
    if (sx < -60 || sx > W + 60 || sy < -80 || sy > H + 60) continue;
    drawables.push({ d: dr.x + dr.y, type: 'drop', drop: dr });
  }
  for (const p of particles) drawables.push({ d: p.x + p.y, type: 'part', p });
  for (const pr of projectiles) drawables.push({ d: pr.x + pr.y, type: 'proj', pr });
  // comerciantes (NPCs)
  for (const n of npcs) {
    const sx = w2sx(n.x, n.y) + ox, sy = w2sy(n.x, n.y) + oy;
    if (sx < -80 || sx > W + 80 || sy < -120 || sy > H + 80) continue;
    drawables.push({ d: n.x + n.y, type: 'npc', n });
    labels.push({ x: Math.round(sx), y: Math.round(sy) - 52, text: n.name + ' · ' + NPC_ROLES[n.role].title, color: '#ffe9a8' });
  }
  if (!player.dead) drawables.push({ d: player.x + player.y, type: 'player' });
  if (typeof Net !== 'undefined' && Net.online) {
    for (const [, rp] of Net.players) {
      drawables.push({ d: rp.px + rp.py, type: 'rplayer', rp });
      const lx = Math.round(w2sx(rp.px, rp.py) + ox), ly = Math.round(w2sy(rp.px, rp.py) + oy);
      labels.push({ x: lx, y: ly - 48, text: rp.name, color: '#fff' });
      // bocadillo solo si quien habla está cerca de ti; lo lejano queda en el chat
      if (rp.bubbleT > 0 && dist2(rp.px, rp.py, player.x, player.y) < 14 * 14) {
        labels.push({ x: lx, y: ly - 58, text: rp.bubble, color: '#ffe9a8', bubble: true });
      }
    }
  }
  if (G.boss) drawables.push({ d: G.boss.x + G.boss.y, type: 'boss' });

  drawables.sort((a, b) => a.d - b.d);

  const hov = hoveredTile();
  const reach = effReach();
  const inReach = dist2(player.x, player.y, hov.wx, hov.wy) <= reach * reach;

  if (G.running && !player.dead && !UI.panelOpen && !UI.chatOpen && inReach) {
    drawDiamond(g, hov.tx, hov.ty, ox, oy, Input.mdown ? 'rgba(255,220,90,0.85)' : 'rgba(255,255,255,0.55)');
  }

  for (const d of drawables) drawDrawable(g, d, ox, oy);

  // marcador de destino del clic (anillo que se expande, estilo MOBA)
  if (G.running && !player.dead && player.path && player.path.length && !player.drag) {
    const wp = player.path[player.path.length - 1];
    const mx = w2sx(wp.x, wp.y) + ox, my = w2sy(wp.x, wp.y) + oy + CFG.HH;
    const t = (G.elapsed * 2.4) % 1;
    g.strokeStyle = 'rgba(120,200,255,' + (0.75 * (1 - t)).toFixed(2) + ')';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(mx, my, 7 + t * 13, 3.5 + t * 6.5, 0, 0, Math.PI * 2);
    g.stroke();
  }

  ghostPreview(g, hov, inReach, ox, oy);

  // --- barra de progreso al romper ---
  if (player.breaking) {
    const b = player.breaking;
    const def = OBJ[b.id];
    if (def) {
      const size = def.size || 1;
      const cx = w2sx(b.tx + size / 2, b.ty + size / 2) + ox;
      const cy = w2sy(b.tx + size / 2, b.ty + size / 2) + oy;
      const prog = clamp(b.dmg / def.hp, 0, 1);
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(Math.round(cx - 22), Math.round(cy - 52), 44, 10);
      g.fillStyle = '#ffd34d';
      g.fillRect(Math.round(cx - 20), Math.round(cy - 50), Math.round(40 * prog), 6);
    }
  }

  // --- luz del jugador ---
  if (G.darkness > 0.02 && !player.dead) {
    const sel = Inv.selected();
    const holdingTorch = sel && sel.id === 'torch';
    lights.push({
      x: w2sx(player.x, player.y) + ox,
      y: w2sy(player.x, player.y) + oy,
      r: (holdingTorch ? 4.5 : 1.8) * CFG.HW,
      warm: holdingTorch, color: null,
    });
  }

  // --- atardecer cálido ---
  if (G.warm > 0.02) {
    g.fillStyle = 'rgba(255,120,40,' + (0.13 * G.warm).toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
  }

  // --- oscuridad nocturna con agujeros de luz ---
  if (G.darkness > 0.02) {
    const lg = lightLayer(W, H);
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, W, H);
    lg.fillStyle = 'rgba(8,10,34,' + (0.87 * G.darkness).toFixed(3) + ')';
    lg.fillRect(0, 0, W, H);
    lg.globalCompositeOperation = 'destination-out';
    const flick = 1 + Math.sin(G.elapsed * 9) * 0.05 + Math.sin(G.elapsed * 23) * 0.03;
    for (const l of lights) {
      const r = l.r * (l.warm ? flick : 1);
      const grad = lg.createRadialGradient(l.x, l.y, 2, l.x, l.y, r);
      grad.addColorStop(0, 'rgba(0,0,0,0.95)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.65)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      lg.fillStyle = grad;
      lg.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    g.drawImage(_lightCv, 0, 0);
    // halo cálido (naranja) o místico (violeta del altar)
    g.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.warm && !l.color) continue;
      const r = l.r * 0.8 * flick;
      const rgb = l.color === '#a070ff' ? '160,112,255' : '255,140,40';
      const grad = g.createRadialGradient(l.x, l.y, 1, l.x, l.y, r);
      grad.addColorStop(0, 'rgba(' + rgb + ',' + (0.13 * G.darkness).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = grad;
      g.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }

  // --- textos flotantes y nombres (encima de la iluminación) ---
  g.textAlign = 'center';
  g.font = '10px "Press Start 2P", monospace';
  for (const f of floaters) {
    const fx = Math.round(w2sx(f.x, f.y) + ox);
    const fy = Math.round(w2sy(f.x, f.y) + oy - 36);
    g.globalAlpha = clamp(f.life, 0, 1);
    g.fillStyle = '#000';
    g.fillText(f.text, fx + 1, fy + 1);
    g.fillStyle = f.color;
    g.fillText(f.text, fx, fy);
    g.globalAlpha = 1;
  }
  for (const l of labels) {
    if (l.bubble) {
      const tw = g.measureText(l.text).width;
      g.fillStyle = 'rgba(16,12,8,0.85)';
      g.fillRect(l.x - tw / 2 - 6, l.y - 11, tw + 12, 16);
      g.fillStyle = l.color;
      g.fillText(l.text, l.x, l.y + 1);
    } else {
      g.fillStyle = '#000';
      g.fillText(l.text, l.x + 1, l.y + 1);
      g.fillStyle = l.color;
      g.fillText(l.text, l.x, l.y);
    }
  }

  // --- brújula a la aldea más cercana (cuando está fuera de pantalla) ---
  if (G.running && !player.dead && G.nearestVillage && G.nearestVillage.d > 10) {
    drawVillageBeacon(g, W, H, ox, oy);
  }

  // --- flash de daño ---
  if (player.hurtT > 0) {
    g.fillStyle = 'rgba(216,52,52,' + (0.32 * player.hurtT / 0.35).toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
  }
}

function drawVillageBeacon(g, W, H, ox, oy) {
  const v = G.nearestVillage;
  const vx = w2sx(v.x, v.y) + ox, vy = w2sy(v.x, v.y) + oy;
  const m = 26;
  // si la aldea ya está dentro de la pantalla, no hace falta flecha
  if (vx > m && vx < W - m && vy > m && vy < H - m) return;
  const cx = W / 2, cy = H / 2;
  const ang = Math.atan2(vy - cy, vx - cx);
  // punto en el borde (rectángulo con margen) en la dirección de la aldea
  const hw = W / 2 - m, hh = H / 2 - m;
  const t = Math.min(Math.abs(hw / Math.cos(ang)) || 1e9, Math.abs(hh / Math.sin(ang)) || 1e9);
  const bx = cx + Math.cos(ang) * t, by = cy + Math.sin(ang) * t;
  g.save();
  g.translate(bx, by);
  g.rotate(ang);
  g.fillStyle = '#e8c14d';
  g.strokeStyle = '#4d2b32';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(9, 0); g.lineTo(-6, -6); g.lineTo(-2, 0); g.lineTo(-6, 6);
  g.closePath();
  g.fill(); g.stroke();
  g.restore();
  // distancia en metros (casillas)
  g.font = '8px "Press Start 2P", monospace';
  g.textAlign = 'center';
  const label = '⚑ ' + Math.round(v.d) + 'm';
  let lx = clamp(bx, 30, W - 30), ly = clamp(by, 18, H - 8);
  g.fillStyle = '#000'; g.fillText(label, lx + 1, ly + 11);
  g.fillStyle = '#ffe9a8'; g.fillText(label, lx, ly + 10);
}

function drawDiamond(g, tx, ty, ox, oy, color) {
  const sx = w2sx(tx, ty) + ox, sy = w2sy(tx, ty) + oy;
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(sx, sy + 0.5);
  g.lineTo(sx + CFG.HW - 0.5, sy + CFG.HH);
  g.lineTo(sx, sy + CFG.TH - 0.5);
  g.lineTo(sx - CFG.HW + 0.5, sy + CFG.HH);
  g.closePath();
  g.stroke();
}

function shadow(g, sx, sy, w) {
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fillRect(Math.round(sx - w / 2), Math.round(sy - 2), w, 6);
  g.fillRect(Math.round(sx - w / 2) + 4, Math.round(sy - 4), w - 8, 10);
}

// Dibuja un héroe (propio o remoto) con su herramienta al golpear.
// En el agua se dibuja medio sumergido, con ondas en la superficie.
function drawHero(g, set, dir, frameI, sx, sy, swingT, toolId, inWater) {
  // a prueba de estados remotos corruptos: dir/frame inválidos caen al defecto
  const frames = set[dir] || set.down;
  const img = frames[frameI] || frames[0];
  if (inWater) {
    const cut = Math.floor(img.height * 0.35);
    const bobw = Math.sin(G.elapsed * 3 + sx * 0.05) * 1.5;
    g.drawImage(img, 0, 0, img.width, img.height - cut,
      Math.round(sx - img.width / 2), Math.round(sy + 2 - (img.height - cut) + bobw),
      img.width, img.height - cut);
    g.fillStyle = 'rgba(214,234,255,0.45)';
    g.fillRect(Math.round(sx - 12), Math.round(sy - 1), 24, 3);
    g.fillRect(Math.round(sx - 8 + Math.sin(G.elapsed * 4) * 4), Math.round(sy + 3), 16, 2);
    return;
  }
  shadow(g, sx, sy, 20);
  g.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height + 2));
  if (swingT > 0 && toolId && Assets.items[toolId]) {
    const t = Assets.items[toolId];
    const prog = 1 - swingT / 0.18;
    const offs = { down: [14, -16], up: [-14, -28], left: [-18, -22], right: [18, -22] };
    const o = offs[dir];
    const flip = dir === 'left' ? -1 : 1;
    g.save();
    g.translate(Math.round(sx + o[0]), Math.round(sy + o[1]));
    g.rotate(flip * (prog * 1.5 - 0.75));
    g.drawImage(t, -t.width, -t.height, t.width * 2, t.height * 2);
    g.restore();
  }
}

function drawDrawable(g, d, ox, oy) {
  if (d.type === 'obj') {
    const size = d.size;
    const cx = w2sx(d.tx + size / 2, d.ty + size / 2) + ox;
    const cy = w2sy(d.tx + size / 2, d.ty + size / 2) + oy;
    const img = objSprite(d.id, d.tx, d.ty);
    if (!img) return;
    const def = OBJ[d.id];
    if (def.solid && d.id !== O.WALLW && d.id !== O.WALLS) {
      shadow(g, cx, cy + (size === 2 ? 12 : 8), Math.min(img.width - 12, 60));
    }
    let lift;
    if (d.id === O.WALLW || d.id === O.WALLS) lift = 16;
    else if (size === 2) lift = 28;
    else if (def.size === 1) lift = 14;  // torre, brasero
    else lift = 12;                      // vegetación
    // tiembla mientras lo estás talando/picando
    let shakeX = 0;
    if (player.breaking && player.breaking.tx === d.tx && player.breaking.ty === d.ty) {
      shakeX = Math.round(Math.sin(G.elapsed * 42) * 2);
    }
    g.drawImage(img, Math.round(cx - img.width / 2) + shakeX, Math.round(cy + lift - img.height));

    // stock listo para recoger: icono flotando encima
    if (def.prod) {
      const b = world.buildings.get(d.tx + ',' + d.ty);
      if (b && b.stock >= 1) {
        const icon = Assets.items[def.prod.item];
        const bob = Math.sin(G.elapsed * 3 + d.tx) * 4;
        const iy = Math.round(cy + lift - img.height - 30 + bob);
        g.drawImage(icon, Math.round(cx - icon.width), iy, icon.width * 2, icon.height * 2);
        g.font = '10px "Press Start 2P", monospace';
        g.textAlign = 'center';
        g.fillStyle = '#000';
        g.fillText('×' + Math.floor(b.stock), cx + 1, iy + 38);
        g.fillStyle = '#fff';
        g.fillText('×' + Math.floor(b.stock), cx, iy + 37);
      }
    }
    return;
  }

  if (d.type === 'player') {
    if (player.invuln > 0 && Math.floor(G.elapsed * 14) % 2 === 0) return;
    const sx = w2sx(player.x, player.y) + ox;
    const sy = w2sy(player.x, player.y) + oy;
    const sel = Inv.selected();
    const inWater = world.ground(Math.floor(player.x), Math.floor(player.y)) === T.WATER;
    drawHero(g, Assets.player, player.dir, player.frameI, sx, sy,
      player.swingT, sel && ITEMS[sel.id].tool ? sel.id : null, inWater);
    return;
  }

  if (d.type === 'rplayer') {
    const rp = d.rp;
    const sx = w2sx(rp.px, rp.py) + ox;
    const sy = w2sy(rp.px, rp.py) + oy;
    const inWater = world.ground(Math.floor(rp.px), Math.floor(rp.py)) === T.WATER;
    drawHero(g, getHeroLookSet(rp.look), rp.dir, rp.frameI, sx, sy, 0, null, inWater);
    return;
  }

  if (d.type === 'npc') {
    const n = d.n;
    const sx = w2sx(n.x, n.y) + ox;
    const sy = w2sy(n.x, n.y) + oy;
    drawHero(g, getHeroLookSet(n.look), n.dir, n.frameI, sx, sy, 0, null, false);
    // moneda flotante: distingue a los comerciantes
    const coin = Assets.items.coin;
    const bob = Math.sin(G.elapsed * 3 + n.x) * 3;
    g.drawImage(coin, Math.round(sx - coin.width), Math.round(sy - 56 + bob), coin.width * 2, coin.height * 2);
    return;
  }

  if (d.type === 'mob') {
    const m = d.m;
    const sx = w2sx(m.x, m.y) + ox;
    const sy = w2sy(m.x, m.y) + oy;
    if (m.hurtT > 0 && Math.floor(G.elapsed * 18) % 2 === 0) return;
    let img, yoff = 0, alpha = 1;
    if (m.kind === 'slime') {
      img = Assets.mobs.slime[m.frame];
      yoff = m.hopping > 0 ? Math.sin((0.34 - m.hopping) / 0.34 * Math.PI) * 10 : 0;
      shadow(g, sx, sy, 18);
    } else if (m.kind === 'shadow') {
      img = Assets.mobs.shadow[m.frame];
      alpha = 0.88;
      yoff = Math.sin(m.t * 2.5) * 3;
      shadow(g, sx, sy, 16);
    } else if (m.kind === 'bat') {
      img = Assets.mobs.bat[m.frame];
      yoff = 28 + Math.sin(m.t * 3) * 6; // vuela alto
      shadow(g, sx, sy, 12);
    } else {
      img = Assets.mobs[m.kind][m.frame];   // fauna (conejo/ciervo)
      shadow(g, sx, sy, m.kind === 'deer' ? 22 : 14);
    }
    g.globalAlpha = alpha;
    if (m.flip) {
      g.save();
      g.translate(Math.round(sx), 0);
      g.scale(-1, 1);
      g.drawImage(img, -Math.round(img.width / 2), Math.round(sy - img.height + 4 - yoff));
      g.restore();
    } else {
      g.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height + 4 - yoff));
    }
    g.globalAlpha = 1;
    return;
  }

  if (d.type === 'boss') {
    const b = G.boss;
    const sx = w2sx(b.x, b.y) + ox;
    const sy = w2sy(b.x, b.y) + oy;
    shadow(g, sx, sy, 68);
    if (b.hurtT > 0 && Math.floor(G.elapsed * 18) % 2 === 0) return;
    const hop = b.hopping > 0 ? Math.sin((BOSS_CFG.hopTime - b.hopping) / BOSS_CFG.hopTime * Math.PI) * 28 : 0;
    const img = Assets.boss[b.frame];
    if (b.enraged) {
      g.globalAlpha = 0.55 + Math.sin(G.elapsed * 12) * 0.2;
      g.drawImage(img, Math.round(sx - img.width / 2) - 4, Math.round(sy - img.height + 8 - hop));
      g.globalAlpha = 1;
    }
    g.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height + 8 - hop));
    return;
  }

  if (d.type === 'drop') {
    const dr = d.drop;
    const sx = w2sx(dr.x, dr.y) + ox;
    const sy = w2sy(dr.x, dr.y) + oy;
    const bob = Math.sin(dr.age * 4) * 2.4;
    shadow(g, sx, sy, 12);
    const img = Assets.items[dr.id];
    if (img) {
      g.drawImage(img, Math.round(sx - img.width), Math.round(sy - img.height * 2 - 4 - dr.z * 20 - bob),
        img.width * 2, img.height * 2);
    }
    return;
  }

  if (d.type === 'proj') {
    const pr = d.pr;
    const sx = w2sx(pr.x, pr.y) + ox;
    const sy = w2sy(pr.x, pr.y) + oy - 16;
    g.save();
    g.translate(Math.round(sx), Math.round(sy));
    g.rotate(Math.atan2((pr.vx + pr.vy) * 0.5, pr.vx - pr.vy)); // ángulo de la velocidad proyectada a pantalla
    g.drawImage(Assets.arrow, -7, -3);
    g.restore();
    return;
  }

  if (d.type === 'part') {
    const p = d.p;
    const sx = w2sx(p.x, p.y) + ox;
    const sy = w2sy(p.x, p.y) + oy - p.z * 20;
    g.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    g.fillStyle = p.color;
    g.fillRect(Math.round(sx), Math.round(sy), 2, 2);
    g.globalAlpha = 1;
  }
}

// Vista previa del objeto a colocar con el clic derecho (con huella completa)
function ghostPreview(g, hov, inReach, ox, oy) {
  if (!G.running || player.dead || UI.panelOpen || UI.chatOpen) return;
  const sel = Inv.selected();
  if (!sel) return;
  const def = ITEMS[sel.id];
  if (def.place == null) return;
  const odef = OBJ[def.place];
  const size = odef.size || 1;

  let valid = inReach && world.canPlaceBuilding(hov.tx, hov.ty, size);
  if (valid && odef.solid) {
    for (let dy = 0; dy < size && valid; dy++) {
      for (let dx = 0; dx < size && valid; dx++) {
        if (overlapsTile(player, 0.3, hov.tx + dx, hov.ty + dy)) valid = false;
        for (const m of mobs) {
          if (overlapsTile(m, 0.3, hov.tx + dx, hov.ty + dy)) { valid = false; break; }
        }
        if (valid && typeof Net !== 'undefined' && Net.online) {
          for (const [, rp] of Net.players) {
            if (overlapsTile(rp, 0.45, hov.tx + dx, hov.ty + dy) ||
                overlapsTile({ x: rp.px, y: rp.py }, 0.45, hov.tx + dx, hov.ty + dy)) {
              valid = false;
              break;
            }
          }
        }
      }
    }
  }

  const cx = w2sx(hov.tx + size / 2, hov.ty + size / 2) + ox;
  const cy = w2sy(hov.tx + size / 2, hov.ty + size / 2) + oy;
  let img = Assets.obj[def.place];
  if (Array.isArray(img)) img = img[0];
  if (!img) return;
  let lift;
  if (def.place === O.WALLW || def.place === O.WALLS) lift = 16;
  else if (size === 2) lift = 28;
  else if (odef.size === 1) lift = 14;
  else lift = 12;
  g.globalAlpha = valid ? 0.55 : 0.25;
  g.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy + lift - img.height));
  g.globalAlpha = 1;
  g.fillStyle = valid ? 'rgba(111,206,78,0.22)' : 'rgba(216,52,52,0.3)';
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      fillDiamond(g, hov.tx + dx, hov.ty + dy, ox, oy);
    }
  }
}

function fillDiamond(g, tx, ty, ox, oy) {
  const sx = w2sx(tx, ty) + ox, sy = w2sy(tx, ty) + oy;
  g.beginPath();
  g.moveTo(sx, sy);
  g.lineTo(sx + CFG.HW, sy + CFG.HH);
  g.lineTo(sx, sy + CFG.TH);
  g.lineTo(sx - CFG.HW, sy + CFG.HH);
  g.closePath();
  g.fill();
}
