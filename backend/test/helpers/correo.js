import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Test-only mail double. It is injected through createApp/createAuthRouter; no environment
// variable or route can select it in production.
export function createMemoryMailer() {
  const messages = [];
  return {
    messages,
    send(message) { messages.push(message); return Promise.resolve(); },
  };
}

const LINK = /\/cuenta\/(verificar|restablecer)#token=([A-Za-z0-9_-]{43})/g;
export function tokensIn(text, kind) {
  return [...String(text).matchAll(LINK)].filter(match => !kind || match[1] === kind).map(match => match[2]);
}
export function lastToken(mailer, to, kind = 'verificar') {
  const message = mailer.messages.filter(item => item.to === to && tokensIn(item.text, kind).length).at(-1);
  return message ? tokensIn(message.text, kind)[0] : undefined;
}

// Decodes the quoted-printable or base64 bodies of an .eml file written by the "archivo" transport.
export function decodeEml(raw) {
  const qp = raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const base64 = [...raw.matchAll(/\r?\n\r?\n([A-Za-z0-9+/=\r\n]{40,})/g)].map(match => Buffer.from(match[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
  return [qp, ...base64].join('\n');
}
export async function tokenFromOutbox(directory, to, kind = 'verificar', { after = new Set(), timeoutMs = 4000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(directory)) {
      for (const file of readdirSync(directory).filter(name => name.endsWith('.eml') && !after.has(name)).sort().reverse()) {
        const raw = readFileSync(path.join(directory, file), 'utf8');
        if (!new RegExp(`^To: .*${to.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'mi').test(raw)) continue;
        const [token] = tokensIn(decodeEml(raw), kind);
        if (token) return token;
      }
    }
    await delay(50);
  }
  throw new Error(`No llegó un correo "${kind}" para ${to} a ${directory}.`);
}
export const outboxFiles = directory => new Set(existsSync(directory) ? readdirSync(directory) : []);
