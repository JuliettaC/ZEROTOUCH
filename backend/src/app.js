import express from 'express';
import healthRoutes from './routes/healthRoutes.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createAdminRouter } from './routes/adminRoutes.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { authErrorHandler } from './security/auth-errors.js';
import { errorHandler } from './middleware/errors.js';
import { ResourceError } from './domain/resourceError.js';
import { createPerfilesRepository } from './repositories/perfilesRepository.js';
import { createModosRepository } from './repositories/modosRepository.js';
import { createCatalogosRepository } from './repositories/catalogosRepository.js';
import { createPerfilesService } from './services/perfilesService.js';
import { createModosService } from './services/modosService.js';
import { createCatalogosService } from './services/catalogosService.js';
import { createIdempotenciaRepository } from './repositories/idempotenciaRepository.js';
import { createIdempotencyRunner } from './services/idempotencia.js';
import { createPerfilesController } from './controllers/perfilesController.js';
import { createModosController } from './controllers/modosController.js';
import { createCatalogosController } from './controllers/catalogosController.js';
import { perfilesRoutes } from './routes/perfilesRoutes.js';
import { modosRoutes } from './routes/modosRoutes.js';
import { catalogosRoutes } from './routes/catalogosRoutes.js';
import { createCuentaRouter } from './routes/cuentaRoutes.js';
import { createMailer } from './security/mailer.js';
import { createSecurityLog } from './security/audit-log.js';

// mailer/securityLog are injectable for tests; production builds them from config.
export function createApp({ db, config, mailer, securityLog }) {
  if (!db?.open) throw new Error('Se requiere una conexión abierta.');
  const mail = mailer ?? createMailer(config.mail);
  const log = securityLog ?? createSecurityLog({ enabled: config.nodeEnv !== 'test' });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.locals.securityLog = log;
  const https = String(config.appOrigin ?? '').startsWith('https:');
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      ...(https ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) });
    const hasBody = req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0;
    if (hasBody && !req.is('application/json')) return next(new ResourceError(415, 'FORMATO_NO_SOPORTADO', 'Usa application/json.'));
    next();
  });
  app.use(express.json({ limit: '16kb', inflate: false }));
  app.use('/api/v1', healthRoutes);
  app.use('/api', healthRoutes); // Compatibility alias for the original health probe only.
  app.use('/cuenta', createCuentaRouter()); // Static pages opened from verification/reset emails.
  app.use('/api/v1/auth', createAuthRouter({ db, config, mailer: mail, log }));
  app.use('/api/v1/admin', createAdminRouter({ db, config, log }));
  const profiles = id => createPerfilesRepository(db, id);
  const modes = id => createModosRepository(db, id);
  // Idempotencia de POST: solo si la base ya está en el esquema v3 (tabla `idempotencia`). Con v2 todo sigue igual.
  const features = { idempotencia: db.pragma('user_version', { simple: true }) >= 3 };
  const idempotency = id => createIdempotencyRunner({ repository: createIdempotenciaRepository(db, id), enabled: features.idempotencia });
  const profileController = createPerfilesController(id => createPerfilesService(profiles(id), idempotency(id)));
  const modeController = createModosController(id => createModosService(modes(id), profiles(id), idempotency(id)));
  const catalogController = createCatalogosController(id => createCatalogosService(createCatalogosRepository(db), modes(id), id, features));
  const authenticate = createAuthMiddleware({ db, config });
  app.use('/api/v1/perfiles', authenticate, perfilesRoutes(profileController, modeController));
  app.use('/api/v1/modos', authenticate, modosRoutes(modeController, catalogController));
  app.use('/api/v1', catalogosRoutesWithAuth(authenticate, catalogController));
  app.use((req, res, next) => next(new ResourceError(404, 'RUTA_NO_ENCONTRADA', 'Ruta o método no disponible.')));
  app.use(authErrorHandler);
  app.use(errorHandler);
  return app;
}

function catalogosRoutesWithAuth(authenticate, controller) {
  const router = express.Router();
  router.use(['/gestos', '/acciones', '/capacidades'], authenticate);
  router.use(catalogosRoutes(controller));
  return router;
}
