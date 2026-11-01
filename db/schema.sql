-- ZeroTouch | Base de datos NUEVA, diseñada desde cero a partir del documento Hito 1.
-- No depende ni reutiliza las tablas o el esquema anterior del repositorio.
-- SQLite 3. / Para ejecutar en DB Browser for SQLite: Ejecutar SQL > abrir > ejecutar > guardar.
-- En Node.js, activar PRAGMA foreign_keys = ON en CADA conexión.
-- IDs: el backend genera UUID (crypto.randomUUID()), no se generan aquí.
-- Fechas: ISO 8601 UTC; el backend actualiza actualizado_en y version.
-- Inicialización exclusiva: no ejecutar sobre una base existente. Application ID ZT02.
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
    actualizado_en TEXT NOT NULL CHECK(julianday(actualizado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

-- 2. Sesiones del backend. Solo se guarda el HASH del token, nunca el token original.
CREATE TABLE sesiones (
    token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
    usuario_id TEXT NOT NULL,
    creado_en TEXT NOT NULL CHECK(julianday(creado_en) IS NOT NULL) DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expira_en TEXT NOT NULL CHECK(julianday(expira_en) IS NOT NULL AND julianday(expira_en)>julianday(creado_en)),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) STRICT;
CREATE INDEX idx_sesiones_usuario ON sesiones(usuario_id);

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
    ('deslizamiento_izquierda', 'Deslizamiento hacia la izquierda', 'atras'),
    ('deslizamiento_derecha', 'Deslizamiento hacia la derecha', 'adelante'),
    ('dos_dedos', 'Dos dedos', 'desplazar'),
    ('pulgar_arriba', 'Pulgar arriba', 'confirmar'),
    ('pulgar_abajo', 'Pulgar abajo', 'cancelar'),
    ('modo_precision', 'Modo precisión', 'precision'),
    ('trazo_airswipe', 'Trazo en teclado Air-Swipe', 'escritura_airswipe');

-- Sincronización prevista: leer y escribir los perfiles, modos y asignaciones mediante
-- la API REST autenticada. 'version' permite detectar ediciones concurrentes si el
-- backend implementa control optimista; NO implementa por sí sola sincronización.
-- Estado temporal (pausa, cámara, puntero, temporizadores), visión y predicción
-- Air-Swipe permanecen en el dispositivo local. No se exige crear tablas para ellos.

PRAGMA user_version = 1;
COMMIT;
