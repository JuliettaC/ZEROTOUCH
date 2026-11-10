import { Router } from 'express';
import { createAuthService } from '../services/authService.js';
import { createAuthController } from '../controllers/authController.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { authConfig } from '../security/auth-config.js';
import { checkOrigin } from '../middleware/csrf.js';
import { silentSecurityLog } from '../security/audit-log.js';

// Mount at /api/v1/auth. Account lookup and logout require a session; the account-recovery
// endpoints are public, rate limited, JSON-only and checked against Origin like login.
export function createAuthRouter({ db, config, mailer, log = silentSecurityLog }) {
  const router = Router(), settings = authConfig(config);
  const controller = createAuthController(createAuthService({ db, config, mailer, log }), settings);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { checkOrigin(req, settings.appOrigin); next(); } catch (error) { next(error); }
  });
  router.post('/registro', controller.register);
  router.post('/login', controller.login);
  router.post('/verificacion', controller.verifyEmail);
  router.post('/verificacion/reenviar', controller.resendVerification);
  router.post('/correo', controller.linkEmail);
  router.post('/contrasena/olvido', controller.requestPasswordReset);
  router.post('/contrasena/restablecer', controller.resetPassword);
  const authenticate = createAuthMiddleware({ db, config });
  router.get('/me', authenticate, controller.session);
  router.get('/sesion', authenticate, controller.session);
  router.post('/logout', authenticate, controller.logout);
  return router;
}
