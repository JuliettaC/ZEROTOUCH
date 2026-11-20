import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { openDatabase } from './config/database.js';

async function listen(app, port, host) {
  const server = app.listen(port, host);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return server;
}

export async function startServer(config = loadConfig()) {
  const db = openDatabase(config.databasePath);
  let server;
  let lanServer = null;
  try {
    const app = createApp({ db, config });
    server = await listen(app, config.port, config.host);
    // Segundo punto de escucha opcional en la red local (LAN_HOST), mismo puerto y misma app.
    if (config.lanHost) lanServer = await listen(app, server.address().port, config.lanHost);
  } catch (error) { server?.close(); db.close(); throw error; }
  let closing;
  return { server, lanServer, close() {
    // Cierra los dos puntos de escucha y solo después la base, para que ninguna solicitud
    // en curso por la red local llegue a una conexión SQLite ya cerrada.
    closing ??= Promise.allSettled([closeServer(server), closeServer(lanServer)]).then(results => {
      if (db.open) db.close();
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    });
    return closing;
  } };
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => server.closeAllConnections(), 5000);
    timer.unref();
    server.close(error => { clearTimeout(timer); if (error) reject(error); else resolve(); });
    server.closeIdleConnections();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const runtime = await startServer();
    console.log(`ZeroTouch API lista en puerto ${runtime.server.address().port}`);
    if (runtime.lanServer) console.log(`Red local activa: http://${runtime.lanServer.address().address}:${runtime.lanServer.address().port}`);
    if (process.send) process.send({ type: 'ready', port: runtime.server.address().port });
    const close = async () => {
      try { await runtime.close(); } catch { process.exitCode = 1; }
      if (process.connected) process.disconnect();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    process.on('message', message => { if (message === 'shutdown') void close(); });
    process.once('disconnect', close);
  } catch {
    console.error('No se pudo iniciar: revisa .env, dependencias y la inicialización de la base.');
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}
