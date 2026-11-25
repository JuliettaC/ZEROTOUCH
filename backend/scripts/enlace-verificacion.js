import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config/env.js';

// Solo para demostración y desarrollo (MAIL_TRANSPORT=archivo): imprime el enlace del último correo de verificación
// (o de restablecimiento) guardado en la bandeja de archivos. En el .eml el enlace queda partido por saltos de línea
// de «quoted-printable»; aquí se decodifica para poder abrirlo tal cual en el navegador.
// Uso: npm run correo:enlace --prefix backend -- [correo@ejemplo.test] [--restablecer]
const args = process.argv.slice(2);
const kind = args.includes('--restablecer') ? 'restablecer' : 'verificar';
const address = args.find(arg => !arg.startsWith('--'))?.toLowerCase();

function decodeQuotedPrintable(raw) {
  return raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

try {
  const { mail } = loadConfig();
  if (mail.transport !== 'archivo') throw new Error('Solo funciona con MAIL_TRANSPORT=archivo (modo de demostración).');
  if (!existsSync(mail.outboxDir)) throw new Error(`Todavía no hay correos en ${mail.outboxDir}. Crea la cuenta primero.`);
  const link = new RegExp(`https?://[^\\s"<>]+/cuenta/${kind}#token=[A-Za-z0-9_-]{43}`);
  for (const file of readdirSync(mail.outboxDir).filter(name => name.endsWith('.eml')).sort().reverse()) {
    const text = decodeQuotedPrintable(readFileSync(path.join(mail.outboxDir, file), 'utf8'));
    const to = text.match(/^To: (.+)$/m)?.[1]?.toLowerCase() ?? '';
    if (address && !to.includes(address)) continue;
    const found = text.match(link)?.[0];
    if (!found) continue;
    console.log(`Correo para ${to.trim()}:`);
    console.log(found);
    console.log('Ábrelo en el navegador y pulsa «Confirmar mi correo». El enlace vence en 24 horas y solo sirve una vez.');
    process.exit(0);
  }
  throw new Error(`No hay un correo de ${kind === 'verificar' ? 'verificación' : 'restablecimiento'}${address ? ` para ${address}` : ''} en ${mail.outboxDir}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
