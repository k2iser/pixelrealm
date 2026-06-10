# ⛏ PixelRealm

**Mundo abierto infinito estilo Minecraft · Vista isométrica tipo Diablo/Warcraft · Pixel art 100 % procedural**

Un juego de supervivencia y construcción para navegador hecho **solo con JavaScript vanilla y Canvas**: cero dependencias, cero assets externos. Cada sprite — tiles, árboles, el héroe, las babas, los iconos — se dibuja píxel a píxel por código al arrancar. El sonido también es sintetizado en tiempo real con WebAudio.

## 🎮 Jugar

**Opción 1 — directamente:** abre `index.html` en el navegador. Ya está.

**Opción 2 — servidor local:**

```bash
npm start          # o: node server.js
# → http://localhost:5173
```

## ✨ Características

- **Mundo infinito por chunks** con biomas generados por ruido fractal determinista: océanos, playas, praderas, bosques densos, desiertos con cactus, tundras nevadas con pinos y montañas rocosas. La misma semilla genera siempre el mismo mundo.
- **Vista isométrica 2:1** con orden de profundidad correcto, cámara suave y renderizado a baja resolución reescalado para un look pixel genuino.
- **Recolección con herramientas**: tala árboles, pica rocas, recoge fibra y bayas. Cada herramienta es eficaz contra su material (hacha → madera, pico → piedra, espada → combate).
- **Crafteo**: tablones, palos, hacha, pico, espada, antorchas, fogatas y muros de madera y piedra.
- **Construcción**: levanta muros con volumen isométrico real, ilumina con antorchas y fogatas.
- **Ciclo día/noche** con atardeceres cálidos y noches oscuras donde las luces (antorchas, fogatas, la antorcha en tu mano) abren agujeros de luz reales en la oscuridad.
- **Babas nocturnas** que te persiguen a saltos. Combate con retroceso, números de daño flotantes y botín.
- **Vida, comida y regeneración**: come bayas, evita el agua profunda, sobrevive.
- **Inventario de 36 casillas + barra rápida**, minimapa en vivo, mensajes de ayuda, todo en español.
- **Guardado automático** en localStorage: solo se persisten los chunks que has modificado; el resto se regenera de la semilla.
- **Sonido procedural** con WebAudio: talar, picar, craftear, recoger, daño… ni un solo archivo de audio.

## ⌨ Controles

| Tecla | Acción |
|---|---|
| `WASD` / flechas | Moverse |
| Clic izquierdo (mantener) | Golpear / talar / picar / atacar |
| Clic derecho | Colocar objeto / comer |
| `1–9` / rueda del ratón | Seleccionar en la barra rápida |
| `E` | Inventario y fabricación |
| `H` | Ayuda |
| `M` | Silenciar |

## 🧱 Cómo está hecho

```
index.html
css/style.css        UI retro (Press Start 2P, marcos pixelados)
js/
  utils.js           hash determinista, ruido de valor, fBm
  config.js          datos: tiles, objetos, items, recetas
  assets.js          TODO el pixel art, generado en canvas al vuelo
  audio.js           sintetizador WebAudio
  world.js           chunks infinitos + biomas (elevación/humedad/temperatura)
  inventory.js       inventario y crafteo
  entities.js        jugador, babas, drops, partículas
  input.js           teclado y ratón
  renderer.js        proyección isométrica, culling, iluminación nocturna
  ui.js              HUD, paneles, minimapa
  save.js            persistencia en localStorage
  main.js            bucle del juego, día/noche, interacciones
```

Sin build, sin framework, sin npm install. ~3000 líneas de JS clásico cargado con `<script>`.

## 🗺 Hoja de ruta

- [ ] Multijugador con WebSockets (ver a otros jugadores en tu mundo)
- [ ] Minerales (carbón, hierro) y segundo nivel de herramientas
- [ ] Animales pasivos y agricultura
- [ ] Cuevas / interiores
- [ ] Soporte táctil para móvil

## Licencia

[MIT](LICENSE)
