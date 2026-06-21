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
    if (depth > 18 && cl > 0.6 && h < 0.06) return T.IRON_ORE;
    if (depth > 8 && cl > 0.58 && h < 0.10) return T.COAL_ORE;
    return T.STONE;
  }

  // bioma de superficie (solo afecta al fondo; el terreno es común en el MVP)
  biomeAt(tx) {
    const t = fbm(tx * 0.0016, 55.5, this.seed + 7, 2);
    if (t < 0.30) return 'desert';
    if (t < 0.56) return 'plains';
    if (t < 0.80) return 'forest';
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
    return { cx, cy, ground, modified: false, _b64: null };
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
