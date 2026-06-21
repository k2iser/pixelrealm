'use strict';
/* ============ Generación procedural de TODO el pixel art ============
   No hay ni un solo asset externo: cada sprite se dibuja píxel a píxel
   en canvas fuera de pantalla al arrancar el juego.

   El héroe se dibuja a doble densidad (28x40) y se reduce a la mitad con
   suavizado: conserva la escala del mundo pero con un acabado mucho más
   fino y animación de 4 pasos. El resto del mundo mantiene el píxel gordo. */

const Assets = {
  tiles: {},      // T.* -> [variantes/frames]
  fringe: {},     // T.* -> [4 bordes] para transiciones suaves entre biomas
  obj: {},        // O.* -> canvas | [frames/variantes]
  player: null,   // set del héroe por defecto: { down: [6], up: [6], left: [6], right: [6] }
  heroSets: {},   // color de camiseta -> set (para jugadores remotos)
  mobs: {},       // slime: [3], shadow: [2], bat: [2]
  boss: [],       // [normal, aplastado, salto]
  items: {},      // id de item -> canvas
  arrow: null,
  heart: null, heartHalf: null, heartEmpty: null,
  sun: null, moon: null,
  _icons: {},     // id -> dataURL para la UI
};

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

// Sprite desde una rejilla de texto: cada carácter es un color de la paleta,
// '.' o espacio es transparente. Las filas pueden tener longitudes distintas.
function gridSprite(rows, pal) {
  const w = Math.max(...rows.map(r => r.length)), h = rows.length;
  const [c, g] = cv(w, h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// Escalado entero sin suavizado: conserva el pixel art
function scaleSprite(c, k) {
  const [s, g] = cv(c.width * k, c.height * k);
  g.drawImage(c, 0, 0, c.width * k, c.height * k);
  return s;
}

// Reducción con suavizado: para el héroe HD y los iconos en miniatura
function scaleSmooth(c, w, h) {
  const [s, g] = cv(w, h);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, w, h);
  return s;
}

// Oscurece un color hex multiplicando sus canales
function darken(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Sombra con cambio de matiz (técnica clásica de pixel art): además de
// oscurecer, empuja el color hacia el azul-violeta. Los brillos, hacia el cálido.
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) * f * 0.88, g = ((n >> 8) & 255) * f * 0.95, b = (n & 255) * f * 1.12 + 14;
  r = Math.min(255, Math.round(r)); g = Math.min(255, Math.round(g)); b = Math.min(255, Math.round(b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
function glow(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) * f * 1.1 + 10, g = ((n >> 8) & 255) * f * 1.05 + 6, b = (n & 255) * f * 0.92;
  r = Math.min(255, Math.round(r)); g = Math.min(255, Math.round(g)); b = Math.min(255, Math.round(b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Contorno selectivo: añade un borde oscuro-violáceo alrededor de la silueta
// (el truco que hace que los personajes de Stardew "se despeguen" del fondo)
function outlineSprite(c, color) {
  const w = c.width, h = c.height;
  const g = c.getContext('2d');
  const src = g.getImageData(0, 0, w, h);
  const out = g.createImageData(w, h);
  const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : src.data[(y * w + x) * 4 + 3];
  const n = parseInt(color.slice(1), 16);
  const cr = (n >> 16) & 255, cg = (n >> 8) & 255, cb = n & 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src.data[i + 3] > 0) {
        out.data[i] = src.data[i]; out.data[i + 1] = src.data[i + 1];
        out.data[i + 2] = src.data[i + 2]; out.data[i + 3] = src.data[i + 3];
      } else if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) {
        out.data[i] = cr; out.data[i + 1] = cg; out.data[i + 2] = cb; out.data[i + 3] = 235;
      }
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

// Icono 12x12 a partir de un sprite grande (para inventario)
function spriteIcon(c) {
  const k = Math.min(12 / c.width, 12 / c.height);
  const w = Math.max(1, Math.round(c.width * k)), h = Math.max(1, Math.round(c.height * k));
  const [s, g] = cv(12, 12);
  g.imageSmoothingEnabled = true;
  g.drawImage(c, Math.floor((12 - w) / 2), Math.floor((12 - h) / 2), w, h);
  return s;
}

/* ================= suelos ================= */

function makeGroundTile(base, dark, light, seed) {
  const W = CFG.TW, H = CFG.TH, cx = W / 2 - 0.5, cy = H / 2 - 0.5;
  const [c, g] = cv(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.abs(x - cx) / (W / 2), dy = Math.abs(y - cy) / (H / 2);
      if (dx + dy > 1.04) continue;
      const r = hash2(x * 7 + 13, y * 13 + 5, seed);
      let col = base;
      if (r < 0.11) col = dark;
      else if (r > 0.89) col = light;
      // borde inferior con dithering muy sutil: relieve sin marcar rejilla
      if (y > H / 2 - 1 && dx + dy > 0.96 && r < 0.5) col = dark;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// Hierba con matas y florecillas (clusters al estilo Slynyrd):
// variantes que el renderer elige por hash de casilla -> pradera orgánica
function makeGrassTile(seed) {
  const c = makeGroundTile('#468232', '#25562e', '#75a743', seed);
  const g = c.getContext('2d');
  const W = CFG.TW, H = CFG.TH;
  const cx = W / 2 - 0.5, cy = H / 2 - 0.5;
  const tufts = 4 + Math.floor(hash2(seed, 77, 9) * 5);
  for (let i = 0; i < tufts; i++) {
    const x = 6 + Math.floor(hash2(seed, i * 31, 1) * (W - 12));
    const y = 3 + Math.floor(hash2(seed, i * 31, 2) * (H - 7));
    const dx = Math.abs(x - cx) / (W / 2), dy = Math.abs(y - cy) / (H / 2);
    if (dx + dy > 0.82) continue; // dentro del rombo, lejos del borde
    const r = hash2(seed, i * 31, 3);
    if (r < 0.08) {
      // florecilla
      g.fillStyle = r < 0.04 ? '#df84a5' : '#e8c170';
      g.fillRect(x, y, 1, 1);
    } else {
      // mata de hierba: 2-3 briznas verticales
      const tall = r < 0.5 ? 2 : 3;
      g.fillStyle = r < 0.6 ? '#75a743' : '#a8ca58';
      g.fillRect(x, y - tall + 1, 1, tall);
      g.fillStyle = '#25562e';
      g.fillRect(x + 1, y - tall + 2, 1, tall - 1);
      if (r > 0.75) { g.fillStyle = '#75a743'; g.fillRect(x - 1, y, 1, 1); }
    }
  }
  return c;
}

/* Transiciones entre biomas (auto-tiling estilo Stardew):
   cuando un material "domina" al vecino, su flequillo se derrama con
   dithering sobre el borde correspondiente del rombo vecino.
   Bordes: 0=NO (vecino tx-1), 1=NE (ty-1), 2=SE (tx+1), 3=SO (ty+1). */
function makeFringe(base, dark, edge, seed) {
  const W = CFG.TW, H = CFG.TH;
  const [c, g] = cv(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = Math.abs(x - (W / 2 - 0.5)) / (W / 2), cyv = Math.abs(y - (H / 2 - 0.5)) / (H / 2);
      if (cx + cyv > 1.04) continue;
      // coordenadas u,v dentro de la casilla (0..1 en ejes de mundo)
      const sxc = x - W / 2 + 0.5, syc = y + 0.5;
      const u = sxc / W + syc / H;
      const v = syc / H - sxc / W;
      let m; // distancia al borde invadido
      if (edge === 0) m = u;            // viene del oeste del mundo (arriba-izda en pantalla)
      else if (edge === 1) m = v;       // norte del mundo (arriba-dcha)
      else if (edge === 2) m = 1 - u;   // este (abajo-dcha)
      else m = 1 - v;                   // sur (abajo-izda)
      const r = hash2(x * 5 + 3, y * 11 + 7, seed + edge * 131);
      if (m < 0.10 + r * 0.16) {
        g.fillStyle = r < 0.25 ? dark : base;
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

// Prioridad de derrame: el mayor se come visualmente el borde del menor
const FRINGE_PRIORITY = {
  [T.TILLED]: 8, // tierra arada: nada se derrama sobre el cultivo
  [T.GRASS]: 7, [T.SNOW]: 6, [T.DIRT]: 5, [T.SAND]: 4,
  [T.STONE]: 3, [T.WATER]: 2, [T.DEEP]: 1, [T.FLOOR]: 0, // lo construido no se mezcla
};

function makeFloorTile(seed) {
  const base = '#c09473', dark = '#884b2b', light = '#d7b594';
  const W = CFG.TW, H = CFG.TH, cx = W / 2 - 0.5, cy = H / 2 - 0.5;
  const [c, g] = cv(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.abs(x - cx) / (W / 2), dy = Math.abs(y - cy) / (H / 2);
      if (dx + dy > 1.04) continue;
      let col = base;
      if (((x + 2 * y) % 16) < 2) col = dark;
      else if (hash2(x, y, seed) > 0.93) col = light;
      if (y > H / 2 - 1 && dx + dy > 0.9) col = dark;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// Tierra arada: surcos paralelos oscuros sobre tierra
function makeTilledTile(seed) {
  const base = '#7a4841', dark = '#5a3431', light = '#9a5a4a';
  const W = CFG.TW, H = CFG.TH, cx = W / 2 - 0.5, cy = H / 2 - 0.5;
  const [c, g] = cv(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.abs(x - cx) / (W / 2), dy = Math.abs(y - cy) / (H / 2);
      if (dx + dy > 1.04) continue;
      let col = base;
      if (((x - 2 * y) % 12 + 12) % 12 < 2) col = dark;        // surcos diagonales
      else if (hash2(x, y, seed) > 0.9) col = light;
      if (y > H / 2 - 1 && dx + dy > 0.9) col = dark;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function makeCube(topCols, leftCol, leftDark, rightCol, rightDark, seed, stripeEvery) {
  const W = CFG.TW, TH = CFG.TH, H = CFG.CUBE_H;
  const cx = W / 2 - 0.5, cy = TH / 2 - 0.5;
  const [c, g] = cv(W, TH + H);
  const bottom = new Array(W).fill(-1);
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.abs(x - cx) / (W / 2), dy = Math.abs(y - cy) / (TH / 2);
      if (dx + dy > 1.04) continue;
      const r = hash2(x, y, seed);
      g.fillStyle = r < 0.13 ? topCols[1] : (r > 0.9 ? topCols[2] : topCols[0]);
      g.fillRect(x, y, 1, 1);
      if (y > bottom[x]) bottom[x] = y;
    }
  }
  for (let x = 0; x < W; x++) {
    if (bottom[x] < 0) continue;
    const left = x < W / 2;
    for (let k = 1; k <= H; k++) {
      let col = left ? leftCol : rightCol;
      if (stripeEvery && x % stripeEvery <= 1 && (left ? x % stripeEvery === 0 : x % stripeEvery === 1)) {
        col = left ? leftDark : rightDark;
      }
      if (k >= H - 1 || hash2(x, k, seed + 9) < 0.06) col = left ? leftDark : rightDark;
      g.fillStyle = col;
      g.fillRect(x, bottom[x] + k, 1, 1);
    }
  }
  return c;
}

/* ================= héroe v3 =================
   Dibujado a 56x80 y reducido con suavizado a 28x40 (cuádruple densidad de
   píxel respecto al mundo). Parametrizado por el "look" del editor:
   { skin, hair (color), style (peinado), shirt, pants }.
   Poses: 0 quieto, 1-4 ciclo de andar (contacto, paso, contacto, paso), 5 ataque. */

// Paleta del héroe derivada del look (centralizada para frames planos y rig)
function heroPal(look) {
  const skin = HERO_SKINS[look.skin], hair = HERO_HAIRC[look.hair],
        shirt = HERO_COLORS[look.shirt], pants = HERO_PANTS[look.pants];
  return {
    skin, skinD: shade(skin, 0.85), skinL: glow(skin, 1.08),
    hair, hairL: glow(hair, 1.3), hairD: shade(hair, 0.72),
    shirt, shirtD: shade(shirt, 0.74), shirtL: glow(shirt, 1.14),
    pants, pantsD: shade(pants, 0.76),
    boots: '#5d4427', bootsD: shade('#5d4427', 0.74), belt: '#2a2018', buckle: '#e8c14d',
    cape: shade(shirt, 0.5), capeD: shade(shirt, 0.34), capeL: shade(shirt, 0.64),
    hood: hair, hoodD: shade(hair, 0.72), hoodL: glow(hair, 1.3),
    faceSh: shade(skin, 0.55),
    cuff: darken(shirt, 0.6),
  };
}
// Helpers de dibujo por PARTE (mismas R(...) de siempre). 'g' ya trae translate(0,18).
function _R(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x, y, w, h); }
function hpCape(g, dir, P, bob) {
  if (dir === 'up') {
    _R(g, 15, 28 + bob, 26, 42, P.cape); _R(g, 15, 28 + bob, 4, 42, P.capeD); _R(g, 37, 28 + bob, 4, 42, P.capeD);
    _R(g, 21, 30 + bob, 6, 32, P.capeL); _R(g, 15, 68 + bob, 5, 4, P.capeD); _R(g, 25, 70 + bob, 6, 3, P.capeD); _R(g, 35, 68 + bob, 5, 4, P.capeD);
  } else {
    _R(g, 16, 30 + bob, 24, 7, P.cape); _R(g, 16, 30 + bob, 4, 7, P.capeD); _R(g, 36, 30 + bob, 4, 7, P.capeD);
    _R(g, 13, 50 + bob, 6, 24, P.cape); _R(g, 37, 50 + bob, 6, 24, P.cape);
    _R(g, 13, 50 + bob, 2, 24, P.capeD); _R(g, 41, 50 + bob, 2, 24, P.capeD);
    _R(g, 13, 70 + bob, 6, 4, P.capeD); _R(g, 37, 70 + bob, 6, 4, P.capeD);
  }
}
function hpLeg(g, P, x, off) {   // una pierna (pantalón + bota) en columna x
  _R(g, x, 56 + off, 8, 14, P.pants); _R(g, x, 56 + off, 2, 14, P.pantsD);
  _R(g, x, 68 + off, 8, 8, P.boots); _R(g, x, 74 + off, 8, 2, P.bootsD); _R(g, x + 1, 69 + off, 3, 1, '#7a5e3a');
}
function hpTorso(g, P, bob) {
  _R(g, 14, 28 + bob, 28, 26, P.shirt); _R(g, 36, 28 + bob, 6, 26, P.shirtD); _R(g, 15, 29 + bob, 3, 24, P.shirtL);
  _R(g, 24, 28 + bob, 8, 3, P.shirtD); _R(g, 26, 31 + bob, 4, 2, P.skin); _R(g, 14, 50 + bob, 28, 4, P.shirtD);
  _R(g, 14, 46 + bob, 28, 2, P.belt); _R(g, 26, 46 + bob, 4, 2, P.buckle); _R(g, 26, 46 + bob, 1, 1, '#fff2b8');
}
function hpArm(g, P, x, off) {   // un brazo simple (no ataque) en columna x
  _R(g, x, 30 + off, 6, 22, P.shirtD); _R(g, x, 46 + off, 6, 6, P.skin); _R(g, x, 44 + off, 6, 1, P.cuff);
}
function hpArmsAttack(g, dir, P, bob) {
  if (dir === 'left') {
    _R(g, 0, 32 + bob, 16, 6, P.shirtD); _R(g, 0, 32 + bob, 6, 6, P.skin);
    _R(g, 42, 30 + bob, 6, 18, P.shirtD); _R(g, 42, 42 + bob, 6, 6, P.skin);
  } else if (dir === 'right') {
    _R(g, 40, 32 + bob, 16, 6, P.shirtD); _R(g, 50, 32 + bob, 6, 6, P.skin);
    _R(g, 8, 30 + bob, 6, 18, P.shirtD); _R(g, 8, 42 + bob, 6, 6, P.skin);
  } else if (dir === 'down') {
    _R(g, 8, 36 + bob, 6, 18, P.shirtD); _R(g, 8, 48 + bob, 6, 6, P.skin);
    _R(g, 42, 36 + bob, 6, 18, P.shirtD); _R(g, 42, 48 + bob, 6, 6, P.skin);
  } else {
    _R(g, 42, 16 + bob, 6, 18, P.shirtD); _R(g, 42, 16 + bob, 6, 6, P.skin);
    _R(g, 8, 30 + bob, 6, 18, P.shirtD); _R(g, 8, 42 + bob, 6, 6, P.skin);
  }
}
function hpHead(g, dir, P, bob) {
  const EYE = '#79e0ff', EYEC = '#ecffff';
  if (dir === 'up') {
    _R(g, 16, 2 + bob, 24, 22, P.hood); _R(g, 16, 2 + bob, 24, 3, P.hoodD);
    _R(g, 20, 4 + bob, 11, 2, P.hoodL); _R(g, 16, 21 + bob, 24, 3, P.hoodD); _R(g, 24, 24 + bob, 8, 2, P.skinD);
  } else {
    _R(g, 17, 11 + bob, 22, 15, P.faceSh); _R(g, 18, 24 + bob, 18, 2, P.skinD); _R(g, 24, 26 + bob, 8, 2, P.skinD);
    _R(g, 15, 1 + bob, 26, 11, P.hood); _R(g, 15, 1 + bob, 26, 2, P.hoodL);
    _R(g, 15, 3 + bob, 3, 22, P.hood); _R(g, 38, 3 + bob, 3, 22, P.hood);
    _R(g, 15, 3 + bob, 2, 22, P.hoodD); _R(g, 39, 3 + bob, 2, 22, P.hoodD);
    _R(g, 16, 11 + bob, 24, 2, P.hoodD);
    if (dir === 'down') {
      _R(g, 37, 9 + bob, 4, 5, P.hoodD);
      _R(g, 20, 15 + bob, 4, 3, EYE); _R(g, 21, 15 + bob, 2, 2, EYEC);
      _R(g, 32, 15 + bob, 4, 3, EYE); _R(g, 33, 15 + bob, 2, 2, EYEC);
    } else if (dir === 'left') {
      _R(g, 15, 5 + bob, 9, 6, P.hood); _R(g, 15, 5 + bob, 9, 2, P.hoodL);
      _R(g, 18, 15 + bob, 4, 3, EYE); _R(g, 19, 15 + bob, 2, 2, EYEC);
    } else {
      _R(g, 32, 5 + bob, 9, 6, P.hood); _R(g, 32, 5 + bob, 9, 2, P.hoodL);
      _R(g, 34, 15 + bob, 4, 3, EYE); _R(g, 35, 15 + bob, 2, 2, EYEC);
    }
  }
}

function makeHeroFrame(dir, pose, look) {
  const [hi, g] = cv(56, 96);   // +16px de cabecera (capa al viento, pelo, pose de salto, estelas)
  const P = heroPal(look);
  g.translate(0, 18); // baja el contenido para dejar 16px de cabecera y mantener los pies abajo

  let lLeg = 0, rLeg = 0, lArm = 0, rArm = 0, bob = 0;
  if (pose === 1) { lLeg = -4; lArm = 4; rArm = -4; }
  else if (pose === 3) { rLeg = -4; lArm = -4; rArm = 4; }
  else if (pose === 2 || pose === 4) { bob = -2; }
  else if (pose === 6) { lLeg = -7; rLeg = -5; lArm = -4; rArm = -4; bob = -1; }  // salto

  hpCape(g, dir, P, bob);
  hpLeg(g, P, 18, lLeg); hpLeg(g, P, 30, rLeg);
  hpTorso(g, P, bob);
  if (pose === 5) hpArmsAttack(g, dir, P, bob);
  else { hpArm(g, P, 8, bob + lArm); hpArm(g, P, 42, bob + rArm); }
  hpHead(g, dir, P, bob);

  outlineSprite(hi, '#241a2e');
  return scaleSmooth(hi, 28, 48);
}

// --- RIG 2D: piezas sueltas del héroe para animación articulada en tiempo real ---
// Cada pieza es un lienzo 56x96 (sin contorno ni escala: el contorno se aplica
// UNA vez al cuerpo ya ensamblado). Pivotes = articulación con el cuerpo (coords
// del lienzo 56x96, ya con el translate(0,18) aplicado).
const RIG_PIVOTS = {
  cape: [28, 48], torso: [28, 58], head: [28, 44],
  legL: [22, 74], legR: [34, 74], armL: [11, 48], armR: [45, 48],
};
function bakeHeroParts(dir, look) {
  const P = heroPal(look);
  const mk = (fn) => { const [c, g] = cv(56, 96); g.translate(0, 18); fn(g); return c; };
  return {
    cape: mk(g => hpCape(g, dir, P, 0)),
    legL: mk(g => hpLeg(g, P, 18, 0)),
    legR: mk(g => hpLeg(g, P, 30, 0)),
    torso: mk(g => hpTorso(g, P, 0)),
    head: mk(g => hpHead(g, dir, P, 0)),
    armL: mk(g => hpArm(g, P, 8, 0)),
    armR: mk(g => hpArm(g, P, 42, 0)),
  };
}

// Set completo del héroe para un look (cacheado; los looks vienen saneados)
function getHeroLookSet(rawLook) {
  const look = clampLook(rawLook);
  const key = 's' + look.skin + 'h' + look.hair + 'y' + look.style + 'c' + look.shirt + 'p' + look.pants;
  if (Assets.heroSets[key]) return Assets.heroSets[key];
  const set = { rig: {}, _key: key };
  for (const dir of ['down', 'up', 'left', 'right']) {
    set[dir] = [0, 1, 2, 3, 4, 5, 6].map(p => makeHeroFrame(dir, p, look));
    set.rig[dir] = bakeHeroParts(dir, look);
  }
  Assets.heroSets[key] = set;
  return set;
}

/* ================= enemigos ================= */

// Baba: contorno oscuro, brillo grande, boca; tres poses
function makeSlimeFrame(f) {
  const [c, g] = cv(16, 13);
  const edge = '#2e7a22', body = '#5fd44a', dark = '#3da32f', shine = '#c8f7b0', eye = '#16321a';
  let w, h;
  if (f === 0) { w = 12; h = 9; }
  else if (f === 1) { w = 14; h = 7; }
  else { w = 10; h = 11; }
  const x0 = Math.floor((16 - w) / 2), y0 = 13 - h;
  const inside = (x, y) => {
    const cx = (w - 1) / 2, cy2 = (h - 1) / 2;
    return ((x - cx) * (x - cx)) / (cx * cx) + ((y - cy2) * (y - cy2)) / (cy2 * cy2 + 1) <= 1.15;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    let col = body;
    const border = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    if (border) col = edge;
    else if (y >= h - 3 || x >= w - 3) col = dark;
    g.fillStyle = col;
    g.fillRect(x0 + x, y0 + y, 1, 1);
  }
  g.fillStyle = shine;
  g.fillRect(x0 + 2, y0 + 1, 3, 2); g.fillRect(x0 + 2, y0 + 3, 1, 1);
  const ey = y0 + Math.floor(h / 2) - 1;
  g.fillStyle = eye;
  g.fillRect(x0 + Math.floor(w / 2) - 3, ey, 2, 2);
  g.fillRect(x0 + Math.floor(w / 2) + 2, ey, 2, 2);
  g.fillRect(x0 + Math.floor(w / 2) - 1, ey + 3, 3, 1); // boca
  return scaleSprite(c, CFG.SPR);
}

// El Coloso de Baba: una baba gigante con corona
function makeBossFrame(f) {
  const [c, g] = cv(38, 32);
  const edge = '#1f6b16', body = '#4ec23e', dark = '#2e8f25', shine = '#b8f0a0',
        eye = '#0e2a0a', gold = '#e8c14d', goldD = '#b8901e', gem = '#d83434';
  let w, h;
  if (f === 0) { w = 30; h = 22; }
  else if (f === 1) { w = 34; h = 18; }
  else { w = 26; h = 26; }
  const x0 = Math.floor((38 - w) / 2), y0 = 32 - h;
  const inside = (x, y) => {
    const cx = (w - 1) / 2, cy2 = (h - 1) / 2;
    return ((x - cx) * (x - cx)) / (cx * cx) + ((y - cy2) * (y - cy2)) / (cy2 * cy2 + 1) <= 1.15;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    let col = body;
    const border = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    if (border) col = edge;
    else if (y >= h - 5 || x >= w - 5) col = dark;
    g.fillStyle = col;
    g.fillRect(x0 + x, y0 + y, 1, 1);
  }
  g.fillStyle = shine;
  g.fillRect(x0 + 4, y0 + 2, 6, 3); g.fillRect(x0 + 4, y0 + 5, 3, 2);
  // ojos furiosos (inclinados) y boca
  const ey = y0 + Math.floor(h / 2) - 2, mx = x0 + Math.floor(w / 2);
  g.fillStyle = eye;
  g.fillRect(mx - 8, ey, 4, 2); g.fillRect(mx - 7, ey - 1, 3, 1);
  g.fillRect(mx + 4, ey, 4, 2); g.fillRect(mx + 4, ey - 1, 3, 1);
  g.fillRect(mx - 4, ey + 5, 8, 2);
  g.fillRect(mx - 5, ey + 4, 1, 1); g.fillRect(mx + 4, ey + 4, 1, 1);
  // corona (clavada en lo alto, se inclina al saltar)
  const crx = mx - 6, cry = y0 - 4;
  g.fillStyle = gold;
  g.fillRect(crx, cry + 3, 12, 3);
  g.fillRect(crx, cry, 2, 3); g.fillRect(crx + 5, cry, 2, 3); g.fillRect(crx + 10, cry, 2, 3);
  g.fillStyle = goldD;
  g.fillRect(crx, cry + 5, 12, 1);
  g.fillStyle = gem;
  g.fillRect(crx + 5, cry + 4, 2, 1);
  return scaleSprite(c, 6); // el Coloso conserva su escala imponente con el zoom nuevo
}

const SHADOW_PAL = { S: '#262138', M: '#332c4d', W: '#494066', E: '#cfd6ff' };
const SHADOW_A = [
  '....SSSSSS',
  '...SSSSSSSS',
  '..SSMSSSSMSS',
  '..SSSSSSSSSS',
  '..SEESSSSEES',
  '..SEESSSSEES',
  '..SSSSMSSSSS',
  '...SSSSSSSS',
  '...SMSSSSMS',
  '...SSSSSSSS',
  '..SSSSMSSSS',
  '..SSSSSSSSS',
  '..WSSSSSSSW',
  '...SSSMSSS',
  '...SS.SSSS',
  '..SS..SS.S',
  '..S...SS..S',
  '..S....S..S',
  '.......S',
];
const SHADOW_B = [
  '....SSSSSS',
  '...SSSSSSSS',
  '..SSMSSSSMSS',
  '..SSSSSSSSSS',
  '..SEESSSSEES',
  '..SEESSSSEES',
  '..SSSSMSSSSS',
  '...SSSSSSSS',
  '...SMSSSSMS',
  '...SSSSSSSS',
  '..SSSSMSSSS',
  '..SSSSSSSSS',
  '..WSSSSSSSW',
  '...SSSMSSS',
  '...SSSS.SS',
  '..S.SS..SS',
  '..S..S...S',
  '......S..S',
  '...S...',
];

const BAT_PAL = { B: '#3a2f52', W: '#56487a', w: '#473a63', E: '#ffd34d', o: '#241c38' };
const BAT_UP = [
  '.W......W',
  'WWW....WWW',
  'WWWW..WWWW',
  '.WWWooWWW',
  '..WoBBoW',
  '...oBBBBo'.replace('....', ''),
  '..oBEBBEBo',
  '...oBBBBo',
  '....oBo',
];
const BAT_DOWN = [
  '....oBo',
  '...oBBBBo',
  '..oBEBBEBo',
  '..woBBBBow',
  '.wwWoBBoWww',
  'wWWW.oo.WWWw',
  'WWW......WWW',
  '.W........W',
];

/* ================= vegetación ================= */

function buildVegetation() {
  // Árbol frondoso: 5 tonos + variante con frutas
  const tp = { H: '#a8ca58', L: '#75a743', G: '#468232', D: '#25562e', E: '#19332d',
               T: '#884b2b', t: '#4d2b32', a: '#cf573c' };
  const treeRows = (fruit) => [
    '........HHHH',
    '......HHLLLLH',
    '.....HLLLGGLLG',
    '....LLGGGG' + (fruit ? 'a' : 'G') + 'GGLL',
    '...LGGGGLGGGGGGL',
    '..LGGGLGGGGGLGGGD',
    '..GG' + (fruit ? 'a' : 'L') + 'GGGGGGGGGGGD',
    '.LGGGGGGGLGGGGGGGD',
    '.GGLGGGGGGGGG' + (fruit ? 'a' : 'L') + 'GGDD',
    '.GGGGGLGGGGGGGGGDD',
    '..DGGGG' + (fruit ? 'a' : 'G') + 'GGLGGGDDE',
    '..DDGGLGGGGGGDDE',
    '...EDDGGGGDDDEE',
    '....EDDDDDDEE',
    '......EEEEE',
    '.........tTT',
    '.........tTT',
    '.........tTT',
    '........ttTTt',
    '.......ttTTTTt',
  ];
  const treeA = scaleSprite(outlineSprite(gridSprite(treeRows(false), tp), '#1c2912'), CFG.SPR);
  const treeB = scaleSprite(outlineSprite(gridSprite(treeRows(true), tp), '#1c2912'), CFG.SPR);
  Assets.obj[O.TREE] = [treeA, treeA, treeA, treeB]; // 1 de cada 4 con fruta

  // Pino de tres pisos con nieve en la punta
  const pp = { A: '#468232', B: '#25562e', C: '#19332d', S: '#ebede9', T: '#884b2b', t: '#4d2b32' };
  const pineRows = (snowy) => [
    '........' + (snowy ? 'SS' : 'AA'),
    '.......' + (snowy ? 'SSSS' : 'ABBA'),
    '......A' + (snowy ? 'SSS' : 'BBB') + 'BA',
    '.....AABBBBAA',
    '......ABBBBC',
    '.....AABBBBCA',
    '....AABBBBBBAC',
    '...AAABBBBBBACC',
    '.....ABBBBBC',
    '....AABBBBBBC',
    '...AABBBBBBBCC',
    '..AABBBBBBBBACC',
    '.AAABBBBBBBBAACC',
    '........tT',
    '........tT',
    '.......ttTT',
  ];
  Assets.obj[O.PINE] = [
    scaleSprite(outlineSprite(gridSprite(pineRows(true), pp), '#13241a'), CFG.SPR),
    scaleSprite(outlineSprite(gridSprite(pineRows(false), pp), '#13241a'), CFG.SPR),
  ];

  const cactusPal = { C: '#75a743', c: '#468232', F: '#df84a5' };
  Assets.obj[O.CACTUS] = scaleSprite(gridSprite([
    '.....cF',
    '....cCCc',
    '....cCCc',
    '.cc.cCCc.cc',
    '.cC.cCCc.Cc',
    '.cC.cCCc.Cc',
    '.cCccCCccCc',
    '.cCCCCCCCCc',
    '..cccCCccc',
    '....cCCc',
    '....cCCc',
    '....cCCc',
    '....cCCc',
    '...ccCCcc',
  ], cactusPal), CFG.SPR);

  const rockPal = { s: '#394a50', S: '#819796', W: '#a8b5b2', d: '#577277' };
  Assets.obj[O.ROCK] = scaleSprite(gridSprite([
    '......ssss',
    '....ssSSSSs',
    '...sSSWWSSSs',
    '..sSWWWSSSSSs',
    '.sSSWWSSSSSSds',
    '.sSSSSSSSSdSds',
    'sSSSSSSSSSSdds',
    'sSSSSSSSdddds',
    '.sddSSSdddds',
    '..ssddddddss',
  ], rockPal), CFG.SPR);

  Assets.obj[O.FLOWER] = [
    scaleSprite(gridSprite([
      '...RR',
      '..RrrR',
      '..RrrR',
      '...RR',
      '....g',
      '....g',
      '..g.g',
      '...gg',
      '....g',
    ], { R: '#a53030', r: '#cf573c', g: '#25562e' }), 2),
    scaleSprite(gridSprite([
      '...YY',
      '..YyyY',
      '..YyyY',
      '...YY',
      '....g',
      '....g',
      '..g.g',
      '...gg',
      '....g',
    ], { Y: '#de9e41', y: '#e8c170', g: '#25562e' }), 2),
  ];

  Assets.obj[O.TALLGRASS] = scaleSprite(gridSprite([
    '.g...G...g',
    '.g..gg..G',
    '..G.g..gg',
    '..g.gG.g',
    '...gGg.g',
    '...gggG',
    '....gg',
    '....gG',
  ], { g: '#75a743', G: '#468232' }), 2);

  Assets.obj[O.BUSH] = scaleSprite(gridSprite([
    '....gggg',
    '..ggGGGGgg',
    '.gGGRGGGGRGg',
    '.gGGGGRGGGGg',
    'gGRGGGGGGRGGg',
    'gGGGGRGGGGGGg',
    '.gGGGGGGRGGg',
    '..ggGGGGgg',
    '....gggg',
  ], { g: '#25562e', G: '#468232', R: '#a53030' }), CFG.SPR);
}

/* ================= construcciones ================= */

function makeHut() {
  const [c, g] = cv(32, 27);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // paredes de troncos
  R(4, 12, 24, 13, '#a87b4f');
  for (let y = 14; y < 25; y += 3) R(4, y, 24, 1, '#8a5f38');
  R(4, 12, 1, 13, '#8a5f38'); R(27, 12, 1, 13, '#7a5230');
  // tejado a dos aguas
  for (let y = 0; y < 11; y++) {
    const half = 2 + Math.round(y * 1.35);
    R(16 - half, y, half * 2, 1, y === 0 ? '#d8804e' : (y % 3 === 0 ? '#8a4a2e' : '#b06038'));
  }
  R(2, 11, 28, 2, '#6b3a22'); // alero
  // puerta con pomo
  R(13, 17, 6, 8, '#4a2f18');
  R(13, 17, 6, 1, '#6b4226'); R(13, 17, 1, 8, '#6b4226'); R(18, 17, 1, 8, '#6b4226');
  R(17, 21, 1, 1, '#e8c14d');
  // ventanas cálidas con cruceta
  for (const wx of [7, 22]) {
    R(wx, 15, 4, 4, '#ffd98a');
    R(wx, 15, 4, 1, '#6b4226'); R(wx, 18, 4, 1, '#6b4226');
    R(wx + 2, 15, 1, 4, '#6b4226');
  }
  // zócalo de piedra
  R(3, 25, 26, 2, '#8c8c94');
  for (let x = 4; x < 28; x += 3) R(x, 26, 1, 1, '#62626c');
  return scaleSprite(c, CFG.SPR);
}

function makeTower() {
  const [c, g] = cv(16, 30);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // fuste de piedra
  R(3, 9, 10, 18, '#8c8c94');
  R(11, 9, 2, 18, '#6e6e78');
  for (let y = 10; y < 26; y += 2) {
    for (let x = 4; x < 12; x += 3) R(x + (y % 4 === 0 ? 1 : 0), y, 1, 1, '#787882');
  }
  // base ensanchada
  R(2, 26, 12, 3, '#787882'); R(2, 28, 12, 1, '#5e5e66');
  // plataforma de madera con almenas
  R(1, 6, 14, 3, '#a87b4f'); R(1, 8, 14, 1, '#7a5635');
  R(1, 4, 3, 2, '#8c8c94'); R(6, 4, 4, 2, '#8c8c94'); R(12, 4, 3, 2, '#8c8c94');
  // tronera
  R(7, 14, 2, 5, '#1d1812');
  // estandarte
  R(7, 0, 1, 4, '#6b4226');
  R(8, 0, 4, 2, '#c4344c'); R(8, 2, 2, 1, '#c4344c');
  return scaleSprite(c, CFG.SPR);
}

function makeSawmill() {
  const [c, g] = cv(32, 23);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // tejado inclinado
  for (let i = 0; i < 7; i++) R(2 + i * 2, 6 - i, 26 - i * 2, 1, i % 2 ? '#8a4a2e' : '#b06038');
  R(2, 7, 26, 1, '#6b3a22');
  // postes
  R(3, 8, 2, 14, '#6b4226'); R(26, 8, 2, 14, '#6b4226'); R(15, 8, 2, 14, '#7a5230');
  // sierra circular
  const sx = 21, sy = 16;
  for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
    const d = x * x + y * y;
    if (d > 30) continue;
    let col = '#9fa6ad';
    if (d > 22) col = (x + y) % 2 ? '#7c838a' : '#c2c9d0'; // dientes
    else if (d < 3) col = '#4e545a';
    g.fillStyle = col;
    g.fillRect(sx + x, sy + y, 1, 1);
  }
  // pila de troncos
  for (const [lx, ly] of [[6, 18], [10, 18], [8, 15]]) {
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
      if (x * x + y * y > 6) continue;
      g.fillStyle = (x === 0 && y === 0) ? '#d2a767' : (x * x + y * y > 3 ? '#6b4226' : '#8a5a33');
      g.fillRect(lx + x, ly + y, 1, 1);
    }
  }
  // suelo
  R(2, 21, 28, 2, '#74512f');
  return scaleSprite(c, CFG.SPR);
}

function makeQuarry() {
  const [c, g] = cv(32, 21);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // foso
  R(4, 12, 24, 8, '#5e5e66');
  R(6, 14, 20, 5, '#494950');
  // bloques de piedra apilados
  for (const [bx, by] of [[2, 9], [7, 8], [25, 9], [21, 7]]) {
    R(bx, by, 5, 4, '#8c8c94'); R(bx, by + 3, 5, 1, '#62626c'); R(bx, by, 5, 1, '#a2a2ac');
  }
  // pórtico de madera con polea
  R(10, 0, 2, 14, '#6b4226'); R(20, 0, 2, 14, '#6b4226');
  R(9, 0, 14, 2, '#8a5a33');
  R(15, 2, 1, 6, '#3a3a42'); // cuerda
  R(14, 8, 3, 2, '#e8c14d'); // gancho
  // pico apoyado
  R(27, 13, 1, 6, '#8a5a33');
  R(25, 12, 5, 1, '#9a9aa4');
  return scaleSprite(c, CFG.SPR);
}

function makeFarm() {
  const [c, g] = cv(32, 19);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // tierra labrada
  R(2, 6, 28, 12, '#74512f');
  for (let y = 7; y < 17; y += 3) R(2, y, 28, 1, '#5e3f22');
  // brotes con bayas
  for (let i = 0; i < 9; i++) {
    const px = 4 + (i % 3) * 9 + ((i / 3) | 0) * 2, py = 7 + ((i / 3) | 0) * 3;
    g.fillStyle = '#4e9a3d'; g.fillRect(px, py, 2, 2); g.fillRect(px + 1, py - 1, 1, 1);
    if (i % 2 === 0) { g.fillStyle = '#c4344c'; g.fillRect(px + 2, py, 1, 1); }
  }
  // valla
  for (let x = 1; x < 31; x += 4) R(x, 2, 1, 5, '#8a5a33');
  R(1, 3, 30, 1, '#a87b4f'); R(1, 5, 30, 1, '#a87b4f');
  return scaleSprite(c, CFG.SPR);
}

function makeBrazier(frame) {
  const [c, g] = cv(12, 17);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // llama (dos poses)
  const fp = { f: '#ff8c2e', F: '#ffb347', Y: '#ffe28a' };
  const flame = frame === 0 ? [
    '....ff',
    '...fFYf',
    '..fFYYf',
    '..FYYYF',
    '...FYF',
  ] : [
    '.....ff',
    '..ffYFf',
    '..fFYYF',
    '..FYYYf',
    '...FYF',
  ];
  const fc = gridSprite(flame, fp);
  g.drawImage(fc, 1, 0);
  // copa de piedra
  R(2, 5, 8, 2, '#a2a2ac');
  R(3, 7, 6, 2, '#8c8c94');
  R(4, 9, 4, 4, '#787882');
  R(3, 13, 6, 1, '#8c8c94');
  R(2, 14, 8, 2, '#787882');
  R(2, 15, 8, 1, '#5e5e66');
  return scaleSprite(c, CFG.SPR);
}

function makeAltar(frame) {
  const [c, g] = cv(32, 25);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // gradas de piedra oscura
  R(2, 21, 28, 4, '#3a3a46'); R(2, 21, 28, 1, '#4e4e5c');
  R(5, 18, 22, 3, '#444452'); R(5, 18, 22, 1, '#585866');
  // monolito
  R(12, 2, 8, 16, '#2e2e3a');
  R(12, 2, 8, 1, '#444452');
  R(12, 2, 1, 16, '#444452'); R(19, 2, 1, 16, '#1e1e28');
  // runas brillantes
  const runa = frame === 0 ? '#a070ff' : '#d0b0ff';
  g.fillStyle = runa;
  g.fillRect(14, 4, 1, 2); g.fillRect(16, 4, 2, 1);
  g.fillRect(15, 7, 2, 1); g.fillRect(14, 9, 1, 2); g.fillRect(17, 9, 1, 1);
  g.fillRect(15, 12, 2, 2); g.fillRect(14, 15, 3, 1);
  // chispas flotando
  if (frame === 1) {
    g.fillRect(9, 6, 1, 1); g.fillRect(22, 9, 1, 1); g.fillRect(10, 14, 1, 1);
  } else {
    g.fillRect(23, 5, 1, 1); g.fillRect(8, 10, 1, 1); g.fillRect(21, 15, 1, 1);
  }
  // velas a los lados
  for (const vx of [6, 24]) {
    R(vx, 15, 2, 3, '#d8d0b8');
    g.fillStyle = '#ffb347'; g.fillRect(vx, 14, 1, 1);
  }
  return scaleSprite(c, CFG.SPR);
}

// Pozo de aldea: brocal de piedra, tejadillo de madera y un cubo colgando
function makeWell() {
  const [c, g] = cv(20, 24);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // postes y tejadillo
  R(4, 4, 2, 9, '#884b2b'); R(14, 4, 2, 9, '#884b2b');
  for (let i = 0; i < 5; i++) R(2 + i, 4 - Math.floor(i / 2), 16 - i * 2 + (i % 2), 1, i % 2 ? '#7a4841' : '#a23e3c');
  R(2, 1, 16, 2, '#a23e3c'); R(8, 0, 4, 1, '#cf573c');
  // cuerda + cubo
  R(9, 5, 1, 5, '#3a3a42');
  R(8, 10, 4, 3, '#884b2b'); R(8, 10, 4, 1, '#a87b4f');
  // brocal de piedra (boca oscura con agua)
  R(3, 14, 14, 8, '#819796'); R(3, 14, 14, 1, '#a8b5b2');
  R(5, 15, 10, 5, '#1a2a3a'); R(6, 16, 8, 3, '#3c5e8b'); // agua
  R(6, 16, 3, 1, '#73bed3');
  R(3, 21, 14, 2, '#577277');
  for (let x = 4; x < 17; x += 3) R(x, 20, 1, 2, '#394a50'); // junta de piedras
  return scaleSprite(c, CFG.SPR);
}

// Horno de piedra con la boca al rojo (dos frames de brasa)
function makeFurnace(frame) {
  const [c, g] = cv(18, 22);
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  // cuerpo de piedra
  R(2, 4, 14, 17, '#577277');
  R(2, 4, 14, 1, '#819796');
  R(14, 5, 2, 16, '#394a50');
  for (let y = 6; y < 20; y += 3) for (let x = 3; x < 14; x += 4) R(x + (y % 6 ? 1 : 0), y, 1, 1, '#46565b');
  // chimenea
  R(4, 1, 4, 4, '#46565b'); R(4, 1, 4, 1, '#6e8085');
  // boca con brasa
  R(5, 11, 8, 7, '#1a1014');
  const fp = frame === 0
    ? ['..ff..', '.fFYFf', 'fFYYYF', '.FYYF.']
    : ['.ff...', 'fFYFf.', 'FYYYFf', '.FYYF.'];
  const fire = gridSprite(fp, { f: '#cf573c', F: '#de9e41', Y: '#e8c14d' });
  g.drawImage(fire, 6, 12);
  R(4, 18, 10, 3, '#46565b'); R(4, 20, 10, 1, '#2a363b'); // base
  return scaleSprite(c, CFG.SPR);
}

/* ================= items ================= */

function buildItems() {
  const it = Assets.items;
  const firePal = { f: '#ff8c2e', F: '#ffb347', Y: '#ffe28a', B: '#8a5a33', b: '#6b4226', s: '#8c8c94' };

  it.wood = gridSprite([
    '....bbbb',
    '..bbBBBBbb',
    '.bBBwwwwBBb',
    '.bBwwBBwwBb',
    '.bBwBBBBwBb',
    '.bBwwBBwwBb',
    '.bBBwwwwBBb',
    '..bbBBBBbb',
    '....bbbb',
  ], { b: '#5d4427', B: '#8a5a33', w: '#d2a767' });

  it.stone = gridSprite([
    '...sssss',
    '..sSSSSSs',
    '.sSSWWSSSs',
    '.sSWWSSSSs',
    '.sSSSSSSSs',
    '.sSSSSSdSs',
    '..sSSSSds',
    '...ddddd',
  ], { s: '#55555e', S: '#8c8c94', W: '#b8b8c2', d: '#5e5e66' });

  it.coal = gridSprite([
    '..kkk',
    '.kKKKk',
    'kKKkKKk',
    'kKkKKKk',
    'kKKKkKk',
    '.kKKKk',
    '..kkk',
  ], { k: '#16181d', K: '#3a3f47' });

  it.iron_ore = gridSprite([
    '...sss',
    '..sSoSs',
    '.sSoSSos',
    '.soSSSoS',
    '.sSSoSSs',
    '..sSSss',
    '...sss',
  ], { s: '#3a3228', S: '#6e6052', o: '#d89a5a' });

  it.iron = gridSprite([
    '.WWWWWWW',
    'WSSSSSSSd',
    'WSWWWWSSd',
    'WSSSSSSSd',
    '.dddddddd',
  ], { W: '#c8d0d8', S: '#9aa6b0', d: '#5a646e' });

  it.meat = gridSprite([
    '...WW',
    '..WRRW',
    '.WRRRRW',
    'WRRRRRR',
    'WRRRRRb',
    '.WRRRb.',
    '..WRb..',
  ], { R: '#d06a6a', W: '#e8a0a0', b: '#e8e0d4' });

  it.cooked_meat = gridSprite([
    '...kk',
    '..kBBk',
    '.kBBBBk',
    'kBBBBBB',
    'kBBBBBW',
    '.kBBBW.',
    '..kBW..',
  ], { B: '#8a4f2c', k: '#4d2b1c', W: '#e8e0d4' });

  it.fiber = gridSprite([
    '..g..g..g',
    '..g.gg..g',
    '..gg.g.gg',
    '...g.ggg',
    '...gggg',
    '....gg',
    '....gg',
    '....gg',
  ], { g: '#7fc95e' });

  it.berry = gridSprite([
    '....gg',
    '...gg',
    '..RRR..RR',
    '.RRrRR.RrR',
    '.RrRRR.RRR',
    '.RRRRR',
    '..RRR..RR',
    '.......RR',
  ], { R: '#c4344c', r: '#f08a9a', g: '#3c8534' });

  it.slime = gridSprite([
    '.....ss',
    '....ssss',
    '...ssSSss',
    '..ssSSSSss',
    '..sSSWWSSs',
    '..sSSSSSSs',
    '...ssSSss',
    '....ssss',
  ], { s: '#3da32f', S: '#5fd44a', W: '#c8f7b0' });

  it.essence = gridSprite([
    '.....pp',
    '....pPPp',
    '...pPWPPp',
    '...pPPWPp',
    '...pPPPPp',
    '....pPPp',
    '....pPp',
    '.....pp',
    '....pp',
    '.....p',
  ], { p: '#6a4fa0', P: '#9a7fd0', W: '#e0d4ff' });

  it.crown = gridSprite([
    '.G...G...G',
    '.GG..GG..GG',
    '.GGG.GGG.GG',
    '.GGGGGGGGGG',
    '.GgGGrGGgGG',
    '.GGGGGGGGGG',
    '.dddddddddd',
  ], { G: '#e8c14d', g: '#7be37b', r: '#d83434', d: '#b8901e' });

  it.seeds = gridSprite([
    '.b..b.',
    'bBb.bBb',
    '.b.b.b',
    '..bBb.',
    '.bBb..',
    '..b...',
  ], { b: '#7a4841', B: '#c89b62' });

  it.hoe = gridSprite([
    '......ss',
    '.....sSSs',
    '.....sSs',
    '....bs',
    '...b',
    '..b',
    '.b',
    'b',
  ], { s: '#9fa8b0', S: '#d8e0e8', b: '#6b4226' });

  it.coin = gridSprite([
    '..ggg',
    '.gYYYg',
    'gYWYYYg',
    'gYYdYYg',
    'gYYYWYg',
    '.gYYYg',
    '..ggg',
  ], { g: '#b8901e', Y: '#e8c14d', W: '#fff2b8', d: '#b8901e' });

  it.plank = gridSprite([
    '.pppppppppp',
    '.pPPPPPPPPd',
    '.pPPdPPPPPd',
    '.pddddddddd',
    '.pPPPPPdPPd',
    '.pPPPPPPPPd',
    '.dddddddddd',
  ], { p: '#c89b62', P: '#a87b4f', d: '#7a5635' });

  it.stick = gridSprite([
    '.........bb',
    '........bBb',
    '.......bBb',
    '......bBb',
    '.....bBb',
    '....bBb',
    '...bBb',
    '..bBb',
    '.bBb',
    '.bb',
  ], { B: '#a87b4f', b: '#6b4226' });

  // herramientas v2: cabezas más grandes, contorno y brillo
  const toolPal = { o: '#1d1812', S: '#9fa8b0', W: '#d8e0e8', s: '#6e767e',
                    B: '#a87b4f', b: '#6b4226', g: '#e8c14d', G: '#b8901e' };
  it.axe = gridSprite([
    '.....ooo',
    '....oSWWo',
    '...oSSWWWo',
    '...oSSSWWo',
    '...obSSSWo',
    '..obBboSo',
    '.obBbo.o',
    'obBbo',
    'oBbo',
    'obo',
  ], toolPal);

  it.pick = gridSprite([
    '...ooooo',
    '..oSWWWSo',
    '.oWo...oWo',
    '.oSo.oo.oSo',
    '.oo.obBo.oo',
    '....obBbo',
    '...obBbo',
    '..obBbo',
    '.obBbo',
    '.oBbo',
    '.obo',
  ], toolPal);

  it.sword = gridSprite([
    '.........oo',
    '........oWWo',
    '.......oWWSo',
    '......oWWSo',
    '.....oWWSo',
    '..o.oWWSo',
    '.ogooWSo',
    '..oggSo',
    '..oGgo',
    '.oboGgo',
    '.obo..o',
    '..o',
  ], toolPal);

  // herramientas de hierro: misma forma, hoja azul-acero y mango oscuro
  const ironPal = { o: '#10141f', S: '#6e8aa6', W: '#bcd0e4', s: '#46566a',
                    B: '#5a646e', b: '#2a323c', g: '#e8c14d', G: '#b8901e' };
  it.iron_axe = gridSprite([
    '.....ooo', '....oSWWo', '...oSSWWWo', '...oSSSWWo', '...obSSSWo',
    '..obBboSo', '.obBbo.o', 'obBbo', 'oBbo', 'obo',
  ], ironPal);
  it.iron_pick = gridSprite([
    '...ooooo', '..oSWWWSo', '.oWo...oWo', '.oSo.oo.oSo', '.oo.obBo.oo',
    '....obBbo', '...obBbo', '..obBbo', '.obBbo', '.oBbo', '.obo',
  ], ironPal);
  it.iron_sword = gridSprite([
    '.........oo', '........oWWo', '.......oWWSo', '......oWWSo', '.....oWWSo',
    '..o.oWWSo', '.ogooWSo', '..oggSo', '..oGgo', '.oboGgo', '.obo..o', '..o',
  ], ironPal);

  it.torch = gridSprite([
    '.....ff',
    '....fFFf',
    '....FYYF',
    '.....YY',
    '....bBBb',
    '.....BB',
    '.....BB',
    '.....BB',
    '.....bb',
  ], firePal);

  it.campfire = gridSprite([
    '.....ff',
    '....fFYf',
    '...fFYYFf',
    '....FYYF',
    '..bBBBBBBb',
    '.sBbBBbBBs',
    '..ss.ss.ss',
  ], firePal);

  it.wallw = gridSprite([
    '.pppppppppp',
    '.pPPPPdPPPd',
    '.pPPPPdPPPd',
    '.pddddddddd',
    '.pPPdPPPPPd',
    '.pPPdPPPPPd',
    '.pddddddddd',
    '.pPPPPdPPPd',
    '.dddddddddd',
  ], { p: '#c89b62', P: '#a87b4f', d: '#7a5635' });

  it.walls = gridSprite([
    '.ssssssssss',
    '.sSSSdSSSSd',
    '.sSSSdSSSSd',
    '.sddddddddd',
    '.sSdSSSSdSd',
    '.sSdSSSSdSd',
    '.sddddddddd',
    '.sSSSdSSSSd',
    '.dddddddddd',
  ], { s: '#a2a2ac', S: '#8c8c94', d: '#646470' });

  // iconos de edificios: miniatura del propio sprite
  it.hut = spriteIcon(Assets.obj[O.HUT]);
  it.tower = spriteIcon(Assets.obj[O.TOWER]);
  it.sawmill = spriteIcon(Assets.obj[O.SAWMILL]);
  it.quarry = spriteIcon(Assets.obj[O.QUARRY]);
  it.farm = spriteIcon(Assets.obj[O.FARM]);
  it.brazier = spriteIcon(Assets.obj[O.BRAZIER][0]);
  it.altar = spriteIcon(Assets.obj[O.ALTAR][0]);
  it.furnace = spriteIcon(Assets.obj[O.FURNACE][0]);
}

/* ================= construcción de todo ================= */

function buildAssets() {
  // suelos — rampas de la paleta Apollo (lospec.com/palette-list/apollo)
  const tiles = Assets.tiles;
  tiles[T.DEEP]  = [1, 2].map(s => makeGroundTile('#253a5e', '#172038', '#3c5e8b', s));
  tiles[T.WATER] = [3, 4].map(s => makeGroundTile('#4f8fba', '#3c5e8b', '#73bed3', s));
  tiles[T.SAND]  = [5, 6, 7].map(s => makeGroundTile('#e8c170', '#de9e41', '#e7d5b3', s));
  tiles[T.GRASS] = [8, 9, 10, 11].map(s => makeGrassTile(s));
  tiles[T.DIRT]  = [12, 13, 14].map(s => makeGroundTile('#ad7757', '#7a4841', '#c09473', s));
  tiles[T.STONE] = [15, 16, 17].map(s => makeGroundTile('#577277', '#394a50', '#819796', s));
  tiles[T.SNOW]  = [18, 19, 20].map(s => makeGroundTile('#ebede9', '#c7cfcc', '#ffffff', s));
  tiles[T.FLOOR] = [21, 22].map(s => makeFloorTile(s));
  tiles[T.TILLED] = [23, 24].map(s => makeTilledTile(s));

  // flecos de transición entre biomas (auto-tiling)
  const fringeCols = {
    [T.GRASS]: ['#468232', '#25562e'],
    [T.SNOW]:  ['#ebede9', '#c7cfcc'],
    [T.DIRT]:  ['#ad7757', '#7a4841'],
    [T.SAND]:  ['#e8c170', '#de9e41'],
    [T.STONE]: ['#577277', '#394a50'],
    [T.WATER]: ['#4f8fba', '#3c5e8b'],  // suaviza la orilla del mar profundo
  };
  for (const t in fringeCols) {
    Assets.fringe[t] = [0, 1, 2, 3].map(e => makeFringe(fringeCols[t][0], fringeCols[t][1], e, 400 + (+t)));
  }

  buildVegetation();

  // muros
  Assets.obj[O.WALLW] = makeCube(
    ['#c09473', '#884b2b', '#d7b594'], '#ad7757', '#7a4841', '#c09473', '#884b2b', 31, 8);
  Assets.obj[O.WALLS] = makeCube(
    ['#819796', '#577277', '#a8b5b2'], '#577277', '#394a50', '#6b8489', '#4a5e63', 32, 0);

  // antorcha y fogata
  const firePal = { f: '#cf573c', F: '#de9e41', Y: '#e8c170', B: '#884b2b', b: '#4d2b32', s: '#819796' };
  Assets.obj[O.TORCH] = [
    gridSprite([
      '...ff',
      '..fFYf',
      '..FYYF',
      '...YY',
      '..bBBb',
      '...BB',
      '...BB',
      '...BB',
      '...BB',
      '...bb',
    ], firePal),
    gridSprite([
      '....ff',
      '..fYFf',
      '..FYYF',
      '...YY',
      '..bBBb',
      '...BB',
      '...BB',
      '...BB',
      '...BB',
      '...bb',
    ], firePal),
  ].map(c => scaleSprite(c, CFG.SPR));

  Assets.obj[O.FIRE] = [
    gridSprite([
      '........ff',
      '.......fFYf',
      '......fFYYf',
      '.....fFYYYFf',
      '......FYYF',
      '....bBBYYBBb',
      '..bBBbBBBBbBBb',
      '.sBBbBBBBBBbBBs',
      '..ss..ssss..ss',
    ], firePal),
    gridSprite([
      '.......ff',
      '......fYFf',
      '......fFYYff',
      '.....fFYYYFf',
      '......FYYF',
      '....bBBYYBBb',
      '..bBBbBBBBbBBb',
      '.sBBbBBBBBBbBBs',
      '..ss..ssss..ss',
    ], firePal),
  ].map(c => scaleSprite(c, CFG.SPR));

  // construcciones
  Assets.obj[O.HUT] = makeHut();
  Assets.obj[O.TOWER] = makeTower();
  Assets.obj[O.SAWMILL] = makeSawmill();
  Assets.obj[O.QUARRY] = makeQuarry();
  Assets.obj[O.FARM] = makeFarm();
  Assets.obj[O.BRAZIER] = [makeBrazier(0), makeBrazier(1)];
  Assets.obj[O.ALTAR] = [makeAltar(0), makeAltar(1)];
  Assets.obj[O.WELL] = makeWell();
  // vetas de mineral (roca con motas) y horno
  const oreRows = (k) => [
    '......ssss',
    '....ssSSSSs',
    '...sSS' + k + 'WSSSs',
    '..sSWWWSS' + k + 'SSs',
    '.sSSWW' + k + 'SSSSSds',
    '.sSS' + k + 'SSSSSdSds',
    'sSSSSSSS' + k + 'SSdds',
    'sSSSS' + k + 'SSdddds',
    '.sddSSSdddds',
    '..ssddddddss',
  ];
  Assets.obj[O.ROCK_COAL] = scaleSprite(gridSprite(oreRows('k'),
    { s: '#394a50', S: '#577277', W: '#819796', d: '#2a363b', k: '#16181d' }), CFG.SPR);
  Assets.obj[O.ROCK_IRON] = scaleSprite(gridSprite(oreRows('k'),
    { s: '#4a4036', S: '#6e6052', W: '#9a8a74', d: '#3a3228', k: '#c08552' }), CFG.SPR);
  Assets.obj[O.FURNACE] = [makeFurnace(0), makeFurnace(1)];
  // cultivo: 4 fases (brote → plantón → cultivo → maduro con bayas)
  const cropPal = { g: '#75a743', G: '#468232', d: '#25562e', R: '#a53030', r: '#cf573c', t: '#7a4841' };
  Assets.obj[O.CROP0] = scaleSprite(gridSprite([
    '....',
    '..g.',
    '.gt.',
    '.tt.',
  ], cropPal), CFG.SPR);
  Assets.obj[O.CROP1] = scaleSprite(gridSprite([
    '..g..',
    '.gGg.',
    '..G..',
    '..t..',
    '.ttt.',
  ], cropPal), CFG.SPR);
  Assets.obj[O.CROP2] = scaleSprite(gridSprite([
    '.g.g.g',
    'gGgGgG',
    '.GGGG.',
    '..GG..',
    '..dd..',
    '.tddt.',
  ], cropPal), CFG.SPR);
  Assets.obj[O.CROP3] = scaleSprite(gridSprite([
    '.g.g.g',
    'gGRGRG',
    'RGGGGR',
    '.GRRG.',
    '..GG..',
    '.tddt.',
  ], cropPal), CFG.SPR);
  Assets.obj[O.PART] = null; // invisible: lo dibuja su ancla

  // héroe por defecto y enemigos
  Assets.player = getHeroLookSet(DEFAULT_LOOK);
  Assets.mobs.slime = [0, 1, 2].map(makeSlimeFrame);
  Assets.mobs.shadow = [SHADOW_A, SHADOW_B].map(r => scaleSprite(outlineSprite(gridSprite(r, SHADOW_PAL), '#15101f'), CFG.SPR));
  Assets.mobs.bat = [BAT_UP, BAT_DOWN].map(r => scaleSprite(outlineSprite(gridSprite(r, BAT_PAL), '#15101f'), CFG.SPR));
  // fauna: conejo (2 frames: quieto/salto) y ciervo (quieto/paso)
  const rabPal = { B: '#c6b8a8', b: '#9a8a78', W: '#e8e0d4', e: '#2a2028', n: '#df84a5' };
  Assets.mobs.rabbit = [
    ['..b....', '.bb..bb', '.Bb..Bb', '.BB..BB', 'bBBBBBb', 'BBWeWBB', 'BBBnBBB', '.bBBBb.', '..b.b..'],
    ['.b.....', 'bb.b...', 'Bb.Bb..', 'BBbBBb.', 'bBBBBBb', 'BBWeWBB', 'BBBnBBB', '.bBBBbb', '..b..b.'],
  ].map(r => scaleSprite(outlineSprite(gridSprite(r, rabPal), '#3a2e30'), CFG.SPR));
  const deerPal = { B: '#a87344', b: '#7a4f2c', W: '#e7d5b3', e: '#241812', a: '#cfc0a8', n: '#1a120c' };
  const deerRows = (step) => [
    '......aa.aa',
    '.......aaa.',
    '......WBBW.',
    '......BeBB.',
    '......BBnB.',
    '.....BBBB..',
    '..BBBBBBB..',
    '.BBBBBBBBB.',
    'bBBBBBBBBBb',
    'bBBBBBBBBBb',
    '.BBBBBBBBB.',
    step ? '.b.bb.bb.b' : '.bb.bb.bb.',
    step ? '.b..b.b..b' : '.b.b..b.b.',
  ];
  Assets.mobs.deer = [deerRows(0), deerRows(1)].map(r => scaleSprite(outlineSprite(gridSprite(r, deerPal), '#2a1c12'), CFG.SPR));
  Assets.boss = [0, 1, 2].map(makeBossFrame);

  // flecha de las torres
  Assets.arrow = scaleSprite(gridSprite([
    '.bBBWW',
    'fbBBWWW',
    '.bBBWW',
  ], { f: '#c4344c', b: '#6b4226', B: '#a87b4f', W: '#dfe7ee' }), 2);

  buildItems();

  // HUD
  const heartPal = { R: '#d83434', r: '#f08a8a', E: '#3a2b2b', e: '#52403c' };
  Assets.heart = gridSprite([
    '.RR.RR',
    'RrRRRRR',
    'RRRRRRR',
    '.RRRRR',
    '..RRR',
    '...R',
  ], heartPal);
  Assets.heartHalf = gridSprite([
    '.RR.EE',
    'RrRREEE',
    'RRRREEE',
    '.RRREE',
    '..RRE',
    '...R',
  ], heartPal);
  Assets.heartEmpty = gridSprite([
    '.EE.EE',
    'EeEEEEE',
    'EEEEEEE',
    '.EEEEE',
    '..EEE',
    '...E',
  ], heartPal);

  Assets.sun = gridSprite([
    '....yyyy',
    '...yYYYYy',
    '..yYYWWYYy',
    '..yYWWWWYy',
    '..yYWWWWYy',
    '..yYYWWYYy',
    '...yYYYYy',
    '....yyyy',
  ], { y: '#e8a51e', Y: '#ffd34d', W: '#fff2b8' });

  Assets.moon = gridSprite([
    '....mmmm',
    '...mMMMMm',
    '..mMMmm',
    '..mMMm',
    '..mMMm',
    '..mMMmm',
    '...mMMMMm',
    '....mmmm',
  ], { M: '#dfe7f2', m: '#9fb0c8' });
}

/* ================= packs de texturas =================
   Arte externo opcional sin tocar el código: si existe textures/pack.json
   (+ atlas PNG), sus frames sustituyen al arte procedural. Si no, el juego
   se dibuja solo, como siempre. Formato de clave:
     tile.grass.0 · fringe.grass.0-3 · obj.tree.0 · item.axe · mob.slime.0 · boss.0
   Cada frame: { "x":0, "y":0, "w":64, "h":32 } en píxeles del atlas. */

const TEX_T = { deep: T.DEEP, water: T.WATER, sand: T.SAND, grass: T.GRASS, dirt: T.DIRT, stone: T.STONE, snow: T.SNOW, floor: T.FLOOR };
const TEX_O = { tree: O.TREE, pine: O.PINE, cactus: O.CACTUS, rock: O.ROCK, flower: O.FLOWER, tallgrass: O.TALLGRASS, bush: O.BUSH,
                wallw: O.WALLW, walls: O.WALLS, torch: O.TORCH, fire: O.FIRE,
                hut: O.HUT, tower: O.TOWER, sawmill: O.SAWMILL, quarry: O.QUARRY, farm: O.FARM, brazier: O.BRAZIER, altar: O.ALTAR, well: O.WELL };

async function loadTexturePack() {
  if (!location.protocol.startsWith('http')) return;
  let pack, img;
  try {
    const res = await fetch('textures/pack.json', { cache: 'no-cache' });
    if (!res.ok) return;
    pack = await res.json();
    img = new Image();
    img.src = 'textures/' + (pack.image || 'pack.png');
    await img.decode();
  } catch (e) { return; } // sin pack: arte procedural
  try {
    applyTexturePack(pack, img);
    if (typeof UI !== 'undefined') UI.toast('Texturas «' + (pack.name || 'pack') + '» cargadas');
  } catch (e) {
    console.warn('Pack de texturas inválido:', e);
  }
}

function applyTexturePack(pack, img) {
  const cut = fr => {
    const f = fr.frame || fr; // compatible con free-tex-packer/TexturePacker ({frame:{x,y,w,h}})
    const [c, g] = cv(f.w, f.h);
    g.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    return c;
  };
  const setIdx = (arr, idx, canvas) => {
    if (!Array.isArray(arr)) return [canvas];
    if (idx == null || idx === '') return [canvas];
    arr[Math.min(arr.length - 1, Math.max(0, idx | 0))] = canvas;
    return arr;
  };
  for (const key in pack.frames || {}) {
    const f = pack.frames[key];
    const fd = (f && f.frame) || f;
    if (!fd || !(fd.w > 0) || !(fd.h > 0)) continue;
    const [kind, name, idx] = key.split('.');
    if (kind === 'tile' && TEX_T[name] != null) {
      Assets.tiles[TEX_T[name]] = setIdx(Assets.tiles[TEX_T[name]], idx, cut(f));
    } else if (kind === 'fringe' && TEX_T[name] != null && Assets.fringe[TEX_T[name]]) {
      Assets.fringe[TEX_T[name]] = setIdx(Assets.fringe[TEX_T[name]], idx, cut(f));
    } else if (kind === 'obj' && TEX_O[name] != null) {
      const cur = Assets.obj[TEX_O[name]];
      Assets.obj[TEX_O[name]] = Array.isArray(cur) ? setIdx(cur, idx, cut(f)) : cut(f);
    } else if (kind === 'item' && Assets.items[name]) {
      Assets.items[name] = cut(f);
      delete Assets._icons[name]; // regenerar el icono de la UI
    } else if (kind === 'mob' && Assets.mobs[name]) {
      Assets.mobs[name] = setIdx(Assets.mobs[name], idx, cut(f));
    } else if (kind === 'boss') {
      Assets.boss = setIdx(Assets.boss, name, cut(f)); // boss.0/1/2
    }
  }
}

// DataURL (cacheada) del icono de un item, para usar en la UI con <img>
function iconURL(id) {
  if (!Assets._icons[id]) {
    const src = Assets.items[id];
    if (!src) return '';
    Assets._icons[id] = src.toDataURL();
  }
  return Assets._icons[id];
}
