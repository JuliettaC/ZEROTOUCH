# Decisiones técnicas del backend (registro operativo)

Fecha: 19 de octubre de 2026. Alcance aprobado: Hito 2 técnico.
No es el informe académico ni una presentación.

## Continuidad y alcance

Se conservan JavaScript, React/Vite/CSS y Node/Express. En el Informe Hito 1,
páginas físicas 5–8, el servidor se destina a perfiles/preferencias y se elige
Express frente a FastAPI. No se incorpora Python al backend: el Python citado
en Hito 1 corresponde al adaptador futuro del sistema operativo.

El informe no seleccionó motor de datos. SQLite y better-sqlite3, perfiles y
contextos fueron aprobados expresamente para esta etapa. No son decisiones
atribuidas retrospectivamente al Hito 1.

La planificación de la página física 9 priorizaba cámara y control del SO en
Hito 2. La pauta obligatoria prioriza dos CRUD, capas y persistencia. Se
reprograman cámara/detección/control del SO; no se cambia la finalidad del
producto. Autenticación y sincronización siguen siendo compromisos futuros:
esta API local no autentica ni demuestra sincronización multiusuario. Los
perfiles son configuraciones, no identidades verificadas.

## Monolito por capas

Un proceso Express ofrece ambos recursos. Rutas y controladores gestionan HTTP;
servicios validan y coordinan reglas; repositorios son los únicos que consultan
SQL (salvo inicialización/configuración y pruebas de integridad). Se comparten
helpers pequeños para los dos recursos con estructura similar; no hay un ORM
ni un framework genérico externo. El ensamblaje vive en app.js.

Recorrido de POST contextos: ruta → controlador → servicio valida contrato y
perfil → repositorio inserta mediante parámetros → SQLite verifica FK/UNIQUE/
CHECK → controlador devuelve 201 y Location. El middleware convierte errores
en JSON. Las restricciones SQL siguen protegiendo los datos ante conflictos.

Hipótesis explícita: demostración local y pocas escrituras de configuración,
no inferencia de video ni alta carga medida. Un equipo de tres integrantes y
un plazo aproximado de una semana favorecen un despliegue único. Microservicios
añadirían contratos entre servicios, operación y fallos de red sin necesidad
actual. Separar cliente y servidor no obliga a usar microservicios.

## SQLite frente a PostgreSQL

| Aspecto | SQLite elegido | PostgreSQL como alternativa |
|---|---|---|
| Instalación | Motor embebido; archivo local y biblioteca nativa | Servicio separado; inicialización de instancia y acceso |
| Integridad | Tablas STRICT, PK, FK, UNIQUE, CHECK y transacciones | Restricciones relacionales y transacciones; adecuado también al modelo |
| Escrituras concurrentes | Un escritor por base; escrituras cortas y espera limitada | MVCC y bloqueos más granulares para sesiones concurrentes |
| Operación | Sin puerto/usuario de DB; permisos del SO sobre archivos | Roles, autenticación, red y administración del servicio |
| Escalado | Una instancia local; no compartir el archivo entre máquinas | Mejor candidato para varias instancias API y base centralizada |
| Costos asumidos | Acceso síncrono bloquea el hilo Node durante cada consulta; módulo nativo; gestión de respaldos del archivo | Más instalación, configuración, credenciales, conexiones y mantenimiento |
| Migración futura | SQL y driver específicos; migrar no será automático | Requerirá repositorios nuevos, adaptación de tipos/esquema y pruebas |

Ambos motores pueden utilizarse sin pagar licencia; el costo relevante aquí
es tiempo de configuración, operación y verificación. No se atribuyen cifras
de rendimiento: no se hizo benchmark ni se conocen usuarios concurrentes
reales. SQLite permite demostrar persistencia con menor infraestructura en
esta fase. No se elige porque PostgreSQL sea demasiado complejo en general.

WAL permite coexistencia de lectores con una escritura, no múltiples escritores
simultáneos. better-sqlite3 tiene API síncrona: limitar listados reduce trabajo,
pero no convierte este servicio en una solución de alta concurrencia. Se
reconsiderará PostgreSQL al requerir múltiples instancias API, escrituras
concurrentes sostenidas, administración por roles o disponibilidad/respaldos
gestionados. Entonces se medirán latencia y contención con carga representativa.

## Almacenamiento y reproducibilidad

La base activa reside fuera de OneDrive. Se validan la ruta y sus antecesores
reales para detectar enlaces/junctions; se rechazan rutas OneDrive conocidas
por nombre/variables de entorno y rutas UNC. No es un detector universal de
otros proveedores de sincronización o unidades mapeadas: el operador debe
elegir almacenamiento local. Los scripts y el modelo sí están versionados.

Node 24 es el entorno soportado por este proyecto (`engines >=24 <25`). La
dependencia directa nueva es better-sqlite3 13.0.3 exacta; sus metadatos admiten
Node >=22. El lockfile fija dependencias transitivas. `npm ci` reconstruye el
árbol; no se copia node_modules entre equipos. Si una plataforma carece de
binario compatible, podría necesitar herramientas de compilación nativa.
La instalación y pruebas locales no certifican plataformas no ejecutadas.

El frontend sigue con localStorage. Integrarlo ahora requiere decidir selección
de perfil, importación de preferencias existentes y resolución de errores de
red. No se inventa ese flujo ni se migra silenciosamente información local.

## Fuentes oficiales usadas para las decisiones

- SQLite, usos y límites: https://www.sqlite.org/whentouse.html
- SQLite, WAL y respaldos: https://www.sqlite.org/wal.html
- SQLite, claves foráneas: https://www.sqlite.org/foreignkeys.html
- better-sqlite3, instalación y API síncrona: https://github.com/WiseLibs/better-sqlite3
- PostgreSQL, control de concurrencia: https://www.postgresql.org/docs/18/mvcc.html
- PostgreSQL, autenticación del servidor: https://www.postgresql.org/docs/18/auth-pg-hba-conf.html
- Node, test runner: https://nodejs.org/docs/latest-v24.x/api/test.html
- Express, manejo de errores: https://expressjs.com/en/guide/error-handling.html

Las fuentes sustentan los mecanismos técnicos; el tamaño del equipo, plazo y
decisión de alcance provienen del proyecto y autorización del usuario.
