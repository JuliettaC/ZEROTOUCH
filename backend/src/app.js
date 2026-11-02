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
import { createPerfilesController } from './controllers/perfilesController.js';
import { createModosController } from './controllers/modosController.js';
import { createCatalogosController } from './controllers/catalogosController.js';
import { perfilesRoutes } from './routes/perfilesRoutes.js';
import { modosRoutes } from './routes/modosRoutes.js';
import { catalogosRoutes } from './routes/catalogosRoutes.js';

export function createApp({ db, config }) {
  if (!db?.open) throw new Error('Se requiere una conexión abierta.');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
    const hasBody = req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0;
    if (hasBody && !req.is('application/json')) return next(new ResourceError(415, 'FORMATO_NO_SOPORTADO', 'Usa application/json.'));
    next();
  });
  app.use(express.json({ limit: '16kb', inflate: false }));
  app.use('/api/v1', healthRoutes);
  app.use('/api', healthRoutes); // Compatibility alias for the original health probe only.
  app.use('/api/v1/auth', createAuthRouter({ db, config }));
  app.use('/api/v1/admin', createAdminRouter({ db, config }));
  const profiles = id => createPerfilesRepository(db, id);
  const modes = id => createModosRepository(db, id);
  const profileController = createPerfilesController(id => createPerfilesService(profiles(id)));
  const modeController = createModosController(id => createModosService(modes(id), profiles(id)));
  const catalogController = createCatalogosController(id => createCatalogosService(createCatalogosRepository(db), modes(id), id));
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
  router.use(['/gestos', '/acciones'], authenticate);
  router.use(catalogosRoutes(controller));
  return router;
}
