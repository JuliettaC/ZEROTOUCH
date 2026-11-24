-- ZeroTouch | Migración ADITIVA del esquema 2 al 3 (idempotencia de las creaciones por POST).
-- No elimina ni modifica tablas, columnas ni filas existentes: solo agrega la tabla `idempotencia` y su índice.
-- Ejecutar SOLO mediante `npm run db:migrate --prefix backend`: el script valida application_id y user_version,
-- crea un respaldo consistente de la base y aplica este archivo en una transacción (con fallo, no se cambia nada).
-- La definición coincide con db/schema.sql v3.

-- 9. v3 · Idempotencia de las creaciones (POST /perfiles y POST /perfiles/{id}/modos).
-- Una fila por clave aceptada: guarda la huella del contenido y la respuesta original para devolverla tal cual
-- si el cliente repite la misma solicitud (p. ej. porque perdió la respuesta). La clave es un UUID v7: su marca de
-- tiempo permite rechazar siempre las claves más viejas que la retención (30 días), de modo que purgar filas
-- antiguas nunca permite recrear una operación. No guarda credenciales, tokens ni textos escritos con Air-Swipe.
CREATE TABLE idempotencia (
    usuario_id TEXT NOT NULL,
    clave TEXT NOT NULL CHECK (length(clave) = 36 AND clave = lower(clave) AND substr(clave, 15, 1) = '7'),
    huella TEXT NOT NULL CHECK (length(huella) = 64 AND huella NOT GLOB '*[^0-9a-f]*'),
    recurso_tipo TEXT NOT NULL CHECK (recurso_tipo IN ('perfil', 'modo')),
    recurso_id TEXT NOT NULL CHECK (length(recurso_id) = 36),
    respuesta TEXT NOT NULL CHECK (json_valid(respuesta) AND length(respuesta) <= 4096),
    creado_en TEXT NOT NULL CHECK(julianday(creado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (usuario_id, clave),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_idempotencia_creado ON idempotencia(creado_en);

PRAGMA user_version = 3;
