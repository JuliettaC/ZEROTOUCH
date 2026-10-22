import { ApiError } from './errors.js';
import { digest, equal } from '../security/crypto.js';
const denied = () => new ApiError(403,'FORBIDDEN','Solicitud no permitida.');
export function securityBoundary(config) {
  const buckets=new Map();
  return (req,res,next) => {
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"});
    const now=Date.now(), ip=req.socket.remoteAddress;
    for (const [key,b] of buckets) if (b.until<=now) buckets.delete(key);
    const bucket=buckets.get(ip)||{n:0,until:now+60000};
    if (!buckets.has(ip) && buckets.size>=1000) return next(new ApiError(429,'RATE_LIMITED','Reintenta después.'));
    buckets.set(ip,bucket);
    if (++bucket.n>120) return next(new ApiError(429,'RATE_LIMITED','Reintenta después.'));
    if (req.headers.origin && req.headers.origin!==config.appOrigin) return next(denied());
    if (req.headers['sec-fetch-site']==='cross-site') return next(denied());
    next();
  };
}
export function authenticate(repo, crypto) {
  return (req,res,next) => {
    const matches=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('zt_session='));
    const raw=matches.length===1?matches[0].slice(11):'';
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return next(new ApiError(401,'UNAUTHENTICATED','Inicia sesión.'));
    const hash=digest(raw), session=repo.session(hash), now=Date.now();
    if (!session || session.status!=='active' || session.auth_version!==session.current_version || session.expires_at<=now || session.last_seen<=now-1800000) return next(new ApiError(401,'UNAUTHENTICATED','Inicia sesión.'));
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && !equal(req.headers['x-csrf-token'],crypto.csrf(raw))) { repo.event('access_denied',session.account_id); return next(denied()); }
    if (now-session.last_seen>60000) repo.touch(hash);
    req.auth={account:repo.get(session.account_id),hash,raw};
    next();
  };
}
export function adminOnly(repo) {
  return (req,res,next) => {
    if (req.auth.account.role!=='admin') { repo.event('access_denied',req.auth.account.id); return next(denied()); }
    next();
  };
}
