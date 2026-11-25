# Integración y recuperación de sincronización

Bloque del 11-11-2026. Módulos puros (Codex) e integración en la interfaz (Claude, ver «Integración en la interfaz»).

## Contrato para la interfaz

`synchronize({ api, state, resolutions, retry, onCheckpoint })` mantiene el resultado
`{ state, conflicts, changes }`. Las lecturas usan `retry`; las mutaciones no usan
reintentos de transporte. La recuperación de PATCH/PUT reenvía exactamente la
versión esperada original: el servidor no puede aplicarla dos veces.

- Pasar `onCheckpoint(snapshot)` y guardar **todo** el estado en el espacio de la
  cuenta capturada al iniciar. Se espera su resultado antes de seguir. Retornar
  `false` o rechazar detiene la operación; `saveState` ya devuelve un booleano.
- Hay puntos de guardado antes de enviar, después de recibir un resultado y
  después de incorporar identidad/versión. No quitar `syncOperation` al guardar
  o normalizar preferencias. No contiene credenciales.
- Al capturar un error, conservar `error.state` (también contiene `conflicts` y
  `changes`). No volver al estado anterior ni mostrar éxito. Si el almacenamiento
  falla, conservar el estado en memoria y avisar; no hay garantía de recuperación
  tras cerrar sin un guardado exitoso.
- Serializar sincronizaciones por cuenta, bloquear edición/borrado y cambios de
  cuenta durante la ejecución, o implementar una fusión explícita. Los snapshots
  no se fusionan automáticamente con cambios de React hechos mientras hay una
  solicitud en vuelo. No iniciar otra ejecución con un snapshot obsoleto.
- Tras una interrupción se permiten ediciones locales; los recibos preservan esas
  ediciones como pendientes. `removeProfile`/`removeMode` rechazan eliminar el
  recurso de una operación sin recuperar (incluidos modos de un perfil).
- Sin callback, el módulo funciona en memoria y entrega `error.state`, pero no
  ofrece persistencia ante cierre del proceso. El callback es imprescindible en UI.

Ejemplo del callback, usando el ID de cuenta capturado y sin cambiar de cuenta
durante la operación:

```js
onCheckpoint: snapshot => saveState(accountId, snapshot)
```

`adoptRemote` ahora enlaza identidad dejando `dirty: true`; solo una confirmación
completa permite `markSynced`. El motor de sincronización marca perfiles confirmados
como limpios y mantiene un modo pendiente hasta confirmar sus asignaciones.

## Conflictos y recuperación

Las claves de decisiones son `profile:<id>` y `mode:<id>`. Las decisiones existentes
de tipo cadena se conservan. Hay dos tipos nuevos:

| Tipo | Comportamiento |
|---|---|
| `resultado_incierto` | POST pudo aplicarse sin respuesta **y no hay clave de idempotencia utilizable** (servidor sin idempotencia, clave de más de 30 días, operación guardada sin clave o con una clave dañada). Se detiene la sincronización, no se repite POST ni se renombra automáticamente. `candidates` contiene recursos del ámbito aún no vinculados ni marcados para borrar. Con idempotencia casi nunca aparece: ver «Creaciones idempotentes». |
| `borrado_no_seguro` | **No se envía DELETE** y la marca permanece (el recurso no se descarga de nuevo). Dos causas (`reason`): `servidor` (el backend no anuncia `servidor.borrado_condicional`; `options` vacío, solo se puede `recuperar`) y `sin_version` (marca antigua sin versión conocida: se puede `recuperar` o `borrar` de todos modos con el estado actual). |
| `borrado_modificado` | El servidor rechazó el DELETE condicional (412): algo cambió en otro equipo después de borrar aquí. No se borró nada. Opciones: `recuperar` (quita la marca y descarga lo que hay ahora) o `borrar` (lee el estado actual y borra ESE estado; si vuelve a cambiar, otro 412). |

Para una creación incierta, mostrar los candidatos y pedir una selección explícita.
La decisión es `{ action: 'adoptar', remoteId: '<UUID elegido>' }` en la clave del
recurso local. Vincula su identidad y sube los valores locales con la versión del
candidato: advertir al usuario que esa elección conserva su contenido local.
No elegir automáticamente por nombre ni convertir una cadena `adoptar` en esa
decisión. Si no existe candidato o no puede identificarse con certeza, sigue
bloqueada: hace falta resolver el resultado en el servidor. Un GET sin resultados
no demuestra que una solicitud anterior en vuelo no vaya a completarse.

Un PATCH/PUT sin respuesta se recupera con la misma precondición. Si ya se aplicó,
el servidor responde conflicto; se conserva el contenido local y se presentan
las decisiones de versión existentes (`local`/`remoto`). No se presupone que el
incremento de versión sea exclusivamente obra de este cliente. Una decisión
antigua `local` no se reutiliza automáticamente durante esa recuperación.

**Modo y asignaciones.** Con un servidor que anuncia `servidor.modo_con_asignaciones` (ver «Mutación conjunta»), el
modo y sus asignaciones viajan en UNA solicitud atómica. Con un servidor anterior se guardan, como antes, mediante
PATCH/POST del modo y PUT de asignaciones separados: cada confirmación conserva su versión y UUID, pero **no hay
transacción conjunta** y otro dispositivo puede observar ajustes nuevos con asignaciones antiguas hasta completar la
operación. Recuperar puede repetir un PATCH con una versión nueva, sin crear otro modo. El resumen `changes` describe
el flujo de esta ejecución; no es un registro contable de operaciones aplicadas en ejecuciones anteriores.

Las marcas nuevas guardan versión, nombre y perfil padre; las de perfil incluyen
los IDs/versiones conocidos de sus modos. Las marcas antiguas conservan
`version: null`: no se envían a ciegas (`borrado_no_seguro`/`sin_version`). No se purgan
automáticamente aunque el servidor ya no liste el recurso. Las asignaciones comparten
la versión del modo, de modo que el ETag de un modo ya las cubre.

## Integración en la interfaz (hecha el 11-11-2026)

La interfaz usa `runSync` de `src/sync/syncSession.js`, que aplica el contrato anterior; nada llama a
`synchronize` directamente. Lo que queda garantizado en `App.jsx` y sus hooks (`src/hooks/`):

- **Un espacio por cuenta.** `useWorkspace` mantiene `{ accountId, state }` como par inseparable y guarda
  en la misma acción que el cambio (`mutate`), no en un efecto. Cambiar de cuenta abre otro espacio; los
  ajustes de invitado solo pasan a una cuenta con la acción explícita «Copiar mis ajustes de invitado».
- **Serialización.** `lock()` reserva el espacio durante la sincronización: las ediciones y el cambio de
  cuenta se rechazan (los controles se deshabilitan y una edición forzada muestra un aviso, sin guardar).
  `runSync` además rechaza una segunda ejecución de la misma cuenta (`outcome: 'en_curso'`).
- **Puntos de control.** `onCheckpoint` guarda el estado completo en la cuenta capturada al iniciar. Si el
  almacenamiento falla, la sincronización se detiene, el estado sigue en memoria y se muestra un aviso.
- **Errores.** `runSync` nunca lanza: devuelve `error.state` (identidades, versiones y recibos confirmados),
  que se incorpora y se guarda. Reintentar retoma la operación a medias (`recovered: true`).
- **Éxito honesto.** Solo `outcome: 'sincronizado'` si no queda nada pendiente (sin conflictos, sin
  `syncOperation`, sin lápidas ni marcas `dirty`) y el almacenamiento escribió. El resumen de la cabecera se
  deduce del estado guardado (`syncSummary`), no de la última acción.
- **Decisiones.** `SyncConflicts` muestra cada conflicto y envía `{ 'profile:<id>' | 'mode:<id>': decisión }`.
  Una creación incierta solo admite elegir un candidato (`{ action: 'adoptar', remoteId }`), nunca la cadena
  `adoptar`; sin candidatos queda bloqueada.
- **Borrados (12-11-2026).** Eliminar es una acción local que deja una marca; al sincronizar se envía un DELETE
  condicional (ver abajo). Se confirma, o el servidor lo rechaza y la persona decide. Con un servidor que no lo
  anuncia sigue sin enviarse nada y la interfaz ofrece «Cancelar el borrado y recuperarlo».

**Probado:** pruebas automáticas de `runSync` y `syncSummary` (`tests/frontend/sync-session.test.js`) y recorrido
manual en navegador con un puente Tauri falso (inicio de sesión, primera sincronización, conflicto de versión,
borrado bloqueado y su cancelación, fallo a medias, respuesta perdida con candidato, bloqueo durante la
sincronización, recarga con sesión previa). **No probado:** Tauri real, backend HTTP real ni reinicio del
proceso con la base real; los hooks de React no tienen pruebas automáticas (no hay entorno de pruebas de
componentes).

## Borrado condicional (implementado el 12-11-2026)

**Contrato HTTP** (OpenAPI 1.3.0; sin cambios de esquema SQLite ni migraciones):

- `DELETE /perfiles/{id}` y `DELETE /modos/{id}` exigen `If-Match` con un único ETag fuerte: 428 si falta,
  400 si es inválido (`*`, débil, lista), 404 si no existe o es ajeno (se comprueba antes que la precondición, así
  no se revela nada de recursos ajenos), 412 si el recurso cambió, 204 al borrar. Repetir un DELETE ya aplicado da 404.
- ETag opaco = SHA-256 → base64url (32 caracteres). **Modo:** identidad + versión (la versión del modo incluye sus
  asignaciones). **Perfil (agregado):** identidad + versión del perfil + (id, versión) de **todos** sus modos, así que
  detecta también altas, bajas y ediciones de modos y de asignaciones antes del borrado en cascada.
- El servidor lee el estado, recalcula el ETag, lo compara y borra dentro de **una sola transacción con bloqueo de
  escritura** (`BEGIN IMMEDIATE`); el `DELETE` lleva además `AND version=?` como defensa en profundidad.
- `GET /perfiles/{id}` y `GET /modos/{id}` entregan el ETag vigente (cabecera `ETag`); `GET /capacidades` anuncia
  `servidor.borrado_condicional`. El cliente no envía ningún DELETE si no lo ve anunciado (ni ante respuesta
  inesperada, ruta inexistente o cliente sin `capabilities`); un fallo transitorio interrumpe la sincronización.

**Cliente.** Cada marca guarda la versión (y, en perfiles, los modos con versión) que la interfaz conocía al borrar;
con eso se calcula el ETag (`src/sync/etag.js`, mismo algoritmo y vectores compartidos en `contracts/etag-vectores.json`).
Los modos se borran antes que su perfil para que el agregado coincida. Es seguro repetir un DELETE condicional tras
perder la respuesta: el segundo intento da 404 y se toma como «ya borrado». El puente Tauri exige `if_match` válido
(`DATOS_INVALIDOS` si no) y lo envía como cabecera.

**Garantía y límites.** Lo que se borra es exactamente el estado que la persona vio: si otro equipo cambió algo
(incluidas asignaciones o modos nuevos), no se borra nada y se pregunta. «Borrar de todos modos» es una decisión
explícita y destruye lo que haya en ese momento (con una nueva comprobación atómica sobre lo leído). No cubre cambios
que ocurran en un servidor distinto del que anunció la función, ni sustituye una copia de seguridad.

## Creaciones idempotentes (`Idempotency-Key`)

`POST /perfiles` y `POST /perfiles/{id}/modos` aceptan una clave opcional. Así se evita el caso que antes obligaba a
preguntar («¿se creó o no?»): si la respuesta se pierde, repetir la creación con **la misma clave** devuelve el
recurso original en vez de crear otro.

**Servidor** (esquema SQLite v3; ver `db/README.md`). La clave es un UUID v7 en minúsculas; su hora incrustada fija la
vigencia (30 días). Misma clave y mismo cuerpo equivalente (tras normalizar) ⇒ la respuesta ORIGINAL con
`Idempotent-Replayed: true`; misma clave con otro cuerpo, o contra otro perfil padre ⇒ 409 `IDEMPOTENCIA_CONFLICTO`;
clave inválida ⇒ 400 `IDEMPOTENCIA_CLAVE_INVALIDA`; de más de 30 días ⇒ 422 `IDEMPOTENCIA_CLAVE_EXPIRADA`. Comprobar la
clave, crear el recurso y registrar el resultado es una sola transacción, así que dos solicitudes simultáneas crean un
solo recurso. Solo se registran las creaciones que terminaron bien: un 400 o un 409 `NOMBRE_DUPLICADO` no deja rastro y
la clave puede reutilizarse corregida. Una base v2 sigue funcionando pero responde 501 `IDEMPOTENCIA_NO_DISPONIBLE` a
cualquier clave (no la ignora) y `GET /capacidades` anuncia `servidor.idempotencia: false`.

**Cliente.** Solo se usa si `GET /capacidades` anuncia `servidor.idempotencia.clave === 'uuid-v7'` (se consulta una vez
por sincronización); si no, todo ocurre como antes y no se envía ninguna clave. Solo la ausencia de la ruta
(`RUTA_NO_ENCONTRADA`/`NO_ENCONTRADO`, servidor anterior) o un cliente sin `capabilities` cuentan como «el servidor no
lo tiene»; cualquier otro fallo de esa consulta (sesión caducada, 403, 500, red) interrumpe la sincronización, para no
enviar creaciones sin clave a un servidor que sí la admite.

- Cada creación genera su clave una sola vez (`src/sync/idempotency.js`) y la guarda en `syncOperation.key`, junto a la
  operación pendiente, antes de enviar nada. Nunca se comparte entre recursos.
- Un fallo de transporte (`SERVICE_OFFLINE`, `SERVICE_RESPONSE`…) se **reintenta con la misma clave** dentro de la
  propia sincronización. Es el único caso de escritura reintentada a ciegas, y es seguro por la clave.
- Si la sincronización se interrumpe (cierre de la app, red caída durante todos los reintentos), la siguiente
  encuentra la operación con su clave y **repite la creación**: el servidor la crea una sola vez o devuelve la que ya
  creó, y el recibo se aplica como siempre. No hay conflicto `resultado_incierto` ni adopción manual.
- Si la repetición no puede usarse (`IDEMPOTENCIA_CLAVE_EXPIRADA`, `_INVALIDA`, `_CONFLICTO`, `_NO_DISPONIBLE`; el
  servidor dejó de anunciarla; la operación no tiene clave o está dañada) vuelve la vía anterior: `resultado_incierto`
  con candidatos y adopción explícita. Una clave dañada **no se envía**: el puente la rechazaría con `DATOS_INVALIDOS` y
  eso aquí significaría «no se creó nada».
- Si el servidor rechaza una clave **recién generada** antes de crear nada (típicamente un reloj del equipo adelantado
  más de 5 minutos), la operación se descarta y se crea sin idempotencia, para no bloquear la sincronización.
- Si la repetición recibe un rechazo de aplicación (`NOMBRE_DUPLICADO`, `DATOS_INVALIDOS`, `NO_ENCONTRADO`…) no se
  creó nada con esa clave: la operación se descarta y sigue el flujo normal (p. ej. el conflicto `nombre_duplicado`).
- La respuesta repetida es la **original**: si el recurso cambió después, su `version` puede ser antigua y la
  sincronización lo trata como cualquier versión desfasada (conflicto o descarga), nunca lo sobreescribe en silencio.
- El puente Tauri valida la clave (UUID v7 canónico) antes de enviarla y marca la respuesta repetida con
  `repetida: true` en el nivel superior; `src/api/client.js` la pasa como `idempotencyKey`.

**Límites.** No protege las actualizaciones (PATCH/PUT), que ya usan la versión optimista, ni los borrados, que son
condicionales. Pasados 30 días no se puede saber por clave si una creación se aplicó. La clave no es un secreto: se
guarda en `localStorage` con la operación pendiente y viaja por el puente local.

## Mutación conjunta (modo + asignaciones en una solicitud)

`POST /perfiles/{id}/modos` y `PATCH /modos/{id}` aceptan el campo opcional `gestos`: la lista completa de
asignaciones, con la semántica de `PUT /modos/{id}/gestos` (los gestos sin fila vuelven a la acción predeterminada;
`[]` las borra todas). El modo y sus asignaciones se escriben en **una transacción** y con **una sola subida de
versión** (un modo se crea en la versión 1; un PATCH sube de v a v+1). Es todo o nada: una asignación inválida o no
compatible con el motor (400 `DATOS_INVALIDOS` / `ACCION_NO_COMPATIBLE`), una versión obsoleta (409) o un fallo de la
base no aplican ni los campos ni las asignaciones, y un POST fallido no deja un modo huérfano. Un PATCH puede traer
solo `gestos` y `version`. La respuesta sigue siendo el modo; las asignaciones se leen con `GET /modos/{id}/gestos`.

**Servidor.** Lo anuncia `GET /capacidades` en `servidor.modo_con_asignaciones`. No cambia el esquema SQLite. Con
`Idempotency-Key`, la lista de gestos entra en la huella (ordenada: el orden en que se envíe no importa). `PUT
/modos/{id}/gestos` y `PATCH /modos/{id}/gestos/{gesto}` siguen existiendo y validan con el mismo código
(`backend/src/services/asignacionesValidation.js`).

**Cliente.** Solo envía `gestos` si el servidor lo anuncia (misma consulta de capacidades, una vez por
sincronización); si no, mantiene los dos pasos y nunca manda ese campo.

- Alta: el POST lleva las 13 asignaciones y el modo queda sincronizado en la versión 1, sin PUT. Si la respuesta se
  pierde, se recupera con la clave de idempotencia (`syncOperation` conserva el cuerpo con sus asignaciones) y el
  modo vuelve completo, no «a medias».
- Edición: un solo PATCH con los campos, las asignaciones y la versión conocida. Al confirmarse el modo no queda
  `dirty`. Si se pierde la respuesta, la recuperación repite la misma precondición: si ya se aplicó, el servidor da
  409 y se presenta el conflicto de versión de siempre (se conserva el contenido local).
- Cada operación pendiente recuerda con qué forma se envió (si sus argumentos llevan `gestos`), así que una
  recuperación entre versiones del servidor sigue siendo coherente: una operación de dos pasos recuperada contra un
  servidor con mutación conjunta deja el modo pendiente y sube sus asignaciones con un PATCH conjunto.

**Límites.** Solo cubre un modo a la vez: no hay transacción entre varios modos ni entre un perfil y sus modos. La
respuesta del POST/PATCH no incluye las asignaciones. Vale para un único proceso de backend sobre SQLite.

## Pendiente en el backend (no implementado)

Nada de lo planificado para esta fase de sincronización queda abierto en el backend. Fuera de alcance, por decidir:
transacción entre varios modos o entre un perfil y sus modos, y versionado de las asignaciones por separado del modo.

## Verificación y límites

`node --test tests/frontend/*.test.js` cubre adaptadores en memoria y recarga por
serialización JSON: nombres largos/NFC, importación, fallos parciales, POST aplicado
sin respuesta, PATCH/PUT aplicado sin respuesta, recibos guardados, fallos de
guardado, ediciones tras interrupción y borrados (confirmados, rechazados por cambios concurrentes, 404, respuesta
perdida, servidor anterior, marcas antiguas): `sync.test.js`, `sync-recovery.test.js`, `sync-session.test.js`,
`sync-delete.test.js` y `etag.test.js`; las creaciones idempotentes (claves, reintentos con la misma clave, recuperación
tras cierre, reloj desfasado, claves expiradas o dañadas, servidor sin la función) en `sync-idempotency.test.js`, contra
un doble que usa el validador y la huella REALES del servidor (`backend/src/domain/idempotencia.js`) y que además se
contrasta con el backend en `backend/test/resources/idempotencia.test.js` (HTTP) y, de extremo a extremo con el puente
Tauri, en `cargo test`. Las pruebas que asumen una creación incierta usan `createFakeApi({ idempotency: false })`
(servidor sin la función). La mutación conjunta se prueba en `sync-conjunta.test.js` (qué se envía, versión 1 y sin PUT,
una sola subida al editar, rechazo sin efectos —comparado con el servidor anterior, donde el PATCH sí quedaba aplicado—,
recuperación tras respuesta perdida y servidor sin la función con `createFakeApi({ jointMode: false })`) y contra el
backend real en `backend/test/resources/mutacion-conjunta.test.js` (HTTP, atomicidad con un fallo inyectado en SQLite,
carrera de versiones, propiedad, idempotencia), además de `cargo test` y `npm run verify:tauri`. El DELETE condicional se prueba contra el backend real en
`backend/test/resources/borrado.test.js` (HTTP, transacción, cascada, propiedad) y de extremo a extremo con el puente
Tauri en `cargo test`. La prueba de cierre del cliente es simulada; no demuestra reinicio real de aplicación o base.
No se probó la interfaz con Tauri real ni almacenamiento real del navegador.

Fase de sincronización original: implementación asistida por Codex; revisión humana pendiente. Sin cambios de
dependencias, bases reales, motor, commits ni publicación. La idempotencia añade el esquema v3 y su migración
explícita (solo probada con bases temporales).
