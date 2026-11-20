# Motor local integrado con Tauri

El motor vigente está en `motor-local/motor_local/`. Tauri lo ejecuta como `python -u -m motor_local.main` desde `motor-local/`, con comandos y telemetría JSON por entrada/salida estándar. No utiliza HTTP por fotograma ni abre la base SQLite. El backend de cuentas y configuraciones es exclusivamente `/api/v1`.

## Instalación y ejecución

Usar Python 3.11. Desde la raíz:

```powershell
python -m venv motor-local/.venv
motor-local/.venv/Scripts/python.exe -m pip install -r motor-local/requirements.txt
npm run desktop:build
```

Tauri busca primero el intérprete en ese entorno. Abrir el ejecutable de desarrollo `desktop/target/debug/zerotouch-desktop.exe`; el control de cámara y motor se realiza desde su interfaz. Para cuentas y perfiles, iniciar por separado `npm start --prefix backend` con el `.env` raíz existente. No ejecutar inicializadores sobre una base ya creada.

El motor empieza en observación. La activación del control es explícita. Sus módulos separan captura, detección, interpretación, acciones y adaptación al sistema operativo. El código consolidado incorpora selección de mano, puntero, micro-pinza, arrastre y scroll. Su presencia en código y sus pruebas sintéticas no certifican funcionamiento manual, precisión, FPS ni adecuación a usuarios.

## Pruebas

```powershell
motor-local/.venv/Scripts/python.exe -m pip install -r motor-local/requirements-dev.txt
motor-local/.venv/Scripts/python.exe -m pytest motor-local/tests
```

La configuración de pytest permite ejecutar desde la raíz y excluye por defecto la prueba marcada `hardware`. Esa prueba ejecuta el proceso real y puede abrir la cámara, aunque use un adaptador de ratón simulado. Solo ejecutarla cuando se quiera realizar esa comprobación:

```powershell
motor-local/.venv/Scripts/python.exe -m pytest motor-local/tests -m hardware
```

Resultado sintético de la revisión del 5 de noviembre de 2026: 85 pruebas aprobadas sin hardware (incluidas las de protocolo IPC con cámara y detector falsos, y las de ventanas y barrido con controladores simulados) y 1 prueba `hardware` aprobada con `--mock-os`. Esta cifra no certifica la cámara real ni los botones del sistema operativo. Pendientes de prueba física en Windows: cámara, micro-pinza, arrastre, scroll, pausa por puño, pérdida de mano, parada con Ctrl+Alt+Z y liberación de botones. El procedimiento está en `docs/prueba-manual-hardware.md`.

## Protocolo IPC

Cada comando JSON puede incluir `id`. El motor responde siempre con un mensaje `ACK` con el mismo `id`:

- `ok: true` con los datos aplicados (`mode`, `paused`, `notes`, etc.).
- `ok: false` con `code` estable y `message` sin secretos.

Códigos principales: `FIELD_INVALID`, `FIELD_OUT_OF_RANGE`, `FIELD_MISSING`, `UNKNOWN_FIELD`, `FORMAT_NOT_IPC`, `FORMAT_UNSUPPORTED`, `ACTION_NOT_IMPLEMENTED`, `PLATFORM_UNSUPPORTED`, `CREDENTIALS_NOT_ALLOWED`, `GESTURE_UNKNOWN`, `GESTURE_DUPLICATED`, `GESTURE_MISSING`, `MODE_INVALID`, `CAMERA_NOT_OPEN`, `EMERGENCY_HOTKEY_UNAVAILABLE`, `UNKNOWN_COMMAND`, `IPC_INVALID_JSON`.

| Comando | Efecto |
|---|---|
| `SET_CONFIG` | Configuración en formato IPC de la aplicación. Ausente = valor por defecto; presente e inválida = rechazo. |
| `LOAD_EXPORT` | Exportación de la API `formato_version: 1` con `modo` y `gestos`, más `runtime` opcional para cámara, espejo y mano. Sin credenciales. |
| `SET_MODE` | `CONTROL` solo con cámara abierta y atajo de parada activo. |
| `SET_PAUSED`, `EMERGENCY_STOP`, `STOP` | Pausa, parada inmediata y cierre cooperativo. |

Un cambio de configuración libera primero el botón si hay arrastre o pinza en curso, y después aplica la nueva configuración.

## Gestos y acciones

| Gesto | Acción implementada | Interruptor del DTO |
|---|---|---|
| `mano_abierta_sostenida` | Mover puntero (`activar_puntero`) | `pointer` |
| `micro_pinza` | Clic por pinza confirmada (`clic`) | `pinch` |
| `pinza_sostenida` | Arrastre con botón izquierdo (`arrastrar`) | `drag` |
| `liberacion_pinza` | Parte del arrastre (`soltar`); sin interruptor propio | informativo |
| `dos_dedos` | Desplazamiento vertical (`desplazar`) | `scroll` |
| `puno_cerrado` | Pausa: puño confirmado durante ≥250 ms y 6 muestras, con la palma quieta, y mantenido 450 ms; reanudar siempre permitido (`pausar`) | `fistPause` |
| `deslizamiento_izquierda` | Palma abierta, barrido a la izquierda: Alt+Izquierda (`atras`) | `swipeLeft` |
| `deslizamiento_derecha` | Palma abierta, barrido a la derecha: Alt+Derecha (`adelante`) | `swipeRight` |

Gestos locales para PC (ajustes del equipo, no se sincronizan ni están en el catálogo de la API, como los de ventana):

- **Pulgar y meñique (🤙) → pestañas** (`tabGestures`, activo por defecto): índice, medio y anular plegados, meñique extendido y pulgar separado de la base del índice (> 0,4 palmas). Con la postura confirmada (3 muestras y 60 ms), cada 0,5 palmas de recorrido vertical emite `NEXT_TAB` (hacia abajo, Ctrl+Tab) o `PREV_TAB` (hacia arriba, Ctrl+Shift+Tab), con al menos 220 ms entre cambios; seguir moviendo la mano cambia más pestañas y la postura quieta no hace nada. El cursor no se mueve mientras dura. Las teclas están en `teclas_equipo` del contrato; se informan a la interfaz como evento con `injected`.
- **Pinza pulgar-medio → clic derecho** (`rightClick`, activo por defecto): índice extendido y separado del pulgar, punta del medio lejos de la palma (no plegada) y pulgar-medio por debajo del umbral de pinza del modo. Confirmación e histéresis como la pinza del índice (2 muestras, 45 ms; 2 muestras para soltar); emite `RIGHT_CLICK` al soltar si duró ≤ 700 ms y respeta el cooldown de clic. Desactivada con el teclado Air-Swipe abierto.

Cursor y robustez (QA del 19-11, detalle y mediciones en `docs/qa-comodidad-19-11.md`): al armar, el área activa se recentra en la posición de la mano; aceleración del puntero tipo mouse (`pointerAcceleration`, ajuste del equipo: ×0,6 por debajo de 0,05 pantallas/s, ×1,2 a 0,3 y ×2,5 desde 1,0; el cursor se detiene en los bordes; sin cursor asentado cuando está activa; la posición solo se recorta a la pantalla al final); el clic se fija en la posición de 90 ms antes; se toleran 2 cuadros sin mano (≤ 150 ms) y 2 cuadros dudosos en el puño; la pausa cuenta desde que se forma el puño; el puntero se desarma tras 8 s sin mano; `windowSwipe` viene apagado.

Ambos exigen el puntero armado (mano abierta sostenida), igual que los demás gestos salvo puño y pulgares. Umbrales sin calibrar con manos reales.

Gestos de ventana con tres dedos (índice, medio y anular extendidos, meñique plegado, pinza abierta). No tienen código en el catálogo de la API: son locales y se activan solo con `windowGestures: true` en la configuración del equipo (desactivados por defecto). Hacia abajo minimizan únicamente la ventana en primer plano en el momento del gesto. Hacia arriba restauran solo la última ventana que el propio motor minimizó, y únicamente si sigue existiendo, es el mismo proceso y sigue minimizada; si no, no restauran nada. Una ventana no se restaura por reutilizar un identificador: se comparan HWND, PID y hora de creación del proceso. Restaurar no garantiza el foco: el resultado (`focused`) se informa en `windowResult`. Nunca se usa «mostrar escritorio» ni se cierran aplicaciones. Cada postura dispara una vez y exige soltarla (rearme) y un cooldown de 800 ms.

El barrido de palma abierta exige recorrido horizontal de 1,2 longitudes de palma en como máximo 450 ms, velocidad de al menos 2 longitudes por segundo, predominio horizontal (al menos el doble que el vertical) y no volver hacia atrás más de 0,25 palmas. Dispara una vez y se rearma cuando la mano queda quieta 200 ms y pasó un cooldown de 600 ms. El puntero sigue activo durante la palma.

Cualquier otra acción o asignación se rechaza si está habilitada y se registra como inactiva si está deshabilitada. Los pulgares se detectan en telemetría sin acción.

Consecuencia práctica: el repositorio de catálogos trata un gesto sin asignación como habilitado (`COALESCE(a.habilitado,1)` en `backend/src/repositories/catalogosRepository.js`). Una exportación de un modo sin asignaciones contiene 7 gestos no implementados habilitados (palma abierta, deslizamientos, pulgares, precisión y Air-Swipe) y el motor la rechaza. Para cargarla hace falta deshabilitarlos, lo que hoy no es posible desde la API porque la edición de asignaciones (PUT/DELETE) no forma parte del mínimo. Decisión pendiente del equipo.

Hipótesis iniciales, no calibradas: pinza confirmada con 3 muestras consecutivas y al menos 60 ms; salida con 2 muestras; cooldown de clic de 320 ms; scroll con 3 muestras y 60 ms, zona muerta de 0,06 longitudes de palma y como máximo 20 muescas por segundo, con cadencia independiente del número de fotogramas. No se afirma FPS, precisión ni latencia medidos.

## Seguridad y ciclo de vida

- El cursor recorre el escritorio virtual completo (todas las pantallas, también las que quedan a la izquierda o arriba de la principal). El área activa de la cámara se reparte sobre ese rectángulo, así que con varias pantallas cada movimiento de la mano recorre más píxeles: ajusta la velocidad del cursor en Calibrar si resulta excesiva.
- Ctrl+Alt+Z es la parada de emergencia. Si el atajo no se registra o no queda activo, `SET_MODE CONTROL` se rechaza y el motor informa `hotkeyActive: false`.
- `STOP` se procesa en orden: los comandos anteriores reciben su ACK antes del cierre. La aplicación espera hasta 3 s a que el motor termine; solo entonces lo fuerza. En ese caso el `finally` de Python no está garantizado.
- Cámara perdida con control activo: el motor pasa a observación y libera el botón.
- Fallo continuado del detector (30 muestras seguidas): el motor termina con `ERROR` y libera recursos.
- Pérdida de mano: el botón se libera tras `tracking_loss_frames` fotogramas sin mano; puño o pausa lo liberan de inmediato.

## Alcance del contrato

La configuración de interfaz se transmite mediante el puente nativo y se valida en el motor. La exportación `GET /api/v1/modos/:id/gestos` puede cargarse con `LOAD_EXPORT`, que está implementado en Python y probado sintéticamente. Su conexión desde la interfaz Tauri no está en este cambio. El catálogo de acciones futuras no autoriza comandos del sistema arbitrarios.

Pendiente de decisión y de asignación de responsable: gestos de ventana como catálogo de la API (exige cambiar `db/schema.sql` y coordinar con I1 e I2), pulgares con acción, Air-Swipe real, mirada y móvil. La conexión de `engine_load_export` queda expuesta por Tauri y en `src/api/client.js` (`engineLoadExport`), pero ningún control de la interfaz la invoca todavía.

## Cómo añadir otro gesto

Un gesto nuevo requiere cinco pasos. Si falla cualquiera, no se activa:

1. **Reconocimiento** en `interpreter.py`: una función pura que reciba la postura y devuelva un evento. Debe ser excluyente con las demás posturas (ver la prioridad en el encabezado del módulo) y tener umbrales en unidades normalizadas (longitudes de palma) y tiempo en milisegundos.
2. **Evento** nuevo en `interpreter.py`, añadido a `ALLOWED_EVENTS` en `action_engine.py`.
3. **Acción permitida** en `os_adapter.py`: solo funciones explícitas (como `key_combo` con su lista blanca). Nunca comandos de shell ni rutas arbitrarias.
4. **Asignación** en `api_export.py`: entradas en `IMPLEMENTED_BINDINGS` y `GESTURE_FLAG`, y el interruptor correspondiente en `config.py`. Mientras falte, la exportación rechaza cualquier asignación habilitada de ese código.
5. **Pruebas sintéticas**: reconocimiento positivo, ruido, cadencias distintas, exclusión con las demás posturas y cooldown/rearme. Una prueba física no sustituye a estas pruebas.

La implementación anterior y su documentación se preservaron localmente fuera de la entrega; no son un segundo motor activo. `.venv`, cachés y resultados de pruebas se excluyen de Git. El desarrollo del motor procede de la copia de Antigravity; la consolidación y sus comprobaciones no sustituyen la revisión humana ni la prueba física del equipo.
