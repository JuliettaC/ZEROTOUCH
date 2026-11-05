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
        self.telemetry = InterpreterTelemetry()

    # ------------------------------------------------------------------ control

    def update_config(self, config: EngineConfig) -> list[LogicalEvent]:
        """Aplica una configuración nueva. Antes libera cualquier botón retenido y limpia el estado
        de pinza y scroll, porque cualquier cambio puede hacer incompatible el gesto en curso."""
        events = self._release_pointer_state("config_change")
        self._reset_scroll()
        self.config = config
        return events

    def set_paused(self, paused: bool, now_ms: float = 0.0) -> list[LogicalEvent]:
        events = self._release_pointer_state("pause")
        self._reset_scroll()
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

        index_folded = _is_finger_folded(lms, 8, 6, 5)
        middle_folded = _is_finger_folded(lms, 12, 10, 9)
        ring_folded = _is_finger_folded(lms, 16, 14, 13)
        pinky_folded = _is_finger_folded(lms, 20, 18, 17)

        raw_ax, raw_ay = self._compute_skeletal_anchor(lms)

        # 3. Puño: transición de parada. Si había arrastre o pinza, se liberan sin clic.
        is_fist = index_folded and middle_folded and ring_folded and pinky_folded and (not index_ext) and (not middle_ext)
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
