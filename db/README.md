# Modelo de datos — versión 1

```text
profiles                               contexts
--------------------                   ----------------------
id TEXT PK                  1 ---- N   profile_id TEXT FK NOT NULL
name TEXT NOT NULL                     id TEXT PK
description TEXT NOT NULL              name TEXT NOT NULL
gaze INTEGER CHECK 0/1                 name_key TEXT NOT NULL
proximity INTEGER CHECK 0/1            sensitivity INTEGER 0..100
created_at TEXT UTC                    stability INTEGER 0..100
updated_at TEXT UTC                    desk_rest INTEGER CHECK 0/1
                                       pinch INTEGER CHECK 0/1
                                       scroll INTEGER CHECK 0/1
                                       created_at TEXT UTC
                                       updated_at TEXT UTC
                                       UNIQUE(profile_id, name_key)
```

El esquema ejecutable es `schema.sql`. Ambas tablas son STRICT. Los UUID v4
se generan en Node y se validan en la API; SQL exige PK no nula y longitud 36.
Los booleanos JSON se convierten a enteros 0/1 exclusivamente en el repositorio.
Las fechas ISO 8601 UTC son generadas por el servidor, no por el consumidor.
`name_key` es interno: nombre recortado, normalizado a NFC y convertido a
minúsculas por el servicio. No elimina tildes ni espacios interiores. SQL
garantiza unicidad de esa clave por perfil; cualquier importación futura debe
pasar por el servicio o generar la misma normalización.

Los perfiles admiten nombres repetidos: no son cuentas de acceso. Un contexto
pertenece obligatoriamente a un perfil. No se permite moverlo a otro perfil
mediante PATCH. ON DELETE RESTRICT evita eliminar un perfil con contextos:
la API devuelve 409. Primero se eliminan explícitamente los contextos.

## Inicialización y conservación

Desde la raíz: `npm --prefix backend run db:init`. Lee `.env` en la raíz,
valida la ruta, crea directorios locales si faltan y ejecuta el esquema en una
transacción. No carga semillas ni borra registros. Repetirlo sobre esquema 1
conserva los datos. Una base no vacía sin versión o con versión desconocida se
rechaza; no se intenta migrarla silenciosamente. `PRAGMA user_version=1`
identifica el esquema actual; cambios posteriores requerirán migración explícita.

El servidor exige una base ya inicializada y activa claves foráneas, WAL,
`synchronous=FULL` y espera por bloqueo de hasta 3 segundos. Cada escritura
actual es una única sentencia SQL atómica. No hay operaciones de negocio
multisentencia que necesiten transacciones adicionales.

No almacenar la base activa, `-wal` ni `-shm` en Git/OneDrive. El archivo de
desarrollo predeterminado vive en el directorio de datos local del sistema.
Los tests crean un archivo SQLite por escenario en el directorio temporal del
sistema y lo eliminan al terminar. No acceden a la base de desarrollo.

Para un respaldo manual, detener el servidor limpiamente antes de copiar la
base. No copiar solamente el archivo principal mientras WAL esté activo.
Esta entrega no implementa recuperación ante pérdida de disco ni copias
automáticas. La colección genera datos de demostración explícitos y elimina
solo sus propios IDs al terminar el recorrido.
