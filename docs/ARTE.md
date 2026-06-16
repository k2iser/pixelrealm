# 🎨 Plan de arte: PixelRealm a nivel Stardew

Resultado de la investigación multiagente (junio 2026): packs, librerías, herramientas y técnicas.

## Decisión de motor: quedarse con el engine propio

El engine casero ya resuelve lo difícil del isométrico 2:1 (orden de profundidad por entidad, culling, transiciones, capa de luz) — justo lo que Phaser/melonJS hacen *peor* con sprites intercalados entre tiles altos. El ecosistema iso de JS es Tiled-céntrico: el peor encaje para un mundo procedural mutable en multijugador. **El salto a Stardew es un problema de arte, no de tecnología.**

- Única excepción futura: [PixiJS](https://github.com/pixijs/tilemap) (MIT) como backend WebGL si algún día hacen falta shaders o cae el FPS.
- Unity: existe MCP maduro ([CoplayDev](https://github.com/CoplayDev/unity-mcp), [IvanMurzak](https://github.com/IvanMurzak/Unity-MCP), [oficial de Unity](https://docs.unity3d.com/Packages/com.unity.ai.assistant@2.0/manual/unity-mcp-overview.html)) pero exige editor instalado, builds WebGL de 5-25 MB y perder la carga instantánea + el multijugador propio. Descartado.

## Plan en 5 pasos (impacto/esfuerzo)

| # | Qué | Estado |
|---|---|---|
| 1 | **Paleta Apollo + clusters de hierba** — sustituir hex ad-hoc por rampas de [Apollo](https://lospec.com/palette-list/apollo) (alt.: [Resurrect 64](https://lospec.com/palette-list/resurrect-64)); variantes de hierba con matas, según [Slynyrd](https://www.slynyrd.com/blog/2019/8/27/pixelblog-20-top-down-tiles) | ✅ hecho |
| 2 | **Auto-tiling dual-grid de 16 máscaras + dithering Bayer** — [técnica dual-grid en JS](https://excaliburjs.com/blog/Dual%20Tilemap%20Autotiling%20Technique/), [Bayer 4x4](https://en.wikipedia.org/wiki/Ordered_dithering), referencia de máscaras 2:1: [TileGen](https://github.com/jrouillard/TileGen); ampliación: [blob de 47](https://www.boristhebrave.com/permanent/24/06/cr31/stagecast/wang/blob.html). El gancho ya existe (fringes en renderer.js) | pendiente |
| 3 | **Caminos, vallas y cultivos** procedurales con el sistema del paso 2; checklist de cobertura: [pack de Vituri](https://gvituri.itch.io/isometric-trpg) | pendiente |
| 4 | **Pipeline de arte a mano**: [Aseprite](https://www.aseprite.org/) (19,99 USD, CLI exporta atlas) o gratis [LibreSprite](https://libresprite.github.io/) + [free-tex-packer](https://free-tex-packer.com/) (MIT) → `textures/pack.json` (ya soportado; formato `frame` compatible) | ✅ loader listo |
| 5 | **Packs externos selectivos** (solo CC0/CC-BY por ser repo público) | cuando haga falta |

## Packs candidatos (investigados con licencia verificada)

| Pack | Licencia | Encaje |
|---|---|---|
| [Iso Town Pack — Screaming Brain Studios](https://screamingbrainstudios.itch.io/iso-town-pack) | **CC0** | Rombo 2:1 a 128x64 **exacto a nuestra resolución**; 443 tiles + packs hermanos de suelos/muros. Estilo "render retro", algo frío |
| [Isometric 64x64 Outside — Yar (OGA)](https://opengameart.org/content/isometric-64x64-outside-tileset) + [edificios medievales](https://opengameart.org/content/isometric-64x64-medieval-building-tileset) | **CC-BY 3.0** (acreditar) | Pixel art iso clásico 64x32, lo más "Stardew isométrico" gratis; paleta apagada (re-colorear con Apollo) |
| [Pixel Art Isometric Map Tileset — Newc42](https://newc-42.itch.io/pixel-art-isometric-map-tileset) | **CC0** | 69 tiles, 6 biomas, paleta Endesga 32; minimalista, útil como relleno |
| [PIXEL FARM — Chema Luque](https://chemaluque.itch.io/pixel-farm-64-isometric-farm-tiles) | Comercial 14,99 € · **no redistribuible** | El más Stardew temáticamente; NO commiteable al repo público (servir aparte si se compra) |
| [16x16 Pixel Isometric Village — Xilurus](https://xilurus.itch.io/pixel-isometric-village) | Gratis · no redistribuible | Bonito pero chunky; mismo problema legal |
| [Sprout Lands — Cup Nooble](https://cupnooble.itch.io/sprout-lands-asset-pack) | Free no-comercial / Premium 3,99 $ | Stardew-like real pero **top-down**: adaptarlo a iso = redibujarlo |

**Regla legal del repo (público)**: solo CC0/CC-BY se commitea; lo demás, servido fuera o descartado.

## Qué NO hacer

- No migrar a Phaser/melonJS/Excalibur/KAPLAY (esfuerzo alto, ganancia visual nula)
- No comprar TexturePacker (free-tex-packer lo cubre)
- No usar Kenney/CraftPix para esto (estilo flat/vector, choca con el pixel art)
- No adaptar terreno top-down a isométrico (equivale a redibujar)
- [Tiled](https://www.mapeditor.org/) solo como fase posterior para estampar zonas diseñadas a mano (pueblos) sobre el mundo procedural

## Atmósfera v7 — post-procesado sin assets (junio 2026)

Mejoras puramente de código (cero arte nuevo): el mismo truco que da a Stardew/Eastward su "ambiente" sin tocar los sprites.

- **Ciclo de color del cielo** (`SKY_KEYS` + `sampleSky` en main.js): keyframes por fracción del día que interpolan un tinte a pantalla completa (`G.grade`, rgba) y el color del velo nocturno (`G.veil`). El render aplica `grade` como capa de color y `veil` como base del agujereado de luz. Amanecer dorado → mediodía neutro → atardecer ámbar → noche azul.
- **Estrellas** fijas a pantalla (posición por `hash2`, titileo por seno, mezcla `lighter`) cuando `G.darkness > 0.55`.
- **Viento** (`SWAY_AMP` + `windAt` en renderer.js): la vegetación se inclina cizallando el sprite con `g.transform` (base anclada, cima desplazada). Ráfaga global (envolvente lenta) + onda local desfasada por casilla. `G.windBoost` lo intensifica con el clima.
- **Partículas ambientales**: motas de polen a contraluz de día (parallax suave con la cámara), luciérnagas que vagan y parpadean de noche, ascuas que ascienden de las luces cálidas. Todo derivado de `hash2(i,...)` + `G.elapsed`, sin estado persistente.
- **Viñeta**: gradiente radial que oscurece bordes, más marcado de noche.
- **Clima** (`updateWeather` en main.js, `drawWeather`/`drawRain`/`drawSnow` en renderer.js): programador local de lluvia/tormenta/nieve con intensidad por fundido; nieve si `world.snowyAt()` (ruido de temperatura/elevación). Relámpago = destello + sacudida + trueno con retardo luz→sonido. Audio de lluvia en bucle (ruido marrón filtrado, WebAudio). La lluvia riega los cultivos.

Coste: todo es overlay 2D y aritmética por píxel/partícula; sin allocations por frame salvo los gradientes radiales de luces/viñeta (pocas decenas).

## Overhaul "Diorama iluminado" — render HD sin dejar Canvas 2D (junio 2026)

Decisión tras un panel de diseño multiagente: el 80% del salto viene de (1) matar el upscale pixelado y (2) una cadena de post sobre un buffer de escena. Se descartó WebGL, normal-maps horneados, redibujo total del arte, aberración cromática/god-rays y blur a pantalla completa por frame. Implementado por etapas (cada una detrás de `CFG.GFX` 0/1/2):

- **Render nativo** (`main.js` resize/setZoom, `css/style.css`, `renderer.js`): el backing-store va a `innerW·dpr` (tope `CFG.MAX_DPR`) con `imageSmoothingEnabled=true`; el zoom es escala de mundo vía `g.setTransform(G.renderScale)` y se dibuja en px lógicos (`G.viewW/viewH=innerW/zoom`). `w2sx/w2sy/CFG.HW/HH` intactos → el orden de profundidad es inmune. Cursor y culling pasan a px lógicos.
- **Oclusión de contacto + sombras** (`renderer.js`): `shadow()` es una elipse radial horneada; sombra proyectada = silueta negra cacheada por sprite (WeakMap), cizallada por `sunShadow()` según `G.time` (larga con sol bajo, nula de noche).
- **Buffer de escena + bloom** (`renderer.js`): el mundo se dibuja a `sceneCv` y `composite()` lo vuelca con bloom de altas luces (downscale 1/4 + multiply consigo mismo para aislar brillos + suma `lighter`, intensidad por `G.darkness`). Los overlays de UI se pintan **después**, nítidos.
- **Agua reflectante** (`renderer.js`): tinte de cielo por hora + banda especular por rombo, espuma de orilla reutilizando el sistema de fringe, y ondas concéntricas al vadear.
- **Tilt-shift + rim light** (`renderer.js`): desenfoque (1/2 res) arriba/abajo con banda nítida en el jugador (máscara vertical `destination-in`); rim light de luna con silueta teñida cacheada para separar figuras del fondo de noche.

Buffers offscreen: `sceneLayer` (nativo), `bloomLayer` (1/4), `blurLayer` (1/2), `tiltLayer` (nativo) — recreados solo al cambiar de tamaño. `CFG.GFX<2` cae al render directo (sin buffer ni bloom/tilt); `CFG.GFX=0` también sin sombras/agua avanzada.
