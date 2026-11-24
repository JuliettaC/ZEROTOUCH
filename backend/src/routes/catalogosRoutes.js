import { Router } from 'express';
import { validateQuery } from '../services/resourceValidation.js';
export function catalogosRoutes(controller) {
  const router = Router();
  const noQuery = (req, res, next) => { validateQuery(req.query, false); next(); };
  router.get('/gestos', noQuery, controller.gestures);
  router.get('/acciones', noQuery, controller.actions);
  router.get('/capacidades', noQuery, controller.capabilities);
  return router;
}
