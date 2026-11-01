import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createUsuariosRepository } from '../repositories/usuariosRepository.js';
import { createSesionesRepository } from '../repositories/sesionesRepository.js';
import { fields, username, password } from '../security/auth-validation.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import { AuthError } from '../security/auth-errors.js';
import { authLimiter } from '../security/rate-limit.js';
import { authConfig } from '../security/auth-config.js';
import { csrfToken } from '../middleware/csrf.js';

export const sessionHash = raw => createHash('sha256').update(raw).digest('hex');
export const publicUser = user => ({ id: user.id, nombre_usuario: user.nombre_usuario, rol: user.rol, estado: user.estado });

export function createAuthService({ db, config }) {
  const users = createUsuariosRepository(db), sessions = createSesionesRepository(db);
  const settings = authConfig(config), limit = authLimiter(db);
  function credentials(body, ip, action) {
    limit(`${action}:ip`, ip, action === 'registro' ? 10 : 30);
    fields(body, ['nombre_usuario', 'contrasena']);
    const name = username(body.nombre_usuario), secret = password(body.contrasena);
    limit(`${action}:usuario`, name, 10);
    return { name, secret };
  }
  return {
    async register(body, ip) {
      const { name, secret } = credentials(body, ip, 'registro');
      const hash = await hashPassword(secret);
      return users.transaction(() => {
        if (users.byName(name)) throw new AuthError(409, 'USUARIO_DUPLICADO', 'El nombre de usuario no está disponible.');
        const id = randomUUID();
        users.insert({ id, nombre_usuario: name, contrasena_hash: hash });
        return publicUser(users.get(id));
      });
    },
    async login(body, ip) {
      const { name, secret } = credentials(body, ip, 'login');
      const snapshot = users.byName(name);
      const valid = await verifyPassword(snapshot?.contrasena_hash, secret);
      if (!valid || !snapshot || snapshot.estado !== 'activo') throw new AuthError(401, 'CREDENCIALES_INVALIDAS', 'Credenciales inválidas.');
      return users.transaction(() => {
        // Hash verification awaits work: recheck account state before issuing a session.
        const user = users.get(snapshot.id);
        if (!user || user.estado !== 'activo' || user.rol !== snapshot.rol || user.contrasena_hash !== snapshot.contrasena_hash) {
          throw new AuthError(401, 'CREDENCIALES_INVALIDAS', 'Credenciales inválidas.');
        }
        const raw = randomBytes(32).toString('base64url'), now = Date.now();
        sessions.insert({ token_hash: sessionHash(raw), usuario_id: user.id,
          creado_en: new Date(now).toISOString(), expira_en: new Date(now + settings.sessionTtlSeconds * 1000).toISOString() });
        return { raw, data: { usuario: publicUser(user), csrf_token: csrfToken(raw) } };
      });
    },
    session(auth, raw) {
      const user = users.get(auth.usuarioId);
      if (!user || user.estado !== 'activo') throw new AuthError(401, 'SESION_INVALIDA', 'Inicia sesión.');
      return { usuario: publicUser(user), csrf_token: csrfToken(raw) };
    },
    logout: auth => sessions.remove(auth.sesionId),
  };
}
