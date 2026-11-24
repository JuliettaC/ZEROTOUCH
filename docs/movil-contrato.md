# Contrato API que usa la app Android

La app Android (`android/`, Java nativo) **solo lee**: inicia sesión y descarga el primer modo con
`plataforma = "movil"` de la cuenta. No crea ni edita perfiles, modos ni asignaciones (eso se hace en el
escritorio). Comparte con el escritorio la misma API Express + SQLite (`/api/v1`), el catálogo de
`contracts/capacidades.json` y los modos con `plataforma = 'movil'`. No comparte interfaz con React.

Los ejemplos de abajo son respuestas **reales** del backend del repositorio con una base temporal y datos
ficticios (20-11-2026), obtenidas con curl y sin cabecera `Origin` (como el teléfono). Se reproducen con:

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/probar-contrato-movil.sh "$env:USERPROFILE\.jdks\jbr-21.0.11"
```

El script crea una base temporal fuera del repositorio (nunca lee `DATABASE_PATH` de `.env`), registra y
verifica una cuenta ficticia con el correo de desarrollo, prepara desde «el escritorio» un perfil con un modo
móvil y uno de PC, ejecuta las cuatro lecturas del teléfono y, si se le pasa un JDK, corre el cliente Java del
teléfono (`ApiClient` + `ModeLoader`) contra ese mismo backend. Respuestas guardadas en
`android/tests/fixtures/` (usadas por `ModeLoaderTest`).

## Red

- El teléfono alcanza el PC por la red local: en el `.env` del PC, `LAN_HOST=<IPv4 privada del PC>` (ver
  `.env.example`); `HOST` sigue en `127.0.0.1` para Tauri. La API rechaza `0.0.0.0` e IP públicas.
- La APK solo permite **HTTP sin cifrar hacia la IP con que se compiló** (`-PztLanHost=<IP>`, genera
  `res/xml/network_security_config.xml`); hacia cualquier otro host exige `https`. El cliente, además, solo
  acepta `http://` hacia una IPv4 privada (10/8, 172.16/12, 192.168/16). Si la IP del PC cambia hay que
  recompilar (ver `android/README.md`).
- La cookie `zt_session` no lleva `Secure` porque `APP_ORIGIN` es `http://` en la demo. Es tráfico en claro en
  una red local: aceptable solo para la demostración, no para una red pública (ver T23, API con HTTPS).

## 1. `POST /api/v1/auth/login`

Público. Cuerpo: `nombre_usuario` (usuario o correo) y `contrasena`. La cuenta debe tener el correo verificado.

```http
POST /api/v1/auth/login
Content-Type: application/json; charset=utf-8

{"nombre_usuario":"demo_movil","contrasena":"Receta-Demo-2026"}
```

`200`:

```http
Set-Cookie: zt_session=<token>; Max-Age=28800; Path=/api/v1; Expires=Sat, 21 Nov 2026 04:59:22 GMT; HttpOnly; SameSite=Strict
```
```json
{
  "data": {
    "usuario": { "id": "1a118616-777d-4409-b30e-1736b27e123f", "nombre_usuario": "demo_movil",
                 "rol": "user", "estado": "activo", "correo_verificado": true },
    "csrf_token": "<csrf_token>"
  }
}
```

El teléfono guarda **solo** `zt_session=<token>` en memoria y lo manda en `Cookie:`. No usa `csrf_token`
(no hace mutaciones). La contraseña no se guarda: se borra del campo tras el login.

Error (`401`): `{"error":"CREDENCIALES_INVALIDAS","mensaje":"Correo, usuario o contraseña incorrectos."}`

## 2. `GET /api/v1/perfiles?limite=100&offset=0`

```json
{
  "data": [
    { "id": "d6d9eb61-6818-4ca1-ae46-2327b6f40bc2", "usuario_id": "1a118616-777d-4409-b30e-1736b27e123f",
      "nombre": "Cocina", "descripcion": "", "version": 1,
      "creado_en": "2026-11-20T20:59:46.591Z", "actualizado_en": "2026-11-20T20:59:46.591Z" }
  ],
  "paginacion": { "limite": 20, "offset": 0 }
}
```

(La captura se hizo con `limite=20`; el teléfono pide `limite=100`, el máximo de la API. Más de 100 perfiles
no se recorren.)

## 3. `GET /api/v1/perfiles/{id}/modos?limite=100&offset=0`

```json
{
  "data": [
    { "id": "dcbbada9-0d10-43e9-9163-5ba8e2ca6dfa", "perfil_id": "d6d9eb61-6818-4ca1-ae46-2327b6f40bc2",
      "nombre": "Receta en el teléfono", "categoria": "accesibilidad", "plataforma": "movil",
      "sensibilidad_puntero": 65, "estabilizacion_puntero": 40, "tolerancia_micro_pinza": 50,
      "desk_rest_habilitado": false, "asistencia_mirada_habilitada": false,
      "activacion_contextual_movil": false, "version": 1,
      "creado_en": "2026-11-20T20:59:50.061Z", "actualizado_en": "2026-11-20T20:59:50.061Z" },
    { "id": "dfdb6f4e-01a0-45e3-a44c-9a5ec366cbe0", "perfil_id": "d6d9eb61-6818-4ca1-ae46-2327b6f40bc2",
      "nombre": "Oficina", "categoria": "oficina", "plataforma": "pc", "…": "…" }
  ],
  "paginacion": { "limite": 20, "offset": 0 }
}
```

El teléfono recorre los perfiles en el orden que devuelve la API y usa el **primer** modo con
`plataforma = "movil"`; si hay más, lo dice en pantalla. Los modos `pc` se ignoran. Los parámetros de puntero,
Desk-Rest y mirada no se usan en el teléfono; `activacion_contextual_movil` todavía no se aplica (T27).

## 4. `GET /api/v1/modos/{id}/gestos`

Configuración efectiva: las 13 filas del catálogo, con la asignación del modo encima
(`asignacion_version` = `null` cuando el gesto usa la acción predeterminada del catálogo).

```json
{
  "data": {
    "formato_version": 1,
    "modo": { "id": "dcbbada9-0d10-43e9-9163-5ba8e2ca6dfa", "nombre": "Receta en el teléfono", "plataforma": "movil", "…": "…" },
    "gestos": [
      { "gesto_codigo": "dos_dedos", "nombre": "Dos dedos", "accion_codigo": "desplazar", "habilitado": true, "asignacion_version": null },
      { "gesto_codigo": "modo_precision", "nombre": "Modo precisión", "accion_codigo": "precision", "habilitado": true, "asignacion_version": null },
      { "gesto_codigo": "pulgar_abajo", "nombre": "Pulgar abajo", "accion_codigo": "atras", "habilitado": true, "asignacion_version": 1 },
      { "gesto_codigo": "pulgar_arriba", "nombre": "Pulgar arriba", "accion_codigo": "multimedia_play_pause", "habilitado": true, "asignacion_version": 1 },
      "… 9 filas más (pinzas, puño, palma, deslizamientos, Air-Swipe) que el teléfono no usa"
    ]
  }
}
```

Errores comunes: `401 {"error":"SESION_INVALIDA","mensaje":"Inicia sesión."}` (cookie ausente o caducada:
el teléfono vuelve a iniciar sesión **una vez** si la persona escribió la contraseña; si no, lo pide) y `404`
para un modo ajeno o borrado.

## Traducción a gestos del teléfono

El teléfono reconoce las categorías del modelo MediaPipe GestureRecognizer, no los gestos del motor de
escritorio. `GestureActions.CATALOG_GESTURE` relaciona cada categoría con el código del catálogo y
`GestureActions.fromCatalog` construye la lista blanca a partir de las filas con `habilitado = true`:

| Categoría MediaPipe | Fila del catálogo que manda | Acción del teléfono |
|---|---|---|
| ✌ `Victory` | `dos_dedos` = `desplazar` | Desplazar hacia abajo |
| ☝ `Pointing_Up` | `dos_dedos` = `desplazar` (va unido a ✌) | Desplazar hacia arriba |
| 👎 `Thumb_Down` | `pulgar_abajo` | según la tabla siguiente |
| 👍 `Thumb_Up` | `pulgar_arriba` | según la tabla siguiente |

| `accion_codigo` del pulgar | Acción del teléfono |
|---|---|
| `atras`, `cancelar` | Volver (`GLOBAL_ACTION_BACK`) |
| `multimedia_play_pause` | Reproducir / pausar (tecla multimedia) |
| `multimedia_siguiente` | Siguiente pista |
| `navegacion`, `adelante`, `confirmar`, `precision`, `temporizador_iniciar` | **deshabilitado** |

Reglas:
- Una acción que el teléfono no sabe ejecutar **deshabilita** el gesto; nunca se sustituye por otra.
- `habilitado = false` deshabilita el gesto. Con `dos_dedos` deshabilitado no hay desplazamiento en ninguno de
  los dos sentidos.
- `CATALOG_GESTURE` asocia ☝ con `modo_precision`, pero `fromCatalog` no lee esa fila: ☝ solo sigue a
  `dos_dedos`. Puño, palma, pinzas, deslizamientos y Air-Swipe no tienen efecto en el teléfono (la palma
  abierta es el gesto de liberación del `GestureGate`).
- Con los predeterminados del catálogo (`pulgar_arriba = confirmar`) el 👍 queda deshabilitado en el teléfono.
  Para la demo, el modo móvil asigna `pulgar_arriba = multimedia_play_pause` (como en el ejemplo).

## Comportamiento del cliente (`android/app/src/main/java/cl/zerotouch/mobile/`)

| Archivo | Función |
|---|---|
| `MiniJson.java` | Lector JSON mínimo sin dependencias (sirve en Android y en la JVM). |
| `ApiClient.java` | `HttpURLConnection`: valida la dirección, login, cookie en memoria, GET, errores con código estable. Timeouts 4 s / 6 s, respuesta ≤ 512 KB, sin redirecciones. |
| `ModeLoader.java` | Perfiles → modos → gestos efectivos → `GestureActions.fromCatalog`. Devuelve éxito o fallo con motivo; nunca un éxito inventado. |
| `CameraGestureService.applyActions` | Aplica el modo. Si el control está en CONTROL, **pausa antes**; `GestureGate.reconfigure` rechaza cualquier cambio durante CONTROL, sube la época (descarta resultados en vuelo) y borra el gesto a medio sostener. La persona reactiva a mano. |
| `MainActivity` | Campos servidor/usuario/contraseña, botón «Actualizar modo», lista de gestos vigentes y su origen. |

Sin conexión, credenciales incorrectas, sin modo móvil o respuesta inesperada: se muestra el motivo y **sigue
aplicado lo anterior** (al abrir la app, los valores por defecto del teléfono, rotulados como tales).

## Qué está probado y qué no

- **Automático (JVM)**: `ModeLoaderTest` (66 aserciones): JSON, direcciones permitidas/rechazadas, cookie,
  respuestas reales de la API, flujo completo contra un servidor HTTP falso (login, sesión caducada, sin modo
  móvil, HTML en vez de JSON, servidor caído) y `GestureGate.reconfigure`.
- **Contra el backend real** (este PC, base temporal): `scripts/probar-contrato-movil.sh` con el cliente Java.
- **Compilación**: la APK compila con el SDK (`assembleDebug`) y lleva `network_security_config.xml`.
- **No probado**: la app en el teléfono (red del hotspot, política de HTTP en claro de Android, interfaz).
