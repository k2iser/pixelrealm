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
  [T.GRASS]: 7, [T.SNOW]: 6, [T.DIRT]: 5, [T.SAND]: 4,
  [T.STONE]: 3, [T.WATER]: 2, [T.DEEP]: 1, [T.FLOOR]: 0, // lo construido no se mezcla
};

function makeFloorTile(seed) {
  const base = '#a87b4f', dark = '#7a5635', light = '#c89b62';
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

function makeHeroFrame(dir, pose, look) {
  const [hi, g] = cv(56, 80);
  // sombras con matiz desplazado al azul y brillos cálidos (pixel art clásico)
  const skin = HERO_SKINS[look.skin], skinD = shade(skin, 0.85), skinL = glow(skin, 1.08),
        hair = HERO_HAIRC[look.hair], hairL = glow(hair, 1.3), hairD = shade(hair, 0.72),
        shirt = HERO_COLORS[look.shirt], shirtD = shade(shirt, 0.74), shirtL = glow(shirt, 1.14),
        pants = HERO_PANTS[look.pants], pantsD = shade(pants, 0.76),
        boots = '#5d4427', bootsD = shade('#5d4427', 0.74), belt = '#2a2018',
        buckle = '#e8c14d', eyeW = '#f4f4f8', eye = '#20202e';
  const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };

  let lLeg = 0, rLeg = 0, lArm = 0, rArm = 0, bob = 0;
  if (pose === 1) { lLeg = -4; lArm = 4; rArm = -4; }
  else if (pose === 3) { rLeg = -4; lArm = -4; rArm = 4; }
  else if (pose === 2 || pose === 4) { bob = -2; }

  // --- piernas y botas ---
  R(18, 56 + lLeg, 8, 14, pants); R(18, 56 + lLeg, 2, 14, pantsD);
  R(18, 68 + lLeg, 8, 8, boots); R(18, 74 + lLeg, 8, 2, bootsD); R(19, 69 + lLeg, 3, 1, '#7a5e3a');
  R(30, 56 + rLeg, 8, 14, pants); R(36, 56 + rLeg, 2, 14, pantsD);
  R(30, 68 + rLeg, 8, 8, boots); R(30, 74 + rLeg, 8, 2, bootsD); R(31, 69 + rLeg, 3, 1, '#7a5e3a');

  // --- torso ---
  R(14, 28 + bob, 28, 26, shirt);
  R(36, 28 + bob, 6, 26, shirtD);                 // sombreado lateral (matiz frío)
  R(15, 29 + bob, 3, 24, shirtL);                 // luz cálida del otro lado
  R(24, 28 + bob, 8, 3, shirtD);                  // cuello en V
  R(26, 31 + bob, 4, 2, skin);                    // escote
  R(14, 50 + bob, 28, 4, shirtD);                 // bajo de la túnica
  R(14, 46 + bob, 28, 2, belt);
  R(26, 46 + bob, 4, 2, buckle); R(26, 46 + bob, 1, 1, '#fff2b8');

  // --- brazos ---
  if (pose === 5) {
    if (dir === 'left') {
      R(0, 32 + bob, 16, 6, shirtD); R(0, 32 + bob, 6, 6, skin);
      R(42, 30 + bob, 6, 18, shirtD); R(42, 42 + bob, 6, 6, skin);
    } else if (dir === 'right') {
      R(40, 32 + bob, 16, 6, shirtD); R(50, 32 + bob, 6, 6, skin);
      R(8, 30 + bob, 6, 18, shirtD); R(8, 42 + bob, 6, 6, skin);
    } else if (dir === 'down') {
      R(8, 36 + bob, 6, 18, shirtD); R(8, 48 + bob, 6, 6, skin);
      R(42, 36 + bob, 6, 18, shirtD); R(42, 48 + bob, 6, 6, skin);
    } else {
      R(42, 16 + bob, 6, 18, shirtD); R(42, 16 + bob, 6, 6, skin);
      R(8, 30 + bob, 6, 18, shirtD); R(8, 42 + bob, 6, 6, skin);
    }
  } else {
    R(8, 30 + bob + lArm, 6, 22, shirtD);
    R(8, 46 + bob + lArm, 6, 6, skin);
    R(8, 44 + bob + lArm, 6, 1, darken(shirt, 0.6));   // puño de la manga
    R(42, 30 + bob + rArm, 6, 22, shirtD);
    R(42, 46 + bob + rArm, 6, 6, skin);
    R(42, 44 + bob + rArm, 6, 1, darken(shirt, 0.6));
  }

  // --- cabeza ---
  const hairTop = look.style === 2 ? 4 : 0;       // rapado: nacimiento más alto
  R(18, bob, 20, 2, hair);
  R(16, 2 + bob, 24, 10 - hairTop, hair);
  R(16, 2 + bob, 24, 2, hairD);                   // raíz con sombra
  R(18, 3 + bob, 10, 2, hairL);                   // brillo
  R(20, 6 + bob, 4, 1, hairL);                    // mechón
  R(31, 7 + bob, 3, 1, hairD);                    // mechón oscuro
  R(16, 12 + bob, 24, 14, skin);                  // cara
  R(17, 13 + bob, 4, 6, skinL);                   // luz en el pómulo
  R(18, 24 + bob, 20, 2, skinD);                  // mandíbula
  R(24, 26 + bob, 8, 2, skinD);                   // cuello
  if (look.style === 0) {                          // corto: patillas
    R(16, 12 + bob, 2, 5, hair); R(38, 12 + bob, 2, 5, hair);
  } else if (look.style === 1) {                   // melena hasta los hombros
    R(14, 8 + bob, 3, 24, hair); R(39, 8 + bob, 3, 24, hair);   // sin tapar la cara
    R(14, 8 + bob, 1, 20, hairD); R(41, 8 + bob, 1, 20, hairD);
    R(14, 30 + bob, 3, 2, hairD); R(39, 30 + bob, 3, 2, hairD);
  }

  if (dir === 'up') {
    R(16, 12 + bob, 24, 8, hair);                  // nuca
    R(18, 12 + bob, 8, 2, hairL);
    R(16, 18 + bob, 24, 2, hairD);
    if (look.style === 1) R(16, 20 + bob, 24, 14, hair); // melena por la espalda
  } else {
    const my = 22 + bob;
    if (dir === 'down') {
      R(20, 14 + bob, 5, 1, hairD); R(31, 14 + bob, 5, 1, hairD); // cejas
      R(20, 16 + bob, 4, 4, eyeW); R(21, 17 + bob, 2, 3, eye); R(20, 16 + bob, 1, 1, '#ffffff');
      R(32, 16 + bob, 4, 4, eyeW); R(33, 17 + bob, 2, 3, eye); R(32, 16 + bob, 1, 1, '#ffffff');
      R(26, my, 4, 1, skinD);                      // boca
      R(27, my + 1, 2, 1, shade(skin, 0.7));       // sonrisilla
    } else if (dir === 'left') {
      R(16, 14 + bob, 5, 1, hairD); R(26, 14 + bob, 5, 1, hairD);
      R(16, 16 + bob, 4, 4, eyeW); R(16, 17 + bob, 2, 3, eye); R(18, 16 + bob, 1, 1, '#ffffff');
      R(26, 16 + bob, 4, 4, eyeW); R(26, 17 + bob, 2, 3, eye); R(28, 16 + bob, 1, 1, '#ffffff');
      R(34, 12 + bob, 6, 6, hair);                 // pelo de perfil
      R(20, my, 3, 1, skinD);
    } else {
      R(35, 14 + bob, 5, 1, hairD); R(25, 14 + bob, 5, 1, hairD);
      R(36, 16 + bob, 4, 4, eyeW); R(38, 17 + bob, 2, 3, eye); R(36, 16 + bob, 1, 1, '#ffffff');
      R(26, 16 + bob, 4, 4, eyeW); R(28, 17 + bob, 2, 3, eye); R(26, 16 + bob, 1, 1, '#ffffff');
      R(16, 12 + bob, 6, 6, hair);
      R(33, my, 3, 1, skinD);
    }
  }

  // contorno violáceo oscuro alrededor de toda la silueta
  outlineSprite(hi, '#241a2e');
  return scaleSmooth(hi, 28, 40);
}

// Set completo del héroe para un look (cacheado; los looks vienen saneados)
function getHeroLookSet(rawLook) {
  const look = clampLook(rawLook);
  const key = 's' + look.skin + 'h' + look.hair + 'y' + look.style + 'c' + look.shirt + 'p' + look.pants;
  if (Assets.heroSets[key]) return Assets.heroSets[key];
  const set = {};
  for (const dir of ['down', 'up', 'left', 'right']) {
    set[dir] = [0, 1, 2, 3, 4, 5].map(p => makeHeroFrame(dir, p, look));
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
  const tp = { H: '#b8e88a', L: '#8fd45e', G: '#4e9a3d', D: '#35702a', E: '#274f1e',
               T: '#8a5a33', t: '#6b4226', a: '#d8484f' };
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
  const pp = { A: '#3f7d4e', B: '#2a5c38', C: '#1e4429', S: '#e8f4f8', T: '#8a5a33', t: '#6b4226' };
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

  const cactusPal = { C: '#4fae5d', c: '#2e7a3a', F: '#e886a8' };
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

  const rockPal = { s: '#55555e', S: '#8c8c94', W: '#b4b4be', d: '#62626c' };
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
    ], { R: '#c4344c', r: '#f08a9a', g: '#3c8534' }), 2),
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
    ], { Y: '#e8b14d', y: '#ffe28a', g: '#3c8534' }), 2),
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
  ], { g: '#5fb84d', G: '#3c8534' }), 2);

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
  ], { g: '#35702a', G: '#4e9a3d', R: '#c4344c' }), CFG.SPR);
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
}

/* ================= construcción de todo ================= */

function buildAssets() {
  // suelos
  const tiles = Assets.tiles;
  tiles[T.DEEP]  = [1, 2].map(s => makeGroundTile('#27408f', '#1d3a78', '#31509e', s));
  tiles[T.WATER] = [3, 4].map(s => makeGroundTile('#3a66c4', '#2f55a8', '#4f7fdb', s));
  tiles[T.SAND]  = [5, 6, 7].map(s => makeGroundTile('#e7d08a', '#d4ba6f', '#f2e2a4', s));
  tiles[T.GRASS] = [8, 9, 10].map(s => makeGroundTile('#4a9e3f', '#3c8534', '#5fb84d', s));
  tiles[T.DIRT]  = [11, 12, 13].map(s => makeGroundTile('#8a6242', '#74512f', '#9b7251', s));
  tiles[T.STONE] = [14, 15, 16].map(s => makeGroundTile('#8d8d96', '#787882', '#a2a2ac', s));
  tiles[T.SNOW]  = [17, 18, 19].map(s => makeGroundTile('#e8f0f5', '#d6e2ea', '#fafdff', s));
  tiles[T.FLOOR] = [20, 21].map(s => makeFloorTile(s));

  // flecos de transición entre biomas (auto-tiling)
  const fringeCols = {
    [T.GRASS]: ['#4a9e3f', '#3c8534'],
    [T.SNOW]:  ['#e8f0f5', '#d6e2ea'],
    [T.DIRT]:  ['#8a6242', '#74512f'],
    [T.SAND]:  ['#e7d08a', '#d4ba6f'],
    [T.STONE]: ['#8d8d96', '#787882'],
    [T.WATER]: ['#3a66c4', '#2f55a8'],  // suaviza la orilla del mar profundo
  };
  for (const t in fringeCols) {
    Assets.fringe[t] = [0, 1, 2, 3].map(e => makeFringe(fringeCols[t][0], fringeCols[t][1], e, 400 + (+t)));
  }

  buildVegetation();

  // muros
  Assets.obj[O.WALLW] = makeCube(
    ['#a87b4f', '#7a5635', '#c89b62'], '#8a5a33', '#6b4226', '#9b6a3e', '#7a5230', 31, 8);
  Assets.obj[O.WALLS] = makeCube(
    ['#8c8c94', '#787882', '#a2a2ac'], '#6e6e78', '#5a5a64', '#7e7e88', '#646470', 32, 0);

  // antorcha y fogata
  const firePal = { f: '#ff8c2e', F: '#ffb347', Y: '#ffe28a', B: '#8a5a33', b: '#6b4226', s: '#8c8c94' };
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
  Assets.obj[O.PART] = null; // invisible: lo dibuja su ancla

  // héroe por defecto y enemigos
  Assets.player = getHeroLookSet(DEFAULT_LOOK);
  Assets.mobs.slime = [0, 1, 2].map(makeSlimeFrame);
  Assets.mobs.shadow = [SHADOW_A, SHADOW_B].map(r => scaleSprite(outlineSprite(gridSprite(r, SHADOW_PAL), '#15101f'), CFG.SPR));
  Assets.mobs.bat = [BAT_UP, BAT_DOWN].map(r => scaleSprite(outlineSprite(gridSprite(r, BAT_PAL), '#15101f'), CFG.SPR));
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
                hut: O.HUT, tower: O.TOWER, sawmill: O.SAWMILL, quarry: O.QUARRY, farm: O.FARM, brazier: O.BRAZIER, altar: O.ALTAR };

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
  const cut = f => {
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
    if (!f || !(f.w > 0) || !(f.h > 0)) continue;
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
