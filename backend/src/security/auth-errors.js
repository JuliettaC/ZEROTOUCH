export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Mount after the routers and before I2's generic error handler.
export function authErrorHandler(error, req, res, next) {
  if (!(error instanceof AuthError) || res.headersSent) return next(error);
  // Access-control failures go to the security log (code and path only; no identities or secrets).
  if ([401, 403, 429].includes(error.status)) {
    req.app?.locals?.securityLog?.('acceso_rechazado', {
      codigo: error.code, metodo: req.method, ruta: (req.originalUrl ?? '').split('?')[0],
      usuario_id: req.auth?.usuarioId,
    });
  }
  res.set('Cache-Control', 'no-store');
  if (error.status === 429) res.set('Retry-After', '900');
  return res.status(error.status).json({ error: error.code, mensaje: error.message });
}
