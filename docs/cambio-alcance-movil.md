# Nota de cambio de alcance: móvil (20-11-2026)

Decisión de la persona a cargo del proyecto antes de la entrega del martes 24-11-2026.

## Antes

`AGENTS.md` limitaba el móvil a una **interfaz web adaptable** (React), sin motor, cámara, sensores ni control
nativo. El Informe del Hito 1 trata la versión móvil y su activación contextual como trabajo futuro.

## Ahora

| Tema | Decisión |
|---|---|
| App móvil | **APK Android nativa en Java** (`android/`): cámara frontal, MediaPipe GestureRecognizer local, servicio de accesibilidad con una lista blanca de acciones (Volver, desplazar, multimedia). |
| Web móvil | **Fuera de alcance.** No se entrega una versión web móvil; `npm run build:mobile` sigue existiendo pero no forma parte de la demo. |
| Interfaz compartida | **No hay.** La app Android no reutiliza componentes React. Lo compartido es la API `/api/v1`, `contracts/capacidades.json` (códigos de gesto y acción) y los modos con `plataforma = 'movil'`. |
| Servidor | La misma API Express + SQLite del PC. El teléfono la alcanza por la red local: `LAN_HOST=<IPv4 privada del PC>` en `.env` (HOST sigue en `127.0.0.1`). La APK solo permite HTTP sin cifrar hacia la IP con que se compiló (`-PztLanHost`). **No se migra a Supabase.** |
| Qué hace el teléfono con la cuenta | Solo **lee** el primer modo móvil (`docs/movil-contrato.md`). Los modos se crean y editan en el escritorio. |

## Desviaciones respecto del Informe del Hito 1

- **Servidor remoto con HTTPS**: no está desplegado. La demo usa la API en el PC por la red local (HTTP en
  claro, solo en esa red). Desplegarla con HTTPS es la tarea opcional T23.
- **Instalador de escritorio**: no hay (`bundle.active: false`; Python no se empaqueta). La demo se ejecuta
  desde el repositorio.
- **HUD**: existe un indicador flotante en Windows (estado del motor y última acción); su comprobación con
  la app real sin cámara está en `npm run verify:tauri` (resultado en `PROGRESO.md`). En Android no hay HUD
  superpuesto: el estado se ve en la notificación y en la pantalla de la app.
- **Activación contextual móvil** (`activacion_contextual_movil`): el campo existe en la API, pero el teléfono
  todavía no lo aplica (T27, opcional).

## Qué no se afirma

La APK compila con el SDK y su lógica pura pasa pruebas JVM, y el cliente Java se probó contra el backend real
en el PC. **No se ha instalado ni probado en el teléfono** (Samsung A26) a la fecha de esta nota: eso lo hace la
persona a cargo, con el procedimiento de `android/README.md`.
