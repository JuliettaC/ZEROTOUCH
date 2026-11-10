import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fixed set of static files read once at startup: no user-controlled paths are resolved.
// The pages read the token from the URL fragment and POST it as JSON to /api/v1/auth/*.
const directory = new URL('../../public/cuenta/', import.meta.url);
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
const FILES = {
  '/verificar': ['verificar.html', 'text/html; charset=utf-8'],
  '/restablecer': ['restablecer.html', 'text/html; charset=utf-8'],
  '/cuenta.js': ['cuenta.js', 'text/javascript; charset=utf-8'],
  '/cuenta.css': ['cuenta.css', 'text/css; charset=utf-8'],
};

export function createCuentaRouter() {
  const router = Router();
  for (const [route, [file, type]] of Object.entries(FILES)) {
    const body = readFileSync(fileURLToPath(new URL(file, directory)));
    router.get(route, (req, res) => {
      res.set({ 'Content-Security-Policy': PAGE_CSP, 'Content-Type': type });
      res.send(body);
    });
  }
  return router;
}
