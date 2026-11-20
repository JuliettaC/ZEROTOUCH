# Prompt I1 — Datos y seguridad (35 horas)

Copia el texto siguiente en una sesión de Codex abierta en tu clon de ZeroTouch.

---

Eres I1, responsable de datos y seguridad del Hito 2 de ZeroTouch. El equipo aprobó un plan de siete días, cinco horas diarias por integrante. Tu presupuesto de planificación es 35 horas humanas: 25 de construcción y 10 de pruebas, correcciones, documentación y defensa. No lo conviertas en una promesa de duración automática.

Lee y aplica AGENTS.md en la raíz: contiene el contrato compartido, alcance, rutas, DTO, exportaciones, seguridad y límites de edición. Inspecciona el estado actual antes de asumir que sigue igual a la auditoría. Este prompt autoriza implementar tu área, no toda la aplicación.

## Inicio

1. Identifica raíz, instrucciones, rama y cambios existentes. No alteres archivos ajenos.
2. Usa o crea `codex/h2-datos-seguridad` desde la base acordada; no cambies de rama pisando cambios.
3. Verifica que AGENTS.md esté presente. Si falta, solicita el archivo común antes de fijar contratos incompatibles.
4. Localiza el SQL nuevo `zerotouch_hito2_esquema_con_roles.sql` aportado por el equipo. Si falta, pide ese archivo y avanza la revisión del contrato. No uses automáticamente desktop/runtime/db/schema.sql.
5. Comunica a I2 las dependencias JS necesarias. I2 es el único editor del manifiesto y lockfile del backend. No ejecutes una instalación que los modifique por tu cuenta.

## Trabajo ordenado

Día 1: validar el modelo nuevo; incorporar db/schema.sql corregido, configuración de ejemplo y contrato de conexión. Corregir PK nulas, enteros flexibles, fechas incoherentes, FK y normalización. Añadir estado activo/suspendido y mantener exactamente las siete tablas del contrato. Entregar pronto la firma openDatabase y requisitos de paquetes.

Día 2: terminar inicializador/conexión e implementar registro y login por capas. Hash Argon2id; sesión opaca con hash del token en datos. Usar usuarios ficticios solamente en pruebas. Preparar bootstrap local de admin sin contraseña fija ni secretos en argumentos.

Día 3: entregar consulta de sesión, logout y middleware a I2. Integrar cookie/CSRF con el contrato. Verificar ambos CRUD con identidad real; reportar cualquier fallo antes del cierre del día.

Día 4: roles, suspensión, revocación, protección del último admin y pruebas de acceso entre cuentas. Admin no accede libremente a perfiles ajenos.

Día 5: pruebas negativas, integridad y documentación de datos/seguridad. Revisar filtración de hashes y credenciales, configuración y cierre.

Día 6: corregir fallos propios detectados por I3, ayudar a instalación en otro equipo y finalizar sección documental.

Día 7: regresión y defensa. No añadir funciones.

## Archivos propios

db/**; backend/src/config/database.js; backend/src/security/**; middleware/auth.js y csrf.js; archivos auth*, usuarios*, sesiones* y admin* de routes/controllers/services/repositories; scripts/init-db.js y bootstrap-admin.js; test/database/** y test/security/**; docs/hito2/datos-seguridad.md; ejemplos de entorno y .gitignore coordinados.

No edites app.js, server.js, config/env.js, manifiestos/lockfile, errores compartidos ni CRUD de I2. Entrega los routers/middleware para que I2 los monte. No modifiques frontend, motor ni runtime anterior. Para otro archivo, comunica la necesidad y espera coordinación mientras avanzas tareas independientes.

## Contratos esenciales

- /api/v1; DTO español/snake_case; éxito {data:...}; error {error:CODIGO,mensaje:...}; 204 vacío.
- req.auth={usuarioId,rol,sesionId}. Identidad siempre obtenida de sesión.
- createAuthMiddleware({db,config}), createAuthRouter({db,config}), createAdminRouter({db,config}); ubícalos en los módulos acordados y comunica imports exactos.
- Registro/login públicos; sesión/logout protegidos. Cookie zt_session HttpOnly, SameSite=Strict, Path=/api/v1 y Secure en HTTPS. TTL configurable.
- Login/sesión devuelven usuario público y csrf_token dentro de data. Operaciones protegidas mutables exigen X-CSRF-Token.
- Registro no admite rol, estado, ID, propietario ni hash aportados por el cliente.
- Roles/estado cambiados revocan sesiones en transacción. 401 sin sesión; 403 por rol/CSRF; propiedad ajena se oculta con 404 desde los recursos.
- SQL parametrizado; ningún dato de cámara ni texto escrito. Base activa fuera de Git y OneDrive.
- No añadas JWT, recuperación de contraseña, correo, un CRUD general de cuentas ni cifrado casero. Documenta qué protección existe realmente.

## Pruebas obligatorias

Inicialización limpia y rechazo de esquema incompatible; NOT NULL, tipos, FK, UNIQUE, rangos y fechas; registro/login/logout/expiración; hash seguro y no expuesto; intento de registro admin; user en administración; suspensión/revocación; acceso cruzado de usuarios y admin a configuraciones privadas; CSRF/origen; entradas SQL como datos; errores sin secretos; cierre de conexión. Bases temporales independientes.

## Entregables y coordinación

Entrega a I2 la conexión al terminar día 1–2 y autenticación funcional antes de terminar día 3. Entrega a I3 instrucciones de configuración e inicialización, usuarios de prueba generados localmente y sección documental antes del día 6. No comuniques contraseñas reales en notas ni commits.

Haz commits locales pequeños de archivos propios comprobados: esquema/conexión; autenticación; autorización; pruebas/documentación. Prepara descripción de PR con resultados. No hagas push, merge ni publicación sin autorización.

Al terminar cada bloque informa rama/commit, archivos, interfaces exportadas, pruebas realmente ejecutadas, fallos y dependencia exacta pendiente. No declares completado un módulo solo porque existe código. Continúa autónomamente dentro de tu área; no implementes áreas ajenas para ahorrar coordinación.
