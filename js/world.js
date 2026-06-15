'use strict';
/* ============ Mundo infinito por chunks con biomas procedurales ============
   Cada casilla se decide con ruido determinista a partir de la semilla:
   el mismo mundo se regenera idéntico, y solo guardamos los chunks editados.
   Los edificios 2x2 ocupan su casilla ancla + 3 casillas O.PART. */

class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.chunks = new Map();
    this.center = { x: 0, y: 0 };     // posición del jugador, para purgar chunks lejanos
    this.buildings = new Map();       // "tx,ty" del ancla -> { stock, owner }
    this.owners = new Map();          // "tx,ty" -> { id, name } (solo multijugador)
    this.crops = new Map();           // "tx,ty" -> { t } tiempo de crecimiento acumulado
    this._lastKey = null;
    this._lastChunk = null;
  }

  chunkAt(cx, cy) {
    const key = cx + ',' + cy;
    if (this._lastKey === key) return this._lastChunk;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = this.genChunk(cx, cy);
      this.evict();              // antes del set: la purga no puede borrar el recién creado
      this.chunks.set(key, ch);
    }
    this._lastKey = key;
    this._lastChunk = ch;
    return ch;
  }

  genChunk(cx, cy) {
    const N = CFG.CHUNK;
    const ground = new Uint8Array(N * N), obj = new Uint8Array(N * N);
    for (let ly = 0; ly < N; ly++) {
      for (let lx = 0; lx < N; lx++) {
        const r = this.genTile(cx * N + lx, cy * N + ly);
        ground[ly * N + lx] = r[0];
        obj[ly * N + lx] = r[1];
      }
    }
    this.stampRuin(cx, cy, ground, obj);
    this.stampVillage(cx, cy, ground, obj);
    const ch = { cx, cy, ground, obj, modified: false, _b64: null };
    ch.lights = this.buildLights(ch);
    return ch;
  }

  // Lista de emisores de luz del chunk: { tx, ty, ob } por cada objeto con
  // OBJ[ob].light. Se construye una vez al generar/cargar y se mantiene al día
  // en setObject, para que la pasada de luces del render itere solo emisores
  // en vez de barrer todo el grid visible cada frame nocturno.
  buildLights(ch) {
    const N = CFG.CHUNK;
    const out = [];
    for (let ly = 0; ly < N; ly++) {
      for (let lx = 0; lx < N; lx++) {
        const ob = ch.obj[ly * N + lx];
        if (ob && OBJ[ob] && OBJ[ob].light) out.push({ tx: ch.cx * N + lx, ty: ch.cy * N + ly, ob });
      }
    }
    return out;
  }

  // Datos deterministas de la aldea de un chunk (o null). Lo usan tanto la
  // generación de terreno como el sistema de NPCs, así que deben coincidir.
  villageInfo(cx, cy) {
    const s = this.seed;
    if (hash2(cx, cy, s ^ 0x1d7) >= VILLAGE_RARITY) return null;
    const N = CFG.CHUNK;
    const vx = cx * N + 9 + Math.floor(hash2(cx, cy, s + 71) * (N - 18));
    const vy = cy * N + 9 + Math.floor(hash2(cx, cy, s + 72) * (N - 18));
    if (this.genTile(vx, vy)[0] !== T.GRASS) return null;            // solo en pradera
    for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) {     // entorno sin agua
      const g = this.genTile(vx + dx, vy + dy)[0];
      if (g === T.DEEP || g === T.WATER) return null;
    }
    return {
      vx, vy,
      houses: [[-5, -4], [5, -4], [-5, 4], [5, 4]],
      lamps: [[-6, 0], [6, 0], [0, -6], [0, 6]],
      npcs: [
        { role: 0, x: vx - 2.5, y: vy + 1.5 },
        { role: 1, x: vx + 2.5, y: vy + 1.5 },
        { role: 2, x: vx - 2.5, y: vy - 2.5 },
        { role: 3, x: vx + 2.5, y: vy - 2.5 },
      ],
    };
  }

  // Aldea conocida más cercana al punto dado (escaneo determinista de chunks).
  // Devuelve { x, y, d } (d en casillas) o null.
  nearestVillage(px, py, maxChunks) {
    const N = CFG.CHUNK;
    const pcx = Math.floor(px / N), pcy = Math.floor(py / N);
    const R = maxChunks || 10;
    let best = null, bd = Infinity;
    for (let cy = pcy - R; cy <= pcy + R; cy++) {
      for (let cx = pcx - R; cx <= pcx + R; cx++) {
        const v = this.villageInfo(cx, cy);
        if (!v) continue;
        const d = Math.hypot(v.vx + 0.5 - px, v.vy + 0.5 - py);
        if (d < bd) { bd = d; best = { x: v.vx + 0.5, y: v.vy + 0.5, d }; }
      }
    }
    return best;
  }

  // Estampa la aldea en el terreno: plaza de losas, casas, pozo y faroles.
  stampVillage(cx, cy, ground, obj) {
    const v = this.villageInfo(cx, cy);
    if (!v) return;
    const N = CFG.CHUNK;
    const idx = (gx, gy) => {
      const lx = gx - cx * N, ly = gy - cy * N;
      return (lx < 0 || ly < 0 || lx >= N || ly >= N) ? -1 : ly * N + lx;
    };
    // plaza de losas (limpia vegetación)
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        if (dx * dx / 36 + dy * dy / 25 > 1) continue;
        const i = idx(v.vx + dx, v.vy + dy);
        if (i < 0 || ground[i] === T.DEEP || ground[i] === T.WATER) continue;
        ground[i] = T.FLOOR; obj[i] = O.NONE;
      }
    }
    // casas (cabañas 2x2)
    for (const [hx, hy] of v.houses) {
      const ax = v.vx + hx, ay = v.vy + hy;
      const i = idx(ax, ay);
      if (i < 0 || ground[i] === T.DEEP || ground[i] === T.WATER) continue;
      obj[i] = O.HUT;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) {
        const j = idx(ax + dx, ay + dy);
        if (j >= 0) obj[j] = O.PART;
      }
    }
    // pozo al centro y faroles
    const wi = idx(v.vx, v.vy);
    if (wi >= 0) obj[wi] = O.WELL;
    for (const [lx, ly] of v.lamps) {
      const i = idx(v.vx + lx, v.vy + ly);
      if (i >= 0 && obj[i] === O.NONE && ground[i] !== T.DEEP && ground[i] !== T.WATER) obj[i] = O.TORCH;
    }
  }

  // Ruinas antiguas: ~1 de cada 80 chunks esconde un anillo de muros caídos
  // con losas agrietadas y una antorcha que nadie recuerda haber encendido.
  stampRuin(cx, cy, ground, obj) {
    const s = this.seed;
    if (hash2(cx, cy, s ^ 0x9e37) >= 0.012) return;
    const N = CFG.CHUNK;
    const rx = 7 + Math.floor(hash2(cx, cy, s + 51) * (N - 14));
    const ry = 7 + Math.floor(hash2(cx, cy, s + 52) * (N - 14));
    const rad = 3 + Math.floor(hash2(cx, cy, s + 53) * 3); // 3-5
    // solo se alzan ruinas en tierra firme
    if (ground[ry * N + rx] !== T.GRASS && ground[ry * N + rx] !== T.SAND) return;
    // losas interiores agrietadas
    for (let dy = -rad + 1; dy <= rad - 1; dy++) {
      for (let dx = -rad + 1; dx <= rad - 1; dx++) {
        const px = rx + dx, py = ry + dy;
        if (px < 0 || py < 0 || px >= N || py >= N) continue;
        const gi = py * N + px;
        if (ground[gi] === T.DEEP || ground[gi] === T.WATER) continue;
        if (hash2(cx * N + px, cy * N + py, s ^ 0x44d1) < 0.65) {
          ground[gi] = T.STONE;
          obj[gi] = O.NONE;
        }
      }
    }
    // anillo de muros, unos en pie y otros derrumbados
    const steps = Math.round(rad * 7);
    for (let a = 0; a < steps; a++) {
      const ang = (a / steps) * Math.PI * 2;
      const px = Math.round(rx + Math.cos(ang) * rad);
      const py = Math.round(ry + Math.sin(ang) * rad * 0.8);
      if (px < 0 || py < 0 || px >= N || py >= N) continue;
      const gi = py * N + px;
      if (ground[gi] === T.DEEP || ground[gi] === T.WATER) continue;
      const h = hash2(cx * N + px, cy * N + py, s ^ 0x71f3);
      if (h < 0.5) { obj[gi] = O.WALLS; ground[gi] = T.STONE; }
      else if (h < 0.68) { obj[gi] = O.ROCK; ground[gi] = T.STONE; }
      else if (h < 0.8) { obj[gi] = O.NONE; ground[gi] = T.STONE; }
    }
    // la llama eterna del centro
    obj[ry * N + rx] = O.TORCH;
  }

  // Altura + humedad + temperatura -> bioma y vegetación
  genTile(tx, ty) {
    const s = this.seed;
    const e = fbm(tx * 0.016, ty * 0.016, s, 4);                     // elevación
    const m = fbm(tx * 0.035 + 311, ty * 0.035 - 97, s + 7777, 3);   // humedad
    const tp = fbm(tx * 0.007 - 905, ty * 0.007 + 422, s + 3333, 3); // temperatura
    const r = hash2(tx, ty, s ^ 0x5bd1);                             // azar local
    let g, o = O.NONE;

    if (e < 0.34) g = T.DEEP;
    else if (e < 0.40) g = T.WATER;
    else if (e < 0.44) {
      g = T.SAND;
      if (r < 0.012) o = O.ROCK;
    } else if (e > 0.76) {
      g = T.STONE;                                 // montaña: vetas de mineral
      if (r < 0.03) o = O.ROCK_IRON;
      else if (r < 0.09) o = O.ROCK_COAL;
      else if (r < 0.13) o = O.ROCK;
    } else if (tp < 0.36) {
      g = T.SNOW;
      if (r < 0.07) o = O.PINE;
      else if (r < 0.09) o = O.ROCK;
    } else if (tp > 0.66 && m < 0.42) {
      g = T.SAND;
      if (r < 0.025) o = O.CACTUS;
      else if (r < 0.035) o = O.ROCK;
    } else {
      g = T.GRASS;
      if (m > 0.58) {
        if (r < 0.16) o = O.TREE;
        else if (r < 0.18) o = O.BUSH;
        else if (r < 0.21) o = O.TALLGRASS;
        else if (r < 0.215) o = O.ROCK;
      } else {
        if (r < 0.025) o = O.TREE;
        else if (r < 0.035) o = O.BUSH;
        else if (r < 0.075) o = O.TALLGRASS;
        else if (r < 0.095) o = O.FLOWER;
        else if (r < 0.105) o = O.ROCK;
      }
    }
    return [g, o];
  }

  ground(tx, ty) {
    const N = CFG.CHUNK;
    const cx = Math.floor(tx / N), cy = Math.floor(ty / N);
    const ch = this.chunkAt(cx, cy);
    return ch.ground[(ty - cy * N) * N + (tx - cx * N)];
  }

  // ¿hay nieve en el suelo aquí? Mismas funciones y umbrales que genTile produce
  // T.SNOW: ni agua/arena (e<0.44) ni montaña (e>0.76), y temperatura baja (tp<0.36).
  snowyAt(tx, ty) {
    const s = this.seed;
    const e = fbm(tx * 0.016, ty * 0.016, s, 4);
    const tp = fbm(tx * 0.007 - 905, ty * 0.007 + 422, s + 3333, 3);
    return e >= 0.44 && e <= 0.76 && tp < 0.36;
  }

  object(tx, ty) {
    const N = CFG.CHUNK;
    const cx = Math.floor(tx / N), cy = Math.floor(ty / N);
    const ch = this.chunkAt(cx, cy);
    return ch.obj[(ty - cy * N) * N + (tx - cx * N)];
  }

  setObject(tx, ty, v) {
    const N = CFG.CHUNK;
    const cx = Math.floor(tx / N), cy = Math.floor(ty / N);
    const ch = this.chunkAt(cx, cy);
    ch.obj[(ty - cy * N) * N + (tx - cx * N)] = v;
    ch.modified = true;
    ch._b64 = null;
    // mantener la lista de emisores al día: quitar el de esta casilla (si lo
    // había) y añadirlo si el nuevo objeto emite luz. O(1) salvo el splice.
    if (ch.lights) {
      for (let i = ch.lights.length - 1; i >= 0; i--) {
        if (ch.lights[i].tx === tx && ch.lights[i].ty === ty) { ch.lights.splice(i, 1); break; }
      }
      if (v && OBJ[v] && OBJ[v].light) ch.lights.push({ tx, ty, ob: v });
    }
  }

  setGround(tx, ty, v) {
    const N = CFG.CHUNK;
    const cx = Math.floor(tx / N), cy = Math.floor(ty / N);
    const ch = this.chunkAt(cx, cy);
    ch.ground[(ty - cy * N) * N + (tx - cx * N)] = v;
    ch.modified = true;
    ch._b64 = null;
  }

  isSolid(tx, ty) {
    if (this.ground(tx, ty) === T.DEEP) return true;
    const ob = this.object(tx, ty);
    return ob !== O.NONE && OBJ[ob] && OBJ[ob].solid;
  }

  speedAt(tx, ty) {
    return this.ground(tx, ty) === T.WATER ? CFG.WATER_SPEED : 1;
  }

  /* ---------- edificios ---------- */

  // Si (tx,ty) pertenece a un edificio (ancla o PART), devuelve su ancla
  buildingAnchor(tx, ty) {
    const ob = this.object(tx, ty);
    if (ob !== O.NONE && OBJ[ob] && OBJ[ob].size) return { tx, ty, id: ob };
    if (ob !== O.PART) return null;
    for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1]]) {
      const ax = tx + dx, ay = ty + dy;
      const ao = this.object(ax, ay);
      if (ao !== O.NONE && OBJ[ao] && OBJ[ao].size === 2) return { tx: ax, ty: ay, id: ao };
    }
    return null;
  }

  canPlaceBuilding(tx, ty, size) {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const g = this.ground(tx + dx, ty + dy);
        if (g === T.DEEP || g === T.WATER) return false;
        if (this.object(tx + dx, ty + dy) !== O.NONE) return false;
      }
    }
    return true;
  }

  placeBuilding(tx, ty, id, owner) {
    const size = OBJ[id].size || 1;
    this.setObject(tx, ty, id);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (dx || dy) this.setObject(tx + dx, ty + dy, O.PART);
      }
    }
    this.buildings.set(tx + ',' + ty, { stock: 0, owner: owner || 0 });
  }

  removeBuilding(tx, ty) {
    const id = this.object(tx, ty);
    const size = (OBJ[id] && OBJ[id].size) || 1;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        this.setObject(tx + dx, ty + dy, O.NONE);
      }
    }
    this.buildings.delete(tx + ',' + ty);
  }

  /* ---------- memoria y persistencia ---------- */

  findSpawn() {
    for (let rad = 0; rad < 300; rad++) {
      const steps = Math.max(1, rad * 8);
      for (let a = 0; a < steps; a++) {
        const ang = (a / steps) * Math.PI * 2;
        const tx = Math.round(Math.cos(ang) * rad), ty = Math.round(Math.sin(ang) * rad);
        if (this.ground(tx, ty) === T.GRASS && !this.isSolid(tx, ty)) {
          return { x: tx + 0.5, y: ty + 0.5 };
        }
      }
    }
    return { x: 0.5, y: 0.5 };
  }

  evict() {
    if (this.chunks.size <= 360) return;
    const pcx = Math.floor(this.center.x / CFG.CHUNK), pcy = Math.floor(this.center.y / CFG.CHUNK);
    for (const [k, ch] of this.chunks) {
      if (ch.modified) continue;
      if (Math.abs(ch.cx - pcx) > 5 || Math.abs(ch.cy - pcy) > 5) {
        this.chunks.delete(k);
        if (this._lastKey === k) { this._lastKey = null; this._lastChunk = null; }
        if (this.chunks.size <= 320) break;
      }
    }
  }

  modifiedChunks() {
    const out = {};
    for (const [k, ch] of this.chunks) {
      if (!ch.modified) continue;
      if (!ch._b64) ch._b64 = { g: b64FromU8(ch.ground), o: b64FromU8(ch.obj) };
      out[k] = ch._b64;
    }
    return out;
  }

  // Carga directa de los chunks guardados, sin pasar por chunkAt/evict:
  // así la purga no puede descartar un chunk antes de marcarlo modificado.
  applyModified(data) {
    for (const k in data) {
      const p = k.split(',');
      const ch = {
        cx: parseInt(p[0], 10), cy: parseInt(p[1], 10),
        ground: u8FromB64(data[k].g), obj: u8FromB64(data[k].o),
        modified: true,
        _b64: { g: data[k].g, o: data[k].o },
      };
      ch.lights = this.buildLights(ch);
      this.chunks.set(k, ch);
    }
    this._lastKey = null;
    this._lastChunk = null;
  }

  buildingsData() {
    const out = {};
    for (const [k, b] of this.buildings) out[k] = { stock: +b.stock.toFixed(2), owner: b.owner || 0 };
    return out;
  }

  applyBuildings(data) {
    this.buildings.clear();
    for (const k in data) {
      this.buildings.set(k, { stock: data[k].stock || 0, owner: data[k].owner || 0 });
    }
  }

  cropsData() {
    const out = {};
    for (const [k, c] of this.crops) out[k] = +c.t.toFixed(1);
    return out;
  }

  applyCrops(data) {
    this.crops.clear();
    for (const k in data) this.crops.set(k, { t: data[k] || 0 });
  }
}
