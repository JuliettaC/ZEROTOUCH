"""Comandos IPC nuevos: ACK con configuración aplicada, AIRSWIPE, TYPE_TEXT, PRESS_KEY y GAZE_CALIBRATE.
Mismo arnés sintético que test_ipc_protocol (cámara y detector falsos)."""

from __future__ import annotations

from tests.test_ipc_protocol import VALID_DOC, _acks, _run


def test_set_config_ack_returns_the_applied_configuration(monkeypatch, capsys) -> None:
    commands = [
        {"id": 1, "cmd": "SET_CONFIG", "config": {"sensitivity": 70, "gestos": {"palma_abierta": {"accion": "multimedia_siguiente", "habilitado": True}}}},
        {"id": 2, "cmd": "SET_CONFIG", "config": {"gestos": {"micro_pinza": {"accion": "arrastrar", "habilitado": True}}}},
        {"id": 3, "cmd": "LOAD_EXPORT", "document": VALID_DOC},
        {"id": 4, "cmd": "STOP"},
    ]
    code, messages = _run(monkeypatch, capsys, commands)
    assert code == 0
    acks = _acks(messages)
    assert acks[1]["ok"] is True
    assert acks[1]["config"]["sensitivity"] == 70
    assert acks[1]["config"]["gestos"]["palma_abierta"] == {"accion": "multimedia_siguiente", "habilitado": True}
    assert acks[1]["config"]["palm"] is True
    assert "pulgar_arriba" not in acks[1]["config"]["gestos"] and "thumbsUp" not in acks[1]["config"]
    assert acks[2]["ok"] is False and acks[2]["code"] == "ACTION_NOT_IMPLEMENTED"
    assert acks[3]["ok"] is True and acks[3]["config"]["sensitivity"] == 60
    assert acks[3]["gestures"]["dos_dedos"]["habilitado"] is True
    ready = next(m for m in messages if m["type"] == "READY")
    assert "gestos" in ready["config"]


def test_airswipe_typing_requires_keyboard_open_and_control(monkeypatch, capsys) -> None:
    commands = [
        {"id": 1, "cmd": "TYPE_TEXT", "text": "hola"},
        {"id": 2, "cmd": "AIRSWIPE", "active": "si"},
        {"id": 3, "cmd": "AIRSWIPE", "active": True},
        {"id": 4, "cmd": "TYPE_TEXT", "text": "hola"},
        {"id": 5, "cmd": "SET_MODE", "mode": "CONTROL"},
        {"id": 6, "cmd": "TYPE_TEXT", "text": "hola"},
        {"id": 7, "cmd": "TYPE_TEXT", "text": "con\nsalto"},
        {"id": 8, "cmd": "PRESS_KEY", "key": "backspace"},
        {"id": 9, "cmd": "PRESS_KEY", "key": "f4"},
        {"id": 10, "cmd": "SET_CONFIG", "config": {"airswipe": False}},
        {"id": 11, "cmd": "AIRSWIPE", "active": True},
        {"id": 12, "cmd": "STOP"},
    ]
    code, messages = _run(monkeypatch, capsys, commands)
    assert code == 0
    acks = _acks(messages)
    assert acks[1]["code"] == "AIRSWIPE_INACTIVE"
    assert acks[2]["code"] == "FIELD_INVALID"
    assert acks[3]["ok"] is True and acks[3]["airswipe"] is True
    assert acks[4]["code"] == "CONTROL_REQUIRED"
    assert acks[5]["ok"] is True
    assert acks[6]["ok"] is True
    assert acks[7]["code"] == "TEXT_INVALID"
    assert acks[8]["ok"] is True
    assert acks[9]["code"] == "KEY_NOT_ALLOWED"
    assert acks[10]["ok"] is True
    assert acks[11]["code"] == "AIRSWIPE_DISABLED"
    # El texto escrito nunca aparece en la salida del motor.
    assert all("hola" not in str(m) for m in messages)


def test_airswipe_typing_blocks_under_pause_gaze_tracking_loss_config_and_emergency(monkeypatch, capsys) -> None:
    from motor_local import main as engine_main
    from motor_local.gaze import HeadPose
    from tests.test_engine import make_open_palm
    from tests.test_ipc_protocol import FakeCapture, FakeDetector

    state = {"hand": make_open_palm(0.5, 0.5, pinch_dist=0.14), "pose": HeadPose(0.0, 0.0, 0.95)}

    class ScriptedCapture(FakeCapture):
        def read_rgb_frame(self):
            return True, "frame"

    class ScriptedDetector(FakeDetector):
        def detect(self, *_: object, **__: object):
            return state["hand"]

    class ScriptedFace:
        def __init__(self, *_: object, **__: object) -> None:
            pass

        def detect(self, *_: object, **__: object):
            return state["pose"]

        def close(self) -> None:
            pass

    monkeypatch.setattr(engine_main, "FaceOrientationDetector", ScriptedFace)
    commands = [
        {"id": 1, "cmd": "SET_MODE", "mode": "CONTROL"},
        {"id": 2, "cmd": "AIRSWIPE", "active": True},
        {"id": 3, "cmd": "TYPE_TEXT", "text": "ok"},
        {"id": 4, "cmd": "SET_PAUSED", "paused": True},
        {"id": 5, "cmd": "TYPE_TEXT", "text": "bloqueado"},
        {"id": 6, "cmd": "PRESS_KEY", "key": "backspace"},
        {"id": 7, "cmd": "SET_PAUSED", "paused": False},
        {"id": 8, "cmd": "TYPE_TEXT", "text": "ok"},
        {"id": 9, "cmd": "SET_CONFIG", "config": {"airswipe": False}},
        {"id": 10, "cmd": "TYPE_TEXT", "text": "bloqueado"},
        {"id": 11, "cmd": "PRESS_KEY", "key": "space"},
        {"id": 12, "cmd": "SET_CONFIG", "config": {"airswipe": True}},
        {"id": 13, "cmd": "AIRSWIPE", "active": True},
        {"id": 14, "cmd": "LOAD_EXPORT", "document": VALID_DOC},
        {"id": 15, "cmd": "TYPE_TEXT", "text": "bloqueado"},
        {"id": 16, "cmd": "SET_CONFIG", "config": {"airswipe": True}},
        {"id": 17, "cmd": "AIRSWIPE", "active": True},
        {"id": 18, "cmd": "EMERGENCY_STOP"},
        {"id": 19, "cmd": "TYPE_TEXT", "text": "bloqueado"},
        {"id": 20, "cmd": "PRESS_KEY", "key": "enter"},
        {"id": 21, "cmd": "SET_MODE", "mode": "CONTROL"},
        {"id": 22, "cmd": "TYPE_TEXT", "text": "sin_teclado_tras_emergencia"},
        {"id": 23, "cmd": "STOP"},
    ]
    monkeypatch.setattr(engine_main, "CameraCapture", ScriptedCapture)
    monkeypatch.setattr(engine_main, "HandDetector", ScriptedDetector)
    import io, json, sys
    monkeypatch.setattr(sys, "stdin", io.StringIO("\n".join(json.dumps(c) for c in commands) + "\n"))
    code = engine_main.run_engine(use_mock_os=True)
    out = capsys.readouterr().out
    messages = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    assert code == 0
    acks = _acks(messages)
    assert acks[3]["ok"] is True
    assert acks[5]["ok"] is False and acks[5]["code"] == "INTERACTION_PAUSED"
    assert acks[6]["ok"] is False and acks[6]["code"] == "INTERACTION_PAUSED"
    assert acks[8]["ok"] is True
    assert acks[10]["ok"] is False and acks[10]["code"] == "AIRSWIPE_INACTIVE"
    assert acks[11]["ok"] is False and acks[11]["code"] == "AIRSWIPE_INACTIVE"
    assert acks[15]["ok"] is False and acks[15]["code"] == "AIRSWIPE_INACTIVE"
    assert acks[18]["ok"] is True
    assert acks[19]["ok"] is False and acks[19]["code"] == "AIRSWIPE_INACTIVE"
    assert acks[20]["ok"] is False and acks[20]["code"] == "AIRSWIPE_INACTIVE"
    assert acks[21]["ok"] is True
    assert acks[22]["ok"] is False and acks[22]["code"] == "AIRSWIPE_INACTIVE"
    em_tel = next(m for m in messages if m.get("type") == "TELEMETRY" and m.get("gesture") == "EMERGENCY_STOP")
    assert em_tel["airswipe"] is False and em_tel["tracing"] is False
    assert all("bloqueado" not in str(m) for m in messages)


def test_airswipe_ipc_blocks_on_gaze_hold_and_tracking_loss_then_recovers(monkeypatch, capsys) -> None:
    import io
    import json
    import sys
    from motor_local import main as engine_main
    from motor_local.gaze import HeadPose
    from tests.test_engine import make_open_palm
    from tests.test_ipc_protocol import FakeCapture, FakeDetector

    palm = make_open_palm(0.5, 0.5, pinch_dist=0.14)
    look = HeadPose(0.0, 0.0, 0.95)
    away = HeadPose(40.0, 0.0, 0.95)

    # Secuencia por fotograma: cada comando se entrega tras N fotogramas para ejercitar el bucle real.
    schedule = [
        (0, {"id": 1, "cmd": "SET_CONFIG", "config": {"gaze": {"enabled": True, "awayMs": 200, "backMs": 100}}}),
        (1, {"id": 2, "cmd": "SET_MODE", "mode": "CONTROL"}),
        (2, {"id": 3, "cmd": "AIRSWIPE", "active": True}),
        (3, {"id": 4, "cmd": "TYPE_TEXT", "text": "inicial"}),
        # En fotograma 4..10 la cabeza mira fuera (evaluado cada 3 fotogramas: 6 y 9 -> 150 ms; en 12 -> 300 ms >= 200 ms).
        (13, {"id": 5, "cmd": "TYPE_TEXT", "text": "bloqueado_mirada"}),
        (13, {"id": 6, "cmd": "PRESS_KEY", "key": "backspace"}),
        # En fotograma 14..21 vuelve a mirar a la pantalla (evaluado en 15, 18, 21 -> >= 100 ms) -> se reanuda.
        (22, {"id": 7, "cmd": "TYPE_TEXT", "text": "tras_mirada"}),
        # En fotograma 23..28 desaparece la mano (>=5 fotogramas) -> tracking_lost se activa.
        (29, {"id": 8, "cmd": "TYPE_TEXT", "text": "bloqueado_mano"}),
        (29, {"id": 9, "cmd": "PRESS_KEY", "key": "enter"}),
        # En fotograma 30..32 reaparece la mano -> limpia tracking_lost.
        (33, {"id": 10, "cmd": "TYPE_TEXT", "text": "recuperado"}),
        (34, {"id": 11, "cmd": "STOP"}),
    ]

    clock = {"ms": 0.0, "frame": 0}
    monkeypatch.setattr(engine_main.time, "monotonic", lambda: clock["ms"] / 1000.0)
    monkeypatch.setattr(engine_main.time, "sleep", lambda *_: None)

    # Encolamos comandos en cmd_queue conforme avanzan los fotogramas de cámara.
    orig_queue = engine_main.queue.Queue

    class ScheduledCapture(FakeCapture):
        def read_rgb_frame(self):
            clock["frame"] += 1
            clock["ms"] += 50.0
            f = clock["frame"]
            for target_f, cmd in schedule:
                if target_f == f:
                    active_queue.put(cmd)
            return True, "frame"

    class ScheduledDetector(FakeDetector):
        def detect(self, *_: object, **__: object):
            f = clock["frame"]
            if 23 <= f <= 29:
                return None
            return palm

    class ScheduledFace:
        def __init__(self, *_: object, **__: object) -> None:
            pass

        def detect(self, *_: object, **__: object):
            f = clock["frame"]
            if 4 <= f <= 13:
                return away
            return look

        def close(self) -> None:
            pass

    active_queue = None

    def make_queue():
        nonlocal active_queue
        active_queue = orig_queue()
        for target_f, cmd in schedule:
            if target_f == 0:
                active_queue.put(cmd)
        return active_queue

    monkeypatch.setattr(engine_main.queue, "Queue", make_queue)
    monkeypatch.setattr(engine_main, "stdin_reader", lambda *_: None)
    monkeypatch.setattr(engine_main, "CameraCapture", ScheduledCapture)
    monkeypatch.setattr(engine_main, "HandDetector", ScheduledDetector)
    monkeypatch.setattr(engine_main, "FaceOrientationDetector", ScheduledFace)

    code = engine_main.run_engine(use_mock_os=True)
    out = capsys.readouterr().out
    messages = [json.loads(line) for line in out.splitlines() if line.startswith("{")]
    assert code == 0
    acks = _acks(messages)
    assert acks[4]["ok"] is True
    assert acks[5]["ok"] is False and acks[5]["code"] == "GAZE_HOLD"
    assert acks[6]["ok"] is False and acks[6]["code"] == "GAZE_HOLD"
    assert acks[7]["ok"] is True
    assert acks[8]["ok"] is False and acks[8]["code"] == "TRACKING_LOST"
    assert acks[9]["ok"] is False and acks[9]["code"] == "TRACKING_LOST"
    assert acks[10]["ok"] is True


def test_gaze_calibration_needs_the_assistance_enabled(monkeypatch, capsys) -> None:
    from motor_local import main as engine_main

    class FakeFace:
        def __init__(self, *_: object, **__: object) -> None:
            pass

        def detect(self, *_: object, **__: object):
            return None

        def close(self) -> None:
            pass

    monkeypatch.setattr(engine_main, "FaceOrientationDetector", FakeFace)
    commands = [
        {"id": 1, "cmd": "GAZE_CALIBRATE"},
        {"id": 2, "cmd": "SET_CONFIG", "config": {"gaze": {"enabled": True}}},
        {"id": 3, "cmd": "GAZE_CALIBRATE"},
        {"id": 4, "cmd": "STOP"},
    ]
    code, messages = _run(monkeypatch, capsys, commands)
    assert code == 0
    acks = _acks(messages)
    assert acks[1]["code"] == "GAZE_DISABLED"
    assert acks[2]["ok"] is True and acks[2]["config"]["gaze"]["enabled"] is True
    assert acks[3]["ok"] is True
    assert messages[-1]["type"] == "STOPPED"
