// Security event log (OWASP A09). One JSON line per event on stderr.
// Allow-list of fields: never passwords, tokens, cookies, CSRF values, hashes, emails,
// account names or IP addresses. Only internal UUIDs, outcomes and error codes.
const FIELDS = ['usuario_id', 'objetivo_id', 'resultado', 'codigo', 'metodo', 'ruta', 'proposito', 'valor'];

export function createSecurityLog({ enabled = true, write = line => process.stderr.write(line) } = {}) {
  return (evento, fields = {}) => {
    if (!enabled) return;
    const entry = { ts: new Date().toISOString(), tipo: 'seguridad', evento: String(evento).slice(0, 60) };
    for (const key of FIELDS) if (fields[key] !== undefined && fields[key] !== null) entry[key] = String(fields[key]).slice(0, 200);
    try { write(`${JSON.stringify(entry)}\n`); } catch { /* logging never breaks a request */ }
  };
}

export const silentSecurityLog = () => {};
