// Inventory lockfiles without executing dependencies or fetching packages.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const rows = [];
const notices = ['# Third-party notices', '', 'Generated from installed package license/notice files. These notices do not license ZeroTouch code.', 'See LICENSES.md for scope, missing platform packages and asset provenance.', ''];
for (const base of ['.', 'backend']) {
  const lock = JSON.parse(fs.readFileSync(path.join(base, 'package-lock.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(base, 'package.json')));
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location) continue;
    const folder = path.join(base, location);
    const installed = fs.existsSync(path.join(folder, 'package.json'));
    const metadata = installed ? JSON.parse(fs.readFileSync(path.join(folder, 'package.json'))) : {};
    const name = metadata.name || location.split('node_modules/').at(-1);
    const licenses = installed ? fs.readdirSync(folder).filter(n => /^(licen[cs]e|copying|notice)([.\-_]|$)/i.test(n) && fs.statSync(path.join(folder,n)).isFile()) : [];
    // node-argon2 also distributes the reference implementation's dual license.
    if (name === 'argon2' && fs.existsSync(path.join(folder,'argon2','LICENSE'))) licenses.push('argon2/LICENSE');
    const evidence = licenses.map(n => {
      const text = fs.readFileSync(path.join(folder,n), 'utf8');
      notices.push(`## ${base}: ${name}@${entry.version} — ${n}`, '', '```text', text, '```', '');
      return {file: `${base}/${location}/${n}`, sha256: crypto.createHash('sha256').update(text).digest('hex')};
    });
    rows.push({scope:base, location, name, version:entry.version, license:entry.license || metadata.license || 'UNKNOWN', direct:!!(pkg.dependencies?.[name] || pkg.devDependencies?.[name]), development:!!entry.dev, optional:!!entry.optional, installed, source:entry.resolved, officialRepository:metadata.repository?.url || metadata.repository || null, evidence, status:licenses.length ? 'local-text' : 'metadata-only'});
  }
}
fs.mkdirSync('codex-interno/licencias', {recursive:true});
fs.writeFileSync('codex-interno/licencias/dependencias.json', JSON.stringify(rows,null,2)+'\n');
fs.writeFileSync('THIRD_PARTY_NOTICES.md', notices.join('\n'));
const esc = s => String(s).replaceAll('|','\\|');
fs.writeFileSync('codex-interno/licencias/DEPENDENCIAS.md', '# Inventario completo de dependencias\n\nCada fila hereda permisos, costos y obligaciones de su licencia en [LICENSES](../../LICENSES.md). `metadata-only` no acredita revisión del texto del artefacto. Incluye dependencias opcionales no instaladas de otras plataformas. Fuente: tarball del editor registrado en el lockfile; repositorio y evidencia/hash en [JSON](dependencias.json).\n\n|Ámbito|Componente|Versión|Licencia exacta declarada|Relación|Uso|Evidencia|Fuente del editor|\n|---|---|---|---|---|---|---|---|\n'+rows.map(r=>`|${r.scope}|${r.name}|${r.version}|${esc(r.license)}|${r.direct?'Directa':'Transitiva'}|${r.development?'Herramienta':'Ejecución'}${r.optional?' / opcional':''}|${r.status}|[Artefacto](${r.source})|`).join('\n')+'\n');
console.log(JSON.stringify({entries:rows.length,localText:rows.filter(r=>r.status==='local-text').length,metadataOnly:rows.filter(r=>r.status==='metadata-only').map(r=>r.name)}));
