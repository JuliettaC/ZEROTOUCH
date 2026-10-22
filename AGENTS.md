# Reglas del repositorio ZEROTOUCH

- `docs/` se reserva exclusivamente para documentación académica oficial:
  informes, presentaciones, rúbrica, evidencias y entregables definidos por el equipo.
- Los documentos internos de Codex se guardan en `codex-interno/`, clasificados
  en sus subcarpetas. Nunca crear informes técnicos internos dentro de `docs/`.
- `codex-interno/` es local y está ignorado por Git. Nunca añadirlo con `git add -f`,
  incluirlo en commits ni subir sus documentos a GitHub. Ignorado no significa
  cifrado ni excluido de OneDrive u otros sincronizadores.
- Antes de generar un documento, comprobar su finalidad y ubicación correcta.
  Mantener documentación operativa pública mínima en README, `backend/`, `db/`
  o junto al componente correspondiente; no enlazarla a documentos locales ignorados.
- Código, pruebas, esquemas SQL, migraciones, configuraciones, manifiestos y
  archivos necesarios para ejecutar o verificar el software permanecen versionables.
  Ninguna ejecución o prueba debe depender de `codex-interno/`.
- No guardar secretos ni credenciales en documentos, sean públicos o internos.
- No modificar el prototipo Hito 1 (`src/`, `public/`, entrada/configuración raíz
  y GitHub Pages) sin autorización expresa. El frontend real pertenece a `frontend/`.
- No modificar ni eliminar documentación académica oficial sin autorización.
- En una reorganización documental, preservar funcionalidades y datos; actualizar
  referencias y comprobar `npm --prefix backend test`, `npm run verify:separation`
  y `npm run build`. No realizar commit, push, merge o despliegue sin autorización.
