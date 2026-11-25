import { profileEtag } from '../domain/etag.js';
import { MAX_PERFILES_POR_USUARIO } from '../domain/cuotas.js';

export function createPerfilesRepository(db, usuarioId) {
  if (!usuarioId) throw new Error('Se requiere propietario.');
  const modesOf = perfilId => db.prepare('SELECT id,version FROM modos_uso WHERE perfil_id=?').all(perfilId);
  return {
    get: id => db.prepare('SELECT * FROM perfiles WHERE id=? AND usuario_id=?').get(id, usuarioId),
    list: ({ limite, offset }) => db.prepare('SELECT * FROM perfiles WHERE usuario_id=? ORDER BY creado_en,id LIMIT ? OFFSET ?').all(usuarioId, limite, offset),
    /** Crea el perfil si la cuenta no alcanzó la cuota (comprobación e inserción en una sola sentencia). `undefined` si la alcanzó. */
    create(data) {
      return db.prepare('INSERT INTO perfiles(id,usuario_id,nombre,descripcion) SELECT ?,?,?,? WHERE (SELECT count(*) FROM perfiles WHERE usuario_id=?) < ? RETURNING *')
        .get(data.id, usuarioId, data.nombre, data.descripcion, usuarioId, MAX_PERFILES_POR_USUARIO);
    },
    update(id, data) {
      const keys = ['nombre', 'descripcion'].filter(key => Object.hasOwn(data, key));
      return db.prepare(`UPDATE perfiles SET ${keys.map(key => `${key}=?`).join(',')},version=version+1,actualizado_en=? WHERE id=? AND usuario_id=? AND version=? RETURNING *`)
        .get(...keys.map(key => data[key]), new Date().toISOString(), id, usuarioId, data.version);
    },
    /** ETag de agregado del perfil (instantánea de su versión y la de todos sus modos). */
    etag: row => db.transaction(() => profileEtag(row.id, row.version, modesOf(row.id))).deferred(),
    /**
     * Borra el perfil y, en cascada, sus modos y asignaciones, SOLO si el agregado coincide con `etag`.
     * Lectura, comparación y borrado ocurren en una misma transacción con bloqueo de escritura, así que
     * ninguna escritura concurrente puede colarse entre la comprobación y el borrado.
     * @returns {'missing'|'stale'|'deleted'}
     */
    deleteIfMatch(id, etag) {
      return db.transaction(() => {
        const profile = db.prepare('SELECT * FROM perfiles WHERE id=? AND usuario_id=?').get(id, usuarioId);
        if (!profile) return 'missing';
        if (profileEtag(profile.id, profile.version, modesOf(profile.id)) !== etag) return 'stale';
        // Defensa en profundidad: si la fila ya no tiene esa versión, no se declara borrada.
        const { changes } = db.prepare('DELETE FROM perfiles WHERE id=? AND usuario_id=? AND version=?').run(profile.id, usuarioId, profile.version);
        return changes === 1 ? 'deleted' : 'stale';
      }).immediate();
    },
  };
}
