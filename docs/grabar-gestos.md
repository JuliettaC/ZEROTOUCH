# Grabar los videos de ejemplo de cada gesto

La bienvenida, el inicio y la página de Calibrar muestran cada gesto con un video corto en bucle de una mano
real. Mientras no haya video, se ve el emoji del gesto. Los videos **no se graban dentro de ZeroTouch**: es
material que se crea una sola vez y la app no guarda video de nadie.

## Cómo grabar (unos 15 minutos)

1. Abre la app **Cámara** de Windows y pasa a **Video**. Usa la misma webcam y la misma posición en que usas
   ZeroTouch, con buena luz y un fondo liso detrás de la mano.
2. Para cada gesto, graba unos 5 s: la mano entra quieta, hace el gesto despacio una o dos veces y se queda
   quieta. Que solo aparezca la mano (sin cara, sin pantallas, sin papeles con datos).
3. Recorta cada video a **2–3 s** con la app **Fotos** de Windows: abre el video, «Recortar» y guarda una copia.
4. Copia los archivos a `public/gestos/` con estos nombres:

| Gesto | Archivo | Cómo se hace |
|---|---|---|
| Mover el cursor | `mover.mp4` | Mano abierta, muévela un poco |
| Hacer clic | `clic.mp4` | Junta un instante índice y pulgar |
| Desplazar | `desplazar.mp4` | Índice y medio extendidos, sube y baja la mano |
| Pausar o reanudar | `pausar.mp4` | Cierra el puño y mantenlo |
| Arrastrar *(opcional)* | `arrastrar.mp4` | Pinza sostenida mientras mueves la mano |
| Clic derecho *(opcional)* | `clic-derecho.mp4` | Pinza de pulgar y dedo medio |
| Pestaña siguiente *(opcional)* | `pestanas.mp4` | Mano abierta y ladeada: un abanico rápido hacia el lado del pulgar |

5. Avísale a Claude o actívalos tú en `src/data/gestureMedia.js` (por ejemplo `pointer: 'mover.mp4'`). La app
   los muestra sin sonido y en bucle. Si un archivo falta o no se puede reproducir, vuelve al emoji.

Tamaño orientativo: menos de 1 MB por clip. Si el MP4 de la Cámara pesa mucho, grábalo en la resolución más baja.
Estos videos son tuyos y quedan en el repositorio: decide tú si los subes a GitHub (son públicos si el
repositorio lo es).
