# ZeroTouch — Desarrollo individual

## Objetivo y autoridad

El proyecto actualmente lo desarrolla una sola persona: el usuario. Los agentes de IA colaboran con esa persona sobre el conjunto del repositorio. La distribución histórica entre I1, I2 e I3 y la estimación de 105 horas-persona ya no regulan el trabajo actual.

Las instrucciones explícitas del usuario prevalecen. Antes de editar, revisa el estado actual, las instrucciones más específicas, los archivos pertinentes, la rama, los cambios locales y los commits recientes. La auditoría del commit `0cee784` y los informes anteriores son antecedentes, no pruebas del estado actual.

No preguntes qué integrante corresponde ni exijas aprobación de otro integrante. Puedes modificar las áreas necesarias para la tarea solicitada, manteniendo coherencia entre contratos, código, pruebas y documentación. Esta autorización no implica implementar todo el producto en cada sesión: trabaja sobre el objetivo pedido. No delegues a otros agentes salvo petición expresa del usuario.

## Alcance actual

El objetivo general es completar el software de escritorio descrito en `docs/Informe Hito 1.pdf`, distinguiendo lo implementado, lo propuesto y lo futuro. El mínimo de Hito 2 es un antecedente de planificación, no un límite permanente.

- Backend Node.js/Express modular, SQLite, autenticación, roles, propiedad de recursos, perfiles, modos y asignaciones de gestos.
- Interfaz React y aplicación Tauri integradas con el backend y el motor Python local.
- Control gestual de Windows, calibración, parada segura y acciones previstas en Hito 1.
- Air-Swipe real, predicción local, multimedia, temporizadores y asistencia por mirada, cuando formen parte de la tarea solicitada.
- Sincronización de preferencias, preparación de servicio remoto, distribución instalable, pruebas y documentación.
- Móvil (cambio de alcance del 20-11-2026, `docs/cambio-alcance-movil.md`): app Android nativa en Java (`android/`) con cámara frontal, MediaPipe local y una lista blanca de acciones por accesibilidad; solo LEE el modo móvil de la cuenta (`docs/movil-contrato.md`). Sin interfaz compartida con React: se comparten la API, `contracts/capacidades.json` y los modos con `plataforma='movil'`. La web móvil queda fuera de alcance. El teléfono usa la misma API por la red local (`LAN_HOST`); no migrar a otro servicio. Nunca simular éxito: sin conexión, valores por defecto con aviso.

No copies automáticamente `desktop/runtime/` ni restaures el backend antiguo con `/api/v2`. Mantén una implementación vigente por componente. Conserva el prototipo histórico del Hito 1 y la separación de builds. No cambies el flujo de publicación sin necesidad demostrada y autorización para cualquier acción remota.

No borres ni reinicialices bases existentes. Las migraciones necesarias deben ser explícitas, versionadas, probadas sobre datos aislados y con respaldo; no ejecutes migraciones sobre datos reales sin autorización específica. `codex-interno`, `tmp`, `output`, ejecutables y reportes antiguos no prueban el estado del producto ni se incorporan en bloque a Git.

## Organización del trabajo

Usa el clon y la rama de la sesión, revisando su estado antes de cambiar nada. No se exige una rama por integrante. Nunca cambies de rama ni sobrescribas cambios existentes sin conservarlos. Distingue el trabajo previo del trabajo realizado en la sesión.

Áreas del repositorio, sin propiedad exclusiva por persona:
- Datos y seguridad: `db/`, configuración de datos, autenticación, administración, correo, middleware y pruebas asociadas.
- API y composición: aplicación/servidor, rutas, controladores, servicios, repositorios, validación, dependencias y OpenAPI.
- Interfaz: `src/`, recursos compartidos y experiencia móvil solo frontend.
- Escritorio y motor: `desktop/`, `motor-local/`, protocolo entre procesos, recursos y empaquetado.
- Calidad y entrega: pruebas, scripts, CI, README y documentación.

Cuando un cambio atraviese varias áreas, completa sus conexiones y pruebas en el mismo bloque revisable. No crees implementaciones paralelas para evitar modificar el componente existente. Mantén un único lockfile por paquete y actualiza las dependencias solo cuando sea necesario.

El usuario decide los cambios de alcance y de estas instrucciones. No se requiere acuerdo de un equipo de tres personas.

## Contrato técnico y continuidad

Conserva los contratos existentes y consulta el código, `db/schema.sql`, las migraciones y `docs/api/openapi.yaml` antes de cambiarlos. Las reglas siguientes conservan la base del contrato inicial; no reviertas funcionalidades posteriores, como correo verificable, recuperación de contraseña o la tabla tokens_cuenta, para volver al esquema mínimo de Hito 2. Actualiza consumidores, pruebas y documentación cuando el trabajo autorizado requiera ampliar un contrato.

### Entorno y persistencia

- Node 24.x como entorno de backend inicialmente previsto; fijar una revisión compatible en README/CI tras verificar instalación de dependencias. No actualizar paquetes indiscriminadamente.
- SQLite con el driver vigente, better-sqlite3-multiple-ciphers (API de better-sqlite3 con cifrado en reposo; la base se abre con `DATABASE_KEY`). Verifica la instalación y las versiones del repositorio antes de cambiar dependencias.
- Base fuera del repositorio y OneDrive; ubicación absoluta configurada por DATABASE_PATH. Cada prueba usa una base temporal aislada.
- `.env` en la raíz; el cargador lo resuelve independientemente del directorio desde el que se lance el comando.
- Variables base: NODE_ENV, HOST, PORT, DATABASE_PATH, DATABASE_KEY (clave de cifrado de 64 hex, solo en `.env`), APP_ORIGIN y SESSION_TTL_SECONDS. Añadir otras solo si se usan realmente. Ningún secreto de ejemplo funcional.
- Interfaz de datos: `openDatabase(filename, { key, initialize = false, readonly = false } = {})` (la clave es obligatoria), que devuelve conexión con close(). Inicializar crea solo una base nueva; abrir no reinicializa ni adapta esquemas ajenos.
- Interfaz de aplicación: `createApp({ db, config })`, sin listen ni inicialización destructiva al importar. server.js carga configuración, abre datos y monta/cierra HTTP y SQLite.
- Instalar dependencias en el clon es aceptable dentro del trabajo autorizado; preservar lockfiles y no subir node_modules.

### Modelo nuevo

El SQL de referencia encontrado durante la auditoría está fuera del repositorio, con nombre `zerotouch_hito2_esquema_con_roles.sql`. Solicitarlo al usuario solo si resulta necesario para la tarea y no está disponible; no fingir haberlo leído. Puede diseñarse una propuesta desde el contrato, pero no darla por validada contra ese documento.

- usuarios: UUID, nombre_usuario único normalizado, contrasena_hash, rol user/admin, estado activo/suspendido y fechas.
- sesiones: token_hash, usuario_id, creado_en y expira_en. Token original nunca almacenado en base.
- perfiles: UUID, usuario_id, nombre, descripcion, version y fechas.
- modos_uso: UUID, perfil_id, nombre, categoria, plataforma, sensibilidad_puntero, estabilizacion_puntero, tolerancia_micro_pinza, opciones booleanas previstas, version y fechas.
- acciones: codigo y nombre; catálogo de acciones lógicas, sin comandos arbitrarios.
- gestos: codigo, nombre y accion_predeterminada referida al catálogo.
- asignaciones_gestos: modo_id, gesto_codigo, accion_codigo, habilitado, version y actualizado_en; clave compuesta modo/gesto.
- usuarios → sesiones/perfiles → modos → asignaciones: cascadas documentadas. Catálogos referenciados no se eliminan libremente.
- IDs NOT NULL, tipos estrictos, FK activas por conexión, rangos 0–100 enteros y booleanos 0/1. Validación adicional en servicios.
- Configuraciones de mirada/móvil/Desk-Rest son datos previstos, no prueba de capacidades. No almacenar video, landmarks ni texto de Air-Swipe.
- version comienza en 1. PATCH de perfiles/modos recibe version esperada: comparación e incremento atómicos; conflicto 409. La sincronización debe usar identidad y versiones, gestionar cambios y borrados, y resolver conflictos sin pérdida silenciosa.
- Normalizar nombres y documentar alcance Unicode de unicidad. No confiar solamente en NOCASE para todas las letras.

### DTO y HTTP

- Prefijo `/api/v1`. Español y snake_case en DTO.
- Éxito: `{ "data": ... }`. Listado: `{ "data": [], "paginacion": { "limite": 20, "offset": 0 } }`.
- Error: `{ "error": "CODIGO", "mensaje": "Mensaje seguro" }`.
- Creación 201 con Location cuando corresponda; lectura/edición 200; borrado/logout 204 sin cuerpo.
- 400 entrada inválida; 401 sesión inválida; 403 rol/CSRF; 404 recurso inexistente o privado ajeno; 409 duplicado/versión; 413 tamaño; 415 formato; 429 límite; 500 genérico; 503 bloqueo temporal de datos.
- GET listados admite limite 1–100 y offset >= 0. Rechazar campos y parámetros desconocidos.
- POST perfil: nombre y descripcion opcional. POST modo: nombre y parámetros opcionales; perfil procede de la ruta.
- PATCH recibe campos mutables permitidos y version; no puede cambiar propietario, perfil padre, ID, fechas ni rol.
- Booleanos JSON reales, no cadenas. Parámetros de configuración enteros 0–100.
- Fechas expuestas en UTC con formato documentado consistente.

### Autenticación y seguridad

- Conserva el registro actual con nombre_usuario, correo y contrasena, la verificación de correo y la recuperación de contraseña. El registro nunca concede rol admin. Mantén el acceso por usuario o correo según el contrato vigente.
- Hash Argon2id con parámetros explícitos comprobados; nunca contraseña reversible ni hash enviado por cliente.
- Sesión opaca aleatoria; cookie `zt_session`, HttpOnly, SameSite=Strict, Path=/api/v1; Secure en HTTPS/producción. TTL inicial 8 horas configurable.
- Login y GET /auth/sesion devuelven `{data:{usuario:{id,nombre_usuario,rol,estado},csrf_token:"..."}}`. No exponer hash de contraseña ni hash/token de sesión.
- CSRF ligado a sesión para POST/PATCH/PUT/DELETE autenticados, cabecera X-CSRF-Token; validar Origin si está presente. Usar primitiva estándar y comparación constante; no guardar el token original de sesión para derivarlo.
- Rate limiting acotado de login/registro, inicialmente en memoria para un solo proceso; documentar reinicio y límites. Toda ampliación del modelo requiere una necesidad concreta, migración y pruebas; conserva las ampliaciones ya implementadas.
- Los módulos de seguridad exportan `createAuthMiddleware({db,config})`, `createAuthRouter({db,config})` y `createAdminRouter({db,config})` en sus módulos correspondientes. El middleware autentica y aplica CSRF en mutaciones protegidas.
- `req.auth = { usuarioId, rol, sesionId }`; sesionId es identificador interno no expuesto ni registrado. Los servicios usan usuarioId para delimitar todos los recursos.
- `/auth/registro` y `/auth/login` son públicos; GET /auth/sesion y POST /auth/logout son protegidos. La aplicación monta rutas privadas de recursos y administración después del middleware. No proteger accidentalmente el registro/login.
- Admin gestiona roles/estado, sin lectura general de configuraciones privadas. Revocar sesiones al cambiar rol/estado/contraseña si esa operación existe. Impedir dejar el sistema sin administrador activo.
- Inicialización del primer admin mediante CLI local; sin credenciales fijas, sin contraseña en argumentos/logs y sin endpoint público de bootstrap.
- La aplicación de demostración usa loopback y cliente API. HTTPS se requiere si se expone fuera del equipo; no declarar despliegue remoto hecho. No abrir CORS universal ni desactivar protecciones.

### Endpoints obligatorios

- GET /health.
- POST /auth/registro, POST /auth/login, GET /auth/sesion, POST /auth/logout.
- GET/POST /perfiles; GET/PATCH/DELETE /perfiles/:id.
- GET/POST /perfiles/:id/modos; GET/PATCH/DELETE /modos/:id.
- GET /gestos, GET /acciones.
- GET /modos/:id/gestos: configuración efectiva; asignación sobreescribe catálogo y habilitado=false deshabilita. Siempre comprobar propietario.
- GET /admin/usuarios; PATCH /admin/usuarios/:id/rol con {rol}; PATCH /admin/usuarios/:id/estado con {estado}.

Completa la edición de asignaciones cuando lo requiera la tarea: valida propiedad, versión y compatibilidad con las acciones implementadas. La lectura efectiva y el motor deben compartir el contrato; nunca autorices comandos arbitrarios. No es obligatorio añadir CRUD general de usuarios o catálogos sin una necesidad de producto.

### Motor local

- Windows como única plataforma validada inicialmente. Versiones Python/MediaPipe/pynput y modelo se fijan tras prueba real.
- Módulos separados: captura, detector, interpretación, acciones y adaptador SO.
- Mínimo: puntero, clic por micro-pinza, pausa/parada. No un clic por cada fotograma.
- Empezar en observación, sin inyectar entradas; activar control explícitamente. Parada por teclado accesible y liberación de botones/cámara en finally, fallo o pérdida de mano.
- Configuración inicial JSON local validada con nombres/rangos del DTO y versión de formato. Usar los valores reales del contrato: no confundir defaults con calibración medida.
- Para la demo, exportar configuración obtenida por API a JSON SIN credenciales y cargarla explícitamente en el motor. La sincronización se realiza fuera del ciclo gestual y sin introducir HTTP por fotograma; evita duplicar en Python la autenticación que ya gestiona la aplicación.
- El motor funciona sin red después de cargar el JSON. Solo ejecuta acciones implementadas de una lista permitida; un catálogo futuro nunca autoriza shell, rutas o comandos arbitrarios.
- Documenta la transformación 0–100 a umbrales/ganancias. No prometer FPS, precisión o latencia sin medir.

## Secuencia de trabajo

Trabaja por bloques pequeños según la tarea y sus dependencias, sin asumir tres personas ni una disponibilidad fija de siete días:
1. Verificar estado y reproducir los problemas relevantes.
2. Corregir integración, seguridad y contratos antes de añadir funciones dependientes.
3. Implementar cada flujo completo entre interfaz, API, datos y motor, según corresponda.
4. Ejecutar pruebas significativas y revisar el diff.
5. Documentar resultados, límites y pasos de continuación.

No reduzcas seguridad para aparentar progreso. No cambies unilateralmente los compromisos de Hito 1. Si falta hardware, una credencial o un permiso externo, continúa el trabajo independiente y documenta el bloqueo concreto. No declares como terminada una función simulada o sin validar.

## Calidad, Git y entrega

- Cada cambio incluye las pruebas significativas que correspondan; datos ficticios y bases aisladas.
- Probar: CRUD, JSON/códigos, duplicados, tipos/rangos, FK, versiones, 401/403/404, acceso de A a B, intento de rol admin, CSRF, revocación, entradas SQL, reinicio real y cierre.
- Configuración de prueba/fixtures nunca se expone mediante una ruta ni un bypass de producción.
- Demuestra persistencia terminando y arrancando nuevamente el proceso sobre la misma base de prueba; cerrar/abrir una conexión en el mismo proceso no basta para esa evidencia.
- No fabricar resultados ni reutilizar informes antiguos como prueba nueva. Distinguir probado automático, probado manual, implementado sin probar, simulado y pendiente.
- No afirmar instalación en otro computador si solamente se ejecutó en el equipo del autor.
- Commits pequeños y explícitos; inspeccionar diff y archivos staged. No `git add .` en el estado local con artefactos no versionados.
- Un PR por unidad revisable, con resumen, pruebas y límites. Revisión del diff y de resultados; el usuario realiza la revisión humana final. No push, merge, publicación ni cambios remotos salvo autorización explícita del usuario. Prepara commits locales solo del trabajo de la sesión cuando estén autorizados y verificados; no incorpores cambios previos no relacionados.
- No borrar trabajo ajeno, force push, reset destructivo ni editar historial para simular aportes.
- Ninguna clave, token, contraseña real, .env, base SQLite, WAL/SHM, respaldo con datos, node_modules ni artefacto compilado en commits.
- Documenta cada módulo modificado y consolida el informe cuando lo solicite la tarea, según índice: introducción, continuidad H1, arquitectura, datos, API, implementación/pruebas, conclusión, bibliografía y anexos.
- Fuentes oficiales verificadas y citas APA 7. Declarar uso de IA y revisión humana. Deja explicaciones suficientes para que el usuario pueda revisar y explicar el código y sus decisiones. Conserva los créditos históricos; trabajar ahora de forma individual no autoriza borrar autorías anteriores.

## Comunicación entre sesiones

Al comenzar: rama, estado observado, objetivo del bloque y dependencias reales.
Al cerrar cada bloque: archivos/commit, interfaces modificadas, comandos de verificación y resultados, pendientes y bloqueos concretos. No afirmes haber contactado a personas o realizado revisiones que no ocurrieron.
Trabaja en bloques pequeños, preserva contexto mediante notas y no repitas auditorías completas innecesarias. Si se agota Codex, deja instrucciones reproducibles para revisión manual. Nunca supongas tokens o solicitudes ilimitados.
