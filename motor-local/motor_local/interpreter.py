"""Layer 3: Gesture Interpretation Module.

Máquina de estados que convierte 21 landmarks + EngineConfig en eventos lógicos:
MOVE_CURSOR, LEFT_CLICK, SCROLL, START_DRAG, END_DRAG, PAUSE, RESUME, TRACKING_LOST, acciones
discretas (BACK, FORWARD, CONFIRM, CANCEL, MEDIA_*, TIMER, PRECISION, NAVIGATION), ventanas y
AIRSWIPE_TRACE.

Estados mutuamente excluyentes por fotograma (prioridad):
  puño (pausa) / pulgares -> arrastre activo -> precisión (postura) -> tres dedos -> dos dedos
  (scroll) -> trazo Air-Swipe (apuntar) -> palma (barrido / sostenida) -> pinza -> puntero.

Activación del puntero: con `pointer_enabled`, el cursor y los demás gestos (salvo puño y pulgares)
solo actúan después de sostener la mano abierta POINTER_ARM_MS («mano abierta sostenida ->
activar puntero»). El puntero se desarma al perder la mano POINTER_DISARM_MS o al pausar.

Todas las temporizaciones se miden en milisegundos reales, no solo en fotogramas:
- La pinza exige N muestras consecutivas Y un tiempo mínimo de confirmación.
- El scroll exige postura confirmada y movimiento por encima de una zona muerta; la velocidad
  se limita por tiempo transcurrido, de modo que cadencias distintas dan desplazamientos
  parecidos.
- Los gestos discretos (pulgares, precisión, palma sostenida, barridos) disparan UNA vez por
  postura, exigen soltarla (rearme) y respetan un cooldown.

Los valores son hipótesis iniciales, no calibración medida.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .capabilities import NO_ACTION
from .config import PRECISION_GAIN_FACTOR, EngineConfig
from .detector import HandLandmarks, Point3D

# Logical Event Types
EVENT_MOVE_CURSOR = "MOVE_CURSOR"
EVENT_LEFT_CLICK = "LEFT_CLICK"
EVENT_SCROLL = "SCROLL"
EVENT_START_DRAG = "START_DRAG"
EVENT_END_DRAG = "END_DRAG"
EVENT_PAUSE = "PAUSE"
EVENT_RESUME = "RESUME"
EVENT_THUMBS_UP = "THUMBS_UP"          # telemetría/compatibilidad: la acción viaja como evento discreto
EVENT_THUMBS_DOWN = "THUMBS_DOWN"
EVENT_TRACKING_LOST = "TRACKING_LOST"
EVENT_BACK = "BACK"                    # atras (Alt+Izquierda)
EVENT_FORWARD = "FORWARD"              # adelante (Alt+Derecha)
EVENT_CONFIRM = "CONFIRM"              # confirmar (Intro)
EVENT_CANCEL = "CANCEL"                # cancelar (Escape)
EVENT_MEDIA_PLAY_PAUSE = "MEDIA_PLAY_PAUSE"
EVENT_MEDIA_NEXT = "MEDIA_NEXT"
EVENT_TIMER = "TIMER"                  # temporizador_iniciar: evento para la interfaz
EVENT_PRECISION = "PRECISION"          # precision: alterna el modo precisión (evento para la interfaz)
EVENT_NAVIGATION = "NAVIGATION"        # navegacion: vuelve al puntero normal (evento para la interfaz)
EVENT_MINIMIZE_WINDOW = "MINIMIZE_WINDOW"  # tres dedos hacia abajo: ventana activa
EVENT_RESTORE_WINDOW = "RESTORE_WINDOW"    # tres dedos hacia arriba: última ventana minimizada por el motor
EVENT_AIRSWIPE_TRACE = "AIRSWIPE_TRACE"    # trazo terminado sobre el teclado Air-Swipe (puntos normalizados)
EVENT_NEXT_TAB = "NEXT_TAB"            # abanico con la mano ladeada: pestaña siguiente (Ctrl+Tab)
EVENT_PREV_TAB = "PREV_TAB"            # pestaña anterior (Ctrl+Shift+Tab): sin gesto desde el 21-11-2026 (se conserva la tecla)
EVENT_RIGHT_CLICK = "RIGHT_CLICK"      # pinza pulgar-medio: clic derecho en la posición del puntero
EVENT_KEYBOARD_CLOSE = "KEYBOARD_CLOSE"  # golpe de muñeca hacia abajo con el teclado abierto: bajarlo (interfaz; 23-11-2026)
EVENT_KEYBOARD = "KEYBOARD"            # ☝️ sostenido y quieto: abrir el teclado Air-Swipe (lo hace la interfaz; 23-11-2026)
EVENT_ALT_TAB = "ALT_TAB"              # doblar índice, medio y anular rápido con el meñique arriba: Alt+Tab (23-11-2026)
EVENT_ALT_SWITCHER = "ALT_TAB_HOLD"    # los mismos tres dedos MANTENIDOS abajo: selector de ventanas (fase abrir/siguiente/soltar)
EVENT_DICTATION = "DICTATION"          # 🤙 sostenido: dictado de Windows (Win+H), gesto local del equipo (23-11-2026)

# Acción del catálogo -> tipo de evento lógico.
ACTION_EVENTS: dict[str, str] = {
    "atras": EVENT_BACK,
    "adelante": EVENT_FORWARD,
    "confirmar": EVENT_CONFIRM,
    "cancelar": EVENT_CANCEL,
    "multimedia_play_pause": EVENT_MEDIA_PLAY_PAUSE,
    "multimedia_siguiente": EVENT_MEDIA_NEXT,
    "temporizador_iniciar": EVENT_TIMER,
    "precision": EVENT_PRECISION,
    "navegacion": EVENT_NAVIGATION,
}

# --- Hipótesis iniciales (no medidas) ---
# Con cámaras de ~15 FPS, 3 muestras eran ~200 ms: una pinza rápida (un «toque») nunca se confirmaba.
PINCH_CONFIRM_FRAMES = 2       # muestras consecutivas dentro del umbral para confirmar una pinza
PINCH_CONFIRM_MS = 45.0        # y tiempo mínimo desde la primera muestra
PINCH_DEPTH_WEIGHT = 0.6       # peso de la profundidad (z de MediaPipe) en la distancia de la pinza
PINCH_RELEASE_FRAMES = 2       # muestras consecutivas fuera del umbral para soltar la pinza
# 23-11-2026 (en vivo: la sacudida lateral arrastraba la ventana hasta el borde derecho y Windows la acoplaba): con la
# mano desplazándose rápido no EMPIEZA una pinza. Un clic real se hace con la mano casi quieta (medido en los videos de
# clic); el pulgar junto al índice de una mano abierta en movimiento se leía como pinza sostenida -> arrastre. No afecta
# a una pinza ya confirmada (el arrastre necesita mover la mano).
PINCH_START_MAX_HAND_SPEED = 2.5   # palmas por segundo (centro de la palma); clics reales: 0,03-0,58
PINCH_CANDIDATE_MAX_MS = 600.0  # una pinza candidata que no se confirma en este tiempo caduca
SCROLL_DROPOUT_FRAMES = 2       # fotogramas seguidos sin postura de dos dedos que se toleran sin soltar el desplazamiento
SCROLL_CONFIRM_FRAMES = 3      # muestras consecutivas de postura de dos dedos
SCROLL_CONFIRM_MS = 60.0
SCROLL_DEADZONE_PALM = 0.06    # zona muerta vertical, en longitudes de palma
SCROLL_AXIS_DOMINANCE = 1.5    # movimiento vertical debe dominar al horizontal en este factor
SCROLL_UNITS_PER_PALM = 8.0    # unidades de rueda por longitud de palma (antes de sensibilidad)
SCROLL_MAX_NOTCHES_PER_SEC = 20.0  # límite de velocidad en muescas de rueda por segundo
# Tres dedos (ventanas): postura confirmada, desplazamiento vertical, una acción por gesto.
WINDOW_CONFIRM_FRAMES = 3
WINDOW_CONFIRM_MS = 60.0
WINDOW_MIN_PALM = 0.6          # desplazamiento vertical mínimo, en longitudes de palma
WINDOW_GESTURE_WINDOW_MS = 1000.0  # ventana temporal del desplazamiento; si vence, se vuelve a anclar
WINDOW_COOLDOWN_MS = 800.0
WINDOW_REARM_MS = 200.0        # postura ausente este tiempo para rearmar
# Barrido horizontal con palma abierta: predominio horizontal, recorrido y velocidad mínimos.
SWIPE_WINDOW_MS = 450.0
SWIPE_MIN_PALM = 1.2           # recorrido horizontal mínimo, en longitudes de palma
SWIPE_DOMINANCE = 2.0          # |dx| debe superar |dy| en este factor
SWIPE_MIN_SPEED = 2.0          # longitudes de palma por segundo
SWIPE_REVERSAL_PALM = 0.25     # si la mano vuelve este recorrido hacia atrás, el barrido se reinicia
SWIPE_COOLDOWN_MS = 600.0
SWIPE_STILL_PALM = 0.03        # movimiento por muestra por debajo del cual la mano cuenta como quieta
SWIPE_REARM_MS = 200.0
# Barrido vertical con la mano abierta («bajar» y «subir» la ventana). Más exigente que el horizontal:
# mover el cursor de arriba abajo también es un movimiento vertical de la mano abierta, así que solo
# cuenta un movimiento claramente rápido y largo.
VSWIPE_WINDOW_MS = 500.0
VSWIPE_MIN_PALM = 2.0          # recorrido vertical mínimo, en longitudes de palma (QA: 1,3 se disparaba al mover el cursor)
VSWIPE_DOMINANCE = 1.8         # |dy| debe superar |dx| en este factor
VSWIPE_MIN_SPEED = 5.0         # longitudes de palma por segundo
# Puño (pausa): puntas a menos de esta fracción de la palma de su articulación MCP, confirmado en el
# tiempo y con la mano quieta. Hipótesis sin calibrar con cámara real.
FIST_TIP_RATIO = 0.52
FIST_CONFIRM_FRAMES = 6
FIST_CONFIRM_MS = 250.0
FIST_MISS_TOLERANCE = 2        # muestras sueltas sin puño que no reinician la confirmación
FIST_STILL_PALM = 0.15         # QA 19-11: con 0,05 el ruido de la cámara (mano a 70-90 cm) reiniciaba el puño
PINCH_INDEX_SEPARATION = 0.45  # puntas de índice y medio separadas (palmas). Videos: clic 0,52-0,87; scroll 0,13-0,61
PINCH_INDEX_MAX_ANGLE = 145.0  # índice doblado en su articulación media (grados). Videos: clic 51-132; scroll 152-173
FIST_PINCH_GUARD_MS = 400.0    # tras ver un puño, la pinza no entra durante este tiempo (abrir el puño no es un clic)
# Activación del puntero: mano abierta sostenida.
POINTER_ARM_MS = 350.0
POINTER_DISARM_MS = 8000.0     # mano perdida este tiempo -> hay que volver a abrir la mano
# QA 19-11: con 3 s, bajar la mano a descansar un momento obligaba a re-armar el puntero cada vez.
DROPOUT_GRACE_FRAMES = 2       # cuadros sin mano que se toleran sin reiniciar gestos en curso
DROPOUT_GRACE_MS = 150.0       # MediaPipe pierde la mano en cuadros sueltos (sobre todo al cerrar el puño)
ACTIVE_EDGE = 0.03             # el área activa recentrada no se acerca más que esto al borde de la imagen
# Aceleración del puntero, como la de un mouse (QA 19-11, 2ª iteración). La velocidad se mide en pantallas por segundo
# del mapeo absoluto. Lento: ×ACCEL_GAIN_SLOW (precisión, menos temblor); normal: ×ACCEL_GAIN_MID; rápido:
# ×ACCEL_GAIN_FAST. Con el banco QA, cruzar la pantalla pasa de ~0,39 a ~0,19 del ancho de la imagen (~13 cm de mano
# a 50 cm). La 1ª versión (×0,3 y nunca >1) dejaba el cursor pegajoso y sin llegar a las esquinas. El cursor se
# detiene en los bordes, como un mouse: al volver queda corrido respecto de la mano y se recoloca moviéndola.
ACCEL_SPEED_SLOW = 0.05
ACCEL_SPEED_MID = 0.30
ACCEL_SPEED_FAST = 1.00
ACCEL_GAIN_SLOW = 0.6
ACCEL_GAIN_MID = 1.2
ACCEL_GAIN_FAST = 2.5
SETTLE_MS = 200.0              # mano dentro del radio de asentamiento este tiempo -> cursor quieto
CLICK_REWIND_MS = 90.0         # el clic cae donde estaba el cursor justo antes de que los dedos empezaran a juntarse
# Gestos discretos sostenidos: tiempo de confirmación, cooldown y rearme.
THUMB_HOLD_MS = 500.0
THUMB_COOLDOWN_MS = 800.0
# 23-11-2026 (videos nuevos de la persona usuaria, mano izquierda): su pulgar arriba es un puño de lado, más suelto
# que la regla estricta (puño cerrado, pulgar > 0,72 palmas). Regla suelta solo para el pulgar ARRIBA: ningún dedo
# extendido, pulgar fuera > 0,5 y por encima de su nudillo > 0,44 palmas. Medido: confirmar 0,50-0,69 y 0,44-0,63;
# el puño de pausa nunca sube el pulgar más de 0,43 (video nuevo) y en el viejo solo 1 fotograma suelto lo cumple.
THUMB_UP_LOOSE_OUT = 0.5
THUMB_UP_LOOSE_DY = 0.44
# Dictado (23-11-2026, pedido para la demo): 🤙 = pulgar y meñique extendidos, índice, medio y anular plegados,
# sostenido como el pulgar arriba. Win+H abre y cierra el dictado de Windows: el enfriamiento largo evita que una
# postura dudosa lo abra y lo cierre seguido.
CALL_HOLD_MS = 500.0
# Abrir el teclado Air-Swipe (23-11-2026): ☝️ (solo el índice extendido), sostenido y con la mano casi quieta. Es la
# postura del trazo, así que con el teclado abierto no cuenta. Al apuntar mientras se mueve el cursor la mano no
# está quieta y el tiempo vuelve a empezar; el evento va a la interfaz, nunca al sistema operativo.
KEYBOARD_HOLD_MS = 1000.0
KEYBOARD_COOLDOWN_MS = 2000.0
KEYBOARD_STILL_PALM = 0.2      # recorrido máximo de la palma (palmas) durante la espera
CALL_COOLDOWN_MS = 1500.0
CALL_THUMB_OUT = 0.6           # punta del pulgar lejos del nudillo del índice (palmas); con el pulgar recogido queda más cerca
PRECISION_HOLD_MS = 400.0
PRECISION_COOLDOWN_MS = 800.0
PALM_HOLD_MS = 900.0           # palma abierta quieta este tiempo -> acción discreta (navegacion)
PALM_COOLDOWN_MS = 1200.0
PALM_STILL_PALM = 0.08         # recorrido máximo (en palmas) para contar como "sostenida"
DISCRETE_REARM_MS = 250.0
HOLD_GAP_RESET_MS = 150.0      # sin evaluar la postura este tiempo, la confirmación empieza de cero
# Trazo Air-Swipe: índice extendido (apuntar) sobre el teclado virtual.
TRACE_CONFIRM_FRAMES = 3
TRACE_END_FRAMES = 4           # fotogramas sin apuntar para cerrar el trazo
TRACE_MIN_POINTS = 4
TRACE_MIN_LENGTH = 0.02        # recorrido mínimo en pantalla normalizada
TRACE_MAX_POINTS = 600

# Pestaña siguiente (gesto local del equipo, 21-11-2026, medido en videos reales): «abanico». Mano abierta y LADEADA
# (palmo muñeca->nudillo del medio a menos de TAB_FAN_TILT grados; vertical = 90), casi quieta, y los dedos giran
# rápido hacia el lado del pulgar. Una pestaña por abanico; el regreso (giro contrario) no cuenta. Videos: palmo
# 45-71° en el abanico y 91-107° en los demás gestos; giro de ida -520 a -1835 °/s.
TAB_FAN_TILT = 80.0            # grados; mano derecha (la izquierda, en espejo: más de 180 - TAB_FAN_TILT)
TAB_FAN_MIN_SPEED = 300.0      # giro de los dedos (nudillo -> punta del medio), grados por segundo. 23-11-2026: con
                               # 500 solo pasaba un abanico «golpeado muy fuerte» (informe en vivo: 39 posturas, 16
                               # pestañas). Videos: abanicos 250-670 °/s en su fotograma más rápido; el mayor giro
                               # sin abanico con la mano ladeada, 214 °/s (mover cursor). Con 250 tampoco hay falsos.
TAB_FAN_MIN_SPAN_MS = 60.0     # el giro se mide contra la muestra de hace al menos esto: a 15 fps es el fotograma
                               # anterior (igual que antes); a 30-37 fps evita que el temblor de los puntos entre
                               # fotogramas muy juntos cuente como giro rápido.
TAB_FAN_MAX_HAND_SPEED = 2.0   # el centro de la mano casi no se desplaza: tamaños de mano por segundo. 22-11-2026: con 3,0 un barrido lateral (>= SWIPE_MIN_SPEED) con la mano ladeada pasaba por abanico y robaba el atrás/adelante; los videos reales de abanico siguen dando 3/3 hasta 2,0
TAB_FAN_REARM_SPEED = 250.0    # el giro debe calmarse por debajo de esto antes del siguiente abanico. Defensa
                               # redundante: dentro del giro posible de los dedos (~100°) un giro rápido no dura más
                               # que TAB_FAN_COOLDOWN_MS ni a 15 ni a 30 fps, así que hoy lo decide el enfriamiento.
TAB_FAN_COOLDOWN_MS = 350.0
# Pestaña anterior (23-11-2026, video «devolver pestaña»): el abanico hacia el lado contrario (hacia el meñique),
# empezando desde la mano calmada. La vuelta de un abanico normal no cuenta: ese giro llega con el abanico
# desarmado (lo desarma el propio abanico) y al revés. En el video la mano se desplaza más que en el abanico normal.
TAB_PREV_MAX_HAND_SPEED = 2.0
TAB_PREV_MIN_SPEED = 900.0      # más que el abanico: antes de abanicar, la mano toma impulso hacia el otro lado
                               # (en los videos viejos de «pasar pestaña» ese impulso daba «devolver» con 300-600)
TAB_FAN_REARM_MS = 60.0        # el giro debe seguir calmado al menos esto: en el extremo de un giro contrario los
                               # dedos se frenan un instante y, con TAB_FAN_MIN_SPEED = 300, su vuelta pasaba por abanico.
# Golpe de muñeca para ventanas (21-11-2026, videos reales; con el interruptor windowSwipe). Las CUATRO puntas se
# mueven a la vez respecto de sus nudillos (el scroll solo mueve índice y medio) y vuelven enseguida: bajar y volver
# = minimizar; subir y volver = restaurar. Abrir la mano y sostenerla (mostrar escritorio) no vuelve a tiempo, y
# abrir un puño queda cubierto por FIST_PINCH_GUARD_MS. Velocidades en tamaños de mano por segundo.
FLICK_MIN_SPEED = 4.0          # cada una de las 4 puntas, respecto de su nudillo (barrido 4-6 con los videos)
FLICK_RETURN_MS = 500.0        # la vuelta debe llegar antes de esto
FLICK_MAX_HAND_SPEED = 4.0     # el centro de la mano casi quieto (no es un barrido del brazo)
FLICK_COOLDOWN_MS = 600.0
FLICK_OPPOSITE_MS = 1500.0     # tras minimizar no se restaura (ni al revés) antes de esto: el rebote no es otro golpe
FLICK_MAX_GAP_MS = 200.0
# 22-11-2026 (informe en vivo): el abanico dobla la muñeca y sus puntas se mueven igual que en el golpe de muñeca,
# así que un abanico también minimizaba o restauraba. Con los gestos de pestaña activos, el golpe no cuenta durante
# este tiempo después de un abanico que pasó de pestaña (su vuelta llega antes de FLICK_RETURN_MS). 23-11-2026: una
# primera versión bloqueaba el golpe con la mano solo ladeada y dejó de bajar ventanas; no se hace.
FLICK_AFTER_FAN_MS = FLICK_RETURN_MS
# Traer la ventana de vuelta «levantando la mano» (23-11-2026, video «regresar ventana»): la mano queda colgando (palmo
# muñeca->nudillo del medio apuntando hacia abajo) y después sube abierta y vertical. Medido: colgando -28 a -58° durante
# 10 fotogramas, luego vertical. Mientras dura (y un poco después) el golpe de muñeca no cuenta: cerrar la mano al
# bajarla lo imitaba y minimizaba (3 veces en el video).
HANG_PALM_DIR = -20.0          # grados: palmo por debajo de esto = mano colgando
HANG_MIN_MS = 150.0            # colgando al menos esto
RAISE_PALM_DIR = 60.0          # y después vertical (palmo por encima de esto) con la mano abierta
RAISE_WINDOW_MS = 1200.0       # antes de esto desde que dejó de colgar
HANG_FLICK_GUARD_MS = 700.0    # golpe de muñeca ignorado hasta esto después de colgar
# Alt+Tab (23-11-2026, video «alt tab»): desde la mano abierta, índice, medio y anular bajan rápido (cada uno >
# FLICK_MIN_SPEED respecto de su nudillo) con el meñique casi quieto, y vuelven a subir antes de ALT_TAB_RETURN_MS.
# Medido: alt tab vuelve en 237-339 ms; la llamada del dictado (misma bajada) se sostiene 675-911 ms; el caso más
# cercano en otros videos, 465 ms.
ALT_TAB_RETURN_MS = 400.0
ALT_TAB_PINKY_RATIO = 0.5      # el meñique se mueve menos que la mitad que el más lento de los tres
ALT_TAB_COOLDOWN_MS = 600.0
# Selector de ventanas (23-11-2026, pedido): bajar los tres dedos y MANTENERLOS abajo deja Alt pulsado y pulsa Tab, así
# Windows muestra todas las ventanas; cada ALT_HOLD_STEP_MS sostenidos pasa a la siguiente; al subir los dedos se suelta
# Alt y se cambia a la elegida. Bajar y subir rápido sigue siendo el Alt+Tab directo (vuelve en 271-373 ms en el video).
# El dictado (llamada) tiene la misma bajada pero con el pulgar FUERA: medido en los videos, pulgar respecto del nudillo
# del índice 0,35-0,51 palmas (media por postura) en «alt tab» y 0,52-0,73 en «activar transcriptor». Con el dictado
# activo, el selector exige el pulgar recogido (media < ALT_HOLD_THUMB_MAX). Ningún otro video tiene esa postura >= 150 ms.
ALT_HOLD_MS = 500.0            # postura sostenida desde la bajada: por encima de la vuelta rápida (ALT_TAB_RETURN_MS)
ALT_HOLD_STEP_MS = 1000.0      # mantenido: una ventana más cada esto
ALT_HOLD_RELEASE_MS = 150.0    # la postura debe faltar esto para soltar (un fotograma dudoso no cambia de ventana)
ALT_HOLD_THUMB_MAX = 0.5
ALT_HOLD_POSE_MS = 300.0       # y la postura continua al menos esto (sin huecos)
# Desplazar con la mano abierta (23-11-2026, experimental, interruptor openHandScroll APAGADO por defecto). En los
# videos nuevos la persona desplaza con la palma abierta: la deja quieta (~0,7 s) y luego sube o baja toda la mano.
# Subir/bajar la mano abierta es también mover el cursor, así que se usa esa quietud previa: mano abierta quieta
# OPEN_SCROLL_GRAB_MS «agarra» la página; desde ahí el movimiento vertical desplaza (como dos dedos) y el cursor no
# se mueve, hasta cambiar de postura. Coste: tras dejar la mano abierta quieta, moverla desplaza en vez de mover.
OPEN_SCROLL_GRAB_MS = 350.0     # video: la mano queda quieta ~0,4-0,5 s antes de moverse
OPEN_SCROLL_STILL_PALM = 0.15
OPEN_SCROLL_DROPOUT_MS = 300.0  # la mano flexiona un instante los dedos sin dejar de «agarrar»
TAB_FAN_MAX_GAP_MS = 200.0     # dos muestras más separadas que esto no se comparan (mano perdida)
# Sacudida lateral para pestañas (23-11-2026, pedido: «mover la mano de lado a lado»): con la mano abierta, ir rápido
# hacia un lado y VOLVER enseguida. Hacia la derecha = pestaña siguiente; hacia la izquierda = anterior. La vuelta es
# lo que la separa de mover el cursor (un movimiento del cursor no regresa así) y del barrido atrás/adelante (que se
# reinicia si la mano vuelve). Umbrales sin medir con videos de este gesto: hipótesis a validar en vivo.
WAVE_WINDOW_MS = 800.0         # ida y vuelta completas dentro de esto
WAVE_OUT_MAX_MS = 450.0        # la ida dura como mucho esto
WAVE_MIN_PALM = 0.8            # recorrido de ida, en longitudes de palma
WAVE_MIN_SPEED = 3.0           # velocidad media de la ida, palmas por segundo
WAVE_RETURN_FRAC = 0.6         # la vuelta recorre al menos esta fracción de la ida
WAVE_MAX_VERTICAL = 0.6        # desvío vertical máximo respecto de la ida (fracción)
WAVE_COOLDOWN_MS = 600.0
WAVE_REARM_MS = 250.0          # tras un cambio, la mano quieta (o cerrada) esto antes del siguiente: sacudir varias
                               # veces seguidas (ida, vuelta, ida...) no alterna siguiente/anterior
WAVE_STILL_SPEED = 0.8         # palmas por segundo: por debajo, la mano cuenta como quieta

# Clic derecho (gesto local del equipo): punta del pulgar con punta del medio, índice extendido.
RIGHT_PINCH_CONFIRM_FRAMES = 2
RIGHT_PINCH_CONFIRM_MS = 45.0
RIGHT_PINCH_RELEASE_FRAMES = 2
RIGHT_PINCH_MAX_MS = 700.0     # una pinza más larga se descarta sin clic (no es un «toque»)
RIGHT_PINCH_MIDDLE_REACH = 1.1  # (ya no se usa en la regla; se conserva por compatibilidad de importaciones)
RIGHT_PINCH_ENTER_RATIO = 0.15  # pulgar-medio para entrar (palmas). Videos: toques 0,07-0,14; reposo 0,16-0,42
RIGHT_PINCH_EXIT_RATIO = 0.24   # pulgar-medio para soltar: la mano relajada vuelve por encima de esto


@dataclass(frozen=True)
class LogicalEvent:
    """Logical event produced by the gesture interpreter."""

    type: str
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class InterpreterTelemetry:
    """Live snapshot of gesture state and landmarks for UI & diagnostic overlay."""

    hand_detected: bool = False
    handedness: str = ""
    confidence: float = 0.0
    gesture: str = "NONE"  # POINTER, PINCH, DRAG, SCROLL, PAUSE, FIST_HOLD, THUMBS_UP, THUMBS_DOWN, ARMING, ...
    paused: bool = False
    pointer_armed: bool = False
    precision: bool = False
    tracing: bool = False
    pinch_distance_px: int = 0
    pinch_ratio: float = 1.0
    cursor_norm_x: float = 0.5
    cursor_norm_y: float = 0.5
    raw_anchor_x: float = 0.5
    raw_anchor_y: float = 0.5
    landmarks_2d: list[list[float]] = field(default_factory=list)


class OneEuroFilter1D:
    """Velocity-adaptive low-pass filter (Casiez et al., CHI 2012) for jitter-free cursor control."""

    def __init__(self, min_cutoff: float = 1.2, beta: float = 0.03, d_cutoff: float = 1.0) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self._x_prev: float | None = None
        self._dx_prev: float = 0.0
        self._t_prev: float | None = None

    @staticmethod
    def _alpha(dt: float, cutoff_hz: float) -> float:
        tau = 1.0 / (2.0 * math.pi * max(0.05, cutoff_hz))
        return 1.0 / (1.0 + tau / max(1e-4, dt))

    def reset(self) -> None:
        self._x_prev = None
        self._dx_prev = 0.0
        self._t_prev = None

    def filter(self, x: float, t_sec: float, min_cutoff: float | None = None, beta: float | None = None) -> float:
        if min_cutoff is not None:
            self.min_cutoff = min_cutoff
        if beta is not None:
            self.beta = beta

        if self._x_prev is None or self._t_prev is None:
            self._x_prev = x
            self._t_prev = t_sec
            return x

        dt = t_sec - self._t_prev
        if dt <= 1e-5:
            dt = 1.0 / 60.0
        elif dt > 0.5:
            # Reset after long gap so cursor snaps cleanly to new position
            self._x_prev = x
            self._dx_prev = 0.0
            self._t_prev = t_sec
            return x

        self._t_prev = t_sec
        dx = (x - self._x_prev) / dt
        a_d = self._alpha(dt, self.d_cutoff)
        dx_hat = a_d * dx + (1.0 - a_d) * self._dx_prev
        self._dx_prev = dx_hat

        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a_x = self._alpha(dt, cutoff)
        x_hat = a_x * x + (1.0 - a_x) * self._x_prev
        self._x_prev = x_hat
        return x_hat


def pointer_gain(speed: float) -> float:
    """Ganancia de la aceleración según la velocidad (pantallas/s): curva suave y monótona."""
    def smooth(a: float, b: float, v: float) -> float:
        t = max(0.0, min(1.0, (v - a) / (b - a)))
        return t * t * (3.0 - 2.0 * t)
    if speed <= ACCEL_SPEED_MID:
        return ACCEL_GAIN_SLOW + (ACCEL_GAIN_MID - ACCEL_GAIN_SLOW) * smooth(ACCEL_SPEED_SLOW, ACCEL_SPEED_MID, speed)
    return ACCEL_GAIN_MID + (ACCEL_GAIN_FAST - ACCEL_GAIN_MID) * smooth(ACCEL_SPEED_MID, ACCEL_SPEED_FAST, speed)


def _dist2d(a: Point3D, b: Point3D) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def _pinch_distance(a: Point3D, b: Point3D) -> float:
    """Distancia pulgar-índice con algo de profundidad: con la palma de frente a la cámara las dos
    puntas pueden solaparse en 2D aunque estén separadas en profundidad (falsos clics)."""
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (PINCH_DEPTH_WEIGHT * (a.z - b.z)) ** 2)


def _palm_scale(lms: list[Point3D]) -> float:
    """Computes apparent hand size in normalized coordinates using wrist(0)->middle_mcp(9) and index_mcp(5)->pinky_mcp(17)."""
    d_length = _dist2d(lms[0], lms[9])
    d_width = _dist2d(lms[5], lms[17])
    return max(0.055, max(d_length, d_width * 1.15))


def _is_finger_extended(lms: list[Point3D], tip_idx: int, pip_idx: int, mcp_idx: int) -> bool:
    """Checks if a finger is extended using wrist distance and joint collinearity."""
    wrist = lms[0]
    d_tip = _dist2d(lms[tip_idx], wrist)
    d_pip = _dist2d(lms[pip_idx], wrist)
    d_mcp = _dist2d(lms[mcp_idx], wrist)
    return d_tip > d_pip * 1.07 and d_tip > d_mcp * 1.18


def _is_finger_folded(lms: list[Point3D], tip_idx: int, pip_idx: int, mcp_idx: int) -> bool:
    """Checks if a finger is clearly curled toward the palm."""
    wrist = lms[0]
    d_tip = _dist2d(lms[tip_idx], wrist)
    d_pip = _dist2d(lms[pip_idx], wrist)
    d_mcp = _dist2d(lms[mcp_idx], wrist)
    return d_tip < d_pip * 1.04 or d_tip < d_mcp * 1.12


def _confirmed(count: int, start_ms: float | None, now_ms: float, min_frames: int, min_ms: float) -> bool:
    return start_ms is not None and count >= min_frames and (now_ms - start_ms) >= min_ms


def _pip_angle(a: Point3D, b: Point3D, c: Point3D) -> float:
    """Ángulo en grados en b (3D, con la profundidad relativa de MediaPipe): 180 = dedo recto."""
    v1 = (a.x - b.x, a.y - b.y, a.z - b.z)
    v2 = (c.x - b.x, c.y - b.y, c.z - b.z)
    n1 = math.sqrt(sum(p * p for p in v1))
    n2 = math.sqrt(sum(p * p for p in v2))
    if n1 < 1e-9 or n2 < 1e-9:
        return 180.0
    cos = sum(p * q for p, q in zip(v1, v2)) / (n1 * n2)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def _index_pinch_shape(lms: list[Point3D], scale: float) -> bool:
    """Forma de la micro-pinza (videos reales del 21-11-2026): el índice se dobla SOLO hacia el pulgar y el medio
    queda aparte. Separa el clic del scroll (índice y medio juntos y rectos, con el pulgar cerca) y de los golpes
    de mano de pestañas y ventanas, que en la imagen también acercan el pulgar a la punta del índice."""
    separated = _dist2d(lms[8], lms[12]) / scale >= PINCH_INDEX_SEPARATION
    bent = _pip_angle(lms[5], lms[6], lms[8]) <= PINCH_INDEX_MAX_ANGLE
    return separated and bent


def _is_fist_pose(lms: list[Point3D], scale: float) -> bool:
    """Puño: los cuatro dedos plegados y cada punta cerca de la palma (no solo más cerca de la muñeca)."""
    for tip, mcp in ((8, 5), (12, 9), (16, 13), (20, 17)):
        if _dist2d(lms[tip], lms[mcp]) > FIST_TIP_RATIO * scale:
            return False
    return not any(
        _is_finger_extended(lms, tip, pip, mcp)
        for tip, pip, mcp in ((8, 6, 5), (12, 10, 9), (16, 14, 13), (20, 18, 17))
    )


class _HoldGesture:
    """Gesto discreto sostenido: dispara UNA vez tras `hold_ms` de postura, exige soltarla
    `rearm_ms` para rearmarse y respeta `cooldown_ms`. Con `still_palm` la mano debe estar quieta."""

    def __init__(self, hold_ms: float, cooldown_ms: float, rearm_ms: float = DISCRETE_REARM_MS, still_palm: float | None = None) -> None:
        self.hold_ms = hold_ms
        self.cooldown_ms = cooldown_ms
        self.rearm_ms = rearm_ms
        self.still_palm = still_palm
        self._start_ms: float | None = None
        self._anchor: tuple[float, float] | None = None
        self._lost_ms: float | None = None
        self._last_step_ms: float | None = None
        self.locked = False
        self._fired_ms = -1e9

    @property
    def holding(self) -> bool:
        return self._start_ms is not None

    def cancel(self) -> None:
        self._start_ms = None
        self._anchor = None

    def step(self, pose: bool, now_ms: float, cx: float = 0.0, cy: float = 0.0, scale: float = 1.0) -> bool:
        # Si la postura no se evaluó durante un tiempo (otra rama del intérprete la excluyó), la
        # confirmación empieza de cero: un inicio antiguo nunca cuenta como "sostenido".
        if self._last_step_ms is not None and (now_ms - self._last_step_ms > HOLD_GAP_RESET_MS or now_ms < self._last_step_ms):
            self._start_ms = None
            self._anchor = None
        self._last_step_ms = now_ms
        if not pose:
            self._start_ms = None
            self._anchor = None
            if self._lost_ms is None:
                self._lost_ms = now_ms
            if self.locked and (now_ms - self._lost_ms) >= self.rearm_ms:
                self.locked = False
            return False
        self._lost_ms = None
        if self.locked or (now_ms - self._fired_ms) < self.cooldown_ms:
            return False
        if self._start_ms is None or self._anchor is None:
            self._start_ms = now_ms
            self._anchor = (cx, cy)
            return False
        if self.still_palm is not None and math.hypot(cx - self._anchor[0], cy - self._anchor[1]) / max(1e-6, scale) > self.still_palm:
            self._start_ms = now_ms
            self._anchor = (cx, cy)
            return False
        if (now_ms - self._start_ms) >= self.hold_ms:
            self.locked = True
            self._fired_ms = now_ms
            self._start_ms = None
            self._anchor = None
            return True
        return False


class GestureInterpreter:
    """Stateful gesture recognizer transforming 21 landmarks into logical events."""

    def __init__(self, config: EngineConfig | None = None) -> None:
        self.config = config or EngineConfig()
        self.paused: bool = False
        self.external_hold: bool = False   # retención por mirada: sin eventos mientras dure
        self.precision_active: bool = False
        self.airswipe_active: bool = False
        self.pointer_armed: bool = False
        self._filter_x = OneEuroFilter1D(min_cutoff=self.config.min_cutoff_hz, beta=self.config.beta_speed)
        self._filter_y = OneEuroFilter1D(min_cutoff=self.config.min_cutoff_hz, beta=self.config.beta_speed)
        self._smoothed_x: float | None = None
        self._smoothed_y: float | None = None
        self._pinch_locked_pos: tuple[float, float] | None = None
        self._pinch_candidate_count: int = 0
        self._pinch_candidate_start_ms: float | None = None
        self._pinching: bool = False          # pinza confirmada
        self._pinch_release_count: int = 0
        self._dragging: bool = False
        self._pinch_start_ms: float = 0.0
        self._last_click_ms: float = -10000.0
        self._fist_start_ms: float | None = None
        self._fist_toggled_in_hold: bool = False
        self._scroll_frames: int = 0
        self._scroll_gap: int = 0
        self._scroll_start_ms: float | None = None
        self._scroll_anchor: tuple[float, float] | None = None
        self._scroll_last_ms: float = 0.0
        self._scroll_pending: float = 0.0     # unidades pendientes de emitir (limitadas por velocidad)
        self._scroll_accum: float = 0.0       # fracción de muesca aún no emitida
        self._missing_frames: int = 0
        self._lost_since_ms: float | None = None
        self._tracking_lost_emitted: bool = False
        self._fist_count: int = 0
        self._fist_first_ms: float | None = None
        self._fist_seen_ms: float | None = None  # último fotograma con postura de puño (aunque no confirmado)
        self._fist_anchor: tuple[float, float] | None = None
        self._fist_misses: int = 0
        self._fist_was_confirmed: bool = False
        self._win_frames: int = 0
        self._win_start_ms: float | None = None
        self._win_anchor_y: float | None = None
        self._win_lost_ms: float | None = None
        self._win_locked: bool = False
        self._win_fired_ms: float = -1e9
        self._swipe_start_ms: float | None = None
        self._swipe_x0: float = 0.0
        self._swipe_y0: float = 0.0
        self._swipe_min_x: float = 0.0
        self._swipe_max_x: float = 0.0
        self._swipe_min_y: float = 0.0
        self._swipe_max_y: float = 0.0
        self._swipe_last_xy: tuple[float, float] | None = None
        self._swipe_still_ms: float | None = None
        self._swipe_lost_ms: float | None = None
        self._swipe_locked: bool = False
        self._swipe_fired_ms: float = -1e9
        self._arm_start_ms: float | None = None
        self._thumb_up = _HoldGesture(THUMB_HOLD_MS, THUMB_COOLDOWN_MS)
        self._thumb_down = _HoldGesture(THUMB_HOLD_MS, THUMB_COOLDOWN_MS)
        self._precision_hold = _HoldGesture(PRECISION_HOLD_MS, PRECISION_COOLDOWN_MS)
        self._call_hold = _HoldGesture(CALL_HOLD_MS, CALL_COOLDOWN_MS)
        self._keyboard_hold = _HoldGesture(KEYBOARD_HOLD_MS, KEYBOARD_COOLDOWN_MS, still_palm=KEYBOARD_STILL_PALM)
        self._keyboard_posing = False
        self._palm_hold = _HoldGesture(PALM_HOLD_MS, PALM_COOLDOWN_MS, still_palm=PALM_STILL_PALM)
        self._discrete_locked_pos: tuple[float, float] | None = None
        self._trace_frames: int = 0
        self._trace_gap: int = 0
        self._tracing: bool = False
        self._trace_points: list[list[float]] = []
        self._last_seen_ms: float | None = None
        self._cursor_history: list[tuple[float, float, float]] = []   # (t, x, y) del cursor suavizado
        self._arm_center: tuple[float, float] | None = None           # centro del área activa fijado al armar
        self._settle_ref: tuple[float, float, float] | None = None     # (x, y, t) para detectar mano quieta
        self._accel_prev: tuple[float, float, float] | None = None     # posición absoluta filtrada anterior (x, y, t)
        self._accel_out: tuple[float, float] | None = None              # posición acelerada (la que sigue el cursor)
        self._cursor_settled: bool = False
        self._fan_hist: list[tuple[float, float, float, float]] = []  # (ms, dirección de los dedos, cx, cy), últimos ~250 ms
        self._fan_armed: bool = True
        self._wave_hist: list[tuple[float, float, float]] = []
        self._palm_prev: tuple[float, float, float] | None = None
        self.palm_speed: float = 0.0
        self._wave_fired_ms: float = -1e9
        self._wave_locked: bool = False
        self._wave_still_ms: float | None = None
        self._fan_calm_since: float | None = None
        # Diagnóstico de la pinza (ver process_frame): motivo -> fotogramas. Solo conteos.
        self.pinch_diag: dict[str, int] = {}
        self._pinch_reason: str | None = None
        self._fan_last_ms: float = -1e9
        self._flick_prev: tuple[float, tuple[float, ...], float, float] | None = None  # (ms, puntas, cx, cy)
        self._flick_dir: int = 0          # +1 bajada en curso, -1 subida en curso, 0 nada
        self._flick_ms: float = -1e9
        self._flick_fired_ms: float = -1e9
        self._flick_kind: str = ""
        self._hang_start_ms: float | None = None
        self._alt_prev: tuple[float, tuple[float, ...]] | None = None
        self._alt_down_ms: float | None = None
        self._alt_fired_ms: float = -1e9
        self._alt_hold_from: float | None = None   # bajada rápida con la postura mantenida desde entonces
        self._alt_hold_thumbs: list[float] = []
        self._alt_pose_since: float | None = None
        self._alt_holding: bool = False
        self._alt_step_ms: float = 0.0
        self._alt_lost_ms: float | None = None
        self._grab_hold = _HoldGesture(OPEN_SCROLL_GRAB_MS, 0.0, still_palm=OPEN_SCROLL_STILL_PALM)
        self._grab_active = False
        self._grab_lost_ms: float | None = None
        self._hang_last_ms: float | None = None
        self._rpinch_count: int = 0
        self._rpinch_start_ms: float | None = None
        self._rpinch_active: bool = False
        self._rpinch_active_ms: float = 0.0
        self._rpinch_release: int = 0
        self.telemetry = InterpreterTelemetry()

    # ------------------------------------------------------------------ control

    def update_config(self, config: EngineConfig) -> list[LogicalEvent]:
        """Aplica una configuración nueva. Antes libera cualquier botón retenido y limpia el estado
        de pinza y scroll, porque cualquier cambio puede hacer incompatible el gesto en curso."""
        events = self._release_pointer_state("config_change")
        self._reset_scroll()
        self._cancel_candidates()
        self._cancel_trace()
        self.config = config
        if not config.pointer_enabled:
            self.pointer_armed = False
        if not config.airswipe_enabled:
            self.airswipe_active = False
        return events

    def set_paused(self, paused: bool, now_ms: float = 0.0) -> list[LogicalEvent]:
        events = self._release_pointer_state("pause")
        self._reset_scroll()
        self._cancel_candidates()
        self._cancel_trace()
        if paused != self.paused:
            self.paused = paused
            events.append(LogicalEvent(EVENT_PAUSE if paused else EVENT_RESUME, {"timestamp_ms": now_ms}))
        if paused:
            self.pointer_armed = False
        self.telemetry.paused = self.paused
        return events

    def set_external_hold(self, hold: bool) -> list[LogicalEvent]:
        """Retención externa (asistencia por mirada): libera lo retenido y deja de emitir eventos."""
        events: list[LogicalEvent] = []
        if hold and not self.external_hold:
            events = self._release_pointer_state("gaze_hold")
            self._reset_scroll()
            self._cancel_candidates()
            self._cancel_trace()
        self.external_hold = hold
        return events

    def set_airswipe(self, active: bool) -> list[LogicalEvent]:
        """Activa o desactiva el modo teclado Air-Swipe (lo decide la interfaz al abrir el teclado)."""
        self.airswipe_active = bool(active)
        if not active:
            self._cancel_trace()
        return []

    def set_precision(self, active: bool) -> None:
        self.precision_active = bool(active)

    def _release_pointer_state(self, reason: str) -> list[LogicalEvent]:
        """Termina arrastre y pinza sin emitir clic. Único punto de liberación del interpretador."""
        events: list[LogicalEvent] = []
        if self._dragging:
            self._dragging = False
            events.append(LogicalEvent(EVENT_END_DRAG, {"reason": reason}))
        self._clear_pinch()
        return events

    def _clear_pinch(self) -> None:
        self._pinching = False
        self._pinch_release_count = 0
        self._pinch_candidate_count = 0
        self._pinch_candidate_start_ms = None
        self._pinch_locked_pos = None

    def _reset_scroll(self) -> None:
        self._grab_active = False
        self._grab_lost_ms = None
        self._scroll_frames = 0
        self._scroll_gap = 0
        self._scroll_start_ms = None
        self._scroll_anchor = None
        self._scroll_pending = 0.0
        self._scroll_accum = 0.0

    def _cancel_trace(self) -> None:
        self._tracing = False
        self._trace_frames = 0
        self._trace_gap = 0
        self._trace_points = []
        self.telemetry.tracing = False

    def _fist_confirmed(self, candidate: bool, palm_x: float, palm_y: float, scale: float, now_ms: float, opened: bool = False) -> bool:
        """Confirma un puño: postura sostenida durante varias muestras y tiempo, con la palma quieta.
        Tolera FIST_MISS_TOLERANCE muestras sueltas que no parecen puño (ruido de la cámara), salvo que la
        mano se haya abierto de verdad (`opened`): eso es soltar el puño a propósito."""
        if not candidate:
            if not opened and self._fist_first_ms is not None and self._fist_misses < FIST_MISS_TOLERANCE:
                self._fist_misses += 1
                return self._fist_was_confirmed
            self._fist_misses = 0
            self._fist_was_confirmed = False
            self._fist_count = 0
            self._fist_first_ms = None
            self._fist_anchor = None
            return False
        if self._fist_first_ms is None or self._fist_anchor is None:
            self._fist_first_ms = now_ms
            self._fist_anchor = (palm_x, palm_y)
            self._fist_count = 0
        ax, ay = self._fist_anchor
        if math.hypot(palm_x - ax, palm_y - ay) / scale > FIST_STILL_PALM:
            # La mano se mueve: no es un puño sostenido para pausar. Se reinicia la confirmación.
            self._fist_was_confirmed = False
            self._fist_first_ms = now_ms
            self._fist_anchor = (palm_x, palm_y)
            self._fist_count = 0
            return False
        self._fist_count += 1
        self._fist_misses = 0
        self._fist_was_confirmed = _confirmed(self._fist_count, self._fist_first_ms, now_ms, FIST_CONFIRM_FRAMES, FIST_CONFIRM_MS)
        return self._fist_was_confirmed

    def _cancel_candidates(self) -> None:
        """Cancela gestos discretos en curso sin tocar los bloqueos de rearme (un gesto ya disparado
        no vuelve a disparar porque se pierda y se recupere la mano en la misma postura)."""
        self._fist_count = 0
        self._fist_first_ms = None
        self._fist_anchor = None
        self._win_frames = 0
        self._win_start_ms = None
        self._win_anchor_y = None
        self._swipe_start_ms = None
        self._swipe_last_xy = None
        self._swipe_still_ms = None
        self._arm_start_ms = None
        for hold in (self._thumb_up, self._thumb_down, self._precision_hold, self._palm_hold):
            hold.cancel()
        self._discrete_locked_pos = None
        self._fan_hist = []
        self._clear_right_pinch()

    # ------------------------------------------------------------ acciones discretas

    def _discrete_action(self, gesto: str, now_ms: float, extra: dict[str, Any] | None = None) -> list[LogicalEvent]:
        """Resuelve la acción configurada de un gesto discreto y la emite como evento lógico.
        `precision` y `navegacion` cambian además el estado del propio interpretador."""
        accion = self.config.discrete_actions.get(gesto, NO_ACTION)
        if accion == NO_ACTION or accion not in ACTION_EVENTS:
            return []
        payload: dict[str, Any] = {"gesto": gesto, "accion": accion, "timestamp_ms": now_ms}
        if extra:
            payload.update(extra)
        if accion == "precision":
            self.precision_active = not self.precision_active
            payload["active"] = self.precision_active
        elif accion == "navegacion":
            self.precision_active = False
            self._cancel_trace()
        return [LogicalEvent(ACTION_EVENTS[accion], payload)]

    def _window_step(self, pose: bool, palm_y: float, scale: float, now_ms: float) -> list[LogicalEvent]:
        """Tres dedos: una acción por gesto. Abajo minimiza la ventana activa; arriba restaura la última."""
        events: list[LogicalEvent] = []
        if not pose:
            self._win_frames = 0
            self._win_start_ms = None
            self._win_anchor_y = None
            if self._win_lost_ms is None:
                self._win_lost_ms = now_ms
            if self._win_locked and (now_ms - self._win_lost_ms) >= WINDOW_REARM_MS:
                self._win_locked = False  # rearme: la postura se soltó y quedó neutral
            return events
        self._win_lost_ms = None
        if self._win_locked or (now_ms - self._win_fired_ms) < WINDOW_COOLDOWN_MS:
            return events
        self._win_frames += 1
        if self._win_start_ms is None:
            self._win_start_ms = now_ms
            self._win_anchor_y = palm_y
        if not _confirmed(self._win_frames, self._win_start_ms, now_ms, WINDOW_CONFIRM_FRAMES, WINDOW_CONFIRM_MS):
            return events
        assert self._win_anchor_y is not None
        dy = (palm_y - self._win_anchor_y) / scale  # positivo = hacia abajo
        if abs(dy) >= WINDOW_MIN_PALM:
            kind = EVENT_MINIMIZE_WINDOW if dy > 0 else EVENT_RESTORE_WINDOW
            events.append(LogicalEvent(kind, {"dy_palm": round(dy, 3)}))
            self._win_fired_ms = now_ms
            self._win_locked = True
            self._win_frames = 0
            self._win_start_ms = None
            self._win_anchor_y = None
        elif (now_ms - self._win_start_ms) > WINDOW_GESTURE_WINDOW_MS:
            self._win_start_ms = now_ms
            self._win_anchor_y = palm_y
        return events

    def _flick_step(self, lms: list[Point3D], blocked: bool, now_ms: float) -> list[LogicalEvent]:
        """Golpe de muñeca (ver FLICK_*): ida rápida de las 4 puntas y vuelta antes de FLICK_RETURN_MS. Se decide
        en la vuelta: bajar y volver minimiza la ventana activa; subir y volver restaura la última minimizada."""
        size = max(_dist2d(lms[0], lms[5]), _dist2d(lms[0], lms[17]), _dist2d(lms[5], lms[17])) or 1e-6
        tips = tuple((lms[t].y - lms[m].y) / size for t, m in ((8, 5), (12, 9), (16, 13), (20, 17)))
        cx = (lms[0].x + lms[5].x + lms[17].x) / 3.0
        cy = (lms[0].y + lms[5].y + lms[17].y) / 3.0
        prev, self._flick_prev = self._flick_prev, (now_ms, tips, cx, cy)
        if self._flick_dir and (now_ms - self._flick_ms) > FLICK_RETURN_MS:
            self._flick_dir = 0
        if blocked:
            self._flick_dir = 0
            return []
        if prev is None or not (0.0 < now_ms - prev[0] <= FLICK_MAX_GAP_MS):
            return []
        dt = (now_ms - prev[0]) / 1000.0
        if math.hypot(cx - prev[2], cy - prev[3]) / size / dt >= FLICK_MAX_HAND_SPEED:
            return []
        speeds = [(a - b) / dt for a, b in zip(tips, prev[1])]   # positivo = la punta baja
        move = 1 if min(speeds) > FLICK_MIN_SPEED else -1 if min(-v for v in speeds) > FLICK_MIN_SPEED else 0
        if not move:
            return []
        if self._flick_dir == -move and (now_ms - self._flick_fired_ms) >= FLICK_COOLDOWN_MS:
            kind = EVENT_MINIMIZE_WINDOW if self._flick_dir > 0 else EVENT_RESTORE_WINDOW
            self._flick_dir = 0
            if kind != self._flick_kind and (now_ms - self._flick_fired_ms) < FLICK_OPPOSITE_MS:
                return []
            self._flick_fired_ms = now_ms
            self._flick_kind = kind
            return [LogicalEvent(kind, {"gesto": "golpe_muneca"})]
        if self._flick_dir != move:
            self._flick_dir = move
            self._flick_ms = now_ms
        return []

    def _wave_step(self, open_hand: bool, cx: float, cy: float, scale: float, now_ms: float) -> list[LogicalEvent]:
        """Sacudida lateral (ver WAVE_*): ida rápida a un lado y vuelta. Devuelve NEXT_TAB / PREV_TAB."""
        if not open_hand:
            self._wave_hist = []
            self._wave_locked = False
            return []
        hist = self._wave_hist
        if hist and now_ms - hist[-1][0] > TAB_FAN_MAX_GAP_MS:
            hist.clear()
        if self._wave_locked:
            last = self._wave_hist[-1] if self._wave_hist else None
            hist.append((now_ms, cx, cy))
            del hist[:-2]
            speed = (math.hypot(cx - last[1], cy - last[2]) / scale / max(1e-3, (now_ms - last[0]) / 1000.0)) if last else 0.0
            if speed >= WAVE_STILL_SPEED:
                self._wave_still_ms = None
            elif self._wave_still_ms is None:
                self._wave_still_ms = now_ms
            if self._wave_still_ms is not None and now_ms - self._wave_still_ms >= WAVE_REARM_MS:
                self._wave_locked = False   # se conservan las dos últimas muestras quietas: el inicio de la próxima ida
            return []
        hist.append((now_ms, cx, cy))
        while hist and now_ms - hist[0][0] > WAVE_WINDOW_MS:
            hist.pop(0)
        if len(hist) < 3 or (now_ms - self._wave_fired_ms) < WAVE_COOLDOWN_MS:
            return []
        # Extremo = el punto más lejano de la posición actual; la ida va desde el punto anterior más alejado de él.
        k = max(range(len(hist) - 1), key=lambda i: abs(hist[i][1] - cx))
        peak_t, peak_x, peak_y = hist[k]
        back = (cx - peak_x) / scale
        if k == 0:
            return []
        direction = -1.0 if back > 0 else 1.0          # la ida va en sentido contrario a la vuelta
        # Inicio de la ida: el punto MÁS RECIENTE casi tan alejado del extremo como el más alejado (con la mano
        # quieta antes, el más antiguo alargaba la ida y la hacía parecer lenta).
        far = max(direction * (peak_x - hist[i][1]) for i in range(k))
        j = max(i for i in range(k) if direction * (peak_x - hist[i][1]) >= 0.9 * far)
        if j == 0:
            return []   # el comienzo de la ida ya salió de la ventana: no se ve el movimiento entero
        start_t, start_x, start_y = hist[j]
        out = direction * (peak_x - start_x) / scale
        out_ms = peak_t - start_t
        if out < WAVE_MIN_PALM or out_ms <= 0 or out_ms > WAVE_OUT_MAX_MS:
            return []
        if out / (out_ms / 1000.0) < WAVE_MIN_SPEED or abs(back) < WAVE_RETURN_FRAC * out:
            return []
        vertical = max(abs(y - start_y) for _, _, y in hist[j:]) / scale
        if vertical > WAVE_MAX_VERTICAL * out:
            return []
        self._wave_fired_ms = now_ms
        self._wave_hist = [(now_ms, cx, cy)]
        self._wave_locked = True
        self._wave_still_ms = None
        kind = EVENT_NEXT_TAB if direction > 0 else EVENT_PREV_TAB
        return [LogicalEvent(kind, {"gesto": "sacudida_lateral"})]

    def _alt_switcher_reset(self) -> None:
        """Olvida el selector en curso (mano perdida, gesto apagado). Alt lo suelta el motor con release_all."""
        self._alt_hold_from = None
        self._alt_pose_since = None
        self._alt_hold_thumbs = []
        self._alt_holding = False
        self._alt_lost_ms = None

    def _alt_switcher_step(self, pose: bool, thumb: float, blocked: bool, now_ms: float) -> list[LogicalEvent]:
        """Selector de ventanas (ver ALT_HOLD_*): tres dedos mantenidos abajo tras la bajada rápida."""
        if self._alt_holding:
            if blocked:
                self._alt_switcher_reset()
                return [LogicalEvent(EVENT_ALT_SWITCHER, {"fase": "soltar", "motivo": "bloqueado"})]
            if pose:
                self._alt_lost_ms = None
                if now_ms - self._alt_step_ms >= ALT_HOLD_STEP_MS:
                    self._alt_step_ms = now_ms
                    return [LogicalEvent(EVENT_ALT_SWITCHER, {"fase": "siguiente"})]
                return []
            if self._alt_lost_ms is None:
                self._alt_lost_ms = now_ms
            if now_ms - self._alt_lost_ms >= ALT_HOLD_RELEASE_MS:
                self._alt_switcher_reset()
                self._alt_fired_ms = now_ms
                return [LogicalEvent(EVENT_ALT_SWITCHER, {"fase": "soltar"})]
            return []
        if blocked:
            self._alt_hold_from = None
            self._alt_pose_since = None
            self._alt_hold_thumbs = []
            return []
        if not pose:
            # Durante la bajada los dedos aún no están doblados: la bajada solo caduca si no hay postura a tiempo.
            self._alt_pose_since = None
            self._alt_hold_thumbs = []
            if self._alt_hold_from is not None and now_ms - self._alt_hold_from > ALT_HOLD_MS:
                self._alt_hold_from = None
            return []
        if self._alt_pose_since is None:
            self._alt_pose_since = now_ms
        if self._alt_hold_from is None:
            return []
        self._alt_hold_thumbs.append(thumb)
        thumb_ok = (not self.config.dictation_enabled) or (
            sum(self._alt_hold_thumbs) / len(self._alt_hold_thumbs) < ALT_HOLD_THUMB_MAX
        )
        if (now_ms - self._alt_hold_from >= ALT_HOLD_MS and now_ms - self._alt_pose_since >= ALT_HOLD_POSE_MS and thumb_ok
                and (now_ms - self._alt_fired_ms) >= ALT_TAB_COOLDOWN_MS):
            self._alt_holding = True
            self._alt_step_ms = now_ms
            self._alt_lost_ms = None
            self._alt_down_ms = None   # al subir los dedos se suelta Alt: no es además el Alt+Tab rápido
            return [LogicalEvent(EVENT_ALT_SWITCHER, {"fase": "abrir"})]
        return []

    def _alt_tab_step(self, lms: list[Point3D], blocked: bool, now_ms: float, pose: bool = False,
                      thumb: float = 0.0) -> list[LogicalEvent]:
        """Alt+Tab (ver ALT_TAB_*): bajada rápida de índice, medio y anular con el meñique quieto, y vuelta enseguida.
        Con la postura mantenida (pose: tres dedos abajo y meñique arriba) abre el selector de ventanas (ALT_HOLD_*)."""
        size = max(_dist2d(lms[0], lms[5]), _dist2d(lms[0], lms[17]), _dist2d(lms[5], lms[17])) or 1e-6
        tips = tuple((lms[t].y - lms[m].y) / size for t, m in ((8, 5), (12, 9), (16, 13), (20, 17)))
        prev, self._alt_prev = self._alt_prev, (now_ms, tips)
        held = self._alt_switcher_step(pose, thumb, blocked, now_ms)
        if held or self._alt_holding:
            return held
        if self._alt_down_ms is not None and (now_ms - self._alt_down_ms) > ALT_TAB_RETURN_MS:
            self._alt_down_ms = None
        if blocked or prev is None or not (0.0 < now_ms - prev[0] <= FLICK_MAX_GAP_MS):
            if blocked:
                self._alt_down_ms = None
            return []
        dt = (now_ms - prev[0]) / 1000.0
        v = [(a - b) / dt for a, b in zip(tips, prev[1])]   # positivo = la punta baja
        slow = min(v[:3])
        if slow > FLICK_MIN_SPEED and abs(v[3]) < ALT_TAB_PINKY_RATIO * slow:
            if self._alt_down_ms is None:
                self._alt_down_ms = now_ms
            if self._alt_hold_from is None:
                self._alt_hold_from = now_ms
            return []
        up = min(-x for x in v[:3])
        if (self._alt_down_ms is not None and up > FLICK_MIN_SPEED and abs(v[3]) < ALT_TAB_PINKY_RATIO * up
                and (now_ms - self._alt_fired_ms) >= ALT_TAB_COOLDOWN_MS):
            self._alt_down_ms = None
            self._alt_fired_ms = now_ms
            return [LogicalEvent(EVENT_ALT_TAB, {"gesto": "tres_dedos_y_volver"})]
        return []

    def _raise_step(self, lms: list[Point3D], open_hand: bool, now_ms: float) -> list[LogicalEvent]:
        """Mano colgando y luego levantada abierta y vertical: traer de vuelta la última ventana (ver HANG_*)."""
        palm_dir = math.degrees(math.atan2(-(lms[9].y - lms[0].y), lms[9].x - lms[0].x))
        if palm_dir < HANG_PALM_DIR:
            if self._hang_start_ms is None:
                self._hang_start_ms = now_ms
            self._hang_last_ms = now_ms
            return []
        if self._hang_start_ms is None or self._hang_last_ms is None:
            return []
        if (self._hang_last_ms - self._hang_start_ms) < HANG_MIN_MS:
            # Colgó solo un instante (p. ej. al relajar el puño de pausa): debe colgar de forma continua.
            self._hang_start_ms = None
            return []
        if now_ms - self._hang_last_ms > RAISE_WINDOW_MS:
            self._hang_start_ms = None
            return []
        if (open_hand and palm_dir > RAISE_PALM_DIR and (self._hang_last_ms - self._hang_start_ms) >= HANG_MIN_MS
                and (now_ms - self._flick_fired_ms) >= FLICK_COOLDOWN_MS):
            self._hang_start_ms = None
            self._flick_fired_ms = now_ms
            self._flick_kind = EVENT_RESTORE_WINDOW
            self._flick_dir = 0
            return [LogicalEvent(EVENT_RESTORE_WINDOW, {"gesto": "levantar_mano"})]
        return []

    @staticmethod
    def _fan_tilted(lms: list[Point3D], handedness: str) -> bool:
        """Mano ladeada como en el abanico: palmo (muñeca -> nudillo del medio) por debajo de TAB_FAN_TILT."""
        palm_dir = math.degrees(math.atan2(-(lms[9].y - lms[0].y), lms[9].x - lms[0].x))
        return palm_dir < TAB_FAN_TILT if handedness != "Left" else palm_dir > 180.0 - TAB_FAN_TILT

    def _fan_step(self, lms: list[Point3D], handedness: str, open_hand: bool, now_ms: float) -> tuple[bool, list[LogicalEvent]]:
        """Abanico de pestaña (ver TAB_FAN_*). Devuelve (postura en curso, eventos): mientras la mano abierta y ladeada
        está casi quieta, el cursor no se mueve, para que el abanico no lo arrastre."""
        size = max(_dist2d(lms[0], lms[5]), _dist2d(lms[0], lms[17]), _dist2d(lms[5], lms[17])) or 1e-6
        finger_dir = math.degrees(math.atan2(-(lms[12].y - lms[9].y), lms[12].x - lms[9].x))
        cx = (lms[0].x + lms[5].x + lms[17].x) / 3.0
        cy = (lms[0].y + lms[5].y + lms[17].y) / 3.0
        # Muestras recientes: se compara con la más nueva que tenga al menos TAB_FAN_MIN_SPAN_MS de antigüedad.
        hist = [s for s in self._fan_hist if 0.0 < now_ms - s[0] <= TAB_FAN_MAX_GAP_MS + TAB_FAN_MIN_SPAN_MS]
        self._fan_hist = hist + [(now_ms, finger_dir, cx, cy)]
        if hist and now_ms - hist[-1][0] > TAB_FAN_MAX_GAP_MS:
            hist = []   # hueco: mano perdida entre medias
        older = [s for s in hist if now_ms - s[0] >= TAB_FAN_MIN_SPAN_MS]
        prev = older[-1] if older else None
        right = handedness != "Left"
        tilted = self._fan_tilted(lms, handedness)
        if not (open_hand and tilted) or prev is None:
            if not (open_hand and tilted):
                self._fan_armed = True
            return False, []
        dt = (now_ms - prev[0]) / 1000.0
        turn = ((finger_dir - prev[1] + 180.0) % 360.0 - 180.0) / dt   # grados por segundo; negativo = horario
        hand_speed = math.hypot(cx - prev[2], cy - prev[3]) / size / dt
        still = hand_speed < TAB_FAN_MAX_HAND_SPEED
        toward_thumb = -turn if right else turn
        # Pestaña anterior: giro rápido hacia el meñique con el abanico armado (antes de desarmarlo abajo).
        if (self._fan_armed and toward_thumb <= -TAB_PREV_MIN_SPEED and hand_speed < TAB_PREV_MAX_HAND_SPEED
                and (now_ms - self._fan_last_ms) >= TAB_FAN_COOLDOWN_MS):
            self._fan_armed = False
            self._fan_calm_since = None
            self._fan_last_ms = now_ms
            return True, [LogicalEvent(EVENT_PREV_TAB, {"giro_grados_s": round(turn), "gesto": "abanico_inverso"})]
        if abs(turn) < TAB_FAN_REARM_SPEED:
            if self._fan_calm_since is None:
                self._fan_calm_since = now_ms
            if now_ms - self._fan_calm_since >= TAB_FAN_REARM_MS:
                self._fan_armed = True
        else:
            self._fan_calm_since = None
            if toward_thumb <= -TAB_FAN_MIN_SPEED:
                # Giro rápido hacia el otro lado: su vuelta (hacia el pulgar) no es un abanico; hay que calmarse antes.
                self._fan_armed = False
        if (still and self._fan_armed and toward_thumb >= TAB_FAN_MIN_SPEED
                and (now_ms - self._fan_last_ms) >= TAB_FAN_COOLDOWN_MS):
            self._fan_armed = False
            self._fan_last_ms = now_ms
            return True, [LogicalEvent(EVENT_NEXT_TAB, {"giro_grados_s": round(turn), "gesto": "abanico"})]
        return still, []

    def _accelerate(self, x: float, y: float, now_ms: float) -> tuple[float, float]:
        """Aplica la aceleración del puntero a la posición absoluta filtrada (ver ACCEL_*)."""
        if not self.config.pointer_acceleration:
            return x, y
        prev, out = self._accel_prev, self._accel_out
        self._accel_prev = (x, y, now_ms)
        if prev is None or out is None or now_ms <= prev[2] or (now_ms - prev[2]) > 300.0:
            self._accel_out = (x, y)
            return x, y
        dt = (now_ms - prev[2]) / 1000.0
        dx, dy = x - prev[0], y - prev[1]
        gain = pointer_gain(math.hypot(dx, dy) / dt)
        ox, oy = out[0] + dx * gain, out[1] + dy * gain
        self._accel_out = (max(0.0, min(1.0, ox)), max(0.0, min(1.0, oy)))
        return self._accel_out

    def _cursor_before(self, t_ms: float) -> tuple[float, float] | None:
        """Posición del cursor suavizado en el último fotograma anterior a `t_ms` (o None)."""
        for t, x, y in reversed(self._cursor_history):
            if t <= t_ms:
                return (x, y)
        return None

    def _clear_right_pinch(self) -> None:
        self._rpinch_count = 0
        self._rpinch_start_ms = None
        self._rpinch_active = False
        self._rpinch_release = 0

    def _right_pinch_step(self, close: bool, open_: bool, now_ms: float) -> tuple[bool, list[LogicalEvent]]:
        """Pinza pulgar-medio con confirmación e histéresis, como la del índice. Devuelve (en curso, eventos):
        mientras está en curso el cursor no se mueve, para que el clic caiga donde apuntaba."""
        if not self._rpinch_active:
            if not close:
                self._clear_right_pinch()
                return False, []
            self._rpinch_count += 1
            if self._rpinch_start_ms is None:
                self._rpinch_start_ms = now_ms
            if _confirmed(self._rpinch_count, self._rpinch_start_ms, now_ms, RIGHT_PINCH_CONFIRM_FRAMES, RIGHT_PINCH_CONFIRM_MS):
                self._rpinch_active = True
                self._rpinch_active_ms = self._rpinch_start_ms
                self._rpinch_release = 0
            return True, []
        self._rpinch_release = self._rpinch_release + 1 if open_ else 0
        if self._rpinch_release < RIGHT_PINCH_RELEASE_FRAMES:
            return True, []
        held_ms = now_ms - self._rpinch_active_ms
        self._clear_right_pinch()
        if held_ms > RIGHT_PINCH_MAX_MS or (now_ms - self._last_click_ms) < self.config.click_cooldown_ms:
            return False, []
        self._last_click_ms = now_ms
        return False, [LogicalEvent(EVENT_RIGHT_CLICK)]

    def _swipe_restart(self, cx: float, cy: float, now_ms: float) -> None:
        self._swipe_start_ms = now_ms
        self._swipe_x0 = cx
        self._swipe_y0 = cy
        self._swipe_min_x = cx
        self._swipe_max_x = cx
        self._swipe_min_y = cy
        self._swipe_max_y = cy

    def _swipe_step(self, pose: bool, cx: float, cy: float, scale: float, now_ms: float) -> list[LogicalEvent]:
        """Barrido con palma abierta: una acción por barrido, con rearme por quietud y cooldown.
        Horizontal: acción configurada (atrás/adelante). Vertical (con window_swipe_enabled): abajo
        minimiza la ventana activa y arriba restaura la última minimizada por el motor."""
        events: list[LogicalEvent] = []
        if not pose:
            self._swipe_start_ms = None
            self._swipe_last_xy = None
            self._swipe_still_ms = None
            if self._swipe_lost_ms is None:
                self._swipe_lost_ms = now_ms
            if self._swipe_locked and (now_ms - self._swipe_lost_ms) >= SWIPE_REARM_MS:
                self._swipe_locked = False
            return events
        self._swipe_lost_ms = None

        step = 0.0
        if self._swipe_last_xy is not None:
            step = math.hypot(cx - self._swipe_last_xy[0], cy - self._swipe_last_xy[1]) / scale
        self._swipe_last_xy = (cx, cy)
        if step < SWIPE_STILL_PALM:
            if self._swipe_still_ms is None:
                self._swipe_still_ms = now_ms
        else:
            self._swipe_still_ms = None

        if self._swipe_locked:
            quiet = self._swipe_still_ms is not None and (now_ms - self._swipe_still_ms) >= SWIPE_REARM_MS
            if quiet and (now_ms - self._swipe_fired_ms) >= SWIPE_COOLDOWN_MS:
                self._swipe_locked = False
            return events

        window_ms = max(SWIPE_WINDOW_MS, VSWIPE_WINDOW_MS) if self.config.window_swipe_enabled else SWIPE_WINDOW_MS
        if self._swipe_start_ms is None or (now_ms - self._swipe_start_ms) > window_ms:
            self._swipe_restart(cx, cy, now_ms)
            return events

        self._swipe_min_x = min(self._swipe_min_x, cx)
        self._swipe_max_x = max(self._swipe_max_x, cx)
        self._swipe_min_y = min(self._swipe_min_y, cy)
        self._swipe_max_y = max(self._swipe_max_y, cy)
        dx = (cx - self._swipe_x0) / scale
        dy = (cy - self._swipe_y0) / scale

        if self.config.window_swipe_enabled and abs(dy) >= abs(dx):
            # Vertical: si la mano vuelve desde su extremo no es un barrido.
            if (dy > 0 and (self._swipe_max_y - cy) / scale > SWIPE_REVERSAL_PALM) or (
                dy < 0 and (cy - self._swipe_min_y) / scale > SWIPE_REVERSAL_PALM
            ):
                self._swipe_restart(cx, cy, now_ms)
                return events
            if abs(dy) < VSWIPE_MIN_PALM or abs(dy) < VSWIPE_DOMINANCE * abs(dx):
                return events
            elapsed_s = max(1e-3, (now_ms - self._swipe_start_ms) / 1000.0)
            if abs(dy) / elapsed_s < VSWIPE_MIN_SPEED:
                return events
            kind = EVENT_MINIMIZE_WINDOW if dy > 0 else EVENT_RESTORE_WINDOW
            events.append(LogicalEvent(kind, {"dy_palm": round(dy, 3), "gesto": "barrido_vertical"}))
            self._swipe_locked = True
            self._swipe_fired_ms = now_ms
            self._swipe_start_ms = None
            self._palm_hold.cancel()
            return events
        if (now_ms - self._swipe_start_ms) > SWIPE_WINDOW_MS:
            return events
        # Si la mano vuelve hacia atrás desde su extremo, no es un barrido: se reinicia la ventana.
        if (dx > 0 and (self._swipe_max_x - cx) / scale > SWIPE_REVERSAL_PALM) or (
            dx < 0 and (cx - self._swipe_min_x) / scale > SWIPE_REVERSAL_PALM
        ):
            self._swipe_restart(cx, cy, now_ms)
            return events
        if abs(dx) < SWIPE_MIN_PALM or abs(dx) < SWIPE_DOMINANCE * abs(dy):
            return events
        elapsed_s = max(1e-3, (now_ms - self._swipe_start_ms) / 1000.0)
        if abs(dx) / elapsed_s < SWIPE_MIN_SPEED:
            return events

        gesto: str | None = None
        if dx < 0 and self.config.swipe_left_enabled:
            gesto = "deslizamiento_izquierda"
        elif dx > 0 and self.config.swipe_right_enabled:
            gesto = "deslizamiento_derecha"
        if gesto is None:
            self._swipe_restart(cx, cy, now_ms)
            return events
        events.extend(self._discrete_action(gesto, now_ms, {"dx_palm": round(dx, 3)}))
        self._swipe_locked = True
        self._swipe_fired_ms = now_ms
        self._swipe_start_ms = None
        self._palm_hold.cancel()
        return events

    # ------------------------------------------------------------ mapping utils

    @property
    def _gain_multiplier(self) -> float:
        return PRECISION_GAIN_FACTOR if (self.precision_active and not self.config.precision_mode) else 1.0

    def _map_to_screen_norm(self, raw_x: float, raw_y: float, clamp: bool = True) -> tuple[float, float]:
        """Maps normalized camera coordinates inside active_bounds to [0.0 .. 1.0] with cursor gain."""
        x_min, x_max, y_min, y_max = self.config.active_bounds
        span_x = max(0.15, x_max - x_min)
        span_y = max(0.15, y_max - y_min)
        if self._arm_center is not None:
            x_min = min(max(ACTIVE_EDGE, self._arm_center[0] - span_x / 2), 1.0 - ACTIVE_EDGE - span_x)
            y_min = min(max(ACTIVE_EDGE, self._arm_center[1] - span_y / 2), 1.0 - ACTIVE_EDGE - span_y)

        nx = (raw_x - x_min) / span_x
        ny = (raw_y - y_min) / span_y

        gain = self.config.cursor_gain * self._gain_multiplier
        nx = 0.5 + (nx - 0.5) * gain
        ny = 0.5 + (ny - 0.5) * gain
        if not clamp:
            return nx, ny
        return max(0.0, min(1.0, nx)), max(0.0, min(1.0, ny))

    @staticmethod
    def _compute_skeletal_anchor(lms: list[Point3D]) -> tuple[float, float]:
        """Computes a stable palm reference point from metacarpals (5, 9, 13, 17) and wrist (0).
        Unlike finger tips (4, 8), this anchor remains stationary when the user pinches thumb & index!
        """
        ax = 0.35 * lms[5].x + 0.35 * lms[9].x + 0.15 * lms[13].x + 0.15 * lms[0].x
        ay = 0.35 * lms[5].y + 0.35 * lms[9].y + 0.15 * lms[13].y + 0.15 * lms[0].y
        return ax, ay

    def _telemetry(self, hand: HandLandmarks, gesture: str, pinch_px: int, pinch_ratio: float,
                   raw_ax: float, raw_ay: float, compact_lms: list[list[float]]) -> InterpreterTelemetry:
        return InterpreterTelemetry(
            hand_detected=True,
            handedness=hand.handedness,
            confidence=hand.confidence,
            gesture=gesture,
            paused=self.paused,
            pointer_armed=self.pointer_armed or not self.config.pointer_enabled,
            precision=self.precision_active,
            tracing=self._tracing,
            pinch_distance_px=pinch_px,
            pinch_ratio=pinch_ratio,
            cursor_norm_x=round(self._smoothed_x if self._smoothed_x is not None else 0.5, 4),
            cursor_norm_y=round(self._smoothed_y if self._smoothed_y is not None else 0.5, 4),
            raw_anchor_x=round(raw_ax, 4),
            raw_anchor_y=round(raw_ay, 4),
            landmarks_2d=compact_lms,
        )

    # --------------------------------------------------------------- scroll

    def _scroll_step(self, avg_x: float, avg_y: float, scale: float, now_ms: float) -> int:
        """Devuelve muescas de rueda (positivo = arriba) para el desplazamiento desde el ancla."""
        ax, ay = self._scroll_anchor  # type: ignore[misc]
        dx = (avg_x - ax) / scale
        dy = (ay - avg_y) / scale  # hacia arriba = positivo
        dt = max(1.0 / 120.0, min(0.25, (now_ms - self._scroll_last_ms) / 1000.0))
        self._scroll_last_ms = now_ms

        # Quietud o temblor (dentro de la zona muerta): el ancla no se mueve, así el movimiento lento
        # se acumula hasta superarla. Movimiento horizontal dominante: no desplaza y consume el movimiento.
        if abs(dy) >= SCROLL_DEADZONE_PALM:
            if abs(dx) * SCROLL_AXIS_DOMINANCE <= abs(dy):
                # Solo se consume el recorrido por encima de la zona muerta: el ancla avanza esa cantidad
                # y deja la banda muerta pendiente. Así el resultado no depende de cuántas muestras
                # haga falta para recorrer el mismo desplazamiento (cadencia).
                consumed = dy - math.copysign(SCROLL_DEADZONE_PALM, dy)
                sensitivity_gain = 0.55 + self.config.sensitivity / 100.0
                self._scroll_pending += consumed * SCROLL_UNITS_PER_PALM * sensitivity_gain
                self._scroll_anchor = (avg_x, ay - consumed * scale)
            else:
                self._scroll_anchor = (avg_x, avg_y)

        # La cola pendiente se vacía en cada muestra, aunque la mano esté quieta, con límite de velocidad
        # por tiempo transcurrido (no por número de fotogramas).
        max_units = SCROLL_MAX_NOTCHES_PER_SEC * dt
        emitted = max(-max_units, min(max_units, self._scroll_pending))
        self._scroll_pending -= emitted
        self._scroll_accum += emitted
        steps = int(self._scroll_accum)
        self._scroll_accum -= steps
        return steps

    # --------------------------------------------------------------- trazo

    def _trace_step(self, pointing: bool, now_ms: float) -> list[LogicalEvent]:
        """Trazo Air-Swipe: apuntar con el índice inicia el recorrido; soltar la postura lo cierra."""
        events: list[LogicalEvent] = []
        if pointing:
            self._trace_gap = 0
            self._trace_frames += 1
            if not self._tracing and self._trace_frames >= TRACE_CONFIRM_FRAMES:
                self._tracing = True
                self._trace_points = []
            return events
        self._trace_frames = 0
        if self._tracing:
            self._trace_gap += 1
            if self._trace_gap >= TRACE_END_FRAMES:
                events.extend(self._finish_trace(now_ms))
        return events

    def _finish_trace(self, now_ms: float) -> list[LogicalEvent]:
        points = self._trace_points
        self._cancel_trace()
        if len(points) < TRACE_MIN_POINTS:
            return []
        length = sum(math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]) for i in range(1, len(points)))
        if length < TRACE_MIN_LENGTH:
            return []
        return [LogicalEvent(EVENT_AIRSWIPE_TRACE, {"points": points, "length": round(length, 4), "timestamp_ms": now_ms})]

    # ---------------------------------------------------------- main frame

    def process_frame(self, hand: HandLandmarks | None, now_ms: float) -> list[LogicalEvent]:
        """Procesa un fotograma. Además cuenta, en `pinch_diag`, por qué no hubo clic en cada fotograma con el
        pulgar y el índice juntos (bajo el umbral de entrada): diagnóstico del informe de prueba, solo conteos."""
        self._pinch_reason = None
        events = self._process_frame(hand, now_ms)
        tel = self.telemetry
        if hand is not None and tel.hand_detected and tel.pinch_ratio <= self.config.pinch_enter_ratio:
            reason = self._pinch_reason or f"OTRO_GESTO_{tel.gesture}"
            self.pinch_diag[reason] = self.pinch_diag.get(reason, 0) + 1
        return events

    def _process_frame(self, hand: HandLandmarks | None, now_ms: float) -> list[LogicalEvent]:
        events: list[LogicalEvent] = []
        now_sec = now_ms / 1000.0

        # 1. Missing hand or low confidence
        if hand is None or hand.confidence < self.config.min_detection_confidence:
            self._missing_frames += 1
            if (
                self._missing_frames <= DROPOUT_GRACE_FRAMES
                and self._last_seen_ms is not None
                and (now_ms - self._last_seen_ms) <= DROPOUT_GRACE_MS
            ):
                # Cuadro suelto sin mano: se conservan el puño, la pinza y los gestos en curso.
                return events
            self._fist_start_ms = None
            self._reset_scroll()
            self._cancel_candidates()
            if self._missing_frames >= self.config.tracking_loss_frames:
                self._filter_x.reset()
                self._filter_y.reset()
                self._accel_prev = None
                self._accel_out = None
                events.extend(self._release_pointer_state("tracking_lost"))
                self._alt_switcher_reset()
                if self._tracing:
                    self._cancel_trace()
                if not self._tracking_lost_emitted:
                    events.append(LogicalEvent(EVENT_TRACKING_LOST))
                    self._tracking_lost_emitted = True
                    self._lost_since_ms = now_ms
                if self._lost_since_ms is not None and (now_ms - self._lost_since_ms) >= POINTER_DISARM_MS:
                    self.pointer_armed = False
                self.telemetry = InterpreterTelemetry(
                    hand_detected=False, gesture="NONE", paused=self.paused,
                    pointer_armed=self.pointer_armed or not self.config.pointer_enabled, precision=self.precision_active,
                )
            return events

        self._missing_frames = 0
        self._last_seen_ms = now_ms
        self._tracking_lost_emitted = False
        self._lost_since_ms = None
        lms = hand.landmarks
        compact_lms = [[round(p.x, 3), round(p.y, 3)] for p in lms[:21]]

        # 2. Palm scale, pinch ratio, finger states
        scale = _palm_scale(lms)
        pinch_dist = _pinch_distance(lms[4], lms[8])
        pinch_ratio = round(pinch_dist / scale, 4)
        pinch_px = int(round(pinch_dist * 640))

        index_ext = _is_finger_extended(lms, 8, 6, 5)
        middle_ext = _is_finger_extended(lms, 12, 10, 9)
        ring_ext = _is_finger_extended(lms, 16, 14, 13)
        pinky_ext = _is_finger_extended(lms, 20, 18, 17)

        middle_folded = _is_finger_folded(lms, 12, 10, 9)
        ring_folded = _is_finger_folded(lms, 16, 14, 13)
        pinky_folded = _is_finger_folded(lms, 20, 18, 17)

        raw_ax, raw_ay = self._compute_skeletal_anchor(lms)
        pinch_open = pinch_ratio > self.config.pinch_exit_ratio

        # Retención externa (mirada): se sigue observando la mano, pero no se emite ninguna acción.
        if self.external_hold:
            self.telemetry = self._telemetry(hand, "GAZE_HOLD", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
            return events

        # 3. Puño: transición de parada. Si había arrastre o pinza, se liberan sin clic.
        fist_palm_x = (lms[0].x + lms[5].x + lms[9].x + lms[17].x) * 0.25
        fist_palm_y = (lms[0].y + lms[5].y + lms[9].y + lms[17].y) * 0.25
        opened = sum((index_ext, middle_ext, ring_ext, pinky_ext)) >= 2
        fist_now = _is_fist_pose(lms, scale)
        if fist_now:
            self._fist_seen_ms = now_ms
        is_fist = self._fist_confirmed(fist_now, fist_palm_x, fist_palm_y, scale, now_ms, opened)
        thumb_mcp = lms[2]
        thumb_tip = lms[4]
        index_mcp = lms[5]
        thumb_out_dist = _dist2d(thumb_tip, index_mcp) / scale
        dy_thumb = (thumb_mcp.y - thumb_tip.y) / scale   # positivo = punta por encima de la articulación (arriba)
        thumb_extended = _is_fist_pose(lms, scale) and thumb_out_dist > 0.72 and abs(dy_thumb) > 0.42
        # Regla suelta (ver THUMB_UP_LOOSE_*): solo suma tiempo sostenido al pulgar arriba; NO corta el fotograma,
        # porque el centro de un golpe de muñeca (dedos doblados hacia la cámara) se le parece durante un instante.
        loose_thumb_up = (not thumb_extended) and (not (index_ext or middle_ext or ring_ext or pinky_ext)) and (
            thumb_out_dist > THUMB_UP_LOOSE_OUT and dy_thumb > THUMB_UP_LOOSE_DY
        )
        thumbs_up_pose = thumb_extended and dy_thumb > 0
        thumbs_down_pose = thumb_extended and dy_thumb < 0
        if is_fist or thumb_extended:
            events.extend(self._release_pointer_state("fist"))
            self._reset_scroll()
            self._cancel_trace()
            if thumb_extended:
                # Pulgar extendido: gesto discreto sostenido, una acción por postura. No pausa, y no acumula
                # tiempo de puño (si no, un cuadro dudoso durante el pulgar pausaría al instante).
                self._fist_start_ms = None
                self._fist_first_ms = None
                self._fist_was_confirmed = False
                if self._thumb_up.step(thumbs_up_pose, now_ms) and self.config.thumbs_up_enabled:
                    events.extend(self._discrete_action("pulgar_arriba", now_ms))
                if self._thumb_down.step(thumbs_down_pose, now_ms) and self.config.thumbs_down_enabled:
                    events.extend(self._discrete_action("pulgar_abajo", now_ms))
                gesture = "THUMBS_UP" if thumbs_up_pose else "THUMBS_DOWN"
                self.telemetry = self._telemetry(hand, gesture, pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                return events
            self._thumb_up.step(False, now_ms)
            self._thumb_down.step(False, now_ms)
            if self._fist_start_ms is None:
                # El tiempo para pausar cuenta desde que la mano formó el puño, no desde que se confirmó:
                # antes la pausa tardaba ~750 ms (confirmación + espera); ahora ~pause_hold_ms.
                self._fist_start_ms = self._fist_first_ms if self._fist_first_ms is not None else now_ms
                self._fist_toggled_in_hold = False
            elif (not self._fist_toggled_in_hold) and (now_ms - self._fist_start_ms >= self.config.pause_hold_ms):
                # Reanudar siempre permitido; iniciar pausa requiere fist_pause_enabled.
                if self.paused or self.config.fist_pause_enabled:
                    self._fist_toggled_in_hold = True
                    self.paused = not self.paused
                    if self.paused:
                        self.pointer_armed = False
                    events.append(LogicalEvent(EVENT_PAUSE if self.paused else EVENT_RESUME))
                else:
                    self._fist_toggled_in_hold = True
            gesture = "PAUSE" if self.paused else "FIST_HOLD"
            self.telemetry = self._telemetry(hand, gesture, pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
            return events

        self._fist_start_ms = None
        self._fist_toggled_in_hold = False
        if self._thumb_up.step(loose_thumb_up, now_ms) and self.config.thumbs_up_enabled:
            events.extend(self._discrete_action("pulgar_arriba", now_ms))
        self._thumb_down.step(False, now_ms)

        if self.paused:
            self.telemetry = self._telemetry(hand, "PAUSE", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
            return events

        open_pose = index_ext and middle_ext and ring_ext and pinky_ext and pinch_open

        # 3b. Activación del puntero: mano abierta sostenida. Hasta entonces no hay cursor ni gestos.
        if self.config.pointer_enabled and not self.pointer_armed:
            if open_pose:
                if self._arm_start_ms is None:
                    self._arm_start_ms = now_ms
                elif (now_ms - self._arm_start_ms) >= POINTER_ARM_MS:
                    self.pointer_armed = True
                    # Donde la persona abre la mano pasa a ser el centro de la pantalla: no hay que levantar
                    # el brazo hasta una zona fija de la imagen (salvo calibración de recorrido medida).
                    self._arm_center = (raw_ax, raw_ay) if self.config.active_box is None else None
                    self._accel_prev = None
                    self._accel_out = None
                    self._arm_start_ms = None
                    self._palm_hold.cancel()
                    self._filter_x.reset()
                    self._filter_y.reset()
            else:
                self._arm_start_ms = None
            if not self.pointer_armed:
                self.telemetry = self._telemetry(hand, "ARMING" if open_pose else "NONE", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                return events

        # 4. Pinza: estado confirmado o candidato. Se evalúa antes del scroll para que pinza y dos dedos
        #    sean excluyentes por la relación pinza/palma.
        pinch_is_active = self._pinching or self._pinch_candidate_count > 0
        palm_cx = (lms[0].x + lms[5].x + lms[9].x + lms[17].x) * 0.25
        palm_cy = (lms[0].y + lms[5].y + lms[9].y + lms[17].y) * 0.25
        prev_palm, self._palm_prev = self._palm_prev, (now_ms, palm_cx, palm_cy)
        if prev_palm is not None and 0.0 < now_ms - prev_palm[0] <= TAB_FAN_MAX_GAP_MS:
            self.palm_speed = math.hypot(palm_cx - prev_palm[1], palm_cy - prev_palm[2]) / scale / ((now_ms - prev_palm[0]) / 1000.0)
        else:
            self.palm_speed = 0.0

        # 4·0. Golpe de muñeca para ventanas (con windowSwipe): observa el movimiento sin cortar los demás gestos.
        #      Con el teclado Air-Swipe abierto (y keyboardGesture), el golpe hacia abajo BAJA EL TECLADO en vez de la
        #      ventana (23-11-2026); hacia arriba no hace nada. No cuenta trazando ni con la postura del trazo (solo
        #      el índice extendido): el golpe mueve las cuatro puntas. (En la bajada los dedos se doblan, así que no
        #      se puede exigir la mano abierta en cada fotograma.)
        keyboard_close = self.airswipe_active and self.config.keyboard_gesture_enabled
        hang_recent = False
        if self.config.window_swipe_enabled and not self.airswipe_active:
            events.extend(self._raise_step(lms, sum((index_ext, middle_ext, ring_ext, pinky_ext)) >= 3, now_ms))
            hang_recent = self._hang_last_ms is not None and (now_ms - self._hang_last_ms) < HANG_FLICK_GUARD_MS
        if self.config.alt_tab_enabled:
            fist_recent_alt = fist_now or (self._fist_seen_ms is not None and (now_ms - self._fist_seen_ms) < FIST_PINCH_GUARD_MS)
            alt_pose = (not index_ext) and (not middle_ext) and (not ring_ext) and pinky_ext
            events.extend(self._alt_tab_step(lms, self.airswipe_active or self._dragging or pinch_is_active or fist_recent_alt,
                                             now_ms, alt_pose, _dist2d(lms[4], lms[5]) / scale))
        elif self._alt_holding:
            self._alt_switcher_reset()
            events.append(LogicalEvent(EVENT_ALT_SWITCHER, {"fase": "soltar", "motivo": "desactivado"}))
        if self.config.window_swipe_enabled or keyboard_close:
            fist_recent = fist_now or (self._fist_seen_ms is not None and (now_ms - self._fist_seen_ms) < FIST_PINCH_GUARD_MS)
            # Solo tras un abanico que SÍ pasó de pestaña: la vuelta de ese abanico no es un golpe de muñeca.
            fan_recent = self.config.tab_gestures_enabled and (now_ms - self._fan_last_ms) < FLICK_AFTER_FAN_MS
            if self.airswipe_active:
                blocked = (not keyboard_close) or self._tracing or (index_ext and middle_folded and ring_folded)
            else:
                blocked = False
            blocked = blocked or self._dragging or pinch_is_active or fist_recent or fan_recent or hang_recent
            for flick in self._flick_step(lms, blocked, now_ms):
                if not self.airswipe_active:
                    events.append(flick)
                elif flick.type == EVENT_MINIMIZE_WINDOW:
                    events.append(LogicalEvent(EVENT_KEYBOARD_CLOSE, {"gesto": "golpe_muneca"}))

        # 4·0a. Pestaña siguiente (gesto local): abanico con la mano abierta y ladeada (ver TAB_FAN_*). Sustituye
        #       al gesto de pulgar y meñique (21-11-2026). Mientras la mano ladeada está quieta, el cursor no se mueve.
        if self.config.tab_gestures_enabled and not self._dragging and not pinch_is_active and not self.airswipe_active:
            open_hand = sum((index_ext, middle_ext, ring_ext, pinky_ext)) >= 3
            wave_cx = (lms[0].x + lms[5].x + lms[9].x + lms[17].x) * 0.25
            wave_cy = (lms[0].y + lms[5].y + lms[9].y + lms[17].y) * 0.25
            events.extend(self._wave_step(open_hand, wave_cx, wave_cy, scale, now_ms))
            tab_pose, tab_events = self._fan_step(lms, hand.handedness, open_hand, now_ms)
            events.extend(tab_events)
            if tab_pose:
                self._reset_scroll()
                self.telemetry = self._telemetry(hand, "PESTANAS", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                return events

        # 4·0b. Clic derecho (gesto local): pinza pulgar-medio con el índice extendido y separado del pulgar.
        if self.config.right_click_enabled and not self.airswipe_active and not self._dragging and not pinch_is_active:
            # 21-11-2026 (videos reales): antes exigía el índice extendido y el medio lejos de la muñeca, algo que
            # una mano con los dedos colgando nunca cumple. Ahora: el pulgar toca el medio (umbral propio, más
            # estricto que el de la pinza: en reposo el pulgar ya queda a 0,16-0,42 palmas del medio), el índice
            # sigue lejos del pulgar (no es la micro-pinza) y no hay ni hubo un puño hace un instante.
            middle_ratio = _pinch_distance(lms[4], lms[12]) / scale
            fist_recent = fist_now or (self._fist_seen_ms is not None and (now_ms - self._fist_seen_ms) < FIST_PINCH_GUARD_MS)
            close = pinch_open and (not fist_recent) and middle_ratio <= RIGHT_PINCH_ENTER_RATIO
            in_progress, rp_events = self._right_pinch_step(close, middle_ratio >= RIGHT_PINCH_EXIT_RATIO, now_ms)
            events.extend(rp_events)
            if in_progress or rp_events:
                self._reset_scroll()
                gesture = "RIGHT_CLICK" if rp_events else "PINZA_MEDIO"
                self.telemetry = self._telemetry(hand, gesture, pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                return events
        elif self._rpinch_count or self._rpinch_active:
            self._clear_right_pinch()

        # 4·0c. Dictado (gesto local): 🤙 sostenido -> Win+H. Excluyente con la precisión (índice extendido) y con
        #       el pulgar arriba (allí el meñique está plegado). Mientras dura, el cursor no se mueve.
        call_pose = (
            self.config.dictation_enabled and pinky_ext and (not index_ext) and (not middle_ext) and (not ring_ext)
            and middle_folded and ring_folded and pinch_open and (not self._dragging) and (not pinch_is_active)
            and (not self.airswipe_active) and _dist2d(lms[4], lms[5]) / scale > CALL_THUMB_OUT
        )
        if self._call_hold.step(call_pose, now_ms):
            events.append(LogicalEvent(EVENT_DICTATION, {"gesto": "llamada"}))
        if call_pose:
            self._reset_scroll()
            self.telemetry = self._telemetry(hand, "DICTADO", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
            return events

        # 4a. Modo precisión (índice y meñique extendidos): postura sostenida, una acción por postura.
        #     Mientras dura, el cursor queda quieto para no desviar la selección.
        precision_pose = (
            index_ext and pinky_ext and (not middle_ext) and (not ring_ext) and middle_folded and ring_folded
            and pinch_open and (not self._dragging) and (not pinch_is_active)
        )
        if self._precision_hold.step(precision_pose, now_ms) and self.config.precision_gesture_enabled:
            events.extend(self._discrete_action("modo_precision", now_ms))
        if precision_pose:
            self._reset_scroll()
            self.telemetry = self._telemetry(hand, "PRECISION_POSE", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
            return events

        # 4b. Tres dedos (ventanas): solo con window_gestures_enabled. Excluyente con dos dedos,
        #     palma abierta y pinza; mientras dura la postura no mueve el puntero.
        if self.config.window_gestures_enabled:
            three_pose = (
                index_ext
                and middle_ext
                and ring_ext
                and pinky_folded
                and (not self._dragging)
                and (not pinch_is_active)
                and pinch_open
            )
            events.extend(self._window_step(three_pose, palm_cy, scale, now_ms))
            if three_pose:
                self.telemetry = self._telemetry(hand, "TRES_DEDOS", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                return events

        # 4c. Desplazar con la mano abierta (experimental, ver OPEN_SCROLL_*): agarrar quieta y luego subir/bajar.
        if self.config.open_hand_scroll_enabled and not self._dragging and not pinch_is_active and not self.airswipe_active:
            if self._grab_active:
                if open_pose:
                    self._grab_lost_ms = None
                    # Sentido de pantalla táctil (video «desliza hacia abajo»: la mano SUBE y la página baja).
                    steps = -self._scroll_step(palm_cx, palm_cy, scale, now_ms)
                    if steps != 0:
                        events.append(LogicalEvent(EVENT_SCROLL, {"dy": steps, "gesto": "mano_abierta"}))
                    self.telemetry = self._telemetry(hand, "SCROLL_MANO", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                    return events
                if self._grab_lost_ms is None:
                    self._grab_lost_ms = now_ms
                if now_ms - self._grab_lost_ms <= OPEN_SCROLL_DROPOUT_MS and not fist_now:
                    self.telemetry = self._telemetry(hand, "SCROLL_MANO", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                    return events
                self._grab_active = False
                self._reset_scroll()
            elif self._grab_hold.step(open_pose, now_ms, palm_cx, palm_cy, scale):
                self._reset_scroll()
                self._grab_active = True
                self._scroll_anchor = (palm_cx, palm_cy)
                self._scroll_last_ms = now_ms
                self.telemetry = self._telemetry(hand, "SCROLL_MANO", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                return events
        elif self._grab_active:
            self._grab_active = False
            self._reset_scroll()

        # 5. Dos dedos (scroll): postura confirmada + movimiento vertical fuera de la zona muerta.
        pose = (
            self.config.scroll_enabled
            and index_ext
            and middle_ext
            and (not ring_ext)
            and (not pinky_ext)
            and ring_folded
            and pinky_folded
            and pinch_open
            and (not self._dragging)
            and (not pinch_is_active)
        )
        if pose:
            self._scroll_gap = 0
            self._scroll_frames += 1
            if self._scroll_start_ms is None:
                self._scroll_start_ms = now_ms
            avg_x = (lms[8].x + lms[12].x) * 0.5
            avg_y = (lms[8].y + lms[12].y) * 0.5
            if self._scroll_anchor is None:
                self._scroll_anchor = (avg_x, avg_y)
                self._scroll_last_ms = now_ms
            elif _confirmed(self._scroll_frames, self._scroll_start_ms, now_ms, SCROLL_CONFIRM_FRAMES, SCROLL_CONFIRM_MS):
                steps = self._scroll_step(avg_x, avg_y, scale, now_ms)
                if steps != 0:
                    events.append(LogicalEvent(EVENT_SCROLL, {"dy": steps}))
            self.telemetry = self._telemetry(hand, "SCROLL", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
            return events

        # Un fotograma malo no debe reiniciar el desplazamiento: se mantiene el ancla y no se mueve el puntero.
        if self._scroll_anchor is not None and self._scroll_gap < SCROLL_DROPOUT_FRAMES:
            self._scroll_gap += 1
            return events
        self._reset_scroll()

        # 5a. Trazo Air-Swipe: apuntar con el índice (los demás dedos plegados) sobre el teclado virtual.
        pointing = (
            self.airswipe_active and self.config.airswipe_enabled
            and index_ext and (not middle_ext) and (not ring_ext) and (not pinky_ext)
            and middle_folded and ring_folded and pinky_folded and pinch_open
            and (not self._dragging) and (not pinch_is_active)
        )
        events.extend(self._trace_step(pointing, now_ms))

        # 5a·1. Abrir el teclado (☝️ sostenido y quieto, teclado cerrado). El cursor sigue al índice: si se mueve,
        #       la espera se reinicia (KEYBOARD_STILL_PALM), así que apuntar para mover el cursor no lo abre.
        keyboard_pose = (
            self.config.keyboard_gesture_enabled and self.config.airswipe_enabled and (not self.airswipe_active)
            and index_ext and (not middle_ext) and (not ring_ext) and (not pinky_ext)
            and middle_folded and ring_folded and pinky_folded and pinch_open
            and (not self._dragging) and (not pinch_is_active)
        )
        self._keyboard_posing = keyboard_pose
        if self._keyboard_hold.step(keyboard_pose, now_ms, palm_cx, palm_cy, scale):
            events.append(LogicalEvent(EVENT_KEYBOARD, {"gesto": "indice_sostenido"}))

        # 5b. Barrido horizontal con palma abierta: una acción por barrido. El puntero sigue activo.
        swipe_flags = self.config.swipe_left_enabled or self.config.swipe_right_enabled or self.config.window_swipe_enabled
        swipe_pose = swipe_flags and open_pose and (not self._dragging) and (not pinch_is_active)
        events.extend(self._swipe_step(swipe_pose, palm_cx, palm_cy, scale, now_ms))

        # 5c. Palma abierta sostenida y quieta: acción discreta (por defecto, volver a navegación).
        palm_pose = self.config.palm_enabled and open_pose and (not self._dragging) and (not pinch_is_active)
        if self._palm_hold.step(palm_pose, now_ms, palm_cx, palm_cy, scale):
            events.extend(self._discrete_action("palma_abierta", now_ms))

        # 6. Puntero con filtro One-Euro adaptativo
        # Sin recortar a [0, 1] antes del filtro y la aceleración: con la mano fuera del área activa el
        # recorte congelaba el cursor (QA 19-11, 2ª iteración). Se recorta solo la posición final.
        target_x, target_y = self._map_to_screen_norm(raw_ax, raw_ay, clamp=False)
        filtered_x = self._filter_x.filter(target_x, now_sec, min_cutoff=self.config.min_cutoff_hz, beta=self.config.beta_speed)
        filtered_y = self._filter_y.filter(target_y, now_sec, min_cutoff=self.config.min_cutoff_hz, beta=self.config.beta_speed)
        filtered_x, filtered_y = self._accelerate(filtered_x, filtered_y, now_ms)
        filtered_x, filtered_y = max(0.0, min(1.0, filtered_x)), max(0.0, min(1.0, filtered_y))

        active_gesture = "TRACE" if self._tracing else ("TECLADO" if self._keyboard_posing else "POINTER")
        enter_ratio = self.config.pinch_enter_ratio
        exit_ratio = self.config.pinch_exit_ratio
        # Solo la relación con el tamaño de la palma: el umbral absoluto (pensado para una palma de 0,15)
        # hacía que con la mano lejos la pinza entrara sola y no se pudiera soltar (clic -> arrastre).
        # La mano se está cerrando en puño (índice, medio y anular enrollados hacia la palma): no es una pinza.
        # Solo el índice no basta: en una pinza real con la palma hacia la cámara el índice doblado también
        # se proyecta cerca del nudillo (QA 19-11, 2ª iteración: bloqueaba clics legítimos).
        # 21-11-2026 (videos reales): la regla anterior («puntas más cerca de la muñeca que los nudillos») descartaba
        # TODAS las pinzas de una mano con los dedos colgando hacia la cámara. Ahora la pinza solo se bloquea si
        # la mano está en puño o lo estuvo hace menos de FIST_PINCH_GUARD_MS: abrir el puño pasa por posturas
        # parecidas a una pinza, y cerrarlo ya descarta la pinza sin clic (_release_pointer_state).
        index_curled = fist_now or (self._fist_seen_ms is not None and (now_ms - self._fist_seen_ms) < FIST_PINCH_GUARD_MS)
        hand_fast = self.palm_speed > PINCH_START_MAX_HAND_SPEED and self._pinch_candidate_count == 0 and not self._pinching
        is_entering_pinch = (pinch_ratio <= enter_ratio and not index_curled and not hand_fast
                             and _index_pinch_shape(lms, scale))
        if pinch_ratio <= enter_ratio:
            if not self.config.pinch_enabled:
                self._pinch_reason = "PINZA_DESACTIVADA"
            elif self._tracing:
                self._pinch_reason = "TRAZO_AIRSWIPE"
            elif self._pinching or is_entering_pinch:
                self._pinch_reason = "PINZA"
            elif index_curled:
                self._pinch_reason = "PUNO_RECIENTE"
            elif hand_fast:
                self._pinch_reason = "MANO_EN_MOVIMIENTO"
            elif _dist2d(lms[8], lms[12]) / scale < PINCH_INDEX_SEPARATION:
                self._pinch_reason = "INDICE_JUNTO_AL_MEDIO"
            else:
                self._pinch_reason = "INDICE_RECTO"
        is_exiting_pinch = pinch_ratio >= exit_ratio

        if self.config.pinch_enabled and not self._tracing:
            if not self._pinching:
                if is_entering_pinch:
                    if self._pinch_candidate_count == 0:
                        self._pinch_candidate_start_ms = now_ms
                        # Bloquear el cursor desde la primera muestra: el clic no debe desplazarlo.
                        self._pinch_locked_pos = self._cursor_before(now_ms - CLICK_REWIND_MS) or (
                            filtered_x if self._smoothed_x is None else self._smoothed_x,
                            filtered_y if self._smoothed_y is None else self._smoothed_y,
                        )
                    self._pinch_candidate_count += 1
                    if _confirmed(self._pinch_candidate_count, self._pinch_candidate_start_ms, now_ms,
                                  PINCH_CONFIRM_FRAMES, PINCH_CONFIRM_MS):
                        self._pinching = True
                        candidate_start = self._pinch_candidate_start_ms
                        self._pinch_start_ms = candidate_start if candidate_start is not None else now_ms
                        self._pinch_release_count = 0
                        active_gesture = "PINCH"
                    else:
                        active_gesture = "PINCH"  # candidato: aún sin confirmar, sin acción
                elif pinch_ratio >= exit_ratio or index_curled or (
                    self._pinch_candidate_start_ms is not None
                    and (now_ms - self._pinch_candidate_start_ms) > PINCH_CANDIDATE_MAX_MS
                ):
                    # La mano se abrió o la pinza no se confirmó a tiempo: se descarta sin clic.
                    self._clear_pinch()
                # Entre el umbral de entrada y el de salida la candidata se conserva (histéresis):
                # la medida oscila ahí durante una pinza real y no debe reiniciar la confirmación.
            elif index_curled and not self._dragging:
                # La pinza se convirtió en puño: se descarta sin clic (lo decide el puño).
                self._clear_pinch()
            else:
                active_gesture = "DRAG" if self._dragging else "PINCH"
                held_ms = now_ms - self._pinch_start_ms
                if is_exiting_pinch:
                    self._pinch_release_count += 1
                else:
                    self._pinch_release_count = 0

                if self._pinch_release_count >= PINCH_RELEASE_FRAMES:
                    was_dragging = self._dragging
                    self._clear_pinch()
                    if was_dragging:
                        self._dragging = False
                        events.append(LogicalEvent(EVENT_END_DRAG, {"reason": "pinch_released"}))
                        active_gesture = "POINTER"
                    elif (now_ms - self._last_click_ms) >= self.config.click_cooldown_ms:
                        self._last_click_ms = now_ms
                        events.append(LogicalEvent(EVENT_LEFT_CLICK))
                        active_gesture = "CLICK"
                # El arrastre empieza con la mano casi quieta (se sostiene la pinza y luego se mueve): una pinza leída
                # a media sacudida no arrastra la ventana hasta el borde (23-11-2026). Solo se aplaza.
                elif (self.config.drag_enabled and (not self._dragging) and held_ms >= self.config.drag_hold_ms
                      and self.palm_speed <= PINCH_START_MAX_HAND_SPEED):
                    self._dragging = True
                    self._pinch_locked_pos = None
                    events.append(LogicalEvent(EVENT_START_DRAG))
                    active_gesture = "DRAG"
        else:
            if self._pinching or self._pinch_candidate_count:
                events.extend(self._release_pointer_state("pinch_disabled"))

        # Cursor: se congela mientras hay pinza candidata o confirmada (no durante el arrastre).
        if self.config.pointer_enabled:
            if self._pinch_locked_pos is not None and not self._dragging:
                if (self._smoothed_x, self._smoothed_y) != self._pinch_locked_pos:
                    self._smoothed_x, self._smoothed_y = self._pinch_locked_pos
                    events.append(LogicalEvent(EVENT_MOVE_CURSOR, {"x": round(self._smoothed_x, 4), "y": round(self._smoothed_y, 4)}))
            elif self._smoothed_x is None or self._smoothed_y is None:
                self._smoothed_x, self._smoothed_y = filtered_x, filtered_y
                events.append(LogicalEvent(EVENT_MOVE_CURSOR, {"x": round(self._smoothed_x, 4), "y": round(self._smoothed_y, 4)}))
            else:
                # Cursor asentado: si la mano se queda dentro de un radio pequeño durante SETTLE_MS (el
                # balanceo natural de una mano en el aire), el cursor se queda quieto hasta que la mano
                # salga de ese radio. En movimiento sigue con la zona muerta normal. No aplica al arrastre.
                # Con aceleración el temblor ya baja (×0,6 en lento) y el asentado lo volvía pegajoso: solo sin ella.
                radius = self.config.settle_radius_norm if not self.config.pointer_acceleration else self.config.deadzone_norm
                if self._settle_ref is None or math.hypot(filtered_x - self._settle_ref[0], filtered_y - self._settle_ref[1]) > radius:
                    self._settle_ref = (filtered_x, filtered_y, now_ms)
                    self._cursor_settled = False
                elif not self._cursor_settled and (now_ms - self._settle_ref[2]) >= SETTLE_MS:
                    self._cursor_settled = True
                dx = filtered_x - self._smoothed_x
                dy = filtered_y - self._smoothed_y
                threshold = radius if (self._cursor_settled and not self._dragging) else self.config.deadzone_norm
                if math.hypot(dx, dy) >= threshold:
                    self._smoothed_x = filtered_x
                    self._smoothed_y = filtered_y
                    events.append(LogicalEvent(EVENT_MOVE_CURSOR, {"x": round(self._smoothed_x, 4), "y": round(self._smoothed_y, 4)}))
        else:
            self._smoothed_x = filtered_x
            self._smoothed_y = filtered_y

        if self._smoothed_x is not None and self._smoothed_y is not None and self._pinch_locked_pos is None:
            self._cursor_history.append((now_ms, self._smoothed_x, self._smoothed_y))
            while self._cursor_history and now_ms - self._cursor_history[0][0] > 400.0:
                self._cursor_history.pop(0)

        if self._tracing and self._smoothed_x is not None and self._smoothed_y is not None and len(self._trace_points) < TRACE_MAX_POINTS:
            self._trace_points.append([round(self._smoothed_x, 4), round(self._smoothed_y, 4)])

        self.telemetry = self._telemetry(hand, active_gesture, pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
        return events
