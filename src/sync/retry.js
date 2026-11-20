// Reintentos acotados para fallos transitorios de transporte. Nunca reintenta errores de datos
// (400/404/409) ni de sesión: esos los decide la capa de sincronización o la persona usuaria.
export const TRANSIENT_CODES = new Set(['SERVICE_OFFLINE', 'SERVICE_RESPONSE', 'DATOS_OCUPADOS', 'ENGINE_TIMEOUT'])

export function isTransient(error) {
  return TRANSIENT_CODES.has(error?.code)
}

export async function withRetry(operation, { retries = 2, baseDelayMs = 400, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (!isTransient(error) || attempt >= retries) throw error
      await sleep(baseDelayMs * 2 ** attempt)
      attempt += 1
    }
  }
}
