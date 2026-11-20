# Traspaso a Claude — Android y continuidad

Estado inicial del bloque Android, 11-11-2026 (hora de Santiago). Actualizar al cerrar cada bloque.

## Autoridad y coordinación

El usuario amplió explícitamente móvil: APK Android real, cámara frontal y control
de otras aplicaciones mediante APIs permitidas. Samsung A26 será el primer equipo;
compatibilidad buscada con teléfonos de alrededor de 2021, todavía sin validar.
Esto sustituye para Android la limitación previa de móvil solo frontend.

Rama: `codex/h2-seguridad-verificacion`; HEAD observado `0ef7d33`. Hay numerosos
cambios previos sin commit en backend, escritorio, React, motor y documentación.
No sobrescribirlos. No cambiar rama, hacer commits, publicar ni tocar bases reales.

- Codex: módulo Android y documentación; no App.jsx/páginas/Python/Rust/backend.
- Gemini: correcciones de seguridad de Air-Swipe en motor-local y pruebas.
  Auditoría recibida, implementación/resultados todavía no recibidos ni verificados.
- Claude: integración de App.jsx con preferencias v2, sincronización y escritorio.

## Sincronización ya implementada en bloque anterior

Leer `src/sync/README.md`. Nombres largos corregidos; registro `syncOperation`,
callback `onCheckpoint`, errores con `error.state`; POST incierto bloqueado hasta
adopción explícita. PATCH/PUT se recupera con versión original. DELETE estaba bloqueado
(actualizado el 12-11-2026: ya existe DELETE condicional con If-Match; ver PROGRESO.md,
«Bloque Claude — borrado seguro»). 39/39 pruebas frontend
y lint del bloque pasaron en esa sesión, no constituyen una ejecución nueva.
La UI debe serializar sincronización/edición/cambio de cuenta y persistir checkpoints.

## Android: inspección inicial

No hay proyecto Android versionado (consulta `git ls-files '*gradle*' '*AndroidManifest*'`).
`desktop/gen` contiene esquemas Tauri; su configuración es de escritorio y no hay
build Android reutilizable observado. Se preparará un módulo nativo aislado.
Existe Android Studio con JBR 25 y SDK en `C:/Users/cespe/AppData/Local/Android/Sdk`.
Hay distribuciones Gradle en caché; falta comprobar versiones/dependencias utilizables.
El PATH resuelve Java a Java 8 y javac a JDK 25: no confiar en PATH para compilar.
No se inició cámara, motor ni se instaló APK.

## Prompt de continuación (provisional)

```text
Continúa ZEROTOUCH en la rama actual preservando todos los cambios locales.
Lee docs/traspaso-claude.md, PROGRESO.md y src/sync/README.md.
Prioridad de tu bloque: integrar App.jsx con preferencias v2 y sincronización.
Conecta onCheckpoint y conserva error.state; no elimines syncOperation ni
anuncies éxito si existen conflictos resultado_incierto/borrado_no_seguro.
DELETE se envía solo con If-Match y si el servidor anuncia borrado_condicional
(src/sync/README.md); nunca lo habilites sin esa precondición.
Recibe y revisa el informe final de Gemini antes de modificar su motor Python.
Android tiene alcance nativo nuevo; consulta su estado y pruebas en este documento
antes de continuar. No declares APK funcional ni compatibilidad física sin evidencia.
Trabaja por bloques, documenta comandos/resultados y preserva límites: sin commits,
publicación, cambio de rama, migraciones sobre bases reales ni activación de hardware.
```

Preparación asistida por Codex. Revisión humana pendiente.

## Bloque Android 1 — implementación y primera prueba

Creado `android/`: proyecto Java nativo (AGP 8.13.0, compile/target SDK 36,
min SDK 26), Camera2 frontal y MediaPipe GestureRecognizer 0.10.21. Gesto de
prueba: palma abierta sostenida para preparar, puño sostenido para Volver una vez.
Servicio de cámara en primer plano, accesibilidad limitada a GLOBAL_ACTION_BACK,
UI nativa de permisos/observación/activación/pausa/parada y notificación de parada.
No solicita contenido de pantalla ni permiso INTERNET. No reutiliza el motor Python
de Windows ni cambia el frontend de escritorio.

`android/test-core.ps1 -JavaHome C:/Users/cespe/.jdks/jbr-21.0.11`:
**95 aserciones JVM aprobadas**. Cubren observación, activación explícita, hold,
repetición, pausa, pérdida de mano, latencia, watchdog, accesibilidad, confianza
no válida, gaps y resultados de sesiones anteriores. No prueban cámara/modelo/Android.

Modelo real versión 1 descargado tras comunicar tamaño: 8,373,440 bytes;
SHA-256 `97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482`.
Ignorado por Git; `prepare-model.ps1` permite reproducir la descarga verificando hash.
No se activó cámara ni se ejecutó en teléfono.

Existe JBR 21 en `C:/Users/cespe/.jdks/jbr-21.0.11`, Gradle 8.14.3 y SDK 36.
Primera resolución offline falló por ruta incorrecta de caché de solo lectura;
corregida de `.../.gradle/caches/modules-2` a `.../.gradle/caches`.
Compilación Android pendiente de resultado; no afirmar todavía que hay APK.

## Bloque Claude — integración de la interfaz (11-11-2026)

`App.jsx` ya usa preferencias v2 y la sincronización corregida (hooks en `src/hooks/`, contrato en
`src/sync/README.md`, resultados y límites en `PROGRESO.md`). No se tocó `android/`. Para Android:
la lógica de decisión de la interfaz de escritorio (`src/sync/syncSession.js`, `src/engine/engineApply.js`,
`src/airswipe/session.js`) no depende de React ni de Tauri y puede reutilizarse si el frontend móvil sincroniza.
Pendiente de decisión del usuario: el módulo nativo de Android no sincroniza ni lee las preferencias v2.
