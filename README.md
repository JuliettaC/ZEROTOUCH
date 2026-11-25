# <img width="35" height="35" alt="ICON NEGRO" style="vertical-align: -6px;" src="https://github.com/user-attachments/assets/d52f48df-cfcb-40aa-8178-1989bbdff02e" /> ZEROTOUCH

ZeroTouch es para personas que hacen tareas manuales (cocina, taller) mientras consultan información en el computador. Permite controlar Windows con gestos de la mano frente a una cámara web común, sin sensores especiales: mover el cursor, hacer clic, arrastrar, desplazar, pausar, cambiar de ventana, abrir una pestaña nueva, manejar temporizadores y multimedia, y escribir con trazos en el aire.

> **Estado (24-11-2026):** el software está implementado de punta a punta y cubierto por pruebas automáticas. El recorrido interfaz, API y SQLite se comprueba con la aplicación real (`npm run verify:hito3`). Los gestos **todavía no se han medido con cámara y manos de otras personas**: los umbrales son hipótesis ajustadas con grabaciones del equipo. No hay instalador: se ejecuta desde el código fuente.

## Manual de instalación y uso

Guía completa en 20 apartados: resumen, arquitectura, levantar el servicio desde cero, recuperación ante caída, respaldos y restauración, seguridad, comandos rápidos, el recorrido de comprobación, la demostración con cámara y los problemas conocidos. Los apartados que solo tendrían sentido en un servidor remoto (SSH, dominio, correo corporativo) dicen expresamente que no aplican en esta entrega: **[docs/manual-instalacion-y-uso.md](docs/manual-instalacion-y-uso.md)**.

## Inicio rápido (Windows)

Requisitos: Git, Node **24.x** (probado con 24.19.0), Python **3.11**, Rust con el toolchain MSVC y los Build Tools de Visual Studio con C++, y WebView2. Todos los comandos se ejecutan en PowerShell, desde la carpeta raíz del repositorio (la que contiene `package.json`).

```powershell
# 1. Dependencias (unos 4 minutos)
npm ci
npm ci --prefix backend
python -m venv motor-local\.venv
motor-local\.venv\Scripts\python.exe -m pip install -r motor-local\requirements-dev.txt

# 2. Servidor y base de datos
Copy-Item .env.example .env
#    Edita DATABASE_PATH en .env: ruta absoluta con "/", FUERA del repositorio y de OneDrive,
#    por ejemplo C:/Users/TU_USUARIO/AppData/Local/ZeroTouch/zerotouch.sqlite
npm run db:clave --prefix backend    # imprime DATABASE_KEY=...: pega esa línea en .env (la base va cifrada)
npm run db:init --prefix backend     # crea una base nueva y cifrada; si ya existe, no la toca

# 3. Compilar la aplicación (la primera vez tarda unos 5 minutos)
npm run desktop:build

# 4. Usar: servidor en una ventana de PowerShell...
npm start --prefix backend           # debe decir: ZeroTouch API lista en puerto 3000
# ...y la aplicación en otra
.\desktop\target\debug\zerotouch-desktop.exe
```

En la aplicación: **Ajustes**, icono de cuenta, **Crear cuenta**; después `npm run correo:enlace --prefix backend -- tu_correo@ejemplo.test` imprime el enlace de confirmación (el correo se guarda como archivo, no se envía), se abre en el navegador y se pulsa **Confirmar mi correo**. Con la cuenta verificada, **Sincronizar** sube el perfil y los modos al servidor, y `npm run db:modos --prefix backend -- tu_usuario` muestra lo guardado en SQLite. Con cámara: **Inicio**, **Iniciar cámara**, **Activar control**; `Ctrl+Alt+Z` detiene todo al instante.

Una base creada con una versión anterior se actualiza **a mano** y con respaldo automático: `npm run db:migrate --prefix backend`. Nunca se migra al arrancar.

La base SQLite está **cifrada en reposo** (SQLite3 Multiple Ciphers, ChaCha20-Poly1305, clave de 256 bits en `DATABASE_KEY`): el archivo, su WAL y los respaldos de migración no se pueden leer sin la clave. Una base creada antes del cifrado se convierte con `npm run db:cifrar --prefix backend` (con el servidor detenido). El original sin cifrar queda como `<base>.sin-cifrar-<fecha>.ztbackup` para que lo borres cuando compruebes que la aplicación funciona.

## Integrantes

* Julietta Céspedes (@JuliettaC)
* Adan Mendoza (@Adammm14)
* Anais Perez (@Youpuipui)

## Enlaces

- [Prototipo del Hito 1](https://juliettac.github.io/ZEROTOUCH/) (versión web histórica, se conserva sin cambios)
- [Informe del Hito 1](docs/Informe%20Hito%201.pdf) · [Matriz de cumplimiento](docs/matriz-hito1.md)
- [Manual de instalación y uso](docs/manual-instalacion-y-uso.md) · [Contrato de la API (OpenAPI)](docs/api/openapi.yaml)
- [Registro de cambios](CHANGELOG.md) · [Progreso técnico](PROGRESO.md)

## Cómo está hecho

```
Cámara ─► motor-local (Python) ─► Windows (ratón, teclas)
               ▲   │ JSON-lines (comandos con ACK, telemetría, eventos)
               │   ▼
           desktop (Tauri 2, Rust) ◄─► src (React 19): Inicio · Gestos · Ajustes · Teclado
               │ HTTP con cookie y CSRF (solo cuentas y sincronización)
               ▼
           backend (Node 24, Express 5, SQLite) — /api/v1
```

| Carpeta | Qué contiene |
|---|---|
| `motor-local/motor_local/` | Motor gestual: captura, detección (MediaPipe, 21 puntos), interpretación (filtro One-Euro, confirmación por tiempo), acciones (lista blanca) y adaptador del sistema operativo (pynput) |
| `desktop/` | Aplicación Tauri: lanza el motor, cliente HTTP nativo, ventana del teclado Air-Swipe e indicador flotante (HUD) |
| `src/` | Interfaz React (escritorio). Preferencias por cuenta, sincronización, temporizadores y teclado Air-Swipe |
| `backend/`, `db/` | API de cuentas, perfiles, modos y asignaciones de gestos. SQLite v4 (nueve tablas) con migraciones explícitas |
| `contracts/capacidades.json` | Contrato único: qué acciones admite cada gesto y qué teclas puede emitir el motor |
| `prototype/` | Prototipo del Hito 1 (no se modifica) |
| `docs/` | Informes, API, manual y matriz de cumplimiento |

El motor nunca depende del servidor: los gestos funcionan sin conexión, y la cuenta solo sirve para sincronizar perfiles y modos entre equipos.

## Gestos

| Gesto | Qué hace |
|---|---|
| Mano abierta un instante y luego moverla | Activa el puntero y mueve el cursor |
| Pinza (índice y pulgar) | Clic |
| Pinza sostenida cerca de un segundo | Arrastrar (abrir los dedos suelta) |
| Dos dedos juntos apuntando hacia arriba o hacia abajo, sostenidos | Desplazar: sube o baja la página |
| Puño quieto cerca de medio segundo | Pausar o reanudar |
| Pinza de pulgar y dedo medio | Clic derecho |
| Tres dedos que bajan rápido, con el meñique arriba | Alt+Tab; si se mantienen abajo, selector de ventanas |
| V con los dedos separados, quieta | Pestaña nueva (Ctrl+T) |
| Palma quieta cerca de un segundo | Volver a navegación (reasignable: multimedia, temporizador, precisión) |
| Apuntar con el índice sobre el teclado en pantalla | Escribir con trazos (Air-Swipe); el teclado se abre solo al hacer clic en un campo de texto |

**Seguridad:** el motor arranca en *Observar* y no mueve nada. *Controlar* exige que la cámara esté abierta y que la parada de emergencia **Ctrl+Alt+Z** esté activa. Pausar, perder la mano o cambiar la configuración suelta el botón del ratón. El motor no ejecuta comandos arbitrarios y no guarda vídeo, puntos de la mano ni texto escrito.

## Pruebas

```powershell
npm test --prefix backend                                              # API, seguridad y datos
node --test --test-concurrency=1 backend/test/integration/*.test.js    # colección contra procesos reales
node --test "tests/frontend/*.test.js"                                 # interfaz (módulos puros)
motor-local\.venv\Scripts\python.exe -m pytest motor-local\tests       # motor (sintético, sin cámara)
cargo test --manifest-path desktop/Cargo.toml --locked                 # puente Tauri
npm run lint; npm run format:check; npm run verify:separation
npm run desktop:build; npm run verify:tauri                            # .exe real con backend temporal (abre ventanas)
npm run verify:hito3                                                   # recorrido interfaz, API y SQLite con la app real
```

`verify:tauri` y `verify:hito3` usan una base y un perfil de WebView2 temporales, no abren la cámara y no mueven el ratón. GitHub Actions ejecuta las pruebas de backend, interfaz, motor y puente, además de lint y compilación, en cada push a `main` o `codex/h2-*` (`.github/workflows/test.yml`). Lo que necesita manos reales está en la sección 16 del manual.

## Lo que falta

- **Prueba física** con cámara y manos de otras personas, y calibrar los umbrales con esos resultados.
- **Instalador** (empaquetado de Tauri con Python y el motor incluidos).
- **Servidor remoto** (HTTPS, correo real, respaldos, despliegue). Hoy el backend corre en el mismo equipo, en `127.0.0.1`.
- Medir precisión, latencia y usabilidad. No hay cifras medidas.
- La versión móvil queda fuera de alcance.

## Documentación

- [Manual de instalación y uso](docs/manual-instalacion-y-uso.md)
- [Matriz de cumplimiento del Hito 1](docs/matriz-hito1.md)
- [Contrato OpenAPI](docs/api/openapi.yaml), [colección Postman](docs/api/coleccion.json) y [entorno sin secretos](docs/api/entorno.example.json)
- Hito 2: [informe](docs/hito2/informe.md), [datos y seguridad](docs/hito2/datos-seguridad.md), [API y arquitectura](docs/hito2/api-arquitectura.md), [motor local](docs/hito2/motor-local.md), [pruebas](docs/hito2/pruebas.md), [auditoría de seguridad](docs/hito2/auditoria-seguridad.md)

Problemas frecuentes del backend: si la base ya existe al inicializar, usa la que hay y arranca el servidor. Si la ruta está dentro de OneDrive, usa AppData local. 403 al modificar: falta el CSRF de la sesión actual. 409 al editar: vuelve a leer la versión. 503: otro proceso tiene bloqueada la base. 429: espera el límite de autenticación.

Formato del frontend: `npm run format:app` aplica Prettier a `src/` y `npm run format:check` verifica formato y máximo de 500 líneas físicas; la comprobación también se ejecuta en CI.
