"""Asistencia por orientación de la cabeza: estimación geométrica, histéresis y retención.
Sintético: no abre cámara ni carga el detector facial."""

from __future__ import annotations

from motor_local.action_engine import MODE_CONTROL, LogicalActionEngine
from motor_local.config import EngineConfig, GazeConfig
from motor_local.gaze import NO_FACE_MS, GazeGate, HeadPose, estimate_head_pose
from motor_local.interpreter import EVENT_END_DRAG, EVENT_LEFT_CLICK, EVENT_MOVE_CURSOR
from motor_local.os_adapter import MockOSAdapter

from tests.test_engine import armed, make_open_palm


def _face(nose_dx: float = 0.0, nose_dy: float = 0.0):
    # ojo derecho, ojo izquierdo, nariz, boca (coordenadas normalizadas)
    return [(0.40, 0.40), (0.60, 0.40), (0.50 + nose_dx, 0.52 + nose_dy), (0.50, 0.62)]


def test_head_pose_geometry_is_centered_and_signed() -> None:
    centered = estimate_head_pose(_face())
    assert centered is not None and abs(centered.yaw) < 1.0 and abs(centered.pitch) < 2.0
    turned = estimate_head_pose(_face(nose_dx=0.08))
    assert turned is not None and turned.yaw > 25.0
    assert estimate_head_pose(_face(nose_dx=-0.08)).yaw < -25.0
    assert estimate_head_pose(_face(nose_dy=0.05)).pitch > 15.0
    assert estimate_head_pose([(0.5, 0.5), (0.5, 0.5), (0.5, 0.5), (0.5, 0.6)]) is None
    assert estimate_head_pose([(0.4, 0.4)]) is None


def test_gate_holds_after_away_ms_and_releases_after_back_ms() -> None:
    gate = GazeGate(GazeConfig(enabled=True, yaw_tolerance=20, pitch_tolerance=18, away_ms=800, back_ms=300))
    look = HeadPose(2.0, 1.0, 0.9)
    away = HeadPose(40.0, 0.0, 0.9)
    assert gate.update(look, 0.0) is True and gate.state == "presente"
    # Mirar fuera brevemente no retiene.
    for t in (100.0, 300.0, 600.0):
        assert gate.update(away, t) is True
    assert gate.update(look, 700.0) is True
    # Fuera durante 800 ms: retiene.
    for t in (1000.0, 1400.0, 1700.0):
        gate.update(away, t)
    assert gate.update(away, 1850.0) is False and gate.state == "ausente"
    # Volver a mirar: se reanuda tras back_ms, no antes.
    assert gate.update(look, 1900.0) is False
    assert gate.update(look, 2100.0) is False
    assert gate.update(look, 2250.0) is True and gate.state == "presente"


def test_no_face_counts_as_away_and_disabled_never_holds() -> None:
    gate = GazeGate(GazeConfig(enabled=True))
    assert gate.update(None, 0.0) is True
    assert gate.update(None, NO_FACE_MS - 10) is True
    assert gate.update(None, NO_FACE_MS + 10) is False and gate.state == "sin_rostro"
    disabled = GazeGate(GazeConfig(enabled=False))
    for t in range(0, 5000, 500):
        assert disabled.update(None if t % 1000 else HeadPose(50.0, 50.0, 0.9), float(t)) is True
    assert disabled.state == "desactivado"
    gate.update_config(GazeConfig(enabled=False))
    assert gate.holding is False and gate.state == "desactivado"


def test_calibration_removes_the_neutral_bias() -> None:
    config = GazeConfig(enabled=True, yaw_tolerance=15, pitch_tolerance=15, calibration=(25.0, -10.0))
    gate = GazeGate(config)
    assert gate.looking_at_screen(HeadPose(25.0, -10.0, 0.9))
    assert not gate.looking_at_screen(HeadPose(0.0, 0.0, 0.9))
    gate = GazeGate(GazeConfig(enabled=True))
    gate.start_calibration()
    for i in range(25):
        gate.update(HeadPose(12.0 + (i % 3), -4.0, 0.9), 50.0 * i)
    assert gate.calibrating is False
    assert gate.calibration_result == (13.0, -4.0)


def test_external_hold_releases_the_drag_and_suppresses_every_action() -> None:
    interp = armed(EngineConfig(drag_hold_ms=100, click_cooldown_ms=0))
    adapter = MockOSAdapter()
    engine = LogicalActionEngine(adapter, initial_mode=MODE_CONTROL)
    for t in (0.0, 40.0, 80.0, 120.0, 160.0):
        engine.dispatch(interp.process_frame(make_open_palm(0.5, 0.5, pinch_dist=0.015), now_ms=t))
    assert adapter.button_held is True
    events = interp.set_external_hold(True)
    assert EVENT_END_DRAG in [e.type for e in events]
    engine.dispatch(events)
    assert adapter.button_held is False
    seen = []
    for i, t in enumerate(range(200, 600, 40)):
        seen += interp.process_frame(make_open_palm(0.3 + 0.02 * i, 0.5, pinch_dist=0.02 if i % 2 else 0.14), now_ms=float(t))
    assert seen == [] and interp.telemetry.gesture == "GAZE_HOLD"
    interp.set_external_hold(False)
    seen = [e.type for e in interp.process_frame(make_open_palm(0.7, 0.7, pinch_dist=0.14), now_ms=700.0)]
    assert EVENT_MOVE_CURSOR in seen
    assert EVENT_LEFT_CLICK not in seen
