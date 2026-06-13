# 🚀 Despliegue de PixelRealm: VPS, cuentas y partidas en la nube

Plan de arquitectura para pasar de «un server casero» a «cualquiera entra, se loguea con Google y su progreso le espera». Está pensado para ejecutarse por fases: cada fase funciona por sí sola.

## Fase 1 — Un VPS público (1 hora) ✅ listo para hacer ya

El servidor no tiene dependencias: solo hace falta Node ≥ 22 en cualquier VPS (Hetzner ~4 €/mes, DigitalOcean, OVH…).

```bash
# en el VPS (Ubuntu)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
git clone https://github.com/k2iser/pixelrealm && cd pixelrealm
node server.js   # prueba rápida en :5173
```

**Servicio systemd** (`/etc/systemd/system/pixelrealm.service`):

```ini
[Unit]
Description=PixelRealm
After=network.target

[Service]
WorkingDirectory=/home/deploy/pixelrealm
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=5173
User=deploy

[Install]
WantedBy=multi-user.target
```

**TLS + dominio con Caddy** (la opción más simple: TLS automático, y maneja WebSocket sin config extra):

```
# /etc/caddy/Caddyfile
jugar.tudominio.com {
    reverse_proxy localhost:5173
}
```

El cliente ya usa `wss://` automáticamente cuando la página va por HTTPS. Con esto, **cualquier persona del mundo entra por la URL y juega**. El mundo persiste en `world-server.json` (incluirlo en un cron de backup).

> Alternativa sin dominio: `cloudflared tunnel` o Tailscale Funnel sobre el puerto 5173.

## Comerciantes con IA (Gemma) — opcional

Los comerciantes de las aldeas conversan con **diálogo procedural** por defecto (funciona en GitHub Pages, sin servidor). Si sirves el juego con `node server.js`, puedes enchufar un LLM real y `server.js` hará de proxy en `/npc-chat` (sin dependencias). Se activa con variables de entorno:

**Opción A — Ollama local (gratis, privado, sin API key):**

```bash
# instala Ollama (ollama.com) y descarga el modelo
ollama pull gemma3:4b           # ligero; 12b/27b si tienes GPU
# arranca PixelRealm apuntando a Ollama
PIXELREALM_AI=ollama PIXELREALM_MODEL=gemma3:4b node server.js
# (OLLAMA_URL por defecto http://localhost:11434)
```

**Opción B — Google AI Studio (Gemma/Gemini gestionado, capa gratuita):**

```bash
PIXELREALM_AI=google GOOGLE_API_KEY=tu_clave PIXELREALM_MODEL=gemma-3-27b-it node server.js
```

Sin estas variables, el endpoint responde 501 y el cliente cae al diálogo procedural automáticamente. El prompt del sistema se arma con el nombre, oficio y personalidad de cada comerciante (`buildNpcPrompt` en `server.js`), pide respuestas breves en español y en personaje. Hay timeout de 7 s en cliente y 15 s en servidor; cualquier fallo degrada a procedural sin romper la partida.

## Fase 2 — Cuentas con Google (Firebase Auth)

Ya tenéis proyecto de Firebase: solo hay que **pegar la config web** en `js/firebase-config.js` (no se versiona) y añadir el SDK por CDN en `index.html`. Flujo:

1. Botón «Entrar con Google» en la pantalla de título → `signInWithPopup`.
2. El cliente manda el **ID token** en el `hello` → `{ t:'hello', idToken, name, look }`.
3. El servidor verifica el token **sin dependencias**: el ID token es un JWT RS256; basta con descargar las claves públicas de Google (`https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`, cachear según `max-age`) y verificar con `crypto.verify()` (~80 líneas, ya planificadas).
4. `uid` de Firebase pasa a ser el `pid` permanente → la **propiedad de construcciones queda ligada a la cuenta**, no al navegador. Nombre y avatar de Google como valores por defecto.

Los invitados pueden seguir entrando sin cuenta (pid local como ahora) — decisión de diseño: no poner barreras a probar el juego.

## Fase 3 — Partidas en la nube (Firestore)

Estructura mínima:

```
users/{uid}
  profile: { name, look, createdAt }
  saves/{saveId}: { name, seed, day, time, player, inv, chunks (gzip+base64), updatedAt }
```

- **Un jugador**: botón «Guardar en la nube» / lista «Mis mundos» en el título. El JSON de guardado actual ya es serializable tal cual; los chunks comprimidos con `CompressionStream('gzip')` (nativo del navegador, sin librerías). Límite Firestore 1 MB/documento → trocear `chunks` en subcolección si crece (un doc por chunk ya editado: clave natural `cx,cy`).
- **Multijugador**: la posición/inventario por mundo (`pixelrealm.mp.*`) se guarda en `users/{uid}/worlds/{worldId}` — entras desde cualquier dispositivo y sigues donde estabas.
- Reglas de seguridad Firestore: `request.auth.uid == userId` y validación de tamaño.

## Fase 4 — Lista de servidores

Una colección pública `servers/{serverId}: { name, url, players, day, updatedAt }`:

- Cada VPS hace *heartbeat* cada 60 s (REST de Firestore con una API key restringida, sin SDK).
- La pantalla de título lista los servidores activos («El bosque de Marta — 4 jugando, día 23») y conecta al elegido.
- Esto permite que cualquiera de la comunidad levante su mundo y aparezca en la lista.

## Fase 5 — Enganche y curiosidad (diseño)

Lo que ya empuja a volver: el Coloso cada 3ª noche, las **ruinas antiguas** (v3), la base que produce sola mientras no estás. Siguientes imanes, por impacto/esfuerzo:

1. **Más estructuras descubribles**: torres abandonadas con botín, jardines de flores únicas, un pino gigante… (el sistema de ruinas ya es generalizable por plantillas).
2. **Tablón del mundo**: «Esta semana: 14 Colosos derrotados · constructora top: Marta» — datos que el servidor ya conoce.
3. **Libro de visitas en la cabaña**: dejar un mensaje que otros leen al pasar.
4. **Mascotas** que te siguen (drop raro del Coloso).
5. **Eventos de servidor**: «luna de sangre» (doble enemigos, doble botín) que el server anuncia por chat.

## Resumen de decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Proxy | Caddy | TLS automático y WebSocket sin fricción |
| Proceso | systemd | Sin PM2: una dependencia menos que mantener |
| Auth | Firebase (Google) con invitados permitidos | Ya lo tenéis; cero fricción para probar |
| Verificación de token | JWT RS256 a mano con `crypto` | Mantiene el server sin dependencias |
| DB | Firestore | Ya en vuestra cuenta; reglas declarativas |
| Identidad | `uid` Firebase = `pid` del juego | Propiedad de construcciones por cuenta |

**Siguiente paso concreto**: pásame la config web de vuestro proyecto Firebase (apiKey, authDomain, projectId…) y monto la Fase 2 completa con su verificación en el servidor.
