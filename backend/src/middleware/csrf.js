import { createHmac, timingSafeEqual } from 'node:crypto';
import { AuthError } from '../security/auth-errors.js';

export const csrfToken = raw => createHmac('sha256', raw).update('zerotouch-hito2:csrf:v1').digest('base64url');
export function checkOrigin(req, appOrigin) {
  if ((req.headers.origin && req.headers.origin !== appOrigin) || req.headers['sec-fetch-site'] === 'cross-site') {
    throw new AuthError(403, 'ORIGEN_DENEGADO', 'Origen no permitido.');
  }
}
export function checkCsrf(req, raw) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const supplied = req.headers['x-csrf-token'];
  const expected = csrfToken(raw);
  if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw new AuthError(403, 'CSRF_INVALIDO', 'Solicitud no permitida.');
  }
}
