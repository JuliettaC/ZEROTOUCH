export function authConfig(config = {}) {
  const nodeEnv = config.nodeEnv ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('nodeEnv inválido.');
  const appOrigin = config.appOrigin ?? 'http://127.0.0.1:3000';
  const origin = new URL(appOrigin);
  if (origin.origin !== appOrigin || !['http:', 'https:'].includes(origin.protocol)
    || (nodeEnv === 'production' && origin.protocol !== 'https:')) throw new Error('appOrigin inválido.');
  const sessionTtlSeconds = config.sessionTtlSeconds ?? 28800;
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 60 || sessionTtlSeconds > 86400) {
    throw new Error('sessionTtlSeconds debe ser entero entre 60 y 86400.');
  }
  return {
    appOrigin, sessionTtlSeconds,
    cookie: { httpOnly: true, sameSite: 'strict', secure: origin.protocol === 'https:', path: '/api/v1' },
  };
}
