import { ResourceError } from '../domain/resourceError.js';
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = 500, code = 'ERROR_INTERNO', message = 'No se pudo completar la operación.';
  if (error instanceof ResourceError) { status = error.status; code = error.code; message = error.message; }
  else if (error.type === 'entity.parse.failed' || error instanceof URIError) { status = 400; code = 'JSON_O_RUTA_INVALIDA'; message = 'JSON o ruta inválidos.'; }
  else if (error.type === 'entity.too.large') { status = 413; code = 'CUERPO_EXCESIVO'; message = 'El cuerpo supera 16 KB.'; }
  else if (error.status === 415) { status = 415; code = 'FORMATO_NO_SOPORTADO'; message = 'Usa application/json y UTF-8 sin compresión.'; }
  else if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') { status = 409; code = 'NOMBRE_DUPLICADO'; message = 'Ya existe un recurso con ese nombre en este ámbito.'; }
  else if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') { status = 409; code = 'RELACION_INVALIDA'; message = 'La operación viola una relación.'; }
  else if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_BUSY_SNAPSHOT') { status = 503; code = 'DATOS_OCUPADOS'; message = 'La base está ocupada; reintenta más tarde.'; }
  if (status === 503) res.set('Retry-After', '1');
  res.status(status).json({ error: code, mensaje: message });
}
