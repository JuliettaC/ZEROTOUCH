import { Router } from 'express';
import { createAuthService } from '../services/authService.js';
import { createAuthController } from '../controllers/authController.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { authConfig } from '../security/auth-config.js';
import { checkOrigin } from '../middleware/csrf.js';

// Mount at /api/v1/auth. Account lookup and logout require a session.
export function createAuthRouter({ db, config }) {
  const router = Router(), settings = authConfig(config);
  const controller = createAuthController(createAuthService({ db, config }), settings);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { checkOrigin(req, settings.appOrigin); next(); } catch (error) { next(error); }
  });
  router.post('/registro', controller.register);
  router.post('/login', controller.login);
  const authenticate = createAuthMiddleware({ db, config });
  router.get('/me', authenticate, controller.session);
  router.get('/sesion', authenticate, controller.session);
  router.post('/logout', authenticate, controller.logout);
  return router;
}
