# ZeroTouch — guía para agentes (Claude)

`AGENTS.md` es la autoridad sobre alcance, seguridad y Git; este archivo resume la arquitectura y las convenciones para retomar el trabajo sin repetir auditorías. **Antes de tocar código, lee `PROGRESO.md`** (fases hechas, pendientes, archivos y errores conocidos) y comprueba el estado real con `git status` y las pruebas.

## Arquitectura (una implementación vigente por componente)

| Componente | Ruta | Tecnología | Notas |
|---|---|---|---|
| Backend de cuentas y configuraciones | `backend/` + `db/schema.sql` | Node 24, Express 5, better-sqlite3, Argon2id | API `/api/v1`, SQLite v3 (9 tablas; abre v2 sin idempotencia) fuera del repositorio (`DATABASE_PATH`). Pruebas: `npm test --prefix backend` (+ `backend/test/integration`). |
| Interfaz de escritorio | `src/` | React 19, Vite 8 | `npm run build:app` → `dist-app` (Tauri); incluye el teclado `#airswipe` y el HUD `#hud`. `build:mobile` existe, pero la web móvil está fuera de alcance (`docs/cambio-alcance-movil.md`). El prototipo histórico del Hito 1 vive en `prototype/` y se construye con `npm run build` (GitHub Pages); no se modifica. |
| Puente nativo | `desktop/src/{main,bridge,engine}.rs` | Tauri 2, reqwest (rustls + webpki roots) | Cliente HTTP nativo con cookie/CSRF en memoria; lanza el motor Python como proceso hijo (JSON-lines, ACK por comando). |
| Motor gestual local | `motor-local/motor_local/` | Python 3.11, MediaPipe 0.10.13, OpenCV, pynput | Capas: capture → detector → interpreter → action_engine → os_adapter; `gaze.py` (orientación de cabeza); `capabilities.py` + `capacidades.json`. Pruebas: `motor-local/.venv/Scripts/python.exe -m pytest motor-local/tests`. |
| Contrato de capacidades | `contracts/capacidades.json` | JSON | Fuente única gesto → acciones permitidas, interruptores de interfaz, teclas permitidas. Copia en `motor-local/motor_local/capacidades.json` (prueba `test_capacidades.py` exige igualdad). |
| Pruebas de frontend puro | `tests/frontend/*.test.js` | `node --test` | Preferencias, sincronización (API falsa), configuración del motor, decodificador Air-Swipe. |

Flujo de datos: la interfaz guarda preferencias por cuenta en `localStorage` (`src/data/preferences.js`, esquema 2), construye la configuración IPC (`src/engine/engineConfig.js`) y la envía al motor por el puente con confirmación (`engine_update_config` → ACK con `config` aplicada). La sincronización con la API (`src/sync/syncEngine.js`) es por identidad (UUID) y `version`; los conflictos se devuelven a la persona usuaria, nunca se sobreescriben en silencio.

Estado de la interfaz (`src/hooks/`): `useWorkspace` (preferencias v2 por cuenta, guardado en la misma acción que el cambio, bloqueo durante la sincronización), `useEngine` (telemetría, comandos y estado guardado/pendiente/aplicado/rechazado de la configuración enviada al motor; apaga el modo teclado Air-Swipe huérfano) y `useAccount` (cuenta y `runSync`). La lógica de decisión vive en módulos puros con pruebas (`src/sync/syncSession.js`, `src/engine/engineApply.js`, `src/airswipe/session.js`); los hooks son pegamento sin pruebas automáticas. Contrato de recuperación de la sincronización y del borrado condicional: `src/sync/README.md`. `DELETE /perfiles/{id}` y `/modos/{id}` exigen `If-Match` (428 sin él, 412 si algo cambió): el ETag de un modo cubre su versión y el de un perfil es un agregado con todos sus modos (`backend/src/domain/etag.js`, `src/sync/etag.js`, vectores en `contracts/etag-vectores.json`); nunca envíes un DELETE sin esa precondición. Las creaciones (`POST /perfiles` y `/perfiles/{id}/modos`) son idempotentes con `Idempotency-Key` (UUID v7; esquema SQLite **v3**, migración explícita `db/migraciones/002_v2_a_v3.sql`; una base v2 responde 501 a la clave): el cliente la usa solo si `GET /capacidades` anuncia `servidor.idempotencia`, la guarda en `syncOperation.key` y la reutiliza al reintentar y al recuperar una creación interrumpida (`src/sync/idempotency.js`, ver `src/sync/README.md`); sin clave utilizable vuelve el conflicto `resultado_incierto`. Un modo y sus asignaciones viajan en UNA solicitud atómica (`gestos` dentro de `POST /perfiles/{id}/modos` y `PATCH /modos/{id}`, una sola subida de versión) cuando `GET /capacidades` anuncia `servidor.modo_con_asignaciones`; sin el anuncio el cliente usa los dos pasos de siempre y nunca manda `gestos`. Teclado Air-Swipe: ventana overlay en `index.html#airswipe` (`src/airswipe/AirSwipeOverlay.jsx`; lógica pura en `keyboard.js`, `session.js` y `link.js`; escribe solo al confirmar); la ventana principal lo controla con `useAirswipeLink` y sabe si sigue vivo por un latido en `localStorage`.

## Convenciones

- Español en DTO, mensajes y documentación; `snake_case` en la API, `camelCase` en IPC/interfaz.
- Ajustes del **equipo** (mano, cámara, espejo, recorrido, exigencia de detección, gestos de ventana, calibraciones, mirada) no se sincronizan; ajustes del **modo** (velocidad, suavizado, pinza, Desk-Rest, asistencia por mirada) y asignaciones sí.
- Nada ejecuta comandos arbitrarios: el motor solo emite las teclas de `teclas_permitidas` y, con el teclado Air-Swipe abierto, texto imprimible y backspace/enter/space. Rechazo con código estable, nunca sustitución silenciosa por defaults.
- No se guardan vídeo, landmarks ni texto escrito. Los eventos de aplicación (temporizador, precisión, navegación, trazo) van a la interfaz, no al SO.
- El motor empieza en observación; CONTROL exige cámara abierta y Ctrl+Alt+Z activo. Con el puntero habilitado, la mano abierta sostenida lo arma.
- Cada cambio incluye pruebas con datos ficticios y bases temporales. No se afirma nada no medido (FPS, precisión, usuarios).
- Git: sin push/merge/commits automáticos; respaldo del árbol previo en `respaldo/pre-sesion-20261111`. Los cambios previos sin confirmar de otras sesiones se conservan.

## Comandos de verificación

```powershell
npm test --prefix backend
node --test --test-concurrency=1 backend/test/integration/*.test.js
node --test "tests/frontend/*.test.js"
motor-local/.venv/Scripts/python.exe -m pytest motor-local/tests
cargo test --manifest-path desktop/Cargo.toml --locked
npm run lint; npm run build:app; npm run verify:separation
npm run desktop:build; npm run verify:tauri   # Windows: app Tauri real + backend temporal; abre ventanas, sin cámara ni entradas
```

`npm run verify:tauri` (`scripts/verificar-tauri-real.mjs`) es la única prueba que ejecuta el `.exe` real: detectó que la overlay de Air-Swipe cargaba en otro origen (sin `localStorage` compartido ni comandos), con geometría exterior en vez de cliente y robando el foco. Los puentes falsos y `cargo test` no ven nada de eso; úsala tras tocar `desktop/src/main.rs`, las ventanas o el puente. Lo que exige cámara y manos (gestos, clic real sobre la overlay, escritura, precisión del trazo) está en `docs/prueba-manual-hardware.md`.

## Documentos de referencia

`docs/Informe Hito 1.pdf` (compromisos; texto en `tmp/pdfs/Informe Hito 1.txt`), `docs/api/openapi.yaml`, `docs/hito2/*.md` (motor, trazabilidad, pruebas, informe), `CHANGELOG.md`.
