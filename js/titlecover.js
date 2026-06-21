'use strict';
/* Portada rotatoria de la pantalla de título: dibuja una de las 6 variantes de bioma
   (recortadas del montaje assets/_montage.webp) y va rotando. Si el montaje falla,
   cae a la portada única assets/cover.webp. */
(function () {
  const cv = document.getElementById('cover-art');
  if (!cv || cv.tagName !== 'CANVAS') return;
  const ctx = cv.getContext('2d');
  const img = new Image();
  let cells = [], idx = 0;

  function draw() {
    if (!cells.length) return;
    const s = cells[idx];
    cv.style.opacity = '0';
    setTimeout(() => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, s[0], s[1], s[2], s[3], 0, 0, cv.width, cv.height);
      cv.style.opacity = '1';
    }, 220);
  }

  img.onload = () => {
    const W = img.naturalWidth, H = img.naturalHeight;
    // detecta el inicio de la hoja de sprites por la FRACCIÓN de píxeles del gris de fondo
    // (robusto frente a portadas oscuras), recortando solo la zona de portadas (2 filas).
    let splitY = Math.round(H * 0.662);
    try {
      const off = document.createElement('canvas'); off.width = W; off.height = H;
      const og = off.getContext('2d'); og.drawImage(img, 0, 0);
      const d = og.getImageData(0, 0, W, H).data;
      const ci = ((H - 3) * W + 3) * 4, br = d[ci], bgc = d[ci + 1], bb = d[ci + 2];
      const near = (x, y) => { const i = (y * W + x) * 4; return Math.abs(d[i] - br) + Math.abs(d[i + 1] - bgc) + Math.abs(d[i + 2] - bb) < 40; };
      const frac = (y) => { let c = 0, t = 0; for (let x = 0; x < W; x += 8) { t++; if (near(x, y)) c++; } return c / t; };
      for (let y = Math.round(H * 0.55); y < H - 30; y++) {
        if (frac(y) > 0.55) { let ok = true; for (let yy = y; yy < y + 30; yy += 5) if (frac(yy) < 0.45) { ok = false; break; } if (ok) { splitY = y; break; } }
      }
    } catch (e) { /* mismo origen: no debería tintarse */ }
    const cw = Math.floor(W / 3), ch = Math.floor(splitY / 2), pad = Math.max(3, Math.round(cw * 0.012));
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) cells.push([c * cw + pad, r * ch + pad, cw - pad * 2, ch - pad * 2]);
    cv.width = cells[0][2]; cv.height = cells[0][3];
    cv.style.transition = 'opacity 0.25s ease';
    idx = (Math.random() * cells.length) | 0;
    ctx.drawImage(img, cells[idx][0], cells[idx][1], cells[idx][2], cells[idx][3], 0, 0, cv.width, cv.height);
    setInterval(() => { idx = (idx + 1) % cells.length; draw(); }, 6500);
  };
  img.onerror = () => {     // sin montaje: usa la portada única
    const f = new Image();
    f.onload = () => { cv.width = f.naturalWidth; cv.height = f.naturalHeight; ctx.drawImage(f, 0, 0); };
    f.src = 'assets/cover.webp';
  };
  img.src = 'assets/_montage.webp';
})();
