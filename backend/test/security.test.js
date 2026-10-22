import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { fixture,request,signIn,testPassword } from './helpers.js';
import { openDatabase } from '../src/config/database.js';
import { createCrypto,digest,hashPassword,verifyPassword } from '../src/security/crypto.js';
import { accountRepository } from '../src/repositories/accounts.js';
import { backupDatabase,restoreDatabase } from '../src/security/backup.js';
const prefix='/api/v2';
const as = headers => ({auth:false,headers});

test('registro mínimo, credenciales, respuestas genéricas y límites persistentes', async t=>{
  const f=await fixture(t), s=await f.start();
  const call=(m,r,b)=>request(s.base,m,prefix+r,b,{auth:false});
  assert.equal((await call('GET','/profiles')).status,401);
  assert.equal((await request(s.base,'GET','/api/v1/profiles')).status,410);
  for(const b of [{username:'aa',password:testPassword},{username:'legal_user',password:'short'},{username:'legal_user',password:testPassword,role:'admin'},{username:['array'],password:testPassword}]) assert.equal((await call('POST','/auth/register',b)).status,400);
  const body={username:'normal_user',password:testPassword};
  const registered=await call('POST','/auth/register',body);
  const duplicate=await call('POST','/auth/register',body);
  assert.equal(registered.status,202); assert.deepEqual(registered.body,duplicate.body);
  const incorrect=await call('POST','/auth/login',{...body,password:'Una contraseña incorrecta!'});
  const absent=await call('POST','/auth/login',{...body,username:'unknown_user'});
  assert.equal(incorrect.status,401); assert.deepEqual(incorrect.body,absent.body);
  const db=openDatabase(f.filename);
  try {
    const a=db.prepare('SELECT * FROM accounts WHERE username=?').get(body.username);
    assert.equal(a.role,'user'); assert.match(a.password_hash,/^\$argon2id\$v=19\$/);
    assert.deepEqual(a.password_hash.split('$')[3].split(',').sort(),['m=65536','p=1','t=3']);
    assert.equal(await verifyPassword(a.password_hash,testPassword),true);
    assert.notEqual(a.password_hash,await hashPassword(testPassword));
  } finally {db.close();}
  for(let i=0;i<9;i++) assert.equal((await call('POST','/auth/login',{username:'unknown_user',password:testPassword})).status,401);
  assert.equal((await call('POST','/auth/login',{username:'unknown_user',password:testPassword})).status,429);
  await s.stop();
  const restarted=await f.start();
  assert.equal((await request(restarted.base,'POST',prefix+'/auth/login',{username:'unknown_user',password:testPassword},{auth:false})).status,429);
});

test('aislamiento horizontal de perfiles y contextos, listas, escritura y campos privados',async t=>{
  const f=await fixture(t),s=await f.start();
  const alice=await signIn(s.base,'alice'),bob=await signIn(s.base,'bob');
  const call=(who,m,r,b)=>request(s.base,m,prefix+r,b,as(who.headers));
  const p=(await call(alice,'POST','/profiles',{name:'Privado',description:'Texto personal reservado'})).body.data;
  const c=(await call(alice,'POST','/contexts',{name:'Casa',profileId:p.id})).body.data;
  for(const [kind,id] of [['profiles',p.id],['contexts',c.id]]) {
    for(const m of ['GET','PATCH','DELETE']) assert.equal((await call(bob,m,`/${kind}/${id}`,m==='PATCH'?{name:'Ataque'}:undefined)).status,404);
    assert.deepEqual((await call(bob,'GET',`/${kind}`)).body.data,[]);
  }
  assert.equal((await call(bob,'GET',`/contexts?profileId=${p.id}`)).status,404);
  assert.equal((await call(bob,'POST','/contexts',{name:'Ataque',profileId:p.id})).status,404);
  assert.equal((await call(bob,'POST','/profiles',{name:'Ataque',accountId:alice.account.id})).status,400);
  assert.equal((await call(bob,'PATCH','/account',{role:'admin',currentPassword:testPassword})).status,400);
  assert.equal((await call(bob,'GET','/admin/accounts')).status,403);
  assert.equal((await call(alice,'GET',`/profiles/${p.id}`)).body.data.description,'Texto personal reservado');
  const db=openDatabase(f.filename);
  try {
    const row=db.prepare('SELECT description FROM profiles WHERE id=?').get(p.id);
    assert.ok(!row.description.includes('Texto personal'));
    const crypto=createCrypto(f.key);
    assert.equal(crypto.decrypt(Buffer.from(row.description,'base64'),`profile:${p.id}:description`).toString(),'Texto personal reservado');
    assert.throws(()=>crypto.decrypt(Buffer.from(row.description,'base64'),`profile:${randomUUID()}:description`));
    const serialized=JSON.stringify((await call(alice,'GET','/auth/session')).body);
    for(const secret of ['password_hash','auth_version',testPassword]) assert.ok(!serialized.includes(secret));
  } finally {db.close();}
});

test('sesiones: cookies, CSRF, origen, expiración, revocación y cambio de contraseña',async t=>{
  const f=await fixture(t),s=await f.start();
  const login=await request(s.base,'POST',prefix+'/auth/login',{username:'test_user',password:testPassword},{auth:false});
  const cookie=login.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/); assert.match(cookie,/SameSite=Strict/); assert.match(cookie,/Path=\/api\/v2/);
  const headers={cookie:cookie.split(';')[0],'x-csrf-token':login.body.csrfToken};
  assert.equal((await request(s.base,'POST',prefix+'/profiles',{name:'No CSRF'},as({cookie:headers.cookie}))).status,403);
  assert.equal((await request(s.base,'POST',prefix+'/profiles',{name:'Wrong CSRF'},as({...headers,'x-csrf-token':'wrong'}))).status,403);
  const foreign=await request(s.base,'GET',prefix+'/account',undefined,as({...headers,origin:'https://evil.example'}));
  assert.equal(foreign.status,403); assert.equal(foreign.headers.get('access-control-allow-origin'),null);
  assert.equal((await request(s.base,'OPTIONS',prefix+'/profiles',undefined,as({origin:'https://evil.example'}))).status,403);
  const db=openDatabase(f.filename);
  const raw=headers.cookie.split('=')[1],hash=digest(raw);
  try {
    assert.equal(db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(raw),undefined);
    db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(Date.now()-1800001,hash);
    assert.equal((await request(s.base,'GET',prefix+'/account',undefined,as(headers))).status,401);
    db.prepare('UPDATE sessions SET last_seen=?, created_at=?, expires_at=? WHERE token_hash=?').run(Date.now(),Date.now()-10000,Date.now()-1,hash);
    assert.equal((await request(s.base,'GET',prefix+'/account',undefined,as(headers))).status,401);
  } finally {db.close();}
  let user=await signIn(s.base);
  assert.equal((await request(s.base,'POST',prefix+'/auth/logout',{},as(user.headers))).status,204);
  assert.equal((await request(s.base,'GET',prefix+'/account',undefined,as(user.headers))).status,401);
  const first=await signIn(s.base); user=await signIn(s.base);
  assert.equal((await request(s.base,'POST',prefix+'/auth/revoke-all',{},as(user.headers))).status,204);
  assert.equal((await request(s.base,'GET',prefix+'/account',undefined,as(first.headers))).status,401);
  user=await signIn(s.base);
  const changed=await request(s.base,'PATCH',prefix+'/account',{password:'Una nueva contraseña segura!',currentPassword:testPassword},as(user.headers));
  assert.equal(changed.status,200);
  assert.equal((await request(s.base,'GET',prefix+'/account',undefined,as(user.headers))).status,401);
  assert.equal((await request(s.base,'POST',prefix+'/auth/login',{username:'test_user',password:testPassword},{auth:false})).status,401);
  assert.equal((await request(s.base,'POST',prefix+'/auth/login',{username:'test_user',password:'Una nueva contraseña segura!'},{auth:false})).status,200);
});

test('administración restringida, revocación de roles, eliminación y transacciones',async t=>{
  const f=await fixture(t),s=await f.start();
  let admin=await signIn(s.base,'admin_candidate');
  const bob=await signIn(s.base,'bob');
  const db=openDatabase(f.filename),repo=accountRepository(db);
  try {
  repo.transaction(()=>{repo.update(admin.account.id,{role:'admin'});repo.event('admin_bootstrap',admin.account.id);});
  assert.equal((await request(s.base,'GET',prefix+'/account',undefined,as(admin.headers))).status,401);
  admin=await signIn(s.base,'admin_candidate');
  const call=(m,r,b)=>request(s.base,m,prefix+r,b,as(admin.headers));
  const list=await call('GET','/admin/accounts');
  assert.equal(list.status,200);
  assert.deepEqual(Object.keys(list.body.data[0]).sort(),['id','role','status']);
  assert.equal((await call('PATCH',`/admin/accounts/${admin.account.id}`,{role:'user',currentPassword:testPassword})).status,403);
  assert.equal((await call('DELETE','/account',{currentPassword:testPassword})).status,403);
  assert.equal(repo.get(admin.account.id).role,'admin');
  assert.equal((await call('PATCH',`/admin/accounts/${bob.account.id}`,{status:'suspended',currentPassword:'incorrecta pero larga'})).status,401);
  assert.equal(repo.get(bob.account.id).status,'active');
  assert.equal((await call('PATCH',`/admin/accounts/${bob.account.id}`,{status:'suspended',currentPassword:testPassword})).status,200);
  assert.equal((await request(s.base,'GET',prefix+'/profiles',undefined,as(bob.headers))).status,401);
  assert.equal((await request(s.base,'POST',prefix+'/auth/login',{username:'bob',password:testPassword},{auth:false})).status,401);
  assert.equal((await call('PATCH',`/admin/accounts/${bob.account.id}`,{status:'active',currentPassword:testPassword})).status,200);
  const fresh=await signIn(s.base,'bob');
  const p=(await request(s.base,'POST',prefix+'/profiles',{name:'Personal'},as(fresh.headers))).body.data;
  assert.equal((await call('GET',`/profiles/${p.id}`)).status,404);
  await request(s.base,'POST',prefix+'/contexts',{name:'Casa',profileId:p.id},as(fresh.headers));
  assert.equal((await request(s.base,'DELETE',prefix+'/account',{currentPassword:testPassword},as(fresh.headers))).status,204);
  assert.equal(repo.get(bob.account.id),undefined);
  assert.equal(db.prepare('SELECT count(*) n FROM profiles WHERE account_id=?').get(bob.account.id).n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM contexts WHERE profile_id=?').get(p.id).n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM security_events WHERE actor_id=? OR target_id=?').get(bob.account.id,bob.account.id).n,0);
  assert.throws(()=>repo.transaction(()=>{repo.update(admin.account.id,{status:'suspended'});throw new Error('rollback fixture');}));
  assert.equal(repo.get(admin.account.id).status,'active');
  const events=await call('GET','/admin/events');
  assert.equal(events.status,200);
  assert.ok(events.body.data.some(e=>e.kind==='admin_updated'));
  assert.ok(!JSON.stringify(events.body).includes(testPassword));
  } finally {db.close();}
});

test('respaldo cifrado restaurable, manipulación rechazada y migración v1 no destructiva',async t=>{
  const f=await fixture(t),s=await f.start();
  const p=(await request(s.base,'POST',prefix+'/profiles',{name:'Persistente',description:'Secreto del respaldo'})).body.data;
  const folder=path.dirname(f.filename),target=path.join(folder,'backup.ztbackup'),restored=path.join(folder,'restored.sqlite');
  const db=openDatabase(f.filename);
  try {await backupDatabase(db,f.key,target);} finally {db.close();}
  const encrypted=await fs.readFile(target);
  assert.equal(encrypted.includes(Buffer.from('Secreto del respaldo')),false);
  await assert.rejects(restoreDatabase(target,randomBytes(32),restored));
  await restoreDatabase(target,f.key,restored);
  await assert.rejects(restoreDatabase(target,f.key,restored),/EEXIST/);
  const copy=openDatabase(restored);
  try {
    assert.equal(copy.pragma('integrity_check',{simple:true}),'ok');
    assert.equal(copy.prepare('SELECT count(*) n FROM sessions').get().n,0);
    const row=copy.prepare('SELECT * FROM profiles WHERE id=?').get(p.id);
    assert.equal(row.name,'Persistente');
    assert.equal(createCrypto(f.key).decrypt(Buffer.from(row.description,'base64'),`profile:${p.id}:description`).toString(),'Secreto del respaldo');
  } finally {copy.close();}
  encrypted[encrypted.length-1]^=1;
  const tampered=path.join(folder,'tampered.ztbackup'); await fs.writeFile(tampered,encrypted);
  await assert.rejects(restoreDatabase(tampered,f.key,path.join(folder,'unsafe.sqlite')));
  const legacy=path.join(folder,'legacy.sqlite'),old=new Database(legacy);
  old.exec(await fs.readFile(new URL('../../db/migrations/001-legacy.sql',import.meta.url),'utf8'));
  old.close();
  const before=digest(await fs.readFile(legacy));
  assert.throws(()=>openDatabase(legacy,{initialize:true}),/incompatible/);
  assert.equal(digest(await fs.readFile(legacy)),before);
});

test('cuotas, retención y rechazo de captura no autorizada',async t=>{
  const f=await fixture(t),s=await f.start();
  assert.equal((await request(s.base,'POST',prefix+'/profiles',{name:'Video',frames:[]})).status,400);
  assert.equal((await request(s.base,'POST',prefix+'/camera',{frames:[]})).status,404);
  for(let i=0;i<20;i++) assert.equal((await request(s.base,'POST',prefix+'/profiles',{name:`Perfil ${i}`})).status,201);
  assert.equal((await request(s.base,'POST',prefix+'/profiles',{name:'Exceso'})).status,409);
  const db=openDatabase(f.filename);
  try {
    db.prepare("INSERT INTO security_events(kind,created_at) VALUES('login_failed',?)").run(Date.now()-31*86400000);
    accountRepository(db).prune();
    assert.equal(db.prepare('SELECT count(*) n FROM security_events WHERE created_at<?').get(Date.now()-30*86400000).n,0);
  } finally {db.close();}
  let response;
  for(let i=0;i<125;i++) {response=await request(s.base,'GET','/api/health');if(response.status===429) break;}
  assert.equal(response.status,429); assert.ok(response.headers.get('retry-after'));
});
