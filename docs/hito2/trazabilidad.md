# Continuidad Hito 1 / Hito 2

Base documental: informe Hito 1 del repositorio, contrato AGENTS.md y aportes I1/I2. Corte: 2 de noviembre de 2026. Una pantalla del prototipo no demuestra persistencia ni reconocimiento real.

Cambio de alcance de esta sesión: por indicación del usuario, Codex continúa exclusivamente backend; Antigravity trabaja el software. Las filas del motor registran observaciones preliminares y no certifican la implementación de Antigravity.

| Compromiso o necesidad | Entrega H2 y evidencia | Estado / límite |
|---|---|---|
| Personalizar perfiles y modos | Dos CRUD HTTP, SQLite nueva, pruebas de recursos e integración | Probado automático; React no conectado |
| Conservar configuración | SQL reproducible, versión optimista, reinicio de proceso en pruebas | Probado automático; no sincronización automática |
| Separar usuarios y administración | Sesiones opacas, roles, suspensión, CSRF y propiedad | Probado automático; admin no lee perfiles ajenos |
| Capturar y detectar mano | OpenCV y MediaPipe Hands local | Cámara/modelo probados; movimiento informado por usuario |
| Mover puntero | Adaptador Windows y habilitación F8 | Prueba manual parcial: movimiento con dificultad |
| Micro-pinza | Estado con rearme, histéresis y antirrepetición | Probado sintético; clic real pendiente de confirmar |
| Parada segura | F8, Escape, pérdida de mano y limpieza de recursos | Pausa por pérdida confirmada; Escape manual pendiente |
| Air-Swipe | Solo catálogo y continuidad documental | Futuro; no implementación ni texto almacenado |
| Mirada, móvil y ergonomía | Campos previstos sin motor asociado | Futuro; sin beneficio ergonómico medido |
| Distribución de escritorio | Motor Python explícito | Sin instalador ni Tauri |

El prototipo web del Hito 1 se conserva como antecedente visual. No se incorporó automáticamente desktop/runtime: usa otro modelo y otra versión de API. El alcance de esta semana demuestra backend y un motor mínimo; no presenta como terminado el producto completo. La dificultad de uso observada debe explicarse en la defensa y convertirse en trabajo de calibración posterior, sin inventar métricas.
