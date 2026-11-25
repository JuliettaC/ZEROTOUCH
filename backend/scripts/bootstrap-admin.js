import { createInterface } from 'node:readline/promises';
import { openDatabase } from '../src/config/database.js';
import { loadConfig } from '../src/config/env.js';
import { bootstrapAdmin } from '../src/services/adminService.js';
import { authConfig } from '../src/security/auth-config.js';
import { createMailer } from '../src/security/mailer.js';
import { verificationMessage } from '../src/security/mail-templates.js';

function secretPrompt(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin, wasRaw = input.isRaw;
    let value = '';
    process.stdout.write(label);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();
    const finish = (error) => {
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onEnd = () => finish(new Error('Entrada cerrada.'));
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Cancelado.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ' && Buffer.byteLength(value) < 1024) value += character;
      }
    };
    input.on('data', onData);
    input.once('end', onEnd);
  });
}

let db, line;
try {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.argv.length > 2) {
    throw new Error('Usa una terminal interactiva y no pases credenciales como argumentos.');
  }
  const config = loadConfig();
  const mailer = createMailer(config.mail);
  db = openDatabase(config.databasePath, { key: config.databaseKey });
  line = createInterface({ input: process.stdin, output: process.stdout });
  const name = await line.question('Nombre del primer administrador: ');
  const address = await line.question('Correo del administrador (recibirá el enlace de verificación): ');
  line.close();
  const secret = await secretPrompt('Contraseña (no se muestra): ');
  const confirmation = await secretPrompt('Repite la contraseña: ');
  if (secret !== confirmation) throw new Error('Las contraseñas no coinciden.');
  const created = await bootstrapAdmin(db, name, secret, address);
  // The single-use token travels only inside the email; it is never printed.
  try {
    await mailer.send(verificationMessage({ to: created.correo, nombreUsuario: created.usuario.nombre_usuario, link: authConfig(config).links.verify(created.token) }));
  } catch {
    console.error('Administrador creado, pero el correo no se pudo enviar. Revisa MAIL_* y usa "Reenviar correo de verificación".');
    process.exitCode = 1;
  }
  console.log('Administrador inicial creado sin verificar. Confirma el correo con el enlace recibido y luego inicia sesión.');
  if (config.mail.transport === 'archivo') console.log(`Desarrollo: el mensaje se guardó como .eml en ${config.mail.outboxDir}`);
} catch (error) {
  console.error(`No se creó el administrador: ${error.message}`);
  process.exitCode = 1;
} finally { line?.close(); db?.close(); }
