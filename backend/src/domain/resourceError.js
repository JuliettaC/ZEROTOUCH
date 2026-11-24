export class ResourceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
/** Lanza 400 (por defecto DATOS_INVALIDOS). Único helper de validación de los recursos. */
export const invalid = (message, code = 'DATOS_INVALIDOS') => { throw new ResourceError(400, code, message); };
export const notFound = () => new ResourceError(404, 'NO_ENCONTRADO', 'Recurso inexistente.');
export const conflict = () => new ResourceError(409, 'VERSION_CONFLICTO', 'El recurso cambió; vuelve a consultarlo.');
export const preconditionRequired = () => new ResourceError(428, 'PRECONDICION_REQUERIDA', 'Para borrar envía If-Match con el ETag que consultaste.');
export const preconditionFailed = () => new ResourceError(412, 'PRECONDICION_FALLIDA', 'El recurso cambió desde que lo consultaste; no se borró nada.');
