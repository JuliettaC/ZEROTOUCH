import { Router } from 'express';
import { validateQuery } from '../services/resourceValidation.js';
export function perfilesRoutes(controller, modes) {
  const router = Router();
  const noQuery = (req, res, next) => { validateQuery(req.query, false); next(); };
  router.route('/').get(controller.list).post(noQuery, controller.create);
  router.route('/:id/modos').get(modes.list).post(noQuery, modes.create);
  router.route('/:id').all(noQuery).get(controller.get).patch(controller.update).delete(controller.delete);
  return router;
}
