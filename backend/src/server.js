import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { openDatabase } from "./config/database.js";
import { loadKey } from './security/crypto.js';
import { accountRepository } from './repositories/accounts.js';
let db;
try {
  const config = loadConfig();
  const key = loadKey(config.keyPath);
  db = openDatabase(config.databasePath);
  accountRepository(db).prune();
  const pruneTimer = setInterval(() => { try { accountRepository(db).prune(); } catch { console.error('No se pudo aplicar retención.'); } }, 3600000);
  pruneTimer.unref();
  const server = createApp(db, {...config,key}).listen(config.port, config.host, () => {
    const host = config.host === "::1" ? "[::1]" : config.host;
    console.log(
      `ZeroTouch API disponible en http://${host}:${server.address().port}`,
    );
  });
  server.on("error", (error) => {
    console.error(`No se pudo iniciar (${error.code || "STARTUP_ERROR"}).`);
    db.close();
    if (process.connected) process.disconnect();
    process.exitCode = 1;
  });
  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    clearInterval(pruneTimer);
    server.close(() => {
      db.close();
      if (process.connected) process.disconnect();
      process.exitCode = 0;
    });
    server.closeIdleConnections();
    const timer = setTimeout(() => server.closeAllConnections(), 5000);
    timer.unref();
  }
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  process.on("message", (message) => {
    if (message === "shutdown") close();
  });
} catch (error) {
  if (db?.open) db.close();
  if (process.connected) process.disconnect();
  console.error(
    `Configuración o base no disponible: ${error.code || error.message}. Consulta README y db:init.`,
  );
  process.exitCode = 1;
}
