# Contrato API v1

Base local: `http://127.0.0.1:3000`. Sin autenticación; el servidor solo admite
interfaces loopback. Uso académico local, no servicio multiusuario público.
La ruta `/api/health` se conserva sin versionar. Cambios incompatibles de
contrato requerirán una nueva versión; no se modificará silenciosamente v1.

## Recursos

Perfil: `id` UUID v4, `name` obligatorio (texto recortado de 1..60 caracteres),
`description` opcional (0..300, predeterminado vacío), `gaze` y `proximity`
booleanos opcionales (true). Incluye `createdAt` y `updatedAt` ISO UTC.

Contexto: `id` UUID v4, `profileId` UUID de perfil existente, `name` obligatorio
(1..60), `sensitivity` entero 0..100 (65), `stability` entero 0..100 (40),
`deskRest`, `pinch`, `scroll` booleanos (true), fechas ISO UTC.
Estos valores son preferencias, no medidas de sensores.

Las respuestas individuales son `{ "data": { ...recurso } }`. Las listas son
`{ "data": [], "pagination": { "limit": 20, "offset": 0 } }`.
No se informa total. Orden: `created_at`, luego `id` para desempatar.

| Método | Ruta | Parámetros/cuerpo | Éxito | Errores de contrato/dominio |
|---|---|---|---|---|
| GET | `/api/health` | Ninguno | 200 `{status:"ok",service:"ZeroTouch API"}` | — |
| POST | `/api/v1/profiles` | Perfil sin ID/fechas | 201, data, cabecera Location | 400, 413, 415 |
| GET | `/api/v1/profiles` | `limit` 1..100; `offset` entero >=0 | 200, lista | 400 |
| GET | `/api/v1/profiles/:id` | UUID v4 | 200, data | 400, 404 |
| PATCH | `/api/v1/profiles/:id` | UUID; uno o más campos editables | 200, data | 400, 404, 413, 415 |
| DELETE | `/api/v1/profiles/:id` | UUID | 204 sin cuerpo | 400, 404, 409 si tiene contextos |
| POST | `/api/v1/contexts` | Contexto sin ID/fechas; profileId requerido | 201, data, Location | 400, 404, 409, 413, 415 |
| GET | `/api/v1/contexts` | limit/offset; `profileId` opcional | 200, lista | 400, 404 si perfil filtrado no existe |
| GET | `/api/v1/contexts/:id` | UUID | 200, data | 400, 404 |
| PATCH | `/api/v1/contexts/:id` | UUID; campos editables excepto profileId | 200, data | 400, 404, 409, 413, 415 |
| DELETE | `/api/v1/contexts/:id` | UUID | 204 sin cuerpo | 400, 404 |

Todas las operaciones pueden devolver 500 ante fallos inesperados. Escrituras
bloqueadas por otra conexión pueden devolver 503 tras la espera configurada.
No hay PUT: se eligió PATCH. Rutas/métodos no registrados devuelven 404 JSON.
HEAD/OPTIONS son proporcionados por Express para las rutas existentes.

## Ejemplos de escritura

Crear perfil:
```json
{"name":"Persona demo","description":"Prueba local","gaze":true,"proximity":true}
```

Crear contexto (reemplazar profileId por el UUID devuelto):
```json
{"profileId":"11111111-1111-4111-8111-111111111111","name":"Cocina","sensitivity":65,"stability":40,"deskRest":true,"pinch":true,"scroll":true}
```

Actualizar parcialmente:
```json
{"sensitivity":80,"pinch":false}
```

PATCH conserva campos omitidos; rechaza objeto vacío, null, arrays, campos
desconocidos, ID, fechas y cambios de profileId. No convierte strings a números
o booleanos. POST aplica los valores predeterminados documentados. El body debe
ser `application/json` y no superar 16 KB. No hay semántica JSON Patch.

## Errores

```json
{"error":{"code":"DUPLICATE_CONTEXT","message":"Ya existe un contexto con ese nombre en el perfil."}}
```

| HTTP | code | Situación |
|---|---|---|
| 400 | INVALID_INPUT | UUID, campo, tipo, rango o query incorrectos |
| 400 | INVALID_JSON | Sintaxis JSON inválida |
| 404 | NOT_FOUND | Registro solicitado no existe |
| 404 | PROFILE_NOT_FOUND | Perfil relacionado/filtrado no existe |
| 404 | ROUTE_NOT_FOUND | Ruta o método no registrado |
| 409 | DUPLICATE_CONTEXT | Nombre normalizado repetido dentro del perfil |
| 409 | RELATED_RECORDS | Restricción de integridad referencial |
| 413 | BODY_TOO_LARGE | Body mayor de 16 KB |
| 415 | UNSUPPORTED_MEDIA_TYPE | Tipo/codificación del contenido no admitido |
| 500 | INTERNAL_ERROR | Fallo interno; respuesta sin SQL ni stack |
| 503 | DATABASE_BUSY | Escritura bloqueada; reintentar |

## Colección Postman

Importar `ZeroTouch.postman_collection.json`. La colección tiene variables
`baseUrl`, `profileId`, `contextId`; no requiere un entorno adicional.
Ejecutar las 23 peticiones en orden con el Runner. Los scripts guardan los IDs
creados, comprueban códigos y verifican cambios. Puede repetirse: crea un perfil
nuevo por recorrido. No reutilizar IDs de datos reales.

Persistencia manual: ejecutar hasta el paso 11; detener el servidor con Ctrl+C,
iniciarlo nuevamente con la misma configuración y repetir 09 y 11. Deben
conservarse ID, sensibilidad 80 y pinch=false. Continuar hasta el paso 23
para limpiar los registros de ese recorrido.

`npm --prefix backend run test:collection` ejecuta estas mismas peticiones y
scripts contra un proceso real y una base temporal aislada. El adaptador de
prueba soporta únicamente las APIs pm usadas en esta colección; no sustituye
una validación visual en la aplicación Postman.
