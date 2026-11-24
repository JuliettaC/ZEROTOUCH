import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createUsuariosRepository } from '../repositories/usuariosRepository.js';
import { createSesionesRepository } from '../repositories/sesionesRepository.js';
import { createTokensCuentaRepository } from '../repositories/tokensCuentaRepository.js';
import { fields, username, password, newPassword, email, accountToken } from '../security/auth-validation.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import { AuthError } from '../security/auth-errors.js';
import { authLimiter } from '../security/rate-limit.js';
import { authConfig } from '../security/auth-config.js';
import { csrfToken } from '../middleware/csrf.js';
import { silentSecurityLog } from '../security/audit-log.js';
import {
  VERIFICATION_TTL_SECONDS, RESET_TTL_SECONDS, RESEND_COOLDOWN_SECONDS, newAccountToken, accountTokenHash,
} from '../security/account-tokens.js';
import { verificationMessage, resetMessage, existingAccountNotice, passwordChangedNotice } from '../security/mail-templates.js';

export const sessionHash = raw => createHash('sha256').update(raw).digest('hex');
export const isVerified = user => Boolean(user?.correo && user.correo_verificado_en);
export const publicUser = user => ({
  id: user.id, nombre_usuario: user.nombre_usuario, rol: user.rol, estado: user.estado,
  correo_verificado: Boolean(user.correo_verificado_en),
});

// Identical answers whether or not an address exists, to prevent account enumeration.
export const PENDING_VERIFICATION = Object.freeze({
  estado_verificacion: 'pendiente',
  mensaje: 'Si los datos son válidos, enviamos un enlace de verificación al correo indicado. Revisa tu bandeja de entrada y la carpeta de spam.',
});
export const REQUEST_ACCEPTED = Object.freeze({
  mensaje: 'Si existe una cuenta pendiente asociada a ese correo, enviaremos un mensaje con las instrucciones.',
});
const invalidCredentials = () => new AuthError(401, 'CREDENCIALES_INVALIDAS', 'Correo, usuario o contraseña incorrectos.');
// Only reported after a correct password, so it tells nothing to someone without the password.
// Accounts without an email and accounts with an unconfirmed one get this same answer: a person
// who registered with someone else's address cannot learn whether that address was already taken.
const unverifiedAccount = () => new AuthError(403, 'CUENTA_NO_VERIFICADA', 'Confirma tu correo para entrar. Revisa tu bandeja de entrada o pide un enlace nuevo.');
const invalidToken = () => new AuthError(400, 'TOKEN_INVALIDO', 'El enlace no es válido o ya fue utilizado.');
const expiredToken = () => new AuthError(400, 'TOKEN_EXPIRADO', 'El enlace venció. Solicita uno nuevo.');

export function issueAccountToken(tokens, { usuarioId, proposito, correo, ttlSeconds, now = Date.now() }) {
  const raw = newAccountToken();
  tokens.issue({
    token_hash: accountTokenHash(raw), usuario_id: usuarioId, proposito, correo,
    creado_en: new Date(now).toISOString(), expira_en: new Date(now + ttlSeconds * 1000).toISOString(),
  });
  return raw;
}

export function createAuthService({ db, config, mailer, log = silentSecurityLog }) {
  if (typeof mailer?.send !== 'function') throw new Error('Se requiere un servicio de correo.');
  const users = createUsuariosRepository(db), sessions = createSesionesRepository(db), tokens = createTokensCuentaRepository(db);
  const settings = authConfig(config), limit = authLimiter(db);

  // The answer never waits for SMTP: response time does not reveal whether a message was sent.
  function deliver(message, proposito, usuarioId) {
    let pending;
    try { pending = Promise.resolve(mailer.send(message)); } catch (error) { pending = Promise.reject(error); }
    pending.catch(() => log('correo_fallido', { proposito, usuario_id: usuarioId }));
  }
  const coolingDown = (usuarioId, proposito, now) => {
    const last = tokens.latest(usuarioId, proposito);
    return Boolean(last) && now - Date.parse(last.creado_en) < RESEND_COOLDOWN_SECONDS * 1000;
  };
  function credentials(body, ip, action, extra = []) {
    limit(`${action}:ip`, ip, action === 'registro' ? 10 : 30);
    fields(body, ['nombre_usuario', 'contrasena', ...extra]);
    const name = username(body.nombre_usuario), secret = password(body.contrasena);
    limit(`${action}:usuario`, name, 10);
    return { name, secret };
  }
  // Sign-in style credentials: `nombre_usuario` may hold the account name or its email address.
  function signIn(body, ip, action, extra = []) {
    limit(`${action}:ip`, ip, 30);
    fields(body, ['nombre_usuario', 'contrasena', ...extra]);
    const byEmail = typeof body.nombre_usuario === 'string' && body.nombre_usuario.includes('@');
    const identifier = byEmail ? email(body.nombre_usuario) : username(body.nombre_usuario), secret = password(body.contrasena);
    limit(`${action}:usuario`, identifier, 10);
    return { snapshot: byEmail ? users.byEmail(identifier) : users.byName(identifier), secret };
  }
  // Token lookup shared by verification and reset. Returns an error kind instead of throwing so
  // the deletion of an expired or orphaned token is committed by the surrounding transaction.
  function readToken(hash, proposito) {
    const row = tokens.find(hash, proposito);
    if (!row) return { error: 'invalido' };
    if (Date.parse(row.expira_en) <= Date.now()) { tokens.remove(hash); return { error: 'expirado' }; }
    const user = users.get(row.usuario_id);
    if (!user || user.correo !== row.correo) { tokens.remove(hash); return { error: 'invalido' }; }
    return { row, user };
  }
  const tokenError = kind => kind === 'expirado' ? expiredToken() : invalidToken();

  return {
    async register(body, ip) {
      const { name, secret } = credentials(body, ip, 'registro', ['correo']);
      const correo = email(body.correo);
      limit('registro:correo', correo, 5);
      newPassword(secret, { nombreUsuario: name, correo });
      const hash = await hashPassword(secret);
      const now = Date.now();
      const outcome = users.transaction(() => {
        if (users.byName(name)) throw new AuthError(409, 'USUARIO_DUPLICADO', 'El nombre de usuario no está disponible.');
        const owner = users.byEmail(correo);
        const id = randomUUID();
        // An address owned by another account is neither reassigned nor revealed: the new account
        // is stored without email (it cannot sign in until it links its own) and the owner is notified.
        users.insert({ id, nombre_usuario: name, contrasena_hash: hash, correo: owner ? null : correo });
        if (owner) return { id, owner };
        return { id, raw: issueAccountToken(tokens, { usuarioId: id, proposito: 'verificacion', correo, ttlSeconds: VERIFICATION_TTL_SECONDS, now }) };
      });
      if (!outcome.owner) {
        deliver(verificationMessage({ to: correo, nombreUsuario: name, link: settings.links.verify(outcome.raw) }), 'verificacion', outcome.id);
      } else if (limit('aviso:correo', correo, 3, { silent: true })) {
        deliver(existingAccountNotice({ to: correo, nombreUsuario: outcome.owner.nombre_usuario, resetPage: settings.links.resetPage }), 'aviso_registro', outcome.owner.id);
      }
      log('registro', { usuario_id: outcome.id, resultado: 'pendiente_verificacion' });
      return PENDING_VERIFICATION;
    },
    async login(body, ip) {
      const { snapshot, secret } = signIn(body, ip, 'login');
      const valid = await verifyPassword(snapshot?.contrasena_hash, secret);
      if (!valid || !snapshot || snapshot.estado !== 'activo') {
        log('login_rechazado', { usuario_id: snapshot?.id, codigo: !valid || !snapshot ? 'CREDENCIALES' : 'SUSPENDIDA' });
        throw invalidCredentials();
      }
      if (!isVerified(snapshot)) {
        log('login_rechazado', { usuario_id: snapshot.id, codigo: 'NO_VERIFICADA' });
        throw unverifiedAccount();
      }
      return users.transaction(() => {
        // Hash verification awaits work: recheck account state before issuing a session.
        const user = users.get(snapshot.id);
        if (!user || user.estado !== 'activo' || user.rol !== snapshot.rol || user.contrasena_hash !== snapshot.contrasena_hash) {
          throw invalidCredentials();
        }
        if (!isVerified(user)) throw unverifiedAccount();
        const raw = randomBytes(32).toString('base64url'), now = Date.now();
        sessions.insert({ token_hash: sessionHash(raw), usuario_id: user.id,
          creado_en: new Date(now).toISOString(), expira_en: new Date(now + settings.sessionTtlSeconds * 1000).toISOString() });
        log('login_correcto', { usuario_id: user.id });
        return { raw, data: { usuario: publicUser(user), csrf_token: csrfToken(raw) } };
      });
    },
    session(auth, raw) {
      const user = users.get(auth.usuarioId);
      if (!user || user.estado !== 'activo' || !isVerified(user)) throw new AuthError(401, 'SESION_INVALIDA', 'Inicia sesión.');
      return { usuario: publicUser(user), csrf_token: csrfToken(raw) };
    },
    logout(auth) {
      sessions.remove(auth.sesionId);
      log('logout', { usuario_id: auth.usuarioId });
    },
    verifyEmail(body, ip) {
      limit('verificacion:ip', ip, 30);
      fields(body, ['token']);
      const hash = accountTokenHash(accountToken(body.token));
      const outcome = users.transaction(() => {
        const found = readToken(hash, 'verificacion');
        if (found.error) return found;
        if (!users.markEmailVerified(found.user.id, found.row.correo)) { tokens.remove(hash); return { error: 'invalido' }; }
        tokens.revoke(found.user.id, 'verificacion');
        return found;
      });
      if (outcome.error) {
        log('verificacion_rechazada', { codigo: outcome.error });
        throw tokenError(outcome.error);
      }
      log('correo_verificado', { usuario_id: outcome.user.id });
      return { verificado: true, mensaje: 'Correo confirmado. Ya puedes iniciar sesión en ZeroTouch.' };
    },
    resendVerification(body, ip) {
      limit('reenvio:ip', ip, 10);
      fields(body, ['correo']);
      const correo = email(body.correo);
      if (!limit('reenvio:correo', correo, 5, { silent: true })) return REQUEST_ACCEPTED;
      const now = Date.now();
      const outcome = users.transaction(() => {
        const user = users.byEmail(correo);
        if (!user || user.estado !== 'activo' || user.correo_verificado_en || coolingDown(user.id, 'verificacion', now)) return null;
        return { user, raw: issueAccountToken(tokens, { usuarioId: user.id, proposito: 'verificacion', correo, ttlSeconds: VERIFICATION_TTL_SECONDS, now }) };
      });
      if (outcome) deliver(verificationMessage({ to: correo, nombreUsuario: outcome.user.nombre_usuario, link: settings.links.verify(outcome.raw) }), 'verificacion', outcome.user.id);
      log('reenvio_verificacion', { usuario_id: outcome?.user.id, resultado: outcome ? 'enviado' : 'omitido' });
      return REQUEST_ACCEPTED;
    },
    // Lets an account without a confirmed address (accounts migrated from v1, or a typo at
    // registration) set one. Requires the password, so it reveals nothing to a third party.
    async linkEmail(body, ip) {
      const { snapshot, secret } = signIn(body, ip, 'correo', ['correo']);
      const correo = email(body.correo);
      const valid = await verifyPassword(snapshot?.contrasena_hash, secret);
      if (!valid || !snapshot || snapshot.estado !== 'activo') throw invalidCredentials();
      const alreadyVerified = () => new AuthError(409, 'CUENTA_YA_VERIFICADA', 'La cuenta ya tiene un correo confirmado; inicia sesión.');
      if (snapshot.correo_verificado_en) throw alreadyVerified();
      const now = Date.now();
      const outcome = users.transaction(() => {
        const user = users.get(snapshot.id);
        if (!user || user.estado !== 'activo' || user.contrasena_hash !== snapshot.contrasena_hash) throw invalidCredentials();
        if (user.correo_verificado_en) throw alreadyVerified();
        const owner = users.byEmail(correo);
        if (owner && owner.id !== user.id) return { user, owner };
        if (coolingDown(user.id, 'verificacion', now)) return { user };
        users.setUnverifiedEmail(user.id, correo);
        return { user, raw: issueAccountToken(tokens, { usuarioId: user.id, proposito: 'verificacion', correo, ttlSeconds: VERIFICATION_TTL_SECONDS, now }) };
      });
      if (outcome.raw) deliver(verificationMessage({ to: correo, nombreUsuario: outcome.user.nombre_usuario, link: settings.links.verify(outcome.raw) }), 'verificacion', outcome.user.id);
      else if (outcome.owner && limit('aviso:correo', correo, 3, { silent: true })) {
        deliver(existingAccountNotice({ to: correo, nombreUsuario: outcome.owner.nombre_usuario, resetPage: settings.links.resetPage }), 'aviso_registro', outcome.owner.id);
      }
      log('correo_vinculado', { usuario_id: outcome.user.id, resultado: outcome.raw ? 'enviado' : 'omitido' });
      return PENDING_VERIFICATION;
    },
    requestPasswordReset(body, ip) {
      limit('recuperacion:ip', ip, 10);
      fields(body, ['correo']);
      const correo = email(body.correo);
      if (!limit('recuperacion:correo', correo, 5, { silent: true })) return REQUEST_ACCEPTED;
      const now = Date.now();
      const outcome = users.transaction(() => {
        const user = users.byEmail(correo);
        if (!user || user.estado !== 'activo' || coolingDown(user.id, 'recuperacion', now)) return null;
        return { user, raw: issueAccountToken(tokens, { usuarioId: user.id, proposito: 'recuperacion', correo, ttlSeconds: RESET_TTL_SECONDS, now }) };
      });
      if (outcome) deliver(resetMessage({ to: correo, nombreUsuario: outcome.user.nombre_usuario, link: settings.links.reset(outcome.raw) }), 'recuperacion', outcome.user.id);
      log('recuperacion_solicitada', { usuario_id: outcome?.user.id, resultado: outcome ? 'enviado' : 'omitido' });
      return REQUEST_ACCEPTED;
    },
    async resetPassword(body, ip) {
      limit('restablecer:ip', ip, 20);
      fields(body, ['token', 'contrasena']);
      const hash = accountTokenHash(accountToken(body.token)), secret = password(body.contrasena);
      const precheck = users.transaction(() => readToken(hash, 'recuperacion'));
      if (precheck.error) {
        log('restablecimiento_rechazado', { codigo: precheck.error });
        throw tokenError(precheck.error);
      }
      // A rejected password leaves the token valid, so the person can try another one.
      newPassword(secret, { nombreUsuario: precheck.user.nombre_usuario, correo: precheck.row.correo });
      const passwordHash = await hashPassword(secret);
      const outcome = users.transaction(() => {
        // Re-read after the asynchronous hash: two concurrent uses of one token cannot both succeed.
        const found = readToken(hash, 'recuperacion');
        if (found.error) return found;
        if (found.user.estado !== 'activo') { tokens.remove(hash); return { error: 'invalido' }; }
        users.updatePassword(found.user.id, passwordHash);
        users.markEmailVerified(found.user.id, found.row.correo); // the link reached this address
        tokens.revoke(found.user.id, 'recuperacion');
        tokens.revoke(found.user.id, 'verificacion');
        sessions.revoke(found.user.id);
        return found;
      });
      if (outcome.error) {
        log('restablecimiento_rechazado', { codigo: outcome.error });
        throw tokenError(outcome.error);
      }
      deliver(passwordChangedNotice({ to: outcome.row.correo, nombreUsuario: outcome.user.nombre_usuario }), 'aviso_contrasena', outcome.user.id);
      log('contrasena_restablecida', { usuario_id: outcome.user.id });
      return { restablecida: true, mensaje: 'Contraseña actualizada. Se cerraron todas las sesiones; inicia sesión con la nueva contraseña.' };
    },
  };
}
