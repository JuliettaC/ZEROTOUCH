export class ResourceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const notFound = () => new ResourceError(404, 'NO_ENCONTRADO', 'Recurso inexistente.');
export const conflict = () => new ResourceError(409, 'VERSION_CONFLICTO', 'El recurso cambió; vuelve a consultarlo.');
