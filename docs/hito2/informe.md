# ZeroTouch - Hito 2: backend y verificación integral

Universidad Mayor. Arquitectura y Desarrollo (móvil y web). Integrantes: Julietta Céspedes, Adan Mendoza y Anais Perez. Fecha: 2 de noviembre de 2026.

Documento consolidado del backend. Por instrucción del usuario, el desarrollo y la validación del software gestual quedan a cargo de Antigravity. Este informe no certifica ese software ni reemplaza el informe completo del equipo.

## 1. Introducción

ZeroTouch propone interacción gestual para consultar información durante tareas manuales. El Hito 2 requiere convertir configuraciones del prototipo en recursos persistentes, con identidad y autorización. La entrega actual implementa una API local demostrable y entrega una configuración efectiva que otro componente puede cargar explícitamente. Se priorizan dos CRUD completos, seguridad y persistencia verificable dentro de una semana de trabajo.

## 2. Continuidad con Hito 1

El prototipo web permanece como antecedente de interfaz. Sus pantallas no acreditan almacenamiento ni reconocimiento. Perfiles y modos ahora tienen representación SQL y operaciones HTTP reales. Los catálogos mantienen acciones futuras, pero su presencia no significa que el motor las ejecute. Air-Swipe, mirada, móvil, sincronización automática y conexión de React quedan fuera del alcance actual. La matriz de trazabilidad explicita esa separación.

## 3. Arquitectura y tecnologías

Se utiliza un monolito modular Node.js 24.19.0 con Express 5.2.1. Las rutas definen recursos, los controladores adaptan HTTP, los servicios validan reglas y los repositorios ejecutan consultas parametrizadas. El middleware aplica sesión, CSRF y errores seguros. `createApp({db,config})` permite componer y probar sin abrir puertos al importar; server.js abre una base existente y administra inicio/cierre.

SQLite con better-sqlite3 13.0.3 reduce la infraestructura necesaria para una demostración local. Las transacciones y restricciones mantienen consistencia; el bloqueo temporal se comunica con 503. No se afirma escalabilidad horizontal. La base reside fuera de OneDrive y del repositorio. Express documenta la propagación de errores hacia middleware; el proyecto añade un sobre JSON seguro en esa frontera (Express, s. f.).

Flujo: cliente API -> rutas/middleware -> controlador -> servicio -> repositorio -> SQLite. El flujo gestual no atraviesa este servidor por fotograma. Una lectura autenticada produce JSON y el consumidor decide cuándo cargarlo.

## 4. Modelo y persistencia

El esquema nuevo contiene usuarios, sesiones, perfiles, modos_uso, gestos, acciones y asignaciones_gestos. Usuario posee perfiles; perfil contiene modos; modo puede sobrescribir asignaciones del catálogo. Sesiones dependen del usuario. El borrado en cascada elimina descendientes privados, mientras referencias de catálogo restringen borrado inconsistente.

Se utilizan UUID, NOT NULL, FK por conexión, tablas STRICT y CHECK para roles, estados, rangos enteros 0-100 y booleanos 0/1. STRICT complementa las validaciones del servicio, no reemplaza todas las reglas de negocio (SQLite, s. f.). Nombres visibles se normalizan a NFC; NOCASE limita su comparación insensible a mayúsculas al ámbito ASCII. Esta limitación se declara, no se presenta como colación Unicode completa.

PATCH exige version esperada. El repositorio compara e incrementa de forma atómica: una escritura concurrente gana y la obsoleta devuelve 409. Esto detecta conflictos locales; no implementa sincronización. SQL reproducible y apertura exclusiva impiden reinicializar una base existente o adaptar silenciosamente un esquema ajeno.

## 5. API y seguridad

Prefijo `/api/v1`. Éxito `{data:...}`; listados añaden paginacion con limite/offset; error `{error:CODIGO,mensaje:...}`. Creación 201, lectura/edición 200 y borrado/logout 204. El contrato OpenAPI documenta 15 rutas y 21 operaciones. Salud pública; registro y login públicos; recursos y administración requieren sesión.

Registro crea user activo. Argon2id protege contraseñas con parámetros explícitos. Login entrega cookie de sesión opaca y token CSRF; SQLite conserva el hash del token de sesión, no el original. HttpOnly, SameSite=Strict y Secure según HTTPS/producción limitan exposición. Mutaciones requieren X-CSRF-Token y validan Origin cuando existe. Roles y suspensión revocan sesiones; no se permite eliminar al último administrador activo mediante esos cambios.

Propiedad se deriva de la sesión y delimita todas las consultas de recursos. Un admin administra cuentas, pero no obtiene acceso general a perfiles ajenos. Recurso inexistente o ajeno devuelve 404. El primer admin se crea por CLI interactiva sin contraseña en argumentos. Se aplican límites de autenticación en memoria para un único proceso; un reinicio restablece contadores. La base completa no está cifrada y no se ha realizado despliegue remoto.

La exportación `GET /modos/:id/gestos` devuelve formato_version 1, modo y gestos efectivos, con booleanos JSON. Una asignación prevalece sobre el catálogo y habilitado=false deshabilita. No incluye credenciales. No existe editor HTTP general de asignaciones en este mínimo.

## 6. Implementación y verificación

I1 aportó SQL, conexión, autenticación y administración. I2 integró aplicación, CRUD, contrato y automatización. I3 agregó colección y prueba de extremo a extremo, consolidando evidencias sin modificar producción ajena. La colección tiene 24 solicitudes, variables locales para datos ficticios y comprobación de códigos HTTP. La integración ejecuta esas solicitudes contra el servidor de producto, con un adaptador acotado de scripts Postman.

La suite conjunta obtuvo 24 pruebas aprobadas, cero fallos. Se comprueban integridad, autenticación, expiración/revocación, roles, CSRF, acceso A a B, duplicados, tipos/rangos, conflictos de versión, errores de formato/tamaño y bloqueo SQLite. Para persistencia se termina el proceso con salida 0, se arranca otro PID sobre el mismo archivo y se recuperan modo y sesión. Esta evidencia supera una simple reapertura de conexión dentro del mismo proceso.

La prueba I3 verifica también el contenido del DTO exportado y ausencia de credenciales. No requiere Python ni cámara. El servidor escucha solo en loopback, usa cuentas ficticias y elimina exclusivamente la carpeta temporal creada por cada prueba. No hay endpoints de bypass para facilitar el recorrido.

Quedan pendientes importación manual en Postman, revisión por otro integrante, instalación en otro computador y ensayo de siete minutos. Una instalación limpia en el equipo del autor no equivale a otra máquina. Las notas históricas I1/I2 conservan sus resultados de etapa; el registro I3 describe el estado integrado. No se presenta la suite como auditoría exhaustiva de seguridad o medición de carga.

## 7. Conclusión

El backend permite demostrar dos recursos persistentes con autenticación, autorización y control de versión. La colección y el reinicio real hacen reproducible el recorrido de entrega. La siguiente prioridad es revisión cruzada e instalación independiente. La coordinación con el software gestual se limita al contrato JSON; su funcionamiento se valida en su propio trabajo, sin condicionar las pruebas del servidor.

## 8. Bibliografía

Express. (s. f.). *Error handling*. https://expressjs.com/en/guide/error-handling/

SQLite. (s. f.). *STRICT Tables*. https://www.sqlite.org/stricttables.html

Equipo ZeroTouch. (2026). *Informe Hito 1* [Informe académico]. Repositorio ZeroTouch, docs/Informe Hito 1.pdf.

Equipo ZeroTouch. (2026). *Datos y seguridad; API y arquitectura* [Documentación técnica]. docs/hito2/datos-seguridad.md y docs/hito2/api-arquitectura.md.

Las fuentes oficiales se verificaron durante el trabajo; respaldan tecnologías y decisiones generales, no certifican resultados propios.

## 9. Anexos y declaración de apoyo

Anexos reproducibles: db/schema.sql, docs/api/openapi.yaml, docs/api/coleccion.json, docs/api/entorno.example.json y docs/hito2/pruebas.md. README contiene instalación y comandos. La colección usa información ficticia; no se adjuntan bases ni secretos.

Codex asistió en implementación, pruebas y redacción. Los integrantes deben revisar los cambios y explicar las decisiones antes de entregar. La revisión humana completa y la defensa no se dan por realizadas. El usuario solicitó continuar el software gestual con Antigravity; este documento mantiene separada esa responsabilidad.
