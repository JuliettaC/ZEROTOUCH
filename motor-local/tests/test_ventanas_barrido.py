"""Gestos de ventana (tres dedos) y barrido horizontal (palma abierta). Todo sintético.

Los controladores de ventana son simulados; la prueba de Win32 es solo de lectura.
"""

from __future__ import annotations

import sys

import pytest

from motor_local.action_engine import MODE_CONTROL, MODE_OBSERVATION, LogicalActionEngine
from motor_local.api_export import load_api_export
from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D
from motor_local.interpreter import (
    EVENT_BACK,
    EVENT_FORWARD,
    EVENT_MINIMIZE_WINDOW,
    EVENT_RESTORE_WINDOW,
    GestureInterpreter,
)
from motor_local.os_adapter import MockOSAdapter
from motor_local.window_control import MockWindowController, WindowActions, WindowRef

from tests.test_api_export import _document
from tests.test_engine import make_open_palm


def make_three_fingers(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    """Índice, medio y anular extendidos; meñique plegado; pinza abierta."""
    hand = make_open_palm(cx, cy, pinch_dist=0.14)
    lms = list(hand.landmarks)
    lms[20] = Point3D(cx, cy + 0.09)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def open_hand(cx: float = 0.5, cy: float = 0.5) -> HandLandmarks:
    return make_open_palm(cx, cy, pinch_dist=0.14)


def _run(interp: GestureInterpreter, frames) -> list[str]:
    seen: list[str] = []
    for hand, t in frames:
        seen.extend(e.type for e in interp.process_frame(hand, now_ms=t))
    return seen


# --------------------------------------------------------------- ventanas

def _window_setup():
    controller = MockWindowController()
    own = WindowRef(hwnd=10, pid=999, started=1)
    target = WindowRef(hwnd=20, pid=200, started=2)
    other = WindowRef(hwnd=30, pid=300, started=3)
    controller.add(own)
    controller.add(target, foreground=True)
    controller.add(other)
    return controller, WindowActions(controller, own_pid=999), target, other


def test_minimize_targets_only_the_foreground_window_once() -> None:
    controller, actions, target, other = _window_setup()
    assert actions.minimize_target().code == "MINIMIZED"
    assert target in controller.minimized
    assert other not in controller.minimized
    assert actions.minimize_target().code == "ALREADY_MINIMIZED"
    assert [entry for entry in controller.log if entry[0] == "MINIMIZE"] == [("MINIMIZE", target.hwnd)]


def test_own_window_is_never_minimized() -> None:
    controller, actions, target, _ = _window_setup()
    controller.foreground_ref = WindowRef(hwnd=10, pid=999, started=1)
    assert actions.minimize_target().code == "OWN_WINDOW"
    assert controller.log == []


def test_restore_returns_last_minimized_window_and_is_consumed() -> None:
    controller, actions, target, _ = _window_setup()
    actions.minimize_target()
    result = actions.restore_last()
    assert result.ok and result.code == "RESTORED" and result.focused
    assert target not in controller.minimized
    assert actions.restore_last().code == "NO_LAST_WINDOW"


def test_closed_window_is_not_replaced_by_another_one() -> None:
    controller, actions, target, other = _window_setup()
    actions.minimize_target()
    controller.close(target)
    result = actions.restore_last()
    assert result.code == "WINDOW_GONE"
    assert other not in controller.minimized
    assert controller.log.count(("RESTORE", other.hwnd)) == 0


def test_reused_hwnd_with_another_process_is_not_restored() -> None:
    controller, actions, target, _ = _window_setup()
    actions.minimize_target()
    controller.close(target)
    impostor = WindowRef(hwnd=target.hwnd, pid=777, started=55)  # mismo HWND, otro proceso
    controller.add(impostor)
    controller.minimized.add(impostor)
    assert actions.restore_last().code == "WINDOW_GONE"
    assert impostor in controller.minimized


def test_window_restored_by_the_user_is_left_alone() -> None:
    controller, actions, target, _ = _window_setup()
    actions.minimize_target()
    controller.minimized.discard(target)
    assert actions.restore_last().code == "NOT_MINIMIZED"


def test_win32_controller_reads_foreground_without_changing_windows() -> None:
    if sys.platform != "win32":
        pytest.skip("Win32 solo en Windows")
    from motor_local.window_control import Win32WindowController

    ref = Win32WindowController().foreground()
    assert ref is None or (isinstance(ref, WindowRef) and ref.pid > 0)


# --------------------------------------------------------- tres dedos

def _window_config(**kw) -> EngineConfig:
    return EngineConfig(window_gestures_enabled=True, **kw)


def test_three_fingers_are_ignored_unless_window_gestures_are_enabled() -> None:
    interp = GestureInterpreter(EngineConfig())
    seen = _run(interp, [(make_three_fingers(0.5, 0.5), t) for t in (0.0, 33.0, 66.0)]
                + [(make_three_fingers(0.5, 0.6), 100.0)])
    assert EVENT_MINIMIZE_WINDOW not in seen


def test_three_fingers_down_minimizes_once_while_held() -> None:
    interp = GestureInterpreter(_window_config())
    frames = [(make_three_fingers(0.5, 0.5), t) for t in (0.0, 33.0, 66.0)]
    frames += [(make_three_fingers(0.5, 0.6), 100.0)]
    frames += [(make_three_fingers(0.5, 0.6), t) for t in range(133, 1000, 33)]
    seen = _run(interp, frames)
    assert seen.count(EVENT_MINIMIZE_WINDOW) == 1
    assert EVENT_RESTORE_WINDOW not in seen


def test_three_fingers_up_restores_after_rearm() -> None:
    interp = GestureInterpreter(_window_config())
    frames = [(make_three_fingers(0.5, 0.5), t) for t in (0.0, 33.0, 66.0, 100.0)]
    frames += [(make_three_fingers(0.5, 0.6), 133.0)]          # minimiza
    frames += [(open_hand(0.5, 0.6), t) for t in range(166, 500, 33)]  # postura soltada: rearme
    frames += [(make_three_fingers(0.5, 0.6), 1100.0), (make_three_fingers(0.5, 0.6), 1133.0),
               (make_three_fingers(0.5, 0.6), 1166.0), (make_three_fingers(0.5, 0.4), 1200.0)]  # sube
    seen = _run(interp, frames)
    assert seen.count(EVENT_MINIMIZE_WINDOW) == 1
    assert seen.count(EVENT_RESTORE_WINDOW) == 1


def test_small_three_finger_motion_does_not_act() -> None:
    interp = GestureInterpreter(_window_config())
    frames = [(make_three_fingers(0.5, 0.5 + 0.002 * (i % 2)), 33.0 * i) for i in range(40)]
    assert EVENT_MINIMIZE_WINDOW not in _run(interp, frames)


def test_three_fingers_do_not_click_or_scroll() -> None:
    interp = GestureInterpreter(_window_config())
    seen = _run(interp, [(make_three_fingers(0.5, 0.5 + 0.01 * i), 33.0 * i) for i in range(20)])
    assert "LEFT_CLICK" not in seen and "SCROLL" not in seen and "START_DRAG" not in seen


def test_window_events_reach_the_window_controller_only_in_control() -> None:
    controller, actions, target, _ = _window_setup()
    observation = LogicalActionEngine(MockOSAdapter(), MODE_OBSERVATION, window_actions=actions)
    observation.dispatch(GestureInterpreter(_window_config()).process_frame(None, 0.0))
    from motor_local.interpreter import LogicalEvent

    observation.dispatch([LogicalEvent(EVENT_MINIMIZE_WINDOW)])
    assert controller.log == []
    control = LogicalActionEngine(MockOSAdapter(), MODE_CONTROL, window_actions=actions)
    control.dispatch([LogicalEvent(EVENT_MINIMIZE_WINDOW)])
    assert target in controller.minimized
    assert control.last_window_result == "MINIMIZED"


def test_window_events_report_unavailable_without_controller() -> None:
    from motor_local.interpreter import LogicalEvent

    engine = LogicalActionEngine(MockOSAdapter(), MODE_CONTROL, window_actions=None)
    engine.dispatch([LogicalEvent(EVENT_MINIMIZE_WINDOW)])
    assert engine.last_window_result == "UNAVAILABLE"


# ------------------------------------------------------------ barrido

def _swipe_frames(start: float, step: float, count: int, t0: float = 0.0, dt: float = 33.0, cy: float = 0.5):
    return [(open_hand(start + step * k, cy), t0 + dt * k) for k in range(count + 1)]


def test_swipe_left_fires_back_once_per_motion() -> None:
    interp = GestureInterpreter(EngineConfig())
    seen = _run(interp, _swipe_frames(0.5, -0.03, 10))
    assert seen.count(EVENT_BACK) == 1
    assert EVENT_FORWARD not in seen


def test_swipe_right_fires_forward() -> None:
    interp = GestureInterpreter(EngineConfig())
    seen = _run(interp, _swipe_frames(0.3, 0.03, 10))
    assert seen.count(EVENT_FORWARD) == 1
    assert EVENT_BACK not in seen


def test_slow_drift_does_not_swipe() -> None:
    interp = GestureInterpreter(EngineConfig())
    seen = _run(interp, _swipe_frames(0.5, -0.01, 30, dt=100.0))
    assert EVENT_BACK not in seen


def test_micro_movement_does_not_swipe() -> None:
    interp = GestureInterpreter(EngineConfig())
    seen = _run(interp, [(open_hand(0.5 + 0.01 * (k % 2), 0.5), 33.0 * k) for k in range(30)])
    assert EVENT_BACK not in seen and EVENT_FORWARD not in seen


def test_return_movement_after_partial_swipe_does_not_fire() -> None:
    interp = GestureInterpreter(EngineConfig())
    frames = _swipe_frames(0.5, -0.01, 8)            # 0.08 hacia la izquierda (0,5 palmas)
    last = frames[-1][0]
    frames += [(open_hand(0.42 + 0.01 * k, 0.5), 33.0 * (9 + k)) for k in range(9)]  # vuelve a la derecha
    assert EVENT_BACK not in _run(interp, frames)


def test_disabled_direction_does_not_fire() -> None:
    interp = GestureInterpreter(EngineConfig(swipe_left_enabled=False))
    assert EVENT_BACK not in _run(interp, _swipe_frames(0.5, -0.03, 10))


def test_swipe_rearms_only_after_the_hand_is_still() -> None:
    interp = GestureInterpreter(EngineConfig())
    frames = _swipe_frames(0.5, -0.03, 10)                       # primer barrido
    frames += [(open_hand(0.5 - 0.3 - 0.03 * k, 0.5), 363.0 + 33.0 * k) for k in range(1, 9)]  # sigue moviendo
    frames += [(open_hand(0.5 - 0.6, 0.5), 700.0 + 33.0 * k) for k in range(12)]               # quieta
    frames += [(open_hand(0.5 - 0.6 - 0.03 * k, 0.5), 1200.0 + 33.0 * k) for k in range(1, 11)]  # nuevo barrido
    seen = _run(interp, frames)
    assert seen.count(EVENT_BACK) == 2


def test_swipe_flows_through_action_engine_as_alt_arrow_in_control_only() -> None:
    adapter = MockOSAdapter()
    interp = GestureInterpreter(EngineConfig())
    engine = LogicalActionEngine(adapter, MODE_CONTROL)
    for hand, t in _swipe_frames(0.5, -0.03, 10):
        engine.dispatch(interp.process_frame(hand, now_ms=t))
    assert ("KEY_COMBO", {"keys": ["alt", "left"]}) in adapter.executed_actions
    observed = MockOSAdapter()
    observation = LogicalActionEngine(observed, MODE_OBSERVATION)
    interp2 = GestureInterpreter(EngineConfig())
    for hand, t in _swipe_frames(0.5, -0.03, 10):
        observation.dispatch(interp2.process_frame(hand, now_ms=t))
    assert observed.executed_actions == []


def test_adapter_refuses_key_combinations_outside_the_allowlist() -> None:
    with pytest.raises(ValueError):
        MockOSAdapter().key_combo(("ctrl", "alt", "delete"))


# ------------------------------------------------- DTO con barridos

def test_export_accepts_implemented_swipe_bindings_when_enabled() -> None:
    doc = _document()
    for item in doc["gestos"]:
        if item["gesto_codigo"] == "deslizamiento_izquierda":
            item["habilitado"] = True
    imported = load_api_export(doc)
    assert imported.config.swipe_left_enabled is True
    assert imported.gestures["deslizamiento_izquierda"]["accion_codigo"] == "atras"
