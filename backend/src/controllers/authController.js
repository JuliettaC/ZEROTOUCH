import { readSessionCookie } from '../middleware/auth.js';
export function createAuthController(service, settings) {
  return {
    register: async (req, res) => res.status(201).json({ data: await service.register(req.body, req.socket.remoteAddress) }),
    async login(req, res) {
      const result = await service.login(req.body, req.socket.remoteAddress);
      res.cookie('zt_session', result.raw, { ...settings.cookie, maxAge: settings.sessionTtlSeconds * 1000 });
      res.json({ data: result.data });
    },
    session: (req, res) => res.json({ data: service.session(req.auth, readSessionCookie(req)) }),
    logout(req, res) {
      service.logout(req.auth);
      res.clearCookie('zt_session', settings.cookie).status(204).end();
    },
  };
}
