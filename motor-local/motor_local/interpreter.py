"""Layer 3: Gesture Interpretation Module.

Máquina de estados que convierte 21 landmarks + EngineConfig en eventos lógicos:
MOVE_CURSOR, LEFT_CLICK, SCROLL, START_DRAG, END_DRAG, PAUSE, RESUME, TRACKING_LOST.
THUMBS_UP / THUMBS_DOWN se detectan en telemetría pero NO emiten eventos: no tienen acción
implementada (ver api_export.IMPLEMENTED_BINDINGS).

Estados mutuamente excluyentes por fotograma (prioridad):
  puño (pausa/parada) -> arrastre activo -> pinza -> dos dedos (scroll) -> puntero.

Todas las temporizaciones se miden en milisegundos reales, no solo en fotogramas:
- La pinza exige N muestras consecutivas Y un tiempo mínimo de confirmación.
- El scroll exige postura confirmada y movimiento por encima de una zona muerta; la velocidad
  se limita por tiempo transcurrido, de modo que cadencias distintas dan desplazamientos
  parecidos.

Los valores son hipótesis iniciales, no calibración medida.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .config import EngineConfig
from .detector import HandLandmarks, Point3D

# Logical Event Types
EVENT_MOVE_CURSOR = "MOVE_CURSOR"
EVENT_LEFT_CLICK = "LEFT_CLICK"
EVENT_SCROLL = "SCROLL"
EVENT_START_DRAG = "START_DRAG"
EVENT_END_DRAG = "END_DRAG"
EVENT_PAUSE = "PAUSE"
EVENT_RESUME = "RESUME"
EVENT_THUMBS_UP = "THUMBS_UP"
EVENT_THUMBS_DOWN = "THUMBS_DOWN"
EVENT_TRACKING_LOST = "TRACKING_LOST"
EVENT_BACK = "BACK"                    # deslizamiento_izquierda -> atras (Alt+Izquierda)
EVENT_FORWARD = "FORWARD"              # deslizamiento_derecha -> adelante (Alt+Derecha)
EVENT_MINIMIZE_WINDOW = "MINIMIZE_WINDOW"  # tres dedos hacia abajo: ventana activa
EVENT_RESTORE_WINDOW = "RESTORE_WINDOW"    # tres dedos hacia arriba: última ventana minimizada por el motor

# --- Hipótesis iniciales (no medidas) ---
PINCH_CONFIRM_FRAMES = 3       # muestras consecutivas dentro del umbral para confirmar una pinza
PINCH_CONFIRM_MS = 60.0        # y tiempo mínimo desde la primera muestra
PINCH_RELEASE_FRAMES = 2       # muestras consecutivas fuera del umbral para soltar la pinza
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
# Puño (pausa): puntas a menos de esta fracción de la palma de su articulación MCP, confirmado en el
# tiempo y con la mano quieta. Hipótesis sin calibrar con cámara real.
FIST_TIP_RATIO = 0.45
FIST_CONFIRM_FRAMES = 6
FIST_CONFIRM_MS = 250.0
FIST_STILL_PALM = 0.05


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
    gesture: str = "NONE"  # POINTER, PINCH, DRAG, SCROLL, PAUSE, FIST_HOLD, PULGAR, NONE
    paused: bool = False
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


def _dist2d(a: Point3D, b: Point3D) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


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


def _is_fist_pose(lms: list[Point3D], scale: float) -> bool:
    """Puño: los cuatro dedos plegados y cada punta cerca de la palma (no solo más cerca de la muñeca)."""
    for tip, mcp in ((8, 5), (12, 9), (16, 13), (20, 17)):
        if _dist2d(lms[tip], lms[mcp]) > FIST_TIP_RATIO * scale:
            return False
    return not any(
        _is_finger_extended(lms, tip, pip, mcp)
        for tip, pip, mcp in ((8, 6, 5), (12, 10, 9), (16, 14, 13), (20, 18, 17))
    )


class GestureInterpreter:
    """Stateful gesture recognizer transforming 21 landmarks into logical events."""

    def __init__(self, config: EngineConfig | None = None) -> None:
        self.config = config or EngineConfig()
        self.paused: bool = False
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
        self._scroll_start_ms: float | None = None
        self._scroll_anchor: tuple[float, float] | None = None
        self._scroll_last_ms: float = 0.0
        self._scroll_pending: float = 0.0     # unidades pendientes de emitir (limitadas por velocidad)
        self._scroll_accum: float = 0.0       # fracción de muesca aún no emitida
        self._missing_frames: int = 0
        self._tracking_lost_emitted: bool = False
        self._fist_count: int = 0
        self._fist_first_ms: float | None = None
        self._fist_anchor: tuple[float, float] | None = None
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
        self._swipe_last_xy: tuple[float, float] | None = None
        self._swipe_still_ms: float | None = None
        self._swipe_lost_ms: float | None = None
        self._swipe_locked: bool = False
        self._swipe_fired_ms: float = -1e9
        self.telemetry = InterpreterTelemetry()

    # ------------------------------------------------------------------ control

    def update_config(self, config: EngineConfig) -> list[LogicalEvent]:
        """Aplica una configuración nueva. Antes libera cualquier botón retenido y limpia el estado
        de pinza y scroll, porque cualquier cambio puede hacer incompatible el gesto en curso."""
        events = self._release_pointer_state("config_change")
        self._reset_scroll()
        self._cancel_candidates()
        self.config = config
        return events

    def set_paused(self, paused: bool, now_ms: float = 0.0) -> list[LogicalEvent]:
        events = self._release_pointer_state("pause")
        self._reset_scroll()
        self._cancel_candidates()
        if paused != self.paused:
            self.paused = paused
            events.append(LogicalEvent(EVENT_PAUSE if paused else EVENT_RESUME, {"timestamp_ms": now_ms}))
        self.telemetry.paused = self.paused
        return events

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
        self._scroll_frames = 0
        self._scroll_start_ms = None
        self._scroll_anchor = None
        self._scroll_pending = 0.0
        self._scroll_accum = 0.0

    def _fist_confirmed(self, candidate: bool, palm_x: float, palm_y: float, scale: float, now_ms: float) -> bool:
        """Confirma un puño: postura sostenida durante varias muestras y tiempo, con la palma quieta."""
        if not candidate:
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
            self._fist_first_ms = now_ms
            self._fist_anchor = (palm_x, palm_y)
            self._fist_count = 0
            return False
        self._fist_count += 1
        return _confirmed(self._fist_count, self._fist_first_ms, now_ms, FIST_CONFIRM_FRAMES, FIST_CONFIRM_MS)

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

    def _swipe_restart(self, cx: float, cy: float, now_ms: float) -> None:
        self._swipe_start_ms = now_ms
        self._swipe_x0 = cx
        self._swipe_y0 = cy
        self._swipe_min_x = cx
        self._swipe_max_x = cx

    def _swipe_step(self, pose: bool, cx: float, cy: float, scale: float, now_ms: float) -> list[LogicalEvent]:
        """Barrido con palma abierta: una acción por barrido, con rearme por quietud y cooldown."""
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

        if self._swipe_start_ms is None or (now_ms - self._swipe_start_ms) > SWIPE_WINDOW_MS:
            self._swipe_restart(cx, cy, now_ms)
            return events

        self._swipe_min_x = min(self._swipe_min_x, cx)
        self._swipe_max_x = max(self._swipe_max_x, cx)
        dx = (cx - self._swipe_x0) / scale
        dy = (cy - self._swipe_y0) / scale
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

        kind: str | None = None
        if dx < 0 and self.config.swipe_left_enabled:
            kind = EVENT_BACK
        elif dx > 0 and self.config.swipe_right_enabled:
            kind = EVENT_FORWARD
        if kind is None:
            self._swipe_restart(cx, cy, now_ms)
            return events
        events.append(LogicalEvent(kind, {"dx_palm": round(dx, 3)}))
        self._swipe_locked = True
        self._swipe_fired_ms = now_ms
        self._swipe_start_ms = None
        return events

    # ------------------------------------------------------------ mapping utils

    def _map_to_screen_norm(self, raw_x: float, raw_y: float) -> tuple[float, float]:
        """Maps normalized camera coordinates inside active_bounds to [0.0 .. 1.0] with cursor gain."""
        x_min, x_max, y_min, y_max = self.config.active_bounds
        span_x = max(0.18, x_max - x_min)
        span_y = max(0.18, y_max - y_min)

        nx = (raw_x - x_min) / span_x
        ny = (raw_y - y_min) / span_y

        gain = self.config.cursor_gain
        nx = 0.5 + (nx - 0.5) * gain
        ny = 0.5 + (ny - 0.5) * gain
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

    # ---------------------------------------------------------- main frame

    def process_frame(self, hand: HandLandmarks | None, now_ms: float) -> list[LogicalEvent]:
        events: list[LogicalEvent] = []
        now_sec = now_ms / 1000.0

        # 1. Missing hand or low confidence
        if hand is None or hand.confidence < self.config.min_detection_confidence:
            self._missing_frames += 1
            self._fist_start_ms = None
            self._reset_scroll()
            self._cancel_candidates()
            if self._missing_frames >= self.config.tracking_loss_frames:
                self._filter_x.reset()
                self._filter_y.reset()
                events.extend(self._release_pointer_state("tracking_lost"))
                if not self._tracking_lost_emitted:
                    events.append(LogicalEvent(EVENT_TRACKING_LOST))
                    self._tracking_lost_emitted = True
                self.telemetry = InterpreterTelemetry(hand_detected=False, gesture="NONE", paused=self.paused)
            return events

        self._missing_frames = 0
        self._tracking_lost_emitted = False
        lms = hand.landmarks
        compact_lms = [[round(p.x, 3), round(p.y, 3)] for p in lms[:21]]

        # 2. Palm scale, pinch ratio, finger states
        scale = _palm_scale(lms)
        pinch_dist = _dist2d(lms[4], lms[8])
        pinch_ratio = round(pinch_dist / scale, 4)
        pinch_px = int(round(pinch_dist * 640))

        index_ext = _is_finger_extended(lms, 8, 6, 5)
        middle_ext = _is_finger_extended(lms, 12, 10, 9)
        ring_ext = _is_finger_extended(lms, 16, 14, 13)
        pinky_ext = _is_finger_extended(lms, 20, 18, 17)

        ring_folded = _is_finger_folded(lms, 16, 14, 13)
        pinky_folded = _is_finger_folded(lms, 20, 18, 17)

        raw_ax, raw_ay = self._compute_skeletal_anchor(lms)

        # 3. Puño: transición de parada. Si había arrastre o pinza, se liberan sin clic.
        fist_palm_x = (lms[0].x + lms[5].x + lms[9].x + lms[17].x) * 0.25
        fist_palm_y = (lms[0].y + lms[5].y + lms[9].y + lms[17].y) * 0.25
        is_fist = self._fist_confirmed(_is_fist_pose(lms, scale), fist_palm_x, fist_palm_y, scale, now_ms)
        if is_fist:
            events.extend(self._release_pointer_state("fist"))
            self._reset_scroll()
            thumb_mcp = lms[2]
            thumb_tip = lms[4]
            index_mcp = lms[5]
            thumb_out_dist = _dist2d(thumb_tip, index_mcp) / scale
            dy_thumb = (thumb_mcp.y - thumb_tip.y) / scale
            if thumb_out_dist > 0.72 and abs(dy_thumb) > 0.42:
                # Pulgar extendido: se detecta y se muestra en telemetría, sin acción asociada.
                self._fist_start_ms = None
                self.telemetry = self._telemetry(hand, "PULGAR", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                return events

            if self._fist_start_ms is None:
                self._fist_start_ms = now_ms
                self._fist_toggled_in_hold = False
            elif (not self._fist_toggled_in_hold) and (now_ms - self._fist_start_ms >= self.config.pause_hold_ms):
                # Reanudar siempre permitido; iniciar pausa requiere fist_pause_enabled.
                if self.paused or self.config.fist_pause_enabled:
                    self._fist_toggled_in_hold = True
                    self.paused = not self.paused
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

        # 4. Pinza: estado confirmado o candidato. Se evalúa antes del scroll para que pinza y dos dedos
        #    sean excluyentes por la relación pinza/palma.
        pinch_is_active = self._pinching or self._pinch_candidate_count > 0
        palm_cx = (lms[0].x + lms[5].x + lms[9].x + lms[17].x) * 0.25
        palm_cy = (lms[0].y + lms[5].y + lms[9].y + lms[17].y) * 0.25

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
                and pinch_ratio > self.config.pinch_exit_ratio
            )
            events.extend(self._window_step(three_pose, palm_cy, scale, now_ms))
            if three_pose:
                self.telemetry = self._telemetry(hand, "TRES_DEDOS", pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
                return events

        # 5. Dos dedos (scroll): postura confirmada + movimiento vertical fuera de la zona muerta.
        pose = (
            self.config.scroll_enabled
            and index_ext
            and middle_ext
            and (not ring_ext)
            and (not pinky_ext)
            and ring_folded
            and pinky_folded
            and pinch_ratio > self.config.pinch_exit_ratio
            and (not self._dragging)
            and (not pinch_is_active)
        )
        if pose:
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

        self._reset_scroll()

        # 5b. Barrido horizontal con palma abierta: una acción por barrido. El puntero sigue activo.
        swipe_flags = self.config.swipe_left_enabled or self.config.swipe_right_enabled
        open_pose = (
            swipe_flags
            and index_ext
            and middle_ext
            and ring_ext
            and pinky_ext
            and (not self._dragging)
            and (not pinch_is_active)
            and pinch_ratio > self.config.pinch_exit_ratio
        )
        events.extend(self._swipe_step(open_pose, palm_cx, palm_cy, scale, now_ms))

        # 6. Puntero con filtro One-Euro adaptativo
        target_x, target_y = self._map_to_screen_norm(raw_ax, raw_ay)
        filtered_x = self._filter_x.filter(target_x, now_sec, min_cutoff=self.config.min_cutoff_hz, beta=self.config.beta_speed)
        filtered_y = self._filter_y.filter(target_y, now_sec, min_cutoff=self.config.min_cutoff_hz, beta=self.config.beta_speed)

        active_gesture = "POINTER"
        enter_ratio = self.config.pinch_enter_ratio
        exit_ratio = self.config.pinch_exit_ratio
        is_entering_pinch = (pinch_ratio <= enter_ratio) or (pinch_dist <= self.config.pinch_enter_threshold)
        is_exiting_pinch = (pinch_ratio >= exit_ratio) and (pinch_dist >= self.config.pinch_exit_threshold)

        if self.config.pinch_enabled:
            if not self._pinching:
                if is_entering_pinch:
                    if self._pinch_candidate_count == 0:
                        self._pinch_candidate_start_ms = now_ms
                        # Bloquear el cursor desde la primera muestra: el clic no debe desplazarlo.
                        self._pinch_locked_pos = (
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
                else:
                    # Ruido de una muestra o pinza que no se mantiene: se descarta sin clic.
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
                elif self.config.drag_enabled and (not self._dragging) and held_ms >= self.config.drag_hold_ms:
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
                self._smoothed_x, self._smoothed_y = self._pinch_locked_pos
            elif self._smoothed_x is None or self._smoothed_y is None:
                self._smoothed_x, self._smoothed_y = filtered_x, filtered_y
                events.append(LogicalEvent(EVENT_MOVE_CURSOR, {"x": round(self._smoothed_x, 4), "y": round(self._smoothed_y, 4)}))
            else:
                dx = filtered_x - self._smoothed_x
                dy = filtered_y - self._smoothed_y
                if math.hypot(dx, dy) >= self.config.deadzone_norm:
                    self._smoothed_x = filtered_x
                    self._smoothed_y = filtered_y
                    events.append(LogicalEvent(EVENT_MOVE_CURSOR, {"x": round(self._smoothed_x, 4), "y": round(self._smoothed_y, 4)}))
        else:
            self._smoothed_x = filtered_x
            self._smoothed_y = filtered_y

        self.telemetry = self._telemetry(hand, active_gesture, pinch_px, pinch_ratio, raw_ax, raw_ay, compact_lms)
        return events
