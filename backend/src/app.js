import express from 'express';
import healthRoutes from './routes/healthRoutes.js';
import { createRepository } from './repositories/resources.js';
import { accountRepository } from './repositories/accounts.js';
import { createService } from './services/resources.js';
import { accountService, publicAccount } from './services/accounts.js';
import { validateQuery } from './services/validation.js';
import { createController } from './controllers/resourceController.js';
import { resourceRoutes } from './routes/resourceRoutes.js';
import { ApiError,errorHandler } from './middleware/errors.js';
import { securityBoundary,authenticate,adminOnly } from './middleware/security.js';
import { createCrypto } from './security/crypto.js';

export function createApp(db, {key, appOrigin='http://127.0.0.1:3000',nodeEnv='development'}={}) {
  const crypto=createCrypto(key), repo=accountRepository(db), accounts=accountService(repo,crypto);
  const app=express();
  app.disable('x-powered-by'); app.set('trust proxy',false);
  app.use(securityBoundary({appOrigin}));
  app.use((req,res,next) => {
    if (['POST','PATCH','DELETE'].includes(req.method) && (req.headers['content-length'] || req.headers['transfer-encoding']) && !req.is('application/json')) return next(new ApiError(415,'UNSUPPORTED_MEDIA_TYPE','Utiliza Content-Type: application/json.'));
    next();
  });
  app.use(express.json({limit:'16kb'}));
  app.use('/api',healthRoutes);
  app.use('/api/v1',(req,res,next)=>next(new ApiError(410,'API_RETIRED','Utiliza la API v2 con autenticación.')));
  const cookieOptions={httpOnly:true,sameSite:'strict',secure:nodeEnv==='production',path:'/api/v2'};
  app.post('/api/v2/auth/register',async(req,res)=>res.status(202).json(await accounts.register(req.body,req.socket.remoteAddress)));
  app.post('/api/v2/auth/login',async(req,res)=>{
    const result=await accounts.login(req.body,req.socket.remoteAddress);
    res.cookie('zt_session',result.raw,{...cookieOptions,maxAge:8*3600000});
    res.json({account:result.account,csrfToken:result.csrfToken});
  });
  app.use('/api/v2',authenticate(repo,crypto));
  app.get('/api/v2/auth/session',(req,res)=>res.json({account:publicAccount(req.auth.account),csrfToken:crypto.csrf(req.auth.raw)}));
  app.post('/api/v2/auth/logout',(req,res)=>{
    repo.transaction(()=>{repo.logout(req.auth.hash);repo.event('logout',req.auth.account.id);});
    res.clearCookie('zt_session',cookieOptions).status(204).end();
  });
  app.post('/api/v2/auth/revoke-all',(req,res)=>{
    repo.transaction(()=>{repo.revoke(req.auth.account.id);repo.event('revoke_all',req.auth.account.id);});
    res.clearCookie('zt_session',cookieOptions).status(204).end();
  });
  app.get('/api/v2/account',(req,res)=>res.json({data:publicAccount(req.auth.account)}));
  app.patch('/api/v2/account',async(req,res)=>{
    const data=await accounts.update(req.auth.account,req.body);
    res.clearCookie('zt_session',cookieOptions).json({data});
  });
  app.delete('/api/v2/account',async(req,res)=>{
    await accounts.remove(req.auth.account,req.body);
    res.clearCookie('zt_session',cookieOptions).status(204).end();
  });
  app.use('/api/v2/admin',adminOnly(repo));
  app.get('/api/v2/admin/events',(req,res)=>{const q=validateQuery('profiles',req.query);res.json({data:repo.events(q.limit,q.offset),pagination:q});});
  app.get('/api/v2/admin/accounts',(req,res)=>{const q=validateQuery('profiles',req.query);res.json({data:repo.list(q.limit,q.offset),pagination:q});});
  app.patch('/api/v2/admin/accounts/:id',async(req,res)=>res.json({data:await accounts.adminUpdate(req.auth.account,req.params.id,req.body)}));
  for (const kind of ['profiles','contexts']) {
    const basePath=`/api/v2/${kind}`;
    const serviceFor=id=>createService(kind,createRepository(db,kind,id,crypto),createRepository(db,'profiles',id,crypto));
    app.use(basePath,resourceRoutes(createController(serviceFor,basePath)));
  }
  app.use((req,res,next)=>next(new ApiError(404,'ROUTE_NOT_FOUND','Ruta o método no disponible.')));
  app.use(errorHandler);
  return app;
}
