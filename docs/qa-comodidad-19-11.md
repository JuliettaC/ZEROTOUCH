# QA de comodidad y reconocimiento del motor (19-11-2026)

**Pedido:** «no es tan cómoda de usar ni reconoce tan bien los gestos; actúa como QA y arréglalo». Problemas reportados con la webcam del notebook: cursor incómodo, clic que falla, gestos que no se detectan o se confunden, y cansancio o dificultad para armar el puntero.

**Método.** No hubo acceso a cámara ni a manos reales. Se construyó `motor-local/tools/banco_qa.py`: manos sintéticas con articulaciones (los dedos se flexionan hacia la cámara), proporción 4:3 de la webcam, temblor por punto de ~1,6 px (mayor en las puntas), balanceo lento de la mano, ruido de profundidad, 3 % de cuadros sin mano, 15 y 30 FPS y tres distancias (palma de 85, 55 y 42 px ≈ 45, 70 y 90 cm). El banco ejecuta el `GestureInterpreter` real con la configuración por defecto de la interfaz. **Los números son sintéticos**: sirven para comparar versiones, no prueban la precisión con personas.

## Resultados (antes → después)

| Medición | Antes | Después |
|---|---|---|
| 10 puños para pausar/reanudar (30 FPS, 45 / 70 / 90 cm) | 5 / 3 / 1 correctos; **2 / 2 / 9 arrastres accidentales** | 10 / 10 / 10; 0 arrastres |
| 10 puños (15 FPS, 45 / 70 / 90 cm) | 7 / 2 / 0; 1 / 3 / 10 arrastres | 10 / 10 / 10; 0 arrastres |
| Tiempo desde formar el puño hasta pausar | ~750 ms | ~455 ms |
| Posición del cursor con la mano a la altura natural frente a la webcam | **pegado al borde superior** (y = 0) | centro de la pantalla (se recentra al armar) |
| Temblor con la mano quieta en el aire (desv. típica) | 7–9 px (medido sin el borde que lo ocultaba) | 0 px; deriva ≤ 1 px en 15 s |
| Latencia del cursor (90 % de un salto) | 59 ms (30 FPS) / 74 ms (15 FPS) | igual |
| Barrido rápido de 0,22 de la imagen | llega al borde | llega a ~1 890 / 1 920 px y vuelve al centro |
| 20 s moviendo el cursor sin intención (por defecto) | 1–2 ventanas minimizadas o restauradas | 0 eventos |
| Pestañas al bajar 🤙 2,2 palmas (esperado 4) | 0 (el umbral del pulgar no se alcanzaba en 4:3) | 4 (3 a 90 cm y 15 FPS) |
| 10 clics derechos (pinza con el medio) | 9 | 10 |
| Volver tras 3,5 s sin la mano a la vista | había que re-armar | sigue armado (hasta 8 s) |
| 40 micro-pinzas / pinza sostenida | 40/40 / arrastre correcto | igual |

## Defectos y correcciones (`motor-local/motor_local/interpreter.py`, `config.py`)

1. **Cerrar el puño iniciaba un arrastre.** Al cerrar la mano, el pulgar toca el índice enrollado y eso confirmaba una pinza. Ahora, si el índice está enrollado hacia la palma, no es pinza.
2. **Un cuadro sin mano o dudoso reiniciaba el puño.** MediaPipe pierde la mano en cuadros sueltos, sobre todo con el puño cerrado. Ahora se toleran 2 cuadros (≤ 150 ms) sin mano y 2 cuadros dudosos, salvo que la mano se abra de verdad, que es soltar el puño a propósito.
3. **Exigencia de quietud del puño menor que el ruido de la cámara** a 70–90 cm (2 px). Ahora es 0,15 palmas.
4. **La pausa tardaba ~750 ms** porque el tiempo de sostener empezaba al confirmar. Ahora cuenta desde que se forma el puño.
5. **Zona activa fija:** con la mano a la altura natural, el cursor quedaba en el borde superior y había que levantar el brazo. Ahora, al armar el puntero, donde está la mano pasa a ser el centro de la pantalla (salvo que haya calibración de recorrido medida).
6. **Temblor:** con 640×480, 1 px de cámara son ~7,6 px de pantalla. Se agregó **aceleración del puntero**: los movimientos lentos se escalan ×0,3 (precisión, sin temblor) y los rápidos ×1, realineando el cursor con la posición absoluta de la mano. Se puede apagar en la vista de cámara («Cursor con aceleración»; `pointerAcceleration`, ajuste del equipo).
7. **El clic se corría** unos píxeles mientras los dedos se juntaban. Ahora cae donde estaba el cursor 90 ms antes de la pinza.
8. **Pinza con la mano lejos:** el umbral absoluto (pensado para una palma de 0,15) hacía que la pinza entrara sola y no se soltara (clic → arrastre). Ahora solo se usa la relación con el tamaño de la palma.
9. **«Mano abierta rápida abajo/arriba» minimizaba ventanas** al mover el cursor rápido. Ahora viene **apagado** (opt-in) y exige 2 palmas a 5 palmas/s (antes 1,3 palmas a 3,5 palmas/s).
10. **El puntero se desarmaba a los 3 s sin mano.** Ahora a los 8 s.
11. **Pestañas (🤙):** en 4:3 la distancia horizontal del pulgar se mide un 25 % más corta, así que el umbral de 0,6 palmas no se alcanzaba. Ahora es 0,4, con 220 ms entre cambios.

## Pruebas

`motor-local/tests/test_qa_comodidad.py` (10 pruebas): cada una falla si se revierte su corrección. Se comprobó deshabilitando cada arreglo uno por uno. Se actualizaron 4 pruebas previas que fijaban los valores anteriores (barrido vertical activado por defecto, umbrales del barrido y desarme a los 3 s). La fixture `tests/frontend/fixtures/engine-applied.json` se regeneró con el motor: solo cambian `windowSwipe` (false) y la clave nueva `pointerAcceleration`.

## Límites y lo que falta

- Nada de esto se probó con cámara ni manos reales. Los umbrales siguen siendo hipótesis. Conviene repetir la «Prueba rápida» y la sección 6 de `docs/prueba-manual-hardware.md`.
- Con aceleración, el cursor ya no es una copia exacta de la posición de la mano en los movimientos lentos. Si incomoda, se apaga en la vista de cámara.
- Los gestos de pulgar arriba/abajo suponen el puño de lado; con la palma de frente a la cámara, el pulgar hacia arriba puede leerse como puño (pausa). Siguen apagados por defecto.
- Una mejora pendiente de fondo: medir las distancias en unidades isotrópicas (corrigiendo el 4:3) en todo el intérprete. Se descartó en este bloque porque cambia todos los umbrales a la vez sin datos reales para recalibrarlos.
- Las preferencias guardadas antes de este cambio conservan `windowSwipe: true`. Hay que apagar «Mano abajo / arriba» en la lista de gestos una vez.

## 2ª iteración (19-11-2026, tras probarlo)

**Comentario de la usuaria:** «se siente más raro»: cursor lento o pegajoso, gestos raros y mucho brazo para llegar a las esquinas. Las tres cosas se reprodujeron en el banco:

| Medición | 1ª iteración | 2ª iteración |
|---|---|---|
| 10 pinzas con el índice muy doblado (punta proyectada en o bajo el nudillo) | **0** clics | 10 |
| Recorrido de la mano para cruzar la pantalla (velocidad normal / rápida, fracción del ancho de imagen) | no llegaba al borde | 0,21 / 0,20 (sin aceleración: ~0,39) |
| Arranque con un movimiento lento (ms hasta 15 px) | 259 | 155 |
| Latencia del cursor (30 FPS) | 59 ms | 30 ms |
| Temblor con la mano quieta | 0 px (cursor frenado) | ~5 px; deriva ≤ 7 px en 15 s |
| 10 puños / falsos positivos al mover | 10 / 0 | 10 / 0 |

Causas y cambios:
1. **Gestos raros:** la regla «índice enrollado = no es pinza» bloqueaba pinzas reales, porque con la palma hacia la cámara el índice doblado se proyecta cerca del nudillo. Ahora solo se descarta la pinza si índice, medio **y** anular se cierran a la vez (puño en formación).
2. **Pegajoso y sin llegar a las esquinas:** la aceleración solo reducía (×0,3, nunca más de ×1) y además el cursor asentado exigía salir de un radio. Ahora es una curva tipo mouse: ×0,6 en lento, ×1,2 en normal y ×2,5 en rápido (`pointer_gain`), sin cursor asentado cuando hay aceleración. Como un mouse, si se empuja el cursor contra un borde, al volver queda corrido respecto de la mano.
3. **Cursor congelado con la mano fuera del área activa:** la posición se recortaba a [0, 1] antes del filtro y la aceleración. Ahora se recorta solo la posición final.

Pruebas nuevas en `test_qa_comodidad.py` (13 en total; cada una falla si se revierte su arreglo).
