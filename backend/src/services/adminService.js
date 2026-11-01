import { randomUUID } from 'node:crypto';
import { createUsuariosRepository } from '../repositories/usuariosRepository.js';
import { createSesionesRepository } from '../repositories/sesionesRepository.js';
import { AuthError } from '../security/auth-errors.js';
import { fields, uuid, pagination, username, password } from '../security/auth-validation.js';
import { hashPassword } from '../security/passwords.js';
import { publicUser } from './authService.js';

export function createAdminService({ db }) {
  const users = createUsuariosRepository(db), sessions = createSesionesRepository(db);
  function authorize(auth) {
    const actor = auth && users.get(auth.usuarioId);
    const session = auth && sessions.get(auth.sesionId);
    if (!actor || !session || session.usuario_id !== actor.id || actor.estado !== 'activo'
      || Date.parse(session.expira_en) <= Date.now()) throw new AuthError(401, 'SESION_INVALIDA', 'Inicia sesión.');
    if (actor.rol !== 'admin') throw new AuthError(403, 'ACCESO_DENEGADO', 'Se requiere rol administrador.');
  }
  return {
    list(auth, query) {
      authorize(auth);
      const page = pagination(query);
      return { data: users.list(page), paginacion: page };
    },
    update(auth, id, body, kind) {
      authorize(auth);
      id = uuid(id);
      fields(body, [kind]);
      const allowed = kind === 'rol' ? ['user', 'admin'] : ['activo', 'suspendido'];
      if (!['rol', 'estado'].includes(kind) || !allowed.includes(body[kind])) {
        throw new AuthError(400, 'DATOS_INVALIDOS', 'Valor administrativo inválido.');
      }
      return users.transaction(() => {
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
    },
  };
}

// CLI only. No public bootstrap route and no default administrator credentials.
export async function bootstrapAdmin(db, name, secret) {
  const normalized = username(name), hash = await hashPassword(password(secret));
  const users = createUsuariosRepository(db);
  return users.transaction(() => {
    if (users.activeAdmins() > 0) throw new AuthError(409, 'ADMIN_EXISTENTE', 'Ya existe un administrador activo.');
    if (users.byName(normalized)) throw new AuthError(409, 'USUARIO_DUPLICADO', 'No se reemplazan cuentas existentes.');
    const id = randomUUID();
    users.insert({ id, nombre_usuario: normalized, contrasena_hash: hash, rol: 'admin' });
    return publicUser(users.get(id));
  });
}
