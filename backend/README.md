# Backend ZEROTOUCH: mantenimiento

Esta guía contiene la instalación, configuración y verificación del backend local.
Contrato versionado y colección usada por las pruebas: [api/README.md](api/README.md).
Esquema ejecutable y relaciones: [db/README.md](../db/README.md).

Node 24 ejecuta JavaScript ESM directamente. Express compone HTTP; servicios
validan reglas; repositorios contienen SQL parametrizado. SQLite se conserva
fuera de OneDrive/red. No modificar el prototipo para integrar esta API.

## Requisitos e instalación

Se requiere Node.js **24.x**, npm y acceso al registro npm para instalar las
dependencias. SQLite está incluido en el driver; no necesita un servidor aparte.
Las claves y la base deben quedar en almacenamiento local fuera del repositorio
y de carpetas sincronizadas. Los módulos nativos deben instalarse en el equipo
destino; no copiar node_modules entre sistemas o arquitecturas.

Todos los comandos siguientes se ejecutan desde la **raíz de ZEROTOUCH**, donde
están las carpetas backend/, frontend/ y db/, no desde backend/.

```powershell
node --version
npm --version
npm --prefix backend ci
```

Verificar que Node informa v24.x y detenerse si la instalación falla. `npm ci`
usa el lockfile existente; no actualiza las versiones. Si falta un binario nativo,
revisar el error y los requisitos de su plataforma antes de habilitar scripts o
instalar herramientas de compilación.

## Configuración del entorno

El backend carga el archivo **.env de la raíz**, no backend/.env. Es opcional si
se aceptan los valores predeterminados. Para crear una copia del ejemplo sin
sobrescribir una configuración existente, en PowerShell:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
```

En macOS/Linux puede usarse `cp -n .env.example .env`. Revisar el archivo antes
de inicializar datos; las variables del proceso tienen prioridad sobre .env.
No versionar .env ni poner en él el contenido de la clave: solo su ruta.

|Variable|Valor predeterminado|Regla|
|---|---|---|
|NODE_ENV|development|development, test o production|
|HOST|127.0.0.1|Solo loopback; también localhost o ::1|
|PORT|3000|Entero 0–65535; 0 asigna un puerto temporal y se imprime al arrancar|
|DATABASE_PATH|Datos locales del SO/ZeroTouch/development-v2.sqlite|Vacío usa el predeterminado; ruta absoluta local fuera de OneDrive/red|
|ENCRYPTION_KEY_FILE|Datos locales del SO/ZeroTouch/keys/v2.key|Vacío usa el predeterminado; archivo de 32 bytes fuera del repositorio/OneDrive/red|
|APP_ORIGIN|http://127.0.0.1:3000 para el puerto predeterminado|Origen exacto sin ruta ni barra final; producción exige HTTPS|

La base predeterminada usa el nombre `${NODE_ENV}-v2.sqlite`. En Windows, datos
locales corresponde a LOCALAPPDATA (normalmente AppData/Local); en otros sistemas,
a XDG_DATA_HOME o ~/.local/share. No se expanden expresiones como %LOCALAPPDATA%
dentro de las rutas de .env: usar una ruta absoluta o dejar el valor vacío.
Si se cambia PORT, revisar también APP_ORIGIN del ejemplo. Mantener PORT=3000
para el recorrido local habitual. Cambiar NODE_ENV no configura TLS ni autoriza
exponer la API en Internet.

## Inicialización segura

Para una instalación nueva, con la configuración anterior revisada, ejecutar
cada paso y comprobar que terminó correctamente antes de continuar:

```powershell
npm --prefix backend run security:init
npm --prefix backend run db:init
```

`security:init` crea una clave aleatoria una sola vez, sin mostrarla. Si la clave
ya existe, falla deliberadamente: conservarla y omitir ese paso en posteriores
arranques. No borrarla ni reemplazarla para resolver un error; si se perdió una
clave asociada a datos, recuperarla desde su copia segura antes de continuar.

`db:init` crea el esquema v2 en una base nueva, o valida una v2 existente sin
borrar registros. No ejecutar si la configuración señala una base antigua que
se pretendía conservar para v1: esa versión se rechaza y no se migra. No hay
cuentas ni contraseñas predeterminadas. Restringir el acceso a la carpeta de
datos y claves, y conservar la clave separada de los respaldos cifrados.

## Inicio y comprobación del servidor

En cada arranque posterior basta con la clave y base ya inicializadas:

```powershell
npm --prefix backend start
```

El proceso imprime su dirección local. Con la configuración predeterminada,
abrir otra terminal PowerShell y comprobar:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/health
```

Debe responder status=ok y service=ZeroTouch API. Ctrl+C cierra el servidor y
la conexión SQLite. Para desarrollo con reinicio al editar código puede usarse
`npm --prefix backend run dev`. No ejecutar ambos sobre el mismo puerto.

La comprobación de salud no autentica una cuenta. El [contrato API](api/README.md)
describe registro, login, cookie y CSRF para operar sobre recursos propios.
La interfaz real todavía no está integrada y no debe conectarse el prototipo.

## Ejecución de pruebas

```powershell
npm --prefix backend test
npm --prefix backend run test:collection
```

El primer comando ejecuta la suite completa, que incluye la colección; el segundo
permite repetir solo esa parte cuando sea necesario. La suite actual contiene
42 pruebas contando subpruebas. Crea bases y claves temporales aisladas y levanta
servidores de loopback; no requiere inicializar la base personal ni registrar
cuentas reales. Necesita permisos para esos servidores y enlaces temporales.

Para comprobar una instalación limpia desde el lockfile en una carpeta temporal:

```powershell
npm --prefix backend run verify:install
```

Ese comando requiere red, instala dependencias en su copia temporal y ejecuta
las pruebas. No equivale a comprobar otro sistema operativo. El backend no tiene
paso de compilación: Node ejecuta directamente sus módulos JavaScript ESM.

Para comprobar también la preservación y compilación del prototipo, instalar
primero las dependencias de la raíz si faltan, sin cambiar el lockfile:

```powershell
npm ci
npm run verify:separation
npm run build
```

Estos comandos no hacen push ni despliegan GitHub Pages.

## Sesiones y límites

Registro siempre crea user; roles user/admin. Cada perfil pertenece a una cuenta
y cada contexto a un perfil. Administrador no puede leer preferencias ajenas;
solo gestiona metadatos, roles/estados de otras cuentas y eventos mínimos.

Sesión en cookie HttpOnly/SameSite Strict, Secure en producción; token aleatorio
y solo su hash en SQLite. Expira a las 8 h o tras 30 min inactiva; máximo cinco
sesiones. Login o GET auth/session entrega CSRF; mutaciones autenticadas exigen
X-CSRF-Token. Cambios de contraseña/identificador/rol/estado revocan sesiones.
No guardar tokens en localStorage. Origin debe coincidir con APP_ORIGIN; no hay
CORS habilitado. El despliegue remoto/TLS no está implementado.

JSON máximo 16 KiB; 120 peticiones/minuto/IP; registro 10/15 min por IP e
identificador; login 30/15 min/IP y 10/15 min/identificador; reautenticación
10/15 min/cuenta. Máximo dos hashes Argon2 simultáneos, 20 perfiles y 200 contextos
por cuenta. El contrato documenta 401/403/409/429 y demás errores.

## Claves y respaldos

Crear clave una vez con `npm --prefix backend run security:init`. No reemplazarla
para intentar abrir datos anteriores. ENCRYPTION_KEY_FILE queda fuera del
repositorio; conservar copia separada y acceso restringido. En Windows verificar
ACL de la carpeta: el modo POSIX no garantiza esos permisos.

Contraseñas: Argon2id, 64 MiB, tres iteraciones, paralelismo uno. Descripción de
perfil y respaldo: AES-256-GCM. La base completa y nombres/parámetros no están
cifrados. Proteger carpeta y disco, incluidos WAL/SHM.

Desde la raíz:

```text
npm --prefix backend run backup -- create RUTA_ABSOLUTA_NUEVA.ztbackup
npm --prefix backend run backup -- restore RESPALDO BASE_NUEVA.sqlite
```

Usar rutas locales existentes fuera de sincronización y una clave válida. No
sobrescribe destinos; comprueba integridad, FK y versión. Restauración elimina
sesiones/contadores de la copia. Límite 64 MiB. No hay agenda automática de copias
ni rotación automática de claves. No borrar WAL manualmente. Un corte abrupto
puede dejar una copia temporal en claro en la carpeta local del respaldo.

## Versiones de la base

`db:init` inicializa exclusivamente una base vacía o abre esquema v2 ya existente.
V1 se rechaza sin asignar propietarios ni migrar datos. Nombre predeterminado:
development-v2.sqlite. Conservar v1 separada; cualquier importación requiere
respaldo, asignación explícita de titularidad y validación en copia. No ejecutar
SQL de inicialización sobre una base activa ni restaurar encima de ella.

Eliminar perfil con contextos devuelve 409. Eliminar cuenta exige contraseña
actual, elimina configuraciones y sesiones y desasocia eventos; protege al último
administrador activo. Esto no garantiza borrado forense de páginas/copias.
Retención técnica: eventos 30 días; sesiones 8 h/30 min; límites 15 min. Limpieza
al inicio y cada hora. Revisar copias antes de restaurar datos previamente borrados.

## Verificación y límites operativos

`npm --prefix backend test` usa bases y claves temporales. `npm --prefix backend
run verify:install` instala en carpeta temporal y ejecuta pruebas sin depender de
documentación interna. La colección vigente en api/ debe permanecer versionada.

No se capturan ni reciben imágenes, landmarks o acciones del SO. El motor local
y la UI integrada siguen pendientes. Antes de usuarios reales/servicio central,
resolver recuperación verificada, MFA administrativo, TLS, responsable y avisos
de tratamiento, ACL, copias y respuesta a incidentes. No se declara cumplimiento
jurídico certificado ni se publicará el servicio como parte de una reorganización.
