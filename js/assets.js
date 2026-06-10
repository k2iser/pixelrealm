'use strict';
/* ============ Generación procedural de TODO el pixel art ============
   No hay ni un solo asset externo: cada sprite se dibuja píxel a píxel
   en canvas fuera de pantalla al arrancar el juego. */

const Assets = {
  tiles: {},     // T.* -> [variantes/frames]
  obj: {},       // O.* -> canvas | [frames] | [variantes]
  player: {},    // dir -> [idle, paso1, paso2]
  slime: [],     // [normal, aplastado, salto]
  items: {},     // id de item -> canvas
  heart: null, heartHalf: null, heartEmpty: null,
  sun: null, moon: null,
  _icons: {},    // id -> dataURL para la UI
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

// Rombo isométrico 32x16 con textura moteada determinista
function makeGroundTile(base, dark, light, seed) {
  const [c, g] = cv(CFG.TW, CFG.TH);
  for (let y = 0; y < CFG.TH; y++) {
    for (let x = 0; x < CFG.TW; x++) {
      const dx = Math.abs(x - 15.5) / 16, dy = Math.abs(y - 7.5) / 8;
      if (dx + dy > 1.04) continue;
      const r = hash2(x * 7 + 13, y * 13 + 5, seed);
      let col = base;
      if (r < 0.13) col = dark;
      else if (r > 0.87) col = light;
      // bordes inferiores algo más oscuros: sensación de relieve
      if (y > 7 && dx + dy > 0.88) col = dark;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// Suelo de tablones (construible): vetas paralelas al borde del rombo
function makeFloorTile(seed) {
  const base = '#a87b4f', dark = '#7a5635', light = '#c89b62';
  const [c, g] = cv(CFG.TW, CFG.TH);
  for (let y = 0; y < CFG.TH; y++) {
    for (let x = 0; x < CFG.TW; x++) {
      const dx = Math.abs(x - 15.5) / 16, dy = Math.abs(y - 7.5) / 8;
      if (dx + dy > 1.04) continue;
      let col = base;
      if (((x + 2 * y) % 8) === 0) col = dark;
      else if (hash2(x, y, seed) > 0.92) col = light;
      if (y > 7 && dx + dy > 0.88) col = dark;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

// Cubo isométrico (muros): tapa de rombo + dos caras laterales extruidas
function makeCube(topCols, leftCol, leftDark, rightCol, rightDark, seed, stripeEvery) {
  const H = CFG.CUBE_H;
  const [c, g] = cv(CFG.TW, CFG.TH + H);
  const bottom = new Array(CFG.TW).fill(-1);
  for (let y = 0; y < CFG.TH; y++) {
    for (let x = 0; x < CFG.TW; x++) {
      const dx = Math.abs(x - 15.5) / 16, dy = Math.abs(y - 7.5) / 8;
      if (dx + dy > 1.04) continue;
      const r = hash2(x, y, seed);
      g.fillStyle = r < 0.15 ? topCols[1] : (r > 0.88 ? topCols[2] : topCols[0]);
      g.fillRect(x, y, 1, 1);
      if (y > bottom[x]) bottom[x] = y;
    }
  }
  for (let x = 0; x < CFG.TW; x++) {
    if (bottom[x] < 0) continue;
    const left = x < CFG.TW / 2;
    for (let k = 1; k <= H; k++) {
      let col = left ? leftCol : rightCol;
      if (stripeEvery && x % stripeEvery === (left ? 0 : 2)) col = left ? leftDark : rightDark;
      if (k === H || hash2(x, k, seed + 9) < 0.07) col = left ? leftDark : rightDark;
      g.fillStyle = col;
      g.fillRect(x, bottom[x] + k, 1, 1);
    }
  }
  return c;
}

// Héroe: 4 direcciones x 3 frames (quieto, paso izq., paso der.)
function makePlayerFrame(dir, frame) {
  const [c, g] = cv(14, 19);
  const skin = '#eab487', skinD = '#d49a6a', hair = '#4a3120', shirt = '#2e8f83',
        shirtD = '#20695f', pants = '#3b3b46', boots = '#5d4427', belt = '#2a2018',
        eye = '#1b1b22';
  const rect = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const lOff = frame === 1 ? -1 : 0, rOff = frame === 2 ? -1 : 0;
  // piernas y botas
  rect(4, 13 + lOff, 2, 4, pants); rect(4, 17 + lOff, 2, 2, boots);
  rect(8, 13 + rOff, 2, 4, pants); rect(8, 17 + rOff, 2, 2, boots);
  // torso con cinturón
  rect(3, 7, 8, 4, shirt);
  rect(3, 11, 8, 1, shirtD);
  rect(3, 12, 8, 1, belt);
  // brazos (manga + piel)
  rect(2, 7, 1, 2, shirtD); rect(2, 9, 1, 3, skin);
  rect(11, 7, 1, 2, shirtD); rect(11, 9, 1, 3, skin);
  // cabeza
  rect(4, 0, 6, 3, hair);
  rect(4, 3, 6, 4, skin);
  rect(4, 6, 1, 1, skinD); rect(9, 6, 1, 1, skinD);
  if (dir === 'up') {
    rect(4, 3, 6, 2, hair); // de espaldas: solo pelo
  } else if (dir === 'down') {
    rect(5, 4, 1, 1, eye); rect(8, 4, 1, 1, eye);
    rect(3, 1, 1, 2, hair); rect(10, 1, 1, 2, hair);
  } else if (dir === 'left') {
    rect(4, 4, 1, 1, eye); rect(6, 4, 1, 1, eye);
    rect(9, 3, 1, 2, hair); rect(10, 0, 1, 4, hair);
  } else {
    rect(7, 4, 1, 1, eye); rect(9, 4, 1, 1, eye);
    rect(4, 3, 1, 2, hair); rect(3, 0, 1, 4, hair);
  }
  return c;
}

// Baba: tres poses (normal, aplastada al cargar el salto, estirada en el aire)
function makeSlimeFrame(f) {
  const [c, g] = cv(14, 11);
  const body = '#5fd44a', dark = '#3da32f', shine = '#c8f7b0', eye = '#16321a';
  let w, h;
  if (f === 0) { w = 10; h = 8; }
  else if (f === 1) { w = 12; h = 6; }
  else { w = 8; h = 10; }
  const x0 = Math.floor((14 - w) / 2), y0 = 11 - h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const corner = (y === 0 || y === h - 1) && (x === 0 || x === w - 1);
      const topEdge = y === 0 && (x === 1 || x === w - 2);
      if (corner || topEdge) continue;
      let col = body;
      if (y >= h - 2 || x === w - 1) col = dark;
      g.fillStyle = col;
      g.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
  g.fillStyle = shine;
  g.fillRect(x0 + 1, y0 + 1, 2, 1); g.fillRect(x0 + 1, y0 + 2, 1, 1);
  const ey = y0 + Math.floor(h / 2) - 1;
  g.fillStyle = eye;
  g.fillRect(x0 + Math.floor(w / 2) - 2, ey, 1, 2);
  g.fillRect(x0 + Math.floor(w / 2) + 1, ey, 1, 2);
  return c;
}

function buildAssets() {
  // ---------- suelos ----------
  const tiles = Assets.tiles;
  tiles[T.DEEP]  = [1, 2].map(s => makeGroundTile('#27408f', '#1d3a78', '#31509e', s));
  tiles[T.WATER] = [3, 4].map(s => makeGroundTile('#3a66c4', '#2f55a8', '#4f7fdb', s));
  tiles[T.SAND]  = [5, 6, 7].map(s => makeGroundTile('#e7d08a', '#d4ba6f', '#f2e2a4', s));
  tiles[T.GRASS] = [8, 9, 10].map(s => makeGroundTile('#4a9e3f', '#3c8534', '#5fb84d', s));
  tiles[T.DIRT]  = [11, 12, 13].map(s => makeGroundTile('#8a6242', '#74512f', '#9b7251', s));
  tiles[T.STONE] = [14, 15, 16].map(s => makeGroundTile('#8d8d96', '#787882', '#a2a2ac', s));
  tiles[T.SNOW]  = [17, 18, 19].map(s => makeGroundTile('#e8f0f5', '#d6e2ea', '#fafdff', s));
  tiles[T.FLOOR] = [20, 21].map(s => makeFloorTile(s));

  // ---------- vegetación y rocas ----------
  const treePal = { L: '#8fd45e', G: '#4e9a3d', D: '#35702a', T: '#8a5a33', t: '#6b4226' };
  Assets.obj[O.TREE] = scaleSprite(gridSprite([
    '.....LLLLLL',
    '...LLGGGGGLL',
    '..LGGGGLGGGGL',
    '.LGGLGGGGGGGGD',
    '.GGGGGGGLGGGGD',
    'GGLGGGGGGGGGGGD',
    'GGGGGGLGGGGGDGD',
    '.GGGGGGGGGLGGD',
    '.DGGLGGGGGGGD',
    '..DGGGGGGGDD',
    '...DDGGGDDD',
    '.....DDDD',
    '.......tT',
    '.......tT',
    '.......tT',
    '......ttTT',
  ], treePal), 2);

  const pinePal = { A: '#3f7d4e', B: '#2a5c38', S: '#dfeef2', T: '#8a5a33', t: '#6b4226' };
  Assets.obj[O.PINE] = scaleSprite(gridSprite([
    '......SS',
    '.....ABBA',
    '....AABBAA',
    '...AAABBAAA',
    '.....ABBA',
    '....AABBAA',
    '...AABBBBAA',
    '..AAABBBBAAA',
    '....AABBAA',
    '...AABBBBAA',
    '..AABBBBBBAA',
    '.AAABBBBBBAAA',
    '......tT',
    '......tT',
    '.....ttTT',
  ], pinePal), 2);

  const cactusPal = { C: '#4fae5d', c: '#2e7a3a' };
  Assets.obj[O.CACTUS] = scaleSprite(gridSprite([
    '.....cC',
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
  ], cactusPal), 2);

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
  ], rockPal), 2);

  Assets.obj[O.FLOWER] = [
    gridSprite([
      '...RR',
      '..RrrR',
      '..RrrR',
      '...RR',
      '....g',
      '....g',
      '..g.g',
      '...gg',
      '....g',
    ], { R: '#c4344c', r: '#f08a9a', g: '#3c8534' }),
    gridSprite([
      '...YY',
      '..YyyY',
      '..YyyY',
      '...YY',
      '....g',
      '....g',
      '..g.g',
      '...gg',
      '....g',
    ], { Y: '#e8b14d', y: '#ffe28a', g: '#3c8534' }),
  ];

  const grassPal = { g: '#5fb84d', G: '#3c8534' };
  Assets.obj[O.TALLGRASS] = gridSprite([
    '.g...G...g',
    '.g..gg..G',
    '..G.g..gg',
    '..g.gG.g',
    '...gGg.g',
    '...gggG',
    '....gg',
    '....gG',
  ], grassPal);

  const bushPal = { g: '#35702a', G: '#4e9a3d', R: '#c4344c' };
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
  ], bushPal), 2);

  // ---------- construcciones ----------
  Assets.obj[O.WALLW] = makeCube(
    ['#a87b4f', '#7a5635', '#c89b62'], '#8a5a33', '#6b4226', '#9b6a3e', '#7a5230', 31, 4);
  Assets.obj[O.WALLS] = makeCube(
    ['#8c8c94', '#787882', '#a2a2ac'], '#6e6e78', '#5a5a64', '#7e7e88', '#646470', 32, 0);

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
      '..fYFf.',
      '..FYYF',
      '...YY',
      '..bBBb',
      '...BB',
      '...BB',
      '...BB',
      '...BB',
      '...bb',
    ], firePal),
  ].map(c => scaleSprite(c, 2));

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
  ].map(c => scaleSprite(c, 2));

  // ---------- personaje y enemigos ----------
  for (const dir of ['down', 'up', 'left', 'right']) {
    Assets.player[dir] = [0, 1, 2].map(f => makePlayerFrame(dir, f));
  }
  Assets.slime = [0, 1, 2].map(f => scaleSprite(makeSlimeFrame(f), 2));

  // ---------- iconos de items ----------
  const it = Assets.items;
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

  it.axe = gridSprite([
    '.......sss',
    '......sSSSs',
    '.....bSWSSs',
    '....bBbSSs',
    '...bBb.ss',
    '..bBb',
    '.bBb',
    '.bb',
  ], { s: '#55555e', S: '#9a9aa4', W: '#c8c8d2', b: '#6b4226', B: '#a87b4f' });

  it.pick = gridSprite([
    '....ssssss',
    '...sS....Ss',
    '..sS..bb..s',
    '..s..bBb',
    '.....bBb',
    '....bBb',
    '...bBb',
    '..bBb',
    '..bb',
  ], { s: '#55555e', S: '#9a9aa4', b: '#6b4226', B: '#a87b4f' });

  it.sword = gridSprite([
    '.........WW',
    '........WWS',
    '.......WWS',
    '......WWS',
    '.....WWS',
    '..g.WWS',
    '...gWS',
    '..bgg',
    '.bb.g',
  ], { W: '#dfe7ee', S: '#9fb0bf', g: '#e8c14d', b: '#6b4226' });

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

  // ---------- HUD ----------
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

// DataURL (cacheada) del icono de un item, para usar en la UI con <img>
function iconURL(id) {
  if (!Assets._icons[id]) {
    const src = Assets.items[id];
    if (!src) return '';
    Assets._icons[id] = src.toDataURL();
  }
  return Assets._icons[id];
}
