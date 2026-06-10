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
  const tx = W / 2 - w2sx(player.x, player.y);
  const ty = H / 2 - w2sy(player.x, player.y);
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

function render(g, W, H) {
  g.fillStyle = '#0b0e1a';
  g.fillRect(0, 0, W, H);
  const ox = cam.ox, oy = cam.oy;

  // --- rango de casillas visibles (las 4 esquinas de la pantalla a mundo) ---
  const c0 = s2w(-ox, -oy), c1 = s2w(W - ox, -oy), c2 = s2w(-ox, H - oy), c3 = s2w(W - ox, H - oy);
  const txmin = Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x)) - 1;
  const txmax = Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x)) + 1;
  const tymin = Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y)) - 1;
  const tymax = Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y)) + 2;

  const lights = [];
  const drawables = [];
  const waterFrame = Math.floor(G.elapsed * 1.6);

  // --- pasada de suelo + recogida de objetos ---
  for (let ty = tymin; ty <= tymax; ty++) {
    for (let tx = txmin; tx <= txmax; tx++) {
      const sx = w2sx(tx, ty) + ox, sy = w2sy(tx, ty) + oy;
      if (sx < -CFG.TW || sx > W + CFG.HW || sy < -CFG.TH * 3 || sy > H + CFG.TH) continue;
      const gr = world.ground(tx, ty);
      const frames = Assets.tiles[gr];
      let img;
      if (gr === T.WATER || gr === T.DEEP) {
        img = frames[(waterFrame + ((tx + ty * 3) & 1)) % frames.length];
      } else {
        img = frames[Math.floor(hash2(tx, ty, 71) * frames.length)];
      }
      g.drawImage(img, Math.round(sx - CFG.HW), Math.round(sy));

      const ob = world.object(tx, ty);
      if (ob !== O.NONE) {
        drawables.push({ d: tx + ty, type: 'obj', id: ob, tx, ty });
        const def = OBJ[ob];
        if (def.light && G.darkness > 0.02) {
          lights.push({
            x: w2sx(tx + 0.5, ty + 0.5) + ox,
            y: w2sy(tx + 0.5, ty + 0.5) + oy,
            r: def.light * CFG.HW,
            warm: true,
          });
        }
      }
    }
  }

  // --- entidades ---
  for (const m of mobs) drawables.push({ d: m.x + m.y, type: 'mob', m });
  for (const d of drops) drawables.push({ d: d.x + d.y, type: 'drop', drop: d });
  for (const p of particles) drawables.push({ d: p.x + p.y, type: 'part', p });
  if (!player.dead) drawables.push({ d: player.x + player.y, type: 'player' });

  drawables.sort((a, b) => a.d - b.d);

  const hov = hoveredTile();
  const inReach = dist2(player.x, player.y, hov.wx, hov.wy) <= CFG.REACH * CFG.REACH;

  // --- resaltado de la casilla apuntada ---
  if (G.running && !player.dead && !UI.panelOpen && inReach) {
    drawDiamond(g, hov.tx, hov.ty, ox, oy, Input.mdown ? 'rgba(255,220,90,0.85)' : 'rgba(255,255,255,0.55)');
  }

  for (const d of drawables) drawDrawable(g, d, ox, oy);

  // --- fantasma de colocación ---
  ghostPreview(g, hov, inReach, ox, oy);

  // --- barra de progreso al romper ---
  if (player.breaking) {
    const b = player.breaking;
    const def = OBJ[b.id];
    if (def) {
      const cx = w2sx(b.tx + 0.5, b.ty + 0.5) + ox;
      const cy = w2sy(b.tx + 0.5, b.ty + 0.5) + oy;
      const prog = clamp(b.dmg / def.hp, 0, 1);
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(Math.round(cx - 11), Math.round(cy - 26), 22, 5);
      g.fillStyle = '#ffd34d';
      g.fillRect(Math.round(cx - 10), Math.round(cy - 25), Math.round(20 * prog), 3);
    }
  }

  // --- luz del jugador (antorcha en mano / aura mínima) ---
  if (G.darkness > 0.02 && !player.dead) {
    const sel = Inv.selected();
    const holdingTorch = sel && sel.id === 'torch';
    lights.push({
      x: w2sx(player.x, player.y) + ox,
      y: w2sy(player.x, player.y) + oy,
      r: (holdingTorch ? 4.5 : 1.8) * CFG.HW,
      warm: holdingTorch,
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
    // halo cálido de las hogueras
    g.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      if (!l.warm) continue;
      const r = l.r * 0.8 * flick;
      const grad = g.createRadialGradient(l.x, l.y, 1, l.x, l.y, r);
      grad.addColorStop(0, 'rgba(255,140,40,' + (0.13 * G.darkness).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = grad;
      g.fillRect(l.x - r, l.y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
  }

  // --- textos flotantes (encima de la iluminación) ---
  g.textAlign = 'center';
  g.font = '7px "Press Start 2P", monospace';
  for (const f of floaters) {
    const fx = Math.round(w2sx(f.x, f.y) + ox);
    const fy = Math.round(w2sy(f.x, f.y) + oy - 18);
    g.globalAlpha = clamp(f.life, 0, 1);
    g.fillStyle = '#000';
    g.fillText(f.text, fx + 1, fy + 1);
    g.fillStyle = f.color;
    g.fillText(f.text, fx, fy);
    g.globalAlpha = 1;
  }

  // --- flash de daño ---
  if (player.hurtT > 0) {
    g.fillStyle = 'rgba(216,52,52,' + (0.32 * player.hurtT / 0.35).toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
  }
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
  g.fillRect(Math.round(sx - w / 2), Math.round(sy - 1), w, 3);
  g.fillRect(Math.round(sx - w / 2) + 2, Math.round(sy - 2), w - 4, 5);
}

function drawDrawable(g, d, ox, oy) {
  if (d.type === 'obj') {
    const cx = w2sx(d.tx + 0.5, d.ty + 0.5) + ox;
    const cy = w2sy(d.tx + 0.5, d.ty + 0.5) + oy;
    let img = Assets.obj[d.id];
    if (d.id === O.FLOWER) {
      img = img[Math.floor(hash2(d.tx, d.ty, 99) * img.length)];
    } else if (d.id === O.TORCH || d.id === O.FIRE) {
      img = img[(Math.floor(G.elapsed * 7) + d.tx + d.ty) % img.length];
    }
    const lift = (d.id === O.WALLW || d.id === O.WALLS) ? 8 : 6;
    g.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy + lift - img.height));
    return;
  }

  if (d.type === 'player') {
    const sx = w2sx(player.x, player.y) + ox;
    const sy = w2sy(player.x, player.y) + oy;
    // parpadeo durante la invulnerabilidad
    if (player.invuln > 0 && Math.floor(G.elapsed * 14) % 2 === 0) return;
    shadow(g, sx, sy, 10);
    const img = Assets.player[player.dir][player.frame];
    g.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height + 2));
    return;
  }

  if (d.type === 'mob') {
    const m = d.m;
    const sx = w2sx(m.x, m.y) + ox;
    const sy = w2sy(m.x, m.y) + oy;
    if (m.hurtT > 0 && Math.floor(G.elapsed * 18) % 2 === 0) return;
    shadow(g, sx, sy, 9);
    const hop = m.hopping > 0 ? Math.sin((0.34 - m.hopping) / 0.34 * Math.PI) * 5 : 0;
    const img = Assets.slime[m.frame];
    g.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height + 2 - hop));
    return;
  }

  if (d.type === 'drop') {
    const dr = d.drop;
    const sx = w2sx(dr.x, dr.y) + ox;
    const sy = w2sy(dr.x, dr.y) + oy;
    const bob = Math.sin(dr.age * 4) * 1.2;
    shadow(g, sx, sy, 6);
    const img = Assets.items[dr.id];
    if (img) {
      g.drawImage(img, Math.round(sx - img.width / 2), Math.round(sy - img.height - 2 - dr.z * 10 - bob));
    }
    return;
  }

  if (d.type === 'part') {
    const p = d.p;
    const sx = w2sx(p.x, p.y) + ox;
    const sy = w2sy(p.x, p.y) + oy - p.z * 10;
    g.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    g.fillStyle = p.color;
    g.fillRect(Math.round(sx), Math.round(sy), 1, 1);
    g.globalAlpha = 1;
  }
}

// Vista previa del objeto a colocar con el clic derecho
function ghostPreview(g, hov, inReach, ox, oy) {
  if (!G.running || player.dead || UI.panelOpen) return;
  const sel = Inv.selected();
  if (!sel) return;
  const def = ITEMS[sel.id];
  if (def.place == null) return;

  const gr = world.ground(hov.tx, hov.ty);
  const occupied = world.object(hov.tx, hov.ty) !== O.NONE;
  const onWater = gr === T.DEEP || gr === T.WATER;
  const onSelf = OBJ[def.place].solid &&
    Math.floor(player.x) === hov.tx && Math.floor(player.y) === hov.ty;
  const valid = inReach && !occupied && !onWater && !onSelf;

  const cx = w2sx(hov.tx + 0.5, hov.ty + 0.5) + ox;
  const cy = w2sy(hov.tx + 0.5, hov.ty + 0.5) + oy;
  let img = Assets.obj[def.place];
  if (Array.isArray(img)) img = img[0];
  const lift = (def.place === O.WALLW || def.place === O.WALLS) ? 8 : 6;
  g.globalAlpha = valid ? 0.55 : 0.25;
  g.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy + lift - img.height));
  g.globalAlpha = 1;
  if (!valid) {
    g.fillStyle = 'rgba(216,52,52,0.3)';
    fillDiamond(g, hov.tx, hov.ty, ox, oy);
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
