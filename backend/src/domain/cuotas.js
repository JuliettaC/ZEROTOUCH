import { ResourceError } from './resourceError.js';

// Cuotas por cuenta (OWASP A04, consumo de recursos). Sin ellas una sola cuenta podía crear perfiles, modos y filas
// de idempotencia sin límite y llenar el disco del servidor. Los valores son holgados para el uso real de la app
// (unos pocos perfiles con unos pocos modos cada uno).
export const MAX_PERFILES_POR_USUARIO = 100;
export const MAX_MODOS_POR_PERFIL = 50;
// Creaciones idempotentes registradas por cuenta dentro de la retención (30 días). Las filas no se recortan antes de
// tiempo (romperían la garantía de no repetir una creación); al llegar al tope se rechazan creaciones nuevas con clave.
export const MAX_IDEMPOTENCIA_POR_USUARIO = 2000;

export const quotaExceeded = recurso => new ResourceError(409, 'LIMITE_RECURSOS', `Se alcanzó el máximo de ${recurso} permitido para esta cuenta.`);
