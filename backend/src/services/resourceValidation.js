import { ResourceError } from '../domain/resourceError.js';

const invalid = message => { throw new ResourceError(400, 'DATOS_INVALIDOS', message); };
export function validateId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid('Se requiere UUID v4.');
  return value.toLowerCase();
}
export function validateQuery(query, paginated = true) {
  const allowed = paginated ? ['limite', 'offset'] : [];
  if (Object.keys(query).some(key => !allowed.includes(key))) invalid('Parámetro desconocido.');
  if (!paginated) return;
  const parse = (key, fallback, maximum) => {
    if (query[key] === undefined) return fallback;
    if (typeof query[key] !== 'string' || !/^\d+$/.test(query[key]) || !Number.isSafeInteger(Number(query[key])) || Number(query[key]) > maximum) invalid('Paginación inválida.');
    return Number(query[key]);
  };
  const limite = parse('limite', 20, 100), offset = parse('offset', 0, Number.MAX_SAFE_INTEGER);
  if (!limite) invalid('limite debe ser de 1 a 100.');
  return { limite, offset };
}
export const modeBooleans = ['desk_rest_habilitado', 'asistencia_mirada_habilitada', 'activacion_contextual_movil'];
export const modeNumbers = ['sensibilidad_puntero', 'estabilizacion_puntero', 'tolerancia_micro_pinza'];
export const modeFields = ['nombre', 'categoria', 'plataforma', ...modeNumbers, ...modeBooleans];
export function validateBody(kind, body, patch = false) {
  const allowed = kind === 'perfil' ? ['nombre', 'descripcion'] : modeFields;
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Se requiere un objeto JSON.');
  const keys = Object.keys(body);
  if (keys.some(key => !allowed.includes(key) && !(patch && key === 'version'))) invalid('Campo no permitido.');
  if (patch && (!keys.some(key => allowed.includes(key)) || !Number.isSafeInteger(body.version) || body.version < 1 || body.version >= Number.MAX_SAFE_INTEGER)) invalid('PATCH requiere cambios y version entera positiva.');
  if (!patch && !Object.hasOwn(body, 'nombre')) invalid('nombre es obligatorio.');
  const result = { ...body };
  if (Object.hasOwn(body, 'nombre')) {
    if (typeof body.nombre !== 'string') invalid('nombre debe ser texto.');
    result.nombre = body.nombre.trim().normalize('NFC');
    if (!result.nombre || result.nombre.length > 60 || result.nombre.includes('\0')) invalid('nombre debe tener de 1 a 60 caracteres sin NUL.');
  }
  if (Object.hasOwn(body, 'descripcion') && (typeof body.descripcion !== 'string' || body.descripcion.length > 300 || body.descripcion.includes('\0'))) invalid('descripcion debe ser texto de hasta 300 caracteres.');
  for (const key of modeNumbers) if (Object.hasOwn(body, key) && (!Number.isInteger(body[key]) || body[key] < 0 || body[key] > 100)) invalid(`${key} debe ser entero de 0 a 100.`);
  for (const key of modeBooleans) if (Object.hasOwn(body, key) && typeof body[key] !== 'boolean') invalid(`${key} debe ser booleano.`);
  if (Object.hasOwn(body, 'categoria') && !['manual', 'oficina', 'accesibilidad', 'personalizado'].includes(body.categoria)) invalid('categoria inválida.');
  if (Object.hasOwn(body, 'plataforma') && !['pc', 'movil'].includes(body.plataforma)) invalid('plataforma inválida.');
  return result;
}
