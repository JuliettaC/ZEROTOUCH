import { createSesionesRepository } from '../repositories/sesionesRepository.js';
import { sessionHash } from '../services/authService.js';
import { authConfig } from '../security/auth-config.js';
import { AuthError } from '../security/auth-errors.js';
import { checkCsrf, checkOrigin } from './csrf.js';

export function readSessionCookie(req) {
  const values = (req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith('zt_session='));
  const raw = values.length === 1 ? values[0].slice('zt_session='.length) : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new AuthError(401, 'SESION_INVALIDA', 'Inicia sesión.');
  return raw;
}
export function createAuthMiddleware({ db, config }) {
  const sessions = createSesionesRepository(db), settings = authConfig(config);
  return (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      checkOrigin(req, settings.appOrigin);
      const raw = readSessionCookie(req), hash = sessionHash(raw), session = sessions.get(hash);
      // Backend enforcement of email verification: an unverified account never passes this point,
      // even with a session created before the v2 migration.
      if (!session || session.estado !== 'activo' || !session.correo_verificado_en || Date.parse(session.expira_en) <= Date.now()) {
        throw new AuthError(401, 'SESION_INVALIDA', 'Inicia sesión.');
      }
      checkCsrf(req, raw);
      req.auth = { usuarioId: session.usuario_id, rol: session.rol, sesionId: hash };
      next();
    } catch (error) { next(error); }
  };
}
