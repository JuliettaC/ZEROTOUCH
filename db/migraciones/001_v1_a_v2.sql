-- ZeroTouch | Migración ADITIVA del esquema 1 al 2 (verificación de correo y tokens de cuenta).
-- No elimina tablas, columnas ni filas. No crea cuentas. No toca perfiles, modos ni catálogos.
-- Ejecutar SOLO mediante `npm run db:migrate --prefix backend`: el script valida application_id
-- y user_version = 1, crea un respaldo de la base y aplica este archivo en una transacción.
-- Resultado para cuentas existentes: correo NULL y sin verificar. No pueden iniciar sesión
-- hasta vincular un correo con POST /api/v1/auth/correo (usuario + contraseña) y confirmarlo.
-- Las definiciones coinciden con db/schema.sql v2 (columnas al final de usuarios).

ALTER TABLE usuarios ADD COLUMN correo TEXT COLLATE NOCASE
    CHECK (correo IS NULL OR (length(correo) BETWEEN 6 AND 254 AND (correo COLLATE BINARY) = lower(trim(correo)) AND instr(correo, '@') > 1));
ALTER TABLE usuarios ADD COLUMN correo_verificado_en TEXT
    CHECK (correo_verificado_en IS NULL OR (julianday(correo_verificado_en) IS NOT NULL AND correo IS NOT NULL));
CREATE UNIQUE INDEX ux_usuarios_correo ON usuarios(correo);

CREATE TABLE tokens_cuenta (
    token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
    usuario_id TEXT NOT NULL,
    proposito TEXT NOT NULL CHECK (proposito IN ('verificacion', 'recuperacion')),
    correo TEXT NOT NULL CHECK (length(correo) BETWEEN 6 AND 254 AND instr(correo, '@') > 1),
    creado_en TEXT NOT NULL CHECK(julianday(creado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expira_en TEXT NOT NULL CHECK(julianday(expira_en) IS NOT NULL AND julianday(expira_en) > julianday(creado_en)),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_tokens_cuenta_usuario ON tokens_cuenta(usuario_id, proposito);

PRAGMA user_version = 2;
