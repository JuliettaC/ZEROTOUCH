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
    .json({ error: { code: failure.code, message: failure.message } });
}
