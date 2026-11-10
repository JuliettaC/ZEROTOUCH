import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { validatePrivateLocalPath } from '../config/database.js';

// Transports:
// - smtp: real delivery. Mandatory in production. STARTTLS is required unless MAIL_SMTP_SECURE
//   enables implicit TLS (port 465). Certificates are validated; TLS 1.2 minimum.
// - archivo: development/test only. Writes each message as an .eml file to a private local
//   folder outside the repository and OneDrive (default: next to the database). Never in production.
export function readMailSettings(env, { nodeEnv, databasePath }) {
  const transport = env.MAIL_TRANSPORT || (nodeEnv === 'production' ? '' : 'archivo');
  if (!['archivo', 'smtp'].includes(transport)) throw new Error('MAIL_TRANSPORT debe ser archivo o smtp.');
  if (nodeEnv === 'production' && transport !== 'smtp') throw new Error('En producción MAIL_TRANSPORT debe ser smtp.');
  const from = env.MAIL_FROM || (transport === 'archivo' ? 'ZeroTouch <no-responder@zerotouch.invalid>' : '');
  if (!from || from.length > 200 || /[\r\n]/.test(from)) throw new Error('MAIL_FROM es obligatorio para smtp y no admite saltos de línea.');
  if (transport === 'archivo') {
    const outbox = env.MAIL_OUTBOX_DIR || path.join(path.dirname(databasePath), 'correo-saliente');
    return { transport, from, outboxDir: validatePrivateLocalPath(outbox, 'MAIL_OUTBOX_DIR') };
  }
  const host = env.MAIL_SMTP_HOST ?? '';
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) throw new Error('MAIL_SMTP_HOST inválido.');
  const rawPort = env.MAIL_SMTP_PORT ?? '587';
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('MAIL_SMTP_PORT inválido.');
  const port = Number(rawPort);
  const rawSecure = env.MAIL_SMTP_SECURE ?? '';
  if (!['', 'true', 'false'].includes(rawSecure)) throw new Error('MAIL_SMTP_SECURE debe ser true o false.');
  const secure = rawSecure === '' ? port === 465 : rawSecure === 'true';
  const user = env.MAIL_SMTP_USER ?? '', pass = env.MAIL_SMTP_PASSWORD ?? '';
  if (Boolean(user) !== Boolean(pass)) throw new Error('MAIL_SMTP_USER y MAIL_SMTP_PASSWORD se configuran juntos.');
  return { transport, from, smtp: { host, port, secure, user, pass } };
}

const messageDefaults = { disableFileAccess: true, disableUrlAccess: true };

export function createMailer(settings) {
  if (!settings) throw new Error('Configuración de correo ausente.');
  if (settings.transport === 'archivo') {
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
    return {
      description: 'archivo',
      async send(message) {
        const info = await transporter.sendMail({ ...messageDefaults, from: settings.from, ...message });
        fs.mkdirSync(settings.outboxDir, { recursive: true, mode: 0o700 });
        const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.eml`;
        fs.writeFileSync(path.join(settings.outboxDir, name), info.message, { mode: 0o600, flag: 'wx' });
      },
    };
  }
  if (settings.transport !== 'smtp') throw new Error('Transporte de correo desconocido.');
  const { host, port, secure, user, pass } = settings.smtp;
  const transporter = nodemailer.createTransport({
    host, port, secure, requireTLS: !secure,
    ...(user ? { auth: { user, pass } } : {}),
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
  });
  return {
    description: 'smtp',
    async send(message) { await transporter.sendMail({ ...messageDefaults, from: settings.from, ...message }); },
  };
}
