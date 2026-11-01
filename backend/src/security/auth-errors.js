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
  res.set('Cache-Control', 'no-store');
  if (error.status === 429) res.set('Retry-After', '900');
  return res.status(error.status).json({ error: error.code, mensaje: error.message });
}
