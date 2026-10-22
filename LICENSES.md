# Licencias y distribución

Los avisos de dependencias instaladas están en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
No otorgan una licencia al código propio de ZEROTOUCH ni acreditan permisos de
imágenes, marcas, fuentes o modelos. No se ha añadido una licencia al proyecto.

Antes de redistribuir, comprobar los archivos efectivamente empaquetados y
conservar los avisos de sus versiones exactas. MIT/ISC/BSD requieren conservar
avisos; Apache-2.0 añade condiciones de licencia/avisos y cambios; componentes
MPL-2.0 requieren considerar acceso a la fuente cubierta. Los datos CC-BY-4.0
requieren atribución y condiciones aplicables. La dependencia determina las
obligaciones, no el hecho de usarla para un trabajo universitario.

Argon2: binding MIT; referencia C incluida bajo elección CC0-1.0 o Apache-2.0.
Ambos textos figuran en los avisos. Node y otros runtimes pueden contener terceros
adicionales: incluir sus avisos exactos si se empaquetan. No se contrata un servicio
de pago para instalar estas bibliotecas; alojamiento y mantenimiento son aparte.

No existe registro acreditado del origen/permiso de las imágenes, iconos y fuentes
de las presentaciones. No reutilizarlos en distribución nueva sin resolverlo.
Modelos/pesos gestuales futuros requieren su propia revisión de licencia.

`npm run audit:licenses` lee lockfiles y textos instalados, actualiza los avisos
públicos y genera inventarios locales ignorados. No necesita documentos internos
preexistentes. Un paquete solo con metadatos no equivale a texto legal verificado.

Comprobar vulnerabilidades por separado con `npm audit` en raíz y backend. La
revisión del 22-10-2026 reportó cero conocidas en backend y avisos altos para Vite
y source-map-js en raíz. Las herramientas raíz permanecen sin actualizar por la
preservación del prototipo; evitar exponer el servidor de desarrollo.
