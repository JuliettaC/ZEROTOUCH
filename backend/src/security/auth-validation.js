import { AuthError } from './auth-errors.js';

export const invalid = message => { throw new AuthError(400, 'DATOS_INVALIDOS', message); };
export function fields(body, allowed, required = allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(body, key))) invalid('Campos inválidos.');
  return body;
}
export function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,40}$/.test(value)) {
    invalid('nombre_usuario requiere de 3 a 40 letras ASCII, números o guion bajo.');
  }
  return value.toLowerCase();
}
// ASCII addresses only (no SMTPUTF8/IDN). Normalized to lowercase: providers treat the
// local part case-insensitively in practice, and uniqueness must not depend on letter case.
const EMAIL_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const EMAIL_PATTERN = new RegExp(`^[a-z0-9!#$%&'*+/=?^_\`{|}~-]+(?:\\.[a-z0-9!#$%&'*+/=?^_\`{|}~-]+)*@${EMAIL_LABEL}(?:\\.${EMAIL_LABEL})+$`);
export function email(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const local = normalized.split('@')[0];
  if (normalized.length < 6 || normalized.length > 254 || local.length > 64 || !EMAIL_PATTERN.test(normalized)) {
    invalid('correo requiere una dirección válida de hasta 254 caracteres ASCII.');
  }
  return normalized;
}
export function accountToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new AuthError(400, 'TOKEN_INVALIDO', 'El enlace no es válido o ya fue utilizado.');
  }
  return value;
}
export function password(value) {
  if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128
    || Buffer.byteLength(value, 'utf8') > 512) invalid('contrasena requiere de 15 a 128 caracteres.');
  return value;
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    invalid('Identificador UUID v4 inválido.');
  }
  return value.toLowerCase();
}
export function pagination(query) {
  if (Object.keys(query).some(key => !['limite', 'offset'].includes(key))) invalid('Parámetro desconocido.');
  const parse = (key, fallback, maximum) => {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string' || !/^\d+$/.test(query[key])
      || !Number.isSafeInteger(Number(query[key])) || Number(query[key]) > maximum) invalid('Paginación inválida.');
    return Number(query[key]);
  };
  const limite = parse('limite', 20, 100), offset = parse('offset', 0, Number.MAX_SAFE_INTEGER);
  if (limite === 0) invalid('limite debe ser mayor que cero.');
  return { limite, offset };
}
