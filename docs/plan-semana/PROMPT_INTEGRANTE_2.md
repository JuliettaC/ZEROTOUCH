# Prompt I2 — API y arquitectura (35 horas)

Copia el texto siguiente en una sesión de Codex abierta en tu clon de ZeroTouch.

---

Eres I2, responsable de API y composición del Hito 2 de ZeroTouch. El equipo dispone de siete días, cinco horas diarias por persona. Tu planificación es 35 horas humanas: 25 de construcción y 10 de pruebas, correcciones, documentación y defensa.

Lee AGENTS.md en la raíz. Su contrato es común a los tres integrantes. Este prompt autoriza implementar tu área. I1 hace datos/autenticación; I3 motor/pruebas integrales/documentación consolidada. No conectes React con el backend esta semana.

## Inicio

1. Lee instrucciones y estado de Git; identifica cambios posteriores a la auditoría y conserva trabajo ajeno.
2. Usa o crea `codex/h2-api-recursos` desde la base acordada sin sobrescribir modificaciones.
3. Si falta AGENTS.md, pide el archivo común antes de inventar contratos.
4. Desarrolla docs/api/openapi.yaml a partir del contrato ya acordado. No cambies nombres o autenticación unilateralmente.
5. Eres editor único de backend/package.json y package-lock.json. Recibe de I1 los paquetes necesarios; instala y comprueba compatibilidad. No actualices el frontend por comodidad.

## Trabajo ordenado

Día 1: estructura Express ejecutable, createApp({db,config}), JSON limitado, errores comunes y salud. Configuración raíz independiente del directorio de ejecución. OpenAPI inicial y contratos de imports con I1. Ajustar ESLint por entorno y preparar comandos de prueba sin asumir suites inexistentes.

Día 2: CRUD completo de perfiles por cuatro capas. La conexión viene de I1. Mientras esté pendiente, probar servicios con dobles y preparar fixtures exclusivos de test; no crear una conexión o esquema alternativo.

Día 3: CRUD completo de modos y montaje de autenticación. Al cierre deben funcionar login y ambos CRUD juntos. No fusionar endpoints desprotegidos ni un bypass de identidad de prueba.

Día 4: propiedad en todos los accesos, validación, versiones, cascadas, catálogos y lectura de configuración gestual efectiva. No construir editor general de gestos ni endpoints opcionales antes de completar el mínimo.

Día 5: pruebas API/seguridad de recursos, contrato completo y sección de arquitectura/API. Entregar ejemplos a I3 para colección e informe.

Día 6: corregir defectos, comprobar instalación y completar documentación de ejecución/composición.

Día 7: regresión y defensa. Ninguna función nueva.

## Archivos propios

backend/src/app.js, server.js, config/env.js; domain/** y middleware/errors.js; validación común; archivos perfiles*, modos*, catalogos* de rutas/controladores/servicios/repositorios; salud; backend/test/resources/**; manifiesto y lockfile backend; eslint.config.js; .github/workflows/test.yml; docs/api/openapi.yaml; docs/hito2/api-arquitectura.md.

No edites SQL, conexión, autenticación, criptografía ni sesiones de I1. No edites motor, pruebas integrales, colección ni README consolidado de I3. No cambies src/ ni desktop/runtime/. Coordina modificaciones a archivos compartidos.

## Implementación y contrato

- Monolito modular: rutas → controladores → servicios → repositorios. SQL solo en repositorios; reglas en servicios.
- createApp({db,config}) no escucha ni inicializa datos al importar; server.js abre/monta y cierra correctamente.
- I1 entrega openDatabase, createAuthRouter, createAuthMiddleware y createAdminRouter. Monta públicos y protegidos en el orden de AGENTS.md.
- /api/v1; DTO español/snake_case; éxito {data:...}; listados con paginacion {limite,offset}; error {error:CODIGO,mensaje:...}.
- Propietario viene de req.auth.usuarioId, nunca del body. Modos y asignaciones se autorizan a través del perfil.
- Repositorios delimitados por usuario. Admin no salta propiedad.
- PATCH de perfiles/modos exige version esperada, compara e incrementa atómicamente y responde 409 al conflicto.
- UUID, nombres normalizados, límites y booleanos reales; rechazar campos desconocidos y PATCH vacío. No permitir reasignación de dueño/padre.
- 201 con Location, 200 consulta/edición, 204 vacío; 400/401/403/404/409 y errores técnicos según AGENTS.md.
- Configuración de cámara no implica implementación de sensores. No recibir imágenes ni ejecutar acciones del SO en Express.

## Endpoints propios

GET /health.
GET/POST /perfiles; GET/PATCH/DELETE /perfiles/:id.
GET/POST /perfiles/:id/modos; GET/PATCH/DELETE /modos/:id.
GET /gestos; GET /acciones; GET /modos/:id/gestos.
Todos bajo /api/v1. La última ruta devuelve configuración efectiva: sobreescrituras y habilitación; si falta asignación, utiliza el catálogo. Documenta DTO estable para exportarlo a un archivo de configuración no secreto.

No construyas PUT/DELETE de asignaciones, interfaz web nueva ni sincronización automática mientras quede pendiente cualquier requisito obligatorio. No crees JWT ni segundo login.

## Pruebas obligatorias

Dos CRUD reales contra SQLite aislada; listados/individuales; propiedad en lectura/edición/borrado y recursos hijos; JSON inválido, campos inesperados, UUID, rangos y tipos; duplicados, FK, cascadas; versiones concurrentes; catálogo efectivo; 404 JSON, 204 vacío y 500 seguro; límites de cuerpo/formato; recursos sin sesión. Coordina reinicio real con I3.

No soluciones fallos quitando seguridad, usando respuestas falsas o abriendo CORS universal. Mantén loopback para demo local; documenta lo pendiente para producción remota.

## Entregables

Al día 3: dos CRUD protegidos. Al día 5: pruebas y contrato documentado. Entrega a I3 endpoints/cuerpos/errores reales y a I1 cualquier defecto reproducible de conexión o autenticación.

Commits locales pequeños de archivos propios comprobados: estructura; perfiles; modos/catálogos; integración seguridad; pruebas/documentación. Prepara PR revisable por otro integrante; sin push/merge/publicación no autorizados.

Al cerrar cada bloque comunica rama/commit, archivos, endpoints y contratos, comandos/resultados de prueba, fallos y dependencias. Explica el recorrido de una petición y por qué se eligió Express y monolito. Continúa trabajo independiente si otro módulo no está listo, sin duplicarlo.
