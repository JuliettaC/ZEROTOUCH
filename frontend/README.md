# Aplicación real — base independiente

Desde la raíz: `npm ci`, `npm run dev:app` (http://127.0.0.1:5174),
`npm run build:app` y `npm run preview:app`.

React y Vite usan el manifiesto y lockfile raíz; no hay una segunda instalación
ni copia de componentes del prototipo. Esta base mínima tiene su propia entrada,
estilos, ruta hash `#/`, página no encontrada y configuración. No implementa CRUD,
cámara ni reconocimiento; no simula datos ni consume la API.

La salida exclusiva es `frontend/dist/`. El futuro empaquetador solo podrá tomar
esa salida, más los servicios que se autoricen. Nunca `dist/` raíz, `src/` raíz
ni `public/` raíz. `publicDir: false` evita copiar los recursos del prototipo.
GitHub Pages continúa construyendo exclusivamente el prototipo de la raíz.

Si se necesita configuración: copiar `.env.example` a `.env` dentro de esta
carpeta. Vite carga el entorno de `frontend/`, separado del `.env` del backend.
Las variables `VITE_*` son visibles al usuario en el código compilado.
