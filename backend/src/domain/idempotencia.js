import { createHash } from 'node:crypto';
import { ResourceError } from './resourceError.js';

// Idempotencia de las creaciones por POST (Idempotency-Key). Funciones puras: sin base de datos ni reloj propio.
//
// - La clave es un UUID v7 en minúsculas: sus 48 primeros bits son la hora de creación en milisegundos.
//   Una clave más vieja que la retención se rechaza SIEMPRE (422), exista o no su fila. Por eso purgar las
//   filas antiguas nunca permite recrear una operación: una clave aceptada por esta regla jamás ha sido purgada.
//   Ojo: la hora de la clave puede estar hasta TOLERANCIA_RELOJ_MS POR DELANTE de creado_en (cliente adelantado), así que
//   una fila con creado_en = hora de la clave - 4 min seguiría cubierta por la clave 4 min DESPUÉS de cumplir la
//   retención desde creado_en. Por eso la purga espera RETENCION + TOLERANCIA (ver retentionCutoff): aceptada ⇒ no purgada.
// - La huella (SHA-256) cubre el método, la ruta (con el perfil padre) y el cuerpo YA validado y normalizado:
//   mismo cuerpo equivalente => misma huella; cualquier cambio => 409.
export const RETENCION_DIAS = 30;
export const RETENCION_MS = RETENCION_DIAS * 24 * 60 * 60 * 1000;
export const TOLERANCIA_RELOJ_MS = 5 * 60 * 1000;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Marca de tiempo (ms desde 1970) incrustada en un UUID v7 ya validado. */
export const keyTimestamp = key => parseInt(key.slice(0, 8) + key.slice(9, 13), 16);

/**
 * Valida la cabecera Idempotency-Key. Devuelve `null` si falta.
 * 400 IDEMPOTENCIA_CLAVE_INVALIDA si no es un UUID v7 en minúsculas o su hora está en el futuro;
 * 422 IDEMPOTENCIA_CLAVE_EXPIRADA si es más vieja que la retención.
 */
export function parseIdempotencyKey(header, now = Date.now()) {
  if (header === undefined) return null;
  const key = typeof header === 'string' ? header.trim() : '';
  if (!UUID_V7.test(key)) throw new ResourceError(400, 'IDEMPOTENCIA_CLAVE_INVALIDA', 'Idempotency-Key debe ser un UUID v7 en minúsculas.');
  const stamp = keyTimestamp(key);
  if (stamp > now + TOLERANCIA_RELOJ_MS) throw new ResourceError(400, 'IDEMPOTENCIA_CLAVE_INVALIDA', 'La hora incrustada en la clave está en el futuro.');
  if (now - stamp > RETENCION_MS) {
    throw new ResourceError(422, 'IDEMPOTENCIA_CLAVE_EXPIRADA', `La clave tiene más de ${RETENCION_DIAS} días: ya no puede repetirse. Genera una nueva y comprueba antes si la creación se aplicó.`);
  }
  return key;
}

/** JSON canónico: claves ordenadas, sin espacios. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const fingerprint = ({ metodo, ruta, cuerpo }) => createHash('sha256').update(canonicalJson({ metodo, ruta, cuerpo })).digest('hex');
/** Las filas con creado_en anterior a este corte se pueden purgar: la retención MÁS la tolerancia de reloj (ver arriba). */
export const retentionCutoff = (now = Date.now()) => new Date(now - RETENCION_MS - TOLERANCIA_RELOJ_MS).toISOString();
