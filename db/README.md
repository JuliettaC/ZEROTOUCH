# Base de datos v2

Modelo actual: cuenta 1:N perfiles; perfil 1:N contextos; cuenta 1:N sesiones.
Tablas adicionales: security_events y rate_limits. PK, FK, UNIQUE, CHECK y tablas
STRICT se definen en el SQL ejecutable. Propiedad de contexto se deriva del perfil.
SQL reproducible: schema.sql y migrations/002-accounts.sql.
La versión anterior está en migrations/001-legacy.sql; no ejecutarla sobre v2.

Inicializar base nueva: npm --prefix backend run db:init. Repetir sobre v2 no borra datos.
V1 se rechaza: no contiene propietarios y no se transforma automáticamente.
Respaldo/restauración y claves: [mantenimiento del backend](../backend/README.md#claves-y-respaldos).

La aplicación activa foreign_keys, WAL, synchronous FULL y espera de bloqueo de
3 segundos. DELETE de perfil con contextos está restringido. La eliminación de
cuenta se realiza por el servicio transaccional; no borrar filas manualmente.
