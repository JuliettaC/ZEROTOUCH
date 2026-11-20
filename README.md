# <img width="35" height="35" alt="ICON NEGRO" style="vertical-align: -6px;" src="https://github.com/user-attachments/assets/d52f48df-cfcb-40aa-8178-1989bbdff02e" /> ZEROTOUCH

ZeroTouch es para personas que hacen tareas manuales (cocina, taller) mientras consultan información en el computador. Permite controlar Windows con gestos de la mano frente a una cámara web común, sin sensores especiales: mover el cursor, hacer clic, desplazar, pausar, minimizar ventanas, manejar temporizadores y multimedia, y escribir con trazos en el aire.

> **Estado (16-11-2026):** el software está implementado de punta a punta y cubierto por pruebas automáticas, pero **todavía no se ha probado con cámara y manos reales**. Los umbrales de los gestos son hipótesis sin calibrar. No hay instalador. Ver la [matriz de cumplimiento del Hito 1](docs/matriz-hito1.md).

## Integrantes

* Julietta Céspedes (@JuliettaC)
* Adan Mendoza (@Adammm14)
* Anais Perez (@Youpuipui)

## Enlaces

- [Prototipo del Hito 1](https://juliettac.github.io/ZEROTOUCH/) (versión web histórica, se conserva sin cambios)
- [Informe del Hito 1](docs/Informe%20Hito%201.pdf) · [Matriz de cumplimiento](docs/matriz-hito1.md)
- [Guía de prueba con cámara](docs/prueba-manual-hardware.md) · [Contrato de la API (OpenAPI)](docs/api/openapi.yaml)
- [Registro de cambios](CHANGELOG.md) · [Progreso técnico](PROGRESO.md)

## Cómo está hecho

```
Cámara ─► motor-local (Python) ─► Windows (ratón, teclas, ventanas)
               ▲   │ JSON-lines (comandos con ACK, telemetría, eventos)
               │   ▼
           desktop (Tauri 2, Rust) ◄─► src (React 19): Inicio · Calibrar · Teclado
               │ HTTP con cookie y CSRF (solo cuentas y sincronización)
               ▼
           backend (Node 24, Express 5, SQLite) — /api/v1
```

| Carpeta | Qué contiene |
|---|---|
| `motor-local/motor_local/` | Motor gestual: captura → detección (MediaPipe, 21 puntos) → interpretación (filtro One-Euro, confirmación por tiempo) → acciones (lista blanca) → adaptador del SO (pynput, Win32) |
| `desktop/` | Aplicación Tauri: lanza el motor, cliente HTTP nativo, ventana del teclado Air-Swipe e indicador flotante (HUD) |
| `src/` | Interfaz React (escritorio). Preferencias por cuenta, sincronización, temporizadores y teclado Air-Swipe |
| `backend/`, `db/` | API de cuentas, perfiles, modos y asignaciones de gestos. SQLite v3 con migraciones explícitas |
| `contracts/capacidades.json` | Contrato único: qué acciones admite cada gesto y qué teclas puede emitir el motor |
| `android/` | App Android nativa (Java): cámara frontal, MediaPipe local, lista blanca de acciones por accesibilidad y lectura del modo móvil desde la API ([contrato](docs/movil-contrato.md)) |
| `prototype/` | Prototipo del Hito 1 (no se modifica) |
| `docs/` | Informes, API, guía de prueba manual y matriz de cumplimiento |

El motor nunca depende del servidor: los gestos funcionan sin conexión, y la cuenta solo sirve para sincronizar perfiles y modos entre equipos.

## Gestos

| Gesto | Qué hace | Por defecto |
|---|---|---|
| Mano abierta un instante | Activa el puntero; después la mano mueve el cursor | Activo |
| Pinza (índice + pulgar) | Clic | Activo |
| Pinza sostenida | Arrastrar (abrir los dedos suelta) | Activo |
| Dos dedos arriba o abajo | Desplazar | Activo |
| Puño quieto ~0,5 s | Pausar o reanudar | Activo |
| Mano abierta rápida hacia abajo / arriba | Minimizar la ventana activa / traerla de vuelta | Activo |
| Palma quieta ~1 s | Volver a navegación (reasignable: multimedia, temporizador…) | Activo |
| Índice + meñique | Modo precisión (cursor más lento) | Activo |
| Barrido a la izquierda / derecha | Atrás / Adelante | Apagado |
| Pulgar arriba / abajo | Intro / Escape (reasignables) | Apagado |
| Tres dedos abajo / arriba | Minimizar / restaurar (alternativa) | Apagado |
| Apuntar con el índice sobre el teclado | Escribir con trazos (Air-Swipe) | Solo con el teclado abierto |

Los gestos «discretos» (palma, barridos, pulgares, precisión) se pueden reasignar por modo en **Calibrar › Qué hace cada gesto**, entre las acciones permitidas por el contrato.

**Seguridad:** el motor arranca en *Observar* y no mueve nada. *Controlar* exige que la cámara esté abierta y que la parada de emergencia **Ctrl+Alt+Z** esté activa. Pausar, perder la mano o cambiar la configuración suelta el botón del ratón. El motor no ejecuta comandos arbitrarios y no guarda vídeo, puntos de la mano ni texto escrito.

## Instalación en Windows (desarrollo)

Requisitos: Node **24.19.0**, Python **3.11**, Rust (MSVC) con las herramientas de compilación C++, y WebView2.

```powershell
# 1. Dependencias
npm ci
npm ci --prefix backend
python -m venv motor-local/.venv
motor-local/.venv/Scripts/python.exe -m pip install -r motor-local/requirements-dev.txt

# 2. Configuración del backend (solo para cuentas y sincronización)
Copy-Item .env.example .env
#    Edita DATABASE_PATH con una ruta absoluta FUERA del repositorio y de OneDrive,
#    p. ej. C:/Users/TU_USUARIO/AppData/Local/ZeroTouch/zerotouch.sqlite
npm run db:init --prefix backend          # crea una base nueva (rechaza una existente)
npm run admin:bootstrap --prefix backend  # opcional: cuenta de administración (pide la contraseña)

# 3. Compilar la aplicación
npm run desktop:build
```

Uso diario: `npm start --prefix backend` en una terminal (opcional, solo para cuentas) y `desktop/target/debug/zerotouch-desktop.exe` en otra. En la aplicación, **Inicio › Activar cámara**, luego **Controlar**, y muestra la mano abierta.

Una base creada con una versión anterior se actualiza **a mano** y con respaldo automático: `node backend/scripts/migrate-db.js`. Nunca se migra al arrancar.

## Pruebas

```powershell
npm test --prefix backend                                         # API, seguridad y datos
node --test --test-concurrency=1 backend/test/integration/*.test.js  # colección contra procesos reales
node --test "tests/frontend/*.test.js"                            # interfaz (módulos puros)
motor-local/.venv/Scripts/python.exe -m pytest motor-local/tests  # motor (sintético, sin cámara)
cargo test --manifest-path desktop/Cargo.toml --locked            # puente Tauri
npm run lint; npm run verify:separation
npm run desktop:build; npm run verify:tauri                       # .exe real con backend temporal (abre ventanas)
```

GitHub Actions ejecuta las cinco primeras, además de lint y compilación, en cada push a `main` o `codex/h2-*` (`.github/workflows/test.yml`). Ninguna prueba automática abre la cámara ni mueve el ratón. Lo que necesita manos reales está en la [guía de prueba manual](docs/prueba-manual-hardware.md).

## Lo que falta

- **Prueba física** con cámara y manos (guía M1–M9), y calibrar los umbrales con esos resultados.
- **Instalador** (empaquetado de Tauri con Python y el motor incluidos).
- **Servidor remoto** (HTTPS, correo, respaldos, despliegue). Hoy el backend corre en el PC; el teléfono lo
  alcanza por la red local con `LAN_HOST` (HTTP en claro, solo para la demo).
- **App Android en el teléfono**: compila y su lógica pasa pruebas JVM, pero **no se ha instalado ni probado en
  un teléfono**. Activación contextual móvil (acelerómetro): pendiente.
- La **web móvil** queda fuera de alcance ([nota de cambio de alcance](docs/cambio-alcance-movil.md)).
- Medir precisión, latencia y usabilidad. No hay cifras medidas.

## Documentación

- [Matriz de cumplimiento del Hito 1](docs/matriz-hito1.md)
- [Contrato OpenAPI](docs/api/openapi.yaml), [colección Postman](docs/api/coleccion.json) y [entorno sin secretos](docs/api/entorno.example.json)
- Hito 2: [informe](docs/hito2/informe.md), [datos y seguridad](docs/hito2/datos-seguridad.md), [API y arquitectura](docs/hito2/api-arquitectura.md), [motor local](docs/hito2/motor-local.md), [pruebas](docs/hito2/pruebas.md), [auditoría de seguridad](docs/hito2/auditoria-seguridad.md)

Problemas frecuentes del backend: si la base ya existe al inicializar, usa la que hay y arranca el servidor. Si la ruta está dentro de OneDrive, usa AppData local. 403 al modificar: falta el CSRF de la sesión actual. 409 al editar: vuelve a leer la versión. 503: otro proceso tiene bloqueada la base. 429: espera el límite de autenticación.
