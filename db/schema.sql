-- ZeroTouch | Base de datos NUEVA, diseñada desde cero a partir del documento Hito 1.
-- No depende ni reutiliza las tablas o el esquema anterior del repositorio.
-- SQLite 3. / Para ejecutar en DB Browser for SQLite: Ejecutar SQL > abrir > ejecutar > guardar.
-- En Node.js, activar PRAGMA foreign_keys = ON en CADA conexión.
-- IDs: el backend genera UUID (crypto.randomUUID()), no se generan aquí.
-- Fechas: ISO 8601 UTC; el backend actualiza actualizado_en y version.
-- Inicialización exclusiva: no ejecutar sobre una base existente. Application ID ZT02.
-- Versión de esquema 4 (user_version = 4): v2 (correo verificable y tokens de cuenta) + v3 (idempotencia de POST)
-- + v4 (catálogo sin los gestos retirados el 24-11-2026: barridos, pulgares y modo precisión).
-- Una base v1, v2 o v3 existente se actualiza solo con db/migraciones/001_v1_a_v2.sql, 002_v2_a_v3.sql y
-- 003_v3_a_v4.sql mediante `npm run db:migrate --prefix backend`, que crea un respaldo antes de modificarla.
-- El backend sigue aceptando bases v2 y v3 hasta que se migren (ignora los gestos retirados que aún tengan).
-- Nombres: NFC en servicios; NOCASE solo ignora mayúsculas ASCII. No promete equivalencia Unicode completa.
-- La cámara, el reconocimiento gestual y las acciones sobre el SO se ejecutan localmente:
-- ¡NO se guardan videos, imágenes, coordenadas de manos ni textos escritos con Air-Swipe!

PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;
PRAGMA application_id = 1515466802;

-- 1. Identidad y roles: autenticación comprometida en el Hito 1.
-- El backend debe registrar cuentas como user e impedir cambios de rol sin autorización de admin.
CREATE TABLE usuarios (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(id,15,1)='4' AND substr(id,20,1) IN ('8','9','a','b')),
    nombre_usuario TEXT COLLATE NOCASE NOT NULL UNIQUE
        CHECK (length(trim(nombre_usuario)) BETWEEN 3 AND 40),
    contrasena_hash TEXT NOT NULL CHECK (contrasena_hash GLOB '$argon2id$v=19$*' AND length(contrasena_hash) BETWEEN 80 AND 512),
    rol TEXT NOT NULL DEFAULT 'user'
        CHECK (rol IN ('user', 'admin')),
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','suspendido')),
    creado_en TEXT NOT NULL CHECK(julianday(creado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actualizado_en TEXT NOT NULL CHECK(julianday(actualizado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    -- v2: correo normalizado en minúsculas (ASCII). NULL solo en cuentas heredadas de v1
    -- o registros cuyo correo ya pertenecía a otra cuenta; esas cuentas no pueden iniciar sesión.
    correo TEXT COLLATE NOCASE
        CHECK (correo IS NULL OR (length(correo) BETWEEN 6 AND 254 AND (correo COLLATE BINARY) = lower(trim(correo)) AND instr(correo, '@') > 1)),
    correo_verificado_en TEXT
        CHECK (correo_verificado_en IS NULL OR (julianday(correo_verificado_en) IS NOT NULL AND correo IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX ux_usuarios_correo ON usuarios(correo);

-- 2. Sesiones del backend. Solo se guarda el HASH del token, nunca el token original.
CREATE TABLE sesiones (
    token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
    usuario_id TEXT NOT NULL,
    creado_en TEXT NOT NULL CHECK(julianday(creado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expira_en TEXT NOT NULL CHECK(julianday(expira_en) IS NOT NULL AND julianday(expira_en)>julianday(creado_en)),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_sesiones_usuario ON sesiones(usuario_id);

-- 2b (v2). Tokens de un solo uso para verificar el correo o restablecer la contraseña.
-- Solo se guarda el HASH SHA-256 del token aleatorio. El token queda ligado al correo al que
-- se envió: si el correo de la cuenta cambia, el token deja de servir. Se elimina al usarse.
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

-- 3. Un usuario puede disponer de distintos perfiles de configuración.
CREATE TABLE perfiles (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(id,15,1)='4' AND substr(id,20,1) IN ('8','9','a','b')),
    usuario_id TEXT NOT NULL,
    nombre TEXT NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 60),
    descripcion TEXT NOT NULL DEFAULT '' CHECK (length(descripcion) <= 300),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    creado_en TEXT NOT NULL CHECK(julianday(creado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actualizado_en TEXT NOT NULL CHECK(julianday(actualizado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    UNIQUE (usuario_id, nombre COLLATE NOCASE)
) STRICT;
CREATE INDEX idx_perfiles_usuario ON perfiles(usuario_id);

-- 4. Modos y sus parámetros persistentes de calibración y personalización.
-- Las escalas 0-100 son una DECISIÓN NUEVA de diseño, no valores exigidos por el Hito 1.
-- "mirada" y "activacion_contextual" son opciones previstas, NO prueba de funcionamiento.
CREATE TABLE modos_uso (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND substr(id,15,1)='4' AND substr(id,20,1) IN ('8','9','a','b')),
    perfil_id TEXT NOT NULL,
    nombre TEXT NOT NULL CHECK (length(trim(nombre)) BETWEEN 1 AND 60),
    categoria TEXT NOT NULL DEFAULT 'personalizado'
        CHECK (categoria IN ('manual', 'oficina', 'accesibilidad', 'personalizado')),
    plataforma TEXT NOT NULL DEFAULT 'pc'
        CHECK (plataforma IN ('pc', 'movil')),
    sensibilidad_puntero INTEGER NOT NULL DEFAULT 65
        CHECK (sensibilidad_puntero BETWEEN 0 AND 100),
    estabilizacion_puntero INTEGER NOT NULL DEFAULT 40
        CHECK (estabilizacion_puntero BETWEEN 0 AND 100),
    tolerancia_micro_pinza INTEGER NOT NULL DEFAULT 50
        CHECK (tolerancia_micro_pinza BETWEEN 0 AND 100),
    desk_rest_habilitado INTEGER NOT NULL DEFAULT 0
        CHECK (desk_rest_habilitado IN (0, 1)),
    asistencia_mirada_habilitada INTEGER NOT NULL DEFAULT 0
        CHECK (asistencia_mirada_habilitada IN (0, 1)),
    activacion_contextual_movil INTEGER NOT NULL DEFAULT 0
        CHECK (activacion_contextual_movil IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    creado_en TEXT NOT NULL CHECK(julianday(creado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actualizado_en TEXT NOT NULL CHECK(julianday(actualizado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (perfil_id) REFERENCES perfiles(id) ON DELETE CASCADE,
    UNIQUE (perfil_id, nombre COLLATE NOCASE)
) STRICT;
CREATE INDEX idx_modos_perfil ON modos_uso(perfil_id);

-- 5. Catálogo técnico de acciones que puede solicitar el motor gestual local.
-- El catálogo no guarda acciones ejecutadas ni historial de uso.
CREATE TABLE acciones (
    codigo TEXT PRIMARY KEY NOT NULL CHECK(length(codigo) BETWEEN 1 AND 60 AND codigo NOT GLOB '*[^a-z0-9_]*'),
    nombre TEXT NOT NULL
) STRICT;

-- 6. Catálogo de los gestos propuestos en el Anexo A del Hito 1.
-- Un gesto tiene una acción predeterminada. La asignación por modo puede sobreescribirla.
CREATE TABLE gestos (
    codigo TEXT PRIMARY KEY NOT NULL CHECK(length(codigo) BETWEEN 1 AND 60 AND codigo NOT GLOB '*[^a-z0-9_]*'),
    nombre TEXT NOT NULL,
    accion_predeterminada TEXT NOT NULL,
    FOREIGN KEY (accion_predeterminada) REFERENCES acciones(codigo) ON DELETE RESTRICT
) STRICT;

-- 7. Opciones de cada modo: gesto habilitado y acción lógica elegida.
-- Si no existe una fila, se utiliza la acción predeterminada de 'gestos'.
CREATE TABLE asignaciones_gestos (
    modo_id TEXT NOT NULL,
    gesto_codigo TEXT NOT NULL,
    accion_codigo TEXT NOT NULL,
    habilitado INTEGER NOT NULL DEFAULT 1 CHECK (habilitado IN (0, 1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    actualizado_en TEXT NOT NULL CHECK(julianday(actualizado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (modo_id, gesto_codigo),
    FOREIGN KEY (modo_id) REFERENCES modos_uso(id) ON DELETE CASCADE,
    FOREIGN KEY (gesto_codigo) REFERENCES gestos(codigo) ON DELETE RESTRICT,
    FOREIGN KEY (accion_codigo) REFERENCES acciones(codigo) ON DELETE RESTRICT
) STRICT;

-- Datos de referencia del catálogo: NO crean usuarios ni perfiles falsos.
INSERT INTO acciones (codigo, nombre) VALUES
    ('activar_puntero', 'Activar puntero'),
    ('clic', 'Clic'),
    ('arrastrar', 'Arrastrar'),
    ('soltar', 'Soltar'),
    ('navegacion', 'Volver a navegación'),
    ('pausar', 'Pausar interacción'),
    ('atras', 'Atrás'),
    ('adelante', 'Adelante'),
    ('desplazar', 'Desplazamiento vertical'),
    ('confirmar', 'Confirmar'),
    ('cancelar', 'Cancelar'),
    ('precision', 'Activar modo precisión'),
    ('escritura_airswipe', 'Escritura mediante Air-Swipe'),
    ('multimedia_play_pause', 'Reproducir o pausar multimedia'),
    ('multimedia_siguiente', 'Siguiente elemento multimedia'),
    ('temporizador_iniciar', 'Iniciar temporizador'),
    ('sin_accion', 'Sin acción');

INSERT INTO gestos (codigo, nombre, accion_predeterminada) VALUES
    ('mano_abierta_sostenida', 'Mano abierta sostenida', 'activar_puntero'),
    ('micro_pinza', 'Micro-pinza', 'clic'),
    ('pinza_sostenida', 'Pinza sostenida', 'arrastrar'),
    ('liberacion_pinza', 'Liberación de pinza', 'soltar'),
    ('palma_abierta', 'Palma abierta', 'navegacion'),
    ('puno_cerrado', 'Puño cerrado', 'pausar'),
    ('dos_dedos', 'Dos dedos', 'desplazar'),
    ('trazo_airswipe', 'Trazo en teclado Air-Swipe', 'escritura_airswipe');

-- Sincronización prevista: leer y escribir los perfiles, modos y asignaciones mediante
-- la API REST autenticada. 'version' permite detectar ediciones concurrentes si el
-- backend implementa control optimista; NO implementa por sí sola sincronización.
-- Estado temporal (pausa, cámara, puntero, temporizadores), visión y predicción
-- Air-Swipe permanecen en el dispositivo local. No se exige crear tablas para ellos.

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

PRAGMA user_version = 4;
COMMIT;
