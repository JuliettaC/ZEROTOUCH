// Registro de las creaciones ya aplicadas, por usuario. Todo acceso queda delimitado por el propietario.
const PURGE_BATCH = 200;

export function createIdempotenciaRepository(db, usuarioId) {
  if (!usuarioId) throw new Error('Se requiere propietario.');
  return {
    count: () => db.prepare('SELECT count(*) FROM idempotencia WHERE usuario_id=?').pluck().get(usuarioId),
    find: clave => db.prepare('SELECT huella, respuesta FROM idempotencia WHERE usuario_id=? AND clave=?').get(usuarioId, clave),
    // `creadoEn` viene del mismo reloj que usa la regla de antigüedad, para que ambas sean coherentes (y comprobables).
    insert: row => db.prepare('INSERT INTO idempotencia(usuario_id,clave,huella,recurso_tipo,recurso_id,respuesta,creado_en) VALUES(?,?,?,?,?,?,?)')
      .run(usuarioId, row.clave, row.huella, row.tipo, row.recurso, row.respuesta, row.creadoEn),
    /** Purga acotada (por lotes) de filas anteriores al corte; el resto se purga en próximas creaciones. */
    purge: cutoff => db.prepare('DELETE FROM idempotencia WHERE rowid IN (SELECT rowid FROM idempotencia WHERE creado_en < ? LIMIT ?)').run(cutoff, PURGE_BATCH).changes,
    /** Ejecuta `work` en UNA transacción con bloqueo de escritura: la creación del recurso y su registro van juntos. */
    atomic: work => db.transaction(work).immediate(),
  };
}
