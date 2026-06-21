'use strict';
/* ============ Mundo 2D lateral (tipo Terraria) ============
   Columnas de material con superficie ondulada, subsuelo de tierra y piedra,
   cuevas por ruido y vetas de mineral por profundidad. Misma firma que World
   (ground/setGround/isSolid/chunkAt/modifiedChunks/applyModified) para que el
   minado, la colocación y el guardado funcionen sin cambios. */

class World2D {
  constructor(seed) {
    this.seed = seed | 0;
    this.chunks = new Map();
    this.center = { x: 0, y: 0 };
    this._lastKey = null; this._lastChunk = null;
    this.SEA = 70;          // fila media de la superficie
    this.BOTTOM = 320;      // fondo del mundo (lecho de roca)
    this.chopped = new Set();   // columnas con el árbol ya talado
  }

  // altura de la superficie en la columna tx (ruido 1D = fbm con y constante)
  surfaceY(tx) {
    const s = this.seed;
    const roll = (fbm(tx * 0.013, 1234.5, s, 4) * 2 - 1) * 13;          // ondulación suave
    const hills = Math.max(0, fbm(tx * 0.0042, 99, s + 5, 3) * 2 - 1) * 30; // colinas ocasionales
    return Math.round(this.SEA + roll - hills);
  }

  genCell(tx, ty) {
    const s = this.seed;
    const sy = this.surfaceY(tx);
    if (ty < sy) return T.AIR;
    if (ty >= this.BOTTOM - (hash2(tx, 1, s) * 4 | 0)) return T.BEDROCK;
    const depth = ty - sy;
    // cuevas (no en la corteza más superficial)
    if (depth > 5) {
      const cave = fbm(tx * 0.062, ty * 0.062, s + 555, 3);
      if (Math.abs(cave * 2 - 1) < 0.085 + Math.min(0.05, depth * 0.0006)) return T.AIR;
    }
    if (depth === 0) return T.GRASS;
    const dirtDepth = 4 + (fbm(tx * 0.05, 7, s + 11, 2) * 5 | 0);
    if (depth < dirtDepth) return T.DIRT;
    // piedra con vetas de mineral en parches
    const cl = fbm(tx * 0.21, ty * 0.21, s + 33, 2);
    const h = hash2(tx, ty, (s ^ 0x07e5) >>> 0);
    if (depth > 110 && cl > 0.55 && h < 0.05) return T.CRYSTAL;     // cristal abisal (profundo)
    if (depth > 18 && cl > 0.6 && h < 0.06) return T.IRON_ORE;
    if (depth > 8 && cl > 0.58 && h < 0.10) return T.COAL_ORE;
    return T.STONE;
  }

  // --- árboles de superficie (segundo plano, no sólidos, picables para madera) ---
  treeHeightAt(tx) {
    if (this.chopped && this.chopped.has(tx)) return 0;
    const b = this.biomeAt(tx);
    if (b !== 'plains' && b !== 'forest' && b !== 'jungle') return 0;
    const s = (this.seed + 909) >>> 0;
    if (hash2(tx, 0, s) >= (b === 'forest' || b === 'jungle' ? 0.26 : 0.12)) return 0;
    if (hash2(tx - 1, 0, s) < 0.26 || hash2(tx - 2, 0, s) < 0.26) return 0;   // espaciado
    return 4 + (hash2(tx, 1, s) * 3 | 0);
  }
  chopTree(tx) { (this.chopped || (this.chopped = new Set())).add(tx); }
  treesData() { return this.chopped ? Array.from(this.chopped) : []; }
  applyTrees(arr) { this.chopped = new Set(arr || []); }

  // bioma de superficie (solo afecta al fondo; el terreno es común en el MVP)
  biomeAt(tx) {
    const t = fbm(tx * 0.0016, 55.5, this.seed + 7, 2);
    if (t < 0.18) return 'desert';
    if (t < 0.36) return 'plains';
    if (t < 0.54) return 'forest';
    if (t < 0.70) return 'jungle';
    if (t < 0.85) return 'mountain';
    return 'snow';
  }

  chunkAt(cx, cy) {
    const key = cx + ',' + cy;
    if (this._lastKey === key) return this._lastChunk;
    let ch = this.chunks.get(key);
    if (!ch) { ch = this.genChunk(cx, cy); this.evict(); this.chunks.set(key, ch); }
    this._lastKey = key; this._lastChunk = ch;
    return ch;
  }

  genChunk(cx, cy) {
    const N = CFG.CHUNK, ground = new Uint8Array(N * N);
    for (let ly = 0; ly < N; ly++) {
      for (let lx = 0; lx < N; lx++) ground[ly * N + lx] = this.genCell(cx * N + lx, cy * N + ly);
    }
    this.stampStructures(cx, cy, ground, N);   // casas/pueblos + salas de cueva
    return { cx, cy, ground, modified: false, _b64: null };
  }

  // ¿hay una casa anclada (esquina izq) en la columna gx? (terreno plano, biomas habitables)
  houseAnchor(gx) {
    const s = (this.seed + 4242) >>> 0, HW = 7, GAP = 7;
    if (hash2(gx, 0, s) >= 0.055) return false;
    for (let k = 1; k < HW + GAP; k++) if (hash2(gx - k, 0, s) < 0.055) return false;   // espaciado
    const base = this.surfaceY(gx);
    for (let k = 1; k < HW; k++) if (Math.abs(this.surfaceY(gx + k) - base) > 1) return false;  // terreno plano
    const b = this.biomeAt(gx);
    return b === 'plains' || b === 'forest' || b === 'jungle' || b === 'snow';
  }
  // ¿hay una sala de cueva anclada (esquina sup-izq) en (gx,gy)? (lattice profundo)
  roomAnchor(gx, gy) {
    if (gx % 11 !== 0 || gy % 8 !== 0) return false;
    const surf = this.surfaceY(gx);
    if (gy < surf + 14 || gy > this.BOTTOM - 12) return false;     // solo en cuevas, no muy al fondo
    return hash2(gx, gy, (this.seed + 7777) >>> 0) < 0.16;
  }
  stampStructures(cx, cy, ground, N) {
    const baseX = cx * N, baseY = cy * N;
    const set = (gx, gy, mat) => { const lx = gx - baseX, ly = gy - baseY; if (lx >= 0 && lx < N && ly >= 0 && ly < N) ground[ly * N + lx] = mat; };
    // --- casas de superficie (y pueblos por agrupación) ---
    for (let gx = baseX - 8; gx < baseX + N + 8; gx++) {
      if (!this.houseAnchor(gx)) continue;
      const HW = 7, HH = 5, base = this.surfaceY(gx), top = base - HH, floor = base - 1;
      const roof = this.biomeAt(gx) === 'snow' ? T.STONE : T.WOOD;
      for (let lx = 0; lx < HW; lx++) for (let ry = top; ry <= floor; ry++) {
        const ly = ry - top, perim = (lx === 0 || lx === HW - 1 || ly === 0 || ly === HH - 1);
        const door = (lx === 1 && (ly === HH - 1 || ly === HH - 2));
        if (door) set(gx + lx, ry, T.AIR);
        else if (perim) set(gx + lx, ry, ly === 0 ? roof : T.WOOD);
        else set(gx + lx, ry, T.AIR);
      }
      set(gx + HW - 2, floor - 1, T.TORCH);                          // antorcha interior
      for (let lx = 1; lx < HW - 1; lx++) set(gx + lx, base, T.WOOD); // refuerzo del suelo sobre la hierba
    }
    // --- salas/viviendas de cueva (dwarf-holds sepultados) ---
    for (let gx = baseX - 12; gx < baseX + N + 12; gx++) {
      for (let gy = baseY - 10; gy < baseY + N + 10; gy++) {
        if (!this.roomAnchor(gx, gy)) continue;
        const RW = 9, RH = 6;
        for (let lx = 0; lx < RW; lx++) for (let ly = 0; ly < RH; ly++) {
          const perim = (lx === 0 || lx === RW - 1 || ly === 0 || ly === RH - 1);
          set(gx + lx, gy + ly, perim ? T.BRICK : T.AIR);
        }
        set(gx + 1, gy + RH - 2, T.TORCH); set(gx + RW - 2, gy + RH - 2, T.TORCH);  // antorchas
        const doorY = gy + RH - 2;                                                   // puerta lateral
        set(gx, doorY, T.AIR); set(gx, doorY - 1, T.AIR);
      }
    }
  }

  evict() {
    if (this.chunks.size < 240) return;
    const N = CFG.CHUNK, pcx = Math.floor(this.center.x / N), pcy = Math.floor(this.center.y / N);
    for (const [k, ch] of this.chunks) {
      if (this.chunks.size <= 200) break;   // ya hay holgura: no escanear el Map entero
      if (ch.modified) continue;            // los chunks editados nunca se desalojan (los necesita el guardado)
      if (Math.abs(ch.cx - pcx) > 7 || Math.abs(ch.cy - pcy) > 7) this.chunks.delete(k);
    }
  }

  ground(tx, ty) {
    const N = CFG.CHUNK, cx = Math.floor(tx / N), cy = Math.floor(ty / N);
    return this.chunkAt(cx, cy).ground[(ty - cy * N) * N + (tx - cx * N)];
  }
  setGround(tx, ty, v) {
    const N = CFG.CHUNK, cx = Math.floor(tx / N), cy = Math.floor(ty / N), ch = this.chunkAt(cx, cy);
    ch.ground[(ty - cy * N) * N + (tx - cx * N)] = v; ch.modified = true; ch._b64 = null;
  }
  // el modo 2D no usa capa de objetos separada (el material ES el tile)
  object() { return O.NONE; }
  setObject() {}
  isSolid(tx, ty) { const d = TDEF[this.ground(tx, ty)]; return !!(d && d.solid); }

  // punto de aparición sobre la superficie de la columna tx
  findSurfaceSpawn(tx) {
    tx = tx || 0;
    let sy = this.surfaceY(tx);
    while (sy > 0 && !this.isSolid(tx, sy)) sy++;   // baja hasta el primer sólido
    return { x: tx + 0.5, y: sy };                  // pies sobre el suelo
  }

  // --- persistencia (mismo formato b64 que World) ---
  modifiedChunks() {
    const out = {};
    for (const [k, ch] of this.chunks) {
      if (!ch.modified) continue;
      if (!ch._b64) ch._b64 = btoa(String.fromCharCode.apply(null, ch.ground));
      out[k] = ch._b64;
    }
    return out;
  }
  applyModified(map) {
    const N = CFG.CHUNK;
    for (const k in (map || {})) {
      const p = k.split(','), cx = +p[0], cy = +p[1];
      const bin = atob(map[k]), g = new Uint8Array(N * N);
      for (let i = 0; i < g.length && i < bin.length; i++) g[i] = bin.charCodeAt(i);
      this.chunks.set(k, { cx, cy, ground: g, modified: true, _b64: map[k] });
    }
  }
}
