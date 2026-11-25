-- ZeroTouch | Migración del esquema 3 al 4 (24-11-2026): retira del catálogo los gestos que la aplicación ya no ofrece.
-- Gestos retirados: deslizamiento_izquierda, deslizamiento_derecha, pulgar_arriba, pulgar_abajo y modo_precision.
-- A diferencia de 001 y 002, esta migración SÍ borra filas: las asignaciones de esos gestos en cada modo y sus filas
-- del catálogo `gestos`. No toca tablas, columnas, cuentas, perfiles, modos ni el resto de las asignaciones.
-- Las acciones (atras, adelante, confirmar, cancelar, precision) se conservan: la palma abierta puede seguir usándolas.
-- Ejecutar SOLO mediante `npm run db:migrate --prefix backend`: el script valida application_id y user_version,
-- crea un respaldo consistente de la base y aplica este archivo en una transacción (con fallo, no se cambia nada).
-- La definición coincide con db/schema.sql v4.

DELETE FROM asignaciones_gestos
WHERE gesto_codigo IN ('deslizamiento_izquierda', 'deslizamiento_derecha', 'pulgar_arriba', 'pulgar_abajo', 'modo_precision');

DELETE FROM gestos
WHERE codigo IN ('deslizamiento_izquierda', 'deslizamiento_derecha', 'pulgar_arriba', 'pulgar_abajo', 'modo_precision');

PRAGMA user_version = 4;
