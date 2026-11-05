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

Resultado sintético de la revisión del 5 de noviembre de 2026: 61 pruebas aprobadas sin cámara (incluida la prueba de protocolo IPC en proceso con cámara y detector falsos) y 1 prueba `hardware` aprobada con `--mock-os`. Esta cifra no certifica la cámara real ni los botones del sistema operativo. Pendientes de prueba física en Windows: cámara, micro-pinza, arrastre, scroll, pausa por puño, pérdida de mano, parada con Ctrl+Alt+Z y liberación de botones.

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
| `puno_cerrado` | Pausa al mantener; reanudar siempre permitido (`pausar`) | `fistPause` |

Cualquier otra acción o asignación se rechaza si está habilitada y se registra como inactiva si está deshabilitada. Los pulgares se detectan en telemetría sin acción.

Consecuencia práctica: el repositorio de catálogos trata un gesto sin asignación como habilitado (`COALESCE(a.habilitado,1)` en `backend/src/repositories/catalogosRepository.js`). Una exportación de un modo sin asignaciones contiene 7 gestos no implementados habilitados (palma abierta, deslizamientos, pulgares, precisión y Air-Swipe) y el motor la rechaza. Para cargarla hace falta deshabilitarlos, lo que hoy no es posible desde la API porque la edición de asignaciones (PUT/DELETE) no forma parte del mínimo. Decisión pendiente del equipo.

Hipótesis iniciales, no calibradas: pinza confirmada con 3 muestras consecutivas y al menos 60 ms; salida con 2 muestras; cooldown de clic de 320 ms; scroll con 3 muestras y 60 ms, zona muerta de 0,06 longitudes de palma y como máximo 20 muescas por segundo, con cadencia independiente del número de fotogramas. No se afirma FPS, precisión ni latencia medidos.

## Seguridad y ciclo de vida

- Ctrl+Alt+Z es la parada de emergencia. Si el atajo no se registra o no queda activo, `SET_MODE CONTROL` se rechaza y el motor informa `hotkeyActive: false`.
- `STOP` se procesa en orden: los comandos anteriores reciben su ACK antes del cierre. La aplicación espera hasta 3 s a que el motor termine; solo entonces lo fuerza. En ese caso el `finally` de Python no está garantizado.
- Cámara perdida con control activo: el motor pasa a observación y libera el botón.
- Fallo continuado del detector (30 muestras seguidas): el motor termina con `ERROR` y libera recursos.
- Pérdida de mano: el botón se libera tras `tracking_loss_frames` fotogramas sin mano; puño o pausa lo liberan de inmediato.

## Alcance del contrato

La configuración de interfaz se transmite mediante el puente nativo y se valida en el motor. La exportación `GET /api/v1/modos/:id/gestos` puede cargarse con `LOAD_EXPORT`, que está implementado en Python y probado sintéticamente. Su conexión desde la interfaz Tauri no está en este cambio. El catálogo de acciones futuras no autoriza comandos del sistema arbitrarios.

Pendiente de implementación y de asignación de responsable: gestos de tres dedos para minimizar y restaurar ventanas con Win32, barrido horizontal atrás/adelante, quinto gesto, pulgares con acción, Air-Swipe, mirada y móvil. Ninguno está implementado.

La implementación anterior y su documentación se preservaron localmente fuera de la entrega; no son un segundo motor activo. `.venv`, cachés y resultados de pruebas se excluyen de Git. El desarrollo del motor procede de la copia de Antigravity; la consolidación y sus comprobaciones no sustituyen la revisión humana ni la prueba física del equipo.
