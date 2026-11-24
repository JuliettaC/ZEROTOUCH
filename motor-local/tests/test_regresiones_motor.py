"""Regresiones de seguridad y de gestos del motor (sintéticas, sin cámara ni SO real).

Cubre: observación sin efectos, ruido de un fotograma, liberación al cambiar configuración,
pausa y puño durante arrastre, scroll con signo/zona muerta/cadencia, horizontal sin scroll
y validación de la configuración IPC.
"""

from __future__ import annotations

import pytest

from motor_local.action_engine import MODE_CONTROL, MODE_OBSERVATION, LogicalActionEngine
from motor_local.config import ConfigError, EngineConfig
from motor_local.interpreter import (
    EVENT_END_DRAG,
    EVENT_LEFT_CLICK,
    EVENT_PAUSE,
    EVENT_SCROLL,
    EVENT_START_DRAG,
    GestureInterpreter,
)
from motor_local.os_adapter import MockOSAdapter

from tests.test_engine import armed, make_closed_fist, make_open_palm, make_two_fingers


def _types(events) -> list[str]:
    return [e.type for e in events]


def _feed(interp: GestureInterpreter, engine: LogicalActionEngine, frames) -> list[str]:
    seen: list[str] = []
    for hand, t in frames:
        evts = interp.process_frame(hand, now_ms=t)
        engine.dispatch(evts)
        seen.extend(_types(evts))
    return seen


def test_observation_mode_never_moves_clicks_or_scrolls() -> None:
    interp = armed(EngineConfig())
    mock_os = MockOSAdapter()
    engine = LogicalActionEngine(mock_os, initial_mode=MODE_OBSERVATION)
    frames = [(make_open_palm(0.4, 0.4, pinch_dist=0.14), 0.0)]
    frames += [(make_open_palm(0.5, 0.5, pinch_dist=0.02), 40.0 + 40 * i) for i in range(5)]
    frames += [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 300.0), (make_open_palm(0.5, 0.5, pinch_dist=0.14), 340.0)]
    _feed(interp, engine, frames)
    assert mock_os.executed_actions == []
    assert mock_os.button_held is False


def test_single_noise_frame_never_clicks() -> None:
    interp = armed(EngineConfig(click_cooldown_ms=0))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    seen = _feed(
        interp,
        engine,
        [
            (make_open_palm(0.5, 0.5, pinch_dist=0.14), 0.0),
            (make_open_palm(0.5, 0.5, pinch_dist=0.02), 33.0),   # un único fotograma de pinza
            (make_open_palm(0.5, 0.5, pinch_dist=0.14), 66.0),
            (make_open_palm(0.5, 0.5, pinch_dist=0.14), 100.0),
        ],
    )
    assert EVENT_LEFT_CLICK not in seen
    assert engine.total_clicks == 0


def test_config_change_releases_held_drag_before_applying() -> None:
    cfg = EngineConfig(drag_hold_ms=100, tracking_loss_frames=5)
    interp = armed(cfg)
    mock_os = MockOSAdapter()
    engine = LogicalActionEngine(mock_os, initial_mode=MODE_CONTROL)
    _feed(
        interp,
        engine,
        [(make_open_palm(0.5, 0.5, pinch_dist=0.015), t) for t in (0.0, 40.0, 80.0, 120.0, 160.0)],
    )
    assert mock_os.button_held is True

    # Desactivar la pinza mientras hay arrastre: debe liberar antes de aplicar la nueva configuración.
    evts = interp.update_config(EngineConfig(drag_hold_ms=100, pinch_enabled=False))
    assert EVENT_END_DRAG in _types(evts)
    engine.dispatch(evts)
    assert mock_os.button_held is False
    assert EVENT_LEFT_CLICK not in _types(evts)


def test_pause_during_drag_releases_button() -> None:
    cfg = EngineConfig(drag_hold_ms=100)
    interp = armed(cfg)
    mock_os = MockOSAdapter()
    engine = LogicalActionEngine(mock_os, initial_mode=MODE_CONTROL)
    _feed(interp, engine, [(make_open_palm(0.5, 0.5, pinch_dist=0.015), t) for t in (0.0, 40.0, 80.0, 120.0, 160.0)])
    assert mock_os.button_held is True
    engine.dispatch(interp.set_paused(True, 170.0))
    assert mock_os.button_held is False


def test_closed_fist_during_drag_releases_without_click() -> None:
    cfg = EngineConfig(drag_hold_ms=100, pause_hold_ms=400)
    interp = armed(cfg)
    mock_os = MockOSAdapter()
    engine = LogicalActionEngine(mock_os, initial_mode=MODE_CONTROL)
    _feed(interp, engine, [(make_open_palm(0.5, 0.5, pinch_dist=0.015), t) for t in (0.0, 40.0, 80.0, 120.0, 160.0)])
    assert mock_os.button_held is True

    seen = _feed(interp, engine, [(make_closed_fist(), float(t)) for t in range(200, 500, 33)])
    assert EVENT_END_DRAG in seen
    assert EVENT_LEFT_CLICK not in seen
    assert mock_os.button_held is False
    assert engine.total_clicks == 0


def test_fist_hold_pauses_and_pinch_is_ignored_while_paused() -> None:
    interp = armed(EngineConfig(pause_hold_ms=400))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    seen = _feed(interp, engine, [(make_closed_fist(), float(t)) for t in range(0, 1000, 33)])
    assert EVENT_PAUSE in seen
    assert interp.paused is True
    seen = _feed(
        interp,
        engine,
        [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 600.0), (make_open_palm(0.5, 0.5, pinch_dist=0.02), 640.0)],
    )
    assert seen == []


def test_fist_pause_disabled_does_not_pause() -> None:
    interp = armed(EngineConfig(pause_hold_ms=400, fist_pause_enabled=False))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    seen = _feed(interp, engine, [(make_closed_fist(), float(t)) for t in range(0, 1000, 33)])
    assert EVENT_PAUSE not in seen
    assert interp.paused is False


def _partial_curl(dy: float):
    """Mano con las puntas a `dy` del nivel de las MCP: negativo = extendida, positivo = hacia la palma."""
    from motor_local.detector import HandLandmarks, Point3D

    hand = make_open_palm(0.5, 0.5, pinch_dist=0.14)
    lms = list(hand.landmarks)
    for tip, mcp in ((8, 5), (12, 9), (16, 13), (20, 17)):
        lms[tip] = Point3D(lms[mcp].x, lms[mcp].y + dy)
    return HandLandmarks(landmarks=lms, handedness="Right", confidence=0.95)


def test_open_hand_with_slightly_bent_fingers_never_pauses() -> None:
    interp = armed(EngineConfig(pause_hold_ms=450))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    seen = _feed(interp, engine, [(_partial_curl(-0.08), float(t)) for t in range(0, 3000, 33)])
    assert EVENT_PAUSE not in seen
    assert interp.paused is False


def test_brief_fist_flicker_does_not_pause_or_release_drag() -> None:
    interp = armed(EngineConfig(pause_hold_ms=450, drag_hold_ms=100))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    _feed(interp, engine, [(make_open_palm(0.5, 0.5, pinch_dist=0.015), t) for t in (0.0, 40.0, 80.0, 120.0, 160.0)])
    assert mock_drag_held(engine)
    seen = _feed(interp, engine, [(make_closed_fist(), float(t)) for t in range(200, 300, 33)])  # ~100 ms
    seen += _feed(interp, engine, [(make_open_palm(0.5, 0.5, pinch_dist=0.015), float(t)) for t in range(330, 900, 33)])
    assert EVENT_PAUSE not in seen
    assert EVENT_END_DRAG not in seen
    assert interp.paused is False


def test_moving_fist_is_not_a_pause_gesture() -> None:
    interp = armed(EngineConfig(pause_hold_ms=450))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    frames = []
    for i in range(60):
        frames.append((make_closed_fist(0.3 + 0.01 * i, 0.5), float(33 * i)))  # desplazándose
    seen = _feed(interp, engine, frames)
    assert EVENT_PAUSE not in seen


def mock_drag_held(engine: LogicalActionEngine) -> bool:
    return engine.adapter.button_held


def test_disabled_pinch_produces_no_click_and_disabled_pointer_produces_no_movement() -> None:
    interp = armed(EngineConfig(pinch_enabled=False, pointer_enabled=False))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    seen = _feed(
        interp,
        engine,
        [
            (make_open_palm(0.3, 0.3, pinch_dist=0.14), 0.0),
            (make_open_palm(0.5, 0.5, pinch_dist=0.02), 40.0),
            (make_open_palm(0.5, 0.5, pinch_dist=0.02), 80.0),
            (make_open_palm(0.5, 0.5, pinch_dist=0.02), 120.0),
            (make_open_palm(0.5, 0.5, pinch_dist=0.14), 160.0),
            (make_open_palm(0.5, 0.5, pinch_dist=0.14), 200.0),
        ],
    )
    assert EVENT_LEFT_CLICK not in seen
    assert "MOVE_CURSOR" not in seen


# --- Scroll ---

def _scroll_sum(events) -> int:
    return sum(e.payload["dy"] for e in events if e.type == EVENT_SCROLL)


def test_quiet_two_finger_pose_does_not_scroll_and_jitter_is_ignored() -> None:
    interp = armed(EngineConfig())
    total = 0
    for i in range(30):
        jitter = 0.002 if i % 2 else -0.002
        total += _scroll_sum(interp.process_frame(make_two_fingers(0.5, 0.5 + jitter), now_ms=100.0 + i * 33.0))
    assert total == 0


def test_two_finger_scroll_sign_is_up_positive_and_down_negative() -> None:
    def run(start: float, end: float) -> int:
        interp = armed(EngineConfig())
        total = 0
        ys = [start] * 3 + [start + (end - start) * k / 10 for k in range(1, 11)] + [end] * 15
        for i, cy in enumerate(ys):
            total += _scroll_sum(interp.process_frame(make_two_fingers(0.5, cy), now_ms=100.0 + i * 33.0))
        return total

    assert run(0.62, 0.44) > 0   # subir la mano -> desplazar hacia arriba
    assert run(0.44, 0.62) < 0   # bajar la mano -> desplazar hacia abajo


def test_scroll_total_is_similar_across_cadences() -> None:
    def run(step_ms: float) -> int:
        interp = armed(EngineConfig())
        total = 0
        ys = [0.62] * 3 + [0.62 - 0.18 * k / 12 for k in range(1, 13)] + [0.44] * 80
        for i, cy in enumerate(ys):
            total += _scroll_sum(interp.process_frame(make_two_fingers(0.5, cy), now_ms=100.0 + i * step_ms))
        return total

    fast = run(33.0)
    slow = run(100.0)
    assert fast > 0 and slow > 0
    assert abs(fast - slow) <= 2


def test_horizontal_two_finger_motion_does_not_scroll() -> None:
    interp = armed(EngineConfig())
    total = 0
    for i in range(20):
        total += _scroll_sum(interp.process_frame(make_two_fingers(0.3 + 0.02 * i, 0.5), now_ms=100.0 + i * 33.0))
    assert total == 0


def test_scroll_speed_is_limited_per_second() -> None:
    interp = armed(EngineConfig(sensitivity=100))
    interp.process_frame(make_two_fingers(0.5, 0.9), now_ms=0.0)
    interp.process_frame(make_two_fingers(0.5, 0.9), now_ms=100.0)
    interp.process_frame(make_two_fingers(0.5, 0.9), now_ms=200.0)
    # Un salto muy grande en 33 ms no debe generar más de ~20 muescas por segundo.
    evts = interp.process_frame(make_two_fingers(0.5, 0.1), now_ms=233.0)
    assert 0 <= _scroll_sum(evts) <= 2


def test_two_fingers_never_click() -> None:
    interp = armed(EngineConfig())
    seen: list[str] = []
    for i in range(12):
        seen.extend(_types(interp.process_frame(make_two_fingers(0.5, 0.6 - 0.01 * i), now_ms=i * 40.0)))
    assert EVENT_LEFT_CLICK not in seen
    assert EVENT_START_DRAG not in seen


# --- Configuración IPC ---

@pytest.mark.parametrize(
    "payload",
    [
        {"sensitivity": "80"},
        {"sensitivity": 101},
        {"sensitivity": True},
        {"preferredHand": "ABAJO"},
        {"pinch": "si"},
        {"cameraIndex": 99},
        {"format_version": 1},
        {"formato_version": 1},
    ],
)
def test_ipc_config_rejects_invalid_values_and_foreign_formats(payload: dict) -> None:
    with pytest.raises(ConfigError):
        EngineConfig.from_dict(payload)


def test_ipc_config_absent_keys_use_documented_defaults_only() -> None:
    cfg = EngineConfig.from_dict({"sensitivity": 70})
    assert cfg.sensitivity == 70
    assert cfg.stability == 40
    assert cfg.pointer_enabled is True and cfg.drag_enabled is True


def test_ipc_config_roundtrip_preserves_enabled_flags() -> None:
    cfg = EngineConfig.from_dict({"pinch": False, "drag": False, "scroll": False, "pointer": False, "fistPause": False})
    restored = EngineConfig.from_dict(cfg.to_dict())
    assert (restored.pinch_enabled, restored.drag_enabled, restored.scroll_enabled) == (False, False, False)
    assert (restored.pointer_enabled, restored.fist_pause_enabled) == (False, False)


def test_pinch_survives_jitter_between_enter_and_exit_thresholds() -> None:
    # Entre el umbral de entrada (0,35 palmas) y el de salida (0,48) la medida oscila en una pinza real.
    interp = armed(EngineConfig(click_cooldown_ms=0, drag_hold_ms=2000))
    engine = LogicalActionEngine(MockOSAdapter(), initial_mode=MODE_CONTROL)
    frames = []
    for i, t in enumerate(range(0, 300, 40)):
        pinch = 0.048 if i % 2 == 0 else 0.064  # alterna dentro de la histéresis
        frames.append((make_open_palm(0.5, 0.5, pinch_dist=pinch), float(t)))
    frames += [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 320.0), (make_open_palm(0.5, 0.5, pinch_dist=0.14), 360.0)]
    seen = _feed(interp, engine, frames)
    assert seen.count(EVENT_LEFT_CLICK) == 1


def test_one_bad_frame_does_not_reset_scroll_confirmation() -> None:
    interp = armed(EngineConfig())
    seen = []
    for t, cy in ((100.0, 0.62), (130.0, 0.62), (160.0, 0.62)):
        seen += _types(interp.process_frame(make_two_fingers(0.5, cy), now_ms=t))
    seen += _types(interp.process_frame(make_open_palm(0.5, 0.62), now_ms=190.0))  # un fotograma malo
    evts = interp.process_frame(make_two_fingers(0.5, 0.44), now_ms=220.0)
    assert any(e.type == EVENT_SCROLL and e.payload["dy"] > 0 for e in evts)
