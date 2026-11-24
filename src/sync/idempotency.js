// Claves de idempotencia para las creaciones (POST /perfiles y /perfiles/{id}/modos).
//
// El servidor acepta UUID v7 (RFC 9562): los 48 bits altos son la hora en milisegundos, así que la propia clave
// indica su antigüedad y el servidor puede rechazar las que superan la retención sin consultar nada. La clave se
// genera UNA vez por creación, se guarda con la operación pendiente (`syncOperation.key`) y se reutiliza en cada
// reintento: es lo que permite recuperar una creación cuya respuesta se perdió sin duplicarla.
export const IDEMPOTENCY_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const randomBytes = (bytes) => globalThis.crypto.getRandomValues(bytes)

/**
 * @param {{now?: number, random?: (bytes: Uint8Array) => Uint8Array}} [options] inyectables para las pruebas
 * @returns {string} UUID v7 en minúsculas, p. ej. `0192f3a4-5b6c-7d8e-9f01-23456789abcd`
 */
export function newIdempotencyKey({ now = Date.now(), random = randomBytes } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48)
    throw new RangeError('La hora de la clave debe caber en 48 bits.')
  const bytes = new Uint8Array(16)
  random(bytes)
  for (let i = 5, rest = now; i >= 0; i -= 1) {
    bytes[i] = rest % 256
    rest = Math.floor(rest / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70 // versión 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variante RFC 9562
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const isIdempotencyKey = (value) =>
  typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value)

/** Hora (ms desde 1970) incrustada en la clave, o `null` si no es una clave válida. */
export function idempotencyKeyTime(key) {
  if (!isIdempotencyKey(key)) return null
  return Number.parseInt(key.replaceAll('-', '').slice(0, 12), 16)
}

/** Códigos con los que el servidor indica que NO puede recuperar la creación por su clave. */
export const IDEMPOTENCY_UNAVAILABLE_CODES = new Set([
  'IDEMPOTENCIA_CLAVE_INVALIDA',
  'IDEMPOTENCIA_CLAVE_EXPIRADA',
  'IDEMPOTENCIA_CONFLICTO',
  'IDEMPOTENCIA_NO_DISPONIBLE',
])
