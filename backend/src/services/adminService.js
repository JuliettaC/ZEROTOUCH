import { randomUUID } from 'node:crypto';
import { createUsuariosRepository } from '../repositories/usuariosRepository.js';
import { createSesionesRepository } from '../repositories/sesionesRepository.js';
import { createTokensCuentaRepository } from '../repositories/tokensCuentaRepository.js';
import { AuthError } from '../security/auth-errors.js';
import { fields, uuid, pagination, username, password, email } from '../security/auth-validation.js';
import { hashPassword } from '../security/passwords.js';
import { silentSecurityLog } from '../security/audit-log.js';
import { VERIFICATION_TTL_SECONDS } from '../security/account-tokens.js';
import { publicUser, isVerified, issueAccountToken } from './authService.js';

export function createAdminService({ db, log = silentSecurityLog }) {
  const users = createUsuariosRepository(db), sessions = createSesionesRepository(db);
  function authorize(auth) {
    const actor = auth && users.get(auth.usuarioId);
    const session = auth && sessions.get(auth.sesionId);
    if (!actor || !session || session.usuario_id !== actor.id || actor.estado !== 'activo' || !isVerified(actor)
      || Date.parse(session.expira_en) <= Date.now()) throw new AuthError(401, 'SESION_INVALIDA', 'Inicia sesión.');
    if (actor.rol !== 'admin') {
      log('admin_denegado', { usuario_id: actor.id });
      throw new AuthError(403, 'ACCESO_DENEGADO', 'Se requiere rol administrador.');
    }
  }
  return {
    list(auth, query) {
      authorize(auth);
      const page = pagination(query);
      return { data: users.list(page).map(publicUser), paginacion: page };
    },
    update(auth, id, body, kind) {
      authorize(auth);
      id = uuid(id);
      fields(body, [kind]);
      const allowed = kind === 'rol' ? ['user', 'admin'] : ['activo', 'suspendido'];
      if (!['rol', 'estado'].includes(kind) || !allowed.includes(body[kind])) {
        throw new AuthError(400, 'DATOS_INVALIDOS', 'Valor administrativo inválido.');
      }
      const result = users.transaction(() => {
        authorize(auth);
        const target = users.get(id);
        if (!target) throw new AuthError(404, 'NO_ENCONTRADO', 'Usuario inexistente.');
        const changed = { ...target, [kind]: body[kind] };
        if (target.rol === 'admin' && target.estado === 'activo'
          && (changed.rol !== 'admin' || changed.estado !== 'activo') && users.activeAdmins() <= 1) {
          throw new AuthError(409, 'ULTIMO_ADMIN', 'Debe permanecer un administrador activo.');
        }
        if (kind === 'rol') users.updateRole(id, body[kind]);
        else users.updateStatus(id, body[kind]);
        sessions.revoke(id);
        return publicUser(users.get(id));
      });
      log(kind === 'rol' ? 'admin_cambio_rol' : 'admin_cambio_estado', { usuario_id: auth.usuarioId, objetivo_id: id, valor: body[kind] });
      return result;
    },
  };
}

// CLI only. No public bootstrap route and no default administrator credentials.
// The administrator is created unverified, like any account; the caller sends the returned
// single-use token by email (the raw token is never stored or printed).
export async function bootstrapAdmin(db, name, secret, address) {
  const normalized = username(name), correo = email(address), hash = await hashPassword(password(secret));
  const users = createUsuariosRepository(db), tokens = createTokensCuentaRepository(db);
  return users.transaction(() => {
    if (users.activeAdmins() > 0) throw new AuthError(409, 'ADMIN_EXISTENTE', 'Ya existe un administrador activo.');
    if (users.byName(normalized)) throw new AuthError(409, 'USUARIO_DUPLICADO', 'No se reemplazan cuentas existentes.');
    if (users.byEmail(correo)) throw new AuthError(409, 'CORREO_DUPLICADO', 'Ese correo ya pertenece a otra cuenta.');
    const id = randomUUID();
    users.insert({ id, nombre_usuario: normalized, contrasena_hash: hash, rol: 'admin', correo });
    const token = issueAccountToken(tokens, { usuarioId: id, proposito: 'verificacion', correo, ttlSeconds: VERIFICATION_TTL_SECONDS });
    return { usuario: publicUser(users.get(id)), correo, token };
  });
}
