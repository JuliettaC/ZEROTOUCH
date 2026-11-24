import { createHash } from 'node:crypto';
import { ResourceError } from './resourceError.js';

// ETag opaco de borrado condicional. Un DELETE solo procede si el cliente demuestra que conoce el estado
// exacto que va a destruir; el servidor lo recalcula DENTRO de la transacción que borra.
//  - Modo: identidad + versión. La versión del modo cubre también sus asignaciones (PUT/PATCH de
//    asignaciones la incrementan en su misma transacción).
//  - Perfil: agregado = identidad + versión del perfil + (id, versión) de TODOS sus modos. Así detecta,
//    además de editar el perfil, altas y bajas de modos y cambios de asignaciones (borrado en cascada).
// El mismo algoritmo vive en src/sync/etag.js; ambos se contrastan con contracts/etag-vectores.json.
const encode = text => createHash('sha256').update(text).digest('base64url').slice(0, 32);
export const modeEtag = (id, version) => `"${encode(`modo:${id}|v${version}`)}"`;
export function profileEtag(id, version, modes) {
  const children = modes.map(mode => `${mode.id}:${mode.version}`).sort().join(';');
  return `"${encode(`perfil:${id}|v${version}|${children}`)}"`;
}

const STRONG_ETAG = /^"[A-Za-z0-9_-]{16,64}"$/;
/** Devuelve el ETag del encabezado If-Match, `null` si falta; rechaza comodines, débiles y listas. */
export function parseIfMatch(header) {
  if (header === undefined) return null;
  if (typeof header !== 'string' || !STRONG_ETAG.test(header.trim())) {
    throw new ResourceError(400, 'DATOS_INVALIDOS', 'If-Match debe ser un único ETag fuerte entre comillas.');
  }
  return header.trim();
}
