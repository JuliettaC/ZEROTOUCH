"""Layer 4: Logical Action Engine.

Enforces safety requirements:
- Starts in OBSERVATION (simulation) mode by default; real OS control requires explicit activation.
- Maintains an allowlist of logical events; never executes arbitrary shell/OS commands. The only
  keyboard output is the fixed set of combinations in capacidades.json (`teclas_permitidas`) plus,
  with the Air-Swipe keyboard open, printable text and the edit keys backspace/enter/space.
- Releases held mouse buttons immediately on TRACKING_LOST, PAUSE, END_DRAG, mode switch, or emergency stop.
- Application-level actions (timer, precision, navigation, Air-Swipe trace) never touch the OS:
  they are queued as `app_events` for the ZeroTouch interface.
"""

from __future__ import annotations

from typing import Any, Iterable

from .capabilities import ALLOWED_KEYS, DEVICE_KEYS
from .interpreter import (
    EVENT_AIRSWIPE_TRACE,
    EVENT_BACK,
    EVENT_CANCEL,
    EVENT_CONFIRM,
    EVENT_END_DRAG,
    EVENT_FORWARD,
    EVENT_LEFT_CLICK,
    EVENT_MEDIA_NEXT,
    EVENT_MEDIA_PLAY_PAUSE,
    EVENT_MINIMIZE_WINDOW,
    EVENT_MOVE_CURSOR,
    EVENT_NAVIGATION,
    EVENT_NEXT_TAB,
    EVENT_PAUSE,
    EVENT_PRECISION,
    EVENT_PREV_TAB,
    EVENT_RESTORE_WINDOW,
    EVENT_RESUME,
    EVENT_RIGHT_CLICK,
    EVENT_SCROLL,
    EVENT_START_DRAG,
    EVENT_THUMBS_DOWN,
    EVENT_THUMBS_UP,
    EVENT_TIMER,
    EVENT_TRACKING_LOST,
    LogicalEvent,
)
from .os_adapter import EDIT_KEYS, OSAdapterProtocol, validate_text
from .window_control import WindowActions, WindowResult

MODE_OBSERVATION = "OBSERVATION"
MODE_CONTROL = "CONTROL"

# Eventos que llegan al teclado del SO y su combinación permitida (única fuente: el contrato).
_KEY_EVENTS: dict[str, tuple[str, ...]] = {
    EVENT_BACK: ALLOWED_KEYS["atras"],
    EVENT_FORWARD: ALLOWED_KEYS["adelante"],
    EVENT_CONFIRM: ALLOWED_KEYS["confirmar"],
    EVENT_CANCEL: ALLOWED_KEYS["cancelar"],
    EVENT_MEDIA_PLAY_PAUSE: ALLOWED_KEYS["multimedia_play_pause"],
    EVENT_MEDIA_NEXT: ALLOWED_KEYS["multimedia_siguiente"],
    # Gestos locales del equipo (contrato `teclas_equipo`).
    EVENT_NEXT_TAB: DEVICE_KEYS["pestana_siguiente"],
    EVENT_PREV_TAB: DEVICE_KEYS["pestana_anterior"],
}
# Con el teclado Air-Swipe abierto, estas acciones las interpreta la interfaz (aceptar candidato,
# cancelar, espacio, borrar) y NO se inyectan al sistema operativo.
_AIRSWIPE_REDIRECTED = frozenset({EVENT_BACK, EVENT_FORWARD, EVENT_CONFIRM, EVENT_CANCEL})
# Eventos que solo informan a la interfaz de ZeroTouch.
_APP_EVENTS = frozenset({EVENT_TIMER, EVENT_PRECISION, EVENT_NAVIGATION, EVENT_AIRSWIPE_TRACE})
# Acciones que SÍ llegan al SO pero de las que la interfaz muestra un aviso (multimedia y ventanas):
# además de ejecutarse, se encolan como evento informativo con `injected` (y `result` en ventanas).
_FEEDBACK_EVENTS = frozenset({EVENT_MEDIA_PLAY_PAUSE, EVENT_MEDIA_NEXT, EVENT_MINIMIZE_WINDOW, EVENT_RESTORE_WINDOW, EVENT_NEXT_TAB, EVENT_PREV_TAB})

ALLOWED_EVENTS = frozenset(
    {
        EVENT_MOVE_CURSOR,
        EVENT_LEFT_CLICK,
        EVENT_RIGHT_CLICK,
        EVENT_SCROLL,
        EVENT_START_DRAG,
        EVENT_END_DRAG,
        EVENT_PAUSE,
        EVENT_RESUME,
        EVENT_THUMBS_UP,
        EVENT_THUMBS_DOWN,
        EVENT_TRACKING_LOST,
        EVENT_MINIMIZE_WINDOW,
        EVENT_RESTORE_WINDOW,
        *_KEY_EVENTS,
        *_APP_EVENTS,
    }
)

# Compatibilidad con pruebas anteriores.
_DISCRETE_KEY_COMBOS = {EVENT_BACK: ALLOWED_KEYS["atras"], EVENT_FORWARD: ALLOWED_KEYS["adelante"]}


class LogicalActionEngine:
    """Routes validated logical events to the OS adapter only when in CONTROL mode."""

    def __init__(
        self,
        adapter: OSAdapterProtocol,
        initial_mode: str = MODE_OBSERVATION,
        window_actions: WindowActions | None = None,
    ) -> None:
        self.adapter = adapter
        self.window_actions = window_actions
        self.mode: str = initial_mode if initial_mode in (MODE_OBSERVATION, MODE_CONTROL) else MODE_OBSERVATION
        self.emergency_stopped: bool = False
        self.paused: bool = False
        self.external_hold: bool = False
        self.tracking_lost: bool = False
        self.airswipe_active: bool = False
        self.last_dispatched_event: str = "NONE"
        self.last_window_result: str = "NONE"
        self.total_clicks: int = 0
        self.total_scrolls: int = 0
        self.app_events: list[dict[str, Any]] = []

    def set_mode(self, mode: str) -> str:
        """Switches between OBSERVATION (simulation) and CONTROL (real OS input)."""
        normalized = str(mode).upper().strip()
        if normalized not in (MODE_OBSERVATION, MODE_CONTROL):
            return self.mode
        if normalized == MODE_OBSERVATION and self.mode == MODE_CONTROL:
            self.adapter.release_all()
        if normalized == MODE_CONTROL:
            self.emergency_stopped = False
            self.paused = False
            self.tracking_lost = False
        self.mode = normalized
        return self.mode

    def trigger_emergency_stop(self) -> None:
        """Immediately releases held buttons and reverts to OBSERVATION mode."""
        self.emergency_stopped = True
        self.paused = True
        self.airswipe_active = False
        self.mode = MODE_OBSERVATION
        self.adapter.release_all()
        self.last_dispatched_event = "EMERGENCY_STOP"

    def set_external_hold(self, hold: bool) -> None:
        """Synchronizes external hold (gaze assistance) state into the action engine."""
        self.external_hold = bool(hold)
        if self.external_hold:
            self.adapter.release_all()

    def set_tracking_lost(self, lost: bool) -> None:
        """Synchronizes hand tracking loss state into the action engine."""
        self.tracking_lost = bool(lost)
        if self.tracking_lost:
            self.adapter.release_all()

    def _window_event(self, evt_type: str) -> None:
        if self.window_actions is None:
            self.last_window_result = "UNAVAILABLE"
            return
        result: WindowResult = (
            self.window_actions.minimize_target()
            if evt_type == EVENT_MINIMIZE_WINDOW
            else self.window_actions.restore_last()
        )
        self.last_window_result = result.code

    def _queue_app_event(self, evt: LogicalEvent) -> None:
        self.app_events.append({"event": evt.type, **evt.payload})

    def take_app_events(self) -> list[dict[str, Any]]:
        events, self.app_events = self.app_events, []
        return events

    @property
    def can_inject(self) -> bool:
        return (
            self.mode == MODE_CONTROL
            and not self.emergency_stopped
            and not self.paused
            and not self.external_hold
            and not self.tracking_lost
        )

    def _injection_gate(self) -> tuple[bool, str, str]:
        """Centralized check for IPC keyboard injection (TYPE_TEXT / PRESS_KEY)."""
        if not self.airswipe_active:
            return False, "AIRSWIPE_INACTIVE", "El teclado Air-Swipe no está abierto."
        if self.mode != MODE_CONTROL or self.emergency_stopped:
            return False, "CONTROL_REQUIRED", "Activa el control para escribir en otras aplicaciones."
        if self.paused:
            return False, "INTERACTION_PAUSED", "El control gestual está en pausa."
        if self.external_hold:
            return False, "GAZE_HOLD", "Interacción retenida por asistencia de mirada."
        if self.tracking_lost:
            return False, "TRACKING_LOST", "Seguimiento de mano perdido; muestra la mano a la cámara."
        return True, "", ""

    def dispatch(self, events: Iterable[LogicalEvent]) -> list[str]:
        """Processes logical events, returning the list of event names handled."""
        handled: list[str] = []
        for evt in events:
            if evt.type not in ALLOWED_EVENTS:
                continue

            handled.append(evt.type)
            if evt.type != EVENT_MOVE_CURSOR:
                self.last_dispatched_event = evt.type

            if evt.type == EVENT_LEFT_CLICK:
                self.total_clicks += 1
            elif evt.type == EVENT_SCROLL:
                self.total_scrolls += 1

            # Safety events always release held buttons, in any mode and after emergency stop.
            if evt.type == EVENT_PAUSE:
                self.paused = True
                self.adapter.release_all()
                continue
            if evt.type == EVENT_RESUME:
                self.paused = False
                continue
            if evt.type == EVENT_TRACKING_LOST:
                self.tracking_lost = True
                self.adapter.release_all()
                continue
            if evt.type == EVENT_END_DRAG:
                self.adapter.release_all()
                continue

            # Any active hand event clears a prior tracking-loss lock.
            self.tracking_lost = False

            # Application events reach the interface in any mode: they never inject OS input.
            if evt.type in _APP_EVENTS:
                self._queue_app_event(evt)
                continue
            if self.airswipe_active and evt.type in _AIRSWIPE_REDIRECTED:
                self._queue_app_event(evt)
                continue

            # When injection is blocked (OBSERVATION, emergency stop, pause, gaze hold, tracking lost), never inject real OS events
            if not self.can_inject:
                if evt.type in _FEEDBACK_EVENTS:
                    self.app_events.append({"event": evt.type, "injected": False, **evt.payload})
                continue

            if evt.type == EVENT_MOVE_CURSOR:
                self.adapter.move_cursor(float(evt.payload.get("x", 0.5)), float(evt.payload.get("y", 0.5)))
            elif evt.type == EVENT_LEFT_CLICK:
                self.adapter.left_click()
            elif evt.type == EVENT_RIGHT_CLICK:
                self.adapter.right_click()
            elif evt.type == EVENT_START_DRAG:
                self.adapter.start_drag()
            elif evt.type == EVENT_SCROLL:
                self.adapter.scroll(int(evt.payload.get("dy", 0)))
            elif evt.type in _KEY_EVENTS:
                self.adapter.key_combo(_KEY_EVENTS[evt.type])
            elif evt.type in (EVENT_MINIMIZE_WINDOW, EVENT_RESTORE_WINDOW):
                self._window_event(evt.type)
            if evt.type in _FEEDBACK_EVENTS:
                feedback: dict[str, Any] = {"event": evt.type, "injected": True, **evt.payload}
                if evt.type in (EVENT_MINIMIZE_WINDOW, EVENT_RESTORE_WINDOW):
                    feedback["result"] = self.last_window_result
                self.app_events.append(feedback)

        return handled

    # ----------------------------------------------------------- Air-Swipe

    def type_text(self, text: Any) -> tuple[bool, str, str]:
        """Escribe texto en la aplicación activa. Solo con CONTROL activo, sin bloqueos y teclado Air-Swipe abierto.
        Devuelve (ok, código, mensaje). Nunca registra el texto."""
        ok, message = validate_text(text)
        if not ok:
            return False, "TEXT_INVALID", message
        gate_ok, code, gate_msg = self._injection_gate()
        if not gate_ok:
            return False, code, gate_msg
        self.adapter.type_text(str(text))
        self.last_dispatched_event = "TYPE_TEXT"
        return True, "", ""

    def press_edit_key(self, key: Any) -> tuple[bool, str, str]:
        """Pulsa backspace, enter o space (edición Air-Swipe). Mismas condiciones que type_text."""
        if not isinstance(key, str) or key not in EDIT_KEYS:
            return False, "KEY_NOT_ALLOWED", "Tecla no permitida."
        gate_ok, code, gate_msg = self._injection_gate()
        if not gate_ok:
            return False, code, gate_msg
        self.adapter.press_key(key)
        self.last_dispatched_event = f"KEY_{key.upper()}"
        return True, "", ""

    def shutdown(self) -> None:
        self.mode = MODE_OBSERVATION
        self.adapter.close()
