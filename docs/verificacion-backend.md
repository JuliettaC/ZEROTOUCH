# Verificación técnica y trazabilidad

Fecha: 2026-10-19. Entorno ejecutado: Windows x64, Node 24.19.0, npm 11.17.0,
better-sqlite3 13.0.3, SQLite 3.53.4. Es evidencia local, no una calificación
académica ni certificación de otros computadores.

## Estado de trabajo

| Etapa | Estado | Evidencia |
|---|---|---|
| Stack y recursos aprobados | Implementada | JavaScript/Express; perfiles y contextos |
| Motor, esquema e integridad | Probada | schema.sql, tests SQL/FK/UNIQUE/CHECK |
| CRUD por capas | Probada | API real en procesos separados |
| Validación y errores | Probada | HTTP 400/404/409/413/415/500/503 |
| Persistencia | Probada | Mismo archivo después de terminar y reiniciar Node |
| Ubicación de datos | Probada | AppData Local; rechazo de OneDrive y junction |
| Colección | Probada por adaptador HTTP | 23 peticiones y scripts; UI de Postman no ejecutada |
| Instalación limpia | Probada en este equipo | npm ci en copia temporal sin node_modules previo |
| Instalación en otro computador | Pendiente | Requiere ejecutar README allí; no se afirma como realizada |
| Frontend | Compilación probada | Sin cambios de código; localStorage conservado |
| Integración React/API | Pendiente, P2 | Requiere flujo de perfil e importación de preferencias |
| Informe/presentación | Fuera del alcance autorizado | No generados |

## Comandos y resultados

- `npm --prefix backend test`: 34 pruebas contabilizadas por node:test, 34
  aprobadas, cero fallos. Incluye subtests; cada grupo hace múltiples aserciones.
- `npm --prefix backend run verify:install`: instalación npm ci y suite en
  copia aislada. No copia dependencias instaladas del proyecto. Se verificó
  carga del módulo nativo mediante CRUD real, no solo por declaración engines.
- `npm --prefix backend run db:init`: SQLite 3.53.4, esquema 1, ruta efectiva
  `C:/Users/cespe/AppData/Local/ZeroTouch/development.sqlite` en el entorno normal.
- `npm run lint`: cero errores; permanece una advertencia previa de dependencia
  de useEffect en src/App.jsx:43. No se alteró la interfaz para silenciarla.
- `npm run build`: compilación Vite completada, 25 módulos transformados.
- `git diff --check`: sin errores de whitespace. Git advierte conversión futura
  LF/CRLF por su configuración local, sin error de contenido.

La prueba de fallo inesperado cierra deliberadamente una conexión aislada;
su log `Unexpected request failure` es esperado. Comprueba que el cliente solo
recibe un error genérico. Las pruebas no escriben en la base de desarrollo.

Durante implementación falló primero el cierre del proceso de prueba porque
el canal IPC seguía abierto. Se corrigió desconectándolo después de cerrar
HTTP y SQLite; el reinicio completo pasó posteriormente. También se corrigió
un error ESLint en la rutina de limpieza del verificador de instalación.

npm 11.17 emitió un aviso de política allow-scripts para el fallback de
compilación de better-sqlite3 durante npm ci. El binario distribuido se cargó
y la suite pasó. En plataformas sin binario compatible debe revisarse esa
política y autorizar únicamente el script del driver si corresponde; no se
habilitaron globalmente scripts arbitrarios ni se afirma compatibilidad allí.

## Requisitos → implementación → verificación

| Requisito | Archivos | Prueba/evidencia |
|---|---|---|
| Dos recursos y CRUD | routes/resourceRoutes.js, controllers/resourceController.js, services/resources.js, repositories/resources.js | api.test.js: CRUD, listados, consulta, edición y borrado |
| Capas reales | src/app.js ensambla ruta/controlador/servicio/repositorio | Recorrido HTTP contra SQLite en todos los tests API |
| Modelo relacional | db/schema.sql y db/README.md | api.test.js: integridad SQL e inicialización |
| Persistencia | config/database.js, server.js | api.test.js: cierre y reinicio de proceso conservan campos |
| Validación | services/validation.js | api.test.js: UUID, campos, tipos, rangos, query y PATCH |
| JSON y errores | app.js, middleware/errors.js | api.test.js y failures.test.js |
| Unicidad por perfil | name_key, UNIQUE, services/resources.js | Duplicado con espacios/caso, mismo nombre en otro perfil |
| Eliminación controlada | ON DELETE RESTRICT | Perfil con contextos produce 409; SQL impide huérfanos |
| SQL parametrizado | repositories/resources.js | Nombre con texto SQL permanece dato; tabla sigue accesible |
| Fallos de datos | repositorio y middleware | failures.test.js: bloqueo 503 y fallo 500 sin filtraciones |
| Configuración externa | .env.example, config/env.js | api.test.js: puerto/entorno/host inválidos |
| Fuera de OneDrive | config/database.js | failures.test.js: junction; test de raíz personalizada |
| Reproducibilidad | package-lock.json, scripts/init-db.js, scripts/verify-install.js | npm ci limpio y suite |
| Colección importable | docs/api/ZeroTouch.postman_collection.json | collection.test.js, 23 peticiones |
| Continuidad Hito 1 | docs/decisiones-backend.md | Comparación de alcance y elección aprobada |

Las rutas abreviadas de código/pruebas en la tabla están bajo backend/src o
backend/test, salvo las rutas db/docs explícitas.

## Inventario de cambios

Modificados:
- README.md, .gitignore, eslint.config.js.
- backend/package.json y backend/package-lock.json.
- backend/.env.example (remite a configuración raíz).
- backend/src/app.js, config/env.js, server.js.
- backend/src/controllers/healthController.js y routes/healthRoutes.js:
  únicamente formato; se conserva respuesta y ruta.

Creados:
- .env.example.
- backend/src/config/database.js.
- backend/src/controllers/resourceController.js.
- backend/src/routes/resourceRoutes.js.
- backend/src/services/resources.js y validation.js.
- backend/src/repositories/resources.js.
- backend/src/middleware/errors.js.
- backend/scripts/init-db.js y verify-install.js.
- backend/test/helpers.js, api.test.js, collection.test.js, failures.test.js.
- db/schema.sql y db/README.md.
- docs/api/README.md y ZeroTouch.postman_collection.json.
- docs/decisiones-backend.md y este documento.

Datos locales creados fuera del repositorio: base de desarrollo inicializada
en AppData Local. Las pruebas usan archivos temporales propios. No se hicieron
commits/push ni cambios en documentos académicos del Hito 1. output/ y tmp/
eran directorios no versionados preexistentes y no forman parte de la entrega.

## Límites pendientes

No hay autenticación, sincronización, migración de localStorage, reconocimiento
gestual, adaptador del SO ni despliegue público. Tampoco se han probado carga,
recuperación ante pérdida de disco o ejecución física en macOS/Linux. No hay
garantía de disponibilidad ni cifrado. Estos límites se documentan y no se
presentan como funciones implementadas. El modelo y contrato sirven como base
para la siguiente etapa sin cambiar arbitrariamente el stack del Hito 1.
