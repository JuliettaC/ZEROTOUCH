const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const path = require('node:path');

process.chdir(path.resolve(__dirname, '..'));
const baseline = JSON.parse(fs.readFileSync('scripts/data/prototype-baseline.json', 'utf8'));
for (const [file, expected] of Object.entries(baseline.files)) {
  const bytes = fs.readFileSync(file);
  const content = /\.(jsx?|css|html|json|svg|ya?ml|md|txt)$/.test(file)
    ? bytes.toString('utf8').replaceAll('\r\n', '\n') : bytes;
  assert.equal(crypto.createHash('sha256').update(content).digest('hex'), expected,
    `Cambió un archivo preservado del Hito 1: ${file}`);
}
const config = JSON.parse(fs.readFileSync('desktop/tauri.conf.json', 'utf8'));
assert.equal(config.build.frontendDist, '../dist-app');
assert.ok(!config.bundle.resources, 'Tauri no debe empaquetar un segundo backend');
for (const legacy of ['desktop/runtime', 'desktop/prepare-runtime.ps1', 'backend/src/desktop-server.js', 'frontend/src']) {
  assert.ok(!fs.existsSync(legacy), `Copia o arranque antiguo: ${legacy}`);
}
const bridge = fs.readFileSync('desktop/src/bridge.rs', 'utf8');
assert.ok(bridge.includes('/api/v1/auth/me'));
assert.ok(!bridge.includes('/api/v2') && !bridge.includes('desktop-server.js'));
assert.ok(!bridge.includes('.worktrees/'), 'Las pruebas deben usar el backend de este proyecto');
const sql = fs.readFileSync('db/schema.sql', 'utf8');
// Esquema v3: las 7 tablas del diseño original + tokens_cuenta (v2) + idempotencia (v3).
assert.equal((sql.match(/CREATE TABLE /g) || []).length, 9);
assert.ok(fs.existsSync('motor-local/motor_local/main.py'));
assert.ok(!fs.existsSync('motor-local/main.py'), 'No mantener dos motores activos');
console.log(`${Object.keys(baseline.files).length} archivos Hito 1 intactos; backend único, API v1 y motor consolidado verificados.`);
