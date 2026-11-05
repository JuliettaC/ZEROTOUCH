# <img width="35" height="35" alt="ICON NEGRO" style="vertical-align: -6px;" src="https://github.com/user-attachments/assets/d52f48df-cfcb-40aa-8178-1989bbdff02e" /> ZEROTOUCH
Para personas que realizan tareas manuales mientras consultan información digital, ZeroTouch propone una interacción gestual que busca reducir el contacto directo con el dispositivo y las interrupciones durante la actividad, sin requerir sensores gestuales especializados adicionales.

## Integrantes

* Julietta Céspedes (@JuliettaC)
* Adan Mendoza (@Adammm14)
* Anais Perez (@Youpuipui)

## Prototipo funcional
[Prototipo](https://juliettac.github.io/ZEROTOUCH/)

## Documentos
### Hito 1
[Informe](docs/Informe%20Hito%201.pdf)

## Hito 2: backend local

API Express `/api/v1`, SQLite de siete tablas, sesiones, roles y CRUD de perfiles/modos. La aplicación Tauri usa esta API mediante un cliente nativo. El motor gestual funciona localmente, sin comunicación HTTP por fotograma.

### Organización

- `backend/` y `db/`: único backend y esquema vigentes. La base real permanece fuera del repositorio, indicada por `DATABASE_PATH`.
- `src/`: interfaz actual de Tauri; `desktop/`: código Rust, permisos y configuración.
- `motor-local/motor_local/`: motor Python utilizado por Tauri.
- `prototype/`: fuentes preservadas del Hito 1; `public/`: recursos visuales compartidos.
- `docs/`: entregables y contrato API. Las copias de trabajo y archivos temporales no forman parte de la entrega.

`npm run build` sigue generando el prototipo en `dist/` para GitHub Pages. `npm run build:app` genera la aplicación en `dist-app/`. `npm run verify:separation` comprueba la preservación del prototipo y la ausencia del backend antiguo. No se reutiliza `desktop/runtime` ni la API v2.

### Instalación en Windows

Entorno comprobado: Node **24.19.0**, npm y Windows. Desde la raíz del clon:

```powershell
npm ci --prefix backend
Copy-Item .env.example .env
```

Editar `.env`: reemplazar DATABASE_PATH por una ruta absoluta local, por ejemplo `C:/Users/TU_USUARIO/AppData/Local/ZeroTouch/hito2.sqlite`. Debe quedar fuera del repositorio y OneDrive. Conservar `HOST=127.0.0.1`, `PORT=3000`, `APP_ORIGIN=http://127.0.0.1:3000` y `SESSION_TTL_SECONDS=28800` para la demostración. No subir `.env` ni bases a Git.

```powershell
npm run db:init --prefix backend
npm run admin:bootstrap --prefix backend
npm start --prefix backend
```

La inicialización crea exclusivamente una base nueva y rechaza una existente; no migra ni borra datos. El bootstrap pide nombre y contraseña oculta en una terminal interactiva; no admite contraseña como argumento. Registro público crea solamente usuarios normales. No hay credenciales predeterminadas.

Consultar `http://127.0.0.1:3000/api/v1/health`. Ctrl+C cierra servidor y conexión. `.env` se resuelve desde la raíz aunque el comando se ejecute en otra carpeta. La demo está limitada al equipo local; no se ha realizado despliegue remoto.

### Demostración y pruebas

Importar [colección Postman](docs/api/coleccion.json) y [entorno sin secretos](docs/api/entorno.example.json). Ejecutar sus 24 solicitudes en orden con Collection Runner y cookie jar habilitado. Genera una cuenta ficticia por recorrido, guarda cookie/CSRF durante la ejecución, demuestra ambos CRUD y termina con logout. Usar una base de demostración; las cuentas no se eliminan mediante API.

```powershell
npm test --prefix backend
node --test backend/test/integration/collection.test.js
```

El primer comando ejecuta las pruebas de datos, seguridad y recursos. El segundo ejecuta la integración: colección HTTP real, acceso cruzado, CSRF, cierre de proceso, reinicio y exportación sin credenciales. Solo requiere Node y las dependencias del backend; no Python ni cámara. Juntas son 25 pruebas de backend; en la verificación del 5 de noviembre de 2026 las 25 aprobaron. El contrato OpenAPI documenta 16 rutas y 22 operaciones. Para ejecutar las 25 juntas:

```powershell
node --test --test-concurrency=1 backend/test/database/*.test.js backend/test/security/*.test.js backend/test/resources/*.test.js backend/test/integration/*.test.js
```

Para mostrar persistencia manual, detener la colección después de la solicitud 18, cerrar el servidor con Ctrl+C, volver a iniciarlo y repetir la lectura del modo. Guardar únicamente `data` de la solicitud 18 si el equipo del motor necesita configuración; no entregar cookie, CSRF, contraseña ni exportaciones del entorno autenticado.

Al salir del Runner sus variables locales desaparecen: copiar `modo.id` de la respuesta 18 y usarlo directamente en la URL de lectura. Mantener el cookie jar. El [registro de pruebas](docs/hito2/pruebas.md) explica también cómo completar el borrado manual.

### Aplicación Tauri en Windows

Requiere Rust MSVC, herramientas de compilación C++, WebView2 y Python 3.11. Instalar dependencias desde la raíz:

```powershell
npm ci
python -m venv motor-local/.venv
motor-local/.venv/Scripts/python.exe -m pip install -r motor-local/requirements.txt
npm run desktop:build
```

Conservar el `.env` ya configurado. Iniciar el backend en una terminal con `npm start --prefix backend` y abrir `desktop/target/debug/zerotouch-desktop.exe` en otra. Tauri usa `http://127.0.0.1:3000`; si cambias el puerto, establece `ZEROTOUCH_BACKEND_URL` en el entorno desde el que abres Tauri. El cliente conserva cookie y CSRF en memoria nativa. No arranca ni inicializa otra base de datos. El control local puede abrirse sin iniciar sesión; las operaciones de cuenta necesitan el backend.

Tauri busca primero Python en `motor-local/.venv`. El motor comienza en observación; el usuario habilita el control explícitamente. El control solo se habilita con cámara abierta y con la parada de emergencia **Ctrl+Alt+Z** registrada; si el atajo no queda activo, el motor lo informa y no habilita el control. Compilar no demuestra detección, precisión o seguridad manual: la cámara y las acciones deben comprobarse con el usuario. No hay instalador ni distribución autónoma validada.

Pruebas del motor (sintéticas, sin cámara):

```powershell
motor-local/.venv/Scripts/python.exe -m pytest motor-local/tests
cargo test --manifest-path desktop/Cargo.toml --locked
```

La primera ejecuta las pruebas sin hardware (la prueba de proceso real va marcada `hardware`). La segunda cubre el cierre cooperativo del motor. Ninguna sustituye la prueba física en Windows.

Comprobaciones adicionales:

```powershell
npm run verify:separation
npm run desktop:test
motor-local/.venv/Scripts/python.exe -m pip install -r motor-local/requirements-dev.txt
motor-local/.venv/Scripts/python.exe -m pytest motor-local/tests
```

### Documentación y límites

- [Contrato OpenAPI](docs/api/openapi.yaml): rutas, DTO, validación y respuestas.
- [Datos y seguridad - I1](docs/hito2/datos-seguridad.md).
- [API y arquitectura - I2](docs/hito2/api-arquitectura.md).
- [Pruebas y guion - I3](docs/hito2/pruebas.md).
- [Trazabilidad Hito 1](docs/hito2/trazabilidad.md).
- [Informe consolidado del backend](docs/hito2/informe.md).

Las notas I1/I2 describen sus entregas históricas; el registro I3 consolida la integración actual. Falta revisión cruzada, instalación en otro equipo y ensayo de la demo. La prueba automática ejecuta las solicitudes de la colección, pero no valida la interfaz de Postman. El motor no forma parte de la comprobación del backend.

Problemas frecuentes: base existente al inicializar (usar la ya creada y arrancar servidor); ruta dentro de OneDrive (usar AppData local); 403 en mutación (usar CSRF de la sesión actual); 409 al editar (volver a leer version); 503 (cerrar el proceso que mantiene bloqueada SQLite); 429 (esperar el límite de autenticación, sin desactivar protección). Los errores genéricos no exponen SQL ni secretos.
