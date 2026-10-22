# Frontera para integración futura

Consumir el contrato de `backend/api/README.md` mediante un cliente HTTP en esta
carpeta cuando se implemente el flujo. No importar repositorios ni SQLite.
`VITE_API_BASE_URL` está reservado como URL pública, no como credencial.
Todavía no hay llamadas, autenticación, proxy ni habilitación de CORS.

Antes de integrar, decidir selección de perfil, validación de formularios,
estados de carga/vacío/error y origen permitido. Para producción, servir la
API mediante el mismo origen o una política CORS explícita. El servicio actual
es local y no debe exponerse: requiere autenticación/autorización para evolucionar
al servidor remoto del Hito 1. No migrar el localStorage del prototipo.
