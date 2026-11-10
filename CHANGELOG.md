# Registro de cambios — ZeroTouch

Registro único y consolidado del proyecto. Se reconstruyó el 10 de noviembre de 2026 a partir del historial de Git de **todas** las ramas locales y remotas, de los documentos `docs/hito2/*` y del estado del árbol de trabajo. No existía un CHANGELOG previo.

Convenciones:

- Las fechas son las fechas de autor de los commits. No hay etiquetas de versión en el repositorio: las secciones se ordenan por fecha y se indica la versión solo cuando un archivo la declara (API `backend/package.json` 0.1.0; contrato OpenAPI 1.0.0 → 1.1.0; esquema SQLite `user_version` 1 → 2).
- Cada entrada cita su commit. Cuando un dato no se pudo verificar se indica expresamente.
- Categorías: Agregado, Modificado, Corregido, Seguridad, Autenticación, Base de datos, Dependencias, Eliminado.

---

## [Sin publicar] — 2026-11-10 — Auditoría de seguridad y verificación de cuentas

Rama `codex/h2-seguridad-verificacion`, creada desde `e88547b`. Commits locales, sin publicar: `f53e5a4` (dependencias del frontend), `537c215` (backend y base de datos), `ffa1461` (puente Tauri) y el commit de documentación que incorpora este archivo. Detalle técnico y tabla de vulnerabilidades: [`docs/hito2/auditoria-seguridad.md`](docs/hito2/auditoria-seguridad.md).

### Seguridad
- Verificación de correo obligatoria: el login, el middleware de sesión y la administración rechazan cuentas sin correo confirmado (comprobado en el backend, no solo en la interfaz).
- Tokens de verificación y recuperación aleatorios (32 bytes), guardados solo como SHA-256, de un solo uso, ligados al correo al que se enviaron, con vencimiento de 24 h y 30 min.
- Sin enumeración de cuentas por correo: registro, reenvío y recuperación responden igual exista o no la dirección; el correo se envía después de responder; "Confirma tu correo" (403 `CUENTA_NO_VERIFICADA`) solo se informa tras una contraseña correcta y es igual para cuentas sin correo y con correo pendiente.
- Límites por IP (429), por correo (silenciosos) y espera de 60 s entre envíos por cuenta.
- Restablecer la contraseña revoca todas las sesiones de la cuenta y envía un aviso al titular.
- Registro de eventos de seguridad en `stderr` (JSON por línea) con lista blanca de campos: sin contraseñas, tokens, cookies, hashes, correos, nombres de usuario ni IP.
- Cabeceras nuevas: `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`; `Strict-Transport-Security` cuando el origen es HTTPS.
- Páginas de cuenta con CSP estricta (`script-src 'self'`, sin `unsafe-inline`); el token viaja en el fragmento de la URL y se borra del historial.
- Transporte de correo `smtp` obligatorio en producción, con TLS 1.2+ y certificados validados; el transporte `archivo` se rechaza en producción y su carpeta debe estar fuera del repositorio y de OneDrive.

### Autenticación
- `POST /api/v1/auth/registro` exige `correo` y responde **202** con un mensaje genérico (antes 201 con el usuario). **Cambio de contrato.**
- Nuevos endpoints públicos: `POST /auth/verificacion`, `/auth/verificacion/reenviar`, `/auth/correo` (vincular o corregir correo con usuario y contraseña), `/auth/contrasena/olvido`, `/auth/contrasena/restablecer`.
- El usuario público incluye `correo_verificado` (la dirección no se expone).
- `POST /auth/login` (y `/auth/correo`) aceptan en `nombre_usuario` el nombre de usuario **o el correo** de la cuenta. Errores: 401 `CREDENCIALES_INVALIDAS` genérico; 403 `CUENTA_NO_VERIFICADA` con contraseña correcta.
- `bootstrapAdmin` y `npm run admin:bootstrap` piden correo y envían la verificación; el administrador también debe confirmarlo.

### Base de datos
- Esquema v2 (`db/schema.sql`, `user_version = 2`, ocho tablas): `usuarios.correo` (único, minúsculas), `usuarios.correo_verificado_en` y tabla `tokens_cuenta`.
- Migración aditiva `db/migraciones/001_v1_a_v2.sql` y comando `npm run db:migrate --prefix backend`, que crea antes un respaldo `*.v1-<fecha>.ztbackup`. El arranque no migra solo y rechaza bases v1 con un mensaje que indica el comando.

### Agregado
- Módulos `backend/src/security/{mailer,mail-templates,account-tokens,audit-log}.js`, `repositories/tokensCuentaRepository.js`, `routes/cuentaRoutes.js` y páginas `backend/public/cuenta/*`.
- Puente Tauri: comandos `resend_verification`, `forgot_password`, `link_email` y estructura `Registration` (con `deny_unknown_fields`).
- 14 pruebas nuevas del backend (`test/security/verificacion.test.js`, `test/database/migracion.test.js`) y ayudante `test/helpers/correo.js`.
- Paso "02b Verificar correo" en la colección Postman.

### Modificado
- Pruebas existentes adaptadas al flujo con verificación (sin relajar ninguna aserción de seguridad).
- OpenAPI 1.1.0 con los endpoints y esquemas nuevos.
- `.env.example`: variables `MAIL_*` comentadas y sin secretos.

### Corregido
- La restricción `CHECK` del correo comparaba sin distinguir mayúsculas por heredar `COLLATE NOCASE`; se fuerza comparación binaria (detectado por una prueba durante esta sesión).

### Dependencias
- Backend: `body-parser` 2.3.0 → 2.4.0 y `qs` 6.16.0 → 6.17.1 (avisos GHSA-27r3-jxmh-p828 y GHSA-6pq8-jhm2-2vcw); nueva `nodemailer` 10.2.1 fijada.
- Frontend (desarrollo): `vite` 8.3.1 → 8.3.5 (mínimo `^8.3.5`), `zod` 4.6.5 → 4.6.7, `source-map-js` 1.2.1 → 1.2.2. Se eligieron versiones con al menos dos semanas de publicación.
- Pendiente: 4 avisos moderados de `eslint 9`/`minimatch` que exigen eslint 10 (cambio mayor; solo herramienta de desarrollo).

### Interfaz (pendiente de confirmar)
- Diálogo de cuenta de React con el flujo habitual: Entrar ("Correo o usuario" y contraseña, sin textos de ayuda), "¿Olvidaste tu contraseña?", "¿No tienes cuenta? Crear cuenta". Si la cuenta no está confirmada, el propio diálogo muestra "Confirma tu correo" y reenvía el enlace con las credenciales recién escritas (cubre también cuentas antiguas sin correo); se eliminó el enlace "Mi cuenta no tiene correo confirmado" (`src/components/Dialogs.jsx`, `src/App.jsx`, `src/api/client.js`). **No se confirmó en Git** porque esos archivos contienen además cambios preexistentes sin confirmar de otra persona; el cambio propio está aislado en el parche local `.worktrees/seguridad-verificacion-ui.patch` (ver "Pendiente de integración").

### Pruebas de esta entrega
Backend 40/40; puente Tauri 5/5 (con backend real, incluye entrar con correo); ESLint y build de escritorio correctos; verificación manual en navegador de confirmación, reutilización, recuperación y restablecimiento. No probado: SMTP real y ventana nativa de Tauri con una persona usuaria.

---

## Cambios preexistentes sin confirmar (detectados el 2026-11-10)

No son parte de esta entrega ni se incluyeron en sus commits. Se conservan intactos en el árbol de trabajo y respaldados en la rama local `codex/respaldo-pre-seguridad-20261110` (commit `0376c92`). Autoría y fecha exactas: **no verificables** desde Git.

- Motor local: `motor-local/motor_local/{capture,config,detector,interpreter,main,os_adapter}.py`, `motor-local/tests/test_regresiones_motor.py`, nuevo `motor-local/tests/test_escritorio_virtual.py`, `docs/hito2/motor-local.md`, `desktop/src/engine.rs`.
- Interfaz React (refresco visual y conexión con el puente): `src/App.jsx`, `src/App.css`, `src/index.css`, `src/main.jsx`, `src/components/*`, `src/data/*`, `src/pages/*`, nuevos `src/api/client.js`, `src/data/engineStatus.js`, `src/ui-refresh.css`, `src/assets/Outfit.ttf` y su licencia. Relación probable con `.worktrees/ux-accesibilidad-cambios.patch` (la base del parche no coincide exactamente con HEAD).
- Configuración: `.gitignore` (exclusiones de `.worktrees`, `tmp`, `output`, Python), `.env.example` (ruta de ejemplo `DATABASE_PATH`), `backend/.env.example`, `eslint.config.js`, `package.json` (scripts de escritorio), `vite.config.js` (raíz `prototype/` para la web pública).
- No versionados: `AGENTS.md`, `docs/plan-semana/`, `prototype/`, `scripts/`, `Claude outputs/`.

---

## 2026-11-05

### Motor local — rama `codex/h2-motor-calidad`
- `bec327f` feat(motor): cierre cooperativo, ACK por comando e importación de la API. CONTROL solo con cámara abierta y atajo activo; liberación del botón ante pausa, puño o pérdida de mano.
- `0212419` feat(motor): gestos de ventana (tres dedos, opcional), barrido horizontal (Alt+Izquierda/Derecha) y carga de la exportación desde Tauri.
- `e88547b` fix(motor): confirmar el puño antes de pausar y no liberar el arrastre por un fotograma.

### `main` remoto
- `f9e222b` chore: eliminar el backend antiguo de `main` (fusionado en PR #3, `febbea6`). **Eliminado**: esqueleto `backend/` de `df71625`.

## 2026-11-02
- `ab6e3c4` feat(db): publicar el esquema SQLite del Hito 2 sin datos privados (fusionado en `main` por PR #2, `311f0a2`).
- `97ca101` test(api): verificar colección, aislamiento y reinicio real.
- `d369c74` docs(hito2): consolidar entrega y demostración del backend.
- `bfd9dc2` feat(auth): exponer `GET /auth/me` y el contrato de integración para Tauri.

## 2026-11-01
- `71f4c0d` feat(db): esquema SQLite nuevo de siete tablas y conexión validada (FK por conexión, STRICT, ubicación fuera del repositorio).
- `19f53d2` feat(auth): sesiones opacas, roles, CSRF, Argon2id, límites de intentos y pruebas de seguridad.
- `93990ff` feat(api): CRUD protegidos de perfiles y modos con control de versión optimista.
- `76a05c8` docs(api): contrato OpenAPI y automatización de pruebas del backend.

## 2026-10-27
- `0cee784`, `88420dd`, `832c3be`, `165ddb6`: actualización del informe del Hito 1, declaración de uso de IA y README.

## 2026-10-26
- `239dd13` Actualizar diseño visual del prototipo.
- `a64295a` Mejoras visuales y responsive (ramas `feature/tauri-interaccion-local` y `codex/tauri-desktop-v2`; **no integrada** en la línea actual).

## 2026-10-22
- `dabecb5` feat: backend seguro v2 con `/api/v2` (rama `codex/backend-seguro-v2`; **no integrada**; `AGENTS.md` indica no copiarla).

## 2026-10-19
- `c408c3b` feat(backend): CRUD REST, persistencia SQLite y pruebas (ramas `feature/hito2-backend`, `revision-backend` y respaldos de auditoría; **sustituida** por la línea del 1 de noviembre).
- `1e809da` Actualiza frontend e informe Hito 1.

## 2026-10-01
- `df71625` Estructura inicial del backend (eliminada después en `main` por `f9e222b`).

## 2026-09-26 y 2026-09-27
- `ea4d1e0`, `2ad6245`: prototipo funcional. `2d89e99`, `6e4fc61`, `1217217`, `877043c`, `bc64d5f`, `f70feac`: despliegue en GitHub Pages y corrección de rutas y Air-Swipe. `de3183b`: interfaz móvil. `e77c0f9`, `cafab72`: documentación del Hito 1.

## 2026-09-20
- `6246a65` Commit inicial; README y carga del informe del Hito 1.

---

## Estado de ramas y pendientes de integración (2026-11-10)

| Rama | Punta | Relación con la línea actual | Estado |
|---|---|---|---|
| `codex/h2-seguridad-verificacion` | esta entrega | parte de `e88547b` | Commits locales sin publicar |
| `codex/h2-motor-calidad` | `e88547b` | base de esta entrega | Sin cambios |
| `codex/h2-datos-seguridad`, `codex/h2-api-recursos`, `codex/ux-accesibilidad` | `19f53d2`, `76a05c8`, `bfd9dc2` | ancestros | Integradas |
| `origin/main` | `febbea6` | **diverge** (PR #2 y #3 no están en la línea actual) | Pendiente; ver conflictos |
| `main` local | `0cee784` | ancestro; 4 commits detrás de `origin/main` | Desactualizada |
| `codex/h2-esquema-sqlite`, `codex/eliminar-backend-antiguo` | `ab6e3c4`, `f9e222b` | fusionadas en `origin/main` | — |
| `feature/hito2-backend`, `revision-backend`, `codex/respaldo-auditoria-20261021`, `codex/auditoria-separacion-20261021` | `c408c3b` | línea antigua | No integrar |
| `codex/backend-seguro-v2` | `dabecb5` | línea antigua `/api/v2` | No integrar |
| `codex/tauri-desktop-v2`, `feature/tauri-interaccion-local` | `a64295a` | línea antigua | Revisar antes de descartar |
| `codex/respaldo-pre-seguridad-20261110` | `0376c92` | respaldo de esta sesión | Conservar |

Conflictos previstos al fusionar la línea actual con `origin/main` (comprobados con `git merge-tree`, sin modificar ramas; **ya existían antes de esta entrega**):

- *modify/delete* en `backend/package.json`, `backend/package-lock.json`, `backend/src/app.js`, `backend/src/config/env.js`, `backend/src/server.js`, `backend/src/controllers/healthController.js`: `main` borró el esqueleto antiguo y esta línea los reescribió para el Hito 2. Resolución recomendada: conservar la versión del Hito 2.
- *add/add* en `db/README.md` y, tras esta entrega, en `db/schema.sql` (v1 en `main`, v2 aquí). Resolución recomendada: conservar la versión v2 y revisar a mano el README.

Otros pendientes:

1. Confirmar la interfaz React preexistente y, con ella, aplicar o conservar el parche `.worktrees/seguridad-verificacion-ui.patch`.
2. Migrar la base de demostración v1 con `npm run db:migrate --prefix backend` (no se ejecutó sobre la base real).
3. Configurar un proveedor SMTP real para cualquier uso fuera de desarrollo.
4. Actualizar eslint a la versión 10 cuando el equipo lo apruebe.
5. Expiración de sesión por inactividad en el servidor y comprobación de contraseñas filtradas.
6. Acordar con el equipo los cambios de contrato (registro 202 con correo, ocho tablas) que afectan a `AGENTS.md` y al informe.
