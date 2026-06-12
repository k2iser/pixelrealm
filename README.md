# ⛏ PixelRealm

**Mundo abierto infinito estilo Minecraft · Vista isométrica tipo Diablo/Warcraft · Pixel art 100 % procedural · Cooperativo online**

Un juego de supervivencia, construcción y cooperación para navegador hecho **solo con JavaScript vanilla**: cero dependencias, cero assets externos. Cada sprite — tiles, árboles, el héroe, los monstruos, los edificios — se dibuja píxel a píxel por código al arrancar. El sonido se sintetiza con WebAudio. Y el multijugador corre sobre un **WebSocket implementado a mano** (handshake SHA-1 y frames RFC 6455 sobre `net`/`http` de Node).

**📖 [Guía del mundo (wiki autogenerada)](wiki.html) · 🚀 [Plan de despliegue VPS + cuentas](DEPLOY.md)**

## 🎮 Jugar

**Un jugador:** abre `index.html` en el navegador, o juega en GitHub Pages. Ya está.

**Multijugador cooperativo:**

```bash
node server.js
# → http://localhost:5173  (cada visitante entra al MISMO mundo)
```

Cualquiera que abra esa URL verá el botón **«Entrar al mundo compartido»**. Para jugar con gente fuera de tu red, despliega `server.js` en cualquier hosting de Node (Render, Fly.io, Railway, un VPS…) o comparte tu puerto con un túnel (Tailscale, ngrok). El mundo se guarda en `world-server.json` y sobrevive a los reinicios.

## ✨ Características

- **Mundo infinito por chunks** con biomas de ruido fractal determinista: océanos, praderas, bosques (con árboles frutales), desiertos, tundras y montañas. La misma semilla genera siempre el mismo mundo.
- **Vista isométrica 2:1** con orden de profundidad, cámara suave, iluminación nocturna real (las luces abren agujeros en la oscuridad) y render a baja resolución reescalado.
- **Cámara cercana estilo Stardew** con tres niveles de zoom (`+`/`−`) y suelos a doble resolución de píxel.
- **Editor de personaje**: piel, peinado, color de pelo, camiseta y pantalón — tu héroe te representa también online.
- **Héroe en alta definición**: cuádruple densidad de píxel, ciclo de andar de 4 pasos con aceleración real, pose de ataque con la herramienta en la mano, medio cuerpo sumergido al vadear y polvillo en los pies.
- **Ruinas antiguas**: anillos de muros derruidos con una antorcha eterna, esperando a quien explore lejos.
- **Recolección y crafteo**: hacha, pico y espada; tablones, antorchas, fogatas, muros.
- **Construcciones prefab estilo SimCity** (pestaña «Construcciones» del panel):
  - 🏠 **Cabaña** — fija tu punto de reaparición
  - 🏹 **Torre arquera** — dispara flechas sola a los monstruos
  - 🪚 **Aserradero** / ⛏ **Cantera** / 🫐 **Huerto** — producen recursos con el tiempo; recógelos con clic derecho
  - 🔥 **Brasero** — un gran círculo de luz nocturna
  - 🗿 **Altar antiguo** — invoca al jefe… si te atreves
- **Tres enemigos nocturnos**: babas saltarinas, sombras que caminan sin descanso (sueltan esencia oscura) y murciélagos que vuelan sobre tus muros.
- **El Coloso de Baba**: jefe con barra de vida, salto con onda expansiva, oleadas de esbirros y enfado al 30 % de vida. Viene solo cada 3ª noche o cuando alguien activa un altar. Suelta una corona.
- **Multijugador cooperativo sin PvP**:
  - Chat integrado (tecla `T`) con bocadillos sobre los jugadores.
  - **Lo que construyes es tuyo**: cualquiera puede *usar* tu huerto, tus torres o calentarse en tu fogata, pero solo tú puedes destruirlo.
  - El Coloso escala su vida con los jugadores conectados: es el enemigo de todos, y al caer llueve botín para todos.
  - Bonus «calor de hogar»: regeneras el doble junto a una hoguera con compañía.
  - Reloj y mundo compartidos y persistentes en el servidor.
- **Guardado automático** en localStorage (un jugador) y en `world-server.json` (servidor).

## ⌨ Controles

| Tecla | Acción |
|---|---|
| `WASD` / flechas | Moverse |
| Clic izquierdo (mantener) | Golpear / talar / picar / atacar |
| Clic derecho | Colocar · comer · recoger producción · activar altar |
| `1–9` / rueda | Seleccionar en la barra rápida |
| `E` | Inventario, fabricación y construcciones |
| `T` | Chat (online) |
| `H` | Ayuda |
| `M` | Silenciar |

## 🧱 Cómo está hecho

```
index.html
css/style.css        UI retro (Press Start 2P, marcos pixelados)
js/
  utils.js           hash determinista, ruido de valor, fBm
  config.js          datos: tiles, objetos, items, recetas, enemigos, jefe
  assets.js          TODO el pixel art, generado en canvas al vuelo
  audio.js           sintetizador WebAudio
  world.js           chunks infinitos + biomas + edificios 2x2
  inventory.js       inventario y crafteo
  entities.js        jugador, enemigos (3 IAs), jefe, flechas, drops
  input.js           teclado, ratón y chat
  renderer.js        proyección isométrica, culling, luces, jugadores remotos
  ui.js              HUD, paneles, minimapa, chat, barra del jefe
  save.js            persistencia local (un jugador y por-mundo online)
  net.js             cliente multijugador
  main.js            bucle, día/noche, producción, torres, Noche del Coloso
server.js            estáticos + WebSocket artesanal + autoridad del mundo
tools/bot.js         bot de pruebas del multijugador
```

Sin build, sin framework, sin `npm install`. Nada de dependencias: ni en el cliente ni en el servidor.

## 🗺 Hoja de ruta

- [x] Construcciones con función (producción, defensa, luz, respawn)
- [x] Jefe cooperativo y nuevos enemigos
- [x] Multijugador con chat y propiedad de construcciones
- [ ] Intercambio de objetos entre jugadores
- [ ] Minerales (carbón, hierro) y segundo nivel de herramientas
- [ ] Animales pasivos y agricultura plantable
- [ ] Más jefes (uno por bioma)
- [ ] Soporte táctil para móvil

## Licencia

[MIT](LICENSE)
