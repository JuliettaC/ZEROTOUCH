"""Suite de regresión del motor gestual local (ZeroTouch).

Cubre las regresiones de comportamiento del interpretador y del motor de acciones.
Todas las pruebas son sintéticas: no abren cámara ni inyectan entradas reales.
Las pruebas con proceso real van marcadas `hardware` y se excluyen por defecto (pytest.ini).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from motor_local.action_engine import MODE_CONTROL, MODE_OBSERVATION, LogicalActionEngine
from motor_local.config import EngineConfig
from motor_local.detector import HandLandmarks, Point3D, resolve_user_handedness, select_target_hand
from motor_local.interpreter import (
    EVENT_END_DRAG,
    EVENT_LEFT_CLICK,
    EVENT_MOVE_CURSOR,
    EVENT_PAUSE,
    EVENT_RESUME,
    EVENT_SCROLL,
    EVENT_START_DRAG,
    EVENT_TRACKING_LOST,
    GestureInterpreter,
    OneEuroFilter1D,
)
from motor_local.os_adapter import MockOSAdapter


def make_open_palm(
    cx: float = 0.5,
    cy: float = 0.5,
    pinch_dist: float = 0.12,
    handedness: str = "Right",
    confidence: float = 0.95,
    scale: float = 1.0,
) -> HandLandmarks:
    """Creates a synthetic 21-landmark open palm centered at (cx, cy) with configurable scale."""
    lms = [Point3D(cx, cy + 0.16 * scale)] * 21  # 0: wrist below palm
    lms[5] = Point3D(cx - 0.04 * scale, cy)
    lms[9] = Point3D(cx, cy)
    lms[13] = Point3D(cx + 0.03 * scale, cy)
    lms[17] = Point3D(cx + 0.06 * scale, cy + 0.01 * scale)
    for idx in (6, 10, 14, 18):
        lms[idx] = Point3D(cx, cy - 0.06 * scale)
    for idx in (8, 12, 16, 20):
        lms[idx] = Point3D(cx, cy - 0.14 * scale)
    lms[4] = Point3D(cx + pinch_dist * scale, cy - 0.14 * scale)
    if pinch_dist < 0.08:
        # Pinza realista (21-11-2026): el índice se dobla hacia el pulgar y se aparta del medio. Antes las cuatro
        # puntas coincidían, una mano imposible que ya no pasa por la forma de micro-pinza del intérprete.
        lms[8] = Point3D(cx - 0.07 * scale, cy - 0.10 * scale)
        lms[4] = Point3D(cx - 0.07 * scale + pinch_dist * scale, cy - 0.10 * scale)
    lms[2] = Point3D(cx - 0.06 * scale, cy + 0.05 * scale)
    lms[3] = Point3D(cx - 0.07 * scale, cy - 0.02 * scale)
    return HandLandmarks(landmarks=lms, handedness=handedness, confidence=confidence)


def make_closed_fist(cx: float = 0.5, cy: float = 0.5, handedness: str = "Right") -> HandLandmarks:
    """Creates a synthetic 21-landmark closed fist (all finger tips curled near palm)."""
    lms = [Point3D(cx, cy + 0.15)] * 21
    for idx in (5, 9, 13, 17):
        lms[idx] = Point3D(cx, cy)
    for idx in (6, 10, 14, 18):
        lms[idx] = Point3D(cx, cy + 0.05)
    for idx in (8, 12, 16, 20):
        lms[idx] = Point3D(cx, cy + 0.03)  # puntas dentro de la palma
    lms[4] = Point3D(cx + 0.02, cy + 0.05)
    lms[2] = Point3D(cx + 0.02, cy + 0.06)
    return HandLandmarks(landmarks=lms, handedness=handedness, confidence=0.95)


def make_two_fingers(cx: float = 0.5, cy: float = 0.5, handedness: str = "Right") -> HandLandmarks:
    """Creates a synthetic 2-finger gesture (index + middle extended, ring + pinky folded)."""
    hand = make_open_palm(cx, cy, pinch_dist=0.12, handedness=handedness)
    lms = list(hand.landmarks)
    lms[16] = Point3D(cx, cy + 0.09)
    lms[20] = Point3D(cx, cy + 0.09)
    return HandLandmarks(landmarks=lms, handedness=handedness, confidence=0.95)


def armed(config: EngineConfig | None = None) -> GestureInterpreter:
    """Interpretador con el puntero ya armado: mano abierta sostenida antes de t=0 (activar_puntero)."""
    interp = GestureInterpreter(config)
    for t in (-2000.0, -1900.0, -1800.0, -1700.0, -1600.0, -1500.0):
        interp.process_frame(make_open_palm(0.5, 0.5, pinch_dist=0.14), now_ms=t)
    assert interp.pointer_armed or not interp.config.pointer_enabled
    return interp


# --- 1 & 2. Left/right handedness & Mirrored vs. Non-Mirrored camera input ---

def test_handedness_mirrored_and_unmirrored() -> None:
    assert resolve_user_handedness("Right", mirror_camera=True) == "Right"
    assert resolve_user_handedness("Left", mirror_camera=True) == "Left"
    assert resolve_user_handedness("Right", mirror_camera=False) == "Left"
    assert resolve_user_handedness("Left", mirror_camera=False) == "Right"


# --- 3 & 4. Active-hand selection & Multiple-hand scenarios ---

def test_preferred_hand_filtering_and_multi_hand_stability() -> None:
    left_hand = make_open_palm(cx=0.25, cy=0.5, handedness="Left", confidence=0.96)
    right_hand = make_open_palm(cx=0.75, cy=0.5, handedness="Right", confidence=0.88)

    picked_right = select_target_hand([left_hand, right_hand], preferred_hand="RIGHT", min_confidence=0.65)
    assert picked_right is not None and picked_right.handedness == "Right"

    picked_left = select_target_hand([left_hand, right_hand], preferred_hand="LEFT", min_confidence=0.65)
    assert picked_left is not None and picked_left.handedness == "Left"

    none_hand = select_target_hand([left_hand], preferred_hand="RIGHT", min_confidence=0.65)
    assert none_hand is None

    auto_locked = select_target_hand(
        [left_hand, right_hand],
        preferred_hand="AUTO",
        min_confidence=0.65,
        last_palm_pos=(0.74, 0.52),
        locked_hand_label="Right",
    )
    assert auto_locked is not None and auto_locked.handedness == "Right"


# --- 5, 6 & 7. Cursor coordinate mapping, screen scaling, and One-Euro smoothing ---

def test_cursor_coordinate_mapping_and_one_euro_smoothing() -> None:
    cfg = EngineConfig(sensitivity=70, stability=50, movement_area=60, desk_rest=True)
    x_min, x_max, y_min, y_max = cfg.active_bounds
    assert 0.05 <= x_min < x_max <= 0.95
    assert 0.05 <= y_min < y_max <= 0.95

    filt = OneEuroFilter1D(min_cutoff=cfg.min_cutoff_hz, beta=cfg.beta_speed)
    v0 = filt.filter(0.500, 0.00)
    v1 = filt.filter(0.502, 0.03)
    assert abs(v1 - v0) < 0.002

    v_fast = filt.filter(0.850, 0.06)
    assert v_fast > 0.65

    adapter_4k = MockOSAdapter(screen_width=3840, screen_height=2160)
    adapter_4k.move_cursor(0.0, 0.0)
    assert (adapter_4k.cursor_x, adapter_4k.cursor_y) == (0, 0)
    adapter_4k.move_cursor(1.0, 1.0)
    assert (adapter_4k.cursor_x, adapter_4k.cursor_y) == (3839, 2159)


# --- 8, 9 & 3. Pinch: confirmation, pre-click cursor lock and click cooldown ---

def test_confirmed_pinch_clicks_once_and_cooldown_blocks_repeat() -> None:
    cfg = EngineConfig(click_cooldown_ms=320, drag_hold_ms=420, pinch_tolerance=50)
    interp = armed(cfg)
    mock_os = MockOSAdapter()
    engine = LogicalActionEngine(mock_os, initial_mode=MODE_CONTROL)
    clicks: list[str] = []

    def step(cx: float, cy: float, pinch: float, t: float) -> None:
        evts = interp.process_frame(make_open_palm(cx, cy, pinch_dist=pinch, scale=0.55), now_ms=t)
        engine.dispatch(evts)
        clicks.extend(e.type for e in evts if e.type == EVENT_LEFT_CLICK)

    step(0.5, 0.5, 0.14, 0.0)
    pos_before = (mock_os.cursor_x, mock_os.cursor_y)

    # Candidate pinch: the cursor is locked from the first sample.
    step(0.505, 0.505, 0.02, 40.0)
    assert (mock_os.cursor_x, mock_os.cursor_y) == pos_before
    step(0.505, 0.505, 0.02, 80.0)
    step(0.505, 0.505, 0.02, 120.0)  # confirmed (3 samples, >= 60 ms)
    assert (mock_os.cursor_x, mock_os.cursor_y) == pos_before

    # Release needs two samples outside the threshold -> exactly one click.
    step(0.505, 0.505, 0.14, 200.0)
    step(0.505, 0.505, 0.14, 240.0)
    assert clicks == [EVENT_LEFT_CLICK]
    assert engine.total_clicks == 1

    # A second confirmed pinch inside the 320 ms cooldown produces no click.
    step(0.5, 0.5, 0.02, 280.0)
    step(0.5, 0.5, 0.02, 320.0)
    step(0.5, 0.5, 0.02, 360.0)
    step(0.5, 0.5, 0.14, 400.0)
    step(0.5, 0.5, 0.14, 440.0)
    assert engine.total_clicks == 1


# --- 10 & 12. Drag state handling and tracking-loss safety release ---

def test_sustained_pinch_drag_and_tracking_loss_release() -> None:
    cfg = EngineConfig(drag_hold_ms=380, tracking_loss_frames=3)
    interp = armed(cfg)
    mock_os = MockOSAdapter()
    engine = LogicalActionEngine(mock_os, initial_mode=MODE_CONTROL)

    for t in (100.0, 140.0, 180.0, 260.0, 340.0):
        engine.dispatch(interp.process_frame(make_open_palm(0.5, 0.5, pinch_dist=0.015), now_ms=t))
    assert mock_os.button_held is False

    evts_drag = interp.process_frame(make_open_palm(0.55, 0.55, pinch_dist=0.015), now_ms=520.0)
    assert any(e.type == EVENT_START_DRAG for e in evts_drag)
    engine.dispatch(evts_drag)
    assert mock_os.button_held is True

    all_loss_evts = []
    for i in range(3):
        all_loss_evts.extend(interp.process_frame(None, now_ms=600.0 + i * 30.0))
    assert any(e.type == EVENT_END_DRAG for e in all_loss_evts)
    assert any(e.type == EVENT_TRACKING_LOST for e in all_loss_evts)
    engine.dispatch(all_loss_evts)
    assert mock_os.button_held is False
    assert engine.total_clicks == 0


# --- 11 & 13. Two-finger scrolling, closed-fist pause/resume, and emergency stop ---

def test_two_finger_scroll_pause_and_emergency_stop() -> None:
    cfg = EngineConfig(pause_hold_ms=400)
    interp = armed(cfg)
    mock_os = MockOSAdapter()
    engine = LogicalActionEngine(mock_os, initial_mode=MODE_CONTROL)

    scroll_dy = 0
    for t in range(100, 800, 25):   # dos dedos hacia arriba sostenidos (24-11-2026: ya no hace falta mover la mano)
        evts = interp.process_frame(make_two_fingers(0.5, 0.5), now_ms=float(t))
        engine.dispatch(evts)
        scroll_dy += sum(e.payload["dy"] for e in evts if e.type == EVENT_SCROLL)
    assert scroll_dy > 0, "dos dedos hacia arriba sostenidos deben desplazar hacia arriba"
    assert engine.total_scrolls >= 1

    evts_pause = []
    for t in range(820, 1620, 33):  # puño confirmado (~250 ms) y mantenido 450 ms
        evts_pause += interp.process_frame(make_closed_fist(), now_ms=float(t))
    assert any(e.type == EVENT_PAUSE for e in evts_pause)
    assert interp.paused is True

    assert len(interp.process_frame(make_open_palm(0.7, 0.7), now_ms=1650.0)) == 0

    evts_resume = []
    for t in range(1700, 2500, 33):
        evts_resume += interp.process_frame(make_closed_fist(), now_ms=float(t))
    assert any(e.type == EVENT_RESUME for e in evts_resume)
    assert interp.paused is False

    mock_os.start_drag()
    engine.trigger_emergency_stop()
    assert engine.mode == MODE_OBSERVATION
    assert engine.emergency_stopped is True
    assert mock_os.button_held is False


# --- 14 & 15. Configuración IPC y proceso real (manual) ---

@pytest.mark.hardware
def test_config_roundtrip_and_ipc_subprocess() -> None:
    raw = {
        "preferredHand": "LEFT",
        "mirrorCamera": False,
        "sensitivity": 78,
        "stability": 55,
        "pinchTolerance": 62,
        "movementArea": 70,
        "confidenceThreshold": 75,
        "deskRest": False,
        "pinch": True,
        "scroll": False,
        "cameraIndex": 1,
    }
    cfg = EngineConfig.from_dict(raw)
    serialized = cfg.to_dict()
    restored = EngineConfig.from_dict(serialized)
    assert restored.preferred_hand == "LEFT"
    assert restored.mirror_camera is False
    assert restored.sensitivity == 78
    assert restored.scroll_enabled is False

    motor_root = Path(__file__).resolve().parent.parent
    commands = "\n".join(
        [
            json.dumps({"id": 1, "cmd": "SET_CONFIG", "config": serialized}),
            json.dumps({"id": 2, "cmd": "SET_MODE", "mode": "CONTROL"}),
            json.dumps({"id": 3, "cmd": "SET_MODE", "mode": "OBSERVATION"}),
            json.dumps({"id": 4, "cmd": "STOP"}),
        ]
    ) + "\n"

    proc = subprocess.run(
        [sys.executable, "-u", "-m", "motor_local.main", "--mock-os"],
        cwd=str(motor_root),
        input=commands,
        text=True,
        capture_output=True,
        timeout=25,
    )
    assert proc.returncode == 0
    lines = [json.loads(line) for line in proc.stdout.splitlines() if line.strip().startswith("{")]
    msg_types = [m.get("type") for m in lines]
    assert "READY" in msg_types
    assert "STOPPED" in msg_types


def test_quick_pinch_tap_clicks_at_low_frame_rate() -> None:
    """A ~15 FPS una pinza breve dura dos muestras: debe confirmarse y hacer clic."""
    interp = armed(EngineConfig(click_cooldown_ms=0))
    frames = [(make_open_palm(0.5, 0.5, pinch_dist=0.14), 0.0)]
    frames += [(make_open_palm(0.5, 0.5, pinch_dist=0.02), t) for t in (66.0, 133.0)]
    frames += [(make_open_palm(0.5, 0.5, pinch_dist=0.14), t) for t in (200.0, 266.0)]
    seen = [e.type for hand, t in frames for e in interp.process_frame(hand, now_ms=t)]
    assert seen.count(EVENT_LEFT_CLICK) == 1


def test_pinch_ignores_tips_overlapping_only_in_2d() -> None:
    """Puntas superpuestas en la imagen pero separadas en profundidad no son una pinza."""
    interp = armed(EngineConfig(click_cooldown_ms=0))
    seen = []
    for i, t in enumerate((0.0, 33.0, 66.0, 100.0, 133.0, 166.0)):
        hand = make_open_palm(0.5, 0.5, pinch_dist=0.02)
        lms = list(hand.landmarks)
        lms[4] = Point3D(lms[4].x, lms[4].y, -0.15)   # pulgar mucho más cerca de la cámara
        seen += [e.type for e in interp.process_frame(HandLandmarks(lms, "Right", 0.95), now_ms=t)]
    assert EVENT_LEFT_CLICK not in seen and EVENT_START_DRAG not in seen


def test_cursor_gain_no_longer_amplifies_jitter_with_desk_rest() -> None:
    cfg = EngineConfig(sensitivity=65, desk_rest=True)
    assert 1.2 <= cfg.cursor_gain <= 1.45
    assert EngineConfig(sensitivity=100).cursor_gain <= 1.6
