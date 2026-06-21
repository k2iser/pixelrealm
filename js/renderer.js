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
  if (G.mode === 'side') return hoveredTile2d();
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

// --- Buffer de escena + cadena de post (bloom). El mundo se dibuja a sceneCv
// (resolución de dispositivo), luego composite() lo vuelca a pantalla con un
// bloom de altas luces; los overlays de UI se pintan DESPUÉS, nítidos. ---
let _sceneCv = null, _sceneG = null;
function sceneLayer(W, H) {
  if (!_sceneCv || _sceneCv.width !== W || _sceneCv.height !== H) {
    _sceneCv = document.createElement('canvas');
    _sceneCv.width = W; _sceneCv.height = H;
    _sceneG = _sceneCv.getContext('2d');
  }
  return _sceneG;
}
let _bloomCv = null, _bloomG = null;
function bloomLayer(W, H) {
  if (!_bloomCv || _bloomCv.width !== W || _bloomCv.height !== H) {
    _bloomCv = document.createElement('canvas');
    _bloomCv.width = W; _bloomCv.height = H;
    _bloomG = _bloomCv.getContext('2d');
  }
  return _bloomG;
}
let _blurCv = null, _blurG = null;
function blurLayer(W, H) {
  if (!_blurCv || _blurCv.width !== W || _blurCv.height !== H) {
    _blurCv = document.createElement('canvas');
    _blurCv.width = W; _blurCv.height = H;
    _blurG = _blurCv.getContext('2d');
  }
  return _blurG;
}
// Tilt-shift de diorama: desenfoca arriba y abajo manteniendo nítida una banda
// horizontal centrada en el jugador. El mundo parece una maqueta de juguete.
// Muestrea la PANTALLA ya compuesta (escena + bloom) y trabaja a 1/2 resolución
// (la máscara se aplica sobre el propio buffer de desenfoque, sin buffer extra).
let _tiltGrad = null, _tiltGH = 0, _tiltGF = -1;
function tiltShift(g, dW, dH, focusY) {
  const bw = Math.max(2, dW >> 1), bh = Math.max(2, dH >> 1);
  const bg = blurLayer(bw, bh);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.globalAlpha = 1; bg.globalCompositeOperation = 'source-over'; bg.imageSmoothingEnabled = true;
  bg.clearRect(0, 0, bw, bh);
  bg.drawImage(g.canvas, 0, 0, bw, bh);             // muestrea la pantalla (con bloom) → desenfoque
  // máscara vertical: el desenfoque solo se conserva lejos de la banda de foco
  bg.globalCompositeOperation = 'destination-in';
  const f = clamp(focusY / dH, 0.16, 0.84), fq = Math.round(f * 100) / 100;
  if (!_tiltGrad || _tiltGH !== bh || _tiltGF !== fq) {
    const band = 0.14;
    _tiltGrad = bg.createLinearGradient(0, 0, 0, bh);
    _tiltGrad.addColorStop(0, 'rgba(0,0,0,0.82)');
    _tiltGrad.addColorStop(Math.max(0.001, fq - band), 'rgba(0,0,0,0.82)');
    _tiltGrad.addColorStop(fq, 'rgba(0,0,0,0)');
    _tiltGrad.addColorStop(Math.min(0.999, fq + band), 'rgba(0,0,0,0.82)');
    _tiltGrad.addColorStop(1, 'rgba(0,0,0,0.82)');
    _tiltGH = bh; _tiltGF = fq;
  }
  bg.fillStyle = _tiltGrad;
  bg.fillRect(0, 0, bw, bh);
  bg.globalCompositeOperation = 'source-over';
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.imageSmoothingEnabled = true;
  g.drawImage(_blurCv, 0, 0, dW, dH);               // vuelca el desenfoque enmascarado, reescalado
}
// Vuelca la escena a pantalla y suma un bloom de altas luces (sin shaders):
// downscale a 1/4 (= desenfoque de caja) + multiply consigo mismo (aísla brillos)
// + suma aditiva reescalada. Da el "sangrado" de luz de fuegos, agua y atardecer.
function composite(g, scene, dW, dH, strength, focusY) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = true;
  g.drawImage(scene, 0, 0);
  if (strength <= 0) { if (focusY != null) tiltShift(g, dW, dH, focusY); return; }
  const bw = Math.max(2, dW >> 2), bh = Math.max(2, dH >> 2);
  const bg = bloomLayer(bw, bh);
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.globalAlpha = 1;
  bg.globalCompositeOperation = 'source-over';
  bg.imageSmoothingEnabled = true;
  bg.clearRect(0, 0, bw, bh);
  bg.drawImage(scene, 0, 0, bw, bh);            // 1/4 res = desenfoque barato
  bg.globalCompositeOperation = 'multiply';
  bg.drawImage(_bloomCv, 0, 0, bw, bh);          // x sí mismo: suprime medios tonos, deja brillos
  bg.globalCompositeOperation = 'source-over';
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = strength;
  g.drawImage(_bloomCv, 0, 0, dW, dH);           // reescala y suma
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // tilt-shift al final: muestrea la pantalla ya con bloom (las bandas lo atenúan)
  if (focusY != null) tiltShift(g, dW, dH, focusY);
}

// Sprites de degradado radial precocinados: evitan crear un createRadialGradient
// (y rasterizar el degradado) por cada luz y cada frame. Se hornean a radio fijo
// y se escalan con drawImage; el círculo (arc) ahorra el relleno inútil de esquinas.
const GLOW_R = 256;
function _bakeGlow(stops) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = GLOW_R * 2;
  const c = cv.getContext('2d');
  const grad = c.createRadialGradient(GLOW_R, GLOW_R, 1, GLOW_R, GLOW_R, GLOW_R);
  for (const s of stops) grad.addColorStop(s[0], s[1]);
  c.fillStyle = grad;
  c.beginPath(); c.arc(GLOW_R, GLOW_R, GLOW_R, 0, Math.PI * 2); c.fill();
  return cv;
}
let _veilGlow = null;            // agujero de luz para el velo (destination-out)
function veilGlow() {
  if (!_veilGlow) _veilGlow = _bakeGlow([[0, 'rgba(0,0,0,0.95)'], [0.55, 'rgba(0,0,0,0.65)'], [1, 'rgba(0,0,0,0)']]);
  return _veilGlow;
}
const _haloGlow = {};            // halo cálido/místico (alpha horneado a 1; se modula con globalAlpha)
function haloGlow(rgb) {
  if (!_haloGlow[rgb]) _haloGlow[rgb] = _bakeGlow([[0, 'rgba(' + rgb + ',1)'], [1, 'rgba(' + rgb + ',0)']]);
  return _haloGlow[rgb];
}
let _fireflyGlow = null;         // resplandor de luciérnaga (radio fijo, sin escala)
function fireflyGlow() {
  if (!_fireflyGlow) {
    const r = 5; _fireflyGlow = document.createElement('canvas');
    _fireflyGlow.width = _fireflyGlow.height = r * 2;
    const c = _fireflyGlow.getContext('2d');
    const grad = c.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(190,255,130,0.5)');   // centro a 0.5 (= a*0.5 con globalAlpha=a)
    grad.addColorStop(1, 'rgba(190,255,130,0)');
    c.fillStyle = grad; c.fillRect(0, 0, r * 2, r * 2);
  }
  return _fireflyGlow;
}
// Viñeta: el degradado solo depende de W,H y la oscuridad (cuantizada); se cachea.
let _vigGrad = null, _vigW = 0, _vigH = 0, _vigDk = -1;

// --- Oclusión de contacto + sombras direccionales (Diorama iluminado) ---
// Elipse de AO blanda horneada una vez; se escala con drawImage bajo cada entidad.
let _aoSprite = null;
function aoSprite() {
  if (!_aoSprite) _aoSprite = _bakeGlow([[0, 'rgba(0,0,0,0.55)'], [0.5, 'rgba(0,0,0,0.30)'], [1, 'rgba(0,0,0,0)']]);
  return _aoSprite;
}
// Silueta negra de un sprite (para la sombra proyectada). Cacheada por sprite.
const _silCache = new WeakMap();
function silhouette(img) {
  let s = _silCache.get(img);
  if (!s) {
    s = document.createElement('canvas');
    s.width = img.width; s.height = img.height;
    const cg = s.getContext('2d');
    cg.drawImage(img, 0, 0);
    cg.globalCompositeOperation = 'source-in';
    cg.fillStyle = '#000';
    cg.fillRect(0, 0, img.width, img.height);
    _silCache.set(img, s);
  }
  return s;
}
// Vector de sombra según el sol del ciclo día/noche (null de noche).
// shear = desplazamiento horizontal por unidad de altura; flat = aplastado vertical.
function sunShadow() {
  if (G.darkness > 0.55) return null;
  const dt2 = (((G.time - 0.95) % 1) + 1) % 1;   // 0 = amanecer, 0.5 = ocaso
  if (dt2 >= 0.5) return null;
  const ph = (dt2 / 0.5) * Math.PI;              // 0..π a lo largo del día
  const elev = Math.sin(ph);                     // 0 horizonte, 1 mediodía
  const az = Math.cos(ph);                        // +1 amanecer (este), -1 ocaso (oeste)
  const len = clamp(0.85 / (elev + 0.4), 0.35, 1.9);
  return { shear: -az * len, flat: 0.42 + 0.13 * (1 - elev), alpha: 0.22 * clamp(1 - G.darkness, 0, 1) };
}
function castShadow(g, img, bx, by, ss) {
  g.save();
  g.globalAlpha = ss.alpha;
  g.translate(bx, by);
  g.transform(1, 0, ss.shear, ss.flat, 0, 0);   // cizalla por altura + aplasta en Y (base anclada)
  g.drawImage(silhouette(img), Math.round(-img.width / 2), -img.height);
  g.globalAlpha = 1;
  g.restore();
}
// Silueta teñida de un sprite (para el rim light). Cacheada por sprite y color.
const _rimCache = new WeakMap();
function silTinted(img, color) {
  let m = _rimCache.get(img);
  if (!m) { m = {}; _rimCache.set(img, m); }
  if (!m[color]) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cg = c.getContext('2d');
    cg.drawImage(img, 0, 0);
    cg.globalCompositeOperation = 'source-in';
    cg.fillStyle = color;
    cg.fillRect(0, 0, img.width, img.height);
    m[color] = c;
  }
  return m[color];
}
// Rim light frío de luna: dibuja la silueta teñida desplazada arriba-izq y la
// tapa el sprite real (dibujado después), dejando un filo luminoso en el borde.
function rimLight(g, img, dx, dy, intensity) {
  if (intensity <= 0.02) return;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = intensity;
  g.drawImage(silTinted(img, '#bcd0ff'), dx - 1, dy - 2);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
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

// --- Viento: cuánto se mece la copa de cada vegetal (px de desplazamiento) ---
const SWAY_AMP = {
  [O.TREE]: 3.4, [O.PINE]: 2.4, [O.CACTUS]: 0.7,
  [O.FLOWER]: 1.9, [O.TALLGRASS]: 2.6, [O.BUSH]: 1.7,
  [O.CROP0]: 1.2, [O.CROP1]: 1.6, [O.CROP2]: 2.0, [O.CROP3]: 2.3,
};
// ráfaga global (envolvente lenta) + onda local desfasada por casilla.
// G.windBoost lo sube el clima (lluvia/tormenta de la tarea de clima).
function windAt(tx, ty) {
  const phase = tx * 0.7 + ty * 0.9;
  const gust = 0.55 + 0.45 * Math.sin(G.elapsed * 0.21 + 1.3);
  return (Math.sin(G.elapsed * 1.5 + phase) + 0.34 * Math.sin(G.elapsed * 3.0 + phase * 1.7)) * gust;
}

// Reflejo del cielo + destello especular sobre una casilla de agua (rombo).
function drawWaterTile(g, sx, sy, tx, ty, wp, detail) {
  const HW = CFG.HW, HH = CFG.HH, TH = CFG.TH;
  // 1) tinte de reflejo del cielo (más cálido al atardecer, oscuro de noche) — barato
  g.fillStyle = wp.tint;
  g.beginPath();
  g.moveTo(sx, sy); g.lineTo(sx + HW, sy + HH); g.lineTo(sx, sy + TH); g.lineTo(sx - HW, sy + HH);
  g.closePath();
  g.fill();
  if (!detail) return;
  // 2) banda especular que se desplaza despacio (parpadeo desfasado por casilla)
  const ph = G.elapsed * 0.7 + tx * 0.5 + ty * 0.8;
  const a = wp.specA * (0.45 + 0.55 * Math.sin(ph));
  if (a > 0.02) {
    const cy = sy + HH + Math.sin(ph * 0.8) * 5;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a;
    g.fillStyle = wp.spec;
    g.beginPath();
    g.moveTo(sx, cy - 2.5); g.lineTo(sx + HW * 0.55, cy); g.lineTo(sx, cy + 2.5); g.lineTo(sx - HW * 0.55, cy);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}
// Espuma blanca animada en el borde del rombo que da a tierra (e: 0 NO·1 NE·2 SE·3 SO).
function drawFoamEdge(g, sx, sy, e, alpha) {
  const HW = CFG.HW, HH = CFG.HH, TH = CFG.TH;
  let x1, y1, x2, y2;
  if (e === 0) { x1 = sx - HW; y1 = sy + HH; x2 = sx; y2 = sy; }
  else if (e === 1) { x1 = sx; y1 = sy; x2 = sx + HW; y2 = sy + HH; }
  else if (e === 2) { x1 = sx + HW; y1 = sy + HH; x2 = sx; y2 = sy + TH; }
  else { x1 = sx; y1 = sy + TH; x2 = sx - HW; y2 = sy + HH; }
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(226,244,255,' + (alpha * 0.5).toFixed(3) + ')';
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,' + alpha.toFixed(3) + ')';
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.lineCap = 'butt';   // restaura el valor por defecto (no contaminar trazos posteriores)
  g.globalCompositeOperation = 'source-over';
}

function render(g, W, H) {
  // Post-proceso (bloom): el mundo se dibuja a un buffer de escena y luego se
  // compone a pantalla; los overlays de UI van después, nítidos. Sin bloom
  // (GFX<2) se dibuja directo a pantalla.
  const screen = g;
  const dW = canvas.width, dH = canvas.height;
  const useBuffer = CFG.GFX >= 2;
  if (useBuffer) g = sceneLayer(dW, dH);
  // El zoom es una escala de mundo: dibujamos en píxeles lógicos (W,H) y la
  // transformada amplía al backing-store nativo con suavizado. setTransform
  // reemplaza cualquier transformada previa, así que es seguro al inicio del frame.
  g.setTransform(G.renderScale, 0, 0, G.renderScale, 0, 0);
  // GFX 0 = sin suavizado en el mundo (pixel nítido y barato); 1/2 = suavizado HD
  g.imageSmoothingEnabled = CFG.GFX >= 1;
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
  // parámetros de agua por frame (reflejo del cielo según la hora) — Etapa 3
  const fancyWater = CFG.GFX >= 1;
  // el detalle caro (especular + espuma por rombo) solo de cerca o en calidad alta;
  // a zoom lejano hay cientos de casillas de agua y no se aprecia
  const waterDetail = fancyWater && (CFG.GFX >= 2 || G.zoom >= 2);
  const _dayl = clamp(1 - G.darkness, 0, 1);
  const _wm = G.warm || 0;
  const wp = {
    tint: 'rgba(' + Math.round(38 + _dayl * 64 + _wm * 130) + ',' + Math.round(66 + _dayl * 104 + _wm * 40) + ',' + Math.round(104 + _dayl * 118 - _wm * 20) + ',0.30)',
    spec: 'rgb(' + Math.round(200 + _dayl * 55) + ',' + Math.round(225 + _dayl * 30) + ',255)',
    specA: 0.14 + 0.12 * _dayl,
  };

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

      const isWater = gr === T.WATER || gr === T.DEEP;
      if (isWater && fancyWater) drawWaterTile(g, sx, sy, tx, ty, wp, waterDetail);

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
          // espuma de orilla: en casillas de agua que lindan con tierra (fase por casilla)
          if (isWater && waterDetail && ng !== T.WATER && ng !== T.DEEP) {
            drawFoamEdge(g, sx, sy, e, 0.5 + 0.22 * Math.sin(G.elapsed * 2 + tx * 0.6 + ty * 0.9));
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
    const LP = 9, N = CFG.CHUNK;
    // En vez de barrer casilla a casilla, recorremos los chunks que intersectan
    // el rango visible+margen y solo sus emisores (ch.lights). Conservamos el
    // mismo recorte rectangular LP y el recorte de pantalla del bucle original,
    // así el conjunto de luces dibujadas es idéntico al de antes.
    const cxmin = Math.floor((txmin - LP) / N), cxmax = Math.floor((txmax + LP) / N);
    const cymin = Math.floor((tymin - LP) / N), cymax = Math.floor((tymax + LP) / N);
    for (let ccy = cymin; ccy <= cymax; ccy++) {
      for (let ccx = cxmin; ccx <= cxmax; ccx++) {
        const ls = world.chunkAt(ccx, ccy).lights;
        for (let i = 0; i < ls.length; i++) {
          const tx = ls[i].tx, ty = ls[i].ty;
          if (tx < txmin - LP || tx > txmax + LP || ty < tymin - LP || ty > tymax + LP) continue;
          const def = OBJ[ls[i].ob];
          const size = def.size || 1;
          const lx = w2sx(tx + size / 2, ty + size / 2) + ox;
          const ly = w2sy(tx + size / 2, ty + size / 2) + oy;
          const r = def.light * CFG.HW;
          if (lx < -r * 1.2 || lx > W + r * 1.2 || ly < -r * 1.2 || ly > H + r * 1.2) continue;
          lights.push({ x: lx, y: ly, r, warm: true, color: def.lightColor || null });
        }
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

  // motas de polen flotando a plena luz del día (ambiente)
  drawDayMotes(g, W, H, ox, oy);

  // vista previa de colocación (dentro del alcance, junto al jugador → en foco)
  ghostPreview(g, hov, inReach, ox, oy);

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

  // --- gradación de color del cielo (amanecer/mediodía/atardecer/noche) ---
  if (G.grade && G.grade[3] > 0.01) {
    g.fillStyle = 'rgba(' + (G.grade[0] | 0) + ',' + (G.grade[1] | 0) + ',' + (G.grade[2] | 0) + ',' + G.grade[3].toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
  }

  // --- oscuridad nocturna con agujeros de luz ---
  if (G.darkness > 0.02) {
    const v = G.veil || [10, 14, 40];
    const lg = lightLayer(W, H);
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, W, H);
    lg.fillStyle = 'rgba(' + (v[0] | 0) + ',' + (v[1] | 0) + ',' + (v[2] | 0) + ',' + (0.87 * G.darkness).toFixed(3) + ')';
    lg.fillRect(0, 0, W, H);
    lg.globalCompositeOperation = 'destination-out';
    const flick = 1 + Math.sin(G.elapsed * 9) * 0.05 + Math.sin(G.elapsed * 23) * 0.03;
    const vsp = veilGlow();
    for (const l of lights) {
      const r = l.r * (l.warm ? flick : 1);
      lg.drawImage(vsp, l.x - r, l.y - r, r * 2, r * 2);
    }
    g.drawImage(_lightCv, 0, 0);
    // ascuas que ascienden desde las fuentes de luz cálida
    drawEmbers(g, lights);
    // halo cálido (naranja) o místico (violeta del altar)
    g.globalCompositeOperation = 'lighter';
    const prevSmooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = true;           // el halo es suave: el sprite escala sin pixelar
    g.globalAlpha = 0.13 * G.darkness;        // modula el alpha horneado (1) del sprite
    for (const l of lights) {
      if (!l.warm && !l.color) continue;
      const r = l.r * 0.8 * flick;
      const rgb = l.color === '#a070ff' ? '160,112,255' : '255,140,40';
      g.drawImage(haloGlow(rgb), l.x - r, l.y - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.imageSmoothingEnabled = prevSmooth;
    g.globalCompositeOperation = 'source-over';
  }

  // --- componer la escena a pantalla con bloom; los overlays van después, nítidos ---
  if (useBuffer) {
    if (player.dead) {
      // la pantalla de muerte (DOM opaco) tapa la escena: evita el coste de post
      screen.setTransform(1, 0, 0, 1, 0, 0);
      screen.globalAlpha = 1; screen.globalCompositeOperation = 'source-over'; screen.imageSmoothingEnabled = true;
      screen.drawImage(_sceneCv, 0, 0);
    } else {
      // menos bloom de día (escena nítida), más de noche (fuegos/agua/altar florecen);
      // tilt-shift enfocado en el jugador (px de dispositivo, con el shake incluido)
      const fY = (!CFG.TILT) ? null : (w2sy(player.x, player.y) + oy) * G.renderScale;
      composite(screen, _sceneCv, dW, dH, 0.18 + 0.40 * G.darkness, fY);
    }
    g = screen;
    g.setTransform(G.renderScale, 0, 0, G.renderScale, 0, 0);
    g.imageSmoothingEnabled = true;
  }

  // --- overlays de mundo nítidos (no pasan por bloom/tilt-shift) ---
  // estrellas y luciérnagas (cielo fijo a pantalla: no deben desenfocarse)
  if (G.darkness > 0.55) {
    const sa = (G.darkness - 0.55) / 0.45;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const sx = hash2(i, 1, 7) * W, sy = hash2(i, 2, 7) * H * 0.92;
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(G.elapsed * (0.6 + hash2(i, 3, 7)) + i));
      g.fillStyle = 'rgba(220,228,255,' + (sa * tw * 0.7).toFixed(3) + ')';
      const s = hash2(i, 4, 7) < 0.2 ? 2 : 1;
      g.fillRect(sx | 0, sy | 0, s, s);
    }
    g.globalCompositeOperation = 'source-over';
    drawFireflies(g, W, H, sa);
  }
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
  // barra de progreso al romper (feedback nítido, sin bloom)
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

  // --- viñeta cinematográfica (oscurece bordes, más marcada de noche) ---
  {
    const dk = Math.round(G.darkness * 50) / 50;   // cuantiza a pasos de 0.02
    if (!_vigGrad || _vigW !== W || _vigH !== H || _vigDk !== dk) {
      _vigGrad = g.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.40, W / 2, H * 0.46, Math.max(W, H) * 0.72);
      _vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
      _vigGrad.addColorStop(1, 'rgba(0,0,0,' + (0.26 + 0.22 * dk).toFixed(3) + ')');
      _vigW = W; _vigH = H; _vigDk = dk;
    }
    g.fillStyle = _vigGrad;
    g.fillRect(0, 0, W, H);
  }

  // --- clima: lluvia/tormenta/nieve + destello de relámpago ---
  drawWeather(g, W, H);

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
  // oclusión de contacto: elipse radial blanda que "asienta" la entidad en el suelo
  const hw = w * 0.92, hh = Math.max(4, w * 0.42);
  g.drawImage(aoSprite(), Math.round(sx - hw), Math.round(sy + 2 - hh), Math.round(hw * 2), Math.round(hh * 2));
}

// Animación procedural ("juice"): deforma el sprite alrededor del pivote en los
// PIES (la base, donde se ancla la sombra) según el estado de la entidad — sin
// redibujar nada, solo modula el transform antes del blit. Devuelve
// {sxScale, syScale, shearX, bobY}: sxScale/syScale = squash&stretch con pies
// clavados; shearX = inclinación (la cima se mueve, base fija); bobY = bote de
// TODO el cuerpo (los pies se despegan → rebote/saltito; la sombra queda abajo).
function computeLivePose(anim, dir) {
  let sx = 1, sy = 1, shear = 0, bob = 0;
  const t = anim.t || 0;
  if (anim.moving) {
    const at = anim.animT || 0;
    const step = Math.abs(Math.sin(at * 11));          // 1 en la elevación, 0 al apoyar
    bob -= step * (anim.rigged ? 0.7 : 2.2);           // bote global (reducido si el rig ya bota las piernas)
    shear += Math.sin(at * 5.5) * 0.05;                 // contoneo
    sy *= 1 - (1 - step) * 0.05;                        // aplaste al apoyar el pie
    sx *= 1 + (1 - step) * 0.04;
    const sdx = (anim.vx || 0) - (anim.vy || 0);        // velocidad mundo → eje x de pantalla
    shear += clamp(-sdx * 0.02, -0.16, 0.16);           // inclinación hacia el movimiento
  } else if ((anim.swingT || 0) <= 0) {
    const breath = Math.sin(t * 2.2) * 0.5 + 0.5;       // respiración (pies clavados)
    sy *= 1 + 0.04 * breath;
    sx *= 1 - 0.03 * breath;
    // gesto ocioso por oficio (NPC), desfasado por su reloj t
    if (anim.role != null) {
      if (anim.role === 0) shear += Math.max(0, Math.sin(t * 0.8) - 0.6) * 0.55;                 // herborista: se inclina a oler
      else if (anim.role === 1) bob += Math.max(0, Math.sin(t * 7)) * Math.max(0, Math.sin(t * 0.5)) * 2.4; // cantero: martillea a ratos
      else if (anim.role === 2) shear += Math.sin(t * 5) * Math.max(0, Math.sin(t * 0.6)) * 0.07;           // carpintero: cepilla
      else if (anim.role === 3) sy *= 1 + Math.max(0, Math.sin(t * 3)) * 0.025;                  // mercader: cabeceo (la moneda ya salta)
    }
  }
  // recoil del golpe (anticipación + latigazo). Si el rig ya late con el brazo, se atenúa el cuerpo
  if ((anim.swingT || 0) > 0) {
    const prog = clamp(1 - anim.swingT / 0.18, 0, 1);
    const sgn = (dir === 'up' || dir === 'left') ? -1 : 1;
    const rk = anim.rigged ? 0.4 : 1;
    if (prog < 0.3) { shear += sgn * -0.13 * (prog / 0.3) * rk; sy *= 1 - 0.04 * rk; }
    else { const w = Math.sin(((prog - 0.3) / 0.7) * Math.PI); shear += sgn * 0.26 * w * rk; sy *= 1 + 0.06 * w * rk; sx *= 1 + 0.05 * w * rk; }
  }
  // flinch de daño: aplaste rápido que decae (acompaña al parpadeo)
  if ((anim.hurtT || 0) > 0) { sx *= 1 + anim.hurtT * 0.5; sy *= 1 - anim.hurtT * 0.3; }
  // saltito de alegría al recoger
  if ((anim.pickT || 0) > 0) bob -= Math.sin((0.25 - anim.pickT) / 0.25 * Math.PI) * 4;
  // respingo de ancho al girar
  if ((anim.dirFlash || 0) > 0) sx *= 1 + 0.06 * (anim.dirFlash / 0.12);
  // salto: eleva el cuerpo (la sombra queda en el suelo); estira al subir, encoge al caer
  if (anim.z) bob -= anim.z * CFG.ZK;
  if (anim.vz) { const st = clamp(anim.vz * 0.012, -0.07, 0.12); sy *= 1 + st; sx *= 1 - st * 0.7; }
  if (anim.landT) { const l = anim.landT / 0.14; sy *= 1 - 0.18 * l; sx *= 1 + 0.16 * l; }   // aplaste de impacto
  return { sxScale: sx, syScale: sy, shearX: shear, bobY: bob };
}

// ===== RIG 2D: ensambla el cuerpo a partir de piezas (movimiento articulado) =====
// El cuerpo se compone a un buffer 56x96, se contornea UNA vez y se reduce a
// 28x48; el compuesto se cachea por (look,dir,bucket) para que toda la cadena de
// efectos (sombra/cast-shadow/rim/estela) siga recibiendo UN sprite estable.
const _rigCache = new Map();
let _rigScratchCv = null, _rigScratchG = null;
function rigScratch() {
  if (!_rigScratchCv) { _rigScratchCv = document.createElement('canvas'); _rigScratchCv.width = 56; _rigScratchCv.height = 96; _rigScratchG = _rigScratchCv.getContext('2d'); }
  return _rigScratchG;
}
// Ángulos por JUNTA (esqueleto FK de 2 huesos por miembro). Pose discreta = cacheable.
// Devuelve { capeRot, torsoRot, headRot, headDy, hip{L,R}, knee{L,R}, legDy{L,R}, sh{L,R}, elb{L,R} }.
function rigPoseFor(dir, st) {
  const Q = { capeRot: 0, torsoRot: 0, headRot: 0, headDy: 0,
    hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, legDyL: 0, legDyR: 0, shL: 0, shR: 0, elbL: 0, elbR: 0 };
  const prof = dir === 'left' || dir === 'right';
  const fs = dir === 'left' ? -1 : 1;            // signo de "frente" para el perfil
  const S = Math.sin, mx = Math.max;
  if (st.kind === 'walk') {
    const ph = st.ph;
    if (prof) {
      // zancada de cadera + flexión de rodilla en la fase de vuelo (pierna que avanza)
      Q.hipL = S(ph) * 0.42 * fs; Q.hipR = S(ph + Math.PI) * 0.42 * fs;
      Q.kneeL = mx(0, S(ph + 0.6)) * 1.0 * fs; Q.kneeR = mx(0, S(ph + Math.PI + 0.6)) * 1.0 * fs;
      // brazos en contrafase a su pierna + codo con flexión
      Q.shL = S(ph + Math.PI) * 0.5 * fs; Q.shR = S(ph) * 0.5 * fs;
      Q.elbL = (-0.35 - mx(0, S(ph + Math.PI)) * 0.5) * fs; Q.elbR = (-0.35 - mx(0, S(ph)) * 0.5) * fs;
    } else {
      // marcha frontal: elevación alterna + rodilla que recoge el pie (atenuada)
      Q.legDyL = -mx(0, S(ph)) * 3.5; Q.kneeL = mx(0, S(ph)) * 0.9; Q.hipL = S(ph) * 0.14;
      Q.legDyR = -mx(0, S(ph + Math.PI)) * 3.5; Q.kneeR = mx(0, S(ph + Math.PI)) * 0.9; Q.hipR = S(ph + Math.PI) * 0.14;
      Q.shL = S(ph + Math.PI) * 0.32; Q.shR = S(ph) * 0.32; Q.elbL = -0.3; Q.elbR = -0.3;
    }
    Q.torsoRot = -S(ph) * 0.05; Q.headRot = S(ph) * 0.03; Q.headDy = -Math.abs(S(ph * 2)) * 1.0;
    Q.capeRot = S(ph * 0.5) * 0.06;
  } else if (st.kind === 'jump') {
    const a = st.air;
    // recogida fetal: muslos arriba, rodillas muy flexionadas; brazos arriba
    Q.hipL = 0.55; Q.hipR = 0.4; Q.kneeL = -1.4 * (0.6 + a * 0.4); Q.kneeR = -1.25 * (0.6 + a * 0.4);
    Q.legDyL = -2; Q.legDyR = -2; Q.shL = -0.7; Q.shR = 0.7; Q.elbL = -0.6; Q.elbR = -0.6;
    Q.capeRot = -0.4 - a * 0.25; Q.headDy = -1;
  } else if (st.kind === 'atk') {
    const w = Math.sin(st.prog * Math.PI), s = fs;
    if (dir === 'left') { Q.shL = (st.prog < 0.3 ? -0.6 * (st.prog / 0.3) : 1.0 * w) * s; Q.elbL = -0.5 - 0.5 * w; }
    else { Q.shR = (st.prog < 0.3 ? -0.6 * (st.prog / 0.3) : 1.0 * w) * s; Q.elbR = -0.5 - 0.5 * w; }
    Q.torsoRot = -0.06 * w * s; Q.elbL = Q.elbL || -0.2; Q.elbR = Q.elbR || -0.2;
  } else {                                          // idle: brazos relajados (resto lo da computeLivePose)
    Q.elbL = -0.18; Q.elbR = -0.18;
  }
  return Q;
}
// Dibuja un miembro de 2 huesos en cadena FK: raíz rota en su pivote, hijo rota
// en el suyo arrastrado por la raíz (rodilla/codo que flexiona).
function drawLimb(g, rImg, cImg, rp, cp, rRot, cRot, dy) {
  dy = dy || 0;
  g.save();
  g.translate(rp[0], rp[1] + dy); g.rotate(rRot || 0);
  g.drawImage(rImg, -rp[0], -rp[1]);
  g.translate(cp[0] - rp[0], cp[1] - rp[1]); g.rotate(cRot || 0);
  g.drawImage(cImg, -cp[0], -cp[1]);
  g.restore();
}
// Devuelve el compuesto 28x48 articulado para este estado de animación (cacheado).
function assembleHero(set, dir, anim, lookKey) {
  if (!set.rig[dir]) dir = 'down';   // a prueba de dir remoto corrupto (como el path plano)
  const grounded = anim.grounded !== false;
  let st, bucket;
  if ((anim.swingT || 0) > 0) { const pr = clamp(1 - anim.swingT / 0.18, 0, 1); const q = Math.round(pr * 3); st = { kind: 'atk', prog: q / 3 }; bucket = 'a' + q; }
  else if (!grounded) { const q = Math.round(clamp((anim.z || 0) * 1.0, 0, 1) * 3); st = { kind: 'jump', air: q / 3 }; bucket = 'j' + q; }
  else if (anim.moving) { const N = 8, raw = (anim.animT || 0) * 9 / (Math.PI * 2); const fq = ((Math.round(raw * N) % N) + N) % N; st = { kind: 'walk', ph: fq / N * Math.PI * 2 }; bucket = 'w' + fq; }
  else { st = { kind: 'idle' }; bucket = 'i'; }
  const key = lookKey + '|' + dir + '|' + bucket;
  const hit = _rigCache.get(key);
  if (hit) return hit;
  const p = set.rig[dir], Q = rigPoseFor(dir, st), V = RIG_PIVOTS;
  const g = rigScratch();
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, 56, 96);
  const legL = () => drawLimb(g, p.thighL, p.shinL, V.hipL, V.kneeL, Q.hipL, Q.kneeL, Q.legDyL);
  const legR = () => drawLimb(g, p.thighR, p.shinR, V.hipR, V.kneeR, Q.hipR, Q.kneeR, Q.legDyR);
  const armL = () => drawLimb(g, p.uarmL, p.farmL, V.shL, V.elbL, Q.shL, Q.elbL, 0);
  const armR = () => drawLimb(g, p.uarmR, p.farmR, V.shR, V.elbR, Q.shR, Q.elbR, 0);
  const simple = (img, piv, rot, dy) => { g.save(); g.translate(piv[0], piv[1] + (dy || 0)); if (rot) g.rotate(rot); g.drawImage(img, -piv[0], -piv[1]); g.restore(); };
  const cape = () => simple(p.cape, V.cape, Q.capeRot, 0);
  const torso = () => simple(p.torso, V.torso, Q.torsoRot, 0);
  const head = () => simple(p.head, V.head, Q.headRot, Q.headDy);
  // orden z (atrás→delante) por dirección; en perfil el lado lejano va tras el torso
  let order;
  if (dir === 'up') order = [legL, legR, armL, armR, torso, cape, head];
  else if (dir === 'right') order = [cape, legL, armL, torso, legR, armR, head];     // lado izq = lejano
  else if (dir === 'left') order = [cape, legR, armR, torso, legL, armL, head];      // lado der = lejano
  else order = [cape, legL, legR, torso, armL, armR, head];                          // frente
  for (const fn of order) fn();
  outlineSprite(_rigScratchCv, '#241a2e');
  const out = scaleSmooth(_rigScratchCv, 28, 48);
  _rigCache.set(key, out);
  if (_rigCache.size > 600) {           // evicción FIFO suave (Map conserva orden); evita el flush total
    for (let i = 0; i < 120; i++) { const k0 = _rigCache.keys().next().value; if (k0 === undefined) break; _rigCache.delete(k0); }
  }
  return out;
}

// Dibuja un héroe (propio o remoto) con su herramienta al golpear.
// En el agua se dibuja medio sumergido, con ondas en la superficie.
function drawHero(g, set, dir, frameI, sx, sy, swingT, toolId, inWater, anim) {
  // a prueba de estados remotos corruptos: dir/frame inválidos caen al defecto
  const frames = set[dir] || set.down;
  let img = frames[frameI] || frames[0];
  // cuerpo ARTICULADO: el rig sustituye el sprite plano por las piezas ensambladas
  if (set.rig && set._key && CFG.GFX >= 1 && anim) {
    anim.rigged = true;
    img = assembleHero(set, dir, anim, set._key);
  }
  if (inWater) {
    const cut = Math.floor(img.height * 0.35);
    const bobw = Math.sin(G.elapsed * 3 + sx * 0.05) * 1.5;
    g.drawImage(img, 0, 0, img.width, img.height - cut,
      Math.round(sx - img.width / 2), Math.round(sy + 2 - (img.height - cut) + bobw),
      img.width, img.height - cut);
    // ondas concéntricas que se expanden alrededor del vadeador
    g.strokeStyle = 'rgba(226,244,255,1)';
    g.lineWidth = 1.5;
    for (let k = 0; k < 2; k++) {
      const t = ((G.elapsed * 0.9 + k * 0.5) % 1);
      g.globalAlpha = (1 - t) * 0.6;
      g.beginPath();
      g.ellipse(sx, sy + 2, 6 + t * 15, 3 + t * 7.5, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    return;
  }
  // la sombra/AO se queda en el suelo y se encoge con la altura del salto
  shadow(g, sx, sy, 20 / (1 + ((anim && anim.z) || 0) * 0.5));
  const hss = CFG.GFX >= 1 ? sunShadow() : null;
  if (hss && hss.alpha > 0.02) castShadow(g, img, Math.round(sx), Math.round(sy + 2), hss);
  const hdx = Math.round(sx - img.width / 2), hdy = Math.round(sy - img.height + 2);
  const rimI = CFG.GFX >= 2 ? 0.32 * clamp((G.darkness - 0.4) / 0.6, 0, 1) : 0;
  // animación procedural: pivote en los pies (mismo punto que la sombra) → el
  // cuerpo respira/bota/se inclina con la base clavada y la AO nunca se despega
  const lp = computeLivePose(anim || {}, dir);
  const bx = Math.round(sx), by = Math.round(sy + 2);
  g.save();
  g.translate(bx, by);
  g.transform(lp.sxScale, 0, lp.shearX, lp.syScale, 0, lp.bobY);
  if (rimI) rimLight(g, img, hdx - bx, hdy - by, rimI);
  g.drawImage(img, hdx - bx, hdy - by);
  g.restore();
  if (swingT > 0 && toolId && Assets.items[toolId]) {
    const t = Assets.items[toolId];
    const prog = 1 - swingT / 0.18;
    const offs = { down: [14, -16], up: [14, -28], left: [-18, -22], right: [18, -22] };
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
    // sombra proyectada del sol para objetos altos sólidos (árbol, torre, casa…)
    const ss = (CFG.GFX >= 1 && def.solid && d.id !== O.WALLW && d.id !== O.WALLS && img.height >= 20) ? sunShadow() : null;
    if (ss && ss.alpha > 0.02) castShadow(g, img, Math.round(cx), Math.round(cy + lift), ss);
    // tiembla mientras lo estás talando/picando
    const breakingThis = player.breaking && player.breaking.tx === d.tx && player.breaking.ty === d.ty;
    const shakeX = breakingThis ? Math.round(Math.sin(G.elapsed * 42) * 2) : 0;
    const dx = Math.round(cx - img.width / 2) + shakeX;
    const dy = Math.round(cy + lift - img.height);
    // rim light frío de luna en objetos altos sólidos (separa del fondo de noche);
    // se dibuja DENTRO de la cizalla del viento para que el filo se mueva con la copa
    const rimI = (CFG.GFX >= 2 && def.solid && d.id !== O.WALLW && d.id !== O.WALLS && img.height >= 20)
      ? 0.3 * clamp((G.darkness - 0.4) / 0.6, 0, 1) : 0;
    // viento: la copa se inclina cizallando el sprite (base fija, cima mecida)
    const swayAmp = breakingThis ? 0 : (SWAY_AMP[d.id] || 0);
    if (swayAmp) {
      const sway = swayAmp * (1 + (G.windBoost || 0)) * windAt(d.tx, d.ty);
      // pivote redondeado: la base queda clavada al suelo (sin jitter sub-píxel vs la sombra)
      const bx = Math.round(cx) + shakeX, by = Math.round(cy + lift);
      g.save();
      g.translate(bx, by);
      g.transform(1, 0, -sway / img.height, 1, 0, 0);
      if (rimI) rimLight(g, img, dx - bx, dy - by, rimI);
      g.drawImage(img, dx - bx, dy - by);
      g.restore();
    } else {
      if (rimI) rimLight(g, img, dx, dy, rimI);
      g.drawImage(img, dx, dy);
    }

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
    const anim = {
      t: G.elapsed + player.x * 0.13, moving: player.moving, vx: player.velX, vy: player.velY,
      animT: player.animT, swingT: player.swingT, hurtT: player.hurtT,
      pickT: player.pickT || 0, dirFlash: player._dirFlash || 0,
      z: player.z || 0, vz: player.vz || 0, landT: player.landT || 0, grounded: player.grounded,
    };
    // estelas (afterimages) cian en salto/ataque/carrera — siluetas cacheadas, mezcla aditiva
    if (player._trail && player._trail.length && CFG.GFX >= 1 && !inWater) {
      const tset = Assets.player;
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < player._trail.length; i++) {
        const tr = player._trail[i];
        const tf = (tset[tr.dir] || tset.down)[tr.frameI] || tset.down[0];
        const tsx = w2sx(tr.x, tr.y) + ox, tsy = w2sy(tr.x, tr.y) + oy;
        g.globalAlpha = 0.03 + 0.10 * (i / player._trail.length);
        g.drawImage(silTinted(tf, '#8ce6ff'),
          Math.round(tsx - tf.width / 2), Math.round(tsy - tf.height + 2 - (tr.z || 0) * CFG.ZK));
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    drawHero(g, Assets.player, player.dir, player.frameI, sx, sy,
      player.swingT, sel && ITEMS[sel.id].tool ? sel.id : null, inWater, anim);
    return;
  }

  if (d.type === 'rplayer') {
    const rp = d.rp;
    const sx = w2sx(rp.px, rp.py) + ox;
    const sy = w2sy(rp.px, rp.py) + oy;
    const inWater = world.ground(Math.floor(rp.px), Math.floor(rp.py)) === T.WATER;
    // estado de animación derivado de la posición INTERPOLADA (sin tocar el
    // protocolo): velocidad ≈ delta de posición → "anda" continuo (sin parpadeo
    // por paquete) e inclinación; el frame 5 sintetiza un swingT para el recoil.
    const pvx = (rp._ppx === undefined ? rp.px : rp.px - rp._ppx);
    const pvy = (rp._ppy === undefined ? rp.py : rp.py - rp._ppy);
    rp._ppx = rp.px; rp._ppy = rp.py;
    const rmoving = (pvx * pvx + pvy * pvy) > 2.5e-6 || (rp.frameI >= 1 && rp.frameI <= 4);
    const ranim = {
      t: G.elapsed + rp.px * 0.13,
      moving: rmoving, animT: G.elapsed + rp.px * 0.37 + rp.py * 0.21,  // fase por jugador
      vx: pvx * 60, vy: pvy * 60,
      swingT: rp.frameI === 5 ? 0.1 : 0,
    };
    drawHero(g, getHeroLookSet(rp.look), rp.dir, rp.frameI, sx, sy, ranim.swingT, null, inWater, ranim);
    return;
  }

  if (d.type === 'npc') {
    const n = d.n;
    const sx = w2sx(n.x, n.y) + ox;
    const sy = w2sy(n.x, n.y) + oy;
    // gesto ocioso por oficio (role) y respiración por su reloj n.t; el bote del
    // andar usa n.animT (mismo reloj que el frame de piernas) para ir en fase
    const nanim = { t: n.t, moving: n.moving, animT: n.animT, role: n.role };
    drawHero(g, getHeroLookSet(n.look), n.dir, n.frameI, sx, sy, 0, null, false, nanim);
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
    // squash & stretch por tipo (pivote en la base del sprite): da vida sin arte nuevo
    let sxs = 1, sys = 1;
    if (m.kind === 'slime') {
      if (m.hopping > 0) { const air = Math.sin((0.34 - m.hopping) / 0.34 * Math.PI); sys = 1 + air * 0.16; sxs = 1 - air * 0.13; }
      else { const j = Math.sin(m.t * 3); sys = 1 + j * 0.06; sxs = 1 - j * 0.06; }   // jelly en reposo
    } else if (m.kind === 'bat') {
      sxs = 1 + Math.sin(m.t * 9) * 0.16;                                              // alas que baten ensanchando
    } else if (m.kind === 'shadow') {
      sys = 1 + Math.sin(m.t * 2.5) * 0.06; sxs = 1 - Math.sin(m.t * 2.5 + 1) * 0.05;  // ondula como humo
    } else {
      sys = 1 + Math.sin(m.t * 2.2) * 0.03;                                            // fauna: respiración
    }
    g.globalAlpha = alpha;
    g.save();
    g.translate(Math.round(sx), Math.round(sy + 4 - yoff));   // base del sprite (incluye salto/vuelo)
    g.scale(m.flip ? -sxs : sxs, sys);
    g.drawImage(img, -Math.round(img.width / 2), -img.height);
    g.restore();
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

// Motas de polen/polvo a contraluz, solo de día. Derivan despacio y orbitan
// con la cámara (parallax suave) para sentirse parte del mundo.
function drawDayMotes(g, W, H, ox, oy) {
  const day = clamp(1 - G.darkness / 0.6, 0, 1);
  if (day < 0.06) return;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 22; i++) {
    const driftX = G.elapsed * (0.012 + hash2(i, 1, 5) * 0.018) + ox * 0.00045;
    const driftY = Math.sin(G.elapsed * 0.25 + i) * 0.03 + oy * 0.00045;
    const mx = (((hash2(i, 2, 5) + driftX) % 1) + 1) % 1;
    const my = (((hash2(i, 3, 5) + driftY) % 1) + 1) % 1;
    const x = (mx * W) | 0, y = (my * H * 0.85) | 0;
    const a = day * (0.08 + 0.09 * Math.abs(Math.sin(G.elapsed * 0.7 + i * 1.6)));
    g.fillStyle = 'rgba(255,250,222,' + a.toFixed(3) + ')';
    g.fillRect(x, y, 1, 1);
    if (hash2(i, 4, 5) < 0.28) g.fillRect(x + 1, y, 1, 1);
  }
  g.globalCompositeOperation = 'source-over';
}

// Luciérnagas: puntos verde-amarillos que vagan y parpadean (noche cerrada).
function drawFireflies(g, W, H, sa) {
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 20; i++) {
    const px = (((hash2(i, 1, 9) + Math.sin(G.elapsed * (0.14 + hash2(i, 2, 9) * 0.18) + i) * 0.06) % 1) + 1) % 1;
    const py = (((hash2(i, 3, 9) + Math.cos(G.elapsed * (0.11 + hash2(i, 4, 9) * 0.18) + i * 1.7) * 0.05) % 1) + 1) % 1;
    const x = px * W, y = py * H * 0.88 + H * 0.06;
    const blink = Math.max(0, Math.sin(G.elapsed * (1.1 + hash2(i, 5, 9)) + i * 2.1));
    const a = sa * blink * 0.8;
    if (a < 0.02) continue;
    const r = 5;
    g.globalAlpha = a;                        // el sprite trae el centro a 0.5: a*0.5 al modular
    g.drawImage(fireflyGlow(), x - r, y - r);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(222,255,170,' + a.toFixed(3) + ')';
    g.fillRect(x | 0, y | 0, 1, 1);
  }
  g.globalCompositeOperation = 'source-over';
}

// Ascuas que ascienden y se apagan sobre fuegos, hornos, braseros y antorchas.
function drawEmbers(g, lights) {
  g.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    if (!l.warm) continue;
    for (let k = 0; k < 4; k++) {
      const ph = ((G.elapsed * (0.5 + hash2(k, 1, 3) * 0.4) + hash2(k, 5, 3)) % 1);
      // fase por índice k + radio de la luz (estable): NO usar l.x (deriva con la cámara)
      const ex = l.x + Math.sin(G.elapsed * 2.2 + k * 1.7 + l.r * 0.13) * 6;
      const ey = l.y - 6 - ph * 28;
      const a = (1 - ph) * 0.5 * G.darkness;
      if (a < 0.02) continue;
      g.fillStyle = 'rgba(255,' + (150 + ((hash2(k, 2, 3) * 80) | 0)) + ',60,' + a.toFixed(3) + ')';
      g.fillRect(ex | 0, ey | 0, 1, hash2(k, 3, 3) < 0.3 ? 2 : 1);
    }
  }
  g.globalCompositeOperation = 'source-over';
}

// Lluvia/nieve a pantalla completa + velo de cielo encapotado + relámpago.
function drawWeather(g, W, H) {
  const I = G.weatherI;
  if (I > 0.01) {
    if (G.weather === 'snow') {
      drawSnow(g, W, H, I);
    } else {
      g.fillStyle = 'rgba(58,68,92,' + (0.20 * I * (1 - G.darkness * 0.7)).toFixed(3) + ')';
      g.fillRect(0, 0, W, H);
      drawRain(g, W, H, I, G.weather === 'storm');
    }
  }
  if (G.flash > 0.01) {
    // pico saturado a 1 (el exceso del disparo a 1.35 actúa como rampa de subida)
    g.fillStyle = 'rgba(222,228,255,' + (0.42 * Math.min(1, G.flash)).toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
  }
}

function drawRain(g, W, H, I, storm) {
  const n = Math.floor((storm ? 330 : 215) * I);
  const len = storm ? 17 : 13, slant = storm ? 7 : 4, fall = storm ? 1.35 : 1.05;
  g.strokeStyle = storm ? 'rgba(182,202,238,0.62)' : 'rgba(192,212,240,0.52)';
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const sp = 0.8 + hash2(i, 5, 4) * 0.5;
    const p = (((G.elapsed * fall * sp + hash2(i, 3, 4)) % 1) + 1) % 1;
    const y = p * (H + 30) - 15;
    let x = (hash2(i, 2, 4) * W + p * slant * 6) % W;
    if (x < 0) x += W;
    g.moveTo(x, y);
    g.lineTo(x - slant, y + len);
  }
  g.stroke();
}

function drawSnow(g, W, H, I) {
  const n = Math.floor(130 * I);
  g.fillStyle = 'rgba(248,251,255,' + (0.85 * I).toFixed(3) + ')';
  for (let i = 0; i < n; i++) {
    const s = 0.4 + hash2(i, 5, 6) * 0.5;
    const p = (((G.elapsed * 0.11 * s + hash2(i, 3, 6)) % 1) + 1) % 1;
    const y = p * (H + 20) - 10;
    const sway = Math.sin(G.elapsed * (0.5 + s) + i * 1.3) * 13;
    let x = (hash2(i, 2, 6) * W + sway) % W;
    if (x < 0) x += W;
    const sz = hash2(i, 4, 6) < 0.28 ? 2 : 1;
    g.fillRect(x | 0, y | 0, sz, sz);
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
