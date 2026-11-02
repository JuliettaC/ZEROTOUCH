import { Router } from 'express';
import { validateQuery } from '../services/resourceValidation.js';
export function modosRoutes(controller, catalogs) {
  const router = Router();
  router.use((req, res, next) => { validateQuery(req.query, false); next(); });
  router.get('/:id/gestos', catalogs.effective);
  router.route('/:id').get(controller.get).patch(controller.update).delete(controller.delete);
  return router;
}
