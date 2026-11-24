import { Router } from 'express';
import { createAdminService } from '../services/adminService.js';
import { createAdminController } from '../controllers/adminController.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { silentSecurityLog } from '../security/audit-log.js';

// Mount at /api/v1/admin. Self-protected, even if mounted before global auth.
export function createAdminRouter({ db, config, log = silentSecurityLog }) {
  const router = Router(), controller = createAdminController(createAdminService({ db, log }));
  router.use(createAuthMiddleware({ db, config }));
  router.get('/usuarios', controller.list);
  router.patch('/usuarios/:id/rol', controller.role);
  router.patch('/usuarios/:id/estado', controller.status);
  return router;
}
