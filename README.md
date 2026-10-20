# <img width="35" height="35" alt="ICON NEGRO" style="vertical-align: -6px;" src="https://github.com/user-attachments/assets/d52f48df-cfcb-40aa-8178-1989bbdff02e" /> ZEROTOUCH
Para personas que realizan tareas manuales mientras consultan información digital, ZeroTouch propone una interacción gestual que busca reducir el contacto directo con el dispositivo y las interrupciones durante la actividad, sin requerir sensores gestuales especializados adicionales.

## Integrantes

* Julietta Céspedes (@JuliettaC)
* Adan Mendoza (@Adammm14)
* Anais Perez (@Youpuipui)

## Prototipo funcional
[Prototipo](https://juliettac.github.io/ZEROTOUCH/)

## Diseño en Figma
 [Diseño en Figma](https://www.figma.com/proto/bGRVznOtXKzQNOYC7Mz6XC/ZEROTOUCH?node-id=72-7285&t=Kh36kEKsnlZleHnc-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1&starting-point-node-id=72%3A7285&show-proto-sidebar=1)

## Documentos
### Hito 1
[Informe](docs/Informe%20Hito%201.pdf)
[Presentación](docs/Presentación%20Hito%201.pdf)


## Backend Hito 2: ejecución local

Implementado: CRUD de perfiles y contextos, SQLite persistente, validación,
capas y errores JSON. El frontend conserva las simulaciones y localStorage;
aún no consume esta API. No hay autenticación: el backend solo escucha en
loopback. No publicar mediante un túnel ni tratar perfiles como cuentas.

### Requisitos

- Node.js 24.x y npm (entorno verificado: Node 24.19.0, npm 11.17.0, Windows x64).
- Acceso a npm durante instalación; SQLite no necesita servidor instalado.
- Carpeta local escribible fuera de OneDrive para los datos.

### Instalación desde cero

Desde una copia del repositorio, en su directorio raíz:

```powershell
npm ci
npm --prefix backend ci
# Solo si todavía no existe .env:
Copy-Item .env.example .env
npm --prefix backend run db:init
npm --prefix backend start
```

No sobrescribir un .env existente. En macOS/Linux, usar `cp -n .env.example .env`
en lugar de Copy-Item. Los comandos npm son iguales. El archivo .env es opcional
si se aceptan los valores predeterminados; las variables del proceso tienen
prioridad. Se carga siempre desde la raíz, independientemente del directorio
actual. El antiguo ejemplo backend/.env.example remite al ejemplo raíz.

En otra terminal, desde la raíz:

```powershell
npm run dev
```

Vite mostrará la dirección del frontend, con base /ZEROTOUCH/. La API está en
http://127.0.0.1:3000/api/health. El frontend no es necesario para la demostración
CRUD. Ctrl+C cierra el servidor y su conexión SQLite.

### Configuración

| Variable | Predeterminado | Condición |
|---|---|---|
| NODE_ENV | development | development, test o production |
| HOST | 127.0.0.1 | Solo loopback; también ::1 o localhost |
| PORT | 3000 | Entero 0..65535; 0 elige puerto disponible y lo imprime |
| DATABASE_PATH | Directorio de datos local/ZeroTouch/entorno.sqlite | Ruta absoluta local fuera de OneDrive |

Windows usa LOCALAPPDATA/ZeroTouch/development.sqlite; en este equipo normal,
C:/Users/cespe/AppData/Local/ZeroTouch/development.sqlite. Otros sistemas usan
XDG_DATA_HOME o ~/.local/share. No se expanden variables como %LOCALAPPDATA%
dentro del valor de DATABASE_PATH: dejarlo vacío utiliza el directorio del SO.
La inicialización imprime la ruta efectiva. No guardar bases activas en la
carpeta del repositorio sincronizada. No se requieren usuario/contraseña SQLite.
El usuario del sistema operativo controla el acceso al archivo; no hay cifrado
ni control de acceso multiusuario en esta entrega.

### Pruebas y reproducción

```powershell
npm --prefix backend test
npm --prefix backend run test:collection
npm --prefix backend run verify:install
npm run lint
npm run build
```

La suite usa bases temporales aisladas y procesos reales. Incluye ambos CRUD,
errores, integridad y lectura después de detener/reiniciar el proceso.
verify:install copia solo fuentes/contrato/esquema a una carpeta temporal,
ejecuta npm ci sin reutilizar node_modules, corre la suite y elimina su copia.
Requiere red. Comprueba instalación limpia en el equipo actual, no sustituye
el ensayo presencial en otro computador.

### Petición inicial (PowerShell)

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
$profile = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/v1/profiles -ContentType application/json -Body '{"name":"Demo"}'
$body = @{ profileId = $profile.data.id; name = 'Cocina'; sensitivity = 65 } | ConvertTo-Json
$context = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/v1/contexts -ContentType application/json -Body $body
Invoke-RestMethod ("http://127.0.0.1:3000/api/v1/contexts/" + $context.data.id)
```

Para comprobar persistencia, conservar el ID, detener la API con Ctrl+C,
reiniciarla con la misma configuración y consultar ese ID. La colección
incluye creación, consulta, actualización, errores y borrado en orden.

### Endpoints

| Método | Ruta | Propósito | Éxito |
|---|---|---|---|
| GET | /api/health | Estado del proceso | 200 |
| POST | /api/v1/profiles | Crear perfil | 201 |
| GET | /api/v1/profiles | Listar con limit/offset | 200 |
| GET | /api/v1/profiles/:id | Consultar perfil | 200 |
| PATCH | /api/v1/profiles/:id | Editar campos enviados | 200 |
| DELETE | /api/v1/profiles/:id | Borrar si no tiene contextos | 204 |
| POST | /api/v1/contexts | Crear contexto de perfil | 201 |
| GET | /api/v1/contexts | Listar; filtro profileId opcional | 200 |
| GET | /api/v1/contexts/:id | Consultar contexto | 200 |
| PATCH | /api/v1/contexts/:id | Editar sin cambiar propietario | 200 |
| DELETE | /api/v1/contexts/:id | Borrar contexto | 204 |

Errores: 400 entrada/JSON, 404 inexistente, 409 conflicto, 413 tamaño,
415 tipo de contenido, 500 inesperado y 503 escritura bloqueada.
El [contrato completo](docs/api/README.md) especifica parámetros, cuerpos,
respuestas, límites y códigos por endpoint.

### Documentación técnica

- [Colección Postman importable](docs/api/ZeroTouch.postman_collection.json).
- [Modelo y reglas de integridad](db/README.md), [SQL reproducible](db/schema.sql).
- [Decisiones, SQLite frente a PostgreSQL y evolución del Hito 1](docs/decisiones-backend.md).
- [Verificación y trazabilidad](docs/verificacion-backend.md).

### Problemas frecuentes

- Base inexistente: ejecutar db:init con la misma configuración del servidor.
- Ruta rechazada: elegir una ruta local fuera de OneDrive; no usar UNC, enlaces
  a OneDrive ni carpetas sincronizadas. La validación no detecta todos los
  proveedores de sincronización: elegir conscientemente almacenamiento local.
- Puerto ocupado: cambiar PORT en .env; no detener procesos ajenos.
- Error al cargar better-sqlite3: comprobar Node 24 y ejecutar npm ci dentro de
  backend. No copiar node_modules desde otro sistema/versión de Node.
- Plataforma sin binario nativo: revisar requisitos de compilación del driver;
  la instalación en plataformas distintas a la verificada debe ensayarse.
- SQLite ocupado (503): cerrar otras herramientas con una transacción abierta
  y reintentar; no borrar archivos WAL para intentar liberar la base.
- Perfil no eliminable (409): borrar primero sus contextos.
- POST/PATCH 415: enviar Content-Type application/json.
- Una llamada desde React no funciona: no se implementó integración ni CORS;
  usar la colección o cliente HTTP para esta etapa.

No se generó informe académico ni presentación del Hito 2. Esos entregables
siguen pendientes y esta documentación operativa no los sustituye.
