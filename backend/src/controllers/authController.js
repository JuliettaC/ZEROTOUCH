import { readSessionCookie } from '../middleware/auth.js';
export function createAuthController(service, settings) {
  const ip = req => req.socket.remoteAddress;
  return {
    // 202: the account (if any) is pending email verification; the body is identical in every case.
    register: async (req, res) => res.status(202).json({ data: await service.register(req.body, ip(req)) }),
    async login(req, res) {
      const result = await service.login(req.body, ip(req));
      res.cookie('zt_session', result.raw, { ...settings.cookie, maxAge: settings.sessionTtlSeconds * 1000 });
      res.json({ data: result.data });
    },
    session: (req, res) => res.json({ data: service.session(req.auth, readSessionCookie(req)) }),
    logout(req, res) {
      service.logout(req.auth);
      res.clearCookie('zt_session', settings.cookie).status(204).end();
    },
    verifyEmail: (req, res) => res.json({ data: service.verifyEmail(req.body, ip(req)) }),
    resendVerification: (req, res) => res.status(202).json({ data: service.resendVerification(req.body, ip(req)) }),
    linkEmail: async (req, res) => res.status(202).json({ data: await service.linkEmail(req.body, ip(req)) }),
    requestPasswordReset: (req, res) => res.status(202).json({ data: service.requestPasswordReset(req.body, ip(req)) }),
    resetPassword: async (req, res) => res.json({ data: await service.resetPassword(req.body, ip(req)) }),
  };
}
