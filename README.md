# <img width="35" height="35" alt="ICON NEGRO" style="vertical-align: -6px;" src="https://github.com/user-attachments/assets/d52f48df-cfcb-40aa-8178-1989bbdff02e" /> ZEROTOUCH

Para personas que realizan tareas manuales mientras consultan información digital, ZeroTouch propone una interacción gestual que busca reducir el contacto directo con el dispositivo y las interrupciones durante la actividad, sin requerir sensores gestuales especializados adicionales.

## Video promocional
https://github.com/user-attachments/assets/e38ed437-f08b-494a-a723-1d1e74e901b4

## Integrantes

* Julietta Céspedes (@JuliettaC)
* Adan Mendoza (@Adammm14)
* Anais Perez (@Youpuipui)

## Instalación (Windows)

### Requisitos

| Herramienta | Versión |
|---|---|
| Git | cualquiera reciente |
| Node.js | 24.x |
| Python | 3.11 |
| Rust | toolchain MSVC |
| Build Tools de Visual Studio | con la carga de trabajo de C++ |
| WebView2 | incluido en Windows 11 |

La cámara web solo se necesita para usar los gestos.

### 1. Descargar e instalar dependencias

Todos los comandos se escriben en PowerShell, dentro de la carpeta del proyecto.

```powershell
git clone https://github.com/JuliettaC/ZEROTOUCH.git
cd ZEROTOUCH
npm ci
npm ci --prefix backend
python -m venv motor-local\.venv
motor-local\.venv\Scripts\python.exe -m pip install -r motor-local\requirements-dev.txt
```

### 2. Configurar el servidor y crear la base de datos

```powershell
Copy-Item .env.example .env
```

Abre `.env` y revisa `DATABASE_PATH`: debe ser una ruta absoluta, **fuera de la carpeta del proyecto y de OneDrive**. El valor del ejemplo (`C:\ZEROTOUCHdata\zerotouch-hito2.db`) sirve si no existe ya un archivo con ese nombre.

```powershell
npm run db:init --prefix backend
```

Debe responder `Base nueva (esquema v4: nueve tablas) inicializada. No se crearon cuentas.`

### 3. Levantar el servidor

```powershell
npm start --prefix backend
```

Debe responder `ZeroTouch API lista en puerto 3000`. Deja esa ventana abierta. En otra ventana puedes comprobarlo:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
```

### 4. Compilar y abrir la aplicación

En la segunda ventana, desde la carpeta del proyecto (la primera compilación tarda varios minutos):

```powershell
npm run desktop:build
```

```powershell
.\desktop\target\debug\zerotouch-desktop.exe
```

### 5. Crear una cuenta de prueba

1. En la aplicación, abre **Ajustes**, el icono de cuenta y **Crear cuenta**. Usa datos ficticios.
2. El correo no se envía: se guarda como archivo. Obtén el enlace de confirmación, cambiando el correo por el que registraste:

```powershell
npm run correo:enlace --prefix backend -- prueba@ejemplo.test
```

3. Abre el enlace en el navegador y pulsa **Confirmar mi correo**.
4. En la aplicación, inicia sesión y pulsa **Sincronizar**.

Para ver lo que quedó guardado en la base de datos, cambiando `usuario_prueba` por tu nombre de usuario:

```powershell
npm run db:modos --prefix backend -- usuario_prueba
```

### 6. Usar los gestos

En **Inicio**, pulsa **Iniciar cámara** y después **Activar control**. `Ctrl+Alt+Z` detiene el control al instante.

### Detener

`Ctrl+C` en la ventana del servidor. La aplicación se cierra desde su ventana.

## Problemas frecuentes

| Mensaje o síntoma | Solución |
|---|---|
| `La base ya existe; no se modificó.` | No es un error: usa esa base y levanta el servidor, o indica otra ruta en `DATABASE_PATH`. |
| `DATABASE_PATH debe estar fuera del repositorio, OneDrive y unidades de red.` | Cambia la ruta en `.env`. |
| La aplicación dice que el servidor no está disponible | Comprueba que la ventana del servidor siga abierta. |
| La cámara no abre | Cierra otras aplicaciones que la usen y revisa los permisos de cámara de Windows. |

Una base creada con una versión anterior se actualiza con `npm run db:migrate --prefix backend`. Hace un respaldo antes y elimina los gestos que ya no se ofrecen.

## Pruebas

```powershell
npm test --prefix backend
```

```powershell
node --test "tests/frontend/*.test.js"
```

```powershell
motor-local\.venv\Scripts\python.exe -m pytest motor-local\tests
```

## Prototipo funcional
[Prototipo](https://juliettac.github.io/ZEROTOUCH/)

## Documentos
### Hito 1
[Informe](docs/Informe%20Hito%201.pdf) 
### Hito 2
[Informe](docs/Informe%Hito%2.pdf) 
