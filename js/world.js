'use strict';
/* ============ Mundo infinito por chunks con biomas procedurales ============
   Cada casilla se decide con ruido determinista a partir de la semilla:
   el mismo mundo se regenera idéntico, y solo guardamos los chunks editados. */

class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.chunks = new Map();
    this.center = { x: 0, y: 0 };   // posición del jugador, para purgar chunks lejanos
    this._lastKey = null;
    this._lastChunk = null;
  }

  chunkAt(cx, cy) {
    const key = cx + ',' + cy;
    if (this._lastKey === key) return this._lastChunk;
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = this.genChunk(cx, cy);
      this.chunks.set(key, ch);
      this.evict();
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
    return { cx, cy, ground, obj, modified: false };
  }

  // Altura + humedad + temperatura -> bioma y vegetación
  genTile(tx, ty) {
    const s = this.seed;
    const e = fbm(tx * 0.016, ty * 0.016, s, 4);              // elevación
    const m = fbm(tx * 0.035 + 311, ty * 0.035 - 97, s + 7777, 3);  // humedad
    const tp = fbm(tx * 0.007 - 905, ty * 0.007 + 422, s + 3333, 3); // temperatura
    const r = hash2(tx, ty, s ^ 0x5bd1);                      // azar local (vegetación)
    let g, o = O.NONE;

    if (e < 0.34) g = T.DEEP;
    else if (e < 0.40) g = T.WATER;
    else if (e < 0.44) {
      g = T.SAND;                                  // playa
      if (r < 0.012) o = O.ROCK;
    } else if (e > 0.76) {
      g = T.STONE;                                 // montaña
      if (r < 0.10) o = O.ROCK;
    } else if (tp < 0.36) {
      g = T.SNOW;                                  // tundra
      if (r < 0.07) o = O.PINE;
      else if (r < 0.09) o = O.ROCK;
    } else if (tp > 0.66 && m < 0.42) {
      g = T.SAND;                                  // desierto
      if (r < 0.025) o = O.CACTUS;
      else if (r < 0.035) o = O.ROCK;
    } else {
      g = T.GRASS;
      if (m > 0.58) {                              // bosque denso
        if (r < 0.16) o = O.TREE;
        else if (r < 0.18) o = O.BUSH;
        else if (r < 0.21) o = O.TALLGRASS;
        else if (r < 0.215) o = O.ROCK;
      } else {                                     // pradera
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
  }

  setGround(tx, ty, v) {
    const N = CFG.CHUNK;
    const cx = Math.floor(tx / N), cy = Math.floor(ty / N);
    const ch = this.chunkAt(cx, cy);
    ch.ground[(ty - cy * N) * N + (tx - cx * N)] = v;
    ch.modified = true;
  }

  isSolid(tx, ty) {
    if (this.ground(tx, ty) === T.DEEP) return true;
    const ob = this.object(tx, ty);
    return ob !== O.NONE && OBJ[ob] && OBJ[ob].solid;
  }

  speedAt(tx, ty) {
    return this.ground(tx, ty) === T.WATER ? CFG.WATER_SPEED : 1;
  }

  // Busca en espiral desde el origen la primera pradera transitable
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

  // Limita la memoria: descarta chunks lejanos sin modificar (se regeneran igual)
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
      if (ch.modified) out[k] = { g: b64FromU8(ch.ground), o: b64FromU8(ch.obj) };
    }
    return out;
  }

  applyModified(data) {
    for (const k in data) {
      const parts = k.split(',');
      const ch = this.chunkAt(parseInt(parts[0], 10), parseInt(parts[1], 10));
      ch.ground = u8FromB64(data[k].g);
      ch.obj = u8FromB64(data[k].o);
      ch.modified = true;
    }
  }
}
