'use strict';
/* ============ Pathfinding A* sobre la rejilla de casillas ============
   Mundo infinito → búsqueda acotada por radio y por nodos expandidos.
   Movimiento en 8 direcciones, sin esquinar muros en diagonal.
   Devuelve una lista de waypoints {x,y} en centros de casilla. */

// Montículo binario mínimo de tripletas (f, x, y) en arrays paralelos
class MinHeap {
  constructor() { this.f = []; this.x = []; this.y = []; }
  get size() { return this.f.length; }
  push(f, x, y) {
    const F = this.f, X = this.x, Y = this.y;
    let i = F.length;
    F.push(f); X.push(x); Y.push(y);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= F[i]) break;
      [F[p], F[i]] = [F[i], F[p]];
      [X[p], X[i]] = [X[i], X[p]];
      [Y[p], Y[i]] = [Y[i], Y[p]];
      i = p;
    }
  }
  pop() {
    const F = this.f, X = this.x, Y = this.y, n = F.length - 1;
    const r = [F[0], X[0], Y[0]];
    F[0] = F[n]; X[0] = X[n]; Y[0] = Y[n];
    F.pop(); X.pop(); Y.pop();
    let i = 0;
    while (true) {
      const l = i * 2 + 1, rr = l + 1;
      let s = i;
      if (l < F.length && F[l] < F[s]) s = l;
      if (rr < F.length && F[rr] < F[s]) s = rr;
      if (s === i) break;
      [F[s], F[i]] = [F[i], F[s]];
      [X[s], X[i]] = [X[i], X[s]];
      [Y[s], Y[i]] = [Y[i], Y[s]];
      i = s;
    }
    return r;
  }
}

const Path = {
  MAX_EXPAND: 2600,
  RADIUS: 60,
  DIRS: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],

  walkable(tx, ty) { return !world.isSolid(tx, ty); },

  // A* a una casilla transitable. Si no se alcanza, devuelve el camino al
  // punto explorado más cercano a la meta. [] si ya estás en la casilla.
  findTo(px, py, gx0, gy0) {
    const sx = Math.floor(px), sy = Math.floor(py);
    const gx = Math.floor(gx0), gy = Math.floor(gy0);
    if (sx === gx && sy === gy) return [];
    if (!this.walkable(gx, gy)) return this.findAdjacent(px, py, gx, gy, 1);

    const key = (x, y) => x + ',' + y;
    const gScore = new Map(), came = new Map();
    const startK = key(sx, sy);
    gScore.set(startK, 0);
    const h = (x, y) => Math.hypot(x - gx, y - gy);
    const heap = new MinHeap();
    heap.push(h(sx, sy), sx, sy);
    let bestK = startK, bestH = h(sx, sy), expanded = 0;

    while (heap.size && expanded < this.MAX_EXPAND) {
      const cur = heap.pop();
      const cx = cur[1], cy = cur[2], ck = key(cx, cy);
      if (cx === gx && cy === gy) return this._build(came, ck, startK);
      expanded++;
      const cg = gScore.get(ck);
      const ch = h(cx, cy);
      if (ch < bestH) { bestH = ch; bestK = ck; }
      for (const [dx, dy] of this.DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (Math.abs(nx - sx) > this.RADIUS || Math.abs(ny - sy) > this.RADIUS) continue;
        if (!this.walkable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!this.walkable(cx + dx, cy) || !this.walkable(cx, cy + dy))) continue;
        const nk = key(nx, ny);
        const ng = cg + (dx !== 0 && dy !== 0 ? 1.4142 : 1);
        const prev = gScore.get(nk);
        if (prev === undefined || ng < prev) {
          gScore.set(nk, ng);
          came.set(nk, ck);
          heap.push(ng + h(nx, ny), nx, ny);
        }
      }
    }
    return this._build(came, bestK, startK);
  },

  // Camino a la casilla transitable más cercana al borde de una huella size×size
  findAdjacent(px, py, gx, gy, size) {
    size = size || 1;
    let best = null, bd = Infinity;
    for (let dy = -1; dy <= size; dy++) {
      for (let dx = -1; dx <= size; dx++) {
        if (dx >= 0 && dx < size && dy >= 0 && dy < size) continue; // dentro de la huella
        const tx = gx + dx, ty = gy + dy;
        if (!this.walkable(tx, ty)) continue;
        const d = (tx + 0.5 - px) * (tx + 0.5 - px) + (ty + 0.5 - py) * (ty + 0.5 - py);
        if (d < bd) { bd = d; best = { tx, ty }; }
      }
    }
    if (!best) return null;
    return this.findTo(px, py, best.tx, best.ty);
  },

  _build(came, endK, startK) {
    const pts = [];
    let k = endK, guard = 0;
    while (k && k !== startK && guard++ < 4000) {
      const c = k.indexOf(',');
      pts.push({ x: (+k.slice(0, c)) + 0.5, y: (+k.slice(c + 1)) + 0.5 });
      k = came.get(k);
    }
    pts.reverse();
    return pts;
  },
};
