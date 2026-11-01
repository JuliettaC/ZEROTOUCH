import { Router } from 'express';
import { createAdminService } from '../services/adminService.js';
import { createAdminController } from '../controllers/adminController.js';
import { createAuthMiddleware } from '../middleware/auth.js';

// Mount at /api/v1/admin. Self-protected, even if mounted before global auth.
export function createAdminRouter({ db, config }) {
  const router = Router(), controller = createAdminController(createAdminService({ db }));
  router.use(createAuthMiddleware({ db, config }));
  router.get('/usuarios', controller.list);
  router.patch('/usuarios/:id/rol', controller.role);
  router.patch('/usuarios/:id/estado', controller.status);
  return router;
}
