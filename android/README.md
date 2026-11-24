# ZeroTouch Android — primer flujo nativo

Módulo independiente de la app Tauri/React y del motor Windows. El usuario autorizó
ampliar móvil a control nativo por cámara frontal ([nota de cambio de alcance](../docs/cambio-alcance-movil.md)):
APK nativa en Java, **sin web móvil** y sin interfaz compartida con React. Equipo previsto: Samsung A26.
**No existe todavía validación física**: la APK no se ha instalado en ningún teléfono.

## Actualización 20-11-2026 (2): modo desde la cuenta y compilación verificada

- **La APK compila con el SDK** (`assembleDebug`, 20-11-2026). La firma de depuración faltaba: ahora
  `createDebugKeystore` la genera con `keytool` en el directorio de build (nunca en Git).
- **Lee el modo móvil desde la API (solo lectura)**: sección «Modo desde la cuenta» con servidor, usuario y
  contraseña (no se guarda) y el botón **«Actualizar modo»**. Usa el primer modo con `plataforma = 'movil'` y lo
  traduce con `GestureActions.fromCatalog`. Si el control está activo, **se pausa antes** de cambiar la lista
  (`GestureGate.reconfigure` lo rechaza durante CONTROL) y se reactiva a mano. Sin conexión o con cualquier
  error se dice el motivo y sigue aplicado lo anterior (al abrir: valores por defecto, rotulados como tales).
  Contrato, ejemplos reales y traducción: [docs/movil-contrato.md](../docs/movil-contrato.md).
- **Red**: permiso `INTERNET`; HTTP en claro **solo hacia la IP con que se compila** (`-PztLanHost`, genera
  `network_security_config.xml`); el resto exige https. El PC debe tener `LAN_HOST=<esa IP>` en `.env`.
- Pruebas JVM: `GestureGateTest` (95), `GestureActionsTest` (38) y `ModeLoaderTest` (66, con respuestas
  reales capturadas de la API y un servidor HTTP falso). El cliente Java también se probó contra el backend
  real del PC con `scripts/probar-contrato-movil.sh`.

### Compilar para la demo (IP del PC en el hotspot o Wi-Fi)

1. En el PC: `ipconfig` → «Dirección IPv4» del adaptador conectado al hotspot (p. ej. `192.168.43.20`).
2. En el `.env` del PC: `LAN_HOST=192.168.43.20` y reiniciar la API. Permitir Node en el firewall de Windows
   solo para redes privadas si lo pregunta.
3. Compilar la APK con esa IP. En PowerShell 5.1 la propiedad va **entre comillas simples** (sin comillas,
   PowerShell parte el argumento en el primer punto y Gradle recibe `192`, que se rechaza):

```powershell
& $gradle -p android --no-daemon --project-cache-dir C:/workspace/zt-android-project-cache -PztBuildRoot=C:/workspace/zt-android-build '-PztLanHost=192.168.43.20' :app:assembleDebug
```

4. En el teléfono: servidor `http://192.168.43.20:3000`, usuario y contraseña de una cuenta verificada que
   tenga un modo móvil (créalo en el escritorio con plataforma «movil»; para el 👍 asigna
   `multimedia_play_pause`, porque el `confirmar` del catálogo no existe en el teléfono).

Si la IP del PC cambia, hay que volver a compilar: la política de red de Android no admite comodines de IP.
Es HTTP en claro en una red local: válido para la demostración, no para una red pública.

## Actualización 20-11-2026: lista blanca de acciones

Además de Volver, el control admite cuatro acciones, todas a través de `GestureGate`
(palma abierta primero, gesto sostenido ≥650 ms, una acción por gesto) y de la lista blanca
`GestureActions` (cualquier otro gesto se ignora):

| Gesto (categoría MediaPipe) | Acción | Cómo la ejecuta Android |
|---|---|---|
| ✌ `Victory` | Desplazar hacia abajo | `dispatchGesture`: deslizamiento vertical en el centro |
| ☝ `Pointing_Up` | Desplazar hacia arriba | `dispatchGesture` |
| 👎 `Thumb_Down` | Volver | `GLOBAL_ACTION_BACK` |
| 👍 `Thumb_Up` | Reproducir / pausar | tecla multimedia (`AudioManager`) |

El puño ya **no** ejecuta Volver. El servicio de accesibilidad declara `canPerformGestures`.
`GestureActions.fromCatalog` traduce las asignaciones de un modo de la API (pulgares y dos dedos);
una acción que el teléfono no sabe ejecutar deja el gesto deshabilitado, nunca la sustituye.
Pruebas: `GestureGateTest` (95) y `GestureActionsTest` (38) pasan en JVM. (Compilada con el SDK
el 20-11, ver arriba; sin probar en el teléfono.)

## Qué hace

Captura Camera2 → MediaPipe GestureRecognizer local → `GestureGate` → servicio
de accesibilidad → acción de la lista blanca (Volver, desplazar, multimedia). No lee contenido
de ventanas ni ofrece comandos arbitrarios. La pantalla es una herramienta de prueba
nativa, todavía sin el diseño completo del producto.

- Arranque en observación. Activación de control explícita y con mano reciente.
- Después de activar, mantener palma abierta ≥300 ms y luego un gesto de la lista ≥650 ms con
  confianza ≥0.8. Una acción por gesto; exige otra palma para repetir.
- Son umbrales iniciales, no calibración medida. No prometen precisión o latencia.
- Pausa/parada en pantalla y notificación. Al perder mano o accesibilidad se pausa;
  el retorno de la mano no reactiva el control. Abrir ZeroTouch y pulsar reactivar.
- Resultados tardíos (>350 ms desde adquisición), discontinuidades y resultados de
  sesiones anteriores no generan acciones. Watchdog cada 150 ms; sin frames
  recientes se pausa. El reloj mide desde adquisición, no latencia física del sensor.
- Pantalla apagada/bloqueada, permiso retirado, notificación bloqueada o fallo de
  cámara/modelo detienen la sesión. No reinicia automáticamente tras muerte de proceso.
- Cámara y modelo permanecen en el servicio en primer plano al abrir otra aplicación.
  El servicio se inicia desde la actividad visible. Pausar bloquea acciones, pero
  mantiene detección; **Detener** libera cámara y modelo.
- Procesa como máximo una inferencia a la vez y descarta frames mientras está ocupado.
  Selecciona YUV de hasta 640×480; sin formato compatible falla explícitamente.
  No almacena video, imágenes, landmarks ni textos.

## Archivos y responsabilidades

| Archivo | Función |
|---|---|
| `MainActivity.java` | Permisos, accesibilidad, controles explícitos y «Actualizar modo» |
| `CameraGestureService.java` | Primer plano, notificación, watchdog, autorización, ciclo de vida y `applyActions` |
| `FrontCamera.java` | Captura, rotación/YUV, inferencia MediaPipe y liberación de recursos |
| `GestureGate.java` | Política temporal pura, épocas de sesión, estados de seguridad y `reconfigure` |
| `GestureActions.java` | Lista blanca gesto → acción y traducción del catálogo (`fromCatalog`) |
| `ApiClient.java`, `ModeLoader.java`, `MiniJson.java` | Lectura del modo móvil desde la API (Java estándar, probado en JVM) |
| `GestureAccessibilityService.java` | Acciones permitidas: Volver, desplazar y multimedia; informa pérdida del servicio |
| `tests/*Test.java`, `tests/fixtures/` | Pruebas JVM sin cámara ni acciones Android; respuestas reales de la API |
| `prepare-model.ps1` | Descarga explícita y hash del modelo real |
| `test-core.ps1` | Compila y ejecuta pruebas aisladas del núcleo |

## Entorno y compatibilidad

AGP 8.13.0; Gradle 8.14.3; JDK de ejecución utilizado: JBR 21. Código Java 17;
compile/target SDK 36. `minSdk=26` (Android 8) es una decisión del prototipo para
usar directamente canales de notificación y `startForegroundService`; MediaPipe
documenta mínimo API 24. No significa que todos los equipos con API 26 funcionen.
Debe verificarse cámara, ABI, memoria, orientación, restricciones del fabricante y
rendimiento en cada dispositivo. No se ha probado todavía el A26 ni un equipo de 2021.
La compatibilidad con páginas nativas de 16 KB también debe verificarse antes de
declarar soporte general de Android reciente.

Dependencia fijada: `com.google.mediapipe:tasks-vision:0.10.21`, no `latest.release`.
Modelo oficial `gesture_recognizer/float16/1`, 8,373,440 bytes. SHA-256:

```text
97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482
```

`verifyModel` impide compilar sin ese modelo o con otro hash. El binario se ignora
en Git; obtenerlo con `./android/prepare-model.ps1`. No hay descarga de modelos
en el teléfono ni sustitución por detección falsa.

## Comandos reproducibles (PowerShell)

Desde la raíz del repositorio:

```powershell
./android/test-core.ps1 -JavaHome "$env:USERPROFILE\.jdks\jbr-21.0.11"
./android/prepare-model.ps1

$env:JAVA_HOME = "$env:USERPROFILE\.jdks\jbr-21.0.11"
$env:ANDROID_HOME = "$env:USERPROFILE\AppData\Local\Android\Sdk"
$env:GRADLE_USER_HOME = 'C:\workspace\zt-android-gradle'
$env:GRADLE_RO_DEP_CACHE = "$env:USERPROFILE\.gradle\caches"
$gradle = "$env:USERPROFILE\.gradle\wrapper\dists\gradle-8.14.3-all\10utluxaxniiv4wxiphsi49nj\gradle-8.14.3\bin\gradle.bat"
& $gradle -p android --no-daemon --project-cache-dir C:/workspace/zt-android-project-cache -PztBuildRoot=C:/workspace/zt-android-build :app:assembleDebug
```

En otro equipo ajustar rutas. El PATH observado apunta Java a un JRE 8, por eso
se fija JAVA_HOME. El directorio corto evita problemas Windows/OneDrive con rutas
de transformaciones Gradle. Es solo caché/salida, no otro clon del código.
Sin `ztBuildRoot`, las salidas van a `android/app/build`. Con el comando anterior,
APK esperada: `C:/workspace/zt-android-build/app/outputs/apk/debug/app-debug.apk`.
La firma es de depuración y se genera en el directorio de build, no una clave de
distribución. Nunca añadir esa clave ni los APK a Git.

Si el entorno exige proxy, Gradle necesita `https.proxyHost/https.proxyPort` y sus
equivalentes HTTP, tomados del proxy configurado por el entorno; no desactivar TLS,
no guardar credenciales en el proyecto. No usar `--scan` ni publicar resultados.

## Prueba manual en el A26 (pendiente, con el usuario)

1. Registrar modelo exacto, Android/One UI, ABI y condiciones de iluminación.
2. Instalar la APK de depuración manualmente. No se instala ni habilita accesibilidad
   desde scripts. Si Android restringe ajustes de una APK externa, revisar las
   opciones del sistema conscientemente; no automatizar ni eludir esa protección.
3. Abrir ZeroTouch, conceder cámara/notificaciones y activar el servicio en ajustes
   de accesibilidad. Volver a ZeroTouch antes de iniciar captura.
4. Iniciar observación: comprobar que detecta una mano y **no** ejecuta Volver.
5. Activar control, mantener la mano en cámara y abrir una pantalla secundaria
   de Ajustes. Mostrar palma y luego 👎: comprobar un solo Volver. Mantener 👎:
   no debe seguir retrocediendo. Repetir solo tras otra palma. Probar ✌/☝ en una lista
   larga y 👍 con música o un vídeo. El puño no debe hacer nada.
5b. Modo desde la cuenta: con el PC en `LAN_HOST` y la APK compilada con esa IP, pulsar
   «Actualizar modo» con usuario y contraseña. Comprobar la lista «Gestos vigentes» y su
   origen. Con el control ACTIVO, actualizar de nuevo: debe quedar en pausa (aviso) y no
   actuar hasta reactivarlo. Apagar la API y actualizar: debe decir «No se actualizó…» y
   conservar lo anterior. Cambiar en el escritorio el 👍 a `atras`, sincronizar y actualizar
   en el teléfono: el 👍 debe pasar a Volver.
6. Probar Pausar desde notificación: gestos no deben actuar. Detener: debe cesar
   el indicador de cámara. Repetir desde el botón de la app.
7. Retirar mano, tapar cámara, revocar acceso, apagar/bloquear pantalla, girar teléfono,
   abrir otra app que use cámara, cerrar desde recientes y reiniciar el proceso:
   nunca debe reactivar control por sí solo ni ejecutar un gesto antiguo.
8. Verificar si otra app rechaza o no responde a Volver. El booleano de la API
   indica aceptación del sistema, no prueba el cambio visible de pantalla.
9. Solo tras validar seguridad, medir latencia, falsos positivos, consumo y temperatura
   durante una sesión. Repetir en un teléfono físico de aproximadamente 2021.

## Evidencia y pendientes

Núcleo: **199 aserciones JVM aprobadas** (95 + 38 + 66). Modelo descargado/verificado. APK de
depuración compilada con el SDK el 20-11-2026. No se ha instalado APK, iniciado cámara ni habilitado
accesibilidad. Ninguna prueba JVM valida la detección real, la red del teléfono ni el ciclo de vida Android.

Faltan prueba física, calibración/rendimiento, adaptación visual, activación contextual (acelerómetro)
y escribir en la cuenta desde el teléfono (es solo lectura a propósito). Cambios en contratos compartidos
(`contracts/capacidades.json`, API) deben reflejarse en `GestureActions` y en `docs/movil-contrato.md`.

## Referencias oficiales (APA 7)

Android Developers. (s. f.). *Camera preview*. Recuperado el 11 de noviembre de 2026, de https://developer.android.com/media/camera/camera2/camera-preview

Android Developers. (s. f.). *Foreground service types*. Recuperado el 11 de noviembre de 2026, de https://developer.android.com/develop/background-work/services/fgs/service-types

Android Developers. (s. f.). *AccessibilityService*. Recuperado el 11 de noviembre de 2026, de https://developer.android.com/reference/android/accessibilityservice/AccessibilityService

Android Developers. (s. f.). *Android Gradle Plugin 8.13.0*. Recuperado el 11 de noviembre de 2026, de https://developer.android.com/build/releases/agp-8-13-0-release-notes

Android Developers. (s. f.). *Support 16 KB page sizes*. Recuperado el 11 de noviembre de 2026, de https://developer.android.com/guide/practices/page-sizes

Google AI Edge. (s. f.). *Setup guide for Android*. Recuperado el 11 de noviembre de 2026, de https://developers.google.com/edge/mediapipe/solutions/setup_android

Google AI Edge. (s. f.). *Gesture Recognizer*. Recuperado el 11 de noviembre de 2026, de https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer

Implementación asistida por Codex. Revisión humana y validación física pendientes.
