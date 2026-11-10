# Entrega I1 — Datos y seguridad

Estado: módulos desarrollados y comprobados aisladamente. El servidor principal todavía no los monta. Este documento no afirma que el Hito 2 completo esté terminado.

## Entrega concreta a I2

No se editaron app.js, server.js, config/env.js, package.json ni package-lock.json. No se conectó React. No se sustituyó el backend anterior.

### Dependencias y configuración pendientes de integración

Declarar y fijar en backend/package.json y su lockfile:
- better-sqlite3 13.0.3.
- argon2 0.45.1.

Ya están instaladas localmente y cargaron con Node 24.19.0, SQLite 3.53.4. Otra máquina necesita instalación desde el manifiesto corregido; no copiar node_modules. Verificar instalación limpia antes de marcar reproducibilidad completa.

Convertir variables de entorno a este objeto de configuración:

```js
{
  nodeEnv: 'development',
  appOrigin: 'http://127.0.0.1:3000',
  sessionTtlSeconds: 28800
}
```

PORT/HOST/DATABASE_PATH los maneja I2 para arrancar. El .env se carga desde la raíz, no desde el directorio del comando. Los scripts I1 ya lo hacen. La raíz contiene .env.example y exclusiones de bases/claves; backend/.env.example anterior aún solo describe PORT y requiere que I2 armonice la documentación de carga al integrar.

### Imports y montaje

Desde backend/src/app.js:

```js
import { createAuthRouter } from './routes/authRoutes.js';
import { createAdminRouter } from './routes/adminRoutes.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { authErrorHandler } from './security/auth-errors.js';

// app y {db, config} corresponden a la composición de I2.
app.use(express.json({ limit: '16kb' }));
app.use('/api/v1/auth', createAuthRouter({ db, config }));
app.use('/api/v1/admin', createAdminRouter({ db, config }));
// Montar salud pública antes del middleware general.
app.use('/api/v1', createAuthMiddleware({ db, config }));
// Aquí I2 monta sus CRUD y catálogos protegidos.
// Tras las rutas/404, antes del manejador genérico:
app.use(authErrorHandler);
```

Este es un ejemplo de integración, no una segunda aplicación. createAuthRouter protege internamente sesión/logout; registro/login son públicos. createAdminRouter se protege internamente, aunque se monte antes del middleware general. No colocar el middleware general antes de registro/login. No repetir el parser si ya existe.

AuthError lleva status/code/message. authErrorHandler traduce únicamente esos errores al JSON acordado; los demás pasan al manejador general de I2. I2 debe cubrir JSON inválido, tamaño, Content-Type y errores de datos inesperados con respuestas seguras; no devolver stack ni SQL. Su composición aún debe aplicar 413/415 y la política general de errores.

Middleware de identidad: `req.auth = { usuarioId, rol, sesionId }`. sesionId es el hash interno: no enviarlo ni registrarlo. I2 debe filtrar todas las operaciones de perfiles/modos/asignaciones por usuarioId, incluso si el rol es admin. I1 no implementó esos repositorios: aislamiento de recursos privados se validará al integrarlos.

### Rutas entregadas

| Método y ruta completa | Entrada | Respuesta |
|---|---|---|
| POST /api/v1/auth/registro | nombre_usuario, contrasena | 201 {data: usuario público}; 400/409/429 |
| POST /api/v1/auth/login | nombre_usuario, contrasena | 200 {data:{usuario,csrf_token}} y cookie; 400/401/403/429 |
| GET /api/v1/auth/sesion | Cookie | 200 {data:{usuario,csrf_token}}; 401/403 |
| POST /api/v1/auth/logout | Cookie y X-CSRF-Token | 204 y cookie eliminada; 401/403 |
| GET /api/v1/admin/usuarios | Sesión admin; limite y offset opcionales | 200 {data,paginacion}; 400/401/403 |
| PATCH /api/v1/admin/usuarios/:id/rol | {rol}; sesión admin y CSRF | 200 {data:usuario}; 400/401/403/404/409 |
| PATCH /api/v1/admin/usuarios/:id/estado | {estado}; sesión admin y CSRF | 200 {data:usuario}; 400/401/403/404/409 |

Usuario público contiene id, nombre_usuario, rol y estado. No contiene hashes, tokens de sesión ni contraseña. El registro no inicia sesión automáticamente. No se publica Location en registro porque no existe una ruta pública para consultar esa cuenta.

## Recorrido y responsabilidades

Una petición de login entra a authRoutes, verifica origen, pasa a authController, authService valida credenciales y limita intentos, usuariosRepository busca la cuenta y passwords verifica Argon2id. Tras la verificación asíncrona se relee el estado y se crea una sesión dentro de una transacción. El controlador entrega cookie y DTO público.

La administración verifica sesión vigente y rol actual, actualiza rol/estado y revoca sesiones en la misma transacción. No se permite quitar el último administrador activo. El bootstrap local solamente crea una cuenta nueva si no hay administrador activo; no convierte ni reemplaza cuentas existentes.

## Protección de datos

- Contraseñas: Argon2id, memoria 65536 KiB, 3 iteraciones, paralelismo 1, salida 32 bytes; salt aleatorio generado por la biblioteca. Longitud de entrada 15–128 caracteres y hasta 512 bytes. Máximo dos operaciones de hash/verificación simultáneas.
- Sesiones: token aleatorio de 32 bytes, solo SHA-256 persistido, TTL de 8 h por defecto, máximo cinco sesiones por cuenta. Al cerrar sesión se elimina el registro; cambios administrativos revocan las sesiones afectadas.
- Cookie: HttpOnly, SameSite Strict, Path /api/v1; Secure cuando el origen es HTTPS. Producción rechaza origen HTTP. No JWT ni almacenamiento en localStorage.
- CSRF: HMAC-SHA256 con el token de sesión como clave y propósito fijo. El token crudo solo vive en la petición/cookie, no se guarda en la base. X-CSRF-Token requerido en mutaciones protegidas; comparación de bytes constante. Validación de Origin cuando existe y rechazo de Sec-Fetch-Site cross-site.
- Login/registro: límites por IP y nombre normalizado en memoria durante 15 minutos, con un máximo de 2000 buckets. Registro: 10/IP y 10/nombre; login: 30/IP y 10/nombre. No confiar en X-Forwarded-For. Un reinicio limpia estos límites; diseño de un único proceso, no distribuido.
- Registro duplicado devuelve 409 y por ello revela disponibilidad del nombre de cuenta: decisión de contrato, no se afirma protección contra enumeración de nombres. Login fallido usa mensaje genérico.
- Consultas: valores parametrizados; transacciones para operaciones compuestas. SHA-256 de sesión no sustituye Argon2id de contraseñas: el token tiene entropía aleatoria alta.
- Persistencia: SQLite no está cifrada en su totalidad. No se declara cifrado de nombres/configuraciones. El archivo debe quedar en almacenamiento local privado; 0600/0700 se solicitan en sistemas POSIX. En Windows se heredan ACL del directorio: verificar acceso del usuario en la instalación final, no afirmar protección ACL demostrada.
- Sin videos, coordenadas de manos, historial de gestos ni texto Air-Swipe. No usar datos personales reales en la demo.
- HTTP loopback sirve solo para demo local. Un despliegue externo necesita HTTPS y revisión del proxy/origen; no está implementado ni validado aquí.

## Ejecución y pruebas

Desde la raíz, con dependencias disponibles:

```text
node backend/scripts/init-db.js
node backend/scripts/bootstrap-admin.js
node --test --test-concurrency=1 backend/test/database/schema.test.js backend/test/security/auth.test.js
```

El bootstrap exige terminal interactiva y rechaza argumentos; pide contraseña oculta y confirmación. No se creó una cuenta de desarrollo ni se ejecutó ese asistente con credenciales reales durante esta entrega. La lógica de bootstrap sí se prueba con cuentas ficticias.

Las pruebas HTTP montan únicamente un servidor de test temporal con Express. Esto permite probar los módulos sin editar app.js de I2. El endpoint test-identidad existe exclusivamente en ese archivo de prueba.

Resultados y límites de la verificación:
- Suite ejecutada en este equipo: **15 pruebas aprobadas, 0 fallos** (6 de datos y 9 de seguridad). Sintaxis comprobada en los 21 archivos JavaScript nuevos; git diff --check sin errores. No se presenta esto como una auditoría de seguridad completa.
- Integridad, catálogos, FK/cascadas, rangos, exclusividad, reapertura y cierre de SQLite comprobados.
- Registro, hash real, cookie, consulta, logout, expiración, CSRF, orígenes, rol administrativo, revocación, último admin y limitación de intentos comprobados por HTTP.
- Pendiente: montar en el servidor principal, instalar dependencias desde un lockfile actualizado, probar acceso A→B en CRUD reales, verificar reinicio completo del servidor de producto, instalación en otro equipo y asistente de terminal manual.
- Una prueba inicial suponía un orden fijo de parámetros en la representación textual Argon2; se corrigió para comprobar los valores independientemente del orden, sin cambiar el algoritmo ni debilitar los parámetros.

## Entrega a I3

Usar el SQL nuevo, las variables y los comandos anteriores. Generar cuentas ficticias en la colección; no exportar cookies/tokens/contraseñas reales. Recuperar csrf_token de login o sesión para mutaciones. No invocar la base del runtime anterior. El reinicio completo y el aislamiento de perfiles/modos deben probarse después del montaje de I2.

## Referencias técnicas verificadas

- SQLite. (s. f.). STRICT Tables. https://www.sqlite.org/stricttables.html
- WiseLibs. (s. f.). better-sqlite3 API. https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
- Ranisalt y colaboradores. (s. f.). node-argon2. https://github.com/ranisalt/node-argon2
- Express. (s. f.). Production best practices: Security. https://expressjs.com/en/advanced/best-practice-security/

SQLite fundamenta el uso de tipos estrictos; better-sqlite3 documenta conexión/transacciones; node-argon2 documenta hash/verificación. Las medidas de cookies, validación y TLS siguen la guía de Express. Estas fuentes no certifican la seguridad del proyecto: las comprobaciones y limitaciones se declaran arriba.

Apoyo de IA: Codex ayudó a implementar y probar los módulos. El equipo debe revisar el diff y poder explicar SQL, hash, sesión, CSRF y autorización antes de entregar.

## Actualización del 10 de noviembre de 2026: verificación de correo (esquema v2)

Detalle completo, tabla de vulnerabilidades y resultados en `docs/hito2/auditoria-seguridad.md`; historial en `CHANGELOG.md`.

- Registro con `nombre_usuario`, `correo` y `contrasena`; la cuenta queda sin verificar y la respuesta es 202 genérica. El login, el middleware y la administración rechazan cuentas sin correo confirmado.
- Tabla nueva `tokens_cuenta`: solo SHA-256 de tokens aleatorios de 32 bytes, un solo uso, ligados al correo, 24 h (verificación) y 30 min (recuperación). Columnas nuevas `usuarios.correo` y `usuarios.correo_verificado_en`.
- Endpoints públicos nuevos: `POST /auth/verificacion`, `/auth/verificacion/reenviar`, `/auth/correo`, `/auth/contrasena/olvido`, `/auth/contrasena/restablecer`. Páginas `/cuenta/verificar` y `/cuenta/restablecer` con CSP estricta; el token viaja en el fragmento de la URL.
- Registro, reenvío y recuperación no revelan si un correo existe; el correo ajeno no se reasigna y su dueño recibe un aviso.
- Restablecer la contraseña revoca todas las sesiones de la cuenta.
- Bases v1: `npm run db:migrate --prefix backend` (respaldo previo, migración aditiva). El arranque nunca migra solo.
- `bootstrapAdmin(db, nombre, contrasena, correo)` crea el administrador sin verificar y devuelve el token para que el CLI lo envíe por correo; el token nunca se imprime.
- Registro de eventos de seguridad en `stderr` con lista blanca de campos (sin datos personales ni secretos).
