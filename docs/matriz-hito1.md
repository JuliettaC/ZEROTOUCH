# Matriz de cumplimiento del Hito 1

Qué prometió el [Informe del Hito 1](Informe%20Hito%201.pdf) y en qué estado está cada punto en el software actual. Corte: **16 de noviembre de 2026**, rama `codex/h2-seguridad-verificacion`, con cambios sin confirmar.

Cómo leer el estado:

- **Hecho:** implementado y cubierto por pruebas automáticas.
- **Hecho, falta prueba física:** implementado y probado con datos sintéticos, pero sin probar con cámara y manos reales. Cualquier umbral (tiempo, distancia, velocidad) es una hipótesis sin calibrar.
- **Parcial:** existe una parte.
- **Pendiente:** no existe todavía.
- **Futuro:** el propio Informe lo dejó para después.

Ninguna cifra de precisión, latencia real, consumo ni beneficio ergonómico se ha medido. Este documento no presenta ninguna como resultado.

## 1. Problema y personas usuarias (Informe §2)

| Compromiso | Dónde está | Estado |
|---|---|---|
| Usuario primario: cocina o taller con las manos ocupadas, consultando recetas, instrucciones o temporizadores | Modo «Cocina y Taller» (`src/data/preferences.js`, `presets.kitchen`); temporizadores de la interfaz (`src/data/timers.js`, `src/components/AppTools.jsx`) que se inician con un gesto o un botón | Hecho, falta prueba física. **Sin validar con personas usuarias** |
| Usuarios secundarios: oficina y movilidad o destreza reducidas | Modos «Desk-Rest Ergonómico» y «Asistencia Motriz» (mayor estabilización y tolerancia de pinza) | Hecho, falta prueba física. Sin validar con personas usuarias |
| Usar una cámara web común, sin sensores especiales | `motor-local/motor_local/capture.py` (OpenCV) y `detector.py` (MediaPipe Hands, 21 puntos) | Hecho. La cámara y el modelo los probó la persona usuaria; la precisión no se midió |

## 2. Arquitectura (Informe §4, Tabla 2)

| Capa o decisión | Dónde está | Estado |
|---|---|---|
| Cliente local: gestos procesados en el equipo, sin depender del servidor | Motor Python como proceso hijo de Tauri (JSON-lines con ACK por comando). La API nunca está en el ciclo de cada fotograma | Hecho |
| Detección | `capture.py`, `detector.py` (selección de mano preferida, continuidad espacial) | Hecho |
| Interpretación: estabilizar coordenadas y reconocer gestos con umbrales | `interpreter.py`: filtro One-Euro, confirmación por muestras y tiempo, histéresis, rearme y cooldown | Hecho, falta prueba física |
| Motor de acciones: acción lógica independiente de la aplicación | `action_engine.py`: lista blanca de eventos; teclas solo de `teclas_permitidas` en `contracts/capacidades.json` | Hecho |
| Integración con el SO | `os_adapter.py` (pynput, consciente de DPI, cursor interpolado a ~125 Hz) y `window_control.py` (Win32) | Hecho, falta prueba física |
| Seguridad de la integración | Arranca en Observar; Controlar exige cámara abierta y parada de emergencia Ctrl+Alt+Z activa; libera el botón al pausar, perder la mano, cambiar la configuración o cerrar | Hecho (pruebas sintéticas e IPC). Ctrl+Alt+Z real pendiente de prueba física |
| Presentación: configuración, calibración, perfiles y feedback | `src/` (React 19 SPA) en Tauri 2: Inicio, Calibrar, Teclado y avisos | Hecho. Verificado con el `.exe` real (`npm run verify:tauri`, 39/39 en la última ejecución registrada, 12-11-2026) sin cámara |
| Servicios: autenticar y sincronizar preferencias | `backend/` (Express 5, SQLite v3, Argon2id, sesiones, CSRF, roles, verificación de correo); sincronización por identidad y versión con conflictos explícitos (`src/sync/`) | Hecho **en local**. Servidor remoto con HTTPS y despliegue: Pendiente |
| Comunicación asíncrona entre servidor y gestos | La sincronización se ejecuta a pedido y nunca bloquea el motor | Hecho |
| Caso de uso «clic con micro-pinza en una aplicación externa» (§4.3) | Pinza → `LEFT_CLICK` → pynput en la posición del puntero; la interfaz muestra la telemetría | Hecho, falta prueba física |

## 3. Gestos (Tabla 1 y Anexo A)

Todos están en el contrato `contracts/capacidades.json` y se pueden reasignar por modo en Calibrar › «Qué hace cada gesto». Cada gesto muestra una ayuda de cómo hacerlo.

| Gesto del Informe | Acción | Implementación | Estado |
|---|---|---|---|
| Activación de puntero (mano abierta sostenida) | Inicia el seguimiento | `pointer_armed` tras ~0,35 s de mano abierta; se desarma tras 3 s sin mano | Hecho, falta prueba física |
| Palma abierta → navegación | Mover el puntero | Ancla en los nudillos (no cambia al pellizcar), área activa configurable y calibrable | Hecho, falta prueba física |
| Micro-pinza | Clic | 2 muestras y ≥45 ms; distancia con profundidad; histéresis; cooldown | Hecho, falta prueba física |
| Pinza sostenida / soltar | Arrastrar y soltar | ≥380 ms; abrir los dedos suelta | Hecho, falta prueba física |
| Palma abierta quieta | Volver a navegación (reasignable) | Sostenida ~0,9 s y quieta | Hecho, falta prueba física |
| Dos dedos | Desplazamiento vertical | Zona muerta en palmas y límite de muescas por segundo | Hecho, falta prueba física |
| Puño cerrado | Pausar o reanudar | Confirmado en tiempo y con la mano quieta | Hecho, falta prueba física |
| Deslizamiento a izquierda o derecha | Atrás / Adelante (Alt+←/→) | Barrido rápido de palma, una acción por barrido. Apagado por defecto | Hecho, falta prueba física |
| Pulgar arriba / abajo | Confirmar (Intro) / Cancelar (Escape) | Sostenido ~0,5 s. Apagado por defecto | Hecho, falta prueba física |
| Modo precisión (gesto configurable) | Menor sensibilidad | Índice y meñique; ganancia ×0,55 | Hecho, falta prueba física |
| Trazo en teclado Air-Swipe | Escritura | Ver §4 | Hecho, falta prueba física |
| *(añadido)* Mano abierta rápida abajo / arriba | Minimizar la ventana activa / traerla de vuelta | `interpreter.py` (barrido vertical), `window_control.py` | Hecho, falta prueba física |
| *(añadido)* Tres dedos abajo / arriba | Minimizar / restaurar | Alternativa opcional, apagada por defecto | Hecho, falta prueba física |

## 4. Funciones y extensiones previstas

| Compromiso | Dónde está | Estado |
|---|---|---|
| Calibración | Página Calibrar: mano, cámara, espejo, recorrido calibrable (`activeBox`), exigencia de detección y prueba en vivo de cada gesto | Hecho, falta prueba física |
| Modos de uso / contextos | Perfiles y modos con nombre y categoría editables, plantillas, ajustes por modo y asignaciones gesto → acción | Hecho |
| Temporizadores | `temporizador_iniciar`: el gesto inicia, pausa o reanuda; también hay botones, aviso sonoro y temporizadores visibles en todas las páginas | Hecho, falta prueba física del gesto |
| Multimedia | Reproducir/pausar y siguiente como teclas multimedia (solo en Controlar), con aviso en la interfaz | Hecho, falta prueba física |
| Air-Swipe con predicción local (§5.1: modelo compacto, sin Internet) | Ventana teclado no activable (`src/airswipe/`), decodificador de trazos tipo SHARK² con léxico local en español (~40 000 palabras, MIT). Escribe solo al confirmar y no guarda el texto | Hecho, falta prueba física. Es un decodificador léxico, no un modelo de lenguaje. **Precisión sin medir** (protocolo de 20 palabras en la guía manual) |
| Desk-Rest | Área activa más pequeña y más baja, en la configuración del modo | Hecho. **Beneficio ergonómico sin medir** |
| Asistencia por mirada (Futuro en el Informe) | `gaze.py`: orientación aproximada de la cabeza con la detección facial de MediaPipe; retiene la interacción al mirar fuera. No sigue los ojos | Parcial: es una aproximación, sin validar |
| Móvil (cambio de alcance del 20-11, [nota](cambio-alcance-movil.md)) | App Android nativa en Java (`android/`): cámara frontal, MediaPipe local, acciones por accesibilidad (Volver, desplazar, multimedia) y lectura del modo móvil desde la API por la red local ([contrato](movil-contrato.md)). Sin web móvil | Compila con el SDK; lógica pura y cliente con pruebas JVM; cliente probado contra el backend real en el PC. **Sin instalar ni probar en un teléfono** |
| Móvil: activación contextual (Futuro en el Informe) | Campo `activacion_contextual_movil` en la API | Pendiente: el teléfono no lo aplica |
| HUD que informa la acción (§4.3 paso 5) | Indicador flotante en Windows (`src/hud/`, ventana `#hud`): estado del motor y última acción; siempre encima, no activable, transparente a los clics, solo lectura | Implementado en Windows, con pruebas del modelo y comprobaciones en `npm run verify:tauri` (resultado en `PROGRESO.md`). Falta verlo con manos reales. En Android no hay HUD superpuesto |

## 5. Tecnología (Informe §5, Tabla 4)

| Decisión | Estado |
|---|---|
| React + SPA + Vite | Hecho (React 19, Vite 8). El prototipo del Hito 1 se conserva intacto en `prototype/` (`npm run verify:separation`) |
| MediaPipe para la detección | Hecho (0.10.13) |
| Python + pynput para el SO | Hecho (Python 3.11) |
| Node.js + Express para el backend | Hecho (Node 24, Express 5, better-sqlite3) |
| Predicción Air-Swipe local | Hecho (ver §4) |
| *(añadido)* Tauri 2 como aplicación de escritorio | Hecho. **Sin instalador**: `bundle.active: false` y Python no se empaqueta todavía |
| Identidad visual: tipografía Outfit | Hecho |
| Identidad visual: paleta #F9F8F7, #5F4D47, #69564F, #BDB3AA | Hecho en la interfaz de escritorio (`src/index.css`), con contraste de texto ≥ 6,5:1. El prototipo del Hito 1 no se modifica |

## 6. Validación y entrega

| Necesidad | Estado |
|---|---|
| Pruebas automáticas | Hecho. Backend, interfaz (módulos puros), motor (sintético) y puente Rust. CI en `.github/workflows/test.yml` |
| Prueba física con cámara y manos | **Pendiente.** Guía paso a paso en [prueba-manual-hardware.md](prueba-manual-hardware.md) |
| Medir rendimiento, precisión y usabilidad | Pendiente. El Informe pide no presentar indicadores no medidos |
| Instalación en otro equipo | Pendiente (sin instalador) |
| Servidor remoto | Pendiente. Para la demo, la API corre en el PC y el teléfono la usa por la red local (`LAN_HOST`, HTTP en claro) |

La trazabilidad detallada del Hito 2 (backend) sigue en [hito2/trazabilidad.md](hito2/trazabilidad.md). Su corte es el 5 de noviembre y varias filas ya quedaron superadas por esta matriz.
