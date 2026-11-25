# Auditoría de seguridad y verificación de cuentas — 10 de noviembre de 2026

Rama: `codex/h2-seguridad-verificacion` (creada desde `e88547b`, punta de `codex/h2-motor-calidad`).
Punto de recuperación previo: rama local `codex/respaldo-pre-seguridad-20261110` (commit `0376c92`), que contiene HEAD más **todos** los cambios sin confirmar y archivos no versionados existentes antes de la auditoría.

Referencias: OWASP Top 10:2021 y OWASP ASVS 5.0, citados **por categoría o capítulo**. Este documento no afirma cumplimiento formal de un nivel ASVS ni sustituye una auditoría externa.

## 1. Alcance y método

- Revisión manual de backend (Express 5, better-sqlite3, Argon2id), esquema SQLite, puente Tauri en Rust (`desktop/src/bridge.rs`, `main.rs`, CSP y capacidades), frontend React (`src/`) y motor Python (solo superficie de configuración).
- `npm audit` en `backend/` y en la raíz; búsqueda de secretos por patrones en archivos versionados, no versionados e historial completo de Git.
- Pruebas automáticas existentes y nuevas (sección 5) y verificación manual en navegador de las páginas de cuenta.
- No se abrió ni modificó la base de demostración configurada en `.env`.

## 2. Estado inicial observado

El backend ya aplicaba controles sólidos: Argon2id (64 MiB, t=3, p=1), token de sesión aleatorio de 32 bytes guardado solo como SHA-256, cookie `HttpOnly`/`SameSite=Strict`/`Path=/api/v1`, CSRF HMAC ligado a la sesión con comparación en tiempo constante, validación de `Origin` y `Sec-Fetch-Site`, JSON obligatorio (415) con límite de 16 KB, consultas parametrizadas, aislamiento por propietario en todos los repositorios, roles con protección del último administrador, límites de intentos en memoria, errores 500 genéricos y escucha restringida a loopback. El puente Tauri valida el origen de la ventana, restringe el backend a loopback, rechaza campos desconocidos y borra secretos de memoria con `zeroize`.

Faltaban: correo y verificación de cuentas, recuperación de contraseña, registro de eventos de seguridad y algunas cabeceras; había dependencias con avisos publicados.

## 3. Vulnerabilidades y brechas detectadas

| # | Problema | Gravedad | Ubicación | Referencia | Estado |
|---|---|---|---|---|---|
| 1 | Registro sin verificación de identidad del correo y sin canal de recuperación de contraseña | Media | `backend/src/services/authService.js`, `db/schema.sql` | A07; ASVS V6 | **Corregido**: verificación obligatoria y recuperación por correo |
| 2 | `body-parser` 2.3.0: DoS con cuerpos comprimidos (GHSA-27r3-jxmh-p828). Exposición real baja: `inflate:false` y loopback | Alta (aviso) / Baja (exposición) | `backend/package-lock.json` | A06 | **Corregido**: 2.4.0 |
| 3 | `qs` 6.16.0: DoS en `stringify` con `arrayFormat: comma` (GHSA-6pq8-jhm2-2vcw). El servidor no usa esa función | Moderada (aviso) / Baja | `backend/package-lock.json` | A06 | **Corregido**: 6.17.1 |
| 4 | `vite` 8.3.1: varios avisos del servidor de desarrollo (GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22, GHSA-vfpm-58rq-9qcg y `launch-editor`) | Alta (solo desarrollo) | `package.json`, `package-lock.json` | A06 | **Corregido**: 8.3.5 (mínimo `^8.3.5`) |
| 5 | `zod` 4.6.5 (GHSA-mrhx-c7xc-m3w5) y `source-map-js` 1.2.1, transitivas de herramientas | Alta (solo desarrollo) | `package-lock.json` | A06 | **Corregido**: 4.6.7 y 1.2.2 |
| 6 | `eslint` 9 / `minimatch` / `@eslint/config-array`: el arreglo exige eslint 10 (cambio mayor) | Moderada (solo desarrollo) | raíz | A06 | **Pendiente**: no se incluye en el producto; evaluar migración a eslint 10 |
| 7 | Sin registro de eventos de seguridad (inicios de sesión, rechazos, cambios administrativos) | Media | backend | A09; ASVS V16 | **Corregido**: `security/audit-log.js`, lista blanca de campos |
| 8 | Cabeceras incompletas: faltaban `X-Frame-Options`, COOP, CORP, `Permissions-Policy` y HSTS en HTTPS | Baja | `backend/src/app.js` | A05; ASVS V3 | **Corregido** |
| 9 | El registro responde 409 ante un `nombre_usuario` existente (enumeración de nombres) | Baja | `authService.register` | A07 | **Documentado**: decisión de contrato previa. El correo **no** se puede enumerar |
| 10 | Sesiones sin expiración por inactividad en el servidor (TTL absoluto de 8 h; el puente aplica 30 min solo en el cliente) | Baja | `sesiones` | ASVS V7 | **Pendiente**: requiere columna `ultimo_uso` |
| 11 | Sin comprobación de contraseñas filtradas | Baja | `security/auth-validation.js` | ASVS V6 | **Parcial**: lista local de contraseñas comunes, secuencias y repeticiones; falta una lista completa de filtraciones |
| 11b | Mínimo de contraseña bajado de 15 a 8 caracteres por decisión de usabilidad (10-11-2026). Cumple el mínimo de ASVS, pero NIST SP 800-63B-4 exige 15 cuando no hay segundo factor | Media | `security/auth-validation.js` | ASVS V6; NIST 800-63B-4 | **Aceptado** y mitigado: bloqueo de contraseñas comunes o iguales al usuario/correo, límites de intentos y Argon2id. Recomendado: segundo factor |
| 12 | Límite de 2 operaciones Argon2 simultáneas y límites de intentos en memoria: un cliente local puede provocar 429 a otros; se reinician con el proceso | Baja | `security/passwords.js`, `rate-limit.js` | A04 | **Documentado** (diseño de proceso único y loopback) |
| 13 | HTTP sin TLS fuera de loopback; cookie `Secure` solo con origen HTTPS | Informativa | `config/env.js` | A02 | **Documentado**: `HOST` restringido a loopback; despliegue remoto no realizado |
| 14 | Contraseñas en el historial de Git | Informativa | historial | A07 | **Verificado**: solo frases ficticias de pruebas; no se encontraron secretos reales, claves ni tokens en el repositorio |

No se encontraron inyección SQL (todas las consultas usan parámetros; los identificadores dinámicos son constantes internas), XSS (React escapa; no hay `dangerouslySetInnerHTML`; CSP estricta en Tauri y en las páginas nuevas, que usan `textContent`), CSRF explotable ni credenciales incrustadas.

## 4. Correcciones e implementación

### 4.1 Verificación de cuentas por correo

1. **Registro** (`POST /api/v1/auth/registro`, ahora con `correo`): valida datos, aplica límites, guarda Argon2id, crea la cuenta **sin verificar**, genera un token aleatorio de 32 bytes (43 caracteres base64url) y guarda solo su SHA-256 en `tokens_cuenta` con vencimiento de 24 h. Responde **202** con un mensaje genérico y no inicia sesión.
2. **Enlace**: `APP_ORIGIN/cuenta/verificar#token=…`. El token va en el **fragmento**, que el navegador no envía al servidor, a proxies ni en `Referer`; la página lo borra de la barra y del historial y exige un clic, lo que evita que los analizadores de enlaces del correo lo consuman.
3. **Verificación** (`POST /auth/verificacion`): el backend busca el hash, comprueba vencimiento (`TOKEN_EXPIRADO`), que pertenezca a la cuenta y que el correo actual sea aquel al que se envió, marca `correo_verificado_en` y elimina todos los tokens de verificación de la cuenta. Reutilizarlo devuelve `TOKEN_INVALIDO`.
4. **Bloqueo en el backend**: el login de una cuenta no verificada falla (403 `CUENTA_NO_VERIFICADA`, solo si la contraseña es correcta), y el middleware rechaza cualquier sesión de una cuenta no verificada, incluidas sesiones anteriores a la migración. La administración también exige cuenta verificada.
5. **Reenvío** (`POST /auth/verificacion/reenviar`): respuesta 202 idéntica exista o no la cuenta; solo cuentas activas pendientes reciben un enlace nuevo, que invalida el anterior; espera de 60 s por cuenta, 5 solicitudes por correo cada 15 min (silencioso) y 10 por IP (429).
6. **Vincular correo** (`POST /auth/correo`, con usuario o correo y contraseña): para cuentas migradas de v1 sin correo o con un correo aún no confirmado. La interfaz lo usa al pulsar "Reenviar enlace" tras un intento de entrar con una cuenta sin confirmar, sin volver a pedir la contraseña. Si el correo es de otra cuenta, la respuesta es la misma y no se reasigna.
6b. **Entrar con correo o usuario**: `nombre_usuario` del login acepta cualquiera de los dos; los límites de intentos se aplican al identificador normalizado.
7. **Recuperación** (`POST /auth/contrasena/olvido` y `/auth/contrasena/restablecer`): enlace de un solo uso de 30 min; al restablecer cambia el hash, invalida los tokens de la cuenta, **revoca todas sus sesiones**, marca el correo como verificado (el enlace llegó a esa dirección) y envía un aviso al titular.

### 4.2 Protección contra enumeración

Registro, reenvío y recuperación responden igual exista o no el correo, y el envío de correo ocurre después de responder, de modo que el tiempo tampoco lo revela. Si alguien se registra con un correo ajeno, la cuenta nueva se crea **sin correo** (no puede entrar) y el dueño recibe un aviso. El login informa "Confirma tu correo" (403) solo después de una contraseña correcta, y con la misma respuesta para una cuenta sin correo que para una con el correo pendiente: así, quien registró una cuenta con un correo ajeno no puede deducir si ese correo ya existía. Usuario, correo o contraseña incorrectos reciben el mismo 401. Esto es relevante porque ZeroTouch es una herramienta de accesibilidad y la pertenencia de un correo puede revelar información sensible.

### 4.3 Registro de eventos

Una línea JSON por evento en `stderr` (`tipo: "seguridad"`): registro, verificación, inicios y rechazos de sesión, recuperación, cambios administrativos, fallos de entrega de correo y rechazos 401/403/429. Lista blanca de campos: UUID internos, códigos y rutas. Nunca contraseñas, tokens, cookies, hashes, correos, nombres de usuario ni direcciones IP. Una prueba lo comprueba.

### 4.4 Base de datos

Esquema v2 (`PRAGMA user_version = 2`): columnas `correo` (único, minúsculas, CHECK binario) y `correo_verificado_en` en `usuarios`, y tabla `tokens_cuenta` con borrado en cascada. Las bases v1 no se migran solas: `npm run db:migrate --prefix backend` comprueba la base, crea un respaldo `*.v1-<fecha>.ztbackup` con la API de copia de SQLite y aplica una migración **solo aditiva** en una transacción. No se borran filas.

## 5. Pruebas (resultados reales de esta sesión, Windows, Node 24.19.0)

| Suite | Antes | Después |
|---|---|---|
| Backend (`node --test`, datos + seguridad + recursos + integración) | 25/25 | **41/41** (25 adaptadas + 16 nuevas) |
| Puente Tauri (`cargo test`, incluye backend real) | 5/5 | **5/5** (prueba de integración ampliada) |
| Motor Python (`pytest`, sin hardware) | 97/97 | no modificado |
| ESLint (`src`, `backend`) | sin errores | sin errores |
| Build de escritorio (`vite build --mode desktop`) | correcto | correcto |

Casos nuevos automatizados: token con hash y sin texto original en la base; 24 h y 30 min; un solo uso; vencido; formato inválido; ligado al correo; reenvío con respuesta idéntica, enfriamiento y 429 por IP; correo duplicado sin reasignación y con aviso; vinculación de cuentas heredadas; recuperación con revocación de sesiones y aviso; cuenta suspendida sin enlace; sesión de cuenta no verificada rechazada; registro de eventos sin datos sensibles; fallo de SMTP sin romper el registro; CSP de las páginas; configuración de correo segura en producción; transporte `archivo`; migración v1→v2 con respaldo, idempotencia y equivalencia estructural. Una prueba de mutación (quitar el bloqueo del middleware) hizo fallar la suite, como se esperaba.

Verificación manual en navegador (servidor y base temporales): confirmación de correo, reutilización del enlace rechazada, recuperación solicitada desde la página, contraseñas distintas rechazadas, restablecimiento correcto, login con la nueva contraseña (200) y con la anterior (401), sin errores de CSP. El diálogo de React se probó en el navegador con el IPC de Tauri simulado (Entrar con correo o usuario, Crear cuenta, Confirma tu correo con reenvío sin volver a pedir la contraseña, y Recuperar). **No se probó** el envío por SMTP real ni la ventana nativa de Tauri con un usuario.

## 6. Configuración pendiente

- Proveedor SMTP real para producción: `MAIL_TRANSPORT=smtp`, `MAIL_FROM`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_SMTP_SECURE`, `MAIL_SMTP_USER`, `MAIL_SMTP_PASSWORD` (solo en `.env`). Configurar SPF, DKIM y DMARC del dominio remitente.
- Base existente v1: migrada el 10 de noviembre con `npm run db:migrate --prefix backend` (respaldo previo verificado; datos y hashes intactos). Otras copias v1 del equipo necesitan el mismo comando. Las cuentas existentes deben vincular y confirmar un correo desde "Confirma tu correo" al intentar entrar.
- Despliegue fuera de loopback: HTTPS, `APP_ORIGIN` público y revisión de proxy (no implementado).
