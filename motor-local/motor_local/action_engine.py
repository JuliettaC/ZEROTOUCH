"""Layer 4: Logical Action Engine.

Enforces safety requirements:
- Starts in OBSERVATION (simulation) mode by default; real OS control requires explicit activation.
- Maintains an allowlist of logical events; never executes arbitrary shell/OS commands.
- Releases held mouse buttons immediately on TRACKING_LOST, PAUSE, END_DRAG, mode switch, or emergency stop.
"""

from __future__ import annotations

from typing import Iterable

from .interpreter import (
    EVENT_BACK,
    EVENT_END_DRAG,
    EVENT_FORWARD,
    EVENT_LEFT_CLICK,
    EVENT_MINIMIZE_WINDOW,
    EVENT_MOVE_CURSOR,
    EVENT_PAUSE,
    EVENT_RESTORE_WINDOW,
    EVENT_RESUME,
    EVENT_SCROLL,
    EVENT_START_DRAG,
    EVENT_THUMBS_DOWN,
    EVENT_THUMBS_UP,
    EVENT_TRACKING_LOST,
    LogicalEvent,
)
from .os_adapter import OSAdapterProtocol
from .window_control import WindowActions, WindowResult

MODE_OBSERVATION = "OBSERVATION"
MODE_CONTROL = "CONTROL"

ALLOWED_EVENTS = frozenset(
    {
        EVENT_MOVE_CURSOR,
        EVENT_LEFT_CLICK,
        EVENT_SCROLL,
        EVENT_START_DRAG,
        EVENT_END_DRAG,
        EVENT_PAUSE,
        EVENT_RESUME,
        EVENT_THUMBS_UP,
        EVENT_THUMBS_DOWN,
        EVENT_TRACKING_LOST,
        EVENT_BACK,
        EVENT_FORWARD,
        EVENT_MINIMIZE_WINDOW,
        EVENT_RESTORE_WINDOW,
    }
)

# Eventos de acción discreta que se ejecutan solo en CONTROL y nunca como liberación.
_DISCRETE_KEY_COMBOS = {EVENT_BACK: ("alt", "left"), EVENT_FORWARD: ("alt", "right")}


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
        self.last_dispatched_event: str = "NONE"
        self.last_window_result: str = "NONE"
        self.total_clicks: int = 0
        self.total_scrolls: int = 0

    def set_mode(self, mode: str) -> str:
        """Switches between OBSERVATION (simulation) and CONTROL (real OS input)."""
        normalized = str(mode).upper().strip()
        if normalized not in (MODE_OBSERVATION, MODE_CONTROL):
            return self.mode
        if normalized == MODE_OBSERVATION and self.mode == MODE_CONTROL:
            self.adapter.release_all()
        if normalized == MODE_CONTROL:
            self.emergency_stopped = False
        self.mode = normalized
        return self.mode

    def trigger_emergency_stop(self) -> None:
        """Immediately releases held buttons and reverts to OBSERVATION mode."""
        self.emergency_stopped = True
        self.mode = MODE_OBSERVATION
        self.adapter.release_all()
        self.last_dispatched_event = "EMERGENCY_STOP"

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
            if evt.type in (EVENT_TRACKING_LOST, EVENT_PAUSE, EVENT_END_DRAG):
                self.adapter.release_all()
                continue

            # In OBSERVATION mode (or after emergency stop), never inject real OS events
            if self.mode != MODE_CONTROL or self.emergency_stopped:
                continue

            if evt.type == EVENT_MOVE_CURSOR:
                self.adapter.move_cursor(float(evt.payload.get("x", 0.5)), float(evt.payload.get("y", 0.5)))
            elif evt.type == EVENT_LEFT_CLICK:
                self.adapter.left_click()
            elif evt.type == EVENT_START_DRAG:
                self.adapter.start_drag()
            elif evt.type == EVENT_SCROLL:
                self.adapter.scroll(int(evt.payload.get("dy", 0)))
            elif evt.type in _DISCRETE_KEY_COMBOS:
                self.adapter.key_combo(_DISCRETE_KEY_COMBOS[evt.type])
            elif evt.type in (EVENT_MINIMIZE_WINDOW, EVENT_RESTORE_WINDOW):
                self._window_event(evt.type)

        return handled

    def shutdown(self) -> None:
        self.mode = MODE_OBSERVATION
        self.adapter.close()
