# Continuidad Hito 1 / Hito 2

Base documental: informe Hito 1 del repositorio, contrato AGENTS.md y aportes I1/I2. Corte: 2 de noviembre de 2026. Una pantalla del prototipo no demuestra persistencia ni reconocimiento real.

Esta actualización (5 de noviembre de 2026) revisa el motor y la aplicación Tauri del commit bfd9dc2 con cambios locales. Las pruebas citadas son sintéticas y se ejecutaron en esta sesión; no certifican funcionamiento físico en Windows.

| Compromiso o necesidad | Entrega H2 y evidencia | Estado / límite |
|---|---|---|
| Personalizar perfiles y modos | Dos CRUD HTTP, SQLite nueva, pruebas de recursos e integración | Probado automático; React no conectado |
| Conservar configuración | SQL reproducible, versión optimista, reinicio de proceso en pruebas | Probado automático; no sincronización automática |
| Separar usuarios y administración | Sesiones opacas, roles, suspensión, CSRF y propiedad | Probado automático; admin no lee perfiles ajenos |
| Capturar y detectar mano | OpenCV y MediaPipe Hands local | Cámara/modelo probados; movimiento informado por usuario |
| Mover puntero | Adaptador pynput; activación de control solo con cámara abierta y atajo de parada activo; `pointer` del DTO | Sintético; movimiento real con cámara pendiente de prueba física |
| Micro-pinza | Confirmación de 3 muestras y ≥60 ms, salida con 2 muestras, histéresis y cooldown de 320 ms | Sintético; clic real pendiente de prueba física |
| Parada segura | Ctrl+Alt+Z (no F8 ni Escape); STOP cooperativo con ACK y plazo de 3 s; liberación de botón al pausar, perder la mano, cambiar configuración o cerrar | Sintético y prueba Rust del plazo; prueba física pendiente |
| Arrastre | Pinza sostenida ≥380 ms; `drag` del DTO; cancelado por puño | Sintético; arrastre real pendiente |
| Scroll de dos dedos | Postura confirmada, zona muerta por longitud de palma, límite de muescas por segundo, cancelación por cambio de postura | Sintético; hacia arriba/abajo en aplicaciones reales pendiente |
| Exportación de la API | `LOAD_EXPORT` valida formato 1, rechaza acciones no implementadas y credenciales | Sintético; carga desde la interfaz no conectada en este cambio |
| Ventanas con tres dedos | Minimizar la ventana activa y restaurar la última minimizada por el motor (Win32 vía ctypes); identidad por HWND, PID y creación del proceso; opt-in local | Sintético con controlador simulado; Win32 real pendiente de prueba física |
| Barrido horizontal | Palma abierta: Alt+Izquierda (atrás) y Alt+Derecha (adelante), una acción por barrido con rearme | Sintético; navegación en aplicaciones reales pendiente |
| Quinto gesto | Procedimiento documentado en docs/hito2/motor-local.md; sin implementación ni acción | Pendiente |
| Air-Swipe | Solo catálogo y continuidad documental | Futuro; no implementación ni texto almacenado |
| Mirada, móvil y ergonomía | Campos previstos sin motor asociado | Futuro; sin beneficio ergonómico medido |
| Distribución de escritorio | Tauri/Rust como puente nativo y motor Python explícito, invocado por JSON-lines | Compila y pasa pruebas Rust; sin instalador ni instalación probada en otro equipo |

El prototipo web del Hito 1 se conserva como antecedente visual. No se incorporó automáticamente desktop/runtime: usa otro modelo y otra versión de API. El alcance de esta semana demuestra backend y un motor mínimo; no presenta como terminado el producto completo. La dificultad de uso observada debe explicarse en la defensa y convertirse en trabajo de calibración posterior, sin inventar métricas.
