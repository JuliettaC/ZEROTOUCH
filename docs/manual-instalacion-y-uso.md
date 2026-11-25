# Manual de instalación y uso de ZeroTouch (Hito 3)

Este manual permite instalar ZeroTouch en Windows desde cero y repetir por su cuenta el recorrido principal del Hito 3: iniciar sesión, cambiar un ajuste en la interfaz, guardarlo en el servidor y comprobar que quedó en la base de datos SQLite. Incluye también cómo recuperar el servicio ante una caída, respaldar y restaurar la base, y una demostración breve con cámara.

Los comandos y los resultados se ejecutaron y comprobaron el 24-11-2026 en una copia limpia de los archivos de esta entrega (sin `node_modules`, sin entorno de Python y sin compilación previa), no en el equipo de desarrollo. Lo que no se pudo comprobar se indica como tal. Las secciones que en un despliegue en un servidor remoto tendrían contenido, pero que en esta entrega no aplican, lo dicen de forma expresa y explican por qué.

## Contenido

| N.º | Sección |
|---|---|
| 1 | Resumen del sistema |
| 2 | Acceso al servidor |
| 3 | Credenciales y contraseñas |
| 4 | Cuentas de la aplicación |
| 5 | Arquitectura y diseño |
| 6 | Dominio y direcciones |
| 7 | Levantar el servicio (desde cero) |
| 8 | Recuperación ante caída |
| 9 | Sistema de respaldos |
| 10 | Restaurar desde un respaldo |
| 11 | Correo |
| 12 | Seguridad |
| 13 | Comandos rápidos |
| 14 | Cuentas y proveedores externos |
| 15 | Uso: recorrido principal |
| 16 | Demostración gestual (necesita cámara) |
| 17 | Cerrar todo correctamente |
| 18 | Verificación automática |
| 19 | Problemas conocidos |
| 20 | Límites conocidos |

## 1. Resumen del sistema

ZeroTouch permite controlar Windows con gestos de la mano frente a una cámara web común: mover el cursor, hacer clic, arrastrar, desplazar, pausar, cambiar de ventana, abrir una pestaña nueva y escribir con trazos en el aire. Está pensado para personas que hacen tareas manuales (cocina, taller) mientras consultan información en el computador.

Se compone de cuatro partes que corren **todas en el mismo equipo**:

| Parte | Tecnología | Qué hace |
|---|---|---|
| Aplicación de escritorio | Tauri 2 (Rust) y React 19 | Interfaz, ajustes, cuenta y sincronización |
| Motor de gestos | Python 3.11, MediaPipe, OpenCV | Lee la cámara, reconoce gestos y mueve el ratón |
| Servidor (backend) | Node 24, Express 5 | Cuentas, perfiles, modos y asignaciones de gestos (API en `/api/v1`) |
| Base de datos | SQLite, esquema v4 | Guarda lo que el servidor recibe |

El servidor y la cuenta solo sirven para sincronizar perfiles y modos. **Los gestos funcionan sin servidor**: si el servidor no está, la aplicación trabaja en «Modo Local».

**Qué parte necesita cámara:**

| Parte del recorrido | Cámara |
|---|---|
| Instalación, servidor, cuenta, cambio de ajuste, guardado en SQLite, recarga, respaldos | No |
| Demostración gestual (sección 16) | Sí, una cámara web común |

Sin cámara puede completar todas las secciones menos la 16.

## 2. Acceso al servidor

**No aplica en esta entrega.** No hay un servidor remoto ni acceso por SSH: el servidor es un proceso de Node que se inicia a mano en el mismo equipo donde está la aplicación, escucha solo en `127.0.0.1` y no se abre a la red. «Acceder al servidor» es abrir una ventana de PowerShell en ese equipo, en la carpeta del repositorio.

El servidor se niega a escuchar en otra dirección (`HOST debe ser loopback; despliegue remoto pendiente`), de modo que no se puede exponer por error. El despliegue remoto está pendiente (sección 20).

## 3. Credenciales y contraseñas

- **No hay credenciales predeterminadas ni cuentas del autor.** El servidor no trae ninguna cuenta ni contraseña de administración: la base nueva se crea vacía. Cada persona crea su propia cuenta (sección 4).
- **El archivo `.env`** (se crea a partir de `.env.example`) contiene solo la ruta de la base, el puerto, la dirección y el modo de correo. No contiene contraseñas en esta configuración y **no se sube a Git** (está en `.gitignore`). Si en el futuro se usara correo real (sección 11), la contraseña SMTP se escribiría solo en `.env`, nunca en `.env.example`.
- **Contraseñas de las cuentas:** mínimo 8 caracteres. El servidor solo guarda un resumen irreversible (Argon2id); la contraseña original no se almacena ni se muestra en ningún comando de este manual.
- **Enlaces de confirmación:** el enlace del correo contiene un token de un solo uso que vence en 24 horas. Se imprime únicamente con `correo:enlace` (sección 4) y solo funciona con la demostración (correo guardado como archivo).
- Elija una contraseña de prueba que no use en ningún otro servicio.

## 4. Cuentas de la aplicación

Hay tres situaciones posibles:

1. **Sin cuenta (invitado).** La aplicación funciona en Modo Local: gestos, ajustes y modos se guardan en el equipo. No sincroniza.
2. **Cuenta de usuario.** Permite sincronizar perfiles y modos con el servidor. Es la que se usa en el recorrido de este manual.
3. **Cuenta de administración (opcional).** La base nueva no tiene ninguna. Se crea con `npm run admin:bootstrap --prefix backend`, que exige una terminal interactiva (pide nombre, correo y contraseña sin mostrarla) y envía el enlace de verificación. **No se ejecutó en la preparación de este manual** y el recorrido no la necesita.

### Preparar una cuenta de prueba verificada

Haga esto **después** de la sección 7, con el servidor y la aplicación en marcha. El profesor crea su propia cuenta; no se usa ninguna cuenta ni credencial del autor.

1. En la aplicación, pulse **Ajustes** (el icono de controles deslizantes de la barra izquierda) y luego el icono de cuenta de la parte inferior de esa barra («Mi cuenta»). Se abre el cuadro **Entrar**.
2. Pulse **Crear cuenta** (al pie del cuadro). Escriba un usuario (3 a 40 letras, números o guiones bajos, por ejemplo `profesor_demo`), un correo cualquiera con formato válido (por ejemplo `profesor@ejemplo.test`; no se envía nada real) y una contraseña de al menos 8 caracteres. Pulse **Crear cuenta**.
3. Debe ver «Confirma tu correo» y el mensaje «Te enviamos un enlace para activar tu cuenta». La cuenta queda pendiente.
4. En una ventana de PowerShell **distinta de la del servidor**, imprima el enlace de confirmación (con el mismo correo que escribió):

```powershell
npm run correo:enlace --prefix backend -- profesor@ejemplo.test
```

Debe ver `Correo para profesor@ejemplo.test:` seguido de una dirección `http://127.0.0.1:3000/cuenta/verificar#token=...`. El enlace vence en 24 horas y sirve una sola vez. (También se puede obtener abriendo el `.eml` de la carpeta `correo-saliente`, pero ahí el enlace aparece partido en dos líneas; el comando lo entrega completo.)

5. Copie esa dirección en el navegador y pulse **Confirmar mi correo**. Debe ver «Correo confirmado. Tu cuenta ya está activa.»
6. Vuelva a la aplicación, pulse **Entrar** (al pie del cuadro de cuenta) y escriba usuario y contraseña. Debe aparecer «Sesión iniciada» y el icono de cuenta muestra su usuario.

**Datos de la demostración.** No hay que cargar datos. La aplicación trae un perfil, **Perfil principal**, con tres modos: **Cocina y Taller**, **Desk-Rest Ergonómico** y **Asistencia Motriz**. Se crean en el servidor la primera vez que usted pulsa **Sincronizar** (sección 15).

## 5. Arquitectura y diseño

```
Cámara ─► motor-local (Python) ─► Windows (ratón, teclas)
               ▲   │ JSON-lines (comandos con ACK, telemetría, eventos)
               │   ▼
           desktop (Tauri 2, Rust) ◄─► src (React 19): Inicio · Gestos · Ajustes · Teclado
               │ HTTP con cookie y CSRF (solo cuentas y sincronización)
               ▼
           backend (Node 24, Express 5, SQLite) — /api/v1
```

- **El motor nunca depende del servidor.** Lo lanza la aplicación como proceso hijo, comparte con ella mensajes de texto con confirmación por comando y arranca siempre en modo Observar.
- **Qué se sincroniza y qué no.** Los ajustes **del modo** (velocidad, suavizado, pinza, Desk-Rest, asistencia por mirada) y las asignaciones de gestos viajan al servidor. Los ajustes **del equipo** (mano, cámara, espejo, recorrido, exigencia de detección, calibraciones) se quedan en cada equipo.
- **Modelo de datos.** Cuentas, perfiles, modos y asignaciones por gesto; el catálogo tiene 8 gestos. SQLite de 9 tablas (esquema v4). La versión de cada modo sube en cada cambio y permite detectar ediciones desde otro equipo: nunca se sobrescribe en silencio.
- **Dónde está cada cosa en disco:**

| Qué | Dónde |
|---|---|
| Código y aplicación compilada | La carpeta del repositorio; el ejecutable queda en `desktop\target\debug\zerotouch-desktop.exe` |
| Base de datos (cifrada) | `DATABASE_PATH` de `.env`, fuera del repositorio y de OneDrive; su clave es `DATABASE_KEY` del mismo `.env` |
| Correos de confirmación | `correo-saliente`, junto a la base |
| Preferencias locales de la interfaz | Perfil de WebView2 de la aplicación (en su usuario de Windows) |

- No se guardan video, puntos de la mano ni texto escrito.

## 6. Dominio y direcciones

**No aplica en esta entrega.** No hay dominio, DNS ni HTTPS. Todo se comunica por `http://127.0.0.1:3000` (el puerto lo define `PORT` en `.env`, por defecto 3000). La aplicación de escritorio se conecta por defecto a esa dirección y solo acepta direcciones de este mismo equipo. `APP_ORIGIN` (en `.env`) es la dirección que se escribe en los enlaces de los correos de confirmación.

## 7. Levantar el servicio (desde cero)

### 7.1 Requisitos

**Sistema.** Windows 10 u 11 de 64 bits con WebView2 (viene incluido en Windows 11 y en las versiones actualizadas de Windows 10). Los resultados de este manual se obtuvieron en Windows 11 Home.

**Herramientas.** Versiones con las que se probó:

| Herramienta | Versión probada | Para qué |
|---|---|---|
| Git | cualquier versión reciente | Descargar el código |
| Node.js | 24.19.0 (el backend exige 24.x) | Interfaz y servidor |
| npm | 11.17.0 (incluido con Node) | Dependencias |
| Python | 3.11.9 (use 3.11: MediaPipe 0.10.13 está fijado para esa versión y no se probó con otras) | Motor de gestos |
| Rust (rustup, toolchain MSVC) | 1.99.0 | Aplicación de escritorio |
| Build Tools de Visual Studio, carga de trabajo «Desarrollo para el escritorio con C++» | las que pide rustup | Compilar Rust en Windows |

No se pudo comprobar la instalación de estas herramientas en un Windows que no las tenga. Se supone la instalación habitual de cada una desde su sitio oficial. Compruebe las versiones antes de seguir:

```powershell
git --version
node --version
npm --version
python --version
cargo --version
```

Debe ver Node `v24.x`, Python `3.11.x` y un número de versión de cargo. Si `python --version` muestra otra versión y tiene el lanzador `py`, use `py -3.11` en lugar de `python` en el paso 7.3.

**Espacio y tiempo.** La primera compilación descarga dependencias y tarda unos 4 a 5 minutos en cargo, más unos 4 minutos de `npm ci` y `pip install` (medido en este equipo con buena conexión; varía según la red). Reserve unos 4 GB de disco: la carpeta `desktop\target` ocupa unos 2,3 GB tras compilar, y el entorno de Python y `node_modules` el resto.

**Red.** Solo hace falta para descargar dependencias durante la instalación. Después el servidor y la aplicación funcionan solo en `127.0.0.1` y no se envía imagen ni datos de la cámara a ningún lado.

**Permisos.** No se necesitan permisos de administrador para ejecutar ZeroTouch. La cámara tiene que estar permitida para aplicaciones de escritorio en Configuración de Windows, en Privacidad y seguridad, Cámara (ajuste general de Windows; no se pudo comprobar en este equipo). En modo Controlar el motor mueve el ratón real y pulsa teclas: lea la sección 16 antes de activarlo.

### 7.2 Obtener el código

Abra PowerShell en la carpeta donde quiera guardar el proyecto. El código puede estar en cualquier lugar; la base de datos no puede estar en OneDrive (ver 7.4).

```powershell
git clone https://github.com/JuliettaC/ZEROTOUCH.git
cd ZEROTOUCH
```

Rama: use `main`. Si la entrega todavía no estuviera integrada en `main`, cambie a la rama indicada por la persona que le entregó el proyecto (la versión probada para este manual está en `feat/rediseno-frontend`):

```powershell
git checkout feat/rediseno-frontend
```

Todos los comandos siguientes se ejecutan desde la carpeta raíz del repositorio, la que contiene `package.json`, salvo que se indique otra cosa.

### 7.3 Instalar dependencias

```powershell
npm ci
npm ci --prefix backend
python -m venv motor-local\.venv
motor-local\.venv\Scripts\python.exe -m pip install -r motor-local\requirements-dev.txt
```

Qué debe ver cuando funciona:

- `npm ci` termina con un resumen de paquetes (puede mostrar avisos de `npm audit`; no son errores).
- `npm ci --prefix backend` puede mostrar el aviso `allow-scripts ... argon2 ... better-sqlite3-multiple-ciphers`. Es solo informativo de npm 11: ambos paquetes funcionan (se comprobó que cargan y que el servidor arranca). No ejecute `npm approve-scripts`.
- `pip install` termina sin la palabra `ERROR`. Para comprobarlo:

```powershell
motor-local\.venv\Scripts\python.exe -m pip list
```

Debe aparecer `mediapipe 0.10.13`, `numpy 2.4.6`, `opencv-contrib-python 5.0.0.93`, `pynput 1.8.2` y `pytest 8.4.2`.

### 7.4 Configurar el servidor y crear la base de datos SQLite

La base de datos debe estar en una carpeta local **fuera del repositorio y fuera de OneDrive**. El servidor lo exige y se niega a usar otra ruta.

1. Copie el archivo de configuración de ejemplo y ábralo:

```powershell
Copy-Item .env.example .env
notepad .env
```

2. Cambie solo la línea `DATABASE_PATH`. Use una ruta absoluta con barras normales (`/`) y su nombre de usuario de Windows, por ejemplo:

```text
DATABASE_PATH=C:/Users/SU_USUARIO/AppData/Local/ZeroTouch/zerotouch.sqlite
```

3. Genere la clave de cifrado de la base:

```powershell
npm run db:clave --prefix backend
```

Imprime una línea `DATABASE_KEY=` seguida de 64 caracteres hexadecimales. Cópiela completa en `.env`, reemplazando la línea `DATABASE_KEY=` vacía, y guarde el archivo. La base se cifra con esa clave (ChaCha20-Poly1305, 256 bits): sin ella el archivo no se puede leer y el servidor no arranca. **Si la pierde, la base y sus respaldos no se pueden recuperar**: guarde una copia aparte (por ejemplo, en un gestor de contraseñas) y nunca la suba a Git ni la escriba en `.env.example`.

Las demás líneas pueden quedar como están (servidor en `127.0.0.1`, puerto 3000, correo guardado como archivo).

4. Cree la base nueva (la carpeta se crea sola si no existe):

```powershell
npm run db:init --prefix backend
```

Debe ver: `Base nueva (esquema v4: nueve tablas) inicializada y cifrada con DATABASE_KEY. No se crearon cuentas.`

Comportamientos comprobados, para tranquilidad sobre datos existentes:

- Si la base ya existe, el comando la deja intacta y responde `La base ya existe; no se modificó.` Nunca borra ni reinicializa una base.
- Si `DATABASE_PATH` apunta dentro del repositorio o de OneDrive, responde `DATABASE_PATH debe estar fuera del repositorio, OneDrive y unidades de red.` y no crea nada.
- Si falta `DATABASE_KEY` o no tiene 64 caracteres hexadecimales, ningún comando abre la base y el mensaje indica cómo generar una. Con una clave que no corresponde a la base responde `No se pudo abrir la base con DATABASE_KEY` (el mensaje no muestra la clave).
- Una base creada **antes del cifrado** (25-11-2026) no abre con la clave. Con el servidor detenido se convierte con `npm run db:cifrar --prefix backend`: hace una copia, la cifra, comprueba que tiene las mismas filas y solo entonces la pone en su lugar. El original sin cifrar queda como `zerotouch.sqlite.sin-cifrar-<fecha>.ztbackup`. Bórrelo usted cuando compruebe que la aplicación inicia sesión y sincroniza, porque contiene los datos en claro.
- Una base creada con una versión anterior (esquema v1, v2 o v3) no se migra sola. Para actualizarla, con respaldo previo automático (sección 9), se ejecuta `npm run db:migrate --prefix backend`. En el paso de v3 a v4 se eliminan del catálogo los gestos retirados el 24-11-2026. Para este manual no hace falta: use una base nueva.

### 7.5 Compilar la aplicación de escritorio

Una sola vez, o después de cambiar el código:

```powershell
npm run desktop:build
```

Debe terminar con `Finished dev profile` y crear `desktop\target\debug\zerotouch-desktop.exe`. La primera vez tarda varios minutos. No hay instalador: la aplicación se ejecuta desde ese archivo y debe quedarse dentro de la carpeta del repositorio, porque ahí busca el motor de gestos (`motor-local`).

### 7.6 Iniciar el servidor y la aplicación

**Servidor.** Abra una primera ventana de PowerShell en la carpeta raíz:

```powershell
npm start --prefix backend
```

Debe ver `ZeroTouch API lista en puerto 3000`. Deje esa ventana abierta.

**Comprobar que el servidor está disponible.** En una segunda ventana de PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health | ConvertTo-Json -Compress
```

Debe ver `{"data":{"estado":"ok","servicio":"ZeroTouch API"}}`.

**Aplicación** (en esa segunda ventana, o con doble clic en el archivo):

```powershell
.\desktop\target\debug\zerotouch-desktop.exe
```

Debe abrirse la ventana «ZEROTOUCH». La primera vez muestra «Configuración inicial» (cinco pasos para cámara y gestos). Para el recorrido sin cámara pulse **Saltar configuración**: queda la página **Inicio** con un solo botón, **Iniciar cámara**. Esa pantalla se puede repetir después desde Ajustes.

## 8. Recuperación ante caída

Qué ocurre y qué hacer si algo se detiene. Lo marcado como «comprobado» se verificó en la preparación de este manual.

| Falla | Qué pasa | Qué hacer | Estado |
|---|---|---|---|
| El servidor se cierra o se reinicia | La aplicación sigue funcionando en Modo Local; los datos guardados no se pierden | Volver a ejecutar `npm start --prefix backend` sobre la misma base. La sesión de la aplicación sigue válida y **Sincronizar** responde «Todo estaba al día.» | Comprobado (`verify:hito3`) |
| La aplicación se cierra | Los datos del servidor no cambian; los ajustes del equipo se conservan | Abrirla de nuevo y entrar otra vez con usuario y contraseña (la sesión no sobrevive al cierre de la aplicación). No vuelve a aparecer la configuración inicial | Comprobado |
| El motor no puede abrir la cámara | El control se niega a activarse y no se mueve nada | Ver el problema 19.3 | Comprobado (`verify:tauri`) |
| La base de datos se daña o se pierde | El servidor no inicia o los datos faltan | Restaurar el último respaldo (secciones 9 y 10) | Procedimiento comprobado con una base de prueba |
| Corte de luz o cierre brusco del servidor | Un cierre brusco puede dejar archivos auxiliares `-wal` y `-shm` junto a la base | Reiniciar el servidor y comprobar con `npm run db:modos --prefix backend`; si falla, restaurar el último respaldo | **No se probó un corte brusco** |

Regla general: nada de esto borra datos por sí solo. Los comandos de este manual nunca eliminan ni reinicializan una base existente.

## 9. Sistema de respaldos

**No hay respaldo automático programado.** Existen dos mecanismos:

1. **Respaldo automático antes de migrar.** `npm run db:migrate --prefix backend` crea una copia consistente de la base junto a ella (`zerotouch.sqlite.v<versión>-<fecha>.ztbackup`) **antes** de cambiar nada, y aplica la migración en una sola transacción: si falla, la base queda como estaba. La copia queda cifrada con la misma `DATABASE_KEY`. Está cubierto por pruebas automáticas.
2. **Respaldo manual.** Con el servidor **detenido**, la base es un único archivo `.sqlite` (se comprobó que al cerrar el servidor desaparecen los archivos `-wal` y `-shm`), así que copiarlo es un respaldo completo. Con el servidor en marcha la base tiene también esos dos archivos auxiliares: no copie solo el `.sqlite` en ese momento.

Procedimiento del respaldo manual (ajuste la ruta a la de su `DATABASE_PATH`):

```powershell
# 1. Detenga el servidor (Ctrl+C en su ventana; si pregunta por el trabajo por lotes, responda S)
# 2. Copie la base a una carpeta de respaldos
$base = "C:\Users\SU_USUARIO\AppData\Local\ZeroTouch\zerotouch.sqlite"
New-Item -ItemType Directory -Force "$env:USERPROFILE\ZeroTouchRespaldos" | Out-Null
Copy-Item $base "$env:USERPROFILE\ZeroTouchRespaldos\zerotouch-$(Get-Date -Format yyyyMMdd-HHmm).sqlite"
# 3. Vuelva a iniciar el servidor: npm start --prefix backend
```

Los respaldos quedan cifrados como la base: solo se leen con la misma `DATABASE_KEY`. Guarde la clave **aparte** de los respaldos (por ejemplo, en un gestor de contraseñas), porque quien tenga ambos puede leerlos y sin la clave no sirven. El archivo `.env` contiene esa clave: no lo suba a Git ni lo copie junto a los respaldos.

## 10. Restaurar desde un respaldo

Se comprobó con una base de prueba, antes del cifrado: se creó una cuenta con un modo en 55, se detuvo el servidor, se copió la base, se borró la original, se restauró la copia, y al iniciar de nuevo el servidor el inicio de sesión funcionó y el modo seguía en 55. Con la base cifrada el procedimiento es el mismo, y `DATABASE_KEY` debe ser la clave con la que se creó el respaldo.

```powershell
# 1. Detenga el servidor.
# 2. Aparte la base dañada, con sus archivos auxiliares, en lugar de borrarla
$carpeta = "C:\Users\SU_USUARIO\AppData\Local\ZeroTouch"
$apartada = "$carpeta\danada-$(Get-Date -Format yyyyMMdd-HHmm)"
New-Item -ItemType Directory $apartada | Out-Null
Move-Item "$carpeta\zerotouch.sqlite*" $apartada
# 3. Copie el respaldo elegido con el nombre que espera DATABASE_PATH
Copy-Item "$env:USERPROFILE\ZeroTouchRespaldos\zerotouch-AAAAMMDD-HHMM.sqlite" "$carpeta\zerotouch.sqlite"
# 4. Inicie el servidor
npm start --prefix backend
```

Para comprobar que se resolvió, en otra ventana:

```powershell
npm run db:modos --prefix backend -- profesor_demo
```

Debe mostrar sus modos con los valores del respaldo, e **Entrar** en la aplicación debe volver a dar «Sesión iniciada». Los cambios hechos después del respaldo se pierden; si todavía los tiene en la aplicación, **Sincronizar** los vuelve a subir.

Para volver a una base anterior a una migración fallida use el archivo `.ztbackup` con el mismo procedimiento (es un archivo SQLite cifrado con la misma clave; las pruebas automáticas lo abren y leen, pero no se probó restaurar uno real).

## 11. Correo

**No aplica un correo corporativo en esta entrega.** Los mensajes de confirmación de cuenta no se envían: el servidor los guarda como archivos `.eml` en la carpeta `correo-saliente` junto a la base (`MAIL_TRANSPORT=archivo`, el valor por defecto fuera de producción). El comando `correo:enlace` (sección 4) entrega el enlace sin necesidad de abrir esos archivos.

El servidor también admite envío real por SMTP con TLS (`MAIL_TRANSPORT=smtp` con las variables `MAIL_SMTP_*` y `MAIL_FROM` de `.env.example`) y en producción lo exige. **No se configuró ni se probó** en esta entrega.

## 12. Seguridad

Qué protege el sistema hoy, con lo que se pudo comprobar:

- **Solo local.** El servidor escucha únicamente en `127.0.0.1` (rechaza otra dirección) y la aplicación solo acepta direcciones de su propio equipo.
- **Datos fuera del repositorio.** La base debe estar fuera del repositorio, de OneDrive y de unidades de red; `.env` y los archivos `.sqlite` están en `.gitignore`.
- **Base cifrada en reposo.** El archivo SQLite, su WAL y los respaldos de migración se cifran completos con SQLite3 Multiple Ciphers (ChaCha20-Poly1305) y una clave de 256 bits (`DATABASE_KEY`). Las pruebas automáticas comprueban que el archivo no contiene texto legible y que no abre sin la clave ni con otra. La clave vive en `.env`, en el mismo equipo: el cifrado protege una copia del archivo de la base o de un respaldo, no a alguien que ya controla la cuenta de Windows.
- **Contraseñas y sesiones.** Resumen Argon2id; cookie de sesión `HttpOnly` y `SameSite=Strict`; protección CSRF en cada cambio; enlaces de confirmación de un solo uso que vencen en 24 horas.
- **Cabeceras de respuesta.** El servidor responde con `Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` y `Cache-Control: no-store`, entre otras.
- **El motor no ejecuta comandos.** Solo emite las teclas de una lista fija y, con el teclado en pantalla abierto, texto imprimible. Arranca en Observar; Controlar exige cámara abierta y `Ctrl+Alt+Z` activo.
- **Privacidad.** No se guardan video, puntos de la mano ni texto escrito, y no sale ninguna imagen del equipo.

No se aplicó ningún endurecimiento específico de un servidor (cortafuegos, certificados, actualizaciones del sistema) porque no hay servidor expuesto. La revisión detallada, con sus pendientes, está en [docs/hito2/auditoria-seguridad.md](hito2/auditoria-seguridad.md) (10-11-2026, anterior a esta entrega).

## 13. Comandos rápidos

Se ejecutan en PowerShell desde la carpeta raíz del repositorio.

| Para qué | Comando |
|---|---|
| Generar la clave de cifrado (una vez, para `.env`) | `npm run db:clave --prefix backend` |
| Crear la base nueva (cifrada) | `npm run db:init --prefix backend` |
| Cifrar una base creada antes del cifrado | `npm run db:cifrar --prefix backend` |
| Iniciar el servidor | `npm start --prefix backend` |
| Detener el servidor | `Ctrl+C` en su ventana |
| Comprobar el servidor | `Invoke-RestMethod http://127.0.0.1:3000/api/v1/health` |
| Compilar la aplicación | `npm run desktop:build` |
| Abrir la aplicación | `.\desktop\target\debug\zerotouch-desktop.exe` |
| Imprimir el enlace de confirmación | `npm run correo:enlace --prefix backend -- correo@ejemplo.test` |
| Ver lo guardado en SQLite | `npm run db:modos --prefix backend -- usuario` |
| Actualizar una base antigua (con respaldo) | `npm run db:migrate --prefix backend` |
| Respaldar y restaurar la base | Secciones 9 y 10 |
| Recorrido de comprobación con la aplicación real | `npm run verify:hito3` |
| Comprobación del motor, ventanas y sincronización | `npm run verify:tauri` |
| Pruebas del servidor | `npm test --prefix backend` |
| Pruebas de la interfaz | `node --test "tests/frontend/*.test.js"` |
| Pruebas del motor | `motor-local\.venv\Scripts\python.exe -m pytest motor-local\tests` |
| Parada de emergencia del control gestual | `Ctrl+Alt+Z` |

## 14. Cuentas y proveedores externos

**No se necesita ninguna cuenta de proveedor** para instalar ni usar ZeroTouch: no hay nube, servidor alquilado, dominio, correo corporativo, pasarela de pago ni clave de API. Solo hay descargas durante la instalación:

| Origen | Para qué | Cuenta |
|---|---|---|
| GitHub (repositorio `JuliettaC/ZEROTOUCH`) | Descargar el código | Solo si el repositorio es privado |
| Registro de npm | Dependencias de Node | No |
| PyPI | Dependencias del motor (MediaPipe, OpenCV, etc.) | No |
| crates.io y rustup | Dependencias y herramientas de Rust | No |
| Microsoft (Build Tools de Visual Studio, WebView2) | Compilar y mostrar la interfaz | No |

## 15. Uso: recorrido principal

El ajuste que se cambia es **Velocidad del cursor** del modo **Cocina y Taller**, de 70 a 55. Es un ajuste del modo, así que viaja al servidor; la cámara, la mano y el recorrido son de cada equipo y no se sincronizan. Necesita el servidor y la aplicación en marcha (7.6) y la cuenta verificada (sección 4).

Importante: haga todo el recorrido en el mismo equipo y con la cuenta nueva. Si usara la misma cuenta desde otra instalación de la aplicación que ya tuviera su propio «Perfil principal», la aplicación pediría una decisión («Ya existe en tu cuenta un perfil llamado «Perfil principal»») para no mezclar datos; con **Subir con otro nombre** se conservan ambos perfiles sin sobrescribir nada.

| Paso | Qué hacer | Qué debe ver |
|---|---|---|
| 1 | Con la sesión iniciada, pulse el icono de cuenta y luego **Sincronizar** | `Sincronizado: 4 creados.` (un perfil y tres modos subidos al servidor). Cierre el cuadro |
| 2 | En una ventana de PowerShell, en la carpeta raíz: `npm run db:modos --prefix backend -- profesor_demo` (con su usuario) | Una tabla con los tres modos. «Cocina y Taller»: sensibilidad `70`, versión `1` |
| 3 | En la aplicación, abra **Gestos** (el icono de la mano), baje a **Ajustes finos (opcional)**, ábralo y mueva **Velocidad del cursor** hasta `55%` | El valor muestra `55%` y el modo indicado es «Cocina y Taller». Se guarda de inmediato en este equipo |
| 4 | Pulse el icono de cuenta y **Sincronizar** | `Sincronizado: 1 actualizado.` |
| 5 | Repita `npm run db:modos --prefix backend -- profesor_demo` | «Cocina y Taller»: sensibilidad `55`, versión `2`. Este valor sale directamente del archivo SQLite |
| 6 | En la ventana del servidor pulse `Ctrl+C` (si pregunta «¿Desea terminar el trabajo por lotes?», responda `S`). Vuelva a iniciarlo con `npm start --prefix backend` | `ZeroTouch API lista en puerto 3000` otra vez, sobre la misma base |
| 7 | Repita `npm run db:modos --prefix backend -- profesor_demo` | Sigue `55`, versión `2`: el dato sobrevivió al cierre del servidor |
| 8 | En la aplicación, **Sincronizar** de nuevo | `Todo estaba al día.` (la sesión también sobrevive al reinicio del servidor) |
| 9 | Cierre la aplicación con la X de la ventana y ábrala de nuevo. Pulse el icono de cuenta, **Entrar** con su usuario y contraseña, y abra **Gestos** y **Ajustes finos** | **Velocidad del cursor** muestra `55%` |

### Qué demuestra cada tramo y qué no

- Pasos 1 a 5: el cambio sale de la interfaz, llega a la API y queda guardado en SQLite. El paso 5 lee el archivo directamente, no pasa por la interfaz.
- Pasos 6 y 7: el servidor se cierra y se abre de nuevo sobre la misma base y recupera el valor.
- Paso 9: tras reabrir, el valor mostrado coincide con el del servidor, pero la aplicación también lo conserva en el almacenamiento local de este equipo. Por sí solo, ese paso **no** prueba que el valor se haya leído del servidor. La prueba de origen está en la verificación automática (sección 18): allí un cambio hecho solo en el servidor (58, mediante la API desde «otro equipo») no aparece en pantalla hasta pulsar **Sincronizar**, y después se muestra y se mantiene tras recargar.

## 16. Demostración gestual (necesita cámara)

Esta parte no pudo ejecutarse en la preparación de este manual (no hay cámara ni manos en el entorno de verificación): lo que sigue es el procedimiento y el resultado esperado según el diseño y las pruebas automáticas, no una observación. Lea primero la seguridad.

**Seguridad.** En modo Controlar el motor mueve el ratón real de su equipo. Antes de empezar, cierre o guarde cualquier trabajo y abra solo un Bloc de notas vacío. Formas de detenerlo, de la más rápida a la más drástica:

1. `Ctrl` + `Alt` + `Z`: parada de emergencia (suelta los botones, vuelve a Observar y pausa).
2. Retirar la mano de la cámara: sin mano no llegan órdenes.
3. El ratón físico siempre funciona.
4. Puño sostenido: pausa.
5. Botón **Detener**: apaga la cámara y el motor.

El motor siempre arranca en Observar y solo pasa a Controlar con la orden explícita **Activar control**; el control se niega si la cámara no está abierta o si Windows no deja registrar `Ctrl+Alt+Z`.

**Procedimiento.** Cámara web a 50 a 70 cm, buena luz de frente, la mano sola frente a la cámara.

1. En **Inicio**, pulse **Iniciar cámara**. Esperado: se enciende la luz de la cámara, el estado pasa a «Observando» («Prueba sin mover el cursor») y la vista previa dibuja puntos sobre su mano. El cursor de Windows no se mueve.
2. Pulse **Activar control**. Esperado: la ventana se minimiza y queda un indicador flotante con el estado. Estado «Control activo»: «Mantén la mano abierta un momento para activar el puntero».
3. Muestre la mano abierta un instante y muévala despacio. Esperado: el cursor sigue su mano («Controlando el cursor»).
4. Gesto de la demostración, **puño sostenido medio segundo**: pausa («En pausa»); otro puño reanuda. Es el gesto de seguridad. Su umbral se ajustó con grabaciones del equipo del proyecto y un banco sintético; no hay cifras de acierto medidas con otras personas.
5. Detenga con `Ctrl` + `Alt` + `Z`. Esperado: el control se detiene y la aplicación muestra «Parada de emergencia: el control se detuvo. Apaga y vuelve a activar la cámara.» Abra la ventana (barra de tareas o `Alt` + `Tab`) y pulse **Detener**: «Cámara apagada», luz de la cámara apagada.

Las pruebas automáticas (`npm run verify:tauri`, sección 18) comprueban sin cámara que el motor arranca en Observar, que se niega a pasar a Controlar si la cámara no abre y que no queda ningún proceso del motor al cerrar la aplicación.

### Evidencia que conviene guardar de esta demostración

- Captura de **Inicio** con el estado «Observando» y los puntos sobre la mano.
- Captura del indicador flotante con «Control activo» o «Controlando el cursor».
- Captura o breve nota del paso del puño: «En pausa» y de nuevo activo.
- Captura de la aplicación tras `Ctrl+Alt+Z` («Parada de emergencia») y de **Inicio** con «Cámara apagada».
- Captura del Administrador de tareas, pestaña Detalles, sin `python.exe` ni `zerotouch-desktop.exe` al terminar.
- Una línea con las condiciones: cámara usada, distancia, luz, y cuántas veces el puño pausó de las que lo intentó (por ejemplo, «4 de 5»).

## 17. Cerrar todo correctamente

1. Si el control está activo, deténgalo con `Ctrl` + `Alt` + `Z` o con **Detener** en **Inicio**.
2. Cierre la aplicación con la X de la ventana. Cierra también el indicador flotante y el motor. Compruebe en el Administrador de tareas que no queda `zerotouch-desktop.exe` ni un `python.exe` del motor.
3. En la ventana del servidor pulse `Ctrl+C` (responda `S` si pregunta por el trabajo por lotes). El servidor cierra la conexión y la base de forma ordenada. Para comprobar que ya no responde: `Invoke-RestMethod http://127.0.0.1:3000/api/v1/health` debe fallar con un error de conexión.

La base queda en la ruta de `DATABASE_PATH` y conserva sus datos para la próxima vez. Para empezar de cero basta con elegir otra ruta en `.env` y volver a ejecutar `npm run db:init --prefix backend`; no hay que borrar nada.

## 18. Verificación automática

Con la aplicación compilada y **sin** ninguna instancia de ZeroTouch abierta, estas pruebas usan una base temporal, un perfil de WebView2 temporal y no abren la cámara:

```powershell
npm run verify:hito3
npm run verify:tauri
```

`verify:hito3` recorre con la aplicación real los pasos de la sección 15 y la prueba de origen en el servidor, e imprime una línea por comprobación; debe terminar con `RESUMEN: 10/10 comprobaciones correctas`. Deja capturas en `tmp\verificacion-hito3\`. `verify:tauri` comprueba el motor, el indicador flotante, el teclado en pantalla y la sincronización con el `.exe` real y debe terminar con `RESUMEN: 52/52 comprobaciones correctas`.

Pruebas del código (no necesitan la aplicación abierta):

```powershell
npm test --prefix backend
node --test "tests/frontend/*.test.js"
motor-local\.venv\Scripts\python.exe -m pytest motor-local\tests
```

Resultados esperados: 91 pruebas de backend, 184 de interfaz y 192 del motor (con una deseleccionada, la que exige cámara).

## 19. Problemas conocidos

No hay estadísticas de uso que permitan afirmar cuáles son las fallas más frecuentes. Estos tres problemas son los que mejor respaldan el código, las pruebas automáticas y los mensajes de la propia aplicación.

### 19.1. «El servidor de autenticación no está disponible»

- **Síntoma:** al pulsar **Entrar** o **Crear cuenta** aparece «El servidor de autenticación no está disponible. ZeroTouch continúa funcionando en Modo Local.» Los gestos y los ajustes locales siguen funcionando.
- **Cómo identificar la causa:** en PowerShell, `Invoke-RestMethod http://127.0.0.1:3000/api/v1/health`. Si falla, el servidor no está en marcha. Si al ejecutar `npm start --prefix backend` aparece «No se pudo iniciar: revisa .env, dependencias y la inicialización de la base.», el problema está en `.env` o en la base: ejecute `npm run db:init --prefix backend` y lea su mensaje (por ejemplo, «DATABASE_PATH debe estar fuera del repositorio, OneDrive y unidades de red» o «DATABASE_PATH debe ser una ruta absoluta local», que aparece cuando la ruta está mal escrita o es relativa).
- **Solución:** inicie el servidor con `npm start --prefix backend`; corrija `DATABASE_PATH` en `.env` (ruta absoluta con `/`, fuera del repositorio y de OneDrive) y cree la base con `npm run db:init --prefix backend` si no existe. Si el servidor no inicia y la base ya existe, revise que `DATABASE_KEY` sea la clave con la que se creó la base. Si la base es anterior al cifrado, conviértala con `npm run db:cifrar --prefix backend`.
- **Cómo comprobar que se resolvió:** el comando de salud responde `{"data":{"estado":"ok","servicio":"ZeroTouch API"}}` y **Entrar** muestra «Sesión iniciada».

### 19.2. «Confirma tu correo» o «Tu cuenta aún no está confirmada»

- **Síntoma:** tras crear la cuenta, o al intentar entrar, el cuadro muestra «Confirma tu correo» y «Tu cuenta aún no está confirmada. Escribe tu correo y te enviaremos un enlace para activarla.»
- **Cómo identificar la causa:** la cuenta existe pero el enlace del correo no se abrió, o ya venció (24 horas) o ya se usó (sirve una sola vez). Es distinto de «Correo, usuario o contraseña incorrectos.», que indica un dato mal escrito.
- **Solución:** pulse **Reenviar enlace** con el correo de la cuenta; luego `npm run correo:enlace --prefix backend -- su_correo@ejemplo.test`, abra la dirección en el navegador y pulse **Confirmar mi correo**.
- **Cómo comprobar que se resolvió:** el navegador dice «Correo confirmado. Tu cuenta ya está activa.» y en la aplicación **Entrar** muestra «Sesión iniciada».

### 19.3. La cámara no abre o el control no se activa

- **Síntoma:** al pulsar **Activar control** aparece «La cámara no se abrió. Revisa que esté conectada y que otra aplicación no la esté usando, o elige otra en Ajustes.» y el estado es «Cámara no disponible»; o aparece «Windows no dejó registrar Ctrl+Alt+Z, la parada de emergencia, así que el control no se activa por seguridad.»
- **Cómo identificar la causa:** en el primer caso, otra aplicación (Teams, Zoom, la app Cámara) tiene la cámara, no hay cámara conectada o el acceso a la cámara para aplicaciones de escritorio está desactivado en Windows. En el segundo, otra aplicación ya usa el atajo `Ctrl+Alt+Z`. El control se niega a propósito en ambos casos: sin cámara abierta o sin parada de emergencia, el motor se queda en Observar y no mueve nada (comprobado por `verify:tauri`).
- **Solución:** cierre la otra aplicación que use la cámara o el atajo; en **Ajustes**, sección **Mano y recorrido**, elija otra **Cámara** (Principal, Segunda o Tercera) si tiene varias; revise en Windows los permisos de cámara. Pulse **Detener** y de nuevo **Iniciar cámara**.
- **Cómo comprobar que se resolvió:** el estado pasa a «Observando» y la vista previa muestra puntos sobre su mano; **Activar control** deja «Control activo».

## 20. Límites conocidos

- No hay instalador: se ejecuta desde el código fuente.
- Los gestos no se han medido con otras personas ni con cifras de acierto, FPS o latencia: lo que dice este manual sobre ellos es el diseño y lo que comprueban las pruebas sintéticas. Los umbrales son hipótesis ajustadas con las grabaciones del equipo.
- El servidor solo escucha en el propio equipo (`127.0.0.1`) y el correo se guarda como archivo: es una configuración de demostración, no un despliegue. Servidor remoto, dominio, HTTPS, correo real y respaldos programados están pendientes.
- La versión móvil quedó fuera del alcance de esta entrega.
- Los documentos `docs\prueba-manual-hardware.md` y `docs\hito2\*` describen versiones anteriores, con gestos que ya se retiraron. Para esta entrega la referencia es este manual.
