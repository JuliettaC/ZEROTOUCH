import { Router } from 'express';
import { validateQuery } from '../services/resourceValidation.js';
export function modosRoutes(controller, catalogs) {
  const router = Router();
  router.use((req, res, next) => { validateQuery(req.query, false); next(); });
  router.route('/:id/gestos').get(catalogs.effective).put(catalogs.replace);
  router.patch('/:id/gestos/:gesto', catalogs.patchOne);
  router.route('/:id').get(controller.get).patch(controller.update).delete(controller.delete);
  return router;
}
