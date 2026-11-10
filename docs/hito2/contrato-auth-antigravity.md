# Contrato de autenticación para Antigravity

Base local: `http://127.0.0.1:3000/api/v1`. Estado revisado el 2 de noviembre de 2026.

## Implementación

El backend ya abre DATABASE_PATH desde el .env raíz mediante loadConfig y openDatabase. El arranque no inicializa ni migra el esquema. Se reutilizan authRoutes → authController → authService → usuariosRepository/sesionesRepository. Se añade GET /auth/me usando el mismo controlador y middleware que /auth/sesion, que permanece compatible. No hay cambios de esquema ni del frontend Tauri.

Registro valida los campos, normaliza el identificador a minúsculas y crea user activo. Argon2id usa 65536 KiB, tres iteraciones y paralelismo 1. Solo se almacena el hash SHA-256 de la sesión aleatoria en sesiones. Los repositorios de recursos delimitan consultas y escrituras por el usuario autenticado, incluido admin.

## Solicitudes y respuestas

POST /auth/registro y POST /auth/login reciben Content-Type: application/json y exclusivamente:

```json
{"nombre_usuario":"demo_usuario","contrasena":"Ejemplo ficticio de acceso 2026!"}
```

nombre_usuario: 3–40 caracteres ASCII, letras, números o guion bajo. contrasena: 8–128 caracteres y hasta 512 bytes UTF-8 (antes 15–128; cambio del 10-11-2026). El registro exige además `correo` y rechaza contraseñas comunes o iguales al usuario o correo. El ejemplo es ficticio y no crea credenciales predefinidas. Campos adicionales, incluido rol, se rechazan con 400.

Registro: 201; no inicia sesión automáticamente:

```json
{"data":{"id":"UUID","nombre_usuario":"demo_usuario","rol":"user","estado":"activo"}}
```

Login: 200 y Set-Cookie: zt_session. GET /auth/me y el alias GET /auth/sesion no reciben cuerpo y requieren esa cookie. Los tres devuelven:

```json
{"data":{"usuario":{"id":"UUID","nombre_usuario":"demo_usuario","rol":"user","estado":"activo"},"csrf_token":"VALOR_DEVUELTO_POR_EL_SERVIDOR"}}
```

POST /auth/logout: sin cuerpo; enviar cookie y X-CSRF-Token con el valor recibido. Respuesta 204 sin JSON, elimina sesión y cookie. La cookie anterior deja de autorizar /me y los recursos privados. Una sesión ausente, expirada o revocada devuelve 401.

Errores tienen siempre esta forma:

```json
{"error":"CREDENCIALES_INVALIDAS","mensaje":"Credenciales inválidas."}
```

| Situación | HTTP / código |
|---|---|
| Campos inválidos, contraseña corta o rol público | 400 / DATOS_INVALIDOS |
| Usuario duplicado | 409 / USUARIO_DUPLICADO |
| Credenciales incorrectas o usuario suspendido al entrar | 401 / CREDENCIALES_INVALIDAS |
| Sesión inválida | 401 / SESION_INVALIDA |
| CSRF ausente o incorrecto | 403 / CSRF_INVALIDO |
| Origen no autorizado | 403 / ORIGEN_DENEGADO |
| Recurso privado de otra cuenta | 404 |
| Límite de solicitudes | 429 / LIMITE_SOLICITUDES |

También se aplican 413 por cuerpo demasiado grande, 415 por formato, 503 por bloqueo temporal de SQLite y 500 genérico. No mostrar ni registrar hashes, cookies o contraseñas.

## Transporte de la aplicación Tauri

El contrato es de sesión mediante cookie, no Bearer/JWT. Antigravity debe conservar Set-Cookie en un almacén de cookies y reenviarlo solo al backend autorizado; mantener CSRF en memoria y enviarlo en mutaciones autenticadas. Cookie HttpOnly, SameSite=Strict, Path=/api/v1; Secure cuando APP_ORIGIN usa HTTPS. TTL configurable, inicialmente 8 horas. No guardar credenciales en localStorage ni exponer el token de sesión al frontend.

La configuración actual permite APP_ORIGIN=http://127.0.0.1:3000. Si una solicitud incluye Origin, debe coincidir exactamente; Sec-Fetch-Site: cross-site se rechaza. No se ha añadido CORS. Por tanto, este contrato NO demuestra que fetch desde un WebView de otro origen funcione. Antigravity debe integrar y probar un transporte nativo con almacén de cookies privado y destino fijo, o coordinar explícitamente un diseño de origen compartido. No falsificar cabeceras del navegador ni desactivar CSRF/SameSite para integrar. Las solicitudes nativas sin Origin son admitidas por el contrato actual, pero las mutaciones autenticadas siguen requiriendo CSRF. El frontend Tauri y ese transporte no fueron modificados ni probados aquí.

## Arranque sobre la base existente

Desde la raíz del repositorio, con Node 24.19.0 y dependencias instaladas:

```powershell
npm start --prefix backend
```

Si faltan dependencias: npm ci --prefix backend. Conservar el .env existente. No ejecutar db:init sobre la base existente. Salud: GET http://127.0.0.1:3000/api/v1/health. Ctrl+C cierra HTTP y SQLite.

## Verificación

```powershell
node --test --test-concurrency=1 backend/test/database/*.test.js backend/test/security/*.test.js backend/test/resources/*.test.js backend/test/integration/*.test.js
```

Las pruebas usan SQLite en memoria o archivos temporales aislados. Cubren Argon2id real, registro/login, duplicados, credenciales incorrectas, escalamiento de rol, cookie, CSRF, permisos sobre recursos ajenos, revocación, /me y su alias, y persistencia tras reiniciar un proceso. No usan la base configurada de demostración. La compatibilidad del cliente Tauri requiere una prueba posterior con Antigravity.

Resultado de esta revisión: 25 pruebas aprobadas, cero fallos, Node 24.19.0 en Windows. Las pruebas HTTP se ejecutaron con permiso de conexión local. La base existente solo se comprobó mediante su configuración y existencia del archivo; no se abrió, reinicializó ni modificó para esta verificación.

Apoyo de IA: implementación y verificación asistidas por Codex; pendiente revisión humana del equipo.
