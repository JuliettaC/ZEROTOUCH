import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { hashPassword, verifyPassword, token, digest } from '../security/crypto.js';
import { validateId } from './validation.js';
const fail = (code, message) => { throw new DomainError(code, message); };
export function object(body, fields, required = fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !fields.includes(k)) || required.some(k => !Object.hasOwn(body,k))) fail('INVALID_INPUT','Campos inválidos.');
  return body;
}
function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,40}$/.test(value)) fail('INVALID_INPUT','username requiere 3 a 40 letras ASCII, números o guion bajo.');
  return value.toLowerCase();
}
function password(value) {
  if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128 || Buffer.byteLength(value)>512) fail('INVALID_INPUT','La contraseña requiere entre 15 y 128 caracteres.');
  return value;
}
export const publicAccount = a => ({ id:a.id, username:a.username, role:a.role, status:a.status });
export function accountService(repo, crypto) {
  function rate(ip, name, action) {
    if (!repo.rate(crypto.fingerprint(`${action}:ip:${ip}`), action==='register'?10:30) || !repo.rate(crypto.fingerprint(`${action}:name:${name}`),10)) fail('RATE_LIMITED','Espera antes de reintentar.');
  }
  function current(snapshot) {
    const a = repo.get(snapshot.id);
    if (!a || a.status!=='active' || a.auth_version!==snapshot.auth_version) fail('UNAUTHENTICATED','La sesión ya no es válida.');
    return a;
  }
  async function confirm(a, value) {
    password(value);
    if (!repo.rate(crypto.fingerprint(`reauth:${a.id}`),10)) fail('RATE_LIMITED','Espera antes de reintentar.');
    if (!await verifyPassword(a.password_hash,value)) fail('INVALID_CREDENTIALS','Credenciales inválidas.');
  }
  function preserveAdmin(a, changes) {
    if (a.role==='admin' && a.status==='active' && (changes.role!=='admin' || changes.status!=='active') && repo.adminCount()<=1) fail('FORBIDDEN','Debe permanecer un administrador activo.');
  }
  return {
    async register(body, ip) {
      object(body,['username','password']);
      const name = username(body.username), value = password(body.password);
      rate(ip,name,'register');
      const hash = await hashPassword(value);
      repo.transaction(() => {
        if (repo.byName(name)) return;
        const id=randomUUID();
        repo.insert({id,username:name,hash,now:new Date().toISOString()});
        repo.event('register',id,id);
      });
      return { message:'Solicitud procesada. Puedes intentar iniciar sesión con tus credenciales.' };
    },
    async login(body, ip) {
      object(body,['username','password']);
      const name=username(body.username), value=password(body.password);
      rate(ip,name,'login');
      const a=repo.byName(name);
      const valid=await verifyPassword(a?.password_hash,value);
      if (!valid || !a || a.status!=='active') { repo.event('login_failed'); fail('INVALID_CREDENTIALS','Credenciales inválidas.'); }
      return repo.transaction(() => {
        const fresh=current(a), raw=token();
        repo.addSession(digest(raw),fresh);
        repo.event('login_ok',a.id,a.id);
        return { raw, account:publicAccount(fresh), csrfToken:crypto.csrf(raw) };
      });
    },
    async update(a, body) {
      object(body,['username','password','currentPassword'],['currentPassword']);
      if (!Object.hasOwn(body,'username') && !Object.hasOwn(body,'password')) fail('INVALID_INPUT','Falta el cambio solicitado.');
      const changes={};
      if (body.username!==undefined) changes.username=username(body.username);
      if (body.password!==undefined) changes.password_hash=await hashPassword(password(body.password));
      await confirm(a,body.currentPassword);
      return repo.transaction(() => {
        current(a);
        if (changes.username) { const other=repo.byName(changes.username); if (other && other.id!==a.id) fail('ACCOUNT_CONFLICT','No se pudo utilizar ese identificador.'); }
        repo.update(a.id,changes); repo.event('account_updated',a.id,a.id);
        return publicAccount(repo.get(a.id));
      });
    },
    async remove(a,body) {
      object(body,['currentPassword']); await confirm(a,body.currentPassword);
      repo.transaction(() => { const fresh=current(a); preserveAdmin(fresh,{}); repo.event('account_deleted',a.id,a.id); repo.remove(a.id); });
    },
    async adminUpdate(actor,id,body) {
      validateId(id); object(body,['role','status','currentPassword'],['currentPassword']);
      if ((!Object.hasOwn(body,'role') && !Object.hasOwn(body,'status')) || (body.role!==undefined && !['user','admin'].includes(body.role)) || (body.status!==undefined && !['active','suspended'].includes(body.status))) fail('INVALID_INPUT','Cambio administrativo inválido.');
      await confirm(actor,body.currentPassword);
      return repo.transaction(() => {
        const fresh=current(actor);
        if (fresh.role!=='admin' || actor.id===id) fail('FORBIDDEN','Operación no permitida.');
        const target=repo.get(id); if (!target) fail('NOT_FOUND','Cuenta inexistente.');
        const changes={ role:body.role??target.role, status:body.status??target.status };
        preserveAdmin(target,changes); repo.update(id,changes); repo.event('admin_updated',actor.id,id);
        return {id,...changes};
      });
    },
  };
}
