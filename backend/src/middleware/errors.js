import { DomainError } from '../domain/errors.js';
const statusByCode = {
  INVALID_INPUT: 400, NOT_FOUND: 404, PROFILE_NOT_FOUND: 404,
  DUPLICATE_CONTEXT: 409, RELATED_RECORDS: 409, DATABASE_BUSY: 503,
  UNAUTHENTICATED: 401, INVALID_CREDENTIALS: 401, FORBIDDEN: 403,
  RATE_LIMITED: 429, RESOURCE_LIMIT: 409, ACCOUNT_CONFLICT: 409,
};
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let failure = error;
  if (error instanceof DomainError)
    failure = new ApiError(statusByCode[error.code] || 500, error.code, error.message);
  if (error.code === 'SQLITE_BUSY')
    failure = new ApiError(503, 'DATABASE_BUSY', 'La base está ocupada. Reintenta la operación.');
  if (error.type === "entity.parse.failed")
    failure = new ApiError(
      400,
      "INVALID_JSON",
      "El cuerpo debe contener JSON válido.",
    );
  if (error.type === "entity.too.large")
    failure = new ApiError(413, "BODY_TOO_LARGE", "El cuerpo supera 16 KB.");
  if (error.status === 415)
    failure = new ApiError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Utiliza application/json con codificación UTF-8.",
    );
  if (!(failure instanceof ApiError)) {
    console.error("Unexpected request failure", { type: error.name });
    failure = new ApiError(
      500,
      "INTERNAL_ERROR",
      "No se pudo completar la operación.",
    );
  }
  res
    .status(failure.status)
    .set(failure.status === 429 ? { 'Retry-After': '900' } : {})
    .json({ error: { code: failure.code, message: failure.message } });
}
