# Prototipo académico preservado

Esta carpeta documenta el límite; las fuentes históricas permanecen en
`../src/`, `../public/`, `../index.html` y `../vite.config.js` para conservar
sin modificaciones el despliegue existente y sus rutas.

`npm run dev`, `npm run build` y `npm run preview` desde la raíz siguen siendo
del prototipo. Pages publica únicamente `dist/` raíz en
https://juliettac.github.io/ZEROTOUCH/ mediante `.github/workflows/deploy.yml`.
No hay API, base de datos, cámara real ni integración con el sistema operativo.
Las preferencias locales y los datos ficticios son parte de la demostración.

No editar estas fuentes para desarrollar la aplicación. Trabajar en `frontend/`.
No importar el prototipo desde la aplicación ni copiarlo al futuro ejecutable.
`npm run verify:separation` compara los archivos preservados con su SHA-256 original.
Referencia recuperable: `codex/respaldo-auditoria-20261021`, commit
`c408c3b26188891efb02c362d6e2facd47267fc1`.
