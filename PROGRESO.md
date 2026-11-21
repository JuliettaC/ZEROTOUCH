# PROGRESO — ZeroTouch (sesión iniciada el 11 de noviembre de 2026)

Archivo de continuidad. Léelo antes de retomar; actualízalo al cerrar cada fase. Rama de trabajo: `codex/h2-seguridad-verificacion`. Sin push, merge ni commits en esta sesión. Respaldo del árbol previo (cambios sin confirmar de sesiones anteriores): rama local `respaldo/pre-sesion-20261111` (`d993719`).

## Estado por fase

| Fase | Estado | Evidencia |
|---|---|---|
| 0. Diagnóstico y revalidación de la auditoría | Hecha | Los 5 problemas de la auditoría seguían presentes (ver "Diagnóstico"). Base: backend 40/40, motor 97/97. |
| 1a. Contrato de capacidades + preferencias v2 + configuración IPC + sincronización por identidad/versión (módulos puros) | Hecha | `node --test "tests/frontend/*.test.js"` → 14/14. |
| 1b. API de asignaciones (PUT/PATCH `/modos/:id/gestos`, GET `/capacidades`) | Hecha | `node --test backend/test/resources/asignaciones.test.js` → 5/5; suite de recursos 13/13. |
| 1c. Motor: formato IPC 2 (mapa `gestos`, `activeBox`, `gaze`), exportación alineada al contrato, gestos nuevos (mano abierta sostenida, pulgares, precisión, palma), acciones (teclas permitidas, multimedia, temporizador, eventos de aplicación), trazo Air-Swipe, mirada por orientación de cabeza, comandos AIRSWIPE/TYPE_TEXT/PRESS_KEY/GAZE_CALIBRATE | Hecha | `pytest motor-local/tests` → 136/136 (1 `hardware` deseleccionada). |
| 1d. Puente Tauri: comandos de asignaciones/capacidades, eventos del motor, Air-Swipe (ventana no activable y escritura), HTTPS con raíces webpki | Hecha (compila) | `cargo build --manifest-path desktop/Cargo.toml` → OK (2 min 29 s, `Cargo.lock` actualizado por `rustls-tls-webpki-roots`). **Pendiente** `cargo test` (3 pruebas de bridge + 3 de engine). |
| 2. Interfaz: perfiles, modos, asignaciones, estado guardado/pendiente/aplicado/rechazado, sincronización con conflictos, invitado/cuentas | **Hecha (11-11-2026, bloque Claude)** | `App.jsx` y páginas sobre `preferences.js` v2 con hooks `useWorkspace`/`useEngine`/`useAccount`; `npm run build:app` compila; recorrido probado en navegador con un puente Tauri **falso** (no con Tauri/motor reales). Ver "Bloque Claude — integración de la interfaz". |
| 3. Catálogo gestual en la interfaz (lista de gestos, editor por modo) | **Hecha (16-11-2026)** | Editor de asignaciones con ayuda de cómo se hace cada gesto y efecto de la acción; renombrar y recategorizar modos (✎ en Inicio). Pendiente: prueba con cámara. |
| 4. Air-Swipe: distribución (`src/airswipe/layout.js`), decodificador local tipo SHARK² (`decoder.js`) y léxico `lexico-es.json` (40 000 palabras, MIT) | Módulos puros hechos (6 pruebas en `tests/frontend/airswipe.test.js`) | **Límite conocido**: la lista de pyspellchecker omite palabras comunes (`gracias`, `temporizador`, `adios` sin acento). Completar con otra fuente libre (p. ej. hunspell es_ES MPL/LGPL o wordfreq CC BY-SA) antes de presentarlo como terminado. Falta la UI (ventana overlay, página de práctica, escritura por `engineTypeText`). **Contrato de sesión ya implementado y probado** en `src/airswipe/session.js` (rechazos que se descartan, transiciones tras parada de emergencia, cierre `engineAirswipe(false)` + ventana, apagado del modo teclado huérfano — este último ya activo en `useEngine`). **Actualización 12-11-2026:** la UI existe (ventana overlay `#airswipe`, página `/teclado` con requisitos y campo de práctica, escritura al confirmar) y el léxico se completó con una lista complementaria propia (ver "Bloque Claude — teclado Air-Swipe"); **sin probar con Tauri, motor ni cámara reales**. |
| 5. Multimedia y temporizadores en la interfaz | **Hecha (16-11-2026)** | Panel «Temporizadores y multimedia» en Inicio, temporizadores visibles en todas las páginas, avisos de multimedia y ventanas desde el motor. Ver bloque del 16-11. |
| 6. Frontend móvil | Pendiente | Modo Vite `mobile`, navegación inferior, estados "no disponible". |
| 7. Servicio remoto (backend HOST no loopback con HTTPS, SMTP por entorno, respaldo/restauración, despliegue) | Pendiente | |
| 8. Empaquetado Tauri (bundle, runtime Python, recursos) | Pendiente | `bundle.active: false` hoy. |
| 9. Pruebas de regresión, verificador de separación (9 tablas), prueba vertical, CI, README, OpenAPI, trazabilidad, matriz Hito 1 | **Hecha (16-11-2026)** salvo prueba física | CI con backend, interfaz, motor (Windows) y `cargo test` (Windows); README reescrito; `docs/matriz-hito1.md`. |

## Siguiente paso concreto

0. Ejecutar `cargo test --manifest-path desktop/Cargo.toml` (requiere Node y el backend del clon) y `npm run lint`.
1. (hecho) `desktop/src/engine.rs`: campos nuevos en `EngineStatus` (pointerArmed, precision, airswipe, tracing, gaze, hotkeyActive, appliedConfig, eventSeq, recentEvents), parseo de mensajes `EVENT`, comandos `set_airswipe`, `type_text`, `press_key`, `gaze_calibrate`.
2. `desktop/src/bridge.rs`: `mode_gestures`, `set_mode_gestures`, `capabilities`; `ContextInput` con `categoria` y `gazeAssist`; base HTTPS con validación de certificados (`rustls-tls-webpki-roots`).
3. `desktop/src/main.rs`, `build.rs`, `capabilities/main.json`: registrar comandos; ventana `airswipe` (no activable, siempre encima) y `airswipe_window_rect`.
4. `cargo build` (actualiza `Cargo.lock` por la feature de reqwest) y `cargo test`.
5. (hecho, ver bloque Claude) Reescribir `src/App.jsx` sobre `src/data/preferences.js` v2.

## Diagnóstico inicial (revalidación de la auditoría)

| # | Problema | Estado al inicio | Estado ahora |
|---|---|---|---|
| 1 | `getContextSettings()` omitía interruptores; defaults UI/Python distintos | Presente | Corregido en módulos puros (`preferences.js` v2, `engineConfig.js`, `config.py` con defaults del contrato). Falta conectar `App.jsx`. |
| 2 | `handleSync()` copiaba por nombre, sin ediciones ni borrados | Presente | `syncEngine.js` por identidad/versión con lápidas y conflictos (14 pruebas). Falta conectar `App.jsx`. |
| 3 | Clave local única entre cuentas | Presente | Espacios `zerotouch:prefs:v2:<usuario|invitado>`; importación de invitado explícita (`importGuestInto`). Falta conectar `App.jsx`. |
| 4 | Exportación habilitaba acciones no implementadas | Presente | Contrato de capacidades; backend rechaza `ACCION_NO_COMPATIBLE`; el motor implementa las 13 acciones predeterminadas; exportación por defecto cargable (`test_catalog_defaults_all_enabled_are_loadable`). |
| 5 | Errores de aplicación de configuración descartados | Presente | El motor devuelve `config` aplicada en el ACK. Falta el estado guardado/pendiente/aplicado/rechazado en la interfaz. |

Otros: `scripts/verify-separation.cjs` exige 7 tablas (hay 8); `desktop/tests/vertical-smoke.js` usa selectores antiguos; CI solo backend; `bundle.active: false`; `reqwest` sin raíces TLS.

## Archivos de esta sesión

Nuevos: `src/api/client.js` (comandos nuevos), `src/airswipe/{layout,decoder}.js`, `src/airswipe/lexico-es.json`, `src/airswipe/LEXICO-LICENCIA.txt`, `tests/frontend/airswipe.test.js`, `contracts/capacidades.json`, `motor-local/motor_local/{capabilities.py,capacidades.json,gaze.py}`, `motor-local/tests/{test_capacidades,test_gestos_catalogo,test_mirada,test_ipc_nuevos}.py`, `backend/src/domain/capacidades.js`, `backend/test/resources/asignaciones.test.js`, `src/data/capabilities.js`, `src/engine/engineConfig.js`, `src/sync/{syncEngine,retry}.js`, `src/api/paging.js`, `tests/frontend/{fakeApi,preferences.test,sync.test}.js`, `CLAUDE.md`, `PROGRESO.md`.

Reescritos: `desktop/src/{engine,main}.rs`, `desktop/build.rs`, `desktop/capabilities/main.json`, `desktop/Cargo.toml` (feature TLS), `docs/api/openapi.yaml` (1.2.0: PUT/PATCH asignaciones, GET /capacidades), `src/data/preferences.js` (v2), `motor-local/motor_local/{config,api_export,interpreter,action_engine,main}.py`, `backend/src/{services/catalogosService,repositories/catalogosRepository,controllers/catalogosController,routes/modosRoutes,routes/catalogosRoutes}.js`.

Editados: `desktop/src/bridge.rs` (ContextInput con categoria/gazeAssist, GesturesInput, mode_gestures/set_mode_gestures/capabilities/backend_info, base https remota), `backend/src/app.js` (auth en `/capacidades`), `motor-local/motor_local/os_adapter.py` (teclas del contrato, `type_text`, `press_key`), pruebas del motor (`armed()`, barridos explícitos, exportación por contrato).

Cambios previos de otras sesiones sin confirmar (no tocados salvo donde se indica): ver `CHANGELOG.md` → "Cambios preexistentes sin confirmar".

## Decisiones técnicas

- **Contrato único** `contracts/capacidades.json`; el motor lleva copia (se distribuye sin el repo) verificada por prueba.
- **Sin cambios de esquema SQLite**: ajustes nuevos sin columna (recorrido, exigencia, mirada del equipo) quedan locales. `asistencia_mirada_habilitada` del modo activa la asistencia solo si el equipo la tiene habilitada y calibrada.
- **Versión única por modo**: PUT/PATCH de asignaciones incrementan `modos_uso.version`, así la sincronización compara una sola versión.
- **Identidad local = remota**: al crear en la API se adopta el UUID remoto; borrados de recursos sincronizados dejan lápida.
- **Modos incorporados** son modos reales (categoría manual/oficina/accesibilidad); icono por categoría.
- **Defaults**: barridos y pulgares apagados por defecto (UI y motor); precisión, palma, Air-Swipe encendidos.
- **Gestos nuevos** (hipótesis sin calibrar): pulgares = puño + pulgar extendido 500 ms; precisión = índice + meñique 400 ms; palma sostenida quieta 900 ms; armado = mano abierta 350 ms; desarme por pausa o mano perdida 1,5 s; trazo Air-Swipe = apuntar con el índice (3 fotogramas), cierre tras 4 sin apuntar.
- **Mirada** = orientación de la cabeza con MediaPipe Face Detection (6 puntos), cada 3 fotogramas; retiene (no habilita) la interacción con histéresis 800/300 ms; calibración neutra por mediana de 20 muestras. No es seguimiento ocular.
- **Air-Swipe**: el motor entrega el trazo (puntos normalizados de pantalla); la interfaz decodifica con léxico local; el texto se escribe con pynput solo en CONTROL y con el teclado abierto (ventana no activable).

## Errores conocidos / límites

- Todo lo del motor es sintético (sin cámara real). Pendiente prueba física de pulgares, precisión, palma, trazo y mirada.
- `_HoldGesture` reinicia la confirmación si pasan >150 ms sin evaluar la postura (gap entre ramas); con cámaras por debajo de ~7 fps los gestos sostenidos no confirman.
- `test_ipc_protocol`/`test_ipc_nuevos` no producen TELEMETRY porque STOP se procesa en la primera iteración; las verificaciones de telemetría nueva se hacen en `telemetry_payload` indirectamente (pendiente prueba dedicada).


## Corte de sesión (11-11-2026, límite de uso alcanzado)

Último estado verificado: backend 13/13 recursos (suite completa 40 previas + 5 nuevas), motor 136/136, frontend puro 20/20 (`node --test "tests/frontend/*.test.js"`), Tauri compila. Sin commits. Retomar por "Siguiente paso concreto" y luego la fase 2 (interfaz sobre el modelo v2: `src/App.jsx` y páginas siguen con el modelo antiguo y NO compilan contra `preferences.js` v2 hasta reescribirse; `npm run build:app` fallará mientras tanto).


## Bloque Codex — sincronización recuperable (11-11-2026)

Corrección posterior a los estados anteriores: el módulo de sincronización no estaba listo en los casos de fallos parciales y borrados concurrentes. En la misma rama codex/h2-seguridad-verificacion, sin commits:

- Nombres de hasta 60 caracteres: sufijo reservado, NFC y sin cortar pares Unicode; misma función para importación de invitado.
- Cada mutación guarda intención/recibo en syncOperation y conserva UUID, versión y cambios locales confirmados. Los errores entregan error.state. onCheckpoint debe persistir el estado por cuenta antes de seguir; su integración en App.jsx queda pendiente.
- POST incierto no se repite automáticamente. Recuperación por elección explícita de remoteId; sin candidato sigue bloqueado. PATCH/PUT se recupera con la versión original y puede requerir resolver un conflicto.
- DELETE no se envía: marcas con versiones y dependencias permanecen pendientes (también las antiguas). Comparar desde el cliente no garantiza atomicidad. Propuesta de If-Match/ETag de agregado e idempotencia en src/sync/README.md, aún sin backend ni migraciones.
- Archivos de este bloque: src/sync/syncEngine.js, src/sync/names.js, src/sync/README.md, src/data/preferences.js, tests/frontend/sync.test.js, tests/frontend/preferences.test.js, tests/frontend/sync-recovery.test.js y esta nota. Se preservó el trabajo previo.
- Verificación: node --test tests/frontend/*.test.js → 39/39 (19 nuevas). Adaptadores en memoria y recarga JSON; cierre simulado, no reinicio real ni validación UI/Tauri/HTTP. No se ejecutó motor/cámara ni se tocaron bases reales, dependencias, App.jsx, páginas, Python o Rust.
- Calidad: ESLint de src/sync, preferencias y sus pruebas terminó con código 0. Revisión de los cambios y comprobación de espacios con git diff --check (incluyendo archivos no versionados vía --no-index); solo avisos de conversión LF/CRLF.
- Traspaso: Claude debe leer src/sync/README.md, serializar sincronización/edición/cambio de cuenta, conectar onCheckpoint y error.state y mostrar resultado_incierto/borrado_no_seguro sin anunciar éxito completo. Modo y asignaciones siguen siendo dos operaciones; falta transacción conjunta si se requiere visibilidad atómica.

Implementación asistida por Codex; revisión humana pendiente.


## Bloque Claude — integración de la interfaz (11-11-2026)

Rama `codex/h2-seguridad-verificacion`, sin commits. Se retomó tras los traspasos de Codex (sincronización recuperable) y Gemini (endurecimiento de Air-Swipe en el motor). No se tocó Python, Rust ni backend.

**Implementado**
- `App.jsx` y páginas sobre `preferences.js` v2 con tres hooks (`src/hooks/`): `useWorkspace` (un espacio por cuenta, guardado en la misma acción que el cambio, bloqueo durante la sincronización), `useEngine` (telemetría sin peticiones solapadas, comandos, estado guardado/pendiente/aplicado/rechazado) y `useAccount` (sesión, `runSync`, copia explícita de ajustes de invitado).
- Perfiles y modos (crear, seleccionar, eliminar con aviso), editor de asignaciones del modo activo (Calibrar), diálogo de decisiones de sincronización (`SyncConflicts`) con «Cancelar el borrado y recuperarlo».
- Estado de la configuración del motor: se envía una vez por cambio y solo tras READY; un rechazo o una confirmación distinta se muestra y no se reintenta en bucle. La comparación semántica (`engineApply.js`) se contrastó con el validador real del motor (`EngineConfig.from_dict().to_dict()`, solo parseo; fixture en `tests/frontend/fixtures/engine-applied.json`).
- Contrato de Air-Swipe de Gemini en `src/airswipe/session.js`: los cinco rechazos (`AIRSWIPE_INACTIVE`, `CONTROL_REQUIRED`, `INTERACTION_PAUSED`, `GAZE_HOLD`, `TRACKING_LOST`) se descartan sin reintento; transiciones tras parada de emergencia (limpiar y reabrir solo con CONTROL, ventana abierta y trazo habilitado); `closeAirswipe` apaga el motor y luego la ventana. **Ya activo:** `useEngine` apaga el modo teclado «huérfano» (con él encendido, Confirmar/Cancelar/Atrás/Adelante no llegan al sistema).
- Corregido de paso: al abrir un diálogo, `showModal()` enfocaba «Cerrar» y anulaba el `autoFocus`; escribir un nombre y pulsar Intro cerraba «Nuevo modo» sin crearlo.

**Verificación real (comandos y resultados)**
- `node --test "tests/frontend/*.test.js"` → **66/66** (39 previas + 27 nuevas en `sync-session`, `engine-apply`, `airswipe-session`, `ui-state`). Se comprobó con mutaciones que las pruebas de `runSync` fallan si se rompe la cuenta capturada o el criterio de éxito.
- `npx eslint src --max-warnings 0` → código 0. `npm run lint` (todo el repo) → 0 errores y 1 aviso previo en `prototype/src/App.jsx` (prototipo histórico, no se modifica).
- `npm run build:app` → compila (antes fallaba contra `preferences.js` v2).
- `cargo test --manifest-path desktop/Cargo.toml --locked` → **6/6** (bases temporales aisladas).
- **Recorrido manual en navegador con un puente Tauri falso** (API de pruebas en memoria y motor simulado): crear modo y guardado inmediato; activar cámara, cambiar gesto, rechazo del motor y «Reintentar» (un solo envío por cambio); inicio de sesión, primera sincronización (1 perfil, 3 modos, asignaciones), conflicto de versión resuelto con decisión explícita, borrado local bloqueado (sin DELETE) y su cancelación, fallo a medias, respuesta perdida con candidato (un único POST en el servidor), cierre de sesión/espacios separados/copia de invitado, recarga con sesión previa, bloqueo durante la sincronización, apagado de Air-Swipe huérfano, editor de asignaciones.
- `npm run verify:separation` → **falla** (esperaba 7 tablas y hay 8): problema previo ya listado, no tocado.
- No se ejecutaron `npm test --prefix backend` ni `pytest motor-local/tests` (sin cambios en esas áreas).

**No probado / pendiente**
- Nada se probó con Tauri, motor o cámara reales ni contra el backend HTTP real; los hooks de React no tienen pruebas automáticas (no hay entorno de pruebas de componentes).
- Air-Swipe: falta la UI real (ventana overlay `#airswipe`, escritura con `engineTypeText`); `/teclado` sigue siendo una demostración. Cuando exista, `keyboardOpen` de `useEngine` debe reflejar su estado, llamar `closeAirswipe` al cerrar/desmontar y usar `airswipeTransition`/`sendText`/`sendKey` (todo ya probado en `session.js`).
- DELETE: resuelto el 12-11-2026 con borrado condicional (ver «Bloque Claude — borrado seguro»); modo y asignaciones siguen siendo dos operaciones; renombrar o recategorizar un modo no tiene interfaz (los perfiles sí se editan); frontend móvil, multimedia/temporizadores en la interfaz y empaquetado siguen pendientes.
- `.env`/bases reales y commits: sin tocar.

Implementación asistida por Claude; revisión humana pendiente.


## Bloque Claude — teclado Air-Swipe (12-11-2026)

Rama `codex/h2-seguridad-verificacion`, sin commits. No se tocó Rust, Python ni backend (el puente ya tenía la ventana `#airswipe`, `airswipe_window_{open,close,rect}` y los comandos `engine_airswipe`, `engine_type_text`, `engine_press_key`).

**Implementado**
- Ventana overlay (`src/airswipe/AirSwipeOverlay.jsx`, `overlay.css`): se carga solo en `index.html#airswipe` (import dinámico en `main.jsx`; el léxico va en trozos aparte, el bundle principal no crece). Lee la telemetría del motor, muestra hasta 5 propuestas por trazo, teclas tocables, Borrar/Espacio/Intro, trazo en vivo y mensajes por motivo (cámara, Controlar, pausa, mirada, mano perdida).
- Modelo de escritura **explícito** (`src/airswipe/keyboard.js`, puro): un trazo propone y no escribe; se escribe al tocar un candidato o con el evento CONFIRM (si la persona lo habilitó). Un trazo nuevo sustituye la propuesta, CANCEL la descarta, BACK/FORWARD recorren candidatos (sin propuesta equivalen a Borrar y Espacio). Auto-escritura de la mejor propuesta: no se hace hasta medir la precisión.
- Contrato de Gemini aplicado: los cinco rechazos de sesión descartan la propuesta y lo encolado, sin reintento; parada de emergencia, parar el motor, salir de CONTROL o desactivar el trazo limpian; reactivar CONTROL con la ventana abierta reabre una sola vez; botón «Reactivar» si el motor cierra el modo. Los eventos anteriores a la sesión se ignoran y un reinicio del motor (secuencia que vuelve a 1) empieza de cero.
- Enlace entre ventanas sin tocar Rust (`src/airswipe/link.js`, `src/hooks/useAirswipeLink.js`): la overlay escribe un latido (solo una marca de tiempo) en `localStorage`; la principal lo usa para saber si hay teclado abierto. Si el latido caduca, `useEngine` apaga el modo teclado huérfano, cierra la ventana y avisa.
- Página `/teclado` (enlace «Teclado» en la cabecera): requisitos (cámara, trazo habilitado en el modo, Controlar), abrir/cerrar, instrucciones y campo de práctica. Marcada como experimental.
- Léxico: `lexico-extra-es.json` (lista propia, 39 palabras). Medido: de 429 palabras de uso común la lista base omitía 42 (≈10 %): «gracias», «buenos», «días», «años», «qué», «cómo»…
- **Defecto encontrado y corregido en el decodificador:** el tope de 6000 candidatos recorría en el orden del índice y descartaba en silencio palabras comunes en grupos densos («gracias»: 7 290 candidatos, la palabra era la última). Ahora cada grupo se ordena por frecuencia y el tope (20 000) es solo una salvaguarda. Coste medido en el peor caso: ≈56 ms por trazo en Node.

**Verificación real**
- `node --test "tests/frontend/*.test.js"` → **79/79** (66 previas + 13 nuevas: `airswipe-keyboard` 9, `airswipe-lexicon` 4). Mutaciones comprobadas: ignorar la secuencia de eventos, escribir sin confirmar y el decodificador anterior hacen fallar las pruebas.
- `npx eslint src --max-warnings 0` → código 0. `npm run build:app` → compila (overlay y léxico en trozos separados).
- Recorrido manual en navegador con un puente Tauri **falso**: la overlay monta (27 teclas, franja de propuestas), proponer sin escribir, escribir al tocar y con CONFIRM, rechazo por pausa (un intento, sin reintento ni cola), parada de emergencia y reapertura (una sola llamada con una instancia), cierre (motor primero, ventana después); página principal: requisitos, abrir/cerrar, fallo de apertura, guardia de huérfanos con latido.
- No se ejecutaron `cargo test`, `pytest` ni backend (sin cambios en esas áreas).

**No probado / supuestos a verificar primero en Tauri real**
- ~~Que las dos ventanas compartan `localStorage`~~: **era falso** (la overlay cargaba en `http://tauri.localhost`, otro origen: sin `localStorage` compartido y con todos sus comandos rechazados por `verify_origin`). Corregido y verificado en la app real el 12-11-2026 (ver «Bloque Claude — verificación en Tauri real»).
- Verificado el 12-11-2026: la overlay es no activable (`WS_EX_NOACTIVATE`) y, tras corregirlo, ya no se queda con el foco al crearse. **Sigue sin probar** que un clic REAL del puntero gestual (ratón del sistema) sobre la overlay llegue a sus botones.
- La alineación trazo ↔ teclas se verificó en un monitor a escala 150 % (el rectángulo del puente era el exterior y desalineaba las teclas; corregido a área cliente). **Sin probar:** varios monitores o escalas distintas, el gesto de apuntar con el índice, la precisión del decodificador y la latencia reales. Nada de esto está medido con cámara.
- El texto escrito no se guarda ni se registra; el latido solo contiene una marca de tiempo.

Implementación asistida por Claude; revisión humana pendiente.


## Bloque Claude — borrado seguro (12-11-2026)

Rama `codex/h2-seguridad-verificacion`, sin commits, **sin cambios de esquema SQLite ni migraciones** (se probó solo con bases temporales en memoria; ninguna base real). Resuelve el bloqueo de DELETE que dejó Codex (`src/sync/README.md`, «Borrado condicional»). Idempotencia de POST y mutación conjunta modo+asignaciones siguen pendientes.

**Implementado**
- **Backend** (`backend/src/domain/etag.js`, repositorios, servicios y controladores de perfiles y modos): `DELETE /perfiles/{id}` y `DELETE /modos/{id}` exigen `If-Match`. 428 si falta; 400 si no es un único ETag fuerte (`*`, débil o lista); 404 si no existe o es ajeno (se comprueba antes, no revela recursos ajenos); 412 si cambió; 204 al borrar; repetir un borrado ya aplicado da 404. ETag de modo = identidad + versión (cubre sus asignaciones). ETag de perfil = **agregado**: versión del perfil + (id, versión) de todos sus modos, de modo que detecta también altas, bajas y ediciones de modos y asignaciones antes de la cascada. Lectura, comparación y borrado ocurren en una transacción `immediate`; el `DELETE` lleva además `AND version=?`. `GET /perfiles/{id}` y `GET /modos/{id}` devuelven la cabecera `ETag`; `GET /capacidades` anuncia `servidor.borrado_condicional`.
- **Contrato**: `docs/api/openapi.yaml` 1.3.0 (parámetro `If-Match`, respuestas 412/428, cabecera `ETag`, campo `servidor`; el archivo se reescribió con JSON estándar: solo cambia el orden de algunos códigos de respuesta); `docs/api/coleccion.json` con los pasos 19b, 19c (428), 19d (412) y 21b; vectores compartidos `contracts/etag-vectores.json`.
- **Puente Tauri** (`desktop/src/{bridge,main}.rs`): `delete_profile`/`delete_context` reciben `if_match` y lo envían como cabecera; sin un ETag válido devuelven `DATOS_INVALIDOS` y no envían nada.
- **Cliente** (`src/sync/etag.js`, `syncEngine.js`, `client.js`): el ETag se calcula con lo que la interfaz conocía al borrar (la marca guarda versión y, en perfiles, los modos con versión). Se envía DELETE solo si el servidor anuncia el borrado condicional. Los modos se borran antes que su perfil. 204 → marca retirada; 404 → «ya borrado»; 412 → conflicto `borrado_modificado` sin borrar nada, con `recuperar` (cancela y descarga lo actual) o `borrar` («de todos modos»: lee el estado actual y borra ESE estado; si cambia otra vez, otro 412). Marcas antiguas sin versión: `borrado_no_seguro/sin_version` (recuperar o borrar con el estado actual). Servidor anterior o sin anuncio fiable: no se envía nada (`borrado_no_seguro/servidor`). Un fallo transitorio al consultar las capacidades interrumpe la sincronización. Repetir un DELETE condicional tras perder la respuesta es seguro (da 404).
- **Interfaz**: textos de borrado actualizados; el informe cuenta «N borrados en tu cuenta»; `SyncConflicts` muestra las dos opciones de `borrado_modificado`.

**Verificación real (comandos y resultados)**
- `npm test --prefix backend` → **53/53** (45 previas + 8 nuevas en `test/resources/borrado.test.js`: 428/400/412/204/404, ETag de modo y de agregado, rechazo sin tocar nada, cascada completa, propiedad, CSRF/sesión, transacción y defensa `changes === 1`). Se actualizaron `api.test.js`, `server.test.js` y `asignaciones.test.js`.
- `node --test --test-concurrency=1 backend/test/integration/*.test.js` → **1/1** (colección ejecutada contra procesos reales, con reinicio).
- `node --test "tests/frontend/*.test.js"` → **94/94** (79 previas + 15 nuevas en `etag.test.js` y `sync-delete.test.js`; 4 pruebas previas pasaron de «DELETE nunca se envía» a su equivalente nuevo y la versión «servidor anterior» se conserva). El doble de la API usa el algoritmo real del servidor.
- `cargo test --manifest-path desktop/Cargo.toml --locked` → **7/7**: incluye el flujo real puente + backend (DATOS_INVALIDOS sin ETag, `PRECONDICION_FALLIDA` con uno obsoleto, borrado correcto con el vigente).
- `npx eslint src --max-warnings 0` → código 0; `npm run lint` → 0 errores y 1 aviso previo en `prototype/`; `npm run build:app` → compila; `pytest motor-local/tests/test_capacidades.py` → 3/3 (el contrato del motor no cambió).
- **Mutaciones comprobadas**: borrar sin comparar el ETag, agregado de perfil sin modos, perfiles antes que modos, tratar el 412 como éxito, asumir soporte sin anuncio y enviar el DELETE sin `If-Match` hacen fallar las pruebas.
- **Recorrido manual en navegador con puente falso** (que usa el algoritmo real): primera sincronización, borrar un modo (DELETE con `If-Match` tras consultar capacidades → «1 borrado en tu cuenta»), cambio concurrente → conflicto «cambió en otro equipo» → «Recuperarlo» (vuelve con el cambio ajeno) y «Borrarlo de todos modos».
- `npm run verify:separation` → **falla** (espera 7 tablas y hay 8): problema previo, no tocado. No se ejecutó `pytest` completo del motor (sin cambios allí).

**Límites y riesgos**
- Cambia el contrato: **todo cliente que haga DELETE debe enviar `If-Match`** (428 si no). No hay clientes externos conocidos; el puente y las pruebas ya lo hacen.
- La garantía vale para un único proceso de backend sobre SQLite (transacción con bloqueo de escritura); no se probó con varios procesos ni con carga concurrente real. La atomicidad se demuestra por construcción (una transacción) y con el espía de la prueba, no con una carrera real entre conexiones.
- «Borrar de todos modos» destruye lo que haya en ese momento (decisión explícita; no sustituye una copia de seguridad).
- Un backend actualizado con un cliente antiguo recibe 428 al borrar; un cliente nuevo con un backend antiguo no borra (sin anuncio).
- La interfaz no se probó con Tauri real; el recorrido en navegador usa un puente falso.

Implementación asistida por Claude; revisión humana pendiente.


## Bloque Claude — verificación en Tauri real (12-11-2026)

Rama `codex/h2-seguridad-verificacion`, sin commits. Primera ejecución del `.exe` real con sus ventanas, el puente Rust, un backend temporal y el motor; hasta aquí todo se había probado con puentes falsos o con `cargo test`.

**Cómo se hizo (aislado y sin hardware)**
- Backend real (`backend/src/server.js`) con base SQLite temporal en loopback y una cuenta de prueba generada; `ZEROTOUCH_BACKEND_URL` apunta a él.
- La app real con un perfil de WebView2 **temporal** (`WEBVIEW2_USER_DATA_FOLDER`; el script aborta antes de escribir si no queda aislado) y un puerto de depuración de WebView2 solo en 127.0.0.1 para leer y accionar las ventanas. Windows se inspecciona con Win32 en modo solo lectura.
- Motor real **solo en OBSERVACIÓN** y con la cámara 9, que no existe: no abre ninguna cámara, no puede pasar a CONTROL (rechaza con `CAMERA_NOT_OPEN`) y por tanto no puede inyectar ratón ni teclado. Nunca se llama a `engine_start` sin configuración (usaría la cámara 0). No se movió el puntero ni se enviaron teclas del sistema. Se comprobó que no quedan procesos, puerto ni carpetas temporales.
- Reproducible: `npm run desktop:build && npm run verify:tauri` (`scripts/verificar-tauri-real.mjs` y `.ps1`; Windows; ~1 minuto; abre ventanas reales; capturas y resultados en `tmp/verificacion-tauri-real/`; se niega a correr si ya hay una instancia de ZeroTouch abierta). No forma parte de CI.

**Defectos reales que esta prueba destapó (todos en `desktop/src/main.rs`, anteriores a este bloque) y quedaron corregidos**
1. La overlay se creaba en `http://tauri.localhost` mientras la principal usa `https://`: otro origen, así que `localStorage` no se compartía (latido invisible) y `verify_origin` rechazaba **todos** los comandos de la overlay (`FORBIDDEN`). Además el guardia de huérfanos la cerraba sola. Corrección: `.use_https_scheme(true)`.
2. `airswipe_window_rect` devolvía el rectángulo exterior (en la prueba 1404×511 en (269,564), con bordes invisibles de 11 px a escala 150 %) en vez del área cliente donde se dibujan las teclas (1382×498 en (280,566)): el trazo habría quedado desfasado ~10 % de una tecla. Corrección: `inner_position()`/`inner_size()`.
3. La overlay se quedaba con el foco del sistema al crearse (`foreground: true`), contra lo que decía la página `/teclado`. Corrección: `.focused(false)`.
4. (Hallado al preparar la guía manual.) **Cerrar la ventana principal con la overlay abierta dejaba vivos el proceso, el motor y, con cámara real, la cámara encendida**, sin ninguna ventana principal desde la que controlarlos (solo quedaba la overlay). Corrección: al destruirse la ventana principal se sale de la aplicación (`RunEvent::WindowEvent` → `exit(0)`, que ya detenía el motor).
Ninguno lo podían detectar las pruebas con puente falso ni `cargo test`.

**Verificación real (resultados)**
- `npm run verify:tauri` → **33/33** comprobaciones (31 iniciales + cierre de la principal con la overlay y el motor en marcha: la aplicación termina y no queda ningún proceso del motor), repetido tras los arreglos y desde el script del repositorio. Antes de los arreglos falló la creación/uso de la overlay. El script abre la overlay emulando el margen de 8 s de `openKeyboard` con un latido sembrado que luego debe REESCRIBIR la propia overlay; sin ese margen, el guardia de huérfanos la cierra mientras carga (comportamiento correcto, pero hacía el arnés inestable). En la última ejecución la sesión de Windows se bloqueó (primer plano: pantalla de bloqueo), así que ese chequeo de foco no fue concluyente esa vez; sí lo fue en la ejecución anterior (primer plano: «ZEROTOUCH»).
- Flujo de borrado condicional por la interfaz real (UI → Tauri → HTTP → SQLite): primera sincronización, borrado con `If-Match`, cambio en otro equipo → 412 y decisión, «Recuperarlo», perfil con ETag de agregado invalidado por un modo nuevo → 412, «Borrarlo de todos modos» con cascada atómica (perfil, modos y asignaciones a 0 en la base).
- Motor en observación sin cámara; compuertas reales: `TYPE_TEXT`/`PRESS_KEY` → `CONTROL_REQUIRED`; tocar una tecla de la overlay llega al motor real y se rechaza sin escribir nada.
- Overlay real: 27 teclas con el léxico cargado, `localStorage` compartido (latido de ~0,6 s de edad), la página `/teclado` detecta el teclado abierto, estilos nativos (sin barra de título, siempre encima, `WS_EX_NOACTIVATE`), foco intacto, rectángulo = área cliente, vista web = rectángulo del puente, escritorio virtual = métricas de Windows, guardia de huérfanos real (apaga el modo, cierra la ventana y avisa), sin procesos del motor tras `engine_stop`.
- `cargo test --manifest-path desktop/Cargo.toml --locked` → 7/7; `node --test "tests/frontend/*.test.js"` → 94/94; `npx eslint src --max-warnings 0` → 0.
- Pequeño ajuste de redacción en el conflicto de borrado (frase repetida).

**Sigue sin probarse (requiere cámara y manos, no automatizable aquí)** — guía paso a paso en `docs/prueba-manual-hardware.md` (M1–M9, plantilla de resultados y medición de precisión de Air-Swipe con 20 palabras):
- Detección real de gestos (apuntar con el índice, pinza, mano abierta), activación del puntero y paso a CONTROL con cámara real.
- Clic REAL del puntero gestual (ratón del sistema) sobre la overlay, y que el texto llegue a la aplicación que tiene el foco con `pynput` (el campo de práctica es el lugar para probarlo).
- Trazo real: llegada de `AIRSWIPE_TRACE` desde el motor y precisión del decodificador (solo se probó con trazos sintéticos y puente falso).
- Varios monitores, otras escalas de pantalla (solo 150 % en un monitor 1920×1080), instalación empaquetada (esta prueba usa el ejecutable de depuración).

Implementación asistida por Claude; revisión humana pendiente.

## Bloque Claude — POST idempotente (12-11-2026)

Rama `codex/h2-seguridad-verificacion`, sin commits. **Cambia el esquema SQLite (v2 → v3) y añade una migración**; ninguna base real se migró ni se tocó (todo se probó con bases temporales y en memoria). Resuelve el pendiente 1 de `src/sync/README.md`: una creación cuya respuesta se pierde ya no obliga a la persona a elegir un candidato.

**Implementado**
- **Esquema v3** (`db/schema.sql`, `db/migraciones/002_v2_a_v3.sql`): tabla `idempotencia` (PK `usuario_id + clave`; huella SHA-256, tipo e id del recurso, respuesta original ≤ 4 KB, `creado_en`; FK en cascada con la cuenta; STRICT) e índice por fecha. Migración **aditiva y explícita** (`node backend/scripts/migrate-db.js`, nunca al arrancar): respaldo previo `<base>.v<origen>-<fecha>.ztbackup`, todos los pasos pendientes (v1→v3 son dos) en una sola transacción con comprobación de claves foráneas y de versión final; si falla, se deshace por completo. `openDatabase` acepta v2 y v3.
- **Backend**: `POST /perfiles` y `POST /perfiles/{id}/modos` aceptan `Idempotency-Key` (UUID v7 en minúsculas; su hora incrustada fija una vigencia de 30 días). Misma clave y mismo cuerpo normalizado ⇒ respuesta ORIGINAL con `Idempotent-Replayed: true` sin crear nada; otro cuerpo u otro perfil padre ⇒ 409 `IDEMPOTENCIA_CONFLICTO`; clave inválida o con hora futura (> 5 min) ⇒ 400; más de 30 días ⇒ 422 `IDEMPOTENCIA_CLAVE_EXPIRADA` (la regla de edad manda aunque la fila exista, así purgar nunca permite recrear una operación). Comprobar la clave, crear el recurso y registrar el resultado van en **una transacción `immediate`**: dos solicitudes simultáneas crean un solo recurso, y si el registro falla el recurso se deshace. Solo se registran las creaciones que terminaron bien. Purga acotada (lotes de 200) en cada creación idempotente. Sin cabecera, nada cambia. Con una base v2 el servidor sigue operando pero responde 501 `IDEMPOTENCIA_NO_DISPONIBLE` a cualquier clave (no la ignora). `GET /capacidades` anuncia `servidor.idempotencia` (`false` en v2).
- **Puente Tauri** (`desktop/src/{bridge,main}.rs`): `create_profile` y `create_context` reciben `idempotency_key` opcional, validan que sea un UUID v7 canónico (si no, `DATOS_INVALIDOS` y no se envía nada) y la mandan como cabecera; una respuesta repetida llega con `repetida: true` en el nivel superior.
- **Cliente** (`src/sync/idempotency.js`, `syncEngine.js`, `client.js`): solo se usa si el servidor lo anuncia (una consulta de capacidades por sincronización). Cada creación genera su clave una vez y la guarda en `syncOperation.key`; un fallo de transporte se reintenta con LA MISMA clave; si la sincronización se interrumpe, la siguiente repite la creación con esa clave y aplica el recibo sin conflicto ni adopción manual. Si la clave no sirve (expirada, dañada, servidor que ya no la anuncia, operación sin clave) vuelve la vía anterior `resultado_incierto`. Si el servidor rechaza una clave recién generada antes de crear nada (p. ej. reloj adelantado), se crea sin idempotencia en vez de bloquear la sincronización. Una clave dañada nunca se envía (su rechazo `DATOS_INVALIDOS` se habría leído como «no se creó nada»).
- **Contrato y documentos**: `docs/api/openapi.yaml` 1.4.0 (parámetro `Idempotency-Key`, cabecera `Idempotent-Replayed`, respuestas 400/409/422/501, `servidor.idempotencia`); `db/README.md` (versiones del esquema, migración y tabla v3); `src/sync/README.md` («Creaciones idempotentes»); `scripts/verify-separation.cjs` (9 tablas).

**Verificación real (comandos y resultados)**
- `npm test --prefix backend` → **71/71** (56 previas + 15 en `test/resources/idempotencia.test.js`: repetición de perfil y de modo, normalización equivalente, 409 por otro cuerpo/otro padre, claves inválidas/futuras/expiradas, fila presente pero clave expirada, errores que no dejan rastro, respuesta original tras PATCH y tras borrar, aislamiento por cuenta, 6 solicitudes simultáneas → 1 recurso, atomicidad, purga por lotes, tamaño máximo, base v2 con 501 y capacidad `false`). `schema.test.js` y `migracion.test.js` cubren 9 tablas/v3, v1→v3, v2→v3 con respaldo e igualdad estructural, y reversión si falla.
- `node --test --test-concurrency=1 backend/test/integration/*.test.js` → **1/1**.
- `node --test "tests/frontend/*.test.js"` → **110/110** (94 previas + 16 en `sync-idempotency.test.js`). El doble de la API usa el validador y la huella REALES del servidor; 5 pruebas que asumían una creación incierta ahora usan `createFakeApi({ idempotency: false })` (servidor sin la función).
- `cargo test --manifest-path desktop/Cargo.toml --locked` → **8/8**: la prueba de integración puente + backend real repite la clave (`repetida: true`, mismo id), prueba 409 por otro cuerpo y por otro padre, y comprueba que 4 claves mal formadas no se envían (el recuento de perfiles no cambia).
- `npm run desktop:build && npm run verify:tauri` → **37/37** (33 previas + 4 nuevas): la primera sincronización por la interfaz real deja 4 claves UUID v7 distintas (1 perfil + 3 modos) en la tabla `idempotencia` de SQLite, repetir la clave por el puente devuelve el perfil original sin crear otro, la misma clave con otro cuerpo da `IDEMPOTENCIA_CONFLICTO`, una clave en mayúsculas da `DATOS_INVALIDOS`, y `GET /capacidades` anuncia `uuid-v7` y 30 días.
- `npx eslint src tests scripts backend/src backend/test --max-warnings 0` → sin avisos; `desktop:build` compila la interfaz de escritorio; `pytest motor-local/tests` → 139 pasan (1 `hardware` deseleccionada; el motor no se tocó); `npm run verify:separation` → **pasa** (corregido el valor esperado de 7 a 9 tablas; antes fallaba por una expectativa ya obsoleta).
- **Mutaciones comprobadas** (cada una hace fallar al menos una prueba): en el cliente, repetición siempre incierta, no enviar la clave, no reintentar con clave, sin respaldo ante clave rechazada, no validar la clave guardada y no descartar la operación tras un rechazo de aplicación; en el backend, ignorar la huella, fuera de la transacción, no registrar, sin regla de expiración, aceptar UUID v4, purga que ignora el corte, huella sin la ruta y sin purga.

**Límites y riesgos**
- **Migrar una base real exige ejecutar `node backend/scripts/migrate-db.js` (con respaldo)**; hasta entonces una base v2 sigue funcionando sin idempotencia. No se ejecutó sobre ninguna base real ni sobre la de desarrollo. La migración y el respaldo solo se probaron con bases temporales.
- Pasados 30 días no se puede saber por clave si una creación se aplicó; el cliente cae en la adopción explícita de candidatos. La repetición devuelve la respuesta ORIGINAL: si el recurso cambió después, su `version` puede estar desfasada y la sincronización lo trata como cualquier versión antigua (conflicto o descarga), sin sobreescribir en silencio.
- La garantía vale para un único proceso de backend sobre SQLite (transacción con bloqueo de escritura); no se probó con varios procesos ni con carga real. Las 6 solicitudes simultáneas de la prueba comparten un proceso de Node.
- No protege PATCH/PUT (ya usan versión optimista) ni DELETE (condicional). La mutación conjunta modo + asignaciones sigue pendiente.
- La clave no es un secreto: se guarda en `localStorage` con la operación pendiente. La respuesta guardada tiene un tope de 4 KB; el caso más grande probado (nombre de 60 caracteres con ñ y descripción de 150 emoji) cabe.
- Un cliente nuevo con un backend sin la función no envía claves; un cliente antiguo con un backend nuevo sigue funcionando (sin cabecera no cambia nada).

Implementación asistida por Claude; revisión humana pendiente.

## Bloque Claude — mutación conjunta modo + asignaciones (12-11-2026)

Rama `codex/h2-seguridad-verificacion`, sin commits. **Sin cambios de esquema SQLite ni migraciones** (la tabla `asignaciones_gestos` no cambia; todo se probó con bases temporales y en memoria). Resuelve el último pendiente de backend de `src/sync/README.md`: hasta aquí un modo y sus asignaciones eran dos solicitudes (PATCH/POST y luego PUT), con un estado intermedio visible para otros equipos y recuperable solo a medias.

**Implementado**
- **Contrato**: `gestos` pasa a ser un campo opcional de `POST /perfiles/{id}/modos` y de `PATCH /modos/{id}`, con la semántica de `PUT /modos/{id}/gestos` (lista completa; los gestos sin fila vuelven al catálogo; `[]` las borra). El modo y sus asignaciones se escriben en **una transacción** y con **una sola subida de versión** (alta en la versión 1; PATCH de v a v+1). Todo o nada: asignación inválida o no compatible (400 `DATOS_INVALIDOS` / `ACCION_NO_COMPATIBLE`), versión obsoleta (409) o fallo de la base no aplican ni los campos ni las asignaciones, y un POST fallido no deja un modo huérfano. Un PATCH puede traer solo `gestos` y `version`. La respuesta sigue siendo el modo. `GET /capacidades` anuncia `servidor.modo_con_asignaciones`. `PUT /gestos` y `PATCH /gestos/{gesto}` siguen igual.
- **Backend**: validación única de asignaciones (`services/asignacionesValidation.js`, ahora usada también por el PUT; normaliza y ordena la lista, así la huella de `Idempotency-Key` no depende del orden), SQL de escritura compartido (`repositories/asignacionesWriter.js`), `modosRepository.create/update(…, rows)` con transacción `immediate` (savepoint si ya hay una exterior, como en la idempotencia), `resourceValidation.js` y `modosService.js`.
- **Puente Tauri** (`desktop/src/bridge.rs`): `ContextInput.gestos` opcional (máximo 13, si no `DATOS_INVALIDOS` sin enviar nada) que viaja en el cuerpo de `create_context` / `update_context`.
- **Cliente** (`src/sync/syncEngine.js`): solo manda `gestos` si el servidor lo anuncia (misma consulta de capacidades, una por sincronización). Alta: un POST con las 13 asignaciones, modo sincronizado en la versión 1 y sin PUT. Edición: un PATCH con campos, asignaciones y versión conocida; al confirmarse el modo no queda `dirty`. Si no hay anuncio, siguen los dos pasos de siempre y nunca se envía ese campo. Cada operación pendiente recuerda su forma (si sus argumentos llevan `gestos`), así una recuperación entre versiones del servidor es coherente en los dos sentidos.
- **Documentos**: OpenAPI **1.5.0** (`gestos` en `ModoCrear` y `ModoEditar`, `servidor.modo_con_asignaciones`, respuestas 400); colección Postman con los pasos 18b–18d (edición conjunta con una sola subida, rechazo sin efectos, comprobación); `src/sync/README.md` («Mutación conjunta»).

**Verificación real (comandos y resultados)**
- `npm test --prefix backend` → **84/84** (71 previas + 13 en `test/resources/mutacion-conjunta.test.js`: alta con 13 asignaciones en la versión 1, alta sin `gestos` como antes, 8 tipos de lista inválida sin crear nada, PATCH con una sola subida, PATCH solo con `gestos`, `[]`, PATCH sin `gestos` que no toca las asignaciones, rechazo y versión obsoleta sin cambios, carrera de dos PATCH con la misma versión, atomicidad con un fallo inyectado en SQLite en la 5.ª escritura —PATCH y POST—, propiedad, perfil que rechaza `gestos`, idempotencia con la lista en otro orden, y PUT/PATCH de `/gestos` intactos).
- `node --test --test-concurrency=1 backend/test/integration/*.test.js` → **1/1** (la colección, ahora de 32 pasos, ejecutada contra procesos reales).
- `node --test "tests/frontend/*.test.js"` → **120/120** (110 previas + 9 en `sync-conjunta.test.js` + 1 por desdoblar «primera sincronización» en conjunta/anterior). El doble de la API (`fakeApi.js`) valida como el servidor, y puede degradarse o actualizarse en caliente (`setJointMode`). **6 pruebas previas se movieron a `createFakeApi({ jointMode: false })`** porque fabricaban el estado intermedio PATCH-aplicado/PUT-pendiente que esta función elimina a propósito; su equivalente con la mutación conjunta está en `sync-conjunta.test.js` (p. ej. una asignación rechazada deja el servidor intacto, mientras que con el servidor anterior el PATCH ya quedaba aplicado).
- `cargo test --manifest-path desktop/Cargo.toml --locked` → **8/8**: la prueba de integración puente + backend real crea un modo con sus 13 asignaciones (versión 1, `asignacion_version` 1), lo edita con una sola subida (1 → 2), comprueba que una acción inexistente deja nombre y versión intactos y que más de 13 asignaciones no se envían.
- `npm run desktop:build && npm run verify:tauri` → **39/39** (37 previas + 2 nuevas): la primera sincronización por la interfaz real deja 3 modos con 13 asignaciones cada uno (39 filas) **todos en la versión 1**, sin ningún PUT aparte, y una edición con una asignación inválida por el puente real se rechaza sin cambiar nombre ni versión en el backend.
- `npx eslint src tests scripts backend/src backend/test --max-warnings 0` → sin avisos; `pytest motor-local/tests` → 139 pasan (1 deseleccionada; el motor no se tocó); `npm run verify:separation` → pasa.
- **Mutaciones comprobadas** (cada una hace fallar al menos una prueba). Backend: edición y alta fuera de la transacción, doble subida de versión, asignaciones escritas con una versión obsoleta, `gestos` sin validar, `gestos` fuera de la huella de idempotencia, PATCH que ignora `gestos`. Cliente: no usar nunca la conjunta, usarla sin que el servidor la anuncie, dejar el modo pendiente tras la alta conjunta, PATCH sin `gestos`, alta conjunta que además manda el PUT, alta sin `gestos`. Una prueba mía del backend no valía como se escribió (usaba un gesto inexistente y la lista «personalizada» salía igual que la predeterminada): se detectó al revisar el catálogo y se corrigió antes de dar nada por bueno.

**Límites y riesgos**
- **Cambia lo que ve otro equipo**: un modo subido con la mutación conjunta queda en la versión 1 (antes 2). Las versiones siempre salen de las respuestas del servidor, no se suponen, y los ETag de borrado se calculan con ellas; aun así no se probó una flota mixta con dos clientes de versiones distintas sobre el mismo servidor real más allá del doble.
- Solo cubre **un modo a la vez**: sigue sin haber transacción entre varios modos ni entre un perfil y sus modos. La respuesta del POST/PATCH no incluye las asignaciones (hay que leer `GET /modos/{id}/gestos`).
- Si se pierde la respuesta de un PATCH conjunto que sí se aplicó, la recuperación da un 409 de versión y se presenta el conflicto de siempre (se conserva el contenido local); no se resuelve sola.
- Vale para un único proceso de backend sobre SQLite; la carrera de dos PATCH de la prueba comparte proceso de Node.
- Sin cambios en la interfaz visible: el informe de sincronización sigue contando «N creados».

**Revisión posterior (12-11-2026)** — revisión del código de backend, `src/sync` y `bridge.rs`; se respaldó el árbol completo en la rama local `respaldo/pre-orden-20261112` antes de tocar nada.
- **Corregido (fallo real de la idempotencia):** la clave admite una hora hasta 5 min en el futuro pero la fila se purgaba a los 30 días exactos desde `creado_en`; con un cliente adelantado quedaba una ventana en la que la clave aún valía y su fila no existía (una repetición habría duplicado). La purga ahora espera 30 días + 5 min (`retentionCutoff`) y la fila se escribe con el reloj de la regla de antigüedad. Prueba: «reloj del cliente adelantado» (fallaba antes del arreglo).
- **Corregido:** un error de `/capacidades` que no fuera «la ruta no existe» (sesión caducada, 403, 500) se leía como «el servidor no tiene idempotencia/borrado condicional/conjunta» y se enviaban creaciones sin clave; ahora solo `RUTA_NO_ENCONTRADA`, `NO_ENCONTRADO` o un cliente sin `capabilities` desactivan las funciones y cualquier otro fallo interrumpe la sincronización.
- **Corregido:** la purga corre después de confirmar la creación (fuera de la transacción de escritura) y su fallo no afecta a la creación ya confirmada; un único helper `invalid` en `resourceError.js` (había tres copias) y se quitó un reexport sin uso; sentencias preparadas con caché por conexión (`repositories/statements.js`).
- **Pruebas añadidas:** repetición con cada código `IDEMPOTENCIA_*` del servidor, fallos de `/capacidades`, ruta ausente, purga fuera de la transacción y su fallo, caché de sentencias. Mutaciones comprobadas (6).
- **No cambiado (decisión):** una repetición idempotente devuelve el original aunque el recurso se haya borrado en otro equipo; está documentado y la siguiente sincronización lo trata como cualquier recurso eliminado en remoto.
- Verificación tras los cambios: backend 87/87, integración 1/1, frontend 126/126, cargo 8/8, `verify:tauri` 39/39, ESLint sin avisos, `pytest` del motor 139, `verify:separation` pasa.

Implementación asistida por Claude; revisión humana pendiente.


## Bloque Claude — puntero, gestos y teclado (16-11-2026)

Sin commits. Respuesta a una prueba real de la persona usuaria: «el puntero no funciona bien, el teclado tapa toda la pantalla, los gestos no se reconocen bien». Nada de esto se probó con cámara: los cambios se razonaron sobre el código y se cubren con pruebas sintéticas.

**Puntero (motor)**
- `config.py`: la ganancia era 0,65–2,25 y Desk-Rest la multiplicaba ×1,15 encima de un área activa ya reducida; con los valores por defecto cada píxel de cámara movía ~17 px de pantalla y el temblor de MediaPipe se veía como un cursor nervioso. Ahora 0,85–1,60 sin multiplicador (por defecto 1,34). Filtro One-Euro más estable en reposo (corte mínimo 1,6→0,4 Hz según suavizado; beta 1,5–5,0) y zona muerta 0,0008–0,005.
- `os_adapter.py`: `CursorGlide` interpola el cursor a ~125 Hz entre fotogramas (la cámara da ~15 FPS y el cursor avanzaba a saltos). Solo escribe mientras hay recorrido pendiente; el clic y el inicio de arrastre colocan antes el cursor en el objetivo; `release_all` (parada, pausa, pérdida) lo detiene. Hilo propio que termina en `close()`.
- `interpreter.py`: pinza confirmada con 2 muestras y 45 ms (con 3 muestras a 15 FPS un toque rápido nunca hacía clic); distancia de pinza con la profundidad de MediaPipe (peso 0,6) para no hacer clic cuando las puntas solo se solapan en la imagen; puño algo más tolerante (0,45→0,52); el puntero se desarma tras 3 s sin mano (antes 1,5 s).

**Gesto nuevo: mano abierta abajo/arriba** (`windowSwipe`, ajuste del equipo, activado por defecto)
- Bajar la mano abierta rápido minimiza la ventana activa; subirla rápido restaura la última que minimizó el motor (mismo `WindowActions` que «tres dedos»; solo en CONTROL; nunca la ventana de ZeroTouch). Umbrales: ≥ 1,3 palmas, ≥ 3,5 palmas/s, vertical ≥ 1,8× horizontal, sin retroceso, rearme con la mano quieta. Mover el cursor de arriba abajo a velocidad normal no lo dispara (prueba).
- Interfaz: `windowSwipe` en `deviceDefaults`, `buildEngineConfig`, comparación aplicada/deseada y lista de gestos («Mano abajo / arriba»). Contrato `ajustes_equipo` actualizado en las dos copias; fixture `engine-applied.json` regenerado con el validador real del motor.

**Teclado Air-Swipe**
- `desktop/src/main.rs`: la ventana pasa de 72 % del ancho y hasta 460 px de alto a 55 % del ancho, 200–320 px y como mucho 36 % del alto del área de trabajo. `airswipe_window_open` acepta `edge` opcional ("top"/"bottom") para moverla sin volver a mostrarla.
- Overlay: botón ▲/▼ que sube o baja el teclado y relee la geometría al momento (el trazo sigue alineado).

**Verificación**
- Motor (Python 3.10 del entorno Linux, sin pytest instalable; ejecutor mínimo propio con los mismos `assert`): 150 pruebas pasan, incluidas 13 nuevas (`test_cursor_glide.py`, barrido vertical, toque rápido, pinza solapada en 2D, ganancia). `test_config_roundtrip_and_ipc_subprocess` falla aquí igual que antes del cambio (lanza el motor real y este entorno no tiene OpenCV/MediaPipe).
- `node --test tests/frontend/*.test.js` → 126/126; ESLint sin avisos en `src/`.
- **No ejecutado**: `cargo test`, `npm run build:app`, `verify:tauri` (necesitan Windows/Rust; el cambio en Rust es pequeño y no se compiló) y `pytest` con el entorno `.venv` de Windows. Ejecutar antes de entregar.

Implementación asistida por Claude; revisión humana pendiente.


## Bloque Claude — puntos 4, 6 y 7 del plan, y preparación del 1 (16-11-2026)

Sin commits. Pedido: «haz los puntos 1, 4, 6 y 7» de la lista de pendientes.

**4. Multimedia y temporizadores**
- Motor (`action_engine.py`): multimedia y ventanas, además de ejecutarse, se encolan como evento informativo con `injected` (y `result` en ventanas). En Observar se informa que no se envió. Prueba nueva en `test_gestos_catalogo.py`; una prueba previa se ajustó porque ahora el aviso de multimedia precede al TIMER.
- Interfaz: `src/engine/appEvents.js` (cursor de eventos: el primer estado con el motor en marcha solo fija la base, así nunca se reaplica un TIMER viejo al recargar), `src/data/timers.js` (iniciar, pausar, reanudar, +1 min, límite de 4, aviso único al terminar; el gesto inicia, pausa o reanuda como dice el contrato), `src/hooks/useAppEvents.js` (reloj de 500 ms solo con temporizadores corriendo, pitido con WebAudio, sin efectos dentro de los actualizadores por StrictMode), `src/components/AppTools.jsx` (panel en Inicio y `TimerDock` en las demás páginas). Ajuste del equipo `timerMinutes` (1–120, por defecto 5) en preferencias y en `ajustes_equipo` del contrato (las dos copias).

**6. Editor**
- `ContextEditorDialog` sirve para crear y para editar (nombre y categoría). Botón ✎ por modo en Inicio. `updateMode` ya existía y deja el modo pendiente de subir. Al crear también se elige la categoría.
- `GESTURE_HELP` (`src/data/gestures.js`): cómo se hace cada uno de los 13 gestos del contrato, mostrado en el editor de asignaciones junto con el efecto de la acción elegida. `gesturesWithAction` en `capabilities.js`.

**7. Calidad y entrega**
- `.github/workflows/test.yml`: backend + integración (ubuntu), interfaz con lint, pruebas, `build:app`, `build` y `verify:separation` (ubuntu), motor con pytest (windows, Python 3.11) y `cargo test` (windows, tras compilar `dist-app`). **No se ha ejecutado en GitHub** (no hubo push).
- `README.md` reescrito (estado real, arquitectura, gestos, instalación, pruebas, pendientes). `docs/matriz-hito1.md`: matriz de cumplimiento del Hito 1 con estado honesto por fila. `docs/hito2/trazabilidad.md` marcado como histórico.

**1. Prueba física**: no se puede hacer sin manos y cámara. Se añadió «Prueba rápida» (R1–R9, ~15 min) al inicio de `docs/prueba-manual-hardware.md`, enfocada en lo cambiado hoy.

**Verificación**: `node --test tests/frontend/*.test.js` → 135/135; `npx eslint src tests --max-warnings 0` → 0; motor con el ejecutor mínimo → 151 pasan (falla solo `test_config_roundtrip_and_ipc_subprocess`, que necesita OpenCV/MediaPipe, igual que antes); contrato idéntico en las dos copias; `verify:separation` pasa. No ejecutado: `vite build`, `cargo test`, `verify:tauri`, pytest en Windows (este entorno es Linux y los binarios nativos instalados son de Windows). **La interfaz nueva no se vio renderizada.**

Implementación asistida por Claude; revisión humana pendiente.


## Bloque Claude — gestos de PC: pestañas y clic derecho (19-11-2026)

Sin commits. Pedido: «más gestos para PC que sean útiles y uno específico para bajar y subir pestañas».

**Decisión**: gestos **locales del equipo** (como los de ventana), no gestos del catálogo. Agregarlos al catálogo obligaba a un esquema SQLite v4, migración 003 y cambios en la API y en muchas pruebas del backend, sin necesidad de producto: ninguno admite más de una acción. Tres dedos e índice + meñique ya estaban ocupados (ventanas y precisión), así que se eligieron posturas libres.

- **Pulgar y meñique (🤙) → pestañas** (`tabGestures`): bajar la mano = Ctrl+Tab; subirla = Ctrl+Shift+Tab; una pestaña por cada 0,5 palmas, ≥ 300 ms entre cambios.
- **Pinza pulgar-medio → clic derecho** (`rightClick`): como la pinza del índice, pero con el medio; ≤ 700 ms; apagada con Air-Swipe abierto.

Archivos: `contracts/capacidades.json` y copia del motor (`teclas_equipo`, `ajustes_equipo`), `motor_local/{capabilities,config,interpreter,action_engine,os_adapter}.py`, `motor-local/tests/test_gestos_equipo_pc.py` (13 pruebas), `src/data/{preferences,gestures,engineStatus}.js`, `src/engine/{engineConfig,engineApply,appEvents}.js`, `tests/frontend/gestos-equipo.test.js` (4 pruebas), `tests/frontend/fixtures/engine-applied.json` (regenerada con `EngineConfig.from_dict(desired).to_dict()`; solo agrega las dos claves), `docs/hito2/motor-local.md`, `docs/prueba-manual-hardware.md` (M6.5c, M6.5d), `CHANGELOG.md`.

**Verificación**: motor con pytest (Python 3.13, Linux, copia del árbol) → 164 pasan, 2 omitidas (solo Windows); `node --test tests/frontend/*.test.js` → 139/139; `npx eslint src tests --max-warnings 0` → 0; `verify:separation` pasa; contrato idéntico en las dos copias. **No ejecutado**: pruebas del backend (no cambió), `vite build`, `cargo test`, `verify:tauri`, pytest en Windows y **prueba con cámara y manos** (los umbrales son hipótesis).

Implementación asistida por Claude; revisión humana pendiente.


## Bloque Claude — QA de comodidad y reconocimiento (19-11-2026)

Sin commits. Pedido: «no es tan cómoda ni reconoce tan bien los gestos; actúa como QA y arréglalo» (cursor incómodo, clic que falla, gestos no detectados, cansancio/armado; webcam del notebook).

Sin cámara disponible: banco sintético `motor-local/tools/banco_qa.py` (ruido de webcam, 15/30 FPS, 45-90 cm) sobre el intérprete real. Informe con antes/después y los 11 defectos corregidos: `docs/qa-comodidad-19-11.md`. Lo más grave: cerrar el puño arrancaba arrastres (hasta 10 de 10 a 90 cm) y el cursor quedaba pegado al borde superior con la mano a la altura natural.

Archivos: `motor_local/{interpreter,config}.py`, contrato (dos copias, `pointerAcceleration` en `ajustes_equipo`), `motor-local/tests/test_qa_comodidad.py` (10 pruebas; cada una falla si se revierte su arreglo, comprobado una por una), 4 pruebas previas actualizadas (`test_ventanas_barrido.py`, `test_gestos_catalogo.py`) porque fijaban los valores anteriores, `src/data/preferences.js`, `src/engine/{engineConfig,engineApply}.js`, `src/components/UI.jsx` (interruptor «Cursor con aceleración»), `src/data/gestures.js` (`windowSwipe` deja de ser común), `tests/frontend/gestos-equipo.test.js`, fixture `engine-applied.json` regenerada (solo `windowSwipe` y `pointerAcceleration`), `docs/prueba-manual-hardware.md`, `CHANGELOG.md`.

**Verificación**: motor con pytest (Python 3.13, Linux, copia del árbol) → 175 pasan, 2 omitidas (solo Windows); `node --test tests/frontend/*.test.js` → 140/140; `npx eslint src tests --max-warnings 0` → 0; `verify:separation` pasa; contrato idéntico en las dos copias. **No ejecutado**: pytest en Windows, `vite build`, `cargo test`, `verify:tauri` y **prueba con cámara y manos**. La interfaz nueva (un interruptor) no se vio renderizada.

**Pendiente**: validar con manos reales (Prueba rápida + sección 6). Las preferencias guardadas conservan `windowSwipe: true`: apagar «Mano abajo / arriba» una vez. Medir distancias en unidades isotrópicas (4:3) queda propuesto, no hecho.

Implementación asistida por Claude; revisión humana pendiente.


### 2ª iteración del QA (19-11-2026)

Comentario tras probarlo: «se siente más raro»: cursor lento o pegajoso, gestos raros y mucho brazo para las esquinas. Reproducido en el banco y corregido: la regla de pinza bloqueaba pinzas reales con el índice doblado (0/10 → 10/10); aceleración tipo mouse en vez de solo reducir; la posición se recortaba antes de la aceleración y congelaba el cursor. Detalle en `docs/qa-comodidad-19-11.md`. Verificación: pytest 178 pasan, 2 omitidas; frontend sin cambios. Sin prueba con manos reales.

## Bloque Claude — cierre hacia la presentación del martes 24-11 (20-11-2026)

Contexto: entrega y presentación el **martes 24-11-2026**; la demo es el software funcionando. Plan y responsables en la hoja «ZEROTOUCH · Tareas hasta el martes 24-11» (claude.ai) con una pestaña «Compromisos Informe 1» (24 compromisos del Informe del Hito 1 cruzados con el código).

**Decisiones**
- **No migrar a Supabase** antes del martes: obligaría a rehacer autenticación, sincronización, puente Tauri y pruebas. PC y teléfono se conectan a la misma API Express por la red local (hotspot del teléfono). Desplegar la API con HTTPS (servidor remoto prometido en el Informe §4.1) es la tarea 23, opcional.
- No hay «front compartido» con Android: la app Android es Java nativo. Lo compartido es la API, `contracts/capacidades.json` y los modos con `plataforma = 'movil'`. La web móvil queda fuera de alcance (declararlo).
- El documento `movil-arquitectura.md` del proyecto en claude.ai describe una app Kotlin que **no existe** en este repositorio: no usarlo como evidencia.

**Hecho (commits sin push: el entorno no alcanza github.com)**
- 6 commits que guardan todo el trabajo previo sin confirmar (d8c191a…c08760e). `public/` quedó fuera: solo cambios de fin de línea. Commits hechos con `core.autocrlf=true`.
- 09f5ab9 `LAN_HOST` (backend): segundo punto de escucha opcional en una IPv4 privada; HOST sigue en loopback para Tauri; 0.0.0.0 e IP públicas rechazadas; cierre espera a ambos. `backend/test/resources/red-local.test.js` (5/5 en Node 22 Linux).
- 1822846 Android: `GestureActions` (lista blanca) + `GestureGate` genérico. ✌ Victory baja, ☝ Pointing_Up sube, 👎 Thumb_Down Volver, 👍 Thumb_Up multimedia; el puño ya no actúa. `canPerformGestures` en accesibilidad. `GestureGateTest` 95 y `GestureActionsTest` 38 pasan en JVM. **No compilado con el SDK de Android ni probado en el teléfono.**

**No ejecutado**: suites en Windows, `cargo test`, `desktop:build`, `verify:tauri`, compilación de la APK, prueba física de escritorio y del A26.

Implementación asistida por Claude; revisión humana pendiente.

## Bloque Claude — verificación en Windows, APK, contrato móvil, modo desde la API, HUD y paleta (20-11-2026, tarde)

Rama `codex/h2-seguridad-verificacion`. **Sin push**: la rama no tiene upstream (los 9 commits previos y los de este bloque siguen solo en local).

**Verificación en Windows del estado recibido (antes de tocar nada)**

| Comando | Resultado |
|---|---|
| `npm test --prefix backend` | 92/92 |
| `node --test --test-concurrency=1 backend/test/integration/*.test.js` | 1/1 |
| `node --test "tests/frontend/*.test.js"` | 140/140 |
| `motor-local/.venv/Scripts/python.exe -m pytest motor-local/tests -q` | 180 pasan, 1 deseleccionada |
| `cargo test --manifest-path desktop/Cargo.toml --locked` | 8/8 |
| `npm run lint` | 0 errores; 1 aviso previo en `prototype/src/App.jsx` (no se modifica) |
| `npm run verify:separation` | pasa |
| `./android/test-core.ps1` | 95 + 38 |
| `./android/prepare-model.ps1` | modelo existente verificado (SHA-256) |
| `assembleDebug` | **fallaba**: `validateSigningDebug`, faltaba el keystore de depuración → corregido (2f7d7f9) |

**Commits**
- `2f7d7f9` fix(android): `createDebugKeystore` genera con `keytool` la clave de depuración en el directorio de build. Primera compilación real de la APK con `GestureActions`: sin errores en `GestureAccessibilityService` ni `CameraGestureService`.
- `92b89b5` T11: el teléfono lee el modo móvil (solo lectura). `ApiClient`/`ModeLoader`/`MiniJson` en Java estándar; `GestureGate.reconfigure` rechazado en CONTROL (el servicio pausa antes y sube la época); `INTERNET`; HTTP en claro solo hacia la IP de `-PztLanHost` (`network_security_config` generado y validado en Gradle); botón «Actualizar modo». Sin conexión: se mantiene lo anterior con el motivo, nunca un éxito simulado.
- `7c4c4e5` T3: `docs/movil-contrato.md` con respuestas reales; `scripts/probar-contrato-movil.sh` (backend real + base temporal + curl + cliente Java `RealApiCheck`).
- `bc49fdd` T26: paleta del Informe en `src/index.css` y grises fijos de `src/` sustituidos por variables (contrastes en el commit y en el CSS).
- `9ef809c` T24: HUD `#hud` (400×60, esquina superior derecha, siempre encima, no activable, transparente a los clics). Capacidad propia: solo `engine_status`. Se abre con el motor en marcha; interruptor por equipo en la tarjeta del motor.
- (este commit) T15: `docs/cambio-alcance-movil.md`; `AGENTS.md` línea 20, `README.md`, `docs/matriz-hito1.md`, `android/README.md` y `CLAUDE.md` alineados.

**Verificación tras los cambios**

| Comando | Resultado |
|---|---|
| `./android/test-core.ps1 -JavaHome …jbr-21.0.11` | 95 + 38 + **66** (`ModeLoaderTest`) |
| `assembleDebug` con `'-PztLanHost=192.168.1.20'` | compila; la APK lleva `res/xml/network_security_config.xml` (solo esa IP en claro) y el manifiesto `INTERNET` + `networkSecurityConfig` |
| `bash scripts/probar-contrato-movil.sh <JDK>` | login, perfiles, modos, gestos y errores 401 por curl; cliente Java contra el backend real: modo aplicado, refresco con la cookie sin contraseña, contraseña incorrecta rechazada |
| `node --test "tests/frontend/*.test.js"` | 147/147 (+7 `hud.test.js`) |
| `npm run lint` · `verify:separation` · `npm run build` (prototipo) | sin cambios en el aviso previo · pasa · pasa |
| `npm run desktop:build` · `cargo test` | compila · 8/8 |
| Navegador integrado con puente falso (`vite --mode desktop`) | la tarjeta del motor abre/cierra el HUD con el interruptor y guarda la preferencia; la vista `#hud` muestra «Sin conexión con el motor», «Observando · … (no se envió)» y «Controlando el cursor · Clic»; el texto más largo cabe en 400 px. Probado manualmente con puente falso |

**No ejecutado**
- `npm run verify:tauri` con las nuevas comprobaciones del HUD (abre ventanas reales: pendiente de la autorización de la persona usuaria).
- La APK en el teléfono (instalación, red del hotspot, política de HTTP en claro de Android, interfaz), la prueba física del escritorio y la mini prueba con personas.
- T27 (activación contextual con acelerómetro) y T23 (API con HTTPS): no empezados.

**Notas**
- PowerShell 5.1 parte `-PztLanHost=192.168.1.20` en el primer punto; va entre comillas simples (documentado). La validación de Gradle rechazó el `192` recortado, como debía.
- El JDK no entrega el cuerpo de un 401 si la petición usa `setFixedLengthStreamingMode`; se quitó (el cuerpo de login es mínimo) para leer `CREDENCIALES_INVALIDAS`.
- En Git Bash, curl.exe recibe los argumentos en la página de códigos ANSI: el cuerpo con «é» se envía desde un archivo UTF-8.

Implementación asistida por Claude; revisión humana pendiente.

### Reversión de la paleta (20-11-2026, noche)

La persona usuaria no reconoció la interfaz con la paleta del Informe y pidió **volver a la gris grafito**. Se revirtió `bc49fdd` (las hojas de `src/` quedan idénticas al estado anterior a la sesión) y el HUD pasó a la misma paleta gris. `docs/matriz-hito1.md`: la paleta del Informe queda como «No aplicada», por decisión. Verificación: frontend 147/147, `lint` y `verify:separation` pasan. `npm run desktop:build` no pudo reemplazar el `.exe` porque había una instancia abierta por la persona usuaria (no se cerró). `verify:tauri` anterior: se detuvo en una excepción (12 comprobaciones correctas, `click` sobre un elemento inexistente, línea 222 del script) antes de llegar al HUD; **sin investigar todavía**.

### `verify:tauri` con el HUD (20-11-2026, noche)

Tras recompilar (`npm run desktop:build`, con la paleta gris) se ejecutó `npm run verify:tauri` cuatro veces:
1. **12/13**: excepción en el paso 5. El script pulsaba el primer `.icon-button` de la fila del modo, que desde el 16-11 es el lápiz «Editar», no la ✕. **Fallo del script**, no de la app: ahora usa `aria-label^="Eliminar"`.
2. **44/45**: falló solo la comprobación nativa del HUD porque exigía que no estuviera el bit `WS_CAPTION`; Tauri lo conserva en ventanas sin decoración. Ahora mide el desfase real del contenido (2 px), como la prueba de la overlay. Estilo extendido `0x80C0138`: NOACTIVATE, TOPMOST y TRANSPARENT presentes.
3. **24/26**: la overlay Air-Swipe no apareció en 20 s (y el resto se abortó). El mismo paso pasó en las ejecuciones 2 y 4 sin cambios de código: **intermitente, causa sin investigar** (puede ser de tiempos al abrir una ventana más, el HUD).
4. **45/45**, incluidas las 6 del HUD: se abre en `#hud` con el motor en marcha; muestra el estado real (cámara 9 inexistente → «Cámara no disponible», «Última acción: Mano perdida»); mismo origen; desde el HUD se rechazan `engine_stop`, `airswipe_window_open` y la API (solo `engine_status` pasa); no activable, encima, transparente a los clics, sin foco; se cierra al detener el motor.

Sin cámara ni entradas en ninguna ejecución. Falta ver el HUD con manos reales.

### Fallo intermitente de la overlay en `verify:tauri` (investigación)

- **Hipótesis**: el script abría la overlay llamando a los comandos con **un solo latido sembrado**, que caduca a los 3,5 s (`STALE_AFTER_MS`), mientras que la app real (`openKeyboard`) da 8 s (`OPEN_GRACE_MS`). Si la overlay tardaba más de 3,5 s en escribir su latido, el guardia de huérfanos de `useEngine` la cerraba antes de que el script la viera.
- **Medido**: con el script ya corregido, tres ejecuciones seguidas **45/45**. La overlay escribió su primer latido a los **543, 542 y 566 ms**. Eso queda muy por debajo de 3,5 s, así que la hipótesis **no está confirmada**: la ejecución fallida habría necesitado una carga más de seis veces más lenta que lo normal, y no quedó evidencia de por qué.
- **Cambios (solo en el script)**: se emula el margen real de 8 s renovando la semilla hasta el primer latido de la overlay (pasos 8 y 14), y se mide `msHastaPrimerLatido`. Si vuelve a fallar, el detalle incluye el aviso de la ventana principal: sin latido y con «Se apagó el modo teclado…», el guardia la cerró; si no hay aviso, la causa es otra (p. ej., que el destino CDP no se registre).
- **Para la demo**: la app real tiene 8 s de margen y la overlay suele cargar en ~0,55 s en este PC. No se cambió código de la app.

### Teclado Air-Swipe más pequeño (20-11-2026, noche)

Pedido: «el teclado me tapa toda la pantalla cuando se pone». Antes ocupaba ~55 % del ancho y hasta 36 % del alto (en la captura de la app real: 1056×359 px).
- **Compacto por defecto**: ~40 % del ancho y como mucho 26 % del alto (`airswipe_size` en `desktop/src/main.rs`); en 1920×1080 al 100 %, 760×250 px.
- **Botón ⤢/⤡ en el teclado** para pasar al tamaño grande (el anterior) cuando cueste trazar; se recuerda por equipo (`zerotouch:airswipe:size`, `src/airswipe/link.js`). El ▲/▼ conserva el tamaño y el ⤢/⤡ conserva el borde.
- Pruebas: `cargo test` 10/10 (+2 de `airswipe_size`); frontend 151/151 (+4 `airswipe-size.test.js`, incluida la geometría de las 27 teclas en 768×256 sin solapes y ≥ 30 px); `npm run verify:tauri` **48/48** (+3: abre compacto, ⤢ agranda a 920×313 con el área cliente nativa igual al puente, ⤡ vuelve a 760×250 sin foco y guarda la preferencia). Primer latido de la overlay: 556 ms.
- **Sin probar con manos**: con teclas más pequeñas el trazo puede costar más; para eso está ⤢.
