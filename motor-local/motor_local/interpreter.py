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
EVENT_AIRSWIPE_TRACE = "AIRSWIPE_TRACE"    # trazo terminado sobre el teclado Air-Swipe (puntos normalizados)
EVENT_RIGHT_CLICK = "RIGHT_CLICK"      # pinza pulgar-medio: clic derecho en la posición del puntero
EVENT_KEYBOARD_CLOSE = "KEYBOARD_CLOSE"  # bajar el teclado Air-Swipe (interfaz): el foco salió del campo de texto
EVENT_KEYBOARD = "KEYBOARD"            # abrir el teclado Air-Swipe (interfaz): el foco entró en un campo de texto (24-11-2026)
EVENT_ALT_TAB = "ALT_TAB"              # doblar índice, medio y anular rápido con el meñique arriba: Alt+Tab (23-11-2026)
EVENT_NEW_TAB = "NEW_TAB"              # ✌️ V (índice y medio separados) sostenida y quieta: pestaña nueva, Ctrl+T (23-11-2026)
EVENT_ALT_SWITCHER = "ALT_TAB_HOLD"    # los mismos tres dedos MANTENIDOS abajo: selector de ventanas (fase abrir/siguiente/soltar)

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
# Desplazar (24-11-2026, pedido): índice y medio extendidos y juntos, anular y meñique plegados, SOSTENIDOS. Con las
# puntas hacia arriba la página sube sin parar; con las puntas hacia abajo, baja. Ya no hace falta mover la mano (antes:
# mover la mano con los dos dedos, o doblarlos). Umbrales sin medir con videos de este gesto: hipótesis a validar en vivo.
SCROLL_DROPOUT_FRAMES = 2       # fotogramas seguidos sin la postura que se toleran sin cortar el desplazamiento
SCROLL_HOLD_MS = 300.0          # la postura (en el mismo sentido) se sostiene esto antes de la primera muesca
SCROLL_NOTCHES_PER_SEC = 8.0    # velocidad continua, antes de la sensibilidad (×0,55-1,55)
SCROLL_DIR_MIN = 0.5            # |componente vertical| de la dirección de los dedos: 0,5 = hasta 60° de la vertical
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
# Pestaña nueva (23-11-2026, pedido): ✌️ = índice y medio extendidos y SEPARADOS, anular y meñique plegados, sostenida
# y quieta. Desplazar usa los mismos dedos pero juntos y moviéndose: medido en los 25 videos, la separación entre las
# puntas en esa postura es 0,18-0,58 palmas (mediana 0,24) y nunca pasa de 0,45 más de un fotograma seguido.
NEWTAB_SPREAD = 0.5            # separación mínima entre las puntas del índice y el medio (palmas)
NEWTAB_HOLD_MS = 900.0
NEWTAB_COOLDOWN_MS = 1500.0
NEWTAB_STILL_PALM = 0.2        # recorrido máximo de la palma durante la espera: moverse en V es desplazar
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

# Velocidad de las puntas respecto de sus nudillos, en tamaños de mano por segundo (medida con los videos del golpe de
# muñeca, retirado el 24-11-2026; la usa Alt+Tab).
FLICK_MIN_SPEED = 4.0
FLICK_MAX_GAP_MS = 200.0
# Alt+Tab (23-11-2026, video «alt tab»): desde la mano abierta, índice, medio y anular bajan rápido (cada uno >
# FLICK_MIN_SPEED respecto de su nudillo) con el meñique casi quieto, y vuelven a subir antes de ALT_TAB_RETURN_MS.
# Medido: alt tab vuelve en 237-339 ms; una bajada sostenida (la antigua llamada del dictado) dura 675-911 ms; el caso más
# cercano en otros videos, 465 ms.
ALT_TAB_RETURN_MS = 400.0
ALT_TAB_PINKY_RATIO = 0.5      # el meñique se mueve menos que la mitad que el más lento de los tres
ALT_TAB_COOLDOWN_MS = 600.0
# Selector de ventanas (23-11-2026, pedido): bajar los tres dedos y MANTENERLOS abajo deja Alt pulsado y pulsa Tab, así
# Windows muestra todas las ventanas; cada ALT_HOLD_STEP_MS sostenidos pasa a la siguiente; al subir los dedos se suelta
# Alt y se cambia a la elegida. Bajar y subir rápido sigue siendo el Alt+Tab directo (vuelve en 271-373 ms en el video).
# Hasta el 24-11-2026 el selector exigía además el pulgar recogido para no confundirse con el dictado (retirado).
ALT_HOLD_MS = 500.0            # postura sostenida desde la bajada: por encima de la vuelta rápida (ALT_TAB_RETURN_MS)
ALT_HOLD_STEP_MS = 1000.0      # mantenido: una ventana más cada esto
ALT_HOLD_RELEASE_MS = 150.0    # la postura debe faltar esto para soltar (un fotograma dudoso no cambia de ventana)
ALT_HOLD_POSE_MS = 300.0       # y la postura continua al menos esto (sin huecos)
PALM_SPEED_MAX_GAP_MS = 200.0  # dos muestras más separadas que esto no se comparan (mano perdida)

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
        self._scroll_gap: int = 0
        self._scroll_dir: int = 0                  # +1 arriba, -1 abajo, 0 dedos de lado
        self._scroll_start_ms: float | None = None  # desde cuándo se sostiene la postura en ese sentido
        self._scroll_last_ms: float = 0.0
        self._scroll_accum: float = 0.0            # fracción de muesca aún no emitida
        self._missing_frames: int = 0
        self._lost_since_ms: float | None = None
        self._tracking_lost_emitted: bool = False
        self._fist_count: int = 0
        self._fist_first_ms: float | None = None
        self._fist_seen_ms: float | None = None  # último fotograma con postura de puño (aunque no confirmado)
        self._fist_anchor: tuple[float, float] | None = None
        self._fist_misses: int = 0
        self._fist_was_confirmed: bool = False
        self._arm_start_ms: float | None = None
        self._newtab_hold = _HoldGesture(NEWTAB_HOLD_MS, NEWTAB_COOLDOWN_MS, still_palm=NEWTAB_STILL_PALM)
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
        self._palm_prev: tuple[float, float, float] | None = None
        self.palm_speed: float = 0.0
        # Diagnóstico de la pinza (ver process_frame): motivo -> fotogramas. Solo conteos.
        self.pinch_diag: dict[str, int] = {}
        self._pinch_reason: str | None = None
        self._alt_prev: tuple[float, tuple[float, ...]] | None = None
        self._alt_down_ms: float | None = None
        self._alt_fired_ms: float = -1e9
        self._alt_hold_from: float | None = None   # bajada rápida con la postura mantenida desde entonces
        self._alt_pose_since: float | None = None
        self._alt_holding: bool = False
        self._alt_step_ms: float = 0.0
        self._alt_lost_ms: float | None = None
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
        self._scroll_gap = 0
        self._scroll_dir = 0
        self._scroll_start_ms = None
        self._scroll_accum = 0.0

    def _scroll_hold_step(self, direction: int, now_ms: float) -> int:
        """Muescas de rueda de la postura sostenida (positivo = arriba). Cambiar de sentido vuelve a esperar."""
        if direction != self._scroll_dir or self._scroll_start_ms is None:
            self._scroll_dir = direction
            self._scroll_start_ms = now_ms
            self._scroll_last_ms = now_ms
            self._scroll_accum = 0.0
            return 0
        dt = max(0.0, min(0.25, (now_ms - self._scroll_last_ms) / 1000.0))
        self._scroll_last_ms = now_ms
        if direction == 0 or now_ms - self._scroll_start_ms < SCROLL_HOLD_MS:
            return 0
        self._scroll_accum += SCROLL_NOTCHES_PER_SEC * (0.55 + self.config.sensitivity / 100.0) * dt
        steps = int(self._scroll_accum)
        self._scroll_accum -= steps
        return direction * steps

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
        self._arm_start_ms = None
        for hold in (self._palm_hold,):
            hold.cancel()
        self._discrete_locked_pos = None
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

    def _alt_switcher_reset(self) -> None:
        """Olvida el selector en curso (mano perdida, gesto apagado). Alt lo suelta el motor con release_all."""
        self._alt_hold_from = None
        self._alt_pose_since = None
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
            return []
        if not pose:
            # Durante la bajada los dedos aún no están doblados: la bajada solo caduca si no hay postura a tiempo.
            self._alt_pose_since = None
            if self._alt_hold_from is not None and now_ms - self._alt_hold_from > ALT_HOLD_MS:
                self._alt_hold_from = None
            return []
        if self._alt_pose_since is None:
            self._alt_pose_since = now_ms
        if self._alt_hold_from is None:
            return []
        if (now_ms - self._alt_hold_from >= ALT_HOLD_MS and now_ms - self._alt_pose_since >= ALT_HOLD_POSE_MS
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
        thumbs_up_pose = thumb_extended and dy_thumb > 0
        if is_fist or thumb_extended:
            events.extend(self._release_pointer_state("fist"))
            self._reset_scroll()
            self._cancel_trace()
            if thumb_extended:
                # Pulgar extendido (los gestos de pulgar se retiraron el 24-11-2026): no pausa ni acumula tiempo de
                # puño (si no, un cuadro dudoso con el pulgar fuera pausaría al instante) y no produce acción.
                self._fist_start_ms = None
                self._fist_first_ms = None
                self._fist_was_confirmed = False
                gesture = "THUMBS_UP" if thumbs_up_pose else "THUMBS_DOWN"
                self.telemetry = self._telemetry(hand, gesture, pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                return events
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
        if prev_palm is not None and 0.0 < now_ms - prev_palm[0] <= PALM_SPEED_MAX_GAP_MS:
            self.palm_speed = math.hypot(palm_cx - prev_palm[1], palm_cy - prev_palm[2]) / scale / ((now_ms - prev_palm[0]) / 1000.0)
        else:
            self.palm_speed = 0.0

        # 4·0. Alt+Tab (gesto local): bajada rápida de tres dedos con el meñique arriba (ver ALT_TAB_*).
        if self.config.alt_tab_enabled:
            fist_recent_alt = fist_now or (self._fist_seen_ms is not None and (now_ms - self._fist_seen_ms) < FIST_PINCH_GUARD_MS)
            alt_pose = (not index_ext) and (not middle_ext) and (not ring_ext) and pinky_ext
            events.extend(self._alt_tab_step(lms, self.airswipe_active or self._dragging or pinch_is_active or fist_recent_alt,
                                             now_ms, alt_pose, _dist2d(lms[4], lms[5]) / scale))
        elif self._alt_holding:
            self._alt_switcher_reset()
            events.append(LogicalEvent(EVENT_ALT_SWITCHER, {"fase": "soltar", "motivo": "desactivado"}))
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

        # 4d. Pestaña nueva (gesto local): ✌️ con los dedos separados, sostenida y quieta (ver NEWTAB_*). No corta el
        #     desplazar: con la V en movimiento la espera se reinicia y los dos dedos desplazan como siempre.
        newtab_pose = (
            self.config.new_tab_enabled and index_ext and middle_ext and (not ring_ext) and (not pinky_ext)
            and ring_folded and pinky_folded and pinch_open and (not self._dragging) and (not pinch_is_active)
            and (not self.airswipe_active) and _dist2d(lms[8], lms[12]) / scale >= NEWTAB_SPREAD
        )
        if self._newtab_hold.step(newtab_pose, now_ms, palm_cx, palm_cy, scale):
            events.append(LogicalEvent(EVENT_NEW_TAB, {"gesto": "v_sostenida"}))

        # 5. Desplazar (ver SCROLL_*): dos dedos juntos sostenidos; hacia arriba sube, hacia abajo baja. La V separada es
        #    la pestaña nueva (4d), no desplaza. Mientras dura, el cursor no se mueve.
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
            and not (self.config.new_tab_enabled and _dist2d(lms[8], lms[12]) / scale >= NEWTAB_SPREAD)
        )
        if pose:
            self._scroll_gap = 0
            mcp_x, mcp_y = (lms[5].x + lms[9].x) * 0.5, (lms[5].y + lms[9].y) * 0.5
            tip_x, tip_y = (lms[8].x + lms[12].x) * 0.5, (lms[8].y + lms[12].y) * 0.5
            length = math.hypot(tip_x - mcp_x, tip_y - mcp_y)
            vertical = (mcp_y - tip_y) / length if length > 1e-6 else 0.0   # +1 = puntas arriba (y de la imagen hacia abajo)
            direction = 1 if vertical >= SCROLL_DIR_MIN else -1 if vertical <= -SCROLL_DIR_MIN else 0
            steps = self._scroll_hold_step(direction, now_ms)
            if steps != 0:
                events.append(LogicalEvent(EVENT_SCROLL, {"dy": steps, "gesto": "dos_dedos"}))
            self.telemetry = self._telemetry(hand, "SCROLL", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
            return events

        # Un fotograma malo no corta el desplazamiento: se mantiene el sentido y no se mueve el puntero.
        if self._scroll_start_ms is not None and self._scroll_gap < SCROLL_DROPOUT_FRAMES:
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

        active_gesture = "TRACE" if self._tracing else "POINTER"
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
