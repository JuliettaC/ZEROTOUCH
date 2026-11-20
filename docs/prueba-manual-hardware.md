# Guía de prueba manual con cámara y manos (Windows)

Esta guía cubre **solo lo que ninguna prueba automática puede comprobar**: que la cámara real detecta tus manos, que el puntero y los gestos se sienten bien, que la parada de emergencia funciona de verdad y que el teclado Air-Swipe escribe lo que trazas. Tiempo total: **75–90 minutos**; se puede hacer en dos tandas (las secciones 1 a 4 son las críticas para la seguridad).

**Regla de oro del proyecto:** nada de lo que anotes aquí es una afirmación hasta que lo hayas medido. Anota lo que ves, con las condiciones (luz, distancia, mano), y no lo que esperabas ver.

## Prueba rápida tras los ajustes del 16-11-2026 (≈ 15 min)

Primero lee la sección 0.2 (seguridad). Después, con el **Bloc de notas** abierto detrás de ZeroTouch, **Inicio › Activar cámara › Controlar**, a 50–70 cm de la cámara y con buena luz de frente. Anota cada fila con el formato «aciertos / intentos» y cualquier comentario.

| # | Qué hacer | Qué debería pasar | Anota |
|---|---|---|---|
| R1 | Mano abierta quieta 1 s y luego mueve la mano despacio | El cursor se activa y se desliza suave, sin temblar con la mano quieta | ¿Tiembla? ¿Va a saltos? ¿Llegas a las 4 esquinas? |
| R2 | Pinza rápida (un toque) sobre un botón, 10 veces | Un clic por pinza | Aciertos/10 · clics de más · clics sin querer al mover |
| R3 | Pinza sostenida sobre la barra de título del Bloc de notas y mueve la mano | La ventana se arrastra; abrir los dedos la suelta | ¿Soltó bien? |
| R4 | Dos dedos arriba y abajo sobre un texto largo | Desplaza | ¿Se confunde con la pinza? |
| R5 | Puño quieto ~0,5 s, dos veces | Pausa y reanuda | Aciertos/4 |
| R6 | Con el Bloc de notas enfocado: mano abierta, bájala **rápido de una vez**; quieta; súbela rápido | Se minimiza y luego vuelve; aparece un aviso en ZeroTouch | Aciertos/10 en cada sentido |
| R7 | Mueve el cursor de arriba abajo varias veces a velocidad normal | **No** debe minimizar nada | Falsos disparos/10 |
| R8 | Abre el teclado (página Teclado) y usa ▲/▼ | Ocupa ~1/3 de la pantalla y cambia de arriba a abajo | ¿Tapa lo que escribes? |
| R9 | En Calibrar › Qué hace cada gesto activa *Pulgar abajo* y asígnale «Iniciar temporizador»; haz pulgar abajo ~0,5 s; repite | Arranca un temporizador (Inicio › Temporizadores); la segunda vez se pausa | ¿Se confunde con el puño de pausa? |

Si algo falla, anota también lo que muestran **Calibrar › Datos técnicos** (FPS, confianza, distancia de pinza, gesto) en ese momento: con eso se ajustan los umbrales.

## 0. Antes de empezar

### 0.1 Qué ya está verificado (no hace falta repetirlo)

- El borrado condicional, la sincronización y los conflictos contra un backend real (`npm run verify:tauri`, 31 comprobaciones).
- Que la ventana del teclado se crea, comparte datos con la principal, no roba el foco, tiene la geometría correcta a escala 150 % y rechaza escribir fuera de Controlar.
- Que el motor arranca en observación y se niega a pasar a Controlar sin cámara.
- Que cerrar la ventana principal con el teclado abierto y el motor en marcha cierra **todo** (antes dejaba la aplicación, el motor y la cámara vivos sin ventana principal; corregido en `main.rs` y comprobado).

### 0.2 Seguridad — léela antes de activar Controlar

En modo **Controlar** el motor mueve **el ratón real de tu equipo** y puede hacer clic, arrastrar, desplazar y pulsar teclas. Estas son las formas de detenerlo, de la más rápida a la más drástica:

| # | Cómo | Efecto |
|---|---|---|
| 1 | **Ctrl + Alt + Z** | Parada de emergencia: suelta los botones, pasa a Observar y pausa. Es el atajo principal. |
| 2 | **Retirar la mano** de la cámara (o taparla) | Sin mano no llegan órdenes: el cursor se queda donde está y los botones se sueltan en unos fotogramas. |
| 2b | Tu **ratón físico** | Sus clics siempre llegan (úsalo para pulsar «Observar», «Apagar cámara» o cerrar). Mientras tu mano esté a la vista el cursor volverá hacia ella: retira la mano antes. |
| 3 | Botón **Observar** (en Inicio) | Deja de mover el cursor; la cámara sigue encendida. |
| 4 | **Puño** mantenido ~medio segundo | Pausa (y otro puño reanuda). |
| 5 | Botón **Apagar cámara** | Detiene el motor por completo. |
| 6 | Cerrar la ventana / Administrador de tareas | El proceso del motor se cierra con la aplicación. |

**Prepara un entorno seguro:**

- Cierra o guarda cualquier trabajo importante. Abre solo lo necesario: **Bloc de notas** vacío, un **navegador** con una página larga (para desplazar) y con algo de historial (para Atrás/Adelante).
- **No arrastres archivos** ni uses «tres dedos» sobre ventanas con trabajo sin guardar. Para probar el arrastre usa **seleccionar texto** en el Bloc de notas o **mover la ventana del Bloc de notas** por su barra de título.
- Sin contraseñas ni datos privados visibles en pantalla.
- Cierra otras aplicaciones que usen la cámara (Teams, Zoom, el visor de cámara).
- Luz frontal suave (que no te dé a contraluz), mano a **50–70 cm** de la cámara, fondo sin otras manos.

### 0.3 Preparación

```powershell
npm run desktop:build
desktop\target\debug\zerotouch-desktop.exe
```

Funciona sin cuenta ni backend (modo local). Si quieres probar también la sincronización (sección 10), arranca el backend como siempre con tu `.env` habitual, **nunca** sobre una base con datos que te importen.

Comprueba antes de seguir:

- [ ] La insignia de la cabecera dice **«Cámara apagada»** y no hay otra ZeroTouch abierta.
- [ ] El LED de tu cámara está apagado.

### 0.4 Qué mirar en la pantalla

| Dónde | Qué te dice |
|---|---|
| Insignia de la cabecera y tarjeta de Inicio | Estado: Cámara apagada · Observando · Control activo / Controlando el cursor · En pausa · Parada de emergencia · Cámara no disponible. |
| **Lista de gestos** (Inicio y Calibrar) | Cada gesto pasa a **«Detectado ✓»** cuando el motor lo ve; **«Listo»** si no; **«Apagado»** si está desactivado. |
| **Calibrar → Datos técnicos** | Imágenes por segundo (FPS), latencia, puntos de la mano (21/21), confianza, distancia de pinza y gesto actual. |
| Línea bajo la tarjeta de Inicio | «Guardado y aplicado al motor» (o «pendiente» / «rechazó»). |

### 0.5 Gestos y su estado por defecto

| Gesto | Cómo se hace | Acción | Por defecto |
|---|---|---|---|
| Mano abierta | Abre la mano y **mantenla ~0,35 s** | Arma el puntero; después la mano mueve el cursor | Activo |
| Pinza | Junta índice y pulgar un instante | Clic izquierdo | Activo |
| Pinza sostenida | Mantén la pinza ~0,4 s y mueve; suelta para terminar | Arrastrar | Activo |
| Dos dedos | Índice y medio extendidos; sube o baja la mano | Desplazar | Activo |
| Puño | Cierra el puño y mantenlo ~0,5 s | Pausar / reanudar | Activo |
| Palma quieta | Palma abierta **sin moverse ~0,9 s** | Volver a navegación (sin efecto en el sistema) | Activo |
| Índice + meñique | Mantén ~0,4 s | Alterna modo precisión (cursor más lento) | Activo |
| Barrido izquierda / derecha | Palma abierta, movimiento rápido | Atrás (Alt+←) / Adelante (Alt+→) | **Apagado** |
| Pulgar arriba / abajo | Puño con el pulgar extendido ~0,5 s | Intro / Escape | **Apagado** |
| Mano abajo / arriba | Mano abierta: bájala **muy rápido y de una vez** (o súbela) | Minimizar la ventana activa / traerla de vuelta | **Apagado** (desde el QA del 19-11) |
| Tres dedos | Índice, medio y anular extendidos; baja o sube la mano | Minimizar / restaurar ventana | **Apagado** |
| Pulgar y meñique (🤙) | Solo pulgar y meñique extendidos; **baja** la mano o **súbela** (cada tramo corto = una pestaña) | Pestaña siguiente (Ctrl+Tab) / anterior (Ctrl+Shift+Tab) | Activo |
| Pinza con el medio | Índice extendido; junta un instante pulgar y **medio** | Clic derecho | Activo |
| Apuntar con el índice | Índice extendido, los demás plegados | Trazo del teclado Air-Swipe | Solo con el teclado abierto |

> **Cursor (QA 19-11):** al armar, donde tienes la mano pasa a ser el centro de la pantalla. Con «Cursor con aceleración» (vista de cámara, activo) los movimientos lentos son finos y los rápidos llegan lejos. Anota si se siente lento, si cuesta llegar a las esquinas o si el cursor se separa de la mano.
>
> Los umbrales (tiempos, distancias) son **hipótesis sin calibrar**. Que algo cueste o sobre es un dato valioso: anótalo.

## 1. Cámara y observación (sin mover el cursor) — ~10 min

Modo Observar: el motor ve tus manos pero **no toca el ratón**.

| ID | Pasos | Esperado | Anota |
|---|---|---|---|
| M1.1 | En Inicio, **Activar cámara** | El LED se enciende; estado «Observando»; sin movimiento del cursor | Tiempo hasta «Observando»; mensajes de error |
| M1.2 | Muestra la mano | «Mano derecha/izquierda detectada» y puntos sobre la mano | ¿Detecta la correcta? ¿Parpadea? |
| M1.3 | Ve a **Calibrar** y abre «Datos técnicos» | FPS, latencia y 21/21 puntos visibles | **FPS y latencia** (ver 1.A) |
| M1.4 | **Primero abre la mano ~0,35 s** para armar el puntero (el motor lo arma también en Observar; sin armar, los demás gestos no se detectan; solo el puño y los pulgares funcionan sin armar). Después haz cada gesto de 0.5 (pinza, dos dedos, puño, pinza sostenida) | Cada uno marca **«Detectado ✓»** mientras lo haces | ¿Cuáles no? ¿Cuánto tardan? ¿Hay falsos «Detectado»? ¿Cuánto cuesta armar? |
| M1.5 | Cambia la **mano** (Derecha/Izquierda/Automática) y **Vista espejo** | La detección sigue tu mano; con espejo, mover la mano a la derecha mueve los puntos a la derecha | ¿Algo invertido? |
| M1.6 | Aleja la mano a ~1 m y acércala a ~30 cm | Detecta en un rango razonable | Distancias mínima y máxima donde detecta |

**1.A Medición de FPS y latencia.** Anótalos en cada situación (déjalos 10 s y toma el valor típico):

| Situación | FPS | Latencia (ms) |
|---|---|---|
| Luz buena, mano a ~60 cm | | |
| Luz tenue | | |
| Mano a ~1 m | | |

## 2. Puntero y Controlar — ~10 min

⚠️ Aquí empieza el control real del ratón. Ten el atajo **Ctrl+Alt+Z** presente y el ratón físico a mano.

| ID | Pasos | Esperado | Anota |
|---|---|---|---|
| M2.1 | Pulsa **Controlar** | Estado «Control activo»; la pista dice *«Mantén la mano abierta un momento para activar el puntero»* | Si se rechaza: el mensaje exacto (atajo no registrado, cámara…) |
| M2.2 | Abre la mano y mantenla ~0,35 s | El estado pasa a «Controlando el cursor» y el cursor te sigue | Tiempo real de armado; ¿se arma sin querer al mover la mano? |
| M2.3 | Recorre toda la pantalla con la mano | El cursor llega a las esquinas sin tener que forzar el brazo | Esquinas inalcanzables; sensación de velocidad |
| M2.4 | Sostén la mano **quieta** | El cursor no tiembla de forma molesta | Temblor; ¿ayuda subir «Suavizado»? |
| M2.5 | Quita la mano ~2 s y vuelve a ponerla | Tras ~1,5 s sin mano hay que volver a abrirla ~0,35 s para rearmar | ¿Se comporta así? |
| M2.6 | Prueba los 3 **modos** (Cocina y Taller, Desk-Rest, Asistencia Motriz) | Cambia la sensación (velocidad, suavizado, recorrido) | Cuál te resulta mejor y por qué |
| M2.7 | Con el cursor en movimiento, haz índice + meñique y mantenlo ~0,4 s | Mientras mantienes la postura el cursor **se queda quieto**; al completarse **alterna** el modo precisión y después el cursor va **más despacio**; repetirlo lo restaura | ¿Se activa sin querer? ¿Es útil? ¿Notas el cambio de velocidad? |

## 3. Clic, arrastre y desplazamiento — ~10 min

Usa el **Bloc de notas** y el **navegador**.

| ID | Pasos | Esperado | Anota |
|---|---|---|---|
| M3.1 | Clic con **pinza** sobre un botón/enlace inofensivo del navegador | Un clic por pinza; no repite | Clics fallidos / dobles por 20 intentos |
| M3.2 | Pinza sobre una zona vacía del Bloc de notas | Pone el cursor de texto; **el cursor no se desplaza al juntar los dedos** | ¿Se mueve el cursor al pinzar? |
| M3.3 | **Pinza sostenida** y mueve sobre un texto del Bloc de notas | Selecciona texto; al soltar la pinza termina | ¿Cuánto cuesta empezar? ¿Se suelta solo? |
| M3.4 | Arrastra la **ventana del Bloc de notas** por su barra de título | Se mueve y se suelta al abrir la pinza | Soltado accidental |
| M3.5 | **Dos dedos** sobre la página larga; sube y baja la mano | Desplaza en el sentido de tu mano (subes → la vista sube hacia el inicio) | Velocidad; ¿salta?; ¿se activa con otras posturas? |
| M3.6 | Mueve el cursor sin pinzar durante 1 min | **Ningún clic ni desplazamiento fantasma** | Falsos clics/scroll: cuántos y en qué postura |

## 4. Pausa, pérdida de mano y parada de emergencia — ~10 min (crítico)

| ID | Pasos | Esperado | Anota |
|---|---|---|---|
| M4.1 | Cierra el **puño** ~0,5 s con el control activo | «En pausa»; el cursor deja de moverse. Otro puño reanuda | ¿Se pausa sin querer al mover la mano? |
| M4.2 | Botón **Pausar / Reanudar** | Hace lo mismo | — |
| M4.3 | Empieza un **arrastre** (pinza sostenida sobre texto) y **retira la mano** de golpe | En unos fotogramas el botón se **suelta** solo; el texto queda seleccionado y no sigue arrastrando | ¿Queda el botón «pegado»? (haz clic físico para comprobar) |
| M4.4 | Empieza otro arrastre y pulsa **Ctrl+Alt+Z** | Se suelta al instante; estado «Parada de emergencia»; el cursor deja de seguirte | Tiempo de reacción; ¿quedó algo pulsado? |
| M4.5 | Tras la parada, pulsa **Controlar** | Reanuda el control. Si no, «Apagar cámara» y volver a activar | **Anota cuál de las dos cosas funcionó** (la interfaz sugiere apagar y encender) |
| M4.6 | Con el control activo, pulsa **Observar** | El cursor deja de moverse de inmediato | — |
| M4.7 | Tapa la cámara o aparta la mano ~5 s con el control activo | Sin mano no hay clics ni movimiento; al volver hay que rearmar | — |

## 5. Ajustes finos — ~5 min

En **Calibrar → Ajustes finos**: mueve **Velocidad del cursor**, **Suavizado**, **Recorrido de la mano**, **Facilidad del clic** y **Exigencia de detección**.

- [ ] Cada cambio se nota en pocos segundos y la línea de estado dice *«Guardado y aplicado al motor»*.
- [ ] «Facilidad del clic» alta hace la pinza más fácil (y más falsos clics); baja la hace estricta.
- [ ] «Exigencia de detección» alta reduce falsos gestos pero exige mejor luz.
- [ ] Anota los valores con los que **tú** trabajarías cómodo (sirven para ajustar los valores por defecto).

## 6. Gestos opcionales — ~15 min

Actívalos en **Calibrar → Prueba cada gesto** (interruptores) y **Qué hace cada gesto**. Están apagados por defecto porque son los menos probados.

| ID | Gesto | Pasos | Esperado | Anota |
|---|---|---|---|---|
| M6.1 | **Barrido izquierda** | Navega a 2–3 páginas en el navegador; palma abierta y barre rápido a la izquierda | Vuelve **Atrás** una vez (no repite) | Aciertos/20; falsos disparos al mover la mano normalmente |
| M6.2 | **Barrido derecha** | Barre a la derecha | Avanza una vez | Ídem |
| M6.3 | **Palma quieta** | Palma abierta sin mover ~1 s | Sin efecto en el sistema (evento interno) | ¿Se dispara al armar el puntero? |
| M6.4 | **Pulgar arriba / abajo** | Con el Bloc de notas enfocado: pulgar arriba ~0,5 s | **Intro** / **Escape** | Aciertos; confusión con el puño de la pausa (¡cuidado!) |
| M6.5 | **Tres dedos** (activa «Tres dedos» en la lista) | Con el **Bloc de notas** enfocado, baja la mano con tres dedos | **Minimiza** solo esa ventana; al subirla, **restaura** la última minimizada | ¿Minimizó la ventana correcta? ¿El foco volvió? |
| M6.5b | **Mano abajo / arriba** | Con el **Bloc de notas** enfocado, mano abierta y bájala rápido; espera quieta ~0,3 s y súbela rápido | **Minimiza** el Bloc de notas y luego lo **trae de vuelta** | Aciertos/20; ¿se minimizó algo al mover el cursor de arriba abajo con normalidad? |
| M6.5c | **Pulgar y meñique** | Abre 4–5 pestañas en el navegador; arma el puntero, haz 🤙 y baja la mano un palmo | Avanza **una pestaña por tramo** (~media palma); al subirla, retrocede. El cursor no se mueve mientras dura la postura | Aciertos/20; ¿se confunde con el puño o con índice + meñique (precisión)? ¿Pestañas de más? |
| M6.5d | **Pinza con el medio** | Sobre el escritorio o un archivo: índice extendido, toca pulgar con medio y separa rápido | Aparece el **menú contextual** donde apuntaba el cursor; sin clic izquierdo | Aciertos/20; ¿clics derechos falsos al apuntar con el índice o al escribir con Air-Swipe? |
| M6.6 | **Reasignar** | En «Qué hace cada gesto» cambia *Palma abierta* a «Reproducir o pausar multimedia» y prueba con un reproductor | Pausa/reproduce | ¿Llega la tecla multimedia? |
| M6.7 | Devuelve todo a los valores iniciales | Interruptores como en 0.5 | — | — |

## 7. Teclado Air-Swipe — ~25 min

⚠️ El texto se escribe **en la aplicación que tenga el foco**. Usa el **campo de práctica** de la página Teclado.

**Preparación:** cámara activa, **Controlar**, puntero armado. Ve a **Teclado** (en la cabecera). La lista de requisitos debe estar en ✓ (si alguno no lo está, dice qué falta).

| ID | Pasos | Esperado | Anota |
|---|---|---|---|
| M7.1 | **Abrir teclado** | Aparece abajo, centrado; **el foco no cambia** (lo que tenías enfocado sigue enfocado) | Posición; ¿tapa algo importante? |
| M7.2 | Con la **pinza**, haz clic en el campo de práctica | El cursor de texto aparece en el campo | — |
| M7.3 | Con la pinza, haz clic en una **tecla** del teclado (p. ej. «h») | Escribe «h» en el campo | **Prueba real del clic sobre una ventana no activable**: ¿funciona? |
| M7.4 | Botones **Borrar**, **Espacio**, **Intro** | Actúan en el campo | — |
| M7.5 | **Trazo**: apunta con el índice (los demás dedos plegados) ~0,2 s y recorre las letras de «hola»; luego abre la mano | Mientras trazas, ves tu recorrido en verde; al soltar aparecen hasta 5 **propuestas** | ¿Se activa el trazo? ¿Se corta antes de tiempo? |
| M7.6 | Toca la propuesta correcta con la **pinza** | Escribe la palabra **y un espacio** | — |
| M7.7 | Mide la precisión con el **Anexo B** (20 palabras) | Anota cuántas salen como 1.ª y cuántas entre las 5 | **Aciertos top-1 y top-5**, con condiciones |
| M7.8 | Prueba palabras que cruzan todo el teclado («zapato», «pie», «queso») | Salen igual de bien en los bordes | Si fallan en un lado: **posible desalineación del trazo** con las teclas |
| M7.9 | Activa «Pulgar arriba» (sección 6) y traza una palabra | Con **pulgar arriba** escribes la primera propuesta; con **pulgar abajo** la descartas | ¿Se confunden con el puño de la pausa? |
| M7.10 | **Puño** (pausa) y toca una propuesta | Mensaje «El control está en pausa»; **no** escribe nada; la propuesta se descarta | ¿Queda texto pendiente al reanudar? (no debería) |
| M7.11 | Aparta la mano y toca una propuesta | Mensaje de mano perdida; no escribe | — |
| M7.12 | Con una propuesta visible pulsa **Ctrl+Alt+Z** | El teclado muestra «no está activo» y un botón **Reactivar**; la propuesta desaparece | Al pulsar **Controlar** otra vez, ¿el teclado se reabre solo? |
| M7.13 | Pulsa **Observar** y traza | Aparecen propuestas pero **no** escribe: «Activa el modo Controlar» | — |
| M7.14 | Cierra con **✕** del teclado y con **Cerrar teclado** de la página | La ventana desaparece; vuelve a funcionar el clic normal | ¿Quedó algo de «modo teclado» (Atrás/Adelante/Intro dejan de funcionar)? |
| M7.15 | Con el teclado abierto, **apaga la cámara** | El teclado sigue ahí y dice *«Activa la cámara en ZeroTouch»*; no escribe nada | — |
| M7.16 | Vuelve a activar la cámara y pulsa **Reactivar** en el teclado (y **Controlar**) | El teclado vuelve a funcionar | ¿Hace falta cerrarlo y abrirlo de nuevo? |
| M7.17 | Con el teclado abierto, **cierra la ventana principal** de ZeroTouch | Se cierra **todo**: la aplicación, el teclado y el motor; el LED de la cámara se apaga | Comprobado automáticamente; confirma el LED y que no queda ningún `python` |

**Lo que más nos interesa de esta sección:** M7.3 (clic real sobre la ventana no activable), M7.7 (precisión real) y M7.8 (alineación). Son las tres cosas que ninguna prueba automática puede dar.

## 8. Casos de fallo y cierre — ~10 min

| ID | Pasos | Esperado | Anota |
|---|---|---|---|
| M8.1 | Abre el visor de cámara de Windows y luego pulsa **Activar cámara** | «Cámara no disponible» con consejo; sin bloqueo | Mensaje exacto |
| M8.2 | En Calibrar elige otra **cámara** (Segunda/Tercera) si tienes | Cambia o informa que no existe | — |
| M8.3 | Con el control activo, **desconecta** la cámara (o ciérrala desde otra app) | Pasa a observación; sin botones pegados | — |
| M8.4 | **Apagar cámara** | LED apagado; estado «Cámara apagada» | Tarda ~3 s como máximo |
| M8.5 | Cierra la aplicación y ejecuta `Get-Process python` | **Ningún** `python` del motor activo | Procesos que quedaron |
| M8.6 | Haz un **clic físico** y arrastra con el ratón físico | Funcionan con normalidad (nada pegado) | — |

## 9. Más de una pantalla o escala distinta (opcional)

El motor recorre **todo el escritorio virtual**: con varias pantallas la mano recorre más píxeles.

- [ ] Con 2 monitores: ¿el cursor llega a los dos? ¿Conviene bajar la velocidad?
- [ ] Abre el teclado con una pantalla secundaria: ¿aparece en la principal, abajo y centrado?
- [ ] Repite M7.7–M7.8 en cada escala (100 %, 125 %, 150 %…): anota la escala y si la alineación del trazo cambia.

## 10. Cuenta y sincronización (opcional)

Ya está verificada automáticamente; esta sección solo comprueba que **tú** la ves bien: crear cuenta o iniciar sesión → «Sincronizar» → borrar un modo → «Sincronizar» → *«N borrados en tu cuenta»*. Si borras algo y lo cambias desde otro equipo, debe aparecer el conflicto con «Recuperarlo» o «Borrarlo de todos modos». **No lo hagas contra una base con datos que quieras conservar.**

## Qué no probar (no hay interfaz todavía)

- **Asistencia por mirada** y su calibración: el motor la implementa, pero ningún control de la interfaz la activa.
- **Temporizador** y otras acciones de aplicación (evento `TIMER`): el motor las emite; la interfaz aún no las muestra.
- **Cargar una exportación** del backend en el motor (`engine_load_export`): expuesto, sin control en la interfaz.

## Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| **Controlar** se rechaza | El atajo Ctrl+Alt+Z no quedó registrado (otra app lo usa) o no hay cámara abierta | Lee el mensaje; cierra la app que usa el atajo; reinicia la cámara |
| «Cámara no disponible» | Otra app la usa o el índice no existe | Ciérrala; prueba otra cámara en Calibrar |
| El cursor se mueve al revés | Vista espejo | Activa/desactiva «Vista espejo» |
| El puntero no se arma | Mano poco visible o confianza baja | Mejora la luz; baja «Exigencia de detección» |
| Clics fantasma | «Facilidad del clic» muy alta | Bájala; anota la postura que los provoca |
| El teclado se apaga solo a los segundos | Su ventana dejó de latir | Anótalo con el momento exacto: es un fallo a reportar |

## Anexo A — Registro de resultados

Copia esta tabla a un archivo tuyo y rellénala (✔ bien · ✖ mal · ◐ parcial · — no probado).

| ID | Resultado | Notas (condiciones, números, qué falló) |
|---|---|---|
| M1.1–M1.6 | | |
| M2.1–M2.7 | | |
| M3.1–M3.6 | | |
| M4.1–M4.7 | | |
| M5 | | |
| M6.1–M6.7 | | |
| M7.1–M7.17 | | |
| M8.1–M8.6 | | |
| M9 | | |

Datos del equipo: modelo de cámara, resolución, escala de pantalla, número de monitores, mano usada, luz.

## Anexo B — Precisión de Air-Swipe (20 palabras)

Traza cada palabra **una vez**, sin repetir. Marca dónde aparece la correcta entre las propuestas (1–5, o «no»). Cuenta al final.

| # | Palabra | Posición (1–5 / no) | | # | Palabra | Posición (1–5 / no) |
|---|---|---|---|---|---|---|
| 1 | hola | | | 11 | mañana | |
| 2 | gracias | | | 12 | receta | |
| 3 | casa | | | 13 | tiempo | |
| 4 | pausa | | | 14 | pie | |
| 5 | zapato | | | 15 | queso | |
| 6 | buenos | | | 16 | temporizador | |
| 7 | días | | | 17 | pastel | |
| 8 | agua | | | 18 | también | |
| 9 | niño | | | 19 | cocina | |
| 10 | teclado | | | 20 | trabajo | |

- **Top-1:** palabras en la posición 1 / 20 = ____
- **Top-5:** palabras en las posiciones 1–5 / 20 = ____
- Segundos medios desde que sueltas el trazo hasta ver las propuestas: ____
- Condiciones: luz ____ · distancia ____ · mano ____ · escala de pantalla ____

> Los acentos salen del léxico aunque el trazo pase por la tecla base. Una cifra de 20 palabras es un indicio, no una medida estadística: repite con otras 20 si quieres más confianza.

## Anexo C — Qué pegarme al terminar

```text
Equipo: (cámara, resolución, pantalla/escala, monitores)
Condiciones: (luz, distancia, mano)

FPS / latencia: (tabla 1.A)
Air-Swipe: top-1 = _/20, top-5 = _/20, latencia = _ s
Resultados: (tabla del Anexo A, o solo lo que falló)

Fallos (uno por línea): ID · qué hiciste · qué pasó · qué esperabas
Observaciones de sensación: (puntero, suavizado, gestos que cuestan o sobran)
Valores de ajustes con los que trabajarías cómodo: (sección 5)
```

Con eso actualizo `PROGRESO.md` con **cifras medidas** (y solo esas), corrijo los umbrales que haga falta y abro los defectos que hayas encontrado.
