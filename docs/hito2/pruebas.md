# Registro de pruebas - Hito 2

Fecha: 2 de noviembre de 2026. Entorno local Windows, Node 24.19.0. Datos ficticios y bases temporales fuera de OneDrive. No se usaron bases reales ni se publicaron servicios. El usuario reasignó el motor a Antigravity; este registro se centra en backend.

## Automatizadas

```powershell
node --test --test-concurrency=1 backend/test/database/*.test.js backend/test/security/*.test.js backend/test/resources/*.test.js backend/test/integration/*.test.js
```

Backend: 25 pruebas aprobadas, cero fallos, en la verificación del 5 de noviembre de 2026. Incluye pruebas de datos, seguridad, recursos e integración. La integral ejecuta 24 solicitudes definidas en la colección, sus scripts de comprobación con un adaptador pm limitado, más comprobaciones propias de aislamiento, CSRF, reinicio y exportación JSON. No equivale a ejecutar la interfaz de Postman ni demuestra compatibilidad de todas sus funciones. La suite final no depende de Python, motor ni cámara.

| Área | Evidencia |
|---|---|
| Datos | Siete tablas, FK, tipos/rangos, UUID, hashes, cascadas, esquema ajeno rechazado |
| Seguridad | Registro/login/logout, sesión expirada, rol indebido, suspensión/revocación, último admin, CSRF/origen, límites y acceso cruzado |
| API | Dos CRUD, listados, JSON/tamaño/formato, duplicados, versión concurrente, SQL como texto, códigos seguros |
| Persistencia | Cierra proceso con código 0, nuevo PID sobre el mismo archivo y recuperación de modo/sesión |
| Exportación | JSON real sin credenciales, formato 1, modo editado versión 2 y 13 gestos con booleanos |

## Reproducción con colección

Importar `docs/api/coleccion.json` y opcionalmente `entorno.example.json`. Base URL por defecto: http://127.0.0.1:3000/api/v1. Ejecutar Collection Runner en orden y con cookie jar habilitado. Cada recorrido genera cuenta ficticia y contraseña temporal mediante GUID; las variables sensibles usan ámbito local `pm.variables` y no figuran en los archivos exportados. No exportar variables de una sesión autenticada. No hay DELETE de usuario: usar una base exclusiva para la demo.

Para mostrar persistencia manualmente, detener después del paso 18; parar servidor con Ctrl+C; arrancarlo sobre la misma base; repetir lectura del modo y después borrar modo/perfil. Para el motor guardar únicamente `data` de la respuesta 18. El recorrido completo elimina ambos recursos y cierra sesión; el archivo JSON previamente guardado continúa siendo una instantánea local, sin sincronización.

Las variables locales del Runner no se conservan al terminarlo. Para repetir manualmente la lectura, copiar `modo.id` de la respuesta 18 y reemplazar `{{modo_id}}` por ese UUID en la solicitud 13; conservar el cookie jar. Para borrar manualmente, obtener CSRF vigente mediante GET /auth/sesion y colocarlo en la cabecera, sin exportarlo. No reiniciar toda la colección para demostrar persistencia: eso crearía otro usuario.

## Manual y pendientes

Pendiente del backend: importación/ejecución en interfaz Postman, revisión cruzada, instalación en otro computador, ensayo cronometrado de siete minutos y comprobación remota de CI. La instalación limpia en el mismo equipo no sustituye otra máquina. Las evidencias preliminares del motor se conservaron por separado; no certifican el software que trabaja Antigravity.

Solicitud preparada para I2 (no enviada): incorporar `test/integration/*.test.js` a npm test y CI. No requiere Python. I3 ejecuta el comando explícito sin modificar el manifiesto de I2. Las pruebas de producción no contienen bypass de autenticación ni rutas de fixtures.

## Guion de siete minutos

| Tiempo | Responsable | Acción |
|---|---|---|
| 0:00-1:45 | I2 | API viva: crear, leer, editar y borrar perfil; repetir operaciones de modo preparado |
| 1:45-2:45 | I1 | Login, rechazo de acceso ajeno/CSRF y explicación de roles |
| 2:45-3:45 | I3 | Terminar y reiniciar servidor; leer el modo persistente y exportar JSON |
| 3:45-4:45 | I3 | Contrato JSON, errores 409/400 y límites de la exportación para el software |
| 4:45-6:00 | I1/I2 | Modelo, capas y decisión de SQLite local; versión y cascadas |
| 6:00-7:00 | Todos | Pruebas, límites, continuidad H1 y trabajo posterior |

Preparar antes cuentas sintéticas y un modo persistente; no dejar contraseñas en diapositivas ni capturas. No sustituir la API viva por imágenes. El equipo puede reorganizar el minuto de exportación cuando valide por separado el software gestual.
